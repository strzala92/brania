/* global Chart, Weather, FishModel, Astro */
(() => {
  const $ = (s) => document.querySelector(s);
  const SPECIES = FishModel.SPECIES;
  const KEYS = Object.keys(SPECIES);
  const DAY_SHORT = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];
  const DAY_LONG = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];
  const DEFAULT_LOC = { name: 'Warszawa', admin: 'Mazowieckie, Polska', lat: 52.2297, lon: 21.0122 };

  const state = {
    loc: JSON.parse(localStorage.getItem('fish.loc') || 'null') || DEFAULT_LOC,
    days: Number(localStorage.getItem('fish.days') || 5),
    data: null,
    res: null,
    charts: {},
    selected: 0,
  };

  // ---------- Formatowanie czasu (w strefie czasowej łowiska) ----------
  const ld = (ts) => new Date(ts + state.data.utcOffset * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const hhmm = (ts) => { const d = ld(ts); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
  const dayShort = (ts) => DAY_SHORT[ld(ts).getUTCDay()];
  const dateShort = (ts) => { const d = ld(ts); return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}`; };
  const dayKey = (ts) => ld(ts).toISOString().slice(0, 10);
  const relDay = (ts) => {
    const diff = Math.round((Date.parse(dayKey(ts)) - Date.parse(dayKey(Date.now()))) / 86400000);
    return diff === 0 ? 'Dziś' : diff === 1 ? 'Jutro' : diff === 2 ? 'Pojutrze' : `${DAY_LONG[ld(ts).getUTCDay()]}`;
  };

  // ---------- Kolory ----------
  const STOPS = [[0, [30, 41, 59]], [22, [239, 68, 68]], [50, [234, 179, 8]], [78, [34, 197, 94]], [100, [22, 163, 74]]];
  function scoreColor(s, a = 1) {
    for (let i = 1; i < STOPS.length; i++) {
      if (s <= STOPS[i][0]) {
        const [x0, c0] = STOPS[i - 1];
        const [x1, c1] = STOPS[i];
        const t = (s - x0) / (x1 - x0);
        const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * t));
        return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
      }
    }
    return `rgba(22,163,74,${a})`;
  }
  const hexA = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  // ---------- Status ----------
  function setStatus(msg, isError = false) {
    const el = $('#status');
    if (!msg) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle('error', isError);
  }

  // ---------- Opisy czynników ----------
  function trendText(d3) {
    if (d3 <= -2.5) return ['szybko spada', 'trend-down', '⇊'];
    if (d3 <= -0.8) return ['spada', 'trend-down', '↓'];
    if (d3 >= 2.5) return ['szybko rośnie', 'trend-up', '⇈'];
    if (d3 >= 0.8) return ['rośnie', 'trend-up', '↑'];
    return ['stabilne', '', '→'];
  }
  function lightText(h) {
    if (h.sunAlt < -12) return 'noc';
    if (h.sunAlt < 0) return 'szarówka';
    if (h.light < 0.25) return 'mało światła';
    if (h.light < 0.55) return 'umiarkowane';
    return 'jasno';
  }
  const windDir = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
  const sign = (v, d = 1) => `${v > 0 ? '+' : ''}${v.toFixed(d)}`;

  function factorValue(k, h) {
    switch (k) {
      case 'pressureTrend': return `${sign(h.d3)} hPa/3h (${sign(h.d24, 0)}/24h)`;
      case 'pressureLevel': return `${h.pressure.toFixed(0)} hPa`;
      case 'light': return `${lightText(h)}, chmury ${h.cloud}%`;
      case 'twilight': return h.minToSunEvent < 120 ? `${Math.round(h.minToSunEvent)} min od wsch./zach. słońca` : 'z dala od świtu/zmierzchu';
      case 'wind': return `${h.wind.toFixed(1)} m/s ${windDir(h.windDir)}`;
      case 'waterTemp': return `~${h.waterTemp.toFixed(1)} °C`;
      case 'precip': return h.precip > 0 ? `${h.precip.toFixed(1)} mm/h` : 'bez opadów';
      case 'tempStability': return `${sign(h.tempDelta24)} °C/24h`;
      case 'solunar':
        if (h.minToMajor <= 60) return 'okres główny';
        if (h.minToMinor <= 45) return 'okres mniejszy';
        return Astro.moonPhaseName(h.moonPhase).name.toLowerCase();
      default: return '';
    }
  }

  function reasons(h, key) {
    const sp = SPECIES[key];
    const f = h.scores[key].factors;
    const items = Object.keys(sp.weights).map((k) => ({ k, impact: sp.weights[k] * (f[k] - 0.62), v: f[k] }));
    const pos = items.filter((i) => i.impact > 0.004).sort((a, b) => b.impact - a.impact).slice(0, 2);
    const neg = items.filter((i) => i.impact < -0.004).sort((a, b) => a.impact - b.impact).slice(0, 2);
    return { pos, neg };
  }

  // ---------- Plugin Chart.js: noc, okresy solunarne, "teraz", wybrana godzina ----------
  const bandsPlugin = {
    id: 'bands',
    beforeDatasetsDraw(chart, _args, opts) {
      const hours = opts.hours;
      if (!hours || !hours.length) return;
      const { ctx, chartArea: a, scales: { x } } = chart;
      const w = x.getPixelForValue(1) - x.getPixelForValue(0);
      const t0 = hours[0].ts;
      const px = (t) => x.getPixelForValue(0) + ((t - t0) / 3600000) * w;
      ctx.save();
      ctx.beginPath();
      ctx.rect(a.left, a.top, a.width, a.height);
      ctx.clip();

      // Noc: od zachodu do wschodu słońca
      const days = state.data.days;
      ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
      for (let i = -1; i < days.length; i++) {
        const from = i < 0 ? t0 - 86400000 : days[i].sunset;
        const to = i + 1 < days.length ? days[i + 1].sunrise : from + 12 * 3600000;
        ctx.fillRect(px(from), a.top, px(to) - px(from), a.height);
      }

      // Okresy solunarne
      if (opts.solunar) {
        state.res.solunar.forEach((e) => {
          const half = e.type === 'major' ? 60 : 45;
          ctx.fillStyle = e.type === 'major' ? 'rgba(250, 204, 21, 0.16)' : 'rgba(250, 204, 21, 0.07)';
          const l = px(e.t - half * 60000);
          ctx.fillRect(l, a.top, px(e.t + half * 60000) - l, a.height);
        });
      }

      // Wybrana godzina
      if (opts.selected != null) {
        const sx = x.getPixelForValue(opts.selected);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(sx, a.top); ctx.lineTo(sx, a.bottom); ctx.stroke();
        ctx.setLineDash([]);
      }

      // Teraz
      const nx = px(Date.now());
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(nx, a.top); ctx.lineTo(nx, a.bottom); ctx.stroke();
      ctx.restore();
    },
  };
  Chart.register(bandsPlugin);
  Chart.defaults.color = '#8ba5bb';
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.borderColor = 'rgba(120,170,210,0.10)';

  function xAxis(hours) {
    return {
      ticks: {
        autoSkip: false,
        maxRotation: 0,
        callback: (_v, i) => {
          const h = hours[i];
          if (!h) return '';
          const hr = ld(h.ts).getUTCHours();
          if (hr === 0) return [`${dayShort(h.ts)} ${dateShort(h.ts)}`];
          if (hr === 12 && hours.length <= 24 * 8) return '12:00';
          return '';
        },
      },
      grid: {
        color: (c) => (hours[c.index] && ld(hours[c.index].ts).getUTCHours() === 0 ? 'rgba(120,170,210,0.28)' : 'transparent'),
      },
    };
  }

  function baseOptions(hours, extra = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { usePointStyle: true, boxWidth: 8 } },
        bands: { hours, selected: state.selected },
        tooltip: {
          backgroundColor: 'rgba(10,22,34,0.95)',
          borderColor: 'rgba(120,170,210,0.3)',
          borderWidth: 1,
          padding: 10,
          callbacks: { title: (items) => { const h = hours[items[0].dataIndex]; return `${relDay(h.ts)} ${dateShort(h.ts)}, ${hhmm(h.ts)}`; } },
        },
      },
      scales: { x: xAxis(hours) },
      onClick: (_e, els, chart) => {
        const pos = chart.scales.x.getValueForPixel(_e.x);
        const idx = els.length ? els[0].index : Math.round(pos);
        if (idx >= 0 && idx < hours.length) selectHour(idx);
      },
      ...extra,
    };
  }

  function makeChart(id, config) {
    if (state.charts[id]) state.charts[id].destroy();
    state.charts[id] = new Chart(document.getElementById(id), config);
  }

  // ---------- Renderowanie ----------
  function renderLocation() {
    const { loc, data } = state;
    $('#locationName').textContent = `📍 ${loc.name}`;
    $('#locationMeta').textContent = `${loc.admin ? loc.admin + ' · ' : ''}${data.lat.toFixed(3)}°, ${data.lon.toFixed(3)}° · ${data.timezone}`;
  }

  function renderWeatherNow() {
    const h = state.res.hours[0];
    const [desc, icon] = Weather.describeCode(h.code);
    const [tTxt, tCls, tArr] = trendText(h.d3);
    const moon = Astro.moonPhaseName(h.moonPhase);
    const today = state.data.days.find((d) => dayKey(d.sunrise) === dayKey(h.ts)) || state.data.days[0];
    const cards = [
      ['Pogoda', `${icon} ${h.temp.toFixed(1)} °C`, desc],
      ['Ciśnienie', `${h.pressure.toFixed(0)} hPa <span class="${tCls}">${tArr}</span>`, `${tTxt} (${sign(h.d3)} hPa/3h, ${sign(h.d24, 0)}/24h)`],
      ['Zachmurzenie', `${h.cloud}%`, `wilgotność ${h.humidity}%`],
      ['Wiatr', `${h.wind.toFixed(1)} m/s ${windDir(h.windDir)}`, `porywy ${h.gust.toFixed(0)} m/s`],
      ['Opady', `${h.precip.toFixed(1)} mm`, `szansa ${h.precipProb ?? 0}%`],
      ['Woda (szacunek)', `~${h.waterTemp.toFixed(1)} °C`, 'na podst. temp. z 5–7 dni'],
      ['Księżyc', `${moon.icon} ${Math.round(h.moonFraction * 100)}%`, moon.name],
      ['Słońce', `🌅 ${hhmm(today.sunrise)} · 🌇 ${hhmm(today.sunset)}`, 'wschód · zachód'],
    ];
    $('#weatherCards').innerHTML = cards
      .map(([l, v, s]) => `<div class="wc"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`)
      .join('');
  }

  function renderSpeciesNow() {
    const hours = state.res.hours;
    const h = hours[0];
    $('#speciesNow').innerHTML = KEYS.map((k) => {
      const sp = SPECIES[k];
      const s = Math.round(h.scores[k].score);
      const r = FishModel.rating(s);
      const { pos, neg } = reasons(h, k);
      const next = hours.slice(1, 25).reduce((b, x) => (x.scores[k].score > b.scores[k].score ? x : b), hours[1] || h);
      const li = [
        ...pos.map((p) => `<li><span class="plus">▲</span>${FishModel.FACTORS[p.k]}: ${factorValue(p.k, h)}</li>`),
        ...neg.map((p) => `<li><span class="minus">▼</span>${FishModel.FACTORS[p.k]}: ${factorValue(p.k, h)}</li>`),
      ].join('');
      return `
        <div class="card sp-card" style="--c:${sp.color}">
          <div class="sp-top"><span class="sp-name">${sp.name}</span><span class="sp-icon">${sp.icon}</span></div>
          <div class="sp-center">
            <div class="ring" style="--p:${s}"><div class="ring-inner"><div><div class="ring-val">${s}</div><div class="ring-lbl">/ 100</div></div></div></div>
            <span class="badge ${r.cls}">${r.label}</span>
          </div>
          <ul class="reasons">${li}</ul>
          <div class="next-peak">Szczyt w ciągu 24 h: <b>${relDay(next.ts)} ${hhmm(next.ts)}</b> (${Math.round(next.scores[k].score)} pkt)</div>
        </div>`;
    }).join('');
  }

  function renderActivityChart() {
    const hours = state.res.hours;
    const ctx = document.getElementById('activityChart').getContext('2d');
    const datasets = KEYS.map((k) => {
      const sp = SPECIES[k];
      const grad = ctx.createLinearGradient(0, 0, 0, 400);
      grad.addColorStop(0, hexA(sp.color, 0.28));
      grad.addColorStop(1, hexA(sp.color, 0));
      return {
        label: `${sp.icon} ${sp.name}`,
        data: hours.map((h) => Math.round(h.scores[k].score)),
        borderColor: sp.color,
        backgroundColor: grad,
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 5,
      };
    });
    const opts = baseOptions(hours);
    opts.plugins.bands.solunar = true;
    opts.plugins.tooltip.callbacks.label = (c) => ` ${c.dataset.label}: ${c.parsed.y} – ${FishModel.rating(c.parsed.y).label}`;
    opts.plugins.tooltip.callbacks.footer = (items) => {
      const h = hours[items[0].dataIndex];
      const [d] = Weather.describeCode(h.code);
      return [`${d}, ${h.temp.toFixed(1)} °C, ${h.pressure.toFixed(0)} hPa (${sign(h.d3)}/3h)`, `Chmury ${h.cloud}%, wiatr ${h.wind.toFixed(1)} m/s`];
    };
    opts.scales.y = {
      min: 0, max: 100,
      ticks: { stepSize: 20, callback: (v) => v },
      title: { display: true, text: 'Aktywność (0–100)' },
    };
    makeChart('activityChart', { type: 'line', data: { labels: hours.map((h) => h.ts), datasets }, options: opts });
  }

  function renderWeatherCharts() {
    const hours = state.res.hours;
    const labels = hours.map((h) => h.ts);
    const line = (label, data, color, extra = {}) => ({ label, data, borderColor: color, backgroundColor: hexA(color, 0.15), tension: 0.35, borderWidth: 2, pointRadius: 0, ...extra });

    makeChart('pressureChart', {
      type: 'line',
      data: { labels, datasets: [line('Ciśnienie (hPa)', hours.map((h) => h.pressure), '#a78bfa', { fill: true })] },
      options: baseOptions(hours, { scales: { x: xAxis(hours), y: { grace: 2 } } }),
    });
    makeChart('tempChart', {
      type: 'line',
      data: {
        labels,
        datasets: [
          line('Powietrze', hours.map((h) => h.temp), '#fb923c'),
          line('Woda (szac.)', hours.map((h) => +h.waterTemp.toFixed(1)), '#38bdf8', { borderDash: [6, 4] }),
        ],
      },
      options: baseOptions(hours),
    });
    makeChart('cloudChart', {
      data: {
        labels,
        datasets: [
          { type: 'line', ...line('Zachmurzenie (%)', hours.map((h) => h.cloud), '#94a3b8', { fill: true }), yAxisID: 'y' },
          { type: 'bar', label: 'Opady (mm)', data: hours.map((h) => h.precip), backgroundColor: 'rgba(56,189,248,0.8)', yAxisID: 'y1', barPercentage: 1, categoryPercentage: 1 },
        ],
      },
      options: baseOptions(hours, {
        scales: {
          x: xAxis(hours),
          y: { min: 0, max: 100, position: 'left' },
          y1: { min: 0, suggestedMax: 3, position: 'right', grid: { drawOnChartArea: false } },
        },
      }),
    });
    makeChart('windChart', {
      type: 'line',
      data: {
        labels,
        datasets: [
          line('Wiatr', hours.map((h) => h.wind), '#2dd4bf', { fill: true }),
          line('Porywy', hours.map((h) => h.gust), '#f472b6', { borderDash: [4, 4], borderWidth: 1.5 }),
        ],
      },
      options: baseOptions(hours, { scales: { x: xAxis(hours), y: { min: 0 } } }),
    });
  }

  function renderDetail() {
    const h = state.res.hours[state.selected];
    $('#detailTime').textContent = state.selected === 0 ? `teraz (${hhmm(h.ts)})` : `${relDay(h.ts)} ${dateShort(h.ts)}, ${hhmm(h.ts)}`;
    const [d, icon] = Weather.describeCode(h.code);
    $('#detailWeather').textContent = `${icon} ${d} · ${h.temp.toFixed(1)} °C · ${h.pressure.toFixed(0)} hPa · chmury ${h.cloud}% · wiatr ${h.wind.toFixed(1)} m/s`;
    $('#factorDetail').innerHTML = KEYS.map((k) => {
      const sp = SPECIES[k];
      const sc = h.scores[k];
      const r = FishModel.rating(sc.score);
      const rows = Object.keys(sp.weights)
        .sort((a, b) => sp.weights[b] - sp.weights[a])
        .map((f) => {
          const v = sc.factors[f];
          return `<div class="fbar" title="${factorValue(f, h)}">
            <span class="name">${FishModel.FACTORS[f]} <span class="w">×${Math.round(sp.weights[f] * 100)}%</span></span>
            <span class="track"><span class="fill" style="width:${Math.round(v * 100)}%;background:${scoreColor(v * 100)}"></span></span>
            <span class="v">${Math.round(v * 100)}</span>
          </div>`;
        }).join('');
      return `<div class="fd"><h4 style="color:${sp.color}">${sp.icon} ${sp.name} <span class="badge ${r.cls}">${Math.round(sc.score)} · ${r.label}</span></h4>${rows}</div>`;
    }).join('');
  }

  function renderWindows() {
    const hours = state.res.hours;
    $('#bestWindows').innerHTML = KEYS.map((k) => {
      const sp = SPECIES[k];
      const list = state.res.windows[k]
        .map((w) => `<div class="win" data-idx="${w.peakIdx}">
            <div><div class="when">${hhmm(w.startTs)} – ${hhmm(w.endTs)}</div><div class="day">${relDay(w.startTs)} ${dateShort(w.startTs)} · szczyt ${hhmm(w.peakTs)}</div></div>
            <div class="pk" style="color:${scoreColor(w.peak)}">${Math.round(w.peak)}</div>
          </div>`).join('');
      return `<div class="win-col" style="--c:${sp.color}"><h4>${sp.icon} ${sp.name}</h4>${list || '<p class="muted">Brak wyraźnych okien.</p>'}</div>`;
    }).join('');
    document.querySelectorAll('#bestWindows .win').forEach((el) =>
      el.addEventListener('click', () => { selectHour(Number(el.dataset.idx)); $('#activityChart').scrollIntoView({ behavior: 'smooth', block: 'center' }); })
    );
  }

  function renderHeatmap() {
    const hours = state.res.hours;
    const byDay = new Map();
    hours.forEach((h, i) => {
      const k = dayKey(h.ts);
      if (!byDay.has(k)) byDay.set(k, Array(24).fill(null));
      byDay.get(k)[ld(h.ts).getUTCHours()] = i;
    });
    let html = '<table><thead><tr><th></th>';
    for (let hr = 0; hr < 24; hr++) html += `<th>${pad(hr)}</th>`;
    html += '</tr></thead><tbody>';
    for (const [, idxs] of byDay) {
      const firstIdx = idxs.find((x) => x != null);
      const ts = hours[firstIdx].ts;
      html += `<tr class="day-row"><td colspan="25">${relDay(ts)} · ${dateShort(ts)}</td></tr>`;
      KEYS.forEach((k) => {
        const sp = SPECIES[k];
        html += `<tr><td class="lbl" style="color:${sp.color}">${sp.icon} ${sp.name}</td>`;
        idxs.forEach((i) => {
          if (i == null) { html += '<td class="cell empty"></td>'; return; }
          const s = hours[i].scores[k].score;
          html += `<td class="cell" data-idx="${i}" style="background:${scoreColor(s)}" title="${sp.name} ${hhmm(hours[i].ts)}: ${Math.round(s)} – ${FishModel.rating(s).label}">${s >= 65 ? Math.round(s) : ''}</td>`;
        });
        html += '</tr>';
      });
    }
    html += '</tbody></table>';
    $('#heatmap').innerHTML = html;
    document.querySelectorAll('#heatmap td.cell[data-idx]').forEach((el) =>
      el.addEventListener('click', () => selectHour(Number(el.dataset.idx)))
    );
  }

  function renderSpeciesInfo() {
    $('#speciesInfo').innerHTML = KEYS.map((k) => {
      const sp = SPECIES[k];
      return `<div style="--c:${sp.color}"><b>${sp.icon} ${sp.name}</b><br>${sp.description}</div>`;
    }).join('');
  }

  function selectHour(idx) {
    state.selected = idx;
    renderDetail();
    Object.values(state.charts).forEach((c) => {
      c.options.plugins.bands.selected = idx;
      c.update('none');
    });
  }

  function renderAll() {
    renderLocation();
    renderWeatherNow();
    renderSpeciesNow();
    renderActivityChart();
    renderDetail();
    renderWindows();
    renderHeatmap();
    renderWeatherCharts();
  }

  // ---------- Ładowanie danych ----------
  async function load(loc) {
    state.loc = loc;
    localStorage.setItem('fish.loc', JSON.stringify(loc));
    document.body.classList.add('loading');
    setStatus(`Pobieram pogodę dla: ${loc.name}…`);
    try {
      const data = await Weather.fetchForecast(loc.lat, loc.lon, state.days + 1);
      state.data = data;
      const res = FishModel.analyze(data, Date.now(), state.days * 24);
      state.res = res;
      state.selected = 0;
      renderAll();
      setStatus(null);
    } catch (e) {
      console.error(e);
      setStatus(`Nie udało się pobrać danych: ${e.message}`, true);
    } finally {
      document.body.classList.remove('loading');
    }
  }

  // ---------- Wyszukiwarka ----------
  let searchTimer = null;
  let results = [];
  const input = $('#cityInput');
  const list = $('#cityResults');

  function showResults(items) {
    results = items;
    if (!items.length) { list.hidden = true; return; }
    list.innerHTML = items.map((r, i) => `<li data-i="${i}">${r.name}<small>${r.admin} · ${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}</small></li>`).join('');
    list.hidden = false;
  }
  function pick(i) {
    const r = results[i];
    if (!r) return;
    list.hidden = true;
    input.value = '';
    load(r);
  }
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { list.hidden = true; return; }
    searchTimer = setTimeout(async () => {
      try { showResults(await Weather.searchCity(q)); } catch (e) { console.warn(e); }
    }, 300);
  });
  list.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) pick(Number(li.dataset.i)); });
  $('#searchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    if (!results.length) results = await Weather.searchCity(q);
    pick(0);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search-box')) list.hidden = true; });

  $('#geoBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { setStatus('Twoja przeglądarka nie obsługuje geolokalizacji.', true); return; }
    setStatus('Ustalam Twoją lokalizację…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        const name = (await Weather.reverseName(lat, lon)) || 'Moja lokalizacja';
        load({ name, admin: '', lat, lon });
      },
      (err) => setStatus(`Nie udało się ustalić lokalizacji (${err.message}). Wyszukaj miejscowość ręcznie.`, true),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
  });

  const daysSel = $('#daysSelect');
  daysSel.value = String(state.days);
  daysSel.addEventListener('change', () => {
    state.days = Number(daysSel.value);
    localStorage.setItem('fish.days', state.days);
    load(state.loc);
  });

  // Odświeżanie co 30 minut
  setInterval(() => state.loc && load(state.loc), 30 * 60 * 1000);

  renderSpeciesInfo();
  load(state.loc);
})();
