#!/usr/bin/env node
// Builds data/rebase-sampled.json from the 2026-10-08 cloud-pass LCD simulates.
// reBASE has no published numeric spec, so its curve is the sampled spot prices
// joined by straight lines. Offline: reads files only.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const deep = join(web, "../../bot/knowledge/lanes/token/deep-dive-2026-10-08/sources/cloud-pass");
const sweep = JSON.parse(readFileSync(join(deep, "lcd-sweep.json"), "utf8"));
const follow = JSON.parse(readFileSync(join(deep, "lcd-followup.json"), "utf8"));
const rb = sweep.rebase;
const ci = rb.curve_info.body.data;

const pts = new Map();
const add = (supply, spot, from) => {
  if (!(supply > 0) || !(spot > 0)) return;
  const key = Math.round(supply);
  if (!pts.has(key)) pts.set(key, { supply: key, price: spot, from });
};
add(Number(ci.supply) / 1e6, Number(ci.spot_price) / 1e6, "curve_info");
for (const r of rb.sells_to_supply || []) if (r.ok) add(r.target_supply, r.spot, "sell simulate");
for (const r of rb.coarse_buys || []) if (r.ok) add(r.supply_after, r.spot, "buy simulate");
for (const r of follow.rebase_upper || []) if (r.ok) add(r.supply, r.spot, "buy simulate");

const sorted = [...pts.values()].sort((a, b) => a.supply - b.supply);
const knots = [[0, sorted[0].price], ...sorted.map((p) => [p.supply, p.price])];
const firstZero = (follow.rebase_upper || []).find((r) => !r.ok);

const out = {
  id: "rebase-sampled-2026-10-08",
  name: "reBASE (sampled)",
  description:
    "Spot price of one reBASE in USTC at sampled curve supplies, from LCD simulate. No numeric spec is published; the REBASE 1.0 chart only shows a 0-200M supply axis. Straight lines between samples.",
  source: {
    files: [
      "bot/knowledge/lanes/token/deep-dive-2026-10-08/sources/cloud-pass/lcd-sweep.json (rebase.sells_to_supply, rebase.coarse_buys)",
      "bot/knowledge/lanes/token/deep-dive-2026-10-08/sources/cloud-pass/lcd-followup.json (rebase_upper)",
    ],
    block: sweep.block,
    note: "The point at supply 0 repeats the lowest sample (0.035 USTC from 0.1M to 5M).",
  },
  units: { supply: "reBASE", price: "USTC per reBASE", reserve: "USTC" },
  model: "sampled",
  buy_net_factor: 0.9801,
  buy_net_factor_note: "Assumed equal to WESO (same code family and tax params); not separately verified for reBASE.",
  max_sampled_supply: knots[knots.length - 1][0],
  zero_result_from_ustc: firstZero ? firstZero.payment : null,
  samples: sorted,
  knots,
};
writeFileSync(join(web, "data/rebase-sampled.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${knots.length} knots, max supply ${(out.max_sampled_supply / 1e6).toFixed(2)}M`);
