FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends jq curl ca-certificates \
 && curl -fsSL https://github.com/cli/cli/releases/download/v2.63.2/gh_2.63.2_linux_amd64.tar.gz -o /tmp/gh.tgz \
 && tar -xzf /tmp/gh.tgz -C /tmp \
 && install -m 0755 /tmp/gh_2.63.2_linux_amd64/bin/gh /usr/local/bin/gh \
 && rm -rf /tmp/gh* && rm -rf /var/lib/apt/lists/*
RUN gh --version && jq --version && node --version
