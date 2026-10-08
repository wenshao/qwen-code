#!/bin/bash
# usage: adapter.sh start <db> [direct]   |  adapter.sh stop|kill <db>
# Runs `qwen channel managed-email rigmail` from the arm's dist/cli.js with
# NODE_EXTRA_CA_CERTS=<rig CA>; the control plane is reached through the
# fault proxy (35724) unless "direct".
RIG=/Users/wenshao/git/pr13572-rig; DB=$2; D=$RIG/runs/$DB; mkdir -p "$D/adapter-home/.qwen" "$D/adapter-cwd"
CLI=${ADAPTER_CLI:-$(node -e "console.log(require('$D/state.json').cli)")}
case "$1" in
start)
  CP=http://127.0.0.1:35724; [ "$3" = direct ] && CP=http://127.0.0.1:35723
  [ -f "$D/adapter-home/.qwen/settings.json" ] || cat > "$D/adapter-home/.qwen/settings.json" <<JSON
{ "channels": { "rigmail": {
  "type": "email", "address": "agent@rig.test",
  "imapHost": "127.0.0.1", "imapPort": 35727, "imapUser": "agent", "imapPassword": "agentpw", "imapSecure": true,
  "smtpHost": "127.0.0.1", "smtpPort": 35728, "smtpUser": "agent", "smtpPassword": "agentpw", "smtpSecure": true,
  "pollInterval": ${RIG_POLL:-3000}, "senderPolicy": "allowlist", "allowedUsers": ["alice@rig.test", "bob@rig.test"]
} } }
JSON
  cd "$D/adapter-cwd"
  env -i PATH="$PATH" HOME="$D/adapter-home" QWEN_HOME="$D/adapter-home/.qwen" TZ=UTC NO_PROXY='*' \
    NODE_EXTRA_CA_CERTS=$RIG/mail/tls/ca.pem \
    nohup node "$CLI" channel managed-email rigmail --control-plane "$CP" --tenant rig --actor rig-actor \
      --workspace rig-ws --cwd "$D/adapter-cwd" >> "$D/adapter.log" 2>&1 &
  echo $! > "$D/adapter.pid"; echo "adapter pid $(cat $D/adapter.pid) cp=$CP cli=$CLI";;
stop) kill -TERM "$(cat $D/adapter.pid)" && echo "TERM $(cat $D/adapter.pid)";;
kill) kill -KILL "$(cat $D/adapter.pid)" && echo "KILL $(cat $D/adapter.pid)";;
esac
