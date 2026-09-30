const fs = require('fs'); const R = process.argv[2];
const get = (f) => { try { const l = fs.readFileSync(`${R}/${f}.log`, 'utf8').split('\n').filter((x) => x.startsWith('RESULT')).at(-1); return JSON.parse(l.slice(l.indexOf('{'))); } catch { return null; } };
const t = (x) => JSON.stringify(x);
const o = {};
let r = get('s1c-happy'); o.s1 = r && { run: r.runTerminal?.map((x) => x.stopReason), phase: r.phaseAtSecondModelRequest, models: r.modelRequests, blob: r.blob?.exact, conflict: r.conflict?.status, leaks: r.privateCatalog?.leaks?.length, detach: r.detach?.status, load: r.load };
r = get('s2-shared-workspace'); o.s2 = r && { B1: r.B1_while_A_attached?.admit, C1: r.C1_files_while_A_attached?.terminal?.[0]?.type, B2: r.B2_after_A_detach?.terminal?.[0]?.stopReason, C3: r.C3_after_B_detach?.terminal?.[0]?.stopReason };
r = get('s10-intent-close'); o.s10 = r && { replay: r.authorShape, B_detach_while_A: r.B_detach_while_A };
r = get('s16-quota'); o.s16 = r && { create17: r.a_create17?.status, b16reconf: r.b16?.explicitReconfigure?.status, b16after: r.b16?.afterNotify_text?.terminal, d15after: r.d15?.afterNotify_effect?.terminal };
for (const f of ['s3t-list-changed-tools', 's3r-list-changed-resources']) { r = get(f); o[f] = r && { kind: r.kind, notify: r.notifyTerminal?.map((x) => x.stopReason), later: r.laterTerminal?.map((x) => x.stopReason) }; }
r = get('s4-cancel'); o.s4 = r && { cancel: r.cancelResponse?.status + ':' + (r.cancelResponse?.body?.state ?? r.cancelResponse?.body?.code), post: r.operationPostResponse?.body?.state, detach: r.detach?.status, reload: r.reload?.status };
r = get('s5-cancel'); o.s5 = r && { cancel: r.promptCancel?.status, slow: r.slowTurn?.terminal?.map((x) => x.stopReason), next: r.nextPrompt?.terminal?.map((x) => x.stopReason), detach: r.detach?.status };
for (const f of ['s6-cancel', 's6b-cancel']) { r = get(f); o[f] = r && { at: r.slowTurn?.at, slow: r.slowTurn?.terminal?.map((x) => x.stopReason), detach: r.detach?.status }; }
r = get('s8b-quotas'); o.s8 = r && { reconf: r['reconfigure(rev:status:liveStdioProcs)']?.slice(-1), procsAfter: r.detach?.procsAfter, many: r.manyAdvertised, big: String(r.bigReceipt).includes('managed_mcp_output_limit') };
r = get('s11-replace'); o.s11 = r && { replace: r.replaceDuringCall?.status, slow: r.slowTurn?.map((x) => x.stopReason), after: r.afterTurn?.map((x) => x.stopReason), detach: r.detach };
r = get('s19-duplicate-reply'); o.s19 = r && { gen: [r.genBefore, r.genAfter], starts: [r.stdioStartsBefore, r.stdioStartsAfter], dup: r.duplicateSent };
r = get('s20-busy-owner-cleanup'); o.s20 = r && { B_prompt: r.B_prompt?.admit, B_detach: r.B_detach, holderUnchanged: r.holderUnchanged, A2: r.A2_after_B_detach?.terminal, A_detach: r.A_detach, C_after: r.C_files_after_A?.file };
r = get('s17f-discover-503-r7'); o.s17 = r && { faulted: r.faultedTurn?.terminal, next: r.nextTurn?.terminal, load: r.load, afterLoad: r.afterLoad?.terminal };
r = get('s21b-hung-raw-op'); o.s21 = r && { burst: r.t3s?.statusBurst3, cancel: r.cancel?.result, prompt: r.t3s?.prompt, detach: r.t3s?.detach };
r = get('s9-recovery'); o.s9 = r && { op: r.opWithTwoLostReplies?.state, effects: r.opWithTwoLostReplies?.physicalEffects, closeAfterRevoke: r.closeAfterRevoke?.status, lease: r.leaseAfterRevokeClose };
r = get('s7-outage'); o.s7sse = r && { after: r.afterRestart?.map((x) => x.stopReason), detach: r.detach?.status };
r = get('s7h-http-down-close'); o.s7h = r && { detach: r.detach?.status, lease: r.lease };
r = get('s23a-make-orphan'); o.s23a = r;
for (const [k, v] of Object.entries(o)) console.log(k.padEnd(28), t(v));
