import { execSync } from 'node:child_process';
const NEW = ['packages/cli/src/config/', 'packages/core/src/config/', 'packages/core/src/core/'];
const BASE = ['packages/sdk-java/', 'packages/core/src/managed-runtime/', 'packages/cli/src/serve/', 'packages/cli/src/acp-integration/', 'packages/acp-bridge/'];
const EXACT = ['packages/core/src/config/approval-modes.json', 'packages/cli/src/commands/serve.ts', 'integration-tests/fake-openai-server.ts', 'package.json', 'pnpm-lock.yaml', 'docs/developers/sdk-java.md', 'docs/design/java-daemon-sdk-alpha.md', 'scripts/run-java-daemon-sdk-e2e.ts', '.github/workflows/sdk-java.yml', '.github/workflows/release-sdk-java.yml'];
const [since, until, ref] = process.argv.slice(2);
const out = execSync(`git log ${ref} --first-parent --no-merges --since=${since} --until=${until} --format=@@%H --name-only`, { encoding: 'utf8', maxBuffer: 1 << 28 });
let n = 0, old = 0, neu = 0;
for (const block of out.split('@@').slice(1)) {
  const files = block.split('\n').slice(1).filter(Boolean);
  n++;
  const o = files.some((f) => EXACT.includes(f) || BASE.some((p) => f.startsWith(p)));
  const w = o || files.some((f) => NEW.some((p) => f.startsWith(p)));
  old += o; neu += w;
}
console.log(`${since}..${until} ${ref}: commits=${n} old=${old} (${(100*old/n).toFixed(1)}%) new=${neu} (${(100*neu/n).toFixed(1)}%)`);
