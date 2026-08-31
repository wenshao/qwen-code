#!/bin/bash
B=$'\033[1m'; D=$'\033[0m'; G=$'\033[32m'; R=$'\033[31m'; C=$'\033[36m'; DIM=$'\033[2m'
echo "${B}${C}PR #9924 -- mutation matrix on the changed hunk (11 mutants, SessionTest, JDK 26/release 11)${D}"
echo
printf "  %-4s %-48s %-9s %s\n" "id" "mutation applied to Session.java" "verdict" "killed by"
printf "  %-4s %-48s %-9s %s\n" "--" "--------------------------------" "-------" "---------"
row() { printf "  %-4s %-48s ${G}%-9s${D} %s\n" "$1" "$2" "KILLED" "$3"; }
row M1  "drop nested lookup (read top level only)"      "NestedError"
row M2  "drop legacy top-level fallback -> null"        "TopLevel x2"
row M3  "drop containsKey(\"subtype\") guard"             "NestedSubtypeMissing"
row M4  "log.warn -> log.info (level downgrade)"        "3 tests"
row M5  "restore base early turn abort (return true)"   "3 tests"
row M6  "delete the warning statement entirely"         "3 tests"
row M7  "\"error\".equals -> startsWith(\"error\")"         "NotExactError"
printf "  %-4s %-48s ${R}%-9s${D} %s\n" "M8" "flip precedence: top level wins over nested" "SURVIVED" "-- none --"
row M9  "skip onControlResponse consumer dispatch"      "Continues / NestedError"
row M10 "stop the read loop on ANY control_response"    "all 7 new tests"
row M11 "narrow log.warn payload to an empty string"    "3 tests"
echo
echo "  ${G}10 / 11 killed.${D}  ${R}M8 survives${D}: no fixture carries BOTH a top-level and a nested subtype,"
echo "  so the stated 'nested wins' precedence is unpinned. Low real-world impact --"
echo "  ${DIM}no CLI producer emits a top-level subtype${D} -- but one extra fixture would close it."
echo
echo "  ${B}Wire-format audit (grep over packages/*/src, non-test):${D}"
echo "  ${DIM}ControlDispatcher.sendSuccessResponse / sendErrorResponse,${D}"
echo "  ${DIM}BaseJsonOutputAdapter.emitControlResponse / emitControlError${D}"
echo "  ${G}-> all 4 producers nest subtype under 'response'; 0 emit it at top level.${D}"
