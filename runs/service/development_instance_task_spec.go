package service

import (
	"encoding/json"
	"fmt"
	"time"

	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/structpb"

	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/core"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/task"
	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

const developmentInstanceTaskType = "ssh_workspace"

func BuildDevelopmentInstanceSpec(instance *models.DevelopmentInstance) (*task.TaskSpec, error) {
	if instance == nil {
		return nil, fmt.Errorf("development instance is required")
	}
	if instance.ImageURI == "" {
		return nil, fmt.Errorf("image is required")
	}
	if instance.CPU == "" || instance.Memory == "" {
		return nil, fmt.Errorf("cpu and memory are required")
	}
	if instance.WorkspaceSize == "" {
		return nil, fmt.Errorf("workspace size is required")
	}
	if instance.MaxHours == 0 {
		return nil, fmt.Errorf("max hours is required")
	}

	authorizedKeys := []string{}
	if instance.AuthorizedKeysJSON != "" {
		_ = json.Unmarshal([]byte(instance.AuthorizedKeysJSON), &authorizedKeys)
	}
	authorizedKeyValues := make([]any, 0, len(authorizedKeys))
	for _, key := range authorizedKeys {
		authorizedKeyValues = append(authorizedKeyValues, key)
	}

	cloudStorageMounts := make([]any, 0, len(instance.SelectedCloudStorageMounts()))
	for _, mount := range instance.SelectedCloudStorageMounts() {
		cloudStorageMounts = append(cloudStorageMounts, map[string]any{
			"id":           mount.CloudStorageID,
			"pvcName":      mount.PVCName,
			"storageClass": mount.StorageClassName,
			"size":         mount.Size,
			"mountPath":    mount.MountPath,
		})
	}

	codeRepositories := make([]any, 0, len(instance.SelectedCodeRepositoryMounts()))
	for _, mount := range instance.SelectedCodeRepositoryMounts() {
		codeRepositories = append(codeRepositories, map[string]any{
			"id":        mount.CodeRepositoryID,
			"repoUrl":   mount.RepoURL,
			"branch":    mount.Branch,
			"mountPath": mount.MountPath,
			"token":     mount.Token,
		})
	}

	customPayload := map[string]any{
		"image":                    instance.ImageURI,
		"imageType":                instance.ImageType,
		"officialImageId":          instance.OfficialImageID,
		"imageName":                instance.ImageName,
		"sshUser":                  defaultString(instance.SSHUser, "dev"),
		"authorizedKeys":           authorizedKeyValues,
		"cpu":                      instance.CPU,
		"memory":                   instance.Memory,
		"gpuCount":                 instance.GPUCount,
		"gpuModel":                 instance.GPUModel,
		"workspaceSize":            instance.WorkspaceSize,
		"workspacePVCName":         instance.WorkspacePVCName,
		"serviceType":              "NodePort",
		"nodePort":                 instance.NodePort,
		"codeServerNodePort":       instance.CodeServerNodePort,
		"codeServerUrl":            instance.CodeServerURL,
		"codeServerWorkspaceUrl":   instance.CodeServerWorkspaceURL,
		"description":              instance.Description,
		"owner":                    instance.Owner,
		"maxHours":                 instance.MaxHours,
		"imagePullSecretName":      instance.ImagePullSecretName,
		"codeRepositorySecretName": "",
		"gpuNodeLabelKey":          instance.GPUNodeLabelKey,
		"sourceOrg":                instance.Org,
		"sourceInstanceId":         instance.ID,
		"sourceName":               instance.Name,
		"sourceSystem":             instance.SourceSystem,
		"baseImageMountPath":       instance.BaseImageMountPath,
	}
	if len(cloudStorageMounts) > 0 {
		customPayload["cloudStorageMounts"] = cloudStorageMounts
	}
	if len(codeRepositories) > 0 {
		customPayload["codeRepositories"] = codeRepositories
	}
	custom, err := structpb.NewStruct(customPayload)
	if err != nil {
		return nil, fmt.Errorf("failed to build development instance custom payload: %w", err)
	}

	return &task.TaskSpec{
		TaskTemplate: &core.TaskTemplate{
			Id: &core.Identifier{
				ResourceType: core.ResourceType_TASK,
				Org:          instance.Org,
				Project:      instance.Project,
				Domain:       instance.Domain,
				Name:         developmentInstanceTaskType,
				Version:      instance.ID,
			},
			Type: developmentInstanceTaskType,
			Metadata: &core.TaskMetadata{
				Runtime: &core.RuntimeMetadata{
					Type:    core.RuntimeMetadata_OTHER,
					Version: "1.0.0",
					Flavor:  "aione",
				},
				Timeout:      durationpb.New(time.Duration(instance.MaxHours) * time.Hour),
				Debuggable:   true,
				Discoverable: false,
			},
			Interface: &core.TypedInterface{},
			Custom:    custom,
		},
		ShortName: instance.Name,
	}, nil
}

func defaultString(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
