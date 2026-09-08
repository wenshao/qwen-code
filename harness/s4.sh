cd /root/git/pr11406
echo "### Spy call-count census: how many renders does the guard actually measure? ###"
for v in c1 head; do
  git checkout HEAD -- packages/web-shell/client/App.test.tsx
  python3 /root/git/h11406/census.py $v >/dev/null
  case $v in
    c1)   echo; echo "--- commit 1 only (2f693f42f6): no clear before rerender() ---";;
    head) echo; echo "--- PR head (daf3d6d97d): mockClear() added before rerender() ---";;
  esac
  (cd packages/web-shell && npx vitest run --config vitest.config.ts App.test.tsx \
     -t "does not rerender App for other split sessions" 2>&1 \
     | grep -E "census|Tests +[0-9]" | sed 's/^ *//')
done
git checkout HEAD -- packages/web-shell/client/App.test.tsx
