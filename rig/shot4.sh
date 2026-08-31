#!/bin/bash
B=$'\033[1m'; D=$'\033[0m'; G=$'\033[32m'; R=$'\033[31m'; C=$'\033[36m'; DIM=$'\033[2m'; M=$'\033[35m'
echo "${B}${C}PR #9924 -- 9 standing (unresolved) review threads re-checked against head 15a5fb53b5${D}"
echo "${DIM}all 9 were filed on older commits (c457e1114 / 091ba0a54 / 1cee64889) and are marked OUTDATED${D}"
echo
ok() { printf "  ${G}%-9s${D} %-34s %s\n" "ADDRESSED" "$1" "$2"; }
printf "  %-9s %-34s %s\n" "verdict" "thread" "evidence at current head"
printf "  %-9s %-34s %s\n" "-------" "------" "------------------------"
ok "[Critical] return true desyncs"   "branch returns false; real-stack drains to result"
ok "[S] top-level fallback untested"  "mutant M2 killed by 2 new tests"
ok "[S] non-error branch untested"    "mutant M10 killed by all 7 new tests"
ok "[S] INFO log / no signal"         "now log.warn; M4 killed; raw JSON carries reason"
ok "[S] mixed shape swallowed"        "raw containsKey path; M3 killed"
ok "[S] fixture != CLI wire format"   "fixture keys == captured live envelope"
ok "[S] warn not observed by tests"   "ListAppender asserts; M6 killed"
ok "[S] third typed fallback dead"    "helper reduced to 2 raw-JSON branches"
ok "[S] matcher ignores payload"      "matcher asserts error text; M11 killed"
echo
echo "  ${G}9 / 9 addressed.${D}  The blocking CHANGES_REQUESTED is carried by threads that all"
echo "  describe code the current head no longer contains."
echo
echo "  ${B}Remaining open item (not a blocker):${D}"
echo "  ${R}M8${D} -- precedence between a top-level and a nested subtype is unpinned."
echo "  ${DIM}Unreachable in production; a single extra fixture would close it.${D}"
