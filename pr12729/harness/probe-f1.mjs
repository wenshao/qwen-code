import fs from 'node:fs';
const M = await import(process.env.MOD);
const fx = JSON.parse(fs.readFileSync(process.env.FIX,'utf8'));
const base = fx.manifestCases.find(c=>c.id==='pending-open-streams').manifest;
const tries = {
  'unknown + exitCode 137 (pending)': {...base, exitCode:137},
  'unknown + signal SIGKILL (pending)': {...base, signal:'SIGKILL'},
  'unknown + exitCode 0 (partial)': {...fx.manifestCases.find(c=>c.id==='partial-with-an-unknown-outcome').manifest, exitCode:0},
};
for (const [k,v] of Object.entries(tries)) {
  let r; try { M.parseToolResultManifest(v); r='ACCEPTED'; } catch(e){ r='refused: '+e.message; }
  console.log(k.padEnd(40), r);
}
// revision: unknown+exit 137 -> unknown + exit 0 (flip code while still unknown) -> success
const r1={...base, exitCode:137};
const r2={...base, revision: base.revision+1, exitCode:0};
console.log('successor unknown/137 -> unknown/0:', M.isToolResultManifestSuccessor(r1,r2));
