#!/bin/bash
# Full product lifecycle per arm: the real Agent tool (isolation:"worktree")
# creates agent-<7hex> with worktree.symlinkDirectories=["node_modules"], the
# sub-agent makes no edits, then a later CLI start runs the stale sweep.
# usage: lifecycle.sh <arm> <worktree-with-dist> <port> <outdir>
set -euo pipefail
ARM=$1; WT=$2; PORT=$3; OUT=$4
rm -rf "$OUT"; mkdir -p "$OUT"
NODE_BIN=$(dirname "$(command -v node)")
BASEPATH="$NODE_BIN:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
H="$OUT/home"; mkdir -p "$H/.qwen" "$H/runtime"
cat > "$H/.qwen/settings.json" <<'JSON'
{ "privacy": { "usageStatisticsEnabled": false },
  "worktree": { "symlinkDirectories": ["node_modules"] } }
JSON
G() { env -i HOME="$H" PATH="$BASEPATH" git "$@"; }
REPO="$OUT/repo"; mkdir -p "$REPO"; cd "$REPO"
G init -q; G symbolic-ref HEAD refs/heads/main
G config user.email t@e.com; G config user.name t; G config commit.gpgsign false
printf 'node_modules/\ndist/\n.env\n' > .gitignore     # GitHub Node.gitignore style
echo '{"name":"app","scripts":{"test":"node -e 1"}}' > package.json
G add -A; G commit -qm init
mkdir -p node_modules/left-pad; echo 'module.exports=1' > node_modules/left-pad/index.js

cli() { # $1 prompt, $2 tag
  (cd "$REPO" && env -i HOME="$H" PATH="$BASEPATH" TERM=dumb NO_COLOR=1 \
    QWEN_HOME="$H/.qwen" QWEN_RUNTIME_DIR="$H/runtime" QWEN_CODE_SUPPRESS_YOLO_WARNING=1 \
    node "$WT/dist/cli.js" -p "$1" --auth-type openai --openai-api-key dummy \
      --openai-base-url "http://127.0.0.1:$PORT/v1" --model dummy --approval-mode yolo --debug \
    > "$OUT/$2.out" 2> "$OUT/$2.err") || echo "cli exit $?" >> "$OUT/$2.err"
}

{
echo "### [$ARM] step 1: agent run with isolation:\"worktree\""
cli "SPAWN_ISOLATED_AGENT please" run1
echo "cli stdout: $(tr '\n' ' ' < "$OUT/run1.out")"
grep -h "worktree preserved\|preserved\|hasChanges=" "$H"/runtime/debug/*.txt 2>/dev/null | sed -E 's/^[0-9TZ:.-]+ //' | head -3
ls -1 "$REPO/.qwen/worktrees" 2>/dev/null | sed 's/^/left behind: /'
WTDIR=$(ls -d "$REPO"/.qwen/worktrees/agent-* 2>/dev/null | head -1 || true)
if [ -z "$WTDIR" ]; then echo "no agent worktree left behind"; exit 0; fi
echo "entries: $(cd "$WTDIR" && ls -A | tr '\n' ' ')"
echo "node_modules -> $(readlink "$WTDIR/node_modules" || echo '(not a symlink)')"
echo "probe (git status --porcelain --untracked-files=normal --ignored=matching):"
(cd "$WTDIR" && env -i HOME="$H" PATH="$BASEPATH" git --no-optional-locks status --porcelain --untracked-files=normal --ignored=matching) | sed 's/^/    /'
echo "### [$ARM] step 2: age past the 30-day cutoff, start the CLI again"
touch -t "$(date -v-45d +%Y%m%d%H%M)" "$WTDIR"
cli "hello" run2
if [ -d "$WTDIR" ]; then echo "RESULT: $(basename "$WTDIR") KEPT"; else echo "RESULT: $(basename "$WTDIR") REMOVED"; fi
grep -h "Stale worktree sweep" "$H"/runtime/debug/*.txt 2>/dev/null | sed -E 's/^[0-9TZ:.-]+ //' || echo "(no sweep removal logged)"
} 2>&1 | tee "$OUT/lifecycle.txt"
