// R3-7: freezeRequest skips the "thinking off" canonicalisation when merged
// samplingParams/extra_body already carry enable_thinking. A/B against the REAL
// realtime path (`qwen -p`) with identical settings, both against a spoofed
// dashscope.aliyuncs.com (TLS on 127.0.0.1:443 inside a private netns whose
// /etc/hosts is bind-mounted by run-tls.sh) so the realtime DashScope provider
// branch (isDashScopeProvider) is taken exactly as for a real user.
import fs from 'node:fs';
import path from 'node:path';
import { startFake, makeSandbox, writePlan, TWO_ITEMS, run, verdict, finish, logLine } from './lib.mjs';

const TLS = '/root/verify/pr12492/r3-repro/tls';
const BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const fake = await startFake({}, {
  https: { key: fs.readFileSync(`${TLS}/key.pem`), cert: fs.readFileSync(`${TLS}/cert.pem`) },
  port: 443,
});

// The exact provider entry the Alibaba ModelStudio Standard preset installs
// (buildInstallPlan(alibabaStandardProvider, {modelIds:['qwen3.6-plus']})).
const presetEntry = (withExtraBody) => ({
  id: 'qwen3.6-plus',
  name: '[ModelStudio Standard] qwen3.6-plus',
  capabilities: { reasoning: { thinking: true, toggleOnly: true, disableField: 'enable_thinking' } },
  baseUrl: BASE,
  envKey: 'DASHSCOPE_API_KEY',
  generationConfig: { ...(withExtraBody ? { extra_body: { enable_thinking: true } } : {}), contextWindowSize: 1000000 },
});

const arms = [
  { name: 'preset+effort-none', extraBody: true, effort: 'none' },
  { name: 'no-extra_body+effort-none', extraBody: false, effort: 'none' },
  { name: 'preset+default-effort', extraBody: true, effort: undefined },
];
const results = {};
try {
  for (const arm of arms) {
    logLine(`\n######## arm: ${arm.name}`);
    const sb = makeSandbox(`r3-07-${arm.name}`);
    const settings = {
      security: { auth: { selectedType: 'openai' } },
      model: { name: 'qwen3.6-plus', baseUrl: BASE, ...(arm.effort ? { reasoningEffort: arm.effort } : {}) },
      modelProviders: { openai: [presetEntry(arm.extraBody)] },
    };
    fs.writeFileSync(path.join(sb.qwenHome, 'settings.json'), JSON.stringify(settings, null, 2));
    writePlan(sb.project, 'plan.json', 'r3-07', TWO_ITEMS());
    const env = {
      PATH: process.env.PATH,
      TERM: 'dumb',
      NO_COLOR: '1',
      HOME: sb.fakeHome,
      USERPROFILE: sb.fakeHome,
      QWEN_HOME: sb.qwenHome,
      QWEN_CODE_SYSTEM_SETTINGS_PATH: path.join(sb.fakeHome, 'system-settings.json'),
      QWEN_CODE_SYSTEM_DEFAULTS_PATH: path.join(sb.fakeHome, 'system-defaults.json'),
      QWEN_BATCH_HOME: sb.batchHome,
      DASHSCOPE_API_KEY: 'fake-dashscope-key',
      NODE_EXTRA_CA_CERTS: `${TLS}/cert.pem`,
    };
    const dry = await run(sb.project, env, ['run', 'plan.json', '--dry-run']);
    const up0 = fake.uploads.length;
    await run(sb.project, env, ['run', 'plan.json']);
    const batchLine = fake.uploads.slice(up0).flat().map((l) => JSON.parse(l))[0];
    const batchThinking = batchLine ? { enable_thinking: batchLine.body.enable_thinking, reasoning_effort: batchLine.body.reasoning_effort } : null;
    const c0 = fake.chat.length;
    const rt = await run(sb.project, env, ['-p', 'Say hi', '--output-format', 'text'], { raw: true, label: 'REALTIME headless turn' });
    const turns = fake.chat.slice(c0);
    const mainTurn = turns.find((t) => t.body.stream === true) ?? turns[0];
    const realtimeThinking = mainTurn ? { enable_thinking: mainTurn.body.enable_thinking, reasoning_effort: mainTurn.body.reasoning_effort, host: mainTurn.host } : null;
    logLine(`chat requests seen: ${turns.map((t) => `stream=${t.body.stream} enable_thinking=${t.body.enable_thinking}`).join(' | ')}`);
    logLine(`BATCH request body:    ${JSON.stringify(batchThinking)}   preview label: ${/thinking (on|off)|thinking: provider default/.exec(dry.stdout)?.[0]}`);
    logLine(`REALTIME request body: ${JSON.stringify(realtimeThinking)}   (exit ${rt.code})`);
    results[arm.name] = { batchThinking, realtimeThinking, label: /thinking (on|off)|thinking: provider default/.exec(dry.stdout)?.[0] };
  }
  const a = results['preset+effort-none'];
  verdict('preset + /effort none: REALTIME ships enable_thinking=false', a.realtimeThinking?.enable_thinking === false);
  verdict('preset + /effort none: BATCH ships enable_thinking=true and previews "thinking on"',
    a.batchThinking?.enable_thinking === true && a.label === 'thinking on');
  const b = results['no-extra_body+effort-none'];
  verdict('control (no extra_body) + /effort none: BATCH ships enable_thinking=false (matches realtime)',
    b.batchThinking?.enable_thinking === false && b.realtimeThinking?.enable_thinking === false);
  const c = results['preset+default-effort'];
  verdict('control (preset, thinking left on): both ship enable_thinking=true',
    c.batchThinking?.enable_thinking === true && c.realtimeThinking?.enable_thinking === true);
} finally {
  finish();
  await fake.close();
}
