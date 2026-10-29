#!/usr/bin/env bash
# Start the portal on a brand-new database and fill it with sample data.
# Usage: tests/e2e/fresh.sh <port> <workdir>   → prints the server PID
set -e
PORT=${1:-8790}; WORK=${2:-/tmp/vtc-e2e}; ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$WORK"; rm -f "$WORK/e2e-$PORT.sqlite3"*
cd "$ROOT"
VTC_DB="$WORK/e2e-$PORT.sqlite3" nohup python -m uvicorn vtc.main:app --host 127.0.0.1 --port "$PORT" > "$WORK/server-$PORT.log" 2>&1 &
PID=$!
for i in $(seq 1 30); do curl -s "127.0.0.1:$PORT/" >/dev/null && break; sleep 0.5; done
VTC_URL="http://127.0.0.1:$PORT" python tests/e2e/seed.py > "$WORK/seed-$PORT.log" 2>&1 || { cat "$WORK/seed-$PORT.log"; kill $PID; exit 1; }
echo $PID
