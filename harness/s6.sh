H=/root/git/h11406
echo "### Parity with CI, and blast radius on other open PRs ###"
echo
echo "-- CI job 102182712398 (main @ 70cf363395), web-shell suite --"
grep -E "Test Files +1 failed|Tests +2 failed" $H/runs/ci-70cf3633.txt
echo "-- LOCAL full web-shell suite, same commit's App.test.tsx, this machine --"
grep -E "Test Files|Tests +[0-9]" $H/runs/full-base.log | tail -2 | sed 's/^ */ /'
echo "-- LOCAL full web-shell suite, PR #11406 head --"
grep -E "Test Files|Tests +[0-9]" $H/runs/full-prhead.log | tail -2 | sed 's/^ */ /'
echo
echo "-- Other OPEN PRs whose 'Test (ubuntu-latest, Node 22.x)' is red for THIS reason --"
cat $H/runs/blast.txt
