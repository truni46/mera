set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCHEMA_FILE="$ROOT_DIR/server/migrations/schema.sql"

if ! command -v psql >/dev/null 2>&1; then
    echo "ERROR: psql not found on PATH. Install the PostgreSQL client or add its bin/ dir to PATH." >&2
    exit 1
fi

if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ROOT_DIR/.env"
    set +a
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-mera}"
DB_USER="${DB_USER:-admin}"
DB_PASSWORD="${DB_PASSWORD:-}"

export PGPASSWORD="$DB_PASSWORD"
PSQL=(psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER")

echo "==> Ensuring database \"$DB_NAME\" exists on $DB_HOST:$DB_PORT ..."
"${PSQL[@]}" -d postgres <<SQL
SELECT 'CREATE DATABASE "$DB_NAME" OWNER "$DB_USER"'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec
SQL

echo "==> Applying consolidated schema ($SCHEMA_FILE) ..."
"${PSQL[@]}" -d "$DB_NAME" -f "$SCHEMA_FILE"

echo "==> Done. Database \"$DB_NAME\" is ready with all tables created."
