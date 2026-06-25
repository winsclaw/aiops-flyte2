package cloudstorage

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"k8s.io/apimachinery/pkg/util/rand"

	cloudstoragepb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/cloudstorage"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/cloudstorage/cloudstorageconnect"
	"github.com/flyteorg/flyte/v2/runs/repository/interfaces"
	"github.com/flyteorg/flyte/v2/runs/repository/models"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	DefaultStorageClassName = "bj1-ebs"
	cloudStorageIDPrefix    = "stg-"
	cloudStorageIDLength    = 26
)

type Service struct {
	cloudstorageconnect.UnimplementedCloudStorageServiceHandler
	repo interfaces.CloudStorageRepo
}

func NewService(repo interfaces.CloudStorageRepo) *Service {
	return &Service{repo: repo}
}

var _ cloudstorageconnect.CloudStorageServiceHandler = (*Service)(nil)

func (s *Service) CreateCloudStorage(ctx context.Context, req *connect.Request[cloudstoragepb.CreateCloudStorageRequest]) (*connect.Response[cloudstoragepb.CreateCloudStorageResponse], error) {
	model, err := buildModel(req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("cloud storage repository is required"))
	}
	if err := s.repo.Create(ctx, model); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	created, err := s.repo.Get(ctx, model.CloudStorageKey)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&cloudstoragepb.CreateCloudStorageResponse{CloudStorage: modelToProto(created)}), nil
}

func (s *Service) GetCloudStorage(ctx context.Context, req *connect.Request[cloudstoragepb.GetCloudStorageRequest]) (*connect.Response[cloudstoragepb.GetCloudStorageResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("cloud storage repository is required"))
	}
	model, err := s.repo.Get(ctx, keyFromProto(req.Msg.GetId()))
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	return connect.NewResponse(&cloudstoragepb.GetCloudStorageResponse{CloudStorage: modelToProto(model)}), nil
}

func (s *Service) GetCloudStorageById(ctx context.Context, req *connect.Request[cloudstoragepb.GetCloudStorageByIdRequest]) (*connect.Response[cloudstoragepb.GetCloudStorageByIdResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("cloud storage repository is required"))
	}
	id := strings.TrimSpace(req.Msg.GetId())
	if id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("id is required"))
	}
	model, err := s.repo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, interfaces.ErrCloudStorageIDAmbiguous) {
			return nil, connect.NewError(connect.CodeFailedPrecondition, err)
		}
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	return connect.NewResponse(&cloudstoragepb.GetCloudStorageByIdResponse{CloudStorage: modelToProto(model)}), nil
}

func (s *Service) ListCloudStorages(ctx context.Context, req *connect.Request[cloudstoragepb.ListCloudStoragesRequest]) (*connect.Response[cloudstoragepb.ListCloudStoragesResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("cloud storage repository is required"))
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
	result, err := s.repo.List(ctx, models.CloudStorageListInput{
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
	items := make([]*cloudstoragepb.CloudStorage, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, modelToProto(item))
	}
	token := ""
	if len(items) == int(limit) && offset+limit < result.Total {
		token = strconv.FormatUint(uint64(offset+limit), 10)
	}
	return connect.NewResponse(&cloudstoragepb.ListCloudStoragesResponse{CloudStorages: items, Token: token, Total: result.Total}), nil
}

func (s *Service) DeleteCloudStorage(ctx context.Context, req *connect.Request[cloudstoragepb.DeleteCloudStorageRequest]) (*connect.Response[cloudstoragepb.DeleteCloudStorageResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("cloud storage repository is required"))
	}
	if err := s.repo.Delete(ctx, keyFromProto(req.Msg.GetId())); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&cloudstoragepb.DeleteCloudStorageResponse{}), nil
}

func (s *Service) MaterializeCloudStorage(ctx context.Context, req *connect.Request[cloudstoragepb.MaterializeCloudStorageRequest]) (*connect.Response[cloudstoragepb.MaterializeCloudStorageResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("cloud storage repository is required"))
	}
	namespace := strings.TrimSpace(req.Msg.GetTargetNamespace())
	pvcName := strings.TrimSpace(req.Msg.GetPvcName())
	if namespace == "" || pvcName == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("target namespace and pvc name are required"))
	}
	key := keyFromProto(req.Msg.GetId())
	if err := s.repo.SetMaterialized(ctx, key, namespace, pvcName); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	model, err := s.repo.Get(ctx, key)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&cloudstoragepb.MaterializeCloudStorageResponse{CloudStorage: modelToProto(model)}), nil
}

func (s *Service) ClearCloudStorageMaterializations(ctx context.Context, req *connect.Request[cloudstoragepb.ClearCloudStorageMaterializationsRequest]) (*connect.Response[cloudstoragepb.ClearCloudStorageMaterializationsResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("cloud storage repository is required"))
	}
	key := keyFromProto(req.Msg.GetId())
	if key.Org == "" || key.Project == "" || key.Domain == "" || key.ID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("cloud storage id is required"))
	}
	if _, err := s.repo.Get(ctx, key); err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	if err := s.repo.ClearMaterializations(ctx, key); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&cloudstoragepb.ClearCloudStorageMaterializationsResponse{}), nil
}

func buildModel(req *cloudstoragepb.CreateCloudStorageRequest) (*models.CloudStorage, error) {
	project := req.GetProject()
	input := req.GetCloudStorage()
	if project == nil {
		return nil, fmt.Errorf("project is required")
	}
	if input == nil {
		return nil, fmt.Errorf("cloud storage is required")
	}
	name := strings.TrimSpace(input.GetName())
	if name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if input.GetSizeGb() == 0 || input.GetSizeGb() > 1000 {
		return nil, fmt.Errorf("size must be between 1 and 1000 GB")
	}
	return &models.CloudStorage{
		CloudStorageKey: models.CloudStorageKey{
			Org:     project.GetOrganization(),
			Project: project.GetName(),
			Domain:  project.GetDomain(),
			ID:      newCloudStorageID(),
		},
		Name:         name,
		Description:  truncate(input.GetDescription(), 255),
		SizeGB:       input.GetSizeGb(),
		StorageClass: DefaultStorageClassName,
		Creator:      req.GetCreator(),
	}, nil
}

func newCloudStorageID() string {
	return cloudStorageIDPrefix + rand.String(cloudStorageIDLength)
}

func keyFromProto(id *cloudstoragepb.CloudStorageIdentifier) models.CloudStorageKey {
	if id == nil {
		return models.CloudStorageKey{}
	}
	return models.CloudStorageKey{
		Org:     id.GetOrg(),
		Project: id.GetProject(),
		Domain:  id.GetDomain(),
		ID:      id.GetId(),
	}
}

func modelToProto(model *models.CloudStorage) *cloudstoragepb.CloudStorage {
	if model == nil {
		return nil
	}
	status := cloudstoragepb.CloudStorageStatus_CLOUD_STORAGE_STATUS_PENDING
	if model.TargetNamespace != "" && model.PVCName != "" {
		status = cloudstoragepb.CloudStorageStatus_CLOUD_STORAGE_STATUS_MATERIALIZED
	}
	materializations := make([]*cloudstoragepb.CloudStorageMaterialization, 0, len(model.Materializations))
	for _, pvc := range model.Materializations {
		materializations = append(materializations, &cloudstoragepb.CloudStorageMaterialization{
			TargetNamespace: pvc.TargetNamespace,
			PvcName:         pvc.PVCName,
			MaterializedAt:  optionalTimestamp(pvc.MaterializedAt),
		})
	}
	return &cloudstoragepb.CloudStorage{
		Id: &cloudstoragepb.CloudStorageIdentifier{
			Org:     model.Org,
			Project: model.Project,
			Domain:  model.Domain,
			Id:      model.ID,
		},
		Name:             model.Name,
		Description:      model.Description,
		SizeGb:           model.SizeGB,
		StorageClassName: model.StorageClass,
		TargetNamespace:  model.TargetNamespace,
		PvcName:          model.PVCName,
		Creator:          model.Creator,
		Status:           status,
		CreatedAt:        optionalTimestamp(model.CreatedAt),
		UpdatedAt:        optionalTimestamp(model.UpdatedAt),
		MaterializedAt:   optionalTimestamp(model.MaterializedAt),
		Materializations: materializations,
	}
}

func optionalTimestamp(t time.Time) *timestamppb.Timestamp {
	if t.IsZero() {
		return nil
	}
	return timestamppb.New(t)
}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max]
}
