/* WESO price history & performance: listing-style charts with PNG / CSV / embed.
   Data: window.HISTORY_DATA from scripts/build-history.mjs (data/history-bundle.js).
   Used by index.html (full section) and embed.html (one chart). */
(function () {
  "use strict";

  const HD = window.HISTORY_DATA;
  const HOUR = 3600000;
  const DAY = 86400000;
  const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const C = {
    pink: "#f6339a",
    pink400: "#fb64b6",
    purple: "#ac4bff",
    cyan: "#00d2ef",
    yellow: "#fac800",
    green: "#05df72",
    red: "#ff6568",
    text: "#d1d5dc",
    muted: "#8f8f8f",
    grid: "rgba(255,255,255,0.06)",
    font: '"Geist", ui-sans-serif, system-ui, sans-serif',
    mono: '"Geist Mono", ui-monospace, monospace',
  };
  const RANGES = {
    "24h": { label: "24h", span: DAY, src: "intra", bin: HOUR },
    "7d": { label: "7d", span: 7 * DAY, src: "intra", bin: 4 * HOUR },
    "30d": { label: "30d", span: 30 * DAY, src: "daily", bin: DAY },
    "1y": { label: "1y", span: 365 * DAY, src: "daily", bin: DAY },
    all: { label: "All", span: null, src: "daily", bin: DAY },
  };
  const CHARTS = {
    price: { title: "Price", file: "price" },
    volume: { title: "Volume", file: "volume" },
    mcap: { title: "Market cap", file: "market-cap" },
    tvl: { title: "TVL", file: "tvl" },
  };

  /* ---------- formatting ---------- */
  const nf = (d) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmt = (x, d = 0) => (Number.isFinite(x) ? nf(d).format(x) : "—");
  function compact(x, d = 2) {
    if (!Number.isFinite(x)) return "—";
    const a = Math.abs(x);
    if (a >= 1e12) return (x / 1e12).toFixed(d) + "T";
    if (a >= 1e9) return (x / 1e9).toFixed(d) + "B";
    if (a >= 1e6) return (x / 1e6).toFixed(d) + "M";
    if (a >= 1e3) return (x / 1e3).toFixed(d) + "k";
    return x.toFixed(d);
  }
  function usd(x, sig) {
    if (!Number.isFinite(x)) return "—";
    const a = Math.abs(x);
    if (a >= 1e6) return "$" + compact(x, 2);
    if (a >= 1000) return "$" + fmt(x, 0);
    if (a >= 1) return "$" + fmt(x, 2);
    if (a === 0) return "$0";
    return "$" + x.toPrecision(sig || 4);
  }
  const lunc = (x, d) => (Number.isFinite(x) ? (Math.abs(x) >= 1e5 ? compact(x, 2) : fmt(x, d == null ? 4 : d)) + " LUNC" : "—");
  const money = (x, ccy, d) => (ccy === "usd" ? usd(x) : lunc(x, d));
  const axisMoney = (ccy) => (v) => (ccy === "usd" ? "$" : "") + (Math.abs(v) >= 1000 ? compact(v, Math.abs(v) >= 1e6 ? 2 : 1) : +v.toPrecision(5));
  const pct = (x, d = 2) => (Number.isFinite(x) ? (x > 0 ? "+" : "") + (x * 100).toFixed(d) + "%" : "—");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const dayLabel = (ms) => new Date(ms).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const shortDay = (ms) => new Date(ms).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
  const stamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

  if (!HD) {
    window.WesoHistory = { mount() {}, embed() {}, setLive() {} };
    return;
  }

  /* ---------- data ---------- */
  const LIST = HD.listing;
  const COV = LIST.coverage;
  const LAUNCH = Date.parse((HD.launch_anchor || "2025-01-22") + "T00:00:00Z");
  const lastUpdated = Date.parse(LIST.last_updated);
  const intra = HD.intraday.map((r) => ({
    t: Date.parse(r.time),
    pl: r.price_lunc,
    pu: r.price_usd,
    lu: r.lunc_usd,
    circ: r.circulating_supply,
    total: r.total_supply,
    tvlL: r.tvl_onchain_lunc,
    tvlU: r.tvl_onchain_usd,
    src: "chain-state",
  }));
  const chainDaily = HD.daily
    .filter((r) => r.source && r.source.startsWith("chain"))
    .map((r) => {
      const d = Date.parse(r.date + "T00:00:00Z");
      return {
        t: Math.min(d + DAY, lastUpdated),
        date: r.date,
        pl: r.close_lunc,
        pu: r.close_usd,
        lu: r.lunc_usd,
        open: r.open_lunc,
        high: r.high_lunc,
        low: r.low_lunc,
        circ: r.circulating_supply,
        total: r.total_supply,
        tvlU: r.tvl_onchain_usd,
        tvlL: r.tvl_onchain_usd != null ? r.tvl_onchain_usd / r.lunc_usd : null,
        est: !!r.circulating_estimated,
        partial: !!r.partial_day,
        src: r.source,
      };
    });
  const documented = HD.daily
    .filter((r) => r.source === "documented")
    .map((r) => ({ t: Date.parse(r.date + "T00:00:00Z"), date: r.date, pl: r.close_lunc, pu: r.close_usd, lu: r.lunc_usd, note: r.source_note, src: "documented" }));
  const llama = (HD.defillama_tvl || []).map(([t, v]) => ({ t, usd: v }));
  const luncDaily = HD.lunc_usd_daily || [];
  const trades = HD.trades.map(([t, pool, buy, weso, l, u]) => ({ t, pool, buy, weso, lunc: l, usd: u }));
  const tradeStart = Date.parse(COV.trades_from);
  const priceStart = Date.parse(COV.price_from_trades_from || COV.chain_history_from);
  const stateStart = Date.parse(COV.chain_history_from);
  const poolTrades = trades.filter((t) => t.pool).length;

  function luncAt(t) {
    if (live && Math.abs(t - live.t) < 2 * HOUR) return live.lu;
    if (!luncDaily.length) return null;
    if (t <= luncDaily[0][0]) return luncDaily[0][1];
    for (let i = 1; i < luncDaily.length; i++) {
      if (luncDaily[i][0] >= t) {
        const [ta, pa] = luncDaily[i - 1];
        const [tb, pb] = luncDaily[i];
        return pa + ((t - ta) / (tb - ta)) * (pb - pa);
      }
    }
    return luncDaily[luncDaily.length - 1][1];
  }

  let live = null;
  const now = () => (live ? Math.max(live.t, lastUpdated) : lastUpdated);
  function liveRow(base) {
    const last = base[base.length - 1];
    if (!live || live.t <= last.t) return null;
    return {
      t: live.t,
      pl: live.pl,
      pu: live.pl * live.lu,
      lu: live.lu,
      circ: last.circ,
      total: last.total,
      tvlL: last.tvlL,
      tvlU: last.tvlL != null ? last.tvlL * live.lu : null,
      src: "live",
    };
  }
  const current = () => liveRow(intra) || intra[intra.length - 1];

  function windowFor(rangeKey) {
    const R = RANGES[rangeKey];
    const end = now();
    const start = R.span ? end - R.span : Math.min(LAUNCH, documented.length ? documented[0].t : LAUNCH) - 7 * DAY;
    return { R, start, end };
  }
  function rowsFor(rangeKey) {
    const w = windowFor(rangeKey);
    const base = w.R.src === "intra" ? intra : chainDaily;
    const out = base.filter((r) => r.t >= w.start && r.t <= w.end);
    const lr = liveRow(base);
    if (lr) out.push(lr);
    return { ...w, rows: out };
  }
  function valueAt(series, t) {
    let best = null;
    for (const r of series) if (r.t <= t) best = r;
    return best;
  }

  /* ---------- chart options ---------- */
  function tooltip(formatter) {
    return {
      trigger: "axis",
      confine: true,
      backgroundColor: "rgba(6,6,15,0.94)",
      borderColor: "rgba(246,51,154,0.55)",
      borderWidth: 1,
      padding: [10, 12],
      textStyle: { color: "#eee", fontFamily: C.font, fontSize: 12 },
      extraCssText: "box-shadow:0 0 20px rgba(0,255,255,0.18);border-radius:10px;",
      axisPointer: { type: "line", lineStyle: { color: "rgba(250,200,0,0.6)", type: "dashed" } },
      formatter,
    };
  }
  const tipRow = (label, value, color) =>
    `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7"><span style="color:#99a1af">${
      color ? `<i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:6px"></i>` : ""
    }${label}</span><b style="font-family:${C.mono};color:#fff">${value}</b></div>`;
  const tipHead = (t, rangeKey, extra) =>
    `<div style="font-weight:700;margin-bottom:4px">${RANGES[rangeKey].src === "intra" ? stamp(t) : dayLabel(t)}${extra ? ` <span style="color:#99a1af;font-weight:500">${extra}</span>` : ""}</div>`;
  const srcName = { "chain-state": "chain state", "chain-trades": "trade replay", live: "live", documented: "documented", defillama: "DefiLlama" };

  function gapArea(w, from) {
    if (w.start >= from) return null;
    return {
      silent: true,
      itemStyle: { color: "rgba(255,255,255,0.035)", borderColor: "rgba(255,255,255,0.12)", borderType: "dashed", borderWidth: 1 },
      label: {
        show: true,
        position: "insideBottom",
        distance: 14,
        color: "#6a7282",
        fontFamily: C.mono,
        fontSize: 10,
        lineHeight: 14,
        formatter: "No public chain history\n(pruned nodes; archive node needed)",
      },
      data: [[{ xAxis: w.start }, { xAxis: from }]],
    };
  }

  function baseOption(w, rangeKey, compactMode) {
    return {
      backgroundColor: "transparent",
      useUTC: true,
      animation: !REDUCED,
      animationDuration: 500,
      animationDurationUpdate: 320,
      animationEasingUpdate: "cubicOut",
      textStyle: { fontFamily: C.font },
      grid: { left: 6, right: compactMode ? 12 : 16, top: 32, bottom: 4, containLabel: true },
      xAxis: {
        type: "time",
        min: w.start,
        max: w.end,
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.18)" } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: C.muted,
          fontFamily: C.mono,
          fontSize: 10,
          hideOverlap: true,
          formatter:
            rangeKey === "1y" || rangeKey === "all"
              ? { year: "{yyyy}", month: "{MMM} '{yy}", day: "{d} {MMM}", hour: "{HH}:{mm}", minute: "{HH}:{mm}" }
              : { year: "{d} {MMM}", month: "{d} {MMM}", day: "{d} {MMM}", hour: "{HH}:{mm}", minute: "{HH}:{mm}" },
        },
      },
      yAxis: {
        type: "value",
        scale: true,
        splitNumber: 4,
        axisLine: { show: false },
        splitLine: { lineStyle: { color: C.grid } },
        axisLabel: { color: C.muted, fontFamily: C.mono, fontSize: 10 },
      },
      legend: {
        top: 2,
        right: 4,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: C.text, fontSize: 11 },
        icon: "roundRect",
      },
      series: [],
    };
  }
  const areaFill = (hex, a1, a2) => ({
    color: {
      type: "linear",
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: hex + a1 },
        { offset: 1, color: hex + a2 },
      ],
    },
  });

  function priceChart(rangeKey, ccy, compactMode) {
    const w = rowsFor(rangeKey);
    const key = ccy === "usd" ? "pu" : "pl";
    const color = ccy === "usd" ? C.pink : C.cyan;
    const opt = baseOption(w, rangeKey, compactMode);
    const docs = w.R.src === "daily" ? documented.filter((d) => d.t >= w.start && d.t <= w.end) : [];
    opt.yAxis.axisLabel.formatter = axisMoney(ccy);
    opt.legend.data = [ccy === "usd" ? "Price (USD)" : "Price (LUNC)"].concat(docs.length ? ["Documented"] : []);
    const gap = w.R.src === "daily" ? gapArea(w, priceStart) : null;
    opt.series.push({
      name: opt.legend.data[0],
      type: "line",
      showSymbol: w.rows.length < 3,
      symbolSize: 6,
      smooth: false,
      lineStyle: { width: 2, color, shadowColor: color, shadowBlur: 10 },
      itemStyle: { color },
      areaStyle: areaFill(color, "55", "00"),
      data: w.rows.map((r) => [r.t, r[key], r]),
      markArea: gap || undefined,
    });
    if (docs.length) {
      opt.series.push({
        name: "Documented",
        type: "scatter",
        symbol: "diamond",
        symbolSize: 13,
        itemStyle: { color: C.yellow, shadowColor: C.yellow, shadowBlur: 10 },
        label: { show: true, position: "top", color: C.yellow, fontFamily: C.mono, fontSize: 10, formatter: (p) => `${shortDay(p.value[0])}: ${p.value[2].pl} LUNC` },
        data: docs.map((d) => [d.t, d[key], d]),
      });
    }
    opt.tooltip = tooltip((ps) => {
      const r = ps[0].value[2];
      return (
        tipHead(r.t, rangeKey, srcName[r.src] || "") +
        tipRow("Price (USD)", usd(r.pu, 5), ccy === "usd" ? color : null) +
        tipRow("Price (LUNC)", lunc(r.pl, 4), ccy === "lunc" ? color : null) +
        (r.high != null ? tipRow("Day high / low", `${fmt(r.high, 4)} / ${fmt(r.low, 4)}`) : "") +
        tipRow("LUNC/USD", r.lu != null ? "$" + r.lu.toPrecision(4) : "—") +
        (r.note ? `<div style="max-width:260px;white-space:normal;color:#99a1af;font-size:11px;margin-top:4px">${esc(r.note)}</div>` : "")
      );
    });
    const vals = w.rows.map((r) => r[key]).filter(Number.isFinite);
    const first = w.rows[0];
    const last = w.rows[w.rows.length - 1];
    const meta = vals.length
      ? `High <b>${money(Math.max(...vals), ccy, 4)}</b> · Low <b>${money(Math.min(...vals), ccy, 4)}</b> · Change <b class="${last[key] >= first[key] ? "up" : "down"}">${pct(last[key] / first[key] - 1)}</b>${
          docs.length ? ` · vs ${shortDay(docs[0].t)} (doc.) <b class="${last[key] >= docs[0][key] ? "up" : "down"}">${pct(last[key] / docs[0][key] - 1)}</b>` : ""
        }`
      : "";
    const cols = ["time_utc", "price_usd", "price_lunc", "lunc_usd", "source"];
    const rows = docs
      .map((d) => [isoDay(d.t), d.pu, d.pl, d.lu, "documented: " + d.note])
      .concat(w.rows.map((r) => [new Date(r.t).toISOString(), r.pu, r.pl, r.lu, srcName[r.src] || r.src]));
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const source =
      w.R.src === "intra"
        ? `Chain: <code>curve_info.spot_price</code> read at each sampled block (historical LCD state, height-verified)${live ? " + live read" : ""}. USD = LUNC price × CoinGecko LUNC/USD.`
        : `Chain: daily close from historical state from ${shortDay(stateStart)}, from replaying curve trades through the verified spec from ${shortDay(priceStart)}.${docs.length ? " Yellow diamond: documented snapshot (Medium, 22 Mar 2026)." : ""} USD via CoinGecko LUNC/USD.`;
    return { opt, meta, cols, rows, source };
  }

  function volumeChart(rangeKey, ccy, compactMode) {
    const w = windowFor(rangeKey);
    const bin = w.R.bin;
    const from = Math.floor(Math.max(w.start, tradeStart) / bin) * bin;
    const bins = [];
    for (let t = from; t <= w.end; t += bin) bins.push({ t, buy: 0, sell: 0, n: 0, weso: 0 });
    const k = ccy === "usd" ? "usd" : "lunc";
    for (const tr of trades) {
      if (tr.t < from || tr.t > w.end) continue;
      const b = bins[Math.floor((tr.t - from) / bin)];
      if (!b) continue;
      b[tr.buy ? "buy" : "sell"] += tr[k];
      b.n++;
      b.weso += tr.weso;
    }
    const opt = baseOption(w, rangeKey, compactMode);
    opt.yAxis.scale = false;
    opt.yAxis.axisLabel.formatter = axisMoney(ccy);
    opt.legend.data = ["Buys", "Sells"];
    const barW = rangeKey === "all" || rangeKey === "1y" ? "60%" : "70%";
    const mid = (b) => b.t + bin / 2;
    opt.series.push(
      {
        name: "Buys",
        type: "bar",
        stack: "v",
        barWidth: barW,
        itemStyle: { color: C.green, opacity: 0.85 },
        data: bins.map((b) => [mid(b), b.buy, b]),
        markArea: w.R.src === "daily" ? gapArea(w, tradeStart) || undefined : undefined,
      },
      {
        name: "Sells",
        type: "bar",
        stack: "v",
        barWidth: barW,
        itemStyle: { color: C.pink, opacity: 0.85, borderRadius: [2, 2, 0, 0] },
        data: bins.map((b) => [mid(b), b.sell, b]),
      },
    );
    if (rangeKey === "all" || rangeKey === "1y") opt.series.forEach((s) => (s.barMaxWidth = 6));
    opt.tooltip = tooltip((ps) => {
      const b = ps[0].value[2];
      return (
        tipHead(b.t, rangeKey, bin < DAY ? `+${bin / HOUR}h` : "") +
        tipRow("Volume", money(b.buy + b.sell, ccy, 0)) +
        tipRow("Buys", money(b.buy, ccy, 0), C.green) +
        tipRow("Sells", money(b.sell, ccy, 0), C.pink) +
        tipRow("Trades", fmt(b.n)) +
        tipRow("WESO traded", compact(b.weso, 2))
      );
    });
    const tot = bins.reduce((s, b) => s + b.buy + b.sell, 0);
    const n = bins.reduce((s, b) => s + b.n, 0);
    const meta = `Total <b>${money(tot, ccy, 0)}</b> · <b>${fmt(n)}</b> trades${from > w.start + bin ? ` · since ${shortDay(from)}` : ""}`;
    const cols = ["bin_start_utc", "bin_hours", `buy_volume_${k}`, `sell_volume_${k}`, `total_volume_${k}`, "trades", "weso_traded", "source"];
    const rows = bins.map((b) => [new Date(b.t).toISOString(), bin / HOUR, b.buy, b.sell, b.buy + b.sell, b.n, b.weso, "chain swap events"]);
    const source = `Chain: every <code>swap</code> event on the WESO curve contract from the LCD tx index (from ${stamp(tradeStart)}). ${
      poolTrades ? `${poolTrades} WesoSwap pool trades included.` : "WesoSwap pools: no WESO swaps in this window."
    } Buys counted at LUNC paid (incl. 1.99% tax), sells at LUNC received.${ccy === "usd" ? " USD at the hourly LUNC price." : ""}`;
    return { opt, meta, cols, rows, source };
  }

  function mcapChart(rangeKey, ccy, compactMode) {
    const w = rowsFor(rangeKey);
    const key = ccy === "usd" ? "pu" : "pl";
    const opt = baseOption(w, rangeKey, compactMode);
    opt.yAxis.axisLabel.formatter = axisMoney(ccy);
    opt.legend.data = ["Market cap", "FDV"];
    const gap = w.R.src === "daily" ? gapArea(w, priceStart) : null;
    opt.series.push(
      {
        name: "Market cap",
        type: "line",
        showSymbol: w.rows.length < 3,
        lineStyle: { width: 2, color: C.purple, shadowColor: C.purple, shadowBlur: 10 },
        itemStyle: { color: C.purple },
        areaStyle: areaFill(C.purple, "55", "00"),
        data: w.rows.map((r) => [r.t, r.circ * r[key], r]),
        markArea: gap || undefined,
      },
      {
        name: "FDV",
        type: "line",
        showSymbol: false,
        lineStyle: { width: 1.5, color: C.yellow, type: "dashed" },
        itemStyle: { color: C.yellow },
        data: w.rows.map((r) => [r.t, r.total * r[key], r]),
      },
    );
    opt.tooltip = tooltip((ps) => {
      const r = ps[0].value[2];
      return (
        tipHead(r.t, rangeKey, srcName[r.src] || "") +
        tipRow("Market cap", money(r.circ * r[key], ccy, 0), C.purple) +
        tipRow("FDV (total supply)", money(r.total * r[key], ccy, 0), C.yellow) +
        tipRow("Circulating", compact(r.circ, 2) + (r.est ? " (held)" : "")) +
        tipRow("Total supply", compact(r.total, 3))
      );
    });
    const last = w.rows[w.rows.length - 1];
    const meta = last ? `Now <b>${money(last.circ * last[key], ccy, 0)}</b> · FDV <b>${money(last.total * last[key], ccy, 0)}</b>` : "";
    const cols = ["time_utc", `market_cap_${ccy}`, `fdv_${ccy}`, "circulating_supply", "total_supply", "circulating_estimated", "source"];
    const rows = w.rows.map((r) => [new Date(r.t).toISOString(), r.circ * r[key], r.total * r[key], r.circ, r.total, r.est ? 1 : 0, srcName[r.src] || r.src]);
    const source = `Market cap = circulating × price; FDV = total supply × price (no max supply on chain). Circulating = total − 4 protocol/DAO wallets, read at each sampled block${
      w.R.src === "daily" && w.start < stateStart ? `; before ${shortDay(stateStart)} it is held at the first verified value` : ""
    }. See <a href="methodology.html#circulating">methodology</a>.`;
    return { opt, meta, cols, rows, source };
  }

  function tvlChart(rangeKey, ccy, compactMode) {
    const w = rowsFor(rangeKey);
    const opt = baseOption(w, rangeKey, compactMode);
    opt.yAxis.axisLabel.formatter = axisMoney(ccy);
    opt.legend.data = ["Curve backing (chain)", "DefiLlama protocol TVL"];
    const chainRows = w.rows.filter((r) => r.tvlL != null);
    const conv = (u, t) => (ccy === "usd" ? u : u / luncAt(t));
    const ll = llama.filter((x) => x.t >= w.start - DAY && x.t <= w.end);
    const llEnd = ll.length && ll[ll.length - 1].t < w.end ? [{ t: w.end, usd: ll[ll.length - 1].usd, carry: true }] : [];
    opt.series.push(
      {
        name: "Curve backing (chain)",
        type: "line",
        showSymbol: chainRows.length < 3,
        lineStyle: { width: 2, color: C.cyan, shadowColor: C.cyan, shadowBlur: 10 },
        itemStyle: { color: C.cyan },
        areaStyle: areaFill(C.cyan, "40", "00"),
        data: chainRows.map((r) => [r.t, ccy === "usd" ? r.tvlU : r.tvlL, r]),
        markArea: w.R.src === "daily" ? gapArea(w, Math.min(stateStart, ll.length ? ll[0].t : stateStart)) || undefined : undefined,
      },
      {
        name: "DefiLlama protocol TVL",
        type: "line",
        step: "end",
        showSymbol: false,
        lineStyle: { width: 1.5, color: C.yellow },
        itemStyle: { color: C.yellow },
        data: ll.concat(llEnd).map((x) => [Math.max(x.t, w.start), conv(x.usd, x.t), x]),
      },
    );
    opt.tooltip = tooltip((ps) => {
      const t = ps[0].value[0];
      const c = valueAt(chainRows, t + 60000);
      const l = valueAt(llama, t + 60000);
      return (
        tipHead(t, rangeKey) +
        tipRow("Curve backing", c ? money(ccy === "usd" ? c.tvlU : c.tvlL, ccy, 0) : "—", C.cyan) +
        tipRow("DefiLlama TVL", l ? money(conv(l.usd, l.t), ccy, 0) : "—", C.yellow) +
        (l ? tipRow("DefiLlama day", shortDay(l.t)) : "")
      );
    });
    const last = chainRows[chainRows.length - 1];
    const lastL = ll[ll.length - 1];
    const meta = `Chain <b>${last ? money(ccy === "usd" ? last.tvlU : last.tvlL, ccy, 0) : "—"}</b> · DefiLlama <b>${lastL ? money(conv(lastL.usd, lastL.t), ccy, 0) : "—"}</b>`;
    const cols = ["time_utc", "series", `tvl_${ccy}`, "source"];
    const rows = chainRows
      .map((r) => [new Date(r.t).toISOString(), "curve_backing_chain", ccy === "usd" ? r.tvlU : r.tvlL, "liquid LUNC in WESO contract + Validator DAO delegations"])
      .concat(ll.map((x) => [new Date(x.t).toISOString(), "defillama_protocol_tvl", conv(x.usd, x.t), "api.llama.fi/protocol/weso-defi"]));
    rows.sort((a, b) => a[0].localeCompare(b[0]));
    const source = `Chain: liquid LUNC held by the WESO contract plus LUNC delegated by the Validator Network DAO (historical state from ${shortDay(stateStart)}). DefiLlama: <a href="https://defillama.com/protocol/weso-defi" rel="noopener">WESO DeFi</a> protocol TVL, daily from ${
      llama.length ? shortDay(llama[0].t) : "—"
    }; it also counts the CWLUNC/CWUSTC wrap vaults and AMM pools.`;
    return { opt, meta, cols, rows, source };
  }

  const BUILDERS = { price: priceChart, volume: volumeChart, mcap: mcapChart, tvl: tvlChart };

  /* ---------- export ---------- */
  function download(name, data, mime) {
    const a = document.createElement("a");
    a.download = name;
    a.href = typeof data === "string" && data.startsWith("data:") ? data : URL.createObjectURL(new Blob([data], { type: mime }));
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (!a.href.startsWith("data:")) URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }
  function toCsv(cols, rows) {
    const cell = (v) => {
      if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "";
      if (typeof v === "number") return String(+v.toPrecision(12));
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [cols.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n";
  }
  const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
  const fileBase = (id, s) => `weso-${CHARTS[id].file}-${s.ccy}-${s.range}-${isoDay(now())}`;

  /* ---------- views ---------- */
  const views = [];
  function makeCard(id, s, opts) {
    const el = document.createElement("article");
    el.className = "hcard";
    el.dataset.chart = id;
    el.innerHTML = `
      <header class="hcard-head">
        <div><h3>${CHARTS[id].title} <span class="hc-ccy"></span></h3><div class="hc-meta"></div></div>
        <div class="hc-actions" role="group" aria-label="Export ${CHARTS[id].title}">
          <button type="button" class="hc-btn" data-act="png" title="Download PNG">PNG</button>
          <button type="button" class="hc-btn" data-act="csv" title="Download CSV">CSV</button>
          ${opts.embed ? "" : `<button type="button" class="hc-btn" data-act="embed" title="Embed code">&lt;/&gt; Embed</button>`}
        </div>
      </header>
      <div class="hchart" role="img" aria-label="WESO ${CHARTS[id].title} chart"><div class="chart-skel" aria-hidden="true"><svg viewBox="0 0 1000 300" preserveAspectRatio="none"><path d="M0 240 C 150 230, 250 120, 400 160 S 650 60, 800 110 S 950 40, 1000 70" vector-effect="non-scaling-stroke" style="stroke:#00d2ef"/></svg></div></div>
      <p class="hsrc"></p>`;
    const view = { id, el, s, chart: null, last: null, compact: !!opts.compact, visible: false, dirty: false };
    lazyInit(view);
    el.querySelector(".hc-actions").addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      if (b.dataset.act === "png") exportPng(view);
      if (b.dataset.act === "csv") download(fileBase(id, view.s) + ".csv", toCsv(view.last.cols, view.last.rows), "text/csv");
      if (b.dataset.act === "embed") openEmbed(view);
    });
    views.push(view);
    return view;
  }
  /* Charts initialise only when their card is near the viewport. */
  function lazyInit(view) {
    if (!("IntersectionObserver" in window)) {
      view.visible = true;
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        view.visible = true;
        if (view.dirty) draw(view);
      },
      { rootMargin: "240px 0px" },
    );
    io.observe(view.el);
  }
  function draw(view) {
    const { id, s } = view;
    const out = BUILDERS[id](s.range, s.ccy, view.compact || window.innerWidth < 760);
    view.last = out;
    view.el.querySelector(".hc-ccy").textContent = `· ${s.ccy.toUpperCase()} · ${RANGES[s.range].label}`;
    view.el.querySelector(".hc-meta").innerHTML = out.meta;
    view.el.querySelector(".hsrc").innerHTML = `<b>Source.</b> ${out.source}`;
    if (!view.visible) {
      view.dirty = true;
      return;
    }
    view.dirty = false;
    if (!window.echarts) {
      view.el.querySelector(".hchart").innerHTML = '<p class="footnote">Chart library failed to load.</p>';
      return;
    }
    if (!view.chart) {
      const host = view.el.querySelector(".hchart");
      const skel = host.querySelector(".chart-skel");
      view.chart = echarts.init(host, null, { renderer: "canvas", useDirtyRect: true });
      view.chart.on("finished", () => skel && skel.classList.add("off"));
      new ResizeObserver(() => view.chart && view.chart.resize()).observe(host);
    }
    view.chart.setOption(out.opt, true);
  }
  function exportPng(view) {
    const { id, s, chart, last } = view;
    if (!chart) return;
    const title = `WESO ${CHARTS[id].title} (${s.ccy.toUpperCase()}, ${RANGES[s.range].label})`;
    const exp = JSON.parse(JSON.stringify(last.opt, (k, v) => (typeof v === "function" ? undefined : v)));
    const o = last.opt;
    exp.tooltip = undefined;
    exp.animation = false;
    exp.yAxis.axisLabel.formatter = o.yAxis.axisLabel.formatter;
    exp.series.forEach((sr, i) => {
      if (o.series[i].label && o.series[i].label.formatter) sr.label.formatter = o.series[i].label.formatter;
    });
    exp.backgroundColor = "#0b0913";
    exp.animation = false;
    exp.grid = { ...exp.grid, top: 70, bottom: 64 };
    exp.legend = { ...exp.legend, top: 40 };
    exp.title = {
      text: title,
      subtext: `Data to ${stamp(now())} · weso curve stats`,
      left: 12,
      top: 8,
      textStyle: { color: "#fff", fontFamily: C.font, fontWeight: 800, fontSize: 16 },
      subtextStyle: { color: C.muted, fontFamily: C.mono, fontSize: 10 },
    };
    const srcText = plain(last.source);
    exp.graphic = [
      {
        type: "text",
        left: 12,
        bottom: 10,
        style: { text: srcText.length > 190 ? srcText.slice(0, 187) + "…" : srcText, fill: "#8f8f8f", font: `10px ${C.mono}`, width: chart.getWidth() - 24, overflow: "break" },
      },
    ];
    chart.setOption(exp, true);
    const url = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#0b0913" });
    chart.setOption(last.opt, true);
    download(fileBase(id, s) + ".png", url);
  }

  let dialog = null;
  function openEmbed(view) {
    const { id, s } = view;
    const src = new URL(`embed.html?chart=${id}&range=${s.range}&ccy=${s.ccy}`, location.href).href;
    const code = `<iframe src="${src}" title="WESO ${CHARTS[id].title}" width="100%" height="420" style="border:0;border-radius:12px;max-width:760px" loading="lazy"></iframe>`;
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.className = "embed-dialog";
      dialog.innerHTML = `
        <form method="dialog">
          <h3>Embed this chart</h3>
          <p class="panel-sub">Paste into any page. The embed is a static page in this folder with the same data, source line, range and currency switches.</p>
          <textarea readonly rows="4" spellcheck="false"></textarea>
          <div class="embed-actions">
            <a class="neon-btn small" target="_blank" rel="noopener">Open preview</a>
            <button type="button" class="neon-btn small" data-copy>Copy code</button>
            <button class="neon-btn small" value="close">Close</button>
          </div>
        </form>`;
      document.body.appendChild(dialog);
      dialog.querySelector("[data-copy]").addEventListener("click", async (e) => {
        const ta = dialog.querySelector("textarea");
        try {
          await navigator.clipboard.writeText(ta.value);
        } catch {
          ta.select();
          document.execCommand("copy");
        }
        e.target.textContent = "Copied";
        setTimeout(() => (e.target.textContent = "Copy code"), 1500);
      });
    }
    dialog.querySelector("textarea").value = code;
    dialog.querySelector("a").href = src;
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function chipsHtml(sel) {
    return Object.entries(RANGES)
      .map(([k, r]) => `<button type="button" class="chip${k === sel ? " active" : ""}" data-range="${k}" aria-pressed="${k === sel}">${r.label}</button>`)
      .join("");
  }
  function ccyHtml(sel) {
    return ["usd", "lunc"].map((c) => `<button type="button" class="seg-btn${c === sel ? " active" : ""}" data-ccy="${c}" aria-pressed="${c === sel}">${c.toUpperCase()}</button>`).join("");
  }

  /* ---------- performance table + KPIs ---------- */
  function change(span, key) {
    const cur = current();
    const end = cur.t;
    if (span == null) {
      const d = documented[0];
      return d ? { v: cur[key] / d[key] - 1, since: d.t, kind: "documented" } : null;
    }
    const series = span <= 7 * DAY ? intra : chainDaily;
    const target = end - span;
    const first = series[0];
    if (target < first.t - HOUR) return { v: cur[key] / first[key] - 1, since: first.t, kind: "partial" };
    const b = valueAt(series, target) || first;
    return { v: cur[key] / b[key] - 1, since: null };
  }
  function perfHtml() {
    const cur = current();
    const spans = [
      ["24h", DAY],
      ["7d", 7 * DAY],
      ["30d", 30 * DAY],
      ["1y", 365 * DAY],
      ["All-time", null],
    ];
    const cell = (c) => {
      if (!c) return `<td>—</td>`;
      const cls = c.v > 0.00005 ? "up" : c.v < -0.00005 ? "down" : "flat";
      const note = c.since ? `<span class="s">${c.kind === "documented" ? "vs " : "since "}${shortDay(c.since)}${c.kind === "documented" ? " (doc.)" : ""}</span>` : "";
      return `<td class="${cls}">${pct(c.v)}${note}</td>`;
    };
    const row = (label, key, val) => `<tr><th scope="row">${label}<span class="s">${val}</span></th>${spans.map(([, sp]) => cell(change(sp, key))).join("")}</tr>`;
    return `
      <table class="perf-table">
        <thead><tr><th scope="col">Price</th>${spans.map(([l]) => `<th scope="col">${l}</th>`).join("")}</tr></thead>
        <tbody>
          ${row("USD", "pu", usd(cur.pu, 5))}
          ${row("LUNC", "pl", fmt(cur.pl, 4))}
        </tbody>
      </table>`;
  }
  function kpiHtml() {
    const cur = current();
    const end = cur.t;
    let v24 = 0;
    let n24 = 0;
    for (const tr of trades) {
      if (tr.t > end - DAY && tr.t <= end) {
        v24 += tr.usd;
        n24++;
      }
    }
    const ll = llama[llama.length - 1];
    const tiles = [
      ["Market cap", usd(cur.circ * cur.pu), "circulating × price", "v-pink"],
      ["Fully diluted", usd(cur.total * cur.pu), "total supply × price", "v-yellow"],
      ["Volume 24h", usd(v24), `${fmt(n24)} curve trades`, "v-green"],
      ["Circulating", compact(cur.circ, 2), `${((cur.circ / cur.total) * 100).toFixed(1)}% of total`, "v-cyan"],
      ["Total supply", compact(cur.total, 3), "token_info.total_supply", ""],
      ["Max supply", "∞", `no cap on chain · design ${compact(LIST.design_max_supply, 0)}`, ""],
      ["TVL (chain)", usd(cur.tvlU), "liquid + DAO-staked LUNC", "v-cyan"],
      ["TVL (DefiLlama)", ll ? usd(ll.usd) : "—", ll ? "protocol-wide · " + shortDay(ll.t) : "", "v-yellow"],
    ];
    return tiles.map(([k, v, s, cls]) => `<div class="kpi"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${s}</div></div>`).join("");
  }

  /* ---------- public ---------- */
  const shared = { range: "30d", ccy: "usd" };
  let sectionRoot = null;

  function mount(root, opts = {}) {
    sectionRoot = root;
    const p = new URLSearchParams(location.search);
    if (RANGES[p.get("hrange")]) shared.range = p.get("hrange");
    if (p.get("hccy") === "lunc") shared.ccy = "lunc";
    root.innerHTML = `
      <div class="panel-head">
        <div>
          <h2 class="section-title">Price history &amp; performance</h2>
          <p class="panel-sub">WESO price in USD and LUNC, volume, market cap and TVL from chain reads. On-chain prices run from <b>${dayLabel(priceStart)}</b>; public nodes prune older blocks. Every chart exports PNG and CSV and embeds.</p>
        </div>
        <div class="seg" role="group" aria-label="Currency" data-h="ccy">${ccyHtml(shared.ccy)}</div>
      </div>
      <div class="perf-wrap">
        <div class="table-scroll perf-scroll" data-h="perf"></div>
        <div class="kpis" data-h="kpis"></div>
      </div>
      <div class="toolbar">
        <div class="chips" role="group" aria-label="Range" data-h="range">${chipsHtml(shared.range)}</div>
        <div class="cov">
          <span class="badge badge-ok">chain · ${shortDay(priceStart)} →</span>
          <span class="badge badge-warn">DefiLlama TVL · ${llama.length ? shortDay(llama[0].t) : "—"} →</span>
          <span class="badge badge-info">documented · ${documented.length}</span>
        </div>
      </div>
      <div class="hcharts" data-h="charts"></div>
      <p class="footnote">
        <b>Data files.</b> <a href="data/listing/weso.json">weso.json</a> (CoinGecko / CMC fields) ·
        <a href="data/listing/supply/circulating.txt">circulating.txt</a> · <a href="data/listing/supply/total.txt">total.txt</a> ·
        <a href="data/listing/history/weso-daily.csv">daily CSV</a> · <a href="data/listing/history/weso-intraday.csv">intraday CSV</a> ·
        <a href="data/listing/history/weso-market_chart.json">market_chart.json</a>.
        Built ${stamp(Date.parse(HD.built_at))} at block ${fmt(LIST.block_height)}. How each number is made: <a href="methodology.html">methodology</a>.
      </p>`;
    const grid = root.querySelector('[data-h="charts"]');
    for (const id of Object.keys(CHARTS)) grid.appendChild(makeCard(id, shared, {}).el);
    root.querySelector('[data-h="range"]').addEventListener("click", (e) => {
      const b = e.target.closest("[data-range]");
      if (!b) return;
      shared.range = b.dataset.range;
      setPressed(root.querySelectorAll('[data-h="range"] .chip'), b);
      redraw();
    });
    root.querySelector('[data-h="ccy"]').addEventListener("click", (e) => {
      const b = e.target.closest("[data-ccy]");
      if (!b) return;
      shared.ccy = b.dataset.ccy;
      setPressed(root.querySelectorAll('[data-h="ccy"] .seg-btn'), b);
      redraw();
    });
    redraw();
  }
  function setPressed(nodes, on) {
    nodes.forEach((c) => {
      c.classList.toggle("active", c === on);
      c.setAttribute("aria-pressed", String(c === on));
    });
  }

  function embed(root, opts = {}) {
    const id = CHARTS[opts.chart] ? opts.chart : "price";
    const s = { range: RANGES[opts.range] ? opts.range : "30d", ccy: opts.ccy === "lunc" ? "lunc" : "usd" };
    root.innerHTML = `
      <div class="embed-top">
        <a class="brand" href="index.html" target="_blank" rel="noopener"><img src="assets/img/weso-logo.png" alt="" width="26" height="26" /><span class="brand-text">WESO <span class="brand-sub">${CHARTS[id].title}</span></span></a>
        <div class="chips" data-h="range" role="group" aria-label="Range">${chipsHtml(s.range)}</div>
        <div class="seg" data-h="ccy" role="group" aria-label="Currency">${ccyHtml(s.ccy)}</div>
      </div>`;
    const view = makeCard(id, s, { embed: true, compact: true });
    root.appendChild(view.el);
    const note = document.createElement("p");
    note.className = "embed-note";
    note.textContent = "Team preview · do not share";
    root.appendChild(note);
    root.querySelector('[data-h="range"]').addEventListener("click", (e) => {
      const b = e.target.closest("[data-range]");
      if (!b) return;
      s.range = b.dataset.range;
      setPressed(root.querySelectorAll('[data-h="range"] .chip'), b);
      draw(view);
    });
    root.querySelector('[data-h="ccy"]').addEventListener("click", (e) => {
      const b = e.target.closest("[data-ccy]");
      if (!b) return;
      s.ccy = b.dataset.ccy;
      setPressed(root.querySelectorAll('[data-h="ccy"] .seg-btn'), b);
      draw(view);
    });
    draw(view);
  }

  function redraw() {
    if (sectionRoot) {
      sectionRoot.querySelector('[data-h="perf"]').innerHTML = perfHtml();
      sectionRoot.querySelector('[data-h="kpis"]').innerHTML = kpiHtml();
    }
    views.forEach(draw);
  }

  function setLive(l) {
    if (!l || !Number.isFinite(l.price_lunc) || !Number.isFinite(l.lunc_usd)) return;
    live = { t: l.t, pl: l.price_lunc, lu: l.lunc_usd };
    redraw();
  }

  window.WesoHistory = { mount, embed, setLive, _data: { intra, chainDaily, documented, llama, trades } };
})();
