/* =========================================================================
   行・列・値の札を引いて組み替える（版 3.50.0。利用者の要望 2026-10-22 の 1）。集計表・グラフ（lotlist-pivot.js）と
   ダッシュボードの組む所（dashboard-editor.js）が同じ部品・同じ決まりで使う。
   - 引ける物: 文の札（.pv-chip[data-dnd-role][data-dnd-i]）と、左のカラムの札（.pv-f[data-dnd-col]。data-dnd-roles に置ける役）
   - 置ける所: 文の枠（.pv-slot[data-role]）。札の間に差し込む線で、どこに入るかを見せる。カラムの欄（[data-dnd-trash]）へ戻すと外す
   - 決まり（move。画面に関わらない。tools/pivot-dnd-check.mjs が確かめる）:
       同じ枠の中 … 並べ替え／行 ⇔ 列 … 移す（段の数の上限を超えるなら、置いた所の札と入れ替える）／
       カラムの札 … その所に足す（別の枠にあれば移す・同じ枠にあれば並べ替え。1 つだけ置ける所は置き換える）／値 ⇔ 行・列 … 動かさない（数え方が違う）
   - キーボード（札に焦点）: Alt＋← → … 同じ枠の中で前・後へ／Alt＋↑ ↓ … 行 ⇔ 列へ移す／Delete … 外す
   - 引くのは pointer の事件で数える（HTML の drag は窓の WebView2 で影が見えにくく、select の上で始まってしまう）
   ========================================================================= */
(function(){
  "use strict";
  const DIMS = ["rows", "cols"], NAME = { rows: "行", cols: "列", vals: "値" };
  const same = (a, b) => !!a && !!b && (a.column || "") === (b.column || "") && (a.agg || "") === (b.agg || "");

  /** 組みを動かす（写しを返す）。lists = {rows, cols, vals}・from = {role, i} か {item, roles}・to = {role, index}・max = {rows, cols, vals}
      → {lists, msg}（動かなければ lists は null・msg に理由） */
  function move(lists, from, to, max = {}) {
    const L = { rows: [...(lists.rows || [])], cols: [...(lists.cols || [])], vals: [...(lists.vals || [])] };
    const cap = (r) => max[r] ?? Infinity;
    const isDim = (r) => DIMS.includes(r);
    if (!to || !L[to.role]) return { lists: null, msg: "" };
    if (from.role) {
      if (!L[from.role] || from.i < 0 || from.i >= L[from.role].length) return { lists: null, msg: "" };
      if (isDim(from.role) !== isDim(to.role)) return { lists: null, msg: `${NAME[from.role]}の札は${NAME[to.role]}に置けません` };
      const [item] = L[from.role].splice(from.i, 1);
      let at = Math.max(0, Math.min(to.index, L[to.role].length));   // to.index は動かす札を含めた並びでの番号
      if (from.role === to.role) {
        if (to.index > from.i) at = Math.min(L[to.role].length, to.index - 1);
        if (at === from.i) return { lists: null, msg: "" };
        L[to.role].splice(at, 0, item);
        return { lists: L, msg: "" };
      }
      if (L[to.role].length >= cap(to.role)) {
        // 置いた先が満ちていたら、置いた所の札と入れ替える（Excel のピボットの並びの入れ替えと同じ考え）
        const k = Math.min(at, L[to.role].length - 1), [out] = L[to.role].splice(k, 1, item);
        L[from.role].splice(from.i, 0, out);
        return { lists: L, msg: `${NAME[to.role]}は ${cap(to.role)} つまでなので、「${out.column || ""}」と入れ替えました` };
      }
      L[to.role].splice(at, 0, item);
      return { lists: L, msg: "" };
    }
    // カラムの札から
    const item = from.item, roles = from.roles || [];
    if (!roles.includes(to.role)) return { lists: null, msg: `このカラムは${NAME[to.role]}に置けません` };
    if (isDim(to.role)) {
      let was = -1, wasRole = "";
      for (const r of DIMS) { const k = L[r].findIndex((x) => x.column === item.column); if (k >= 0) { was = k; wasRole = r; } }
      if (wasRole === to.role) return move(lists, { role: to.role, i: was }, to, max);
      if (wasRole) L[wasRole].splice(was, 1);
      if (cap(to.role) === 1 && L[to.role].length) { L[to.role] = [item]; return { lists: L, msg: "" }; }   // 1 つだけ置ける所は置き換える
      if (L[to.role].length >= cap(to.role)) return { lists: null, msg: `${NAME[to.role]}の段は ${cap(to.role)} つまでです（札を外すか、置いた札と入れ替えるには札どうしを引いてください）` };
      L[to.role].splice(Math.min(to.index, L[to.role].length), 0, item);
      return { lists: L, msg: "" };
    }
    const k = L.vals.findIndex((x) => same(x, item));
    if (k >= 0) return move(lists, { role: "vals", i: k }, to, max);
    if (cap("vals") === 1 && L.vals.length) { L.vals = [item]; return { lists: L, msg: "" }; }
    if (L.vals.length >= cap("vals")) return { lists: null, msg: `値は ${cap("vals")} つまでです` };
    L.vals.splice(Math.min(to.index, L.vals.length), 0, item);
    return { lists: L, msg: "" };
  }
  /** 外す（カラムの欄へ戻した・Delete）。値が空になるときは、呼ぶ側が既定の値を入れる */
  function remove(lists, from) {
    const L = { rows: [...(lists.rows || [])], cols: [...(lists.cols || [])], vals: [...(lists.vals || [])] };
    if (!L[from.role] || !L[from.role][from.i]) return null;
    L[from.role].splice(from.i, 1);
    return L;
  }

  /* ---------------- 画面（root の中の札を引けるようにする。root は描き直しても同じ要素） ----------------
     opt: lists() → いまの {rows, cols, vals}・max・itemOf(列の名前, 役) → 足す物・commit(lists, msg)・canDrag(役, i)・canDrop(役)・toast(字) */
  function attach(root, opt) {
    if (!root || root._pvDnd) { if (root) root._pvDnd = opt; return; }
    root._pvDnd = opt;
    let drag = null;
    const o = () => root._pvDnd;
    const slots = () => [...root.querySelectorAll(".pv-slot[data-role]")].filter((s) => !o().canDrop || o().canDrop(s.dataset.role));
    root.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("select,input,button:not(.pv-r),textarea,a")) return;
      const s = sourceOf(root, e.target);
      if (!s || (s.from.role && o().canDrag && !o().canDrag(s.from.role, s.from.i))) return;
      drag = { ...s, x: e.clientX, y: e.clientY, on: false, id: e.pointerId };
    });
    window.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.on) { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return; startDrag(root, drag); }
      e.preventDefault(); overAt(root, drag, e, slots());
    });
    const end = (e, cancel) => {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      const d = drag; drag = null;
      if (!d.on) return;
      if (d.ghost) d.ghost.remove();
      // 引いた後のクリック（札の［行］ボタンなど）は効かせない（引いただけで足し外しが起きない）
      const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener("click", stop, { capture: true, once: true }); setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
      clearDnd(root);
      if (!cancel) dropOn(o(), d);
    };
    window.addEventListener("pointerup", (e) => end(e, false));
    window.addEventListener("pointercancel", (e) => end(e, true));
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && drag && drag.on) { e.stopPropagation(); if (drag.ghost) drag.ghost.remove(); clearDnd(root); drag = null; } }, true);
    root.addEventListener("keydown", (e) => keyMove(root, o(), e));
  }
  /** 押した所から引く物（枠の中の札・カラムの欄の札）→ {el, from} か null */
  function sourceOf(root, el) {
    const chip = el.closest(".pv-chip[data-dnd-role]");
    if (chip && root.contains(chip)) return { el: chip, from: { role: chip.dataset.dndRole, i: +chip.dataset.dndI } };
    const f = el.closest(".pv-f[data-dnd-col]");
    if (f && root.contains(f)) { const roles = (f.dataset.dndRoles || "").split(" ").filter(Boolean); return roles.length ? { el: f, from: { col: f.dataset.dndCol, roles } } : null; }
    return null;
  }
  /** 枠の中の差し込む番号（札の真ん中より左なら前）。札が 2 段に折れていても、同じ段の札だけを比べる */
  function indexIn(slot, x, y) {
    const chips = [...slot.querySelectorAll(":scope > .pv-chip")].filter((c) => !c.classList.contains("is-dragging"));
    const all = [...slot.querySelectorAll(":scope > .pv-chip")];
    let k = all.length;
    for (const c of chips) {
      const b = c.getBoundingClientRect();
      if (y < b.top - 4) { k = all.indexOf(c); break; }
      if (y <= b.bottom + 4 && x < b.left + b.width / 2) { k = all.indexOf(c); break; }
    }
    return { k, chips: all };
  }
  /** 差し込む線。場所を取らない（枠の上に重ねて描く）: 場所を取ると、線が出るたびに後ろの札・枠がずれて、狙った所が動く */
  function insLine(slot, k, chips) {
    const ins = document.createElement("i"); ins.className = "pv-ins"; ins.setAttribute("aria-hidden", "true");
    const ref = chips[k], prev = chips[k - 1] || null;
    let x, top, h;
    if (ref) { x = ref.offsetLeft - 3; top = ref.offsetTop; h = ref.offsetHeight; }
    else if (prev) { x = prev.offsetLeft + prev.offsetWidth + 1; top = prev.offsetTop; h = prev.offsetHeight; }
    else { x = 4; top = 3; h = Math.max(20, slot.clientHeight - 6); }
    Object.assign(ins.style, { left: `${Math.max(1, x)}px`, top: `${top}px`, height: `${h}px` });
    slot.append(ins);
  }
  function clearDnd(root) {
    root.querySelectorAll(".pv-ins").forEach((x) => x.remove());
    root.querySelectorAll(".is-drop-ok,.is-drop-on,.is-drop-no,.is-dragging,.is-trash-on").forEach((x) => x.classList.remove("is-drop-ok", "is-drop-on", "is-drop-no", "is-dragging", "is-trash-on"));
    root.classList.remove("is-dnd");
    document.body.classList.remove("pv-dnd-body");
  }
  const roleOk = (src, role) => (src.from.role ? DIMS.includes(src.from.role) === DIMS.includes(role) : src.from.roles.includes(role));
  /** 引き始め: 引いている印と、手に付いてくる札の写し */
  function startDrag(root, d) {
    d.on = true;
    root.classList.add("is-dnd"); document.body.classList.add("pv-dnd-body");
    d.el.classList.add("is-dragging");
    const g = d.el.classList.contains("pv-chip") ? d.el.cloneNode(true) : Object.assign(document.createElement("span"), { className: "pv-chip pv-fghost", textContent: (d.el.querySelector("b") || d.el).textContent.trim() });
    g.classList.add("pv-ghost"); g.classList.remove("is-dragging"); g.removeAttribute("id");
    g.querySelectorAll("select,button").forEach((x) => x.remove());
    document.body.append(g); d.ghost = g;
  }
  /** 引いている間: 置ける枠の印・差し込む線・置く先（d.to・d.trash）を今のマウスの所で決め直す */
  function overAt(root, d, e, slots) {
    d.ghost.style.setProperty("--gx", `${e.clientX + 10}px`); d.ghost.style.setProperty("--gy", `${e.clientY + 8}px`);
    root.querySelectorAll(".is-drop-on,.is-trash-on").forEach((x) => x.classList.remove("is-drop-on", "is-trash-on"));
    root.querySelectorAll(".pv-ins").forEach((x) => x.remove());
    // 印は動くたびに今の枠へ付け直す（引いている間に答えが届いて文が描き直っても、置ける所が消えない）
    const allowed = new Set(slots.map((s) => s.dataset.role).filter((r) => roleOk(d, r)));
    root.querySelectorAll(".pv-slot[data-role]").forEach((s) => { s.classList.toggle("is-drop-ok", allowed.has(s.dataset.role)); s.classList.toggle("is-drop-no", !allowed.has(s.dataset.role)); });
    const src = root.querySelector(d.from.role ? `.pv-chip[data-dnd-role="${d.from.role}"][data-dnd-i="${d.from.i}"]` : `.pv-f[data-dnd-col="${CSS.escape(d.from.col)}"]`);
    if (src) src.classList.add("is-dragging");
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const slot = hit && hit.closest(".pv-slot[data-role]");
    d.to = null; d.trash = false;
    if (slot && root.contains(slot) && allowed.has(slot.dataset.role)) {
      const { k, chips } = indexIn(slot, e.clientX, e.clientY);
      slot.classList.add("is-drop-on"); insLine(slot, k, chips);
      d.to = { role: slot.dataset.role, index: k };
    } else if (d.from.role && hit && hit.closest("[data-dnd-trash]") && root.contains(hit.closest("[data-dnd-trash]"))) {
      d.trash = true; hit.closest("[data-dnd-trash]").classList.add("is-trash-on");
    }
  }
  function dropOn(O, d) {
    if (d.trash) { const L = remove(O.lists(), d.from); if (L) O.commit(L, ""); return; }
    if (!d.to) return;
    const from = d.from.role ? d.from : { item: O.itemOf(d.from.col, d.to.role), roles: d.from.roles };
    if (!from.role && !from.item) return;
    const r = move(O.lists(), from, d.to, O.max || {});
    if (r.lists) O.commit(r.lists, r.msg); else if (r.msg && O.toast) O.toast(r.msg);
  }
  /** キーボード: 札に焦点があるときの Alt＋矢印・Delete */
  function keyMove(root, O, e) {
    const chip = e.target.closest && e.target.closest(".pv-chip[data-dnd-role]");
    if (!chip || e.target !== chip) return;
    const role = chip.dataset.dndRole, i = +chip.dataset.dndI;
    if (O.canDrag && !O.canDrag(role, i)) return;
    let r = null;
    if (e.key === "Delete" || e.key === "Backspace") { const L = remove(O.lists(), { role, i }); if (L) { e.preventDefault(); O.commit(L, ""); refocus(root, role, Math.max(0, i - 1)); } return; }
    if (!e.altKey) return;
    if (e.key === "ArrowLeft" && i > 0) r = [move(O.lists(), { role, i }, { role, index: i - 1 }, O.max), role, i - 1];
    else if (e.key === "ArrowRight") r = [move(O.lists(), { role, i }, { role, index: i + 2 }, O.max), role, i + 1];
    else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && DIMS.includes(role)) {
      const to = role === "rows" ? "cols" : "rows";
      if (O.canDrop && !O.canDrop(to)) return;
      const n = (O.lists()[to] || []).length;
      r = [move(O.lists(), { role, i }, { role: to, index: n }, O.max), to, n];
    }
    if (!r) return;
    e.preventDefault();
    if (r[0].lists) { O.commit(r[0].lists, r[0].msg); refocus(root, r[1], Math.min(r[2], r[0].lists[r[1]].length - 1)); } else if (r[0].msg && O.toast) O.toast(r[0].msg);
  }
  /** 動かした札へ焦点を戻す。組んだ後に答えを読み直すと文が何度か描き直るので、1.5 秒の間は描き直るたびに戻す
      （ほかの所を押して焦点が移ったら、やめる） */
  function refocus(root, role, i) {
    const sel = `.pv-chip[data-dnd-role="${role}"][data-dnd-i="${i}"]`, until = Date.now() + 1500;
    const put = () => { const c = root.querySelector(sel), a = document.activeElement; if (c && a !== c && (!a || a === document.body || !root.contains(a) || a.matches(".pv-chip"))) c.focus(); };
    const mo = new MutationObserver(function(){ if (Date.now() > until) { mo.disconnect(); return; } put(); });
    mo.observe(root, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 1600);
    requestAnimationFrame(put);
  }
  /** 札に付ける属性（引ける・焦点が当たる・読み上げの説明） */
  const chipAttrs = (role, i, on = true) => (on ? ` data-dnd-role="${role}" data-dnd-i="${i}" tabindex="0" aria-roledescription="引いて動かせる札" aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight${role === "vals" ? "" : " Alt+ArrowUp Alt+ArrowDown"} Delete"` : "");
  /** カラムの札に付ける属性（置ける役） */
  const fieldAttrs = (col, roles) => ` data-dnd-col="${String(col).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" data-dnd-roles="${roles.join(" ")}"`;
  WL.pivotDnd = { move, remove, attach, chipAttrs, fieldAttrs };
})();
