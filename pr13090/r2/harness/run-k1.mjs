// K1: buildOss ignores the credentials argument (production bean keeps env credentials, so only the gate's denied client changes).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const W = process.argv[2];
const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9d84bca0-c4ea-4895-80e3-553468b6983a/scratchpad';
const F = `${W}/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/config/ToolPublicationConfiguration.java`;
const orig = fs.readFileSync(F, 'utf8');
const a = '.credentialsProvider(credentials)';
if (orig.split(a).length !== 2) { console.log('anchor'); process.exit(3); }
try {
  fs.writeFileSync(F, orig.replace(a, '.credentialsProvider(new com.aliyun.oss.common.auth.DefaultCredentialProvider("ignored", "ignored"))'));
  const r = spawnSync(`${S}/rig/mvn.sh`, ['-o', '-f', `${W}/packages/sdk-java/managed-agent-server/pom.xml`, 'clean', 'test'], { encoding: 'utf8', env: { ...process.env, M2: 'm2' }, maxBuffer: 1 << 28 });
  const t = r.stdout + r.stderr; fs.writeFileSync(`${S}/mut/unit-K1.log`, t);
  const sum = [...t.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].map((m) => m.slice(1).join('/')).pop();
  console.log(JSON.stringify({ id: 'K1', result: /COMPILATION ERROR/.test(t) ? 'compile-error' : r.status === 0 ? 'SURVIVED' : 'killed', exit: r.status, summary: sum, failing: [...new Set([...t.matchAll(/\[ERROR\]\s+([A-Za-z0-9_]+Test\.[A-Za-z0-9_]+)/g)].map((m) => m[1]))] }));
} finally { fs.writeFileSync(F, orig); }
