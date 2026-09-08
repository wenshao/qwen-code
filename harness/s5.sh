cd /root/git/pr11406
echo "### Why the broken reference reached main — and why no static gate caught it ###"
echo
echo "1) The PR branch of #11250 was GREEN and CORRECT: the mock existed there under its old name"
echo "\$ git cat-file -p 52484fecf3:packages/web-shell/client/App.test.tsx | grep -n 'mockUseDaemonActivePromptBridge' | head -4"
git cat-file -p 52484fecf3:packages/web-shell/client/App.test.tsx | grep -n "mockUseDaemonActivePromptBridge" | head -4
echo
echo "2) 51 min after that branch head was cut, #11267 renamed the hook + mock ON MAIN (UTC):"
TZ=UTC git log -1 --format="   %h  %ad  %s" --date=format-local:'%Y-%m-%d %H:%MZ' 52484fecf3
TZ=UTC git log -1 --format="   %h  %ad  %s" --date=format-local:'%Y-%m-%d %H:%MZ' 6b7e5615c7
TZ=UTC git log -1 --format="   %h  %ad  %s" --date=format-local:'%Y-%m-%d %H:%MZ' 70cf363395
echo
echo "3) The squash merge kept main's renames AND #11250's 3 new lines -> 3 dangling references"
echo "\$ git cat-file -p 70cf363395:.../App.test.tsx | grep -c 'mockUseDaemonActivePromptBridge'   # declarations + uses"
git cat-file -p 70cf363395:packages/web-shell/client/App.test.tsx | grep -n "mockUseDaemonActivePromptBridge"
echo
echo "4) No static gate can see it: web-shell's tsconfig EXCLUDES test files"
echo "\$ python3 -c \"import json;print(json.load(open('packages/web-shell/tsconfig.json'))['exclude'])\""
python3 -c "import json;print(json.load(open('packages/web-shell/tsconfig.json'))['exclude'])"
echo
echo "\$ git checkout 70cf363395 -- packages/web-shell/client/App.test.tsx   # put the broken file back"
git checkout 70cf363395 -- packages/web-shell/client/App.test.tsx
echo "\$ (cd packages/web-shell && npx tsc -p tsconfig.json --noEmit); echo \"tsc exit=\$?\""
(cd packages/web-shell && npx tsc -p tsconfig.json --noEmit); echo "tsc exit=$?  (clean - file not in the program)"
echo "\$ npx eslint packages/web-shell/client/App.test.tsx; echo \"eslint exit=\$?\""
npx eslint packages/web-shell/client/App.test.tsx; echo "eslint exit=$?  (clean - no no-undef rule for TS)"
git checkout HEAD -- packages/web-shell/client/App.test.tsx
