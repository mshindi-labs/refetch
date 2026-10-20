// Runtime smoke test for the built package. Runs under Node, Bun and Deno:
//   node scripts/smoke.mjs | bun scripts/smoke.mjs | deno run -A scripts/smoke.mjs
// It only covers behaviour that is correct today; the Vitest suite tracks known bugs.
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const { create, createCancelToken, PROBLEM_CODE } = await import('../dist/index.js');

const runtime = globalThis.Bun
  ? `bun ${globalThis.Bun.version}`
  : globalThis.Deno
    ? `deno ${globalThis.Deno.version.deno}`
    : `node ${process.version}`;

const failures = [];
const check = (name, condition, detail) => {
  if (condition) console.log(`ok   ${name}`);
  else {
    failures.push(name);
    console.log(`FAIL ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
};

let flakyHits = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let body = '';
  for await (const chunk of req) body += chunk;
  switch (url.pathname) {
    case '/json':
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"ok":true}');
    case '/echo':
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ method: req.method, headers: req.headers, body }));
    case '/missing':
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{"error":"missing"}');
    case '/flaky':
      flakyHits += 1;
      res.writeHead(flakyHits < 2 ? 500 : 200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ attempt: flakyHits }));
    case '/slow':
      await delay(400);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"slow":true}');
    case '/stream':
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('a');
      await delay(10);
      return res.end('b');
    default:
      res.writeHead(404);
      return res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const api = create({ baseURL: `http://127.0.0.1:${server.address().port}` });

console.log(`refetch smoke on ${runtime}`);

const json = await api.get('/json');
check('GET parses JSON', json.ok && json.data?.ok === true && json.status === 200, json);

const posted = await api.post('/echo', { n: 1 });
check(
  'POST sends JSON with content-type',
  posted.ok &&
    posted.data?.headers['content-type'] === 'application/json' &&
    posted.data?.body === '{"n":1}',
  posted.data,
);

const form = new FormData();
form.append('f', 'v');
const multipart = await api.post('/echo', form);
check(
  'FormData gets a multipart boundary',
  multipart.ok &&
    /^multipart\/form-data; boundary=/.test(multipart.data?.headers['content-type'] ?? ''),
  multipart.data?.headers,
);

const missing = await api.get('/missing');
check(
  '404 is CLIENT_ERROR with kind http and parsed body',
  !missing.ok &&
    missing.problem === PROBLEM_CODE.CLIENT_ERROR &&
    missing.error?.kind === 'http' &&
    missing.error.status === 404 &&
    missing.data?.error === 'missing',
  missing,
);

const retried = await api.get('/flaky', undefined, { retry: { attempts: 3, delay: 5 } });
check('retry recovers from a 500', retried.ok && retried.data?.attempt === 2, retried);

const { token, cancel } = createCancelToken();
const pending = api.get('/slow', undefined, { signal: token });
setTimeout(() => cancel('bye'), 20);
const cancelled = await pending;
check(
  'cancellation is reported',
  !cancelled.ok && cancelled.problem === PROBLEM_CODE.CANCEL_ERROR,
  cancelled,
);

const timedOut = await api.get('/slow', undefined, { timeout: 50 });
check('timeout aborts the request', !timedOut.ok && timedOut.status === undefined, timedOut);

const streamed = await api.stream('/stream');
let text = '';
if (streamed.ok) {
  const reader = streamed.data.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
}
check('stream() yields the raw body', streamed.ok && text === 'ab', { ok: streamed.ok, text });

server.closeAllConnections?.();
await new Promise((resolve) => server.close(resolve));

if (failures.length > 0) {
  console.error(`\n${failures.length} smoke check(s) failed on ${runtime}`);
  process.exit(1);
}
console.log(`\nall smoke checks passed on ${runtime}`);
