#!/bin/bash
# usage: DB=.. ST=.. TAG=.. RUNS=.. mk.sh   (prints the session id on the last line)
R=$(cd $(dirname $0); pwd)
export BROKER_TOKEN=hosted-tools-broker-token JSON_TIMEOUT=900000
cd $R && ~/git/qwen-code-pr13087/node_modules/.bin/tsx mk.ts 2>&1 | grep -E "^\[(create|turn|turns|detach|catalog|delete|retention)" | cut -c1-400
node -e "console.log(require('$R/out/mk-'+process.env.TAG+'.json').sessionId)"
