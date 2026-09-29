#!/usr/bin/env python3
"""Hand-written mutation matrix for PR #9466 (run inside the head worktree).

Each mutant: (id, package, file, old, new, test files). The runner asserts
the old string occurs exactly once, applies the edit, runs the targeted test
files with the JSON reporter, restores the original bytes, and records the
failed-test count. A mutant is KILLED when >= 1 test fails.
"""
import json, os, subprocess, sys, shutil, time

ROOT = '/root/verify/pr9466/head'
OUT = '/root/verify/pr9466/mutation'
os.makedirs(OUT, exist_ok=True)

CORE_T = {
    'llm': ['src/core/llm-chat.test.ts'],
    'client': ['src/core/client.test.ts'],
    'rec': ['src/services/chatRecordingService.test.ts'],
    'fh': ['src/services/fileHistoryService.test.ts'],
    'ss': ['src/services/sessionService.test.ts'],
}
CLI_HM = ['src/ui/utils/historyMapping.test.ts', 'src/ui/AppContainer.test.tsx']

M = [
  # --- CLI: resolution rule -------------------------------------------------
  ('M01', 'cli', 'src/ui/utils/historyMapping.ts',
   "  if (isRealUserTurn(target) && target.promptId) {",
   "  if (false && isRealUserTurn(target) && target.promptId) {",
   CLI_HM, 'identity branch removed (always positional)'),
  ('M02', 'cli', 'src/ui/utils/historyMapping.ts',
   "          index !== targetIndex &&\n          index >= retainedStart &&",
   "          false &&\n          index >= retainedStart &&",
   CLI_HM, 'UI duplicate-identity census removed'),
  ('M03', 'cli', 'src/ui/utils/historyMapping.ts',
   "          index >= retainedStart &&\n",
   "",
   CLI_HM, 'census not scoped to retained region'),
  ('M04', 'cli', 'src/ui/utils/historyMapping.ts',
   "    return findApiHistoryPromptIndex(apiHistory, target.promptId, startIndex);",
   "    { const i = findApiHistoryPromptIndex(apiHistory, target.promptId, startIndex); if (i !== -1) return i; }",
   CLI_HM, 'fall through to positional when identity lookup fails'),
  ('M05', 'cli', 'src/ui/utils/historyMapping.ts',
   "  return targetIndex > findLastSuccessfulCompressionIndex(uiHistory);",
   "  return false;",
   CLI_HM, 'refusal cause: always "compressed" message'),
  # --- CLI: identity carriers ----------------------------------------------
  ('M06', 'cli', 'src/ui/commands/restoreCommand.ts',
   "        markApiHistoryPrompt(content, promptIds[index]);",
   "        void content; void index;",
   ['src/ui/commands/restoreCommand.test.ts'], '/restore re-mark removed'),
  ('M07', 'cli', 'src/ui/hooks/use-llm-stream.ts',
   "                  ...(promptIds?.some(Boolean) ? { promptIds } : {}),",
   "",
   ['src/ui/hooks/use-llm-stream.test.tsx'], 'checkpoint writer drops promptIds'),
  ('M08', 'cli', 'src/ui/hooks/use-llm-stream.ts',
   "              submitType === SendMessageType.UserQuery ? prompt_id : undefined,",
   "              prompt_id,",
   ['src/ui/hooks/use-llm-stream.test.tsx'], 'slash submit_prompt identity for every submit type (Cron too)'),
  ('M09', 'cli', 'src/ui/utils/resumeHistoryUtils.ts',
   "            items.push({\n              type: 'user',\n              text,\n              ...(promptId ? { promptId } : {}),\n            });\n          }\n\n          const toolDisplays",
   "            items.push({\n              type: 'user',\n              text,\n            });\n          }\n\n          const toolDisplays",
   ['src/ui/utils/resumeHistoryUtils.test.ts'], 'resumed prompt-payload user item loses promptId'),
  ('M10', 'cli', 'src/ui/utils/resumeHistoryUtils.ts',
   "        if (text) {\n          items.push({\n            type: 'user',\n            text,\n            ...(promptId ? { promptId } : {}),\n          });\n        }\n        break;",
   "        if (text) {\n          items.push({\n            type: 'user',\n            text,\n          });\n        }\n        break;",
   ['src/ui/utils/resumeHistoryUtils.test.ts'], 'resumed plain user item loses promptId'),
  ('M11', 'cli', 'src/ui/utils/resumeHistoryUtils.ts',
   "  return Math.max(\n    userTurnCount,\n    computeInitialTurnFromHistory(records, sessionId) + 1,\n  );",
   "  return userTurnCount;",
   ['src/ui/utils/resumeHistoryUtils.test.ts', 'src/ui/hooks/useResumeCommand.test.ts', 'src/ui/hooks/useBranchCommand.test.ts', 'src/ui/AppContainer.test.tsx'],
   'resume seed reverted to user-record count (main behaviour)'),
  ('M12', 'cli', 'src/ui/hooks/useResumeCommand.ts',
   "        seedPromptCount(\n          computeResumedPromptCountSeed(\n            sessionData.conversation.messages,\n            sessionId,\n          ),\n        );",
   "",
   ['src/ui/hooks/useResumeCommand.test.ts'], '/resume does not seed the counter'),
  ('M13', 'cli', 'src/ui/hooks/useBranchCommand.ts',
   "        seedPromptCount(\n          computeResumedPromptCountSeed(\n            resumed.conversation.messages,\n            newSessionId,\n          ),\n        );",
   "",
   ['src/ui/hooks/useBranchCommand.test.ts'], '/branch does not seed the counter'),
  ('M14', 'cli', 'src/ui/opentui/live-session.ts',
   "    promptCount = Math.max(\n      promptCount,\n      computeInitialTurnFromHistory(resumedRecords, sessionId) + 1,\n    );",
   "    void promptCount;",
   ['src/ui/opentui/live-session.test.ts'], 'OpenTUI counter not seeded from resumed transcript'),
  ('M15', 'cli', 'src/ui/hooks/slashCommandProcessor.ts',
   "            updateItem(invocationItemId, {\n              sentToModel: true,\n              ...(invocationPromptId ? { promptId: invocationPromptId } : {}),\n            });",
   "            updateItem(invocationItemId, {\n              sentToModel: true,\n            });",
   ['src/ui/hooks/slashCommandProcessor.test.ts'], 'slash submit_prompt item not stamped with identity'),
  ('M16', 'cli', 'src/acp-integration/session/Session.ts',
   "                  : undefined,\n                promptId,\n                daemonPromptId,\n              );\n            }",
   "                  : undefined,\n                undefined,\n                daemonPromptId,\n              );\n            }",
   ['src/acp-integration/session/Session.test.ts'], 'ACP prompt record loses promptId'),
  # --- core -------------------------------------------------------------------
  ('M17', 'core', 'src/core/llm-chat.ts',
   "      markApiHistoryPrompt(userContent, options?.promptId);",
   "",
   CORE_T['llm'], 'user content never marked in model history'),
  ('M18', 'core', 'src/core/llm-chat.ts',
   "          compressedHistory: [...this.getHistoryShallow(), userContent],",
   "          compressedHistory: this.getHistoryShallow(),",
   CORE_T['llm'], 'hard-tier compression record omits pending question'),
  ('M19', 'core', 'src/core/llm-chat.ts',
   "          compressedHistory: options?.pendingUserMessage\n            ? [...newHistory, options.pendingUserMessage]\n            : newHistory,",
   "          compressedHistory: newHistory,",
   CORE_T['llm'], 'compression record omits pendingUserMessage'),
  ('M20', 'core', 'src/core/client.ts',
   "        messageType === SendMessageType.UserQuery ? prompt_id : undefined,",
   "        prompt_id,",
   CORE_T['client'], 'every message type (Retry/Cron/Notification) marks identity'),
  ('M21', 'core', 'src/core/client.ts',
   "            userPromptRecordPayload,\n            prompt_id,\n          );",
   "            userPromptRecordPayload,\n            undefined,\n          );",
   CORE_T['client'], 'user record written without promptId'),
  ('M22', 'core', 'src/services/fileHistoryService.ts',
   "    if (matches > 1) {",
   "    if (matches > 99) {",
   CORE_T['fh'], 'duplicate snapshot-key guard removed'),
  ('M23', 'core', 'src/services/chatRecordingService.ts',
   "          ...(promptIds.some(Boolean) ? { promptIds } : {}),",
   "",
   CORE_T['rec'], 'compression record drops promptIds'),
  ('M24', 'core', 'src/services/chatRecordingService.ts',
   "      const compressedHistory = [...payload.compressedHistory];",
   "      const compressedHistory = payload.compressedHistory;",
   CORE_T['rec'], 'compression snapshot shares the live array'),
  ('M25', 'core', 'src/services/chatRecordingService.ts',
   "        ...(promptId ? { promptId } : {}),\n      };\n      this.appendRecord(record);",
   "      };\n      this.appendRecord(record);",
   CORE_T['rec'], 'recordUserMessage drops promptId'),
  ('M26', 'core', 'src/services/session-api-history.ts',
   "  if (record.type === 'user' && !record.subtype) {\n    markApiHistoryPrompt(message, record.promptId);\n  }",
   "",
   CORE_T['ss'], 'resume rebuild does not mark user entries'),
  ('M27', 'core', 'src/services/session-api-history.ts',
   "            markApiHistoryPrompt(copy, payload.promptIds?.[index]);",
   "",
   ['src/services', 'src/core/llm-chat.test.ts', 'src/core/client.test.ts'], 'resume from compression snapshot does not re-mark'),
  ('M28', 'core', 'src/services/session-api-history.ts',
   "    if (match !== -1) return -1;",
   "    if (match !== -1) return match;",
   ['src/services', 'src/core/llm-chat.test.ts', 'src/core/client.test.ts'], 'API-side duplicate mark resolves to first'),
  ('M29', 'core', 'src/services/sessionService.ts',
   "          ...(typeof record.promptId === 'string'\n            ? {\n                promptId: remapForkPromptId(\n                  record.promptId,\n                  sourceSessionId,\n                  newSessionId,\n                ),\n              }\n            : {}),",
   "",
   CORE_T['ss'], 'fork keeps source-session record identities'),
  ('M30', 'core', 'src/services/sessionService.ts',
   "  if (record.subtype === 'chat_compression') {",
   "  if (record.subtype === 'chat_compression_DISABLED') {",
   CORE_T['ss'], 'fork does not remap compression promptIds'),
  ('M31', 'core', 'src/core/client.ts',
   "    const currentHistory =\n      this.getChat().getHistoryShallow?.() ?? this.getChat().getHistory();\n    const startupLength",
   "    const currentHistory = this.getChat().getHistory();\n    const startupLength",
   CORE_T['client'], 'startup-context refresh deep-clones (drops Symbol ids)'),
]

only = set(sys.argv[1:])
results = []
for (mid, pkg, rel, old, new, tests, desc) in M:
    if only and mid not in only:
        continue
    pkgdir = os.path.join(ROOT, 'packages', pkg)
    path = os.path.join(pkgdir, rel)
    src = open(path, encoding='utf-8').read()
    n = src.count(old)
    if n != 1:
        results.append({'id': mid, 'desc': desc, 'status': f'NOT-APPLIED(count={n})'})
        print(mid, 'NOT APPLIED', n, flush=True)
        continue
    backup = path + '.mutbak'
    shutil.copy2(path, backup)
    try:
        with open(path + '.tmp', 'w', encoding='utf-8') as f:
            f.write(src.replace(old, new))
        os.replace(path + '.tmp', path)
        out = os.path.join(OUT, f'{mid}.json')
        t0 = time.time()
        p = subprocess.run(['npx', 'vitest', 'run', *tests, '--reporter=json', f'--outputFile={out}'],
                           cwd=pkgdir, env={**os.environ, 'CI': 'true'}, capture_output=True, text=True)
        dt = time.time() - t0
        try:
            d = json.load(open(out))
            failed = d['numFailedTests']; total = d['numTotalTests']
            failing = [a['fullName'] for tr in d['testResults'] for a in tr['assertionResults'] if a['status'] == 'failed'][:6]
            suite_err = [tr.get('message', '')[:200] for tr in d['testResults'] if tr.get('status') == 'failed' and not tr['assertionResults']]
        except Exception as e:
            failed, total, failing, suite_err = None, None, [], [f'no json: {e}; rc={p.returncode}; {p.stderr[-300:]}']
        status = 'KILLED' if (failed or suite_err) else 'SURVIVED'
        results.append({'id': mid, 'desc': desc, 'file': f'{pkg}/{rel}', 'status': status, 'failed': failed, 'total': total, 'failing': failing, 'suiteErrors': suite_err, 'secs': round(dt)})
        print(mid, status, failed, '/', total, desc, flush=True)
    finally:
        os.replace(backup, path)

prev = []
rp = os.path.join(OUT, 'results.json')
if only and os.path.exists(rp):
    prev = [r for r in json.load(open(rp)) if r['id'] not in only]
json.dump(sorted(prev + results, key=lambda r: r['id']), open(rp, 'w'), indent=2)
