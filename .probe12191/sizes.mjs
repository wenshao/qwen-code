// Published-entry shape and ratchet headroom for PR #12191, per platform/arm.
// Usage: node sizes.mjs <repoRoot>
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const dist = join(root, 'packages/web-shell/dist');
const read = (f) => readFileSync(join(dist, f), 'utf8');
const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const imports = (bundle, dep) => new RegExp(`from\\s*["']${esc(dep)}(?:/[^"']*)?["']`).test(bundle);

const index = read('index.js');
const transcript = read('transcript.js');
const transcriptJs = transcript.replace(/^const __qwenWebShellCss=[^\n]*\n/, '');
const DEPS = [
  '@modelcontextprotocol/ext-apps',
  '@tanstack/react-table',
  '@tanstack/react-virtual',
  '@xterm/addon-fit',
  '@xterm/xterm',
  'fzf',
];
const doc = join(root, 'packages/web-templates/src/export-html/dist/export-transcript-document.js');
const docText = existsSync(doc) ? readFileSync(doc, 'utf8') : null;
console.log(
  'PROBE_JSON ' +
    JSON.stringify({
      kind: 'sizes',
      indexBytes: Buffer.byteLength(index),
      transcriptBytes: Buffer.byteLength(transcript),
      transcriptJsUnits: transcriptJs.length,
      transcriptJsBytes: Buffer.byteLength(transcriptJs),
      ratchetHeadroomUnits: 1_150_000 - transcriptJs.length,
      ratchetHeadroomBytes: 1_150_000 - Buffer.byteLength(transcriptJs),
      externalInIndex: DEPS.filter((d) => imports(index, d)).length,
      transcriptImportsBridge: /from\s*["']@modelcontextprotocol\/ext-apps\/app-bridge["']/.test(transcript),
      documentRendererBytes: docText === null ? null : Buffer.byteLength(docText),
      documentHasAppBridgeMarker: docText === null ? null : /ui\/initialize/.test(docText),
    }),
);
