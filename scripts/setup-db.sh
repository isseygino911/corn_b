#!/usr/bin/env bash
# Creates the corn_b and corn_b_test databases, a MySQL user limited to them, and runs migrations.
# Prompts for the MySQL root password. Run from corn_b/:  scripts/setup-db.sh
# The corn_b user's password is DB_PASSWORD if set, else generated and printed at the end;
# put it in .env. Re-run with DB_PASSWORD=<current> to keep it.
set -euo pipefail
cd "$(dirname "$0")/.."

MYSQL_BIN="${MYSQL_BIN:-/usr/local/mysql/bin/mysql}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-corn_b}"
DB_USER="${DB_USER:-corn_b}"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"

read -rsp "MySQL root password: " MYSQL_PWD
echo
export MYSQL_PWD

"$MYSQL_BIN" -h "$DB_HOST" -P "$DB_PORT" -u root <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4;
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}_test\` CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost', '${DB_USER}'@'127.0.0.1';
GRANT ALL ON \`${DB_NAME}_test\`.* TO '${DB_USER}'@'localhost', '${DB_USER}'@'127.0.0.1';
SQL

unset MYSQL_PWD
DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_NAME="$DB_NAME" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASSWORD" node scripts/migrate.js

echo "Done. Set these in .env:"
echo "DB_USER=${DB_USER}"
echo "DB_PASSWORD=${DB_PASSWORD}"
