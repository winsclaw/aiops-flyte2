package interfaces

import (
	"context"

	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

type CloudStorageRepo interface {
	Create(ctx context.Context, storage *models.CloudStorage) error
	Get(ctx context.Context, key models.CloudStorageKey) (*models.CloudStorage, error)
	Delete(ctx context.Context, key models.CloudStorageKey) error
	List(ctx context.Context, input models.CloudStorageListInput) (*models.CloudStorageListResult, error)
	SetMaterialized(ctx context.Context, key models.CloudStorageKey, namespace, pvcName string) error
	ListMaterializations(ctx context.Context, key models.CloudStorageKey) ([]models.CloudStoragePVC, error)
}
