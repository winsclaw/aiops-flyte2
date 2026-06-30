package dataset

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/require"

	datasetpb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/dataset"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/common"
	"github.com/flyteorg/flyte/v2/runs/repository/interfaces"
	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

func TestDatasetServiceCreateNormalizesFolderPath(t *testing.T) {
	datasets := newFakeDatasetRepo()
	svc := NewService(datasets)

	resp, err := svc.CreateDataset(context.Background(), connect.NewRequest(&datasetpb.CreateDatasetRequest{
		Project: &common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"},
		Creator: "ljgong",
		Dataset: &datasetpb.DatasetInput{
			Name:        "语音识别",
			Description: "training speech",
			Endpoint:    "minio.flyte.svc",
			Port:        "9000",
			AccessKey:   "rustfs",
			SecretKey:   "rustfsstorage",
			TargetPath:  "/mnt/datasets",
			Bucket:      "datasets",
			BucketPath:  "/data/speech/",
		},
	}))

	require.NoError(t, err)
	got := resp.Msg.GetDataset()
	require.True(t, strings.HasPrefix(got.GetId().GetId(), "ds-"))
	require.Equal(t, "语音识别", got.GetName())
	require.Equal(t, "minio.flyte.svc", got.GetEndpoint())
	require.Equal(t, "9000", got.GetPort())
	require.Equal(t, "rustfs", got.GetAccessKey())
	require.Empty(t, got.GetSecretKey())
	require.Equal(t, "/mnt/datasets", got.GetTargetPath())
	require.Equal(t, "datasets", got.GetBucket())
	require.Equal(t, "data/speech/", got.GetBucketPath())
	require.Equal(t, "ljgong", got.GetCreator())

	stored := datasets.items[got.GetId().GetId()]
	require.NotEmpty(t, stored.SecretKeyCiphertext)
	require.NotEqual(t, "rustfsstorage", stored.SecretKeyCiphertext)
}

func TestDatasetServiceCreateRejectsInvalidInput(t *testing.T) {
	svc := NewService(newFakeDatasetRepo())

	_, err := svc.CreateDataset(context.Background(), connect.NewRequest(&datasetpb.CreateDatasetRequest{
		Project: &common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"},
		Dataset: &datasetpb.DatasetInput{
			Name: "",
		},
	}))
	require.Error(t, err)
	require.Contains(t, err.Error(), "name is required")

	_, err = svc.CreateDataset(context.Background(), connect.NewRequest(&datasetpb.CreateDatasetRequest{
		Project: &common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"},
		Dataset: &datasetpb.DatasetInput{
			Name:       "bad-endpoint",
			Endpoint:   "http://minio.flyte.svc",
			Port:       "9000",
			AccessKey:  "rustfs",
			SecretKey:  "rustfsstorage",
			TargetPath: "/mnt/datasets",
			Bucket:     "datasets",
		},
	}))
	require.Error(t, err)
	require.Contains(t, err.Error(), "endpoint must not include a URL scheme")

	_, err = svc.CreateDataset(context.Background(), connect.NewRequest(&datasetpb.CreateDatasetRequest{
		Project: &common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"},
		Dataset: &datasetpb.DatasetInput{
			Name:       "bad-path",
			Endpoint:   "minio.flyte.svc",
			Port:       "9000",
			AccessKey:  "rustfs",
			SecretKey:  "rustfsstorage",
			TargetPath: "/mnt/datasets",
			Bucket:     "datasets",
			BucketPath: "http://example.test/data",
		},
	}))
	require.Error(t, err)
	require.Contains(t, err.Error(), "bucket path cannot contain .., backslash, or URL scheme")
}

func TestDatasetServiceCreateRejectsMissingObjectStorageFields(t *testing.T) {
	svc := NewService(newFakeDatasetRepo())

	_, err := svc.CreateDataset(context.Background(), connect.NewRequest(&datasetpb.CreateDatasetRequest{
		Project: &common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"},
		Dataset: &datasetpb.DatasetInput{
			Name:      "missing-bucket",
			Endpoint:  "minio.flyte.svc",
			Port:      "9000",
			AccessKey: "rustfs",
			SecretKey: "rustfsstorage",
		},
	}))

	require.Error(t, err)
	require.Contains(t, err.Error(), "target path is required")
}

func TestDatasetServiceUpdateKeepsExistingSecretWhenInputIsEmpty(t *testing.T) {
	datasets := newFakeDatasetRepo()
	key := models.DatasetKey{Org: "testorg", Project: "flytesnacks", Domain: "development", ID: "ds-public"}
	datasets.items[key.ID] = &models.Dataset{
		DatasetKey:          key,
		Name:                "dataset",
		Endpoint:            "minio.flyte.svc",
		Port:                "9000",
		AccessKey:           "rustfs",
		SecretKeyCiphertext: "encrypted-secret",
		TargetPath:          "/mnt/datasets",
		Bucket:              "datasets",
		BucketPath:          "data/speech/",
		Creator:             "ljgong",
	}
	svc := NewService(datasets)

	resp, err := svc.UpdateDataset(context.Background(), connect.NewRequest(&datasetpb.UpdateDatasetRequest{
		Id: &datasetpb.DatasetIdentifier{Org: key.Org, Project: key.Project, Domain: key.Domain, Id: key.ID},
		Dataset: &datasetpb.DatasetInput{
			Name:       "dataset updated",
			Endpoint:   "minio.flyte.svc",
			Port:       "9000",
			AccessKey:  "rustfs",
			TargetPath: "/mnt/datasets",
			Bucket:     "datasets",
			BucketPath: "data/speech/v2/",
		},
	}))

	require.NoError(t, err)
	require.Empty(t, resp.Msg.GetDataset().GetSecretKey())
	require.Equal(t, "encrypted-secret", datasets.items[key.ID].SecretKeyCiphertext)
	require.Equal(t, "data/speech/v2/", datasets.items[key.ID].BucketPath)
}

func TestDatasetServiceListAndDelete(t *testing.T) {
	datasets := newFakeDatasetRepo()
	key := models.DatasetKey{Org: "testorg", Project: "flytesnacks", Domain: "development", ID: "ds-speech"}
	datasets.items[key.ID] = &models.Dataset{
		DatasetKey:  key,
		Name:        "语音识别",
		Description: "speech data",
		Bucket:      "datasets",
		Creator:     "ljgong",
	}
	svc := NewService(datasets)

	list, err := svc.ListDatasets(context.Background(), connect.NewRequest(&datasetpb.ListDatasetsRequest{
		Project: &common.ProjectIdentifier{Organization: key.Org, Name: key.Project, Domain: key.Domain},
		Request: &common.ListRequest{Limit: 20, Filters: []*common.Filter{{Field: "name", Values: []string{"语音"}}}},
	}))
	require.NoError(t, err)
	require.Len(t, list.Msg.GetDatasets(), 1)

	_, err = svc.DeleteDataset(context.Background(), connect.NewRequest(&datasetpb.DeleteDatasetRequest{
		Id: &datasetpb.DatasetIdentifier{Org: key.Org, Project: key.Project, Domain: key.Domain, Id: key.ID},
	}))
	require.NoError(t, err)
	require.Empty(t, datasets.items)
}

type fakeDatasetRepo struct {
	items map[string]*models.Dataset
}

func newFakeDatasetRepo() *fakeDatasetRepo {
	return &fakeDatasetRepo{items: map[string]*models.Dataset{}}
}

func (r *fakeDatasetRepo) Create(_ context.Context, dataset *models.Dataset) error {
	copy := *dataset
	copy.CreatedAt = time.Now()
	copy.UpdatedAt = copy.CreatedAt
	r.items[dataset.ID] = &copy
	return nil
}

func (r *fakeDatasetRepo) Get(_ context.Context, key models.DatasetKey) (*models.Dataset, error) {
	dataset := r.items[key.ID]
	if dataset == nil {
		return nil, fmt.Errorf("dataset not found")
	}
	copy := *dataset
	return &copy, nil
}

func (r *fakeDatasetRepo) Update(_ context.Context, dataset *models.Dataset) error {
	if r.items[dataset.ID] == nil {
		return fmt.Errorf("dataset not found")
	}
	copy := *dataset
	copy.UpdatedAt = time.Now()
	r.items[dataset.ID] = &copy
	return nil
}

func (r *fakeDatasetRepo) Delete(_ context.Context, key models.DatasetKey) error {
	delete(r.items, key.ID)
	return nil
}

func (r *fakeDatasetRepo) List(_ context.Context, input models.DatasetListInput) (*models.DatasetListResult, error) {
	items := make([]*models.Dataset, 0, len(r.items))
	for _, item := range r.items {
		if input.Search != "" && !strings.Contains(item.Name, input.Search) && !strings.Contains(item.Description, input.Search) {
			continue
		}
		copy := *item
		items = append(items, &copy)
	}
	return &models.DatasetListResult{Items: items, Total: uint32(len(items))}, nil
}

type fakeCloudStorageRepo struct {
	items map[string]*models.CloudStorage
}

func newFakeCloudStorageRepo() *fakeCloudStorageRepo {
	return &fakeCloudStorageRepo{items: map[string]*models.CloudStorage{}}
}

func (r *fakeCloudStorageRepo) Create(_ context.Context, storage *models.CloudStorage) error {
	copy := *storage
	r.items[storage.ID] = &copy
	return nil
}

func (r *fakeCloudStorageRepo) Ensure(_ context.Context, storage *models.CloudStorage) (*models.CloudStorage, error) {
	if existing := r.items[storage.ID]; existing != nil {
		copy := *existing
		return &copy, nil
	}
	copy := *storage
	r.items[storage.ID] = &copy
	return &copy, nil
}

func (r *fakeCloudStorageRepo) Get(_ context.Context, key models.CloudStorageKey) (*models.CloudStorage, error) {
	storage := r.items[key.ID]
	if storage == nil {
		return nil, fmt.Errorf("cloud storage not found")
	}
	copy := *storage
	return &copy, nil
}

func (r *fakeCloudStorageRepo) GetByID(_ context.Context, id string) (*models.CloudStorage, error) {
	storage := r.items[id]
	if storage == nil {
		return nil, fmt.Errorf("cloud storage not found")
	}
	copy := *storage
	return &copy, nil
}

func (r *fakeCloudStorageRepo) Delete(_ context.Context, key models.CloudStorageKey) error {
	delete(r.items, key.ID)
	return nil
}

func (r *fakeCloudStorageRepo) List(_ context.Context, input models.CloudStorageListInput) (*models.CloudStorageListResult, error) {
	items := make([]*models.CloudStorage, 0, len(r.items))
	for _, item := range r.items {
		copy := *item
		items = append(items, &copy)
	}
	return &models.CloudStorageListResult{Items: items, Total: uint32(len(items))}, nil
}

func (r *fakeCloudStorageRepo) SetMaterialized(_ context.Context, key models.CloudStorageKey, namespace, pvcName string) error {
	return nil
}

func (r *fakeCloudStorageRepo) ListMaterializations(_ context.Context, key models.CloudStorageKey) ([]models.CloudStoragePVC, error) {
	return nil, nil
}

func (r *fakeCloudStorageRepo) ClearMaterializations(_ context.Context, key models.CloudStorageKey) error {
	return nil
}

var _ interfaces.DatasetRepo = (*fakeDatasetRepo)(nil)
var _ interfaces.CloudStorageRepo = (*fakeCloudStorageRepo)(nil)
