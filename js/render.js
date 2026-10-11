// Atlas Tycoon - isometric canvas renderer. Draws a floating-island board from a Game
// (or a snapshot-loaded Game) and animates pawns, buildings and the camera.
(function () {
  const D = window.ATData;
  const TILE_Z = 0.18;
  const GAP = 0.045;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const easeBack = (t) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(hex, amt) {
    const [r, g, b] = hexToRgb(hex);
    const f = (c) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }
  function mix(a, b, t) {
    const x = hexToRgb(a), y = hexToRgb(b);
    const h = (i) => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, '0');
    return '#' + h(0) + h(1) + h(2);
  }

  // Board geometry: corners are C x C, side tiles are 1 wide and C deep, so the board is S = 2C + 7
  // across. Departure sits at the front corner of the diamond.
  const C = 1.6;
  const S = 2 * C + 7;
  const OFF = S / 2 - 4.5; // shift for park decorations that were laid out around 4.5
  function rectOf(i) {
    const side = Math.floor(i / 8), k = i % 8;
    let x0, y0, w, h;
    if (k === 0) { [x0, y0] = [[S - C, S - C], [0, S - C], [0, 0], [S - C, 0]][side]; w = h = C; }
    else if (side === 0) { x0 = S - C - k; y0 = S - C; w = 1; h = C; }
    else if (side === 1) { x0 = 0; y0 = S - C - k; w = C; h = 1; }
    else if (side === 2) { x0 = C + k - 1; y0 = 0; w = 1; h = C; }
    else { x0 = S - C; y0 = C + k - 1; w = C; h = 1; }
    // Side tiles have a depth axis; the half nearer the board's back (smaller coordinate) holds the
    // building, the half nearer the camera holds the printed card so buildings never cover it.
    const axis = k === 0 ? null : side % 2 === 0 ? 'y' : 'x';
    return { x0, y0, x1: x0 + w, y1: y0 + h, cx: x0 + w / 2, cy: y0 + h / 2, axis };
  }
  const RECTS = D.TILES.map((t) => rectOf(t.id));
  const DRAW_ORDER = RECTS.map((r, i) => i).sort((a, b) => (RECTS[a].cx + RECTS[a].cy) - (RECTS[b].cx + RECTS[b].cy));
  // A point on a tile: `along` the board edge from the centre, `depth` from the tile's back edge.
  function at(r, along, depth) {
    if (!r.axis) return [r.cx + along, r.cy + depth];
    return r.axis === 'y' ? [r.cx + along, r.y0 + depth] : [r.x0 + depth, r.cy + along];
  }
  // Pawn slots as [along, depth offset] around the line between building and card.
  const SLOTS = [[-0.22, -0.2], [0.22, -0.2], [-0.22, -0.04], [0.22, -0.04]];
  const CORNER_TOP = { start: '#ffe39a', island: '#f7dea8', festival: '#ffd0e2', worldTour: '#d4e6ff' };
  const CARD_COLOR = { resort: '#1fa2b8', chance: '#e0a21b', tax: '#c0392b', start: '#e8553d', island: '#d9962b', festival: '#d65a7a', worldTour: '#3d7fc4' };

  // Deterministic jagged rock outline under the island.
  const ROCK = Array.from({ length: 11 }, (_, i) => 0.5 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 1.1);

  class IsoBoard {
    constructor(canvas, handlers) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.h = handlers || {};
      this.game = null;
      this.tokens = [];
      this.grow = {};
      this.pick = null;
      this.hover = -1;
      this.flashId = -1;
      this.active = -1;
      this.floats = [];
      this.clouds = Array.from({ length: 6 }, (_, i) => ({ x: (i * 0.23) % 1, y: 0.06 + ((i * 37) % 70) / 100, s: 0.6 + (i % 3) * 0.35, v: 0.004 + (i % 4) * 0.002 }));
      this.fonts = { display: '"Lilita One", "Arial Rounded MT Bold", sans-serif', body: '"Outfit", system-ui, sans-serif' };
      this.cam = { z: 1, x: 0, y: 0 };
      this.autoCam = true;
      this.followId = -1;
      this.camGoal = null;
      this.resize();
      new ResizeObserver(() => this.resize()).observe(canvas);
      this.bindCamera();
      canvas.addEventListener('pointerleave', () => { this.hover = -1; this.h.onHover && this.h.onHover(-1); });
      canvas.addEventListener('click', (e) => { if (!this.dragged) this.onPointer(e, true); });
      this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const dark = window.matchMedia('(prefers-color-scheme: dark)');
      const setClouds = () => (this.cloudColor = dark.matches ? 'rgba(170,185,255,0.10)' : 'rgba(255,255,255,0.45)');
      setClouds();
      dark.addEventListener('change', setClouds);
      const loop = (t) => { this.draw(t); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }

    // ---------- public API ----------
    setGame(game) {
      this.game = game;
      this.syncTokens();
    }

    syncTokens() {
      if (!this.game) return;
      this.tokens = this.game.players.map((p, i) => {
        const [x, y] = this.slotPos(p.pos, i);
        return { x, y, z: 0, alpha: p.bankrupt ? 0 : 1 };
      });
    }

    slotPos(tileId, pid) {
      const r = RECTS[tileId];
      const s = SLOTS[pid % 4];
      if (!r.axis) return [r.cx + 0.2 + s[0] * 1.5, r.cy + 0.2 + s[1] * 1.5];
      // Pawns stand on the line between the building and the printed card.
      return at(r, s[0], C * 0.5 + s[1]);
    }

    async animateMove(pid, path, jump) {
      const tk = this.tokens[pid];
      if (!tk) return;
      if (jump || this.reduced) {
        const [x, y] = this.slotPos(path[path.length - 1], pid);
        await this.tween(520, (k) => { tk.z = 2.4 * (1 - ease(k)); tk.x = x; tk.y = y; });
        tk.z = 0;
        return;
      }
      for (const pos of path) {
        const [x, y] = this.slotPos(pos, pid);
        const sx = tk.x, sy = tk.y;
        if (this.onHop) this.onHop();
        await this.tween(230, (k) => {
          tk.x = sx + (x - sx) * k;
          tk.y = sy + (y - sy) * k;
          tk.z = Math.sin(Math.PI * k) * 0.55;
        });
        tk.z = 0;
      }
    }

    // A bankrupt pawn tips off the board and fades away.
    hideToken(pid) {
      const tk = this.tokens[pid];
      if (!tk) return Promise.resolve();
      if (this.skipping) { tk.alpha = 0; return Promise.resolve(); }
      return this.tween(1300, (k) => { tk.z = -2.6 * k * k; tk.alpha = 1 - k; });
    }

    // A dust cloud where a building was lost (sold, bankrupt, earthquake).
    puff(tileId) {
      const [x, y] = this.anchor(tileId);
      this.puffs = (this.puffs || []).concat([{ x, y, t0: performance.now() }]);
    }

    // Renders one building (or a bare plot) on a tile, in this board's own style, as an image URL.
    buildingImage(level, color, px) {
      const key = level + color + px;
      this.imgCache = this.imgCache || {};
      if (this.imgCache[key]) return this.imgCache[key];
      const cv = document.createElement('canvas');
      cv.width = cv.height = px * 2;
      const keep = { ctx: this.ctx, TW: this.TW, TH: this.TH, ZS: this.ZS, ox: this.ox, oy: this.oy, now: this.now };
      const c = cv.getContext('2d');
      c.scale(2, 2);
      this.ctx = c;
      // Scale each picture so its building fills the frame (taller levels get a smaller tile).
      const tallest = [0.75, 0.8, 1.15, 1.45, 2.15][level];
      this.TW = Math.min(px * 0.92, (px - 12) / (0.5 + 0.55 * tallest));
      this.TH = this.TW / 2;
      this.ZS = this.TW * 0.55;
      this.ox = px / 2;
      this.oy = px - this.TH - 6;
      this.now = 0;
      this.box(0, 0, 1, 1, 0, TILE_Z, mix('#fffaf0', color, 0.22), shade(color, -0.05), shade(color, -0.3), 'rgba(60,40,20,0.25)');
      this.drawBuilding(level, 0.38, 0.38, TILE_Z, color, 1, 7);
      Object.assign(this, keep);
      this.imgCache[key] = cv.toDataURL();
      return this.imgCache[key];
    }

    markGrow(tileId) { this.grow[tileId] = performance.now(); }

    setPickable(ids) { this.pick = ids ? new Set(ids) : null; }

    // Destination highlight: the tile a pawn is heading to rises, grows and glows in the player's colour.
    setTarget(tileId, color, pid, from) {
      this.target = { id: tileId, color, pid, from, t0: performance.now() };
    }

    clearTarget(delay) {
      const tg = this.target;
      if (!tg) return;
      if (!delay) { this.target = null; return; }
      setTimeout(() => { if (this.target === tg) this.target = null; }, delay);
    }

    flash(tileId, ms) {
      this.flashId = tileId;
      setTimeout(() => { if (this.flashId === tileId) this.flashId = -1; }, ms || 600);
    }

    floatText(pid, text, color) {
      const tk = this.tokens[pid];
      if (!tk) return;
      this.floats.push({ x: tk.x, y: tk.y, text, color, t0: performance.now() });
    }

    tileScreenPos(id) {
      const r = RECTS[id];
      return this.P(r.cx, r.cy, TILE_Z);
    }

    // Skip animations when nobody can see them (background tab) or when catching up.
    get skipping() { return this.instant || document.hidden; }

    tween(ms, fn) {
      if (this.skipping) { fn(1); return Promise.resolve(); }
      return new Promise((resolve) => {
        const t0 = performance.now();
        let done = false;
        const finish = () => { if (!done) { done = true; fn(1); resolve(); } };
        // rAF stops in hidden tabs; the timer guarantees the promise still settles.
        setTimeout(finish, ms + 60);
        const step = (t) => {
          if (done) return;
          const k = Math.min(1, (t - t0) / ms);
          if (k >= 1) return finish();
          fn(k);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }

    // ---------- geometry ----------
    resize() {
      const r = this.canvas.getBoundingClientRect();
      this.W = Math.max(1, r.width);
      this.H = Math.max(1, r.height);
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = Math.round(this.W * this.dpr);
      this.canvas.height = Math.round(this.H * this.dpr);
      // Phones stack the tool bar and two player cards on top, two cards at the bottom.
      const narrow = this.W < 640;
      const padTop = narrow ? 112 : Number(this.canvas.dataset.padTop || 0);
      const padBottom = narrow ? 64 : Number(this.canvas.dataset.padBottom || 0);
      const avail = this.H - padTop - padBottom;
      // Board extents in tile widths: 9.8 across, about 6.9 tall including sky-high landmarks and rock.
      // Board extents in tile widths: 9.8 across, about 6.9 tall including sky-high landmarks and rock.
      // The diamond spans S + 0.9 tile widths either side of centre; leave a little headroom for
      // landmarks and let the hanging rock run off the bottom of the screen.
      const E = S + 0.9; // half the diamond's width in tile widths
      const tw = Math.max(20, Math.min((this.W * 0.98) / E, avail / (E / 2 + 0.55)));
      const total = (E / 2 + 0.55) * tw;
      this.base = { tw, ox: this.W / 2, oy: padTop + Math.max(0, (avail - total) / 2) + 0.55 * tw + 0.225 * tw };
      this.applyCamera();
    }

    // The camera scales and pans the whole board around the canvas centre.
    applyCamera() {
      const b = this.base, cam = this.cam;
      const cx = this.W / 2, cy = this.H / 2;
      // Keep at least part of the board on screen.
      const lim = 0.55 * this.W * cam.z;
      cam.x = Math.max(-lim, Math.min(lim, cam.x));
      cam.y = Math.max(-0.55 * this.H * cam.z, Math.min(0.55 * this.H * cam.z, cam.y));
      this.TW = b.tw * cam.z;
      this.TH = this.TW / 2;
      this.ZS = this.TW * 0.55;
      this.ox = cx + (b.ox - cx) * cam.z + cam.x;
      this.oy = cy + (b.oy - cy) * cam.z + cam.y;
    }

    // ---------- automatic camera ----------
    // follow(pid) eases in and keeps that pawn centred; overview() eases back to the whole board.
    follow(pid) {
      if (!this.autoCam) return;
      this.followId = pid;
      this.camGoal = 'follow';
    }

    // full=true always shows the whole board (picking a tile, double-click, game over).
    overview(full) {
      this.followId = -1;
      this.camGoal = 'overview';
      this.fullView = !!full;
    }

    // Phones in either orientation: the whole board would be too small to read.
    get small() { return this.W / this.H < 0.8 || this.W < 640 || this.H < 520; }

    setAutoCam(on) {
      this.autoCam = on;
      this.overview();
    }

    // Any manual pan or zoom hands the camera to the player until the next follow().
    stopAuto() {
      this.camGoal = null;
      this.followId = -1;
    }

    updateCamera(dt) {
      if (!this.camGoal || !this.base) return;
      const cam = this.cam, b = this.base;
      let tz = 1, tx = 0, ty = 0;
      // On tall phone screens the whole board is tiny, so "overview" frames the active pawn instead.
      const near = this.camGoal === 'overview' && !this.fullView && this.small && this.autoCam && this.tokens[this.active];
      const tk = near ? this.tokens[this.active] : this.tokens[this.followId];
      if ((this.camGoal === 'follow' || near) && tk) {
        tz = near ? 2.3 : this.small ? 2.7 : 1.5;
        const cx = this.W / 2, cy = this.H / 2;
        const bx = b.ox + (tk.x - tk.y) * b.tw / 2;
        const by = b.oy + (tk.x + tk.y) * b.tw / 4 - (TILE_Z + 0.4) * b.tw * 0.55;
        tx = cx - cx - (bx - cx) * tz;
        // Keep the pawn in the upper part of the screen so the decision card below it doesn't cover it.
        ty = this.H * (near ? 0.45 : this.W < 640 ? 0.25 : 0.3) - cy - (by - cy) * tz;
        // Don't leave empty sky beside the board: pull its corners back to the screen edges.
        const sx = (wx) => cx + (b.ox + wx * b.tw / 2 - cx) * tz + tx;
        const sy = (wy) => cy + (b.oy + wy * b.tw / 4 - cy) * tz + ty;
        const left = sx(-(S + 0.9)), right = sx(S + 0.9), top = sy(-0.9), front = sy(2 * S + 0.9);
        if (right - left > this.W) {
          if (left > 0) tx -= left;
          else if (right < this.W) tx += this.W - right;
        }
        if (front < this.H * 0.86) ty += this.H * 0.86 - front;
        else if (top > this.H * 0.12) ty -= Math.min(top - this.H * 0.12, front - this.H * 0.86);
      }
      const k = this.reduced ? 1 : 1 - Math.exp(-Math.min(dt, 100) / 420);
      cam.z += (tz - cam.z) * k;
      cam.x += (tx - cam.x) * k;
      cam.y += (ty - cam.y) * k;
      if (this.camGoal === 'overview' && !near && Math.abs(cam.z - 1) < 0.002 && Math.abs(cam.x) < 0.5 && Math.abs(cam.y) < 0.5) {
        this.cam = { z: 1, x: 0, y: 0 };
        this.camGoal = null;
      }
      this.applyCamera();
    }

    zoomAt(px, py, z) {
      const cam = this.cam;
      const nz = Math.max(1, Math.min(2.8, z));
      const cx = this.W / 2, cy = this.H / 2;
      // Keep the point under the cursor fixed while zooming.
      const bx = (px - cx - cam.x) / cam.z, by = (py - cy - cam.y) / cam.z;
      cam.x = px - cx - bx * nz;
      cam.y = py - cy - by * nz;
      cam.z = nz;
      if (nz === 1) { cam.x = 0; cam.y = 0; }
      this.applyCamera();
    }

    bindCamera() {
      const cv = this.canvas;
      const pts = new Map();
      let start = null;
      const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.stopAuto();
        const [x, y] = local(e);
        this.zoomAt(x, y, this.cam.z * Math.exp(-e.deltaY * 0.0015));
      }, { passive: false });
      cv.addEventListener('dblclick', () => this.overview(true));
      cv.addEventListener('pointerdown', (e) => {
        pts.set(e.pointerId, local(e));
        this.dragged = false;
        start = { cam: Object.assign({}, this.cam), pts: new Map(pts) };
      });
      cv.addEventListener('pointermove', (e) => {
        if (!pts.has(e.pointerId)) return this.onPointer(e, false);
        pts.set(e.pointerId, local(e));
        const [a, b] = [...pts.values()];
        const [a0, b0] = [...start.pts.values()];
        if (pts.size === 2 && b && b0) {
          // Pinch: zoom by finger distance around the midpoint.
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]), d0 = Math.hypot(a0[0] - b0[0], a0[1] - b0[1]) || 1;
          this.stopAuto();
          this.cam = Object.assign({}, start.cam);
          this.applyCamera();
          this.zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, start.cam.z * (d / d0));
          this.dragged = true;
        } else if (pts.size === 1 && a0) {
          const dx = a[0] - a0[0], dy = a[1] - a0[1];
          if (this.dragged || Math.hypot(dx, dy) > 8) {
            if (!this.dragged) this.stopAuto();
            this.dragged = true;
            this.cam.x = start.cam.x + dx;
            this.cam.y = start.cam.y + dy;
            this.applyCamera();
          }
        }
      });
      const end = (e) => {
        pts.delete(e.pointerId);
        start = { cam: Object.assign({}, this.cam), pts: new Map(pts) };
        // Let the click that follows a drag see the flag, then clear it.
        setTimeout(() => { if (!pts.size) this.dragged = false; }, 0);
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
    }

    P(x, y, z) {
      return [this.ox + (x - y) * this.TW / 2, this.oy + (x + y) * this.TH / 2 - (z || 0) * this.ZS];
    }

    pickAt(sx, sy) {
      const u = (sx - this.ox) / (this.TW / 2);
      const v = (sy - this.oy + TILE_Z * this.ZS) / (this.TH / 2);
      const x = (u + v) / 2, y = (v - u) / 2;
      return RECTS.findIndex((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1);
    }

    onPointer(e, click) {
      const r = this.canvas.getBoundingClientRect();
      const id = this.pickAt(e.clientX - r.left, e.clientY - r.top);
      if (id !== this.hover && !click) {
        this.hover = id;
        this.canvas.style.cursor = id >= 0 && (!this.pick || this.pick.has(id)) ? 'pointer' : 'default';
        this.h.onHover && this.h.onHover(id);
      }
      if (click) this.h.onClick && this.h.onClick(id);
    }

    // ---------- primitives ----------
    poly(pts, fill, stroke, lw) {
      const c = this.ctx;
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1; c.stroke(); }
    }

    box(x0, y0, x1, y1, z0, z1, top, left, right, edge) {
      const P = this.P.bind(this);
      this.poly([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], right, edge, 0.6);
      this.poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], left, edge, 0.6);
      this.poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], top, edge, 0.6);
    }

    roof(x0, y0, x1, y1, z, h, color) {
      const P = this.P.bind(this);
      const apex = P((x0 + x1) / 2, (y0 + y1) / 2, z + h);
      this.poly([P(x1, y0, z), P(x1, y1, z), apex], shade(color, -0.25));
      this.poly([P(x0, y1, z), P(x1, y1, z), apex], shade(color, -0.05));
    }

    // Window rows on the two visible faces of a box.
    windows(x0, y0, x1, y1, z0, z1, color, rows, cols) {
      const P = this.P.bind(this);
      const hz = (z1 - z0) / rows;
      for (let r = 0; r < rows; r++) {
        const za = z0 + hz * (r + 0.3), zb = z0 + hz * (r + 0.75);
        for (let k = 0; k < cols; k++) {
          const ta = (k + 0.25) / cols, tb = (k + 0.75) / cols;
          const ya = y0 + (y1 - y0) * ta, yb = y0 + (y1 - y0) * tb;
          this.poly([P(x1, ya, za), P(x1, yb, za), P(x1, yb, zb), P(x1, ya, zb)], color);
          const xa = x0 + (x1 - x0) * ta, xb = x0 + (x1 - x0) * tb;
          this.poly([P(xa, y1, za), P(xb, y1, za), P(xb, y1, zb), P(xa, y1, zb)], color);
        }
      }
    }

    ellipse(x, y, z, rx, color) {
      const [sx, sy] = this.P(x, y, z);
      const c = this.ctx;
      c.beginPath();
      c.ellipse(sx, sy, rx * this.TW * 0.7, rx * this.TH * 0.7, 0, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
    }

    // ---------- scene ----------
    draw(now) {
      this.updateCamera(now - (this.lastFrame || now));
      this.lastFrame = now;
      const c = this.ctx;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, this.W, this.H);
      this.now = now;
      this.drawClouds(now);
      if (!this.game) return;
      this.drawIslets(now);
      const objects = [];
      this.drawIsland(now, objects);
      // Back to front, so a tile's side faces never paint over the card on the tile in front of it.
      for (const id of DRAW_ORDER) this.drawTile(this.game.tiles[id], objects);
      this.game.players.forEach((p, i) => {
        const tk = this.tokens[i];
        if (tk && tk.alpha > 0) objects.push({ d: tk.x + tk.y + 0.05, f: () => this.drawPawn(p, tk, i) });
      });
      objects.sort((a, b) => a.d - b.d).forEach((o) => o.f());
      this.drawFloats(now);
    }

    drawClouds(now) {
      const c = this.ctx;
      c.save();
      for (const cl of this.clouds) {
        const x = (((cl.x + (now / 1000) * cl.v) % 1.2) - 0.1) * this.W;
        const y = cl.y * this.H;
        const s = cl.s * Math.max(40, this.W * 0.06);
        c.fillStyle = this.cloudColor;
        c.beginPath();
        c.ellipse(x, y, s * 1.6, s * 0.45, 0, 0, Math.PI * 2);
        c.ellipse(x + s * 0.6, y - s * 0.25, s * 0.8, s * 0.45, 0, 0, Math.PI * 2);
        c.ellipse(x - s * 0.5, y - s * 0.15, s * 0.7, s * 0.35, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }

    // Small floating islets drifting in the sky around the board.
    drawIslets(now) {
      const spots = [[-2.7, 5.2, 0.55, 0], [5.3, -2.6, 0.45, 1.7], [-1.6, 9.6, 0.32, 3.1]];
      for (const [x, y, r, ph] of spots) {
        const bob = Math.sin(now / 1400 + ph) * 0.12;
        const z0 = -0.3 + bob;
        const P = this.P.bind(this);
        this.poly([P(x - r, y + r, z0 - 0.18), P(x + r, y + r, z0 - 0.18), P(x + r * 0.2, y + r * 0.2, z0 - 1.1 * r - 0.4)], '#7a5640');
        this.poly([P(x + r, y + r, z0 - 0.18), P(x + r, y - r, z0 - 0.18), P(x + r * 0.2, y + r * 0.2, z0 - 1.1 * r - 0.4)], '#5e4031');
        this.box(x - r, y - r, x + r, y + r, z0 - 0.18, z0, '#9ad67f', '#b07c52', '#8e603e');
        if (r > 0.4) this.drawPalm(x - 0.05, y - 0.05, z0, 0.65);
        else this.drawTree(x, y, z0, 0.13, 0);
      }
    }

    drawTree(x, y, z, r, kind) {
      const c = this.ctx;
      const [sx, sy] = this.P(x, y, z);
      const R = r * this.TW;
      c.fillStyle = 'rgba(30,60,30,0.22)';
      c.beginPath(); c.ellipse(sx + R * 0.3, sy, R * 1.1, R * 0.45, 0, 0, Math.PI * 2); c.fill();
      if (kind === 1) {
        // Pine: stacked cones.
        c.fillStyle = '#7a5236';
        c.fillRect(sx - R * 0.12, sy - R * 0.5, R * 0.24, R * 0.5);
        [['#2f8a4a', 0], ['#3aa058', 0.55], ['#4cb766', 1.05]].forEach(([col, k]) => {
          const base = sy - R * (0.4 + k), w = R * (1 - k * 0.32);
          c.fillStyle = col;
          c.beginPath(); c.moveTo(sx - w, base); c.lineTo(sx + w, base); c.lineTo(sx, base - R * 1.1); c.closePath(); c.fill();
        });
        return;
      }
      c.strokeStyle = '#7a5236';
      c.lineWidth = Math.max(1.5, R * 0.25);
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx, sy - R * 0.9); c.stroke();
      c.fillStyle = '#3f9a4f';
      c.beginPath(); c.arc(sx, sy - R * 1.35, R * 0.85, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#56b862';
      c.beginPath(); c.arc(sx - R * 0.25, sy - R * 1.6, R * 0.6, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.25)';
      c.beginPath(); c.arc(sx - R * 0.4, sy - R * 1.8, R * 0.25, 0, Math.PI * 2); c.fill();
    }

    drawFlowers(x, y, z, seed) {
      const c = this.ctx;
      const cols = ['#ff7aa2', '#ffd54a', '#ffffff', '#b38cff'];
      const [sx, sy] = this.P(x, y, z);
      c.fillStyle = '#6cc35a';
      c.beginPath(); c.ellipse(sx, sy, this.TW * 0.2, this.TW * 0.09, 0, 0, Math.PI * 2); c.fill();
      for (let i = 0; i < 9; i++) {
        const a = seed * 3.1 + i * 2.39, d = ((i * 37 + seed * 11) % 10) / 10;
        c.fillStyle = cols[(i + seed) % cols.length];
        c.beginPath();
        c.arc(sx + Math.cos(a) * this.TW * 0.16 * d, sy + Math.sin(a) * this.TW * 0.07 * d - 1, Math.max(1.2, this.TW * 0.018), 0, Math.PI * 2);
        c.fill();
      }
    }

    drawFountain(x, y, now) {
      const c = this.ctx;
      const [bx, by] = this.P(x, y, 0.02);
      c.fillStyle = '#e9eef6';
      c.beginPath(); c.ellipse(bx, by, this.TW * 0.14, this.TW * 0.06, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#9fe2f2';
      c.beginPath(); c.ellipse(bx, by - 1, this.TW * 0.1, this.TW * 0.04, 0, 0, Math.PI * 2); c.fill();
      for (let i = 0; i < 14; i++) {
        const ph = ((now / 1100) + i / 14) % 1;
        const ang = i * 2.4;
        const h = Math.sin(Math.PI * ph) * this.ZS * 0.55;
        const spread = ph * this.TW * 0.11;
        c.fillStyle = `rgba(230,250,255,${0.9 - ph * 0.6})`;
        c.beginPath();
        c.arc(bx + Math.cos(ang) * spread, by - h + Math.sin(ang) * spread * 0.4, Math.max(1, this.TW * 0.012), 0, Math.PI * 2);
        c.fill();
      }
    }

    drawIsland(now, objects) {
      const P = this.P.bind(this);
      const c = this.ctx;
      const a = -0.45, b = S + 0.45, zt = -0.02, zb = -0.6;
      // Hanging rock under the two visible edges.
      const left = [P(a, b, zb)], right = [P(b, b, zb)];
      ROCK.forEach((d, i) => {
        const t = i / (ROCK.length - 1);
        left.push(P(a + (b - a) * t, b, zb - d * (1 - Math.abs(t - 0.75) * 0.9)));
      });
      left.push(P(b, b, zb));
      ROCK.forEach((d, i) => {
        const t = i / (ROCK.length - 1);
        right.push(P(b, b - (b - a) * t, zb - ROCK[(i + 4) % ROCK.length] * (1 - Math.abs(t - 0.25) * 0.9)));
      });
      right.push(P(b, a, zb));
      this.poly(left, '#7a5640');
      this.poly(right, '#5e4031');
      // Soil slab with darker strata and a grass lip.
      this.box(a, a, b, b, zb, zt, '#94d27a', '#b07c52', '#8e603e');
      [-0.28, -0.44].forEach((zz, i) => {
        this.poly([P(a, b, zz), P(b, b, zz), P(b, b, zz - 0.04), P(a, b, zz - 0.04)], i ? '#9a6a45' : '#a57250');
        this.poly([P(b, a, zz), P(b, b, zz), P(b, b, zz - 0.04), P(b, a, zz - 0.04)], i ? '#7c5236' : '#86593b');
      });
      this.poly([P(a, b, zt), P(b, b, zt), P(b, b, zt - 0.12), P(a, b, zt - 0.12)], '#6fae58');
      this.poly([P(b, a, zt), P(b, b, zt), P(b, b, zt - 0.12), P(b, a, zt - 0.12)], '#5d9a49');
      // Grass tufts hanging over the lip.
      for (let i = 0; i < 24; i++) {
        const t = (i + 0.5) / 24;
        const [lx, ly] = P(a + (b - a) * t, b, zt - 0.12);
        const [rx, ry] = P(b, b - (b - a) * t, zt - 0.12);
        const h = this.TW * (0.05 + ((i * 7) % 5) * 0.012);
        c.fillStyle = '#6fae58';
        c.beginPath(); c.moveTo(lx - h * 0.6, ly - 1); c.lineTo(lx, ly + h); c.lineTo(lx + h * 0.6, ly - 1); c.fill();
        c.fillStyle = '#5d9a49';
        c.beginPath(); c.moveTo(rx - h * 0.6, ry - 1); c.lineTo(rx, ry + h); c.lineTo(rx + h * 0.6, ry - 1); c.fill();
      }
      // Waterfall spilling from the left cliff.
      const wx0 = 2.4, wx1 = 3.0, wTop = zt - 0.1, wBot = zb - 2.6;
      const grad = c.createLinearGradient(0, P(wx0, b, wTop)[1], 0, P(wx0, b, wBot)[1]);
      grad.addColorStop(0, 'rgba(150,225,250,0.95)');
      grad.addColorStop(0.7, 'rgba(150,225,250,0.55)');
      grad.addColorStop(1, 'rgba(150,225,250,0)');
      this.poly([P(wx0, b, wTop), P(wx1, b, wTop), P(wx1 + 0.08, b, wBot), P(wx0 - 0.08, b, wBot)], grad);
      c.strokeStyle = 'rgba(255,255,255,0.7)';
      c.lineWidth = Math.max(1, this.TW * 0.012);
      for (let k = 0; k < 6; k++) {
        const u = wx0 + 0.06 + k * 0.1;
        const ph = ((now / 700) + k * 0.37) % 1;
        const za = wTop - ph * (wTop - wBot) * 0.8, zb2 = za - 0.35;
        const [x1, y1] = P(u, b, za), [x2, y2] = P(u, b, zb2);
        c.globalAlpha = 1 - ph;
        c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      }
      c.globalAlpha = 1;
      const [mx, my] = P((wx0 + wx1) / 2, b, wTop);
      c.fillStyle = 'rgba(255,255,255,0.5)';
      c.beginPath(); c.ellipse(mx, my, this.TW * 0.2, this.TW * 0.05, 0, 0, Math.PI * 2); c.fill();

      // Centre park: lawn with a hedge border, painted title, pond with a fountain.
      const p0 = C + 0.1, p1 = S - C - 0.1, q0 = C + 0.22, q1 = S - C - 0.22;
      this.poly([P(p0, p0, 0), P(p1, p0, 0), P(p1, p1, 0), P(p0, p1, 0)], '#86c96d');
      this.poly([P(q0, q0, 0), P(q1, q0, 0), P(q1, q1, 0), P(q0, q1, 0)], '#a5dc89');
      // Mown stripes.
      for (let i = 0; i < 6; i++) {
        const u = q0 + i * 1.1;
        this.poly([P(u, q0, 0), P(u + 0.55, q0, 0), P(u + 0.55, q1, 0), P(u, q1, 0)], 'rgba(255,255,255,0.07)');
      }
      // Sand path from Departure's corner to the pond.
      this.poly([P(q1, q1 - 0.28, 0), P(q1, q1, 0), P(q1 - 0.28, q1, 0), P(7.5, 7.7, 0), P(7.7, 7.5, 0)], '#f1dfae');
      c.save();
      const s = this.TW / 200;
      c.setTransform(this.dpr * s, this.dpr * s * 0.5, -this.dpr * s, this.dpr * s * 0.5, this.dpr * this.ox, this.dpr * this.oy);
      // In this transform 100 units = one tile.
      c.font = `92px ${this.fonts.display}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineJoin = 'round';
      c.lineWidth = 14;
      c.strokeStyle = 'rgba(46,92,46,0.35)';
      const L = 100 * OFF;
      c.strokeText('ATLAS', 456 + L, 301 + L);
      c.strokeText('TYCOON', 456 + L, 401 + L);
      c.fillStyle = '#fff6df';
      c.fillText('ATLAS', 450 + L, 295 + L);
      c.fillText('TYCOON', 450 + L, 395 + L);
      c.restore();
      this.ellipse(6.45 + OFF, 6.35 + OFF, 0, 1.0, '#e9dbb0');
      this.ellipse(6.45 + OFF, 6.35 + OFF, 0, 0.9, '#4fb6d3');
      this.ellipse(6.4 + OFF, 6.3 + OFF, 0, 0.72, '#7fd3e6');
      [[6.0, 6.7], [6.9, 5.95], [6.2, 5.95]].forEach(([x, y]) => this.ellipse(x + OFF, y + OFF, 0.01, 0.07, '#5aa858'));
      const ripple = (now / 2200) % 1;
      const [rx, ry] = P(6.4 + OFF, 6.3 + OFF, 0.01);
      c.strokeStyle = `rgba(255,255,255,${0.5 * (1 - ripple)})`;
      c.lineWidth = 1.2;
      c.beginPath(); c.ellipse(rx, ry, this.TW * 0.6 * ripple, this.TW * 0.3 * ripple, 0, 0, Math.PI * 2); c.stroke();

      // Trees, flowers and the fountain join the depth-sorted pass.
      const trees = [[1.9, 5.3, 0], [2.5, 6.2, 1], [1.8, 6.9, 0], [3.0, 7.25, 0], [2.25, 7.45, 1], [6.9, 1.8, 1], [7.35, 2.5, 0],
        [5.9, 1.65, 0], [7.4, 3.4, 1], [4.4, 7.2, 0], [7.25, 4.75, 0], [1.75, 1.9, 1], [3.8, 6.55, 1]];
      trees.forEach(([x, y, k]) => objects.push({ d: x + y + 2 * OFF, f: () => this.drawTree(x + OFF, y + OFF, 0, 0.15, k) }));
      [[3.4, 5.4, 1], [5.2, 5.0, 2], [2.2, 2.6, 3], [5.0, 7.0, 4]].forEach(([x, y, sd]) => objects.push({ d: x + y - 0.3 + 2 * OFF, f: () => this.drawFlowers(x + OFF, y + OFF, 0, sd) }));
      objects.push({ d: 12.7 + 2 * OFF, f: () => this.drawFountain(6.4 + OFF, 6.3 + OFF, now) });
    }

    drawTile(t, objects) {
      const g = this.game;
      const r = RECTS[t.id];
      const tg = this.target && this.target.id === t.id ? this.target : null;
      // The destination tile eases up to 10% larger.
      const grow = tg ? 0.06 * ease(Math.min(1, (this.now - tg.t0) / 400)) : 0;
      const x0 = r.x0 + GAP - grow, y0 = r.y0 + GAP - grow, x1 = r.x1 - GAP + grow, y1 = r.y1 - GAP + grow;
      const owner = t.owner >= 0 ? g.players[t.owner] : null;
      let top = CORNER_TOP[t.type] || '#fffaf0';
      let sideL = '#e8dcc3', sideR = '#d2c2a2';
      if (owner) {
        top = mix(top, owner.color, 0.22);
        sideL = shade(owner.color, -0.05);
        sideR = shade(owner.color, -0.3);
      }
      if (this.hover === t.id) top = mix(top, '#ffffff', 0.5);
      let lift = 0;
      if (this.pick && this.pick.has(t.id)) lift = 0.06 + Math.sin(this.now / 180) * 0.04;
      if (this.flashId === t.id) lift = 0.12;
      if (tg) lift = (0.1 + Math.sin(this.now / 220) * 0.03) * Math.min(1, (this.now - tg.t0) / 400);
      this.box(x0, y0, x1, y1, 0, TILE_Z + lift, top, sideL, sideR, 'rgba(60,40,20,0.25)');
      const z = TILE_Z + lift;
      const P = this.P.bind(this);
      // Bevel: light catches the back edges, the front edges sit in shade.
      const c = this.ctx;
      c.lineWidth = Math.max(1, this.TW * 0.014);
      c.strokeStyle = 'rgba(255,255,255,0.75)';
      c.beginPath(); c.moveTo(...P(x0, y1, z)); c.lineTo(...P(x0, y0, z)); c.lineTo(...P(x1, y0, z)); c.stroke();
      c.strokeStyle = 'rgba(80,60,30,0.18)';
      c.beginPath(); c.moveTo(...P(x1, y0, z)); c.lineTo(...P(x1, y1, z)); c.lineTo(...P(x0, y1, z)); c.stroke();
      this.drawGround(t, r, z);
      this.drawCard(t, r, z);
      if (this.pick && !this.pick.has(t.id)) {
        this.poly([P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)], 'rgba(20,30,60,0.35)');
      } else if (this.pick || this.flashId === t.id) {
        const a = 0.55 + Math.sin(this.now / 160) * 0.35;
        this.poly([P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)], null, `rgba(255,214,80,${a})`, 3);
      }
      const [ax, ay] = this.anchor(t.id);
      if (tg) objects.push({ d: r.cx + r.cy - 0.6, f: () => this.drawTargetGlow(tg, x0, y0, x1, y1, z) });
      objects.push({ d: ax + ay, f: () => this.drawProp(t, r, z) });
    }

    anchor(id) {
      const r = RECTS[id];
      return r.axis ? at(r, 0, C * 0.26) : [r.cx - 0.15, r.cy - 0.15];
    }

    quad(r, a0, d0, a1, d1, z) {
      const P = this.P.bind(this);
      return [at(r, a0, d0), at(r, a1, d0), at(r, a1, d1), at(r, a0, d1)].map(([x, y]) => P(x, y, z));
    }

    // Flat paint on a tile (beach, landing pad, painted arrow) drawn before anything stands on it.
    drawGround(t, r, z) {
      const c = this.ctx;
      const now = this.now;
      switch (t.type) {
        case 'resort': {
          // Sea along the back edge, then sand.
          this.poly(this.quad(r, -0.46, 0.05, 0.46, 0.34, z), '#5cc8e0');
          this.poly(this.quad(r, -0.46, 0.3, 0.46, 0.82, z), '#f3dca2');
          for (let i = 0; i < 3; i++) {
            const ph = ((now / 1800) + i / 3) % 1;
            const [a, b] = [at(r, -0.4, 0.1 + ph * 0.2), at(r, 0.4, 0.1 + ph * 0.2)].map(([x, y]) => this.P(x, y, z));
            c.strokeStyle = `rgba(255,255,255,${0.7 * (1 - ph)})`;
            c.lineWidth = Math.max(1, this.TW * 0.012);
            c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
          }
          return;
        }
        case 'chance': {
          // A soft golden spotlight under the floating box.
          const [x, y] = this.anchor(t.id);
          this.ellipse(x, y, z, 0.42, 'rgba(255,205,70,0.25)');
          this.ellipse(x, y, z, 0.24, 'rgba(255,205,70,0.35)');
          return;
        }
        case 'tax': {
          // Road with lane markings through the checkpoint.
          this.poly(this.quad(r, -0.46, 0.12, 0.46, 0.62, z), '#8d93a3');
          for (let i = 0; i < 4; i++) this.poly(this.quad(r, -0.4 + i * 0.22, 0.35, -0.3 + i * 0.22, 0.39, z), '#f4f1e6');
          return;
        }
        case 'start': {
          const pts = [[0.2, 0.42], [0.55, 0.42], [0.55, 0.3], [0.82, 0.5], [0.55, 0.7], [0.55, 0.58], [0.2, 0.58]];
          // Arrow points along -x (towards tile 1), drawn bigger on the corner tile.
          this.poly(pts.map(([u, v]) => this.P(r.cx + 0.75 - u * 1.4, r.cy - 0.55 + v * 1.1, z)), '#e8553d');
          return;
        }
        case 'island':
          this.ellipse(r.cx - 0.1, r.cy - 0.1, z, 0.75, '#6fcde0');
          this.ellipse(r.cx - 0.1, r.cy - 0.1, z, 0.55, '#f0cf86');
          return;
        case 'worldTour': {
          // Landing pad with a dashed ring.
          const [x, y] = [r.cx - 0.15, r.cy + 0.05];
          this.ellipse(x, y, z, 0.62, '#4b5470');
          this.ellipse(x, y, z, 0.54, '#5b6584');
          const [sx, sy] = this.P(x, y, z);
          c.save();
          c.setLineDash([this.TW * 0.06, this.TW * 0.05]);
          c.strokeStyle = '#ffd23f';
          c.lineWidth = Math.max(1.5, this.TW * 0.02);
          c.beginPath(); c.ellipse(sx, sy, this.TW * 0.3, this.TW * 0.15, 0, 0, Math.PI * 2); c.stroke();
          c.restore();
          return;
        }
        case 'festival':
          this.poly(this.quad(r, -0.65, -0.62, 0.45, 0.05, z), '#7a4a6a');
          return;
      }
    }

    // A card printed on the tile surface: coloured header (country or tile type), the name, and the
    // rent once someone owns it. Drawn in the tile's own plane so it reads like a printed label.
    drawCard(t, r, z) {
      const c = this.ctx;
      const owner = t.owner >= 0 ? this.game.players[t.owner] : null;
      const lab = this.labels ? this.labels(t) : { title: t.type === 'city' ? D.GROUPS[t.group].name : t.type, name: t.name, note: '' };
      const color = t.type === 'city' ? D.GROUPS[t.group].color : CARD_COLOR[t.type] || '#666';
      const ex = [this.TW / 2, this.TH / 2], ey = [-this.TW / 2, this.TH / 2];
      let u, v, cxw, cyw, wW, hW;
      if (!r.axis) {
        // Corner tiles: a plaque across the front of the tile.
        u = ex; v = ey;
        cxw = r.cx + 0.12; cyw = r.y1 - 0.34; wW = C - 0.4; hW = 0.5;
      } else {
        const d0 = C * 0.47, d1 = C - 0.06;
        [cxw, cyw] = at(r, 0, (d0 + d1) / 2);
        wW = 1 - 0.1; hW = d1 - d0;
        if (r.axis === 'y') { u = ex; v = ey; } else { u = [-ey[0], -ey[1]]; v = ex; }
      }
      const [ox, oy] = this.P(cxw, cyw, z);
      const k = this.dpr / 100;
      const W = wW * 100, H = hW * 100;
      c.save();
      c.setTransform(k * u[0], k * u[1], k * v[0], k * v[1], this.dpr * ox, this.dpr * oy);
      c.fillStyle = 'rgba(60,40,20,0.2)';
      c.beginPath(); c.roundRect(-W / 2, -H / 2 + 3, W, H, 8); c.fill();
      c.fillStyle = '#fffdf6';
      c.beginPath(); c.roundRect(-W / 2, -H / 2, W, H, 8); c.fill();
      c.save();
      c.clip();
      const hh = Math.min(22, H * 0.28);
      c.fillStyle = color;
      c.fillRect(-W / 2, -H / 2, W, hh);
      c.restore();
      c.strokeStyle = 'rgba(60,40,20,0.25)';
      c.lineWidth = 1.2;
      c.beginPath(); c.roundRect(-W / 2, -H / 2, W, H, 8); c.stroke();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const fit = (text, font, max, size) => {
        c.font = `${font} ${size}px ${font.includes('700') ? this.fonts.body : this.fonts.display}`;
        const w = c.measureText(text).width;
        if (w > max) { size = Math.max(7, size * max / w); c.font = `${font} ${size}px ${font.includes('700') ? this.fonts.body : this.fonts.display}`; }
        return size;
      };
      // Header: country or tile type.
      fit(lab.title.toLocaleUpperCase(document.documentElement.lang || undefined), '700', W - 8, 14);
      c.fillStyle = '#ffffff';
      c.fillText(lab.title.toLocaleUpperCase(document.documentElement.lang || undefined), 0, -H / 2 + hh / 2 + 0.5);
      const bodyTop = -H / 2 + hh, bodyH = H - hh;
      const value = (t.type === 'city' || t.type === 'resort') && owner ? '$' + this.game.rent(t).toLocaleString('en-US') : lab.note;
      // Name.
      fit(lab.name, '700', W - 6, 24);
      c.fillStyle = '#232845';
      c.fillText(lab.name, 0, value ? bodyTop + bodyH * 0.3 : bodyTop + bodyH * 0.5);
      if (value) {
        const isRent = !!owner;
        const size = fit(value, '400', W - 14, isRent ? 25 : 16);
        const pw = c.measureText(value).width + 14, ph = size + 6;
        const py = bodyTop + bodyH * 0.72;
        if (isRent) {
          c.fillStyle = owner.color;
          c.beginPath(); c.roundRect(-pw / 2, py - ph / 2, pw, ph, ph / 2); c.fill();
          c.fillStyle = '#ffffff';
        } else {
          c.fillStyle = '#5a6285';
        }
        c.fillText(value, 0, py + 1);
      }
      c.restore();
    }

    drawTargetGlow(tg, x0, y0, x1, y1, z) {
      const c = this.ctx;
      const P = this.P.bind(this);
      const pulse = 0.5 + Math.sin(this.now / 200) * 0.5;
      const ring = (e) => [P(x0 - e, y0 - e, z), P(x1 + e, y0 - e, z), P(x1 + e, y1 + e, z), P(x0 - e, y1 + e, z)];
      c.save();
      // Soft coloured fill and a glowing rim.
      this.poly(ring(0), `${tg.color}33`);
      c.shadowColor = tg.color;
      c.shadowBlur = this.TW * (0.2 + pulse * 0.15);
      this.poly(ring(0.02), null, tg.color, Math.max(2.5, this.TW * 0.035));
      c.shadowBlur = 0;
      this.poly(ring(0.02), null, 'rgba(255,255,255,0.85)', Math.max(1, this.TW * 0.01));
      // A ring that keeps expanding outwards and fading.
      const k = ((this.now - tg.t0) / 900) % 1;
      c.globalAlpha = 1 - k;
      this.poly(ring(0.04 + k * 0.22), null, tg.color, Math.max(1.5, this.TW * 0.02));
      c.restore();
    }

    drawProp(t, r, z) {
      const g = this.game;
      const owner = t.owner >= 0 ? g.players[t.owner] : null;
      const now = this.now;
      const c = this.ctx;
      const [bx, by] = this.anchor(t.id);
      const pt = (along, depth) => at(r, along, depth);
      switch (t.type) {
        case 'city': {
          if (!owner) return;
          const col = owner.color;
          const t0 = this.grow[t.id];
          const k = t0 ? Math.min(1, (now - t0) / 850) : 1;
          const s = t0 && k < 1 ? Math.max(0.05, easeBack(k)) : 1;
          this.drawBuilding(t.level, bx, by, z, col, s, t.id);
          if (g.festival === t.id) this.drawStar(bx, by, z + [0.7, 0.75, 1.15, 1.35, 2.0][t.level] * s, 0.13);
          return;
        }
        case 'resort': {
          const [px, py] = pt(-0.25, 0.42);
          this.drawPalm(px, py, z, 0.8);
          const [ux, uy] = pt(0.2, 0.48);
          this.drawUmbrella(ux, uy, z);
          // Sun lounger.
          const [lx, ly] = pt(0.14, 0.66);
          this.box(lx - 0.13, ly - 0.06, lx + 0.13, ly + 0.06, z, z + 0.05, '#ffffff', '#e2e6ee', '#c9cfdb');
          this.box(lx - 0.13, ly - 0.06, lx - 0.04, ly + 0.06, z + 0.05, z + 0.13, '#5cc0e0', '#4aa8c8', '#3a8fae');
          if (owner) { const [fx, fy] = pt(0.36, 0.22); this.drawFlag(fx, fy, z, owner.color, 0.55); }
          if (g.festival === t.id) this.drawStar(bx, by, z + 1.0, 0.13);
          return;
        }
        case 'chance': {
          // Floating gift box with a ribbon, a big question mark and orbiting sparkles.
          const bob = Math.sin(now / 420 + t.id) * 0.07;
          const zz = z + 0.42 + bob, rr = 0.17, h = 0.3;
          this.ellipse(bx, by, z, 0.2 * (1 - bob), 'rgba(0,0,0,0.14)');
          this.box(bx - rr, by - rr, bx + rr, by + rr, zz, zz + h, '#ffd75e', '#f0b532', '#d39420', 'rgba(120,70,0,0.3)');
          this.box(bx - 0.04, by - rr - 0.005, bx + 0.04, by + rr + 0.005, zz, zz + h + 0.005, '#e8553d', '#d4432c', '#b53620');
          this.box(bx - rr - 0.005, by - 0.04, bx + rr + 0.005, by + 0.04, zz, zz + h + 0.005, '#e8553d', '#d4432c', '#b53620');
          const [sx, sy] = this.P(bx, by, zz + h + 0.25);
          c.lineWidth = Math.max(2, this.TW * 0.03);
          c.strokeStyle = '#ffffff';
          c.font = `${Math.round(this.TW * 0.3)}px ${this.fonts.display}`;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.strokeText('?', sx, sy);
          c.fillStyle = '#e0a21b';
          c.fillText('?', sx, sy);
          for (let i = 0; i < 4; i++) {
            const a = now / 900 + (i * Math.PI) / 2;
            this.sparkle(bx + Math.cos(a) * 0.32, by + Math.sin(a) * 0.32, zz + 0.15 + Math.sin(a * 2) * 0.1, 0.05);
          }
          return;
        }
        case 'tax': {
          // Customs checkpoint: booth with a striped roof, a barrier arm and a pile of coins.
          const [kx, ky] = pt(-0.22, 0.3);
          this.groundShadow(kx - 0.14, ky - 0.14, kx + 0.14, ky + 0.14, z, 0.5);
          this.box(kx - 0.14, ky - 0.14, kx + 0.14, ky + 0.14, z, z + 0.42, '#f4f6fb', '#e3e7f0', '#c7cede', 'rgba(0,0,0,0.15)');
          this.box(kx - 0.141, ky - 0.141, kx + 0.141, ky + 0.141, z + 0.2, z + 0.32, '#8fd0ff', '#7dbff0', '#5fa3d8');
          this.box(kx - 0.19, ky - 0.19, kx + 0.19, ky + 0.19, z + 0.42, z + 0.5, '#c0392b', '#e04b3b', '#a5301f');
          const [px, py] = pt(0.1, 0.36);
          const [ex, ey] = pt(0.46, 0.36);
          const base = this.P(px, py, z), top = this.P(px, py, z + 0.3);
          c.strokeStyle = '#4b5470';
          c.lineWidth = Math.max(2, this.TW * 0.03);
          c.beginPath(); c.moveTo(base[0], base[1]); c.lineTo(top[0], top[1]); c.stroke();
          const lift = Math.max(0, Math.sin(now / 1600)) * 0.25;
          for (let i = 0; i < 6; i++) {
            const k0 = i / 6, k1 = (i + 1) / 6;
            const a = this.P(px + (ex - px) * k0, py + (ey - py) * k0, z + 0.28 + lift * k0);
            const b = this.P(px + (ex - px) * k1, py + (ey - py) * k1, z + 0.28 + lift * k1);
            c.strokeStyle = i % 2 ? '#ffffff' : '#e8553d';
            c.lineWidth = Math.max(2.5, this.TW * 0.035);
            c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
          }
          const [cx2, cy2] = pt(0.3, 0.68);
          for (let i = 0; i < 3; i++) {
            this.ellipse(cx2, cy2, z + i * 0.06, 0.13, '#c99419');
            this.ellipse(cx2, cy2, z + i * 0.06 + 0.035, 0.13, '#ffd34d');
          }
          return;
        }
        case 'start': {
          // A start arch with a banner.
          const zA = z, h = 0.95;
          const pL = [r.cx - 0.55, r.cy - 0.45], pR = [r.cx + 0.45, r.cy - 0.45];
          [pL, pR].forEach(([x, y]) => this.box(x - 0.05, y - 0.05, x + 0.05, y + 0.05, zA, zA + h, '#f4f6fb', '#dde2ec', '#c3cad9'));
          this.box(pL[0] - 0.05, pL[1] - 0.04, pR[0] + 0.05, pR[1] + 0.04, zA + h - 0.26, zA + h, '#e8553d', '#e8553d', '#c43d27', 'rgba(0,0,0,0.2)');
          const [sx, sy] = this.P((pL[0] + pR[0]) / 2, pL[1] + 0.04, zA + h - 0.13);
          c.save();
          c.font = `${Math.round(this.TW * 0.14)}px ${this.fonts.display}`;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillStyle = '#ffffff';
          const label = this.labels ? this.labels(t).title : t.name;
          // Sheared to sit on the banner's front face.
          c.translate(sx, sy);
          c.transform(1, -0.5, 0, 1, 0, 0);
          c.fillText(label.toLocaleUpperCase(document.documentElement.lang || undefined), 0, 0);
          c.restore();
          return;
        }
        case 'island': {
          this.drawPalm(r.cx - 0.25, r.cy - 0.2, z + 0.03, 1.0);
          this.drawPalm(r.cx + 0.05, r.cy - 0.45, z + 0.03, 0.7);
          // A little rowing boat bobbing in the water.
          const bob = Math.sin(now / 700) * 0.03;
          const [bx2, by2] = [r.cx + 0.45, r.cy + 0.1];
          this.box(bx2 - 0.18, by2 - 0.07, bx2 + 0.18, by2 + 0.07, z + bob, z + 0.08 + bob, '#a0643a', '#8a5330', '#6e4024');
          return;
        }
        case 'festival': {
          // A stage with a curtain, spotlights, bunting and fireworks.
          const [x0, y0] = [r.cx - 0.6, r.cy - 0.6];
          this.box(x0, y0, x0 + 1.05, y0 + 0.62, z, z + 0.12, '#b98a5e', '#a87a50', '#8d6440');
          this.box(x0, y0, x0 + 1.05, y0 + 0.06, z + 0.12, z + 0.95, '#c62f4a', '#a52740', '#8a1f35', 'rgba(0,0,0,0.2)');
          const P = this.P.bind(this);
          for (let i = 0; i < 5; i++) {
            const a = P(x0 + i * 0.21 + 0.02, y0 + 0.065, z + 0.95), b = P(x0 + i * 0.21 + 0.19, y0 + 0.065, z + 0.95);
            c.fillStyle = '#e5486a';
            c.beginPath(); c.moveTo(a[0], a[1]); c.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + this.TW * 0.08, b[0], b[1]); c.fill();
          }
          // Spotlight beams.
          [[x0 + 0.15, '#fff3a8'], [x0 + 0.9, '#a8e6ff']].forEach(([x, col], i) => {
            const top = P(x, y0 + 0.62, z + 1.3), l = P(x - 0.2 + i * 0.1, y0 + 0.35, z + 0.12), rr2 = P(x + 0.05 + i * 0.1, y0 + 0.45, z + 0.12);
            c.fillStyle = col;
            c.globalAlpha = 0.22 + Math.sin(now / 500 + i) * 0.08;
            c.beginPath(); c.moveTo(top[0], top[1]); c.lineTo(l[0], l[1]); c.lineTo(rr2[0], rr2[1]); c.closePath(); c.fill();
            c.globalAlpha = 1;
          });
          // Bunting from the stage to a pole at the front.
          const pole = [r.cx + 0.55, r.cy + 0.45];
          const pb = P(pole[0], pole[1], z), ptp = P(pole[0], pole[1], z + 1.0);
          c.strokeStyle = '#6b5a4a';
          c.lineWidth = Math.max(1.5, this.TW * 0.02);
          c.beginPath(); c.moveTo(pb[0], pb[1]); c.lineTo(ptp[0], ptp[1]); c.stroke();
          const st = P(x0 + 1.05, y0 + 0.06, z + 0.95);
          const cols = ['#ffd23f', '#4fb6d3', '#2eae6b', '#e8553d', '#b38cff'];
          for (let i = 0; i < 7; i++) {
            const k0 = i / 7, k1 = (i + 0.7) / 7;
            const sag = (k) => Math.sin(Math.PI * k) * this.TW * 0.12;
            const a = [st[0] + (ptp[0] - st[0]) * k0, st[1] + (ptp[1] - st[1]) * k0 + sag(k0)];
            const b = [st[0] + (ptp[0] - st[0]) * k1, st[1] + (ptp[1] - st[1]) * k1 + sag(k1)];
            c.fillStyle = cols[i % cols.length];
            c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + this.TW * 0.07); c.closePath(); c.fill();
          }
          this.drawStar(x0 + 0.52, y0 + 0.03, z + 1.25 + Math.sin(now / 300) * 0.04, 0.17);
          this.fireworks(r.cx, r.cy, z, now);
          return;
        }
        case 'worldTour': {
          const bob = Math.sin(now / 900) * 0.05;
          const [mx, my] = this.drawMast(r.cx + 0.35, r.cy - 0.35, z, 0.95);
          const L = this.TW * 0.62;
          const bx3 = mx - L * 0.53, by3 = my + this.TW * 0.04 + bob * this.ZS;
          const [gx, gy] = this.P(r.cx - 0.2, r.cy + 0.05, z);
          c.fillStyle = 'rgba(30,30,60,0.16)';
          c.beginPath(); c.ellipse(gx, gy, L * 0.42, L * 0.12, 0, 0, Math.PI * 2); c.fill();
          this.drawBlimp(bx3, by3);
          return;
        }
      }
    }

    sparkle(x, y, z, r) {
      const [sx, sy] = this.P(x, y, z);
      const c = this.ctx, R = r * this.TW;
      c.fillStyle = '#fff7c2';
      c.beginPath();
      c.moveTo(sx, sy - R); c.lineTo(sx + R * 0.25, sy - R * 0.25); c.lineTo(sx + R, sy); c.lineTo(sx + R * 0.25, sy + R * 0.25);
      c.lineTo(sx, sy + R); c.lineTo(sx - R * 0.25, sy + R * 0.25); c.lineTo(sx - R, sy); c.lineTo(sx - R * 0.25, sy - R * 0.25);
      c.closePath();
      c.fill();
    }

    // Bursts of fireworks above the Gala stage, one every couple of seconds.
    fireworks(x, y, z, now) {
      const c = this.ctx;
      const cols = ['#ffd23f', '#ff6b8a', '#6fe0ff', '#9dff8a'];
      for (let b = 0; b < 2; b++) {
        const cycle = 2600, t = (now + b * 1300) % cycle;
        if (t > 1100) continue;
        const k = t / 1100;
        const n = Math.floor((now + b * 1300) / cycle);
        const ox = x - 0.4 + ((n * 37 + b * 11) % 9) / 10, oy = y - 0.5 + ((n * 23) % 5) / 10;
        const [sx, sy] = this.P(ox, oy, z + 1.9 + b * 0.3);
        c.fillStyle = cols[(n + b) % cols.length];
        c.globalAlpha = 1 - k;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const d = ease(k) * this.TW * 0.35;
          c.beginPath(); c.arc(sx + Math.cos(a) * d, sy + Math.sin(a) * d * 0.85 + k * k * this.TW * 0.1, Math.max(1.2, this.TW * 0.018), 0, Math.PI * 2); c.fill();
        }
        c.globalAlpha = 1;
      }
    }

    // ---------- buildings ----------
    // Soft contact shadow, cast towards +x (light comes from the upper left of the screen).
    groundShadow(x0, y0, x1, y1, z, h) {
      const P = this.P.bind(this);
      const d = Math.min(0.35, h * 0.35);
      this.poly([P(x0, y1, z), P(x1, y1, z), P(x1 + d, y1, z), P(x1 + d, y0 + d * 0.3, z), P(x1, y0, z)], 'rgba(30,25,60,0.22)');
    }

    // Window grid on the two visible faces; some windows glow, chosen from a stable seed.
    litWindows(x0, y0, x1, y1, z0, z1, rows, cols, seed, glass) {
      const P = this.P.bind(this);
      const hz = (z1 - z0) / rows;
      const lit = (n) => ((Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1 > 0.62;
      for (let r = 0; r < rows; r++) {
        const za = z0 + hz * (r + 0.28), zb = z0 + hz * (r + 0.78);
        for (let k = 0; k < cols; k++) {
          const ta = (k + 0.22) / cols, tb = (k + 0.78) / cols;
          const ya = y0 + (y1 - y0) * ta, yb = y0 + (y1 - y0) * tb;
          this.poly([P(x1, ya, za), P(x1, yb, za), P(x1, yb, zb), P(x1, ya, zb)], lit(r * 7 + k) ? '#ffd56b' : glass);
          const xa = x0 + (x1 - x0) * ta, xb = x0 + (x1 - x0) * tb;
          this.poly([P(xa, y1, za), P(xb, y1, za), P(xb, y1, zb), P(xa, y1, zb)], lit(r * 7 + k + 50) ? '#ffe28a' : glass);
        }
      }
    }

    // Gable roof with its ridge along x; overhangs the walls slightly.
    gableRoof(x0, y0, x1, y1, z, h, color, wall) {
      const P = this.P.bind(this);
      const o = 0.04, yc = (y0 + y1) / 2, zr = z + h;
      this.poly([P(x0 - o, y0 - o, z), P(x1 + o, y0 - o, z), P(x1 + o, yc, zr), P(x0 - o, yc, zr)], shade(color, -0.4));
      this.poly([P(x1, y0, z), P(x1, y1, z), P(x1, yc, zr)], shade(wall, -0.2));
      this.poly([P(x0 - o, yc, zr), P(x1 + o, yc, zr), P(x1 + o, y1 + o, z - 0.02), P(x0 - o, y1 + o, z - 0.02)], shade(color, 0.08), 'rgba(0,0,0,0.18)', 0.8);
      // Roof tile lines.
      for (let i = 1; i < 4; i++) {
        const t = i / 4;
        const a = P(x0 - o, yc + (y1 + o - yc) * t, zr - (zr - z + 0.02) * t), b = P(x1 + o, yc + (y1 + o - yc) * t, zr - (zr - z + 0.02) * t);
        this.ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath(); this.ctx.moveTo(a[0], a[1]); this.ctx.lineTo(b[0], b[1]); this.ctx.stroke();
      }
    }

    bush(x, y, z, r) {
      const [sx, sy] = this.P(x, y, z);
      const c = this.ctx, R = r * this.TW;
      c.fillStyle = '#3f9a4f';
      c.beginPath(); c.arc(sx, sy - R * 0.6, R, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#5cbf62';
      c.beginPath(); c.arc(sx - R * 0.3, sy - R * 0.9, R * 0.6, 0, Math.PI * 2); c.fill();
    }

    drawBuilding(level, bx, by, z, col, s, seed) {
      const P = this.P.bind(this);
      const wall = mix('#fff6e8', col, 0.12);
      const glass = 'rgba(52,78,140,0.75)';
      if (level === 0) return this.drawFlag(bx, by, z, col, 0.6 * s);

      if (level === 1) {
        // Villa: cream walls, door, windows, gable roof, chimney and a bush.
        const x0 = bx - 0.22, x1 = bx + 0.2, y0 = by - 0.17, y1 = by + 0.17, h = 0.27 * s;
        this.groundShadow(x0, y0, x1, y1, z, h + 0.2);
        this.box(x0, y0, x1, y1, z, z + h, wall, shade(wall, -0.04), shade(wall, -0.16), 'rgba(0,0,0,0.12)');
        const dy = (y0 + y1) / 2;
        this.poly([P(bx - 0.05, y1, z), P(bx + 0.04, y1, z), P(bx + 0.04, y1, z + h * 0.62), P(bx - 0.05, y1, z + h * 0.62)], shade(col, -0.35));
        this.poly([P(x0 + 0.04, y1, z + h * 0.35), P(x0 + 0.12, y1, z + h * 0.35), P(x0 + 0.12, y1, z + h * 0.75), P(x0 + 0.04, y1, z + h * 0.75)], '#9fd2ff');
        this.poly([P(x1, dy - 0.08, z + h * 0.35), P(x1, dy + 0.06, z + h * 0.35), P(x1, dy + 0.06, z + h * 0.75), P(x1, dy - 0.08, z + h * 0.75)], '#7fb8e8');
        this.box(x0 + 0.06, y0 + 0.04, x0 + 0.12, y0 + 0.1, z + h, z + h + 0.24 * s, '#b5654a', '#a3573e', '#8a4632');
        this.gableRoof(x0, y0, x1, y1, z + h, 0.22 * s, col, wall);
        this.bush(x1 + 0.08, y1 + 0.04, z, 0.06);
        return;
      }

      if (level === 2) {
        // Tower: dark lobby, balconies, lit windows, roof parapet and water tank.
        const r = 0.18, h = 0.85 * s;
        const x0 = bx - r, x1 = bx + r, y0 = by - r, y1 = by + r;
        const body = mix('#f2f4fa', col, 0.35);
        this.groundShadow(x0, y0, x1, y1, z, h);
        this.box(x0, y0, x1, y1, z, z + 0.12 * s, shade(col, -0.2), shade(col, -0.35), shade(col, -0.5));
        this.box(x0, y0, x1, y1, z + 0.12 * s, z + h, body, shade(body, -0.06), shade(body, -0.2), 'rgba(0,0,0,0.12)');
        this.litWindows(x0, y0, x1, y1, z + 0.14 * s, z + h - 0.03, 5, 2, seed, glass);
        for (let f = 1; f < 5; f++) {
          const zz = z + 0.12 * s + (h - 0.12 * s) * f / 5;
          this.poly([P(x0, y1, zz), P(x1, y1, zz), P(x1, y1 + 0.03, zz), P(x0, y1 + 0.03, zz)], 'rgba(255,255,255,0.85)');
          this.poly([P(x1, y0, zz), P(x1, y1, zz), P(x1 + 0.03, y1, zz), P(x1 + 0.03, y0, zz)], 'rgba(255,255,255,0.6)');
        }
        this.box(x0 - 0.015, y0 - 0.015, x1 + 0.015, y1 + 0.015, z + h, z + h + 0.04, shade(col, 0.1), shade(col, -0.1), shade(col, -0.3));
        const [tx, ty] = this.P(bx - 0.05, by - 0.05, z + h + 0.04);
        const c = this.ctx, tr = this.TW * 0.05;
        c.fillStyle = '#c9ced8';
        c.fillRect(tx - tr, ty - tr * 1.6, tr * 2, tr * 1.6);
        c.fillStyle = '#e3e7ef';
        c.beginPath(); c.ellipse(tx, ty - tr * 1.6, tr, tr * 0.45, 0, 0, Math.PI * 2); c.fill();
        return;
      }

      if (level === 3) {
        // Hotel: glass podium, tall slab with a window grid, rooftop sign and flag.
        const px0 = bx - 0.3, px1 = bx + 0.28, py0 = by - 0.25, py1 = by + 0.25, ph = 0.2 * s;
        const tx0 = bx - 0.2, tx1 = bx + 0.18, ty0 = by - 0.15, ty1 = by + 0.12, th = 1.15 * s;
        this.groundShadow(px0, py0, px1, py1, z, th);
        this.box(px0, py0, px1, py1, z, z + ph, wall, shade(wall, -0.06), shade(wall, -0.2), 'rgba(0,0,0,0.12)');
        this.poly([P(px0 + 0.03, py1, z + 0.02), P(px1 - 0.03, py1, z + 0.02), P(px1 - 0.03, py1, z + ph * 0.75), P(px0 + 0.03, py1, z + ph * 0.75)], 'rgba(120,190,255,0.8)');
        this.poly([P(px0 - 0.02, py1 + 0.06, z + ph * 0.85), P(px1 + 0.02, py1 + 0.06, z + ph * 0.85), P(px1, py1, z + ph), P(px0, py1, z + ph)], col);
        const body = shade(col, 0.12);
        this.box(tx0, ty0, tx1, ty1, z + ph, z + th, body, shade(col, -0.02), shade(col, -0.3), 'rgba(0,0,0,0.15)');
        this.litWindows(tx0, ty0, tx1, ty1, z + ph + 0.03, z + th - 0.04, 8, 3, seed, 'rgba(30,45,90,0.7)');
        this.box(tx0 + 0.04, ty1 - 0.03, tx1 - 0.04, ty1, z + th, z + th + 0.12 * s, '#ffffff', '#f4f4f4', '#dcdcdc');
        const [sx, sy] = this.P((tx0 + tx1) / 2, ty1, z + th + 0.06 * s);
        this.text('H', sx, sy, this.TW * 0.08, col, this.fonts.display);
        this.drawFlag(tx1 - 0.04, ty0 + 0.04, z + th, col, 0.32 * s);
        return;
      }

      // Landmark: plaza, columned podium, tapering gold-trimmed tower, crown and spire, light beam.
      const pulse = 0.75 + Math.sin(this.now / 500) * 0.25;
      const [gx, gy] = this.P(bx, by, z + 1.4 * s);
      const glow = this.ctx.createRadialGradient(gx, gy, 2, gx, gy, this.TW * 0.7);
      glow.addColorStop(0, `rgba(255,214,110,${0.5 * pulse})`);
      glow.addColorStop(1, 'rgba(255,214,110,0)');
      this.ctx.fillStyle = glow;
      this.ctx.fillRect(gx - this.TW * 0.7, gy - this.TW * 0.7, this.TW * 1.4, this.TW * 1.4);
      this.groundShadow(bx - 0.32, by - 0.32, bx + 0.32, by + 0.32, z, 1.6);
      this.box(bx - 0.34, by - 0.34, bx + 0.34, by + 0.34, z, z + 0.06 * s, '#efe6d2', '#d9cdb4', '#c2b497');
      const pz = z + 0.06 * s, ph = 0.24 * s;
      this.box(bx - 0.25, by - 0.25, bx + 0.25, by + 0.25, pz, pz + ph, '#fbf4e4', '#ece0c6', '#d5c6a6', 'rgba(0,0,0,0.12)');
      for (let i = 0; i < 4; i++) {
        const u = -0.19 + i * 0.125;
        this.poly([P(bx + u, by + 0.25, pz), P(bx + u + 0.04, by + 0.25, pz), P(bx + u + 0.04, by + 0.25, pz + ph), P(bx + u, by + 0.25, pz + ph)], '#ffffff');
        this.poly([P(bx + 0.25, by + u, pz), P(bx + 0.25, by + u + 0.04, pz), P(bx + 0.25, by + u + 0.04, pz + ph), P(bx + 0.25, by + u, pz + ph)], '#efe9dc');
      }
      const z1 = pz + ph, z2 = z1 + 0.95 * s;
      this.box(bx - 0.17, by - 0.17, bx + 0.17, by + 0.17, z1, z2, shade(col, 0.15), shade(col, -0.05), shade(col, -0.32), 'rgba(0,0,0,0.15)');
      this.litWindows(bx - 0.17, by - 0.17, bx + 0.17, by + 0.17, z1 + 0.05, z2 - 0.05, 6, 2, seed, 'rgba(255,245,215,0.55)');
      [z1 + 0.32 * s, z1 + 0.64 * s].forEach((zz) => this.box(bx - 0.19, by - 0.19, bx + 0.19, by + 0.19, zz, zz + 0.04, '#ffd75e', '#f0b532', '#d39420'));
      this.box(bx - 0.12, by - 0.12, bx + 0.12, by + 0.12, z2, z2 + 0.14 * s, '#ffd75e', '#f0b532', '#d39420', 'rgba(120,70,0,0.25)');
      this.roof(bx - 0.12, by - 0.12, bx + 0.12, by + 0.12, z2 + 0.14 * s, 0.6 * s, '#ffcf4a');
      this.drawStar(bx, by, z2 + 0.8 * s, 0.07 + 0.015 * pulse);
    }

    drawFlag(x, y, z, col, h) {
      const c = this.ctx;
      const [ax, ay] = this.P(x, y, z);
      const [bx, by] = this.P(x, y, z + h);
      c.strokeStyle = '#5a4a3a';
      c.lineWidth = Math.max(1, this.TW * 0.015);
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
      const w = this.TW * 0.18, fh = this.TW * 0.11;
      const wave = Math.sin(this.now / 250 + x) * fh * 0.15;
      c.beginPath();
      c.moveTo(bx, by);
      c.quadraticCurveTo(bx + w / 2, by + wave, bx + w, by + fh * 0.2);
      c.lineTo(bx + w, by + fh);
      c.quadraticCurveTo(bx + w / 2, by + fh + wave, bx, by + fh * 0.9);
      c.closePath();
      c.fillStyle = col;
      c.fill();
    }

    drawStar(x, y, z, r) {
      const [sx, sy] = this.P(x, y, z);
      const c = this.ctx;
      const R = r * this.TW, rot = this.now / 900;
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = rot + (i * Math.PI) / 5;
        const rr = i % 2 ? R * 0.45 : R;
        c.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr * 0.9);
      }
      c.closePath();
      c.fillStyle = '#ffd23f';
      c.strokeStyle = '#c98b00';
      c.lineWidth = 1;
      c.fill();
      c.stroke();
    }

    drawPalm(x, y, z, h) {
      const c = this.ctx;
      const [ax, ay] = this.P(x, y, z);
      const top = [ax + this.TW * 0.06, ay - h * this.ZS];
      c.strokeStyle = '#8a5a34';
      c.lineWidth = Math.max(1.5, this.TW * 0.035);
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(ax, ay);
      c.quadraticCurveTo(ax - this.TW * 0.04, ay - h * this.ZS * 0.5, top[0], top[1]);
      c.stroke();
      c.fillStyle = '#3fae5a';
      const sway = Math.sin(this.now / 600 + x) * 0.15;
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.75 + sway;
        c.beginPath();
        c.ellipse(top[0] + Math.cos(a) * this.TW * 0.09, top[1] + Math.sin(a) * this.TW * 0.05 + this.TW * 0.02, this.TW * 0.11, this.TW * 0.035, a, 0, Math.PI * 2);
        c.fill();
      }
    }

    drawUmbrella(x, y, z) {
      const c = this.ctx;
      const [ax, ay] = this.P(x, y, z);
      const h = this.ZS * 0.4, r = this.TW * 0.13;
      c.strokeStyle = '#6b5a4a';
      c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax, ay - h); c.stroke();
      c.beginPath();
      c.moveTo(ax - r, ay - h + r * 0.25);
      c.quadraticCurveTo(ax, ay - h - r * 0.7, ax + r, ay - h + r * 0.25);
      c.closePath();
      c.fillStyle = '#ff6b5a';
      c.fill();
    }

    // Mooring mast: a red-and-white lattice tower with a blinking beacon.
    drawMast(x, y, z, h) {
      const c = this.ctx;
      const [bx, by] = this.P(x, y, z);
      const [tx, ty] = this.P(x, y, z + h);
      const w = this.TW * 0.07;
      c.fillStyle = 'rgba(30,30,60,0.2)';
      c.beginPath(); c.ellipse(bx, by, w * 1.8, w * 0.8, 0, 0, Math.PI * 2); c.fill();
      c.lineWidth = Math.max(1, this.TW * 0.012);
      const legs = [[-w, w * 0.25], [w, w * 0.25]];
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        const k0 = i / steps, k1 = (i + 1) / steps;
        const y0 = by + (ty - by) * k0, y1 = by + (ty - by) * k1;
        const s0 = 1 - k0 * 0.55, s1 = 1 - k1 * 0.55;
        c.strokeStyle = i % 2 ? '#ffffff' : '#e8553d';
        c.beginPath();
        c.moveTo(bx + legs[0][0] * s0, y0); c.lineTo(bx + legs[0][0] * s1, y1);
        c.moveTo(bx + legs[1][0] * s0, y0); c.lineTo(bx + legs[1][0] * s1, y1);
        c.moveTo(bx + legs[0][0] * s0, y0); c.lineTo(bx + legs[1][0] * s1, y1);
        c.moveTo(bx + legs[1][0] * s0, y0); c.lineTo(bx + legs[0][0] * s1, y1);
        c.stroke();
      }
      c.fillStyle = '#4a4f6a';
      c.beginPath(); c.ellipse(tx, ty, w * 0.75, w * 0.35, 0, 0, Math.PI * 2); c.fill();
      const on = Math.sin(this.now / 300) > 0;
      c.fillStyle = on ? '#ff4a3a' : '#7a2a24';
      c.beginPath(); c.arc(tx, ty - w * 0.45, w * 0.35, 0, Math.PI * 2); c.fill();
      if (on) {
        c.fillStyle = 'rgba(255,90,70,0.35)';
        c.beginPath(); c.arc(tx, ty - w * 0.45, w * 0.9, 0, Math.PI * 2); c.fill();
      }
      return [tx, ty];
    }

    // Airship moored to the mast: striped envelope, fins, gondola with windows and a spinning propeller.
    drawBlimp(sx, sy) {
      const c = this.ctx;
      const L = this.TW * 0.62, H = this.TW * 0.2;
      const now = this.now;
      c.save();
      c.translate(sx, sy);
      c.rotate(Math.sin(now / 1700) * 0.05);
      // Tail fins (tail on the left).
      const fin = (pts, col) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fillStyle = col; c.fill(); c.strokeStyle = 'rgba(30,40,90,0.35)'; c.lineWidth = 1; c.stroke(); };
      fin([[-L * 0.32, -H * 0.4], [-L * 0.58, -H * 1.25], [-L * 0.62, -H * 1.2], [-L * 0.52, -H * 0.2]], '#e8553d');
      fin([[-L * 0.32, H * 0.4], [-L * 0.58, H * 1.2], [-L * 0.62, H * 1.15], [-L * 0.52, H * 0.2]], '#c9432c');
      // Envelope.
      const g = c.createLinearGradient(0, -H, 0, H);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.45, '#e6eefb');
      g.addColorStop(1, '#93add8');
      c.fillStyle = g;
      c.beginPath(); c.ellipse(0, 0, L * 0.5, H, 0, 0, Math.PI * 2); c.fill();
      c.save();
      c.clip();
      // Red tail band and nose cap.
      c.fillStyle = '#e8553d';
      c.fillRect(-L * 0.36, -H, L * 0.07, H * 2);
      c.fillStyle = '#ffc53d';
      c.fillRect(-L * 0.27, -H, L * 0.03, H * 2);
      c.fillStyle = 'rgba(232,85,61,0.9)';
      c.beginPath(); c.ellipse(L * 0.5, 0, L * 0.07, H, 0, 0, Math.PI * 2); c.fill();
      // Panel seams.
      c.strokeStyle = 'rgba(40,60,120,0.18)';
      c.lineWidth = 1;
      for (let i = -2; i <= 2; i++) {
        c.beginPath(); c.ellipse(i * L * 0.11, 0, L * 0.025, H, 0, 0, Math.PI * 2); c.stroke();
      }
      c.beginPath(); c.moveTo(-L * 0.5, 0); c.lineTo(L * 0.5, 0); c.stroke();
      c.restore();
      c.strokeStyle = 'rgba(30,40,90,0.4)';
      c.lineWidth = 1.2;
      c.beginPath(); c.ellipse(0, 0, L * 0.5, H, 0, 0, Math.PI * 2); c.stroke();
      // Highlight.
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.beginPath(); c.ellipse(-L * 0.05, -H * 0.55, L * 0.28, H * 0.16, -0.05, 0, Math.PI * 2); c.fill();
      // Lettering.
      if (this.TW > 60) {
        c.font = `${Math.round(H * 0.62)}px ${this.fonts.display}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = '#2f4a8a';
        c.fillText('ATLAS', L * 0.07, H * 0.12);
      }
      // Gondola with windows, hung on struts.
      c.strokeStyle = 'rgba(40,40,70,0.6)';
      c.beginPath(); c.moveTo(-L * 0.08, H * 0.9); c.lineTo(-L * 0.06, H * 1.25); c.moveTo(L * 0.1, H * 0.9); c.lineTo(L * 0.08, H * 1.25); c.stroke();
      c.fillStyle = '#3c4a7a';
      c.beginPath(); c.roundRect(-L * 0.11, H * 1.15, L * 0.24, H * 0.5, H * 0.18); c.fill();
      c.fillStyle = '#ffd56b';
      for (let i = 0; i < 3; i++) {
        c.beginPath(); c.roundRect(-L * 0.08 + i * L * 0.065, H * 1.25, L * 0.04, H * 0.22, 2); c.fill();
      }
      // Propeller at the back of the gondola.
      const spin = Math.abs(Math.sin(now / 40));
      c.fillStyle = 'rgba(60,60,80,0.55)';
      c.beginPath(); c.ellipse(-L * 0.14, H * 1.4, H * 0.08, H * 0.35 * (0.3 + spin * 0.7), 0, 0, Math.PI * 2); c.fill();
      c.restore();
    }

    // Glossy board-game pawn: weighted base, waisted body, collar and a shiny head.
    drawPawn(p, tk, i) {
      const c = this.ctx;
      const [gx, gy] = this.P(tk.x, tk.y, TILE_Z);
      const [sx, sy] = this.P(tk.x, tk.y, TILE_Z + tk.z);
      const r = Math.max(5, this.TW * 0.085);
      const col = p.color;
      c.save();
      c.globalAlpha = tk.alpha;
      // Shadow shrinks as the pawn hops.
      const lift = Math.min(1, tk.z / 0.6);
      c.fillStyle = `rgba(20,20,50,${0.28 - lift * 0.12})`;
      c.beginPath(); c.ellipse(gx + r * 0.2, gy + r * 0.05, r * (1.25 - lift * 0.3), r * (0.55 - lift * 0.12), 0, 0, Math.PI * 2); c.fill();
      if (this.active === i) {
        const pr = r * (1.75 + Math.sin(this.now / 260) * 0.12);
        c.strokeStyle = col;
        c.lineWidth = 3;
        c.globalAlpha = tk.alpha * 0.9;
        c.beginPath(); c.ellipse(gx, gy, pr, pr * 0.5, 0, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,0.9)';
        c.lineWidth = 1.2;
        c.beginPath(); c.ellipse(gx, gy, pr + 2.5, pr * 0.5 + 1.5, 0, 0, Math.PI * 2); c.stroke();
        c.globalAlpha = tk.alpha;
      }
      const outline = shade(col, -0.55);
      // Base disc with thickness.
      const bh = r * 0.32;
      c.fillStyle = shade(col, -0.35);
      c.beginPath();
      c.ellipse(sx, sy, r * 1.05, r * 0.48, 0, 0, Math.PI);
      c.lineTo(sx - r * 1.05, sy - bh);
      c.ellipse(sx, sy - bh, r * 1.05, r * 0.48, 0, Math.PI, 0, true);
      c.closePath();
      c.fill();
      c.fillStyle = shade(col, 0.1);
      c.beginPath(); c.ellipse(sx, sy - bh, r * 1.05, r * 0.48, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = outline; c.lineWidth = 1; c.stroke();
      // Body.
      const top = sy - r * 2.15, by = sy - bh;
      const grad = c.createLinearGradient(sx - r, 0, sx + r, 0);
      grad.addColorStop(0, shade(col, 0.45));
      grad.addColorStop(0.45, col);
      grad.addColorStop(1, shade(col, -0.4));
      c.fillStyle = grad;
      c.beginPath();
      c.moveTo(sx - r * 0.82, by);
      c.bezierCurveTo(sx - r * 0.75, by - r * 0.7, sx - r * 0.22, top + r * 0.6, sx - r * 0.3, top);
      c.lineTo(sx + r * 0.3, top);
      c.bezierCurveTo(sx + r * 0.22, top + r * 0.6, sx + r * 0.75, by - r * 0.7, sx + r * 0.82, by);
      c.ellipse(sx, by, r * 0.82, r * 0.36, 0, 0, Math.PI);
      c.fill();
      c.strokeStyle = outline; c.lineWidth = 1; c.stroke();
      // Highlight streak on the body.
      c.strokeStyle = 'rgba(255,255,255,0.55)';
      c.lineWidth = Math.max(1, r * 0.14);
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(sx - r * 0.5, by - r * 0.25);
      c.quadraticCurveTo(sx - r * 0.42, by - r * 0.9, sx - r * 0.2, top + r * 0.25);
      c.stroke();
      // Collar.
      c.fillStyle = shade(col, 0.2);
      c.beginPath(); c.ellipse(sx, top, r * 0.55, r * 0.22, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = outline; c.lineWidth = 1; c.stroke();
      // Head.
      const hy = top - r * 0.55, hr = r * 0.62;
      const hg = c.createRadialGradient(sx - hr * 0.35, hy - hr * 0.4, hr * 0.1, sx, hy, hr);
      hg.addColorStop(0, shade(col, 0.75));
      hg.addColorStop(0.5, col);
      hg.addColorStop(1, shade(col, -0.35));
      c.fillStyle = hg;
      c.beginPath(); c.arc(sx, hy, hr, 0, Math.PI * 2); c.fill();
      c.strokeStyle = outline; c.lineWidth = 1; c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.beginPath(); c.ellipse(sx - hr * 0.35, hy - hr * 0.4, hr * 0.22, hr * 0.14, -0.6, 0, Math.PI * 2); c.fill();
      // Bobbing arrow above whoever's turn it is.
      if (this.active === i) {
        const ay = hy - hr - r * 0.7 - Math.abs(Math.sin(this.now / 300)) * r * 0.5;
        c.fillStyle = col;
        c.strokeStyle = '#ffffff';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(sx, ay);
        c.lineTo(sx - r * 0.55, ay - r * 0.6);
        c.lineTo(sx + r * 0.55, ay - r * 0.6);
        c.closePath();
        c.stroke();
        c.fill();
      }
      c.restore();
    }

    text(str, x, y, size, color, font, weight) {
      const c = this.ctx;
      c.font = `${weight || ''} ${Math.round(size)}px ${font || this.fonts.body}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = color;
      c.fillText(str, x, y);
    }

    drawPuffs(now) {
      const c = this.ctx;
      this.puffs = (this.puffs || []).filter((p) => now - p.t0 < 1100);
      for (const p of this.puffs) {
        const k = (now - p.t0) / 1100;
        for (let i = 0; i < 9; i++) {
          const a = i * 0.7 + p.x;
          const [sx, sy] = this.P(p.x + Math.cos(a) * k * 0.45, p.y + Math.sin(a) * k * 0.45, TILE_Z + 0.15 + k * 0.5 + (i % 3) * 0.1);
          c.fillStyle = `rgba(170,160,150,${0.6 * (1 - k)})`;
          c.beginPath(); c.arc(sx, sy, this.TW * (0.06 + k * 0.1), 0, Math.PI * 2); c.fill();
        }
      }
    }

    drawFloats(now) {
      this.drawPuffs(now);
      const c = this.ctx;
      this.floats = this.floats.filter((f) => now - f.t0 < 2000);
      for (const f of this.floats) {
        const k = (now - f.t0) / 2000;
        const [sx, sy] = this.P(f.x, f.y, TILE_Z + 0.9 + k * 0.9);
        c.globalAlpha = 1 - Math.pow(k, 2);
        c.font = `${Math.round(Math.max(13, this.TW * 0.16))}px ${this.fonts.display}`;
        c.textAlign = 'center';
        c.lineWidth = 4;
        c.strokeStyle = 'rgba(255,255,255,0.95)';
        c.strokeText(f.text, sx, sy);
        c.fillStyle = f.color;
        c.fillText(f.text, sx, sy);
        c.globalAlpha = 1;
      }
    }
  }

  window.ATRender = { IsoBoard };
})();
