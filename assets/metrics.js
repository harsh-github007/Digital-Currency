// Risk and return statistics for daily price series.
// Crypto trades every day, so annualisation uses 365 periods.

export const PERIODS_PER_YEAR = 365;

export function logReturns(prices) {
  const out = [];
  for (let i = 1; i < prices.length; i++) {
    const a = prices[i - 1], b = prices[i];
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

export function mean(xs) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
}

export function stdev(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Annualised volatility of daily log returns. */
export function annualisedVol(prices) {
  return stdev(logReturns(prices)) * Math.sqrt(PERIODS_PER_YEAR);
}

/** Simple return from first to last price. */
export function totalReturn(prices) {
  if (prices.length < 2 || !(prices[0] > 0)) return NaN;
  return prices[prices.length - 1] / prices[0] - 1;
}

/** Largest peak-to-trough fall, as a negative fraction, with the indexes where it happened. */
export function maxDrawdown(prices) {
  let peak = -Infinity, peakIdx = 0, best = 0, from = 0, to = 0;
  prices.forEach((p, i) => {
    if (p > peak) { peak = p; peakIdx = i; }
    const dd = p / peak - 1;
    if (dd < best) { best = dd; from = peakIdx; to = i; }
  });
  return { drawdown: best, peakIndex: from, troughIndex: to };
}

/** Keep only the dates both series share, in order. Series are {t: [...], p: [...]}. */
export function align(a, b) {
  const mb = new Map(b.t.map((t, i) => [t, b.p[i]]));
  const x = [], y = [];
  a.t.forEach((t, i) => { if (mb.has(t)) { x.push(a.p[i]); y.push(mb.get(t)); } });
  return [x, y];
}

export function correlation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return NaN;
  const mx = mean(xs.slice(0, n)), my = mean(ys.slice(0, n));
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/** Beta of an asset's returns against a benchmark's returns. */
export function beta(assetReturns, marketReturns) {
  const n = Math.min(assetReturns.length, marketReturns.length);
  if (n < 3) return NaN;
  const a = assetReturns.slice(0, n), m = marketReturns.slice(0, n);
  const ma = mean(a), mm = mean(m);
  let cov = 0, varm = 0;
  for (let i = 0; i < n; i++) { cov += (a[i] - ma) * (m[i] - mm); varm += (m[i] - mm) ** 2; }
  return varm ? cov / varm : NaN;
}

/** Correlation and beta of two {t, p} series, computed on the log returns of shared dates. */
export function versus(asset, benchmark) {
  const [pa, pb] = align(asset, benchmark);
  const ra = logReturns(pa), rb = logReturns(pb);
  return { correlation: correlation(ra, rb), beta: beta(ra, rb), days: ra.length };
}

/** A coin whose price barely moves (stablecoins) would distort risk comparisons. */
export function isStable(prices) {
  const recent = prices.slice(-90);
  return recent.length > 10 && annualisedVol(recent) < 0.05;
}

/** Keep the last n days of a {t, p, ...} series. */
export function lastDays(series, n) {
  const k = Math.max(0, series.t.length - n - 1);
  const out = {};
  for (const key of Object.keys(series)) out[key] = Array.isArray(series[key]) ? series[key].slice(k) : series[key];
  return out;
}
