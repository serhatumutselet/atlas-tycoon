// Atlas Tycoon - static board, rules and card data.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ATData = api;
})(this, function () {
  const RULES = {
    startCash: 2000,
    salary: 300,
    islandFine: 100,
    islandTurns: 3,
    worldTourFee: 50,
    taxRate: 0.1,
    sellRate: 0.5,
    buyoutMult: 2,
    maxRounds: 40,
  };

  // Level 0 = plot, 1 = villa, 2 = tower, 3 = hotel, 4 = landmark.
  const LEVEL_NAMES = ['Plot', 'Villa', 'Tower', 'Hotel', 'Landmark'];
  const BUILD_MULT = [0, 0.5, 0.75, 1, 1.5];
  const RENT_MULT = [0.3, 0.9, 1.8, 3, 5];
  const RESORT_RENT = [50, 100, 200, 400];

  const GROUPS = [
    { name: 'Mossland', color: '#7a9e3d', price: 60 },
    { name: 'Dunes', color: '#d9a441', price: 90 },
    { name: 'Lakes', color: '#3d9bc4', price: 120 },
    { name: 'Steppe', color: '#a9744f', price: 150 },
    { name: 'Highlands', color: '#7d6bb8', price: 180 },
    { name: 'Jungle', color: '#2f9e6e', price: 220 },
    { name: 'Metro', color: '#d65a7a', price: 260 },
    { name: 'Capitals', color: '#c4422f', price: 320 },
  ];

  const c = (name, group, bump) => ({ type: 'city', name, group, price: Math.round(GROUPS[group].price * (bump ? 1.1 : 1) / 10) * 10 });
  const r = (name) => ({ type: 'resort', name, price: 200 });
  const s = (type, name) => ({ type, name });

  // 32 tiles, clockwise from Departure. Each side has 7 tiles between corners.
  const LAYOUT = [
    s('start', 'Departure'),
    c('Fernhollow', 0), r('Coral Beach'), c('Brackenby', 0, true), s('chance', 'Fortune'), c('Sunhaven', 1), c('Duneport', 1), c('Mirage Bay', 1, true),
    s('island', 'Castaway Isle'),
    c('Lakemoor', 2), c('Glassbrook', 2), s('chance', 'Fortune'), c('Reedwater', 2, true), r('Pine Lodge'), c('Windcrest', 3), c('Highplain', 3, true),
    s('festival', 'Grand Gala'),
    c('Stonegate', 4), s('chance', 'Fortune'), c('Crag End', 4), c('Ironpeak', 4, true), r('Aurora Springs'), c('Verdanta', 5), c('Mangrove Cove', 5, true),
    s('worldTour', 'Airship Dock'),
    c('Neon Row', 6), c('Skyhold', 6), r('Lagoon Isle'), c('Gildport', 6, true), s('tax', 'Customs'), c('Crownspire', 7), c('Aurelia', 7, true),
  ];
  const TILES = LAYOUT.map((t, id) => Object.assign({ id, side: Math.floor(id / 8) }, t));

  const CARDS = [
    { id: 'tailwind', title: 'Tailwind', text: 'Advance to Departure.' },
    { id: 'boom', title: 'Tourism Boom', text: 'Collect $150.' },
    { id: 'inherit', title: 'Inheritance', text: 'Collect $300.' },
    { id: 'badinvest', title: 'Bad Investment', text: 'Pay $100.' },
    { id: 'storm', title: 'Storm Warning', text: 'Go to Castaway Isle.' },
    { id: 'voucher', title: 'Travel Voucher', text: 'Go to the Airship Dock.' },
    { id: 'shield', title: 'Rent Shield', text: 'The next rent you owe is waived.' },
    { id: 'coupon', title: 'Half-Price Coupon', text: 'The next rent you owe is halved.' },
    { id: 'gala', title: 'Host a Gala', text: 'Pick one of your cities to host the Grand Gala.' },
    { id: 'quake', title: 'Earthquake', text: 'Knock one level off an opponent city (not a landmark).' },
    { id: 'charity', title: 'Charity Drive', text: 'Pay $50 to every other player.' },
    { id: 'birthday', title: 'Birthday', text: 'Every other player pays you $50.' },
    { id: 'repairs', title: 'Repairs', text: 'Pay $25 per building level you own.' },
    { id: 'taxi', title: 'Wrong Turn', text: 'Move back 3 spaces.' },
  ];

  const PLAYER_COLORS = ['#e8553d', '#2f7fd9', '#2eae6b', '#c9a227'];

  return { RULES, LEVEL_NAMES, BUILD_MULT, RENT_MULT, RESORT_RENT, GROUPS, TILES, CARDS, PLAYER_COLORS };
});
