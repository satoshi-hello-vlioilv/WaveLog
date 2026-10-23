/* =========================================================================
   値で絞る（版 3.45.0。利用者の要望 1・6: Excel のフィルタのように、列の重複の無い値にチェックを入れて絞る＋条件で絞る）
   - 一覧（品質異常・作業実績・仕掛…）の列の見出しと、ダッシュボードの「絞る」・組む所の「条件」が同じ部品を使う
   - 面の中身: 並べ替え（一覧だけ）→ 値を検索 →（すべて選択）と値のチェックの並び（Excel と同じ順。2026-10-colfilter の 1 回目で C が 1 位）→ 条件で絞る（含む・以上・空欄…。2 つまで「かつ」）
     （値ごとの件数と、件数の長さの帯。いまのほかの絞り込みで 0 件の値は薄く）→ この列の絞り込みを外す・キャンセル・OK
   - 値を検索して OK を押すと、Excel と同じく「検索に当たる値」だけで絞る（「いまの選びに足す」を入れると前の選びに足す）
   - 答えの形: { picked: null（すべて）| [値], conds: [{op, value}] }。値の "" は空欄
   - 置き方: open(...)（浮かぶ面。OK で onApply）／ mount(入れ物, ...)（面の中に埋め込む。変えるたびに onChange）
   ========================================================================= */
(function(){
  let searchT = 0;      // 打った字で探し直すまで
  "use strict";
  const { esc } = WL.dashKit;
  const MAX_CONDS = 2;
  const SEARCH_MS = 220;
  const blank = (v) => (v === "" ? "（空欄）" : v);
  const fmtN = (n) => (n == null ? "" : Number(n).toLocaleString());

  /** 値の候補の読み込み・選び・条件を持つ係。o = 下の open の説明と同じ。paint(html) で描く先を受け取る */
  function create(o, host) {
    const st = {
      values: null, truncated: false, err: "", search: "", loading: false,
      sel: o.picked == null ? null : new Set(o.picked),    // null＝すべて
      ssel: null, add: false,                                // 検索しているあいだの選び（Excel と同じ）と「いまの選びに足す」
      conds: (o.conds || []).map((c) => ({ op: c.op, value: c.value ?? "" })).slice(0, MAX_CONDS),
      condOpen: (o.conds || []).length > 0, hideZero: false, seq: 0,
    };
    const ops = () => (o.ops || WL.dashKit.FILTER_OPS).filter(([k]) => !(k in WL.dashKit.REL_UNIT) || o.date);
    async function load(search = "") {
      const my = ++st.seq; st.loading = true; st.err = "";
      host.paint();
      try {
        const d = await o.load({ search });
        if (my !== st.seq) return;
        st.values = (d.values || []).map((x) => ({ value: String(x.value ?? ""), label: x.label != null ? String(x.label) : String(x.value ?? ""), count: x.count, all: x.all }));
        st.truncated = !!d.truncated;
      } catch (e) { if (my === st.seq) st.err = String((e && e.message) || e); }
      if (my === st.seq) { st.loading = false; host.paint(); }
    }
    const ql = () => st.search.trim().toLowerCase();
    const shown = () => (st.values || []).filter((x) => (!ql() || blank(x.label).toLowerCase().includes(ql())) && !(st.hideZero && x.count === 0 && !isOn(x.value)));
    const isOn = (v) => (st.ssel ? st.ssel.has(v) : st.sel == null || st.sel.has(v));
    function toggle(v, on) {
      if (st.ssel) { if (on) st.ssel.add(v); else st.ssel.delete(v); return; }
      if (st.sel == null) st.sel = new Set((st.values || []).map((x) => x.value));
      if (on) st.sel.add(v); else st.sel.delete(v);
    }
    function toggleAll(on) {
      const list = shown();
      if (st.ssel) { list.forEach((x) => (on ? st.ssel.add(x.value) : st.ssel.delete(x.value))); return; }
      if (!ql() && !st.hideZero) { st.sel = on ? null : new Set(); return; }
      list.forEach((x) => toggle(x.value, on));
    }
    function setSearch(text) {
      const was = !!ql();
      st.search = text;
      if (ql() && !was) st.ssel = null;
      // 検索を始めたら「当たる値をすべて選ぶ」から（Excel と同じ）。読み直しの後にも当たる値で作り直す
      if (ql()) st.ssel = new Set(shown().map((x) => x.value));
      else { st.ssel = null; st.add = false; }
      if (st.truncated || (o.serverSearch && was !== !!ql())) { clearTimeout(searchT); searchT = setTimeout(async () => { await load(st.search); if (ql()) st.ssel = new Set(shown().map((x) => x.value)); host.paint(); }, SEARCH_MS); }
    }
    /** いまの答え（すべてを選んでいれば picked は null） */
    function result() {
      let picked;
      if (st.ssel) {
        const base = st.add ? (st.sel == null ? null : [...st.sel]) : [];
        picked = base == null ? null : [...new Set(base.concat([...st.ssel]))];
      } else picked = st.sel == null ? null : [...st.sel];
      if (picked && st.values && !st.truncated && !st.ssel && picked.length >= st.values.length && st.values.every((x) => picked.includes(x.value))) picked = null;
      const order = new Map((st.values || []).map((x, i) => [x.value, i]));
      if (picked) picked.sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
      const conds = st.conds.filter((c) => WL.dashKit.noValueOp(c.op) || String(c.value).trim() !== "").map((c) => ({ op: c.op, value: WL.dashKit.noValueOp(c.op) ? "" : String(c.value).trim() }));
      return { picked, conds };
    }
    const active = () => { const r = result(); return r.picked != null || r.conds.length > 0; };

    const F = { o, st, ops, ql, shown, isOn, result, active };
    const html = () => panelHtml(F);
    return { st, load, html, result, active, toggle, toggleAll, setSearch, ops };
  }

  /** 条件で絞る（2 つまで「かつ」）の段 */
  function condHtml(F) {
    const { st, ops } = F;
    if (!ops().length) return "";      // 条件を使えない列（一覧の計算列: 式はサーバーに無い）
    const rows = st.conds.map((c, i) => `<div class="vf-crow" data-i="${i}">${i ? '<span class="vf-and">かつ</span>' : ""}`
      + `<select data-vf-op aria-label="比べ方">${ops().map(([k, n]) => `<option value="${k}"${k === c.op ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`
      + `<input data-vf-val value="${esc(c.value)}" placeholder="${c.op in WL.dashKit.REL_UNIT ? "数（例: 7）" : "値"}" aria-label="比べる値"${WL.dashKit.noValueOp(c.op) ? " disabled" : ""}${c.op in WL.dashKit.REL_UNIT ? ' inputmode="numeric"' : ""}>`
      + `<button type="button" class="vf-x" data-vf-cdel="${i}" aria-label="この条件を外す" title="この条件を外す">×</button></div>`).join("");
    const n = st.conds.length;
    return `<div class="vf-conds${st.condOpen ? " is-open" : ""}"><button type="button" class="vf-ctog" data-vf-ctog aria-expanded="${st.condOpen}">`
      + `<i aria-hidden="true">${st.condOpen ? "▾" : "▸"}</i>条件で絞る<small>${n ? `${n} つ` : "含む・以上・空欄 など"}</small></button>`
      + (st.condOpen ? `<div class="vf-cbody">${rows}${n < MAX_CONDS ? `<button type="button" class="vf-cadd" data-vf-cadd>＋ ${n ? "条件を足す（かつ）" : "条件"}</button>` : ""}</div>` : "") + "</div>";
  }
  /** 値のチェックの並び（件数と、件数の長さの帯） */
  function listHtml(F) {
    const { st, shown, isOn, ql } = F;
    if (st.err) return `<p class="vf-err">${esc(st.err)}</p>`;
    if (!st.values) return `<p class="vf-wait">${WL.loader.html(14)}値を数えています…</p>`;
    const list = shown(), max = Math.max(1, ...list.map((x) => x.count || 0));
    const onN = list.filter((x) => isOn(x.value)).length;
    const allState = onN === 0 ? "" : onN === list.length ? " checked" : " data-mixed";
    const head = `<label class="vf-all"><input type="checkbox" data-vf-all${allState}>${ql() ? `検索に当たる ${list.length} をすべて` : "（すべて選択）"}</label>`;
    const rows = list.map((x) => {
      const on = isOn(x.value), zero = x.count === 0;
      return `<label class="vf-it${on ? " on" : ""}${zero ? " is-zero" : ""}" title="${esc(blank(x.label))}${zero ? "\nいまのほかの絞り込みでは 0 件です" : ""}">`
        + `<input type="checkbox" data-vf-v="${esc(x.value)}"${on ? " checked" : ""}><span class="vf-lab${x.value === "" ? " is-blank" : ""}">${esc(blank(x.label))}</span>`
        + (x.count != null ? `<span class="vf-n"><i style="width:${Math.round((x.count / max) * 100)}%"></i><b>${fmtN(x.count)}</b></span>` : "") + "</label>";
    }).join("");
    return head + `<div class="vf-items" role="group" aria-label="値">${rows || '<p class="vf-none">当たる値がありません</p>'}</div>`
      + (st.truncated ? `<small class="vf-more">値が多いので、先頭の ${st.values.length.toLocaleString()} だけを出しています。検索で絞ってください</small>` : "");
  }
  /** 面の中身ぜんたい（見出し→並べ替え→固定→検索→値→条件→足元） */
  function panelHtml(F) {
    const { o, st, result, active, ql } = F;
    const r = st.values ? result() : null;
    const pickN = r && r.picked ? r.picked.length : null;
    const sort = o.sort ? `<div class="vf-sort" role="group" aria-label="並べ替え"><button type="button" data-vf-sort="asc" class="${o.sort.dir === "asc" ? "on" : ""}">▲ 小さい順</button>`
      + `<button type="button" data-vf-sort="desc" class="${o.sort.dir === "desc" ? "on" : ""}">▼ 大きい順</button>${o.sort.dir ? '<button type="button" data-vf-sort="">並べ替えを外す</button>' : ""}</div>` : "";
    const locked = (o.locked || []).length ? `<p class="vf-locked" title="「固定」の条件は、条件の面で外せます">固定: ${esc(o.locked.join("・"))}</p>` : "";
    const search = `<div class="vf-search"><input type="search" data-vf-search value="${esc(st.search)}" placeholder="値を検索" aria-label="値を検索" autocomplete="off">`
      + (ql() ? `<label class="vf-add" title="検索に当たる値を、前の選びに足します（外すと、検索に当たる値だけで絞ります）"><input type="checkbox" data-vf-addmode${st.add ? " checked" : ""}>いまの選びに足す</label>` : "") + "</div>";
    const state = `<small class="vf-state">${pickN == null ? (st.values ? `${st.values.length.toLocaleString()}${st.truncated ? "+" : ""} 種類` : "") : `${pickN.toLocaleString()} を選んでいます`}</small>`;
    const foot = o.embedded ? "" : `<div class="vf-foot"><button type="button" class="pv-btn" data-vf-clear${o.had || active() ? "" : " disabled"} title="この列の値の選び・条件を外して、OK を押さずにすぐ戻します">絞り込みを外す</button><span class="vf-sp"></span>`
      + '<button type="button" class="pv-btn" data-vf-cancel>キャンセル</button>'
      + `<button type="button" class="mm-btn-primary" data-vf-ok${r && r.picked && !r.picked.length ? ' disabled title="値を 1 つ以上選んでください（どれも選ばないと 0 件になります）"' : ""}>OK</button></div>`;
    return (o.embedded ? "" : `<div class="vf-head"><b title="${esc(o.label || o.column)}">${esc(o.label || o.column)}</b>${state}</div>`) + sort + locked + search
      + `<div class="vf-list">${listHtml(F)}</div>` + condHtml(F) + (o.embedded ? `<div class="vf-estate">${state}${active() ? '<button type="button" class="vf-link" data-vf-clear>この列の絞り込みを外す</button>' : ""}</div>` : "") + foot;
  }

  /** 描き直し（焦点のある欄と、値の並びの送り位置を保つ） */
  function repaint(root, html) {
    const a = document.activeElement, inside = a && root.contains(a);
    const key = inside ? (a.matches("[data-vf-search]") ? "[data-vf-search]" : a.dataset.vfV != null ? `[data-vf-v="${CSS.escape(a.dataset.vfV)}"]`
      : a.closest(".vf-crow") ? `.vf-crow[data-i="${a.closest(".vf-crow").dataset.i}"] ${a.matches("[data-vf-op]") ? "[data-vf-op]" : "[data-vf-val]"}` : "") : "";
    const caret = key && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null;
    const items = root.querySelector(".vf-items"), top = items ? items.scrollTop : 0;
    root.innerHTML = html;
    root.querySelectorAll("[data-vf-all][data-mixed]").forEach((x) => { x.indeterminate = true; });
    const it2 = root.querySelector(".vf-items"); if (it2) it2.scrollTop = top;
    if (key) { const b = root.querySelector(key); if (b) { b.focus({ preventScroll: true }); if (caret && b.setSelectionRange) try { b.setSelectionRange(...caret); } catch (e) { WL.quiet.note("字の位置を選べない欄（焦点だけ戻す）", e); } } }
  }

  /** 操作を受ける（浮かぶ面・埋め込みで同じ）。changed() … 選び・条件が変わった */
  function bind(root, c, o, { changed, ok, cancel, clear, after = null }) {
    root.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.hasAttribute("data-vf-ctog")) { c.st.condOpen = !c.st.condOpen; if (c.st.condOpen && !c.st.conds.length) c.st.conds.push({ op: o.date ? "within_days" : "contains", value: "" }); paint(); if (c.st.condOpen) root.querySelector(".vf-crow [data-vf-val]:not(:disabled)")?.focus(); return; }
      if (b.hasAttribute("data-vf-cadd")) { c.st.conds.push({ op: "contains", value: "" }); paint(); root.querySelector(`.vf-crow[data-i="${c.st.conds.length - 1}"] [data-vf-val]`)?.focus(); return; }
      if (b.dataset.vfCdel != null) { c.st.conds.splice(+b.dataset.vfCdel, 1); if (!c.st.conds.length) c.st.condOpen = false; paint(); changed(); return; }
      if (b.dataset.vfSort != null) { o.sort.set(b.dataset.vfSort); o.sort.dir = b.dataset.vfSort; paint(); return; }
      if (b.hasAttribute("data-vf-ok")) { if (!b.disabled) ok(); return; }
      if (b.hasAttribute("data-vf-cancel")) { cancel(); return; }
      if (b.hasAttribute("data-vf-clear")) { clear(); }
    });
    root.addEventListener("change", (e) => {
      const x = e.target;
      if (x.matches("[data-vf-all]")) { c.toggleAll(x.checked); paint(); changed(); return; }
      if (x.dataset.vfV != null) { c.toggle(x.dataset.vfV, x.checked); paint(); changed(); return; }
      if (x.matches("[data-vf-addmode]")) { c.st.add = x.checked; changed(); return; }
      if (x.matches("[data-vf-op]")) {
        const cd = c.st.conds[+x.closest(".vf-crow").dataset.i]; cd.op = x.value;
        if (WL.dashKit.noValueOp(cd.op)) cd.value = "";
        paint(); changed();
      }
    });
    // 打った字は、変換中は受けず確定してから（変換中に面を作り直すと、未確定の字が確定されてローマ字・漢字で打てない。版 3.46.0）
    WL.dashKit.onTextIn(root, "[data-vf-search]", (x) => { c.setSearch(x.value); paint(); changed(); });
    WL.dashKit.onTextIn(root, "[data-vf-val]", (x) => { c.st.conds[+x.closest(".vf-crow").dataset.i].value = x.value; changed(true); });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing && ok && !e.target.matches("button")) { e.preventDefault(); if (!root.querySelector("[data-vf-ok]")?.disabled) ok(); }
    });
    // 裏で値を読み直した後の描き直しも、変換中なら確定まで待つ
    function paint() { WL.dashKit.afterIme(root, () => { repaint(root, c.html()); if (after) after(); }); }
    return paint;
  }

  /* ---- 浮かぶ面（一覧の列の見出し・組む所の条件） ---- */
  let cur = null;
  function close() { if (!cur) return; const k = cur; cur = null; k.off && k.off(); k.el.remove(); k.o.onClose && k.o.onClose(); }
  /** 開く。o = {anchor（下に置く要素）か x・y, column, label, date, load({search}) → {values:[{value,label?,count,all?}], truncated},
      picked: null|[値], conds: [{op, value}], sort?: {dir, set(dir)}, locked?: [字], had?（いま絞っているか）, serverSearch?, onApply(答え), onClose()} */
  function open(o) {
    close();
    const el = document.createElement("div");
    el.className = "vf-pop"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", `「${o.label || o.column}」を値で絞る`);
    document.body.append(el);
    const k = { el, o };
    const c = create(o, { paint: () => k.paint && k.paint() });
    const place = () => {
      el.style.maxHeight = "";
      if (o.anchor && o.anchor.isConnected) WL.dashKit.placeBelow(el, o.anchor, o.align || "left");
      else WL.dashKit.placeAt(el, o.x || 100, o.y || 100);
      // 下に入りきらなければ、まず値の並びを縮め（320px まで）、それでも入らなければ上へずらす（面の下が切れて OK に届かない所を作らない）
      const top = el.getBoundingClientRect().top, room = innerHeight - top - 8;
      if (el.offsetHeight > room) {
        if (room >= 320) el.style.maxHeight = `${room}px`;
        else el.style.top = `${Math.max(8, innerHeight - Math.min(el.offsetHeight, innerHeight - 16) - 8)}px`;
      }
    };
    // 描き直すたびに置き直す（条件で絞るを開くと面が伸び、1280×720 で下の OK が窓の外に出た: 2026-10-colfilter の自分の確かめ）
    k.paint = bind(el, c, o, {
      after: () => place(),
      changed: () => {},
      ok: () => { const r = c.result(); close(); o.onApply(r); },
      cancel: () => close(),
      clear: () => { close(); o.onApply({ picked: null, conds: [] }); },
    });
    cur = k;
    k.paint();
    k.off = WL.dashKit.dismissable(el, () => { if (cur === k) close(); }, { keep: o.anchor ? { contains: (t) => o.anchor.contains(t) } : null });
    c.load().then(function(){ if (cur === k) place(); });
    requestAnimationFrame(() => el.querySelector("[data-vf-search]")?.focus({ preventScroll: true }));
    return { close, el };
  }

  /** 面の中に埋め込む（ダッシュボードの「絞る」）。変えるたびに onChange(答え)（打つ欄は少し待つ）。戻り値 {el, result(), destroy()} */
  function mount(box, o) {
    box.classList.add("vf-embed");
    const c = create({ ...o, embedded: true }, { paint: () => paint && paint() });
    let t = 0;
    const emit = (slow) => { clearTimeout(t); t = setTimeout(() => { t = 0; o.onChange(c.result()); }, slow ? 350 : 120); };
    const paint = bind(box, c, { ...o, embedded: true }, {
      changed: emit, ok: null, cancel: () => {},
      clear: () => { c.st.sel = null; c.st.ssel = null; c.st.search = ""; c.st.conds = []; c.st.condOpen = false; paint(); emit(); },
    });
    paint(); c.load();
    return { el: box, result: c.result, reload: () => c.load(c.st.search), destroy: () => { if (t) { clearTimeout(t); t = 0; o.onChange(c.result()); } box.innerHTML = ""; box.classList.remove("vf-embed"); } };   // 待っている変更は捨てずに渡す（すぐ閉じても効く）
  }

  /* ---- 答えと条件の行き来（一覧・ダッシュボードで同じ） ---- */
  /** 値の並び（in の value の JSON）→ [値] */
  const inValues = (f) => { try { const v = JSON.parse(f.value || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch (_) { return []; } };
  /** その列の条件（[{column, op, value, key?}]）→ 面に渡す {picked, conds} */
  function fromFilters(column, filters) {
    const mine = (filters || []).filter((f) => f.column === column);
    const inn = mine.find((f) => f.op === "in");
    return { picked: inn ? inValues(inn) : null, conds: mine.filter((f) => f.op !== "in" && f.op !== "tuple_in" && f.op !== "date_range").map((f) => ({ op: f.op, value: f.value })) };
  }
  /** 面の答え → その列の条件（key … 値の比べ方〈日付の列は日ごと など〉） */
  function toFilters(column, r, key = "") {
    return (r.picked ? [{ column, op: "in", value: JSON.stringify(r.picked), ...(key ? { key } : {}) }] : []).concat(r.conds.map((x) => ({ column, op: x.op, value: x.value })));
  }
  /** 値を選ぶ条件の短い字（「CR1・CR2 ほか 3」） */
  function pickedText(list, n = 2) {
    return list.length ? list.slice(0, n).map(blank).join("・") + (list.length > n ? ` ほか ${list.length - n}` : "") : "（どれも選んでいません）";
  }

  WL.valueFilter = { open, close, mount, fromFilters, toFilters, inValues, pickedText, isOpen: () => !!cur };
})();
