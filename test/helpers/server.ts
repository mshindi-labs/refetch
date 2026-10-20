import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export interface EchoPayload {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface TestServer {
  baseURL: string;
  /** Requests received for a pathname since the last reset. */
  hits(path: string): number;
  resetHits(): void;
  close(): Promise<void>;
}

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function raw(
  res: ServerResponse,
  status: number,
  type: string | undefined,
  body: string | Uint8Array,
): void {
  res.writeHead(status, type ? { 'content-type': type } : {});
  res.end(body);
}

/**
 * Starts a real HTTP server on an ephemeral port with routes that exercise every
 * parsing, retry, timeout and cancellation path of the client.
 */
export async function startTestServer(): Promise<TestServer> {
  const hits = new Map<string, number>();
  const flaky = new Map<string, number>();
  const closing = new AbortController();
  // Delays are cancelled on close so a slow route never keeps the worker alive.
  const wait = (ms: number) =>
    delay(ms, undefined, { signal: closing.signal }).catch(() => undefined);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const ms = Number(url.searchParams.get('ms') ?? '0');
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const body = await readBody(req);

    if (path.startsWith('/status/')) {
      const status = Number(path.slice('/status/'.length));
      return json(res, status, { status });
    }

    switch (path) {
      case '/json':
        return json(res, 200, { ok: true });
      case '/vnd-json':
        return raw(res, 200, 'application/vnd.api+json', '{"data":{"id":"1"}}');
      case '/json-charset':
        return raw(res, 200, 'application/json; charset=utf-8', '{"charset":true}');
      case '/text':
        return raw(res, 200, 'text/plain', 'hello');
      case '/text-json':
        return raw(res, 200, 'text/plain', '{"a":1}');
      case '/xml':
        return raw(res, 200, 'application/xml', '<a/>');
      case '/form':
        return raw(res, 200, 'application/x-www-form-urlencoded', 'a=1&b=two');
      case '/png':
        return raw(res, 200, 'image/png', PNG_SIGNATURE);
      case '/pdf':
        return raw(res, 200, 'application/pdf', '%PDF-1.7');
      case '/no-content-type':
        return raw(res, 200, undefined, 'raw');
      case '/empty-204':
        res.writeHead(204);
        return res.end();
      case '/content-length-0':
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': '0' });
        return res.end();
      case '/bad-json':
        return raw(res, 200, 'application/json', '{not json');
      case '/echo': {
        const payload: EchoPayload = {
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body,
        };
        return json(res, 200, payload);
      }
      case '/slow-headers':
        await wait(ms);
        if (closing.signal.aborted) return;
        return json(res, 200, { slow: true });
      case '/slow-body':
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"partial":');
        await wait(ms);
        if (closing.signal.aborted) return;
        return res.end('true}');
      case '/flaky': {
        const key = url.searchParams.get('key') ?? 'default';
        const failures = Number(url.searchParams.get('fails') ?? '0');
        const attempt = (flaky.get(key) ?? 0) + 1;
        flaky.set(key, attempt);
        if (attempt <= failures) return json(res, 500, { attempt, failed: true });
        return json(res, 200, { attempt, failed: false });
      }
      case '/redirect':
        res.writeHead(301, { location: '/json' });
        return res.end();
      case '/stream':
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('chunk1');
        await wait(20);
        res.write('chunk2');
        return res.end();
      default:
        return json(res, 404, { error: 'not found' });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseURL: `http://127.0.0.1:${port}`,
    hits: (path) => hits.get(path) ?? 0,
    resetHits: () => {
      hits.clear();
      flaky.clear();
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        closing.abort();
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
