#!/usr/bin/env bash
# Daily / on-demand backup of VTC MySQL database + attachments directory.
# Usage: ./tools/backup.sh [backup_dir]
set -euo pipefail

BACKUP_ROOT="${1:-/var/backups/vtc}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_ROOT}/${STAMP}"

DB_HOST="${VTC_DB_HOST:-127.0.0.1}"
DB_PORT="${VTC_DB_PORT:-3306}"
DB_NAME="${VTC_DB_NAME:-vtc_portal}"
DB_USER="${VTC_DB_USER:-vtc_app}"
DB_PASS="${VTC_DB_PASSWORD:-vtc_secret}"
FILES_DIR="${VTC_FILES_DIR:-./data/files}"
RETENTION_DAYS="${VTC_BACKUP_RETENTION_DAYS:-30}"

mkdir -p "${DEST}"

echo "[backup] Dumping MySQL database '${DB_NAME}' (${DB_HOST}:${DB_PORT}) -> ${DEST}/db.sql.gz"
MYSQL_PWD="${DB_PASS}" mysqldump \
  --host="${DB_HOST}" \
  --port="${DB_PORT}" \
  --user="${DB_USER}" \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --set-gtid-purged=OFF \
  --default-character-set=utf8mb4 \
  "${DB_NAME}" | gzip -9 > "${DEST}/db.sql.gz"

if [ -d "${FILES_DIR}" ]; then
  echo "[backup] Archiving files directory '${FILES_DIR}' -> ${DEST}/files.tar.gz"
  tar -C "${FILES_DIR}" -czf "${DEST}/files.tar.gz" .
else
  echo "[backup] Files directory '${FILES_DIR}' does not exist yet; creating empty archive"
  tar -czf "${DEST}/files.tar.gz" --files-from /dev/null
fi

(
  cd "${DEST}"
  sha256sum db.sql.gz files.tar.gz > SHA256SUMS
)

# Rotate backups older than RETENTION_DAYS
find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -mtime +"${RETENTION_DAYS}" -exec rm -rf {} +

echo "[backup] Completed successfully at ${DEST}"
