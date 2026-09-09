cd /root/git/pr11412
T=packages/web-shell/client/App.test.tsx
git checkout 1f890086f1a41e4de7965c44281116fd65b695d8 -- $T; git reset -q HEAD -- $T
echo "### Tree = 1f890086f1  (the exact nightly v0.23.1-nightly.20260908.1f890086f1 tree)"
echo
cd packages/web-shell
NO_COLOR=true npx vitest run client/App.test.tsx -t "does not rerender App for other split sessions" --reporter=basic 2>&1 \
  | grep -vE "^\s*$" | grep -E "FAIL|ReferenceError|App\.test\.tsx:2893|Test Files|Tests  |Failed Tests" | head -14
cd /root/git/pr11412; git checkout HEAD -- $T; git reset -q HEAD -- $T
echo
echo "matches nightly job 102243304038: 'Tests  2 failed | 3018 passed' + the same ReferenceError"
