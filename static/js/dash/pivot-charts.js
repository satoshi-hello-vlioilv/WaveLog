/* =========================================================================
   集計表・グラフの描き方（版 3.27.0〜。組み方・表・覚えは lotlist-pivot.js。ここはグラフの形の登録と、答え → SVG だけ）
   - グラフの形は DEFS の 1 か所に登録する（鍵・名前・目的のまとまり・絵・説明・向く組み方・描く関数）。
     画面の形を選ぶ所（lotlist-pivot.js）・組み方のプリセット（services/pivot_presets.py の CHARTS）は、この鍵で揃える
   - 目的のまとまり（GROUPS）: 推移を見る・比べる・内訳を見る・ばらつきを見る・関係を見る・表。形が増えても、まず目的で選べる
   - 描く関数は ctx = {m: 表の形（buildModel）, d: サーバーの答え, s: 組み方, W, H, measName, dimName, label, compact} → {svg, legend, side, note?}（note: パネルの下に出す知らせ。ダッシュボードは凡例の添え書きを出さないので）
     compact（版 3.37.0。ダッシュボードのパネル）: 余白を詰め、横の傾向の面（side）の分を空けない（パネルの大きさに収める）
   - 数え方はサーバー（services/pivot.py）。ここでは足し上げ・並べ替え・割合・管理限界（I 管理図）・回帰の直線だけを数える
   ========================================================================= */
(function(){
  /** 'YYYY-MM-DD' の first〜last の日の並び（両端を含む・max 日まで） */
  function daysBetween(first, last, max) {
    const out = [], t = new Date(first + "T00:00:00"), end = new Date(last + "T00:00:00").getTime();
    while (t.getTime() <= end && out.length < max) {
      out.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`);
      t.setDate(t.getDate() + 1);
    }
    return out;
  }
  "use strict";
  const { esc } = WL.dashKit;
  // 系列の色。ダッシュボードのパネルは draw の ctx.colors で替える（データの種類の色。描く間だけ差し替える: draw）
  let COLORS = ["#b5822a", "#2f7d78", "#4a62b0", "#c9564a", "#7658ae", "#5c8a2a", "#1f6aa8", "#8a5f18", "#5a6f77", "#d35d8e", "#0d8191", "#a5372c"];
  const ALERT = "#c9564a", WARN = "#b5822a", MUTED = "#6b7680";
  const ADDITIVE = new Set(["count", "lots", "sum", "n"]);
  const SEP = "\u001f";
  const ALL = { type: "all", path: [] };        // 列の段の頭が空＝その行の全体（サーバーは段の頭の組をすべて数えるので、いつもある）
  const TIME_PARTS = new Set(["date", "ym", "year", "hour"]);

  /* ---- 字と目盛り ---- */
  const fmt = (v) => {
    if (v == null || v === "") return "";
    if (typeof v !== "number") return String(v);
    if (Number.isInteger(v)) return v.toLocaleString("ja-JP");
    return v.toLocaleString("ja-JP", { maximumFractionDigits: Math.abs(v) >= 1000 ? 1 : 3 });
  };
  const short = (v) => (Math.abs(v) >= 1e8 ? `${+(v / 1e8).toFixed(1)}億` : Math.abs(v) >= 1e4 ? `${+(v / 1e4).toFixed(1)}万` : fmt(Math.round(v * 100) / 100));
  const pct = (v) => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;
  const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
  /* ---- 字の幅で決める名前（版 3.47.0。利用者の要望 2026-10-21 の 2 回目の 5。評価関数 tools/ui-eval-labels.mjs） ----
     前は項目の名前を字の数で切っていた（12 字・1 本の幅 ÷ 8 字 など）。字の幅（全角・半角）も余白も見ないので、入る名前も「…」になり、
     斜めにした字は図の下からはみ出し、積み上げでは隣と重なった。いまは字の幅を測り、入れば切らない。入らないときだけ、使える幅で「…」 */
  const AXPX = () => (F.size === "l" ? 13 : 11);          // 軸の字の大きさ（.pv-ax。書式の字の大きさ「大」は 13px）
  let MEAS = null, MEAS_FAM = "sans-serif";
  /** 字の幅（px）。画面の字（体の字体）で測る。測れなければ全角 1・半角 0.58 のおおよそ */
  function textW(t, px = AXPX(), weight = 400) {
    const str = String(t ?? "");
    try {
      if (!MEAS) { MEAS = document.createElement("canvas").getContext("2d"); MEAS_FAM = getComputedStyle(document.body).fontFamily || "sans-serif"; }
      MEAS.font = `${weight} ${px}px ${MEAS_FAM}`;
      return MEAS.measureText(str).width;
    } catch (e) { return [...str].reduce((w, ch) => w + (/[ -~｡-ﾟ]/.test(ch) ? 0.58 : 1), 0) * px; }
  }
  /** 幅 w（px）に入る名前: 入ればそのまま・入らなければ入るところまでで「…」 */
  function fitW(t, w, px = AXPX(), weight = 400) {
    const str = String(t ?? "");
    if (textW(str, px, weight) <= w) return str;
    const cs = [...str];
    let lo = 1, hi = Math.max(1, cs.length - 1);
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (textW(cs.slice(0, mid).join("") + "…", px, weight) <= w) lo = mid; else hi = mid - 1; }
    return cs.slice(0, lo).join("") + "…";
  }
  /** lines 段まで折る: 段ごとに幅 w に入るところまで（後ろ 6 割に区切りの字〈空白・・・-・（〉があれば、そこで）→ 段の並び（最後の段は残り全部。入るかは呼ぶ側が測る） */
  function wrapN(t, w, lines, px = AXPX()) {
    let cs = [...String(t ?? "")];
    const out = [];
    while (out.length < lines - 1 && cs.length) {
      let k = cs.length;
      while (k > 1 && textW(cs.slice(0, k).join(""), px) > w) k--;
      if (k >= cs.length) break;
      const brk = cs.slice(0, k).map((ch, i) => (/[\s・･\-_/（(]/.test(ch) ? i : -1)).filter((i) => i >= k * 0.4).pop();
      if (brk != null && brk > 0) k = /[（(]/.test(cs[brk]) ? brk : brk + 1;
      out.push(cs.slice(0, k).join("").trimEnd());
      cs = [...cs.slice(k).join("").trimStart()];
    }
    if (cs.length) out.push(cs.join(""));
    return out;
  }
  /** 横軸の項目の名前の置き方（縦棒・パレート・積み上げ・箱ひげ・バイオリン・項目の折れ線）: names・iw（軸の長さ）・H・step（何個おきに書くか）
      → {extra（下の余白に足す高さ）, every（何個おきに書くか）, text(i, x, y)（y は 1 段目の字の下の線）}。
      書式で字の向き（xrot）を決めていなければ、1 段で入る → 2 段で入る → 斜め（35°。下の余白に入る長さまで切る）の順に選ぶ */
  function catAxis(names, iw, H, ctx, step = 1) {
    const px = AXPX(), gw = (iw / Math.max(1, names.length)) * step, slot = gw - 6, rot = F.xrot ? +F.xrot : 0;
    const need = Math.max(0, ...names.map((t) => textW(t, px)));
    if (!rot && need <= slot) return { extra: 0, every: step, text: (i, x, y) => `<text x="${x}" y="${y}" text-anchor="middle" class="pv-ax">${esc(names[i])}</text>` };
    // 2 段（高いグラフは 3 段）まで折って入るなら折る（横に読める。斜めより目が動かない）
    for (let k = 2, kMax = !rot && slot >= 40 ? (H >= 200 ? 3 : 2) : 1; k <= kMax; k++) {
      const ls = names.map((t) => wrapN(t, slot, k, px));
      if (ls.every((l) => l.length <= k && textW(l[l.length - 1], px) <= slot)) {
        const rows = Math.max(...ls.map((l) => l.length));
        return { extra: (px + 2) * (rows - 1), every: step,
          text: (i, x, y) => `<text x="${x}" y="${y}" text-anchor="middle" class="pv-ax">${ls[i].map((t, j) => (j ? `<tspan x="${x}" dy="${px + 2}">${esc(t)}</tspan>` : esc(t))).join("")}</text>` };
      }
    }
    const deg = rot || 35, rad = (deg * Math.PI) / 180, sn = Math.sin(rad), cs = Math.cos(rad);
    const room = Math.max(40, Math.min(ctx.compact ? H * 0.42 : 150, 170));            // 斜めの字に使える下の余白の高さ
    const L = Math.max(px * 2, Math.min(need, (room - 12 - px * cs) / sn));             // 字の長さの上限
    const every = step * Math.max(1, Math.ceil((px + 2) / Math.max(1, gw * sn)));        // 平らに並ぶ字の間（幅 × sin）が字の高さより狭ければ間引く
    return { extra: Math.max(0, Math.ceil(8 + L * sn + px * cs + 2) - 24), every,
      // 左の端: 字の上の端は傾きの分だけ左へ出る（px × sin）。図の左の端を越えない長さまで
      text: (i, x, y) => `<text transform="translate(${x + 3},${y - 8}) rotate(-${deg})" text-anchor="end" class="pv-ax">${esc(fitW(names[i], cs > 0.01 ? Math.min(L, (x + 3 - px * sn - 1) / cs - 1) : L, px))}</text>` };
  }

  /* ---- 書式（版 3.39.0。ダッシュボードのパネルの書式 fmt。描く間だけ draw が置く。一覧の集計表は空＝今までの描き方） ----
     labels … 数値ラベル（none・top〈上〉・inside〈棒の中。積み上げはそれぞれの段〉・both。空なら組み方の「数値ラベル」で top か none）
     xdate  … 横軸の日付の形（md 10/2・mdw 10/2(金)・d 2・dw 2(金)・ymd 2026/10/2・ym 26/10・w 金）。xrot … 横軸の字の向き（0・45・90）
     digits … 小数の桁・unit … 単位（none・k〈千〉・man〈万〉。空は 万・億 を自動）・ymin/ymax … 縦軸の範囲・grid … 補助線（false で消す）
     refs   … 基準線 [{value, label, color}]・colors … 系列・項目の名前 → 色 */
  let F = {};
  const LBL = { top: false, inside: false };
  /** 数値ラベル・目盛りの字（書式の桁・単位。無ければ short と同じ） */
  // 単位で割る（千・万・百万・億）。表示形式（F.num。Excel の書式コード・num-format.js）があれば、割った数をその形で書く（単位の字はコードに入れる）
  const DIVS = { k: [1e3, "千"], man: [1e4, "万"], m: [1e6, "百万"], oku: [1e8, "億"], none: [1, ""] };
  function nf(v) {
    if (v == null || v === "" || typeof v !== "number") return v == null ? "" : String(v);
    const u = F.unit || "auto", dg = F.digits;
    if (F.num && WL.numFormat) return WL.numFormat.text(v / (DIVS[u] || [1])[0], F.num);
    if (u === "auto" && dg == null) return short(v);
    const [div, suf] = DIVS[u] || (Math.abs(v) >= 1e8 ? [1e8, "億"] : Math.abs(v) >= 1e4 ? [1e4, "万"] : [1, ""]);
    const x = v / div;
    return (dg == null ? fmt(Math.round(x * 100) / 100) : x.toLocaleString("ja-JP", { minimumFractionDigits: dg, maximumFractionDigits: dg })) + suf;
  }
  /** 数値ラベルの字（版 3.50.1）: 値ごとの桁（measures の dec）があればその桁。系列の名前が分かれば、その系列の値の桁（SDEC）。
      パネルの書式で桁・表示形式を決めていれば、そちらが勝つ（measFmt と同じ決まり）。目盛りは nf のまま（桁で 0.25 が 0 にならない） */
  let SDEC = new Map(), LDEC = null;
  function lf(v, name) {
    const dg = name != null && SDEC.has(name) ? SDEC.get(name) : LDEC;
    if (dg == null || F.digits != null || F.num) return nf(v);
    const keep = F;
    F = { ...F, digits: dg, unit: F.unit && F.unit !== "auto" ? F.unit : "none" };
    try { return nf(v); } finally { F = keep; }
  }
  /** 系列・項目の色（書式で名前に色を決めていれば、その色） */
  // 描いた色は USED に控える（版 3.41.0。組む所の「系列」の見本は、描いた色そのもの: 見本と線の色が食い違っていた）
  let USED = null;
  let SER = null;      // 描いた系列の形と目盛り（名前 → {kind, axis}。組む所の「自動（棒）」に使う。版 3.46.0）
  const cof = (name, fallback) => { const c = (F.colors && F.colors[name]) || fallback; if (USED && !USED.has(name)) USED.set(name, c); return c; };
  /** 縦軸の上の端（書式の ymax か、きりの良い最大）と下の端（ymin か 0） */
  const topOf = (v) => (F.ymax != null ? F.ymax : niceMax(v));
  const lowOf = (top) => (F.ymin != null && F.ymin < top ? F.ymin : 0);
  /** 範囲の目盛り（管理図・箱ひげ・散布図）に書式の縦軸の範囲を当てる */
  function rangeFix(r) {
    if (F.ymin == null && F.ymax == null) return r;
    const lo = F.ymin != null ? F.ymin : r.lo, hi = F.ymax != null && F.ymax > lo ? F.ymax : Math.max(r.hi, lo + 1e-9);
    return { lo, hi, ticks: niceRange(lo, hi).ticks.filter((t) => t >= lo - 1e-9 && t <= hi + 1e-9) };
  }
  /** 基準線（書式の refs）: 横の線と、右の端の名前。y … 値 → 縦の位置。描く範囲の外の線は描かない */
  function refLines(y, x0, x1, top, bottom) {
    return (F.refs || []).map((r) => {
      const yy = y(r.value);
      if (!(yy >= top - 0.5 && yy <= bottom + 0.5)) return "";
      const c = r.color || ALERT;
      return `<line x1="${x0}" x2="${x1}" y1="${yy}" y2="${yy}" stroke="${c}" stroke-width="1.6" stroke-dasharray="6 3" class="pv-ref"><title>${esc(r.label || "基準")} ${esc(fmt(r.value))}</title></line>`
        + `<text x="${x1 - 2}" y="${yy - 4}" text-anchor="end" class="pv-ax pv-ref-t" fill="${c}">${esc(r.label || "")}${r.label ? " " : ""}${esc(nf(r.value))}</text>`;
    }).join("");
  }
  /** 縦の基準線（横棒・ヒストグラム: 値が横に並ぶ形）。x … 値 → 横の位置 */
  function refLinesX(x, top, bottom, left, right) {
    return (F.refs || []).map((r) => {
      const xx = x(r.value);
      if (!(xx >= left - 0.5 && xx <= right + 0.5)) return "";
      const c = r.color || ALERT;
      return `<line x1="${xx}" x2="${xx}" y1="${top}" y2="${bottom}" stroke="${c}" stroke-width="1.6" stroke-dasharray="6 3" class="pv-ref"><title>${esc(r.label || "基準")} ${esc(fmt(r.value))}</title></line>`
        + `<text x="${xx + 3}" y="${top + 10}" class="pv-ax pv-ref-t" fill="${c}">${esc(r.label || "")}${r.label ? " " : ""}${esc(nf(r.value))}</text>`;
    }).join("");
  }
  /** 横軸の字。書式で向きを決めていれば傾ける（決めていなければ、呼ぶ所の今までの描き方） */
  function xText(x, y, text, cls = "pv-ax") {
    const rot = F.xrot ? +F.xrot : 0;
    if (!rot) return `<text x="${x}" y="${y}" text-anchor="middle" class="${cls}">${esc(text)}</text>`;
    return `<text transform="translate(${x + 3},${y - 8}) rotate(-${rot})" text-anchor="end" class="${cls}">${esc(text)}</text>`;
  }
  /** 点の名前を、ほかの名前・点と重ならない物だけ描く（散布図・45度線・バブル）。items: [{x, y, text, r}] → <text> の並び */
  function freeLabels(items, W, H) {
    const boxes = items.map((it) => ({ x0: it.x - (it.r || 3), x1: it.x + (it.r || 3), y0: it.y - (it.r || 3), y1: it.y + (it.r || 3) })), out = [];
    items.forEach((it) => {
      const w = it.text.length * 11 + 2, b = { x0: it.x + (it.r || 3) + 2, x1: it.x + (it.r || 3) + 2 + w, y0: it.y - (it.r || 3) - 13, y1: it.y - (it.r || 3) + 1 };
      if (b.x1 > W || b.y0 < 0) return;
      if (boxes.some((o) => o !== b && b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1)) return;
      boxes.push(b);
      out.push(`<text x="${b.x0}" y="${b.y1 - 2}" class="pv-vl">${esc(it.text)}</text>`);
    });
    return out.join("");
  }
  /** 系列ごとの書式（版 3.41.0。fmt.series: 名前 → {label: ""（パネルの数値に従う）・top・below・off, dash: true〈破線〉}） */
  const serFmt = (name) => (F.series && F.series[name]) || {};
  /** その系列に数値ラベルを付けるか（系列の書式で上・下を決めていれば、パネルの数値が「なし」でも付ける） */
  const labelWant = (name) => { const l = serFmt(name).label; return l === "off" ? false : l === "top" || l === "below" ? true : LBL.top; };
  /** 数値ラベルを 1 つ置く: ほかのラベル（placed）と重なる・描く所（top〜bottom・左右）を出るなら置かない → <text> か "" */
  function labelAt(placed, cx, by, text, color, W, top = -Infinity, bottom = Infinity, plate = false) {
    const w = String(text).length * 6.4 + 4, b = { x0: cx - w / 2, x1: cx + w / 2, y0: by - 11, y1: by + 2 };
    if (b.x0 < 0 || b.x1 > W || b.y0 < top || b.y1 > bottom + 14) return "";
    if (placed.some((o) => b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1)) return "";
    placed.push(b);
    // plate: 線を避けられないときは、字の下に白い札を敷く（線の切れ端が字に掛からない）
    return (plate ? `<rect x="${b.x0 - 1}" y="${b.y0 - 1}" width="${w + 2}" height="${b.y1 - b.y0 + 3}" rx="3" fill="#fff" opacity=".94"/>` : "")
      + `<text x="${cx}" y="${by}" text-anchor="middle" class="pv-vl"${color ? ` style="fill:${color}"` : ""}>${esc(text)}</text>`;
  }
  /** 横の字を傾けたときに下に足す余白（いちばん長い字から） */
  const tiltPad = (names) => { const rot = F.xrot ? +F.xrot : 0, len = Math.min(14, Math.max(2, ...names.map((t) => String(t).length))); return rot === 90 ? len * 8 : rot === 45 ? len * 5.5 : 0; };
  /** 0 から始まる目盛りの最大（4 等分した目盛りがきりの良い数: 1・2・4・6・8・10 × 10^k） */
  const niceMax = (v) => { if (v <= 0) return 1; const e = 10 ** Math.floor(Math.log10(v)); return [1, 2, 4, 6, 8, 10].map((k) => k * e).find((x) => x >= v); };
  /** 0 から始めない目盛り（管理図・箱ひげ・散布図）: きりの良い刻みで lo〜hi を 4〜6 つに分ける */
  function niceRange(lo, hi) {
    if (!(hi > lo)) { const pad = Math.abs(hi) * 0.1 || 1; lo -= pad; hi += pad; }
    const raw = (hi - lo) / 4, e = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((k) => k * e).find((x) => x >= raw);
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    const ticks = []; for (let t = a; t <= b + step / 2; t += step) ticks.push(Math.round(t / step) * step);
    return { lo: a, hi: b, ticks };
  }
  const legendHtml = (items) => `<span class="pv-legend">${items.map(([name, color, kind]) => `<span><i class="${kind === "line" ? "is-line" : ""}" style="--c:${color}"></i>${esc(name)}</span>`).join("")}</span>`;
  /** 左（か右）の目盛りと横の補助線（0〜max を 4 等分） */
  function axisY(x0, y0, h, max, right, W, color = MUTED, fmtv = nf, lo = 0) {
    // 目盛りの字が重ならない数だけ（低いグラフ＝ダッシュボードの小さなパネルは 3 つか 2 つ）。lo … 縦軸の下の端（書式の ymin。既定 0）
    // 最大が 4 までの整数なら目盛りは整数だけ（§9.628。前は 0・0.5・1・1.5・2 で、本数に 0.5 本の目盛りがあった）
    const whole = lo === 0 && Number.isInteger(max) && max >= 1 && max <= 4 && h >= 54;
    return (whole ? Array.from({ length: max + 1 }, (_, i) => i / max) : h >= 110 ? [0, 0.25, 0.5, 0.75, 1] : h >= 54 ? [0, 0.5, 1] : [0, 1]).map((f) => { const y = y0 + h * (1 - f); return `${right || F.grid === false ? "" : `<line x1="${x0}" x2="${W - 56}" y1="${y}" y2="${y}" class="pv-grid"/>`}<text x="${right ? W - 50 : x0 - 6}" y="${y + 4}" text-anchor="${right ? "start" : "end"}" fill="${color}" class="pv-ax">${esc(fmtv(lo + (max - lo) * f))}</text>`; }).join("");
  }
  /** 範囲の目盛り（niceRange）と補助線。y は値 → 縦の位置 */
  const axisRange = (r, x0, x1, y) => r.ticks.filter((t, i, a) => a.length < 3 || Math.abs(y(a[0]) - y(a[a.length - 1])) / (a.length - 1) >= 16 || i % 2 === 0).map((t) => `${F.grid === false ? "" : `<line x1="${x0}" x2="${x1}" y1="${y(t)}" y2="${y(t)}" class="pv-grid"/>`}<text x="${x0 - 6}" y="${y(t) + 4}" text-anchor="end" class="pv-ax">${esc(nf(t))}</text>`).join("");
  const svgOf = (W, H, g, label) => `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${g}</svg>`;
  const empty = (text) => ({ svg: `<div class="pv-cempty">${text}</div>`, legend: "", side: "" });
  /** 余白（詰めた形は小さく）と、横の傾向の面の幅（詰めた形は 0） */
  const pad = (ctx, wide, tight) => (ctx.compact ? tight : wide);
  const sideW = (ctx) => (ctx.compact ? 0 : 250);
  /** 数値ラベルの間引き: 字の幅が 1 本ぶんの幅に入らなければ、何本おきかに */
  const thinOf = (vals, slot, text = nf) => Math.max(1, Math.ceil(Math.max(0, ...vals.map((v) => (v ? text(v).length * 6.2 + 4 : 0))) / Math.max(slot, 1)));
  const statsBox = (title, rows, note = "") => `<div class="pv-stats"><b>${esc(title)}</b><table>${rows.map(([k, v, cls]) => `<tr${cls ? ` class="${cls}"` : ""}><th>${esc(k)}</th><td>${esc(typeof v === "number" ? fmt(v) : v)}</td></tr>`).join("")}</table>${note ? `<small class="pv-cnote">${note}</small>` : ""}</div>`;

  /* ---- 答えの読み方 ---- */
  /** 答えが月で区切った形か（行の 1 段目が年月・2 段目が同じ列の日）→ 日の段の番号（1）か 0 */
  const isDay = (x) => !!x && ((x.column === "@workday" && !x.part) || (x.column !== "@workday" && !x.column.startsWith("@") && x.part === "date"));
  const dayAt = (d) => { const r = d.dims.rows; return r.length > 1 && r[0].part === "ym" && r[1].column === r[0].column && isDay(r[1]) ? 1 : 0; };
  const isTimeDim = (x) => !!x && (x.column === "@workday" || TIME_PARTS.has(x.part));
  const isTime = (d) => isTimeDim(d.dims.rows[dayAt(d)]);
  const dataRows = (m) => m.rows.filter((r) => r.type === "data" && r.path.length);
  const dataCols = (m, n = 12) => m.cols.filter((c) => c.type === "data" || c.type === "all").slice(0, n);
  const chartAt = (ctx) => Math.min(ctx.s.chartAt || 0, ctx.d.measures.length - 1);
  function tickText(k, part) {
    const xd = F.xdate || "";
    if (part === "date" && /^\d{4}-\d{2}-\d{2}$/.test(k)) {
      const m = +k.slice(5, 7), dd = +k.slice(8, 10), w = "日月火水木金土"[new Date(k + "T00:00:00").getDay()];
      return { mdw: `${m}/${dd}(${w})`, d: `${dd}`, dw: `${dd}(${w})`, ymd: `${k.slice(0, 4)}/${m}/${dd}`, w, ym: `${k.slice(0, 4)}/${k.slice(5, 7)}` }[xd] || `${m}/${dd}`;
    }
    if (part === "ym" && /^\d{4}-\d{2}$/.test(k)) return xd === "ymd" ? `${k.slice(0, 4)}/${k.slice(5, 7)}` : ["md", "mdw", "d", "dw", "w"].includes(xd) ? `${+k.slice(5, 7)}月` : `${k.slice(0, 4)}/${k.slice(5, 7)}`;   // 年は 4 桁（「26/10」は 10 月 26 日に読めた・§9.628）
    return k;
  }
  /** 横の目盛り。時の段（日付・年月）は間も空けて並べる（無い日は値なし）。そうでなければ表の並びのまま（cat）。L は横に並べる段 */
  function axisOf(m, d, L) {
    const data = dataRows(m), x = d.dims.rows[L];
    if (!isTimeDim(x)) {
      const ticks = [...new Set(data.map((r) => r.path[L]))];
      const pos = new Map(ticks.map((k, i) => [k, i]));
      return { ticks, at: (k) => pos.get(k) ?? -1, part: "", cat: true };
    }
    const part = x.column === "@workday" ? ({ ym: "ym", year: "year" }[x.part] || "date") : x.part;
    const keys = [...new Set(data.map((r) => r.path[L]).filter(Boolean))].sort();
    if (!keys.length) return { ticks: [], at: () => -1, part };
    // 期間が横の段と同じ列なら、軸は期間の始まり〜終わり（§9.628。前は数のある日・月の間だけで、「直近 365 日」の月ごとが 1 本の棒だった）
    const r0 = ((d.period || {}).ranges || [])[0], cut = part === "date" ? 10 : part === "ym" ? 7 : 0;
    if (cut && r0 && r0.from && r0.to && d.period.column === x.column) {
      const ends = [String(r0.from).slice(0, cut), String(r0.to).slice(0, cut)].filter((k) => /^\d{4}-\d{2}/.test(k));
      keys.splice(0, keys.length, ...[...new Set(keys.concat(ends))].sort());
    }
    let ticks = keys;
    if (part === "date" && /^\d{4}-\d{2}-\d{2}$/.test(keys[0])) {
      ticks = daysBetween(keys[0], keys[keys.length - 1], 2000);
    } else if (part === "ym" && /^\d{4}-\d{2}$/.test(keys[0])) {
      const out = []; let [y, mo] = keys[0].split("-").map(Number); const [y2, m2] = keys[keys.length - 1].split("-").map(Number);
      while ((y < y2 || (y === y2 && mo <= m2)) && out.length < 600) { out.push(`${y}-${String(mo).padStart(2, "0")}`); mo++; if (mo > 12) { mo = 1; y++; } }
      ticks = out;
    }
    const pos = new Map(ticks.map((k, i) => [k, i]));
    return { ticks, at: (k) => pos.get(k) ?? -1, part };
  }

  /* ================= 推移を見る ================= */
  /** 時系列・折れ線・面・積み上げ面（mode: time・line・area・stackarea）: 1 つ目の値＝棒（足し上げる値。折れ線・面の形では線と面）、
      2 つ目以降＝折れ線（右の目盛り）。列の段があれば 1 つ目の値を列ごとに（時系列の足し上げる値は積み上げの棒・積み上げ面は積んだ面＝高さがその日の合計）。
      月で区切ったとき（日の段の上に年月の段）は、日を横に並べ、月の境目に線と月の名前。数値ラベルは 1 つ目の系列の上（入り切る本数だけ）。
      棒の中のラベル（書式 inside）は、積み上げの段ごとに入る高さなら */
  function trendChart(ctx, mode) {
    const T = trendFrame(ctx);
    if (!T) return empty("描く行がありません。");
    trendSeries(T, ctx, mode);
    trendScale(T);
    trendStacks(T);
    trendMarks(T);
    trendAxes(T);
    trendLeadLabels(T);
    trendLineLabels(T);
    const { m, d, s, n, L, series, thin } = T;
    const legend = legendHtml(series.map((q) => [q.name + (series.some((r) => r.axis === "right") ? (q.axis === "left" ? "（左）" : "（右）") : ""), q.color, q.kind === "line" ? "line" : "bar"]))
      + `<small class="pv-cnote">${n} 刻み・${esc(ctx.dimName(d.dims.rows[L]))}${m.nr > L + 1 ? "（上の段の小計で描きます）" : ""}${thin > 1 ? `・数値は ${thin} 本おき${s.month ? "" : "（月を選ぶと全部出ます）"}` : ""}</small>`;
    return { svg: svgOf(T.W, T.H, T.g, { time: "時系列のグラフ", line: "折れ線グラフ", area: "面グラフ", stackarea: "積み上げ面グラフ", combo: "組み合わせのグラフ" }[mode] || "グラフ"), legend };
  }
  /** 推移の図の枠（横の段・余白・x の置き方）。描く行が無ければ null */
  function trendFrame(ctx) {
    const { m, d, s, W, H } = ctx, L = dayAt(d), ax = axisOf(m, d, L), n = ax.ticks.length, months = L === 1 && ax.part === "date";
    if (!n) return null;
    const lab = (k) => m.lab(L, k);
    const tickOf = (k) => (ax.cat ? lab(k) : tickText(k, ax.part));
    // 右の目盛り（2 つ目の値）を描くときは、目盛りの字の分だけ右を空ける（詰めた形の 40px では字が棒に重なった: 2026-10-dashlink の採点）
    const oneAxis = (j) => ctx.oneAxis && d.measures[j].role !== "rate";
    const hasRight = !m.nc && d.measures.some((_, j) => j > 0 && !oneAxis(j));
    const pl = pad(ctx, 60, 44), pr = hasRight ? Math.max(56, pad(ctx, 60, 40)) : pad(ctx, 60, 40), pt = months ? 30 : LBL.top ? 22 : 12, iw = W - pl - pr;
    const cat = ax.cat ? catAxis(ax.ticks.map(tickOf), iw, H, ctx) : null;      // 項目の軸は字の幅で置き方を決める（版 3.47.0）
    const pb = pad(ctx, 40, 26) + (cat ? cat.extra : tiltPad(ax.ticks.map(tickOf))), ih = H - pt - pb;
    const x = (i) => pl + iw * (i + 0.5) / Math.max(n, 1), bw = Math.max(2, Math.min(40, iw / Math.max(n, 1) * 0.7));
    return { m, d, s, W, H, L, ax, n, months, lab, tickOf, oneAxis, pl, pr, pt, iw, cat, pb, ih, x, bw, base0: pt + ih, g: "", thin: 1, placed: [] };
  }
  /** 系列（名前・値の段・軸・形・色）を組む → T.series */
  function trendSeries(T, ctx, mode) {
    const { m, d, ax, n, L, oneAxis } = T, series = [], colsData = dataCols(m);
    const additive0 = ADDITIVE.has(d.measures[0].agg) && !d.measures[0].show;
    const stack = m.nc > 0 && additive0 && (mode === "time" || mode === "stackarea");
    const kind0 = mode === "time" ? (stack ? "stack" : "bar") : mode === "stackarea" && stack ? "sarea" : mode === "area" || mode === "stackarea" ? "area" : "line";
    if (m.nc) colsData.forEach((c, k) => { const nm = m.colName(c); series.push({ name: nm, j: 0, c, axis: "left", kind: stack ? (mode === "time" ? "stack" : "sarea") : kind0 === "bar" ? "line" : kind0, color: cof(nm, COLORS[(k + 1) % COLORS.length]) }); });
    // ctx.oneAxis（別のデータを合わせた答え。目標と実績は同じ単位）: 達成率（%）のほかは左の同じ目盛り
    else d.measures.forEach((mm, j) => { const nm = ctx.measName(mm); series.push({ name: nm, j, c: ALL, axis: j === 0 || oneAxis(j) ? "left" : "right", kind: j === 0 ? (kind0 === "bar" && !ADDITIVE.has(mm.agg) ? "line" : kind0 === "sarea" ? "area" : kind0) : "line", color: cof(nm, COLORS[j % COLORS.length]) }); });
    // 組み合わせ（版 3.46.0。利用者の要望 2026-10-21 の 3: グラフ同士を汎用に組み合わせる）: 1 つ目の系列は棒・ほかは折れ線（既定）。
    // どの形でも、書式の「系列」で系列ごとに形（棒・線・面）と軸（左・右）を決められる（値・列の段・設備ごとの系列・別のデータ〈目標と実績〉のどれでも）
    const combo = mode === "combo";
    series.forEach((q, i) => { const f = serFmt(q.name); if (f.kind) q.kind = f.kind; else if (combo) q.kind = i === 0 ? "bar" : "line"; if (f.axis) q.axis = f.axis; else if (combo && !oneAxis(q.j)) q.axis = "auto"; });
    // 横に並べる段（日付など）ごとの値。その下にも段があれば、その段の小計（段の頭の組の数）を使う
    const at = (r) => ax.at(r.path[L]);
    const pick = (ser) => {
      const v = new Array(n).fill(null);
      const rowsAt = m.nr > L + 1 ? m.rows.filter((r) => r.type === "sub" && r.path.length === L + 1) : dataRows(m);
      rowsAt.forEach((r) => { const i = at(r); if (i >= 0) v[i] = m.value(r, ser.c, ser.j); });
      if (m.nr > L + 1 && !rowsAt.length) dataRows(m).forEach((r) => { const i = at(r); if (i >= 0) v[i] = (v[i] || 0) + (m.value(r, ser.c, ser.j) || 0); });
      return v;
    };
    // 時の段の足し上げる値（件数・ロット数・合計）は、無い日を 0 に（作業しなかった日＝0。線が途切れない）。平均などは無いまま
    series.forEach((q) => { q.v = pick(q); if (!ax.cat && ADDITIVE.has(d.measures[q.j].agg) && !d.measures[q.j].show) q.v = q.v.map((v) => v ?? 0); });
    // 組み合わせの軸の既定: 1 つ目の系列と桁が 3 倍より違う系列は右の目盛り（同じくらいなら左の目盛りで重ねて比べる）
    const peak = (q) => Math.max(0, ...q.v.filter((v) => v != null).map(Math.abs));
    series.forEach((q, i) => { if (q.axis !== "auto") return; const a = peak(series[0]), b = peak(q); q.axis = i === 0 || !a || !b || (b / a <= 3 && a / b <= 3) ? "left" : "right"; });
    if (SER) series.forEach((q) => SER.set(q.name, { kind: q.kind === "stack" ? "bar" : q.kind === "sarea" ? "area" : q.kind, axis: q.axis }));
    T.series = series;
  }
  /** 目盛り（左・右）と y の置き方。左右の軸を描く */
  function trendScale(T) {
    const { series, ax, pt, ih, pl, W } = T;
    const stacked = series.filter((q) => q.kind === "stack" || q.kind === "sarea");
    const tops = stacked.length ? ax.ticks.map((_, i) => stacked.reduce((a, q) => a + (q.v[i] || 0), 0)) : [];
    const maxL = topOf(Math.max(0, ...tops, ...series.filter((q) => q.axis === "left" && !stacked.includes(q)).flatMap((q) => q.v.filter((v) => v != null))));
    const loL = lowOf(maxL);
    const maxR = niceMax(Math.max(0, ...series.filter((q) => q.axis === "right").flatMap((q) => q.v.filter((v) => v != null))));
    T.y = (v, q) => (q.axis === "left" ? pt + ih * (1 - Math.max(0, Math.min(1, (v - loL) / (maxL - loL)))) : pt + ih * (1 - v / maxR));
    T.stacked = stacked; T.tops = tops;
    T.g += axisY(pl, pt, ih, maxL, false, W, series.some((q) => q.axis === "left" && q.kind === "bar") ? COLORS[0] : MUTED, nf, loL);
    if (series.some((q) => q.axis === "right")) T.g += axisY(pl, pt, ih, maxR, true, W, COLORS[1]);
  }
  /** 積み上げの棒・積み上げ面 */
  function trendStacks(T) {
    const { stacked, tops, ax, x, y, bw, lab, n, iw } = T;
    if (!stacked.length) return;
    if (stacked[0].kind === "stack") ax.ticks.forEach((k, i) => {
      let base = 0;
      stacked.forEach((q) => {
        const v = q.v[i] || 0; if (!v) return; const y1 = y(base + v, q), y0 = y(base, q);
        T.g += `<rect x="${x(i) - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1)}" fill="${q.color}"><title>${esc(lab(k))}: ${esc(q.name)} ${esc(fmt(v))}（計 ${esc(fmt(tops[i]))}）</title></rect>`;
        // 段が棒ぜんたい（ほかの段が 0）なら、中の数は上の合計と同じ字になるので書かない（§9.628 の採点: 「2」が上と中に並んだ）
        if (LBL.inside && !(LBL.top && v === tops[i]) && y0 - y1 >= 13 && bw >= lf(v, q.name).length * 6.2 + 2) T.g += `<text x="${x(i)}" y="${(y0 + y1) / 2 + 4}" text-anchor="middle" class="pv-vl pv-in">${esc(lf(v, q.name))}</text>`;
        base += v;
      });
    });
    if (stacked[0].kind === "sarea") {      // 積み上げ面: 下の系列から順に、前の高さの上に重ねる
      const acc = new Array(n).fill(0);
      stacked.forEach((q) => {
        const lo = acc.slice(), hi = acc.map((a, i) => a + (q.v[i] || 0));
        const top = hi.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v, q).toFixed(1)}`).join("");
        const bot = lo.map((v, i) => `L${x(n - 1 - i).toFixed(1)},${y(lo[n - 1 - i], q).toFixed(1)}`).join("");
        T.g += `<path d="${top}${bot}Z" fill="${q.color}" opacity=".78"><title>${esc(q.name)}</title></path>`;
        if (LBL.inside) hi.forEach((v, i) => { const h = y(lo[i], q) - y(v, q), val = q.v[i] || 0; if (val && h >= 13 && iw / n >= lf(val, q.name).length * 6.2) T.g += `<text x="${x(i)}" y="${(y(v, q) + y(lo[i], q)) / 2 + 4}" text-anchor="middle" class="pv-vl pv-in">${esc(lf(val, q.name))}</text>`; });
        hi.forEach((v, i) => { acc[i] = v; });
      });
    }
  }
  /** 棒（積み上げでない）・面・線と点 */
  function trendMarks(T) {
    const { series, x, y, bw, base0, ax, lab, n } = T;
    // 棒の系列が 2 つ以上（組み合わせで棒にした系列）は、横に並べる（重ねて隠さない）
    const barQ = series.filter((q) => q.kind === "bar"), nb = barQ.length, sw = nb > 1 ? bw / nb : bw;
    barQ.forEach((q, k) => { const off = -bw / 2 + k * sw; q.v.forEach((v, i) => {
      if (!v) return;
      T.g += `<rect x="${x(i) + off}" y="${y(v, q)}" width="${nb > 1 ? Math.max(1, sw - 1) : bw}" height="${Math.max(0, base0 - y(v, q))}" fill="${q.color}"><title>${esc(lab(ax.ticks[i]))}: ${esc(q.name)} ${esc(fmt(v))}</title></rect>`;
      if (LBL.inside && !LBL.top && base0 - y(v, q) >= 16 && sw >= lf(v, q.name).length * 6.2 + 2) T.g += `<text x="${x(i) + off + sw / 2}" y="${y(v, q) + 13}" text-anchor="middle" class="pv-vl pv-in">${esc(lf(v, q.name))}</text>`;
    }); });
    T.barQ = barQ;
    series.filter((q) => q.kind === "area").forEach((q) => {
      const pts = q.v.map((v, i) => (v == null ? null : [x(i), y(v, q)])).filter(Boolean);
      if (pts.length > 1) T.g += `<path d="M${pts[0][0].toFixed(1)},${base0}${pts.map(([a, b]) => `L${a.toFixed(1)},${b.toFixed(1)}`).join("")}L${pts[pts.length - 1][0].toFixed(1)},${base0}Z" fill="${q.color}" opacity="${series.length > 1 ? 0.22 : 0.3}"/>`;
    });
    series.filter((q) => q.kind === "line" || q.kind === "area").forEach((q) => {
      let path = "", pen = false;
      q.v.forEach((v, i) => { if (v == null) { pen = false; return; } path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v, q).toFixed(1)}`; pen = true; });
      T.g += `<path d="${path}" fill="none" stroke="${q.color}" stroke-width="2.2"${serFmt(q.name).dash ? ' stroke-dasharray="6 4"' : ""}/>`;
      if (n <= 120) q.v.forEach((v, i) => { if (v != null) T.g += `<circle cx="${x(i)}" cy="${y(v, q)}" r="${q.kind === "area" ? 2.2 : 2.8}" fill="#fff" stroke="${q.color}" stroke-width="1.8"><title>${esc(lab(ax.ticks[i]))}: ${esc(q.name)} ${esc(fmt(v))}</title></circle>`; });
    });
  }
  /** 横の目盛りの字・下の線・参照線・月の境目 */
  function trendAxes(T) {
    const { cat, n, iw, ax, x, H, pb, tickOf, pl, pr, W, base0, series, y, months, pt } = T;
    const every = cat ? cat.every : Math.max(1, Math.ceil(n / Math.max(4, Math.floor(iw / (F.xrot && +F.xrot ? 18 : 70)))));
    // 時の軸は終わり（今日・今月）から数えて間引く（終わりの日にいつも字がある・§9.628 の採点）
    ax.ticks.forEach((k, i) => { if ((cat ? i : ax.ticks.length - 1 - i) % every === 0) T.g += cat ? cat.text(i, x(i), H - pb + 16) : xText(x(i), H - pb + 16, fitW(tickOf(k), (iw / n) * every - 4)); });
    T.g += `<line x1="${pl}" x2="${W - pr}" y1="${base0}" y2="${base0}" class="pv-axis"/>`;
    const leftQ = series.find((q) => q.axis === "left") || series[0];
    T.g += refLines((v) => y(v, leftQ), pl, W - pr, pt, base0);
    // 月の境目（月で区切ったとき）: 月が替わる所に縦の点線、月の真ん中の上に「2026年9月」
    if (!months) return;
    let from = 0;
    ax.ticks.forEach((k, i) => {
      if (!(i === n - 1 || ax.ticks[i + 1].slice(0, 7) !== k.slice(0, 7))) return;
      if (i < n - 1) { const xb = (x(i) + x(i + 1)) / 2; T.g += `<line x1="${xb}" x2="${xb}" y1="${pt - 18}" y2="${base0}" class="pv-msep"/>`; }
      const name = `${+k.slice(0, 4)}年${+k.slice(5, 7)}月`, half = name.length * 6;     // 月の名前は描く所（左右の目盛りの内側）に収める
      T.g += `<text x="${Math.min(W - pr - half, Math.max(pl + half, (x(from) + x(i)) / 2))}" y="${pt - 8}" text-anchor="middle" class="pv-mname">${esc(name)}</text>`;
      from = i + 1;
    });
  }
  /** 1 つ目の系列（棒・積み上げの頭）の数値ラベル */
  function trendLeadLabels(T) {
    const { stacked, tops, series, y, iw, n, x, W, base0, bw, placed } = T;
    const lead = stacked.length ? { v: tops, y: (v) => y(v, stacked[0]), name: "" } : series[0] && series[0].kind === "bar" ? { v: series[0].v, y: (v) => y(v, series[0]), name: series[0].name } : null;
    if (!(lead && labelWant(lead.name))) return;
    T.thin = thinOf(lead.v, iw / Math.max(n, 1));
    // 線（2 つ目の値）の点がラベルの所を通るなら、ラベルは棒の中へ（入らなければ出さない。値は棒の title で見える）。
    // 目標の棒と実績の線を重ねたとき、線が数字を横切っていた（2026-10-dashlink の 2 回目の採点）
    const lines = series.filter((q) => q.kind === "line" || q.kind === "area");
    lead.v.forEach((v, i) => {
      if (!v || i % T.thin) return;
      const ly = lead.y(v) - 5, hit = lines.some((q) => q.v[i] != null && Math.abs(y(q.v[i], q) - (ly - 4)) < 13);
      if (!hit) { T.g += labelAt(placed, x(i), ly, lf(v, lead.name), "", W); return; }
      // 棒の中の字には棒の色の縁（線の脚が字を横切っても、字の所だけ線が隠れる。3 回目の採点: 山の点で線の脚が字に掛かった）
      if (!stacked.length && base0 - lead.y(v) >= 18 && bw >= lf(v, lead.name).length * 6.2 + 2) T.g += `<text x="${x(i)}" y="${lead.y(v) + 15}" text-anchor="middle" class="pv-vl pv-in" style="stroke:${series[0].color};stroke-width:4px;paint-order:stroke;stroke-linejoin:round">${esc(nf(v))}</text>`;
    });
  }
  /** 線・面の系列の数値ラベルを置くときの障り（点・線の脚・棒） */
  function trendObstacles(T) {
    const { series, x, y, bw, base0, barQ, placed } = T;
    // 点は障りにする（ラベルが点に被らない）・線の脚は避けられれば避ける（2026-10-dashslice の 1 回目の採点: 同じ日の近い値で字が重なり、線と被った）
    const allLines = series.filter((q) => q.kind === "line" || q.kind === "area");
    allLines.forEach((q) => q.v.forEach((v, i) => { if (v != null) placed.push({ x0: x(i) - 3.5, x1: x(i) + 3.5, y0: y(v, q) - 3.5, y1: y(v, q) + 3.5, pt: true }); }));
    const segs = allLines.flatMap((q) => q.v.map((v, i) => (v != null && q.v[i + 1] != null ? [x(i), y(v, q), x(i + 1), y(q.v[i + 1], q)] : null)).filter(Boolean));
    // 線の脚は 2px おきに調べる（8 等分では、長い脚が字の枠をすり抜けた: 2026-10-combo の 2 回目の採点）
    const crosses = (b) => segs.some(([ax, ay, bx, by]) => { const k = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 2)); for (let s = 0; s <= k; s++) { const px = ax + (bx - ax) * s / k, py = ay + (by - ay) * s / k; if (px > b.x0 - 1 && px < b.x1 + 1 && py > b.y0 - 1 && py < b.y1 + 1) return true; } return false; });
    // 棒も障り（線のラベルが棒の頭に被らない。同じ 2 回目の採点: 「2,864.6」が棒の上に被った）
    const bars = barQ.flatMap((q) => q.v.map((v, i) => (v ? { x0: x(i) - bw / 2, x1: x(i) + bw / 2, y0: y(v, q), y1: base0 } : null)).filter(Boolean));
    const onBar = (b) => bars.some((o) => b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1);
    return { crosses, onBar };
  }
  /** 線・面の系列（版 3.41.0。利用者の要望: 折れ線で 1 つの系列にしかラベルが付かなかった）: どの系列にも付ける。
      置き場は系列ごとの書式（上・下）か、自動（その点で値がいちばん小さい系列は下・ほかは上）。ほかのラベルと重なれば反対側、それも重なれば出さない。
      系列が 2 つ以上なら、字を系列の色にする（どの線の数か分かる） */
  function trendLineLabels(T) {
    const { series, iw, n, y } = T;
    const lineQ = series.filter((q) => (q.kind === "line" || q.kind === "area") && labelWant(q.name));
    const O = trendObstacles(T);
    const shown = new Map();         // 同じ日に同じ値の系列は、ラベルを 1 つにまとめる（字の色は墨）
    lineQ.forEach((q) => {
      const th = thinOf(q.v, iw / Math.max(n, 1)), pos = serFmt(q.name).label, tint = series.length > 1 ? q.color : "";
      T.thin = Math.max(T.thin, th);
      q.v.forEach((v, i) => {
        if (v == null || i % th) return;
        const same = lineQ.filter((r) => r !== q && r.v[i] === v);
        if (same.length && shown.has(`${i}:${v}`)) return;
        const others = lineQ.filter((r) => r !== q && r.v[i] != null && r.v[i] !== v).map((r) => r.v[i]);
        const low = pos === "below" || (pos !== "top" && others.length > 0 && others.every((o) => v < o));
        const txt = lineLabel(T, O, q, v, i, y(v, q), { low, pos, tint: same.length ? "" : tint });
        if (txt) { T.g += txt; if (same.length) shown.set(`${i}:${v}`, true); }
      });
    });
  }
  /** 線の 1 点の数値ラベルを置く → 描いた字（置けなければ ""）。
      置き場の候補: 上・下（自動は値の小さい系列が下）、次に点の右上・左上・右下・左下。
      順に: 線の脚も棒も避けられる所 → 上・下で棒を避けられる所に白い札を敷いて（線は札の下をくぐる）→ 棒の上でも線を避けられる所 → 上・下に札 */
  function lineLabel(T, O, q, v, i, cy, o) {
    const { x, placed, W, pt, base0 } = T, { crosses, onBar } = O;
    const w = String(lf(v, q.name)).length * 6.4 + 4, side = w / 2 + 6;
    const ud = (o.low ? [[0, 15], [0, -7]] : [[0, -7], [0, 15]]).map(([dx, dy]) => [x(i) + dx, cy + dy]);
    const tries = [...ud, ...[[side, -5], [-side, -5], [side, 13], [-side, 13]].map(([dx, dy]) => [x(i) + dx, cy + dy])];
    const at = (t) => ({ x0: t[0] - w / 2, x1: t[0] + w / 2, y0: t[1] - 11, y1: t[1] + 2 });
    const free = (t) => !crosses(at(t));
    // 系列の書式で上・下を決めていれば、その向きを守る（横へは逃がさない。線と重なれば札を敷く）。逃げるのは置けないときだけ反対側
    /** 置き場の候補と、白い札を敷くか → [場所, 敷く] */
    const pair = (t, plate) => /** @type {[number[], boolean]} */ ([t, plate]);
    const order = o.pos === "top" || o.pos === "below" ? ud.map((t) => pair(t, !free(t)))
      : [...tries.filter((t) => free(t) && !onBar(at(t))).map((t) => pair(t, false)), ...ud.filter((t) => !onBar(at(t))).map((t) => pair(t, true)),
        ...tries.filter((t) => free(t) && onBar(at(t))).map((t) => pair(t, false)), ...ud.map((t) => pair(t, true))];
    for (const [t, plate] of order) { const txt = labelAt(placed, t[0], t[1], lf(v, q.name), o.tint, W, Math.max(1, pt - 14), base0, plate); if (txt) return txt; }
    return "";
  }
  /** 管理図（I 管理図・個々の値）: 行の葉を並びのまま点にし、中心線＝平均、管理限界＝平均 ± 3σ（σ＝隣どうしの差〈移動範囲〉の平均 ÷ 1.128）。
      限界の外の点は赤、中心線の同じ側に 9 点以上続く所（連）は橙（JIS Z 9020-2 の判定ルール 1・2） */
  function controlChart(ctx) {
    const { m, d, W, H } = ctx, j = chartAt(ctx);
    const pts = dataRows(m).map((r) => ({ r, v: m.value(r, ALL, j) })).filter((p) => p.v != null);
    if (pts.length < 3) return empty("管理図は、点（行の葉）が 3 つ以上あるときに描けます。行に日付・作業日・ロット番号などの順の段を入れてください。");
    const vs = pts.map((p) => p.v), n = vs.length, mean = vs.reduce((a, b) => a + b, 0) / n;
    const mr = vs.slice(1).reduce((a, v, i) => a + Math.abs(v - vs[i]), 0) / (n - 1), sigma = mr / 1.128;
    const ucl = mean + 3 * sigma, lcl = mean - 3 * sigma;
    // 判定: 限界の外（ルール 1）・中心線の同じ側に 9 点以上（ルール 2）
    const out = vs.map((v) => v > ucl || v < lcl), run = new Array(n).fill(false);
    for (let i = 0, k = 0; i < n; i = k) {
      const side = Math.sign(vs[i] - mean); k = i + 1;
      if (side !== 0) while (k < n && Math.sign(vs[k] - mean) === side) k++;
      if (side !== 0 && k - i >= 9) for (let t = i; t < k; t++) run[t] = true;
    }
    const sw = sideW(ctx), w = W - sw, pl = pad(ctx, 60, 44), pr = pad(ctx, 64, 56), pt = 14, pb = pad(ctx, 40, 26) + tiltPad(pts.map((p) => tickLabel(m, d, p.r))), iw = w - pl - pr, ih = H - pt - pb;
    const r = rangeFix(niceRange(Math.min(lcl, ...vs), Math.max(ucl, ...vs)));
    const y = (v) => pt + ih * (1 - (v - r.lo) / (r.hi - r.lo)), x = (i) => pl + iw * (i + 0.5) / n;
    let g = axisRange(r, pl, w - pr, y) + refLines(y, pl, w - pr, pt, pt + ih);
    const hline = (v, cls, name) => `<line x1="${pl}" x2="${w - pr}" y1="${y(v)}" y2="${y(v)}" class="${cls}"/><text x="${w - pr + 4}" y="${y(v) + 4}" class="pv-ax ${cls}-t">${name} ${esc(nf(v))}</text>`;
    g += hline(ucl, "pv-lim", "UCL") + hline(mean, "pv-cl", "CL") + (lcl > r.lo - 1e-9 ? hline(lcl, "pv-lim", "LCL") : "");
    g += `<path d="${vs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")}" fill="none" stroke="${COLORS[2]}" stroke-width="1.8"/>`;
    vs.forEach((v, i) => { const c = out[i] ? ALERT : run[i] ? WARN : COLORS[2]; g += `<circle cx="${x(i)}" cy="${y(v)}" r="${out[i] || run[i] ? 4.2 : 3}" fill="${out[i] || run[i] ? c : "#fff"}" stroke="${c}" stroke-width="1.8"><title>${esc(m.rowName(pts[i].r))}: ${esc(fmt(v))}${out[i] ? "（管理限界の外）" : run[i] ? "（中心線の同じ側に 9 点以上）" : ""}</title></circle>`; });
    if (LBL.top) { const thin = thinOf(vs, iw / n); vs.forEach((v, i) => { if (i % thin === 0) g += `<text x="${x(i)}" y="${y(v) - 7}" text-anchor="middle" class="pv-vl">${esc(lf(v))}</text>`; }); }
    const every = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(iw / (F.xrot && +F.xrot ? 18 : 80)))));
    pts.forEach((p, i) => { if (i % every === 0) g += xText(x(i), H - pb + 16, F.xrot && +F.xrot ? fitW(tickLabel(m, d, p.r), 150) : fitW(tickLabel(m, d, p.r), (iw / n) * every - 4)); });
    g += `<line x1="${pl}" x2="${w - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>`;
    const nOut = out.filter(Boolean).length, nRun = run.filter(Boolean).length;
    const side = statsBox(`${ctx.measName(d.measures[j])} の管理図`, [["点の数", n], ["中心線（平均）", mean], ["UCL（＋3σ）", ucl], ["LCL（−3σ）", lcl], ["σ（移動範囲から）", sigma],
      ["管理限界の外", `${nOut} 点`, nOut ? "is-alert" : ""], ["同じ側に 9 点以上", `${nRun} 点`, nRun ? "is-warn" : ""]],
    "I 管理図: σ＝隣どうしの差の平均 ÷ 1.128。赤＝限界の外、橙＝中心線の同じ側に 9 点以上続く所");
    return { svg: svgOf(w, H, g, "管理図"), legend: legendHtml([[ctx.measName(d.measures[j]), COLORS[2], "line"], ["管理限界（±3σ）", ALERT, "line"]]), side };
  }
  /** 行の葉の横の字（時の段なら短く 6/4、そうでなければ行の名前） */
  const tickLabel = (m, d, r) => { const L = r.path.length - 1, x = d.dims.rows[L]; return x && isTimeDim(x) ? tickText(r.path[L], x.column === "@workday" ? ({ ym: "ym", year: "year" }[x.part] || "date") : x.part) : m.rowName(r); };

  /* ================= 比べる ================= */
  /** 行の葉の名前（時の段なら書式の日付の形。そうでなければ行の名前） */
  const catName = (m, d, r) => (d.dims.rows[r.path.length - 1] && isTimeDim(d.dims.rows[r.path.length - 1]) ? tickLabel(m, d, r) : m.rowName(r));
  /** 縦棒・横棒・ロリポップ（dir: column・bar・lollipop）: 行の葉ごとに、列の葉（1 つ目の値）か値（グラフにする値を選ぶ）の棒（ロリポップは線と点） */
  function barChart(ctx, dir, wanted) {
    const { m, d, W, H } = ctx, data = dataRows(m).slice(0, 80), colsData = dataCols(m), j = chartAt(ctx);
    const series = m.nc ? colsData.map((c, k) => { const nm = m.colName(c); return { name: nm, c, j, color: cof(nm, COLORS[k % COLORS.length]) }; })
      : [{ name: ctx.measName(d.measures[j]), c: ALL, j, color: cof(ctx.measName(d.measures[j]), COLORS[j % COLORS.length]) }];
    const vals = data.map((r) => series.map((q) => m.value(r, q.c, q.j) || 0));
    const max = topOf(Math.max(0, ...vals.flat())), lo = lowOf(max);
    const fill = (r, q) => cof(m.rowName(r), ctx.rowColor && series.length === 1 ? ctx.rowColor(m.rowName(r)) : q.color);
    const frac = (v) => Math.max(0, Math.min(1, (v - lo) / (max - lo)));
    const names = data.map((r) => catName(m, d, r));
    let g = "";
    if (dir !== "bar") {
      // 名前の置き方は字の幅で決める（1 段 → 2 段 → 斜め。書式で向きを決めていれば、その向き。版 3.47.0）
      const pl = pad(ctx, 60, 44), pr = pad(ctx, 20, 10), pt = LBL.top ? 22 : 12, iw = W - pl - pr, cat = catAxis(names, iw, H, ctx);
      const pb = pad(ctx, 56, 30) + cat.extra, ih = H - pt - pb, gw = iw / Math.max(data.length, 1), bw = Math.max(2, Math.min(36, gw * 0.8 / series.length));
      g += axisY(pl, pt, ih, max, false, W + 36, MUTED, nf, lo);
      const thin = thinOf(vals.flat(), bw);
      data.forEach((r, i) => {
        series.forEach((q, k) => {
          const v = vals[i][k], h = ih * frac(v), bx = pl + gw * i + (gw - bw * series.length) / 2 + bw * k, c = fill(r, q);
          const tip = `<title>${esc(m.rowName(r))}${series.length > 1 ? ` / ${esc(q.name)}` : ""}: ${esc(fmt(v))}</title>`;
          if (dir === "lollipop") g += `<line x1="${bx + bw / 2}" x2="${bx + bw / 2}" y1="${pt + ih}" y2="${pt + ih - h}" stroke="${c}" stroke-width="2"/><circle cx="${bx + bw / 2}" cy="${pt + ih - h}" r="${Math.max(3, Math.min(7, bw / 3))}" fill="${c}">${tip}</circle>`;
          else g += `<rect x="${bx}" y="${pt + ih - h}" width="${bw}" height="${h}" fill="${c}">${tip}</rect>`;
          if (labelWant(q.name) && serFmt(q.name).label !== "below" && v && (i * series.length + k) % thin === 0) g += `<text x="${bx + bw / 2}" y="${pt + ih - h - (dir === "lollipop" ? 9 : 4)}" text-anchor="middle" class="pv-vl">${esc(lf(v, q.name))}</text>`;
          if (LBL.inside && dir !== "lollipop" && v && h >= 16 && bw >= lf(v, q.name).length * 6.2 + 2) g += `<text x="${bx + bw / 2}" y="${pt + ih - h + 13}" text-anchor="middle" class="pv-vl pv-in">${esc(lf(v, q.name))}</text>`;
        });
        if (i % cat.every === 0) g += cat.text(i, pl + gw * (i + 0.5), H - pb + 16);
      });
      g += `<line x1="${pl}" x2="${W - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>` + refLines((v) => pt + ih * (1 - frac(v)), pl, W - pr, pt, pt + ih);
    } else {
      // 名前の字の幅（いちばん長い名前を測る。幅の 4 割まで）だけ左を空ける（版 3.47.0。前は字の数 × 12.5px・詰めない形は 160px 決め打ちで、長い名前が左へはみ出した）
      const longest = Math.max(0, ...names.map((t) => textW(t)));
      const pl = Math.round(Math.max(ctx.compact ? 44 : 80, Math.min(W * 0.4, longest + 16))), pr = pad(ctx, 70, 52), pt = pad(ctx, 8, 4);
      // 1 行の高さは 36px まで（行が少ないと棒が面いっぱいに離れて並び、何本あるか・どれが長いかを比べにくかった・§9.628）。上から詰める
      const rh = Math.min(36, (H - pad(ctx, 30, 8)) / Math.max(data.length, 1)), bh = Math.max(3, Math.min(18, rh * 0.75 / series.length)), iw = W - pl - pr;
      data.forEach((r, i) => {
        g += `<text x="${pl - 8}" y="${pt + rh * (i + 0.5) + 4}" text-anchor="end" class="pv-ax">${esc(fitW(names[i], pl - 10))}</text>`;
        series.forEach((q, k) => {
          const v = vals[i][k], w = iw * frac(v), by = pt + rh * i + (rh - bh * series.length) / 2 + bh * k;
          g += `<rect x="${pl}" y="${by}" width="${w}" height="${bh}" fill="${fill(r, q)}"><title>${esc(m.rowName(r))}${series.length > 1 ? ` / ${esc(q.name)}` : ""}: ${esc(fmt(v))}</title></rect>`;
          if (LBL.inside && v && w >= lf(v, q.name).length * 6.2 + 8 && bh >= 11) g += `<text x="${pl + w - 4}" y="${by + bh / 2 + 4}" text-anchor="end" class="pv-vl pv-in">${esc(lf(v, q.name))}</text>`;
          else if (series.length === 1 || LBL.top) g += `<text x="${pl + w + 6}" y="${by + bh - 2}" class="${LBL.top ? "pv-vl" : "pv-ax"}">${esc(lf(v, q.name))}</text>`;
        });
      });
      g += refLinesX((v) => pl + iw * frac(v), pt, H - pad(ctx, 30, 8) + pt, pl, pl + iw);
    }
    const note = (wanted ? '<small class="pv-cnote">時系列は、行の 1 段目が日付（年月日・年月・年）か作業日のときに描けます。いまは棒で出しています</small>' : "")
      + (dataRows(m).length > 80 ? '<small class="pv-cnote">先頭 80 件まで描いています</small>' : "");
    return { svg: svgOf(W, H, g, dir === "lollipop" ? "ロリポップ図" : "棒グラフ"), legend: legendHtml(series.map((q) => [q.name, q.color, "bar"])) + note };
  }
  /** パレート図: 行の葉を値の大きい順に並べた棒と、累積の割合の折れ線（右の目盛り 0〜100%）・80% の線。
      描き切れない分（下位）は「その他」にまとめて最後に（足し上げる値のときだけ。平均などは足せないので先頭だけ） */
  function paretoChart(ctx) {
    const { m, d, W, H } = ctx, j = chartAt(ctx), add = ADDITIVE.has(d.measures[j].agg);
    let items = dataRows(m).map((r) => ({ name: m.rowName(r), v: m.value(r, ALL, j) || 0 })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    if (!items.length) return empty("パレート図にできる値（0 より大きい値）がありません。");
    const pl = pad(ctx, 60, 44), pr = pad(ctx, 56, 44), pt = LBL.top ? 24 : 14, iw = W - pl - pr;
    const K = Math.min(items.length, Math.max(5, Math.min(30, Math.floor(iw / 38))));
    const total = items.reduce((a, x) => a + x.v, 0);
    if (items.length > K) items = add ? items.slice(0, K - 1).concat([{ name: `その他（${items.length - K + 1} 件）`, v: items.slice(K - 1).reduce((a, x) => a + x.v, 0), rest: true }]) : items.slice(0, K);
    let cum = 0;
    items.forEach((x) => { cum += x.v; x.cum = cum / total; });
    const cat = catAxis(items.map((x) => x.name), iw, H, ctx), pb = pad(ctx, 56, 30) + cat.extra, ih = H - pt - pb;
    const max = niceMax(items[0].v), n = items.length, gw = iw / n, bw = Math.max(4, Math.min(48, gw * 0.78));
    const y = (v) => pt + ih * (1 - v / max), yp = (p) => pt + ih * (1 - p);
    let g = axisY(pl, pt, ih, max, false, W - pr + 56, COLORS[0]);
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => { g += `<text x="${W - pr + 6}" y="${yp(f) + 4}" class="pv-ax" fill="${COLORS[1]}">${f * 100}%</text>`; });
    g += `<line x1="${pl}" x2="${W - pr}" y1="${yp(0.8)}" y2="${yp(0.8)}" class="pv-p80"/><text x="${W - pr - 4}" y="${yp(0.8) - 4}" text-anchor="end" class="pv-ax pv-p80-t">80%</text>`;
    const k80 = items.findIndex((x) => x.cum >= 0.8 - 1e-9);
    items.forEach((x, i) => {
      const cx = pl + gw * (i + 0.5);
      g += `<rect x="${cx - bw / 2}" y="${y(x.v)}" width="${bw}" height="${pt + ih - y(x.v)}" fill="${x.rest ? "#a9b4be" : cof(x.name, COLORS[0])}" opacity="${i <= k80 || x.rest ? 1 : 0.55}"><title>${esc(x.name)}: ${esc(fmt(x.v))}（${pct(x.v / total)}・累積 ${pct(x.cum)}）</title></rect>`;
      if (i % cat.every === 0) g += cat.text(i, cx, H - pb + 16);
      if (LBL.top) g += `<text x="${cx}" y="${y(x.v) - 5}" text-anchor="middle" class="pv-vl">${esc(lf(x.v))}</text>`;
      if (LBL.inside && pt + ih - y(x.v) >= 16 && bw >= lf(x.v).length * 6.2 + 2) g += `<text x="${cx}" y="${y(x.v) + 13}" text-anchor="middle" class="pv-vl pv-in">${esc(lf(x.v))}</text>`;
    });
    g += `<path d="${items.map((x, i) => `${i ? "L" : "M"}${(pl + gw * (i + 0.5)).toFixed(1)},${yp(x.cum).toFixed(1)}`).join("")}" fill="none" stroke="${COLORS[1]}" stroke-width="2.2"/>`;
    items.forEach((x, i) => { g += `<circle cx="${pl + gw * (i + 0.5)}" cy="${yp(x.cum)}" r="3" fill="#fff" stroke="${COLORS[1]}" stroke-width="1.8"><title>累積 ${pct(x.cum)}</title></circle>`; });
    g += `<line x1="${pl}" x2="${W - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>`;
    const note = `<small class="pv-cnote">大きい順・上位 ${k80 + 1} 件で ${pct(items[k80].cum)}（濃い棒）${add ? "" : "・平均などは足せないので、その他にまとめません"}</small>`;
    return { svg: svgOf(W, H, g, "パレート図"), legend: legendHtml([[ctx.measName(d.measures[j]), COLORS[0], "bar"], ["累積の割合（右）", COLORS[1], "line"]]) + note };
  }

  /** ウォーターフォール図（版 3.50.0。利用者の要望 2026-10-22 の 3）: 行の段の並びのまま、1 つ目の値（グラフにする値）を前の棒の終わりから
      積み増す（増えた分は上へ・減った分は下へ浮かせた棒）。足し上げる値（件数・ロット数・合計）なら、終わりに「計」の棒（0 から）を立てる。
      棒の間は細い点線で前の終わりとつなぐ。色は 増加・減少・計（書式の名前ごとの色で替えられる）。増減は棒の向きと数値ラベルの符号でも分かる */
  function waterfallChart(ctx) {
    const { m, d, W, H } = ctx, j = chartAt(ctx), add = ADDITIVE.has(d.measures[j].agg) && !d.measures[j].show;
    // 日付・作業日の段は、時系列と同じ短い形（9/21）で書く（長い形は斜めになり、隣の札や値の字に被った: 2026-10-pvdrag の作った後の採点）
    const x0 = d.dims.rows[0], tpart = m.nr === 1 && isTimeDim(x0) ? (x0.column === "@workday" ? ({ ym: "ym", year: "year" }[x0.part] || "date") : x0.part) : null;
    const nameOf = (r) => (tpart ? tickText(r.path[0], tpart) : m.rowName(r));
    let items = dataRows(m).map((r) => ({ name: nameOf(r), v: m.value(r, ALL, j) })).filter((x) => typeof x.v === "number");
    if (!items.length) return empty("ウォーターフォール図にできる値がありません。");
    const pl = pad(ctx, 64, 44), pr = pad(ctx, 20, 10), pt = LBL.top ? 26 : 14, iw = W - pl - pr;
    const K = Math.max(3, Math.min(40, Math.floor(iw / 30))) - (add ? 1 : 0);
    if (items.length > K) {
      const rest = items.slice(K - 1);
      items = add ? items.slice(0, K - 1).concat([{ name: `その他（${rest.length} 件）`, v: rest.reduce((a, x) => a + x.v, 0), rest: true }]) : items.slice(0, K);
    }
    let run = 0;
    const bars = items.map((x) => { const from = run; run += x.v; return { ...x, from, to: run, kind: x.v >= 0 ? "up" : "down" }; });
    if (add) bars.push({ name: "計", v: run, from: 0, to: run, kind: "total" });
    const ends = bars.flatMap((b) => [b.from, b.to]), hi0 = Math.max(0, ...ends), lo0 = Math.min(0, ...ends);
    const r = lo0 < 0 ? rangeFix(niceRange(lo0, hi0)) : null, top = r ? r.hi : topOf(hi0), lo = r ? r.lo : lowOf(top);
    const cat = catAxis(bars.map((b) => b.name), iw, H, ctx), pb = pad(ctx, 40, 24) + cat.extra, ih = H - pt - pb;
    const y = (v) => pt + ih * (1 - (v - lo) / ((top - lo) || 1)), n = bars.length, gw = iw / n, bw = Math.max(4, Math.min(56, gw * 0.7));
    const col = { up: cof("増加", "#2f7d78"), down: cof("減少", ALERT), total: cof("計", "#4f5d69") };   // 意味の色（系列の色の組に左右されない）
    let g = r ? axisRange(r, pl, W - pr, y) : axisY(pl, pt, ih, top, false, W - pr + 56, MUTED, nf, lo);
    g += refLines(y, pl, W - pr, pt, pt + ih);
    if (lo < 0) g += `<line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" class="pv-axis"/>`;
    const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + lf(Math.abs(v));
    bars.forEach((b, i) => {
      const cx = pl + gw * (i + 0.5), y0 = y(Math.max(b.from, b.to)), y1 = y(Math.min(b.from, b.to)), h = Math.max(1, y1 - y0);
      const word = b.kind === "total" ? "計" : b.kind === "up" ? "増加" : "減少";
      g += `<rect class="pv-wf pv-wf-${b.kind}" x="${cx - bw / 2}" y="${y0}" width="${bw}" height="${h}" fill="${b.rest ? "#a9b4be" : col[b.kind]}" rx="1.5">`
        + `<title>${esc(b.name)}: ${esc(b.kind === "total" ? fmt(b.v) : (b.v > 0 ? "+" : "") + fmt(b.v))}（${word}・${esc(fmt(b.from))} → ${esc(fmt(b.to))}）</title></rect>`;
      // 前の棒の終わり（＝この棒の始まり）とつなぐ点線
      if (i && b.kind !== "total") g += `<line x1="${cx - gw + bw / 2}" x2="${cx - bw / 2}" y1="${y(b.from)}" y2="${y(b.from)}" class="pv-wf-link"/>`;
      if (b.kind === "total" && i) g += `<line x1="${cx - gw + bw / 2}" x2="${cx - bw / 2}" y1="${y(b.to)}" y2="${y(b.to)}" class="pv-wf-link"/>`;
      if (i % cat.every === 0) g += cat.text(i, cx, H - pb + 16);
      const t = b.kind === "total" ? lf(b.v) : sign(b.v);
      // 値の字は増加・減少とも棒の上の端（減少の棒の下に置くと、横軸の札に被る）
      if (LBL.top) g += `<text x="${cx}" y="${y0 - 5}" text-anchor="middle" class="pv-vl">${esc(t)}</text>`;
      if (LBL.inside && h >= 16 && bw >= String(t).length * 6.2 + 2) g += `<text x="${cx}" y="${y0 + 13}" text-anchor="middle" class="pv-vl pv-in">${esc(t)}</text>`;
    });
    if (lo >= 0) g += `<line x1="${pl}" x2="${W - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>`;
    const legend = [["▲ 増加", col.up, "bar"], ["▼ 減少", col.down, "bar"]].concat(add ? [["計", col.total, "bar"]] : []);
    const note = add ? "" : `${ctx.measName(d.measures[j])}は足し上げられないので、計の棒は出しません`;
    return { svg: svgOf(W, H, g, "ウォーターフォール図"), legend: legendHtml(legend) + (note ? `<small class="pv-cnote">${esc(note)}</small>` : ""), note };
  }

  /* ================= 内訳を見る ================= */
  /** 積み上げ縦棒・100% 積み上げ: 行の葉ごとの棒を、列の葉（1 つ目の値）か値（足し上げる値が 2 つ以上）で積む。列が 12 を超えたら残りを「その他」に。
      棒の中のラベル（書式 inside。100% は今までどおり数値ラベルで）: 段ごとに、入る高さ・幅なら値（100% は割合） */
  function stackChart(ctx, share, horiz = false) {
    const { m, d, W, H } = ctx, data = dataRows(m).slice(0, 60), j = chartAt(ctx);
    let series;
    if (m.nc) {
      const cs = m.cols.filter((c) => c.type === "data");
      series = cs.slice(0, 12).map((c, k) => { const nm = m.colName(c); return { name: nm, get: (r) => m.value(r, c, j) || 0, color: cof(nm, COLORS[k % COLORS.length]) }; });
      if (cs.length > 12) series.push({ name: `その他（${cs.length - 12}）`, get: (r) => cs.slice(12).reduce((a, c) => a + (m.value(r, c, j) || 0), 0), color: "#a9b4be" });
    } else {
      const ms = d.measures.map((x, k) => [x, k]).filter(([x]) => ADDITIVE.has(x.agg));
      series = (ms.length > 1 ? ms : [[d.measures[j], j]]).map(([x, k], i) => { const nm = ctx.measName(x); return { name: nm, get: (r) => m.value(r, ALL, k) || 0, color: cof(nm, COLORS[i % COLORS.length]) }; });
    }
    const vals = data.map((r) => series.map((q) => Math.max(0, q.get(r)))), tops = vals.map((v) => v.reduce((a, b) => a + b, 0));
    const names = data.map((r) => catName(m, d, r));
    const max = share ? 1 : topOf(Math.max(0, ...tops)), lo = share ? 0 : lowOf(max);
    const note = (series.length < 2 ? `<small class="pv-cnote">内訳を積むには、［列］に段を入れるか、足し上げる値（件数・ロット数・合計）を 2 つ以上にしてください</small>` : "")
      + (dataRows(m).length > 60 ? '<small class="pv-cnote">先頭 60 件まで描いています</small>' : "");
    const kindName = `${share ? "100% " : ""}積み上げ${horiz ? "横" : ""}棒グラフ`;
    if (horiz) {
      // 横の積み上げ（版 3.48.0。利用者の要望 2026-10-21 の 3 回目の 2）: 行の段を縦に並べ、内訳を左から右へ積む（名前が長い・項目が多いとき）。
      // 左は名前の字の幅（横棒と同じ決め方）・下に目盛り・右に合計の数
      const longest = Math.max(0, ...names.map((t) => textW(t)));
      const pl = Math.round(Math.max(ctx.compact ? 44 : 80, Math.min(W * 0.4, longest + 16))), pr = share ? pad(ctx, 20, 10) : pad(ctx, 64, 48), pt = pad(ctx, 8, 4), pb = 20;
      const iw = Math.max(20, W - pl - pr), rh = (H - pt - pb) / Math.max(data.length, 1), bh = Math.max(3, Math.min(44, rh * 0.62));
      const xOf = (v) => pl + iw * Math.max(0, Math.min(1, (v - lo) / (max - lo)));
      let g = "";
      const fv = share ? (v) => `${Math.round(v * 100)}%` : nf;
      (iw >= 220 ? [0, 0.25, 0.5, 0.75, 1] : iw >= 110 ? [0, 0.5, 1] : [0, 1]).forEach((f) => {
        const x = pl + iw * f;
        g += `${F.grid === false ? "" : `<line x1="${x}" x2="${x}" y1="${pt}" y2="${H - pb}" class="pv-grid"/>`}<text x="${x}" y="${H - pb + 14}" text-anchor="${f === 0 ? "start" : f === 1 ? "end" : "middle"}" class="pv-ax">${esc(fv(lo + (max - lo) * f))}</text>`;
      });
      const inside = share ? LBL.top || LBL.inside : LBL.inside;
      data.forEach((r, i) => {
        let base = 0;
        const cy = pt + rh * (i + 0.5), by = cy - bh / 2, sum = tops[i] || 1;
        g += `<text x="${pl - 8}" y="${cy + 4}" text-anchor="end" class="pv-ax">${esc(fitW(names[i], pl - 10))}</text>`;
        series.forEach((q, k) => {
          const raw = vals[i][k], v = share ? raw / sum : raw; if (!raw) return;
          const x0 = xOf(base), x1 = xOf(base + v);
          g += `<rect x="${x0}" y="${by}" width="${Math.max(0, x1 - x0)}" height="${bh}" fill="${q.color}" opacity=".9"><title>${esc(m.rowName(r))} / ${esc(q.name)}: ${esc(fmt(raw))}（${pct(raw / sum)}）</title></rect>`;
          const t = share ? pct(raw / sum) : lf(raw);
          if (inside && bh >= 12 && x1 - x0 >= textW(t) + 6) g += `<text x="${(x0 + x1) / 2}" y="${cy + 4}" text-anchor="middle" class="pv-vl pv-in">${esc(t)}</text>`;
          base += v;
        });
        if (!share && tops[i] && (LBL.top || series.length > 1)) g += `<text x="${xOf(tops[i]) + 5}" y="${cy + 4}" class="${LBL.top ? "pv-vl" : "pv-ax"}">${esc(lf(tops[i]))}</text>`;
      });
      g += `<line x1="${pl}" x2="${pl}" y1="${pt}" y2="${H - pb}" class="pv-axis"/>` + (share ? "" : refLinesX(xOf, pt, H - pb, pl, pl + iw));
      return { svg: svgOf(W, H, g, kindName), legend: legendHtml(series.map((q) => [q.name, q.color, "bar"])) + note };
    }
    const pl = pad(ctx, 60, 44), pr = pad(ctx, 20, 10), pt = LBL.top ? 22 : 12, iw = W - pl - pr, cat = catAxis(names, iw, H, ctx);
    const pb = pad(ctx, 56, 30) + cat.extra, ih = H - pt - pb, gw = iw / Math.max(data.length, 1), bw = Math.max(4, Math.min(56, gw * 0.72));
    const yOf = (v) => pt + ih * (1 - Math.max(0, Math.min(1, (v - lo) / (max - lo))));
    let g = axisY(pl, pt, ih, max, false, W + 36, MUTED, share ? (v) => `${Math.round(v * 100)}%` : nf, lo);
    const inside = share ? LBL.top || LBL.inside : LBL.inside;
    data.forEach((r, i) => {
      let base = 0;
      const cx = pl + gw * (i + 0.5), sum = tops[i] || 1;
      series.forEach((q, k) => {
        const raw = vals[i][k], v = share ? raw / sum : raw; if (!raw) return;
        const y1 = yOf(base + v), y0 = yOf(base);
        g += `<rect x="${cx - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1)}" fill="${q.color}" opacity=".9"><title>${esc(m.rowName(r))} / ${esc(q.name)}: ${esc(fmt(raw))}（${pct(raw / sum)}）</title></rect>`;
        const t = share ? pct(raw / sum) : lf(raw);
        if (inside && y0 - y1 >= 13 && bw >= t.length * 6.2 + 2) g += `<text x="${cx}" y="${(y0 + y1) / 2 + 4}" text-anchor="middle" class="pv-vl pv-in">${esc(t)}</text>`;
        base += v;
      });
      if (LBL.top && !share && tops[i]) g += `<text x="${cx}" y="${yOf(tops[i]) - 4}" text-anchor="middle" class="pv-vl">${esc(lf(tops[i]))}</text>`;
      if (i % cat.every === 0) g += cat.text(i, cx, H - pb + 16);
    });
    g += `<line x1="${pl}" x2="${W - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>` + (share ? "" : refLines(yOf, pl, W - pr, pt, pt + ih));
    return { svg: svgOf(W, H, g, kindName), legend: legendHtml(series.map((q) => [q.name, q.color, "bar"])) + note };
  }
  /** ドーナツ: 行の葉の割合（グラフにする値・列は全体）。大きい順に 9 つ＋その他。真ん中に合計 */
  function donutChart(ctx) {
    const { m, d, W, H } = ctx, j = chartAt(ctx);
    if (!ADDITIVE.has(d.measures[j].agg)) return empty("ドーナツ（内訳）は、足し上げる値（件数・ロット数・合計）で描けます。平均・最小・最大は割合にできません。");
    let items = dataRows(m).map((r) => ({ name: m.rowName(r), v: m.value(r, ALL, j) || 0 })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    if (!items.length) return empty("割合にできる値（0 より大きい値）がありません。");
    const total = items.reduce((a, x) => a + x.v, 0);
    if (items.length > 10) items = items.slice(0, 9).concat([{ name: `その他（${items.length - 9} 件）`, v: items.slice(9).reduce((a, x) => a + x.v, 0), rest: true }]);
    const R = ctx.compact ? Math.max(20, Math.min(H / 2 - 6, W / 2 - 8, 160)) : Math.min(H / 2 - 12, 140), r0 = R * 0.58, cx = R + pad(ctx, 24, 8), cy = H / 2, w = cx + R + pad(ctx, 24, 8);
    let a = -Math.PI / 2, g = "";
    items.forEach((x, i) => {
      x.color = x.rest ? "#a9b4be" : cof(x.name, ctx.rowColor ? ctx.rowColor(x.name) : COLORS[i % COLORS.length]);
      const da = (x.v / total) * Math.PI * 2, b = a + da, big = da > Math.PI ? 1 : 0;
      const p = (rad, ang) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
      const path = items.length === 1 ? `M${p(R, 0)}A${R},${R} 0 1 1 ${p(R, Math.PI)}A${R},${R} 0 1 1 ${p(R, 0)}M${p(r0, 0)}A${r0},${r0} 0 1 0 ${p(r0, Math.PI)}A${r0},${r0} 0 1 0 ${p(r0, 0)}Z`
        : `M${p(R, a)}A${R},${R} 0 ${big} 1 ${p(R, b)}L${p(r0, b)}A${r0},${r0} 0 ${big} 0 ${p(r0, a)}Z`;
      g += `<path d="${path}" fill="${x.color}" stroke="#fff" stroke-width="1.5" fill-rule="evenodd"><title>${esc(x.name)}: ${esc(fmt(x.v))}（${pct(x.v / total)}）</title></path>`;
      if (da > 0.32) { const mid = (a + b) / 2, rr = (R + r0) / 2; g += `<text x="${cx + rr * Math.cos(mid)}" y="${cy + rr * Math.sin(mid) + 4}" text-anchor="middle" class="pv-dl">${pct(x.v / total)}</text>`; }
      a = b;
    });
    g += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" class="pv-dtot">${esc(nf(total))}</text><text x="${cx}" y="${cy + 16}" text-anchor="middle" class="pv-ax">${esc(fitW(ctx.measName(d.measures[j]), Math.max(40, (Math.min(H / 2 - 6, w / 2 - 8, 160) - 18) * 2 - textW("の計"))))}の計</text>`;
    const side = `<div class="pv-dlist">${items.map((x) => `<div><i style="--c:${x.color}"></i><span title="${esc(x.name)}">${esc(x.name)}</span><b>${esc(fmt(x.v))}</b><small>${pct(x.v / total)}</small></div>`).join("")}</div>`;
    return { svg: svgOf(w, H, g, "ドーナツグラフ"), legend: `<small class="pv-cnote">大きい順${items.some((x) => x.rest) ? "・10 位から下は「その他」" : ""}・合計 ${esc(fmt(total))}</small>`, side };
  }

  /* ================= ばらつきを見る ================= */
  /** ヒストグラム: 行の 1 段目が区間の列のとき。区間の幅を変えられ、横に傾向の数（平均・ばらつき・四分位） */
  function histChart(ctx) {
    const { m, d, W, H } = ctx, b = (d.bins || [])[0], x0 = d.dims.rows[0];
    if (!b || !x0 || x0.part !== "bin") return empty("ヒストグラムは、行の 1 段目を数のカラムの「区間」にすると描けます（グラフの形でヒストグラムを選ぶか、数のカラムの［行］を押して、まとめ方を「区間」に）。");
    const data = m.rows.filter((r) => r.type === "data" && r.path[0] !== "");
    const sw = sideW(ctx), w = W - sw, pl = pad(ctx, 56, 44), pr = 16, pt = LBL.top ? 22 : 12, pb = pad(ctx, 44, 28), iw = w - pl - pr, ih = H - pt - pb;
    const lo = b.origin, nb = Math.max(1, Math.round((b.max - lo) / b.width) + 1);
    const counts = new Array(nb).fill(0);
    data.forEach((r) => { const k = Math.round((Number(r.path[0]) - lo) / b.width); if (k >= 0 && k < nb) counts[k] = m.value(r, m.cols[m.cols.length - 1], 0) || 0; });
    const max = niceMax(Math.max(1, ...counts)), bw = iw / nb;
    let g = axisY(pl, pt, ih, max, false, w + 40);
    const thin = thinOf(counts, bw);
    counts.forEach((v, i) => {
      const h = ih * v / max;
      g += `<rect x="${pl + bw * i + 0.5}" y="${pt + ih - h}" width="${Math.max(1, bw - 1)}" height="${h}" fill="${cof(ctx.label(b.column), COLORS[2])}"><title>${esc(fmt(lo + b.width * i))}〜${esc(fmt(lo + b.width * (i + 1)))}: ${esc(fmt(v))}</title></rect>`;
      if (LBL.top && v && i % thin === 0) g += `<text x="${pl + bw * (i + 0.5)}" y="${pt + ih - h - 4}" text-anchor="middle" class="pv-vl">${esc(nf(v))}</text>`;
    });
    const every = Math.max(1, Math.ceil(nb / Math.max(4, Math.floor(iw / 60))));
    for (let i = 0; i <= nb; i += every) g += `<text x="${pl + bw * i}" y="${H - pb + 16}" text-anchor="middle" class="pv-ax">${esc(nf(lo + b.width * i))}</text>`;
    const st0 = (d.stats || {})[b.column];
    if (st0 && st0.n) {   // 平均（縦の点線）と ±1σ の帯
      const xv = (v) => pl + iw * (v - lo) / (b.width * nb);
      g += `<rect x="${xv(st0.mean - st0.sd)}" y="${pt}" width="${Math.max(0, xv(st0.mean + st0.sd) - xv(st0.mean - st0.sd))}" height="${ih}" fill="#2f7d78" opacity=".08"/>`
        + `<line x1="${xv(st0.mean)}" x2="${xv(st0.mean)}" y1="${pt}" y2="${pt + ih}" stroke="#2f7d78" stroke-width="2" stroke-dasharray="4 3"><title>平均 ${esc(fmt(st0.mean))}</title></line>`;
    }
    g += `<line x1="${pl}" x2="${w - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>` + refLinesX((v) => pl + iw * (v - lo) / (b.width * nb), pt, pt + ih, pl, pl + iw);
    const row = (k, v) => `<tr><th>${k}</th><td>${esc(fmt(v))}</td></tr>`;
    const side = `<div class="pv-stats"><b>${esc(ctx.label(b.column))} の傾向</b>`
      + (st0 ? `<table>${row("件数", st0.n)}${row("平均", st0.mean)}${row("標準偏差", st0.sd)}${row("最小", st0.min)}${row("25%", st0.q1)}${row("中央値", st0.median)}${row("75%", st0.q3)}${row("最大", st0.max)}</table>` : "<p>数に読める値がありません</p>")
      + `<label class="pv-binw">区間の幅<input type="number" min="0" step="any" value="${b.width}" data-pv-binw aria-label="区間の幅"><small>${b.auto ? "自動で決めた幅" : "決めた幅"}</small></label>`
      + `<button type="button" class="pv-link" data-pv-binauto${b.auto ? " disabled" : ""}>幅を自動に戻す</button>`
      + '<small class="pv-cnote">緑の点線は平均、淡い帯は平均±標準偏差</small></div>';
    return { svg: svgOf(w, H, g, "ヒストグラム"), legend: "", side };
  }
  /** 箱ひげ図: 行の葉ごとの数の列の分かれ方（サーバーの boxes: 四分位・ひげ・外れ値）。箱＝25〜75%・太線＝中央値・◆＝平均 */
  function boxChart(ctx) {
    const { m, d, W, H } = ctx;
    if (!d.box) return empty("箱ひげ図は、値に数のカラム（平均など）を入れると、行の段ごとのその数の分かれ方を描けます。");
    const byKey = new Map((d.boxes || []).map((b) => [b.r.join(SEP), b]));
    const items = dataRows(m).map((r) => ({ name: m.rowName(r), b: byKey.get(r.path.join(SEP)) })).filter((x) => x.b).slice(0, 40);
    if (!items.length) return empty(`「${esc(ctx.label(d.box))}」に数に読める値がありません。`);
    const pl = pad(ctx, 60, 44), pr = pad(ctx, 20, 10), pt = LBL.top ? 20 : 12, iw0 = W - pl - pr, cat = catAxis(items.map((x) => x.name), iw0, H, ctx);
    const pb = pad(ctx, 56, 30) + cat.extra, iw = iw0, ih = H - pt - pb, gw = iw / items.length, bw = Math.max(8, Math.min(46, gw * 0.55));
    const r = rangeFix(niceRange(Math.min(...items.map((x) => Math.min(x.b.lo, ...x.b.out))), Math.max(...items.map((x) => Math.max(x.b.hi, ...x.b.out)))));
    const y = (v) => pt + ih * (1 - (v - r.lo) / (r.hi - r.lo));
    let g = axisRange(r, pl, W - pr, y) + refLines(y, pl, W - pr, pt, pt + ih);
    items.forEach((x, i) => {
      const b = x.b, cx = pl + gw * (i + 0.5), tip = `${x.name}（${b.n} 件）\n最大 ${fmt(b.max)} / 75% ${fmt(b.q3)} / 中央値 ${fmt(b.median)} / 25% ${fmt(b.q1)} / 最小 ${fmt(b.min)} / 平均 ${fmt(b.mean)}${b.outN ? ` / 外れ値 ${b.outN} 件` : ""}`;
      g += `<g><title>${esc(tip)}</title><line x1="${cx}" x2="${cx}" y1="${y(b.hi)}" y2="${y(b.q3)}" class="pv-wh"/><line x1="${cx}" x2="${cx}" y1="${y(b.q1)}" y2="${y(b.lo)}" class="pv-wh"/>`
        + `<line x1="${cx - bw / 4}" x2="${cx + bw / 4}" y1="${y(b.hi)}" y2="${y(b.hi)}" class="pv-wh"/><line x1="${cx - bw / 4}" x2="${cx + bw / 4}" y1="${y(b.lo)}" y2="${y(b.lo)}" class="pv-wh"/>`
        + `<rect x="${cx - bw / 2}" y="${y(b.q3)}" width="${bw}" height="${Math.max(1, y(b.q1) - y(b.q3))}" fill="${cof(x.name, COLORS[2])}" fill-opacity=".18" stroke="${cof(x.name, COLORS[2])}" stroke-width="1.5" rx="2"/>`
        + `<line x1="${cx - bw / 2}" x2="${cx + bw / 2}" y1="${y(b.median)}" y2="${y(b.median)}" stroke="${cof(x.name, COLORS[2])}" stroke-width="3"/>`
        + `<path d="M${cx},${y(b.mean) - 4.5}l4.5,4.5l-4.5,4.5l-4.5,-4.5z" fill="${COLORS[0]}"/></g>`;
      b.out.forEach((v) => { g += `<circle cx="${cx}" cy="${y(v)}" r="2.6" fill="#fff" stroke="${ALERT}" stroke-width="1.4"><title>${esc(x.name)}: 外れ値 ${esc(fmt(v))}</title></circle>`; });
      if (LBL.top || LBL.inside) g += `<text x="${cx + bw / 2 + 3}" y="${y(b.median) + 4}" class="pv-vl">${esc(lf(b.median))}</text>`;
      if (i % cat.every === 0) g += cat.text(i, cx, H - pb + 16);
    });
    g += `<line x1="${pl}" x2="${W - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>`;
    return { svg: svgOf(W, H, g, "箱ひげ図"), legend: `<span class="pv-legend"><span><b>${esc(ctx.label(d.box))}</b> の分かれ方</span></span><small class="pv-cnote">箱＝25〜75%・太線＝中央値・◆＝平均・ひげ＝箱の幅の 1.5 倍の内側の端・○＝外れ値${dataRows(m).length > 40 ? "・先頭 40 件まで" : ""}</small>` };
  }

  /* ================= 関係を見る ================= */
  /** ヒートマップ: 行の葉 × 列の葉の値（グラフにする値）を色の濃さで。字が入る幅なら数も */
  function heatChart(ctx) {
    const { m, d, W } = ctx, j = chartAt(ctx), rows = dataRows(m).slice(0, 80), cols = m.nc ? m.cols.filter((c) => c.type === "data").slice(0, 40) : [ALL];
    const vals = rows.map((r) => cols.map((c) => m.value(r, c, j)));
    const flat = vals.flat().filter((v) => v != null), lo = Math.min(0, ...flat), hi = Math.max(...flat, lo + 1e-9);
    // 詰めた形: 名前の字の幅だけ左を空け、行の高さをパネルの高さで割る（パネルに収める）
    const longest = Math.max(0, ...rows.map((r) => textW(m.rowName(r))));        // 名前の字の幅を測る（版 3.47.0）
    const pl = Math.round(Math.max(ctx.compact ? 40 : 90, Math.min(W * 0.35, longest + 16))), pt = ctx.compact ? 26 : 46;
    const cw = Math.max(ctx.compact ? 14 : 18, Math.min(88, (W - pl - 10) / cols.length));
    const ch = ctx.compact ? Math.max(10, Math.min(30, (ctx.H - pt - 6) / Math.max(rows.length, 1))) : rows.length > 40 ? 18 : 24;
    const H = ctx.compact ? ctx.H : pt + ch * rows.length + 8, w = pl + cw * cols.length + 10;
    const color = (v) => { const t = (v - lo) / (hi - lo); return `hsl(174 ${Math.round(30 + 32 * t)}% ${Math.round(96 - 66 * t)}%)`; };
    let g = "";
    cols.forEach((c, k) => {
      const name = m.nc ? m.colName(c) : ctx.measName(d.measures[j]), cx = pl + cw * (k + 0.5);
      g += cw < 46 ? `<text transform="translate(${cx + 3},${pt - 6}) rotate(-45)" class="pv-ax">${esc(fitW(name, Math.min((pt - 8) / 0.707, (W - cx) / 0.707 - 4)))}</text>` : `<text x="${cx}" y="${pt - 8}" text-anchor="middle" class="pv-ax">${esc(fitW(name, cw - 6))}</text>`;
    });
    rows.forEach((r, i) => {
      const y0 = pt + ch * i;
      g += `<text x="${pl - 8}" y="${y0 + ch / 2 + 4}" text-anchor="end" class="pv-ax">${esc(fitW(m.rowName(r), pl - 10))}</text>`;
      cols.forEach((c, k) => {
        const v = vals[i][k], x0 = pl + cw * k, t = v == null ? 0 : (v - lo) / (hi - lo);
        g += `<rect x="${x0 + 0.5}" y="${y0 + 0.5}" width="${cw - 1}" height="${ch - 1}" rx="2" fill="${v == null ? "#f3f5f7" : color(v)}"><title>${esc(m.rowName(r))}${m.nc ? ` / ${esc(m.colName(c))}` : ""}: ${esc(v == null ? "なし" : fmt(v))}</title></rect>`;
        if (v != null && (LBL.top || LBL.inside || cw >= 40) && cw >= 30 && ch >= 14) g += `<text x="${x0 + cw / 2}" y="${y0 + ch / 2 + 4}" text-anchor="middle" class="pv-hv${t > 0.55 ? " is-dark" : ""}">${esc(nf(v))}</text>`;
      });
    });
    const legend = `<span class="pv-legend"><span>${esc(ctx.measName(d.measures[j]))}</span><span class="pv-ramp" style="--a:${color(lo)};--b:${color(hi)}"><small>${esc(nf(lo))}</small><i></i><small>${esc(nf(hi))}</small></span></span>`
      + (m.nc ? "" : '<small class="pv-cnote">［列］に段を入れると、行×列の表になります</small>') + (dataRows(m).length > 80 ? '<small class="pv-cnote">先頭 80 行まで描いています</small>' : "");
    return { svg: svgOf(w, H, g, "ヒートマップ"), legend };
  }
  /** 散布図: 行の葉ごとに、1 つ目の値を横・2 つ目の値を縦にした点。最小二乗の直線と相関係数 */
  function scatterChart(ctx) {
    const { m, d, W, H } = ctx;
    if (d.measures.length < 2) return empty("散布図は、値を 2 つ入れると描けます（1 つ目＝横・2 つ目＝縦。行の葉ごとに 1 点）。");
    const pts = dataRows(m).map((r) => ({ r, x: m.value(r, ALL, 0), y: m.value(r, ALL, 1) })).filter((p) => p.x != null && p.y != null);
    if (pts.length < 2) return empty("両方の値がある点が 2 つ未満です。");
    const sw = sideW(ctx), w = W - sw, pl = pad(ctx, 64, 48), pr = 18, pt = 14, pb = pad(ctx, 48, 30), iw = w - pl - pr, ih = H - pt - pb;
    const rx = niceRange(Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))), ry = rangeFix(niceRange(Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))));
    const X = (v) => pl + iw * (v - rx.lo) / (rx.hi - rx.lo), Y = (v) => pt + ih * (1 - (v - ry.lo) / (ry.hi - ry.lo));
    let g = axisRange(ry, pl, w - pr, Y) + refLines(Y, pl, w - pr, pt, pt + ih);
    rx.ticks.forEach((t) => { g += `<line x1="${X(t)}" x2="${X(t)}" y1="${pt}" y2="${pt + ih}" class="pv-grid"/><text x="${X(t)}" y="${pt + ih + 16}" text-anchor="middle" class="pv-ax">${esc(nf(t))}</text>`; });
    const n = pts.length, mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
    const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0), syy = pts.reduce((a, p) => a + (p.y - my) ** 2, 0), sxy = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
    const slope = sxx ? sxy / sxx : 0, icpt = my - slope * mx, r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
    pts.forEach((p) => { g += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3.4" fill="${COLORS[2]}" fill-opacity=".55" stroke="${COLORS[2]}" stroke-width="1"><title>${esc(m.rowName(p.r))}: ${esc(fmt(p.x))}, ${esc(fmt(p.y))}</title></circle>`; });
    if ((LBL.top || LBL.inside) && n <= 60) g += freeLabels(pts.map((p) => ({ x: X(p.x), y: Y(p.y), r: 3.4, text: clip(m.rowName(p.r), 10) })), w, H);
    if (sxx && n >= 3) {
      const ya = Math.max(ry.lo, Math.min(ry.hi, icpt + slope * rx.lo)), yb = Math.max(ry.lo, Math.min(ry.hi, icpt + slope * rx.hi));
      const xa = slope ? (ya - icpt) / slope : rx.lo, xb = slope ? (yb - icpt) / slope : rx.hi;
      g += `<line x1="${X(xa)}" y1="${Y(ya)}" x2="${X(xb)}" y2="${Y(yb)}" stroke="${ALERT}" stroke-width="1.8" stroke-dasharray="6 4"><title>y = ${fmt(slope)} x ${icpt < 0 ? "−" : "＋"} ${fmt(Math.abs(icpt))}</title></line>`;
    }
    const xn = ctx.measName(d.measures[0]), yn = ctx.measName(d.measures[1]);
    g += `<text x="${pl + iw / 2}" y="${H - 8}" text-anchor="middle" class="pv-axn">${esc(xn)} →</text><text transform="translate(14,${pt + ih / 2}) rotate(-90)" text-anchor="middle" class="pv-axn">${esc(yn)} →</text>`;
    const strength = Math.abs(r) >= 0.7 ? "強い" : Math.abs(r) >= 0.4 ? "中くらいの" : Math.abs(r) >= 0.2 ? "弱い" : "ほとんど無い";
    const side = statsBox("関係の強さ", [["点の数", n], ["相関係数 r", Math.round(r * 1000) / 1000], ["R²", Math.round(r * r * 1000) / 1000], ["傾き", slope], ["切片", icpt]],
      `${strength}${Math.abs(r) >= 0.2 ? (r > 0 ? "正の" : "負の") : ""}相関。赤の点線は最小二乗の直線（1 点＝行の葉${dataRows(m).length > n ? `・値の無い ${dataRows(m).length - n} 点は除く` : ""}）`);
    return { svg: svgOf(w, H, g, "散布図"), legend: legendHtml([[`${xn} × ${yn}`, COLORS[2], "bar"]]), side };
  }

  /* ================= 版 3.39.0 で足した形（利用者の要望 2026-10: バイオリン図・45度線管理図など、形を増やす） ================= */
  /** ツリーマップ: 行の葉の割合を、面積の四角で（大きい順に敷き詰める。squarified）。足し上げる値のとき。入る四角に名前と値 */
  function treemapChart(ctx) {
    const { m, d, W, H } = ctx, j = chartAt(ctx);
    if (!ADDITIVE.has(d.measures[j].agg)) return empty("ツリーマップ（内訳）は、足し上げる値（件数・ロット数・合計・個数）で描けます。");
    const items = dataRows(m).map((r) => ({ name: m.rowName(r), v: m.value(r, ALL, j) || 0 })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 60);
    if (!items.length) return empty("割合にできる値（0 より大きい値）がありません。");
    const total = items.reduce((a, x) => a + x.v, 0), rects = [];
    // squarified: 短い辺に沿って、縦横の比が悪くならない間は同じ列に積む
    let box = { x: 0, y: 0, w: W, h: H }, rest = items.map((x) => ({ ...x, a: x.v / total * W * H }));
    const worst = (row, side) => { const s2 = row.reduce((a, x) => a + x.a, 0); return Math.max(...row.map((x) => Math.max(side * side * x.a / (s2 * s2), s2 * s2 / (side * side * x.a)))); };
    while (rest.length) {
      const side = Math.min(box.w, box.h);
      let row = [rest[0]], k = 1;
      while (k < rest.length && worst(row.concat([rest[k]]), side) <= worst(row, side)) row.push(rest[k++]);
      rest = rest.slice(k);
      const sum = row.reduce((a, x) => a + x.a, 0), thick = sum / side;
      let off = 0;
      row.forEach((x) => {
        const len = x.a / thick;
        rects.push(box.w >= box.h ? { ...x, x: box.x, y: box.y + off, w: thick, h: len } : { ...x, x: box.x + off, y: box.y, w: len, h: thick });
        off += len;
      });
      box = box.w >= box.h ? { x: box.x + thick, y: box.y, w: box.w - thick, h: box.h } : { x: box.x, y: box.y + thick, w: box.w, h: box.h - thick };
    }
    let g = "";
    rects.forEach((x, i) => {
      const c = cof(x.name, ctx.rowColor ? ctx.rowColor(x.name) : COLORS[i % COLORS.length]);
      g += `<rect x="${x.x + 1}" y="${x.y + 1}" width="${Math.max(0, x.w - 2)}" height="${Math.max(0, x.h - 2)}" rx="3" fill="${c}" opacity=".9"><title>${esc(x.name)}: ${esc(fmt(x.v))}（${pct(x.v / total)}）</title></rect>`;
      if (x.w >= 46 && x.h >= 30) {
        g += `<text x="${x.x + 7}" y="${x.y + 18}" class="pv-tm">${esc(fitW(x.name, x.w - 12, 12, 800))}</text>`;
        const vt = `${nf(x.v)}・${pct(x.v / total)}`, vs = x.w - 14 >= vt.length * 6.6 ? vt : x.w - 14 >= nf(x.v).length * 6.6 ? nf(x.v) : "";
        if ((LBL.top || LBL.inside || !ctx.compact) && x.h >= 46 && vs) g += `<text x="${x.x + 7}" y="${x.y + 36}" class="pv-tm is-v">${esc(vs)}</text>`;
      }
    });
    return { svg: svgOf(W, H, g, "ツリーマップ"), legend: `<small class="pv-cnote">面積＝${esc(ctx.measName(d.measures[j]))}・合計 ${esc(fmt(total))}${dataRows(m).length > 60 ? "・大きい順に 60 件まで" : ""}</small>` };
  }
  /** バイオリン図: 行の葉ごとの数の列の分布の形（サーバーの boxes の dens: 密度）を左右に映し、中に四分位の細い箱と中央値の点 */
  function violinChart(ctx) {
    const { m, d, W, H } = ctx;
    if (!d.box) return empty("バイオリン図は、値に数のカラム（平均など）を入れると、行の段ごとのその数の分布の形を描けます。");
    const byKey = new Map((d.boxes || []).map((b) => [b.r.join(SEP), b]));
    const items = dataRows(m).map((r) => ({ name: catName(m, d, r), b: byKey.get(r.path.join(SEP)) })).filter((x) => x.b).slice(0, 40);
    if (!items.length) return empty(`「${esc(ctx.label(d.box))}」に数に読める値がありません。`);
    const pl = pad(ctx, 60, 44), pr = pad(ctx, 20, 10), pt = 12, iw0 = W - pl - pr, cat = catAxis(items.map((x) => x.name), iw0, H, ctx);
    const pb = pad(ctx, 56, 30) + cat.extra, iw = iw0, ih = H - pt - pb, gw = iw / items.length, half = Math.max(5, Math.min(44, gw * 0.42));
    const r = rangeFix(niceRange(Math.min(...items.map((x) => x.b.min)), Math.max(...items.map((x) => x.b.max))));
    const y = (v) => pt + ih * (1 - (v - r.lo) / (r.hi - r.lo));
    let g = axisRange(r, pl, W - pr, y) + refLines(y, pl, W - pr, pt, pt + ih);
    items.forEach((x, i) => {
      const b = x.b, cx = pl + gw * (i + 0.5), c = cof(x.name, COLORS[2]);
      const tip = `${x.name}（${b.n} 件）\n最大 ${fmt(b.max)} / 75% ${fmt(b.q3)} / 中央値 ${fmt(b.median)} / 25% ${fmt(b.q1)} / 最小 ${fmt(b.min)} / 平均 ${fmt(b.mean)}`;
      if (b.dens && b.dens.d && b.dens.d.length > 1) {
        const ds = b.dens.d, k = ds.length - 1, at = (t) => b.dens.lo + (b.dens.hi - b.dens.lo) * t / k;
        const right = ds.map((v, t) => `${t ? "L" : "M"}${(cx + v * half).toFixed(1)},${y(at(t)).toFixed(1)}`).join("");
        const left = ds.map((v, t) => `L${(cx - ds[k - t] * half).toFixed(1)},${y(at(k - t)).toFixed(1)}`).join("");
        g += `<path d="${right}${left}Z" fill="${c}" fill-opacity=".28" stroke="${c}" stroke-width="1.4"><title>${esc(tip)}</title></path>`;
      } else g += `<line x1="${cx}" x2="${cx}" y1="${y(b.min)}" y2="${y(b.max)}" stroke="${c}" stroke-width="2"><title>${esc(tip)}</title></line>`;
      g += `<rect x="${cx - 3}" y="${y(b.q3)}" width="6" height="${Math.max(1, y(b.q1) - y(b.q3))}" fill="#33404d" rx="1.5"/><circle cx="${cx}" cy="${y(b.median)}" r="3.2" fill="#fff" stroke="#33404d" stroke-width="1.4"><title>${esc(tip)}</title></circle>`;
      if ((LBL.top || LBL.inside) && gw - half * 2 >= lf(b.median).length * 6.6 + 8) g += `<text x="${cx + half + 3}" y="${y(b.median) + 4}" class="pv-vl">${esc(lf(b.median))}</text>`;
      if (i % cat.every === 0) g += cat.text(i, cx, H - pb + 16);
    });
    g += `<line x1="${pl}" x2="${W - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>`;
    return { svg: svgOf(W, H, g, "バイオリン図"), legend: `<span class="pv-legend"><span><b>${esc(ctx.label(d.box))}</b> の分布の形</span></span><small class="pv-cnote">幅＝その値のあたりの多さ・中の黒い棒＝25〜75%・白い点＝中央値${dataRows(m).length > 40 ? "・先頭 40 件まで" : ""}</small>` };
  }
  /* X̄-R 管理図の係数（群の大きさ n → A2・D3・D4。JIS Z 9020-2 の表） */
  const XR = { 2: [1.88, 0, 3.267], 3: [1.023, 0, 2.574], 4: [0.729, 0, 2.282], 5: [0.577, 0, 2.114], 6: [0.483, 0, 2.004], 7: [0.419, 0.076, 1.924], 8: [0.373, 0.136, 1.864],
    9: [0.337, 0.184, 1.816], 10: [0.308, 0.223, 1.777], 11: [0.285, 0.256, 1.744], 12: [0.266, 0.283, 1.717], 13: [0.249, 0.307, 1.693], 14: [0.235, 0.328, 1.672],
    15: [0.223, 0.347, 1.653], 16: [0.212, 0.363, 1.637], 17: [0.203, 0.378, 1.622], 18: [0.194, 0.391, 1.608], 19: [0.187, 0.403, 1.597], 20: [0.18, 0.415, 1.585],
    21: [0.173, 0.425, 1.575], 22: [0.167, 0.434, 1.566], 23: [0.162, 0.443, 1.557], 24: [0.157, 0.451, 1.548], 25: [0.153, 0.459, 1.541] };
  /** X̄-R 管理図: 行の葉＝群（日・ロットなど）。上に群の平均 X̄（中心線 X̿・限界 X̿ ± A2 R̄）、下に群の範囲 R（中心線 R̄・上限 D4 R̄・下限 D3 R̄）。
      群の大きさは平均の n（2〜25 に丸める）。限界の外の点は赤 */
  function xbarChart(ctx) {
    const { m, d, W, H } = ctx;
    if (!d.box) return empty("X̄-R 管理図は、値に数のカラム（平均など）を入れると、行の段（日・ロットなど）を群にして描けます。");
    const byKey = new Map((d.boxes || []).map((b) => [b.r.join(SEP), b]));
    const pts = dataRows(m).map((r) => ({ r, b: byKey.get(r.path.join(SEP)) })).filter((x) => x.b && x.b.n >= 2);
    if (pts.length < 3) return empty("X̄-R 管理図は、値が 2 つ以上ある群（行の葉）が 3 つ以上あるときに描けます。");
    const xs = pts.map((p) => p.b.mean), rs = pts.map((p) => p.b.max - p.b.min), n = pts.length;
    const nbar = Math.max(2, Math.min(25, Math.round(pts.reduce((a, p) => a + p.b.n, 0) / n))), [A2, D3, D4] = XR[nbar];
    const xbb = xs.reduce((a, b) => a + b, 0) / n, rb = rs.reduce((a, b) => a + b, 0) / n;
    const lim = { xu: xbb + A2 * rb, xl: xbb - A2 * rb, ru: D4 * rb, rl: D3 * rb };
    const sw = sideW(ctx), w = W - sw, pl = pad(ctx, 60, 44), pr = pad(ctx, 64, 56), pb = pad(ctx, 40, 26) + tiltPad(pts.map((p) => tickLabel(m, d, p.r))), gap = 18, iw = w - pl - pr;
    const hx = Math.max(40, (H - pb - 10 - gap) * 0.62), hr = Math.max(28, H - pb - 10 - gap - hx), tx = 10, tr = tx + hx + gap;
    const x = (i) => pl + iw * (i + 0.5) / n;
    let g = "";
    const panel = (vals, top, h, cl, ul, ll, name) => {
      const r = niceRange(Math.min(ll, ...vals), Math.max(ul, ...vals)), y = (v) => top + h * (1 - (v - r.lo) / (r.hi - r.lo));
      g += axisRange(r, pl, w - pr, y);
      const hl = (v, cls, t) => `<line x1="${pl}" x2="${w - pr}" y1="${y(v)}" y2="${y(v)}" class="${cls}"/><text x="${w - pr + 4}" y="${y(v) + 4}" class="pv-ax ${cls}-t">${t} ${esc(nf(v))}</text>`;
      g += hl(ul, "pv-lim", "UCL") + hl(cl, "pv-cl", "CL") + (ll > r.lo - 1e-9 && ll > 0 ? hl(ll, "pv-lim", "LCL") : "");
      g += `<path d="${vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")}" fill="none" stroke="${COLORS[2]}" stroke-width="1.6"/>`;
      vals.forEach((v, i) => { const bad = v > ul + 1e-9 || v < ll - 1e-9; g += `<circle cx="${x(i)}" cy="${y(v)}" r="${bad ? 4 : 2.8}" fill="${bad ? ALERT : "#fff"}" stroke="${bad ? ALERT : COLORS[2]}" stroke-width="1.6"><title>${esc(m.rowName(pts[i].r))}: ${name} ${esc(fmt(v))}（n=${pts[i].b.n}）${bad ? "（管理限界の外）" : ""}</title></circle>`; });
      g += `<text x="${pl + 4}" y="${top + 11}" class="pv-axn">${name}</text>`;
      return vals.filter((v) => v > ul + 1e-9 || v < ll - 1e-9).length;
    };
    const outX = panel(xs, tx, hx, xbb, lim.xu, lim.xl, "X̄"), outR = panel(rs, tr, hr, rb, lim.ru, lim.rl, "R");
    const every = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(iw / (F.xrot && +F.xrot ? 18 : 80)))));
    pts.forEach((p, i) => { if (i % every === 0) g += xText(x(i), H - pb + 16, F.xrot && +F.xrot ? fitW(tickLabel(m, d, p.r), 150) : fitW(tickLabel(m, d, p.r), (iw / n) * every - 4)); });
    const side = statsBox(`${ctx.label(d.box)} の X̄-R 管理図`, [["群の数", n], ["群の大きさ n̄", nbar], ["X̿（中心線）", xbb], ["X̄ の UCL", lim.xu], ["X̄ の LCL", lim.xl], ["R̄", rb], ["R の UCL", lim.ru],
      ["限界の外（X̄）", `${outX} 点`, outX ? "is-alert" : ""], ["限界の外（R）", `${outR} 点`, outR ? "is-alert" : ""]], `A2=${A2}・D3=${D3}・D4=${D4}（n=${nbar}）。赤＝管理限界の外`);
    return { svg: svgOf(w, H, g, "X̄-R 管理図"), legend: legendHtml([[`${ctx.label(d.box)} の群の平均 X̄・範囲 R`, COLORS[2], "line"], ["管理限界", ALERT, "line"]]), side };
  }
  /** 45度線管理図: 行の葉ごとに、1 つ目の値を横・2 つ目の値を縦にした点（同じ目盛り）。45 度の線（縦＝横）と、差（縦−横）の平均 ± 3σ の平行な線。
      2 つの測り方・前後の値が一致しているか（偏り＝線からのずれ、ばらつき＝帯の幅）を見る。帯の外の点は赤 */
  function diag45Chart(ctx) {
    const { m, d, W, H } = ctx;
    if (d.measures.length < 2) return empty("45度線管理図は、値を 2 つ入れると描けます（1 つ目＝横・2 つ目＝縦。行の葉ごとに 1 点。同じ物を 2 通りに測った値など）。");
    const pts = dataRows(m).map((r) => ({ r, x: m.value(r, ALL, 0), y: m.value(r, ALL, 1) })).filter((p) => typeof p.x === "number" && typeof p.y === "number");
    if (pts.length < 3) return empty("両方の値がある点が 3 つ未満です。");
    const n = pts.length, ds = pts.map((p) => p.y - p.x), md = ds.reduce((a, b) => a + b, 0) / n;
    const sd = n > 1 ? Math.sqrt(ds.reduce((a, v) => a + (v - md) ** 2, 0) / (n - 1)) : 0, up = md + 3 * sd, dn = md - 3 * sd;
    const all = pts.flatMap((p) => [p.x, p.y]), r = rangeFix(niceRange(Math.min(...all), Math.max(...all)));
    const sw = sideW(ctx), w = W - sw, pb = pad(ctx, 48, 40), pt = 12, side0 = Math.min(w - pad(ctx, 64, 48) - 18, H - pt - pb), pl = pad(ctx, 64, 48), iw = side0, ih = side0;
    const X = (v) => pl + iw * (v - r.lo) / (r.hi - r.lo), Y = (v) => pt + ih * (1 - (v - r.lo) / (r.hi - r.lo));
    let g = axisRange(r, pl, pl + iw, Y) + refLines(Y, pl, pl + iw, pt, pt + ih);
    r.ticks.forEach((t) => { g += `${F.grid === false ? "" : `<line x1="${X(t)}" x2="${X(t)}" y1="${pt}" y2="${pt + ih}" class="pv-grid"/>`}<text x="${X(t)}" y="${pt + ih + 16}" text-anchor="middle" class="pv-ax">${esc(nf(t))}</text>`; });
    const seg = (off, cls, t) => { const a = r.lo, b = r.hi; return `<line x1="${X(a)}" y1="${Y(a + off)}" x2="${X(b)}" y2="${Y(b + off)}" class="${cls}" clip-path="url(#${cid})"/>${t && iw >= 200 ? `<text x="${pl + iw - 4}" y="${Math.max(pt + 10, Math.min(pt + ih - 4, Y(r.hi + off) - 4))}" text-anchor="end" class="pv-ax ${cls}-t">${t}</text>` : ""}`; };
    const cid = `pvc45-${Math.random().toString(36).slice(2, 9)}`;
    g += `<clipPath id="${cid}"><rect x="${pl}" y="${pt}" width="${iw}" height="${ih}"/></clipPath>`;
    g += seg(0, "pv-cl", "45°") + seg(up, "pv-lim", "+3σ") + seg(dn, "pv-lim", "−3σ");
    pts.forEach((p, i) => { const bad = ds[i] > up + 1e-9 || ds[i] < dn - 1e-9, c = bad ? ALERT : cof(m.rowName(p.r), COLORS[2]); g += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${bad ? 4.2 : 3.4}" fill="${c}" fill-opacity="${bad ? 1 : 0.6}" stroke="${c}" stroke-width="1"><title>${esc(m.rowName(p.r))}: 横 ${esc(fmt(p.x))}・縦 ${esc(fmt(p.y))}・差 ${esc(fmt(ds[i]))}${bad ? "（帯の外）" : ""}</title></circle>`; });
    if ((LBL.top || LBL.inside) && n <= 60) g += freeLabels(pts.map((p) => ({ x: X(p.x), y: Y(p.y), r: 4, text: clip(m.rowName(p.r), 10) })), w, H);
    const xn = ctx.measName(d.measures[0]), yn = ctx.measName(d.measures[1]);
    g += `<text x="${pl + iw / 2}" y="${H - 6}" text-anchor="middle" class="pv-axn">${esc(fitW(xn, iw - 24, 12, 700))} →</text><text transform="translate(14,${pt + ih / 2}) rotate(-90)" text-anchor="middle" class="pv-axn">${esc(clip(yn, Math.max(6, Math.floor(ih / 12))))} →</text>`;
    const nOut = ds.filter((v) => v > up + 1e-9 || v < dn - 1e-9).length;
    const sideHtml = statsBox("45度線管理図", [["点の数", n], ["差（縦−横）の平均", md], ["差の σ", sd], ["帯の上（＋3σ）", up], ["帯の下（−3σ）", dn], ["帯の外", `${nOut} 点`, nOut ? "is-alert" : ""]],
      "点が 45 度の線に乗れば 2 つの値は一致。線からずれた帯は偏り、帯の幅はばらつき。赤＝帯の外");
    return { svg: svgOf(w, H, g, "45度線管理図"), legend: legendHtml([[`${xn} × ${yn}`, COLORS[2], "bar"], ["45 度の線", "#2f7d78", "line"], ["差の平均 ± 3σ", ALERT, "line"]]), side: sideHtml };
  }
  /** バブル: 行の葉ごとに、1 つ目の値＝横・2 つ目＝縦・3 つ目＝円の大きさ（面積が値に比例） */
  function bubbleChart(ctx) {
    const { m, d, W, H } = ctx;
    if (d.measures.length < 3) return empty("バブルは、値を 3 つ入れると描けます（1 つ目＝横・2 つ目＝縦・3 つ目＝円の大きさ）。");
    const pts = dataRows(m).map((r) => ({ r, x: m.value(r, ALL, 0), y: m.value(r, ALL, 1), z: m.value(r, ALL, 2) })).filter((p) => [p.x, p.y, p.z].every((v) => typeof v === "number"));
    if (pts.length < 1) return empty("3 つの値がそろう点がありません。");
    const pl = pad(ctx, 64, 48), pr = 24, pt = 14, pb = pad(ctx, 48, 40), iw = W - pl - pr, ih = H - pt - pb;
    const rx = niceRange(Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))), ry = rangeFix(niceRange(Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))));
    const X = (v) => pl + iw * (v - rx.lo) / (rx.hi - rx.lo), Y = (v) => pt + ih * (1 - (v - ry.lo) / (ry.hi - ry.lo));
    const zmax = Math.max(...pts.map((p) => Math.abs(p.z))) || 1, rmax = Math.max(8, Math.min(40, Math.min(iw, ih) / 9));
    let g = axisRange(ry, pl, W - pr, Y) + refLines(Y, pl, W - pr, pt, pt + ih);
    rx.ticks.forEach((t) => { g += `${F.grid === false ? "" : `<line x1="${X(t)}" x2="${X(t)}" y1="${pt}" y2="${pt + ih}" class="pv-grid"/>`}<text x="${X(t)}" y="${pt + ih + 16}" text-anchor="middle" class="pv-ax">${esc(nf(t))}</text>`; });
    const labels = [];
    pts.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).forEach((p, i) => {
      const rr = Math.max(2.5, rmax * Math.sqrt(Math.abs(p.z) / zmax)), c = cof(m.rowName(p.r), ctx.rowColor ? ctx.rowColor(m.rowName(p.r)) : COLORS[i % COLORS.length]);
      g += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${rr}" fill="${c}" fill-opacity=".45" stroke="${c}" stroke-width="1.2"><title>${esc(m.rowName(p.r))}: ${esc(fmt(p.x))}, ${esc(fmt(p.y))}・大きさ ${esc(fmt(p.z))}</title></circle>`;
      labels.push({ x: X(p.x), y: Y(p.y), r: rr, text: clip(m.rowName(p.r), 8) });
    });
    if ((LBL.top || LBL.inside || !ctx.compact) && pts.length <= 60) g += freeLabels(labels, W, H);
    const xn = ctx.measName(d.measures[0]), yn = ctx.measName(d.measures[1]), zn = ctx.measName(d.measures[2]);
    g += `<text x="${pl + iw / 2}" y="${H - 6}" text-anchor="middle" class="pv-axn">${esc(xn)} →</text><text transform="translate(14,${pt + ih / 2}) rotate(-90)" text-anchor="middle" class="pv-axn">${esc(yn)} →</text>`;
    return { svg: svgOf(W, H, g, "バブルチャート"), legend: `<span class="pv-legend"><span>円の大きさ＝${esc(zn)}</span></span>` };
  }

  /* ================= 版 3.39.0（利用者の追加の要望）: サンキー図・スイムレーン図 ================= */
  /** 段の並び（流れ・レーンに使う 2〜3 段）: 行の段が 2 つ以上なら行の段（3 つまで）、そうでなければ行の段と列の段。
      → {names: [段の名前], flows: [[鍵の並び, 値]]}（いちばん下まで決めた組ごとの値）。値は数の答えのまま */
  function levelsOf(ctx) {
    const { m, d } = ctx, j = chartAt(ctx);
    if (m.nr >= 2) {
      const L = Math.min(3, m.nr);
      const leaf = m.nr === L ? dataRows(m) : m.rows.filter((r) => r.type === "sub" && r.path.length === L);
      const rows = leaf.length ? leaf : dataRows(m).map((r) => ({ ...r, path: r.path.slice(0, L) }));
      return { names: d.dims.rows.slice(0, L).map(ctx.dimName), lab: (i, k) => m.lab(i, k), flows: rows.map((r) => [r.path.slice(0, L), m.value(r, ALL, j) || 0]),
        order: (i) => d.orders[i] || [] };
    }
    if (m.nr === 1 && m.nc >= 1) {
      const cs = m.cols.filter((c) => c.type === "data");
      return { names: [ctx.dimName(d.dims.rows[0]), ctx.dimName(d.dims.cols[0])], lab: (i, k) => (i === 0 ? m.lab(0, k) : m.colName({ path: [k] })),
        flows: dataRows(m).flatMap((r) => cs.map((c) => [[r.path[0], c.path.join(SEP)], m.value(r, c, j) || 0])),
        order: (i) => (i === 0 ? d.orders[0] || [] : cs.map((c) => c.path.join(SEP))) };
    }
    return null;
  }
  /** サンキー図: 段から段への流れ（行の段 2〜3 つか、行の段と列の段）。帯の太さ＝値。節は段ごとに大きい順に縦に積む（入らない分は「その他」）。
      足し上げる値のとき。帯の色は流れ出る節の色 */
  function sankeyChart(ctx) {
    const { d, W, H } = ctx, j = chartAt(ctx);
    if (!ADDITIVE.has(d.measures[j].agg)) return empty("サンキー図（流れ）は、足し上げる値（件数・ロット数・合計・個数）で描けます。");
    const lv = levelsOf(ctx);
    if (!lv) return empty("サンキー図は、行に段を 2 つ（から → へ。3 つまで）入れるか、行と列に段を入れると描けます（例: 仕掛区分 → 設備）。");
    const K = lv.names.length, flows = lv.flows.filter(([, v]) => v > 0);
    if (!flows.length) return empty("流れにできる値（0 より大きい値）がありません。");
    // 段ごとの節の量（入り・出のうち大きい方）。多ければ大きい順に MAXN−1 個＋その他
    const MAXN = Math.max(3, Math.min(12, Math.floor((H - 20) / 22)));
    const tot = Array.from({ length: K }, () => new Map());
    flows.forEach(([ks, v]) => ks.forEach((k, i) => tot[i].set(k, (tot[i].get(k) || 0) + v)));
    const keep = tot.map((mp) => { const ks = [...mp.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]); return ks.length > MAXN ? new Set(ks.slice(0, MAXN - 1)) : new Set(ks); });
    const OTHER = "\u0000その他";
    const fold = (ks) => ks.map((k, i) => (keep[i].has(k) ? k : OTHER));
    const links = new Map(), nodes = Array.from({ length: K }, () => new Map());
    flows.forEach(([ks0, v]) => {
      const ks = fold(ks0);
      ks.forEach((k, i) => nodes[i].set(k, (nodes[i].get(k) || 0) + v));
      for (let i = 0; i + 1 < K; i++) { const key = `${i}${SEP}${ks[i]}${SEP}${ks[i + 1]}`; links.set(key, (links.get(key) || 0) + v); }
    });
    const total = [...nodes[0].values()].reduce((a, b) => a + b, 0);
    const name = (i, k) => (k === OTHER ? `その他（${tot[i].size - keep[i].size}）` : String(lv.lab(i, k)));
    const labW = Math.min(150, Math.max(56, W * 0.16)), nw = 12, pt = 18, pb = 6, gap = 6, ih = H - pt - pb;
    const xs = Array.from({ length: K }, (_, i) => labW + (W - labW * 2 - nw) * (K === 1 ? 0 : i / (K - 1)));
    // 節の位置（大きい順に上から。どの段も同じ縮尺: 段の数の多い所の隙間を引いた高さで決める）
    const maxN = Math.max(...nodes.map((mp) => mp.size)), scale = (ih - gap * (maxN - 1)) / total;
    const pos = nodes.map((mp, i) => { let y = pt; const out = new Map(); [...mp.entries()].sort((a, b) => Number(a[0] === OTHER) - Number(b[0] === OTHER) || b[1] - a[1]).forEach(([k, v]) => { out.set(k, { y, h: Math.max(1.5, v * scale), v, out: 0, in: 0 }); y += Math.max(1.5, v * scale) + gap; }); return out; });
    const colorOf = (i, k) => (k === OTHER ? "#a9b4be" : cof(name(i, k), ctx.rowColor && i === 0 ? ctx.rowColor(name(i, k)) : COLORS[[...pos[i].keys()].indexOf(k) % COLORS.length]));
    let g = lv.names.map((n, i) => `<text x="${xs[i] + nw / 2}" y="12" text-anchor="${i === 0 ? "start" : i === K - 1 ? "end" : "middle"}" class="pv-axn">${esc(fitW(n, K === 1 ? W : (W - labW * 2) / Math.max(1, K - 1), 12, 700))}</text>`).join("");
    // 帯（大きい物を先に描くと、小さい帯が上に見える）
    [...links.entries()].sort((a, b) => b[1] - a[1]).forEach(([key, v]) => {
      const [i0, a, b] = key.split(SEP), i = +i0, s0 = pos[i].get(a), t0 = pos[i + 1].get(b), w = v * scale;
      const y0 = s0.y + s0.out + w / 2, y1 = t0.y + t0.in + w / 2; s0.out += w; t0.in += w;
      const x0 = xs[i] + nw, x1 = xs[i + 1], mx = (x0 + x1) / 2;
      g += `<path d="M${x0},${y0}C${mx},${y0} ${mx},${y1} ${x1},${y1}" fill="none" stroke="${colorOf(i, a)}" stroke-opacity=".38" stroke-width="${Math.max(1, w)}"><title>${esc(name(i, a))} → ${esc(name(i + 1, b))}: ${esc(fmt(v))}（${pct(v / total)}）</title></path>`;
    });
    pos.forEach((mp, i) => mp.forEach((n, k) => {
      g += `<rect x="${xs[i]}" y="${n.y}" width="${nw}" height="${n.h}" rx="2" fill="${colorOf(i, k)}"><title>${esc(name(i, k))}: ${esc(fmt(n.v))}</title></rect>`;
      if (n.h >= 9 || mp.size <= 8) {
        const tx = i === 0 ? xs[i] - 5 : xs[i] + nw + 5;      // 最初の段は節の左・ほかは右に名前
        g += `<text x="${tx}" y="${n.y + n.h / 2 + 4}" text-anchor="${i === 0 ? "end" : "start"}" class="pv-ax pv-sk">${esc(fitW(name(i, k), labW - 8 - (LBL.top || LBL.inside || !ctx.compact ? textW(` ${nf(n.v)}`) : 0)))}${LBL.top || LBL.inside || !ctx.compact ? ` ${esc(nf(n.v))}` : ""}</text>`;
      }
    }));
    return { svg: svgOf(W, H, g, "サンキー図"), legend: `<small class="pv-cnote">帯の太さ＝${esc(ctx.measName(d.measures[j]))}（計 ${esc(fmt(total))}）・${lv.names.map(esc).join(" → ")}</small>` };
  }
  /** スイムレーン図: 行の段の 1 段目（設備など）ごとに横の帯（レーン）を引き、時の段（日付・作業日など。行の 2 段目か列の段）に沿って、
      値のある所に札を置く（濃さ・数＝値）。レーンごとの動き（いつ・どこで・どれだけ）を見る */
  function swimlaneChart(ctx) {
    const { m, d, W, H } = ctx, j = chartAt(ctx);
    const lv = levelsOf(ctx);
    if (!lv || lv.names.length < 2) return empty("スイムレーン図は、行の 1 段目にレーン（設備など）、行の 2 段目か列に時の段（日付・作業日など）を入れると描けます。");
    const xDim = m.nr >= 2 ? d.dims.rows[1] : d.dims.cols[0], time = isTimeDim(xDim);
    const lanesAll = [...new Set(lv.flows.map(([ks]) => ks[0]))];
    const laneTot = new Map(); lv.flows.forEach(([ks, v]) => laneTot.set(ks[0], (laneTot.get(ks[0]) || 0) + (v || 0)));
    const maxLanes = Math.max(2, Math.floor((H - 30) / 18)), lanes = lanesAll.slice(0, maxLanes);
    // 横の並び: 時の段は日付の順（間の日も）、そうでなければ表の並び（直なら勤務体系の順）
    const seen = new Set(lv.flows.map(([ks]) => ks[1]));
    const rank = xDim.column === "@shift" && (d.shifts || []).length ? d.shifts.concat(lv.order(1)) : lv.order(1);   // 直は勤務体系の順（合わせた表と同じ）
    let ticks = [...seen].sort((a, b) => { const x = rank.indexOf(a), y = rank.indexOf(b); return (x < 0 ? 1e9 : x) - (y < 0 ? 1e9 : y); }), part = "";
    if (time) {
      ticks.sort();
      part = xDim.column === "@workday" ? ({ ym: "ym", year: "year" }[xDim.part] || "date") : xDim.part;
      if (part === "date" && ticks.length && /^\d{4}-\d{2}-\d{2}$/.test(ticks[0])) {     // 間の日も空けて並べる
        ticks = daysBetween(ticks[0], ticks[ticks.length - 1], 400);
      }
    }
    const tickName = (k) => (time ? tickText(k, part) : String(lv.lab(1, k)));
    const longest = Math.max(0, ...lanes.map((k) => textW(String(lv.lab(0, k)))));
    const pl = Math.round(Math.max(48, Math.min(W * 0.3, longest + 16))), pr = 8, pt = 6, pb = 22 + tiltPad(ticks.map(tickName)), iw = W - pl - pr, ih = H - pt - pb;
    const lh = ih / Math.max(lanes.length, 1), cw = iw / Math.max(ticks.length, 1);
    const vals = new Map(lv.flows.map(([ks, v]) => [ks[0] + SEP + ks[1], v]));
    const max = Math.max(...lv.flows.map(([, v]) => (typeof v === "number" ? v : 0)), 1e-9);
    let g = "";
    lanes.forEach((lane, li) => {
      const y = pt + lh * li, nm = String(lv.lab(0, lane)), c = cof(nm, ctx.rowColor ? ctx.rowColor(nm) : COLORS[li % COLORS.length]);
      g += `<rect x="${pl}" y="${y}" width="${iw}" height="${lh}" fill="${li % 2 ? "#f6f8fa" : "#fff"}"/><text x="${pl - 8}" y="${y + lh / 2 + 4}" text-anchor="end" class="pv-ax">${esc(fitW(nm, pl - 10))}</text>`;
      ticks.forEach((k, i) => {
        const v = vals.get(lane + SEP + k);
        if (typeof v !== "number" || !v) return;
        const bw = Math.max(2, cw * 0.86), bh = Math.max(3, lh * 0.66), x = pl + cw * i + (cw - bw) / 2, yy = y + (lh - bh) / 2;
        g += `<rect x="${x}" y="${yy}" width="${bw}" height="${bh}" rx="${Math.min(4, bh / 3)}" fill="${c}" fill-opacity="${(0.25 + 0.75 * Math.max(0, v) / max).toFixed(2)}"><title>${esc(nm)} / ${esc(tickName(k))}: ${esc(fmt(v))}</title></rect>`;
        const t = nf(v);
        if ((LBL.top || LBL.inside || cw >= 26) && bw >= t.length * 6.4 + 4 && bh >= 12) g += `<text x="${x + bw / 2}" y="${yy + bh / 2 + 4}" text-anchor="middle" class="pv-vl pv-in">${esc(t)}</text>`;
      });
    });
    g += `<line x1="${pl}" x2="${pl}" y1="${pt}" y2="${pt + ih}" class="pv-axis"/><line x1="${pl}" x2="${W - pr}" y1="${pt + ih}" y2="${pt + ih}" class="pv-axis"/>`;
    const every = Math.max(1, Math.ceil(ticks.length / Math.max(3, Math.floor(iw / (F.xrot && +F.xrot ? 18 : 64)))));
    ticks.forEach((k, i) => { if (i % every === 0) g += xText(pl + cw * (i + 0.5), H - pb + 16, F.xrot && +F.xrot ? fitW(tickName(k), 150) : fitW(tickName(k), cw * every - 4)); });
    const more = lanesAll.length - lanes.length;
    return { svg: svgOf(W, H, g, "スイムレーン図"), legend: `<small class="pv-cnote">レーン＝${esc(lv.names[0])}・横＝${esc(lv.names[1])}・濃さ＝${esc(ctx.measName(d.measures[j]))}${more ? `・ほか ${more} レーン（パネルを大きくすると出ます）` : ""}</small>` };
  }

  /* ---- 登録（目的のまとまり → 形）。icon は 20×20 の絵（線の太さは CSS）。one＝グラフにする値を 1 つ選ぶ形 ----
     fit(f): いまの組み方に向くか（"" なら向く・字は向く組み方の説明）。f = {rows, cols, meas, numMeas, addMeas, additive, time, bin}（lotlist-pivot.js の fitInfo） */
  const GROUPS = [["trend", "推移を見る"], ["compare", "比べる・順位"], ["part", "内訳を見る"], ["dist", "ばらつきを見る"], ["rel", "関係を見る"], ["table", "表"]];
  const DEFS = [
    { k: "time", n: "時系列", g: "trend", tip: "日付・年月・作業日の段を、時の流れのまま（間の日も空けて）描きます。1 つ目の値は棒、2 つ目からは折れ線",
      icon: "M3 17h14M5 15v-4M8 15V8M11 15v-3M14 15V6M4 9l4-3 3 4 5-6", fit: (f) => (f.time ? "" : "行の 1 段目が日付・作業日のとき"), draw: (c) => (isTime(c.d) ? trendChart(c, "time") : barChart(c, "column", true)) },
    { k: "line", n: "折れ線", g: "trend", tip: "値の移り変わりを線で描きます（列の段があれば列ごとの線）。平均などの比べにも",
      icon: "M3 15l4-5 3 3 4-6 3 3", fit: (f) => (f.time ? "" : "行の 1 段目が日付・作業日のとき（種類の段なら縦棒）"), draw: (c) => trendChart(c, "line") },
    { k: "area", n: "面", g: "trend", tip: "値の移り変わりを線と、その下を塗った面で描きます（量の大きさが目に入る）。列の段があれば列ごとの面を重ねる",
      icon: "M3 17h14M3 15l4-6 3 3 4-5 3 3v5H3z", fit: (f) => (f.time ? "" : "行の 1 段目が日付・作業日のとき"), draw: (c) => trendChart(c, "area") },
    { k: "control", n: "管理図", g: "trend", one: true, tip: "並びのままの値に、中心線（平均）と管理限界（±3σ）を引き、外れた点・偏りを色で知らせます（I 管理図）",
      icon: "M3 5h14M3 15h14M3 10h14M4 11l3-3 3 4 3-5 3 3", fit: (f) => (f.time && !f.additive ? "" : "行が日付・作業日の段で、値が平均などのとき（ばらつきの管理）"), draw: controlChart },
    { k: "xbar", n: "X̄-R管理図", g: "trend", tip: "行の段（日・ロットなど）を群にして、群の平均 X̄ と範囲 R の管理図を上下に描きます（群の大きさから A2・D3・D4 で管理限界）",
      icon: "M3 3h14M3 9h14M4 7l3-2 3 3 3-3 3 2M3 12h14M3 17h14M4 15l3-1 3 1 3-2 3 1", fit: (f) => (f.rows && f.numMeas ? "" : "行が日・ロットなどの順の段で、値に数のカラム（平均など）があるとき"), draw: xbarChart },
    { k: "swimlane", n: "スイムレーン", g: "trend", one: true, tip: "行の 1 段目（設備など）ごとのレーンに、時の段（日付・作業日）に沿って値の札を並べます（いつ・どこで・どれだけ）",
      icon: "M2 3h16M2 8h16M2 13h16M2 18h16M4 5h3v2H4zM9 10h4v2H9zM6 15h3v2H6zM14 5h3v2h-3z", fit: (f) => ((f.rows >= 2 || (f.rows && f.cols)) ? "" : "行の 1 段目にレーン（設備など）、行の 2 段目か列に日付・作業日の段があるとき"), draw: swimlaneChart },
    { k: "combo", n: "組み合わせ", g: "compare", tip: "値（系列）ごとに 棒・線・面 と 左・右の目盛り を組み合わせて 1 つのグラフに重ねます（本数の棒と平均の線、目標の線と実績の棒など。書式の「系列」で系列ごとに決められます）",
      icon: "M3 17h14M5 15v-5M9 15V8M13 15v-6M3 9l4-3 4 2 6-4", fit: (f) => (f.rows && (f.meas > 1 || f.cols) ? "" : "値が 2 つ以上（か列の段がある）とき"), draw: (c) => trendChart(c, "combo") },
    { k: "column", n: "縦棒", g: "compare", one: true, tip: "行の段ごとに縦の棒で比べます", icon: "M3 17h14M5 15V9M9 15V5M13 15v-4M16 15V8",
      fit: (f) => (f.rows && !f.time && !f.bin ? "" : "行が種類の段（設備・不良名など）のとき"), draw: (c) => barChart(c, "column", false) },
    { k: "bar", n: "横棒", g: "compare", one: true, tip: "行の段ごとに横の棒で比べます（名前が長いとき）", icon: "M3 3v14M3 5h10M3 9h14M3 13h6",
      fit: (f) => (f.rows && !f.time && !f.bin ? "" : "行が種類の段で、名前が長いとき"), draw: (c) => barChart(c, "bar", false) },
    { k: "lollipop", n: "ロリポップ", g: "compare", one: true, tip: "棒の代わりに細い線と点で比べます（項目が多くても軽く読める）", icon: "M3 17h14M5 15V9M9 15V5M13 15v-4M16 15V8M5 8.5h.1M9 4.5h.1M13 10.5h.1M16 7.5h.1",
      fit: (f) => (f.rows && !f.time && !f.bin ? "" : "行が種類の段（設備・不良名など）のとき"), draw: (c) => barChart(c, "lollipop", false) },
    { k: "pareto", n: "パレート図", g: "compare", one: true, tip: "大きい順の棒と累積の割合の線で、上位のどれだけで全体の 80% になるか（重点の項目）を見ます",
      icon: "M3 17h14M4 15V5M7 15V8M10 15v-4M13 15v-2M4 6c4-3 9-3 12-3", fit: (f) => (f.rows && !f.time && !f.bin && f.additive ? "" : "行が種類の段（不良名・設備など）で、値が件数・ロット数・合計のとき"), draw: paretoChart },
    { k: "waterfall", n: "ウォーターフォール", g: "part", one: true, tip: "行の段の並びのまま、値の増え（上へ）と減り（下へ）を前の棒の終わりから積み、終わりに計の棒を立てます（何がどれだけ足し引きされて今の数になったか）",
      icon: "M3 17h14M4 15V9M7 9V6M10 6v4M13 10V8M16 15V8", fit: (f) => (f.rows && !f.bin ? "" : "行に段（並べる項目）があるとき"), draw: waterfallChart },
    { k: "stack", n: "積み上げ", g: "part", one: true, tip: "行の段ごとの棒を、列の段（か 2 つ以上の足し上げる値）で積み上げます。高さ＝合計",
      icon: "M3 17h14M5 15v-4M5 11V7M10 15V9M10 9V4M15 15v-3M15 12V9", fit: (f) => (f.rows && (f.cols || f.addMeas > 1) && f.additive ? "" : "列に段があり（か足し上げる値が 2 つ以上）、値が件数・ロット数・合計のとき"), draw: (c) => stackChart(c, false) },
    { k: "stack100", n: "100%積み上げ", g: "part", one: true, tip: "積み上げを 100% にそろえ、行の段ごとの内訳の割合を比べます",
      icon: "M3 3h14M3 17h14M5 17V3M10 17V3M15 17V3M5 10h5M10 7h5M15 12h0", fit: (f) => (f.rows && (f.cols || f.addMeas > 1) && f.additive ? "" : "列に段があり（か足し上げる値が 2 つ以上）、値が件数・ロット数・合計のとき"), draw: (c) => stackChart(c, true) },
    { k: "hstack", n: "積み上げ横棒", g: "part", one: true, tip: "行の段ごとの横の棒を、列の段（か 2 つ以上の足し上げる値）で左から右へ積み上げます。長さ＝合計（名前が長い・項目が多いとき）",
      icon: "M3 3v14M3 5h5M8 5h4M3 10h8M11 10h5M3 15h3M6 15h4", fit: (f) => (f.rows && (f.cols || f.addMeas > 1) && f.additive ? "" : "列に段があり（か足し上げる値が 2 つ以上）、値が件数・ロット数・合計のとき"), draw: (c) => stackChart(c, false, true) },
    { k: "hstack100", n: "100%積み上げ横棒", g: "part", one: true, tip: "横の積み上げを 100% にそろえ、行の段ごとの内訳の割合を比べます（名前が長い・項目が多いとき）",
      icon: "M3 3v14M17 3v14M3 5h6M9 5h8M3 10h10M13 10h4M3 15h4M7 15h10", fit: (f) => (f.rows && (f.cols || f.addMeas > 1) && f.additive ? "" : "列に段があり（か足し上げる値が 2 つ以上）、値が件数・ロット数・合計のとき"), draw: (c) => stackChart(c, true, true) },
    { k: "stackarea", n: "積み上げ面", g: "part", one: true, tip: "時の流れに沿って、列の段の内訳を面で積み上げます（高さ＝合計。内訳の移り変わり）",
      icon: "M3 17h14M3 15l4-3 4 1 6-4v8H3zM3 11l4-4 4 2 6-5", fit: (f) => (f.time && f.cols && f.additive ? "" : "行の 1 段目が日付・作業日で、列に段があり、値が件数・ロット数・合計のとき"), draw: (c) => (isTime(c.d) ? trendChart(c, "stackarea") : stackChart(c, false)) },
    { k: "donut", n: "ドーナツ", g: "part", one: true, tip: "行の段の割合を輪で見ます（大きい順に 9 つ＋その他）。足し上げる値のとき",
      icon: "M10 3a7 7 0 1 0 7 7h-4a3 3 0 1 1-3-3zM12 3.3a7 7 0 0 1 4.7 4.7h-4.2", fit: (f) => (f.rows && f.additive && !f.time && !f.bin && !f.cols ? "" : "行が種類の段（列なし）で、値が件数・ロット数・合計のとき"), draw: donutChart },
    { k: "sankey", n: "サンキー図", g: "part", one: true, tip: "段から段への流れ（仕掛区分 → 設備など）を、太さが量の帯で描きます。行に段を 2〜3 つ（から → へ）か、行と列に段",
      icon: "M3 4h2v5H3zM3 12h2v4H3zM15 3h2v7h-2zM15 13h2v3h-2zM5 6c5 0 5-2 10-2M5 7.5c5 0 5 4 10 4M5 14c5 0 5 1 10 1.5", fit: (f) => ((f.rows >= 2 || (f.rows && f.cols)) && f.additive ? "" : "行に段を 2 つ（から → へ）か、行と列に段があり、値が件数・ロット数・合計のとき"), draw: sankeyChart },
    { k: "treemap", n: "ツリーマップ", g: "part", one: true, tip: "行の段の割合を四角の面積で敷き詰めます（項目が多い内訳。大きい物から目に入る）",
      icon: "M3 3h14v14H3zM11 3v14M3 11h8M11 8h6M14 8v9", fit: (f) => (f.rows && f.additive && !f.time && !f.bin && !f.cols ? "" : "行が種類の段（列なし）で、値が件数・ロット数・合計のとき"), draw: treemapChart },
    { k: "hist", n: "ヒストグラム", g: "dist", tip: "数の列を区間に分け、件数の山で傾向（ばらつき・偏り）を見ます",
      icon: "M3 17h14M4 15v-3M7 15V8M10 15V4M13 15V9M16 15v-4", fit: (f) => (f.bin ? "" : "行の 1 段目が数のカラムの区間のとき（選ぶと区間に分けます）"), draw: histChart },
    { k: "box", n: "箱ひげ図", g: "dist", tip: "行の段ごとに、数の列の分かれ方（中央値・四分位・外れ値）を並べて比べます",
      icon: "M6 3v3M6 14v3M4 6h4v8H4zM4 10h4M14 5v2M14 13v3M12 7h4v6h-4zM12 9h4", fit: (f) => (f.numMeas && f.rows && !f.time && !f.bin ? "" : "行が種類の段で、値に数のカラム（平均など）があるとき"), draw: boxChart },
    { k: "violin", n: "バイオリン", g: "dist", tip: "行の段ごとに、数の列の分布の形（山の数・偏り）を左右対称の形で並べて比べます。中に四分位と中央値",
      icon: "M6 3c-2 3 2 4 0 7s-2 4 0 7c2-3-2-4 0-7s2-4 0-7zM14 3c-2 4 2 5 0 7s-2 4 0 7c2-3-2-4 0-7s2-3 0-7z", fit: (f) => (f.numMeas && f.rows && !f.time && !f.bin ? "" : "行が種類の段で、値に数のカラム（平均など）があるとき"), draw: violinChart },
    { k: "heat", n: "ヒートマップ", g: "rel", one: true, tip: "行×列の値を色の濃さで見ます（日×直・曜日×時など、偏りの場所を探す）",
      icon: "M3 3h4v4H3zM8 3h4v4H8zM13 3h4v4h-4zM3 8h4v4H3zM8 8h4v4H8zM13 8h4v4h-4zM3 13h4v4H3zM8 13h4v4H8zM13 13h4v4h-4z", fit: (f) => (f.rows && f.cols ? "" : "行と列の両方に段があるとき"), draw: heatChart },
    { k: "scatter", n: "散布図", g: "rel", tip: "2 つの値の関係を点で見ます（1 つ目＝横・2 つ目＝縦。行の葉ごとに 1 点）。相関係数と直線つき",
      icon: "M3 3v14h14M6 13h.1M8 10h.1M10 11h.1M12 7h.1M14 6h.1M9 14h.1", fit: (f) => (f.numMeas >= 2 ? "" : "値に数のカラムが 2 つあるとき"), draw: scatterChart },
    { k: "bubble", n: "バブル", g: "rel", tip: "3 つの値の関係を、横・縦・円の大きさで見ます（行の葉ごとに 1 つの円）",
      icon: "M3 3v14h14M7 12h.1M7 12a2 2 0 1 0 0 .1M12 8a3 3 0 1 0 0 .1M14 13a1.5 1.5 0 1 0 0 .1", fit: (f) => (f.numMeas >= 3 || f.meas >= 3 ? "" : "値が 3 つあるとき"), draw: bubbleChart },
    { k: "diag45", n: "45度線管理図", g: "rel", tip: "2 つの値（2 通りの測り方・前後など）を横と縦にし、45 度の線からのずれ（偏り）と、差の ±3σ の帯（ばらつき）で一致を管理します",
      icon: "M3 3v14h14M4 16L16 4M4 12L12 4M8 16l8-8M8 11h.1M11 9h.1M13 6h.1", fit: (f) => (f.numMeas >= 2 ? "" : "値に数のカラムが 2 つあるとき"), draw: diag45Chart },
    { k: "none", n: "表だけ", g: "table", tip: "グラフを出さず、表だけを広く出します", icon: "M3 4h14v12H3zM3 8h14M3 12h14M8 4v12", fit: () => "", draw: null },
  ];
  /* ---- 答え → 表の形（行・列の葉。小計・総計を入れる）と表（集計表・ダッシュボードのパネルで同じ。版 3.37.0 で lotlist-pivot.js から移した） ---- */
  function buildModel(d, s) {
    const nr = d.dims.rows.length, nc = d.dims.cols.length, M = d.measures.length, split = dayAt(d) === 1;
    const cellMap = new Map(d.cells.map((x) => [x.r.join(SEP) + "\u001e" + x.c.join(SEP), x.v]));
    const lab = (i, k) => (d.labels[i] || {})[k] ?? k;
    const leaves = (n, off, axis) => {
      if (!n) return [{ type: "all", path: [] }];
      const have = new Set(d.cells.filter((x) => x[axis].length === n).map((x) => x[axis].join(SEP)));
      const rank = Array.from({ length: n }, (_, i) => new Map((d.orders[off + i] || []).map((k, j) => [k, j])));
      const paths = [...have].map((p) => p.split(SEP)).sort((a, b) => { for (let i = 0; i < n; i++) { const x = rank[i].get(a[i]) ?? 1e9, y = rank[i].get(b[i]) ?? 1e9; if (x !== y) return x - y; } return 0; });
      const out = [];
      paths.forEach((p, k) => {
        out.push({ type: "data", path: p });
        // この段の頭が次の葉で変わる所に小計（下の段から）
        // 月で区切ったときは、月（1 段目）の小計はいつも出す
        if (s.sub || (axis === "r" && split)) for (let lv = s.sub ? n - 1 : 1; lv >= 1; lv--) {
          const next = paths[k + 1];
          if (!next || next.slice(0, lv).join(SEP) !== p.slice(0, lv).join(SEP)) out.push({ type: "sub", path: p.slice(0, lv) });
        }
      });
      if (s.grand) out.push({ type: "grand", path: [] });
      return out;
    };
    const rows = leaves(nr, 0, "r"), cols = leaves(nc, nr, "c");
    const value = (r, c, j) => { const v = cellMap.get(r.path.join(SEP) + "\u001e" + c.path.join(SEP)); return v ? v[j] : null; };
    return { nr, nc, M, rows, cols, value, lab, rowName: (r) => r.path.map((k, i) => lab(i, k)).join(" / "), colName: (c) => c.path.map((k, i) => lab(nr + i, k)).join(" / ") };
  }
  /** names: {measName, dimName}（値・段の見せる名前。一覧は列の表示名を使う） */
  /** @type {(v: any, j?: number) => string} 既定の数の書き方（値の番号 j は使わない） */
  const fmtOf = (v) => fmt(v);
  function tableHtml(m, d, { measName, dimName, num = fmtOf }) {
    const { nr, nc, M, rows, cols } = m;
    const mNames = d.measures.map((x) => measName(x));
    // 見出し: 列の段ごとの行（同じ頭はまとめる）＋値の名前の行（値が 2 つ以上か、列が無いとき）
    let head = "";
    const withMeasRow = M > 1 || !nc;
    const headRows = nc + (withMeasRow ? 1 : 0);
    const corner = `<th class="pv-corner" rowspan="${headRows}" colspan="${Math.max(1, nr)}">${esc(d.dims.rows.map((x) => dimName(x)).join(" ＞ "))}${nc ? `<small>${esc(d.dims.cols.map((x) => dimName(x)).join(" ＞ "))} →</small>` : ""}</th>`;
    for (let lv = 0; lv < nc; lv++) {
      let tr = lv === 0 ? corner : "";
      for (let i = 0; i < cols.length;) {
        const c = cols[i];
        if (c.type === "grand") { if (lv === 0) tr += `<th class="pv-gt" rowspan="${nc}" colspan="${M}">総計</th>`; i++; continue; }
        if (c.type === "sub" && c.path.length <= lv) { if (c.path.length === lv) tr += `<th class="pv-st" rowspan="${nc - lv}" colspan="${M}">${esc(m.lab(nr + lv - 1, c.path[lv - 1]))} 小計</th>`; i++; continue; }
        let j = i + 1;
        const pref = c.path.slice(0, lv + 1).join(SEP);
        while (j < cols.length && cols[j].type !== "grand" && cols[j].path.length > lv && cols[j].path.slice(0, lv + 1).join(SEP) === pref) j++;
        tr += `<th colspan="${(j - i) * M}">${esc(m.lab(nr + lv, c.path[lv]))}</th>`;
        i = j;
      }
      head += `<tr>${tr}</tr>`;
    }
    if (withMeasRow) head += `<tr>${nc ? "" : corner}${cols.map(() => mNames.map((n) => `<th class="pv-mh">${esc(n)}</th>`).join("")).join("")}</tr>`;
    // 本文: 行の見出し（同じ頭は縦にまとめる）＋数
    const span = (i, lv) => { let j = i + 1; const pref = rows[i].path.slice(0, lv + 1).join(SEP); while (j < rows.length && rows[j].type === "data" && rows[j].path.slice(0, lv + 1).join(SEP) === pref) j++; return j - i; };
    const body = rows.map((r, i) => {
      let th = "";
      if (r.type === "grand") th = `<th colspan="${Math.max(1, nr)}" class="pv-gt">総計</th>`;
      else if (r.type === "sub") th = `<th colspan="${nr}" class="pv-st">${esc(m.rowName(r))} 小計</th>`;   // 段の数に関わらず全段にまたがらせる（列がずれない）
      else if (!nr) th = "<th>（全体）</th>";
      else for (let lv = 0; lv < nr; lv++) {
        const prev = rows[i - 1];
        const cont = prev && prev.type === "data" && prev.path.slice(0, lv + 1).join(SEP) === r.path.slice(0, lv + 1).join(SEP);
        if (!cont) th += `<th rowspan="${lv === nr - 1 ? 1 : span(i, lv)}">${esc(m.lab(lv, r.path[lv]))}</th>`;
      }
      const tds = cols.map((c) => d.measures.map((_, j) => { const v = m.value(r, c, j); return `<td class="${c.type === "grand" ? "pv-gtc" : c.type === "sub" ? "pv-stc" : ""}">${num(v, j)}</td>`; }).join("")).join("");
      return `<tr class="${r.type === "grand" ? "is-grand" : r.type === "sub" ? "is-sub" : ""}">${th}${tds}</tr>`;
    }).join("");
    return `<thead>${head}</thead><tbody>${body}</tbody>`;
  }
  /* ---- 値の種類（版 3.39.0。サーバーの services/aggregate.py と同じ鍵）。g: basic（よく使う）・stat（統計）・kind（種類）。param: 決める数 ---- */
  const AGGS = [
    { k: "sum", n: "合計", g: "basic" }, { k: "avg", n: "平均", g: "basic" }, { k: "min", n: "最小", g: "basic" }, { k: "max", n: "最大", g: "basic" },
    { k: "n", n: "個数", g: "basic", tip: "数に読める値の数" },
    { k: "median", n: "中央値", g: "stat" }, { k: "sd", n: "標準偏差", g: "stat", tip: "標本の標準偏差（n−1 で割る）" }, { k: "var", n: "分散", g: "stat" },
    { k: "range", n: "範囲", g: "stat", tip: "最大 − 最小" }, { k: "cv", n: "変動係数(%)", g: "stat", tip: "標準偏差 ÷ 平均 × 100" },
    { k: "q1", n: "25%点", g: "stat" }, { k: "q3", n: "75%点", g: "stat" }, { k: "iqr", n: "四分位範囲", g: "stat", tip: "75%点 − 25%点" },
    { k: "pct", n: "p%点", g: "stat", param: "p", tip: "小さい方から p% の所の値（90%点など）" }, { k: "mode", n: "最頻値", g: "stat", tip: "いちばん多く出た値（同じ数なら小さい方）" },
    { k: "cpk", n: "工程能力 Cpk", g: "stat", param: "spec", tip: "規格（下限・上限）に対する工程能力。min(上限−平均, 平均−下限) ÷ 3σ" },
    { k: "distinct", n: "種類の数", g: "kind", any: true, tip: "重複の無い値の数（数でない列も）" },
  ];
  const SHOWS = [["", "そのまま"], ["pct_total", "総計に対する%"], ["pct_row", "行の計に対する%"], ["pct_col", "列の計に対する%"], ["cum", "累計"], ["diff", "前との差"], ["rank", "順位（大きい順）"]];
  const aggOf = (k) => AGGS.find((a) => a.k === k);
  /** 値の名前（件数・ロット数・〇〇の平均・〇〇の90%点（累計）・計算〈版 3.50.0〉は［値÷1000］）。label(列) → 見せる列の名前。
      サーバーの aggregate.name と同じ字（系列の色・書式の鍵にもなる） */
  function measLabel(m, label = (c) => c) {
    const show = m.show ? `（${(SHOWS.find((x) => x[0] === m.show) || ["", ""])[1]}）` : "";
    const ex = m.expr ? `［${exprText(m.expr)}］` : "";
    if (m.agg === "count" || m.agg === "lots") return (m.agg === "count" ? "件数" : "ロット数") + show + ex;
    const a = aggOf(m.agg) || AGGS[0];
    return `${label(m.column)}の${m.agg === "pct" ? `${m.p || 90}%点` : a.n}${show}${ex}`;
  }
  /** 計算の見せ方（÷1000 → 値÷1000。読めない式は書いたまま） */
  const exprText = (src) => (WL.numFormat && WL.numFormat.expr(src).text) || String(src);
  const byKey = new Map(DEFS.map((x) => [x.k, x]));
  const iconSvg = (k, size = 18) => { const x = byKey.get(k); return x ? `<svg class="pv-ico" viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true"><path d="${x.icon}"/></svg>` : ""; };
  /** 描く（形が分からなければ縦棒）。高さ: 横棒は行の数で伸ばす・ほかは 300 */
  /** ctx.H があればその高さ（ダッシュボードのパネル: パネルの大きさに合わせる） */
  /** ctx.colors があれば、描く間だけ系列の色を替える（描くのは同じ流れの中で終わるので、ほかの描き方に漏れない）。
      ctx.rowColor(名前) があれば、1 系列の棒を行ごとの色で塗る（ダッシュボード: 同じ種類はどのパネルでも同じ色） */
  /** 書式（fmt の桁・単位）で数を字にする（ダッシュボードの数字・合わせた表）。fmt が空なら fmt と同じ見せ方（丸めない） */
  function numText(v, fm) {
    // 所要時間（分）の値は、所要時間の書き方の1箇所（WL.duration。既定は「90分」・「時間と分」なら「1時間30分」）で書く（§9.628・§9.341）。
    // 書式で桁・単位・表示形式を決めていればそちら（measFmt が minutes を付けない）
    if (fm && fm.minutes && typeof v === "number" && WL.duration) return WL.duration.text(v);
    if (!fm || (fm.digits == null && !fm.unit && !fm.num)) return fmt(v);
    const keep = F; F = fm;
    try { return nf(v); } finally { F = keep; }
  }
  /** 表のセル・数字の字（HTML）: 表示形式の色（[赤] など）か、書式の字の色（fm.ncolor）を付ける */
  function numHtml(v, fm) {
    if (v == null) return "–";
    const t = esc(numText(v, fm));
    const c = fm && fm.num && WL.numFormat && typeof v === "number" ? WL.numFormat.format(v / (DIVS[fm.unit] || [1])[0], fm.num).color : "";
    return c ? `<span style="color:${c}">${t}</span>` : t;
  }
  /** 値の桁（版 3.50.1。値ごとの dec）を書式に重ねる: 桁を決めた値は、その桁で書く（書式の桁・表示形式コードを決めていれば、そちらが先）。
      千・万の自動の割り算はせず（表の数は割らずに並べる）、書式で千・万を決めていればそれに従う */
  function measFmt(fm, m) {
    const f0 = fm || {};
    // 分の値（サーバーが unit: min を添える）: 書式で桁・単位・表示形式を決めていなければ、端末の時間の書き方に任せる
    const f = m && m.unit === "min" && f0.digits == null && !f0.num && (!f0.unit || f0.unit === "auto") ? { ...f0, minutes: true } : f0;
    if (!m || m.dec == null || f.digits != null || f.num) return f;
    return { ...f, digits: m.dec, unit: f.unit && f.unit !== "auto" ? f.unit : "none" };
  }
  /** ctx.fmt（版 3.39.0）があれば、描く間だけ書式を当てる（数値ラベル・日付の形・桁・単位・縦軸・基準線・名前ごとの色） */
  function draw(kind, ctx) {
    const def = byKey.get(kind) || byKey.get("column");
    const H = ctx.H || (kind === "bar" || kind === "hstack" || kind === "hstack100" ? Math.max(260, Math.min(900, 26 * dataRows(ctx.m).length + 60)) : kind === "donut" ? 320 : kind === "diag45" ? 420 : kind === "xbar" ? 380 : 300);
    const keep = [COLORS, F, LBL.top, LBL.inside, USED, SER, SDEC, LDEC];
    if (ctx.colors) COLORS = ctx.colors;
    USED = new Map(); SER = new Map();
    F = ctx.fmt || {};
    // 値ごとの桁（版 3.50.1）: 数値ラベルは系列の値の桁（名前で引く）。名前の分からない所は、グラフにする値の桁。目盛りは自動のまま
    const ms = (ctx.d && ctx.d.measures) || [];
    SDEC = new Map(ctx.measName ? ms.filter((m) => m.dec != null).map((m) => [ctx.measName(m), m.dec]) : []);
    LDEC = (ms[Math.min((ctx.s && ctx.s.chartAt) || 0, Math.max(ms.length - 1, 0))] || {}).dec ?? null;
    const lb = F.labels || (ctx.s && ctx.s.labels ? "top" : "none");
    LBL.top = lb === "top" || lb === "both"; LBL.inside = lb === "inside" || lb === "both";
    try { const out = def.draw({ ...ctx, H }); return { ...out, used: [...USED], ser: [...SER] }; } finally { [COLORS, F, LBL.top, LBL.inside, USED, SER, SDEC, LDEC] = keep; }
  }
  WL.pivotCharts = { DEFS, GROUPS, get: (k) => byKey.get(k), draw, iconSvg, fmt, short, numText, numHtml, textW, fitW, AGGS, SHOWS, aggOf, measLabel, exprText, measFmt, dayAt, isDay, isTimeDim, ADDITIVE, COLORS, buildModel, tableHtml };
})();
