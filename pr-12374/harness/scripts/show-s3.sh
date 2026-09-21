#!/bin/bash
H=/root/git/h12374-e2e; C='\e[1;36m'; D='\e[2m'; N='\e[0m'
printf "${C}# source: this box's real ~/.qwen/debug (read-only; cp -a into two isolated runtime dirs)${N}\n"
printf '$ ls ~/.qwen/debug | wc -l ; du -sh ~/.qwen/debug\n'; ls ~/.qwen/debug | wc -l; du -sh ~/.qwen/debug | cut -f1
printf '$ find ~/.qwen/debug -maxdepth 1 -name "*.txt" -mtime -30 | wc -l   # files newer than the 30-day cutoff\n'; find ~/.qwen/debug -maxdepth 1 -name '*.txt' -mtime -30 | wc -l
for arm in base pr; do
  label=$([ $arm = base ] && echo "main ec109102e0 (base)" || echo "PR 81fecd5f merged into main")
  L=$(ls -t $H/sc/s3-$arm/runtime/debug/*.txt | head -1)
  printf "\n${C}# %s — interactive TUI with QWEN_DEBUG_LOG_FILE=1, left idle${N}\n" "$label"
  printf '$ grep HOUSEKEEPING <live session log>\n'; grep -h HOUSEKEEPING $L | sed -E 's/^2026-09-21T//'
  printf '$ ls runtime/debug | wc -l ; du -sh runtime/debug\n'; ls $H/sc/s3-$arm/runtime/debug | wc -l; du -sh $H/sc/s3-$arm/runtime/debug | cut -f1
done
printf '\n$ ls -la runtime/debug   # PR arm, what is left\n'
(cd $H/sc/s3-pr/runtime/debug && ls -la --time-style=+%F . | tail -n +4 | sed -E 's/^([^ ]+ +[0-9]+ +root +root)//')
