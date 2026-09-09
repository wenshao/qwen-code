echo "### Full web-shell suite (npx vitest run --config vitest.config.ts), same worktree, 3 trees"
echo
cat /root/git/h11412/logs/full-suite.txt
echo
echo "base reproduces the nightly EXACTLY and the two ReferenceError cases are the ONLY"
echo "failures in 6712 tests -- so this fix is the complete remedy for the red, not a partial one."
