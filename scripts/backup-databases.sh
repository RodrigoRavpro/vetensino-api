#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

CONFIG_FILE="${BACKUP_CONFIG_FILE:-/root/vetensino/.backup.env}"

if [[ ! -r "$CONFIG_FILE" ]]; then
  echo "Backup configuration not found: $CONFIG_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$CONFIG_FILE"

: "${VETENSINO_ENV_FILE:=/root/vetensino/.env}"
: "${NPM_ENV_FILE:=/root/purple-vet-proxy-manager/.env}"
: "${BACKUP_DIR:=/root/vetensino/backups}"
: "${VETENSINO_DB_CONTAINER:=vetensino-db}"
: "${NPM_DB_CONTAINER:=npm-db}"
: "${NPM_DATA_VOLUME:=purple-vet-proxy-manager_npm_data}"
: "${NPM_LETSENCRYPT_VOLUME:=purple-vet-proxy-manager_npm_letsencrypt}"
: "${LOCAL_RETENTION_DAYS:=7}"
: "${S3_RETENTION_DAYS:=30}"
: "${AWS_REGION:=sa-east-1}"

for env_file in "$VETENSINO_ENV_FILE" "$NPM_ENV_FILE"; do
  if [[ ! -r "$env_file" ]]; then
    echo "Environment file not found: $env_file" >&2
    exit 1
  fi
done

# The application and NPM files remain the source of truth for database credentials.
set -a
# shellcheck disable=SC1090
source "$VETENSINO_ENV_FILE"
# shellcheck disable=SC1090
source "$NPM_ENV_FILE"
set +a

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_PREFIX:?S3_PREFIX is required}"

NPM_DB_ROOT_PASSWORD="${NPM_DB_ROOT_PASSWORD:-${MYSQL_ROOT_PASSWORD:-}}"
if [[ -z "$NPM_DB_ROOT_PASSWORD" ]]; then
  echo "NPM_DB_ROOT_PASSWORD or MYSQL_ROOT_PASSWORD is required" >&2
  exit 1
fi

LOCK_FILE="${BACKUP_LOCK_FILE:-/var/lock/vetensino-backup.lock}"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another VetEnsino backup is already running; skipping." >&2
  exit 0
fi

for command in docker find gzip tar; do
  command -v "$command" >/dev/null || { echo "Required command not found: $command" >&2; exit 1; }
done

timestamp="$(date -u +%Y%m%d_%H%M%S)"
day_of_week="$(date -u +%u)"
backup_day="$BACKUP_DIR/daily/$timestamp"
mkdir -p "$BACKUP_DIR/daily"
temporary_dir="$(mktemp -d "$BACKUP_DIR/.in-progress.XXXXXX")"
trap 'rm -rf "$temporary_dir"' EXIT

echo "[$(date -u +%FT%TZ)] Starting VetEnsino backup"

postgres_backup="$temporary_dir/vetensino-postgres-$timestamp.dump"
docker exec "$VETENSINO_DB_CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$postgres_backup"
[[ -s "$postgres_backup" ]] || { echo "PostgreSQL backup is empty" >&2; exit 1; }

npm_database_backup="$temporary_dir/npm-mariadb-$timestamp.sql.gz"
docker exec "$NPM_DB_CONTAINER" mysqldump -u root -p"$NPM_DB_ROOT_PASSWORD" --all-databases --single-transaction --quick --lock-tables=false | gzip > "$npm_database_backup"
[[ -s "$npm_database_backup" ]] || { echo "NPM MariaDB backup is empty" >&2; exit 1; }

npm_data_backup="$temporary_dir/npm-data-$timestamp.tar.gz"
docker run --rm \
  -v "$NPM_DATA_VOLUME:/data:ro" \
  -v "$temporary_dir:/backup" \
  alpine:3.20 tar -C /data -czf "/backup/$(basename "$npm_data_backup")" .
[[ -s "$npm_data_backup" ]] || { echo "NPM data backup is empty" >&2; exit 1; }

npm_certificates_backup="$temporary_dir/npm-letsencrypt-$timestamp.tar.gz"
docker run --rm \
  -v "$NPM_LETSENCRYPT_VOLUME:/letsencrypt:ro" \
  -v "$temporary_dir:/backup" \
  alpine:3.20 tar -C /letsencrypt -czf "/backup/$(basename "$npm_certificates_backup")" .
[[ -s "$npm_certificates_backup" ]] || { echo "NPM certificate backup is empty" >&2; exit 1; }

mv "$temporary_dir" "$backup_day"
temporary_dir=''
trap - EXIT
echo "[$(date -u +%FT%TZ)] Local backup created: $backup_day"

find "$BACKUP_DIR/daily" -mindepth 1 -maxdepth 1 -type d -mtime +"$LOCAL_RETENTION_DAYS" -exec rm -rf {} +

if [[ "$day_of_week" -eq 7 ]]; then
  command -v aws >/dev/null || { echo "AWS CLI is required for the weekly S3 backup" >&2; exit 1; }
  export AWS_DEFAULT_REGION="$AWS_REGION"
  week="$(date -u +%G-W%V)"
  s3_path="s3://$S3_BUCKET/$S3_PREFIX/weekly/$week/$timestamp/"

  for backup_file in "$backup_day"/*; do
    aws s3 cp "$backup_file" "$s3_path$(basename "$backup_file")" --storage-class STANDARD_IA --only-show-errors
  done

  cutoff_date="$(date -u -d "$S3_RETENTION_DAYS days ago" +%Y-%m-%d)"
  aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/weekly/" --recursive | while read -r object_date _ _ object_key; do
    if [[ "$object_date" < "$cutoff_date" ]]; then
      aws s3 rm "s3://$S3_BUCKET/$object_key" --only-show-errors
    fi
  done
  echo "[$(date -u +%FT%TZ)] Weekly S3 backup created: $s3_path"
fi

echo "[$(date -u +%FT%TZ)] VetEnsino backup completed successfully"