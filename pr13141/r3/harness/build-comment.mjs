// Build the PR comment body from report.md.
//
// Contract (verify-pr skill, local publish path): verdict line first, the
// collapsed Chinese summary immediately after, images referenced by the same
// kebab-case names the files carry. Report structure is preserved verbatim
// apart from swapping the H1 for the comment title used by rounds 1-2 and
// embedding each witness image at its first prose mention.
//
// Usage: node build-comment.mjs <artifactDir> <assetsSha> <outFile>
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const [art, sha, outFile] = process.argv.slice(2);
if (!art || !sha || !outFile)
  throw new Error('usage: build-comment.mjs <artifactDir> <assetsSha> <outFile>');

const RAW = `https://raw.githubusercontent.com/wenshao/qwen-code/${sha}/pr13141/r3`;
const TREE = `https://github.com/wenshao/qwen-code/tree/${sha}/pr13141/r3`;

let body = readFileSync(path.join(art, 'report.md'), 'utf8');

// H1 -> the comment title shape rounds 1 and 2 used.
const H1 = '# PR 13141 verification, round 3 — `docs(cli): correct Hosted Runtime Broker option help`\n';
if (!body.startsWith(H1)) throw new Error('report.md no longer starts with the expected H1');
body = body.slice(H1.length).replace(/^\n+/, '');

const title =
  '## Local verification, round 3: PR #13141 @ `2a702c316d`\n\n' +
  'Follows up on [round 1](https://github.com/QwenLM/qwen-code/pull/13141#issuecomment-5929521158) ' +
  '(`1e1f1970b3`) and [round 2](https://github.com/QwenLM/qwen-code/pull/13141#issuecomment-5931338773) ' +
  '(`c7eac4daf2`). The only new commit is a merge of `main`, and it is not inert — ' +
  'see *What changed since round 2*.\n\n';

// Embed each witness image after the line that first names it.
const images = readdirSync(path.join(art, 'evidence')).filter((f) => f.endsWith('.png')).sort();
const embedded = [];
for (const f of images) {
  const marker = '`' + f + '`';
  const i = body.indexOf(marker);
  if (i === -1) throw new Error(`image ${f} is never referenced in report.md`);
  const eol = body.indexOf('\n', i);
  const caption = f.replace(/^\d+-/, '').replace(/\.png$/, '').replaceAll('-', ' ');
  const embed = `\n\n![${caption}](${RAW}/${f})\n`;
  // A table row or a bullet cannot host a block image, so anchor to the end of
  // the surrounding block instead.
  const rest = body.slice(eol + 1);
  const blockEnd = rest.search(/^\s*$/m);
  const at = eol + 1 + (blockEnd === -1 ? rest.length : blockEnd);
  body = body.slice(0, at) + embed + body.slice(at);
  embedded.push(f);
}

const footer =
  '\n---\n\n' +
  `Evidence (harnesses, per-cell raw output, junit extracts, mutation ledger, this report): ` +
  `[\`assets-pr13141\` @ \`${sha.slice(0, 8)}\`, \`pr13141/r3/\`](${TREE})\n\n` +
  'Advisory evidence for human reviewers — not a review, an approval, or a merge decision.\n';

const out = title + body.trimEnd() + '\n' + footer;
writeFileSync(outFile, out);
console.log(`wrote ${outFile}: ${out.length} chars, ${embedded.length} images embedded`);
for (const f of embedded) console.log('  ' + f);
