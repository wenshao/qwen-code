        if (formerStoreRequests.length === 0) {
          throw new Error(
            'Woken former Harness never reached the replacement Session Store: the fencing proof would be vacuous',
          );
        }
        if (
          formerWriterTransactions !== 0 ||
          acceptedFormerRequests.length !== 0 ||
          bootAfterWake !== replacementBootId ||
          awakeText !== visibleText ||
          awakeTerminalCount !== terminalCount
        ) {
          throw new Error(
            `Frozen former Harness mutated the takeover after waking: formerTransactions=${formerWriterTransactions} accepted=${JSON.stringify(acceptedFormerRequests)} boot=${replacementBootId}->${bootAfterWake} text=${JSON.stringify(visibleText)}->${JSON.stringify(awakeText)} terminals=${terminalCount}->${awakeTerminalCount}`,
          );
        }
        console.log(
          JSON.stringify(
            {
              fencedFormerOwner: true,
              formerStoreRequests: formerStoreRequests.map(
                (entry) => `${entry.method} ${entry.path} -> ${entry.status}`,
              ),
              formerWriterTransactions,
              harnessBootId: bootAfterWake,
              visibleText: awakeText,
            },
            null,
            2,
          ),
        );
      }
