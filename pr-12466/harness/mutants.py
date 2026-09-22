import os, re, shutil, json, sys
src = open('session-tool-calls.ts').read()
test = open('session-tool-calls.test.ts').read()
M = {
 'm01_no_break_at_next_prompt': ("          nextPrompt = true;\n          break;", "          nextPrompt = true;"),
 'm02_never_close_selection': ("selectionClosed = true;", "void 0;"),
 'm03_own_every_call': ("transcript?.sourceRecordIds?.some((id) => ownedRecordIds.has(id))", "true"),
 'm04_finalize_always': ("finalizeDangling: nextPrompt || (!activeBeforeRead && !hasActivePrompt()),", "finalizeDangling: true,"),
 'm05_finalize_never': ("finalizeDangling: nextPrompt || (!activeBeforeRead && !hasActivePrompt()),", "finalizeDangling: false,"),
 'm06_accept_partial_replay': ("if (replay.partial || replay.replayError) {", "if (false) {"),
 'm07_no_scan_byte_budget': ("      if (retainedBytes > maxBytes) {\n        throw new SessionToolCallsLimitError(", "      if (false) {\n        throw new SessionToolCallsLimitError("),
 'm08_no_response_byte_budget': ("    if (retainedBytes > maxBytes) {\n      throw new SessionTranscriptPageTooLargeError(", "    if (false) {\n      throw new SessionTranscriptPageTooLargeError("),
 'm09_keep_agent_content': ("output.type === 'task_execution'", "false"),
 'm10_no_anchor_check': ("if (!cursor && !page.records.some((record) => record.uuid === turnId)) {", "if (false) {"),
 'm11_no_session_check': ("if (page.records.some((record) => record.sessionId !== sessionId)) {", "if (false) {"),
 'm12_no_cursor_repeat_check': ("if (cursors.has(cursor)) {", "if (false) {"),
 'm13_drop_timing_frames': ("timing?.['kind'] === 'tool' &&", "false &&"),
 'm14_realtime_ends_scan': ("record.subtype !== 'realtime_message' &&\n", ""),
 'm15_ignore_active_before_read': ("(!activeBeforeRead && !hasActivePrompt())", "(!hasActivePrompt())"),
 'm16_unbounded_pages': ("pageNumber < 100;", "pageNumber < 100000;"),
 'm17_no_incomplete_check': ("if (!complete || !lastPage) throw new SessionToolCallsLimitError();", "if (!lastPage) throw new SessionToolCallsLimitError();"),
 'm18_all_user_anchors': ("transcript?.sourceRecordIds?.includes(turnId)", "true"),
}
root = '__mut__'
shutil.rmtree(root, ignore_errors=True)
fix = lambda s: s.replace("'../acp-integration/", "'../../../acp-integration/")
for name, (a, b) in [('m00_control', ('', ''))] + list(M.items()):
    d = os.path.join(root, name); os.makedirs(d)
    body = src
    if a:
        n = body.count(a); assert n == 1, (name, n)
        body = body.replace(a, b)
    open(os.path.join(d, 'session-tool-calls.ts'), 'w').write(fix(body))
    open(os.path.join(d, 'session-tool-calls.test.ts'), 'w').write(fix(test))
print(len(M), 'mutants + control')
