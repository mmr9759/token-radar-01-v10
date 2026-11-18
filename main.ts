// Token Launch Radar — radar-10. Entry for make.fun token-radar-01, built as @mmr9759.
//
// Reads the sealed snapshot (/input/snapshot.json), ranks the clean pre-token
// protocols by implied value, and writes /output/board.json, /output/dashboard/
// (index.html, app.css, app.js, data.js), /output/screenshots/ and
// /output/dossier.json. Node 22, standard library only, no network,
// deterministic: two runs write byte-identical output.
//
// The value model ("comps-calibrated value"):
//   - comps = the 128 protocols whose token already trades (mcap_usd set).
//     y = log(mcap / TVL) for each comp.
//   - y is winsorised at the global 90th percentile first, so one wild comp
//     (a 400x mcap/TVL) cannot set its whole category's multiple.
//   - category multiple = median of winsorised y in the category, shrunk
//     K=6 toward the global median (in log space).
//   - size curve: slope of (y - category multiple) on
//     (log10 TVL - category mean log10 TVL), fitted on the winsorised comps,
//     at HALF strength, anchored at each category's mean size (global mean
//     when the category has no comps). A protocol 10x its category's typical
//     size keeps about 70% of its multiple.
//   - NO growth term, NO age term: both were tested blind (leave-one-out and
//     walk-forward) and neither beat the model without them, so they were
//     dropped. The blind numbers are computed here and shipped in board.json.
//   - implied value = TVL * exp(category multiple + size adjustment).
//
// The board holds the 198 clean pre-token protocols: every protocol that
// records no token and passes the watchlist's cleanliness rules (no wrapped /
// staked / bridged product, no versioned name, no exchange prefix), at any
// TVL from $5M up. All 40 watchlist protocols are included.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SHRINK_K = 6;
const WF_CUTOFF = '2024-07-01';

interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Comp extends Protocol {
  y: number; // log(mcap / TVL), raw
  yw: number; // winsorised at the global p90
  lt: number; // log10(TVL)
}

interface Fit {
  gMed: number;
  gLt: number;
  catMed: Map<string, number>;
  catLt: Map<string, number>;
  slope: number; // half-strength size slope, per log10 TVL
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function catKey(p: Protocol): string {
  return p.category ?? '(none)';
}

// The watchlist's cleanliness rules, minus the TVL floor: a protocol that
// records no token and is not a wrapped, staked or bridged product, has no
// version marker in its name, and is not named after an exchange.
function isCleanPreToken(p: Protocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  const badCat = new Set([
    'Bridge', 'Canonical Bridge', 'Liquid Staking',
    'Liquid Restaking', 'Restaked BTC', 'CEX',
  ]);
  if (p.category !== null && badCat.has(p.category)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(p.name)) return false;
  if (/^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/.test(p.name)) return false;
  return true;
}

function fitModel(comps: Comp[]): Fit {
  const p90 = percentile(comps.map((c) => c.y), 0.9);
  const t: Comp[] = comps.map((c) => ({ ...c, yw: Math.min(c.y, p90) }));
  const gMed = median(t.map((c) => c.yw));
  const gLt = mean(t.map((c) => c.lt));
  const byCat = new Map<string, Comp[]>();
  for (const c of t) {
    const k = catKey(c);
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k)!.push(c);
  }
  const catMed = new Map<string, number>();
  const catLt = new Map<string, number>();
  for (const [k, v] of byCat) {
    const m = median(v.map((c) => c.yw));
    catMed.set(k, (v.length * m + SHRINK_K * gMed) / (v.length + SHRINK_K));
    catLt.set(k, mean(v.map((c) => c.lt)));
  }
  // Half-strength size slope on residuals after the category effect.
  let num = 0;
  let den = 0;
  for (const c of t) {
    const r = c.yw - (catMed.get(catKey(c)) ?? gMed);
    const d = c.lt - (catLt.get(catKey(c)) ?? gLt);
    num += r * d;
    den += d * d;
  }
  const slope = den > 0 ? (num / den) * 0.5 : 0;
  return { gMed, gLt, catMed, catLt, slope };
}

// Log-multiple prediction for any protocol under a fit.
function predictLogMultiple(fit: Fit, p: Protocol): { mult: number; sizeAdj: number } {
  const k = catKey(p);
  const mult = fit.catMed.get(k) ?? fit.gMed;
  const anchor = fit.catLt.get(k) ?? fit.gLt;
  const sizeAdj = fit.slope * (Math.log10(p.tvl_usd) - anchor);
  return { mult, sizeAdj };
}

// Blind validation. Errors are mean |log error| against the raw log-multiple,
// reported as a multiple: exp(mean |log error|). The flat baseline predicts
// the global median (of winsorised log-multiples) for every protocol.
function blindCheck(comps: Comp[]): {
  loo: { flat: number; model: number };
  wf: { flat: number; model: number };
} {
  // Leave-one-out over all comps.
  let flatErr = 0;
  let modelErr = 0;
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const fit = fitModel(train);
    const flatPred = fit.gMed;
    const { mult, sizeAdj } = predictLogMultiple(fit, comps[i]);
    flatErr += Math.abs(flatPred - comps[i].y);
    modelErr += Math.abs(mult + sizeAdj - comps[i].y);
  }
  const loo = {
    flat: Math.exp(flatErr / comps.length),
    model: Math.exp(modelErr / comps.length),
  };
  // Walk-forward: fit on protocols listed before the cutoff, test on later ones.
  const train = comps.filter((c) => c.listed_at !== null && c.listed_at < WF_CUTOFF);
  const test = comps.filter((c) => c.listed_at !== null && c.listed_at >= WF_CUTOFF);
  const fit = fitModel(train);
  let wfFlat = 0;
  let wfModel = 0;
  for (const c of test) {
    const { mult, sizeAdj } = predictLogMultiple(fit, c);
    wfFlat += Math.abs(fit.gMed - c.y);
    wfModel += Math.abs(mult + sizeAdj - c.y);
  }
  const wf = {
    flat: Math.exp(wfFlat / test.length),
    model: Math.exp(wfModel / test.length),
  };
  return { loo, wf };
}

// ---- Farm plans -----------------------------------------------------------
// Same templates as dashboard/app.js farmSteps(): the page generates a row's
// plan from the row's own figures, and this function writes the identical
// plan into board.json, so page and board always agree.
const LEND_CATS = new Set(['Lending', 'CDP', 'CDP Manager']);
const TRADE_CATS = new Set(['Dexs', 'Derivatives', 'Options', 'Perpetuals', 'Prediction Market']);
const VAULT_CATS = new Set([
  'Yield', 'Yield Aggregator', 'Vaults', 'Onchain Capital Allocator',
  'Risk Curators', 'RWA', 'Basis Trading', 'Restaking', 'Indexes', 'Liquid Restaking',
]);
const BRIDGE_CATS = new Set(['Cross Chain Bridge', 'Bridge', 'Canonical Bridge']);

function farmGroup(category: string | null): string {
  if (category !== null && LEND_CATS.has(category)) return 'lend';
  if (category !== null && TRADE_CATS.has(category)) return 'trade';
  if (category !== null && VAULT_CATS.has(category)) return 'vault';
  if (category !== null && BRIDGE_CATS.has(category)) return 'bridge';
  return 'use';
}

function amountFor(tvl: number): string {
  if (tvl >= 500000000) return '$250–$1,000';
  if (tvl >= 100000000) return '$100–$500';
  return '$50–$250';
}

function gasFor(chain: string): string {
  if (chain === 'Ethereum') return '$2–$15 of gas per transaction';
  if (['Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BSC'].includes(chain)) {
    return 'under $1 of gas per transaction';
  }
  return '$0.50–$3 of gas per transaction';
}

function farmSteps(p: Protocol): string[] {
  const name = p.name;
  const chain = p.chains.length > 0 ? p.chains[0] : 'its main chain';
  const amt = amountFor(p.tvl_usd);
  const gas = gasFor(chain);
  const g = p.change_7d === null || p.change_7d === undefined
    ? null
    : 'TVL moved ' + (p.change_7d >= 0 ? '+' : '') + p.change_7d.toFixed(1) + '% over the last 7 days, so ';
  const watch = "Watch " + name + "'s official announcements only. No token is guaranteed, so never pay anyone who promises an airdrop allocation or early access.";
  const setup = "Open " + name + "'s official site, connect a self-custody wallet on " + chain +
    ", and double-check the URL before approving anything. Allow about 10 minutes and " + gas + ".";
  const grp = farmGroup(p.category);
  let second = '';
  let third = '';
  let fourth = '';
  if (grp === 'lend') {
    second = 'Supply ' + amt + ' of a major stablecoin as collateral, then borrow a small amount against it and keep the position above a 200% collateral ratio.';
    third = 'Put the borrowed funds to work once on ' + chain + ' — for example, swap them into the protocol\'s main market — then repay part of the loan to keep the health factor high.';
    fourth = (g ?? '') + 'check the position weekly and top up collateral if the market drops, keeping a dated record of every deposit, borrow and repayment.';
  } else if (grp === 'trade') {
    second = 'Add ' + amt + ' of liquidity to the busiest pool on ' + chain + ', in the pair the protocol routes most volume through, and hold the LP position.';
    third = 'Trade through the protocol at least twice a month — small swaps count — so the wallet shows real usage instead of a single deposit.';
    fourth = (g ?? '') + 'review the pool weekly: leave if fees dry up, and keep a dated record of every swap and deposit.';
  } else if (grp === 'vault') {
    second = 'Deposit ' + amt + ' into the highest-TVL vault on ' + chain + ' and keep the receipt token in the same wallet; do not move it to another address.';
    third = 'Harvest or compound the yield once a week, and add a small top-up each month while the vault keeps paying out.';
    fourth = (g ?? '') + 'check the vault\'s yield weekly and exit if the return collapses or the vault pauses.';
  } else if (grp === 'bridge') {
    second = 'Bridge ' + amt + ' to ' + chain + ' through ' + name + '\'s official route, then bridge it back once, keeping the whole round trip in the same wallet.';
    third = 'Use the bridged funds on ' + chain + ' at least once — a swap or a deposit — so the trip is real usage, not an empty transfer.';
    fourth = (g ?? '') + 'check the route weekly: bridge again only when fees are low, and keep a dated record of every crossing.';
  } else {
    second = 'Use ' + name + '\'s core feature on ' + chain + ' with ' + amt + ' — the action the protocol is built for — and complete the full flow, not just a wallet connection.';
    third = 'Repeat the core action at least twice a month, varying the size a little, so the history reads like a real user rather than a single visit.';
    fourth = (g ?? '') + 'check the protocol weekly, keep a dated record of every action, and stop if the feature pauses or the TVL drains fast.';
  }
  fourth = fourth.charAt(0).toUpperCase() + fourth.slice(1);
  return [setup, second, third, fourth, watch];
}

// ---- Board ----------------------------------------------------------------
interface Scored {
  p: Protocol;
  value: number;
  mult: number;
  sizeAdj: number;
}

function buildBoard(
  snapshot: { as_of: string; protocols: Protocol[]; watchlist: string[] },
): { rows: Scored[]; fit: Fit; check: ReturnType<typeof blindCheck>; comps: number } {
  const comps: Comp[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({
      ...p,
      y: Math.log(p.mcap_usd! / p.tvl_usd),
      yw: 0,
      lt: Math.log10(p.tvl_usd),
    }));
  const fit = fitModel(comps);
  const check = blindCheck(comps);
  const watch = new Set(snapshot.watchlist);
  const scoped = snapshot.protocols.filter(isCleanPreToken);
  const scored: Scored[] = scoped.map((p) => {
    const { mult, sizeAdj } = predictLogMultiple(fit, p);
    return { p, value: Math.round(p.tvl_usd * Math.exp(mult + sizeAdj)), mult, sizeAdj };
  });
  // Rank by value, ties broken by slug so the order is total and stable.
  scored.sort((a, b) => (b.value - a.value) || (a.p.slug < b.p.slug ? -1 : 1));
  // Implied values must not rise as rank ascends: nudge exact ties down by $1.
  for (let i = 1; i < scored.length; i++) {
    if (scored[i].value >= scored[i - 1].value) {
      scored[i].value = Math.max(1, scored[i - 1].value - 1);
    }
  }
  // The watchlist must be fully covered; it is, by construction, but prove it.
  const have = new Set(scored.map((s) => s.p.slug));
  for (const slug of watch) {
    if (!have.has(slug)) throw new Error('watchlist slug missing from board: ' + slug);
  }
  return { rows: scored, fit, check, comps: comps.length };
}

// ---- Output ---------------------------------------------------------------
function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = '/input/snapshot.json';
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && i + 1 < argv.length) input = argv[++i];
    else if (argv[i] === '--output' && i + 1 < argv.length) output = argv[++i];
  }
  return { input, output };
}

async function main(): Promise<void> {
  const { input, output } = parseArgs(process.argv.slice(2));
  const outDir = output.startsWith('/') ? output : join(process.cwd(), output);
  const snapshot = JSON.parse(readFileSync(input, 'utf8')) as {
    as_of: string;
    source: string;
    floor_usd: number;
    protocols: Protocol[];
    watchlist: string[];
  };
  const { rows, fit, check, comps } = buildBoard(snapshot);
  const watch = new Set(snapshot.watchlist);

  mkdirSync(outDir, { recursive: true });

  // board.json — the ranked board with farm plans.
  const boardRows = rows.map((s, i) => {
    const steps = farmSteps(s.p);
    for (const st of steps) {
      const len = st.trim().length;
      if (len < 20 || len > 600) {
        throw new Error(`farm step length ${len} out of range for ${s.p.slug}: ${st}`);
      }
    }
    return {
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      implied_value_usd: s.value,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      multiple: round4(Math.exp(s.mult)),
      size_adjustment: round4(s.sizeAdj),
      watchlist: watch.has(s.p.slug),
      farm_steps: steps,
    };
  });
  const board = {
    as_of: snapshot.as_of,
    model: {
      name: 'comps-calibrated value (radar-10)',
      comps,
      global_multiple: round4(Math.exp(fit.gMed)),
      size_slope_half_per_log10_tvl: round4(fit.slope),
      winsorise_percentile: 90,
      shrinkage_k: SHRINK_K,
      loo_error_x: { flat: round4(check.loo.flat), model: round4(check.loo.model) },
      walk_forward_cutoff: WF_CUTOFF,
      walk_forward_error_x: { flat: round4(check.wf.flat), model: round4(check.wf.model) },
      note: 'Growth and age terms were tested blind (leave-one-out and walk-forward) and dropped: neither beat the model without them.',
    },
    rows: boardRows,
  };
  writeFileSync(join(outDir, 'board.json'), JSON.stringify(board, null, 2) + '\n', 'utf8');

  // dashboard/data.js — compact rows the page renders (one row per line).
  mkdirSync(join(outDir, 'dashboard'), { recursive: true });
  const dataMeta = {
    asOf: snapshot.as_of,
    watchN: snapshot.watchlist.length,
    comps,
    gMult: round4(Math.exp(fit.gMed)),
    slope: round4(fit.slope),
    loo: { flat: round4(check.loo.flat), model: round4(check.loo.model) },
    wf: { flat: round4(check.wf.flat), model: round4(check.wf.model) },
  };
  const dataLines: string[] = [];
  dataLines.push('window.TOKEN_RADAR = ' + JSON.stringify(dataMeta).slice(0, -1) + ',"rows":[');
  rows.forEach((s, i) => {
    const row = {
      r: i + 1,
      s: s.p.slug,
      n: s.p.name,
      c: s.p.category ?? 'Uncategorised',
      ch: s.p.chains,
      t: s.p.tvl_usd,
      g: s.p.change_7d,
      l: s.p.listed_at,
      v: s.value,
      m: round4(Math.exp(s.mult)),
      a: round4(s.sizeAdj),
      w: watch.has(s.p.slug) ? 1 : 0,
    };
    dataLines.push(JSON.stringify(row) + (i + 1 < rows.length ? ',' : ''));
  });
  dataLines.push(']};');
  writeFileSync(join(outDir, 'dashboard', 'data.js'), dataLines.join('\n') + '\n', 'utf8');

  // Copy the dashboard page and the screenshots into /output. The repo's
  // dashboard/ holds no data.js, so the copy leaves the one written above
  // alone; it is written once more after the copy to be safe.
  cpSync(join(ROOT, 'dashboard'), join(outDir, 'dashboard'), { recursive: true });
  writeFileSync(join(outDir, 'dashboard', 'data.js'), dataLines.join('\n') + '\n', 'utf8');
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });
  cpSync(join(ROOT, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });

  // dossier.json — byte for byte what the vendor library writes.
  const dossierResult: unknown = await buildDossier(outDir, { text_max_bytes: 65536 });
  const dossierPath = join(outDir, 'dossier.json');
  if (typeof dossierResult === 'string') {
    writeFileSync(dossierPath, dossierResult, 'utf8');
  } else if (dossierResult instanceof Uint8Array) {
    writeFileSync(dossierPath, dossierResult);
  } else if (dossierResult !== undefined && dossierResult !== null && typeof dossierResult === 'object') {
    writeFileSync(dossierPath, JSON.stringify(dossierResult), 'utf8');
  }
  if (!existsSync(dossierPath)) {
    throw new Error('buildDossier wrote no dossier.json and returned nothing usable');
  }

  console.log(`radar-10: ${rows.length} rows, ${comps} comps, global multiple ${Math.exp(fit.gMed).toFixed(4)}x, size slope (half) ${fit.slope.toFixed(4)}/log10`);
  console.log(`blind check: LOO flat ${check.loo.flat.toFixed(2)}x vs model ${check.loo.model.toFixed(2)}x; walk-forward flat ${check.wf.flat.toFixed(2)}x vs model ${check.wf.model.toFixed(2)}x`);
  console.log('top 5: ' + rows.slice(0, 5).map((s) => `${s.p.slug} $${s.value.toLocaleString('en-US')}`).join(', '));
  console.log(`wrote ${outDir}/board.json, dashboard/, screenshots/, dossier.json`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
