#!/usr/bin/env node
// Checks data/weso-curves2.spec.json against the Curves 2.0 sheet and the
// 2026-10-08 cloud-pass LCD simulate results. Offline: reads files only.
// Writes data/weso-curves2.verification.json and exits non-zero on a miss.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const repo = join(web, "..", "..");
const deep = join(repo, "bot/knowledge/lanes/token/deep-dive-2026-10-08/sources");

const CurveModel = require(join(web, "assets/curve-model.js"));
const spec = JSON.parse(readFileSync(join(web, "data/weso-curves2.spec.json"), "utf8"));
const sweep = JSON.parse(readFileSync(join(deep, "cloud-pass/lcd-sweep.json"), "utf8"));
const sheetText = readFileSync(join(deep, "nas-derived/curves2.txt"), "utf8");

const curve = CurveModel.fromSpec(spec);
const net = spec.buy_net_factor;
const ci = sweep.weso_state.curve_info.body.data;
const S0 = Number(ci.supply) / 1e6;
const reserve = Number(ci.reserve) / 1e6;
const rel = (a, b) => (a - b) / b;

// 1. Sheet grid (right-hand "WESO Bonding Curve" table of the Curves 2.0 block).
const sheetRows = [];
let inCurves = false;
for (const line of sheetText.split("\n")) {
  if (line.startsWith("### ")) inCurves = line.startsWith("### Curves 2.0");
  if (!inCurves || !line.startsWith(" |")) continue;
  const cells = line.split("|").map((c) => c.trim());
  const supply = Number(cells[11]);
  const price = Number(cells[12]);
  if (Number.isFinite(supply) && Number.isFinite(price) && cells[11] !== "" && cells[12] !== "") {
    sheetRows.push({ supply: supply === 1 ? 0 : supply, price });
  }
}
const sheet = sheetRows.map((r) => {
  const model = curve.price(r.supply);
  return { ...r, model, rel_err: rel(model, r.price) };
});

// 2. Chain sells down to a target supply (spot after the sell).
const sells = sweep.weso_sells_to_supply
  .filter((r) => r.ok)
  .map((r) => {
    const model = curve.price(r.target_supply);
    return { supply: r.target_supply, chain_spot: r.spot, model, rel_err: rel(model, r.spot) };
  });

// 3. Chain buys binary-searched onto a target supply, within the cap.
const buys = sweep.weso_buy_to_supply
  .filter((r) => r.best && r.best.supply_after <= spec.cap_supply + 1)
  .map((r) => {
    const s1 = r.best.supply_after;
    const modelSpot = curve.price(s1);
    const modelCost = curve.costBetween(S0, s1) / net;
    return {
      target: r.target_supply,
      supply_after: s1,
      chain_spot: r.best.spot,
      model_spot: modelSpot,
      spot_rel_err: rel(modelSpot, r.best.spot),
      chain_lunc_in: r.best.lunc_in,
      model_lunc_in: modelCost,
      cost_rel_err: rel(modelCost, r.best.lunc_in),
    };
  });

// 4. Small buys from current supply (tokens out for a given LUNC in).
const coarse = sweep.weso_coarse_buys
  .filter((r) => r.ok && r.supply_after <= spec.cap_supply)
  .map((r) => {
    const out = curve.supplyAfter(S0, r.lunc_in * net) - S0;
    return { lunc_in: r.lunc_in, chain_out: r.amount_out, model_out: out, rel_err: rel(out, r.amount_out) };
  });

// 5. Notional reserve equals the area under the curve up to current supply.
const modelReserve = curve.cumulative(S0);

const maxAbs = (xs, k) => xs.reduce((m, x) => Math.max(m, Math.abs(x[k])), 0);
const summary = {
  block: sweep.block,
  curve_supply: S0,
  sheet_points: sheet.length,
  sheet_max_rel_err: maxAbs(sheet, "rel_err"),
  chain_sells: sells.length,
  chain_sells_max_rel_err: maxAbs(sells, "rel_err"),
  chain_buys: buys.length,
  chain_buys_spot_max_rel_err: maxAbs(buys, "spot_rel_err"),
  chain_buys_cost_max_rel_err: maxAbs(buys, "cost_rel_err"),
  coarse_buys: coarse.length,
  coarse_buys_max_rel_err: maxAbs(coarse, "rel_err"),
  reserve_chain: reserve,
  reserve_model: modelReserve,
  reserve_rel_err: rel(modelReserve, reserve),
  segments: CurveModel.segmentRatios(spec),
};

// Sheet prints 6 significant figures; chain spot is rounded to 1e-6 LUNC.
const limits = {
  sheet_max_rel_err: 1e-5,
  chain_sells_max_rel_err: 1e-4,
  chain_buys_spot_max_rel_err: 1e-5,
  chain_buys_cost_max_rel_err: 1e-4,
  coarse_buys_max_rel_err: 1e-4,
};
const failures = Object.entries(limits).filter(([k, lim]) => !(summary[k] <= lim));
if (Math.abs(summary.reserve_rel_err) > 1e-4) failures.push(["reserve_rel_err", 1e-4]);
summary.pass = failures.length === 0;

writeFileSync(
  join(web, "data/weso-curves2.verification.json"),
  JSON.stringify({ generated_by: "scripts/verify-spec.mjs", summary, sheet, sells, buys, coarse }, null, 1) + "\n",
);

const fmt = (x) => x.toExponential(2);
console.log(`spec vs sheet:       ${sheet.length} points, max rel err ${fmt(summary.sheet_max_rel_err)}`);
console.log(`spec vs chain sells: ${sells.length} points, max rel err ${fmt(summary.chain_sells_max_rel_err)}`);
console.log(`spec vs chain buys:  ${buys.length} points, spot ${fmt(summary.chain_buys_spot_max_rel_err)}, LUNC in ${fmt(summary.chain_buys_cost_max_rel_err)}`);
console.log(`spec vs small buys:  ${coarse.length} points, max rel err ${fmt(summary.coarse_buys_max_rel_err)}`);
console.log(`reserve: chain ${reserve.toFixed(2)} vs model ${modelReserve.toFixed(2)} (${fmt(summary.reserve_rel_err)})`);
if (!summary.pass) {
  console.error("FAIL:", failures.map((f) => f[0]).join(", "));
  process.exit(1);
}
console.log("PASS");
