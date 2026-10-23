/* =========================================================================
   パネルを絞る（版 3.39.0。利用者の要望 1・2: パネル単位で絞る・設備を複数選ぶ）
   - 見ているときに、パネルの見出しの「絞る」から開く面。設備（複数）・期間・値（列の値をチェックで選ぶ）で、そのパネルだけを絞る
   - 絞り込みは、この PC の見え方（dashboard.js が覚える）。組んだ条件（組む所の「条件」）に足して効く。共通のダッシュボードは変わらない
     （編集のときは「パネルの条件にする」で組んだ条件へ移せる＝保存すると全員に効く）
   - 値の候補は、そのパネルの組み（データ・組んだ条件・期間）に当たる行の値と件数（サーバーの集計 /api/dashboard/query で数える。
     値を打たせない＝思い出させない）。日付の列は日ごと
   - 設備の選び（チェックの並び checklistHtml）は、組む所の「設備」でも同じ部品を使う
   ========================================================================= */
(function(){
  let emitT = 0, placeRaf = 0;      // 待っている変更・置き直し（1つの面ずつ）
  "use strict";
  const { esc } = WL.dashKit;
  const PERIODS = [["", "組んだ期間のまま"], ["today", "今日"], ["yesterday", "前日"], ["days", "直近 n 日"], ["this_month", "今月"], ["last_month", "先月"]];
  const MAX_SHOW = 300;

  /** 数える元（合わせた表は 1 つ目のまとまり） */
  const baseOf = (p) => (p.visual === "board" ? { ...((p.groups || [])[0] || {}), equips: p.equips } : p);
  const isEmpty = (q) => !q || (!(q.filters || []).length && !(q.equips || []).length && !(q.period && q.period.kind));
  /** 組んだパネル＋この PC の絞り込み → 数えるときのパネル */
  function merge(p, q) {
    if (isEmpty(q)) return p;
    const x = WL.dashKit.clone(p);
    if ((q.equips || []).length) x.equips = q.equips.slice();
    x.filters = (x.filters || []).concat(q.filters || []);
    if (x.visual !== "board" && q.period && q.period.kind) x.period = { column: q.period.column, kind: q.period.kind, n: q.period.n || 7 };
    return x;
  }
  /** ダッシュボードのスライサー（版 3.41.0。利用者の要望 6）をパネルに当てる → 数えるときのパネル（当たらなければ p のまま）。
      sl = {period: {kind, n}, equips: [設備名]}。期間は、期間を組んだパネル（合わせた表・合わせたデータは、期間を組んだまとまり・データ）だけに効く
      （仕掛のように「いま」を数えるパネルは変えない）。設備は、設備を見分けられるデータのパネルに効き、パネルが設備を選んでいれば重なる設備だけ。
      パネルの「スライサーに従わない」（noslice）なら当てない */
  function slice(p, sl, canEquip) {
    const hit = sliceHits(p, sl, canEquip);
    if (!hit.period && !hit.equip) return p;
    const x = WL.dashKit.clone(p), per = sl.period;
    // 日付で決めた期間（版 3.52.0。range: from〜to）も同じく、パネルの期間の列のまま日の範囲だけ替える
    const setPer = (o) => { if (hit.period && o && o.period && o.period.kind) o.period = per.kind === "range" ? { column: o.period.column, kind: "range", from: per.from, to: per.to || per.from } : { column: o.period.column, kind: per.kind, n: per.n || 7 }; };
    // 設備はスライサーで「絞る」だけ（パネルが設備を選んでいなければ、選んだ設備の計。設備ごとに分けるのはパネルの組みで決める）
    const setEq = (o) => { if (!hit.equip) return; const own = o.equips || []; if (!own.length && !o.esplit && !o.egroup && o !== x.link) o.esplit = "sum"; o.equips = own.length ? own.filter((e) => sl.equips.includes(e)) : sl.equips.slice(); if (!o.equips.length) o.equips = ["（スライサーの設備に当たりません）"]; };
    if (x.visual === "board") { (x.groups || []).forEach(setPer); setEq(x); }
    else if (x.link) (x.link.sides || []).forEach((sd) => { setPer(sd); if (canEquip(sd.source)) setEq(sd); });
    else { setPer(x); setEq(x); }
    return x;
  }
  /** スライサーがそのパネルに効くか → {period, equip} */
  function sliceHits(p, sl, canEquip) {
    const out = { period: false, equip: false };
    if (!sl || p.noslice) return out;
    const per = !!(sl.period && sl.period.kind), eq = (sl.equips || []).length > 0;
    const parts = p.visual === "board" ? p.groups || [] : p.link ? p.link.sides || [] : [p];
    out.period = per && parts.some((o) => o.period && o.period.kind);
    out.equip = eq && (p.visual === "board" ? ((p.rows || {}).column || "@equip") === "@equip" : parts.some((o) => canEquip(o.source)));
    return out;
  }
  /** 絞り込みの短い字（見出しの下の札） → [{key, text}]（key で 1 つずつ外す） */
  function chips(q) {
    if (isEmpty(q)) return [];
    const out = [];
    if ((q.equips || []).length) out.push({ key: "equips", text: `設備 ${q.equips.slice(0, 3).join("・")}${q.equips.length > 3 ? ` ほか ${q.equips.length - 3}` : ""}` });
    if (q.period && q.period.kind) out.push({ key: "period", text: `期間 ${q.period.kind === "days" ? `直近 ${q.period.n || 7} 日` : (PERIODS.find((x) => x[0] === q.period.kind) || ["", ""])[1]}` });
    byColumn(q.filters).forEach(([col, fs]) => out.push({ key: `c:${col}`, text: colText(col, fs) }));
    return out;
  }
  function drop(q, key) {
    const x = WL.dashKit.clone(q || {});
    if (key === "equips") x.equips = [];
    else if (key === "period") x.period = null;
    else if (key.startsWith("c:")) x.filters = (x.filters || []).filter((f) => f.column !== key.slice(2));
    else if (/^f\d+$/.test(key)) x.filters.splice(+key.slice(1), 1);
    return x;
  }
  /** 条件を列ごとにまとめる → [[列, [条件]]]（並びは最初に出た順） */
  function byColumn(filters) {
    const m = new Map();
    (filters || []).forEach((f) => { if (!m.has(f.column)) m.set(f.column, []); m.get(f.column).push(f); });
    return [...m];
  }
  /** 列の条件の短い字（値の選び「A1100・A3004 ほか 1」と条件「含む ab」を「・」で） */
  const colText = (col, fs) => `${col} ${fs.map((f) => (f.op === "in" ? WL.dashKit.inText(f) : WL.dashKit.condLabel({ ...f, column: "" }).trim())).join("・")}`;

  /* ---- 候補（サーバーで数える） ---- */
  async function ask(panel) {
    const r = await WL.dashKit.fetch("/api/dashboard/query", WL.dashKit.json("POST", { panel }));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `読めませんでした（${r.status}）`);
    return d;
  }
  /** その組みの列の値と件数 → [{value, label, n}]（多い順ではなく、決まった順＝日付・名前の順）。date … 日付の列（日ごと） */
  async function valuesOf(p, column, { date = false, without = -1, except = "", q = null } = {}) {
    const b = baseOf(p), own = (q && q.filters ? q.filters : []).filter((f, i) => i !== without && (!except || f.column !== except));
    const panel = { visual: "none", source: b.source, equip: b.equip || "", equips: (q && (q.equips || []).length ? q.equips : b.equips) || [], calc: b.calc, search: b.search || "",
      filters: (b.filters || []).concat(own), period: b.period || null, basis: b.basis || "work",
      body: { rows: [{ column, part: date ? "date" : "" }], cols: [], measures: [{ agg: "count" }], grand: false } };
    const d = await ask(panel);
    const lab = d.labels[0] || {}, cnt = new Map(d.cells.filter((x) => x.r.length === 1).map((x) => [x.r[0], x.v[0]]));
    return (d.orders[0] || []).map((k) => ({ value: k === "" ? "" : date ? k : k[0] === "$" ? k.slice(1) : String(lab[k] ?? k), label: String(lab[k] ?? k), n: cnt.get(k) || 0 }));
  }
  /** その組みの設備と件数 → [{value, label, n}] */
  async function equipsOf(p) {
    const b = baseOf(p);
    const d = await ask({ visual: "none", source: b.source, equip: b.equip || "", calc: b.calc, filters: b.filters || [], period: b.period || null, basis: b.basis || "work",
      body: { rows: [{ column: "@equip" }], cols: [], measures: [{ agg: "count" }], grand: false } });
    const lab = d.labels[0] || {}, cnt = new Map(d.cells.filter((x) => x.r.length === 1).map((x) => [x.r[0], x.v[0]]));
    return (d.orders[0] || []).filter((k) => k !== "").map((k) => ({ value: String(lab[k] ?? k), label: String(lab[k] ?? k), n: cnt.get(k) || 0 }));
  }
  async function fieldsOf(p) {
    const b = baseOf(p);
    const r = await WL.dashKit.fetch("/api/dashboard/fields", WL.dashKit.json("POST", { source: b.source, equip: b.equip || "", calc: b.calc || null }));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "カラムを読めませんでした");
    return d;
  }

  /** チェックの並び（設備・値）。items: [{value, label, n}]・picked: 選んだ値の Set。name … data 属性の名前（押すと data-ck-<name>）。
      全部を選んでいない（空）＝すべて。並びは 2〜3 列の格子（数が多いと検索で絞る） */
  function checklistHtml(items, picked, { name = "v", search = "", all = "すべて", unit = "件" } = {}) {
    const ql = search.trim().toLowerCase(), shown = items.filter((x) => !ql || x.label.toLowerCase().includes(ql)).slice(0, MAX_SHOW);
    const none = !picked.size;
    return `<div class="dfl-ck" role="group"><label class="dfl-all${none ? " on" : ""}"><input type="checkbox" data-ck-${name}-all${none ? " checked" : ""}>${esc(all)}</label>`
      + (picked.size ? `<small class="dfl-n">${picked.size} を選んでいます</small><button type="button" class="dfl-link" data-ck-${name}-clear>選びを外す</button>` : "")
      + `</div><div class="dfl-grid">${shown.map((x) => `<label class="dfl-it${picked.has(x.value) ? " on" : ""}" title="${esc(x.label)}"><input type="checkbox" data-ck-${name}="${esc(x.value)}"${picked.has(x.value) ? " checked" : ""}><span>${esc(x.label || "（空欄）")}</span>${x.n != null ? `<small>${C.fmt(x.n)}${unit}</small>` : ""}</label>`).join("")
      || '<p class="dfl-none">当たる値がありません</p>'}</div>${items.length > shown.length ? `<small class="dfl-n">ほか ${items.length - shown.length}（検索で絞ってください）</small>` : ""}`;
  }
  const C = WL.pivotCharts;

  /* ---- 面 ----
     3 つのまとまり（設備・期間・値と条件）を畳める段にし、開くのは 1 つだけ（版 3.45.0。1280×720 で値のチェックが面の下に隠れた: 2026-10-colfilter の 1 回目）。
     畳んだ段の見出しには、いま選んでいる物の要約を出す（開かなくても何で絞っているかが見える）。
     設備と値は同じ「値で絞る」の部品（value-filter.js の埋め込み）で、同じ形・同じ言葉（（すべて選択）・件数の帯）。
     埋め込みの部品は、段を開いたとき・列を替えたときだけ作り直す（チェックのたびに作り直すと、値の読み直し・送り位置・打っている欄が失われる） */
  let el = null, off = null, st = null, vf = null, vfEq = null;
  function close() {
    if (off) off(); off = null;
    if (st && st.ro) st.ro.disconnect();
    [vf, vfEq].forEach((x) => x && x.destroy()); vf = vfEq = null;      // 待っている選びを渡してから
    if (st && emitT) { clearTimeout(emitT); emitT = 0; st.onChange(WL.dashKit.clone(st.q)); }   // 閉じる前の最後の変更も効かせる（すぐ閉じると捨てていた）
    if (el) el.remove(); el = null; st = null;
  }
  /** 開く。h = {anchor, panel, quick, sources, canMove, onChange(quick), onMove(), boardKeys?} */
  async function open(h) {
    close();
    st = { ...h, q: WL.dashKit.clone(h.quick || { filters: [], equips: [], period: null }), equipItems: null, fields: null, col: "", err: "", sec: "" };
    st.q.filters = st.q.filters || []; st.q.equips = st.q.equips || [];
    el = document.createElement("div");
    el.className = "dash-pop dfl-pop"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "このパネルを絞る");
    el.innerHTML = '<div class="dfl-top"></div>'
      + '<section class="dfl-sec" data-sec="eq" hidden><button type="button" class="dfl-sech" data-df-sec="eq"></button><div class="dfl-secb"><div class="dfl-eqvf"></div></div></section>'
      + '<section class="dfl-sec" data-sec="per" hidden><button type="button" class="dfl-sech" data-df-sec="per"></button><div class="dfl-secb dfl-perb"></div></section>'
      + '<section class="dfl-sec" data-sec="val"><button type="button" class="dfl-sech" data-df-sec="val"></button><div class="dfl-secb"><div class="dfl-valtop"></div><div class="dfl-vf" hidden></div></div></section>'
      + '<div class="dfl-bottom"></div>';
    document.body.append(el);
    paint();
    place();
    // 中身の高さが変わったら（段を開く・値を読み終える）置き直す
    const ro = new ResizeObserver(function(){ cancelAnimationFrame(placeRaf); placeRaf = requestAnimationFrame(place); });
    el.querySelectorAll(".dfl-top,.dfl-sec,.dfl-bottom").forEach((x) => ro.observe(x));
    st.ro = ro;
    off = WL.dashKit.dismissable(el, close, { keep: { contains: (t) => !!(t && t.closest && (t === h.anchor || t.closest("[data-db-filter]"))) } });
    el.addEventListener("click", onClick); el.addEventListener("change", onChange);
    const src = (h.sources || []).find((x) => x.key === baseOf(h.panel).source) || {};
    st.hasEquip = h.panel.visual === "board" ? (h.panel.rows || {}).column === "@equip" : !!src.equip;
    try {
      const [eq, f] = await Promise.all([st.hasEquip ? (h.boardKeys ? Promise.resolve(h.boardKeys.map((k) => ({ value: k, label: k, n: null }))) : equipsOf(h.panel)) : Promise.resolve(null), fieldsOf(h.panel)]);
      if (!st) return;
      st.equipItems = eq; st.fields = f;
      // 開く段: 値で絞っていればその列・設備を選んでいれば設備・どちらも無ければ値と条件（設備は見出しの要約で見える）
      const first = byColumn(st.q.filters)[0];
      openSec(first || !(st.q.equips || []).length ? "val" : "eq");
      if (first) pickCol(first[0]);
    } catch (e) { if (st) st.err = String(e.message || e); }
    if (st) { paint(); place(); }
  }
  /** 基準のボタンの下に置き、下に入りきらなければ上へずらす（見出しの下まで）。それでも入らなければ中を送る
      （1280×720 で、値と条件の段の下が下のボタンの行に隠れた: 2026-10-colfilter の作った後の採点） */
  function place() {
    if (!el || !st) return;
    el.style.maxHeight = ""; el.style.top = "";
    WL.dashKit.placeBelow(el, st.anchor);
    const floor = Math.round(document.querySelector("body > header")?.getBoundingClientRect().bottom || 0) + 8;
    const need = el.scrollHeight, top = el.getBoundingClientRect().top;
    if (need > innerHeight - top - 8) {
      const t = Math.max(floor, innerHeight - need - 8);
      el.style.top = `${t}px`; el.style.maxHeight = `${innerHeight - t - 8}px`;
    }
  }
  const emit = () => { clearTimeout(emitT); const q = WL.dashKit.clone(st.q); emitT = setTimeout(() => { emitT = 0; if (st) st.onChange(q); }, 200); };
  const sel = (attr, opts, cur, label) => `<select class="dfl-sel" ${attr} aria-label="${esc(label)}">${opts.map(([k, n]) => `<option value="${esc(k)}"${k === cur ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
  const perText = (pr) => (pr && pr.kind ? (pr.kind === "days" ? `直近 ${pr.n || 7} 日` : (PERIODS.find((x) => x[0] === pr.kind) || ["", ""])[1]) : "組んだ期間のまま");
  /** 段の見出し（名前・要約・開閉の印） */
  const secHead = (name, sum, on, open) => `<i aria-hidden="true">${open ? "▾" : "▸"}</i><b>${name}</b><span class="dfl-sum${on ? " on" : ""}" title="${esc(sum)}">${esc(sum)}</span>`;
  function paint() {
    if (!el || !st) return;
    const q = st.q, p = st.panel, fl = (st.fields && st.fields.fields) || [], dates = fl.filter((f) => f.date && !f.error);
    const cols = fl.filter((f) => !f.error);
    const work = WL.dashKit.src.isWork(baseOf(p).source);
    const periodCols = [...(work ? [["@workday", "作業日"]] : []), ...dates.map((f) => [f.column, f.column])];
    const pr = q.period || {}, groups = byColumn(q.filters);
    el.querySelector(".dfl-top").innerHTML = `<div class="dash-pophead"><b>このパネルを絞る</b><small>この PC の見え方だけです。組んだ条件に足して効きます（共通のダッシュボードは変わりません）</small></div>`
      + (st.err ? `<p class="dash-poperr">${esc(st.err)}</p>` : "");
    const secEl = (k) => el.querySelector(`[data-sec="${k}"]`);
    // 設備
    secEl("eq").hidden = !st.hasEquip;
    secEl("eq").querySelector(".dfl-sech").innerHTML = secHead("設備", q.equips.length ? VF().pickedText(q.equips, 3) : "すべての設備", q.equips.length > 0, st.sec === "eq");
    // 期間
    const perOk = p.visual !== "board" && periodCols.length > 0;
    secEl("per").hidden = !perOk;
    secEl("per").querySelector(".dfl-sech").innerHTML = secHead("期間", perText(pr), !!pr.kind, st.sec === "per");
    if (perOk) el.querySelector(".dfl-perb").innerHTML = `<div class="dfl-row">${sel("data-df-pkind", PERIODS, pr.kind || "", "期間")}`
      + (pr.kind === "days" ? `<input type="number" min="1" max="3660" value="${pr.n || 7}" data-df-pn aria-label="日の数" class="dfl-num">日` : "")
      + (pr.kind ? sel("data-df-pcol", periodCols, pr.column, "期間で絞る日付") : "") + "</div>";
    // 値と条件
    secEl("val").querySelector(".dfl-sech").innerHTML = secHead("値・条件", groups.length ? groups.map(([c, fs]) => colText(c, fs)).join("／") : "絞っていません", groups.length > 0, st.sec === "val");
    const had = groups.map(([col, fs]) => `<span class="dfl-chip${col === st.col ? " on" : ""}"><button type="button" class="dfl-chipb" data-df-fcol="${esc(col)}" title="この列の絞り込みを直す">`
      + `<b>${esc(col)}</b>${esc(colText(col, fs).slice(col.length + 1))}</button><button type="button" data-df-fdel="${esc(col)}" aria-label="「${esc(col)}」の絞り込みを外す" title="外す">×</button></span>`).join("");
    const pick = `<div class="dfl-row">${sel("data-df-col", [["", "列を選ぶ…"], ...cols.map((f) => [f.column, `${f.column}${f.calc ? "（式）" : ""}${q.filters.some((x) => x.column === f.column) ? "  ●" : ""}`])], st.col, "値・条件で絞る列")}</div>`;
    el.querySelector(".dfl-valtop").innerHTML = (had ? `<div class="dfl-chips">${had}</div>` : "") + (st.fields ? pick : '<p class="dfl-none">カラムを読んでいます…</p>');
    ["eq", "per", "val"].forEach((k) => { secEl(k).classList.toggle("is-open", st.sec === k); secEl(k).querySelector(".dfl-sech").setAttribute("aria-expanded", String(st.sec === k)); });
    el.querySelector(".dfl-bottom").innerHTML = `<div class="dash-popacts"><button type="button" class="pv-btn" data-df-clear${isEmpty(q) ? " disabled" : ""}>すべて外す</button><span class="dash-sp"></span>`
      + (st.canMove ? `<button type="button" class="pv-btn" data-df-move${isEmpty(q) ? " disabled" : ""} title="この絞り込みを、組む所の条件（保存すると全員に効く）へ移します">パネルの条件にする</button>` : "")
      + `<button type="button" class="mm-btn-primary" data-df-close>閉じる</button></div>`;
  }
  const VF = () => WL.valueFilter;
  /** 段を開く（1 つだけ）。設備の段を初めて開くとき、設備の値で絞る部品を作る */
  function openSec(k) {
    st.sec = st.sec === k ? "" : k;
    if (st.sec === "eq" && !vfEq && st.equipItems) {
      vfEq = VF().mount(el.querySelector(".dfl-eqvf"), {
        column: "@equip", label: "設備", picked: st.q.equips.length ? st.q.equips.slice() : null, ops: [],
        load: async () => ({ values: st.equipItems.map((x) => ({ value: x.value, label: x.label, count: x.n })) }),
        onChange: (r) => { if (!st || st.clearing) return; st.q.equips = r.picked || []; emit(); paint(); },
      });
    }
    paint();
  }
  /** 値で絞る列を選ぶ（埋め込みの面を作り直す。空なら畳む） */
  function pickCol(col) {
    st.col = col;
    if (vf) { vf.destroy(); vf = null; }
    const box = el.querySelector(".dfl-vf");
    box.hidden = !col;
    if (!col) return;
    const f = ((st.fields && st.fields.fields) || []).find((x) => x.column === col) || {}, date = !!f.date;
    const cur = VF().fromFilters(col, st.q.filters);
    vf = VF().mount(box, {
      column: col, label: col, date, picked: cur.picked, conds: cur.conds,
      load: async () => ({ values: (await valuesOf(st.panel, col, { date, except: col, q: st.q })).map((x) => ({ value: x.value, label: x.label, count: x.n })) }),
      onChange: (r) => {
        if (!st || st.col !== col) return;
        st.q.filters = st.q.filters.filter((x) => x.column !== col).concat(VF().toFilters(col, r, date ? "date" : ""));
        emit(); paint();
      },
    });
  }
  function onClick(e) {
    const b = e.target.closest("button"); if (!b || b.closest(".dfl-eqvf,.dfl-vf")) return;
    if (b.dataset.dfSec) { openSec(b.dataset.dfSec); return; }
    if (b.hasAttribute("data-df-close")) { close(); return; }
    if (b.hasAttribute("data-df-clear")) {
      st.clearing = true; pickCol(""); if (vfEq) vfEq.destroy(); st.clearing = false;      // 待っていた選びは捨てる（すべて外すが先）
      st.q = { filters: [], equips: [], period: null }; emit();
      if (vfEq) { vfEq = null; if (st.sec === "eq") { st.sec = ""; openSec("eq"); return; } }
      paint(); return;
    }
    if (b.hasAttribute("data-df-move")) { const h = st; close(); h.onMove(); return; }
    if (b.dataset.dfFcol != null) { pickCol(b.dataset.dfFcol); paint(); return; }
    if (b.dataset.dfFdel != null) { const c = b.dataset.dfFdel; st.q.filters = st.q.filters.filter((x) => x.column !== c); if (st.col === c) pickCol(c); emit(); paint(); }
  }
  function onChange(e) {
    const x = e.target; if (x.closest(".dfl-eqvf,.dfl-vf")) return;
    if (x.matches("[data-df-col]")) { pickCol(x.value); paint(); return; }
    if (x.matches("[data-df-pkind]")) {
      const work = WL.dashKit.src.isWork(baseOf(st.panel).source), first = ((st.fields && st.fields.fields) || []).find((f) => f.date);
      st.q.period = x.value ? { column: (st.q.period && st.q.period.column) || (work ? "@workday" : first ? first.column : ""), kind: x.value, n: (st.q.period && st.q.period.n) || 7 } : null;
      emit(); paint(); return;
    }
    if (x.matches("[data-df-pcol]")) { st.q.period.column = x.value; emit(); return; }
    if (x.matches("[data-df-pn]")) { st.q.period.n = Math.max(1, Math.min(3660, +x.value || 7)); emit(); }
  }

  WL.dashFilter = { open, close, merge, slice, sliceHits, chips, drop, isEmpty, checklistHtml, equipsOf, valuesOf, byColumn, colText, isOpen: () => !!el };
})();
