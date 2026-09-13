#!/bin/bash
# Three trusted git workspaces with distinct dirty/stash state + one project skill.
set -euo pipefail
source /root/git/h11644/env.sh
rm -rf "$H/ws" "$HOME_QWEN" "$QWEN_RUNTIME_DIR"
mkdir -p "$WS" "$WS2" "$WS3" "$HOME_QWEN/.qwen" "$QWEN_RUNTIME_DIR"
mkrepo() { # dir modified stashes
  local d=$1 mod=$2 stash=$3
  cd "$d"; git init -q -b main; git config user.email e2e@example.com; git config user.name e2e
  for i in $(seq 1 6); do echo "line $i" > "f$i.txt"; done
  mkdir -p .qwen/skills/release-notes
  printf -- '---\nname: release-notes\ndescription: Draft release notes from recent commits\n---\n\nSummarize the changes.\n' > .qwen/skills/release-notes/SKILL.md
  git add -A; git commit -qm init
  for s in $(seq 1 "$stash"); do echo "stash $s" >> f1.txt; git stash -q; done
  for i in $(seq 1 "$mod"); do echo "edit" >> "f$i.txt"; done
}
mkrepo "$WS" 3 2
mkrepo "$WS2" 1 0
mkrepo "$WS3" 0 0
cat > "$HOME_QWEN/.qwen/settings.json" <<JSON
{ "security": { "folderTrust": { "enabled": true }, "auth": { "selectedType": "openai" } },
  "model": { "name": "mock-model" } }
JSON
cat > "$HOME_QWEN/.qwen/trustedFolders.json" <<JSON
{ "$WS": "TRUST_FOLDER", "$WS2": "TRUST_FOLDER", "$WS3": "TRUST_FOLDER" }
JSON
echo "setup done"; for d in "$WS" "$WS2" "$WS3"; do (cd "$d"; echo "$d: $(git status --porcelain | wc -l) modified, $(git stash list | wc -l) stashed"); done
