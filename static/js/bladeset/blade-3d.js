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
   /* **どの図として組んであるか**（§9.428）。`cut`は「いま選ばれている図」、
      `builtCut`は「いま場面に在る模型がどちらの図のものか」——同じ模型を
      使い回すが**組み方が違う**（切り口の面・板の誇張・機械まわり）ので、
      この2つが食い違ったまま描くと「切り替えたのに前の図」の1枚になる。
      `seq`は切り替えの通し番号。部品の読み込みを待つあいだに別の図を
      押されたとき、**遅れて戻ってきたほうに描かせない**ために持つ。 */
   builtCut:null, builtKeep:null, capZ:null, seq:0, builds:0, fixups:0,
   /* 断面図の視点（§9.413 追補）。**板幅の中心を起点に**左右（`cutAz`）と
      上下（`cutEl`）へ回す。切る面は世界に固定したままなので、回しても
      切り口は動かない——動くのは見る位置だけ。 */
   cutAz:0, cutEl:0, marks:[], zmarks:[], zr:0, dims:[], knives:[],
   /* 断面図の倍率と平行移動（§9.463、利用者の指示「ガイダンスの断面図は拡大縮小も
      できるように」）。`cutZoom`＝器に収まる縮尺の何倍か（1＝全体）。`cutPanX/Y`＝
      画面の右・上へ動かした量（世界の長さ）。`cutView`は最後に描いた縮尺——
      ホイールの下の点を動かさずに寄るため、描いたときの値を控える。 */
   cutZoom:1, cutPanX:0, cutPanY:0, cutView:null,
   spin:false, busy:false, failed:false, decals:[],
   /* 立体図で見せる部材。刃だけを見たいときなど、邪魔なものを消せるようにする。 */
   show:{ mat:true, knife:true, ring:true, liner:true },
   /* 消した部材の**見せ方**（§9.422、利用者の指示）。`gone`＝出さない（今までの
      動き）／`ghost`＝薄く残す／`wire`＝線だけ。消すのは「邪魔だから」であって
      「無いことにしたい」わけではない——薄く残せば、隠れていた刃を見ながら
      **どこにスペーサーが居たか**も同時に読める。 */
   hide:'gone' };

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
 /* フローティングシート（§9.459、利用者の図面・写真）。有効長のDS端の外に載り、
    DS側からOS側へスペーサーの並びを押さえる。**寸法は図面の値そのまま**:
    本体 Φ269／Φ200・幅70（押さえ板5＋ピストンの逃げ2＋本体63）、
    フローティングピストン 等分18-Φ15（シリンダ Φ20）P.C.D230（1本目は真上から10°）、
    加圧装置2か所（中心から左右へ113.5・外周の下寄り、M22 の加圧スクリュウ）。
    押さえ板と逃げの**並び順は図面から読み切れない**（寸法 (2)・5・63 の並び）ので、
    板を押す面（OS側）＝押さえ板5、次にピストンの逃げ2、本体63 の順で組んだ。
    2枚目の図面（14-Φ23 深さ23・P.C.D235）は**どの部品の穴か分からない**ので入れていない。 */
 const FSEAT = {
   od:269, bore:200, plate:5, relief:2, body:63,
   pistonN:18, pistonD:15, pcd:230, pistonA0:10,
   devX:113.5, devR:131.8, devW:24, devT:20, devH:14, devAxial:46, screwD:22
 };
 const FSEAT_W = FSEAT.plate + FSEAT.relief + FSEAT.body;
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
 /* 断面図の倍率の範囲（§9.463）。1＝器に全体が収まる縮尺。上限は細い部材
    （10.025mm の差）を字で読める所まで。1より引かない（全体より小さく見る用が無い）。 */
 const CUT_ZOOM_MAX = 24, CUT_ZOOM_STEP = 1.2;
 /* 倍率を1へ戻したら平行移動も捨てる（全体を見ているのにずれて出さない）。 */
 function setCutZoom(z, px, py) {
  D3.cutZoom = Math.max(1, Math.min(CUT_ZOOM_MAX, z));
  if (D3.cutZoom <= 1 + 1e-6) { D3.cutZoom = 1; D3.cutPanX = 0; D3.cutPanY = 0; }
  else { D3.cutPanX = px; D3.cutPanY = py; }
 }
 /* いまの倍率を「視点」の群に書く（§9.463。状態を画面が言う・探させない）。
    等倍のときは伏せる（何も変えていないのに数を出さない）。 */
 function zoomReadout() {
  const el = $h('.bs-zoom3');
  if (!el) return;
  const z = D3.cut ? (D3.cutZoom || 1) : 1;
  const on = z > 1;
  if (el.hidden === on) el.hidden = !on;
  const t = on ? `×${z.toFixed(z < 10 ? 1 : 0)}` : '';
  if (el.textContent !== t) el.textContent = t;
 }
 /* 画面に出ているか（§9.463）。拡大すると部材の多くが器の外へ出るので、
    奥行きだけでなく**器の内か**も見る——外の札を器の縁へ寄せて出さない。 */
 const inView = v => v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1.02 && Math.abs(v.y) <= 1.02;
 /* 断面図で刃先のあいだに空ける隙間＝見かけの板厚の何倍か（§9.413 追補）。
    板は千鳥で上下へ寄るので**見かけの厚みの3倍**の高さを占める。その両側へ
    ほぼ1枚ぶんずつ余裕を取った値。模式図（`FIG.openGap` に対し板は 10%）ほど
    大きくは開けない——断面図は刃もスペーサーも**実寸の丸のまま**描くので、
    そこだけ極端に開けると図が読めなくなる。 */
 /* **札を貼る場所を作るため 5 → 7 へ広げた**（§9.418、利用者の指示「3D断面
    ラベル貼り付けにくければ、上下軸は少し広げてOKです」）。広げた量は
    図の上の1行が字で言う。 */
 const CUT_OPEN = 7;
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
      **寄る・引くもできる**（§9.463、利用者の指示「断面図は拡大縮小もできるように」。
      §9.413 の「寄る・引くは持たない」は撤回した——細い部材の字は全体の縮尺では
      入らず、拡大図は1区間しか見られない）。平行投影のままなので、倍率を変えても
      画面の中の寸法どうしは同じ縮尺で比べられる。
      平行移動は立体図と同じ手（Shift＋ドラッグ／右・中ドラッグ）。 */
   if (D3.cut) {
    drag = { x: e.clientX, y: e.clientY, cut: true, az: D3.cutAz, el: D3.cutEl,
             pan: e.shiftKey || e.button === 1 || e.button === 2,
             px: D3.cutPanX, py: D3.cutPanY };
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
   if (drag.cut && drag.pan) {
    /* 拡大していないときは動かさない（全体が収まっている図をずらす用が無い）。 */
    const sc = (D3.cutView && D3.cutView.sc) || 0;
    if (D3.cutZoom > 1 && sc > 0) {
     D3.cutPanX = drag.px - dx * sc; D3.cutPanY = drag.py + dy * sc;
     render();
    }
    return;
   }
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
   if (D3.cut) {
    /* 断面図は**マウスの下の点を動かさずに**寄る・引く（§9.463）。 */
    e.preventDefault();
    const cv0 = D3.cutView;
    if (!cv0) return;
    const r = cv.getBoundingClientRect();
    const mx = e.clientX - r.left - cv0.w / 2, my = e.clientY - r.top - cv0.h / 2;
    const u = mx * cv0.sc + D3.cutPanX, y = cv0.off * cv0.sc + D3.cutPanY - my * cv0.sc;
    const z = D3.cutZoom * (e.deltaY > 0 ? 1 / CUT_ZOOM_STEP : CUT_ZOOM_STEP);
    const sc2 = cv0.fit / Math.max(1, Math.min(CUT_ZOOM_MAX, z));
    setCutZoom(z, u - mx * sc2, y - cv0.off * sc2 + my * sc2);
    render();
    return;
   }
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
 /* ---- 消した部材の見せ方（§9.422）------------------------------------
    「表示」で切った部材を**どう出すか**は`D3.hide`の1つが決める。
    ・`gone`  … 描かない（今までの動き）
    ・`ghost` … **同じ色のまま薄く**残す（色を変えると何の部材か読めなくなる）
    ・`wire`  … 輪郭の線だけ
    材質は**元の材質の写し**を隠し方ごとに作る（名前に隠し方が入るので、
    描いた物そのものから「透かして在る」ことを数えられる）。 */
 const HIDE_SPEC = {
  ghost: { transparent: true, opacity: .13, depthWrite: false },
  wire: { wireframe: true, transparent: true, opacity: .38, depthWrite: false }
 };
 /* その部材の材質。切ってあるときは隠し方の写しを返し、`gone`なら`null`。
    **呼ぶ側は「材質が無ければ描かない」の1本で書ける**（`if (sh.liner)`のような
    入切の分岐を部材ごとに増やさない）。 */
 function skin(T, on, key, o) {
  if (on) return matOf(T, key, o);
  const spec = HIDE_SPEC[D3.hide];
  return spec ? matOf(T, key + '~' + D3.hide, Object.assign({}, o, spec)) : null;
 }
 /* その部材を**組み立てるか**。切ってあっても`gone`以外なら組み立てる
    （透かす・線だけにするには、物がそこに無いといけない）。 */
 const drawn = k => !!(D3.show[k] || HIDE_SPEC[D3.hide]);
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
 /* **残す側は「向き」から決まる。控えずに、要るたびに引く**（§9.437、利用者の
    報告「初めて断面図を押すと断面ではない3D表示になる。もう一度押すと直る」）。
    以前は `D3.keep` という控えを `applyCut()` が書いていたが、**読むのは
    `build()` の中**（切り口の面を置く `capRects()`）で、その `applyCut()` は
    `build()` の終わりに呼ばれる——つまり**初回の組み立ては1つ前の値で切り口を
    置いていた**。初期値は `-1`、いまの向き（DS左）の答えは `+1` なので、
    切り口の面だけが**切り落とされる側**（z<0）へ置かれ、**中身の無い殻＝
    立体図と同じ絵**になっていた。2回目は控えが正しくなっているので直る。
    引く関数にすれば、順番に依らず必ず今の向きの答えが返る。 */
 const keepSide = () => (D3.flip ? 1 : -1);
 function capRects(items, ro, ri) {
  const z = keepSide() * (CAP_T / 2 + 0.05), out = [];
  /* **実際に置いた z を控える**（§9.437）。控えの`builtKeep`が正しくても、
     ここが1つ前の値で置いていれば切り口は切り落とされる——網は
     「どちら向きで組んだと言っているか」ではなく**どこへ置いたか**を見る。 */
  D3.capZ = z;
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
 /* 積みが区間長をほんの少し超えることがある（割り付けの丸め）。**そこで最後の
    1枚を落とすと10mm級の穴が開く**ので、刻みぶんの行き過ぎは許す（§9.418）。
    それでも入らないものは落とす——落ちた長さは下の「端数」が受ける。 */
 const PACK_EPS = 0.03;
 function zone(out, from, to, y, parts, floatAt) {
  const expand = BS().expand;
  const pk = D3.pack;
  const all = expand(parts.spacer);
  const want = all.reduce((a, sz) => a + sz, 0);
  /* フローティングシートが区間の**始まりの側**（OS端・§9.461）にあるときは、基準面の側
     （刃の側）へ寄せて積み、残りを始まりの側へ空ける。 */
  const lead = floatAt === 'start' ? Math.max(0, +(to - from - want).toFixed(6)) : 0;
  let at = from + lead;
  /* **1枚も超えてはいけない**ので、許容は浮動小数の誤差ぶんだけ（`PACK_EPS`
     より桁が小さい）。`PACK_EPS` は「図が落とさない」ための許容で、
     「割り付けが正しい」の物差しではない——同じ数を両方に使うと、
     割り付けの丸めの誤りを図の許容が隠す（実際に隠した）。 */
  if (pk && want - (to - from) > 1e-6) {
   pk.over++; pk.worst = Math.max(pk.worst, +(want - (to - from)).toFixed(4));
  }
  for (const sz of all) {
   if (at + sz > to + PACK_EPS) { if (pk) pk.drop++; break; }
   out.liner.push({ x: at + sz / 2, y, sz });
   at += sz;
  }
  /* **端数は端数として描く**（模式図の `fillZone` と同じ・§9.418）。空けたままに
     すると「軸に何も載っていない区間」に見えるが、実際は割り付けで埋め切れ
     なかったぶんで、別の色で置くのが模式図の作法。 */
  /* **フローティングシートの側の端の残りは端数ではない**（§9.457）——押さえる量なので、
     端数の色で塞がず、端数の数にも入れない（`pack.float`へ別に控える）。 */
  if (floatAt) {
   const r = floatAt === 'start' ? lead : to - at;
   if (r > 0.01 && pk) pk.float = Math.max(pk.float || 0, +r.toFixed(3));
  } else if (to - at > 0.01) {
   out.liner.push({ x: (at + to) / 2, y, sz: to - at, filler: true });
   if (pk) { pk.filler++; pk.fillerMm = +(pk.fillerMm + (to - at)).toFixed(3); }
  }
  if (!parts.hold) return;
  /* 保持層（ゴムリング／フィンガー）は刻みしかないので区間にぴったり合うとは
     かぎらない。余りは左右へ均等に振り分け、列を区間の中央に置く（模式図と同じ）。 */
  const pieces = expand(parts.gom);
  const run = pieces.reduce((a, sz) => a + sz, 0);
  /* **潤滑リング**（§9.454）は刃の内側の両端。ゴムリングはそのあいだ
     （模式図の`holdLayer()`と同じ置き方）。 */
  let a0 = from, b0 = to;
  if (parts.lube) {
   const w = parts.lube.w;
   out.lube.push({ x: from + w / 2, y, sz: w, lube: parts.lube },
                 { x: to - w / 2, y, sz: w, lube: parts.lube });
   a0 = from + w; b0 = to - w;
  }
  at = a0 + Math.max(0, (b0 - a0 - run)) / 2;
  for (const sz of pieces) {
   if (at + sz > b0 + PACK_EPS) break;
   out.ring.push({ x: at + sz / 2, y, sz, hold: parts.hold });
   at += sz;
  }
 }

 /* 機械の骨組み。図面 SL-1458-01S・03SA に合わせる。
    ・台車は軸方向に走る2本のレールの上を車輪で走る（車輪の軸は送りの向き）
    ・引き出した先の回転テーブルの上で、台車の寸法の中心を軸に半回転する
    ・軸端部（DS 端スタンド）は 330 送り出すとテーブルの外の着地土台に降りるので、
      そこに残ったまま本体だけが回る */
 /* フローティングシートの置かれる端（§9.461）。**基準面の反対**——既定はDS基準なのでOS端。
    座標は有効長の中心が0なので、OS端は−・DS端は＋。 */
 const floatSign = () => {
  const f = ctx && ctx.res && ctx.res.fit && ctx.res.fit.floatSeat;
  return f && f.side === 'DS' ? 1 : -1;
 };
 /* フローティングシート（§9.459）。**軸の上の部品**なので`g`へ置き（断面図にも出る）、
    切り口の面も置く。押さえ板の面は**その軸の端の残り**（`fit.floatSeat`＝押さえている量）
    だけ有効長の内側へ出る——ピストンがそのぶん伸びている。置く端は`floatSign()`。 */
 function floatSeat(T, g, L, yU, yL) {
  const F = FSEAT, ro = F.od / 2, ri = F.bore / 2;
  const fit = (ctx && ctx.res && ctx.res.fit && ctx.res.fit.floatSeat) || {};
  const sg = floatSign(), E = sg * L / 2;           /* 有効長の端（シートの側） */
  const out = v => E + sg * v;                      /* 端から外へ v の位置 */
  const body = matOf(T, 'fseat', { color: cutColor('--bs-fig-fseat', '#8d97a1'),
                                   metalness: .66, roughness: .30 });
  const pin = matOf(T, 'fseatPin', { color: cutColor('--bs-fig-fseat-pin', '#c9d0d6'),
                                     metalness: .78, roughness: .20 });
  const hole = matOf(T, 'fseatHole', { color: '#2b323a', metalness: .30, roughness: .70 });
  const grp = new T.Group(); grp.userData.fseat = true; g.add(grp);
  /* **軸はシートの中を通っている**（内径Φ200＝軸径）。有効長の外の軸は機械まわり
     （`rig`）なので断面図では伏せており、シートの穴が空洞に見えた——ここだけ
     シートの幅ぶん軸を足す。 */
  const shaftM = matOf(T, 'steel', { color: cutColor('--bs-fig-shaft', '#b9c1c9'),
                                     metalness: .74, roughness: .22 });
  const through = [yU, yL].map(y => ({ x: out(FSEAT_W / 2), y, l: FSEAT_W, r: ri }));
  const sm = batch(T, D3.cyl, shaftM, through);
  if (sm) grp.add(sm);
  cap(T, grp, through, ri, 0, shaftM);
  const pistons = [], seen = [];
  [[yU, +fit.up || 0], [yL, +fit.lo || 0]].forEach(([y, take]) => {
   const face = out(-take);                         /* 押さえ板の、スペーサーに当たる面 */
   const plate = { x: face + sg * F.plate / 2, y, l: F.plate };
   const gap = { x: (face + sg * F.plate + out(F.plate + F.relief)) / 2, l: F.relief + take };
   const bodyQ = { x: out(F.plate + F.relief + F.body / 2), y, l: F.body };
   [plate, bodyQ].forEach(q => {
    const m = new T.Mesh(tubeGeo(T, ro, ri), body);
    m.position.set(q.x, y, 0); m.scale.set(q.l, 1, 1); grp.add(m);
   });
   cap(T, grp, [plate, bodyQ], ro, ri, body);
   /* ピストン18本（逃げの中で押さえ板と本体をつなぐ）。 */
   for (let i = 0; i < F.pistonN; i++) {
    const a = (F.pistonA0 + i * 360 / F.pistonN) * Math.PI / 180;
    pistons.push({ x: gap.x, y: y + Math.cos(a) * F.pcd / 2, z: Math.sin(a) * F.pcd / 2,
                   l: gap.l, r: F.pistonD / 2 });
   }
   /* 切り口に当たるピストン（真上・真下の2本）は面も置く。 */
   cap(T, grp, [{ x: gap.x, y: y + F.pcd / 2, l: gap.l }, { x: gap.x, y: y - F.pcd / 2, l: gap.l }],
       F.pistonD / 2, 0, pin);
   /* 加圧装置2か所: 外周の窓と、その奥の加圧スクリュウ（M22）。立体図で見える物。 */
   [-1, 1].forEach(sgn => {
    const ang = Math.atan2(-67, sgn * F.devX);     /* 正面図の位置（左右113.5・下へ67） */
    const ax = out(F.devAxial);
    const win = new T.Mesh(D3.box, hole);
    win.position.set(ax, y + Math.sin(ang) * (F.devR - F.devH / 2 + 3), Math.cos(ang) * (F.devR - F.devH / 2 + 3));
    win.rotation.set(-ang + Math.PI / 2, 0, 0);
    win.scale.set(F.devW, F.devH, F.devT);
    grp.add(win);
    const sc = new T.Mesh(D3.cyl, pin);
    sc.position.set(ax, y + Math.sin(ang) * (F.devR - F.devH), Math.cos(ang) * (F.devR - F.devH));
    /* 筒の形は X 向きに作ってあるので、X を半径の向きへ回す。 */
    sc.quaternion.setFromUnitVectors(new T.Vector3(1, 0, 0),
                                     new T.Vector3(0, Math.sin(ang), Math.cos(ang)));
    sc.scale.set(8, F.screwD / 2, F.screwD / 2);
    grp.add(sc);
   });
   seen.push({ y, face, take });
  });
  const pm = batch(T, D3.cyl, pin, pistons);
  if (pm) grp.add(pm);
  D3.fseat = { n: seen.length, pistons: pistons.length, w: FSEAT_W, od: F.od,
               side: sg > 0 ? 'DS' : 'OS',
               faces: seen.map(q => +q.face.toFixed(3)), take: seen.map(q => q.take) };
 }

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
  const gFace = osEnd - M.gapOS - (floatSign() < 0 ? FSEAT_W + 22 + M.brgW : 0), gx = gFace - M.gearW / 2;
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
  /* **既定の行き先は`rig`**（この関数の頭に書いてあるとおり）。ここだけ`g`に
     なっており、`o`を渡さないOS側の軸受だけが**断面図に残っていた**
     （§9.418、利用者の指摘「OS側のエンドの青オブジェクトの上下軸の外々に線が
     付着している」）。切り口の面を持たない筒なので、塗りは出ず**輪郭の1本だけ**
     が線として残る——「何の線か分からない線」になっていた。 */
  const bearing = (x, o) => [yU, yL].forEach(y => {
   put(o || rig, D3.cyl, dark, [{ x, y, l: M.brgW, r: M.brgD / 2 }]);
   tube(x - M.brgW / 2 - 11, y, 22, M.brgD / 2 * 1.34, sd / 2 + 6, blueD, o);
   tube(x + M.brgW / 2 + 11, y, 22, M.brgD / 2 * 1.34, sd / 2 + 6, blueD, o);
   bolts(x - M.brgW / 2 - 11, M.brgD / 2 * 1.12, 6, 13, 34, o);
   bolts(x + M.brgW / 2 + 11, M.brgD / 2 * 1.12, 6, 13, 34, o);
   put(o || rig, D3.cyl, steelD, [{ x, y: y + M.brgD / 2 * 0.9, z: 0, l: 30, r: 20 }]);
  });

  /* ---- 軸端部（DS 端スタンド）。330 送り出すと着地土台に降りる ---- */
  const trv = D3.open ? M.travel : 0;
  /* シートの側の軸受はフローティングシート（幅70・§9.459）の外へ置く。以前は有効長の端から
     10mm内側まで被っており、そこに載るフローティングシートを隠していた。 */
  const seatDS = floatSign() > 0, seatOS = !seatDS;
  const bxDS = (seatDS ? dsEnd + FSEAT_W + 22 + M.brgW / 2 + 4 : dsEnd + M.gapDS / 2) + trv;
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
  /* OS端にシートが載るとき（DS基準・§9.461）は、軸受もギヤボックスもシートの幅ぶん外。
     **この寸法は図面に無い**（図面SL-1458-01SのOS側の間隔30はシートの無い形）ので概寸。 */
  bearing(osEnd - M.gapOS / 2 - (seatOS ? FSEAT_W + 22 + M.brgW / 2 : 0));

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
   /* **シートの側はフローティングシートそのものを描く**（§9.459、利用者の指示「上下軸の
      DSエンドを青のオブジェクトではなくフローティングシートを図面から3Dで再現」）。
      青い印が残るのは基準面の側だけ（§9.461。既定はDS基準なのでDS端）。 */
   const ends = [yU, yL].map(y => ({ x: -floatSign() * (L / 2 + capL / 2), y, l: capL, r: cr }));
   D3.endCaps = ends.length;
   cy(ends, capM, g);
   cap(T, g, ends.map(q => ({ x: q.x, y: q.y, l: q.l })), cr, 0, capM);
  }
  floatSeat(T, g, L, yU, yL);
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
  /* 詰めの事実（§9.418）。**割り付けが区間より長くないか**・**図が部材を
     落としていないか**・**端数がどれだけ残ったか**を数で残す。落ちた1枚は
     10mm級の穴になるので、絵ではなく数で見張る。 */
  D3.pack = { over: 0, worst: 0, drop: 0, filler: 0, fillerMm: 0,
              x0: 0, x1: 0, arbor: L };
  const out = { liner: [], ring: [], lube: [], knife: [] };
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
    zone(out, a, b, y, zp.zones[k][side],
         k === A.floatZ ? (k === 0 ? 'start' : 'end') : '');
    const r = (k > 0 && k < spans.length - 1) ? bmap[side][k] : null;
    /* **どちらの軸かも持って帰る**（§9.442）——記号の札は押すと拡大図が開く
       ので、軸を渡さないと下軸を押しても上軸の図が出る（模式図と同じ作法）。 */
    if (r) zmk.push({ badge: String(r.badge), x0: off(a), x1: off(b), y, up: !!upper,
                      tone: Number.isInteger(r.tone) ? r.tone : null });
   });
   pos.forEach(x => out.knife.push({ x, y }));
  });
  D3.zmarks = zmk;
  const fr = frame(T, g, L, yU, yL);
  const sd = +ctx.M.P.shaftDia || 200, bore = sd / 2;
  const sh = D3.show;
  /* 材質は**隠し方まで込みで**受け取る（§9.422）。切ってあれば薄い写し・
     `gone`なら`null`が返るので、以下は「材質が無ければ描かない」だけで書ける。 */
  const blade = skin(T, sh.knife, 'blade', { color: '#3f4854', metalness: .78, roughness: .16 });
  const liner = skin(T, sh.liner, 'liner',
    { color: cutColor('--bs-fig-spacer', '#a8b2bd'), metalness: .38, roughness: .46 });
  const edge = skin(T, sh.liner, 'linerEdge',
    { color: cutColor('--bs-fig-spacer-edge', '#5d6975'), metalness: .42, roughness: .55 });
  /* 部材は図面どおり内径の開いた輪。軸が通って見えるので、そのまま管で描く。
     スペーサーは1枚ずつの区切りが分かるよう、外周だけ細い帯を濃い色で重ねる。 */
  const put = (list, ro, ri, mat) => {
   const items = list.map(q => ({ x: off(q.x), y: q.y, l: q.len, r: 1, d: 1 }));
   const m = batch(T, tubeGeo(T, ro, ri), mat, items);
   if (m) g.add(m);
   cap(T, g, items, ro, ri, mat);      /* 断面図のときだけ切り口を置く（§9.412） */
  };
  const linerR = (+ctx.M.P.spacerOD || 240) / 2;
  const ringBore = (+ctx.M.P.ringBore || 241) / 2;
  if (liner) {
   const real = out.liner.filter(q => !q.filler);
   const ls = real.map(q => ({ x: q.x, y: q.y, len: q.sz - 0.8 }));
   put(ls, linerR, bore, liner);
   put(ls, linerR, linerR - 1.2, edge);     /* 外周の細い帯で1枚ずつの区切りを見せる */
   /* 端数（模式図と同じ色）。**部材ではない**ので、幅の字も出さない。 */
   const pad = out.liner.filter(q => q.filler).map(q => ({ x: q.x, y: q.y, len: q.sz }));
   if (pad.length) {
    put(pad, linerR, bore, skin(T, sh.liner, 'filler',
      { color: cutColor('--bs-fig-filler', '#dfe4ea'), metalness: .3, roughness: .6 }));
   }
  }
  if (drawn('ring')) {
   /* 保持層は**ゴムリングでもフィンガーでも同じ層**（§9.377）。色はゴムリングだけ
      マスタの値で、フィンガーは1色（布入ベークライトの茶）。
      **模式図と同じトークンから引く**（§9.441、利用者の指示「フィンガーの色は
      ベークライトの一般的な茶色ベースにしてほしい」）——以前はここだけ
      `#6f7d8c` という灰青のリテラルで、**スペーサーと見分けが付かず**、
      模式図の茶（`--bs-fig-finger`）とも食い違っていた（色リテラルを
      増やさない・§9.350／色は1箇所が答える・§CLAUDE 8）。 */
   groupBy(out.ring, q => (q.hold.kind === 'ring' ? 'r' + q.hold.od : 'f')).forEach((list, key) => {
    const isRing = key.charAt(0) === 'r';
    const od = isRing ? +key.slice(1) : linerR * 2 + 20;
    const color = isRing ? (ctx.ringHex(od) || '#8d97a6')
                         : cssColor('--bs-fig-finger', '#7a5232');
    put(list.map(q => ({ x: q.x, y: q.y, len: q.sz - 1.0 })), od / 2,
        isRing ? ringBore : linerR,
        skin(T, sh.ring, 'hold' + key, { color, metalness: .02, roughness: .9 }));
   });
   /* 潤滑リング（§9.454）。ゴムリングと同じ材質で、径と色だけが違う。
      色は模式図と同じトークン（紫）——ゴムリングの10色にもスペーサーの灰にも無い。 */
   if (out.lube.length) {
    const L0 = out.lube[0].lube;
    /* 色はマスタの行（画面の色）で変わり得るので、**色を材質の名前に含める**
       （材質は名前で使い回すので、同じ名前だと前の色が残る）。 */
    const lc = cssColor('--bs-fig-lube', '#7150c4');
    put(out.lube.map(q => ({ x: q.x, y: q.y, len: q.sz - 1.0 })), L0.od / 2, L0.bore / 2,
        skin(T, sh.ring, 'lube' + lc, { color: lc, metalness: .02, roughness: .9 }));
   }
  }
  if (blade) put(out.knife.map(q => ({ x: q.x, y: q.y, len: tk })), ctx.st.knife / 2, bore, blade);
  /* **端から端が有効長を超えていないか**（§9.418 追補、利用者の指示「有効長より
     エンドtoエンドが長くなっていないか確認してほしい。この有効長を基準に描画する
     必要があります」）。区間の和＋刃の厚みは作りのうえで有効長ちょうどになるが、
     **図が実際に置いた物**で見る——置き方（端数・丸め）を間違えれば、計算が
     合っていても絵は溢れる。 */
  {
   const e = [];
   out.liner.forEach(q => e.push(q.x - q.sz / 2, q.x + q.sz / 2));
   out.ring.forEach(q => e.push(q.x - q.sz / 2, q.x + q.sz / 2));
   out.lube.forEach(q => e.push(q.x - q.sz / 2, q.x + q.sz / 2));
   out.knife.forEach(q => e.push(q.x - tk / 2, q.x + tk / 2));
   if (e.length) {
    D3.pack.x0 = +Math.min(...e).toFixed(3);
    D3.pack.x1 = +Math.max(...e).toFixed(3);
   }
   /* **上下それぞれの「組んだときの合計長」**（§9.418 追補、利用者の指示
      「設定有効長と、スペーサーを組んだときの上下のそれぞれの合計長を表示して
      ほしい」）。軸の寸法を作るのは**スペーサーと刃**だけ（保持層は軸方向の
      寸法に効かない・§9.377）ので、その2つだけを足す。上下で違う値になるのは
      クリアランスのぶん（同じ切断で上下の刃が軸方向にずれる）。 */
   const sum = up => +(out.liner.filter(q => (q.y > 0) === up && !q.filler)
                        .reduce((a, q) => a + q.sz, 0)
                     + out.knife.filter(q => (q.y > 0) === up).length * tk).toFixed(3);
   D3.pack.sumU = sum(true);
   D3.pack.sumL = sum(false);
  }
  /* 寸法の層が使う控え（§9.418）。**描いた物そのもの**から作るので、
     図に出ていない部材の字が出ることはない。 */
  D3.dims = [];
  /* **字の段を部材ごとに分ける**（§9.418 追補、利用者の指摘「ゴムリングと
     スペーサーの表示がごちゃ混ぜになっていてわかりにくい」。§9.418 の
     「スペーサーの字は軸に書かない」は**利用者の指示で撤回した**）。
     スペーサーの帯（軸のすぐ外・実寸20mm）とゴムリングの帯は縦に隣り合って
     いるので、どちらもその帯の中へ書くと**2段の数字が並んで見分けが付かない**。
     ・ゴムリング幅 … **ゴムリングの帯の中**（現物の上）
     ・スペーサー幅 … **軸の上**、ただし**そのスペーサーの側へ寄せて**書く
     引き出し線は**その部材の縁から**引く（`r` は縁の半径。字の位置 `labY` とは
     別に持つ）——線が宙に浮くと、どれを指しているのか読めない。 */
  /* **同じ寸法が続くぶんは「×枚数」で1つにまとめる**（§9.420、利用者の指示
     「複数枚の場合、×枚数とかで、スペースを有効活用しながらわかりやすく」）。
     `100` を4つ並べるより `100×4` の1つのほうが、場所も要らず「4枚要る」と
     いう事実もそのまま読める。まとめるのは**隣り合って・同じ軸で・同じ寸法**の
     ものだけ（離れた同寸法をまとめると、どこの話か分からなくなる）。 */
  const runs = (list, key) => {
   const out2 = [];
   list.forEach(q => {
    const last = out2[out2.length - 1];
    if (last && last.y === q.y && last.sz === q.sz && key(last) === key(q)
     && Math.abs(last.x1 - (q.x - q.sz / 2)) < 0.02) {
     last.x1 = q.x + q.sz / 2; last.n++;
     return;
    }
    out2.push({ y: q.y, sz: q.sz, n: 1, x0: q.x - q.sz / 2, x1: q.x + q.sz / 2, src: q });
   });
   return out2.map(r => Object.assign(r, { x: (r.x0 + r.x1) / 2, w: r.x1 - r.x0 }));
  };
  if (sh.liner) runs(out.liner.filter(q => !q.filler), () => 'sp').forEach(q => {
   const sg = Math.sign(q.y);
   D3.dims.push({ x: off(q.x), y: q.y, w: q.w, mm: q.sz, n: q.n,
                  ri: bore, r: linerR, kind: 'sp',
                  /* 字は**軸の上・そのスペーサーの側**へ、記号（A・B…）から
                     離して置く（§9.420、利用者の指摘「アルファベットに干渉」）。
                     記号は軸の中心なので、**軸の外寄り 3/4 より外**を使う。 */
                  labY: q.y + sg * bore * 0.90, band: bore * 0.36,
                  /* **軸の中に3段**（§9.429、利用者の指示「スペーサー内に表示
                     したり、軸内3段にするなど、重ならないように工夫して」）。
                     使えるのは「記号（A・B…）の外側」から「軸の縁」まで。
                     中へ書くぶんは縁のすぐ内（0.90）、引き出しはその内側へ
                     3段（0.70／0.50／0.30）。以前は1段しか無く、**実測217件中
                     95件（44%）を黙って落としていた**。 */
                  leadYs: [0.70, 0.50, 0.30].map(f => q.y + sg * bore * f),
                  leadTo: q.y + sg * bore });
  });
  if (sh.ring) runs(out.ring, q => (q.src || q).hold.kind + '|'
                                 + ((q.src || q).hold.od || '')).forEach(q => {
   const sg = Math.sign(q.y), hold = q.src.hold;
   const ri = hold.kind === 'ring' ? ringBore : linerR;
   const ro = (hold.kind === 'ring' ? +hold.od : linerR * 2 + 20) / 2;
   D3.dims.push({ x: off(q.x), y: q.y, w: q.w, mm: q.sz, n: q.n, kind: 'ring', ri, r: ro,
                  labY: q.y + sg * (ri + ro) / 2, band: ro - ri,
                  /* ゴムリングは輪が広いのでたいてい中へ入る。入らないものだけ
                     **輪の外**へ出す（軸の中はスペーサーの席なので混ぜない・
                     §9.418）。席は`tags()`が画面の座標で2段作る。 */
                  leadYs: null, leadTo: q.y + sg * ro });
  });
  /* 上下の刃の対（§9.418・§9.419）。同じ切断の上刃と下刃は**刃厚＋クリアランス**
     だけ軸方向に中心がずれていて、そのずれが鋏の噛み合わせそのもの。 */
  D3.knives = [];
  if (sh.knife) A.U.forEach((u, i) => D3.knives.push(
   { xu: off(u), xl: off(A.Lo[i]), yU, yL, r: ctx.st.knife / 2 }));
  /* **上下の刃がすれ違えるか**（§9.419）。同じ切断の上刃と下刃は円周が食い違う
     ので、軸方向に**刃の身のぶん**離れていないと円周でぶつかって切れない。
     いちばん近い対で見る。 */
  D3.pack.knifeGap = D3.knives.length
   ? +Math.min(...D3.knives.map(k => Math.abs(k.xu - k.xl))).toFixed(3) : null;
  D3.pack.tk = tk;
  return Object.assign({ out }, fr);
 }

 /* 材料。ラインは正面（OS 側）から見て左が入側、右が出側。軸の向きは OS→DS を
    +X、送りの向きを +Z に取っているので、入側（切断前の元板）は −Z、出側
    （切断後の条）は +Z になる。切られた条は刃に押されて板厚のぶんだけ上下へ
    分かれる（模式図と同じ）。 */
 /* 条と条のあいだに空ける見た目の隙間（mm）。**切れ目が見えないと1枚の板に
    見える**ので、実寸には無い隙間を入れている。`matOff`の物差しでもある。 */
 const MAT_GAP = 3;
 function material(T, g, A, segs, L) {
  const off = x => x - L / 2, th = Math.max(0.2, ctx.st.thick);
  const run = BS().materialRun(A, segs), IN = 620, OUT = 760;
  /* 板は見せ消しできる。大きさ（IN・OUT）は返すので、消しても画面の収まりは変わらない。
     **消しても「出さない」以外なら物は組み立てる**（§9.422。薄く残す・線だけ）。 */
  const matOn = D3.show.mat;
  if (!drawn('mat')) { D3.marks = []; return { IN, OUT }; }
  /* 板と耳屑は、断面図では**模式図と同じ色**にする（§9.415）。立体図の板は
     ロールの上に載った1枚として機械の中で見るので明るい鋼色でよいが、断面図の
     板は**いちばん薄い物**（見かけの厚みを8倍に誇張してなお数px）なので、
     明るい鋼色のままだと地に溶ける（実測: 輝度231に対し地が241、差は10）。
     模式図の板・耳の色（`--bs-fig-strip`／`--bs-fig-trim`）を借りると、
     **2つの図で同じ物が同じ色**になり（§CLAUDE 8）、地との差も付く。 */
  const sheet = skin(T, matOn, 'sheet',
    { color: cutColor('--bs-fig-strip', '#c5ccd4'), metalness: .62, roughness: .24 });
  const trim = skin(T, matOn, 'trim',
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
   /* 見かけの厚みは `build()` が先に決める（軸を離す量がこれで決まるため）。 */
   const TH = D3.matTh || th;
   /* **`matShift` は模式図（SVGのY＝下向き）の答え**なので、立体（Yは上向き）へ
      写すときは符号を返す。返さないと、条の千鳥が模式図と上下逆に出る。 */
   /* **ずらすのは板厚1枚ぶん**（§9.418 追補、利用者の指示「3D断面で表示する板は
      板厚分だけしかずらさないようにしてほしい」）。切られた条は刃に押されて
      隣どうしが**板厚1枚ぶんだけ**すれ違う——中心の差が板厚になるので、
      片側へは半分ずつ寄せる。模式図（`matShift(A, run, i) * h / 2`）と同じ量で、
      以前はここだけ2倍ずれており、条のあいだに板厚1枚ぶんの空きができていた。 */
   const yOf = i => -BS().matShift(A, run, i) * TH / 2;
   const face = f => run.map((r, i) => ({ r, i })).filter(({ r }) => f(r)).map(({ r, i }) =>
    ({ x: off((r.from + r.to) / 2), y: yOf(i), z: 0,
       l: Math.max(1, r.to - r.from - MAT_GAP), r: TH, d: DEP }));
   /* **材料と刃が同じ割付から出ているかを数で残す**（§9.433、利用者の報告
      「断面図・立体図だけ板の位置がずれる」）。材料の並びは`A.matStart`から、
      刃の位置は`A.U`から出るので、同じ`A`なら**1条目の左端と1本目の切断位置は
      ぴたり同じ**（どちらも`matStart + OS耳`）。0でなければ「違う割付の物が
      混ざっている」しるし——絵で見ると「板が横へずれている」としか読めないので、
      網が名指しで見られるように数で答える（`view().matOff`）。 */
   const first = run.find(r => r.sg.type !== 'trim');
   D3.matOff = (first && A.U.length)
    ? +(first.from - BS().cutFace(A, ctx.st.tk, 0, true)).toFixed(3) : 0;
   [[r => r.sg.type === 'strip', sheet], [r => r.sg.type !== 'strip', trim]].forEach(([f, mat]) => {
    const list = face(f);
    cut(list, mat);
    cap(T, g, list.map(q => ({ x: q.x, y: q.y, l: q.l })), TH / 2, 0, mat);
   });
   /* 板の札（§9.413 追補、利用者の指示「2Dの表示のようにラベルもほしい」）。
      模式図と**同じ言葉・同じ側**で出す——条の番号は板が寄った側、耳は「耳」。
      値は模式図と同じ2桁（条幅・耳屑幅は割り付けの計算値）。
      **指し示す物のすぐそばへ置く**（§9.418、利用者の指示「指し示すものの近くに
      ラベルが欲しい。耳とかラベルを板に寄せて」）。§9.413 では器の縁まで出して
      いたが、そこは板から実寸で 300mm 以上離れていて「どの条の番号か」を目で
      辿り直すことになる。板と軸のあいだには実寸 55mm ほどの空きがあるので、
      **画面の座標で**そのあいだへ置く（世界の座標で置くと、視点を回したときに
      板から離れる）。耳は板の外側の縁へ、模式図と同じ置き方。 */
   /* 札は**材料の帯の、条が寄っていない側**へ置く（§9.418、利用者の指示
      「ラベルは板の上下交互に配置している余白の部分に配置してください」
      「板幅は、ゴムリングではなく材料の部分にラベルしてください」）。
      材料の帯は見かけの板厚の3倍の高さがあり、条はそのうち1/3を占めて
      上下どちらかへ寄る。**空くのは寄った側の反対**なので、そこへ置けば
      条にも部材にもかからない——板と軸のあいだには実寸で数mmしか無く、
      外へ出すと必ずゴムリングの帯に乗る（実際に乗っていた）。
      置き場は板の帯の中なので**1行**にする（2行は入らない）。 */
   /* **切ってある板の札は出さない**（§9.422）。薄く残すのは「そこに在る」ことを
      見せるためで、寸法まで並べると読む物が増えるだけになる。 */
   D3.marks = !matOn ? [] : run.map(({ sg, from, to }, i) => {
    const strip = sg.type === 'strip';
    return { x: off((from + to) / 2), y: -yOf(i), z: 0, row: true,
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
  if (matOn) {
   decal(T, g, '入側', '元板（切断前）', mcx, dy, -IN / 2);
   decal(T, g, '出側', '切断後', mcx, dy + th, OUT / 2);
  }
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

 /* 有効長＋青い印より外に残っている物の数（§9.418）。まとめ描きは1つの器に
    何百も入るので、**入れ物ではなく1つずつの場所**で見る。 */
 function strayCount(L) {
  const T = D3.T;
  if (!T || !D3.g) return 0;
  const lim = L / 2 + Math.max(24, L * 0.018) + 1, m4 = new T.Matrix4();
  let n = 0;
  const walk = o => {
   if (!o || o === D3.rig) return;
   /* フローティングシートは有効長の外に載る部品（§9.459）。幅は図面の70で別に見る。 */
   if (o.userData && o.userData.fseat) return;
   if (o.isMesh) {
    const c = o.count == null ? 1 : o.count;
    for (let i = 0; i < c; i++) {
     if (o.isInstancedMesh) o.getMatrixAt(i, m4); else m4.copy(o.matrix);
     if (Math.abs(m4.elements[12]) > lim) { n++; break; }
    }
   }
   (o.children || []).forEach(walk);
  };
  walk(D3.g);
  return n;
 }

 /* 隠した部材が**そこに在るか**を、描いた物そのものから数える（§9.422）。
    材質の名前に隠し方が入る（`liner~ghost`）ので、絵の見た目ではなく
    **組み立てている物**で「透かして在る」と「物ごと無い」を見分けられる。 */
 function skinCount() {
  let skinned = 0, mesh = 0;
  const walk = o => {
   if (!o) return;
   if (o.isMesh) {
    mesh++;
    if (/~(ghost|wire)/.test((o.material && o.material.name) || '')) skinned++;
   }
   (o.children || []).forEach(walk);
  };
  walk(D3.g);
  return { skinned, mesh };
 }

 /* 立体図を組み直す。模式図と同じ A・segs・zp から作る。 */
 function build() {
  /* **組めなかったときは「今の物ではない」と名乗る**（§9.433）。以前はただ
     戻っていたので、**前の割付・前の図のまま組んである模型**が「今の物」の
     顔をして場面に残り、`render()`の食い違いの見張りも素通りしていた。
     組めない理由は2つ（割付がまだ無い・部品がまだ無い）で、どちらも
     **あとから解消する**ので、控えを落としておけば次の機会に組み直される。 */
  if (!ctx || !ctx.res || !init()) {
   D3.builtRes = null;
   /* **割付が無い＝組めない材料**（§9.454）。前の割付の絵を残さない。 */
   if (ctx && !ctx.res) clearCanvas();
   return;
  }
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
  /* 板厚の誇張（§9.413）。**ずれを板厚1枚ぶんへ直したぶん帯が薄くなる**ので、
     字が入る高さまで上げる（§9.418 追補）。倍率は図の上の1行が言う。 */
  D3.matTh = D3.cut ? Math.max(th0, h0 / 50) : th0;
  D3.matMag = D3.matTh / th0;
  /* **断面図では上下軸を離す**（§9.413 追補、利用者の指示「板がめり込んでいるので
     上下軸を適度な位置まで離して2Dに近い表現を試みて」）。板を見える厚みまで
     太らせると、刃先のあいだに隙間が無いぶん**板が刃へめり込む**。模式図も
     同じ理由で上下を離して板を通している（`FIG.openGap`）ので、ここも刃先の
     あいだに隙間を作る。条は千鳥で板厚ぶん上下へ寄るので、**板が占める高さは
     見かけの厚みの3倍**（±1.5倍）——その両側へ余裕を取る。 */
  D3.endCaps = 0; D3.fseat = null;
  const cd = D3.cut ? ctx.st.knife + D3.matTh * CUT_OPEN : cd0;
  D3.cutGap = D3.cut ? cd - ctx.st.knife : 0;   /* 刃先のあいだに残る隙間 */
  const m = machine(T, g, A, segs, zp, L, cd, ctx.st.tk);
  const ods0 = m.out.ring.filter(q => q.hold.kind === 'ring').map(q => q.hold.od);
  const rad = Math.max(ctx.st.knife, +ctx.M.P.spacerOD || 240, ...(ods0.length ? ods0 : [0])) / 2;
  D3.cutBox = { cx: 0, cy: 0, w: L + 160, h: (cd / 2 + rad) * 2 + 120 };
  /* 区間の的の高さ（§9.417）。**いちばん外まで出ている部材の半径**で取る
     ——模式図の的も部材の高さぶんを覆う（§9.386）。 */
  D3.zr = rad;
  /* **断面図に出てよいのは有効長と青い印まで**（§9.418、利用者の指摘「OS側の
     エンドの青オブジェクトの上下軸の外々に線が付着している」）。機械まわりは
     `rig` ごと伏せるので、その外に物が残っていれば**行き先を間違えた**しるし。
     絵で探すと「1本の線」にしか見えず、何の線か分からない。 */
  D3.stray = strayCount(L);
  const mt = material(T, g, A, segs, L);
  const st2 = site(T, m.baseL, m.bcx, m.bedTop, m.railTop);
  /* 画面に収まる見はじめの位置。実寸から出すので、アーバー長や刃径を変えても崩れない。
     一度でも視点を動かしたあとは動かさない（見ているところを取り上げない）。 */
  /* OS・DS の札は有効長の両端の真上に置く。台車を回せば札も一緒に回る。 */
  const endY = cd / 2 + rad + (D3.cut ? 90 : 330);
  D3.tag = { os: { x: -(L / 2 + 120), y: endY, z: 0 }, ds: { x: L / 2 + 120, y: endY, z: 0 } };
  D3.bcx = m.bcx;
  /* **断面図は必ずライン位置で見る**（§9.433）。段取り（引き出し・回す）は
     断面図では伏せてあるのに、台車の走行ぶん（`carX`）だけは立体図の状態を
     引きずっていた——カメラがそのぶんを足して見ているので絵は成り立つが、
     「いま何を見ているか」が立体図の操作の履歴で変わることになる。
     断面図は**軸とその上の物だけ**を見る図なので、台車はラインへ置く。 */
  D3.carX = (D3.out && !D3.cut) ? -m.bcx : -M.ttX;
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
  /* **組んだ図を控えるのは render() より前**（§9.428）。`render()`は食い違いを
     見つけると組み直すので、後に置くと組み直しが無限に続く。 */
  D3.builtCut = D3.cut;
  /* **何から組んだかも控える**（§9.433、利用者の報告「断面図・立体図だけ板の
     位置がずれる」）。模型は`ctx.res`（割付）から作るが、控えていたのは
     **図の種類だけ**だったので、割付が入れ替わったのに組み直されなかった模型を
     `render()`が見分けられなかった——材料の並びは`A.matStart`から、刃の位置は
     `A.U`から出るので、**違う割付の物が混ざると板だけが横へずれる**。
     控えるのは`res`そのもの（`solve()`は呼ぶたびに新しい物を返すので、
     同一性の比較がそのまま「同じ割付か」の答えになる）。 */
  D3.builtRes = res;
  /* **どちら側を残す向きで組んだかも控える**（§9.437）。切り口の面は組む時に
     置き場所が決まるので、向きが変わったら**組み直さないと切り口が反対側に
     残る**——`spinTo()`は断面図では`applyCut()`しか呼ばないので、控えが無いと
     裏返した瞬間に初回と同じ「中身の無い殻」になる。 */
  D3.builtKeep = keepSide();
  D3.dirty = false;
  D3.builds++;
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
  D3.keep = keepSide();
  if (D3.clip) D3.clip.set(new D3.T.Vector3(0, 0, D3.keep), 0);
  D3.r.clippingPlanes = on && D3.clip ? [D3.clip] : [];
 }

 /* 器を空にする（§9.433）。**組んである模型が今の図の物でないときは、前の図の
    絵を残さない**——絵は「いま何を見ているか」の答えなので、古い1枚を残すと
    利用者は押した図が出ていると読む。札（`tags()`が置くHTML）も一緒に伏せる。 */
 function clearCanvas() {
  if (!D3.r) return;
  try { D3.r.clear(); } catch (e) {
   WL.quiet.note('器を空にできない（前の1枚が残る）', e);
  }
  /* 札は**種類ごとに1本の道**で伏せる（増やしたらここへ足す）。 */
  (D3.markEls || []).forEach(el => { el.hidden = true; });
  (D3.zoneEls || []).forEach(z => { z.box.hidden = true; z.chip.hidden = true; });
  TAG_KEYS.forEach(key => { const el = $h('.bs-t3-' + key); if (el) el.hidden = true; });
  const sv = $h('.bs-t3v'); if (sv) { sv.hidden = true; sv.innerHTML = ''; }
 }

 function render() {
  if (!D3.r || !D3.on) return;
  /* 組めない材料（割付が無い）のあいだは何も描かない（§9.454）。場面には
     前の割付の模型が残っているので、ここで止めないと回す・器の大きさが
     変わる、の道から前の絵が出てくる。 */
  if (ctx && !ctx.res) { clearCanvas(); return; }
  /* **描くのは、いま選ばれている図の模型だけ**（§9.428、利用者の報告
     「3D断面図が切り替え直後には出ません（通常の3Dモデルが出る）」）。
     ここは切り替え以外の道からも呼ばれる——掴んで回している最中の毎フレーム、
     器の大きさが変わったとき、台車を回す・引き出すの動き。そのどれかが
     切り替えと重なると、**前の図のまま組んである模型**を描いてしまい、
     もう一度札を押すまで戻らない。食い違っていたら**組み直してから**描く。

     **見るのは「図の種類」と「割付」と「残す向き」の3つ**（§9.433・§9.437）。以前は図の種類だけを
     見ていたので、**割付が入れ替わったのに組み直されなかった模型**はそのまま
     描かれていた（材料の並びと刃の位置が別々の割付から出て、板だけが横へ
     ずれる）。どちらか食い違えば組み直す——`build()`が両方を控え直すので、
     組み直しは1回で収まる。 */
  if (D3.built && (D3.builtCut !== D3.cut || D3.builtRes !== ctx.res
                   || (D3.cut && D3.builtKeep !== keepSide()))) {
   D3.fixups++;
   build();
   /* 組み直せなかった（割付がまだ無い・部品がまだ無い）なら、**前の図の絵を
      残さない**。残すと「断面図を押したのに立体図が出たまま」になる
      （利用者の報告④）——器を空にして、次に組めたときの1枚を待つ。 */
   if (D3.builtRes !== ctx.res) clearCanvas();
   return;
  }
  const T = D3.T, cv = D3.cv, w = cv.clientWidth, h = cv.clientHeight;
  if (w < 8 || h < 8) return;
  if (cv.width !== Math.round(w * D3.r.getPixelRatio()) || D3.w !== w || D3.h !== h) {
   D3.r.setSize(w, h, false); D3.cam.aspect = w / h; D3.cam.updateProjectionMatrix();
   D3.w = w; D3.h = h;
  }
  /* ---- 断面図（§9.412）。平行投影で真横から見る ---- */
  if (D3.cut) {
   const b = D3.cutBox || { cx: 0, cy: 0, w: 2000, h: 1000 };
   const oc = D3.ocam, pad = 1.06;
   /* **帯の下に図を置かない**（§9.454、利用者の指示「ラップやクリアランスの
      ラベルと図の重なりも問題がないか」）。以前は器ぜんたいに合わせて縮尺を
      決めていたので、左上の帯（読み方・有効長・設定の3行）と下の帯（表示・
      視点）が**上下軸の部材に被っていた**（実測: 帯の下の図の画素 1,801〜
      12,351）。帯が占める上下の高さを**測って**差し引き、残りの高さに
      図を収める——字の置き場（`dims()`／`place()`）が帯を測るのと同じ
      `hudBox()`を使う（固定の数に足して追いかけない・§9.250）。 */
   const hb = hudBox(w, h);
   const topIn = hb.tops.reduce((m, t) => Math.max(m, t.y), 0);
   const avail = Math.max(h * 0.4, h - topIn - hb.bot);
   const fit = Math.max(b.w * pad / w, b.h * pad / avail);  /* 全体が収まる縮尺 */
   const sc = fit / (D3.cutZoom || 1);                      /* 1pxあたりの世界の長さ */
   const vw = w * sc, vh = h * sc;
   /* 図の中心を「空いている帯のあいだ」の中央へ寄せる（画面の下向きが正）。 */
   const offPx = (topIn + (h - topIn - hb.bot) / 2) - h / 2;
   /* 拡大しているぶんの平行移動（§9.463）。画面の右・上へ、世界の長さで。 */
   const panX = D3.cutPanX || 0, panY = D3.cutPanY || 0;
   oc.left = -vw / 2 + panX; oc.right = vw / 2 + panX;
   oc.top = vh / 2 + offPx * sc + panY; oc.bottom = -vh / 2 + offPx * sc + panY;
   D3.cutView = { sc, fit, off: offPx, w, h };
   zoomReadout();
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
   /* 帯の中身は`tags()`（→`sides()`）が書くので、**書いたあとの高さ**と
      食い違っていたら1回だけ描き直す（最初の1枚は帯が空のまま測っている）。
      同じ高さに落ち着けば2回目は描き直さないので、繰り返しにはならない。 */
   const hb2 = hudBox(w, h);
   const top2 = hb2.tops.reduce((m, t) => Math.max(m, t.y), 0);
   /* 網が見る数（§9.454）: 図の箱の上端・下端（画面の座標）と帯の高さ。
      正面から見ているときは `figTop ≥ top` かつ `figBot ≤ h − bot` が正。 */
   D3.hudFit = { top: +topIn.toFixed(1), bot: +hb.bot.toFixed(1), h,
                 figTop: +((oc.top - b.h / 2) / sc).toFixed(1),
                 figBot: +((oc.top + b.h / 2) / sc).toFixed(1) };
   /* 帯の字（入りきらない件数）は縮尺で変わり得るので、**続けて2回まで**。 */
   const moved = Math.abs(top2 - topIn) > 1 || Math.abs(hb2.bot - hb.bot) > 1;
   D3.hudRetry = moved ? (D3.hudRetry || 0) + 1 : 0;
   if (moved && D3.hudRetry <= 2) requestAnimationFrame(render);
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
   const on = inView(v);
   el.hidden = !on;
   if (!on) return;
   at[key] = v.x;
   /* OS と DS は**対**（両端の呼び名）。片方だけ帯を避けて下がると、同じ物の
      名前が段違いに見えるので、`place()`が同じ高さへそろえる（§9.437）。 */
   put.push({ el, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h,
              w: el.offsetWidth || 60, h: el.offsetHeight || 20, pair: 'ends' });
  });
  const marks = D3.cut ? (D3.marks || []) : [];
  const pool = markEls(marks.length);
  marks.forEach((q, i) => {
   const el = pool[i];
   if (!el) return;
   v.set(q.x, q.y, q.z).applyMatrix4(D3.g.matrixWorld).project(cam);
   const on = inView(v);
   el.hidden = !on;
   if (!on) return;
   const want = `<b>${esc(q.text)}</b><small>${esc(q.sub)}</small>`;
   if (el.dataset.k !== want) { el.innerHTML = want; el.dataset.k = want; }
   /* 種類の印は**最後**に置く（前に足すと、末尾で種類を読む網が別の印を拾う）。
      読む側は `dataset.kind` を見ればよい——印の並びに頼らせない（§9.418）。 */
   el.className = 'bs-t3 bs-t3-mk' + (q.row ? ' is-row' : '') + ' is-' + q.kind;
   if (el.dataset.kind !== q.kind) el.dataset.kind = q.kind;
   put.push({ el, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h,
              w: el.offsetWidth || 44, h: el.offsetHeight || 26 });
  });
  zones(w, h, cam, v);
  dims(w, h, cam, v);
  /* **帯を先に書いてから札を置く**（§9.437）。`sides()`が左上の帯（画面左DS…／
     有効長…）を出すので、逆順だと**切り替えた最初の1枚だけ帯がまだ空**で、
     `place()`が「帯は無い」と読んで札を帯の下へ持ち上げる——そのあと帯が出て
     重なる（実測 25×5px）。帯の中身は札の位置に依らないので、先に書いてよい。 */
  sides(at);
  place(put, w, h);
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
   /* 器の外の区間は出さない（拡大したとき・§9.463）。 */
   on = on && x1 > 0 && x0 < w && y1 > 0 && y0 < h;
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
    el.chip.dataset.axis = q.up ? 'up' : 'lo';
    el.chip.textContent = q.badge;
   }
   /* 記号の色は文字ごと（§9.455）。札と区間の面が同じ番号を名乗る。 */
   /* 変わったときだけ書く（毎フレーム書くと、そのたびに書式を計算し直す）。 */
   const bc = q.tone == null ? '' : String(q.tone);
   [el.box, el.chip].forEach(n => {
    if ((n.dataset.bc || '') === bc) return;
    if (bc) n.dataset.bc = bc; else delete n.dataset.bc;
   });
   el.box.style.cssText =
     `left:${b.x.toFixed(1)}px;top:${b.y.toFixed(1)}px;`
   + `width:${b.w.toFixed(1)}px;height:${b.h.toFixed(1)}px`;
   el.chip.style.cssText =
     `left:${(b.x + b.w / 2).toFixed(1)}px;top:${(b.y + b.h / 2).toFixed(1)}px;`
   + `font-size:${fs.toFixed(1)}px`;
  });
  badgeSig(zs.map(q => q.badge).join('/'));
 }
 /* ====== 寸法の層（§9.418）======================================
    利用者の指示「刃の上下位置が重ならないようにクリアランス設計も正確に反映
    描画してください。刃の交差する部分切断面に縦の破線を入れて刃が上下正確に
    ズレて鋏のように切断できる状態を確認できるようにしてください」
    「板幅、スペーサー幅、ゴムリング幅、重ならないようにラベルを表示できませんか。
    重なる場合は引き出し線を、引き出し線も重なる場合は表示不要。細かくなって
    表示しきれないときは、拡大表示に任せる形」 */
 /* 寸法の字（`10.025`）は**丸めない**（§9.413）——0.005 違えば在庫に無い別の
    部材の名前になる。末尾の0だけ落とす。 */
 const dmm = v => (+v).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
 /* 字の幅の見当（和字＝1em・欧字＝0.58em）。`zoomTextW()` と同じ見方。 */
 const dimTextW = (t, fs) => [...String(t)]
   .reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? fs : fs * 0.58), 0);
 /* **現物に貼れるものはできるだけ貼る**（§9.418 追補、利用者の指示「引き出し線
    だらけにならないためにも」）。中へ書くのに要る余白は左右1pxまで詰める。 */
 const DIM_FS = 9, DIM_PAD = 1, DIM_SLOT = 4;
 function dims(w, h, cam, v) {
  const el = host && host.querySelector('.bs-t3v');
  if (!el) return;
  if (!D3.cut) { el.hidden = true; el.innerHTML = ''; D3.dimShown = null; return; }
  el.hidden = false;
  el.setAttribute('viewBox', `0 0 ${w} ${h}`);
  /* 字の大きさは**この1箇所**が決める（幅の見当もここから出しているので、
     CSSに書くと2箇所が食い違う）。 */
  el.setAttribute('font-size', String(DIM_FS));
  const P = (x, y) => {
   v.set(x, y, 0).applyMatrix4(D3.g.matrixWorld).project(cam);
   return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
  };
  let o = '';
  /* ---- ① 切断の位置（縦の破線）----
     **材料のところには刃が描けない**（刃は軸のまわりの丸で、切り口では
     材料の高さまで届かない）ので、そこに切断の位置を破線で引く（§9.418、
     利用者の指示「3Dの部分は材料の部分に刃の図がないので破線を入れたい。
     破線は刃の端部同士の位置が一致するはずなので1本で上下引けるはず」）。
     **1本で引く**——上下の刃のずれ（クリアランス 0.1mm台）はこの縮尺では
     0.1pxにもならず、2本に割ると「離れている」ではなく「線が2本ある」に
     しか見えない。ずれそのものは**模式図が刃を上下に描き分けて**示し、
     値は拡大図が持つ（§CLAUDE 8 同じことを2箇所で言わない）。 */
  const kn = D3.knives || [];
  D3.cutLines = 0;
  kn.forEach(k => {
   const x = (k.xu + k.xl) / 2;
   const a = P(x, k.yU - k.r), b = P(x, k.yL + k.r);
   o += `<line class="bs-kl is-cut" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}"`
      + ` x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke-dasharray="5 4"/>`;
   D3.cutLines++;
  });
  /* ---- ② 部材の幅（**全部出す**・§9.429、利用者の指示）----
     以前は「中へ入るものは中へ／残りは**1段だけ**引き出し／その段でぶつかった
     ものは出さない」で、**実測217件中95件（44%）を黙って落としていた**
     （利用者の指摘「3D断面図で表示できていないラベルがある」）。
     いまはこう置く:
       ・部材の中に入るものは中へ（今までどおり）
       ・残りは**軸の中の3段**（ゴムリングは輪の外に2段）へ引き出す
       ・段は`x`の順に振り分ける——**隣り合う部材の字は必ず別の段**になる
       ・段の中は`spread()`（`blade-core.js`）で最小の間隔まで押し広げる。
         **順序を変えないので引き出し線どうしが交差しない**（§9.413）
       ・線を先に、字を後に描く（線が字の上を通らない）
     それでも器に入りきらなかった数は`off`に残し、**図の読み方の1行が言う**
     ——黙って落とさない（§CLAUDE 4）。 */
  const list = (D3.dims || []).map(q => {
   /* 字の場所（`labY`）・引き出しの段（`leadYs`）・線が触る先（`leadTo`）は
      **控えるときに決める**（どれも部材ごとに違う）。ここは写すだけ。 */
   const a = P(q.x - q.w / 2, q.labY), b = P(q.x + q.w / 2, q.labY);
   const mid = P(q.x, q.labY);
   const hi = P(q.x, q.labY + q.band / 2), lo = P(q.x, q.labY - q.band / 2);
   const hit = P(q.x, q.leadTo);
   const t = dmm(q.mm) + (q.n > 1 ? '\u00d7' + q.n : '');
   /* 段の高さは**その部材の位置から**出す（視点を回しても席が付いてくる）。
      持っていないもの（ゴムリング）は、部材の縁の外へ画面の座標で2段作る。 */
   const outDir = Math.sign(hit.y - mid.y) || (q.y > 0 ? -1 : 1);
   const rows = (q.leadYs && q.leadYs.length)
    ? q.leadYs.map(yy => P(q.x, yy).y)
    : [0, 1].map(k => hit.y + outDir * (13 + k * (DIM_FS + 4)));
   return { t, kind: q.kind, cx: (a.x + b.x) / 2, cy: mid.y,
            pw: Math.abs(b.x - a.x), up: q.y > 0,
            band: Math.abs(hi.y - lo.y), hit: hit.y, rows,
            tw: dimTextW(t, DIM_FS) };
  }).filter(q => q.cx > -50 && q.cx < w + 50);
  /* **引き出した字も、部材の中の字も帯を避ける**（§9.443、利用者の指示「図の
     縦方向の表示エリアが30%小さくなっても表示ラベルなどが重ならないように」）。
     §9.437 で帯よけ（`hudBox`）を入れたのは**HTMLの札（OS・DS）だけ**で、
     寸法の字は通っていなかった——器が縮むと投影した席が上へ寄り、左上の帯へ
     食い込む（実測: 器の高さ 819→459px で 4件、いちばん大きいもので 100px²）。 */
  const hudD = hudBox(w, h);
  const dimTop = (x, tw) => {
   let t = DIM_PAD;
   hudD.tops.forEach(b => {
    if (x + tw / 2 + DIM_PAD > b.x0 && x - tw / 2 - DIM_PAD < b.x1) t = Math.max(t, b.y + DIM_PAD);
   });
   return t;
  };
  const dimBot = h - hudD.bot - DIM_PAD;
  /* **置く前に空いているか確かめる**（§9.443）。器が縮んでも字の数は変わらない
     （実測226枚）ので、**全部を置こうとすれば必ずどこかで重なる**。§9.429 が
     すでに決めているとおり、入りきらないものは**置かずに数える**（`off`）
     ——図の読み方の1行がその数を言う（§CLAUDE 4 黙って落とさない）。
     ふさがっている物は3つ: 帯（`.bs-hud`）・記号の札（`zones()`が先に置く）・
     すでに置いた字。 */
  const taken = [];
  hudD.tops.forEach(b => taken.push({ x0: b.x0, x1: b.x1, y0: 0, y1: b.y, k: 'hud' }));
  taken.push({ x0: 0, x1: w, y0: h - hudD.bot, y1: h, k: 'hud' });
  if (host) {
   const sb = host.getBoundingClientRect();
   (D3.zoneEls || []).forEach(z => {
    if (!z.chip || z.chip.hidden || !z.chip.offsetWidth) return;
    const r = z.chip.getBoundingClientRect();
    taken.push({ x0: r.left - sb.left, x1: r.right - sb.left,
                 y0: r.top - sb.top, y1: r.bottom - sb.top, k: 'chip' });
   });
  }
  const boxOf = (x, y, tw) => ({ x0: x - tw / 2 - 2, x1: x + tw / 2 + 2,
                                 y0: y - DIM_FS * 0.6 - 1, y1: y + DIM_FS * 0.6 + 1 });
  const why = { hud: 0, chip: 0, text: 0, wide: 0 };
  const hitOf = b => taken.find(o => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  const free = b => !hitOf(b);
  /* **有効長の寸法線の字も先に席を取る**（§9.443）。描くのは下の ③ だが、
     **後から描く物は席を取れない**——実際に 70% の高さで寸法の字が2件
     この上へ乗った。場所は`pack`だけで決まるので、ここで確保できる。 */
  const pk0 = D3.pack;
  let span0 = null;
  if (pk0 && pk0.arbor) {
   const ha = pk0.arbor / 2;
   const sa = P(-ha, 0), sb2 = P(ha, 0);
   const st0 = `有効長 ${dmm(pk0.arbor)}`;
   span0 = { cx: (sa.x + sb2.x) / 2, y: h - 54, t: st0,
             tw: dimTextW(st0, DIM_FS), a: sa, b: sb2 };
   taken.push(boxOf(span0.cx, span0.y, span0.tw + 10));
  }
  const outs = [];
  let inside = 0;
  list.forEach(q => {
   /* 中へ書けるのは**横にも縦にも入る**とき。帯が字より低ければ、いくら
      横に広くても中には書けない。 */
   /* **帯の下に来る字は「中に書ける」と数えない**（§9.443）。中の字は
      その部材の位置に縛られていて動かせないので、帯と重なるなら
      **引き出しへ回す**——動かせるのはそちらだけ。 */
   const at = boxOf(q.cx, q.cy, q.tw);
   const roomOK = q.cy - DIM_FS * 0.6 >= dimTop(q.cx, q.tw)
               && q.cy + DIM_FS * 0.6 <= dimBot && free(at);
   if (roomOK && q.pw >= q.tw + DIM_PAD * 2 && q.band >= DIM_FS + 1) {
    taken.push(at);
    const y = q.cy + DIM_FS * 0.36;
    o += `<text x="${q.cx.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle"`
       + `${q.kind === 'ring' ? ' class="is-ring"' : ''}>${esc(q.t)}</text>`;
    inside++;
    return;
   }
   outs.push(q);
  });
  /* 引き出し。**上軸ぶん・下軸ぶん**を、**部材の種類ごとに**分けて置く
     （§9.418。スペーサーとゴムリングを同じ段へ混ぜると、どちらの寸法か
     読めない）。線と字は別に溜めて、**線を先に**描く。 */
  /* **段ごとにまとめて押す**——1つずつ動かすと段の高さがばらけて、どの字が
     同じ段なのか読めなくなる（§9.429 の「段は`x`順に振り分ける」が死ぬ）。 */
  let lead = 0, off = 0, ln = '', tx = '';
  [true, false].forEach(wantUp => {
   ['sp', 'ring'].forEach(kind => {
    const g1 = outs.filter(q => q.up === wantUp && q.kind === kind)
                   .sort((a, b) => a.cx - b.cx);
    if (!g1.length) return;
    const n = Math.max(1, (g1[0].rows || []).length);
    g1.forEach((q, i) => { q.tier = i % n; });
    /* 席（横の位置）を先に配ってから、**群ぜんたいを1つの量で押す**（§9.443）。
       段ごとに別々の量で押すと、**押した段と押さなかった段が同じ高さに来て**
       字どうしが重なる（実測: 器の高さ459pxで64件）。段の間隔は`rows`が
       持っているので、群ごと動かせば間隔はそのまま保たれる。 */
    const tiers = [];
    let shift = 0, down = 0, up = 0;
    for (let t = 0; t < n; t++) {
     const row = g1.filter(q => q.tier === t);
     if (!row.length) { tiers.push(null); continue; }
     const half = row.map(q => q.tw / 2 + DIM_PAD);
     const xs = BS().spread(row.map(q => q.cx), half, 2, w - 2, DIM_SLOT);
     tiers.push({ row, half, xs, t });
     row.forEach((q, i) => {
      const y0 = q.rows[Math.min(t, q.rows.length - 1)];
      down = Math.max(down, dimTop(xs[i], q.tw) + DIM_FS * 0.6 - y0);
      up = Math.max(up, y0 - (dimBot - DIM_FS * 0.6));
     });
    }
    /* 上の帯からは下へ、下の帯からは上へ逃がす。**どちらも群ごと1つの量**
       （§9.443）——1つずつ丸めると、下の帯に当たった字が**全部同じ高さへ
       重なって**潰し合う（実測: 153件中39件が置けなくなった）。 */
    shift = down - up;
    tiers.forEach(g => {
     if (!g) return;
     const { row, half, xs, t } = g;
     row.forEach((q, i) => {
      const y = q.rows[Math.min(t, q.rows.length - 1)] + shift;
      /* **入りきらなかったものは置かない**（重ねない）。`spread()`は入らない
         ときに範囲の外を返すので、そこで分かる。**ふさがっている席も同じ**
         ——帯・記号の札・すでに置いた字と重なるなら置かずに数える（§9.443）。 */
      if (xs[i] - half[i] < 0 || xs[i] + half[i] > w) { off++; why.wide++; return; }
      /* **落とすのは最後の手段**（§9.443）。席がふさがっていたら、まず
         **同じ字の別の段**を試す——横の位置（`xs[i]`）はそのままなので、
         引き出し線の向きも交差の無さも変わらない（§9.413）。
         どの段も空いていなければ置かずに数える（§9.429 の`off`）。 */
      let yy = y, slot = boxOf(xs[i], yy, q.tw);
      if (!free(slot)) {
       let ok = false;
       for (let k = 0; k < q.rows.length && !ok; k++) {
        const cand = q.rows[k] + shift;
        const bx = boxOf(xs[i], cand, q.tw);
        if (free(bx)) { yy = cand; slot = bx; ok = true; }
       }
       if (!ok) { off++; const hb = hitOf(slot); why[(hb && hb.k) || 'text']++; return; }
      }
      taken.push(slot);
      const d = Math.sign(q.hit - yy) || 1;
      const y0 = yy + d * DIM_FS * 0.55;
      /* **線は字のきわから対象の縁まで**（どちらの端も浮かせない）。
         いったん真下（真上）へ降ろしてから寄せると、どの部材から出た線かを
         目で追える。 */
      ln += `<path class="bs-lead" d="M${xs[i].toFixed(1)} ${y0.toFixed(1)}`
          + `L${xs[i].toFixed(1)} ${(y0 + d * 4).toFixed(1)}`
          + `L${q.cx.toFixed(1)} ${(q.hit - d * 3).toFixed(1)}`
          + `L${q.cx.toFixed(1)} ${q.hit.toFixed(1)}"/>`;
      tx += `<text x="${xs[i].toFixed(1)}" y="${(yy + DIM_FS * 0.36).toFixed(1)}"`
          + ` text-anchor="middle"${kind === 'ring' ? ' class="is-ring"' : ''}>`
          + `${esc(q.t)}</text>`;
      lead++;
     });
    });
   });
  });
  o += ln + tx;
  /* ---- ③ 有効長がどの区間か（§9.420、利用者の指示「有効長がどの区間か、
     視覚的にも表示を追加して」）。**寸法線**で言う——字だけだと「どこからどこ
     まで」が図の上で辿れない。端は立て線、あいだは1本、真ん中に値を置く。 */
  if (span0) {
   const a = span0.a, b = span0.b;
   /* 足元の帯（表示の切替・視点）は 9px から 30px ぶんを使っているので、
      その上へ置く（§9.420）。重ねると線が札の裏へ隠れる。
      **席は上で確保済み**（§9.443）——ここは描くだけ。 */
   const y = span0.y;
   const tick = 7;
   const t = span0.t;
   const tw = span0.tw / 2 + 5;
   const cx = span0.cx;
   o += `<line class="bs-span" x1="${a.x.toFixed(1)}" y1="${(y - tick).toFixed(1)}"`
      + ` x2="${a.x.toFixed(1)}" y2="${(y + tick).toFixed(1)}"/>`
      + `<line class="bs-span" x1="${b.x.toFixed(1)}" y1="${(y - tick).toFixed(1)}"`
      + ` x2="${b.x.toFixed(1)}" y2="${(y + tick).toFixed(1)}"/>`
      + `<line class="bs-span" x1="${a.x.toFixed(1)}" y1="${y}" x2="${(cx - tw).toFixed(1)}" y2="${y}"/>`
      + `<line class="bs-span" x1="${(cx + tw).toFixed(1)}" y1="${y}" x2="${b.x.toFixed(1)}" y2="${y}"/>`
      + `<text class="is-span" x="${cx.toFixed(1)}" y="${(y + DIM_FS * 0.36).toFixed(1)}"`
      + ` text-anchor="middle">${esc(t)}</text>`;
   D3.spanLine = { x0: +a.x.toFixed(1), x1: +b.x.toFixed(1) };
  }
  D3.dimShown = { inside, lead, off, all: list.length, why };
  el.innerHTML = o;
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
 /* 帯（`.bs-hud`）が占めている場所は**測って決める**（§9.437、利用者の指示
    「OS,DSラベルの重なりも解消してほしい」）。以前は `TOP = 42` / `BOT = 44` の
    決め打ちだったが、断面図の左上の帯は**2行に増えている**（画面左DS…／有効長…）
    ので実測56px——DSの札が帯へ**25×5px** 食い込んでいた。
    固定の数に足して追いかけると、行が増えるたびにまた重なる（§9.250）。
    **横も見る**——左上の帯の下でも、帯より右に居る札は下げなくてよい。 */
 function hudBox(w, h) {
  const st = host;
  const out = { tops: [], bot: 10 };
  if (!st) return out;
  const s = st.getBoundingClientRect();
  st.querySelectorAll('.bs-hud').forEach(el => {
   if (el.hidden || !el.offsetWidth) return;
   const r = el.getBoundingClientRect();
   if (el.classList.contains('is-bot')) { out.bot = Math.max(out.bot, s.bottom - r.top); return; }
   out.tops.push({ x0: r.left - s.left, x1: r.right - s.left, y: r.bottom - s.top });
  });
  return out;
 }
 function place(put, w, h) {
  const PAD = 6;
  const hud = hudBox(w, h);
  /* その札の真上に帯が在るときだけ、帯の下まで下げる。 */
  const topAt = (x, tw) => {
   let t = PAD;
   hud.tops.forEach(b => {
    if (x + tw / 2 + PAD > b.x0 && x - tw / 2 - PAD < b.x1) t = Math.max(t, b.y + PAD);
   });
   return t;
  };
  const BOT = hud.bot + PAD;
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
  const clampX = q => Math.max(q.w / 2 + PAD, Math.min(w - q.w / 2 - PAD, q.x));
  /* 対で出す札（OS・DS）は**いちばん下がる側にそろえる**。 */
  const pairTop = {};
  put.forEach(q => {
   if (!q.pair) return;
   pairTop[q.pair] = Math.max(pairTop[q.pair] || 0, topAt(clampX(q), q.w) + q.h / 2);
  });
  put.forEach(q => {
   const x = clampX(q);
   const lo = q.pair ? pairTop[q.pair] : topAt(x, q.w) + q.h / 2;
   const y = Math.max(lo, Math.min(h - BOT - q.h / 2, q.y));
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
  /* **散文は「使い方」が持つ**（§9.443、利用者の指示「表示が重ならないように」）。
     帯は図の上に浮いていて、**1行増えるたびに寸法の字の置き場が減る**
     （実測: 3行で103px、器619pxのうち17%）。ここに要るのは**値**だけで、
     「上下軸はそのぶん離しています」「材料のところは刃を描けないため」は
     いつも同じ事実——読む場所は1つでよい（§CLAUDE 8）。 */
  const mag = D3.cut && D3.matMag > 1.05 && ctx
   ? `<s>／板厚</s><i>${(+ctx.st.thick).toFixed(1)}</i>`
     + `<s>は図では約${Math.round(D3.matMag)}倍</s>`
   : '';
  /* 破線が何を指しているかは**字で言う**（§CLAUDE 6）。ずれの値そのものは
     チップの帯と拡大図が持つので、ここでは繰り返さない。 */
  const sep = D3.cut && D3.cutLines
   ? '<s>／破線＝切断の位置</s>' : '';
  /* **入りきらなかった寸法は数で言う**（§9.429、§CLAUDE 4 できないことは
     できないと書く）。窓が狭いと段を広げても入らないことがあるので、
     「出ていない字がある」ことと**行き先（拡大図）**をその場で言う。
     0件のときは何も言わない——いつも出ていると、読む側が数え直す。 */
  const ds = D3.dimShown;
  const miss = ds && ds.off > 0
   ? `<s>／寸法</s><i>${ds.off}</i><s>件は入りきらないので、記号を押して拡大図で</s>` : '';
  el.innerHTML = `<s>画面左</s>${nm(l)}<s>／</s><s>右</s>${nm(r)}${mag}${sep}${miss}`;
  el.hidden = false;
  lengths();
 }
 /* **設定有効長と、スペーサーを組んだときの上下それぞれの合計長**（§9.418 追補、
    利用者の指示「設定有効長と、スペーサーを組んだときの上下のそれぞれの合計長を
    表示してほしい」）。軸の寸法を作るのはスペーサーと刃だけなので、その2つの和。
    **差も一緒に出す**——合っているかを引き算させない（§CLAUDE 2）。 */
 function lengths() {
  const el = $h('.bs-len3');
  if (!el) return;
  const pk = D3.pack;
  if (!D3.cut || !pk || !pk.arbor) { el.hidden = true; return; }
  const mm = v => (+v).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  /* **足りないぶんはDS端のフローティングシートが押さえる**（§9.456、利用者の指示
     「有効長に近づいたときにDSからOS側にフローティングシートで押さえるので、DSエンドまでの
     隙間は発生しない」）。以前は `(-0.05)` と差で出しており、足りない＝隙間に読めた。
     **超えたときだけ**差を出す（有効長を超える積みは組めない）。 */
  /* 押さえ代（§9.457）を超えたら、そう言う（吸えない＝隙間）。 */
  const stroke = BS().floatStroke(ctx && ctx.M);
  const gap = v => {
   const d = +(v - pk.arbor).toFixed(3);
   if (d > 0) return `<s>(+${mm(d)} 超過)</s>`;
   if (d === 0) return '';
   return `<s>＋フローティングシート ${mm(-d)}${stroke > 0 && -d > stroke + 1e-6 ? `（押さえ代 ${mm(stroke)} 超過）` : ''}</s>`;
  };
  el.innerHTML = `<s>有効長</s><i>${mm(pk.arbor)}</i>`
   + `<s>／上軸</s><i>${mm(pk.sumU)}</i>${gap(pk.sumU)}`
   + `<s>／下軸</s><i>${mm(pk.sumL)}</i>${gap(pk.sumL)}`;
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
    D3.cutAz = 0; D3.cutEl = 0; setCutZoom(1);
    D3.moved = false; Object.assign(CAM, HOME); render(); return undefined;
   }
   if (b.dataset.show) return toggleShow(b);
   if (b.dataset.hide) return pickHide(b);
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
 /* 消した部材の見せ方の呼び名（§9.422）。**画面の札と同じ言葉**を1箇所に持つ
    ——知らせの文が「消しました」で終わると、薄く残っている物を見て
    「消えていない」と読まれる。 */
 const HIDE_WORD = { gone: '出しません', ghost: '薄く残します', wire: '線だけで描きます' };
 /* 見せる部材の入切。**言葉は部材の名前で固定**し、点が付いているかどうかで
    入切を示す（押すたびに言葉が変わると読み違える）。 */
 function toggleShow(b) {
  const key = b.dataset.show;
  const on = D3.show[key] = !D3.show[key];
  b.classList.toggle('is-on', on);
  b.setAttribute('aria-pressed', String(on));
  build();
  /* 消したときは**いまの隠し方まで**言う（§9.422、§CLAUDE 6）。同じ「非表示」でも
     画面に残るかどうかが違うので、言わないと「効いていない」と読まれる。 */
  note(on ? `${b.dataset.showName || key}を表示にしました。`
          : `${b.dataset.showName || key}を非表示にしました（${HIDE_WORD[D3.hide]}）。`);
  return undefined;
 }
 /* 消した部材の見せ方を選ぶ（§9.422、利用者の指示）。**1つだけ選ぶ**ので
    セグメント（押した札のほうが濃い）で、入切のトグルとは作りを分ける（§9.247）。 */
 function pickHide(b) {
  const key = b.dataset.hide;
  if (!key || !(key in HIDE_WORD) || D3.hide === key) return undefined;
  D3.hide = key;
  paintHide();
  build();
  const off = Object.keys(D3.show).filter(k => !D3.show[k]).length;
  note(`消した部材は${HIDE_WORD[key]}。`
     + (off ? '' : '（いまは何も消していないので、「表示」で切ったときに効きます）'));
  return undefined;
 }
 /* 選んだ見せ方の札を塗る。**帯のHTMLは`ensurePanel()`が一度だけ作って使い回す**
    ので（開き直しても作り直されない）、塗るのは押されたときだけでよい。 */
 function paintHide() {
  if (!host) return;
  host.querySelectorAll('[data-hide]').forEach(el => {
   const on = el.dataset.hide === D3.hide;
   el.classList.toggle('is-on', on);
   el.setAttribute('aria-pressed', String(on));
  });
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
 async function setMode(on, kind, next) {
  /* **切り替えの通し番号**（§9.428）。部品の読み込みを待つあいだに別の図を
     押されたら、遅れて戻ってきたほうは何もしない。 */
  const seq = ++D3.seq;
  const wantCut = kind === 'cut';
  D3.cut = wantCut;
  D3.on = !!on;
  /* **いまの割付はここで受ける**（§9.428）。以前は画面が`sync()`を呼んでから
     `setMode()`を呼んでいたので、`sync()`が**前の図のまま**1回組んで1枚描き、
     そのあとここで組み直していた——同じ割付を2回組み、あいだに「切り替えた
     のに前の図」の1枚が挟まる。受け取るのはこの1箇所にして、組むのは1回。 */
  if (next) { ctx = next; D3.dirty = true; }
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
   /* **待っているあいだに別の図を押されていたら、ここで描かない**（§9.428）。
      `D3.cut`はもう次の図のものなので、この続きで組むと押した図と食い違う。 */
   if (seq !== D3.seq) return false;
   if (!ok) {
    fail('立体図を表示する部品（three.js）を読み込めませんでした。<br>'
       + `取りに行った先: ${esc(THREE_SRC)}<br><b>模式図はそのまま使えます。</b>`);
    return false;
   }
  }
  if (!init()) return false;
  /* 切り口の面は**断面図のときだけ**作るので、行き来したら組み直す。 */
  /* 組み直すのは「割付が変わった」か「**組んである図が違う**」ときだけ。
     行き来しても組み直さない、は§9.412のまま（同じ模型を使い回す）。 */
  if (D3.dirty || D3.builtCut !== D3.cut) build(); else { applyCut(); render(); }
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
           /* 組んだ回数と、組んである図（§9.428）。**網はここを見る**——
              「切り替えのたびに2回組んでいないか」「描いている絵が選んだ図か」は
              絵を見ても分からない。`fixups`は`render()`が食い違いを直した回数。 */
           builds: D3.builds | 0, builtCut: D3.builtCut, fixups: D3.fixups | 0,
           /* 台車がいま回っているか。断面図では**回さない**のが決まり（§9.412）。 */
           rotY: D3.pivot ? D3.pivot.rotation.y : 0,
           cutAz: D3.cutAz, cutEl: D3.cutEl, marks: (D3.marks || []).length,
           /* 断面図の倍率（§9.463）。`cutSc`＝1pxあたりの世界の長さ・`cutOff`＝図の中心のずれ(px)。 */
           cutZoom: D3.cutZoom, cutPan: [D3.cutPanX, D3.cutPanY],
           cutSc: D3.cutView ? D3.cutView.sc : null, cutOff: D3.cutView ? D3.cutView.off : null,
           /* 区間の記号の数（§9.417）。模式図と同じ対応表から出しているので、
              模式図の記号の数と一致するはず——網が突き合わせる。 */
           zones: (D3.cut ? (D3.zmarks || []) : []).length,
           /* 寸法の層（§9.418）。出した字の内訳と、刃のずれを広げた量。 */
           dims: D3.dimShown || null, knives: (D3.knives || []).length,
           cutLines: D3.cutLines | 0, spanLine: D3.spanLine || null,
           /* 詰めの事実と、行き先を間違えた物の数（§9.418）。 */
           pack: D3.pack || null, stray: D3.stray | 0,
           /* 消した部材の見せ方と、その結果（§9.422）。`skinned`＝薄く／線だけで
              残っている物の数、`mesh`＝組み立てている物の数。 */
           hide: D3.hide, skins: skinCount(),
           dimSep: D3.dimSep || 0,
           /* 断面図で刃先のあいだに空けた隙間と、板が占める高さ（§9.413 追補）。
              **板がめり込まないこと**を網が数字で見るための2つ。 */
           cutGap: D3.cutGap || 0, matSpan: (D3.matTh || 0) * 2, matMag: D3.matMag || 1,
           /* 断面図の光が**カメラと同じ側に居るか**を網が見るための2つ（§9.413 追補）。
              離れると、回した先の面が黒くなって穴に見える。 */
           endCaps: D3.endCaps || 0,
           /* フローティングシート（§9.459）。上下軸に1つずつ・ピストン18本ずつ・
              押さえ板の面の位置（有効長の中心からの x）と押さえている量。 */
           fseat: D3.fseat || null,
           /* 光の配分（§9.415）。**断面図の配分が立体図のまま残っていないか**を
              網が数で見る——残ると切り口が白へ飛ぶ。 */
           lit: D3.lights ? { hemi: D3.lights.hemi.intensity, key: D3.lights.key.intensity,
                              fill: D3.lights.fill.intensity, cam: D3.lights.cam.intensity }
                          : null,
           cutCam: D3.ocam ? [D3.ocam.position.x, D3.ocam.position.y, D3.ocam.position.z] : null,
           cutLit: D3.cutLight
            ? [D3.cutLight.position.x, D3.cutLight.position.y, D3.cutLight.position.z] : null,
           /* **組んである模型はいまの割付の物か**（§9.433）。図を切り替えた直後・
              割付を変えた直後に「前の物のまま」が場面に残っていないかを、網が
              1つの真偽で見られるようにする。 */
           stale: !!(D3.built && ctx && D3.builtRes !== ctx.res),
           /* **組んである切り口は今の向きの物か**（§9.437）。食い違うと切り口の
              面が切り落とされる側に残り、殻だけの「立体図と同じ絵」になる。 */
           builtKeep: D3.builtKeep == null ? null : D3.builtKeep,
           capSide: (D3.cut && D3.capZ != null) ? (Math.sign(D3.capZ) === keepSide()) : null,
           capZ: D3.capZ == null ? null : +D3.capZ.toFixed(2),
           /* 材料と刃の食い違い（§9.433）。同じ割付から出ていれば必ず0。 */
           matOff: D3.cut ? (D3.matOff || 0) : 0,
           hudFit: D3.cut ? (D3.hudFit || null) : null,
           ortho: !!(D3.cut && D3.ocam), clips: D3.r ? (D3.r.clippingPlanes || []).length : 0 };
 }

 WL.bladeSolid = {
  attach, sync, setMode, render, spinTo, note, blockReason, view,
  get on() { return D3.on; },
  get ready() { return !!D3.r; },
  get show() { return Object.assign({}, D3.show); },
  get hide() { return D3.hide; },
  get stage() { return { out: D3.out, open: D3.open, rot: D3.rot }; },
  THREE_SRC
 };
})();
