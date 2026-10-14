#!/bin/bash
# runs INSIDE pr14120-lx (maven:3.9.11-eclipse-temurin-21 on .75)
set -e
exec > >(tee -a /rig/setup.log) 2>&1
echo "SETUP_START $(date -u +%FT%TZ)"
if ! command -v node >/dev/null; then
  curl -fsSL https://registry.npmmirror.com/-/binary/node/v22.23.3/node-v22.23.3-linux-arm64.tar.gz | tar xz -C /usr/local --strip-components=1
fi
node -v; java -version 2>&1 | head -1; mvn -v | head -1
mkdir -p /root/.m2
cat > /root/.m2/settings.xml <<'XML'
<settings><mirrors><mirror><id>aliyun</id><mirrorOf>central</mirrorOf><url>https://maven.aliyun.com/repository/public</url></mirror></mirrors></settings>
XML
if [ ! -d /work/head/.git ]; then
  mkdir -p /work && tar xf /rig/head.tar -C /work
  cd /work/head && git init -q && git -c user.email=rig@x -c user.name=rig add -A && git -c user.email=rig@x -c user.name=rig commit -qm 'PR 14120 head e24dc69ecf'
fi
cd /work/head && git log --oneline | head -1
export COREPACK_NPM_REGISTRY=https://registry.npmmirror.com npm_config_registry=https://registry.npmmirror.com npm_config_workspace_concurrency=2
corepack enable
time corepack pnpm install --frozen-lockfile --prefer-offline --reporter=append-only
ls -la dist/cli.js
time mvn --batch-mode --no-transfer-progress -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install
time mvn --batch-mode --no-transfer-progress -f packages/sdk-java/runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true install
# prefetch the IT-phase plugins once, so later timings are not download time
mvn --batch-mode --no-transfer-progress -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-monitor-run-gates -DskipTests -Dcheckstyle.skip verify > /rig/prefetch.log 2>&1 || true
# runner user (CI shape) + tree copies
id runner >/dev/null 2>&1 || useradd -m -u 1001 -s /bin/bash runner
mkdir -p /home/runner/.m2 && cp /root/.m2/settings.xml /home/runner/.m2/settings.xml
[ -d /home/runner/.m2/repository ] || cp -a /root/.m2/repository /home/runner/.m2/repository
chown -R runner:runner /home/runner
for t in ci probe mut; do [ -d /work/$t ] || cp -a /work/head /work/$t; done
chown -R runner:runner /work/ci
node /rig/scripts/patch-probe.mjs /work/probe
# pristine bundle outputs for exact restore after TS mutants
cp -a /work/mut/dist /work/mut-dist.orig && cp -a /work/mut/packages/core/dist /work/mut-core-dist.orig
mkdir -p /rig/results; chmod 755 /work
echo "SETUP_DONE $(date -u +%FT%TZ)"
