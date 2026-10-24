/* =========================================================================
   ダッシュボード（版 3.37.0。最初の画面。版 3.36.0 の 1 枚の表を、グリッドのパネルの 1 つにした）
   - 利用者の要望（2026-10）: グリッドにパネルを置き、大きさを変え、パネルごとにいろいろなデータから条件を組んでグラフや表を作る
     （各一覧の集計表・グラフを組むのと同じ感じで。Power BI のように）。スクロールしない（どの大きさの窓でも全部が見える）
   - グリッド: 横 12 列 × 縦 rows 段（4〜16。既定 8）。段の高さ＝窓の高さを段の数で割る。パネルは {x, y, w, h}（列・段の数）
   - パネルの中身は dashboard-panels.js（大きさに合わせて描く）・組む所は dashboard-editor.js（変えるとグリッドの中のパネルがすぐ描き直る）
   - 数はサーバー（POST /api/dashboard/query。合わせた表〈版 3.38.0〉も同じ道）。出ているあいだは 1 分ごとに引き直す（サーバーは写しから数え、
     同じ組み・同じ写しなら前の答えを返す）
   - ダッシュボードの置き場は /api/dashboards（共通デフォルト・共通・ID・標準。集計表の組み方と同じ決まり）。組み込みの「標準」は書き換えられず、
     直したら「別名で保存」。最後に開いた物をこの PC で覚える（tpa.dash.v1）
   - 編集: 「編集」で入る。見出しを掴んで動かす・四隅の角で大きさ（版 3.41.0。前は右下だけ）・パネルを選んで 矢印＝動かす／Shift+矢印＝大きさ（右下の角）／Alt+Shift+矢印＝大きさ（左上の角）／Enter＝組む／Delete＝消す（2 回押し）。
     Ctrl+Z＝元に戻す。重なる所には置けない（影が赤になる）
   ========================================================================= */
(function(){
  let sayT = 0, editT = 0, resizeT = 0;      // 知らせを消す・組んだ物を描き直す・窓の大きさの描き直しを待つ
  const { $, esc } = WL.dashKit;
  const P = WL.dashPanels, E = WL.dashEditor, Q = WL.dashFilter, D = WL.dashSlicer;
  const KEY = "tpa.dash.v1";
  const POLL_MS = 60000, RETRY_MS = 4000, COLS = 12, GAP = 10, HISTORY = 30;
  // 置き場の言葉（版 3.49.0。利用者の要望 2026-10-21 の 4 回目の 1: 「共通」と「共通デフォルト」の違いが分からなかった）。
  // 違いは「だれに見えるか」ではなく「だれが直せるか」と「★の強さ」なので、名前と添え書きでそれを言う。マスタの値（ID・共通・共通デフォルト）は変えない
  // 2026-10-dashsave の 2 回目で決めた G: 置き場は人の印と「見える」「直せる」の 2 行（面の見出しと保存の窓の札で同じ形）
  // 言葉と印は shared.js の WL.dashKit.scope（集計表の組み方と同じ）
  const { SCOPES, NAME: SCOPE_NAME, ORDER: SCOPE_ORDER } = WL.dashKit.scope;
  const scopeIcon = WL.dashKit.scope.icon;
  const STAR_RULE = `★＝アプリを開いたときに最初に出す物。${WL.dashKit.scope.RULE}`;
  const DS = {
    list: [], login: "", canEditCommon: false, canEditDefault: false, standardId: null, rowsRange: [4, 16],
    id: null, layout: null, saved: "", edit: false, history: [], sel: "", sources: [],
    tree: null, answers: new Map(), cmSig: "", at: 0, timer: null, active: false, loading: false, msg: "", confirm: "", pop: null, editing: "",
    sets: [], setStd: null, setId: null, setMax: 12, hidden: [], want: null,
  };

  /* ---------------- 覚え・置き場 ---------------- */
  const mem = () => WL.dashKit.local.get(KEY, {});
  const remember = (patch) => WL.dashKit.local.set(KEY, { ...mem(), ...patch });
  /** id（数の字・"b:鍵"）→ ダッシュボード。組み込みを入れ替えた物は、組み込みの id（replaces）でも見つかる（セットのタブ・覚えた id。版 3.48.0） */
  const byId = (id) => (id == null ? null : DS.list.find((x) => String(x.id) === String(id)) || DS.list.find((x) => x.replaces && x.replaces === String(id)) || null);
  const current = () => byId(DS.id);
  /** 保存できるか: 書ける物・組み込み（開発者は全員の分を、ほかの人は自分の分を入れ替える。版 3.48.0） */
  const canSaveIt = (it) => !!it && (it.builtin ? !!(DS.canEditDefault || DS.login) : it.canEdit);
  /** 組み込みを入れ替える置き場（開発者＝共通デフォルト〈全員〉・ほかの人＝自分の ID） */
  const swapScope = () => (DS.canEditDefault ? "default" : "me");
  const dirty = () => !!DS.layout && JSON.stringify(DS.layout) !== DS.saved;
  const panelOf = (id) => (DS.layout ? DS.layout.panels.find((x) => x.id === id) : null);
  // 保存していない変更の見張り（版 3.43.0。unsaved.js）: 画面を移る・アプリを閉じる前に聞く。保存せずに進むなら、保存した並びへ戻して編集を出る
  WL.dashKit.unsaved.watch("dash:layout", { scope: "dash", dirty: () => DS.edit && dirty(),
    label: () => `ダッシュボード「${(current() || {}).name || ""}」の並び・パネル`,
    canSave: () => canSaveIt(current()),
    save: async () => { if (DS.editing) closeEditor(); await save(); return !dirty(); },
    discard: () => { if (DS.editing) closeEditor(); if (DS.id != null) open(DS.id); } });
  /* この PC の絞り込み（版 3.39.0。パネルを絞る: dashboard-filter.js）。ダッシュボードごと・パネルごとに覚える（tpa.dash.v1 の quick） */
  const quickOf = (id) => ((mem().quick || {})[String(DS.id)] || {})[id] || null;
  function setQuick(id, q) {
    const all = { ...(mem().quick || {}) }, mine = { ...(all[String(DS.id)] || {}) };
    if (Q.isEmpty(q)) delete mine[id]; else mine[id] = q;
    all[String(DS.id)] = mine;
    remember({ quick: all });
  }
  /* スライサー（版 3.41.0。利用者の要望 6）: ダッシュボード全体の期間・設備。この PC の見え方として、ダッシュボードごとに覚える（tpa.dash.v1 の slice） */
  const sliceState = () => ((mem().slice || {})[String(DS.id)]) || null;
  function setSlice(v) {
    const all = { ...(mem().slice || {}) }, x = { ...(v || {}) };
    if (!x.period || !x.period.kind) delete x.period;
    if (!(x.equips || []).length) delete x.equips;
    if (x.period || x.equips || x.set) all[String(DS.id)] = x; else delete all[String(DS.id)];
    remember({ slice: all });
    refresh(false); paintBar();
    if (popEl && DS.pop === "slice") { popEl.innerHTML = D.pickHtml(sliceState(), sliceInfo()); D.mixed(popEl); }
  }
  const canEquip = (src) => !!(WL.dashKit.src.of(src) || {}).equip;
  /** 帯のスライサーの設定（版 3.52.0。ダッシュボードに保存する）: {off: 出さない（効きもしない）, parts: 出す物 period・date・equip} */
  //   見ているときに「スライサー ▾」で変えた物は、この PC の見え方（tpa.dash.v1 の bar）として、ダッシュボードの設定の上に重ねる
  const barMine = () => (mem().bar || {})[String(DS.id)] || {};
  const barCfg = () => ({ ...((DS.layout && DS.layout.slicer) || {}), ...(DS.edit ? {} : barMine()) });
  const barParts = () => barCfg().parts || D.PART_KEYS;
  /** 帯の設定を変える（編集中はダッシュボードに入れ、保存すると全員。見ているときはこの PC だけ） */
  function setBarCfg(patch) {
    const clean = (x) => { const o = {}; if (x.off) o.off = true; if (x.parts && D.PART_KEYS.some((k) => !x.parts.includes(k))) o.parts = D.PART_KEYS.filter((k) => x.parts.includes(k)); return o; };
    if (DS.edit) commit((L) => { const o = clean({ ...(L.slicer || {}), ...patch }); if (Object.keys(o).length) L.slicer = o; else delete L.slicer; });
    else { const all = { ...(mem().bar || {}) }, o = { ...barMine(), ...patch };
      if (o.off === false && !((DS.layout || {}).slicer || {}).off) delete o.off;
      all[String(DS.id)] = o; remember({ bar: all }); }
    refresh(false); paintBar();
    if (DS.layout) DS.layout.panels.forEach((x) => paintPanel(x.id));
    if (popEl && DS.pop === "cfg") popEl.innerHTML = D.cfgHtml(barCfg(), cfgInfo());
  }
  const cfgInfo = () => ({ edit: DS.edit, slicers: DS.layout ? DS.layout.panels.filter((x) => x.visual === "slicer").length : 0 });
  const sliceOf = (p) => (p.noslice || barCfg().off ? null : sliceState());
  /* パネルのスライサー（版 3.52.0。visual slicer）: 押した値は、この PC の見え方としてダッシュボードごと・パネルごとに覚える（tpa.dash.v1 の pick）。
     同じデータのほかのパネル（スライサーのパネルどうしも）を、その列の値で絞る（in の条件）。自分は絞らない（値の札は全部出して、選びを見せる） */
  const pickOf = (id) => ((mem().pick || {})[String(DS.id)] || {})[id] || [];
  function setPick(id, vals) {
    const all = { ...(mem().pick || {}) }, mine = { ...(all[String(DS.id)] || {}) };
    if ((vals || []).length) mine[id] = vals.slice(); else delete mine[id];
    if (Object.keys(mine).length) all[String(DS.id)] = mine; else delete all[String(DS.id)];
    remember({ pick: all });
    refresh(false);
    if (DS.layout) DS.layout.panels.forEach((x) => paintPanel(x.id));
  }
  /** スライサーのパネルの列（行の段 1 つ目） */
  const pickColumn = (s) => (((s.body || {}).rows || [])[0] || {}).column || "";
  /** p を絞るスライサーのパネルの条件 → [{source, filter, id}]（同じデータ・選んだ値があるもの） */
  const pickFilters = (p) => (DS.layout ? DS.layout.panels : []).filter((s) => s.visual === "slicer" && s.id !== p.id && pickColumn(s) && pickOf(s.id).length)
    .map((s) => ({ id: s.id, source: s.source, filter: { column: pickColumn(s), op: "in", value: JSON.stringify(pickOf(s.id)) } }));
  /** パネルのスライサーの選びを当てる（合わせた表はまとまりごと・合わせたデータは同じデータの側だけ） */
  function withPicks(p) {
    const fs = pickFilters(p); if (!fs.length || p.noslice) return p;
    const x = WL.dashKit.clone(p), add = (o) => { const mine = fs.filter((f) => f.source === o.source).map((f) => f.filter); if (mine.length) o.filters = (o.filters || []).concat(mine); };
    if (x.visual === "board") (x.groups || []).forEach(add); else if (x.link) (x.link.sides || []).forEach(add); else add(x);
    return x;
  }
  /** スライサーのパネルを描くときの組み（選んだ値・効くパネルの数・データの名前を添える） */
  const slicerView = (p) => (p.visual !== "slicer" ? p : { ...p, _picked: pickOf(p.id), _srcName: (WL.dashKit.src.of(p.source) || {}).name || "",
    _hits: (DS.layout ? DS.layout.panels : []).filter((x) => x.id !== p.id && !x.noslice && (x.visual === "board" ? x.groups || [] : x.link ? x.link.sides || [] : [x]).some((o) => o.source === p.source)).length });
  /* 日付の暦（版 3.52.0）: 見ている月と、押した始めの日（終わりを待っている） */
  const cal = { month: "", from: "" };
  function openCal() {
    const per = (sliceState() || {}).period || {}, t = today() || new Date().toISOString().slice(0, 10);
    cal.month = (per.kind === "range" ? per.to || per.from : t).slice(0, 7); cal.from = "";
    openPop("date", "#dashSlicer [data-ds-date]", D.calHtml(cal, per, t), "dash-calpop");
  }
  const paintCal = () => { if (popEl && DS.pop === "date") popEl.innerHTML = D.calHtml(cal, (sliceState() || {}).period || {}, today()); };
  function setRange(a, b) {
    const [from, to] = [a, b || a].sort();
    cal.from = ""; setSlice({ ...(sliceState() || {}), period: { kind: "range", from, to } });
    closePop(); say(`日付 ${D.rangeWord({ from, to })} で数えています`);
  }
  /** p に効いているパネルのスライサー → [{id, column, values}] */
  const picksOn = (p) => (p.noslice ? [] : pickFilters(p).filter((f) => (p.visual === "board" ? p.groups || [] : p.link ? p.link.sides || [] : [p]).some((o) => o.source === f.source))
    .map((f) => ({ id: f.id, column: f.filter.column, values: pickOf(f.id) })));
  /** 答えの「いま」（月の名前を、サーバーのいまで決める） */
  const today = () => { for (const a of DS.answers.values()) { const n = a && a.d && (a.d.now || ((a.d.groups || [])[0] || {}).now); if (n) return n.slice(0, 10); } return ""; };
  function sliceInfo() {
    const sl = sliceState(), ps = DS.layout ? DS.layout.panels : [];
    const hits = ps.filter((p) => { const h = Q.sliceHits(p, sl, canEquip); return h.period || h.equip; }).length;
    return { tree: DS.tree || {}, today: today(), hits, total: ps.length, open: DS.pop === "slice", parts: barParts(), dateOpen: DS.pop === "date", cfgOpen: DS.pop === "cfg" };
  }
  WL.dashPanels.setEquipOrder(() => (DS.tree && DS.tree.names) || []);     // 設備の色の並び（どのパネルでも同じ設備は同じ色）
  async function loadTree() {
    try { const r = await WL.dashKit.fetch("/api/dashboard/equip-tree", { cache: "no-store" }); if (r.ok) DS.tree = await r.json(); } catch (e) { WL.quiet.note("設備の木を読めない（スライサーの設備の札が出ないだけ）", e); }
    paintBar();
    if (DS.layout) DS.layout.panels.forEach((p) => paintPanel(p.id, true));     // 添え書きの設備をグループの名前で（設備グループが分かってから）
    if (popEl && DS.pop === "slice") { popEl.innerHTML = D.pickHtml(sliceState(), sliceInfo()); D.mixed(popEl); }
  }
  /** 数えるときのパネル（組んだパネル＋スライサー＋この PC のパネルの絞り込み） */
  const asked = (p) => withPicks(Q.merge(Q.slice(p, sliceOf(p), canEquip), quickOf(p.id)));
  const qkey = (p0) => { const p = asked(p0); return JSON.stringify(p.visual === "board" ? [p.visual, p.rows, p.groups, p.equips, p.egroup, p.filters, p.order, p.calc] : [p.visual, p.source, p.equip, p.equips, p.egroup, p.esplit, p.link, p.body, p.filters, p.search, p.period, p.basis, p.calc, p.ops, p.eorder]); };   // 数を引き直す組み（題・見せ方・書式・置き場は入れない。サーバーが読む項目は全部入れる: 合わせた表の order〈見出しの設備グループ〉も。版 3.43.0）

  async function loadList() {
    const r = await WL.dashKit.fetch("/api/dashboards", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "ダッシュボードを読めませんでした");
    Object.assign(DS, { list: d.items || [], login: d.login || "", canEditCommon: !!d.canEditCommon, canEditDefault: !!d.canEditDefault,
      standardId: d.standardId, rowsRange: d.rowsRange || [4, 16], hidden: d.hidden || [] });
  }
  /* ---------------- セット（版 3.46.0。利用者の要望 2026-10-21 の 7）: いくつかのダッシュボードの束を、道具の行のタブで切り替える。
     置き場は /api/dashboard-sets（共通デフォルト＝開発者の標準のセット・共通・自分のパターンと ★標準。ダッシュボードと同じ決まり）。
     いま使っているセットはこの PC に覚える（tpa.dash.v1 の set。"" はセットを使わない）。覚えが無ければ ★標準のセット ---------------- */
  async function loadSets() {
    try {
      const r = await WL.dashKit.fetch("/api/dashboard-sets", { cache: "no-store" }), d = await r.json();
      if (r.ok) Object.assign(DS, { sets: d.items || [], setStd: d.standardId ?? null, setMax: d.max || 12 });
    } catch (_) { DS.sets = []; }
    const m = mem();
    const want = m.set === "" ? null : m.set != null ? m.set : DS.setStd;
    DS.setId = DS.sets.some((x) => String(x.id) === String(want)) ? want : m.set === "" ? null : DS.setStd;
  }
  const curSet = () => DS.sets.find((x) => String(x.id) === String(DS.setId)) || null;
  /** セットのダッシュボード（見えない物・消えた物は飛ばす） */
  const setDash = (st = curSet()) => (st ? [...new Set(st.body.items.map(byId).filter(Boolean))] : []);
  /** セットのタブに入っているか（組み込みを入れ替えた物は、組み込みの id でも） */
  const inItems = (st, x) => !!(st && x && (st.body.items.includes(String(x.id)) || (x.replaces && st.body.items.includes(x.replaces))));
  const itemKey = (st, x) => (st.body.items.includes(String(x.id)) ? String(x.id) : x.replaces || String(x.id));
  function useSet(id) {
    DS.setId = id == null ? null : id; remember({ set: id == null ? "" : id });
    const ds = setDash();
    if (ds.length && !ds.some((x) => String(x.id) === String(DS.id))) open(ds[0].id); else paintBar();
  }
  async function writeSet(method, id, body, done) {
    const r = await WL.dashKit.fetch(id ? `/api/dashboard-sets/${id}` : "/api/dashboard-sets", method === "DELETE" ? { method } : WL.dashKit.json(method, body));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { say("✕ " + (d.error || (r.status === 409 ? "ほかの PC が先に直しました。開き直してください。" : `保存できませんでした（${r.status}）`))); return null; }
    await loadSets();
    if (method === "POST") useSet(d.id); else paintBar();
    if (done) say(done);
    return d;
  }
  /** いまのセットの並びを書き換える（入れる・外す・左右へ）。書けないセットなら、自分のセットとして作るように知らせる */
  async function editSet(items, done) {
    const st = curSet(); if (!st) return;
    if (!st.canEdit) { say(`「${st.name}」は書き換えられません（${SCOPE_NAME[st.scope]}）。「セットとして保存…」で自分のセットにしてください`); return; }
    if (!items.length) { say("セットには 1 つ以上のダッシュボードが要ります（セットを消すときは「このセットを消す」）"); return; }
    await writeSet("PUT", st.id, { body: { items }, base_rev: st.rev }, done);
  }
  async function loadSources() {
    try { const d = await (await WL.dashKit.fetch("/api/dashboard/sources")).json(); WL.dashKit.src.set(d); DS.sources = d.items || []; DS.egroupSets = d.egroupSets || []; } catch (_) { DS.sources = []; DS.egroupSets = []; }
  }
  /** 開く: 覚えた物 → 標準 → 組み込み */
  function open(id, { keepEdit = false } = {}) {
    // 並びを読んでいる最中に開くよう言われたら、読み終えてから開く（前は空のグリッドを置いてしまい、読み終えても開かなかった・§9.628）
    if (DS.loading && !DS.list.length) { DS.want = id; return; }
    const it = byId(id) || byId(DS.standardId) || DS.list[DS.list.length - 1];
    if (!it) {           // ダッシュボードが 1 つも無い（組み込みも外した。版 3.48.0）: 空のグリッドに、作る・戻すの知らせ
      DS.id = null; DS.layout = { rows: 8, panels: [] }; DS.saved = JSON.stringify(DS.layout); DS.history = []; DS.sel = ""; DS.edit = false;
      paint(); return;
    }
    DS.id = it.id; DS.layout = WL.dashKit.clone(it.body); DS.saved = JSON.stringify(DS.layout); DS.history = []; DS.sel = "";
    if (!keepEdit) DS.edit = false;
    remember({ id: it.id });
    paint(); refresh();
  }

  /* ---------------- 数を引く ---------------- */
  // 答えに通し番号を付ける（描き直すかの決め手。版 3.41.0: 組み替え・保存のたびに全部のパネルを描き直していた）
  let ansSeq = 0;
  const setAnswer = (id, a) => { a.n = ++ansSeq; DS.answers.set(id, a); };
  /** 「パネル共通」が答えで変わったら、道具の行と全部のパネルを描き直す（パネルに出す項目は共通との違いなので） */
  function syncCommon() {
    const sig = JSON.stringify(commonMeta());
    if (sig === DS.cmSig) return;
    DS.cmSig = sig;
    paintBar();
    ((DS.layout || {}).panels || []).forEach((q) => paintPanel(q.id));
  }
  async function queryPanel(p) {
    const k = qkey(p), old = DS.answers.get(p.id);
    setAnswer(p.id, { ...(old || {}), key: k, busy: true });
    paintPanel(p.id);
    let a;
    try {
      const r = await WL.dashKit.fetch("/api/dashboard/query", WL.dashKit.json("POST", { panel: asked(p) }));
      const d = await r.json().catch(() => ({}));
      a = r.ok ? { key: k, d } : { key: k, err: d.error || `読めませんでした（${r.status}）`, kind: d.kind || "error", d: old && old.key === k ? old.d : null };
    } catch (e) { a = { key: k, err: String(e), kind: "error" }; }
    const now = panelOf(p.id);
    if (!now || qkey(now) !== k) return;                 // 引いている間に組みが変わった（新しい方が引き直す）
    setAnswer(p.id, a);
    paintPanel(p.id);
    syncCommon();
    if (DS.editing === p.id && E.isOpen()) E.answered();
    // 写している最中: 答え全部（kind）か、合わせた表のまとまりか、写し終えていない設備がある（写し終えた設備だけの途中の数。版 3.46.0）
    const stillCopying = (x) => !!x && (x.kind === "copying" || (x.failed || []).some((f) => f.kind === "copying"));
    const copying = stillCopying(a) || (a.d && (stillCopying(a.d) || (a.d.groups || []).some(stillCopying)));
    if (copying) setTimeout(() => { const q = panelOf(p.id); if (q && DS.active && qkey(q) === k) queryPanel(q); }, RETRY_MS);
  }
  /** 全部を引き直す（force でなければ、組みが変わったパネルだけ） */
  function refresh(force = true) {
    if (!DS.layout) return;
    DS.at = Date.now();
    const ps = DS.layout.panels;
    ps.forEach((p) => { const a = DS.answers.get(p.id); if (force || !a || a.key !== qkey(p)) queryPanel(p); });
    paintBar();
  }

  /* ---------------- 描く ---------------- */
  // パネルの中の札で見せ方を替えた（ABC 分析の設備の札など。版 3.46.0）: そのパネルだけ描き直す（数は引き直さない）
  document.addEventListener("dash:repaint", (e) => { const el = e.target.closest && e.target.closest(".dash-p"); if (el) paintPanel(el.dataset.id, true); });
  function paint() {
    const box = $("#dashScreen");
    if (!box) return;
    paintBar();
    const g = $("#dashGrid");
    if (!DS.layout) { g.innerHTML = `<p class="dash-wait">${esc(DS.msg || "読んでいます…")}</p>`; return; }
    box.classList.toggle("is-edit", DS.edit);
    g.style.setProperty("--rows", DS.layout.rows);
    g.style.gridTemplateRows = `repeat(${DS.layout.rows}, minmax(0, 1fr))`;
    const ids = new Set(DS.layout.panels.map((p) => p.id));
    [...g.querySelectorAll(".dash-p")].forEach((el) => { if (!ids.has(el.dataset.id)) el.remove(); });
    DS.layout.panels.forEach((p) => {
      let el = g.querySelector(`.dash-p[data-id="${CSS.escape(p.id)}"]`);
      if (!el) {
        el = document.createElement("section");
        el.className = "dash-p"; el.dataset.id = p.id;
        el.innerHTML = '<div class="dash-ph"></div><div class="dash-psub"></div><div class="dash-pq" hidden></div><div class="dash-pb"></div><div class="dash-pf" hidden></div>' + ["nw", "ne", "sw", "se"].map((d) => `<i class="dash-rz" data-rz="${d}" aria-hidden="true"></i>`).join("");
        g.append(el);
        if (ro) ro.observe(el);
      }
      place(el, p);
    });
    paintCells();
    DS.layout.panels.forEach((p) => paintPanel(p.id));
    // ダッシュボードが 1 つも無い（組み込みも外した。版 3.48.0）: 何をすればよいかをグリッドの真ん中に
    let none = g.querySelector(".dash-none");
    if (!DS.edit && !current() && !DS.layout.panels.length) {
      if (!none) { none = document.createElement("div"); none.className = "dash-none"; g.append(none); }
      none.innerHTML = `<b>ダッシュボードがありません</b><span>左上の ▾ から「＋ 空から作る」か、${(DS.hidden || []).length ? "「外した組み込み」を戻してください" : "ほかのダッシュボードを開いてください"}</span>`
        + `<button type="button" class="mm-btn-primary" data-db-pick>ダッシュボードを選ぶ ▾</button>`;
    } else if (none) none.remove();
  }
  function place(el, p) {
    el.style.gridColumn = `${p.x + 1} / span ${p.w}`;
    el.style.gridRow = `${p.y + 1} / span ${p.h}`;
    el.tabIndex = 0;
    el.classList.toggle("is-sel", DS.edit && DS.sel === p.id);
    el.classList.toggle("is-editing", DS.editing === p.id);
    const frame = p.frame || (p.emph ? "emph" : "card");
    el.classList.toggle("is-emph", frame === "emph");
    ["accent", "plain", "tint"].forEach((f) => el.classList.toggle(`is-frame-${f}`, frame === f));
    el.style.setProperty("--pc", P.seriesColors(p.visual === "board" ? { ...p, source: ((p.groups || [])[0] || {}).source } : p)[0]);
  }
  /** 編集のとき: 空いたマスの印（押すと、そこにパネルを足す） */
  function paintCells() {
    const g = $("#dashGrid");
    g.querySelectorAll(".dash-cell").forEach((x) => x.remove());
    if (!DS.edit) return;
    const used = occupancy();
    for (let y = 0; y < DS.layout.rows; y++) for (let x = 0; x < COLS; x++) {
      if (used[y][x]) continue;
      const c = document.createElement("button");
      c.type = "button"; c.className = "dash-cell"; c.dataset.cell = `${x},${y}`; c.tabIndex = -1;
      c.style.gridColumn = `${x + 1}`; c.style.gridRow = `${y + 1}`;
      c.setAttribute("aria-label", `空き（${x + 1} 列・${y + 1} 段）にパネルを足す`);
      g.prepend(c);
    }
  }
  function titleOf(p) { return p.title || E.autoTitle(p); }
  /* スライサーで期間を替えたパネルは、題の期間の言葉（前日・今月など）をスライサーの期間に置き換えて見せる（版 3.41.0。2026-10-dashslice の 1 回目の採点:
     先月を選ぶと「前日の実績本数」に先月の数が出て、言葉と数が食い違った）。置き換えた所は印を付け、元の題は札の説明に残す */
  /** パネルが組んだ期間の短い言葉（前日・今月・直近 14 日。合わせた表は期間を組んだ最初のまとまり） */
  const ownPeriod = (p) => { const o = (p.visual === "board" ? p.groups || [] : p.link ? p.link.sides || [] : [p]).find((x) => x.period && x.period.kind); return o ? sliceWord(o.period) : ""; };
  const PERIOD_WORD = /前日|昨日|今日|本日|今月|先月|直近\s*\d+\s*日/;
  function titleHtml(p) {
    const t = titleOf(p), hit = Q.sliceHits(p, sliceOf(p), canEquip);
    if (!hit.period || !PERIOD_WORD.test(t)) return esc(t);
    const m = PERIOD_WORD.exec(t);
    return `${esc(t.slice(0, m.index))}<mark class="dash-tsw" title="スライサーで「${esc(m[0])}」から替えています">${esc(sliceWord(sliceState().period))}</mark>${esc(t.slice(m.index + m[0].length))}`;
  }
  const SPLIT_NAME = { series: "設備ごとの系列", facet: "設備ごとに並べる", sum: "合算" };
  /* 添え書き（§9.628）: 元・設備・期間・条件を分けて持ち、多くのパネルで同じ物は道具の行の「パネル共通」に1回、パネルには違う物だけ。
     前は全パネルが同じ「測定データ・全設備　今月…　条件 1」をくり返し、「条件 1」は何の条件か読めなかった（推測させる物 1728 で27・1536 で30） */
  const META_KEYS = [["src", "元"], ["equip", "設備"], ["per", "期間"], ["cond", "条件"]];
  const condsText = (fs) => (fs || []).map((f) => WL.dashKit.condLabel(f).replace(/\s+/g, " ").trim()).join("・");
  /** パネルの添え書きの項目 {src, equip, per, cond, basis}（スライサーは null）。per は日付の数え方を付けない字（basis が持つ） */
  function metaParts(p, a) {
    if (p.visual === "slicer") return null;
    const name = (k) => (WL.dashKit.src.of(k) || {}).name || k, d = a && a.d;
    if (p.visual === "board") {
      const gs = p.groups || [];
      // 設備・条件は、どのまとまりも同じならパネルの項目として（違えばまとまりの見出しが言う）。期間はまとまりごと（見出しが言う）
      const eqs = [...new Set(gs.map((g) => (g.equips || []).join("\u0001")))], cs = [...new Set(gs.map((g) => condsText(g.filters)))];
      const equip = (p.equips || []).length ? eqWord(p.equips) : eqs.length === 1 ? (eqs[0] ? eqWord(eqs[0].split("\u0001")) : "全設備") : "まとまりごと";
      return { src: [...new Set(gs.map((g) => name(g.source)).filter(Boolean))].join("・"), equip, per: "", cond: cs.length === 1 ? cs[0] : "", basis: "", noPer: true, noCond: cs.length !== 1 };
    }
    if (p.link && (p.link.sides || []).length) {     // 別のデータを合わせたパネル: 設備は合わせるデータの名前・条件はどのデータにもある物
      const sides = p.link.sides, c0 = condsText(sides[0].filters);
      return { src: [...new Set(sides.map((x) => name(x.source)))].join("・"), equip: sides.map((x) => x.title || name(x.source)).join("と"),
        per: d ? P.periodText(p, d, false) : "", cond: sides.every((x) => condsText(x.filters) === c0) ? c0 : "データごとに違います", basis: d ? P.basisOf(p, d) : "" };
    }
    const split = d && d.esplit && (p.equips || []).length !== 1 ? `（${SPLIT_NAME[d.esplit] || ""}）` : "";
    const equip = (p.equips || []).length ? eqWord(p.equips) + split : WL.dashKit.src.isWork(p.source) ? "全設備" + split : "";
    return { src: name(p.source) || (d && d.sourceName) || "", equip, per: d ? P.periodText(p, d, false) : "", cond: condsText(p.filters), basis: d ? P.basisOf(p, d) : "" };
  }
  /** 多くのパネル（半分以上・2 枚以上）で同じ項目 → {src, equip, per, cond, basis}（無い項目は ""）。期間は答えが揃ってから
      @returns {{src: string, equip: string, per: string, cond: string, basis: string}} */
  function commonMeta() {
    const all = ((DS.layout || {}).panels || []).map((p) => metaParts(asked(p), DS.answers.get(p.id))).filter(Boolean);
    const need = Math.max(2, Math.ceil(all.length / 2)), out = { src: "", equip: "", per: "", cond: "", basis: "" };
    for (const [k] of META_KEYS.concat([["basis"]])) {
      const n = new Map();
      all.forEach((x) => { const v = (k === "per" && x.noPer) || (k === "cond" && x.noCond) ? null : x[k]; if (v) n.set(v, (n.get(v) || 0) + 1); });
      const top = [...n].sort((a, b) => b[1] - a[1])[0];
      out[k] = top && top[1] >= need ? top[0] : "";
    }
    // 日付の数え方は、期間のあるパネルがどれも同じときだけ1回で言う（違うパネルがあれば各パネルの期間に付ける）
    const bs = new Set(all.map((x) => x.basis).filter(Boolean));
    out.basis = bs.size === 1 ? [...bs][0] : "";
    return out;
  }
  /** パネルに出す項目: 共通と違う物だけ。共通にある期間・条件をパネルが持たなければ「すべて」「なし」と言い切る → [[名前, 字]] */
  function metaShow(p, a, cm = commonMeta()) {
    const x = metaParts(p, a);
    if (!x) return [];
    const val = (k) => (k === "per" && x.per && !cm.basis && x.basis ? `${x.per}（${x.basis}）` : x[k]);
    return META_KEYS.flatMap(([k, n]) => {
      if ((k === "per" && x.noPer) || (k === "cond" && x.noCond)) return [];
      const v = x[k];
      if (v) return v === cm[k] ? [] : [[n, val(k)]];
      return cm[k] && (k === "per" || k === "cond") ? [[n, k === "per" ? "すべて" : "なし"]] : [];
    });
  }
  const metaItemsHtml = (items) => items.map(([n, v]) => `<span class="dash-mi"><small>${esc(n)}</small>${esc(v)}</span>`).join("");
  const metaItemsText = (items) => items.map(([n, v]) => `${n} ${v}`).join("　");
  /** 道具の行の「パネル共通」（無ければ ""） */
  function commonHtml(cm = commonMeta()) {
    const items = META_KEYS.filter(([k]) => cm[k]).map(([k, n]) => [n, cm[k]]).concat(cm.basis ? [["日付", cm.basis]] : []);
    // 頭の字は「前提」（「共通」はパネルの半分ほどが違う物を持つと事実に合わない・§9.628 の 6 回目の採点）
    return items.length ? `<span class="dash-common" title="${esc(`多くのパネルで同じ物: ${metaItemsText(items)}（違うパネルはパネルの題の下に書いてあります）`)}"><b>このダッシュボードの前提</b>${metaItemsHtml(items)}</span>` : "";
  }
  const NARROW = 360;      // これより狭いパネルの見出しは、操作を「⋯」1 つに畳む（ボタンが見出しからはみ出さない）
  function headHtml(p, a, width, fold = false) {
    const warn = a && a.d ? P.notes(a.d).concat(a.err ? [`いまの数は前の物です（${a.err}）`] : []) : [];
    const badge = warn.length ? `<span class="dash-warnb" title="${esc(warn.join("\n"))}" aria-label="${esc(warn.join("。"))}">⚠ ${warn.length}</span>` : "";
    const tools = DS.edit && (width < NARROW || fold)
      ? `<button type="button" class="dash-pbtn dash-more" data-db-more aria-haspopup="true" title="このパネルの操作（組む・複製・消す）" aria-label="このパネルの操作">⋯</button>`
      : DS.edit
      ? `<button type="button" class="dash-pbtn" data-db-edit title="このパネルを組む（Enter）">組む</button><button type="button" class="dash-pbtn" data-db-dup title="同じパネルを空いた所に足す">複製</button>`
        + `<button type="button" class="dash-pbtn is-danger${DS.confirm === "del:" + p.id ? " is-armed" : ""}" data-db-del title="このパネルを消す（Delete。もう一度押すと消えます）">${DS.confirm === "del:" + p.id ? "消す？" : "消す"}</button>`
      : `<button type="button" class="dash-pbtn dash-quiet" data-db-edit title="このパネルを組み直す（編集に入ります）">組む</button>`;
    // 絞る（見ているとき・編集のときとも。この PC の見え方）。効いていれば数を出す（状態が見える）
    const qn = Q.chips(quickOf(p.id)).length;
    const filt = (width < NARROW || fold) && DS.edit ? "" : `<button type="button" class="dash-pbtn dash-filt${qn ? " is-on" : ""}" data-db-filter aria-haspopup="dialog" title="このパネルだけを、設備・期間・値で絞ります（この PC の見え方）">`
      + `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12l-4.5 5.2V13l-3 1.2V8.2z"/></svg>${qn ? `絞り込み ${qn}` : "絞る"}</button>`;
    return `<h3 title="${esc(titleOf(p))}">${titleHtml(p)}</h3><span class="dash-sp"></span>`
      // 見ているときの「組む」は乗せると出る（いつもは見えない）ので「絞る」の左に置く（「絞る」がパネルの右端にそろう・§9.628 の採点）
      + badge + (a && a.busy ? '<i class="dash-spin" aria-label="読んでいます"></i>' : "") + (DS.edit ? filt + tools : tools + filt);
  }
  /** パネルを描く。組み・答え・大きさ・編集の様子が前に描いた時と同じなら描かない（force で必ず） */
  function paintPanel(id, force = false) {
    const p = panelOf(id), el = document.querySelector(`#dashGrid .dash-p[data-id="${CSS.escape(id)}"]`);
    if (!p || !el) return;
    const a1 = DS.answers.get(id), bd = el.querySelector(".dash-pb");
    const sig = JSON.stringify([{ ...p, x: 0, y: 0 }, a1 ? a1.n : 0, el.clientWidth, el.clientHeight, bd.clientWidth, bd.clientHeight, DS.edit, DS.confirm, quickOf(id), sliceOf(p), picksOn(p), p.visual === "slicer" ? pickOf(id) : 0, DS.sources.length, WL.duration.style(), DS.cmSig]);   // 時間の書き方・パネル共通が変われば描き直す
    if (!force && el._sig === sig) return;
    el._sig = sig;
    // 形を替えた直後は、前の形の答え（合わせた表の答えとふつうの答えは形が違う）では描かない（引き直した答えを待つ）
    const a0 = DS.answers.get(id), a = a0 && a0.d && (p.visual === "board") !== !!a0.d.groups ? { ...a0, d: null, err: "" } : a0;
    const ph = el.querySelector(".dash-ph");
    ph.innerHTML = headHtml(p, a, el.clientWidth);
    el.setAttribute("aria-label", titleOf(p));
    // 添え書き（元・期間・条件）は見出しの下の 2 行目（見出しは題と操作だけで 1 行）。数字の形は数の下に出す
    const items = metaShow(asked(p), a), meta = items.length ? { text: metaItemsText(items), html: metaItemsHtml(items) } : "", subEl = el.querySelector(".dash-psub");
    subEl.hidden = !meta || p.visual === "kpi"; subEl.innerHTML = meta ? meta.html : ""; subEl.title = meta ? meta.text : "";
    // 効いている絞り込みの札（見出しの下。× で 1 つずつ外す）
    const qc = Q.chips(quickOf(id)), qEl = el.querySelector(".dash-pq"), hit = Q.sliceHits(p, sliceOf(p), canEquip), sl = sliceState();
    // スライサーが効いているパネルには札（外すのは道具の行のスライサーで）
    // スライサーが効いているパネルは、見出しの題の横に札（段を増やさない: 1 段の数字のパネルで数が隠れた）。外すのは道具の行のスライサーで
    // 期間は「元の期間→スライサーの期間」（前日→9月・今月→9月。2 回目の採点: 前日と今月のパネルが同じ題と数に見えた）
    // パネルのスライサーで絞られているパネルも同じ札に「列 値」を足す（版 3.52.0。「条件 1」だけでは何で絞ったか分からない）
    const pk = picksOn(p).map((x) => `${x.column === "@equip" ? "設備" : x.column} ${x.values.slice(0, 2).join("・")}${x.values.length > 2 ? ` ほか ${x.values.length - 2}` : ""}`);
    const sw = [hit.period ? `${ownPeriod(p) ? ownPeriod(p) + "→" : ""}${sliceWord(sl.period)}` : "", hit.equip ? eqWord(sl.equips) : ""].concat(pk).filter(Boolean).join("・");
    el.classList.toggle("is-sliced", !!sw);
    const h3 = el.querySelector(".dash-ph h3");
    const badgeHtml = sw ? `<span class="dash-sbadge" title="スライサー（${esc(sw)}）で数えています。外すのは道具の行のスライサーか、スライサーのパネルで"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12l-4.5 5.2V13l-3 1.2V8.2z"/></svg>${esc(sw)}</span>` : "";
    // 形ごとの題の横の札（稼働のパネルは全体の稼働率。dashboard-ops.js）
    const own = a && a.d && WL.dashOps ? WL.dashOps.badge(p, a.d) : "";
    if (own && h3) h3.insertAdjacentHTML("afterend", own);
    if (sw && h3) h3.insertAdjacentHTML("afterend", badgeHtml);
    // 題が切れるなら、印を絵だけに畳む（中身は印の説明に。3 回目の採点: 1280 の数字のパネルで「9月 の実績…」と切れた）・形の札は内訳を隠す
    const tb = el.querySelector(".dash-ph h3"), sb = el.querySelector(".dash-ph .dash-sbadge"), ob = el.querySelector(".dash-ph .og-badge");
    if (tb && ob && tb.scrollWidth > tb.clientWidth + 1) ob.classList.add("is-short");
    const nb = el.querySelector(".dash-ph .og-nbadge");                // 区間なしの札も、題が切れるなら設備の名前を隠す（説明に残る）
    if (tb && nb && tb.scrollWidth > tb.clientWidth + 1) nb.classList.add("is-short");
    if (tb && sb && tb.scrollWidth > tb.clientWidth + 1) sb.classList.add("is-icon");
    // 編集で題が切れるなら、操作を「⋯」1 つに畳む（2026-10-dashslice の 2 回目の採点: 1280 の数字のパネルで題が「前日の実績…」と切れた）
    const t3 = el.querySelector(".dash-ph h3");
    if (DS.edit && t3 && t3.scrollWidth > t3.clientWidth + 1 && !ph.querySelector("[data-db-more]")) {
      ph.innerHTML = headHtml(p, a, el.clientWidth, true);
      if (own) ph.querySelector("h3").insertAdjacentHTML("afterend", own.replace('class="og-badge"', 'class="og-badge is-short"').replace('class="og-nbadge"', 'class="og-nbadge is-short"'));
      if (sw) ph.querySelector("h3").insertAdjacentHTML("afterend", badgeHtml.replace('class="dash-sbadge"', 'class="dash-sbadge is-icon"'));
    }
    qEl.hidden = !qc.length;
    qEl.innerHTML = qc.map((c) => `<span class="dash-qchip">${esc(c.text)}<button type="button" data-db-qdrop="${esc(c.key)}" aria-label="「${esc(c.text)}」の絞り込みを外す">×</button></span>`).join("");
    const body = el.querySelector(".dash-pb"), foot = el.querySelector(".dash-pf");
    const size = { w: body.clientWidth, h: body.clientHeight };
    let note = "";
    if (!a || (!a.d && !a.err)) body.innerHTML = '<p class="dp-wait">数えています…</p>';
    else if (a.err && !a.d) body.innerHTML = errHtml(a);
    else {
      body.classList.toggle("is-busy", !!a.busy);
      note = p.visual === "board" ? P.board(body, p, a.d, size.h, commonMeta()) : P.render(body, slicerView(p), a.d, size, p.visual === "kpi" ? meta : "");
    }
    foot.hidden = !note; foot.textContent = note || ""; foot.title = note || "";
    if (note && body.clientHeight < size.h - 2) {          // 下の知らせの分だけ低くなった: もう一度、新しい高さで描く
      if (a && a.d && p.visual === "board") P.board(body, p, a.d, body.clientHeight, commonMeta());
      else if (a && a.d) P.render(body, slicerView(p), a.d, { w: body.clientWidth, h: body.clientHeight }, p.visual === "kpi" ? meta : "");
    }
  }
  const md = (d) => (d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : "");
  /** スライサーの期間の短い字（日付で決めた期間は 10/5〜10/20・1 日だけなら 10/20。版 3.52.0） */
  const sliceWord = (per) => (per.kind === "range" ? (per.from === per.to || !per.to ? md(per.from) : `${md(per.from)}〜${md(per.to)}`) : per.kind === "days" ? `直近 ${per.n || 7} 日` : per.kind === "month" || per.kind === "this_month" || per.kind === "last_month" ? D.monthName(D.backOf(per), today()) : { today: "今日", yesterday: "前日" }[per.kind] || "");
  /** 設備の並びの短い字: 設備グループとちょうど同じならグループの名前（スライサーの札と同じ言葉）、ほかは 3 つまで */
  const eqWord = (list) => { const g = D.groupsOf(DS.tree || {}, (sliceState() || {}).set).find((x) => !x.none && D.same(x.members, list)); return g ? g.name : `${list.slice(0, 3).map(WL.dashKit.equipWord).join("・")}${list.length > 3 ? ` ほか ${list.length - 3}` : ""}`; };
  function errHtml(a) {
    if (a.kind === "copying") return '<p class="dp-wait">共有から写しています。写し終えると出ます…</p>';
    return `<div class="dp-err"><b>数えられませんでした</b><span>${esc(a.err)}</span><button type="button" class="pv-btn" data-db-edit>パネルを組み直す</button></div>`;
  }

  /* ---------------- 道具の行 ---------------- */
  function paintBar() {
    const bar = $("#dashBar"); if (!bar) return;   // 道具の行（.dash-tools）
    const it = current(), std = it && String(it.id) === String(DS.standardId);
    const t = DS.at ? new Date(DS.at) : null, when = t ? `${WL.dashKit.pad2(t.getHours())}:${WL.dashKit.pad2(t.getMinutes())}` : "";
    const st = curSet(), ds = setDash(st);
    const icon = `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>`;
    // セットを使っているとき（版 3.46.0）: 選ぶ札はセットの名前、ダッシュボードは右のタブ（いまの物がセットの外なら、点線のタブで足して見せる）
    // セットの札とタブは 1 つの枠（束の名前とその中身を 1 つの塊に。同じ G）
    const pick = st && !DS.edit
      ? `<div class="dash-setbox"><button type="button" class="dash-pick is-set" data-db-pick aria-haspopup="true" aria-expanded="${DS.pop === "pick"}" title="セットを替える・作る・★標準にする／ダッシュボードをセットに入れる・外す">`
        + `${icon}<b>${esc(st.name)}</b><small>セット・${esc(SCOPE_NAME[st.scope] || "")}</small>${String(st.id) === String(DS.setStd) ? '<i class="dash-std" title="標準のセット（アプリを開いたときに出す物）">★</i>' : ""}<i aria-hidden="true">▾</i></button>`
        + `<div class="dash-tabs" role="tablist" aria-label="セットのダッシュボード">${ds.map((x, i) => `<button type="button" role="tab" class="dash-tab${String(x.id) === String(DS.id) ? " on" : ""}" aria-selected="${String(x.id) === String(DS.id)}" data-db-tab="${esc(String(x.id))}" title="${esc(x.name)}">${esc(x.name)}</button>`).join("")}`
        + (it && !ds.some((x) => String(x.id) === String(it.id)) ? `<button type="button" role="tab" class="dash-tab is-out on" aria-selected="true" title="セットに入っていないダッシュボード（▾ の面でセットに入れられます）">${esc(it.name)}</button>` : "") + "</div></div>"
      : `<button type="button" class="dash-pick" data-db-pick aria-haspopup="true" aria-expanded="${DS.pop === "pick"}" title="ほかのダッシュボードを開く・標準にする・名前を変える・消す・セットを使う">`
      + `${icon}<b>${esc(it ? it.name : "ダッシュボード")}</b>${it ? `<small>${esc(SCOPE_NAME[it.scope] || "")}${it.builtin ? "・組み込み" : it.replaces ? "・組み込みと入れ替え" : ""}</small>` : ""}${std ? '<i class="dash-std" title="標準（最初に開く物）">★</i>' : ""}<i aria-hidden="true">▾</i></button>`;
    const msg = `<span class="dash-msg" aria-live="polite">${esc(DS.msg)}</span>`;
    if (!DS.edit) {
      // 並び（§9.628 の採点）: 選ぶ札｜パネル共通（何のダッシュボードの前提か）｜…｜時点・引き直す・編集（右端。ダッシュボードを替えても動かない）
      bar.innerHTML = pick + (DS.layout ? commonHtml() : "") + msg + `<span class="dash-sp"></span>${barCfg().off && DS.layout ? D.cfgBtn(sliceInfo(), true) : ""}<small class="dash-when" title="出ているあいだは 1 分ごとに引き直します">${when ? `${when} 時点` : ""}</small>`
        + `<button type="button" class="pv-btn" data-db-refresh title="いま引き直す">↻ 引き直す</button>`
        // ダッシュボードが 1 つも無いときは「編集」を出さない（何を編集するのか分からない。空の画面の知らせから作る・戻す）
        + (it ? `<button type="button" class="mm-btn-primary dash-editbtn" data-db-editmode title="パネルを足す・動かす・大きさを変える・組む">編集</button>` : "");
      paintSlicer();
      return;
    }
    const rows = `<label class="pv-ck" title="グリッドの段の数（多いほど 1 段が低い）">段<select data-db-rows>${Array.from({ length: DS.rowsRange[1] - DS.rowsRange[0] + 1 }, (_, i) => DS.rowsRange[0] + i)
      .map((n) => `<option${n === DS.layout.rows ? " selected" : ""}${n < minRows() ? " disabled" : ""}>${n}</option>`).join("")}</select></label>`;
    const canSave = canSaveIt(it);
    const leave = DS.confirm === "leave"
      ? `<span class="dash-armed">変えた所を捨てますか</span><button type="button" class="mm-btn-ghost" data-db-stay>戻る</button><button type="button" class="pv-btn is-danger" data-db-discard>捨てる</button>`
      : `<button type="button" class="mm-btn-ghost" data-db-leave>${dirty() ? "やめる" : "編集を終える"}</button>`;
    paintSlicer();
    const sl = sliceState(), sw = sl ? [sl.period && sl.period.kind ? sliceWord(sl.period) : "", (sl.equips || []).length ? eqWord(sl.equips) : ""].filter(Boolean).join("・") : "";
    bar.innerHTML = pick + `<span class="dash-editing">編集中</span>`
      + (sw ? `<button type="button" class="dsl-mini" data-ds-clear title="スライサー（${esc(sw)}）が効いています。押すと外します">スライサー ${esc(sw)} ×</button>` : "")
      + `<button type="button" class="pv-btn" data-db-add title="空いた所にパネルを足して、組む所を開きます">＋ パネル</button>${rows}`
      + `<button type="button" class="pv-btn" data-ds-cfg aria-haspopup="dialog" title="帯のスライサーを出す・出さない／出す物（このダッシュボードの設定。保存すると全員）／列の値で絞るパネルを足す">スライサー${barCfg().off ? " OFF" : ""} ▾</button>`
      + `<button type="button" class="pv-btn" data-db-undo${DS.history.length ? "" : " disabled"} title="元に戻す（Ctrl+Z）">元に戻す</button>`
      + msg + `<span class="dash-sp"></span>${leave}`
      + (canSave ? `<button type="button" class="mm-btn-primary" data-db-save${dirty() ? "" : " disabled"}${it.builtin ? ` title="${esc(swapWord(it))}"` : ""}>保存</button>` : "")
      + `<button type="button" class="${canSave ? "pv-btn" : "mm-btn-primary"}" data-db-saveas aria-haspopup="true" title="名前を付けて、別のダッシュボードとして保存します">名前を付けて保存…</button>`;
  }
  /** スライサーの帯（道具の行の下の細い帯。2026-10-dashslice の 3 回目で決めた C2）。編集のときは出さない（道具の行の「スライサー … ×」で分かる）。
      帯にも入り切らない狭い窓だけ、詰めた形（選ぶ欄） */
  function paintSlicer() {
    const w = $("#dashSlicer"); if (!w) return;
    w.hidden = !!DS.edit || !DS.layout || !!barCfg().off;
    if (w.hidden) return;
    w.innerHTML = D.barHtml(sliceState(), sliceInfo());
    if (w.scrollWidth > w.clientWidth + 1) w.innerHTML = D.compactHtml(sliceState(), sliceInfo());
  }
  const say = (t) => { DS.msg = t || ""; const m = document.querySelector("#dashBar .dash-msg"); if (m) m.textContent = DS.msg; clearTimeout(sayT); if (t) sayT = setTimeout(() => { DS.msg = ""; const n = document.querySelector("#dashBar .dash-msg"); if (n) n.textContent = ""; }, 6000); };

  /* ---------------- 浮かぶ面（ダッシュボードを選ぶ・名前を付けて保存・1 枚の表の条件） ---------------- */
  let popEl = null, popOff = null;
  function closePop() { if (popOff) popOff(); popOff = null; if (popEl) popEl.remove(); popEl = null; DS.pop = null; paintBar(); }
  /** anchor … 開く元の要素か、その選び方（字）。前の面を閉じると道具の行を描き直すので、要素はそのあとで探し直す
      （描き直しで外れた要素の下に開いて、面が左上に出ていた: 2026-10-dashslice の 1 回目の採点） */
  function openPop(kind, anchor, html, cls = "") {
    const sel = typeof anchor === "string" ? anchor : null;
    closePop();
    if (sel || !anchor.isConnected) anchor = document.querySelector(sel || `[data-db-${kind}]`) || anchor;
    DS.pop = kind;
    popEl = document.createElement("div");
    popEl.className = `dash-pop ${cls}`; popEl.setAttribute("role", "dialog");
    popEl.innerHTML = html;
    document.body.append(popEl);
    WL.dashKit.placeBelow(popEl, anchor);
    popOff = WL.dashKit.dismissable(popEl, closePop, { keep: { contains: (t) => !!(t && t.closest && t.closest(kind === "slice" ? "[data-ds-pick]" : kind === "date" ? "[data-ds-date]" : kind === "cfg" ? "[data-ds-cfg]" : `[data-db-${kind}]`)) } });
    popEl.addEventListener("click", onPopClick);
    popEl.addEventListener("change", onPopChange);
    paintBar();
    return popEl;
  }
  function pickHtml() {
    const it = current(), st = curSet();
    const row = (x) => `<button type="button" class="dash-li${String(x.id) === String(DS.standardId) ? " is-std" : ""}${String(x.id) === String(DS.id) ? " on" : ""}" data-db-open="${esc(String(x.id))}">`
      + `<b>${esc(x.name)}</b>${starHtml(x)}`
      // いまのセットのタブに入っている物に印（同じ採点: 面の中で、どれがセットに入っているかが見えなかった）
      + `${x.replaces ? `<i class="dash-swap" title="組み込みの「${esc(x.name)}」の代わりに出しています（▾ の「組み込みに戻す」で戻せます）">組み込みと入れ替え</i>` : ""}`
      + `${inItems(st, x) ? `<i class="dash-inset" title="いまのセット「${esc(st.name)}」のタブに入っています">タブ</i>` : ""}<small>${x.body.panels.length} 枚${x.builtin ? "・組み込み" : ""}</small></button>`;
    const list = SCOPE_ORDER.map((k) => { const xs = DS.list.filter((x) => x.scope === k); return xs.length ? `<div class="dash-lg">${groupHead(k)}${xs.map(row).join("")}</div>` : ""; }).join("");
    const canStd = it && !it.builtin && it.canEdit && String(it.id) !== String(DS.standardId);
    // 消す（版 3.48.0）: 組み込みは一覧から外す（開発者は全員の・ほかの人は自分の）。入れ替えた物は「組み込みに戻す」も
    const canDel = it && (it.builtin ? canSaveIt(it) : it.canEdit);
    const swapped = it && it.replaces && it.canEdit;
    // 面は 2 列（左＝セット・右＝ダッシュボード。2026-10-sets の 2 回目で決めた G: 1 列では 1280 で面の下が画面の外へ切れた）
    return `<div class="dash-pcol">${setsHtml()}</div><div class="dash-pcol"><div class="dash-pophead"><b>ダッシュボード</b><small>${STAR_RULE}</small></div>${list}`
      + `<div class="dash-popacts">${canStd ? `<button type="button" class="pv-btn" data-db-std title="アプリを開いたときに「${esc(it.name)}」を出します（${esc(SCOPE_NAME[it.scope])}の★）">★ 最初に開く物にする</button>` : ""}`
      + `<button type="button" class="pv-btn" data-db-new title="パネルの無いダッシュボードを、編集で作り始めます">＋ 空から作る</button>`
      + (swapped ? `<button type="button" class="pv-btn" data-db-unswap title="入れ替えた物を消して、組み込みの「${esc(it.name)}」に戻します">組み込みに戻す</button>` : "")
      + (canDel ? `<button type="button" class="pv-btn is-danger${DS.confirm === "remove" ? " is-armed" : ""}" data-db-remove title="${esc(it.builtin || it.replaces ? `${hideWord()}（「外した組み込み」から戻せます）` : "")}">${DS.confirm === "remove" ? "もう一度押すと消えます" : "いまの物を消す"}</button>` : "") + "</div>"
      + hiddenHtml() + "</div>";
  }
  /** 置き場の見出し（名前と、だれに見えて・だれが直せるか） */
  const groupHead = (k) => WL.dashKit.scope.head(k);
  /** ★: いま効いている物（最初に開く）は塗り、★を付けたが先の置き場の★に負けている物は白抜き（なぜ開かないかが見える） */
  const starHtml = (x) => (String(x.id) === String(DS.standardId) ? '<i class="dash-std" title="アプリを開いたときに最初に出す物">★ 最初に開く</i>'
    : x.standard ? `<i class="dash-std is-off" title="★を付けていますが、${esc(SCOPE_NAME[(byId(DS.standardId) || {}).scope] || "先の置き場")}の★が先に効いています">☆</i>` : "");
  /* ---- 組み込みを外す・入れ替える（版 3.48.0。利用者の要望 2026-10-21 の 3 回目の 1） ---- */
  const swapWord = (it) => `組み込みの「${it.name}」を、直した物と入れ替えます（${DS.canEditDefault ? "全員の一覧で。全員の既定" : "自分の一覧だけ"}）`;
  const hideWord = () => (DS.canEditDefault ? "全員の一覧から外します（全員の既定）" : "自分の一覧から外します");
  /** 外した組み込みの並びと「戻す」（戻せるのは、外した置き場を書ける人） */
  function hiddenHtml() {
    const xs = DS.hidden || [];
    if (!xs.length) return "";
    const ok = (x) => (x.scope === "default" ? DS.canEditDefault : !!DS.login);
    return `<div class="dash-lg dash-hid"><span>外した組み込み</span>${xs.map((x) => `<div class="dash-hidli"><b>${esc(x.name)}</b><small>${x.scope === "default" ? "全員の一覧から" : "自分の一覧から"}</small>`
      + `<button type="button" class="pv-btn" data-db-unhide="${esc(x.id)}" data-scope="${x.scope}"${ok(x) ? "" : ' disabled title="全員の一覧から外した物を戻せるのは、開発者だけです"'}>戻す</button></div>`).join("")}</div>`;
  }
  /** 外した組み込みの鍵を書く（scope の分を keys に） */
  async function writeHidden(scope, keys) {
    const r = await WL.dashKit.fetch("/api/dashboards-hidden", WL.dashKit.json("PUT", { scope, keys }));
    if (!r.ok) { say("✕ " + ((await r.json().catch(() => ({}))).error || `書けませんでした（${r.status}）`)); return false; }
    await loadList();
    return true;
  }
  const hiddenKeys = (scope) => (DS.hidden || []).filter((x) => x.scope === scope).map((x) => x.id.slice(2));
  /** セットの段（面の上）: セットの並び（自分・共通・共通デフォルト。★標準）と「使わない」・いまのセットの操作 */
  function setsHtml() {
    const st = curSet(), it = current(), ds = setDash(st), inSet = inItems(st, it);
    // 置き場の言葉はダッシュボードと同じ（自分・共通・共通デフォルト。2026-10-sets の 1 回目の採点: 札は「共通デフォルト」・面は「標準のセット」で揃っていなかった）
    const row = (x) => `<button type="button" class="dash-li dash-setli${String(x.id) === String(DS.setId) ? " on" : ""}" data-db-set="${esc(String(x.id))}">`
      + `<b>${esc(x.name)}</b>${String(x.id) === String(DS.setStd) ? '<i class="dash-std" title="アプリを開いたときに最初に出すセット">★ 最初に開く</i>' : ""}<small>${setDash(x).length} 枚</small>`
      // 中のダッシュボードの名前（開かずに中身が分かる。同じ G）
      + `<span class="dash-setin">${esc(setDash(x).map((d) => d.name).join("・"))}</span></button>`;
    const list = SCOPE_ORDER.map((k) => { const xs = DS.sets.filter((x) => x.scope === k); return xs.length ? `<div class="dash-lg">${groupHead(k)}${xs.map(row).join("")}</div>` : ""; }).join("");
    const none = `<button type="button" class="dash-li${DS.setId == null ? " on" : ""}" data-db-set=""><b>セットを使わない</b><small>1 枚ずつ開く</small></button>`;
    const pos = st && it ? st.body.items.indexOf(itemKey(st, it)) : -1;
    const acts = st ? `<div class="dash-popacts dash-setacts">`
      // 何に効くかを名前で言う（同じ 1 回目の採点: 外す・左へ・右へが、どのダッシュボードに効くのかを推測させた）
      + (st.canEdit ? (inSet ? `<span class="dash-setfor">「${esc(it.name)}」のタブ</span><button type="button" class="pv-btn" data-db-setmove="-1"${pos > 0 ? "" : " disabled"} title="「${esc(it.name)}」のタブを左へ">← 左へ</button><button type="button" class="pv-btn" data-db-setmove="1"${pos >= 0 && pos < st.body.items.length - 1 ? "" : " disabled"} title="「${esc(it.name)}」のタブを右へ">右へ →</button>`
        + `<button type="button" class="pv-btn" data-db-setout title="「${esc(it.name)}」を、このセットのタブから外します">− セットから外す</button>`
        : `<button type="button" class="pv-btn" data-db-setin${it && ds.length < DS.setMax ? "" : " disabled"} title="いまのダッシュボードを、このセットのタブの最後に足します">＋「${esc(it ? it.name : "")}」をセットに入れる</button>`) : "")
      + (String(st.id) !== String(DS.setStd) && st.canEdit ? '<button type="button" class="pv-btn" data-db-setstd title="アプリを開いたときに、このセットを出します">★ 最初に開くセットにする</button>' : "")
      + (st.canEdit ? `<button type="button" class="pv-btn is-danger${DS.confirm === "setdel" ? " is-armed" : ""}" data-db-setdel>${DS.confirm === "setdel" ? "もう一度押すと消えます" : "このセットを消す"}</button>` : "")
      + "</div>" : "";
    return `<div class="dash-pophead"><b>セット</b><small>いくつかのダッシュボードの束。道具の行のタブで切り替えます（★の決まりはダッシュボードと同じ）</small></div>`
      + `<div class="dash-lg">${none}</div>${list}${acts}`
      + `<div class="dash-popacts"><button type="button" class="pv-btn" data-db-setsave title="${st ? "いまのセットのタブの並びを、名前を付けて別のセットとして置きます" : "いまのダッシュボードから、新しいセットを作ります"}">＋ セットとして保存…</button></div>`;
  }
  function setSaveHtml() {
    const st = curSet(), it = current();
    const items = st ? st.body.items.slice() : it ? [String(it.id)] : [];
    const names = items.map((k) => (DS.list.find((x) => String(x.id) === String(k)) || {}).name).filter(Boolean);
    return `<div class="dash-pophead"><b>セットとして保存</b><small>${esc(names.join("・") || "（ダッシュボードがありません）")} をタブに並べたセットを置きます</small></div>`
      + `<label class="dash-field">名前<input id="dbSetName" maxlength="40" value="${esc(st ? `${st.name} のコピー` : "わたしのセット")}"></label>`
      + scopeField("dbSetScope", DS.canEditDefault ? "default" : "me")
      + `<label class="pv-ck"><input type="checkbox" id="dbSetStd" checked>★ 最初に開くセットにする</label>`
      + `<div class="dash-popacts"><span class="dash-sp"></span><button type="button" class="mm-btn-primary" data-db-dosetsave data-items="${esc(JSON.stringify(items))}">保存</button></div><p class="dash-poperr" aria-live="polite"></p>`;
  }
  /** 置き場の選び（名前と、だれに見えて・だれが直せるか。書けない置き場は理由を添えて押せない） */
  function scopeField(name, cur) {
    const ok = { me: [!!DS.login, "ログイン ID が分かりません"], all: [DS.canEditCommon, "全員（共有）に置けるのは、マスタを書ける権限の人だけです"], default: [DS.canEditDefault, ""] };
    return `<div class="dash-field"><span>置き場</span>${SCOPE_ORDER.filter((k) => k !== "default" || DS.canEditDefault).map((k) => `<label class="dash-radio${ok[k][0] ? "" : " is-off"}" title="${esc(ok[k][0] ? "" : ok[k][1])}">`
      + `<input type="radio" name="${name}" value="${k}"${k === cur ? " checked" : ""}${ok[k][0] ? "" : " disabled"}><b>${scopeIcon(k)}${SCOPES[k].name}</b>`
      + `<small><i>見える</i>${SCOPES[k].see}<br><i>直せる</i>${SCOPES[k].edit}</small></label>`).join("")}</div>`;
  }
  function saveAsHtml() {
    const it = current();
    // 最初の置き場と名前: いまの物の置き場（書けるなら）と名前。同じ名前なら「上書き」と出る（版 3.49.0: 前は必ず「〜 のコピー」・自分で、
    // 「標準」と打ち直しても別の物が増えた）
    const scope = it && (it.builtin ? swapScope() : it.canEdit ? it.scope : "me") || "me";
    return `<div class="dash-pophead"><b>名前を付けて保存</b><small>同じ置き場に同じ名前があれば上書きします</small></div>`
      + `<label class="dash-field">名前<input id="dbSaveName" maxlength="40" value="${esc(it ? it.name : "わたしのダッシュボード")}"></label>`
      + scopeField("dbScope", scope)
      + `<label class="pv-ck"><input type="checkbox" id="dbSaveStd"${it && String(it.id) === String(DS.standardId) ? " checked" : ""}>★ 最初に開く物にする</label>`
      + `<div class="dash-saveplan" id="dbSavePlan" aria-live="polite"></div>`
      + `<div class="dash-popacts"><span class="dash-sp"></span><button type="button" class="mm-btn-primary" data-db-dosave>保存</button></div><p class="dash-poperr" aria-live="polite"></p>`;
  }
  /** 名前を付けて保存の行き先（版 3.49.0）: 同じ置き場の同じ名前 → 上書き／組み込みと同じ名前（自分だけ・全員の既定）→ 組み込みの代わり（上書き）／ほか → 新しく。
      ★を付けるとき、先の置き場に★があれば、その★に負けることと、外せるなら外す選びを返す */
  function savePlan(name, scope, star) {
    const same = DS.list.find((x) => !x.builtin && x.scope === scope && x.name === name);
    const builtinNames = new Set(DS.list.filter((x) => x.builtin || x.replaces).map((x) => x.name).concat((DS.hidden || []).map((x) => x.name)));
    const plan = same ? { kind: "over", row: same, ok: same.canEdit }
      : scope !== "all" && builtinNames.has(name) ? { kind: "swap", ok: true } : { kind: "new", ok: true };
    const top = byId(DS.standardId);
    plan.beaten = star && top && !top.builtin && SCOPE_ORDER.indexOf(top.scope) < SCOPE_ORDER.indexOf(scope) && (!same || String(top.id) !== String(same.id)) ? top : null;
    return plan;
  }
  function paintSavePlan() {
    const el = popEl && popEl.querySelector("#dbSavePlan"); if (!el) return;
    const name = (popEl.querySelector("#dbSaveName").value || "").trim(), scope = (popEl.querySelector('input[name="dbScope"]:checked') || {}).value || "me";
    const p = savePlan(name, scope, popEl.querySelector("#dbSaveStd").checked), btn = popEl.querySelector("[data-db-dosave]");
    const where = `「${esc(name)}」〔${SCOPE_NAME[scope]}〕`;
    el.className = `dash-saveplan is-${p.kind}`;
    // 行き先（新しく・上書き）は主のボタンが言う（2026-10-dashsave の G）。帯は、書けない・★が負けるときだけ
    el.innerHTML = (name && !p.ok ? `<span class="dash-planno">${where}は直せない置き場の物です。別の名前にしてください</span>` : "")
      + (p.beaten ? `<label class="pv-ck dash-unstar"><input type="checkbox" id="dbUnstar"${p.beaten.canEdit ? " checked" : " disabled"}>`
        + `「${esc(p.beaten.name)}」〔${SCOPE_NAME[p.beaten.scope]}〕の★を外す<small>${p.beaten.canEdit ? "外さないと、アプリを開いたときはそちらが先に出ます" : "その★が先に効くので、アプリを開いたときはそちらが出ます（外せるのは直せる人だけ）"}</small></label>` : "");
    if (btn) {
      const at = `「${name}」〔${SCOPE_NAME[scope]}〕`;
      btn.textContent = name ? `${at}に${p.kind === "new" ? "保存" : "上書き保存"}` : "保存";
      btn.dataset.plan = p.kind;
      btn.title = p.kind === "swap" ? `組み込みの「${name}」を、いまの並びで置き換えます（${scope === "me" ? "自分の一覧だけ" : "全員の一覧"}。▾ の「組み込みに戻す」で戻せます）`
        : p.kind === "over" ? `${at}を、いまの並びで上書きします` : `${at}として新しく置きます`;
      btn.disabled = !name || !p.ok;
    }
  }
  /** スライサーの「設備…」の面のチェック */
  function onPopChange(e) {
    const x = e.target, sl = { ...(sliceState() || {}) }, eq = new Set(sl.equips || []);
    if (x.matches("#dbSaveName, [name=dbScope], #dbSaveStd")) { paintSavePlan(); return; }
    if (x.matches("[data-ds-set]")) { setSlice({ ...sl, set: x.value }); return; }
    // 暦の打つ欄: 「から」は始めの日として覚えるだけ（続けて「まで」を打てるよう、描き直さない）・「まで」を打つと当たる
    if (x.matches("[data-ds-from]")) { cal.from = x.value || ""; return; }
    if (x.matches("[data-ds-to]")) { const a = popEl.querySelector("[data-ds-from]").value; if (a && x.value) setRange(a, x.value); return; }
    if (x.matches("[data-ds-on]")) { setBarCfg({ off: !x.checked }); return; }
    if (x.matches("[data-ds-part]")) { const cur = barParts(); setBarCfg({ parts: D.PART_KEYS.filter((k) => (k === x.dataset.dsPart ? x.checked : cur.includes(k))) }); return; }
    if (x.matches("[data-ds-eq]")) { if (x.checked) eq.add(x.dataset.dsEq); else eq.delete(x.dataset.dsEq); }
    else if (x.matches("[data-ds-gck]")) { const g = D.groupsOf(DS.tree || {}, sl.set).find((y) => y.name === x.dataset.dsGck); (g ? g.members : []).forEach((m) => (x.checked ? eq.add(m) : eq.delete(m))); }
    else return;
    const names = (DS.tree && DS.tree.names) || [];
    setSlice({ ...sl, equips: names.filter((n) => eq.has(n)) });
  }
  async function onPopClick(e) {
    const t = e.target.closest("button"); if (!t) return;
    if (t.hasAttribute("data-ds-done")) { closePop(); return; }
    if (t.hasAttribute("data-ds-all")) { setSlice({ ...(sliceState() || {}), equips: [] }); return; }
    if (t.dataset.dsDay) { if (!cal.from) { cal.from = t.dataset.dsDay; paintCal(); } else setRange(cal.from, t.dataset.dsDay); return; }
    if (t.dataset.dsCalm) { const [y, m] = cal.month.split("-").map(Number), k = y * 12 + m - 1 + +t.dataset.dsCalm; cal.month = `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`; paintCal(); return; }
    if (t.hasAttribute("data-ds-dateclear")) { setSlice({ ...(sliceState() || {}), period: null }); closePop(); say("日付を外しました"); return; }
    if (t.hasAttribute("data-ds-addpanel")) { closePop(); addSlicerPanel(); return; }
    if (t.dataset.dbOpen) { if (DS.edit && dirty()) { say("編集中の変えた所を保存するか、やめてから開いてください"); return; } closePop(); open(t.dataset.dbOpen); return; }
    if (t.hasAttribute("data-db-std")) { await writeLayout("PUT", current().id, { standard: true }, "標準にしました"); closePop(); return; }
    if (t.hasAttribute("data-db-new")) { closePop(); startBlank(); return; }
    if (t.hasAttribute("data-db-remove")) {
      if (DS.confirm !== "remove") { DS.confirm = "remove"; popEl.innerHTML = pickHtml(); return; }
      DS.confirm = ""; const it = current(); closePop();
      if (!it.builtin) {
        const r = await WL.dashKit.fetch(`/api/dashboards/${it.id}?rev=${it.rev}`, { method: "DELETE" });
        if (!r.ok) { say("消せませんでした: " + ((await r.json().catch(() => ({}))).error || r.status)); return; }
      }
      // 組み込み・組み込みを入れ替えた物は、組み込みも一覧から外す（コードの物は消せないので外す。戻せる）
      const key = it.builtin ? String(it.id).slice(2) : (it.replaces || "").slice(2);
      if (key) { const scope = DS.canEditDefault ? "default" : "me"; if (!(await writeHidden(scope, [...new Set(hiddenKeys(scope).concat([key]))]))) return; }
      else await loadList();
      open(DS.standardId); say(`「${it.name}」を${key ? "一覧から外しました（▾ の「外した組み込み」から戻せます）" : "消しました"}`); return;
    }
    if (t.hasAttribute("data-db-unswap")) {        // 入れ替えた物を消して、組み込みに戻す
      const it = current(); closePop();
      const r = await WL.dashKit.fetch(`/api/dashboards/${it.id}?rev=${it.rev}`, { method: "DELETE" });
      if (!r.ok) { say("戻せませんでした: " + ((await r.json().catch(() => ({}))).error || r.status)); return; }
      await loadList(); open(it.replaces); say(`組み込みの「${it.name}」に戻しました`); return;
    }
    if (t.dataset.dbUnhide) {                       // 外した組み込みを戻す
      const scope = t.dataset.scope, id = t.dataset.dbUnhide;
      if (!(await writeHidden(scope, hiddenKeys(scope).filter((k) => k !== id.slice(2))))) return;
      closePop(); open(id); say("組み込みを一覧に戻しました"); return;
    }
    if (t.hasAttribute("data-db-dosave")) { saveAs(); return; }
    // セット（版 3.46.0）
    if (t.dataset.dbSet != null) { if (DS.edit && dirty()) { say("編集中の変えた所を保存するか、やめてから替えてください"); return; } closePop(); useSet(t.dataset.dbSet || null); return; }
    if (t.hasAttribute("data-db-setsave")) { openPop("setsave", "[data-db-pick]", setSaveHtml(), "dash-savepop"); popEl.querySelector("#dbSetName")?.select(); return; }
    if (t.hasAttribute("data-db-dosetsave")) {
      const name = (popEl.querySelector("#dbSetName").value || "").trim(), scope = (popEl.querySelector('input[name="dbSetScope"]:checked') || {}).value || "me", err = popEl.querySelector(".dash-poperr");
      if (!name) { err.textContent = "名前を入れてください"; return; }
      err.textContent = "保存しています…";
      const d = await writeSet("POST", null, { name, scope, standard: popEl.querySelector("#dbSetStd").checked, body: { items: JSON.parse(t.dataset.items || "[]") } }, `セット「${name}」を保存しました`);
      if (d) closePop(); else err.textContent = "✕ 保存できませんでした（道具の行の知らせ）";
      return;
    }
    const st = curSet(), it = current();
    if (st && t.hasAttribute("data-db-setin")) { await editSet(st.body.items.concat([String(it.id)]), `「${it.name}」をセット「${st.name}」に入れました`); if (popEl) popEl.innerHTML = pickHtml(); return; }
    if (st && t.hasAttribute("data-db-setout")) { await editSet(st.body.items.filter((k) => k !== itemKey(st, it)), `「${it.name}」をセット「${st.name}」から外しました`); if (popEl) popEl.innerHTML = pickHtml(); return; }
    if (st && t.dataset.dbSetmove) {
      const xs = st.body.items.slice(), i = xs.indexOf(itemKey(st, it)), j = i + +t.dataset.dbSetmove;
      if (i < 0 || j < 0 || j >= xs.length) return;
      xs.splice(j, 0, xs.splice(i, 1)[0]); await editSet(xs, ""); if (popEl) popEl.innerHTML = pickHtml(); return;
    }
    if (st && t.hasAttribute("data-db-setstd")) { await writeSet("PUT", st.id, { standard: true, base_rev: st.rev }, `セット「${st.name}」を標準にしました`); if (popEl) popEl.innerHTML = pickHtml(); return; }
    if (st && t.hasAttribute("data-db-setdel")) {
      if (DS.confirm !== "setdel") { DS.confirm = "setdel"; popEl.innerHTML = pickHtml(); return; }
      DS.confirm = ""; closePop();
      const r = await WL.dashKit.fetch(`/api/dashboard-sets/${st.id}?rev=${st.rev}`, { method: "DELETE" });
      if (!r.ok) { say("消せませんでした: " + ((await r.json().catch(() => ({}))).error || r.status)); return; }
      await loadSets(); useSet(DS.setId); say(`セット「${st.name}」を消しました`); return;
    }
    const mid = popEl && popEl.dataset.panel;
    if (mid && t.hasAttribute("data-db-edit")) { closePop(); openEditor(mid); return; }
    if (mid && t.hasAttribute("data-db-dup")) { closePop(); duplicate(mid); return; }
    if (mid && t.hasAttribute("data-db-del")) { if (DS.confirm === "del:" + mid) { closePop(); remove(mid); } else { DS.confirm = "del:" + mid; popEl.innerHTML = moreHtml(mid); } }
  }
  const moreHtml = (id) => `<button type="button" class="dash-li" data-db-edit><b>組む</b><small>Enter</small></button><button type="button" class="dash-li" data-db-dup><b>複製</b></button>`
    + `<button type="button" class="dash-li is-danger${DS.confirm === "del:" + id ? " is-armed" : ""}" data-db-del><b>${DS.confirm === "del:" + id ? "もう一度押すと消えます" : "消す"}</b><small>Delete</small></button>`;

  /* ---------------- 保存 ---------------- */
  /** 置き場へ書く。local（中身だけの上書き）なら並びを読み直さず、答えの 1 件だけを差し替える（版 3.41.0: 保存のたびに全部のダッシュボードを読み直し、
      全部のパネルを描き直していた）。描き直すのは、サーバーが直した中身が今の組みと違うときだけ */
  async function writeLayout(method, id, body, done, { local = false } = {}) {
    const r = await WL.dashKit.fetch(id ? `/api/dashboards/${id}` : "/api/dashboards", WL.dashKit.json(method, body));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const why = d.error || (r.status === 409 ? "ほかの PC が先に直しました。開き直してから直してください。" : `保存できませんでした（${r.status}）`);
      return { error: why };
    }
    const i = local ? DS.list.findIndex((x) => String(x.id) === String(d.id)) : -1;
    if (i >= 0) DS.list[i] = d; else await loadList();
    DS.id = d.id; remember({ id: d.id });
    const same = canon(d.body) === canon(DS.layout);
    if (!same) DS.layout = WL.dashKit.clone(d.body);
    DS.saved = JSON.stringify(DS.layout);
    if (same) paintBar(); else paint();
    say(done);
    return { ok: d };
  }
  /** 鍵の順によらない字（サーバーは鍵を並べて返す） */
  const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
  let saving = false;
  async function save() {
    const it = current(); if (!it || saving || !canSaveIt(it)) return;
    saving = true;
    // 押したらすぐ「保存しています…」（共有のマスタが遅くても、押せたかが分かる）
    const btn = document.querySelector("[data-db-save]");
    if (btn) { btn.disabled = true; btn.textContent = "保存しています…"; }
    say("保存しています…");
    try {
      // 組み込み（版 3.48.0）: 直した物を、その組み込みと入れ替える物として置く（開発者は共通デフォルト＝全員・ほかの人は自分の ID）。標準だったら標準のまま
      const r = it.builtin
        ? await writeLayout("POST", null, { name: it.name, scope: swapScope(), standard: String(it.id) === String(DS.standardId), body: { ...DS.layout, replaces: String(it.id).slice(2) } },
          `組み込みの「${it.name}」を直した物と入れ替えました（${DS.canEditDefault ? "全員" : "自分の一覧"}。▾ の「組み込みに戻す」で戻せます）`)
        : await writeLayout("PUT", it.id, { body: DS.layout, base_rev: it.rev }, "保存しました", { local: !DS.layout.panels.some((x) => x.legacy) });   // 前の版の 1 枚の表は、並びを読み直して前の版の条件を入れ直す
      if (r.error) { say("✕ " + r.error); paintBar(); }
    } finally { saving = false; }
  }
  async function saveAs() {
    const name = (popEl.querySelector("#dbSaveName").value || "").trim(), scope = (popEl.querySelector('input[name="dbScope"]:checked') || {}).value || "me";
    const err = popEl.querySelector(".dash-poperr"), star = popEl.querySelector("#dbSaveStd").checked, unstar = popEl.querySelector("#dbUnstar");
    if (!name) { err.textContent = "名前を入れてください"; return; }
    const p = savePlan(name, scope, star);
    if (!p.ok) return;
    err.textContent = "保存しています…";
    // 上書きは、その物の中身と★だけを書く（組み込みの代わりの印〈replaces〉はサーバーが名前から付ける）
    const what = p.kind === "new" ? "保存しました" : "上書きしました";
    const r = p.kind === "over"
      ? await writeLayout("PUT", p.row.id, { body: DS.layout, base_rev: p.row.rev, ...(star ? { standard: true } : {}) }, `「${name}」を${what}`)
      : await writeLayout("POST", null, { name, scope, standard: star, body: DS.layout }, `「${name}」を${what}`);
    if (r.error) { err.textContent = "✕ " + r.error; return; }
    if (p.beaten && unstar && unstar.checked) {
      // ★を外すだけ（開いている物・並びは替えない）
      const b = await WL.dashKit.fetch(`/api/dashboards/${p.beaten.id}`, WL.dashKit.json("PUT", { standard: false, base_rev: p.beaten.rev }));
      await loadList(); paintBar();
      say(b.ok ? `「${name}」を${what}（「${p.beaten.name}」の★を外しました）` : `「${name}」を${what}。「${p.beaten.name}」の★は外せませんでした（${b.status}）`);
    }
    closePop();
  }

  /* ---------------- 編集: 置き場の計算 ---------------- */
  function occupancy(skip = "") {
    const g = Array.from({ length: DS.layout.rows }, () => new Array(COLS).fill(""));
    DS.layout.panels.forEach((p) => { if (p.id === skip) return; for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (g[y]) g[y][x] = p.id; });
    return g;
  }
  const fits = (r, skip) => {
    if (r.x < 0 || r.y < 0 || r.w < 1 || r.h < 1 || r.x + r.w > COLS || r.y + r.h > DS.layout.rows) return false;
    const g = occupancy(skip);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (g[y][x]) return false;
    return true;
  };
  /** 空いた所（大きい方から: w×h → 小さくしていく）。無ければ null */
  function freeSpot(w = 4, h = 2) {
    for (const [ww, hh] of [[w, h], [3, 2], [2, 2], [3, 1], [2, 1], [1, 1]]) {
      for (let y = 0; y + hh <= DS.layout.rows; y++) for (let x = 0; x + ww <= COLS; x++) if (fits({ x, y, w: ww, h: hh })) return { x, y, w: ww, h: hh };
    }
    return null;
  }
  const minRows = () => Math.max(DS.rowsRange[0], ...(DS.layout ? DS.layout.panels.map((p) => p.y + p.h) : [0]));
  function commit(mut, why = "") {
    DS.history.push(JSON.stringify(DS.layout));
    if (DS.history.length > HISTORY) DS.history.shift();
    mut(DS.layout);
    DS.confirm = "";
    paint();
    refresh(false);
    if (why) say(why);
  }
  function undo() {
    if (!DS.history.length) return;
    DS.layout = JSON.parse(DS.history.pop());
    if (DS.editing && !panelOf(DS.editing)) closeEditor();
    paint(); refresh(false); say("元に戻しました");
  }
  const newId = () => { let i = DS.layout.panels.length + 1; while (panelOf(`p${i}`)) i++; return `p${i}`; };
  function addPanel(at) {
    const spot = at ? { x: at.x, y: at.y, w: 1, h: 1 } : freeSpot();
    if (!spot) { say("空きがありません。パネルを小さくするか、段を増やしてください"); return; }
    // 押したマスなら、そこから右下へ空いている分だけ広げる（4×2 まで。sizes で大きさの候補を渡せる）
    if (at) { for (const [w, h] of at.sizes || [[4, 2], [3, 2], [2, 2], [4, 1], [3, 1], [2, 1]]) if (fits({ x: at.x, y: at.y, w, h })) { spot.w = w; spot.h = h; break; } }
    const src = WL.dashKit.src.DEFAULT;
    const p = { id: newId(), ...spot, title: "", visual: "kpi", source: src, equip: "", body: { rows: [], cols: [], measures: [{ agg: "lots" }], grand: true, labels: true }, filters: [], search: "", period: null, sort: "", top: 0, basis: "work" };
    commit((L) => L.panels.push(p));
    DS.sel = p.id; openEditor(p.id);
  }
  /** 「＋ 列の値で絞るパネルを足す…」（版 3.52.0）: 編集に入り、空いた所にスライサーのパネルを足して組む所を開く。
      値の札にする列は、種類の少ない字の列（2〜30 種類）を先に入れておく（組む所の行の段で替えられる） */
  async function addSlicerPanel() {
    if (!DS.edit) { DS.edit = true; DS.confirm = ""; paint(); }
    let spot = freeSpot(3, 3) || freeSpot(2, 3) || freeSpot(2, 2);
    // 空きが無ければ、下に段を 3 つ足してそこへ置く（段の上限まで）
    if (!spot && DS.layout.rows + 3 <= DS.rowsRange[1]) { const y = DS.layout.rows; commit((L) => { L.rows += 3; }); spot = freeSpot(3, 3) || { x: 0, y, w: 3, h: 3 }; }
    if (!spot) { say("空きがありません。パネルを小さくするか、段を減らしたパネルを消してください"); return; }
    const src = WL.dashKit.src.DEFAULT;
    let col = "";
    try {
      const r = await WL.dashKit.fetch("/api/dashboard/fields", WL.dashKit.json("POST", { source: src }));
      const d = r.ok ? await r.json() : {};
      col = (d.fields || []).filter((f) => !f.numeric && !f.date && f.kinds >= 2 && f.kinds <= 30).sort((a, b) => a.kinds - b.kinds).map((f) => f.column)[0]
        || ((d.special || []).some((x) => x.column === "@equip") ? "@equip" : "");
    } catch (e) { WL.quiet.note("列を読めない（スライサーの列は組む所で選ぶ）", e); }
    const p = { id: newId(), ...spot, title: "", visual: "slicer", source: src, equip: "", body: { rows: col ? [{ column: col }] : [], cols: [], measures: [{ agg: "lots" }], grand: false, labels: true },
      filters: [], search: "", period: null, sort: "", top: 0, basis: "work" };
    commit((L) => L.panels.push(p));
    DS.sel = p.id; openEditor(p.id);
    say(col ? `スライサーのパネルを足しました（「${col === "@equip" ? "設備" : col}」の値の札）。行の段で列を替えられます` : "スライサーのパネルを足しました。行の段（値の札にする列）を選んでください");
  }
  function duplicate(id) {
    const p = panelOf(id); if (!p) return;
    const spot = freeSpot(p.w, p.h);
    if (!spot) { say("空きがありません。パネルを小さくするか、段を増やしてください"); return; }
    commit((L) => L.panels.push({ ...WL.dashKit.clone(p), id: newId(), ...spot }), "複製しました");
  }
  function remove(id) {
    if (DS.confirm !== "del:" + id) { DS.confirm = "del:" + id; paintPanel(id); return; }
    if (DS.editing === id) closeEditor();
    commit((L) => { L.panels = L.panels.filter((x) => x.id !== id); }, "消しました（元に戻す で戻せます）");
    DS.answers.delete(id);
  }
  function startBlank() {
    DS.id = null; DS.layout = { rows: 8, panels: [] }; DS.saved = ""; DS.history = []; DS.edit = true; DS.sel = "";
    paint(); say("「＋ パネル」か、空いたマスを押してパネルを足します");
  }

  /* ---------------- 編集: 掴んで動かす・大きさを変える ---------------- */
  let drag = null;
  function cellSize() {
    const g = $("#dashGrid").getBoundingClientRect();
    return { g, cw: (g.width - GAP * (COLS - 1)) / COLS, ch: (g.height - GAP * (DS.layout.rows - 1)) / DS.layout.rows };
  }
  function ghost(r, ok) {
    let el = $("#dashGhost");
    if (!el) { el = document.createElement("div"); el.id = "dashGhost"; el.className = "dash-ghost"; $("#dashGrid").append(el); }
    el.style.gridColumn = `${r.x + 1} / span ${r.w}`; el.style.gridRow = `${r.y + 1} / span ${r.h}`;
    el.classList.toggle("is-bad", !ok);
    el.textContent = `${r.w} × ${r.h}${ok ? "" : "（重なるので置けません）"}`;
  }
  function onDown(e) {
    if (!DS.edit || e.button !== 0) return;
    const el = e.target.closest(".dash-p"); if (!el) return;
    const rz = e.target.closest("[data-rz]"), head = e.target.closest(".dash-ph");
    if (!rz && (!head || e.target.closest("button,select,input"))) return;
    const p = panelOf(el.dataset.id); if (!p) return;
    e.preventDefault();
    DS.sel = p.id;
    const { cw, ch } = cellSize();
    drag = { id: p.id, mode: rz ? "size" : "move", dir: rz ? rz.dataset.rz || "se" : "", x0: e.clientX, y0: e.clientY, r0: { x: p.x, y: p.y, w: p.w, h: p.h }, cw: cw + GAP, ch: ch + GAP, r: null };
    el.classList.add("is-drag");
    document.body.classList.add("dash-dragging");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }
  /** 角（nw・ne・sw・se）を dx・dy マス引いた大きさ（向かいの角は動かない。1 マスより小さく・グリッドの外へはしない） */
  function sized(r0, dir, dx, dy) {
    const r = { ...r0 };
    if (dir.includes("e")) r.w = Math.max(1, Math.min(COLS - r0.x, r0.w + dx));
    if (dir.includes("w")) { const x = Math.max(0, Math.min(r0.x + r0.w - 1, r0.x + dx)); r.w = r0.x + r0.w - x; r.x = x; }
    if (dir.includes("s")) r.h = Math.max(1, Math.min(DS.layout.rows - r0.y, r0.h + dy));
    if (dir.includes("n")) { const y = Math.max(0, Math.min(r0.y + r0.h - 1, r0.y + dy)); r.h = r0.y + r0.h - y; r.y = y; }
    return r;
  }
  function onMove(e) {
    if (!drag) return;
    const dx = Math.round((e.clientX - drag.x0) / drag.cw), dy = Math.round((e.clientY - drag.y0) / drag.ch), r0 = drag.r0;
    const r = drag.mode === "move"
      ? { ...r0, x: Math.max(0, Math.min(COLS - r0.w, r0.x + dx)), y: Math.max(0, Math.min(DS.layout.rows - r0.h, r0.y + dy)) }
      : sized(r0, drag.dir, dx, dy);
    drag.r = r; drag.ok = fits(r, drag.id);
    ghost(r, drag.ok);
  }
  function onUp() {
    window.removeEventListener("pointermove", onMove);
    document.body.classList.remove("dash-dragging");
    const d = drag; drag = null;
    $("#dashGhost")?.remove();
    document.querySelectorAll(".dash-p.is-drag").forEach((x) => x.classList.remove("is-drag"));
    if (!d) return;
    if (d.r && d.ok && JSON.stringify(d.r) !== JSON.stringify(d.r0)) commit((L) => Object.assign(L.panels.find((x) => x.id === d.id), d.r));
    else { if (d.r && !d.ok) say("ほかのパネルと重なるので置けません"); paint(); }
  }
  function onKey(e) {
    if (!DS.active) return;
    if (DS.edit && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.target.closest("input,select,textarea")) { e.preventDefault(); undo(); return; }
    const el = e.target.closest && e.target.closest(".dash-p");
    if (el && e.target === el && !DS.editing && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {   // キーで右クリックのメニュー
      e.preventDefault(); const r = el.getBoundingClientRect(); panelMenu(el.dataset.id, r.left + 24, r.top + 30); return;
    }
    if (!DS.edit || !el || e.target !== el) return;
    const p = panelOf(el.dataset.id); if (!p) return;
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (dir) {
      e.preventDefault();
      // Shift＋矢印＝右下の角・Alt＋Shift＋矢印＝左上の角（版 3.41.0。四隅から大きさを変えるのと同じ）
      const r = e.shiftKey && e.altKey ? sized(p, dir[0] ? "w" : "n", dir[0], dir[1]) : e.shiftKey ? { ...p, w: p.w + dir[0], h: p.h + dir[1] } : { ...p, x: p.x + dir[0], y: p.y + dir[1] };
      if (fits(r, p.id)) { commit((L) => Object.assign(L.panels.find((x) => x.id === p.id), { x: r.x, y: r.y, w: r.w, h: r.h })); focusPanel(p.id); }
      else say(e.shiftKey ? "それ以上は大きくできません（ほかのパネルか、グリッドの端）" : "そこへは動かせません（ほかのパネルか、グリッドの端）");
      return;
    }
    if (e.key === "Enter") { e.preventDefault(); openEditor(p.id); return; }
    if (e.key === "Delete") { e.preventDefault(); remove(p.id); }
  }
  const focusPanel = (id) => requestAnimationFrame(() => document.querySelector(`#dashGrid .dash-p[data-id="${CSS.escape(id)}"]`)?.focus());

  /* ---------------- 組む所（dashboard-editor.js） ---------------- */
  let editBase = null;      // 組む前のパネル（やめたら戻す）
  /** パネルの中身を np に置き換える（置き場 x・y・w・h は今のまま）。形を替えると項目が変わる（合わせた表 ↔ ふつうのパネル）ので、無くなった項目は消す */
  function replacePanel(cur, np) {
    const at = { x: cur.x, y: cur.y, w: cur.w, h: cur.h };
    Object.keys(cur).forEach((k) => { if (!(k in np)) delete cur[k]; });
    return Object.assign(cur, np, at);
  }
  function openEditor(id) {
    const p = panelOf(id); if (!p) return;
    if (!DS.edit) { DS.edit = true; }
    DS.editing = id; DS.sel = id; editBase = WL.dashKit.clone(p);
    $("#dashScreen").classList.add("has-editor");
    focusFrame(id);
    paint();
    E.open({ panel: p, sources: DS.sources, toast: say, answer: () => (DS.answers.get(id) || {}).d, egroupSets: () => DS.egroupSets || [],
      onChange: (np) => { replacePanel(panelOf(id), np); place(document.querySelector(`#dashGrid .dash-p[data-id="${CSS.escape(id)}"]`), panelOf(id)); paintPanel(id); clearTimeout(editT); editT = setTimeout(() => { const q = panelOf(id), a = DS.answers.get(id); if (q && (!a || a.key !== qkey(q))) queryPanel(q); }, 250); },   // 題・見せ方・書式だけなら引き直さない（版 3.43.0）
      onApply: (np) => {
        const cur = panelOf(id), base = editBase; closeEditor();
        if (!cur) return;
        replacePanel(cur, base);           // 元に戻す の履歴に「組む前」を残してから当てる
        commit((L) => replacePanel(L.panels.find((x) => x.id === id), np), "当てました（保存するまでは、この PC の画面だけです）");
      },
      onCancel: () => { const cur = panelOf(id); if (cur && editBase) replacePanel(cur, editBase); closeEditor(); paint(); refresh(false); },
      // 組む所の幅を変えた → 組むパネルを左の空きに置き直して描き直す
      onResize: () => { unfocus(); focusFrame(id); paintPanel(id); },
    });
  }
  /** 焦点（2026-10-grid の 1 回目で 1 位の D）: 組む間、組むパネルをグリッドの左の空きに大きく出し（グリッドの大きさの 1.5 倍まで・
      窓に収まる大きさ）、ほかのパネルは淡い幕で覆う。組む所は右に重ねる（グリッドは縮めない＝ほかのパネルの字が切れない） */
  function focusFrame(id) {
    const el = document.querySelector(`#dashGrid .dash-p[data-id="${CSS.escape(id)}"]`), g = $("#dashGrid");
    if (!el || !g) return;
    const r = el.getBoundingClientRect(), gr = g.getBoundingClientRect(), ed = E.width() + 24;   // 組む所の幅は引いて変えられる（版 3.45.0）
    const aw = Math.max(320, innerWidth - ed - gr.left - 16), ah = gr.height;
    const w = Math.min(aw, Math.max(520, r.width * 1.5)), h = Math.min(ah, Math.max(340, r.height * 1.5));
    Object.assign(el.style, { position: "fixed", left: `${Math.round(gr.left + (aw - w) / 2)}px`, top: `${Math.round(gr.top + (ah - h) / 2)}px`, width: `${Math.round(w)}px`, height: `${Math.round(h)}px` });
    el.classList.add("is-focus");
    if (!$("#dashScrim")) $("#dashScreen").insertAdjacentHTML("beforeend", '<div id="dashScrim" class="dash-scrim" aria-hidden="true"></div>');
  }
  function unfocus() {
    document.querySelectorAll("#dashGrid .dash-p.is-focus").forEach((el) => { el.classList.remove("is-focus"); ["position", "left", "top", "width", "height"].forEach((k) => { el.style[k] = ""; }); });
    $("#dashScrim")?.remove();
  }
  function closeEditor() {
    DS.editing = ""; editBase = null; E.close(); unfocus();
    $("#dashScreen")?.classList.remove("has-editor");
    requestAnimationFrame(() => paint());
  }

  /* ---------------- パネルを絞る（dashboard-filter.js） ---------------- */
  function openFilter(id, anchor) {
    const p = panelOf(id); if (!p) return;
    if (Q.isOpen()) { Q.close(); return; }
    const a = DS.answers.get(id), keys = p.visual === "board" && a && a.d && a.d.groups ? P.boardKeys(p, a.d) : null;
    Q.open({ anchor, panel: p, quick: quickOf(id), sources: DS.sources, boardKeys: keys, canMove: DS.edit,
      onChange: (q) => { setQuick(id, q); refresh(false); paintPanel(id); },
      onMove: () => {          // この PC の絞り込みを、組んだ条件へ移す（保存すると全員に効く）
        const q = quickOf(id); if (!q) return;
        setQuick(id, null);
        commit((L) => { const x = L.panels.find((y) => y.id === id); Object.assign(x, Q.merge(x, q)); }, "絞り込みをパネルの条件にしました（保存すると全員に効きます）");
      } });
  }

  /* ---------------- 右クリックのメニュー（版 3.44.0。利用者の要望 2026-10-17 の 6。WL.dashKit.menu: 表示列の窓と同じ形） ----------------
     パネルの上: 見る（引き直す・絞る・絞り込みを外す）・写す（画像をコピー・画像で保存・表の値をコピー）・組む（組む・題・複製・パネルをコピー）・消す。
     空いた所: ここにパネルを足す・貼り付け・すべて引き直す・画面の画像をコピー・元に戻す。
     組み・並びを変える項目は、見ているときに選んでも編集に入ってから行う（保存するまでは、この PC の画面だけ）。
     「パネルをコピー」はこの PC に覚え（tpa.dash.clip.v1）、ほかのダッシュボードにも貼り付けられる */
  const CLIP = "tpa.dash.clip.v1";
  const clip = () => WL.dashKit.local.get(CLIP, null);
  const editing = () => { if (!DS.edit) { DS.edit = true; DS.confirm = ""; paint(); } };
  const panelEl = (id) => document.querySelector(`#dashGrid .dash-p[data-id="${CSS.escape(id)}"]`);
  /** パネルの表（数字・グラフは数の並び）を、Excel に貼れる形（タブ区切り）に。表が無ければ "" */
  function tableTsv(el) {
    const t = el && el.querySelector(".dash-pb table"); if (!t) return "";
    return [...t.rows].map((r) => [...r.cells].map((c) => c.innerText.replace(/\s+/g, " ").trim()).join("\t")).join("\r\n");
  }
  async function copyText(text, done) {
    try { await navigator.clipboard.writeText(text); say(done); } catch (_) { say("この PC ではクリップボードに入れられませんでした"); }
  }
  /** 写したパネルを置く（at のマスから・無ければ空いた所）。大きさは写した時のまま、入らなければ小さく */
  function paste(at) {
    const c = clip(); if (!c || !DS.layout) return;
    editing();
    let spot = null;
    if (at) for (const [w, h] of [[c.w, c.h], [Math.min(c.w, 4), Math.min(c.h, 2)], [2, 2], [2, 1], [1, 1]]) if (fits({ x: at.x, y: at.y, w, h })) { spot = { x: at.x, y: at.y, w, h }; break; }
    spot = spot || freeSpot(c.w, c.h);
    if (!spot) { say("空きがありません。パネルを小さくするか、段を増やしてください"); return; }
    const p = { ...WL.dashKit.clone(c.panel), id: newId(), ...spot };
    commit((L) => L.panels.push(p), `「${titleOf(p)}」を貼り付けました（元に戻す で戻せます）`);
    DS.sel = p.id; focusPanel(p.id);
  }
  /** 押した所のマス（グリッドの外なら null） */
  function cellAt(x, y) {
    if (!DS.layout) return null;
    const { g, cw, ch } = cellSize(), cx = Math.floor((x - g.left) / (cw + GAP)), cy = Math.floor((y - g.top) / (ch + GAP));
    return cx >= 0 && cy >= 0 && cx < COLS && cy < DS.layout.rows ? { x: cx, y: cy } : null;
  }
  const shot = (f, el, part) => requestAnimationFrame(() => requestAnimationFrame(() => WL.hardcopy && WL.hardcopy[f](el, part)));   // メニューが消えてから写す
  function panelMenu(id, x, y) {
    const p = panelOf(id), el = panelEl(id); if (!p || !el) return;
    const qn = Q.chips(quickOf(id)).length, tsv = tableTsv(el), c = clip(), name = titleOf(p), room = !!freeSpot(p.w, p.h);
    DS.sel = id; document.querySelectorAll("#dashGrid .dash-p").forEach((x2) => x2.classList.toggle("is-sel", DS.edit && x2 === el));
    el.classList.add("is-menu");            // どのパネルのメニューかを枠で見せる（閉じたら外す）
    WL.dashKit.menu({ x, y, head: name, onClose: () => el.classList.remove("is-menu"), items: [
      { group: "見る" },
      { icon: "↻", label: "このパネルを引き直す", run: () => queryPanel(p) },
      { icon: "⧩", label: qn ? `絞り込みを直す（${qn}）…` : "このパネルを絞る…", run: () => openFilter(id, el.querySelector("[data-db-filter]") || el.querySelector(".dash-ph")) },
      qn ? { icon: "×", label: "絞り込みを外す", run: () => { setQuick(id, null); refresh(false); paintPanel(id); } } : null,
      { group: "写す" },
      { icon: "🖼", label: "パネルの画像をコピー", why: "Excel・メール・チャットに貼り付けられます", run: () => shot("copy", el, name) },
      { icon: "⤓", label: "パネルの画像を保存", run: () => shot("save", el, name) },
      { icon: "▦", label: "表の値をコピー", disabled: !tsv, why: tsv ? "タブ区切りで、Excel にそのまま貼り付けられます" : "表のパネルだけ（ほかは画像で）",
        run: () => copyText(tsv, "表の値をコピーしました（Excel に貼り付けられます）") },
      { group: "組む" },
      { icon: "✎", label: "組む…", key: "Enter", run: () => openEditor(id) },
      { icon: "Ａ", label: "題を変える…", run: async () => {
        const v = await promptModal({ title: "パネルの題を変える", label: "題", value: p.title || name, maxLength: 60, confirmLabel: "変える",
          hint: "空にすると、組みから自動で付けます" });
        if (v == null) return;
        editing(); commit((L) => { L.panels.find((q) => q.id === id).title = v.slice(0, 60); }, "題を変えました（保存するまでは、この PC の画面だけです）");
      } },
      { icon: "⧉", label: "複製", disabled: !room, why: room ? "同じパネルを、空いた所に足します" : "空きがありません（段を増やす）", run: () => { editing(); duplicate(id); } },
      { icon: "⎘", label: "パネルをコピー", why: "ほかのダッシュボードにも貼り付けられます（右クリック →「貼り付け」）",
        run: () => { const rest = WL.dashKit.clone(p); delete rest.x; delete rest.y; delete rest.id; WL.dashKit.local.set(CLIP, { panel: rest, w: p.w, h: p.h, name }); say(`「${name}」をコピーしました（空いた所を右クリック →「貼り付け」）`); } },
      c ? { icon: "📋", label: `貼り付け「${c.name}」`, disabled: !room, why: room ? "空いた所に置きます" : "空きがありません", run: () => paste(null) } : null,
      { sep: true },
      { icon: "🗑", label: "このパネルを消す", key: "Delete", danger: true, why: "元に戻す（Ctrl+Z）で戻せます",
        run: () => { editing(); DS.confirm = "del:" + id; remove(id); } },
    ] });
  }
  function gridMenu(x, y) {
    const at = cellAt(x, y), free = at && fits({ ...at, w: 1, h: 1 }), c = clip(), room = !!freeSpot(1, 1);
    WL.dashKit.menu({ x, y, head: (current() || {}).name || "ダッシュボード", items: [
      { group: "パネル" },
      { icon: "＋", label: free ? "ここにパネルを足す" : "パネルを足す", disabled: !room, why: room ? "" : "空きがありません（段を増やす）", run: () => { editing(); addPanel(free ? at : null); } },
      { icon: "📋", label: c ? `貼り付け「${c.name}」` : "貼り付け", disabled: !c || !room, why: !c ? "パネルの右クリックで写せます" : !room ? "空きがありません" : free ? "ここに置きます" : "空いた所に置きます",
        run: () => paste(free ? at : null) },
      { icon: "↶", label: "元に戻す", key: "Ctrl+Z", disabled: !DS.edit || !DS.history.length, run: () => undo() },
      { group: "画面" },
      { icon: "↻", label: "すべて引き直す", run: () => refresh(true) },
      { icon: "🖼", label: "画面の画像をコピー", run: () => shot("copy") },
      DS.edit ? null : { icon: "✎", label: "編集に入る", run: () => { editing(); say("見出しで動かす・四隅で大きさ・空いたマスで足す"); } },
    ] });
  }
  function onMenu(e) {
    if (!DS.active || !DS.layout || DS.editing || drag) return;
    const t = e.target; if (!t.closest || t.closest("input,select,textarea")) return;
    const pEl = t.closest(".dash-p");
    if (pEl) { e.preventDefault(); panelMenu(pEl.dataset.id, e.clientX, e.clientY); return; }
    if (t.closest("#dashGrid")) { e.preventDefault(); gridMenu(e.clientX, e.clientY); }
  }

  /* ---------------- 押す ---------------- */
  function onClick(e) {
    const t = e.target; if (!t.closest) return;
    const b = t.closest("button"); const pEl = t.closest(".dash-p");
    if (DS.edit && pEl && !b && !DS.editing) { DS.sel = pEl.dataset.id; document.querySelectorAll("#dashGrid .dash-p").forEach((x) => x.classList.toggle("is-sel", x === pEl)); }
    if (!b) return;
    if (b.dataset.dbTab) { if (DS.edit && dirty()) { say("編集中の変えた所を保存するか、やめてから開いてください"); return; } open(b.dataset.dbTab); return; }
    if (b.hasAttribute("data-db-pick")) { if (DS.pop === "pick") closePop(); else { DS.confirm = ""; openPop("pick", b, pickHtml(), "dash-pickpop"); } return; }
    if (b.hasAttribute("data-db-refresh")) { refresh(true); return; }
    // スライサー
    if (b.dataset.dsPeriod != null) { const k = b.dataset.dsPeriod; setSlice({ ...(sliceState() || {}), period: k ? { kind: k, ...(k === "days" ? { n: 7 } : {}) } : null }); return; }
    if (b.dataset.dsBack != null) { const k0 = D.backOf((sliceState() || {}).period); setSlice({ ...(sliceState() || {}), period: D.periodBack(Math.max(0, (k0 ?? 0) + +b.dataset.dsBack)) }); return; }
    if (b.hasAttribute("data-ds-all")) { setSlice({ ...(sliceState() || {}), equips: [] }); return; }
    if (b.dataset.dsGroup != null) {
      const g = D.groupsOf(DS.tree || {}, (sliceState() || {}).set).find((x) => x.name === b.dataset.dsGroup), cur = (sliceState() || {}).equips || [];
      const on = g && cur.length === g.members.length && g.members.every((m) => cur.includes(m));
      setSlice({ ...(sliceState() || {}), equips: on || !g ? [] : g.members.slice() }); return;
    }
    if (b.hasAttribute("data-ds-pick")) { if (DS.pop === "slice") closePop(); else { const el = openPop("slice", "#dashSlicer [data-ds-pick]:not([hidden])", D.pickHtml(sliceState(), sliceInfo()), "dash-slicepop"); D.mixed(el); if (!DS.tree) loadTree(); } return; }
    if (b.hasAttribute("data-ds-clear")) { setSlice({ set: (sliceState() || {}).set }); say("スライサーを外しました"); return; }
    if (b.hasAttribute("data-ds-date")) { if (DS.pop === "date") closePop(); else openCal(); return; }
    if (b.hasAttribute("data-ds-cfg")) { if (DS.pop === "cfg") closePop(); else openPop("cfg", "#dashBar [data-ds-cfg], #dashSlicer:not([hidden]) [data-ds-cfg]", D.cfgHtml(barCfg(), cfgInfo()), "dash-cfgpop"); return; }
    if (b.hasAttribute("data-db-editmode")) { DS.edit = true; DS.confirm = ""; paint(); say("見出しで動かす・四隅で大きさ・空いたマスで足す"); return; }
    if (b.hasAttribute("data-db-leave")) { if (dirty()) { DS.confirm = "leave"; paintBar(); } else { DS.edit = false; closeEditor(); paint(); } return; }
    if (b.hasAttribute("data-db-stay")) { DS.confirm = ""; paintBar(); return; }
    if (b.hasAttribute("data-db-discard")) { DS.confirm = ""; closeEditor(); const id = DS.id; DS.edit = false; if (id != null) open(id); else open(DS.standardId); return; }
    if (b.hasAttribute("data-db-save")) { save(); return; }
    if (b.hasAttribute("data-db-saveas")) { if (DS.pop === "saveas") closePop(); else {
      openPop("saveas", b, saveAsHtml(), "dash-savepop"); paintSavePlan();
      popEl.addEventListener("input", (e) => { if (e.target.id === "dbSaveName") paintSavePlan(); });
      const nm = popEl.querySelector("#dbSaveName");
      nm.select();
      nm.addEventListener("keydown", (e) => { if (e.key === "Enter" && !WL.dashKit.composing(e)) { e.preventDefault(); saveAs(); } });   // 名前を打って Enter で保存（版 3.43.0）
    } return; }
    if (b.hasAttribute("data-db-add")) { addPanel(); return; }
    if (b.hasAttribute("data-db-undo")) { undo(); return; }
    if (b.dataset.cell) { const [x, y] = b.dataset.cell.split(",").map(Number); addPanel({ x, y }); return; }
    const id = pEl && pEl.dataset.id;
    if (!id) return;
    if (b.hasAttribute("data-db-filter")) { openFilter(id, b); return; }
    // パネルのスライサー（版 3.52.0）: 値の札を押すと選ぶ・もう一度で外す
    if (b.dataset.dbSpv != null) { const v = b.dataset.dbSpv, cur = pickOf(id); setPick(id, cur.includes(v) ? cur.filter((x) => x !== v) : cur.concat([v])); return; }
    if (b.hasAttribute("data-db-spclear")) { setPick(id, []); say("スライサーの選びを外しました"); return; }
    if (b.dataset.dbQdrop) { setQuick(id, Q.drop(quickOf(id), b.dataset.dbQdrop)); refresh(false); paintPanel(id); return; }
    if (b.hasAttribute("data-db-more")) { if (DS.pop === "more") closePop(); else { const el = openPop("more", b, moreHtml(id), "dash-morepop"); el.dataset.panel = id; } return; }
    if (b.hasAttribute("data-db-edit")) { openEditor(id); return; }
    if (b.hasAttribute("data-db-dup")) { duplicate(id); return; }
    if (b.hasAttribute("data-db-del")) remove(id);
  }
  function onChange(e) {
    const t = e.target;
    if (t.matches && t.matches("[data-ds-psel]")) { if (t.value === "@range") return; const [k, n] = t.value.split(":"); setSlice({ ...(sliceState() || {}), period: k ? { kind: k, ...(k === "days" ? { n: 7 } : n ? { n: +n } : {}) } : null }); return; }
    if (t.matches && t.matches("[data-ds-gsel]")) {
      if (t.value === "@pick") { const el = openPop("slice", "#dashSlicer [data-ds-gsel]", D.pickHtml(sliceState(), sliceInfo()), "dash-slicepop"); D.mixed(el); return; }
      if (t.value === "@custom") return;
      const g = D.groupsOf(DS.tree || {}, (sliceState() || {}).set).find((x) => x.name === t.value);
      setSlice({ ...(sliceState() || {}), equips: g ? g.members.slice() : [] }); return;
    }
    if (t.matches && t.matches("[data-db-rows]")) { const n = +t.value; if (n >= minRows()) commit((L) => { L.rows = n; }); }
  }

  /* ---------------- 大きさが変わったら描き直す（窓・グリッドの段・パネルそのもの〈焦点など〉） ---------------- */
  let ro = null, roT = 0;
  const sizes = new Map();
  function watchSize() {
    if (ro || typeof ResizeObserver === "undefined") return;
    ro = new ResizeObserver(() => { clearTimeout(roT); roT = setTimeout(() => {
      if (!DS.active || !DS.layout || drag) return;
      DS.layout.panels.forEach((p) => {      // 大きさが変わったパネルだけ描き直す
        const el = document.querySelector(`#dashGrid .dash-p[data-id="${CSS.escape(p.id)}"]`); if (!el) return;
        const k = `${el.clientWidth}x${el.clientHeight}`;
        if (sizes.get(p.id) !== k) { sizes.set(p.id, k); paintPanel(p.id); }
      });
    }, 120); });
    ro.observe($("#dashGrid"));
    document.querySelectorAll("#dashGrid .dash-p").forEach((el) => ro.observe(el));
  }

  let bound = false;
  function bind() {
    if (bound) return; bound = true;
    const box = $("#dashScreen"), bar = $("#dashBar");
    box.addEventListener("click", onClick);
    box.addEventListener("change", onChange);
    // 道具の行はヘッダーの操作列へ移る（器の外）。器の中に居るあいだ（画面を出ている）は押せないので二重にならない
    bar.addEventListener("click", (e) => { if (!box.contains(bar)) onClick(e); });
    bar.addEventListener("change", (e) => { if (!box.contains(bar)) onChange(e); });
    $("#dashGrid").addEventListener("pointerdown", onDown);
    $("#dashGrid").addEventListener("contextmenu", onMenu);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (DS.active) paintBar(); }, 150); });
    // この端末の使用設備が変わったら数え直す（「自設備」＝@mine のパネルが新しい設備で数える）。マスタ（設備グループ）は開くたびに読み直す（start）
    WL.equipment.onChange(() => { if (DS.active && DS.layout) refresh(true); });
    // 時間の書き方（「表示」の分／時間と分）を変えたら、いま出ている数を書き直す（分の値は WL.duration で書く）
    document.addEventListener("wl:duration-style", () => { if (DS.active && DS.layout) DS.layout.panels.forEach((p) => paintPanel(p.id)); });
    watchSize();
  }

  async function start() {
    bind();
    if (DS.loading) return;
    DS.loading = true;
    try {
      await Promise.all([loadList(), loadSources()]);
      await loadSets();
      loadTree();
      // セットを使っていれば、覚えたダッシュボード（セットの中なら）か、セットの 1 つ目を開く
      const ds = setDash(), m = mem(), want = DS.want;
      DS.want = null; DS.loading = false;
      if (want != null) open(want);
      else if (!DS.layout) open(ds.length && !ds.some((x) => String(x.id) === String(m.id)) ? ds[0].id : m.id);
      else { paint(); refresh(false); }
    } catch (e) { DS.msg = String(e.message || e); paint(); }
    DS.loading = false;
  }

  WL.dashboard = {
    activate() {
      DS.active = true;
      start();
      if (DS.layout) refresh(Date.now() - DS.at > POLL_MS / 2);
      clearInterval(DS.timer);
      DS.timer = setInterval(() => { if (!DS.editing && !drag) refresh(true); }, POLL_MS);
    },
    deactivate() { DS.active = false; clearInterval(DS.timer); DS.timer = null; closePop(); },
    /** 評価関数・試験から: いまの組みと答え */
    /** 案を撮る道具（ui-variants.mjs）から: 組みを置き換えて描く（保存はしない） */
    /** 案を撮る道具から: スライサーの字（compact で詰めた形）。置き場を替える案が、道具の行の外に描くため */
    _slicerHtml: (compact = false) => (compact ? D.compactHtml : D.barHtml)(sliceState(), sliceInfo()),
    /** 試験から: id のダッシュボードを開く（人が上の札から選ぶのと同じ open） */
    _open: (id) => open(id),
    _setLayout(l) { DS.layout = WL.dashKit.clone(l); DS.saved = JSON.stringify(DS.layout); DS.answers.clear(); paint(); refresh(true); },
    _state: () => ({ id: DS.id, edit: DS.edit, loading: DS.loading, active: DS.active, msg: DS.msg, listN: DS.list.length, layout: WL.dashKit.clone(DS.layout), answers: Object.fromEntries([...DS.answers].map(([k, v]) => [k, v.d || { error: v.err }])) }),
  };

  /* ---------------- WaveLog の画面として（§9.628） ----------------
     左メニューの「ダッシュボード」から開く。器は #grid の兄弟（ほかの画面と同じ「メイン画面の表示切り替え」）。
     保存していない並びは、ほかの画面へ移っても DS に残る（戻れば続きから）。アプリを閉じる前は WL.closeGuard が聞く（unsaved.watch）。 */
  function ensureScreen() {
    let el = $("#dashScreen");
    if (el) return el;
    el = document.createElement("section");
    el.id = "dashScreen"; el.className = "dash-screen"; el.hidden = true; el.setAttribute("aria-label", "ダッシュボード");
    el.replaceChildren(WL.template("dash-screen"));
    const grid = document.getElementById("grid");
    if (grid && grid.parentNode) grid.parentNode.insertBefore(el, grid); else document.body.append(el);
    return el;
  }
  const NAV_ICON = '<svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/></svg>';
  function ensureNav() {
    const nav = document.querySelector("#homeNav") || document.querySelector("#analysisNav");      // メニューの上（§9.630 ⑤）
    if (!nav || document.getElementById("openDashboard")) return;
    const b = document.createElement("button");
    b.type = "button"; b.id = "openDashboard"; b.className = "db nav-item nav-item--view";
    b.innerHTML = `${NAV_ICON}<span>ダッシュボード</span>`;
    b.title = "パネルを並べて、測定データ・作業予定・データソースを表とグラフで数えます（稼働状況・自設備・作業時間の分析を組み込み）";
    b.onclick = openView;
    nav.append(b);
  }
  function exitView() {
    if (!document.body.classList.contains("db-mode")) return;
    document.body.classList.remove("db-mode");
    const el = $("#dashScreen"); if (el) el.hidden = true;
    WL.dashboard.deactivate();
  }
  /** 「画面を印刷」（ヘッダー）: いまのグリッドを見た目のまま A4 横 1 枚へ（WL.printCore.printScreen の1箇所・§9.525） */
  function printView(opt) {
    const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
    return WL.printCore.printScreen({ root: $("#dashScreen"), paper: "a4-landscape", styleId: "dashPrintPage",
      title: `ダッシュボード_${(current() || {}).name || ""}_${stamp}`, dryRun: !!(opt && opt.dryRun) });
  }
  WL.registerView({ key: "dashboard", bodyClass: "db-mode", nav: "openDashboard", toolbar: "#dashBar", exit: exitView, print: printView,
    printHint: "いま出ているダッシュボードのパネルを、見た目のまま A4 横 1 枚に刷ります（パネル 1 枚の画像は右クリックの「画像で保存・コピー」）",
    header: ["ダッシュボード", "パネルを並べて、測定データ・作業予定・データソースを数える"] });
  function openView() {
    ensureScreen();
    WL.enterView("dashboard");         // 道具の行（#dashBar）はヘッダーの操作列へ載る（ほかの画面と同じ・§9.100）
    $("#dashScreen").hidden = false;
    WL.dashboard.activate();
  }
  WL.dashboard.open = openView;
  // 起動時の画面（§9.630 ⑤・答えは WL.startView の1箇所）。元データの一覧（/api/catalog）の答えを待たずに開く
  WL.onReady(() => { ensureNav(); if (WL.startView.get() === "dashboard") openView(); });
})();
