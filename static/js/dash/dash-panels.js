/* =========================================================================
   ダッシュボードのパネルの中身（版 3.37.0。グリッドと組み立ては dashboard.js・dashboard-editor.js）
   パネルの大きさに合わせて描く（スクロールしない）:
     数字（kpi）   … 値の総計を大きく。字の大きさはパネルの高さと幅で決める。値が 2 つ以上なら 2 つ目からは下に小さく
     グラフ        … 集計表と同じ描き方（lotlist-pivot-charts.js）を、パネルの幅・高さ・詰めた形（compact）で。
                     種類の段（設備・仕掛区分など）は、入る数だけ（大きい順にしていれば上位）を描き、残りの数を下に出す
     表（none）    … 集計表と同じ表。字と行の高さを詰めて収め、それでも入らない行は「ほか n 行」
     合わせた表（board）… 行の段を共通にして列のまとまりを横に並べる（版 3.38.0。設備ごとの仕掛と前日の実績はこの形）。表と同じ詰め方
   数え方はサーバー（POST /api/dashboard/query → services/pivot.py の query_many）。ここは答えを描くだけ
   ========================================================================= */
(function(){
  "use strict";
  const { esc } = WL.dashKit;
  const C = WL.pivotCharts;
  const PART_NAME = { date: "年月日", ym: "年月", year: "年", month: "月", weekday: "曜日", hour: "時", bin: "区間" };
  const CATEGORY = new Set(["column", "bar", "lollipop", "pareto", "donut", "treemap", "stack", "stack100", "hstack", "hstack100", "box", "violin"]);   // 種類の段を並べる形（入る数だけ描く）
  /* 色（2026-10-grid の 2 回目）: 色＝データの種類。仕掛（データ元）＝藍・作業実績＝青緑・品質データ＝琥珀（1 枚の表の仕掛の棒・実績の濃淡も同じ）。
     種類の少ない段（8 つまで。仕掛区分など）の 1 系列の棒・ドーナツは、名前ごとに決まった色（どのパネルでも同じ名前は同じ色） */
  /* 色の意味は1つ（§9.628 の採点: 青緑が「作業実績」「設備 B」「2名班」の3つの意味を持っていた）: 色相は設備だけ（EQUIP_COLORS）。
     量の棒・1 つの値の図は紺（NAVY）、設備でない系列（人数・品種など）は紺の濃淡。データの種類の色（前は作業実績＝青緑・ほか＝藍）はやめた */
  const NAVY = "#3f6591";
  const SOURCE_COLOR = { work: NAVY, src: NAVY };
  // 設備でない系列（人数など）は灰の濃淡（紺は量・1 つの値の色。同じ紺が隣のパネルで「2名班」と「品種の量」になった・§9.628 の 6 回目の採点）
  const SERIES_SHADES = ["#33424a", "#6b7f88", "#a3b1b7", "#4f5f67", "#87989f", "#c3ccd0"];
  // 設備の色（紺・赤・桃を使わない: 紺は量、赤は警告）
  const EQUIP_COLORS = ["#2f7d78", "#b5822a", "#7658ae", "#5c8a2a", "#8a5f18", "#0d8191", "#7a7a1f", "#8e4f76"];
  // 合わせるデータの役割の色（組む所の札・全体の表の行の頭・グラフの系列で同じ）。差＝灰・達成率＝琥珀
  const ROLE_COLOR = { target: "#7658ae", actual: "#2f7d78", base: "#4a62b0", "": "#5a6f77", diff: "#5a6f77", rate: "#b5822a" };
  const kindOf = (src) => (WL.dashKit.src.isWork(src) ? "work" : "src");
  const colorOf = (src) => SOURCE_COLOR[kindOf(src)];
  /* 色の組（版 3.39.0。書式 palette。利用者の要望 7）: "" はデータの種類の色（今まで）。分類の組は dataviz の検証（色覚の差・明るさ・字の背景との差）を通した並び。
     濃淡の組は 1 つの色の明るさの段（濃い → 淡い。順位・大きさを見せる） */
  const PALETTES = {
    calm: { n: "落ち着いた", c: ["#3a6db0", "#c27a1e", "#159483", "#7458c4", "#5d8f1f", "#b2507f"] },
    vivid: { n: "はっきり", c: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"] },
    cud: { n: "色覚に配慮", c: ["#0072b2", "#e69f00", "#009e73", "#d55e00", "#cc79a7", "#56b4e9"] },
    mono: { n: "藍の濃淡", c: ["#1f3a5f", "#2f5583", "#4a73a6", "#7395c2", "#a3bbd9", "#cbd8ea"] },
    warm: { n: "暖色の濃淡", c: ["#7a2e0e", "#a8461a", "#cf6a2c", "#e3934d", "#efbb80", "#f6dcb5"] },
    cool: { n: "寒色の濃淡", c: ["#0f4a46", "#16706a", "#23968c", "#55b8ad", "#92d3ca", "#c7e9e3"] },
  };
  /** パネルごとに描いた系列・項目の色（名前 → 色）。組む所の「系列」の見本に使う（描いた色そのもの） */
  const drawn = new Map();
  const drawnSer = new Map();     // パネルごとに描いた系列の形と目盛り（名前 → {kind, axis}。組む所の「自動（棒）」。版 3.46.0）
  const hash = (t) => { let h = 0; for (const ch of String(t)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h; };
  /** その図の名前の並び → 名前ごとの色（名前で決まる色。図の中で同じ色が重なれば次の色へ＝同じ図に同じ色は出さない） */
  /** @param {string[]} names @param {string[]} list */
  function catColors(names, list) {
    const used = new Set(), map = new Map();
    names.forEach((n) => { let i = hash(n) % list.length; for (let k = 0; k < list.length && used.has(i); k++) i = (i + 1) % list.length; used.add(i); map.set(n, list[i]); });
    return (n) => map.get(n) || list[hash(n) % list.length];
  }
  /* 設備の色（§9.628）: 同じ設備はどのパネルでも同じ色（前は系列の何番目かで決め、図の種類で始まりの色が違い、同じ設備が橙と青緑に分かれた）。
     並びは設備の木（実際に出てくる設備・dashboard.js が setEquipOrder で渡す）の順、木に無い設備は名前から。書式で決めた色（colors）が先 */
  let equipOrder = () => [];
  function equipColor(name, list = EQUIP_COLORS) {
    const order = equipOrder(), i = order.indexOf(name);
    return list[(i >= 0 ? i : order.length + hash(name)) % list.length];
  }
  /** 列の段の系列の色を名前で決めて書式の色（名前 → 色）に重ねる: 設備なら設備の色、ほかは灰の濃淡（並びの順）。
      名前で決めるので、図の種類ごとの「何番目の色から始めるか」の違いに左右されない。色の組を選んでいれば、その組 */
  function withSeriesColors(fm, d, m) {
    const c0 = (d.dims.cols || [])[0];
    if (!c0 || !m.nc) return fm;
    const pal = PALETTES[fm.palette || ""], names = m.cols.filter((c) => c.type === "data").map((c) => m.colName(c));
    const of = c0.column === "@equip" ? (n) => equipColor(n, pal ? pal.c : EQUIP_COLORS) : (n, i) => (pal ? pal.c : SERIES_SHADES)[i % (pal ? pal.c : SERIES_SHADES).length];
    return { ...fm, colors: { ...Object.fromEntries(names.map((n, i) => [n, of(n, i)])), ...(fm.colors || {}) } };
  }
  /** パネルの系列の色の並び（色の組を選んでいればその組。無ければデータの種類の色から） */
  function seriesColors(p) {
    if (p._facetColor) return [p._facetColor, ...C.COLORS.filter((c) => c !== p._facetColor)];   // 並べる: その設備の色（重ねるときの系列の色と同じ）
    const pal = PALETTES[((p.fmt || {}).palette) || ""];
    if (pal) return pal.c.concat(C.COLORS.filter((c) => !pal.c.includes(c)));
    return [NAVY].concat(SERIES_SHADES);     // 1 つの値は紺。列の段の系列は withSeriesColors が名前で決める
  }

  /* ---- 名前（集計表と同じ言葉。列はそのままの名前） ---- */
  const workdayName = (p) => `作業日（${(p && p.basis) === "cal" ? "太陽暦" : "現場歴"}）`;
  const dimName = (x, p) => (x.column === "@equip" ? "設備" : x.column === "@egroup" ? `設備グループ${x.part && x.part !== "@panel" ? `（${x.part}）` : ""}` : x.column === "@shift" ? "直"
    : x.column === "@workday" ? workdayName(p) + (x.part ? `（${{ ym: "年月", year: "年" }[x.part] || ""}）` : "")
      : x.column + (x.part ? `（${PART_NAME[x.part] || x.part}）` : ""));
  // 別のデータを合わせた答え（版 3.40.0。link）の値は、サーバーが役割つきの名前（目標：仕掛のロット数 など）を付ける
  const measName = (m) => (m.role != null && m.name ? m.name : C.measLabel(m));
  const md = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${+m[2]}/${+m[3]}` : iso || ""; };
  /** 期間の見せ方（「前日 10/15（現場歴）」「直近 14 日 10/2〜10/15」）。設備で日が違えば、いちばん多い範囲 */
  /** 期間の字。withBasis=false は日付の数え方（現場歴など・basisOf）を付けない（道具の行の「パネル共通」が1回だけ言うとき・§9.628） */
  function periodText(p, d, withBasis = true) {
    const pr = d && d.period;
    if (!pr) return d && d.periodMixed ? "データごとに違います" : "";
    const r = (pr.ranges || [])[0], basis = withBasis ? `（${basisOf(p, d)}）` : "";
    // 年をまたぐ期間は年も書く（§9.628。「10/24〜10/23」は 1 日前から今日に読めた）
    const ymd = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${m[1]}/${+m[2]}/${+m[3]}` : iso || ""; };
    const cross = r && String(r.from).slice(0, 4) !== String(r.to).slice(0, 4);
    const span = r ? (r.from === r.to ? md(r.from) : cross ? `${ymd(r.from)}〜${ymd(r.to)}` : `${md(r.from)}〜${md(r.to)}`) : "";
    const name = pr.kind === "days" ? `直近 ${pr.n} 日` : pr.kind === "range" ? "" : pr.name;     // 日付で決めた期間は日付だけ（版 3.52.0。1280 の数字のパネルで添え書きが 2 段に折れた）
    return `${name ? name + " " : ""}${span}${basis}${(pr.ranges || []).length > 1 ? "・設備で日が違います" : ""}`;
  }
  /** 期間の日付をどう数えるか（作業日なら現場歴／太陽暦・ほかは列の名前）。期間が無ければ "" */
  const basisOf = (p, d) => { const pr = d && d.period; return !pr ? "" : pr.column === "@workday" ? ((p && p.basis) === "cal" ? "太陽暦" : "現場歴") : pr.column; };

  /* ---- 表の形（集計表と同じ buildModel）。種類の段は並べ替え・上位 N を当てる ---- */
  function modelOf(p, d) {
    const b = p.body || {};
    const s = { sub: !!b.sub && p.visual === "none", grand: !!b.grand, chart: p.visual, chartAt: b.chartAt || 0, labels: (p.fmt || {}).labels ? (p.fmt.labels !== "none") : b.labels !== false, split: false, month: "" };
    const m = C.buildModel(d, s);
    return { m, s };
  }
  /** 行の葉を並べ替え（大きい順・小さい順）、入る数（fit）か上位 N（top）に切る → {m, rest}（rest＝描かなかった行の数） */
  function trimRows(m, p, fit) {
    // 小計のある表（版 3.40.0）は、グループの下に小計が来る並びのまま（並べ替え・上位で小計の行が後ろへ回らない）
    if (m.rows.some((r) => r.type === "sub")) return { m, rest: 0, total: m.rows.filter((r) => r.type === "data").length };
    const data = m.rows.filter((r) => r.type === "data"), other = m.rows.filter((r) => r.type !== "data");
    const j = Math.min((p.body || {}).chartAt || 0, Math.max(0, m.M - 1)), all = m.cols.find((c) => c.type === "all") || m.cols[m.cols.length - 1] || { type: "all", path: [] };
    const val = (r) => { const v = m.value(r, { type: "all", path: [] }, j); return v == null ? (m.value(r, all, j) || 0) : v; };
    let rows = data.slice();
    if (p.sort === "desc") rows.sort((a, b) => val(b) - val(a));
    else if (p.sort === "asc") rows.sort((a, b) => val(a) - val(b));
    const limit = Math.max(1, Math.min(p.top || Infinity, fit || Infinity));
    const rest = Math.max(0, rows.length - limit);
    rows = rows.slice(0, limit);
    return { m: { ...m, rows: rows.concat(other) }, rest, total: data.length };
  }

  /* ---- 値の見せ方（版 3.43.0。書式の配置・字。Excel のセルの書式の「配置」「フォント」に当たる） ----
     align: left・center・right（数字・表のセルの横の置き場）・valign: top・middle・bottom（数字の縦の置き場）・
     nsize: s・l・xl（字の大きさ。数字は入りきらなければ縮める）・bold: off（太字にしない）・ncolor: 字の色（表示形式の [赤] などが先） */
  const SIZE_RATE = { s: 0.75, l: 1.25, xl: 1.5 };
  function look(box, fm) {
    const f = fm || {};
    const set = (k, v) => { if (v) box.dataset[k] = v; else delete box.dataset[k]; };
    set("al", f.align); set("va", f.valign); set("nz", f.nsize); set("nb", f.bold === "off" ? "off" : "");
    if (f.ncolor) box.style.setProperty("--dp-nc", f.ncolor); else box.style.removeProperty("--dp-nc");
  }
  /** 数字の自動の単位（本・ロット・件）。表示形式に単位の字（"本" など）を入れたら、そちらに任せて出さない */
  const autoUnit = (p, m) => {
    const u = (p.fmt || {}).utext;
    if (u != null) return esc(u);          // 書式の「単位」で決めた字（版 3.45.0。空なら単位を出さない）
    if (!m || ((p.fmt || {}).num && WL.numFormat && WL.numFormat.hasLiteral(p.fmt.num))) return "";
    return m.agg === "lots" ? (WL.dashKit.src.isWork(p.source) ? "本" : "ロット") : m.agg === "count" ? "件" : "";
  };

  /** 数字の添え書き（期間・元）。lines 行で切る */
  /* 添え書き（sub）は字か {text, html}（dashboard.js の「元・設備・期間・条件」の項目・§9.628） */
  const subText = (s) => (typeof s === "string" ? s : s.text), subHtmlOf = (s) => (typeof s === "string" ? esc(s) : s.html);
  const metaHtml = (s, lines) => `<small class="dp-kmeta" title="${esc(subText(s))}" style="-webkit-line-clamp:${lines}">${subHtmlOf(s)}</small>`;
  /** 合わせたデータの「実績・基準・差」を1文で（「全設備 55分より 2分長い」。前は「基準：全設備 55分　差（実績−基準）+2分」が 1536 で切れた） */
  function baseSentence(ms, vals, fm) {
    const bi = ms.findIndex((m) => m.role === "base"), di = ms.findIndex((m) => m.role === "diff");
    if (bi < 0 || di < 0 || typeof vals[bi] !== "number" || typeof vals[di] !== "number") return "";
    const name = String(ms[bi].name || "").replace(/^[^：]*：/, ""), f = (j) => C.numText(Math.abs(vals[j]), C.measFmt(fm, ms[j]));   // 分の値は numText が「55分」と書く（measFmt の minutes）
    // 分は整数で見せるので、差も見せた数どうしの差（58分と 55分なら 3分。前は丸める前の差で「4分長い」と食い違った）
    const ai = ms.findIndex((m) => m.role === "actual"), min = ms[di].unit === "min";
    const d = min && ai >= 0 && typeof vals[ai] === "number" ? Math.round(vals[ai]) - Math.round(vals[bi]) : vals[di], word = d === 0 ? "同じ" : d > 0 ? (min ? "長い" : "多い") : (min ? "短い" : "少ない");
    const dt = min ? C.numText(Math.abs(d), C.measFmt(fm, ms[di])) : f(di);
    return `<span class="dp-kcmp">${esc(name)} ${esc(f(bi))}より${d === 0 ? "" : ` ${esc(dt)}`}${word}</span>`;
  }

  /* ---- 数字（kpi） ---- */
  /** @param {string|{text:string,html:string}} [sub0] */
  function kpi(box, p, d, W, H, sub0 = "") {
    const cell = (d.cells || []).find((x) => !x.r.length && !x.c.length);
    const vals = cell ? cell.v : [];
    const main = vals[0], ms = d.measures || [], fm = p.fmt || {};
    if ((fm.kpi === "bar" || fm.kpi === "gauge") && typeof main === "number" && fm.target) return kpiTarget(box, p, d, W, H, sub0, main);
    const fm0 = C.measFmt(fm, ms[0]);        // 値の桁（版 3.50.1）を重ねた書式
    const text = main == null ? "–" : C.numText(main, fm0);
    const unit = autoUnit(p, ms[0]);
    // 字の大きさ: 高さの 5 割・幅に収まる大きさ（数字 1 字 ≒ 0.6em・単位は 1 字 ≒ 0.34em〈字の 0.32 倍の大きさ〉）の小さい方。14〜88px
    // 低いパネル（1 段）は、数と添え書きを横に並べる（縦に積むと数が小さくなり、添え書きが下で切れる）
    const row = H < 96 && W >= 240;
    const room = row ? H : H - (sub0 ? 20 : 0);    // 添え書き（期間・元）の行の分
    const wide = row ? W * 0.55 : W - 8;   // 横に並べるときは、数に幅の 55% まで（残りは添え書き）
    const z = SIZE_RATE[fm.nsize] || 1;    // 書式の字の大きさ（版 3.43.0）。入りきらなければ下で縮める
    // 横並びは行送り（1.2）のぶん高さの 8 割まで（前は 0.92 で行の箱が面から 2px はみ出した）
    const size = Math.round(Math.max(14, Math.min(88 * z, room * (row ? 0.8 : vals.length > 1 ? 0.42 : 0.56) * z, wide / Math.max(2, text.length * 0.62 + unit.length * 0.36 + 0.2))));
    const sub = baseSentence(ms, vals, fm) || vals.slice(1, 4).map((v, i) => `<span><small>${esc(measName(ms[i + 1]))}</small><b>${C.numHtml(v, C.measFmt(fm, ms[i + 1]))}</b></span>`).join("");
    // 分の値（「1078分」「17時間58分」）の単位の字も、ほかの数字のパネルの単位（本・件）と同じ小さな字に（§9.628）
    const numH = main == null ? "–" : fm0.minutes ? esc(C.numText(main, fm0)).replace(/([^\d.,\s+-]+)/g, "<small>$1</small>") : C.numHtml(main, fm0);
    box.innerHTML = `<div class="dp-kpi${row ? " is-row" : ""}"><b class="dp-num" style="--dp-numfs:${size}px">${numH}<small>${unit}</small></b>`
      + (sub && !row && room > size + 40 ? `<div class="dp-ksub">${sub}</div>` : "")
      // 低いパネルの横並びでは、2 つ目からの値（合わせたデータの基準・差など）を添え書きの上の行に（§9.628 自設備の「全設備との差」）
      + (row && (sub || sub0) ? `<div class="dp-kside">${sub ? `<div class="dp-ksub is-row">${sub}</div>` : ""}${sub0 ? metaHtml(sub0, sub ? 1 : Math.max(1, Math.min(2, Math.floor(H / 16)))) : ""}</div>` : "")
      + (!row && sub0 ? metaHtml(sub0, Math.max(1, Math.min(2, Math.floor(H / 16)))) : "") + "</div>";
    // 描いた後に、いま居る面に収まるまで数を小さくする（測った時と面の大きさが違っても、はみ出さない）
    const num = box.querySelector(".dp-num"), limit = box.clientHeight || H;
    // 横に並べる形は、数そのものが収まるかだけを見る（添え書きは 2 行で切る。添え書きが長いと数が 14px まで縮んだ: 版 3.41.0）
    const over = row ? () => box.scrollHeight > limit + 1 || num.getBoundingClientRect().height > limit + 1 || num.offsetWidth > W * 0.62 : () => box.scrollHeight > limit + 1 || box.scrollWidth > box.clientWidth + 1;
    for (let f = size; f > 12 && over(); f -= 2) num.style.setProperty("--dp-numfs", `${f - 2}px`);
  }

  /** 数字の形（版 3.39.0。書式 kpi）: 目標に対する進み。bar＝数と、目標までの横の棒（達成率）・gauge＝半円のメーター（真ん中に数・下に達成率） */
  /** @param {string|{text:string,html:string}} sub0 */
  function kpiTarget(box, p, d, W, H, sub0, v) {
    const fm = p.fmt, t = fm.target, rate = v / t, col = seriesColors(p)[0], fill = Math.max(0, Math.min(1, rate));
    const unit = autoUnit(p, d.measures[0]);
    const rateText = `${Math.round(rate * 1000) / 10}%`, ok = rate >= 1;
    if (fm.kpi === "gauge") {
      const R = Math.max(24, Math.min(H - 34, W / 2 - 12)), cx = W / 2, cy = R + 6, a = Math.PI * (1 - fill);
      const pt = (ang, r) => `${(cx + r * Math.cos(ang)).toFixed(1)},${(cy - r * Math.sin(ang)).toFixed(1)}`, th = Math.max(8, R * 0.22);
      const arc = (from, to, c) => `<path d="M${pt(from, R)}A${R},${R} 0 0 1 ${pt(to, R)}" fill="none" stroke="${c}" stroke-width="${th}" stroke-linecap="butt"/>`;
      box.innerHTML = `<div class="dp-gauge"><svg viewBox="0 0 ${W} ${cy + 4}" width="${W}" height="${cy + 4}" role="img" aria-label="目標 ${esc(C.numText(t, fm))} に対して ${esc(rateText)}">`
        + arc(Math.PI, 0, "#e4e9ee") + (fill > 0 ? arc(Math.PI, a, col) : "")
        + `<text x="${cx}" y="${cy - R * 0.18}" text-anchor="middle" class="dp-gnum" style="font-size:${Math.round(Math.max(14, Math.min(54, R * 0.5)))}px">${esc(C.numText(v, fm))}<tspan class="dp-gunit">${unit}</tspan></text></svg>`
        + `<div class="dp-grate"><b class="${ok ? "is-ok" : ""}">${ok ? "✓ " : ""}達成 ${esc(rateText)}</b><small>目標 ${esc(C.numText(t, fm))}${unit}</small>${sub0 ? `<small class="dp-kmeta" title="${esc(subText(sub0))}">${subHtmlOf(sub0)}</small>` : ""}</div></div>`;
      return;
    }
    if (H < 90) {          // 低いパネル（1 段）: 数・棒・達成率を 1 行に（添え書きは札の題に）
      const sz = Math.round(Math.max(14, Math.min(40, H * 0.62)));
      box.innerHTML = `<div class="dp-kbar is-row" title="目標 ${esc(C.numText(t, fm))}${unit}${sub0 ? `　${esc(subText(sub0))}` : ""}"><b class="dp-num" style="font-size:${sz}px">${C.numHtml(v, fm)}<small>${unit}</small></b>`
        + `<div class="dp-track" role="img" aria-label="目標 ${esc(C.numText(t, fm))} に対して ${esc(rateText)}"><i style="width:${(fill * 100).toFixed(1)}%;background:${col}"></i></div>`
        + `<span class="dp-krate${ok ? " is-ok" : ""}">${ok ? "✓ " : ""}${esc(rateText)}<small>／${esc(C.numText(t, fm))}${unit}</small></span></div>`;
      return;
    }
    const size = Math.round(Math.max(14, Math.min(64, (H - 40) * 0.62, (W - 8) / Math.max(2, C.numText(v, fm).length * 0.62 + 1))));
    box.innerHTML = `<div class="dp-kbar"><div class="dp-krow"><b class="dp-num" style="--dp-numfs:${size}px">${C.numHtml(v, fm)}<small>${unit}</small></b><span class="dp-krate${ok ? " is-ok" : ""}">${ok ? "✓ " : ""}${esc(rateText)}</span></div>`
      + `<div class="dp-track" role="img" aria-label="目標 ${esc(C.numText(t, fm))} に対して ${esc(rateText)}"><i style="width:${(fill * 100).toFixed(1)}%;background:${col}"></i></div>`
      + `<small class="dp-kmeta">目標 ${esc(C.numText(t, fm))}${unit}${sub0 ? `　${subHtmlOf(sub0)}` : ""}</small></div>`;
  }

  /* ---- グラフ ---- */
  function fitCount(kind, W, H) {
    if (kind === "bar" || kind === "hstack" || kind === "hstack100") return Math.max(2, Math.floor((H - 28) / 17));     // 横の形: 1 行 17px（積み上げ横棒は下に目盛り）
    if (kind === "donut") return 10;
    if (kind === "box" || kind === "violin") return Math.max(2, Math.floor((W - 54) / 34));
    if (kind === "treemap") return 40;
    return Math.max(2, Math.floor((W - 54) / 26));     // 縦棒・パレート・積み上げ: 1 本 26px まで
  }
  function chart(box, p, d, W, H) {
    const { m: m0, s } = modelOf(p, d);
    if (!m0.rows.some((r) => r.type === "data")) { box.innerHTML = '<p class="dp-empty">当たる行がありません（条件・期間を見直してください）</p>'; return ""; }
    let m = m0, note = "";
    const kind = p.visual;
    if (CATEGORY.has(kind) || kind === "heat") {
      const fit = kind === "heat" ? Math.max(2, Math.floor((H - 30) / 12)) : fitCount(kind, W, H);
      const t = trimRows(m0, p, fit);
      m = t.m;
      if (t.rest) note = `${p.sort ? (p.sort === "desc" ? "大きい順" : "小さい順") + "に" : ""}${t.total - t.rest} / ${t.total} を描いています`;
    }
    // 凡例を描く高さ（列の段・値が 2 つ以上のときだけ。低いパネルでは出さない）
    const fm = p.fmt || {};
    const wantLegend = fm.legend !== "none" && (m.nc > 0 || d.measures.length > 1 || ["bubble", "diag45", "xbar", "violin", "waterfall"].includes(kind)) && H >= 150 && kind !== "donut" && kind !== "treemap";
    const gh = Math.max(60, H - (wantLegend ? 20 : 0));
    const colors = seriesColors(p), pal = PALETTES[fm.palette || ""];
    const r0 = (d.dims.rows || [])[0], few = m.nr === 1 && m.nc === 0 && r0 && !r0.column.startsWith("@") && !C.isTimeDim(r0) && m.rows.filter((r) => r.type === "data").length <= 8;
    // 1 つの値だけの棒（縦棒・横棒・ロリポップ）は 1 色（§9.628。前は 8 項目までだと項目ごとの色で、9 項目からは 1 色＝同じ図の色が項目の数で変わり、色に意味が無かった）。
    // 項目ごとの色は、全体の内訳を言う形（ドーナツ・ツリーマップ・バブル）か、色の組を選んだときだけ
    const rowColor = (few && !["column", "bar", "lollipop"].includes(kind)) || (pal && ["column", "bar", "lollipop", "donut", "treemap", "bubble"].includes(kind) && m.nc === 0)
      // 設備でない項目の内訳は紺の濃淡（色相は設備だけ・§9.628。前は色相の組で、用途名のドーナツが黄緑になった）。色の組を選べばその組
      ? catColors(m.rows.filter((r) => r.type === "data").map((r) => m.rowName(r)).sort(), pal ? pal.c : [NAVY].concat(SERIES_SHADES)) : null;
    // 別のデータを合わせた答え（版 3.40.0）: 色は役割の色（組む所の札と同じ: 目標＝紫・実績＝青緑）・目標と実績は同じ目盛り
    const link = !!d.link;
    const cols = link && !(fm.palette) ? d.measures.map((x, j) => ROLE_COLOR[x.role] || colors[j % colors.length]) : colors;
    const out = C.draw(kind, { m, d, s, W, H: gh, measName, dimName: (x) => dimName(x, p), label: (c) => c, compact: true, colors: cols, rowColor, fmt: withSeriesColors(fm, d, m), oneAxis: link });
    if (!p._facetColor) { drawn.set(p.id, new Map(out.used || [])); drawnSer.set(p.id, new Map(out.ser || [])); }
    const sideOk = out.side && (kind === "donut" ? W - (Math.min(gh / 2 - 6, W / 2 - 8, 160) * 2 + 16) >= 150 : W >= 760);
    const legend = wantLegend ? `<div class="dp-legend">${(out.legend || "").replace(/<small class="pv-cnote">[\s\S]*?<\/small>/g, "")}</div>` : "";
    const cls = `dp-chart${fm.grid === false ? " no-grid" : ""}${fm.size ? ` fs-${fm.size}` : ""}`;
    box.innerHTML = fm.legend === "bottom" ? `<div class="${cls}">${out.svg}${sideOk ? out.side : ""}</div>${legend}` : `${legend}<div class="${cls}">${out.svg}${sideOk ? out.side : ""}</div>`;
    return [note, out.note || ""].filter(Boolean).join("・");   // 形からの知らせ（ウォーターフォールの「計の棒は出しません」など）も下に
  }

  /* ---- 表（集計表と同じ表を、字と行の高さを詰めて収める） ---- */
  function table(box, p, d, W, H) {
    const { m: m0 } = modelOf(p, d);
    const t = trimRows(m0, p, Infinity);
    box.innerHTML = `<div class="dp-tbl"><table class="pv-table">${C.tableHtml(t.m, d, { measName, dimName: (x) => dimName(x, p), num: (v, j) => C.numHtml(v, C.measFmt(p.fmt, d.measures[j])) })}</table></div>`;
    return moreText(fitRows(box.querySelector(".dp-tbl"), H), "行");
  }
  /** 表を高さ H に収める: 字を 14 → 11px まで詰め、それでも入らなければ下の行を隠す → 隠した行の数 */
  function fitRows(wrap, H) {
    if (!wrap || !shrink(wrap, H)) return 0;
    const rows = [...wrap.querySelector("table").tBodies[0].rows];
    const keepLast = rows.length && rows[rows.length - 1].classList.contains("is-grand") ? 1 : 0;
    // 縦にまたがる見出し（小計のある表の上の段）は、隠した行の分だけまたがりを縮める（縮めないと下の行の字の列がずれた: 3 回目の採点の 1280 の小計の表）
    const spans = rows.flatMap((tr, r) => [...tr.cells].filter((c) => c.rowSpan > 1).map((c) => ({ c, r })));
    let hidden = 0;
    for (let i = rows.length - 1 - keepLast; i > 0 && wrap.scrollHeight > H + 1; i--) {
      rows[i].hidden = true; hidden++;
      spans.forEach((x) => { if (x.r < i && x.r + x.c.rowSpan > i) x.c.rowSpan -= 1; });
    }
    return hidden;
  }
  const moreText = (n, what) => (n ? `ほか ${n} ${what}（パネルを大きくすると出ます）` : "");

  /* ---- 合わせた表（visual board。版 3.38.0）。行の段（既定は設備）を共通にして、列のまとまり（それぞれほかのパネルと同じ組み方で数えた答え）を
     横に並べる。版 3.36.0 の「設備ごとの仕掛と前日の実績」は、この形の標準の組み（仕掛ロット数〈棒〉＋前日の直ごとの実績本数〈濃淡・計・0 本の印〉）。
     行の並び: 値の大きい順（どのまとまりの計で）・名前の順・設備の並び（作業実績の設備の並び）・手で並べる（list。隠す hide） ---- */
  const ago = (sec) => { if (!sec) return ""; const t = new Date(sec * 1000), z = WL.dashKit.pad2; return `${t.getMonth() + 1}/${t.getDate()} ${z(t.getHours())}:${z(t.getMinutes())}`; };
  const cellOf = (a, r, c) => ((a.cells || []).find((x) => x.r.length === r.length && x.c.length === c.length && x.r.every((k, i) => k === r[i]) && x.c.every((k, i) => k === c[i])) || {}).v;
  const unitOf = (g) => (g.measure.agg === "lots" ? (WL.dashKit.src.isWork(g.source) ? "本" : "ロット") : g.measure.agg === "count" ? "件" : "");
  const groupColor = (g) => g.color || colorOf(g.source);
  /** まとまりの題（空なら組み方から: 「前日 10/15 の実績本数（現場歴）」「仕掛のロット数」） */
  function groupTitle(g, a) {
    if (g.title) return g.title;
    const word = g.measure.agg === "lots" ? (WL.dashKit.src.isWork(g.source) ? "作業の数" : "ロット数") : measName(g.measure);
    const pr = a && a.period, r = pr && (pr.ranges || [])[0];
    if (pr && r) {
      const name = pr.kind === "days" ? `直近 ${pr.n} 日` : pr.kind === "range" ? "" : pr.name, span = r.from === r.to ? md(r.from) : `${md(r.from)}〜${md(r.to)}`;
      return `${name ? name + " " : ""}${span} の${word}${pr.column === "@workday" ? `（${g.basis === "cal" ? "太陽暦" : "現場歴"}）` : ""}`;
    }
    return `${(a && a.sourceName) || ""}${a && a.sourceName ? "の" : ""}${word}`;
  }
  /** 1 つのまとまりの答え → {rows: Map(行の鍵 → {label, v: [列ごとの値], total}), cols: [{key, label}], total, missing: Set, failed: Map, none} */
  function groupModel(g, a, rowDim) {
    const out = { rows: new Map(), cols: [], total: null, failed: new Map(), parts: null, none: 0, err: a && a.error ? a : null };
    if (!a || a.error) return out;
    const nc = (a.dims.cols || []).length, labels = a.labels || [], orders = a.orders || [];
    if (nc) {
      const leaves = (a.cells || []).filter((x) => x.r.length === 1 && x.c.length === nc).map((x) => JSON.stringify(x.c));
      const rank = (path) => path.map((k, i) => (orders[1 + i] || []).indexOf(k));
      out.cols = [...new Set(leaves)].map((j) => JSON.parse(j)).sort((x, y) => { const p = rank(x), q = rank(y); for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return p[i] - q[i]; return 0; })
        .map((path) => ({ path, label: path.map((k, i) => (labels[1 + i] || {})[k] ?? k).join("・") }));
      // 直の段: 勤務体系の直は、前日に作業が無くても列に並べる（勤務体系の順。直の外・時刻なしは後ろ）
      if (nc === 1 && a.dims.cols[0].column === "@shift" && (a.shifts || []).length) {
        const have = new Set(out.cols.map((c) => c.label)), at = (c) => { const i = a.shifts.indexOf(c.label); return i < 0 ? 1e6 + out.cols.indexOf(c) : i; };
        out.cols = out.cols.concat(a.shifts.filter((n) => !have.has(n)).map((n) => ({ path: ["\u0000" + n], label: n }))).sort((x, y) => at(x) - at(y));
        out.shiftsOf = new Map((a.parts || []).map((x) => [x.name, new Set(x.shifts || [])]));
      }
    }
    for (const k of orders[0] || []) {
      const label = (labels[0] || {})[k] ?? k;
      if (rowDim === "@equip" && k === "") { out.none = (cellOf(a, [k], []) || [0])[0] || 0; continue; }   // 設備の分からない行は表に出さず、数だけ言う
      out.rows.set(label, { v: out.cols.map((c) => (cellOf(a, [k], c.path) || [null])[0]), total: (cellOf(a, [k], []) || [null])[0] });
    }
    out.total = (cellOf(a, [], []) || [null])[0];
    // 列の段の値が 1 つだけなら段を畳む（§9.628 の採点: 凡例「● 予定」と「計」が棒と同じことを言った）。値は見出しの字で言う
    if (out.cols.length === 1 && !(nc === 1 && a.dims.cols[0].column === "@shift")) {
      out.only = { name: (a.dims.cols[0] || {}).name || (a.dims.cols[0] || {}).column || "", label: out.cols[0].label };
      out.cols = []; out.rows.forEach((r) => { r.v = []; });
    }
    (a.failed || []).concat(a.skipped || []).forEach((f) => out.failed.set(f.name, f.kind === "copying" ? "写しています…" : f.error));
    if (a.parts) out.parts = new Set(a.parts.map((x) => x.name));
    return out;
  }
  function boardOrder(p, keys, models, equipOrder) {
    const o = p.order || {}, by = o.by || "value", hide = new Set(o.hide || []);
    const name = (a, b) => a.localeCompare(b, "ja");
    const shown = keys.filter((k) => !hide.has(k));
    if (by === "name") return shown.sort(name);
    if (by === "equip" || by === "manual") {
      const list = by === "manual" ? (o.list || []) : (equipOrder || []), at = (k) => { const i = list.indexOf(k); return i < 0 ? Infinity : i; };
      return shown.sort((a, b) => at(a) - at(b) || name(a, b));
    }
    // 値の順: 決めた列 → 同じならほかの列を左から → 名前（前は同じ値の行の並びに見て分かる決まりが無かった・§9.628 の 8 回目の採点）
    const gi0 = Math.min(o.group || 0, models.length - 1), seq = [gi0, ...models.map((_, i) => i).filter((i) => i !== gi0)];
    const val = (gi, k) => { const r = models[gi] && models[gi].rows.get(k); return r && r.total != null ? r.total : 0; };
    const cmp = (a, b) => { for (const gi of seq) { const d = val(gi, b) - val(gi, a); if (d) return o.dir === "asc" ? -d : d; } return name(a, b); };
    return shown.sort(cmp);
  }
  const NONE_GROUP = "（グループなし）";
  /** 並べた行の鍵を設備グループ（order.tree。答えの d.tree）の見出しの下にまとめる → [{name, keys, none}]（まとめないなら 1 つ・name ""）。
      グループの並びは手で並べた順（order.glist）→ マスタの並び。グループに入らない行は最後の「グループなし」（版 3.41.0。利用者の要望 4） */
  function groupRows(p, flat, d) {
    const o = p.order || {}, tree = o.tree && d && d.tree;
    if (!tree) return [{ name: "", keys: flat }];
    const of = new Map();
    tree.forEach((g) => g.members.forEach((m) => { if (!of.has(m)) of.set(m, g.name); }));
    const gl = o.glist || [], at = (n) => { const i = gl.indexOf(n); return i < 0 ? Infinity : i; };
    const names = tree.map((g) => g.name).filter((n, i, a) => a.indexOf(n) === i && flat.some((k) => of.get(k) === n));
    names.sort((a, b) => at(a) - at(b) || names.indexOf(a) - names.indexOf(b));
    const out = names.map((n) => ({ name: n, keys: flat.filter((k) => of.get(k) === n) }));
    const rest = flat.filter((k) => !of.has(k));
    return rest.length ? out.concat([{ name: NONE_GROUP, keys: rest, none: true }]) : out;
  }
  /** 合わせた表の行の鍵（いまの並び。隠した行も入れる）をグループごとに → [{name, keys}]。組む所の行の札に使う */
  /** 行の鍵: 答えに出た行・読めなかった設備・数えた設備（設備の段なら、数の無い設備も 0 の行で並べる。前は数のある設備だけで、
      隣のガントの設備とそろわなかった・§9.628 の 7 回目の採点。数えた設備は答えの parts＝スライサー・まとまりの設備で絞った後） */
  const boardRowKeys = (models, rowDim) => [...new Set(models.flatMap((m) => [...m.rows.keys(), ...(rowDim === "@equip" ? [...m.failed.keys(), ...(m.parts || [])] : [])]))];
  function boardTree(p, d) {
    const gs = p.groups || [], rowDim = (p.rows || {}).column || "@equip";
    const models = gs.map((g, i) => groupModel(g, ((d && d.groups) || [])[i], rowDim));
    const keys = boardRowKeys(models, rowDim);
    return groupRows(p, boardOrder({ ...p, order: { ...(p.order || {}), hide: [] } }, keys, models, d && d.equipOrder), d);
  }
  /** 合わせた表の行の鍵（いまの並び。隠した行も入れる・グループの順） */
  const boardKeys = (p, d) => boardTree(p, d).flatMap((g) => g.keys);
  /** 信号（しきい値 limits: warn・alert・dir〈high＝大きいと悪い・low＝小さいと悪い〉）→ ok・warn・alert か ""（決めていない） */
  function levelOf(g, v) {
    const L = g.limits; if (!L || typeof v !== "number") return "";
    const bad = (x) => x != null && (L.dir === "low" ? v <= x : v >= x);
    return bad(L.alert) ? "alert" : bad(L.warn) ? "warn" : "ok";
  }
  const SIG = { ok: ["●", "よい"], warn: ["▲", "注意"], alert: ["✕", "要対応"] };
  // 列の段を 1 つの絵にまとめる見せ方（積み上げ帯・小さな線）は、列の段があっても 1 列（＋計）
  const ROWLOOK = new Set(["stack", "spark"]);
  /** 合わせた表を描く材料（まとまりごとの形・行の並び・0 の印・字の書き方）を 1 つにまとめる */
  function boardModel(p, d) {
    const gs = p.groups || [], rowDim = (p.rows || {}).column || "@equip";
    const models = gs.map((g, i) => groupModel(g, (d.groups || [])[i], rowDim));
    const keys = boardRowKeys(models, rowDim);
    const tree = groupRows(p, boardOrder(p, keys, models, d.equipOrder), d), order = tree.flatMap((g) => g.keys);
    // 0 の印: まとまりの計が 0（行が無い＝0）で、ほかのまとまりに数がある行
    const zeroOf = (gi, k) => { const r = models[gi].rows.get(k); return !(r && r.total) && models.some((m, j) => j !== gi && ((m.rows.get(k) || {}).total || 0) > 0); };
    const flags = gs.map((g, gi) => (g.zero && !models[gi].err ? order.filter((k) => zeroOf(gi, k) && !models[gi].failed.has(k) && !(models[gi].parts && !models[gi].parts.has(k))) : []));
    const folded = (gi) => ROWLOOK.has(gs[gi].look) && models[gi].cols.length > 0;
    const span = (gi) => (folded(gi) ? 1 + (gs[gi].total ? 1 : 0) : Math.max(1, models[gi].cols.length + (models[gi].cols.length && gs[gi].total ? 1 : 0)));
    // 字（題・見出し）と、セルの字（表示形式の色つき）。まとまりの値に桁を決めていれば、その桁（版 3.50.1）
    // 値はまとまりの答えの値（サーバーが単位〈分〉を添える）。答えが無ければ組んだ値
    const measOf = (g) => { const i = gs.indexOf(g), am = i >= 0 ? (((d.groups || [])[i] || {}).measures || [])[0] : null; return g ? { ...g.measure, ...(am && am.unit ? { unit: am.unit } : {}) } : null; };
    const fmtN = (n, g) => (n == null ? "–" : C.numText(n, C.measFmt(p.fmt, measOf(g)))), fmtH = (n, g) => C.numHtml(n, C.measFmt(p.fmt, measOf(g)));
    const unitWord = rowDim === "@equip" ? "設備" : "行";
    return { p, d, gs, rowDim, models, tree, order, flags, folded, span, fmtN, fmtH, unitWord, SEG: SERIES_SHADES, sameCond: new Set(gs.map(condOf)).size === 1 };
  }
  /** 1 つの数の札（見せ方ごと）。mx … その段の最大・base … 割合の分母 */
  function boardVal(B, g, v, mx, base) {
    const n = v || 0, fmtH = B.fmtH;
    if (g.look === "heat" && n) return `<span style="--h:${(0.1 + 0.35 * n / mx).toFixed(2)}">${fmtH(n, g)}</span>`;
    if (g.look === "bar" && n) return `<span class="dash-mini"><i style="width:${(n / mx * 100).toFixed(1)}%"></i></span>${fmtH(n, g)}`;
    if (g.look === "dot") return `<span class="dash-dotl"><i style="left:${(n / mx * 100).toFixed(1)}%"></i></span>${fmtH(n, g)}`;
    if (g.look === "share") return base ? `<span title="${esc(B.fmtN(n, g))}">${(Math.round(n / base * 1000) / 10).toFixed(1)}%</span>` : "–";
    if (g.look === "signal") { const lv = levelOf(g, n); return lv ? `<span class="dash-sig is-${lv}" title="${SIG[lv][1]}">${SIG[lv][0]}</span>${fmtH(n, g)}` : fmtH(n, g); }
    return fmtH(n, g);
  }
  const maxOf = (vals) => Math.max(1, ...vals.filter((v) => typeof v === "number"));
  /** 列の段を持たないまとまりのセル（1 つの数） */
  function boardSingle(B, g, gi, r, col, grp) {
    const totals = [...B.models[gi].rows.values()].map((x) => x.total), v = r ? r.total : 0;
    if (g.look === "bar" || g.look === "stack") {
      // 数の席の幅は、その列でいちばん大きい数の字を測って決める（決め打ちの 3.6em に「,」が入らず「4,800分」がはみ出した・§9.628）
      const mx = maxOf(totals), vw = Math.max(3.6, C.textW(B.fmtN(mx, g), 10, 700) / 10 + 0.3).toFixed(2);
      return `<td class="dash-lots${grp}" style="--gc:${col};--vw:${vw}em"><div><span class="dash-bar"><i style="width:${((v || 0) / mx * 100).toFixed(1)}%"></i></span><b>${v ? B.fmtH(v, g) : C.ADDITIVE.has(((g.measure || {}).agg) || "lots") ? B.fmtH(0, g) : "–"}</b></div></td>`;   // 数える物の無い行は 0（隣の列と同じ言い方・§9.628）
    }
    const sum = totals.reduce((a, x) => a + (x || 0), 0);
    return `<td class="num dash-s${grp}${v ? "" : " is-zero"} dash-l-${g.look}" style="--gc:${col}">${boardVal(B, g, v, maxOf(totals), sum)}</td>`;
  }
  /** 列の段を 1 つの絵にまとめたセル（積み上げ帯・小さな線） */
  function boardFolded(B, g, gi, r, col, grp) {
    const m = B.models[gi], vs = m.cols.map((c, ci) => (r ? r.v[ci] || 0 : 0));
    if (g.look === "stack") {
      const mx = maxOf([...m.rows.values()].map((x) => x.total));
      const segs = vs.map((v, ci) => (v ? `<i style="width:${(v / mx * 100).toFixed(2)}%;background:${B.SEG[ci % B.SEG.length]}" title="${esc(m.cols[ci].label)} ${esc(B.fmtN(v, g))}"></i>` : "")).join("");
      return `<td class="dash-stk${grp}"><span class="dash-stack">${segs}</span></td>`;
    }
    const mx = maxOf(vs), w = 120, h = 20, step = vs.length > 1 ? w / (vs.length - 1) : 0;
    const pts = vs.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / mx) * (h - 4)).toFixed(1)}`).join(" ");
    return `<td class="dash-spk${grp}"><svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(m.cols.map((c, i) => `${c.label} ${B.fmtN(vs[i], g)}`).join("・"))}"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.8"/><circle cx="${((vs.length - 1) * step).toFixed(1)}" cy="${(h - 2 - (vs[vs.length - 1] / mx) * (h - 4)).toFixed(1)}" r="2.4" fill="${col}"/></svg></td>`;
  }
  /** 1 つの行の、1 つのまとまりのセル */
  function boardCells(B, g, gi, k) {
    const m = B.models[gi], r = m.rows.get(k), col = groupColor(g), grp = gi ? " dash-grp" : "", d = B.d;
    if (m.err) return `<td class="dash-ng${grp}" colspan="${B.span(gi)}">${gi === 0 || k === B.order[0] ? esc(m.err.error) : ""}</td>`;
    if (m.failed.has(k)) return `<td class="dash-ng${grp}" colspan="${B.span(gi)}">${esc(m.failed.get(k))}</td>`;
    if (!r && m.parts && !m.parts.has(k)) return `<td class="dash-na${grp}" colspan="${B.span(gi)}">${esc((d.groups[gi] || {}).sourceName || "")}の${B.unitWord}にありません</td>`;
    if (!m.cols.length) return boardSingle(B, g, gi, r, col, grp);
    const t = r ? r.total || 0 : 0;
    const sumCell = g.total ? `<td class="num dash-sum">${B.fmtH(t, g)}${B.flags[gi].includes(k) ? `<em class="dash-flag" title="ほかのまとまりに数があるのに、${esc(groupTitle(g, d.groups[gi]))}が 0 でした">0 ${unitOf(g)}</em>` : ""}</td>` : "";
    if (B.folded(gi)) return boardFolded(B, g, gi, r, col, grp) + sumCell;
    const mx = maxOf([...m.rows.values()].flatMap((x) => x.v));
    const cells = m.cols.map((c, ci) => {
      const v = r ? r.v[ci] : 0, gl = ci ? "" : grp;
      const own = m.shiftsOf && m.shiftsOf.get(k);
      if (own && own.size && !own.has(c.label) && (d.groups[gi].shifts || []).includes(c.label)) return `<td class="num dash-s is-na${gl}" title="この設備の勤務体系に無い直">–</td>`;
      const n = v || 0;
      return `<td class="num dash-s${gl}${n ? "" : " is-zero"} dash-l-${g.look}" style="--gc:${col}">${boardVal(B, g, n, mx, t)}</td>`;
    }).join("");
    return cells + sumCell;
  }
  /** 見出しの 2 段（まとまりの題と計／列の段） */
  /** まとまりの条件は、そのまとまりの見出しの中に（§9.628。前は表の上の右寄せの1行に「作業予定・条件 1」とまとめ、どの列の何の条件か読めなかった） */
  // パネル共通に条件があるのに、このまとまりに条件が無ければ「条件 なし」と言い切る（共通の条件で数えたと読ませない）
  // どのまとまりも同じ条件なら、見出しには書かない（パネルの添え書きか「このダッシュボードの前提」が 1 回で言う。同じ字を見出しごとにくり返さない）
  const condOf = (g) => (g.filters || []).map((f) => WL.dashKit.condLabel(f).replace(/\s+/g, " ").trim()).join("・");
  const gcond = (g, common, same) => { const t = same ? "" : condOf(g) || (common && common.cond ? "条件 なし" : "");
    return t ? `<small class="dash-gcond" title="このまとまりの条件">${esc(t)}</small>` : ""; };
  /** 並べている列の印（値の順のとき・その列の見出しの題の後ろに ▼ 大きい順／▲ 小さい順） */
  const sortMark = (p, gi) => { const o = p.order || {}; if ((o.by || "value") !== "value" || Math.min(o.group || 0, (p.groups || []).length - 1) !== gi) return "";
    const asc = o.dir === "asc"; return ` <span class="dash-sortk" title="${asc ? "小さい" : "大きい"}順に並べています（同じなら隣の列、それも同じなら名前の順）">${asc ? "▲" : "▼"}</span>`; };
  function boardHead(B) {
    const { gs, models, d, rowDim } = B;
    const head1 = gs.map((g, gi) => {
      const m = models[gi], a = (d.groups || [])[gi] || {}, cls = gi ? "dash-grp" : "";
      const tip = [a.sourceName, ...(a.mirrors || []).slice(0, 1).map((x) => x && x.at ? `元 ${ago(x.at)}` : ""), m.none ? `${rowDim === "@equip" ? "設備なし" : "空欄"} ${C.fmt(m.none)}` : ""].filter(Boolean).join("・");
      return `<th class="${cls}${m.cols.length ? "" : (g.look === "bar" || g.look === "stack" ? " dash-lots" : " num")}" colspan="${B.span(gi)}"${m.cols.length ? "" : ' rowspan="2"'} title="${esc(tip)}">${esc(groupTitle(g, a))}${sortMark(B.p, gi)}${B.p.noTotal ? "" : `<small>計 ${m.total == null ? "–" : B.fmtN(m.total, g)}${unitOf(g) ? ` ${unitOf(g)}` : ""}</small>`}${gcond(g, B.common, B.sameCond)}${m.only ? `<small class="dash-gcond" title="列の分け方の値が 1 つだけなので、段を畳みました">${esc(WL.dashKit.condLabel({ column: m.only.name, op: "eq", value: m.only.label }))}</small>` : ""}</th>`;
    }).join("");
    const head2 = gs.map((g, gi) => {
      const m = models[gi];
      if (!m.cols.length) return "";
      const sum = g.total ? '<th class="num dash-sum">計</th>' : "";
      if (B.folded(gi)) return `<th class="dash-key${gi ? " dash-grp" : ""}">${g.look === "stack" ? m.cols.map((c, ci) => `<span><i style="background:${B.SEG[ci % B.SEG.length]}"></i>${esc(c.label)}</span>`).join("") : `${esc(m.cols[0].label)} → ${esc(m.cols[m.cols.length - 1].label)}`}</th>${sum}`;
      return m.cols.map((c, ci) => `<th class="num dash-s${ci || !gi ? "" : " dash-grp"}">${esc(c.label)}</th>`).join("") + sum;
    }).join("");
    const rowName = rowDim === "@equip" ? "設備" : dimName(B.p.rows || { column: rowDim }, B.p);
    return `<thead><tr><th rowspan="2">${esc(rowName)}</th>${head1}</tr><tr>${head2}</tr></thead>`;
  }
  /** 表の上の帯（0 の知らせだけ。元はパネルの添え書き・条件はまとまりの見出し・写しの時刻と設備なしの数は見出しの説明が持つ） */
  function boardTop(B) {
    const { gs, d } = B;
    const warn = gs.map((g, gi) => (B.flags[gi].length ? `<span class="dash-warn" title="ほかのまとまりに数があるのに、${esc(groupTitle(g, d.groups[gi]))}が 0 だった${B.unitWord}"><b>${esc(groupTitle(g, d.groups[gi]).replace(/ .*$/, ""))} 0 ${unitOf(g)}</b>${B.flags[gi].map(esc).join("・")}</span>` : "")).join("");
    return `${warn ? `<div class="dash-boardhead">${warn}</div>` : ""}<div class="dp-flow"></div>`;
  }
  /** 合わせた表を描く（d = {groups: [答え], equipOrder}）→ 下に出す知らせの字 */
  /** @param {{cond?: string}} [common] 道具の行の「このダッシュボードの前提」（条件が共通にあれば、条件の無いまとまりに「条件 なし」と書く） */
  function board(box, p, d, H, common = {}) {
    look(box, p.fmt);
    if (!d) { box.innerHTML = '<p class="dp-wait">数えています…</p>'; return ""; }
    const B = { ...boardModel(p, d), common }, gs = B.gs;
    const allCols = 1 + gs.reduce((n, g, gi) => n + B.span(gi), 0);
    // 設備グループの見出しの行（版 3.41.0）: グループの名前と台数。行の頭は字下げ（どのグループの設備か、形で分かる）
    const rowList = B.tree.flatMap((t) => (t.name ? [`<tr class="dash-gtr${t.none ? " is-none" : ""}"><th colspan="${allCols}" scope="rowgroup"><span>${esc(t.name)}</span><small>${t.keys.length} 台</small></th></tr>`] : [])
      .concat(t.keys.map((k) => `<tr${t.name ? ' class="dash-gin"' : ""}><th scope="row">${esc(k)}</th>${gs.map((g, gi) => boardCells(B, g, gi, k)).join("")}</tr>`)));
    const thead = boardHead(B);
    box.innerHTML = boardTop(B);
    const head = box.querySelector(".dash-boardhead"), flow = box.querySelector(".dp-flow"), avail = H - (head ? head.offsetHeight + 4 : 0);
    flow.style.maxHeight = avail + "px";
    if (!rowList.length) { flow.innerHTML = `<table class="dash-table">${thead}<tbody><tr><td colspan="${allCols}" class="dp-empty">当たる行がありません。</td></tr></tbody></table>`; return ""; }
    return boardFlow(box, flow, rowList, thead, avail, B.unitWord);
  }
  /** 入らなければ、字を詰める → 行を 2〜3 つの列に分けて横に並べる（幅が足りるとき）→ 下の行を隠す の順（2026-10-grid の 2 回目。どの行も見えるように）。
      幅が足りなければ、列の幅 → 字と余白を詰める（fitWidth。右の列が切れない） */
  function boardFlow(box, flow, rowList, thead, avail, unitWord) {
    const W = box.clientWidth;
    // 列に分けた続きがグループの途中から始まるなら、そのグループの見出しを「（続き）」で頭に置く
    const headAt = (j) => { for (let x = j; x >= 0; x--) if (rowList[x].startsWith('<tr class="dash-gtr')) return rowList[x].replace("</span>", "（続き）</span>"); return ""; };
    for (let k = 1; k <= 3; k++) {
      if (k > 1 && W / k < 470) break;
      const per = Math.ceil(rowList.length / k);
      flow.style.setProperty("--k", k);
      flow.innerHTML = Array.from({ length: k }, (_, i) => { const a = i * per, cont = a > 0 && rowList[a] && rowList[a].startsWith('<tr class="dash-gin"') ? headAt(a) : "";
        return `<div class="dp-tbl"><table class="dash-table">${thead}<tbody>${cont}${rowList.slice(a, (i + 1) * per).join("")}</tbody></table></div>`; }).join("");
      fitWidth(flow);
      if (!shrink(flow, avail)) { fitWidth(flow); return ""; }
    }
    fitWidth(flow);
    return moreText([...flow.querySelectorAll(".dp-tbl")].reduce((a, t) => a + fitRows(t, avail), 0), unitWord);
  }
  /** 表の幅がパネルに入らなければ、詰める段（is-narrow → is-narrower）を 1 つずつ当てる */
  function fitWidth(flow) {
    const over = () => [...flow.querySelectorAll(".dp-tbl")].some((t) => t.scrollWidth > t.clientWidth + 1);
    flow.classList.remove("is-narrow", "is-narrower");
    if (!over()) return;
    flow.classList.add("is-narrow");
    if (over()) flow.classList.add("is-narrower");
  }
  /** 字を 14 → 11px まで詰めて高さに入るか試す → 入らなければ true（詰めた最後のまま） */
  /** 表を高さ H に合わせる: 入る中でいちばん大きな字（15 → 11px）にし、まだ下が空けば行の上下の余白で埋める（縦長のパネルの下が空かない）。
      11px でも入らなければ true（呼んだ所が列に分ける・行を隠す） */
  function shrink(wrap, H) {
    const tbs = [...wrap.querySelectorAll("table")];
    const set = (fs, pv) => tbs.forEach((tb) => { tb.style.setProperty("--dp-fs", fs + "px"); tb.style.setProperty("--dp-pad", `${pv}px ${fs >= 13 ? 8 : 6}px`); });
    for (const fs of [15, 14, 13, 12, 11.5, 11]) {
      const pv = fs >= 14 ? 5 : fs >= 13 ? 4 : fs >= 12 ? 3 : 2;
      set(fs, pv);
      if (wrap.scrollHeight > H + 1) continue;
      const rows = Math.max(...tbs.map((tb) => tb.rows.length)), spare = H - wrap.scrollHeight;
      if (spare > rows * 2) { set(fs, pv + Math.min(9, Math.floor(spare / rows / 2))); if (wrap.scrollHeight > H + 1) set(fs, pv); }
      return false;
    }
    return true;
  }

  /* ---- 設備ごとに並べる（版 3.40.0。esplit facet）: 設備ごとの答え（d.facets）を、同じ形の小さな表・グラフ・数字にして格子に並べる。
     格子の列の数は、パネルの縦横の比に合う数（小さな図がなるべく正方形に近い）。入らない設備は「ほか n 設備」 ---- */
  function facets(box, p, d, W, H) {
    const fs = d.facets || [];
    if (!fs.length) { box.innerHTML = '<p class="dp-empty">当たる設備がありません（設備・条件・期間を見直してください）</p>'; return ""; }
    const kpiLike = p.visual === "kpi", minW = kpiLike ? 120 : 200, minH = kpiLike ? 64 : 120;
    let best = null;
    for (let cols = 1; cols <= fs.length; cols++) {
      const rows = Math.ceil(fs.length / cols), w = (W - (cols - 1) * 8) / cols, h = (H - (rows - 1) * 8) / rows;
      const fit = Math.min(fs.length, Math.max(1, Math.floor(W / (minW + 8))) * Math.max(1, Math.floor(H / (minH + 8))));
      const score = (w >= minW && h >= minH ? 1e6 : 0) - Math.abs(Math.log((w / h) / (kpiLike ? 2.2 : 1.4)));
      if (!best || score > best.score) best = { cols, rows, w, h, score, fit };
    }
    const shown = best.w >= minW && best.h >= minH ? fs : fs.slice(0, best.fit);
    const cols = shown === fs ? best.cols : Math.max(1, Math.floor(W / (minW + 8))), rows = Math.ceil(shown.length / cols);
    const cw = (W - (cols - 1) * 8) / cols, ch = (H - (rows - 1) * 8) / rows;
    box.innerHTML = `<div class="dp-facets" style="--fc:${cols}">${shown.map((f, i) => `<section class="dp-facet" data-i="${i}"><h4 title="${esc(f.name)}">${esc(f.name)}</h4><div class="dp-fbox"></div></section>`).join("")}</div>`;
    // 縦軸は全部の小さな図で同じ（設備どうしを高さで比べられる。2026-10-dashlink の採点）。色は重ねるときのその設備の色
    const fm0 = p.fmt || {}, j = Math.min((p.body || {}).chartAt || 0, ((d.measures || []).length || 1) - 1);
    const leafMax = (a) => { const nr = a.dims.rows.length, nc = a.dims.cols.length; return Math.max(0, ...a.cells.filter((c) => c.r.length === nr && c.c.length === (nc && ["time", "stack", "stack100", "hstack", "hstack100", "stackarea"].includes(p.visual) ? 0 : nc)).map((c) => +c.v[j] || 0)); };
    const top = Math.max(...shown.map((f) => leafMax(f.answer)));
    const pal = PALETTES[fm0.palette || ""], base = (n) => (fm0.colors || {})[n] || equipColor(n, pal ? pal.c : EQUIP_COLORS);
    const one = (f) => ({ ...p, esplit: "", _facetColor: base(f.name), fmt: { ...fm0, legend: fm0.legend || (kpiLike ? "none" : ""), ...(fm0.ymax == null && top > 0 && !kpiLike && p.visual !== "none" ? { ymax: top } : {}) } });
    box.querySelectorAll(".dp-facet").forEach((sec, i) => {
      sec.style.setProperty("--fc0", base(shown[i].name));
      render(sec.querySelector(".dp-fbox"), one(shown[i]), shown[i].answer, { w: cw - 2, h: ch - 22 });
    });
    return fs.length > shown.length ? `ほか ${fs.length - shown.length} 設備（パネルを大きくすると出ます）` : "";
  }

  /** パネルの中身を描く（sub: 数字の形の下に出す添え書き〈期間・元〉）→ 下に出す知らせの字（描かなかった行など） */
  /** 値の計算（版 3.45.0。要望 3: 書式の「計算」＝ 値÷1000・値×100 など）。答えの数（cells の v）を式で置き換えた写し。
      設備ごとに並べる形は、設備ごとの答えに当てる。同じ写しに 2 度当てない（並べる形は 1 枚ずつ render を通る） */
  const CALCD = Symbol("calcd");
  function calcd(p, d) {
    const fn = WL.numFormat && (p.fmt || {}).expr ? WL.numFormat.expr(p.fmt.expr).fn : null;
    if (!fn || !d || d[CALCD] || d.equips) return d;
    const one = (a) => (a && a.cells ? { ...a, cells: a.cells.map((c) => ({ ...c, v: c.v.map((x) => (typeof x === "number" ? fn(x) : x)) })), [CALCD]: true } : a);
    return d.facets ? { ...d, facets: d.facets.map((f) => ({ ...f, answer: one(f.answer) })), [CALCD]: true } : one(d);
  }
  /** パネルのスライサー（版 3.52.0。visual slicer。2026-10-dslicer の G）: 行の段 1 つ目の値ごとに、件数と量の棒を持つ札を縦に 1 列で並べる。
      札はパネルの高さに広げ（28〜56px）、入らなければ幅がある時だけ 2 列、それでも入らなければ中で送る。
      押した値（p._picked）は濃い地。押すと dashboard.js が選びを覚え、同じデータのほかのパネル（p._hits 枚）を絞る */
  function slicer(box, p, d, W, H) {
    const lab = (d.labels || [])[0] || {}, cnt = new Map((d.cells || []).filter((c) => c.r.length === 1).map((c) => [c.r[0], c.v[0]]));
    const items = ((d.orders || [])[0] || []).map((k) => ({ value: k === "" ? "" : k[0] === "$" ? k.slice(1) : String(lab[k] ?? k), label: k === "" ? "（空欄）" : String(lab[k] ?? k), n: +cnt.get(k) || 0 })).sort((a, b) => Number(a.value === "") - Number(b.value === "") || b.n - a.n || a.label.localeCompare(b.label, "ja", { numeric: true }));   // 多い順（自分の選びでは数が変わらないので、押しても並びが動かない）
    if (!items.length) { box.innerHTML = '<p class="dp-empty">値がありません（データ・条件を見直してください）</p>'; return ""; }
    const picked = new Set(p._picked || []), max = Math.max(1, ...items.map((x) => x.n)), fm = (v) => C.fmt(v);
    const room = H - 26 - (p._hits != null ? 22 : 0), gap = 6;
    let cols = 1, h = Math.floor((room - gap * (items.length - 1)) / items.length);
    if (h < 28 && W >= 420) { cols = 2; h = Math.floor((room - gap * (Math.ceil(items.length / 2) - 1)) / Math.ceil(items.length / 2)); }
    h = Math.max(28, Math.min(56, h));
    const head = `<div class="dsp-head"><span>${picked.size ? `<b>${picked.size}</b> / ${items.length} を選んでいます` : `すべて（${items.length}）`}</span>`
      + (picked.size ? '<button type="button" class="dsp-clear" data-db-spclear title="選びを外して、すべてに戻します">× 選びを外す</button>' : "") + "</div>";
    const cards = items.map((x) => { const on = picked.has(x.value);
      return `<button type="button" class="dsp-v${on ? " on" : ""}${picked.size && !on ? " is-out" : ""}" data-db-spv="${esc(x.value)}" aria-pressed="${on}" title="${esc(x.label)}: ${esc(fm(x.n))}（押すと選ぶ・もう一度で外す）">`
        + `<span class="dsp-l">${esc(x.label)}</span><span class="dsp-n">${esc(fm(x.n))}</span><i style="width:${Math.round(x.n / max * 100)}%" aria-hidden="true"></i></button>`; }).join("");
    const foot = p._hits != null ? `<div class="dsp-foot">${p._hits ? `同じデータ（${esc(p._srcName || "")}）の ${p._hits} 枚のパネルに効きます` : "同じデータのパネルがありません（効く先がありません）"}</div>` : "";
    box.innerHTML = `<div class="dsp-wrap">${head}<div class="dsp-list" style="--sp-cols:${cols};--sp-h:${h}px" role="group" aria-label="値で絞る">${cards}</div>${foot}</div>`;
    return "";
  }
  /** @param {string|{text:string,html:string}} [sub] 数字のパネルの添え書き（字か、dashboard.js の項目の {text, html}） */
  function render(box, p, d, size, sub = "") {
    d = calcd(p, d);
    const W = Math.max(60, Math.floor(size.w)), H = Math.max(40, Math.floor(size.h));
    look(box, p.fmt);
    if (p.visual === "gantt" || p.visual === "abc" || p.visual === "now") return d.kind === p.visual ? WL.dashOps[p.visual](box, p, d, W, H) : "";   // 稼働・ABC 分析（版 3.46.0）・いまの作業（§9.630。dashboard-ops.js）
    if (d.facets) return facets(box, p, d, W, H);
    if (p.visual === "slicer") return slicer(box, p, d, W, H);
    if (p.visual === "kpi") { kpi(box, p, d, W, H, sub); return ""; }
    if (p.visual === "none") return table(box, p, d, W, H);
    return chart(box, p, d, W, H);
  }

  /** パネルの知らせ（読めなかった設備・効かない条件・ロット数の注意）。見出しの ⚠ の札に出す（中身の上に被せない） */
  function notes(d) {
    const out = [];
    const all = [...(d.failed || []), ...(d.skipped || [])], bad = all.filter((x) => x.kind !== "copying"), wait = all.filter((x) => x.kind === "copying");
    // 入れた直後など、共有から写している最中の設備は「読めない」ではなく待ち（写し終えると数に入る。画面は 4 秒ごとに引き直す。版 3.46.0）
    if (wait.length) out.push(`写しています（写し終えると数に入ります）: ${wait.map((x) => x.name).join("・")}`);
    if (bad.length) out.push(`読めない設備: ${bad.map((x) => x.name).join("・")}`);
    if ((d.ignoredFilters || []).length) out.push(`効かない条件（表に無い列）: ${d.ignoredFilters.join("・")}`);
    if (d.equipIgnored) out.push("このデータは設備を見分けられないので、設備の選び・まとめは効きません（データ元で設備の列を決めてください）");
    if (d.note) out.push(d.note);
    return out;
  }

  WL.dashPanels = { basisOf, setEquipOrder: (fn) => { equipOrder = fn; }, equipColor, ROLE_COLOR, render, calcd, autoUnit, board, notes, periodText, measName, dimName, md, colorOf, kindOf, groupTitle, unitOf, boardKeys, boardTree, NONE_GROUP, SOURCE_COLOR, PALETTES, seriesColors, drawnColor: (id, name) => (drawn.get(id) || new Map()).get(name),
    drawnSeries: (id, name) => (drawnSer.get(id) || new Map()).get(name) || null };
})();
