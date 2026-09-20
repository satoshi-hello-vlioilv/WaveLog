/* blade-3d.js: 刃組の立体図（§9.377 追補）。

   模式図（`blade-view.js` の SVG）と**同じ割付（`zp`）から**、実機の寸法その
   ままで組み立てる。単位は mm。図面 SL-1458-01S より: カッター軸有効長 1600 ／
   軸径 Φ200 ／ 軸受 Φ260。上下軸の中心間距離は「刃径 − ラップ」。刃の上下の
   ずれは**実寸のクリアランス**で、誇張はしない（模式図は見やすさのために広げて
   描くが、こちらは寸法に忠実）。

   ----------------------------------------------------------------------
   three.js は **`static/vendor/three/` へ同梱する**（§9.378、利用者の報告
   「3Dでの表現が表示失敗します」）。はじめは CDN から読んでいたが、現場の
   端末で読み込めなかった。**取りに行く先が1つでも外にあると、そこが落ちた
   ときに機能ごと使えなくなる**——アイコンのフォントを同梱しているのと同じ
   理由（§9.240）でこちらも同梱へ倒した。

   **同梱しても起動は遅くならない。** 読むのは**立体図を最初に押したときだけ**で、
   `index.html` には載せない（608KB を全員が毎回読むことにはならない）。
   以前「同梱＝起動が遅くなる」と見積もったのは、元の単一HTMLのように
   **ページへ埋め込む**前提だったからで、別ファイルにして遅らせれば成り立たない。

     ・起動は 600KB ぶん速いまま（模式図しか使わない人は一度も読まない）
     ・**回線に依らない**（外へつながらない端末でも立体図が出る）
     ・版は `THREE_SRC` の1箇所に留める。素の `THREE` を使う UMD 版は r149 が
       最後なので、上げるときは API の作り直しが要る

   **`window.THREE` はこのファイルだけが触る。** 画面（`blade-view.js`）は
   `WL.bladeSolid` の口だけを呼ぶ（§CLAUDE「`window.*`への新規公開は名前空間経由」）。
   ----------------------------------------------------------------------
*/
(function(){
 'use strict';
 const WL = (window.WL = window.WL || {});
 const BS = () => WL.bladeSet;

 /* 読む先は**同梱した1本**（`static/vendor/three/three.min.js`・MIT）。
    外を指さないので、回線の有無で立体図が出たり出なかったりしない。 */
 const THREE_SRC = '/static/vendor/three/three.min.js';

 /* 立体図のはじめの状態は「刃組をはじめる状態」。
    ①引き出し ②軸端部を外し ③台車を半回転させた、そこから刃を組む姿にする。 */
 /* `cut` は断面図（§9.412、利用者の指示）。**同じ模型を使い回す**——部品を
    作り直さず、機械まわりを伏せ・視点を平行投影の真横へ・軸の中心で切るだけ。
    `keep` は切ったあと**どちら側を残すか**（+1: z≧0 を残す／-1: z≦0 を残す）で、
    カメラの居る側の反対を残す（カメラと断面のあいだに物が無い状態にする）。 */
 const D3 = { on:false, cut:false, keep:-1, built:false, dirty:true, open:true, out:true,
   rot:Math.PI, carX:0,
   /* 断面図の視点（§9.413 追補）。**板幅の中心を起点に**左右（`cutAz`）と
      上下（`cutEl`）へ回す。切る面は世界に固定したままなので、回しても
      切り口は動かない——動くのは見る位置だけ。 */
   cutAz:0, cutEl:0, marks:[], zmarks:[], zr:0,
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
 let onSpinDone = null;  /* 台車を回し終えたことを画面へ知らせる */
 let onBadges = null;    /* 区間の記号の顔ぶれが変わったことを画面へ知らせる */

 const $h = sel => (host ? host.querySelector(sel) : null);

 /* ====================== 部品の読み込み ====================== */
 let loading = null;
 /* 取りに行っている間の約束は**1本にまとめる**（同時に2回押しても2本読まない）。
    ただし**失敗した約束は握らない**（§9.378）——握ると、一度でも読めなかった
    あとは「もう一度押しても二度と取りに行かない」ことになり、回線が一瞬途切れた
    だけで**ページを開き直すまで立体図が出なくなる**（網が捕まえた）。
    読めなかった`<script>`も片付ける（同じ src の札が残っていると紛らわしい）。 */
 function loadLibrary() {
  if (window.THREE) return Promise.resolve(true);
  if (loading) return loading;
  loading = new Promise(resolve => {
   const s = document.createElement('script');
   s.src = THREE_SRC;
   s.async = true;
   s.onload = () => { loading = null; resolve(!!window.THREE); };
   s.onerror = () => { loading = null; s.remove(); resolve(false); };
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
  /* 断面図は**平行投影**（§9.412）。遠近が付かないので、離れた位置の部材どうしでも
     寸法を目で比べられる——模式図と同じ読み方ができる、というのがこの図の狙い。 */
  const ocam = new T.OrthographicCamera(-1, 1, 1, -1, 1, 60000);
  D3.ocam = ocam;
  /* 切断面は1枚。向き（どちら側を残すか）は毎フレーム`keep`から決める。 */
  D3.clip = new T.Plane(new T.Vector3(0, 0, -1), 0);
  r.localClippingEnabled = true;
  /* 光は4つ。上からの主光・手前からの補助・地明かり・断面図用の手前光。
     **強さは図ごとに配り直す**（`LIGHT`・`applyCut()`）——同じ配分を使い回すと
     断面図が白飛びする（§9.415）。 */
  const hemi = new T.HemisphereLight('#e8eef5', '#5e6772', LIGHT.solid.hemi); sc.add(hemi);
  const k = new T.DirectionalLight('#ffffff', LIGHT.solid.key);
  k.position.set(-1200, 1800, 1500); sc.add(k);
  const f = new T.DirectionalLight('#cfdcec', LIGHT.solid.fill);
  f.position.set(1500, -600, 1100); sc.add(f);
  /* 断面図の切り口は**カメラのほうを向いた平らな面**なので、上や奥からの光では
     暗いままになる（実際に踏んだ: 軸の切り口が真っ黒に見えた）。見ている側から
     当てる光を1つ持ち、断面図のときだけ点ける。 */
  const cl = new T.DirectionalLight('#ffffff', LIGHT.cut.cam); cl.visible = false; sc.add(cl);
  D3.cutLight = cl;
  D3.lights = { hemi, key: k, fill: f, cam: cl };
  /* 台車は自分の中心で回る。回す軸をここに置き、その子として中身を持つ。 */
  const pivot = new T.Group(); sc.add(pivot);    /* 回転テーブルの中心 */
  const g = new T.Group(); pivot.add(g);         /* 回る台車。走行ぶんは位置で持つ */
  /* 機械まわり（台座・ギヤボックス・軸受・走行・送り軸）。**断面図では丸ごと伏せる**
     ——模式図が描いているのは軸・刃・スペーサー・保持層・板の5つだけ（§9.412）。 */
  const rig = new T.Group(); g.add(rig); D3.rig = rig;
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
 /* 断面図のときだけ**模式図の色**を借りる（§9.415／§9.416）。立体図は機械の
    見た目のまま——同じ物でも、図によって見えるべきものが違う。 */
 const cutColor = (name, base) => (D3.cut ? cssColor(name, base) : base);
 function cssColor(name, fallback) {
  if (!host) return fallback;
  const v = getComputedStyle(host).getPropertyValue(name).trim();
  return v || fallback;
 }

 /* 光の配分。**図ごとに別の答えを持つ**（§9.415、利用者の指摘「暗すぎるか
    明るすぎるか反射の状況が悪すぎて見にくい」）。

    立体図は**機械まわりが主役**で、斜め上からの主光が形を立ち上げる配分。
    そのまま断面図へ持ち込むと**切り口が白へ飛ぶ**——断面図の面は
    ①カメラのほうをまっすぐ向いていて ②そこへ手前光（`cam`）まで当たるので、
    主光＋補助＋手前光＋地明かりが**同じ面に重なる**。実測では画面の
    **36.7% が真っ白（輝度246以上）**になり、軸もスペーサーも板も地の色
    （`--bs-3d-bg`）と見分けが付かなかった。

    断面図は**地明かりを主役**にして平らに照らし、向きのある光は形が潰れない
    ぶんだけ残す。**材質の色の差**（軸・スペーサーの鋼／刃の濃い鋼／板／耳）が
    そのまま読める明るさが狙い——模式図と同じ読み方ができる、という
    この図の目的（§9.412）に合う。 */
 const LIGHT = {
  solid: { hemi: 0.45, key: 1.05, fill: 0.38, cam: 0 },
  cut:   { hemi: 0.78, key: 0.22, fill: 0.10, cam: 0.26 }
 };
 /* 断面図で回せる角度の上限（ラジアン）。真横（±π/2）の手前で止める。 */
 const CUT_LIM = 1.15;
 /* 断面図で刃先のあいだに空ける隙間＝見かけの板厚の何倍か（§9.413 追補）。
    板は千鳥で上下へ寄るので**見かけの厚みの3倍**の高さを占める。その両側へ
    ほぼ1枚ぶんずつ余裕を取った値。模式図（`FIG.openGap` に対し板は 10%）ほど
    大きくは開けない——断面図は刃もスペーサーも**実寸の丸のまま**描くので、
    そこだけ極端に開けると図が読めなくなる。 */
 const CUT_OPEN = 5;
 /* 有効幅の境目に置く青い印の径。**模式図の `FIG.capD` と同じ値**
    （片方だけ変えると、2つの図で同じ印が別の大きさに見える）。 */
 const CUT_CAP_D = 300;
 /* 部材のいちばん外側の半径。中心間距離を決める前に要るので、`machine()` の
    答えを待たずにマスタと設定から出す。 */
 const ringRadius = c => Math.max(c.st.knife, +c.M.P.spacerOD || 240,
   ...(c.M.rings || []).map(r => +r.od || 0)) / 2;
 /* 見る向きの操作。回す・寄せる・平行移動の3つ。 */
 function bindPointer(cv) {
  let drag = null;
  cv.addEventListener('pointerdown', e => {
   /* **掴み損ねても回せる。** `setPointerCapture` は器の外まで追うためのもので、
      回すこと自体には要らない。掴めない入力（合成した `pointerId` など）で
      ここが例外を投げると、**この先の配線まで丸ごと止まる**（実際に止めた）。 */
   try { cv.setPointerCapture(e.pointerId); } catch (err) {
    WL.quiet.note('つまみを掴む先が無い（器の外までは追えないが、向きは動く）', err);
   }
   /* 断面図も**板幅の中心を起点に回せる**（§9.413 追補、利用者の指示
      「今の視点から板幅の中心を起点に上下左右に視点を回転させることが
      できるように」）。§9.412 では真横に固定していたが、切り口は世界に
      固定した面なので、**見る位置を回しても切り口は動かない**——
      平行投影のまま、斜めから積み重なりを見られる。
      寄る・引くは持たない（平行投影の倍率が変わると、寸法を並べて
      比べるという狙いが崩れる）。 */
   if (D3.cut) {
    drag = { x: e.clientX, y: e.clientY, cut: true, az: D3.cutAz, el: D3.cutEl };
    return;
   }
   D3.moved = true;
   drag = Object.assign({ x: e.clientX, y: e.clientY,
                          pan: e.shiftKey || e.button === 1 || e.button === 2 }, CAM);
  });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointermove', e => {
   if (!drag) return;
   const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
   if (drag.cut) {
    /* **90°まで回さない**（`CUT_LIM`）。真横を越えるとカメラが切り落とす側へ
       回り込み、切り口ではなく「何も無いほう」を見ることになる。 */
    D3.cutAz = Math.max(-CUT_LIM, Math.min(CUT_LIM, drag.az - dx * 0.005));
    D3.cutEl = Math.max(-CUT_LIM, Math.min(CUT_LIM, drag.el + dy * 0.005));
    render();
    return;
   }
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
   if (D3.cut) return;                 /* 断面図は寄る・引くもしない（§9.412） */
   e.preventDefault();
   D3.moved = true;
   CAM.r = Math.max(260, Math.min(9000, CAM.r * (e.deltaY > 0 ? 1.12 : 0.89)));
   render();
  }, { passive: false });
 }

 /* 断面図は**艶を落とした写し**を使う（§9.415、利用者の指摘「反射の状況が
    悪すぎて見にくい」）。立体図の部材は金属として磨いてある（`metalness` .6〜.8）
    ので、断面図のように**面がカメラをまっすぐ向く**と手前光がそのまま映り込み、
    材質の色ではなく**光の色（白）**が出る——鋼も板も耳も同じ白になり、
    見分けが付かなかった（実測: 板の面が輝度229、地が241で差は12しかない）。
    断面図では艶を落として**その部材の色そのもの**を出す。

    **分けるのはここ1箇所**。部材を作っているところ（`machine()`・`material()`）は
    今までどおり1つの綴りで呼ぶ——両方の図で同じ色・同じ名前のまま、艶だけが
    変わる。図を切り替えるたびに`build()`が材質を取り直すので、写しは
    名前（`…·cut`）で分けて両方を持っておく。 */
 const CUT_METAL = 0.10, CUT_ROUGH = 0.80;
 const matOf = (() => {
  const cache = new Map();
  return (T, key, o) => {
   const k = D3.cut ? key + '·cut' : key;
   if (!cache.has(k)) {
    const spec = D3.cut
     ? Object.assign({}, o, { metalness: Math.min(+o.metalness || 0, CUT_METAL),
                              roughness: Math.max(+o.roughness || 0, CUT_ROUGH) })
     : o;
    const m = new T.MeshStandardMaterial(spec);
    m.name = k;                   /* 干渉検査でどの部材かを名で見分ける */
    cache.set(k, m);
   }
   return cache.get(k);
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
 /* 切り口の面（§9.412）。**切っただけでは中が空洞に見える**——管も箱も閉じた殻
    なので、断面で切ると内側の壁が見えてしまう。軸の中心で切った断面は必ず
    「長方形」なので、**その長方形を薄い板で置く**（丸刃・スペーサー・保持層＝
    内径のぶんを抜いた上下2枚、軸と板＝1枚）。模式図と同じ形が、同じ色で出る。
    置く場所は断面のほんの内側——面の上に置くと、切断面に切り取られて消える。 */
 const CAP_T = 1.2;
 function capRects(items, ro, ri) {
  const z = D3.keep * (CAP_T / 2 + 0.05), out = [];
  items.forEach(q => {
   if (ri > 0.01) {
    out.push({ x: q.x, y: q.y + (ri + ro) / 2, z, l: q.l, r: ro - ri, d: CAP_T });
    out.push({ x: q.x, y: q.y - (ri + ro) / 2, z, l: q.l, r: ro - ri, d: CAP_T });
   } else {
    out.push({ x: q.x, y: q.y, z, l: q.l, r: ro * 2, d: CAP_T });
   }
  });
  return out;
 }
 function cap(T, g, items, ro, ri, mat) {
  if (!D3.cut) return;
  const m = batch(T, D3.box, mat, capRects(items, ro, ri));
  if (m) g.add(m);
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
  /* 軸は断面図では**模式図と同じ色**（§9.416）。立体図の軸は機械の中の1本として
     見るので明るい鋼色でよいが、断面図では**スペーサーと隣り合う**ので、
     同じ明るさだと境目が読めない（実測 1.1:1）。模式図の軸の色を借りると、
     2つの図で同じ物が同じ色になり（§CLAUDE 8）、スペーサーとも差が付く。 */
  const steel = matOf(T, 'steel',
    { color: cutColor('--bs-fig-shaft', '#b9c1c9'), metalness: .74, roughness: .22 });
  const steelD = matOf(T, 'steelD', { color: '#8f99a4', metalness: .70, roughness: .30 });
  const blue = matOf(T, 'blue', { color: '#2f63b0', metalness: .24, roughness: .48 });
  const blueD = matOf(T, 'blueD', { color: '#24518f', metalness: .24, roughness: .54 });
  const blueL = matOf(T, 'blueL', { color: '#3f77c4', metalness: .24, roughness: .44 });
  const dark = matOf(T, 'dark', { color: '#39424e', metalness: .56, roughness: .38 });
  const rod = matOf(T, 'rod', { color: '#aeb6bd', metalness: .72, roughness: .26 });
  /* 外した軸端部は台車と一緒には回らないので、別の入れ物へ入れる。 */
  const stay = D3.fix;
  const put = (o, geo, mat, list) => { const m = batch(T, geo, mat, list); if (m) o.add(m); };
  /* **既定の行き先は`rig`（機械まわり）**。断面図では`rig`ごと伏せるので、
     ここへ足したものは自動的に断面図から外れる。断面図にも出したい物だけ、
     行き先に`g`を明示する（いまは軸の有効長だけ・§9.412）。 */
  const rig = D3.rig;
  const bx = (list, mat, o) => put(o || rig, D3.box, mat, list);
  const cy = (list, mat, o) => put(o || rig, D3.cyl, mat, list);
  const cyZ = (list, mat, o) => put(o || rig, D3.cylZ, mat, list);
  const tube = (x, y, len, ro, ri, mat, o) => {
   const m = new T.Mesh(tubeGeo(T, ro, ri), mat);
   m.position.set(x, y, 0); m.scale.set(len, 1, 1); (o || rig).add(m); return m;
  };
  /* 円周にボルトを並べる。フランジが板に見えないようにする。 */
  const bolts = (x, r, n, hr, hl, o) => {
   const list = [];
   for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + Math.PI / n;
    list.push({ x, y: Math.sin(a) * r, z: Math.cos(a) * r, l: hl, r: hr });
   }
   put(o || rig, D3.cyl, dark, list);
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
  /* 有効長の研磨面だけは**断面図にも出す**（模式図が描いている5つの1つ）。
     首・継手は機械まわりなので`rig`のまま。 */
  const shafts = [yU, yL].map(y => ({ x: 0, y, l: L, r: r0 }));
  cy(shafts, steel, g);
  cap(T, g, shafts.map(q => ({ x: q.x, y: q.y, l: q.l })), r0, 0, steel);
  /* **有効幅の境目の青い印**（§9.413 追補、利用者の指示「上下軸のend部分は
     青色で明示しているので3D断面も分かるようにして」）。模式図は `drawShafts()`
     で有効幅の**外側**へ同じ印を置いている（§9.378）。断面図は機械まわり
     （首・継手・軸受）を丸ごと伏せるので、これが無いと**どこまでが有効幅なのか
     図から読めない**。色も径も模式図と同じ（`--bs-fig-cap` ／ Φ300）。
     立体図では本物の機械が見えているので、印は**断面図のときだけ**出す。 */
  if (D3.cut) {
   const capD = CUT_CAP_D, capL = Math.max(24, L * 0.018), cr = capD / 2;
   const capM = matOf(T, 'endcap', { color: cssColor('--bs-fig-cap', '#4a5aa8'),
                                     metalness: .18, roughness: .52 });
   const ends = [yU, yL].flatMap(y => [-1, 1].map(sgn => ({
    x: sgn * (L / 2 + capL / 2), y, l: capL, r: cr })));
   D3.endCaps = ends.length;
   cy(ends, capM, g);
   cap(T, g, ends.map(q => ({ x: q.x, y: q.y, l: q.l })), cr, 0, capM);
  }
  cy([yU, yL].flatMap(y => [
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
  /* 区間の記号（§9.417）。**模式図と同じ対応表**（`res.badges`）を読む——
     図ごとに割り当て直すと、同じ区間が図と表で別の記号になり得る。
     端の2区間（最外刃より外）は模式図でも記号を出さない（右レールの
     端部の表が持つ）ので、ここでも出さない。 */
  const bmap = (ctx.res && ctx.res.badges) || { up: {}, lo: {} };
  const zmk = [];
  [[true, yU, A.U], [false, yL, A.Lo]].forEach(([upper, y, pos]) => {
   const side = upper ? 'up' : 'lo', n = pos.length;
   const spans = [[0, pos[0] - tk / 2]];
   for (let j = 0; j < segs.length; j++) spans.push([pos[j] + tk / 2, pos[j + 1] - tk / 2]);
   spans.push([pos[n - 1] + tk / 2, L]);
   spans.forEach(([a, b], k) => {
    zone(out, a, b, y, zp.zones[k][side]);
    const r = (k > 0 && k < spans.length - 1) ? bmap[side][k] : null;
    if (r) zmk.push({ badge: String(r.badge), x0: off(a), x1: off(b), y });
   });
   pos.forEach(x => out.knife.push({ x, y }));
  });
  D3.zmarks = zmk;
  const fr = frame(T, g, L, yU, yL);
  const sd = +ctx.M.P.shaftDia || 200, bore = sd / 2;
  const blade = matOf(T, 'blade', { color: '#3f4854', metalness: .78, roughness: .16 });
  const liner = matOf(T, 'liner',
    { color: cutColor('--bs-fig-spacer', '#a8b2bd'), metalness: .38, roughness: .46 });
  const edge = matOf(T, 'linerEdge',
    { color: cutColor('--bs-fig-spacer-edge', '#5d6975'), metalness: .42, roughness: .55 });
  /* 部材は図面どおり内径の開いた輪。軸が通って見えるので、そのまま管で描く。
     スペーサーは1枚ずつの区切りが分かるよう、外周だけ細い帯を濃い色で重ねる。 */
  const put = (list, ro, ri, mat) => {
   const items = list.map(q => ({ x: off(q.x), y: q.y, l: q.len, r: 1, d: 1 }));
   const m = batch(T, tubeGeo(T, ro, ri), mat, items);
   if (m) g.add(m);
   cap(T, g, items, ro, ri, mat);      /* 断面図のときだけ切り口を置く（§9.412） */
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
  if (!D3.show.mat) { D3.marks = []; return { IN, OUT }; }
  /* 板と耳屑は、断面図では**模式図と同じ色**にする（§9.415）。立体図の板は
     ロールの上に載った1枚として機械の中で見るので明るい鋼色でよいが、断面図の
     板は**いちばん薄い物**（見かけの厚みを8倍に誇張してなお数px）なので、
     明るい鋼色のままだと地に溶ける（実測: 輝度231に対し地が241、差は10）。
     模式図の板・耳の色（`--bs-fig-strip`／`--bs-fig-trim`）を借りると、
     **2つの図で同じ物が同じ色**になり（§CLAUDE 8）、地との差も付く。 */
  const sheet = matOf(T, 'sheet',
    { color: cutColor('--bs-fig-strip', '#c5ccd4'), metalness: .62, roughness: .24 });
  const trim = matOf(T, 'trim',
    { color: cutColor('--bs-fig-trim', '#b0a48d'), metalness: .45, roughness: .5 });
  const w0 = run.length ? run[0].from : 0, w1 = run.length ? run[run.length - 1].to : 0;
  const cut = (list, mat) => { const b = batch(T, D3.box, mat, list); if (b) g.add(b); };
  /* ---- 断面図（§9.412）----
     **模式図と同じものを出す**。模式図が描いているのは「切ったあとの条」
     （`matShift`で板厚のぶん上下に食い違う姿）なので、断面図でもそれを出す。
     入側・出側の2枚に分けると、**切断面から見て片方は必ず向こう側**になり、
     切った瞬間に消える——断面をまたいで置き、どちら側から見ても写るようにする。 */
  if (D3.cut) {
   const DEP = 420;
   const box = D3.cutBox || { h: 800 };
   /* 見かけの厚みは `build()` が先に決める（軸を離す量がこれで決まるため）。 */
   const TH = D3.matTh || th;
   /* **`matShift` は模式図（SVGのY＝下向き）の答え**なので、立体（Yは上向き）へ
      写すときは符号を返す。返さないと、条の千鳥が模式図と上下逆に出る。 */
   const yOf = i => -BS().matShift(A, run, i) * TH;
   const face = f => run.map((r, i) => ({ r, i })).filter(({ r }) => f(r)).map(({ r, i }) =>
    ({ x: off((r.from + r.to) / 2), y: yOf(i), z: 0,
       l: Math.max(1, r.to - r.from - 3), r: TH, d: DEP }));
   [[r => r.sg.type === 'strip', sheet], [r => r.sg.type !== 'strip', trim]].forEach(([f, mat]) => {
    const list = face(f);
    cut(list, mat);
    cap(T, g, list.map(q => ({ x: q.x, y: q.y, l: q.l })), TH / 2, 0, mat);
   });
   /* 板の札（§9.413 追補、利用者の指示「2Dの表示のようにラベルもほしい」）。
      模式図と**同じ言葉・同じ側**で出す——条の番号は板が寄った側、耳は「耳」。
      値は模式図と同じ2桁（条幅・耳屑幅は割り付けの計算値）。 */
   /* 札は**軸の外へ出す**。板と軸のあいだは実寸で 60mm 弱しかないので、
      そこへ置くと札が軸に乗って読めない（実際に乗った）。上へ寄った条の札は
      上軸の上・下へ寄った条の札は下軸の下——**寄った側は模式図と同じ**。 */
   /* **部材の外へ出す**（§9.417）。以前は 55 だけ内へ寄せており、値の行が
      いちばん外の部材の縁に乗っていた（区間を光らせると、その上に重なって
      読めなくなる）。器の余白（上下60）のうち 22 だけ残して外へ置く。 */
   const tagY = (box.h || 800) / 2 - 22;
   D3.marks = run.map(({ sg, from, to }, i) => {
    const strip = sg.type === 'strip', up = BS().matShift(A, run, i) < 0;
    return { x: off((from + to) / 2), y: (up ? 1 : -1) * tagY, z: 0,
             kind: strip ? 'strip' : (sg.type === 'scrap' ? 'scrap' : 'trim'),
             text: strip ? String((sg.lotIx | 0) + 1) : (sg.type === 'scrap' ? '屑' : '耳'),
             sub: (+sg.w).toFixed(2) };
   });
   return { IN, OUT };
  }
  /* 入側：1枚の元板 */
  cut([{ x: off((w0 + w1) / 2), y: 0, z: -IN / 2, l: Math.max(1, w1 - w0), r: th, d: IN }], sheet);
  /* 出側：条ごとに分かれ、板厚ぶん上下に食い違う */
  D3.marks = [];
  D3.matMag = 1;
  /* 符号を返すのは断面図と同じ理由（`matShift` は模式図の座標で答える）。 */
  const after = f => run.map((r, i) => ({ r, i })).filter(({ r }) => f(r)).map(({ r, i }) =>
   ({ x: off((r.from + r.to) / 2), y: -BS().matShift(A, run, i) * th, z: OUT / 2,
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
  /* `rig`は`g`の子なので、`g`を空にすると一緒に外れる。**先に中身だけ捨て、
     空になった入れ物を戻す**——作り直すと、伏せている状態の持ち主が入れ替わる。 */
  clear(D3.rig); clear(g); g.add(D3.rig); clear(D3.fix); clear(D3.deck); clear(D3.world);
  D3.decals = [];
  const A = res.A, segs = res.segs, zp = res.zp;
  const L = A.arborLen, M = MACH;
  /* 実寸の中心間距離＝刃径−ラップ。上下の刃は**ラップのぶん食い違って**いて、
     刃先のあいだに隙間は無い（だから板が切れる）。 */
  const cd0 = Math.max(1, ctx.st.knife - ctx.st.ov);
  /* 断面図で見せる範囲（§9.412）。**軸まわりだけ**——機械まわりを伏せるので、
     台座や床まで入れて縮める必要がない。実寸から出すので刃径を変えても崩れない。
     **板より先に決める**（§9.413 追補）——板の厚みの誇張はこの高さから出すので、
     あとから決めると初回だけ誇張が効かない。 */
  const rad0 = ringRadius(ctx);
  const h0 = (cd0 / 2 + rad0) * 2 + 120;
  /* **板は薄すぎて素のままでは1pxも出ない**（§9.413 追補）。板厚 1.3mm に対し
     軸まわりは 1,000mm 級なので、実寸で描くと「板が無い図」になる。模式図が
     `minKnifePx` で刃の厚みに下限を置いているのと同じ考えで、**見える下限まで
     厚みを誇張する**。倍率は画面の左上（`.bs-o3`）が字で言う（§CLAUDE 6）。 */
  const th0 = Math.max(0.2, ctx.st.thick);
  D3.matTh = D3.cut ? Math.max(th0, h0 / 70) : th0;
  D3.matMag = D3.matTh / th0;
  /* **断面図では上下軸を離す**（§9.413 追補、利用者の指示「板がめり込んでいるので
     上下軸を適度な位置まで離して2Dに近い表現を試みて」）。板を見える厚みまで
     太らせると、刃先のあいだに隙間が無いぶん**板が刃へめり込む**。模式図も
     同じ理由で上下を離して板を通している（`FIG.openGap`）ので、ここも刃先の
     あいだに隙間を作る。条は千鳥で板厚ぶん上下へ寄るので、**板が占める高さは
     見かけの厚みの3倍**（±1.5倍）——その両側へ余裕を取る。 */
  D3.endCaps = 0;
  const cd = D3.cut ? ctx.st.knife + D3.matTh * CUT_OPEN : cd0;
  D3.cutGap = D3.cut ? cd - ctx.st.knife : 0;   /* 刃先のあいだに残る隙間 */
  const m = machine(T, g, A, segs, zp, L, cd, ctx.st.tk);
  const ods0 = m.out.ring.filter(q => q.hold.kind === 'ring').map(q => q.hold.od);
  const rad = Math.max(ctx.st.knife, +ctx.M.P.spacerOD || 240, ...(ods0.length ? ods0 : [0])) / 2;
  D3.cutBox = { cx: 0, cy: 0, w: L + 160, h: (cd / 2 + rad) * 2 + 120 };
  /* 区間の的の高さ（§9.417）。**いちばん外まで出ている部材の半径**で取る
     ——模式図の的も部材の高さぶんを覆う（§9.386）。 */
  D3.zr = rad;
  const mt = material(T, g, A, segs, L);
  const st2 = site(T, m.baseL, m.bcx, m.bedTop, m.railTop);
  /* 画面に収まる見はじめの位置。実寸から出すので、アーバー長や刃径を変えても崩れない。
     一度でも視点を動かしたあとは動かさない（見ているところを取り上げない）。 */
  /* OS・DS の札は有効長の両端の真上に置く。台車を回せば札も一緒に回る。 */
  const endY = cd / 2 + rad + (D3.cut ? 90 : 330);
  D3.tag = { os: { x: -(L / 2 + 120), y: endY, z: 0 }, ds: { x: L / 2 + 120, y: endY, z: 0 } };
  D3.bcx = m.bcx;
  D3.carX = D3.out ? -m.bcx : -M.ttX;
  D3.pivot.position.x = M.ttX;
  g.position.x = D3.carX;
  D3.fix.position.x = M.ttX + D3.carX;
  D3.pivot.rotation.y = D3.cut ? 0 : D3.rot;
  applyCut();
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

 /* 断面図の当て方（§9.412）。**部品は作り直さない**——機械まわりを伏せ、
    切断面を入れるだけ。外せばそのまま立体図に戻る。 */
 function applyCut() {
  const on = D3.cut;
  [D3.rig, D3.fix, D3.deck, D3.world].forEach(o => { if (o) o.visible = !on; });
  /* **光は図ごとに配り直す**（§9.415）。部品は作り直さないので、ここで
     強さを入れ替えるだけで両方の図が「その図に合った明るさ」になる。 */
  const L = on ? LIGHT.cut : LIGHT.solid, li = D3.lights;
  if (li) {
   li.hemi.intensity = L.hemi; li.key.intensity = L.key;
   li.fill.intensity = L.fill; li.cam.intensity = L.cam;
  }
  if (D3.cutLight) D3.cutLight.visible = on;
  /* **断面図では台車を回さない。** 回すとX（OS/DSの左右）もZ（切る向き）も一緒に
     入れ替わり、カメラを置く側の入れ替えと**打ち消し合って裏返しが効かない**
     （実際に踏んだ: どちらの向きでもOSが左に出ていた）。裏返しはカメラ側だけで持つ。 */
  if (D3.pivot) D3.pivot.rotation.y = on ? 0 : D3.rot;
  /* 板の札（入側・出側）は立体図のもの。断面図では板そのものを置き換えている。 */
  D3.decals.forEach(m => { m.visible = !on; });
  if (!D3.r) return;
  /* カメラは**残す側の反対**に置く（あいだに物が無い状態にする）。
     図面向き（OS左）なら +Z 側から見て z≦0 を残す。裏返すと両方入れ替わる。 */
  D3.keep = D3.flip ? 1 : -1;
  if (D3.clip) D3.clip.set(new D3.T.Vector3(0, 0, D3.keep), 0);
  D3.r.clippingPlanes = on && D3.clip ? [D3.clip] : [];
 }

 function render() {
  if (!D3.r || !D3.on) return;
  const T = D3.T, cv = D3.cv, w = cv.clientWidth, h = cv.clientHeight;
  if (w < 8 || h < 8) return;
  if (cv.width !== Math.round(w * D3.r.getPixelRatio()) || D3.w !== w || D3.h !== h) {
   D3.r.setSize(w, h, false); D3.cam.aspect = w / h; D3.cam.updateProjectionMatrix();
   D3.w = w; D3.h = h;
  }
  /* ---- 断面図（§9.412）。平行投影で真横から見る ---- */
  if (D3.cut) {
   const b = D3.cutBox || { cx: 0, cy: 0, w: 2000, h: 1000 };
   const oc = D3.ocam, ar = w / h, pad = 1.06;
   let vw = b.w * pad, vh = b.h * pad;
   if (vw / vh < ar) vw = vh * ar; else vh = vw / ar;   /* 収まる側に合わせる */
   oc.left = -vw / 2; oc.right = vw / 2; oc.top = vh / 2; oc.bottom = -vh / 2;
   oc.near = 1; oc.far = 60000; oc.updateProjectionMatrix();
   const px = D3.pivot ? D3.pivot.position.x : 0;
   /* 台車の走行ぶんを足した、軸の中心の真正面。台車を回していても断面は動かさない。 */
   const cx = px + (D3.g ? D3.g.position.x : 0) + b.cx;
   /* **起点は板幅の中心**（§9.413 追補）。`b.cx` は有効長の中央なので、
      そこを見たまま左右・上下へ回る。切る面は世界に固定したままなので、
      回しても切り口そのものは動かない。 */
   const sg = D3.flip ? -1 : 1, ce = Math.cos(D3.cutEl), R = 12000;
   oc.position.set(cx + sg * R * ce * Math.sin(D3.cutAz),
                   b.cy + R * Math.sin(D3.cutEl),
                   sg * R * ce * Math.cos(D3.cutAz));
   oc.up.set(0, 1, 0);
   oc.lookAt(cx, b.cy, 0);
   /* **見ている側から当てる。光もカメラと一緒に動かす**（§9.413 追補、利用者の
      指摘「中空の物はないはずなので断面図注意して」）。視点を回せるように
      したのに光を止めていたので、回した先の面——軸や青い印の**端の丸**——に
      光が1つも当たらず真っ黒になり、**穴が開いているように見えていた**
      （真横から見ている間は端の丸が見えないので気づかなかった）。
      少し上・左へずらすのは変えない。切り口が真っ平らに潰れないようにするため。 */
   if (D3.cutLight) {
    D3.cutLight.position.set(oc.position.x - 900, oc.position.y + 1400, oc.position.z);
   }
   D3.r.render(D3.sc, oc);
   tags(w, h, oc);
   return;
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

 /* 板の札（§9.413 追補）。数が材料の並びで変わるので**要るだけ作って使い回す**
    ——毎回作り直すと、回しているあいだ DOM を作り続けることになる。 */
 function markEls(n) {
  const host3 = host;
  if (!host3) return [];
  let pool = D3.markEls || (D3.markEls = []);
  while (pool.length < n) {
   const el = document.createElement('span');
   el.className = 'bs-t3 bs-t3-mk';
   el.hidden = true;
   host3.appendChild(el);
   pool.push(el);
  }
  pool.forEach((el, i) => { if (i >= n) el.hidden = true; });
  return pool;
 }
 /* 区間の的と記号（§9.417、利用者の指示「断面3Dの強調は2Dと同じ、表との
    リンクで、クリックによる拡大表示も同じように欲しい」）。
    **模式図と同じ名札を名乗る**——`data-badge` を持てば重ねたときの連動
    （`paintBadgePick`）が、`.bs-bhit` を名乗れば押したときの拡大図
    （`openZoneZoom`）が、どちらも**模式図の配線のまま**効く。図ごとに
    connect し直さない（§9.352 の登録表と同じ考え）。
    的は2枚に分ける——**区間ぜんたいの板は「光る」だけ**（`pointer-events:none`）、
    **押せるのは記号の札だけ**。区間ぜんたいを押せる的にすると、立体の上では
    掴んで回す道をふさぐ（模式図には回す操作が無いので、あちらは区間ぜんたいで
    受けてよい・§9.386）。 */
 function zoneEls(n) {
  const host3 = host;
  if (!host3) return [];
  const pool = D3.zoneEls || (D3.zoneEls = []);
  while (pool.length < n) {
   const box = document.createElement('div');
   box.className = 'bs-t3z';
   const chip = document.createElement('span');
   chip.className = 'bs-t3b bs-bhit';
   box.hidden = true; chip.hidden = true;
   host3.appendChild(box); host3.appendChild(chip);
   pool.push({ box, chip });
  }
  pool.forEach((q, i) => { if (i >= n) { q.box.hidden = true; q.chip.hidden = true; } });
  return pool;
 }
 /* 札（OS・DS・板）を、立体の点の見えている位置へ置く。台車を回しても付いてくる。 */
 const TAG_KEYS = ['os', 'ds'];
 function tags(w, h, camOverride) {
  const T = D3.T, t = D3.tag;
  if (!t) return;
  const v = new T.Vector3();
  D3.pivot.updateMatrixWorld(true);
  const at = {}, put = [];
  const cam = camOverride || D3.cam;
  TAG_KEYS.forEach(key => {
   const el = $h('.bs-t3-' + key), p = t[key];
   if (!el) return;
   if (!p) { el.hidden = true; return; }
   v.set(p.x, p.y, p.z).applyMatrix4(D3.g.matrixWorld).project(cam);
   const on = v.z > -1 && v.z < 1;
   el.hidden = !on;
   if (!on) return;
   at[key] = v.x;
   put.push({ el, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h,
              w: el.offsetWidth || 60, h: el.offsetHeight || 20 });
  });
  const marks = D3.cut ? (D3.marks || []) : [];
  const pool = markEls(marks.length);
  marks.forEach((q, i) => {
   const el = pool[i];
   if (!el) return;
   v.set(q.x, q.y, q.z).applyMatrix4(D3.g.matrixWorld).project(cam);
   const on = v.z > -1 && v.z < 1;
   el.hidden = !on;
   if (!on) return;
   const want = `<b>${esc(q.text)}</b><small>${esc(q.sub)}</small>`;
   if (el.dataset.k !== want) { el.innerHTML = want; el.dataset.k = want; }
   el.className = 'bs-t3 bs-t3-mk is-' + q.kind;
   put.push({ el, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h,
              w: el.offsetWidth || 44, h: el.offsetHeight || 26 });
  });
  zones(w, h, cam, v);
  place(put, w, h);
  sides(at);
 }
 /* 区間の的と記号を、いまの見え方へ置く（§9.417）。断面図のときだけ出す——
    立体図では機械まわりが手前に来るので、区間の上に札を置いても「何の上に
    乗っているのか」が読めない。 */
 function zones(w, h, cam, v) {
  const zs = D3.cut ? (D3.zmarks || []) : [];
  const pool = zoneEls(zs.length);
  if (!zs.length) { badgeSig(''); return; }
  const zr = D3.zr || 200;
  const boxes = zs.map(q => {
   /* 区間の四隅（軸方向の両端 × 部材のいちばん外）を写して、囲む箱を取る。
      断面図は回せるので、**箱は軸に平行とはかぎらない**——四隅から作る。 */
   let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, on = false;
   [[q.x0, q.y - zr], [q.x1, q.y - zr], [q.x0, q.y + zr], [q.x1, q.y + zr]].forEach(([X, Y]) => {
    v.set(X, Y, 0).applyMatrix4(D3.g.matrixWorld).project(cam);
    if (v.z > -1 && v.z < 1) on = true;
    const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
   });
   return { on, x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  });
  /* 字の大きさは**いちばん狭い区間**に合わせる（模式図と同じ考え・§9.413）。
     区間ごとに変えると、同じ記号が場所によって別の大きさで出る。
     読めない大きさまでは落とさない（下限9px）。 */
  const len = Math.max(1, ...zs.map(q => q.badge.length));
  const narrow = Math.min(...boxes.filter(b => b.on).map(b => b.w));
  const fs = Math.max(9, Math.min(13,
    Number.isFinite(narrow) ? (narrow - 4) / (0.72 * len + 0.7) : 13));
  zs.forEach((q, i) => {
   const b = boxes[i], el = pool[i];
   if (!el) return;
   el.box.hidden = !b.on; el.chip.hidden = !b.on;
   if (!b.on) return;
   if (el.box.dataset.badge !== q.badge) {
    el.box.dataset.badge = q.badge;
    el.chip.dataset.badge = q.badge;
    el.chip.textContent = q.badge;
   }
   el.box.style.cssText =
     `left:${b.x.toFixed(1)}px;top:${b.y.toFixed(1)}px;`
   + `width:${b.w.toFixed(1)}px;height:${b.h.toFixed(1)}px`;
   el.chip.style.cssText =
     `left:${(b.x + b.w / 2).toFixed(1)}px;top:${(b.y + b.h / 2).toFixed(1)}px;`
   + `font-size:${fs.toFixed(1)}px`;
  });
  badgeSig(zs.map(q => q.badge).join('/'));
 }
 /* 記号の顔ぶれが変わったときだけ画面へ知らせる（**毎フレームではない**）。
    知らせる相手は `paintBadgePick()` で、器ぜんたいを走査するので、
    回しているあいだ毎フレーム呼ぶと図が重くなる。 */
 function badgeSig(sig) {
  if (D3.bsig === sig) return;
  D3.bsig = sig;
  if (onBadges) onBadges();
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
  /* **誇張したら倍率を書く**（§CLAUDE 6 出どころ・単位・根拠を画面に出す）。
     板厚は実寸だと1pxも出ないので断面図でだけ太らせている（§9.413 追補）。 */
  const mag = D3.cut && D3.matMag > 1.05 && ctx
   ? `<s>／板厚</s><i>${(+ctx.st.thick).toFixed(1)}</i>`
     + `<s>は図では約${Math.round(D3.matMag)}倍。上下軸はそのぶん離しています</s>`
   : '';
  el.innerHTML = `<s>画面左</s>${nm(l)}<s>／</s><s>右</s>${nm(r)}${mag}`;
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
  /* **裏返しは断面図でも要る**が、断面図は台車を回さない（回すと切断面まで
     回ってしまう）。どちら向きで見るかだけを覚え、カメラを置く側で入れ替える。 */
  D3.flip = Math.abs(to) > 1e-3;
  if (D3.cut) { D3.rot = to; applyCut(); render(); return; }
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
  onBadges = (opts && opts.onBadges) || null;
  host.addEventListener('click', e => {
   const b = e.target.closest('button');
   if (!b) return;
   if (b.classList.contains('bs-step3-pull')) return act('pull', () => travel(!D3.out));
   if (b.classList.contains('bs-step3-open')) return act('open', toggleOpen);
   if (b.classList.contains('bs-step3-spin')) return act('spin', () => {
    if (onSpinDone) onSpinDone();    /* 向きの切替は画面が持つ（模式図と同じ1つの状態） */
   });
   if (b.classList.contains('bs-step3-reset')) {
    /* 断面図では**断面図の角度**を戻す（立体図の視点は別に持っている）。 */
    D3.cutAz = 0; D3.cutEl = 0;
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
  /* **器の大きさが変わったら描き直す**（§9.415）。`resize`は窓の大きさしか
     見ていないので、**図を切り替えて器の幅・高さが変わった**ときは呼ばれない
     ——描き終えたあとに器が動くと、前の大きさのまま引き伸ばされた絵が残る
     （切り替えた瞬間に断面図に見えない、の芽）。器そのものを見張る。 */
  if (window.ResizeObserver) {
   const ro = new ResizeObserver(() => { if (D3.on) render(); });
   try { ro.observe(host); } catch (err) {
    WL.quiet.note('器の大きさを見張れない（窓の大きさの変化だけで描き直す）', err);
   }
  }
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
 /* 模式図／断面図／立体図の切り替え。**立体を使う図に切り替えたときだけ**
    部品を取りに行く。断面図と立体図は**同じ模型**なので、行き来しても
    組み直さない（伏せる物と視点が変わるだけ・§9.412）。 */
 async function setMode(on, kind) {
  const wantCut = kind === 'cut';
  const changed = D3.cut !== wantCut;
  D3.cut = wantCut;
  D3.on = !!on;
  /* **図を離れるときも状態をそろえる**（§9.415）。以前はここで戻っていたので、
     模式図へ移ったあとも**切断面と断面図の光が場面に残った**まま`D3.cut`だけ
     false になり、次に何かが描いた1枚が「断面図でも立体図でもない絵」になり得た
     （切り替えた瞬間に断面図に見えない、の芽）。伏せる前に1回そろえる。 */
  if (!D3.on) { applyCut(); return true; }
  clearFail();
  if (!window.THREE) {
   note('立体図の部品を読み込んでいます…');
   const ok = await loadLibrary();
   note('');
   if (!ok) {
    fail('立体図を表示する部品（three.js）を読み込めませんでした。<br>'
       + `取りに行った先: ${esc(THREE_SRC)}<br><b>模式図はそのまま使えます。</b>`);
    return false;
   }
  }
  if (!init()) return false;
  /* 切り口の面は**断面図のときだけ**作るので、行き来したら組み直す。 */
  if (D3.dirty || changed) build(); else { applyCut(); render(); }
  return true;
 }

 /* いまどの図を、どちら向きで、どちら側を残して見ているか。**答えるのはここ1箇所**
    ——画面（`blade-view.js`）は器の出し入れだけを持ち、模型の状態は持たない。 */
 /* いま画に出ている部材のうち、**いちばん光るもの**の `metalness`（§9.415）。
    断面図は艶を落としてあるはずなので、1つでも磨いたままなら**その面だけ
    白く飛ぶ**——網が名指しで見られるように数で答える。機械まわり（`rig`）は
    断面図では伏せてあるので、たどらない。 */
 function gloss() {
  let m = 0;
  const walk = o => {
   if (!o || o === D3.rig || o.visible === false) return;
   if (o.material && o.material.metalness != null) m = Math.max(m, +o.material.metalness || 0);
   (o.children || []).forEach(walk);
  };
  walk(D3.g);
  return +m.toFixed(3);
 }

 function view() {
  return { cut: !!D3.cut, flip: !!D3.flip, keep: D3.keep, gloss: gloss(),
           /* 台車がいま回っているか。断面図では**回さない**のが決まり（§9.412）。 */
           rotY: D3.pivot ? D3.pivot.rotation.y : 0,
           cutAz: D3.cutAz, cutEl: D3.cutEl, marks: (D3.marks || []).length,
           /* 区間の記号の数（§9.417）。模式図と同じ対応表から出しているので、
              模式図の記号の数と一致するはず——網が突き合わせる。 */
           zones: (D3.cut ? (D3.zmarks || []) : []).length,
           /* 断面図で刃先のあいだに空けた隙間と、板が占める高さ（§9.413 追補）。
              **板がめり込まないこと**を網が数字で見るための2つ。 */
           cutGap: D3.cutGap || 0, matSpan: (D3.matTh || 0) * 3, matMag: D3.matMag || 1,
           /* 断面図の光が**カメラと同じ側に居るか**を網が見るための2つ（§9.413 追補）。
              離れると、回した先の面が黒くなって穴に見える。 */
           endCaps: D3.endCaps || 0,
           /* 光の配分（§9.415）。**断面図の配分が立体図のまま残っていないか**を
              網が数で見る——残ると切り口が白へ飛ぶ。 */
           lit: D3.lights ? { hemi: D3.lights.hemi.intensity, key: D3.lights.key.intensity,
                              fill: D3.lights.fill.intensity, cam: D3.lights.cam.intensity }
                          : null,
           cutCam: D3.ocam ? [D3.ocam.position.x, D3.ocam.position.y, D3.ocam.position.z] : null,
           cutLit: D3.cutLight
            ? [D3.cutLight.position.x, D3.cutLight.position.y, D3.cutLight.position.z] : null,
           ortho: !!(D3.cut && D3.ocam), clips: D3.r ? (D3.r.clippingPlanes || []).length : 0 };
 }

 WL.bladeSolid = {
  attach, sync, setMode, render, spinTo, note, blockReason, view,
  get on() { return D3.on; },
  get ready() { return !!D3.r; },
  get show() { return Object.assign({}, D3.show); },
  get stage() { return { out: D3.out, open: D3.open, rot: D3.rot }; },
  THREE_SRC
 };
})();
