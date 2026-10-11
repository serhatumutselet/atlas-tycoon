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

  // Each group is a country; its cities sit next to each other on the board.
  const GROUPS = [
    { name: 'Egypt', color: '#c9a14a', price: 60 },
    { name: 'Brazil', color: '#2e9e5b', price: 90 },
    { name: 'India', color: '#e2823a', price: 120 },
    { name: 'Turkey', color: '#d8434b', price: 150 },
    { name: 'Spain', color: '#8e5bd0', price: 180 },
    { name: 'Japan', color: '#e05b8f', price: 220 },
    { name: 'United Kingdom', color: '#3d7fc4', price: 260 },
    { name: 'USA', color: '#2c3f86', price: 320 },
  ];

  const c = (name, group, bump) => ({ type: 'city', name, group, price: Math.round(GROUPS[group].price * (bump ? 1.1 : 1) / 10) * 10 });
  const r = (name) => ({ type: 'resort', name, price: 200 });
  const s = (type, name) => ({ type, name });

  // 32 tiles, clockwise from Departure. Each side has 7 tiles between corners.
  const LAYOUT = [
    s('start', 'Departure'),
    c('Alexandria', 0), c('Cairo', 0, true), s('chance', 'Fortune'), c('Salvador', 1), c('São Paulo', 1), c('Rio de Janeiro', 1, true), r('Bali'),
    s('island', 'Castaway Isle'),
    c('Bangalore', 2), c('Delhi', 2), c('Mumbai', 2, true), r('Maldives'), c('Izmir', 3), c('Istanbul', 3, true), s('chance', 'Fortune'),
    s('festival', 'Grand Gala'),
    c('Seville', 4), c('Barcelona', 4), c('Madrid', 4, true), s('chance', 'Fortune'), c('Osaka', 5), c('Tokyo', 5, true), r('Santorini'),
    s('worldTour', 'Airship Dock'),
    c('Manchester', 6), c('Edinburgh', 6), c('London', 6, true), r('Bodrum'), s('tax', 'Customs'), c('Los Angeles', 7), c('New York', 7, true),
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
