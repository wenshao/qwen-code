#!/bin/bash
# Round-2 unit suites at PR head + three mutation probes (restored with git checkout; worktree is clean at HEAD).
set -uo pipefail
WT=/root/git/pr11644; O=/root/git/h11644/out/r2; mkdir -p $O
cd $WT
test -z "$(git status --porcelain)" || { echo "worktree dirty, abort"; exit 1; }
WSFILES=$(git diff --name-only b5567bb7a9 HEAD -- packages/web-shell | grep -E '\.test\.tsx?$' | grep -v '/e2e/' | sed 's|packages/web-shell/||')
echo "web-shell test files: $(echo $WSFILES | wc -w)"
(cd packages/web-shell && nice -n 10 npx vitest run $WSFILES > $O/vitest-ws.log 2>&1; echo "WS EXIT=$?" >> $O/vitest-ws.log)
(cd packages/sdk-typescript && nice -n 10 npx vitest run test/unit/DaemonClient.test.ts > $O/vitest-sdk.log 2>&1; echo "SDK EXIT=$?" >> $O/vitest-sdk.log)
grep -a -E "Test Files|Tests  |EXIT=" $O/vitest-ws.log $O/vitest-sdk.log

probe() { # name file python-old python-new test-cmd-dir test-args...
  local name=$1 file=$2 old=$3 new=$4 dir=$5; shift 5
  python3 - "$file" "$old" "$new" <<'PY' || { echo "[$name] mutation anchor not found"; return; }
import sys
p, old, new = sys.argv[1:4]; s = open(p).read()
assert s.count(old) == 1, f'anchor count {s.count(old)}'
open(p, 'w').write(s.replace(old, new))
PY
  (cd $dir && nice -n 10 npx vitest run "$@" > $O/mut-$name.log 2>&1); local rc=$?
  git checkout -- "$file"
  echo "[$name] mutant exit=$rc  $(grep -a -E 'Tests  ' $O/mut-$name.log | tail -1)"
  grep -a -E '^\s+(×|✗|FAIL)' $O/mut-$name.log | head -4
}
# M1 — R1-23: restore budget follows only the newest discovery (pre-fix semantics)
probe M1-restore-budget packages/sdk-typescript/src/daemon/DaemonClient.ts \
  'if (generation > this.restoreBudgetGeneration) {' 'if (generation === this.capabilitiesGeneration) {' \
  packages/sdk-typescript test/unit/DaemonClient.test.ts
# M2 — R1-3: a failed status read no longer keeps Live setup polling
probe M2-live-refresh-error packages/web-shell/client/live/useLiveVoiceSetup.ts \
  '    Boolean(refreshError) ||' '    false ||' \
  packages/web-shell client/live/useLiveVoiceSetup.test.tsx
# M3 — b27c100ea7: recovery limited to new chats again
NAMES=$(git show HEAD -- packages/web-shell/client/App.test.tsx | grep -E "^\+\s*(it|test)\(" | sed -E "s/^\+\s*(it|test)\(\s*['\"\`]//; s/['\"\`],.*$//" | head -4)
echo "b27 new tests:"; echo "$NAMES"
PAT=$(echo "$NAMES" | python3 -c "import sys,re; print('|'.join(re.escape(l.strip()) for l in sys.stdin if l.strip()))")
probe M3-b27-recovery packages/web-shell/client/App.tsx \
  'if (!admissionStarted && (startedWithoutSession || !failedMessage)) {' 'if (startedWithoutSession && !admissionStarted) {' \
  packages/web-shell client/App.test.tsx -t "$PAT"
# M3 control: same filtered tests on the unmutated tree must pass
(cd packages/web-shell && nice -n 10 npx vitest run client/App.test.tsx -t "$PAT" > $O/mut-M3-control.log 2>&1); echo "[M3-control] exit=$? $(grep -a -E 'Tests  ' $O/mut-M3-control.log | tail -1)"
git status --short | head -3; echo UNIT-R2-DONE
