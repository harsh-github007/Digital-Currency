import test from 'node:test';
import assert from 'node:assert/strict';
import { fromPaprika, toSeries, fetchHistory, fetchMarkets, resetCache } from '../assets/sources.js';

const DAY = 86_400;
const ok = body => ({ ok: true, status: 200, json: async () => body });
const fail = status => ({ ok: false, status, json: async () => ({}) });

const tick = (id, symbol, price, ch7 = 5, ch24 = 1) => ({ id, name: symbol, symbol, rank: 1,
  quotes: { USD: { price, market_cap: 1e9, volume_24h: 1e7, percent_change_24h: ch24, percent_change_7d: ch7, percent_from_price_ath: -30 } } });

test('CoinPaprika tickers are classified as coin, stable or wrapped', () => {
  assert.equal(fromPaprika(tick('btc-bitcoin', 'BTC', 80000)).kind, 'coin');
  assert.equal(fromPaprika(tick('usdt-tether', 'USDT', 1.0, 0.01, 0)).kind, 'stable');
  const w = fromPaprika(tick('wbtc-wrapped-bitcoin', 'WBTC', 80000));
  assert.equal(w.kind, 'wrapped'); assert.equal(w.tracks, 'BTC');
  assert.equal(fromPaprika(tick('btc-bitcoin', 'BTC', 80000)).ath, -0.3);
});

test('toSeries keeps one point per day, the latest, and trims to the window', () => {
  const rows = Array.from({ length: 400 }, (_, i) => [i * DAY * 1000, 100 + i, 5]);
  rows.push([399 * DAY * 1000 + 3_600_000, 999, 7]);
  const s = toSeries(rows);
  assert.equal(s.t.length, 366);
  assert.equal(s.p.at(-1), 999);
  assert.equal(s.v.at(-1), 7);
});

test('fetchMarkets maps the ticker list', async () => {
  const m = await fetchMarkets({ fetchFn: async () => ok([tick('eth-ethereum', 'ETH', 3000)]) });
  assert.equal(m[0].symbol, 'ETH');
});

test('fetchHistory uses Kraken, translating BTC to XBT', async () => {
  resetCache();
  const seen = [];
  const fetchFn = async url => {
    seen.push(url);
    if (url.endsWith('AssetPairs')) return ok({ result: { XXBTZUSD: { wsname: 'XBT/USD', altname: 'XBTUSD' } } });
    if (url.includes('OHLC?pair=XBTUSD')) return ok({ error: [], result: { XXBTZUSD: Array.from({ length: 50 }, (_, i) => [i * DAY, '0', '0', '0', String(100 + i), '100', '2', 1]), last: 0 } });
    return fail(404);
  };
  const h = await fetchHistory('BTC', { fetchFn });
  assert.equal(h.source, 'Kraken');
  assert.equal(h.p.length, 50);
  assert.equal(h.v[0], 200);
});

test('fetchHistory falls back to Coinbase, then Binance.US', async () => {
  resetCache();
  const coinbase = async url => {
    if (url.endsWith('AssetPairs')) return ok({ result: {} });
    if (url.includes('coinbase')) return ok(Array.from({ length: 40 }, (_, i) => [i * DAY, 1, 2, 1, 10 + i, 3]));
    return fail(404);
  };
  assert.equal((await fetchHistory('SOL', { fetchFn: coinbase })).source, 'Coinbase');
  resetCache();
  const binance = async url => {
    if (url.endsWith('AssetPairs')) return ok({ result: {} });
    if (url.includes('binance')) return ok(Array.from({ length: 40 }, (_, i) => [i * DAY * 1000, '1', '1', '1', String(5 + i), '1', 0, '1000']));
    return fail(404);
  };
  const b = await fetchHistory('BNB', { fetchFn: binance });
  assert.equal(b.source, 'Binance.US');
  assert.equal(b.v[0], 1000);
  resetCache();
  assert.equal(await fetchHistory('LEO', { fetchFn: async u => (u.endsWith('AssetPairs') ? ok({ result: {} }) : fail(404)) }), null);
});
