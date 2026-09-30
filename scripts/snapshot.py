"""Save a daily snapshot of the top 30 cryptocurrencies.

Sources (free, no key):
  CoinPaprika   ranking, price, market value, volume, changes, all-time high
  Kraken        one year of daily candles; Coinbase and Binance.US when Kraken doesn't list a coin

Writes:
  data/markets.json   the top 30, in the same shape the web page uses
  data/history.json   one year of daily closing price and USD volume per coin
  data/history.csv    the same history as a flat table, for spreadsheets and Power BI

Run by .github/workflows/snapshot.yml once a day. Needs only the standard library.
"""

import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

PAPRIKA = "https://api.coinpaprika.com/v1"
KRAKEN = "https://api.kraken.com/0/public"
COINBASE = "https://api.exchange.coinbase.com"
BINANCE_US = "https://api.binance.us/api/v3"
TOP_N = 30
DAYS = 365
PAUSE = float(os.environ.get("SNAPSHOT_PAUSE", "1.5"))
OUT = Path(__file__).resolve().parent.parent / "data"

# Tokens that wrap or stake another coin and simply track its price (kept in sync with assets/sources.js).
WRAPPED = {
    "steth-lido-staked-ether": "ETH", "wsteth-wrapped-liquid-staked-ether-20": "ETH", "weeth-wrapped-eeth": "ETH",
    "weth-weth": "ETH", "wbtc-wrapped-bitcoin": "BTC", "cbbtc-coinbase-wrapped-btc": "BTC",
}
KRAKEN_NAMES = {"BTC": "XBT", "DOGE": "XDG"}


def _retry_after(e, attempt):
    """Seconds to wait before retrying: the server's Retry-After if it gives a number, else back off."""
    try:
        return int(e.headers.get("Retry-After") or 0) or 10 * (attempt + 1)
    except (TypeError, ValueError):  # Retry-After may be an HTTP date
        return 10 * (attempt + 1)


def get(url, tries=4, opener=urllib.request.urlopen):
    """GET a JSON endpoint, waiting and retrying on rate limits, server errors and dropped connections."""
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "digital-currency-snapshot"})
    host = url.split("/")[2]
    for attempt in range(tries):
        last = attempt == tries - 1
        try:
            with opener(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and not last:
                wait = _retry_after(e, attempt)
                print(f"  {e.code} from {host}; waiting {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
            # a dropped connection, DNS hiccup, timeout or truncated body: worth another try
            if last:
                raise
            wait = 10 * (attempt + 1)
            print(f"  {type(e).__name__} from {host}; waiting {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"gave up on {url}")


def from_paprika(c):
    q = c["quotes"]["USD"]
    pct = lambda x: None if x is None else x / 100
    if c["id"] in WRAPPED:
        kind = "wrapped"
    elif 0.97 < q["price"] < 1.03 and all(q.get(k) is not None and abs(q[k]) < 1 for k in ("percent_change_7d", "percent_change_24h")):
        kind = "stable"
    else:
        kind = "coin"
    return {
        "id": c["id"], "rank": c["rank"], "name": c["name"], "symbol": c["symbol"],
        "image": f"https://static.coinpaprika.com/coin/{c['id']}/logo.png",
        "price": q["price"], "cap": q["market_cap"], "vol": q["volume_24h"],
        "ch24": pct(q.get("percent_change_24h")), "ch7": pct(q.get("percent_change_7d")), "ch30": None, "ch1y": None,
        "ath": pct(q.get("percent_from_price_ath")), "athDate": q.get("ath_date"),
        "kind": kind, "tracks": WRAPPED.get(c["id"]),
    }


def to_series(rows, days=DAYS):
    """[(ms, close, usd_volume), ...] -> {t, p, v}, one point per UTC day, last days+1 days."""
    by_day = {}
    for ms, close, vol in rows:
        if close and close > 0:
            by_day[datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")] = (close, vol or 0)
    t = sorted(by_day)[-(days + 1):]
    return {"t": t, "p": [float(f"{by_day[d][0]:.6g}") for d in t], "v": [round(by_day[d][1]) for d in t]}


class History:
    def __init__(self, get_json=get):
        self.get = get_json
        self._kraken = None

    def kraken_pair(self, symbol):
        if self._kraken is None:
            self._kraken = {}
            for p in self.get(f"{KRAKEN}/AssetPairs").get("result", {}).values():
                base, _, quote = (p.get("wsname") or "").partition("/")
                if quote == "USD":
                    self._kraken.setdefault(base, p["altname"])
        return self._kraken.get(KRAKEN_NAMES.get(symbol, symbol))

    def kraken(self, symbol):
        pair = self.kraken_pair(symbol)
        if not pair:
            return None
        r = self.get(f"{KRAKEN}/OHLC?pair={pair}&interval=1440")
        if r.get("error"):
            raise RuntimeError(r["error"])
        key = next(k for k in r["result"] if k != "last")
        return [(k[0] * 1000, float(k[4]), float(k[6]) * float(k[5])) for k in r["result"][key]]

    def coinbase(self, symbol):
        now, rows = datetime.now(timezone.utc), []
        for a, b in ((300, 0), (370, 299)):
            start, end = (now - timedelta(days=a)).isoformat(), (now - timedelta(days=b)).isoformat()
            for k in self.get(f"{COINBASE}/products/{symbol}-USD/candles?granularity=86400&start={start}&end={end}"):
                rows.append((k[0] * 1000, k[4], k[5] * k[4]))
        return rows

    def binance_us(self, symbol):
        return [(k[0], float(k[4]), float(k[7])) for k in self.get(f"{BINANCE_US}/klines?symbol={symbol}USDT&interval=1d&limit=366")]

    def fetch(self, symbol):
        for name, fn in (("Kraken", self.kraken), ("Coinbase", self.coinbase), ("Binance.US", self.binance_us)):
            try:
                rows = fn(symbol)
                if rows and len(rows) > 30:
                    return {**to_series(rows), "source": name}
            except Exception as e:  # noqa: BLE001 - any failure means try the next exchange
                print(f"  {symbol}: {name} failed ({e})", file=sys.stderr)
        return None


def load_previous(out=OUT):
    """The history saved by the last run, so one failed fetch doesn't erase a coin's data."""
    try:
        return json.loads((out / "history.json").read_text()).get("coins", {})
    except (OSError, ValueError):
        return {}


def build(get_json=get, pause=PAUSE, previous=None):
    coins = [from_paprika(c) for c in get_json(f"{PAPRIKA}/tickers?quotes=USD&limit={TOP_N}")]
    previous = load_previous() if previous is None else previous
    hist, history, kept = History(get_json), {}, 0
    for i, c in enumerate(coins):
        if c["kind"] == "wrapped":
            continue
        time.sleep(pause if i else 0)
        h = hist.fetch(c["symbol"])
        if h:
            history[c["id"]] = {"symbol": c["symbol"], "name": c["name"], **h}
            note = h["source"]
        elif c["id"] in previous:
            history[c["id"]] = previous[c["id"]]
            kept += 1
            note = "kept previous day's history"
        else:
            note = "no history"
        days = len(history[c["id"]]["t"]) if c["id"] in history else 0
        print(f"  {c['rank']:>2} {c['symbol']:<7} {days:>4} days  {note}")
    if not history:
        raise RuntimeError("no price history could be fetched from any exchange")
    if kept:
        print(f"  {kept} coin(s) kept the previous day's history because every exchange failed", file=sys.stderr)
    return coins, history


def write(coins, history, out=OUT):
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    (out / "markets.json").write_text(json.dumps({"generated": stamp, "coins": coins}, separators=(",", ":")))
    (out / "history.json").write_text(json.dumps({"generated": stamp, "coins": history}, separators=(",", ":")))
    with open(out / "history.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["coin", "symbol", "date", "close", "volume_usd"])
        for cid, h in history.items():
            for d, p, v in zip(h["t"], h["p"], h["v"]):
                w.writerow([cid, h["symbol"], d, p, v])


if __name__ == "__main__":
    write(*build())
    print("Snapshot written to", OUT)
