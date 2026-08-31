#!/bin/bash
B=$'\033[1m'; D=$'\033[0m'; G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; C=$'\033[36m'; DIM=$'\033[2m'
echo "${B}${C}PR #9924 -- real-stack A/B: bundled qwen CLI 0.22.3 <-> Java SDK ProcessTransport${D}"
echo "${DIM}rig: real dist/cli.js (sha256 65f2d08b...) + repo fake-openai provider + isolated HOME${D}"
echo "${DIM}trigger: session.setModel(\"\") through the SDK public API while a prompt turn is in flight${D}"
echo
echo "${B}[1] What the real CLI actually put on the wire${D}"
echo "  ${Y}RECV${D} {\"type\":\"control_response\",\"response\":{\"subtype\":\"error\","
echo "         \"request_id\":\"183a5f77-...\",\"error\":\"Invalid model specified for set_model request\"}}"
echo "  ${DIM}-> subtype lives under response.subtype; there is NO top-level subtype key${D}"
echo
echo "${B}[2] Same wire bytes, two SDK builds${D}"
printf "  %-42s %s\n" "variant" "controlResp / assistant / result / WARN logged"
printf "  %-42s %s\n" "-------" "----------------------------------------------"
printf "  %-42s ${R}%s${D}\n" "base  (origin/main 442951afee)" "1 / 1 / 1 / false   <- error is silent"
printf "  %-42s ${G}%s${D}\n" "head  (main + PR 9924)" "1 / 1 / 1 / true    <- WARN carries the reason"
echo
echo "  ${G}head WARN line:${D}"
echo "  ${DIM}01:25:45 [pool-5] ${D}${Y}WARN${D}${DIM} c.a.q.c.cli.session.Session -- control_response error:${D}"
echo "  ${DIM}  {\"type\":\"control_response\",\"response\":{\"subtype\":\"error\",...,${D}"
echo "  ${DIM}   \"error\":\"Invalid model specified for set_model request\"}}${D}"
echo "  ${R}base: no WARN, no INFO -- nothing is logged at all${D}"
echo
echo "${B}[3] Why the log matters: the typed model drops the error text${D}"
echo "  CONSUMER typedSubtype=error typedRequestId=183a5f77-... typedPayload=null"
echo "  CONSUMER reserialized={\"type\":\"control_response\",\"response\":{\"request_id\":\"183a5f77-...\",\"subtype\":\"error\"}}"
echo "  ${DIM}CLIControlResponse.Response has no 'error' field -> the raw-JSON warn is the${D}"
echo "  ${DIM}only place the CLI's error message reaches a Java SDK operator.${D}"
echo
echo "${B}[4] No regression: both builds drain the turn to 'result'${D}"
echo "  ${G}base turnMs=12280  head turnMs=12257   assistant=1 result=1 in both${D}"
