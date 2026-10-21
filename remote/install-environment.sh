#!/bin/bash
# Operator-only host prerequisites. Does not alter the worker's pinned Node binary.
set -euo pipefail
test "$(id -u)" = 0
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
apt-get update
apt-get install -y --no-install-recommends \
  python3 python3-dev python3-pip python3-venv pipx \
  build-essential clang cmake ninja-build pkg-config gdb autoconf automake libtool \
  git git-lfs curl wget ca-certificates xz-utils unzip zip rsync ripgrep jq \
  tree tmux shellcheck file dnsutils netcat-openbsd
command -v docker >/dev/null
docker info >/dev/null
docker compose version
docker buildx version

version=v24.22.0
archive=node-${version}-linux-x64.tar.xz
target=/opt/node-${version}-linux-x64
checksum=cc2f601cee82d9a5a233302fe307abc600727035fd7d2c3a3571755989e95008
if ! test -x "$target/bin/node"; then
  stage=$(mktemp -d /var/tmp/tinfoil-node.XXXXXXXX)
  curl --fail --show-error --silent --location "https://nodejs.org/dist/${version}/${archive}" -o "$stage/$archive"
  printf '%s  %s\n' "$checksum" "$stage/$archive" | sha256sum --check --status
  tar -xJf "$stage/$archive" -C /opt --no-same-owner
  rm -- "$stage/$archive"
  rmdir -- "$stage"
fi
test "$("$target/bin/node" --version)" = "$version"
for name in node npm npx; do
  link=/usr/local/bin/$name
  if test -e "$link" || test -L "$link"; then
    test "$(readlink "$link")" = "$target/bin/$name" || { echo "Refusing to replace $link" >&2; exit 1; }
  else
    ln -s "$target/bin/$name" "$link"
  fi
done
node --version
npm --version
python3 --version
gcc --version | head -n 1
clang --version | head -n 1
git --version
