# Crypto Market Monitor

A web dashboard for the 30 largest cryptocurrencies by market value. It shows live prices, and how risky each coin has been over the past year: volatility, worst drawdown, beta and correlation to Bitcoin, and how the largest coins move together.

**Live site:** _add the link once deployed_

## What it shows

- **Market summary:** total market value of the top 30, 24-hour volume, Bitcoin's share, and how many coins rose or fell.
- **Top 30 table:**
  - Price, 24-hour, 7-day and 30-day changes, market value, distance below the all-time high, and a 7-day sparkline.
  - Sortable and searchable, with an option to hide stablecoins.
- **Coin detail:**
  - A 30-day, 90-day or 1-year price chart with volume, and the largest fall in that period marked in the note beneath it.
  - Return, annualised volatility, max drawdown, and beta and correlation to Bitcoin.
- **Risk and return:** every non-stable coin placed by one-year volatility against one-year return, with dot size showing market value.
- **Correlation grid:** how the daily returns of the 10 largest non-stable coins moved together over the year.

## How it works

```
CoinGecko API ──live, in the browser──> index.html (prices, 24h/7d/30d changes)
      │
      └──daily GitHub Action──> data/history.json, markets.json, history.csv
                                 (one year of daily prices: risk statistics, correlations,
                                  and a fallback when the live API is rate-limited)
```

- **Live prices** come from the free [CoinGecko API](https://www.coingecko.com/en/api), called directly from the visitor's browser. The page refreshes them every two minutes.
- **One year of daily history** for all 30 coins is saved once a day by [`.github/workflows/snapshot.yml`](.github/workflows/snapshot.yml), which runs [`scripts/snapshot.py`](scripts/snapshot.py). Saving it in the repository keeps the page fast and avoids the free API's rate limit. If the live API is busy, the page shows the snapshot and says so.
- **Statistics** are calculated in [`assets/metrics.js`](assets/metrics.js):
  - Volatility is the standard deviation of daily log returns × √365 (crypto trades every day).
  - Max drawdown is the largest fall from a previous high.
  - Beta and correlation compare each coin's daily returns with Bitcoin's on the same dates.
  - Stablecoins (annualised volatility under 5% over 90 days) are left out of the risk charts.

There is no build step and no server: the site is static HTML, CSS and JavaScript, with [Chart.js](https://www.chartjs.org/) for the charts.

## Running it

```bash
python -m http.server 8000    # then open http://localhost:8000
npm test                      # statistics tests (Node 18+)
python -m pytest tests        # snapshot script tests
```

**Deploying.** Any static host works. On Vercel or Netlify, import the repository with no build command. On GitHub Pages, go to *Settings → Pages* and deploy from the `main` branch, root folder.

**Daily snapshot.**
- The Action runs every day at 01:17 UTC and can be started by hand from the *Actions* tab.
- It commits updated files in `data/` only when something changed.
- It works without a key. Adding a free CoinGecko demo key as a repository secret named `COINGECKO_API_KEY` makes it more reliable.

## Project history

The first version (2022) was a Power BI dashboard fed by Yahoo Finance's CSV download link. It is kept in [`powerbi/`](powerbi/): the `.pbit` template, the list of coins, and a PDF export of the report. The 2026 rebuild replaced it for these reasons:
- **The data feed no longer works.** Yahoo closed that download link in 2023.
- **The dates were fixed** at July 2021 to July 2022.
- **The headline cards added prices together,** so "Open", "High" and "Low" showed sums across days rather than prices.
- **The file only ran on one computer.** It read from a fixed path on the original author's PC and needed Power BI Desktop, which runs only on Windows.
- **The coin list was out of date.** Several coins in it have since collapsed or been delisted, including FTT and BUSD. The new version always uses the current top 30.

## Disclaimer

For information only. Nothing here is investment advice.
