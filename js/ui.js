// Atlas Tycoon - screens, HUD and the two session types (local hot-seat and online).
(function () {
  const D = window.ATData;
  const { Game, fmt } = window.ATEngine;
  const AI = window.ATAI;
  const $ = (sel) => document.querySelector(sel);
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
  let view = null; // Game whose state the HUD and board show
  let session = null; // { kind: 'local' | 'online', ... }
  let levels = [];
  let promptState = null; // { resolve, reqId, pick }
  let pinnedInfo = -1;

  const speed = () => (session && session.kind === 'local' ? Number($('#speed').value) || 1 : 1);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms * speed()));

  // ---------- screens ----------
  function show(id) {
    ['home', 'local', 'lobby', 'game'].forEach((s) => ($('#' + s).hidden = s !== id));
    document.body.classList.toggle('in-game', id === 'game');
    if (id === 'game') board.resize();
  }

  const myName = () => $('#myName').value.trim() || 'Captain';
  $('#myName').value = store.get('atlas.name') || '';
  $('#myName').addEventListener('change', () => store.set('atlas.name', $('#myName').value.trim()));
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));

  // ---------- local setup ----------
  const SEATS = [{ kind: 'human' }, { name: 'Ada', kind: 'bot' }, { name: 'Bram', kind: 'bot' }, { name: 'Cleo', kind: 'off' }];
  function renderSeats() {
    const box = $('#seats');
    box.innerHTML = '';
    SEATS.forEach((s, i) => {
      const row = el('div', 'seat');
      row.style.setProperty('--pc', D.PLAYER_COLORS[i]);
      row.innerHTML = `<span class="pawn-dot"></span>
        <input aria-label="Seat ${i + 1} name" value="${esc(s.name || (i === 0 ? myName() : 'Player ' + (i + 1)))}" maxlength="14">
        <select aria-label="Seat ${i + 1} type"><option value="human">Human</option><option value="bot">Bot</option>${i > 1 ? '<option value="off">Empty</option>' : ''}</select>`;
      row.querySelector('select').value = s.kind;
      box.appendChild(row);
    });
  }
  $('#goLocal').addEventListener('click', () => { renderSeats(); show('local'); });

  $('#startLocal').addEventListener('click', () => {
    const players = [];
    $('#seats').querySelectorAll('.seat').forEach((row, i) => {
      const kind = row.querySelector('select').value;
      if (kind !== 'off') players.push({ name: row.querySelector('input').value.trim() || 'Player ' + (i + 1), isBot: kind === 'bot', color: D.PLAYER_COLORS[i] });
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
    levels = view.tiles.map((t) => t.level);
    board.setGame(view);
    board.active = view.turn;
    $('#log').innerHTML = '';
    $('#ticker').textContent = '';
    $('#over').hidden = true;
    closePrompt();
    setAction('');
    show('game');
    renderHud();
  }

  // ---------- online ----------
  async function api(path, body) {
    let res;
    try {
      res = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    } catch {
      throw new Error('Could not reach the Atlas server. Check your connection.');
    }
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) throw new Error(data.error || 'Online play needs the Atlas server. Start it with "npm start".');
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
    if (code.length !== 5) { $('#homeError').textContent = 'Room codes have 5 characters.'; return; }
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
        $('#homeError').textContent = 'That room is no longer available.';
        leaveSession();
      } else toast('Connection lost. Reconnecting…');
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
          (msg.log || []).forEach((t) => addLog(t));
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
        if (s.waiting === msg.reqId) { s.waiting = null; setAction(''); }
        break;
      case 'error': toast(msg.message); break;
    }
  }

  function viewFromSnap(snap) {
    const g = new Game({ players: snap.players, decide: () => -1 });
    g.load(snap);
    return g;
  }

  const WAIT_VERBS = {
    roll: 'is rolling', buy: 'is deciding whether to buy', build: 'is deciding what to build', buyout: 'is weighing a buyout',
    resort: 'is eyeing a resort', island: 'is stranded on the island', worldTour: 'is picking a destination',
    festival: 'is picking a Gala city', startUpgrade: 'is picking a free upgrade', earthquake: 'is picking an earthquake target',
  };

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
      setAction(`<p class="wait"><span class="pawn-dot" style="--pc:${p.color}"></span><span><b>${esc(p.name)}</b> ${WAIT_VERBS[req.type] || 'is thinking'}…</span></p>${timerBar(msg.deadline)}`);
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
      li.innerHTML = `<span class="pawn-dot"></span><b>${esc(seat.name)}</b>
        <span class="tag">${seat.isBot ? 'Bot' : seat.id === 0 ? 'Host' : seat.online ? 'Ready' : 'Offline'}${seat.id === s.seat ? ' · you' : ''}</span>`;
      list.appendChild(li);
    });
    for (let i = s.room.seats.length; i < 4; i++) list.appendChild(el('li', 'empty', '<span class="pawn-dot"></span>Open seat'));
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
    try { await navigator.clipboard.writeText(link); $('#copyLink').textContent = 'Link copied'; } catch { $('#copyLink').textContent = link; }
    setTimeout(() => ($('#copyLink').textContent = 'Copy invite link'), 2500);
  });
  $('#leaveLobby').addEventListener('click', leaveSession);

  function leaveSession() {
    if (session && session.es) session.es.close();
    session = null;
    view = null;
    board.setGame(null);
    closePrompt();
    history.replaceState(null, '', location.pathname);
    $('#over').hidden = true;
    $('#info').hidden = true;
    show('home');
  }

  // ---------- engine events ----------
  async function handleEvent(evt) {
    switch (evt.type) {
      case 'log': addLog(evt.text); break;
      case 'turn':
        board.active = evt.player.id;
        renderHud();
        if (!promptState) setAction(`<p class="wait"><span class="pawn-dot" style="--pc:${evt.player.color}"></span><span><b>${esc(evt.player.name)}</b>'s turn</span></p>`);
        if (session.kind === 'local' && evt.player.isBot) await wait(250);
        break;
      case 'dice': await board.rollDice(evt.dice); break;
      case 'move': await board.animateMove(evt.player.id, evt.path, evt.jump); renderHud(); break;
      case 'money':
        renderHud();
        board.floatText(evt.player.id, (evt.delta > 0 ? '+' : '−') + fmt(Math.abs(evt.delta)), evt.delta > 0 ? '#1f9d55' : '#d93a2b');
        break;
      case 'tile': {
        const t = evt.tile;
        if (t.owner >= 0 && t.level > levels[t.id]) board.markGrow(t.id);
        levels[t.id] = t.level;
        renderHud();
        if (pinnedInfo === t.id) showInfo(t.id, true);
        if (session.kind === 'local') await wait(200);
        break;
      }
      case 'card': await showCard(evt.card); break;
      case 'bankrupt': board.hideToken(evt.player.id); renderHud(); break;
      case 'round': renderHud(); break;
      case 'gameOver': renderHud(); setAction(''); setTimeout(() => view && showOver(evt.player, evt.reason), 700); break;
    }
  }

  function addLog(text) {
    const log = $('#log');
    log.prepend(el('li', null, esc(text)));
    while (log.children.length > 150) log.lastChild.remove();
    const t = $('#ticker');
    t.textContent = text;
    t.classList.remove('pop');
    void t.offsetWidth;
    t.classList.add('pop');
  }

  async function showCard(card) {
    if (board.skipping) return;
    const box = $('#cardShow');
    box.innerHTML = `<div class="fortune"><span class="eyebrow">Fortune</span><h3>${esc(card.title)}</h3><p>${esc(card.text)}</p></div>`;
    box.hidden = false;
    await (session.kind === 'local' ? wait(1500) : new Promise((r) => setTimeout(r, 1700)));
    box.hidden = true;
  }

  function showOver(winner, reason) {
    $('#overTitle').textContent = `${winner.name} wins!`;
    $('#overTitle').style.color = winner.color;
    $('#overReason').textContent = reason;
    const list = $('#standings');
    list.innerHTML = '';
    view.players.slice().sort((a, b) => (a.bankrupt - b.bankrupt) || view.netWorth(b) - view.netWorth(a)).forEach((p) => {
      const li = el('li', p.bankrupt ? 'out' : '');
      li.style.setProperty('--pc', p.color);
      li.innerHTML = `<span class="pawn-dot"></span><b>${esc(p.name)}</b><span>${p.bankrupt ? 'Bankrupt' : fmt(view.netWorth(p))}</span>`;
      list.appendChild(li);
    });
    $('#over').hidden = false;
  }
  $('#overBtn').addEventListener('click', leaveSession);

  // ---------- HUD ----------
  function renderHud() {
    if (!view) return;
    const box = $('#chips');
    box.innerHTML = '';
    const current = view.players[view.turn];
    view.players.forEach((p) => {
      const me = session && session.kind === 'online' && p.id === session.seat;
      const chip = el('div', `chip${p === current && !view.winner ? ' active' : ''}${p.bankrupt ? ' out' : ''}`);
      chip.style.setProperty('--pc', p.color);
      const badges = [p.islandTurns ? 'Isle' : '', p.shield ? 'Shield' : '', p.coupon ? '½ rent' : ''].filter(Boolean);
      chip.innerHTML = `<span class="pawn-dot"></span>
        <span class="chip-text"><span class="chip-name">${esc(p.name)}${me ? ' <i>you</i>' : ''}${p.isBot ? ' <i>bot</i>' : ''}</span>
        <span class="chip-cash">${p.bankrupt ? 'Bankrupt' : fmt(p.cash)}</span></span>${badges.map((b) => `<span class="badge">${b}</span>`).join('')}`;
      chip.title = `${p.name}: net worth ${fmt(view.netWorth(p))}, lap ${p.laps + 1}`;
      box.appendChild(chip);
    });
    $('#round').textContent = `Round ${view.round}${view.rules.maxRounds < 999 ? ' / ' + view.rules.maxRounds : ''}`;
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

  function showInfo(id, pinned) {
    const t = view.tiles[id];
    const owner = t.owner >= 0 ? view.players[t.owner] : null;
    let body = '';
    if (t.type === 'city') {
      const rows = D.RENT_MULT.map((m, l) => `<tr${owner && l === t.level ? ' class="cur"' : ''}><td>${D.LEVEL_NAMES[l]}</td><td>${fmt(t.price * m)}</td><td>${l ? fmt(view.buildCost(t, l)) : fmt(t.price)}</td></tr>`).join('');
      body = `<p class="muted">${D.GROUPS[t.group].name} · ${view.groupTiles(t.group).length} cities</p>
        <table><thead><tr><th>Level</th><th>Rent</th><th>Cost</th></tr></thead><tbody>${rows}</tbody></table>
        <p class="muted">Rent doubles with the whole region${owner && t.level < 4 ? ` · buyout ${fmt(view.buyoutPrice(t))}` : ''}</p>`;
    } else if (t.type === 'resort') {
      body = `<p class="muted">Price ${fmt(t.price)}. Rent by resorts owned: ${D.RESORT_RENT.map(fmt).join(' / ')}.</p>`;
    } else {
      body = `<p class="muted">${{
        start: `Collect ${fmt(view.rules.salary)} each time you pass. Land exactly here for a free upgrade.`,
        island: `Stuck for up to ${view.rules.islandTurns} turns. Roll doubles or pay ${fmt(view.rules.islandFine)} to leave.`,
        festival: 'Host the Grand Gala in one of your properties to double its rent.',
        worldTour: `Pay ${fmt(view.rules.worldTourFee)} to fly to any tile.`,
        chance: 'Draw a Fortune card.',
        tax: `Pay ${Math.round(view.rules.taxRate * 100)}% of your net worth.`,
      }[t.type]}</p>`;
    }
    const box = $('#info');
    box.innerHTML = `<h3 style="--gc:${t.type === 'city' ? D.GROUPS[t.group].color : '#8aa0c8'}">${esc(t.name)}</h3>
      ${owner ? `<p class="own"><span class="pawn-dot" style="--pc:${owner.color}"></span>${esc(owner.name)} · rent ${fmt(view.rent(t))}${view.festival === t.id ? ' · Gala' : ''}</p>` : ''}${body}`;
    box.classList.toggle('pinned', pinned);
    const [sx, sy] = board.tileScreenPos(id);
    const r = $('#game').getBoundingClientRect();
    box.hidden = false;
    const w = box.offsetWidth, h = box.offsetHeight;
    let x = sx + 28;
    if (x + w > r.width - 12) x = sx - w - 28;
    x = Math.max(12, Math.min(x, r.width - w - 12));
    const y = Math.max(76, Math.min(sy - h / 2, r.height - h - 12));
    box.style.left = x + 'px';
    box.style.top = y + 'px';
  }

  // ---------- prompts ----------
  function setAction(html) {
    $('#action').innerHTML = html;
    $('#action').classList.toggle('empty', !html);
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
    setAction('');
    ps.resolve(undefined);
  }

  function finishPrompt(value) {
    const ps = promptState;
    if (!ps) return;
    promptState = null;
    board.setPickable(null);
    setAction('');
    ps.resolve(value);
  }

  function tileHead(t) {
    const col = t.type === 'city' ? D.GROUPS[t.group].color : '#4aa8c9';
    return `<div class="ask-tile"><span class="sw" style="--gc:${col}"></span><div><b>${esc(t.name)}</b><small>${t.type === 'city' ? D.GROUPS[t.group].name : 'Resort'}</small></div></div>`;
  }

  function prompt(p, req, reqId, deadline) {
    return new Promise((resolve) => {
      if (promptState) closePrompt();
      promptState = { resolve, reqId };
      const who = `<span class="who" style="--pc:${p.color}">${esc(p.name)}</span>`;
      const t = req.tile;
      let html = '';
      let buttons = [];
      let pick = null;
      let cancel = null;
      switch (req.type) {
        case 'roll':
          html = `<p>${who}, your roll.</p>`;
          buttons = [{ label: 'Roll dice', value: true, primary: true, big: true }];
          break;
        case 'buy':
          html = tileHead(t) + `<p>Nobody owns this yet. ${who}, buy it?</p>`;
          buttons = req.options.map((o, i) => ({ label: `${o.level ? 'With ' + D.LEVEL_NAMES[o.level] : 'Plot only'}<small>${fmt(o.cost)}</small>`, value: o.level, primary: i === req.options.length - 1 }))
            .concat([{ label: 'Pass', value: -1, ghost: true }]);
          break;
        case 'build':
          html = tileHead(t) + `<p>${who}, build on your ${D.LEVEL_NAMES[t.level]}?</p>`;
          buttons = req.options.map((o, i) => ({ label: `${D.LEVEL_NAMES[o.level]}<small>${fmt(o.cost)}</small>`, value: o.level, primary: i === req.options.length - 1 }))
            .concat([{ label: 'Not now', value: -1, ghost: true }]);
          break;
        case 'resort':
          html = tileHead(t) + `<p>${who}, buy this resort?</p>`;
          buttons = [{ label: `Buy<small>${fmt(req.price)}</small>`, value: true, primary: true }, { label: 'Pass', value: false, ghost: true }];
          break;
        case 'buyout':
          html = tileHead(t) + `<p>${who}, buy it out from <b style="color:${req.owner.color}">${esc(req.owner.name)}</b>?</p>`;
          buttons = [{ label: `Buy out<small>${fmt(req.price)}</small>`, value: true, primary: true }, { label: 'No thanks', value: false, ghost: true }];
          break;
        case 'island':
          html = `<p>${who} is stranded on Castaway Isle · ${req.turnsLeft} ${req.turnsLeft === 1 ? 'try' : 'tries'} left</p>`;
          buttons = [{ label: 'Roll for doubles', value: 'roll', primary: true }, { label: `Pay to leave<small>${fmt(req.fine)}</small>`, value: 'pay' }];
          break;
        case 'worldTour':
          html = `<p>${who}, tap any tile to fly there for ${fmt(req.fee)}.</p>`;
          pick = req.choices; cancel = 'Stay here';
          break;
        case 'festival':
          html = `<p>${who}, tap one of your glowing properties to host the Grand Gala.</p>`;
          pick = req.choices; cancel = 'Skip';
          break;
        case 'startUpgrade':
          html = `<p>${who}, tap a glowing city for a free upgrade.</p>`;
          pick = req.choices; cancel = 'Skip';
          break;
        case 'earthquake':
          html = `<p>${who}, tap a glowing rival city to shake it.</p>`;
          pick = req.choices;
          break;
      }
      if (pick) {
        promptState.pick = pick;
        board.setPickable(pick);
        pinnedInfo = -1;
        $('#info').hidden = true;
        if (cancel) buttons = [{ label: cancel, value: -1, ghost: true }];
      }
      setAction(`<div class="ask">${html}</div><div class="btns"></div>${timerBar(deadline)}`);
      const row = $('#action .btns');
      buttons.forEach((b) => {
        const btn = el('button', `btn${b.primary ? ' primary' : ''}${b.ghost ? ' ghost' : ''}${b.big ? ' big' : ''}`, b.label);
        btn.type = 'button';
        btn.addEventListener('click', () => finishPrompt(b.value));
        row.appendChild(btn);
      });
      const first = row.querySelector('.primary') || row.querySelector('.btn');
      if (first) first.focus({ preventScroll: true });
    });
  }

  // ---------- misc ----------
  let toastTimer = null;
  function toast(text) {
    const t = $('#ticker');
    t.textContent = text;
    t.classList.add('warn');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('warn'), 3000);
  }

  function togglePanel(btn, panel) {
    const open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }
  $('#journalBtn').addEventListener('click', () => togglePanel($('#journalBtn'), $('#journal')));
  $('#menuBtn').addEventListener('click', () => togglePanel($('#menuBtn'), $('#menu')));
  $('#quitBtn').addEventListener('click', () => {
    if (confirm('Leave this game?')) { $('#menu').hidden = true; leaveSession(); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { pinnedInfo = -1; $('#info').hidden = true; }
    if (e.key === ' ' && !e.target.closest('input, select, button, textarea')) {
      const btn = $('#action .btn.primary');
      if (btn) { e.preventDefault(); btn.click(); }
    }
  });

  // Invite links look like ?room=CODE. A saved token rejoins the same seat.
  const linkCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (linkCode) {
    $('#joinCode').value = linkCode;
    const saved = seatStore.get(linkCode);
    if (saved) openRoom(linkCode, saved);
  }
  if (!session) show('home');
})();
