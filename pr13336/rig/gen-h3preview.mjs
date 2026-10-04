// Builds dist-h3preview/ beside dist/ in the head worktree: the shipped
// bundle with exactly two anchored edits that preview what H3 will do.
//   1. monitor_run joins MANAGED_SESSION_ENABLED_DOMAINS.
//   2. HostedTextDeltaStream.delta(): a streamed chunk equal to the trigger
//      commits one monitor_run Stage H revision through the same authority
//      (commitExtensionRecord, trusted_entry, as hosted-mcp-session does)
//      instead of committing text — so the Monitor revision lands between
//      two text deltas of one assistant message, from the Session's writer.
// Every anchor must match exactly once (fail closed).
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';

const HEAD = '/Users/wenshao/git/pr13336-head';
const out = `${HEAD}/dist-h3preview`;
if (existsSync(out)) rmSync(out, { recursive: true });
cpSync(`${HEAD}/dist`, out, { recursive: true });

function patch(file, anchor, replacement) {
  const path = `${out}/chunks/${file}`;
  const text = readFileSync(path, 'utf8');
  const count = text.split(anchor).length - 1;
  if (count !== 1) throw new Error(`${file}: anchor matched ${count} times`);
  writeFileSync(path, text.replace(anchor, replacement));
  console.log(`patched ${file}`);
}

patch(
  'chunk-QIWEMMYU.js',
  'var MANAGED_SESSION_ENABLED_DOMAINS=["goal_state","session_metadata","file_history","session_source","mcp_configuration","mcp_operation","hook_registration","hook_execution"];',
  'var MANAGED_SESSION_ENABLED_DOMAINS=["goal_state","session_metadata","file_history","session_source","mcp_configuration","mcp_operation","hook_registration","hook_execution","monitor_run"];',
);
patch(
  'server-TUISBGRB.js',
  'async delta(text){if(!text)return;',
  // The record's commandRef must name a real resource: the authority's HTTP
  // store commits a Stage H body's closure, so the args are published first.
  'async delta(text){if(!text)return;if(text===process.env.H3_PREVIEW_TRIGGER){const a=this.session.authority;const argsRef=await this.session.resources.publish("managed-tool-args",Buffer.from(JSON.stringify({monitor:"h3-preview"})));const record={...JSON.parse(process.env.H3_PREVIEW_MONITOR),commandRef:argsRef};const digest=Buffer.from(await globalThis.crypto.subtle.digest("SHA-256",Buffer.from(JSON.stringify(record)))).toString("hex");const receipt=await a.commitExtensionRecord({operation:"commitExtensionRecord",commandId:"monitor-preview-"+Date.now(),sessionKey:a.sessionHeader.sessionKey,contentDigest:digest},{domain:"monitor_run",record},{class:"trusted_entry"});process.stderr.write("[h3-preview] monitor_run revision committed at sequence "+receipt.receipt.firstSequence+"\\n");return;}',
);
