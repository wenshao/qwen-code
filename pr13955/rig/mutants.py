#!/usr/bin/env python3
"""Targeted mutants for PR 13955 (H4e-b3c). Each mutant is one exact,
unique replacement in one src file; the run applies it, runs the PR's four
suites, records killed/survived, and restores the file with git checkout.
usage: mutants.py <worktree> <out.jsonl> [mutant-id ...]"""
import json, subprocess, sys, time, pathlib

S = 'packages/cli/src/serve/'
MUTANTS = [
    ('M01', S + 'hosted-member-chain.ts',
     '.update(`${params.leadSessionId}\\0${params.commandId}\\0${params.position}`)',
     '.update(`${params.leadSessionId}\\0${params.position}`)',
     'msgc_ id drops the commandId (two commands collide)'),
    ('M02', S + 'hosted-member-chain.ts',
     'export const HOSTED_MEMBER_MESSAGE_IN_FLIGHT = 4;',
     'export const HOSTED_MEMBER_MESSAGE_IN_FLIGHT = 5;',
     'member in-flight cap 4 -> 5'),
    ('M03', S + 'hosted-member-chain.ts',
     'export const HOSTED_MEMBER_MESSAGE_PER_RUN = 16;',
     'export const HOSTED_MEMBER_MESSAGE_PER_RUN = 17;',
     'member per-run cap 16 -> 17'),
    ('M04', S + 'hosted-member-chain.ts',
     "        message.childRunId === run.childRunId &&\n        !message.messageId.startsWith(MEMBER_MESSAGE_ID_PREFIX),",
     "        message.childRunId === run.childRunId,",
     'never-started note counts member messages again'),
    ('M05', S + 'hosted-session-command-session.ts',
     '        committed.add(position);',
     '        void position;',
     're-run never probes committed msgc_ positions'),
    ('M06', S + 'hosted-session-command-session.ts',
     '        executionCallId: params.commandId,',
     '        executionCallId: `${params.commandId}:x`,',
     'msgc_ executionCallId is not the command id'),
    ('M07', S + 'hosted-session-command-session.ts',
     "  const envelopeOf = (candidate: string): number =>\n    Buffer.byteLength(\n      JSON.stringify({ outcome: 'answered', text: candidate }),\n      'utf8',\n    );",
     "  const envelopeOf = (candidate: string): number =>\n    Buffer.byteLength(candidate, 'utf8') + 512;",
     'reply cut measures raw bytes, not the stored JSON (pre-ce9306ed4c)'),
    ('M08', S + 'hosted-session-command-session.ts',
     "      if (named === senderName) {\n        return refused('A member cannot send a message to itself.');\n      }",
     "",
     'funnel-side self refusal removed'),
    ('M09', S + 'hosted-child-agent-session.ts',
     "      if (view.stopRequestedCompletion) {\n        return { kind: 'notReached', reason: 'completed_after_stop' };\n      }",
     "",
     'completed-after-stop folds into finished'),
    ('M10', S + 'hosted-child-agent-session.ts',
     "      if (view.stopping) {\n        return { kind: 'notReached', reason: 'stopping' };\n      }",
     "",
     'a stopping recipient is still sent to'),
    ('M11', S + 'hosted-child-agent-session.ts',
     "          message.contentDigest === sha256(params.content)",
     "          true",
     'a re-sent id with different bytes answers sent'),
    ('M12', S + 'hosted-child-agent-session.ts',
     "      const memberSent = sentBefore.filter((message) =>\n        message.messageId.startsWith(MEMBER_MESSAGE_ID_PREFIX),\n      );",
     "      const memberSent = sentBefore;",
     'member sub-caps count the lead\'s own messages too'),
    ('M13', S + 'hosted-session-message-session.ts',
     "      return text !== undefined && hasPlanModeBlock(text);\n    } catch {\n      return true;",
     "      return text !== undefined && hasPlanModeBlock(text);\n    } catch {\n      return false;",
     'unreadable first input fails open (not plan mode)'),
    ('M14', S + 'hosted-session-message-session.ts',
     "              planMode: await this.inPlanMode(),",
     "              planMode: false,",
     'recipient never rendered in plan mode'),
    ('M15', S + 'hosted-session-message-session.ts',
     "  if (!rest.endsWith(MEMBER_MESSAGE_FOOT)) return undefined;\n  return {\n    from: head[1]!,\n    text: rest.slice(0, rest.length - MEMBER_MESSAGE_FOOT.length),\n  };",
     "  const at = rest.indexOf(MEMBER_MESSAGE_FOOT);\n  if (at < 0) return undefined;\n  return {\n    from: head[1]!,\n    text: rest.slice(0, at),\n  };",
     'footer cut at the first </member-message>, not the last'),
    ('M16', S + 'hosted-workspace-tool-turn.ts',
     "          sanitizeName(call.args['to']) !== 'parent';",
     "          call.args['to'].trim() !== 'parent';",
     'R1-2 regression: "Parent" rides the command lane'),
    ('M17', S + 'hosted-workspace-tool-turn.ts',
     "            } else if (memberMessageCommand && this.memberPlanMode) {\n              validationError = HOSTED_PLAN_MODE_REFUSAL;",
     "            } else if (false) {\n              validationError = HOSTED_PLAN_MODE_REFUSAL;",
     'plan-mode member may message peers'),
    ('M18', S + 'hosted-workspace-tool-turn.ts',
     "              validationError = `A member cannot send a message to itself (\"${this.memberIdentity.name}\").`;",
     "              validationError = undefined;",
     'local self refusal removed'),
    ('M19', S + 'hosted-workspace-tool-turn.ts',
     "              validationError =\n                'A member messages its leader with send_message with to \"parent\", not \"leader\".';",
     "              validationError = undefined;",
     'local "leader" refusal removed'),
    ('M20', S + 'hosted-workspace-tool-turn.ts',
     "              validationError =\n                'Hosted send_message to a member cannot share a batch with Workspace or Runtime calls; a command parks the Turn while the leader answers, so run it in its own batch or beside the member board commands.';",
     "              validationError = undefined;",
     'member message may share a batch with Workspace calls'),
    ('M21', S + 'hosted-workspace-tool-turn.ts',
     "              memberCommands\n                ? HOSTED_MEMBER_SEND_MESSAGE_TOOL\n                : HOSTED_SEND_MESSAGE_TO_PARENT_TOOL,",
     "              HOSTED_SEND_MESSAGE_TO_PARENT_TOOL,",
     'member send_message declaration never widened'),
    ('M22', S + 'hosted-workspace-tool-turn.ts',
     "              ) > MANAGED_CHILD_LIMITS.maxEnvelopeBytes\n            ) {\n              validationError = `Hosted send_message message is too long for a member message (byte_limit): with its wrapper it must fit ${MANAGED_CHILD_LIMITS.maxEnvelopeBytes} bytes.`;",
     "              ) > MANAGED_CHILD_LIMITS.maxEnvelopeBytes * 2\n            ) {\n              validationError = `Hosted send_message message is too long for a member message (byte_limit): with its wrapper it must fit ${MANAGED_CHILD_LIMITS.maxEnvelopeBytes} bytes.`;",
     'local envelope bound doubled'),
]

SUITES = [
    'src/serve/hosted-session-command-session.test.ts',
    'src/serve/hosted-session-message-session.test.ts',
    'src/serve/hosted-member-chain.test.ts',
    'src/serve/hosted-workspace-tool-turn.commands.test.ts',
]


def main():
    tree = pathlib.Path(sys.argv[1])
    out = pathlib.Path(sys.argv[2])
    only = set(sys.argv[3:])
    for mid, rel, old, new, what in MUTANTS:
        if only and mid not in only:
            continue
        path = tree / rel
        src = path.read_text()
        n = src.count(old)
        if n != 1:
            rec = {'id': mid, 'what': what, 'status': f'NOT-APPLIED (matches={n})'}
            out.open('a').write(json.dumps(rec) + '\n')
            print(rec, flush=True)
            continue
        path.write_text(src.replace(old, new))
        t0 = time.time()
        r = subprocess.run(['npx', 'vitest', 'run', *SUITES], cwd=tree / 'packages/cli',
                           capture_output=True, text=True)
        subprocess.run(['git', 'checkout', '--', rel], cwd=tree, check=True)
        assert path.read_text() == src
        tail = (r.stdout + r.stderr)[-4000:]
        failed = [l.strip() for l in (r.stdout + r.stderr).splitlines()
                  if l.strip().startswith(('×', '✗', 'FAIL'))][:8]
        summary = [l.strip() for l in tail.splitlines() if 'Tests ' in l or 'Test Files' in l]
        rec = {'id': mid, 'what': what, 'file': rel,
               'status': 'KILLED' if r.returncode != 0 else 'SURVIVED',
               'rc': r.returncode, 'seconds': round(time.time() - t0, 1),
               'summary': summary, 'failed': failed}
        out.open('a').write(json.dumps(rec, ensure_ascii=False) + '\n')
        print(mid, rec['status'], summary, flush=True)


if __name__ == '__main__':
    main()
