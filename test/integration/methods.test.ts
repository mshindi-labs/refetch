import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  create,
  mergeHeaders,
  NetworkError,
  ParseError,
  PROBLEM_CODE,
  type QueryParams,
  type RefetchInstance,
} from '../../src/index';
import { asError, asOk } from '../helpers/assert';
import {
  closedBaseURL,
  type EchoPayload,
  startTestServer,
  type TestServer,
} from '../helpers/server';

let server: TestServer;
let api: RefetchInstance;

beforeAll(async () => {
  server = await startTestServer();
  api = create({ baseURL: server.baseURL });
});

afterAll(() => server.close());

beforeEach(() => server.resetHits());

describe('HTTP methods', () => {
  it('GET parses JSON and exposes status, headers, duration and the raw Response', async () => {
    const result = asOk(await api.get<{ ok: boolean }>('/json'));
    expect(result.data).toEqual({ ok: true });
    expect(result.status).toBe(200);
    expect(result.problem).toBeNull();
    expect(result.originalError).toBeNull();
    expect(result.headers?.['content-type']).toBe('application/json');
    expect(result.duration).toBeTypeOf('number');
    expect(result.response).toBeInstanceOf(Response);
  });

  it('GET appends params to the query string', async () => {
    const result = asOk(await api.get<EchoPayload>('/echo', { page: 2, tags: ['a', 'b'] }));
    expect(result.data.url).toBe('/echo?page=2&tags=a&tags=b');
  });

  it('accepts URLSearchParams and tuple params and serialises Dates as ISO 8601', async () => {
    const search = asOk(await api.get<EchoPayload>('/echo', new URLSearchParams({ q: 'x y' })));
    expect(search.data.url).toBe('/echo?q=x+y');
    const tuples = asOk(
      await api.get<EchoPayload>('/echo', [
        ['a', 1],
        ['a', 2],
      ]),
    );
    expect(tuples.data.url).toBe('/echo?a=1&a=2');
    const dated = asOk(await api.get<EchoPayload>('/echo', { since: new Date(0) }));
    expect(dated.data.url).toBe('/echo?since=1970-01-01T00%3A00%3A00.000Z');
  });

  it('rejects nested object params with a clear error instead of sending [object Object]', async () => {
    const result = asError(await api.get('/echo', { filter: { a: 1 } }));
    expect(result.originalError).toBeInstanceOf(TypeError);
    expect(result.originalError?.message).toContain('filter');
    expect(server.hits('/echo')).toBe(0);
  });

  it('uses paramsSerializer from the instance or the request', async () => {
    const bracket = (params: QueryParams) =>
      Object.entries(params as Record<string, unknown>)
        .flatMap(([key, value]) =>
          Array.isArray(value) ? value.map((item) => `${key}[]=${item}`) : [`${key}=${value}`],
        )
        .join('&');
    const local = create({ baseURL: server.baseURL, paramsSerializer: bracket });
    expect(asOk(await local.get<EchoPayload>('/echo', { tags: ['a', 'b'] })).data.url).toBe(
      '/echo?tags[]=a&tags[]=b',
    );
    const perRequest = await local.get<EchoPayload>(
      '/echo',
      { tags: ['a'] },
      { paramsSerializer: () => 'x=1' },
    );
    expect(asOk(perRequest).data.url).toBe('/echo?x=1');
  });

  it('POST sends JSON bodies with application/json', async () => {
    const result = asOk(await api.post<EchoPayload, { n: number }>('/echo', { n: 1 }));
    expect(result.data.method).toBe('POST');
    expect(result.data.headers['content-type']).toBe('application/json');
    expect(JSON.parse(result.data.body)).toEqual({ n: 1 });
  });

  it('PUT and PATCH behave like POST', async () => {
    const put = asOk(await api.put<EchoPayload, { n: number }>('/echo', { n: 2 }));
    expect(put.data.method).toBe('PUT');
    expect(JSON.parse(put.data.body)).toEqual({ n: 2 });

    const patch = asOk(await api.patch<EchoPayload, { n: number }>('/echo', { n: 3 }));
    expect(patch.data.method).toBe('PATCH');
    expect(JSON.parse(patch.data.body)).toEqual({ n: 3 });
  });

  it('body methods still accept params through the config', async () => {
    const result = asOk(await api.post<EchoPayload>('/echo', { n: 1 }, { params: { q: 'x' } }));
    expect(result.data.url).toBe('/echo?q=x');
  });

  it('DELETE sends params as query and no body', async () => {
    const result = asOk(await api.delete<EchoPayload>('/echo', { id: 7 }));
    expect(result.data.method).toBe('DELETE');
    expect(result.data.url).toBe('/echo?id=7');
    expect(result.data.body).toBe('');
  });

  it.todo('DELETE sends a body when data is provided (#27)');

  it('HEAD resolves with null data', async () => {
    const result = asOk(await api.head('/json'));
    expect(result.data).toBeNull();
    expect(result.status).toBe(200);
  });

  it('LINK and UNLINK use the matching verbs', async () => {
    expect(asOk(await api.link<EchoPayload>('/echo')).data.method).toBe('LINK');
    expect(asOk(await api.unlink<EchoPayload>('/echo')).data.method).toBe('UNLINK');
  });

  it('any() sends arbitrary verbs with bodies and headers', async () => {
    const result = asOk(
      await api.any<EchoPayload>({
        method: 'PROPFIND',
        url: '/echo',
        data: { depth: 1 },
        headers: { Depth: '1' },
      }),
    );
    expect(result.data.method).toBe('PROPFIND');
    expect(JSON.parse(result.data.body)).toEqual({ depth: 1 });
    expect(result.data.headers.depth).toBe('1');
  });

  it('absolute URLs bypass baseURL', async () => {
    const elsewhere = create({ baseURL: 'http://127.0.0.1:1' });
    expect(asOk(await elsewhere.get(`${server.baseURL}/json`)).data).toEqual({ ok: true });
  });
});

describe('response.request', () => {
  it('describes the request as sent on success', async () => {
    const result = asOk(
      await api.post<EchoPayload, { n: number }>(
        '/echo',
        { n: 1 },
        { params: { q: 'x' }, context: { tag: 't' } },
      ),
    );
    expect(result.request).toMatchObject({
      url: `${server.baseURL}/echo?q=x`,
      method: 'POST',
      attempt: 1,
      body: { n: 1 },
    });
    expect(result.request?.headers).toMatchObject({
      accept: 'application/json',
      'content-type': 'application/json',
    });
    expect(result.request?.config).toMatchObject({
      url: '/echo',
      method: 'POST',
      context: { tag: 't' },
    });
  });

  it('redacts credential headers in the snapshot but keeps the replayable config intact', async () => {
    const result = asOk(
      await api.get<EchoPayload>('/echo', undefined, {
        headers: {
          Authorization: 'Bearer secret',
          Cookie: 'sid=1',
          'X-Api-Key': 'k',
          'X-Trace': 't',
        },
      }),
    );
    expect(result.request?.headers).toMatchObject({
      authorization: '[redacted]',
      cookie: '[redacted]',
      'x-api-key': '[redacted]',
      'x-trace': 't',
    });
    expect(mergeHeaders(result.request?.config.headers).get('authorization')).toBe('Bearer secret');
    expect(result.data.headers.authorization).toBe('Bearer secret');
  });

  it('is present on http and transport failures', async () => {
    const http = asError(await api.get('/status/500'));
    expect(http.request).toMatchObject({
      url: `${server.baseURL}/status/500`,
      method: 'GET',
      attempt: 1,
    });
    const dead = create({ baseURL: await closedBaseURL() });
    const network = asError(await dead.get('/x', { a: 1 }));
    expect(network.request?.url).toMatch(/\/x\?a=1$/);
    expect(network.request?.method).toBe('GET');
  });

  it('counts attempts across retries', async () => {
    const attempts: (number | undefined)[] = [];
    const local = create({ baseURL: server.baseURL });
    local.addMonitor((response) => {
      attempts.push(response.request?.attempt);
    });
    const result = asOk(await local.get('/flaky?key=attempts&fails=2', undefined, { retry: 3 }));
    expect(result.request?.attempt).toBe(3);
    expect(attempts).toEqual([1, 2, 3]);
  });
});

describe('headers and request bodies', () => {
  it('sends Accept: application/json by default and merges instance and request headers', async () => {
    const local = create({
      baseURL: server.baseURL,
      headers: { 'X-Instance': 'i', 'X-Shared': 'instance' },
    });
    const result = asOk(
      await local.get<EchoPayload>('/echo', undefined, {
        headers: { 'x-shared': 'request', 'X-Request': 'r' },
      }),
    );
    expect(result.data.headers.accept).toBe('application/json');
    expect(result.data.headers['x-instance']).toBe('i');
    expect(result.data.headers['x-request']).toBe('r');
    expect(result.data.headers['x-shared']).toBe('request');
  });

  it('setHeader, setHeaders and deleteHeader affect subsequent requests', async () => {
    const local = create({ baseURL: server.baseURL });
    local.setHeader('X-One', '1');
    local.setHeaders({ 'X-Two': '2', 'X-Three': '3' });
    local.deleteHeader('X-Three');
    const { headers } = asOk(await local.get<EchoPayload>('/echo')).data;
    expect(headers['x-one']).toBe('1');
    expect(headers['x-two']).toBe('2');
    expect(headers['x-three']).toBeUndefined();
  });

  it('lets the runtime set the multipart boundary for FormData', async () => {
    const form = new FormData();
    form.append('field', 'value');
    const result = asOk(await api.post<EchoPayload>('/echo', form));
    expect(result.data.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(result.data.body).toContain('name="field"');
  });

  it('drops an instance-level JSON Content-Type for FormData bodies', async () => {
    const local = create({
      baseURL: server.baseURL,
      headers: { 'Content-Type': 'application/json' },
    });
    const result = asOk(await local.post<EchoPayload>('/echo', new FormData()));
    expect(result.data.headers['content-type']).toMatch(/^multipart\/form-data/);
  });

  it('encodes URLSearchParams as form-urlencoded', async () => {
    const result = asOk(await api.post<EchoPayload>('/echo', new URLSearchParams({ a: '1' })));
    expect(result.data.headers['content-type']).toBe(
      'application/x-www-form-urlencoded;charset=UTF-8',
    );
    expect(result.data.body).toBe('a=1');
  });

  it('labels string bodies as JSON unless Content-Type is set explicitly', async () => {
    const asJson = asOk(await api.post<EchoPayload>('/echo', 'raw text'));
    expect(asJson.data.headers['content-type']).toBe('application/json');

    const asCsv = asOk(
      await api.post<EchoPayload>('/echo', 'a,b', { headers: { 'Content-Type': 'text/csv' } }),
    );
    expect(asCsv.data.headers['content-type']).toBe('text/csv');
    expect(asCsv.data.body).toBe('a,b');
  });

  it('uses the Blob type and octet-stream for binary bodies', async () => {
    const blob = asOk(await api.post<EchoPayload>('/echo', new Blob(['x'], { type: 'text/csv' })));
    expect(blob.data.headers['content-type']).toBe('text/csv');

    const bytes = asOk(await api.post<EchoPayload>('/echo', new Uint8Array([104, 105])));
    expect(bytes.data.headers['content-type']).toBe('application/octet-stream');
    expect(bytes.data.body).toBe('hi');
  });

  it('sends ReadableStream bodies', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hi'));
        controller.close();
      },
    });
    const result = asOk(await api.post<EchoPayload>('/echo', stream));
    expect(result.data.body).toBe('hi');
  });

  it('accepts an explicit duplex and never retries a one-shot stream body', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'));
        controller.close();
      },
    });
    const result = await api.post('/flaky?key=stream-body&fails=10', stream, {
      retry: { attempts: 3 },
      duplex: 'half',
    });
    expect(result.status).toBe(500);
    expect(server.hits('/flaky')).toBe(1);
  });
});

describe('response parsing', () => {
  it.each([
    ['/vnd-json', { data: { id: '1' } }],
    ['/json-charset', { charset: true }],
    ['/form', { a: '1', b: 'two' }],
  ])('parses %s', async (path, expected) => {
    expect(asOk(await api.get(path)).data).toEqual(expected);
  });

  it('returns text for text/* and XML', async () => {
    expect(asOk(await api.get('/text')).data).toBe('hello');
    expect(asOk(await api.get('/xml')).data).toBe('<a/>');
  });

  it('returns Blobs for binary types', async () => {
    const png = asOk(await api.get<Blob>('/png'));
    expect(png.data).toBeInstanceOf(Blob);
    expect(png.data.type).toBe('image/png');
    expect(png.data.size).toBe(8);
    expect(asOk(await api.get('/pdf')).data).toBeInstanceOf(Blob);
  });

  it('returns null for 204 and content-length: 0 responses', async () => {
    expect(asOk(await api.get('/empty-204')).data).toBeNull();
    expect(asOk(await api.get('/content-length-0')).data).toBeNull();
  });

  it('returns text when there is no content-type', async () => {
    expect(asOk(await api.get('/no-content-type')).data).toBe('raw');
  });

  it('keeps JSON served as text/plain as a string (see #22 for responseType)', async () => {
    expect(asOk(await api.get('/text-json')).data).toBe('{"a":1}');
  });

  it('reports malformed JSON on a 2xx as a parse error', async () => {
    const result = asError(await api.get('/bad-json'));
    expect(result.problem).toBe(PROBLEM_CODE.PARSE_ERROR);
    expect(result.error).toMatchObject({ kind: 'parse', contentType: 'application/json' });
    expect(result.status).toBe(200);
    expect(result.headers?.['content-type']).toBe('application/json');
    expect(result.data).toBe('{not json');
    expect(result.originalError).toBeInstanceOf(ParseError);
  });

  it('keeps the http error and the raw body when an error response is malformed', async () => {
    const result = asError(await api.get('/bad-json-500'));
    expect(result.problem).toBe(PROBLEM_CODE.SERVER_ERROR);
    expect(result.error).toMatchObject({ kind: 'http', status: 500 });
    expect(result.data).toBe('{not json');
  });

  it('reports a connection dropped while reading the body as a network error', async () => {
    const result = asError(await api.get('/drop-body'));
    expect(result.error.kind).toBe('network');
    expect([PROBLEM_CODE.NETWORK_ERROR, PROBLEM_CODE.CONNECTION_ERROR]).toContain(result.problem);
    expect(result.originalError).toBeInstanceOf(NetworkError);
  });
});

describe('error responses', () => {
  it('classifies 4xx as CLIENT_ERROR and keeps the parsed body', async () => {
    const result = asError(await api.get('/status/404'));
    expect(result.problem).toBe(PROBLEM_CODE.CLIENT_ERROR);
    expect(result.error).toEqual({ kind: 'http', status: 404, statusText: 'Not Found' });
    expect(result.data).toEqual({ status: 404 });
    expect(result.originalError?.message).toContain('GET');
    expect(result.originalError?.message).toContain('404');
  });

  it('classifies 5xx as SERVER_ERROR', async () => {
    const result = asError(await api.get('/status/503'));
    expect(result.problem).toBe(PROBLEM_CODE.SERVER_ERROR);
    expect(result.status).toBe(503);
    expect(result.error.kind).toBe('http');
  });

  it('follows redirects by default', async () => {
    expect(asOk(await api.get('/redirect')).data).toEqual({ ok: true });
  });

  it('reports a 301 under redirect: "manual" as an http error', async () => {
    const result = asError(await api.get('/redirect', undefined, { redirect: 'manual' }));
    expect(result.status).toBe(301);
    expect(result.error.kind).toBe('http');
  });

  it('classifies blocked ports as NETWORK_ERROR without a code', async () => {
    const blocked = create({ baseURL: 'http://127.0.0.1:1' });
    const result = asError(await blocked.get('/json'));
    expect(result.problem).toBe(PROBLEM_CODE.NETWORK_ERROR);
    expect(result.error.kind).toBe('network');
    expect(result.originalError).toBeInstanceOf(NetworkError);
    expect((result.originalError as NetworkError).code).toBeUndefined();
  });

  it('classifies refused connections as CONNECTION_ERROR with a NetworkError cause', async () => {
    const dead = create({ baseURL: await closedBaseURL(), timeout: 2000 });
    const result = asError(await dead.get('/json'));
    expect(result.problem).toBe(PROBLEM_CODE.CONNECTION_ERROR);
    expect(result.error.kind).toBe('network');
    expect(result.status).toBeUndefined();
    expect(result.originalError).toBeInstanceOf(NetworkError);
    expect(result.originalError).toBeInstanceOf(TypeError);
    expect((result.originalError as NetworkError).code).toBe('ECONNREFUSED');
  });
});
