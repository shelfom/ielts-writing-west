#!/bin/bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-5000}"
echo "Starting HTTP service on port ${PORT}..."
NODE_ENV=production PORT=${PORT} node dist/server.js
