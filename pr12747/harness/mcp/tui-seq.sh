#!/bin/bash
# tui-seq.sh <session> <root>: invalid call; /mcp Disable+Enable (rediscovery); invalid call x2; valid call.
S=$1; R=$2; H=$(cd "$(dirname "$0")" && pwd); tk() { $H/tk.sh $S "$@"; }
waitmcp() { for i in $(seq 1 60); do [ $(grep -c "$1" $R/mcp.log) -ge $2 ] && return; sleep 0.5; done; echo "timeout $1"; }
send() { local n=$(grep -c '"event":"emitToolCall"' $R/fake.log); tk type "$1"; sleep 0.4; tk key Enter; for i in $(seq 1 60); do [ $(grep -c '"event":"toolResultSeenByModel"' $R/fake.log) -gt $n ] 2>/dev/null && break; sleep 0.5; done; sleep 1.5; }
for i in $(seq 1 60); do tk shot 5 | grep -q "Type your message" && break; sleep 0.5; done
waitmcp listTools 1
send 'CALL lookup ARGS {"cnt":3}'
tk type '/mcp'; sleep 0.4; tk key Enter; sleep 1.5; tk key Enter; sleep 1.5
tk key Down; sleep 0.4; tk key Enter; sleep 2.5          # Disable
tk key Enter; waitmcp listTools 2; sleep 2              # Enable -> rediscovery
tk key Escape; sleep 0.5; tk key Escape; sleep 0.8
send 'CALL lookup ARGS {"cnt":3}'
send 'CALL lookup ARGS {"count":0}'
send 'CALL lookup ARGS {"count":2}'
tk ansi > $R/final.ansi
echo "== MCP server log"; cat $R/mcp.log
