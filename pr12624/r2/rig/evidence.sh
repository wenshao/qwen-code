#!/bin/bash
B=$'\033[1m'; G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; D=$'\033[2m'; N=$'\033[0m'
echo "${B}PR #12624 round 2 · head 6a0fa0b vs base 688e8af (main at the merged commit)${N}"
echo "${D}probe inside LlmChat.seedResumeTokenCounts of the real HEAD dist bundle; real TUI; fake OpenAI with cached_tokens${N}"
echo
echo "${B}Path 1: live session A (cached 64653) -> /resume <session B> in the same process${N}"
echo "  per-chat cached   before=0      after=0"
echo "  global mirror     before: prompt=12000 cached=${R}64653${N}   after: prompt=12000 cached=${G}0${N}"
echo "  ${D}round 1 (ef5108b) after: cached=64653 -> fixed by cf1ba16${N}"
echo
echo "${B}Path 2: fresh process  qwen --resume <session A>${N}"
echo "  per-chat cached   before=0 after=0      global cached before=0 after=0"
echo
echo "${B}/context box text, base vs head${N}"
echo "  live A turn / in-process /resume B / fresh --resume A:  ${G}identical x3${N}"
echo
echo "${B}Unit tests (HEAD 6a0fa0b)${N}"
echo "  llm-chat.test.ts 533/533 ${G}pass${N}; contextCommand.test.ts 49/49 ${G}pass${N}; eslint + prettier clean"
echo "  M0 drop both new lines          -> ${R}killed${N} (spy last call != 0, :22296)"
echo "  M1 drop per-chat reset only     -> ${R}killed${N} (expected 64653 to be +0, :22298)"
echo "  M2 drop mirror write only       -> ${R}killed${N} (spy last call != 0, :22296)"
echo "  M3 mirror writes 1 instead of 0 -> ${R}killed${N}"
echo "  ${B}4/4 mutants killed${N}"
