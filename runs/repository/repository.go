package repository

import (
	"fmt"

	"github.com/jmoiron/sqlx"

	"github.com/flyteorg/flyte/v2/flytestdlib/database"
	"github.com/flyteorg/flyte/v2/runs/repository/impl"
	"github.com/flyteorg/flyte/v2/runs/repository/interfaces"
)

// repository implements the Repository interface
type repository struct {
	actionRepo         interfaces.ActionRepo
	taskRepo           interfaces.TaskRepo
	triggerRepo        interfaces.TriggerRepo
	trainingTaskRepo   interfaces.TrainingTaskRepo
	developmentRepo    interfaces.DevelopmentInstanceRepo
	cloudStorageRepo   interfaces.CloudStorageRepo
	codeRepositoryRepo interfaces.CodeRepositoryRepo
}

// NewRepository creates a new Repository instance
func NewRepository(db *sqlx.DB, dbConfig database.DbConfig) (interfaces.Repository, error) {
	actionRepo, err := impl.NewActionRepo(db, dbConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create action repo: %w", err)
	}
	return &repository{
		actionRepo:         actionRepo,
		taskRepo:           impl.NewTaskRepo(db),
		triggerRepo:        impl.NewTriggerRepo(db),
		trainingTaskRepo:   impl.NewTrainingTaskRepo(db),
		developmentRepo:    impl.NewDevelopmentInstanceRepo(db),
		cloudStorageRepo:   impl.NewCloudStorageRepo(db),
		codeRepositoryRepo: impl.NewCodeRepositoryRepo(db),
	}, nil
}

// ActionRepo returns the action repository
func (r *repository) ActionRepo() interfaces.ActionRepo {
	return r.actionRepo
}

// TaskRepo returns the task repository
func (r *repository) TaskRepo() interfaces.TaskRepo {
	return r.taskRepo
}

// TriggerRepo returns the trigger repository
func (r *repository) TriggerRepo() interfaces.TriggerRepo {
	return r.triggerRepo
}

// TrainingTaskRepo returns the training task repository
func (r *repository) TrainingTaskRepo() interfaces.TrainingTaskRepo {
	return r.trainingTaskRepo
}

// DevelopmentInstanceRepo returns the development instance repository.
func (r *repository) DevelopmentInstanceRepo() interfaces.DevelopmentInstanceRepo {
	return r.developmentRepo
}

// CloudStorageRepo returns the Aione cloud storage repository.
func (r *repository) CloudStorageRepo() interfaces.CloudStorageRepo {
	return r.cloudStorageRepo
}

// CodeRepositoryRepo returns the Aione code repository repository.
func (r *repository) CodeRepositoryRepo() interfaces.CodeRepositoryRepo {
	return r.codeRepositoryRepo
}
