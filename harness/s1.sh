cd /root/git/pr11406
git checkout HEAD -- packages/web-shell/client/App.test.tsx packages/web-shell/client/App.tsx
echo "$ git log --oneline -1 HEAD          # PR #11406 head"
git log --oneline -1 HEAD
echo
echo "### ARM A — BASE (main @ 70cf363395, the commit issue #11404 reports) ###"
echo "$ git checkout 70cf363395 -- packages/web-shell/client/App.test.tsx"
git checkout 70cf363395 -- packages/web-shell/client/App.test.tsx
cd packages/web-shell
echo "$ npx vitest run --config vitest.config.ts App.test.tsx -t 'does not rerender App for other split sessions'"
npx vitest run --config vitest.config.ts App.test.tsx -t "does not rerender App for other split sessions" 2>&1 | tail -22
cd /root/git/pr11406 && git checkout HEAD -- packages/web-shell/client/App.test.tsx
