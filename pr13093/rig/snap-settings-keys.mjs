// Waits for the runner's private Harness settings file and records its key
// paths only. Values are never written: strings become "<string>".
// usage: node snap-settings-keys.mjs <TMPDIR> <out.txt>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const tmp = process.argv[2];
const out = process.argv[3];
const before = new Set(
  readdirSync(tmp).filter((name) =>
    name.startsWith('managed-agent-server-e2e-'),
  ),
);
process.on('SIGTERM', () => process.exit(0));

function shape(value, prefix, lines) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => shape(entry, `${prefix}[${index}]`, lines));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      shape(entry, prefix === '' ? key : `${prefix}.${key}`, lines);
    }
  } else if (typeof value === 'string') {
    lines.push(`${prefix} = <string>`);
  } else {
    lines.push(`${prefix} = ${JSON.stringify(value)}`);
  }
}

const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  for (const name of readdirSync(tmp)) {
    if (!name.startsWith('managed-agent-server-e2e-') || before.has(name)) {
      continue;
    }
    const file = path.join(tmp, name, 'harness-home', '.qwen', 'settings.json');
    try {
      const settings = JSON.parse(readFileSync(file, 'utf8'));
      const lines = [];
      shape(settings, '', lines);
      writeFileSync(out, `${file}\n${lines.join('\n')}\n`);
      process.exit(0);
    } catch {
      // Not written yet.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}
writeFileSync(out, 'harness settings file never appeared\n');
