// Round 10: 581578466b routes is_background / is_monitor straight to their
// own admission, no longer through the Shell tool's validateToolParams
// (self-kill guard, trailing "&", command roots, ...). Starts, through the
// real executor, commands that validator refuses — a self-kill pattern that
// is harmless (signal 0) and a trailing "&" — plus a valid control.
import fs from 'node:fs';
const file = '/Users/wenshao/pr13265-rig/probe/l19-executor.mjs';
let s = fs.readFileSync(file, 'utf8');
const anchor = '// e2. the production stop route on an ordinary running background Shell';
if (s.split(anchor).length !== 2) throw new Error('anchor');
s = s.replace(anchor, () => `// e3. what the worker admits into the background and Monitor families
if (want('bgValidation')) {
  out.bgValidation = {};
  for (const [label, command, kind] of [
    ['selfKillSignal0', 'pgrep -f qwen | xargs kill -0', 'background'],
    ['trailingAmpersand', 'sleep 2 &', 'background'],
    ['monitorSelfKillSignal0', 'pgrep -f qwen | xargs kill -0', 'monitor'],
    ['control', 'sleep 0.2', 'background'],
  ]) {
    let s1;
    try { s1 = await start('s-val', \`l19-val-\${label.toLowerCase()}\`, command, kind); } catch (e) { out.bgValidation[label] = { threw: \`\${e.name}: \${e.message.slice(0, 160)}\` }; continue; }
    out.bgValidation[label] = { started: s1.started, startError: s1.startError ? s1.startError.slice(0, 200) : null, unitCreated: fs.existsSync(path.join(ROOT, s1.unitName)) };
    try { await registry.terminate(s1.unitName, 500); } catch {}
    try { await executor.monitorRegistry.physical.terminate?.(s1.unitName, 500); } catch {}
  }
}

` + anchor);
fs.writeFileSync(file, s);
console.log('added bgValidation');
