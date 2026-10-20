import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { create, type RefetchInstance } from '../../src/index';
import { asError, asOk } from '../helpers/assert';
import { type EchoPayload, startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;
let api: RefetchInstance;

beforeAll(async () => {
  server = await startTestServer();
  api = create({ baseURL: server.baseURL });
});

afterAll(() => server.close());

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += decoder.decode(value, { stream: true });
  }
}

describe('stream()', () => {
  it('returns the raw body stream without parsing', async () => {
    const result = asOk(await api.stream('/stream'));
    expect(result.data).toBeInstanceOf(ReadableStream);
    expect(result.headers?.['content-type']).toBe('text/plain');
    expect(await readAll(result.data)).toBe('chunk1chunk2');
  });

  it('does not parse JSON bodies', async () => {
    const result = asOk(await api.stream('/json'));
    expect(await readAll(result.data)).toBe('{"ok":true}');
  });

  it('applies params and request interceptors', async () => {
    const local = create({ baseURL: server.baseURL });
    local.interceptors.request.use((config) => ({ ...config, headers: { 'X-Stream': 's' } }));

    const result = asOk(await local.stream('/echo', { q: 1 }));
    const echo = JSON.parse(await readAll(result.data)) as EchoPayload;
    expect(echo.url).toBe('/echo?q=1');
    expect(echo.method).toBe('GET');
    expect(echo.headers['x-stream']).toBe('s');
  });

  it('reports HTTP errors without a stream', async () => {
    const result = asError(await api.stream('/status/404'));
    expect(result.error.kind).toBe('http');
    expect(result.status).toBe(404);
  });

  it('reports transport errors', async () => {
    const dead = create({ baseURL: 'http://127.0.0.1:1' });
    expect(asError(await dead.stream('/x')).error.kind).toBe('network');
  });

  it('can be cancelled mid-stream', async () => {
    const controller = new AbortController();
    const result = asOk(
      await api.stream('/slow-body?ms=500', undefined, { signal: controller.signal }),
    );
    const reader = result.data.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('{"partial":');
    controller.abort();
    await expect(reader.read()).rejects.toThrow();
  });

  it('applies the timeout to the headers only, never to the body read', async () => {
    const result = asOk(await api.stream('/slow-body?ms=300', undefined, { timeout: 100 }));
    expect(await readAll(result.data)).toBe('{"partial":true}');
  });

  it.todo('supports POST bodies and SSE decoding (#23)');
});
