package service

import (
	"context"
	"flag"
	"os"
	"strings"
	"testing"

	"github.com/jmoiron/sqlx"

	"github.com/flyteorg/flyte/v2/flytestdlib/database"
	runsmigrations "github.com/flyteorg/flyte/v2/runs/migrations"
)

var testDB *sqlx.DB

func TestMain(m *testing.M) {
	flag.Parse()
	if runPattern := flag.Lookup("test.run").Value.String(); runPattern != "" && !strings.Contains(runPattern, "Project") {
		os.Exit(m.Run())
	}

	os.Exit(database.RunTestMain(m, 15433, "flyte_runs_test", &testDB, func(db *sqlx.DB) error {
		return runsmigrations.RunMigrations(context.Background(), db)
	}))
}
