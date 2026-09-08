cd /root/git/pr11406
git checkout HEAD -- packages/web-shell/client/App.test.tsx packages/web-shell/client/App.tsx
echo "### ARM B - PR #11406 head (daf3d6d97d) ###"
echo "$ git status --porcelain   # tree is exactly the PR head"
git status --porcelain; echo "(clean)"
cd packages/web-shell
echo
echo "$ npx vitest run --config vitest.config.ts App.test.tsx -t 'does not rerender App for other split sessions'"
npx vitest run --config vitest.config.ts App.test.tsx -t "does not rerender App for other split sessions" 2>&1 | tail -8
echo
echo "$ npx vitest run --config vitest.config.ts        # whole web-shell suite, as CI runs it"
npx vitest run --config vitest.config.ts 2>&1 | grep -E "Test Files|Tests +[0-9]|Start at|Duration" | tail -4
