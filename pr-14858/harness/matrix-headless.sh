#!/bin/bash
# usage: matrix-headless.sh <arm>
A=$1; H=/root/verify/pr14858/harness/run-headless.sh
$H $A explicit explicit '{"maxToolCallsPerTurn":3}'
$H $A stuck stuck '{}'
$H $A backstop backstop '{}'
$H $A repeated repeated '{"skipLoopDetection":false}'
$H $A replay replay '{}'
$H $A consecutive consecutive '{}'
$H $A explicit explicit-json '{"maxToolCallsPerTurn":3}' --output-format json
$H $A explicit explicit-streamjson '{"maxToolCallsPerTurn":3}' --output-format stream-json
# follow the printed advice
$H $A explicit advice-explicit-0 '{"maxToolCallsPerTurn":0}'
$H $A stuck advice-stuck-0 '{"maxToolCallsPerTurn":0}'
$H $A backstop advice-backstop-0 '{"maxToolCallsPerTurn":0}'
$H $A repeated advice-repeated-skip '{"skipLoopDetection":true}'
$H $A stuck advice-stuck-explicit200 '{"maxToolCallsPerTurn":200}'
echo MATRIX_DONE
