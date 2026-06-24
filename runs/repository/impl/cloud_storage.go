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

type cloudStorageRepo struct {
	db *sqlx.DB
}

func NewCloudStorageRepo(db *sqlx.DB) interfaces.CloudStorageRepo {
	return &cloudStorageRepo{db: db}
}

func (r *cloudStorageRepo) Create(ctx context.Context, storage *models.CloudStorage) error {
	_, err := r.db.ExecContext(ctx, `
INSERT INTO aione_cloud_storages (
	id, org, project, domain, name, description, size_gb, storage_class,
	creator
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8,
	$9
)`,
		storage.ID, storage.Org, storage.Project, storage.Domain, storage.Name, storage.Description, storage.SizeGB, storage.StorageClass,
		storage.Creator)
	if err != nil {
		return fmt.Errorf("failed to create cloud storage %s/%s/%s/%s: %w", storage.Org, storage.Project, storage.Domain, storage.ID, err)
	}
	return nil
}

func (r *cloudStorageRepo) Get(ctx context.Context, key models.CloudStorageKey) (*models.CloudStorage, error) {
	var storage models.CloudStorage
	err := sqlx.GetContext(ctx, r.db, &storage, `SELECT * FROM aione_cloud_storages WHERE org = $1 AND project = $2 AND domain = $3 AND id = $4`,
		key.Org, key.Project, key.Domain, key.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("cloud storage not found: %s/%s/%s/%s", key.Org, key.Project, key.Domain, key.ID)
		}
		return nil, fmt.Errorf("failed to get cloud storage %s/%s/%s/%s: %w", key.Org, key.Project, key.Domain, key.ID, err)
	}
	if err := r.populateMaterializations(ctx, &storage); err != nil {
		return nil, err
	}
	return &storage, nil
}

func (r *cloudStorageRepo) GetByID(ctx context.Context, id string) (*models.CloudStorage, error) {
	var storages []models.CloudStorage
	if err := sqlx.SelectContext(ctx, r.db, &storages, `
SELECT *
FROM aione_cloud_storages
WHERE id = $1
ORDER BY created_at DESC
LIMIT 2`, id); err != nil {
		return nil, fmt.Errorf("failed to get cloud storage by id %s: %w", id, err)
	}
	if len(storages) == 0 {
		return nil, fmt.Errorf("cloud storage not found: %s", id)
	}
	if len(storages) > 1 {
		return nil, fmt.Errorf("%w: %s", interfaces.ErrCloudStorageIDAmbiguous, id)
	}
	storage := storages[0]
	if err := r.populateMaterializations(ctx, &storage); err != nil {
		return nil, err
	}
	return &storage, nil
}

func (r *cloudStorageRepo) Delete(ctx context.Context, key models.CloudStorageKey) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM aione_cloud_storages WHERE org = $1 AND project = $2 AND domain = $3 AND id = $4`,
		key.Org, key.Project, key.Domain, key.ID)
	if err != nil {
		return fmt.Errorf("failed to delete cloud storage %s/%s/%s/%s: %w", key.Org, key.Project, key.Domain, key.ID, err)
	}
	return nil
}

func (r *cloudStorageRepo) List(ctx context.Context, input models.CloudStorageListInput) (*models.CloudStorageListResult, error) {
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
FROM aione_cloud_storages
WHERE %s
ORDER BY created_at DESC
LIMIT $%d OFFSET $%d`, strings.Join(where, " AND "), len(args)-1, len(args))

	type row struct {
		models.CloudStorage
		Total uint32 `db:"total"`
	}
	var rows []row
	if err := sqlx.SelectContext(ctx, r.db, &rows, query, args...); err != nil {
		return nil, fmt.Errorf("failed to list cloud storages: %w", err)
	}

	items := make([]*models.CloudStorage, 0, len(rows))
	var total uint32
	for i := range rows {
		storage := rows[i].CloudStorage
		if err := r.populateMaterializations(ctx, &storage); err != nil {
			return nil, err
		}
		items = append(items, &storage)
		if i == 0 {
			total = rows[i].Total
		}
	}
	return &models.CloudStorageListResult{Items: items, Total: total}, nil
}

func (r *cloudStorageRepo) SetMaterialized(ctx context.Context, key models.CloudStorageKey, namespace, pvcName string) error {
	result, err := r.db.ExecContext(ctx, `
INSERT INTO aione_cloud_storage_pvcs (
	org, project, domain, cloud_storage_id, target_namespace, pvc_name
) VALUES (
	$1, $2, $3, $4, $5, $6
)
ON CONFLICT (org, project, domain, cloud_storage_id, target_namespace)
DO UPDATE SET pvc_name = EXCLUDED.pvc_name, materialized_at = NOW(), updated_at = NOW()`,
		key.Org, key.Project, key.Domain, key.ID, namespace, pvcName)
	if err != nil {
		return fmt.Errorf("failed to materialize cloud storage %s/%s/%s/%s: %w", key.Org, key.Project, key.Domain, key.ID, err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return fmt.Errorf("cloud storage not found: %s/%s/%s/%s", key.Org, key.Project, key.Domain, key.ID)
	}
	return nil
}

func (r *cloudStorageRepo) ListMaterializations(ctx context.Context, key models.CloudStorageKey) ([]models.CloudStoragePVC, error) {
	var pvcs []models.CloudStoragePVC
	if err := sqlx.SelectContext(ctx, r.db, &pvcs, `
SELECT
	org,
	project,
	domain,
	cloud_storage_id AS id,
	target_namespace,
	pvc_name,
	materialized_at,
	updated_at
FROM aione_cloud_storage_pvcs
WHERE org = $1 AND project = $2 AND domain = $3 AND cloud_storage_id = $4
ORDER BY materialized_at DESC`,
		key.Org, key.Project, key.Domain, key.ID); err != nil {
		return nil, fmt.Errorf("failed to list cloud storage pvcs %s/%s/%s/%s: %w", key.Org, key.Project, key.Domain, key.ID, err)
	}
	return pvcs, nil
}

func (r *cloudStorageRepo) ClearMaterializations(ctx context.Context, key models.CloudStorageKey) error {
	_, err := r.db.ExecContext(ctx, `
DELETE FROM aione_cloud_storage_pvcs
WHERE org = $1 AND project = $2 AND domain = $3 AND cloud_storage_id = $4`,
		key.Org, key.Project, key.Domain, key.ID)
	if err != nil {
		return fmt.Errorf("failed to clear cloud storage pvcs %s/%s/%s/%s: %w", key.Org, key.Project, key.Domain, key.ID, err)
	}
	return nil
}

func (r *cloudStorageRepo) populateMaterializations(ctx context.Context, storage *models.CloudStorage) error {
	pvcs, err := r.ListMaterializations(ctx, storage.CloudStorageKey)
	if err != nil {
		return err
	}
	storage.Materializations = pvcs
	if len(pvcs) > 0 {
		storage.TargetNamespace = pvcs[0].TargetNamespace
		storage.PVCName = pvcs[0].PVCName
		storage.MaterializedAt = pvcs[0].MaterializedAt
	}
	return nil
}
