/* =========================================================================
   ダッシュボードのパネルを組む所（版 3.37.0。グリッドは dashboard.js・描き方は dashboard-panels.js）
   集計表・グラフ（lotlist-pivot.js）と同じ組み方: 左にカラムの札（行・列・値）、右に文「［行］ごとに、［列］別の［値］を出す」と形。
   変えるたびに、グリッドの中のそのパネルがすぐ描き直る（パネルの大きさのまま。プレビューを別に持たない）。
   ほかに: データ（データ元・作業実績の設備・作業日の数え方）・条件（一覧と同じ形）・期間（今日・前日・直近 n 日・今月・先月）・
   並べ方（大きい順・小さい順）と上位いくつ・題
   合わせた表（版 3.38.0。visual board）: 上の札で「表全体」（行の段・行の並び・隠す行）と「列のまとまり」（1〜4）を切り替える。
   まとまりは、ふつうのパネルと同じ部品（カラムの札・文・データ・条件・期間）で組み（行の段は表全体で 1 つ・値は 1 つ）、見せ方（棒・濃淡・数・色・
   計の列・0 の印）を選ぶ。組む物（target）は、ふつうのパネルならパネル、合わせた表ならまとまりを写した形（groupView）で、変えるたびに書き戻す
   版 3.39.0（利用者の要望 2026-10）: 値の統計（中央値・標準偏差・p%点・Cpk など）と表し方（割合・累計・差・順位）・設備を複数選ぶ・設備をまとめる
   （選んだ設備の合算・このパネルのグループ・設備グループのマスタ）・見せ方（枠 5 つ・数字の形 3 つ・合わせた表 8 つ）・書式（数値ラベル・日付の形・
   字の向き・桁・単位・縦軸・凡例・補助線・字の大きさ・基準線・色の組・系列の色）・計算列をここで作る・形は目的ごとに並べる
   版 3.40.0（利用者の要望 2026-10）:
   - 設備の出し方（esplit・egroup）: 系列に分ける（設備ごとの系列）・図を並べる（設備ごとの小さな表・グラフ）・合算して 1 つ・グループ合算。
     設備は行・列にも置ける（「行に置く」「列に置く」）。設備グループの段（@egroup）と表の小計
   - 別のデータを合わせる（link）: 上の札で「全体」（軸のそろえ方・役割・作り方・差と達成率）と「データ」（1〜4）を切り替える。
     データ（側）は、合わせた表のまとまりと同じ部品で組む（行の段＝軸 1 つ・値 1 つ）
   ========================================================================= */
(function(){
  "use strict";
  const { $, $$, esc } = WL.dashKit;
  const C = WL.pivotCharts, P = WL.dashPanels, N = WL.numFormat;
  const MAX_DIMS = 3, MAX_MEASURES = 6, MAX_GROUPS = 4, MAX_GROUP_COLS = 2;
  const Q = WL.dashFilter, DND = WL.pivotDnd;   // 札を引いて組み替える（版 3.50.0。pivot-dnd.js）
  const DATE_PARTS = ["date", "ym", "year", "month", "weekday", "hour", ""], NUM_PARTS = ["", "bin"], WORKDAY_PARTS = ["", "ym", "year"];
  const PART_NAME = { "": "値のまま", date: "年月日", ym: "年月", year: "年", month: "月", weekday: "曜日", hour: "時", bin: "区間" };
  const WORKDAY_NAME = { "": "日", ym: "年月", year: "年" };
  const EXTRA = [{ k: "kpi", n: "数字", tip: "値の総計を大きな数で出します（行の段は要りません）", icon: "M4 15V5l-2 2M8 6a2 2 0 1 1 4 0c0 2-4 4-4 9h4M14 5h4l-3 4a3 3 0 1 1-2 5" },
    { k: "none", n: "表", tip: "集計表（行・列・値）を、パネルの大きさに詰めて出します", icon: "M3 4h14v12H3zM3 8h14M3 12h14M8 4v12" },
    { k: "board", n: "合わせた表", tip: "行（設備など）をそろえて、いくつかのデータの数を横に並べた 1 枚の表（設備ごとの仕掛と前日の実績など）", icon: "M3 4h14v12H3zM3 8h14M7 4v12M12 4v12" },
    // パネルのスライサー（版 3.52.0。利用者の要望 2026-10-23 の 2）: 行の段 1 つ目の値の札。押した値で同じデータのほかのパネルを絞る
    { k: "slicer", n: "スライサー", tip: "行の段 1 つ目（仕掛区分・品種など）の値の札を並べ、押した値で同じデータのほかのパネルを絞ります（選びはこの PC の見え方）", icon: "M3 4h14M3 9h14M3 14h9M6 2v4M13 7v4M9 12v4" }];
  // 稼働を見る形（版 3.46.0。利用者の要望 2026-10-21 の 1・2。作業実績の作業開始・作業終了から: services/operation.py・dashboard-ops.js）
  const OPS_VIS = [{ k: "gantt", n: "稼働（ガント）", tip: "選んだ設備の作業を 1 枚のガントチャートに並べ、設備ごとの稼働率（勤務時間に対する稼働の割合）を出します", icon: "M3 5h7M6 9h9M3 13h5M10 13h6M3 17h14" },
    { k: "abc", n: "ABC 分析", tip: "設備ごとに、品種を量の大きい順に並べて A・B・C に分け、作業時間から換算係数を出します", icon: "M3 17h14M4 15V4M8 15V8M12 15v-4M16 15v-2M4 5c3-1 8 0 12 6" }];
  const isOps = (x) => !!x && (x.visual === "gantt" || x.visual === "abc");
  // ABC 分析の表示項目（版 3.48.0。サーバーの dashboard.ABC_ITEMS と同じ鍵）。チェックを外すと出さない（ops.hide）
  // 版 3.49.0: 表の列の順（本数 → 平均 → 占有時間 → 本数比 → 負荷比 → 累積 → ABC → 換算係数 → 換算本数）に並べ、占有時間・負荷比を足した
  const ABC_ITEMS = [["avg", "平均作業"], ["occ", "占有時間", "本数 × 平均作業（工場をその品種が占める時間の見積もり）"], ["share", "本数比"],
    ["lshare", "負荷比", "占有時間の構成比（本数比と比べると、手間のかかる品種が分かる）"], ["cum", "累積"], ["rank", "ABC", "ABC の札・棒の色・A と B の線・下の段の品種の数"],
    ["factor", "換算係数"], ["conv", "換算本数"], ["chart", "パレート図"], ["foot", "下の段", "ABC の品種の数・占有時間の計・基準・換算本数の計・区間なし"]];
  const PERIODS = [["", "期間で絞らない"], ["today", "今日"], ["yesterday", "前日"], ["days", "直近 n 日（今日を含む）"], ["this_month", "今月"], ["last_month", "先月"], ["range", "日付で決める（から〜まで）"]];
  /** 期間の言葉（直近 n 日・日付で決めた 10/1〜10/15・今月 など） */
  const mdOf = (s) => { const m = /^\d{4}-(\d{2})-(\d{2})/.exec(s || ""); return m ? `${+m[1]}/${+m[2]}` : ""; };
  const perName = (pr) => (!pr || !pr.kind ? "" : pr.kind === "days" ? `直近 ${pr.n || 7} 日` : pr.kind === "range" ? [mdOf(pr.from), mdOf(pr.to)].filter((v, i, a) => v && a.indexOf(v) === i).join("〜") || "日付で決める"
    : (PERIODS.find((k) => k[0] === pr.kind) || [null, ""])[1]);
  /** 今日から back 日前の日（YYYY-MM-DD。この PC の日付）。日付で決めるを選んだときの最初の値 */
  const isoBack = (back) => { const d = new Date(Date.now() - back * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  /** 期間の欄（種類・日の数・日付で決める から〜まで）。attr … data-de-<attr>kind・<attr>n・<attr>from・<attr>to。list … 種類の選び */
  const periodCtl = (pr, attr, list, label) => {
    const kind = (pr && pr.kind) || "";
    return `<select data-de-${attr}kind aria-label="${label}">${list.map(([k, n]) => `<option value="${k}"${k === kind ? " selected" : ""}>${n}</option>`).join("")}</select>`
      + (kind === "days" ? `<input type="number" min="1" max="3660" data-de-${attr}n value="${pr.n || 7}" aria-label="日の数" class="de-n">日` : "")
      + (kind === "range" ? `<input type="date" data-de-${attr}from value="${esc(pr.from || "")}" aria-label="${label}のはじめ" class="de-date">〜<input type="date" data-de-${attr}to value="${esc(pr.to || "")}" aria-label="${label}のおわり" class="de-date">` : "");
  };
  /** 種類を選び直したときの期間（日付で決めるは直近 30 日から始める） */
  const periodOf = (old, kind, column) => (!kind ? null : { column, kind, n: (old && old.n) || 7,
    ...(kind === "range" ? { from: (old && old.from) || isoBack(29), to: (old && old.to) || isoBack(0) } : {}) });
  // 合わせた表の見せ方（版 3.39.0 で 3 → 8）。cols … 列の段があるときだけ意味のある物
  const LOOKS = [["bar", "棒と数", "棒の長さと数"], ["heat", "数と濃淡", "数の大きさを地の濃さで"], ["num", "数だけ", "数だけを並べる"],
    ["stack", "積み上げ帯", "列の段（直など）の内訳を 1 本の帯に積む", true], ["share", "割合", "行の計に対する割合（%）"], ["dot", "点と数", "線の上の点の位置で大きさ"],
    ["signal", "信号", "しきい値で ●よい・▲注意・✕要対応"], ["spark", "小さな線", "列の段（日など）の移りを 1 本の線で", true]];
  // パネルの見せ方（枠）・数字の形
  const FRAMES = [["card", "標準", "白い面"], ["emph", "目立たせる", "縁を濃く（最初に見る数に）"], ["accent", "色の帯", "左に系列の色の帯"], ["plain", "枠なし", "地に溶け込む（補う数に）"], ["tint", "淡い地", "系列の色をごく淡く敷く"]];
  const KPI_LOOKS = [["num", "数", "大きな数だけ"], ["bar", "目標までの棒", "目標に対する達成率を棒で"], ["gauge", "メーター", "目標に対する達成率を半円で"]];
  // 書式の選び（サーバーの dashboard.clean_fmt と同じ鍵）
  const LABELS = [["", "自動"], ["none", "なし"], ["top", "上"], ["inside", "棒の中"], ["both", "両方"]];
  // 線・面の形（棒の無い形）の数値ラベルは、付けるか付けないかだけ（「棒の中」「両方」は線では効かず、迷わせた: 版 3.41.0）
  const LINE_VIS = new Set(["line", "area"]);
  const LINE_LABELS = [["", "自動"], ["none", "なし"], ["top", "付ける"]];
  // 系列ごとの数値ラベル・線（版 3.41.0）。"" はパネルの「数値」に従う
  const SER_LABELS = [["", "パネルに従う"], ["top", "上"], ["below", "下"], ["off", "出さない"]];
  const SER_DASH = [["", "実線"], ["1", "破線"]];
  // 系列ごとの形と軸（版 3.46.0。要望 3: グラフ同士を組み合わせる）。推移を見る形（時系列・折れ線・面）と「組み合わせ」で効く
  const SER_KINDS = [["", "自動"], ["bar", "棒"], ["line", "線"], ["area", "面"]], SER_AXES = [["", "自動"], ["left", "左"], ["right", "右"]];
  /** 系列の形の印（色 → SVG）。組む所の系列の名前の行に出す */
  const SER_ICON = {
    bar: (c) => `<svg class="de-sico" viewBox="0 0 14 12" aria-hidden="true"><rect x="1" y="4" width="3" height="8" fill="${c}"/><rect x="6" y="1" width="3" height="11" fill="${c}"/><rect x="11" y="6" width="2" height="6" fill="${c}"/></svg>`,
    line: (c) => `<svg class="de-sico" viewBox="0 0 14 12" aria-hidden="true"><path d="M1 10l4-5 3 3 5-6" fill="none" stroke="${c}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/></svg>`,
    area: (c) => `<svg class="de-sico" viewBox="0 0 14 12" aria-hidden="true"><path d="M1 12V9l4-5 3 3 5-6v11z" fill="${c}"/></svg>`,
  };
  const COMBO_VIS = new Set(["combo", "time", "line", "area"]);
  const XDATES = [["", "自動（10/2）"], ["md", "10/2"], ["mdw", "10/2(金)"], ["d", "2（日だけ）"], ["dw", "2(金)"], ["ymd", "2026/10/2"], ["w", "金（曜日）"]];
  const XROTS = [["", "自動"], ["0", "横"], ["45", "45°"], ["90", "縦"]];
  const UNITS = [["", "自動（万・億）"], ["none", "そのまま"], ["k", "千"], ["man", "万"], ["m", "百万"], ["oku", "億"]];
  // 表示形式（版 3.43.0。Excel のセルの書式設定と同じ書式コード。static/js/num-format.js）で割る単位（自動〈万・億〉は無い: コードが字を決める）
  const DIVS = [["", "割らない"], ["k", "千"], ["man", "万"], ["m", "百万"], ["oku", "億"]];
  const ALIGNS = [["left", "左"], ["center", "中央"], ["right", "右"]], VALIGNS = [["top", "上"], ["middle", "中央"], ["bottom", "下"]];
  const NSIZES = [["s", "小"], ["", "中"], ["l", "大"], ["xl", "特大"]];
  // ユーザー定義の例（よく使う形。押すとコードに入る）
  const CODE_EXAMPLES = ['#,##0"本"', "#,##0.0", "0.0%", '#,##0;[赤]"▲"#,##0', '[>=1000]#,##0,"千";0', '#,##0" kg"', '0.00E+00', 'G/標準"件"'];
  const LEGENDS = [["", "自動"], ["none", "出さない"], ["top", "上"], ["bottom", "下"]];
  const SIZES = [["s", "小"], ["", "中"], ["l", "大"]];
  const REF_COLORS = ["#c9564a", "#b5822a", "#2f7d78", "#3f6591", "#5a6f77"];
  // まとまりの色（"" はデータの種類の色＝仕掛は藍・作業実績は青緑・品質データは琥珀。ほかは区分の色と同じ並び）
  const GROUP_COLORS = ["", "#7658ae", "#5c8a2a", "#8a5f18", "#5a6f77", "#8e4f76"];
  let host = null, p = null, t = null, gi = -1, sources = [], fields = null, fieldsKey = "", fieldsErr = "", q = "", ctx = { formulas: {}, names: {} }, formOpen = false;
  let eoAll = null, eoKey = "";      // 並べる設備（期間・条件によらないその元のすべての設備。版 3.48.0）
  let eqOpen = false, eqItems = null, eqKey = "", calcEdit = null, fmtOpen = true, numTimer = 0;

  const isBoard = () => p && p.visual === "board";
  const isLink = () => !!(p && p.link && (p.link.sides || []).length);
  /** 札で切り替えて組む物（合わせた表のまとまり・合わせるデータ） */
  const parts = () => (isLink() ? p.link.sides : isBoard() ? p.groups : null);
  const inGroup = () => !!parts() && gi >= 0;
  const inSide = () => isLink() && gi >= 0;
  const ROLES = [["target", "目標", "計画・目標の数（45度線管理図では横）"], ["actual", "実績", "実際の数（45度線管理図では縦）"], ["base", "基準", "比べる基準の数（全設備の平均など）。差は 実績−基準"], ["", "比べる", "目標・実績ではなく並べて比べる"]];
  const ROLE_COLOR = P.ROLE_COLOR;             // 役割の色（グラフの系列と同じ。dashboard-panels.js）
  const BUILDS = [["as", "そのまま", "軸の値ごとの数"], ["cum", "積み上げ", "軸の並び（日なら古い順）に足していく累計"]];
  /** 合わせた表のまとまり → 組む形（ふつうのパネルと同じ形。行の段は表全体の物・値は 1 つ） */
  function groupView(g) {
    return { visual: "none", source: g.source, equip: g.equip || "", equips: g.equips || [], filters: g.filters || [], search: g.search || "", period: g.period || null, basis: g.basis || "work",
      ...(g.calc ? { calc: g.calc } : {}), body: { rows: isLink() ? (g.key ? [g.key] : []) : [p.rows], cols: isLink() ? [] : g.cols || [], measures: [g.measure || { agg: "lots" }], grand: true } };
  }
  /** 組んだ形 → まとまり（合わせるデータなら軸と値）へ書き戻す */
  function pushGroup() {
    if (!inGroup()) return;
    const g = parts()[gi];
    Object.assign(g, { source: t.source, equip: t.equip, filters: t.filters, search: t.search, period: t.period, basis: t.basis, measure: t.body.measures[0] || { agg: "lots" } });
    if (isLink()) g.key = t.body.rows[0] || null; else g.cols = t.body.cols;
    if ((t.equips || []).length) g.equips = t.equips; else delete g.equips;
    if (t.calc) g.calc = t.calc; else delete g.calc;
    delete p.legacy;              // 組み直した表は、前の版の条件を引き継がない
  }
  function select(i) {
    gi = parts() ? Math.max(-1, Math.min(i, parts().length - 1)) : -1;
    t = inGroup() ? groupView(parts()[gi]) : p;
    q = ""; eqOpen = false; eqItems = null; eqKey = "";
    paint(); if (t !== p || !parts()) loadFields();
  }

  /* ---- 計算列（一覧の表示列で式から作った列）。この PC の一覧の列の設定（WL.columnLayout・対象 list:<キー>:<表>）の式を集める。
     パネルには使う計算列の式だけを写す（共通のダッシュボードをほかの PC で開いても同じ数） */
  function listTarget() {
    const src = String(t.source || ""), role = src.startsWith("role:") ? WL.dashKit.src.roles[src.slice(5)] || "" : src;
    return role.startsWith("src:") && fields && fields.table ? `list:${role.slice(4)}:${fields.table}` : "";
  }
  function calcContext() {
    const target = listTarget(), had = t.calc || { formulas: {}, names: {} };
    const mine = target ? { formulas: WL.columnLayout.formulas(target), names: { ...(WL.columnLayout.get(target).names || {}) } } : { formulas: {}, names: {} };
    // 組み直すと、この PC の一覧の今の式になる。この PC に無い計算列（ほかの人が組んだ物）は、パネルに写してある式のまま。
    // パネルで作った計算列（own）は、いつもパネルの式（一覧の同じ名前の式より先）
    const own = ownOf(had);
    return { formulas: { ...had.formulas, ...mine.formulas, ...own }, names: { ...had.names, ...mine.names }, own: Object.keys(own) };
  }
  const isCalc = (c) => !!(fieldOf(c) || {}).calc;
  const MAX_CLS = 4;
  /** 品種の列の並び（ops.cls は 1 つなら字・組み合わせなら並び） */
  const clsOf = (x) => [].concat((x.ops || {}).cls || []).filter(Boolean);
  /** 色分け・品種に選べる列: 日付でなく、数の列なら種類が少ない物（板厚の区分の数など。60 種類まで） */
  // 日時の列（年月日時分秒の 14 桁は数の列に見える）は除く
  const pickable = (f) => !f.date && !/年月日|日時|時分秒|時刻/.test(f.column) && (!f.numeric || (f.kinds >= 1 && f.kinds <= 60));
  /** 品種の列を決める（1 つなら字で持つ: 前の版と同じ形） */
  function setCls(cls, repaint = false) {
    const o = { ...(p.ops || {}) }, xs = [...new Set(cls)].slice(0, MAX_CLS);
    if (!xs.length) delete o.cls; else o.cls = xs.length === 1 ? xs[0] : xs;
    if (o.base && o.base !== "avg" && o.base !== "top") delete o.base;      // 品種の鍵が替わるので、品種で決めた換算の基準は外す
    p.ops = o; changed(repaint);
  }
  /** パネルで作った計算列 → {名前: 式} */
  const ownOf = (c) => Object.fromEntries(((c && c.own) || []).filter((n) => c.formulas && c.formulas[n]).map((n) => [n, c.formulas[n]]));
  /** 組む物が使う計算列の式（＋その式が [名前] で読む式の列を 1 段。サーバーは画面の baseRow と同じ引き方で計算する）→ 無ければ null */
  function calcOf(x) {
    // 稼働を見る形（ガント・ABC）の列（色分け・棒の字・作業終了・品種・量の数の列）も入れる（版 3.47.0。利用者の要望 2026-10-21 の 2 回目の 2:
    // 前は入れておらず、計算列〈追加した列〉で色分けしても式がサーバーへ届かず、色が付かなかった）
    const o = x.ops || {}, opsCols = [o.color, o.label, o.start, o.end, o.qty, ...[].concat(o.cls || [])].filter(Boolean);
    const b = x.body || {}, used = new Set([...(b.rows || []), ...(b.cols || [])].map((d) => d.column)
      .concat((b.measures || []).map((m) => m.column || ""), (x.filters || []).map((f) => f.column), [x.period ? x.period.column : ""], opsCols));
    const byName = Object.fromEntries(Object.entries(ctx.names).map(([c, n]) => [n, c]));
    const formulas = {};
    // パネルで作った計算列は、使っていなくても持つ（カラムの札に残す）
    (ctx.own || []).forEach((n) => { if (ctx.formulas[n]) used.add(n); });
    [...used].filter((c) => c && (isCalc(c) || (ctx.own || []).includes(c)) && ctx.formulas[c]).forEach((c) => {
      formulas[c] = ctx.formulas[c];
      const chk = WL.formula.check(ctx.formulas[c]);
      ((chk && chk.ok && chk.columns) || []).map((n) => byName[n] || n).forEach((n) => { if (ctx.formulas[n] && !(n in formulas)) formulas[n] = ctx.formulas[n]; });
    });
    const own = (ctx.own || []).filter((n) => formulas[n]);
    return Object.keys(formulas).length ? { formulas, names: ctx.names, ...(own.length ? { own } : {}) } : null;
  }
  /** 使う計算列の式を組む物に写す（使わなくなったら外す） */
  function syncCalc() { if (t === p && parts()) return; const c = calcOf(t); if (c) t.calc = c; else delete t.calc; }

  const srcOf = (k) => WL.dashKit.src.of(k);
  const isWork = () => WL.dashKit.src.isWork(t.source);
  const special = () => (fields && fields.special) || [];
  const fieldOf = (c) => ((fields && fields.fields) || []).find((f) => f.column === c) || null;
  const isDate = (c) => (c === "@workday") || !!(fieldOf(c) || {}).date;
  const isNum = (c) => !!(fieldOf(c) || {}).numeric;
  /** 設備グループの段のまとめ方（マスタのまとめ方の名前・このパネルのグループ） */
  const egSets = () => ((special().find((x) => x.column === "@egroup") || {}).sets || []).concat(p.egroup && p.egroup.mode === "panel" ? ["@panel"] : []);
  function partsOf(c) {
    if (c === "@workday") return WORKDAY_PARTS;
    if (c === "@egroup") return egSets().length ? egSets() : [""];
    if (c.startsWith("@")) return [""];
    if (isDate(c)) return DATE_PARTS;
    if (isNum(c)) return NUM_PARTS;
    return [""];
  }
  function defaultPart(c) {
    if (c === "@egroup") return egSets()[0] || "";
    if (c.startsWith("@")) return "";
    if (isDate(c)) return "date";
    const f = fieldOf(c);
    return f && f.numeric && (f.many || f.kinds > 30) ? "bin" : "";
  }
  const dimLabel = (d) => (d.column === "@equip" ? "設備" : d.column === "@egroup" ? "設備グループ" : d.column === "@workday" ? "作業日" : d.column === "@shift" ? "直" : d.column);

  /** 題が空のときの名前（組み方から作る。パネルの見出しにも同じ物） */
  function autoTitle(x) {
    if (x.link && (x.link.sides || []).length) {
      const ss = x.link.sides, role = (r) => (ROLES.find((y) => y[0] === r) || [null, ""])[1];
      return `${ss[0].key ? dimLabel(ss[0].key) + "ごとの" : ""}${ss.map((y) => (y.role ? role(y.role) : y.title || (srcOf(y.source) || {}).name || "データ")).join("と")}`;
    }
    if (x.visual === "gantt") return `${x.period && x.period.kind ? `${perName(x.period)}の` : ""}設備の稼働と稼働率`;
    if (x.visual === "abc") { const c = [].concat((x.ops || {}).cls || []); return `${c.length ? `${c.join(" × ")}の` : "品種の"}ABC 分析と換算係数`; }
    if (x.visual === "slicer") return `${((x.body || {}).rows || []).length ? dimLabel(x.body.rows[0]) : "列の値"}で絞る`;
    if (x.visual === "board") return (x.groups || []).length ? `${dimLabel(x.rows || { column: "@equip" })}ごとの${x.groups.map((g) => g.title || P.groupTitle(g, null)).join("と")}` : "合わせた表";
    const b = x.body || {}, ms = (b.measures || []).map(P.measName).join("・") || "ロット数";
    const pr = x.period && x.period.kind ? `${perName(x.period)}の` : "";
    const src = (srcOf(x.source) || {}).name || "";
    if (!(b.rows || []).length) return `${pr}${src ? src + "の" : ""}${ms}`;
    return `${pr}${b.rows.map(dimLabel).join("・")}ごとの${(b.cols || []).length ? b.cols.map(dimLabel).join("・") + "別の" : ""}${ms}`;
  }

  /* ---- 変える（変えるたびに host.onChange でグリッドのパネルを描き直す） ---- */
  function changed(repaintFields = true) {
    syncCalc(); pushGroup(); host.onChange(WL.dashKit.clone(p)); paint(repaintFields);
    const sm = $("#deNumSample"); if (sm) sm.innerHTML = numSample(p.fmt || {});   // 打っている欄があって書式の欄を描き直さないときも、見本は今の書式で
    syncUnit();
    const sum = $("#dashEditor .de-fmthead small"); if (sum) sum.innerHTML = fmtSummary(p.fmt || {});   // 見出しの要約も（作った後の採点: 後ろに「本」を入れても要約が変わらなかった）
  }
  function addDim(role, col) {
    const b = t.body, other = role === "rows" ? "cols" : "rows", max = inGroup() ? MAX_GROUP_COLS : MAX_DIMS;
    if (inSide()) {                                                  // 合わせるデータの軸は 1 つ（押した物に替える）。列の段は無い
      if (role !== "rows") return;
      b.rows = b.rows.some((d) => d.column === col) ? [] : [{ column: col, part: defaultPart(col) }];
      changed(); return;
    }
    if (inGroup() && role === "rows") return;                        // 行の段は表全体で 1 つ（「表全体」で決める）
    if (b[role].some((d) => d.column === col)) { b[role] = b[role].filter((d) => d.column !== col); changed(); return; }
    if (b[role].length >= max) { host.toast(`${role === "rows" ? "行" : "列"}の段は ${max} つまでです`); return; }
    if (!inGroup()) b[other] = b[other].filter((d) => d.column !== col);
    b[role] = b[role].concat([{ column: col, part: defaultPart(col) }]);
    if (t.visual === "kpi" && role === "rows") t.visual = C.isTimeDim(b.rows[0]) ? "time" : "column";   // 行を入れたら数字はグラフに
    changed();
  }
  function addMeasure(m) {
    const ms = t.body.measures, same = (x) => x.agg === m.agg && (x.column || "") === (m.column || "");
    if (inGroup()) { t.body.measures = [m]; changed(); return; }          // まとまりの値は 1 つ（押した物に替える）
    if (ms.some(same)) { t.body.measures = ms.filter((x) => !same(x)); if (!t.body.measures.length) t.body.measures = [{ agg: "lots" }]; changed(); return; }
    if (ms.length >= MAX_MEASURES) { host.toast(`値は ${MAX_MEASURES} つまでです`); return; }
    t.body.measures = ms.concat([m]); changed();
  }
  function setVisual(k) {
    if (k === "board") { if (isLink()) unlink(); toBoard(); return; }
    if (isBoard()) fromBoard();
    if (k === "gantt" || k === "abc") {           // 稼働を見る形: 作業実績（作業開始と作業終了）で数える。ガントは期間が要る（無ければ前日）
      if (isLink()) unlink();
      p.visual = k; p.ops = p.ops || {};
      if (!WL.dashKit.src.isWork(p.source)) { p.source = WL.dashKit.src.DEFAULT; delete p.equip; delete p.calc; p.filters = []; p.search = ""; host.toast("稼働は作業の記録から数えるので、データを測定データにしました"); }
      if (k === "gantt" && !(p.period && p.period.kind)) p.period = { column: "@workday", kind: "yesterday", n: 7 };
      delete p.egroup; delete p.esplit;
      changed(); return;
    }
    p.visual = k;
    const b = p.body;
    if (isLink()) { b.grand = k === "none" || k === "kpi"; changed(false); return; }    // 行・値は合わせるデータの軸と値
    if (k === "slicer") { b.cols = []; b.rows = b.rows.slice(0, 1); }          // スライサーは行の段 1 つ（その列の値の札）
    if (k !== "kpi" && k !== "none" && !b.rows.length) {   // 行の段が要る形: 向く段を 1 つ入れる（作業実績は作業日・ほかは設備か種類の少ない列。スライサーは種類の少ない列を先に）
      const sp = special().map((x) => x.column);
      const few = ((fields && fields.fields) || []).filter((f) => !f.numeric && !f.date && f.kinds >= 2 && f.kinds <= 30).sort((a, c) => a.kinds - c.kinds)[0]?.column;
      const pick = k === "slicer" ? few || (sp.includes("@equip") ? "@equip" : "") : (k === "time" || k === "line" || k === "area" || k === "stackarea" || k === "control" || k === "xbar") ? (sp.includes("@workday") ? "@workday" : ((fields && fields.fields) || []).find((f) => f.date)?.column)
        : sp.includes("@equip") ? "@equip" : ((fields && fields.fields) || []).filter((f) => !f.numeric && !f.date && f.kinds >= 2 && f.kinds <= 30).sort((a, c) => a.kinds - c.kinds)[0]?.column;
      if (pick) { b.rows = [{ column: pick, part: defaultPart(pick) }]; host.toast(`この形には行の段が要るので「${dimLabel(b.rows[0])}」を入れました`); }
    }
    // 値の数のカラムが要る形（箱ひげ・バイオリン・X̄-R は 1 つ、散布図・45度線は 2 つ、バブルは 3 つ）: 足りなければ数のカラムの平均を入れて知らせる
    const need = { box: 1, violin: 1, xbar: 1, scatter: 2, diag45: 2, bubble: 3 }[k] || 0;
    const have = b.measures.filter((m) => m.column && isNum(m.column));
    if (have.length < need) {
      const nums = ((fields && fields.fields) || []).filter((f) => f.numeric && !f.error).map((f) => f.column).filter((c) => !have.some((m) => m.column === c));
      const add = nums.slice(0, need - have.length).map((c) => ({ agg: "avg", column: c }));
      if (add.length) { b.measures = have.concat(add).slice(0, MAX_MEASURES); host.toast(`この形には数の値が ${need} つ要るので「${add.map(P.measName).join("」「")}」を入れました（値の札で替えられます）`); }
      else host.toast(`この形には数のカラムの値が ${need} つ要ります`);
    }
    b.grand = k === "none" || k === "kpi";
    changed();
  }
  /** ふつうのパネル → 合わせた表（いまの組みを 1 つ目のまとまりに。行の段は設備） */
  function toBoard() {
    if (isBoard()) return;
    const b = p.body || {};
    const g = { title: "", source: p.source, equip: p.equip || "", filters: p.filters || [], search: p.search || "", period: p.period || null, basis: p.basis || "work",
      ...(p.calc ? { calc: p.calc } : {}), measure: (b.measures || [])[0] || { agg: "lots" }, cols: (b.cols || []).slice(0, MAX_GROUP_COLS), look: "num", total: true, zero: false, color: "" };
    ["source", "equip", "filters", "search", "period", "basis", "calc", "body", "sort", "top"].forEach((k) => delete p[k]);
    Object.assign(p, { visual: "board", rows: { column: "@equip", part: "" }, groups: [g], order: { by: "value", group: 0, dir: "desc", list: [], hide: [] } });
    host.toast("合わせた表にしました。行は設備です（「表全体」で変えられます）");
    gi = 0; t = groupView(p.groups[0]); changed(); loadFields();
  }
  /** 合わせた表 → ふつうのパネル（1 つ目のまとまりの組みで） */
  function fromBoard() {
    const g = p.groups[0] || { source: WL.dashKit.src.DEFAULT, measure: { agg: "lots" }, cols: [] };
    Object.assign(p, { source: g.source, equip: g.equip || "", filters: g.filters || [], search: g.search || "", period: g.period || null, basis: g.basis || "work",
      ...(g.calc ? { calc: g.calc } : {}), body: { rows: [p.rows || { column: "@equip", part: "" }], cols: g.cols || [], measures: [g.measure], grand: false, labels: true, chartAt: 0 }, sort: "desc", top: 0 });
    ["rows", "groups", "order", "legacy"].forEach((k) => delete p[k]);
    gi = -1; t = p;
  }
  async function setSource(key, equip = "") {
    if (key === t.source && equip === t.equip) return;
    const keepPeriod = t.period && t.period.column === "@workday" && WL.dashKit.src.isWork(key);
    Object.assign(t, { source: key, equip, equips: [], filters: [], search: "", period: keepPeriod ? t.period : null });
    eoAll = null; delete p.eorder;          // 設備の並びは元ごと（ほかの元の設備の名前は持ち越さない）
    if (!inGroup()) delete p.egroup;
    eqOpen = false;
    t.body = { ...t.body, rows: inGroup() && !inSide() ? t.body.rows : [], cols: [], measures: [{ agg: "lots" }] };
    if (!inGroup() && p.visual !== "kpi" && p.visual !== "none") p.visual = "kpi";
    await loadFields();
    if (inSide()) t.body.rows = [sideKey()];
    changed();
  }

  /* ---- 別のデータを合わせる（版 3.40.0。link）: 全体（軸のそろえ方・役割・作り方・差と達成率）とデータ（1〜4） ---- */
  /** このデータの軸の既定: ほかのデータの軸と同じ種類（日・設備）があればそれ、無ければ作業日・設備・日付の列 */
  function sideKey() {
    const other = (p.link.sides.find((x, i) => i !== gi && x.key) || {}).key, sp = special().map((x) => x.column), dates = ((fields && fields.fields) || []).filter((f) => f.date).map((f) => f.column);
    const day = other && (other.column === "@workday" ? !other.part : other.part === "date");
    if (other && other.column === "@equip" && sp.includes("@equip")) return { column: "@equip", part: "" };
    if (day || !other) { if (sp.includes("@workday")) return { column: "@workday", part: "" }; if (dates[0]) return { column: dates[0], part: "date" }; }
    if (other && (fieldOf(other.column) || sp.includes(other.column))) return { ...other };
    return sp.includes("@equip") ? { column: "@equip", part: "" } : dates[0] ? { column: dates[0], part: "date" } : null;
  }
  /** いまの組みを 1 つ目のデータ（目標）にして、2 つ目（実績。作業実績）を足す */
  function startLink() {
    const b = p.body || {}, key = (b.rows || [])[0] || (special().some((x) => x.column === "@workday") ? { column: "@workday", part: "" } : { column: "@equip", part: "" });
    const first = { title: "", role: "target", build: "as", source: p.source, equip: p.equip || "", equips: p.equips || [], filters: p.filters || [], search: p.search || "",
      period: p.period || null, basis: p.basis || "work", ...(p.calc ? { calc: p.calc } : {}), key, measure: (b.measures || [])[0] || { agg: "lots" } };
    p.link = { sides: [first, { ...WL.dashKit.clone(first), role: "actual", source: WL.dashKit.src.DEFAULT, equip: "", equips: [], filters: [], search: "", calc: undefined, measure: { agg: "lots" } }] };
    delete p.link.sides[1].calc; delete p.egroup; delete p.esplit;
    if (!["diag45", "time", "line", "area", "column", "bar", "none", "scatter"].includes(p.visual)) p.visual = "diag45";
    host.toast("① 目標・② 実績 にしました（上の札で切り替えて決めます）");
    gi = 1; t = groupView(p.link.sides[1]); fields = null; fieldsKey = "";
    loadFields().then(function(){ if (!t.body.rows.length) { t.body.rows = [sideKey()].filter(Boolean); } changed(); });
  }
  /** 合わせるのをやめる（1 つ目のデータの組みで、ふつうのパネルに戻す） */
  function unlink() {
    const x = p.link.sides[0];
    Object.assign(p, { source: x.source, equip: x.equip || "", equips: x.equips || [], filters: x.filters || [], search: x.search || "", period: x.period || null, basis: x.basis || "work",
      ...(x.calc ? { calc: x.calc } : {}), body: { ...(p.body || {}), rows: x.key ? [x.key] : [], cols: [], measures: [x.measure || { agg: "lots" }] } });
    delete p.link; gi = -1; t = p;
  }
  /** ① の頭の 2 択（数える物: 1 つのデータ／別のデータと合わせる）。合わせた後も同じ所に残す（押すと 1 つに戻る） */
  const linkPick = () => `<div class="de-row de-linkpick"><span class="de-l">数える物</span>${segs("linkmode", [["one", "1 つのデータ", "1 つのデータの数を出します"], ["link", "別のデータと合わせる（目標と実績）", "別のデータ（元・条件・値）の数を同じ軸でそろえて 1 つのパネルに出します（45度線管理図など）"]], isLink() ? "link" : "one", "数える物")}</div>`;
  /** 全体の札: データごとのカード（役割の色の帯・役割・軸・値・作り方・グラフのどこに出るか）と、差・達成率。
      2026-10-dashlink の 2 回目で 1 位の R4（表 → カード。横軸／縦軸を読める大きさで） */
  function linkHtml() {
    const ss = p.link.sides, ex = new Set(p.link.extra || []), n = "①②③④";
    const both = ss.some((x) => x.role === "target") && ss.some((x) => x.role === "actual");
    const diag = ["diag45", "scatter"].includes(p.visual);
    const where = (r) => (r === "target" ? (diag ? "→ 45度線の<b>横軸</b>" : "→ グラフの<b>棒</b>") : r === "actual" ? (diag ? "→ 45度線の<b>縦軸</b>" : "→ グラフの<b>線</b>") : "→ 並べて比べる");
    const keyText = (k) => (k ? dimLabel(k) + (k.part ? `（${(k.column === "@workday" ? WORKDAY_NAME : PART_NAME)[k.part] || k.part}）` : "") : "（軸を選ぶ）");
    const cards = ss.map((x, i) => `<div class="de-lnkcard" style="--rc:${ROLE_COLOR[x.role || ""]}"><button type="button" class="de-lnk-go" data-de-tab="${i}" title="このデータを組む">${n[i]} ${esc(x.title || (srcOf(x.source) || {}).name || "")}</button>`
      + `<div class="de-lnkrow">${segs(`role-${i}`, ROLES, x.role || "", "役割")}</div>`
      + `<div class="de-lnkkv"><span>軸</span><b>${esc(keyText(x.key))}</b><span>値</span><b>${esc(P.measName(x.measure || { agg: "lots" }))}</b></div>`
      + `<div class="de-lnkrow">${segs(`build-${i}`, BUILDS, x.build || "as", "作り方")}</div><div class="de-lnkwhere">${where(x.role || "")}</div></div>`).join("");
    return linkPick() + `<div class="de-row de-top"><span class="de-l">合わせ方</span><div class="de-lnk"><div class="de-lnkc">${cards}</div>`
      + `<small class="de-hint">軸の値（日・年月・設備名・字）が同じ行をそろえます。カードの名前を押すと、そのデータを組みます</small></div></div>`
      + `<div class="de-row"><span class="de-l">足す値</span><label class="pv-ck"${both ? "" : ' title="目標と実績を 1 つずつ決めると使えます"'}><input type="checkbox" data-de-extra="diff"${ex.has("diff") ? " checked" : ""}${both ? "" : " disabled"}>差（実績−目標）</label>`
      + `<label class="pv-ck"><input type="checkbox" data-de-extra="rate"${ex.has("rate") ? " checked" : ""}${both ? "" : " disabled"}>達成率（実績÷目標 %）</label></div>`;
  }
  function addGroup() {
    const gs = parts(), what = isLink() ? "合わせるデータ" : "列のまとまり";
    if (gs.length >= MAX_GROUPS) { host.toast(`${what}は ${MAX_GROUPS} つまでです`); return; }
    const last = gs[gs.length - 1] || {};
    if (isLink()) gs.push({ title: "", role: "", build: "as", source: last.source || WL.dashKit.src.DEFAULT, equip: "", filters: [], search: "", period: null, basis: "work", key: last.key || null, measure: { agg: "lots" } });
    else gs.push({ title: "", source: last.source || WL.dashKit.src.DEFAULT, equip: "", filters: [], search: "", period: null, basis: "work", measure: { agg: "lots" }, cols: [], look: "num", total: true, zero: false, color: "" });
    delete p.legacy; host.onChange(WL.dashKit.clone(p)); select(gs.length - 1);
  }
  function moveGroup(i, d) {
    const gs = parts(), j = i + d; if (j < 0 || j >= gs.length) return;
    [gs[i], gs[j]] = [gs[j], gs[i]];
    const o = p.order; if (o) { if (o.group === i) o.group = j; else if (o.group === j) o.group = i; }
    gi = j; t = groupView(gs[gi]); changed(false);
  }
  function removeGroup(i) {
    const gs = parts();
    if (gs.length <= (isLink() ? 2 : 1)) { host.toast(isLink() ? "合わせるデータは 2 つ以上要ります（やめるときは「全体」の「合わせるのをやめる」）" : "まとまりは 1 つ以上要ります（表をやめるときは、ほかの形を選びます）"); return; }
    gs.splice(i, 1);
    if (p.order) p.order.group = Math.min(p.order.group, gs.length - 1);
    gi = -1; t = p; changed(false);
  }
  /** 行の鍵の並び（いまの答えから。隠した行も・グループの順）→ [{key, hidden, group}] */
  function rowKeys() {
    const d = host.answer && host.answer();
    const hide = new Set(p.order.hide || []);
    return (d ? P.boardTree(p, d) : []).flatMap((g) => g.keys.map((k) => ({ key: k, hidden: hide.has(k), group: g.name })));
  }
  /** 手で並べる: いまの見え方の並び（隠した行も）を list にして、key を to 番目（key を抜いた並びでの位置）へ */
  function moveRow(key, to) {
    const keys = rowKeys().map((x) => x.key), from = keys.indexOf(key);
    if (from < 0) return;
    keys.splice(from, 1);
    keys.splice(Math.max(0, Math.min(keys.length, to)), 0, key);
    Object.assign(p.order, { by: "manual", list: keys });
    changed(false);
  }
  /** グループを to 番目（name を抜いた並びでの位置）へ（グループの順 glist） */
  function moveGroupRow(name, to) {
    const d = host.answer && host.answer(), names = (d ? P.boardTree(p, d) : []).map((g) => g.name).filter((n) => n !== P.NONE_GROUP), from = names.indexOf(name);
    if (from < 0) return;
    names.splice(from, 1);
    names.splice(Math.max(0, Math.min(names.length, to)), 0, name);
    p.order.glist = names;
    changed(false);
  }
  function toggleRow(key) {
    const hide = new Set(p.order.hide || []);
    if (hide.has(key)) hide.delete(key); else hide.add(key);
    p.order.hide = [...hide];
    changed(false);
  }

  /* ---- 計算列をここで作る（版 3.39.0。要望 5）: 名前と式（式ビルダーで組み立てるか、式を書く）。パネルの計算列（calc.own）として持つ
     （一覧の表示列には入れない。一覧の計算列と同じ書き方・同じ答え: list-formula.js / services/formula.py） ---- */
  function calcHtml() {
    if (!calcEdit) return "";
    const chk = calcEdit.expr.trim()  ? WL.formula.check(calcEdit.expr) : null;
    const dup = calcEdit.name.trim() && calcEdit.name.trim() !== calcEdit.was && ((fields && fields.fields) || []).some((f) => f.column === calcEdit.name.trim());
    const ok = calcEdit.name.trim() && chk && chk.ok && !dup;
    return `<div class="de-calc" role="dialog" aria-label="計算列を作る"><div class="de-calchead"><b>${calcEdit.was ? "計算列を直す" : "計算列を作る"}</b><small>このパネルだけの列です。左のカラムの札に並び、行・列・値・条件に使えます</small></div>`
      + `<label class="de-row"><span class="de-l">名前</span><input id="deCalcName" value="${esc(calcEdit.name)}" maxlength="60" placeholder="例: 板厚の差" aria-label="計算列の名前"></label>`
      + `<div class="de-row de-top"><span class="de-l">式</span><textarea id="deCalcExpr" rows="2" spellcheck="false" placeholder="例: [出側板厚] - [入側板厚]" aria-label="式">${esc(calcEdit.expr)}</textarea></div>`
      + `<div class="de-row"><span class="de-l"></span><small class="de-hint${chk && !chk.ok ? " is-warn" : ""}" id="deCalcMsg">${dup ? "同じ名前の列があります。別の名前にしてください" : chk ? (chk.ok ? "✓ 読める式です" : esc(chk.error)) : "列は [名前]。＋ − × ÷・文字は '…'。下の「部品から作る」でも組み立てられます"}</small></div>`
      + `<details class="de-fbwrap"${calcEdit.expr ? "" : " open"}><summary>部品から作る（式ビルダー）</summary><div class="fb" id="deCalcFb"></div></details>`
      + `<div class="de-calcacts">${calcEdit.was ? '<button type="button" class="pv-btn is-danger" data-de-calcdel>この計算列を消す</button>' : ""}<span class="dash-sp"></span>`
      + `<button type="button" class="mm-btn-ghost" data-de-calcx>やめる</button><button type="button" class="mm-btn-primary" data-de-calcok${ok ? "" : " disabled"}>${calcEdit.was ? "直す" : "作る"}</button></div></div>`;
  }
  function openCalc(name = "") {
    const own = ownOf(t.calc);
    calcEdit = { was: name, name, expr: name ? own[name] || ctx.formulas[name] || "" : "" };
    paintCalc();
  }
  function paintCalc() {
    const box = $("#deCalcBox"); if (!box) return;
    box.innerHTML = calcHtml(); box.hidden = !calcEdit;
    if (!calcEdit) return;
    const fb = $("#deCalcFb");
    if (fb && WL.formulaBuilder) WL.formulaBuilder.mount(fb, { kind: "calc", kinds: ["calc", "if", "join", "cut", "fill", "round", "count", "span"],
      columns: () => ((fields && fields.fields) || []).filter((f) => !f.error && f.column !== calcEdit.was).map((f) => f.column), preview: () => [],
      apply: (f, how) => { const ta = $("#deCalcExpr"); calcEdit.expr = how === "insert" ? ta.value.slice(0, ta.selectionStart) + f + ta.value.slice(ta.selectionEnd) : f; paintCalc(); } });
    const n = $("#deCalcName"); if (n && !calcEdit.name) n.focus();
  }
  /** 計算列を置く（名前を変えたら、使っている段・値・条件の列の名前も替える）・消す */
  async function saveCalc(remove = false) {
    const name = calcEdit.name.trim(), was = calcEdit.was, own = ownOf(t.calc);
    if (was) delete own[was];
    if (!remove) own[name] = calcEdit.expr.trim();
    const swap = (c) => (c === was ? (remove ? null : name) : c);
    if (was) {
      const b = t.body;
      ["rows", "cols"].forEach((r) => { b[r] = b[r].map((d) => ({ ...d, column: swap(d.column) })).filter((d) => d.column); });
      b.measures = b.measures.map((m) => (m.column ? { ...m, column: swap(m.column) } : m)).filter((m) => m.column !== null);
      if (!b.measures.length) b.measures = [{ agg: "lots" }];
      t.filters = t.filters.map((f) => ({ ...f, column: swap(f.column) })).filter((f) => f.column);
    }
    const cur = t.calc || { formulas: {}, names: {} }, formulas = { ...cur.formulas };
    if (was) delete formulas[was];
    Object.assign(formulas, own);
    t.calc = { formulas, names: cur.names || {}, own: Object.keys(own) };
    if (!t.calc.own.length) delete t.calc.own;
    calcEdit = null; paintCalc();
    fieldsKey = ""; await loadFields();
    changed();
    host.toast(remove ? `計算列「${was}」を消しました` : `計算列「${name}」を${was ? "直しました" : "作りました。左のカラムの札から使えます"}`);
  }

  async function loadFields() {
    if (parts() && gi < 0) return;
    ctx = calcContext();
    const key = JSON.stringify([t.source, t.equip, ctx]);
    if (fields && fieldsKey === key) return;
    fields = null; fieldsErr = ""; fieldsKey = key; paint();
    try {
      const r = await WL.dashKit.fetch("/api/dashboard/fields", WL.dashKit.json("POST", { source: t.source, equip: t.equip || "", calc: ctx }));
      const d = await r.json().catch(() => ({}));
      if (fieldsKey !== key) return;
      if (!r.ok) { fieldsErr = d.error || "カラムを読めませんでした"; if (d.kind === "copying") setTimeout(() => { if (fieldsKey === key) { fieldsKey = ""; loadFields().then(() => paint()); } }, 4000); }
      else fields = d;
    } catch (e) { fieldsErr = String(e); }
    paint();
  }

  /* ---- 描く ---- */
  const btn = (role, col, on, extra = "") => `<button type="button" class="pv-r r-${role}${on ? " on" : ""}" data-de-add="${role}" data-col="${esc(col)}" aria-pressed="${on}" ${extra}>${{ rows: "行", cols: "列", vals: "値" }[role]}</button>`;
  function fieldsHtml() {
    if (fieldsErr) return `<p class="pv-none">${esc(fieldsErr)}</p>`;
    if (!fields) return '<p class="pv-none">カラムを読んでいます…</p>';
    if (isOps(p) && !inGroup()) {          // 稼働を見る形: 札は 1 つ（ガント＝棒の色分け・ABC＝品種）。押すとその列にする（もう一度で外す）
      const gantt = p.visual === "gantt", word = gantt ? "色" : "品種", on = (c) => (gantt ? (p.ops || {}).color === c : clsOf(p).includes(c));
      const ql = q.trim().toLowerCase();
      const list = fields.fields.filter((f) => !f.error && pickable(f) && (!ql || f.column.toLowerCase().includes(ql)));
      return `<p class="de-ophint">${gantt ? "［色］を押すと、その列の値ごとに棒の色を分けます（計算列も使えます）" : "［品種］を押すと、その列の値ごとに ABC に分けます。2 つ以上押すと、その組み合わせ（合金 × 調質 など）で分けます"}</p>`
        + list.map((f) => `<div class="pv-f${on(f.column) ? " is-used" : ""}${f.calc ? " is-calc" : ""}"><span><b>${esc(f.column)}${f.calc ? '<small class="sx-calc">式</small>' : ""}</b><small>${f.many ? "1,000 種類以上" : `${f.numeric ? "数 · " : ""}${f.kinds} 種類`}</small></span><i></i><i></i>`
          + `<button type="button" class="pv-r r-rows${on(f.column) ? " on" : ""}" data-de-opick="${esc(f.column)}" aria-pressed="${on(f.column)}">${word}</button></div>`).join("");
    }
    const ownList = (t.calc && t.calc.own) || [];
    const b = t.body, used = (c) => (b.rows.some((d) => d.column === c) ? "rows" : b.cols.some((d) => d.column === c) ? "cols" : "");
    const rowBtn = (c, on) => (inGroup() && !inSide() ? "<i></i>" : btn("rows", c, on, inSide() ? 'title="このデータの軸（そろえる段）にします"' : ""));
    const dimRoles = [inGroup() && !inSide() ? "" : "rows", inSide() ? "" : "cols"].filter(Boolean), fa = DND.fieldAttrs;
    const colBtn = (c, on) => (inSide() ? "<i></i>" : btn("cols", c, on));
    const meas = (agg, col = "") => b.measures.some((m) => m.agg === agg && (m.column || "") === col);
    const ql = q.trim().toLowerCase(), hit = (n) => !ql || n.toLowerCase().includes(ql);
    let html = special().filter((x) => hit(x.name)).map((x) => `<div class="pv-f is-special${used(x.column) ? " is-used" : ""}" title="${esc(x.hint || "")}"${fa(x.column, dimRoles)}><span><b>${esc(x.name)}</b><small>${esc(x.hint || "")}</small></span>`
      + `${rowBtn(x.column, used(x.column) === "rows")}${colBtn(x.column, used(x.column) === "cols")}<i></i></div>`).join("");
    if (hit("ロット数 件数")) {
      html += `<div class="pv-f is-special${meas("lots") ? " is-used" : ""}"${fa("@lots", ["vals"])}><span><b>ロット数</b><small>${isWork() ? "作業の数（作業開始が同じ行は 1）" : "重複の無いロット番号"}</small></span><i></i><i></i>${btn("vals", "@lots", meas("lots"))}</div>`
        + `<div class="pv-f is-special${meas("count") ? " is-used" : ""}"${fa("@count", ["vals"])}><span><b>件数</b><small>行の数</small></span><i></i><i></i>${btn("vals", "@count", meas("count"))}</div>`;
    }
    html += fields.fields.filter((f) => hit(f.column)).map((f) => {
      const c = f.column, u = used(c), anyVal = b.measures.some((m) => m.column === c);
      if (f.error) return `<div class="pv-f is-off" title="${esc(ctx.formulas[c] || "")}"><span><b>${esc(c)}<small class="sx-calc">式</small></b><small>${esc(f.error)}（一覧の「表示列」で直す）</small></span><i></i><i></i><i></i></div>`;
      const sub = (f.calc ? "式の列 · " : "") + (f.date ? "日付" : f.numeric ? `数${f.many ? "" : ` · ${f.kinds} 種類`}` : f.many ? "1,000 種類以上" : `${f.kinds} 種類`);
      const tip = f.calc ? `${c}（計算列。一覧の表示列で作った式）\n${ctx.formulas[c] || ""}` : c;
      const mine = ownList.includes(c);
      return `<div class="pv-f${u || anyVal ? " is-used" : ""}${f.calc ? " is-calc" : ""}" title="${esc(tip)}"${fa(c, dimRoles.concat(["vals"]))}><span><b>${esc(c)}${f.calc ? (mine ? `<button type="button" class="sx-calc is-own" data-de-calcopen="${esc(c)}" title="このパネルで作った計算列。押すと直せます">式 ✎</button>` : '<small class="sx-calc">式</small>') : ""}</b><small>${mine ? "このパネルの式 · " : ""}${sub.replace(/^式の列 · /, "")}</small></span>`
        + rowBtn(c, u === "rows") + colBtn(c, u === "cols") + (f.numeric ? btn("vals", c, anyVal, 'title="合計を値に足します（値の札で平均・中央値・標準偏差などの統計に替えられます）"')
          : btn("vals", c, anyVal, 'title="種類の数（重複の無い値の数）を値に足します"')) + "</div>";
    }).join("");
    return html || '<p class="pv-none">当たるカラムがありません</p>';
  }
  function dimChip(d, role, i) {
    const ps = partsOf(d.column), pn = d.column === "@workday" ? WORKDAY_NAME : d.column === "@egroup" ? { "@panel": "このパネルのグループ", "": "（まとめ方なし）" } : PART_NAME;
    const fixed = isBoard() && inGroup() && role === "rows";
    const sel = (ps.length > 1 || d.column === "@egroup") && !fixed ? `<select data-de-part="${role}" data-i="${i}" aria-label="まとめ方">${ps.map((x) => `<option value="${esc(x)}"${(d.part || "") === x ? " selected" : ""}>${esc(pn[x] || x)}</option>`).join("")}</select>` : "";
    return `<span class="pv-chip ${role === "rows" ? "r" : "c"}${fixed ? " is-fixed" : ""}"${fixed ? ' title="行の段は表全体で 1 つです（「表全体」で変えます）"' : ""}${DND.chipAttrs(role, i, !fixed)}><b>${esc(dimLabel(d))}</b>${sel}${fixed ? "" : `<button type="button" data-de-x="${role}" data-i="${i}" aria-label="「${esc(dimLabel(d))}」を外す">×</button>`}</span>`;
  }
  /** 値の札: 名前・集計のしかた（よく使う／統計／種類。数でない列は種類の数だけ）・決める数（p%点の p・Cpk の規格）・表し方（割合・累計など） */
  function measChip(m, i) {
    const num = m.column && isNum(m.column), grp = { basic: "よく使う", stat: "統計", kind: "種類" };
    const opts = (g) => C.AGGS.filter((a) => a.g === g && (num || a.any)).map((a) => `<option value="${a.k}"${m.agg === a.k ? " selected" : ""} title="${esc(a.tip || "")}">${a.n}</option>`).join("");
    const sel = m.agg === "count" || m.agg === "lots" ? "" : `<select data-de-agg="${i}" aria-label="集計のしかた">${Object.entries(grp).map(([g, n]) => { const o = opts(g); return o ? `<optgroup label="${n}">${o}</optgroup>` : ""; }).join("")}</select>`;
    const par = m.agg === "pct" ? `<label class="de-par">p<input type="number" min="1" max="99" value="${m.p || 90}" data-de-mp="${i}" aria-label="何%点か"></label>`
      : m.agg === "cpk" ? `<label class="de-par">下限<input type="number" step="any" value="${m.lsl ?? ""}" data-de-mlsl="${i}" aria-label="規格の下限"></label><label class="de-par">上限<input type="number" step="any" value="${m.usl ?? ""}" data-de-musl="${i}" aria-label="規格の上限"></label>` : "";
    const show = `<select class="de-show" data-de-show="${i}" aria-label="表し方" title="表し方（割合・累計・前との差・順位）">${C.SHOWS.map(([k, n]) => `<option value="${k}"${(m.show || "") === k ? " selected" : ""}>${k ? n : "表し方"}</option>`).join("")}</select>`;
    const name = m.agg === "count" ? "件数" : m.agg === "lots" ? "ロット数" : m.column;
    return `<span class="pv-chip v"${DND.chipAttrs("vals", i, !inGroup())}><b>${esc(name)}</b>${sel}${par}${show}${inGroup() ? "" : `<button type="button" data-de-mx="${i}" aria-label="「${esc(P.measName(m))}」を外す">×</button>`}</span>`;
  }
  /** 稼働を見る形の数え方（行・列・値の文の代わり）: ガント＝作業終了の列・棒の色分け・棒の字／ABC＝品種の列・量・換算の基準・A と B の線 */
  function opsHtml() {
    const o = p.ops || {}, fs = ((fields && fields.fields) || []).filter((f) => !f.error);
    const opt = (v, n, cur) => `<option value="${esc(v)}"${(cur || "") === v ? " selected" : ""}>${esc(n)}</option>`;
    const a = host.answer ? host.answer() : null, mine = a && a.kind === p.visual, found = mine ? a.endColumn : "", foundS = mine ? a.startColumn : "";
    // 作業開始・作業終了の列（版 3.48.0。要望 7: 作業開始も選べる）。年月日時分秒（14 桁）は日付の列と見分けられないので名前でも
    const stamps = (re) => fs.filter((f) => f.date || re.test(f.column)).map((f) => f.column);
    const colSel = (k, word, auto, list) => `<select data-de-o${k} aria-label="${word}の列">${opt("", `自動${auto ? `（${auto}）` : `（${word}の列を探す）`}`, o[k])}${list.map((c) => opt(c, c, o[k])).join("")}</select>`;
    const endSel = `<div class="de-row"><label class="de-l">作業開始</label>${colSel("start", "作業開始", foundS, stamps(/作業開始|開始|着手/))}</div>`
      + `<div class="de-row"><label class="de-l">作業終了</label>${colSel("end", "作業終了", found, stamps(/作業終了|終了|完了/))}</div>`;
    const few = fs.filter((f) => pickable(f) && f.kinds >= 1 && f.kinds <= 60).map((f) => f.column);
    if (p.visual === "gantt") {
      return `<div class="de-ops">${endSel}`
        + `<div class="de-row"><label class="de-l">色分け</label><select data-de-ocolor aria-label="棒の色分け">${opt("", "なし（作業は 1 色）", o.color)}${few.map((c) => opt(c, c, o.color)).join("")}</select>`
        + `<label class="pv-ck">棒の字<select data-de-olabel aria-label="棒に出す字">${opt("", "ロット番号", o.label)}${fs.filter((f) => !f.numeric).map((f) => opt(f.column, f.column, o.label)).join("")}</select></label></div>`
        + `<p class="de-ophint">稼働率 ＝ 作業していた時間 ÷ 勤務時間（マスタ管理の「勤務体系」の直の時間。勤務の外の稼働は分母にも入れず、行の説明に出します）。分割したロット（作業開始が同じ行）は 1 作業です。</p></div>`;
    }
    const nums = fs.filter((f) => f.numeric).map((f) => f.column), qty = o.qty || "lots";
    const items = a && a.kind === "abc" ? ((a.all || {}).items || []).map((x) => x.key).filter(Boolean) : [];
    const base = o.base || "avg";
    // 並び（2026-10-dash8 の 2 回目で決めた形）: 何で分けるか（品種）→ 作業の区間（作業開始・作業終了）→ 量 → 換算 → ABC の線 → 全設備の時間 → 出す項目
    return `<div class="de-ops">`
      + clsRow(few) + endSel
      + `<div class="de-row"><label class="de-l">量</label>${segs("oqty", [["lots", "本数", "作業の本数（分割したロットは 1 本）"], ["time", "作業時間", "作業開始〜作業終了の時間の合計"]], qty === "lots" || qty === "time" ? qty : "", "量")}`
      + `<select data-de-oqcol aria-label="数の列の合計"><option value="">数の列の合計…</option>${nums.map((c) => opt(c, `${c}の合計`, qty)).join("")}</select></div>`
      + `<div class="de-row"><label class="de-l" title="換算の基準">換算基準</label><select data-de-obase aria-label="換算係数の基準">${opt("avg", "全作業の平均作業時間 ＝ 1.00", base)}${opt("top", "いちばん本数の多い品種 ＝ 1.00", base)}`
      + `${items.map((k) => opt(k, `品種「${k}」＝ 1.00`, base)).join("")}${base !== "avg" && base !== "top" && !items.includes(base) ? opt(base, `品種「${base}」＝ 1.00`, base) : ""}</select></div>`
      + abcRow(o, a && a.kind === "abc" ? a : null)
      // 全設備の作業時間（版 3.48.0。要望 6）・表示項目（要望 5）
      + `<div class="de-row de-spanrow"><label class="de-l de-lnw" title="「全設備」の札の作業時間の取り方">全設備の時間</label>${segs("ospan", [["", "各設備の積み上げ", "作業 1 本ずつの作業時間を、全部の設備で足す（1 本＝1 作業）"], ["lead", "リードタイム", "同じロット番号の、全設備の作業開始のいちばん早い時刻〜作業終了のいちばん遅い時刻（1 本＝1 ロット）"]], o.span === "lead" ? "lead" : "", "全設備の作業時間")}`
      + `<small class="de-hint">${o.span === "lead" ? "最初の作業開始〜最後の作業終了（MIN〜MAX）" : "設備ごとの作業時間の合計"}</small></div>`
      // 全設備をリードタイムにしたら、表の見出しと同じ「平均 LT」（2026-10-dash8 の 2 回目の採点: 出す項目と見出しの言葉が違った）
      + `<div class="de-row de-top de-ochkrow"><label class="de-l">出す項目</label><span class="de-ochk">${ABC_ITEMS.map(([k, n0, tip]) => [k, k === "avg" && o.span === "lead" ? "平均作業・平均 LT" : n0, tip]).map(([k, n, tip]) => `<label class="pv-ck"${tip ? ` title="${esc(tip)}"` : ""}><input type="checkbox" data-de-ohide="${k}"${(o.hide || []).includes(k) ? "" : " checked"}>${n}</label>`).join("")}</span></div>`
      // 換算係数の期間（地点 A。版 3.49.0。要望 3）: 別の期間の係数で、パネルの期間（地点 B）の本数を換算する
      + `<div class="de-row de-wrap"><label class="de-l de-lnw" title="換算係数を出す期間（地点 A）。パネルの期間（地点 B）の本数に、A の係数を掛けます">係数の期間</label>`
      + `${periodCtl(o.refPeriod, "r", [["", "パネルの期間と同じ"], ...PERIODS.slice(1)], "換算係数の期間（地点 A）")}</div>`
      + `<p class="de-ophint">占有時間 ＝ 本数 × 平均作業。換算係数 ＝ 品種の平均作業 ÷ 基準。換算本数 ＝ 本数 × 換算係数（＝ 占有時間 ÷ 基準）。`
      + `${o.refPeriod ? "係数の期間（地点 A）を決めると、係数は A で出し、本数はパネルの期間（地点 B）で数えます（A に無い品種は 1.00）。" : "係数の期間を決めると、過去（地点 A）の係数でいまの本数を換算できます。"}</p></div>`;
  }
  /** ABC の段（版 3.51.0。利用者の要望 2026-10-22: A・B・C の 3 つに限らない。2026-10-abcrank の 1 回目で決めた A）:
      分け方［線で分ける｜品種ごと］と段の数。線で分けるときは、線ごとの札（段の名前 ≦ 数 % ×）と「＋ 線」、最後に「残りが 段」。
      札の名前と色はパネルの ABC の列と同じ（WL.dashOps.rankStyle）。品種ごとは線を隠し、段の数を出す（線は覚えていて、戻すと戻る） */
  /** 線の並びを入れる（昇順に並べ直す。札の名前は描き直しで振り直る）。既定（70・90）なら書かない。前の a・b は捨てる */
  function setLims(xs) {
    const lims = [...new Set(xs.map(Number).filter((v) => v > 0 && v <= 100))].sort((x, y) => x - y).slice(0, ABC_LIMS_MAX);
    const o = { ...(p.ops || {}) }; delete o.a; delete o.b;
    if (lims.length && lims.join() !== "70,90") o.lims = lims; else delete o.lims;
    p.ops = o; changed(false);
  }
  function abcRow(o, a) {
    const lims = abcLims(o), each = o.rankBy === "each", n = lims.length + 1, R = WL.dashOps;
    const badge = (i, cnt) => { const r = R.rankStyle(i, cnt, R.rankName(i)); return `<b class="oa-rank" style="--rc:${r.c};--rf:${r.f}">${r.n}</b>`; };
    const items = a && a.all && a.all.items ? a.all.items.length : 0;
    const count = each ? items : n;
    const head = `<span class="de-abchead">${segs("rankby", [["", "線で分ける", "累積構成比の線で分けます（線の数＋1 の段）"], ["each", "品種ごと", "量の大きい順に、品種 1 つずつに A, B, C … と付けます（Z の次は AA）"]], each ? "each" : "", "ABC の分け方")}`
      + `<small class="de-hint de-abcn">${each ? `品種ごとに A, B, C …${items ? `（いま ${items} 段）` : ""}` : `${n} 段（A〜${R.rankName(n - 1)}）`}</small>`
      // 読めない線の知らせは段の数のすぐ横（線が多くて札が長くなっても、見える所に出す）
      + `${each ? "" : '<small class="de-limerr" data-de-limerr role="status"></small>'}</span>`;
    const lines = each ? "" : `<span class="de-lims">${lims.map((v, i) => `<span class="de-lim">${badge(i, count)}<span aria-hidden="true">≦</span>`
      + `<input type="number" min="0.1" max="100" step="any" data-de-lim="${i}" value="${+v}" class="de-n de-limn" aria-label="${R.rankName(i)} の線（累積構成比 %）">%`
      + `${lims.length > 1 ? `<button type="button" class="de-limx" data-de-limx="${i}" title="${R.rankName(i)} の線（${+v}%）を外す" aria-label="${R.rankName(i)} の線（${+v}%）を外す">×</button>` : ""}</span>`).join("")}`
      + `${lims[lims.length - 1] < 100 && lims.length < ABC_LIMS_MAX ? '<button type="button" class="de-limadd" data-de-limadd title="最後の線と 100% の中ほどに線を足します（段が 1 つ増えます）">＋ 線</button>' : ""}`
      + `<span class="de-lim de-limrest"><small>残りが</small>${badge(n - 1, count)}</span></span>`;
    return `<div class="de-row de-abcrow" data-de-abcrow><label class="de-l" title="ABC の段の分け方">ABC</label><div class="de-abcbox">${head}${lines}</div></div>`;
  }
  /** ABC の線（版 3.51.0。前に保存した a・b は線の並びとして読む） */
  const abcLims = (o) => { const xs = Array.isArray(o.lims) && o.lims.length ? o.lims : [o.a ?? 70, o.b ?? 90]; return [...new Set(xs.map(Number).filter((v) => v > 0 && v <= 100))].sort((x, y) => x - y); };
  const ABC_LIMS_MAX = 50;
  /** 品種の列（版 3.47.0。要望 3）: 選んだ列の札（× で外す・左右で順を替える）と「＋ 組み合わせる列」。1 つなら今までと同じ */
  function clsRow(few) {
    const cls = clsOf(p), rest = few.filter((c) => !cls.includes(c));
    const chips = cls.map((c, i) => `<span class="pv-chip r de-clsc"><b>${esc(c)}</b>${i ? `<button type="button" data-de-clsl="${i}" aria-label="「${esc(c)}」を前へ" title="前へ（組み合わせの順）">←</button>` : ""}`
      + `<button type="button" data-de-clsx="${i}" aria-label="「${esc(c)}」を外す">×</button></span>${i < cls.length - 1 ? '<span class="de-clsx">×</span>' : ""}`).join("");
    const add = cls.length < MAX_CLS && rest.length ? `<select data-de-ocls aria-label="${cls.length ? "組み合わせる列を足す" : "品種の列"}"${cls.length ? "" : ' class="is-need"'}>`
      + `${`<option value="">${cls.length ? "＋ 組み合わせる列" : "（品種の列を選ぶ）"}</option>`}${rest.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select>` : "";
    return `<div class="de-row de-clsrow"><label class="de-l">品種</label><span class="de-clss">${chips}${add}</span>`
      + `<small class="de-hint">${cls.length > 1 ? `${cls.length} つの列の値の組み合わせで分けます` : "何ごとに分けるか（合金・板厚の区分など。計算列も使えます。2 つ以上選ぶと組み合わせ）"}</small></div>`;
  }
  /** 行と列を入れ替える札（版 3.50.0。一覧の集計表と同じ。合わせた表のまとまり・合わせるデータ・数字には無い） */
  const swapBtn = () => (inGroup() ? "" : `<button type="button" class="pv-swap" aria-label="行と列を入れ替える" data-de-swap${t.body.cols.length ? "" : " disabled"} title="${t.body.cols.length ? "行の段と列の段を入れ替えます" : "列に段を入れると、行と入れ替えられます"}"><i aria-hidden="true">⇄</i><span class="pv-swl">入れ替え</span></button>`);
  /** 値の計算の段（版 3.50.0。要望 2。pivot-calc.js。一覧の集計表と同じ部品）: 文のすぐ下。値ごとの四則演算（合わせた表のまとまり・合わせるデータでも） */
  function calcBand() {
    if (isOps(p) && !inGroup()) return "";
    const a = host && host.answer ? host.answer() : null;
    if (a && a.cells) WL.pivotCalc.remember(a, a.measures);
    return WL.pivotCalc.html(t.body.measures, { name: (m) => P.measName({ ...m, expr: undefined }), answer: a && a.cells && !inGroup() && !inSide() ? a : null, num: (v, m) => C.numText(v, C.measFmt(p.fmt || {}, m)) });
  }
  /** 答えが届いたら、段の変わり方（総計）だけを描き直す（打っている欄はそのまま） */
  function paintCalc0() {
    const se = $("#deSent"), bd = se && se.querySelector(".pvc-band");
    if (bd) WL.pivotCalc.keepFocus(se, () => { const x = document.createElement("div"); x.innerHTML = calcBand(); bd.replaceWith(x.firstElementChild || ""); });
  }
  /** 前の版の書式の「計算」（fmt.expr。パネル全体に 1 つ）を、値ごとの計算へ移す（計算の無い値に同じ式。版 3.50.0） */
  function moveCalc(x) {
    const ex = x.fmt && x.fmt.expr;
    if (!ex) return;
    const lists = x.visual === "board" ? (x.groups || []).map((g) => [g.measure].filter(Boolean)) : x.link ? (x.link.sides || []).map((y) => [y.measure].filter(Boolean)) : [(x.body || {}).measures || []];
    lists.forEach((ms) => ms.forEach((m) => { if (!m.expr) m.expr = ex; }));
    const fm = { ...x.fmt }; delete fm.expr;
    if (Object.keys(fm).length) x.fmt = fm; else delete x.fmt;
  }
  function sentenceHtml() {
    if (isOps(p) && !inGroup()) return opsHtml();
    const b = t.body, slot = (role, html, ph) => `<span class="pv-slot" data-role="${role}">${html || `<span class="pv-ph">${ph}</span>`}</span>`;
    const kpi = t.visual === "kpi";
    if (inSide()) return `<div class="pv-sent de-sent">${slot("rows", b.rows.map((d, i) => dimChip(d, "rows", i)).join(""), "左の札の［行］で軸を選ぶ")}<span class="pv-w">ごとの</span>`
      + `${slot("vals", b.measures.map(measChip).join(""), "ロット数")}<span class="pv-w">を合わせる</span></div>`;
    // 小計（版 3.40.0。要望 5）: 表で行の段が 2 つ以上（設備グループ → 設備 など）。行の段の文のすぐ下（何ごとの小計かを、段の札の近くで決める）
    const sub = !inGroup() && !isLink() && p.visual === "none" && (b.rows || []).length > 1
      ? `<div class="de-subrow"><label class="pv-ck" title="行の段の上の段ごとに小計の行を出します"><input type="checkbox" data-de-sub${b.sub ? " checked" : ""}>${esc(dimLabel(b.rows[0]))}ごとの小計を出す</label></div>` : "";
    return `<div class="pv-sent de-sent">${kpi ? '<span class="pv-w">全体の</span>' : `${slot("rows", b.rows.map((d, i) => dimChip(d, "rows", i)).join(""), "左の札の［行］")}<span class="pv-w">ごとに、</span>`
      + `${swapBtn()}${slot("cols", b.cols.map((d, i) => dimChip(d, "cols", i)).join(""), "＋ 列")}<span class="pv-w">別の</span>`}`
      + `${slot("vals", b.measures.map(measChip).join(""), "ロット数")}<span class="pv-w">を出す</span></div>${sub}`;
  }
  /** 形の札（版 3.39.0 で 25。目的の行に並べる: 数と表・推移を見る・比べる・内訳・ばらつき・関係。集計表のグラフの形の面と同じまとまり）。
      合わせた表は、表全体の札で「選んだ形の札 1 枚＋形を変える…」に畳む（押すと全部の札が開く。2026-10-board の 3 回目で決めた CF） */
  function visualsHtml() {
    if (inGroup()) return "";
    const ico = (x) => (x.icon && !C.get(x.k) ? `<svg class="pv-ico" viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d="${x.icon}"/></svg>` : C.iconSvg(x.k, 17));
    const btn = (x) => `<button type="button" class="pv-cbtn${p.visual === x.k ? " on" : ""}" role="radio" aria-checked="${p.visual === x.k}" data-de-vis="${x.k}" title="${esc(x.tip || "")}">${ico(x)}<span>${esc(x.n)}</span></button>`;
    /** @type {Array<any>} */
    const rows = [["num", "数と表", EXTRA], ["ops", "稼働", OPS_VIS]].concat(C.GROUPS.filter(([g]) => g !== "table").map(([g, n]) => [g, n, C.DEFS.filter((x) => x.g === g)]));
    const grid = `<div class="de-vis" role="radiogroup" aria-label="形" data-open="${formOpen}">${rows.map(([g, n, xs]) => `<div class="de-vrow"><span class="de-vg">${esc(n)}</span><span class="de-vi">${xs.map(btn).join("")}</span></div>`).join("")}</div>`;
    if (!isBoard()) {
      // 向く形の行（版 3.39.0）: 選んだ形と、いまの組み方（行・列・値）に向く形を名前つきで 4 つまで。全部の形は「すべての形…」で開く
      const f = fitInfo(), all = EXTRA.concat(OPS_VIS, C.DEFS.filter((x) => x.k !== "none"));
      const cur = all.find((x) => x.k === p.visual), fit = isOps(p) ? OPS_VIS.filter((x) => x.k !== p.visual)
        : all.filter((x) => x.k !== p.visual && x.k !== "board" && x.k !== "slicer" && !isOps(x) && (x.fit ? !x.fit(f) : x.k === "none" ? f.rows : !f.rows)).slice(0, 4);
      const row = `<div class="de-vfit"><span class="de-l">形</span>${cur ? btn(cur) : ""}${fit.length ? `<span class="de-vfn">向く形</span>${fit.map(btn).join("")}` : ""}`
        + `<button type="button" class="pv-btn de-vall" data-de-formmore aria-expanded="${formOpen}">${formOpen ? "閉じる" : `すべての形（${all.length}）…`}</button></div>`;
      return row + grid;
    }
    const me = EXTRA.find((x) => x.k === "board");
    return `<div class="de-row de-form"><span class="de-l">形</span><span class="pv-cbtn on de-formcard" title="${esc(me.tip)}">${ico(me)}<span>${esc(me.n)}</span></span>`
      + `<button type="button" class="pv-btn" data-de-formmore aria-expanded="${formOpen}">${formOpen ? "閉じる" : "形を変える…"}</button><small class="de-hint">行をそろえて、データの数を横に並べる</small></div>`
      + (formOpen ? grid : "");
  }
  /** いまの組み方（形の登録 DEFS の fit に渡す形。一覧の集計表の fitInfo と同じ鍵） */
  function fitInfo() {
    if (isLink()) {        // 合わせたデータ: 値＝データの数（どれも数）。軸が日なら時の形
      const ss = p.link.sides, k = ss[0].key;
      return { rows: 1, cols: 0, meas: ss.length, numMeas: ss.length, addMeas: ss.length, additive: true, time: !!k && C.isTimeDim(k), bin: false };
    }
    const b = p.body || {}, r0 = (b.rows || [])[0], ms = b.measures && b.measures.length ? b.measures : [{ agg: "lots" }];
    return { rows: (b.rows || []).length, cols: (b.cols || []).length, meas: ms.length, numMeas: ms.filter((m) => m.column && isNum(m.column)).length,
      addMeas: ms.filter((m) => C.ADDITIVE.has(m.agg)).length, additive: C.ADDITIVE.has(ms[0].agg), time: !!r0 && C.isTimeDim(r0), bin: !!r0 && r0.part === "bin" };
  }
  /** 条件を 1 列ぶん直す（value-filter.js の面。値はこの組み〈その列の条件を除く〉に当たる行の値と件数） */
  function editCond(col, anchor) {
    const f = ((fields && fields.fields) || []).find((x) => x.column === col) || {}, date = !!f.date, cur = WL.valueFilter.fromFilters(col, t.filters);
    const host = t;
    WL.valueFilter.open({
      anchor, column: col, label: col, date, picked: cur.picked, conds: cur.conds, had: t.filters.some((x) => x.column === col),
      load: async () => ({ values: (await Q.valuesOf({ ...host, equips: eqHost().equips, filters: host.filters.filter((x) => x.column !== col) }, col, { date })).map((x) => ({ value: x.value, label: x.label, count: x.n })) }),
      onApply: (r) => {
        if (host !== t) return;           // 面を開いている間に、組む物（まとまり）を替えた
        const at = t.filters.findIndex((x) => x.column === col), keep = t.filters.filter((x) => x.column !== col), add = WL.valueFilter.toFilters(col, r, date ? "date" : "");
        keep.splice(at < 0 ? keep.length : at, 0, ...add);      // 列の並びは保つ（直した列はもとの位置に）
        t.filters = keep;
        $("#deCond").innerHTML = condHtml(); changed(false);
      },
    });
  }
  function condHtml() {
    const cols = ((fields && fields.fields) || []).filter((f) => !f.error);
    // 条件（版 3.45.0。要望 6）: 列ごとの札（値の選び・条件の要約）。札を押すと、一覧の列と同じ「値で絞る」の面（値のチェック・検索・条件）で直す
    const chips = Q.byColumn(t.filters).map(([col, fs]) => `<span class="dfl-chip"><button type="button" class="dfl-chipb" data-de-fedit="${esc(col)}" title="押して直す（値にチェック・条件）">`
      + `<b>${esc(col)}</b>${esc(Q.colText(col, fs).slice(col.length + 1))}</button><button type="button" data-de-fdel="${esc(col)}" aria-label="「${esc(col)}」の条件を外す" title="外す">×</button></span>`).join("");
    const pick = `<select class="dfl-sel de-fpick" data-de-fpick aria-label="条件を足す列"${cols.length ? "" : " disabled"}><option value="">＋ 列を選んで条件を足す…</option>`
      + cols.map((f) => `<option value="${esc(f.column)}">${esc(f.column)}${f.calc ? "（式）" : ""}</option>`).join("") + "</select>";
    const dates = [...(special().some((x) => x.column === "@workday") ? [["@workday", "作業日（勤務体系で決めた日）"]] : []), ...((fields && fields.fields) || []).filter((f) => f.date).map((f) => [f.column, f.column])];
    const pr = t.period || {}, kind = pr.kind || "";
    const period = `<div class="de-row de-wrap"><label class="de-l">期間</label>${periodCtl(pr, "p", PERIODS, "期間")}`
      + (kind ? `<select data-de-pcol aria-label="期間で絞る日付">${dates.map(([c, n]) => `<option value="${esc(c)}"${c === pr.column ? " selected" : ""}>${esc(n)}</option>`).join("") || '<option value="">（日付の列がありません）</option>'}</select>` : "")
      + "</div>";
    return `${period}<div class="de-row de-top"><label class="de-l">条件</label><div class="dash-crows">${chips ? `<div class="dfl-chips">${chips}</div>` : '<small class="de-hint">すべての行を数えます</small>'}${pick}</div></div>`;
  }
  /** 選びの札（ラジオを札に見せる）。name … data-de-<name> */
  const segs = (name, list, cur, label) => `<span class="de-segs" role="radiogroup" aria-label="${esc(label)}">${list.map(([k, n, tip]) =>
    `<label class="de-seg${(cur || "") === k ? " on" : ""}"${tip ? ` title="${esc(tip)}"` : ""}><input type="radio" name="de-${name}" value="${k}" data-de-${name}${(cur || "") === k ? " checked" : ""}>${esc(n)}</label>`).join("")}</span>`;
  /** 見せ方（形の札のすぐ下）。まとまりは 棒・濃淡・数・積み上げ帯・割合・点・信号・小さな線・色・計の列・0 の印・しきい値。ほかはパネルの枠（5 つ）と、数字の形（目標） */
  function lookHtml() {
    if (inSide()) return "";
    if (!inGroup()) {
      const frame = p.frame || (p.emph ? "emph" : "card"), fm = p.fmt || {};
      const frames = `<span class="de-frames" role="radiogroup" aria-label="パネルの見せ方">${FRAMES.map(([k, n, tip]) => `<label class="de-frame${frame === k ? " on" : ""}" title="${esc(tip)}"><input type="radio" name="de-frame" value="${k}" data-de-frame${frame === k ? " checked" : ""}><i class="fr-${k}" aria-hidden="true"></i>${n}</label>`).join("")}</span>`;
      const kpi = p.visual === "kpi" ? `<div class="de-row"><span class="de-l">数字</span>${segs("kpilook", KPI_LOOKS, fm.kpi || "num", "数字の形")}`
        + (fm.kpi === "bar" || fm.kpi === "gauge" ? `<label class="pv-ck">目標<input type="number" step="any" data-de-target value="${fm.target ?? ""}" class="de-n2" aria-label="目標の値" placeholder="例 30"></label>${fm.target ? "" : '<small class="de-hint is-warn">目標を入れると出ます</small>'}` : "") + "</div>" : "";
      return `<div class="de-row"><span class="de-l">見せ方</span>${frames}</div>${kpi}${sliceRow()}`;
    }
    const g = p.groups[gi], base = P.colorOf(g.source), hasCols = (g.cols || []).length > 0;
    const looks = LOOKS.filter(([, , , cols]) => !cols || hasCols).map(([k, n, tip]) => [k, n, tip]);
    const colors = GROUP_COLORS.map((c) => `<button type="button" class="de-sw${(g.color || "") === c ? " on" : ""}" data-de-color="${c}" style="--sw:${c || base}" aria-label="${c ? `色 ${c}` : "データの種類の色"}" aria-pressed="${(g.color || "") === c}" title="${c ? "この色にする" : "データの種類の色（仕掛＝藍・作業実績＝青緑・品質データ＝琥珀）"}">${c ? "" : "自"}</button>`).join("");
    const lim = g.limits || {};
    const limits = g.look === "signal" ? `<div class="de-row"><span class="de-l"></span><label class="pv-ck">注意<input type="number" step="any" data-de-lwarn value="${lim.warn ?? ""}" class="de-n2" aria-label="注意のしきい値"></label>`
      + `<label class="pv-ck">要対応<input type="number" step="any" data-de-lalert value="${lim.alert ?? ""}" class="de-n2" aria-label="要対応のしきい値"></label>`
      + `<select data-de-ldir aria-label="悪い向き"><option value="high"${lim.dir !== "low" ? " selected" : ""}>大きいほど悪い</option><option value="low"${lim.dir === "low" ? " selected" : ""}>小さいほど悪い</option></select></div>` : "";
    // 見せ方の札（8 つ）は、パネルの見せ方（枠）と同じ絵つきの札。字は折らず、入らなければ札ごと次の段へ（作った後の採点の指摘）
    const lookChips = `<span class="de-frames de-looks" role="radiogroup" aria-label="見せ方">${looks.map(([k, n, tip]) => `<label class="de-frame${g.look === k ? " on" : ""}" title="${esc(tip)}"><input type="radio" name="de-look" value="${k}" data-de-look${g.look === k ? " checked" : ""}><i class="lk lk-${k}" aria-hidden="true"></i>${esc(n)}</label>`).join("")}</span>`;
    return `<div class="de-row de-top"><span class="de-l">見せ方</span>${lookChips}</div>`
      + `<div class="de-row"><span class="de-l">色</span><span class="de-sws" aria-label="色">${colors}</span></div>${limits}`
      + `<div class="de-row"><span class="de-l"></span>${hasCols ? `<label class="pv-ck"><input type="checkbox" data-de-total${g.total ? " checked" : ""}>計の列</label>` : ""}`
      + `<label class="pv-ck" title="ほかのまとまりに数があるのに、このまとまりが 0 の行に印を付け、表の上に名前を出します"><input type="checkbox" data-de-zero${g.zero ? " checked" : ""}>0 の行に印</label>`
      + `<label class="pv-ck de-gt">見出し<input data-de-gtitle value="${esc(g.title || "")}" placeholder="${esc(P.groupTitle(g, null))}" maxlength="40" aria-label="まとまりの見出し"></label></div>`;
  }
  /** ダッシュボードのスライサーに従うか（版 3.41.0） */
  const sliceRow = () => `<div class="de-row"><span class="de-l">連動</span><label class="pv-ck" title="道具の行のスライサー（期間・設備）で、このパネルも切り替えます。外すと、組んだ期間・設備のまま"><input type="checkbox" data-de-slice${p.noslice ? "" : " checked"}>ダッシュボードのスライサーに従う</label></div>`;
  /* ---- 書式（版 3.39.0。要望 7・8）: 数値ラベル・横軸（日付の形・字の向き）・数の形（桁・単位）・縦軸の範囲・凡例・補助線・字の大きさ・基準線・色 ---- */
  /** いまの答えの系列（色を決められる名前）: 列の段があれば列の葉、1 系列で行が少なければ行の葉、ほかは値 */
  function seriesNames() {
    const d = host.answer && host.answer();
    if (!d || !d.cells || !d.dims) return [];
    const m = C.buildModel(d, { sub: false, grand: false });
    if (m.nc) return m.cols.filter((c) => c.type === "data").slice(0, 12).map((c) => m.colName(c));
    const rows = m.rows.filter((r) => r.type === "data");
    if (["column", "bar", "lollipop", "donut", "treemap", "pareto", "bubble", "box", "violin"].includes(p.visual) && rows.length <= 16) return rows.map((r) => m.rowName(r));
    return d.measures.map((x) => P.measName(x));
  }
  function fmtHtml() {
    if (inGroup() || isOps(p)) return "";                    // 稼働の形は数の書式を使わない（稼働率・換算係数は決まった形）
    const fm = p.fmt || {}, kpi = p.visual === "kpi", tableish = isBoard() || p.visual === "none";
    const sel = (name, list, cur, label) => `<select data-de-f${name} aria-label="${esc(label)}">${list.map(([k, n]) => `<option value="${k}"${String(cur ?? "") === k ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
    const digits = sel("digits", [["", "自動"], ["0", "整数"], ["1", "0.1"], ["2", "0.01"], ["3", "0.001"]], fm.digits == null ? "" : String(fm.digits), "小数の桁");
    const head = `<button type="button" class="de-fmthead" data-de-fmtopen aria-expanded="${fmtOpen}"><b>書式</b><small>${fmtSummary(fm)}</small><i aria-hidden="true">${fmtOpen ? "▴" : "▾"}</i></button>`;
    if (!fmtOpen) return head;
    if (kpi || tableish) return head + `<div class="de-fmt">${numFmtHtml(fm, digits, sel)}${alignHtml(fm, kpi)}</div>`;
    const pal = P.PALETTES, cur = fm.palette || "";
    const palBtn = (k, n, cs) => `<button type="button" class="de-pal${cur === k ? " on" : ""}" data-de-pal="${k}" aria-pressed="${cur === k}" title="${esc(n)}"><span>${cs.slice(0, 5).map((c) => `<i style="background:${c}"></i>`).join("")}</span>${esc(n)}</button>`;
    const pals = palBtn("", "データの種類", P.seriesColors({ source: p.source })) + Object.entries(pal).map(([k, x]) => palBtn(k, x.n, x.c)).join("");
    // 合わせたデータは役割の色（グラフ・札と同じ。3 回目の採点: 見本だけ別の色だった）
    const d0 = host.answer && host.answer();
    const names = seriesNames(), colors = isLink() && d0 && d0.measures ? d0.measures.map((x) => P.ROLE_COLOR[x.role] || "#5a6f77") : P.seriesColors(p);
    // 系列ごと（版 3.41.0。利用者の要望 1: 個別に詳細も決める）: 色（見本は描いた色そのもの）・数値ラベル（パネルの数値に従う・上・下・出さない）・線（実線・破線）
    const lineish = LINE_VIS.has(p.visual), combo = COMBO_VIS.has(p.visual);
    const group = (name, html) => `<span class="de-sgrp"><small>${name}</small>${html}</span>`;
    const AUTO_NAME = { bar: "棒", line: "線", area: "面", left: "左", right: "右" };
    // 手で決めた系列は「自動」とだけ（「線」を押したのに「自動（線）」も並ぶと、差が分からない: 2026-10-combo の 2 回目の採点）
    const autoOf = (list, cur, chosen) => list.map(([k, n]) => (k === "" && !chosen && AUTO_NAME[cur] ? [k, `自動（${AUTO_NAME[cur]}）`] : [k, n]));
    const named = names.length ? `<div class="de-sers" role="table" aria-label="系列ごとの書式">${names.map((n, i) => {
      const c = (fm.colors || {})[n], sf = (fm.series || {})[n] || {}, shown = c || (isLink() ? colors[i % colors.length] : P.drawnColor(p.id, n) || colors[i % colors.length]);
      const set = c || sf.label || sf.dash || sf.kind || sf.axis, drawnS = P.drawnSeries(p.id, n) || {};
      // 組み合わせは、名前の行の右端に、いま描いている形の印（系列の色。グラフの凡例と同じ印）と目盛り（2026-10-combo の 3 回目で決めた E）
      const kNow = sf.kind || drawnS.kind, aNow = sf.axis || drawnS.axis;
      const now = combo && SER_ICON[kNow] ? `<span class="de-snow" title="「${esc(n)}」は${AUTO_NAME[kNow]}で、${aNow === "right" ? "右" : "左"}の目盛りに描いています">${SER_ICON[kNow](shown)}<b>${AUTO_NAME[kNow]}・${aNow === "right" ? "右" : "左"}の目盛り</b></span>` : "";
      return `<div class="de-ser${set ? " is-set" : ""}" role="row" data-de-ser="${esc(n)}"><label class="de-scol" title="「${esc(n)}」の色"><input type="color" value="${shown}" data-de-scol="${esc(n)}" aria-label="「${esc(n)}」の色"><span>${esc(n)}</span>${now}</label>`
        // 札の組には見出し（形・目盛り・数値・線）。「自動」は、いま描いている形・目盛りを添える（自動（棒）。2026-10-combo の 1 回目の採点: 推測させた）
        + (combo ? group("形", segs(`skind-${i}`, autoOf(SER_KINDS, drawnS.kind, sf.kind), sf.kind || "", `「${n}」の形`).replace(/data-de-skind-\d+/g, "data-de-skind"))
          + group("目盛り", segs(`saxis-${i}`, autoOf(SER_AXES, drawnS.axis, sf.axis), sf.axis || "", `「${n}」の目盛り`).replace(/data-de-saxis-\d+/g, "data-de-saxis")) : "")
        + group("数値", segs(`slab-${i}`, SER_LABELS, sf.label || "", `「${n}」の数値ラベル`).replace(/data-de-slab-\d+/g, "data-de-slab"))
        // 線（実線・破線）は線・面で描く系列だけ（棒には効かないので出さない）
        + ((lineish && !combo) || (combo && (sf.kind || drawnS.kind) && (sf.kind || drawnS.kind) !== "bar") ? group("線", segs(`sdash-${i}`, SER_DASH, sf.dash ? "1" : "", `「${n}」の線`).replace(/data-de-sdash-\d+/g, "data-de-sdash")) : "")
        + (set ? `<button type="button" class="dk-icon" data-de-serx="${esc(n)}" aria-label="「${esc(n)}」の書式を戻す" title="この系列の色・ラベル・線を既定に戻す">×</button>` : "") + "</div>";
    }).join("")}</div>` : '<small class="de-hint">数え終えると、系列の名前が並びます</small>';
    const refs = (fm.refs || []).map((r, i) => `<div class="de-ref" data-i="${i}"><input type="number" step="any" value="${r.value}" data-de-refv aria-label="基準線の値" class="de-n2"><input value="${esc(r.label || "")}" data-de-refl maxlength="20" placeholder="名前（目標・上限など）" aria-label="基準線の名前">`
      + `<span class="de-sws">${REF_COLORS.map((c) => `<button type="button" class="de-sw${(r.color || REF_COLORS[0]) === c ? " on" : ""}" style="--sw:${c}" data-de-refc="${c}" aria-label="色 ${c}"></button>`).join("")}</span><button type="button" class="dk-icon" data-de-refdel="${i}" aria-label="この基準線を外す">×</button></div>`).join("");
    return head + `<div class="de-fmt">`
      + `<div class="de-row"><span class="de-l">数値</span>${segs("flabels", LINE_VIS.has(p.visual) ? LINE_LABELS : LABELS, fm.labels || "", "数値ラベル")}<small class="de-hint">系列ごとには下の「系列」で</small></div>`
      + `<div class="de-row"><span class="de-l">横軸</span>${sel("xdate", XDATES, fm.xdate || "", "横軸の日付の形")}${segs("fxrot", XROTS, fm.xrot || "", "横軸の字の向き")}</div>`
      + numFmtHtml(fm, digits, sel)
      + `<div class="de-row"><span class="de-l">縦軸</span><label class="pv-ck">最小<input type="number" step="any" data-de-fymin value="${fm.ymin ?? ""}" placeholder="自動" class="de-n2"></label><label class="pv-ck">最大<input type="number" step="any" data-de-fymax value="${fm.ymax ?? ""}" placeholder="自動" class="de-n2"></label>`
      + `<label class="pv-ck"><input type="checkbox" data-de-fgrid${fm.grid === false ? "" : " checked"}>補助線</label></div>`
      + `<div class="de-row"><span class="de-l">凡例</span>${segs("flegend", LEGENDS, fm.legend || "", "凡例")}<span class="de-l2">字</span>${segs("fsize", SIZES, fm.size || "", "字の大きさ")}</div>`
      + `<div class="de-row de-top"><span class="de-l">基準線</span><div class="de-refs">${refs}<button type="button" class="pv-btn" data-de-refadd${(fm.refs || []).length >= 4 ? " disabled" : ""}>＋ 基準線（目標・規格）</button></div></div>`
      + `<div class="de-row de-top"><span class="de-l">色の組</span><div class="de-pals">${pals}</div></div>`
      + `<div class="de-row de-top"><span class="de-l">系列</span>${named}</div></div>`;
  }
  /** 表示形式の要約（言葉で。書式の符号は Excel を知らないと読めない: 2026-10-numfmt の 1 回目の指摘）。ユーザー定義はコードのまま */
  function numWords(fm) {
    const ui = fm.numUi || { cat: "custom" }, name = (N.CATS.find((c) => c[0] === ui.cat) || ["", "表示形式"])[1];
    if (ui.cat === "custom") return `ユーザー定義 ${fm.num.length > 16 ? fm.num.slice(0, 16) + "…" : fm.num}`;
    const div = (DIVS.find((x) => x[0] === fm.unit) || ["", ""])[1];
    return [name, ui.dec ? `小数 ${ui.dec} 桁` : "整数", div && fm.unit ? `${div}で割る` : "", ui.neg && ui.neg !== "minus" ? `負の数 ${(N.NEGS.find((x) => x[0] === ui.neg) || ["", ""])[1]}` : "",
      ui.pre ? `前に「${ui.pre}」` : "", ui.suf ? `後ろに「${ui.suf}」` : ""].filter(Boolean).join("・");
  }
  /** 書式の要約（畳んだときに、何が効いているかを見せる） */
  function fmtSummary(fm) {
    const out = [];
    if (fm.labels) out.push(`数値 ${(LABELS.find((x) => x[0] === fm.labels) || ["", ""])[1]}`);
    if (fm.xdate) out.push(`日付 ${(XDATES.find((x) => x[0] === fm.xdate) || ["", ""])[1]}`);
    if (fm.num) out.push(numWords(fm));
    else if (fm.digits != null || fm.unit) out.push("数の形");
    if (fm.utext != null) out.push(fm.utext ? `単位「${fm.utext}」` : "単位なし");
    if (fm.align || fm.valign) out.push("配置");
    if (fm.nsize || fm.bold || fm.ncolor) out.push("字");
    if (fm.ymin != null || fm.ymax != null) out.push("縦軸");
    if ((fm.refs || []).length) out.push(`基準線 ${fm.refs.length}`);
    if (fm.palette) out.push(P.PALETTES[fm.palette].n);
    if (fm.colors && Object.keys(fm.colors).length) out.push(`色 ${Object.keys(fm.colors).length}`);
    if (fm.series && Object.keys(fm.series).length) out.push(`系列 ${Object.keys(fm.series).length}`);
    return out.length ? esc(out.join("・")) : "既定のまま";
  }
  /** 表示形式（版 3.43.0。Excel の「表示形式」）: 分類 → 小数・桁区切り・負の数・前後の字・単位で割る（ユーザー定義はコードを書く）と見本 */
  function numFmtHtml(fm, digits, sel) {
    // 2026-10-numfmt の 3 回目で決めた S: 見本の表を頭に → 分類の札 → 細かい所は「名前と欄」の組を 2 つずつ並べる格子（名前の列は左にそろえる）
    const ui = fm.numUi || (fm.num ? { cat: "custom", code: fm.num } : { cat: "" }), cat = ui.cat || "";
    const pair = (label, ctl, label2 = "", ctl2 = "") => `<span class="de-gl">${label}</span><span class="de-gc">${ctl}</span>`
      + (label2 ? `<span class="de-gl de-gl2">${label2}</span><span class="de-gc">${ctl2}</span>` : '<span class="de-gfill"></span>');
    const wide = (label, ctl) => `<span class="de-gl">${label}</span><span class="de-gc de-gwide">${ctl}</span>`;
    const head = `<div class="de-nsbox"><b>見本</b><span id="deNumSample">${numSample(fm)}</span></div>`
      + `<div class="de-ngrid">${calcRows(fm, wide)}${wide("表示形式", segs("fncat", N.CATS, cat, "表示形式の分類"))}`;
    if (!cat) return head + pair("単位", sel("unit", UNITS, fm.unit || "", "単位"), "小数", digits) + "</div>";
    const decSel = sel("ndec", [0, 1, 2, 3, 4, 5, 6].map((n) => [String(n), n ? `${n} 桁` : "整数"]), String(ui.dec ?? 0), "小数の桁");
    const divSel = sel("unit", DIVS, fm.unit && fm.unit !== "none" ? fm.unit : "", "千・万で割る（千・万・百万・億）");
    const txt = (k, v, ph, label) => `<input class="de-n2 de-ntx" data-de-n${k} value="${esc(v || "")}" maxlength="12" placeholder="${esc(ph)}" aria-label="${esc(label)}">`;
    if (cat === "custom") {
      return head + pair("千・万で割る", divSel)
        + wide("コード", `<div class="de-ncode"><input class="de-ncodein" data-de-ncode value="${esc(fm.num || "")}" maxlength="160" spellcheck="false" placeholder='例: #,##0"本";[赤]"▲"#,##0' aria-label="書式コード（Excel と同じ）">`
          + `<span class="de-nex">${CODE_EXAMPLES.map((c) => `<button type="button" class="de-chip" data-de-nex="${esc(c)}" title="このコードにする">${esc(c)}</button>`).join("")}</span>`
          + '<small class="de-hint">Excel と同じ書き方: 正;負;0;文字 の区分・0 # ? , . % E+00・"字"・[赤] [青]・[>=100] の条件</small></div>') + "</div>";
    }
    let out = head + pair("千・万で割る", divSel, "小数", decSel);
    if (cat === "num" || cat === "cur") {
      // 負の数は見本の札（その形で書いた -1234。赤の形は「赤」の字も添える: 色だけで区別しない）
      const negs = N.NEGS.map(([k]) => {
        const f = N.format(-1234, N.build({ cat: "num", dec: 0, sep: true, neg: k })), red = /red/.test(k);
        return [k, f.text, red];
      });
      const negSegs = `<span class="de-segs de-negs" role="radiogroup" aria-label="負の数の形">${negs.map(([k, t, red]) => `<label class="de-seg${(ui.neg || "minus") === k ? " on" : ""}${red ? " is-red" : ""}"><input type="radio" name="de-fnneg" value="${k}" data-de-fnneg${(ui.neg || "minus") === k ? " checked" : ""}>${esc(t)}${red ? "<small>赤</small>" : ""}</label>`).join("")}</span>`;
      out += pair("桁区切り", `<label class="pv-ck"><input type="checkbox" data-de-nsep${ui.sep === false ? "" : " checked"}>1,234 のように区切る</label>`) + wide("負の数", negSegs);
    }
    // 数字のパネルは、後ろの字（単位）を上の「単位」の 1 か所で決める（2 か所あると、どちらが効くか迷った: 2026-10-dashedit の 1 回目）
    const pre = txt("pre", cat === "cur" ? ui.pre ?? "¥" : ui.pre, cat === "cur" ? "¥" : "例: 約", "数の前に付ける字");
    return out + (p.visual === "kpi" ? pair("前に", pre) : pair("前に", pre, "後ろに", txt("suf", ui.suf, "例: 本・kg・件", "数の後ろに付ける字（単位）"))) + "</div>";
  }
  /** 単位（版 3.45.0。利用者の要望 3）: 数字の後ろに添える字（数字の形だけ。いまの字をそのまま欄に出し、直すとその字に。空にすると出さない・
      「自動に戻す」で本・ロット・件）。計算（四則演算）は版 3.50.0 から値ごとに、② 数え方の「値の計算」の段で決める（pivot-calc.js） */
  function calcRows(fm, wide) {
    if (isBoard() || p.visual !== "kpi") return "";
    const auto = P.autoUnit({ ...p, fmt: { ...fm, utext: undefined } }, (p.body && p.body.measures || [])[0] || { agg: "lots" });
    return wide("単位", `<span class="de-unit"><input class="de-ntx" data-de-futext value="${esc(fm.utext ?? ((fm.numUi && fm.numUi.suf) || auto))}" maxlength="12" placeholder="${unitHint(fm)}" aria-label="数字の後ろに添える単位">`
      + unitSide(fm, auto) + "</span>");
  }
  /** 単位の欄の薄い字: 表示形式に字（後ろに「本」など）があれば、そちらを使っていると言う */
  const unitHint = (fm) => (fm.num && N.hasLiteral(fm.num) ? "（表示形式の字を使っています）" : "（出さない）");
  /** 表示形式を変えた後、単位の欄（自動のとき）を今の自動の字にそろえる（打っている欄の書式を描き直さないときも） */
  function syncUnit() {
    const u = $("#dashEditor [data-de-futext]"), fm = p.fmt || {};
    if (!u || fm.utext != null || document.activeElement === u) return;
    u.value = P.autoUnit({ ...p, fmt: { ...fm, utext: undefined } }, (p.body.measures || [])[0] || { agg: "lots" }); u.placeholder = unitHint(fm);
  }
  const unitSide = (fm, auto) => (fm.utext != null ? `<button type="button" class="de-link" data-de-futextx title="データに合わせた単位（${esc(auto || "なし")}）に戻す">自動に戻す</button>` : '<small class="de-hint">自動</small>');
  /** 見本: いまの答えの数（無ければ 1234.5）と、負の数・0 を、いまの表示形式で（表: いまの数・負の数・0） */
  function numSample(fm) {
    const d = host.answer && host.answer(), cell0 = d && d.cells && d.cells.find((x) => !x.r.length && !x.c.length);
    const fx = N.expr(fm.expr || "").fn, raw = cell0 && typeof cell0.v[0] === "number" ? cell0.v[0] : 1234.5;
    const v = fx ? fx(raw) ?? raw : raw;      // 計算を当てた数（書式の見本も、パネルに出る数で）
    const warn = fm.num ? N.check(fm.num) : [];
    const vals = [v, -Math.abs(v) || -1234.5, 0];
    const u = p && p.visual === "kpi" ? P.autoUnit({ ...p, fmt: fm }, (p.body.measures || [])[0] || { agg: "lots" }) : "";   // 数字のパネルは単位も添えて（パネルに出る形）
    return `<table class="de-nstbl"><tr>${["いまの数", "負の数", "0"].map((h, i) => `<th title="${esc(C.fmt(vals[i]))}">${h}</th>`).join("")}</tr>`
      + `<tr>${vals.map((x) => `<td>${C.numHtml(x, fm)}${u ? `<small>${u}</small>` : ""}</td>`).join("")}</tr></table>` + (warn.length ? `<em class="de-nwarn">${esc(warn.join("・"))}</em>` : "");
  }
  /** 配置と字（版 3.43.0。数字・表・合わせた表）: 横（左・中央・右）・縦（数字だけ）・字の大きさ・太字・色。表示形式と同じ格子に並べる */
  function alignHtml(fm, kpi) {
    return '<div class="de-ngrid">'
      // 横と縦は 1 行（作った後の採点: 1280 で下の「字」の行が送らないと見えなかった）
      + `<span class="de-gl">配置 横</span><span class="de-gc${kpi ? "" : " de-gwide"}">${segs("falign", [["", "自動"], ...ALIGNS], fm.align || "", "横の配置")}</span>`
      + (kpi ? `<span class="de-gl de-gl2">縦</span><span class="de-gc">${segs("fvalign", [["", "自動"], ...VALIGNS], fm.valign || "", "縦の配置")}</span>` : "")
      + `<span class="de-gl">字</span><span class="de-gc de-gwide">${segs("fnsize", NSIZES, fm.nsize || "", "字の大きさ")}`
      + `<label class="pv-ck"><input type="checkbox" data-de-fbold${fm.bold === "off" ? "" : " checked"}>太字</label>`
      + `<label class="de-ncol" title="数の字の色（表示形式の [赤] などがあれば、そちらが先）"><input type="color" data-de-fncolor value="${fm.ncolor || "#1f2933"}" aria-label="数の字の色">色</label>`
      + (fm.ncolor ? '<button type="button" class="pv-btn" data-de-fncolorx>色を戻す</button>' : "") + "</span></div>";
  }
  /** 表示形式の選び（numUi）を変えて、コード（num）を組み直す */
  function setNum(change) {
    const fm = p.fmt || {}, was = fm.numUi || (fm.num ? { cat: "custom", code: fm.num } : { cat: "" });
    let ui = { ...was, ...change };
    if (change.cat !== undefined && change.cat !== was.cat) {      // 分類を替えたときの初め（Excel の分類を替えたときと同じ見当）
      const code = fm.num || "";
      ui = change.cat === "custom" ? { cat: "custom", code: code || "#,##0" }
        : { cat: change.cat, dec: change.cat === "pct" ? 1 : change.cat === "sci" ? 2 : was.dec || 0, sep: true, neg: "minus", pre: change.cat === "cur" ? "¥" : "", suf: was.suf || "" };
    }
    const next = { ...fm };
    if (!ui.cat) { delete next.num; delete next.numUi; }
    else {
      const code = N.build(ui);
      if (code) next.num = code; else delete next.num;
      next.numUi = ui.cat === "custom" ? { cat: "custom" } : { cat: ui.cat, dec: +ui.dec || 0, sep: ui.sep !== false, neg: ui.neg || "minus", pre: ui.pre || "", suf: ui.suf || "" };
      if (ui.cat === "custom") next.numUi.code = ui.code;
      if (next.unit === "" || next.unit === "auto") delete next.unit;
    }
    if (JSON.stringify(next) === JSON.stringify(fm)) return;     // 同じなら描き直さない（欄を離れた時の確定で、押した欄が作り替えられて押したのが消えないように）
    if (Object.keys(next).length) p.fmt = next; else delete p.fmt;
    changed(false);
    // 分類を替えたら、ほかの欄に焦点が残っていても書式の欄を描き直す（分類ごとに欄が違う）
    if (change.cat !== undefined && change.cat !== was.cat && $("#deFmt")) $("#deFmt").innerHTML = fmtHtml();
  }
  /** 書式を 1 つ変える（既定に戻す物は消す） */
  function setFmt(k, v) {
    const fm = { ...(p.fmt || {}) };
    if (v === "" || v == null || (k === "grid" && v === true)) delete fm[k]; else fm[k] = v;
    if (Object.keys(fm).length) p.fmt = fm; else delete p.fmt;
    changed(false);
  }
  function sortHtml() {
    if (t.visual === "kpi" || inGroup() || isOps(t)) return "";
    // 小計（版 3.40.0。要望 5）: 表で行の段が 2 つ以上（設備グループ → 設備 など）
    return `<div class="de-row"><label class="de-l">並べ方</label><select data-de-sort aria-label="並べ方">${[["", "決まった順（名前・日付）"], ["desc", "値の大きい順"], ["asc", "値の小さい順"]].map(([k, n]) => `<option value="${k}"${(p.sort || "") === k ? " selected" : ""}>${n}</option>`).join("")}</select>`
      + `<label class="pv-ck" title="0＝パネルに入るだけ">上位<input type="number" min="0" max="60" data-de-top value="${p.top || 0}" class="de-n" aria-label="上位いくつ（0＝パネルに入るだけ）"></label><small class="de-hint">0＝入るだけ</small></div>`;
  }
  /* ---- 設備（版 3.39.0。要望 2・9）: 複数選ぶ（チェックの並び。dashboard-filter.js と同じ部品）と、まとめる（合算・このパネルのグループ・マスタ） ---- */
  /** 設備を選ぶ物（ふつうのパネル・まとまり＝組む物 t、合わせた表の表全体＝パネル p） */
  const eqHost = () => (isBoard() && gi < 0 ? p : t);
  function setEquips(list) {
    const h = eqHost();
    if (list.length) h.equips = list; else delete h.equips;
    if (h === t && inGroup()) pushGroup();
    changed(false);
  }
  const eqText = (list) => (!list || !list.length ? "すべての設備" : `${list.slice(0, 3).map(WL.dashKit.equipWord).join("・")}${list.length > 3 ? ` ほか ${list.length - 3}` : ""}`);
  /** 選べる設備（その元で数えた設備と件数。元ごとに 1 回） */
  async function loadEquips() {
    const base = isBoard() && gi < 0 ? (p.groups[0] || {}) : t, key = JSON.stringify([base.source, base.equip || "", base.filters || []]);
    if (eqKey === key && eqItems) return;
    eqKey = key; eqItems = null;
    try { const items = await Q.equipsOf({ ...base, visual: "none" }); if (eqKey === key) eqItems = items; } catch (_) { if (eqKey === key) eqItems = []; }
    paint(false);
  }
  function equipHtml() {
    const h = eqHost(), list = h.equips || [];
    const can = isBoard() && gi < 0 ? (p.rows || {}).column === "@equip" : !!(srcOf(t.source) || {}).equip;
    if (!can) return "";
    const picker = eqOpen ? `<div class="de-eqbox">${eqItems ? Q.checklistHtml(eqItems, new Set(list), { name: "deq", all: "すべての設備" }) : '<p class="dfl-none">設備を数えています…</p>'}</div>` : "";
    return `<div class="de-row"><span class="de-l">設備</span><button type="button" class="de-eqbtn${list.length ? " is-on" : ""}" data-de-eqopen aria-expanded="${eqOpen}" title="数える設備を選びます（複数選べます）">${esc(eqText(list))}<i aria-hidden="true">${eqOpen ? "▴" : "▾"}</i></button>`
      + (list.length ? `<button type="button" class="dfl-link" data-de-eqall>すべてに戻す</button>` : "") + `</div>${picker}${eorderHtml()}`;
  }
  /* ---- 設備の並び（版 3.48.0。利用者の要望 2026-10-21 の 3 回目の 3）: 決まった順（作業実績の設備の並び）か、手で並べた順（eorder）。
     表・グラフの設備の段・系列の順・並べる図・ガントの行・ABC の設備の札に効く（サーバーの with_eorder・order_parts）。合わせた表は「表全体」の並び ---- */
  /** 並べる設備（選んだ設備か、その元のすべての設備）を、いまの手で並べた順に */
  function eorderKeys() {
    const base = (p.equips || []).length ? p.equips.slice() : (eoAll || []).map((x) => x.value);
    const eo = p.eorder || [], at = new Map(eo.map((n, i) => [n, i]));
    return base.map((n, i) => [n, i]).sort((a, b) => (at.has(a[0]) ? at.get(a[0]) : 1e6 + a[1]) - (at.has(b[0]) ? at.get(b[0]) : 1e6 + b[1])).map((x) => x[0]);
  }
  /** 並べる設備を読む（期間・条件で絞らない: その期間に作業の無い設備もガントの行・表の行に出るので、並べられるように） */
  async function loadEoAll() {
    const key = JSON.stringify([t.source, t.equip || ""]);
    if (eoKey === key && eoAll) return;
    eoKey = key; eoAll = null;
    try { const items = await Q.equipsOf({ source: t.source, equip: t.equip || "", calc: t.calc, visual: "none" }); if (eoKey === key) eoAll = items; } catch (_) { if (eoKey === key) eoAll = []; }
    paint(false);
  }
  function eorderHtml() {
    if (isBoard() || inGroup() || inSide()) return "";
    const hand = (p.eorder || []).length > 0, keys = hand ? eorderKeys() : [];
    // 枠で囲んだ番号つきの表（2026-10-dash8 の 2 回目で決めた J）: ⋮⋮（引いて並べる）・番号・名前・↑↓ を 1 行に。13 台からは 2 段組み（上から下へ読む）
    const chips = hand ? `<div class="de-row de-top"><span class="de-l"></span>${keys.length ? `<ol class="de-eord${keys.length > 12 ? " is-many" : ""}" aria-label="設備の並び（⋮⋮ を引くか ↑↓ で並べる）">${keys.map((n, i) => `<li class="de-eoc" data-de-eoname="${esc(n)}"><span class="de-grip" data-de-eogrip title="引いて並べる" aria-hidden="true">⋮⋮</span><i class="de-eon">${i + 1}</i><b>${esc(n)}</b>`
      + `<button type="button" class="dk-icon" data-de-eomove="${i}" data-d="-1" aria-label="「${esc(n)}」を上へ（1 つ前）"${i ? "" : " disabled"}>↑</button><button type="button" class="dk-icon" data-de-eomove="${i}" data-d="1" aria-label="「${esc(n)}」を下へ（1 つ後ろ）"${i < keys.length - 1 ? "" : " disabled"}>↓</button></li>`).join("")}</ol>`
      : '<small class="de-hint">設備を数えています…</small>'}</div>` : "";
    return `<div class="de-row"><span class="de-l">並び</span>${segs("eord", [["", "決まった順", "作業実績の設備の並び（マスタ管理で決めた順）・データ元は名前の順"], ["hand", "手で並べる", "設備の順を ⋮⋮ を引くか ↑↓ で決めます（表・グラフ・系列・ガントの行・ABC の設備）"]], hand ? "hand" : "", "設備の並び")}`
      + `<small class="de-hint">${isOps(p) ? (p.visual === "gantt" ? "ガントの行の順" : "設備の札の順") : hand ? "値の大きい順にしていれば、そちらが先です" : "設備の段・系列の順"}</small></div>${chips}`;
  }
  // 設備の出し方（版 3.40.0。利用者の要望 1: まとめないのに勝手に合算された）。絵つきの札で、出し方の違いを見て選ぶ
  // 言葉は形と合わせる（「重ねる」は積み上げの棒に見えて食い違った: 2026-10-dashlink の 2 回目の採点）
  const SPLITS = [["series", "系列に分ける", "設備ごとの系列（グラフは設備ごとの色の棒・線、表は設備ごとの列）", "M3 16V9h2v7M7 16V6h2v10M11 16v-5h2v5M15 16V4h2v12"],
    ["facet", "図を並べる", "設備ごとに小さな表・グラフを並べる（縦軸は同じ）", "M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z"],
    ["sum", "合算", "選んだ設備（選ばなければすべて）を合わせて 1 つ", "M4 16V5h12v11"],
    ["group", "グループ合算", "グループ（このパネルで作る・マスタの設備グループ）ごとに合わせる", "M3 16V8h5v8M12 16V4h5v12M3 6h5M12 2h5"]];
  const EG_SRCS = [["panel", "このパネルで作る"], ["master", "設備グループのマスタ"]];
  const EG_RESTS = [["keep", "そのまま 1 台ずつ出す"], ["other", "「その他の設備」にまとめる"], ["hide", "出さない"]];
  /** 設備のまとめ（合わせた表は表全体、ふつうのパネルは設備の段があるときに効く） */
  /** いまの出し方（サーバーの dashboard.split_of と同じ決め方） */
  function splitOf() {
    const eg = p.egroup || {};
    if (eg.mode === "sum") return "sum";
    if (eg.mode === "panel" || eg.mode === "master") return "group";
    return p.esplit || ((p.equips || []).length >= 2 ? "series" : "sum");
  }
  const dimsOf = (b) => [...((b && b.rows) || []), ...((b && b.cols) || [])];
  function egroupHtml() {
    if (inGroup() || isLink() || isOps(p)) return "";       // 稼働の形は設備ごとの行（まとめない）
    const can = isBoard() ? (p.rows || {}).column === "@equip" : !!(srcOf(p.source) || {}).equip;
    if (!can) return "";
    const eg = p.egroup || { mode: "" }, sets = host.egroupSets ? host.egroupSets() : [];
    // 設備を行・列に置いた（要望 2）なら、それで設備ごとに出る。出し方の札の代わりに、どこに置いたかを言う
    const placed = !isBoard() && dimsOf(p.body).find((d) => d.column === "@equip" || d.column === "@egroup");
    const put = isBoard() ? "" : `<span class="de-eqput">${placed ? `<small class="de-hint">設備は「${(p.body.rows || []).includes(placed) ? "行" : "列"}」に置いています（${esc(dimLabel(placed))}ごとに出ます）</small>`
      : `<small class="de-hint">設備を</small><button type="button" class="pv-btn" data-de-eqput="rows" title="設備を行の段の頭に置きます（設備ごとの行）">行に置く</button><button type="button" class="pv-btn" data-de-eqput="cols" title="設備を列の段の頭に置きます（設備ごとの列・系列）">列に置く</button>`}</span>`;
    const cur = splitOf();
    const chips = isBoard() ? `<select data-de-egmode aria-label="設備をまとめる">${[["", "まとめない（1 台ずつ）"], ["sum", "選んだ設備を合算して 1 つに"], ["panel", "このパネルでグループを作って合算"], ["master", "設備グループのマスタから合算"]].map(([k, n]) => `<option value="${k}"${(eg.mode || "") === k ? " selected" : ""}>${n}</option>`).join("")}</select>`
      : `<span class="de-frames de-splits" role="radiogroup" aria-label="設備の出し方">${SPLITS.map(([k, n, tip, ico]) => `<label class="de-frame${cur === k ? " on" : ""}" title="${esc(tip)}"><input type="radio" name="de-split" value="${k}" data-de-split${cur === k ? " checked" : ""}><svg class="de-sico" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="${ico}"/></svg>${n}</label>`).join("")}</span>`;
    let body = "";
    if (!isBoard() && cur === "group") body = `<div class="de-row"><span class="de-l"></span>${segs("egsrc", EG_SRCS, eg.mode, "グループの決め方")}</div>`;
    if (eg.mode === "sum") body += `<div class="de-row"><span class="de-l"></span><label class="pv-ck">名前<input data-de-egname value="${esc(eg.name || "")}" placeholder="選んだ設備の計" maxlength="40" aria-label="合算した設備の名前"></label><small class="de-hint">${esc(eqText(eqHost().equips))}を 1 つの行（値）にします</small></div>`;
    if (eg.mode === "panel") {
      const all = (eqItems || []).map((x) => x.value), used = new Map();
      (eg.groups || []).forEach((g, k) => (g.members || []).forEach((m) => { if (!used.has(m)) used.set(m, k); }));
      body += (eg.groups || []).map((g, k) => `<div class="de-eg" data-k="${k}"><input data-de-eggname value="${esc(g.name)}" maxlength="40" aria-label="グループの名前" placeholder="グループ ${k + 1}">`
        + `<span class="de-egm">${(all.length ? all : g.members || []).map((n) => `<button type="button" class="dk-eq" data-de-egm="${esc(n)}" aria-pressed="${(g.members || []).includes(n)}"${used.has(n) && used.get(n) !== k ? ` title="グループ ${used.get(n) + 1} にも入っています（先のグループで数えます）"` : ""}>${esc(n)}</button>`).join("")}</span>`
        + `<button type="button" class="dk-icon" data-de-egdel="${k}" aria-label="グループ「${esc(g.name)}」を外す">×</button></div>`).join("")
        + `<div class="de-row"><span class="de-l"></span><button type="button" class="pv-btn" data-de-egadd>＋ グループ</button>${eqItems ? "" : '<small class="de-hint">設備を数えています…</small>'}</div>`;
    }
    if (eg.mode === "master") {
      const cur = sets.find((x) => x.name === eg.set);
      body += `<div class="de-row"><span class="de-l"></span><select data-de-egset aria-label="まとめ方">${sets.length ? "" : '<option value="">（設備グループがまだありません）</option>'}${sets.map((x) => `<option${x.name === eg.set ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`
        + `<small class="de-hint">マスタ管理の「設備グループ」で足す・直す（直すと、このパネルにもすぐ効きます）</small></div>`
        + (cur ? `<div class="de-row"><span class="de-l"></span><span class="de-egprev">${cur.groups.map((g) => `<span><b>${esc(g.name)}</b>${esc([...g.equipment, ...(g.rules || []).map(ruleText)].join("・"))}</span>`).join("")}</span></div>` : "");
    }
    const rest = eg.mode === "panel" || eg.mode === "master" ? `<div class="de-row"><span class="de-l"></span><label class="pv-ck">グループに入らない設備<select data-de-egrest>${EG_RESTS.map(([k, n]) => `<option value="${k}"${(eg.rest || "keep") === k ? " selected" : ""}>${n}</option>`).join("")}</select></label></div>` : "";
    if (placed) return `<div class="de-row"><span class="de-l">出し方</span>${put}</div>`;
    const why = isBoard() ? "" : `<small class="de-hint de-splitwhy">${esc((SPLITS.find((x) => x[0] === cur) || [null, null, ""])[2])}</small>`;
    return `<div class="de-row de-top"><span class="de-l">${isBoard() ? "まとめる" : "出し方"}</span><div class="de-splitbox">${chips}${why}${put}</div></div>${body}${rest}`;
  }
  const RULE_WORD = { prefix: "で始まる", suffix: "で終わる", contains: "を含む", equals: "と同じ", regex: "に当たる" };
  const ruleText = (r) => `「${r.value}」${RULE_WORD[r.op] || ""}`;
  function dataHtml() {
    const basis = isWork() ? `<select data-de-basis aria-label="作業日の数え方"><option value="work"${t.basis !== "cal" ? " selected" : ""}>現場歴</option><option value="cal"${t.basis === "cal" ? " selected" : ""}>太陽暦</option></select>` : "";
    const g = inSide() ? p.link.sides[gi] : null;
    // 合わせるデータ（版 3.40.0）: 役割（目標・実績）と作り方（そのまま・積み上げ）は、データの選びの上（何のデータかを先に決める）
    const side = g ? `<div class="de-row"><span class="de-l">役割</span>${segs(`role-${gi}`, ROLES, g.role || "", "役割")}<label class="pv-ck de-gt">名前<input data-de-stitle value="${esc(g.title || "")}" placeholder="${esc((srcOf(g.source) || {}).name || "")}" maxlength="40" aria-label="このデータの名前"></label></div>`
      + `<div class="de-row"><span class="de-l">作り方</span>${segs(`build-${gi}`, BUILDS, g.build || "as", "作り方")}<small class="de-hint">${g.build === "cum" ? "軸の並びに足していく（累計）" : "軸の値ごとの数のまま"}</small></div>` : "";
    return (!parts() && p.visual !== "board" ? linkPick() : "") + side + `<div class="de-row"><label class="de-l">データ</label><select data-de-src aria-label="データ">${sources.map((x) => `<option value="${esc(x.key)}"${x.key === t.source ? " selected" : ""}${x.place ? "" : " disabled"}>${esc(x.name)}${x.place ? "" : "（場所が未設定）"}</option>`).join("")}</select>${basis}</div>`
      + equipHtml() + egroupHtml();
  }
  /** 合わせた表の札（表全体・まとまり ①②…・＋） */
  function tabsHtml() {
    if (!parts()) return "";
    const n = "①②③④";
    if (isLink()) {
      const role = (r) => (ROLES.find((y) => y[0] === r) || [null, ""])[1];
      return `<div class="de-tabs" role="tablist" aria-label="合わせるデータ"><button type="button" role="tab" class="de-tab${gi < 0 ? " on" : ""}" aria-selected="${gi < 0}" data-de-tab="-1">全体<small>合わせ方・形</small></button>`
        + p.link.sides.map((g, i) => `<button type="button" role="tab" class="de-tab is-side${gi === i ? " on" : ""}" aria-selected="${gi === i}" data-de-tab="${i}" style="--gc:${ROLE_COLOR[g.role || ""]}"><i aria-hidden="true"></i>${n[i]} ${esc(g.role ? role(g.role) : g.title || "比べる")}<small>${esc(g.title && g.role ? g.title : (srcOf(g.source) || {}).name || "")}</small></button>`).join("")
        + (p.link.sides.length < MAX_GROUPS ? '<button type="button" class="de-tab is-add" data-de-gadd title="合わせるデータを足します（4 つまで）">＋ データ</button>' : "") + "</div>";
    }
    return `<div class="de-tabs" role="tablist" aria-label="合わせた表の組み"><button type="button" role="tab" class="de-tab${gi < 0 ? " on" : ""}" aria-selected="${gi < 0}" data-de-tab="-1">表全体<small>行・並び</small></button>`
      + p.groups.map((g, i) => `<button type="button" role="tab" class="de-tab${gi === i ? " on" : ""}" aria-selected="${gi === i}" data-de-tab="${i}" style="--gc:${g.color || P.colorOf(g.source)}"><i aria-hidden="true"></i>${n[i]} ${esc(g.title || P.groupTitle(g, null))}<small>${esc((srcOf(g.source) || {}).name || "")}</small></button>`).join("")
      + (p.groups.length < MAX_GROUPS ? '<button type="button" class="de-tab is-add" data-de-gadd title="データの数を横に足します（4 つまで）">＋ まとまり</button>' : "") + "</div>";
  }
  /** 表全体: 行の段・並び・隠す行（行の札。⋮⋮ を引くか ↑↓ で手で並べる） */
  function boardHtml() {
    const o = p.order, keys = rowKeys(), n = "①②③④";
    const by = [["value:desc", "値の大きい順"], ["value:asc", "値の小さい順"], ["name", "名前の順"], ["equip", "設備の並び（作業実績の設備の並び）"], ["manual", "手で並べた順"]];
    const cur = o.by === "value" ? `value:${o.dir}` : o.by;
    const rowsSel = `<select data-de-brows aria-label="行の段"><option value="@equip"${p.rows.column === "@equip" ? " selected" : ""}>設備</option>`
      + (p.rows.column !== "@equip" ? `<option selected>${esc(p.rows.column)}</option>` : "") + "</select>";
    // 行の札（版 3.41.0。利用者の要望 4）: 設備グループの見出しの下に並べる（見出しも引いて並べられる）。⋮⋮ を引くと、札の写し（ゴースト）が付いてきて、
    // 落とす所に線が出る。↑↓ でも 1 つずつ（グループの中で）
    const groups = []; keys.forEach((x, i) => { const g = groups[groups.length - 1]; if (!g || g.name !== x.group) groups.push({ name: x.group, items: [] }); groups[groups.length - 1].items.push({ ...x, i }); });
    const item = (x, k, n) => `<li class="de-rowi${x.hidden ? " is-hidden" : ""}" data-de-row="${esc(x.key)}" data-de-rg="${esc(x.group)}"><span class="de-grip" data-de-grip title="引いて並べる" aria-hidden="true">⋮⋮</span><b>${esc(x.key)}</b>`
      + `<button type="button" class="dk-icon" data-de-rup="${x.i}" aria-label="「${esc(x.key)}」を上へ"${k ? "" : " disabled"}>↑</button><button type="button" class="dk-icon" data-de-rdown="${x.i}" aria-label="「${esc(x.key)}」を下へ"${k < n - 1 ? "" : " disabled"}>↓</button>`
      + `<label class="pv-ck"><input type="checkbox" data-de-rshow${x.hidden ? "" : " checked"}>出す</label></li>`;
    const list = !keys.length ? '<li class="de-hint">数え終えると、行がここに並びます</li>'
      : groups.map((g) => (g.name ? `<li class="de-rgrp${g.name === P.NONE_GROUP ? " is-none" : ""}" data-de-rgrp="${esc(g.name)}">`
        + `<div class="de-rgh">${g.name === P.NONE_GROUP ? '<span class="de-grip is-off" aria-hidden="true"></span>' : '<span class="de-grip" data-de-grip title="引いてグループごと並べる" aria-hidden="true">⋮⋮</span>'}<b>${esc(g.name)}</b><small>${g.items.length} 台</small></div>`
        + `<ol class="de-rsub">${g.items.map((x, k) => item(x, k, g.items.length)).join("")}</ol></li>` : g.items.map((x, k) => item(x, k, g.items.length)).join(""))).join("");
    const sets = host.egroupSets ? host.egroupSets() : [];
    const tree = p.rows.column === "@equip" && sets.length ? `<div class="de-row"><label class="de-l">見出し</label><select data-de-btree aria-label="行を設備グループの見出しの下にまとめる">`
      + `<option value="">まとめない</option>${sets.map((x) => `<option${x.name === p.order.tree ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select><small class="de-hint">設備グループの見出しの下に行をまとめます（表にも見出しが出ます）</small></div>` : "";
    return `<div class="de-row"><label class="de-l">行</label>${rowsSel}<small class="de-hint">どのまとまりも、この段でそろえます</small></div>`
      + `<div class="de-row"><label class="de-l">並び</label><select data-de-border aria-label="行の並び">${by.map(([k, nm]) => `<option value="${k}"${k === cur ? " selected" : ""}>${nm}</option>`).join("")}</select>`
      + (o.by === "value" ? `<select data-de-bgroup aria-label="どのまとまりの計で">${p.groups.map((g, i) => `<option value="${i}"${o.group === i ? " selected" : ""}>${n[i]} ${esc(g.title || P.groupTitle(g, null))}の計</option>`).join("")}</select>` : "")
      + `</div>${tree}${sliceRow()}<div class="de-row de-top"><span class="de-l"></span><ol class="de-rows${groups.some((g) => g.name) ? " is-tree" : ""}" aria-label="行（⋮⋮ を引いて並べる・出すを外すと隠す）">${list}</ol></div>`;
  }
  function groupActsHtml() {
    if (!inGroup()) return "";
    const gs = parts(), what = isLink() ? "データ" : "まとまり";
    return `<div class="de-row de-gacts"><span class="de-l"></span><button type="button" class="pv-btn" data-de-gmove="-1"${gi ? "" : " disabled"}>← 左へ</button><button type="button" class="pv-btn" data-de-gmove="1"${gi < gs.length - 1 ? "" : " disabled"}>右へ →</button>`
      + `<button type="button" class="pv-btn is-danger" data-de-gdel${gs.length > (isLink() ? 2 : 1) ? "" : " disabled"}>この${what}を外す</button></div>`;
  }

  /* ---- 組む所の幅（版 3.45.0。利用者の要望 2: カラム名が切れて読めない → 組む所の幅と、カラムの欄の幅を引いて変える。この PC に覚える）----
     左の縁（.de-wgrip）を引くと組む所の幅、カラムの欄と右の境（.de-split）を引くとカラムの欄の幅。← →（Shift で大きく）でも、ダブルクリックで元の幅 */
  // 右（組み立て）の幅はいつも MAIN_MIN 以上: カラムの欄を広げると、組む所もその分だけ広がる（右を押し縮めると「出し方」の札が切れた: 2026-10-dashedit の自分の確かめ）
  const SIZE_KEY = "tpa.dash.editor.v1", W_DEF = 720, W_MIN = 600, FW_DEF = 210, FW_MIN = 170, MAIN_MIN = 480, PAD = 32;   // 既定（720・210）の右と同じ 480 を下限に
  const sizes = () => { const s = WL.dashKit.local.get(SIZE_KEY, {}) || {}; return { w: +s.w || W_DEF, fw: +s.fw || FW_DEF }; };
  const wMax = () => Math.max(W_MIN, innerWidth - 260);
  const fwMax = () => Math.max(FW_MIN, wMax() - MAIN_MIN - PAD);
  /** 覚えた幅 → 描く幅（窓に収め、右の組み立てに MAIN_MIN を残す） */
  function fit(s) {
    const fw = Math.max(FW_MIN, Math.min(s.fw, fwMax()));
    return { fw, w: Math.min(wMax(), Math.max(W_MIN, s.w, fw + MAIN_MIN + PAD)) };
  }
  function applySize(el = $("#dashEditor"), s = sizes()) {
    if (!el) return;
    const f = fit(s);
    el.style.width = `${f.w}px`; el.style.setProperty("--de-fw", `${f.fw}px`);
  }
  function saveSize(ch) {
    const s = { ...sizes(), ...ch };
    if (s.w === W_DEF) delete s.w;
    if (s.fw === FW_DEF) delete s.fw;
    WL.dashKit.local.set(SIZE_KEY, s); applySize();
    if (host && host.onResize) host.onResize();
  }
  /** 「⇔ 名前に合わせる」: いちばん長いカラム名が 1 行で入る幅まで、カラムの欄を一度で広げる（窓に入る所まで。組む所もその分広がる） */
  function fitColumns() {
    const el = $("#dashEditor"), names = $$("#deFields .pv-f > span > b", el); if (!names.length) return;
    el.classList.add("de-measure");                  // 折り返さずに測る
    const over = Math.max(0, ...names.map((b) => b.scrollWidth - b.clientWidth));
    el.classList.remove("de-measure");
    const f = fit(sizes()), fw = Math.max(FW_MIN, Math.min(fwMax(), f.fw + over + 8));
    saveSize({ fw, w: Math.max(f.w, fw + MAIN_MIN + PAD) });
    if (fw < f.fw + over + 8) host.toast("窓に入る幅まで広げました（長い名前は 2 行で出します）");
  }
  function bindSize(el) {
    let drag = null;
    el.addEventListener("pointerdown", (e) => {
      const g = e.target.closest(".de-wgrip,.de-split"); if (!g || e.button !== 0) return;
      e.preventDefault(); g.setPointerCapture(e.pointerId);
      const f = fit(sizes());
      drag = { g, x: e.clientX, w: f.w, fw: f.fw, wide: g.classList.contains("de-wgrip") };
      document.body.classList.add("de-sizing");
    });
    el.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (drag.wide) drag.now = { w: Math.round(Math.max(W_MIN, drag.fw + MAIN_MIN + PAD, Math.min(wMax(), drag.w - dx))) };    // 左の縁: 左へ引くと広がる
      else { const fw = Math.round(Math.max(FW_MIN, Math.min(fwMax(), drag.fw + dx))); drag.now = { fw, w: Math.max(drag.w, fw + MAIN_MIN + PAD) }; }   // 境: 組む所も広がる
      applySize(el, { ...sizes(), ...drag.now });
    });
    const end = () => { if (!drag) return; const n = drag.now; drag = null; document.body.classList.remove("de-sizing"); if (n) saveSize(n); };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    el.addEventListener("dblclick", (e) => { const g = e.target.closest(".de-wgrip,.de-split"); if (g) saveSize(g.classList.contains("de-wgrip") ? { w: W_DEF } : { fw: FW_DEF }); });
    el.addEventListener("keydown", (e) => {
      const g = e.target.closest(".de-wgrip,.de-split"); if (!g || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      const f = fit(sizes()), step = (e.shiftKey ? 64 : 16) * (e.key === "ArrowLeft" ? -1 : 1);
      if (g.classList.contains("de-wgrip")) saveSize({ w: Math.max(W_MIN, f.fw + MAIN_MIN + PAD, Math.min(wMax(), f.w - step)) });
      else { const fw = Math.max(FW_MIN, Math.min(fwMax(), f.fw + step)); saveSize({ fw, w: Math.max(f.w, fw + MAIN_MIN + PAD) }); }
    });
  }
  /** 欄に字を打っている間は、その欄のまとまりを描き直さない（打っている字・カーソルを失わない）。押す札・選ぶ欄は描き直す */
  const typingIn = (sel) => { const a = document.activeElement; return !!(a && a.closest(sel) && a.matches("input:not([type=checkbox]):not([type=radio]):not([type=color]),textarea")); };
  function paint(repaintFields = true) {
    const el = $("#dashEditor"); if (!el || !p) return;
    if (!el.firstChild) {
      el.innerHTML = '<i class="de-wgrip" role="separator" aria-orientation="vertical" tabindex="0" aria-label="組む所の幅" title="引いて組む所の幅を変える（← → でも。ダブルクリックで元の幅）"></i>'
        + `<div class="de-head" data-drag><b>パネルを組む</b><input id="deTitle" class="de-title" autocomplete="off" aria-label="題" maxlength="60">`
        + `<span class="dash-sp"></span><button type="button" class="mm-btn-ghost" data-de-cancel>やめる</button><button type="button" class="mm-btn-primary" data-de-apply>当てる</button></div>`
        + `<div id="deTabs"></div><div class="de-body"><aside class="pv-fields de-fields" data-dnd-trash><div class="pv-cap"><b>カラム</b><button type="button" class="de-fitbtn" data-de-fitcols title="いちばん長いカラム名が 1 行で入る幅に、カラムの欄を広げます（境を引いても変えられます）">⇔ 名前に合わせる</button><small>札を押すか、右の文へ引くと入ります（文の札は引いて並べ替え・行と列の入れ替え。ここへ戻すと外れます）</small></div>`
        + `<div class="de-fsearch"><input id="deSearch" type="search" placeholder="カラムを検索" autocomplete="off" aria-label="カラムを検索"><button type="button" class="pv-btn de-calcbtn" data-de-calcnew title="式から列を作り、このパネルで使います">＋ 計算列</button></div><div class="pv-list" id="deFields"></div></aside>`
        + '<i class="de-split" role="separator" aria-orientation="vertical" tabindex="0" aria-label="カラムの欄の幅" title="引いてカラムの欄の幅を変える（← → でも。ダブルクリックで元の幅）"></i>'
        // 流れの順に 4 段（2026-10-dashmore の 3 回目で決めた S3）: ① データ ② 数え方 ③ 形 ④ 見せ方・書式。段の見出しに番号（合わせた表は札で切り替えるので出さない）
        + `<div class="de-main"><div class="de-step"><i>1</i>データ<small>何を数えるか</small></div><div id="deData"></div>`
        + `<div class="de-step"><i>2</i>数え方<small>行・列・値・期間・条件</small></div><div id="deSent"></div><div id="deCond"></div><div id="deSort"></div>`
        + `<div class="de-step"><i>3</i>形<small>どう描くか</small></div><div id="deVis"></div><div id="deBoard"></div>`
        + `<div class="de-step"><i>4</i>見せ方・書式<small>枠・数値・軸・色</small></div><div id="deLook"></div><div id="deFmt"></div><div id="deGacts"></div><p class="de-msg" id="deMsg" aria-live="polite"></p></div></div>`
        + `<div id="deCalcBox" class="de-calcbox" hidden></div>`;
      // WL.dashKit.onText は fn(欄, 出来事) を呼ぶ（値ではない）。前は値のつもりで v.slice と書いて打つたびに止まり、題が変えられず、検索も当たらなかった（版 3.43.0）
      WL.dashKit.onText($("#deSearch"), (el) => { q = el.value; $("#deFields").innerHTML = fieldsHtml(); });
      WL.dashKit.onText($("#deTitle"), (el) => { p.title = el.value.slice(0, 60); host.onChange(WL.dashKit.clone(p)); });
    }
    const whole = !!parts() && gi < 0;
    el.classList.toggle("is-board", isBoard()); el.classList.toggle("is-link", isLink()); el.classList.toggle("is-whole", whole);
    const ti = $("#deTitle");
    if (document.activeElement !== ti) ti.value = p.title || "";
    ti.placeholder = autoTitle(p);
    $("#deTabs").innerHTML = tabsHtml();
    $("#deVis").innerHTML = visualsHtml();
    if (!typingIn("#deBoard")) $("#deBoard").innerHTML = whole && isBoard() ? boardHtml() : "";
    $(".de-fields").hidden = whole;
    ["#deData", "#deSent", "#deCond", "#deSort"].forEach((s) => { $(s).hidden = whole; });
    // 段の見出し: 合わせたデータの「全体」は ① を「合わせ方」にし ② を出さない・「データ」の札は ③ ④（形・見せ方は全体で決める）を出さない
    const steps = el.querySelectorAll(".de-step"), lw = isLink() && whole;
    steps[0].innerHTML = lw ? "<i>1</i>合わせ方<small>データ・役割・軸・作り方</small>" : "<i>1</i>データ<small>何を数えるか</small>";
    steps[1].hidden = lw; steps[2].hidden = steps[3].hidden = inSide();
    // 番号は見えている段の順（全体の札は ① 合わせ方 → ② 形 → ③ 見せ方。① → ③ と飛ばない）
    let no = 0; steps.forEach((st) => { if (!st.hidden) { const i = st.querySelector("i"); if (i) i.textContent = String(++no); } });
    if (lw) { const d = $("#deData"); d.hidden = false; if (!typingIn("#deData")) d.innerHTML = linkHtml(); }
    if (!whole) {
      if (repaintFields) $("#deFields").innerHTML = fieldsHtml();
      $("#deData").innerHTML = dataHtml();
      const se = $("#deSent"); WL.pivotCalc.keepFocus(se, () => { se.innerHTML = sentenceHtml() + calcBand(); });
      if (!typingIn("#deCond")) $("#deCond").innerHTML = condHtml();
      $("#deSort").innerHTML = sortHtml();
    }
    if (!typingIn("#deLook")) $("#deLook").innerHTML = whole ? "" : lookHtml();
    if (!typingIn("#deFmt")) $("#deFmt").innerHTML = fmtHtml();
    $("#deGacts").innerHTML = groupActsHtml();
    // 表全体: 設備の選び・まとめは、行の段（設備）の選びのすぐ下（どちらも行の段に効く）
    if (whole && isBoard()) { const b = $("#deBoard"), first = b && b.querySelector(".de-row"); if (first && !b.querySelector("[data-de-egmode]")) first.insertAdjacentHTML("afterend", equipHtml() + egroupHtml()); }
    if ((eqOpen || (p.egroup && p.egroup.mode === "panel")) && !eqItems) loadEquips();
    if ((p.eorder || []).length && !eoAll) loadEoAll();
  }
  function message(text) { const m = $("#deMsg"); if (m) m.textContent = text || ""; }

  /** 札を引いて組み替える（版 3.50.0。要望 1）: 組む物（t）の行・列・値。合わせた表のまとまり・合わせるデータは、置ける数（max）と所（canDrop）で縛る */
  function bindDnd(el) {
    DND.attach(el, {
      lists: () => ({ rows: t.body.rows, cols: t.body.cols, vals: t.body.measures }),
      get max() { return inSide() ? { rows: 1, cols: 0, vals: 1 } : inGroup() ? { rows: 1, cols: MAX_GROUP_COLS, vals: 1 } : { rows: MAX_DIMS, cols: MAX_DIMS, vals: MAX_MEASURES }; },
      canDrop: (role) => !!p && !isOps(p) && !(role === "rows" && inGroup() && !inSide()) && !(role === "cols" && inSide()),
      canDrag: () => !!p && !isOps(p),
      itemOf: (col, role) => (role === "vals" ? (col === "@lots" ? { agg: "lots" } : col === "@count" ? { agg: "count" } : isNum(col) ? { agg: "sum", column: col } : { agg: "distinct", column: col }) : { column: col, part: defaultPart(col) }),
      commit: (L, msg) => {
        const hadRows = t.body.rows.length;
        t.body.rows = L.rows; t.body.cols = L.cols; t.body.measures = L.vals.length ? L.vals : [{ agg: "lots" }];
        if (t.visual === "kpi" && L.rows.length && !hadRows) t.visual = C.isTimeDim(L.rows[0]) ? "time" : "column";   // 行を入れたら数字はグラフに（押して足すのと同じ）
        changed(); if (msg) host.toast(msg);
      },
      toast: (x) => host.toast(x),
    });
    WL.pivotCalc.bind(el, (i, v) => {
      const m = t && t.body.measures[i]; if (!m) return "";
      const txt = String(v || "").trim(), ex = N.expr(txt);
      if (txt && ex.error) return ex.error;
      if ((m.expr || "") === txt) return "";
      if (txt) m.expr = txt; else delete m.expr;
      changed(false); return "";
    }, (i, dec) => {                       // 値の桁（版 3.50.1）
      const m = t && t.body.measures[i]; if (!m) return;
      if (dec == null || dec === "") delete m.dec; else m.dec = Math.max(0, Math.min(6, +dec));
      changed(false);
    });
  }
  /** 組む所の押下（clickGroups）。扱ったら true */
  function clickGroups(b, e) {
    if (b.dataset.deEqput) {          // 設備を行・列の段の頭に置く（要望 2）
      const role = b.dataset.deEqput, bd = p.body;
      if (bd[role].length >= MAX_DIMS) { host.toast(`${role === "rows" ? "行" : "列"}の段は ${MAX_DIMS} つまでです`); return true; }
      bd[role === "rows" ? "cols" : "rows"] = bd[role === "rows" ? "cols" : "rows"].filter((d) => d.column !== "@equip");
      bd[role] = [{ column: "@equip", part: "" }].concat(bd[role].filter((d) => d.column !== "@equip"));
      if (p.visual === "kpi") p.visual = role === "rows" ? "column" : "none";
      delete p.esplit; changed(); return true;
    }
    if (b.dataset.deGmove) { moveGroup(gi, +b.dataset.deGmove); return true; }
    if (b.hasAttribute("data-de-gdel")) { removeGroup(gi); return true; }
    if (b.dataset.deRup != null || b.dataset.deRdown != null) { const i = +(b.dataset.deRup ?? b.dataset.deRdown); moveRow(b.closest("[data-de-row]").dataset.deRow, b.dataset.deRup != null ? i - 1 : i + 1); return true; }
    if (b.dataset.deColor != null) { p.groups[gi].color = b.dataset.deColor; changed(false); return true; }
    return false;
  }
  /** 組む所の押下（clickEquips）。扱ったら true */
  function clickEquips(b, e) {
    // 設備（複数）・まとめる
    if (b.hasAttribute("data-de-eqopen")) { eqOpen = !eqOpen; if (eqOpen) loadEquips(); paint(false); return true; }
    if (b.hasAttribute("data-de-eqall") || b.hasAttribute("data-ck-deq-clear")) { setEquips([]); return true; }
    if (b.dataset.deEomove != null) {         // 設備の並び（版 3.48.0）: 1 つ前・後ろへ
      const ks = eorderKeys(), i = +b.dataset.deEomove, j = i + +b.dataset.d;
      if (j < 0 || j >= ks.length) return true;
      ks.splice(j, 0, ks.splice(i, 1)[0]); p.eorder = ks; changed(false); return true;
    }
    if (b.hasAttribute("data-de-egadd")) { const eg = p.egroup; eg.groups = (eg.groups || []).concat([{ name: `グループ ${(eg.groups || []).length + 1}`, members: [] }]); changed(false); return true; }
    if (b.dataset.deEgdel != null) { p.egroup.groups.splice(+b.dataset.deEgdel, 1); changed(false); return true; }
    if (b.dataset.deEgm != null) {
      const g = p.egroup.groups[+b.closest(".de-eg").dataset.k], n = b.dataset.deEgm;
      g.members = (g.members || []).includes(n) ? g.members.filter((x) => x !== n) : (g.members || []).concat([n]);
      changed(false); return true;
    }
    return false;
  }
  /** 組む所の押下（clickFormat）。扱ったら true */
  function clickFormat(b, e) {
    // 書式
    if (b.hasAttribute("data-de-fmtopen")) { fmtOpen = !fmtOpen; $("#deFmt").innerHTML = fmtHtml(); return true; }
    if (b.dataset.deNex != null) { setNum({ cat: "custom", code: b.dataset.deNex }); return true; }
    if (b.hasAttribute("data-de-fncolorx")) { setFmt("ncolor", ""); return true; }
    if (b.hasAttribute("data-de-fitcols")) { fitColumns(); return true; }
    if (b.hasAttribute("data-de-futextx")) { setFmt("utext", ""); $("#deFmt").innerHTML = fmtHtml(); return true; }
    if (b.dataset.dePal != null) { setFmt("palette", b.dataset.dePal); return true; }
    if (b.dataset.deSerx != null) {
      const n = b.dataset.deSerx, cs = { ...((p.fmt || {}).colors || {}) }, ss = { ...((p.fmt || {}).series || {}) };
      delete cs[n]; delete ss[n];
      p.fmt = { ...(p.fmt || {}), colors: cs, series: ss };
      ["colors", "series"].forEach((k) => { if (!Object.keys(p.fmt[k]).length) delete p.fmt[k]; });
      if (!Object.keys(p.fmt).length) delete p.fmt;
      changed(false); return true;
    }
    if (b.dataset.deScolx != null) { const cs = { ...((p.fmt || {}).colors || {}) }; delete cs[b.dataset.deScolx]; setFmt("colors", Object.keys(cs).length ? cs : ""); return true; }
    if (b.hasAttribute("data-de-refadd")) { const fm = p.fmt || {}; setFmt("refs", (fm.refs || []).concat([{ value: 0, label: "目標", color: REF_COLORS[0] }])); return true; }
    if (b.dataset.deRefdel != null) { const r = ((p.fmt || {}).refs || []).slice(); r.splice(+b.dataset.deRefdel, 1); setFmt("refs", r.length ? r : ""); return true; }
    if (b.dataset.deRefc != null) { const r = ((p.fmt || {}).refs || []).map((x) => ({ ...x })), i = +b.closest(".de-ref").dataset.i; r[i].color = b.dataset.deRefc; setFmt("refs", r); return true; }
    return false;
  }
  /** 組む所の押下（clickCalcOps）。扱ったら true */
  function clickCalcOps(b, e) {
    // 計算列
    if (b.hasAttribute("data-de-calcnew")) { openCalc(""); return true; }
    if (b.dataset.deCalcopen != null) { e.stopPropagation(); openCalc(b.dataset.deCalcopen); return true; }
    if (b.hasAttribute("data-de-calcx")) { calcEdit = null; paintCalc(); return true; }
    if (b.hasAttribute("data-de-calcok")) { saveCalc(false); return true; }
    if (b.hasAttribute("data-de-calcdel")) {
      confirmModal({ title: `計算列「${calcEdit.was}」を削除しますか？`, message: "使っている段・値・条件からも外します。", confirmLabel: "削除する", danger: true })
        .then((ok) => { if (ok) saveCalc(true); });
      return true;
    }
    if (b.dataset.deOpick != null) {       // 稼働を見る形の札（色分け: 押した列にする・品種: 押した列を足す／外す〈組み合わせ〉）
      const c = b.dataset.deOpick;
      if (p.visual !== "gantt") { const cls = clsOf(p); setCls(cls.includes(c) ? cls.filter((x) => x !== c) : cls.concat([c]), true); return true; }
      const o = { ...(p.ops || {}) };
      if (o.color === c) delete o.color; else o.color = c;
      p.ops = o; changed(); return true;
    }
    if (b.hasAttribute("data-de-limadd")) {     // 線を足す（版 3.51.0）: 最後の線と 100% の中ほど。足した欄に焦点を移す
      const xs = abcLims(p.ops || {}), last = xs[xs.length - 1], v = Math.round(((last + 100) / 2) * 10) / 10;
      if (v <= last || v > 100) return true;
      setLims(xs.concat([v]));
      const k = xs.length; requestAnimationFrame(() => { const f = $(`[data-de-lim="${k}"]`); if (f) { f.focus(); f.select(); } });
      return true;
    }
    if (b.dataset.deLimx != null) { const xs = abcLims(p.ops || {}); xs.splice(+b.dataset.deLimx, 1); setLims(xs); return true; }
    if (b.dataset.deClsx != null) { const cls = clsOf(p); cls.splice(+b.dataset.deClsx, 1); setCls(cls, true); return true; }
    if (b.dataset.deClsl != null) { const cls = clsOf(p), i = +b.dataset.deClsl; [cls[i - 1], cls[i]] = [cls[i], cls[i - 1]]; setCls(cls, true); return true; }
    return false;
  }
  /** 組む所の押下（clickBody）。扱ったら true */
  function clickBody(b, e) {
    if (b.dataset.deAdd) {
      const role = b.dataset.deAdd, col = b.dataset.col;
      if (role === "vals") addMeasure(col === "@lots" ? { agg: "lots" } : col === "@count" ? { agg: "count" } : isNum(col) ? { agg: "sum", column: col } : { agg: "distinct", column: col });
      else addDim(role, col);
      return true;
    }
    if (b.hasAttribute("data-de-swap")) { const r = t.body.rows; t.body.rows = t.body.cols; t.body.cols = r; changed(); return true; }
    if (b.dataset.deX) { t.body[b.dataset.deX].splice(+b.dataset.i, 1); changed(); return true; }
    if (b.dataset.deMx != null) { t.body.measures.splice(+b.dataset.deMx, 1); if (!t.body.measures.length) t.body.measures = [{ agg: "lots" }]; changed(); return true; }
    if (b.dataset.deVis) { setVisual(b.dataset.deVis); return true; }
    if (b.dataset.deFedit != null) { editCond(b.dataset.deFedit, b); return true; }
    if (b.dataset.deFdel != null) { const c = b.dataset.deFdel; t.filters = t.filters.filter((f) => f.column !== c); $("#deCond").innerHTML = condHtml(); changed(false); }
    return false;
  }
  /** 組む所の欄の変更（changeData）。扱ったら true */
  function changeData(x) {
    if (x.matches("[data-de-src]")) { setSource(x.value, ""); return true; }
    if (x.matches("[data-de-equip]")) { setSource(t.source, x.value); return true; }
    if (x.matches("[data-de-basis]")) { t.basis = x.value; changed(false); return true; }
    if (x.matches("[data-de-part]")) { t.body[x.dataset.dePart][+x.dataset.i].part = x.value; changed(false); return true; }
    if (x.matches("[data-de-agg]")) {
      const m = t.body.measures[+x.dataset.deAgg]; m.agg = x.value;
      if (m.agg === "pct" && !m.p) m.p = 90;
      if (m.agg === "cpk" && m.lsl == null && m.usl == null) { host.toast("Cpk は規格の下限か上限を入れると数えます"); paint(false); return true; }
      changed(false); return true;
    }
    if (x.matches("[data-de-show]")) { const m = t.body.measures[+x.dataset.deShow]; if (x.value) m.show = x.value; else delete m.show; changed(false); return true; }
    if (x.matches("[data-de-mp]")) { t.body.measures[+x.dataset.deMp].p = Math.max(1, Math.min(99, +x.value || 90)); changed(false); return true; }
    if (x.matches("[data-de-mlsl],[data-de-musl]")) {
      const i = +(x.dataset.deMlsl ?? x.dataset.deMusl), m = t.body.measures[i], k = x.dataset.deMlsl != null ? "lsl" : "usl";
      if (x.value === "") delete m[k]; else m[k] = +x.value;
      if (m.lsl == null && m.usl == null) { host.toast("Cpk は規格の下限か上限が要ります"); return true; }
      if (m.lsl != null && m.usl != null && m.lsl >= m.usl) { host.toast("規格は 下限 < 上限 にしてください"); return true; }
      changed(false); return true;
    }
    if (x.matches("[data-de-pkind]")) {
      const dates = special().some((s) => s.column === "@workday") ? "@workday" : (((fields && fields.fields) || []).find((f) => f.date) || {}).column || "";
      t.period = periodOf(t.period, x.value, (t.period && t.period.column) || dates);
      $("#deCond").innerHTML = condHtml(); changed(false); return true;
    }
    if (x.matches("[data-de-pcol]")) { t.period.column = x.value; changed(false); return true; }
    return false;
  }
  /** 組む所の欄の変更（changeOps）。扱ったら true */
  function changeOps(x) {
    // 稼働を見る形（版 3.46.0）
    const setOps = (k, v) => { const o = { ...(p.ops || {}) }; if (v === "" || v == null) delete o[k]; else o[k] = v; p.ops = o; changed(false); };
    if (x.matches("[data-de-oend]")) { setOps("end", x.value); return true; }
    if (x.matches("[data-de-ostart]")) { setOps("start", x.value); return true; }
    // 換算係数の期間（地点 A。版 3.49.0）: 係数だけをこの期間で出し、パネルの期間（地点 B）の本数に掛ける
    if (x.matches("[data-de-rkind]")) { setOps("refPeriod", periodOf((p.ops || {}).refPeriod, x.value, "@workday")); return true; }
    if (x.matches("[data-de-rn]")) { setOps("refPeriod", { ...p.ops.refPeriod, n: Math.max(1, Math.min(3660, +x.value || 7)) }); return true; }
    if (x.matches("[data-de-rfrom],[data-de-rto]")) { setOps("refPeriod", { ...p.ops.refPeriod, [x.matches("[data-de-rfrom]") ? "from" : "to"]: x.value }); return true; }
    if (x.matches("[data-de-ospan]")) { setOps("span", x.value === "lead" ? "lead" : ""); return true; }
    if (x.matches("[data-de-ohide]")) {          // ABC の表示項目（版 3.48.0）: チェックを外した項目を hide に
      const hide = new Set((p.ops || {}).hide || []); if (x.checked) hide.delete(x.dataset.deOhide); else hide.add(x.dataset.deOhide);
      setOps("hide", hide.size ? ABC_ITEMS.map((y) => y[0]).filter((k) => hide.has(k)) : ""); return true;
    }
    if (x.matches("[data-de-eord]")) {          // 設備の並び（版 3.48.0）: 手で並べる＝いまの並びから始める
      if (x.value !== "hand") { delete p.eorder; changed(false); return true; }
      (async () => { await loadEoAll(); p.eorder = eorderKeys(); if (!p.eorder.length) host.toast("並べる設備がありません"); changed(false); })();
      return true;
    }
    if (x.matches("[data-de-ocolor]")) { setOps("color", x.value); return true; }
    if (x.matches("[data-de-olabel]")) { setOps("label", x.value); return true; }
    if (x.matches("[data-de-ocls]")) { if (x.value) setCls(clsOf(p).concat([x.value])); return true; }
    if (x.matches("[data-de-oqty]")) { setOps("qty", x.value); return true; }
    if (x.matches("[data-de-oqcol]")) { if (x.value) setOps("qty", x.value); return true; }
    if (x.matches("[data-de-obase]")) { setOps("base", x.value === "avg" ? "" : x.value); return true; }
    if (x.matches("[data-de-rankby]")) { setOps("rankBy", x.value === "each" ? "each" : ""); return true; }
    if (x.matches("[data-de-lim]")) {         // 線の数（版 3.51.0）: 0 より大きく 100 以下・同じ線は 2 本置かない。読めなければ欄を赤くして字で知らせ、当てない
      const vs = [...document.querySelectorAll("[data-de-lim]")].map((y) => +y.value), v = +x.value, i = +x.dataset.deLim;
      const why = !(v > 0 && v <= 100) ? "線は 0 より大きく 100 以下の % で書きます" : vs.some((w, j) => j !== i && w === v) ? `${v}% の線はもうあります` : "";
      x.classList.toggle("is-bad", !!why); x.setAttribute("aria-invalid", why ? "true" : "false");
      const er = $("[data-de-limerr]"); if (er) er.textContent = why;
      if (why) return true;
      setLims(vs); return true;
    }
    return false;
  }
  /** 組む所の欄の変更（changePanel）。扱ったら true */
  function changePanel(x) {
    if (x.matches("[data-de-pfrom],[data-de-pto]")) { t.period[x.matches("[data-de-pfrom]") ? "from" : "to"] = x.value; changed(false); return true; }
    if (x.matches("[data-de-pn]")) { t.period.n = Math.max(1, Math.min(3660, +x.value || 7)); changed(false); return true; }
    if (x.matches("[data-de-sort]")) { p.sort = x.value; changed(false); return true; }
    if (x.matches("[data-de-emph]")) { p.emph = x.checked; changed(false); return true; }
    if (x.matches("[data-de-frame]")) { if (x.value === "card") delete p.frame; else p.frame = x.value; p.emph = x.value === "emph"; changed(false); return true; }
    if (x.matches("[data-de-kpilook]")) { setFmt("kpi", x.value === "num" ? "" : x.value); return true; }
    if (x.matches("[data-de-target]")) { setFmt("target", x.value === "" ? "" : +x.value); return true; }
    if (x.dataset.ckDeq != null || x.matches("[data-ck-deq-all]")) {
      if (x.matches("[data-ck-deq-all]")) { setEquips([]); return true; }
      const set = new Set(eqHost().equips || []); if (x.checked) set.add(x.dataset.ckDeq); else set.delete(x.dataset.ckDeq);
      setEquips((eqItems || []).map((i) => i.value).filter((v) => set.has(v))); return true;
    }
    return false;
  }
  /** 組む所の欄の変更（changeEquipLink）。扱ったら true */
  function changeEquipLink(x) {
    if (x.matches("[data-de-split]")) {
      const v = x.value, eg = p.egroup || {};
      if (v === "sum") { p.egroup = { mode: "sum", rest: "keep", ...(eg.mode === "sum" ? { name: eg.name } : {}) }; delete p.esplit; }
      else if (v === "group") { p.egroup = eg.mode === "panel" || eg.mode === "master" ? eg : { mode: (host.egroupSets && host.egroupSets().length) ? "master" : "panel", rest: "keep", set: ((host.egroupSets ? host.egroupSets() : [])[0] || {}).name || "", groups: [{ name: "グループ 1", members: [] }] }; delete p.esplit; loadEquips(); }
      else { delete p.egroup; p.esplit = v; }
      changed(false); return true;
    }
    if (x.matches("[data-de-egsrc]")) {
      const eg = p.egroup; eg.mode = x.value;
      if (x.value === "panel" && !(eg.groups || []).length) eg.groups = [{ name: "グループ 1", members: [] }];
      if (x.value === "master" && !eg.set) eg.set = ((host.egroupSets ? host.egroupSets() : [])[0] || {}).name || "";
      if (x.value === "panel") loadEquips();
      changed(false); return true;
    }
    if (x.matches("[data-de-linkmode]")) {           // 数える物: 1 つのデータ ⇔ 別のデータと合わせる
      if (x.value === "link" && !isLink()) startLink();
      else if (x.value === "one" && isLink()) { unlink(); host.toast("1 つ目のデータだけのパネルに戻しました"); loadFields(); changed(); }
      return true;
    }
    if (x.matches("[data-de-sub]")) { p.body.sub = x.checked; changed(false); return true; }
    if (x.name && /^de-(role|build)-\d+$/.test(x.name)) {
      const [, k, i] = /^de-(role|build)-(\d+)$/.exec(x.name), g = p.link.sides[+i];
      if (k === "role" && x.value) p.link.sides.forEach((y, j) => { if (j !== +i && y.role === x.value) y.role = ""; });    // 目標・実績は 1 つずつ
      g[k] = x.value; changed(false); return true;
    }
    if (x.matches("[data-de-extra]")) { const ex = new Set(p.link.extra || []); if (x.checked) ex.add(x.dataset.deExtra); else ex.delete(x.dataset.deExtra); p.link.extra = [...ex]; changed(false); return true; }
    if (x.matches("[data-de-stitle]")) { p.link.sides[gi].title = x.value.trim().slice(0, 40); changed(false); return true; }
    if (x.matches("[data-de-egmode]")) {
      if (!x.value) delete p.egroup;
      else p.egroup = { mode: x.value, rest: (p.egroup || {}).rest || "keep", ...(x.value === "panel" ? { groups: (p.egroup || {}).groups || [{ name: "グループ 1", members: [] }] } : {}),
        ...(x.value === "master" ? { set: ((host.egroupSets ? host.egroupSets() : [])[0] || {}).name || "" } : {}) };
      if (x.value === "panel") loadEquips();
      if (x.value === "sum" && !(eqHost().equips || []).length) host.toast("選んだ設備を合算します（設備を選ばなければ、すべての設備の計）");
      changed(false); return true;
    }
    if (x.matches("[data-de-egname]")) { p.egroup.name = x.value.trim().slice(0, 40); changed(false); return true; }
    if (x.matches("[data-de-eggname]")) { p.egroup.groups[+x.closest(".de-eg").dataset.k].name = x.value.trim().slice(0, 40) || `グループ ${+x.closest(".de-eg").dataset.k + 1}`; changed(false); return true; }
    if (x.matches("[data-de-egset]")) { p.egroup.set = x.value; changed(false); return true; }
    if (x.matches("[data-de-egrest]")) { p.egroup.rest = x.value; changed(false); return true; }
    return false;
  }
  /** 組む所の欄の変更（changeFormat）。扱ったら true */
  function changeFormat(x) {
    if (x.matches("[data-de-flabels]")) { setFmt("labels", x.value); return true; }
    if (x.matches("[data-de-fxdate]")) { setFmt("xdate", x.value); return true; }
    if (x.matches("[data-de-fxrot]")) { setFmt("xrot", x.value); return true; }
    if (x.matches("[data-de-fdigits]")) { setFmt("digits", x.value === "" ? "" : +x.value); return true; }
    if (x.matches("[data-de-funit]")) { setFmt("unit", x.value); return true; }
    if (x.matches("[data-de-fncat]")) { setNum({ cat: x.value }); return true; }
    if (x.matches("[data-de-fndec]")) { setNum({ dec: +x.value }); return true; }
    if (x.matches("[data-de-nsep]")) { setNum({ sep: x.checked }); return true; }
    if (x.matches("[data-de-fnneg]")) { setNum({ neg: x.value }); return true; }
    if (x.matches("[data-de-npre]")) { clearTimeout(numTimer); setNum({ pre: x.value.trim() }); return true; }
    if (x.matches("[data-de-nsuf]")) { clearTimeout(numTimer); setNum({ suf: x.value.trim() }); return true; }
    if (x.matches("[data-de-ncode]")) { clearTimeout(numTimer); setNum({ cat: "custom", code: x.value.trim() }); return true; }
    if (x.matches("[data-de-falign]")) { setFmt("align", x.value); return true; }
    if (x.matches("[data-de-fvalign]")) { setFmt("valign", x.value); return true; }
    if (x.matches("[data-de-fnsize]")) { setFmt("nsize", x.value); return true; }
    if (x.matches("[data-de-fbold]")) { setFmt("bold", x.checked ? "" : "off"); return true; }
    if (x.matches("[data-de-fncolor]")) { setFmt("ncolor", x.value); return true; }
    if (x.matches("[data-de-fymin],[data-de-fymax]")) { setFmt(x.matches("[data-de-fymin]") ? "ymin" : "ymax", x.value === "" ? "" : +x.value); return true; }
    if (x.matches("[data-de-fgrid]")) { setFmt("grid", x.checked ? "" : false); return true; }
    if (x.matches("[data-de-flegend]")) { setFmt("legend", x.value); return true; }
    if (x.matches("[data-de-fsize]")) { setFmt("size", x.value); return true; }
    if (x.matches("[data-de-refv],[data-de-refl]")) {
      const r = ((p.fmt || {}).refs || []).map((y) => ({ ...y })), i = +x.closest(".de-ref").dataset.i;
      if (x.matches("[data-de-refv]")) r[i].value = +x.value || 0; else r[i].label = x.value.trim().slice(0, 20);
      setFmt("refs", r); return true;
    }
    if (x.matches("[data-de-slab],[data-de-sdash],[data-de-skind],[data-de-saxis]")) {
      const n = x.closest("[data-de-ser]").dataset.deSer, ss = { ...((p.fmt || {}).series || {}) }, one = { ...(ss[n] || {}) };
      const k = x.matches("[data-de-slab]") ? "label" : x.matches("[data-de-skind]") ? "kind" : x.matches("[data-de-saxis]") ? "axis" : "";
      if (k) { if (x.value) one[k] = x.value; else delete one[k]; } else if (x.value) one.dash = true; else delete one.dash;
      if (Object.keys(one).length) ss[n] = one; else delete ss[n];
      setFmt("series", Object.keys(ss).length ? ss : ""); return true;
    }
    if (x.matches("[data-de-scol]")) { setFmt("colors", { ...((p.fmt || {}).colors || {}), [x.dataset.deScol]: x.value }); return true; }
    return false;
  }
  /** 組む所の欄の変更（changeBoard）。扱ったら true */
  function changeBoard(x) {
    if (x.matches("[data-de-lwarn],[data-de-lalert],[data-de-ldir]")) {
      const g = p.groups[gi], L = { ...(g.limits || {}) };
      if (x.matches("[data-de-ldir]")) L.dir = x.value;
      else { const k = x.matches("[data-de-lwarn]") ? "warn" : "alert"; if (x.value === "") delete L[k]; else L[k] = +x.value; }
      if (L.warn == null && L.alert == null) delete g.limits; else g.limits = { dir: "high", ...L };
      changed(false); return true;
    }
    if (x.matches("[data-de-top]")) { p.top = Math.max(0, Math.min(60, +x.value || 0)); changed(false); return true; }
    if (x.matches("[data-de-look]")) { p.groups[gi].look = x.value; changed(false); return true; }
    if (x.matches("[data-de-total]")) { p.groups[gi].total = x.checked; changed(false); return true; }
    if (x.matches("[data-de-zero]")) { p.groups[gi].zero = x.checked; changed(false); return true; }
    if (x.matches("[data-de-gtitle]")) { p.groups[gi].title = x.value.trim().slice(0, 40); changed(false); return true; }
    if (x.matches("[data-de-border]")) { const [by, dir] = x.value.split(":"); Object.assign(p.order, { by, ...(dir ? { dir } : {}) }); if (by === "manual" && !p.order.list.length) p.order.list = rowKeys().map((r) => r.key); changed(false); return true; }
    if (x.matches("[data-de-slice]")) { if (x.checked) delete p.noslice; else p.noslice = true; changed(false); return true; }
    if (x.matches("[data-de-btree]")) { if (x.value) p.order.tree = x.value; else { delete p.order.tree; delete p.order.glist; } changed(false); return true; }
    if (x.matches("[data-de-bgroup]")) { p.order.group = +x.value; changed(false); return true; }
    if (x.matches("[data-de-rshow]")) { toggleRow(x.closest("[data-de-row]").dataset.deRow); return true; }
    if (x.matches("[data-de-fpick]")) { const c = x.value; x.value = ""; if (c) editCond(c, x); }
    return false;
  }
  /** 打っている間（書式コード・前後の字・単位・計算列）。欄は作り直さない */
  function onInput(e) {
    // 書式コードを打つ間は、見本だけをその場で替える（欄は作り直さない。確かめて当てるのは change）
    // 前後の字・書式コードは打つ間に当てる（パネルも見本もその場で変わる。数は引き直さない）
    const nt = e.target;
    // 単位: 自動の字と同じなら自動のまま（覚えない）・空なら単位を出さない
    if (nt.matches("[data-de-futext]")) {
      clearTimeout(numTimer);
      numTimer = setTimeout(() => {
        const fm = { ...(p.fmt || {}) }, auto = P.autoUnit({ ...p, fmt: { ...fm, utext: undefined } }, (p.body.measures || [])[0] || { agg: "lots" }), v = nt.value.trim();
        if (fm.numUi && fm.numUi.suf) { fm.numUi = { ...fm.numUi, suf: "" }; const code = N.build(fm.numUi); if (code) fm.num = code; else delete fm.num; }   // 前の版で表示形式の「後ろに」に入れた字は、単位へ移す
        if (v === auto) delete fm.utext; else fm.utext = v;
        // 欄の横（自動・自動に戻す）は、打っている欄を作り直さずにその場で替える
        const side = nt.parentElement.querySelector("[data-de-futextx], small");
        if (side) side.outerHTML = unitSide(fm, auto);
        if (JSON.stringify(fm) === JSON.stringify(p.fmt || {})) return;
        if (Object.keys(fm).length) p.fmt = fm; else delete p.fmt;
        changed(false);
      }, 200);
      return;
    }
    if (nt.matches("[data-de-ncode],[data-de-npre],[data-de-nsuf]")) {
      clearTimeout(numTimer);
      numTimer = setTimeout(() => setNum(nt.matches("[data-de-ncode]") ? { cat: "custom", code: nt.value.trim() } : { [nt.matches("[data-de-npre]") ? "pre" : "suf"]: nt.value.trim() }), 200);
      return;
    }
    if (!calcEdit) return;
    if (e.target.id === "deCalcName") calcEdit.name = e.target.value;
    else if (e.target.id === "deCalcExpr") calcEdit.expr = e.target.value;
    else return;
    // 欄は作り直さない（打っている字を失わない）。確かめの字と「作る」だけを替える
    const tmp = document.createElement("div"); tmp.innerHTML = calcHtml();
    $("#deCalcMsg").replaceWith(tmp.querySelector("#deCalcMsg"));
    $("[data-de-calcok]").disabled = tmp.querySelector("[data-de-calcok]").disabled;
  }
  function bind(el) {
    bindDnd(el);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b || !p) return;
      if (b.hasAttribute("data-de-cancel")) { host.onCancel(); return; }
      if (b.hasAttribute("data-de-apply")) { host.onApply(WL.dashKit.clone(p)); return; }
      if (b.dataset.deTab != null) { select(+b.dataset.deTab); return; }
      if (b.hasAttribute("data-de-formmore")) { formOpen = !formOpen; $("#deVis").innerHTML = visualsHtml(); return; }
      if (b.hasAttribute("data-de-gadd")) { addGroup(); return; }

      if (clickGroups(b, e) || clickEquips(b, e) || clickFormat(b, e) || clickCalcOps(b, e) || clickBody(b, e)) return;
    });
    el.addEventListener("change", (e) => {
      const x = e.target; if (!p) return;
      changeData(x) || changeOps(x) || changePanel(x) || changeEquipLink(x) || changeFormat(x) || changeBoard(x);
    });
    el.addEventListener("input", onInput);
    el.addEventListener("pointerdown", rowDragStart);
  }

  /* ---- 行の札を引いて並べる（版 3.41.0。利用者の要望 4: 思った所と入る所がずれた・分かりにくい）
     前は HTML の引いて落とすで、下へ引くと落とした札の「後ろ」、上へ引くと「前」に入っていた（向きで食い違う）。
     いまは: 札の写し（ゴースト）が指に付いてくる・元の所は点線の空き・入る所に線。入る所は、指の高さがどの札の真ん中より上か（上へ引いても下へ引いても同じ決まり）。
     設備の札は同じグループの中だけ（グループはマスタで決まる）。グループの見出しを引くと、グループごと並ぶ。Esc でやめる ---- */
  let rd = null;
  /* ---- 設備の並び（版 3.48.0）の ⋮⋮ を引く: 行の札と同じ決まり（入る所に線・指の高さが札の真ん中より上ならその前・Esc でやめる） ---- */
  let ed8 = null;
  function eoDragStart(e) {
    const grip = e.target.closest && e.target.closest("[data-de-eogrip]");
    if (!grip || e.button !== 0) return false;
    const li = grip.closest("[data-de-eoname]"), list = li && li.parentElement;
    if (!li) return false;
    e.preventDefault();
    const line = document.createElement("div"); line.className = "de-dropline"; line.hidden = true; list.append(line);
    li.classList.add("is-src"); document.body.classList.add("dash-dragging");
    ed8 = { li, list, line, to: -1 };
    const move = (ev) => {
      const items = [...list.querySelectorAll(":scope > [data-de-eoname]")].filter((x) => x !== li), lr = list.getBoundingClientRect();
      const inside = ev.clientX >= lr.left - 40 && ev.clientX <= lr.right + 40 && ev.clientY >= lr.top - 20 && ev.clientY <= lr.bottom + 20;
      // 2 段組み（is-many）でも、指に近い札の前後で決める（真ん中より上・左ならその前）
      let i = items.length, best = Infinity;
      items.forEach((it, k) => { const r = it.getBoundingClientRect(), d = Math.hypot(Math.max(r.left - ev.clientX, 0, ev.clientX - r.right), ev.clientY - (r.top + r.height / 2)); if (d < best) { best = d; i = ev.clientY < r.top + r.height / 2 ? k : k + 1; } });
      ed8.to = inside ? i : -1; line.hidden = !inside;
      if (inside) { const ref = items[i] || items[items.length - 1], r = ref.getBoundingClientRect(); line.style.top = `${(items[i] ? r.top - 2 : r.bottom) - lr.top + list.scrollTop}px`; line.style.left = `${r.left - lr.left}px`; line.style.width = `${r.width}px`; }
    };
    const done = (apply) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("keydown", key, true);
      document.body.classList.remove("dash-dragging"); line.remove(); li.classList.remove("is-src");
      const d = ed8; ed8 = null;
      if (!apply || !d || d.to < 0) return;
      const ks = eorderKeys(), name = li.dataset.deEoname, from = ks.indexOf(name);
      ks.splice(from, 1); ks.splice(d.to, 0, name);
      if (ks.indexOf(name) === from) return;
      p.eorder = ks; changed(false);
    };
    const key = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); done(false); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", () => done(true), { once: true });
    window.addEventListener("keydown", key, true);
    move(e);
    return true;
  }
  function rowDragStart(e) {
    if (eoDragStart(e)) return;
    const grip = e.target.closest && e.target.closest("[data-de-grip]");
    if (!grip || e.button !== 0) return;
    const li = grip.closest("[data-de-row]") || grip.closest("[data-de-rgrp]");
    if (!li) return;
    e.preventDefault();
    const isGroup = !li.matches("[data-de-row]"), list = li.parentElement;
    const r = li.getBoundingClientRect(), lr = list.getBoundingClientRect();
    // ゴーストは名前だけの小さな札にして、並びの右の外に、入る所の線の高さで出す（並びの札を覆わない。2026-10-dashslice の 1 回目の採点:
    // 札の写しが入る所の直前の札を覆い、番号が 3 つ食い違った）。札に「ここへ n 番目」
    const ghost = document.createElement("div");
    ghost.className = "de-ghost";
    ghost.innerHTML = `<span class="de-gname"><i aria-hidden="true">⋮⋮</i>${esc(isGroup ? li.dataset.deRgrp : li.dataset.deRow)}</span><b class="de-gto"></b>`;
    Object.assign(ghost.style, { position: "fixed", left: `${Math.round(lr.right + 14)}px`, top: `${r.top}px`, zIndex: 60, pointerEvents: "none" });
    document.body.append(ghost);
    const line = document.createElement("div"); line.className = "de-dropline"; list.append(line);
    li.classList.add("is-src");
    rd = { li, list, isGroup, key: isGroup ? li.dataset.deRgrp : li.dataset.deRow, ghost, line, to: -1 };
    document.body.classList.add("dash-dragging");
    window.addEventListener("pointermove", rowDragMove);
    window.addEventListener("pointerup", rowDragEnd, { once: true });
    window.addEventListener("keydown", rowDragKey, true);
    rowDragMove(e);
  }
  /** 並びの札（引いている札を除く）と、指の高さ → 入る番目（札の真ん中より上なら、その札の前） */
  function dropIndex(items, y) {
    let i = 0;
    for (const it of items) { const r = it.getBoundingClientRect(); if (y < r.top + r.height / 2) break; i++; }
    return i;
  }
  function rowDragMove(e) {
    if (!rd) return;
    const sel = rd.isGroup ? ":scope > [data-de-rgrp]:not(.is-none)" : ":scope > [data-de-row]";
    const items = [...rd.list.querySelectorAll(sel)].filter((x) => x !== rd.li);
    const lr = rd.list.getBoundingClientRect();
    const inside = e.clientX >= lr.left - 40 && e.clientX <= lr.right + 160 && e.clientY >= lr.top - 24 && e.clientY <= lr.bottom + 24;
    rd.to = inside ? dropIndex(items, e.clientY) : -1;
    rd.ghost.classList.toggle("is-bad", !inside);
    rd.line.hidden = !inside;
    let y = e.clientY;
    if (inside) {
      const ref = items[rd.to], last = items[items.length - 1];
      y = ref ? ref.getBoundingClientRect().top - 3 : last ? last.getBoundingClientRect().bottom + 1 : lr.top;
      rd.line.style.top = `${y - lr.top + rd.list.scrollTop}px`;
    }
    rd.ghost.style.top = `${Math.round(y - rd.ghost.offsetHeight / 2)}px`;
    rd.ghost.querySelector(".de-gto").textContent = inside ? `◀ ここへ ${targetRank(rd)} 番目${rd.isGroup ? "のグループ" : ""}` : (rd.isGroup ? "グループの並びの中へ" : "同じグループの中へ");
    // 組む所の端に近ければ送る（長い並びでも、見えていない所へ落とせる）
    const main = rd.list.closest(".de-main");
    if (main) { const mr = main.getBoundingClientRect(); if (e.clientY < mr.top + 30) main.scrollTop -= 12; else if (e.clientY > mr.bottom - 30) main.scrollTop += 12; }
  }
  /** 落とした所（並び全体〈隠した行も〉での番目。引いた札を除いた並びでの位置）→ 札の番目は at＋1 */
  function targetAt(d) {
    if (d.isGroup) return d.to;
    const keys = rowKeys().filter((x) => x.key !== d.key), same = keys.filter((x) => x.group === (d.li.dataset.deRg || ""));
    return d.to < same.length ? keys.indexOf(same[d.to]) : same.length ? keys.indexOf(same[same.length - 1]) + 1 : 0;
  }
  const targetRank = (d) => targetAt(d) + 1;
  function rowDragKey(e) { if (e.key === "Escape" && rd) { e.preventDefault(); e.stopPropagation(); rowDragDone(); } }
  function rowDragDone() {
    window.removeEventListener("pointermove", rowDragMove);
    window.removeEventListener("keydown", rowDragKey, true);
    document.body.classList.remove("dash-dragging");
    if (!rd) return null;
    const d = rd; rd = null;
    d.ghost.remove(); d.line.remove(); d.li.classList.remove("is-src");
    return d;
  }
  function rowDragEnd() {
    const d = rowDragDone();
    if (!d || d.to < 0) return;
    if (d.isGroup) { moveGroupRow(d.key, d.to); return; }
    const at = targetAt(d);
    const now = rowKeys().map((x) => x.key).indexOf(d.key);
    if (at === now) return;
    moveRow(d.key, at);
    host.toast("並べました（手で並べた順）");
  }

  WL.dashEditor = {
    /** 開く。h = {panel, sources, answer() → いまの答え, onChange(panel), onApply(panel), onCancel(), toast(text)} */
    async open(h) {
      host = h; sources = h.sources || [];
      p = WL.dashKit.clone(h.panel);
      if (p.visual !== "board") {
        p.body = Object.assign({ rows: [], cols: [], measures: [{ agg: "lots" }], grand: false, labels: true, chartAt: 0 }, p.body || {});
        p.filters = p.filters || [];
      } else {
        p.order = Object.assign({ by: "value", group: 0, dir: "desc", list: [], hide: [] }, p.order || {});
      }
      p.title = p.title || "";
      moveCalc(p);
      eqOpen = false; eqItems = null; eqKey = ""; eoAll = null; eoKey = ""; calcEdit = null;
      const el = $("#dashEditor");
      if (!el.dataset.bound) { bind(el); bindSize(el); el.dataset.bound = "1"; }
      el.innerHTML = ""; el.hidden = false; applySize(el); q = ""; fields = null; fieldsKey = ""; formOpen = false;
      gi = -1; t = p;
      paint();
      await loadFields();
      const ti = $("#deTitle");
      if (ti) { ti.focus({ preventScroll: true }); ti.setSelectionRange(0, 0); ti.scrollLeft = 0; }   // 字の頭から見せる（欄が狭いと末尾へ送られて頭が欠ける）
    },
    close() { const el = $("#dashEditor"); if (el) { el.hidden = true; el.innerHTML = ""; } host = null; p = null; t = null; },
    isOpen: () => !!p,
    /** 組む所の幅（窓に収まる幅。グリッドの組むパネルを左の空きに置くため） */
    width: () => fit(sizes()).w,
    panelId: () => (p ? p.id : ""),
    /** 答えが変わった（合わせた表の行の札を、数えた行で並べ直す） */
    answered() {
      if (isBoard() && gi < 0) paint(false);
      else if (!typingIn("#deFmt") && $("#deFmt")) $("#deFmt").innerHTML = fmtHtml();   // 系列の名前と描いた色（描き終えてから分かる）
      else paintCalc0();                                                                   // 値の計算の変わり方（総計）は今の答えで
    },
    message, autoTitle,
    setSources(list) { sources = list || []; },
  };
})();
