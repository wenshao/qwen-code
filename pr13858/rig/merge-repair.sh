#!/bin/bash
# Repair the merge damage on the PR branch (r8 @ 1a14e3b37d) without rebasing:
git cherry-pick e9582993bf 713e7328b5   # re-apply #13179 and #13332 (both apply cleanly)
git merge origin/main                    # 0 conflicts at main 6936c77e60 and 6603f1f5d7
git diff --stat origin/main HEAD | tail -1   # expect 40 files, +3798/-318 (the PR's own scope)
