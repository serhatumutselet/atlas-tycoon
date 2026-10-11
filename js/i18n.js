// Atlas Tycoon - translations (English, Turkish). Strings use {name} placeholders.
// Params named m/cost are money, lv is a building level, tile is a tile id.
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./data.js') : root.ATData);
  if (isNode) module.exports = api;
  else root.ATI18N = api;
})(this, function (D) {
  const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');

  const en = {
    // home
    tagline: 'Buy cities on a floating island, raise landmarks and bankrupt your rivals.',
    yourName: 'Your name', namePlaceholder: 'Captain', createRoom: 'Create online room', roomCode: 'Room code',
    join: 'Join', playLocal: 'Play on this device', howToPlay: 'How to play', language: 'Language',
    rules: [
      'Roll two dice and move. Doubles roll again; three doubles strand you on <b>Castaway Isle</b>.',
      'Buy an empty city and build on it right away. First lap: up to a Villa. Second lap: a Tower. After that: a Hotel.',
      'Land on your own Hotel to raise a <b>Landmark</b>. Landmarks can never be bought out.',
      "Pay rent on a rival's city, then you may <b>buy it out</b> for twice its value.",
      'A whole region doubles its rent. The <b>Grand Gala</b> doubles one property\'s rent again.',
      '<b>Airship Dock</b>: pay $50 to fly anywhere. Landing exactly on <b>Departure</b> gives a free upgrade.',
      'Win with three full regions, every property on one side, all four resorts, or by being the last one standing.',
      'Pinch or scroll to zoom the board, drag to move it, double-click to reset. Tap any tile for its details.',
    ],
    // local setup
    back: '← Back', localTitle: 'Play on this device', localLede: 'Pass the device around, or fill seats with bots.',
    human: 'Human', bot: 'Bot', empty: 'Empty', roundLimit: 'Round limit', none: 'None', startGame: 'Start game', playerN: 'Player {n}',
    // lobby
    leaveRoom: '← Leave room', roomCodeLabel: 'Room code', copyLink: 'Copy invite link', linkCopied: 'Link copied',
    addBot: 'Add bot', removeBot: 'Remove bot', waitHost: 'Waiting for the host to start the game.', openSeat: 'Open seat',
    tagHost: 'Host', tagReady: 'Ready', tagOffline: 'Offline', you: 'you',
    // errors
    codeLength: 'Room codes have 5 characters.', serverNeeded: 'Online play needs the Atlas server. Start it with "npm start".',
    unreachable: 'Could not reach the Atlas server. Check your connection.', roomGone: 'That room is no longer available.',
    connLost: 'Connection lost. Reconnecting…',
    err_no_room: 'No room with that code. Check the code or create a new room.', err_started: 'This game has already started.',
    err_full: 'This room is full (4 players).', err_host_only: 'Only the host can do that.', err_need_players: 'Add at least one more player or bot.',
    err_stale: 'That choice is no longer open.',
    // hud
    camFollow: 'Camera follows the pawn',
    round: 'Round {n}', roundOf: 'Round {n} / {max}', journal: 'Journal', menu: 'Menu', botSpeed: 'Bot speed',
    slow: 'Slow', normal: 'Normal', fast: 'Fast', turbo: 'Turbo', leaveGame: 'Leave game', confirmLeave: 'Leave this game?',
    turnOf: "{p}'s turn", yourTurn: 'Your turn!', badgeIsle: 'Isle', badgeShield: 'Shield', badgeCoupon: '½ rent',
    worth: 'Worth {m}', props: '{n} props', lap: 'lap {n}',
    w_roll: '{p} is rolling…', w_buy: '{p} is deciding whether to buy…', w_build: '{p} is deciding what to build…',
    w_buyout: '{p} is weighing a buyout…', w_resort: '{p} is eyeing a resort…', w_island: '{p} is stranded on the island…',
    w_worldTour: '{p} is picking a destination…', w_festival: '{p} is picking a Gala city…', w_startUpgrade: '{p} is picking a free upgrade…',
    w_earthquake: '{p} is picking an earthquake target…',
    // prompts
    rollTitle: 'Your roll', rollSub: '{p}, shake those dice!', rollDice: 'Roll dice', spaceHint: 'or press Space',
    buyTitle: 'For sale', buyQ: 'Nobody owns this yet. Buy it?', plotOnly: 'Plot only', withLevel: 'With {lv}', pass: 'Pass',
    buildTitle: 'Build', buildQ: 'Your {lv} here can grow.', notNow: 'Not now', rentAfter: 'rent {m}',
    resortTitle: 'Resort', resortQ: 'Buy this resort?', buy: 'Buy',
    buyoutTitle: 'Buyout', buyoutQ: 'Take it from {o}?', buyOut: 'Buy out', noThanks: 'No thanks',
    islandTitle: 'Castaway Isle', islandQ: 'Stranded · {n} tries left', islandQ1: 'Stranded · last try',
    rollDoubles: 'Roll for doubles', payLeave: 'Pay to leave',
    worldTourQ: '{p}, tap any tile to fly there for {m}.', stayHere: 'Stay here', festivalQ: '{p}, tap one of your glowing properties to host the Grand Gala.',
    skip: 'Skip', startUpgradeQ: '{p}, tap a glowing city for a free upgrade.', earthquakeQ: '{p}, tap a glowing rival city to shake it.',
    cashLeft: 'Cash {m}', owner: 'Owner', price: 'Price',
    // info
    regionInfo: '{g} · {n} cities', level: 'Level', rent: 'Rent', cost: 'Cost', rentDoubles: 'Rent doubles with the whole region',
    buyoutInfo: 'buyout {m}', resortInfo: 'Price {m}. Rent by resorts owned: {list}.', gala: 'Gala', rentNow: 'rent {m}',
    info_start: 'Collect {m} each time you pass. Land exactly here for a free upgrade.',
    info_island: 'Stuck for up to {n} turns. Roll doubles or pay {m} to leave.',
    info_festival: 'Host the Grand Gala in one of your properties to double its rent.',
    info_worldTour: 'Pay {m} to fly to any tile.', info_chance: 'Draw a Fortune card.', info_tax: 'Pay {n}% of your net worth.',
    // dice, cards, end
    doubles: 'Doubles!', fortune: 'Fortune', wins: '{p} wins!', bankrupt: 'Bankrupt', backToMenu: 'Back to menu',
    r_triple: 'Triple Monopoly', r_line: 'Line Monopoly', r_resort: 'Resort Monopoly', r_last: 'Last One Standing', r_richest: 'Richest after {n} rounds',
    // levels, groups, special tiles
    levels: ['Plot', 'Villa', 'Tower', 'Hotel', 'Landmark'],
    groups: ['Mossland', 'Dunes', 'Lakes', 'Steppe', 'Highlands', 'Jungle', 'Metro', 'Capitals'],
    tiles: {},
    // log
    l_sell: '{p} sells {tile} for {m}.', l_bankrupt: '{p} is bankrupt!', l_bankruptTo: '{p} is bankrupt (owed {o})!',
    l_salary: '{p} passes Departure and collects {m}.', l_island: '{p} is stranded on Castaway Isle.',
    l_payIsland: '{p} pays {m} to leave the island.', l_stay: '{p} stays on the island.', l_sailNext: '{p} will sail off next turn.',
    l_escape: '{p} rolls doubles and escapes!', l_threeDoubles: '{p} rolled three doubles in a row.', l_again: 'Doubles! {p} rolls again.',
    l_tax: '{p} pays {m} in customs duty.', l_buyResort: '{p} buys {tile} for {m}.', l_buy: '{p} buys {tile} for {m}.',
    l_buyWith: '{p} buys {tile} with a {lv} for {m}.', l_shield: "{p}'s Rent Shield blocks the rent!", l_coupon: '{p} uses a Half-Price Coupon.',
    l_rent: '{p} pays {m} rent to {o} at {tile}.', l_buyout: '{p} buys out {tile} from {o} for {m}!', l_build: '{p} builds a {lv} in {tile} for {m}.',
    l_free: '{p} gets a free {lv} in {tile}.', l_gala: '{p} hosts the Grand Gala in {tile}: rent there is doubled!', l_fly: '{p} flies to {tile}.',
    l_card: '{p} draws "{card}".', l_noQuake: 'No city is hit.', l_quake: 'An earthquake shakes {tile}; it drops to {lv}.',
  };

  const tr = {
    tagline: 'Gökyüzündeki adada şehirler satın al, simge yapılar dik ve rakiplerini iflas ettir.',
    yourName: 'Adın', namePlaceholder: 'Kaptan', createRoom: 'Online oda kur', roomCode: 'Oda kodu',
    join: 'Katıl', playLocal: 'Bu cihazda oyna', howToPlay: 'Nasıl oynanır', language: 'Dil',
    rules: [
      'İki zar at ve ilerle. Çift gelirse tekrar atarsın; üç kez üst üste çift gelirse <b>Issız Ada</b>\'ya düşersin.',
      'Boş bir şehri satın al, istersen hemen üstüne inşa et. İlk tur: en fazla Villa. İkinci tur: Kule. Sonrası: Otel.',
      'Kendi Otelinin üstüne gelince <b>Simge Yapı</b> dikebilirsin. Simge yapılar asla satın alınamaz.',
      'Rakibin şehrine gelince kirayı öde, sonra istersen iki katı fiyatına <b>satın al</b>.',
      'Bir bölgenin tamamına sahip olmak kirayı ikiye katlar. <b>Büyük Gala</b> bir mülkün kirasını bir kez daha katlar.',
      '<b>Zeplin İskelesi</b>: $50 öde, istediğin kareye uç. <b>Başlangıç</b> karesine tam gelirsen bedava yükseltme kazanırsın.',
      'Üç bölgenin tamamı, bir kenarın bütün mülkleri, dört tatil yerinin hepsi ya da herkes iflas edince ayakta kalmak kazandırır.',
      'Tahtayı iki parmakla ya da tekerlekle yakınlaştır, sürükleyerek kaydır, çift tıklayıp sıfırla. Detaylar için bir kareye dokun.',
    ],
    back: '← Geri', localTitle: 'Bu cihazda oyna', localLede: 'Cihazı elden ele dolaştır ya da boş koltuklara bot koy.',
    human: 'İnsan', bot: 'Bot', empty: 'Boş', roundLimit: 'Tur sınırı', none: 'Yok', startGame: 'Oyunu başlat', playerN: 'Oyuncu {n}',
    leaveRoom: '← Odadan çık', roomCodeLabel: 'Oda kodu', copyLink: 'Davet linkini kopyala', linkCopied: 'Link kopyalandı',
    addBot: 'Bot ekle', removeBot: 'Bot çıkar', waitHost: 'Oyunu başlatması için host bekleniyor.', openSeat: 'Boş koltuk',
    tagHost: 'Host', tagReady: 'Hazır', tagOffline: 'Çevrimdışı', you: 'sen',
    codeLength: 'Oda kodu 5 karakterden oluşur.', serverNeeded: 'Online oyun için Atlas sunucusu gerekli. "npm start" ile başlat.',
    unreachable: 'Atlas sunucusuna ulaşılamadı. Bağlantını kontrol et.', roomGone: 'Bu oda artık yok.',
    connLost: 'Bağlantı koptu. Yeniden bağlanılıyor…',
    err_no_room: 'Bu kodla bir oda yok. Kodu kontrol et ya da yeni oda kur.', err_started: 'Bu oyun çoktan başladı.',
    err_full: 'Oda dolu (4 oyuncu).', err_host_only: 'Bunu sadece host yapabilir.', err_need_players: 'En az bir oyuncu ya da bot daha ekle.',
    err_stale: 'Bu seçim artık geçerli değil.',
    camFollow: 'Kamera piyonu takip etsin',
    round: 'Tur {n}', roundOf: 'Tur {n} / {max}', journal: 'Günlük', menu: 'Menü', botSpeed: 'Bot hızı',
    slow: 'Yavaş', normal: 'Normal', fast: 'Hızlı', turbo: 'Turbo', leaveGame: 'Oyundan çık', confirmLeave: 'Oyundan çıkılsın mı?',
    turnOf: 'Sıra: {p}', yourTurn: 'Sıra sende!', badgeIsle: 'Ada', badgeShield: 'Kalkan', badgeCoupon: '½ kira',
    worth: 'Servet {m}', props: '{n} mülk', lap: '{n}. tur',
    w_roll: '{p} zar atıyor…', w_buy: '{p} satın almayı düşünüyor…', w_build: '{p} ne inşa edeceğine karar veriyor…',
    w_buyout: '{p} satın alıp almamayı tartıyor…', w_resort: '{p} tatil yerine göz dikti…', w_island: '{p} adada mahsur…',
    w_worldTour: '{p} gideceği yeri seçiyor…', w_festival: '{p} Gala şehrini seçiyor…', w_startUpgrade: '{p} bedava yükseltmesini seçiyor…',
    w_earthquake: '{p} deprem hedefini seçiyor…',
    rollTitle: 'Zar sırası', rollSub: '{p}, zarları salla!', rollDice: 'Zar at', spaceHint: 'ya da Boşluk tuşuna bas',
    buyTitle: 'Satılık', buyQ: 'Henüz kimsenin değil. Satın alıyor musun?', plotOnly: 'Sadece arsa', withLevel: '{lv} ile', pass: 'Geç',
    buildTitle: 'İnşaat', buildQ: 'Buradaki {lv} büyüyebilir.', notNow: 'Şimdi değil', rentAfter: 'kira {m}',
    resortTitle: 'Tatil yeri', resortQ: 'Bu tatil yerini satın al?', buy: 'Satın al',
    buyoutTitle: 'Satın alma', buyoutQ: '{o} oyuncusundan satın al?', buyOut: 'Satın al', noThanks: 'Hayır',
    islandTitle: 'Issız Ada', islandQ: 'Mahsur kaldın · {n} hakkın var', islandQ1: 'Mahsur kaldın · son hakkın',
    rollDoubles: 'Çift için zar at', payLeave: 'Ödeyip çık',
    worldTourQ: '{p}, {m} karşılığında uçmak istediğin kareye dokun.', stayHere: 'Burada kal', festivalQ: '{p}, Büyük Gala\'yı ağırlayacak parlayan mülküne dokun.',
    skip: 'Atla', startUpgradeQ: '{p}, bedava yükseltme için parlayan bir şehre dokun.', earthquakeQ: '{p}, sarsmak istediğin parlayan rakip şehre dokun.',
    cashLeft: 'Nakit {m}', owner: 'Sahibi', price: 'Fiyat',
    regionInfo: '{g} · {n} şehir', level: 'Seviye', rent: 'Kira', cost: 'Maliyet', rentDoubles: 'Bölgenin tamamı senin olunca kira iki katı',
    buyoutInfo: 'satın alma {m}', resortInfo: 'Fiyat {m}. Sahip olunan tatil yeri sayısına göre kira: {list}.', gala: 'Gala', rentNow: 'kira {m}',
    info_start: 'Her geçişte {m} al. Tam bu kareye gelirsen bedava yükseltme kazanırsın.',
    info_island: 'En fazla {n} tur mahsur kalırsın. Çift at ya da {m} ödeyip çık.',
    info_festival: 'Büyük Gala\'yı mülklerinden birinde düzenle, kirası iki katına çıksın.',
    info_worldTour: '{m} öde, istediğin kareye uç.', info_chance: 'Bir Şans kartı çek.', info_tax: 'Servetinin %{n} kadarını öde.',
    doubles: 'ÇİFT!', fortune: 'Şans', wins: '{p} kazandı!', bankrupt: 'İflas', backToMenu: 'Ana menüye dön',
    r_triple: 'Üçlü Tekel', r_line: 'Hat Tekeli', r_resort: 'Tatil Tekeli', r_last: 'Ayakta Kalan Son Oyuncu', r_richest: '{n} tur sonunda en zengin',
    levels: ['Arsa', 'Villa', 'Kule', 'Otel', 'Simge Yapı'],
    groups: ['Yosunlu', 'Kumullar', 'Göller', 'Bozkır', 'Yaylalar', 'Orman', 'Metropol', 'Başkentler'],
    tiles: { start: 'Başlangıç', island: 'Issız Ada', festival: 'Büyük Gala', worldTour: 'Zeplin İskelesi', chance: 'Şans', tax: 'Gümrük' },
    l_sell: '{p}, {tile} mülkünü {m} karşılığında sattı.', l_bankrupt: '{p} iflas etti!', l_bankruptTo: '{p} iflas etti ({o} oyuncusuna borçluydu)!',
    l_salary: '{p} Başlangıç\'tan geçti ve {m} aldı.', l_island: '{p} Issız Ada\'da mahsur kaldı.',
    l_payIsland: '{p} adadan çıkmak için {m} ödedi.', l_stay: '{p} adada kaldı.', l_sailNext: '{p} sonraki tur adadan ayrılacak.',
    l_escape: '{p} çift attı ve kaçtı!', l_threeDoubles: '{p} üst üste üç kez çift attı.', l_again: 'Çift! {p} tekrar atıyor.',
    l_tax: '{p} {m} gümrük vergisi ödedi.', l_buyResort: '{p}, {tile} tatil yerini {m} karşılığında aldı.', l_buy: '{p}, {tile} şehrini {m} karşılığında aldı.',
    l_buyWith: '{p}, {tile} şehrini {lv} ile birlikte {m} karşılığında aldı.', l_shield: '{p} Kira Kalkanı ile kirayı ödemedi!', l_coupon: '{p} Yarı Fiyat Kuponu kullandı.',
    l_rent: '{p}, {tile} için {o} oyuncusuna {m} kira ödedi.', l_buyout: '{p}, {tile} şehrini {o} oyuncusundan {m} karşılığında satın aldı!', l_build: '{p}, {tile} şehrine {m} karşılığında {lv} inşa etti.',
    l_free: '{p}, {tile} şehrinde bedava {lv} kazandı.', l_gala: '{p} Büyük Gala\'yı {tile} şehrinde düzenliyor: kira iki katı!', l_fly: '{p}, {tile} karesine uçtu.',
    l_card: '{p} "{card}" kartını çekti.', l_noQuake: 'Hiçbir şehir etkilenmedi.', l_quake: 'Deprem {tile} şehrini sarstı; seviyesi {lv} oldu.',
  };

  const CARDS = {
    en: Object.fromEntries(D.CARDS.map((c) => [c.id, [c.title, c.text]])),
    tr: {
      tailwind: ['Arka Rüzgâr', 'Başlangıç karesine ilerle.'],
      boom: ['Turizm Patlaması', '$150 al.'],
      inherit: ['Miras', '$300 al.'],
      badinvest: ['Kötü Yatırım', '$100 öde.'],
      storm: ['Fırtına Uyarısı', 'Issız Ada\'ya git.'],
      voucher: ['Seyahat Kuponu', 'Zeplin İskelesi\'ne git.'],
      shield: ['Kira Kalkanı', 'Ödeyeceğin bir sonraki kira silinir.'],
      coupon: ['Yarı Fiyat Kuponu', 'Ödeyeceğin bir sonraki kira yarıya iner.'],
      gala: ['Gala Düzenle', 'Şehirlerinden birini Büyük Gala için seç.'],
      quake: ['Deprem', 'Bir rakip şehrin seviyesini bir düşür (simge yapılar hariç).'],
      charity: ['Bağış Kampanyası', 'Diğer her oyuncuya $50 öde.'],
      birthday: ['Doğum Günü', 'Diğer her oyuncu sana $50 öder.'],
      repairs: ['Tamirat', 'Sahip olduğun her bina seviyesi için $25 öde.'],
      taxi: ['Yanlış Yol', '3 kare geri git.'],
    },
  };

  const DICTS = { en, tr };
  let lang = 'en';

  function tileName(l, id) {
    const t = D.TILES[id];
    if (!t) return '';
    return (DICTS[l].tiles && DICTS[l].tiles[t.type]) || t.name;
  }

  function tFor(l, key, params) {
    const dict = DICTS[l] || en;
    let s = key in dict ? dict[key] : en[key];
    if (typeof s !== 'string') return s == null ? key : s;
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, (_, k) => {
      const v = params[k];
      if (v == null) return '';
      if (k === 'm' || k === 'cost') return fmt(v);
      if (k === 'lv') return dict.levels[v];
      if (k === 'tile') return tileName(l, v);
      if (k === 'card') return (CARDS[l] || CARDS.en)[v][0];
      return String(v);
    });
  }

  // Win reasons come from the engine in English; map them to keys.
  function reasonFor(l, reason) {
    const map = { 'Triple Monopoly': 'r_triple', 'Line Monopoly': 'r_line', 'Resort Monopoly': 'r_resort', 'Last One Standing': 'r_last' };
    if (map[reason]) return tFor(l, map[reason]);
    const m = /(\d+)/.exec(reason || '');
    return m ? tFor(l, 'r_richest', { n: m[1] }) : reason;
  }

  return {
    get lang() { return lang; },
    setLang(l) { lang = DICTS[l] ? l : 'en'; },
    t: (key, params) => tFor(lang, key, params),
    tFor,
    tileName: (id) => tileName(lang, id),
    groupName: (g) => (DICTS[lang].groups || en.groups)[g],
    levelName: (lv) => (DICTS[lang].levels || en.levels)[lv],
    card: (id) => (CARDS[lang] || CARDS.en)[id],
    reason: (r) => reasonFor(lang, r),
    langs: ['en', 'tr'],
  };
});
