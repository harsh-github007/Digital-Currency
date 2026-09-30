import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../assets/metrics.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('log returns and total return', () => {
  close(M.logReturns([100, 110])[0], Math.log(1.1));
  close(M.totalReturn([50, 75, 100]), 1);
  assert.equal(M.logReturns([0, 1, 2]).length, 1); // skips non-positive prices
});

test('volatility is zero for a constant growth rate and scales with sqrt(365)', () => {
  const steady = Array.from({ length: 50 }, (_, i) => 100 * 1.01 ** i);
  close(M.annualisedVol(steady), 0, 1e-9);
  const zigzag = Array.from({ length: 101 }, (_, i) => (i % 2 ? 110 : 100));
  const r = Math.log(1.1);
  close(M.annualisedVol(zigzag), M.stdev(M.logReturns(zigzag)) * Math.sqrt(365));
  close(M.stdev(M.logReturns(zigzag)), r * Math.sqrt(100 / 99), 1e-9);
});

test('max drawdown finds the worst peak-to-trough fall', () => {
  const dd = M.maxDrawdown([100, 120, 90, 130, 65, 80]);
  close(dd.drawdown, -0.5);
  assert.equal(dd.peakIndex, 3);
  assert.equal(dd.troughIndex, 4);
  assert.equal(M.maxDrawdown([1, 2, 3]).drawdown, 0);
});

test('correlation and beta', () => {
  const m = [0.01, -0.02, 0.03, -0.01, 0.02];
  const a = m.map(x => 2 * x);
  close(M.correlation(m, a), 1);
  close(M.beta(a, m), 2);
  close(M.correlation(m, m.map(x => -x)), -1);
});

test('versus aligns on shared dates before comparing', () => {
  const btc = { t: ['d1', 'd2', 'd3', 'd4'], p: [100, 110, 99, 120] };
  const alt = { t: ['d0', 'd1', 'd2', 'd3', 'd4'], p: [5, 10, 12.1, 9.801, 14.4] };
  const v = M.versus(alt, btc);
  assert.equal(v.days, 3);
  close(v.beta, 2, 1e-9);
  close(v.correlation, 1, 1e-9);
});

test('stablecoins are detected, volatile coins are not', () => {
  const stable = Array.from({ length: 120 }, (_, i) => 1 + (i % 2 ? 0.0005 : -0.0005));
  const wild = Array.from({ length: 120 }, (_, i) => 100 * (1 + 0.05 * Math.sin(i)));
  assert.equal(M.isStable(stable), true);
  assert.equal(M.isStable(wild), false);
});

test('lastDays keeps n returns worth of points', () => {
  const s = { t: [1, 2, 3, 4, 5], p: [1, 2, 3, 4, 5], symbol: 'X' };
  assert.deepEqual(M.lastDays(s, 2), { t: [3, 4, 5], p: [3, 4, 5], symbol: 'X' });
});
