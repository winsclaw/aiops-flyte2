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
		"image":          "ubuntu:22.04",
		"sshUser":        "dev",
		"authorizedKeys": []any{"ssh-rsa AAAA user@example"},
		"cpu":            "1",
		"memory":         "2Gi",
		"workspaceSize":  "20Gi",
		"serviceType":    "NodePort",
		"nodePort":       float64(30222),
		"environment": map[string]any{
			"EXAMPLE": "value",
		},
	})

	cfg, err := ParseConfig(tmpl)

	require.NoError(t, err)
	assert.Equal(t, "ubuntu:22.04", cfg.Image)
	assert.Equal(t, "dev", cfg.SSHUser)
	assert.Equal(t, []string{"ssh-rsa AAAA user@example"}, cfg.AuthorizedKeys)
	assert.Equal(t, "1", cfg.CPU)
	assert.Equal(t, "2Gi", cfg.Memory)
	assert.Equal(t, "20Gi", cfg.WorkspaceSize)
	assert.Equal(t, corev1.ServiceTypeNodePort, cfg.ServiceType)
	require.NotNil(t, cfg.NodePort)
	assert.Equal(t, int32(30222), *cfg.NodePort)
	assert.Equal(t, map[string]string{"EXAMPLE": "value"}, cfg.Environment)
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
	cfg := WorkspaceConfig{
		Image:          "ubuntu:22.04",
		SSHUser:        "dev",
		AuthorizedKeys: []string{"ssh-rsa AAAA user@example"},
		CPU:            "1",
		Memory:         "2Gi",
		WorkspaceSize:  "20Gi",
		ServiceType:    corev1.ServiceTypeNodePort,
		NodePort:       &nodePort,
		Environment:    map[string]string{"EXAMPLE": "value"},
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
	assert.Contains(t, container.Args[0], "useradd")
	assert.Equal(t, "value", envValue(container.Env, "EXAMPLE"))
	require.Len(t, container.Ports, 1)
	assert.Equal(t, int32(22), container.Ports[0].ContainerPort)

	svc := resources.Service
	assert.Equal(t, "run-abc-ssh", svc.Name)
	assert.Equal(t, corev1.ServiceTypeNodePort, svc.Spec.Type)
	require.Len(t, svc.Spec.Ports, 1)
	assert.Equal(t, int32(22), svc.Spec.Ports[0].Port)
	assert.Equal(t, int32(30222), svc.Spec.Ports[0].NodePort)
	assert.Equal(t, "run-abc", svc.Spec.Selector[labelWorkspaceName])
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

func envValue(env []corev1.EnvVar, name string) string {
	for _, e := range env {
		if e.Name == name {
			return e.Value
		}
	}
	return ""
}
