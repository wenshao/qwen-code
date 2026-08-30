#!/bin/bash
# Real `qwen serve` daemon E2E for the R9-1 ledger reconciliation.
set -u
TREE="$1"; LABEL="$2"; OUT="$3"
H=$(mktemp -d /tmp/qh-XXXX); WS=$(mktemp -d /tmp/qws-XXXX)
export QWEN_HOME="$H"
mkdir -p "$H"
cat > "$H/settings.json" <<'JSON'
{ "security": { "folderTrust": { "enabled": false } }, "privacy": { "usageStatisticsEnabled": false } }
JSON
PORT=$(node -e "const n=require('net');const s=n.createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")
cd "$TREE"
node packages/cli/dist/index.js serve --no-web --port "$PORT" --workspace "$WS" > "$H/daemon.log" 2>&1 &
DPID=$!
for i in $(seq 1 80); do
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.5
done
# ---- seed: interrupted unarchive left the OLDER half in chats/archive/,
#      the session was reused and wrote the NEWER terminal to the active half.
SID="550e8400-e29b-41d4-a716-4466554402e1"
echo "PORT=$PORT WS=$WS"; curl -s "http://127.0.0.1:$PORT/health" | head -c 200; echo; SEED=$(TREE_ROOT="$TREE" WS="$WS" SID="$SID" node --input-type=module -e '
import fs from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const core = await import(pathToFileURL(path.join(process.env.TREE_ROOT,"packages/core/dist/index.js")).href);
const { SessionService, Storage } = core;
const ws = process.env.WS, id = process.env.SID;
const svc = new SessionService(ws);
const chats = path.join(new Storage(ws).getProjectDir(), "chats");
fs.mkdirSync(chats, { recursive: true });
fs.writeFileSync(path.join(chats, id + ".jsonl"), JSON.stringify({uuid:"record-1",parentUuid:null,sessionId:id,timestamp:"2024-01-01T00:00:00.000Z",type:"user",message:{role:"user",parts:[{text:"hello"}]},cwd:ws,version:"1.0.0"})+"\n");
const active = svc.getPromptLedgerPath(id);
const archived = path.join(path.dirname(svc.getPrSessionPathForArchiveState(id,"archived")), id + ".ledger.jsonl");
fs.mkdirSync(path.dirname(active),{recursive:true}); fs.mkdirSync(path.dirname(archived),{recursive:true});
fs.writeFileSync(archived, JSON.stringify({v:1,promptId:"p1",state:"in_flight",at:1})+"\n");
fs.writeFileSync(active, JSON.stringify({v:1,promptId:"p1",terminal:"completed",at:2})+"\n");
console.log(JSON.stringify({active, archived}));
' 2>&1)
echo "SEED=$SEED"
ACTIVE=$(echo "$SEED" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).active))")
ARCHIVED=$(echo "$SEED" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).archived))")

RESP=$(curl -s -w '\n%{http_code}' -X POST "http://127.0.0.1:$PORT/sessions/unarchive" \
  -H 'content-type: application/json' \
  -d "{\"sessionIds\":[\"$SID\"],\"cwd\":\"$WS\"}")
CODE=$(echo "$RESP" | tail -n1); BODY=$(echo "$RESP" | sed '$d')

READ=$(TREE_ROOT="$TREE" A="$ACTIVE" B="$ARCHIVED" node --input-type=module -e '
import fs from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const led = await import(pathToFileURL(path.join(process.env.TREE_ROOT,"packages/acp-bridge/dist/prompt-ledger.js")).href);
const a = process.env.A, b = process.env.B;
const recs = fs.existsSync(a) ? led.readPromptLedgerRecords(a) : [];
console.log(JSON.stringify({ activeLedgerOrder: recs.map(r=>r.at), dangling: led.danglingInFlightPromptIds(recs), archivedHalfStranded: fs.existsSync(b) }));
' 2>&1)
echo "READ=$READ"
echo "CODE=$CODE BODY=$BODY"
kill $DPID 2>/dev/null; wait $DPID 2>/dev/null
L="$LABEL" C="$CODE" B="$BODY" R="$READ" node -e "
console.log(JSON.stringify({arm:process.env.L, httpStatus:process.env.C, response:JSON.parse(process.env.B||'{}'), ledger:JSON.parse(process.env.R)},null,2))
" > "$OUT"
cat "$OUT"
rm -rf "$H" "$WS"
cat "$OUT"
