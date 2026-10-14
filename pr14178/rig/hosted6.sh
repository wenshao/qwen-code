#!/bin/bash
# usage: hosted6.sh <head|base> <tag> [config]   (env passes through, e.g. RUNNER_NAME)
S=$SCRATCH
ARM=$1; TAG=$2; CFG=${3:-vitest.config.ts}
cd $S/wt-head/packages/cli
if [ "$ARM" = base ]; then FILES="src/serve/hosted-harness-session.pr14178base.test.ts src/serve/hosted-hook-session.pr14178base.test.ts"; else FILES="src/serve/hosted-harness-session.test.ts src/serve/hosted-hook-session.test.ts"; fi
H='marks the publication flag not-applicable on a profile-less cold refusal|names the blocked authorization reason a refused restore discarded|completes a long answer \(streamed: (true|false)\) under the real inline bound'
K='waits for Runtime admission before acknowledging an async Hook|rejects a changed input while the same occurrence is still running|cancels an active occurrence and does not dispatch later sequential hooks'
LOG=$S/logs/hosted-$TAG-$ARM.log
npx vitest run --coverage.enabled=false --config $CFG $FILES -t "$H|$K" --reporter=verbose > $LOG 2>&1
echo "EXIT=$? $TAG $ARM RUNNER_NAME=${RUNNER_NAME:-unset}"; grep -E "^ +(✓|×)|Test Files|Tests  |Errors  |PR14178 delayed" $LOG | sed 's/src\/serve\///' | cut -c1-200 | head -24
