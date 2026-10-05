// Usage: node line-check.mjs <label> <worktree> <jsonl> — run every persisted
// line through the reader's own line parser (the function the HTTP Session
// Store replay and the local log scan both call).
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const [label, wt, file] = process.argv.slice(2);
const { parseManagedSessionRecordJson, parseManagedSessionEvent, MANAGED_SESSION_LIMITS } = await import(
  pathToFileURL(path.join(wt, 'packages/core/dist/src/managed-runtime/managed-session-records.js')).href);
fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).forEach((line, i) => {
  const o = JSON.parse(line);
  let nest = 0, max = 0, s = false, e = false;
  for (const c of line) { if (s) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') s = false; continue; }
    if (c === '"') s = true; else if (c === '{' || c === '[') max = Math.max(max, ++nest); else if (c === '}' || c === ']') nest--; }
  let ev = '';
  if (o.managedSession?.kind) { try { parseManagedSessionEvent(o.managedSession); ev = 'event-parse ACCEPT'; } catch (x) { ev = `event-parse REJECT ${x.message.slice(0, 60)}`; } }
  let rec;
  try { parseManagedSessionRecordJson(line, MANAGED_SESSION_LIMITS.maxEventBytes); rec = 'line-parse ACCEPT'; } catch (x) { rec = `line-parse REJECT ${x.message}`; }
  console.log(`RESULT\t${label}\tline ${i + 1}\t${o.subtype}${o.managedSession?.kind ? ' ' + o.managedSession.kind : ''}\tnesting=${max}\t${ev}\t${rec}`);
});
