/**
 * A local stand-in for the DingTalk Card OpenAPI + the DingTalk client cache.
 *
 * The Qwen Code side of the wire is real: the production
 * DingtalkInteractiveCardClient issues real HTTP requests over loopback; only
 * the host part of the URL is rewritten. Faults are injected at the socket /
 * status-code level so the client's own error classification runs unmodified.
 *
 * The client model reproduces the behaviour reported in issue #10354:
 *   - `PUT /v1.0/card/streaming` frames are an ephemeral push. A DingTalk
 *     client that is offline when a frame is emitted never sees that frame and
 *     it is not replayed on reconnect.
 *   - `PUT /v1.0/card/instances` (updateCardDataByKey) writes the authoritative
 *     instance data; a client that is online when it lands renders it.
 * Both channels write the same `content` card parameter.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type FaultMode = 'blackhole' | 'status';

export interface Fault {
  /** 'all' or a list of path prefixes. */
  paths: 'all' | string[];
  mode: FaultMode;
  status?: number;
  /** Number of matching requests to fail; undefined = until cleared. */
  remaining?: number;
}

export interface RequestLogEntry {
  t: number;
  method: string;
  path: string;
  bytes: number;
  status: number | 'destroyed';
  contentLen?: number;
  params?: string[];
}

export interface CardEvent {
  seq: number;
  t: number;
  type: 'create' | 'stream' | 'instance';
  outTrackId: string;
  params?: Record<string, string>;
  key?: string;
  content?: string;
  finalize?: boolean;
}

export interface ClientSnapshot {
  t: number;
  via: CardEvent['type'];
  content: string;
  statusLine: string;
  flowStatus: string;
  stopAction: string;
}

/**
 * How a DingTalk client behaves after it drops off the network mid-stream:
 *   m2 - the card's streaming subscription is not restored, so the client only
 *        ever sees later *instance* updates. This is the model implied by the
 *        divergence reported in issue #10354 (two clients on the same card, the
 *        reconnected one frozen on an older phase).
 *   m1 - the client re-attaches to the stream and the next `isFull` frame
 *        repairs it on its own.
 */
export type ClientModel = 'm1' | 'm2';

export class SimClient {
  online = true;
  card: Record<string, string> = {};
  delivered = false;
  streamClosed = false;
  missedEvents = 0;
  missedStreamFramesAfterReconnect = 0;
  private streamSubscriptionLost = false;
  readonly history: ClientSnapshot[] = [];

  constructor(
    readonly name: string,
    private readonly clock: () => number,
    private readonly model: ClientModel = 'm2',
  ) {}

  setOnline(online: boolean): void {
    if (!online && this.model === 'm2') this.streamSubscriptionLost = true;
    this.online = online;
  }

  apply(event: CardEvent): void {
    if (!this.online) {
      this.missedEvents++;
      return;
    }
    if (event.type === 'stream' && this.streamSubscriptionLost) {
      this.missedStreamFramesAfterReconnect++;
      return;
    }
    if (event.type === 'create') {
      this.delivered = true;
      this.card = { ...(event.params ?? {}) };
    } else if (event.type === 'stream') {
      if (!this.delivered) return;
      if (event.key === 'content' && !event.finalize) {
        this.card['content'] = event.content ?? '';
      }
      if (event.finalize) this.streamClosed = true;
    } else {
      if (!this.delivered) return;
      // updateCardDataByKey: per-key merge into the rendered card.
      for (const [k, v] of Object.entries(event.params ?? {})) {
        this.card[k] = v;
      }
    }
    this.history.push({
      t: this.clock(),
      via: event.type,
      content: this.card['content'] ?? '',
      statusLine: this.card['statusLine'] ?? '',
      flowStatus: this.card['flowStatus'] ?? '',
      stopAction: this.card['stop_action'] ?? '',
    });
  }
}

export class FakeDingtalkServer {
  private server!: http.Server;
  private seq = 0;
  private fault: Fault | null = null;
  private latencyMs = new Map<string, number>();
  readonly requests: RequestLogEntry[] = [];
  readonly events: CardEvent[] = [];
  readonly clients: SimClient[] = [];
  /** Authoritative server-side instance state (what a fresh render would show). */
  readonly instances = new Map<string, Record<string, string>>();
  readonly streamKeys = new Map<string, Record<string, string>>();
  baseUrl = '';
  readonly t0 = Date.now();

  now(): number {
    return Date.now() - this.t0;
  }

  clientModel: ClientModel =
    (process.env['CLIENT_MODEL'] as ClientModel | undefined) ?? 'm2';

  addClient(name: string): SimClient {
    const client = new SimClient(name, () => this.now(), this.clientModel);
    this.clients.push(client);
    return client;
  }

  setFault(fault: Fault | null): void {
    this.fault = fault;
  }

  /** key is an exact `METHOD /path`, e.g. `PUT /v1.0/card/instances`. */
  setLatency(key: string, ms: number): void {
    if (ms <= 0) this.latencyMs.delete(key);
    else this.latencyMs.set(key, ms);
  }

  private matches(fault: Fault, path: string): boolean {
    if (fault.paths === 'all') return path.startsWith('/v1.0/card');
    return fault.paths.some((p) => path.startsWith(p));
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        void this.handle(req, res, body);
      });
    });
    await new Promise<void>((resolve) =>
      this.server.listen(0, '127.0.0.1', resolve),
    );
    const address = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: Buffer,
  ): Promise<void> {
    const path = (req.url ?? '').split('?')[0];
    const method = req.method ?? 'GET';
    const t = this.now();

    const latency = this.latencyMs.get(`${method} ${path}`);
    if (latency) await new Promise((r) => setTimeout(r, latency));

    const fault = this.fault;
    if (fault && this.matches(fault, path)) {
      if (fault.remaining !== undefined) {
        fault.remaining -= 1;
        if (fault.remaining <= 0) this.fault = null;
      }
      if (fault.mode === 'blackhole') {
        this.requests.push({
          t,
          method,
          path,
          bytes: body.length,
          status: 'destroyed',
        });
        req.socket.destroy();
        return;
      }
      const status = fault.status ?? 503;
      this.requests.push({ t, method, path, bytes: body.length, status });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'Injected', message: 'injected fault' }));
      return;
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(body.toString('utf8') || '{}');
    } catch {
      payload = {};
    }
    const outTrackId = String(payload['outTrackId'] ?? '');
    let logged: Partial<RequestLogEntry> = {};

    if (path === '/v1.0/card/instances/createAndDeliver' && method === 'POST') {
      const params = ((payload['cardData'] as Record<string, unknown>)?.[
        'cardParamMap'
      ] ?? {}) as Record<string, string>;
      this.instances.set(outTrackId, { ...params });
      this.emit({
        seq: ++this.seq,
        t,
        type: 'create',
        outTrackId,
        params: { ...params },
      });
      logged = {
        contentLen: (params['content'] ?? '').length,
        params: Object.keys(params),
      };
    } else if (path === '/v1.0/card/streaming' && method === 'PUT') {
      const key = String(payload['key'] ?? '');
      const content = String(payload['content'] ?? '');
      const finalize = Boolean(payload['isFinalize']);
      const keys = this.streamKeys.get(outTrackId) ?? {};
      if (!finalize) keys[key] = content;
      this.streamKeys.set(outTrackId, keys);
      const instance = this.instances.get(outTrackId);
      if (instance && !finalize) instance[key] = content;
      this.emit({
        seq: ++this.seq,
        t,
        type: 'stream',
        outTrackId,
        key,
        content,
        finalize,
      });
      logged = { contentLen: content.length, params: [key] };
    } else if (path === '/v1.0/card/instances' && method === 'PUT') {
      const params = ((payload['cardData'] as Record<string, unknown>)?.[
        'cardParamMap'
      ] ?? {}) as Record<string, string>;
      const instance = this.instances.get(outTrackId) ?? {};
      Object.assign(instance, params);
      this.instances.set(outTrackId, instance);
      this.emit({
        seq: ++this.seq,
        t,
        type: 'instance',
        outTrackId,
        params: { ...params },
      });
      logged = {
        contentLen: (params['content'] ?? '').length,
        params: Object.keys(params),
      };
    }

    this.requests.push({
      t,
      method,
      path,
      bytes: body.length,
      status: 200,
      ...logged,
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ requestId: 'req', result: {} }));
  }

  private emit(event: CardEvent): void {
    this.events.push(event);
    for (const client of this.clients) client.apply(event);
  }
}
