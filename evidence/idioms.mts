const ARMS = { base: '/root/git/pr10983-base', pr: '/root/git/pr10983-pr', inv: '/root/git/pr10983-inv' } as const;
const RP: any = {};
for (const [n, wt] of Object.entries(ARMS)) RP[n] = await import(`${wt}/packages/core/src/permissions/rule-parser.js`);
const cases: Array<[string, string]> = [
  ['npm *',      'ENV=production npm run build'],
  ['npm *',      'NODE_ENV=production npm run build'],
  ['npm *',      'PATH=$PWD/node_modules/.bin:$PATH npm test'],
  ['npm *',      'NODE_OPTIONS=--max-old-space-size=8192 npm run build'],
  ['node *',     'NODE_PATH=./lib node app.js'],
  ['python3 *',  'PYTHONPATH=$PWD/src python3 -m pytest'],
  ['python3 *',  'PYTHONPATH=./src python3 -m pytest'],
  ['make *',     'CC=gcc-14 CXX=g++-14 make -j8'],
  ['cargo *',    'RUSTFLAGS="-C target-cpu=native" cargo build'],
  ['go *',       'GOOS=linux GOARCH=amd64 go build ./...'],
  ['pytest *',   'TZ=UTC LANG=C.UTF-8 pytest -q'],
  ['docker *',   'DOCKER_BUILDKIT=1 docker build .'],
  ['java *',     'JAVA_HOME=/usr/lib/jvm/java-25 java -version'],
  ['npm *',      'npm_config_registry=https://r.example.com npm ci'],
  ['git *',      'GIT_AUTHOR_DATE="2026-01-01T00:00:00" git commit --amend --no-edit'],
];
const pad=(s:string,n:number)=>(s+' '.repeat(n)).slice(0,n);
console.log(pad('saved rule',14), pad('command',58), pad('main',7), pad('PR',7), 'allowlist-inverted');
console.log('-'.repeat(104));
let fp=0, fi=0;
for (const [pat,cmd] of cases) {
  const b=RP['base'].matchesCommandPattern(pat,cmd), p=RP['pr'].matchesCommandPattern(pat,cmd), i=RP['inv'].matchesCommandPattern(pat,cmd);
  if (b!==p) fp++; if (b!==i) fi++;
  console.log(pad(`Bash(${pat})`,14), pad(cmd,58), pad(b?'allow':'ask',7), pad((p?'allow':'ask')+(b!==p?' *':''),7), (i?'allow':'ask')+(b!==i?' *':''));
}
console.log(`\nidioms that now prompt — PR: ${fp}/${cases.length}   allowlist-inverted: ${fi}/${cases.length}   (* = changed vs main)`);
