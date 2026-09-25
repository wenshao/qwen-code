// Windows probe for PR #12675: primary vs PR fallback vs --global fallback, verbatim argv.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const label = process.argv[2];
const npmCli = path.win32.join(path.win32.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const npmVer = execFileSync(process.execPath, [npmCli, '-v'], { encoding: 'utf8' }).trim();
const run = (args, env, cwd) => { try { return { ok: true, out: execFileSync(process.execPath, [npmCli, ...args], { encoding: 'utf8', timeout: 30000, stdio: ['ignore','pipe','pipe'], env, cwd }).trim().split(/\r?\n/).at(-1) }; } catch (e) { return { ok: false, out: 'FAIL: ' + String(e.stderr || e.message).split(/\r?\n/).filter(Boolean)[0] }; } };
const script = `"${process.execPath}" -p "process.env.npm_config_globalconfig || require('path').resolve(process.env.npm_config_global_prefix, 'etc', 'npmrc')"`;
const PR = ['exec','--offline','-c',script], FIX = ['exec','--global','--offline','-c',script];
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'p12675-')));
const env0 = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)));
const uuid = path.join(root, 'prefix-123e4567-e89b-12d3-a456-426614174000'); fs.mkdirSync(uuid);
const plain = path.join(root, 'prefix-plain'); fs.mkdirSync(plain);
const userrc = path.join(root, 'userrc'); fs.writeFileSync(userrc, `prefix=${uuid}\n`);
const emptyrc = path.join(root, 'emptyrc'); fs.writeFileSync(emptyrc, '');
const work = path.join(root, 'work'); fs.mkdirSync(work);
const repo = path.join(root, 'repo'); fs.mkdirSync(repo); fs.writeFileSync(path.join(repo,'package.json'),'{}'); fs.writeFileSync(path.join(repo,'.npmrc'),'globalconfig=evil.npmrc\n');
const scen = [
  ['plain prefix (env)', { ...env0, NPM_CONFIG_PREFIX: plain, NPM_CONFIG_USERCONFIG: emptyrc }, work, path.join(plain,'etc','npmrc')],
  ['UUID prefix (env)', { ...env0, NPM_CONFIG_PREFIX: uuid, NPM_CONFIG_USERCONFIG: emptyrc }, work, path.join(uuid,'etc','npmrc')],
  ['UUID prefix (user npmrc)', { ...env0, NPM_CONFIG_USERCONFIG: userrc }, work, path.join(uuid,'etc','npmrc')],
  ['UUID prefix, cwd repo .npmrc globalconfig=evil', { ...env0, NPM_CONFIG_USERCONFIG: userrc }, repo, path.join(uuid,'etc','npmrc')],
];
const rows = [];
for (const [name, env, cwd, expect] of scen) {
  const p = run(['config','get','globalconfig','--global'], env, cwd), f = run(PR, env, cwd), x = run(FIX, env, cwd);
  const sh = r => r.ok ? (r.out.toLowerCase() === expect.toLowerCase() ? 'expected' : 'OTHER ' + r.out.replace(root, '<tmp>')) : r.out.slice(0, 100);
  const eff = p.ok ? p : f;
  rows.push({ node: label, execPath: process.execPath, npm: npmVer, scenario: name, primary: sh(p), prFallback: sh(f), fixFallback: sh(x), prResult: sh(eff) });
}
console.log('PROBE_JSON ' + JSON.stringify(rows));
