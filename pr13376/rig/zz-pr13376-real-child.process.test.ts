/**
 * PR 13376 rig (not part of the PR): a real `qwen --acp
 * --acp-execution-engine managed` child from this arm's shipped bundle
 * (dist/cli.js) runs a Managed session against a local fake model; the child
 * writes its own Managed log. Afterwards this arm's authority cold-reopens
 * that log and retries the exact domain-record commands the child committed.
 */
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BridgeExecutionEngine } from '@qwen-code/acp-bridge/bridgeOptions';
import { ProcessRegistry } from '@qwen-code/acp-bridge/processRegistry';
import { createSpawnChannelFactory } from '@qwen-code/acp-bridge/spawnChannel';
import { SessionService } from '@qwen-code/qwen-code-core/services/sessionService.js';
import { readManagedSessionTitleInfoSync } from '@qwen-code/qwen-code-core/utils/sessionStorageUtils.js';
import { LocalManagedSessionAuthority } from '@qwen-code/qwen-code-core/managed-runtime/managed-session-authority.js';
import { LocalManagedSessionResourceStore } from '@qwen-code/qwen-code-core/managed-runtime/managed-session-resources.js';
import { createAcpSessionBridge, type AcpSessionBridge } from './acp-session-bridge.js';
import { createManagedEngineChannelFactory } from './managed-engine-channel-factory.js';

const ARM = process.env['PR13376_ARM']!;
const OUT = process.env['PR13376_OUT']!;
const CLI_ENTRY = `/Users/wenshao/git/pr13376-${ARM}/dist/cli.js`;
const MODEL = 'm2-fixture';
const log = (line: string) => appendFileSync(OUT, `${ARM}\t${line}\n`);

describe('PR 13376 real Managed child', () => {
  let root: string;
  let workspace: string;
  let runtimeDir: string;
  let server: Server;
  let bridge: AcpSessionBridge | undefined;
  let registry: ProcessRegistry;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), `p13376-child-${ARM}-`)));
    workspace = path.join(root, 'workspace');
    runtimeDir = path.join(root, 'runtime');
    const qwenHome = path.join(root, 'config');
    await mkdir(workspace);
    await mkdir(qwenHome);
    server = createServer(async (req, res) => {
      for await (const _chunk of req) void _chunk;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const [delta, finishReason] of [
        [{ role: 'assistant', content: 'MANAGED_REPLY' }, null],
        [{}, 'stop'],
      ]) {
        res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 0, model: MODEL, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
      }
      res.end('data: [DONE]\n\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;
    await writeFile(
      path.join(qwenHome, 'settings.json'),
      JSON.stringify({
        security: { auth: { selectedType: 'openai' } },
        model: { name: MODEL },
        telemetry: { enabled: false },
        privacy: { usageStatisticsEnabled: false },
        modelProviders: { openai: [{ id: MODEL, envKey: 'OPENAI_API_KEY', baseUrl }] },
      }),
    );
    const sourceEnv: NodeJS.ProcessEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST') && key !== 'NODE_OPTIONS'),
    );
    Object.assign(sourceEnv, {
      HOME: root,
      QWEN_HOME: qwenHome,
      QWEN_RUNTIME_DIR: runtimeDir,
      QWEN_CLI_ENTRY: CLI_ENTRY,
      OPENAI_API_KEY: 'm2-fixture-key',
      OPENAI_BASE_URL: baseUrl,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
      NO_COLOR: '1',
    });
    registry = new ProcessRegistry();
    const options = { sourceEnv, processRegistry: registry };
    const engine: BridgeExecutionEngine = 'managed';
    bridge = createAcpSessionBridge({
      boundWorkspace: workspace,
      sessionScope: 'thread',
      channelIdleTimeoutMs: 0,
      initializeTimeoutMs: 120_000,
      executionEngines: {
        legacy: createSpawnChannelFactory(options),
        managed: createManagedEngineChannelFactory(options),
        select: () => engine,
      },
    });
  });

  afterEach(async () => {
    await bridge?.shutdown();
    bridge = undefined;
    await registry.shutdown();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function prompt(sessionId: string, text: string): Promise<string> {
    let reply = '';
    const events = bridge!.subscribeEvents(sessionId);
    const collected = (async () => {
      for await (const event of events) {
        const update = (event.data as { update?: { sessionUpdate?: string; content?: { text?: string } } }).update;
        if (update?.sessionUpdate === 'agent_message_chunk') reply += update.content?.text ?? '';
        if (event.type === 'turn_complete') return;
      }
    })();
    const response = await bridge!.sendPrompt(sessionId, { sessionId, prompt: [{ type: 'text', text }] });
    expect(response.stopReason).toBe('end_turn');
    await collected;
    return reply;
  }

  it('replays the child-committed domain records after a cold reopen', async () => {
    const session = await bridge!.spawnOrAttach({ workspaceCwd: workspace, sessionScope: 'thread' });
    const sessionId = session.sessionId;
    log(`child entry=${CLI_ENTRY} session=${sessionId}`);
    log(`turn 1 reply=${await prompt(sessionId, 'hello')}`);
    log(`turn 2 reply=${await prompt(sessionId, 'second turn')}`);
    await bridge!.closeSession(sessionId);
    await registry.shutdown();

    const transcript = new SessionService(workspace, { runtimeBaseDir: runtimeDir }).getSessionTranscriptPath(sessionId);
    const lines = (await readFile(transcript, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    const domainEvents = lines
      .filter((r) => r.subtype === 'managed_session_event_v1' && r.managedSession?.kind === 'domain.committed')
      .map((r) => r.managedSession);
    const markers = lines.filter((r) => r.subtype === 'managed_session_commit_v1').map((r) => r.managedSession);
    const header = lines.find((r) => r.subtype === 'managed_session_header_v1')?.managedSession;
    log(`child log: ${lines.length} records, ${markers.length} commits, domain.committed=[${domainEvents.map((e) => `${e.payload.domain}@${e.sequence}`).join(', ')}]`);
    log(`title reader (session list): ${JSON.stringify(readManagedSessionTitleInfoSync(transcript, runtimeDir))}`);
    expect(domainEvents.length).toBeGreaterThan(0);

    const resourcesRoot = path.join(runtimeDir, 'resources', sessionId);
    const countBodies = async () => {
      const out: Record<string, number> = {};
      for (const e of domainEvents) {
        const kind = `managed-${e.payload.domain}`;
        out[kind] = (await readdir(path.join(resourcesRoot, kind)).catch(() => [])).length;
      }
      return JSON.stringify(out);
    };
    log(`bodies on disk after the child exited: ${await countBodies()}`);

    // Cold reopen of the child's own log by this arm's authority, then retry
    // each committed domain-record command exactly as the child sent it.
    const lease = await LocalManagedSessionAuthority.acquireWriter({ runtimeBaseDir: runtimeDir, sessionId, transcriptPath: transcript });
    const sessionKey = header.sessionKey;
    const resources = LocalManagedSessionResourceStore.create({ runtimeBaseDir: runtimeDir, sessionKey });
    const authority = await LocalManagedSessionAuthority.open({ lease, sessionKey, cwd: workspace, version: 'pr13376-rig', resources });
    const sequenceBefore = authority.committedSequence;
    for (const event of domainEvents) {
      const marker = markers.find((m) => m.firstSequence <= event.sequence && event.sequence <= m.lastSequence);
      const body = JSON.parse((await resources.read(event.payload.recordRef)).toString('utf8'));
      const { operationId: _o, revision: _r, previousRecordRef: _p, ...content } = body;
      try {
        const r = await authority.commitDomainRecord(
          { operation: marker.operation, commandId: marker.commandId, sessionKey, contentDigest: marker.contentDigest },
          { domain: event.payload.domain, content },
          { class: 'trusted_entry' },
        );
        log(`retry ${marker.operation} ${marker.commandId.slice(0, 18)}… (${event.payload.domain}, committed rev ${body.revision}): replayed=${r.receipt.replayed === true} rev=${r.revision} sameRef=${r.recordRef.resourceId === event.payload.recordRef.resourceId}`);
      } catch (e) {
        log(`retry ${marker.operation} ${marker.commandId.slice(0, 18)}…: REFUSED ${(e as Error).message}`);
      }
    }
    log(`committed sequence before/after retries: ${sequenceBefore}/${authority.committedSequence}`);
    log(`bodies on disk after the retries: ${await countBodies()}`);
    await authority.close();
    log(`title reader after the retries: ${JSON.stringify(readManagedSessionTitleInfoSync(transcript, runtimeDir))}`);
  }, 300_000);
});
