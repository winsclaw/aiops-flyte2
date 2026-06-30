package service

import (
	"fmt"
	"os"
	"strings"
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

	cloudStorageMounts := make([]any, 0, len(trainingTask.SelectedCloudStorageMounts()))
	for _, mount := range trainingTask.SelectedCloudStorageMounts() {
		if mount.CloudStorageID == "" || mount.PVCName == "" || mount.StorageClassName == "" || mount.Size == "" || mount.MountPath == "" {
			return nil, fmt.Errorf("cloud storage mount %q is incomplete", mount.CloudStorageID)
		}
		cloudStorageMounts = append(cloudStorageMounts, map[string]any{
			"id":           mount.CloudStorageID,
			"pvcName":      mount.PVCName,
			"storageClass": mount.StorageClassName,
			"size":         mount.Size,
			"mountPath":    mount.MountPath,
		})
	}

	codeRepositoryMounts := make([]any, 0, len(trainingTask.SelectedCodeRepositoryMounts()))
	for _, mount := range trainingTask.SelectedCodeRepositoryMounts() {
		if mount.CodeRepositoryID == "" || mount.MountPath == "" {
			return nil, fmt.Errorf("code repository mount %q is incomplete", mount.CodeRepositoryID)
		}
		codeRepositoryMounts = append(codeRepositoryMounts, map[string]any{
			"id":        mount.CodeRepositoryID,
			"repoUrl":   mount.RepoURL,
			"branch":    mount.Branch,
			"mountPath": mount.MountPath,
			"token":     mount.Token,
		})
	}

	datasets := make([]any, 0, len(trainingTask.SelectedDatasets()))
	for _, dataset := range trainingTask.SelectedDatasets() {
		if dataset.EndPoint == "" || dataset.Port == "" || dataset.AccessKey == "" || dataset.SecretKeyCiphertext == "" || dataset.TargetPath == "" || dataset.Bucket == "" {
			return nil, fmt.Errorf("dataset mount %q is incomplete", dataset.TargetPath)
		}
		datasets = append(datasets, map[string]any{
			"endPoint":            dataset.EndPoint,
			"port":                dataset.Port,
			"accessKey":           dataset.AccessKey,
			"secretKeyCiphertext": dataset.SecretKeyCiphertext,
			"targetPath":          dataset.TargetPath,
			"bucket":              dataset.Bucket,
			"bucketPath":          dataset.BucketPath,
		})
	}

	customPayload := map[string]any{
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
		"downloaderImage":   downloaderImage(),
	}
	if len(cloudStorageMounts) > 0 {
		customPayload["cloudStorageMounts"] = cloudStorageMounts
	}
	if len(codeRepositoryMounts) > 0 {
		customPayload["codeRepositories"] = codeRepositoryMounts
	}
	if len(datasets) > 0 {
		customPayload["datasets"] = datasets
	}

	custom, err := structpb.NewStruct(customPayload)
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

func downloaderImage() string {
	image := strings.TrimSpace(os.Getenv("AIONE_DOWNLOADER_IMAGE"))
	if image == "" {
		return "aione-downloader:latest"
	}
	return image
}
