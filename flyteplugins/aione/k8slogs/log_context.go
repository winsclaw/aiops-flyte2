package k8slogs

import (
	"sort"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/flyteorg/flyte/v2/flyteplugins/go/tasks/pluginmachinery/flytek8s"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/core"
)

type podLogContextCandidate struct {
	phase     corev1.PodPhase
	createdAt metav1.Time
	context   *core.PodLogContext
}

func LogContextFromPods(pods []corev1.Pod) *core.LogContext {
	candidates := make([]podLogContextCandidate, 0, len(pods))
	for i := range pods {
		pod := &pods[i]
		podContext := flytek8s.BuildPodLogContext(pod)
		if !isUsablePodLogContext(podContext) {
			continue
		}
		candidates = append(candidates, podLogContextCandidate{
			phase:     pod.Status.Phase,
			createdAt: pod.CreationTimestamp,
			context:   podContext,
		})
	}
	if len(candidates) == 0 {
		return nil
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		left := candidates[i]
		right := candidates[j]
		if leftPriority, rightPriority := podPhasePriority(left.phase), podPhasePriority(right.phase); leftPriority != rightPriority {
			return leftPriority < rightPriority
		}
		if !left.createdAt.Equal(&right.createdAt) {
			return left.createdAt.Before(&right.createdAt)
		}
		return left.context.GetPodName() < right.context.GetPodName()
	})

	podContexts := make([]*core.PodLogContext, 0, len(candidates))
	for _, candidate := range candidates {
		podContexts = append(podContexts, candidate.context)
	}

	return &core.LogContext{
		Pods:           podContexts,
		PrimaryPodName: podContexts[0].GetPodName(),
	}
}

func isUsablePodLogContext(podContext *core.PodLogContext) bool {
	if podContext.GetNamespace() == "" || podContext.GetPodName() == "" || podContext.GetPrimaryContainerName() == "" {
		return false
	}
	for _, container := range podContext.GetContainers() {
		if container.GetContainerName() == podContext.GetPrimaryContainerName() {
			return true
		}
	}
	return false
}

func podPhasePriority(phase corev1.PodPhase) int {
	switch phase {
	case corev1.PodRunning:
		return 0
	case corev1.PodSucceeded:
		return 1
	case corev1.PodFailed:
		return 2
	default:
		return 3
	}
}
