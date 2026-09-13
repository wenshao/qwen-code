#!/bin/bash
# Round 2: arms pr (b27c100ea7) / base (merge base b5567bb7a9) / fixoff (b27c100ea7 minus its one-line App.tsx fix).
set -euo pipefail
source /root/git/h11644/env.sh
MB=b5567bb7a9
cd "$WT"
test -z "$(git status --porcelain)" || { echo "worktree dirty"; exit 1; }
rm -rf "$H/ws-pr" "$H/ws-base" "$H/ws-fixoff"
cp -r dist/web-shell "$H/ws-pr"
echo "== ws-pr saved: $(md5sum dist/web-shell/index.html)"
grep -o "Document export renderer JS is [0-9,]* bytes" /tmp/claude-0/-root-git-qwen-code-x6/03dde95a-97a5-4f9e-8574-a0b0f6cbd13d/scratchpad/npmci-r2.log | tail -1 | sed 's/^/== PR head export: /' || true
# fixoff arm: only the recovery condition reverted
python3 - <<'PY'
p='packages/web-shell/client/App.tsx'; s=open(p).read()
new="if (!admissionStarted && (startedWithoutSession || !failedMessage)) {"
old="if (startedWithoutSession && !admissionStarted) {"
assert s.count(new) == 1; open(p,'w').write(s.replace(new, old)); print('fixoff mutation applied')
PY
(cd packages/web-shell && npx vite build > "$H/build-ws-fixoff.log" 2>&1)
mkdir -p "$H/ws-fixoff"; cp -r packages/web-shell/dist/index.html packages/web-shell/dist/assets "$H/ws-fixoff/"
git checkout -- packages/web-shell/client/App.tsx
echo "== ws-fixoff saved"
# base arm
FILES=$(git diff --name-only $MB HEAD -- packages/web-shell packages/sdk-typescript)
for f in $FILES; do
  if git cat-file -e "$MB:$f" 2>/dev/null; then git show "$MB:$f" > "$f"; else rm -f "$f"; echo "removed (new in PR): $f"; fi
done
echo "== reverted $(echo "$FILES" | wc -l) files to $MB"
npm run build --workspace packages/sdk-typescript > "$H/build-sdk-base.log" 2>&1
npm run build --workspace packages/web-shell > "$H/build-ws-base.log" 2>&1
mkdir -p "$H/ws-base"; cp -r packages/web-shell/dist/index.html packages/web-shell/dist/assets "$H/ws-base/"
echo "== ws-base saved: $(md5sum packages/web-shell/dist/index.html)"
npm run build --workspace packages/web-templates > "$H/build-templates-base.log" 2>&1 && echo "== base templates build OK" || echo "== base templates build FAILED"
grep -o "Document export renderer JS is [0-9,]* bytes\|exceeds[^\n]*" "$H/build-templates-base.log" | head -3 | sed 's/^/== base export: /'
git checkout -- packages/web-shell packages/sdk-typescript
git status --short | head
npm run build --workspace packages/sdk-typescript > "$H/build-sdk-pr.log" 2>&1
npm run build --workspace packages/web-shell > "$H/build-ws-pr.log" 2>&1
npm run build --workspace packages/web-templates > "$H/build-templates-pr.log" 2>&1 && echo "== PR templates build OK" || echo "== PR templates build FAILED"
grep -o "Document export renderer JS is [0-9,]* bytes\|exceeds[^\n]*" "$H/build-templates-pr.log" | head -3 | sed 's/^/== PR export: /'
echo "== rebuilt PR web-shell: $(md5sum packages/web-shell/dist/index.html) vs saved $(md5sum $H/ws-pr/index.html)"
echo BUILD-ARMS-R2-DONE
