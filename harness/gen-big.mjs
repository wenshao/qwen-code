// Large exported transcript: enough inline JSON in <body> that Chromium's HTML
// parser yields between <head> and the body script.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = process.argv[2], out = process.argv[3];
const blocks = Number(process.argv[4] || 900);
const { createExportTranscriptDocumentV1 } = await import(resolve(root,'packages/cli/dist/src/ui/utils/export/export-transcript-document.js'));
const { renderExportTranscriptDocumentToHtml } = await import(resolve(root,'packages/cli/dist/src/ui/utils/export/formatters/html.js'));
const { EXPORT_TRANSCRIPT_RENDERER_VERSION } = await import(resolve(root,'packages/web-templates/dist/index.js'));
const EXPORTED_AT='2026-08-16T01:00:00.000Z';
const RICH=[
  '## Split-CSS render probe',
  '',
  '| Asset | Bytes |',
  '| --- | ---: |',
  '| renderer JS | 1,833,944 |',
  '| component CSS | 2,302,905 |',
  '',
  '```ts',
  'const MAX_DOCUMENT_RUNTIME_BYTES = 1_930_000;',
  '```',
  '',
  'Inline math: $E=mc^2$',
  '',
  '> A blockquote, for the border and muted-foreground tokens.',
].join('\n');
const records=[];
for(let i=0;i<blocks;i++){
  records.push({uuid:`r${i}`,parentUuid:i?`r${i-1}`:null,sessionId:'big',timestamp:'2026-08-16T00:00:00.000Z',cwd:'/workspace/project',version:'test',type:i%2?'assistant':'user',
    message:{role:i%2?'model':'user',parts:[{text: i===1 ? RICH : (i===0 ? 'Show me the render surface.' : `block-${i} `+'x'.repeat(7900))}]}});
}
const doc=createExportTranscriptDocumentV1(records,{startTime:'2026-08-16T00:00:00.000Z',metadata:{sessionId:'big',startTime:'2026-08-16T00:00:00.000Z',exportTime:EXPORTED_AT,cwd:'/workspace/project',promptCount:blocks,uniqueFiles:[]}},{rendererVersion:EXPORT_TRANSCRIPT_RENDERER_VERSION,exportedAt:EXPORTED_AT});
const html=renderExportTranscriptDocumentToHtml(doc);
writeFileSync(out,html,'utf8');
console.log(`wrote ${out} (${Buffer.byteLength(html)} bytes)`);
