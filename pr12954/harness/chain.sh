#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/5f811a9d-a146-46e4-8a2e-161614683807/scratchpad
for m in "$@"; do $SP/rig/mutate.sh $m mysql; done
echo CHAIN_DONE
