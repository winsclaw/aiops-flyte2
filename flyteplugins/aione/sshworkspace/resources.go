package sshworkspace

import (
	"fmt"
	"hash/fnv"
	"sort"
	"strings"
	"unicode"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
)

const (
	labelWorkspaceName = "flyte.org/ssh-workspace"
	labelRunName       = "flyte.org/run-name"
	labelProject       = "flyte.org/project"
	labelDomain        = "flyte.org/domain"
	labelOrg           = "flyte.org/org"
	labelActionName    = "flyte.org/action-name"

	maxGeneratedNameBaseLength = 63 - len("-workspace")
)

type WorkspaceIdentity struct {
	Namespace  string
	Name       string
	RunName    string
	Project    string
	Domain     string
	Org        string
	ActionName string
}

type WorkspaceResources struct {
	Secret      *corev1.Secret
	PVC         *corev1.PersistentVolumeClaim
	StatefulSet *appsv1.StatefulSet
	Service     *corev1.Service
}

func BuildResources(identity WorkspaceIdentity, cfg WorkspaceConfig) (WorkspaceResources, error) {
	if identity.Namespace == "" {
		return WorkspaceResources{}, fmt.Errorf("namespace is required")
	}
	if identity.Name == "" {
		return WorkspaceResources{}, fmt.Errorf("name is required")
	}

	labels := workspaceLabels(identity)
	resourceName := kubernetesNameBase(identity.Name)
	secretName := resourceName + "-ssh"
	pvcName := resourceName + "-workspace"
	serviceName := resourceName + "-ssh"

	var cpu, memory resource.Quantity
	var err error
	if cfg.CPU != "" {
		cpu, err = resource.ParseQuantity(cfg.CPU)
		if err != nil {
			return WorkspaceResources{}, fmt.Errorf("invalid cpu quantity: %w", err)
		}
	}
	if cfg.Memory != "" {
		memory, err = resource.ParseQuantity(cfg.Memory)
		if err != nil {
			return WorkspaceResources{}, fmt.Errorf("invalid memory quantity: %w", err)
		}
	}

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      secretName,
			Namespace: identity.Namespace,
			Labels:    labels,
		},
		Type: corev1.SecretTypeOpaque,
		Data: map[string][]byte{
			"authorized_keys": []byte(strings.Join(cfg.AuthorizedKeys, "\n") + "\n"),
		},
	}

	var pvc *corev1.PersistentVolumeClaim
	if cfg.WorkspaceSize != "" {
		size, err := resource.ParseQuantity(cfg.WorkspaceSize)
		if err != nil {
			return WorkspaceResources{}, fmt.Errorf("invalid workspaceSize quantity: %w", err)
		}
		pvc = &corev1.PersistentVolumeClaim{
			ObjectMeta: metav1.ObjectMeta{
				Name:      pvcName,
				Namespace: identity.Namespace,
				Labels:    labels,
			},
			Spec: corev1.PersistentVolumeClaimSpec{
				AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
				Resources: corev1.VolumeResourceRequirements{
					Requests: corev1.ResourceList{corev1.ResourceStorage: size},
				},
			},
		}
	}

	replicas := int32(1)
	container := corev1.Container{
		Name:            "ssh",
		Image:           cfg.Image,
		ImagePullPolicy: corev1.PullIfNotPresent,
		Command:         []string{"/bin/sh", "-c"},
		Args:            []string{workspaceEntrypoint(cfg.SSHUser)},
		Ports: []corev1.ContainerPort{{
			Name:          "ssh",
			ContainerPort: 22,
			Protocol:      corev1.ProtocolTCP,
		}, {
			Name:          "code-server",
			ContainerPort: 8080,
			Protocol:      corev1.ProtocolTCP,
		}},
		Env: envVars(cfg.Environment),
		VolumeMounts: []corev1.VolumeMount{{
			Name:      "ssh-keys",
			MountPath: "/flyte-ssh",
			ReadOnly:  true,
		}},
		ReadinessProbe: &corev1.Probe{
			ProbeHandler: corev1.ProbeHandler{
				TCPSocket: &corev1.TCPSocketAction{Port: intstr.FromInt(22)},
			},
			InitialDelaySeconds: 3,
			PeriodSeconds:       5,
		},
	}
	if !cpu.IsZero() {
		if container.Resources.Requests == nil {
			container.Resources.Requests = corev1.ResourceList{}
		}
		container.Resources.Requests[corev1.ResourceCPU] = cpu
	}
	if !memory.IsZero() {
		if container.Resources.Requests == nil {
			container.Resources.Requests = corev1.ResourceList{}
		}
		container.Resources.Requests[corev1.ResourceMemory] = memory
	}

	volumes := []corev1.Volume{{
		Name: "ssh-keys",
		VolumeSource: corev1.VolumeSource{
			Secret: &corev1.SecretVolumeSource{SecretName: secretName},
		},
	}}
	if pvc != nil {
		volumes = append(volumes, corev1.Volume{
			Name: "workspace",
			VolumeSource: corev1.VolumeSource{
				PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: pvcName},
			},
		})
		container.VolumeMounts = append(container.VolumeMounts, corev1.VolumeMount{
			Name:      "workspace",
			MountPath: "/workspace",
		})
	} else {
		volumes = append(volumes, corev1.Volume{
			Name:         "workspace",
			VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}},
		})
		container.VolumeMounts = append(container.VolumeMounts, corev1.VolumeMount{
			Name:      "workspace",
			MountPath: "/workspace",
		})
	}

	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      resourceName,
			Namespace: identity.Namespace,
			Labels:    labels,
		},
		Spec: appsv1.StatefulSetSpec{
			Replicas:    &replicas,
			ServiceName: serviceName,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{labelWorkspaceName: identity.Name},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{container},
					Volumes:    volumes,
				},
			},
		},
	}

	sshServicePort := corev1.ServicePort{
		Name:       "ssh",
		Port:       22,
		TargetPort: intstr.FromInt(22),
		Protocol:   corev1.ProtocolTCP,
	}
	if cfg.NodePort != nil {
		sshServicePort.NodePort = *cfg.NodePort
	}
	codeServerServicePort := corev1.ServicePort{
		Name:       "code-server",
		Port:       8080,
		TargetPort: intstr.FromInt(8080),
		Protocol:   corev1.ProtocolTCP,
	}
	if cfg.CodeServerNodePort != nil {
		codeServerServicePort.NodePort = *cfg.CodeServerNodePort
	}
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      serviceName,
			Namespace: identity.Namespace,
			Labels:    labels,
		},
		Spec: corev1.ServiceSpec{
			Type:     cfg.ServiceType,
			Selector: map[string]string{labelWorkspaceName: identity.Name},
			Ports:    []corev1.ServicePort{sshServicePort, codeServerServicePort},
		},
	}

	return WorkspaceResources{
		Secret:      secret,
		PVC:         pvc,
		StatefulSet: sts,
		Service:     svc,
	}, nil
}

func workspaceLabels(identity WorkspaceIdentity) map[string]string {
	return map[string]string{
		labelWorkspaceName: identity.Name,
		labelRunName:       identity.RunName,
		labelProject:       identity.Project,
		labelDomain:        identity.Domain,
		labelOrg:           identity.Org,
		labelActionName:    identity.ActionName,
	}
}

func envVars(values map[string]string) []corev1.EnvVar {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	env := make([]corev1.EnvVar, 0, len(keys))
	for _, key := range keys {
		env = append(env, corev1.EnvVar{Name: key, Value: values[key]})
	}
	return env
}

func kubernetesNameBase(name string) string {
	var builder strings.Builder
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
		case r == '-':
			builder.WriteRune(r)
		default:
			builder.WriteRune('-')
		}
	}

	cleaned := collapseHyphens(strings.Trim(builder.String(), "-"))
	if cleaned == "" {
		cleaned = "workspace"
	}
	if !unicode.IsLetter(rune(cleaned[0])) {
		cleaned = "ssh-" + cleaned
	}
	if len(cleaned) <= maxGeneratedNameBaseLength {
		return cleaned
	}

	hash := shortNameHash(cleaned)
	prefixLength := maxGeneratedNameBaseLength - len(hash) - 1
	return strings.TrimRight(cleaned[:prefixLength], "-") + "-" + hash
}

func collapseHyphens(value string) string {
	var builder strings.Builder
	lastHyphen := false
	for _, r := range value {
		if r == '-' {
			if lastHyphen {
				continue
			}
			lastHyphen = true
		} else {
			lastHyphen = false
		}
		builder.WriteRune(r)
	}
	return builder.String()
}

func shortNameHash(value string) string {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(value))
	return fmt.Sprintf("%08x", hash.Sum32())
}

func workspaceEntrypoint(sshUser string) string {
	return fmt.Sprintf(`set -eu
if ! command -v /usr/sbin/sshd >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y --no-install-recommends openssh-server sudo ca-certificates
  fi
fi
if ! id %[1]s >/dev/null 2>&1; then
  useradd -m -s /bin/bash %[1]s
fi
mkdir -p /home/%[1]s/.ssh /workspace /run/sshd
cp /flyte-ssh/authorized_keys /home/%[1]s/.ssh/authorized_keys
chown -R %[1]s:%[1]s /home/%[1]s /workspace
chmod 700 /home/%[1]s/.ssh
chmod 600 /home/%[1]s/.ssh/authorized_keys
printf 'PasswordAuthentication no\nPermitRootLogin no\nPubkeyAuthentication yes\n' > /etc/ssh/sshd_config.d/flyte-workspace.conf
CODE_SERVER_BIN=""
if command -v code-server >/dev/null 2>&1; then
  CODE_SERVER_BIN="$(command -v code-server)"
elif [ -x /opt/code-server-4.19.0-linux-amd64/bin/code-server ]; then
  CODE_SERVER_BIN="/opt/code-server-4.19.0-linux-amd64/bin/code-server"
elif [ -f /opt/code-server-4.19.0-linux-amd64.tar.gz ]; then
  tar -xzf /opt/code-server-4.19.0-linux-amd64.tar.gz -C /opt
  CODE_SERVER_BIN="/opt/code-server-4.19.0-linux-amd64/bin/code-server"
fi
if [ -n "$CODE_SERVER_BIN" ] && [ -x "$CODE_SERVER_BIN" ]; then
  su - %[1]s -c "PASSWORD='' '$CODE_SERVER_BIN' --bind-addr 0.0.0.0:8080 --auth none /workspace" &
else
  if ! command -v python3 >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y --no-install-recommends python3
  fi
  mkdir -p /tmp/code-server-missing
  printf '%%s\n' '<!doctype html><html><head><meta charset="utf-8"><title>code-server 未安装</title><style>body{font-family:system-ui,sans-serif;margin:40px;color:#111827}h1{font-size:20px}</style></head><body><h1>code-server 未安装</h1><p>当前开发实例镜像中没有安装 code-server，请使用包含 code-server 的镜像重新创建实例。</p></body></html>' > /tmp/code-server-missing/index.html
  if command -v python3 >/dev/null 2>&1; then
    python3 -m http.server 8080 --directory /tmp/code-server-missing &
  fi
fi
exec /usr/sbin/sshd -D -e
`, sshUser)
}
