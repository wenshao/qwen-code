#!/bin/bash
# Boot a real qwen daemon over TLS with a given serving bundle and a real
# daemon-managed channel worker, so the boot-time worker TLS trust diagnostic
# runs for real; then perform the exact handshake a channel worker performs.
#
# usage: run-case.sh <dist-cli.js> <bundle.pem> <key.pem> <port> <outdir> <label>
set -uo pipefail
CLI="$1"; CERT="$2"; KEY="$3"; PORT="$4"; OUT="$5"; LABEL="$6"
GHPORT=$((PORT + 100))
SP="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
LOG="$OUT/$LABEL.daemon.log"
RUNHOME="$OUT/$LABEL.home"
WS="$OUT/$LABEL.ws"
rm -rf "$RUNHOME" "$WS"; mkdir -p "$RUNHOME/.qwen" "$WS/.qwen"

CHANNELS=$(cat <<JSON
{
  "channels": {
    "tlsfixture": {
      "type": "github",
      "token": "fixture-token",
      "baseUrl": "http://127.0.0.1:$GHPORT",
      "pollInterval": 60000,
      "senderPolicy": "allowlist",
      "allowedUsers": ["nobody"],
      "cwd": "$WS"
    }
  }
}
JSON
)
printf '%s\n' "$CHANNELS" > "$RUNHOME/.qwen/settings.json"
printf '%s\n' "$CHANNELS" > "$RUNHOME/settings.json"
printf '%s\n' "$CHANNELS" > "$WS/.qwen/settings.json"

node "$SP/fake-github.mjs" "$GHPORT" > "$OUT/$LABEL.github.log" 2>&1 &
GHPID=$!
sleep 0.5

env -u NODE_EXTRA_CA_CERTS \
  QWEN_HOME="$RUNHOME/.qwen" \
  HOME="$RUNHOME" \
  node "$CLI" serve \
    --hostname 127.0.0.1 --port "$PORT" \
    --tls-cert "$CERT" --tls-key "$KEY" \
    --channel tlsfixture --no-web \
    --workspace "$WS" \
  > "$LOG" 2>&1 &
PID=$!

# Race a worker-shape handshake against the daemon from t=0: when the serving
# bundle is broken the channel worker dies and the daemon closes the port, so
# the observation window is short. Records the first attempt that got past
# ECONNREFUSED, i.e. the first real TLS result.
(
  for _ in $(seq 1 400); do
    R=$(NODE_EXTRA_CA_CERTS="$CERT" node "$SP/probe.mjs" "https://127.0.0.1:$PORT" 3000 2>/dev/null)
    case "$R" in
      *ECONNREFUSED*|"") sleep 0.1 ;;
      *) printf '%s\n' "$R" > "$OUT/$LABEL.race.json"; exit 0 ;;
    esac
  done
) &
RACEPID=$!

for _ in $(seq 1 120); do
  grep -qE "channel worker|Channel worker|worker TLS|tls-cert|startup failed" "$LOG" 2>/dev/null && break
  kill -0 $PID 2>/dev/null || break
  sleep 0.5
done
sleep 3

echo "### [$LABEL] daemon boot log (stderr) ###"
cat "$LOG"
echo
echo "### [$LABEL] real worker-shape handshake, NODE_EXTRA_CA_CERTS = the exact bundle workers receive ###"
cat "$OUT/$LABEL.race.json" 2>/dev/null || echo '{"note":"no TLS result captured"}'
echo

kill $PID $GHPID $RACEPID 2>/dev/null
for _ in $(seq 1 20); do kill -0 $PID 2>/dev/null || break; sleep 0.25; done
kill -9 $PID $GHPID $RACEPID 2>/dev/null
true
