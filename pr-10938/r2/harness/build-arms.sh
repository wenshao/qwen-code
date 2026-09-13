#!/bin/bash
# Builds the web-shell APP bundle for three arms from the ONE head worktree by
# swapping sources, so the arms share node_modules / SDK dist and differ only
# in the swapped files. Restores the worktree and the lib bundle at the end.
set -euo pipefail
WT=/var/tmp/pr10938-wt
LOG=/root/git/pr10938-harness/r2/out
MB=bc7a186cdadc1235cafda295799080d1d6ab0b5a
FIX=4860e0a7e655a805c2fcbf4584a5d9f01cc9e736
C=packages/web-shell/client/components
SRC="$C/messages/PlanExecutionView.tsx $C/messages/PlanExecutionView.module.css $C/workflow/SessionWorkflowCockpit.tsx $C/workflow/SessionWorkflowCockpit.module.css $C/workflow/SessionWorkflowInspector.tsx $C/workflow/SessionWorkflowInspector.module.css packages/web-shell/client/i18n.tsx"
cd "$WT"
[ -z "$(git status --porcelain -- packages)" ] || { echo "worktree dirty"; git status --short | head; exit 1; }

build_to() {
  local dest=$1 name=$2
  rm -rf packages/web-shell/dist/assets
  (cd packages/web-shell && npx vite build > "$LOG/build-$name.log" 2>&1)
  rm -rf "$dest"; mkdir -p "$dest"
  cp -r packages/web-shell/dist/index.html packages/web-shell/dist/assets "$dest/"
  echo "[$name] $(grep -o 'assets/index-[^"]*\.js' "$dest/index.html" | head -1)"
}

# --- base: the 7 changed sources exactly as on the merge base ---
for f in $SRC; do git show "$MB:$f" > "$f"; done
git diff --quiet "$MB" -- $SRC && echo "[base] 7 sources byte-identical to $MB"
git diff --stat | tail -1
build_to /var/tmp/pr10938-ws-base-r2 base
git checkout -- packages/web-shell

# --- revert: head minus the fix commit (2 files) ---
git show "$FIX" --format= -- $C/messages/PlanExecutionView.tsx $C/messages/PlanExecutionView.module.css | git apply -R
git diff > "$LOG/revert-fix.patch"
git diff --stat | tail -3
build_to /var/tmp/pr10938-ws-revert-r2 revert
git checkout -- packages/web-shell

# --- head: rebuild and prove it matches what the daemon serves ---
build_to /var/tmp/pr10938-ws-head-r2 head
echo "[head] daemon-served dist/web-shell: $(grep -o 'assets/index-[^"]*\.js' dist/web-shell/index.html | head -1)"
(cd "$WT" && npm run build --workspace packages/web-shell > "$LOG/build-head-full.log" 2>&1) && echo "[head] lib bundle restored"
git status --porcelain -- packages | head -5
echo "[done]"
