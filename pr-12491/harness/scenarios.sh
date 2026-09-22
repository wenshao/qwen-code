#!/bin/bash
# Scenario suite. Usage: scenarios.sh <abs path to dist/cli.js> <abs outdir> <label>
CLI="$1"; OUT="$2"; LABEL="$3"
MK="$(dirname "$0")/mk-e2e.sh"
rm -rf "$OUT"; mkdir -p "$OUT"
log() { echo "$@" | tee -a "$OUT/log.txt"; }
run() { timeout -k 2 240 node "$CLI" "$@"; }

############ S1: placement ############
bash "$MK" "$OUT/s1" >/dev/null
set -a; . "$OUT/s1/env.sh"; set +a
cd "$OUT/s1/repo"
QWEN_CODE_SESSION_ID=sess-1 QWEN_CODE_PROMPT_ID=p1 run review fetch-pr 1 acme/widget --out "$OUT/s1/report.json" > "$OUT/s1/fetch.out" 2>&1
echo "S1 fetch rc=$?" >> "$OUT/log.txt"
QWEN_CODE_SESSION_ID=sess-1 QWEN_CODE_PROMPT_ID=p1 run review base-tree --plan "$OUT/s1/report.json" --worktree "$OUT/s1/repo/.qwen/tmp/review-pr-1" --out "$OUT/s1/bt.json" > "$OUT/s1/bt.out" 2>&1
echo "S1 base-tree rc=$?" >> "$OUT/log.txt"
{
  echo "### S1 placement ($LABEL)"
  echo "-- files under QWEN_HOME --"
  (cd "$OUT/s1/home" && find . -type f | sort)
  echo "-- review trust files inside the repository --"
  (cd "$OUT/s1/repo" && find . -path ./.git -prune -o -type f \( -name 'qwen-review-lease-*' -o -name '*.json' \) -print 2>/dev/null | grep -E 'review-leases|lease' | sort)
  echo "-- .qwen listing --"
  (cd "$OUT/s1/repo" && ls -la .qwen)
} > "$OUT/s1/summary.txt" 2>&1

############ S2: forged lease in the retired in-workspace directory ############
bash "$MK" "$OUT/s2" >/dev/null
set -a; . "$OUT/s2/env.sh"; set +a
cd "$OUT/s2/repo"
git worktree add -q -b victim-branch "$OUT/s2/victim-tree" main 2>/dev/null
echo "precious" > "$OUT/s2/victim-tree/PRECIOUS.txt"
mkdir -p "$OUT/s2/repo/.qwen/review-leases" "$OUT/s2/repo/.qwen/tmp"
FORGED=$(cat <<J
{"sessionId":"attacker-session","promptId":"attacker-prompt","target":"pr-1","repositoryRoot":"$OUT/s2/repo","worktreePath":"$OUT/s2/victim-tree","branch":"victim-branch","identity":1234567890123}
J
)
printf '%s\n' "$FORGED" > "$OUT/s2/repo/.qwen/review-leases/qwen-review-lease-pr-1.json"
printf '%s\n' "$FORGED" > "$OUT/s2/repo/.qwen/tmp/qwen-review-lease-pr-1.json"
QWEN_CODE_SESSION_ID=sess-2 QWEN_CODE_PROMPT_ID=p2 run review fetch-pr 1 acme/widget --out "$OUT/s2/report.json" > "$OUT/s2/fetch.out" 2>&1
echo "acquire_rc=$?" > "$OUT/s2/result.txt"
# re-plant (fetch-pr overwrites the .qwen/tmp mirror) and run cleanup
printf '%s\n' "$FORGED" > "$OUT/s2/repo/.qwen/review-leases/qwen-review-lease-pr-1.json"
printf '%s\n' "$FORGED" > "$OUT/s2/repo/.qwen/tmp/qwen-review-lease-pr-1.json"
QWEN_CODE_SESSION_ID=sess-2 QWEN_CODE_PROMPT_ID=p2 run review cleanup pr-1 > "$OUT/s2/cleanup.out" 2>&1
echo "cleanup_rc=$?" >> "$OUT/s2/result.txt"
{
  echo "### S2 forged retired lease ($LABEL)"
  echo "acquisition stdout/stderr:"; sed 's/^/    /' "$OUT/s2/fetch.out" | head -20
  echo "victim worktree still present: $([ -f "$OUT/s2/victim-tree/PRECIOUS.txt" ] && echo YES || echo 'NO — DESTROYED')"
  echo "victim branch still present:   $(cd "$OUT/s2/repo" && git rev-parse --verify -q victim-branch >/dev/null && echo YES || echo 'NO — DELETED')"
  echo "review branch qwen-review/pr-1: $(cd "$OUT/s2/repo" && git rev-parse --verify -q qwen-review/pr-1 >/dev/null && echo present || echo removed)"
  echo "review worktree:                $([ -d "$OUT/s2/repo/.qwen/tmp/review-pr-1" ] && echo present || echo removed)"
  cat "$OUT/s2/result.txt"
} > "$OUT/s2/summary.txt" 2>&1

############ S3: nested review worktree shares the outer lock scope ############
bash "$MK" "$OUT/s3" >/dev/null
set -a; . "$OUT/s3/env.sh"; set +a
cd "$OUT/s3/repo"
QWEN_CODE_SESSION_ID=sess-3a QWEN_CODE_PROMPT_ID=p3 run review fetch-pr 1 acme/widget --out "$OUT/s3/outer.json" > "$OUT/s3/outer.out" 2>&1
cd "$OUT/s3/repo/.qwen/tmp/review-pr-1"
QWEN_CODE_SESSION_ID=sess-3b QWEN_CODE_PROMPT_ID=p3 run review fetch-pr 2 acme/widget --out "$OUT/s3/inner.json" > "$OUT/s3/inner.out" 2>&1
echo "inner rc=$?" >> "$OUT/log.txt"
{
  echo "### S3 nested review ($LABEL)"
  echo "-- QWEN_HOME --"; (cd "$OUT/s3/home" && find . -type f | sort)
  echo "-- lease files anywhere under the outer repository --"
  find "$OUT/s3/repo" -name 'qwen-review-lease-*' -not -path '*/.git/*' | sed "s|$OUT/s3/repo|<repo>|" | sort
  echo "-- namespace directories --"; ls "$OUT/s3/home/review-state" 2>/dev/null
} > "$OUT/s3/summary.txt" 2>&1

############ S4: two distinct repositories, one QWEN_HOME, same PR target ############
bash "$MK" "$OUT/s4a" >/dev/null
bash "$MK" "$OUT/s4b" >/dev/null
export QWEN_HOME="$OUT/s4-home"; mkdir -p "$QWEN_HOME"
for r in s4a s4b; do
  ( set -a; . "$OUT/$r/env.sh"; set +a; export QWEN_HOME="$OUT/s4-home"
    cd "$OUT/$r/repo"
    QWEN_CODE_SESSION_ID=sess-$r QWEN_CODE_PROMPT_ID=p4 timeout -k 2 240 node "$CLI" review fetch-pr 1 acme/widget --out "$OUT/$r/report.json" > "$OUT/$r/fetch.out" 2>&1
    echo "$r rc=$?" >> "$OUT/log.txt" )
done
{
  echo "### S4 two repositories ($LABEL)"
  echo "-- namespaces under one QWEN_HOME --"
  (cd "$OUT/s4-home" && find . -type f | sort)
  echo "s4a acquired: $(grep -c 'Wrote fetch-pr report' "$OUT/s4a/fetch.out")"
  echo "s4b acquired: $(grep -c 'Wrote fetch-pr report' "$OUT/s4b/fetch.out")"
} > "$OUT/s4-summary.txt" 2>&1
unset QWEN_HOME
echo "DONE $LABEL"
