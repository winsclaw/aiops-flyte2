package service

import (
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"k8s.io/apimachinery/pkg/util/rand"

	cloudstoragepb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/cloudstorage"
	coderepositorypb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/coderepository"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/common"
	developmentinstancepb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/developmentinstance"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/developmentinstance/developmentinstanceconnect"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/task"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/workflow"
	"github.com/flyteorg/flyte/v2/runs/repository/interfaces"
	"github.com/flyteorg/flyte/v2/runs/repository/models"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type DevelopmentInstanceService struct {
	developmentinstanceconnect.UnimplementedDevelopmentInstanceServiceHandler
	repo             interfaces.Repository
	runService       *RunService
	runtimeNamespace string
}

func NewDevelopmentInstanceService(repo interfaces.Repository, runService *RunService, runtimeNamespace ...string) *DevelopmentInstanceService {
	namespace := "flyte"
	if len(runtimeNamespace) > 0 && strings.TrimSpace(runtimeNamespace[0]) != "" {
		namespace = strings.TrimSpace(runtimeNamespace[0])
	}
	return &DevelopmentInstanceService{repo: repo, runService: runService, runtimeNamespace: namespace}
}

var _ developmentinstanceconnect.DevelopmentInstanceServiceHandler = (*DevelopmentInstanceService)(nil)

func (s *DevelopmentInstanceService) ListDevelopmentInstances(ctx context.Context, req *connect.Request[developmentinstancepb.ListDevelopmentInstancesRequest]) (*connect.Response[developmentinstancepb.ListDevelopmentInstancesResponse], error) {
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
	result, err := s.repo.DevelopmentInstanceRepo().List(ctx, models.DevelopmentInstanceListInput{
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
	items := make([]*developmentinstancepb.DevelopmentInstance, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, s.developmentInstanceModelToProto(ctx, item))
	}
	token := ""
	if len(items) == int(limit) && offset+limit < result.Total {
		token = strconv.FormatUint(uint64(offset+limit), 10)
	}
	return connect.NewResponse(&developmentinstancepb.ListDevelopmentInstancesResponse{DevelopmentInstances: items, Token: token, Total: result.Total}), nil
}

func (s *DevelopmentInstanceService) GetDevelopmentInstance(ctx context.Context, req *connect.Request[developmentinstancepb.GetDevelopmentInstanceRequest]) (*connect.Response[developmentinstancepb.GetDevelopmentInstanceResponse], error) {
	return s.getDevelopmentInstanceByID(ctx, req.Msg.GetId().GetId())
}

func (s *DevelopmentInstanceService) GetDevelopmentInstanceById(ctx context.Context, req *connect.Request[developmentinstancepb.GetDevelopmentInstanceByIdRequest]) (*connect.Response[developmentinstancepb.GetDevelopmentInstanceByIdResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("repository is required"))
	}
	model, err := s.repo.DevelopmentInstanceRepo().GetByID(ctx, strings.TrimSpace(req.Msg.GetId()))
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	return connect.NewResponse(&developmentinstancepb.GetDevelopmentInstanceByIdResponse{DevelopmentInstance: s.developmentInstanceModelToProto(ctx, model)}), nil
}

func (s *DevelopmentInstanceService) getDevelopmentInstanceByID(ctx context.Context, id string) (*connect.Response[developmentinstancepb.GetDevelopmentInstanceResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("repository is required"))
	}
	model, err := s.repo.DevelopmentInstanceRepo().Get(ctx, models.DevelopmentInstanceKey{ID: strings.TrimSpace(id)})
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	return connect.NewResponse(&developmentinstancepb.GetDevelopmentInstanceResponse{DevelopmentInstance: s.developmentInstanceModelToProto(ctx, model)}), nil
}

func (s *DevelopmentInstanceService) ListDevelopmentInstanceRuns(ctx context.Context, req *connect.Request[developmentinstancepb.ListDevelopmentInstanceRunsRequest]) (*connect.Response[developmentinstancepb.ListDevelopmentInstanceRunsResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("repository is required"))
	}
	limit := uint32(50)
	offset := uint32(0)
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
	}
	result, err := s.repo.DevelopmentInstanceRepo().ListRuns(ctx, models.DevelopmentInstanceRunListInput{
		InstanceID: req.Msg.GetId().GetId(),
		Limit:      limit,
		Offset:     offset,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	items := make([]*developmentinstancepb.DevelopmentInstanceRun, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, s.developmentInstanceRunModelToProto(ctx, item))
	}
	token := ""
	if len(items) == int(limit) && offset+limit < result.Total {
		token = strconv.FormatUint(uint64(offset+limit), 10)
	}
	return connect.NewResponse(&developmentinstancepb.ListDevelopmentInstanceRunsResponse{Runs: items, Token: token, Total: result.Total}), nil
}

func (s *DevelopmentInstanceService) CreateDevelopmentInstance(ctx context.Context, req *connect.Request[developmentinstancepb.CreateDevelopmentInstanceRequest]) (*connect.Response[developmentinstancepb.CreateDevelopmentInstanceResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("repository is required"))
	}
	model, err := buildDevelopmentInstanceModel(req.Msg.GetProject(), req.Msg.GetDevelopmentInstance(), req.Msg.GetCreator(), strings.TrimSpace(req.Msg.GetDevelopmentInstanceId()))
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if err := s.populateDevelopmentInstanceDatasets(ctx, req.Msg.GetProject(), req.Msg.GetDevelopmentInstance(), model); err != nil {
		return nil, err
	}
	existing, getErr := s.repo.DevelopmentInstanceRepo().GetByID(ctx, model.ID)
	if getErr == nil && existing != nil {
		model.LatestRunName = existing.LatestRunName
		model.Status = existing.Status
		model.Generation = existing.Generation
		model.NodePort = existing.NodePort
		model.CodeServerURL = existing.CodeServerURL
		model.CodeServerWorkspaceURL = existing.CodeServerWorkspaceURL
		if err := s.repo.DevelopmentInstanceRepo().Update(ctx, model); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	} else {
		if err := s.repo.DevelopmentInstanceRepo().Create(ctx, model); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}
	created, err := s.repo.DevelopmentInstanceRepo().Get(ctx, model.DevelopmentInstanceKey)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&developmentinstancepb.CreateDevelopmentInstanceResponse{DevelopmentInstance: s.developmentInstanceModelToProto(ctx, created)}), nil
}

func (s *DevelopmentInstanceService) StartDevelopmentInstance(ctx context.Context, req *connect.Request[developmentinstancepb.StartDevelopmentInstanceRequest]) (*connect.Response[developmentinstancepb.StartDevelopmentInstanceResponse], error) {
	if s.repo == nil || s.runService == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("repository and run service are required"))
	}
	instance, err := s.repo.DevelopmentInstanceRepo().Get(ctx, models.DevelopmentInstanceKey{ID: req.Msg.GetId().GetId()})
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	if s.developmentInstanceIsActive(ctx, instance) {
		return nil, connect.NewError(connect.CodeAlreadyExists, fmt.Errorf("development instance %s already has an active run", instance.ID))
	}

	generation, runName, err := nextDevelopmentInstanceRunName(instance.Generation, instance.ID, func(candidateGeneration uint32, candidateRunName string) (bool, error) {
		_, err := s.repo.ActionRepo().GetAction(ctx, &common.ActionIdentifier{
			Run: &common.RunIdentifier{
				Org:     instance.Org,
				Project: instance.Project,
				Domain:  instance.Domain,
				Name:    candidateRunName,
			},
			Name: RootActionName,
		})
		if err == nil {
			return true, nil
		}
		if strings.Contains(err.Error(), "action not found") {
			return false, nil
		}
		return false, err
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	instance.Generation = generation
	instance.LatestRunName = runName
	instance.Status = models.DevelopmentInstanceStatusStarting
	if instance.EnableSSH && req.Msg.GetNodePort() > 0 {
		instance.NodePort = req.Msg.GetNodePort()
	} else if !instance.EnableSSH {
		instance.NodePort = 0
	}
	instance.WorkspacePVCName = defaultString(instance.WorkspacePVCName, instance.ID+"-workspace")
	applyDevelopmentInstanceRunAccess(instance, runName)
	if err := s.resolveDevelopmentInstanceCloudStorageMounts(ctx, instance); err != nil {
		return nil, err
	}
	if err := resolveDevelopmentInstanceCodeRepositoryMounts(ctx, s.repo.CodeRepositoryRepo(), instance); err != nil {
		return nil, err
	}

	startedAt := time.Now().UTC()
	if err := s.repo.DevelopmentInstanceRepo().Update(ctx, instance); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	run := &models.DevelopmentInstanceRun{
		InstanceID: instance.ID,
		Org:        instance.Org,
		Project:    instance.Project,
		Domain:     instance.Domain,
		RunName:    runName,
		Generation: generation,
		Status:     models.DevelopmentInstanceStatusStarting,
		NodePort:   instance.NodePort,
		StartedAt:  &startedAt,
	}
	if err := s.repo.DevelopmentInstanceRepo().AppendRun(ctx, run); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	spec, err := BuildDevelopmentInstanceSpec(instance)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	_, err = s.runService.CreateRun(ctx, connect.NewRequest(&workflow.CreateRunRequest{
		Id: &workflow.CreateRunRequest_RunId{RunId: &common.RunIdentifier{
			Org:     instance.Org,
			Project: instance.Project,
			Domain:  instance.Domain,
			Name:    runName,
		}},
		Task:         &workflow.CreateRunRequest_TaskSpec{TaskSpec: spec},
		InputWrapper: &workflow.CreateRunRequest_Inputs{Inputs: &task.Inputs{}},
		Source:       workflow.RunSource_RUN_SOURCE_WEB,
	}))
	if err != nil {
		endedAt := time.Now().UTC()
		run.Status = models.DevelopmentInstanceStatusFailed
		run.EndedAt = &endedAt
		_ = s.repo.DevelopmentInstanceRepo().UpdateRun(ctx, run)
		instance.Status = models.DevelopmentInstanceStatusFailed
		_ = s.repo.DevelopmentInstanceRepo().Update(ctx, instance)
		return nil, err
	}
	run.Status = models.DevelopmentInstanceStatusRunning
	_ = s.repo.DevelopmentInstanceRepo().UpdateRun(ctx, run)
	instance.Status = models.DevelopmentInstanceStatusRunning
	if err := s.repo.DevelopmentInstanceRepo().Update(ctx, instance); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&developmentinstancepb.StartDevelopmentInstanceResponse{DevelopmentInstance: s.developmentInstanceModelToProto(ctx, instance), RunName: runName}), nil
}

func (s *DevelopmentInstanceService) StopDevelopmentInstance(ctx context.Context, req *connect.Request[developmentinstancepb.StopDevelopmentInstanceRequest]) (*connect.Response[developmentinstancepb.StopDevelopmentInstanceResponse], error) {
	if s.repo == nil || s.runService == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("repository and run service are required"))
	}
	instance, err := s.repo.DevelopmentInstanceRepo().Get(ctx, models.DevelopmentInstanceKey{ID: req.Msg.GetId().GetId()})
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	if instance.LatestRunName == "" {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("development instance has no run to stop"))
	}
	reason := strings.TrimSpace(req.Msg.GetReason())
	if reason == "" {
		reason = "Stopped from development instance console"
	}
	_, err = s.runService.AbortRun(ctx, connect.NewRequest(&workflow.AbortRunRequest{
		RunId: &common.RunIdentifier{
			Org:     instance.Org,
			Project: instance.Project,
			Domain:  instance.Domain,
			Name:    instance.LatestRunName,
		},
		Reason: &reason,
	}))
	if err != nil {
		return nil, err
	}
	endedAt := time.Now().UTC()
	instance.Status = models.DevelopmentInstanceStatusStopped
	if latestRun, err := s.repo.DevelopmentInstanceRepo().GetLatestRun(ctx, instance.ID); err == nil {
		latestRun.Status = models.DevelopmentInstanceStatusStopped
		latestRun.EndedAt = &endedAt
		_ = s.repo.DevelopmentInstanceRepo().UpdateRun(ctx, latestRun)
	}
	if err := s.repo.DevelopmentInstanceRepo().Update(ctx, instance); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&developmentinstancepb.StopDevelopmentInstanceResponse{DevelopmentInstance: s.developmentInstanceModelToProto(ctx, instance)}), nil
}

func (s *DevelopmentInstanceService) DeleteDevelopmentInstance(ctx context.Context, req *connect.Request[developmentinstancepb.DeleteDevelopmentInstanceRequest]) (*connect.Response[developmentinstancepb.DeleteDevelopmentInstanceResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("repository is required"))
	}
	if err := s.repo.DevelopmentInstanceRepo().Delete(ctx, models.DevelopmentInstanceKey{ID: req.Msg.GetId().GetId()}); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&developmentinstancepb.DeleteDevelopmentInstanceResponse{}), nil
}

func buildDevelopmentInstanceModel(project *common.ProjectIdentifier, input *developmentinstancepb.DevelopmentInstanceInput, creator string, id string) (*models.DevelopmentInstance, error) {
	if project == nil {
		return nil, fmt.Errorf("project is required")
	}
	if input == nil {
		return nil, fmt.Errorf("development instance is required")
	}
	if strings.TrimSpace(input.GetName()) == "" {
		return nil, fmt.Errorf("name is required")
	}
	if strings.TrimSpace(input.GetCpu()) == "" || strings.TrimSpace(input.GetMemory()) == "" {
		return nil, fmt.Errorf("cpu and memory are required")
	}
	if strings.TrimSpace(input.GetWorkspaceSize()) == "" {
		return nil, fmt.Errorf("workspace size is required")
	}
	imageName := strings.TrimSpace(input.GetImageName())
	imageURI := strings.TrimSpace(input.GetImageUri())
	imageType := "custom"
	officialImageID := ""
	switch input.GetImageType() {
	case developmentinstancepb.ImageType_IMAGE_TYPE_OFFICIAL:
		officialImageID = defaultString(strings.TrimSpace(input.GetOfficialImageId()), "aione-ide")
		imageType = "official"
		if imageName == "" {
			imageName = "官方编辑器"
		}
		if imageURI == "" {
			imageURI = "docker.fzyun.io/founder/aione.ide:1.0.0.60"
		}
	case developmentinstancepb.ImageType_IMAGE_TYPE_CUSTOM:
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
		id = fmt.Sprintf("ins-%s-%d", rand.String(8), time.Now().Unix())
	}
	maxHours := input.GetMaxHours()
	if maxHours == 0 {
		maxHours = 24
	}
	authorizedKeysJSON := "[]"
	if len(input.GetAuthorizedKeys()) > 0 {
		keys, err := jsonMarshalStringSlice(input.GetAuthorizedKeys())
		if err != nil {
			return nil, fmt.Errorf("authorized keys are invalid: %w", err)
		}
		authorizedKeysJSON = keys
	}
	cloudMounts, err := developmentInstanceCloudMountsFromProto(input.GetCloudStorageMounts())
	if err != nil {
		return nil, err
	}
	cloudMountsJSON, err := models.EncodeDevelopmentInstanceCloudMounts(cloudMounts)
	if err != nil {
		return nil, fmt.Errorf("cloud storage mounts are invalid: %w", err)
	}
	codeMounts, err := developmentInstanceCodeRepositoryDetailsFromProto(input.GetCodeRepositoryDetails())
	if err != nil {
		return nil, err
	}
	if len(codeMounts) == 0 {
		codeMounts, err = developmentInstanceCodeRepositoryMountsFromProto(input.GetCodeRepositoryMounts())
		if err != nil {
			return nil, err
		}
	}
	codeMountsJSON, err := models.EncodeDevelopmentInstanceCodeRepoMounts(codeMounts)
	if err != nil {
		return nil, fmt.Errorf("code repository mounts are invalid: %w", err)
	}
	datasets, err := runtimeDatasetsFromProto(input.GetDatasets())
	if err != nil {
		return nil, err
	}
	datasetMounts, err := datasetMountsFromProto(input.GetDatasetMounts())
	if err != nil {
		return nil, err
	}
	if err := validateDevelopmentInstanceMountPaths(datasets, cloudMounts, codeMounts); err != nil {
		return nil, err
	}
	datasetsJSON, err := models.EncodeRuntimeDatasets(datasets)
	if err != nil {
		return nil, fmt.Errorf("datasets are invalid: %w", err)
	}
	datasetMountsJSON, err := models.EncodeDatasetMounts(datasetMounts)
	if err != nil {
		return nil, fmt.Errorf("dataset mounts are invalid: %w", err)
	}
	owner := strings.TrimSpace(input.GetOwner())
	if owner == "" {
		owner = creator
	}
	cpu := strings.TrimSpace(input.GetCpu())
	memory := strings.TrimSpace(input.GetMemory())
	gpuModel := strings.TrimSpace(input.GetGpuModel())
	bandwidth := strings.TrimSpace(input.GetBandwidth())
	workspaceSize := strings.TrimSpace(input.GetWorkspaceSize())
	resourceDisplay := formatDevelopmentInstanceResourceDisplay(cpu, memory, input.GetGpuCount(), gpuModel, bandwidth, workspaceSize)
	return &models.DevelopmentInstance{
		DevelopmentInstanceKey:   models.DevelopmentInstanceKey{ID: id},
		Org:                      project.GetOrganization(),
		Project:                  project.GetName(),
		Domain:                   project.GetDomain(),
		Name:                     strings.TrimSpace(input.GetName()),
		Description:              truncateShortDescription(input.GetDescription()),
		Owner:                    owner,
		SourceSystem:             strings.TrimSpace(input.GetSourceSystem()),
		ResourceDisplay:          resourceDisplay,
		CPU:                      cpu,
		Memory:                   memory,
		GPUCount:                 input.GetGpuCount(),
		GPUModel:                 gpuModel,
		Bandwidth:                bandwidth,
		WorkspaceSize:            workspaceSize,
		MaxHours:                 maxHours,
		ImageType:                imageType,
		OfficialImageID:          officialImageID,
		ImageName:                imageName,
		ImageURI:                 imageURI,
		ImagePullSecretName:      strings.TrimSpace(input.GetImagePullSecretName()),
		CodeRepositorySecretName: strings.TrimSpace(input.GetCodeRepositorySecretName()),
		GPUNodeLabelKey:          strings.TrimSpace(input.GetGpuNodeLabelKey()),
		BaseImageMountPath:       strings.TrimSpace(input.GetBaseImageMountPath()),
		EnableSSH:                input.GetEnableSsh(),
		SSHUser:                  defaultString(strings.TrimSpace(input.GetSshUser()), "flytekit"),
		AuthorizedKeysJSON:       authorizedKeysJSON,
		WorkspacePVCName:         id + "-workspace",
		Status:                   models.DevelopmentInstanceStatusNotStarted,
		CloudStorageMountsJSON:   cloudMountsJSON,
		CodeRepositoryMountsJSON: codeMountsJSON,
		DatasetsJSON:             datasetsJSON,
		DatasetMountsJSON:        datasetMountsJSON,
		CloudStorageMounts:       cloudMounts,
		CodeRepositoryMounts:     codeMounts,
		Datasets:                 datasets,
		DatasetMounts:            datasetMounts,
	}, nil
}

func (s *DevelopmentInstanceService) developmentInstanceModelToProto(ctx context.Context, model *models.DevelopmentInstance) *developmentinstancepb.DevelopmentInstance {
	proto := developmentInstanceModelToProto(model)
	if proto == nil || model.LatestRunName == "" || s.repo == nil {
		return proto
	}
	actionRepo := s.repo.ActionRepo()
	if actionRepo == nil {
		return proto
	}
	action, err := actionRepo.GetAction(ctx, developmentInstanceActionID(model))
	if err != nil || action == nil {
		return proto
	}
	proto.Status = developmentInstanceStatusFromActionPhase(common.ActionPhase(action.Phase))
	return proto
}

func developmentInstanceModelToProto(model *models.DevelopmentInstance) *developmentinstancepb.DevelopmentInstance {
	if model == nil {
		return nil
	}
	return &developmentinstancepb.DevelopmentInstance{
		Id:           &developmentinstancepb.DevelopmentInstanceIdentifier{Id: model.ID},
		Org:          model.Org,
		Project:      model.Project,
		Domain:       model.Domain,
		Name:         model.Name,
		Description:  model.Description,
		Owner:        model.Owner,
		SourceSystem: model.SourceSystem,
		ResourceSpec: &developmentinstancepb.DevelopmentInstanceResourceSpec{
			DisplayLabel:  model.ResourceDisplay,
			Cpu:           model.CPU,
			Memory:        model.Memory,
			GpuCount:      model.GPUCount,
			GpuModel:      model.GPUModel,
			Bandwidth:     model.Bandwidth,
			WorkspaceSize: model.WorkspaceSize,
		},
		ImageType:                developmentInstanceImageTypeToProto(model.ImageType),
		OfficialImageId:          model.OfficialImageID,
		ImageName:                model.ImageName,
		ImageUri:                 model.ImageURI,
		ImagePullSecretName:      model.ImagePullSecretName,
		CodeRepositorySecretName: model.CodeRepositorySecretName,
		GpuNodeLabelKey:          model.GPUNodeLabelKey,
		BaseImageMountPath:       model.BaseImageMountPath,
		EnableSsh:                model.EnableSSH,
		Access:                   developmentInstanceAccessInfoToProto(model),
		Status:                   developmentInstanceStatusToProto(model.Status),
		Generation:               model.Generation,
		LatestRunName:            model.LatestRunName,
		CreatedAt:                timestampFromTime(model.CreatedAt),
		UpdatedAt:                timestampFromTime(model.UpdatedAt),
		CloudStorageMounts:       developmentInstanceCloudMountsToProto(model.SelectedCloudStorageMounts()),
		CodeRepositoryMounts:     developmentInstanceCodeRepositoryMountsToProto(model.SelectedCodeRepositoryMounts()),
		CodeRepositoryDetails:    developmentInstanceCodeRepositoryDetailsToProto(model.SelectedCodeRepositoryMounts()),
		Datasets:                 runtimeDatasetsToProto(model.SelectedDatasets()),
		DatasetMounts:            datasetMountsToProto(model.SelectedDatasetMounts()),
	}
}

func (s *DevelopmentInstanceService) developmentInstanceRunModelToProto(ctx context.Context, model *models.DevelopmentInstanceRun) *developmentinstancepb.DevelopmentInstanceRun {
	if model == nil {
		return nil
	}
	proto := &developmentinstancepb.DevelopmentInstanceRun{
		InstanceId: model.InstanceID,
		Org:        model.Org,
		Project:    model.Project,
		Domain:     model.Domain,
		RunName:    model.RunName,
		Generation: model.Generation,
		Status:     developmentInstanceStatusToProto(model.Status),
		NodePort:   model.NodePort,
		StartedAt:  timestampFromPtr(model.StartedAt),
		EndedAt:    timestampFromPtr(model.EndedAt),
		CreatedAt:  timestampFromTime(model.CreatedAt),
		UpdatedAt:  timestampFromTime(model.UpdatedAt),
	}
	actionRepo := s.repo.ActionRepo()
	if actionRepo == nil {
		return proto
	}
	action, err := actionRepo.GetAction(ctx, &common.ActionIdentifier{
		Run: &common.RunIdentifier{
			Org:     model.Org,
			Project: model.Project,
			Domain:  model.Domain,
			Name:    model.RunName,
		},
		Name: RootActionName,
	})
	if err != nil || action == nil {
		return proto
	}
	proto.Status = developmentInstanceStatusFromActionPhase(common.ActionPhase(action.Phase))
	if action.EndedAt.Valid {
		proto.EndedAt = timestamppb.New(action.EndedAt.Time)
	}
	return proto
}

func developmentInstanceAccessInfoToProto(model *models.DevelopmentInstance) *developmentinstancepb.DevelopmentInstanceAccessInfo {
	return &developmentinstancepb.DevelopmentInstanceAccessInfo{
		SshUser:                model.SSHUser,
		NodePort:               model.NodePort,
		CodeServerUrl:          model.CodeServerURL,
		CodeServerWorkspaceUrl: model.CodeServerWorkspaceURL,
		WorkspacePvcName:       model.WorkspacePVCName,
	}
}

func developmentInstanceImageTypeToProto(value string) developmentinstancepb.ImageType {
	if value == "official" {
		return developmentinstancepb.ImageType_IMAGE_TYPE_OFFICIAL
	}
	if value == "custom" {
		return developmentinstancepb.ImageType_IMAGE_TYPE_CUSTOM
	}
	return developmentinstancepb.ImageType_IMAGE_TYPE_UNSPECIFIED
}

func developmentInstanceStatusToProto(value string) developmentinstancepb.DevelopmentInstanceStatus {
	switch value {
	case models.DevelopmentInstanceStatusStarting:
		return developmentinstancepb.DevelopmentInstanceStatus_DEVELOPMENT_INSTANCE_STATUS_STARTING
	case models.DevelopmentInstanceStatusRunning:
		return developmentinstancepb.DevelopmentInstanceStatus_DEVELOPMENT_INSTANCE_STATUS_RUNNING
	case models.DevelopmentInstanceStatusStopping:
		return developmentinstancepb.DevelopmentInstanceStatus_DEVELOPMENT_INSTANCE_STATUS_STOPPING
	case models.DevelopmentInstanceStatusStopped:
		return developmentinstancepb.DevelopmentInstanceStatus_DEVELOPMENT_INSTANCE_STATUS_STOPPED
	case models.DevelopmentInstanceStatusSucceeded:
		return developmentinstancepb.DevelopmentInstanceStatus_DEVELOPMENT_INSTANCE_STATUS_SUCCEEDED
	case models.DevelopmentInstanceStatusFailed:
		return developmentinstancepb.DevelopmentInstanceStatus_DEVELOPMENT_INSTANCE_STATUS_FAILED
	case models.DevelopmentInstanceStatusTimedOut:
		return developmentinstancepb.DevelopmentInstanceStatus_DEVELOPMENT_INSTANCE_STATUS_TIMED_OUT
	default:
		return developmentinstancepb.DevelopmentInstanceStatus_DEVELOPMENT_INSTANCE_STATUS_NOT_STARTED
	}
}

func developmentInstanceStatusFromActionPhase(phase common.ActionPhase) developmentinstancepb.DevelopmentInstanceStatus {
	switch phase {
	case common.ActionPhase_ACTION_PHASE_SUCCEEDED:
		return developmentinstancepb.DevelopmentInstanceStatus_DEVELOPMENT_INSTANCE_STATUS_SUCCEEDED
	case common.ActionPhase_ACTION_PHASE_FAILED:
		return developmentinstancepb.DevelopmentInstanceStatus_DEVELOPMENT_INSTANCE_STATUS_FAILED
	case common.ActionPhase_ACTION_PHASE_ABORTED:
		return developmentinstancepb.DevelopmentInstanceStatus_DEVELOPMENT_INSTANCE_STATUS_STOPPED
	case common.ActionPhase_ACTION_PHASE_TIMED_OUT:
		return developmentinstancepb.DevelopmentInstanceStatus_DEVELOPMENT_INSTANCE_STATUS_TIMED_OUT
	default:
		return developmentinstancepb.DevelopmentInstanceStatus_DEVELOPMENT_INSTANCE_STATUS_RUNNING
	}
}

func developmentInstanceActionID(model *models.DevelopmentInstance) *common.ActionIdentifier {
	return &common.ActionIdentifier{
		Run: &common.RunIdentifier{
			Org:     model.Org,
			Project: model.Project,
			Domain:  model.Domain,
			Name:    model.LatestRunName,
		},
		Name: RootActionName,
	}
}

func (s *DevelopmentInstanceService) developmentInstanceIsActive(ctx context.Context, model *models.DevelopmentInstance) bool {
	if model == nil || model.LatestRunName == "" {
		return false
	}
	if s.repo != nil {
		actionRepo := s.repo.ActionRepo()
		if actionRepo != nil {
			action, err := actionRepo.GetAction(ctx, developmentInstanceActionID(model))
			if err == nil && action != nil {
				return !developmentInstanceActionPhaseIsTerminal(common.ActionPhase(action.Phase))
			}
		}
	}
	switch model.Status {
	case models.DevelopmentInstanceStatusStarting, models.DevelopmentInstanceStatusRunning, models.DevelopmentInstanceStatusStopping:
		return true
	default:
		return false
	}
}

func (s *DevelopmentInstanceService) populateDevelopmentInstanceDatasets(ctx context.Context, project *common.ProjectIdentifier, input *developmentinstancepb.DevelopmentInstanceInput, instance *models.DevelopmentInstance) error {
	if len(input.GetDatasetMounts()) == 0 {
		return nil
	}
	if s.repo.DatasetRepo() == nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("dataset repository is required"))
	}
	resolved := append([]models.RuntimeDataset{}, instance.SelectedDatasets()...)
	for _, mount := range instance.SelectedDatasetMounts() {
		dataset, err := s.repo.DatasetRepo().Get(ctx, models.DatasetKey{
			Org:     project.GetOrganization(),
			Project: project.GetName(),
			Domain:  project.GetDomain(),
			ID:      mount.DatasetID,
		})
		if err != nil {
			return connect.NewError(connect.CodeNotFound, err)
		}
		resolved = append(resolved, models.RuntimeDataset{
			EndPoint:            dataset.EndPoint,
			Port:                dataset.Port,
			AccessKey:           dataset.AccessKey,
			SecretKeyCiphertext: dataset.SecretKeyCiphertext,
			TargetPath:          mount.TargetPath,
			Bucket:              dataset.Bucket,
			BucketPath:          dataset.BucketPath,
		})
	}
	if err := validateDevelopmentInstanceMountPaths(resolved, instance.SelectedCloudStorageMounts(), instance.SelectedCodeRepositoryMounts()); err != nil {
		return connect.NewError(connect.CodeInvalidArgument, err)
	}
	value, err := models.EncodeRuntimeDatasets(resolved)
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}
	instance.Datasets = resolved
	instance.DatasetsJSON = value
	return nil
}

func validateDevelopmentInstanceMountPaths(datasets []models.RuntimeDataset, cloudMounts []models.DevelopmentInstanceCloudMount, codeMounts []models.DevelopmentInstanceCodeRepoMount) error {
	seen := map[string]string{}
	for _, dataset := range datasets {
		if owner, ok := seen[dataset.TargetPath]; ok {
			return fmt.Errorf("mount path %s is already used by %s", dataset.TargetPath, owner)
		}
		seen[dataset.TargetPath] = "dataset"
	}
	for _, mount := range cloudMounts {
		if owner, ok := seen[mount.MountPath]; ok {
			return fmt.Errorf("mount path %s is already used by %s", mount.MountPath, owner)
		}
		seen[mount.MountPath] = "cloud storage"
	}
	for _, mount := range codeMounts {
		if owner, ok := seen[mount.MountPath]; ok {
			return fmt.Errorf("mount path %s is already used by %s", mount.MountPath, owner)
		}
		seen[mount.MountPath] = "code repository"
	}
	return nil
}

func developmentInstanceActionPhaseIsTerminal(phase common.ActionPhase) bool {
	switch phase {
	case common.ActionPhase_ACTION_PHASE_SUCCEEDED, common.ActionPhase_ACTION_PHASE_FAILED, common.ActionPhase_ACTION_PHASE_ABORTED, common.ActionPhase_ACTION_PHASE_TIMED_OUT:
		return true
	default:
		return false
	}
}

func buildDevelopmentInstanceRunName(instanceID string, generation uint32) string {
	return buildRunNameWithSuffix(instanceID, fmt.Sprintf("r%d", maxUint32(1, generation)), 30)
}

func nextDevelopmentInstanceRunName(currentGeneration uint32, instanceID string, exists func(uint32, string) (bool, error)) (uint32, string, error) {
	generation := currentGeneration + 1
	for attempts := 0; attempts < 1000; attempts++ {
		runName := buildDevelopmentInstanceRunName(instanceID, generation)
		found, err := exists(generation, runName)
		if err != nil {
			return 0, "", err
		}
		if !found {
			return generation, runName, nil
		}
		generation++
	}
	return 0, "", fmt.Errorf("failed to allocate unique development instance run name for %s", instanceID)
}

func buildRunNameWithSuffix(baseName string, suffix string, limit int) string {
	base := normalizeFlyteRunName(baseName)
	if base == "" {
		base = "instance"
	}
	normalizedSuffix := normalizeFlyteRunName(suffix)
	if normalizedSuffix == "" {
		normalizedSuffix = "r1"
	}
	suffixWithSeparator := "-" + normalizedSuffix
	if len(base)+len(suffixWithSeparator) <= limit {
		return base + suffixWithSeparator
	}
	hash := shortHash(base)
	maxBaseLength := limit - len(suffixWithSeparator) - len(hash) - 1
	if maxBaseLength < 1 {
		maxBaseLength = 1
	}
	prefix := strings.TrimRight(base[:minInt(maxBaseLength, len(base))], "-")
	if prefix == "" {
		prefix = "i"
	}
	return prefix + "-" + hash + suffixWithSeparator
}

func normalizeFlyteRunName(value string) string {
	var builder strings.Builder
	lastDash := false
	for _, r := range strings.ToLower(strings.TrimSpace(value)) {
		isAllowed := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if r == '-' {
			isAllowed = true
		}
		if !isAllowed {
			if !lastDash {
				builder.WriteByte('-')
				lastDash = true
			}
			continue
		}
		if r == '-' {
			if !lastDash {
				builder.WriteByte('-')
				lastDash = true
			}
			continue
		}
		builder.WriteRune(r)
		lastDash = false
	}
	return strings.Trim(builder.String(), "-")
}

func shortHash(value string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(value))
	return fmt.Sprintf("%08x", h.Sum32())
}

func formatDevelopmentInstanceResourceDisplay(cpu string, memory string, gpuCount uint32, gpuModel string, bandwidth string, workspaceSize string) string {
	parts := []string{fmt.Sprintf("%svCPU", cpu), fmt.Sprintf("%s RAM", displayMemory(memory))}
	if gpuCount > 0 {
		model := gpuModel
		if model == "" {
			model = "GPU"
		}
		parts = append(parts, fmt.Sprintf("%d*%s", gpuCount, model))
	}
	if bandwidth != "" {
		parts = append(parts, bandwidth)
	}
	if workspaceSize != "" {
		parts = append(parts, fmt.Sprintf("%s 工作区", workspaceSize))
	}
	return strings.Join(parts, ", ")
}

func buildDevelopmentInstanceCodeServerURL(runName string) string {
	return "https://" + buildDevelopmentInstanceCodeServerHost(runName) + ".ops.fzyun.io"
}

func applyDevelopmentInstanceRunAccess(instance *models.DevelopmentInstance, runName string) {
	if instance == nil {
		return
	}
	instance.CodeServerURL = buildDevelopmentInstanceCodeServerURL(runName)
	instance.CodeServerWorkspaceURL = instance.CodeServerURL + "/?folder=/workspace"
}

func buildDevelopmentInstanceCodeServerHost(value string) string {
	base := normalizeFlyteRunName(value)
	if base == "" {
		base = "instance"
	}
	suffix := "-code"
	if len(base)+len(suffix) <= 63 {
		return base + suffix
	}
	hash := shortHash(base)
	maxBaseLength := 63 - len(suffix) - len(hash) - 1
	prefix := strings.TrimRight(base[:minInt(maxBaseLength, len(base))], "-")
	if prefix == "" {
		prefix = "i"
	}
	return prefix + "-" + hash + suffix
}

func developmentInstanceCloudMountsFromProto(items []*cloudstoragepb.CloudStorageMount) ([]models.DevelopmentInstanceCloudMount, error) {
	mounts := make([]models.DevelopmentInstanceCloudMount, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		cloudStorageID := strings.TrimSpace(item.GetCloudStorageId())
		mountPath := strings.TrimSpace(item.GetMountPath())
		if cloudStorageID == "" || mountPath == "" {
			return nil, fmt.Errorf("cloud storage id and mount path are required")
		}
		if !strings.HasPrefix(mountPath, "/") {
			return nil, fmt.Errorf("cloud storage mount path must be absolute")
		}
		mounts = append(mounts, models.DevelopmentInstanceCloudMount{
			CloudStorageID: cloudStorageID,
			MountPath:      mountPath,
		})
	}
	return mounts, nil
}

func (s *DevelopmentInstanceService) resolveDevelopmentInstanceCloudStorageMounts(ctx context.Context, instance *models.DevelopmentInstance) error {
	selected := instance.SelectedCloudStorageMounts()
	if len(selected) == 0 {
		return nil
	}
	if s.repo.CloudStorageRepo() == nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("cloud storage repository is required"))
	}
	resolved := make([]models.DevelopmentInstanceCloudMount, 0, len(selected))
	for _, mount := range selected {
		storage, err := s.repo.CloudStorageRepo().Get(ctx, models.CloudStorageKey{
			Org:     instance.Org,
			Project: instance.Project,
			Domain:  instance.Domain,
			ID:      mount.CloudStorageID,
		})
		if err != nil {
			return connect.NewError(connect.CodeNotFound, err)
		}
		pvcName := cloudStoragePVCName(storage.ID)
		if err := s.repo.CloudStorageRepo().SetMaterialized(ctx, storage.CloudStorageKey, s.runtimeNamespace, pvcName); err != nil {
			return connect.NewError(connect.CodeInternal, err)
		}
		resolved = append(resolved, models.DevelopmentInstanceCloudMount{
			CloudStorageID:   storage.ID,
			PVCName:          pvcName,
			StorageClassName: storage.StorageClass,
			Size:             fmt.Sprintf("%dGi", storage.SizeGB),
			MountPath:        mount.MountPath,
		})
	}
	instance.CloudStorageMounts = resolved
	cloudMountsJSON, err := models.EncodeDevelopmentInstanceCloudMounts(resolved)
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}
	instance.CloudStorageMountsJSON = cloudMountsJSON
	return nil
}

func developmentInstanceCloudMountsToProto(items []models.DevelopmentInstanceCloudMount) []*cloudstoragepb.CloudStorageMount {
	mounts := make([]*cloudstoragepb.CloudStorageMount, 0, len(items))
	for _, item := range items {
		mounts = append(mounts, &cloudstoragepb.CloudStorageMount{
			CloudStorageId: item.CloudStorageID,
			MountPath:      item.MountPath,
		})
	}
	return mounts
}

func developmentInstanceCodeRepositoryMountsFromProto(items []*coderepositorypb.CodeRepositoryMount) ([]models.DevelopmentInstanceCodeRepoMount, error) {
	mounts := make([]models.DevelopmentInstanceCodeRepoMount, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		codeRepositoryID := strings.TrimSpace(item.GetCodeRepositoryId())
		mountPath := strings.TrimSpace(item.GetMountPath())
		if codeRepositoryID == "" || mountPath == "" {
			return nil, fmt.Errorf("code repository id and mount path are required")
		}
		if !strings.HasPrefix(mountPath, "/") {
			return nil, fmt.Errorf("code repository mount path must be absolute")
		}
		mounts = append(mounts, models.DevelopmentInstanceCodeRepoMount{
			CodeRepositoryID: codeRepositoryID,
			MountPath:        mountPath,
		})
	}
	return mounts, nil
}

func developmentInstanceCodeRepositoryDetailsFromProto(items []*developmentinstancepb.DevelopmentInstanceCodeRepositoryDetail) ([]models.DevelopmentInstanceCodeRepoMount, error) {
	mounts := make([]models.DevelopmentInstanceCodeRepoMount, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		id := strings.TrimSpace(item.GetId())
		repoURL := strings.TrimSpace(item.GetRepoUrl())
		mountPath := strings.TrimSpace(item.GetMountPath())
		if id == "" || repoURL == "" || mountPath == "" {
			return nil, fmt.Errorf("code repository id, repo url, and mount path are required")
		}
		if !strings.HasPrefix(mountPath, "/") {
			return nil, fmt.Errorf("code repository mount path must be absolute")
		}
		branch := strings.TrimSpace(item.GetBranch())
		if branch == "" {
			branch = "master"
		}
		mounts = append(mounts, models.DevelopmentInstanceCodeRepoMount{
			CodeRepositoryID: id,
			RepoURL:          repoURL,
			Branch:           branch,
			MountPath:        mountPath,
			Token:            item.GetToken(),
		})
	}
	return mounts, nil
}

func resolveDevelopmentInstanceCodeRepositoryMounts(ctx context.Context, repo interfaces.CodeRepositoryRepo, instance *models.DevelopmentInstance) error {
	selected := instance.SelectedCodeRepositoryMounts()
	if len(selected) == 0 {
		return nil
	}
	if repo == nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("code repository repository is required"))
	}
	resolved := make([]models.DevelopmentInstanceCodeRepoMount, 0, len(selected))
	for _, mount := range selected {
		if strings.TrimSpace(mount.RepoURL) != "" {
			resolved = append(resolved, mount)
			continue
		}
		codeRepo, err := repo.Get(ctx, models.CodeRepositoryKey{
			Org:     instance.Org,
			Project: instance.Project,
			Domain:  instance.Domain,
			ID:      mount.CodeRepositoryID,
		})
		if err != nil {
			return connect.NewError(connect.CodeNotFound, err)
		}
		mountPath := strings.TrimSpace(mount.MountPath)
		if mountPath == "" {
			mountPath = codeRepo.MountPath
		}
		resolved = append(resolved, models.DevelopmentInstanceCodeRepoMount{
			CodeRepositoryID: codeRepo.ID,
			RepoURL:          codeRepo.RepoURL,
			Branch:           codeRepo.Branch,
			MountPath:        mountPath,
			Token:            codeRepo.AccessToken,
		})
	}
	instance.CodeRepositoryMounts = resolved
	codeMountsJSON, err := models.EncodeDevelopmentInstanceCodeRepoMounts(resolved)
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}
	instance.CodeRepositoryMountsJSON = codeMountsJSON
	return nil
}

func developmentInstanceCodeRepositoryDetailsToProto(items []models.DevelopmentInstanceCodeRepoMount) []*developmentinstancepb.DevelopmentInstanceCodeRepositoryDetail {
	mounts := make([]*developmentinstancepb.DevelopmentInstanceCodeRepositoryDetail, 0, len(items))
	for _, item := range items {
		mounts = append(mounts, &developmentinstancepb.DevelopmentInstanceCodeRepositoryDetail{
			Id:        item.CodeRepositoryID,
			RepoUrl:   item.RepoURL,
			Branch:    item.Branch,
			MountPath: item.MountPath,
			Token:     item.Token,
		})
	}
	return mounts
}

func developmentInstanceCodeRepositoryMountsToProto(items []models.DevelopmentInstanceCodeRepoMount) []*coderepositorypb.CodeRepositoryMount {
	mounts := make([]*coderepositorypb.CodeRepositoryMount, 0, len(items))
	for _, item := range items {
		mounts = append(mounts, &coderepositorypb.CodeRepositoryMount{
			CodeRepositoryId: item.CodeRepositoryID,
			MountPath:        item.MountPath,
		})
	}
	return mounts
}

func timestampFromTime(value time.Time) *timestamppb.Timestamp {
	if value.IsZero() {
		return nil
	}
	return timestamppb.New(value)
}

func timestampFromPtr(value *time.Time) *timestamppb.Timestamp {
	if value == nil || value.IsZero() {
		return nil
	}
	return timestamppb.New(*value)
}

func jsonMarshalStringSlice(items []string) (string, error) {
	data, err := json.Marshal(items)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func maxUint32(a uint32, b uint32) uint32 {
	if a > b {
		return a
	}
	return b
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}
