/**
 * Astro – obliczenia położenia Słońca i Księżyca (algorytmy niskiej precyzji,
 * na podstawie formuł używanych w bibliotece SunCalc / "Astronomical Algorithms").
 * Dokładność rzędu kilku minut – w zupełności wystarcza do prognozy brań.
 */
const Astro = (() => {
  const PI = Math.PI;
  const rad = PI / 180;
  const dayMs = 86400000;
  const J1970 = 2440588;
  const J2000 = 2451545;
  const e = rad * 23.4397; // nachylenie ekliptyki

  const toJulian = (ms) => ms / dayMs - 0.5 + J1970;
  const toDays = (ms) => toJulian(ms) - J2000;

  const rightAscension = (l, b) =>
    Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const declination = (l, b) =>
    Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  const altitude = (H, phi, dec) =>
    Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const siderealTime = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;

  function sunCoords(d) {
    const M = rad * (357.5291 + 0.98560028 * d);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const P = rad * 102.9372;
    const L = M + C + P + PI;
    return { dec: declination(L, 0), ra: rightAscension(L, 0) };
  }

  function moonCoords(d) {
    const L = rad * (218.316 + 13.176396 * d);
    const M = rad * (134.963 + 13.064993 * d);
    const F = rad * (93.272 + 13.22935 * d);
    const l = L + rad * 6.289 * Math.sin(M);
    const b = rad * 5.128 * Math.sin(F);
    const dist = 385001 - 20905 * Math.cos(M);
    return { ra: rightAscension(l, b), dec: declination(l, b), dist };
  }

  const wrapPi = (a) => {
    a = (a + PI) % (2 * PI);
    if (a < 0) a += 2 * PI;
    return a - PI;
  };

  /** Wysokość Słońca nad horyzontem w stopniach. */
  function sunAltitude(ms, lat, lng) {
    const lw = rad * -lng;
    const phi = rad * lat;
    const d = toDays(ms);
    const c = sunCoords(d);
    const H = siderealTime(d, lw) - c.ra;
    return altitude(H, phi, c.dec) / rad;
  }

  /** Pozycja Księżyca: wysokość (stopnie) i kąt godzinny (rad, -π..π). */
  function moonPosition(ms, lat, lng) {
    const lw = rad * -lng;
    const phi = rad * lat;
    const d = toDays(ms);
    const c = moonCoords(d);
    const H = wrapPi(siderealTime(d, lw) - c.ra);
    return { altitude: altitude(H, phi, c.dec) / rad, hourAngle: H };
  }

  /** Oświetlenie tarczy (0..1) i faza (0 = nów, 0.5 = pełnia, 1 = nów). */
  function moonIllumination(ms) {
    const d = toDays(ms);
    const s = sunCoords(d);
    const m = moonCoords(d);
    const sdist = 149598000;
    const phi = Math.acos(
      Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra)
    );
    const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
    const angle = Math.atan2(
      Math.cos(s.dec) * Math.sin(s.ra - m.ra),
      Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra)
    );
    return {
      fraction: (1 + Math.cos(inc)) / 2,
      phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / PI,
    };
  }

  function moonPhaseName(phase) {
    const names = [
      [0.03, 'Nów', '🌑'],
      [0.22, 'Przybywający sierp', '🌒'],
      [0.28, 'Pierwsza kwadra', '🌓'],
      [0.47, 'Przybywający garb', '🌔'],
      [0.53, 'Pełnia', '🌕'],
      [0.72, 'Ubywający garb', '🌖'],
      [0.78, 'Ostatnia kwadra', '🌗'],
      [0.97, 'Ubywający sierp', '🌘'],
      [1.01, 'Nów', '🌑'],
    ];
    for (const [lim, name, icon] of names) if (phase < lim) return { name, icon };
    return { name: 'Nów', icon: '🌑' };
  }

  /**
   * Okresy solunarne w przedziale [startMs, endMs]:
   *  - główne (major): górowanie i dołowanie Księżyca (±1 h),
   *  - mniejsze (minor): wschód i zachód Księżyca (±45 min).
   */
  function solunarEvents(startMs, endMs, lat, lng) {
    const step = 5 * 60 * 1000;
    const events = [];
    let prev = moonPosition(startMs - step, lat, lng);
    for (let t = startMs; t <= endMs; t += step) {
      const cur = moonPosition(t, lat, lng);
      // Górowanie: kąt godzinny przechodzi przez 0 (rosnąco)
      if (prev.hourAngle < 0 && cur.hourAngle >= 0) events.push({ type: 'major', kind: 'Górowanie Księżyca', t });
      // Dołowanie: kąt godzinny "przeskakuje" z +π na -π
      if (prev.hourAngle > 2 && cur.hourAngle < -2) events.push({ type: 'major', kind: 'Dołowanie Księżyca', t });
      // Wschód / zachód (z poprawką na paralaksę i refrakcję ~ +0.13°)
      const h0 = 0.13;
      if (prev.altitude < h0 && cur.altitude >= h0) events.push({ type: 'minor', kind: 'Wschód Księżyca', t });
      if (prev.altitude >= h0 && cur.altitude < h0) events.push({ type: 'minor', kind: 'Zachód Księżyca', t });
      prev = cur;
    }
    return events;
  }

  return { sunAltitude, moonPosition, moonIllumination, moonPhaseName, solunarEvents };
})();

if (typeof module !== 'undefined') module.exports = Astro;
