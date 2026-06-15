package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/require"

	coderepositorypb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/coderepository"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/common"
	trainingtaskpb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/trainingtask"
	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

func TestBuildTrainingTaskSpecUsesTrainingTaskPlugin(t *testing.T) {
	spec, err := BuildTrainingTaskSpec(&models.TrainingTask{
		TrainingTaskKey: models.TrainingTaskKey{
			ID:      "train-1",
			Org:     "testorg",
			Project: "flytesnacks",
			Domain:  "development",
		},
		Name:            "任务1",
		CPU:             "2",
		Memory:          "4Gi",
		GPUCount:        0,
		Command:         "echo hello",
		MaxRuntimeHours: 1,
		ImageURI:        "busybox:1.36",
	})

	require.NoError(t, err)
	require.Equal(t, "training_task", spec.GetTaskTemplate().GetType())
	require.Equal(t, "busybox:1.36", spec.GetTaskTemplate().GetCustom().GetFields()["image"].GetStringValue())
	require.Equal(t, "echo hello", spec.GetTaskTemplate().GetCustom().GetFields()["command"].GetStringValue())
	require.Equal(t, float64(1), spec.GetTaskTemplate().GetCustom().GetFields()["maxRuntimeHours"].GetNumberValue())
}

func TestBuildTrainingTaskSpecIncludesCloudStorageMounts(t *testing.T) {
	spec, err := BuildTrainingTaskSpec(&models.TrainingTask{
		TrainingTaskKey: models.TrainingTaskKey{
			ID:      "train-1",
			Org:     "testorg",
			Project: "flytesnacks",
			Domain:  "development",
		},
		Name:            "任务1",
		CPU:             "2",
		Memory:          "4Gi",
		Command:         "echo hello",
		MaxRuntimeHours: 1,
		ImageURI:        "busybox:1.36",
		CloudStorageMounts: []models.TrainingTaskCloudStorageMount{
			{
				CloudStorageID:   "cs-1",
				PVCName:          "cs-cs-1",
				StorageClassName: "bj1-ebs",
				Size:             "100Gi",
				MountPath:        "/mnt/storage",
			},
		},
	})

	require.NoError(t, err)
	values := spec.GetTaskTemplate().GetCustom().GetFields()["cloudStorageMounts"].GetListValue().GetValues()
	require.Len(t, values, 1)
	fields := values[0].GetStructValue().GetFields()
	require.Equal(t, "cs-1", fields["id"].GetStringValue())
	require.Equal(t, "cs-cs-1", fields["pvcName"].GetStringValue())
	require.Equal(t, "bj1-ebs", fields["storageClass"].GetStringValue())
	require.Equal(t, "100Gi", fields["size"].GetStringValue())
	require.Equal(t, "/mnt/storage", fields["mountPath"].GetStringValue())
}

func TestBuildTrainingTaskSpecIncludesCodeRepositories(t *testing.T) {
	spec, err := BuildTrainingTaskSpec(&models.TrainingTask{
		TrainingTaskKey: models.TrainingTaskKey{
			ID:      "train-1",
			Org:     "testorg",
			Project: "flytesnacks",
			Domain:  "development",
		},
		Name:            "任务1",
		CPU:             "2",
		Memory:          "4Gi",
		Command:         "echo hello",
		MaxRuntimeHours: 1,
		ImageURI:        "busybox:1.36",
		CodeRepositoryMounts: []models.TrainingTaskCodeRepositoryMount{
			{
				CodeRepositoryID: "repo-1",
				RepoURL:          "https://git.fzyun.io/serverless/aione.git",
				Branch:           "main",
				MountPath:        "/workspace/aione",
				Token:            "secret-token",
			},
		},
	})

	require.NoError(t, err)
	values := spec.GetTaskTemplate().GetCustom().GetFields()["codeRepositories"].GetListValue().GetValues()
	require.Len(t, values, 1)
	fields := values[0].GetStructValue().GetFields()
	require.Equal(t, "repo-1", fields["id"].GetStringValue())
	require.Equal(t, "https://git.fzyun.io/serverless/aione.git", fields["repoUrl"].GetStringValue())
	require.Equal(t, "main", fields["branch"].GetStringValue())
	require.Equal(t, "/workspace/aione", fields["mountPath"].GetStringValue())
	require.Equal(t, "secret-token", fields["token"].GetStringValue())
}

func TestBuildTrainingTaskModelIncludesCodeRepositoryMounts(t *testing.T) {
	model, err := buildTrainingTaskModel(
		&common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"},
		&trainingtaskpb.TrainingTaskInput{
			Name:            "任务1",
			ResourceSpecId:  "t4-8c-16g-1x",
			Command:         "echo hello",
			MaxRuntimeHours: 1,
			ImageType:       trainingtaskpb.ImageType_IMAGE_TYPE_OFFICIAL,
			OfficialImageId: "busybox",
			CodeRepositoryMounts: []*coderepositorypb.CodeRepositoryMount{
				{CodeRepositoryId: "repo-1", MountPath: "/workspace/aione"},
			},
		},
		"ljgong",
		"train-1",
	)

	require.NoError(t, err)
	require.Len(t, model.SelectedCodeRepositoryMounts(), 1)
	require.Equal(t, "repo-1", model.SelectedCodeRepositoryMounts()[0].CodeRepositoryID)
	require.Equal(t, "/workspace/aione", model.SelectedCodeRepositoryMounts()[0].MountPath)

	proto := trainingTaskModelToProto(model)
	require.Len(t, proto.GetCodeRepositoryMounts(), 1)
	require.Equal(t, "repo-1", proto.GetCodeRepositoryMounts()[0].GetCodeRepositoryId())
}

func TestTrainingTaskServiceRejectsMissingCommand(t *testing.T) {
	svc := NewTrainingTaskService(nil, nil)

	_, err := svc.CreateTrainingTask(context.Background(), connect.NewRequest(&trainingtaskpb.CreateTrainingTaskRequest{
		Project: &common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"},
		Creator: "ljgong",
		TrainingTask: &trainingtaskpb.TrainingTaskInput{
			Name:            "任务1",
			ResourceSpecId:  "t4-8c-16g-1x",
			Command:         "",
			MaxRuntimeHours: 1,
			ImageType:       trainingtaskpb.ImageType_IMAGE_TYPE_OFFICIAL,
			OfficialImageId: "busybox",
		},
	}))

	require.Error(t, err)
	require.Contains(t, err.Error(), "command")
}
