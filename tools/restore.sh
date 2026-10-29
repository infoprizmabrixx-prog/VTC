#!/usr/bin/env bash
# Restore VTC MySQL database + attachments directory from a backup snapshot.
# Usage: ./tools/restore.sh /var/backups/vtc/<TIMESTAMP>
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup_snapshot_dir>" >&2
  exit 1
fi

SRC="$1"
if [ ! -f "${SRC}/db.sql.gz" ]; then
  echo "Error: ${SRC}/db.sql.gz not found" >&2
  exit 1
fi

DB_HOST="${VTC_DB_HOST:-127.0.0.1}"
DB_PORT="${VTC_DB_PORT:-3306}"
DB_NAME="${VTC_DB_NAME:-vtc_portal}"
DB_USER="${VTC_DB_USER:-vtc_app}"
DB_PASS="${VTC_DB_PASSWORD:-vtc_secret}"
FILES_DIR="${VTC_FILES_DIR:-./data/files}"

if [ -f "${SRC}/SHA256SUMS" ]; then
  echo "[restore] Verifying SHA-256 checksums in ${SRC}..."
  (cd "${SRC}" && sha256sum -c SHA256SUMS)
fi

echo "[restore] Restoring MySQL database '${DB_NAME}' from ${SRC}/db.sql.gz..."
gzip -dc "${SRC}/db.sql.gz" | MYSQL_PWD="${DB_PASS}" mysql \
  --host="${DB_HOST}" \
  --port="${DB_PORT}" \
  --user="${DB_USER}" \
  --default-character-set=utf8mb4 \
  "${DB_NAME}"

if [ -f "${SRC}/files.tar.gz" ]; then
  echo "[restore] Restoring files directory '${FILES_DIR}' from ${SRC}/files.tar.gz..."
  mkdir -p "${FILES_DIR}"
  tar -C "${FILES_DIR}" -xzf "${SRC}/files.tar.gz"
fi

echo "[restore] Completed successfully from ${SRC}"
