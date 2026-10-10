#!/bin/bash
# usage: probe13.sh <db> <tag> — round 4c (main 9763580b): #13822's send_message meets #13769's foreground wait
#   S13a  the parent waits on a fg child; the child messages its parent (send_message to=parent), then answers
#   S13b  the same, with the parent's fold commit of the child's answer lost with the Harness (S3's window)
DB=$1; T=$2; . /Users/wenshao/git/pr13769-rig/lib.sh
next() { node client.mjs $DB send $1 "PARENT::plain::$2::x next turn on the same parent." > /dev/null; sleep 2; echo "   next turn: $(waitterm $1 90)"; }
hlog() { grep -n "$1" runs/$DB/harness.log | tail -${2:-4} | cut -c1-300 | sed 's/^/   hlog    /'; }
mrelay() { sq "SELECT LEFT(message_id,60), IFNULL(LEFT(target_session_id,8),'-'), state, attempts, IFNULL(LEFT(last_error,140),'-') FROM qwen_managed_session_message_relay" | sed 's/^/   mrelay  /'; }
mrec() { sq "SELECT LEFT(session_id,8), domain, LEFT(record_id,70), revision FROM qwen_managed_session_extension_record WHERE domain='session_message' ORDER BY session_id, record_id" | sed 's/^/   mrec    /'; }
childcalls() { grep "\"role\":\"child\",\"child\":\"CHILD::$1::$2\"" runs/model-requests.jsonl 2>/dev/null | wc -l | tr -d ' '; }
dump() { turns $1; ledger $1; mrelay; mrec; results $1; msgs $1 400 | grep -E "CALL|RESULT|model text|user text" | cut -c1-260; modelsaw "$2" 220; }
curl -s http://127.0.0.1:$SCTL/disarm > /dev/null

echo "== S13a the parent waits on a fg child; the child sends a message to its parent, then answers (live)"
P=$(newp "PARENT::fg::${T}s13a::msg foreground child that messages its parent first."); echo "   parent $P"; T0=$(date +%s)
echo "   parent turn: $(waitterm $P 120)  (+$(( $(date +%s) - T0 )) s)"
sleep 20; dump $P "${T}s13a"
next $P ${T}s13an

echo "== S13b the same; the parent's fold commit of the child's answer is lost with the Harness (S3's window, with a message in flight)"
arm_store "marker=CHILD_RESULT::${T}s13b::after-tool%26%26functionResponse" > /dev/null
P=$(newp "PARENT::fg::${T}s13b::msg foreground child that messages its parent, fold lost."); echo "   parent $P"
for i in $(seq 240); do [ "$(heldn $SCTL ${T}s13b)" -ge 1 ] && break; sleep 0.5; done
held_store | python3 -c "import sys,json; h=json.load(sys.stdin)['held']; print('   HELD', h[-1]['at'], '|', h[-1]['snippet'][200:480].replace(chr(10),' ')) if h else print('   NOT HELD')"
echo "   before the restart:"; ledger $P; mrelay; mrec; results $P
restart; T0=$(date +%s)
echo "   interrupted turn: $(waitterm $P 180)  (+$(( $(date +%s) - T0 )) s)"
sleep 20; dump $P "${T}s13b"
hlog "message\\|send_message" 4
next $P ${T}s13bn
echo "== $(date -u +%T) probe13 DONE"
