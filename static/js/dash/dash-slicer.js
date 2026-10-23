/* =========================================================================
   ダッシュボードのスライサー（版 3.41.0。利用者の要望 6: 今月と先月など、時間や設備を切り替えて表示を簡単に入れ替える）
   - 期間: 組んだまま・今日・前日・直近 7 日・今月・先月 の札と、月を送る ◀ ▶（n か月前。サーバーの期間 month）
   - 設備: 設備グループの札（すべて・CR ライン・L ライン…。押すとそのグループの設備だけ）と、「設備…」の面（グループの見出しの下に設備のチェック）
   - 当て方（どのパネルに効くか）は dashboard-filter.js の slice。状態はこの PC の見え方（dashboard.js がダッシュボードごとに覚える）
   - 版 3.52.0（利用者の要望 2026-10-23。2026-10-dslicer の 2 回目で決めた G）: 日付の札（札の真下の暦。始めと終わりの日を押すと当たる）・
     帯の右端の「スライサー ▾」の面（帯を出す／出さない・出す物〈期間・日付・設備〉・パネルのスライサーを足す）・パネルのスライサー（slicerPanel）
   ここは字（HTML）を作るだけ。押した物の読み取りと覚えは dashboard.js
   ========================================================================= */
(function(){
  "use strict";
  const { esc } = WL.dashKit;
  const PERIODS = [["", "組んだまま", "パネルごとに組んだ期間で数えます"], ["today", "今日"], ["yesterday", "前日"], ["days", "直近 7 日"], ["this_month", "今月"], ["last_month", "先月"]];
  const NONE = "（グループなし）";

  /** いまの期間が今月から何か月前か（今月 0・先月 1・n か月前 n。月でなければ null） */
  const backOf = (per) => (!per || !per.kind ? null : per.kind === "this_month" ? 0 : per.kind === "last_month" ? 1 : per.kind === "month" ? per.n || 1 : null);
  /** n か月前 → 期間 */
  const periodBack = (k) => (k <= 0 ? { kind: "this_month" } : k === 1 ? { kind: "last_month" } : { kind: "month", n: k });
  /** n か月前の月の名前（today は答えの「いま」。'YYYY-MM-DD'） */
  function monthName(k, today) {
    const d = /^(\d{4})-(\d{2})/.exec(today || "") || [0, new Date().getFullYear(), new Date().getMonth() + 1];
    const t = +d[1] * 12 + (+d[2] - 1) - k, y = Math.floor(t / 12), m = (t % 12) + 1;
    return y === +d[1] ? `${m}月` : `${y}年${m}月`;
  }
  /** まとめ方の設備グループ（重なる設備は先のグループ）と、どこにも入らない設備 → [{name, members}] */
  function groupsOf(tree, set) {
    const st = (tree.sets || []).find((x) => x.name === set) || (tree.sets || [])[0];
    if (!st) return [];
    const used = new Set(), out = st.groups.map((g) => ({ name: g.name, members: g.members.filter((n) => !used.has(n) && used.add(n)) })).filter((g) => g.members.length);
    const rest = (tree.names || []).filter((n) => !used.has(n));
    return rest.length ? out.concat([{ name: NONE, members: rest, none: true }]) : out;
  }
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

  const md = (d) => (d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : "");
  /** 日付で決めた期間の短い字（10/5〜10/20・1 日だけなら 10/20） */
  const rangeWord = (per) => (per.from === per.to || !per.to ? md(per.from) : `${md(per.from)}〜${md(per.to)}`);
  const PART_KEYS = ["period", "date", "equip"];
  /** 日付の札（暦を開く）。日付で決めていれば「日付 10/5〜10/20」 */
  const dateChip = (per, info) => { const on = per.kind === "range";
    return `<button type="button" class="dsl-chip dsl-date${on ? " on" : ""}" data-ds-date aria-haspopup="dialog" aria-expanded="${!!info.dateOpen}" aria-pressed="${on}" title="日・期間を暦で選びます（始めの日と終わりの日を押す）">${on ? `日付 ${esc(rangeWord(per))}` : "日付…"}</button>`; };
  /** 帯の右端の「スライサー ▾」（帯を出す／出さない・出す物・パネルのスライサー）。off … 帯を出していない */
  const cfgBtn = (info, off = false) => `<button type="button" class="dsl-cfg${off ? " is-off" : ""}" data-ds-cfg aria-haspopup="dialog" aria-expanded="${!!info.cfgOpen}" title="帯のスライサーを出す・出さない／出す物（期間・日付・設備）／列の値で絞るパネルを足す">${off ? "スライサー OFF" : "スライサー"}<i aria-hidden="true">▾</i></button>`;

  /** 道具の行に入れるスライサー。sl … いまの状態 {period, equips, set}・info = {tree, today, hits: 効くパネルの数, total, open, parts: 出す物} */
  function barHtml(sl, info) {
    const s = sl || {}, per = s.period || {}, eq = s.equips || [], k = backOf(per), parts = info.parts || PART_KEYS;
    const chips = PERIODS.map(([kind, n, tip]) => {
      const on = (per.kind || "") === kind && (kind !== "days" || (per.n || 7) === 7);
      return `<button type="button" class="dsl-chip${on ? " on" : ""}" data-ds-period="${kind}" aria-pressed="${on}"${tip ? ` title="${esc(tip)}"` : ""}>${n}</button>`;
    }).join("");
    const month = `<span class="dsl-month${k != null && k > 1 ? " on" : ""}" role="group" aria-label="月を送る">`
      + `<button type="button" class="dsl-step" data-ds-back="1" title="前の月へ（${esc(monthName((k ?? 0) + 1, info.today))}）" aria-label="前の月へ">◀</button>`
      + `<b title="${k == null ? "月で見るときは ◀ で前の月へ" : esc(monthName(k, info.today))}">${k == null ? "月" : esc(monthName(k, info.today))}</b>`
      + `<button type="button" class="dsl-step" data-ds-back="-1"${k == null || k <= 0 ? " disabled" : ""} title="次の月へ" aria-label="次の月へ">▶</button></span>`;
    const gs = groupsOf(info.tree || {}, s.set).filter((g) => !g.none);
    const gchips = `<button type="button" class="dsl-chip${eq.length ? "" : " on"}" data-ds-all aria-pressed="${!eq.length}" title="すべての設備">すべて</button>`
      + gs.map((g) => { const on = eq.length > 0 && same(eq, g.members); return `<button type="button" class="dsl-chip${on ? " on" : ""}" data-ds-group="${esc(g.name)}" aria-pressed="${on}" title="${esc(g.name)}: ${esc(g.members.join("・"))}">${esc(g.name)}</button>`; }).join("");
    const custom = eq.length && !gs.some((g) => same(eq, g.members));
    const pick = `<button type="button" class="dsl-chip dsl-pick${custom ? " on" : ""}" data-ds-pick aria-haspopup="dialog" aria-expanded="${!!info.open}" title="設備を 1 台ずつ選びます（設備グループの見出しで、まとめて選べます）">${custom ? `設備 ${eq.length}` : "設備…"}<i aria-hidden="true">▾</i></button>`;
    const active = !!(per.kind || eq.length);
    const state = active ? `<small class="dsl-hits" title="スライサーが効いているパネルの数（期間を組んでいないパネル・設備を見分けられないパネル・「スライサーに従わない」パネルには効きません）">${info.hits} / ${info.total} 枚に効いています</small>`
      + `<button type="button" class="dsl-clear" data-ds-clear title="スライサーを外して、組んだままに戻します">× 外す</button>` : "";
    const time = [parts.includes("period") ? `<span class="dsl-chips">${chips}</span>${month}` : "", parts.includes("date") ? dateChip(per, info) : ""].filter(Boolean).join("");
    const segs = [time ? `<span class="dsl-l">期間</span>${time}` : "", parts.includes("equip") ? `<span class="dsl-l">設備</span><span class="dsl-chips">${gchips}${pick}</span>` : ""].filter(Boolean);
    return `<div class="dsl-bar${active ? " is-on" : ""}" role="group" aria-label="スライサー">${segs.join('<span class="dsl-sep" aria-hidden="true"></span>') || '<span class="dsl-l is-none">出す物がありません（スライサー ▾ で選びます）</span>'}${state}${cfgBtn(info)}</div>`;
  }

  /** 詰めた形（道具の行に入り切らないとき。1280 など）: 期間・設備を選ぶ欄（select）にし、月の ◀ ▶ と「外す」は残す */
  function compactHtml(sl, info) {
    const s = sl || {}, per = s.period || {}, eq = s.equips || [], k = backOf(per), parts = info.parts || PART_KEYS;
    const pv = per.kind === "month" ? `month:${per.n}` : per.kind === "days" && (per.n || 7) !== 7 ? "" : per.kind || "";
    const popt = PERIODS.map(([kind, n]) => `<option value="${kind}"${pv === kind ? " selected" : ""}>${n}</option>`).join("")
      + (per.kind === "month" ? `<option value="month:${per.n}" selected>${esc(monthName(k, info.today))}</option>` : "");
    const gs = groupsOf(info.tree || {}, s.set).filter((g) => !g.none), gon = gs.find((g) => eq.length && same(eq, g.members));
    const gopt = `<option value=""${eq.length ? "" : " selected"}>すべて</option>${gs.map((g) => `<option value="${esc(g.name)}"${gon === g ? " selected" : ""}>${esc(g.name)}</option>`).join("")}`
      + (eq.length && !gon ? `<option value="@custom" selected>設備 ${eq.length}</option>` : "") + `<option value="@pick">設備を選ぶ…</option>`;
    const active = !!(per.kind || eq.length);
    const rng = per.kind === "range" ? `<option value="@range" selected>${esc(rangeWord(per))}</option>` : "";
    return `<div class="dsl-bar is-compact${active ? " is-on" : ""}" role="group" aria-label="スライサー">`
      + (parts.includes("period") ? `<label class="dsl-l">期間<select data-ds-psel aria-label="期間">${popt}${rng}</select></label>`
        + `<span class="dsl-month${k != null && k > 1 ? " on" : ""}" role="group" aria-label="月を送る"><button type="button" class="dsl-step" data-ds-back="1" aria-label="前の月へ" title="前の月へ">◀</button>`
        + `<button type="button" class="dsl-step" data-ds-back="-1"${k == null || k <= 0 ? " disabled" : ""} aria-label="次の月へ" title="次の月へ">▶</button></span>` : "")
      + (parts.includes("date") ? dateChip(per, info) : "")
      + (parts.includes("equip") ? `<label class="dsl-l">設備<select data-ds-gsel aria-label="設備">${gopt}</select></label><button type="button" class="dsl-pickhold" data-ds-pick hidden aria-hidden="true" tabindex="-1"></button>` : "")
      + (active ? `<small class="dsl-hits" title="スライサーが効いているパネルの数">${info.hits} / ${info.total} 枚</small><button type="button" class="dsl-clear" data-ds-clear title="スライサーを外して、組んだままに戻します">× 外す</button>` : "") + cfgBtn(info) + "</div>";
  }

  /* ---- 日付の暦（版 3.52.0）: 札の真下に開く。始めの日・終わりの日の順に押すと当たる（1 日だけは同じ日を 2 回）。打つ欄（から・まで）でも ---- */
  const ymd = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  /** cal = {month: 'YYYY-MM', from: 押した始めの日（終わりを待っている）}・per … いまの期間・today */
  function calHtml(cal, per, today) {
    const [y, m] = cal.month.split("-").map(Number), first = new Date(y, m - 1, 1).getDay(), n = new Date(y, m, 0).getDate();
    const a = cal.from || (per.kind === "range" ? per.from : ""), b = cal.from ? "" : per.kind === "range" ? per.to || per.from : "";
    const cells = Array.from({ length: n }, (_, i) => {
      const d = ymd(y, m, i + 1), end = d === a || d === b, inr = a && b && d > a && d < b;
      return `<button type="button" class="dsl-day${end ? " is-end" : inr ? " is-in" : ""}${d === today ? " is-today" : ""}" data-ds-day="${d}" aria-pressed="${end || !!inr}" aria-label="${m}月${i + 1}日">${i + 1}</button>`;
    }).join("");
    const head = `<div class="dsl-calh"><button type="button" class="dsl-step" data-ds-calm="-1" aria-label="前の月">◀</button><b>${y}年${m}月</b><button type="button" class="dsl-step" data-ds-calm="1" aria-label="次の月">▶</button></div>`;
    const wk = "日月火水木金土".split("").map((w) => `<i>${w}</i>`).join("");
    const say = cal.from ? `始めの日 ${md(cal.from)}。終わりの日を押してください（同じ日なら 1 日だけ）` : "始めの日と終わりの日を押すと当たります（1 日だけは同じ日を 2 回）";
    return `<div class="dash-pophead"><b>日付で絞る</b><small>期間を組んだパネルを、選んだ日付で数えます</small></div>${head}`
      + `<div class="dsl-cal" role="grid">${wk}${'<span aria-hidden="true"></span>'.repeat(first)}${cells}</div><p class="dsl-calsay" aria-live="polite">${esc(say)}</p>`
      + `<div class="dsl-calin"><label>から<input type="date" data-ds-from value="${esc(a || "")}"></label><span>〜</span><label>まで<input type="date" data-ds-to value="${esc(b || a || "")}"></label></div>`
      + `<div class="dash-popacts">${per.kind === "range" ? '<button type="button" class="dfl-link" data-ds-dateclear>日付を外す</button>' : ""}<span class="dash-sp"></span><button type="button" class="mm-btn-ghost" data-ds-done>閉じる</button></div>`;
  }

  /* ---- 「スライサー ▾」の面（版 3.52.0）: 帯を出す／出さない・出す物・パネルのスライサーを足す。
     edit … 編集中（変えた所はダッシュボードに入り、保存すると全員に効く）。見ているときは、この PC の見え方 ---- */
  function cfgHtml(cfg, info) {
    const parts = cfg.parts || PART_KEYS, on = !cfg.off;
    const names = { period: ["期間", "組んだまま・今日・前日・直近 7 日・今月・先月・月の ◀ ▶"], date: ["日付", "暦で日・期間を選ぶ"], equip: ["設備", "設備グループの札・設備…"] };
    const part = (k) => `<label class="dsl-part${on ? "" : " is-dim"}"><input type="checkbox" data-ds-part="${k}"${parts.includes(k) ? " checked" : ""}${on ? "" : " disabled"}><b>${names[k][0]}</b><small>${names[k][1]}</small></label>`;
    const n = info.slicers || 0;
    return `<div class="dash-pophead"><b>スライサー</b><small>${info.edit ? "編集中: 変えた所はこのダッシュボードに入ります（保存すると全員に効きます）" : "この PC の見え方です（全員の分は編集で）"}</small></div>`
      + `<label class="dsl-swrow"><span><b>帯のスライサー</b><small>${on ? "道具の行の下に出しています" : "出していません（パネルにも効きません）"}</small></span><input type="checkbox" role="switch" class="dsl-switch" data-ds-on${on ? " checked" : ""} aria-label="帯のスライサーを出す"></label>`
      + `<div class="dsl-ph">出す物</div>${PART_KEYS.map(part).join("")}`
      + `<div class="dsl-ph">パネルのスライサー<small>${n ? `${n} 枚あります` : "まだありません"}</small></div>`
      + `<p class="dsl-pnote">列の値（仕掛区分・品種など）の札を並べたパネル。押した値で、同じデータのほかのパネルを絞ります。</p>`
      + `<button type="button" class="dsl-addp" data-ds-addpanel>＋ 列の値で絞るパネルを足す…</button>`
      + `<div class="dash-popacts"><span class="dash-sp"></span><button type="button" class="mm-btn-ghost" data-ds-done>閉じる</button></div>`;   // 主のボタン（橙）は道具の行の「編集」1 つ（作った後の採点）
  }
  /** 「設備…」の面: 設備グループの見出しの下に設備のチェック（見出しのチェックでグループをまとめて） */
  function pickHtml(sl, info) {
    const s = sl || {}, eq = new Set(s.equips || []), tree = info.tree || {};
    if (!tree.names) return '<p class="dfl-none">設備を数えています…</p>';
    const sets = (tree.sets || []).map((x) => x.name);
    const head = `<div class="dash-pophead"><b>設備で絞る</b><small>選んだ設備だけを数えます（どれも選ばなければ、すべての設備）</small></div>`
      + (sets.length > 1 ? `<label class="dash-field">まとめ方<select data-ds-set>${sets.map((n) => `<option${n === (s.set || sets[0]) ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>` : "");
    const gs = groupsOf(tree, s.set);
    const list = (gs.length ? gs : [{ name: "", members: tree.names }]).map((g) => {
      const n = g.members.filter((m) => eq.has(m)).length, all = n === g.members.length && n > 0;
      const gh = g.name ? `<label class="dsl-gh"><input type="checkbox" data-ds-gck="${esc(g.name)}"${all ? " checked" : ""}${n && !all ? " data-mixed" : ""}><b>${esc(g.name)}</b><small>${n ? `${n} / ` : ""}${g.members.length} 台</small></label>` : "";
      return `<div class="dsl-g${g.name ? "" : " is-flat"}">${gh}<div class="dsl-ms">${g.members.map((m) => `<label class="dsl-m"><input type="checkbox" data-ds-eq="${esc(m)}"${eq.has(m) ? " checked" : ""}>${esc(m)}</label>`).join("")}</div></div>`;
    }).join("");
    return `${head}<div class="dsl-list">${list}</div><div class="dash-popacts"><button type="button" class="dfl-link" data-ds-all>すべての設備に戻す</button><span class="dash-sp"></span><button type="button" class="mm-btn-primary" data-ds-done>閉じる</button></div>`;
  }
  /** チェックの途中（グループの一部を選んだ）を見せる */
  const mixed = (root) => root.querySelectorAll("[data-mixed]").forEach((x) => { x.indeterminate = true; });

  WL.dashSlicer = { barHtml, compactHtml, calHtml, cfgHtml, cfgBtn, rangeWord, PART_KEYS, same, pickHtml, mixed, groupsOf, periodBack, backOf, monthName, NONE };
})();
