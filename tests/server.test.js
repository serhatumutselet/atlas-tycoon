process.env.ATLAS_PACE = '0';
const test = require('node:test');
const assert = require('node:assert');
const { server } = require('../server/server.js');

let base;
test.before(() => new Promise((r) => server.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); })));
test.after(() => { server.closeAllConnections(); server.close(); });

const post = (path, body) => fetch(base + '/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

// Minimal SSE reader: calls onMsg for each JSON message until it returns true.
async function listen(code, token, onMsg) {
  const res = await fetch(`${base}/api/rooms/${code}/stream?token=${token}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (!chunk.startsWith('data: ')) continue;
      if (await onMsg(JSON.parse(chunk.slice(6)))) { reader.cancel(); return; }
    }
  }
}

test('static files are served and paths outside the app are refused', async () => {
  assert.strictEqual((await fetch(base + '/')).status, 200);
  assert.strictEqual((await fetch(base + '/js/engine.js')).status, 200);
  assert.strictEqual((await fetch(base + '/server/server.js')).status, 404);
  assert.strictEqual((await fetch(base + '/js/..%2fpackage.json')).status, 404);
});

test('lobby rules: join, host-only controls, full room', async () => {
  const host = await post('rooms', { name: 'Hosty' });
  assert.strictEqual(host.status, 200);
  const guest = await post(`rooms/${host.body.code}/join`, { name: '<b>Guest</b>' });
  assert.strictEqual(guest.body.seat, 1);
  assert.strictEqual((await post(`rooms/${host.body.code}/start`, { token: guest.body.token })).status, 403);
  assert.strictEqual((await post(`rooms/${host.body.code}/bot`, { token: host.body.token, add: true })).status, 200);
  assert.strictEqual((await post(`rooms/${host.body.code}/bot`, { token: host.body.token, add: true })).status, 200);
  assert.strictEqual((await post(`rooms/${host.body.code}/bot`, { token: host.body.token, add: true })).status, 409);
  assert.strictEqual((await post(`rooms/${host.body.code}/join`, { name: 'Late' })).status, 409);
  assert.strictEqual((await post('rooms/ZZZZZ/join', { name: 'x' })).status, 404);
});

test('an online game runs to the end with a human answering requests', async () => {
  const host = await post('rooms', { name: 'Host' });
  const { code, token } = host.body;
  await post(`rooms/${code}/bot`, { token, add: true });
  await post(`rooms/${code}/settings`, { token, maxRounds: 20 });
  let started = false, requests = 0, events = 0, over = null;
  await listen(code, token, async (msg) => {
    if (msg.kind === 'hello' && !started) {
      started = true;
      assert.strictEqual(msg.seat, 0);
      assert.strictEqual((await post(`rooms/${code}/start`, { token })).status, 200);
    }
    if (msg.kind === 'event') {
      events++;
      if (msg.evt.type === 'gameOver') over = msg.evt;
    }
    if (msg.kind === 'request') {
      assert.strictEqual(msg.seat, 0);
      requests++;
      // A stale request id is refused; the real answer is accepted.
      assert.strictEqual((await post(`rooms/${code}/answer`, { token, reqId: 'nope', value: true })).status, 409);
      const r = msg.req;
      const value = r.type === 'roll' ? true : r.type === 'buy' || r.type === 'build' ? r.options[r.options.length - 1].level
        : r.type === 'island' ? 'roll' : r.choices ? r.choices[0] : true;
      assert.strictEqual((await post(`rooms/${code}/answer`, { token, reqId: msg.reqId, value })).status, 200);
    }
    return !!over;
  });
  assert.ok(over, 'game over received');
  assert.ok(requests > 10 && events > 50);
});
