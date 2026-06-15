package trainingtask

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	pluginsCore "github.com/flyteorg/flyte/v2/flyteplugins/go/tasks/pluginmachinery/core"
	coreMocks "github.com/flyteorg/flyte/v2/flyteplugins/go/tasks/pluginmachinery/core/mocks"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/core"
)

func TestPluginHandleCreatesTrainingJob(t *testing.T) {
	ctx := context.Background()
	k8sClient := newFakeClient(t)
	plugin := NewPlugin(k8sClient)
	tCtx := trainingTaskContext(t, validTrainingTemplate(t), "run-abc")

	transition, err := plugin.Handle(ctx, tCtx)

	require.NoError(t, err)
	assert.Equal(t, pluginsCore.PhaseQueued, transition.Info().Phase())

	var job batchv1.Job
	require.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc"}, &job))
	assert.Equal(t, "busybox:1.36", job.Spec.Template.Spec.Containers[0].Image)
}

func TestPluginHandleReturnsSuccessWhenJobSucceeded(t *testing.T) {
	ctx := context.Background()
	k8sClient := newFakeClient(t)
	plugin := NewPlugin(k8sClient)
	tCtx := trainingTaskContext(t, validTrainingTemplate(t), "run-abc")

	_, err := plugin.Handle(ctx, tCtx)
	require.NoError(t, err)

	var job batchv1.Job
	require.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc"}, &job))
	job.Status.Succeeded = 1
	require.NoError(t, k8sClient.Status().Update(ctx, &job))

	transition, err := plugin.Handle(ctx, tCtx)

	require.NoError(t, err)
	assert.Equal(t, pluginsCore.PhaseSuccess, transition.Info().Phase())
}

func TestPluginAbortDeletesTrainingJob(t *testing.T) {
	ctx := context.Background()
	k8sClient := newFakeClient(t)
	plugin := NewPlugin(k8sClient)
	tCtx := trainingTaskContext(t, validTrainingTemplate(t), "run-abc")

	_, err := plugin.Handle(ctx, tCtx)
	require.NoError(t, err)

	require.NoError(t, plugin.Abort(ctx, tCtx))

	var job batchv1.Job
	assert.Error(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc"}, &job))
}

func validTrainingTemplate(t *testing.T) *core.TaskTemplate {
	return taskTemplateWithCustom(t, map[string]any{
		"image":           "busybox:1.36",
		"command":         "echo hello",
		"cpu":             "1",
		"memory":          "128Mi",
		"maxRuntimeHours": float64(1),
	})
}

func trainingTaskContext(t *testing.T, tmpl *core.TaskTemplate, generatedName string) pluginsCore.TaskExecutionContext {
	t.Helper()
	taskReader := &coreMocks.TaskReader{}
	taskReader.EXPECT().Read(mock.Anything).Return(tmpl, nil)

	taskID := &coreMocks.TaskExecutionID{}
	taskID.EXPECT().GetGeneratedName().Return(generatedName)
	taskID.EXPECT().GetID().Return(&core.TaskExecutionIdentifier{
		NodeExecutionId: &core.NodeExecutionIdentifier{
			NodeId: "main",
			ExecutionId: &core.WorkflowExecutionIdentifier{
				Project: "flytesnacks",
				Domain:  "development",
				Name:    generatedName,
				Org:     "testorg",
			},
		},
	})

	meta := &coreMocks.TaskExecutionMetadata{}
	meta.EXPECT().GetNamespace().Return("flyte")
	meta.EXPECT().GetTaskExecutionID().Return(taskID)

	tCtx := &coreMocks.TaskExecutionContext{}
	tCtx.EXPECT().TaskReader().Return(taskReader)
	tCtx.EXPECT().TaskExecutionMetadata().Return(meta)
	return tCtx
}

func newFakeClient(t *testing.T) client.Client {
	t.Helper()
	scheme := runtime.NewScheme()
	require.NoError(t, corev1.AddToScheme(scheme))
	require.NoError(t, batchv1.AddToScheme(scheme))
	return fake.NewClientBuilder().WithScheme(scheme).Build()
}

func failedJobCondition() []batchv1.JobCondition {
	return []batchv1.JobCondition{{
		Type:          batchv1.JobFailed,
		Status:        corev1.ConditionTrue,
		Reason:        "BackoffLimitExceeded",
		Message:       "failed",
		LastProbeTime: metav1.Now(),
	}}
}
