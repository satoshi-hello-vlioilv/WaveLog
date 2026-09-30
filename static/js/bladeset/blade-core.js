/* blade-core.js: 刃組の計算（§9.377）。**画面を一切知らない**純粋な計算だけ。

   利用者から預かった刃組ガイダンス（1枚のHTML）から、幾何・分解・集約の
   ロジックをそのまま移した。移すにあたって変えたのは3つだけ:

     ① 部材の出どころ  localStorage → 刃組マスタ（`/api/bladeset/context`）
     ② 呼び名          「ライナー」→「スペーサー」（マスタ名に合わせる。
                        現場ではどちらでも呼ぶので、画面では併記する）
     ③ 保持層          ゴムリング **または** フィンガー（板押さえ）。
                        元のコードはフィンガー方式で保持層を持たなかったが、
                        フィンガーマスタを足したので**同じ層として数える**
                        ——どちらも「製品幅の上に載るだけで、軸方向の寸法には
                        効かない」ので、扱いは1本にできる。

   ----------------------------------------------------------------------
   決定の順序
     1. 製品のバリ方向（下バリ揃え / 上バリ揃え / 揃えない）
     2. ラインが中抜き可能か
        → 揃える かつ 中抜き可   : 中抜き（製品間に屑条を入れ逆バリを集める）
        → 揃える かつ 中抜き不可 : 交互反転巻き（刃は千鳥、1行おきに反転して巻く）
        → 揃えない               : 千鳥
   幾何モデル
     同じ切断で向かい合う上下の刃は、軸方向に**刃厚＋クリアランス**だけ中心が
     ずれる（§9.419）。向かい合うのは面と面で、そのあいだの隙間がクリアランス。
     刃どうしは円周が食い違う（ラップ）ので、これだけ離れていないと円周で
     ぶつかって切れない。どちら側へずれるかはバリ方向で決まり、千鳥では切断
     位置ごとに交互になるので、上下のスペーサー長は
       中間の区間 … 刃1枚ぶん広い／狭いが交互 ／ 端部の区間 … 刃厚＋クリアランス
   部材の二重構造
     スペーサーが軸方向の寸法を作り、その上に保持層（ゴムリング／フィンガー）が
     製品幅のぶんだけ載る（リング内径 ＞ スペーサー外径）。最外刃より外の
     端部はスペーサーのみ。
   組み付けの向き
     基準面（既定は駆動側の DS）の反対＝軸端部を外す側から挿入し、基準面の側から
     順に組んで、最後にフローティングシートで押さえる（§9.466）。手持ち寸法で埋めきれない端数は
     上下の左右差として現れるため、許容内かを必ず確かめる。
   ----------------------------------------------------------------------
   並び（上から下へ一方向にだけ依存する）
     1 マスタの正規化   2 索引   3 規則   4 幾何   5 分解   6 集約   7 入口
*/
(function(){
 'use strict';
 const WL = (window.WL = window.WL || {});

 const sum = a => a.reduce((x, y) => x + y, 0);
 /* 大きい順の寸法キー（数値として並べる） */
 const sizeKeys = o => Object.keys(o).map(Number).sort((a, b) => b - a);
 const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
 };

 /* ================== 1 マスタの正規化 ==================
    サーバーの戻り（`/api/bladeset/context`）を、計算が読む形へ。
    **ここで欠けを埋める**——以降のコードは「無いかもしれない」を考えない。 */
 function normalize(ctx) {
  const c = ctx || {};
  const P = Object.assign({}, c.standardDefaults || {}, c.standard || {});
  const spacers = (c.spacers || [])
   .map(x => ({ size: num(x.size), qty: Math.max(0, num(x.qty) || 0),
                minQty: num(x.minQty) || 0, use: x.use || '' }))
   .filter(x => x.size > 0);
  const ringAll = (c.rings || [])
   .map(x => ({ color: x.color || '', hex: x.hex || '', od: num(x.od),
                bore: num(x.bore) || num(P.ringBore), width: num(x.width),
                qty: Math.max(0, num(x.qty) || 0), minQty: num(x.minQty) || 0,
                lube: !!x.lube }))
   .filter(x => x.od > 0 && x.width > 0);
  /* **潤滑リングは同じ表の別の役目**（§9.455）。区間を埋めるゴムリングの候補に
     混ぜると、幅10の潤滑リングが「ゴムリング10」として積まれてしまうので分ける。 */
  const rings = ringAll.filter(x => !x.lube), lubes = ringAll.filter(x => x.lube);
  const fingers = (c.fingers || [])
   .map(x => ({ name: x.name || '', width: num(x.width),
                qty: Math.max(0, num(x.qty) || 0), minQty: num(x.minQty) || 0,
                maxThickness: num(x.maxThickness),
                /* 形（§9.379）。**図がここから寸法を取る**ので落とさない。 */
                length: num(x.length), thickness: num(x.thickness),
                grindRun: num(x.grindRun), grindDrop: num(x.grindDrop) }))
   .filter(x => x.width > 0);
  const blades = (c.blades || [])
   .map(x => ({ name: x.name || '', group: x.group || '',
                thickness: num(x.thickness), currentDia: num(x.currentDia),
                qty: Math.max(0, num(x.qty) || 0), minQty: num(x.minQty) || 0,
                lastGrind: x.lastGrind || '', grindCount: num(x.grindCount) || 0,
                status: x.status || '' }));
  /* **サーバーが渡したものを落とさない**（§9.381）。ここは「読みやすい形へ
     直す」場所であって、**選り分ける場所ではない**——`picks`（刃選択の決まり）と
     語彙を落としていたため、盤では当たるのにガイダンスでは一度も当たらない、
     という最も分かりにくい壊れ方をしていた（§9.306「サーバーが正しく答えても、
     画面が引かなければ何も変わらない」）。足した鍵はここにも書くこと。 */
  return { P, spacers, rings, lubes, fingers, blades,
           history: (c.history || []).slice(),
           designs: (c.designs || []).slice(),
           picks: (c.picks || []).slice(),
           /* 台車（§9.424）。**無いときは空の並び**——画面が A/B を作らない。
              呼び名（初期セットの顔ぶれ・台車なしの綴り）はサーバーが持つ。 */
           carriages: (c.carriages || []).slice(),
           carriageSeed: (c.carriageSeed || []).slice(),
           carriageNone: c.carriageNone || '台車なし',
           pickFields: (c.pickFields || []).slice(),
           /* 保持方式の条件表（§9.524）。登録が無ければサーバーが今までの決め方の「種」を返す。 */
           holds: (c.holds || []).slice(), holdsStored: !!c.holdsStored,
           holdMethods: (c.holdMethods || []).slice(), holdFields: (c.holdFields || []).slice(),
           pickOps: (c.pickOps || []).slice(),
           equipment: c.equipment || '',
           standardStored: !!c.standardStored,
           bladeStatus: c.bladeStatus || [], spacerUses: c.spacerUses || [],
           bladeGeneral: c.bladeGeneral || '一般',
           bladeSpecial: c.bladeSpecial || '専用',
           bladeMaint: c.bladeMaint || 'メンテナンス中',
           fingerShape: Object.assign({}, c.fingerShape || {}),
           ringColors: c.ringColors || [] };
 }

 /* ================== 2 索引 ==================
    マスタは1入力ごとには変わらない。並べ替えと検索表はここで一度だけ作り、
    マスタが届いたときにだけ作り直す（描画のたびに並べ替えない）。 */
 const thOf = r => +((r.od - (r.bore || 0)) / 2).toFixed(2);

 function buildIndex(M) {
  /* ゴムリングは1行＝（色, 幅）。**色（＝外径）でまとめる**——1本を見分けるのは
     色と幅の2つで、在庫も色×幅で持つ。 */
  const byOd = new Map(), widthsByOd = new Map();
  M.rings.forEach(r => {
   if (!byOd.has(r.od)) byOd.set(r.od, { color: r.color, hex: r.hex, bore: r.bore, od: r.od });
   const list = widthsByOd.get(r.od) || [];
   const cur = list.find(w => w.sz === r.width);
   if (cur) cur.qty += r.qty; else list.push({ sz: r.width, qty: r.qty });
   widthsByOd.set(r.od, list);
  });
  widthsByOd.forEach(list => list.sort((a, b) => b.sz - a.sz));
  const ringsByTh = [...byOd.values()].sort((a, b) => thOf(b) - thOf(a));
  const spacerSizes = M.spacers.map(s => s.size).sort((a, b) => b - a);
  const spacerStock = new Map();
  M.spacers.forEach(s => {
   const cur = spacerStock.get(s.size);
   if (cur) cur.qty += s.qty; else spacerStock.set(s.size, Object.assign({}, s));
  });
  /* フィンガーは幅ごとにまとめる（ゴムリングの幅と同じ扱い）。 */
  const fingerWidths = [];
  M.fingers.forEach(f => {
   const cur = fingerWidths.find(w => w.sz === f.width);
   if (cur) cur.qty += f.qty; else fingerWidths.push({ sz: f.width, qty: f.qty });
  });
  fingerWidths.sort((a, b) => b.sz - a.sz);
  return { byOd, widthsByOd, ringsByTh, spacerSizes, spacerStock, fingerWidths,
           span: Math.max(100, num(M.P.arborLen) || 1600),
           fillCache: new Map() };
 }

 /* 外径 1mm ごとの色の周期。**マスタに無い外径でも色で呼べる**ようにするための
    言い換えで、保存の規則ではない（サーバーの`ring_color_of()`と同じ表）。
    語彙はサーバーの戻り（`ringColors`）から取り、画面には書き写さない。 */
 function ringMeta(M, IX, od) {
  const known = IX.byOd.get(od);
  if (known) return known;
  const cycle = M.ringColors || [];
  if (!cycle.length) return { color: '', hex: '', od: od, bore: num(M.P.ringBore) };
  const top = cycle[0].od;
  const i = ((Math.round(top - od) % cycle.length) + cycle.length) % cycle.length;
  return { color: cycle[i].color, hex: cycle[i].hex, od: od, bore: num(M.P.ringBore) };
 }

 /* ================== 3 規則 ================== */
 const METHOD_NAME = { chidori: '千鳥', nakanuki: '中抜き', flip: '交互反転巻き' };
 const METHOD_DESC = {
  chidori: 'バリ方向を揃えないため、隣り合う条のバリが上下交互になります。',
  nakanuki: '製品条の間に屑条を組み込み、逆向きのバリを屑側へ集めます。屑条を抜くと製品のバリが揃います。',
  flip: '刃は千鳥のまま組み、1行おきにコイルを反転して巻くことで製品のバリを揃えます。'
 };
 const ALIGN_NAME = { down: '下バリ揃え', up: '上バリ揃え', none: '揃えない' };

 /* 刃組方式はバリ方向とライン条件から決まる（利用者が直接選ぶものではない）。 */
 function method(st) {
  if (st.align === 'none') return 'chidori';
  return st.canNk ? 'nakanuki' : 'flip';
 }
 /* 板を保持する方式（フィンガー／ゴムリング）。答えは`holdPick()`の1箇所（§9.524）——
    `保持方式マスタ`の条件表を上から見て、最初に当たった行の方式。 */
 const isFinger = (st, M) => holdPick(st, M).hold === 'フィンガー';
 const holdName = (st, M) => (isFinger(st, M) ? 'フィンガー' : 'ゴムリング');
 const oppBurr = b => (b === 'down' ? 'up' : 'down');
 const oppRing = t => (t === 'big' ? 'small' : 'big');
 /* 同一条の両側は同じリング。上軸と下軸では大小が入れ替わる。

    **広げた側（内々）が小径・製品幅を作る側（外々）が大径**（§9.434、
    利用者の指示）:

      下バリ → 上刃を広く → 上刃側にクリアランス分を追加 → **上側が小径**
      上バリ → 下刃を広く → 下刃側にクリアランス分を追加 → **下側が小径**

    外々の対＝製品幅を作る刃は、**製品の面のすぐ下（上）に身がある**。
    大径リングは刃先より外まで張り出しているので、板をその刃から浮かせて
    傷の混入を防ぐ。広げた側の刃は製品から逃げているので、そちらは小径で
    ラップを稼ぐ。**以前は逆に当てていた**（内々の側に大径）。 */
 const ringType = (burr, upper) => {
  const t = burr === 'down' ? 'small' : 'big';
  return upper ? t : oppRing(t);
 };
 const odFromTh = (M, th) => Math.round((num(M.P.ringBore) || 0) + th * 2);
 const odOfType = (st, M, t) => odFromTh(M, t === 'big' ? st.bigTh : st.smallTh);

 /* ================== 4 幾何 ================== */
 const ringR = (M, th) => (num(M.P.ringBore) || 0) / 2 + th;
 /* リング外周どうしの当たりから決まる3つの量。 */
 function contact(st, M) {
  const Rb = ringR(M, st.bigTh), Rs = ringR(M, st.smallTh);
  const gap = st.knife - st.ov - Rb - Rs;      /* 軸間距離 = 刃径 - ラップ */
  return { push: Rb - st.knife / 2, gap, nip: st.thick - gap };
 }
 /* 狙いの肉厚に最も近い手持ちリングへ寄せる。**手持ちが無ければ動かさない**
    （0へ倒すと、リングを登録していない設備で押上げが必ず「不適」になる）。 */
 function snapTh(IX, v) {
  if (!IX.ringsByTh.length) return v;
  return IX.ringsByTh.reduce((a, r) => (Math.abs(thOf(r) - v) < Math.abs(a - v) ? thOf(r) : a),
                             thOf(IX.ringsByTh[0]));
 }
 /* 自動のときだけ、狙い値に最も近い手持ちリングへ寄せる。 */
 function recommend(st, M, IX) {
  const P = M.P;
  if (st.bigMode === 'auto') {
   st.bigTh = snapTh(IX, st.knife / 2 - (num(P.ringBore) || 0) / 2 + (num(P.pushTarget) || 0));
  }
  if (st.smallMode === 'auto') {
   const targetGap = st.thick - ((num(P.nipMin) || 0) + (num(P.nipMax) || 0)) / 2;
   st.smallTh = snapTh(IX, st.knife - st.ov - ringR(M, st.bigTh) - targetGap
                           - (num(P.ringBore) || 0) / 2);
  }
 }

 /* 並びをロットの本数に合わせる。足りないぶんは**同じロットの最後の条のすぐ後ろへ**
    入れ、多いぶんは後ろから削る。末尾にまとめて足すと、本数を1本増やしただけで
    並びの見え方が変わってしまう。 */
 function syncOrder(st) {
  const want = st.lots.map(L => Math.max(1, L.n | 0));
  const have = want.map(() => 0);
  const kept = [];
  (Array.isArray(st.order) ? st.order : []).forEach(i => {
   if (i < want.length && have[i] < want[i]) { have[i]++; kept.push(i); }
  });
  want.forEach((n, i) => {
   while (have[i] < n) {
    have[i]++;
    const at = kept.lastIndexOf(i);
    if (at < 0) kept.push(i); else kept.splice(at + 1, 0, i);
   }
  });
  st.order = kept;
  return st.order;
 }
 /* 並べ直し：ロット順／幅の大きい順 */
 function reorder(st, how) {
  syncOrder(st);
  if (how === 'lot') st.order.sort((a, b) => a - b);
  else if (how === 'wide') st.order.sort((a, b) => (+st.lots[b].w) - (+st.lots[a].w) || a - b);
 }

 /* 条列を作る。`burr`は幾何上のバリ方向、`prod`は製品として巻いた後の向き。
    交互反転巻きでは刃は千鳥のまま（burrが交互）、巻きで揃える（prodが一定）。 */
 function buildSegs(st) {
  const strips = syncOrder(st).map(i => ({ w: +st.lots[i].w, lot: st.lots[i].name, lotIx: i }));
  const m = method(st), segs = [];
  if (m === 'nakanuki') {
   const pb = st.align, sb = oppBurr(pb);
   strips.forEach((s, i) => {
    segs.push({ w: +s.w, type: 'strip', lot: s.lot, lotIx: s.lotIx, burr: pb, prod: pb,
                flip: false, label: '条' + (i + 1) });
    if (i < strips.length - 1) {
     segs.push({ w: +st.nkWidth, type: 'scrap', lot: '屑条', burr: sb, prod: sb,
                 flip: false, label: '屑' + (i + 1) });
    }
   });
  } else if (m === 'flip') {
   let b = st.align;
   strips.forEach((s, i) => {
    segs.push({ w: +s.w, type: 'strip', lot: s.lot, lotIx: s.lotIx, burr: b, prod: st.align,
                flip: (b !== st.align), label: '条' + (i + 1) });
    b = oppBurr(b);
   });
  } else {
   let b = 'down';
   strips.forEach((s, i) => {
    segs.push({ w: +s.w, type: 'strip', lot: s.lot, lotIx: s.lotIx, burr: b, prod: b,
                flip: false, label: '条' + (i + 1) });
    b = oppBurr(b);
   });
  }
  return segs;
 }

 /* 幅の割付：W = OS耳 + Σ条 + DS耳。板はラインのセンターに通すため、
    既定は耳を左右均等に取る。 */
 function widths(st, segs) {
  const total = +segs.reduce((a, s) => a + s.w, 0).toFixed(3);
  const rest = +(st.W - total).toFixed(3);
  const osTrim = st.trimMode === 'even'
   ? +(rest / 2).toFixed(3)
   : Math.min(Math.max(0, +st.osTrim || 0), Math.max(0, rest));
  const dsTrim = +(rest - osTrim).toFixed(3);
  return { total, rest, osTrim, dsTrim, even: st.trimMode === 'even',
           ok: rest >= 0 && osTrim >= 0 && dsTrim >= 0 };
 }

 /* 軸上の刃位置と、刃と刃のあいだに残るスペーサー区間の長さ。

    **上下の刃は「刃厚＋クリアランス」だけ軸方向にずれる**（§9.419、利用者の
    指摘「上下の刃は刃厚分ズレてないと切れません」）。同じ切断の上刃と下刃は
    円周が食い違う（ラップ）ので、軸方向にも**刃の身がすれ違うだけ**離れて
    いなければ、円周でぶつかって切れない。向かい合うのは**面と面**で、その
    あいだの隙間がクリアランス——中心どうしは `刃厚/2 + クリアランス + 刃厚/2`
    だけ離れる。
    どちら側へずれるかはバリ方向で決まり、千鳥では切断位置ごとに交互になる:
      中間の区間 … 両端の切断でずれの向きが逆になるので （刃厚＋クリアランス）×2
      端部の区間 … 切断が片側だけなので 刃厚＋クリアランス
    以前は**クリアランスだけ**ずらしており、上下の刃の身が 9.87mm 重なっていた
    （実測・刃厚10／クリアランス0.13）——物として組めない配置だった。

    **製品幅はクリアランスで痩せさせない**（§9.434、利用者の指摘「板幅は確保
    して組みます。ここにクリアランスでマイナス公差側には寄せません」）:

      板幅50・クリアランス0.1 のとき
        上刃：刃の**内々**寸法 ＝ 製品幅＋クリアランス×2 ＝ 50.2
        下刃：刃の**外々**寸法 ＝ 製品幅          ＝ 50.0   （下バリ。上バリは逆）

    条の端を決めるのは「その条の側を向いていない面」で、**外々の対が製品幅を
    そのまま作る**。内々の対はその外側をクリアランスぶん逃がすので、
    内々＝製品幅＋クリアランス×2 になる。

    §9.419 までは上下の刃を**公称の切断位置の中心に**振り分けていた
    （`U=X+d/2`／`Lo=X-d/2`）ので、外々も内々も公称からクリアランスの半分ずつ
    ずれ、**どの条も一律に「製品幅−クリアランス」**で出ていた
    （実測: 板幅50・クリアランス0.1 で全条 49.9）。これは注文幅に対する
    マイナス公差そのもので、現場の組み方と逆だった。

    いまは**刃が作る境目**（`edge`）を起点に置く。境目は条幅ではなく
    **条幅＋クリアランス**ずつ進む——1つの切断が作る2つの端は、上下の刃の
    面がクリアランスぶん離れているぶんだけ食い違うため。

      edge[i] = origin + c_i + (i − 1) × クリアランス
      U[i]    = edge[i] − 刃厚/2 + d × (sign[i] + 1) / 2
      Lo[i]   = edge[i] − 刃厚/2 + d × (1 − sign[i]) / 2

    起点をこう取ると、**1条目の左端がちょうど`origin`**（材料の並びの1条目の
    左端）になるので、図の材料と刃が OS 側でぴたりと合う。DS 側へ向かって
    最大 (条数−1)×クリアランス（22条・0.1で2.1mm）だけ、材料の並びと境目が
    食い違う——材料は連続した1枚なのに、端の測り方が条ごとに上下入れ替わる
    ことから来る差で、**耳が吸う**。 */
 function buildLayout(st, M, segs) {
  const tk = st.tk, n = segs.length;
  /* クリアランスは**組める値**を使う（§9.454）。打った値（`st.clr`）は
     そのまま残し、使った値と両方を`A`が持つ——画面は2つが違うときだけ言う。 */
  const CL = clearanceUsed(M, tk, st.clr);
  const arborLen = num(M.P.arborLen) || 1600, clr = CL.used;
  const grid = num(M.P.sizeStep) || 0.05;   /* 手持ちがそろっている刻み */
  const w = widths(st, segs);
  /* 各切断点で、上刃がどちら側へずれるか（下バリなら上刃は OS 側＝−）。 */
  const sign = new Array(n + 1).fill(0);
  segs.forEach((sg, j) => {
   const L = sg.burr === 'down' ? -1 : +1, R = sg.burr === 'down' ? +1 : -1;
   if (sign[j] === 0) sign[j] = L;
   if (sign[j + 1] === 0) sign[j + 1] = R;
  });
  const cuts = [0];
  let a = 0;
  segs.forEach(s => { a += s.w; cuts.push(+a.toFixed(3)); });
  /* 材料はアーバー中央に配置し、OS耳の分だけ内側から切り始める。
     ただし中央ぴったりだと、区間長に刻みの半端（0.025 等）が出ることがある。
     手持ちでそれを埋められる寸法は限られるので、材料の位置を1刻み未満だけ
     寄せて端数を消す。ずれる量は耳の左右差として現れるが、刻み未満なので
     耳には影響しない。 */
  /* 上下の刃の中心どうしの距離（§9.419）。面と面のあいだがクリアランス。 */
  const dKnife = +(tk + clr).toFixed(3);
  /* 板の中心は**基準面（基準原点）からの距離**（§9.456／§9.461、利用者の指示「基準原点を
     変更したら、中心位置の測り方も連動して変更」）。答えは`centerOf()`の1箇所で、
     ここで使うのはOS端から測り直した`os`（座標はOS端が0のまま）。 */
  const C = centerOf(st, M);
  const nominal = +(C.os - st.W / 2).toFixed(3);
  /* 刃が作る境目と、そこから起こす上下の刃の中心（§9.434。式は上の説明どおり）。 */
  const edgeOf = (base, i) => base + cuts[i] + (i - 1) * clr;
  const upOf = (base, i) => edgeOf(base, i) - tk / 2 + dKnife * (sign[i] + 1) / 2;
  const loOf = (base, i) => edgeOf(base, i) - tk / 2 + dKnife * (1 - sign[i]) / 2;
  /* **刻みへ寄せるのは基準面の側の端**（§9.461）。基準面の側は押し付けて積み始める端
     なので区間長が刻みの倍数でないと端数が残る。反対の端の残りはフローティングシートが
     押さえる（§9.456）。OS基準: OS端（上軸）の区間長を寄せる／DS基準: DS端（上軸）を寄せる。 */
  let slip;
  if (C.datum === 'OS') {
   const edge0 = upOf(nominal + w.osTrim, 0) - tk / 2;
   slip = +(edge0 - Math.round(edge0 / grid) * grid).toFixed(4);
  } else {
   const edgeN = arborLen - (upOf(nominal + w.osTrim, n) + tk / 2);
   slip = -(+(edgeN - Math.round(edgeN / grid) * grid).toFixed(4));
  }
  const matStart = +(nominal - slip).toFixed(4);
  const origin = matStart + w.osTrim;
  const U = cuts.map((c, i) => +upOf(origin, i).toFixed(3));
  const Lo = cuts.map((c, i) => +loOf(origin, i).toFixed(3));
  const zones = [
   { key: 'OS端', type: 'end', burr: oppBurr(segs[0].burr),
     up: +(U[0] - tk / 2).toFixed(3), lo: +(Lo[0] - tk / 2).toFixed(3) },
   ...segs.map((sg, j) => ({ key: sg.label, type: sg.type, seg: sg,
     up: +(U[j + 1] - U[j] - tk).toFixed(3), lo: +(Lo[j + 1] - Lo[j] - tk).toFixed(3) })),
   { key: 'DS端', type: 'end', burr: oppBurr(segs[n - 1].burr),
     up: +(arborLen - (U[n] + tk / 2)).toFixed(3),
     lo: +(arborLen - (Lo[n] + tk / 2)).toFixed(3) }
  ];
  return { U, Lo, zones, arborLen, grid, origin, center: C.value, centerFrom: C.from,
           /* 基準面と、フローティングシートが押さえる端の区間（§9.461）。 */
           datum: C.datum, floatZ: C.datum === 'OS' ? zones.length - 1 : 0,
           clr, clrWant: CL.want, clrStep: CL.step, clrRounded: CL.rounded,
           dKnife,                          /* 同じ切断での上下刃の中心間（刃厚＋クリアランス） */
           dReal: clr,                      /* 面と面のあいだ＝クリアランス（画面に出す値） */
           dZone: +(dKnife * 2).toFixed(3), /* 中間区間での上下スペーサー長の差 */
           dEdge: dKnife,                   /* 端部区間での差 */
           errs: zones.filter(z => z.up < 0 || z.lo < 0), matStart, slip, sign, w };
 }

 /* ================== 5 分解 ==================
    ---- 手持ち寸法の組み合わせ ----
    スペーサーは 100〜6 のほか 10.025〜10.9 という細かい刻みを持つ。
    「大きい順に詰める」だけだと端数が残り（実寸法で1区間あたり最大 5.6mm、
    上下の左右差が 35mm に達する）刃組が成立しない。
    そこで「その長さをちょうど作れるか、作れるなら最小何枚か」を全長ぶん
    先に解いておき、区間長からは表を引くだけにする。表はマスタが変わった
    ときだけ作り直すので、1入力ごとの手間は増えない。 */
 const FILL_STEP = 0.025;           /* 手持ち寸法の最小刻み */

 /* `items`は`{sz, qty}`。枚数が同じ組み合わせが複数あるときは、幅の広いもの →
    対象台車に載っているもの → 手持ちの多いもの の順に選ぶ。在庫の残数そのものを
    制約に入れると解が一気に重くなるため、ここでは優先順位として扱う
    （不足は所要の在庫欄で別に示す）。 */
 function buildFiller(items, maxMm) {
  const seen = new Map();
  (items || []).forEach(it => {
   const u = Math.round((+it.sz) / FILL_STEP);
   if (!(u > 0)) return;
   const cur = seen.get(u) || { qty: 0, pref: 0 };
   seen.set(u, { qty: Math.max(cur.qty, +it.qty || 0), pref: Math.max(cur.pref, +it.pref || 0) });
  });
  const units = [...seen.keys()].sort((a, b) => b - a);
  const score = units.map(u => {
   const v = seen.get(u);
   return u * 1e7 + v.pref * 1e4 + Math.min(v.qty, 9999);
  });
  const U = Math.max(1, Math.round(maxMm / FILL_STEP) + 1);
  const cnt = new Int32Array(U).fill(-1), pick = new Int16Array(U).fill(-1);
  cnt[0] = 0;
  for (let u = 1; u < U; u++) {
   let best = -1, bi = -1;
   for (let i = 0; i < units.length; i++) {
    const su = units[i];
    if (su > u) continue;
    const c = cnt[u - su];
    if (c < 0) continue;
    if (best < 0 || c + 1 < best || (c + 1 === best && score[i] > score[bi])) { best = c + 1; bi = i; }
   }
   cnt[u] = best; pick[u] = bi;
  }
  /* その長さ以下で作れる最大の長さ（引くたびに下へ辿らずに済む） */
  const floor = new Int32Array(U);
  for (let u = 1, last = 0; u < U; u++) { if (cnt[u] >= 0) last = u; floor[u] = last; }
  return { cnt, pick, units, U, floor };
 }
 /* 表を引いて、その長さに最も近い（超えない）組み合わせを取り出す */
 function fillWith(table, len) {
  const want = Math.max(0, +(+len).toFixed(3));
  if (!table) return { out: [], rem: want };
  /* **区間より長い積みを作らない**（§9.418、利用者の指摘「エンド部分まで
     スペーサーが詰まっていないといけないが、隙間が目立つ」）。以前は
     `Math.round` で刻みへ丸めており、**区間長を最大で刻みの半分（0.0125mm）
     超える**積みを選び得た。超えたぶんは `rem` が `Math.max(0, …)` で0に
     潰れて見えなくなり、図の側は「入らない最後の1枚」を落とす——**10mm の
     部材が丸ごと消えて穴になっていた**（実測: 下軸のDS端と中間の3区間）。
     積みは区間を超えてはならない（超えれば刃の位置が動く）ので、**切り下げる**。
     `1e-9` は「ちょうど割り切れる長さ」が浮動小数で 0.9999… になる取りこぼし避け。 */
  const u = table.floor[Math.min(Math.floor(want / FILL_STEP + 1e-9), table.U - 1)];
  const by = new Map();
  for (let v = u; v > 0;) {
   const i = table.pick[v];
   if (i < 0) break;                       /* 手持ちが1つも無いとき（安全側） */
   const su = table.units[i];
   const sz = +(su * FILL_STEP).toFixed(3);
   by.set(sz, (by.get(sz) || 0) + 1);
   v -= su;
  }
  return { out: [...by.entries()].sort((a, b) => b[0] - a[0]),
           rem: Math.max(0, +(want - u * FILL_STEP).toFixed(3)) };
 }

 /* **幅を持たせた積み**（§9.457、利用者の指示「DS端は有効長に近づいたらフローティング
    シートで押さえる」「粗く積んで残りを任せる」・押さえ代は図面の F.P.ストローク 0.95mm）。
    長さ `len` から `slack` 短いところまでのあいだで、次の順にいちばん良い積みを取る:
      ① 細かいスペーサー（1mm の倍数でない寸法＝10.025〜10.9 等）の枚数が少ない
      ② 総枚数が少ない  ③ 残りが小さい
    ①を先に置くのは、細かいスペーサーが基準を追い込むための少ない在庫だから
    （`10.025` は初期セットで2枚）——DS端の残りはフローティングシートが吸う。
    窓の中に作れる長さが1つも無ければ `null`（呼ぶ側が切り下げの積みへ戻す）。 */
 const isFine = sz => Math.abs(sz - Math.round(sz)) > 1e-9;
 function stackOf(table, u) {
  const by = new Map();
  for (let v = u; v > 0;) {
   const i = table.pick[v];
   if (i < 0) break;
   const su = table.units[i];
   const sz = +(su * FILL_STEP).toFixed(3);
   by.set(sz, (by.get(sz) || 0) + 1);
   v -= su;
  }
  return [...by.entries()].sort((a, b) => b[0] - a[0]);
 }
 function fillWithin(table, len, slack) {
  if (!table) return null;
  const want = Math.max(0, +(+len).toFixed(3));
  const hi = Math.min(Math.floor(want / FILL_STEP + 1e-9), table.U - 1);
  const lo = Math.max(1, Math.ceil((want - slack) / FILL_STEP - 1e-9));
  let best = null;
  for (let v = hi; v >= lo; v--) {
   if (!(table.cnt[v] > 0)) continue;
   const out = stackOf(table, v);
   const fine = out.reduce((a, [sz, c]) => a + (isFine(sz) ? c : 0), 0);
   const key = [fine, table.cnt[v], hi - v];
   if (!best || key[0] < best.key[0] || (key[0] === best.key[0]
       && (key[1] < best.key[1] || (key[1] === best.key[1] && key[2] < best.key[2])))) {
    best = { key, out, u: v };
   }
  }
  if (!best) return null;
  return { out: best.out, rem: Math.max(0, +(want - best.u * FILL_STEP).toFixed(3)) };
 }

 /* 部材ごとの「いま使える数」。
    ラインは2台の台車を交互に使う。直前の刃組はラインで稼働中なので、そこに
    載っている部材は外せない＝使えない。いま組み替える台車（2回前の構成）に
    載っている部材は、そのまま使えるうえに棚から運ぶ手間もないので優先する。 */
 function stockPlan(st, M, IX) {
  const h = M.history || [], busy = h[0] || {};
  let onCar = null;
  for (let i = 1; i < h.length; i++) if (h[i].carriage === st.carriage) { onCar = h[i]; break; }
  const at = (rec, kind, key) => ((rec && rec.detail && rec.detail[kind] && rec.detail[kind][key]) || 0);
  const spacer = new Map(), ring = new Map(), finger = new Map(), lube = new Map();
  IX.spacerStock.forEach((x, sz) => {
   const total = x.qty, b = at(busy, 'spacer', sz), c = at(onCar, 'spacer', sz);
   spacer.set(sz, { total, busy: b, onCar: Math.min(c, Math.max(0, total - b)),
                    free: Math.max(0, total - b) });
  });
  IX.widthsByOd.forEach((ws, od) => ws.forEach(w => {
   const k = `${od}|${w.sz}`, total = w.qty;
   const b = at(busy, 'ring', k), c = at(onCar, 'ring', k);
   ring.set(k, { total, busy: b, onCar: Math.min(c, Math.max(0, total - b)),
                 free: Math.max(0, total - b) });
  }));
  IX.fingerWidths.forEach(w => {
   const total = w.qty, b = at(busy, 'finger', w.sz), c = at(onCar, 'finger', w.sz);
   finger.set(w.sz, { total, busy: b, onCar: Math.min(c, Math.max(0, total - b)),
                      free: Math.max(0, total - b) });
  });
  /* 潤滑リング（§9.455）。数え方はゴムリングと同じ——稼働中の台車に載っている
     ぶんは使えない。鍵は幅（記録の`detail.lube`と同じ）。 */
  (M.lubes || []).forEach(x => {
   const k = String(x.width), cur = lube.get(k);
   const total = (cur ? cur.total : 0) + x.qty;
   const b = at(busy, 'lube', k), c = at(onCar, 'lube', k);
   lube.set(k, { total, busy: b, onCar: Math.min(c, Math.max(0, total - b)),
                 free: Math.max(0, total - b) });
  });
  const sig = [st.carriage, busy.at || '-', onCar ? onCar.at : '-',
               M.spacers.length, M.rings.length, M.fingers.length].join('|');
  return { spacer, ring, finger, lube, busy: h[0] || null, onCar, sig };
 }

 /* 残っている部材から組み合わせ表を作る。顔ぶれ（使い切った寸法）が
    変わったときだけ作り直し、作ったものは取っておく。 */
 function fillTables(IX, plan, left, span, blocked, ignoreStock) {
  const mk = (entries, key) => entries.map(([sz, x]) => ({
   sz: +sz, qty: ignoreStock ? x.free : (left[key].get(String(sz)) || 0),
   pref: x.onCar > 0 ? 1 : 0 }));
  if (ignoreStock) {
   const key = `${plan.sig}#${span}#ALL`;
   let all = IX.fillCache.get(key);
   if (!all) {
    const rf = new Map();
    IX.widthsByOd.forEach((ws, od) => rf.set(od, buildFiller(ws.map(w => {
     const x = plan.ring.get(`${od}|${w.sz}`) || { free: 0, onCar: 0 };
     return { sz: w.sz, qty: x.free, pref: x.onCar > 0 ? 1 : 0 };
    }), span)));
    all = { spacer: buildFiller(mk([...plan.spacer.entries()], 'sp'), span),
            ring: rf,
            finger: buildFiller(mk([...plan.finger.entries()], 'fin'), span) };
    IX.fillCache.set(key, all);
   }
   return all;
  }
  const gone = blocked ? [...blocked] : [];
  plan.spacer.forEach((x, sz) => { if ((left.sp.get(String(sz)) || 0) <= 0) gone.push('S' + sz); });
  plan.ring.forEach((x, k) => { if ((left.ring.get(k) || 0) <= 0) gone.push('R' + k); });
  plan.finger.forEach((x, sz) => { if ((left.fin.get(String(sz)) || 0) <= 0) gone.push('F' + sz); });
  gone.sort();
  const key = `${plan.sig}#${span}#${[...new Set(gone)].join(',')}`;
  let set = IX.fillCache.get(key);
  if (set) return set;
  const block = new Set(gone);
  const pick = (entries, prefix, leftKey) => entries
   .filter(([sz]) => (left[leftKey].get(String(sz)) || 0) > 0 && !block.has(prefix + sz))
   .map(([sz, x]) => ({ sz: +sz, qty: left[leftKey].get(String(sz)), pref: x.onCar > 0 ? 1 : 0 }));
  const ringFill = new Map();
  IX.widthsByOd.forEach((ws, od) => {
   const items = ws.map(w => {
    const k = `${od}|${w.sz}`, x = plan.ring.get(k) || { onCar: 0 };
    return { sz: w.sz, qty: left.ring.get(k) || 0, pref: x.onCar > 0 ? 1 : 0 };
   }).filter(it => it.qty > 0 && !block.has(`R${od}|${it.sz}`));
   ringFill.set(od, buildFiller(items, span));
  });
  set = { spacer: buildFiller(pick([...plan.spacer.entries()], 'S', 'sp'), span),
          ring: ringFill,
          finger: buildFiller(pick([...plan.finger.entries()], 'F', 'fin'), span) };
  if (IX.fillCache.size > 20) IX.fillCache.clear();
  IX.fillCache.set(key, set);
  return set;
 }

 /* 1区間の中身を決める。
    保持層（ゴムリング／フィンガー）にはまず占有幅の枠を割り当てるが、手持ちの
    幅でしか組めない。組めなかった分は枠を空けたままにせず、スペーサー側へ回す
    ——スペーサーは細かい寸法を持つので、端数をそこで最小にできる。 */
 function zoneParts(len, isEnd, hold, tbl, rule, slack) {
  const total = Math.max(0, +(+len).toFixed(3));
  /* 軸の寸法はスペーサーが作る。区間の全長をスペーサーで組み、刃の位置はこれで
     決まる。保持層はその上に被せる別の層で、軸方向の寸法には効かない。
     **フローティングシートの側の端だけは幅を持たせる**（`slack`＝押さえ代・§9.457／§9.461）。 */
  const spacer = (slack > 0 && fillWithin(tbl.spacer, total, slack)) || fillWith(tbl.spacer, total);
  /* 保持層は製品幅の上にだけ載るので、最外刃より外（OS端・DS端）はスペーサーのみ。 */
  let ht = null;
  if (hold && !isEnd) ht = hold.kind === 'finger' ? tbl.finger : tbl.ring.get(hold.od);
  /* **板押さえは刃のあいだより空きの下限ぶん小さく組む**（§9.454 ゴムリング／
     §9.462 フィンガー、利用者の指示）。狙うのは「下限ぶんだけ小さい長さ」で、
     そこを超えない最大の組み合わせを取る——ぴったり（空き0）に組むと刃の
     あいだへ入らない。帯は種類ごとに`holdBand()`の1箇所が答え、下限0なら
     区間いっぱいを狙う（フィンガーの既定）。
     **潤滑リング**（広い側の刃の内側の両端・幅10）はその内側に先に置き、
     残りをゴムリングで埋める。 */
  const R = rule || RING_RULE_NONE;
  const isRing = !!(ht && hold.kind === 'ring');
  const lube = isRing && hold.lube && R.lubeW > 0
   ? { n: 2, w: R.lubeW, od: R.lubeOd, bore: R.lubeBore } : null;
  const room = +(total - (lube ? lube.n * lube.w : 0)).toFixed(3);
  const band = ht ? holdBandOf(R, hold.kind) : BAND_NONE;
  const want = ht ? Math.max(0, +(room - band.gapMin).toFixed(3)) : total;
  const got = ht ? fillWith(ht, want) : { out: [], rem: 0 };
  /* 空きは**区間から見た**値（狙いの下限ぶん＋埋め切れなかったぶん）。 */
  const gom = { out: got.out, rem: ht ? +(room - (want - got.rem)).toFixed(3) : 0 };
  /* **余りは層ごとに別の意味を持つ**（§9.441、利用者の指示「スペーサー間や
     スペーサーと刃の間には計算上の隙間は無い。……わずかに隙間ができてよいのは
     ゴムリングやフィンガーの部分の板押さえに該当する部分のみ」）。
       `rem`     … スペーサー層の端数。組んだものをOS側へ押し付けて組むので
                   **0が正**。0でなければ計算の不具合。
       `holdRem` … 板押さえ（ゴムリング／フィンガー）の空き。手持ちの幅で
                   埋め切れないぶんで、**わずかなら差し支えない**。
     混ぜて1つの数にすると、直さなければならない端数と、見ていればよい空きが
     見分けられなくなる。 */
  return { len: total, hold: ht ? hold : null, gom, spacer, lube,
           rem: spacer.rem, holdRem: ht ? gom.rem : 0 };
 }
 /* 板押さえの空きの帯（下限〜上限）。**答えは種類ごとにこの1箇所**（§9.462）
    ——ゴムリングは`ringGapMin/Max`、フィンガーは`fingerGapMin/Max`（どちらも
    設備ごとの`刃組基準値`）。上限0は「帯を持たない＝判定しない」。 */
 const BAND_NONE = { gapMin: 0, gapMax: 0 };
 const bandKeys = kind => (kind === 'finger' ? ['fingerGapMin', 'fingerGapMax'] : ['ringGapMin', 'ringGapMax']);
 function holdBand(M, kind) {
  const P = (M && M.P) || {}, v = k => Math.max(0, num(P[k]) || 0);
  const [ka, kb] = bandKeys(kind), a = v(ka), b = v(kb);
  return { gapMin: Math.min(a, b || a), gapMax: Math.max(a, b) };
 }
 /* `ringRule()`の答えから種類の帯を取り出す（`zoneParts()`は`M`を持たない）。 */
 const holdBandOf = (R, kind) => (kind === 'finger' ? (R.finger || BAND_NONE) : R);
 /* ゴムリングの組み方の決まり（§9.454）。**値は設備ごとの`刃組基準値`**
    （既定はサーバーの`STANDARD_DEFAULTS`）。読めない値は0——空きの帯を
    持たない・潤滑リングを入れない、に倒れる（勝手な数で埋めない・§9.231）。 */
 const RING_RULE_NONE = { gapMin: 0, gapMax: 0, finger: BAND_NONE, lubeW: 0, lubeOd: 0, lubeBore: 0,
                          lubeHex: '', lubeColor: '', lubeQty: 0 };
 /* 空きの帯は`刃組基準値`、**潤滑リングの寸法と在庫はゴムリングマスタの行**
    （種類＝潤滑リング・§9.455）。行が複数あるときは**表の並びの先頭**（サーバーの
    並べ方＝外径の大きい順）を使う——幅違いを混ぜて両端の2本が別の幅になるのを防ぐ。
    行が無ければ幅0（入れない）で、`solve()`の`fit.lubeMissing`がそう言う。
    `finger`はフィンガーの帯（§9.462）。 */
 function ringRule(M) {
  const L = ((M && M.lubes) || [])[0] || null;
  return { ...holdBand(M, 'ring'), finger: holdBand(M, 'finger'),
           lubeW: L ? L.width : 0, lubeOd: L ? L.od : 0, lubeBore: L ? L.bore : 0,
           lubeHex: L ? L.hex : '', lubeColor: L ? L.color : '', lubeQty: L ? L.qty : 0 };
 }
 /* 空きが帯（下限〜上限）を外れた面（ゴムリング・フィンガーとも・§9.462）。
    **1本も載らない面は別に数える**（`bareHold`）ので、ここでは言わない。 */
 function holdGapFaces(zp, M) {
  const R = ringRule(M), out = [];
  zp.zones.forEach((z, i) => [['上', z.up], ['下', z.lo]].forEach(([ax, p]) => {
   if (!p.hold || !p.gom.out.length) return;
   const b = holdBandOf(R, p.hold.kind);
   if (!(b.gapMax > 0)) return;
   const g = p.holdRem;
   if (g < b.gapMin - 1e-6 || g > b.gapMax + 1e-6) out.push(`${i + 1}${ax}（空き ${g.toFixed(2)}mm）`);
  }));
  return out;
 }

 /* 区間ごとの中身を、OS側から順に決める。
    （在庫を配る順。組む順は基準面から——§9.466。ここは配る順を変えていない。）
    使った部材はその場で残数から引くため、在庫を超えて使うことはない。 */
 function planZones(st, M, IX, A) {
  const plan = stockPlan(st, M, IX);
  const left = { sp: new Map(), ring: new Map(), fin: new Map() };
  plan.spacer.forEach((x, sz) => left.sp.set(String(sz), x.free));
  plan.ring.forEach((x, k) => left.ring.set(k, x.free));
  plan.finger.forEach((x, sz) => left.fin.set(String(sz), x.free));
  /* 表は必要な長さぶんだけ作る。刻みが細かいので、長さを切り詰めるほど速い。 */
  const span = Math.min(IX.span, Math.max(200,
   Math.ceil(A.zones.reduce((m, z) => Math.max(m, z.up, z.lo), 0) / 200) * 200 + 200));
  const last = A.zones.length - 1;
  /* 製品幅の公差に収めることが最優先。まず在庫を見ずに、幅の広いものから最小枚数で
     ちょうど埋める組み方を出す。そのうえで、精度と枚数を落とさずに在庫の範囲へ
     収められるならそちらを使う（対象台車の部材を流用でき、段取りが早くなる）。
     どうしても収まらないときは精度を優先し、足りない分は所要で示す。 */
  const RULE = ringRule(M);
  const SLACK = floatStroke(M);
  const take = (len, isEnd, hold, slack) => {
   const best = zoneParts(len, isEnd, hold, fillTables(IX, plan, left, span, null, true), RULE, slack);
   let parts = best;
   const blocked = new Set();
   for (let attempt = 0; attempt < 16; attempt++) {
    const cand = zoneParts(len, isEnd, hold, fillTables(IX, plan, left, span, blocked), RULE, slack);
    const overS = cand.spacer.out.find(([sz, c]) => c > (left.sp.get(String(sz)) || 0));
    const holdKey = cand.hold
     ? (cand.hold.kind === 'finger' ? 'F' : 'R') : '';
    const overH = cand.hold
     ? cand.gom.out.find(([sz, c]) => c > (holdKey === 'F'
        ? (left.fin.get(String(sz)) || 0) : (left.ring.get(`${cand.hold.od}|${sz}`) || 0)))
     : null;
    if (!overS && !overH) {
     /* 精度が落ちないなら在庫の範囲の組み方を採る。幅公差は絶対に外せないので、
        枚数が増えても精度のほうを優先する。 */
     /* フローティングシートの側の端（`slack`あり）は残りが押さえ代に収まれば同じ精度とみなす（§9.457）。 */
     if (cand.rem <= Math.max(best.rem, slack || 0) + 1e-9) parts = cand;
     break;
    }
    if (overS) blocked.add('S' + overS[0]);
    if (overH) blocked.add(holdKey === 'F' ? 'F' + overH[0] : `R${cand.hold.od}|${overH[0]}`);
   }
   parts.spacer.out.forEach(([sz, c]) => left.sp.set(String(sz), (left.sp.get(String(sz)) || 0) - c));
   if (parts.hold) {
    parts.gom.out.forEach(([sz, c]) => {
     if (parts.hold.kind === 'finger') left.fin.set(String(sz), (left.fin.get(String(sz)) || 0) - c);
     else {
      const k = `${parts.hold.od}|${sz}`;
      left.ring.set(k, (left.ring.get(k) || 0) - c);
     }
    });
   }
   return parts;
  };
  const finger = isFinger(st, M);
  const zones = A.zones.map((z, i) => {
   const isEnd = (i === 0 || i === last);
   const burr = z.type === 'end' ? z.burr : z.seg.burr;
   /* **潤滑リングは広い側の刃の内側**（§9.454、利用者の指示「製品幅＋
      クリアランス×2の広い側の刃の内側の両側」）。広い側＝その条で区間が
      長いほうの軸（内々の対）。屑条・端部には入れない。 */
   const wide = upper => z.type === 'strip' && (upper ? z.up > z.lo : z.lo > z.up);
   const mk = upper => {
    if (finger) return IX.fingerWidths.length ? { kind: 'finger' } : null;
    if (!IX.widthsByOd.size) return null;
    const t = ringType(burr, upper);
    return { kind: 'ring', ringT: t, od: odOfType(st, M, t), lube: wide(upper) };
   };
   /* 押さえ代の幅を持たせるのは**フローティングシートの側の端だけ**（`A.floatZ`・§9.461）。
      基準面の側は押し付ける側なので0が正。 */
   const sl = i === A.floatZ ? SLACK : 0;
   return { up: take(z.up, isEnd, mk(true), sl), lo: take(z.lo, isEnd, mk(false), sl) };
  });
  return { zones, plan, left };
 }

 /* ================== 6 集約 ================== */
 const countMap = d => { const o = {}; d.out.forEach(([s, c]) => { o[s] = c; }); return o; };
 const sigOf = o => sizeKeys(o).map(k => `${k}:${o[k]}`).join(',');
 /* 1区間ぶんの構成。`sig`が一致する区間は「同じ組み方」として1行にまとめられる。 */
 function compose(parts) {
  const sp = countMap(parts.spacer), G = countMap(parts.gom);
  const od = parts.hold && parts.hold.kind === 'ring' ? parts.hold.od : 0;
  const kind = parts.hold ? parts.hold.kind : '';
  const lube = parts.lube ? parts.lube.n : 0;
  return { len: parts.len, sp, G, od, kind, lube,
           ringT: parts.hold ? parts.hold.ringT || '' : '', rem: parts.rem,
           holdRem: +(parts.holdRem || 0).toFixed(3),
           /* **板押さえが1本も載らない区間**（§9.441）。端部は設計どおり
              持たないので、ここで言うのは「載るはずなのに空」のときだけ。 */
           bare: !!(kind && !sizeKeys(G).length),
           sig: `${parts.len.toFixed(2)}|${kind}|${od}|${lube}|${sigOf(sp)}|${sigOf(G)}` };
 }

 /* ---- 構成記号（バッジ） ----
    上軸の下バリ区間と下軸の上バリ区間のように構成が同一になる区間は、1つの
    「組み合わせ単位」としてまとめ、A・B・C… の記号を与える。同じ記号を刃組図の
    該当区間にも表示し、図と表を一対一で対応させる。 */
 const badgeLabel = i => (i < 26
  ? String.fromCharCode(65 + i)
  : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + i % 26));
 /* **記号の色は文字ごとに1色**（§9.455、利用者の指示「A,B,C…のラベルを
    アルファベットごとに色分けしてわかりやすく。普通に色分けしてほしい」）。
    色の番号（`tone`）は**記号を振るときに一緒に振る**（`buildRows()`の1箇所）——
    字面から推し量ると `OS` のような端部の札まで色が付く。表・模式図・断面図・
    拡大図は同じ番号を`data-bc`で名乗り、色そのものはCSSのトークン
    （`--bs-badge-0`〜）が持つ。色の数を超えたら同じ順でもう一度使う。
    端部（OS／DS）は `tone` を持たない（中立の色）。 */
 const BADGE_TONES = 8;

 /* 構成が同じ区間を1行にまとめる入れ物。本体の区間も端部も同じ手順でまとまる。 */
 function rowBucket() {
  const byKey = new Map(), order = [];
  return {
   add(key, seed, use, zones) {
    let row = byKey.get(key);
    if (!row) { row = Object.assign({}, seed, { uses: [], zones: [], n: 0 }); byKey.set(key, row); order.push(key); }
    row.uses.push(use);
    row.n += use.n;
    zones.forEach(z => row.zones.push(z));
   },
   rows: () => order.map(k => byKey.get(k))
  };
 }
 /* 本体の行。まず同じ条（種別・ロット・幅・バリ）をまとめ、さらに上下軸それぞれの
    構成が一致するものを1行に合流させる。千鳥では「上軸の下バリ区間」と
    「下軸の上バリ区間」が同一構成になるため、ロットあたり2通りに集約される。 */
 function buildRows(segs, zp) {
  const bucket = rowBucket();
  segs.forEach((sg, j) => {
   const i = j + 1;
   [true, false].forEach(upper => {
    const c = compose(zp.zones[i][upper ? 'up' : 'lo']);
    bucket.add(`${sg.lot}|${sg.w}|${c.sig}`, { sg, c }, { upper, burr: sg.burr, n: 1 }, [{ i, upper }]);
   });
  });
  const rows = bucket.rows();
  rows.forEach((r, i) => { r.badge = badgeLabel(i); r.tone = i % BADGE_TONES; });
  return rows;
 }
 /* 端部の行（本体と同じ作り方。上軸・下軸で同一なら1行に集約）。 */
 function endRows(A, zp) {
  const last = A.zones.length - 1;
  const bucket = rowBucket();
  const spots = [['OS', 'OS端', A.zones[0], A.w.osTrim, 0],
                 ['DS', 'DS端', A.zones[last], A.w.dsTrim, last]];
  spots.forEach(([side, name, z, trim, zi]) => {
   [true, false].forEach(upper => {
    const c = compose(zp.zones[zi][upper ? 'up' : 'lo']);
    bucket.add(`${name}|${c.sig}`,
               { end: true, endSide: side, name, trim, c, badge: side },
               { upper, burr: z.burr, n: 1 }, [{ i: zi, upper }]);
   });
  });
  const rows = bucket.rows();
  /* 上軸・下軸で構成が異なる場合は記号を分け、取り違えを防ぐ。 */
  ['OS', 'DS'].forEach(side => {
   const g = rows.filter(r => r.endSide === side);
   if (g.length > 1) g.forEach(r => { r.badge = side + (r.uses[0].upper ? '上' : '下'); });
  });
  return rows;
 }
 /* 区間→記号の対応表（図で使う） */
 function badgeMap(rows) {
  const m = { up: {}, lo: {} };
  rows.forEach(r => (r.zones || []).forEach(z => { m[z.upper ? 'up' : 'lo'][z.i] = r; }));
  return m;
 }

 /* 現在の構成から必要点数を集計する。
    ゴムリングは色（外径）×幅で1本が決まるので、その形のまま数える。 */
 function aggregate(st, M, A, zp) {
  const out = { spacerU: {}, spacerL: {}, ring: {}, finger: {}, blade: {},
                finger_mode: isFinger(st, M), rem: [],
                /* 潤滑リング（§9.454）。在庫のマスタは持たないので、本数と寸法だけ。 */
                lube: { u: 0, l: 0, w: 0, od: 0, bore: 0 } };
  const addInto = (o, d) => { d.out.forEach(([s, c]) => { o[s] = (o[s] || 0) + c; }); return o; };
  const mergeInto = (dst, src) => { Object.keys(src).forEach(k => { dst[k] = (dst[k] || 0) + src[k]; }); return dst; };
  zp.zones.forEach(z => {
   [['U', 'u', z.up], ['L', 'l', z.lo]].forEach(([ax, side, parts]) => {
    addInto(out['spacer' + ax], parts.spacer);
    if (parts.lube) {
     out.lube[side] += parts.lube.n;
     Object.assign(out.lube, { w: parts.lube.w, od: parts.lube.od, bore: parts.lube.bore });
    }
    if (!parts.hold) return;
    if (parts.hold.kind === 'finger') {
     parts.gom.out.forEach(([sz, c]) => {
      const w = out.finger[sz] || (out.finger[sz] = { u: 0, l: 0 });
      w[side] += c;
     });
     return;
    }
    const slot = out.ring[parts.hold.od] || (out.ring[parts.hold.od] = {});
    parts.gom.out.forEach(([sz, c]) => {
     const w = slot[sz] || (slot[sz] = { u: 0, l: 0 });
     w[side] += c;
    });
   });
   out.rem.push({ up: z.up.rem, lo: z.lo.rem });
  });
  /* 同じ径でも刃厚が違えば別物。差分もその単位で取れるよう、径と刃厚の2つで1品目。 */
  out.blade[`${st.knife.toFixed(1)}|${st.tk}`] = A.U.length * 2;
  out.spacer = mergeInto(mergeInto({}, out.spacerU), out.spacerL);
  out.plan = zp.plan;
  out.left = zp.left;
  return out;
 }

 /* 刃組は基準面の反対側から部材を入れ、基準面の側へ詰めていく（§9.461。OS基準なら
    DS側から入れてOS側へ詰める。既定のDS基準ならOS側＝軸端部を外す側から入れる）。
    手持ち寸法で区間を埋めきれない分（端数）は、その区間の実寸がそのぶん短いと
    いうことで、それより DS 側の刃はすべて端数のぶんだけ OS 側へずれる。
    上軸と下軸では区間長が違うので端数の出方も違い、その差が「同じ切断位置での
    上下の左右差」の誤差になる。フローティングシートの側の端の残りは開放端の余りなので、
    刃の位置はずらさない。 */
 function assemblyError(A, g) {
  const n = A.U.length;
  let cu = 0, cl = 0, worst = 0, worstAt = 0;
  const per = new Array(n).fill(0);
  /* **積むのは基準面の側から**（§9.461）。端数はそれより基準面から遠い刃をずらすので、
     足し込む向きも基準面から。DS基準なら刃 k に効くのは区間 k+1〜最後。 */
  const fromDS = A.datum === 'DS';
  for (let j = 0; j < n; j++) {
   const k = fromDS ? n - 1 - j : j;
   const z = g.rem[fromDS ? k + 1 : k] || { up: 0, lo: 0 };
   cu = +(cu + z.up).toFixed(3);
   cl = +(cl + z.lo).toFixed(3);
   const e = +(cu - cl).toFixed(3);
   per[k] = e;
   if (Math.abs(e) > Math.abs(worst)) { worst = e; worstAt = k; }
  }
  /* フローティングシートの側の端の残り（開放端の余り。刃の位置はずらさない）。 */
  const tail = g.rem[fromDS ? 0 : g.rem.length - 1] || { up: 0, lo: 0 };
  return { per, worst, worstAt, cumU: cu, cumL: cl, tail };
 }

 /* ---- 図が使う並び（模式図と立体図で同じ答えを見るため、ここが持つ） ----
    手持ち寸法の並び（大きい寸法から）を1枚ずつに展開する。 */
 const expand = d => d.out.flatMap(([sz, c]) => Array(c).fill(sz));
 /* 材料の並び：OS耳 → 条／屑条 → DS耳。左端からの位置をここで一度だけ決める。 */
 function materialRun(A, segs) {
  const items = [];
  if (A.w.osTrim > 0) items.push({ w: A.w.osTrim, type: 'trim', label: '耳' });
  segs.forEach(s => items.push(s));
  if (A.w.dsTrim > 0) items.push({ w: A.w.dsTrim, type: 'trim', label: '耳' });
  /* **起点は刃と同じ`origin`から逆に辿る**（§9.454）。耳が負（元板巾が
     条の合計に足りない）のときは耳を積まないので、`matStart`から始めると
     板だけが負の耳のぶん横へずれた（実測 matOff 523.95）。組めない材料は
     `solve()`が`stop`で断るが、ここも1つの起点から出しておく。 */
  let at = A.origin - (A.w.osTrim > 0 ? A.w.osTrim : 0);
  return items.map(sg => { const from = at; at += sg.w; return { sg, from, to: at }; });
 }
 /* 板は丸刃で切られ、切られた条は板厚のぶんだけ上下へ分かれる。条は
    「区間の狭いほうの側」へ寄る。どちらが狭いかは切断点での刃の左右で決まる。 */
 const matShift = (A, run, i) => {
  const n = A.sign.length - 1;
  const lead = run[0].sg.type === 'trim' ? 1 : 0;
  const j = i - lead;
  return j >= n ? A.sign[n] : -A.sign[j + 1];
 };

 /* 条の端（製品の幅を決める面）を答える（§9.434）。**判定はここ1箇所**——
    「その条の側を向いていない刃の面」が端を作るので、切断ごとに上下どちらの
    刃かが入れ替わる。`i`＝切断の番号、`right`＝その切断の**右側**の条の端か。
    図の材料と刃が同じ割付から出ているかを見る網（`view().matOff`）も、
    条幅の検算もここを通す。 */
 const cutFace = (A, tk, i, right) => {
  const s = A.sign[i];
  return right ? ((s < 0 ? A.Lo[i] : A.U[i]) - tk / 2)
               : ((s < 0 ? A.U[i] : A.Lo[i]) + tk / 2);
 };

 /* 適正帯を外れたら要注意、不適帯まで外れたら不適。 */
 const judge = (v, b) => ((v < b.hardMin || v > b.hardMax) ? 'bad'
  : ((v < b.min || v > b.max) ? 'warn' : 'good'));
 function bandOf(M, kind) {
  const p = M.P;
  return kind === 'push'
   ? { min: p.pushMin, max: p.pushMax, hardMin: p.pushHardMin, hardMax: p.pushHardMax }
   : { min: p.nipMin, max: p.nipMax, hardMin: p.nipHardMin, hardMax: p.nipHardMax };
 }
 const offsetBand = M => ({ min: -M.P.offsetTol, max: M.P.offsetTol,
                            hardMin: -M.P.offsetHardTol, hardMax: M.P.offsetHardTol });

 /* 在庫・研磨・使用限界の要確認をまとめて挙げる。 */
 function warnings(st, M) {
  const a = [], P = M.P;
  const days = d => (d ? Math.floor((Date.now() - new Date(d)) / 86400000) : null);
  M.blades.forEach(k => {
   if (k.currentDia !== null && P.minDia && k.currentDia <= P.minDia) {
    a.push({ kind: 'blade', text: `${k.name}：Φ${k.currentDia} 使用限界` });
   }
   if (selectable(k, M)) {
    const d = days(k.lastGrind);
    if (d !== null && P.grindCycleDays && d >= P.grindCycleDays) {
     a.push({ kind: 'grind', text: `${k.name}：研磨から${d}日` });
    }
   }
   if (k.minQty && k.qty < k.minQty) a.push({ kind: 'stock', text: `刃 ${k.name}：在庫${k.qty}枚` });
  });
  M.rings.forEach(r => {
   if (r.minQty && r.qty < r.minQty) {
    a.push({ kind: 'stock', text: `ゴムリング${r.color}${r.od} 幅${r.width}：在庫${r.qty}本` });
   }
  });
  M.spacers.forEach(s => {
   if (s.minQty && s.qty < s.minQty) a.push({ kind: 'stock', text: `スペーサー${s.size}：在庫${s.qty}枚` });
  });
  M.fingers.forEach(f => {
   if (f.minQty && f.qty < f.minQty) a.push({ kind: 'stock', text: `フィンガー${f.name}：在庫${f.qty}本` });
  });
  (M.lubes || []).forEach(r => {
   if (r.minQty && r.qty < r.minQty) {
    a.push({ kind: 'stock', text: `潤滑リング${r.color}${r.od} 幅${r.width}：在庫${r.qty}本` });
   }
  });
  return a;
 }

 /* ================== 7 入口 ==================
    画面はここを1回呼ぶだけ。**同じ割付（zp）から図・表・所要を全部作る**ので、
    どこを見ても食い違わない。 */
 function solve(st, M, IX) {
  recommend(st, M, IX);
  const c = contact(st, M);
  const segs = buildSegs(st);
  const A = buildLayout(st, M, segs);
  const zp = planZones(st, M, IX, A);
  const g = aggregate(st, M, A, zp);
  const err = assemblyError(A, g);
  const rows = buildRows(segs, zp);
  const ends = endRows(A, zp);
  /* **割付から出る断り**（§9.441）。マスタだけを見る`warnings()`とは別に、
     「組んでみて初めて分かること」をここで数える。答えるのはこの1箇所で、
     刃組表・所要・図はここが出した数を読むだけにする（§CLAUDE 8）。
       ・スペーサー層の端数 … **0が正**。0でないのは計算の不具合。
       ・板押さえが空の区間 … 手持ちの幅では1本も載らない（在庫が尽きた等）。 */
  const bad = [], bare = [];
  /* フローティングシートの側の端（§9.461。基準面の反対。既定はDS基準なのでOS端）。 */
  const fz = A.floatZ;
  zp.zones.forEach((z, i) => {
   [['上', z.up], ['下', z.lo]].forEach(([ax, p]) => {
    /* **フローティングシートの側の端の残りは端数ではない**（§9.456、利用者の指示
       「フローティングシートで押さえるので、エンドまでの隙間は発生しない」）。
       数えるのは`floatSeat`（フローティングシートが押さえる量）の側。 */
    if (i !== fz && (p.rem || 0) > 1e-6) bad.push(`${i + 1}${ax}（${p.rem.toFixed(3)}mm）`);
    if (p.hold && !p.gom.out.length) bare.push(`${i + 1}${ax}`);
   });
  });
  const fit = { spacerGap: bad, bareHold: bare, holdGap: holdGapFaces(zp, M),
                /* ゴムリング方式なのに潤滑リングの行が無い（§9.455）——入れられない。 */
                lubeMissing: !isFinger(st, M) && !!(M.rings || []).length && !(M.lubes || []).length,
                /* フローティングシートが押さえる量（上軸・下軸）。0でも正。`side`＝シートの端。 */
                floatSeat: { up: +(zp.zones[fz].up.rem || 0).toFixed(3),
                             lo: +(zp.zones[fz].lo.rem || 0).toFixed(3),
                             side: A.datum === 'OS' ? 'DS' : 'OS', datum: A.datum,
                             stroke: floatStroke(M),
                             /* 押さえ代を超える残り（§9.457）。フローティングシートでは
                                吸えない＝本当の隙間なので、軸ごとに名指しする。 */
                             over: floatStroke(M) > 0
                              ? [['上', zp.zones[fz].up], ['下', zp.zones[fz].lo]]
                                .filter(([, p]) => (p.rem || 0) > floatStroke(M) + 1e-6)
                                .map(([ax, p]) => `${fz + 1}${ax}（${p.rem.toFixed(3)}mm）`)
                              : [] },
                holdName: holdName(st, M) };
  return { segs, A, zp, g, err, rows, ends, badges: badgeMap(rows.concat(ends)),
           fit, stop: stopReasons(st, A, M), contact: c, method: method(st), finger: isFinger(st, M),
           bigOd: odFromTh(M, st.bigTh), smOd: odFromTh(M, st.smallTh) };
 }

 /* **組めない材料**（§9.454、利用者の報告「断面図で板だけが横へずれる」）。
    答えはここ1箇所で、画面は`res.stop`が空でなければ**図も表も描かず**に
    これを出す（§CLAUDE 4 できないことはできないと書く／§9.433 組めなかったら
    器を空にする）。以前は手順3の畳んだ窓の中だけが断っており、図と表は
    負の耳のまま「組めた顔」で描かれていた。
    `step`は直す場所（手順の窓の`id`）。字は「何が」「どれだけ」「どうすれば」。 */
 function stopReasons(st, A, M) {
  const out = [], w = A.w, W = +st.W || 0, sw = sd => sideWord(M, sd);
  /* 板が有効長の外へはみ出す（中心をずらしたとき・§9.456）。元板巾そのものが
     有効長を超えるときは下の`arbor`が言うので、ここは「収まる幅なのに位置が悪い」だけ。 */
  if (W > 0 && W <= A.arborLen) {
   const a = A.matStart, b = A.matStart + W;
   const over = a < -1e-6 ? -a : (b > A.arborLen + 1e-6 ? b - A.arborLen : 0);
   if (over > 0) {
    out.push({ key: 'center', step: 'bsV3',
               text: `板の中心が ${sw(A.datum)} から ${(+A.center).toFixed(2)} mm だと、板が有効長の`
                   + `${sw(a < 0 ? 'OS' : 'DS')}側へ ${over.toFixed(2)} mm はみ出します`,
               fix: `板の中心を ${(W / 2).toFixed(2)}〜${(A.arborLen - W / 2).toFixed(2)} mm のあいだにしてください` });
   }
  }
  if (!w.ok) {
   out.push({ key: 'short', step: 'bsV3',
              text: `条の合計 ${w.total.toFixed(2)} mm が元板巾 ${W} mm を超えています`
                  + `（不足 ${(w.total - W).toFixed(2)} mm）`,
              fix: '元板巾か、条幅・本数を直してください' });
  }
  if (W > A.arborLen) {
   out.push({ key: 'arbor', step: 'bsV3',
              text: `元板巾 ${W} mm がアーバー有効長 ${A.arborLen} mm を超えています`
                  + `（${(W - A.arborLen).toFixed(2)} mm 超過）`,
              fix: 'この板はこのラインに載りません。元板巾を確かめてください' });
  }
  return out;
 }

 /* 刃組を終えた記録（台車差分の材料）。**部材の顔ぶれごとに形が変わる**ので、
    サーバーへは`detail`としてそのまま預ける。 */
 /* ---- 条の設計（§9.378） ----
    `st.order`（OS側から順に、どのロットの条か）を**続きの塊**へ畳む。
    測定の条割（`lot-split.js` の `splitGroups`）と同じ形（ロットと本数の並び）
    なので、記録したものをそのまま測定が読める。 */
 function stripDesign(st) {
  const runs = [];
  (st.order || []).forEach(ix => {
   const L = (st.lots || [])[ix];
   if (!L) return;
   const last = runs[runs.length - 1];
   if (last && last.lot === String(L.name || '')) { last.count += 1; return; }
   runs.push({ parent: String(L.parent || L.name || ''), lot: String(L.name || ''),
               count: 1, width: +L.w || 0 });
  });
  return runs;
 }
 /* **記録は親ロット1件ごと**——測定が開くのは親ロット1件なので、そこで引ける
    形にしておく（分割の無いロットは自分自身が親）。 */
 function designByParent(st) {
  const m = new Map();
  stripDesign(st).forEach(r => {
   const k = r.parent || r.lot;
   const g = m.get(k) || { parent: k, groups: [], strips: 0 };
   g.groups.push({ lot: r.lot, count: r.count, width: r.width });
   g.strips += r.count;
   m.set(k, g);
  });
  return [...m.values()];
 }

 /* ---- 組んだ条件（§9.378） ----
    利用者の言葉:「同一条数、同一幅、同一厚の場合基本的に同じ刃組で作業できます。
    作業スケジュール上、これらの条件がどこか違うロットになったときに刃組段取りが
    入るというのが通常の流れです。」
    つまり**次の段取りが要るかどうかは条数・条幅・板厚で決まる**。部材の員数とは
    別に、台車が「どの条件で組まれているか」を言えるように控える。 */
 function condOf(st, M) {
  const widths = (st.order || [])
   .map(ix => ((st.lots || [])[ix] || {}).w)
   .filter(w => +w > 0).map(w => +(+w).toFixed(2));
  return { strips: widths.length, widths,
           /* 元板巾（§9.425）。**これが無いと記録から材料を組み直せない**
              ——条幅の並びだけでは耳屑の幅が出ず、軸の上の割付が決まらない。
              古い記録には入っていないので、読む側は「無ければ使わない」。 */
           W: +st.W || 0,
           thickness: +st.thick || 0, knife: +st.knife || 0, tk: +st.tk || 0,
           overlap: +st.ov || 0,
           /* 記録するのは**組んだ値**（§9.454）。打った値が違えば並べて残す。 */
           clearance: clearanceUsed(M, st.tk, st.clr).used, clearanceWant: +st.clr || 0,
           /* 板の中心（基準面から・§9.456／§9.461）と、どちらを基準に測ったか。
              端部の区間の長さが変わるので控える。 */
           center: centerOf(st, M).value, datum: datumOf(M),
           method: method(st), hold: holdName(st, M),
           bigOd: odFromTh(M, st.bigTh), smOd: odFromTh(M, st.smallTh) };
 }
 /* 「同じ刃組で流せるか」の答えは**ここ1箇所**。条数・条幅の並び・板厚がそろえば
    同じ——刃径やラップが違っても、軸の上の割付が同じなら組み替えは要らない。 */
 function sameCond(a, b) {
  if (!a || !b) return false;
  if ((a.strips | 0) !== (b.strips | 0)) return false;
  if (Math.abs((+a.thickness || 0) - (+b.thickness || 0)) > 1e-6) return false;
  return (a.widths || []).join(',') === (b.widths || []).join(',');
 }

 /* その刃を選ぶ対象に入れてよいか。**「メンテナンス中」だけが外れる**
    （一般も専用も、選ばれる場面が違うだけで「生きている刃」・§9.379）。
    綴りはサーバーが持つので、無いときだけ既定の字を使う。 */
 function selectable(k, M) {
  return !!k && k.status !== ((M && M.bladeMaint) || 'メンテナンス中');
 }

 /* ---------- 「専用」の刃を選ぶ条件（§9.379、利用者の指示2） ----------
    ふつうは状態が「一般」の刃が選ばれる。そこから外れる作業だけを
    `刃選択マスタ` に書き、**上から見て最初に当たった1行**が効く。
    **判定はここ1箇所**——サーバー（`bladeset_repo.pick_group`）と同じ規則を
    同じ綴りで持ち、画面は答えを受け取るだけにする。 */
 const PICK_NUM = {
  eq: (l, a) => Math.abs(l - a) < 1e-9,
  ne: (l, a) => Math.abs(l - a) >= 1e-9,
  ge: (l, a) => l >= a - 1e-9,
  gt: (l, a) => l > a + 1e-9,
  le: (l, a) => l <= a + 1e-9,
  lt: (l, a) => l < a - 1e-9
 };
 /* 条件が読む値。計算値に加えて、**1本目のコイルの仕掛の行**（`st.src`）の列を
    `source.<列名>`で読める（§9.524）。材質・ロット番号もその行から引く——以前は
    `st.material`／`st.lotNo`を誰も入れておらず、刃選択の「材質」「ロット番号」の
    条件は**1度も当たらなかった**。 */
 function pickCtx(st, M) {
  const ws = (st.order || []).map(ix => +(((st.lots || [])[ix] || {}).w))
   .filter(w => w > 0);
  const src = st.src || null;
  const pk = k => (src && typeof pick === 'function' ? pick(src, k) : '');
  const ctx = {
   thickness: +st.thick || null,
   coilWidth: +st.W || null,
   strips: ws.length || null,
   minWidth: ws.length ? Math.min(...ws) : null,
   maxWidth: ws.length ? Math.max(...ws) : null,
   material: pk('mfgMaterial') || pk('orderMaterial'),
   lotNo: st.headLot || pk('lotNo')
  };
  if (src) Object.keys(src).forEach(k => { ctx['source.' + k] = src[k]; });
  return ctx;
 }
 /* 仕掛の列（`source.*`）は型が決まっていない。**比べ方で読み方を決める**:
    大小・範囲は数として、＝／≠は両方が数に読めれば数として（'1.0' と '1' を同じに）、
    含むは字として。 */
 const asNum = v => (String(v ?? '').trim() === '' ? NaN : Number(v));
 function condHits(cond, ctx, kinds) {
  const f = cond && cond.field;
  if (!f || !(f in ctx)) return false;
  const left = ctx[f];
  /* **引けなかった値を当てない**（§9.231）。0として比べると、空欄の条件が
     全部の作業に当たってしまう。 */
  if (left === null || left === undefined || left === '') return false;
  const op = cond.op;
  const kind = kinds[f] || (String(f).startsWith('source.')
   ? (op === 'contains' ? 'text'
      : (/^(ge|gt|le|lt|between)$/.test(op) || (isFinite(asNum(left)) && isFinite(asNum(cond.value)))) ? 'num' : 'text')
   : 'text');
  if (kind === 'num') {
   const l = +left, a = +cond.value;
   if (!isFinite(l) || !isFinite(a)) return false;
   if (op === 'between') {
    const b = +cond.value2;
    if (!isFinite(b)) return false;
    return Math.min(a, b) - 1e-9 <= l && l <= Math.max(a, b) + 1e-9;
   }
   return PICK_NUM[op] ? PICK_NUM[op](l, a) : false;
  }
  const ls = String(left).trim(), rs = String(cond.value == null ? '' : cond.value).trim();
  if (op === 'eq') return ls === rs;
  if (op === 'ne') return ls !== rs;
  if (op === 'contains') return !!rs && ls.indexOf(rs) >= 0;
  return false;
 }
 /* 当たった決まり、または `null`（＝「一般」を使う）。**条件が1つも無い行は
    当たらない**——「いつでも当たる行」を書けると、「一般が既定」という
    約束が静かに崩れる。 */
 function pickGroup(rules, ctx, fields) {
  const r = firstRule((rules || []).filter(x => x.group), ctx, fields, false);
  return r ? { group: r.row.group, rule: r.row.name || '', id: r.row.id } : null;
 }
 /* 条件表を上から見て**最初に当たった行**（`{row, index}`）。表の約束は1つ——
    同じ行の条件はすべて満たしたときだけ当たる。**条件の無い行**は`withDefault`の
    ときだけ「どれにも当たらなかったときの行」として当たる（刃選択は当てない・
    保持方式は最後の既定行で決める）。刃選択・保持方式・盤の試し欄が同じ1本を通る。 */
 function firstRule(rules, ctx, fields, withDefault) {
  const kinds = {};
  (fields || []).forEach(f => { kinds[f.field] = f.kind; });
  const list = rules || [];
  for (let i = 0; i < list.length; i++) {
   if (list[i].enabled === false) continue;   // 番号は表の並びのまま数える（止めた行も1行）
   const cs = list[i].conditions || [];
   if (!cs.length ? withDefault : cs.every(c => condHits(c, ctx, kinds))) return { row: list[i], index: i };
  }
  return null;
 }
 /* 保持方式の答え（§9.524）。`{hold, index, stored, row}`——どの行で決まったかも返す
    （画面が「n行目に当たったため」と根拠を書く・§CLAUDE 6）。表を持たない材料
    （古いサーバー・網の手組み）は今までの決め方（板厚 < 切替板厚）で答える。 */
 function holdPick(st, M) {
  const rules = (M && M.holds) || [];
  if (!rules.length) {
   const fm = num(M && M.P && M.P.fingerMax) || 0;
   return { hold: st.thick < fm ? 'フィンガー' : 'ゴムリング', index: -1, stored: false, row: null };
  }
  const hit = firstRule(rules, pickCtx(st, M), M.holdFields, true);
  return { hold: hit ? hit.row.hold : 'ゴムリング', index: hit ? hit.index : -1,
           stored: !!M.holdsStored, row: hit ? hit.row : null };
 }
 /* その方式に決まった根拠を1文で（§9.524・§CLAUDE 6 出どころを書く）。どの行で決まったか・
    その行の条件・表が登録か種か。画面は字を組み立てない。 */
 function holdReason(st, M) {
  const h = holdPick(st, M);
  if (h.index < 0 && !((M && M.holds) || []).length) {
   const fm = num(M && M.P && M.P.fingerMax) || 0;
   return `板厚 ${(+st.thick).toFixed(1)} が切替板厚 ${fm} ${st.thick < fm ? '未満' : '以上'}のため`;
  }
  const cs = (h.row && h.row.conditions) || [];
  const why = cs.length
   ? `「保持方式」の${h.index + 1}行目（${cs.map(c => condText(c, M.holdFields, M.pickOps)).join(' かつ ')}）に当たったため`
   : '「保持方式」のどの決まりにも当たらないため（最後の既定の行）';
  return why + (h.stored ? '' : '。表は未登録なので、刃組基準値のフィンガー切替板厚から作った表で決めました');
 }
 /* 条件1つを字にする（「板厚 ＜ 0.6」「製造材質 ＝ SUS」）。刃組の説明と条件表の盤が同じ字を使う。 */
 function condText(c, fields, ops) {
  const f = (fields || []).find(x => x.field === c.field);
  const name = f ? f.label : String(c.field || '').replace(/^source\./, '');
  const op = ((ops || []).find(x => x.op === c.op) || {}).label || c.op;
  return c.op === 'between' ? `${name} ${c.value}〜${c.value2}` : `${name} ${op} ${c.value}`;
 }

 /* ====================== 標準の条件（§9.408、利用者の指示②） ======================
    「刃組の標準の計算値で使用スペーサなど一覧内に関連情報が出るようにしてほしい」

    **画面を開かずに「この予定を標準どおり組んだらどうなるか」を出せる**ように、
    今まで画面（`blade-view.js`）だけが持っていた3つ——既定値・基準値の当て方・
    刃の選び方——をここへ移した。刃組スケジュール一覧の見込みと、刃組
    ガイダンスの画面が**同じ1箇所**を通るようにするため（2箇所で計算すると、
    一覧の「使用スペーサー」と画面の刃組表が静かに食い違う）。 */

 /* 画面で選んでいない状態の出発点。**ここが既定の唯一の置き場**。 */
 function defaultState() {
  return {
   equipment: '',
   /* 1本目のコイルの番号と仕掛の行（§9.524）。予定から開いたときだけ入る。 */
   headLot: '', src: null,
   align: 'none', canNk: true, nkWidth: 30,
   knife: 318.2, thick: 1.3, tk: 10, clr: 0.15, ov: 0.2,
   /* クリアランスは**板厚の10%が基本**（§9.378）。板厚を変えたら引き直す。
      手で打った時点で `clrAuto` を落とし、以降は触らない——利用者が入れた値を
      「保存されていない既定」にしない（§9.367 と同じ考え方）。 */
   clrAuto: true,
   W: 1170, trimMode: 'even', osTrim: 20,
   lots: [{ name: 'LOT1', w: 279.8, n: 4 }],
   order: [0, 0, 0, 0],
   bigMode: 'auto', smallMode: 'auto', bigTh: 39.5, smallTh: 38.0,
   /* 図の向き（`flip`＝DSを左）。**開いたときは刃組基準値の既定の側**（§9.463・既定は基準原点を右）で、画面が入れ直す。 */
   /* 台車は**マスタが決める**（§9.424）。既定は空で、画面が台車マスタの
      先頭を選ぶ——ここに `'A'` と書くと、A台車の無いラインでも「A」が
      選ばれたまま記録できてしまう。 */
   carriage: '', bladeGroup: '', flip: true,
   /* 板の中心（OSから・§9.456）。`null`＝打っていない（基準値→有効長の中央）。 */
   center: null
  };
 }
 /* クリアランスの答えは**ここ1箇所**（§9.378、利用者の指示「目安として板厚の
    10％としておいてもらい、将来的には材質の条件も増える可能性がありますが
    マスタ化するなどでクリアランスマスタから常に取れるようにするつもりです」）。
    いまは率（`刃組基準値マスタ`の`クリアランス率`）×板厚。材質ごとの値が
    要るようになったら、**この関数の中だけ**をマスタ引きへ差し替える。
    桁は板厚と同じ 0.01 まで（測る側が読める桁に合わせる）。 */
 function clearanceRate(M) {
  const r = M && M.P ? +M.P.clearanceRate : NaN;
  return Number.isFinite(r) && r > 0 ? r : 0.1;
 }
 function clearanceFor(M, t) {
  const v = (+t || 0) * clearanceRate(M);
  return v > 0 ? +v.toFixed(2) : 0;
 }
 /* 手持ちのスペーサーが作れる長さの刻み（§9.454）。**寸法の最大公約数**——
    `10.025` が1種でもあれば 0.025、無ければ 0.05 になる。刻みは部材が決める
    もので、コードの定数（`FILL_STEP`）は表を引く単位にすぎない。
    0.005mm を1として整数で数える（浮動小数の割り算で公約数を取らない）。 */
 function spacerStep(M) {
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  const U = 0.005;
  const g = ((M && M.spacers) || []).reduce((a, s) => gcd(a, Math.round(s.size / U)), 0);
  return g > 0 ? +(g * U).toFixed(3) : FILL_STEP;
 }
 /* **実際に組めるクリアランス**（§9.454、利用者の指示「四捨五入でもっとも
    近い確保可能なクリアランスに近づけます」）。答えはここ1箇所。

    上下の軸はどちらもOS側の端から部材を積むので、下軸のOS端の区間は上軸の
    それと**刃厚＋クリアランス**だけ違う。スペーサーは`step`刻みでしか長さを
    作れないので、`刃厚＋クリアランス`が刻みの倍数でないと、どちらかの軸に
    **必ず端数が残る**（0.04 → 下軸OS端 0.015・内々 104.98 → 0.005）。
    だから`刃厚＋クリアランス`を刻みへ四捨五入し、そこから刃厚を引いた値を
    使う。0 以下になるときは刻み1つぶん（刃どうしが面で当たる組み方は無い）。 */
 /* **基準面（基準原点）**の答え。スペーサーは基準面の側から押し付けて積み、反対の端を
    フローティングシートが押さえる。**駆動側（DS）に固定**（§9.470、利用者の指示「基準面を
    OSに切り替えるという機能は不要になり、ラベルをどうするかの機能があれば解決します。
    また、右と左を入れ替えて表示する機能もあるので事足ります」）——§9.461 で入れた
    マスタの切り替え（`datumSide`）は外した。見せ方の左右は向きの札（§9.472・並びを描く
    2択）と、OS・DS の呼び方（`sideWord()`・刃組基準値）が受け持つ。計算は基準面を引数のように読むまま残す
    （組む順・中心の測り方・シートの端の説明が同じ1つの答えを見る）。 */
 const DATUM = 'DS';
 function datumOf() { return DATUM; }
 /* **OS・DS の呼び方**の答え（§9.472、利用者の指示「切り替えボタンのラベルだけでなく、
    図の中のラベルや、右表のラベルもすべて連動させて」）。計算と記録は`'OS'`／`'DS'`の
    まま持ち、**画面へ出す字だけ**をここで引く（刃組基準値の「OS の呼び方」「DS の呼び方」・
    空欄なら OS／DS）。字を書く場所は全部これを呼ぶ——1箇所でも素の`'OS'`を書くと、
    その字だけ呼び方に付いてこない。 */
 function sideWord(M, sd) {
  const P = (M && M.P) || {};
  const v = String((sd === 'OS' ? P.sideNameOS : sd === 'DS' ? P.sideNameDS : '') || '').trim();
  return v || sd;
 }
 /* **板の中心（基準面からの距離）**の答え（§9.456／§9.461）。①その作業で打った値 →
    ②設備の`刃組基準値`の「板の中心」→ ③有効長の中央、の3段。どの段から来たかも
    返す（画面は出どころを言う・§CLAUDE 6）。`value`は基準面から、`os`は同じ位置を
    OS端から測り直した値（計算の座標はOS端が0）。 */
 function centerOf(st, M) {
  const P = (M && M.P) || {};
  const arbor = num(P.arborLen) || 1600;
  const datum = datumOf(M);
  const at = (value, from) => ({ value, from, datum,
                                 os: datum === 'OS' ? value : +(arbor - value).toFixed(3) });
  if (num(st && st.center) > 0) return at(+st.center, 'job');
  if (num(P.centerFromDatum) > 0) return at(+P.centerFromDatum, 'master');
  return at(+(arbor / 2).toFixed(3), 'mid');
 }
 /* フローティングシートの押さえ代（§9.457）。設備ごとの`刃組基準値`（既定は図面の
    F.P.ストローク 0.95mm・加圧装置1か所）。読めなければ0＝幅を持たせない。 */
 function floatStroke(M) {
  const v = num(M && M.P && M.P.floatSeatStroke);
  return v > 0 ? v : 0;
 }
 function clearanceUsed(M, tk, want) {
  const step = spacerStep(M), t = +tk || 0, w = +want || 0;
  const n = Math.round(+((t + w) / step).toFixed(6));
  let used = +(n * step - t).toFixed(4);
  if (!(used > 0)) used = step;
  return { want: w, used, step, rounded: Math.abs(used - w) > 1e-6 };
 }
 /* 使う刃を決める（§9.379、利用者の指示2）。
      ふつう … 状態が「一般」の刃
      例外 …… `刃選択マスタ` の条件に当たったら、その組の「専用」の刃
    「メンテナンス中」は**どちらでも選ばない**。
    決めたら `st.pick` に「なぜその組か」を残す——画面が理由を出せないと、
    利用者には「勝手に別の刃になった」としか見えない（§CLAUDE 6 出どころを出す）。 */
 function applyBladePick(st, M) {
  const gen = M.bladeGeneral || '一般', sp = M.bladeSpecial || '専用';
  const hit = pickGroup(M.picks, pickCtx(st, M), M.pickFields);
  st.pick = hit ? { group: hit.group, rule: hit.rule } : null;
  const ok = b => b.currentDia && (hit
   ? (b.status === sp && b.group === hit.group)
   : b.status === gen);
  let use = (M.blades || []).filter(ok);
  /* 条件に当たったのに、その組の刃が1枚も無い——**黙って一般へ落とさない**。
     理由を持ったまま一般で描き、画面が「当たったが刃が無い」と言えるようにする。 */
  if (hit && !use.length) {
   st.pick = { group: hit.group, rule: hit.rule, missing: true };
   use = (M.blades || []).filter(b => b.currentDia && b.status === gen);
  }
  use = use.sort((a, b) => (b.thickness || 0) - (a.thickness || 0));
  if (use.length) { st.knife = use[0].currentDia; if (use[0].thickness) st.tk = use[0].thickness; }
  return st;
 }
 /* 基準値から**既定値**を入れる。**利用者が触った値は上書きしない**のは
    呼ぶ側の責任（画面は設備を開き直したときだけ呼ぶ・§9.361）。 */
 function applyStandards(st, M) {
  const P = (M && M.P) || {};
  if (P.bladeThickness != null) st.tk = +P.bladeThickness;
  if (P.clearance != null) st.clr = +P.clearance;
  if (P.overlap != null) st.ov = +P.overlap;
  if (P.scrapWidth != null) st.nkWidth = +P.scrapWidth;
  st.canNk = P.canNakanuki !== false;
  applyBladePick(st, M);
  return st;
 }
 /* 予定1件（`seed`）を標準どおり組んだ状態。**条が1本も読めないときは`null`**
    ——既定の見本（LOT1×4）で計算すると、予定と何の関係も無い数字が
    「使用スペーサー」として並ぶ（0で埋めないのと同じ理由・§9.231）。
    刃の選び方は**材料を当てたあとに**決める（条数・板厚・幅が条件になるので、
    既定のまま選ぶと当たる行が変わる）。 */
 function standardState(seed, M) {
  const s = seed || {};
  const lots = (Array.isArray(s.lots) ? s.lots : []).map(L => ({
   name: String((L && L.name) || 'LOT'), w: +(L && L.w) || 0,
   n: Math.max(1, (L && L.n) | 0), parent: String((L && (L.parent || L.name)) || '')
  })).filter(L => L.w > 0);
  if (!lots.length) return null;
  const st = defaultState();
  if (+s.thickness > 0) st.thick = +s.thickness;
  if (+s.originalWidth > 0) st.W = +s.originalWidth;
  /* 中心は記録した基準面から測った値。いまの基準面と違えば測り直す（§9.461）。 */
  if (+s.center > 0) {
   const arbor = num(M && M.P && M.P.arborLen) || 1600;
   st.center = (s.datum && s.datum !== datumOf(M)) ? +(arbor - s.center).toFixed(3) : +s.center;
  }
  st.lots = lots;
  st.order = [];
  /* 1本目のコイルと、その仕掛の行（§9.524）。条件表が材質などの列を読む。 */
  st.headLot = String(s.headLot || '');
  st.src = (s.source && typeof s.source === 'object') ? s.source : null;
  syncOrder(st);
  applyStandards(st, M);
  /* 板厚から引くクリアランス（`clrAuto`）は基準値の固定値より後。順を
     入れ替えると、基準値に値がある設備で板厚10%が消える。 */
  const c = clearanceFor(M, st.thick);
  if (c) st.clr = c;
  return st;
 }

 /* 記録に残っている条件から、**その材料を組み直すための種**を作る（§9.425）。
    台車差分の基準は「その台車の記録」が第一だが、記録が無い台車では
    **前回流した材料**（履歴の直近1件）を既定の刃組設定で組んだ構成を置く
    ——いまの材料で計算すると、これから流す物と比べることになり、差分が
    ほとんど出ない（「もう組んである」と読める）。

    **条幅の並び順は要らない。** 区間の長さの顔ぶれ（どの幅が何本か）が同じなら
    部材の員数も同じなので、同じ幅をまとめて `lots` にしてよい。
    **元板巾が無い記録は使わない**（§9.231 0で埋めない）——耳屑の幅が出ず、
    軸の上の割付が決まらないので、読めなかったことにして次の段へ落とす。 */
 function seedFromCond(cond) {
  const c = cond || {};
  const ws = (Array.isArray(c.widths) ? c.widths : []).map(w => +w).filter(w => w > 0);
  const W = +c.W || 0;
  if (!ws.length || !(W > 0)) return null;
  const byW = new Map();
  ws.forEach(w => byW.set(w, (byW.get(w) || 0) + 1));
  const lots = [...byW.entries()].map(([w, n], i) => ({ name: '前回' + (i + 1), w, n }));
  return { thickness: +c.thickness || 0, originalWidth: W, lots,
           /* 中心（§9.456）。古い記録には無い——無ければ既定（基準値→中央）で組む。 */
           center: +c.center > 0 ? +c.center : null,
           /* どちらの基準面から測った中心か（§9.461）。古い記録はOS基準だった。 */
           datum: c.datum === 'DS' || c.datum === 'OS' ? c.datum : (+c.center > 0 ? 'OS' : null) };
 }

 function snapshot(st, M, g) {
  const ring = {};
  Object.keys(g.ring).forEach(od => Object.keys(g.ring[od]).forEach(sz => {
   ring[`${od}|${sz}`] = g.ring[od][sz].u + g.ring[od][sz].l;
  }));
  const finger = {};
  Object.keys(g.finger).forEach(sz => { finger[sz] = g.finger[sz].u + g.finger[sz].l; });
  const lube = {};
  const nl = g.lube ? g.lube.u + g.lube.l : 0;
  if (nl) lube[g.lube.w] = nl;
  return { spacer: Object.assign({}, g.spacer), ring, finger, lube,
           blade: Object.assign({}, g.blade), cond: condOf(st, M) };
 }

 /* 字を置く席を配る（§9.429）。**望んだ位置（指し示す物の真上）へなるべく
    寄せつつ、最小の間隔を守る。** 並び順は変えないので、引き出し線どうしが
    交差しない——交差すると、どの札がどの部材のものか読めなくなる。
    `half[i]` はその字の半分の幅（0を渡せば「席の間隔だけ」で配る）、
    `a`〜`b` は置いてよい範囲、`gap` は字と字のあいだに必ず空ける量。
    左から押して → 右で受けて → もう一度左から整える、の3手（右で受けた
    結果、左がはみ出すことがある）。**入りきらないときは`b`を越えて返す**
    ——呼ぶ側が「入らなかった」と分かるように、黙って重ねない。
    模式図の拡大図（`blade-view.js`）と断面図（`blade-3d.js`）の両方が使う。 */
 function spread(want, half, a, b, gap) {
  const n = want.length;
  if (!n) return [];
  const hw = i => (half && half[i] ? +half[i] || 0 : 0);
  const g = +gap || 0;
  const out = want.slice();
  const push = () => {
   out[0] = Math.max(out[0], a + hw(0));
   for (let i = 1; i < n; i++) out[i] = Math.max(out[i], out[i - 1] + hw(i - 1) + hw(i) + g);
  };
  push();
  out[n - 1] = Math.min(out[n - 1], b - hw(n - 1));
  for (let i = n - 2; i >= 0; i--) {
   out[i] = Math.min(out[i], out[i + 1] - hw(i + 1) - hw(i) - g);
  }
  push();
  return out;
 }

 /* **引き出した字の段を決める**（§9.492、利用者の指示「干渉するラベルがないはずです。干渉する場合は段を付けて…
    余裕があるケースはできるだけ対象物側に寄せて表示」）。`items`は x の順に並んだ `{cx, half}`（字の中心と半幅）、
    `n`は段の数（0＝部材にいちばん近い段）、`gap`は字と字のあいだ。戻り値は字ごとの段。
    **近い段から順に、左隣の字と`gap`を空けて並べられる最初の段**へ置く。どの段にも入らないときだけ、いちばん
    空いている段へ置く（あとで`spread()`が押し広げる）。以前は x の順に**1つおき**に振り分けており（§9.429）、
    余裕があっても半分が外の段へ出た。段の中は x の順のままなので、引き出し線は交差しない（§9.413）。 */
 function tierOf(items, n, gap) {
  const m = Math.max(1, n | 0), g = +gap || 0, right = new Array(m).fill(-Infinity);
  return (items || []).map(q => {
   const cx = +q.cx || 0, h = +q.half || 0;
   let t = right.findIndex(r => r + g <= cx - h);
   if (t < 0) t = right.indexOf(Math.min(...right));
   right[t] = Math.max(cx + h, right[t] + g + 2 * h);
   return t;
  });
 }

 WL.bladeSet = {
  defaultState, clearanceRate, clearanceFor, clearanceUsed, centerOf, datumOf, sideWord, floatStroke, fillWithin, spacerStep, ringRule, holdBand, applyStandards, applyBladePick, standardState,
  normalize, buildIndex, ringMeta, thOf, odFromTh, odOfType, ringType, oppBurr,
  method, isFinger, holdName, contact, recommend, syncOrder, reorder,
  buildSegs, widths, buildLayout, buildFiller, fillWith, planZones,
  compose, buildRows, endRows, badgeMap, BADGE_TONES, aggregate, assemblyError,
  judge, bandOf, offsetBand, warnings, solve, snapshot, sizeKeys, sum, cutFace,
  stripDesign, designByParent, condOf, sameCond, seedFromCond,
  pickCtx, pickGroup, condHits, selectable, firstRule, holdPick, holdReason, condText,
  expand, materialRun, matShift, spread, tierOf,
  METHOD_NAME, METHOD_DESC, ALIGN_NAME, FILL_STEP
 };
})();
