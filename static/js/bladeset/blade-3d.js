/* blade-3d.js: 刃組の立体図（§9.377 追補）。

   模式図（`blade-view.js` の SVG）と**同じ割付（`zp`）から**、実機の寸法その
   ままで組み立てる。単位は mm。図面 SL-1458-01S より: カッター軸有効長 1600 ／
   軸径 Φ200 ／ 軸受 Φ260。上下軸の中心間距離は「刃径 − ラップ」。刃の上下の
   ずれは**実寸のクリアランス**で、誇張はしない（模式図は見やすさのために広げて
   描くが、こちらは寸法に忠実）。

   ----------------------------------------------------------------------
   three.js は**同梱しない**（利用者の指示「インターネット接続はしているので、
   ライブラリの移植は不要」）。CDN から**版を留めて**読み、しかも
   **立体図を最初に押したときだけ**読む:

     ・起動は 600KB ぶん速いまま（模式図しか使わない人は一度も取りに行かない）
     ・回線が無い端末では**読めなかったと字で言い、模式図はそのまま使える**
       （押せるのに何も起きない、にしない・§CLAUDE 4）
     ・版は `THREE_SRC` の1箇所に留める。素の `THREE` を使う UMD 版は r149 が
       最後なので、ここを上げるときは API の作り直しが要る

   **`window.THREE` はこのファイルだけが触る。** 画面（`blade-view.js`）は
   `WL.bladeSolid` の口だけを呼ぶ（§CLAUDE「`window.*`への新規公開は名前空間経由」）。
   ----------------------------------------------------------------------
*/
(function(){
 'use strict';
 const WL = (window.WL = window.WL || {});
 const BS = () => WL.bladeSet;

 /* **版を留める**（`latest` を指さない）——次に読む人の端末で黙って中身が
    変わると、動かなくなった理由が分からなくなる。 */
 const THREE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r149/three.min.js';

 /* 立体図のはじめの状態は「刃組をはじめる状態」。
    ①引き出し ②軸端部を外し ③台車を半回転させた、そこから刃を組む姿にする。 */
 const D3 = { on:false, built:false, dirty:true, open:true, out:true, rot:Math.PI, carX:0,
   spin:false, busy:false, failed:false, decals:[],
   /* 立体図で見せる部材。刃だけを見たいときなど、邪魔なものを消せるようにする。 */
   show:{ mat:true, knife:true, ring:true, liner:true } };

 /* 機械まわりの寸法。図面 SL-1458-01S と外観図から取る。
    分かっている値はそのまま、外形の幅・高さ・奥行は外観図に合わせた概寸。 */
 const MACH = {
   lineC:830,        /* 有効長の OS 端からライン中心（基準面）まで */
   gapOS:30,         /* ギヤボックスの取付面から有効長の OS 端まで */
   gapDS:110,        /* 有効長の DS 端から軸受まで */
   standDS:175,      /* 軸受から DS 端スタンドまで */
   travel:330,       /* 軸端部（DS 端スタンド）の移動量 */
   arbor0:1600,      /* 図面の有効長。台座の長さはこれを基準に伸び縮みさせる */
   baseL:2325, baseToLine:1240, baseD:760, baseH:80,
   baseDrop:285,     /* 台座の上面から下軸中心まで */
   /* ギヤボックス本体。図面から外形は読み取れないので概寸。台座の左端まで
      広げると、台車を回したときに置いていく軸端部の軸受へ回り込んで当たる。 */
   gearW:300, gearD:460,
   standW:190, standD:430,              /* DS 端スタンドの柱 */
   brgW:130, brgD:300,                  /* 軸受ハウジング */
   tieY:475, tieR:26, tieHubR:72,       /* 送り軸（上軸中心からの高さ・太さ・受けの太さ） */
   wheelR:237.5,                        /* 調整ハンドル（Φ475 のリング） */
   /* 走行と回転（図面 SL-1458-03SA）。高さは台座上面からの落差で持つ */
   railZ:330,        /* レール中心の送り方向の位置（2本・中心間 660） */
   railDrop:216,     /* 台座上面からレール頭の上面まで */
   floorDrop:268,    /* 台座上面から床まで */
   wheelRun:70,      /* 走行車輪の半径 */
   ttX:3400,         /* 回転テーブルの中心（引き出した先） */
   ttPad:40,         /* テーブルの径は台座の半分＋この余裕 */
   sepGap:40,        /* テーブルの縁から着地土台まで */
   sepW:470          /* 着地土台の長さ */
 };
 const CAM = { az:-0.62, el:0.58, r:3400, tx:0, ty:0, tz:0 };
 const HOME = Object.assign({}, CAM);

 /* 画面から預かるもの。**このファイルは画面のDOMの形を知らない**——
    器と、いま何を描くかだけを受け取る。 */
 let host = null;         /* `.bs-stage3` の器 */
 let ctx = null;          /* {st, M, res, ringHex} */
 let onSpinDone = null;   /* 台車を回し終えたことを画面へ知らせる */

 const $h = sel => (host ? host.querySelector(sel) : null);

 /* ====================== 部品の読み込み ====================== */
 let loading = null;
 function loadLibrary() {
  if (window.THREE) return Promise.resolve(true);
  if (loading) return loading;
  loading = new Promise(resolve => {
   const s = document.createElement('script');
   s.src = THREE_SRC;
   s.async = true;
   s.onload = () => resolve(!!window.THREE);
   s.onerror = () => resolve(false);
   document.head.appendChild(s);
  });
  return loading;
 }
 /* 読めなかった・描けなかったときの断り。**模式図はそのまま使える**ことまで言う。 */
 function fail(html) {
  const el = $h('.bs-ng3');
  if (!el) return;
  el.innerHTML = html;
  el.hidden = false;
 }
 const clearFail = () => { const el = $h('.bs-ng3'); if (el) el.hidden = true; };

 /* ====================== 土台 ====================== */
 function init() {
  const T = window.THREE;
  if (!T) return false;
  if (D3.r) return true;
  if (D3.failed) return false;
  try { return create(T); } catch (e) {
   /* WebGL が使えない端末（描画支援が切られている等）。模式図はそのまま使える。 */
   D3.failed = true;
   WL.quiet.note('立体図を描けない（模式図はそのまま使える）', e);
   fail('この端末では立体図を描けませんでした（WebGL が使えません）。<br>模式図はそのまま使えます。');
   return false;
  }
 }
 function create(T) {
  const cv = $h('.bs-c3');
  if (!cv) return false;
  /* 色は画面の色空間で扱う。そうしないと部材の色が白っぽく浮いて、
     ゴムリングの色（＝外径）が見分けにくくなる。 */
  if (T.ColorManagement) T.ColorManagement.enabled = true;
  const r = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: false });
  r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  r.outputEncoding = T.sRGBEncoding;
  const sc = new T.Scene();
  sc.background = new T.Color(cssColor('--bs-3d-bg', '#dfe5ec'));
  const cam = new T.PerspectiveCamera(32, 1, 10, 30000);
  /* 光は3つ。上からの主光・手前からの補助・地明かり。金属が白飛びしない配分。 */
  sc.add(new T.HemisphereLight('#e8eef5', '#5e6772', 0.45));
  const k = new T.DirectionalLight('#ffffff', 1.05); k.position.set(-1200, 1800, 1500); sc.add(k);
  const f = new T.DirectionalLight('#cfdcec', 0.38); f.position.set(1500, -600, 1100); sc.add(f);
  /* 台車は自分の中心で回る。回す軸をここに置き、その子として中身を持つ。 */
  const pivot = new T.Group(); sc.add(pivot);    /* 回転テーブルの中心 */
  const g = new T.Group(); pivot.add(g);         /* 回る台車。走行ぶんは位置で持つ */
  const deck = new T.Group(); pivot.add(deck);   /* 回転テーブルの甲板。台車と一緒に回る */
  const fix = new T.Group(); sc.add(fix);        /* 外した軸端部。走行には付いていくが回らない */
  const world = new T.Group(); sc.add(world);    /* 床・レール・ピット・着地土台。動かない */
  D3.pivot = pivot; D3.fix = fix; D3.deck = deck; D3.world = world;
  const cyl = new T.CylinderGeometry(1, 1, 1, 64, 1, false); cyl.rotateZ(Math.PI / 2);
  const cylZ = new T.CylinderGeometry(1, 1, 1, 48, 1, false); cylZ.rotateX(Math.PI / 2);
  const box = new T.BoxGeometry(1, 1, 1);
  D3.plane = new T.PlaneGeometry(1, 1);                                /* 板に付ける札 */
  D3.disc = new T.CylinderGeometry(1, 1, 1, 72, 1, false);
  D3.ringGeo = new T.TorusGeometry(1, 0.022, 10, 72); D3.ringGeo.rotateX(Math.PI / 2);
  D3.annulus = new T.RingGeometry(0.87, 1, 96); D3.annulus.rotateX(-Math.PI / 2);
  Object.assign(D3, { T, r, sc, cam, g, cyl, cylZ, box, cv });
  bindPointer(cv);
  return true;
 }
 /* 図の色は**器が宣言したトークンから読む**（模式図と同じ作法・§CLAUDE 7）。 */
 function cssColor(name, fallback) {
  if (!host) return fallback;
  const v = getComputedStyle(host).getPropertyValue(name).trim();
  return v || fallback;
 }

 /* 見る向きの操作。回す・寄せる・平行移動の3つ。 */
 function bindPointer(cv) {
  let drag = null;
  cv.addEventListener('pointerdown', e => {
   cv.setPointerCapture(e.pointerId);
   D3.moved = true;
   drag = Object.assign({ x: e.clientX, y: e.clientY,
                          pan: e.shiftKey || e.button === 1 || e.button === 2 }, CAM);
  });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointermove', e => {
   if (!drag) return;
   const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
   if (drag.pan) {
    /* 平行移動は世界の軸ではなく、いま見ている向きに合わせる。そうしないと、
       見ている向きによっては横へ引いても横に動かない。画面の右向き・上向きを
       求め、その分だけ見ている先を動かす。見ている先は台車を回す前の座標で
       持っているので、最後に回転を戻す。 */
    const s = CAM.r / 1600, az = CAM.az, el = CAM.el;
    const rx = Math.cos(az), rz = -Math.sin(az);                       /* 画面の右 */
    const ux = -Math.sin(az) * Math.sin(el), uy = Math.cos(el), uz = -Math.cos(az) * Math.sin(el);
    const wx = -dx * s * rx + dy * s * ux, wy = dy * s * uy, wz = -dx * s * rz + dy * s * uz;
    const sr = Math.sin(D3.rot), cr = Math.cos(D3.rot);
    CAM.tx = drag.tx + wx * cr - wz * sr;
    CAM.ty = drag.ty + wy;
    CAM.tz = drag.tz + wx * sr + wz * cr;
   } else {
    CAM.az = drag.az - dx * 0.006;
    CAM.el = Math.max(-1.45, Math.min(1.45, drag.el + dy * 0.006));
   }
   render();
  });
  const stop = e => { drag = null; try { cv.releasePointerCapture(e.pointerId); } catch (err) {
   WL.quiet.note('つまみを離す先が既に無い（見る向きは動く）', err); } };
  cv.addEventListener('pointerup', stop);
  cv.addEventListener('pointercancel', stop);
  cv.addEventListener('wheel', e => {
   e.preventDefault();
   D3.moved = true;
   CAM.r = Math.max(260, Math.min(9000, CAM.r * (e.deltaY > 0 ? 1.12 : 0.89)));
   render();
  }, { passive: false });
 }

 const matOf = (() => {
  const cache = new Map();
  return (T, key, o) => {
   if (!cache.has(key)) {
    const m = new T.MeshStandardMaterial(o);
    m.name = key;                 /* 干渉検査でどの部材かを名で見分ける */
    cache.set(key, m);
   }
   return cache.get(key);
  };
 })();
 /* 内径の開いた管。丸刃・スペーサー・ゴムリングは図面どおり中心に穴が開いている。
    同じ寸法は使い回す（区間ごとに何十枚も並ぶため）。 */
 const TUBES = new Map();
 function tubeGeo(T, ro, ri) {
  const key = `${ro.toFixed(2)}/${ri.toFixed(2)}`;
  let g = TUBES.get(key);
  if (!g) {
   const sh = new T.Shape(); sh.absarc(0, 0, ro, 0, Math.PI * 2, false);
   const h = new T.Path(); h.absarc(0, 0, ri, 0, Math.PI * 2, true); sh.holes.push(h);
   /* 長さ 1 で作り、厚みは X 方向に伸ばして使う。こうすると同じ形をまとめ描きできる。 */
   g = new T.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false, curveSegments: 48 });
   g.translate(0, 0, -0.5); g.rotateY(Math.PI / 2);
   TUBES.set(key, g);
  }
  return g;
 }
 /* 同じ部材はまとめて1回で描く。40条ぶんの部材は数千個になるため。 */
 function batch(T, geo, mat, list) {
  if (!list.length) return null;
  const m = new T.InstancedMesh(geo, mat, list.length), o = new T.Object3D();
  list.forEach((p, i) => {
   o.position.set(p.x, p.y, p.z || 0);
   o.scale.set(p.l, p.r, p.d || p.r);
   o.rotation.set(0, 0, 0);
   o.updateMatrix(); m.setMatrixAt(i, o.matrix);
  });
  m.instanceMatrix.needsUpdate = true;
  return m;
 }
 /* 同じ寸法のものをまとめる。まとめ描きは寸法ごとに1回。 */
 function groupBy(list, key) {
  const m = new Map();
  list.forEach(p => { const k = key(p); (m.get(k) || m.set(k, []).get(k)).push(p); });
  return m;
 }

 /* 区間の中身を、OS 側から順に実寸で並べる。 */
 function zone(out, from, to, y, parts) {
  const expand = BS().expand;
  let at = from;
  for (const sz of expand(parts.spacer)) {
   if (at + sz > to + 1e-6) break;
   out.liner.push({ x: at + sz / 2, y, sz });
   at += sz;
  }
  if (!parts.hold) return;
  /* 保持層（ゴムリング／フィンガー）は刻みしかないので区間にぴったり合うとは
     かぎらない。余りは左右へ均等に振り分け、列を区間の中央に置く（模式図と同じ）。 */
  const pieces = expand(parts.gom);
  const run = pieces.reduce((a, sz) => a + sz, 0);
  at = from + Math.max(0, (to - from - run)) / 2;
  for (const sz of pieces) {
   if (at + sz > to + 1e-6) break;
   out.ring.push({ x: at + sz / 2, y, sz, hold: parts.hold });
   at += sz;
  }
 }

 /* 機械の骨組み。図面 SL-1458-01S・03SA に合わせる。
    ・台車は軸方向に走る2本のレールの上を車輪で走る（車輪の軸は送りの向き）
    ・引き出した先の回転テーブルの上で、台車の寸法の中心を軸に半回転する
    ・軸端部（DS 端スタンド）は 330 送り出すとテーブルの外の着地土台に降りるので、
      そこに残ったまま本体だけが回る */
 function frame(T, g, L, yU, yL) {
  const half = L / 2, sd = +ctx.M.P.shaftDia || 200, M = MACH;
  const steel = matOf(T, 'steel', { color: '#b9c1c9', metalness: .74, roughness: .22 });
  const steelD = matOf(T, 'steelD', { color: '#8f99a4', metalness: .70, roughness: .30 });
  const blue = matOf(T, 'blue', { color: '#2f63b0', metalness: .24, roughness: .48 });
  const blueD = matOf(T, 'blueD', { color: '#24518f', metalness: .24, roughness: .54 });
  const blueL = matOf(T, 'blueL', { color: '#3f77c4', metalness: .24, roughness: .44 });
  const dark = matOf(T, 'dark', { color: '#39424e', metalness: .56, roughness: .38 });
  const rod = matOf(T, 'rod', { color: '#aeb6bd', metalness: .72, roughness: .26 });
  /* 外した軸端部は台車と一緒には回らないので、別の入れ物へ入れる。 */
  const stay = D3.fix;
  const put = (o, geo, mat, list) => { const m = batch(T, geo, mat, list); if (m) o.add(m); };
  const bx = (list, mat, o) => put(o || g, D3.box, mat, list);
  const cy = (list, mat, o) => put(o || g, D3.cyl, mat, list);
  const cyZ = (list, mat, o) => put(o || g, D3.cylZ, mat, list);
  const tube = (x, y, len, ro, ri, mat, o) => {
   const m = new T.Mesh(tubeGeo(T, ro, ri), mat);
   m.position.set(x, y, 0); m.scale.set(len, 1, 1); (o || g).add(m); return m;
  };
  /* 円周にボルトを並べる。フランジが板に見えないようにする。 */
  const bolts = (x, r, n, hr, hl, o) => {
   const list = [];
   for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + Math.PI / n;
    list.push({ x, y: Math.sin(a) * r, z: Math.cos(a) * r, l: hl, r: hr });
   }
   put(o || g, D3.cyl, dark, list);
  };
  const osEnd = -half, dsEnd = half;

  /* ---- 台座。ライン中心はベース左端から 1240、ベース全長 2325 ---- */
  const lineX = osEnd + M.lineC;
  const baseL = M.baseL + (L - M.arbor0);
  const bx0 = lineX - M.baseToLine, bx1 = bx0 + baseL, bcx = (bx0 + bx1) / 2;
  const bedTop = yL - M.baseDrop, bedY = bedTop - M.baseH / 2;
  const railTop = bedTop - M.railDrop;
  bx([{ x: bcx, y: bedY, z: 0, l: baseL, r: M.baseH, d: M.baseD }], blue);
  bx([{ x: bcx, y: bedY - M.baseH / 2 - 58, z: 0, l: baseL - 70, r: 116, d: M.baseD - 150 }], blueD);
  bx([{ x: bcx, y: bedY + M.baseH / 2 + 6, z: 0, l: baseL - 40, r: 12, d: M.baseD - 40 }], blueL);
  const ribs = [];
  for (let i = 0; i < 4; i++) {
   ribs.push({ x: bx0 + 320 + i * (baseL - 640) / 3,
               y: bedY - M.baseH / 2 - 58, z: 0, l: 26, r: 108, d: M.baseD - 160 });
  }
  bx(ribs, blueD);
  /* ---- 走行車輪。レールは軸方向に走るので、車輪の軸は送りの向き（Z） ---- */
  const wy = railTop + M.wheelRun;
  const brk = [], whl = [], hub = [], flg = [];
  for (let i = 0; i < 4; i++) {
   const fx = bx0 + 260 + i * (baseL - 520) / 3;
   [-1, 1].forEach(s => {
    const fz = s * M.railZ;
    brk.push({ x: fx, y: (bedTop + wy) / 2, z: fz, l: 150, r: bedTop - wy, d: 120 });
    whl.push({ x: fx, y: wy, z: fz, l: 92, r: M.wheelRun });
    hub.push({ x: fx, y: wy, z: fz, l: 104, r: M.wheelRun * 0.42 });
    flg.push({ x: fx, y: wy, z: s * (M.railZ - 52), l: 16, r: M.wheelRun * 1.16 });
   });
  }
  bx(brk, dark); cyZ(whl, steelD); cyZ(hub, dark); cyZ(flg, steelD);

  /* ---- タイロッド（送り軸）の高さ。ギヤボックスと軸端部の頭はここで受ける ---- */
  const ty = yU + M.tieY, topY = ty - M.tieHubR;

  /* ---- ギヤボックス。取付面は有効長の OS 端から 30。台座の上に収まる ---- */
  const gFace = osEnd - M.gapOS, gx = gFace - M.gearW / 2;
  const pd0 = bx0 + 20, pd1 = gFace + 40;
  bx([{ x: (pd0 + pd1) / 2, y: bedTop + 36, z: 0, l: pd1 - pd0, r: 72, d: M.gearD + 120 }], blueD);
  bx([{ x: gx, y: (bedTop + 72 + yU + 118) / 2, z: 0, l: M.gearW,
        r: (yU + 118) - (bedTop + 72), d: M.gearD }], blue);
  bx([{ x: gx, y: (yU + 118 + topY) / 2, z: 0, l: M.gearW * 0.62,
        r: topY - (yU + 118), d: M.gearD * 0.64 }], blueL);
  bx([-1, 1].flatMap(s => [
   { x: gx, y: (bedTop + yU) / 2, z: s * (M.gearD / 2 + 9), l: M.gearW * 0.8, r: 30, d: 18 },
   { x: gx, y: yL, z: s * (M.gearD / 2 + 9), l: M.gearW * 0.8, r: 30, d: 18 }]), blueD);
  cy([{ x: gx, y: 0, z: M.gearD / 2 - 6, l: 26, r: 96 }], steelD);
  bolts(gx, 118, 8, 11, 30);
  [yU, yL].forEach(y => {
   tube(gFace - 18, y, 36, 168, sd / 2 + 4, blueD);
   bolts(gFace - 18, 140, 8, 12, 40);
  });

  /* ---- 軸受ハウジング。OS 側はギヤボックスが持つので台車と一緒に回り、
         DS 側は軸端部の柱が持つので、外すと軸から離れる ---- */
  const bearing = (x, o) => [yU, yL].forEach(y => {
   put(o || g, D3.cyl, dark, [{ x, y, l: M.brgW, r: M.brgD / 2 }]);
   tube(x - M.brgW / 2 - 11, y, 22, M.brgD / 2 * 1.34, sd / 2 + 6, blueD, o);
   tube(x + M.brgW / 2 + 11, y, 22, M.brgD / 2 * 1.34, sd / 2 + 6, blueD, o);
   bolts(x - M.brgW / 2 - 11, M.brgD / 2 * 1.12, 6, 13, 34, o);
   bolts(x + M.brgW / 2 + 11, M.brgD / 2 * 1.12, 6, 13, 34, o);
   put(o || g, D3.cyl, steelD, [{ x, y: y + M.brgD / 2 * 0.9, z: 0, l: 30, r: 20 }]);
  });

  /* ---- 軸端部（DS 端スタンド）。330 送り出すと着地土台に降りる ---- */
  const trv = D3.open ? M.travel : 0;
  const bxDS = dsEnd + M.gapDS / 2 + trv;
  const sx = dsEnd + M.gapDS + M.standDS + trv;
  bx([{ x: sx, y: bedTop + 36, z: 0, l: M.standW + 110, r: 72, d: M.standD + 130 }], blueD, stay);
  bx([{ x: sx, y: (bedTop + 72 + yU + 96) / 2, z: 0, l: M.standW,
        r: (yU + 96) - (bedTop + 72), d: M.standD }], blue, stay);
  bx([{ x: sx, y: (yU + 96 + topY) / 2, z: 0, l: M.standW * 0.9,
        r: topY - (yU + 96), d: M.standD * 0.7 }], blueL, stay);
  bx([-1, 1].map(s => ({ x: sx, y: (bedTop + yU) / 2, z: s * (M.standD / 2 + 8),
                         l: M.standW * 0.78, r: 28, d: 16 })), blueD, stay);
  bx([{ x: sx, y: ty, z: 0, l: M.standW * 1.5, r: M.tieHubR * 2.4, d: M.standD * 0.8 }], blueL, stay);
  bearing(bxDS, stay);
  bearing(osEnd - M.gapOS / 2);

  /* ---- 軸：有効長は Φ200 の研磨面。その外に首・駆動端の継手・キー溝 ---- */
  const r0 = sd / 2;
  cy([yU, yL].flatMap(y => [
   { x: 0, y, l: L, r: r0 },
   { x: dsEnd + M.gapDS / 2 + 34, y, l: M.gapDS + 68, r: r0 * 0.82 },
   { x: osEnd - M.gapOS / 2 - 10, y, l: M.gapOS + 40, r: r0 * 0.90 },
   { x: dsEnd + M.gapDS + 40, y, l: 60, r: r0 * 0.55 }
  ]), steel);
  cy([yU, yL].map(y => ({ x: bx0 + 260, y, l: 260, r: r0 * 0.62 })), steelD);
  cy([yU, yL].map(y => ({ x: bx0 + 132, y, l: 120, r: r0 * 0.80 })), dark);
  bx([yU, yL].map(y => ({ x: 0, y: y + r0 - 3, z: 0, l: L * 0.94, r: 8, d: 20 })), dark);

  /* ---- 送り軸。台車の持ち物で外さない。軸端部が離れると、その先が空くだけ ---- */
  const rx0 = bx0 + 60, rx1 = bx1 - 40;
  cy([{ x: (rx0 + rx1) / 2, y: ty, l: rx1 - rx0, r: M.tieR }], rod);
  cy([{ x: gx - M.gearW * 0.32, y: ty, l: 120, r: M.tieHubR * 0.8 },
      { x: gx + M.gearW * 0.32, y: ty, l: 120, r: M.tieHubR * 0.8 },
      { x: gx + M.gearW * 0.78, y: ty, l: 150, r: M.tieR * 2.2 },
      { x: rx0 + 30, y: ty, l: 74, r: M.tieR * 1.8 }], dark);
  cy([{ x: rx0 + 30, y: ty + 50, l: 28, r: 28 },
      { x: rx0 + 30, y: ty + 98, l: 48, r: 17 }], rod);

  /* ---- 調整ハンドル（Φ475 のリング＋ボス＋3本スポーク）。軸端部の頭に付く ---- */
  const wx = sx + M.standW / 2 + 120;
  const wheel = D3.wheel || (D3.wheel = (() => {
   const w = new T.TorusGeometry(M.wheelR, 17, 16, 64); w.rotateY(Math.PI / 2); return w;
  })());
  const wm = new T.Mesh(wheel, rod); wm.position.set(wx, ty, 0); stay.add(wm);
  put(stay, D3.cyl, rod, [{ x: (sx + wx) / 2, y: ty, l: wx - sx, r: M.tieR * 1.35 }]);
  put(stay, D3.cyl, dark, [{ x: wx, y: ty, l: 58, r: 46 }]);
  const arm = M.wheelR - 17;
  for (let i = 0; i < 3; i++) {
   const a = i * 2 * Math.PI / 3;
   const m = new T.Mesh(D3.cyl, rod);
   m.position.set(wx, ty + Math.sin(a) * arm / 2, Math.cos(a) * arm / 2);
   m.scale.set(arm, 15, 15);
   m.quaternion.setFromUnitVectors(new T.Vector3(1, 0, 0), new T.Vector3(0, Math.sin(a), Math.cos(a)));
   stay.add(m);
  }
  return { x0: bx0, x1: bx1, bcx, baseL, bedTop, railTop,
           xw: Math.max(bx1, wx + M.wheelR), yBot: bedTop - M.floorDrop };
 }

 /* 軸まわり（軸・軸受・スペーサー・保持層・刃）を実寸で置く。 */
 function machine(T, g, A, segs, zp, L, cd, tk) {
  const half = L / 2, off = x => x - half, yU = cd / 2, yL = -cd / 2;
  const out = { liner: [], ring: [], knife: [] };
  [[true, yU, A.U], [false, yL, A.Lo]].forEach(([upper, y, pos]) => {
   const side = upper ? 'up' : 'lo', n = pos.length;
   zone(out, 0, pos[0] - tk / 2, y, zp.zones[0][side]);
   for (let j = 0; j < segs.length; j++) {
    zone(out, pos[j] + tk / 2, pos[j + 1] - tk / 2, y, zp.zones[j + 1][side]);
   }
   zone(out, pos[n - 1] + tk / 2, L, y, zp.zones[A.zones.length - 1][side]);
   pos.forEach(x => out.knife.push({ x, y }));
  });
  const fr = frame(T, g, L, yU, yL);
  const sd = +ctx.M.P.shaftDia || 200, bore = sd / 2;
  const blade = matOf(T, 'blade', { color: '#3f4854', metalness: .78, roughness: .16 });
  const liner = matOf(T, 'liner', { color: '#a8b2bd', metalness: .38, roughness: .46 });
  const edge = matOf(T, 'linerEdge', { color: '#5d6975', metalness: .42, roughness: .55 });
  /* 部材は図面どおり内径の開いた輪。軸が通って見えるので、そのまま管で描く。
     スペーサーは1枚ずつの区切りが分かるよう、外周だけ細い帯を濃い色で重ねる。 */
  const put = (list, ro, ri, mat) => {
   const m = batch(T, tubeGeo(T, ro, ri), mat,
                   list.map(q => ({ x: off(q.x), y: q.y, l: q.len, r: 1, d: 1 })));
   if (m) g.add(m);
  };
  const sh = D3.show;
  const linerR = (+ctx.M.P.spacerOD || 240) / 2;
  const ringBore = (+ctx.M.P.ringBore || 241) / 2;
  if (sh.liner) {
   const ls = out.liner.map(q => ({ x: q.x, y: q.y, len: q.sz - 0.8 }));
   put(ls, linerR, bore, liner);
   put(ls, linerR, linerR - 1.2, edge);     /* 外周の細い帯で1枚ずつの区切りを見せる */
  }
  if (sh.ring) {
   /* 保持層は**ゴムリングでもフィンガーでも同じ層**（§9.377）。色はゴムリングだけ
      マスタの値で、フィンガーは1色（樹脂の押さえ）。 */
   groupBy(out.ring, q => (q.hold.kind === 'ring' ? 'r' + q.hold.od : 'f')).forEach((list, key) => {
    const isRing = key.charAt(0) === 'r';
    const od = isRing ? +key.slice(1) : linerR * 2 + 20;
    const color = isRing ? (ctx.ringHex(od) || '#8d97a6') : '#6f7d8c';
    put(list.map(q => ({ x: q.x, y: q.y, len: q.sz - 1.0 })), od / 2,
        isRing ? ringBore : linerR,
        matOf(T, 'hold' + key, { color, metalness: .02, roughness: .9 }));
   });
  }
  if (sh.knife) put(out.knife.map(q => ({ x: q.x, y: q.y, len: tk })), ctx.st.knife / 2, bore, blade);
  return Object.assign({ out }, fr);
 }

 /* 材料。ラインは正面（OS 側）から見て左が入側、右が出側。軸の向きは OS→DS を
    +X、送りの向きを +Z に取っているので、入側（切断前の元板）は −Z、出側
    （切断後の条）は +Z になる。切られた条は刃に押されて板厚のぶんだけ上下へ
    分かれる（模式図と同じ）。 */
 function material(T, g, A, segs, L) {
  const off = x => x - L / 2, th = Math.max(0.2, ctx.st.thick);
  const run = BS().materialRun(A, segs), IN = 620, OUT = 760;
  /* 板は見せ消しできる。大きさ（IN・OUT）は返すので、消しても画面の収まりは変わらない。 */
  if (!D3.show.mat) return { IN, OUT };
  const sheet = matOf(T, 'sheet', { color: '#c5ccd4', metalness: .62, roughness: .24 });
  const trim = matOf(T, 'trim', { color: '#b0a48d', metalness: .45, roughness: .5 });
  const w0 = run.length ? run[0].from : 0, w1 = run.length ? run[run.length - 1].to : 0;
  const cut = (list, mat) => { const b = batch(T, D3.box, mat, list); if (b) g.add(b); };
  /* 入側：1枚の元板 */
  cut([{ x: off((w0 + w1) / 2), y: 0, z: -IN / 2, l: Math.max(1, w1 - w0), r: th, d: IN }], sheet);
  /* 出側：条ごとに分かれ、板厚ぶん上下に食い違う */
  const after = f => run.map((r, i) => ({ r, i })).filter(({ r }) => f(r)).map(({ r, i }) =>
   ({ x: off((r.from + r.to) / 2), y: BS().matShift(A, run, i) * th, z: OUT / 2,
      l: Math.max(1, r.to - r.from - 3), r: th, d: OUT }));
  cut(after(r => r.sg.type === 'strip'), sheet);
  cut(after(r => r.sg.type !== 'strip'), trim);
  /* 入側・出側の札は板そのものに貼る。立体の中にあるので、軸や部材の向こうに
     回れば隠れる（手前にあるものが手前に見える）。 */
  const mcx = off((w0 + w1) / 2), dy = th / 2 + 105;
  decal(T, g, '入側', '元板（切断前）', mcx, dy, -IN / 2);
  decal(T, g, '出側', '切断後', mcx, dy + th, OUT / 2);
  return { IN, OUT };
 }

 /* 板に付ける札。字を描いた小さな絵を平面に貼り、板のまんなかの真上に置く。
    位置は板に付け、向きだけは毎回こちらを向かせる（`render()`）。 */
 const DECALS = new Map();
 function decal(T, g, name, sub, x, y, z) {
  const key = name + '|' + sub;
  let mat = DECALS.get(key);
  if (!mat) {
   const c = document.createElement('canvas'), W = 512, H = 168;
   c.width = W; c.height = H;
   const q = c.getContext('2d');
   const r = 22, m = 6;
   q.beginPath();
   q.moveTo(m + r, m);
   q.arcTo(W - m, m, W - m, H - m, r); q.arcTo(W - m, H - m, m, H - m, r);
   q.arcTo(m, H - m, m, m, r); q.arcTo(m, m, W - m, m, r);
   q.closePath();
   q.fillStyle = 'rgba(255,255,255,.93)'; q.fill();
   q.strokeStyle = '#b9c3cf'; q.lineWidth = 3; q.stroke();
   q.textAlign = 'center'; q.textBaseline = 'middle';
   q.fillStyle = '#2b3444';
   q.font = '700 54px system-ui, sans-serif';
   q.fillText(name, W / 2, H * 0.36);
   q.fillStyle = '#2f6fb5';
   q.font = '600 38px system-ui, sans-serif';
   q.fillText(sub, W / 2, H * 0.72);
   const tex = new T.CanvasTexture(c);
   tex.anisotropy = 4;
   mat = new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
   DECALS.set(key, mat);
  }
  const mesh = new T.Mesh(D3.plane, mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(430, 141, 1);
  mesh.renderOrder = 2;
  g.add(mesh);
  D3.decals.push(mesh);
 }

 /* 現場まわり。床・2本の走行レール・回転テーブル（甲板とピット）・着地土台。 */
 function site(T, baseL, bcx, bedTop, railTop) {
  const M = MACH, W = D3.world;
  const floorY = bedTop - M.floorDrop;
  const tR = baseL / 2 + M.ttPad;
  const sepX0 = M.ttX + tR + M.sepGap, sepX1 = sepX0 + M.sepW;
  const steelD = matOf(T, 'steelD', { color: '#8f99a4', metalness: .7, roughness: .3 });
  const rail = matOf(T, 'rail', { color: '#7b858f', metalness: .68, roughness: .35 });
  const floor = matOf(T, 'floor', { color: '#cfd7de', metalness: .02, roughness: .95 });
  const dark = matOf(T, 'dark', { color: '#39424e', metalness: .56, roughness: .38 });
  const blue = matOf(T, 'blue', { color: '#2f63b0', metalness: .24, roughness: .48 });
  const blueD = matOf(T, 'blueD', { color: '#24518f', metalness: .24, roughness: .54 });
  const blueL = matOf(T, 'blueL', { color: '#3f77c4', metalness: .24, roughness: .44 });
  const bx = (list, mat, o) => { const m = batch(T, D3.box, mat, list); if (m) (o || W).add(m); };
  bx([{ x: M.ttX / 2 - 600, y: floorY - 60, z: 0, l: 15000, r: 120, d: 8000 }], floor);
  const railRun = (o, x0, x1, z) => {
   const len = x1 - x0, cx = (x0 + x1) / 2;
   if (len <= 1) return;
   bx([{ x: cx, y: floorY + 9, z, l: len, r: 18, d: 250 }], steelD, o);
   bx([{ x: cx, y: railTop - 21, z, l: len, r: 14, d: 96 }], rail, o);
   bx([{ x: cx, y: railTop - 7, z, l: len, r: 14, d: 150 }], rail, o);
   const n = Math.max(2, Math.round(len / 620)), tie = [];
   for (let i = 0; i <= n; i++) tie.push({ x: x0 + len * i / n, y: railTop - 31, z, l: 74, r: 6, d: 230 });
   bx(tie, dark, o);
  };
  [-1, 1].forEach(s => railRun(W, bcx - M.ttX - baseL / 2 - 700, M.ttX - tR - 30, s * M.railZ));
  /* 回転テーブル：ピット（床側・回らない）と甲板（台車と一緒に回る） */
  const pit = new T.Mesh(D3.annulus, steelD);
  pit.position.set(M.ttX, floorY + 4, 0); pit.scale.set(tR + 190, 1, tR + 190); W.add(pit);
  const deck = new T.Mesh(D3.disc, blueD);
  deck.position.set(0, floorY + 55, 0); deck.scale.set(tR, 130, tR); D3.deck.add(deck);
  const rim = new T.Mesh(D3.ringGeo, steelD);
  rim.position.set(0, floorY + 118, 0); rim.scale.set(tR - 6, tR - 6, tR - 6); D3.deck.add(rim);
  [-1, 1].forEach(s => {
   const h2 = Math.sqrt(Math.max(0, tR * tR - Math.pow(s * M.railZ, 2))) - 30;
   railRun(D3.deck, -h2, h2, s * M.railZ);
  });
  bx([{ x: 0, y: floorY + 55, z: 0, l: 60, r: 150, d: 150 }], dark, D3.deck);
  /* 着地土台。テーブルの外に据え付けてあり、送り出した軸端部がここに降りる */
  const cx = (sepX0 + sepX1) / 2, len = M.sepW, bedY = bedTop - M.baseH / 2;
  bx([{ x: cx, y: bedY, z: 0, l: len, r: M.baseH, d: M.baseD }], blue);
  bx([{ x: cx, y: bedY - M.baseH / 2 - 58, z: 0, l: len - 60, r: 116, d: M.baseD - 150 }], blueD);
  bx([{ x: cx, y: bedTop + 6, z: 0, l: len - 40, r: 12, d: M.baseD - 40 }], blueL);
  const leg = [], pad = [];
  [sepX0 + 110, sepX1 - 110].forEach(sx => [-1, 1].forEach(s => {
   const fz = s * (M.baseD / 2 - 130);
   leg.push({ x: sx, y: (bedTop - 116 + floorY + 30) / 2, z: fz, l: 160,
              r: (bedTop - 116) - (floorY + 30), d: 150 });
   pad.push({ x: sx, y: floorY + 16, z: fz, l: 210, r: 32, d: 200 });
  }));
  bx(leg, dark); bx(pad, steelD);
  bx([{ x: sepX0 + 26, y: bedTop + 28, z: 0, l: 40, r: 56, d: M.baseD - 120 }], steelD);
  return { tR, sepX0, sepX1, floorY };
 }

 /* 立体図を組み直す。模式図と同じ A・segs・zp から作る。 */
 function build() {
  if (!ctx || !ctx.res || !init()) return;
  const T = D3.T, g = D3.g, res = ctx.res;
  /* 形と材質は使い回しているので消さない。まとめ描きの持ち物だけ解放する。 */
  const clear = o => { while (o.children.length) { const c = o.children.pop(); if (c.dispose) c.dispose(); } };
  clear(g); clear(D3.fix); clear(D3.deck); clear(D3.world);
  D3.decals = [];
  const A = res.A, segs = res.segs, zp = res.zp;
  const L = A.arborLen, M = MACH;
  const cd = Math.max(1, ctx.st.knife - ctx.st.ov);   /* 上下軸の中心間距離＝刃径−ラップ */
  const m = machine(T, g, A, segs, zp, L, cd, ctx.st.tk);
  const mt = material(T, g, A, segs, L);
  const st2 = site(T, m.baseL, m.bcx, m.bedTop, m.railTop);
  /* 画面に収まる見はじめの位置。実寸から出すので、アーバー長や刃径を変えても崩れない。
     一度でも視点を動かしたあとは動かさない（見ているところを取り上げない）。 */
  const ods = m.out.ring.filter(q => q.hold.kind === 'ring').map(q => q.hold.od);
  const rad = Math.max(ctx.st.knife, +ctx.M.P.spacerOD || 240, ...(ods.length ? ods : [0])) / 2;
  /* OS・DS の札は有効長の両端の真上に置く。台車を回せば札も一緒に回る。 */
  const endY = cd / 2 + rad + 330;
  D3.tag = { os: { x: -(L / 2 + 120), y: endY, z: 0 }, ds: { x: L / 2 + 120, y: endY, z: 0 } };
  D3.bcx = m.bcx;
  D3.carX = D3.out ? -m.bcx : -M.ttX;
  D3.pivot.position.x = M.ttX;
  g.position.x = D3.carX;
  D3.fix.position.x = M.ttX + D3.carX;
  D3.pivot.rotation.y = D3.rot;
  /* 主役は機械まわり。引き出したあとはテーブルと着地土台まで入れて見る。 */
  const shift = M.ttX + D3.carX;
  const a0 = m.x0 + shift, a1 = (D3.out ? st2.sepX1 + 200 : m.xw + shift);
  const sz = Math.max(a1 - a0, Math.abs(m.yBot) + rad * 2, mt.IN + mt.OUT + 600);
  Object.assign(HOME, { tx: (a0 + a1) / 2, ty: m.yBot / 3, tz: (mt.OUT - mt.IN) / 2 + 160,
                        r: sz / 2 / Math.sin(D3.cam.fov * Math.PI / 360) * 1.15, az: -0.62, el: 0.42 });
  if (!D3.moved) Object.assign(CAM, HOME);
  D3.built = true;
  D3.dirty = false;
  render();
 }

 function render() {
  if (!D3.r || !D3.on) return;
  const T = D3.T, cv = D3.cv, w = cv.clientWidth, h = cv.clientHeight;
  if (w < 8 || h < 8) return;
  if (cv.width !== Math.round(w * D3.r.getPixelRatio()) || D3.w !== w || D3.h !== h) {
   D3.r.setSize(w, h, false); D3.cam.aspect = w / h; D3.cam.updateProjectionMatrix();
   D3.w = w; D3.h = h;
  }
  const c = CAM, ce = Math.cos(c.el);
  /* 見ている先は模型の中の点。台車を回したぶんだけ、その点も一緒に回る。 */
  const px = D3.pivot ? D3.pivot.position.x : 0;
  const sr = Math.sin(D3.rot), cr = Math.cos(D3.rot);
  const dx = c.tx - px;
  const tx = px + dx * cr + c.tz * sr, tz = -dx * sr + c.tz * cr;
  D3.cam.position.set(tx + c.r * ce * Math.sin(c.az), c.ty + c.r * Math.sin(c.el),
                      tz + c.r * ce * Math.cos(c.az));
  D3.cam.lookAt(tx, c.ty, tz);
  /* 板の札は、位置は板のまま・向きだけこちらへ向ける。 */
  if (D3.decals && D3.decals.length) {
   const q = new T.Quaternion();
   D3.g.getWorldQuaternion(q).invert().multiply(D3.cam.quaternion);
   D3.decals.forEach(m => m.quaternion.copy(q));
  }
  D3.r.render(D3.sc, D3.cam);
  tags(w, h);
 }

 /* 札（OS・DS）を、立体の点の見えている位置へ置く。台車を回しても付いてくる。 */
 const TAG_KEYS = ['os', 'ds'];
 function tags(w, h) {
  const T = D3.T, t = D3.tag;
  if (!t) return;
  const v = new T.Vector3();
  D3.pivot.updateMatrixWorld(true);
  const at = {}, put = [];
  TAG_KEYS.forEach(key => {
   const el = $h('.bs-t3-' + key), p = t[key];
   if (!el) return;
   if (!p) { el.hidden = true; return; }
   v.set(p.x, p.y, p.z).applyMatrix4(D3.g.matrixWorld).project(D3.cam);
   const on = v.z > -1 && v.z < 1;
   el.hidden = !on;
   if (!on) return;
   at[key] = v.x;
   put.push({ el, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h,
              w: el.offsetWidth || 60, h: el.offsetHeight || 20 });
  });
  place(put, w, h);
  sides(at);
 }
 /* 札の渋滞をほどく。指し示す横の位置は動かさず、重なったぶんだけ上下へ分ける。
    四隅は操作の道具が使っているので、そこへは入れない。 */
 function place(put, w, h) {
  const PAD = 6, TOP = 42, BOT = 44;
  for (let pass = 0; pass < 6; pass++) {
   let moved = false;
   for (let i = 0; i < put.length; i++) {
    for (let j = i + 1; j < put.length; j++) {
     const a = put[i], b = put[j];
     const dx = Math.abs(a.x - b.x) - (a.w + b.w) / 2 - PAD;
     if (dx >= 0) continue;
     const dy = Math.abs(a.y - b.y) - (a.h + b.h) / 2 - PAD;
     if (dy >= 0) continue;
     const push = -dy / 2 + 0.5;
     const up = a.y <= b.y ? a : b, dn = up === a ? b : a;
     up.y -= push; dn.y += push; moved = true;
    }
   }
   if (!moved) break;
  }
  put.forEach(q => {
   const x = Math.max(q.w / 2 + PAD, Math.min(w - q.w / 2 - PAD, q.x));
   const y = Math.max(TOP + q.h / 2, Math.min(h - BOT - q.h / 2, q.y));
   q.el.style.left = `${x}px`;
   q.el.style.top = `${y}px`;
  });
 }
 /* いま画面のどちら側が OS／DS か。台車を回しても、視点をドラッグで回しても、
    「手前」「左」といった言い方が実際とずれないよう、見えている位置から出す。 */
 function sides(at) {
  const el = $h('.bs-o3');
  if (!el) return;
  if (!('os' in at) || !('ds' in at)) { el.hidden = true; return; }
  const l = at.os <= at.ds ? 'os' : 'ds', r = l === 'os' ? 'ds' : 'os';
  const nm = k => `<i class="is-${k}">${k.toUpperCase()}</i>`;
  el.innerHTML = `<s>画面左</s>${nm(l)}<s>／</s><s>右</s>${nm(r)}`;
  el.hidden = false;
 }

 /* 操作の手応え。少しのあいだ出して消える。 */
 function note(text) {
  const el = $h('.bs-m3');
  if (!el) return;
  el.textContent = text; el.hidden = !text;
  clearTimeout(D3.noteT);
  if (text) D3.noteT = setTimeout(() => { el.hidden = true; }, 2600);
 }

 /* ====================== 段取りの3手順 ======================
    **実機と同じ順でしか進めない**——できない操作は止めて、何を先にするかを言う
    （§CLAUDE 4「できないことは、できないと書く」）。判定はここ1箇所。 */
 function blockReason(step) {
  if (D3.busy || D3.spin) return '動いている間は押せません。';
  if (step === 'pull') {
   if (Math.abs(D3.rot) > 1e-3) return '先に「③台車を回す」で向きを戻します。';
   if (D3.open) return '先に「②軸端部を戻す」で本体に取り付けます。';
   return '';
  }
  if (step === 'open') {
   if (!D3.out) return '先に「①引き出す」で回転テーブルの上まで移動します。';
   if (Math.abs(D3.rot) > 1e-3) return '先に「③台車を回す」で向きを戻します。';
   return '';
  }
  if (step === 'spin') {
   if (!D3.out) return '先に「①引き出す」で回転テーブルの上まで移動します。';
   if (!D3.open) return '先に「②軸端部を外す」でスタンドをテーブルの外へ出します。';
   return '';
  }
  return '';
 }
 const ease = k => (k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k));
 function lock(v) {
  D3.busy = v;
  ['pull', 'open', 'spin'].forEach(id => {
   const b = $h('.bs-step3-' + id); if (b) b.disabled = v;
  });
 }
 /* レールに沿って引き出す。外した軸端部は走行には付いていくが、回転には付いていかない。 */
 function travel(out) {
  if (!D3.pivot || !ctx || !ctx.res) { D3.out = out; return; }
  const from = D3.carX, to = out ? -D3.bcx : -MACH.ttX;
  const t0 = performance.now(), ms = 2600;
  lock(true);
  const step = now => {
   const k = Math.min(1, (now - t0) / ms);
   D3.carX = from + (to - from) * ease(k);
   D3.g.position.x = D3.carX;
   D3.fix.position.x = MACH.ttX + D3.carX;     /* 走行にはスタンドも付いていく */
   render();
   if (k < 1) { requestAnimationFrame(step); return; }
   D3.out = out; lock(false);
   const b = $h('.bs-step3-pull');
   if (b) { b.textContent = out ? '①ラインへ戻す' : '①引き出す'; b.classList.toggle('is-on', out); }
   D3.moved = false;
   build();
   note(out ? 'レールに沿って引き出しました。回転テーブルの上です。' : 'ライン位置へ戻しました。');
  };
  requestAnimationFrame(step);
 }
 /* 台車を回して OS・DS を入れ替える。模型を回すだけなので、部材の並びも
    送りの向きもそのまま付いてくる。 */
 function spinTo(to) {
  if (!D3.pivot) { D3.rot = to; return; }
  if (Math.abs(D3.rot - to) < 1e-6) return;
  const from = D3.rot, t0 = performance.now(), ms = 2200;
  D3.spin = true;
  const b = $h('.bs-step3-spin'); if (b) b.disabled = true;
  build();      /* 回しはじめにタイロッドを外す。組み直さないと外れた形にならない */
  const step = now => {
   const k = Math.min(1, (now - t0) / ms);
   const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
   D3.rot = from + (to - from) * e;
   D3.pivot.rotation.y = D3.rot;
   render();
   if (k < 1) { requestAnimationFrame(step); return; }
   D3.spin = false;
   if (b) b.disabled = false;
   build();      /* 運転の向きに戻ったらタイロッドを付け直す */
   note(Math.abs(D3.rot) > 1e-3 ? '台車を回しました。DS 側から部材を入れられます。'
                                : '台車を戻しました。運転の向きです。');
  };
  requestAnimationFrame(step);
 }

 /* ====================== 画面との口 ====================== */
 /* 器を受け取り、重ねた道具を配線する。**画面はDOMを作るだけ**で、
    どのボタンが何をするかはここが決める（判定を2箇所に置かない）。 */
 function attach(el, opts) {
  host = el;
  onSpinDone = (opts && opts.onSpin) || null;
  host.addEventListener('click', e => {
   const b = e.target.closest('button');
   if (!b) return;
   if (b.classList.contains('bs-step3-pull')) return act('pull', () => travel(!D3.out));
   if (b.classList.contains('bs-step3-open')) return act('open', toggleOpen);
   if (b.classList.contains('bs-step3-spin')) return act('spin', () => {
    if (onSpinDone) onSpinDone();    /* 向きの切替は画面が持つ（模式図と同じ1つの状態） */
   });
   if (b.classList.contains('bs-step3-reset')) {
    D3.moved = false; Object.assign(CAM, HOME); render(); return undefined;
   }
   if (b.dataset.show) return toggleShow(b);
   if (b.classList.contains('bs-help3')) return toggleHelp(b);
   return undefined;
  });
  document.addEventListener('click', e => {
   const pop = $h('.bs-hpop');
   if (!pop || pop.hidden) return;
   if (e.target.closest('.bs-hpop') || e.target.closest('.bs-help3')) return;
   pop.hidden = true;
   const b = $h('.bs-help3'); if (b) b.setAttribute('aria-expanded', 'false');
  });
  window.addEventListener('resize', () => { if (D3.on) render(); });
 }
 function act(step, run) {
  const why = blockReason(step);
  if (why) { note(why); return undefined; }
  run();
  return undefined;
 }
 function toggleOpen() {
  D3.open = !D3.open;
  const b = $h('.bs-step3-open');
  if (b) { b.textContent = D3.open ? '②軸端部を戻す' : '②軸端部を外す'; b.classList.toggle('is-on', D3.open); }
  build();
  note(D3.open ? '軸端部を 330mm 送り出しました。テーブルの外の土台に降り、軸の先が剥き出しです。'
               : '軸端部を戻しました。');
 }
 /* 見せる部材の入切。**言葉は部材の名前で固定**し、点が付いているかどうかで
    入切を示す（押すたびに言葉が変わると読み違える）。 */
 function toggleShow(b) {
  const key = b.dataset.show;
  const on = D3.show[key] = !D3.show[key];
  b.classList.toggle('is-on', on);
  b.setAttribute('aria-pressed', String(on));
  build();
  note(`${b.dataset.showName || key}を${on ? '表示' : '非表示'}にしました。`);
  return undefined;
 }
 function toggleHelp(b) {
  const pop = $h('.bs-hpop');
  if (!pop) return undefined;
  const on = pop.hidden;
  pop.hidden = !on;
  b.setAttribute('aria-expanded', String(on));
  return undefined;
 }

 /* いまの割付を預かる。**模式図と同じ `res`** なので、どちらを見ても食い違わない。 */
 function sync(next) {
  ctx = next;
  D3.dirty = true;
  if (D3.on) build();
 }
 /* 模式図／立体図の切り替え。**立体図に切り替えたときだけ**部品を取りに行く。 */
 async function setMode(on) {
  D3.on = !!on;
  if (!D3.on) return true;
  clearFail();
  if (!window.THREE) {
   note('立体図の部品を読み込んでいます…');
   const ok = await loadLibrary();
   note('');
   if (!ok) {
    fail('立体図を表示する部品（three.js）を読み込めませんでした。<br>'
       + 'この端末から外部へつながらない場合に出ます。<br><b>模式図はそのまま使えます。</b>');
    return false;
   }
  }
  if (!init()) return false;
  if (D3.dirty) build(); else render();
  return true;
 }

 WL.bladeSolid = {
  attach, sync, setMode, render, spinTo, note, blockReason,
  get on() { return D3.on; },
  get ready() { return !!D3.r; },
  get show() { return Object.assign({}, D3.show); },
  get stage() { return { out: D3.out, open: D3.open, rot: D3.rot }; },
  THREE_SRC
 };
})();
