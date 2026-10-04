#!/usr/bin/env bash
# PR #9273 round 2 — revert each production change of 0b51eef6c6 on its own
# and run the suite that should catch it. The worktree is clean at the PR head
# before each mutant; each is restored with `git checkout HEAD -- <file>`.
set -u
WT=/root/verify/pr9273/head
P=packages/cli/src/commands/review
L=/root/verify/pr9273/e2e/r2/logs; mkdir -p $L
H() { printf '\n\033[1;36m━━ %s\033[0m\n' "$*"; }
cd $WT
[ -z "$(git status --porcelain -- packages)" ] || { echo "worktree not clean"; exit 1; }
trap 'git checkout -q HEAD -- $P' EXIT
mut() { # id, file, python-replace-old, python-replace-new, suites...
  local id=$1 f=$2 old=$3 new=$4; shift 4
  python3 - "$f" "$old" "$new" "${COUNT:--1}" <<'EOF'
import sys
p, old, new, count = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
s = open(p).read()
n = s.count(old)
if n == 0: sys.exit("pattern not found: " + old)
open(p, 'w').write(s.replace(old, new, count))
EOF
  local d; d=$(git diff --numstat -- $f | awk '{print "+"$1"/-"$2}')
  (cd packages/cli && CI=true npx vitest run "$@" > $L/mut-$id.log 2>&1)
  local t; t=$(sed 's/\x1b\[[0-9;]*m//g' $L/mut-$id.log | grep -E '^\s+Tests ' | tr -s ' ' | sed 's/^ //')
  local col='\033[1;31m'; [[ "$t" == *failed* ]] && col='\033[1;32m'
  printf '  %-4s %-58s %-8s → %b%s\033[0m\n' "$id" "$MSG" "$d" "$col" "$t"
  sed 's/\x1b\[[0-9;]*m//g' $L/mut-$id.log | grep -E '^\s+(×|FAIL) ' | sed 's/^ *//' | cut -c1-150 | sort -u | head -4 | sed 's/^/         /'
  git checkout -q HEAD -- $f
}
printf '\033[1mPR #9273 round 2 — mutation spot-checks of 0b51eef6c6\033[0m (green = the suite catches the revert)\n'
H "each production change reverted alone"
MSG="png stage loses its .png suffix (finding 1)"
mut M1 $P/capture-tui.ts '`${pngPath}.render-${renderNonce}.png`' '`${pngPath}.render-${renderNonce}`' src/commands/review/capture-tui.test.ts
MSG="session targets back to fuzzy -t cap (R26-4)"
mut M2 $P/lib/tui-capture.ts '`=${opts.session}:`' 'opts.session' src/commands/review/capture-tui.test.ts src/commands/review/lib/tui-capture.test.ts
MSG="signal death treated as ran-and-failed (R26-2)"
mut M3 $P/capture-tui.ts "return code?.startsWith('signal ') ?? false;" "return false;" src/commands/review/capture-tui.test.ts
MSG="cleanup: ENOENT after kill counts as a swap again (R26-3)"
mut M4 $P/cleanup.ts "entryChanged =
        (e as NodeJS.ErrnoException).code !== 'ENOENT' &&
        (e as NodeJS.ErrnoException).code !== 'ENOTDIR';" "void e; entryChanged = true;" src/commands/review/cleanup.test.ts
MSG="drop the added 'socketStamp === undefined ||' (:1526) only"
COUNT=1 mut M5a $P/capture-tui.ts "            socketStamp === undefined ||
" "" src/commands/review/capture-tui.test.ts
MSG="full R26-5 revert: other-base clause gated on the stamp again"
python3 - $P/capture-tui.ts <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
s = s.replace("            socketStamp === undefined ||\n", "", 1)
s = s.replace("            resolve(base) !== startBase;", "            (socketStamp !== undefined && resolve(base) !== startBase);", 1)
open(p, 'w').write(s)
PY
mut M5b $P/capture-tui.ts "(socketStamp !== undefined && resolve(base) !== startBase);" "(socketStamp !== undefined && resolve(base) !== startBase);" src/commands/review/capture-tui.test.ts
MSG="freeze argv drops --font.family monospace (finding 3)"
mut M6 $P/lib/tui-capture.ts "    '--font.family',
    'monospace',
" "" src/commands/review/lib/tui-capture.test.ts src/commands/review/capture-tui.test.ts
H "not in this commit's diff — the same spelling in the reap's confirmedDead test"
MSG="drop 'socketStamp === undefined ||' at :1634 (pre-existing)"
python3 - $P/capture-tui.ts <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); pat = "            socketStamp === undefined ||\n"
i = s.index(pat); i = s.index(pat, i + 1)
open(p, 'w').write(s[:i] + s[i+len(pat):])
PY
mut M7 $P/capture-tui.ts "stampedAliveAtFallbackKill" "stampedAliveAtFallbackKill" src/commands/review/capture-tui.test.ts
trap - EXIT
printf '\n  worktree clean after restore: %s\n' "$([ -z "$(git status --porcelain -- packages)" ] && echo yes || echo NO)"
