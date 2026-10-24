/* ============================================================
   rule-cells.js: 判定表（条件表）のセルの書き方と判定（§9.588 で刃組の blade-core.js から切り出した）

   判定表は「列＝データ・行＝決まり・右端＝答え、**上から見て最初に当たった行**」の表（§9.524・§9.529）。
   刃組（保持方式・刃のカテゴリ・刃厚）と設備停止の挿入条件（§9.588）が同じ書き方の表を持つので、
   **セルの書き方・判定・当たらない条件の見分け・答えの地図はここ1箇所**（`WL.ruleCells`）。
   画面を一切知らない（純粋な関数だけ）。表の盤は`bladeset/rule-table.js`、保存の前に整えるのは
   サーバーの`backend/rule_cells.py`。刃組の`WL.bladeSet`は同じ関数を今までの名前で見せ続ける。

   列の型（`kinds[field]`）: 'num'（数）・'text'（字）・'choice'（候補から選ぶ＝字）・'auto'（型が決まらない列＝
   仕掛の列や前後のロットの列。比べ方と値で読み方を決める）。
   ============================================================ */
(function(){
 'use strict';
 const WL = (window.WL = window.WL || {});
 const PICK_NUM = {
  eq: (l, a) => Math.abs(l - a) < 1e-9,
  ne: (l, a) => Math.abs(l - a) >= 1e-9,
  ge: (l, a) => l >= a - 1e-9,
  gt: (l, a) => l > a + 1e-9,
  le: (l, a) => l <= a + 1e-9,
  lt: (l, a) => l < a - 1e-9
 };
 /* 仕掛の列（`source.*`）は型が決まっていない。**比べ方で読み方を決める**:
    大小・範囲は数として、＝／≠は両方が数に読めれば数として（'1.0' と '1' を同じに）、
    含むは字として。 */
 const asNum = v => (String(v ?? '').trim() === '' ? NaN : Number(v));
 /* 比べ方（§9.533、利用者の指示「＊＊＊で始まる、＊＊＊で終わるのような前方一致、や後方一致など様々な種類に
    対応できるように」）。綴りは表示ルールマスタ（`RULE_OPS`）と同じ字。**字の比べ方**はここの表の1箇所。 */
 const TEXT_OPS = {
  eq: (l, r) => l === r, ne: (l, r) => l !== r,
  contains: (l, r) => !!r && l.indexOf(r) >= 0, notContains: (l, r) => !r || l.indexOf(r) < 0,
  startsWith: (l, r) => !!r && l.startsWith(r), notStartsWith: (l, r) => !r || !l.startsWith(r),
  endsWith: (l, r) => !!r && l.endsWith(r), notEndsWith: (l, r) => !r || !l.endsWith(r),
  regex: (l, r) => { const rx = r ? WL.formula.safeRegExp(r) : null; return !!rx && rx.test(l); }   // 照合が止まらなくなる形は当たらない（§9.629）
 };
 /* 右辺を持たない比べ方（空・空でない）。 */
 const NO_RIGHT = { empty: true, notEmpty: true };
 const isBlank = v => v === null || v === undefined || String(v).trim() === '';
 function condHits(cond, ctx, kinds) {
  const f = cond && cond.field;
  if (!f) return false;
  const op = cond.op;
  /* 空・空でないは**値が無いこと自体**を見る（引けなかった値も「空」）。 */
  if (NO_RIGHT[op]) return (op === 'empty') === isBlank(ctx[f]);
  if (!(f in ctx)) return false;
  const left = ctx[f];
  /* **引けなかった値を当てない**（§9.231）。0として比べると、空欄の条件が
     全部の作業に当たってしまう。 */
  if (isBlank(left)) return false;
  /* 型の分からない列（`auto`＝仕掛の列・前後のロットの列。名乗りの無い`source.`の列も）は比べ方と値で読み方を決める。 */
  const auto = kinds[f] === 'auto' || (!kinds[f] && String(f).startsWith('source.'));
  const kind = auto
   ? (TEXT_OPS[op] && !/^(eq|ne)$/.test(op) ? 'text'
      : (/^(ge|gt|le|lt|between)$/.test(op) || (isFinite(asNum(left)) && isFinite(asNum(cond.value)))) ? 'num' : 'text')
   : (kinds[f] || 'text');
  /* `choice`（候補から選ぶ・板押さえ方式）は字として比べる。 */
  if (kind === 'num' && !(TEXT_OPS[op] && !/^(eq|ne)$/.test(op))) {
   const l = +left, a = +cond.value;
   if (!isFinite(l) || !isFinite(a)) return false;
   if (op === 'between') {
    const b = +cond.value2;
    if (!isFinite(b)) return false;
    return Math.min(a, b) - 1e-9 <= l && l <= Math.max(a, b) + 1e-9;
   }
   return PICK_NUM[op] ? PICK_NUM[op](l, a) : false;
  }
  const ls = String(left).trim(), rs = String(cond.value == null ? '' : cond.value).trim();
  return TEXT_OPS[op] ? TEXT_OPS[op](ls, rs) : false;
 }
 /* **1つのセルの中の組み合わせ**（§9.533、利用者の指示「<0.6かつ>0.9などの組み合わせのパターンも1つのセル内に
    かけるように」）。条件は並びのまま持ち、`or`が真の条件から「または」の次の組が始まる。読み方は
    ふつうの式と同じ——**かつ が先**（`A かつ B または C` ＝ `(A かつ B) または C`）。行は列ごとの組の「かつ」。 */
 function condGroups(conds) {
  const out = [];
  (conds || []).forEach(c => {
   let g = out.find(x => x.field === c.field);
   if (!g) out.push(g = { field: c.field, terms: [] });
   g.terms.push(c);
  });
  return out;
 }
 /* セルの条件 → 「かつ」の組の並び（`or`の条件から次の組）。 */
 function chainsOf(terms) {
  const out = [];
  (terms || []).forEach((c, i) => { if (!i || c.or) out.push([]); out[out.length - 1].push(c); });
  return out;
 }
 const cellHits = (terms, ctx, kinds) => chainsOf(terms).some(ch => ch.every(c => condHits(c, ctx, kinds)));
 const rowHits = (conds, ctx, kinds) => condGroups(conds).every(g => cellHits(g.terms, ctx, kinds));

 /* ---- 当たり得ない組み合わせ（§9.534、利用者の指示「ありえない条件は代替案と登録した場合、どうなるかも含めて
    視覚化表現があると良いです」）。セルの「かつ」の組ごとに**同時に成り立つ値があるか**を答える。
    数は区間の重なり（`numSet`／`meet`）、字は値どうしの食い違い（`textClash`）で見る。判定は`condHits()`と同じ意味
    ——空の欄は「空」「空でない」にしか当たらない・正規表現は字の値が決まっているときだけ見る（読めなければ当たり得る側）。 */
 const NUM_ONLY = /^(ge|gt|le|lt|between)$/;
 /* 数の条件 → 区間の並び（`{lo, li, hi, hi2}`＝下端・下端を含むか・上端・上端を含むか）。数でなければ null。 */
 function numSet(c) {
  const a = +c.value, I = (lo, li, hi, hi2) => ({ lo, li, hi, hi2 });
  if (!isFinite(a)) return null;
  switch (c.op) {
   case 'eq': return [I(a, true, a, true)];
   case 'ne': return [I(-Infinity, false, a, false), I(a, false, Infinity, false)];
   case 'ge': return [I(a, true, Infinity, false)];
   case 'gt': return [I(a, false, Infinity, false)];
   case 'le': return [I(-Infinity, false, a, true)];
   case 'lt': return [I(-Infinity, false, a, false)];
   case 'between': { const b = +c.value2; return isFinite(b) ? [I(Math.min(a, b), true, Math.max(a, b), true)] : null; }
   default: return null;
  }
 }
 /* 2つの区間の並びの重なり（空なら []）。 */
 const meet = (A, B) => A.flatMap(x => B.map(y => {
  const lo = Math.max(x.lo, y.lo), hi = Math.min(x.hi, y.hi);
  return { lo, hi, li: (x.lo === lo ? x.li : true) && (y.lo === lo ? y.li : true),
           hi2: (x.hi === hi ? x.hi2 : true) && (y.hi === hi ? y.hi2 : true) };
 })).filter(r => r.lo < r.hi || (r.lo === r.hi && r.li && r.hi2));
 /* 区間の並びが数ぜんぶを覆うか（「または」にしたら問わないのと同じ、を見分ける）。 */
 function coversAll(set) {
  const xs = set.slice().sort((a, b) => a.lo - b.lo || (b.li ? 1 : 0) - (a.li ? 1 : 0));
  let at = -Infinity, inc = false;
  for (const r of xs) {
   if (r.lo > at || (r.lo === at && !inc && !r.li && at !== -Infinity)) return false;
   if (r.hi > at || (r.hi === at && r.hi2)) { at = r.hi; inc = r.hi2; }
  }
  return at === Infinity;
 }
 /* 組を数として読むか。数の列は数・字の列は字、仕掛の列（`auto`）は値がみな数で比べ方も数のときだけ数。 */
 const chainIsNum = (ch, kind) => kind === 'num' ? true : kind !== 'auto' ? false
  : ch.every(c => (NUM_ONLY.test(c.op) || /^(eq|ne)$/.test(c.op)) && numSet(c));
 /* 字の組で同時に成り立たない2つ（`[a, b]`）。無ければ null。 */
 function textClash(ch) {
  const v = c => String(c.value == null ? '' : c.value).trim();
  const hits = (c, s) => condHits(Object.assign({}, c, { field: 'x' }), { x: s }, { x: 'text' });
  const empty = ch.find(c => c.op === 'empty');
  if (empty) { const o = ch.find(c => c.op !== 'empty'); return o ? [empty, o] : null; }
  const eqs = ch.filter(c => c.op === 'eq');
  const eq2 = eqs.find(c => v(c) !== v(eqs[0]));
  if (eq2) return [eqs[0], eq2];
  if (eqs.length) { const o = ch.find(c => c.op !== 'eq' && !hits(c, v(eqs[0]))); return o ? [eqs[0], o] : null; }
  /* 値が決まっていない組: 始まり・終わりの食い違いと、「含む／始まる／終わる」がその否定を抱えている形。 */
  /** @type {Array<[string, string, (x: string, y: string) => boolean]>} */
  const rules = [['startsWith', 'startsWith', (x, y) => !x.startsWith(y) && !y.startsWith(x)],
                 ['endsWith', 'endsWith', (x, y) => !x.endsWith(y) && !y.endsWith(x)],
                 ['contains', 'notContains', (x, y) => x.includes(y)], ['startsWith', 'notContains', (x, y) => x.includes(y)],
                 ['endsWith', 'notContains', (x, y) => x.includes(y)], ['startsWith', 'notStartsWith', (x, y) => x.startsWith(y)],
                 ['endsWith', 'notEndsWith', (x, y) => x.endsWith(y)]];
  for (const [p, q, bad] of rules)
   for (const a of ch) for (const b of ch)
    if (a !== b && a.op === p && b.op === q && bad(v(a), v(b))) return [a, b];
  return null;
 }
 /* 数の組の答え: 重なり（区間の並び）と、空なら空にした2つ。 */
 function numChain(ch) {
  let acc = [{ lo: -Infinity, li: false, hi: Infinity, hi2: false }];
  for (const c of ch) acc = meet(acc, numSet(c));
  if (acc.length) return { set: acc, pair: null };
  for (const a of ch) for (const b of ch) if (a !== b && !meet(numSet(a), numSet(b)).length) return { set: [], pair: [a, b] };
  return { set: [], pair: null };
 }
 const asOr = ch => ch.map((c, i) => Object.assign({}, c, i ? { or: true } : { or: undefined }));
 /* 当たらない組の直し方（多くて2つ）。①「かつ」を「または」に（それで何でも当たるなら「問わない」と言い換える）
    ②数の上限と下限が逆さなら、そのあいだ（`＜0.6 かつ ＞0.9` → `0.6〜0.9`）。 */
 function chainAlts(ch, isNum) {
  const out = [];
  const either = asOr(ch);
  const all = isNum ? coversAll(either.flatMap(numSet))
   : ch.some(a => ch.some(b => b.op === (NEG[a.op] || '') && String(a.value) === String(b.value)));
  out.push(all ? { terms: [], how: 'このセルを空欄（問わない）にする', all: true }
               : { terms: either, how: '「かつ」を「または」に（どちらかに当たれば）' });
  if (isNum && ch.length === 2) {
   const lo = ch.find(c => /^(gt|ge)$/.test(c.op)), up = ch.find(c => /^(lt|le)$/.test(c.op));
   if (lo && up && +up.value < +lo.value)
    out.push({ terms: [{ field: ch[0].field, op: 'between', value: String(up.value), value2: String(lo.value) }],
               how: `あいだ（${up.value}〜${lo.value}）に当たれば` });
  }
  return out;
 }
 /* セル1つの診断: `{dead, part, chains:[{terms, dead, why, num, set}], alts:[{terms, text, say, how}]}`。
    `dead`＝どの組も当たらない（セル＝行が何にも当たらない）／`part`＝一部の組だけ当たらない（その組は無いのと同じ）。
    案は**最初の当たらない組**を置き換えたセルの条件（ほかの組はそのまま）。 */
 function cellDead(terms, kind) {
  const chains = chainsOf(terms).map(ch => {
   const isNum = chainIsNum(ch, kind);
   if (isNum) { const r = numChain(ch);
    const why = r.set.length ? '' : r.pair ? `${termSay(r.pair[0])} と ${termSay(r.pair[1])} が重なりません` : '全部に同時に当たる数がありません';
    return { terms: ch, num: true, set: r.set, dead: !r.set.length, why }; }
   const cl = textClash(ch);
   return { terms: ch, num: false, set: null, dead: !!cl,
            why: cl ? `「${termSay(cl[0])}」と「${termSay(cl[1])}」を同時に満たす値はありません` : '' };
  });
  const bad = chains.findIndex(c => c.dead);
  const alts = bad < 0 ? [] : chainAlts(chains[bad].terms, chains[bad].num).map(a => {
   /* 組の頭は「または」で前の組へつなぐ（いちばん頭だけ印なし）。「問わない」の案はセルごと空にする（何かと「または」でも全部当たる）。 */
   const flat = a.all ? [] : chains.flatMap((c, i) => (i === bad ? a.terms : c.terms).map((x, j) => Object.assign({}, x, { or: j ? x.or : i > 0 })))
    .map((x, i) => Object.assign({}, x, { or: i && x.or ? true : undefined }));
   return { terms: flat, text: cellText(flat), say: flat.length ? cellSay(flat) : '問わない（どの値でも当たる）', how: a.how };
  });
  return { dead: chains.length > 0 && chains.every(c => c.dead), part: bad >= 0 && !chains.every(c => c.dead), chains, alts };
 }
 /* 数のセルの当たる範囲（図に描く・組の重なりの和）。数で読めない組があれば null。 */
 function cellNumSet(terms, kind) {
  const chs = chainsOf(terms);
  if (!chs.length || !chs.every(ch => chainIsNum(ch, kind))) return null;
  return chs.flatMap(ch => numChain(ch).set);
 }

 /* ---- 区切りの格子（§9.535、利用者の選択「A-12 地図＋列の効き目」） ----
    判定表が区別できる値は、**条件に書いた境目で区切った区間だけ**（板厚 0.40 と 0.41 はどの行にも同じ）。列ごとに
    区間（数）か字の組（字）へ割り、代表の値の組み合わせを全部試す（判定は`firstRule()`そのもの）。列が増えても
    場合の数は掛け算で有限——**上の行に覆われて一度も当たらない行**も漏れなく言える。多すぎるときは数えない（`GRID_MAX`）。 */
 const GRID_MAX = 20000;
 const fmtV = v => String(+(+v).toFixed(6));
 /* 数の列: 境目 t1<…<tn で「＜t1／t1〜t2／…／≧tn」。代表は**境目そのもの＋区間の中**（≦と＜の違いも拾う）。 */
 function numSplits(conds) {
  const ts = [...new Set(conds.flatMap(c => [c.value, c.value2])
   .filter(v => v !== '' && v != null && isFinite(+v)).map(Number))].sort((a, b) => a - b);
  if (!ts.length) return null;
  const pad = Math.max((ts[ts.length - 1] - ts[0]) / 2, Math.abs(ts[0]) / 2, 1);
  /* 代表は見せても不自然でない値（試す行へ入れる・0 より大きい境目なら半分）。 */
  return [{ label: `＜${fmtV(ts[0])}`, reps: [ts[0] > 0 ? ts[0] / 2 : ts[0] - pad], at: -Infinity }].concat(ts.map((t, i) => {
   const nx = ts[i + 1];
   return nx == null ? { label: `≧${fmtV(t)}`, reps: [t, t + pad], at: t }
                     : { label: `${fmtV(t)}〜＜${fmtV(nx)}`, reps: [t, (t + nx) / 2], at: t };
  }));
 }
 /* 字の列: 条件に出てくる値・始まり・終わり・含む字から候補の字を作り、**全部の条件への当たり外れが同じ字**を1つの組にする。
    候補から選ぶ列（`options`）はその顔ぶれそのもの。組の名前は実在の値→「SUS…」の形→そのほか→（空）。 */
 const GAP = '＿';
 function textSplits(conds, options) {
  if (options && options.length) return options.map(v => ({ label: String(v), reps: [String(v)] }));
  const v = c => String(c.value == null ? '' : c.value).trim(), cand = new Set(['（そのほか）']), real = new Set();
  const pre = [], suf = [], mid = [];
  conds.forEach(c => {
   const x = v(c);
   if (/^(eq|ne)$/.test(c.op)) { cand.add(x); real.add(x); }
   else if (/^(not)?StartsWith$/i.test(c.op)) { pre.push(x); cand.add(x + GAP); }
   else if (/^(not)?EndsWith$/i.test(c.op)) { suf.push(x); cand.add(GAP + x); }
   else if (/^(not)?Contains$/i.test(c.op)) { mid.push(x); cand.add(GAP + x + GAP); }
   else if (NO_RIGHT[c.op]) cand.add('');
   else if (x) cand.add(x);
  });
  pre.forEach(a => suf.forEach(b => cand.add(a + GAP + b)));
  pre.forEach(a => mid.forEach(b => cand.add(a + b + GAP)));
  mid.forEach(a => suf.forEach(b => cand.add(GAP + a + b)));
  const sig = x => conds.map(c => (condHits(Object.assign({}, c, { field: 'x' }), { x }, { x: 'text' }) ? 1 : 0)).join('');
  const groups = new Map();
  cand.forEach(x => { const k = sig(x); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); });
  const rank = x => (real.has(x) ? 0 : x === '（そのほか）' ? 2 : x === '' ? 3 : 1);
  return [...groups.values()].map(xs => { const x = xs.slice().sort((a, b) => rank(a) - rank(b))[0];
   return { label: x === '' ? '（空）' : x === '（そのほか）' ? 'そのほか' : x.split(GAP).join('…'), reps: [x], rank: rank(x) }; })
   .sort((a, b) => a.rank - b.rank);
 }
 /* 列を数として割るか。数の列は数、字・候補の列は字、仕掛の列（`auto`）は条件がみな数で比べているときだけ数。 */
 const colIsNum = (cs, kind) => kind === 'num' || (kind !== 'text' && kind !== 'choice'
  && cs.every(c => NUM_ONLY.test(c.op) || (/^(eq|ne)$/.test(c.op) && numSet(c))));
 function gridCols(rows, fields, kinds) {
  const used = [...new Set(rows.flatMap(r => (r.conditions || []).map(c => c.field)))];
  return used.map(f => {
   const cs = rows.flatMap(r => (r.conditions || []).filter(c => c.field === f));
   const fd = (fields || []).find(x => x.field === f) || {}, kind = kinds[f] || fd.kind, num = colIsNum(cs, kind);
   const iv = num ? numSplits(cs) : textSplits(cs, kind === 'choice' ? fd.options : null);
   return { field: f, num: !!(num && iv), iv: iv || [{ label: '—', reps: [''] }] };
  });
 }
 /* 表の全部の場合（`{ctx, ix, rx, win}`＝代表の値・区間の番号・代表の番号・当たった行）と、覆われて当たらない行。
    `rows`は表の並びのまま（`enabled:false`の行は飛ばす・番号は数える）。 */
 function ruleGrid(rows, fields, kinds) {
  const list = (rows || []).filter(r => r.enabled !== false), cols = gridCols(list, fields, kinds || {});
  const size = cols.reduce((n, c) => n * c.iv.reduce((m, x) => m + x.reps.length, 0), 1);
  if (size > GRID_MAX) return { cols, cases: [], size, max: GRID_MAX, tooMany: true, shadow: [] };
  const kk = Object.assign({}, kinds); cols.forEach(c => { kk[c.field] = c.num ? 'num' : 'text'; });
  let acc = [{ ctx: {}, ix: [], rx: [] }];
  cols.forEach(c => {
   const nx = [];
   acc.forEach(a => c.iv.forEach((x, j) => x.reps.forEach((rep, r) =>
    nx.push({ ctx: Object.assign({}, a.ctx, { [c.field]: rep }), ix: a.ix.concat(j), rx: a.rx.concat(`${j}.${r}`) }))));
   acc = nx;
  });
  const fk = cols.map(c => ({ field: c.field, kind: kk[c.field] }));
  acc.forEach(q => { q.win = (firstRule(rows, q.ctx, fk, true) || { index: -1 }).index; });
  const shadow = [];
  (rows || []).forEach((r, i) => {
   const cs = r.conditions || [];
   if (!cs.length || r.enabled === false) return;
   const mine = acc.filter(q => rowHits(cs, q.ctx, kk));
   if (!mine.length || mine.some(q => q.win === i)) return;   // 当たり得ない条件は §9.534 が言う
   const by = {}; mine.forEach(q => { by[q.win] = (by[q.win] || 0) + 1; });
   shadow.push({ index: i, by: +Object.keys(by).sort((a, b) => by[b] - by[a])[0] });
  });
  return { cols, cases: acc, size, shadow };
 }
 /* 列の効き目: **その列の値だけを変えると答えが変わる**場合の割合（ほかの列の代表をそろえた組のうち）。
    `key`＝答え（既定は当たった行）。`cases`を絞れば、地図のマスの中で「どの列で割れるか」にもなる。 */
 function ruleEffect(G, key, cases) {
  const k = key || (q => q.win), qs = cases || G.cases;
  return G.cols.map((c, ci) => {
   const grp = new Map();
   qs.forEach(q => { const id = q.rx.filter((_, j) => j !== ci).join('|');
    if (!grp.has(id)) grp.set(id, new Set()); grp.get(id).add(k(q)); });
   let n = 0; grp.forEach(s => { if (s.size > 1) n++; });
   return { field: c.field, n, tot: grp.size, share: grp.size ? n / grp.size : 0 };
  });
 }

 /* ---- セルの字 ⇔ 条件（**書き方は1箇所で読む**・判定表の盤と刃組の説明が使う） ----
    数の記号は `>=`・`≧` どちらでも打てる。字の比べ方は `SUS*`（で始まる）・`*304`（で終わる）・`*H5*`（含む）、
    頭に `≠` で「〜ではない」（`≠ *H5*`＝含まない）。`空`／`空でない`、`/正規表現/`。言葉でも書ける（`SUS で始まる`）。
    組み合わせは `かつ`（`&`）と `または`（`|`）。**読めない字は条件にしない**（理由を字で返す）。 */
 /** @type {Array<[RegExp, string]>} */
 const OP_SIGNS = [[/^(>=|≧|=>)/, 'ge'], [/^(<=|≦|=<)/, 'le'], [/^(!=|≠|<>|!)/, 'ne'],
                   [/^(>|＞)/, 'gt'], [/^(<|＜)/, 'lt'], [/^(=|＝)/, 'eq']];
 const OP_SIGN_TEXT = { ge: '≧ ', le: '≦ ', ne: '≠ ', gt: '＞ ', lt: '＜ ', eq: '' };
 const NEG = { eq: 'ne', contains: 'notContains', startsWith: 'notStartsWith', endsWith: 'notEndsWith', empty: 'notEmpty' };
 const OP_WORDS = [['を含まない', 'notContains'], ['で始まらない', 'notStartsWith'], ['で終わらない', 'notEndsWith'],
                   ['を含む', 'contains'], ['で始まる', 'startsWith'], ['で終わる', 'endsWith'], ['以外', 'ne']];
 const JOIN_RE = /\s*(かつ|＆|&&?|\band\b|または|｜|\|\|?|\bor\b)\s*/i;
 /* 正規表現（`/…/`）の中の `|` で割らないよう、先に札へ置き換えてから割る。 */
 function splitCell(t) {
  const keep = [];
  const masked = t.replace(/\/(?:\\.|[^/\\])+\//g, m => `\uE000${keep.push(m) - 1}\uE000`);
  const parts = masked.split(JOIN_RE);
  const back = x => x.replace(/\uE000(\d+)\uE000/g, (_m, n) => keep[+n]);
  const out = [];
  for (let k = 0; k < parts.length; k += 2) {
   const join = k ? parts[k - 1] : '';
   out.push({ text: back(parts[k]).trim(), or: /^(または|｜|\|\|?|or)$/i.test(join) });
  }
  return out;
 }
 function parseTerm(t, kind) {
  const numOnly = kind === 'num';
  if (!t) return { error: '「かつ」「または」の前後に条件を書いてください' };
  if (/^(空|空欄)$/.test(t)) return { cond: { op: 'empty', value: '' } };
  if (/^(空でない|空欄でない)$/.test(t)) return { cond: { op: 'notEmpty', value: '' } };
  const re = t.match(/^\/(.+)\/$/);
  if (re) {
   if (numOnly) return { error: 'この列は数なので正規表現は使えません' };
   if (WL.formula.regexRisk(re[1])) return { error: WL.formula.regexRisk(re[1]) };
   try { new RegExp(re[1]); } catch (_e) { return { error: '正規表現として読めません' }; }
   return { cond: { op: 'regex', value: re[1] } };
  }
  const range = t.match(/^(-?[\d.]+)\s*[〜~～]\s*(-?[\d.]+)$/);
  if (range) {
   const a = Number(range[1]), b = Number(range[2]);
   if (!isFinite(a) || !isFinite(b)) return { error: '範囲は「0.6〜1.0」のように数で書いてください' };
   return { cond: { op: 'between', value: String(a), value2: String(b) } };
  }
  /* 頭の ≠ は「〜ではない」。その後ろを読んでから裏返す。 */
  const neg = t.match(/^(!=|≠|<>)\s*(.+)$/);
  if (neg) {
   const inner = parseTerm(neg[2].trim(), kind);
   if (inner.error) return inner;
   const op = NEG[inner.cond.op];
   if (!op) return { error: '≠ の後ろは値・*含む*・始まる*・*終わる・空 のどれかにしてください' };
   return { cond: Object.assign({}, inner.cond, { op }) };
  }
  for (const [w, op] of OP_WORDS) {
   if (t.endsWith(w) && t.length > w.length) {
    if (numOnly && op !== 'ne') return { error: 'この列は数なので字の比べ方は使えません' };
    return { cond: { op, value: t.slice(0, -w.length).replace(/[「」"]/g, '').trim() } };
   }
  }
  const wild = t.match(/^(\*?)([^*]+)(\*?)$/);
  if (wild && (wild[1] || wild[3])) {
   if (numOnly) return { error: 'この列は数なので * は使えません（大小か範囲で書いてください）' };
   const op = wild[1] && wild[3] ? 'contains' : wild[1] ? 'endsWith' : 'startsWith';
   return { cond: { op, value: wild[2].trim() } };
  }
  let op = 'eq', v = t;
  for (const [rx, o] of OP_SIGNS) { const m = t.match(rx); if (m) { op = o; v = t.slice(m[0].length).trim(); break; } }
  if (!v) return { error: '比べる値を書いてください' };
  if ((numOnly || /^(ge|le|gt|lt)$/.test(op)) && !isFinite(Number(v))) return { error: 'この比べ方は数で書いてください' };
  return { cond: { op, value: v } };
 }
 /* セルの字 → 条件の並び（`or`つき）。空欄は `[]`（問わない）。 */
 function parseCell(text, kind) {
  const t = String(text || '').trim();
  if (!t) return { conds: [] };
  const conds = [];
  for (const part of splitCell(t)) {
   const p = parseTerm(part.text, kind);
   if (p.error) return { error: p.error };
   conds.push(Object.assign(p.cond, part.or ? { or: true } : {}));
  }
  return { conds };
 }
 function termText(c, eqSign) {
  switch (c.op) {
   case 'between': return `${c.value}〜${c.value2}`;
   case 'contains': return `*${c.value}*`;
   case 'startsWith': return `${c.value}*`;
   case 'endsWith': return `*${c.value}`;
   case 'notContains': return `≠ *${c.value}*`;
   case 'notStartsWith': return `≠ ${c.value}*`;
   case 'notEndsWith': return `≠ *${c.value}`;
   case 'empty': return '空';
   case 'notEmpty': return '空でない';
   case 'regex': return `/${c.value}/`;
   case 'eq': return (eqSign ? '＝ ' : '') + c.value;
   default: return (OP_SIGN_TEXT[c.op] ?? '') + c.value;
  }
 }
 /* 条件の並び → セルの字（表に出す字・刃組の説明の字）。 */
 const cellText = (terms, eqSign) => (terms || []).map((c, i) => (i ? (c.or ? ' または ' : ' かつ ') : '') + termText(c, eqSign)).join('');
 /* 読み上げ（「0.6 より小さい または 0.9 より大きい」）。候補の説明と表の下の1文が同じ字を使う。 */
 const OP_SAY = { eq: v => `${v}`, ne: v => `${v} 以外`, ge: v => `${v} 以上`, gt: v => `${v} より大きい`,
                  le: v => `${v} 以下`, lt: v => `${v} より小さい`, contains: v => `「${v}」を含む`,
                  notContains: v => `「${v}」を含まない`, startsWith: v => `「${v}」で始まる`, notStartsWith: v => `「${v}」で始まらない`,
                  endsWith: v => `「${v}」で終わる`, notEndsWith: v => `「${v}」で終わらない`,
                  empty: () => '空', notEmpty: () => '空でない', regex: v => `正規表現 /${v}/ に合う` };
 const termSay = c => (c.op === 'between' ? `${c.value}〜${c.value2}（両端を含む）` : (OP_SAY[c.op] || (v => v))(c.value));
 const cellSay = terms => (terms || []).map((c, i) => (i ? (c.or ? ' または ' : ' かつ ') : '') + termSay(c)).join('');
 /* 条件表を上から見て**最初に当たった行**（`{row, index}`）。表の約束は1つ——
    同じ行の条件はすべて満たしたときだけ当たる。**条件の無い行**は`withDefault`の
    ときだけ「どれにも当たらなかったときの行」として当たる（刃選択は当てない・
    保持方式は最後の既定行で決める）。刃選択・保持方式・盤の試し欄が同じ1本を通る。 */
 function firstRule(rules, ctx, fields, withDefault) {
  const kinds = {};
  (fields || []).forEach(f => { kinds[f.field] = f.kind; });
  const list = rules || [];
  for (let i = 0; i < list.length; i++) {
   if (list[i].enabled === false) continue;   // 番号は表の並びのまま数える（止めた行も1行）
   const cs = list[i].conditions || [];
   if (!cs.length ? withDefault : rowHits(cs, ctx, kinds)) return { row: list[i], index: i };
  }
  return null;
 }
 /* 行の条件を字にする（「板厚 ＜ 0.6 または ＞ 0.9 かつ 製造材質 SUS*」）。セルの字（`cellText()`）に列の名前を添える。
    刃組の説明と条件表の盤が同じ字を使う。 */
 function rowText(conds, fields) {
  const name = f => { const x = (fields || []).find(y => y.field === f); return x ? x.label : String(f || '').replace(/^source\./, ''); };
  return condGroups(conds).map(g => `${name(g.field)} ${cellText(g.terms, true)}`).join('・');
 }

 WL.ruleCells = {
  condHits, rowHits, cellHits, condGroups, chainsOf, cellDead, cellNumSet, numSet, ruleGrid, ruleEffect,
  parseCell, cellText, cellSay, termSay, firstRule, rowText, TEXT_OPS, GRID_MAX
 };
})();
