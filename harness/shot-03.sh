cd /root/git/pr11412
T=packages/web-shell/client/App.test.tsx
run() { ( cd packages/web-shell && NO_COLOR=true npx vitest run client/App.test.tsx \
   -t "does not rerender App for other split sessions" --reporter=basic 2>&1 ) \
   | grep -E "Test Files|Tests  " | sed 's/^/    /'; }
echo "### A) PR #11412 head 34e6ea308b"
run
echo
echo "### B) current main 3a75f37ef5 (already fixed by #11406)"
git checkout origin/main -- $T; git reset -q HEAD -- $T
run
git checkout HEAD -- $T; git reset -q HEAD -- $T
echo
echo "Both green. The PR's own fix works -- and main already has it."
