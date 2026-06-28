package interfaces

import (
	"context"

	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

type DatasetRepo interface {
	Create(ctx context.Context, dataset *models.Dataset) error
	Get(ctx context.Context, key models.DatasetKey) (*models.Dataset, error)
	Update(ctx context.Context, dataset *models.Dataset) error
	Delete(ctx context.Context, key models.DatasetKey) error
	List(ctx context.Context, input models.DatasetListInput) (*models.DatasetListResult, error)
}
