const test = require('node:test');
const assert = require('node:assert');
const D = require('../js/data.js');
const { Game } = require('../js/engine.js');
const AI = require('../js/ai.js');

function makeGame(n = 2, seed = 1, decide = AI.decide) {
  const players = Array.from({ length: n }, (_, i) => ({ name: 'P' + i, isBot: true }));
  return new Game({ players, seed, decide });
}

test('board has 32 tiles with corners in place', () => {
  assert.strictEqual(D.TILES.length, 32);
  assert.deepStrictEqual([0, 8, 16, 24].map((i) => D.TILES[i].type), ['start', 'island', 'festival', 'worldTour']);
  assert.strictEqual(D.TILES.filter((t) => t.type === 'city').length, 20);
  assert.strictEqual(D.TILES.filter((t) => t.type === 'resort').length, 4);
});

test('rent doubles with a full group and with the gala', () => {
  const g = makeGame();
  const [a, b] = g.groupTiles(0);
  a.owner = 0;
  const base = g.rent(a);
  b.owner = 0;
  assert.strictEqual(g.rent(a), base * 2);
  g.festival = a.id;
  assert.strictEqual(g.rent(a), base * 4);
});

test('triple, line and resort monopolies are detected', () => {
  let g = makeGame();
  for (const gi of [0, 1, 2]) g.groupTiles(gi).forEach((t) => (t.owner = 0));
  assert.strictEqual(g.checkMonopoly(g.players[0]), 'Triple Monopoly');
  g = makeGame();
  g.tiles.filter((t) => t.side === 3 && (t.type === 'city' || t.type === 'resort')).forEach((t) => (t.owner = 1));
  assert.strictEqual(g.checkMonopoly(g.players[1]), 'Line Monopoly');
  g = makeGame();
  g.tiles.filter((t) => t.type === 'resort').forEach((t) => (t.owner = 0));
  assert.strictEqual(g.checkMonopoly(g.players[0]), 'Resort Monopoly');
});

test('level cap depends on laps and landmark needs a hotel', () => {
  const g = makeGame();
  const p = g.players[0];
  const t = g.tiles[1];
  assert.strictEqual(g.levelCap(p, t), 1);
  p.laps = 5;
  assert.strictEqual(g.levelCap(p, t), 3);
  t.level = 3;
  assert.strictEqual(g.levelCap(p, t), 4);
});

test('short payer sells property and then goes bankrupt', async () => {
  const g = makeGame(3);
  const [p, q] = g.players;
  const t = g.tiles[1];
  t.owner = p.id;
  p.cash = 0;
  assert.strictEqual(await g.charge(p, 10, q, 'test'), true);
  assert.strictEqual(t.owner, -1);
  assert.strictEqual(await g.charge(p, 10000, q, 'test'), false);
  assert.strictEqual(p.bankrupt, true);
});

test('buyout transfers a city and pays the old owner', async () => {
  const g = makeGame(2, 1, (p, req) => (req.type === 'buyout' ? true : -1));
  const [p, q] = g.players;
  const t = g.tiles[30];
  t.owner = q.id;
  t.level = 1;
  const price = g.buyoutPrice(t);
  const rent = g.rent(t);
  p.pos = 30;
  await g.resolveTile(p);
  assert.strictEqual(t.owner, p.id);
  assert.strictEqual(p.cash, 2000 - rent - price);
  assert.strictEqual(q.cash, 2000 + rent + price);
});

test('landmarks cannot be bought out', async () => {
  let asked = false;
  const g = makeGame(2, 1, (p, req) => { if (req.type === 'buyout') asked = true; return -1; });
  const t = g.tiles[1];
  t.owner = 1; t.level = 4;
  g.players[0].pos = 1;
  await g.resolveTile(g.players[0]);
  assert.strictEqual(asked, false);
  assert.strictEqual(t.owner, 1);
});

test('bot-only games always finish and keep invariants', async () => {
  const reasons = {};
  for (let seed = 1; seed <= 300; seed++) {
    const n = 2 + (seed % 3);
    const g = makeGame(n, seed);
    const winner = await g.run();
    assert.ok(winner, 'game ' + seed + ' has a winner');
    assert.ok(!winner.bankrupt);
    for (const p of g.players) assert.ok(p.cash >= 0, `seed ${seed}: ${p.name} cash ${p.cash}`);
    for (const t of g.tiles) {
      if (t.owner >= 0) assert.ok(!g.players[t.owner].bankrupt, `seed ${seed}: bankrupt owner`);
      assert.ok(t.level >= 0 && t.level <= 4);
    }
    reasons[g.winReason] = (reasons[g.winReason] || 0) + 1;
  }
  console.log('win reasons over 300 games:', reasons);
});
