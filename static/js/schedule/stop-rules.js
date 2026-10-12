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
    const conds = s.insertRule.rows.flatMap(r => r.conditions || []);
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
    const hit = RC.firstRule(t.rows, ctxOf(t.cols, b.prev, b.next, valueOf), t.defs, true);
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
               reason: (hit.row.conditions || []).length ? reasonOf(hit.row.conditions, b.prev, b.next, valueOf) : 'どれにも当てはまらないとき（既定の行）',
               skipped: (b.next.stopSkips || []).some(x => +x.stopId === +t.stop.id && String(x.prevId) === String(b.prev.id)) });
   });
  });
  return out;
 }
 WL.stopRules = { evaluate, boundaries, pairsOf, newPairs, ctxOf, fieldDefs, reasonOf, splitField, sameValue, CHANGED, SAME };
})();
