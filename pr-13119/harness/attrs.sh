#!/bin/bash
# Real CLI save (/language ui en) on files with non-default attributes, both arms.
source /root/verify/pr13119/harness/env.sh
for arm in base head; do
  D=/root/verify/pr13119/run/attrs-$arm; rm -rf $D; mkdir -p $D/qh $D/dotfiles $D/ws
  export QWEN_HOME=$D/qh
  # case 1: 0600 file
  cp /root/verify/pr13119/run/settings.initial.json $D/qh/settings.json; chmod 600 $D/qh/settings.json
  (cd $D/ws && /root/verify/pr13119/bwrap-private/ns.sh node /root/verify/pr13119/$arm/dist/cli.js --auth-type openai --openai-api-key dummy --openai-base-url http://127.0.0.1:18719/v1 --model dummy -p "/language ui en" >/dev/null 2>&1)
  echo "$arm mode 0600 -> $(stat -c '%a' $D/qh/settings.json)  lang=$(grep -o '"language": "[a-z]*"' $D/qh/settings.json)"
  # case 2: settings.json is a symlink into a dotfiles dir
  rm $D/qh/settings.json; cp /root/verify/pr13119/run/settings.initial.json $D/dotfiles/settings.json; ln -s $D/dotfiles/settings.json $D/qh/settings.json
  (cd $D/ws && /root/verify/pr13119/bwrap-private/ns.sh node /root/verify/pr13119/$arm/dist/cli.js --auth-type openai --openai-api-key dummy --openai-base-url http://127.0.0.1:18719/v1 --model dummy -p "/language ui en" >/dev/null 2>&1)
  if [ -L $D/qh/settings.json ]; then kind=symlink; else kind="regular file"; fi
  echo "$arm symlink -> link is now: $kind; dotfiles copy has language: $(grep -c '"language"' $D/dotfiles/settings.json)"
  ls $D/qh | grep settings | tr '\n' ' '; echo
done
