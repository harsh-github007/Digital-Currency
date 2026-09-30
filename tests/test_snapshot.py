import csv
import io
import json
import sys
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import snapshot  # noqa: E402

DAY_S = 86_400


def ticker(cid, sym, rank, price, ch7=5.0, ch24=1.0):
    return {"id": cid, "name": sym.title(), "symbol": sym, "rank": rank,
            "quotes": {"USD": {"price": price, "market_cap": 1e9, "volume_24h": 1e7, "percent_change_24h": ch24,
                               "percent_change_7d": ch7, "percent_from_price_ath": -20.0, "ath_date": "2025-10-06T00:00:00Z"}}}


def fake_api(path):
    if "coinpaprika" in path:
        return [ticker("btc-bitcoin", "BTC", 1, 80000), ticker("usdt-tether", "USDT", 2, 1.0, ch7=0.01, ch24=0.0),
                ticker("wbtc-wrapped-bitcoin", "WBTC", 3, 80000), ticker("leo-leo-token", "LEO", 4, 9.0)]
    if path.endswith("AssetPairs"):
        return {"error": [], "result": {"XXBTZUSD": {"wsname": "XBT/USD", "altname": "XBTUSD"},
                                        "USDTZUSD": {"wsname": "USDT/USD", "altname": "USDTZUSD"}}}
    if "OHLC" in path:
        base = 100.0 if "XBT" in path else 1.0
        rows = [[i * DAY_S, "0", "0", "0", str(base + i), str(base), "2", 1] for i in range(40)]
        rows.append([39 * DAY_S + 3600, "0", "0", "0", str(base + 50), str(base), "2", 1])  # later candle, same day
        return {"error": [], "result": {"PAIR": rows, "last": 0}}
    raise urllib.error.HTTPError(path, 404, "Not Found", {}, None)  # LEO is on no exchange


def test_build_classifies_coins_and_fetches_history():
    coins, history = snapshot.build(get_json=fake_api, pause=0, previous={})
    kinds = {c["id"]: c["kind"] for c in coins}
    assert kinds == {"btc-bitcoin": "coin", "usdt-tether": "stable", "wbtc-wrapped-bitcoin": "wrapped", "leo-leo-token": "coin"}
    assert set(history) == {"btc-bitcoin", "usdt-tether"}  # wrapped skipped, LEO unavailable
    btc = history["btc-bitcoin"]
    assert btc["source"] == "Kraken" and len(btc["t"]) == 40
    assert btc["p"][-1] == 150.0  # the later candle of a day wins
    assert btc["v"][0] == 200  # base volume x vwap = USD volume
    assert coins[0]["ch24"] == 0.01 and coins[0]["image"].endswith("btc-bitcoin/logo.png")


def test_write_produces_json_and_csv(tmp_path):
    snapshot.write(*snapshot.build(get_json=fake_api, pause=0, previous={}), out=tmp_path)
    m = json.loads((tmp_path / "markets.json").read_text())
    assert len(m["coins"]) == 4 and "generated" in m
    rows = list(csv.DictReader(open(tmp_path / "history.csv")))
    assert len(rows) == 80 and rows[0]["coin"] == "btc-bitcoin"


def test_get_retries_after_rate_limit(monkeypatch):
    calls = []

    def opener(req, timeout):
        calls.append(req.full_url)
        if len(calls) == 1:
            raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", {"Retry-After": "0"}, None)
        return io.BytesIO(b'{"ok": true}')

    monkeypatch.setattr(snapshot.time, "sleep", lambda s: None)
    assert snapshot.get("https://example.com/x", opener=opener) == {"ok": True}
    assert len(calls) == 2


def test_get_retries_after_dropped_connection(monkeypatch):
    calls = []

    def opener(req, timeout):
        calls.append(1)
        if len(calls) < 3:
            raise urllib.error.URLError("connection reset by peer")
        return io.BytesIO(b'{"ok": true}')

    monkeypatch.setattr(snapshot.time, "sleep", lambda s: None)
    assert snapshot.get("https://example.com/x", opener=opener) == {"ok": True}
    assert len(calls) == 3


def test_get_tolerates_a_date_retry_after(monkeypatch):
    calls = []

    def opener(req, timeout):
        calls.append(1)
        if len(calls) == 1:
            raise urllib.error.HTTPError(req.full_url, 503, "Busy", {"Retry-After": "Wed, 30 Sep 2026 01:00:00 GMT"}, None)
        return io.BytesIO(b'{"ok": true}')

    monkeypatch.setattr(snapshot.time, "sleep", lambda s: None)
    assert snapshot.get("https://example.com/x", opener=opener) == {"ok": True}


def test_get_gives_up_after_repeated_failures(monkeypatch):
    def opener(req, timeout):
        raise urllib.error.URLError("down")

    monkeypatch.setattr(snapshot.time, "sleep", lambda s: None)
    try:
        snapshot.get("https://example.com/x", tries=3, opener=opener)
    except urllib.error.URLError:
        pass
    else:
        raise AssertionError("expected the error after the last try")


def test_failed_fetch_keeps_previous_history():
    def flaky_api(path):
        if "OHLC" in path and "XBT" in path:
            raise RuntimeError("Kraken down")  # BTC fails everywhere today
        if "coinbase" in path or "binance" in path:
            raise urllib.error.HTTPError(path, 503, "Busy", {}, None)
        return fake_api(path)

    saved = {"btc-bitcoin": {"symbol": "BTC", "name": "Btc", "t": ["2026-01-01"] * 365, "p": [1.0] * 365, "v": [0] * 365, "source": "Kraken"}}
    coins, history = snapshot.build(get_json=flaky_api, pause=0, previous=saved)
    assert history["btc-bitcoin"] is saved["btc-bitcoin"]  # yesterday's data kept, not dropped
    assert "usdt-tether" in history  # other coins still fetched fresh


def test_load_previous_handles_missing_or_bad_file(tmp_path):
    assert snapshot.load_previous(tmp_path) == {}
    (tmp_path / "history.json").write_text("not json")
    assert snapshot.load_previous(tmp_path) == {}
