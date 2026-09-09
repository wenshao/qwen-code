// Generates a realistic exported transcript document with the worktree's own
// export path (built CLI dist + built web-templates template).
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.argv[2];
const out = process.argv[3];
const { createExportTranscriptDocumentV1 } = await import(
  resolve(root, 'packages/cli/dist/src/ui/utils/export/export-transcript-document.js')
);
const { renderExportTranscriptDocumentToHtml } = await import(
  resolve(root, 'packages/cli/dist/src/ui/utils/export/formatters/html.js')
);
const { EXPORT_TRANSCRIPT_RENDERER_VERSION } = await import(
  resolve(root, 'packages/web-templates/dist/index.js')
);

const EXPORTED_AT = '2026-08-16T01:00:00.000Z';
const rec = (uuid, parentUuid, type, text) => ({
  uuid, parentUuid, sessionId: 'pr11485-probe',
  timestamp: '2026-08-16T00:00:00.000Z', cwd: '/workspace/project',
  version: 'test', type,
  message: { role: type === 'user' ? 'user' : 'model', parts: [{ text }] },
});

const records = [
  rec('r0', null, 'user', 'Show me the render surface: headings, a table, code, math and a diagram.'),
  rec('r1', 'r0', 'assistant', [
    '## Split-CSS render probe',
    '',
    'This document is rendered by the **pinned unpkg renderer**. Everything below is',
    'styled by the web-shell component stylesheet.',
    '',
    '| Asset | Bytes | Path |',
    '| --- | ---: | --- |',
    '| renderer JS | 1,833,944 | `export-transcript-document.js` |',
    '| component CSS | 2,302,905 | `export-transcript-document.css` |',
    '',
    '```ts',
    'export const TRANSCRIPT_CSS_ENTRY_FILTER =',
    '  /web-shell[\\\\/]dist[\\\\/]transcript\\.js$/;',
    '```',
    '',
    'Inline math: $E=mc^2$ and a display block:',
    '',
    '$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$',
    '',
    '```mermaid',
    'graph TD; A[Export] --> B[Document]',
    '```',
    '',
    '- [x] stylesheet cascades',
    '- [ ] budget covers the CSS',
    '',
    '> A blockquote, for the border and muted-foreground tokens.',
  ].join('\n')),
  rec('r2', 'r1', 'user', 'And a tool call with a diff, please.'),
];

const doc = createExportTranscriptDocumentV1(
  records,
  {
    startTime: '2026-08-16T00:00:00.000Z',
    metadata: {
      sessionId: 'pr11485-probe',
      startTime: '2026-08-16T00:00:00.000Z',
      exportTime: EXPORTED_AT,
      cwd: '/workspace/project',
      gitRepo: 'qwen-code',
      gitBranch: 'feat/11478-split-export-transcript-css',
      model: 'qwen3-max',
      channel: 'cli',
      promptCount: 3,
      totalTokens: 1234,
      filesWritten: 1,
      linesAdded: 12,
      linesRemoved: 3,
      uniqueFiles: ['/workspace/project/build.mjs'],
    },
  },
  { rendererVersion: EXPORT_TRANSCRIPT_RENDERER_VERSION, exportedAt: EXPORTED_AT },
);

const blocks = [...doc.blocks];
const last = blocks[blocks.length - 1];
blocks.push({
  id: 'tool-diff', kind: 'tool', clientReceivedAt: 0, createdAt: 0, updatedAt: 0,
  toolCallId: 'diff-doc', title: 'Edit build.mjs', status: 'completed',
  toolName: 'edit', toolKind: 'edit',
  preview: {
    kind: 'file_diff', path: 'build.mjs',
    oldText: ['const DOCUMENT_RUNTIME_WARNING_BYTES = 4_100_000;', 'const MAX_DOCUMENT_RUNTIME_BYTES = 4_200_000;'].join('\n'),
    newText: ['const DOCUMENT_RUNTIME_WARNING_BYTES = 1_870_000;', 'const MAX_DOCUMENT_RUNTIME_BYTES = 1_930_000;'].join('\n'),
  },
  resultPreview: { kind: 'text', text: 'Applied 1 edit to build.mjs' },
});
blocks.push({
  id: 'tool-shell', kind: 'tool', clientReceivedAt: 0, createdAt: 0, updatedAt: 0,
  toolCallId: 'shell-doc', title: 'Rebuild the export renderer', status: 'completed',
  toolName: 'shell', toolKind: 'execute',
  preview: { kind: 'command', command: 'node src/export-html/build.mjs' },
  resultPreview: { kind: 'text', text: 'Document export renderer JS is 1833944 bytes; component CSS moved to export-transcript-document.css is 2302905 bytes' },
});
void last;

const html = renderExportTranscriptDocumentToHtml({ ...doc, blocks });
writeFileSync(out, html, 'utf8');
console.log(`wrote ${out} (${Buffer.byteLength(html)} bytes)`);
