# WESO bonding curve stats

A static, read-only stats page for the WESO bonding curve (and the reBASE curve) on Terra Classic, styled after weso.world. It has no build step and no server: open `index.html` from disk or serve the folder from any static host (relative paths only, so it works under a GitHub Pages subpath).

**v2 (2026-10-10)** is a visual and interaction upgrade of v1 with the same data and features; see `CHANGELOG-v2.md`. Every page carries a "Team preview, do not share" banner and `noindex` until it is cleared for release.

| Page | What it shows |
|---|---|
| `index.html` | Curve chart (by supply / by year), live stats, **price history & performance**, milestones, flags |
| `methodology.html` | How price, total / circulating / max supply, market cap, volume and TVL are calculated, plus every contract address |
| `embed.html?chart=price\|volume\|mcap\|tvl&range=24h\|7d\|30d\|1y\|all&ccy=usd\|lunc` | One history chart, for iframes |

## Price history & performance

- Daily price in USD and LUNC, volume (buys / sells), market cap with FDV, and TVL (chain backing vs DefiLlama), each with 24h / 7d / 30d / 1y / All views.
- A listing-style change table (24h, 7d, 30d, 1y, all-time) and KPI tiles.
- Every chart has **PNG** (titled, timestamped, with the source line), **CSV** (the data shown, with a source column) and **Embed** (iframe code for `embed.html`).
- Every chart carries a source line. Ranges that start before the chain data show a shaded "no public chain history" band rather than made-up points.

### Where the history comes from

| Layer | Window (build of 2026-10-10) | Method |
|---|---|---|
| Historical chain state | 30 Sep 2026 → now | `curve_info`, `token_info`, balances and DAO delegations read every 4 h (hourly for the last 48 h) with `x-cosmos-block-height`; a response is accepted only if the node echoes the requested height |
| Trade replay | 23 Sep 2026 → now | Curve supply rebuilt from every `swap` event, walking backwards from verified state; checked against all 96 state samples (max error < 0.000001 WESO); price from the verified spec |
| Documented snapshots | 22 Mar 2026 | Luna Classic DAO Medium post: 39.71 LUNC per WESO. Plotted as a separate marker |
| DefiLlama | 7 Sep 2026 → now | `api.llama.fi/protocol/weso-defi` daily protocol TVL |
| LUNC/USD | 365 days | CoinGecko `terra-luna` market_chart (hourly for 90 days) |

**Skipped, and why:** daily history before 23 Sep 2026 needs an archive node. Public Terra Classic nodes prune state and the tx index after 2–4 weeks. WESO is not on CoinGecko or CMC, DefiLlama has no WESO price, and GeckoTerminal doesn't index Terra Classic, so there is no third-party price history to fall back on. With an archive LCD, run `build-history.mjs --lcd <archive> --tx-lcd <archive>` to cover the whole contract life.

**Gotcha found while building this:** `terra-classic-lcd.publicnode.com` returned cached state for other block heights on historical queries, even with a cache-busting parameter. Historical reads therefore use `lcd.terra-classic.hexxagon.io`, which echoes the height. Its tx index is load-balanced across backends with different retention, so the tx search uses publicnode in height-ranged chunks.

## Listing data (`data/listing/`)

Static files with the fields CoinGecko and CoinMarketCap ask for:

- `weso.json`: price (USD, LUNC), total / circulating / max supply, market cap, FDV, 24h and 7d volume, TVL, price change, non-circulating wallets with balances, sources, coverage.
- `supply/total.txt`, `supply/circulating.txt`, `supply/max.txt`: plain-number supply endpoints (`max` is `null`; there is no cap on chain). `supply/supply.json` has all of them.
- `history/weso-daily.{csv,json}`: daily OHLC (LUNC), close USD, volume, supplies, market cap, FDV, TVL and a `source` per row.
- `history/weso-intraday.{csv,json}`: state samples with block heights.
- `history/weso-market_chart.json`: CoinGecko `market_chart` shape (`prices`, `market_caps`, `total_volumes`).
- `history/weso-trades.json`: every swap with tx hash; `defillama-tvl.json`; `lunc-usd.json`.

Circulating supply = total − balances of the WESO contract (XYK inventory), the Capacitor DAO pool, the Luna Classic DAO treasury and the WESO DeFi Sub-DAO (`data/registry.json` → `listing.non_circulating`). Unlabelled large holders count as circulating; see `methodology.html#circulating`.

## Refreshing the data

All scripts are read-only (GET requests only) and need Node 18+ and no dependencies.

```bash
cd web/curve-stats
node scripts/verify-spec.mjs        # spec vs sheet and chain simulates (must print PASS)
node scripts/refresh-snapshot.mjs   # data/snapshot.json (live fallback)
node scripts/build-data.mjs         # data/bundle.js (registry + specs + snapshot)
node scripts/build-history.mjs      # data/listing/** and data/history-bundle.js (~30 s)
```

In the browser the page also re-reads price, supply and staking live from the public LCD and CoinGecko every 2 minutes (both allow CORS) and appends the live point to the history charts. `?offline=1` disables that.

## Files

- `assets/curve-model.js`: piecewise curve math (price, integral, inverse) shared by the page and scripts.
- `assets/app.js`: curve chart (tweened zoom, scrubbable marker), stats cards, milestones, live refresh; loads the history section on demand.
- `assets/history.js`: price history section, exports and embeds (charts initialise when scrolled into view).
- `data/registry.json`: curves, contracts, non-circulating wallets, documented snapshots, endpoints.
- `data/weso-curves2.spec.json`: verified Curves 2.0 spec; `data/rebase-sampled.json`: reBASE knots.
- `vendor/echarts-5.5.1.custom.min.js` (Apache-2.0) is a tree-shaken ECharts 5.5.1 with only the chart types and components the pages use (0.6 MB instead of 1.0 MB). `scripts/build-echarts.sh` rebuilds it from `scripts/echarts-entry.js`; that is a one-off dev step, not needed to serve. Geist fonts (OFL) are vendored too, so the page works offline.
- `_screens/`: review screenshots (v1 baseline and v2, desktop 1440×900 and mobile 390×844).
