// VERIFICATION RIG ONLY (PR #13351): derive a Harness settings file for qwen3.8-max that routes through the
// cutting proxy, the same way scripts/run-managed-agent-server-e2e.ts derives its real-model settings.
// usage: node real-settings.mjs <out-settings.json> <proxy-base-url> <upstream-file>
// Writes the provider's original baseUrl to <upstream-file>; prints no credential.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [out, proxy, upstreamFile] = process.argv.slice(2);
const model = 'qwen3.8-max';
const source = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.qwen', 'settings.json'), 'utf8'));
let group, provider;
for (const [g, entries] of Object.entries(source.modelProviders ?? {})) {
  const list = Array.isArray(entries) ? entries : Object.values(entries ?? {});
  const hit = list.find((e) => e && (e.id === model || e.name === model));
  if (hit) { group = g; provider = hit; break; }
}
if (!provider) throw new Error('provider missing');
const key = provider.envKey;
const value = (source.env ?? {})[key] ?? process.env[key];
if (typeof value !== 'string') throw new Error('credential missing');
fs.writeFileSync(upstreamFile, provider.baseUrl);
const settings = {
  ...(source.$version === undefined ? {} : { $version: source.$version }),
  env: { [key]: value },
  model: { name: model, baseUrl: proxy },
  modelProviders: { [group]: [{ ...provider, baseUrl: proxy }] },
  ...(source.security === undefined ? {} : { security: source.security }),
  telemetry: { enabled: false },
  ui: { enableFollowupSuggestions: false },
};
fs.writeFileSync(out, JSON.stringify(settings), { mode: 0o600 });
console.log(`settings written: group=${group} model=${model} upstreamHost=${new URL(provider.baseUrl).host} proxy=${proxy}`);
