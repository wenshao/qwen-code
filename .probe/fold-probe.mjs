// PR 12934, real Windows, quick probe (no install):
//  F. Non-ASCII spellings of the locating variables. model = what the evaluation's snapshot reads,
//     lite.getSystemSettingsPath(env) / getSystemDefaultsPath(env) / getGlobalQwenDirLite(env);
//     host = a child spawned with env that calls the same functions without an env (process.env), as a
//     session host's loadSettings does.
//  C. Which characters Windows folds for a lookup, against the view's toUpperCase.
// Prints one `PROBE_JSON {...}` line per case.
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const LITE = path.resolve(process.argv[2] ?? '.probe/lite-head.mjs');
const lite = await import(pathToFileURL(LITE).href);
const emit = (o) => console.log(`PROBE_JSON ${JSON.stringify(o)}`);
emit({ case: 'runner', platform: os.platform(), release: os.release(), node: process.version });
const baseEnv = {};
for (const [k, v] of Object.entries(process.env)) if (!/^(QWEN_|X)/i.test(k)) baseEnv[k] = v;

function hostReads(env) {
  const code = `const l = await import(${JSON.stringify(pathToFileURL(LITE).href)});
    process.stdout.write(JSON.stringify({ sys: l.getSystemSettingsPath(), defaults: l.getSystemDefaultsPath(), home: l.getGlobalQwenDirLite() }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' });
  try { return JSON.parse(r.stdout); } catch { return { error: (r.stderr || String(r.error)).slice(0, 200) }; }
}
const SPELLINGS = [
  ['control: exact', 'QWEN_CODE_SYSTEM_SETTINGS_PATH'],
  ['control: lower case', 'qwen_code_system_settings_path'],
  ['long s (U+017F) for S', 'QWEN_CODE_\u017FYSTEM_SETTINGS_PATH'],
  ['dotless i (U+0131) for I', 'QWEN_CODE_SYSTEM_SETT\u0131NGS_PATH'],
  ['long s in DEFAULTS', 'QWEN_CODE_SYSTEM_DEFAULT\u017F_PATH'],
  ['control: defaults exact', 'QWEN_CODE_SYSTEM_DEFAULTS_PATH'],
];
let diverge = 0;
for (const [label, name] of SPELLINGS) {
  const env = { ...baseEnv, [name]: 'C:\\probe\\from-variable.json' };
  const model = { sys: lite.getSystemSettingsPath(env), defaults: lite.getSystemDefaultsPath(env), home: lite.getGlobalQwenDirLite(env) };
  const host = hostReads(env);
  const same = model.sys === host.sys && model.defaults === host.defaults;
  if (!same) diverge++;
  emit({ part: 'F', case: label, name, model, host, same });
}
emit({ part: 'F', summary: true, spellings: SPELLINGS.length, diverge });

const CHARS = ['\u00DF', '\u0131', '\u017F', '\uFB00', '\uFB01', '\u00B5', '\u00FF', '\u03C2', '\u00E9', '\u01C5', '\u01C6', '\u212A', '\u2170', '\u24D0', '\uFF41', '\u0149', '\u1E9E'];
let folds = 0, agree = 0;
for (const c of CHARS) {
  const name = `X${c}Y`;
  const upper = name.toUpperCase();
  const env = { ...baseEnv, [name]: 'v' };
  const r = spawnSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify([process.env[${JSON.stringify(upper)}] ?? null, process.env[${JSON.stringify(name)}] ?? null]))`], { env, encoding: 'utf8' });
  const [childUpper, childExact] = JSON.parse(r.stdout);
  const viewUpper = lite.spawnedEnvironmentView(env)[upper] ?? null;
  const ok = (childUpper === 'v') === (viewUpper === 'v');
  agree += ok ? 1 : 0; folds += childUpper === 'v' ? 1 : 0;
  emit({ part: 'C', char: `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} ${c}`, jsUpper: upper.slice(1, -1), windowsFindsUnderJsUpper: childUpper === 'v', viewFindsUnderJsUpper: viewUpper === 'v', childExact, agree: ok });
}
emit({ part: 'C', summary: true, chars: CHARS.length, agree });

// A. Does Windows find a non-ASCII-spelled variable under a pure ASCII name? (would make ASCII-only folding miss it)
const TO_ASCII = [['\u212A', 'K'], ['\u017F', 'S'], ['\u0131', 'I'], ['\u212B', 'A'], ['\uFF21', 'A'], ['\u0130', 'I'], ['\u00C5', 'A']];
let asciiHits = 0;
for (const [c, a] of TO_ASCII) {
  const env = { ...baseEnv, [`QWEN_${c}X`]: 'v' };
  const r = spawnSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify([process.env[${JSON.stringify('QWEN_' + a + 'X')}] ?? null, process.env[${JSON.stringify('qwen_' + a.toLowerCase() + 'x')}] ?? null]))`], { env, encoding: 'utf8' });
  const [upper, lower] = JSON.parse(r.stdout);
  const view = lite.spawnedEnvironmentView(env)['QWEN_' + a + 'X'] ?? null;
  if (upper === 'v' || lower === 'v') asciiHits++;
  emit({ part: 'A', char: `U+${c.codePointAt(0).toString(16).toUpperCase()}`, ascii: a, windowsFindsUnderAscii: upper === 'v' || lower === 'v', viewFindsUnderAscii: view === 'v' });
}
emit({ part: 'A', summary: true, chars: TO_ASCII.length, windowsFindsUnderAscii: asciiHits });
