#!/bin/bash
# Runs the G0 integration test (HostedPublicWorkspaceIT) with its default
# qwen.cli.entry and records the processes the test JVM starts.
# usage: run-it.sh <arm> <runName>
set -uo pipefail
ARM="$1"; RUN="$2"
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/ca10fe78-f90a-48aa-bd99-da21179043ff/scratchpad
WT="$S/wt-$ARM"
OUT="$S/runs/$RUN"
mkdir -p "$OUT"
export JAVA_HOME="$HOME/Install/jdk21"
export PATH="$JAVA_HOME/bin:$PATH"
export MAVEN_ARGS="-Dmaven.repo.local=$S/m2-$ARM --batch-mode --no-transfer-progress"
export TMPDIR="/private/tmp/claude-501/p13093/$RUN"; mkdir -p "$TMPDIR"
cd "$WT" || exit 97
{
  echo "run=$RUN arm=$ARM head=$(git rev-parse HEAD) dirty=$(git status --short | wc -l | tr -d ' ')"
  echo "started=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "java=$(java -version 2>&1 | head -1) node=$(command -v node) $(node -v)"
  echo "dist/cli.js sha256=$(shasum -a 256 dist/cli.js | cut -c1-16)"
} >"$OUT/env.txt"
T0=$(date +%s)
# No -Dqwen.cli.entry: the test must fall back to ../../../dist/cli.js.
mvn -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-harness-mysql \
  -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false \
  -Dit.test=HostedPublicWorkspaceIT -Dnode.executable="$(command -v node)" \
  verify >"$OUT/stdout.log" 2>&1 &
RUNNER=$!
node "$S/rig/watch-procs.mjs" "$RUNNER" "$OUT/procs.jsonl" "$WT/dist/" &
WATCH=$!
wait "$RUNNER"; RC=$?
sleep 1
kill -TERM "$WATCH" 2>/dev/null; wait "$WATCH" 2>/dev/null
TESTS=$(grep -E "Tests run:.*HostedPublicWorkspaceIT|Tests run: [0-9]+, Failures" "$OUT/stdout.log" | tail -1 | sed 's/^ *//')
echo "RESULT run=$RUN arm=$ARM rc=$RC seconds=$(( $(date +%s) - T0 )) tests=[$TESTS] head=$(git rev-parse --short=10 HEAD)" | tee "$OUT/RESULT"
