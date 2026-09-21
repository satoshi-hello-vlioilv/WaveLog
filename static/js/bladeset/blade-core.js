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
     DS 側から挿入し OS 側へ詰める。手持ち寸法で埋めきれない端数は
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
  const rings = (c.rings || [])
   .map(x => ({ color: x.color || '', hex: x.hex || '', od: num(x.od),
                bore: num(x.bore) || num(P.ringBore), width: num(x.width),
                qty: Math.max(0, num(x.qty) || 0), minQty: num(x.minQty) || 0 }))
   .filter(x => x.od > 0 && x.width > 0);
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
  return { P, spacers, rings, fingers, blades,
           history: (c.history || []).slice(),
           designs: (c.designs || []).slice(),
           picks: (c.picks || []).slice(),
           /* 台車（§9.424）。**無いときは空の並び**——画面が A/B を作らない。
              呼び名（初期セットの顔ぶれ・台車なしの綴り）はサーバーが持つ。 */
           carriages: (c.carriages || []).slice(),
           carriageSeed: (c.carriageSeed || []).slice(),
           carriageNone: c.carriageNone || '台車なし',
           pickFields: (c.pickFields || []).slice(),
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
 /* 板が薄いとゴムリングでは保持できない。そのときは板押さえ（フィンガー）方式。 */
 const isFinger = (st, M) => st.thick < (num(M.P.fingerMax) || 0);
 const holdName = (st, M) => (isFinger(st, M) ? 'フィンガー' : 'ゴムリング');
 const oppBurr = b => (b === 'down' ? 'up' : 'down');
 const oppRing = t => (t === 'big' ? 'small' : 'big');
 /* 同一条の両側は同じリング。上軸と下軸では大小が入れ替わる。 */
 const ringType = (burr, upper) => {
  const t = burr === 'down' ? 'big' : 'small';
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
    **切断の位置（材料が切れる面）は変わらない。** 面は中心から刃厚の半分だけ
    内側なので、上下の面は公称の切断位置をはさんでクリアランスの半分ずつ——
    条幅の出方は以前と同じ。変わるのは**刃がどこに載るか**＝スペーサーの寸法。
    どちら側へずれるかはバリ方向で決まり、千鳥では切断位置ごとに交互になる:
      中間の区間 … 両端の切断でずれの向きが逆になるので （刃厚＋クリアランス）×2
      端部の区間 … 切断が片側だけなので 刃厚＋クリアランス
    以前は**クリアランスだけ**ずらしており、上下の刃の身が 9.87mm 重なっていた
    （実測・刃厚10／クリアランス0.13）——物として組めない配置だった。 */
 function buildLayout(st, M, segs) {
  const tk = st.tk, n = segs.length;
  const arborLen = num(M.P.arborLen) || 1600, clr = st.clr;
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
  const nominal = +((arborLen - st.W) / 2).toFixed(3);
  const edge0 = nominal + w.osTrim - tk / 2 + sign[0] * dKnife / 2;   /* OS端（上軸）の区間長 */
  const slip = +(edge0 - Math.round(edge0 / grid) * grid).toFixed(4);
  const matStart = +(nominal - slip).toFixed(4);
  const origin = matStart + w.osTrim;
  const U = cuts.map((c, i) => +(origin + c + sign[i] * dKnife / 2).toFixed(3));
  const Lo = cuts.map((c, i) => +(origin + c - sign[i] * dKnife / 2).toFixed(3));
  const zones = [
   { key: 'OS端', type: 'end', burr: oppBurr(segs[0].burr),
     up: +(U[0] - tk / 2).toFixed(3), lo: +(Lo[0] - tk / 2).toFixed(3) },
   ...segs.map((sg, j) => ({ key: sg.label, type: sg.type, seg: sg,
     up: +(U[j + 1] - U[j] - tk).toFixed(3), lo: +(Lo[j + 1] - Lo[j] - tk).toFixed(3) })),
   { key: 'DS端', type: 'end', burr: oppBurr(segs[n - 1].burr),
     up: +(arborLen - (U[n] + tk / 2)).toFixed(3),
     lo: +(arborLen - (Lo[n] + tk / 2)).toFixed(3) }
  ];
  return { U, Lo, zones, arborLen, grid,
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

 /* 部材ごとの「いま使える数」。
    ラインは2台の台車を交互に使う。直前の刃組はラインで稼働中なので、そこに
    載っている部材は外せない＝使えない。いま組み替える台車（2回前の構成）に
    載っている部材は、そのまま使えるうえに棚から運ぶ手間もないので優先する。 */
 function stockPlan(st, M, IX) {
  const h = M.history || [], busy = h[0] || {};
  let onCar = null;
  for (let i = 1; i < h.length; i++) if (h[i].carriage === st.carriage) { onCar = h[i]; break; }
  const at = (rec, kind, key) => ((rec && rec.detail && rec.detail[kind] && rec.detail[kind][key]) || 0);
  const spacer = new Map(), ring = new Map(), finger = new Map();
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
  const sig = [st.carriage, busy.at || '-', onCar ? onCar.at : '-',
               M.spacers.length, M.rings.length, M.fingers.length].join('|');
  return { spacer, ring, finger, busy: h[0] || null, onCar, sig };
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
 function zoneParts(len, isEnd, hold, tbl) {
  const total = Math.max(0, +(+len).toFixed(3));
  /* 軸の寸法はスペーサーが作る。区間の全長をスペーサーで組み、刃の位置はこれで
     決まる。保持層はその上に被せる別の層で、軸方向の寸法には効かない。 */
  const spacer = fillWith(tbl.spacer, total);
  /* 保持層は製品幅の上にだけ載るので、最外刃より外（OS端・DS端）はスペーサーのみ。 */
  let ht = null;
  if (hold && !isEnd) ht = hold.kind === 'finger' ? tbl.finger : tbl.ring.get(hold.od);
  const gom = ht ? fillWith(ht, total) : { out: [], rem: 0 };
  return { len: total, hold: ht ? hold : null, gom, spacer, rem: spacer.rem };
 }

 /* 区間ごとの中身を、OS側から順に決める。
    刃組は DS 側から入れて OS 側へ詰めるので、OS 側の区間から順に部材が要る。
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
  const take = (len, isEnd, hold) => {
   const best = zoneParts(len, isEnd, hold, fillTables(IX, plan, left, span, null, true));
   let parts = best;
   const blocked = new Set();
   for (let attempt = 0; attempt < 16; attempt++) {
    const cand = zoneParts(len, isEnd, hold, fillTables(IX, plan, left, span, blocked));
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
     if (cand.rem <= best.rem + 1e-9) parts = cand;
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
   const mk = upper => {
    if (finger) return IX.fingerWidths.length ? { kind: 'finger' } : null;
    if (!IX.widthsByOd.size) return null;
    const t = ringType(burr, upper);
    return { kind: 'ring', ringT: t, od: odOfType(st, M, t) };
   };
   return { up: take(z.up, isEnd, mk(true)), lo: take(z.lo, isEnd, mk(false)) };
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
  return { len: parts.len, sp, G, od, kind,
           ringT: parts.hold ? parts.hold.ringT || '' : '', rem: parts.rem,
           sig: `${parts.len.toFixed(2)}|${kind}|${od}|${sigOf(sp)}|${sigOf(G)}` };
 }

 /* ---- 構成記号（バッジ） ----
    上軸の下バリ区間と下軸の上バリ区間のように構成が同一になる区間は、1つの
    「組み合わせ単位」としてまとめ、A・B・C… の記号を与える。同じ記号を刃組図の
    該当区間にも表示し、図と表を一対一で対応させる。 */
 const badgeLabel = i => (i < 26
  ? String.fromCharCode(65 + i)
  : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + i % 26));

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
  rows.forEach((r, i) => { r.badge = badgeLabel(i); });
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
                finger_mode: isFinger(st, M), rem: [] };
  const addInto = (o, d) => { d.out.forEach(([s, c]) => { o[s] = (o[s] || 0) + c; }); return o; };
  const mergeInto = (dst, src) => { Object.keys(src).forEach(k => { dst[k] = (dst[k] || 0) + src[k]; }); return dst; };
  zp.zones.forEach(z => {
   [['U', 'u', z.up], ['L', 'l', z.lo]].forEach(([ax, side, parts]) => {
    addInto(out['spacer' + ax], parts.spacer);
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

 /* 刃組は DS 側から部材を入れ、OS 側へ詰めていく。
    手持ち寸法で区間を埋めきれない分（端数）は、その区間の実寸がそのぶん短いと
    いうことで、それより DS 側の刃はすべて端数のぶんだけ OS 側へずれる。
    上軸と下軸では区間長が違うので端数の出方も違い、その差が「同じ切断位置での
    上下の左右差」の誤差になる。最後（DS端）の区間の残りは開放端の余りなので、
    刃の位置はずらさない。 */
 function assemblyError(A, g) {
  const n = A.U.length;
  let cu = 0, cl = 0, worst = 0, worstAt = 0;
  const per = [];
  for (let k = 0; k < n; k++) {
   cu = +(cu + g.rem[k].up).toFixed(3);
   cl = +(cl + g.rem[k].lo).toFixed(3);
   const e = +(cu - cl).toFixed(3);
   per.push(e);
   if (Math.abs(e) > Math.abs(worst)) { worst = e; worstAt = k; }
  }
  const tail = g.rem[g.rem.length - 1] || { up: 0, lo: 0 };
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
  let at = A.matStart;
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
  return { segs, A, zp, g, err, rows, ends, badges: badgeMap(rows.concat(ends)),
           contact: c, method: method(st), finger: isFinger(st, M),
           bigOd: odFromTh(M, st.bigTh), smOd: odFromTh(M, st.smallTh) };
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
           thickness: +st.thick || 0, knife: +st.knife || 0, tk: +st.tk || 0,
           overlap: +st.ov || 0, clearance: +st.clr || 0,
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
 function pickCtx(st, M) {
  const ws = (st.order || []).map(ix => +(((st.lots || [])[ix] || {}).w))
   .filter(w => w > 0);
  return {
   thickness: +st.thick || null,
   coilWidth: +st.W || null,
   strips: ws.length || null,
   minWidth: ws.length ? Math.min(...ws) : null,
   maxWidth: ws.length ? Math.max(...ws) : null,
   material: st.material || '',
   lotNo: st.lotNo || ''
  };
 }
 function condHits(cond, ctx, kinds) {
  const f = cond && cond.field;
  if (!f || !(f in ctx)) return false;
  const left = ctx[f];
  /* **引けなかった値を当てない**（§9.231）。0として比べると、空欄の条件が
     全部の作業に当たってしまう。 */
  if (left === null || left === undefined || left === '') return false;
  const op = cond.op;
  if ((kinds[f] || 'text') === 'num') {
   const l = +left, a = +cond.value;
   if (!isFinite(l) || !isFinite(a)) return false;
   if (op === 'between') {
    const b = +cond.value2;
    if (!isFinite(b)) return false;
    return Math.min(a, b) - 1e-9 <= l && l <= Math.max(a, b) + 1e-9;
   }
   return PICK_NUM[op] ? PICK_NUM[op](l, a) : false;
  }
  const ls = String(left), rs = String(cond.value == null ? '' : cond.value);
  if (op === 'eq') return ls === rs;
  if (op === 'ne') return ls !== rs;
  if (op === 'contains') return !!rs && ls.indexOf(rs) >= 0;
  return false;
 }
 /* 当たった決まり、または `null`（＝「一般」を使う）。**条件が1つも無い行は
    当たらない**——「いつでも当たる行」を書けると、「一般が既定」という
    約束が静かに崩れる。 */
 function pickGroup(rules, ctx, fields) {
  const kinds = {};
  (fields || []).forEach(f => { kinds[f.field] = f.kind; });
  const list = (rules || []).filter(r => r.enabled !== false);
  for (const r of list) {
   const cs = r.conditions || [];
   if (!cs.length || !r.group) continue;
   if (cs.every(c => condHits(c, ctx, kinds))) {
    return { group: r.group, rule: r.name || '', id: r.id };
   }
  }
  return null;
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
   /* 刃組の道具なので、はじめから段取り向き（DS左＝部材を入れる側から見た並び）。 */
   /* 台車は**マスタが決める**（§9.424）。既定は空で、画面が台車マスタの
      先頭を選ぶ——ここに `'A'` と書くと、A台車の無いラインでも「A」が
      選ばれたまま記録できてしまう。 */
   carriage: '', bladeGroup: '', flip: true
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
  st.lots = lots;
  st.order = [];
  syncOrder(st);
  applyStandards(st, M);
  /* 板厚から引くクリアランス（`clrAuto`）は基準値の固定値より後。順を
     入れ替えると、基準値に値がある設備で板厚10%が消える。 */
  const c = clearanceFor(M, st.thick);
  if (c) st.clr = c;
  return st;
 }

 function snapshot(st, M, g) {
  const ring = {};
  Object.keys(g.ring).forEach(od => Object.keys(g.ring[od]).forEach(sz => {
   ring[`${od}|${sz}`] = g.ring[od][sz].u + g.ring[od][sz].l;
  }));
  const finger = {};
  Object.keys(g.finger).forEach(sz => { finger[sz] = g.finger[sz].u + g.finger[sz].l; });
  return { spacer: Object.assign({}, g.spacer), ring, finger,
           blade: Object.assign({}, g.blade), cond: condOf(st, M) };
 }

 WL.bladeSet = {
  defaultState, clearanceRate, clearanceFor, applyStandards, applyBladePick, standardState,
  normalize, buildIndex, ringMeta, thOf, odFromTh, odOfType, ringType, oppBurr,
  method, isFinger, holdName, contact, recommend, syncOrder, reorder,
  buildSegs, widths, buildLayout, buildFiller, fillWith, planZones,
  compose, buildRows, endRows, badgeMap, aggregate, assemblyError,
  judge, bandOf, offsetBand, warnings, solve, snapshot, sizeKeys, sum,
  stripDesign, designByParent, condOf, sameCond,
  pickCtx, pickGroup, condHits, selectable,
  expand, materialRun, matShift,
  METHOD_NAME, METHOD_DESC, ALIGN_NAME, FILL_STEP
 };
})();
