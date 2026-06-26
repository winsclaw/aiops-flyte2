package impl

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/flyteorg/flyte/v2/runs/repository/interfaces"
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
		TrainingTaskKey:          key,
		Name:                     "任务1",
		Description:              "desc",
		ResourceSpecID:           "rtx3090-8c-48g-1x",
		ResourceDisplay:          "8vCPU, 48GiB RAM, 1*NVIDIA RTX 3090, 1Gbps",
		CPU:                      "8",
		Memory:                   "48Gi",
		GPUCount:                 1,
		GPUModel:                 "NVIDIA RTX 3090",
		Bandwidth:                "1Gbps",
		Command:                  "echo hello",
		MaxRuntimeHours:          1,
		ImageType:                "official",
		OfficialImageID:          "busybox",
		ImageName:                "BusyBox",
		ImageURI:                 "busybox:1.36",
		Creator:                  "ljgong",
		CodeRepositoryMountsJSON: `[{"codeRepositoryId":"repo-1","repoUrl":"https://git.fzyun.io/serverless/aione.git","branch":"main","mountPath":"/workspace/aione"}]`,
	}
	require.NoError(t, repo.Create(ctx, task))

	got, err := repo.Get(ctx, key)
	require.NoError(t, err)
	require.Equal(t, "任务1", got.Name)
	require.Equal(t, "echo hello", got.Command)
	require.Len(t, got.SelectedCodeRepositoryMounts(), 1)
	require.Equal(t, "repo-1", got.SelectedCodeRepositoryMounts()[0].CodeRepositoryID)
	require.Equal(t, "main", got.SelectedCodeRepositoryMounts()[0].Branch)
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

func TestTrainingTaskRepoGetByIDRequiresUniqueID(t *testing.T) {
	ctx := context.Background()
	repo := NewTrainingTaskRepo(testDB)
	uniqueKey := models.TrainingTaskKey{Org: "testorg", Project: "flytesnacks", Domain: "development", ID: "train-unique"}
	duplicateKeyA := models.TrainingTaskKey{Org: "testorg", Project: "flytesnacks", Domain: "development", ID: "train-duplicate"}
	duplicateKeyB := models.TrainingTaskKey{Org: "otherorg", Project: "otherproject", Domain: "development", ID: "train-duplicate"}
	_ = repo.Delete(ctx, uniqueKey)
	_ = repo.Delete(ctx, duplicateKeyA)
	_ = repo.Delete(ctx, duplicateKeyB)

	require.NoError(t, repo.Create(ctx, trainingTaskModelForRepoTest(uniqueKey, "unique")))
	require.NoError(t, repo.Create(ctx, trainingTaskModelForRepoTest(duplicateKeyA, "duplicate-a")))
	require.NoError(t, repo.Create(ctx, trainingTaskModelForRepoTest(duplicateKeyB, "duplicate-b")))

	got, err := repo.GetByID(ctx, "train-unique")
	require.NoError(t, err)
	require.Equal(t, uniqueKey, got.TrainingTaskKey)

	_, err = repo.GetByID(ctx, "train-missing")
	require.Error(t, err)

	_, err = repo.GetByID(ctx, "train-duplicate")
	require.ErrorIs(t, err, interfaces.ErrTrainingTaskIDAmbiguous)

	require.NoError(t, repo.Delete(ctx, uniqueKey))
	require.NoError(t, repo.Delete(ctx, duplicateKeyA))
	require.NoError(t, repo.Delete(ctx, duplicateKeyB))
}

func trainingTaskModelForRepoTest(key models.TrainingTaskKey, name string) *models.TrainingTask {
	return &models.TrainingTask{
		TrainingTaskKey: key,
		Name:            name,
		ResourceSpecID:  "cpu-1c-2g",
		ResourceDisplay: "1vCPU, 2GiB RAM, 1Gbps",
		CPU:             "1",
		Memory:          "2Gi",
		Command:         "echo hello",
		MaxRuntimeHours: 1,
		ImageType:       "official",
		OfficialImageID: "busybox",
		ImageName:       "BusyBox",
		ImageURI:        "busybox:1.36",
		Creator:         "test",
	}
}
