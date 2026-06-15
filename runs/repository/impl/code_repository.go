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

type codeRepositoryRepo struct {
	db *sqlx.DB
}

func NewCodeRepositoryRepo(db *sqlx.DB) interfaces.CodeRepositoryRepo {
	return &codeRepositoryRepo{db: db}
}

func (r *codeRepositoryRepo) Create(ctx context.Context, repo *models.CodeRepository) error {
	_, err := r.db.ExecContext(ctx, `
INSERT INTO aione_code_repositories (
	id, org, project, domain, repo_url, branch, mount_path, access_token, creator
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8, $9
)`,
		repo.ID, repo.Org, repo.Project, repo.Domain, repo.RepoURL, repo.Branch, repo.MountPath, repo.AccessToken, repo.Creator)
	if err != nil {
		return fmt.Errorf("failed to create code repository %s/%s/%s/%s: %w", repo.Org, repo.Project, repo.Domain, repo.ID, err)
	}
	return nil
}

func (r *codeRepositoryRepo) Get(ctx context.Context, key models.CodeRepositoryKey) (*models.CodeRepository, error) {
	var repo models.CodeRepository
	err := sqlx.GetContext(ctx, r.db, &repo, `SELECT * FROM aione_code_repositories WHERE org = $1 AND project = $2 AND domain = $3 AND id = $4`,
		key.Org, key.Project, key.Domain, key.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("code repository not found: %s/%s/%s/%s", key.Org, key.Project, key.Domain, key.ID)
		}
		return nil, fmt.Errorf("failed to get code repository %s/%s/%s/%s: %w", key.Org, key.Project, key.Domain, key.ID, err)
	}
	return &repo, nil
}

func (r *codeRepositoryRepo) Update(ctx context.Context, repo *models.CodeRepository) error {
	result, err := r.db.ExecContext(ctx, `
UPDATE aione_code_repositories
SET repo_url = $5,
    branch = $6,
    mount_path = $7,
    access_token = $8,
    updated_at = NOW()
WHERE org = $1 AND project = $2 AND domain = $3 AND id = $4`,
		repo.Org, repo.Project, repo.Domain, repo.ID, repo.RepoURL, repo.Branch, repo.MountPath, repo.AccessToken)
	if err != nil {
		return fmt.Errorf("failed to update code repository %s/%s/%s/%s: %w", repo.Org, repo.Project, repo.Domain, repo.ID, err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return fmt.Errorf("code repository not found: %s/%s/%s/%s", repo.Org, repo.Project, repo.Domain, repo.ID)
	}
	return nil
}

func (r *codeRepositoryRepo) Delete(ctx context.Context, key models.CodeRepositoryKey) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM aione_code_repositories WHERE org = $1 AND project = $2 AND domain = $3 AND id = $4`,
		key.Org, key.Project, key.Domain, key.ID)
	if err != nil {
		return fmt.Errorf("failed to delete code repository %s/%s/%s/%s: %w", key.Org, key.Project, key.Domain, key.ID, err)
	}
	return nil
}

func (r *codeRepositoryRepo) List(ctx context.Context, input models.CodeRepositoryListInput) (*models.CodeRepositoryListResult, error) {
	limit := input.Limit
	if limit == 0 {
		limit = 50
	}

	where := []string{"org = $1", "project = $2", "domain = $3"}
	args := []any{input.Org, input.Project, input.Domain}
	if strings.TrimSpace(input.Search) != "" {
		args = append(args, "%"+strings.ToLower(strings.TrimSpace(input.Search))+"%")
		where = append(where, fmt.Sprintf("(LOWER(repo_url) LIKE $%d OR LOWER(branch) LIKE $%d)", len(args), len(args)))
	}
	args = append(args, limit, input.Offset)
	query := fmt.Sprintf(`
SELECT *, COUNT(*) OVER() AS total
FROM aione_code_repositories
WHERE %s
ORDER BY created_at DESC
LIMIT $%d OFFSET $%d`, strings.Join(where, " AND "), len(args)-1, len(args))

	type row struct {
		models.CodeRepository
		Total uint32 `db:"total"`
	}
	var rows []row
	if err := sqlx.SelectContext(ctx, r.db, &rows, query, args...); err != nil {
		return nil, fmt.Errorf("failed to list code repositories: %w", err)
	}

	items := make([]*models.CodeRepository, 0, len(rows))
	var total uint32
	for i := range rows {
		repo := rows[i].CodeRepository
		items = append(items, &repo)
		if i == 0 {
			total = rows[i].Total
		}
	}
	return &models.CodeRepositoryListResult{Items: items, Total: total}, nil
}
