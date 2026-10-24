/* =========================================================================
   ダッシュボードの稼働のパネル（版 3.46.0。利用者の要望 2026-10-21 の 1・2）。数はサーバー（services/operation.py・routes/dashboard.py の _ops_answer）
   - 稼働（gantt）: 選んだ設備（選ばなければすべて）を 1 枚のガントチャートに並べ、行の右に稼働率（勤務時間＝直の時間に対する稼働の割合）。
     横は期間の時間。勤務時間の外は斜線の地（稼働率の分母に入らない時間）・直の境に細い線・作業は棒（色分けの列を選べば、その値ごとの色）
   - ABC 分析と換算係数（abc）: 設備ごと（札で切り替え。全設備も）に、品種を量の大きい順に並べ、累積構成比で A・B・C に分け、
     1 本あたりの平均作業時間 ÷ 基準 ＝ 換算係数 と、換算本数を出す。広いパネルは左にパレート図（棒＝ABC の色・線＝累積構成比）
   パネルの大きさに合わせて描く（スクロールしない）。入らない設備・品種は「ほか n」と下に出す
   ========================================================================= */
(function(){
  "use strict";
  const { esc } = WL.dashKit;
  const WORK = "#5a6f77";     // 作業の棒は灰青（紺は量の棒の色・色相は設備の色。隣の表の量の棒と同じ紺にしない・§9.628 の 7 回目の採点）
  // ABC は順位なので 1 つの色（藍）の濃淡（A＝濃い → C＝淡い。字は A・B が白・C が墨）。ガントの色分けとは色を分ける（同じ色で別の意味にしない: 2026-10-ops の 1 回目の採点）
  const RANK = { A: { c: "#24446a", n: "A", f: "#fff" }, B: { c: "#4d6e96", n: "B", f: "#fff" }, C: { c: "#c3ccd5", n: "C", f: "#1b2733" } };
  /* 段は A・B・C に限らない（版 3.51.0。利用者の要望 2026-10-22）: 段の数（ranks.count）に合わせて、同じ藍の濃淡を A（濃い）→ 最後（淡い）に割り振る。
     3 段なら今までの 3 色。4 段以上は A → B の色 → C の色を 2 つの区間で等分する。字は地との差（明るさ）で白か墨 */
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
  const lum = (h) => hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const STOPS = [RANK.A.c, RANK.B.c, RANK.C.c].map(hex);
  function rankStyle(ri, count, name) {
    if (count <= 3) { const r = [RANK.A, RANK.B, RANK.C][Math.min(ri, 2)] || RANK.C; return { ...r, n: name || r.n }; }
    const t = Math.min(1, ri / (count - 1)), c = t <= 0.5 ? mix(STOPS[0], STOPS[1], t * 2) : mix(STOPS[1], STOPS[2], (t - 0.5) * 2);
    return { c, n: name, f: 1.05 / (lum(c) + 0.05) >= 4.5 ? "#fff" : "#1b2733" };
  }
  /** 答えの段の決まり（無ければ今までの A 70%・B 90%） */
  const ranksOf = (cur, o) => cur.ranks || { each: o.rankBy === "each", lims: o.lims || [o.a || 70, o.b || 90], count: o.rankBy === "each" ? (cur.items || []).length : (o.lims || [0, 0]).length + 1 };
  const qWordOf = (q) => (q === "lots" ? "本数" : q === "time" ? "負荷" : `${q}`);
  const rankName = (i) => { let s = ""; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  // ガントの棒の色分け: 白い字が 4.5 以上で読める濃さ（琥珀 #c27a1e は 3.4 で読みにくかった）。藍は ABC の色なので使わない
  const CATS = ["#9a5f12", "#0f6f63", "#5e46a8", "#4a7318", "#953f68", "#5a6f77", "#7a5410", "#2f5f7a"];
  const ms = (s) => Date.parse(String(s).replace(" ", "T"));
  const pad2 = (n) => String(n).padStart(2, "0");
  const pct = (r) => (r == null ? "–" : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`);
  // 時間の数は小数 2 桁まで（末尾の 0 は落とす）。前は 0.75 時間を「0.8」と書き、隣の稼働率 3.1%（＝0.75÷24）と合わなかった（§9.628）
  const hnum = (min) => String(Math.round((min / 60) * 100) / 100);
  const hours = (min) => `${hnum(min)} 時間`;
  const hm = (t) => { const d = new Date(t); return `${d.getHours()}:${pad2(d.getMinutes())}`; };
  const WD = "日月火水木金土";
  // 区間を出せないわけの短い言い方（行の札。版 3.47.0。サーバー services/operation.py の WHY と同じ順の言葉）。
  // 「作業終了が空」は「終了の記録なし」: 同じ行の作業中の棒（作業終了がまだ無い）と取り違えない言い方（2026-10-ops4 の 3 回目で決めた T）
  const WHY_SHORT = { "作業終了が空": "終了の記録なし", "作業終了に時刻が無い": "終了に時刻なし", "作業終了が日時と読めない": "終了が読めない",
    "作業終了が作業開始より前": "終了が開始より前", "作業開始が日時と読めない": "開始が読めない" };
  const whyShort = (why) => { const ks = Object.keys(why || {}); if (!ks.length) return ""; const w = WHY_SHORT[ks[0]] || ks[0]; return ks.length > 1 ? `${w} ほか` : w; };
  const dayText = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`; };
  /** 字の幅（px）と、幅に入る字（入らなければ「…」）。グラフと同じ測り方（lotlist-pivot-charts.js。版 3.47.0 で字の数の見積もりから替えた） */
  const textW = (s, px, weight) => WL.pivotCharts.textW(s, px, weight);
  const fitW = (s, w, px, weight) => WL.pivotCharts.fitW(s, w, px, weight);

  /* ---------------- 稼働（ガントチャート） ---------------- */
  function gantt(box, p, d, W, H) {
    // 予定と実績のガント（§9.630）: 予定も実績も無い設備は行にせず、足元で名前だけ言う（「いまの作業」と同じ事実を行ごとにくり返さない・設備が増えても行が増えない）
    const layered = (d.equips || []).some((e) => e.plans), idle = layered ? (d.equips || []).filter((e) => !e.error && !(e.ops || []).length && !(e.plans || []).length && !e.noEnd) : [];
    const eqs = (d.equips || []).filter((e) => !idle.includes(e));
    if (!eqs.length && idle.length) { box.innerHTML = `<p class="dp-empty">本日は予定も実績もありません（${esc(idle.map((e) => e.name).join("・"))}）</p>`; return ""; }
    if (!eqs.length) { box.innerHTML = '<p class="dp-empty">当たる設備がありません</p>'; return ""; }
    const r0 = d.range || [], lo = ms(`${r0[0]} 00:00:00`), hi0 = ms(`${r0[1]} 00:00:00`) + 86400000;
    // 横の範囲: 設備ごとの見る範囲（サーバーの view: 勤務時間の最初〜最後を、期間の作業の始め・終わりまで広げた物。版 3.47.0）を合わせた範囲。
    // 期間より前から続く作業・いま動いている作業は、範囲の端で切って「続く」の印を付ける（前は範囲を作業に合わせて広げ、何十時間もの作業で図が縮んだ）
    let x0 = Infinity, x1 = -Infinity;
    eqs.forEach((e) => { if (e.view) { x0 = Math.min(x0, ms(e.view[0])); x1 = Math.max(x1, ms(e.view[1])); } });
    if (!Number.isFinite(x0)) eqs.forEach((e) => { (e.windows || []).forEach((w) => { x0 = Math.min(x0, ms(w[0])); x1 = Math.max(x1, ms(w[1])); }); });
    if (!Number.isFinite(x0)) { x0 = lo; x1 = hi0; }
    const span = Math.max(3600000, x1 - x0);
    const cats = [...new Set(eqs.flatMap((e) => (e.ops || []).map((o) => o[3]).filter(Boolean)))];
    const colorOf = new Map(cats.map((c, i) => [c, CATS[i % CATS.length]]));
    const legend = cats.length > 1 || (cats.length === 1 && (p.ops || {}).color);
    // 下の凡例の高さは字の大きさから（表示サイズ「大」で 20px に入らず 2px あふれた・§9.628）
    const AX = 38, FOOT = Math.ceil((parseFloat(getComputedStyle(box).fontSize) || 12) * 1.8);
    // 行の名前の下に いまの作業（予定と実績のガント・§9.630）を書くときは、その字の幅も見る（パネルの 26% まで）
    const nowW = eqs.some((e) => e.now) ? Math.max(...eqs.map((e) => textW(nowText(e), 12))) : 0;
    const LW = Math.max(44, Math.min(Math.max(120, W * (nowW ? 0.26 : 0.2)), Math.max(nowW, ...eqs.map((e) => textW(e.name, 12.5, 700))) + 16));
    const RW = W >= 620 ? 156 : W >= 420 ? 92 : 56;
    const TW = Math.max(60, W - LW - RW - 8);
    const avail = H - AX - FOOT;
    // 行の高さは 24〜80px。棒の札（ロット番号）が読める 24px を下回るなら、入る台数だけ描いて「ほか n 台」（行を潰さない・§9.630 の 5 回目の採点: 1536 幅で棒が線になった）
    let rh = Math.min(80, Math.floor(avail / eqs.length));
    let shown = eqs;
    if (rh < 24) { rh = 24; shown = eqs.slice(0, Math.max(1, Math.floor(avail / 24))); }
    const X = (t) => LW + ((t - x0) / span) * TW;
    const g = [];
    const now = ms(d.now || "");
    const c = { LW, TW, RW, AX, rh, X, x0, x1, span, p, colorOf, top: [], vx: [], nowX: now > x0 && now < x1 ? X(now) : null };
    c.short = shortLabels(shown, X, x0, x1);   // vx … 行を縦に通る線（作業日の境目）
    const { dayKey, mainKey } = ganttAxis(g, c, eqs, d, shown.length);
    shown.forEach((e, i) => ganttRow(g, c, e, i, dayKey, mainKey));
    // いま（期間が今日を含むとき）
    if (now > x0 && now < x1) g.push(`<line class="og-now" x1="${X(now)}" x2="${X(now)}" y1="${AX - 2}" y2="${AX + shown.length * rh}"/><text class="og-nowl" x="${X(now) + 3}" y="${AX - 16}">いま</text>`);
    g.push(...c.top);
    const leg = legend ? `<span class="og-leg">${cats.slice(0, 8).map((c) => `<span><i style="background:${colorOf.get(c)}"></i>${esc(c)}</span>`).join("")}${cats.length > 8 ? `<span>ほか ${cats.length - 8}</span>` : ""}</span>` : "";
    box.innerHTML = `<div class="og-wrap"><svg class="og-svg" viewBox="0 0 ${W} ${AX + shown.length * rh + 2}" width="${W}" height="${AX + shown.length * rh + 2}" role="img" aria-label="設備の稼働のガントチャート">`
      + `<defs><pattern id="ogHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f3f4f5"/><line x1="0" y1="0" x2="0" y2="6" stroke="#dde1e4" stroke-width="2"/></pattern>`
      + `<pattern id="ogRun" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#fff" stroke-opacity=".4" stroke-width="3"/></pattern></defs>`
      + g.join("") + "</svg>"
      + `<div class="og-foot"><span class="og-key"><span><i class="og-k-on"></i>勤務時間</span>${c.offSeen ? '<span><i class="og-k-off"></i>勤務の外</span>' : ""}${c.sepSeen ? '<span><i class="og-k-sep"></i>直の境目</span>' : ""}${c.daySeen ? '<span><i class="og-k-day"></i>作業日の境目</span>' : ""}${legend ? "" : `<span${c.planSeen ? ` title="${esc(fromTip(eqs))}"` : ""}><i style="background:${WORK}"></i>${c.planSeen ? "実績" : "作業"}</span>`}${c.planSeen ? '<span title="まだ終わっていない作業・設備停止の予定開始〜予定終了（作業中は作業開始＋見積）"><i class="og-k-plan"></i>予定</span>' : ""}${c.short ? '<span title="棒の幅に全部の字が入らないので、どの棒もロット番号の下 3 桁で書いています（棒に乗せると全部出ます）">棒の字＝下 3 桁</span>' : ""}`
      + `${eqs.some((e) => (e.ops || []).some((o) => o[5] === "r")) ? '<span title="作業終了がまだ無い、いちばん新しい作業（いままでの区間）"><i class="og-k-run"></i>作業中</span>' : ""}</span>${leg}</div></div>`;
    const more = eqs.length - shown.length;
    // 予定も実績も無い設備は、行の名前の下に いまの作業 を書くときだけここで言う（書かない＝同じダッシュボードの「いまの作業」が全設備を言う。2か所に出さない・§9.630 の 7 回目）
    const idleTxt = idle.length && (p.ops || {}).nowRow !== false ? `予定も実績も無い設備: ${idle.map((e) => e.name).join("・")}` : "";
    return [more > 0 ? `ほか ${more} 台（パネルを高くすると出ます）` : "", idleTxt].filter(Boolean).join("　");
  }
  /** 実績の棒の出どころ（測定データ・手入力・実績データ〈取り込み〉…）ごとの本数 → 凡例の説明の字 */
  function fromTip(eqs) {
    const by = {};
    eqs.forEach((e) => Object.entries(e.from || {}).forEach(([k, n]) => { by[k] = (by[k] || 0) + n; }));
    const t = Object.entries(by).sort((u, v) => v[1] - u[1]).map(([k, n]) => `${k} ${n} 本`).join("・");
    return `実績の作業開始〜作業終了（作業スケジュールの行の実績）${t ? `: ${t}` : ""}`;
  }
  /** ガントの横の目盛り（時刻・作業日の区切りと日付の札・見出し）→ 設備の作業日の区切りの鍵と、いちばん多い区切り */
  function ganttAxis(g, c, eqs, d, nRows) {
    const { LW, TW, RW, AX, rh, X, x0, x1, span } = c;
    // 時刻の目盛り（幅に合わせて 1・2・3・6・12 時間おき）
    const days = (x1 - x0) / 86400000, stepH = [1, 2, 3, 4, 6, 12, 24].find((h) => (TW / (span / 3600000)) * h >= (days > 1.5 ? 34 : 30)) || 24;
    const first = new Date(x0); first.setMinutes(0, 0, 0);
    for (let t = first.getTime(); t <= x1; t += 3600000) {
      if (t < x0) continue;
      const h = new Date(t).getHours();
      if (h % stepH === 0) g.push(`<text class="og-tick" x="${X(t)}" y="${AX - 4}" text-anchor="middle">${h}</text>`);
    }
    // 日の区切り（版 3.48.0。利用者の要望 2026-10-21 の 3 回目の 4）: サーバーの作業日の区切り（現場歴なら 7:00〜翌 7:00・太陽暦なら 0 時〜）に
    // 境の線と日付の札を引く（前は現場歴でも暦の 0 時に引き、日付の札が作業日とずれた）。設備で区切りが違えば（勤務体系が違う）、その行だけ自分の区切り
    const dayKey = (e) => (e.days || []).map((x) => x[0]).join();
    const counts = new Map(); eqs.forEach((e) => { if ((e.days || []).length) counts.set(dayKey(e), (counts.get(dayKey(e)) || 0) + 1); });
    const mainKey = [...counts.entries()].sort((u, v) => v[1] - u[1])[0]?.[0] || "";
    const mainDays = (eqs.find((e) => dayKey(e) === mainKey) || {}).days || [];
    const basisWord = d.basis === "cal" ? "太陽暦" : "現場歴";
    mainDays.forEach((x, i) => {
      const a = Math.max(LW, X(ms(x[0]))), b = Math.min(LW + TW, X(ms(x[1])));
      if (i) { g.push(`<line class="og-day" x1="${a}" x2="${a}" y1="${AX + 1}" y2="${AX + nRows * rh}"/>`); c.daySeen = true; c.vx.push(a); }      // 目盛りの字に掛けない
      const t = ms(`${x[2]} 12:00:00`), lbl = mainDays.length > 1 || i === 0 ? dayText(t) : "";
      if (lbl && b - a > textW(lbl, 12, 700) + 6) g.push(`<g><title>${esc(`${dayText(t)} の作業日（${basisWord}）: ${hm(ms(x[0]))}〜翌 ${hm(ms(x[1]))}`)}</title><text class="og-dayl" x="${a + 3}" y="1.2em">${lbl}</text></g>`);   // 説明は字を包む g に。字の高さは字の大きさから（y＝11 だと大きい字で上が図の外へ出た）
    });
    // 暦の 0 時が作業日の途中にあれば（現場歴）、日付が変わる所に日付の札（前は 0 の目盛りと直の境目の線だけで、翌日へ入ったことが書かれていなかった・§9.628）
    const bounds = new Set(mainDays.map((x) => ms(x[0])));
    const mid = new Date(x0); mid.setHours(24, 0, 0, 0);
    for (let t = mid.getTime(); t < x1; t += 86400000) {
      if (bounds.has(t)) continue;
      const xm = X(t), d0 = new Date(t), lbl = `${d0.getMonth() + 1}/${d0.getDate()} 0:00`;
      if (xm < LW + textW("00/00(土)", 12, 700) + 12 || xm + textW(lbl, 12, 600) + 3 > LW + TW) continue;   // 作業日の札・図の端に掛かるなら出さない
      g.push(`<line class="og-mid" x1="${xm}" x2="${xm}" y1="${AX - 30}" y2="${AX - 16}"/><text class="og-midl" x="${xm + 3}" y="1.2em">${lbl}<title>${esc(`暦の日付が ${lbl} に変わります（作業日は${basisWord}の区切りのまま）`)}</title></text>`);
    }
    g.push(`<text class="og-tick og-unit" x="${LW - 6}" y="${AX - 4}" text-anchor="end">時</text>`);
    g.push(`<text class="og-head" x="${LW + TW + 10}" y="${AX - 4}">稼働率${RW >= 156 ? '<tspan class="og-headsub" dx="6">下は稼働/勤務</tspan>' : ""}<title>稼働率 ＝ 作業していた時間 ÷ 勤務時間（直の時間）。下の行は稼働 ／ 勤務の時間</title></text>`);
    return { dayKey, mainKey };
  }
  /** 棒の無いわけの字の左端: 縦の線（作業日・直の境目・いま）の間で字が入る最初の区間。「いま」があればその右（これからの側）から探す。
      置き場は画面の幅で変えない（§9.628 の 7 回目）・地の札で線を覆わない（8 回目の採点: 札が直の境目と日付の線を隠した）。入る区間が無ければ null */
  function msgX(c, lines, tw) {
    const xs = [...new Set(lines.concat(c.nowX != null ? [c.nowX] : []))].filter((x) => x > c.LW && x < c.LW + c.TW).sort((u, v) => u - v);
    const edges = [c.LW, ...xs, c.LW + c.TW], gaps = edges.slice(1).map((b, i) => [edges[i], b]).filter(([a, b]) => b - a >= tw + 16);
    const pick = (c.nowX != null && gaps.find(([a]) => a >= c.nowX - 0.5)) || gaps[0];
    return pick ? pick[0] + 8 : null;
  }
  /** いまの作業の 1 行（行の名前の下・§9.630）: 作業中 L0015 〜3:33（遅れ 10分）／停止 段取り替え 〜3:50／待機・次 L0016 3:33〜／予定なし */
  function nowText(e) {
    const n = e.now || {}, c = n.cur, x = n.next, t = (v) => (v ? hm(ms(v)) : "–");
    if (c) return `${c.kind === "設備停止" ? "停止" : "作業中"} ${c.name || c.kind}・予定完了 ${t(c.end)}${+c.late > 0 ? `（${WL.duration.text(Math.round(+c.late))}超過）` : ""}`;
    return x ? `待機・次 ${x.name || x.kind} ${t(x.start)}〜` : n.rows ? "予定はすべて済み" : "予定なし";
  }
  const nowCls = (e) => { const c = (e.now || {}).cur; return c ? (c.kind === "設備停止" ? "is-stop" : +c.late > 0 ? "is-late" : "is-run") : "is-idle"; };
  /** 棒の札: 入れば全部、入らなければ末尾の数字の部分（…15）、それも入らなければ出さない（§9.630 の採点: 札の無い棒を作らない） */
  function barText(t, room, short) {
    if (!t) return "";
    if (!short) return room > textW(t, 11) + 8 ? t : "";
    const s = t.length > 3 ? t.slice(-3) : t;
    return room > textW(s, 11) + 6 ? s : "";
  }
  /** 札を下 3 桁にそろえるか: 全部の字が入らない棒が 1 本でもあれば、パネルの全部の棒を下 3 桁にする（1 枚の中で書き方を混ぜない・凡例で言う） */
  function shortLabels(eqs, X, x0, x1) {
    const w = (a, b) => X(Math.min(ms(b), x1)) - X(Math.max(ms(a), x0));
    return eqs.some((e) => (e.ops || []).concat(e.plans || []).some((o) => o[2] && w(o[0], o[1]) > 14 && w(o[0], o[1]) <= textW(o[2], 11) + 8));
  }
  /** 予定の棒（e.plans: [[始め, 終わり, 字, 状態, 遅れ（分）]]）。字は棒に入るとき・実績の棒が無い所だけ（重ねて読ませない） */
  function planBars(g, c, e, by, bh) {
    const { X, x0, x1, rh } = c, pl = e.plans || [];
    if (!pl.length) return;
    c.planSeen = true;
    const done = (e.ops || []).map((o) => [ms(o[0]), ms(o[1])]);
    pl.forEach((o) => {
      const t0 = ms(o[0]), t1 = ms(o[1]), late = +o[4] > 0, a = X(Math.max(t0, x0)), b = Math.max(a + 2, X(Math.min(t1, x1)));
      const tip = `予定: ${o[2] || "作業"}（${o[3] || "予定"}）\n${dayText(t0)} ${hm(t0)}〜${new Date(t0).getDate() !== new Date(t1).getDate() ? `${dayText(t1)} ` : ""}${hm(t1)}（${WL.duration.text(Math.round((t1 - t0) / 60000))}）`
        + (late ? `\n遅れ ${WL.duration.text(Math.round(+o[4]))}` : "");
      g.push(`<rect class="og-plan${late ? " is-late" : ""}" x="${a}" y="${by - 1.5}" width="${b - a}" height="${bh + 3}" rx="2"><title>${esc(tip)}</title></rect>`);
      if (late && b - a > 8) g.push(`<path class="og-planlate" d="M${b - 6} ${by + 1}L${b - 1} ${by + 1}L${b - 1} ${by + 6}Z"><title>${esc(tip)}</title></path>`);
      const busy = done.some(([u, v]) => u < t1 && v > t0);
      const pt = !busy && rh >= 18 ? barText(o[2], b - a, c.short) : "";
      if (pt) g.push(`<text class="og-pl" x="${a + 3}" y="${by + bh / 2 + 3.6}">${esc(pt)}</text>`);
    });
  }
  /** ガントの 1 台（勤務時間の帯・作業の棒・棒の無いわけ・設備名・稼働率） */
  function ganttRow(g, c, e, i, dayKey, mainKey) {
    const { LW, TW, RW, rh, X, x0, x1, p, colorOf } = c, AX = c.AX, short = c.short;    // 棒の色の名前も c なので、ここで控える
    const y = AX + i * rh, bh = Math.max(8, Math.round(rh * 0.62)), by = y + (rh - bh) / 2;
    g.push(`<g class="og-row" data-i="${i}"><rect class="og-off" x="${LW}" y="${y + 1}" width="${TW}" height="${rh - 2}"/>`);
    let onW = 0;
    const lines = c.vx.slice();      // この行を縦に通る線（作業日・直の境目・いま）。棒の無いわけの字はその間に置く
    (e.windows || []).forEach((w, k) => {
      const a = X(ms(w[0])), b = X(ms(w[1]));
      onW += Math.max(0, Math.min(b, LW + TW) - Math.max(a, LW));
      g.push(`<rect class="og-on" x="${a}" y="${y + 1}" width="${Math.max(0, b - a)}" height="${rh - 2}"><title>${esc(`${w[2]}（${w[3].slice(5).replace("-", "/")}）${hm(ms(w[0]))}〜${hm(ms(w[1]))}`)}</title></rect>`);
      if (k) { g.push(`<line class="og-sep" x1="${a}" x2="${a}" y1="${y + 1}" y2="${y + rh - 1}"/>`); c.sepSeen = true; lines.push(a); }
    });
    if (onW < TW - 1) c.offSeen = true;      // 勤務の外が見えている行がある（凡例に「勤務の外」を出す）
    if ((e.days || []).length && dayKey(e) !== mainKey) e.days.slice(1).forEach((x) => { const a = X(ms(x[0])); if (a > LW && a < LW + TW) g.push(`<line class="og-day is-own" x1="${a}" x2="${a}" y1="${y + 1}" y2="${y + rh - 1}"><title>${esc(`${e.name} の作業日の区切り（勤務体系 ${e.pattern || "なし"}）`)}</title></line>`); });
    // 予定（§9.630 ②。予定と実績を重ねるガント）: まだ終わっていない行の予定開始〜予定終了を、縁取りの枠（中は淡い地）で棒の下に。
    // 実績の棒は枠の中に重なるので、予定とのずれが見える。遅れは字（title）と枠の右の印で言う（色だけで言わない）
    planBars(g, c, e, by, bh);
    // 棒の字は、次の棒の始まりまでに入るときだけ（版 3.47.0。前は棒の幅だけを見て、重なる次の棒が字の上に描かれた）
    const starts = (e.ops || []).map((o) => X(Math.max(ms(o[0]), x0))).sort((u, v) => u - v);
    (e.ops || []).forEach((o) => {
      const t0 = ms(o[0]), t1 = ms(o[1]), cutL = t0 < x0, cutR = t1 > x1, run = o[5] === "r";
      const a = X(Math.max(t0, x0)), b = Math.max(a + 1.5, X(Math.min(t1, x1))), c = o[3] ? colorOf.get(o[3]) || WORK : WORK;
      const long = WL.duration.text(Math.round((t1 - t0) / 60000));   // 所要時間の書き方は WL.duration の1箇所（§9.341）
      const tip = `${o[2] || "作業"}${o[4] > 1 ? `（${o[4]} 本に分割）` : ""}\n${dayText(t0)} ${hm(t0)}〜${run ? "いま（作業終了がまだありません）" : `${t1 - t0 >= 86400000 || new Date(t0).getDate() !== new Date(t1).getDate() ? `${dayText(t1)} ` : ""}${hm(t1)}`}（${long}）`
        + `${o[5] === "c" || cutL ? "\n期間より前から続いている作業" : ""}${o[3] ? `\n${(p.ops || {}).color || ""}: ${o[3]}` : ""}`;
      g.push(`<rect class="og-bar${run ? " is-run" : ""}" x="${a}" y="${by}" width="${b - a}" height="${bh}" rx="2" fill="${c}"><title>${esc(tip)}</title></rect>`);
      if (run) g.push(`<rect class="og-run" x="${a}" y="${by}" width="${b - a}" height="${bh}" rx="2"/>`);       // 作業中: 斜めの縞（色だけで分けない）
      if (cutL) g.push(`<path class="og-cut" d="M${a + 5} ${by + 2}L${a + 1.5} ${by + bh / 2}L${a + 5} ${by + bh - 2}"/>`);   // ‹ 前から続く
      if (cutR || run) g.push(`<path class="og-cut" d="M${b - 5} ${by + 2}L${b - 1.5} ${by + bh / 2}L${b - 5} ${by + bh - 2}"/>`);   // › 後ろへ続く
      const room = Math.min(b, starts.find((sx) => sx > a + 0.5) ?? Infinity) - a;
      const bt = rh >= 18 ? barText(o[2], room - (cutL ? 6 : 0), short) : "";
      if (bt) g.push(`<text class="og-bl${run ? " is-run" : ""}" x="${a + 3 + (cutL ? 6 : 0)}" y="${by + bh / 2 + 3.6}">${esc(bt)}</text>`);
    });
    // 棒の無い行は、そのわけを行の中に出す（前は空の行で、出ないのか作業が無いのか分からなかった。版 3.47.0）
    const why = Object.entries(e.why || {}).map(([k, n]) => `${k} ${n} 本`).join("・");
    const msg = e.error ? `読めません: ${e.error}` : !(e.ops || []).length ? (e.noEnd ? `作業 ${e.count} 本の区間が分かりません（${why}）` : "この期間の作業はありません") : "";
    // 予定と実績のガントで、作業も予定も無い行は名前の下の「予定なし」が言う（行の中で同じ事実をくり返さない・§9.630 の採点）
    if (msg && !e.error && e.now && !(e.plans || []).length && !e.noEnd) { /* 名前の下が言う */ }
    else if (msg && rh >= 14) {      // 字は「いま」の線より上に、地を敷いて（§9.628。前は線が字の上を通った）。c.top は線の後に描く
      const wt = e.error || e.noEnd ? 700 : 400;
      // 線の間に入らなければ短い字（「作業なし」）で入れる（9 回目の採点: 長い字が直の境目の線を覆った）。それでも入らなければ左端
      let t = fitW(msg, TW - 16, 12, wt), tw = textW(t, 12, wt);
      if (msgX(c, lines, tw) == null && !e.error && !e.noEnd) { t = "作業なし"; tw = textW(t, 12, wt); }
      // 「いま」の線が字を通るなら、字を線の右（入らなければ左）へ寄せる（線も字も隠さない・§9.628 の 3 回目の採点）
      const tx = msgX(c, lines, tw) ?? LW + 8;
      c.top.push(`<rect class="og-msgbg" x="${tx - 4}" y="${y + rh / 2 - 9}" width="${tw + 8}" height="18" rx="3"/><text class="og-msg${wt === 700 ? " is-warn" : ""}" x="${tx}" y="${y + rh / 2 + 4}">${esc(t)}<title>${esc(msg)}</title></text>`);
    }
    else if (e.noEnd && rh >= 14) {     // 棒はあるが、区間の分からない作業がある: 行の右の端に琥珀の丸い札「区間なし n・わけ」（入らなければ「区間なし n」）
      const tip = `${e.name}: 作業 ${e.count} 本のうち ${e.noEnd} 本は区間が分からないので棒にしていません（${why}）。稼働率にも入りません`;
      let t = `区間なし ${e.noEnd}・${whyShort(e.why)}`;
      if (textW(t, 11, 700) + 20 > Math.min(TW * 0.4, 260)) t = `区間なし ${e.noEnd}`;
      const tw = textW(t, 11, 700), ph = Math.min(rh - 4, 18), px = LW + TW - 6 - tw - 16, py = y + (rh - ph) / 2;
      g.push(`<g class="og-nb"><rect class="og-nbr" x="${px}" y="${py}" width="${tw + 16}" height="${ph}" rx="${ph / 2}"/><text class="og-nend" x="${px + 8}" y="${py + ph / 2 + 4}">${esc(t)}</text><title>${esc(tip)}</title></g>`);
    }
    const nameTwo = e.now && !e.error && rh >= 30, nt = e.now ? nowText(e) : "";
    g.push(`<text class="og-name${e.error ? " is-err" : ""}" x="${LW - 8}" y="${nameTwo ? y + rh / 2 - 3 : y + rh / 2 + 4}" text-anchor="end">${esc(fitW(e.name, LW - 10, 12.5, 700))}<title>${esc(e.error ? `${e.name}: ${e.error}` : `${e.name}　勤務体系: ${e.pattern || "なし（稼働率を出せません）"}${nt ? `\n${nt}` : ""}`)}</title></text>`);
    if (nameTwo) g.push(`<text class="og-nowl2 ${nowCls(e)}" x="${LW - 8}" y="${y + rh / 2 + 12}" text-anchor="end">${esc(fitW(nt, LW - 10, 12))}<title>${esc(`${e.name}: ${nt}（作業スケジュールの着手の行と予定完了）`)}</title></text>`);
    // 稼働率: 数（太字）と細い棒（勤務時間に対する割合）。広いときは稼働／勤務の時間も
    // 稼働／勤務の時間は稼働率の下の 2 行目（どの幅でも同じ置き場。前は広いときだけ右の列に出し、1536 の幅では黙って消えた・§9.628 の 8 回目の採点）
    const rx = LW + TW + 10, rate = e.rate, bw = RW >= 92 ? RW - 42 - 10 : 0, two = rh >= 30 && rate != null, ry = two ? y + rh / 2 - 3 : y + rh / 2 + 4.5;
    const tipR = e.error ? `${e.name}: 読めないので稼働率を出せません` : e.rate == null ? `${e.name}: 勤務体系が無いので稼働率を出せません（マスタ管理の「勤務体系」）` : `${e.name}: 稼働 ${hours(e.busyMin)} ／ 勤務 ${hours(e.shiftMin)}${e.outsideMin ? `（勤務時間の外の稼働 ${hours(e.outsideMin)}）` : ""}`;
    g.push(`<text class="og-rate" x="${rx}" y="${ry}">${pct(rate)}<title>${esc(tipR)}</title></text>`);
    if (bw > 14 && rate != null) {
      const bx = rx + 42;
      g.push(`<rect class="og-rtrack" x="${bx}" y="${ry - 7.5}" width="${bw}" height="6" rx="3"/><rect class="og-rfill" x="${bx}" y="${ry - 7.5}" width="${Math.min(1, rate) * bw}" height="6" rx="3"/>`);
    }
    if (two) g.push(`<text class="og-rsub" x="${rx}" y="${ry + 15}">${hnum(e.busyMin)}/${hnum(e.shiftMin)} 時間<title>${esc(tipR)}</title></text>`);
    g.push("</g>");
  }

  /* ---------------- ABC 分析と換算係数 ---------------- */
  const picked = new Map();          // パネルの id → 見ている設備（"" は全設備）。この画面のあいだだけ覚える
  const md = (s) => { const m = /^\d{4}-(\d{2})-(\d{2})/.exec(s || ""); return m ? `${+m[1]}/${+m[2]}` : ""; };
  const rangeText = (r) => (r && r[0] ? (r[0] === r[1] ? md(r[0]) : `${md(r[0])}〜${md(r[1])}`) : "");
  const qtyName = (q) => (q === "lots" ? "本数" : q === "time" ? "作業時間" : `${q}の計`);
  const qtyText = (q, v) => (v == null ? "–" : q === "time" ? `${(v / 60).toFixed(1)}h` : (Math.round(v * 10) / 10).toLocaleString("ja-JP"));
  function abc(box, p, d, W, H) {
    const eqs = d.equips || [];
    if (!eqs.length) { box.innerHTML = '<p class="dp-empty">当たる設備がありません</p>'; return ""; }
    const o = p.ops || {}, q = d.qty || o.qty || "lots";
    if (!d.cls) { box.innerHTML = '<p class="dp-empty">品種の列を選んでください（組む所の「品種の列」）</p>'; return ""; }
    // 設備の札（tabs）を伏せたパネルは全設備だけ（設備で絞るのはダッシュボードの帯の1か所・§9.630 の 7 回目の採点）
    const noTabs = (o.hide || []).includes("tabs");
    const want = noTabs ? "" : picked.has(p.id) ? picked.get(p.id) : eqs.length > 1 ? "" : eqs[0].name;
    const cur = want === "" ? { name: "全設備", ...d.all } : eqs.find((e) => e.name === want) || eqs[0];
    const tabs = eqs.length > 1 && !noTabs ? `<div class="oa-tabs" role="tablist" aria-label="設備">${[{ name: "" }].concat(eqs).map((e) => {
      const on = (e.name || "") === (want === "" ? "" : cur.name);
      return `<button type="button" role="tab" class="oa-tab${on ? " on" : ""}" aria-selected="${on}" data-oa-eq="${esc(e.name)}">${esc(e.name || "全設備")}</button>`;
    }).join("")}</div>` : "";
    const items = cur.items || [];
    // パレート図の幅: 品種が全部入る幅まで広げる（パネルの 45% まで。§9.630 の採点: 図は上位 6・表は 8 品種で数が食い違った）
    const nameW0 = Math.max(18, ...items.slice(0, 30).flatMap((x) => (x.parts && x.parts.length > 1 ? x.parts : [x.key || "空"]).map((v) => textW(v || "空", 11))));
    const wide = W >= 680 && !(o.hide || []).includes("chart");
    const chartW = wide ? Math.round(Math.min(W * 0.45, Math.max(Math.min(W * 0.42, 420), 84 + Math.min(items.length, 30) * Math.max(22, nameW0 + 10)))) : 0;
    const tabH = tabs ? 30 : 0, footH = (o.hide || []).includes("foot") ? 0 : 20, headH = 24;
    const rows = items.slice(0, Math.max(1, Math.floor((H - tabH - footH - headH) / 17)));
    // 狭いパネルで入らない列は、描いた後に測って要らない順に隠す（構成比 → 換算本数 → 累積の帯 → 平均作業。版 3.47.0: 前は幅を決め打ちで
    // 判断し、組む所を開いて狭まった 1280 の画面で表の右が切れた）。印 oa-x1〜4
    // 品種の列が 2 つ以上（組み合わせ。版 3.47.0）なら、列ごとに見出しを分ける（狭ければ 1 つの欄に「／」で）
    const cl = d.clsList && d.clsList.length ? d.clsList : [d.cls], split = cl.length > 1 && W - chartW >= 420 + cl.length * 70;
    const keyHead = split ? cl.map((c) => `<th scope="col" class="oa-k" title="品種の列: ${esc(c)}">${esc(c)}</th>`).join("")
      : `<th scope="col" title="品種の列: ${esc(cl.join(" × "))}">${esc(cl.join(" × "))}</th>`;
    const keyCells = (x) => (split ? (x.parts || [x.key]).map((v, i) => `<${i ? "td" : "th scope=\"row\""} class="oa-k" title="${esc(v || "（空欄）")}">${esc(v || "（空欄）")}</${i ? "td" : "th"}>`).join("")
      : `<th scope="row" title="${esc(x.key || "（空欄）")}">${esc((x.parts || [x.key]).map((v) => v || "（空欄）").join("／"))}</th>`);
    // 表示項目（版 3.48.0。利用者の要望 2026-10-21 の 3 回目の 5）: 組む所で出さないと決めた項目（o.hide）は列・図・下の段から外す。
    // ABC（rank）を出さなければ、棒・累積の帯は 1 つの色で、A・B の線も引かない
    const off = new Set(o.hide || []), show = (k) => !off.has(k), plain = RANK.B;
    const RK = ranksOf(cur, o), rs = (x) => rankStyle(x.ri ?? Math.max(0, "ABC".indexOf(x.rank)), RK.count, x.rank);
    const rankTip = RK.each ? `${qWordOf(q)}の大きい順に、品種ごとに A・B・C …（${RK.count} 段）`
      : `${qWordOf(q)}の累積構成比で ${RK.lims.map((v, i) => `${rankName(i)}（〜${+v}%）`).join("・")}・${rankName(RK.lims.length)}（残り）`;
    const lead = want === "" && d.span === "lead";       // 全設備のリードタイム（版 3.48.0。要望 6）: 1 本＝1 ロット・作業時間＝最初の作業開始〜最後の作業終了
    // 列（版 3.49.0。利用者の要望 2026-10-21 の 4 回目の 2）: 負荷を見積もる流れの順に 本数 → 平均作業（平均 LT）→ 占有時間（本数 × 平均）→ 構成比（本数・負荷）
    // → 累積と ABC（並べた量で）→ 換算係数（平均 ÷ 基準）→ 換算本数（本数 × 係数 ＝ 占有時間 ÷ 基準）。前は量の列 1 つだけで、量を作業時間にすると
    // 本数が出ず、作業時間の合計（区間の分かる作業だけ）を「リードタイム」と呼んでいた
    const unit = lead ? "ロット" : "本", ref = cur.ref;
    const COLS = abcColumns({ q, lead, unit, ref, items, show, plain, rankTip, qWord: qWordOf(q) });
    const { hrs } = abcUnits(items, lead, q);
    const head = `<tr>${keyHead}${COLS.map((c) => c[1]).join("")}</tr>`;
    const body = rows.map((x) => {
      const r = rs(x);
      return `<tr class="oa-r-${x.rank}">${keyCells(x)}${COLS.map((c) => c[2](x, r)).join("")}</tr>`;
    }).join("");
    // 下の段の段ごとの品種の数（品種ごとに 1 段なら、数は 1 ずつなので「A〜AD の 30 段」とまとめる）
    const counts = [...new Map(items.map((x) => [x.rank, x])).values()].map((x) => [x, items.filter((y) => y.rank === x.rank).length]);
    const base = (ref ? ref.base : cur.base) || {};
    const foot = !show("foot") ? "" : `<div class="oa-foot">${show("rank") ? `<span class="oa-fa" title="${esc(rankTip)}">${RK.each && counts.length > 1 ? `品種ごと <b class="oa-rank is-s" style="--rc:${rs(counts[0][0]).c};--rf:${rs(counts[0][0]).f}">${counts[0][0].rank}</b>〜<b class="oa-rank is-s" style="--rc:${rs(counts[counts.length - 1][0]).c};--rf:${rs(counts[counts.length - 1][0]).f}">${counts[counts.length - 1][0].rank}</b> ${counts.length} 段`
        : counts.map(([x, n]) => `<b class="oa-rank is-s" style="--rc:${rs(x).c};--rf:${rs(x).f}">${x.rank}</b>${n} 品種`).join("　")}</span>` : ""}`
      + (lead ? '<span class="oa-flt" title="全設備の作業時間: 同じロット番号の、全設備の作業開始のいちばん早い時刻〜作業終了のいちばん遅い時刻（組む所の「全設備の時間」で積み上げに替えられます）">リードタイム</span>' : "")
      + (show("occ") ? `<span class="oa-fo" title="占有時間の計 ＝ 換算本数の計 × 基準の作業時間">占有時間の計 <b>${hrs(cur.occ)}</b></span>` : "")
      // 地点 A の係数で換算したとき（版 3.49.0）: A の期間と、B の本数の換算本数の計・A に無い品種の本数
      + (ref ? `<span class="oa-fc oa-fref" title="${esc(`地点 A（${rangeText(ref.range)}）の換算係数で、この期間（地点 B）の${unit}数を換算した計。A に無い品種 ${ref.missing} ${unit}は 1.00 で数えています`)}">A（${esc(rangeText(ref.range))}）の係数で換算 <b>${ref.conv.toFixed(1)}</b>（実${unit}数 ${ref.lots}${ref.missing ? `・A に無い ${ref.missing}` : ""}）</span>` : "")
      + (show("factor") || show("conv") ? `<span class="oa-fb" title="換算係数の基準${ref ? "（地点 A）" : ""}">基準${ref ? "（A）" : ""}: ${esc(base.name || "–")}${base.minutes ? ` ${base.minutes.toFixed(1)} 分 ＝ 1.00` : ""}</span>` : "")
      + (show("conv") && !ref ? `<span class="oa-fc" title="${esc(`実${unit}数 ${cur.lots || 0}（数字のパネル・表の本数の計と同じ数なので、ここには書きません）`)}">換算本数の計 <b>${(cur.conv || 0).toFixed(1)}</b></span>` : "")
      // 作業時間の分からない作業（換算係数・平均作業に入らない）の数と理由（版 3.47.0。前は黙って「–」だった）
      + "\u0000NOCHART\u0000"
      + `${cur.noEnd ? `<span class="oa-nend" title="${esc(`区間（作業開始〜作業終了）が分からないので、平均作業・換算係数に入れていない${lead ? "ロット" : "作業"}: ${Object.entries(cur.why || {}).map(([k, n]) => `${k} ${n} ${unit}`).join("・")}`)}">区間なし ${cur.noEnd} ${unit}（作業中など・平均に入れない）</span>` : ""}<span class="oa-rest"></span></div>`;
    // パレート図の棒の数: 棒の下の名前（組み合わせなら列ごとの段のいちばん長い値）が入る幅で（版 3.47.0。前は 1 本 22px で、名前が「A11…」と切れた）
    const nameW = Math.max(18, ...items.slice(0, 30).flatMap((x) => (x.parts && x.parts.length > 1 ? x.parts : [x.key || "空"]).map((v) => textW(v || "空", 11))));
    const chart = show("chart") && wide && H - tabH - footH >= 96 ? pareto(items.slice(0, Math.max(3, Math.min(items.length, Math.floor((chartW - 82) / Math.max(22, nameW + 8))))), chartW, H - tabH - footH, RK, items.length, show("rank") ? rs : null,
      q === "lots" ? "本" : q === "time" ? "分" : "") : "";
    // パレート図を出す項目に入れているのに、パネルが狭い・低いので描けないときは、そう言う（✓ と見た目を食い違わせない。2026-10-dash8 の作った後の採点）
    const noChart = show("chart") && !chart && items.length ? `<span class="oa-nochart" title="パレート図は、パネルの幅が 680px 以上・高さが足りるときに出します（パネルを広げると出ます）">パレート図はパネルが狭いので省いています</span>` : "";
    box.innerHTML = `<div class="oa-wrap">${tabs}${noChart && !show("foot") ? `<div class="oa-notes">${noChart}</div>` : ""}<div class="oa-main">${chart}<div class="oa-tbl"><table class="oa-table"><thead>${head}</thead><tbody>${body || `<tr><td colspan="${2 + COLS.length + (split ? cl.length - 1 : 0)}" class="dp-empty">当たる作業がありません</td></tr>`}</tbody></table></div></div>${foot.replace("\u0000NOCHART\u0000", noChart)}</div>`;
    abcFit(box, { eqs, want, cur, items, rows });
    abcBind(box, p);
    return "";
  }
  /** ABC の表の列: [鍵, 見出しの HTML, 値のセルの HTML を作る関数]（出さない項目は外す） */
  /** 時間の書き方（列の中で 10 時間を超える物があれば列ごと時間で〈11915.1 分 → 198.6h〉、無ければ分。1 つの列で単位を混ぜない）と言葉 */
  function abcUnits(items, lead, q) {
    const inH = items.some((x) => x.avg != null && x.avg >= 600);
    return { dur: (m) => (m == null ? "–" : inH ? `${(m / 60).toFixed(1)}h` : `${m.toFixed(1)} 分`),
      hrs: (m) => (m == null ? "–" : `${(m / 60).toLocaleString("ja-JP", { maximumFractionDigits: m >= 6000 ? 0 : 1 })}h`),
      lt: lead ? "平均 LT" : "平均作業", qWord: qWordOf(q) };
  }
  function abcColumns({ q, lead, unit, ref, items, show, plain, rankTip, qWord }) {
    const { dur, hrs, lt } = abcUnits(items, lead, q);
    /** 表の列: [鍵, 見出しの HTML, 値のセルの HTML を作る関数] */
    const COLS = /** @type {Array<any>} */ ([
      q !== "lots" && q !== "time" ? ["qty", `<th scope="col" title="ABC の並びに使う量">${esc(qtyName(q))}</th>`, (x) => `<td>${qtyText(q, x.qty)}</td>`] : null,
      ["lots", `<th scope="col" title="${lead ? "同じロット番号を 1 本と数えます（全設備のリードタイム）" : "作業の本数（分割したロットは 1 本）"}">${lead ? "ロット数" : "本数"}</th>`, (x) => `<td>${x.lots.toLocaleString("ja-JP")}</td>`],
      ["avg", `<th scope="col" class="oa-x4" title="${lead ? "1 ロットあたりの平均リードタイム（全設備の最初の作業開始〜最後の作業終了）" : "1 本あたりの平均作業時間（作業開始〜作業終了）"}">${lt}</th>`, (x) => `<td class="oa-x4">${dur(x.avg)}</td>`],
      ["occ", `<th scope="col" title="占有時間 ＝ ${lead ? "ロット数" : "本数"} × ${lt}（工場をその品種が占める時間の見積もり。区間の分からない${unit}も平均で見積もる）">占有時間</th>`, (x) => `<td>${hrs(x.occ)}</td>`],
      ["share", `<th scope="col" class="oa-x1" title="${lead ? "ロット数" : "本数"}の構成比">本数比</th>`, (x) => `<td class="oa-x1">${(x.lotShare ?? x.share).toFixed(1)}%</td>`],
      ["lshare", '<th scope="col" class="oa-x3" title="占有時間の構成比（負荷の割合。本数比と比べると、手間のかかる品種が分かる）">負荷比</th>', (x) => `<td class="oa-x3${x.occShare - (x.lotShare ?? 0) >= 2 ? " is-up" : ""}">${(x.occShare ?? 0).toFixed(1)}%</td>`],
      ["cum", `<th scope="col" title="${qWord}の累積構成比（ABC の分け方）">累積（${qWord}）</th>`, (x, r) => `<td><span class="oa-cum oa-x2"><i style="width:${Math.min(100, x.cum)}%;background:${show("rank") ? r.c : plain.c}"></i></span>${x.cum.toFixed(1)}%</td>`],
      ["rank", `<th scope="col" title="${esc(rankTip)}">ABC</th>`, (x, r) => `<td><b class="oa-rank" style="--rc:${r.c};--rf:${r.f}">${r.n}</b></td>`],
      ["factor", ref ? `<th scope="col" title="地点 A（基準の期間 ${esc(rangeText(ref.range))}）の換算係数 ＝ A の${lt} ÷ A の基準">係数（A）</th>` : `<th scope="col" title="${lt} ÷ 基準の作業時間（基準を 1.00 としたときの何倍か）">換算係数</th>`,
        (x) => { const f = ref ? x.refFactor : x.factor; return `<td class="oa-f${f != null && Math.abs(f - 1) >= 0.15 ? " is-far" : ""}${ref && f == null ? " is-none" : ""}"${ref && f == null ? ' title="地点 A に無い品種（1.00 で換算）"' : ""}>${f == null ? (ref ? "1.00*" : "–") : f.toFixed(2)}</td>`; }],
      ["conv", ref ? `<th scope="col" title="${lead ? "ロット数" : "本数"}（地点 B ＝ パネルの期間）× 地点 A の係数">換算本数（A）</th>` : `<th scope="col" title="${lead ? "ロット数" : "本数"} × 換算係数（＝ 占有時間 ÷ 基準）">換算本数</th>`,
        (x) => { const v = ref ? x.refConv : x.conv; return `<td>${v == null ? "–" : v.toFixed(1)}</td>`; }],
    ].filter((c) => c && (c[0] === "qty" || c[0] === "lots" || show(c[0]))));
    return COLS;
  }
  /** 描いた後に測って、入らない列・札・下の段・行を隠す（入れば行を高くして埋める） */
  function abcFit(box, { eqs, want, cur, items, rows }) {
    const wrap = box.querySelector(".oa-wrap"), tw = box.querySelector(".oa-tbl"), tb = box.querySelector(".oa-table tbody");
    // 幅: 表の列（oa-x1〜4 の順に隠す）・設備の札（入らなければ選ぶ欄に替える）・下の段（基準 → 換算本数の計 → ABC の数の順に隠す）
    const wideX = (el) => !!el && el.scrollWidth > el.clientWidth + 1, tallY = (el) => !!el && el.scrollHeight > el.clientHeight + 1;
    for (let k = 1; k <= 4 && wideX(tw); k++) wrap.classList.add(`no-x${k}`);
    // 省いた列は名前で言う（黙って落とさない・§9.630 の前後の採点: 1536 で「本数比」が消えていた）
    const gone = [...box.querySelectorAll(".oa-table thead th")].filter((th) => getComputedStyle(th).display === "none").map((th) => th.textContent.trim());
    const tl = box.querySelector(".oa-tabs");
    if (tl && tl.scrollWidth > tl.clientWidth + 1) {
      tl.innerHTML = `<label class="oa-tsel">設備<select data-oa-sel aria-label="設備">${[{ name: "" }].concat(eqs).map((e) => `<option value="${esc(e.name)}"${(e.name || "") === (want === "" ? "" : cur.name) ? " selected" : ""}>${esc(e.name || "全設備")}</option>`).join("")}</select></label>`;
    }
    const ft = box.querySelector(".oa-foot");
    ["oa-fb", "oa-fo", "oa-fc", "oa-fa"].forEach((c) => { if (ft && ft.scrollWidth > ft.clientWidth + 1) { const x = ft.querySelector(`.${c}`); if (x) x.hidden = true; } });
    const nc = box.querySelector(".oa-foot .oa-nochart");
    if (nc && ft.scrollWidth > ft.clientWidth + 1) nc.textContent = "パレート図は省略（狭い）";
    // 入る行だけ（描いた高さで測る）。入らない品種は下に「ほか n 品種」
    let rest = items.length - rows.length;
    const rowsOf = () => (tb ? tb.rows.length : 0);
    while (rowsOf() > 1 && tallY(tw)) { tb.deleteRow(-1); rest++; }
    const goneTxt = gone.length ? `狭いので省いた列: ${gone.join("・")}` : "";
    if (rest > 0) box.querySelector(".oa-rest").textContent = [`ほか ${rest} 品種（パネルを高くすると出ます）`, goneTxt].filter(Boolean).join("　");
    else if (goneTxt) box.querySelector(".oa-rest").textContent = goneTxt;
    // 品種が少なくて下が空くときは、行を高くして埋める（17〜36px・§9.630 の 5 回目の採点で 28→36。2026-10-ops の 3 回目で決めた G: 表の下が大きく空いていた）
    if (rest <= 0 && tw && tb && tb.rows.length) {
      const free = tw.clientHeight - tw.querySelector("thead").offsetHeight, rh = Math.max(17, Math.min(36, Math.floor(free / tb.rows.length) - 1));
      if (rh > 17) tw.style.setProperty("--oa-rh", `${rh}px`);
    }
  }
  /** 設備の札・選ぶ欄（1 回だけ配線する） */
  function abcBind(box, p) {
    if (!box.dataset.oaBound) {
      box.dataset.oaBound = "1";
      box.addEventListener("click", (e) => {
        const b = e.target.closest("[data-oa-eq]"); if (!b) return;
        picked.set(p.id, b.dataset.oaEq);
        box.dispatchEvent(new CustomEvent("dash:repaint", { bubbles: true }));
      });
      box.addEventListener("change", (e) => {
        const x = e.target.closest("[data-oa-sel]"); if (!x) return;
        picked.set(p.id, x.value);
        box.dispatchEvent(new CustomEvent("dash:repaint", { bubbles: true }));
      });
    }
  }
  /** パレート図（棒＝量の大きい順・ABC の色。線＝累積構成比。A・B の線） */
  function pareto(items, W, H, RK, all = items.length, rs = null, unit = "") {
    const ranks = !!rs;
    if (!items.length || H < 80) return "";
    const cut = all > items.length;       // 棒にしたのが上位だけなら、図の左上にそう書く（版 3.47.0。省いたことが見えなかった: 2026-10-ops4 の 2 回目の採点）
    // 品種が組み合わせ（版 3.47.0）なら、棒の下の名前を列ごとの段にする（A1100 と H14。1 段の「A1100／H14」より棒の幅に入る）
    const rows = Math.min(3, Math.max(1, ...items.map((x) => (x.parts || [x.key]).length)));
    // 右の余白は、線の札（「W 80.5%」など）のいちばん長い字が入る幅（版 3.51.0。線が増えて名前が 2 字・小数の % になると、48px では右端が切れた）
    const limTxt = ranks && !RK.each ? RK.lims.filter((v) => v < 100).map((v, i) => `${rankName(i)} ${+v}%`) : [];
    const L = 34, R = Math.max(48, Math.ceil(textW("累積100%", 11)) + 8, ...limTxt.map((t) => Math.ceil(textW(t, 11)) + 8)), T = (cut ? 26 : 12) + (ranks ? 12 : 0), B = 10 + 12 * rows,   // 段の字（棒の上の A・B・C）の席を上に取る
      iw = W - L - R, ih = H - T - B, n = items.length, bw = iw / n;
    const max = Math.max(...items.map((x) => x.qty)) || 1;
    const y = (v) => T + ih - (v / max) * ih, yc = (c) => T + ih - (c / 100) * ih;
    const g = [`<line class="oa-ax" x1="${L}" x2="${L + iw}" y1="${T + ih}" y2="${T + ih}"/>`];
    // 段の線（線はいくつでも。版 3.51.0）: 線はみな引き、字は前の字と 11px 以上離れる物だけ（近い線の字は、線の title で見える）。
    // 2 本のときは今までどおり、近ければ A を線の下・B を線の上へ逃がす。品種ごとの段（each）は線が無い
    const lims = ranks && !RK.each ? RK.lims.filter((v) => v < 100) : [];
    const near = lims.length === 2 && yc(lims[0]) - yc(lims[1]) < 12;
    let lastY = Infinity;
    lims.forEach((v, i) => {
      const k = rankName(i), dy = near ? (i ? -3 : 11) : 4, ty = yc(v) + dy;
      g.push(`<line class="oa-lim" x1="${L}" x2="${L + iw}" y1="${yc(v)}" y2="${yc(v)}"><title>${esc(`${k} の線 ${+v}%`)}</title></line>`);
      if (near || lastY - ty >= 14) { g.push(`<text class="oa-liml" x="${L + iw + 4}" y="${ty}">${k} ${+v}%</text>`); lastY = ty; }
    });
    items.forEach((x, i) => {
      const r = ranks ? rs(x) : RANK.B, h = T + ih - y(x.qty);
      g.push(`<rect x="${L + i * bw + bw * 0.14}" y="${y(x.qty)}" width="${bw * 0.72}" height="${Math.max(0, h)}" fill="${r.c}" rx="1.5"><title>${esc(`${x.key || "（空欄）"}: ${ranks ? `${x.rank}・` : ""}構成比 ${x.share.toFixed(1)}%・累積 ${x.cum.toFixed(1)}%`)}</title></rect>`);
      const cx = L + i * bw + bw / 2, ps = rows > 1 ? (x.parts || [x.key]).slice(0, rows) : [x.key];
      // 棒の上に段の字（A・B・C。色だけで言わない・§9.630 の 7 回目の採点）
      // 字は棒の中の下端（累積の折れ線と重ならない。棒の上に置くと線が通った・前後の採点）。棒が低ければ上に
      const inBar = h >= 18;
      if (ranks && bw >= 14) g.push(`<text class="oa-rkl${inBar ? " is-in" : ""}" x="${cx}" y="${inBar ? T + ih - 5 : y(x.qty) - 3}" text-anchor="middle"${inBar ? ` style="--rf:${r.f}"` : ""}>${esc(r.n)}</text>`);
      if (bw >= 24) g.push(`<text class="oa-xl" x="${cx}" y="${T + ih + 13}" text-anchor="middle">${ps.map((v, k) => `${k ? `<tspan x="${cx}" dy="12">` : ""}${esc(fitW(v || "空", bw - 4, 11))}${k ? "</tspan>" : ""}`).join("")}</text>`);
    });
    const pts = items.map((x, i) => `${L + i * bw + bw / 2},${yc(x.cum)}`).join(" ");
    g.push(`<polyline class="oa-line" points="${pts}"/>` + items.map((x, i) => `<circle class="oa-dot" cx="${L + i * bw + bw / 2}" cy="${yc(x.cum)}" r="2.6"/>`).join(""));
    // 軸の単位（§9.630 の採点: 左の軸は数だけ・右の 100% に名前が無かった）。左は量の単位、右は「累積」
    g.push(`<text class="oa-axl" x="${L - 4}" y="${T + 4}" text-anchor="end">${(Math.round(max * 10) / 10).toLocaleString("ja-JP")}${unit}</text><text class="oa-axl" x="${L - 4}" y="${T + ih + 4}" text-anchor="end">0</text>`);
    if (lastY - T > 16) g.push(`<text class="oa-axl" x="${L + iw + 4}" y="${T + 4}">累積100%</text>`);   // B の線の字と重なるなら出さない
    if (cut) g.push(`<text class="oa-axl oa-cut" x="${L}" y="11">上位 ${items.length} / 全 ${all} 品種</text>`);
    return `<svg class="oa-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="パレート図（品種の量の大きい順と累積構成比）">${g.join("")}</svg>`;
  }

  /** 見出しの題の横の札: 稼働のパネルは全体の稼働率と内訳（いちばん最初に見る数。2026-10-ops の 3 回目で決めた G。
      前は図のいちばん上の右の字で、題から離れていた）。dashboard.js が見出しを描くたびに呼ぶ */
  function badge(p, d) {
    if (p.visual !== "gantt" || !d || d.kind !== "gantt" || !d.total) return "";
    const t = d.total;
    // 区間の分からない作業があれば、全体の稼働率の札のすぐ横に琥珀の丸い札「区間なし n 本 設備」（パネルを開いた所で気付き、どの設備かまで分かる。
    // 行の札と同じ言葉・同じ形。版 3.47.0。2026-10-ops4 の 3 回目で決めた T）
    const nb = (d.equips || []).filter((e) => e.noEnd), n = nb.reduce((a, e) => a + e.noEnd, 0);
    const who = nb.slice(0, 2).map((e) => e.name).join("・") + (nb.length > 2 ? ` ほか ${nb.length - 2}` : "");
    const tip = `区間（作業開始〜作業終了）が分からないので棒にしていない作業: ${nb.map((e) => `${e.name} ${e.noEnd} 本（${Object.entries(e.why || {}).map(([k, x]) => `${k} ${x} 本`).join("・")}）`).join("、")}。稼働率にも入りません`;
    // 予定と実績のガント（§9.630）: いまの作業の数を見出しの札で（作業中 n 台・予定超過 n・停止 n。行の名前の下と同じ答え）
    const nows = (d.equips || []).map((e) => (e.now || {}).cur).filter(Boolean);
    const run = nows.filter((c) => c.kind !== "設備停止").length, stop = nows.length - run, over = nows.filter((c) => +c.late > 0).length;
    const nowB = (d.equips || []).some((e) => e.now) ? `<span class="og-badge og-nowb" title="作業スケジュールで着手の行（作業中のロット・設備停止）。設備ごとの名前と予定完了は行の名前の下">いま<b>作業中 ${run} 台</b>${stop ? `<small>停止 ${stop} 台</small>` : ""}${over ? `<small class="is-late">予定超過 ${over}</small>` : ""}</span>` : "";
    return nowB + `<span class="og-badge" title="全部の設備の稼働 ÷ 勤務時間（直の時間）">全体の稼働率<b>${pct(t.rate)}</b><small>稼働 ${hours(t.busyMin || 0)} ／ 勤務 ${hours(t.shiftMin || 0)}</small></span>`
      + (n ? `<span class="og-nbadge" title="${esc(tip)}">区間なし ${n} 本<small>${esc(who)}</small></span>` : "");
  }

  /* いまの作業（§9.630 ④。利用者の指示「現在の作業ロットもしくは設備停止名称と予定完了時刻の表示」）: 設備ごとに 1 行。
     左から 設備名 → 状態の札（作業中・設備停止・待機。色だけで言わない＝札の字）→ 名前（ロット番号か停止の名前・いちばん大きい字）→
     予定完了の時刻と、あと何分か・遅れ何分か → 次の予定。読む順と押す順はない（読むだけの面） */
  function now(box, p, d, W, H) {
    const all = d.equips || [];
    if (!all.length) { box.innerHTML = '<p class="dp-empty">当たる設備がありません</p>'; return ""; }
    // 予定が無い設備・予定を全部終えた設備は 1 行にまとめる（設備が増えても行が増えない・§9.630 の採点: 「ほか 2 台」に隠れた）
    // 作業も次の予定も無い設備は 1 行にまとめる（済み・予定なしを札の字で。全設備をこのパネルが言う＝ガントの足元では言わない・§9.630 の 7 回目）
    const none = all.filter((e) => !e.error && !e.cur && !e.next), eqs = all.filter((e) => !none.includes(e));
    const noneRow = none.length ? `<div class="on-row on-sum">${[["済み", none.filter((e) => e.rows)], ["予定なし", none.filter((e) => !e.rows)]].filter(([, xs]) => xs.length)
      .map(([w, xs]) => `<span class="on-tag is-none">${w}</span><span class="on-sumt">${esc(xs.map((e) => e.name).join("・"))}</span>`).join("")}</div>` : "";
    // 器の形で並べ方を選ぶ: 縦に全部入るなら行（設備ごとに 1 行）、入らず横に入るなら札を横に並べる（横長の帯に置いたとき）
    // 札の高さは 2 行（設備名・状態・次 ／ 名前・予定完了）か、入らなければ 1 行（設備名・状態・名前・予定完了。次は title）
    const nowT = ms(d.now || ""), rowH = 44, BIG_H = 96, CARD_W = 250, CARD_H = 50, LINE_H = 30, narrow = W < 600;
    const cols = H < eqs.length * rowH && Math.floor(W / CARD_W) >= Math.min(eqs.length, 2) && H >= LINE_H, line = cols && H < CARD_H;
    const fit = cols ? Math.max(1, Math.floor(W / CARD_W)) * Math.max(1, Math.floor(H / (line ? LINE_H : CARD_H))) : Math.max(1, Math.floor((H - (none.length ? 30 : 0)) / rowH)), shown = eqs.slice(0, fit);
    // 縦に余るなら大きな字（ロット番号・予定完了を数字の札と同じ格に。主役が隣の数字に負けて見えた・6 回目の採点）
    const big = !cols && H - (none.length ? 30 : 0) >= shown.length * BIG_H;
    const left = (end) => { const m = Math.round((ms(end) - nowT) / 60000); return Number.isFinite(m) ? m : null; };
    const hmOf = (t) => { const x = ms(t); return Number.isFinite(x) ? `${new Date(x).getDate() !== new Date(nowT).getDate() ? `${dayText(x)} ` : ""}${hm(x)}` : "–"; };
    const rows = shown.map((e) => {
      if (e.error) return `<div class="on-row is-err"><b class="on-eq">${esc(e.name)}</b><span class="on-why">読めません: ${esc(e.error)}</span></div>`;
      const c = e.cur, stop = c && c.kind === "設備停止";
      const tag = c ? (stop ? ["is-stop", "設備停止"] : ["is-run", "作業中"]) : e.next ? ["is-idle", "待機"] : e.rows ? ["is-none", "済み"] : ["is-none", "予定なし"];
      // 遅れは作業スケジュールの遅れ（分）で言う（予定を過ぎた作業は予定終了が「いま」へ押し出されるので、時刻の差では「あと 0 分」と出てしまう）
      const m = c ? left(c.end) : null, late = c ? Math.round(+c.late || 0) : 0;
      const rest = late > 0 ? `<small class="is-late">${narrow ? "" : "予定より "}${esc(WL.duration.text(late))} 遅れ</small>` : m != null && m > 0 ? `<small>あと ${esc(WL.duration.text(m))}</small>` : "";
      const due = c ? `<span class="on-due" title="予定完了＝作業スケジュールの予定終了（遅れている作業は見込みの終了）">予定完了 <b>${esc(hmOf(c.end))}</b>${rest}</span>` : "";
      // 進み具合の帯（作業開始〜予定完了のうち、いままでの割合。遅れは満ちた帯を琥珀で・字は上の「あと／遅れ」が言う）
      const t0 = c ? ms(c.start) : NaN, t1 = c ? ms(c.end) : NaN, frac = late > 0 ? 1 : t1 > t0 ? Math.max(0, Math.min(1, (nowT - t0) / (t1 - t0))) : NaN;
      const prog = c && !stop && Number.isFinite(frac) ? `<span class="on-prog${late > 0 ? " is-late" : ""}" title="作業開始 ${esc(hmOf(c.start))} 〜 予定完了 ${esc(hmOf(c.end))} のうち ${Math.round(frac * 100)}%"><i style="width:${(frac * 100).toFixed(1)}%"></i></span>` : "";
      const nxIn = e.next ? `次 ${esc(e.next.name || e.next.kind || "予定")} <b>${esc(hmOf(e.next.start))}</b>〜` : "";
      // 狭い器では「次」を名前の下の 2 行目へ（右の列にすると予定完了の字と重なった・4 回目の自分の確認）。状態の札が言うこと（済み・予定なし）を文でくり返さない
      const nx = narrow ? "" : `<span class="on-next" title="次の予定（予定開始の順）">${nxIn || "次の予定なし"}</span>`;
      const name = c ? c.name || c.kind : "";
      return `<div class="on-row"${e.next ? ` title="${esc(`次: ${e.next.name || e.next.kind || "予定"} ${hmOf(e.next.start)}〜`)}"` : ""}><b class="on-eq" title="${esc(e.name)}">${esc(e.name)}</b><span class="on-tag ${tag[0]}">${tag[1]}</span>`
        + `<span class="on-main">${name ? `<span class="on-name" title="${esc(name)}">${esc(name)}</span>` : ""}${due}${prog}${narrow && nxIn ? `<span class="on-due">${nxIn}</span>` : ""}</span>${nx}</div>`;
    }).join("");
    box.innerHTML = `<div class="on-wrap${cols ? " is-cols" : ""}${line ? " is-line" : ""}${narrow && !cols ? " is-narrow" : ""}${big ? " is-big" : ""}" role="list" aria-label="設備ごとのいまの作業"${cols ? ` style="--on-cols:${Math.min(shown.length, Math.floor(W / CARD_W))}"` : ""}>${rows}${cols ? "" : noneRow}</div>`;
    let more = eqs.length - shown.length;
    // 済み・予定なしの行が器に入らなければ（低いパネル）、行を外して足元の知らせへ回す（切れたまま残さない）
    const wrap = box.querySelector(".on-wrap"), sum = wrap && wrap.querySelector(".on-sum");
    const noneOut = cols || (!!sum && wrap.scrollHeight > wrap.clientHeight + 1);
    if (noneOut && sum) sum.remove();
    // 入る行の数は 1 行 44px の見積り。表示サイズ「大」では行が高く、最後の行が切れた（§9.631・test_fit）。描いたあとに測り、入らない行は「ほか n 台」へ回す
    if (wrap && !cols) for (let r = wrap.querySelectorAll(".on-row:not(.on-sum)"); r.length > 1 && wrap.scrollHeight > wrap.clientHeight + 1; r = wrap.querySelectorAll(".on-row:not(.on-sum)")) { r[r.length - 1].remove(); more++; }
    return [more > 0 ? `ほか ${more} 台（パネルを高くすると出ます）` : "", noneOut && none.length ? `予定の無い・済んだ設備: ${none.map((e) => e.name).join("・")}` : ""].filter(Boolean).join("　");
  }

  WL.dashOps = { gantt, abc, now, badge, RANK, rankStyle, rankName };
})();
