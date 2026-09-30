# Crypto Market Monitor

A web dashboard for the 30 largest cryptocurrencies by market value. It shows live prices, and how risky each coin has been over the past year: volatility, worst drawdown, beta and correlation to Bitcoin, and how the largest coins move together.

**Live site:** https://harsh-github007.github.io/Digital-Currency/

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
CoinPaprika ──live, in the browser──> ranking, prices, market value, 24h/7d changes
Kraken      ──live, in the browser──> one year of daily prices for the selected coin
   (Coinbase, Binance.US as fallbacks)

Daily GitHub Action ──> data/markets.json, history.json, history.csv
   (a year of daily prices for the whole top 30: 30-day and 1-year changes,
    sparklines, the risk charts, and a fallback if the live feeds fail)
```

- **Live prices** come from the free [CoinPaprika API](https://api.coinpaprika.com), called directly from the visitor's browser and refreshed every two minutes.
- **Daily price history** comes from [Kraken](https://docs.kraken.com/api/)'s public market data. Coinbase and Binance.US are used when Kraken doesn't list a coin. All three need no key and allow browser requests.
- **The daily snapshot:**
  - Once a day, [`.github/workflows/snapshot.yml`](.github/workflows/snapshot.yml) runs [`scripts/snapshot.py`](scripts/snapshot.py) to save a year of history for the whole top 30 in `data/`.
  - The page uses it for the 30-day and 1-year changes, the sparklines and the risk charts, and falls back to it if the live feeds are down, saying so in the status badge.
- **Wrapped tokens** such as WBTC and stETH track another coin's price and have no exchange market of their own, so they are labelled and left out of the risk charts.
- **Statistics** are calculated in [`assets/metrics.js`](assets/metrics.js):
  - Volatility is the standard deviation of daily log returns × √365 (crypto trades every day).
  - Max drawdown is the largest fall from a previous high.
  - Beta and correlation compare each coin's daily returns with Bitcoin's on the same dates.
  - Stablecoins (annualised volatility under 5% over 90 days) are left out of the risk charts.

There is no build step and no server: the site is static HTML, CSS and JavaScript. [Chart.js](https://www.chartjs.org/) is committed to `assets/vendor/` rather than loaded from a CDN, so the page has no third-party dependency at run time and still works if that CDN is blocked or down. If the chart library cannot be loaded at all, the prices, table and correlation grid still render and the charts say so in place.

## Running it

```bash
python -m http.server 8000    # then open http://localhost:8000
npm test                      # statistics tests (Node 18+)
python -m pytest tests        # snapshot script tests
```

**Deploying.** The site is published to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml), which runs on every push to `main` and again after each daily snapshot, so the published data stays current. Any other static host works too: on Vercel or Netlify, import the repository with no build command. The site runs from a subfolder as well as a domain root.

**Daily snapshot.**
- The Action runs every day at 01:17 UTC and can be started by hand from the *Actions* tab.
- It commits updated files in `data/` only when something changed.
- It needs no API keys.

The [`powerbi/`](powerbi/) folder holds a Power BI version of the dashboard: a report template, its coin list and a PDF export.

## Disclaimer

For information only. Nothing here is investment advice.
