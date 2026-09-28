// Independent guard-removal mutants for PR #12888 (verification only, never pushed).
module.exports = {
  T1: {
    file: 'packages/cli/src/serve/hosted-workspace-tool-turn.ts',
    what: 'commit results_ready checkpoint BEFORE the tool_result message',
    from: `        await this.commit('tool_result', converted, model);
        await this.harness.resolveAwaitRuntime(executionCallId, outcomeRef);`,
    to: `        await this.harness.resolveAwaitRuntime(executionCallId, outcomeRef);
        await this.commit('tool_result', converted, model);`,
  },
  T2: {
    file: 'packages/cli/src/serve/hosted-harness-session.ts',
    what: 'live session ignores its blocked flag for new prompts',
    from: `    if (session.blocked)
      return error(res, 409, 'hosted_turn_recovery_required');`,
    to: `    if (session.blocked && Date.now() < 0)
      return error(res, 409, 'hosted_turn_recovery_required');`,
  },
  T3: {
    file: 'packages/cli/src/serve/hosted-harness-session.ts',
    what: "cold load drops the restoreBundle recoveryStatus half of the gate",
    from: `if (restore.recoveryStatus !== 'ok' || hasUnsettledInput(session)) {`,
    to: `if (hasUnsettledInput(session)) {`,
  },
  T4: {
    file: 'packages/cli/src/serve/hosted-harness-session.ts',
    what: 'cold load drops the hasUnsettledInput half of the gate',
    from: `if (restore.recoveryStatus !== 'ok' || hasUnsettledInput(session)) {`,
    to: `if (restore.recoveryStatus !== 'ok') {`,
  },
  T5: {
    file: "packages/core/src/managed-runtime/http-managed-session-store.ts",
    what: "Store client retries a commit once after a transport failure (lost reply)",
    from: "    } catch (error) {\n      throw new ManagedSessionRecordError(\n        `Managed Session Store request failed: ",
    to: "    } catch (error) {\n      if (path === \"/transactions:commit\" && !(this as any).mutantRetried) {\n        (this as any).mutantRetried = true;\n        return this.request(path, method, body, accept);\n      }\n      throw new ManagedSessionRecordError(\n        `Managed Session Store request failed: ",
  },
  T6: {
    file: 'packages/cli/src/serve/hosted-workspace-tool-turn.ts',
    what: 'no best-effort cancel of reserved executions after a Store failure',
    from: `      await Promise.allSettled(reserved.map((id) => this.broker.cancel(id)));`,
    to: `      void reserved;`,
  },
  T7: {
    file: 'packages/cli/src/serve/hosted-workspace-tool-turn.ts',
    what: 'tool_result commit failure swallowed (turn continues to results_ready)',
    from: `        await this.commit('tool_result', converted, model);`,
    to: `        await this.commit('tool_result', converted, model).catch(() => undefined);`,
  },
  A: {
    file: "packages/core/src/managed-runtime/managed-session-authority.ts",
    what: "authority keeps writing after an earlier failed/unacknowledged write",
    from: "    if (this.writeFailure !== undefined) {\n      throw new ManagedSessionRecordError(\n        `session log writes stopped after an earlier failure",
    to: "    if (this.writeFailure !== undefined && Date.now() < 0) {\n      throw new ManagedSessionRecordError(\n        `session log writes stopped after an earlier failure",
  },
};
