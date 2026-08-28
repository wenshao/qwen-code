#!/usr/bin/env python3
"""Applies single-hunk mutants to the PR head and reports whether the DingTalk
suite catches them (does the new test coverage actually pin the new behaviour?)."""
import subprocess
import sys

TREE = '/Users/wenshao/git/qwen-10357'
SCC = f'{TREE}/packages/channels/dingtalk/src/status-card-controller.ts'
ICC = f'{TREE}/packages/channels/dingtalk/src/interactive-card-client.ts'
ADP = f'{TREE}/packages/channels/dingtalk/src/DingtalkAdapter.ts'

MUTANTS = [
    ('checkpoint: never attach content to the running heartbeat', SCC,
     """          ...(syncContent
            ? { content: sanitizeStreamingImageMarkers(record.content) }
            : {}),
""", ""),
    ('checkpoint: interval 5s -> 7s', SCC,
     'const CONTENT_SYNC_INTERVAL_SECONDS = 5;',
     'const CONTENT_SYNC_INTERVAL_SECONDS = 7;'),
    ('checkpoint: drop the lastContentSyncSecond advance', SCC,
     '      if (syncContent) record.lastContentSyncSecond = status.second;\n', ''),
    ('classifier: no HTTP status is retryable', ICC,
     """  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status >= 500 && status <= 599)
  );""", '  return false;'),
    ('stream retry: never schedule a retry after a transient failure', SCC,
     """      record.pendingSnapshot = sanitizeStreamingImageMarkers(record.content);
      this.scheduleStreamRetry(record);""",
     '      record.pendingSnapshot = sanitizeStreamingImageMarkers(record.content);'),
    ('stream retry: drop the streamRetryAttempt reset on success', SCC,
     '        record.streamRetryAttempt = 0;\n', ''),
    ('terminal retry: never retry a failed terminal write', SCC,
     """      if (isRetryableDingtalkCardError(error)) {
        this.scheduleTerminalRetry(record);
      } else {
        this.removeRecord(record);
      }""", '      this.removeRecord(record);'),
    ('creation retry: never retry a transient creation failure', SCC,
     '        if (!(await this.waitForCreationRetry(record))) return false;',
     '        return false;'),
    ('dispose: channel disconnect no longer disposes the controller', ADP,
     '    this.statusCardController?.dispose();\n', ''),
    ('backoff: cap 30s -> 300s', SCC,
     'const MAX_RETRY_INTERVAL_MS = 30_000;',
     'const MAX_RETRY_INTERVAL_MS = 300_000;'),
]


def run_suite():
    p = subprocess.run(
        ['npx', 'vitest', 'run', '--root', 'packages/channels/dingtalk',
         '--reporter', 'basic'],
        cwd=TREE, capture_output=True, text=True)
    out = p.stdout + p.stderr
    failed = []
    for line in out.splitlines():
        s = line.strip()
        if s.startswith('×') or s.startswith('FAIL'):
            failed.append(s[:150])
    return p.returncode, failed


results = []
for name, path, old, new in MUTANTS:
    src = open(path).read()
    if old not in src:
        results.append((name, 'SKIP (anchor not found)', []))
        print(f'SKIP  {name}')
        continue
    open(path, 'w').write(src.replace(old, new, 1))
    try:
        rc, failed = run_suite()
    finally:
        open(path, 'w').write(src)
    verdict = 'CAUGHT' if rc != 0 else 'SURVIVED'
    results.append((name, verdict, failed[:4]))
    print(f'{verdict:9} {name}' + (f'  ({len(failed)} failing)' if failed else ''))
    for f in failed[:3]:
        print(f'            {f}')

print()
caught = sum(1 for _, v, _ in results if v == 'CAUGHT')
print(f'{caught}/{len(results)} mutants caught')
import json
json.dump([{'mutant': n, 'verdict': v, 'failures': f} for n, v, f in results],
          open('mutants.json', 'w'), indent=2)
