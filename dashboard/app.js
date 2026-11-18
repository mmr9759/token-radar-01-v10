'use strict';
/* Token Launch Radar — dashboard logic. Data comes from data.js (TOKEN_RADAR).
   Farm plans are generated here from the row's own figures, with the same
   templates main.ts uses for board.json, so page and board always agree. */
var DATA = (typeof window !== 'undefined' && window.TOKEN_RADAR) ||
  (typeof globalThis !== 'undefined' && globalThis.TOKEN_RADAR) || null;

var LEND = ['Lending', 'CDP', 'CDP Manager'];
var TRADE = ['Dexs', 'Derivatives', 'Options', 'Perpetuals', 'Prediction Market'];
var VAULT = ['Yield', 'Yield Aggregator', 'Vaults', 'Onchain Capital Allocator',
  'Risk Curators', 'RWA', 'Basis Trading', 'Restaking', 'Indexes', 'Liquid Restaking'];
var BRIDGE = ['Cross Chain Bridge', 'Bridge', 'Canonical Bridge'];

function groupOf(cat) {
  if (LEND.indexOf(cat) >= 0) return 'lend';
  if (TRADE.indexOf(cat) >= 0) return 'trade';
  if (VAULT.indexOf(cat) >= 0) return 'vault';
  if (BRIDGE.indexOf(cat) >= 0) return 'bridge';
  return 'use';
}
function amtFor(tvl) {
  if (tvl >= 500000000) return '$250–$1,000';
  if (tvl >= 100000000) return '$100–$500';
  return '$50–$250';
}
function gasFor(chain) {
  if (chain === 'Ethereum') return '$2–$15 of gas per transaction';
  if (['Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BSC'].indexOf(chain) >= 0)
    return 'under $1 of gas per transaction';
  return '$0.50–$3 of gas per transaction';
}
function growthLine(g) {
  if (g === null || g === undefined) return null;
  var s = (g >= 0 ? '+' : '') + g.toFixed(1) + '%';
  return 'TVL moved ' + s + ' over the last 7 days, so ';
}
function farmSteps(r) {
  var name = r.n, chain = (r.ch && r.ch[0]) || 'its main chain';
  var amt = amtFor(r.t), gas = gasFor(chain), g = growthLine(r.g);
  var watch = "Watch " + name + "'s official announcements only. No token is guaranteed, so never pay anyone who promises an airdrop allocation or early access.";
  var setup = "Open " + name + "'s official site, connect a self-custody wallet on " + chain +
    ", and double-check the URL before approving anything. Allow about 10 minutes and " + gas + ".";
  var grp = groupOf(r.c);
  var second, third, fourth;
  if (grp === 'lend') {
    second = 'Supply ' + amt + ' of a major stablecoin as collateral, then borrow a small amount against it and keep the position above a 200% collateral ratio.';
    third = 'Put the borrowed funds to work once on ' + chain + ' — for example, swap them into the protocol\'s main market — then repay part of the loan to keep the health factor high.';
    fourth = (g || '') + 'check the position weekly and top up collateral if the market drops, keeping a dated record of every deposit, borrow and repayment.';
  } else if (grp === 'trade') {
    second = 'Add ' + amt + ' of liquidity to the busiest pool on ' + chain + ', in the pair the protocol routes most volume through, and hold the LP position.';
    third = 'Trade through the protocol at least twice a month — small swaps count — so the wallet shows real usage instead of a single deposit.';
    fourth = (g || '') + 'review the pool weekly: leave if fees dry up, and keep a dated record of every swap and deposit.';
  } else if (grp === 'vault') {
    second = 'Deposit ' + amt + ' into the highest-TVL vault on ' + chain + ' and keep the receipt token in the same wallet; do not move it to another address.';
    third = 'Harvest or compound the yield once a week, and add a small top-up each month while the vault keeps paying out.';
    fourth = (g || '') + 'check the vault\'s yield weekly and exit if the return collapses or the vault pauses.';
  } else if (grp === 'bridge') {
    second = 'Bridge ' + amt + ' to ' + chain + ' through ' + name + '\'s official route, then bridge it back once, keeping the whole round trip in the same wallet.';
    third = 'Use the bridged funds on ' + chain + ' at least once — a swap or a deposit — so the trip is real usage, not an empty transfer.';
    fourth = (g || '') + 'check the route weekly: bridge again only when fees are low, and keep a dated record of every crossing.';
  } else {
    second = 'Use ' + name + '\'s core feature on ' + chain + ' with ' + amt + ' — the action the protocol is built for — and complete the full flow, not just a wallet connection.';
    third = 'Repeat the core action at least twice a month, varying the size a little, so the history reads like a real user rather than a single visit.';
    fourth = (g || '') + 'check the protocol weekly, keep a dated record of every action, and stop if the feature pauses or the TVL drains fast.';
  }
  fourth = fourth.charAt(0).toUpperCase() + fourth.slice(1);
  return [setup, second, third, fourth, watch];
}

function fmtUsd(x) {
  if (x >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
  if (x >= 1e6) return '$' + (x / 1e6).toFixed(x >= 1e8 ? 0 : 1) + 'M';
  if (x >= 1e3) return '$' + (x / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(x);
}
function fmtPct(x) {
  if (x === null || x === undefined) return 'n/a';
  return (x >= 0 ? '+' : '') + x.toFixed(1) + '%';
}
function ageText(listed, asOf) {
  if (!listed) return 'n/a';
  var days = Math.round((new Date(asOf + 'T00:00:00Z') - new Date(listed + 'T00:00:00Z')) / 864e5);
  if (days < 60) return days + 'd';
  if (days < 730) return (days / 30.44).toFixed(0) + ' mo';
  return (days / 365.25).toFixed(1) + ' yrs';
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

if (typeof document !== 'undefined' && DATA) {
  var rowsEl = document.getElementById('rows');
  var detailEl = document.getElementById('detail');
  var catSel = document.getElementById('cat');
  var qEl = document.getElementById('q');
  var watchEl = document.getElementById('watch');
  var sortEl = document.getElementById('sort');
  var selected = null;

  var cats = [];
  DATA.rows.forEach(function (r) { if (cats.indexOf(r.c) < 0) cats.push(r.c); });
  cats.sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o);
  });
  document.getElementById('meta').innerHTML =
    '<b>' + DATA.rows.length + '</b> protocols<br><b>' + DATA.watchN +
    '</b> on the watchlist<br>snapshot ' + esc(DATA.asOf);
  document.getElementById('asof').textContent = DATA.asOf;
  document.getElementById('method').textContent =
    'Implied value = TVL × category multiple × size factor. Multiples come from the ' + DATA.comps +
    ' protocols whose token already trades: log(market cap / TVL), winsorised at the 90th percentile, ' +
    'per-category median shrunk K=6 toward the global median ' + DATA.gMult.toFixed(2) + '×. ' +
    'The size curve is half the fitted slope (' + DATA.slope.toFixed(2) + ' per log10 TVL), anchored at each ' +
    'category’s mean size. Growth and age were tested blind and dropped — neither beat the model without them. ' +
    'Blind check: leave-one-out error ' + DATA.loo.model.toFixed(1) + '× vs ' + DATA.loo.flat.toFixed(1) +
    '× for a flat multiple; walk-forward ' + DATA.wf.model.toFixed(1) + '× vs ' + DATA.wf.flat.toFixed(1) + '×.';

  function filtered() {
    var q = qEl.value.trim().toLowerCase();
    var list = DATA.rows.filter(function (r) {
      if (watchEl.checked && !r.w) return false;
      if (catSel.value && r.c !== catSel.value) return false;
      if (q && r.n.toLowerCase().indexOf(q) < 0 && r.s.indexOf(q) < 0) return false;
      return true;
    });
    var mode = sortEl.value;
    list.sort(function (a, b) {
      if (mode === 'tvl') return b.t - a.t;
      if (mode === 'growth') return (b.g === null ? -1e9 : b.g) - (a.g === null ? -1e9 : a.g);
      if (mode === 'age') return (a.l || '9999') < (b.l || '9999') ? -1 : 1;
      if (mode === 'name') return a.n < b.n ? -1 : 1;
      return a.r - b.r;
    });
    return list;
  }

  function render() {
    var list = filtered();
    rowsEl.innerHTML = list.map(function (r) {
      var cls = r.g === null ? '' : (r.g >= 0 ? 'up' : 'down');
      return '<tr data-slug="' + esc(r.s) + '"' + (selected === r.s ? ' class="sel"' : '') + '>' +
        '<td class="rank">' + r.r + '</td><td><b>' + esc(r.n) + '</b><br><span style="color:var(--muted);font-size:12px">' + esc(r.s) + '</span></td>' +
        '<td><span class="cat">' + esc(r.c || '—') + '</span></td>' +
        '<td>' + esc((r.ch || []).join(', ')) + '</td>' +
        '<td class="num">' + fmtUsd(r.t) + '</td>' +
        '<td class="num ' + cls + '">' + fmtPct(r.g) + '</td>' +
        '<td class="num val">' + fmtUsd(r.v) + '</td></tr>';
    }).join('');
    document.getElementById('count').textContent =
      list.length + ' of ' + DATA.rows.length + ' protocols shown';
  }

  function showDetail(slug) {
    var r = null;
    DATA.rows.forEach(function (x) { if (x.s === slug) r = x; });
    if (!r) return;
    selected = slug;
    var steps = farmSteps(r);
    detailEl.innerHTML =
      '<h2>' + esc(r.n) + (r.w ? '<span class="badge">Watchlist</span>' : '') + '</h2>' +
      '<div class="slug">' + esc(r.s) + ' · rank #' + r.r + '</div>' +
      '<div class="kv">' +
      '<div><span>Implied value</span><b>' + fmtUsd(r.v) + '</b></div>' +
      '<div><span>TVL</span><b>' + fmtUsd(r.t) + '</b></div>' +
      '<div><span>Category</span><b>' + esc(r.c || '—') + '</b></div>' +
      '<div><span>Chains</span><b>' + esc((r.ch || []).join(', ')) + '</b></div>' +
      '<div><span>7d change</span><b>' + fmtPct(r.g) + '</b></div>' +
      '<div><span>Tracked since</span><b>' + (r.l || 'n/a') + ' (' + ageText(r.l, DATA.asOf) + ')</b></div>' +
      '<div><span>Category multiple</span><b>' + r.m.toFixed(2) + '×</b></div>' +
      '<div><span>Size adjustment</span><b>' + (r.a >= 0 ? '+' : '') + r.a.toFixed(2) + ' log pts</b></div>' +
      '</div>' +
      '<div class="formula">value = TVL × multiple × size factor<br><code>' + fmtUsd(r.t) +
      ' × ' + r.m.toFixed(2) + ' × e^(' + r.a.toFixed(2) + ') ≈ ' + fmtUsd(r.v) + '</code></div>' +
      '<h3>Farm plan</h3><ol>' +
      steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    render();
  }

  rowsEl.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  [qEl, catSel, watchEl, sortEl].forEach(function (el) {
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  render();
  if (DATA.rows.length) showDetail(DATA.rows[0].s);
}
