#!/bin/bash
# Real bubblewrap boundary probe. Usage: bwrap-probe.sh <cli.js> <outdir> <label>
CLI="$1"; OUT="$2"; LABEL="$3"
MK="$(dirname "$0")/mk-e2e.sh"
bash "$MK" "$OUT" >/dev/null
set -a; . "$OUT/env.sh"; set +a
mkdir -p "$QWEN_HOME"
cat > "$QWEN_HOME/settings.json" <<J
{ "tools": { "executionSandbox": { "filesystem": "workspace-write", "network": "closed" } } }
J
cd "$OUT/repo"
# Give the repository a real review lease + trust record first.
QWEN_CODE_SESSION_ID=sess-bw QWEN_CODE_PROMPT_ID=p1 timeout -k 2 240 node "$CLI" review fetch-pr 1 acme/widget --out "$OUT/report.json" > "$OUT/fetch.out" 2>&1
QWEN_CODE_SESSION_ID=sess-bw QWEN_CODE_PROMPT_ID=p1 timeout -k 2 240 node "$CLI" review base-tree --plan "$OUT/report.json" --worktree "$OUT/repo/.qwen/tmp/review-pr-1" --out "$OUT/bt.json" > "$OUT/bt.out" 2>&1
LEASE=$(find "$QWEN_HOME/review-state" -name 'qwen-review-lease-pr-1.json' 2>/dev/null | head -1)
TRUST=$(find "$QWEN_HOME/review-state" -path '*base-tree*' -name '*.json' 2>/dev/null | head -1)
LEGACY="$OUT/repo/.qwen/review-leases/qwen-review-lease-pr-1.json"
# BASE writes its authority inside the workspace; point the probe at whatever exists.
[ -z "$LEASE" ] && LEASE="$LEGACY"
[ -z "$TRUST" ] && TRUST=$(find "$OUT/repo/.qwen/review-leases" -path '*base-tree*' -name '*.json' 2>/dev/null | head -1)
mkdir -p "$OUT/repo/.qwen/review-leases"
cat > "$OUT/probe.sh" <<P
set +e
echo "== uid \$(id -u) =="
echo "-- retired in-workspace directory --"
mkdir -p "$OUT/repo/.qwen/review-leases" 2>&1
( echo PLANTED > "$OUT/repo/.qwen/review-leases/planted.json" ) 2>&1 && echo "write retired dir: OK" || echo "write retired dir: REFUSED"
echo "-- global trusted lease --"
( echo TAMPERED > "$LEASE" ) 2>&1 | sed 's/^/    /'
[ \$? -eq 0 ] || true
( echo TAMPERED > "$LEASE" ) 2>/dev/null && echo "write global lease: OK (NOT CONFINED)" || echo "write global lease: REFUSED"
echo "-- base-tree trust record --"
( echo TAMPERED > "$TRUST" ) 2>/dev/null && echo "write trust record: OK (NOT CONFINED)" || echo "write trust record: REFUSED"
echo "-- an ordinary path outside the workspace --"
( echo TAMPERED > "$OUT/outside.txt" ) 2>/dev/null && echo "write outside workspace: OK (NOT CONFINED)" || echo "write outside workspace: REFUSED"
echo "-- ordinary workspace file --"
( echo ok > "$OUT/repo/in-workspace.txt" ) 2>/dev/null && echo "write inside workspace: OK" || echo "write inside workspace: REFUSED"
echo "-- readable? --"
head -c 40 "$LEASE" 2>/dev/null | tr -d '\n' ; echo
P
{
  echo "### bwrap boundary ($LABEL)"
  echo "lease under test: ${LEASE/#$OUT/<root>}"
  echo "trust under test: ${TRUST/#$OUT/<root>}"
  timeout -k 2 180 node "$CLI" sandbox -- bash "$OUT/probe.sh" 2>&1
  echo "-- host-side aftermath --"
  echo "retired planted.json on host: $([ -f "$OUT/repo/.qwen/review-leases/planted.json" ] && echo "present ($(cat "$OUT/repo/.qwen/review-leases/planted.json"))" || echo absent)"
  echo "global lease first line:      $(head -1 "$LEASE" 2>/dev/null)"
  echo "outside.txt on host:          $([ -f "$OUT/outside.txt" ] && echo present || echo absent)"
} > "$OUT/summary.txt" 2>&1
cat "$OUT/summary.txt"
