/* WESO bonding-curve stats · v2 page logic.
   Curve chart (by supply / by year), hero ticker, stats cards, milestones, flags,
   live LCD refresh with snapshot fallback. Loaded with `defer` after data/bundle.js. */
(function () {
  "use strict";

  const D = window.CURVE_DATA;
  const CM = window.CurveModel;
  if (!D || !CM) return;
  const REG = D.registry;
  const YEAR_MS = 365.25 * 86400000;
  const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const C = {
    pink: "#f6339a",
    pink400: "#fb64b6",
    magenta: "#dc3dd5",
    purple: "#ac4bff",
    cyan: "#00d2ef",
    cyanSoft: "#a2f4fd",
    yellow: "#fac800",
    amber: "#ff9f1a",
    green: "#05df72",
    red: "#ff6568",
    text: "#d1d5dc",
    muted: "#8f8f8f",
    grid: "rgba(255,255,255,0.06)",
    font: '"Geist", ui-sans-serif, system-ui, sans-serif',
    mono: '"Geist Mono", ui-monospace, monospace',
  };

  const curves = {};
  for (const meta of REG.curves) {
    const spec = D.specs[meta.id];
    const model = CM.fromSpec(spec);
    curves[meta.id] = { meta, spec, model, cap: spec.cap_supply || model.maxSupply };
  }

  const params = new URLSearchParams(location.search);
  const state = {
    curveId: curves[params.get("curve")] ? params.get("curve") : REG.curves[0].id,
    view: params.get("view") === "time" ? "time" : "supply",
    zoomKey: params.get("zoom"),
    log: params.get("log") === "1",
    cum: params.get("cum") !== "0",
    probe: null,
    window: null,
    live: fromSnapshot(),
    refreshing: false,
    tweening: false,
  };

  const $ = (id) => document.getElementById(id);

  /* ---------- formatting ---------- */
  const nf = (d) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const NF = {};
  const fmt = (x, d = 0) => (Number.isFinite(x) ? (NF[d] || (NF[d] = nf(d))).format(x) : "—");
  function compact(x, d = 2) {
    if (!Number.isFinite(x)) return "—";
    const a = Math.abs(x);
    if (a >= 1e12) return (x / 1e12).toFixed(d) + "T";
    if (a >= 1e9) return (x / 1e9).toFixed(d) + "B";
    if (a >= 1e6) return (x / 1e6).toFixed(d) + "M";
    if (a >= 1e3) return (x / 1e3).toFixed(d) + "k";
    return x.toFixed(d);
  }
  function axisCompact(x) {
    const a = Math.abs(x);
    if (a >= 1e12) return +(x / 1e12).toFixed(2) + "T";
    if (a >= 1e9) return +(x / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return +(x / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return +(x / 1e3).toFixed(1) + "k";
    return +x.toFixed(3) + "";
  }
  function price(p) {
    if (!Number.isFinite(p)) return "—";
    if (p >= 1000) return fmt(p, 2);
    if (p >= 1) return fmt(p, 4);
    return p.toPrecision(4);
  }
  function usd(x) {
    if (!Number.isFinite(x)) return "—";
    const a = Math.abs(x);
    if (a >= 1e6) return "$" + compact(x, 2);
    if (a >= 100) return "$" + fmt(x, 0);
    if (a >= 1) return "$" + fmt(x, 2);
    if (a === 0) return "$0";
    return "$" + x.toPrecision(3);
  }
  const pct = (x, d = 1) => (Number.isFinite(x) ? (x * 100).toFixed(d) + "%" : "—");
  const monthYear = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const dayMonthYear = (ms) => new Date(ms).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  function utcStamp(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" }) + " " + d.toISOString().slice(11, 16) + " UTC";
  }
  function years(y) {
    if (!Number.isFinite(y)) return "—";
    if (y <= 0) return "reached";
    if (y >= 100) return "~" + fmt(y, 0) + " yrs";
    if (y >= 10) return fmt(y, 1) + " yrs";
    if (y >= 1) return fmt(y, 2) + " yrs";
    return fmt(y * 12, 1) + " mo";
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const short = (a) => a.slice(0, 10) + "…" + a.slice(-6);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  let toastT;
  function toast(msg) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove("show"), 2600);
  }

  /* ---------- live data ---------- */
  function fromSnapshot() {
    const s = D.snapshot;
    const usdMap = {};
    for (const [id, v] of Object.entries((s.usd && s.usd.prices) || {})) {
      usdMap[id] = { usd: v.usd, at: v.at, source: "CoinGecko, saved in snapshot" };
    }
    const ref = D.reference.site_prices_usd;
    if (!usdMap["terra-luna"] && ref.LUNC) usdMap["terra-luna"] = { usd: ref.LUNC, at: null, source: D.reference.site_prices_note };
    if (!usdMap.terrausd && ref.USTC) usdMap.terrausd = { usd: ref.USTC, at: null, source: D.reference.site_prices_note };
    return {
      source: "snapshot",
      block: s.block.height,
      time: s.block.time,
      curves: JSON.parse(JSON.stringify(s.curves)),
      staking: JSON.parse(JSON.stringify(s.staking)),
      usd: usdMap,
      errors: [],
    };
  }

  async function getJSON(url, ms = 10000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(res.status + " " + url);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }
  const b64 = (o) => btoa(JSON.stringify(o));

  async function refreshLive(manual) {
    if (state.refreshing) return;
    state.refreshing = true;
    const btn = $("refresh-btn");
    btn.disabled = true;
    setStatus("wait", "Reading chain…");
    const lcd = REG.chain.lcd[0];
    const smart = (addr, msg) => getJSON(`${lcd}/cosmwasm/wasm/v1/contract/${addr}/smart/${b64(msg)}`).then((r) => r.data);
    const next = JSON.parse(JSON.stringify(state.live));
    next.errors = [];
    let chainOk = false;
    try {
      const blk = await getJSON(`${lcd}/cosmos/base/tendermint/v1beta1/blocks/latest`);
      const results = await Promise.all(
        REG.curves.map(async (m) => {
          const [ci, ti, bal, bank] = await Promise.all([
            smart(m.contract, { curve_info: {} }),
            smart(m.contract, { token_info: {} }),
            smart(m.contract, { balance: { address: m.contract } }),
            getJSON(`${lcd}/cosmos/bank/v1beta1/balances/${m.contract}`),
          ]);
          return [m.id, ci, ti, bal, bank];
        }),
      );
      for (const [id, ci, ti, bal, bank] of results) {
        const cur = next.curves[id] || (next.curves[id] = {});
        cur.curve_supply = Number(ci.supply) / 1e6;
        cur.spot_price = Number(ci.spot_price) / 1e6;
        cur.reserve_notional = Number(ci.reserve) / 1e6;
        cur.tax_collected = Number(ci.tax_collected) / 1e6;
        cur.total_supply = Number(ti.total_supply) / 1e6;
        cur.contract_token_balance = Number(bal.balance) / 1e6;
        cur.contract_bank = Object.fromEntries(bank.balances.map((b) => [b.denom, Number(b.amount) / 1e6]));
      }
      next.block = Number(blk.block.header.height);
      next.time = blk.block.header.time;
      chainOk = true;
    } catch (err) {
      next.errors.push("chain: " + err.message);
    }
    try {
      const dels = await getJSON(`${lcd}/cosmos/staking/v1beta1/delegations/${REG.staking.validator_dao}?pagination.limit=50`);
      const known = Object.fromEntries((state.live.staking.validators || []).map((v) => [v.operator, v]));
      const vals = dels.delegation_responses.map((d) => {
        const k = known[d.delegation.validator_address] || {};
        return {
          operator: d.delegation.validator_address,
          moniker: k.moniker || short(d.delegation.validator_address),
          commission: k.commission,
          delegated_lunc: Number(d.balance.amount) / 1e6,
        };
      });
      vals.sort((a, b) => b.delegated_lunc - a.delegated_lunc);
      next.staking = { ...next.staking, validators: vals, total_delegated_lunc: vals.reduce((s, v) => s + v.delegated_lunc, 0) };
    } catch (err) {
      next.errors.push("staking: " + err.message);
    }
    try {
      const ids = [...new Set(REG.curves.map((c) => c.reserve.coingecko_id))].join(",");
      const cg = await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_last_updated_at=true`);
      for (const [id, v] of Object.entries(cg)) {
        next.usd[id] = { usd: v.usd, at: new Date(v.last_updated_at * 1000).toISOString(), source: "CoinGecko, live" };
      }
    } catch (err) {
      next.errors.push("usd: " + err.message);
    }
    if (chainOk) next.source = "live";
    state.live = next;
    const lu = next.usd[curves.weso.meta.reserve.coingecko_id];
    if (chainOk && window.WesoHistory && next.curves.weso && lu && lu.source.endsWith("live")) {
      WesoHistory.setLive({ t: Date.parse(next.time), price_lunc: next.curves.weso.spot_price, lunc_usd: lu.usd });
    }
    state.refreshing = false;
    btn.disabled = false;
    renderAll(false);
    if (manual) toast(chainOk ? `Chain read · block ${fmt(next.block)}` : "Chain read failed · showing snapshot");
  }

  function setStatus(kind, text, title) {
    const pill = $("status-pill");
    pill.className = "pill pill-" + kind;
    $("status-text").textContent = text;
    pill.title = title || "";
  }
  function renderStatus() {
    const L = state.live;
    const errs = L.errors.length ? "\nNot refreshed: " + L.errors.join("; ") : "";
    if (L.source === "live") {
      setStatus("live", `LIVE · #${fmt(L.block)} · ${utcStamp(L.time).split(" ").slice(2).join(" ")}`, `Read from ${REG.chain.lcd[0]} at block ${L.block} (${L.time}).${errs}`);
    } else {
      setStatus("snap", `SNAPSHOT · #${fmt(L.block)}`, `Live read failed or not yet run. Values are from data/snapshot.json, block ${L.block} (${L.time}).${errs}`);
    }
  }

  /* ---------- derived numbers ---------- */
  function ctx() {
    const c = curves[state.curveId];
    const L = state.live.curves[c.meta.id];
    const sym = c.meta.label;
    const res = c.meta.reserve.symbol;
    const u = state.live.usd[c.meta.reserve.coingecko_id] || null;
    const S = L.curve_supply;
    const net = c.spec.buy_net_factor || 1;
    const now = Date.now();
    const tl = c.meta.timeline;
    const sched = c.spec.design_schedule;
    let t0 = null;
    let tNow = null;
    if (tl) {
      t0 = Date.parse(tl.launch_anchor + "T00:00:00Z");
      tNow = (now - t0) / YEAR_MS;
    }
    const mining = tl ? (tl.mining.block_reward * 60 * 24 * 365) / tl.mining.block_minutes : null;
    return {
      c, L, sym, res, u, S, net,
      spot: L.spot_price,
      now, t0, tNow, sched, mining,
      pace: tNow ? S / tNow : null,
      priceUsd: (p) => (u ? p * u.usd : NaN),
      grossTo: (s) => (s > S ? c.model.costBetween(S, s) / net : 0),
      planYearFor: (s) => (sched ? CM.scheduleYearFor(sched, s / 1e6) : null),
      planSupplyAt: (t) => (sched ? CM.scheduleSupply(sched, t) * 1e6 : null),
    };
  }

  function xykOut(x, L, meta) {
    const X = L.contract_token_balance;
    const Y = (L.contract_bank || {})[meta.reserve.denom] || 0;
    const loss = meta.sell ? meta.sell.loss : 0.015;
    return ((Y * x) / (X + x)) * (1 - loss);
  }

  /* ---------- hero ---------- */
  function renderTabs() {
    const el = $("curve-tabs");
    el.innerHTML = REG.curves
      .map((m) => {
        const ok = m.spec_status === "verified";
        const sel = m.id === state.curveId;
        return `<button class="curve-tab" role="tab" id="tab-${m.id}" data-id="${m.id}" aria-selected="${sel}" tabindex="${sel ? 0 : -1}">
          <img src="${m.logo}" alt="" width="28" height="28" />
          <span><span class="t1">${esc(m.label)}<span class="badge ${ok ? "badge-ok" : "badge-warn"}">${ok ? "verified" : "sampled"}</span></span>
          <span class="t2">${esc(m.tagline)} · code ${m.code_id}</span></span></button>`;
      })
      .join("");
    const tabs = [...el.querySelectorAll(".curve-tab")];
    const select = (b) => {
      if (b.dataset.id === state.curveId) return;
      state.curveId = b.dataset.id;
      state.zoomKey = null;
      state.probe = null;
      if (!curves[state.curveId].meta.timeline) state.view = "supply";
      const u = new URL(location.href);
      u.searchParams.set("curve", state.curveId);
      history.replaceState(null, "", u);
      renderAll(true);
      $("tab-" + state.curveId).focus();
    };
    tabs.forEach((b, i) => {
      b.addEventListener("click", () => select(b));
      b.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          select(tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]);
        }
      });
    });
  }

  function renderHero() {
    const x = ctx();
    const { c, L, sym, res } = x;
    $("hero-lede").innerHTML =
      c.meta.id === "weso"
        ? `WESO is priced by a bonding curve on Terra Classic: buy with LUNC and the price climbs a fixed path to <b>2,523 LUNC</b> at the <b>7B</b> design cap.`
        : `reBASE runs the same curve contract family against <b>USTC</b>. No numeric spec is published, so this curve is drawn from on-chain simulate samples.`;
    const offCurve = L.total_supply - L.curve_supply;
    const t = [
      { k: "Spot price", v: `${price(x.spot)}<small>${res}</small>`, s: `${usd(x.priceUsd(x.spot))} per ${sym}`, cls: "v-pink" },
      { k: "Curve supply", v: compact(L.curve_supply, 2), s: `${pct(L.curve_supply / x.c.cap, 2)} of ${compact(c.cap, c.cap >= 1e9 ? 0 : 1)} ${c.meta.id === "weso" ? "cap" : "sampled"}`, cls: "v-cyan" },
      { k: "Total supply", v: compact(L.total_supply, 3), s: offCurve > 0 ? `${compact(offCurve, 1)} off the curve` : `${compact(-offCurve, 2)} below curve supply`, cls: "v-yellow" },
      {
        k: c.meta.id === "weso" ? "Staked LUNC" : "Notional reserve",
        v: c.meta.id === "weso" ? compact(state.live.staking.total_delegated_lunc, 3) : compact(L.reserve_notional, 2),
        s: c.meta.id === "weso" ? "delegated by the Validator DAO" : `${res} area under the curve`,
        cls: "v-green",
      },
    ];
    $("ticker").innerHTML = t.map((i) => `<div class="tick ${i.cls}"><div class="k">${i.k}</div><div class="v">${i.v}</div><div class="s">${i.s}</div></div>`).join("");

    const cap = c.cap;
    const ticks = c.meta.milestones.map((m) => `<div class="progress-tick" style="left:${(m / cap) * 100}%"><span>${axisCompact(m)}</span></div>`).join("");
    let design = "";
    let legendRight = `<span>${c.meta.id === "weso" ? "7B design cap" : "Highest sampled supply"}: ${compact(cap, 2)}</span>`;
    if (x.sched) {
      const plan = x.planSupplyAt(x.tNow);
      design = `<div class="progress-tick design" style="left:${Math.min(100, (plan / cap) * 100)}%"><span>plan ${compact(plan, 2)}</span></div>`;
      legendRight = `<span>Yellow tick: design schedule today · year ${Math.floor(x.tNow) + 1} of 10</span>`;
    }
    $("progress").innerHTML = `
      <div class="progress-bar" role="progressbar" aria-label="Curve supply as a share of the cap" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${((L.curve_supply / cap) * 100).toFixed(1)}">
        <div class="progress-fill" style="width:${Math.max(0.6, (L.curve_supply / cap) * 100)}%"></div>${ticks}${design}
      </div>
      <div class="progress-legend"><span>Curve supply ${compact(L.curve_supply, 2)} ${sym}</span>${legendRight}</div>`;
  }

  /* ---------- chart ---------- */
  let chart = null;
  const isMobile = () => window.innerWidth < 760;

  function tooltipBase() {
    return {
      trigger: "axis",
      confine: true,
      transitionDuration: 0.08,
      backgroundColor: "rgba(6,6,15,0.94)",
      borderColor: "rgba(246,51,154,0.55)",
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: "#eee", fontFamily: C.font, fontSize: 12 },
      extraCssText: "box-shadow:0 0 20px rgba(0,255,255,0.18);border-radius:10px;backdrop-filter:blur(6px);",
      axisPointer: {
        type: "cross",
        lineStyle: { color: "rgba(250,200,0,0.5)", type: "dashed" },
        crossStyle: { color: "rgba(250,200,0,0.4)" },
        label: { backgroundColor: "#1a0a2e", borderColor: C.pink, borderWidth: 1, color: "#fff", fontFamily: C.mono, fontSize: 11 },
      },
    };
  }
  const tipRow = (label, value, color) =>
    `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.65"><span style="color:#99a1af">${
      color ? `<i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:6px"></i>` : ""
    }${label}</span><b style="font-family:${C.mono};color:#fff;font-variant-numeric:tabular-nums">${value}</b></div>`;

  function zoomPresets() {
    const x = ctx();
    if (state.view === "supply") {
      return x.c.meta.zooms.map((z) => ({ key: z.label, label: z.label, from: z.from, to: z.to, here: x.S >= z.from && x.S < z.to }));
    }
    const out = [];
    for (let y = 0; y < 10; y++) {
      const from = x.t0 + y * YEAR_MS;
      out.push({ key: "Y" + (y + 1), label: `Y${y + 1} ’${String(new Date(from).getUTCFullYear()).slice(2)}`, from, to: from + YEAR_MS, here: x.tNow >= y && x.tNow < y + 1 });
    }
    out.push({ key: "10y", label: "10 yrs", from: x.t0, to: x.t0 + 10 * YEAR_MS });
    return out;
  }
  function defaultZoom(presets) {
    if (state.zoomKey) {
      const z = presets.find((p) => p.key === state.zoomKey);
      if (z) return z;
    }
    if (state.view === "time") return presets.find((p) => p.key === "10y");
    return presets.find((p) => p.here) || presets[presets.length - 1];
  }

  function renderChips() {
    const presets = zoomPresets();
    const active = defaultZoom(presets);
    state.zoomKey = active.key;
    const el = $("zoom-chips");
    el.innerHTML = presets
      .map((p) => `<button type="button" class="chip${p.key === active.key ? " active" : ""}${p.here ? " here" : ""}" data-key="${esc(p.key)}" aria-pressed="${p.key === active.key}" title="${p.here ? "Contains today's position" : ""}">${esc(p.label)}</button>`)
      .join("");
    el.querySelectorAll(".chip").forEach((b) =>
      b.addEventListener("click", () => {
        const p = presets.find((q) => q.key === b.dataset.key);
        state.zoomKey = p.key;
        markChip(p.key);
        tweenWindow(p.from, p.to);
      }),
    );
    return active;
  }
  function markChip(key) {
    document.querySelectorAll("#zoom-chips .chip").forEach((q) => {
      const on = !!key && q.dataset.key === key;
      q.classList.toggle("active", on);
      q.setAttribute("aria-pressed", String(on));
    });
  }

  /* Animated zoom: tween the dataZoom window over ~480 ms. */
  let tweenId = null;
  function tweenWindow(from, to) {
    if (!chart || !state.window || REDUCED) return applyWindow(from, to, true);
    cancelAnimationFrame(tweenId);
    const [a0, b0] = state.window;
    if (Math.abs(a0 - from) < 1e-9 && Math.abs(b0 - to) < 1e-9) return;
    const t0 = performance.now();
    const dur = 480;
    state.tweening = true;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = easeInOut(k);
      const a = a0 + (from - a0) * e;
      const b = b0 + (to - b0) * e;
      chart.dispatchAction({ type: "dataZoom", dataZoomIndex: 0, startValue: a, endValue: b });
      state.window = [a, b];
      positionMarker();
      if (k < 1) tweenId = requestAnimationFrame(step);
      else {
        state.tweening = false;
        applyWindow(from, to, false);
      }
    };
    tweenId = requestAnimationFrame(step);
  }

  function applyWindow(from, to, dispatch) {
    state.window = [from, to];
    if (dispatch && chart) chart.dispatchAction({ type: "dataZoom", dataZoomIndex: 0, startValue: from, endValue: to });
    if (state.probe == null || state.probe < from || state.probe > to) state.probe = defaultProbe(from, to);
    syncSlider();
    updateProbe();
  }

  function defaultProbe(from, to) {
    const x = ctx();
    if (state.view === "time") {
      const now = x.now;
      return now >= from && now <= to ? now : (from + to) / 2;
    }
    const next = x.c.meta.milestones.find((m) => m > x.S && m >= from && m <= to);
    if (next) return next;
    return x.S >= from && x.S <= to ? x.S : (from + to) / 2;
  }

  const sliderStyle = (mob, bg) => ({
    type: "slider",
    xAxisIndex: 0,
    height: 18,
    bottom: mob ? 8 : 12,
    borderColor: "rgba(246,51,154,0.3)",
    backgroundColor: "rgba(0,0,0,0.35)",
    fillerColor: "rgba(0,210,239,0.12)",
    handleStyle: { color: C.pink, borderColor: C.pink },
    moveHandleStyle: { color: "rgba(246,51,154,0.55)" },
    dataBackground: { lineStyle: { color: bg + "99" }, areaStyle: { color: bg + "22" } },
    selectedDataBackground: { lineStyle: { color: C.cyan }, areaStyle: { color: "rgba(0,210,239,0.22)" } },
    textStyle: { color: C.muted, fontFamily: C.mono, fontSize: 10 },
    brushSelect: false,
    throttle: 16,
  });

  function supplyOption() {
    const x = ctx();
    const { c, S, res, sym } = x;
    const m = c.model;
    const mob = isMobile();
    const pts = m.sample(0, c.cap, mob ? 1600 : 3000).map((s) => [s, m.price(s)]);
    const bonded = m.sample(0, S, 400).map((s) => [s, m.price(s)]);
    const cum = m.sample(0, c.cap, 600).map((s) => [s, m.cumulative(s)]);
    const ms = c.meta.milestones.map((v) => ({ xAxis: v, label: { formatter: `${axisCompact(v)}\n${price(m.price(v))}` } }));
    const marks = [];
    if (x.sched) {
      const plan = x.planSupplyAt(x.tNow);
      marks.push({
        xAxis: plan,
        lineStyle: { color: C.amber, type: [6, 4], width: 1.5, opacity: 0.9 },
        label: { formatter: `PLAN\n${compact(plan, 2)}`, color: C.amber, position: "insideEndBottom", fontWeight: 700 },
      });
    }
    return {
      backgroundColor: "transparent",
      textStyle: { fontFamily: C.font },
      animation: !REDUCED,
      animationDuration: 700,
      animationDurationUpdate: 0,
      animationEasing: "cubicOut",
      grid: { left: mob ? 46 : 66, right: state.cum ? (mob ? 48 : 74) : mob ? 14 : 24, top: mob ? 54 : 52, bottom: mob ? 58 : 66 },
      legend: {
        top: 4,
        left: "center",
        itemWidth: 12,
        itemHeight: 6,
        textStyle: { color: C.text, fontSize: mob ? 10 : 11 },
        data: ["Price", "Bonded", ...(state.cum ? ["Cumulative " + res] : [])],
      },
      tooltip: {
        ...tooltipBase(),
        formatter(ps) {
          const s = ps[0].axisValue;
          const p = m.price(s);
          const gross = x.grossTo(s);
          let h = `<div style="font-weight:800;color:${C.yellow};margin-bottom:3px;font-family:${C.mono}">${fmt(s, 0)} ${sym}</div>`;
          h += tipRow("Price", `${price(p)} ${res}`, C.pink);
          h += tipRow("USD", usd(x.priceUsd(p)));
          h += tipRow("Cumulative " + res, compact(m.cumulative(s), 3), C.cyan);
          h += tipRow("vs spot", "×" + (p / x.spot).toFixed(2));
          if (s > S) h += tipRow(`${res} to buy here`, `${compact(gross, 3)} · ${usd(gross * (x.u ? x.u.usd : NaN))}`);
          if (x.sched) {
            const y = x.planYearFor(s);
            if (y != null) h += tipRow("Plan reaches", monthYear(x.t0 + y * YEAR_MS));
          }
          return h;
        },
      },
      xAxis: {
        type: "value",
        min: 0,
        max: c.cap,
        name: mob ? "" : `Curve supply (${sym})`,
        nameLocation: "middle",
        nameGap: 26,
        nameTextStyle: { color: C.muted, fontSize: 10 },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.16)" } },
        axisLabel: { color: C.text, fontFamily: C.mono, fontSize: mob ? 10 : 11, formatter: axisCompact, hideOverlap: true },
        splitLine: { show: true, lineStyle: { color: C.grid } },
      },
      yAxis: [
        {
          type: state.log ? "log" : "value",
          logBase: 10,
          scale: !state.log,
          name: mob ? res : `${res} per ${sym}`,
          nameTextStyle: { color: C.muted, fontSize: 10, align: "left" },
          axisLabel: { color: C.text, fontFamily: C.mono, fontSize: mob ? 10 : 11, formatter: (v) => axisCompact(v) },
          splitLine: { lineStyle: { color: C.grid } },
        },
        {
          type: "value",
          show: state.cum,
          name: mob ? "" : `Cumulative ${res}`,
          nameTextStyle: { color: C.muted, fontSize: 10, align: "right" },
          axisLabel: { color: "rgba(162,244,253,0.7)", fontFamily: C.mono, fontSize: mob ? 9 : 11, formatter: axisCompact },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: 0, filterMode: "filter", zoomOnMouseWheel: true, moveOnMouseMove: true, minValueSpan: c.cap / 2000, throttle: 16 },
        { ...sliderStyle(mob, C.pink), filterMode: "filter", labelFormatter: (v) => axisCompact(v) },
      ],
      series: [
        {
          id: "price",
          name: "Price",
          type: "line",
          data: pts,
          showSymbol: false,
          smooth: false,
          z: 3,
          lineStyle: {
            width: 2.5,
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: C.pink },
              { offset: 0.5, color: C.purple },
              { offset: 1, color: C.cyan },
            ]),
            shadowBlur: 12,
            shadowColor: "rgba(236,72,153,0.6)",
          },
          itemStyle: { color: C.pink },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(246,51,154,0.26)" },
              { offset: 1, color: "rgba(246,51,154,0.0)" },
            ]),
          },
          markLine: {
            symbol: "none",
            silent: true,
            animation: false,
            lineStyle: { color: "rgba(251,100,182,0.5)", type: "dashed", width: 1 },
            label: { color: C.pink400, fontFamily: C.mono, fontSize: mob ? 9 : 10, position: "insideEndTop", lineHeight: 13 },
            data: [...ms, ...marks],
          },
        },
        {
          id: "bonded",
          name: "Bonded",
          type: "line",
          data: bonded,
          showSymbol: false,
          lineStyle: { width: 0 },
          itemStyle: { color: C.cyan },
          z: 2,
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(0,210,239,0.42)" },
              { offset: 1, color: "rgba(0,210,239,0.04)" },
            ]),
          },
        },
        ...(state.cum
          ? [{ id: "cum", name: "Cumulative " + res, type: "line", yAxisIndex: 1, data: cum, showSymbol: false, z: 1, lineStyle: { width: 1.5, type: [5, 4], color: "rgba(162,244,253,0.75)" }, itemStyle: { color: C.cyanSoft } }]
          : []),
        {
          id: "now",
          name: "Now",
          type: "effectScatter",
          data: [[S, m.price(S)]],
          symbolSize: 12,
          z: 6,
          rippleEffect: { scale: 3, brushType: "stroke", period: 3 },
          itemStyle: { color: C.green, shadowBlur: 14, shadowColor: C.green },
          label: {
            show: true,
            position: "left",
            distance: 10,
            formatter: () => `NOW ${compact(S, 1)} · ${price(x.spot)}`,
            color: "#fff",
            backgroundColor: "rgba(5,223,114,0.16)",
            borderColor: "rgba(5,223,114,0.7)",
            borderWidth: 1,
            borderRadius: 5,
            padding: [3, 6],
            fontFamily: C.mono,
            fontSize: mob ? 10 : 11,
            fontWeight: 700,
          },
          tooltip: { show: false },
        },
      ],
    };
  }

  function timeOption() {
    const x = ctx();
    const { c, L, res, sym } = x;
    const m = c.model;
    const mob = isMobile();
    const end = x.t0 + 10 * YEAR_MS;
    const plan = [];
    const planPrice = [];
    for (let t = 0; t <= 10.0001; t += 1 / 24) {
      const s = x.planSupplyAt(t);
      plan.push([x.t0 + t * YEAR_MS, s]);
      planPrice.push([x.t0 + t * YEAR_MS, m.price(Math.min(s, c.cap))]);
    }
    const yrsLeft = (end - x.now) / YEAR_MS;
    const mining = [
      [x.now, L.total_supply],
      [end, L.total_supply + x.mining * yrsLeft],
    ];
    const paceLine = [
      [x.t0, 0],
      [x.now, x.S],
      [end, x.S + x.pace * yrsLeft],
    ];
    const ms = c.meta.milestones.map((v) => ({ yAxis: v, label: { formatter: axisCompact(v) } }));
    return {
      backgroundColor: "transparent",
      textStyle: { fontFamily: C.font },
      animation: !REDUCED,
      animationDuration: 700,
      animationDurationUpdate: 0,
      grid: { left: mob ? 46 : 66, right: state.cum ? (mob ? 46 : 74) : mob ? 14 : 24, top: mob ? 68 : 52, bottom: mob ? 58 : 66 },
      legend: {
        top: 4,
        left: "center",
        itemWidth: 12,
        itemHeight: 6,
        textStyle: { color: C.text, fontSize: mob ? 10 : 11 },
        data: ["Design schedule", "Total + mining", "Curve, avg pace", ...(state.cum ? ["Price on plan"] : [])],
      },
      tooltip: {
        ...tooltipBase(),
        formatter(ps) {
          const ms_ = ps[0].axisValue;
          const t = (ms_ - x.t0) / YEAR_MS;
          const s = x.planSupplyAt(t);
          let h = `<div style="font-weight:800;color:${C.yellow};margin-bottom:3px">${dayMonthYear(ms_)} · year ${Math.min(10, Math.floor(t) + 1)} of 10</div>`;
          h += tipRow("Plan supply", compact(s, 3), C.yellow);
          h += tipRow("Price at plan", `${price(m.price(Math.min(s, c.cap)))} ${res}`, C.pink);
          h += tipRow("Cumulative " + res, compact(m.cumulative(Math.min(s, c.cap)), 3));
          if (ms_ >= x.now) h += tipRow("Total + mining", compact(L.total_supply + x.mining * ((ms_ - x.now) / YEAR_MS), 4), C.cyan);
          const ps_ = x.pace * t;
          h += tipRow("Curve at avg pace", `${compact(ps_, 3)} → ${price(m.price(Math.min(ps_, c.cap)))} ${res}`, C.pink400);
          return h;
        },
      },
      xAxis: {
        type: "time",
        min: x.t0,
        max: end,
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.16)" } },
        axisLabel: { color: C.text, fontFamily: C.mono, fontSize: mob ? 10 : 11, hideOverlap: true },
        splitLine: { show: true, lineStyle: { color: C.grid } },
      },
      yAxis: [
        {
          type: "value",
          min: 0,
          name: mob ? sym : `Supply (${sym})`,
          nameTextStyle: { color: C.muted, fontSize: 10, align: "left" },
          axisLabel: { color: C.text, fontFamily: C.mono, fontSize: mob ? 10 : 11, formatter: axisCompact },
          splitLine: { lineStyle: { color: C.grid } },
        },
        {
          type: state.log ? "log" : "value",
          show: state.cum,
          name: mob ? "" : `Price (${res})`,
          nameTextStyle: { color: C.muted, fontSize: 10, align: "right" },
          axisLabel: { color: "rgba(251,100,182,0.8)", fontFamily: C.mono, fontSize: mob ? 9 : 11, formatter: axisCompact },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: 0, filterMode: "none", minValueSpan: 30 * 86400000, throttle: 16 },
        { ...sliderStyle(mob, C.yellow), filterMode: "none", labelFormatter: (v) => monthYear(v) },
      ],
      series: [
        {
          id: "plan",
          name: "Design schedule",
          type: "line",
          data: plan,
          showSymbol: false,
          z: 3,
          lineStyle: { width: 2.5, color: C.yellow, shadowBlur: 10, shadowColor: "rgba(250,200,0,0.5)" },
          itemStyle: { color: C.yellow },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(250,200,0,0.16)" },
              { offset: 1, color: "rgba(250,200,0,0)" },
            ]),
          },
          markLine: {
            symbol: "none",
            silent: true,
            animation: false,
            lineStyle: { color: "rgba(251,100,182,0.4)", type: "dashed", width: 1 },
            label: { color: C.pink400, fontFamily: C.mono, fontSize: 10, position: "insideStartTop" },
            data: [
              ...ms,
              { xAxis: x.now, lineStyle: { color: C.green, type: "solid", width: 1.5, opacity: 0.9 }, label: { formatter: "TODAY", color: C.green, position: "insideEndTop", fontWeight: 700 } },
            ],
          },
        },
        {
          id: "mining",
          name: "Total + mining",
          type: "line",
          data: mining,
          showSymbol: true,
          symbol: "circle",
          symbolSize: (v, p) => (p.dataIndex === 0 ? 9 : 0),
          z: 4,
          lineStyle: { width: 2.5, color: C.cyan, shadowBlur: 10, shadowColor: "rgba(0,210,239,0.6)" },
          itemStyle: { color: C.cyan },
        },
        {
          id: "pace",
          name: "Curve, avg pace",
          type: "line",
          data: paceLine,
          showSymbol: true,
          symbolSize: (v, p) => (p.dataIndex === 1 ? 9 : 0),
          z: 4,
          lineStyle: { width: 2, color: C.pink400, type: [7, 5] },
          itemStyle: { color: C.pink400 },
        },
        ...(state.cum
          ? [{ id: "planPrice", name: "Price on plan", type: "line", yAxisIndex: 1, data: planPrice, showSymbol: false, z: 2, lineStyle: { width: 1.5, color: "rgba(220,61,213,0.75)" }, itemStyle: { color: C.magenta } }]
          : []),
      ],
    };
  }

  function renderChart(reset) {
    const el = $("curve-chart");
    if (!window.echarts) {
      el.innerHTML = '<p style="padding:2rem;color:#ff6568">Chart library failed to load.</p>';
      return;
    }
    if (!chart) {
      chart = echarts.init(el, null, { renderer: "canvas", useDirtyRect: true });
      chart.on("datazoom", () => {
        if (state.tweening) return;
        const dz = chart.getOption().dataZoom[0];
        if (dz.startValue == null) return;
        state.window = [dz.startValue, dz.endValue];
        const matched = zoomPresets().find((p) => Math.abs(p.from - dz.startValue) < 1 && Math.abs(p.to - dz.endValue) < 1);
        markChip(matched ? matched.key : null);
        if (state.probe < dz.startValue || state.probe > dz.endValue) state.probe = defaultProbe(dz.startValue, dz.endValue);
        syncSlider();
        scheduleProbe();
      });
      chart.getZr().on("click", (e) => {
        const p = chart.convertFromPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY]);
        if (!p || !Number.isFinite(p[0])) return;
        const [a, b] = state.window;
        state.probe = Math.min(b, Math.max(a, p[0]));
        syncSlider();
        updateProbe();
      });
      chart.on("finished", () => $("chart-skel").classList.add("off"));
      new ResizeObserver(() => {
        clearTimeout(renderChart._t);
        renderChart._t = setTimeout(() => {
          chart.resize();
          renderChart(false);
        }, 120);
      }).observe(el);
      bindMarker();
    }
    const active = renderChips();
    const opt = state.view === "supply" ? supplyOption() : timeOption();
    const win = reset || !state.window ? [active.from, active.to] : state.window;
    opt.dataZoom[0].startValue = opt.dataZoom[1].startValue = win[0];
    opt.dataZoom[0].endValue = opt.dataZoom[1].endValue = win[1];
    chart.setOption(opt, true);
    applyWindow(win[0], win[1], false);
    renderChartText();
    $("probe-marker").hidden = false;
  }

  function renderChartText() {
    const x = ctx();
    const { c, res, sym } = x;
    $("chart-title").textContent = state.view === "supply" ? `${sym} curve` : "10-year schedule";
    $("view-toggle").querySelectorAll(".seg-btn").forEach((b) => {
      const on = b.dataset.view === state.view;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
      if (b.dataset.view === "time") {
        b.disabled = !c.meta.timeline;
        b.title = c.meta.timeline ? "" : "No published issuance schedule for this token";
      }
    });
    $("opt-cum-label").textContent = state.view === "supply" ? `Cumulative ${res}` : "Price on plan";
    $("opt-log").checked = state.log;
    $("opt-cum").checked = state.cum;
    const sub = $("chart-sub");
    const foot = $("chart-footnote");
    if (state.view === "supply") {
      sub.innerHTML =
        c.meta.id === "weso"
          ? `${res} per ${sym} against curve supply. Spec <b>Curves 2.0</b>: geometric per 100M ${sym}, straight inside each step.`
          : `Spot ${res} per ${sym} from chain simulate samples; no published spec.`;
      foot.innerHTML =
        c.meta.id === "weso"
          ? `<b>Cyan fill</b> is the area already bonded; its integral equals <code>curve_info.reserve</code>. <b>Cumulative</b> is the area from zero, a notional counter, not LUNC held. "${res} to buy" is gross, including the ≈1.99% buy cut. The chart stops at the 7B cap because the sheet does; the contract keeps going (see Past 7B).`
          : `Samples from sell and buy simulates on block ${fmt(Number(c.spec.source.block.height))}. Straight lines join the samples, so prices between them are approximate. Buys of 6.44B ${res} or more simulate as zero.`;
    } else {
      sub.innerHTML = `Planned circulating supply (1B pre-mine plus 200M–1B mined per year) against what the chain is doing.`;
      foot.innerHTML = `<b>Assumptions.</b> Year 1 starts <b>${dayMonthYear(x.t0)}</b> (public launch 22–31 Jan 2025; instantiate date pruned on public nodes). <b>Design schedule</b> is the Curves 2.0 sheet, linear within each year. <b>Total + mining</b> starts at today's <code>token_info.total_supply</code> and adds ${fmt(x.mining)} ${sym}/yr (10 ${sym} per 6-minute block). <b>Curve, avg pace</b> is a straight line from zero at launch through today's curve supply (${compact(x.pace, 0)} ${sym}/yr), extended. <b>Price on plan</b> reads the curve at the planned supply, which assumes planned circulating supply maps onto curve supply.`;
    }
  }

  function syncSlider() {
    const r = $("probe-range");
    if (!state.window) return;
    const [a, b] = state.window;
    const v = Math.round(((state.probe - a) / (b - a)) * 1000);
    r.value = String(v);
    const grip = $("probe-marker").querySelector(".grip");
    grip.setAttribute("aria-valuenow", String(Math.round(v / 10)));
  }

  /* ---------- scrubbable marker ---------- */
  let probeRaf = 0;
  function scheduleProbe() {
    if (probeRaf) return;
    probeRaf = requestAnimationFrame(() => {
      probeRaf = 0;
      updateProbe();
    });
  }
  function gridRect() {
    try {
      const g = chart.getModel().getComponent("grid");
      const r = g.coordinateSystem.getRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    } catch {
      const mob = isMobile();
      return { x: mob ? 46 : 66, y: 44, w: chart.getWidth() - (mob ? 94 : 140), h: chart.getHeight() - (mob ? 102 : 110) };
    }
  }
  function markerY(s) {
    const x = ctx();
    if (state.view === "supply") return x.c.model.price(s);
    return x.planSupplyAt((s - x.t0) / YEAR_MS);
  }
  function positionMarker() {
    if (!chart || state.probe == null) return;
    const mk = $("probe-marker");
    const px = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [state.probe, markerY(state.probe)]);
    if (!px || !Number.isFinite(px[0])) return;
    const g = gridRect();
    const cx = Math.min(g.x + g.w, Math.max(g.x, px[0]));
    const cy = Math.min(g.y + g.h, Math.max(g.y, px[1]));
    mk.style.transform = `translate3d(${cx}px,0,0)`;
    const line = mk.firstElementChild;
    line.style.top = g.y + "px";
    line.style.height = g.h + "px";
    mk.querySelector(".dot").style.top = cy + "px";
    mk.querySelector(".grip").style.top = cy + "px";
    const tag = mk.querySelector(".tag");
    const x = ctx();
    tag.textContent = state.view === "supply" ? `${compact(state.probe, 2)} · ${price(x.c.model.price(state.probe))} ${x.res}` : monthYear(state.probe);
    if (tag.textContent !== positionMarker._txt) {
      positionMarker._txt = tag.textContent;
      positionMarker._tw = tag.offsetWidth || 90;
    }
    const tw = positionMarker._tw;
    const above = cy - 34 > g.y;
    tag.style.top = (above ? cy - 32 : cy + 12) + "px";
    const tx = Math.min(g.x + g.w - tw / 2, Math.max(g.x + tw / 2, cx)) - cx;
    tag.style.transform = `translate(calc(-50% + ${tx}px), 0)`;
  }
  function bindMarker() {
    const wrap = $("chart-wrap");
    const grip = $("probe-marker").querySelector(".grip");
    let dragging = false;
    let rect = null;
    const toValue = (clientX) => {
      const r = rect || (rect = wrap.getBoundingClientRect());
      const v = chart.convertFromPixel({ xAxisIndex: 0 }, clientX - r.left);
      const [a, b] = state.window;
      return Math.min(b, Math.max(a, v));
    };
    grip.addEventListener("pointerdown", (e) => {
      dragging = true;
      rect = wrap.getBoundingClientRect();
      grip.setPointerCapture(e.pointerId);
      wrap.classList.add("scrubbing");
      e.preventDefault();
    });
    grip.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      state.probe = toValue(e.clientX);
      syncSlider();
      scheduleProbe();
    });
    const end = () => {
      dragging = false;
      wrap.classList.remove("scrubbing");
    };
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
    grip.addEventListener("keydown", (e) => {
      const [a, b] = state.window;
      const stepv = (b - a) / 100;
      let v = state.probe;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") v += stepv;
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") v -= stepv;
      else if (e.key === "Home") v = a;
      else if (e.key === "End") v = b;
      else return;
      e.preventDefault();
      state.probe = Math.min(b, Math.max(a, v));
      syncSlider();
      updateProbe();
    });
  }

  let readoutSig = "";
  function updateProbe() {
    const x = ctx();
    const { c, res, sym, L } = x;
    const m = c.model;
    const s = state.probe;
    if (s == null) return;
    const items = [];
    if (state.view === "supply") {
      const p = m.price(s);
      const gross = x.grossTo(s);
      items.push({ k: "Supply", v: compact(s, 3) + " " + sym, s: `${pct(s / c.cap, 2)} of ${c.meta.id === "weso" ? "7B cap" : "sampled range"}` });
      items.push({ k: "Price", v: `${price(p)} ${res}`, s: `×${(p / x.spot).toFixed(2)} vs spot`, cls: "v-pink" });
      items.push({ k: "Price USD", v: usd(x.priceUsd(p)), s: x.u ? `${res} $${x.u.usd.toPrecision(4)}` : "no USD price", cls: "v-yellow" });
      items.push({ k: `Cumulative ${res}`, v: compact(m.cumulative(s), 3), s: "area under curve from 0", cls: "v-cyan" });
      if (s > x.S) {
        items.push({ k: `${res} to buy here`, v: compact(gross, 3), s: `${usd(gross * (x.u ? x.u.usd : NaN))} · incl. 1.99% cut`, cls: "v-green" });
      } else {
        const sold = x.S - s;
        items.push({ k: "Sell down to here", v: sold > 0 ? compact(xykOut(sold, L, c.meta), 3) + " " + res : "at spot", s: sold > 0 ? `XYK · ${compact(sold, 2)} ${sym} sold` : "current supply", cls: "v-green" });
      }
      if (x.sched) {
        const y = x.planYearFor(s);
        items.push({ k: "Plan reaches", v: y == null ? "after year 10" : monthYear(x.t0 + y * YEAR_MS), s: y == null ? "" : `year ${Math.floor(y) + 1} of 10` });
      } else {
        items.push({ k: "Curve value", v: usd(s * p * (x.u ? x.u.usd : NaN)), s: `${compact(s, 2)} × spot here` });
      }
    } else {
      const t = (s - x.t0) / YEAR_MS;
      const plan = x.planSupplyAt(t);
      const pp = m.price(Math.min(plan, c.cap));
      const mined = s >= x.now ? L.total_supply + x.mining * ((s - x.now) / YEAR_MS) : null;
      const pace = x.pace * t;
      items.push({ k: "Date", v: monthYear(s), s: `year ${Math.min(10, Math.max(1, Math.floor(t) + 1))} of 10` });
      items.push({ k: "Plan supply", v: compact(plan, 3), s: "design, circulating", cls: "v-yellow" });
      items.push({ k: "Price on plan", v: `${price(pp)} ${res}`, s: usd(x.priceUsd(pp)), cls: "v-pink" });
      items.push({ k: "Total + mining", v: mined == null ? "—" : compact(mined, 4), s: mined == null ? "projection starts today" : `+${compact(x.mining, 0)}/yr`, cls: "v-cyan" });
      items.push({ k: "Curve, avg pace", v: compact(pace, 3), s: `${price(m.price(Math.min(pace, c.cap)))} ${res}` });
      items.push({ k: "Plan minus curve", v: compact(plan - pace, 2), s: "gap at avg pace", cls: "v-green" });
    }
    const el = $("readout");
    const sig = items.map((i) => i.k + "|" + (i.cls || "")).join(";");
    if (sig !== readoutSig) {
      readoutSig = sig;
      el.innerHTML = items.map((i) => `<div class="ro"><div class="k">${i.k}</div><div class="v ${i.cls || ""}"></div><div class="s"></div></div>`).join("");
    }
    const nodes = el.children;
    for (let i = 0; i < items.length; i++) {
      nodes[i].children[1].textContent = items[i].v;
      nodes[i].children[2].textContent = items[i].s || " ";
    }
    positionMarker();
  }

  /* ---------- cards ---------- */
  function srcLine() {
    const L = state.live;
    return L.source === "live" ? `LCD live, block ${fmt(L.block)} (${utcStamp(L.time)})` : `Snapshot, block ${fmt(L.block)} (${utcStamp(L.time)})`;
  }
  function usdSrc(u) {
    if (!u) return "no USD price available";
    return `${u.source}${u.at ? ", " + utcStamp(u.at) : ""}`;
  }
  const card = (cls, title, body, extra = "") => `<article class="card ${cls}">${title ? `<h3>${title}</h3>` : ""}${body}${extra}</article>`;
  const kv = (rows) => `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  const src = (s) => `<div class="src">${s}</div>`;

  function renderCards() {
    const x = ctx();
    $("cards").innerHTML = x.c.meta.id === "weso" ? wesoCards(x) : rebaseCards(x);
  }

  function stepInfo(x) {
    const m = x.c.model;
    const i = m._seg(x.S);
    return { from: m.S[i], to: m.S[i + 1], p0: m.P[i], p1: m.P[i + 1], slope: ((m.P[i + 1] - m.P[i]) / (m.S[i + 1] - m.S[i])) * 1e6 };
  }

  function wesoCards(x) {
    const { c, L, res, sym, u } = x;
    const meta = c.meta;
    const st = state.live.staking;
    const ref = D.reference;
    const step = stepInfo(x);
    const specSpot = c.model.price(x.S);
    const liquid = (L.contract_bank || {}).uluna || 0;
    const out = [];

    out.push(
      card(
        "pink",
        `Supply <span class="badge badge-info">chain</span>`,
        `<div class="big">${fmt(L.curve_supply, 0)}</div><div class="sub">${sym} on the curve · <code>curve_info.supply</code></div>` +
          kv([
            ["Total supply", fmt(L.total_supply, 0)],
            ["Off the curve", `${compact(L.total_supply - L.curve_supply, 2)} (pools, Capacitor)`],
            ["Mint cap", "none (<code>minter.cap</code> null)"],
            ["Of 7B design cap", pct(L.curve_supply / c.cap, 2) + " curve · " + pct(L.total_supply / c.cap, 2) + " total"],
          ]),
        src(srcLine()),
      ),
    );

    out.push(
      card(
        "cyan",
        "Price",
        `<div class="big">${price(x.spot)} <small>${res}</small></div><div class="sub">${usd(x.priceUsd(x.spot))} per ${sym}</div>` +
          kv([
            [`${res} / USD`, u ? "$" + u.usd.toPrecision(4) : "—"],
            ["Spec at this supply", `${price(specSpot)} (${((specSpot / x.spot - 1) * 100).toFixed(4)}%)`],
            ["Current step", `${axisCompact(step.from)}–${axisCompact(step.to)}: ${price(step.p0)} → ${price(step.p1)}`],
            ["Slope", `+${step.slope.toFixed(4)} ${res} per 1M ${sym}`],
            [`1,000 ${res} buys`, `≈ ${fmt(c.model.supplyAfter(x.S, 1000 * x.net) - x.S, 2)} ${sym}`],
          ]),
        src(`Spot: ${srcLine()}. USD: ${usdSrc(u)}. ${sym} USD = spot × ${res} USD.`),
      ),
    );

    out.push(
      card(
        "amber",
        "Reserve · notional vs liquid",
        `<div class="big">${compact(L.reserve_notional, 3)}</div><div class="sub">${res} notional reserve (area under the curve)</div>` +
          kv([
            [`Liquid ${res} in contract`, `${compact(liquid, 2)} (${pct(liquid / L.reserve_notional, 1)})`],
            ["Staked by Validator DAO", compact(st.total_delegated_lunc, 3)],
            ["Liquid + staked", compact(liquid + st.total_delegated_lunc, 3)],
            ["Tax collected, lifetime", compact(L.tax_collected, 2) + " " + res],
          ]),
        src(`<code>curve_info.reserve</code> is a counter. The ${res} sits in the contract's bank balance and the DAO's delegations. ${srcLine()}.`),
      ),
    );

    const api = (D.snapshot.site_api && D.snapshot.site_api.stats) || ref.site_stats;
    const apiAt = D.snapshot.site_api && D.snapshot.site_api.fetched_at ? utcStamp(D.snapshot.site_api.fetched_at) : "2026-10-08";
    out.push(
      card(
        "red wide",
        `Burned vs circulating <span class="badge badge-bad">API claim flagged</span>`,
        `<div class="vs">
          <div><div class="k">Chain · <code>token_info</code> <span class="badge badge-ok">truth</span></div>
            <div class="v" style="color:var(--green-400)">${fmt(L.total_supply, 0)}</div>
            <div class="s">total supply. ${fmt(L.curve_supply, 0)} on the curve, ${fmt(L.total_supply - L.curve_supply, 0)} elsewhere. No mint cap, no burn counter exposed.</div></div>
          <div><div class="k">weso.world <code>/api/stats</code> <span class="badge badge-bad">not on chain</span></div>
            <div class="v"><span class="strike">${fmt(api.totalSupply, 0)}</span></div>
            <div class="s">"totalSupply". Its "burned" ${fmt(api.burned, 0)} is 10B minus curve supply, not a burn. Fetched ${apiAt}.</div></div>
        </div>`,
        src(`The site API hard-codes a 10B total. On chain the supply is ${compact(L.total_supply, 3)} and no cap is set, so "burned" reads as "never minted". The chain figure is authoritative.`),
      ),
    );

    const palette = ["#f6339a", "#00d2ef", "#fac800", "#ac4bff", "#05df72"];
    out.push(
      card(
        "violet",
        "Staking",
        `<div class="big">${compact(st.total_delegated_lunc, 3)}</div><div class="sub">${res} delegated by the ${esc(REG.staking.dao_name)}</div>
        <div class="stack">${st.validators.map((v, i) => `<span style="width:${(v.delegated_lunc / st.total_delegated_lunc) * 100}%;background:${palette[i % 5]}"></span>`).join("")}</div>
        <div class="legend">${st.validators
          .map((v, i) => `<span><i style="background:${palette[i % 5]}"></i>${esc(v.moniker.replace(/[^\x20-\x7E]/g, "").trim())} ${compact(v.delegated_lunc, 2)}${v.commission != null ? ` · ${(v.commission * 100).toFixed(2)}%` : ""}</span>`)
          .join("")}</div>` +
          kv([
            ["Buy LUNC forwarded", "≈80% (<code>to_validator_pct</code> 800)"],
            ["DAO", REG.staking.dao_governance],
          ]),
        src(`Delegations of <code>${short(REG.staking.validator_dao)}</code>. Percentages are validator commission. The contract cannot unbond this stake.`),
      ),
    );

    const split = meta.tax.split;
    const tcol = ["#f6339a", "#00d2ef", "#fac800", "#05df72"];
    out.push(
      card(
        "green",
        "Buy tax",
        `<div class="big">≈1.99%</div><div class="sub">two ~1% cuts per buy (0.99 × 0.99)</div>
        <div class="stack">${split.map((p, i) => `<span style="width:${p.pct}%;background:${tcol[i]}"></span>`).join("")}</div>
        <div class="legend">${split.map((p, i) => `<span><i style="background:${tcol[i]}"></i>${p.pool} ${p.pct}%</span>`).join("")}</div>` +
          kv([
            ["Project tax", "~1%, split above"],
            ["Tax collected", compact(L.tax_collected, 2) + " " + res],
            ["Smallest buy that mints", `500 ${res}`],
          ]),
        src(`<code>param_info</code>: ${esc(meta.tax.source)}.`),
      ),
    );

    const q = (w) => xykOut(w, L, meta);
    const all = L.curve_supply;
    out.push(
      card(
        "cyan",
        "Selling · XYK, not the curve",
        `<div class="big">${compact(q(1e6), 1)}</div><div class="sub">${res} for 1M ${sym} (avg ${price(q(1e6) / 1e6)} vs spot ${price(x.spot)})</div>` +
          kv([
            ["Pool", `${compact(L.contract_token_balance, 2)} ${sym} / ${compact(liquid, 1)} ${res}`],
            [`10M ${sym}`, `${compact(q(1e7), 1)} ${res} (avg ${price(q(1e7) / 1e7)})`],
            [`All ${compact(all, 0)} curve ${sym}`, `${compact(q(all), 1)} ${res}`],
            ["Loss on exit", "≈1.5% + slippage"],
          ]),
        src(`Constant product on the contract's own balances (y·x/(X+x), less ~1.5%). On 2026-10-08 chain simulate gave 34.4M, 177.6M and 325.9M ${res} for 1M, 10M and 680M ${sym}.`),
      ),
    );

    const yIdx = Math.min(9, Math.floor(x.tNow));
    const planRate = x.sched.yearly[yIdx] * 1e6;
    out.push(
      card(
        "amber",
        `Mining <span class="badge badge-warn">corrected</span>`,
        `<div class="big">${fmt(x.mining, 0)}</div><div class="sub">${sym} per year at 10 ${sym} per 6-minute block</div>` +
          kv([
            ["Blocks per year", fmt((60 * 24 * 365) / meta.timeline.mining.block_minutes, 0)],
            [`Plan, year ${yIdx + 1}`, compact(planRate, 0) + ` ${sym}/yr`],
            ["Live vs plan", pct(x.mining / planRate, 2)],
          ]),
        src(`${esc(meta.timeline.mining.source)}. The deep dive's "≈87.6k/yr" was 10× too low: 10 × 87,600 blocks = 876,000.`),
      ),
    );

    const plan = x.planSupplyAt(x.tNow);
    out.push(
      card(
        "pink",
        "Plan vs chain today",
        `<div class="big">${compact(plan, 2)}</div><div class="sub">planned circulating supply by ${dayMonthYear(x.now)}</div>` +
          kv([
            ["Chain total supply", `${compact(L.total_supply, 3)} (${pct(L.total_supply / plan - 1, 1)})`],
            ["Chain curve supply", `${compact(L.curve_supply, 3)} (${pct(L.curve_supply / plan - 1, 1)})`],
            ["Plan year", `${Math.floor(x.tNow) + 1} of 10`],
            ["Curve avg pace", `${compact(x.pace, 0)} ${sym}/yr`],
          ]),
        src(`Plan from the Curves 2.0 sheet (1B pre-mine, then ${x.sched.yearly.join("/")}M). Year 1 starts ${dayMonthYear(x.t0)} (assumed).`),
      ),
    );

    const pc = meta.past_cap;
    out.push(
      card(
        "red",
        `Past 7B <span class="badge badge-warn">simulate</span>`,
        `<div class="big">${compact(pc.jump_supply, 2)}</div><div class="sub">where buys land after a zero band past the cap</div>` +
          kv([
            ["Fill to cap", `${compact(pc.fill_lunc, 3)} ${res} → ${compact(pc.fill_supply, 3)} at 2,523.04`],
            ["Zero band", `${compact(pc.zero_band_lunc[0], 3)}–${compact(pc.zero_band_lunc[1], 3)} ${res} returns 0`],
            ["Then", `${price(pc.jump_price)} ${res}, +${pc.slope_per_million} per 1M`],
            ["30B / 50B / 70B", pc.examples.map((e) => price(e.price)).join(" / ")],
          ]),
        src("Contract behaviour beyond the sheet's 7B cap (block 30,751,567). Not drawn on the chart."),
      ),
    );

    const v = D.verification;
    out.push(
      card(
        "green",
        `Spec check <span class="badge badge-ok">pass</span>`,
        `<div class="big">${(v.chain_buys_spot_max_rel_err * 100).toFixed(4)}%</div><div class="sub">worst spot-price error vs chain buys to 7B</div>` +
          kv([
            ["Sheet grid points", `${v.sheet_points}, max ${(v.sheet_max_rel_err * 100).toFixed(4)}%`],
            ["Chain sells to 1k–600M", `${v.chain_sells}, max ${(v.chain_sells_max_rel_err * 100).toFixed(5)}%`],
            ["LUNC to reach target", `${v.chain_buys}, max ${(v.chain_buys_cost_max_rel_err * 100).toFixed(5)}%`],
            ["Reserve = area to supply", `${(v.reserve_rel_err * 100).toExponential(1)}%`],
          ]),
        src(`<code>scripts/verify-spec.mjs</code> against block ${fmt(v.block.height)}. Spec: <code>data/weso-curves2.spec.json</code>.`),
      ),
    );
    return out.join("");
  }

  function rebaseCards(x) {
    const { c, L, res, sym, u } = x;
    const bank = L.contract_bank || {};
    const liquid = bank.uusd || 0;
    const step = stepInfo(x);
    const q = (w) => xykOut(w, L, c.meta);
    const out = [];
    out.push(
      card(
        "pink",
        `Supply <span class="badge badge-info">chain</span>`,
        `<div class="big">${fmt(L.curve_supply, 0)}</div><div class="sub">${sym} on the curve</div>` +
          kv([
            ["Total supply", fmt(L.total_supply, 0)],
            ["Curve minus total", compact(L.curve_supply - L.total_supply, 3)],
            ["Mint cap", "none set"],
            ["Highest sampled supply", compact(c.spec.max_sampled_supply, 2)],
          ]),
        src(`Total supply is below curve supply, so some reBASE has been burned or removed outside the curve counter. ${srcLine()}.`),
      ),
    );
    out.push(
      card(
        "cyan",
        "Price",
        `<div class="big">${price(x.spot)} <small>${res}</small></div><div class="sub">${usd(x.priceUsd(x.spot))} per ${sym}</div>` +
          kv([
            [`${res} / USD`, u ? "$" + u.usd.toPrecision(4) : "—"],
            ["Sampled step", `${compact(step.from, 2)}–${compact(step.to, 2)}`],
            ["Slope", `+${step.slope.toFixed(4)} ${res} per 1M`],
          ]),
        src(`Spot: ${srcLine()}. USD: ${usdSrc(u)}.`),
      ),
    );
    out.push(
      card(
        "amber",
        "Reserve · notional vs liquid",
        `<div class="big">${compact(L.reserve_notional, 3)}</div><div class="sub">${res} notional reserve</div>` +
          kv([
            [`Liquid ${res}`, `${compact(liquid, 3)} (${pct(liquid / L.reserve_notional, 1)})`],
            ["Also holds LUNC", compact(bank.uluna || 0, 3)],
            [`Contract ${sym} (XYK side)`, compact(L.contract_token_balance, 3)],
            ["Tax collected", compact(L.tax_collected, 3) + " " + res],
          ]),
        src(`The 80% validator parameter would leave about 20% liquid if the reserve were cash; it is a counter. ${srcLine()}.`),
      ),
    );
    out.push(
      card(
        "cyan",
        "Selling · XYK",
        `<div class="big">${compact(q(1e5), 2)}</div><div class="sub">${res} for 100k ${sym} (avg ${price(q(1e5) / 1e5)})</div>` +
          kv([
            ["Pool", `${compact(L.contract_token_balance, 2)} ${sym} / ${compact(liquid, 2)} ${res}`],
            [`1M ${sym}`, `${compact(q(1e6), 2)} ${res}`],
            [`All curve ${sym}`, `${compact(q(L.curve_supply), 2)} ${res}`],
          ]),
        src("Same XYK exit as WESO, assumed ~1.5% loss (not separately simulated for reBASE)."),
      ),
    );
    out.push(
      card(
        "violet wide",
        `About this curve <span class="badge badge-warn">sampled</span>`,
        `<div class="sub" style="margin-top:0">${esc(c.spec.description)}</div>` +
          kv(c.meta.facts.map((f, i) => [`${i + 1}`, `<span style="font-family:var(--sans);text-align:left;display:block">${esc(f)}</span>`])),
        src(`Contract <code>${c.meta.contract}</code>, code ${c.meta.code_id}. Knots: <code>data/rebase-sampled.json</code> (${c.spec.knots.length} points).`),
      ),
    );
    return out.join("");
  }

  /* ---------- milestones ---------- */
  const phaseNames = {
    1000000000: "Initial phase ends",
    2500000000: "Growth phase ends",
    4200000000: "Mature-phase inflection",
    6000000000: "Mature-phase inflection",
    7000000000: "Design cap",
  };

  function renderMilestones() {
    const x = ctx();
    const { c, L, res, sym, u } = x;
    const m = c.model;
    const weso = c.meta.id === "weso";
    $("ms-sub").innerHTML = weso
      ? `Price, cost and timing for each Curves 2.0 anchor, from today's curve supply of <b>${compact(x.S, 2)}</b>.`
      : `Price and cost at sampled supplies, from today's curve supply of <b>${compact(x.S, 2)}</b>. Between samples the curve is a straight-line estimate.`;
    const head = ["Milestone", `Price<small>${res} per ${sym}</small>`, "Price USD", `Cumulative ${res}<small>area from 0</small>`, `${res} to reach<small>gross, from now</small>`, "USD to reach"];
    if (weso) head.push("Plan date<small>design schedule</small>", "Mining only<small>876k/yr on total</small>", "Avg curve pace<small>since launch</small>");
    const rows = [];
    const nowRow = [
      `<td class="ms-name">Now<span class="s">${compact(x.S, 2)} curve</span></td>`,
      `<td>${price(x.spot)}</td>`,
      `<td>${usd(x.priceUsd(x.spot))}</td>`,
      `<td>${compact(L.reserve_notional, 3)}<span class="s">chain reserve</span></td>`,
      "<td>—</td>",
      "<td>—</td>",
    ];
    if (weso) nowRow.push(`<td>${monthYear(x.t0 + Math.min(10, CM.scheduleYearFor(x.sched, x.S / 1e6) || 0) * YEAR_MS)}<span class="s">plan hit this supply</span></td>`, `<td>${compact(L.total_supply, 3)}<span class="s">total today</span></td>`, `<td>${compact(x.pace, 0)}/yr</td>`);
    rows.push(`<tr class="now">${nowRow.join("")}</tr>`);
    for (const ms of c.meta.milestones) {
      const p = m.price(ms);
      const gross = x.grossTo(ms);
      const passed = ms <= x.S;
      const cells = [
        `<td class="ms-name">${axisCompact(ms)}<span class="s">${weso ? phaseNames[ms] || "" : "sampled"}</span></td>`,
        `<td>${price(p)}<span class="s">×${(p / x.spot).toFixed(2)} vs now</span></td>`,
        `<td>${usd(x.priceUsd(p))}</td>`,
        `<td>${compact(m.cumulative(ms), 3)}</td>`,
        `<td>${passed ? "passed" : compact(gross, 3)}</td>`,
        `<td>${passed ? "—" : usd(gross * (u ? u.usd : NaN))}</td>`,
      ];
      if (weso) {
        const py = CM.scheduleYearFor(x.sched, ms / 1e6);
        const planMs = x.t0 + py * YEAR_MS;
        const mineY = (ms - L.total_supply) / x.mining;
        const paceY = (ms - x.S) / x.pace;
        cells.push(
          `<td>${monthYear(planMs)}<span class="s">${py === 0 ? "pre-mine at launch" : `year ${Math.floor(py) + 1}`}${planMs < x.now ? " · past" : ""}</span></td>`,
          `<td>${mineY <= 0 ? "reached" : years(mineY)}<span class="s">${mineY <= 0 ? "total supply already above" : mineY > 200 ? "effectively never" : monthYear(x.now + mineY * YEAR_MS)}</span></td>`,
          `<td>${years(paceY)}<span class="s">${monthYear(x.now + paceY * YEAR_MS)}</span></td>`,
        );
      }
      rows.push(`<tr class="${passed ? "passed" : ""}">${cells.join("")}</tr>`);
    }
    $("ms-table").innerHTML = `<thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody>`;
    $("ms-footnote").innerHTML = weso
      ? `"${res} to reach" integrates the curve from today's supply and divides by 0.9801 for the buy cut (verified against chain simulate: 31.80B ${res} to 1B on 2026-10-08). USD uses ${usdSrc(u)}. <b>Mining only</b> divides the gap above today's total supply by ${fmt(x.mining)} ${sym}/yr. <b>Avg curve pace</b> divides the gap above today's curve supply by ${compact(x.pace, 0)}/yr (curve supply ÷ time since ${dayMonthYear(x.t0)}). Straight-line projections, not forecasts.`
      : `Assumes the same 0.9801 buy factor as WESO. USD uses ${usdSrc(u)}.`;
  }

  /* ---------- notes ---------- */
  function renderNotes() {
    const x = ctx();
    const weso = x.c.meta.id === "weso";
    const v = D.verification;
    const api = (D.snapshot.site_api && D.snapshot.site_api.stats) || D.reference.site_stats;
    const n = [];
    if (weso) {
      n.push([
        "ok",
        "Curves 2.0 is the live curve",
        `Anchors 1 → 200 (1B) → 800 (2.5B) → 1,025 (4.2B) → 1,550 (6B) → 2,523.05 (7B), geometric per 100M and straight inside each step, plus the sheet's 10M knot (1.05441). It matches ${v.sheet_points} sheet points, ${v.chain_sells} chain sells and ${v.chain_buys} chain buys within ${(Math.max(v.sheet_max_rel_err, v.chain_sells_max_rel_err, v.chain_buys_spot_max_rel_err) * 100).toFixed(4)}%, and its area equals <code>curve_info.reserve</code> to ${(Math.abs(v.reserve_rel_err) * 100).toExponential(1)}%. The 10M knot explains the first-step bend the deep dive flagged (1.340738 at 50M).`,
      ]);
      n.push([
        "bad",
        "Site API supply is wrong",
        `<code>weso.world/api/stats</code> reports totalSupply ${fmt(api.totalSupply)} and burned ${fmt(api.burned)}. The chain reports ${fmt(state.live.curves.weso.total_supply)} total with no cap; "burned" is 10B minus curve supply. This page shows the chain value.`,
      ]);
      n.push([
        "warn",
        "Mining rate corrected",
        `10 WESO every 6 minutes is 87,600 blocks and <b>876,000 WESO a year</b>. The deep dive README says "≈87.6k/yr", which is 10× too low. Payout mechanics (minted, or paid from existing balances via the multisig) are not verified; this page adds mining to total supply.`,
      ]);
      n.push([
        "warn",
        "Launch date and plan mapping",
        `Year 1 is anchored to ${dayMonthYear(x.t0)} (public launch week; instantiate time is pruned on public nodes). The plan counts circulating supply including the 1B pre-mine, while the curve prices curve supply. "Price on plan" and "Plan reaches" assume the two line up, which they did not at launch (curve started near zero).`,
      ]);
      n.push([
        "warn",
        "Past the 7B cap",
        "The contract does not stop at 7B: buys hit a zero band, then land near 15.8B at about 49 LUNC and climb slowly. The sheet has no prices there, so the chart ends at 7B. Treat buys near the cap with care.",
      ]);
    } else {
      n.push([
        "warn",
        "Sampled, not specified",
        "No numeric reBASE curve is published. The REBASE 1.0 chart only shows a 0–200M axis. This curve is 31 spot prices from read-only simulates joined by straight lines; the steep part from 40M to 105M has wide gaps between samples.",
      ]);
      n.push(["warn", "Buy factor assumed", "Costs use the WESO buy factor (0.9801) because the code family and tax params match. It was not separately confirmed for reBASE."]);
    }
    n.push([
      "info",
      "Notional reserve, real balances",
      "Both contracts report a reserve that is an area-under-the-curve counter. Most of the WESO LUNC is delegated by a 4-member DAO multisig; sells settle against the contract's small liquid balance through XYK, not at the curve price.",
    ]);
    n.push([
      "info",
      "Prices and freshness",
      `USD prices come from CoinGecko (${x.c.meta.reserve.coingecko_id}) live in the browser, falling back to the snapshot (${usdSrc(state.live.usd[x.c.meta.reserve.coingecko_id])}). Chain values refresh from <code>${REG.chain.lcd[0]}</code> every 2 minutes; if that fails the page keeps <code>data/snapshot.json</code> (block ${fmt(D.snapshot.block.height)}). Everything is read-only.`,
    ]);
    $("notes-list").innerHTML = n.map(([k, t, b]) => `<div class="note ${k}"><h3>${t}</h3><p>${b}</p></div>`).join("");
  }

  function renderFooter() {
    const lcd = REG.chain.lcd[0];
    const links = REG.curves.map((m) => `${esc(m.label)} <a href="${lcd}${REG.chain.contract_info_path}${m.contract}" rel="noopener"><code>${m.contract}</code></a> (code ${m.code_id})`).join(" · ");
    $("footer").innerHTML = `
      <p><b style="color:var(--yellow-400)">Sources.</b> ${links}. Validator DAO <code>${REG.staking.validator_dao}</code>.</p>
      <p>Curve spec <code>data/weso-curves2.spec.json</code> (Curves 2.0 sheet, verified on block ${fmt(D.verification.block.height)}); reBASE knots <code>data/rebase-sampled.json</code>; deep dive <code>bot/knowledge/lanes/token/deep-dive-2026-10-08/</code>.</p>
      <p>Snapshot block ${fmt(D.snapshot.block.height)} (${utcStamp(D.snapshot.block.time)}), bundle built ${utcStamp(D.built_at)}. Read-only page: it never signs, sends or posts anything. Not financial advice. <b>Team preview, do not share.</b></p>`;
  }

  /* ---------- wiring ---------- */
  function renderAll(resetChart) {
    renderStatus();
    renderTabs();
    renderHero();
    renderChart(resetChart);
    renderCards();
    renderMilestones();
    renderNotes();
    renderFooter();
    document.body.classList.remove("is-loading");
  }

  $("view-toggle").addEventListener("click", (e) => {
    const b = e.target.closest(".seg-btn");
    if (!b || b.disabled || b.dataset.view === state.view) return;
    state.view = b.dataset.view;
    state.zoomKey = null;
    state.probe = null;
    readoutSig = "";
    renderChart(true);
  });
  $("opt-log").addEventListener("change", (e) => {
    state.log = e.target.checked;
    renderChart(false);
  });
  $("opt-cum").addEventListener("change", (e) => {
    state.cum = e.target.checked;
    renderChart(false);
  });
  $("probe-range").addEventListener("input", (e) => {
    const [a, b] = state.window;
    state.probe = a + ((b - a) * Number(e.target.value)) / 1000;
    scheduleProbe();
  });
  $("probe-now").addEventListener("click", () => {
    const x = ctx();
    const target = state.view === "supply" ? x.S : x.now;
    const [a, b] = state.window;
    state.probe = target;
    if (target < a || target > b) {
      const p = zoomPresets().find((z) => target >= z.from && target <= z.to);
      if (p) {
        state.zoomKey = p.key;
        markChip(p.key);
        tweenWindow(p.from, p.to);
        return;
      }
    }
    syncSlider();
    updateProbe();
  });
  $("refresh-btn").addEventListener("click", () => refreshLive(true));

  /* section highlight in the top nav */
  const navLinks = [...document.querySelectorAll(".topnav a[href^='#']")];
  if ("IntersectionObserver" in window && navLinks.length) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          navLinks.forEach((a) => a.toggleAttribute("aria-current", a.getAttribute("href") === "#" + en.target.id));
        }
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    navLinks.forEach((a) => {
      const s = document.querySelector(a.getAttribute("href"));
      if (s) io.observe(s);
    });
  }

  /* Price history: its 230 KB of data + code load on demand, when the section nears the viewport
     (or after the page is idle), so it stays off the critical path. */
  let historyLoading = null;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("failed " + src));
      document.head.appendChild(s);
    });
  }
  function loadHistory() {
    if (historyLoading) return historyLoading;
    historyLoading = (window.WesoHistory ? Promise.resolve() : loadScript("data/history-bundle.js").then(() => loadScript("assets/history.js")))
      .then(() => {
        WesoHistory.mount($("history"));
        const L = state.live;
        const lu = L.usd[curves.weso.meta.reserve.coingecko_id];
        if (L.source === "live" && lu && lu.source.endsWith("live")) {
          WesoHistory.setLive({ t: Date.parse(L.time), price_lunc: L.curves.weso.spot_price, lunc_usd: lu.usd });
        }
      })
      .catch((err) => {
        $("history").querySelector(".panel-sub").textContent = "History failed to load: " + err.message;
      });
    return historyLoading;
  }
  if ("IntersectionObserver" in window) {
    const hio = new IntersectionObserver((en) => {
      if (en.some((e) => e.isIntersecting)) {
        hio.disconnect();
        loadHistory();
      }
    }, { rootMargin: "800px 0px" });
    hio.observe($("history"));
  }
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => loadHistory(), { timeout: 4000 });

  renderAll(true);
  if (params.get("offline") !== "1") {
    refreshLive(false);
    setInterval(() => {
      if (!document.hidden) refreshLive(false);
    }, 120000);
  }
})();
