# WESO bonding-curve stats · v2

Upgrade of the v1 static site (commit `87df409`). Same data, same functionality, tighter and smoother. Still a static site: relative paths only, no build step to serve, every library vendored.

## What changed

### Look and feel
- **4 px spacing grid** (`--s1`…`--s12`) and three radii replace ad-hoc rem values; panels, cards, tiles, tables and chips all sit on it.
- **Glass panels**: translucent surfaces with `backdrop-filter`, a 1 px inner highlight, a masked pink→cyan gradient edge, and a soft drop shadow. Cards keep the v1 colour families (pink / cyan / amber / green / red / violet) with a crisper 1 px border, top-right sheen and hover lift only on hover-capable devices.
- **Palette re-checked against weso.world** (CSS fetched 2026-10-10). The `.dark` tokens there are identical to v1's (`--neon-pink oklch(65% .25 330)`, `--neon-cyan`, `--neon-green`, `--neon-yellow`, `--panel-bg`, Geist / Geist Mono), so the palette is unchanged; the neon button glow and star backdrop follow the site's own values.
- Header slimmed to 56 px with a gradient top rule, a pulsing LIVE / SNAPSHOT pill of fixed width (no shift when the text changes), and the current section highlighted in the nav.
- Hero title and lede are smaller and shorter; ticker tiles carry a per-colour top glow; the progress bar is thinner with lighter tick labels.
- Toggles are real switches; zoom chips show a green dot on the window that contains today's position instead of a pink border.
- **"Team preview · do not share"** banner (sticky, striped yellow) on every page, also in the embed footer and page footers.

### Typography and copy
- `font-variant-numeric: tabular-nums` globally; all numbers in Geist Mono.
- Label sizes consolidated (11–12 px uppercase labels, 15 px body, 12–13 px table cells), weights 600/700/850 only.
- Shorter labels and subtitles everywhere: "Bonded so far" → "Bonded", "All 10 yrs" → "10 yrs", "Drag along the curve" → "Marker", "Jump to current supply" → "Jump to now", "Price at plan supply" → "Price at plan", "Share of 7B design cap" → "Of 7B design cap", "Total supply + mining" → "Total + mining", and so on. Explanatory footnotes keep every fact but drop filler clauses. No numbers were added or changed.

### Smoother
- **Animated zoom transitions**: milestone / year chips tween the data-zoom window over 480 ms (ease-in-out cubic) with a `requestAnimationFrame` loop; wheel, drag and pinch zoom stay instant (`animationDurationUpdate: 0`, zoom throttle 16 ms). Honors `prefers-reduced-motion`.
- **Scrubbable marker**: the yellow marker is now a DOM overlay on the chart with a 34 px grab handle. Drag it with mouse or touch (pointer capture, `touch-action: none` on the handle, `pan-y` on the chart so the page still scrolls), click anywhere on the plot, use the slider below, or focus the handle and use ←/→/Home/End (1 % steps). Its label follows the dot and stays inside the plot. Readout tiles update in place (text only, no re-render) at one update per frame. Measured in headless Chrome: 16.3 ms average frame time while dragging.
- Chart canvases use ECharts dirty-rect rendering; resizes go through `ResizeObserver` with a 120 ms debounce.
- **Skeleton loading**: tabs, ticker, the curve chart and the history charts show shimmer placeholders before data arrives; the chart skeleton is an animated dashed curve that fades out on first render.
- **No layout shift**: every placeholder has the final height (desktop and mobile), the status pill has a fixed width, fonts are preloaded with a size-adjusted fallback. Lighthouse CLS: 0.009 desktop, 0.016 mobile (both were 0 in a direct `PerformanceObserver` measurement).
- **Lazy init**: the four history charts initialise only when their card comes within 240 px of the viewport. The history data bundle and `history.js` (≈230 KB) are not on the critical path at all: `app.js` injects them when the section comes within 800 px of the viewport or when the page is idle, whichever comes first, then mounts the section and forwards the live price if one has already been read.
- **Mobile**: horizontal chip rails scroll, the legend is centred so it no longer collides with axis names, grid padding adapts, the marker handle is 34 px, and the embed uses `100dvh`.
- A toast confirms manual refreshes ("Chain read · block N" or "Chain read failed · showing snapshot").

### Performance (Lighthouse 12, headless Chrome, local `python3 -m http.server`, no compression)
| | v2 desktop | v2 mobile (simulated slow 4G, 4× CPU) |
|---|---|---|
| Performance | 97 | 76 |
| Accessibility | 100 | 100 |
| Best practices | 100 | 96 |
| LCP | 1.2 s | 5.3 s |
| TBT | 30 ms | 220 ms |
| CLS | 0.009 | 0.016 |

Mobile LCP is dominated by transferring the ECharts bundle uncompressed from the test server. GitHub Pages serves gzip/brotli, which cuts that transfer by roughly two thirds. The "is-crawlable" SEO audit fails on purpose: every page carries `noindex` while it is a team preview.

- **ECharts trimmed from 1.03 MB to 0.60 MB**: `vendor/echarts-5.5.1.custom.min.js` is a tree-shaken build of the same version with only the pieces the pages use (line, bar, scatter, effect-scatter; grid, tooltip, axis pointer, legend, data-zoom inside + slider, mark line, mark area, title, graphic; canvas renderer). The entry file is `scripts/echarts-entry.js` and `scripts/build-echarts.sh` rebuilds it; neither is needed to serve the site.
- All scripts are `defer`; both fonts are preloaded; the `chart-sub` text is in the HTML so first paint is meaningful before any JS runs.

### Accessibility
- Skip link, `aria-pressed` on every toggle chip and segment, `role="slider"` with value on the marker handle, keyboard arrow navigation on the curve tabs, `aria-live` on the status pill and ticker, `aria-describedby` from the chart to its readout, labelled progress bar, `scope` on table headers.
- Heading order fixed (`h2` → `h3` in notes and methodology cards); the progress tick labels and small print were lightened to pass contrast.
- Visible `:focus-visible` rings, a `print` stylesheet, `prefers-reduced-motion` disables all transitions and the zoom tween.

### Kept exactly as v1
- Multi-curve registry (WESO first, then reBASE), every stat card, the milestone table, flags, footer sources.
- Price history & performance: price / volume / market cap / TVL charts with 24h–All ranges, USD/LUNC switch, PNG (titled, time-stamped, sourced) and CSV export, embed dialog and `embed.html`, "no public chain history" bands, documented-snapshot diamonds, performance table and KPI tiles.
- `data/` and `data/listing/` untouched; `methodology.html` content unchanged apart from the banner and heading levels.
- Live LCD refresh every 2 minutes with snapshot fallback (`?offline=1` disables it); URL state (`curve`, `view`, `zoom`, `log`, `hrange`, `hccy`) plus a new `cum=0`.

### Housekeeping
- Removed the macOS `._*` AppleDouble files that were tracked in v1 and added a `.gitignore` for them.
- Fixed a v1 bug where the reBASE footnote printed "block —" (the block height is a string in the spec file).
- `_screens/` holds the review screenshots: `v1-*` baselines and the `v2-*` set (desktop 1440×900, mobile 390×844, full page, by-year view, reBASE, history, stats, embed, methodology, and post-interaction captures of the tweened zoom, marker drag and log scale).

## Not done / open
- Palette validation with the dataviz checker passes CVD separation (ΔE ≥ 14) and contrast on the dark surface but fails the "lightness band" check, because the brand palette is intentionally neon. Kept for brand fidelity.
- The curve chart still offers the v1 secondary axis ("Cumulative LUNC" / "Price on plan") as an optional overlay. It is a dual-axis chart when enabled; it stays because the owner's v1 had it.
- GitHub Pages compression and caching headers cannot be set from the repo; the vendored bundle sizes above are uncompressed.
