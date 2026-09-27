F=$1/packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json
node -e '
const fs=require("fs");const f=process.argv[1];const s=JSON.parse(fs.readFileSync(f,"utf8"));
s.paths["/api/agent/web-shell/v1/tasks/cancel"].post["x-qwen-implementation-status"]="partial";
fs.writeFileSync(f,JSON.stringify(s,null,2)+"\n");' $F
