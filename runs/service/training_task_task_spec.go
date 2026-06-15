package service

import (
	"fmt"
	"time"

	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/structpb"

	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/core"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/task"
	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

func BuildTrainingTaskSpec(trainingTask *models.TrainingTask) (*task.TaskSpec, error) {
	if trainingTask == nil {
		return nil, fmt.Errorf("training task is required")
	}
	if trainingTask.ImageURI == "" {
		return nil, fmt.Errorf("image is required")
	}
	if trainingTask.Command == "" {
		return nil, fmt.Errorf("command is required")
	}
	if trainingTask.CPU == "" || trainingTask.Memory == "" {
		return nil, fmt.Errorf("cpu and memory are required")
	}
	if trainingTask.MaxRuntimeHours == 0 {
		return nil, fmt.Errorf("max runtime is required")
	}

	custom, err := structpb.NewStruct(map[string]any{
		"image":             trainingTask.ImageURI,
		"command":           trainingTask.Command,
		"cpu":               trainingTask.CPU,
		"memory":            trainingTask.Memory,
		"gpuCount":          trainingTask.GPUCount,
		"gpuModel":          trainingTask.GPUModel,
		"bandwidth":         trainingTask.Bandwidth,
		"maxRuntimeHours":   trainingTask.MaxRuntimeHours,
		"trainingTaskId":    trainingTask.ID,
		"trainingTaskName":  trainingTask.Name,
		"resourceSpecId":    trainingTask.ResourceSpecID,
		"resourceSpecLabel": trainingTask.ResourceDisplay,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to build training task custom payload: %w", err)
	}

	return &task.TaskSpec{
		TaskTemplate: &core.TaskTemplate{
			Id: &core.Identifier{
				ResourceType: core.ResourceType_TASK,
				Org:          trainingTask.Org,
				Project:      trainingTask.Project,
				Domain:       trainingTask.Domain,
				Name:         trainingTaskType,
				Version:      trainingTask.ID,
			},
			Type: trainingTaskType,
			Metadata: &core.TaskMetadata{
				Runtime: &core.RuntimeMetadata{
					Type:    core.RuntimeMetadata_OTHER,
					Version: "1.0.0",
					Flavor:  "aione",
				},
				Timeout:      durationpb.New(time.Duration(trainingTask.MaxRuntimeHours) * time.Hour),
				Debuggable:   true,
				Discoverable: false,
			},
			Interface: &core.TypedInterface{},
			Custom:    custom,
		},
		ShortName: trainingTask.Name,
	}, nil
}
