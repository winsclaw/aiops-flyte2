package impl

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

func TestCodeRepositoryRepoCreateGetUpdateListDelete(t *testing.T) {
	ctx := context.Background()
	repo := NewCodeRepositoryRepo(testDB)
	key := models.CodeRepositoryKey{
		Org: "testorg", Project: "flytesnacks", Domain: "development", ID: "repo-1",
	}
	_ = repo.Delete(ctx, key)

	require.NoError(t, repo.Create(ctx, &models.CodeRepository{
		CodeRepositoryKey: key,
		RepoURL:           "https://git.fzyun.io/serverless/aione.git",
		Branch:            "main",
		MountPath:         "/workspace/aione",
		AccessToken:       "secret-token",
		Creator:           "ljgong",
	}))

	got, err := repo.Get(ctx, key)
	require.NoError(t, err)
	require.Equal(t, "main", got.Branch)
	require.Equal(t, "secret-token", got.AccessToken)

	got.Branch = "dev"
	got.AccessToken = "new-secret"
	require.NoError(t, repo.Update(ctx, got))
	updated, err := repo.Get(ctx, key)
	require.NoError(t, err)
	require.Equal(t, "dev", updated.Branch)
	require.Equal(t, "new-secret", updated.AccessToken)

	list, err := repo.List(ctx, models.CodeRepositoryListInput{
		Org: key.Org, Project: key.Project, Domain: key.Domain, Search: "aione", Limit: 20,
	})
	require.NoError(t, err)
	require.Len(t, list.Items, 1)
	require.Equal(t, uint32(1), list.Total)

	require.NoError(t, repo.Delete(ctx, key))
	_, err = repo.Get(ctx, key)
	require.Error(t, err)
}
