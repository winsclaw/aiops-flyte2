package sshworkspace

import (
	"fmt"
	"sort"
	"strings"

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
	secretName := identity.Name + "-ssh"
	pvcName := identity.Name + "-workspace"
	serviceName := identity.Name + "-ssh"

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
			Name:      identity.Name,
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

	servicePort := corev1.ServicePort{
		Name:       "ssh",
		Port:       22,
		TargetPort: intstr.FromInt(22),
		Protocol:   corev1.ProtocolTCP,
	}
	if cfg.NodePort != nil {
		servicePort.NodePort = *cfg.NodePort
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
			Ports:    []corev1.ServicePort{servicePort},
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
exec /usr/sbin/sshd -D -e
`, sshUser)
}
