package impl

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"

	"github.com/flyteorg/flyte/v2/runs/repository/interfaces"
	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

type trainingTaskRepo struct {
	db *sqlx.DB
}

func NewTrainingTaskRepo(db *sqlx.DB) interfaces.TrainingTaskRepo {
	return &trainingTaskRepo{db: db}
}

func (r *trainingTaskRepo) Create(ctx context.Context, task *models.TrainingTask) error {
	_, err := r.db.ExecContext(ctx, `
INSERT INTO training_tasks (
	id, org, project, domain, name, description,
	resource_spec_id, resource_display, cpu, memory, gpu_count, gpu_model, bandwidth,
	command, max_runtime_hours, image_type, official_image_id, image_name, image_uri,
	creator, latest_run_name, cloud_storage_mounts_json, code_repository_mounts_json
) VALUES (
	$1, $2, $3, $4, $5, $6,
	$7, $8, $9, $10, $11, $12, $13,
	$14, $15, $16, $17, $18, $19,
	$20, $21, $22, $23
)`,
		task.ID, task.Org, task.Project, task.Domain, task.Name, task.Description,
		task.ResourceSpecID, task.ResourceDisplay, task.CPU, task.Memory, task.GPUCount, task.GPUModel, task.Bandwidth,
		task.Command, task.MaxRuntimeHours, task.ImageType, task.OfficialImageID, task.ImageName, task.ImageURI,
		task.Creator, task.LatestRunName, task.CloudStorageMountsJSON, task.CodeRepositoryMountsJSON)
	if err != nil {
		return fmt.Errorf("failed to create training task %s/%s/%s/%s: %w", task.Org, task.Project, task.Domain, task.ID, err)
	}
	return nil
}

func (r *trainingTaskRepo) Get(ctx context.Context, key models.TrainingTaskKey) (*models.TrainingTask, error) {
	var task models.TrainingTask
	err := sqlx.GetContext(ctx, r.db, &task, `SELECT * FROM training_tasks WHERE org = $1 AND project = $2 AND domain = $3 AND id = $4`,
		key.Org, key.Project, key.Domain, key.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("training task not found: %s/%s/%s/%s", key.Org, key.Project, key.Domain, key.ID)
		}
		return nil, fmt.Errorf("failed to get training task %s/%s/%s/%s: %w", key.Org, key.Project, key.Domain, key.ID, err)
	}
	return &task, nil
}

func (r *trainingTaskRepo) GetByID(ctx context.Context, id string) (*models.TrainingTask, error) {
	var tasks []models.TrainingTask
	if err := sqlx.SelectContext(ctx, r.db, &tasks, `
SELECT *
FROM training_tasks
WHERE id = $1
ORDER BY created_at DESC
LIMIT 2`, id); err != nil {
		return nil, fmt.Errorf("failed to get training task by id %s: %w", id, err)
	}
	if len(tasks) == 0 {
		return nil, fmt.Errorf("training task not found: %s", id)
	}
	if len(tasks) > 1 {
		return nil, fmt.Errorf("%w: %s", interfaces.ErrTrainingTaskIDAmbiguous, id)
	}
	return &tasks[0], nil
}

func (r *trainingTaskRepo) Update(ctx context.Context, task *models.TrainingTask) error {
	result, err := r.db.ExecContext(ctx, `
UPDATE training_tasks SET
	name = $5,
	description = $6,
	resource_spec_id = $7,
	resource_display = $8,
	cpu = $9,
	memory = $10,
	gpu_count = $11,
	gpu_model = $12,
	bandwidth = $13,
	command = $14,
	max_runtime_hours = $15,
	image_type = $16,
	official_image_id = $17,
	image_name = $18,
	image_uri = $19,
	cloud_storage_mounts_json = $20,
	code_repository_mounts_json = $21,
	updated_at = NOW()
WHERE org = $1 AND project = $2 AND domain = $3 AND id = $4`,
		task.Org, task.Project, task.Domain, task.ID,
		task.Name, task.Description, task.ResourceSpecID, task.ResourceDisplay,
		task.CPU, task.Memory, task.GPUCount, task.GPUModel, task.Bandwidth,
		task.Command, task.MaxRuntimeHours, task.ImageType, task.OfficialImageID, task.ImageName, task.ImageURI, task.CloudStorageMountsJSON, task.CodeRepositoryMountsJSON)
	if err != nil {
		return fmt.Errorf("failed to update training task %s/%s/%s/%s: %w", task.Org, task.Project, task.Domain, task.ID, err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return fmt.Errorf("training task not found: %s/%s/%s/%s", task.Org, task.Project, task.Domain, task.ID)
	}
	return nil
}

func (r *trainingTaskRepo) Delete(ctx context.Context, key models.TrainingTaskKey) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM training_tasks WHERE org = $1 AND project = $2 AND domain = $3 AND id = $4`,
		key.Org, key.Project, key.Domain, key.ID)
	if err != nil {
		return fmt.Errorf("failed to delete training task %s/%s/%s/%s: %w", key.Org, key.Project, key.Domain, key.ID, err)
	}
	return nil
}

func (r *trainingTaskRepo) List(ctx context.Context, input models.TrainingTaskListInput) (*models.TrainingTaskListResult, error) {
	limit := input.Limit
	if limit == 0 {
		limit = 50
	}

	where := []string{"org = $1", "project = $2", "domain = $3"}
	args := []any{input.Org, input.Project, input.Domain}
	if strings.TrimSpace(input.Search) != "" {
		args = append(args, "%"+strings.ToLower(strings.TrimSpace(input.Search))+"%")
		where = append(where, fmt.Sprintf("(LOWER(name) LIKE $%d OR LOWER(description) LIKE $%d)", len(args), len(args)))
	}
	args = append(args, limit, input.Offset)
	query := fmt.Sprintf(`
SELECT *, COUNT(*) OVER() AS total
FROM training_tasks
WHERE %s
ORDER BY created_at DESC
LIMIT $%d OFFSET $%d`, strings.Join(where, " AND "), len(args)-1, len(args))

	type row struct {
		models.TrainingTask
		Total uint32 `db:"total"`
	}
	var rows []row
	if err := sqlx.SelectContext(ctx, r.db, &rows, query, args...); err != nil {
		return nil, fmt.Errorf("failed to list training tasks: %w", err)
	}

	items := make([]*models.TrainingTask, 0, len(rows))
	var total uint32
	for i := range rows {
		task := rows[i].TrainingTask
		items = append(items, &task)
		if i == 0 {
			total = rows[i].Total
		}
	}
	return &models.TrainingTaskListResult{Items: items, Total: total}, nil
}

func (r *trainingTaskRepo) SetLatestRun(ctx context.Context, key models.TrainingTaskKey, runName string) error {
	result, err := r.db.ExecContext(ctx, `
UPDATE training_tasks SET latest_run_name = $5, updated_at = NOW()
WHERE org = $1 AND project = $2 AND domain = $3 AND id = $4`,
		key.Org, key.Project, key.Domain, key.ID, runName)
	if err != nil {
		return fmt.Errorf("failed to update latest run for training task %s/%s/%s/%s: %w", key.Org, key.Project, key.Domain, key.ID, err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return fmt.Errorf("training task not found: %s/%s/%s/%s", key.Org, key.Project, key.Domain, key.ID)
	}
	return nil
}
