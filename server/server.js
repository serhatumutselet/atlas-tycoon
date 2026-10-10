// Atlas Tycoon online server: serves the static client and runs authoritative games.
// No dependencies. Server -> client uses Server-Sent Events, client -> server uses POST.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const D = require('../js/data.js');
const { Game, eventDuration } = require('../js/engine.js');
const AI = require('../js/ai.js');

const PORT = Number(process.env.PORT) || 5178;
const ROOT = path.resolve(__dirname, '..');
const TURN_SECONDS = 45;
// Multiplier for pacing delays (tests set ATLAS_PACE=0).
const PACE = process.env.ATLAS_PACE != null ? Number(process.env.ATLAS_PACE) : 1;
const MAX_PLAYERS = 4;
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dax'];

const rooms = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * PACE));

// ---------- rooms ----------
function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do code = Array.from({ length: 5 }, () => letters[crypto.randomInt(letters.length)]).join('');
  while (rooms.has(code));
  return code;
}

function cleanName(name, fallback) {
  const n = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);
  return n || fallback;
}

function createRoom(hostName) {
  const room = {
    code: newCode(), seats: [], clients: new Set(), game: null, started: false, finished: false,
    maxRounds: 30, pending: null, log: [], touched: Date.now(),
  };
  rooms.set(room.code, room);
  const seat = addSeat(room, hostName, false);
  return { room, seat };
}

function addSeat(room, name, isBot) {
  const seat = {
    id: room.seats.length, name, isBot, token: isBot ? null : crypto.randomBytes(16).toString('hex'),
    color: D.PLAYER_COLORS[room.seats.length], connected: 0,
  };
  room.seats.push(seat);
  return seat;
}

function lobbyState(room) {
  return {
    code: room.code, started: room.started, finished: room.finished, maxRounds: room.maxRounds,
    seats: room.seats.map((s) => ({ id: s.id, name: s.name, isBot: s.isBot, color: s.color, online: s.isBot || s.connected > 0 })),
  };
}

// ---------- broadcasting ----------
function send(res, msg) {
  res.write(`data: ${JSON.stringify(msg)}\n\n`);
}

function broadcast(room, msg) {
  for (const c of room.clients) send(c.res, msg);
}

// Each client gets its own copy so it learns its (possibly renumbered) seat.
function broadcastLobby(room) {
  const state = lobbyState(room);
  for (const c of room.clients) send(c.res, { kind: 'lobby', room: state, you: c.seat ? c.seat.id : null });
}

// ---------- game ----------
function startGame(room) {
  room.started = true;
  room.game = new Game({
    players: room.seats.map((s) => ({ name: s.name, isBot: s.isBot, color: s.color })),
    rules: { maxRounds: room.maxRounds },
    decide: (p, req) => decide(room, p, req),
    onEvent: (evt) => onEvent(room, evt),
  });
  broadcastLobby(room);
  room.game.run().then(() => {
    room.finished = true;
    room.touched = Date.now();
    broadcastLobby(room);
  }).catch((err) => {
    console.error('game crashed', room.code, err);
    broadcast(room, { kind: 'error', message: 'The game stopped because of a server error.' });
  });
}

async function onEvent(room, evt) {
  const game = room.game;
  const packed = Game.pack(evt);
  if (evt.type === 'log') {
    room.log.push(evt.text);
    if (room.log.length > 100) room.log.shift();
  }
  broadcast(room, { kind: 'event', evt: packed, snap: game.snapshot() });
  room.touched = Date.now();
  const ms = eventDuration(evt);
  if (ms) await sleep(ms);
}

function decide(room, p, req) {
  const seat = room.seats[p.id];
  if (seat.isBot) return sleep(req.type === 'roll' ? 400 : 700).then(() => AI.decide(p, req, room.game));
  return new Promise((resolve) => {
    const reqId = crypto.randomBytes(6).toString('hex');
    const deadline = Date.now() + TURN_SECONDS * 1000;
    const pending = { reqId, seat: p.id, req: Game.pack(req), deadline, resolve: null, timer: null };
    const finish = (value) => {
      if (room.pending !== pending) return;
      clearTimeout(pending.timer);
      room.pending = null;
      broadcast(room, { kind: 'requestDone', reqId });
      resolve(value);
    };
    // Disconnected or slow players are played by the bot so the table never stalls.
    const autopilot = () => finish(AI.decide(p, req, room.game));
    pending.resolve = finish;
    pending.timer = setTimeout(autopilot, seat.connected > 0 ? TURN_SECONDS * 1000 : 1500);
    pending.autopilot = autopilot;
    room.pending = pending;
    broadcast(room, { kind: 'request', reqId, seat: p.id, req: pending.req, deadline });
  });
}

function sanitizeAnswer(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'boolean') return v;
  if (v === 'pay' || v === 'roll') return v;
  return -1;
}

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const STATIC_DIRS = new Set(['js', 'css', 'assets']);

function serveStatic(req, res, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath).replace(/^\/+/, '') || 'index.html'; } catch { return notFound(res); }
  // Check the resolved path, so encoded "../" cannot escape the public folders.
  const file = path.resolve(ROOT, rel);
  const parts = path.relative(ROOT, file).split(path.sep);
  if (!(parts.length === 1 && parts[0] === 'index.html') && !(parts.length > 1 && STATIC_DIRS.has(parts[0]))) return notFound(res);
  fs.readFile(file, (err, data) => {
    if (err) return notFound(res);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
  });
}

function seatFor(room, token) {
  return token ? room.seats.find((s) => s.token === token) : null;
}

async function handleApi(req, res, parts, url) {
  if (parts[1] === 'health') return json(res, 200, { ok: true });
  if (parts[1] !== 'rooms') return notFound(res);

  if (req.method === 'POST' && parts.length === 2) {
    const body = await readBody(req);
    const { room, seat } = createRoom(cleanName(body.name, 'Host'));
    return json(res, 200, { code: room.code, token: seat.token, seat: seat.id });
  }

  const room = rooms.get(String(parts[2] || '').toUpperCase());
  if (!room) return json(res, 404, { error: 'No room with that code. Check the code or create a new room.' });
  room.touched = Date.now();
  const action = parts[3];

  if (req.method === 'GET' && action === 'stream') {
    const seat = seatFor(room, url.searchParams.get('token'));
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const client = { res, seat };
    room.clients.add(client);
    if (seat) seat.connected++;
    send(res, {
      kind: 'hello', seat: seat ? seat.id : null, room: lobbyState(room),
      snap: room.game ? room.game.snapshot() : null, log: room.log.slice(-30),
      request: room.pending ? { reqId: room.pending.reqId, seat: room.pending.seat, req: room.pending.req, deadline: room.pending.deadline } : null,
    });
    broadcastLobby(room);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      room.clients.delete(client);
      if (seat) {
        seat.connected--;
        // If the player whose turn it is drops, let the bot answer shortly.
        if (seat.connected === 0 && room.pending && room.pending.seat === seat.id) {
          clearTimeout(room.pending.timer);
          room.pending.timer = setTimeout(room.pending.autopilot, 5000);
        }
      }
      broadcastLobby(room);
    });
    return;
  }

  if (req.method !== 'POST') return notFound(res);
  const body = await readBody(req);
  const seat = seatFor(room, body.token);

  switch (action) {
    case 'join': {
      if (seat) return json(res, 200, { code: room.code, token: seat.token, seat: seat.id });
      if (room.started) return json(res, 409, { error: 'This game has already started.' });
      if (room.seats.length >= MAX_PLAYERS) return json(res, 409, { error: 'This room is full (4 players).' });
      const s = addSeat(room, cleanName(body.name, 'Player ' + (room.seats.length + 1)), false);
      broadcastLobby(room);
      return json(res, 200, { code: room.code, token: s.token, seat: s.id });
    }
    case 'bot': {
      if (!seat || seat.id !== 0 || room.started) return json(res, 403, { error: 'Only the host can change seats before the game starts.' });
      if (body.add) {
        if (room.seats.length >= MAX_PLAYERS) return json(res, 409, { error: 'The room is full.' });
        addSeat(room, BOT_NAMES[room.seats.filter((s) => s.isBot).length % BOT_NAMES.length], true);
      } else {
        const idx = room.seats.map((s) => s.isBot).lastIndexOf(true);
        if (idx >= 0) {
          room.seats.splice(idx, 1);
          room.seats.forEach((s, i) => { s.id = i; s.color = D.PLAYER_COLORS[i]; });
        }
      }
      broadcastLobby(room);
      return json(res, 200, { ok: true });
    }
    case 'settings': {
      if (!seat || seat.id !== 0 || room.started) return json(res, 403, { error: 'Only the host can change settings.' });
      const r = Number(body.maxRounds);
      if ([20, 30, 40, 999].includes(r)) room.maxRounds = r;
      broadcastLobby(room);
      return json(res, 200, { ok: true });
    }
    case 'start': {
      if (!seat || seat.id !== 0) return json(res, 403, { error: 'Only the host can start the game.' });
      if (room.started) return json(res, 409, { error: 'The game has already started.' });
      if (room.seats.length < 2) return json(res, 409, { error: 'Add at least one more player or bot.' });
      startGame(room);
      return json(res, 200, { ok: true });
    }
    case 'answer': {
      const p = room.pending;
      if (!seat || !p || p.reqId !== body.reqId || p.seat !== seat.id) return json(res, 409, { error: 'That choice is no longer open.' });
      p.resolve(sanitizeAnswer(body.value));
      return json(res, 200, { ok: true });
    }
  }
  return notFound(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'api') {
    handleApi(req, res, parts, url).catch((err) => {
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: 'Server error.' });
    });
    return;
  }
  if (req.method !== 'GET') return notFound(res);
  serveStatic(req, res, url.pathname);
});

// Forget rooms nobody has touched for two hours.
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [code, room] of rooms) if (room.touched < cutoff && room.clients.size === 0) rooms.delete(code);
}, 10 * 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`Atlas Tycoon running at http://localhost:${PORT}`));
}

module.exports = { server, rooms };
