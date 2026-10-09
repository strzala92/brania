/**
 * Model aktywności ryb drapieżnych (szczupak, okoń, sandacz).
 *
 * Każdy czynnik (ciśnienie, jego trend, światło, wiatr, temperatura wody, opady,
 * stabilność temperatury, świt/zmierzch, okresy solunarne) jest zamieniany na ocenę
 * 0..1 za pomocą krzywych specyficznych dla gatunku. Wynik to średnia ważona,
 * przeskalowana do 0..100. Krzywe oparte są na wiedzy wędkarskiej i biologii gatunków
 * – to model heurystyczny, nie gwarancja brań 🙂
 */
const FishModel = (() => {
  const Astro_ = typeof Astro !== 'undefined' ? Astro : require('./astro.js');

  /** Interpolacja liniowa po punktach [[x, y], ...] (posortowanych po x). */
  function interp(x, pts) {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return pts[pts.length - 1][1];
  }
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const gauss = (dt, sigma) => Math.exp(-0.5 * (dt / sigma) ** 2);

  // Wpływ zmiany ciśnienia w ciągu 24 h (wspólny): duży wzrost = wyż po froncie chłodnym.
  const PRESSURE_24H = [[-15, 0.75], [-8, 0.95], [-3, 1], [3, 1], [7, 0.85], [11, 0.7], [16, 0.55]];

  const FACTORS = {
    pressureTrend: 'Trend ciśnienia (3 h)',
    pressureLevel: 'Poziom ciśnienia',
    light: 'Światło (słońce + chmury)',
    twilight: 'Świt / zmierzch',
    wind: 'Wiatr',
    waterTemp: 'Temp. wody (szac.)',
    precip: 'Opady',
    tempStability: 'Stabilność temperatury',
    solunar: 'Księżyc (solunar)',
    windDir: 'Kierunek wiatru',
  };

  const GROUPS = {
    predator: { name: 'Drapieżniki', icon: '🦈' },
    white: { name: 'Białoryb', icon: '🐟' },
  };

  /**
   * Kierunek wiatru: ciepły S/SW/W pomaga, zimny N/NE/E szkodzi.
   * Przy słabym wietrze kierunek nie ma znaczenia (ocena neutralna 0.75).
   */
  function windDirScore(deg, speed) {
    const base = 0.7 + 0.3 * Math.cos(((deg - 225) * Math.PI) / 180); // SW = 1.0, NE = 0.4
    const w = clamp((speed - 0.5) / 2.5); // 0 przy ciszy, 1 od ~3 m/s
    return 0.75 * (1 - w) + base * w;
  }

  const SPECIES = {
    pike: {
      name: 'Szczupak',
      group: 'predator',
      icon: '🐊',
      color: '#22c55e',
      description:
        'Łowca wzrokowy, żeruje głównie w dzień. Najlepiej bierze przy pochmurnej pogodzie, lekkim wietrze i powoli spadającym ciśnieniu przed frontem.',
      weights: { pressureTrend: 0.22, pressureLevel: 0.05, light: 0.18, twilight: 0.1, wind: 0.12, waterTemp: 0.12, precip: 0.06, tempStability: 0.08, solunar: 0.07 },
      twilightSigma: 70,
      nightCurve: [[-12, 0.72], [-4, 0.88], [2, 1]],
      curves: {
        pressureTrend: [[-4, 0.5], [-2.5, 0.85], [-1.2, 1], [-0.5, 0.85], [0.5, 0.7], [1.2, 0.5], [2.5, 0.25], [4, 0.15]],
        pressureLevel: [[985, 0.6], [1000, 0.9], [1012, 1], [1020, 0.75], [1030, 0.5], [1040, 0.4]],
        light: [[0, 0.1], [0.08, 0.45], [0.2, 0.8], [0.4, 1], [0.6, 0.9], [0.8, 0.65], [1, 0.5]],
        wind: [[0, 0.4], [2, 0.7], [4, 1], [7, 0.9], [10, 0.55], [14, 0.2], [20, 0.05]],
        waterTemp: [[0, 0.3], [4, 0.5], [8, 0.8], [11, 1], [18, 1], [22, 0.65], [26, 0.35], [30, 0.2]],
        precip: [[0, 0.65], [0.1, 0.85], [1, 0.9], [2.5, 0.6], [5, 0.35], [10, 0.2]],
        tempStability: [[-12, 0.2], [-8, 0.35], [-4, 0.75], [-2, 1], [3, 1], [6, 0.85], [10, 0.6]],
      },
    },
    perch: {
      name: 'Okoń',
      group: 'predator',
      icon: '🐟',
      color: '#f59e0b',
      description:
        'Ryba stadna, aktywna w ciągu jasnego dnia – szczyty rano i po południu. Lubi stabilną pogodę i ciśnienie; nocą praktycznie nie żeruje.',
      weights: { pressureTrend: 0.15, pressureLevel: 0.08, light: 0.22, twilight: 0.08, wind: 0.08, waterTemp: 0.15, precip: 0.05, tempStability: 0.12, solunar: 0.07 },
      twilightSigma: 80,
      nightCurve: [[-12, 0.62], [-4, 0.82], [2, 1]],
      curves: {
        pressureTrend: [[-4, 0.4], [-2.5, 0.65], [-1.2, 0.85], [-0.4, 1], [0.4, 1], [1.2, 0.7], [2.5, 0.35], [4, 0.2]],
        pressureLevel: [[985, 0.45], [1000, 0.7], [1010, 0.95], [1018, 1], [1026, 0.85], [1035, 0.6]],
        light: [[0, 0.05], [0.08, 0.3], [0.2, 0.6], [0.4, 0.9], [0.6, 1], [0.8, 0.95], [1, 0.8]],
        wind: [[0, 0.6], [2, 0.9], [4, 1], [6, 0.8], [9, 0.5], [13, 0.2], [20, 0.05]],
        waterTemp: [[0, 0.2], [4, 0.35], [8, 0.6], [13, 0.9], [16, 1], [22, 1], [26, 0.7], [30, 0.4]],
        precip: [[0, 0.8], [0.1, 0.85], [1, 0.7], [2.5, 0.45], [5, 0.25], [10, 0.15]],
        tempStability: [[-12, 0.15], [-8, 0.3], [-4, 0.65], [-2, 0.95], [3, 1], [6, 0.95], [10, 0.75]],
      },
    },
    zander: {
      name: 'Sandacz',
      group: 'predator',
      icon: '🦈',
      color: '#60a5fa',
      description:
        'Ma oczy przystosowane do słabego światła – żeruje o zmierzchu, świcie i w nocy, a w dzień przy dużym zachmurzeniu i zmąconej wodzie. Wrażliwy na gwałtowne zmiany ciśnienia.',
      weights: { pressureTrend: 0.18, pressureLevel: 0.05, light: 0.22, twilight: 0.14, wind: 0.1, waterTemp: 0.12, precip: 0.04, tempStability: 0.08, solunar: 0.07 },
      twilightSigma: 90,
      curves: {
        pressureTrend: [[-4, 0.35], [-2.5, 0.6], [-1.2, 0.9], [-0.4, 1], [0.4, 0.95], [1.2, 0.6], [2.5, 0.3], [4, 0.15]],
        pressureLevel: [[985, 0.6], [1000, 0.85], [1008, 1], [1016, 0.95], [1025, 0.65], [1035, 0.45]],
        light: [[0, 0.75], [0.05, 0.95], [0.15, 1], [0.3, 0.8], [0.5, 0.45], [0.75, 0.2], [1, 0.1]],
        wind: [[0, 0.45], [2, 0.7], [4, 0.95], [6, 1], [9, 0.75], [13, 0.3], [20, 0.05]],
        waterTemp: [[0, 0.2], [4, 0.35], [8, 0.6], [12, 0.9], [15, 1], [22, 1], [26, 0.8], [30, 0.5]],
        precip: [[0, 0.7], [0.1, 0.9], [1, 0.9], [2.5, 0.6], [5, 0.4], [10, 0.2]],
        tempStability: [[-12, 0.2], [-8, 0.35], [-4, 0.7], [-2, 1], [3, 1], [6, 0.9], [10, 0.7]],
      },
    },

    // ======================= BIAŁORYB =======================
    // coldGate – mnożnik "progu termicznego": ryby ciepłolubne (karp, lin, karaś)
    // w zimnej wodzie praktycznie przestają żerować, czego sama średnia ważona nie oddaje.
    // spawn – szacowane tarło (miesiące + zakres temp. wody) → wyraźnie słabsze brania.
    bream: {
      name: 'Leszcz',
      group: 'white',
      icon: '🐡',
      color: '#cbd5e1',
      description:
        'Żeruje stadami przy dnie, najchętniej o zmierzchu, w nocy i przy pochmurnej pogodzie. Lubi umiarkowany, ciepły wiatr i stabilne lub lekko spadające ciśnienie; źle znosi jego gwałtowny wzrost.',
      weights: { pressureTrend: 0.16, pressureLevel: 0.06, light: 0.14, twilight: 0.12, wind: 0.08, windDir: 0.08, waterTemp: 0.18, precip: 0.04, tempStability: 0.08, solunar: 0.06 },
      twilightSigma: 90,
      coldGate: [[2, 0.75], [8, 1]],
      spawn: { months: [5, 6], temp: [14, 20] },
      curves: {
        pressureTrend: [[-4, 0.4], [-2.5, 0.65], [-1, 0.95], [0, 1], [1, 0.8], [2.5, 0.35], [4, 0.2]],
        pressureLevel: [[985, 0.55], [1000, 0.85], [1008, 1], [1018, 0.95], [1026, 0.7], [1035, 0.5]],
        light: [[0, 0.85], [0.05, 0.95], [0.15, 1], [0.3, 0.85], [0.5, 0.6], [0.75, 0.4], [1, 0.3]],
        wind: [[0, 0.5], [2, 0.75], [3, 1], [6, 1], [9, 0.65], [13, 0.3], [20, 0.05]],
        waterTemp: [[2, 0.15], [6, 0.3], [10, 0.55], [14, 0.8], [18, 1], [24, 1], [27, 0.8], [30, 0.55]],
        precip: [[0, 0.75], [0.1, 0.85], [1, 0.85], [2.5, 0.6], [5, 0.35], [10, 0.2]],
        tempStability: [[-12, 0.15], [-8, 0.3], [-4, 0.65], [-2, 0.95], [3, 1], [6, 0.95], [10, 0.8]],
      },
      baits: [
        { maxTemp: 10, bait: 'ochotka, czerwony robak, pinka', groundbait: 'mało, drobna i ciemna, z dodatkiem jokersa/ochotki' },
        { maxTemp: 16, bait: 'czerwony robak, białe robaki, kanapka robak + kukurydza', groundbait: 'umiarkowanie, słodkawa z pieczywem i konopiami' },
        { maxTemp: 99, bait: 'kukurydza, białe robaki, pellet 4–6 mm, kanapka', groundbait: 'obficie, słodka (wanilia/karmel) z pelletem i kukurydzą' },
      ],
    },
    roach: {
      name: 'Płoć',
      group: 'white',
      icon: '🐠',
      color: '#f87171',
      description:
        'Najbardziej "całoroczna" ryba białej – bierze nawet w zimnej wodzie. Aktywna w dzień przy umiarkowanym świetle, lubi stabilną pogodę; nagłe ochłodzenia wyraźnie ją usypiają.',
      weights: { pressureTrend: 0.14, pressureLevel: 0.06, light: 0.14, twilight: 0.1, wind: 0.08, windDir: 0.06, waterTemp: 0.16, precip: 0.06, tempStability: 0.12, solunar: 0.08 },
      twilightSigma: 80,
      nightCurve: [[-12, 0.8], [-4, 0.9], [2, 1]],
      spawn: { months: [4, 5], temp: [8, 14] },
      curves: {
        pressureTrend: [[-4, 0.4], [-2.5, 0.6], [-1, 0.9], [0, 1], [1, 0.9], [2.5, 0.45], [4, 0.25]],
        pressureLevel: [[985, 0.5], [1000, 0.8], [1010, 1], [1020, 0.95], [1030, 0.7], [1040, 0.5]],
        light: [[0, 0.25], [0.08, 0.5], [0.2, 0.8], [0.35, 1], [0.6, 0.95], [0.8, 0.8], [1, 0.65]],
        wind: [[0, 0.6], [2, 0.9], [3.5, 1], [5, 0.95], [8, 0.6], [12, 0.25], [20, 0.05]],
        waterTemp: [[0, 0.35], [4, 0.55], [8, 0.75], [12, 1], [20, 1], [24, 0.8], [28, 0.55]],
        precip: [[0, 0.75], [0.1, 0.85], [1, 0.8], [2.5, 0.55], [5, 0.3], [10, 0.15]],
        tempStability: [[-12, 0.15], [-8, 0.3], [-4, 0.6], [-2, 0.9], [3, 1], [6, 0.95], [10, 0.8]],
      },
      baits: [
        { maxTemp: 8, bait: 'ochotka, pinka (pojedynczo), czerwony robak', groundbait: 'bardzo mało, jasna i drobna lub sam joker' },
        { maxTemp: 16, bait: 'białe robaki, kastery, pęczak', groundbait: 'umiarkowanie, jasna z konopiami i pieczywem' },
        { maxTemp: 99, bait: 'pęczak, kastery, ziarno konopi, kukurydza', groundbait: 'często i małymi porcjami, jasna, słodka, z prażonymi konopiami' },
      ],
    },
    carp: {
      name: 'Karp',
      group: 'white',
      icon: '🎏',
      color: '#e879f9',
      description:
        'Ciepłolubny – najlepiej żeruje przy wodzie 19–26 °C, często nocą i o świcie. Lubi ciepły, południowo-zachodni wiatr spychający pokarm do brzegu oraz stabilne lub powoli spadające ciśnienie.',
      weights: { pressureTrend: 0.14, pressureLevel: 0.06, light: 0.1, twilight: 0.12, wind: 0.06, windDir: 0.1, waterTemp: 0.24, precip: 0.04, tempStability: 0.08, solunar: 0.06 },
      twilightSigma: 100,
      coldGate: [[4, 0.5], [8, 0.7], [13, 1]],
      spawn: { months: [5, 6, 7], temp: [18, 23] },
      curves: {
        pressureTrend: [[-4, 0.35], [-2.5, 0.6], [-1, 0.9], [0, 1], [1, 0.85], [2.5, 0.4], [4, 0.2]],
        pressureLevel: [[985, 0.6], [1000, 0.9], [1008, 1], [1016, 0.95], [1025, 0.7], [1035, 0.5]],
        light: [[0, 0.95], [0.1, 1], [0.3, 0.85], [0.6, 0.6], [1, 0.5]],
        wind: [[0, 0.55], [2, 0.85], [3, 1], [5, 1], [8, 0.7], [12, 0.35], [20, 0.1]],
        waterTemp: [[4, 0.05], [8, 0.2], [12, 0.5], [16, 0.8], [19, 1], [26, 1], [29, 0.75], [32, 0.5]],
        precip: [[0, 0.75], [0.1, 0.9], [1, 0.9], [2.5, 0.65], [5, 0.4], [10, 0.25]],
        tempStability: [[-12, 0.1], [-8, 0.25], [-4, 0.6], [-2, 0.95], [3, 1], [6, 1], [10, 0.85]],
      },
      baits: [
        { maxTemp: 12, bait: 'małe kulki 10–12 mm (rybne, pop-up), czerwony robak, kukurydza (oszczędnie)', groundbait: 'mało, drobna rybna, siatka PVA' },
        { maxTemp: 18, bait: 'kukurydza, kulki proteinowe, pellet', groundbait: 'umiarkowanie, z pelletem i kukurydzą' },
        { maxTemp: 99, bait: 'kulki 16–20 mm, pellet halibut, orzech tygrysi', groundbait: 'obficie, słodka/owocowa, pellet + kukurydza + ziarna' },
      ],
    },
    tench: {
      name: 'Lin',
      group: 'white',
      icon: '🟢',
      color: '#2dd4bf',
      description:
        'Ryba ciepłej wody i zarośniętych płycizn. Bierze głównie o świcie i wieczorem, przy ciszy lub słabym wietrze. Poniżej ~10 °C praktycznie przestaje żerować.',
      weights: { pressureTrend: 0.12, pressureLevel: 0.06, light: 0.14, twilight: 0.16, wind: 0.1, windDir: 0.06, waterTemp: 0.22, precip: 0.04, tempStability: 0.06, solunar: 0.04 },
      twilightSigma: 100,
      nightCurve: [[-12, 0.85], [-4, 0.95], [2, 1]],
      coldGate: [[4, 0.5], [10, 0.75], [15, 1]],
      spawn: { months: [6, 7], temp: [19, 24] },
      curves: {
        pressureTrend: [[-4, 0.3], [-2.5, 0.55], [-1, 0.85], [0, 1], [1, 0.9], [2.5, 0.45], [4, 0.25]],
        pressureLevel: [[985, 0.45], [1000, 0.75], [1010, 0.95], [1018, 1], [1026, 0.85], [1035, 0.6]],
        light: [[0, 0.6], [0.05, 0.85], [0.15, 1], [0.3, 0.85], [0.5, 0.55], [0.75, 0.35], [1, 0.25]],
        wind: [[0, 1], [2, 0.95], [4, 0.7], [7, 0.4], [10, 0.2], [15, 0.05]],
        waterTemp: [[4, 0], [8, 0.05], [10, 0.15], [14, 0.5], [18, 1], [25, 1], [28, 0.75], [31, 0.5]],
        precip: [[0, 0.8], [0.1, 0.9], [1, 0.8], [2.5, 0.5], [5, 0.3], [10, 0.15]],
        tempStability: [[-12, 0.1], [-8, 0.25], [-4, 0.55], [-2, 0.9], [3, 1], [6, 1], [10, 0.85]],
      },
      baits: [
        { maxTemp: 14, bait: 'czerwony robak, ochotka, białe robaki', groundbait: 'mało, ciemna, z siekanymi rosówkami/jokersem' },
        { maxTemp: 20, bait: 'czerwony robak, kukurydza, kastery', groundbait: 'umiarkowanie, ciemna, z kukurydzą i drobnym pelletem' },
        { maxTemp: 99, bait: 'kukurydza, rosówka, kanapka robak + kukurydza, mały pellet', groundbait: 'zanęć przed świtem, ciemna słodko-korzenna, kukurydza' },
      ],
    },
    crucian: {
      name: 'Karaś',
      group: 'white',
      icon: '🟡',
      color: '#facc15',
      description:
        'Wytrzymały i ciepłolubny – najlepiej bierze w ciepłe, spokojne dni i o świcie, przy stabilnym ciśnieniu. Przy zimnej wodzie i silnym wietrze żeruje słabo.',
      weights: { pressureTrend: 0.12, pressureLevel: 0.06, light: 0.14, twilight: 0.1, wind: 0.08, windDir: 0.06, waterTemp: 0.22, precip: 0.04, tempStability: 0.1, solunar: 0.08 },
      twilightSigma: 80,
      nightCurve: [[-12, 0.85], [-4, 0.95], [2, 1]],
      coldGate: [[4, 0.6], [10, 0.85], [14, 1]],
      spawn: { months: [5, 6, 7], temp: [17, 22] },
      curves: {
        pressureTrend: [[-4, 0.35], [-2.5, 0.55], [-1, 0.85], [0, 1], [1, 0.9], [2.5, 0.5], [4, 0.3]],
        pressureLevel: [[985, 0.5], [1000, 0.8], [1010, 1], [1020, 1], [1030, 0.75], [1040, 0.55]],
        light: [[0, 0.3], [0.08, 0.6], [0.2, 0.9], [0.35, 1], [0.6, 0.9], [0.8, 0.75], [1, 0.6]],
        wind: [[0, 0.9], [1.5, 1], [3, 0.95], [5, 0.7], [8, 0.4], [12, 0.15], [20, 0.05]],
        waterTemp: [[2, 0.05], [6, 0.2], [10, 0.45], [15, 0.8], [19, 1], [26, 1], [30, 0.8]],
        precip: [[0, 0.8], [0.1, 0.85], [1, 0.75], [2.5, 0.5], [5, 0.3], [10, 0.15]],
        tempStability: [[-12, 0.1], [-8, 0.25], [-4, 0.55], [-2, 0.9], [3, 1], [6, 1], [10, 0.85]],
      },
      baits: [
        { maxTemp: 12, bait: 'pinka, ochotka, czerwony robak', groundbait: 'mało, drobna, lekko słodka' },
        { maxTemp: 18, bait: 'białe robaki, ciasto, chleb', groundbait: 'umiarkowanie, słodka (wanilia) z pieczywem' },
        { maxTemp: 99, bait: 'ciasto, chleb, kukurydza, białe robaki', groundbait: 'regularnie, słodka, z kukurydzą i pieczywem' },
      ],
    },
  };

  /** Poziom światła pod wodą 0..1 (0 = noc, 1 = pełne słońce w zenicie, bez chmur). */
  function lightLevel(sunAlt, cloud, code, precip, moonLight) {
    let base;
    if (sunAlt <= -12) base = moonLight; // noc – tylko światło Księżyca
    else if (sunAlt <= 0) base = 0.02 + ((sunAlt + 12) / 12) * 0.18; // zmierzch cywilny/żeglarski
    else base = 0.2 + 0.8 * Math.min(1, Math.sin((sunAlt * Math.PI) / 180) / Math.sin(Math.PI / 4));
    let lvl = base * (1 - 0.65 * (cloud / 100));
    if (code === 45 || code === 48) lvl *= 0.6; // mgła
    if (precip > 0.5) lvl *= 0.8;
    return clamp(lvl);
  }

  /** Oblicza cechy pochodne dla wszystkich godzin (również historycznych). */
  function deriveFeatures(data) {
    const { hours, days, lat, lon } = data;
    const n = hours.length;

    // Szacowana temp. wody – wykładnicza średnia krocząca temp. powietrza (stała czasowa ~5 dni)
    const alpha = 1 - Math.exp(-1 / 120);
    const init = hours.slice(0, 72).reduce((s, h) => s + h.temp, 0) / Math.min(72, n);
    let water = init;

    const sunEvents = [];
    days.forEach((d) => sunEvents.push(d.sunrise, d.sunset));

    const solunar = Astro_.solunarEvents(hours[0].ts - 86400000, hours[n - 1].ts + 86400000, lat, lon);
    const majors = solunar.filter((e) => e.type === 'major').map((e) => e.t);
    const minors = solunar.filter((e) => e.type === 'minor').map((e) => e.t);
    const nearest = (arr, t) => arr.reduce((m, x) => Math.min(m, Math.abs(x - t)), Infinity) / 60000; // minuty

    hours.forEach((h, i) => {
      water += alpha * (h.temp - water);
      h.waterTemp = Math.max(0.5, water);
      h.d3 = i >= 3 ? h.pressure - hours[i - 3].pressure : 0;
      h.d24 = i >= 24 ? h.pressure - hours[i - 24].pressure : 0;
      h.tempDelta24 = i >= 24 ? h.temp - hours[i - 24].temp : 0;
      h.sunAlt = Astro_.sunAltitude(h.ts, lat, lon);
      const moon = Astro_.moonPosition(h.ts, lat, lon);
      const illum = Astro_.moonIllumination(h.ts);
      h.moonAlt = moon.altitude;
      h.moonFraction = illum.fraction;
      h.moonPhase = illum.phase;
      const moonLight = moon.altitude > 0 ? 0.05 * illum.fraction * Math.sin((Math.min(moon.altitude, 60) * Math.PI) / 180 + 0.3) : 0;
      h.light = lightLevel(h.sunAlt, h.cloud, h.code, h.precip, moonLight);
      h.minToSunEvent = nearest(sunEvents, h.ts);
      h.minToMajor = nearest(majors, h.ts);
      h.minToMinor = nearest(minors, h.ts);
    });

    return { solunar };
  }

  /** Oceny czynników 0..1 dla danej godziny i gatunku. */
  function factorScores(h, sp) {
    const c = sp.curves;
    // Nów i pełnia – lekko wzmocnione okresy solunarne
    const phaseBoost = 0.1 * Math.max(gauss(Math.min(h.moonPhase, 1 - h.moonPhase), 0.06), gauss(h.moonPhase - 0.5, 0.06));
    return {
      pressureTrend: interp(h.d3, c.pressureTrend) * interp(h.d24, PRESSURE_24H),
      pressureLevel: interp(h.pressure, c.pressureLevel),
      light: interp(h.light, c.light),
      twilight: 0.4 + 0.6 * gauss(h.minToSunEvent, sp.twilightSigma),
      wind: interp(h.wind, c.wind),
      waterTemp: interp(h.waterTemp, c.waterTemp),
      precip: interp(h.precip, c.precip),
      tempStability: interp(h.tempDelta24, c.tempStability),
      solunar: clamp(Math.max(0.35, gauss(h.minToMajor, 50), 0.8 * gauss(h.minToMinor, 35)) + phaseBoost),
      windDir: windDirScore(h.windDir, h.wind),
    };
  }

  /** Czy dla danej godziny prawdopodobne jest tarło (miesiąc lokalny + szac. temp. wody). */
  function isSpawning(h, sp) {
    if (!sp.spawn) return false;
    const month = Number(h.local.slice(5, 7));
    return sp.spawn.months.includes(month) && h.waterTemp >= sp.spawn.temp[0] && h.waterTemp <= sp.spawn.temp[1];
  }

  function scoreHour(h, sp) {
    const f = factorScores(h, sp);
    let raw = 0;
    let wsum = 0;
    for (const k in sp.weights) {
      raw += sp.weights[k] * f[k];
      wsum += sp.weights[k];
    }
    raw /= wsum;
    // Rytm dobowy – ryby żerujące wzrokowo w dzień (szczupak, okoń, płoć…) nocą słabną
    if (sp.nightCurve) raw *= interp(h.sunAlt, sp.nightCurve);
    // Próg termiczny – ryby ciepłolubne w zimnej wodzie prawie nie żerują
    if (sp.coldGate) raw *= interp(h.waterTemp, sp.coldGate);
    // Tarło – ryby zajęte rozrodem słabo biorą
    const spawning = isSpawning(h, sp);
    if (spawning) raw *= 0.55;
    // Twarde kary
    if (h.code >= 95) raw *= 0.5; // burza
    if (h.gust > 17) raw *= 0.75; // wichura
    const score = clamp((raw - 0.35) / 0.6) * 100;
    return { score, raw, factors: f, spawning };
  }

  /** Podpowiedź przynęty i zanęty dla gatunku przy danej temp. wody (null dla drapieżników). */
  function baitTips(key, waterTemp) {
    const sp = SPECIES[key];
    if (!sp || !sp.baits) return null;
    return sp.baits.find((b) => waterTemp <= b.maxTemp) || sp.baits[sp.baits.length - 1];
  }

  function rating(score) {
    if (score >= 80) return { label: 'Bardzo dobra', cls: 'r5' };
    if (score >= 65) return { label: 'Dobra', cls: 'r4' };
    if (score >= 45) return { label: 'Umiarkowana', cls: 'r3' };
    if (score >= 25) return { label: 'Słaba', cls: 'r2' };
    return { label: 'Bardzo słaba', cls: 'r1' };
  }

  /** Najlepsze okna czasowe (ciągłe godziny z wynikiem >= progu). */
  function bestWindows(hours, key, threshold = 60, limit = 6) {
    const windows = [];
    let cur = null;
    hours.forEach((h, i) => {
      const s = h.scores[key].score;
      if (s >= threshold) {
        if (!cur) cur = { start: i, end: i, peak: s, peakIdx: i, sum: 0, n: 0 };
        cur.end = i;
        cur.sum += s;
        cur.n++;
        if (s > cur.peak) { cur.peak = s; cur.peakIdx = i; }
      } else if (cur) {
        windows.push(cur);
        cur = null;
      }
    });
    if (cur) windows.push(cur);
    windows.forEach((w) => (w.avg = w.sum / w.n));
    windows.sort((a, b) => b.peak - a.peak);
    if (!windows.length && threshold > 40) return bestWindows(hours, key, threshold - 10, limit);
    return windows.slice(0, limit).map((w) => ({
      ...w,
      startTs: hours[w.start].ts,
      endTs: hours[w.end].ts + 3600000,
      peakTs: hours[w.peakIdx].ts,
    }));
  }

  /**
   * Główna funkcja: zwraca godziny prognozy (od bieżącej) z ocenami gatunków.
   */
  function analyze(data, nowMs = Date.now(), maxHours = Infinity) {
    const { solunar } = deriveFeatures(data);
    const keys = Object.keys(SPECIES);

    data.hours.forEach((h) => {
      h.scores = {};
      keys.forEach((k) => (h.scores[k] = scoreHour(h, SPECIES[k])));
    });

    // Delikatne wygładzenie (1-2-1), żeby uniknąć skoków godzina do godziny
    keys.forEach((k) => {
      const raw = data.hours.map((h) => h.scores[k].score);
      data.hours.forEach((h, i) => {
        const a = raw[Math.max(0, i - 1)];
        const b = raw[Math.min(raw.length - 1, i + 1)];
        h.scores[k].score = (a + 2 * raw[i] + b) / 4;
      });
    });

    const nowHour = Math.floor(nowMs / 3600000) * 3600000;
    let startIdx = data.hours.findIndex((h) => h.ts >= nowHour);
    if (startIdx < 0) startIdx = 0;
    const forecast = data.hours.slice(startIdx, startIdx + maxHours);

    const windows = {};
    keys.forEach((k) => {
      const sorted = forecast.map((h) => h.scores[k].score).sort((a, b) => a - b);
      const p80 = sorted[Math.floor(sorted.length * 0.8)] ?? 60;
      windows[k] = bestWindows(forecast, k, Math.max(55, p80));
    });

    return {
      hours: forecast,
      history: data.hours.slice(Math.max(0, startIdx - 24), startIdx),
      solunar: solunar.filter((e) => e.t >= forecast[0].ts - 3600000 && e.t <= forecast[forecast.length - 1].ts + 3600000),
      windows,
    };
  }

  return { SPECIES, FACTORS, GROUPS, analyze, rating, factorScores, baitTips };
})();

if (typeof module !== 'undefined') module.exports = FishModel;
