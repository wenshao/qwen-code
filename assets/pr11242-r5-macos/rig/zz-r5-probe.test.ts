/**
 * Round-5 verification probe (scratch, not for merge).
 * T1: delivery throughput of one big chunk, comparable across arms.
 * T2: what a throw inside delivery does now that drain() runs outside the
 *     data handler's try/catch.
 */
import { connect } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  CHROME_BRIDGE_PROTOCOL_VERSION,
  CHROME_EXTENSION_ID,
  type BridgeRequest,
} from '../protocol.js';
import { ChromeExtensionTransport } from './chrome-extension-transport.js';
import { encodeFrame, FrameDecoder } from './framing.js';

const transports: ChromeExtensionTransport[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const transport of transports.splice(0)) await transport.stop();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function connected() {
  const root = fs.mkdtempSync(path.join('/private/tmp', 'qbu-r5-'));
  fs.chmodSync(root, 0o700);
  roots.push(root);
  const transport = new ChromeExtensionTransport({ socketPath: path.join(root, 'b.sock') });
  transports.push(transport);
  await transport.start();
  const socket = connect(transport.socketPath);
  await new Promise<void>((resolve) => socket.once('connect', resolve));
  const requests: BridgeRequest[] = [];
  const decoder = new FrameDecoder();
  socket.on('data', (chunk: Buffer) => {
    requests.push(...(decoder.push(chunk) as BridgeRequest[]));
  });
  socket.write(
    encodeFrame({
      type: 'hello',
      protocolVersion: CHROME_BRIDGE_PROTOCOL_VERSION,
      extensionId: CHROME_EXTENSION_ID,
      extensionInstanceId: 'profile-a',
    }),
  );
  await vi.waitFor(() => expect(transport.isConnected()).toBe(true));
  return { transport, socket, requests };
}

it('T1 throughput: one chunk with 400 responses interleaved with 1200 events', async () => {
  const { transport, socket, requests } = await connected();
  const N = 400;
  let events = 0;
  transport.onEvent(() => {
    events += 1;
  });
  const settled: Array<Promise<unknown>> = [];
  for (let index = 0; index < N; index += 1) {
    settled.push(transport.request('cdp.send', { tabId: 1, method: 'Runtime.evaluate' }, 60_000));
  }
  await vi.waitFor(() => expect(requests).toHaveLength(N), { timeout: 30_000 });
  const frames: Buffer[] = [];
  for (let index = 0; index < N; index += 1) {
    frames.push(encodeFrame({ type: 'response', id: requests[index]!.id, ok: true, result: { index } }));
    for (let e = 0; e < 3; e += 1) {
      frames.push(encodeFrame({ type: 'event', tabId: 1, method: 'Runtime.consoleAPICalled', params: { index, e } }));
    }
  }
  const chunk = Buffer.concat(frames);
  const started = process.hrtime.bigint();
  socket.write(chunk);
  const values = await Promise.all(settled);
  await vi.waitFor(() => expect(events).toBe(N * 3), { timeout: 30_000 });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  expect(values).toHaveLength(N);
  process.stdout.write(
    `\nR5-T1 ${JSON.stringify({ chunkBytes: chunk.length, responses: N, events, elapsedMs: Number(elapsedMs.toFixed(1)) })}\n`,
  );
});

it('T2 a throw inside delivery: does a later response still arrive?', async () => {
  const { transport, socket, requests } = await connected();
  const uncaught: string[] = [];
  const onUncaught = (error: Error) => uncaught.push(String(error?.message ?? error));
  process.on('uncaughtException', onUncaught);
  try {
    const first = transport.request('cdp.send', { tabId: 1, method: 'A' }, 4_000).then(
      () => 'resolved',
      (error: Error) => 'rejected:' + error.message.slice(0, 40),
    );
    const second = transport.request('cdp.send', { tabId: 1, method: 'B' }, 4_000).then(
      () => 'resolved',
      (error: Error) => 'rejected:' + error.message.slice(0, 40),
    );
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    // Simulate any future throw on the delivery path (today every listener
    // call is wrapped, so this is a what-if, not a live bug).
    let thrown = 0;
    (transport as unknown as { handleMessage: (message: unknown) => void }).handleMessage = () => {
      thrown += 1;
      throw new Error('delivery boom');
    };
    socket.write(
      Buffer.concat([
        encodeFrame({ type: 'response', id: requests[0]!.id, ok: true, result: {} }),
        encodeFrame({ type: 'event', tabId: 1, method: 'Runtime.consoleAPICalled', params: {} }),
      ]),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Restore delivery and send the second response on the same socket.
    delete (transport as unknown as { handleMessage?: unknown }).handleMessage;
    socket.write(encodeFrame({ type: 'response', id: requests[1]!.id, ok: true, result: {} }));
    const outcomes = await Promise.all([first, second]);
    process.stdout.write(
      `\nR5-T2 ${JSON.stringify({ throwsSeen: thrown, uncaught, socketDestroyed: socket.destroyed, connected: transport.isConnected(), first: outcomes[0], second: outcomes[1] })}\n`,
    );
  } finally {
    process.off('uncaughtException', onUncaught);
  }
}, 20_000);
