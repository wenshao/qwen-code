/**
 * Scratch probe for PR #13304 verification (not part of the PR).
 * Uses the real HostedShellPublisher to enumerate when close() can reject
 * and when it settles relative to the event loop's I/O phase.
 */
import net from 'node:net';
import { writeFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { HostedShellPublisher } from '../hosted-shell-publisher.js';

const out: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  writeFileSync(process.env['PROBE_OUT'] ?? '/dev/null', out.join('\n') + '\n');
});

function publisher() {
  return new HostedShellPublisher(
    {} as never,
    {} as never,
    async () => {},
    'runtime-session',
  );
}

it('P1 a listening publisher: close() waits for a held connection and never rejects', async () => {
  const p = publisher();
  const { url, token } = await p.start();
  const target = new URL(url);
  const socket = net.connect(Number(target.port), target.hostname);
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
  socket.write(
    `POST ${target.pathname} HTTP/1.1\r\nHost: ${target.host}\r\n` +
      `Authorization: Bearer ${token}\r\nContent-Type: application/json\r\n` +
      'Content-Length: 64\r\n\r\n{',
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  let state = 'pending';
  const started = Date.now();
  const closing = p.close().then(
    () => (state = 'resolved'),
    (cause: unknown) => (state = 'rejected: ' + String(cause)),
  );
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  out.push(`P1 after 2000ms with a held connection: close() ${state}`);
  expect(state).toBe('pending');
  socket.destroy();
  await closing;
  out.push(`P1 after the client socket closed: close() ${state} at ${Date.now() - started}ms`);
  expect(state).toBe('resolved');
});

it('P2 a publisher that never listened: close() rejects before any I/O callback can run', async () => {
  const listen = vi
    .spyOn(net.Server.prototype, 'listen')
    .mockImplementation(function (this: net.Server) {
      const error = Object.assign(new Error('listen EMFILE (injected)'), {
        code: 'EMFILE',
      });
      process.nextTick(() => this.emit('error', error));
      return this;
    });
  const p = publisher();
  await expect(p.start()).rejects.toThrow('EMFILE');
  listen.mockRestore();
  const events: string[] = [];
  setImmediate(() => events.push('setImmediate (check phase)'));
  setTimeout(() => events.push('setTimeout 0 (timers phase)'), 0);
  await p.close().then(
    () => events.push('close() resolved'),
    (cause: unknown) =>
      events.push('close() rejected: ' + (cause as NodeJS.ErrnoException).code),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  out.push('P2 order: ' + events.join(' -> '));
  expect(events[0]).toBe('close() rejected: ERR_SERVER_NOT_RUNNING');
});

it('P3 once close() starts, Node stops reaping the held request (requestTimeout no longer applies)', async () => {
  const hold = async (p: HostedShellPublisher) => {
    const { url, token } = await p.start();
    const target = new URL(url);
    const socket = net.connect(Number(target.port), target.hostname);
    const seen = { reply: '', closedAt: 0 };
    socket.on('data', (d) => (seen.reply += d.toString()));
    socket.on('close', () => (seen.closedAt = Date.now()));
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    socket.write(
      `POST ${target.pathname} HTTP/1.1\r\nHost: ${target.host}\r\n` +
        `Authorization: Bearer ${token}\r\nContent-Type: application/json\r\n` +
        'Content-Length: 64\r\n\r\n{',
    );
    return { socket, seen };
  };
  const control = publisher();
  const draining = publisher();
  const a = await hold(control);
  const b = await hold(draining);
  // Let both held requests reach the publisher route (body parser waiting).
  await new Promise((resolve) => setTimeout(resolve, 200));
  const started = Date.now();
  let drainState = 'pending';
  void draining.close().then(
    () => (drainState = 'resolved'),
    () => (drainState = 'rejected'),
  );
  await new Promise((resolve) => setTimeout(resolve, 65_000));
  out.push(
    `P3 control (no close): held request ${a.seen.closedAt ? `reaped after ${a.seen.closedAt - started}ms with "${a.seen.reply.split('\r\n')[0]}"` : 'still open'}`,
  );
  out.push(
    `P3 draining (close called): held request ${b.seen.closedAt ? `closed after ${b.seen.closedAt - started}ms with "${b.seen.reply.split('\r\n')[0]}"` : 'still open'} after 65000ms; close() ${drainState}`,
  );
  expect(a.seen.closedAt).toBeGreaterThan(0);
  expect(b.seen.closedAt).toBe(0);
  expect(drainState).toBe('pending');
  b.socket.destroy();
  await control.close();
  await draining.close();
}, 90_000);
