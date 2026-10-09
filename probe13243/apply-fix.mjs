// PR #13243 R4-3 fix arm: apply the review's suggested change (convert inside a
// try, arm moduleEvaluationPending after) to the head runtime; exit 1 if the
// anchor is missing so the arm can never run unpatched.
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'packages/cli/src/serve/managed-hook-runtime.ts';
const source = readFileSync(file, 'utf8');
const anchor =
  '    entry.moduleEvaluationPending = true;\n    import(pathToFileURL(modulePath).href)\n';
const replacement = [
  '    let href: string;',
  '    try {',
  '      href = pathToFileURL(modulePath).href;',
  '    } catch (cause) {',
  '      finish(cause instanceof Error ? cause : new Error(String(cause)));',
  '      return;',
  '    }',
  '    entry.moduleEvaluationPending = true;',
  '    import(href)',
  '',
].join('\n');
const normalized = source.replace(/\r\n/g, '\n');
if (normalized.split(anchor).length !== 2) {
  console.error('FIX-NOT-APPLIED');
  process.exit(1);
}
writeFileSync(file, normalized.replace(anchor, replacement));
console.log('fix applied');
