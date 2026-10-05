#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"
cd "${COZE_WORKSPACE_PATH}"

DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-5000}"

echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
PORT=${DEPLOY_RUN_PORT} node dist/server.js
