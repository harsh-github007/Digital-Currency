// Free, keyless data sources that allow browser requests (CORS):
//   CoinPaprika  top coins by market value, prices, changes, all-time high
//   Kraken       daily candles (one call covers two years)
//   Coinbase     daily candles, used when Kraken doesn't list the coin
//   Binance.US   daily candles, last resort

export const PAPRIKA = 'https://api.coinpaprika.com/v1';
export const KRAKEN = 'https://api.kraken.com/0/public';
export const COINBASE = 'https://api.exchange.coinbase.com';
export const BINANCE_US = 'https://api.binance.us/api/v3';

// Tokens that wrap or stake another coin and simply track its price.
export const WRAPPED = {
  'steth-lido-staked-ether': 'ETH', 'wsteth-wrapped-liquid-staked-ether-20': 'ETH', 'weeth-wrapped-eeth': 'ETH',
  'weth-weth': 'ETH', 'wbtc-wrapped-bitcoin': 'BTC', 'cbbtc-coinbase-wrapped-btc': 'BTC',
};
const KRAKEN_NAMES = { BTC: 'XBT', DOGE: 'XDG' };
const DAY = 86_400_000;
const iso = ms => new Date(ms).toISOString().slice(0, 10);

async function getJSON(url, { fetchFn = fetch, timeout = 15_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetchFn(url, { signal: ctrl.signal });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} from ${new URL(url).host}`), { status: r.status });
    return await r.json();
  } finally { clearTimeout(t); }
}

/** CoinPaprika ticker -> the page's coin shape. 30-day and 1-year changes come from history instead
 *  (the free tier reports them as 0). */
export function fromPaprika(c) {
  const q = c.quotes.USD, f = x => (x == null ? null : x / 100);
  const kind = WRAPPED[c.id] ? 'wrapped'
    : q.price > 0.97 && q.price < 1.03 && Math.abs(q.percent_change_7d ?? 9) < 1 && Math.abs(q.percent_change_24h ?? 9) < 1 ? 'stable'
    : 'coin';
  return {
    id: c.id, rank: c.rank, name: c.name, symbol: c.symbol,
    image: `https://static.coinpaprika.com/coin/${c.id}/logo.png`,
    price: q.price, cap: q.market_cap, vol: q.volume_24h,
    ch24: f(q.percent_change_24h), ch7: f(q.percent_change_7d), ch30: null, ch1y: null,
    ath: f(q.percent_from_price_ath), athDate: q.ath_date,
    kind, tracks: WRAPPED[c.id] || null,
  };
}

export async function fetchMarkets(opts) {
  const list = await getJSON(`${PAPRIKA}/tickers?quotes=USD&limit=30`, opts);
  if (!Array.isArray(list) || !list.length) throw new Error('No market data');
  return list.map(fromPaprika);
}

let krakenPairs = null;
async function krakenPair(symbol, opts) {
  if (!krakenPairs) {
    const r = await getJSON(`${KRAKEN}/AssetPairs`, opts);
    krakenPairs = new Map();
    for (const p of Object.values(r.result || {})) {
      const [base, quote] = (p.wsname || '').split('/');
      if (quote === 'USD' && !krakenPairs.has(base)) krakenPairs.set(base, p.altname);
    }
  }
  return krakenPairs.get(KRAKEN_NAMES[symbol] || symbol);
}

/** Rows of [ms, close, usdVolume] -> {t, p, v}, one point per UTC day, last `days`+1 days. */
export function toSeries(rows, days = 365) {
  const byDay = new Map();
  for (const [ms, close, vol] of rows) if (close > 0) byDay.set(iso(ms), [close, vol]);
  const t = [...byDay.keys()].sort().slice(-(days + 1));
  return { t, p: t.map(d => byDay.get(d)[0]), v: t.map(d => Math.round(byDay.get(d)[1] || 0)) };
}

async function fromKraken(symbol, opts) {
  const pair = await krakenPair(symbol, opts);
  if (!pair) return null;
  const r = await getJSON(`${KRAKEN}/OHLC?pair=${pair}&interval=1440`, opts);
  if (r.error?.length) throw new Error(r.error.join(', '));
  const key = Object.keys(r.result).find(k => k !== 'last');
  // [time(s), open, high, low, close, vwap, volume(base), count]
  return r.result[key].map(k => [k[0] * 1000, +k[4], +k[6] * +k[5]]);
}

async function fromCoinbase(symbol, opts) {
  const now = Date.now(), rows = [];
  for (const [a, b] of [[300, 0], [370, 299]]) {
    const url = `${COINBASE}/products/${symbol}-USD/candles?granularity=86400&start=${new Date(now - a * DAY).toISOString()}&end=${new Date(now - b * DAY).toISOString()}`;
    const part = await getJSON(url, opts);
    // [time(s), low, high, open, close, volume(base)]
    part.forEach(k => rows.push([k[0] * 1000, k[4], k[5] * k[4]]));
  }
  return rows;
}

async function fromBinanceUS(symbol, opts) {
  const r = await getJSON(`${BINANCE_US}/klines?symbol=${symbol}USDT&interval=1d&limit=366`, opts);
  // [openTime(ms), open, high, low, close, volume, closeTime, quoteVolume, ...]
  return r.map(k => [k[0], +k[4], +k[7]]);
}

/** One year of daily closes for a symbol, trying each exchange in turn. Returns {t, p, v, source} or null. */
export async function fetchHistory(symbol, opts) {
  for (const [name, fn] of [['Kraken', fromKraken], ['Coinbase', fromCoinbase], ['Binance.US', fromBinanceUS]]) {
    try {
      const rows = await fn(symbol, opts);
      if (rows && rows.length > 30) return { ...toSeries(rows), source: name };
    } catch { /* try the next exchange */ }
  }
  return null;
}

export function resetCache() { krakenPairs = null; }
