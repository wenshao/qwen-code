#!/bin/bash
# A/A for the two G1 reds: same container, head (trial merge) vs main, three runs each.
R=/Users/wenshao/pr13554-rig
for i in 1 2 3; do
  $R/probe5/run-it.sh it-head m2-x5 'ManagedAgentMySqlIT#admitsHookExecutionsWithoutReadingTheirHistoryOnMySql' mariadb aa-hook-x5-$i > /dev/null
  $R/probe5/run-it.sh aa-main5 m2-main5 'ManagedAgentMySqlIT#admitsHookExecutionsWithoutReadingTheirHistoryOnMySql' mariadb aa-hook-main5-$i > /dev/null
  $R/probe5/run-it.sh it-head m2-x5 ChildWorktreeGitTest h2 aa-worktree-x5-$i > /dev/null
  $R/probe5/run-it.sh aa-main5 m2-main5 ChildWorktreeGitTest h2 aa-worktree-main5-$i > /dev/null
done
echo AA5-DONE > $R/r5/results/it/aa5.done
