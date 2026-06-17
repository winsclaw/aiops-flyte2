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

func TestListOfficialImagesUsesFlyteRuntimeImage(t *testing.T) {
	svc := NewTrainingTaskService(nil, nil)

	response, err := svc.ListOfficialImages(context.Background(), connect.NewRequest(&trainingtaskpb.ListOfficialImagesRequest{}))

	require.NoError(t, err)
	require.Len(t, response.Msg.GetOfficialImages(), 1)
	require.Equal(t, "flyte-py311-v251", response.Msg.GetOfficialImages()[0].GetId())
	require.Equal(t, "Flyte Python 3.11 v2.5.1", response.Msg.GetOfficialImages()[0].GetName())
	require.Equal(t, "ghcr.fzyun.io/flyteorg/flyte:py3.11-v2.5.1", response.Msg.GetOfficialImages()[0].GetImageUri())
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

func TestBuildTrainingTaskModelIncludesCodeRepositoryMounts(t *testing.T) {
	model, err := buildTrainingTaskModel(
		&common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"},
		&trainingtaskpb.TrainingTaskInput{
			Name:            "任务1",
			ResourceSpecId:  "t4-8c-16g-1x",
			Command:         "echo hello",
			MaxRuntimeHours: 1,
			ImageType:       trainingtaskpb.ImageType_IMAGE_TYPE_OFFICIAL,
			OfficialImageId: "flyte-py311-v251",
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
			OfficialImageId: "flyte-py311-v251",
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
}

func (r *fakeTrainingTaskRepo) Create(context.Context, *models.TrainingTask) error {
	return nil
}

func (r *fakeTrainingTaskRepo) Get(context.Context, models.TrainingTaskKey) (*models.TrainingTask, error) {
	return nil, fmt.Errorf("not found")
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

func matchTrainingTaskActionID(expected *common.ActionIdentifier) interface{} {
	return mock.MatchedBy(func(actual *common.ActionIdentifier) bool {
		return actual.GetRun().GetOrg() == expected.GetRun().GetOrg() &&
			actual.GetRun().GetProject() == expected.GetRun().GetProject() &&
			actual.GetRun().GetDomain() == expected.GetRun().GetDomain() &&
			actual.GetRun().GetName() == expected.GetRun().GetName() &&
			actual.GetName() == expected.GetName()
	})
}
