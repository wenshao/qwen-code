/** @jsxImportSource @opentui/react */
/* eslint-disable */
/**
 * PR #10383 — real-render scenarios.
 *
 * Every component here is imported verbatim from the PR's own source tree
 * and mounted through the real OpenTUI renderer.
 */
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated QWEN_HOME so the harness never reads or writes the real profile.
const HOME = mkdtempSync(join(tmpdir(), 'pr10383-home-'));
mkdirSync(join(HOME, '.qwen'), { recursive: true });
writeFileSync(
  join(HOME, '.qwen', 'settings.json'),
  JSON.stringify({ ui: { theme: 'Default' } }, null, 2),
);
process.env['QWEN_HOME'] = HOME;

const { snap, results, OUT } = await import('./render-dialogs.js');
const { loadSettings } = await import('../src/config/settings.js');
const { Config } = await import('@qwen-code/qwen-code-core');

const WS = mkdtempSync(join(tmpdir(), 'pr10383-ws-'));
const settings = loadSettings(WS);

const config = new Config({
  sessionId: 'pr10383-probe',
  targetDir: WS,
  cwd: WS,
  debugMode: false,
  chatRecording: false,
  model: 'qwen3-coder-plus',
  trustedFolder: true,
} as never);
await config.initialize({ skipMcpDiscovery: true } as never);

const noop = () => {};

// --- 1. help overlay (0 tests in the PR) --------------------------------
{
  const { HelpOverlay } = await import('../src/ui/opentui/help-overlay.js');
  const { loadInteractiveCommands } = await import(
    '../src/ui/opentui/slash-dispatch.js'
  );
  let commands: readonly unknown[] = [];
  try {
    commands = await loadInteractiveCommands(config as never, settings as never);
  } catch (e) {
    writeFileSync(join(OUT, 'help.commands.error.txt'), String(e));
  }
  writeFileSync(
    join(OUT, 'help.commands.count.txt'),
    `loaded ${commands.length} interactive commands`,
  );
  await snap(
    'help-builtin',
    <HelpOverlay
      commands={commands as never}
      tab="commands"
      scroll={0}
      bodyRows={22}
      width={100}
    />,
    { width: 100, height: 32 },
  );
  await snap(
    'help-shortcuts',
    <HelpOverlay
      commands={commands as never}
      tab="shortcuts"
      scroll={0}
      bodyRows={22}
      width={100}
    />,
    { width: 100, height: 32 },
  );
  await snap(
    'help-scrolled',
    <HelpOverlay
      commands={commands as never}
      tab="commands"
      scroll={12}
      bodyRows={22}
      width={100}
    />,
    { width: 100, height: 32 },
  );
  await snap(
    'help-narrow',
    <HelpOverlay
      commands={commands as never}
      tab="commands"
      scroll={0}
      bodyRows={18}
      width={46}
    />,
    { width: 46, height: 26 },
  );
}

// --- 2. modes dialogs (0 tests in the PR) -------------------------------
{
  const { OpenTuiApprovalModeDialog, OpenTuiEffortDialog } = await import(
    '../src/ui/opentui/dialogs-modes.js'
  );
  await snap(
    'approval-mode',
    <OpenTuiApprovalModeDialog
      config={config as never}
      settings={settings as never}
      onClose={noop}
      onApprovalModeChanged={noop}
    />,
    { width: 80, height: 16 },
  );
  await snap(
    'approval-mode-nav',
    <OpenTuiApprovalModeDialog
      config={config as never}
      settings={settings as never}
      onClose={noop}
      onApprovalModeChanged={noop}
    />,
    {
      width: 80,
      height: 16,
      keys: [['ARROW_DOWN'], ['ARROW_DOWN'], ['ARROW_UP']],
    },
  );
  await snap(
    'effort',
    <OpenTuiEffortDialog
      config={config as never}
      settings={settings as never}
      onClose={noop}
    />,
    { width: 80, height: 16 },
  );
}

// --- 3. stats / skills (0 tests in the PR) ------------------------------
{
  const { OpenTuiStatsDialog, OpenTuiSkillsDialog } = await import(
    '../src/ui/opentui/dialogs-stats-skills.js'
  );
  await snap(
    'stats-session',
    <OpenTuiStatsDialog config={config as never} onClose={noop} />,
    { width: 100, height: 30 },
  );
  await snap(
    'stats-tabs',
    <OpenTuiStatsDialog config={config as never} onClose={noop} />,
    { width: 100, height: 30, keys: [['\t'], ['\t'], ['\t']] },
  );
  await snap(
    'skills',
    <OpenTuiSkillsDialog config={config as never} onClose={noop} />,
    { width: 100, height: 26 },
  );
}

// --- 4. arena dialogs (0 tests in the PR, 818 lines) --------------------
{
  const { OpenTuiArenaDialog } = await import(
    '../src/ui/opentui/dialogs-arena.js'
  );
  for (const mode of ['start', 'status', 'stop', 'select'] as const) {
    await snap(
      `arena-${mode}`,
      <OpenTuiArenaDialog
        config={config as never}
        mode={mode}
        onClose={noop}
        notify={noop}
        onFillInput={noop}
      />,
      { width: 100, height: 26 },
    );
  }
}

// --- 5. rewind viewer (model tested, component untested) ----------------
{
  const { OpentuiRewindSelector } = await import(
    '../src/ui/opentui/session-rewind.js'
  );
  const turns = Array.from({ length: 9 }, (_, i) => ({
    promptId: `p${i}`,
    text: `user turn ${i + 1}: refactor the ${['parser', 'renderer', 'cache', 'router'][i % 4]} module`,
    isUser: true,
    timestamp: Date.now() - (9 - i) * 60_000,
  }));
  await snap(
    'rewind-pick',
    <OpentuiRewindSelector
      turns={turns as never}
      fileCheckpointingEnabled={true}
      getDiffStats={async () => ({ filesChanged: 3, insertions: 42, deletions: 7 }) as never}
      onRewind={noop}
      onCancel={noop}
    />,
    { width: 100, height: 26 },
  );
  await snap(
    'rewind-restore-options',
    <OpentuiRewindSelector
      turns={turns as never}
      fileCheckpointingEnabled={true}
      getDiffStats={async () => ({ filesChanged: 3, insertions: 42, deletions: 7 }) as never}
      onRewind={noop}
      onCancel={noop}
    />,
    { width: 100, height: 26, keys: [['ARROW_DOWN'], ['RETURN']] },
  );
  await snap(
    'rewind-no-checkpointing',
    <OpentuiRewindSelector
      turns={turns as never}
      fileCheckpointingEnabled={false}
      onRewind={noop}
      onCancel={noop}
    />,
    { width: 100, height: 26, keys: [['RETURN']] },
  );
}

// --- 6. tested dialogs, re-checked under the real renderer --------------
{
  const { OpenTuiSettingsDialog } = await import(
    '../src/ui/opentui/dialogs-settings.js'
  );
  await snap(
    'settings',
    <OpenTuiSettingsDialog
      settings={settings as never}
      config={config as never}
      onSelect={noop}
      availableTerminalHeight={28}
    />,
    { width: 100, height: 32 },
  );

  const { OpenTuiPermissionsDialog } = await import(
    '../src/ui/opentui/dialogs-permissions.js'
  );
  await snap(
    'permissions',
    <OpenTuiPermissionsDialog
      rules={
        [
          { raw: 'Bash(git status)', type: 'allow' },
          { raw: 'Bash(rm -rf *)', type: 'deny' },
          { raw: 'WriteFile(/etc/**)', type: 'deny' },
        ] as never
      }
      directories={[WS] as never}
      initialDirectories={[WS] as never}
      onAddRule={noop}
      onDeleteRule={noop}
      onAddDirectory={noop}
      onRemoveDirectory={noop}
      onExit={noop}
    />,
    { width: 100, height: 28 },
  );

  const { OpenTuiAuthDialog } = await import(
    '../src/ui/opentui/dialogs-auth.js'
  );
  await snap(
    'auth',
    <OpenTuiAuthDialog
      config={config as never}
      settings={settings as never}
      onClose={noop}
      notify={noop}
    />,
    { width: 100, height: 28 },
  );

  const { OpenTuiMcpDialog } = await import('../src/ui/opentui/dialogs-mcp.js');
  await snap(
    'mcp',
    <OpenTuiMcpDialog
      servers={
        [
          { name: 'github', status: 'connected', toolCount: 12 },
          { name: 'filesystem', status: 'connected', toolCount: 5 },
          { name: 'broken-server', status: 'disconnected', toolCount: 0 },
        ] as never
      }
      onClose={noop}
    />,
    { width: 100, height: 26 },
  );

  const { OpenTuiModelDialog } = await import(
    '../src/ui/opentui/dialogs-model.js'
  );
  await snap(
    'model',
    <OpenTuiModelDialog
      entries={
        [
          { key: 'qwen3-coder-plus', label: 'qwen3-coder-plus', provider: 'dashscope' },
          { key: 'qwen3-max', label: 'qwen3-max', provider: 'dashscope' },
          { key: 'gpt-5', label: 'gpt-5', provider: 'openai' },
        ] as never
      }
      mode="primary"
      onSelect={noop}
      onClose={noop}
      availableTerminalHeight={24}
    />,
    { width: 100, height: 26 },
  );

  const { OpenTuiMemoryDialog } = await import(
    '../src/ui/opentui/dialogs-memory-status.js'
  );
  await snap(
    'memory',
    <OpenTuiMemoryDialog
      config={config as never}
      settings={settings as never}
      onClose={noop}
    />,
    { width: 100, height: 24 },
  );

  const { OpenTuiExtensionsDialog } = await import(
    '../src/ui/opentui/dialogs-extensions.js'
  );
  await snap(
    'extensions',
    <OpenTuiExtensionsDialog onClose={noop} initialTab={'installed' as never} />,
    { width: 100, height: 26 },
  );
}

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
console.log('OUT=' + OUT);
process.exit(0);
