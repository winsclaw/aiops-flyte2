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

type developmentInstanceRepo struct {
	db *sqlx.DB
}

func NewDevelopmentInstanceRepo(db *sqlx.DB) interfaces.DevelopmentInstanceRepo {
	return &developmentInstanceRepo{db: db}
}

func (r *developmentInstanceRepo) Create(ctx context.Context, instance *models.DevelopmentInstance) error {
	_, err := r.db.ExecContext(ctx, `
INSERT INTO development_instances (
	id, org, project, domain, name, description, owner, source_system,
	resource_display, cpu, memory, gpu_count, gpu_model, bandwidth, workspace_size, max_hours,
	image_type, official_image_id, image_name, image_uri,
	image_pull_secret_name, code_repository_secret_name, gpu_node_label_key, base_image_mount_path,
	ssh_user, authorized_keys_json,
	workspace_pvc_name, latest_run_name, status, generation, node_port, code_server_node_port,
	code_server_url, code_server_workspace_url, cloud_storage_mounts_json, code_repository_mounts_json
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8,
	$9, $10, $11, $12, $13, $14, $15, $16,
	$17, $18, $19, $20, $21, $22,
	$23, $24, $25, $26,
	$27, $28, $29, $30, $31, $32,
	$33, $34, $35, $36
)`,
		instance.ID, instance.Org, instance.Project, instance.Domain, instance.Name, instance.Description, instance.Owner, instance.SourceSystem,
		instance.ResourceDisplay, instance.CPU, instance.Memory, instance.GPUCount, instance.GPUModel, instance.Bandwidth, instance.WorkspaceSize, instance.MaxHours,
		instance.ImageType, instance.OfficialImageID, instance.ImageName, instance.ImageURI,
		instance.ImagePullSecretName, instance.CodeRepositorySecretName, instance.GPUNodeLabelKey, instance.BaseImageMountPath,
		instance.SSHUser, instance.AuthorizedKeysJSON,
		instance.WorkspacePVCName, instance.LatestRunName, defaultDevelopmentInstanceStatus(instance.Status), instance.Generation, instance.NodePort, instance.CodeServerNodePort,
		instance.CodeServerURL, instance.CodeServerWorkspaceURL, defaultJSON(instance.CloudStorageMountsJSON), defaultJSON(instance.CodeRepositoryMountsJSON))
	if err != nil {
		return fmt.Errorf("failed to create development instance %s: %w", instance.ID, err)
	}
	return nil
}

func (r *developmentInstanceRepo) Get(ctx context.Context, key models.DevelopmentInstanceKey) (*models.DevelopmentInstance, error) {
	var instance models.DevelopmentInstance
	err := sqlx.GetContext(ctx, r.db, &instance, `SELECT * FROM development_instances WHERE id = $1 AND deleted_at IS NULL`, key.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("development instance not found: %s", key.ID)
		}
		return nil, fmt.Errorf("failed to get development instance %s: %w", key.ID, err)
	}
	return &instance, nil
}

func (r *developmentInstanceRepo) GetByID(ctx context.Context, id string) (*models.DevelopmentInstance, error) {
	return r.Get(ctx, models.DevelopmentInstanceKey{ID: id})
}

func (r *developmentInstanceRepo) Update(ctx context.Context, instance *models.DevelopmentInstance) error {
	result, err := r.db.ExecContext(ctx, `
UPDATE development_instances SET
	org = $2,
	project = $3,
	domain = $4,
	name = $5,
	description = $6,
	owner = $7,
	source_system = $8,
	resource_display = $9,
	cpu = $10,
	memory = $11,
	gpu_count = $12,
	gpu_model = $13,
	bandwidth = $14,
	workspace_size = $15,
	max_hours = $16,
	image_type = $17,
	official_image_id = $18,
	image_name = $19,
	image_uri = $20,
	image_pull_secret_name = $21,
	code_repository_secret_name = $22,
	gpu_node_label_key = $23,
	base_image_mount_path = $24,
	ssh_user = $25,
	authorized_keys_json = $26,
	workspace_pvc_name = $27,
	latest_run_name = $28,
	status = $29,
	generation = $30,
	node_port = $31,
	code_server_node_port = $32,
	code_server_url = $33,
	code_server_workspace_url = $34,
	cloud_storage_mounts_json = $35,
	code_repository_mounts_json = $36,
	updated_at = NOW()
WHERE id = $1 AND deleted_at IS NULL`,
		instance.ID, instance.Org, instance.Project, instance.Domain, instance.Name, instance.Description, instance.Owner, instance.SourceSystem,
		instance.ResourceDisplay, instance.CPU, instance.Memory, instance.GPUCount, instance.GPUModel, instance.Bandwidth, instance.WorkspaceSize, instance.MaxHours,
		instance.ImageType, instance.OfficialImageID, instance.ImageName, instance.ImageURI,
		instance.ImagePullSecretName, instance.CodeRepositorySecretName, instance.GPUNodeLabelKey, instance.BaseImageMountPath,
		instance.SSHUser, instance.AuthorizedKeysJSON,
		instance.WorkspacePVCName, instance.LatestRunName, defaultDevelopmentInstanceStatus(instance.Status), instance.Generation, instance.NodePort, instance.CodeServerNodePort,
		instance.CodeServerURL, instance.CodeServerWorkspaceURL, defaultJSON(instance.CloudStorageMountsJSON), defaultJSON(instance.CodeRepositoryMountsJSON))
	if err != nil {
		return fmt.Errorf("failed to update development instance %s: %w", instance.ID, err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return fmt.Errorf("development instance not found: %s", instance.ID)
	}
	return nil
}

func (r *developmentInstanceRepo) Delete(ctx context.Context, key models.DevelopmentInstanceKey) error {
	_, err := r.db.ExecContext(ctx, `UPDATE development_instances SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, key.ID)
	if err != nil {
		return fmt.Errorf("failed to delete development instance %s: %w", key.ID, err)
	}
	return nil
}

func (r *developmentInstanceRepo) List(ctx context.Context, input models.DevelopmentInstanceListInput) (*models.DevelopmentInstanceListResult, error) {
	limit := input.Limit
	if limit == 0 {
		limit = 50
	}

	where := []string{"org = $1", "project = $2", "domain = $3", "deleted_at IS NULL"}
	args := []any{input.Org, input.Project, input.Domain}
	if strings.TrimSpace(input.Search) != "" {
		args = append(args, "%"+strings.ToLower(strings.TrimSpace(input.Search))+"%")
		where = append(where, fmt.Sprintf("(LOWER(name) LIKE $%d OR LOWER(description) LIKE $%d OR LOWER(id) LIKE $%d)", len(args), len(args), len(args)))
	}
	args = append(args, limit, input.Offset)
	query := fmt.Sprintf(`
SELECT *, COUNT(*) OVER() AS total
FROM development_instances
WHERE %s
ORDER BY updated_at DESC
LIMIT $%d OFFSET $%d`, strings.Join(where, " AND "), len(args)-1, len(args))

	type row struct {
		models.DevelopmentInstance
		Total uint32 `db:"total"`
	}
	var rows []row
	if err := sqlx.SelectContext(ctx, r.db, &rows, query, args...); err != nil {
		return nil, fmt.Errorf("failed to list development instances: %w", err)
	}
	items := make([]*models.DevelopmentInstance, 0, len(rows))
	var total uint32
	for i := range rows {
		instance := rows[i].DevelopmentInstance
		items = append(items, &instance)
		if i == 0 {
			total = rows[i].Total
		}
	}
	return &models.DevelopmentInstanceListResult{Items: items, Total: total}, nil
}

func (r *developmentInstanceRepo) AppendRun(ctx context.Context, run *models.DevelopmentInstanceRun) error {
	_, err := r.db.ExecContext(ctx, `
INSERT INTO development_instance_runs (
	instance_id, org, project, domain, run_name, generation, status,
	node_port, code_server_node_port, started_at, ended_at
) VALUES (
	$1, $2, $3, $4, $5, $6, $7,
	$8, $9, $10, $11
)`,
		run.InstanceID, run.Org, run.Project, run.Domain, run.RunName, run.Generation, defaultDevelopmentInstanceStatus(run.Status),
		run.NodePort, run.CodeServerNodePort, run.StartedAt, run.EndedAt)
	if err != nil {
		return fmt.Errorf("failed to append development instance run %s/%s: %w", run.InstanceID, run.RunName, err)
	}
	return nil
}

func (r *developmentInstanceRepo) UpdateRun(ctx context.Context, run *models.DevelopmentInstanceRun) error {
	result, err := r.db.ExecContext(ctx, `
UPDATE development_instance_runs SET
	status = $3,
	node_port = $4,
	code_server_node_port = $5,
	started_at = $6,
	ended_at = $7,
	updated_at = NOW()
WHERE instance_id = $1 AND run_name = $2`,
		run.InstanceID, run.RunName, defaultDevelopmentInstanceStatus(run.Status), run.NodePort, run.CodeServerNodePort, run.StartedAt, run.EndedAt)
	if err != nil {
		return fmt.Errorf("failed to update development instance run %s/%s: %w", run.InstanceID, run.RunName, err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return fmt.Errorf("development instance run not found: %s/%s", run.InstanceID, run.RunName)
	}
	return nil
}

func (r *developmentInstanceRepo) GetLatestRun(ctx context.Context, instanceID string) (*models.DevelopmentInstanceRun, error) {
	var run models.DevelopmentInstanceRun
	err := sqlx.GetContext(ctx, r.db, &run, `
SELECT *
FROM development_instance_runs
WHERE instance_id = $1
ORDER BY generation DESC, created_at DESC
LIMIT 1`, instanceID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("development instance run not found: %s", instanceID)
		}
		return nil, fmt.Errorf("failed to get latest development instance run %s: %w", instanceID, err)
	}
	return &run, nil
}

func (r *developmentInstanceRepo) ListRuns(ctx context.Context, input models.DevelopmentInstanceRunListInput) (*models.DevelopmentInstanceRunListResult, error) {
	limit := input.Limit
	if limit == 0 {
		limit = 50
	}
	type row struct {
		models.DevelopmentInstanceRun
		Total uint32 `db:"total"`
	}
	var rows []row
	if err := sqlx.SelectContext(ctx, r.db, &rows, `
SELECT *, COUNT(*) OVER() AS total
FROM development_instance_runs
WHERE instance_id = $1
ORDER BY generation DESC, created_at DESC
LIMIT $2 OFFSET $3`, input.InstanceID, limit, input.Offset); err != nil {
		return nil, fmt.Errorf("failed to list development instance runs: %w", err)
	}
	items := make([]*models.DevelopmentInstanceRun, 0, len(rows))
	var total uint32
	for i := range rows {
		run := rows[i].DevelopmentInstanceRun
		items = append(items, &run)
		if i == 0 {
			total = rows[i].Total
		}
	}
	return &models.DevelopmentInstanceRunListResult{Items: items, Total: total}, nil
}

func defaultJSON(value string) string {
	if strings.TrimSpace(value) == "" {
		return "[]"
	}
	return value
}

func defaultDevelopmentInstanceStatus(value string) string {
	if strings.TrimSpace(value) == "" {
		return models.DevelopmentInstanceStatusNotStarted
	}
	return value
}
