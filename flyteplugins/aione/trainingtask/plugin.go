package trainingtask

import (
	"context"
	"fmt"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/flyteorg/flyte/v2/flyteplugins/go/tasks/pluginmachinery"
	pluginsCore "github.com/flyteorg/flyte/v2/flyteplugins/go/tasks/pluginmachinery/core"
)

type Plugin struct {
	kubeClient client.Client
}

func NewPlugin(kubeClient client.Client) *Plugin {
	return &Plugin{kubeClient: kubeClient}
}

func (p *Plugin) GetID() string {
	return TaskType
}

func (p *Plugin) GetProperties() pluginsCore.PluginProperties {
	return pluginsCore.PluginProperties{DisableNodeLevelCaching: true}
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

	identity := trainingIdentityFromMetadata(tCtx.TaskExecutionMetadata())
	resources, err := BuildResources(identity, cfg)
	if err != nil {
		return pluginsCore.DoTransition(pluginsCore.PhaseInfoFailure("BadTaskSpecification", err.Error(), nil)), nil
	}

	created, err := p.ensureJob(ctx, resources.Job)
	if err != nil {
		return pluginsCore.UnknownTransition, err
	}
	if created {
		return pluginsCore.DoTransition(pluginsCore.PhaseInfoQueued(time.Now(), pluginsCore.DefaultPhaseVersion, "training task submitted to Kubernetes")), nil
	}

	var job batchv1.Job
	if err := p.kubeClient.Get(ctx, client.ObjectKeyFromObject(resources.Job), &job); err != nil {
		if apierrors.IsNotFound(err) {
			return pluginsCore.DoTransition(pluginsCore.PhaseInfoSystemRetryableFailure("TrainingJobMissing", "training Job was deleted", nil)), nil
		}
		return pluginsCore.UnknownTransition, err
	}

	if job.Status.Succeeded > 0 {
		return pluginsCore.DoTransition(pluginsCore.PhaseInfoSuccess(nil)), nil
	}
	if condition := failedCondition(job.Status.Conditions); condition != nil {
		return pluginsCore.DoTransition(pluginsCore.PhaseInfoFailure(condition.Reason, condition.Message, nil)), nil
	}
	if job.Status.Active > 0 {
		info := pluginsCore.PhaseInfoRunning(pluginsCore.DefaultPhaseVersion, nil)
		info.WithReason("training task is running")
		return pluginsCore.DoTransition(info), nil
	}

	return pluginsCore.DoTransition(pluginsCore.PhaseInfoInitializing(time.Now(), pluginsCore.DefaultPhaseVersion, "waiting for training task pod", nil)), nil
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
	identity := trainingIdentityFromMetadata(tCtx.TaskExecutionMetadata())
	resources, err := BuildResources(identity, cfg)
	if err != nil {
		return nil
	}
	return ignoreNotFound(p.kubeClient.Delete(ctx, resources.Job))
}

func (p *Plugin) Finalize(context.Context, pluginsCore.TaskExecutionContext) error {
	return nil
}

func (p *Plugin) ensureJob(ctx context.Context, job *batchv1.Job) (bool, error) {
	var existing batchv1.Job
	if err := p.kubeClient.Get(ctx, client.ObjectKeyFromObject(job), &existing); err == nil {
		return false, nil
	} else if !apierrors.IsNotFound(err) {
		return false, err
	}
	if err := p.kubeClient.Create(ctx, job); err != nil {
		if apierrors.IsAlreadyExists(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func trainingIdentityFromMetadata(metadata pluginsCore.TaskExecutionMetadata) TrainingIdentity {
	taskExecutionID := metadata.GetTaskExecutionID()
	generatedName := taskExecutionID.GetGeneratedName()
	identity := TrainingIdentity{
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

func failedCondition(conditions []batchv1.JobCondition) *batchv1.JobCondition {
	for i := range conditions {
		if conditions[i].Type == batchv1.JobFailed && conditions[i].Status == "True" {
			return &conditions[i]
		}
	}
	return nil
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
				return nil, fmt.Errorf("training task plugin requires a Kubernetes client")
			}
			return NewPlugin(iCtx.KubeClient().GetClient()), nil
		},
		IsDefault: false,
	})
}
