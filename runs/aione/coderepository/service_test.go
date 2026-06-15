package coderepository

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/require"

	coderepositorypb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/coderepository"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/common"
	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

func TestCodeRepositoryServiceCreateListUpdateDelete(t *testing.T) {
	repo := newFakeCodeRepositoryRepo()
	svc := NewService(repo)
	project := &common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"}

	createResp, err := svc.CreateCodeRepository(context.Background(), connect.NewRequest(&coderepositorypb.CreateCodeRepositoryRequest{
		Project: project,
		Creator: "ljgong",
		CodeRepository: &coderepositorypb.CodeRepositoryInput{
			RepoUrl:   "https://git.fzyun.io/serverless/aione.git",
			Branch:    "main",
			MountPath: "/workspace/aione",
			Token:     "secret-token",
		},
	}))
	require.NoError(t, err)

	created := createResp.Msg.GetCodeRepository()
	require.NotEmpty(t, created.GetId().GetId())
	require.Equal(t, "https://git.fzyun.io/serverless/aione.git", created.GetRepoUrl())
	require.Equal(t, "secret-token", created.GetToken())

	listResp, err := svc.ListCodeRepositories(context.Background(), connect.NewRequest(&coderepositorypb.ListCodeRepositoriesRequest{
		Project: project,
	}))
	require.NoError(t, err)
	require.Len(t, listResp.Msg.GetCodeRepositories(), 1)
	require.Equal(t, uint32(1), listResp.Msg.GetTotal())
	require.Empty(t, listResp.Msg.GetCodeRepositories()[0].GetToken())

	updateResp, err := svc.UpdateCodeRepository(context.Background(), connect.NewRequest(&coderepositorypb.UpdateCodeRepositoryRequest{
		Id: created.GetId(),
		CodeRepository: &coderepositorypb.CodeRepositoryInput{
			RepoUrl:   created.GetRepoUrl(),
			Branch:    "dev",
			MountPath: "/workspace/aione-dev",
			Token:     "new-secret",
		},
	}))
	require.NoError(t, err)
	require.Equal(t, "dev", updateResp.Msg.GetCodeRepository().GetBranch())
	require.Equal(t, "new-secret", updateResp.Msg.GetCodeRepository().GetToken())

	_, err = svc.DeleteCodeRepository(context.Background(), connect.NewRequest(&coderepositorypb.DeleteCodeRepositoryRequest{Id: created.GetId()}))
	require.NoError(t, err)
	_, err = svc.GetCodeRepository(context.Background(), connect.NewRequest(&coderepositorypb.GetCodeRepositoryRequest{Id: created.GetId()}))
	require.Error(t, err)
}

type fakeCodeRepositoryRepo struct {
	items map[string]*models.CodeRepository
}

func newFakeCodeRepositoryRepo() *fakeCodeRepositoryRepo {
	return &fakeCodeRepositoryRepo{items: map[string]*models.CodeRepository{}}
}

func (r *fakeCodeRepositoryRepo) Create(_ context.Context, repo *models.CodeRepository) error {
	copy := *repo
	r.items[repo.ID] = &copy
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

func (r *fakeCodeRepositoryRepo) Update(_ context.Context, repo *models.CodeRepository) error {
	if r.items[repo.ID] == nil {
		return fmt.Errorf("not found")
	}
	copy := *repo
	r.items[repo.ID] = &copy
	return nil
}

func (r *fakeCodeRepositoryRepo) Delete(_ context.Context, key models.CodeRepositoryKey) error {
	delete(r.items, key.ID)
	return nil
}

func (r *fakeCodeRepositoryRepo) List(_ context.Context, input models.CodeRepositoryListInput) (*models.CodeRepositoryListResult, error) {
	items := make([]*models.CodeRepository, 0, len(r.items))
	for _, item := range r.items {
		if input.Search != "" && !strings.Contains(item.RepoURL, input.Search) {
			continue
		}
		copy := *item
		items = append(items, &copy)
	}
	return &models.CodeRepositoryListResult{Items: items, Total: uint32(len(items))}, nil
}
