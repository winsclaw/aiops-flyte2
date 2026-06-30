package impl

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

func TestDatasetRepoCreateGetListUpdateAndDelete(t *testing.T) {
	ctx := context.Background()
	repo := NewDatasetRepo(testDB)
	key := models.DatasetKey{
		Org:     "testorg",
		Project: "flytesnacks",
		Domain:  "development",
		ID:      "ds-1",
	}
	_ = repo.Delete(ctx, key)

	require.NoError(t, repo.Create(ctx, &models.Dataset{
		DatasetKey:          key,
		Name:                "语音识别",
		Description:         "training speech",
		Endpoint:            "http://minio.flyte.svc",
		Port:                "9000",
		AccessKey:           "rustfs",
		SecretKeyCiphertext: "encrypted-secret",
		TargetPath:          "/mnt/datasets",
		Bucket:              "datasets",
		BucketPath:          "data/speech",
		Creator:             "ljgong",
	}))

	got, err := repo.Get(ctx, key)
	require.NoError(t, err)
	require.Equal(t, "语音识别", got.Name)
	require.Equal(t, "training speech", got.Description)
	require.Equal(t, "http://minio.flyte.svc", got.Endpoint)
	require.Equal(t, "9000", got.Port)
	require.Equal(t, "rustfs", got.AccessKey)
	require.Equal(t, "encrypted-secret", got.SecretKeyCiphertext)
	require.Equal(t, "/mnt/datasets", got.TargetPath)
	require.Equal(t, "datasets", got.Bucket)
	require.Equal(t, "data/speech", got.BucketPath)
	require.Equal(t, "ljgong", got.Creator)
	require.False(t, got.CreatedAt.IsZero())

	list, err := repo.List(ctx, models.DatasetListInput{
		Org:     key.Org,
		Project: key.Project,
		Domain:  key.Domain,
		Search:  "语音",
		Limit:   20,
	})
	require.NoError(t, err)
	require.Len(t, list.Items, 1)
	require.Equal(t, uint32(1), list.Total)

	list, err = repo.List(ctx, models.DatasetListInput{
		Org:     key.Org,
		Project: key.Project,
		Domain:  key.Domain,
		Search:  "datasets",
		Limit:   20,
	})
	require.NoError(t, err)
	require.Len(t, list.Items, 1)
	require.Equal(t, uint32(1), list.Total)

	got.Description = "updated"
	got.BucketPath = "data/speech/v2"
	got.SecretKeyCiphertext = "encrypted-secret-v2"
	require.NoError(t, repo.Update(ctx, got))

	updated, err := repo.Get(ctx, key)
	require.NoError(t, err)
	require.Equal(t, "updated", updated.Description)
	require.Equal(t, "data/speech/v2", updated.BucketPath)
	require.Equal(t, "encrypted-secret-v2", updated.SecretKeyCiphertext)
	require.False(t, updated.UpdatedAt.IsZero())

	require.NoError(t, repo.Delete(ctx, key))
	_, err = repo.Get(ctx, key)
	require.Error(t, err)
}
