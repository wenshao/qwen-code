// Candidate fallback forms for PR #12675, run on the current platform.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const label = process.argv[2];
const win = process.platform === 'win32';
const npmCli = win ? path.win32.join(path.win32.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  : fs.realpathSync(path.join(path.dirname(process.execPath), 'npm'));
const npmVer = execFileSync(process.execPath, [npmCli, '-v'], { encoding: 'utf8' }).trim();
const run = (args, env, cwd) => { try { return { ok: true, out: execFileSync(process.execPath, [npmCli, ...args], { encoding: 'utf8', timeout: 30000, stdio: ['ignore','pipe','pipe'], env, cwd }).trim().split(/\r?\n/).at(-1) }; } catch (e) { return { ok: false, out: 'FAIL: ' + String(e.stderr || e.message).split(/\r?\n/).filter(Boolean)[0] }; } };
const expr = "process.env.npm_config_globalconfig || require('path').resolve(process.env.npm_config_global_prefix, 'etc', 'npmrc')";
const C = {
  'PR (-c "<execPath>" -p "...")': ['exec','--offline','-c',`"${process.execPath}" -p "${expr}"`],
  'PR + --global': ['exec','--global','--offline','-c',`"${process.execPath}" -p "${expr}"`],
  '--global -c node -p "..."': ['exec','--global','--offline','-c',`node -p "${expr}"`],
  '--global -- <execPath> -p <expr>': ['exec','--global','--offline','--',process.execPath,'-p',expr],
  '--global -- node -p <expr>': ['exec','--global','--offline','--','node','-p',expr],
};
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'p12675c-')));
const env0 = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)));
const uuid = path.join(root, 'prefix-123e4567-e89b-12d3-a456-426614174000'); fs.mkdirSync(uuid);
const userrc = path.join(root, 'userrc'); fs.writeFileSync(userrc, `prefix=${uuid}\n`);
const repo = path.join(root, 'repo'); fs.mkdirSync(repo); fs.writeFileSync(path.join(repo,'package.json'),'{}'); fs.writeFileSync(path.join(repo,'.npmrc'),'globalconfig=evil.npmrc\n');
const work = path.join(root, 'work'); fs.mkdirSync(work);
// node dir deliberately NOT first on PATH for the "node" candidates: put a decoy-free PATH without node
const pathNoNode = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(d => !fs.existsSync(path.join(d, win ? 'node.exe' : 'node'))).join(path.delimiter);
const scen = [
  ['UUID prefix, clean cwd', { ...env0, NPM_CONFIG_USERCONFIG: userrc }, work],
  ['UUID prefix, repo .npmrc globalconfig=evil', { ...env0, NPM_CONFIG_USERCONFIG: userrc }, repo],
  ['UUID prefix, clean cwd, node not on PATH', { ...env0, PATH: pathNoNode, Path: pathNoNode, NPM_CONFIG_USERCONFIG: userrc }, work],
];
const expect = path.join(uuid, 'etc', 'npmrc');
const rows = [];
for (const [name, env, cwd] of scen) for (const [cn, args] of Object.entries(C)) {
  const r = run(args, env, cwd);
  rows.push({ node: label, npm: npmVer, os: process.platform, scenario: name, candidate: cn, result: r.ok ? (r.out.toLowerCase() === expect.toLowerCase() ? 'expected' : 'OTHER ' + r.out.replace(root, '<tmp>')) : r.out.slice(0, 110) });
}
console.log('PROBE_JSON ' + JSON.stringify(rows));
