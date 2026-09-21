export H=/root/git/h12374-e2e
export WT=/root/git/h12374          # PR head 81fecd5f merged into main ec109102e0 -> 5945a4a7d6
export BWT=/root/git/b12374         # pristine main ec109102e0
export MOCK_PORT=18374
export TSOCK=pr12374                # dedicated tmux socket
declare -A ARM_CLI=( [pr]=$WT/dist/cli.js [base]=$BWT/dist/cli.js [noallow]=$WT/.arm-noallow/cli.js )
