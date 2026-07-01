package impl

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/flyteorg/flyte/v2/runs/repository/interfaces"
	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

func TestDevelopmentInstanceRepoCreateGetListUpdateSoftDelete(t *testing.T) {
	ctx := context.Background()
	repo := NewDevelopmentInstanceRepo(testDB)
	key := models.DevelopmentInstanceKey{ID: "ins-repo-1"}
	_ = repo.Delete(ctx, key)

	instance := developmentInstanceModelForRepoTest(key.ID, "开发实例1")
	require.NoError(t, repo.Create(ctx, instance))

	got, err := repo.Get(ctx, key)
	require.NoError(t, err)
	require.Equal(t, "开发实例1", got.Name)
	require.Equal(t, "testorg", got.Org)
	require.Len(t, got.SelectedCloudStorageMounts(), 1)
	require.Equal(t, "cs-1", got.SelectedCloudStorageMounts()[0].CloudStorageID)
	require.False(t, got.CreatedAt.IsZero())
	require.False(t, got.UpdatedAt.IsZero())

	got.Description = "updated"
	got.Status = models.DevelopmentInstanceStatusRunning
	got.Generation = 1
	got.LatestRunName = "ins-repo-1-r1"
	require.NoError(t, repo.Update(ctx, got))
	updated, err := repo.GetByID(ctx, key.ID)
	require.NoError(t, err)
	require.Equal(t, "updated", updated.Description)
	require.Equal(t, models.DevelopmentInstanceStatusRunning, updated.Status)
	require.Equal(t, uint32(1), updated.Generation)
	require.Equal(t, "ins-repo-1-r1", updated.LatestRunName)

	list, err := repo.List(ctx, models.DevelopmentInstanceListInput{
		Org:     "testorg",
		Project: "flytesnacks",
		Domain:  "development",
		Limit:   20,
	})
	require.NoError(t, err)
	require.Len(t, list.Items, 1)
	require.Equal(t, uint32(1), list.Total)

	require.NoError(t, repo.Delete(ctx, key))
	_, err = repo.Get(ctx, key)
	require.Error(t, err)
}

func TestDevelopmentInstanceRepoCreateReturnsAlreadyExists(t *testing.T) {
	ctx := context.Background()
	repo := NewDevelopmentInstanceRepo(testDB)
	key := models.DevelopmentInstanceKey{ID: "ins-repo-duplicate"}
	_ = repo.Delete(ctx, key)

	require.NoError(t, repo.Create(ctx, developmentInstanceModelForRepoTest(key.ID, "开发实例1")))
	err := repo.Create(ctx, developmentInstanceModelForRepoTest(key.ID, "开发实例2"))

	require.ErrorIs(t, err, interfaces.ErrDevelopmentInstanceAlreadyExists)
	require.False(t, strings.Contains(strings.ToUpper(err.Error()), "UNIQUE"))
	require.False(t, strings.Contains(strings.ToUpper(err.Error()), "DUPLICATE KEY"))

	require.NoError(t, repo.Delete(ctx, key))
}

func TestDevelopmentInstanceRepoCreateRestoresSoftDeletedInstance(t *testing.T) {
	ctx := context.Background()
	repo := NewDevelopmentInstanceRepo(testDB)
	key := models.DevelopmentInstanceKey{ID: "ins-repo-restore"}
	_ = repo.Delete(ctx, key)

	deleted := developmentInstanceModelForRepoTest(key.ID, "旧开发实例")
	deleted.Generation = 2
	deleted.Status = models.DevelopmentInstanceStatusRunning
	deleted.LatestRunName = "ins-repo-restore-r2"
	require.NoError(t, repo.Create(ctx, deleted))
	require.NoError(t, repo.Delete(ctx, key))
	_, err := repo.Get(ctx, key)
	require.Error(t, err)

	restored := developmentInstanceModelForRepoTest(key.ID, "新开发实例")
	restored.Generation = 0
	restored.Status = models.DevelopmentInstanceStatusNotStarted
	restored.LatestRunName = ""
	require.NoError(t, repo.Create(ctx, restored))

	got, err := repo.Get(ctx, key)
	require.NoError(t, err)
	require.Equal(t, "新开发实例", got.Name)
	require.Equal(t, models.DevelopmentInstanceStatusNotStarted, got.Status)
	require.Equal(t, uint32(2), got.Generation)
	require.Empty(t, got.LatestRunName)
	require.Nil(t, got.DeletedAt)

	require.NoError(t, repo.Delete(ctx, key))
}

func TestDevelopmentInstanceRepoRunHistory(t *testing.T) {
	ctx := context.Background()
	repo := NewDevelopmentInstanceRepo(testDB)
	key := models.DevelopmentInstanceKey{ID: "ins-runs-1"}
	_ = repo.Delete(ctx, key)
	require.NoError(t, repo.Create(ctx, developmentInstanceModelForRepoTest(key.ID, "开发实例历史")))

	started := time.Now().UTC().Truncate(time.Microsecond)
	run := &models.DevelopmentInstanceRun{
		InstanceID: key.ID,
		Org:        "testorg",
		Project:    "flytesnacks",
		Domain:     "development",
		RunName:    "ins-runs-1-r1",
		Generation: 1,
		Status:     models.DevelopmentInstanceStatusStarting,
		NodePort:   31000,
		StartedAt:  &started,
	}
	require.NoError(t, repo.AppendRun(ctx, run))

	latest, err := repo.GetLatestRun(ctx, key.ID)
	require.NoError(t, err)
	require.Equal(t, "ins-runs-1-r1", latest.RunName)
	require.Equal(t, models.DevelopmentInstanceStatusStarting, latest.Status)

	ended := started.Add(time.Minute)
	latest.Status = models.DevelopmentInstanceStatusStopped
	latest.EndedAt = &ended
	require.NoError(t, repo.UpdateRun(ctx, latest))

	history, err := repo.ListRuns(ctx, models.DevelopmentInstanceRunListInput{
		InstanceID: key.ID,
		Limit:      20,
	})
	require.NoError(t, err)
	require.Equal(t, uint32(1), history.Total)
	require.Len(t, history.Items, 1)
	require.Equal(t, models.DevelopmentInstanceStatusStopped, history.Items[0].Status)
	require.NotNil(t, history.Items[0].EndedAt)

	require.NoError(t, repo.Delete(ctx, key))
}

func developmentInstanceModelForRepoTest(id, name string) *models.DevelopmentInstance {
	return &models.DevelopmentInstance{
		DevelopmentInstanceKey: models.DevelopmentInstanceKey{ID: id},
		Org:                    "testorg",
		Project:                "flytesnacks",
		Domain:                 "development",
		Name:                   name,
		Description:            "desc",
		Owner:                  "tester",
		SourceSystem:           "console",
		ResourceDisplay:        "1vCPU, 2GiB RAM, 1Gbps",
		CPU:                    "1",
		Memory:                 "2Gi",
		Bandwidth:              "1Gbps",
		WorkspaceSize:          "20Gi",
		MaxHours:               24,
		ImageType:              "official",
		OfficialImageID:        "flyte-py311-v251",
		ImageName:              "Flyte Python 3.11 v2.5.1",
		ImageURI:               "ghcr.fzyun.io/flyteorg/flyte:py3.11-v2.5.1",
		SSHUser:                "dev",
		EnableSSH:              false,
		AuthorizedKeysJSON:     "[]",
		WorkspacePVCName:       id + "-workspace",
		Status:                 models.DevelopmentInstanceStatusNotStarted,
		CloudStorageMountsJSON: `[{"cloudStorageId":"cs-1","mountPath":"/mnt/storage"}]`,
	}
}
