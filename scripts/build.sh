#!/bin/bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."

echo "Building the Next.js project..."
pnpm next build --webpack

echo "Bundling server with tsup..."
pnpm tsup src/server.ts --format cjs --platform node --target node22 --outDir dist --no-splitting --no-minify

echo "Build completed successfully!"
