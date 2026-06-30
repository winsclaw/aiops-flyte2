package service

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"

	coderepositorypb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/coderepository"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/common"
	trainingtaskpb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/trainingtask"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/workflow"
	"github.com/flyteorg/flyte/v2/runs/repository/interfaces"
	repositorymocks "github.com/flyteorg/flyte/v2/runs/repository/mocks"
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

func TestBuildTrainingTaskModelUsesDirectResourceFields(t *testing.T) {
	model, err := buildTrainingTaskModel(
		&common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"},
		&trainingtaskpb.TrainingTaskInput{
			Name:            "外部训练任务",
			Command:         "python train.py",
			MaxRuntimeHours: 2,
			ImageType:       trainingtaskpb.ImageType_IMAGE_TYPE_CUSTOM,
			ImageName:       "custom-train",
			ImageUri:        "docker.fzyun.io/founder/train:1.0.0",
			Cpu:             "3",
			Memory:          "7Gi",
			GpuCount:        2,
			GpuModel:        "NVIDIA T4",
			Bandwidth:       "10Gbps",
		},
		"external-api",
		"external-task-1",
	)

	require.NoError(t, err)
	require.Equal(t, "external-task-1", model.ID)
	require.Equal(t, "external", model.ResourceSpecID)
	require.Equal(t, "3vCPU, 7GiB RAM, 2*NVIDIA T4, 10Gbps", model.ResourceDisplay)
	require.Equal(t, "3", model.CPU)
	require.Equal(t, "7Gi", model.Memory)
	require.Equal(t, uint32(2), model.GPUCount)
	require.Equal(t, "NVIDIA T4", model.GPUModel)
	require.Equal(t, "10Gbps", model.Bandwidth)
}

func TestBuildTrainingTaskModelDoesNotDefaultDirectBandwidth(t *testing.T) {
	model, err := buildTrainingTaskModel(
		&common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"},
		&trainingtaskpb.TrainingTaskInput{
			Name:            "外部训练任务",
			Command:         "python train.py",
			MaxRuntimeHours: 2,
			ImageType:       trainingtaskpb.ImageType_IMAGE_TYPE_CUSTOM,
			ImageName:       "custom-train",
			ImageUri:        "docker.fzyun.io/founder/train:1.0.0",
			Cpu:             "3",
			Memory:          "7Gi",
			GpuCount:        2,
		},
		"external-api",
		"external-task-1",
	)

	require.NoError(t, err)
	require.Equal(t, "3vCPU, 7GiB RAM, 2*GPU", model.ResourceDisplay)
	require.Empty(t, model.GPUModel)
	require.Empty(t, model.Bandwidth)
}

func TestBuildTrainingTaskSpecPreservesDirectResourceFields(t *testing.T) {
	spec, err := BuildTrainingTaskSpec(&models.TrainingTask{
		TrainingTaskKey: models.TrainingTaskKey{
			ID:      "external-task-1",
			Org:     "testorg",
			Project: "flytesnacks",
			Domain:  "development",
		},
		Name:            "外部训练任务",
		ResourceSpecID:  "external",
		ResourceDisplay: "3vCPU, 7GiB RAM, 2*NVIDIA T4, 10Gbps",
		CPU:             "3",
		Memory:          "7Gi",
		GPUCount:        2,
		GPUModel:        "NVIDIA T4",
		Bandwidth:       "10Gbps",
		Command:         "python train.py",
		MaxRuntimeHours: 2,
		ImageURI:        "docker.fzyun.io/founder/train:1.0.0",
	})

	require.NoError(t, err)
	custom := spec.GetTaskTemplate().GetCustom().GetFields()
	require.Equal(t, "3", custom["cpu"].GetStringValue())
	require.Equal(t, "7Gi", custom["memory"].GetStringValue())
	require.Equal(t, float64(2), custom["gpuCount"].GetNumberValue())
	require.Equal(t, "NVIDIA T4", custom["gpuModel"].GetStringValue())
	require.Equal(t, "10Gbps", custom["bandwidth"].GetStringValue())
}

func TestResolveTrainingTaskCloudStorageMountsMaterializesInRuntimeNamespace(t *testing.T) {
	repo := repositorymocks.NewRepository(t)
	cloudStorageRepo := &fakeTrainingTaskCloudStorageRepo{
		items: map[string]*models.CloudStorage{
			"cs-1": {
				CloudStorageKey: models.CloudStorageKey{
					Org:     "testorg",
					Project: "flytesnacks",
					Domain:  "development",
					ID:      "cs-1",
				},
				StorageClass: "bj1-ebs",
				SizeGB:       100,
			},
		},
	}
	repo.EXPECT().CloudStorageRepo().Return(cloudStorageRepo).Maybe()
	svc := NewTrainingTaskService(repo, nil)
	task := &models.TrainingTask{
		TrainingTaskKey: models.TrainingTaskKey{
			ID:      "train-1",
			Org:     "testorg",
			Project: "flytesnacks",
			Domain:  "development",
		},
		CloudStorageMounts: []models.TrainingTaskCloudStorageMount{
			{CloudStorageID: "cs-1", MountPath: "/mnt/storage"},
		},
	}

	err := svc.resolveTrainingTaskCloudStorageMounts(context.Background(), task)

	require.NoError(t, err)
	require.Equal(t, "flyte", cloudStorageRepo.materializedNamespace)
	require.Equal(t, "cs-cs-1", cloudStorageRepo.materializedPVC)
	require.Len(t, task.CloudStorageMounts, 1)
	require.Equal(t, "cs-cs-1", task.CloudStorageMounts[0].PVCName)
	require.Equal(t, "100Gi", task.CloudStorageMounts[0].Size)
}

func TestListResourceSpecsIncludesSmallCPUAndT4Specs(t *testing.T) {
	svc := NewTrainingTaskService(nil, nil)

	response, err := svc.ListResourceSpecs(context.Background(), connect.NewRequest(&trainingtaskpb.ListResourceSpecsRequest{}))

	require.NoError(t, err)
	specs := response.Msg.GetResourceSpecs()
	require.Contains(t, resourceSpecLabels(specs), "1vCPU, 2GiB RAM, 1Gbps")
	require.Contains(t, resourceSpecLabels(specs), "1vCPU, 2GiB RAM, 1*NVIDIA T4, 1Gbps")

	cpuSpec := resourceSpecByIDForTest(specs, "cpu-1c-2g")
	require.NotNil(t, cpuSpec)
	require.Equal(t, "1", cpuSpec.GetCpu())
	require.Equal(t, "2Gi", cpuSpec.GetMemory())
	require.Equal(t, uint32(0), cpuSpec.GetGpuCount())

	t4Spec := resourceSpecByIDForTest(specs, "t4-1c-2g-1x")
	require.NotNil(t, t4Spec)
	require.Equal(t, "1", t4Spec.GetCpu())
	require.Equal(t, "2Gi", t4Spec.GetMemory())
	require.Equal(t, uint32(1), t4Spec.GetGpuCount())
	require.Equal(t, "NVIDIA T4", t4Spec.GetGpuModel())
}

func TestListOfficialImagesUsesTensorFlowRuntimeImage(t *testing.T) {
	svc := NewTrainingTaskService(nil, nil)

	response, err := svc.ListOfficialImages(context.Background(), connect.NewRequest(&trainingtaskpb.ListOfficialImagesRequest{}))

	require.NoError(t, err)
	require.Len(t, response.Msg.GetOfficialImages(), 1)
	require.Equal(t, "tensorflow-latest", response.Msg.GetOfficialImages()[0].GetId())
	require.Equal(t, "TensorFlow latest", response.Msg.GetOfficialImages()[0].GetName())
	require.Equal(t, "docker.fzyun.io/tensorflow/tensorflow:latest", response.Msg.GetOfficialImages()[0].GetImageUri())
}

func TestListTrainingTasksUsesLatestRunFailureStatusAndMessage(t *testing.T) {
	ctx := context.Background()
	repo := repositorymocks.NewRepository(t)
	actionRepo := repositorymocks.NewActionRepo(t)
	svc := NewTrainingTaskService(repo, nil)
	task := &models.TrainingTask{
		TrainingTaskKey: models.TrainingTaskKey{
			ID:      "train-1",
			Org:     "testorg",
			Project: "flytesnacks",
			Domain:  "development",
		},
		Name:            "任务1",
		ResourceSpecID:  "cpu-1c-2g",
		ResourceDisplay: "1vCPU, 2GiB RAM, 1Gbps",
		CPU:             "1",
		Memory:          "2Gi",
		Command:         "echo hello",
		MaxRuntimeHours: 1,
		ImageType:       "official",
		OfficialImageID: "flyte-py311-v251",
		ImageName:       "Flyte Python 3.11 v2.5.1",
		ImageURI:        "ghcr.fzyun.io/flyteorg/flyte:py3.11-v2.5.1",
		Creator:         "ljgong",
		LatestRunName:   "run-abc",
	}
	actionID := &common.ActionIdentifier{
		Run: &common.RunIdentifier{
			Org:     "testorg",
			Project: "flytesnacks",
			Domain:  "development",
			Name:    "run-abc",
		},
		Name: RootActionName,
	}
	eventModel, err := models.NewActionEventModel(&workflow.ActionEvent{
		Id:          actionID,
		Attempt:     0,
		Phase:       common.ActionPhase_ACTION_PHASE_FAILED,
		Version:     1,
		UpdatedTime: timestamppb.Now(),
		ErrorInfo: &workflow.ErrorInfo{
			Message: `镜像拉取失败: Back-off pulling image "busybox:1.36"`,
			Kind:    workflow.ErrorInfo_KIND_SYSTEM,
		},
	})
	require.NoError(t, err)
	trainingRepo := &fakeTrainingTaskRepo{
		listResult: &models.TrainingTaskListResult{Items: []*models.TrainingTask{task}, Total: 1},
	}

	repo.EXPECT().TrainingTaskRepo().Return(trainingRepo).Once()
	repo.EXPECT().ActionRepo().Return(actionRepo).Once()
	actionRepo.EXPECT().GetAction(mock.Anything, matchTrainingTaskActionID(actionID)).Return(&models.Action{
		Project:  "flytesnacks",
		Domain:   "development",
		RunName:  "run-abc",
		Name:     RootActionName,
		Phase:    int32(common.ActionPhase_ACTION_PHASE_FAILED),
		Attempts: 0,
	}, nil).Once()
	actionRepo.EXPECT().GetLatestEventByAttempt(mock.Anything, matchTrainingTaskActionID(actionID), uint32(0)).Return(eventModel, nil).Once()

	response, err := svc.ListTrainingTasks(ctx, connect.NewRequest(&trainingtaskpb.ListTrainingTasksRequest{
		Project: &common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"},
	}))

	require.NoError(t, err)
	require.Len(t, response.Msg.GetTrainingTasks(), 1)
	require.Equal(t, trainingtaskpb.TrainingTaskStatus_TRAINING_TASK_STATUS_FAILED, response.Msg.GetTrainingTasks()[0].GetStatus())
	require.Contains(t, response.Msg.GetTrainingTasks()[0].GetStatusMessage(), "镜像拉取失败")
}

func TestGetTrainingTaskUsesFailureEventMessageWhenLatestAttemptEventHasNoError(t *testing.T) {
	ctx := context.Background()
	repo := repositorymocks.NewRepository(t)
	actionRepo := repositorymocks.NewActionRepo(t)
	svc := NewTrainingTaskService(repo, nil)
	task := &models.TrainingTask{
		TrainingTaskKey: models.TrainingTaskKey{
			ID:      "train-1",
			Org:     "testorg",
			Project: "flytesnacks",
			Domain:  "development",
		},
		Name:            "任务1",
		ResourceSpecID:  "cpu-1c-2g",
		ResourceDisplay: "1vCPU, 2GiB RAM, 1Gbps",
		CPU:             "1",
		Memory:          "2Gi",
		Command:         "echo hello",
		MaxRuntimeHours: 1,
		ImageType:       "custom",
		ImageName:       "bad-image",
		ImageURI:        "docker.fzyun.io/library/missing:tag",
		Creator:         "ljgong",
		LatestRunName:   "run-abc",
	}
	actionID := &common.ActionIdentifier{
		Run: &common.RunIdentifier{
			Org:     "testorg",
			Project: "flytesnacks",
			Domain:  "development",
			Name:    "run-abc",
		},
		Name: RootActionName,
	}
	failedEventModel, err := models.NewActionEventModel(&workflow.ActionEvent{
		Id:          actionID,
		Attempt:     1,
		Phase:       common.ActionPhase_ACTION_PHASE_FAILED,
		Version:     1,
		UpdatedTime: timestamppb.Now(),
		ErrorInfo: &workflow.ErrorInfo{
			Message: `镜像拉取失败: failed to pull image "docker.fzyun.io/library/missing:tag"`,
			Kind:    workflow.ErrorInfo_KIND_SYSTEM,
		},
	})
	require.NoError(t, err)
	latestEventModel, err := models.NewActionEventModel(&workflow.ActionEvent{
		Id:          actionID,
		Attempt:     1,
		Phase:       common.ActionPhase_ACTION_PHASE_ABORTED,
		Version:     2,
		UpdatedTime: timestamppb.Now(),
	})
	require.NoError(t, err)
	trainingRepo := &fakeTrainingTaskRepo{getResult: task}

	repo.EXPECT().TrainingTaskRepo().Return(trainingRepo).Once()
	repo.EXPECT().ActionRepo().Return(actionRepo).Once()
	actionRepo.EXPECT().GetAction(mock.Anything, matchTrainingTaskActionID(actionID)).Return(&models.Action{
		Project:  "flytesnacks",
		Domain:   "development",
		RunName:  "run-abc",
		Name:     RootActionName,
		Phase:    int32(common.ActionPhase_ACTION_PHASE_FAILED),
		Attempts: 1,
	}, nil).Once()
	actionRepo.EXPECT().GetLatestEventByAttempt(mock.Anything, matchTrainingTaskActionID(actionID), uint32(1)).Return(latestEventModel, nil).Once()
	actionRepo.EXPECT().ListEvents(mock.Anything, matchTrainingTaskActionID(actionID), 500).Return([]*models.ActionEvent{
		failedEventModel,
		latestEventModel,
	}, nil).Once()

	response, err := svc.GetTrainingTask(ctx, connect.NewRequest(&trainingtaskpb.GetTrainingTaskRequest{
		Id: &trainingtaskpb.TrainingTaskIdentifier{
			Org:     "testorg",
			Project: "flytesnacks",
			Domain:  "development",
			Id:      "train-1",
		},
	}))

	require.NoError(t, err)
	require.Equal(t, trainingtaskpb.TrainingTaskStatus_TRAINING_TASK_STATUS_FAILED, response.Msg.GetTrainingTask().GetStatus())
	require.Contains(t, response.Msg.GetTrainingTask().GetStatusMessage(), "镜像拉取失败")
	require.Contains(t, response.Msg.GetTrainingTask().GetStatusMessage(), "docker.fzyun.io/library/missing:tag")
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

func resourceSpecLabels(specs []*trainingtaskpb.ResourceSpec) []string {
	labels := make([]string, 0, len(specs))
	for _, spec := range specs {
		labels = append(labels, spec.GetDisplayLabel())
	}
	return labels
}

func resourceSpecByIDForTest(specs []*trainingtaskpb.ResourceSpec, id string) *trainingtaskpb.ResourceSpec {
	for _, spec := range specs {
		if spec.GetId() == id {
			return spec
		}
	}
	return nil
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

func TestBuildTrainingTaskSpecIncludesDatasetsWithoutPlainSecret(t *testing.T) {
	spec, err := BuildTrainingTaskSpec(&models.TrainingTask{
		TrainingTaskKey: models.TrainingTaskKey{
			ID:      "train-dataset",
			Org:     "testorg",
			Project: "flytesnacks",
			Domain:  "development",
		},
		Name:            "任务-数据集",
		CPU:             "2",
		Memory:          "4Gi",
		Command:         "echo hello",
		MaxRuntimeHours: 1,
		ImageURI:        "busybox:1.36",
		Datasets: []models.RuntimeDataset{{
			Endpoint:            "1.2.3.4",
			Port:                "9000",
			AccessKey:           "ak",
			SecretKeyCiphertext: "v1:ciphertext",
			TargetPath:          "/data/set1",
			Bucket:              "mybucket1",
			BucketPath:          "sub-path/xxx",
		}},
	})

	require.NoError(t, err)
	fields := spec.GetTaskTemplate().GetCustom().GetFields()
	require.Equal(t, "aione-downloader:latest", fields["downloaderImage"].GetStringValue())
	values := fields["datasets"].GetListValue().GetValues()
	require.Len(t, values, 1)
	dataset := values[0].GetStructValue().GetFields()
	require.Equal(t, "1.2.3.4", dataset["endpoint"].GetStringValue())
	require.Equal(t, "9000", dataset["port"].GetStringValue())
	require.Equal(t, "v1:ciphertext", dataset["secretKeyCiphertext"].GetStringValue())
	require.Nil(t, dataset["secretKey"])
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
			OfficialImageId: "tensorflow-latest",
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

func TestResolveTrainingTaskCodeRepositoryMounts(t *testing.T) {
	repo := &fakeCodeRepositoryRepo{
		items: map[string]*models.CodeRepository{
			"repo-1": {
				CodeRepositoryKey: models.CodeRepositoryKey{Org: "testorg", Project: "flytesnacks", Domain: "development", ID: "repo-1"},
				RepoURL:           "https://git.fzyun.io/serverless/aione.git",
				Branch:            "main",
				MountPath:         "/workspace/default",
				AccessToken:       "secret-token",
			},
		},
	}
	task := &models.TrainingTask{
		TrainingTaskKey: models.TrainingTaskKey{Org: "testorg", Project: "flytesnacks", Domain: "development", ID: "train-1"},
		CodeRepositoryMounts: []models.TrainingTaskCodeRepositoryMount{
			{CodeRepositoryID: "repo-1", MountPath: "/workspace/override"},
		},
	}

	err := resolveTrainingTaskCodeRepositoryMounts(context.Background(), repo, task)

	require.NoError(t, err)
	require.Len(t, task.CodeRepositoryMounts, 1)
	require.Equal(t, "https://git.fzyun.io/serverless/aione.git", task.CodeRepositoryMounts[0].RepoURL)
	require.Equal(t, "main", task.CodeRepositoryMounts[0].Branch)
	require.Equal(t, "secret-token", task.CodeRepositoryMounts[0].Token)
	require.Equal(t, "/workspace/override", task.CodeRepositoryMounts[0].MountPath)
}

func TestTrainingTaskServiceCreatesWithExplicitID(t *testing.T) {
	repo := repositorymocks.NewRepository(t)
	trainingRepo := &fakeTrainingTaskRepo{}
	repo.EXPECT().TrainingTaskRepo().Return(trainingRepo).Twice()
	svc := NewTrainingTaskService(repo, nil)

	response, err := svc.CreateTrainingTask(context.Background(), connect.NewRequest(&trainingtaskpb.CreateTrainingTaskRequest{
		Project:        &common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"},
		Creator:        "external-api",
		TrainingTaskId: "task-contract-1",
		TrainingTask: &trainingtaskpb.TrainingTaskInput{
			Name:            "外部训练任务",
			ResourceSpecId:  "cpu-1c-2g",
			Command:         "python train.py",
			MaxRuntimeHours: 1,
			ImageType:       trainingtaskpb.ImageType_IMAGE_TYPE_OFFICIAL,
			OfficialImageId: "tensorflow-latest",
		},
	}))

	require.NoError(t, err)
	require.Equal(t, "task-contract-1", trainingRepo.created.ID)
	require.Equal(t, "task-contract-1", response.Msg.GetTrainingTask().GetId().GetId())
}

func TestTrainingTaskServiceGeneratesIDWhenExplicitIDIsMissing(t *testing.T) {
	repo := repositorymocks.NewRepository(t)
	trainingRepo := &fakeTrainingTaskRepo{}
	repo.EXPECT().TrainingTaskRepo().Return(trainingRepo).Twice()
	svc := NewTrainingTaskService(repo, nil)

	response, err := svc.CreateTrainingTask(context.Background(), connect.NewRequest(&trainingtaskpb.CreateTrainingTaskRequest{
		Project: &common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"},
		Creator: "ljgong",
		TrainingTask: &trainingtaskpb.TrainingTaskInput{
			Name:            "UI 训练任务",
			ResourceSpecId:  "cpu-1c-2g",
			Command:         "echo hello",
			MaxRuntimeHours: 1,
			ImageType:       trainingtaskpb.ImageType_IMAGE_TYPE_OFFICIAL,
			OfficialImageId: "tensorflow-latest",
		},
	}))

	require.NoError(t, err)
	require.NotEmpty(t, trainingRepo.created.ID)
	require.Contains(t, trainingRepo.created.ID, "tt-")
	require.Equal(t, trainingRepo.created.ID, response.Msg.GetTrainingTask().GetId().GetId())
}

func TestTrainingTaskServiceGetTrainingTaskByIdRejectsAmbiguousID(t *testing.T) {
	repo := repositorymocks.NewRepository(t)
	trainingRepo := &fakeTrainingTaskRepo{
		getByIDErr: fmt.Errorf("%w: task-contract-1", interfaces.ErrTrainingTaskIDAmbiguous),
	}
	repo.EXPECT().TrainingTaskRepo().Return(trainingRepo).Once()
	svc := NewTrainingTaskService(repo, nil)

	_, err := svc.GetTrainingTaskById(context.Background(), connect.NewRequest(&trainingtaskpb.GetTrainingTaskByIdRequest{
		Id: "task-contract-1",
	}))

	require.Error(t, err)
	require.Contains(t, err.Error(), "failed_precondition")
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
			OfficialImageId: "tensorflow-latest",
		},
	}))

	require.Error(t, err)
	require.Contains(t, err.Error(), "command")
}

type fakeCodeRepositoryRepo struct {
	items map[string]*models.CodeRepository
}

func (r *fakeCodeRepositoryRepo) Create(context.Context, *models.CodeRepository) error {
	return nil
}

func (r *fakeCodeRepositoryRepo) Get(_ context.Context, key models.CodeRepositoryKey) (*models.CodeRepository, error) {
	repo := r.items[key.ID]
	if repo == nil {
		return nil, fmt.Errorf("not found")
	}
	copy := *repo
	return &copy, nil
}

func (r *fakeCodeRepositoryRepo) Update(context.Context, *models.CodeRepository) error {
	return nil
}

func (r *fakeCodeRepositoryRepo) Delete(context.Context, models.CodeRepositoryKey) error {
	return nil
}

func (r *fakeCodeRepositoryRepo) List(context.Context, models.CodeRepositoryListInput) (*models.CodeRepositoryListResult, error) {
	return nil, nil
}

type fakeTrainingTaskRepo struct {
	listResult *models.TrainingTaskListResult
	getResult  *models.TrainingTask
	created    *models.TrainingTask
	getByIDErr error
}

func (r *fakeTrainingTaskRepo) Create(_ context.Context, task *models.TrainingTask) error {
	copy := *task
	r.created = &copy
	return nil
}

func (r *fakeTrainingTaskRepo) Get(_ context.Context, key models.TrainingTaskKey) (*models.TrainingTask, error) {
	result := r.getResult
	if result == nil {
		result = r.created
	}
	if result == nil {
		return nil, fmt.Errorf("not found")
	}
	if result.Org != key.Org || result.Project != key.Project || result.Domain != key.Domain || result.ID != key.ID {
		return nil, fmt.Errorf("unexpected get key: %+v", key)
	}
	return result, nil
}

func (r *fakeTrainingTaskRepo) GetByID(_ context.Context, id string) (*models.TrainingTask, error) {
	if r.getByIDErr != nil {
		return nil, r.getByIDErr
	}
	result := r.getResult
	if result == nil {
		result = r.created
	}
	if result == nil || result.ID != id {
		return nil, fmt.Errorf("not found")
	}
	return result, nil
}

func (r *fakeTrainingTaskRepo) Update(context.Context, *models.TrainingTask) error {
	return nil
}

func (r *fakeTrainingTaskRepo) Delete(context.Context, models.TrainingTaskKey) error {
	return nil
}

func (r *fakeTrainingTaskRepo) List(_ context.Context, input models.TrainingTaskListInput) (*models.TrainingTaskListResult, error) {
	if input.Org != "testorg" || input.Project != "flytesnacks" || input.Domain != "development" || input.Limit != 50 {
		return nil, fmt.Errorf("unexpected list input: %+v", input)
	}
	return r.listResult, nil
}

func (r *fakeTrainingTaskRepo) SetLatestRun(context.Context, models.TrainingTaskKey, string) error {
	return nil
}

type fakeTrainingTaskCloudStorageRepo struct {
	items                 map[string]*models.CloudStorage
	materializedNamespace string
	materializedPVC       string
}

func (r *fakeTrainingTaskCloudStorageRepo) Create(context.Context, *models.CloudStorage) error {
	return nil
}

func (r *fakeTrainingTaskCloudStorageRepo) Ensure(_ context.Context, storage *models.CloudStorage) (*models.CloudStorage, error) {
	return storage, nil
}

func (r *fakeTrainingTaskCloudStorageRepo) Get(_ context.Context, key models.CloudStorageKey) (*models.CloudStorage, error) {
	storage := r.items[key.ID]
	if storage == nil {
		return nil, fmt.Errorf("not found")
	}
	copy := *storage
	return &copy, nil
}

func (r *fakeTrainingTaskCloudStorageRepo) GetByID(_ context.Context, id string) (*models.CloudStorage, error) {
	return r.Get(context.Background(), models.CloudStorageKey{ID: id})
}

func (r *fakeTrainingTaskCloudStorageRepo) Delete(context.Context, models.CloudStorageKey) error {
	return nil
}

func (r *fakeTrainingTaskCloudStorageRepo) List(context.Context, models.CloudStorageListInput) (*models.CloudStorageListResult, error) {
	return nil, nil
}

func (r *fakeTrainingTaskCloudStorageRepo) SetMaterialized(_ context.Context, _ models.CloudStorageKey, namespace, pvcName string) error {
	r.materializedNamespace = namespace
	r.materializedPVC = pvcName
	return nil
}

func (r *fakeTrainingTaskCloudStorageRepo) ListMaterializations(context.Context, models.CloudStorageKey) ([]models.CloudStoragePVC, error) {
	return nil, nil
}

func (r *fakeTrainingTaskCloudStorageRepo) ClearMaterializations(context.Context, models.CloudStorageKey) error {
	return nil
}

func matchTrainingTaskActionID(expected *common.ActionIdentifier) interface{} {
	return mock.MatchedBy(func(actual *common.ActionIdentifier) bool {
		return actual.GetRun().GetOrg() == expected.GetRun().GetOrg() &&
			actual.GetRun().GetProject() == expected.GetRun().GetProject() &&
			actual.GetRun().GetDomain() == expected.GetRun().GetDomain() &&
			actual.GetRun().GetName() == expected.GetRun().GetName() &&
			actual.GetName() == expected.GetName()
	})
}
