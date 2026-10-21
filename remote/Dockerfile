FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-dev python3-venv python3-pip pipx git git-lfs ripgrep curl wget jq unzip zip rsync tree \
    build-essential clang cmake ninja-build pkg-config gdb autoconf automake libtool \
    procps file shellcheck dnsutils netcat-openbsd ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY remote/workbench-env.py /usr/local/bin/workbench-env
RUN chmod 755 /usr/local/bin/workbench-env
WORKDIR /opt/workbench
COPY dist/core ./dist/core
COPY desktop/agent-tools.mjs ./desktop/agent-tools.mjs
COPY remote/container-tools.mjs ./remote/container-tools.mjs
USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/workbench/remote/container-tools.mjs"]
