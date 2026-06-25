package k8slogs

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestLogContextFromPodsReturnsNilWithoutUsablePrimaryContainer(t *testing.T) {
	tests := []struct {
		name string
		pods []corev1.Pod
	}{
		{
			name: "no pods",
		},
		{
			name: "pod has no container status",
			pods: []corev1.Pod{{
				ObjectMeta: metav1.ObjectMeta{Name: "run-abc-pod", Namespace: "flyte"},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{Name: "training"}},
				},
				Status: corev1.PodStatus{Phase: corev1.PodRunning},
			}},
		},
		{
			name: "primary container missing from status",
			pods: []corev1.Pod{{
				ObjectMeta: metav1.ObjectMeta{Name: "run-abc-pod", Namespace: "flyte"},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{Name: "training"}},
				},
				Status: corev1.PodStatus{
					Phase: corev1.PodRunning,
					ContainerStatuses: []corev1.ContainerStatus{{
						Name:  "sidecar",
						State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}},
					}},
				},
			}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Nil(t, LogContextFromPods(tt.pods))
		})
	}
}

func TestLogContextFromPodsReturnsRunningContainerContext(t *testing.T) {
	startedAt := metav1.NewTime(time.Date(2026, 6, 25, 10, 0, 0, 0, time.UTC))
	pods := []corev1.Pod{{
		ObjectMeta: metav1.ObjectMeta{Name: "run-abc-pod", Namespace: "flyte"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "training"}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{
				Name: "training",
				State: corev1.ContainerState{
					Running: &corev1.ContainerStateRunning{StartedAt: startedAt},
				},
			}},
		},
	}}

	logContext := LogContextFromPods(pods)

	require.NotNil(t, logContext)
	assert.Equal(t, "run-abc-pod", logContext.GetPrimaryPodName())
	require.Len(t, logContext.GetPods(), 1)
	podContext := logContext.GetPods()[0]
	assert.Equal(t, "flyte", podContext.GetNamespace())
	assert.Equal(t, "run-abc-pod", podContext.GetPodName())
	assert.Equal(t, "training", podContext.GetPrimaryContainerName())
	require.Len(t, podContext.GetContainers(), 1)
	assert.Equal(t, "training", podContext.GetContainers()[0].GetContainerName())
	require.NotNil(t, podContext.GetContainers()[0].GetProcess())
	assert.NotNil(t, podContext.GetContainers()[0].GetProcess().GetContainerStartTime())
}

func TestLogContextFromPodsSelectsPrimaryPodDeterministically(t *testing.T) {
	pods := []corev1.Pod{
		logContextTestPod("run-abc-succeeded", corev1.PodSucceeded, "training"),
		logContextTestPod("run-abc-running-b", corev1.PodRunning, "training"),
		logContextTestPod("run-abc-running-a", corev1.PodRunning, "training"),
	}

	logContext := LogContextFromPods(pods)

	require.NotNil(t, logContext)
	assert.Equal(t, "run-abc-running-a", logContext.GetPrimaryPodName())
	require.Len(t, logContext.GetPods(), 3)
	assert.Equal(t, "run-abc-running-a", logContext.GetPods()[0].GetPodName())
	assert.Equal(t, "run-abc-running-b", logContext.GetPods()[1].GetPodName())
	assert.Equal(t, "run-abc-succeeded", logContext.GetPods()[2].GetPodName())
}

func logContextTestPod(name string, phase corev1.PodPhase, containerName string) corev1.Pod {
	return corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "flyte"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: containerName}},
		},
		Status: corev1.PodStatus{
			Phase: phase,
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:  containerName,
				State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}},
			}},
		},
	}
}
