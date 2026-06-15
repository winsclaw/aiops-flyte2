package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/require"

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
