package cloudstorage

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/require"

	cloudstoragepb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/cloudstorage"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/common"
	"github.com/flyteorg/flyte/v2/runs/repository/interfaces"
	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

func TestCloudStorageServiceCreateKeepsPVCDeferred(t *testing.T) {
	repo := newFakeCloudStorageRepo()
	svc := NewService(repo)

	resp, err := svc.CreateCloudStorage(context.Background(), connect.NewRequest(&cloudstoragepb.CreateCloudStorageRequest{
		Project: &common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"},
		Creator: "liu.cd",
		CloudStorage: &cloudstoragepb.CloudStorageInput{
			Name:        "storage-disk",
			Description: "shared data",
			SizeGb:      100,
		},
	}))

	require.NoError(t, err)
	got := resp.Msg.GetCloudStorage()
	require.NotEmpty(t, got.GetId().GetId())
	require.Equal(t, "storage-disk", got.GetName())
	require.Equal(t, uint32(100), got.GetSizeGb())
	require.Equal(t, DefaultStorageClassName, got.GetStorageClassName())
	require.Equal(t, cloudstoragepb.CloudStorageStatus_CLOUD_STORAGE_STATUS_PENDING, got.GetStatus())
	require.Empty(t, got.GetTargetNamespace())
	require.Empty(t, got.GetPvcName())

	saved := repo.items[got.GetId().GetId()]
	require.Empty(t, saved.TargetNamespace)
	require.Empty(t, saved.PVCName)
}

func TestCloudStorageServiceMaterializeWritesRuntimePVC(t *testing.T) {
	repo := newFakeCloudStorageRepo()
	svc := NewService(repo)
	repo.items["cs-1"] = &models.CloudStorage{
		CloudStorageKey: models.CloudStorageKey{Org: "testorg", Project: "flytesnacks", Domain: "development", ID: "cs-1"},
		Name:            "storage-disk",
		SizeGB:          100,
		StorageClass:    DefaultStorageClassName,
	}

	resp, err := svc.MaterializeCloudStorage(context.Background(), connect.NewRequest(&cloudstoragepb.MaterializeCloudStorageRequest{
		Id:              &cloudstoragepb.CloudStorageIdentifier{Org: "testorg", Project: "flytesnacks", Domain: "development", Id: "cs-1"},
		TargetNamespace: "flytesnacks-development",
		PvcName:         "cs-cs-1",
	}))

	require.NoError(t, err)
	require.Equal(t, cloudstoragepb.CloudStorageStatus_CLOUD_STORAGE_STATUS_MATERIALIZED, resp.Msg.GetCloudStorage().GetStatus())
	require.Equal(t, "flytesnacks-development", resp.Msg.GetCloudStorage().GetTargetNamespace())
	require.Equal(t, "cs-cs-1", resp.Msg.GetCloudStorage().GetPvcName())
}

func TestCloudStorageServiceGetCloudStorageById(t *testing.T) {
	repo := newFakeCloudStorageRepo()
	svc := NewService(repo)
	repo.items["cs-1"] = &models.CloudStorage{
		CloudStorageKey: models.CloudStorageKey{Org: "testorg", Project: "flytesnacks", Domain: "development", ID: "cs-1"},
		Name:            "storage-disk",
		SizeGB:          100,
		StorageClass:    DefaultStorageClassName,
	}

	resp, err := svc.GetCloudStorageById(context.Background(), connect.NewRequest(&cloudstoragepb.GetCloudStorageByIdRequest{
		Id: "cs-1",
	}))

	require.NoError(t, err)
	require.Equal(t, "cs-1", resp.Msg.GetCloudStorage().GetId().GetId())
}

func TestCloudStorageServiceGetCloudStorageByIdRejectsAmbiguousID(t *testing.T) {
	repo := newFakeCloudStorageRepo()
	svc := NewService(repo)
	repo.ambiguousIDs["cs-1"] = true

	_, err := svc.GetCloudStorageById(context.Background(), connect.NewRequest(&cloudstoragepb.GetCloudStorageByIdRequest{
		Id: "cs-1",
	}))

	require.Error(t, err)
	require.Contains(t, err.Error(), "failed_precondition")
}

func TestCloudStorageServiceClearMaterializations(t *testing.T) {
	repo := newFakeCloudStorageRepo()
	svc := NewService(repo)
	repo.items["cs-1"] = &models.CloudStorage{
		CloudStorageKey: models.CloudStorageKey{Org: "testorg", Project: "flytesnacks", Domain: "development", ID: "cs-1"},
		Name:            "storage-disk",
		SizeGB:          100,
		StorageClass:    DefaultStorageClassName,
	}
	repo.materializations["cs-1"] = []models.CloudStoragePVC{
		{CloudStorageKey: repo.items["cs-1"].CloudStorageKey, TargetNamespace: "flyte", PVCName: "cs-cs-1"},
	}

	_, err := svc.ClearCloudStorageMaterializations(context.Background(), connect.NewRequest(&cloudstoragepb.ClearCloudStorageMaterializationsRequest{
		Id: &cloudstoragepb.CloudStorageIdentifier{Org: "testorg", Project: "flytesnacks", Domain: "development", Id: "cs-1"},
	}))

	require.NoError(t, err)
	require.Empty(t, repo.materializations["cs-1"])
}

type fakeCloudStorageRepo struct {
	items            map[string]*models.CloudStorage
	materializations map[string][]models.CloudStoragePVC
	ambiguousIDs     map[string]bool
}

func newFakeCloudStorageRepo() *fakeCloudStorageRepo {
	return &fakeCloudStorageRepo{
		items:            map[string]*models.CloudStorage{},
		materializations: map[string][]models.CloudStoragePVC{},
		ambiguousIDs:     map[string]bool{},
	}
}

func (r *fakeCloudStorageRepo) Create(_ context.Context, storage *models.CloudStorage) error {
	copy := *storage
	r.items[storage.ID] = &copy
	return nil
}

func (r *fakeCloudStorageRepo) Get(_ context.Context, key models.CloudStorageKey) (*models.CloudStorage, error) {
	storage := r.items[key.ID]
	if storage == nil {
		return nil, fmt.Errorf("not found")
	}
	copy := *storage
	copy.Materializations = r.materializations[key.ID]
	if len(copy.Materializations) > 0 {
		copy.TargetNamespace = copy.Materializations[0].TargetNamespace
		copy.PVCName = copy.Materializations[0].PVCName
		copy.MaterializedAt = copy.Materializations[0].MaterializedAt
	}
	return &copy, nil
}

func (r *fakeCloudStorageRepo) GetByID(_ context.Context, id string) (*models.CloudStorage, error) {
	if r.ambiguousIDs[id] {
		return nil, interfaces.ErrCloudStorageIDAmbiguous
	}
	storage := r.items[id]
	if storage == nil {
		return nil, fmt.Errorf("not found")
	}
	copy := *storage
	copy.Materializations = r.materializations[id]
	return &copy, nil
}

func (r *fakeCloudStorageRepo) Delete(_ context.Context, key models.CloudStorageKey) error {
	delete(r.items, key.ID)
	return nil
}

func (r *fakeCloudStorageRepo) List(_ context.Context, input models.CloudStorageListInput) (*models.CloudStorageListResult, error) {
	items := make([]*models.CloudStorage, 0, len(r.items))
	for _, item := range r.items {
		if input.Search != "" && !strings.Contains(item.Name, input.Search) {
			continue
		}
		copy := *item
		items = append(items, &copy)
	}
	return &models.CloudStorageListResult{Items: items, Total: uint32(len(items))}, nil
}

func (r *fakeCloudStorageRepo) SetMaterialized(_ context.Context, key models.CloudStorageKey, namespace, pvcName string) error {
	storage := r.items[key.ID]
	if storage == nil {
		return fmt.Errorf("not found")
	}
	r.materializations[key.ID] = append(r.materializations[key.ID], models.CloudStoragePVC{
		CloudStorageKey: key,
		TargetNamespace: namespace,
		PVCName:         pvcName,
	})
	return nil
}

func (r *fakeCloudStorageRepo) ListMaterializations(_ context.Context, key models.CloudStorageKey) ([]models.CloudStoragePVC, error) {
	return r.materializations[key.ID], nil
}

func (r *fakeCloudStorageRepo) ClearMaterializations(_ context.Context, key models.CloudStorageKey) error {
	r.materializations[key.ID] = nil
	return nil
}
