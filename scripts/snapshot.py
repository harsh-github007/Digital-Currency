"""Save a daily snapshot of the top 30 cryptocurrencies from the CoinGecko public API.

Writes:
  data/markets.json   current price, market cap, volume and returns for each coin
  data/history.json   one year of daily closing price, volume and market cap per coin
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
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.coingecko.com/api/v3"
TOP_N = 30
DAYS = 365
PAUSE = float(os.environ.get("SNAPSHOT_PAUSE", "6"))  # the free tier allows roughly 10 to 30 calls a minute
OUT = Path(__file__).resolve().parent.parent / "data"


def get(path, tries=5, opener=urllib.request.urlopen):
    """GET a JSON endpoint, waiting and retrying when rate limited."""
    url = f"{API}{path}"
    headers = {"Accept": "application/json", "User-Agent": "digital-currency-snapshot"}
    if os.environ.get("COINGECKO_API_KEY"):
        headers["x-cg-demo-api-key"] = os.environ["COINGECKO_API_KEY"]
    for attempt in range(tries):
        try:
            with opener(urllib.request.Request(url, headers=headers), timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                wait = int(e.headers.get("Retry-After") or 0) or 30 * (attempt + 1)
                print(f"  {e.code} on {path}; waiting {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            raise
    raise RuntimeError(f"gave up on {path}")


def daily(points):
    """[[ms, value], ...] -> {YYYY-MM-DD: value}, keeping the last value of each day."""
    out = {}
    for ms, v in points:
        out[datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")] = v
    return out


def sig(x, digits=6):
    return None if x is None else float(f"{x:.{digits}g}")


def build(get_json=get, pause=PAUSE):
    markets = get_json(f"/coins/markets?vs_currency=usd&order=market_cap_desc&per_page={TOP_N}&page=1"
                       "&sparkline=true&price_change_percentage=24h,7d,30d,1y")
    history = {}
    for i, coin in enumerate(markets):
        time.sleep(pause if i else 0)
        chart = get_json(f"/coins/{coin['id']}/market_chart?vs_currency=usd&days={DAYS}&interval=daily")
        p, v, m = daily(chart["prices"]), daily(chart["total_volumes"]), daily(chart["market_caps"])
        dates = sorted(p)
        history[coin["id"]] = {
            "symbol": coin["symbol"].upper(), "name": coin["name"],
            "t": dates,
            "p": [sig(p[d]) for d in dates],
            "v": [round(v.get(d) or 0) for d in dates],
            "m": [round(m.get(d) or 0) for d in dates],
        }
        print(f"  {coin['symbol'].upper():<6} {len(dates)} days")
    return markets, history


def write(markets, history, out=OUT):
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    (out / "markets.json").write_text(json.dumps({"generated": stamp, "coins": markets}, separators=(",", ":")))
    (out / "history.json").write_text(json.dumps({"generated": stamp, "coins": history}, separators=(",", ":")))
    with open(out / "history.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["coin", "symbol", "date", "close", "volume", "market_cap"])
        for cid, h in history.items():
            for row in zip(h["t"], h["p"], h["v"], h["m"]):
                w.writerow([cid, h["symbol"], *row])


if __name__ == "__main__":
    write(*build())
    print("Snapshot written to", OUT)
