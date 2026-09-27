# Arm name -> CLI bundle and extra env for run-cli.ts.
BASE=/Users/wenshao/git/qwen-11959-base/dist/cli.js
R1=/Users/wenshao/git/qwen-11959/dist/cli.js
R2=/Users/wenshao/git/qwen-11959-r2/dist/cli.js
CAND=/Users/wenshao/git/qwen-11959-cand/dist/cli.js
arm_cli() { case $1 in base) echo $BASE;; pr|r1) echo $R1;; r2|r2-off) echo $R2;; cand) echo $CAND;; off) echo $R1;; esac; }
arm_extra() { case $1 in off|r2-off) echo "--env QWEN_CODE_MODELS_DEV=off";; *) echo "";; esac; }
