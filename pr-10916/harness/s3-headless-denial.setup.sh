WS=$1
mkdir -p "$WS/src"
cat > "$WS/package.json" <<'J'
{ "name": "demo", "version": "1.0.0", "scripts": { "test": "node --test", "build": "node build.js", "lint": "eslint ." } }
J
echo 'export const add = (a, b) => a + b;' > "$WS/src/index.js"
