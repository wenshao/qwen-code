// R1-7: PR stdio env (managed-mcp-runtime.ts) -> SDK merge (client/stdio.js) -> Node 22 win32 env filter.
const WIN = ['APPDATA','HOMEDRIVE','HOMEPATH','LOCALAPPDATA','PATH','PROCESSOR_ARCHITECTURE','SYSTEMDRIVE','SYSTEMROOT','TEMP','USERNAME','USERPROFILE','PROGRAMFILES'];
const hostEnv = { Path: 'C:\\Windows\\system32;C:\\node', SystemRoot: 'C:\\Windows', APPDATA: 'C:\\Users\\u\\AppData\\Roaming', TEMP: 'C:\\Temp' };
const winGet = (k) => Object.entries(hostEnv).find(([x]) => x.toUpperCase() === k.toUpperCase())?.[1];
const dir = 'C:\\ws\\child';
const serverParamsEnv = { ...Object.fromEntries(WIN.map((k) => [k, ''])), PATH: winGet('PATH') ?? '', HOME: dir, USERPROFILE: dir, ...(winGet('SystemRoot') ? { SYSTEMROOT: winGet('SystemRoot') } : {}) };
const def = {}; for (const k of WIN) { const v = winGet(k); if (v !== undefined) def[k] = v; }
const env = { ...def, ...serverParamsEnv };
const seen = new Set();
const kept = Object.keys(env).sort().filter((k) => { const u = k.toUpperCase(); if (seen.has(u)) return false; seen.add(u); return true; });
console.log('keys differing only in case:', Object.keys(env).filter((k) => Object.keys(env).some((o) => o !== k && o.toUpperCase() === k.toUpperCase())));
for (const k of kept.filter((k) => k.toUpperCase() === 'SYSTEMROOT')) console.log('child gets', k, '=', JSON.stringify(env[k]));
