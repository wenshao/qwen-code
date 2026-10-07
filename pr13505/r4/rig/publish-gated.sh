#!/bin/bash
# VERIFICATION RIG ONLY (PR #13505): publish only if nothing new appeared on the PR since the snapshot.
set -u
R=/Users/wenshao/git/pr13505-rig; EXPECT_HEAD=$1; BODY=$2
H=$(gh pr view 13505 --repo QwenLM/qwen-code --json headRefOid,state --jq '"\(.state) \(.headRefOid)"')
[ "$H" = "OPEN $EXPECT_HEAD" ] || { echo "ABORT: head/state changed: $H"; exit 1; }
gh api repos/QwenLM/qwen-code/issues/13505/comments --paginate --jq '.[] | "\(.id)\t\(.user.login)\t\(.created_at)\t\(.body[0:100] | gsub("\n";" "))"' > $R/now-comments.tsv
gh api repos/QwenLM/qwen-code/pulls/13505/reviews --paginate --jq '.[] | "\(.id)\t\(.user.login)\t\(.state)\t\(.commit_id[0:10])\t\(.submitted_at)"' > $R/now-reviews.tsv
NC=$(comm -13 <(cut -f1 $R/snap-comments.tsv | sort) <(cut -f1 $R/now-comments.tsv | sort))
NR=$(comm -13 <(cut -f1 $R/snap-reviews.tsv | sort) <(cut -f1 $R/now-reviews.tsv | sort))
if [ -n "$NC$NR" ]; then echo "ABORT: new activity since snapshot"; for i in $NC; do grep "^$i" $R/now-comments.tsv; done; for i in $NR; do grep "^$i" $R/now-reviews.tsv; done; exit 2; fi
grep -qiE "claude|anthropic|generated with" "$BODY" && { echo "ABORT: attribution text"; exit 3; }
gh pr comment 13505 --repo QwenLM/qwen-code --body-file "$BODY"
