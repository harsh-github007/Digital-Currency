import csv
import io
import json
import sys
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import snapshot  # noqa: E402

DAY = 86_400_000


def fake_api(path):
    if path.startswith("/coins/markets"):
        return [{"id": "bitcoin", "symbol": "btc", "name": "Bitcoin"},
                {"id": "tether", "symbol": "usdt", "name": "Tether"}]
    base = 100.0 if "bitcoin" in path else 1.0
    pts = [[i * DAY, base + i] for i in range(3)] + [[2 * DAY + 3_600_000, base + 2.5]]  # a second point on day 3
    return {"prices": pts, "total_volumes": [[t, 10.4] for t, _ in pts], "market_caps": [[t, 1e9] for t, _ in pts]}


def test_build_keeps_one_value_per_day_and_the_latest():
    markets, history = snapshot.build(get_json=fake_api, pause=0)
    btc = history["bitcoin"]
    assert btc["t"] == ["1970-01-01", "1970-01-02", "1970-01-03"]
    assert btc["p"] == [100.0, 101.0, 102.5]
    assert btc["symbol"] == "BTC" and btc["v"] == [10, 10, 10]
    assert len(markets) == 2


def test_write_produces_json_and_csv(tmp_path):
    snapshot.write(*snapshot.build(get_json=fake_api, pause=0), out=tmp_path)
    h = json.loads((tmp_path / "history.json").read_text())
    assert set(h["coins"]) == {"bitcoin", "tether"} and "generated" in h
    rows = list(csv.DictReader(open(tmp_path / "history.csv")))
    assert len(rows) == 6 and rows[0]["coin"] == "bitcoin" and rows[0]["close"] == "100.0"


def test_get_retries_after_rate_limit(monkeypatch):
    calls = []

    def opener(req, timeout):
        calls.append(req.full_url)
        if len(calls) == 1:
            raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", {"Retry-After": "0"}, None)
        return io.BytesIO(b'{"ok": true}')

    monkeypatch.setattr(snapshot.time, "sleep", lambda s: None)
    assert snapshot.get("/ping", opener=opener) == {"ok": True}
    assert len(calls) == 2
