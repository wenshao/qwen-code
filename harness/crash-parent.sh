#!/bin/bash
SP=/tmp/claude-0/-root-git-qwen-code-x9/fec618ae-ad40-47d0-81de-ee1d8280172b/scratchpad
for arm in wt-revert wt-pr; do
  label=$([ "$arm" = wt-revert ] && echo "BASE (fix reverted)" || echo "PR  #10223")
  HOME_DIR=$(mktemp -d /tmp/crash-$arm-XXXX)
  echo "──────── $label ────────"
  node $SP/crash-child.mjs $SP/pr10223/$arm $HOME_DIR
  echo "   child exit: $? (137 = SIGKILL, i.e. crashed)"
  echo "   post-crash config.json read by a FRESH process:"
  node -e "const f=require('fs');const j=JSON.parse(f.readFileSync('$HOME_DIR/teams/crash-team/config.json','utf8'));console.log('     members =',JSON.stringify(j.members.map(m=>m.name)))"
  echo
done
