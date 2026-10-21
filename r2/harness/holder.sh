#!/usr/bin/env bash
# Peeks the real host lock file with the real flock(1) for N seconds.
set -uo pipefail
hold=$1
lock="${HOME}/.cache/qwen-code-ci/sdk-java-tests.lock"
mkdir -p "$(dirname "${lock}")"
exec 9>"${lock}"
flock 9
printf 'HOLDER start at=%s\n' "$(date -u +%H:%M:%S.%3N)" >>"${OUT}"
sleep "${hold}"
printf 'HOLDER end at=%s\n' "$(date -u +%H:%M:%S.%3N)" >>"${OUT}"