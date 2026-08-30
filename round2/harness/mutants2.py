#!/usr/bin/env python3
"""Single-semantic mutants on PR #10357 head 90eb0a9a61; oracle = DingTalk suite."""
import subprocess, json, sys

TREE = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/d31f0d4a-0c2a-4996-ae34-b28a057efc3c/scratchpad/wt-head'
SCC = f'{TREE}/packages/channels/dingtalk/src/status-card-controller.ts'
ICC = f'{TREE}/packages/channels/dingtalk/src/interactive-card-client.ts'
ADP = f'{TREE}/packages/channels/dingtalk/src/DingtalkAdapter.ts'

# each mutant: (name, [(path, old, new), ...])
MUTANTS = [
 ('checkpoint: never attach content to the running heartbeat', [(SCC,
   """          ...(syncContent
            ? { content: sanitizeStreamingImageMarkers(record.content) }
            : {}),
""", "")]),
 ('checkpoint: interval 5s -> 7s', [(SCC,
   'const CONTENT_SYNC_INTERVAL_SECONDS = 5;',
   'const CONTENT_SYNC_INTERVAL_SECONDS = 7;')]),
 ('checkpoint: drop the lastContentSyncSecond advance', [(SCC,
   '      if (syncContent) record.lastContentSyncSecond = status.second;\n', '')]),
 ('classifier: no HTTP status is retryable', [(ICC,
   """  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status >= 500 && status <= 599)
  );""", '  return false;')]),
 ('stream retry: never schedule a retry after a transient failure', [(SCC,
   """      record.hasPendingWrite = true;
      this.scheduleStreamRetry(record);""",
   '      record.hasPendingWrite = true;')]),
 ('stream retry: drop the streamRetryAttempt reset on success', [(SCC,
   '        record.streamRetryAttempt = 0;\n', '')]),
 ('terminal retry: never retry a failed terminal write', [(SCC,
   """      if (isRetryableDingtalkCardError(error)) {
        this.scheduleTerminalRetry(record);
      } else {
        this.removeRecord(record);
      }""", '      this.removeRecord(record);')]),
 ('creation retry: never retry a transient creation failure', [(SCC,
   '        if (!(await this.waitForCreationRetry(record))) return false;',
   '        return false;')]),
 ('dispose: channel disconnect no longer disposes the controller', [(ADP,
   '    this.statusCardController?.dispose();\n', '')]),
 ('backoff: cap 30s -> 300s', [(SCC,
   'const MAX_RETRY_INTERVAL_MS = 30_000;',
   'const MAX_RETRY_INTERVAL_MS = 300_000;')]),
 # --- new in round 2: the a2211707e2 / bc35af3fc4 logic ---
 ('F1 regression: send the snapshot captured before `ready` (revert a2211707e2)', [(SCC,
   """    record.hasPendingWrite = false;
    let sentVersion: number | undefined;""",
   """    record.hasPendingWrite = false;
    const staleSnapshot = sanitizeStreamingImageMarkers(record.content);
    let sentVersion: number | undefined;"""),
  (SCC,
   """          content: sanitizeStreamingImageMarkers(record.content),
          finalize: false,""",
   """          content: staleSnapshot,
          finalize: false,""")]),
 ('dedup: drop the "already wrote the latest" clear', [(SCC,
   """      if (contentWritten && record.contentVersion === sentVersion) {
        record.hasPendingWrite = false;
      }
""", '')]),
 ('dedup: re-arm on any pending write (drop the version guard)', [(SCC,
   'if (record.hasPendingWrite && record.contentVersion !== sentVersion) {',
   'if (record.hasPendingWrite) {')]),
 ('version: never bump contentVersion when content changes', [(SCC,
   '    record.contentVersion++;\n', '')]),
 ('dedup: capture sentVersion after the write instead of before', [(SCC,
   """        sentVersion = record.contentVersion;
        await this.options.client.openOrUpdateStream({""",
   """        await this.options.client.openOrUpdateStream({""" ),
  (SCC,
   """        contentWritten = true;
        record.streamRetryAttempt = 0;""",
   """        sentVersion = record.contentVersion;
        contentWritten = true;
        record.streamRetryAttempt = 0;""")]),
]

def run_suite():
    p = subprocess.run(['npx','vitest','run','--root','packages/channels/dingtalk',
                        '--reporter','basic'], cwd=TREE, capture_output=True, text=True)
    out = p.stdout + p.stderr
    failed = [l.strip()[:160] for l in out.splitlines()
              if l.strip().startswith('×') or l.strip().startswith('FAIL')]
    return p.returncode, failed

results = []
for name, edits in MUTANTS:
    originals = {}
    ok = True
    for path, old, new in edits:
        if path not in originals:
            originals[path] = open(path).read()
    # apply sequentially on live file contents
    cur = {p: originals[p] for p in originals}
    for path, old, new in edits:
        if old not in cur[path]:
            ok = False; break
        cur[path] = cur[path].replace(old, new, 1)
    if not ok:
        results.append((name, 'SKIP (anchor not found)', [])); print(f'SKIP  {name}'); continue
    for path, text in cur.items(): open(path,'w').write(text)
    try:
        rc, failed = run_suite()
    finally:
        for path, text in originals.items(): open(path,'w').write(text)
    verdict = 'CAUGHT' if rc != 0 else 'SURVIVED'
    results.append((name, verdict, failed[:5]))
    print(f'{verdict:9} {name}' + (f'  ({len(failed)} failing)' if failed else ''), flush=True)
    for f in failed[:3]: print(f'            {f}', flush=True)

caught = sum(1 for _,v,_ in results if v=='CAUGHT')
print(f'\n{caught}/{len(results)} mutants caught')
json.dump([{'mutant':n,'verdict':v,'failures':f} for n,v,f in results],
          open(sys.argv[1] if len(sys.argv)>1 else 'mutants-v3.json','w'), indent=2)
