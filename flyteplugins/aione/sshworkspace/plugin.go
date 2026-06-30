package sshworkspace

import (
	"context"
	"fmt"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/flyteorg/flyte/v2/flyteplugins/aione/k8slogs"
	"github.com/flyteorg/flyte/v2/flyteplugins/go/tasks/pluginmachinery"
	pluginsCore "github.com/flyteorg/flyte/v2/flyteplugins/go/tasks/pluginmachinery/core"
)

type Plugin struct {
	kubeClient client.Client
	retainPVC  bool
}

func NewPlugin(kubeClient client.Client, retainPVC bool) *Plugin {
	return &Plugin{kubeClient: kubeClient, retainPVC: retainPVC}
}

func (p *Plugin) GetID() string {
	return TaskType
}

func (p *Plugin) GetProperties() pluginsCore.PluginProperties {
	return pluginsCore.PluginProperties{
		DisableNodeLevelCaching: true,
	}
}

func (p *Plugin) Handle(ctx context.Context, tCtx pluginsCore.TaskExecutionContext) (pluginsCore.Transition, error) {
	taskTemplate, err := tCtx.TaskReader().Read(ctx)
	if err != nil {
		return pluginsCore.UnknownTransition, err
	}
	cfg, err := ParseConfig(taskTemplate)
	if err != nil {
		return pluginsCore.DoTransition(pluginsCore.PhaseInfoFailure("BadTaskSpecification", err.Error(), nil)), nil
	}

	identity := workspaceIdentityFromMetadata(tCtx.TaskExecutionMetadata())
	resources, err := BuildResources(identity, cfg)
	if err != nil {
		return pluginsCore.DoTransition(pluginsCore.PhaseInfoFailure("BadTaskSpecification", err.Error(), nil)), nil
	}

	created, err := p.ensureResources(ctx, resources)
	if err != nil {
		return pluginsCore.UnknownTransition, err
	}
	if created {
		return pluginsCore.DoTransition(pluginsCore.PhaseInfoQueued(time.Now(), pluginsCore.DefaultPhaseVersion, "development workspace submitted to Kubernetes")), nil
	}

	var sts appsv1.StatefulSet
	if err := p.kubeClient.Get(ctx, client.ObjectKeyFromObject(resources.StatefulSet), &sts); err != nil {
		if apierrors.IsNotFound(err) {
			return pluginsCore.DoTransition(pluginsCore.PhaseInfoSystemRetryableFailure("WorkspaceMissing", "development workspace StatefulSet was deleted", nil)), nil
		}
		return pluginsCore.UnknownTransition, err
	}
	pods, err := p.workspacePods(ctx, &sts)
	if err != nil {
		return pluginsCore.UnknownTransition, err
	}
	taskInfo := taskInfoForPods(pods.Items)

	if sts.Status.ReadyReplicas >= 1 {
		version := pluginsCore.DefaultPhaseVersion
		if taskInfo != nil && taskInfo.LogContext != nil {
			version++
		}
		info := pluginsCore.PhaseInfoRunning(version, taskInfo)
		info.WithReason("development workspace is ready")
		return pluginsCore.DoTransition(info), nil
	}

	return pluginsCore.DoTransition(pluginsCore.PhaseInfoInitializing(time.Now(), pluginsCore.DefaultPhaseVersion, "waiting for development workspace pod readiness", taskInfo)), nil
}

func (p *Plugin) Abort(ctx context.Context, tCtx pluginsCore.TaskExecutionContext) error {
	taskTemplate, err := tCtx.TaskReader().Read(ctx)
	if err != nil {
		return err
	}
	cfg, err := ParseConfig(taskTemplate)
	if err != nil {
		return nil
	}
	identity := workspaceIdentityFromMetadata(tCtx.TaskExecutionMetadata())
	resources, err := BuildResources(identity, cfg)
	if err != nil {
		return nil
	}

	if err := ignoreNotFound(p.kubeClient.Delete(ctx, resources.StatefulSet)); err != nil {
		return err
	}
	if err := ignoreNotFound(p.kubeClient.Delete(ctx, resources.CodeServerService)); err != nil {
		return err
	}
	if resources.SSHService != nil {
		if err := ignoreNotFound(p.kubeClient.Delete(ctx, resources.SSHService)); err != nil {
			return err
		}
	} else if err := p.deleteLegacyCombinedService(ctx, resources.StatefulSet.Namespace, kubernetesNameBase(identity.Name)+"-ssh"); err != nil {
		return err
	}
	if resources.Secret != nil {
		if err := ignoreNotFound(p.kubeClient.Delete(ctx, resources.Secret)); err != nil {
			return err
		}
	}
	for _, secret := range []*corev1.Secret{resources.CodeDownloaderSecret, resources.DatasetDownloaderSecret} {
		if secret == nil {
			continue
		}
		if err := ignoreNotFound(p.kubeClient.Delete(ctx, secret)); err != nil {
			return err
		}
	}
	if err := p.deleteLegacyCombinedService(ctx, resources.StatefulSet.Namespace, kubernetesNameBase(identity.Name)+"-ssh"); err != nil {
		return err
	}
	if err := p.deleteIngresses(ctx, resources.StatefulSet.Namespace, workspaceLabels(identity)); err != nil {
		return err
	}
	if !p.retainPVC && resources.PVC != nil {
		if err := ignoreNotFound(p.kubeClient.Delete(ctx, resources.PVC)); err != nil {
			return err
		}
	}
	return nil
}

func (p *Plugin) deleteLegacyCombinedService(ctx context.Context, namespace, name string) error {
	var service corev1.Service
	key := client.ObjectKey{Namespace: namespace, Name: name}
	if err := p.kubeClient.Get(ctx, key, &service); err != nil {
		return ignoreNotFound(err)
	}
	return ignoreNotFound(p.kubeClient.Delete(ctx, &service))
}

func (p *Plugin) deleteIngresses(ctx context.Context, namespace string, labels map[string]string) error {
	var ingresses networkingv1.IngressList
	if err := p.kubeClient.List(ctx, &ingresses, client.InNamespace(namespace), client.MatchingLabels(labels)); err != nil {
		return err
	}
	for i := range ingresses.Items {
		if err := ignoreNotFound(p.kubeClient.Delete(ctx, &ingresses.Items[i])); err != nil {
			return err
		}
	}
	return nil
}

func (p *Plugin) Finalize(ctx context.Context, tCtx pluginsCore.TaskExecutionContext) error {
	return nil
}

func (p *Plugin) workspacePods(ctx context.Context, sts *appsv1.StatefulSet) (*corev1.PodList, error) {
	pods := &corev1.PodList{}
	if sts == nil {
		return pods, nil
	}
	labels := sts.Spec.Template.Labels
	if sts.Spec.Selector != nil && len(sts.Spec.Selector.MatchLabels) > 0 {
		labels = sts.Spec.Selector.MatchLabels
	}
	if err := p.kubeClient.List(ctx, pods, client.InNamespace(sts.Namespace), client.MatchingLabels(labels)); err != nil {
		return nil, err
	}
	return pods, nil
}

func taskInfoForPods(pods []corev1.Pod) *pluginsCore.TaskInfo {
	logContext := k8slogs.LogContextFromPods(pods)
	if logContext == nil {
		return nil
	}
	return &pluginsCore.TaskInfo{LogContext: logContext}
}

func (p *Plugin) ensureResources(ctx context.Context, resources WorkspaceResources) (bool, error) {
	created := false
	if resources.Secret != nil {
		if ok, err := p.ensureObject(ctx, resources.Secret); err != nil {
			return false, err
		} else if ok {
			created = true
		}
	}
	for _, secret := range []*corev1.Secret{resources.CodeDownloaderSecret, resources.DatasetDownloaderSecret} {
		if secret == nil {
			continue
		}
		if ok, err := p.ensureObject(ctx, secret); err != nil {
			return false, err
		} else if ok {
			created = true
		}
	}
	if resources.PVC != nil {
		if ok, err := p.ensureObject(ctx, resources.PVC); err != nil {
			return false, err
		} else if ok {
			created = true
		}
	}
	for _, pvc := range resources.CloudStoragePVCs {
		if ok, err := p.ensureObject(ctx, pvc); err != nil {
			return false, err
		} else if ok {
			created = true
		}
	}
	if ok, err := p.ensureObject(ctx, resources.CodeServerService); err != nil {
		return false, err
	} else if ok {
		created = true
	}
	if resources.SSHService != nil {
		if ok, err := p.ensureObject(ctx, resources.SSHService); err != nil {
			return false, err
		} else if ok {
			created = true
		}
	}
	if ok, err := p.ensureObject(ctx, resources.CodeServerIngress); err != nil {
		return false, err
	} else if ok {
		created = true
	}
	if ok, err := p.ensureObject(ctx, resources.StatefulSet); err != nil {
		return false, err
	} else if ok {
		created = true
	}
	return created, nil
}

func (p *Plugin) ensureObject(ctx context.Context, obj client.Object) (bool, error) {
	key := client.ObjectKeyFromObject(obj)
	existing := obj.DeepCopyObject().(client.Object)
	if err := p.kubeClient.Get(ctx, key, existing); err == nil {
		return false, nil
	} else if !apierrors.IsNotFound(err) {
		return false, err
	}
	if err := p.kubeClient.Create(ctx, obj); err != nil {
		if apierrors.IsAlreadyExists(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func workspaceIdentityFromMetadata(metadata pluginsCore.TaskExecutionMetadata) WorkspaceIdentity {
	taskExecutionID := metadata.GetTaskExecutionID()
	generatedName := taskExecutionID.GetGeneratedName()
	identity := WorkspaceIdentity{
		Namespace: metadata.GetNamespace(),
		Name:      generatedName,
		RunName:   generatedName,
	}

	if id := taskExecutionID.GetID(); id != nil {
		if nodeID := id.GetNodeExecutionId(); nodeID != nil {
			identity.ActionName = nodeID.GetNodeId()
			if executionID := nodeID.GetExecutionId(); executionID != nil {
				identity.Project = executionID.GetProject()
				identity.Domain = executionID.GetDomain()
				identity.RunName = executionID.GetName()
				identity.Org = executionID.GetOrg()
			}
		}
	}
	return identity
}

func ignoreNotFound(err error) error {
	if err == nil || apierrors.IsNotFound(err) {
		return nil
	}
	return err
}

func init() {
	pluginmachinery.PluginRegistry().RegisterCorePlugin(pluginsCore.PluginEntry{
		ID:                  TaskType,
		RegisteredTaskTypes: []pluginsCore.TaskType{TaskType},
		LoadPlugin: func(ctx context.Context, iCtx pluginsCore.SetupContext) (pluginsCore.Plugin, error) {
			if iCtx.KubeClient() == nil {
				return nil, fmt.Errorf("ssh workspace plugin requires a Kubernetes client")
			}
			return NewPlugin(iCtx.KubeClient().GetClient(), true), nil
		},
		IsDefault: false,
	})
}
