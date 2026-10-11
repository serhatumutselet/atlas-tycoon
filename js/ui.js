// Atlas Tycoon - screens, HUD and the two session types (local hot-seat and online).
(function () {
  const D = window.ATData;
  const { Game, fmt } = window.ATEngine;
  const AI = window.ATAI;
  const I = window.ATI18N;
  const t = I.t;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };
  // Room seats are remembered per tab, so a reload rejoins but a second tab can join as someone else.
  const seatStore = {
    get(code) { try { return sessionStorage.getItem('atlas.room.' + code); } catch { return null; } },
    set(code, token) { try { sessionStorage.setItem('atlas.room.' + code, token); } catch { /* storage unavailable */ } },
  };

  const board = new window.ATRender.IsoBoard($('#board'), { onHover, onClick: onTileClick });
  board.nameOf = (id) => I.tileName(id);
  let view = null; // Game whose state the HUD and board show
  let session = null; // { kind: 'local' | 'online', ... }
  let levels = [];
  let logEntries = [];
  let lastCash = [];
  let chipDeltas = [];
  let promptState = null; // { resolve, reqId, pick }
  let pinnedInfo = -1;

  const speed = () => (session && session.kind === 'local' ? Number($('#speed').value) || 1 : 1);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms * speed()));
  const nameTag = (p) => `<b class="who" style="--pc:${p.color}">${esc(p.name)}</b>`;
  const PAWN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6.4" r="3.7"/><path d="M8.5 10.7h7l-1.3 2.2c1.7 2 2.7 4.3 2.9 6.6H6.9c.2-2.3 1.2-4.6 2.9-6.6z"/><rect x="5" y="19.6" width="14" height="3.2" rx="1.6"/></svg>';
  const avatar = (p) => `<span class="avatar" style="--pc:${p.color}">${PAWN_SVG}</span>`;
  const isMine = (p) => session && (session.kind === 'online' ? p.id === session.seat : !p.isBot);

  // ---------- language ----------
  function applyLang() {
    document.documentElement.lang = I.lang;
    $$('[data-i18n]').forEach((e) => (e.textContent = t(e.dataset.i18n)));
    $$('[data-i18n-ph]').forEach((e) => (e.placeholder = t(e.dataset.i18nPh)));
    $$('[data-i18n-label]').forEach((e) => e.setAttribute('aria-label', t(e.dataset.i18nLabel)));
    $$('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === I.lang)));
    $('#rulesList').innerHTML = t('rules').map((r) => `<li>${r}</li>`).join('');
    $$('.seat select').forEach((s) => {
      s.querySelectorAll('option').forEach((o) => (o.textContent = t(o.value === 'off' ? 'empty' : o.value)));
    });
    if (session && session.room) renderLobby();
    if (view) {
      renderHud();
      renderLog();
      if (pinnedInfo >= 0) showInfo(pinnedInfo, true);
    }
  }

  function setLang(l) {
    I.setLang(l);
    store.set('atlas.lang', I.lang);
    applyLang();
  }
  $$('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
  I.setLang(store.get('atlas.lang') || ((navigator.language || '').toLowerCase().startsWith('tr') ? 'tr' : 'en'));

  // ---------- screens ----------
  function show(id) {
    ['home', 'local', 'lobby', 'game'].forEach((s) => ($('#' + s).hidden = s !== id));
    document.body.classList.toggle('in-game', id === 'game');
    if (id === 'game') board.resize();
  }

  const myName = () => $('#myName').value.trim() || t('namePlaceholder');
  $('#myName').value = store.get('atlas.name') || '';
  $('#myName').addEventListener('change', () => store.set('atlas.name', $('#myName').value.trim()));
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));

  // ---------- local setup ----------
  const SEATS = [{ kind: 'human' }, { name: 'Ada', kind: 'bot' }, { name: 'Bram', kind: 'bot' }, { name: 'Cleo', kind: 'off' }];
  function renderSeats() {
    const box = $('#seats');
    box.innerHTML = '';
    SEATS.forEach((s, i) => {
      const row = el('div', 'seat');
      row.style.setProperty('--pc', D.PLAYER_COLORS[i]);
      row.innerHTML = `<span class="pawn-dot"></span>
        <input aria-label="${esc(t('playerN', { n: i + 1 }))}" value="${esc(s.name || (i === 0 ? myName() : t('playerN', { n: i + 1 })))}" maxlength="14">
        <select aria-label="${esc(t('playerN', { n: i + 1 }))}"><option value="human">${t('human')}</option><option value="bot">${t('bot')}</option>${i > 1 ? `<option value="off">${t('empty')}</option>` : ''}</select>`;
      row.querySelector('select').value = s.kind;
      box.appendChild(row);
    });
  }
  $('#goLocal').addEventListener('click', () => { renderSeats(); show('local'); });

  $('#startLocal').addEventListener('click', () => {
    const players = [];
    $$('#seats .seat').forEach((row, i) => {
      const kind = row.querySelector('select').value;
      if (kind !== 'off') players.push({ name: row.querySelector('input').value.trim() || t('playerN', { n: i + 1 }), isBot: kind === 'bot', color: D.PLAYER_COLORS[i] });
    });
    const game = new Game({
      players,
      rules: { maxRounds: Number($('#maxRounds').value) },
      decide: async (p, req) => {
        if (p.isBot) {
          await wait(req.type === 'roll' ? 350 : 650);
          const a = AI.decide(p, req, game);
          if (['worldTour', 'festival', 'startUpgrade', 'earthquake'].includes(req.type) && a >= 0) {
            board.flash(a, 700 * speed());
            await wait(600);
          }
          return a;
        }
        return prompt(p, req);
      },
      onEvent: (evt) => (session && session.game === game ? handleEvent(evt) : new Promise(() => {})),
    });
    session = { kind: 'local', game };
    $('#speedRow').hidden = false;
    enterGame(game);
    game.run();
  });

  function enterGame(v) {
    view = v;
    levels = view.tiles.map((x) => x.level);
    lastCash = view.players.map((p) => p.cash);
    chipDeltas = [];
    board.setGame(view);
    board.cam = { z: 1, x: 0, y: 0 };
    board.overview();
    board.active = view.turn;
    logEntries = [];
    renderLog();
    $('#ticker').textContent = '';
    $('#over').hidden = true;
    closePrompt();
    setStatus('');
    show('game');
    renderHud();
  }

  // ---------- online ----------
  async function api(path, body) {
    let res;
    try {
      res = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    } catch {
      throw new Error(t('unreachable'));
    }
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) throw new Error(data.code ? t('err_' + data.code) : t('serverNeeded'));
    return data;
  }

  $('#goOnline').addEventListener('click', async () => {
    $('#homeError').textContent = '';
    store.set('atlas.name', myName());
    try {
      const r = await api('rooms', { name: myName() });
      openRoom(r.code, r.token);
    } catch (e) { $('#homeError').textContent = e.message; }
  });

  $('#joinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#homeError').textContent = '';
    const code = $('#joinCode').value.trim().toUpperCase();
    if (code.length !== 5) { $('#homeError').textContent = t('codeLength'); return; }
    store.set('atlas.name', myName());
    try {
      const r = await api(`rooms/${code}/join`, { name: myName(), token: seatStore.get(code) });
      openRoom(r.code, r.token);
    } catch (err) { $('#homeError').textContent = err.message; }
  });

  function openRoom(code, token) {
    seatStore.set(code, token);
    history.replaceState(null, '', '?room=' + code);
    if (session && session.es) session.es.close();
    session = { kind: 'online', code, token, seat: null, room: null, queue: [], busy: false };
    $('#speedRow').hidden = true;
    $('#roomCode').textContent = code;
    $('#lobbyError').textContent = '';
    show('lobby');
    const s = session;
    const es = new EventSource(`/api/rooms/${code}/stream?token=${encodeURIComponent(token)}`);
    s.es = es;
    es.onmessage = (m) => {
      s.queue.push(JSON.parse(m.data));
      pump(s);
    };
    es.onerror = () => {
      if (session !== s) return;
      if (!view) {
        // The room is gone (server restarted or code expired).
        es.close();
        leaveSession();
        $('#homeError').textContent = t('roomGone');
      } else toast(t('connLost'));
    };
  }

  async function pump(s) {
    if (s.busy) return;
    s.busy = true;
    while (s.queue.length && session === s) {
      const msg = s.queue.shift();
      board.instant = s.queue.length > 12;
      // A reconnect replays the full state, so anything still queued before it is stale.
      if (msg.kind === 'hello') s.queue = s.queue.filter((m) => m.kind !== 'event');
      try { await onServer(s, msg); } catch (e) { console.error(e); }
    }
    s.busy = false;
    board.instant = false;
  }

  async function onServer(s, msg) {
    switch (msg.kind) {
      case 'hello':
        s.seat = msg.seat;
        s.room = msg.room;
        renderLobby();
        if (msg.snap) {
          enterGame(viewFromSnap(msg.snap));
          (msg.log || []).forEach((e) => addLog(typeof e === 'string' ? { text: e } : e));
          if (view.winner) showOver(view.winner, view.winReason);
        } else show('lobby');
        if (msg.request) onRequest(s, msg.request);
        break;
      case 'lobby':
        s.room = msg.room;
        if (msg.you != null) s.seat = msg.you;
        if (!view) renderLobby();
        break;
      case 'event':
        if (!view) enterGame(viewFromSnap(msg.snap));
        view.load(msg.snap);
        await handleEvent(view.unpack(msg.evt));
        break;
      case 'request': onRequest(s, msg); break;
      case 'requestDone':
        if (promptState && promptState.reqId === msg.reqId) closePrompt();
        if (s.waiting === msg.reqId) { s.waiting = null; setStatus(''); }
        break;
      case 'error': toast(msg.message); break;
    }
  }

  function viewFromSnap(snap) {
    const g = new Game({ players: snap.players, decide: () => -1 });
    g.load(snap);
    return g;
  }

  function onRequest(s, msg) {
    const p = view.players[msg.seat];
    const req = view.unpack(msg.req);
    if (msg.seat === s.seat) {
      prompt(p, req, msg.reqId, msg.deadline).then((value) => {
        if (value === undefined) return;
        api(`rooms/${s.code}/answer`, { token: s.token, reqId: msg.reqId, value }).catch(() => {});
      });
    } else {
      s.waiting = msg.reqId;
      setStatus(`<p class="wait"><span class="pawn-dot" style="--pc:${p.color}"></span><span>${t('w_' + req.type, { p: `<b>${esc(p.name)}</b>` })}</span></p>${timerBar(msg.deadline)}`);
    }
  }

  function renderLobby() {
    const s = session;
    if (!s || !s.room) return;
    const list = $('#lobbySeats');
    list.innerHTML = '';
    s.room.seats.forEach((seat) => {
      const li = el('li', seat.online ? '' : 'offline');
      li.style.setProperty('--pc', seat.color);
      const tag = seat.isBot ? t('bot') : seat.id === 0 ? t('tagHost') : seat.online ? t('tagReady') : t('tagOffline');
      li.innerHTML = `<span class="pawn-dot"></span><b>${esc(seat.name)}</b><span class="tag">${tag}${seat.id === s.seat ? ' · ' + t('you') : ''}</span>`;
      list.appendChild(li);
    });
    for (let i = s.room.seats.length; i < 4; i++) list.appendChild(el('li', 'empty', `<span class="pawn-dot"></span>${t('openSeat')}`));
    const host = s.seat === 0;
    $('#hostControls').hidden = !host;
    $('#guestNote').hidden = host;
    $('#roomRounds').value = String(s.room.maxRounds);
    $('#startOnline').disabled = s.room.seats.length < 2;
    $('#addBot').disabled = s.room.seats.length >= 4;
    $('#removeBot').disabled = !s.room.seats.some((x) => x.isBot);
  }

  const lobbyCall = (path, body) => api(`rooms/${session.code}/${path}`, Object.assign({ token: session.token }, body))
    .then(() => ($('#lobbyError').textContent = ''))
    .catch((e) => ($('#lobbyError').textContent = e.message));
  $('#addBot').addEventListener('click', () => lobbyCall('bot', { add: true }));
  $('#removeBot').addEventListener('click', () => lobbyCall('bot', { add: false }));
  $('#roomRounds').addEventListener('change', () => lobbyCall('settings', { maxRounds: Number($('#roomRounds').value) }));
  $('#startOnline').addEventListener('click', () => lobbyCall('start'));
  $('#copyLink').addEventListener('click', async () => {
    const link = `${location.origin}${location.pathname}?room=${session.code}`;
    try { await navigator.clipboard.writeText(link); $('#copyLink').textContent = t('linkCopied'); } catch { $('#copyLink').textContent = link; }
    setTimeout(() => ($('#copyLink').textContent = t('copyLink')), 2500);
  });
  $('#leaveLobby').addEventListener('click', leaveSession);

  function leaveSession() {
    if (session && session.es) session.es.close();
    session = null;
    view = null;
    board.setGame(null);
    closePrompt();
    history.replaceState(null, '', location.pathname);
    ['#over', '#info', '#diceShow', '#turnBanner', '#cardShow'].forEach((s) => ($(s).hidden = true));
    show('home');
  }

  // ---------- engine events ----------
  async function handleEvent(evt) {
    const local = session.kind === 'local';
    switch (evt.type) {
      case 'log': addLog(evt); break;
      case 'turn': {
        const p = evt.player;
        board.active = p.id;
        if (board.autoCam) board.overview();
        renderHud();
        if (!promptState) setStatus(`<p class="wait"><span class="pawn-dot" style="--pc:${p.color}"></span><span>${t('turnOf', { p: `<b>${esc(p.name)}</b>` })}</span></p>`);
        const banner = turnBanner(p);
        if (local) await wait(p.isBot ? 450 : 650);
        await banner;
        break;
      }
      case 'dice': board.follow(evt.player.id); await rollDice(evt.dice); break;
      case 'move': board.follow(evt.player.id); await board.animateMove(evt.player.id, evt.path, evt.jump); renderHud(); break;
      case 'money':
        renderHud();
        board.floatText(evt.player.id, (evt.delta > 0 ? '+' : '−') + fmt(Math.abs(evt.delta)), evt.delta > 0 ? '#1f9d55' : '#d93a2b');
        break;
      case 'tile': {
        const x = evt.tile;
        if (x.owner >= 0 && x.level > levels[x.id]) board.markGrow(x.id);
        levels[x.id] = x.level;
        renderHud();
        if (pinnedInfo === x.id) showInfo(x.id, true);
        if (local) await wait(200);
        break;
      }
      case 'card': await showCard(evt.card); break;
      case 'bankrupt': board.hideToken(evt.player.id); renderHud(); break;
      case 'round': renderHud(); break;
      case 'gameOver': board.overview(true); renderHud(); setStatus(''); setTimeout(() => view && showOver(evt.player, evt.reason), 700); break;
    }
  }

  function logText(e) { return e.key ? t(e.key, e.params) : e.text; }

  function addLog(e) {
    logEntries.unshift({ key: e.key, params: e.params, text: e.text });
    if (logEntries.length > 150) logEntries.pop();
    const log = $('#log');
    log.prepend(el('li', null, esc(logText(e))));
    while (log.children.length > 150) log.lastChild.remove();
    const tk = $('#ticker');
    tk.textContent = logText(e);
    tk.classList.remove('pop');
    void tk.offsetWidth;
    tk.classList.add('pop');
  }

  function renderLog() {
    $('#log').innerHTML = logEntries.map((e) => `<li>${esc(logText(e))}</li>`).join('');
    if (logEntries[0]) $('#ticker').textContent = logText(logEntries[0]);
  }

  // A short banner in the middle of the screen when the turn changes.
  function turnBanner(p) {
    if (board.skipping || speed() < 0.3) return Promise.resolve();
    const b = $('#turnBanner');
    b.style.setProperty('--pc', p.color);
    b.innerHTML = `<span class="pawn-dot"></span>${isMine(p) && session.kind === 'online' ? t('yourTurn') : t('turnOf', { p: esc(p.name) })}`;
    b.hidden = false;
    b.classList.remove('go');
    void b.offsetWidth;
    b.classList.add('go');
    clearTimeout(turnBanner.timer);
    turnBanner.timer = setTimeout(() => (b.hidden = true), 1100);
    return Promise.resolve();
  }

  // ---------- 3D dice ----------
  const FACE_ROT = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const faceHtml = (n) => `<div class="face f${n}">${Array.from({ length: 9 }, (_, i) => `<i${PIPS[n].includes(i) ? ' class="on"' : ''}></i>`).join('')}</div>`;
  const cubeState = [{ x: -20, y: 20 }, { x: -20, y: -20 }];
  $$('#diceShow .cube').forEach((c, i) => {
    // A solid core sits just inside the rounded faces so no gaps show while the die tumbles.
    c.innerHTML = [1, 2, 3, 4, 5, 6].map((n) => `<div class="core f${n}"></div>`).join('') + [1, 2, 3, 4, 5, 6].map(faceHtml).join('');
    c.style.transform = `rotateX(${cubeState[i].x}deg) rotateY(${cubeState[i].y}deg)`;
  });

  async function rollDice(dice) {
    if (board.skipping || speed() < 0.3) return;
    const box = $('#diceShow');
    const cubes = box.querySelectorAll('.cube');
    const total = box.querySelector('.dice-total');
    total.className = 'dice-total';
    total.innerHTML = '';
    box.hidden = false;
    box.classList.remove('throw');
    void box.offsetWidth;
    box.classList.add('throw');
    cubes.forEach((c, i) => {
      const [fx, fy] = FACE_ROT[dice[i]];
      const st = cubeState[i];
      // Spin forward at least two full turns on each axis, then land on the rolled face.
      st.x = fx + 360 * (Math.ceil(st.x / 360) + 2 + i);
      st.y = fy + 360 * (Math.ceil(st.y / 360) + 2);
      c.style.transform = `rotateX(${st.x}deg) rotateY(${st.y}deg)`;
    });
    await new Promise((r) => setTimeout(r, 950));
    const doubles = dice[0] === dice[1];
    total.innerHTML = `<b>${dice[0] + dice[1]}</b>${doubles ? `<span>${t('doubles')}</span>` : ''}`;
    total.classList.add('show');
    await new Promise((r) => setTimeout(r, 420));
    box.hidden = true;
  }

  const CARD_ICONS = {
    tailwind: '<path d="M4 12h13M12 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
    boom: '<ellipse cx="12" cy="17" rx="7" ry="3" fill="currentColor"/><ellipse cx="12" cy="12.5" rx="7" ry="3" fill="currentColor" opacity=".8"/><ellipse cx="12" cy="8" rx="7" ry="3" fill="currentColor" opacity=".6"/>',
    inherit: '<rect x="4" y="10" width="16" height="10" rx="1.5" fill="currentColor"/><rect x="3" y="7" width="18" height="4" rx="1" fill="currentColor" opacity=".75"/><path d="M12 7v13" stroke="#fff" stroke-width="1.8"/>',
    badinvest: '<path d="M3 6l6 6 4-4 8 9M15 17h6v-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
    storm: '<path d="M7 15a5 5 0 1 1 1-9.9A6 6 0 0 1 19 9a4 4 0 0 1-1 6z" fill="currentColor"/><path d="M12 13l-2 5h3l-2 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    voucher: '<ellipse cx="12" cy="10" rx="9" ry="4.5" fill="currentColor"/><path d="M8 15l1 4h6l1-4" fill="currentColor" opacity=".7"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" fill="currentColor"/><path d="M8.5 12l2.5 2.5L16 9.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
    coupon: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z" fill="currentColor"/><path d="M9 15l6-6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
    gala: '<path d="M12 2.5l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 16.8 6.2 20l1.4-6.4L2.7 9.2l6.5-.7z" fill="currentColor"/>',
    quake: '<path d="M2 18h20M5 18l3-6 3 3 3-8 3 6 2-3 2 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>',
    charity: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z" fill="currentColor"/>',
    birthday: '<rect x="4" y="11" width="16" height="9" rx="2" fill="currentColor"/><path d="M8 11V8M12 11V7M16 11V8" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="6" r="1.3" fill="currentColor"/><circle cx="12" cy="5" r="1.3" fill="currentColor"/><circle cx="16" cy="6" r="1.3" fill="currentColor"/>',
    repairs: '<path d="M14.5 3.5a5 5 0 0 0-5.6 6.6L3.5 15.5l5 5 5.4-5.4a5 5 0 0 0 6.6-5.6l-3 3-3.4-1-1-3.4z" fill="currentColor"/>',
    taxi: '<path d="M20 12H7M12 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  };

  async function showCard(card) {
    if (board.skipping) return;
    const [title, text] = I.card(card.id);
    const box = $('#cardShow');
    const bad = ['badinvest', 'storm', 'charity', 'repairs', 'taxi'].includes(card.id);
    box.innerHTML = `<div class="fortune${bad ? ' bad' : ''}"><div class="rays"></div><span class="eyebrow">${t('fortune')}</span>
      <span class="card-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${CARD_ICONS[card.id] || CARD_ICONS.gala}</svg></span>
      <h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
    box.hidden = false;
    await (session.kind === 'local' ? wait(1600) : new Promise((r) => setTimeout(r, 1800)));
    box.hidden = true;
  }

  function showOver(winner, reason) {
    $('#overTitle').textContent = t('wins', { p: winner.name });
    $('#overTitle').style.color = winner.color;
    $('#overReason').textContent = I.reason(reason);
    const list = $('#standings');
    list.innerHTML = '';
    view.players.slice().sort((a, b) => (a.bankrupt - b.bankrupt) || view.netWorth(b) - view.netWorth(a)).forEach((p) => {
      const li = el('li', p.bankrupt ? 'out' : '');
      li.style.setProperty('--pc', p.color);
      li.innerHTML = `<span class="pawn-dot"></span><b>${esc(p.name)}</b><span>${p.bankrupt ? t('bankrupt') : fmt(view.netWorth(p))}</span>`;
      list.appendChild(li);
    });
    const conf = $('#confetti');
    conf.innerHTML = '';
    const colors = ['#ffc53d', '#ff6b5a', '#4fb6d3', '#2eae6b', '#b38cff', winner.color];
    for (let i = 0; i < 70; i++) {
      const piece = el('i');
      piece.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${(Math.random() * 1.2).toFixed(2)}s;animation-duration:${(2.4 + Math.random() * 1.8).toFixed(2)}s;--spin:${Math.round(360 + Math.random() * 720)}deg;--drift:${Math.round(Math.random() * 120 - 60)}px`;
      conf.appendChild(piece);
    }
    $('#over').hidden = false;
  }
  $('#overBtn').addEventListener('click', leaveSession);

  // ---------- HUD ----------
  function renderHud() {
    if (!view) return;
    const box = $('#chips');
    box.innerHTML = '';
    const current = view.players[view.turn];
    view.players.forEach((p, i) => {
      const me = session && session.kind === 'online' && p.id === session.seat;
      const chip = el('div', `chip c${i}${p === current && !view.winner ? ' active' : ''}${p.bankrupt ? ' out' : ''}`);
      chip.style.setProperty('--pc', p.color);
      const badges = [p.islandTurns ? t('badgeIsle') : '', p.shield ? t('badgeShield') : '', p.coupon ? t('badgeCoupon') : ''].filter(Boolean);
      const props = view.owned(p).length;
      chip.innerHTML = `${avatar(p)}
        <span class="chip-text"><span class="chip-name">${esc(p.name)}${me ? ` <i>${t('you')}</i>` : ''}${p.isBot ? ` <i>${t('bot').toLowerCase()}</i>` : ''}</span>
        <span class="chip-cash">${p.bankrupt ? t('bankrupt') : fmt(p.cash)}</span>
        <span class="chip-meta">${t('props', { n: props })} · ${t('lap', { n: p.laps + 1 })}</span>
        ${badges.length ? `<span class="badges">${badges.map((b) => `<span class="badge">${b}</span>`).join('')}</span>` : ''}</span>
        ${p === current && !view.winner ? `<span class="turn-tag">${t('turnTag')}</span>` : ''}`;
      chip.title = t('worth', { m: view.netWorth(p) });
      const delta = p.cash - (lastCash[i] != null ? lastCash[i] : p.cash);
      if (delta) chipDeltas[i] = { v: delta, at: performance.now() };
      lastCash[i] = p.cash;
      // HUD re-renders often; resume the money bubble animation where it was.
      const cd = chipDeltas[i];
      const age = cd ? performance.now() - cd.at : Infinity;
      if (age < 1400) {
        const d = el('span', `chip-delta ${cd.v > 0 ? 'up' : 'down'}`, (cd.v > 0 ? '+' : '−') + fmt(Math.abs(cd.v)));
        d.style.animationDelay = `-${Math.round(age)}ms`;
        chip.appendChild(d);
        chip.classList.add(cd.v > 0 ? 'gain' : 'loss');
      }
      box.appendChild(chip);
    });
    $('#round').textContent = view.rules.maxRounds < 999 ? t('roundOf', { n: Math.min(view.round, view.rules.maxRounds), max: view.rules.maxRounds }) : t('round', { n: view.round });
  }

  function onHover(id) {
    if (pinnedInfo >= 0 || !view || (promptState && promptState.pick)) return;
    if (id < 0) { $('#info').hidden = true; return; }
    showInfo(id, false);
  }

  function onTileClick(id) {
    if (!view) return;
    if (promptState && promptState.pick) {
      if (promptState.pick.includes(id)) finishPrompt(id);
      return;
    }
    if (id < 0 || id === pinnedInfo) { pinnedInfo = -1; $('#info').hidden = true; return; }
    pinnedInfo = id;
    showInfo(id, true);
  }

  function rentTable(x) {
    const owner = x.owner >= 0;
    const rows = D.RENT_MULT.map((m, l) => `<tr${owner && l === x.level ? ' class="cur"' : ''}><td>${I.levelName(l)}</td><td>${fmt(x.price * m)}</td><td>${l ? fmt(view.buildCost(x, l)) : fmt(x.price)}</td></tr>`).join('');
    return `<table><thead><tr><th>${t('level')}</th><th>${t('rent')}</th><th>${t('cost')}</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function showInfo(id, pinned) {
    const x = view.tiles[id];
    const owner = x.owner >= 0 ? view.players[x.owner] : null;
    let body = '';
    if (x.type === 'city') {
      body = `<p class="muted">${t('regionInfo', { g: I.groupName(x.group), n: view.groupTiles(x.group).length })}</p>${rentTable(x)}
        <p class="muted">${t('rentDoubles')}${owner && x.level < 4 ? ' · ' + t('buyoutInfo', { m: view.buyoutPrice(x) }) : ''}</p>`;
    } else if (x.type === 'resort') {
      body = `<p class="muted">${t('resortInfo', { m: x.price, list: D.RESORT_RENT.map(fmt).join(' / ') })}</p>`;
    } else {
      const r = view.rules;
      const params = { start: { m: r.salary }, island: { n: r.islandTurns, m: r.islandFine }, worldTour: { m: r.worldTourFee }, tax: { n: Math.round(r.taxRate * 100) } }[x.type];
      body = `<p class="muted">${t('info_' + x.type, params)}</p>`;
    }
    const box = $('#info');
    box.innerHTML = `<header class="deed mini" style="--gc:${x.type === 'city' ? D.GROUPS[x.group].color : x.type === 'resort' ? '#3fb0c9' : '#8a9bc4'}"><h3>${esc(I.tileName(id))}</h3></header>
      ${owner ? `<p class="own"><span class="pawn-dot" style="--pc:${owner.color}"></span>${esc(owner.name)} · ${t('rentNow', { m: view.rent(x) })}${view.festival === x.id ? ' · ' + t('gala') : ''}</p>` : ''}${body}`;
    box.classList.toggle('pinned', pinned);
    const [sx, sy] = board.tileScreenPos(id);
    const r = $('#game').getBoundingClientRect();
    box.hidden = false;
    const w = box.offsetWidth, h = box.offsetHeight;
    let left = sx + 28;
    if (left + w > r.width - 12) left = sx - w - 28;
    left = Math.max(12, Math.min(left, r.width - w - 12));
    const top = Math.max(76, Math.min(sy - h / 2, r.height - h - 12));
    box.style.left = left + 'px';
    box.style.top = top + 'px';
  }

  // ---------- prompts ----------
  // Bottom strip: status lines and tap-a-tile instructions.
  function setStatus(html) {
    $('#action').innerHTML = html;
    $('#action').classList.toggle('empty', !html);
  }

  // Centre card: decisions that need the player's full attention.
  function setDecide(html) {
    $('#decide').innerHTML = html;
    $('#stage').hidden = !html;
  }

  function timerBar(deadline) {
    if (!deadline) return '';
    const left = Math.max(0, deadline - Date.now());
    return `<div class="timer"><i style="animation-duration:${left}ms"></i></div>`;
  }

  function closePrompt() {
    if (!promptState) return;
    const ps = promptState;
    promptState = null;
    board.setPickable(null);
    setDecide('');
    setStatus('');
    ps.resolve(undefined);
  }

  function finishPrompt(value) {
    const ps = promptState;
    if (!ps) return;
    promptState = null;
    board.setPickable(null);
    setDecide('');
    setStatus('');
    ps.resolve(value);
  }

  const LEVEL_ICONS = [
    '<path d="M8 20V5l9 3-9 3" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    '<path d="M4 11l8-6 8 6v9H4z" fill="currentColor"/><rect x="10" y="14" width="4" height="6" fill="#fff" opacity=".7"/>',
    '<rect x="7" y="3" width="10" height="18" rx="1" fill="currentColor"/><path d="M10 7h1M13 7h1M10 11h1M13 11h1M10 15h1M13 15h1" stroke="#fff" stroke-width="1.6" opacity=".8"/>',
    '<rect x="3" y="6" width="18" height="15" rx="1" fill="currentColor"/><path d="M7 10h2M11 10h2M15 10h2M7 14h2M11 14h2M15 14h2" stroke="#fff" stroke-width="1.8" opacity=".8"/>',
    '<path d="M12 2l3 7v12H9V9z" fill="currentColor"/><path d="M5 21h14" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="4" r="1.6" fill="#ffd23f"/>',
  ];
  const levelIcon = (l) => `<svg class="lvl-icon" viewBox="0 0 24 24" aria-hidden="true">${LEVEL_ICONS[l]}</svg>`;

  function tileHeader(x, kicker) {
    const col = x.type === 'city' ? D.GROUPS[x.group].color : '#3fb0c9';
    const sub = x.type === 'city' ? I.groupName(x.group) : t('resortTitle');
    return `<header class="deed" style="--gc:${col}"><small>${kicker}</small><h2>${esc(I.tileName(x.id))}</h2><span>${esc(sub)}</span></header>`;
  }

  // Rent the player would charge at a given level, counting a region they would complete.
  function rentAt(p, x, level) {
    const others = view.groupTiles(x.group).filter((o) => o.id !== x.id);
    const full = others.every((o) => o.owner === p.id);
    return Math.round(x.price * D.RENT_MULT[level]) * (full ? 2 : 1) * (view.festival === x.id ? 2 : 1);
  }

  function prompt(p, req, reqId, deadline) {
    return new Promise((resolve) => {
      if (promptState) closePrompt();
      promptState = { resolve, reqId };
      const x = req.tile;
      const cash = `<p class="cash-left">${t('cashLeft', { m: p.cash })}</p>`;
      let html = '';
      let buttons = [];
      let pick = null;
      let cancel = null;
      let pickText = '';
      switch (req.type) {
        case 'roll':
          html = `<div class="roll-card" style="--pc:${p.color}">
            ${avatar(p)}
            <div class="mini-dice" aria-hidden="true"><span>${faceHtml(5)}</span><span>${faceHtml(3)}</span></div>
            <small>${t('rollTitle')}</small><h2>${t('rollSub', { p: nameTag(p) })}</h2></div>`;
          buttons = [{ label: t('rollDice'), value: true, primary: true, big: true }];
          html += `<p class="hint">${t('spaceHint')}</p>`;
          break;
        case 'buy':
          html = tileHeader(x, t('buyTitle')) + `<p>${t('buyQ')}</p>`;
          buttons = req.options.map((o, i) => ({
            option: true, level: o.level, value: o.level, primary: i === req.options.length - 1,
            label: `${o.level ? t('withLevel', { lv: o.level }) : t('plotOnly')}`, cost: o.cost, rent: rentAt(p, x, o.level),
          }));
          buttons.push({ label: t('pass'), value: -1, ghost: true });
          html += cash;
          break;
        case 'build':
          html = tileHeader(x, t('buildTitle')) + `<p>${t('buildQ', { lv: x.level })}</p>`;
          buttons = req.options.map((o, i) => ({
            option: true, level: o.level, value: o.level, primary: i === req.options.length - 1,
            label: I.levelName(o.level), cost: o.cost, rent: rentAt(p, x, o.level),
          }));
          buttons.push({ label: t('notNow'), value: -1, ghost: true });
          html += cash;
          break;
        case 'resort':
          html = tileHeader(x, t('buyTitle')) + `<p>${t('resortQ')}</p><p class="muted small">${t('resortInfo', { m: req.price, list: D.RESORT_RENT.map(fmt).join(' / ') })}</p>`;
          buttons = [{ label: t('buy'), sub: fmt(req.price), value: true, primary: true }, { label: t('pass'), value: false, ghost: true }];
          html += cash;
          break;
        case 'buyout':
          html = tileHeader(x, t('buyoutTitle')) + `<p>${t('buyoutQ', { o: nameTag(req.owner) })}</p>
            <p class="muted small">${I.levelName(x.level)} · ${t('rentNow', { m: view.rent(x) })}</p>`;
          buttons = [{ label: t('buyOut'), sub: fmt(req.price), value: true, primary: true }, { label: t('noThanks'), value: false, ghost: true }];
          html += cash;
          break;
        case 'island': {
          const pips = Array.from({ length: view.rules.islandTurns }, (_, i) => `<i${i < req.turnsLeft ? ' class="on"' : ''}></i>`).join('');
          html = `<header class="deed island"><small>${nameTag(p)}</small><h2>${t('islandTitle')}</h2><span class="tries">${pips}</span></header>
            <p>${req.turnsLeft === 1 ? t('islandQ1') : t('islandQ', { n: req.turnsLeft })}</p>`;
          buttons = [{ label: t('rollDoubles'), value: 'roll', primary: true }, { label: t('payLeave'), sub: fmt(req.fine), value: 'pay' }];
          break;
        }
        case 'worldTour': pick = req.choices; cancel = t('stayHere'); pickText = t('worldTourQ', { p: nameTag(p), m: req.fee }); break;
        case 'festival': pick = req.choices; cancel = t('skip'); pickText = t('festivalQ', { p: nameTag(p) }); break;
        case 'startUpgrade': pick = req.choices; cancel = t('skip'); pickText = t('startUpgradeQ', { p: nameTag(p) }); break;
        case 'earthquake': pick = req.choices; pickText = t('earthquakeQ', { p: nameTag(p) }); break;
      }

      const makeButtons = (row, list) => list.forEach((b) => {
        let btn;
        if (b.option) {
          btn = el('button', `opt${b.primary ? ' primary' : ''}`, `${levelIcon(b.level)}<span class="opt-name">${esc(b.label)}</span>
            <span class="opt-rent">${t('rentAfter', { m: b.rent })}</span><span class="opt-cost">${fmt(b.cost)}</span>`);
        } else {
          btn = el('button', `btn${b.primary ? ' primary' : ''}${b.ghost ? ' ghost' : ''}${b.big ? ' big' : ''}`, `${esc(b.label)}${b.sub ? `<small>${b.sub}</small>` : ''}`);
        }
        btn.type = 'button';
        btn.addEventListener('click', () => finishPrompt(b.value));
        row.appendChild(btn);
      });

      if (pick) {
        promptState.pick = pick;
        board.setPickable(pick);
        if (board.autoCam) board.overview(true);
        pinnedInfo = -1;
        $('#info').hidden = true;
        setStatus(`<p class="pick-text">${pickText}</p><div class="btns"></div>${timerBar(deadline)}`);
        if (cancel) makeButtons($('#action .btns'), [{ label: cancel, value: -1, ghost: true }]);
        return;
      }
      setStatus('');
      $('#decide').style.setProperty('--pc', p.color);
      setDecide(`<div class="ask">${html}</div><div class="opts"></div><div class="btns"></div>${timerBar(deadline)}`);
      makeButtons($('#decide .opts'), buttons.filter((b) => b.option));
      makeButtons($('#decide .btns'), buttons.filter((b) => !b.option));
      const first = $('#decide .primary') || $('#decide button');
      if (first) first.focus({ preventScroll: true });
    });
  }

  // ---------- misc ----------
  let toastTimer = null;
  function toast(text) {
    const tk = $('#ticker');
    tk.textContent = text;
    tk.classList.add('warn');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => tk.classList.remove('warn'), 3000);
  }

  function togglePanel(btn, panel) {
    const open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }
  function setCam(on) {
    board.setAutoCam(on);
    store.set('atlas.cam', on ? '1' : '0');
    $('#camBtn').setAttribute('aria-pressed', String(on));
  }
  setCam(store.get('atlas.cam') !== '0');
  $('#camBtn').addEventListener('click', () => setCam(!board.autoCam));
  $('#journalBtn').addEventListener('click', () => togglePanel($('#journalBtn'), $('#journal')));
  $('#menuBtn').addEventListener('click', () => togglePanel($('#menuBtn'), $('#menu')));
  $('#quitBtn').addEventListener('click', () => {
    if (confirm(t('confirmLeave'))) { $('#menu').hidden = true; leaveSession(); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { pinnedInfo = -1; $('#info').hidden = true; }
    if (e.key === ' ' && !e.target.closest('input, select, button, textarea')) {
      const btn = $('#decide .primary') || $('#action .btn.primary');
      if (btn && !$('#stage').hidden) { e.preventDefault(); btn.click(); }
    }
  });

  applyLang();

  // Invite links look like ?room=CODE. A saved token rejoins the same seat.
  const linkCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (linkCode) {
    $('#joinCode').value = linkCode;
    const saved = seatStore.get(linkCode);
    if (saved) openRoom(linkCode, saved);
  }
  if (!session) show('home');
})();
