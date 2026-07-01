package interfaces

import (
	"context"
	"errors"

	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

var (
	ErrDevelopmentInstanceAlreadyExists = errors.New("development instance already exists")
)

type DevelopmentInstanceRepo interface {
	Create(ctx context.Context, instance *models.DevelopmentInstance) error
	Get(ctx context.Context, key models.DevelopmentInstanceKey) (*models.DevelopmentInstance, error)
	GetByID(ctx context.Context, id string) (*models.DevelopmentInstance, error)
	Update(ctx context.Context, instance *models.DevelopmentInstance) error
	Delete(ctx context.Context, key models.DevelopmentInstanceKey) error
	List(ctx context.Context, input models.DevelopmentInstanceListInput) (*models.DevelopmentInstanceListResult, error)
	AppendRun(ctx context.Context, run *models.DevelopmentInstanceRun) error
	UpdateRun(ctx context.Context, run *models.DevelopmentInstanceRun) error
	GetLatestRun(ctx context.Context, instanceID string) (*models.DevelopmentInstanceRun, error)
	ListRuns(ctx context.Context, input models.DevelopmentInstanceRunListInput) (*models.DevelopmentInstanceRunListResult, error)
}
