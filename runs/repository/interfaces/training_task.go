package interfaces

import (
	"context"
	"errors"

	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

var ErrTrainingTaskIDAmbiguous = errors.New("training task id is ambiguous")

type TrainingTaskRepo interface {
	Create(ctx context.Context, task *models.TrainingTask) error
	Get(ctx context.Context, key models.TrainingTaskKey) (*models.TrainingTask, error)
	GetByID(ctx context.Context, id string) (*models.TrainingTask, error)
	Update(ctx context.Context, task *models.TrainingTask) error
	Delete(ctx context.Context, key models.TrainingTaskKey) error
	List(ctx context.Context, input models.TrainingTaskListInput) (*models.TrainingTaskListResult, error)
	SetLatestRun(ctx context.Context, key models.TrainingTaskKey, runName string) error
}
