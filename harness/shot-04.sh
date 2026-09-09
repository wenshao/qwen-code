echo "### 10-arm matrix -- every arm is a real vitest run in the PR worktree /root/git/pr11412"
echo "###   base = 1f890086f1 (nightly tree)   pr = 34e6ea308b (#11412)   main = 3a75f37ef5 (has #11406)"
echo
python3 /root/git/h11412/harness/fmt-matrix.py
echo
echo "Arms 4 vs 5 are the finding: with rerender() deleted, #11412's version still"
echo "passes one variant (positive guard satisfied by stale setup-time calls);"
echo "main's version goes red on the POSITIVE guard in both variants."
