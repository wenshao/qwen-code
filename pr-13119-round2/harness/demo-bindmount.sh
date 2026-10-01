#!/bin/bash
# Real-terminal demo for one arm (run under bwrap-private/ns.sh: private mount ns + real bwrap overlay).
# Part 1: settings.json is a single-file bind mount (rename -> EBUSY); three real `qwen sandbox` starts.
# Part 2: writer B changes the target in place between this writer's backup copy and its failed rename.
arm=$1; sha=$2; R=/root/verify/pr13119; D=$R/r2/demo-$arm
rm -rf $D; mkdir -p $D/host $D/qh $D/ws
cp $R/run/bm2/host/settings.json $D/host/settings.json; : > $D/qh/settings.json
mount --bind $D/host/settings.json $D/qh/settings.json
export HOME=$R/run/home QWEN_HOME=$D/qh QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent/s.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent/d.json QWEN_CODE_NO_RELAUNCH=1 QWEN_SANDBOX=false
unset NODE_OPTIONS HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
C='\033[1;36m'; G='\033[1;32m'; B='\033[1;31m'; Y='\033[33m'; D0='\033[2m'; N='\033[0m'
printf "${D0}# arm: $sha   QWEN_HOME=~/.qwen${N}\n"
printf "${C}\$ findmnt -n -o TARGET,FSTYPE ~/.qwen/settings.json${N}\n"
findmnt -n -o TARGET,FSTYPE $D/qh/settings.json | sed "s|$D/qh|~/.qwen|"
printf "${C}\$ grep -o '\"\\\$version\": [0-9]' ~/.qwen/settings.json${N}   ${D0}# < 4: every start tries a normalisation save${N}\n"
grep -o '"\$version": [0-9]' $D/qh/settings.json
cd $D/ws
for i in 1 2 3; do
  printf "${C}\$ qwen sandbox${N}   ${D0}# start $i${N}\n"
  node $R/$arm/dist/cli.js sandbox 2>&1 | head -1
  n=$(ls -A $D/qh | grep -c '^settings\.json\.write-')
  col=$G; [ "$n" -gt 0 ] && col=$B
  printf "${C}\$ ls -A ~/.qwen | grep settings.json.write-${N}\n"
  ls -A $D/qh | grep '^settings\.json\.write-' | sed "s/^/  /"
  printf "  ${col}→ $n private recovery dir(s)${N}\n"
done
umount $D/qh/settings.json
printf "\n${D0}# writer B rewrites the bind-mounted file in place after this writer copied its backup${N}\n"
node $R/r2/bindmount-r2.mjs $arm other-writer-module > $D/b.json 2>&1
node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const r = j.rows[0];
const C="\x1b[1;36m",G="\x1b[1;32m",Y="\x1b[33m",N="\x1b[0m";
console.log(`  fs ops: ${r.fsOps.replace(" -> writer B rewrites target in place", " ← writer B edits target")}`);
console.log("  thrown:\n" + r.thrown.replace(/^THROWN: /, "").replace(/<D>\/qh/g, "~/.qwen").replace(", rename ", ",\n  rename ").replace(". Recovery", ".\nRecovery").replace("; inspect", ";\ninspect").split("\n").map((l) => `    ${Y}${l}${N}`).join("\n"));
console.log(`  target now: ${G}${r.targetAfter}${N}`);
for (const l of j.leftovers) console.log(`  kept: ${l.dir}/${l.files.join(",")}  ${G}(= bytes before writer B)${N}`);
' $D/b.json
