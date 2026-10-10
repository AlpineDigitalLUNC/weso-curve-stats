#!/usr/bin/env node
// Read-only refresh of data/snapshot.json: GET requests to a public Terra Classic
// LCD, CoinGecko and weso.world's public API. Never signs or broadcasts anything.
// Usage: node scripts/refresh-snapshot.mjs [--lcd https://...]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const registry = JSON.parse(readFileSync(join(web, "data/registry.json"), "utf8"));
const argLcd = process.argv.indexOf("--lcd");
const LCD = argLcd > 0 ? process.argv[argLcd + 1] : registry.chain.lcd[0];

async function get(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.ok) return await res.json();
      if (res.status < 500) throw new Error(`${res.status} ${url}`);
    } catch (err) {
      if (attempt === 3) throw err;
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
}
const smart = (addr, msg) =>
  get(`${LCD}/cosmwasm/wasm/v1/contract/${addr}/smart/${Buffer.from(JSON.stringify(msg)).toString("base64")}`).then(
    (r) => r.data,
  );
const micro = (x) => Number(x) / 1e6;
const bank = async (addr) => {
  const r = await get(`${LCD}/cosmos/bank/v1beta1/balances/${addr}`);
  return Object.fromEntries(r.balances.map((b) => [b.denom, micro(b.amount)]));
};

const block = (await get(`${LCD}/cosmos/base/tendermint/v1beta1/blocks/latest`)).block.header;
const snapshot = {
  generated_by: "scripts/refresh-snapshot.mjs",
  lcd: LCD,
  block: { height: Number(block.height), time: block.time, chain_id: block.chain_id },
  curves: {},
};

for (const c of registry.curves) {
  const addr = c.contract;
  const [ci, ti, minter, cw20Self, balances] = await Promise.all([
    smart(addr, { curve_info: {} }),
    smart(addr, { token_info: {} }),
    smart(addr, { minter: {} }),
    smart(addr, { balance: { address: addr } }),
    bank(addr),
  ]);
  snapshot.curves[c.id] = {
    curve_supply: micro(ci.supply),
    spot_price: micro(ci.spot_price),
    reserve_notional: micro(ci.reserve),
    tax_collected: micro(ci.tax_collected),
    reserve_denom: ci.reserve_denom,
    total_supply: micro(ti.total_supply),
    minter_cap: minter.cap,
    contract_token_balance: micro(cw20Self.balance),
    contract_bank: balances,
  };
}

const dao = registry.staking.validator_dao;
const dels = await get(`${LCD}/cosmos/staking/v1beta1/delegations/${dao}?pagination.limit=50`);
const validators = [];
for (const d of dels.delegation_responses) {
  const v = (await get(`${LCD}/cosmos/staking/v1beta1/validators/${d.delegation.validator_address}`)).validator;
  validators.push({
    operator: d.delegation.validator_address,
    moniker: v.description.moniker,
    commission: Number(v.commission.commission_rates.rate),
    delegated_lunc: micro(d.balance.amount),
  });
}
validators.sort((a, b) => b.delegated_lunc - a.delegated_lunc);
snapshot.staking = {
  validator_dao: dao,
  total_delegated_lunc: validators.reduce((s, v) => s + v.delegated_lunc, 0),
  validators,
};

const ids = [...new Set(registry.curves.map((c) => c.reserve.coingecko_id))].join(",");
const cg = await get(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_last_updated_at=true`);
snapshot.usd = {
  source: "CoinGecko simple/price",
  prices: Object.fromEntries(
    Object.entries(cg).map(([id, v]) => [id, { usd: v.usd, at: new Date(v.last_updated_at * 1000).toISOString() }]),
  ),
};

try {
  const [stats, prices] = await Promise.all([get(registry.site_api.stats), get(registry.site_api.prices)]);
  snapshot.site_api = {
    fetched_at: new Date().toISOString(),
    stats: { supply: stats.supply, totalSupply: stats.totalSupply, burned: stats.burned, reserve: stats.reserve },
    prices_usd: Object.fromEntries(["WESO", "LUNC", "USTC", "REBASE"].map((k) => [k, prices[k] ? prices[k].price : null])),
  };
} catch (err) {
  snapshot.site_api = { error: String(err) };
}

writeFileSync(join(web, "data/snapshot.json"), JSON.stringify(snapshot, null, 1) + "\n");
console.log(`snapshot at block ${snapshot.block.height} (${snapshot.block.time})`);
for (const [id, c] of Object.entries(snapshot.curves)) {
  console.log(`  ${id}: curve ${c.curve_supply.toFixed(0)}, total ${c.total_supply.toFixed(0)}, spot ${c.spot_price}`);
}
console.log(`  staked by DAO: ${snapshot.staking.total_delegated_lunc.toFixed(0)} LUNC`);
