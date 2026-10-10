/*
 * Piecewise-linear bonding-curve model shared by the page and the Node scripts.
 *
 * A curve is a list of knots (supply, price) with straight lines between them.
 * Two ways to get knots:
 *   - "geometric-grid": anchors plus a fixed grid step. Inside each anchor segment
 *     [a, b] the grid prices are p_a * r^k with r = (p_b / p_a)^(step / (b - a)).
 *     Optional extra knots sit at fractional grid positions with the same rule.
 *     This is the WESO "Curves 2.0" sheet, verified against chain simulate.
 *   - "sampled": knots read straight from chain simulate results (reBASE).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CurveModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function knotsFromGeometricGrid(spec) {
    const step = spec.grid_step;
    const anchors = spec.anchors;
    const extra = (spec.extra_knots || []).map((k) => k.supply);
    const pts = [];
    for (let i = 0; i < anchors.length - 1; i++) {
      const [a, pa] = anchors[i];
      const [b, pb] = anchors[i + 1];
      const n = (b - a) / step;
      if (Math.abs(n - Math.round(n)) > 1e-9) {
        throw new Error(`segment ${a}-${b} is not a whole number of grid steps`);
      }
      const r = Math.pow(pb / pa, 1 / n);
      for (let k = 0; k < Math.round(n); k++) pts.push([a + k * step, pa * Math.pow(r, k)]);
      for (const s of extra) {
        if (s > a && s < b && Math.abs((s - a) / step - Math.round((s - a) / step)) > 1e-9) {
          pts.push([s, pa * Math.pow(r, (s - a) / step)]);
        }
      }
    }
    pts.push(anchors[anchors.length - 1].slice());
    pts.sort((x, y) => x[0] - y[0]);
    return pts;
  }

  function segmentRatios(spec) {
    const out = [];
    for (let i = 0; i < spec.anchors.length - 1; i++) {
      const [a, pa] = spec.anchors[i];
      const [b, pb] = spec.anchors[i + 1];
      out.push({ from: a, to: b, p_from: pa, p_to: pb, r: Math.pow(pb / pa, spec.grid_step / (b - a)) });
    }
    return out;
  }

  function Curve(knots) {
    if (!knots || knots.length < 2) throw new Error("need at least two knots");
    this.S = knots.map((k) => k[0]);
    this.P = knots.map((k) => k[1]);
    this.C = [0];
    for (let i = 1; i < this.S.length; i++) {
      this.C.push(this.C[i - 1] + 0.5 * (this.P[i] + this.P[i - 1]) * (this.S[i] - this.S[i - 1]));
    }
    this.minSupply = this.S[0];
    this.maxSupply = this.S[this.S.length - 1];
  }

  Curve.prototype._seg = function (s) {
    const S = this.S;
    if (s <= S[0]) return 0;
    if (s >= S[S.length - 1]) return S.length - 2;
    let lo = 0;
    let hi = S.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (S[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  Curve.prototype.price = function (s) {
    const i = this._seg(s);
    const t = (s - this.S[i]) / (this.S[i + 1] - this.S[i]);
    return this.P[i] + t * (this.P[i + 1] - this.P[i]);
  };

  /* Reserve-currency area under the curve from minSupply to s. */
  Curve.prototype.cumulative = function (s) {
    const i = this._seg(s);
    const ps = this.price(s);
    return this.C[i] + 0.5 * (this.P[i] + ps) * (s - this.S[i]);
  };

  Curve.prototype.costBetween = function (s0, s1) {
    return this.cumulative(s1) - this.cumulative(s0);
  };

  /* Supply reached after adding `amount` of net reserve currency at supply s0. */
  Curve.prototype.supplyAfter = function (s0, amount) {
    const target = this.cumulative(s0) + amount;
    if (target >= this.C[this.C.length - 1]) return this.maxSupply;
    let i = this._seg(s0);
    while (i < this.S.length - 2 && this.C[i + 1] < target) i++;
    const need = target - this.C[i];
    const p0 = this.P[i];
    const m = (this.P[i + 1] - p0) / (this.S[i + 1] - this.S[i]);
    let dx;
    if (Math.abs(m) < 1e-18) dx = need / p0;
    else dx = (-p0 + Math.sqrt(p0 * p0 + 2 * m * need)) / m;
    return this.S[i] + dx;
  };

  /* Evenly spaced samples that always include every knot inside [s0, s1]. */
  Curve.prototype.sample = function (s0, s1, n) {
    const out = [];
    const step = (s1 - s0) / n;
    let k = 0;
    for (let j = 0; j <= n; j++) {
      const s = s0 + j * step;
      while (k < this.S.length && this.S[k] < s) {
        if (this.S[k] > s0) out.push(this.S[k]);
        k++;
      }
      out.push(s);
    }
    return out;
  };

  function fromSpec(spec) {
    if (spec.model === "geometric-grid") return new Curve(knotsFromGeometricGrid(spec));
    if (spec.model === "sampled") return new Curve(spec.knots);
    throw new Error(`unknown curve model ${spec.model}`);
  }

  /* Design schedule: cumulative supply (millions) at fractional year t. */
  function scheduleSupply(schedule, t) {
    let total = schedule.premine;
    if (t <= 0) return total;
    for (let y = 0; y < schedule.yearly.length; y++) {
      const mined = schedule.yearly[y];
      if (t >= y + 1) total += mined;
      else return total + mined * (t - y);
    }
    return total;
  }

  function scheduleYearFor(schedule, millions) {
    if (millions <= schedule.premine) return 0;
    let total = schedule.premine;
    for (let y = 0; y < schedule.yearly.length; y++) {
      const mined = schedule.yearly[y];
      if (total + mined >= millions) return y + (millions - total) / mined;
      total += mined;
    }
    return null;
  }

  return {
    Curve,
    fromSpec,
    knotsFromGeometricGrid,
    segmentRatios,
    scheduleSupply,
    scheduleYearFor,
  };
});
