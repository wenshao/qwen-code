// R3-1: `check` reads request.params['max_tokens'] while run uses outputBudgetKey().
import fs from 'node:fs';
import path from 'node:path';
import { startFake, makeSandbox, writePlan, TWO_ITEMS, baseEnv, run, verdict, finish, logLine } from './lib.mjs';

const fake = await startFake();
try {
  for (const selector of ['model.name', 'batch.model']) {
    logLine(`\n######## selector: ${selector}`);
    const sb = makeSandbox(`r3-01-${selector.replace('.', '_')}`);
    const provider = {
      id: 'qwen-plus',
      name: 'qwen-plus',
      baseUrl: fake.baseUrl,
      envKey: 'FAKE_PROVIDER_KEY',
      generationConfig: { samplingParams: { max_completion_tokens: 1024 } },
    };
    const settings = {
      security: { auth: { selectedType: 'openai' } },
      model: { name: 'qwen-plus' },
      modelProviders: { openai: [provider] },
      ...(selector === 'batch.model' ? { batch: { model: 'qwen-plus' } } : {}),
    };
    fs.writeFileSync(path.join(sb.qwenHome, 'settings.json'), JSON.stringify(settings, null, 2));
    writePlan(sb.project, 'plan.json', 'r3-01', TWO_ITEMS());
    const env = baseEnv(sb, fake, {
      OPENAI_API_KEY: undefined,
      OPENAI_MODEL: undefined,
      FAKE_PROVIDER_KEY: 'fake-provider-key',
    });
    const chk = await run(sb.project, env, ['check']);
    const dry = await run(sb.project, env, ['run', 'plan.json', '--dry-run']);
    const uploadsBefore = fake.uploads.length;
    const real = await run(sb.project, env, ['run', 'plan.json']);
    const lines = fake.uploads.slice(uploadsBefore).flat().map((l) => JSON.parse(l));
    const bodyKeys = lines.map((l) => JSON.stringify({ max_completion_tokens: l.body.max_completion_tokens, max_tokens: l.body.max_tokens }));
    logLine(`uploaded request output-limit fields: ${bodyKeys.join(' ')}`);
    verdict(
      `[${selector}] check says "provider default" while dry-run says "1024 tokens"`,
      /max output provider default/.test(chk.stdout) && /max output 1024 tokens/.test(dry.stdout),
    );
    verdict(
      `[${selector}] submitted requests really carry max_completion_tokens=1024 (so check is the wrong one)`,
      lines.length > 0 && lines.every((l) => l.body.max_completion_tokens === 1024 && l.body.max_tokens === undefined),
    );
  }
} finally {
  finish();
  await fake.close();
}
