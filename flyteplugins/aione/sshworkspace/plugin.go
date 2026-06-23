package sshworkspace

import (
	"context"
	"fmt"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	networkingv1 "k8s.io/api/networking/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"sigs.k8s.io/controller-runtime/pkg/client"

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
		return pluginsCore.DoTransition(pluginsCore.PhaseInfoQueued(time.Now(), pluginsCore.DefaultPhaseVersion, "SSH workspace submitted to Kubernetes")), nil
	}

	var sts appsv1.StatefulSet
	if err := p.kubeClient.Get(ctx, client.ObjectKeyFromObject(resources.StatefulSet), &sts); err != nil {
		if apierrors.IsNotFound(err) {
			return pluginsCore.DoTransition(pluginsCore.PhaseInfoSystemRetryableFailure("WorkspaceMissing", "SSH workspace StatefulSet was deleted", nil)), nil
		}
		return pluginsCore.UnknownTransition, err
	}

	if sts.Status.ReadyReplicas >= 1 {
		info := pluginsCore.PhaseInfoRunning(pluginsCore.DefaultPhaseVersion, nil)
		info.WithReason("SSH workspace is ready")
		return pluginsCore.DoTransition(info), nil
	}

	return pluginsCore.DoTransition(pluginsCore.PhaseInfoInitializing(time.Now(), pluginsCore.DefaultPhaseVersion, "waiting for SSH workspace pod readiness", nil)), nil
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
	if err := ignoreNotFound(p.kubeClient.Delete(ctx, resources.Service)); err != nil {
		return err
	}
	if err := ignoreNotFound(p.kubeClient.Delete(ctx, resources.Secret)); err != nil {
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

func (p *Plugin) ensureResources(ctx context.Context, resources WorkspaceResources) (bool, error) {
	created := false
	if ok, err := p.ensureObject(ctx, resources.Secret); err != nil {
		return false, err
	} else if ok {
		created = true
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
	if ok, err := p.ensureObject(ctx, resources.Service); err != nil {
		return false, err
	} else if ok {
		created = true
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
