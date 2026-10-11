// Atlas Tycoon - rules engine. UI-agnostic: decisions come from an async `decide`
// callback and everything visible is reported through an async `onEvent` callback.
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = isNode ? factory(require('./data.js'), require('./i18n.js')) : factory(root.ATData, root.ATI18N);
  if (isNode) module.exports = api;
  else root.ATEngine = api;
})(this, function (D, I18N) {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const BOARD = D.TILES.length;

  class Game {
    constructor(opts) {
      this.rules = Object.assign({}, D.RULES, opts.rules || {});
      this.seed = opts.seed != null ? opts.seed : (Date.now() >>> 0);
      this.rng = mulberry32(this.seed);
      this.decide = opts.decide;
      this.onEvent = opts.onEvent || (() => {});
      this.players = opts.players.map((p, i) => ({
        id: i, name: p.name, color: p.color || D.PLAYER_COLORS[i], isBot: !!p.isBot,
        cash: this.rules.startCash, pos: 0, laps: 0, islandTurns: 0, bankrupt: false, shield: 0, coupon: 0,
      }));
      this.tiles = D.TILES.map((t) => Object.assign({}, t, { owner: -1, level: 0 }));
      this.festival = -1;
      this.turn = 0;
      this.round = 1;
      this.winner = null;
      this.winReason = '';
      this.deck = [];
    }

    // ---------- serialization (for networked play) ----------
    snapshot() {
      return {
        rules: this.rules,
        players: this.players.map((p) => Object.assign({}, p)),
        tiles: this.tiles.map((t) => ({ owner: t.owner, level: t.level })),
        festival: this.festival, turn: this.turn, round: this.round,
        winner: this.winner ? this.winner.id : null, winReason: this.winReason,
      };
    }

    load(s) {
      this.rules = s.rules;
      this.players = s.players.map((p) => Object.assign({}, p));
      s.tiles.forEach((t, i) => Object.assign(this.tiles[i], t));
      this.festival = s.festival;
      this.turn = s.turn;
      this.round = s.round;
      this.winner = s.winner != null ? this.players[s.winner] : null;
      this.winReason = s.winReason;
    }

    // Answer used when a human runs out of time: roll the dice, skip everything else.
    static timeoutAnswer(req) {
      switch (req.type) {
        case 'roll': return true;
        case 'island': return 'roll';
        case 'resort':
        case 'buyout': return false;
        case 'earthquake': return req.choices[0];
        case 'sell': return 'auto';
        default: return -1;
      }
    }

    // Replaces player/tile object references with ids so a message can be sent as JSON.
    static pack(obj) {
      const out = {};
      for (const k in obj) {
        const v = obj[k];
        if (k === 'player' || k === 'owner') out[k + 'Id'] = v.id;
        else if (k === 'tile') out.tileId = v.id;
        else out[k] = v;
      }
      return out;
    }

    unpack(obj) {
      const out = Object.assign({}, obj);
      if ('playerId' in obj) out.player = this.players[obj.playerId];
      if ('ownerId' in obj) out.owner = this.players[obj.ownerId];
      if ('tileId' in obj) out.tile = this.tiles[obj.tileId];
      return out;
    }

    // ---------- helpers ----------
    rand(n) { return Math.floor(this.rng() * n); }
    emit(evt) { return Promise.resolve(this.onEvent(evt)); }
    // Log lines carry a key and params so each client can show them in its own language.
    say(key, params) { return this.emit({ type: 'log', key, params: params || {}, text: I18N.tFor('en', key, params) }); }
    ask(p, req) { return Promise.resolve(this.decide(p, req, this)); }
    alive() { return this.players.filter((p) => !p.bankrupt); }
    owned(p) { return this.tiles.filter((t) => t.owner === p.id); }

    buildCost(t, level) { return Math.round(t.price * D.BUILD_MULT[level]); }
    costRange(t, from, to) {
      let sum = 0;
      for (let l = from + 1; l <= to; l++) sum += this.buildCost(t, l);
      return sum;
    }
    value(t) { return t.type === 'city' ? t.price + this.costRange(t, 0, t.level) : t.price; }
    buyoutPrice(t) { return Math.round(this.value(t) * this.rules.buyoutMult); }
    netWorth(p) { return p.cash + this.owned(p).reduce((s, t) => s + this.value(t), 0); }

    groupTiles(g) { return this.tiles.filter((t) => t.type === 'city' && t.group === g); }
    ownsGroup(pid, g) { return this.groupTiles(g).every((t) => t.owner === pid); }

    rent(t) {
      if (t.owner < 0) return 0;
      if (t.type === 'resort') {
        const n = this.tiles.filter((x) => x.type === 'resort' && x.owner === t.owner).length;
        return D.RESORT_RENT[n - 1] * (this.festival === t.id ? 2 : 1);
      }
      let rent = Math.round(t.price * D.RENT_MULT[t.level]);
      if (this.ownsGroup(t.owner, t.group)) rent *= 2;
      if (this.festival === t.id) rent *= 2;
      return rent;
    }

    // Highest level a player may build up to on a city: limited by laps completed,
    // and a landmark is only possible on a city that already has a hotel.
    levelCap(p, t) {
      if (t.level >= 3) return 4;
      return Math.min(3, p.laps + 1);
    }

    // ---------- win conditions ----------
    checkMonopoly(p) {
      const full = D.GROUPS.filter((_, g) => this.ownsGroup(p.id, g)).length;
      if (full >= 3) return 'Triple Monopoly';
      for (let side = 0; side < 4; side++) {
        const tiles = this.tiles.filter((t) => t.side === side && (t.type === 'city' || t.type === 'resort'));
        if (tiles.every((t) => t.owner === p.id)) return 'Line Monopoly';
      }
      const resorts = this.tiles.filter((t) => t.type === 'resort');
      if (resorts.every((t) => t.owner === p.id)) return 'Resort Monopoly';
      return null;
    }

    async declareWinner(p, reason) {
      this.winner = p;
      this.winReason = reason;
      await this.emit({ type: 'gameOver', player: p, reason });
    }

    async afterAcquire(p) {
      const m = this.checkMonopoly(p);
      if (m) await this.declareWinner(p, m);
    }

    // ---------- money ----------
    async gain(p, amount, why) {
      p.cash += amount;
      await this.emit({ type: 'money', player: p, delta: amount, why });
    }

    // Pays `amount` to `to` (a player, or null for the bank). Sells property when short.
    // Returns false if the payer went bankrupt.
    async charge(p, amount, to, why) {
      amount = Math.round(amount);
      if (amount <= 0) return true;
      if (p.cash < amount) await this.liquidate(p, amount);
      if (p.cash >= amount) {
        p.cash -= amount;
        await this.emit({ type: 'money', player: p, delta: -amount, why });
        if (to) await this.gain(to, amount, why);
        return true;
      }
      const paid = p.cash;
      p.cash = 0;
      if (to && paid > 0) await this.gain(to, paid, why);
      await this.goBankrupt(p, to);
      return false;
    }

    sellValue(t) { return Math.round(this.value(t) * this.rules.sellRate); }

    // Picks the properties whose sale covers `shortfall` with the least money left over.
    // options: [{ tileId, value }]. Returns tile ids; everything if even that is not enough.
    static autoSellPick(options, shortfall) {
      const total = options.reduce((s, o) => s + o.value, 0);
      if (total <= shortfall) return options.map((o) => o.tileId);
      // Subset-sum over sale values. Bigger properties first, and each reachable sum keeps the
      // first chain that reached it, so chains use fewer properties and never reuse one.
      const items = options.slice().sort((a, b) => b.value - a.value);
      const from = new Array(total + 1).fill(null);
      from[0] = { prev: -1, item: -1 };
      items.forEach((o, i) => {
        for (let s = total - o.value; s >= 0; s--) {
          if (from[s] && !from[s + o.value] && (from[s].item < i)) from[s + o.value] = { prev: s, item: i };
        }
      });
      let best = shortfall;
      while (best <= total && !from[best]) best++;
      const pick = [];
      for (let s = best; s > 0; s = from[s].prev) pick.push(items[from[s].item].tileId);
      return pick;
    }

    async liquidate(p, need) {
      const shortfall = need - p.cash;
      const options = this.owned(p).map((t) => ({ tileId: t.id, value: this.sellValue(t) }));
      const total = options.reduce((s, o) => s + o.value, 0);
      let pick;
      if (total >= shortfall && options.length > 1) {
        // Let the player choose what to sell, or have it picked automatically.
        const answer = await this.ask(p, { type: 'sell', need, shortfall, options });
        if (Array.isArray(answer)) {
          pick = [...new Set(answer)].filter((id) => options.some((o) => o.tileId === id));
          const got = pick.reduce((s, id) => s + options.find((o) => o.tileId === id).value, 0);
          // Not enough selected: top up automatically from the rest.
          if (got < shortfall) pick = pick.concat(Game.autoSellPick(options.filter((o) => !pick.includes(o.tileId)), shortfall - got));
        } else {
          pick = Game.autoSellPick(options, shortfall);
        }
      } else {
        pick = Game.autoSellPick(options, shortfall);
      }
      for (const id of pick) {
        const t = this.tiles[id];
        const got = this.sellValue(t);
        this.release(t);
        p.cash += got;
        await this.say('l_sell', { p: p.name, tile: t.id, m: got });
        await this.emit({ type: 'tile', tile: t });
      }
    }

    release(t) {
      t.owner = -1;
      t.level = 0;
      if (this.festival === t.id) this.festival = -1;
    }

    async goBankrupt(p, creditor) {
      p.bankrupt = true;
      for (const t of this.owned(p)) { this.release(t); await this.emit({ type: 'tile', tile: t }); }
      await this.say(creditor ? 'l_bankruptTo' : 'l_bankrupt', { p: p.name, o: creditor && creditor.name });
      await this.emit({ type: 'bankrupt', player: p });
      const alive = this.alive();
      if (alive.length === 1) await this.declareWinner(alive[0], 'Last One Standing');
    }

    // ---------- movement ----------
    async roll(p, skipAsk) {
      if (!skipAsk) await this.ask(p, { type: 'roll' });
      const dice = [1 + this.rand(6), 1 + this.rand(6)];
      await this.emit({ type: 'dice', player: p, dice });
      return dice;
    }

    async step(p, n) {
      const path = [];
      const dir = n < 0 ? -1 : 1;
      for (let i = 0; i < Math.abs(n); i++) {
        p.pos = (p.pos + dir + BOARD) % BOARD;
        path.push(p.pos);
        if (dir > 0 && p.pos === 0) {
          p.laps++;
          await this.emit({ type: 'move', player: p, path: path.splice(0) });
          await this.gain(p, this.rules.salary, 'salary');
          await this.say('l_salary', { p: p.name, m: this.rules.salary });
        }
      }
      if (path.length) await this.emit({ type: 'move', player: p, path });
    }

    async moveTo(p, dest) {
      await this.step(p, (dest - p.pos + BOARD) % BOARD);
    }

    async sendToIsland(p) {
      p.pos = 8;
      p.islandTurns = this.rules.islandTurns;
      await this.emit({ type: 'move', player: p, path: [8], jump: true });
      await this.say('l_island', { p: p.name });
    }

    // ---------- turn flow ----------
    async run() {
      await this.emit({ type: 'start' });
      while (!this.winner) {
        const p = this.players[this.turn];
        if (!p.bankrupt) {
          await this.emit({ type: 'turn', player: p });
          await this.playTurn(p);
        }
        if (this.winner) break;
        this.turn = (this.turn + 1) % this.players.length;
        if (this.turn === 0) {
          this.round++;
          if (this.round > this.rules.maxRounds) {
            const best = this.alive().sort((a, b) => this.netWorth(b) - this.netWorth(a))[0];
            await this.declareWinner(best, 'Richest After ' + this.rules.maxRounds + ' Rounds');
            break;
          }
          await this.emit({ type: 'round', round: this.round });
        }
      }
      return this.winner;
    }

    async playTurn(p) {
      if (p.islandTurns > 0) {
        const choice = p.cash >= this.rules.islandFine
          ? await this.ask(p, { type: 'island', fine: this.rules.islandFine, turnsLeft: p.islandTurns })
          : 'roll';
        if (choice === 'pay') {
          await this.charge(p, this.rules.islandFine, null, 'island fine');
          p.islandTurns = 0;
          await this.say('l_payIsland', { p: p.name, m: this.rules.islandFine });
        } else {
          const [a, b] = await this.roll(p, true);
          if (a !== b) {
            p.islandTurns--;
            await this.say(p.islandTurns ? 'l_stay' : 'l_sailNext', { p: p.name });
            return;
          }
          p.islandTurns = 0;
          await this.say('l_escape', { p: p.name });
          await this.step(p, a + b);
          await this.resolveTile(p);
          return;
        }
      }
      let doubles = 0;
      for (;;) {
        const [a, b] = await this.roll(p);
        if (a === b && ++doubles === 3) {
          await this.say('l_threeDoubles', { p: p.name });
          await this.sendToIsland(p);
          return;
        }
        await this.step(p, a + b);
        await this.resolveTile(p);
        if (this.winner || p.bankrupt || p.islandTurns > 0 || a !== b) return;
        await this.say('l_again', { p: p.name });
      }
    }

    async resolveTile(p) {
      const t = this.tiles[p.pos];
      switch (t.type) {
        case 'city':
        case 'resort': return this.landProperty(p, t);
        case 'chance': return this.drawCard(p);
        case 'tax': {
          const tax = Math.round((this.netWorth(p) * this.rules.taxRate) / 10) * 10;
          await this.say('l_tax', { p: p.name, m: tax });
          return this.charge(p, tax, null, 'tax');
        }
        case 'island': return this.sendToIsland(p);
        case 'festival': return this.hostGala(p);
        case 'worldTour': return this.worldTour(p);
        case 'start': return this.startBonus(p);
      }
    }

    // ---------- properties ----------
    buildOptions(p, t, from) {
      const cap = this.levelCap(p, t);
      const opts = [];
      for (let l = from + 1; l <= cap; l++) {
        const cost = this.costRange(t, from, l);
        if (cost <= p.cash) opts.push({ level: l, cost });
      }
      return opts;
    }

    async landProperty(p, t) {
      if (t.owner < 0) {
        if (t.type === 'resort') {
          if (p.cash < t.price) return;
          if (await this.ask(p, { type: 'resort', tile: t, price: t.price })) {
            await this.charge(p, t.price, null, 'purchase');
            t.owner = p.id;
            await this.say('l_buyResort', { p: p.name, tile: t.id, m: t.price });
            await this.emit({ type: 'tile', tile: t });
            await this.afterAcquire(p);
          }
          return;
        }
        if (p.cash < t.price) return;
        // Option level 0 = land only; higher levels include building costs.
        const options = [{ level: 0, cost: t.price }].concat(
          this.buildOptions(p, t, 0).map((o) => ({ level: o.level, cost: o.cost + t.price })).filter((o) => o.cost <= p.cash),
        );
        const pick = await this.ask(p, { type: 'buy', tile: t, options });
        const opt = options.find((o) => o.level === pick);
        if (!opt) return;
        await this.charge(p, opt.cost, null, 'purchase');
        t.owner = p.id;
        t.level = opt.level;
        await this.say(opt.level ? 'l_buyWith' : 'l_buy', { p: p.name, tile: t.id, lv: opt.level, m: opt.cost });
        await this.emit({ type: 'tile', tile: t });
        return this.afterAcquire(p);
      }

      if (t.owner === p.id) return this.offerBuild(p, t);

      const owner = this.players[t.owner];
      let due = this.rent(t);
      if (p.shield) { p.shield--; due = 0; await this.say('l_shield', { p: p.name }); }
      else if (p.coupon) { p.coupon--; due = Math.round(due / 2); await this.say('l_coupon', { p: p.name }); }
      if (due > 0) {
        await this.say('l_rent', { p: p.name, o: owner.name, tile: t.id, m: due });
        if (!(await this.charge(p, due, owner, 'rent'))) return;
      }
      if (t.type !== 'city' || t.level >= 4) return;
      const price = this.buyoutPrice(t);
      if (p.cash < price) return;
      if (!(await this.ask(p, { type: 'buyout', tile: t, price, owner }))) return;
      await this.charge(p, price, owner, 'buyout');
      if (this.festival === t.id) this.festival = -1;
      t.owner = p.id;
      await this.say('l_buyout', { p: p.name, o: owner.name, tile: t.id, m: price });
      await this.emit({ type: 'tile', tile: t });
      await this.afterAcquire(p);
      if (!this.winner) await this.offerBuild(p, t);
    }

    async offerBuild(p, t) {
      if (t.type !== 'city') return;
      const options = this.buildOptions(p, t, t.level);
      if (!options.length) return;
      const pick = await this.ask(p, { type: 'build', tile: t, options });
      const opt = options.find((o) => o.level === pick);
      if (!opt) return;
      await this.charge(p, opt.cost, null, 'build');
      t.level = opt.level;
      await this.say('l_build', { p: p.name, tile: t.id, lv: opt.level, m: opt.cost });
      await this.emit({ type: 'tile', tile: t });
    }

    // ---------- corners ----------
    async startBonus(p) {
      const choices = this.owned(p).filter((t) => t.type === 'city' && t.level < Math.min(3, this.levelCap(p, t))).map((t) => t.id);
      if (!choices.length) return;
      const id = await this.ask(p, { type: 'startUpgrade', choices });
      const t = this.tiles[id];
      if (!t || !choices.includes(id)) return;
      t.level++;
      await this.say('l_free', { p: p.name, tile: t.id, lv: t.level });
      await this.emit({ type: 'tile', tile: t });
    }

    async hostGala(p) {
      const choices = this.owned(p).map((t) => t.id);
      if (!choices.length) return;
      const id = await this.ask(p, { type: 'festival', choices });
      if (!choices.includes(id)) return;
      const old = this.festival;
      this.festival = id;
      await this.say('l_gala', { p: p.name, tile: id });
      if (old >= 0) await this.emit({ type: 'tile', tile: this.tiles[old] });
      await this.emit({ type: 'tile', tile: this.tiles[id] });
    }

    async worldTour(p) {
      const fee = this.rules.worldTourFee;
      if (p.cash < fee) return;
      const choices = this.tiles.filter((t) => t.id !== p.pos).map((t) => t.id);
      const dest = await this.ask(p, { type: 'worldTour', fee, choices });
      if (!choices.includes(dest)) return;
      await this.charge(p, fee, null, 'travel');
      await this.say('l_fly', { p: p.name, tile: dest });
      await this.moveTo(p, dest);
      return this.resolveTile(p);
    }

    // ---------- cards ----------
    async drawCard(p) {
      if (!this.deck.length) {
        this.deck = D.CARDS.map((c) => c.id);
        for (let i = this.deck.length - 1; i > 0; i--) {
          const j = this.rand(i + 1);
          [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
      }
      const cardId = this.deck.pop();
      const card = D.CARDS.find((c) => c.id === cardId);
      await this.emit({ type: 'card', player: p, card });
      await this.say('l_card', { p: p.name, card: card.id });
      const others = this.alive().filter((o) => o !== p);
      switch (card.id) {
        case 'tailwind': await this.moveTo(p, 0); return this.startBonus(p);
        case 'boom': return this.gain(p, 150, 'card');
        case 'inherit': return this.gain(p, 300, 'card');
        case 'badinvest': return this.charge(p, 100, null, 'card');
        case 'storm': return this.sendToIsland(p);
        case 'voucher': await this.moveTo(p, 24); return this.resolveTile(p);
        case 'shield': p.shield++; return;
        case 'coupon': p.coupon++; return;
        case 'gala': return this.hostGala(p);
        case 'quake': {
          const choices = this.tiles.filter((t) => t.type === 'city' && t.owner >= 0 && t.owner !== p.id && t.level > 0 && t.level < 4).map((t) => t.id);
          if (!choices.length) return this.say('l_noQuake');
          const id = await this.ask(p, { type: 'earthquake', choices });
          const t = this.tiles[choices.includes(id) ? id : choices[0]];
          t.level--;
          await this.say('l_quake', { tile: t.id, lv: t.level });
          return this.emit({ type: 'tile', tile: t });
        }
        case 'charity':
          for (const o of others) if (!(await this.charge(p, 50, o, 'card'))) return;
          return;
        case 'birthday':
          for (const o of others) await this.charge(o, 50, p, 'card');
          return;
        case 'repairs': {
          const levels = this.owned(p).reduce((s, t) => s + (t.type === 'city' ? t.level : 0), 0);
          return this.charge(p, levels * 25, null, 'card');
        }
        case 'taxi': await this.step(p, -3); return this.resolveTile(p);
      }
    }
  }

  // How long clients need to show an event; the online server waits this long between events.
  function eventDuration(e) {
    switch (e.type) {
      case 'dice': return 2000;
      case 'move': return e.jump ? 650 : e.path.length * 240 + 350;
      case 'card': return 2600;
      case 'turn': return 1000;
      case 'tile': return 500;
      case 'bankrupt': return 1200;
      case 'money': return 120;
      default: return 0;
    }
  }

  return { Game, fmt, mulberry32, eventDuration };
});
