#!/usr/bin/env node
// Builds WESO price / volume / market-cap / TVL history and the listing JSON
// folder (data/listing/). Read-only: GET requests to a public Terra Classic LCD
// (historical state via the x-cosmos-block-height header, tx search for trades),
// CoinGecko (LUNC/USD) and DefiLlama (protocol TVL). Never signs or broadcasts.
//
// Public nodes prune state and the tx index after roughly 2-3 weeks, so on-chain
// history starts at the node's lowest retained height. Older points come only
// from documented snapshots listed in data/registry.json.
//
// Usage: node scripts/build-history.mjs [--lcd https://...] [--step-hours 4]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const CM = require(join(web, "assets/curve-model.js"));
const registry = JSON.parse(readFileSync(join(web, "data/registry.json"), "utf8"));
const meta = registry.curves.find((c) => c.id === "weso");
const spec = JSON.parse(readFileSync(join(web, meta.spec_file), "utf8"));
const curve = CM.fromSpec(spec);
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const LCD = arg("--lcd", registry.chain.history_lcd);
const STEP_H = Number(arg("--step-hours", "4"));
const HOURLY_H = 48;
const C = meta.contract;
const DAO = registry.staking.validator_dao;
const EXCLUDED = meta.listing.non_circulating;
const H = 3600000;
const DAY = 24 * H;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, height, attempts = 5) {
  const headers = { accept: "application/json" };
  if (height) {
    headers["x-cosmos-block-height"] = String(height);
    // Some public LCD backends serve a cached response for the same URL and
    // ignore the height header; a per-height query parameter avoids that.
    url += (url.includes("?") ? "&" : "?") + "_h=" + height;
  }
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok && height && res.headers.get("x-cosmos-block-height") !== String(height)) {
        // Unverifiable or wrong height: never accept it as history.
        throw new Error(`400 height not echoed (${res.headers.get("x-cosmos-block-height")}) ${url}`);
      }
      if (res.ok) return await res.json();
      last = new Error(`${res.status} ${url}${height ? " @" + height : ""}`);
      if (res.status !== 429 && res.status < 500) throw last;
    } catch (err) {
      last = err;
      if (String(err.message).match(/^4\d\d /) && !String(err.message).startsWith("429")) throw err;
    }
    if (attempt < attempts - 1) await sleep(1000 * 2 ** attempt);
  }
  throw last;
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const smart = (addr, msg, h) => get(`${LCD}/cosmwasm/wasm/v1/contract/${addr}/smart/${b64(msg)}`, h).then((r) => r.data);
const micro = (x) => Number(x) / 1e6;
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}
const log = (...a) => console.log(...a);

// ---------- block height <-> time ----------
const headerAt = async (h) => {
  const r = await get(`${LCD}/cosmos/base/tendermint/v1beta1/blocks/${h}`);
  return { height: Number(r.block.header.height), time: Date.parse(r.block.header.time) };
};
const latestHdr = await get(`${LCD}/cosmos/base/tendermint/v1beta1/blocks/latest`);
const latest = { height: Number(latestHdr.block.header.height), time: Date.parse(latestHdr.block.header.time) };
log(`latest block ${latest.height} ${new Date(latest.time).toISOString()}`);

async function stateOk(h) {
  try {
    await get(`${LCD}/cosmwasm/wasm/v1/contract/${C}/smart/${b64({ curve_info: {} })}`, h, 1);
    await get(`${LCD}/cosmos/base/tendermint/v1beta1/blocks/${h}`);
    return true;
  } catch {
    return false;
  }
}
let lo = latest.height - 600000;
let hi = latest.height - 10;
if (await stateOk(lo)) hi = lo;
while (hi - lo > 200) {
  const mid = Math.floor((lo + hi) / 2);
  if (await stateOk(mid)) hi = mid;
  else lo = mid;
}
const earliestHeight = hi + 500;
log(`earliest usable state height ≈ ${earliestHeight}`);

const grid = [];
for (let h = earliestHeight; h < latest.height; h += 15000) grid.push(h);
const anchors = (await pool(grid, 4, headerAt)).concat([latest]).sort((a, b) => a.time - b.time);
function heightAt(t) {
  if (t >= latest.time) return latest.height;
  for (let i = 1; i < anchors.length; i++) {
    if (anchors[i].time >= t) {
      const a = anchors[i - 1];
      const b = anchors[i];
      return Math.round(a.height + ((t - a.time) / (b.time - a.time)) * (b.height - a.height));
    }
  }
  return latest.height;
}
const earliestTime = anchors[0].time;

// ---------- state samples ----------
const sampleTimes = new Set();
const firstSample = Math.ceil(earliestTime / (STEP_H * H)) * STEP_H * H;
for (let t = firstSample; t < latest.time; t += STEP_H * H) sampleTimes.add(t);
for (let t = Math.ceil((latest.time - HOURLY_H * H) / H) * H; t < latest.time; t += H) sampleTimes.add(t);
const times = [...sampleTimes].sort((a, b) => a - b);
log(`${times.length} state samples from ${new Date(times[0]).toISOString()}`);

async function stateAt(t) {
  const h = t >= latest.time ? latest.height : heightAt(t);
  const [ci, ti, bank, dels, ...bals] = await Promise.all([
    smart(C, { curve_info: {} }, h),
    smart(C, { token_info: {} }, h),
    get(`${LCD}/cosmos/bank/v1beta1/balances/${C}/by_denom?denom=uluna`, h),
    get(`${LCD}/cosmos/staking/v1beta1/delegations/${DAO}?pagination.limit=50`, h),
    ...EXCLUDED.map((e) => smart(C, { balance: { address: e.address } }, h)),
  ]);
  const total = micro(ti.total_supply);
  const excluded = bals.reduce((s, b) => s + micro(b.balance), 0);
  return {
    t,
    height: h,
    spot_lunc: micro(ci.spot_price),
    curve_supply: micro(ci.supply),
    reserve_notional_lunc: micro(ci.reserve),
    total_supply: total,
    non_circulating: excluded,
    circulating_supply: total - excluded,
    contract_weso: micro(bals[0].balance),
    contract_lunc: micro(bank.balance.amount),
    dao_staked_lunc: dels.delegation_responses.reduce((s, d) => s + micro(d.balance.amount), 0),
    wallets: bals.map((b) => micro(b.balance)),
  };
}
let done = 0;
const samples = await pool([...times, latest.time], 5, async (t) => {
  const s = await stateAt(t);
  if (++done % 25 === 0) log(`  samples ${done}/${times.length + 1}`);
  return s;
});
samples[samples.length - 1].t = latest.time;

// ---------- trades ----------
// Tx search runs on the primary LCD in height-ranged chunks: each URL is unique
// (so no cached page can be reused), and hexxagon's load-balanced tx index
// returned different totals per backend during testing.
const TX_LCD = arg("--tx-lcd", registry.chain.lcd[0]);
async function allTxs() {
  const out = [];
  const seen = new Set();
  const CHUNK = 20000;
  for (let a = latest.height - 30 * CHUNK; a <= latest.height; a += CHUNK) {
    const q = encodeURIComponent(`wasm._contract_address='${C}' AND tx.height>=${a} AND tx.height<${a + CHUNK}`);
    let page = 1;
    let total = Infinity;
    while ((page - 1) * 100 < total) {
      const r = await get(`${TX_LCD}/cosmos/tx/v1beta1/txs?query=${q}&order_by=ORDER_BY_ASC&limit=100&page=${page}`);
      total = Number(r.total);
      for (const t of r.tx_responses) {
        const h = Number(t.height);
        if (h < a || h >= a + CHUNK) throw new Error(`tx ${t.txhash} at ${h} outside chunk ${a}`);
        if (!seen.has(t.txhash) && seen.add(t.txhash)) out.push({ height: h, time: Date.parse(t.timestamp), code: t.code, hash: t.txhash, events: t.events });
      }
      if (!r.tx_responses.length) break;
      page++;
    }
  }
  out.sort((x, y) => x.height - y.height);
  return out;
}
function parseTrades(txs) {
  const trades = [];
  for (const tx of txs) {
    if (tx.code !== 0) continue;
    for (const ev of tx.events) {
      if (ev.type !== "wasm") continue;
      let g = null;
      const groups = [];
      for (const a of ev.attributes) {
        if (a.key === "_contract_address") groups.push((g = { _contract_address: a.value }));
        else if (g && !(a.key in g)) g[a.key] = a.value;
      }
      for (const x of groups) {
        if (x.action !== "swap" || !x.offer_amount || !x.return_amount) continue;
        if (x._contract_address === C) {
          if (x.offer_asset === "uluna") trades.push({ time: tx.time, height: tx.height, hash: tx.hash, venue: "curve", side: "buy", lunc: micro(x.offer_amount), weso: micro(x.return_amount) });
          else if (x.offer_asset === C) trades.push({ time: tx.time, height: tx.height, hash: tx.hash, venue: "curve", side: "sell", lunc: micro(x.return_amount), weso: micro(x.offer_amount) });
        } else if (x.offer_asset === C || x.ask_asset === C) {
          const sell = x.offer_asset === C;
          trades.push({
            time: tx.time,
            height: tx.height,
            hash: tx.hash,
            venue: "pool:" + x._contract_address,
            side: sell ? "sell" : "buy",
            weso: micro(sell ? x.offer_amount : x.return_amount),
            counter_asset: sell ? x.ask_asset : x.offer_asset,
            lunc: null,
          });
        }
      }
    }
  }
  return trades;
}
const txs = await allTxs();
const trades = parseTrades(txs);
log(`${txs.length} txs, ${trades.length} WESO swaps (${trades.filter((t) => t.venue === "curve").length} curve)`);
const tradeStart = txs.length ? txs[0].time : latest.time;

// ---------- USD ----------
async function cgChart(id, days) {
  const r = await get(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`);
  return r.prices;
}
const luncHourly = await cgChart("terra-luna", 90);
await sleep(2500);
const luncDaily = await cgChart("terra-luna", 365);
function luncUsdAt(t) {
  const series = t >= luncHourly[0][0] ? luncHourly : luncDaily;
  if (t <= series[0][0]) return series[0][1];
  for (let i = 1; i < series.length; i++) {
    if (series[i][0] >= t) {
      const [ta, pa] = series[i - 1];
      const [tb, pb] = series[i];
      return pa + ((t - ta) / (tb - ta)) * (pb - pa);
    }
  }
  return series[series.length - 1][1];
}
const llama = await get("https://api.llama.fi/protocol/weso-defi");
const llamaTvl = (llama.tvl || []).map((r) => ({ t: r.date * 1000, usd: r.totalLiquidityUSD }));

// ---------- curve supply path from trades ----------
// Curve buys add return_amount to curve supply and sells remove offer_amount.
// Walking trades backwards from the verified latest state gives the supply
// (and so the spec price) before the node's state window. Checked below
// against every state sample.
const anchor = samples[samples.length - 1];
const curveTrades = trades
  .filter((t) => t.venue === "curve" && t.height <= anchor.height)
  .sort((a, b) => a.height - b.height || a.time - b.time);
{
  let acc = anchor.curve_supply;
  for (let i = curveTrades.length - 1; i >= 0; i--) {
    const tr = curveTrades[i];
    tr.supply_after = acc;
    acc -= tr.side === "buy" ? tr.weso : -tr.weso;
    tr.supply_before = acc;
  }
}
function lastTradeIdx(pred) {
  let lo_ = -1;
  let hi_ = curveTrades.length - 1;
  while (lo_ < hi_) {
    const mid = Math.ceil((lo_ + hi_ + 1) / 2);
    if (pred(curveTrades[mid])) lo_ = mid;
    else hi_ = mid - 1;
  }
  return lo_;
}
const supplyAtHeight = (h) => {
  const i = lastTradeIdx((tr) => tr.height <= h);
  return i < 0 ? (curveTrades[0] ? curveTrades[0].supply_before : anchor.curve_supply) : curveTrades[i].supply_after;
};
const supplyAtTime = (t) => {
  const i = lastTradeIdx((tr) => tr.time <= t);
  return i < 0 ? (curveTrades[0] ? curveTrades[0].supply_before : anchor.curve_supply) : curveTrades[i].supply_after;
};
const recon = samples.map((x) => supplyAtHeight(x.height) - x.curve_supply);
const reconMaxAbs = recon.reduce((m, e) => Math.max(m, Math.abs(e)), 0);
const priceGap = samples.reduce((m, x) => Math.max(m, Math.abs(curve.price(x.curve_supply) / x.spot_lunc - 1)), 0);
log(`supply rebuilt from trades vs state: max |error| ${reconMaxAbs.toFixed(6)} WESO over ${samples.length} samples; spec vs spot max ${priceGap.toExponential(2)}`);
const rebuildOk = reconMaxAbs < 1;

// ---------- enrich ----------
const spotAt = (t) => curve.price(supplyAtTime(t));
for (const tr of trades) {
  if (tr.lunc == null) tr.lunc = tr.weso * spotAt(tr.time);
  tr.usd = tr.lunc * luncUsdAt(tr.time);
  tr.price_lunc = tr.lunc / tr.weso;
}
function enrich(s) {
  const lu = luncUsdAt(s.t);
  return {
    ...s,
    lunc_usd: lu,
    price_usd: s.spot_lunc * lu,
    market_cap_usd: s.circulating_supply * s.spot_lunc * lu,
    fdv_usd: s.total_supply * s.spot_lunc * lu,
    tvl_onchain_lunc: s.contract_lunc + s.dao_staked_lunc,
    tvl_onchain_usd: (s.contract_lunc + s.dao_staked_lunc) * lu,
  };
}
const rich = samples.map(enrich);
const r6 = (x) => (x == null || !Number.isFinite(x) ? null : Number(x.toPrecision(12)));
const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");

function volumeBetween(a, b) {
  const v = { trades: 0, buys: 0, sells: 0, volume_weso: 0, volume_lunc: 0, volume_usd: 0, volume_curve_usd: 0, volume_pools_usd: 0 };
  for (const tr of trades) {
    if (tr.time < a || tr.time >= b) continue;
    v.trades++;
    tr.side === "buy" ? v.buys++ : v.sells++;
    v.volume_weso += tr.weso;
    v.volume_lunc += tr.lunc;
    v.volume_usd += tr.usd;
    if (tr.venue === "curve") v.volume_curve_usd += tr.usd;
    else v.volume_pools_usd += tr.usd;
  }
  return v;
}

const intraday = rich.map((s, i) => {
  const prev = i ? rich[i - 1].t : s.t - STEP_H * H;
  const v = prev >= tradeStart ? volumeBetween(prev, s.t) : null;
  return {
    time: iso(s.t),
    height: s.height,
    price_lunc: r6(s.spot_lunc),
    price_usd: r6(s.price_usd),
    lunc_usd: r6(s.lunc_usd),
    curve_supply: r6(s.curve_supply),
    total_supply: r6(s.total_supply),
    circulating_supply: r6(s.circulating_supply),
    market_cap_usd: r6(s.market_cap_usd),
    fdv_usd: r6(s.fdv_usd),
    tvl_onchain_lunc: r6(s.tvl_onchain_lunc),
    tvl_onchain_usd: r6(s.tvl_onchain_usd),
    interval_volume_usd: v ? r6(v.volume_usd) : null,
    interval_volume_lunc: v ? r6(v.volume_lunc) : null,
    interval_trades: v ? v.trades : null,
    source: "chain-state",
  };
});

const daily = [];
const dayStart = (t) => Math.floor(t / DAY) * DAY;
const firstDay = dayStart(rebuildOk ? tradeStart : rich[0].t);
const first = rich[0];
for (let d = firstDay; d <= dayStart(latest.time); d += DAY) {
  const end = Math.min(d + DAY, latest.time);
  const inDay = rich.filter((s) => s.t >= d && s.t <= d + DAY);
  const pathPrices = curveTrades.filter((tr) => tr.time >= d && tr.time < end).map((tr) => curve.price(tr.supply_after));
  const fromState = inDay.length > 0 && inDay[0].t <= d + 4 * H;
  const fullDay = tradeStart <= d;
  const v = volumeBetween(d, end + 1);
  const ll = llamaTvl.filter((x) => dayStart(x.t) === d).pop();
  let row;
  if (fromState) {
    const closeS = inDay[inDay.length - 1];
    const prices = inDay.map((s) => s.spot_lunc).concat(pathPrices);
    row = {
      date: iso(d).slice(0, 10),
      open_lunc: r6(inDay[0].spot_lunc),
      high_lunc: r6(Math.max(...prices)),
      low_lunc: r6(Math.min(...prices)),
      close_lunc: r6(closeS.spot_lunc),
      close_usd: r6(closeS.price_usd),
      lunc_usd: r6(closeS.lunc_usd),
      curve_supply: r6(closeS.curve_supply),
      total_supply: r6(closeS.total_supply),
      circulating_supply: r6(closeS.circulating_supply),
      market_cap_usd: r6(closeS.market_cap_usd),
      fdv_usd: r6(closeS.fdv_usd),
      tvl_onchain_usd: r6(closeS.tvl_onchain_usd),
      partial_day: closeS.t < d + DAY,
      source: "chain-state",
    };
  } else {
    const lu = luncUsdAt(end);
    const sOpen = supplyAtTime(d);
    const sClose = supplyAtTime(end);
    const pOpen = curve.price(sOpen);
    const pClose = curve.price(sClose);
    const prices = [pOpen, pClose].concat(pathPrices);
    row = {
      date: iso(d).slice(0, 10),
      open_lunc: fullDay ? r6(pOpen) : null,
      high_lunc: r6(Math.max(...prices)),
      low_lunc: r6(Math.min(...prices)),
      close_lunc: r6(pClose),
      close_usd: r6(pClose * lu),
      lunc_usd: r6(lu),
      curve_supply: r6(sClose),
      total_supply: r6(first.total_supply),
      circulating_supply: r6(first.circulating_supply),
      circulating_estimated: true,
      market_cap_usd: r6(first.circulating_supply * pClose * lu),
      fdv_usd: r6(first.total_supply * pClose * lu),
      tvl_onchain_usd: null,
      partial_day: !fullDay,
      source: "chain-trades",
    };
  }
  Object.assign(row, {
    volume_usd: fullDay ? r6(v.volume_usd) : null,
    volume_lunc: fullDay ? r6(v.volume_lunc) : null,
    volume_weso: fullDay ? r6(v.volume_weso) : null,
    volume_curve_usd: fullDay ? r6(v.volume_curve_usd) : null,
    volume_pools_usd: fullDay ? r6(v.volume_pools_usd) : null,
    trades: fullDay ? v.trades : null,
    tvl_defillama_usd: ll ? r6(ll.usd) : null,
  });
  daily.push(row);
}
// DefiLlama-only days before chain history.
for (const x of llamaTvl) {
  const date = iso(dayStart(x.t)).slice(0, 10);
  if (dayStart(x.t) < firstDay && !daily.some((r) => r.date === date)) {
    daily.push({ date, tvl_defillama_usd: r6(x.usd), lunc_usd: r6(luncUsdAt(dayStart(x.t))), source: "defillama" });
  }
}
for (const snap of meta.listing.documented_snapshots) {
  const t = Date.parse(snap.date + "T00:00:00Z");
  const lu = luncUsdAt(t);
  daily.push({
    date: snap.date,
    close_lunc: snap.price_lunc,
    close_usd: r6(snap.price_lunc * lu),
    lunc_usd: r6(lu),
    curve_supply_implied: r6(impliedSupply(snap.price_lunc)),
    source: "documented",
    source_note: snap.source,
  });
}
daily.sort((a, b) => a.date.localeCompare(b.date));
function impliedSupply(p) {
  let a = 0;
  let b = curve.maxSupply;
  for (let k = 0; k < 80; k++) {
    const m = (a + b) / 2;
    if (curve.price(m) < p) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

// ---------- listing summary ----------
const now = rich[rich.length - 1];
const v24 = volumeBetween(latest.time - DAY, latest.time + 1);
const v7 = volumeBetween(latest.time - 7 * DAY, latest.time + 1);
const at = (dt) => {
  const target = latest.time - dt;
  if (target < rich[0].t) return null;
  let best = rich[0];
  for (const s of rich) if (s.t <= target) best = s;
  return best;
};
const change = (s) => (s ? { lunc: now.spot_lunc / s.spot_lunc - 1, usd: now.price_usd / s.price_usd - 1 } : null);
const listing = {
  id: meta.listing.id,
  symbol: "WESO",
  name: meta.name,
  chain: "terra-classic",
  chain_id: registry.chain.chain_id,
  contract_address: C,
  token_standard: "CW20",
  decimals: meta.decimals,
  last_updated: iso(latest.time),
  block_height: latest.height,
  price_usd: r6(now.price_usd),
  price_lunc: r6(now.spot_lunc),
  lunc_usd: r6(now.lunc_usd),
  total_supply: r6(now.total_supply),
  circulating_supply: r6(now.circulating_supply),
  max_supply: meta.listing.max_supply,
  max_supply_note: `No mint cap on chain (minter is the contract itself, cap null). The Curves 2.0 design targets ${meta.listing.design_max_supply.toLocaleString("en-US")}.`,
  design_max_supply: meta.listing.design_max_supply,
  market_cap_usd: r6(now.market_cap_usd),
  fully_diluted_valuation_usd: r6(now.fdv_usd),
  fdv_basis: "total_supply (no max supply on chain)",
  volume_24h_usd: r6(v24.volume_usd),
  volume_24h_lunc: r6(v24.volume_lunc),
  trades_24h: v24.trades,
  volume_7d_usd: r6(v7.volume_usd),
  tvl_onchain_usd: r6(now.tvl_onchain_usd),
  tvl_defillama_usd: llamaTvl.length ? r6(llamaTvl[llamaTvl.length - 1].usd) : null,
  price_change: {
    "24h": change(at(DAY)),
    "7d": change(at(7 * DAY)),
    "30d": change(at(30 * DAY)),
  },
  non_circulating: EXCLUDED.map((e, i) => ({ ...e, balance: r6(now.wallets[i]) })),
  non_circulating_total: r6(now.non_circulating),
  sources: {
    price: "curve_info.spot_price on the WESO contract (LUNC per WESO) x LUNC/USD from CoinGecko",
    supply: "token_info.total_supply; circulating = total minus non_circulating balances (CW20 balance queries)",
    volume: "Swap events on the WESO curve and WesoSwap pools from the LCD tx index",
    tvl_onchain: "Liquid LUNC in the WESO contract plus LUNC delegated by the Validator Network DAO",
    tvl_defillama: "https://api.llama.fi/protocol/weso-defi (protocol-wide, includes CW20 wrap vaults and AMM pools)",
  },
  methodology: "methodology.html",
  links: {
    website: "https://weso.world",
    twitter: "https://x.com/WESOWorld",
    defillama: "https://defillama.com/protocol/weso-defi",
    contract_info: `${LCD}/cosmwasm/wasm/v1/contract/${C}`,
  },
  coverage: {
    chain_history_from: iso(rich[0].t),
    trades_from: iso(tradeStart),
    price_from_trades_from: rebuildOk ? iso(tradeStart) : null,
    supply_rebuild_max_error_weso: r6(reconMaxAbs),
    spec_vs_spot_max_rel_error: r6(priceGap),
    defillama_from: llamaTvl.length ? iso(llamaTvl[0].t) : null,
    note: "Public LCDs prune state and the tx index after about 2-3 weeks. Earlier daily history needs an archive node.",
  },
};

// ---------- write ----------
const L = join(web, "data/listing");
mkdirSync(join(L, "supply"), { recursive: true });
mkdirSync(join(L, "history"), { recursive: true });
const wjson = (p, o) => writeFileSync(join(L, p), JSON.stringify(o, null, 1) + "\n");
function wcsv(p, rows, order = []) {
  const seen = new Set(rows.flatMap((r) => Object.keys(r)));
  const cols = order.filter((c) => seen.has(c)).concat([...seen].filter((c) => !order.includes(c)));
  const cell = (v) => (v == null ? "" : typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v));
  writeFileSync(join(L, p), [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n");
}
wjson("weso.json", listing);
writeFileSync(join(L, "supply/total.txt"), String(r6(now.total_supply)) + "\n");
writeFileSync(join(L, "supply/circulating.txt"), String(r6(now.circulating_supply)) + "\n");
writeFileSync(join(L, "supply/max.txt"), "null\n");
wjson("supply/supply.json", {
  last_updated: listing.last_updated,
  block_height: latest.height,
  total_supply: listing.total_supply,
  circulating_supply: listing.circulating_supply,
  max_supply: null,
  design_max_supply: meta.listing.design_max_supply,
  non_circulating: listing.non_circulating,
});
wjson("history/weso-daily.json", { generated_by: "scripts/build-history.mjs", coverage: listing.coverage, rows: daily });
wcsv(
  "history/weso-daily.csv",
  daily.map(({ source_note, ...r }) => r),
  ["date", "source", "open_lunc", "high_lunc", "low_lunc", "close_lunc", "close_usd", "lunc_usd", "volume_usd", "volume_lunc", "volume_weso", "volume_curve_usd", "volume_pools_usd", "trades", "curve_supply", "total_supply", "circulating_supply", "circulating_estimated", "market_cap_usd", "fdv_usd", "tvl_onchain_usd", "tvl_defillama_usd", "partial_day", "curve_supply_implied"],
);
wjson("history/weso-intraday.json", { generated_by: "scripts/build-history.mjs", step_hours: STEP_H, hourly_last_hours: HOURLY_H, rows: intraday });
wcsv("history/weso-intraday.csv", intraday);
wjson("history/weso-market_chart.json", {
  note: "Same shape as CoinGecko /coins/{id}/market_chart (USD). Chain-derived points only.",
  prices: intraday.map((r) => [Date.parse(r.time), r.price_usd]),
  market_caps: intraday.map((r) => [Date.parse(r.time), r.market_cap_usd]),
  total_volumes: intraday.map((r) => {
    const t = Date.parse(r.time);
    return [t, r6(volumeBetween(t - DAY, t + 1).volume_usd)];
  }),
});
wjson("history/weso-trades.json", { rows: trades.map((t) => ({ ...t, time: iso(t.time), lunc: r6(t.lunc), weso: r6(t.weso), usd: r6(t.usd), price_lunc: r6(t.price_lunc) })) });
wjson("history/defillama-tvl.json", { source: "https://api.llama.fi/protocol/weso-defi", methodology: llama.methodology, rows: llamaTvl.map((x) => ({ date: iso(x.t), tvl_usd: x.usd })) });
wjson("history/lunc-usd.json", { source: "CoinGecko /coins/terra-luna/market_chart (days=90 hourly, days=365 daily)", hourly: luncHourly, daily: luncDaily });

const bundle = {
  built_at: new Date().toISOString(),
  launch_anchor: meta.timeline.launch_anchor,
  listing,
  daily,
  intraday,
  trades: trades.map((t) => [t.time, t.venue === "curve" ? 0 : 1, t.side === "buy" ? 1 : 0, r6(t.weso), r6(t.lunc), r6(t.usd)]),
  defillama_tvl: llamaTvl.map((x) => [x.t, x.usd]),
  lunc_usd_daily: luncDaily,
};
writeFileSync(
  join(web, "data/history-bundle.js"),
  "// Generated by scripts/build-history.mjs. Do not edit by hand.\nwindow.HISTORY_DATA = " + JSON.stringify(bundle) + ";\n",
);
log(`wrote data/listing (${daily.filter((r) => r.source.startsWith("chain")).length} chain days, ${intraday.length} intraday rows, ${trades.length} trades)`);
log(`price $${listing.price_usd} · mcap $${Math.round(listing.market_cap_usd)} · 24h vol $${Math.round(listing.volume_24h_usd)} · circ ${Math.round(listing.circulating_supply)}`);
