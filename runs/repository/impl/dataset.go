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

type datasetRepo struct {
	db *sqlx.DB
}

func NewDatasetRepo(db *sqlx.DB) interfaces.DatasetRepo {
	return &datasetRepo{db: db}
}

func (r *datasetRepo) Create(ctx context.Context, dataset *models.Dataset) error {
	_, err := r.db.ExecContext(ctx, `
INSERT INTO aione_datasets (
	id, org, project, domain, name, description,
	end_point, port, access_key, secret_key_ciphertext,
	target_path, bucket, bucket_path, creator
) VALUES (
	$1, $2, $3, $4, $5, $6,
	$7, $8, $9, $10,
	$11, $12, $13, $14
)`,
		dataset.ID, dataset.Org, dataset.Project, dataset.Domain, dataset.Name, dataset.Description,
		dataset.EndPoint, dataset.Port, dataset.AccessKey, dataset.SecretKeyCiphertext,
		dataset.TargetPath, dataset.Bucket, dataset.BucketPath, dataset.Creator)
	if err != nil {
		return fmt.Errorf("failed to create dataset %s/%s/%s/%s: %w", dataset.Org, dataset.Project, dataset.Domain, dataset.ID, err)
	}
	return nil
}

func (r *datasetRepo) Get(ctx context.Context, key models.DatasetKey) (*models.Dataset, error) {
	var dataset models.Dataset
	err := sqlx.GetContext(ctx, r.db, &dataset, `
SELECT *
FROM aione_datasets
WHERE org = $1 AND project = $2 AND domain = $3 AND id = $4`,
		key.Org, key.Project, key.Domain, key.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("dataset not found: %s/%s/%s/%s", key.Org, key.Project, key.Domain, key.ID)
		}
		return nil, fmt.Errorf("failed to get dataset %s/%s/%s/%s: %w", key.Org, key.Project, key.Domain, key.ID, err)
	}
	return &dataset, nil
}

func (r *datasetRepo) Update(ctx context.Context, dataset *models.Dataset) error {
	result, err := r.db.ExecContext(ctx, `
UPDATE aione_datasets
SET name = $5,
    description = $6,
    end_point = $7,
    port = $8,
    access_key = $9,
    secret_key_ciphertext = $10,
    target_path = $11,
    bucket = $12,
    bucket_path = $13,
    updated_at = NOW()
WHERE org = $1 AND project = $2 AND domain = $3 AND id = $4`,
		dataset.Org, dataset.Project, dataset.Domain, dataset.ID, dataset.Name, dataset.Description,
		dataset.EndPoint, dataset.Port, dataset.AccessKey, dataset.SecretKeyCiphertext, dataset.TargetPath, dataset.Bucket, dataset.BucketPath)
	if err != nil {
		return fmt.Errorf("failed to update dataset %s/%s/%s/%s: %w", dataset.Org, dataset.Project, dataset.Domain, dataset.ID, err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return fmt.Errorf("dataset not found: %s/%s/%s/%s", dataset.Org, dataset.Project, dataset.Domain, dataset.ID)
	}
	return nil
}

func (r *datasetRepo) Delete(ctx context.Context, key models.DatasetKey) error {
	_, err := r.db.ExecContext(ctx, `
DELETE FROM aione_datasets
WHERE org = $1 AND project = $2 AND domain = $3 AND id = $4`,
		key.Org, key.Project, key.Domain, key.ID)
	if err != nil {
		return fmt.Errorf("failed to delete dataset %s/%s/%s/%s: %w", key.Org, key.Project, key.Domain, key.ID, err)
	}
	return nil
}

func (r *datasetRepo) List(ctx context.Context, input models.DatasetListInput) (*models.DatasetListResult, error) {
	limit := input.Limit
	if limit == 0 {
		limit = 50
	}

	where := []string{"org = $1", "project = $2", "domain = $3"}
	args := []any{input.Org, input.Project, input.Domain}
	if strings.TrimSpace(input.Search) != "" {
		args = append(args, "%"+strings.ToLower(strings.TrimSpace(input.Search))+"%")
		where = append(where, fmt.Sprintf(`(
LOWER(name) LIKE $%d OR
LOWER(description) LIKE $%d OR
LOWER(end_point) LIKE $%d OR
LOWER(target_path) LIKE $%d OR
LOWER(bucket) LIKE $%d OR
LOWER(bucket_path) LIKE $%d
)`, len(args), len(args), len(args), len(args), len(args), len(args)))
	}
	args = append(args, limit, input.Offset)
	query := fmt.Sprintf(`
SELECT *, COUNT(*) OVER() AS total
FROM aione_datasets
WHERE %s
ORDER BY created_at DESC
LIMIT $%d OFFSET $%d`, strings.Join(where, " AND "), len(args)-1, len(args))

	type row struct {
		models.Dataset
		Total uint32 `db:"total"`
	}
	var rows []row
	if err := sqlx.SelectContext(ctx, r.db, &rows, query, args...); err != nil {
		return nil, fmt.Errorf("failed to list datasets: %w", err)
	}

	items := make([]*models.Dataset, 0, len(rows))
	var total uint32
	for i := range rows {
		dataset := rows[i].Dataset
		items = append(items, &dataset)
		if i == 0 {
			total = rows[i].Total
		}
	}
	return &models.DatasetListResult{Items: items, Total: total}, nil
}
