#!/bin/bash
# Real-CLI A/B of the startup stale-worktree sweep (PR #12763).
# usage: sweep-matrix.sh <arm-name> <worktree-with-dist> <fake-model-port> <outdir>
set -euo pipefail
ARM=$1; WT=$2; PORT=$3; OUT=$4
rm -rf "$OUT"; mkdir -p "$OUT"
NODE_BIN=$(dirname "$(command -v node)")
BASEPATH="$NODE_BIN:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
H="$OUT/home"; mkdir -p "$H/.qwen" "$H/runtime"
printf '{ "privacy": { "usageStatisticsEnabled": false } }\n' > "$H/.qwen/settings.json"
G() { env -i HOME="$H" PATH="$BASEPATH" git "$@"; }

mkrepo() { # $1 dir, $2 gitignore
  mkdir -p "$1"; cd "$1"
  G init -q; G symbolic-ref HEAD refs/heads/main
  G config user.email t@e.com; G config user.name t; G config commit.gpgsign false
  printf '%b' "$2" > .gitignore
  mkdir -p packages/app/src; echo 'export const a = 1;' > packages/app/src/index.ts
  echo '{"name":"app"}' > packages/app/package.json; echo '# fixture' > README.md
  G add -A; G commit -qm init
}
mkwt() { # $1 slug -> prints path
  G -C "$REPO" worktree add -q -b "worktree-$1" "$REPO/.qwen/worktrees/$1" main
  echo "$REPO/.qwen/worktrees/$1"
}

# ---- repo A: this repo's own ignore style (node_modules without a slash) ----
REPO="$OUT/repoA"
mkrepo "$REPO" '.env\nnode_modules\ndist\ncoverage\n.qwen/*\n*.log\n*.tsbuildinfo\n'
declare -a CASES=()
add() { CASES+=("$1|$2|$3"); }   # slug|label|probe-path (relative, must survive if preserved)

w=$(mkwt agent-a000001); add agent-a000001 "clean checkout" ""
w=$(mkwt agent-a000002); echo 'AWS_SECRET_ACCESS_KEY=example' > "$w/.env"; add agent-a000002 "ignored .env (credentials)" ".env"
w=$(mkwt agent-a000003); mkdir -p "$w/.qwen/pr-drafts"; echo '# draft PR body' > "$w/.qwen/pr-drafts/feature.md"; add agent-a000003 "ignored .qwen/pr-drafts/feature.md" ".qwen/pr-drafts/feature.md"
w=$(mkwt agent-a000004); echo 'kept investigation log' > "$w/debug.log"; add agent-a000004 "ignored *.log" "debug.log"
w=$(mkwt agent-a000005); echo 'agent notes' > "$w/notes.md"; add agent-a000005 "untracked notes.md" "notes.md"
w=$(mkwt agent-a000006); echo 'export const a = 2;' > "$w/packages/app/src/index.ts"; add agent-a000006 "tracked edit" "packages/app/src/index.ts"
w=$(mkwt agent-a000007); mkdir -p "$w/node_modules/left-pad"; echo '//' > "$w/node_modules/left-pad/index.js"; add agent-a000007 "root node_modules/ only" ""
w=$(mkwt agent-a000008); mkdir -p "$w/dist" "$w/coverage"; echo '//' > "$w/dist/cli.js"; echo '{}' > "$w/coverage/c.json"; add agent-a000008 "root dist/ + coverage/ only" ""
w=$(mkwt agent-a000009); echo 'session-1' > "$w/.qwen-session"; add agent-a000009 ".qwen-session marker only" ""
w=$(mkwt agent-a000010); mkdir -p "$w/node_modules/.pnpm" "$w/packages/app/node_modules/left-pad" "$w/packages/app/dist"; echo '//' > "$w/packages/app/node_modules/left-pad/index.js"; echo '//' > "$w/packages/app/dist/index.js"; echo '{}' > "$w/packages/app/tsconfig.tsbuildinfo"; add agent-a000010 "monorepo install+build (packages/app/{node_modules,dist}, tsbuildinfo)" ""
w=$(mkwt agent-a000011); echo 'agent notes' > "$w/notes.md"; echo 'KEY=1' > "$w/.env"; rm "$w/.git"; add agent-a000011 "worktree lost its .git file (notes.md + .env)" "notes.md"
# the session marker is git-excluded in production (addWorktreeSessionMarkerExclude)
echo '.qwen-session' >> "$REPO/.git/info/exclude"

# ---- repo B: GitHub Node template ignore style (node_modules/ with a slash) ----
REPO_B="$OUT/repoB"
mkrepo "$REPO_B" 'node_modules/\ndist/\n.env\n'
mkdir -p "$REPO_B/node_modules/left-pad"; echo '//' > "$REPO_B/node_modules/left-pad/index.js"
REPO_SAVE=$REPO; REPO=$REPO_B
w=$(mkwt agent-b000001); ln -s "$REPO_B/node_modules" "$w/node_modules"; add agent-b000001 "B: node_modules symlink (worktree.symlinkDirectories)" ""
REPO=$REPO_SAVE

# Age every worktree dir past the 30-day cutoff AFTER all writes.
for r in "$OUT/repoA" "$OUT/repoB"; do
  for d in "$r"/.qwen/worktrees/agent-*; do touch -h -t "$(date -v-45d +%Y%m%d%H%M)" "$d"; done
done

# Snapshot what the predicate-under-test sees in each worktree (exact argv).
for c in "${CASES[@]}"; do
  slug=${c%%|*}; r="$OUT/repoA"; [[ $slug == agent-b* ]] && r="$OUT/repoB"
  printf '%s\n' "## $slug" >> "$OUT/status-snapshot.txt"
  (cd "$r/.qwen/worktrees/$slug" && env -i HOME="$H" PATH="$BASEPATH" git -c core.fsmonitor= -c log.showSignature=false --no-optional-locks status --porcelain --untracked-files=normal --ignored=matching) >> "$OUT/status-snapshot.txt" 2>&1 || true
done

run_cli() { # $1 repo
  (cd "$1" && env -i HOME="$H" PATH="$BASEPATH" TERM=dumb NO_COLOR=1 \
    QWEN_HOME="$H/.qwen" QWEN_RUNTIME_DIR="$H/runtime" \
    node "$WT/dist/cli.js" -p "hello" --auth-type openai --openai-api-key dummy \
      --openai-base-url "http://127.0.0.1:$PORT/v1" --model dummy --approval-mode yolo --debug \
    > "$OUT/cli-$(basename "$1").out" 2> "$OUT/cli-$(basename "$1").err") || echo "cli exit $?" >> "$OUT/cli-$(basename "$1").err"
}
run_cli "$OUT/repoA"
run_cli "$OUT/repoB"

# Result table.
{
  printf '%-15s %-8s %-8s %s\n' slug dir branch case
  for c in "${CASES[@]}"; do
    IFS='|' read -r slug label probe <<< "$c"
    r="$OUT/repoA"; [[ $slug == agent-b* ]] && r="$OUT/repoB"
    d="$r/.qwen/worktrees/$slug"
    if [ -d "$d" ]; then dir=KEPT; else dir=REMOVED; fi
    if G -C "$r" show-ref --verify --quiet "refs/heads/worktree-$slug"; then br=kept; else br=deleted; fi
    extra=""; if [ -n "$probe" ] && [ "$dir" = REMOVED ]; then extra="  <- $probe destroyed"; fi
    printf '%-15s %-8s %-8s %s%s\n' "$slug" "$dir" "$br" "$label" "$extra"
  done
} > "$OUT/result.txt"
grep -rh "Stale worktree sweep\|WORKTREE_CLEANUP" "$H/runtime" "$H/.qwen" 2>/dev/null | sed 's/^/log: /' >> "$OUT/result.txt" || true
cat "$OUT/result.txt"
