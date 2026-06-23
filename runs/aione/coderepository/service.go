package coderepository

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"k8s.io/apimachinery/pkg/util/rand"

	coderepositorypb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/coderepository"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/coderepository/coderepositoryconnect"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/common"
	"github.com/flyteorg/flyte/v2/runs/repository/interfaces"
	"github.com/flyteorg/flyte/v2/runs/repository/models"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type Service struct {
	coderepositoryconnect.UnimplementedCodeRepositoryServiceHandler
	repo interfaces.CodeRepositoryRepo
}

func NewService(repo interfaces.CodeRepositoryRepo) *Service {
	return &Service{repo: repo}
}

var _ coderepositoryconnect.CodeRepositoryServiceHandler = (*Service)(nil)

func (s *Service) CreateCodeRepository(ctx context.Context, req *connect.Request[coderepositorypb.CreateCodeRepositoryRequest]) (*connect.Response[coderepositorypb.CreateCodeRepositoryResponse], error) {
	model, err := buildModel(req.Msg.GetProject(), req.Msg.GetCodeRepository(), req.Msg.GetCreator(), "")
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("code repository repository is required"))
	}
	if err := s.repo.Create(ctx, model); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	created, err := s.repo.Get(ctx, model.CodeRepositoryKey)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&coderepositorypb.CreateCodeRepositoryResponse{CodeRepository: modelToProto(created, true)}), nil
}

func (s *Service) UpdateCodeRepository(ctx context.Context, req *connect.Request[coderepositorypb.UpdateCodeRepositoryRequest]) (*connect.Response[coderepositorypb.UpdateCodeRepositoryResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("code repository repository is required"))
	}
	key := keyFromProto(req.Msg.GetId())
	current, err := s.repo.Get(ctx, key)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	updated, err := buildModelFromKey(key, req.Msg.GetCodeRepository(), current.Creator)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if err := s.repo.Update(ctx, updated); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	saved, err := s.repo.Get(ctx, key)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&coderepositorypb.UpdateCodeRepositoryResponse{CodeRepository: modelToProto(saved, true)}), nil
}

func (s *Service) GetCodeRepository(ctx context.Context, req *connect.Request[coderepositorypb.GetCodeRepositoryRequest]) (*connect.Response[coderepositorypb.GetCodeRepositoryResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("code repository repository is required"))
	}
	model, err := s.repo.Get(ctx, keyFromProto(req.Msg.GetId()))
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	return connect.NewResponse(&coderepositorypb.GetCodeRepositoryResponse{CodeRepository: modelToProto(model, true)}), nil
}

func (s *Service) ListCodeRepositories(ctx context.Context, req *connect.Request[coderepositorypb.ListCodeRepositoriesRequest]) (*connect.Response[coderepositorypb.ListCodeRepositoriesResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("code repository repository is required"))
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
			if (filter.GetField() == "repo_url" || filter.GetField() == "branch") && len(filter.GetValues()) > 0 {
				search = filter.GetValues()[0]
			}
		}
	}
	result, err := s.repo.List(ctx, models.CodeRepositoryListInput{
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
	items := make([]*coderepositorypb.CodeRepository, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, modelToProto(item, false))
	}
	token := ""
	if len(items) == int(limit) && offset+limit < result.Total {
		token = strconv.FormatUint(uint64(offset+limit), 10)
	}
	return connect.NewResponse(&coderepositorypb.ListCodeRepositoriesResponse{CodeRepositories: items, Token: token, Total: result.Total}), nil
}

func (s *Service) DeleteCodeRepository(ctx context.Context, req *connect.Request[coderepositorypb.DeleteCodeRepositoryRequest]) (*connect.Response[coderepositorypb.DeleteCodeRepositoryResponse], error) {
	if s.repo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("code repository repository is required"))
	}
	if err := s.repo.Delete(ctx, keyFromProto(req.Msg.GetId())); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&coderepositorypb.DeleteCodeRepositoryResponse{}), nil
}

func buildModel(project *common.ProjectIdentifier, input *coderepositorypb.CodeRepositoryInput, creator string, id string) (*models.CodeRepository, error) {
	if project == nil {
		return nil, fmt.Errorf("project is required")
	}
	if id == "" {
		id = fmt.Sprintf("cr-%s-%d", rand.String(8), time.Now().Unix())
	}
	key := models.CodeRepositoryKey{
		Org:     project.GetOrganization(),
		Project: project.GetName(),
		Domain:  project.GetDomain(),
		ID:      id,
	}
	return buildModelFromKey(key, input, creator)
}

func buildModelFromKey(key models.CodeRepositoryKey, input *coderepositorypb.CodeRepositoryInput, creator string) (*models.CodeRepository, error) {
	if input == nil {
		return nil, fmt.Errorf("code repository is required")
	}
	repoURL := strings.TrimSpace(input.GetRepoUrl())
	if repoURL == "" {
		return nil, fmt.Errorf("repo url is required")
	}
	if err := validateRepoURL(repoURL); err != nil {
		return nil, err
	}
	branch := strings.TrimSpace(input.GetBranch())
	if branch == "" {
		return nil, fmt.Errorf("branch is required")
	}
	mountPath := strings.TrimSpace(input.GetMountPath())
	if mountPath == "" || !strings.HasPrefix(mountPath, "/") {
		return nil, fmt.Errorf("mount path must be an absolute path")
	}
	return &models.CodeRepository{
		CodeRepositoryKey: key,
		RepoURL:           repoURL,
		Branch:            branch,
		MountPath:         mountPath,
		AccessToken:       input.GetToken(),
		Creator:           creator,
	}, nil
}

func validateRepoURL(repoURL string) error {
	parsed, err := url.Parse(repoURL)
	if err != nil || parsed.Host == "" {
		return fmt.Errorf("repo url must be a valid http or https URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("repo url must start with http:// or https://")
	}
	return nil
}

func keyFromProto(id *coderepositorypb.CodeRepositoryIdentifier) models.CodeRepositoryKey {
	if id == nil {
		return models.CodeRepositoryKey{}
	}
	return models.CodeRepositoryKey{
		Org:     id.GetOrg(),
		Project: id.GetProject(),
		Domain:  id.GetDomain(),
		ID:      id.GetId(),
	}
}

func modelToProto(model *models.CodeRepository, includeToken bool) *coderepositorypb.CodeRepository {
	if model == nil {
		return nil
	}
	token := ""
	if includeToken {
		token = model.AccessToken
	}
	return &coderepositorypb.CodeRepository{
		Id: &coderepositorypb.CodeRepositoryIdentifier{
			Org:     model.Org,
			Project: model.Project,
			Domain:  model.Domain,
			Id:      model.ID,
		},
		RepoUrl:   model.RepoURL,
		Branch:    model.Branch,
		MountPath: model.MountPath,
		Token:     token,
		Creator:   model.Creator,
		CreatedAt: optionalTimestamp(model.CreatedAt),
		UpdatedAt: optionalTimestamp(model.UpdatedAt),
	}
}

func optionalTimestamp(t time.Time) *timestamppb.Timestamp {
	if t.IsZero() {
		return nil
	}
	return timestamppb.New(t)
}
