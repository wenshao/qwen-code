D=/root/verify/pr13119/run/bm2
source /root/verify/pr13119/harness/env.sh
export QWEN_HOME=$D/qh
mount --bind $D/host/settings.json $D/qh/settings.json
for arm in ${ARMS:-base head}; do
  for i in 1 2 3; do (cd $D/ws && node /root/verify/pr13119/$arm/dist/cli.js sandbox 2>&1 | grep -v "^Model\|^Host\|^Filesystem\|^Command" | head -3 | sed "s/^/  [$arm startup $i] /"); done
  echo "$arm after 3 startups: leftovers in QWEN_HOME: $(ls -A $D/qh | grep '^settings.json.' | wc -l); target \$version: $(grep -o '"\$version": [0-9]' $D/qh/settings.json)"
  for x in $D/qh/settings.json.*; do [ -e "$x" ] && rm -rf "$x"; done
done
