# Arm name -> CLI bundle and extra env for run-cli.ts.
BASE=/Users/wenshao/git/qwen-11959-base/dist/cli.js      # merge-base 1dbb3786 (rounds 1-2)
BASE3=/Users/wenshao/git/qwen-11959-base3/dist/cli.js    # merge-base 700620f4 (round 3)
R1=/Users/wenshao/git/qwen-11959/dist/cli.js             # f5ba51ff
R2=/Users/wenshao/git/qwen-11959-r2/dist/cli.js          # 9088f00b
R3=/Users/wenshao/git/qwen-11959-r3/dist/cli.js          # 1bb0e56e
CAND=/Users/wenshao/git/qwen-11959-cand/dist/cli.js
arm_cli() { case $1 in base) echo $BASE;; base3) echo $BASE3;; pr|r1|off) echo $R1;; r2|r2-off) echo $R2;; r3|r3-off) echo $R3;; cand) echo $CAND;; esac; }
arm_extra() { case $1 in off|r2-off|r3-off) echo "--env QWEN_CODE_MODELS_DEV=off";; *) echo "";; esac; }
