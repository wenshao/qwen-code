/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { MANAGED_CONTEXT_ROUTES } from './managed-context-envelope.js';
import { MANAGED_CONTEXT_WORKER_ROUTES } from './managed-context-worker.js';
import {
  OWNED_MANAGED_RUNTIME_ROUTES,
  ownedManagedRuntimeRouteGate,
} from './managed-runtime-attestation-contract.js';

// Candidate extension: the same refusal on both route lists a worker can
// serve, boot v1 and boot v2 (managed-context/1).

const here = path.dirname(fileURLToPath(import.meta.url));
const v3 = JSON.parse(
  fs.readFileSync(
    path.resolve(
      here,
      '../../../core/src/managed-runtime/contracts/managed-tool-result-v1.fixtures.json',
    ),
    'utf8',
  ),
) as {
  routes: ReadonlyArray<{ key: string; method: string; path: string }>;
  requests: Record<string, unknown>;
};
const BOOTS = [
  ['boot v1', OWNED_MANAGED_RUNTIME_ROUTES],
  ['boot v2', MANAGED_CONTEXT_WORKER_ROUTES],
] as const;
const servers = new Set<Server>();

afterEach(async () => {
  await Promise.all(
    [...servers].map((s) => new Promise<void>((r) => s.close(() => r()))),
  );
  servers.clear();
});

describe.each(BOOTS)('Tool v3 admission on a %s worker', (_name, routes) => {
  it('declares no v3 tool-result route', () => {
    const declared = routes.map((route) => route.path);
    for (const route of v3.routes) expect(declared).not.toContain(route.path);
  });

  it('refuses every v3 tool-result route before any handler runs', async () => {
    const reached: string[] = [];
    const app = express();
    app.use((req, res) => {
      reached.push(req.path);
      res.status(200).json({ executed: true });
    });
    const server = createServer(ownedManagedRuntimeRouteGate(app, routes));
    servers.add(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as { port: number };
    for (const route of v3.routes) {
      const response = await fetch(`http://127.0.0.1:${port}${route.path}`, {
        method: route.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(v3.requests[route.key]),
      });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('');
    }
    expect(reached).toEqual([]);
    const control = routes.at(-1)!;
    expect(
      (
        await fetch(`http://127.0.0.1:${port}${control.path}`, {
          method: control.method,
        })
      ).status,
    ).toBe(200);
    expect(reached).toEqual([control.path]);
    void MANAGED_CONTEXT_ROUTES;
  });
});
