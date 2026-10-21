#!/bin/bash
set -euo pipefail
cd /usr/local/lib/tinfoil-workbench
docker build -t tinfoil-workbench-tools:1 -f remote/Dockerfile .
container=$(docker create tinfoil-workbench-tools:1)
trap 'docker rm "$container" >/dev/null 2>&1 || true' EXIT
docker cp "$container":/usr/local/bin/node /usr/local/lib/tinfoil-workbench-node
chmod 755 /usr/local/lib/tinfoil-workbench-node
docker run --rm --user 0:0 --entrypoint npm --memory=768m --cpus=1 \
  --mount type=bind,src=/usr/local/lib/tinfoil-workbench,dst=/app -w /app \
  tinfoil-workbench-tools:1 ci --omit=dev --ignore-scripts
/usr/local/lib/tinfoil-workbench-node --version
bash remote/install.sh
bash remote/install-browser.sh
