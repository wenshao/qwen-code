#!/bin/bash
# Terminal evidence for S1: the same seeded debug dir after the first housekeeping pass.
H=/root/git/h12374-e2e
for arm in base pr; do
  label=$([ $arm = base ] && echo "main ec109102e0 (base)" || echo "PR 81fecd5f merged into main")
  printf '\e[1;36m$ ls -la runtime/debug   # %s, TUI --session-id 7777…, 62 s after launch\e[0m\n' "$label"
  (cd $H/sc/s1-$arm/runtime/debug && ls -la --time-style=+%F . | tail -n +4 | sed -E 's/^([^ ]+ +[0-9]+ +root +root)//; s#/root/git/h12374-e2e/sc/s1-(pr|base)/#<scenario>/#' )
  printf '\e[2m$ ls -a home | grep debug-logs →\e[0m %s\n\n' "$(ls -a $H/sc/s1-$arm/home | grep debug-logs || echo '(no marker)')"
done
printf '\e[1;36m$ cat outside/victim.txt   # target of the 6666….txt symlink\e[0m\n'; cat $H/sc/s1-pr/outside/victim.txt
