// Independent reader: raw read + the REAL operator policy reader from the arm's compiled CLI.
import fs from 'node:fs';
const [arm, target, stopFile] = process.argv.slice(2);
const { readOperatorSandboxSettings } = await import(`/root/verify/pr13119/${arm}/packages/cli/dist/src/config/execution-sandbox-settings.js`);
const c = { samples: 0, absent: 0, parseError: 0, policyLost: 0, readerThrew: 0 };
while (!fs.existsSync(stopFile)) {
  c.samples++;
  let raw;
  try { raw = fs.readFileSync(target, 'utf8'); } catch (e) { if (e.code === 'ENOENT') c.absent++; }
  if (raw !== undefined) { try { JSON.parse(raw); } catch { c.parseError++; } }
  try {
    if (!readOperatorSandboxSettings().tools?.executionSandbox) c.policyLost++;
  } catch { c.readerThrew++; }
}
console.log(JSON.stringify(c));
