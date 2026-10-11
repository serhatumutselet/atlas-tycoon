// Atlas Tycoon - isometric canvas renderer. Draws a floating-island board from a Game
// (or a snapshot-loaded Game) and animates pawns, dice and buildings.
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

  // Tile index -> grid cell. Departure sits at the front corner of the diamond.
  function cellOf(i) {
    if (i <= 8) return [8, 8 - i];
    if (i <= 16) return [8 - (i - 8), 0];
    if (i <= 24) return [0, i - 16];
    return [i - 24, 8];
  }
  // cellOf returns [row, col]; world x = col, y = row.
  const CELLS = D.TILES.map((t) => { const [r, c] = cellOf(t.id); return { x: c, y: r }; });
  const CELL_TO_TILE = {};
  CELLS.forEach((c, i) => (CELL_TO_TILE[c.x + ',' + c.y] = i));
  // Which edge of each side faces the board centre (for the colour band).
  const INNER = ['y0', 'x1', 'y1', 'x0'];
  const SLOTS = [[0.2, 0.22], [-0.05, 0.3], [0.3, -0.04], [0.06, 0.06]];
  const CORNER_TOP = { start: '#ffe39a', island: '#f7dea8', festival: '#ffd0e2', worldTour: '#d4e6ff' };

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
      this.dice = { v: [5, 2], t0: -1e9, dur: 700, shown: [5, 2] };
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
      const c = CELLS[tileId];
      const s = SLOTS[pid % 4];
      return [c.x + 0.5 + s[0] - 0.12, c.y + 0.5 + s[1] - 0.12];
    }

    async animateMove(pid, path, jump) {
      const tk = this.tokens[pid];
      if (!tk) return;
      if (jump || this.reduced) {
        const [x, y] = this.slotPos(path[path.length - 1], pid);
        await this.tween(320, (k) => { tk.z = 2.4 * (1 - ease(k)); tk.x = x; tk.y = y; });
        tk.z = 0;
        return;
      }
      for (const pos of path) {
        const [x, y] = this.slotPos(pos, pid);
        const sx = tk.x, sy = tk.y;
        await this.tween(140, (k) => {
          tk.x = sx + (x - sx) * k;
          tk.y = sy + (y - sy) * k;
          tk.z = Math.sin(Math.PI * k) * 0.45;
        });
        tk.z = 0;
      }
    }

    hideToken(pid) { if (this.tokens[pid]) this.tokens[pid].alpha = 0; }

    rollDice(values) {
      this.dice.v = values;
      if (this.skipping) return Promise.resolve();
      this.dice.t0 = performance.now();
      return new Promise((r) => setTimeout(r, this.dice.dur));
    }

    setDice(values) { this.dice.v = values; this.dice.shown = values; }

    markGrow(tileId) { this.grow[tileId] = performance.now(); }

    setPickable(ids) { this.pick = ids ? new Set(ids) : null; }

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
      const c = CELLS[id];
      return this.P(c.x + 0.5, c.y + 0.5, TILE_Z);
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
      const padTop = Number(this.canvas.dataset.padTop || 0);
      const padBottom = Number(this.canvas.dataset.padBottom || 0);
      const avail = this.H - padTop - padBottom;
      // Board extents in tile widths: 9.8 across, about 6.9 tall including sky-high landmarks and rock.
      // Board extents in tile widths: 9.8 across, about 6.9 tall including sky-high landmarks and rock.
      // The diamond is 9.9 tiles across and 4.95 tile widths tall; leave a little headroom for
      // landmarks and let the hanging rock run off the bottom of the screen.
      const tw = Math.max(20, Math.min((this.W * 0.98) / 9.9, avail / 5.5));
      const total = 5.5 * tw;
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

    get portrait() { return this.W / this.H < 0.8; }

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
      const near = this.camGoal === 'overview' && !this.fullView && this.portrait && this.autoCam && this.tokens[this.active];
      const tk = near ? this.tokens[this.active] : this.tokens[this.followId];
      if ((this.camGoal === 'follow' || near) && tk) {
        tz = near ? 1.65 : this.W < 640 ? 2.2 : 1.5;
        const cx = this.W / 2, cy = this.H / 2;
        const bx = b.ox + (tk.x - tk.y) * b.tw / 2;
        const by = b.oy + (tk.x + tk.y) * b.tw / 4 - (TILE_Z + 0.4) * b.tw * 0.55;
        tx = cx - cx - (bx - cx) * tz;
        // Keep the pawn in the upper part of the screen so the decision card below it doesn't cover it.
        ty = this.H * (near ? 0.45 : this.W < 640 ? 0.25 : 0.3) - cy - (by - cy) * tz;
      }
      const k = this.reduced ? 1 : 1 - Math.exp(-Math.min(dt, 100) / 260);
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
      const x = Math.floor((u + v) / 2), y = Math.floor((v - u) / 2);
      const id = CELL_TO_TILE[x + ',' + y];
      return id == null ? -1 : id;
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
      this.drawIsland(now);
      const objects = [];
      for (const t of this.game.tiles) this.drawTile(t, objects);
      this.game.players.forEach((p, i) => {
        const tk = this.tokens[i];
        if (tk && tk.alpha > 0) objects.push({ d: tk.x + tk.y + 0.05, f: () => this.drawPawn(p, tk, i) });
      });
      objects.push({ d: 9.2, f: () => this.drawDice(now) });
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

    drawIsland(now) {
      const P = this.P.bind(this);
      const a = -0.45, b = 9.45, zt = -0.02, zb = -0.6;
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
      // Soil and grass slab.
      this.box(a, a, b, b, zb, zt, '#94d27a', '#b07c52', '#8e603e');
      this.poly([P(a, b, zt), P(b, b, zt), P(b, b, zt - 0.1), P(a, b, zt - 0.1)], '#6fae58');
      this.poly([P(b, a, zt), P(b, b, zt), P(b, b, zt - 0.1), P(b, a, zt - 0.1)], '#5d9a49');

      // Centre park: pond, paths, trees and the painted title.
      const c = this.ctx;
      this.poly([P(1.15, 1.15, 0), P(7.85, 1.15, 0), P(7.85, 7.85, 0), P(1.15, 7.85, 0)], '#a5dc89');
      this.ellipse(6.6, 6.5, 0, 0.9, '#5cc0d9');
      this.ellipse(6.55, 6.45, 0, 0.7, '#7fd3e6');
      c.save();
      const s = this.TW / 200;
      c.setTransform(this.dpr * s, this.dpr * s * 0.5, -this.dpr * s, this.dpr * s * 0.5, this.dpr * this.ox, this.dpr * this.oy);
      // In this transform 100 units = one tile.
      c.font = `92px ${this.fonts.display}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = 'rgba(40,70,40,0.18)';
      c.fillText('ATLAS', 455, 300);
      c.fillText('TYCOON', 455, 400);
      c.fillStyle = '#fff6df';
      c.fillText('ATLAS', 450, 295);
      c.fillText('TYCOON', 450, 395);
      c.restore();
    }

    drawTile(t, objects) {
      const g = this.game;
      const { x, y } = CELLS[t.id];
      const x0 = x + GAP, y0 = y + GAP, x1 = x + 1 - GAP, y1 = y + 1 - GAP;
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
      this.box(x0, y0, x1, y1, 0, TILE_Z + lift, top, sideL, sideR, 'rgba(60,40,20,0.25)');
      const z = TILE_Z + lift;
      const P = this.P.bind(this);
      if (t.type === 'city') {
        const col = D.GROUPS[t.group].color;
        const w = 0.2;
        const band = {
          y0: [[x0, y0], [x1, y0], [x1, y0 + w], [x0, y0 + w]],
          y1: [[x0, y1 - w], [x1, y1 - w], [x1, y1], [x0, y1]],
          x0: [[x0, y0], [x0 + w, y0], [x0 + w, y1], [x0, y1]],
          x1: [[x1 - w, y0], [x1, y0], [x1, y1], [x1 - w, y1]],
        }[INNER[t.side]];
        this.poly(band.map(([a, b]) => P(a, b, z)), col);
      }
      if (this.pick && !this.pick.has(t.id)) {
        this.poly([P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)], 'rgba(20,30,60,0.35)');
      } else if (this.pick || this.flashId === t.id) {
        const a = 0.55 + Math.sin(this.now / 160) * 0.35;
        this.poly([P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)], null, `rgba(255,214,80,${a})`, 3);
      }
      const d = x + y;
      objects.push({ d: d + 0.45, f: () => this.drawProp(t, x + 0.5, y + 0.5, z) });
      objects.push({ d: d + 0.95, f: () => this.drawLabel(t, x + 0.5, y + 0.5, z) });
    }

    drawProp(t, cx, cy, z) {
      const g = this.game;
      const owner = t.owner >= 0 ? g.players[t.owner] : null;
      const now = this.now;
      const bx = cx - 0.12, by = cy - 0.12;
      switch (t.type) {
        case 'city': {
          if (!owner) return;
          const col = owner.color;
          const t0 = this.grow[t.id];
          const k = t0 ? Math.min(1, (now - t0) / 500) : 1;
          const s = t0 && k < 1 ? Math.max(0.05, easeBack(k)) : 1;
          this.drawBuilding(t.level, bx, by, z, col, s, t.id);
          if (g.festival === t.id) this.drawStar(bx, by, z + [0.7, 0.75, 1.15, 1.35, 2.0][t.level] * s, 0.13);
          return;
        }
        case 'resort':
          this.drawPalm(bx + 0.05, by - 0.05, z, 0.7);
          this.drawUmbrella(bx + 0.28, by + 0.1, z);
          if (owner) this.drawFlag(bx - 0.22, by + 0.15, z, owner.color, 0.5);
          if (g.festival === t.id) this.drawStar(bx, by, z + 1.0, 0.13);
          return;
        case 'chance': {
          const bob = Math.sin(now / 400 + t.id) * 0.06;
          const zz = z + 0.35 + bob;
          const r = 0.15;
          this.ellipse(cx, cy, z, 0.18, 'rgba(0,0,0,0.12)');
          this.box(cx - r, cy - r, cx + r, cy + r, zz, zz + r * 1.6, '#ffd75e', '#f0b532', '#d39420', 'rgba(120,70,0,0.3)');
          const [sx, sy] = this.P(cx, cy, zz + r * 1.6);
          this.text('?', sx, sy + 1, this.TW * 0.16, '#8a5a00', this.fonts.display);
          return;
        }
        case 'tax':
          for (let i = 0; i < 4; i++) {
            this.ellipse(cx - 0.05, cy - 0.05, z + i * 0.09, 0.2, '#c99419');
            this.ellipse(cx - 0.05, cy - 0.05, z + i * 0.09 + 0.05, 0.2, '#ffd34d');
          }
          return;
        case 'start': {
          const P = this.P.bind(this);
          const pts = [[0.2, 0.42], [0.55, 0.42], [0.55, 0.3], [0.82, 0.5], [0.55, 0.7], [0.55, 0.58], [0.2, 0.58]];
          // Arrow points along -x (towards tile 1).
          this.poly(pts.map(([u, v]) => P(cx + 0.5 - u, cy - 0.5 + v, z)), '#e8553d');
          return;
        }
        case 'island':
          this.ellipse(cx, cy, z, 0.36, '#f0cf86');
          this.drawPalm(cx - 0.05, cy - 0.05, z + 0.03, 0.95);
          return;
        case 'festival':
          this.drawFlag(cx - 0.1, cy - 0.1, z, '#d65a7a', 1.1);
          this.drawStar(cx - 0.1, cy - 0.1, z + 1.25 + Math.sin(now / 300) * 0.04, 0.18);
          return;
        case 'worldTour': {
          const bob = Math.sin(now / 700) * 0.08;
          this.ellipse(cx, cy, z, 0.3, 'rgba(0,0,0,0.12)');
          this.drawBlimp(cx - 0.05, cy - 0.05, z + 0.85 + bob);
          return;
        }
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

    drawBlimp(x, y, z) {
      const c = this.ctx;
      const [sx, sy] = this.P(x, y, z);
      const w = this.TW * 0.42, h = this.TW * 0.16;
      c.fillStyle = '#8fb8f0';
      c.beginPath(); c.moveTo(sx + w * 0.5, sy); c.lineTo(sx + w * 0.75, sy - h * 0.7); c.lineTo(sx + w * 0.75, sy + h * 0.7); c.fill();
      const grad = c.createLinearGradient(sx, sy - h, sx, sy + h);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#9cc0f2');
      c.fillStyle = grad;
      c.beginPath(); c.ellipse(sx, sy, w * 0.55, h, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(40,70,140,0.35)';
      c.lineWidth = 1;
      c.stroke();
      c.fillStyle = '#e8553d';
      c.fillRect(sx - w * 0.12, sy + h * 0.9, w * 0.24, h * 0.45);
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

    drawDice(now) {
      const dz = this.dice;
      const k = (now - dz.t0) / dz.dur;
      const rolling = k >= 0 && k < 1;
      if (rolling && Math.floor(now / 70) !== dz.tick) {
        dz.tick = Math.floor(now / 70);
        dz.shown = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
      }
      if (!rolling) dz.shown = dz.v;
      const spots = [[4.05, 5.75], [5.1, 5.45]];
      spots.forEach(([x, y], i) => {
        const hop = rolling ? Math.abs(Math.sin(k * Math.PI * 3 + i)) * (1 - k) * 1.2 : 0;
        const jx = rolling ? Math.sin(now / 37 + i) * 0.06 : 0;
        this.drawDie(x + jx, y - jx, hop, dz.shown[i]);
      });
    }

    drawDie(x, y, z, n) {
      const r = 0.3;
      this.ellipse(x, y, 0, 0.35 * (1 / (1 + z)), 'rgba(0,0,0,0.15)');
      this.box(x - r, y - r, x + r, y + r, z, z + r * 1.1, '#ffffff', '#ece8f4', '#d3cde3', 'rgba(60,50,90,0.25)');
      const pips = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }[n] || [];
      const c = this.ctx;
      for (const [u, v] of pips) {
        const [sx, sy] = this.P(x + u * r * 0.5, y + v * r * 0.5, z + r * 1.1);
        c.beginPath();
        c.ellipse(sx, sy, this.TW * 0.035, this.TW * 0.018, 0, 0, Math.PI * 2);
        c.fillStyle = n === 1 ? '#e8553d' : '#232845';
        c.fill();
      }
    }

    text(str, x, y, size, color, font, weight) {
      const c = this.ctx;
      c.font = `${weight || ''} ${Math.round(size)}px ${font || this.fonts.body}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = color;
      c.fillText(str, x, y);
    }

    drawLabel(t, cx, cy, z) {
      const g = this.game;
      const owner = t.owner >= 0 ? g.players[t.owner] : null;
      const c = this.ctx;
      const [sx, sy] = this.P(cx + 0.24, cy + 0.24, z);
      const big = this.TW >= 58;
      const name = this.nameOf ? this.nameOf(t.id) : t.name;
      const fs = Math.max(8, Math.min(13, this.TW * 0.105));
      if (t.id % 8 === 0) {
        if (big) {
          c.lineWidth = 3;
          c.strokeStyle = 'rgba(255,255,255,0.85)';
          c.font = `${Math.round(fs * 1.05)}px ${this.fonts.display}`;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.strokeText(name, sx, sy);
          this.text(name, sx, sy, fs * 1.05, '#2a2f4f', this.fonts.display);
        }
        return;
      }
      let value = null;
      // On small boards only rents are shown; prices are one tap away in the tile card.
      if (t.type === 'city' || t.type === 'resort') value = owner ? g.rent(t) : this.TW >= 50 ? t.price : null;
      const pillY = big ? sy + fs * 0.55 : sy;
      if (big) {
        c.lineWidth = 3;
        c.strokeStyle = 'rgba(255,250,240,0.9)';
        c.font = `600 ${Math.round(fs)}px ${this.fonts.body}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.strokeText(name, sx, sy - fs * 0.6);
        this.text(name, sx, sy - fs * 0.6, fs, '#232845', this.fonts.body, 600);
      }
      if (value != null) {
        const label = '$' + value.toLocaleString('en-US');
        c.font = `700 ${Math.round(fs * 0.92)}px ${this.fonts.body}`;
        const w = c.measureText(label).width + fs * 0.9, h = fs * 1.35;
        c.fillStyle = owner ? owner.color : 'rgba(35,40,69,0.82)';
        c.beginPath();
        c.roundRect(sx - w / 2, pillY - h / 2, w, h, h / 2);
        c.fill();
        this.text(label, sx, pillY + 0.5, fs * 0.92, '#ffffff', this.fonts.body, 700);
      }
    }

    drawFloats(now) {
      const c = this.ctx;
      this.floats = this.floats.filter((f) => now - f.t0 < 1400);
      for (const f of this.floats) {
        const k = (now - f.t0) / 1400;
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
