#!/bin/bash
set -euo pipefail
source /root/git/h11644/env.sh
MB=00d86315c8
cd "$WT"
rm -rf "$H/ws-pr" "$H/ws-base"
cp -r dist/web-shell "$H/ws-pr"
echo "== ws-pr saved: $(md5sum dist/web-shell/index.html)"
FILES=$(git diff --name-only $MB HEAD -- packages/web-shell packages/sdk-typescript)
for f in $FILES; do
  if git cat-file -e "$MB:$f" 2>/dev/null; then git show "$MB:$f" > "$f"; else rm -f "$f"; echo "removed (new in PR): $f"; fi
done
echo "== reverted $(echo "$FILES" | wc -l) files to $MB"
git diff --stat $MB -- packages/web-shell packages/sdk-typescript | tail -1 || true
npm run build --workspace packages/sdk-typescript > "$H/build-sdk-base.log" 2>&1
(cd packages/web-shell && npx vite build > "$H/build-ws-base.log" 2>&1)
mkdir -p "$H/ws-base"; cp -r packages/web-shell/dist/index.html packages/web-shell/dist/assets "$H/ws-base/"
echo "== ws-base saved: $(md5sum packages/web-shell/dist/index.html)"
git checkout -- packages/web-shell packages/sdk-typescript
git status --short | head
npm run build --workspace packages/sdk-typescript > "$H/build-sdk-pr.log" 2>&1
npm run build --workspace packages/web-shell > "$H/build-ws-pr.log" 2>&1
echo "== rebuilt PR web-shell: $(md5sum packages/web-shell/dist/index.html) vs saved $(md5sum $H/ws-pr/index.html)"
diff <(cd packages/web-shell/dist/assets && ls | sort) <(cd $H/ws-pr/assets && ls | sort) && echo "asset names identical"
echo BUILD-ARMS-DONE
