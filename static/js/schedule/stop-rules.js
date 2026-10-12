/* ============================================================
   stop-rules.js: 足りない設備停止の判定（§9.588）——画面を知らない純粋な関数だけ

   利用者の指示:
   「スケジュールを評価して不足している設備停止があれば、自動挿入か黄色などの目立つ色で警告して表示する」
   「判定はスケジュールからロットが追加・削除、並び替えされるごとに、ロットがもと居た場所の前後と
    新しく挿入された前後ロットの情報から判定します」

   決めごと:
    ・判定するのは**作業ロットと次の作業ロットの境目**（`boundaries()`）。あいだの設備停止・申し送り・枠は
      「境目の中身」で、同じ名前の設備停止が何本あるかを数える。子ロット・計画外・取消は境目を作らない。
    ・表は停止内容ごと（設備停止マスタ・`insertRule`）。列は前のロット（prev.）・後ろのロット（next.）・
      変わったか（chg.＝変わる／同じ）・差（diff.＝後ろ−前）。判定は判定表の部品の`WL.ruleCells.firstRule()`の
      1本（設備停止マスタの盤の「試す」と同じ答え）。
    ・**状態を持たずに毎回数える**（`evaluate()`）——見張るのは後ろのロットがまだ「予定」の境目だけ。
      「今回は入れない」（後ろのロットの`stopSkips`）は境目（前のロット）ごとに効く。
    ・「ロットがもと居た場所の前後と新しく挿入された前後」は、操作の前後で**境目の組が新しくできたもの**
      （`newPairs()`）と同じ——外せば元の前後がつながり、入れれば新しい前後が2つできる。自動で入れるのはここだけ。
   画面（黄色の帯・入れる／直して入れる／今回は入れない・自動で入れる）は`schedule-view.js`。

   **§9.590 で行の条件を式でも持てるようにした**（利用者の指示「『この列の作り方』のような条件入力」）。
    ・式は一覧の式（`WL.formula`）と同じ書き方。名前は `[前.列]`（前のロット）・`[後.列]`（後ろのロット）。
    ・組み立てる画面の「見方」（変わる・同じ・差・前のロット・後ろのロット）と、その式の字は`HOWS`の1箇所。
    ・前の版のセルの条件は`fromCells()`が同じ意味の式（と、組み立てられる形なら組み立て）へ直す。
    ・どの行に当たるかは`ruleHit()`の1箇所（予定の判定と、設備停止マスタの「試した結果」が同じ答えを読む）。
   ============================================================ */
(function(){
 'use strict';
 const WL = (window.WL = window.WL || {});
 const PREFIX = { prev: 'prev.', next: 'next.', chg: 'chg.', diff: 'diff.' };
 const CHANGED = '変わる', SAME = '同じ';
 const blank = v => v === null || v === undefined || String(v).trim() === '';
 /* 数の読み方は式と同じ1つ（`WL.formula.looseNum`・§9.581）。読めなければ NaN。 */
 const num = v => {
  if (blank(v)) return NaN;
  const f = WL.formula && WL.formula.looseNum;
  const n = f ? f(v) : Number(v);
  return typeof n === 'number' ? n : NaN;
 };
 /** @param {string} f @returns {{set:string,col:string}|null} */
 function splitField(f) {
  for (const k of Object.keys(PREFIX)) if (String(f).startsWith(PREFIX[k])) return { set: k, col: String(f).slice(PREFIX[k].length) };
  return null;
 }
 /* 前と後ろの値が同じか。どちらも空なら同じ、どちらも数なら数として（'1.0' と '1'）、ほかは字として。 */
 function sameValue(a, b) {
  if (blank(a) && blank(b)) return true;
  const x = num(a), y = num(b);
  if (isFinite(x) && isFinite(y)) return Math.abs(x - y) < 1e-9;
  return String(a ?? '').trim() === String(b ?? '').trim();
 }
 /* 境目の値（表が読む列だけ）。`valueOf(行, 列名)`は予定の行の値（呼ぶ側の`entryValueOf`）。 */
 function ctxOf(fields, prev, next, valueOf) {
  /** @type {Record<string, any>} */
  const ctx = {};
  fields.forEach(f => {
   const s = splitField(f);
   if (!s) return;
   const a = valueOf(prev, s.col), b = valueOf(next, s.col);
   if (s.set === 'prev') ctx[f] = a;
   else if (s.set === 'next') ctx[f] = b;
   else if (s.set === 'chg') ctx[f] = sameValue(a, b) ? SAME : CHANGED;
   else { const x = num(a), y = num(b); ctx[f] = isFinite(x) && isFinite(y) ? +(y - x).toFixed(9) : ''; }
  });
  return ctx;
 }
 /* 列の定義（型）。群の型はサーバーの語彙（`insertRuleVocab.sets`）——盤の「試す」と同じ型で判定する。 */
 function fieldDefs(cols, vocab) {
  const sets = (vocab && vocab.sets) || [];
  return cols.map(f => {
   const s = splitField(f), d = s && sets.find(x => x.key === s.set);
   return { field: f, kind: (d && d.kind) || 'auto', options: (d && d.options) || [], label: f };
  });
 }
 /* 当たった行の決まりを1文で、**その境目の実際の値**を添えて（「製造材質が 変わる（A5052 → A1100）」）。 */
 function reasonOf(conds, prev, next, valueOf) {
  const RC = WL.ruleCells;
  const v = x => (blank(x) ? '空' : String(x));
  return RC.condGroups(conds || []).map(g => {
   const s = splitField(g.field), say = RC.cellSay(g.terms);
   if (!s) return `${g.field}が ${say}`;
   const a = valueOf(prev, s.col), b = valueOf(next, s.col);
   if (s.set === 'prev') return `前の${s.col}が ${say}（${v(a)}）`;
   if (s.set === 'next') return `後ろの${s.col}が ${say}（${v(b)}）`;
   if (s.set === 'chg') return `${s.col}が ${say}（${v(a)} → ${v(b)}）`;
   return `${s.col}の差（後ろ−前）が ${say}（${v(a)} → ${v(b)}）`;
  }).join(' かつ ');
 }
 /* ---------- 式（§9.590） ---------- */
 const PRE = '前.', POST = '後.';
 const ref = (p, col) => `[${p}${col}]`;
 const FB = () => WL.formulaBuilder;
 /* 組み立てる画面の「見方」。**式の字へ変える関数もここ**（組み立ての部品は語彙を知らない）。 */
 const HOWS = [
  { key: 'chg', label: 'が変わる', cmps: null, build: col => `${ref(PRE, col)} <> ${ref(POST, col)}` },
  { key: 'same', label: 'が同じ', cmps: null, build: col => `${ref(PRE, col)} = ${ref(POST, col)}` },
  { key: 'diff', label: 'の差（後ろ−前）が', get cmps() { return FB().NUM_CMPS; },
    build: (col, op, v, v2) => FB().compare(`(num(${ref(POST, col)}) - num(${ref(PRE, col)}))`, op, v, v2) },
  { key: 'prev', label: '（前のロット）が', get cmps() { return FB().CMPS; }, build: (col, op, v, v2) => FB().compare(ref(PRE, col), op, v, v2) },
  { key: 'next', label: '（後ろのロット）が', get cmps() { return FB().CMPS; }, build: (col, op, v, v2) => FB().compare(ref(POST, col), op, v, v2) },
 ];
 /* セルの比べ方 → 組み立ての比べ方（組み立てに無い物は式だけにする）。 */
 const CELL_CMP = { eq: '=', ne: '<>', ge: '>=', gt: '>', le: '<=', lt: '<', between: 'between', contains: 'contains',
  startsWith: 'startswith', endsWith: 'endswith', empty: 'empty', notEmpty: 'notempty' };
 const CELL_NOT = { notContains: 'contains', notStartsWith: 'startswith', notEndsWith: 'endswith' };
 /* 前の版のセルの条件 → {build, formula}。組み立てで書けない形（セルの中の「または」・否定・正規表現）は
    式だけ（`build`は null＝「式を書く」で開く）。意味は`firstRule()`と同じ。 */
 function fromCells(conds) {
  const list = (conds || []).filter(c => c && splitField(c.field));
  if (!list.length) return { build: null, formula: '' };
  let buildable = !list.some(c => c.or);
  const clauses = list.map(c => {
   const sf = splitField(c.field);
   if (sf.set === 'chg') {
    const chg = (c.op === 'eq') === (String(c.value).trim() === CHANGED);
    if (!['eq', 'ne'].includes(c.op)) buildable = false;
    return { col: sf.col, how: chg ? 'chg' : 'same', cmp: '', val: '', val2: '', join: 'and' };
   }
   if (!CELL_CMP[c.op]) buildable = false;
   return { col: sf.col, how: sf.set, cmp: CELL_CMP[c.op] || '=', val: c.value ?? '', val2: c.value2 ?? '', join: 'and' };
  });
  if (buildable) { const build = { kind: 'cond', clauses }; return { build, formula: FB().build(build, HOWS) }; }
  /* 式だけ: 同じ列の続き（`or`）は（ ）でまとめ、列どうしは かつ。 */
  const one = c => {
   const sf = splitField(c.field);
   if (sf.set === 'chg') {
    const a = `if(${ref(PRE, sf.col)} <> ${ref(POST, sf.col)}, '${CHANGED}', '${SAME}')`;
    return FB().compare(a, CELL_CMP[c.op] || '=', c.value, c.value2);
   }
   const a = sf.set === 'diff' ? `(num(${ref(POST, sf.col)}) - num(${ref(PRE, sf.col)}))` : ref(sf.set === 'prev' ? PRE : POST, sf.col);
   if (CELL_NOT[c.op]) return `not(${FB().compare(a, CELL_NOT[c.op], c.value)})`;
   if (c.op === 'regex') return `match(${a}, ${FB().quote(String(c.value ?? ''))})`;
   return FB().compare(a, CELL_CMP[c.op] || '=', c.value, c.value2);
  };
  const groups = WL.ruleCells.condGroups(list).map(g => {
   /* セルの中は かつ が先（`chainsOf()`＝`firstRule()`と同じ読み方）。 */
   const chains = WL.ruleCells.chainsOf(g.terms).map(ch => ch.map(t => one(Object.assign({}, t, { field: g.field }))).join(' and '));
   return chains.length > 1 ? `(${chains.map(x => (x.includes(' and ') ? `(${x})` : x)).join(' or ')})` : chains[0];
  });
  return { build: null, formula: groups.join(' and ') };
 }
 /* 式が使う名前 → 境目の値（前.／後.の頭の無い名前は空）。 */
 function formulaRow(cols, prev, next, valueOf) {
  /** @type {Record<string, any>} */
  const row = {};
  cols.forEach(n => {
   if (n.startsWith(PRE)) row[n] = valueOf(prev, n.slice(PRE.length));
   else if (n.startsWith(POST)) row[n] = valueOf(next, n.slice(POST.length));
  });
  return row;
 }
 const compiled = new Map();
 function compileOf(f) {
  if (!compiled.has(f)) {
   let c = null;
   try { c = WL.formula.compile(f); } catch (e) { c = null; }   // 書き方の誤りは「当たらない」（盤が理由を言う）
   if (compiled.size > 400) compiled.clear();
   compiled.set(f, c);
  }
  return compiled.get(f);
 }
 const hasCond = r => !!(r && (String(r.formula || '').trim() || (r.conditions || []).length));
 /* どの行に当たるか（上から最初・条件の無い行は既定）。`defs`はセルの条件の型（前の版の表のため）。 */
 function ruleHit(rows, cols, defs, prev, next, valueOf) {
  const RC = WL.ruleCells;
  for (let i = 0; i < (rows || []).length; i++) {
   const r = rows[i];
   if (!hasCond(r)) return { row: r, index: i };
   const f = String(r.formula || '').trim();
   if (f) {
    const c = compileOf(f);
    if (c && WL.formula.truthy(c.run(formulaRow(c.columns, prev, next, valueOf)))) return { row: r, index: i };
    continue;
   }
   if (RC && RC.firstRule([r], ctxOf(cols, prev, next, valueOf), defs, false)) return { row: r, index: i };
  }
  return null;
 }
 /* 当たった行の決まりを1文で、実際の値を添えて。 */
 function ruleReason(r, prev, next, valueOf) {
  if (!hasCond(r)) return 'どれにも当てはまらないとき（既定の行）';
  if (!String(r.formula || '').trim()) return reasonOf(r.conditions, prev, next, valueOf);
  const v = x => (blank(x) ? '空' : String(x));
  if (r.build && (r.build.clauses || []).length) {
   const cols = [...new Set(r.build.clauses.map(c => c.col).filter(Boolean))];
   return `${FB().read(r.build, HOWS)}（${cols.map(c => `${c} ${v(valueOf(prev, c))} → ${v(valueOf(next, c))}`).join('・')}）`;
  }
  return `式「${r.formula}」に当たる`;
 }
 const isLot = e => !!e && e.kind === '作業' && e.parentId == null && !e.unplanned && e.state !== '取消';
 /* 境目（作業ロットと次の作業ロット）。`between`はあいだの行（設備停止・申し送り・枠・取消を除く）。並びは予定の順。 */
 function boundaries(entries) {
  const out = [];
  let prev = null, between = [];
  (entries || []).forEach(e => {
   if (!e || e.parentId != null || e.unplanned) return;
   if (isLot(e)) { if (prev) out.push({ prev, next: e, between }); prev = e; between = []; return; }
   if (e.state !== '取消') between.push(e);
  });
  return out;
 }
 const pairKey = (a, b) => `${a.id}>${b.id}`;
 /* 境目の組の集まり（操作の前後で比べる）。仮ID（反映前）の行は組にしない——IDが書き換わると別の組に見える。 */
 function pairsOf(entries) {
  return new Set(boundaries(entries).filter(b => !b.prev.__pending && !b.next.__pending).map(b => pairKey(b.prev, b.next)));
 }
 /* 操作の後で新しくできた境目（前に無かった組）。 */
 function newPairs(before, after) {
  const out = new Set();
  after.forEach(k => { if (!before.has(k)) out.add(k); });
  return out;
 }
 const norm = t => String(t || '').trim();
 /* 表を持つ停止内容（登録済みで行がある物）だけ、列と型を先に組む。 */
 function tablesOf(stops, vocab) {
  return (stops || []).filter(s => s && s.insertRule && s.insertRule.stored && (s.insertRule.rows || []).length)
   .map(s => {
    const conds = s.insertRule.rows.flatMap(r => (String(r.formula || '').trim() ? [] : r.conditions || []));
    const cols = [...new Set((s.insertRule.cols || []).concat(conds.map(c => c.field)))];
    return { stop: s, rows: s.insertRule.rows, cols, defs: fieldDefs(cols, vocab) };
   });
 }
 /* 足りない設備停止（**状態を持たずに毎回数える**）。見るのは後ろのロットがまだ「予定」の境目だけ。
    戻り値: [{key, pair, prev, next, stop, need, have, missing, minutes, action, rowIndex, reason, skipped}] */
 function evaluate(entries, stops, valueOf, vocab) {
  const RC = WL.ruleCells, out = [];
  const tables = tablesOf(stops, vocab);
  if (!tables.length || !RC) return out;
  boundaries(entries).forEach(b => {
   if (b.next.state !== '予定') return;
   tables.forEach(t => {
    const hit = ruleHit(t.rows, t.cols, t.defs, b.prev, b.next, valueOf);
    const need = hit ? +hit.row.count || 0 : 0;
    if (!need) return;
    const have = b.between.filter(e => e.kind === '設備停止' && norm(e.title) === norm(t.stop.name)).length;
    if (have >= need) return;
    const pair = pairKey(b.prev, b.next);
    out.push({ key: `${pair}:${t.stop.id}`, pair, prev: b.prev, next: b.next, stop: t.stop, need, have,
               missing: need - have,
               /* 時間の空欄は`null`（＝その停止内容の既定の分。内訳の標準所要分まで含めて決めるのは画面の
                  `stopPickDefaultMinutes()`——手で入れるときと同じ答え）。 */
               minutes: Array.from({ length: need - have }, (_, i) => { const m = (hit.row.minutes || [])[have + i]; return m ? +m : null; }),
               action: hit.row.action === 'auto' ? 'auto' : 'warn', rowIndex: hit.index,
               reason: ruleReason(hit.row, b.prev, b.next, valueOf),
               skipped: (b.next.stopSkips || []).some(x => +x.stopId === +t.stop.id && String(x.prevId) === String(b.prev.id)) });
   });
  });
  return out;
 }
 WL.stopRules = { evaluate, boundaries, pairsOf, newPairs, ctxOf, fieldDefs, reasonOf, splitField, sameValue, CHANGED, SAME,
  HOWS, PRE, POST, fromCells, ruleHit, ruleReason, hasCond, tablesOf };
})();
