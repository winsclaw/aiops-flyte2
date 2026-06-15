package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"k8s.io/apimachinery/pkg/util/rand"

	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/common"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/task"
	trainingtaskpb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/trainingtask"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/trainingtask/trainingtaskconnect"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/workflow"
	"github.com/flyteorg/flyte/v2/runs/repository/interfaces"
	"github.com/flyteorg/flyte/v2/runs/repository/models"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type TrainingTaskService struct {
	trainingtaskconnect.UnimplementedTrainingTaskServiceHandler
	repo       interfaces.Repository
	runService *RunService
}

func NewTrainingTaskService(repo interfaces.Repository, runService *RunService) *TrainingTaskService {
	return &TrainingTaskService{repo: repo, runService: runService}
}

var _ trainingtaskconnect.TrainingTaskServiceHandler = (*TrainingTaskService)(nil)

func (s *TrainingTaskService) ListResourceSpecs(context.Context, *connect.Request[trainingtaskpb.ListResourceSpecsRequest]) (*connect.Response[trainingtaskpb.ListResourceSpecsResponse], error) {
	return connect.NewResponse(&trainingtaskpb.ListResourceSpecsResponse{ResourceSpecs: trainingTaskResourceSpecs}), nil
}

func (s *TrainingTaskService) ListOfficialImages(context.Context, *connect.Request[trainingtaskpb.ListOfficialImagesRequest]) (*connect.Response[trainingtaskpb.ListOfficialImagesResponse], error) {
	return connect.NewResponse(&trainingtaskpb.ListOfficialImagesResponse{OfficialImages: trainingTaskOfficialImages}), nil
}

func (s *TrainingTaskService) CreateTrainingTask(ctx context.Context, req *connect.Request[trainingtaskpb.CreateTrainingTaskRequest]) (*connect.Response[trainingtaskpb.CreateTrainingTaskResponse], error) {
	input := req.Msg.GetTrainingTask()
	project := req.Msg.GetProject()
	model, err := buildTrainingTaskModel(project, input, req.Msg.GetCreator(), "")
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("repository is required"))
	}
	if err := s.repo.TrainingTaskRepo().Create(ctx, model); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	created, err := s.repo.TrainingTaskRepo().Get(ctx, model.TrainingTaskKey)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&trainingtaskpb.CreateTrainingTaskResponse{TrainingTask: trainingTaskModelToProto(created)}), nil
}

func (s *TrainingTaskService) GetTrainingTask(ctx context.Context, req *connect.Request[trainingtaskpb.GetTrainingTaskRequest]) (*connect.Response[trainingtaskpb.GetTrainingTaskResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("repository is required"))
	}
	model, err := s.repo.TrainingTaskRepo().Get(ctx, trainingTaskKeyFromProto(req.Msg.GetId()))
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	return connect.NewResponse(&trainingtaskpb.GetTrainingTaskResponse{TrainingTask: trainingTaskModelToProto(model)}), nil
}

func (s *TrainingTaskService) ListTrainingTasks(ctx context.Context, req *connect.Request[trainingtaskpb.ListTrainingTasksRequest]) (*connect.Response[trainingtaskpb.ListTrainingTasksResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("repository is required"))
	}
	project := req.Msg.GetProject()
	limit := uint32(50)
	offset := uint32(0)
	search := ""
	if listReq := req.Msg.GetRequest(); listReq != nil {
		if listReq.GetLimit() > 0 {
			limit = listReq.GetLimit()
		}
		if listReq.GetToken() != "" {
			parsed, err := strconv.ParseUint(listReq.GetToken(), 10, 32)
			if err != nil {
				return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid token: %w", err))
			}
			offset = uint32(parsed)
		}
		for _, filter := range listReq.GetFilters() {
			if filter.GetField() == "name" && len(filter.GetValues()) > 0 {
				search = filter.GetValues()[0]
			}
		}
	}
	result, err := s.repo.TrainingTaskRepo().List(ctx, models.TrainingTaskListInput{
		Org:     project.GetOrganization(),
		Project: project.GetName(),
		Domain:  project.GetDomain(),
		Search:  search,
		Limit:   limit,
		Offset:  offset,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	items := make([]*trainingtaskpb.TrainingTask, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, trainingTaskModelToProto(item))
	}
	token := ""
	if len(items) == int(limit) && offset+limit < result.Total {
		token = strconv.FormatUint(uint64(offset+limit), 10)
	}
	return connect.NewResponse(&trainingtaskpb.ListTrainingTasksResponse{TrainingTasks: items, Token: token, Total: result.Total}), nil
}

func (s *TrainingTaskService) UpdateTrainingTask(ctx context.Context, req *connect.Request[trainingtaskpb.UpdateTrainingTaskRequest]) (*connect.Response[trainingtaskpb.UpdateTrainingTaskResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("repository is required"))
	}
	key := trainingTaskKeyFromProto(req.Msg.GetId())
	current, err := s.repo.TrainingTaskRepo().Get(ctx, key)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	updated, err := buildTrainingTaskModel(&common.ProjectIdentifier{Organization: key.Org, Name: key.Project, Domain: key.Domain}, req.Msg.GetTrainingTask(), current.Creator, key.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	updated.LatestRunName = current.LatestRunName
	if err := s.repo.TrainingTaskRepo().Update(ctx, updated); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	saved, err := s.repo.TrainingTaskRepo().Get(ctx, key)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&trainingtaskpb.UpdateTrainingTaskResponse{TrainingTask: trainingTaskModelToProto(saved)}), nil
}

func (s *TrainingTaskService) DeleteTrainingTask(ctx context.Context, req *connect.Request[trainingtaskpb.DeleteTrainingTaskRequest]) (*connect.Response[trainingtaskpb.DeleteTrainingTaskResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("repository is required"))
	}
	if err := s.repo.TrainingTaskRepo().Delete(ctx, trainingTaskKeyFromProto(req.Msg.GetId())); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&trainingtaskpb.DeleteTrainingTaskResponse{}), nil
}

func (s *TrainingTaskService) StartTrainingTask(ctx context.Context, req *connect.Request[trainingtaskpb.StartTrainingTaskRequest]) (*connect.Response[trainingtaskpb.StartTrainingTaskResponse], error) {
	if s.repo == nil || s.runService == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("repository and run service are required"))
	}
	key := trainingTaskKeyFromProto(req.Msg.GetId())
	model, err := s.repo.TrainingTaskRepo().Get(ctx, key)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	spec, err := BuildTrainingTaskSpec(model)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	runResp, err := s.runService.CreateRun(ctx, connect.NewRequest(&workflow.CreateRunRequest{
		Id: &workflow.CreateRunRequest_ProjectId{ProjectId: &common.ProjectIdentifier{
			Organization: model.Org,
			Name:         model.Project,
			Domain:       model.Domain,
		}},
		Task:         &workflow.CreateRunRequest_TaskSpec{TaskSpec: spec},
		InputWrapper: &workflow.CreateRunRequest_Inputs{Inputs: &task.Inputs{}},
		Source:       workflow.RunSource_RUN_SOURCE_WEB,
	}))
	if err != nil {
		return nil, err
	}
	runName := runResp.Msg.GetRun().GetAction().GetId().GetRun().GetName()
	if err := s.repo.TrainingTaskRepo().SetLatestRun(ctx, key, runName); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	model.LatestRunName = runName
	return connect.NewResponse(&trainingtaskpb.StartTrainingTaskResponse{TrainingTask: trainingTaskModelToProto(model), RunName: runName}), nil
}

func (s *TrainingTaskService) StopTrainingTask(ctx context.Context, req *connect.Request[trainingtaskpb.StopTrainingTaskRequest]) (*connect.Response[trainingtaskpb.StopTrainingTaskResponse], error) {
	if s.repo == nil || s.runService == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("repository and run service are required"))
	}
	model, err := s.repo.TrainingTaskRepo().Get(ctx, trainingTaskKeyFromProto(req.Msg.GetId()))
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	if model.LatestRunName == "" {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("training task has no run to stop"))
	}
	reason := req.Msg.GetReason()
	if strings.TrimSpace(reason) == "" {
		reason = "Stopped from training task console"
	}
	_, err = s.runService.AbortRun(ctx, connect.NewRequest(&workflow.AbortRunRequest{
		RunId: &common.RunIdentifier{
			Org:     model.Org,
			Project: model.Project,
			Domain:  model.Domain,
			Name:    model.LatestRunName,
		},
		Reason: &reason,
	}))
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&trainingtaskpb.StopTrainingTaskResponse{TrainingTask: trainingTaskModelToProto(model)}), nil
}

func buildTrainingTaskModel(project *common.ProjectIdentifier, input *trainingtaskpb.TrainingTaskInput, creator string, id string) (*models.TrainingTask, error) {
	if project == nil {
		return nil, fmt.Errorf("project is required")
	}
	if input == nil {
		return nil, fmt.Errorf("training task is required")
	}
	if strings.TrimSpace(input.GetName()) == "" {
		return nil, fmt.Errorf("name is required")
	}
	if strings.TrimSpace(input.GetCommand()) == "" {
		return nil, fmt.Errorf("command is required")
	}
	if input.GetMaxRuntimeHours() == 0 || input.GetMaxRuntimeHours() > 360 {
		return nil, fmt.Errorf("max runtime hours must be between 1 and 360")
	}
	spec, err := trainingTaskResourceSpecByID(input.GetResourceSpecId())
	if err != nil {
		return nil, err
	}
	imageName := strings.TrimSpace(input.GetImageName())
	imageURI := strings.TrimSpace(input.GetImageUri())
	imageType := "custom"
	officialImageID := ""
	switch input.GetImageType() {
	case trainingtaskpb.ImageType_IMAGE_TYPE_OFFICIAL:
		imageType = "official"
		official, err := trainingTaskOfficialImageByID(input.GetOfficialImageId())
		if err != nil {
			return nil, err
		}
		officialImageID = official.GetId()
		imageName = official.GetName()
		imageURI = official.GetImageUri()
	case trainingtaskpb.ImageType_IMAGE_TYPE_CUSTOM:
		if imageURI == "" {
			return nil, fmt.Errorf("image is required")
		}
		if imageName == "" {
			imageName = imageURI
		}
	default:
		return nil, fmt.Errorf("image type is required")
	}
	if id == "" {
		id = fmt.Sprintf("tt-%s-%d", rand.String(8), time.Now().Unix())
	}
	return &models.TrainingTask{
		TrainingTaskKey: models.TrainingTaskKey{
			Org:     project.GetOrganization(),
			Project: project.GetName(),
			Domain:  project.GetDomain(),
			ID:      id,
		},
		Name:            strings.TrimSpace(input.GetName()),
		Description:     truncateShortDescription(input.GetDescription()),
		ResourceSpecID:  spec.GetId(),
		ResourceDisplay: spec.GetDisplayLabel(),
		CPU:             spec.GetCpu(),
		Memory:          spec.GetMemory(),
		GPUCount:        spec.GetGpuCount(),
		GPUModel:        spec.GetGpuModel(),
		Bandwidth:       spec.GetBandwidth(),
		Command:         strings.TrimSpace(input.GetCommand()),
		MaxRuntimeHours: input.GetMaxRuntimeHours(),
		ImageType:       imageType,
		OfficialImageID: officialImageID,
		ImageName:       imageName,
		ImageURI:        imageURI,
		Creator:         creator,
	}, nil
}

func trainingTaskKeyFromProto(id *trainingtaskpb.TrainingTaskIdentifier) models.TrainingTaskKey {
	if id == nil {
		return models.TrainingTaskKey{}
	}
	return models.TrainingTaskKey{
		Org:     id.GetOrg(),
		Project: id.GetProject(),
		Domain:  id.GetDomain(),
		ID:      id.GetId(),
	}
}

func trainingTaskModelToProto(model *models.TrainingTask) *trainingtaskpb.TrainingTask {
	if model == nil {
		return nil
	}
	status := trainingtaskpb.TrainingTaskStatus_TRAINING_TASK_STATUS_NOT_STARTED
	if model.LatestRunName != "" {
		status = trainingtaskpb.TrainingTaskStatus_TRAINING_TASK_STATUS_RUNNING
	}
	imageType := trainingtaskpb.ImageType_IMAGE_TYPE_CUSTOM
	if model.ImageType == "official" {
		imageType = trainingtaskpb.ImageType_IMAGE_TYPE_OFFICIAL
	}
	return &trainingtaskpb.TrainingTask{
		Id: &trainingtaskpb.TrainingTaskIdentifier{
			Org:     model.Org,
			Project: model.Project,
			Domain:  model.Domain,
			Id:      model.ID,
		},
		Name:        model.Name,
		Description: model.Description,
		ResourceSpec: &trainingtaskpb.ResourceSpec{
			Id:           model.ResourceSpecID,
			DisplayLabel: model.ResourceDisplay,
			Cpu:          model.CPU,
			Memory:       model.Memory,
			GpuCount:     model.GPUCount,
			GpuModel:     model.GPUModel,
			Bandwidth:    model.Bandwidth,
		},
		Command:         model.Command,
		MaxRuntimeHours: model.MaxRuntimeHours,
		ImageType:       imageType,
		OfficialImageId: model.OfficialImageID,
		ImageName:       model.ImageName,
		ImageUri:        model.ImageURI,
		Creator:         model.Creator,
		LatestRunName:   model.LatestRunName,
		Status:          status,
		CreatedAt:       timestamppb.New(model.CreatedAt),
		UpdatedAt:       timestamppb.New(model.UpdatedAt),
	}
}
