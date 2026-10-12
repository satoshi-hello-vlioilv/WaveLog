/* ============================================================
   formula-builder.js: 式を「文のように選んで組み立てる」入口（§9.590、利用者の指示
   「一覧表にある表示列の『この列の作り方』のような条件入力ができるとやりやすい」「別リポジトリの LotScope の
    表示列の UI の配置などを参考に」）

   組み立てた物は**式の字に変えるだけ**で、式の決まりは増やさない——計算・確かめは今までどおり
   `WL.formula`（`list/list-formula.js`）の1箇所。LotScope の式ビルダー（`formula-builder.js`）と同じ考え方。

   ここが持つのは**条件の文**（`cond`）: 「[列] [見方] [値] [比べ方]」の節を「かつ／または」でつなぐ。
   「見方」（前後で変わる・差・前のロットの値…）は**呼ぶ側の語彙**（`hows`）——節を式の字へ変える関数も
   呼ぶ側が渡す（設備停止の挿入条件は`schedule/stop-rules.js`の`HOWS`）。ここは画面の部品と、
   値の書き方（`term()`）・つなぎ方（`join()`）だけを知る。

     WL.formulaBuilder.mount(el, {
       hows,                 // [{key, label, cmps:[[op,字],…]|null, build(col, op, val, val2)→式}]
       columns: () => [...], // 列の名前（候補）
       spec,                 // 前に組み立てた形（無ければ空の1節）
       onChange(spec, formula, ok),   // 選ぶたび（式の字・使えるか）
     })
   build(spec, hows) は DOM を使わない（網が node で確かめる）。
   ============================================================ */
(function(){
 'use strict';
 const WL = (window.WL = window.WL || {});
 /* 比べ方の語彙（字の値に効くもの）。綴りは LotScope と同じ。`two`は「〜」で2つ取る。 */
 const CMPS = [['=', 'と同じ'], ['<>', 'と違う'], ['>=', '以上'], ['>', 'より大きい'], ['<=', '以下'], ['<', 'より小さい'],
  ['between', 'の範囲'], ['contains', 'を含む'], ['startswith', 'で始まる'], ['endswith', 'で終わる'],
  ['empty', '空欄'], ['notempty', '空欄でない']];
 const NUM_CMPS = CMPS.filter(c => ['=', '<>', '>=', '>', '<=', '<', 'between'].includes(c[0]));
 const NO_VALUE = ['empty', 'notempty'];
 const JOINS = [['and', 'かつ'], ['or', 'または']];
 /* 字 → 式の字（LotScope と同じ）。式の字は '…' か "…" で、中で引用符を重ねる書き方は無い。 */
 function quote(v) {
  if (!v.includes("'")) return `'${v}'`;
  if (!v.includes('"')) return `"${v}"`;
  return `concat(${v.split("'").map(x => `'${x}'`).join(`, "'", `)})`;
 }
 /* 打った値 → 式の字。**数に読めれば数**、ほかは文字。 */
 function term(v) {
  const t = String(v ?? '').trim();
  if (t !== '' && /^-?\d+(\.\d+)?$/.test(t)) return t;
  return quote(String(v ?? ''));
 }
 /* 名前と比べ方と値 → 式の字（`a`は比べられる側の式）。 */
 function compare(a, op, v, v2) {
  if (op === 'empty') return `trim(text(${a})) = ''`;
  if (op === 'notempty') return `trim(text(${a})) <> ''`;
  if (op === 'between') return `(${a} >= ${term(v)} and ${a} <= ${term(v2)})`;
  if (['contains', 'startswith', 'endswith'].includes(op)) return `${op}(${a}, ${term(v)})`;
  return `${a} ${['=', '<>', '>', '>=', '<', '<='].includes(op) ? op : '='} ${term(v)}`;
 }
 /* 節をつなぐ。**かつが先に結ぶ**（式の`and`／`or`と同じ）——または で区切った組に、2つ以上あれば（ ）。 */
 function join(parts) {
  const groups = [];
  parts.forEach((p, i) => {
   if (!p.text) return;
   if (!groups.length || (i && p.join === 'or')) groups.push([p.text]);
   else groups[groups.length - 1].push(p.text);
  });
  if (groups.length <= 1) return (groups[0] || []).join(' and ');
  return groups.map(g => (g.length > 1 ? `(${g.join(' and ')})` : g[0])).join(' or ');
 }
 const howOf = (hows, key) => (hows || []).find(h => h.key === key) || (hows || [])[0];
 /* 組み立て → 式の字（足りなければ ''）。 */
 function build(spec, hows) {
  const cl = (spec && spec.clauses) || [];
  return join(cl.map(c => {
   const h = howOf(hows, c.how);
   if (!h || !c.col) return { text: '', join: c.join };
   return { text: h.build(c.col, c.cmp, c.val, c.val2), join: c.join };
  }));
 }
 /* 組み立てを文で読む（札の字）。`say(節)`が無ければ選んだ字を並べる。 */
 function read(spec, hows) {
  const cl = (spec && spec.clauses) || [];
  return cl.filter(c => c.col).map((c, i) => {
   const h = howOf(hows, c.how);
   const cmp = h && h.cmps ? (h.cmps.find(x => x[0] === c.cmp) || [])[1] || '' : '';
   const val = h && h.cmps && !NO_VALUE.includes(c.cmp) ? (c.cmp === 'between' ? ` ${c.val ?? ''}〜${c.val2 ?? ''}` : ` ${c.val ?? ''}`) : '';
   return `${i ? `${(JOINS.find(j => j[0] === c.join) || JOINS[0])[1]} ` : ''}${c.col} ${h ? h.label : ''}${val} ${cmp}`.replace(/\s+/g, ' ').trim();
  }).join(' ');
 }
 function blankClause(hows, cols) {
  const h = (hows || [])[0] || {};
  return { col: (cols || [])[0] || '', how: h.key || '', cmp: h.cmps ? h.cmps[0][0] : '', val: '', val2: '', join: 'and' };
 }
 const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
 const sel = (k, list, v, label, i) => `<select class="fxb-sel" data-k="${k}" data-i="${i}" aria-label="${esc(label)}">${
  list.map(([x, n]) => `<option value="${esc(x)}"${String(v) === String(x) ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
 /* 1節の文。列の候補に無い名前（前の版・手で書いた式から来た物）も選んだまま出す。 */
 function clauseHtml(c, i, hows, cols) {
  const h = howOf(hows, c.how);
  const names = cols.includes(c.col) || !c.col ? cols : [c.col, ...cols];
  const cmp = h && h.cmps ? sel('cmp', h.cmps, c.cmp, '比べ方', i) : '';
  const valued = h && h.cmps && !NO_VALUE.includes(c.cmp);
  return `<span class="fxb-clause" data-i="${i}">${i ? sel('join', JOINS, c.join || 'and', 'つなぎ方', i) : '<span class="fxb-w">もし</span>'}`
   + sel('col', names.map(n => [n, n]), c.col, '列', i)
   + sel('how', hows.map(x => [x.key, x.label]), c.how, '見方', i)
   + (valued ? `<input class="fxb-val" data-k="val" data-i="${i}" value="${esc(c.val)}" placeholder="値" aria-label="値">` : '')
   + (valued && c.cmp === 'between' ? `<span class="fxb-w">〜</span><input class="fxb-val" data-k="val2" data-i="${i}" value="${esc(c.val2)}" placeholder="値" aria-label="上の値">` : '')
   + cmp
   + (i ? `<button type="button" class="fxb-x" data-drop="${i}" title="この節を外します" aria-label="この節を外す">×</button>` : '')
   + '</span>';
 }
 function mount(el, opt) {
  const o = opt || {};
  const hows = o.hows || [];
  let spec = o.spec && Array.isArray(o.spec.clauses) && o.spec.clauses.length
   ? JSON.parse(JSON.stringify(o.spec)) : { kind: 'cond', clauses: [blankClause(hows, o.columns())] };
  const out = () => {
   const f = build(spec, hows);
   const chk = f && WL.formula ? WL.formula.check(f) : { ok: false, error: '列を選んでください' };
   return { f, chk };
  };
  function paint() {
   const cols = o.columns();
   const { f, chk } = out();
   el.innerHTML = `<div class="fxb-sentence">${spec.clauses.map((c, i) => clauseHtml(c, i, hows, cols)).join('')}`
    + '<button type="button" class="fxb-add" data-add title="「かつ／または」で節を足します">＋ かつ／または</button></div>'
    + `<div class="fxb-out"><span class="fxb-lab">できる式</span><code class="fxb-code${chk.ok ? '' : ' is-ng'}">${esc(f || '（まだ組み立てていません）')}</code>`
    + (chk.ok ? '' : `<small class="fxb-ng">${esc(chk.error)}</small>`) + '</div>';
  }
  function emit() { const { f, chk } = out(); o.onChange && o.onChange(JSON.parse(JSON.stringify(spec)), f, !!chk.ok); }
  el.addEventListener('click', e => {
   const b = e.target.closest('button');
   if (!b || !el.contains(b)) return;
   if (b.hasAttribute('data-add')) { spec.clauses.push(Object.assign(blankClause(hows, o.columns()), { join: 'and' })); paint(); emit(); return; }
   if (b.dataset.drop) { spec.clauses.splice(+b.dataset.drop, 1); paint(); emit(); }
  });
  const onEdit = e => {
   const x = e.target, k = x.dataset && x.dataset.k;
   if (!k || !el.contains(x)) return;
   const c = spec.clauses[+x.dataset.i];
   if (!c) return;
   c[k] = x.value;
   if (k === 'how') { const h = howOf(hows, c.how); if (h && h.cmps && !h.cmps.some(z => z[0] === c.cmp)) c.cmp = h.cmps[0][0]; }
   /* 選ぶ欄は描き直す（比べ方・値の欄が変わる）。打つ欄は式だけ書き直す（欄を作り直すと打っている字が飛ぶ）。 */
   if (e.type === 'change' && x.tagName === 'SELECT') paint();
   else { const { f, chk } = out(), code = el.querySelector('.fxb-code');
    if (code) { code.textContent = f || '（まだ組み立てていません）'; code.classList.toggle('is-ng', !chk.ok); } }
   emit();
  };
  el.addEventListener('change', onEdit);
  el.addEventListener('input', e => { if (e.target.matches && e.target.matches('input')) onEdit(e); });
  paint();
  return { spec: () => JSON.parse(JSON.stringify(spec)), formula: () => out().f, refresh: paint };
 }
 WL.formulaBuilder = { CMPS, NUM_CMPS, JOINS, NO_VALUE, quote, term, compare, join, build, read, blankClause, mount };
})();
