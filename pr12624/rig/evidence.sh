#!/bin/bash
B=$'\033[1m'; G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; D=$'\033[2m'; N=$'\033[0m'
echo "${B}PR #12624 · runtime probe inside LlmChat.seedResumeTokenCounts (real dist bundle, real TUI)${N}"
echo "${D}values read at entry (before) and right after the method body (after); fake OpenAI reports cached_tokens${N}"
echo
echo "${B}Path 1: live session A (cached 64653) -> /resume <session B> in the same process${N}"
echo "  PR head    per-chat cached  before=${Y}0${N}      after=0         ${D}<- added line writes 0 over 0${N}"
echo "  PR head    global mirror    prompt=12000  cached=${R}64653${N}  ${D}<- B's prompt paired with A's cached${N}"
echo "  candidate  global mirror    prompt=12000  cached=${G}0${N}      ${D}<- + telemetryService?.setLastCachedContentTokenCount(0)${N}"
echo
echo "${B}Path 2: fresh process  qwen --resume <session A>${N}"
echo "  PR head    per-chat cached  before=${Y}0${N}      after=0         global cached=0"
echo
echo "${B}/context box text, base vs head${N}"
echo "  after in-process /resume B:  ${G}identical${N}  (Used 12.0k, no Cached prefix row)"
echo "  session A live turn:         ${G}identical${N}  (Used 65.3k, Cached prefix 64.7k)"
echo "  fresh --resume A:            Used 65.3k, ${Y}no Cached prefix row${N} though transcript has 64653 (R1-2)"
echo
echo "${B}Unit tests (PR head)${N}"
echo "  llm-chat.test.ts 530/530 ${G}pass${N}; contextCommand.test.ts 49/49 ${G}pass${N}"
echo "  remove the added line   -> ${R}1 failed${N}: expected 64653 to be +0 (llm-chat.test.ts:22223)"
echo "  fallback '?? global'->0 -> ${R}1 failed${N}: expected +0 to be 1000 (new no-chat case)"
echo "  new contextCommand case on base code -> 49/49 pass (pins existing behaviour)"
