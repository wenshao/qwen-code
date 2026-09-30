WS=$1
cat > "$WS/config.json" <<'J'
{ "name": "svc", "port": "3000" }
J
cat > "$WS/check.js" <<'J'
const c = JSON.parse(require('fs').readFileSync(__dirname + '/config.json', 'utf8'));
if (typeof c.port !== 'number') { console.error('config check failed: "port" must be a number'); process.exit(1); }
console.log('config OK, port', c.port);
J
