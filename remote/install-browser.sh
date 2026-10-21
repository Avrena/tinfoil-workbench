#!/bin/bash
set -euo pipefail
cd /usr/local/lib/tinfoil-workbench
docker run --rm --user 0:0 --entrypoint npm --memory=768m --cpus=1 \
  --mount type=bind,src=/usr/local/lib/tinfoil-workbench/remote,dst=/app -w /app \
  tinfoil-workbench-tools:1 ci --ignore-scripts
export PLAYWRIGHT_BROWSERS_PATH=/opt/tinfoil-workbench-browsers
/usr/local/lib/tinfoil-workbench-node remote/node_modules/playwright-core/cli.js install --with-deps --only-shell chromium
# Ubuntu's per-executable exception enables Chromium's namespace sandbox without
# disabling the system-wide unprivileged-userns restriction.
if command -v apparmor_parser >/dev/null && test -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns; then
  cat > /etc/apparmor.d/tinfoil-workbench-chromium <<'EOF'
abi <abi/4.0>,
include <tunables/global>
profile tinfoil-workbench-chromium /opt/tinfoil-workbench-browsers/**/chrome-headless-shell flags=(unconfined) {
  userns,
}
EOF
  apparmor_parser -r /etc/apparmor.d/tinfoil-workbench-chromium
fi
chown -R root:root /opt/tinfoil-workbench-browsers remote/node_modules
chmod -R go-w /opt/tinfoil-workbench-browsers remote/node_modules
