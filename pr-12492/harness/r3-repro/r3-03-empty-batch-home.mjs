// R3-3: QWEN_BATCH_HOME="" -> `??` keeps "", task store becomes CWD-relative.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startFake, makeSandbox, writePlan, TWO_ITEMS, baseEnv, run, taskIdOf, verdict, finish, logLine } from './lib.mjs';

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });

const fake = await startFake();
try {
  for (const variant of ['no-root-gitignore', 'has-root-gitignore']) {
    logLine(`\n######## ${variant}`);
    const sb = makeSandbox(`r3-03-${variant}`, { gitignore: variant === 'has-root-gitignore' });
    writePlan(sb.project, 'plan.json', 'r3-03', TWO_ITEMS());
    git(sb.project, 'init', '-q');
    git(sb.project, 'add', '-A');
    git(sb.project, 'commit', '-qm', 'init');
    fs.writeFileSync(path.join(sb.project, 'NEW_FEATURE.ts'), 'export const x = 1;\n');
    fs.mkdirSync(path.join(sb.project, 'src'));
    fs.writeFileSync(path.join(sb.project, 'src', 'added.ts'), 'export {};\n');
    const before = git(sb.project, 'status', '--porcelain', '--untracked-files=all');
    logLine(`git status BEFORE:\n${before.trimEnd().replace(/^/gm, '  | ')}`);
    const env = baseEnv(sb, fake, { QWEN_BATCH_HOME: '' });
    const dry = await run(sb.project, env, ['run', 'plan.json', '--dry-run'], { label: 'QWEN_BATCH_HOME=""' });
    const after = git(sb.project, 'status', '--porcelain', '--untracked-files=all');
    logLine(`git status AFTER dry-run:\n${(after.trimEnd() || '(empty)').replace(/^/gm, '  | ')}`);
    const ls = fs.readdirSync(sb.project).sort().join(' ');
    logLine(`project entries after dry-run: ${ls}`);
    const gi = fs.existsSync(path.join(sb.project, '.gitignore')) ? fs.readFileSync(path.join(sb.project, '.gitignore'), 'utf8') : '(none)';
    logLine(`project .gitignore: ${JSON.stringify(gi)}`);
    let checkIgnore = '';
    try { checkIgnore = git(sb.project, 'check-ignore', '-v', 'NEW_FEATURE.ts', 'src/added.ts'); } catch { checkIgnore = '(not ignored)'; }
    logLine(`git check-ignore -v: ${checkIgnore.trim()}`);
    fs.writeFileSync(path.join(sb.project, 'LATER.md'), 'written after the dry-run\n');
    const addAll = (() => { git(sb.project, 'add', '-A'); return git(sb.project, 'diff', '--cached', '--name-only'); })();
    logLine(`'git add -A' then staged names: ${JSON.stringify(addAll.trim())}`);
    git(sb.project, 'reset', '-q');
    if (variant === 'no-root-gitignore') {
      verdict(`[${variant}] dry-run writes "*" .gitignore into the project root`, gi === '*\n' && dry.code === 0);
      verdict(`[${variant}] afterwards every untracked file is invisible to git status and git add -A`,
        before.includes('NEW_FEATURE.ts') && !after.includes('NEW_FEATURE.ts') && !addAll.includes('LATER.md'));
    } else {
      verdict(`[${variant}] existing .gitignore untouched`, gi === 'node_modules/\n');
    }
    verdict(`[${variant}] dry-run leaves a "tasks/" dir in the project root`, fs.existsSync(path.join(sb.project, 'tasks')));
    // A real run: where do the private task records (full source copies) land?
    const real = await run(sb.project, env, ['run', 'plan.json'], { label: 'QWEN_BATCH_HOME="" real run' });
    const id = taskIdOf(real);
    const inputJsonl = path.join(sb.project, 'tasks', id ?? 'x', 'attempt-001', 'input.jsonl');
    logLine(`task record in project: ${fs.existsSync(inputJsonl) ? inputJsonl.replace(sb.project, '<project>') : 'absent'}`);
    const afterRun = git(sb.project, 'status', '--porcelain', '--untracked-files=all');
    logLine(`git status AFTER real run:\n${(afterRun.trimEnd() || '(empty)').replace(/^/gm, '  | ')}`);
    if (variant === 'has-root-gitignore') {
      verdict(`[${variant}] task records (full source copies) show up as untracked, committable files`, /tasks\//.test(afterRun));
    }
    // does collect from another directory find it?
    const other = path.join(sb.root, 'elsewhere');
    fs.mkdirSync(other, { recursive: true });
    const col = await run(other, env, ['collect', id], { label: 'collect from a different cwd' });
    verdict(`[${variant}] collect from another cwd cannot find the task`, col.code === 1 && /no batch task/.test(col.stderr));
  }
} finally {
  finish();
  await fake.close();
}
