package interfaces

import (
	"context"

	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

type CodeRepositoryRepo interface {
	Create(ctx context.Context, repo *models.CodeRepository) error
	Get(ctx context.Context, key models.CodeRepositoryKey) (*models.CodeRepository, error)
	Update(ctx context.Context, repo *models.CodeRepository) error
	Delete(ctx context.Context, key models.CodeRepositoryKey) error
	List(ctx context.Context, input models.CodeRepositoryListInput) (*models.CodeRepositoryListResult, error)
}
