// Atlas Tycoon - bot player. Pure function of (player, request, game).
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./data.js') : root.ATData);
  if (isNode) module.exports = api;
  else root.ATAI = api;
})(this, function (D) {
  // Cash a bot tries to keep in hand: grows with the worst rent it could hit.
  function reserve(game, p) {
    const worst = game.tiles.reduce((m, t) => (t.owner >= 0 && t.owner !== p.id ? Math.max(m, game.rent(t)) : m), 0);
    return Math.max(150, Math.min(600, Math.round(worst * 0.6)));
  }

  // How much owning tile `t` would help player `pid` (0 = nothing special).
  function strategicValue(game, pid, t) {
    let score = 0;
    if (t.type === 'city') {
      const group = game.groupTiles(t.group);
      const mine = group.filter((x) => x.owner === pid || x.id === t.id).length;
      if (mine === group.length) score += 3;
      else if (mine === group.length - 1) score += 1;
    }
    const side = game.tiles.filter((x) => x.side === t.side && (x.type === 'city' || x.type === 'resort'));
    const sideMine = side.filter((x) => x.owner === pid || x.id === t.id).length;
    if (sideMine === side.length) score += 5;
    else if (sideMine >= side.length - 1) score += 2;
    if (t.type === 'resort') {
      const resorts = game.tiles.filter((x) => x.type === 'resort');
      const rm = resorts.filter((x) => x.owner === pid || x.id === t.id).length;
      score += rm === resorts.length ? 5 : rm - 1;
    }
    return score;
  }

  // Would the current owner lose a threatening position if we took this tile?
  function blocksThreat(game, t) {
    const owner = t.owner;
    if (owner < 0) return false;
    const fullGroups = D.GROUPS.filter((_, g) => game.ownsGroup(owner, g)).length;
    if (fullGroups >= 2 && t.type === 'city' && game.ownsGroup(owner, t.group)) return true;
    const side = game.tiles.filter((x) => x.side === t.side && (x.type === 'city' || x.type === 'resort'));
    return side.filter((x) => x.owner === owner).length >= side.length - 1;
  }

  function bestBy(ids, score) {
    let best = -1, bestScore = -Infinity;
    for (const id of ids) {
      const s = score(id);
      if (s > bestScore) { best = id; bestScore = s; }
    }
    return best;
  }

  function decide(p, req, game) {
    const keep = reserve(game, p);
    switch (req.type) {
      case 'roll': return true;
      case 'buy': {
        const affordable = req.options.filter((o) => o.cost <= p.cash - keep);
        if (affordable.length) return affordable[affordable.length - 1].level;
        if (strategicValue(game, p.id, req.tile) >= 2 && req.options[0].cost <= p.cash - 50) return 0;
        return -1;
      }
      case 'build': {
        const affordable = req.options.filter((o) => o.cost <= p.cash - keep);
        return affordable.length ? affordable[affordable.length - 1].level : -1;
      }
      case 'resort': return req.price <= p.cash - keep || strategicValue(game, p.id, req.tile) >= 3;
      case 'buyout': {
        const left = p.cash - req.price;
        if (strategicValue(game, p.id, req.tile) >= 5) return left >= 0;
        if (blocksThreat(game, req.tile)) return left >= 50;
        if (strategicValue(game, p.id, req.tile) >= 3) return left >= keep / 2;
        return left >= keep * 2 && game.rent(req.tile) >= 100;
      }
      case 'island': return p.cash > 500 + keep ? 'pay' : 'roll';
      case 'worldTour': {
        // Prefer an unowned property that completes something, then the best own city to grow.
        const target = bestBy(req.choices, (id) => {
          const t = game.tiles[id];
          if ((t.type === 'city' || t.type === 'resort') && t.owner < 0 && t.price <= p.cash - req.fee - 50) return 10 + strategicValue(game, p.id, t) * 5 + t.price / 100;
          if (t.type === 'city' && t.owner === p.id && t.level < 4) return 5 + t.price / 100;
          if (t.type === 'start') return 4;
          return -1;
        });
        return target >= 0 && game.tiles[target].type !== 'chance' && bestScoreOk(game, p, target) ? target : -1;
      }
      case 'festival':
      case 'startUpgrade':
        return bestBy(req.choices, (id) => {
          const t = game.tiles[id];
          return t.type === 'city' ? t.price * D.RENT_MULT[Math.min(4, t.level + 1)] : D.RESORT_RENT[0];
        });
      case 'earthquake': return bestBy(req.choices, (id) => game.rent(game.tiles[id]));
      case 'sell': return 'auto';
    }
    return -1;
  }

  function bestScoreOk(game, p, id) {
    const t = game.tiles[id];
    if (t.type === 'start') return true;
    return (t.type === 'city' || t.type === 'resort') && (t.owner < 0 || t.owner === p.id);
  }

  return { decide, strategicValue };
});
