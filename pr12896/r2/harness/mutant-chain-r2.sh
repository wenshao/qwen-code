#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/5b0e58b6-6b84-4099-862a-65878f027ec4/scratchpad
M=$SP/rig/mutate-r2.sh
$M T503 worker-kill,worker-stop,spring-kill
$M T200 worker-kill,spring-kill
$M A1 spring-kill,harness-prepare
$M H1 worker-kill,worker-stop,spring-kill
$M H2 worker-kill,worker-stop,spring-kill
$M H3 harness-result
$M J1 worker-kill,worker-stop
$M J3 worker-kill,worker-stop
echo CHAIN_R2_DONE
