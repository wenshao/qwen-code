// R3-9: `list` and `clean` never load settings, so QWEN_BATCH_HOME set only via
// <QWEN_HOME>/.env or settings.json `env` is honoured by run/collect but not list/clean.
import fs from 'node:fs';
import path from 'node:path';
import { startFake, makeSandbox, writePlan, TWO_ITEMS, baseEnv, run, taskIdOf, verdict, finish, logLine } from './lib.mjs';

const fake = await startFake();
try {
  for (const via of ['qwen-home-dotenv', 'settings-env']) {
    logLine(`\n######## QWEN_BATCH_HOME via ${via}`);
    const sb = makeSandbox(`r3-09-${via}`);
    const custom = path.join(sb.root, 'custom-batch-home');
    if (via === 'qwen-home-dotenv') {
      fs.writeFileSync(path.join(sb.qwenHome, '.env'), `QWEN_BATCH_HOME=${custom}\n`);
    } else {
      fs.writeFileSync(path.join(sb.qwenHome, 'settings.json'), JSON.stringify({ env: { QWEN_BATCH_HOME: custom } }));
    }
    writePlan(sb.project, 'plan.json', `r3-09-${via}`, TWO_ITEMS());
    const env = baseEnv(sb, fake, { QWEN_BATCH_HOME: undefined });
    const id = taskIdOf(await run(sb.project, env, ['run', 'plan.json']));
    const where = fs.existsSync(path.join(custom, 'tasks', id)) ? 'custom' : fs.existsSync(path.join(sb.qwenHome, 'batch', 'tasks', id)) ? 'default' : 'none';
    logLine(`task record written to: ${where === 'custom' ? custom : where}`);
    const col = await run(sb.project, env, ['collect', id]);
    const list = await run(sb.project, env, ['list']);
    const clean = await run(sb.project, env, ['clean', id]);
    if (where === 'custom') {
      verdict(`[${via}] run+collect use the custom home`, col.code === 0 && /2 delivered/.test(col.stdout));
      verdict(`[${via}] list looks in the default home and shows nothing`, /no batch tasks under .*\.qwen\/batch/.test(list.stdout));
      verdict(`[${via}] clean cannot find the task`, clean.code === 1 && /no batch task/.test(clean.stderr));
    } else {
      verdict(`[${via}] run honoured the setting`, false, `record went to ${where}`);
    }
  }
} finally {
  finish();
  await fake.close();
}
