package dataset

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"k8s.io/apimachinery/pkg/util/rand"

	datasetpb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/dataset"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/dataset/datasetconnect"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/common"
	"github.com/flyteorg/flyte/v2/runs/repository/interfaces"
	"github.com/flyteorg/flyte/v2/runs/repository/models"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type Service struct {
	datasetconnect.UnimplementedDatasetServiceHandler
	datasets      interfaces.DatasetRepo
	cloudStorages interfaces.CloudStorageRepo
}

func NewService(datasets interfaces.DatasetRepo, cloudStorages interfaces.CloudStorageRepo) *Service {
	return &Service{datasets: datasets, cloudStorages: cloudStorages}
}

var _ datasetconnect.DatasetServiceHandler = (*Service)(nil)

func (s *Service) CreateDataset(ctx context.Context, req *connect.Request[datasetpb.CreateDatasetRequest]) (*connect.Response[datasetpb.CreateDatasetResponse], error) {
	if s.datasets == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("dataset repository is required"))
	}
	model, err := buildCreateModel(req.Msg.GetProject(), req.Msg.GetDataset(), req.Msg.GetCreator())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if err := s.ensureCloudStorage(ctx, model.DatasetKey, model.CloudStorageID); err != nil {
		return nil, err
	}
	if err := s.datasets.Create(ctx, model); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	created, err := s.datasets.Get(ctx, model.DatasetKey)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&datasetpb.CreateDatasetResponse{Dataset: modelToProto(created)}), nil
}

func (s *Service) UpdateDataset(ctx context.Context, req *connect.Request[datasetpb.UpdateDatasetRequest]) (*connect.Response[datasetpb.UpdateDatasetResponse], error) {
	if s.datasets == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("dataset repository is required"))
	}
	key := keyFromProto(req.Msg.GetId())
	current, err := s.datasets.Get(ctx, key)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	updated, err := buildUpdateModel(key, req.Msg.GetDataset(), current)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if err := s.ensureCloudStorage(ctx, key, updated.CloudStorageID); err != nil {
		return nil, err
	}
	if err := s.datasets.Update(ctx, updated); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	saved, err := s.datasets.Get(ctx, key)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&datasetpb.UpdateDatasetResponse{Dataset: modelToProto(saved)}), nil
}

func (s *Service) GetDataset(ctx context.Context, req *connect.Request[datasetpb.GetDatasetRequest]) (*connect.Response[datasetpb.GetDatasetResponse], error) {
	if s.datasets == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("dataset repository is required"))
	}
	model, err := s.datasets.Get(ctx, keyFromProto(req.Msg.GetId()))
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	return connect.NewResponse(&datasetpb.GetDatasetResponse{Dataset: modelToProto(model)}), nil
}

func (s *Service) ListDatasets(ctx context.Context, req *connect.Request[datasetpb.ListDatasetsRequest]) (*connect.Response[datasetpb.ListDatasetsResponse], error) {
	if s.datasets == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("dataset repository is required"))
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
			if (filter.GetField() == "name" || filter.GetField() == "description") && len(filter.GetValues()) > 0 {
				search = filter.GetValues()[0]
			}
		}
	}
	result, err := s.datasets.List(ctx, models.DatasetListInput{
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
	items := make([]*datasetpb.Dataset, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, modelToProto(item))
	}
	token := ""
	if len(items) == int(limit) && offset+limit < result.Total {
		token = strconv.FormatUint(uint64(offset+limit), 10)
	}
	return connect.NewResponse(&datasetpb.ListDatasetsResponse{Datasets: items, Token: token, Total: result.Total}), nil
}

func (s *Service) DeleteDataset(ctx context.Context, req *connect.Request[datasetpb.DeleteDatasetRequest]) (*connect.Response[datasetpb.DeleteDatasetResponse], error) {
	if s.datasets == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("dataset repository is required"))
	}
	if err := s.datasets.Delete(ctx, keyFromProto(req.Msg.GetId())); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&datasetpb.DeleteDatasetResponse{}), nil
}

func (s *Service) ensureCloudStorage(ctx context.Context, key models.DatasetKey, cloudStorageID string) error {
	if s.cloudStorages == nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("cloud storage repository is required"))
	}
	_, err := s.cloudStorages.Get(ctx, models.CloudStorageKey{
		Org:     key.Org,
		Project: key.Project,
		Domain:  key.Domain,
		ID:      cloudStorageID,
	})
	if err != nil {
		return connect.NewError(connect.CodeNotFound, fmt.Errorf("cloud storage not found: %w", err))
	}
	return nil
}

func buildCreateModel(project *common.ProjectIdentifier, input *datasetpb.DatasetInput, creator string) (*models.Dataset, error) {
	if project == nil {
		return nil, fmt.Errorf("project is required")
	}
	return buildModelFromKey(models.DatasetKey{
		Org:     project.GetOrganization(),
		Project: project.GetName(),
		Domain:  project.GetDomain(),
		ID:      newDatasetID(),
	}, input, creator, false, false)
}

func buildUpdateModel(key models.DatasetKey, input *datasetpb.DatasetInput, current *models.Dataset) (*models.Dataset, error) {
	if current != nil && current.ProjectPublic && !input.GetProjectPublic() {
		return nil, fmt.Errorf("project public datasets cannot be made private")
	}
	creator := ""
	if current != nil {
		creator = current.Creator
	}
	return buildModelFromKey(key, input, creator, current != nil && current.ProjectPublic, true)
}

func buildModelFromKey(key models.DatasetKey, input *datasetpb.DatasetInput, creator string, keepPublic bool, isUpdate bool) (*models.Dataset, error) {
	if input == nil {
		return nil, fmt.Errorf("dataset is required")
	}
	name := strings.TrimSpace(input.GetName())
	if name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if len([]rune(name)) > 128 {
		return nil, fmt.Errorf("name must be at most 128 characters")
	}
	description := strings.TrimSpace(input.GetDescription())
	if len([]rune(description)) > 255 {
		return nil, fmt.Errorf("description must be at most 255 characters")
	}
	cloudStorageID := strings.TrimSpace(input.GetCloudStorageId())
	if cloudStorageID == "" {
		return nil, fmt.Errorf("cloud storage id is required")
	}
	folderPath, err := normalizeFolderPath(input.GetFolderPath())
	if err != nil {
		return nil, err
	}
	projectPublic := input.GetProjectPublic() || keepPublic
	if isUpdate && key.ID == "" {
		return nil, fmt.Errorf("dataset id is required")
	}
	return &models.Dataset{
		DatasetKey:     key,
		Name:           name,
		Description:    description,
		CloudStorageID: cloudStorageID,
		FolderPath:     folderPath,
		ProjectPublic:  projectPublic,
		Creator:        creator,
	}, nil
}

func normalizeFolderPath(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	trimmed = strings.TrimLeft(trimmed, "/")
	if trimmed == "" {
		return "", nil
	}
	if strings.Contains(trimmed, `\`) || strings.Contains(trimmed, "..") {
		return "", fmt.Errorf("folder path cannot contain .., backslash, or URL scheme")
	}
	if parsed, err := url.Parse(trimmed); err == nil && parsed.Scheme != "" {
		return "", fmt.Errorf("folder path cannot contain .., backslash, or URL scheme")
	}
	return trimmed, nil
}

func newDatasetID() string {
	return fmt.Sprintf("ds-%s-%d", rand.String(8), time.Now().Unix())
}

func keyFromProto(id *datasetpb.DatasetIdentifier) models.DatasetKey {
	if id == nil {
		return models.DatasetKey{}
	}
	return models.DatasetKey{
		Org:     id.GetOrg(),
		Project: id.GetProject(),
		Domain:  id.GetDomain(),
		ID:      id.GetId(),
	}
}

func modelToProto(model *models.Dataset) *datasetpb.Dataset {
	if model == nil {
		return nil
	}
	return &datasetpb.Dataset{
		Id: &datasetpb.DatasetIdentifier{
			Org:     model.Org,
			Project: model.Project,
			Domain:  model.Domain,
			Id:      model.ID,
		},
		Name:           model.Name,
		Description:    model.Description,
		CloudStorageId: model.CloudStorageID,
		FolderPath:     model.FolderPath,
		ProjectPublic:  model.ProjectPublic,
		Creator:        model.Creator,
		CreatedAt:      optionalTimestamp(model.CreatedAt),
		UpdatedAt:      optionalTimestamp(model.UpdatedAt),
	}
}

func optionalTimestamp(t time.Time) *timestamppb.Timestamp {
	if t.IsZero() {
		return nil
	}
	return timestamppb.New(t)
}
