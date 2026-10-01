#!/bin/sh
# Candidate: a bridge that cannot be resolved is treated as absent (host-backed stdin then fails closed with exit 125).
set -e
rm -rf /opt/head-cand && cp -a /opt/head-rel /opt/head-cand
P=/opt/head-cand/lib/node_modules/@qwen-code/qwen-code
f=$(grep -l "function resolveStdinBridge" $P/chunks/*.js)
node -e '
const fs=require("fs");const f=process.argv[1];const s=fs.readFileSync(f,"utf8");
const a="return void 0;return resolveLandlockRunner()}";
const b="return void 0;try{return resolveLandlockRunner()}catch{return void 0}}";
if(s.split(a).length!==2)throw new Error("anchor count "+(s.split(a).length-1));
fs.writeFileSync(f,s.replace(a,b));console.log("patched",f);' "$f"
stat -c "%U %a %n" $P/vendor/landlock-run/arm64-linux/qwen-landlock-run
