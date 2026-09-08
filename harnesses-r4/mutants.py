#!/usr/bin/env python3
"""Build mutant bundles by clone-and-patch of the head dist.

Each mutant reverses exactly one behaviour the PR introduces (or a guard the
review flagged as unwitnessed), so the rig can say whether the real stack
notices. A mutant whose patch does not apply is a hard error - a silently
unapplied patch would read as a surviving mutant.
"""
import os, shutil, subprocess, sys

HEAD = os.path.expanduser('~/git/rig-10457/dists/head')
DISTS = os.path.expanduser('~/git/rig-10457/dists')

CH = 'chunks/chunk-DLIBLWQI.js'   # channel-base
AD = 'chunks/dist-WZ5VB7AX.js'    # dingtalk adapter + controllers

MUTANTS = {
    # R1-1: drop the owner-binding clause for card-presented permissions.
    'm1-owner-binding': [(CH,
        '(!pending.userInputPresented && !pending.permissionPresented || pending.target.senderId === envelope.senderId)',
        '(!pending.userInputPresented || pending.target.senderId === envelope.senderId)')],

    # R1-2: drop the ask_user_question exclusion from the permission-card gate.
    'm2-user-question-gate': [(CH,
        'if (!active || active.loopPrompt || !active.owner || isUserQuestion || !decisions) {',
        'if (!active || active.loopPrompt || !active.owner || !decisions) {')],

    # R1-12: never reset permissionPresented when presentation is unsupported.
    'm3-no-reset': [(CH,
        '''        if (result.kind === "presented" || result.kind === "handled" && respondInvoked) {
          return true;
        }
        pending.permissionPresented = false;
        return false;''',
        '''        if (result.kind === "presented" || result.kind === "handled" && respondInvoked) {
          return true;
        }
        return false;''')],

    # R1-14: let the permission controller's `ignored` verdict short-circuit
    # the question controller.
    'm4-route-narrow': [(AD,
        '''    const permissionResult = this.permissionCardController?.claim(callback);
    if (permissionResult && permissionResult.kind !== "ignored") {
      return permissionResult;
    }''',
        '''    const permissionResult = this.permissionCardController?.claim(callback);
    if (permissionResult) {
      return permissionResult;
    }''')],

    # R1-4: drop the adapter -> controller locale wiring.
    'm5-locale-wiring': [(AD,
        '''          timeoutMs: this.interactiveCardConfig.permissionCard.timeoutMs,
          locale: this.locale,''',
        '''          timeoutMs: this.interactiveCardConfig.permissionCard.timeoutMs,''')],

    # R1-8: collapse the rejected-response ternary so a lost race still shows
    # the tapped decision instead of `expired`.
    'm6-accept-ternary': [(AD,
        '''      const accepted = await record.context.respond(decision);
      await this.finalize(record, accepted ? terminalState ?? (decision === "deny" ? "denied" : "approved") : "expired");''',
        '''      await record.context.respond(decision);
      await this.finalize(record, terminalState ?? (decision === "deny" ? "denied" : "approved"));''')],

    # R1-23: remove the try/catch around the terminal card update.
    'm7-projection-catch': [(AD,
        '''    try {
      await this.options.client.updateInstance({
        outTrackId: record.outTrackId,
        cardParamMap: cardParamMap[record.terminalState]
      });
    } catch (error) {
      this.options.onError?.("permission card finalization", error);
    }''',
        '''    await this.options.client.updateInstance({
      outTrackId: record.outTrackId,
      cardParamMap: cardParamMap[record.terminalState]
    });''')],

    # R1-37: widen cancelRun so terminalising one run finalises every card.
    'm8-cancelrun-widen': [(AD,
        '''  cancelRun(runId) {
    const requestIds = [...this.pendingByRun.get(runId) ?? []];''',
        '''  cancelRun(runId) {
    const requestIds = [...this.byRequest.keys()];''')],

    # R1-31: remove the claimed-state guard from the timeout path.
    'm9-expire-guard': [(AD,
        '''  async expire(record) {
    if (record.state !== "pending")
      return;
    this.reserveTerminalProjection(record);
    record.state = "claimed";
    const response = record.context.respond("deny").catch((error) => {''',
        '''  async expire(record) {
    this.reserveTerminalProjection(record);
    record.state = "claimed";
    const response = record.context.respond("deny").catch((error) => {''')],

    # R1-35: deliver the permission card to the raw conversation target
    # instead of the DM-mapped card target.
    'm10-dm-target': [(AD,
        '    return permissionCards.present(context, this.cardTarget(context.target));',
        '    return permissionCards.present(context, { chatId: context.target.chatId, isGroup: context.target.isGroup });')],

    # The PR's own contract change in respondToUserInput: a second responder
    # used to receive the first response's verdict.
    'm11-response-race': [(CH,
        '''    if (pending.responsePromise) {
      await pending.responsePromise;
      return false;
    }''',
        '''    if (pending.responsePromise) {
      return pending.responsePromise;
    }''')],
}


def build(name):
    dst = os.path.join(DISTS, name)
    if os.path.exists(dst):
        shutil.rmtree(dst)
    subprocess.check_call(['cp', '-Rc', HEAD, dst])
    for rel, old, new in MUTANTS[name]:
        p = os.path.join(dst, rel)
        s = open(p, encoding='utf-8').read()
        n = s.count(old)
        if n != 1:
            raise SystemExit(f'{name}: pattern occurs {n} times in {rel}, expected 1')
        open(p, 'w', encoding='utf-8').write(s.replace(old, new))
    print(f'built {name}')


if __name__ == '__main__':
    names = sys.argv[1:] or list(MUTANTS)
    for n in names:
        build(n)
