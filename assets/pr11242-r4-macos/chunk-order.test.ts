/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

// Chrome-free regression probe for the claimed-tab hang: when one socket chunk
// carries a response followed by events, the response must reach its caller
// first. Playwright's crPage._initialize installs its renderer and lifecycle
// listeners inside Page.getFrameTree().then(...), so an event that overtakes
// that response is dropped for good on an already-loaded page.

import { connect } from 'node:net';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CHROME_BRIDGE_PROTOCOL_VERSION,
  CHROME_EXTENSION_ID,
} from '../protocol.js';
import { ChromeExtensionTransport } from './chrome-extension-transport.js';
import { encodeFrame, FrameDecoder } from './framing.js';

const roots: string[] = [];
const transports: ChromeExtensionTransport[] = [];

afterEach(async () => {
  for (const transport of transports.splice(0)) await transport.stop();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe('bridge delivery order inside one socket chunk', () => {
  it('settles a response before the events that follow it in the same chunk', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qbu-order-'));
    roots.push(root);
    const transport = new ChromeExtensionTransport({
      socketPath: path.join(root, 'bridge.sock'),
    });
    transports.push(transport);
    await transport.start();

    const seen: string[] = [];
    transport.onEvent((event) => seen.push(`event:${event.method}`));

    const socket = connect(transport.socketPath);
    socket.on('error', () => undefined);
    const decoder = new FrameDecoder();
    let requestId: string | undefined;
    let resolveRequest: () => void = () => {};
    const gotRequest = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });
    socket.on('data', (chunk: Buffer) => {
      for (const message of decoder.push(chunk)) {
        requestId = (message as { id: string }).id;
        resolveRequest();
      }
    });
    await once(socket, 'connect');
    socket.write(
      encodeFrame({
        type: 'hello',
        protocolVersion: CHROME_BRIDGE_PROTOCOL_VERSION,
        extensionId: CHROME_EXTENSION_ID,
        extensionInstanceId: 'profile-a',
      }),
    );

    // Playwright's Page.getFrameTree, and the consumer chain that hands its
    // result back (request() -> sendCommand() -> handle().then(emit)).
    const pending = transport
      .request('cdp.send', {
        tabId: 1,
        method: 'Page.getFrameTree',
        params: {},
      })
      .then(() => seen.push('response:Page.getFrameTree'));
    await gotRequest;

    // One chunk, written once: the response first, then the events Chrome
    // emits for the already-loaded page.
    socket.write(
      Buffer.concat([
        encodeFrame({
          type: 'response',
          id: requestId,
          ok: true,
          result: { frameTree: {} },
        }),
        encodeFrame({
          type: 'event',
          tabId: 1,
          method: 'Runtime.executionContextCreated',
          params: {},
        }),
        encodeFrame({
          type: 'event',
          tabId: 1,
          method: 'Page.lifecycleEvent',
          params: { name: 'load' },
        }),
      ]),
    );

    await pending;
    await new Promise((resolve) => setTimeout(resolve, 50));
    socket.destroy();

    expect(seen).toEqual([
      'response:Page.getFrameTree',
      'event:Runtime.executionContextCreated',
      'event:Page.lifecycleEvent',
    ]);
  });
});
