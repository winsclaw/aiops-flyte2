package sshworkspace

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	pluginsCore "github.com/flyteorg/flyte/v2/flyteplugins/go/tasks/pluginmachinery/core"
	coreMocks "github.com/flyteorg/flyte/v2/flyteplugins/go/tasks/pluginmachinery/core/mocks"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/core"
)

func TestPluginHandleCreatesWorkspaceResources(t *testing.T) {
	ctx := context.Background()
	k8sClient := newFakeClient(t)
	plugin := NewPlugin(k8sClient, true)
	tCtx := workspaceTaskContext(t, validWorkspaceTemplate(t), "run-abc")

	transition, err := plugin.Handle(ctx, tCtx)

	require.NoError(t, err)
	assert.Equal(t, pluginsCore.PhaseQueued, transition.Info().Phase())

	var secret corev1.Secret
	require.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc-ssh"}, &secret))
	assert.Equal(t, "ssh-rsa AAAA user@example\n", string(secret.Data["authorized_keys"]))

	var sts appsv1.StatefulSet
	require.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc"}, &sts))
	assert.Equal(t, int32(1), *sts.Spec.Replicas)

	var svc corev1.Service
	require.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc-ssh"}, &svc))
	assert.Equal(t, corev1.ServiceTypeNodePort, svc.Spec.Type)
	require.Len(t, svc.Spec.Ports, 1)
	assert.Equal(t, int32(22), svc.Spec.Ports[0].Port)

	var codeSvc corev1.Service
	require.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc-code"}, &codeSvc))
	assert.Equal(t, corev1.ServiceTypeClusterIP, codeSvc.Spec.Type)
	require.Len(t, codeSvc.Spec.Ports, 1)
	assert.Equal(t, int32(8080), codeSvc.Spec.Ports[0].Port)
}

func TestPluginHandleReturnsRunningWhenStatefulSetReady(t *testing.T) {
	ctx := context.Background()
	k8sClient := newFakeClient(t)
	plugin := NewPlugin(k8sClient, true)
	tCtx := workspaceTaskContext(t, validWorkspaceTemplate(t), "run-abc")

	_, err := plugin.Handle(ctx, tCtx)
	require.NoError(t, err)

	var sts appsv1.StatefulSet
	require.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc"}, &sts))
	sts.Status.ReadyReplicas = 1
	sts.Status.Replicas = 1
	require.NoError(t, k8sClient.Status().Update(ctx, &sts))
	createWorkspacePod(t, ctx, k8sClient, "run-abc-0", sts.Spec.Template.Labels, corev1.PodRunning, corev1.ContainerState{
		Running: &corev1.ContainerStateRunning{},
	})

	transition, err := plugin.Handle(ctx, tCtx)

	require.NoError(t, err)
	assert.Equal(t, pluginsCore.PhaseRunning, transition.Info().Phase())
	assert.Equal(t, pluginsCore.DefaultPhaseVersion+1, transition.Info().Version())
	assert.Contains(t, transition.Info().Reason(), "development workspace is ready")
	assertWorkspaceLogContext(t, transition.Info().Info(), "run-abc-0")
}

func TestPluginHandleReturnsInitializingWithLogContextWhenWorkspacePodExists(t *testing.T) {
	ctx := context.Background()
	k8sClient := newFakeClient(t)
	plugin := NewPlugin(k8sClient, true)
	tCtx := workspaceTaskContext(t, validWorkspaceTemplate(t), "run-abc")

	_, err := plugin.Handle(ctx, tCtx)
	require.NoError(t, err)

	var sts appsv1.StatefulSet
	require.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc"}, &sts))
	sts.Status.Replicas = 1
	require.NoError(t, k8sClient.Status().Update(ctx, &sts))
	createWorkspacePod(t, ctx, k8sClient, "run-abc-0", sts.Spec.Template.Labels, corev1.PodRunning, corev1.ContainerState{
		Running: &corev1.ContainerStateRunning{},
	})

	transition, err := plugin.Handle(ctx, tCtx)

	require.NoError(t, err)
	assert.Equal(t, pluginsCore.PhaseInitializing, transition.Info().Phase())
	assertWorkspaceLogContext(t, transition.Info().Info(), "run-abc-0")
}

func TestPluginHandleInvalidConfigReturnsPermanentFailure(t *testing.T) {
	ctx := context.Background()
	k8sClient := newFakeClient(t)
	plugin := NewPlugin(k8sClient, true)
	tCtx := workspaceTaskContext(t, taskTemplateWithCustom(t, map[string]any{
		"image":     "ubuntu:22.04",
		"enableSsh": true,
		"sshUser":   "dev",
	}), "run-abc")

	transition, err := plugin.Handle(ctx, tCtx)

	require.NoError(t, err)
	assert.Equal(t, pluginsCore.PhasePermanentFailure, transition.Info().Phase())
	assert.Contains(t, transition.Info().Err().GetMessage(), "authorizedKeys")
}

func TestPluginAbortDeletesWorkloadAndServiceButRetainsPVC(t *testing.T) {
	ctx := context.Background()
	k8sClient := newFakeClient(t)
	plugin := NewPlugin(k8sClient, true)
	tCtx := workspaceTaskContext(t, validWorkspaceTemplate(t), "run-abc")

	_, err := plugin.Handle(ctx, tCtx)
	require.NoError(t, err)

	ingress := &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "run-abc-ssh",
			Namespace: "flyte",
			Labels: map[string]string{
				labelWorkspaceName: "run-abc",
				labelRunName:       "run-abc",
				labelProject:       "flytesnacks",
				labelDomain:        "development",
				labelOrg:           "testorg",
				labelActionName:    "main",
			},
		},
	}
	require.NoError(t, k8sClient.Create(ctx, ingress))

	require.NoError(t, plugin.Abort(ctx, tCtx))

	var sts appsv1.StatefulSet
	assert.Error(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc"}, &sts))
	var svc corev1.Service
	assert.Error(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc-ssh"}, &svc))
	var codeSvc corev1.Service
	assert.Error(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc-code"}, &codeSvc))
	var deletedIngress networkingv1.Ingress
	assert.Error(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc-ssh"}, &deletedIngress))
	var pvc corev1.PersistentVolumeClaim
	assert.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc-workspace"}, &pvc))
}

func validWorkspaceTemplate(t *testing.T) *core.TaskTemplate {
	return taskTemplateWithCustom(t, map[string]any{
		"image":          "ubuntu:22.04",
		"enableSsh":      true,
		"sshUser":        "dev",
		"authorizedKeys": []any{"ssh-rsa AAAA user@example"},
		"workspaceSize":  "20Gi",
		"serviceType":    "NodePort",
		"nodePort":       float64(30222),
	})
}

func workspaceTaskContext(t *testing.T, tmpl *core.TaskTemplate, generatedName string) pluginsCore.TaskExecutionContext {
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
	require.NoError(t, appsv1.AddToScheme(scheme))
	require.NoError(t, networkingv1.AddToScheme(scheme))
	return fake.NewClientBuilder().WithScheme(scheme).Build()
}

func createWorkspacePod(
	t *testing.T,
	ctx context.Context,
	k8sClient client.Client,
	name string,
	labels map[string]string,
	phase corev1.PodPhase,
	state corev1.ContainerState,
) {
	t.Helper()
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: "flyte",
			Labels:    labels,
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "ssh"}},
		},
		Status: corev1.PodStatus{
			Phase: phase,
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:  "ssh",
				State: state,
			}},
		},
	}
	require.NoError(t, k8sClient.Create(ctx, pod))
}

func assertWorkspaceLogContext(t *testing.T, info *pluginsCore.TaskInfo, podName string) {
	t.Helper()
	require.NotNil(t, info)
	require.NotNil(t, info.LogContext)
	assert.Equal(t, podName, info.LogContext.GetPrimaryPodName())
	require.Len(t, info.LogContext.GetPods(), 1)
	podContext := info.LogContext.GetPods()[0]
	assert.Equal(t, podName, podContext.GetPodName())
	assert.Equal(t, "ssh", podContext.GetPrimaryContainerName())
	require.Len(t, podContext.GetContainers(), 1)
	assert.Equal(t, "ssh", podContext.GetContainers()[0].GetContainerName())
}
