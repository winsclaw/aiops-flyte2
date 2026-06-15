package impl

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

func TestCloudStorageRepoCreateGetListAndMaterialize(t *testing.T) {
	ctx := context.Background()
	repo := NewCloudStorageRepo(testDB)
	key := models.CloudStorageKey{
		Org:     "testorg",
		Project: "flytesnacks",
		Domain:  "development",
		ID:      "storage-1",
	}
	_ = repo.Delete(ctx, key)

	storage := &models.CloudStorage{
		CloudStorageKey: key,
		Name:            "dataset",
		Description:     "training data",
		SizeGB:          100,
		StorageClass:    "bj1-ebs",
		Creator:         "liu.cd",
	}
	require.NoError(t, repo.Create(ctx, storage))

	got, err := repo.Get(ctx, key)
	require.NoError(t, err)
	require.Equal(t, "dataset", got.Name)
	require.Equal(t, uint32(100), got.SizeGB)
	require.Empty(t, got.TargetNamespace)
	require.Empty(t, got.PVCName)
	require.True(t, got.MaterializedAt.IsZero())
	require.Empty(t, got.Materializations)

	require.NoError(t, repo.SetMaterialized(ctx, key, "flyte", "storage-1-flyte"))
	require.NoError(t, repo.SetMaterialized(ctx, key, "flytesnacks-development", "storage-1-development"))
	materialized, err := repo.Get(ctx, key)
	require.NoError(t, err)
	require.Len(t, materialized.Materializations, 2)
	require.Contains(t, []string{"flyte", "flytesnacks-development"}, materialized.TargetNamespace)
	require.Contains(t, []string{"storage-1-flyte", "storage-1-development"}, materialized.PVCName)
	require.False(t, materialized.MaterializedAt.IsZero())

	list, err := repo.List(ctx, models.CloudStorageListInput{
		Org:     key.Org,
		Project: key.Project,
		Domain:  key.Domain,
		Limit:   20,
	})
	require.NoError(t, err)
	require.Len(t, list.Items, 1)
	require.Equal(t, uint32(1), list.Total)

	require.NoError(t, repo.Delete(ctx, key))
	_, err = repo.Get(ctx, key)
	require.Error(t, err)
}
