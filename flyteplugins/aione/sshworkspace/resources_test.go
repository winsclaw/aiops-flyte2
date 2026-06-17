package sshworkspace

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/util/validation"

	idlcore "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/core"
)

func taskTemplateWithCustom(t *testing.T, values map[string]any) *idlcore.TaskTemplate {
	t.Helper()
	custom, err := structpb.NewStruct(values)
	require.NoError(t, err)
	return &idlcore.TaskTemplate{
		Type:   TaskType,
		Custom: custom,
	}
}

func TestParseConfigUsesCustomPayload(t *testing.T) {
	tmpl := taskTemplateWithCustom(t, map[string]any{
		"image":                    "ubuntu:22.04",
		"sshUser":                  "dev",
		"authorizedKeys":           []any{"ssh-rsa AAAA user@example"},
		"cpu":                      "1",
		"memory":                   "2Gi",
		"gpuCount":                 float64(1),
		"gpuModel":                 "NVIDIA T4",
		"workspaceSize":            "20Gi",
		"serviceType":              "NodePort",
		"nodePort":                 float64(30222),
		"codeServerNodePort":       float64(31080),
		"imagePullSecretName":      "workspace-image-pull",
		"codeRepositorySecretName": "workspace-code-repos",
		"gpuNodeLabelKey":          "nvidia.com/gpu.present",
		"environment": map[string]any{
			"EXAMPLE": "value",
		},
		"codeRepositories": []any{map[string]any{
			"id":        "repo-1",
			"repoUrl":   "https://git.fzyun.io/serverless/aione.git",
			"branch":    "main",
			"mountPath": "/workspace/aione",
			"token":     "secret-token",
		}},
	})

	cfg, err := ParseConfig(tmpl)

	require.NoError(t, err)
	assert.Equal(t, "ubuntu:22.04", cfg.Image)
	assert.Equal(t, "dev", cfg.SSHUser)
	assert.Equal(t, []string{"ssh-rsa AAAA user@example"}, cfg.AuthorizedKeys)
	assert.Equal(t, "1", cfg.CPU)
	assert.Equal(t, "2Gi", cfg.Memory)
	assert.Equal(t, int32(1), cfg.GPUCount)
	assert.Equal(t, "NVIDIA T4", cfg.GPUModel)
	assert.Equal(t, "20Gi", cfg.WorkspaceSize)
	assert.Equal(t, "workspace-image-pull", cfg.ImagePullSecretName)
	assert.Equal(t, "workspace-code-repos", cfg.CodeRepositorySecretName)
	assert.Equal(t, "nvidia.com/gpu.present", cfg.GPUNodeLabelKey)
	assert.Equal(t, corev1.ServiceTypeNodePort, cfg.ServiceType)
	require.NotNil(t, cfg.NodePort)
	assert.Equal(t, int32(30222), *cfg.NodePort)
	require.NotNil(t, cfg.CodeServerNodePort)
	assert.Equal(t, int32(31080), *cfg.CodeServerNodePort)
	assert.Equal(t, map[string]string{"EXAMPLE": "value"}, cfg.Environment)
	require.Len(t, cfg.CodeRepositories, 1)
	assert.Equal(t, "repo-1", cfg.CodeRepositories[0].ID)
	assert.Equal(t, "/workspace/aione", cfg.CodeRepositories[0].MountPath)
}

func TestParseConfigDefaultsToOfficialIDEImage(t *testing.T) {
	tmpl := taskTemplateWithCustom(t, map[string]any{
		"sshUser":        "dev",
		"authorizedKeys": []any{"ssh-rsa AAAA user@example"},
	})

	cfg, err := ParseConfig(tmpl)

	require.NoError(t, err)
	assert.Equal(t, "docker.fzyun.io/founder/aione.ide:1.0.0.60", cfg.Image)
}

func TestParseConfigRejectsMissingAuthorizedKeys(t *testing.T) {
	tmpl := taskTemplateWithCustom(t, map[string]any{
		"image":   "ubuntu:22.04",
		"sshUser": "dev",
	})

	_, err := ParseConfig(tmpl)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "authorizedKeys")
}

func TestParseConfigRejectsInvalidServiceType(t *testing.T) {
	tmpl := taskTemplateWithCustom(t, map[string]any{
		"image":          "ubuntu:22.04",
		"sshUser":        "dev",
		"authorizedKeys": []any{"ssh-rsa AAAA user@example"},
		"serviceType":    "ExternalName",
	})

	_, err := ParseConfig(tmpl)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "serviceType")
}

func TestBuildResourcesCreatesSSHWorkspaceObjects(t *testing.T) {
	nodePort := int32(30222)
	codeServerNodePort := int32(31080)
	cfg := WorkspaceConfig{
		Image:              "ubuntu:22.04",
		SSHUser:            "dev",
		AuthorizedKeys:     []string{"ssh-rsa AAAA user@example"},
		CPU:                "1",
		Memory:             "2Gi",
		GPUCount:           1,
		GPUModel:           "NVIDIA T4",
		WorkspaceSize:      "20Gi",
		ServiceType:        corev1.ServiceTypeNodePort,
		NodePort:           &nodePort,
		CodeServerNodePort: &codeServerNodePort,
		Environment:        map[string]string{"EXAMPLE": "value"},
	}
	identity := WorkspaceIdentity{
		Namespace:  "flyte",
		Name:       "run-abc",
		RunName:    "run-abc",
		Project:    "flytesnacks",
		Domain:     "development",
		Org:        "testorg",
		ActionName: "main",
	}

	resources, err := BuildResources(identity, cfg)

	require.NoError(t, err)
	assert.Equal(t, "run-abc-ssh", resources.Secret.Name)
	assert.Equal(t, "flyte", resources.Secret.Namespace)
	assert.Equal(t, "ssh-rsa AAAA user@example\n", string(resources.Secret.Data["authorized_keys"]))
	assert.Equal(t, "run-abc-workspace", resources.PVC.Name)
	assert.Equal(t, "20Gi", resources.PVC.Spec.Resources.Requests.Storage().String())

	sts := resources.StatefulSet
	require.IsType(t, &appsv1.StatefulSet{}, sts)
	assert.Equal(t, "run-abc", sts.Name)
	assert.Equal(t, int32(1), *sts.Spec.Replicas)
	require.Len(t, sts.Spec.Template.Spec.Containers, 1)
	container := sts.Spec.Template.Spec.Containers[0]
	assert.Equal(t, "ssh", container.Name)
	assert.Equal(t, "ubuntu:22.04", container.Image)
	assert.Contains(t, container.Command, "/bin/sh")
	assert.Contains(t, container.Args[0], "/usr/sbin/sshd -D -e")
	assert.Contains(t, container.Args[0], "code-server")
	assert.Contains(t, container.Args[0], "useradd")
	assert.Equal(t, "value", envValue(container.Env, "EXAMPLE"))
	gpuLimit := container.Resources.Limits[corev1.ResourceName("nvidia.com/gpu")]
	assert.Equal(t, "1", gpuLimit.String())
	assert.Equal(t, "NVIDIA-T4", sts.Labels[labelGPUModel])
	assert.Equal(t, "NVIDIA T4", sts.Annotations[annotationGPUModel])
	require.Len(t, container.Ports, 2)
	assert.Equal(t, int32(22), container.Ports[0].ContainerPort)
	assert.Equal(t, int32(8080), container.Ports[1].ContainerPort)
	assert.Equal(t, "code-server", container.Ports[1].Name)

	svc := resources.Service
	assert.Equal(t, "run-abc-ssh", svc.Name)
	assert.Equal(t, corev1.ServiceTypeNodePort, svc.Spec.Type)
	require.Len(t, svc.Spec.Ports, 2)
	assert.Equal(t, int32(22), svc.Spec.Ports[0].Port)
	assert.Equal(t, int32(30222), svc.Spec.Ports[0].NodePort)
	assert.Equal(t, "code-server", svc.Spec.Ports[1].Name)
	assert.Equal(t, int32(8080), svc.Spec.Ports[1].Port)
	assert.Equal(t, int32(31080), svc.Spec.Ports[1].NodePort)
	assert.Equal(t, "run-abc", svc.Spec.Selector[labelWorkspaceName])
}

func TestBuildResourcesUsesExternalSecretsAndGPUNodeLabel(t *testing.T) {
	cfg := WorkspaceConfig{
		Image:                    "docker.fzyun.io/founder/aione.ide:1.0.0.60",
		ImagePullSecretName:      "workspace-image-pull",
		CodeRepositorySecretName: "workspace-code-repos",
		GPUNodeLabelKey:          "nvidia.com/gpu.present",
		SSHUser:                  "dev",
		AuthorizedKeys:           []string{"ssh-rsa AAAA user@example"},
		ServiceType:              corev1.ServiceTypeClusterIP,
		CodeRepositories: []CodeRepositoryMount{{
			ID:        "repo-1",
			RepoURL:   "https://git.fzyun.io/serverless/aione.git",
			Branch:    "main",
			MountPath: "/workspace/aione",
		}},
	}
	identity := WorkspaceIdentity{
		Namespace:  "flyte",
		Name:       "run-abc",
		RunName:    "run-abc",
		Project:    "flytesnacks",
		Domain:     "development",
		Org:        "aione",
		ActionName: "main",
	}

	resources, err := BuildResources(identity, cfg)

	require.NoError(t, err)
	assert.NotContains(t, resources.Secret.Data, "code_repositories")
	podSpec := resources.StatefulSet.Spec.Template.Spec
	require.Len(t, podSpec.ImagePullSecrets, 1)
	assert.Equal(t, "workspace-image-pull", podSpec.ImagePullSecrets[0].Name)
	require.NotNil(t, podSpec.Affinity)
	require.NotNil(t, podSpec.Affinity.NodeAffinity)
	terms := podSpec.Affinity.NodeAffinity.RequiredDuringSchedulingIgnoredDuringExecution.NodeSelectorTerms
	require.Len(t, terms, 1)
	require.Len(t, terms[0].MatchExpressions, 1)
	assert.Equal(t, "nvidia.com/gpu.present", terms[0].MatchExpressions[0].Key)
	assert.Equal(t, corev1.NodeSelectorOpExists, terms[0].MatchExpressions[0].Operator)
	container := podSpec.Containers[0]
	require.Len(t, container.Env, 1)
	assert.Equal(t, "AIONE_CODE_REPOSITORIES", container.Env[0].Name)
	assert.Equal(t, "workspace-code-repos", container.Env[0].ValueFrom.SecretKeyRef.Name)
}

func TestBuildResourcesAddsCloudStoragePVCMounts(t *testing.T) {
	cfg := WorkspaceConfig{
		Image:          "ubuntu:22.04",
		SSHUser:        "dev",
		AuthorizedKeys: []string{"ssh-rsa AAAA user@example"},
		ServiceType:    corev1.ServiceTypeClusterIP,
		CloudStorageMounts: []CloudStorageMount{{
			ID:           "storage-1",
			PVCName:      "storage-1-flyte",
			StorageClass: "bj1-ebs",
			Size:         "100Gi",
			MountPath:    "/mnt/cloud/dataset",
		}},
	}
	identity := WorkspaceIdentity{
		Namespace:  "flyte",
		Name:       "run-abc",
		RunName:    "run-abc",
		Project:    "flytesnacks",
		Domain:     "development",
		Org:        "testorg",
		ActionName: "main",
	}

	resources, err := BuildResources(identity, cfg)

	require.NoError(t, err)
	require.Len(t, resources.CloudStoragePVCs, 1)
	pvc := resources.CloudStoragePVCs[0]
	assert.Equal(t, "storage-1-flyte", pvc.Name)
	assert.Equal(t, "flyte", pvc.Namespace)
	require.NotNil(t, pvc.Spec.StorageClassName)
	assert.Equal(t, "bj1-ebs", *pvc.Spec.StorageClassName)
	assert.Equal(t, "100Gi", pvc.Spec.Resources.Requests.Storage().String())
	assert.Equal(t, "storage-1", pvc.Labels["flyte.org/cloud-storage-id"])

	podSpec := resources.StatefulSet.Spec.Template.Spec
	assert.True(t, hasPVCVolume(podSpec.Volumes, "cloud-storage-0", "storage-1-flyte"))
	container := podSpec.Containers[0]
	assert.True(t, hasVolumeMount(container.VolumeMounts, "cloud-storage-0", "/mnt/cloud/dataset"))
}

func TestBuildResourcesAddsCodeRepositoryDownloader(t *testing.T) {
	cfg := WorkspaceConfig{
		Image:          "ubuntu:22.04",
		SSHUser:        "dev",
		AuthorizedKeys: []string{"ssh-rsa AAAA user@example"},
		ServiceType:    corev1.ServiceTypeClusterIP,
		CodeRepositories: []CodeRepositoryMount{{
			ID:        "repo-1",
			RepoURL:   "https://git.fzyun.io/serverless/aione.git",
			Branch:    "main",
			MountPath: "/workspace/aione",
			Token:     "secret-token",
		}},
	}
	identity := WorkspaceIdentity{
		Namespace:  "flyte",
		Name:       "run-abc",
		RunName:    "run-abc",
		Project:    "flytesnacks",
		Domain:     "development",
		Org:        "testorg",
		ActionName: "main",
	}

	resources, err := BuildResources(identity, cfg)

	require.NoError(t, err)
	assert.Contains(t, string(resources.Secret.Data["code_repositories"]), "secret-token")
	container := resources.StatefulSet.Spec.Template.Spec.Containers[0]
	assert.Equal(t, "AIONE_CODE_REPOSITORIES", envName(container.Env, "AIONE_CODE_REPOSITORIES"))
	assert.Contains(t, container.Args[0], "download GitLab archive repositories")
}

func TestBuildResourcesUsesValidKubernetesNamesWhenRunStartsWithDigit(t *testing.T) {
	nodePort := int32(30222)
	cfg := WorkspaceConfig{
		Image:          "ubuntu:22.04",
		SSHUser:        "dev",
		AuthorizedKeys: []string{"ssh-rsa AAAA user@example"},
		WorkspaceSize:  "20Gi",
		ServiceType:    corev1.ServiceTypeNodePort,
		NodePort:       &nodePort,
	}
	identity := WorkspaceIdentity{
		Namespace:  "flyte",
		Name:       "1111-a0-0",
		RunName:    "1111",
		Project:    "flytesnacks",
		Domain:     "development",
		Org:        "testorg",
		ActionName: "a0",
	}

	resources, err := BuildResources(identity, cfg)

	require.NoError(t, err)
	assert.Empty(t, validation.IsDNS1035Label(resources.Service.Name))
	assert.Empty(t, validation.IsDNS1123Subdomain(resources.StatefulSet.Name))
	assert.Empty(t, validation.IsDNS1123Subdomain(resources.Secret.Name))
	assert.Empty(t, validation.IsDNS1123Subdomain(resources.PVC.Name))
	assert.Equal(t, "1111-a0-0", resources.Service.Spec.Selector[labelWorkspaceName])
	assert.Equal(t, "1111-a0-0", resources.StatefulSet.Spec.Selector.MatchLabels[labelWorkspaceName])
	assert.Equal(t, "1111-a0-0", resources.StatefulSet.Spec.Template.Labels[labelWorkspaceName])
}

func hasPVCVolume(volumes []corev1.Volume, name, claimName string) bool {
	for _, volume := range volumes {
		if volume.Name == name && volume.PersistentVolumeClaim != nil && volume.PersistentVolumeClaim.ClaimName == claimName {
			return true
		}
	}
	return false
}

func hasVolumeMount(mounts []corev1.VolumeMount, name, mountPath string) bool {
	for _, mount := range mounts {
		if mount.Name == name && mount.MountPath == mountPath {
			return true
		}
	}
	return false
}

func envValue(env []corev1.EnvVar, name string) string {
	for _, e := range env {
		if e.Name == name {
			return e.Value
		}
	}
	return ""
}

func envName(env []corev1.EnvVar, name string) string {
	for _, e := range env {
		if e.Name == name {
			return e.Name
		}
	}
	return ""
}
