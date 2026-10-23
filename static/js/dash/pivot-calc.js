/* =========================================================================
   値の計算の段（版 3.50.0。利用者の要望 2026-10-22 の 2: 値の調整のための四則演算を、値ごとに）。
   集計表・グラフ（lotlist-pivot.js）とダッシュボードの組む所（dashboard-editor.js）が同じ部品・同じ言葉で使う。
   - 置き場は、文「［行］ごとに、［列］別の［値］を出す」のすぐ下の 1 段（2026-10-pvdrag の 1 回目で決めた C）:
       値の計算 ｜ 重量の合計 [÷1000] 1,186,104 → 1,186.1 [÷1000][×100][÷60] ｜ ロット数 [例: ÷1000] …
   - 式の読み方は num-format.js の expr（サーバーの services/num_expr.py と同じ答え）。計算はサーバーが値ごとに、表し方（割合・累計）の前に当てる
   - 桁（版 3.50.1。2026-10-pvdec の 2 回目で決めた C2）: 値ごとの「小数」の札（自動・整数・1桁・2桁・3桁。選んだ札は濃い灰）。値は丸めず、見せる字だけ。
     段の幅が足りないとき（ダッシュボードの組む所など）は「小数」と札を次の行へ。札も入らないほど狭い所だけ、よく使う計算を「よく使う ▾」1 つに畳む
   - 変わり方（いまの数 → 計算した数）: 計算の無い答えの総計を値ごとに覚えておき（remember）、式を当てると、その数に式を当てて見せる。
     覚えが無ければ（開き直した直後など）、計算した後の総計だけを見せる
   ========================================================================= */
(function(){
  "use strict";
  const { esc } = WL.dashKit;
  const N = () => WL.numFormat;
  const QUICK = ["÷1000", "×100", "÷60"];
  const DECS = [[null, "自動", "数に合わせて書きます"], [0, "整数", "小数を書きません"], [1, "1桁", "小数 1 桁（例 972.4）"], [2, "2桁", "小数 2 桁（例 972.37）"], [3, "3桁", "小数 3 桁（例 972.365）"]];
  const raws = new Map();          // 値の鍵（計算を除いた形）→ 計算の無い総計
  // 値の鍵は中身（集計・列・決める数）だけ。サーバーの答えの値は名前など余分な物を持つので、形をそろえる
  const keyOf = (m) => [m.agg || "", m.column || "", m.p ?? "", m.lsl ?? "", m.usl ?? ""].join("\u001f");
  const grandOf = (d, j) => { const c = d && d.cells && d.cells.find((x) => !x.r.length && !x.c.length); return c && typeof c.v[j] === "number" ? c.v[j] : null; };
  /** 答えを見て、計算の無い値の総計を覚える（表し方〈割合など〉の付いた値は覚えない） */
  function remember(d, measures) {
    (measures || []).forEach((m, j) => { if (!m.expr && !m.show) { const v = grandOf(d, j); if (v != null) raws.set(keyOf(m), v); } });
  }
  /** 変わり方の字（HTML）。num(v, m) → 数の字（値の桁〈dec〉で書く） */
  function prevHtml(m, j, d, num) {
    if (!m.expr) return "";
    const ex = N() ? N().expr(m.expr) : { fn: null };
    const raw = m.show ? null : raws.get(keyOf(m));
    if (raw != null && ex.fn) { const to = ex.fn(raw); return `<span class="pvc-prev" title="総計: 計算の前 → 後">${esc(num(raw, { ...m, dec: undefined }))}<i aria-hidden="true">→</i>${to == null ? "–" : esc(num(to, m))}</span>`; }
    const after = grandOf(d, j);
    return after != null ? `<span class="pvc-prev" title="計算した後の総計">計 ${esc(num(after, m))}</span>` : "";
  }
  /** 段の HTML。opt: name(m) 値の名前・answer 答え・num(v, m) 数の字 */
  function html(measures, opt) {
    const ms = measures || [];
    if (!ms.length) return "";
    const one = (m, j) => {
      const ex = m.expr && N() ? N().expr(m.expr) : { error: "" };
      return `<span class="pvc-item" data-pc-i="${j}"><span class="pvc-name">${esc(opt.name(m))}</span>`
        + `<input class="pvc-in${ex.error ? " is-bad" : ""}" data-pc-in="${j}" value="${esc(m.expr || "")}" maxlength="60" spellcheck="false" autocomplete="off" placeholder="例: ÷1000" aria-label="「${esc(opt.name(m))}」の計算（四則演算）">`
        + `<span class="pvc-out" data-pc-out="${j}">${ex.error ? `<em class="pvc-bad">${esc(ex.error)}</em>` : prevHtml(m, j, opt.answer, opt.num)}</span>`
        + `<span class="pvc-qs">${QUICK.map((q) => `<button type="button" class="pvc-q${cur(m) === q ? " on" : ""}" data-pc-q="${esc(q)}" data-pc-qi="${j}" title="「${esc(opt.name(m))}」を ${q} にする（もう一度押すと外す）">${q}</button>`).join("")}</span>`
        // 狭い所の畳んだ形（CSS の @container で、札の代わりに出す）。当てている計算は選んだ字で見える
        + `<select class="pvc-more" data-pc-qsel="${j}" aria-label="「${esc(opt.name(m))}」のよく使う計算" title="よく使う計算">`
        + `<option value="">${QUICK.includes(cur(m)) ? "計算なしにする" : "よく使う"}</option>${QUICK.map((q) => `<option value="${esc(q)}"${cur(m) === q ? " selected" : ""}>${q}</option>`).join("")}</select>`
        + `<span class="pvc-dg"><span class="pvc-div" aria-hidden="true"></span><span class="pvc-l">小数</span>`
        + `<span class="pvc-dec" role="radiogroup" aria-label="「${esc(opt.name(m))}」の小数の桁">${DECS.map(([k, t, tip]) => { const on = (m.dec ?? null) === k;
          return `<button type="button" role="radio" aria-checked="${on}" class="${on ? "on" : ""}" data-pc-dec="${k ?? ""}" data-pc-di="${j}" title="${tip}">${t}</button>`; }).join("")}</span></span></span>`;
    };
    return `<div class="pvc-band" role="group" aria-label="値の計算"><b class="pvc-cap" title="値ごとに四則演算を当てます（÷1000・×100・(値−10)×2 など。演算子から書くと前に値が入ります）。表・グラフ・Excel の数が変わります">値の計算</b>`
      + ms.map(one).join("") + "</div>";
  }
  const cur = (m) => (m.expr || "").replace(/\s/g, "");
  /** 見張り（root は描き直しても同じ要素）。set(i, 式) → 読めなければ理由の字（入れない）。打つ間は 0.6 秒待って当てる（変換中は待つ）。
      setDec(i, 桁 か null) … 小数の札 */
  function bind(root, set, setDec) {
    root._pcDec = setDec;
    if (root._pcSet) { root._pcSet = set; return; }
    root._pcSet = set;
    const timers = new Map();
    const apply = (el) => {
      const i = +el.dataset.pcIn, err = root._pcSet(i, el.value);
      el.classList.toggle("is-bad", !!err);
      const out = root.querySelector(`[data-pc-out="${i}"]`);
      if (err && out) out.innerHTML = `<em class="pvc-bad">${esc(err)}</em>`;
    };
    WL.dashKit.onTextIn(root, "[data-pc-in]", (el) => {
      const i = el.dataset.pcIn; clearTimeout(timers.get(i));
      // 打っている途中の読めない式（「÷」だけ・「(値」など）は、すぐには責めない（待ってから知らせる）
      timers.set(i, setTimeout(() => apply(el), 600));
    });
    root.addEventListener("change", (e) => {
      const sel = e.target.closest && e.target.closest("[data-pc-qsel]");
      if (sel) { const i = +sel.dataset.pcQsel, inp = root.querySelector(`[data-pc-in="${i}"]`); if (inp) inp.value = sel.value; root._pcSet(i, sel.value); return; }
      const el = e.target.closest && e.target.closest("[data-pc-in]"); if (el) { clearTimeout(timers.get(el.dataset.pcIn)); apply(el); }
    });
    root.addEventListener("keydown", (e) => { const el = e.target.closest && e.target.closest("[data-pc-in]"); if (el && e.key === "Enter" && !WL.dashKit.composing(e)) { clearTimeout(timers.get(el.dataset.pcIn)); apply(el); } });
    root.addEventListener("click", (e) => {
      const dz = e.target.closest && e.target.closest("[data-pc-dec]");
      if (dz && root.contains(dz)) { if (root._pcDec) root._pcDec(+dz.dataset.pcDi, dz.dataset.pcDec === "" ? null : +dz.dataset.pcDec); return; }
      const b = e.target.closest && e.target.closest("[data-pc-q]"); if (!b || !root.contains(b)) return;
      const i = +b.dataset.pcQi, inp = root.querySelector(`[data-pc-in="${i}"]`);
      const v = b.classList.contains("on") ? "" : b.dataset.pcQ;
      if (inp) inp.value = v;
      root._pcSet(i, v);
    });
  }
  /** 描き直しても、打っている欄の焦点と字の位置を保つ（render を呼ぶ前後で） */
  function keepFocus(root, render) {
    const a = document.activeElement, i = a && a.matches && a.matches("[data-pc-in]") && root.contains(a) ? a.dataset.pcIn : null;
    const sel = i != null ? [a.selectionStart, a.selectionEnd, a.value] : null;
    render();
    if (i == null) return;
    const b = root.querySelector(`[data-pc-in="${i}"]`);
    if (!b) return;
    if (b.value !== sel[2]) b.value = sel[2];   // 打った字（まだ当てていない字）を残す
    b.focus(); try { b.setSelectionRange(sel[0], sel[1]); } catch (e) { WL.quiet.note("字の位置を選べない欄（焦点だけ戻す）", e); }
  }
  WL.pivotCalc = { html, bind, remember, keepFocus, QUICK, DECS };
})();
