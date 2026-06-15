package impl

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

func TestTrainingTaskRepoCreateGetListUpdateDelete(t *testing.T) {
	ctx := context.Background()
	repo := NewTrainingTaskRepo(testDB)
	key := models.TrainingTaskKey{
		Org:     "testorg",
		Project: "flytesnacks",
		Domain:  "development",
		ID:      "train-1",
	}
	_ = repo.Delete(ctx, key)

	task := &models.TrainingTask{
		TrainingTaskKey: key,
		Name:            "任务1",
		Description:     "desc",
		ResourceSpecID:  "rtx3090-8c-48g-1x",
		ResourceDisplay: "8vCPU, 48GiB RAM, 1*NVIDIA RTX 3090, 1Gbps",
		CPU:             "8",
		Memory:          "48Gi",
		GPUCount:        1,
		GPUModel:        "NVIDIA RTX 3090",
		Bandwidth:       "1Gbps",
		Command:         "echo hello",
		MaxRuntimeHours: 1,
		ImageType:       "official",
		OfficialImageID: "busybox",
		ImageName:       "BusyBox",
		ImageURI:        "busybox:1.36",
		Creator:         "ljgong",
	}
	require.NoError(t, repo.Create(ctx, task))

	got, err := repo.Get(ctx, key)
	require.NoError(t, err)
	require.Equal(t, "任务1", got.Name)
	require.Equal(t, "echo hello", got.Command)
	require.False(t, got.CreatedAt.IsZero())
	require.False(t, got.UpdatedAt.IsZero())

	got.Description = "updated"
	require.NoError(t, repo.Update(ctx, got))
	updated, err := repo.Get(ctx, key)
	require.NoError(t, err)
	require.Equal(t, "updated", updated.Description)

	require.NoError(t, repo.SetLatestRun(ctx, key, "run-abc"))
	withRun, err := repo.Get(ctx, key)
	require.NoError(t, err)
	require.Equal(t, "run-abc", withRun.LatestRunName)

	list, err := repo.List(ctx, models.TrainingTaskListInput{
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
