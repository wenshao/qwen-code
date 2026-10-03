# writes HOME/.qwen/settings.json with the stdio MCP server (mode distinct)
WS=$1; OUT=$2
mkdir -p "$OUT/home/.qwen"
cat > "$OUT/home/.qwen/settings.json" <<J
{ "security": { "folderTrust": { "enabled": false } },
  "mcpServers": { "upstream": { "command": "/usr/bin/node", "args": ["/root/verify/pr10916/r3/harness/mcp-upstream.mjs", "distinct", "$OUT/mcp-hits.jsonl"], "cwd": "/root/verify/pr10916/r3/pr" } } }
J
