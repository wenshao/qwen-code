// PR #13243 R4-3 Windows probe: which manifest modulePaths pass the platform
// isAbsolute check yet make pathToFileURL throw, measured with the platform's
// own node:path / node:url (no { windows: true } emulation).
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const CANDIDATES = [
  ['unc-host', '\\\\host'],
  ['unc-empty-server', '\\\\\\\\'],
  ['unc-long-empty', '\\\\?\\UNC\\'],
  ['unc-long-host', '\\\\?\\UNC\\host'],
  ['unc-host-trailing-sep', '\\\\host\\'],
  ['unc-host-share', '\\\\host\\share\\h.mjs'],
  ['drive-relative', 'C:h.mjs'],
  ['posix-nul', '/a\u0000b.mjs'],
];
for (const [name, p] of CANDIDATES) {
  const out = { probe: 'native-path', platform: process.platform, name, path: p, isAbsolute: isAbsolute(p) };
  try {
    out.href = pathToFileURL(p).href;
  } catch (error) {
    out.throws = `${error?.code ?? ''} ${String(error?.message ?? error).split('\n')[0]}`.slice(0, 160);
  }
  console.log('PROBE_JSON ' + JSON.stringify(out));
}
