import sys, os, shutil, subprocess, json

WT = sys.argv[1]
PC = os.path.join(WT, 'packages/cli/src/nonInteractive/control/controllers/permissionController.ts')
NIC = os.path.join(WT, 'packages/cli/src/nonInteractiveCli.ts')
AUQ = os.path.join(WT, 'packages/core/src/tools/askUserQuestion.ts')
TOOLS = os.path.join(WT, 'packages/core/src/tools/tools.ts')

MUTANTS = {
 'M1-teammate-abort': (PC,
   """        await event.respond(ToolConfirmationOutcome.Cancel, {
          cancelMessage: `The host approval request for "${event.toolName}" was aborted.`,
        });""",
   """        await event.respond(ToolConfirmationOutcome.Cancel);"""),
 'M2-teammate-nonstreamjson': (PC,
   """        await event.respond(ToolConfirmationOutcome.Cancel, {
          cancelMessage: this.getInteractionUnavailableMessage(event.toolName),
        });
        return;
      }

      // Stream-json mode: ask SDK for permission.""",
   """        await event.respond(ToolConfirmationOutcome.Cancel);
        return;
      }

      // Stream-json mode: ask SDK for permission."""),
 'M3-teammate-nonsuccess': (PC,
   """      if (response.subtype !== 'success') {
        await event.respond(ToolConfirmationOutcome.Cancel, {
          cancelMessage: this.getInteractionUnavailableMessage(event.toolName),
        });
        return;
      }""",
   """      if (response.subtype !== 'success') {
        await event.respond(ToolConfirmationOutcome.Cancel);
        return;
      }"""),
 'M4-teammate-catch': (PC,
   """        const errorMessage =
          error instanceof Error ? error.message : String(error);
        await event.respond(ToolConfirmationOutcome.Cancel, {
          cancelMessage: `The host approval request for "${event.toolName}" failed: ${errorMessage}`,
        });""",
   """        await event.respond(ToolConfirmationOutcome.Cancel);"""),
 'M5-headless-reason': (NIC,
   """            event
              .respond(ToolConfirmationOutcome.Cancel, {
                cancelMessage: reason,
              })
              .catch((err) => {""",
   """            event
              .respond(ToolConfirmationOutcome.Cancel)
              .catch((err) => {"""),
 'M6-drop-conjunct': (PC,
   """          toolCall.request.name === ToolNames.EXIT_PLAN_MODE &&
          toolCall.invocation?.canAutoApproveOnAllow?.() !== false
        ) {""",
   """          toolCall.request.name === ToolNames.EXIT_PLAN_MODE
        ) {"""),
 'M7-auq-true': (AUQ,
   """  override canAutoApproveOnAllow(): boolean {
    return false;
  }""",
   """  override canAutoApproveOnAllow(): boolean {
    return true;
  }"""),
 'M8-base-false': (TOOLS,
   """  canAutoApproveOnAllow(): boolean {
    return true;
  }""",
   """  canAutoApproveOnAllow(): boolean {
    return false;
  }"""),
 'M9-message-text': (PC,
   """      : `The host could not present the required approval for "${toolName}".`;""",
   """      : `MUTATED approval unavailable for "${toolName}".`;"""),
}

name = sys.argv[2]
action = sys.argv[3]  # apply | restore
path, old, new = MUTANTS[name]
bak = path + '.bak'
if action == 'apply':
    shutil.copy2(path, bak)
    s = open(path).read()
    if old not in s:
        print(f'MISS {name}'); sys.exit(2)
    open(path, 'w').write(s.replace(old, new, 1))
    print(f'APPLIED {name} -> {os.path.relpath(path, WT)}')
else:
    shutil.move(bak, path)
    print(f'RESTORED {name}')
