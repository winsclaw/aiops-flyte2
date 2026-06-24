package impl

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/flyteorg/flyte/v2/runs/repository/interfaces"
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

func TestCloudStorageRepoGetByIDRequiresUniqueID(t *testing.T) {
	ctx := context.Background()
	repo := NewCloudStorageRepo(testDB)
	uniqueKey := models.CloudStorageKey{Org: "testorg", Project: "flytesnacks", Domain: "development", ID: "storage-unique"}
	duplicateKeyA := models.CloudStorageKey{Org: "testorg", Project: "flytesnacks", Domain: "development", ID: "storage-duplicate"}
	duplicateKeyB := models.CloudStorageKey{Org: "otherorg", Project: "otherproject", Domain: "development", ID: "storage-duplicate"}
	_ = repo.Delete(ctx, uniqueKey)
	_ = repo.Delete(ctx, duplicateKeyA)
	_ = repo.Delete(ctx, duplicateKeyB)

	require.NoError(t, repo.Create(ctx, &models.CloudStorage{
		CloudStorageKey: uniqueKey,
		Name:            "unique",
		SizeGB:          10,
		StorageClass:    "bj1-ebs",
		Creator:         "test",
	}))
	require.NoError(t, repo.Create(ctx, &models.CloudStorage{
		CloudStorageKey: duplicateKeyA,
		Name:            "duplicate-a",
		SizeGB:          10,
		StorageClass:    "bj1-ebs",
		Creator:         "test",
	}))
	require.NoError(t, repo.Create(ctx, &models.CloudStorage{
		CloudStorageKey: duplicateKeyB,
		Name:            "duplicate-b",
		SizeGB:          10,
		StorageClass:    "bj1-ebs",
		Creator:         "test",
	}))

	got, err := repo.GetByID(ctx, "storage-unique")
	require.NoError(t, err)
	require.Equal(t, uniqueKey, got.CloudStorageKey)

	_, err = repo.GetByID(ctx, "storage-missing")
	require.Error(t, err)

	_, err = repo.GetByID(ctx, "storage-duplicate")
	require.ErrorIs(t, err, interfaces.ErrCloudStorageIDAmbiguous)

	require.NoError(t, repo.Delete(ctx, uniqueKey))
	require.NoError(t, repo.Delete(ctx, duplicateKeyA))
	require.NoError(t, repo.Delete(ctx, duplicateKeyB))
}

func TestCloudStorageRepoClearMaterializations(t *testing.T) {
	ctx := context.Background()
	repo := NewCloudStorageRepo(testDB)
	key := models.CloudStorageKey{
		Org:     "testorg",
		Project: "flytesnacks",
		Domain:  "development",
		ID:      "storage-clear",
	}
	_ = repo.Delete(ctx, key)
	require.NoError(t, repo.Create(ctx, &models.CloudStorage{
		CloudStorageKey: key,
		Name:            "clear-me",
		SizeGB:          10,
		StorageClass:    "bj1-ebs",
		Creator:         "test",
	}))
	require.NoError(t, repo.SetMaterialized(ctx, key, "flyte", "storage-clear-flyte"))
	require.NoError(t, repo.SetMaterialized(ctx, key, "flyte-dev", "storage-clear-dev"))

	materialized, err := repo.Get(ctx, key)
	require.NoError(t, err)
	require.Len(t, materialized.Materializations, 2)

	require.NoError(t, repo.ClearMaterializations(ctx, key))
	cleared, err := repo.Get(ctx, key)
	require.NoError(t, err)
	require.Empty(t, cleared.Materializations)
	require.Empty(t, cleared.TargetNamespace)
	require.Empty(t, cleared.PVCName)
	require.True(t, cleared.MaterializedAt.IsZero())

	require.NoError(t, repo.Delete(ctx, key))
}
