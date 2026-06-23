package interfaces

import (
	"context"

	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

type TrainingTaskRepo interface {
	Create(ctx context.Context, task *models.TrainingTask) error
	Get(ctx context.Context, key models.TrainingTaskKey) (*models.TrainingTask, error)
	Update(ctx context.Context, task *models.TrainingTask) error
	Delete(ctx context.Context, key models.TrainingTaskKey) error
	List(ctx context.Context, input models.TrainingTaskListInput) (*models.TrainingTaskListResult, error)
	SetLatestRun(ctx context.Context, key models.TrainingTaskKey, runName string) error
}
