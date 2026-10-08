# sourced helpers (bash)
mks(){ db=$1; name=$2; node client.mjs $db session "USER::init-$name Reply with exactly: READY" | node -e 'const j=JSON.parse(require("fs").readFileSync(0));console.log(j.status, j.json.id ?? JSON.stringify(j.json).slice(0,200))' | tee /dev/stderr | awk '{print $2}' > runs/$db/$name; }
mk(){ node -e '
const [sid,goal,prompt,overlap,cron]=process.argv.slice(1);
console.log(JSON.stringify({session_id:sid,goal,cron,timezone:"UTC",prompt,session_mode:"persistent",overlap,catch_up:"none"}));' "$@"; }
short(){ node -e 'const j=JSON.parse(require("fs").readFileSync(0));const b=j.json;const e=b.error??{};console.log(j.status, "replay="+(j.replay??"-"), b.id??"", b.definition_revision??"", b.state??b.outcome??"", e.code??"")'; }
TOOLP='Use the read_file tool to read the file notes/status.txt in the workspace, then reply with exactly the first line of that file and nothing else.'
