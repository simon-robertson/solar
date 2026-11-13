// Physical values: NASA/JPL Solar System Dynamics. Display sizes/distances are
// deliberately compressed independently; this is an illustrative orrery.
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const BODY_FLOATS = 24; // Six vec4s, 96 bytes; matches Body in scene.wgsl.
export const BODIES = [
  { name: "Sun", kind: "G2V · MAIN SEQUENCE STAR", texture: "2k_sun.jpg", color: "#f8bc69", radius: 2.5, km: 695700, orbit: 0, au: 0, period: 0, day: 25.05, tilt: 7.25, atmo: [1,.33,.06,0], description: "The star at the centre of it all. A sphere of incandescent plasma, holding eight planets and countless smaller worlds in its gravitational embrace.", fact: "Light from the Sun takes about eight minutes to reach Earth." },
  { name: "Mercury", kind: "01 / TERRESTRIAL PLANET", texture: "2k_mercury.jpg", color: "#b8aaa0", radius: .32, km: 2439.4, orbit: 5.5, au: .387, period: 87.969, day: 58.6462, tilt: .034, atmo: [0,0,0,0], description: "Small, cratered and impossibly close to the Sun. Mercury races through its short year beneath a sky with almost no atmosphere.", fact: "A solar day here lasts longer than a Mercurian year." },
  { name: "Venus", kind: "02 / TERRESTRIAL PLANET", texture: "2k_venus_atmosphere.jpg", color: "#dbc59a", radius: .55, km: 6051.8, orbit: 8, au: .723, period: 224.701, day: -243.018, tilt: 2.64, atmo: [.9,.55,.2,.018], description: "A world wrapped in thick, pale clouds. Beneath its beautiful veil lies a crushing atmosphere and the hottest surface of any planet.", fact: "Venus rotates in the opposite direction to most planets." },
  { name: "Earth", kind: "03 / TERRESTRIAL PLANET", texture: "2k_earth_daymap.jpg", color: "#83c7ec", radius: .6, km: 6371.0084, orbit: 10.5, au: 1, period: 365.256, day: .99726968, tilt: 23.439, atmo: [.12,.42,1,.045], description: "Our pale blue home. Liquid oceans, drifting clouds and a thin atmosphere shelter the only life we know in the universe.", fact: "Earth is the only planet with liquid oceans on its surface." },
  { name: "Mars", kind: "04 / TERRESTRIAL PLANET", texture: "2k_mars.jpg", color: "#d58a6e", radius: .43, km: 3389.5, orbit: 13.5, au: 1.524, period: 686.98, day: 1.02595676, tilt: 25.19, atmo: [.9,.25,.07,.013], description: "A rust-coloured desert with a remarkable past. Ancient riverbeds and polar ice hint at a time when water flowed across this quiet world.", fact: "Olympus Mons is the tallest volcano in the solar system." },
  { name: "Jupiter", kind: "05 / GAS GIANT", texture: "2k_jupiter.jpg", color: "#d9b397", radius: 1.65, km: 69911, orbit: 19, au: 5.203, period: 4332.59, day: .41354, tilt: 3.13, atmo: [.6,.39,.22,.015], description: "The giant of our planetary family. Bands of turbulent clouds encircle a world with no solid surface, watched over by a centuries-old storm.", fact: "The Great Red Spot is a storm wider than Earth." },
  { name: "Saturn", kind: "06 / GAS GIANT", texture: "2k_saturn.jpg", color: "#e8d1a0", radius: 1.38, km: 58232, orbit: 26, au: 9.537, period: 10759.22, day: .44401, tilt: 26.73, atmo: [.7,.5,.25,.015], description: "A world wearing a halo of ice. Saturn’s extraordinary rings are made of countless fragments, from grains of dust to mountain-sized pieces.", fact: "Saturn’s average density is lower than that of water." },
  { name: "Uranus", kind: "07 / ICE GIANT", texture: "2k_uranus.jpg", color: "#a0dfe2", radius: .92, km: 25362, orbit: 33, au: 19.189, period: 30685.4, day: .71833, tilt: 97.77, atmo: [.1,.7,.8,.035], description: "A quiet, blue-green giant tipped onto its side. Methane in its cold atmosphere absorbs red light, leaving its distinctive cyan glow.", fact: "Uranus rolls around the Sun with an axial tilt of almost 98°." },
  { name: "Neptune", kind: "08 / ICE GIANT", texture: "2k_neptune.jpg", color: "#6c96e3", radius: .89, km: 24622, orbit: 40, au: 30.07, period: 60189, day: .67125, tilt: 28.32, atmo: [.12,.3,.95,.035], description: "Cold, distant and restless. Beyond the other planets, Neptune’s deep blue atmosphere is swept by some of the fastest winds ever measured.", fact: "One Neptunian year lasts about 165 Earth years." },
  { name: "Moon", kind: "EARTH’S NATURAL SATELLITE", texture: "2k_moon.jpg", color: "#c2c2bf", radius: .164, km: 1737.4, orbit: 1.8, au: .00257, period: 27.3217, day: 27.3217, tilt: 6.68, atmo: [0,0,0,0], description: "Our constant companion. Its ancient, impact-scarred surface records billions of years of history, always keeping the same face toward Earth.", fact: "The Moon moves about 3.8 centimetres farther from Earth each year." },
];

// JPL Table 1: a, e, I, mean longitude, longitude of perihelion, ascending node,
// then their rates per Julian century. Epoch J2000, range 1800–2050.
// Earth's row is the Earth–Moon barycentre, used here as Earth's approximation.
export const ELEMENTS = [
  null,
  [.38709927,.20563593,7.00497902,252.2503235,77.45779628,48.33076593,.00000037,.00001906,-.00594749,149472.67411175,.16047689,-.12534081],
  [.72333566,.00677672,3.39467605,181.9790995,131.60246718,76.67984255,.0000039,-.00004107,-.0007889,58517.81538729,.00268329,-.27769418],
  [1.00000261,.01671123,-.00001531,100.46457166,102.93768193,0,.00000562,-.00004392,-.01294668,35999.37244981,.32327364,0],
  [1.52371034,.0933941,1.84969142,-4.55343205,-23.94362959,49.55953891,.00001847,.00007882,-.00813131,19140.30268499,.44441088,-.29257343],
  [5.202887,.04838624,1.30439695,34.39644051,14.72847983,100.47390909,-.00011607,-.00013253,-.00183714,3034.74612775,.21252668,.20469106],
  [9.53667594,.05386179,2.48599187,49.95424423,92.59887831,113.66242448,-.0012506,-.00050991,.00193609,1222.49362201,-.41897216,-.28867794],
  [19.18916464,.04725744,.77263783,313.23810451,170.9542763,74.01692503,-.00196176,-.00004397,-.00242939,428.48202785,.40805281,.04240589],
  [30.06992276,.00859048,1.77004347,-55.12002969,44.96476227,131.78422574,.00026291,.00005105,.00035372,218.45945325,-.32241464,-.00508664],
];
