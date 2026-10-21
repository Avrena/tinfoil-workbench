#!/bin/bash
set -euo pipefail
cd /usr/local/lib/tinfoil-workbench
id tinfoil-runner >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin tinfoil-runner
install -d -m 700 /etc/tinfoil-workbench /var/lib/tinfoil-workbench
install -d -m 700 /var/lib/tinfoil-workbench/{workspaces,archives}
install -d -m 711 /var/lib/tinfoil-workbench/jobs
install -d -m 700 -o tinfoil-runner -g tinfoil-runner /var/lib/tinfoil-workbench/auth
# Traverse the state root; workspace roots remain root-only. The worker sees only
# job directories owned by its account and systemd's per-service credential.
chmod 711 /var/lib/tinfoil-workbench
chmod 755 remote/broker.py remote/control.py remote/firewall.sh
chmod 755 remote/workspace-cli.py
chown -R root:root remote desktop dist node_modules package.json package-lock.json
chmod -R go-w remote desktop dist node_modules package.json package-lock.json
ln -sfn /usr/local/lib/tinfoil-workbench/remote/control.py /usr/local/bin/tinfoil-workbench
ln -sfn /usr/local/lib/tinfoil-workbench/remote/workspace-cli.py /usr/local/bin/tinfoil-workspace
install -m 644 remote/tinfoil-job@.service /etc/systemd/system/tinfoil-job@.service
printf '%s\n' 'tinfoil-runner ALL=(root) NOPASSWD: /usr/local/lib/tinfoil-workbench/remote/broker.py' > /etc/sudoers.d/tinfoil-workbench
chmod 440 /etc/sudoers.d/tinfoil-workbench
visudo -cf /etc/sudoers.d/tinfoil-workbench
install -d -m 755 /etc/systemd/system/docker.service.d
printf '%s\n' '[Service]' 'ExecStartPost=/usr/local/lib/tinfoil-workbench/remote/firewall.sh' > /etc/systemd/system/docker.service.d/20-tinfoil-workbench.conf
remote/firewall.sh
systemctl daemon-reload
