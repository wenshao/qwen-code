// Ran once inside packages/cli/src/serve at 0485bd74e2, then deleted.
import { it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManagedToolSet } from './managed-runtime-tool-executor.js';

it('R6 probe: the worker ShellTool on an is_monitor input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'r6-shell-'));
  const tools = createManagedToolSet(dir, 'r6-instance');
  const shell = tools.tools.get('run_shell_command')!;
  const verdicts = {
    toolNames: [...tools.tools.keys()],
    monitorTool: tools.tools.has('monitor'),
    isMonitor: shell.validateToolParams({ command: 'tail -f build.log', is_monitor: true }),
    isBackground: shell.validateToolParams({ command: 'tail -f build.log', is_background: true }),
  };
  console.log('[R6-SHELL-SCHEMA] ' + JSON.stringify(verdicts));
});
