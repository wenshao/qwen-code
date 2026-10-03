WS=$1
cd "$WS" && mkdir -p src
echo 'export const add = (a, b) => a + b;' > src/a.js
echo 'export const helper = () => 1;' > src/b.js
echo '{ "name": "demo", "version": "1.0.0" }' > package.json
git init -q . && git -c user.email=v@l -c user.name=v add -A && git -c user.email=v@l -c user.name=v commit -qm init
echo 'export const mul = (a, b) => a * b;' >> src/a.js
echo 'export const helper2 = () => 2;' > src/b.js
