#!/bin/bash
B=$'\033[1m'; D=$'\033[0m'; G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; C=$'\033[36m'; DIM=$'\033[2m'; M=$'\033[35m'
echo "${B}${C}PR #9924 -- test discrimination (revert-hunk A/B, macOS / Zulu JDK 26, release 11)${D}"
echo
echo "${B}A. PR head (main 442951afee + PR) -- mvn --batch-mode clean test${D}"
echo "  ${G}[WARNING] Tests run: 141, Failures: 0, Errors: 0, Skipped: 5${D}"
echo "  ${G}[INFO] BUILD SUCCESS${D}   ${DIM}(SessionTest: 13 tests, 6 pre-existing + 7 new)${D}"
echo "  ${G}mvn checkstyle:check -> You have 0 Checkstyle violations.${D}"
echo
echo "${B}B. Revert-hunk: PR's SessionTest.java + base Session.java (production hunk reverted)${D}"
echo "  ${R}[ERROR] Tests run: 13, Failures: 3, Errors: 0, Skipped: 0${D}"
echo "  ${R}  SessionTest.sendPromptDrainsTurnWhenControlResponseSubtypeIsNestedError:297${D}"
echo "  ${R}      expected: <true> but was: <false>${D}   ${DIM}(nested error never warned)${D}"
echo "  ${R}  SessionTest.sendPromptUsesTopLevelSubtypeWhenNestedSubtypeIsMissing:317${D}"
echo "  ${R}      expected: <2> but was: <1>${D}          ${DIM}(base aborted the turn early)${D}"
echo "  ${R}  SessionTest.sendPromptUsesTopLevelSubtypeWhenResponseObjectIsMissing:339${D}"
echo "  ${R}      expected: <2> but was: <1>${D}          ${DIM}(base aborted the turn early)${D}"
echo "  ${R}[INFO] BUILD FAILURE${D}"
echo
echo "${B}C. Which of the 7 new tests actually discriminate base vs head${D}"
printf "  ${G}%-58s  FAILS on base${D}\n" "sendPromptDrainsTurnWhenControlResponseSubtypeIsNestedError"
printf "  ${G}%-58s  FAILS on base${D}\n" "sendPromptUsesTopLevelSubtypeWhenNestedSubtypeIsMissing"
printf "  ${G}%-58s  FAILS on base${D}\n" "sendPromptUsesTopLevelSubtypeWhenResponseObjectIsMissing"
printf "  ${M}%-58s${D}${DIM} passes on base too (pin only)${D}\n" "sendPromptContinuesAfterNestedControlResponseSuccess"
printf "  ${M}%-58s${D}${DIM} passes on base too (pin only)${D}\n" "sendPromptDoesNotWarnWhenControlResponseSubtypeIsNotExactError"
printf "  ${M}%-58s${D}${DIM} passes on base too (pin only)${D}\n" "sendPromptDoesNotWarnWhenControlResponseSubtypeIsProgress"
printf "  ${M}%-58s${D}${DIM} passes on base too (pin only)${D}\n" "sendPromptDoesNotWarnWhenControlResponseSubtypeIsMissing"
echo "  ${DIM}the 4 'passes on base' tests are boundary pins, not regression proofs --${D}"
echo "  ${DIM}they earn their keep in the mutation matrix instead (M7 / M9).${D}"
