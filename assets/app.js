import * as M from './metrics.js';
import { fetchMarkets, fetchHistory } from './sources.js';

const BTC = 'btc-bitcoin';

const REFRESH_MS = 120_000;
const $ = id => document.getElementById(id);

const state = {
  coins: [],          // current market data, normalised
  source: null,       // 'live' | 'snapshot'
  updated: null,      // Date of the market data
  snapshot: null,     // { generated, coins: {id: {symbol, name, t, p, v, m}} } or null
  histories: new Map(),
  selected: location.hash.slice(1) || BTC,
  range: 365,
  sort: { key: 'rank', dir: 1 },
  query: '',
  hideStable: false,
};

// ---------------------------------------------------------------- formatting

const usd = (x, opts = {}) => {
  if (x == null || !isFinite(x)) return '–';
  if (x === 0) return '$0';
  const a = Math.abs(x);
  const digits = a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
  return '$' + x.toLocaleString('en-US', { minimumFractionDigits: opts.digits ?? digits, maximumFractionDigits: opts.digits ?? digits });
};
const big = x => {
  if (x == null || !isFinite(x)) return '–';
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [v, u] of units) if (Math.abs(x) >= v) return '$' + (x / v).toFixed(2) + u;
  return '$' + x.toFixed(0);
};
const pct = (x, digits = 1) => (x == null || !isFinite(x)) ? '–' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(digits) + '%';
const pctPlain = (x, digits = 1) => (x == null || !isFinite(x)) ? '–' : (x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(digits) + '%';
const cls = x => (x > 0 ? 'up' : x < 0 ? 'down' : '');
const num = (x, d = 2) => (x == null || !isFinite(x)) ? '–' : (x < 0 ? '−' : '') + Math.abs(x).toFixed(d);
const dateLabel = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- data

async function getJSON(url, timeout = 12_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    return await r.json();
  } finally { clearTimeout(t); }
}

/** Fill in what the live ticker lacks (30-day and 1-year change, sparkline) from saved history,
 *  and confirm stablecoins by their measured volatility. */
function enrich(c) {
  const h = state.snapshot?.coins[c.id] || state.histories.get(c.id);
  if (h && h.p.length > 31) {
    const p = h.p, last = c.price ?? p[p.length - 1];
    c.ch30 = last / p[p.length - 31] - 1;
    c.ch1y = p.length > 360 ? last / p[0] - 1 : null;
    c.spark = p.slice(-8);
    if (c.kind === 'coin' && M.isStable(p)) c.kind = 'stable';
  }
  c.spark ||= [];
  return c;
}

async function loadSnapshot() {
  try {
    const [markets, history] = await Promise.all([getJSON('data/markets.json'), getJSON('data/history.json')]);
    state.snapshot = history;
    return markets;
  } catch { return null; }
}

async function loadMarkets(snapshotMarkets) {
  try {
    state.coins = await fetchMarkets();
    state.source = 'live';
    state.updated = new Date();
  } catch (err) {
    if (snapshotMarkets) {
      state.coins = snapshotMarkets.coins.map(c => ({ ...c }));
      state.source = 'snapshot';
      state.updated = new Date(snapshotMarkets.generated);
    } else if (!state.coins.length) {
      throw err;
    }
  }
  state.coins.forEach(enrich);
}

async function loadHistory(coin) {
  if (state.histories.has(coin.id)) return state.histories.get(coin.id);
  const h = state.snapshot?.coins[coin.id] || await fetchHistory(coin.symbol);
  state.histories.set(coin.id, h);
  return h;
}

// ---------------------------------------------------------------- status + KPIs

function renderStatus(error) {
  const el = $('status');
  if (error) { el.dataset.mode = 'error'; el.lastElementChild.textContent = 'Data unavailable'; return; }
  el.dataset.mode = state.source;
  const when = state.updated;
  el.lastElementChild.textContent = state.source === 'live'
    ? `Live · updated ${when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    : `Snapshot · ${when.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
  el.title = state.source === 'live' ? 'Prices loaded live from CoinPaprika' : 'The live feed is unavailable, so this shows the latest daily snapshot';
}

function renderKpis() {
  const cs = state.coins;
  const cap = cs.reduce((s, c) => s + (c.cap || 0), 0);
  const vol = cs.reduce((s, c) => s + (c.vol || 0), 0);
  const btc = cs.find(c => c.id === BTC);
  const up = cs.filter(c => c.ch24 > 0).length, down = cs.filter(c => c.ch24 < 0).length;
  const capPrev = cs.reduce((s, c) => s + (c.cap && c.ch24 != null ? c.cap / (1 + c.ch24) : c.cap || 0), 0);
  $('kCap').textContent = big(cap);
  $('kCapSub').innerHTML = `<span class="${cls(cap / capPrev - 1)}">${pct(cap / capPrev - 1)}</span> in 24h`;
  $('kVol').textContent = big(vol);
  $('kVolSub').textContent = `${(vol / cap * 100).toFixed(1)}% of market value traded`;
  $('kBtc').textContent = btc ? pctPlain(btc.cap / cap) : '–';
  $('kBtcSub').textContent = btc ? `Bitcoin ${usd(btc.price, { digits: 0 })}` : '';
  $('kBreadth').innerHTML = `<span class="up">${up}</span> / <span class="down">${down}</span>`;
  $('kBreadthSub').textContent = `${cs.filter(c => c.kind === 'stable').length} stablecoins, ${cs.filter(c => c.kind === 'wrapped').length} wrapped tokens`;
}

// ---------------------------------------------------------------- table

function sparkSvg(values, up) {
  if (values.length < 2) return '';
  const w = 72, h = 26, min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const step = w / (values.length - 1);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(h - 2 - (v - min) / span * (h - 4)).toFixed(1)}`).join('');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--${up ? 'up' : 'down'})" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

function renderTable() {
  const { key, dir } = state.sort;
  const q = state.query.trim().toLowerCase();
  const rows = state.coins
    .filter(c => !state.hideStable || c.kind === 'coin')
    .filter(c => !q || c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q))
    .sort((a, b) => {
      const x = a[key], y = b[key];
      if (typeof x === 'string') return x.localeCompare(y) * dir;
      return ((x ?? -Infinity) - (y ?? -Infinity)) * dir;
    });
  $('rows').innerHTML = rows.map(c => `
    <tr tabindex="0" data-id="${esc(c.id)}" aria-selected="${c.id === state.selected}">
      <td class="num muted">${c.rank ?? ''}</td>
      <td><span class="coin"><img src="${esc(c.image)}" alt="" loading="lazy"><span>${esc(c.name)} <span class="sym">${esc(c.symbol)}</span></span>${c.kind === 'stable' ? '<span class="tag">stable</span>' : c.kind === 'wrapped' ? `<span class="tag" title="Tracks the price of ${esc(c.tracks)}">wrapped</span>` : ''}</span></td>
      <td class="num">${usd(c.price)}</td>
      <td class="num ${cls(c.ch24)}">${pct(c.ch24)}</td>
      <td class="num hide-xs ${cls(c.ch7)}">${pct(c.ch7)}</td>
      <td class="num hide-sm ${cls(c.ch30)}">${pct(c.ch30)}</td>
      <td class="num hide-sm">${big(c.cap)}</td>
      <td class="num hide-md hide-lg">${c.kind === 'stable' ? '–' : pctPlain(c.ath, 0)}</td>
      <td class="hide-sm">${sparkSvg(c.spark, (c.ch7 ?? 0) >= 0)}</td>
    </tr>`).join('') || `<tr><td colspan="9" class="muted">No coins match “${esc(state.query)}”.</td></tr>`;
  document.querySelectorAll('th[data-k]').forEach(th => {
    th.setAttribute('aria-sort', th.dataset.k === key ? (dir > 0 ? 'ascending' : 'descending') : 'none');
  });
}

function skeleton() {
  $('rows').innerHTML = Array.from({ length: 10 }, () =>
    `<tr class="skeleton">${'<td><span></span></td>'.repeat(9)}</tr>`).join('');
}

// ---------------------------------------------------------------- detail

let priceChart, scatterChart;
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function chartDefaults() {
  Chart.defaults.font.family = css('--sans');
  Chart.defaults.color = css('--muted');
  Chart.defaults.borderColor = css('--line');
}

async function renderDetail() {
  const c = state.coins.find(x => x.id === state.selected) || state.coins[0];
  if (!c) return;
  state.selected = c.id;
  $('dLogo').src = c.image; $('dName').textContent = c.name; $('dSym').textContent = `${c.symbol} · rank ${c.rank}`;
  $('dPrice').textContent = usd(c.price);
  $('dChange').innerHTML = `<span class="${cls(c.ch24)}">${pct(c.ch24, 2)}</span> <span class="muted small">24h</span>`;
  document.querySelectorAll('.ranges button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.d === state.range));
  $('chartNote').textContent = 'Loading history…';

  const btcCoin = state.coins.find(x => x.id === BTC) || { id: BTC, symbol: 'BTC' };
  const [h, btc] = await Promise.all([loadHistory(c), loadHistory(btcCoin)]);
  if (c.id !== state.selected) return; // the user moved on while this loaded
  if (!h) {
    $('chartNote').textContent = c.kind === 'wrapped'
      ? `No exchange lists this token directly. It tracks the price of ${c.tracks}.`
      : 'None of the free exchange feeds (Kraken, Coinbase, Binance.US) list this coin, so there is no daily history to chart.';
    $('stats').innerHTML = [['Market value', big(c.cap)], ['24h volume', big(c.vol)], ['Below all-time high', pctPlain(c.ath, 0)], ['7-day change', pct(c.ch7)]]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    priceChart?.destroy(); priceChart = null;
    return;
  }
  if (c.ch30 == null) { enrich(c); renderTable(); }

  const s = M.lastDays(h, state.range);
  const year = M.lastDays(h, 365);
  const dd = M.maxDrawdown(s.p);
  const vs = c.id === BTC || !btc ? null : M.versus(year, M.lastDays(btc, 365));
  const stats = [
    [`Return, ${state.range === 365 ? '1 year' : state.range + ' days'}`, pct(M.totalReturn(s.p)), cls(M.totalReturn(s.p))],
    ['Annualised volatility', c.kind === 'stable' ? '–' : pctPlain(M.annualisedVol(s.p), 0)],
    ['Max drawdown', pctPlain(dd.drawdown, 0), dd.drawdown < 0 ? 'down' : ''],
    ['Below all-time high', c.kind === 'stable' ? '–' : pctPlain(c.ath, 0)],
    ['Beta to Bitcoin, 1y', vs ? num(vs.beta) : c.id === BTC ? 'benchmark' : '–'],
    ['Correlation with Bitcoin, 1y', vs ? num(vs.correlation) : c.id === BTC ? 'benchmark' : '–'],
    ['Market value', big(c.cap)],
    ['24h volume', big(c.vol)],
  ];
  $('stats').innerHTML = stats.map(([k, v, k2]) => `<div><dt>${k}</dt><dd class="${k2 || ''}">${v}</dd></div>`).join('');
  $('chartNote').textContent = dd.drawdown < 0
    ? `Largest fall in this period: ${pctPlain(dd.drawdown, 0)}, from ${dateLabel(s.t[dd.peakIndex])} to ${dateLabel(s.t[dd.troughIndex])}.`
    : 'No fall from a previous high in this period.';

  const up = M.totalReturn(s.p) >= 0;
  const colour = css(up ? '--up' : '--down');
  const data = {
    labels: s.t,
    datasets: [
      { type: 'line', label: 'Price', data: s.p, borderColor: colour, borderWidth: 2, pointRadius: 0, tension: 0.15, yAxisID: 'y',
        fill: { target: 'origin', above: colour + '14' } },
      { type: 'bar', label: 'Volume', data: s.v, backgroundColor: css('--line'), yAxisID: 'y1', barPercentage: 1, categoryPercentage: 1 },
    ],
  };
  const options = {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: {
        title: items => dateLabel(items[0].label),
        label: item => item.dataset.label === 'Price' ? `Price ${usd(item.raw)}` : `Volume ${big(item.raw)}`,
      } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0, callback(v) { return new Date(this.getLabelForValue(v) + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: state.range > 90 ? '2-digit' : undefined, day: state.range > 90 ? undefined : 'numeric', timeZone: 'UTC' }); } } },
      y: { position: 'right', grace: '5%', ticks: { maxTicksLimit: 5, callback: v => usd(v) } },
      y1: { display: false, max: Math.max(...s.v) * 4, beginAtZero: true },
    },
  };
  if (priceChart) { priceChart.data = data; priceChart.options = options; priceChart.update(); }
  else priceChart = new Chart($('priceChart'), { data, options });
}

function select(id) {
  state.selected = id;
  window.history.replaceState(null, '', '#' + id);
  document.querySelectorAll('#rows tr').forEach(tr => tr.setAttribute('aria-selected', tr.dataset.id === id));
  renderDetail();
  if (window.matchMedia('(max-width: 980px)').matches) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------- risk views (need the daily snapshot)

function riskCoins() {
  const snap = state.snapshot?.coins;
  if (!snap) return [];
  return state.coins.filter(c => snap[c.id] && c.kind === 'coin' && snap[c.id].p.length > 200).map(c => ({ ...c, h: snap[c.id] }));
}

function renderScatter() {
  const coins = riskCoins();
  if (coins.length < 3) {
    $('scatterEmpty').hidden = false;
    $('scatterEmpty').textContent = 'This chart appears once the first daily snapshot has been saved.';
    return;
  }
  $('scatterEmpty').hidden = true;
  const pts = coins.map(c => ({ x: M.annualisedVol(c.h.p) * 100, y: M.totalReturn(c.h.p) * 100, label: c.symbol, name: c.name, cap: c.cap, rank: c.rank }));
  const maxCap = Math.max(...pts.map(p => p.cap));
  const labels = {
    id: 'labels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save(); ctx.font = `500 11px ${css('--sans')}`; ctx.fillStyle = css('--ink'); ctx.textAlign = 'center';
      const roomy = chart.width >= 600;
      chart.getDatasetMeta(0).data.forEach((el, i) => { if (roomy || pts[i].rank <= 8) ctx.fillText(pts[i].label, el.x, el.y - el.options.radius - 4); });
      ctx.restore();
    },
  };
  scatterChart?.destroy();
  scatterChart = new Chart($('scatter'), {
    type: 'scatter',
    data: { datasets: [{ data: pts, pointRadius: pts.map(p => 4 + 10 * Math.sqrt(p.cap / maxCap)), backgroundColor: pts.map(p => (p.y >= 0 ? css('--up') : css('--down')) + 'aa'), borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: i => `${i.raw.name}: ${i.raw.y >= 0 ? '+' : ''}${i.raw.y.toFixed(0)}% return, ${i.raw.x.toFixed(0)}% volatility` } } },
      scales: {
        x: { title: { display: true, text: 'Annualised volatility (%)' }, beginAtZero: true },
        y: { title: { display: true, text: 'One-year return (%)' }, grid: { color: c => c.tick.value === 0 ? css('--muted') : css('--line') } },
      },
      onClick: (_, els) => { if (els[0]) select(coins[els[0].index].id); },
    },
    plugins: [labels],
  });
}

function heatColour(r) {
  // orange for positive correlation, blue for negative, transparent near zero
  const a = Math.min(1, Math.abs(r));
  return r >= 0 ? `rgba(247, 147, 26, ${0.1 + 0.8 * a})` : `rgba(59, 130, 246, ${0.1 + 0.8 * a})`;
}

function renderHeat() {
  const coins = riskCoins().sort((a, b) => a.rank - b.rank).slice(0, 10);
  if (coins.length < 3) {
    $('heatEmpty').hidden = false;
    $('heatEmpty').textContent = 'This chart appears once the first daily snapshot has been saved.';
    $('heat').innerHTML = '';
    return;
  }
  $('heatEmpty').hidden = true;
  const head = `<tr><th></th>${coins.map(c => `<th scope="col">${esc(c.symbol)}</th>`).join('')}</tr>`;
  const body = coins.map(a => `<tr><th scope="row">${esc(a.symbol)}</th>${coins.map(b => {
    const r = a.id === b.id ? 1 : M.versus(a.h, b.h).correlation;
    const dark = Math.abs(r) > 0.6;
    return `<td style="background:${heatColour(r)};color:${dark ? '#111' : 'inherit'}" title="${esc(a.name)} and ${esc(b.name)}: ${num(r)}">${num(r)}</td>`;
  }).join('')}</tr>`).join('');
  $('heat').innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
}

// ---------------------------------------------------------------- wiring

function wire() {
  $('rows').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) select(tr.dataset.id); });
  $('rows').addEventListener('keydown', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(tr.dataset.id); }
    if (e.key === 'ArrowDown') { e.preventDefault(); tr.nextElementSibling?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); tr.previousElementSibling?.focus(); }
  });
  document.querySelectorAll('th[data-k]').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.k;
    state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: k === 'rank' || k === 'name' ? 1 : -1 };
    renderTable();
  }));
  $('q').addEventListener('input', e => { state.query = e.target.value; renderTable(); });
  $('hideStable').addEventListener('change', e => { state.hideStable = e.target.checked; renderTable(); });
  document.querySelectorAll('.ranges button').forEach(b => b.addEventListener('click', () => { state.range = +b.dataset.d; renderDetail(); }));
  window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== state.selected) select(id); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { chartDefaults(); priceChart?.destroy(); priceChart = null; renderDetail(); renderScatter(); });
}

async function refresh() {
  const snapMarkets = state.snapshot ? null : await loadSnapshot();
  await loadMarkets(snapMarkets);
  renderStatus(); renderKpis(); renderTable();
  const c = state.coins.find(x => x.id === state.selected);
  if (c) $('dPrice').textContent = usd(c.price);
}

async function start() {
  chartDefaults();
  wire();
  skeleton();
  try {
    const snapMarkets = await loadSnapshot();
    await loadMarkets(snapMarkets);
  } catch {
    renderStatus(true);
    $('rows').innerHTML = '<tr><td colspan="9">Prices could not be loaded. The free data API may be busy; try again in a minute.</td></tr>';
    return;
  }
  renderStatus(); renderKpis(); renderTable();
  renderDetail(); renderScatter(); renderHeat();
  setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, REFRESH_MS);
}

start();
