package trainingtask

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"

	idlcore "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/core"
	"google.golang.org/protobuf/types/known/structpb"
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

func TestParseConfigUsesTrainingTaskPayload(t *testing.T) {
	tmpl := taskTemplateWithCustom(t, map[string]any{
		"image":           "busybox:1.36",
		"command":         "echo hello",
		"cpu":             "8",
		"memory":          "16Gi",
		"gpuCount":        float64(1),
		"gpuModel":        "NVIDIA T4",
		"bandwidth":       "1Gbps",
		"maxRuntimeHours": float64(2),
	})

	cfg, err := ParseConfig(tmpl)

	require.NoError(t, err)
	assert.Equal(t, "busybox:1.36", cfg.Image)
	assert.Equal(t, "echo hello", cfg.Command)
	assert.Equal(t, "8", cfg.CPU)
	assert.Equal(t, "16Gi", cfg.Memory)
	assert.Equal(t, int32(1), cfg.GPUCount)
	assert.Equal(t, "NVIDIA T4", cfg.GPUModel)
	assert.Equal(t, "1Gbps", cfg.Bandwidth)
	assert.Equal(t, int32(2), cfg.MaxRuntimeHours)
}

func TestParseConfigRejectsMissingCommand(t *testing.T) {
	tmpl := taskTemplateWithCustom(t, map[string]any{
		"image": "busybox:1.36",
	})

	_, err := ParseConfig(tmpl)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "command")
}

func TestBuildResourcesCreatesTrainingJob(t *testing.T) {
	cfg := TrainingConfig{
		Image:           "busybox:1.36",
		Command:         "echo hello",
		CPU:             "8",
		Memory:          "16Gi",
		GPUCount:        1,
		GPUModel:        "NVIDIA T4",
		Bandwidth:       "1Gbps",
		MaxRuntimeHours: 2,
	}
	identity := TrainingIdentity{
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
	require.NotNil(t, resources.Job)
	assert.Equal(t, "run-abc", resources.Job.Name)
	assert.Equal(t, "flyte", resources.Job.Namespace)
	require.NotNil(t, resources.Job.Spec.ActiveDeadlineSeconds)
	assert.Equal(t, int64(7200), *resources.Job.Spec.ActiveDeadlineSeconds)
	require.NotNil(t, resources.Job.Spec.BackoffLimit)
	assert.Equal(t, int32(0), *resources.Job.Spec.BackoffLimit)

	podSpec := resources.Job.Spec.Template.Spec
	assert.Equal(t, corev1.RestartPolicyNever, podSpec.RestartPolicy)
	require.Len(t, podSpec.Containers, 1)
	container := podSpec.Containers[0]
	assert.Equal(t, "training", container.Name)
	assert.Equal(t, "busybox:1.36", container.Image)
	assert.Equal(t, []string{"/bin/sh", "-c"}, container.Command)
	assert.Equal(t, []string{"echo hello"}, container.Args)
	assert.Equal(t, "8", container.Resources.Requests.Cpu().String())
	assert.Equal(t, "16Gi", container.Resources.Requests.Memory().String())
	gpuLimit := container.Resources.Limits[corev1.ResourceName("nvidia.com/gpu")]
	assert.Equal(t, "1", gpuLimit.String())
	assert.Equal(t, "NVIDIA-T4", resources.Job.Labels[labelGPUModel])
	assert.Equal(t, "NVIDIA T4", resources.Job.Annotations[annotationGPUModel])
	assert.Equal(t, "1Gbps", resources.Job.Annotations[annotationBandwidth])
}
