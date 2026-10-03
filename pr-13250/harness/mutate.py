#!/usr/bin/env python3
"""Targeted mutation matrix over the PR's routing, anchor and flush-chain ownership gates.

Each mutant is one minimal edit to packages/channels/qqbot/src/{QQChannel,index}.ts, written to
src/__mut__/<id>/ next to an unmutated copy of every other source + test file, plus an
unmutated control m00. One vitest run executes all of them; a mutant is KILLED when at least
one test in its directory fails. The directory is deleted afterwards and `git status` checked.
"""
import json, os, shutil, subprocess, sys

PKG = '/root/verify/pr13250/head/packages/channels/qqbot'
SRC = os.path.join(PKG, 'src')
MUT = os.path.join(SRC, '__mut__')
OUT = '/root/verify/pr13250/harness/runs/mutation'

# (id, gate, file, old, new)  -- `old` must occur exactly once
MUTANTS = [
    ('m01', 'routing: plugin default scope (defaultSessionScope: thread) removed', 'index.ts',
     "  defaultSessionScope: 'thread',\n", ''),
    ('m02', 'routing: constructor forces sessionScope single again (the removed override)', 'QQChannel.ts',
     "        `[QQ:${name}] WARNING: groupAllPolicy is '${qqCfg.groupAllPolicy}' but sessionScope is '${config.sessionScope}' (not a shared-context scope).",
     "        `[QQ:${name}] WARNING: groupAllPolicy is '${qqCfg.groupAllPolicy}' but sessionScope is '${config.sessionScope}' (not a shared-context scope)." ),
    ('m03', 'startup warning: operators-empty check inverted', 'QQChannel.ts',
     "      (config.operators ?? []).length === 0\n", "      (config.operators ?? []).length !== 0\n"),
    ('m04', 'anchor: onPromptStart no longer captures envelope.messageId', 'QQChannel.ts',
     "    this.releaseSessionReplyAnchor(sessionId);\n    if (messageId) {", "    this.releaseSessionReplyAnchor(sessionId);\n    if (messageId && false) {"),
    ('m05', 'generation: onPromptStart does not bump turnCounter', 'QQChannel.ts',
     "    const turn = (this.turnCounter.get(sessionId) ?? 0) + 1;\n    this.turnCounter.set(sessionId, turn);",
     "    const turn = this.turnCounter.get(sessionId) ?? 1;\n    this.turnCounter.set(sessionId, turn);"),
    ('m06', 'completedTurns: onPromptStart keeps the previous turn\'s completion record', 'QQChannel.ts',
     "    // own, so this clear is the only guard against that alias.\n    this.completedTurns.delete(sessionId);",
     "    // own, so this clear is the only guard against that alias.\n"),
    ('m07', 'orphan stash: onPromptStart keeps a dead stash (no dropOrphanStash)', 'QQChannel.ts',
     "    const stashed = this.streamOrphanBuffer.get(sessionId);\n    if (stashed) {\n      this.dropOrphanStash(sessionId, stashed);\n    }",
     "    const stashed = this.streamOrphanBuffer.get(sessionId);\n    if (stashed && false) {\n      this.dropOrphanStash(sessionId, stashed);\n    }"),
    ('m08', 'anchor release: expectedMsgId identity gate removed', 'QQChannel.ts',
     "    } else if (current !== undefined && current.msgId === expectedMsgId) {",
     "    } else if (true) {"),
    ('m09', 'msg_seq reclaim: in-flight anchored sends not counted as holders', 'QQChannel.ts',
     "    if ((this.inFlightMsgSeqSends.get(msgId) ?? 0) > 0) return true;\n", ''),
    ('m10', 'msg_seq reclaim: routing-map holder dropped (return false)', 'QQChannel.ts',
     "    return this.replyContextByMessageId.has(msgId);\n  }", "    return false;\n  }"),
    ('m11', 'ownership: ownsLiveTurn always true', 'QQChannel.ts',
     "    return state.turn === (this.turnCounter.get(sessionId) ?? 0);\n  }\n\n  /**\n   * Hand a doomed",
     "    return true;\n  }\n\n  /**\n   * Hand a doomed"),
    ('m12', 'flushingSessions: superseded chain may release the successor\'s marker', 'QQChannel.ts',
     "        if (this.flushingSessions.get(sessionId) !== state) return;\n        this.flushingSessions.delete(sessionId);",
     "        this.flushingSessions.delete(sessionId);"),
    ('m13', 'flushingSessions: hand-off guard removed (double delivery path)', 'QQChannel.ts',
     "      if (this.flushingSessions.get(sessionId) !== state) {\n        this.handOffSealedPre(state, sessionId);\n      }",
     "      this.handOffSealedPre(state, sessionId);"),
    ('m14', 'completedTurns: onResponseComplete no longer records the completion', 'QQChannel.ts',
     "    this.completedTurns.set(sessionId, currentTurn);\n", ''),
    ('m15', 'completedTurns: completionAlreadyRan forced false', 'QQChannel.ts',
     "    const completionAlreadyRan =\n      this.completedTurns.get(sessionId) === taggedTurn;",
     "    const completionAlreadyRan = false;"),
    ('m16', "boundary: never upgrades to 'residual'", 'QQChannel.ts',
     "    if (flushing === state && liveResidual !== undefined) {\n      flushing.boundaryClearedInFlight = 'residual';",
     "    if (false) {\n      flushing.boundaryClearedInFlight = 'residual';"),
    ('m17', 'boundary: cleared-in-flight seal skipped in the permanent-failure arm', 'QQChannel.ts',
     "          if (\n            state.boundaryClearedInFlight !== undefined &&\n            this.ownsLiveTurn(sessionId, state)\n          ) {",
     "          if (\n            false &&\n            this.ownsLiveTurn(sessionId, state)\n          ) {"),
    ('m18', 'pendingStreamDelete: onPromptEnd tears down under a parked deferred chain', 'QQChannel.ts',
     "    if (this.pendingStreamDelete.has(sessionId)) {\n      // Deferred completion (or a cancelled turn's flush below) owns the",
     "    if (false) {\n      // Deferred completion (or a cancelled turn's flush below) owns the"),
    ('m19', 'cancel: onPromptEnd drops a parked turn\'s stash instead of delivering it', 'QQChannel.ts',
     "      this.streamOrphanBuffer.delete(sessionId);\n      void this.deliverCancelledStash(chatId, sessionId, parkedStash.text);",
     "      this.streamOrphanBuffer.delete(sessionId);"),
    ('m20', 'cancel: onPromptEnd ignores the stashed HEAD of a cancelled turn', 'QQChannel.ts',
     "    const stashed = this.streamOrphanBuffer.get(sessionId);\n    if (stashed) {\n      if (stashed.turn === (this.turnCounter.get(sessionId) ?? 0)) {",
     "    const stashed = this.streamOrphanBuffer.get(sessionId);\n    if (stashed && false) {\n      if (stashed.turn === (this.turnCounter.get(sessionId) ?? 0)) {"),
    ('m21', 'cancel: onPromptEnd does not defer to an in-flight send', 'QQChannel.ts',
     "    if (state && this.flushingSessions.has(sessionId)) {\n      this.pendingStreamDelete.add(sessionId);\n      return;\n    }",
     "    if (false) {\n      this.pendingStreamDelete.add(sessionId);\n      return;\n    }"),
    ('m22', 'bridge boundary seal listener is a no-op', 'QQChannel.ts',
     "    this.sealOrphanStash(sessionId);\n    // Ungated: ChannelBase suppresses",
     "    return;\n    this.sealOrphanStash(sessionId);\n    // Ungated: ChannelBase suppresses"),
    ('m23', 'purge: opt-in gate removed (purges by default)', 'QQChannel.ts',
     "      if (doomed.length > 0 && this.qqConfig.purgeLegacySessions !== true) {",
     "      if (false) {"),
    ('m24', 'purge: knownScope fail-closed guard removed', 'QQChannel.ts',
     "    const knownScope =\n      scope === 'user' ||",
     "    const knownScope =\n      true ||"),
    ('m25', 'purge: sibling-channel ownership check removed', 'QQChannel.ts',
     "          scope !== 'user' &&\n          entry.target?.channelName === this.name &&",
     "          scope !== 'user' &&"),
    ('m26', 'purge: rescue-write failure no longer fails closed', 'QQChannel.ts',
     "            `[QQ:${this.name}] purgeSingleScopeOrphans rescue write failed, leaving ${doomed.length} session route(s) in place: ${sanitizeLogText(e instanceof Error ? e.message : String(e), 200)}\\n`,\n          );\n          return;",
     "            `[QQ:${this.name}] purgeSingleScopeOrphans rescue write failed, leaving ${doomed.length} session route(s) in place: ${sanitizeLogText(e instanceof Error ? e.message : String(e), 200)}\\n`,\n          );"),
]

# m02 needs an inserted statement after the warning write
M02_INSERT_AFTER = "with sessionScope 'user' group messages fragment per sender.\\n`,\n      );\n"
M02_INSERT = "      config = { ...config, sessionScope: 'single' as const };\n"


def build():
    shutil.rmtree(MUT, ignore_errors=True)
    os.makedirs(MUT)
    files = [f for f in os.listdir(SRC) if f.endswith('.ts')]
    orig = {f: open(os.path.join(SRC, f)).read() for f in files}
    def write(mid, edits):
        d = os.path.join(MUT, mid)
        os.makedirs(d)
        for f in files:
            open(os.path.join(d, f), 'w').write(edits.get(f, orig[f]))
    write('m00', {})
    for mid, gate, f, old, new in MUTANTS:
        text = orig[f]
        if mid == 'm02':
            n = text.count(M02_INSERT_AFTER)
            assert n == 1, (mid, n)
            text = text.replace(M02_INSERT_AFTER, M02_INSERT_AFTER + M02_INSERT)
        else:
            n = text.count(old)
            assert n == 1, (mid, n)
            text = text.replace(old, new)
        assert text != orig[f], mid
        write(mid, {f: text})


def run():
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, 'vitest.json')
    env = dict(os.environ, CI='true')
    p = subprocess.run(['npx', 'vitest', 'run', 'src/__mut__/', '--reporter=json', f'--outputFile={out}'],
                       cwd=PKG, env=env, capture_output=True, text=True)
    data = json.load(open(out))
    per = {}
    for tf in data['testResults']:
        mid = tf['name'].split('/__mut__/')[1].split('/')[0]
        e = per.setdefault(mid, {'tests': 0, 'failed': 0, 'files': set(), 'failedNames': []})
        for a in tf['assertionResults']:
            e['tests'] += 1
            if a['status'] == 'failed':
                e['failed'] += 1
                e['files'].add(os.path.basename(tf['name']))
                if len(e['failedNames']) < 3:
                    e['failedNames'].append(a['fullName'][:150])
        if tf.get('status') == 'failed' and not tf['assertionResults']:
            e['failed'] += 1
            e['files'].add(os.path.basename(tf['name']) + ' (suite error)')
    rows = []
    gates = {m[0]: m[1] for m in MUTANTS}
    gates['m00'] = 'control (unmutated copy)'
    for mid in sorted(per):
        e = per[mid]
        rows.append({'id': mid, 'gate': gates[mid], 'tests': e['tests'], 'failed': e['failed'],
                     'killed': e['failed'] > 0, 'files': sorted(e['files']), 'examples': e['failedNames']})
    json.dump(rows, open(os.path.join(OUT, 'matrix.json'), 'w'), indent=2)
    return rows


if __name__ == '__main__':
    build()
    try:
        rows = run()
    finally:
        shutil.rmtree(MUT, ignore_errors=True)
    for r in rows:
        print(f"{r['id']} {'KILLED ' if r['killed'] else 'SURVIVED'} failed={r['failed']:>3}/{r['tests']}  {r['gate']}  {','.join(r['files'])}")
    st = subprocess.run(['git', 'status', '--porcelain'], cwd=PKG, capture_output=True, text=True).stdout
    print('git status clean:', st.strip() == '')
