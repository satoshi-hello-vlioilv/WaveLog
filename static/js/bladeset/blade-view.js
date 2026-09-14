/* blade-view.js: 刃組ガイダンスの画面（§9.377）。

   計算は`blade-core.js`（`WL.bladeSet`）が持ち、ここは**出すことだけ**を行う。
   利用者から預かった1枚のHTMLの画面構成をそのまま移し、色・文字・余白・
   重なり順はWaveLogのトークンへ寄せた（§CLAUDE「見た目の値はトークンから選ぶ」）。

   画面の作り（視覚導線＝作業導線・§CLAUDE 14）
     上の帯 … ①バリ方向 →②刃・板厚 →③幅構成 →④ゴムリング（決める順）
     左     … 刃組図（何をどう組むか）→ 刃組表（何を何枚）
     右     … 所要・段取（あと何が要るか／台車の差分／刃の状態）

   入口は2つで、**どちらも同じ`open()`**:
     ・左メニュー「刃組ガイダンス」
     ・作業スケジュールの設備停止の行（連携機能＝刃組ガイダンス。§9.377）
       ——このときは**後ろに並ぶ作業の元コイル幅・切断幅・板厚を持ってくる**
       （思い出させない・§CLAUDE 冒頭）。
*/
(function(){
 'use strict';
 const WL = (window.WL = window.WL || {});
 const BS = () => WL.bladeSet;

 /* ---------- 状態（画面で選んでいる条件。保存はしない） ---------- */
 const st = {
  equipment: '',
  align: 'none', canNk: true, nkWidth: 30,
  knife: 318.2, thick: 1.3, tk: 10, clr: 0.15, ov: 0.2,
  /* クリアランスは**板厚の10%が基本**（§9.378、利用者の指示）。板厚を変えたら
     引き直す。手で打った時点で `clrAuto` を落とし、以降は触らない——利用者が
     入れた値を「保存されていない既定」にしない（§9.367 と同じ考え方）。 */
  clrAuto: true,
  W: 1170, trimMode: 'even', osTrim: 20,
  lots: [{ name: 'LOT1', w: 279.8, n: 4 }],
  order: [0, 0, 0, 0],
  bigMode: 'auto', smallMode: 'auto', bigTh: 39.5, smallTh: 38.0,
  /* 刃組の道具なので、はじめから段取り向き（DS左＝部材を入れる側から見た並び）。 */
  carriage: 'A', bladeGroup: '', flip: true
 };
 let M = null, IX = null, LAST = null;
 let panel = null, railTab = 'ends', loadToken = 0;
 let seededFrom = null;     /* どの予定から開いたか（画面に出どころを出す） */
 /* 予定から拾えなかった行の数（分割ありで子ロットの切断巾が読めない等）。
    **0で埋めずに件数を言う**（§9.231・§CLAUDE 4）——黙って落とすと、
    条が1本足りないことに現場が気づけない。 */
 let seededSkip = 0;
 /* 予定から運んだ「本数・1本目の材料」（§9.382）。刃組の記録へそのまま残す。 */
 let seededRun = null;
 /* どの段取りの行から開いたか（§9.383）。記録と予定の行を結ぶ鍵。 */
 let seededStopId = '';

 /* ---------- 幅ごとの色 ----------
    最大9種の条幅が入り混じっても見分けられるよう、淡い塗りで差を付ける。
    **色はトークンから選ぶ**（§CLAUDE 7）——`--look-*`／`--rs-*`の並びを使い、
    16進をこのファイルへ足さない。塗り／縁は`--bs-w<i>-bg`／`--bs-w<i>-fg`。 */
 const WIDTH_COLORS = 9;

 /* ---------- 図の色 ----------
    SVGの`fill`は属性なので、CSSのトークンをそのまま書けない。**器が宣言した
    `--bs-fig-*`を1回だけ読み取って**使う（`measure-opdata.js`の`carryLook()`と
    同じ作法）。ゴムリングの色だけは**マスタの値**なので、ここには入れない。 */
 const FIG_VARS = ['shaft', 'shaft-edge', 'cap', 'spacer', 'spacer-edge',
                   'filler', 'filler-edge', 'knife', 'knife-edge', 'badge',
                   'strip', 'strip-edge', 'scrap', 'scrap-edge', 'trim',
                   'trim-edge', 'finger', 'label', 'ink', 'sheen',
                   'chip-bg', 'chip-fg', 'chip-bd',
                   'chip-clr-bg', 'chip-clr-fg', 'chip-clr-bd',
                   'chip-ov-bg', 'chip-ov-fg', 'chip-ov-bd'];
 function figPalette(host) {
  const cs = getComputedStyle(host), o = {};
  FIG_VARS.forEach(k => { o[k] = (cs.getPropertyValue('--bs-fig-' + k) || '').trim(); });
  for (let i = 0; i < WIDTH_COLORS; i++) {
   o['w' + i] = (cs.getPropertyValue(`--bs-w${i}-bg`) || '').trim();
   o['w' + i + 'e'] = (cs.getPropertyValue(`--bs-w${i}-fg`) || '').trim();
  }
  return o;
 }

 /* ====================== 画面の骨組み ====================== */
 function ensurePanel() {
  if (panel) return panel;
  panel = document.createElement('section');
  panel.className = 'bs-shell';
  panel.id = 'bladeSetPanel';
  panel.hidden = true;
  panel.innerHTML = `
   <div class="bs-empty" id="bsEmpty" hidden></div>
   <div class="bs-bar" id="bsBar">
    <!-- 出どころ＝**戻り道**（§9.378、利用者の指示「段取りから刃組画面に行った
         場合、段取りに戻りたいはずですが戻れない」）。どこから来たかと、そこへ
         戻る手立ては**同じ1つの的**にする（同じ情報を2箇所に出さない・§CLAUDE 8）。
         読む順の先頭＝戻る、に置く（§CLAUDE 14 視覚導線と作業導線を一致させる）。
         左メニューから開いたときは戻り先が無いので**ボタンごと出さない**
         （押せるのに何も起きない的を作らない・§CLAUDE 4）。 -->
    <button type="button" class="bs-back" id="bsFrom" hidden></button>
    <span class="bs-skip" id="bsSkip" hidden></span>
    <!-- 決める → 確かめる → 自動で決まる の順に置く（§CLAUDE 14 視覚導線と
         作業導線を一致させる）。**群の名前を出す**ので、どれを触ればよいかを
         色や枠だけに頼らず字でも読める（§CLAUDE 3）。 -->
    <div class="bs-steps" id="bsSteps">
     <div class="bs-sgrp is-decide"><s class="bs-sgcap">決める</s>
      ${stepHtml(1, 'バリ方向', 'bsV1', step1Html(), 'decide')}
      ${stepHtml(2, '幅構成', 'bsV3', step3Html(), 'decide')}
     </div>
     <div class="bs-sgrp is-check"><s class="bs-sgcap">確かめる</s>
      ${stepHtml(0, '刃・板厚', 'bsV2', step2Html(), 'check')}
     </div>
     <div class="bs-sgrp is-auto"><s class="bs-sgcap">自動で決まる</s>
      ${factHtml('刃の選び方', 'bsFPick')}
      ${factHtml('方式', 'bsFMethod')}
      ${factHtml('保持', 'bsFHold')}
      ${factHtml('クリアランス', 'bsFClr')}
      ${stepHtml(0, 'ゴムリング', 'bsV4', step4Html(), 'auto')}
     </div>
    </div>
   </div>
   <div class="bs-body">
    <div class="bs-col">
     <!-- 刃組表を上に置く（§9.378、利用者の指示「刃組表を上部に移動して、
          準備する刃やスペーサやゴムリングなどを最も見やすく」）。
          **先に読むものを先に置く**——組む前に見るのは「何をどこへ何枚」で、
          図はそれを確かめるためのもの（§CLAUDE 14 視覚導線と作業導線を一致）。 -->
     <section class="bs-panel bs-tblpanel">
      <div class="bs-ph"><h2>刃組表</h2><span class="bs-ph-note">横＝寸法／縦＝上下軸×ロット</span></div>
      <div class="bs-tw" id="bsTables"></div>
     </section>
     <section class="bs-panel bs-figpanel">
      <div class="bs-ph"><h2>刃組図</h2>
       <!-- 模式図／立体図（§9.377 追補）。**同じ割付から**作るので、どちらを
            見ても食い違わない。立体図の部品（three.js）は**押したときだけ**
            取りに行く（起動を遅くしない・回線が無くても模式図は使える）。 -->
       <div class="bs-seg" id="bsFigTabs">
        <button type="button" class="bs-chip is-on" data-fig="2d">模式図</button>
        <button type="button" class="bs-chip" data-fig="3d">立体図</button>
       </div>
       <!-- **向きの切り替えは図の見出しへ置く**（§9.380、利用者の指示
            「OSDS入替ボタンは模式図に移動させて」）。効く先はこの図の
            左右（DS／OSの字と部材の並び）なので、手順バーの尻尾に置くと
            「何に効くボタンか」を探すことになる（§CLAUDE 14 視覚導線と
            作業導線を一致させる）。 -->
       <button type="button" class="bs-chip" id="bsFlip" title="刃組は台車のDS側から部材を入れます。段取り向きではDSを左に置き、手を入れる側から見た並びにします">図面向き（OS左）</button>
       <span class="bs-ph-note" id="bsFigNote"></span></div>
      <!-- **両脇の表は右レールへ移した**（§9.379、利用者の指示）。ここを1列に
           したぶん模式図が広がる（実測 760→1112px・+46%）。端部の表は
           「組む前に一度見る」もので、模式図のように常時見比べるものでは
           ない——常時載せる面積は「頻度 × 重要度」で配る（§CLAUDE 1）。 -->
      <div class="bs-figrow" id="bsFigRow">
       <div class="bs-figmain">
        <div class="bs-stage"><svg id="bsStage" viewBox="0 0 1000 300"
         preserveAspectRatio="xMidYMid meet" role="img" aria-label="刃組図"></svg></div>
        <div class="bs-stage3" id="bsStage3" hidden>
         <canvas class="bs-c3"></canvas>
         <span class="bs-t3 bs-t3-os is-os" hidden title="OS 側。刃組ではこちらへ詰めていきます">OS</span>
         <span class="bs-t3 bs-t3-ds is-ds" hidden title="DS 側。軸端部を外し、こちらから部材を入れます">DS</span>
         <div class="bs-hud is-tl"><div class="bs-o3" hidden></div></div>
         <div class="bs-hud is-tr">
          <button type="button" class="bs-hlp bs-help3" aria-expanded="false">使い方</button>
          <div class="bs-hpop" hidden>
           <dl>
            <dt>段取りの順</dt>
            <dd>①引き出す（レールで回転テーブルへ）→②軸端部を外す（330mm 送り出し、
              テーブルの外の土台に降ろす）→③台車を回す（テーブルごと 180°）</dd>
            <dt>向き</dt>
            <dd>DS 側から部材を入れ、OS 側へ詰めます。材料の入側は、ラインを正面に見て左です。</dd>
            <dt>視点</dt>
            <dd>ドラッグ＝回す／ホイール＝寄る／Shift＋ドラッグ（または右ドラッグ）＝平行移動／
              「視点を戻す」で元へ</dd>
            <dt>表示</dt>
            <dd>下で板・刃・ゴムリング・スペーサーを消せます。点が付いているものが出ています。</dd>
           </dl>
          </div>
         </div>
         <div class="bs-hud is-bot">
          <div class="bs-hud-grp"><span class="bs-hud-cap">表示</span>
           <button type="button" class="bs-tg is-on" data-show="mat" data-show-name="板" aria-pressed="true">板</button>
           <button type="button" class="bs-tg is-on" data-show="knife" data-show-name="刃" aria-pressed="true">刃</button>
           <button type="button" class="bs-tg is-on" data-show="ring" data-show-name="ゴムリング" aria-pressed="true">ゴムリング</button>
           <button type="button" class="bs-tg is-on" data-show="liner" data-show-name="スペーサー" aria-pressed="true">スペーサー</button>
          </div>
          <div class="bs-hud-grp"><span class="bs-hud-cap">段取り</span>
           <button type="button" class="bs-btn is-sm is-on bs-step3-pull">①ラインへ戻す</button>
           <button type="button" class="bs-btn is-sm is-on bs-step3-open">②軸端部を戻す</button>
           <button type="button" class="bs-btn is-sm bs-step3-spin">③台車を回す</button>
           <span class="bs-hud-sep"></span>
           <button type="button" class="bs-btn is-sm bs-step3-reset">視点を戻す</button>
          </div>
         </div>
         <div class="bs-m3" hidden></div>
         <div class="bs-ng3" hidden></div>
        </div>
       </div>
      </div>
     </section>
    </div>
    <aside class="bs-rail" id="bsRail">
     <div class="bs-ph"><h2>刃組の内訳</h2>
      <div class="bs-seg" id="bsRailTabs">
       <button type="button" class="bs-chip is-on" data-r="ends">端部</button>
       <button type="button" class="bs-chip" data-r="bom">所要</button>
       <button type="button" class="bs-chip" data-r="diff">台車差分</button>
       <button type="button" class="bs-chip" data-r="set">刃の状態</button>
      </div></div>
     <div class="bs-pb">
      <!-- 端部（OS端／DS端）。表そのものは renderEnds() が id で書き込むので、
           置き場所を変えても描き手は変わらない。 -->
      <div data-p="ends">
       <div class="bs-side" id="bsOsSide"></div>
       <div class="bs-side" id="bsDsSide"></div>
       <p class="bs-note">最外刃より外の区間です。<b>OS</b>から先に取り付け、<b>DS</b>が最後になります。</p>
      </div>
      <div data-p="bom" hidden>
       <div class="bs-gauges" id="bsGauges"></div>
       <div class="bs-need" id="bsBom"></div>
      </div>
      <div data-p="diff" hidden>
       <!-- 完了に必要なのは「どの台車へ」と「どの刃セットで」の2つ（§9.378）。
            **員数・条件・条の設計は計算とマスタから入る**ので、人が決めるのは
            ここだけ——決める場所を1つにまとめ、完了のボタンのすぐ上に置く。 -->
       <div class="bs-carbar"><span class="bs-lbl">台車</span>
        <button type="button" class="bs-chip is-on" data-car="A">A</button>
        <button type="button" class="bs-chip" data-car="B">B</button>
        <span class="bs-lbl">刃セット</span>
        <select id="bsSetPick" class="bs-sel is-sm"></select></div>
       <div id="bsDiffHead"></div><div id="bsDiffSum"></div>
       <table class="bs-l" id="bsDiff"></table>
       <button type="button" class="bs-btn is-primary bs-wide" id="bsSaveCar">刃組完了：台車 A として記録</button>
       <div class="bs-gh">刃組の履歴</div>
       <div id="bsHist"></div>
       <p class="bs-note">2台の台車を交互に使う前提です。直前の刃組はラインで稼働中のため、いま組み替える台車には<b>2回前</b>の構成が載っています。<b>＋</b>が持ち出す点数、<b>−</b>が外して戻す点数です。</p>
      </div>
      <div data-p="set" hidden><div id="bsSetAlerts"></div><div id="bsSetList"></div></div>
     </div>
     <!-- 足元の一言（§CLAUDE 2「次にすることを常に1つだけ指す」）。**どの段を
          開いていても見える**——在庫の下限割れ・研磨の遅れ・使用限界は、
          段の裏に畳むと気づかれない。中身そのものは「刃の状態」が持ち、
          ここは件数と行き先だけを言う（同じ情報を2箇所に出さない・§CLAUDE 8）。 -->
     <div class="bs-rail-foot" id="bsFoot"></div>
    </aside>
   </div>`;
  const host = document.querySelector('main') || document.body;
  host.appendChild(panel);
  wire();
  return panel;
 }

 /* 手順の札（§9.378、利用者の指示「決めるべき項目とそうでない項目がしっかり
    分かれてわかりやすく」「自動的に間違いなく決まるもの／自動だけど変更の
    可能性があるもの／手動で決めるものの3種類」）。
    `kind` は3つだけ:
      decide … 人が決める（オーダーの要求。番号を振り、いちばん強く出す）
      check  … 予定・マスタから入るが、変える可能性がある（確かめる）
      auto   … 入力から一意に決まる（ふだん触らない。番号を振らない）
    **番号は「決めるもの」から通しで振る**——番号は作業の順番であって、
    項目の通し番号ではない（自動で決まるものに番号を振ると、順番に触るものだと読める）。 */
 const stepHtml = (n, name, valId, body, kind) =>
  `<div class="bs-step is-${kind}" data-step="${valId}">
    <button type="button" class="bs-step-btn" data-step-open="${valId}">
     ${n ? `<span class="bs-step-no">${n}</span>` : ''}
     <span class="bs-step-tx"><b>${name}</b><span id="${valId}">—</span></span></button>
    <div class="bs-pop">${body}</div>
   </div>`;
 /* 自動で一意に決まり、押しても変えられないもの。**押せる顔をさせない**
    （§CLAUDE 4 押せるのに何も起きないボタンを残さない）。 */
 const factHtml = (name, valId) =>
  `<span class="bs-fact"><s>${name}</s><b id="${valId}">—</b></span>`;

 const step1Html = () => `
  <h3>製品のバリ方向</h3>
  <p class="bs-lead">最初に決めるのは、製品のバリをどちら向きに揃えるかです。</p>
  <div class="bs-opts" id="bsAlign">
   <label data-v="down"><input type="radio" name="bsAl" value="down">
    <span><b>下バリに揃える</b><small>全ての製品条のバリを下向きに統一します。</small></span></label>
   <label data-v="up"><input type="radio" name="bsAl" value="up">
    <span><b>上バリに揃える</b><small>全ての製品条のバリを上向きに統一します。</small></span></label>
   <label data-v="none"><input type="radio" name="bsAl" value="none" checked>
    <span><b>揃えない</b><small>バリ方向を指定せず、通常の千鳥で組みます。</small></span></label>
  </div>
  <label class="bs-sw"><span>このラインは中抜きができる</span><input type="checkbox" id="bsCanNk" checked></label>
  <div class="bs-derived" id="bsDerived"></div>
  <div class="bs-f" id="bsNkBox" hidden><label for="bsNkWidth">屑条の幅</label>
   <input type="number" id="bsNkWidth" step="1" min="1"><small>mm</small></div>
  <p class="bs-note" id="bsHint1"></p>`;

 const step2Html = () => `
  <h3>刃と板厚</h3>
  <p class="bs-lead">刃マスタから選ぶと、径と刃厚が入ります。</p>
  <div class="bs-f"><label for="bsBladePick">刃マスタから呼出</label><select id="bsBladePick"></select></div>
  <div class="bs-g2">
   <div class="bs-f"><label for="bsKnife">ナイフ径</label><input type="number" id="bsKnife" step="0.1"><small>mm</small></div>
   <div class="bs-f"><label for="bsThick">板厚</label><input type="number" id="bsThick" step="0.1"><small>mm</small></div>
  </div>
  <div class="bs-g3">
   <div class="bs-f"><label for="bsTk">刃厚</label><input type="number" id="bsTk" step="1" min="1"><small>mm</small></div>
   <div class="bs-f"><label for="bsClr">クリアランス</label><input type="number" id="bsClr" step="0.01" min="0"><small>mm</small></div>
   <div class="bs-f"><label for="bsOv">ラップ</label><input type="number" id="bsOv" step="0.05" min="0"><small>mm</small></div>
  </div>
  <p class="bs-note">同じ切断で向かい合う上下の刃は、軸方向に<b>クリアランスのぶんだけ</b>＝<b id="bsDVal">—</b> mm ずれます。そのため上下のスペーサー長はどちらも板幅に近く、違いは<b>中間の区間でクリアランス×2</b>、<b>端部の区間は切断が片側だけなのでクリアランス×1</b> になります。</p>
  <p class="bs-note" id="bsHold2"></p>`;

 const step3Html = () => `
  <h3>元板とロット</h3>
  <p class="bs-lead">元板巾に対する条の割付を確認します。</p>
  <div class="bs-g2">
   <div class="bs-f"><label for="bsW">元板巾 W</label><input type="number" id="bsW" step="0.1"><small>mm</small></div>
   <div class="bs-f"><label for="bsOsTrim">OS耳</label><input type="number" id="bsOsTrim" step="0.05" min="0" disabled><small>mm</small></div>
  </div>
  <label class="bs-sw"><span>耳を左右均等にする（板はセンター通し）</span><input type="checkbox" id="bsTrimEven" checked></label>
  <table class="bs-lot" id="bsLotTbl"></table>
  <button type="button" class="bs-btn bs-wide" id="bsAddLot">ロットを追加</button>
  <div class="bs-ordbox">
   <div class="bs-ordh"><b>条の並び</b><span class="bs-ordn" id="bsOrdN"></span>
    <button type="button" class="bs-btn is-sm" data-ord="lot">ロット順</button>
    <button type="button" class="bs-btn is-sm" data-ord="wide">幅の大きい順</button></div>
   <div class="bs-ord" id="bsOrdList"></div>
   <p class="bs-ordhint" id="bsOrdHint"></p>
  </div>
  <div class="bs-kpis" id="bsKpis"></div>
  <!-- **条の設計＝ここで決めた並び**（§9.381、利用者の指示「刃組ガイダンスから
       設定した条の設計は、測定するときにも活かせるように連携してください」）。
       元板巾・ロット・幅・本数・並びの5つがそのまま条の設計なので、**別の画面を
       作らず、決めたその場で記録する**（§CLAUDE 14 視覚導線と作業導線を一致）。
       記録すると測定画面がこの並びで条を埋める。 -->
  <div class="bs-dz">
   <div class="bs-dzh"><b>条の設計</b><span class="bs-dzs" id="bsDsState">—</span></div>
   <p class="bs-note" id="bsDsNote"></p>
   <button type="button" class="bs-btn is-primary bs-wide" id="bsDsSave">この並びを条の設計として記録する</button>
  </div>
  <p class="bs-note" id="bsHint3"></p>`;

 const step4Html = () => `
  <h3>ゴムリング</h3>
  <p class="bs-lead">同じ条の両側は必ず同じリングになります。</p>
  <div class="bs-ring-row">
   <b>大径</b>
   <button type="button" class="bs-chip is-on" data-ring="big" data-mode="auto">自動</button>
   <button type="button" class="bs-chip" data-ring="big" data-mode="manual">手動</button>
   <span class="bs-rd"><i id="bsBigChip"></i><span id="bsBigTag">—</span></span>
  </div>
  <div class="bs-f"><select id="bsBigSel" disabled></select></div>
  <div class="bs-ring-row">
   <b>小径</b>
   <button type="button" class="bs-chip is-on" data-ring="small" data-mode="auto">自動</button>
   <button type="button" class="bs-chip" data-ring="small" data-mode="manual">手動</button>
   <span class="bs-rd"><i id="bsSmChip"></i><span id="bsSmTag">—</span></span>
  </div>
  <div class="bs-f"><select id="bsSmSel" disabled></select></div>
  <p class="bs-note" id="bsHint4"></p>`;

 /* ====================== 読み込み ====================== */
 async function loadContext(equipment) {
  const token = ++loadToken;
  const url = '/api/bladeset/context?equipment=' + encodeURIComponent(equipment || '');
  const r = await api(url);
  /* 取りに行っている最中に別の設備へ移っていたら捨てる（§9.331）。 */
  if (token !== loadToken) return false;
  M = BS().normalize(r);
  IX = BS().buildIndex(M);
  applyStandards();
  return true;
 }
 /* 基準値から**画面の既定値**を入れる。**利用者が触った値は上書きしない**
    （§9.361と同じ約束）——設備を開き直したときだけ入れ直す。 */
 function applyStandards() {
  const P = M.P;
  if (P.bladeThickness != null) st.tk = +P.bladeThickness;
  if (P.clearance != null) st.clr = +P.clearance;
  if (P.overlap != null) st.ov = +P.overlap;
  if (P.scrapWidth != null) st.nkWidth = +P.scrapWidth;
  st.canNk = P.canNakanuki !== false;
  applyBladePick();
 }

 /* 使う刃を決める（§9.379、利用者の指示2）。
      ふつう … 状態が「一般」の刃
      例外 …… `刃選択マスタ` の条件に当たったら、その組の「専用」の刃
    「メンテナンス中」は**どちらでも選ばない**。
    決めたら `st.pick` に「なぜその組か」を残す——画面が理由を出せないと、
    利用者には「勝手に別の刃になった」としか見えない（§CLAUDE 6 出どころを出す）。 */
 function applyBladePick() {
  const BS_ = BS();
  const gen = M.bladeGeneral || '一般', sp = M.bladeSpecial || '専用';
  const hit = BS_.pickGroup(M.picks, BS_.pickCtx(st, M), M.pickFields);
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
 }

 /* ====================== 入口 ======================
    `seed`は作業スケジュールから来る文脈（§9.377）。**渡された項目だけ**入れる
    ——欠けている項目を0で埋めると、そこだけ嘘の値になる（§9.231）。 */
 async function open(opts) {
  const o = opts || {};
  const eq = String(o.equipment || st.equipment || (typeof currentConfiguredEquipment === 'function'
   ? currentConfiguredEquipment() : '') || '').trim();
  WL.enterView('bladeset', { header: ['刃組ガイダンス', eq || '設備が未設定です'] });
  ensurePanel();
  panel.hidden = false;
  const changed = eq !== st.equipment;
  st.equipment = eq;
  seededFrom = o.from || null;
  seededSkip = Math.max(0, (o.seed && o.seed.skipped) | 0);
  /* その段取りで切る本数と、1本目に切る材料（§9.382）。**予定から来た
     ものだけ**を控える——手で開いたときは空のままにして、記録にも
     「予定から開いていない」と分かる形で残す（§9.231 0で埋めない）。 */
  seededStopId = String(o.stopId || '');
  seededRun = (o.seed && (o.seed.planned || o.seed.first))
   ? { planned: Math.max(0, (o.seed.planned) | 0), first: o.seed.first || null }
   : null;
  showEmpty('');
  try {
   await loadContext(eq);
  } catch (e) {
   showEmpty(`刃組マスタを読み込めませんでした：${esc(e && e.message ? e.message : e)}`);
   return;
  }
  if (o.seed) applySeed(o.seed, changed);
  else if (changed) BS().syncOrder(st);
  fillBladePick();
  fillRingSelects();
  paintInputs();
  render();
  /* 画面を出るときに立体図を止めている（`exit`）ので、戻ってきたら選んで
     あった側へ戻す——利用者が選んだ見方を勝手に変えない。 */
  figMode(figKind);
  const miss = missingMasters();
  if (miss) showEmptyMissing(miss);
 }

 /* クリアランスの答えは**ここ1箇所**（§9.378、利用者の指示「目安として板厚の
    10％としておいてもらい、将来的には材質の条件も増える可能性がありますが
    マスタ化するなどでクリアランスマスタから常に取れるようにするつもりです」）。
    いまは率（`刃組基準値マスタ`の`クリアランス率`）×板厚。材質ごとの値が
    要るようになったら、**この関数の中だけ**をマスタ引きへ差し替える。
    桁は板厚と同じ 0.01 まで（測る側が読める桁に合わせる）。 */
 const clearanceRate = () => {
  const r = M && M.P ? +M.P.clearanceRate : NaN;
  return Number.isFinite(r) && r > 0 ? r : 0.1;
 };
 function clearanceFor(t) {
  const v = (+t || 0) * clearanceRate();
  return v > 0 ? +v.toFixed(2) : 0;
 }
 function syncClearance() {
  if (!st.clrAuto) return false;
  const v = clearanceFor(st.thick);
  if (!v || v === st.clr) return false;
  st.clr = v;
  const el = panel && panel.querySelector('#bsClr');
  if (el) el.value = String(v);
  return true;
 }

 /* 予定から持ってきた文脈を当てる。 */
 function applySeed(seed, force) {
  const s = seed || {};
  if (s.thickness > 0) { st.thick = +s.thickness; syncClearance(); }
  if (s.originalWidth > 0) st.W = +s.originalWidth;
  if (Array.isArray(s.lots) && s.lots.length) {
   /* `parent`＝どの親ロットの条か（§9.378）。条の設計は**親ロットで引く**
      ので、ここで落とすと記録先が決められない。分割の無いロットは自分自身。 */
   st.lots = s.lots.map(L => ({ name: String(L.name || 'LOT'), w: +L.w || 0,
                                n: Math.max(1, L.n | 0),
                                parent: String(L.parent || L.name || '') }))
    .filter(L => L.w > 0);
   if (!st.lots.length) st.lots = [{ name: 'LOT1', w: 100, n: 1 }];
   st.order = [];
  }
  void force;
  BS().syncOrder(st);
 }

 /* 「この設備では何が足りないか」。**足りないものを言う**（§CLAUDE 4・6）。 */
 function missingMasters() {
  if (!M) return '';
  const lack = [];
  if (!M.spacers.length) lack.push('スペーサー');
  if (BS().isFinger(st, M)) { if (!M.fingers.length) lack.push('フィンガー'); }
  else if (!M.rings.length) lack.push('ゴムリング');
  if (!M.blades.length) lack.push('刃');
  return lack.join('・');
 }

 function showEmpty(html) {
  const box = panel && panel.querySelector('#bsEmpty');
  if (!box) return;
  box.innerHTML = html ? `<p>${html}</p>` : '';
  box.hidden = !html;
 }
 /* マスタを書けるのは編集モードだけ（`access_mode`）。**押せるのに何も
    起きないボタンを残さない**（§CLAUDE 4）——現場の端末（スケジュールモード）
    からこの画面へ来たときは、押せない代わりに**理由**を書く。 */
 const canEditMaster = () => ((window.accessMode || {}).mode || 'edit') === 'edit';

 function showEmptyMissing(names) {
  const eq = st.equipment || '（設備が未設定）';
  const may = canEditMaster();
  showEmpty(`<b>${esc(eq)} の刃組マスタが足りません（${esc(names)}）。</b>`
   + '刃組図と所要は、登録されている部材だけで組み立てています。'
   + (may
    ? '<span class="bs-empty-acts">'
      + '<button type="button" class="bs-btn is-primary" id="bsSeed">図面どおりの初期セットを登録</button>'
      + '<button type="button" class="bs-btn" id="bsToMaster">マスタ管理を開く</button></span>'
      + '<small>「初期セット」は、このアプリが持っている標準の部材構成'
      + '（刃6・スペーサー26寸法・ゴムリング50・フィンガー4）をこの設備へ登録します。'
      + '<b>既に登録がある種類には足しません。</b></small>'
    : '<small>この端末は<b>スケジュールモード</b>なので、マスタを登録できません。'
      + '編集モードの端末で「マスタ管理 &gt; 刃組」から登録してください'
      + '（刃組図と所要は、いまある部材のままで読めます）。</small>'));
 }

 /* ====================== 描き直し ====================== */
 let pending = 0;
 function scheduleRender() {
  if (pending) return;
  pending = requestAnimationFrame(() => { pending = 0; render(); });
 }

 /* いま選んでいる記号（§9.378）。**描き直すたびに塗り直す**——図も表も
    毎回作り直すので、印だけ残しておかないと選択が消える。 */
 let pickedBadge = '';
 function paintBadgePick() {
  if (!panel) return;
  panel.querySelectorAll('[data-badge]').forEach(el => {
   el.classList.toggle('is-pick', !!pickedBadge && el.dataset.badge === pickedBadge);
  });
 }
 /* **重ねている間だけ**光らせる（§9.378、利用者の指示「クリックしないと強調
    表示しませんが、マウスオーバーしている間だけに変更し…表側からもマウス
    オーバーで模式図側を連動強調」）。押して選ぶ形だと「選んだままにした」
    ことを覚えておく必要があり、解除も手で要る——見比べるだけの操作には重い。
    図でも表でも同じ印（`[data-badge]`）なので、**どちらに重ねても両方光る**。 */
 function pickBadge(b) {
  const next = String(b || '');
  if (pickedBadge === next) return;
  pickedBadge = next;
  paintBadgePick();
 }

 function render() {
  if (!M || !IX || !panel) return;
  const res = BS().solve(st, M, IX);
  LAST = res;
  renderStepBar(res);
  renderStep1(res);
  renderStep3(res);
  renderStep4(res);
  renderOrder();
  drawFigure(res);
  /* 立体図も**同じ割付（res）**から作る（§9.377 追補）。渡すだけで、
     組み直すかどうかは向こうが決める（立体図を出していなければ何もしない）。 */
  if (WL.bladeSolid) {
   WL.bladeSolid.sync({ st, M, res, ringHex: hexOf });
  }
  renderTables(res);
  renderEnds(res);
  renderGauges(res);
  renderBom(res);
  renderDiff(res);
  renderSets();
  paintBadgePick();
 }

 /* ---------- 手順ボタンの現在値（畳んだ状態でも今の条件が読める） ---------- */
 function renderStepBar(res) {
  const B = BS();
  /* **方式は「自動で決まる」の群だけに出す**——以前はバリ方向の値にも
     並べており、同じことを2箇所で言っていた（§CLAUDE 8）。 */
  $('#bsV1').textContent = B.ALIGN_NAME[st.align];
  /* **なぜその刃なのか**を出す（§9.379）。既定は「一般」で、`刃選択マスタ` の
     決まりに当たったときだけ「専用」になる——出どころを書かないと、利用者には
     「勝手に別の刃になった」としか見えない（§CLAUDE 6）。 */
  const pk = $('#bsFPick');
  if (pk) {
   const p0 = st.pick;
   pk.textContent = !p0 ? '一般'
    : (p0.missing ? `一般（${p0.group} の刃が未登録）`
                  : `専用 ${p0.group}`);
   pk.title = !p0 ? 'ふつうの刃（状態が「一般」）から選んでいます。'
    : (p0.missing
       ? `決まり「${p0.rule}」に当たりましたが、${p0.group} の「専用」の刃が`
         + '登録されていないため、一般の刃で描いています。'
       : `決まり「${p0.rule}」に当たったので、${p0.group} の「専用」の刃を使います。`);
   pk.classList.toggle('is-warn', !!(p0 && p0.missing));
   pk.classList.toggle('is-pick-on', !!(p0 && !p0.missing));
  }
  $('#bsFMethod').textContent = B.METHOD_NAME[res.method];
  $('#bsFHold').textContent = B.holdName(st, M);
  $('#bsFClr').textContent = st.clrAuto
   ? `${st.clr.toFixed(2)}（目安: 板厚の${Math.round(clearanceRate() * 100)}%）`
   : `${st.clr.toFixed(2)}（手入力）`;
  $('#bsV2').textContent = `Φ${st.knife.toFixed(1)} / t${st.thick.toFixed(1)}`;
  $('#bsV3').textContent = st.lots.length === 1
   ? `${st.lots[0].w}×${st.lots[0].n}` : `${st.lots.length}ロット`;
  $('#bsV4').textContent = res.finger ? 'フィンガー（不要）'
   : `${colorOf(res.bigOd)}${res.bigOd} / ${colorOf(res.smOd)}${res.smOd}`;
  $('#bsDVal').textContent = res.A.dReal.toFixed(2);
  $('#bsHold2').innerHTML = `板を保持する方式は<b>${B.holdName(st, M)}</b>です。`
   + (res.finger
    ? `板厚 ${st.thick.toFixed(1)} は ${M.P.fingerMax} 未満のため、板押さえ（フィンガー）で保持します。軸はスペーサーのみで構成します。`
    : `板厚 ${st.thick.toFixed(1)} は ${M.P.fingerMax} 以上のため、ゴムリング主体で構成します。`);
  const from = $('#bsFrom');
  if (from) {
   from.hidden = !seededFrom;
   if (seededFrom) {
    from.innerHTML = `<i aria-hidden="true">←</i>`
     + `<span><s>この予定から</s><b>${esc(seededFrom)}</b></span>`;
    from.title = `作業スケジュールへ戻ります（${seededFrom}）`;
   }
   const skip = panel.querySelector('#bsSkip');
   if (skip) {
    const why = '分割ありの親ロット、または切断巾が読めない子ロット';
    skip.hidden = !seededSkip;
    if (seededSkip) skip.textContent = `条にしなかった行 ${seededSkip} 件（${why}）`;
   }
  }
  $('#bsFigNote').textContent = `${B.METHOD_NAME[res.method]}／刃 ${res.A.U.length} 対`;
 }

 function renderStep1(res) {
  const B = BS();
  $('#bsDerived').innerHTML = `<span class="bs-k">この条件で決まる刃組方式</span>`
   + `<b class="bs-v">${B.METHOD_NAME[res.method]}</b>`
   + `<small>${B.METHOD_DESC[res.method]}</small>`;
  $('#bsNkBox').hidden = res.method !== 'nakanuki';
  const ng = [];
  if (res.method === 'nakanuki' && st.nkWidth < st.tk * 2) {
   ng.push(`屑条の幅 ${st.nkWidth} が刃厚×2（${st.tk * 2}）未満です。刃が干渉します。`);
  }
  if (res.A.errs.length) ng.push(`成立しない区間が ${res.A.errs.length} か所あります（${res.A.errs[0].key}）。`);
  if (st.W > res.A.arborLen) {
   ng.push(`元板巾 ${st.W} がアーバー有効長 ${res.A.arborLen} を超えています`
    + `（${(st.W - res.A.arborLen).toFixed(2)} mm 超過）。この板はこのラインに載りません。`);
  }
  $('#bsHint1').innerHTML = ng.length
   ? ng.map(t => `<span class="bs-ng">${esc(t)}</span>`).join('<br>')
   : '現在の条件で刃の干渉はありません。';
 }

 function renderStep3(res) {
  const w = res.A.w, segs = res.segs;
  $('#bsKpis').innerHTML = [
   ['条・屑条 合計', w.total.toFixed(2), ''],
   ['製品条', segs.filter(s => s.type === 'strip').length + ' 本', ''],
   ['OS耳', w.osTrim.toFixed(2), w.osTrim < 0 ? 'is-ng' : ''],
   ['DS耳', w.dsTrim.toFixed(2), w.dsTrim < 0 ? 'is-ng' : ''],
   ['刃 対数', res.A.U.length + ' 対', '']
  ].map(([k, v, cls]) => `<div class="bs-kpi ${cls}"><span>${k}</span><b>${esc(v)}</b></div>`).join('');
  const slip = Math.abs(res.A.slip) < 1e-4 ? ''
   : `<br>材料はアーバー中央から <b>${res.A.slip > 0 ? 'OS' : 'DS'}側へ ${Math.abs(res.A.slip).toFixed(3)} mm</b> 寄せます`
     + `（区間長を手持ちスペーサーの ${res.A.grid} 刻みに合わせるため。耳には影響しません）。`;
  $('#bsHint3').innerHTML = w.ok
   ? `元板巾 ${st.W} ＝ OS耳 ${w.osTrim.toFixed(2)} ＋ 条合計 ${w.total.toFixed(2)} ＋ DS耳 ${w.dsTrim.toFixed(2)}`
     + (w.even ? '<br>板をセンターに通すため耳を左右均等にしています。' : '<br>OS耳を手動指定しています。')
     + slip
   : `<span class="bs-ng">条合計 ${w.total.toFixed(2)} が元板巾 ${st.W} を超えています`
     + `（不足 ${(w.total - st.W).toFixed(2)} mm）。幅・本数を見直してください。</span>`;
  if (w.even) $('#bsOsTrim').value = w.osTrim;
  renderDesignState();
 }

 function renderStep4(res) {
  const finger = res.finger;
  /* **色はカスタムプロパティで渡す**（§9.350／`test_csslint`）——インラインの
     `background`はどのレイヤより強く、CSSから打ち消せなくなる。
     マスタの色そのものは値なので、器の`--bs-dot`へ入れてCSSが使う。 */
  $('#bsBigChip').style.setProperty('--bs-dot', hexOf(res.bigOd));
  $('#bsSmChip').style.setProperty('--bs-dot', hexOf(res.smOd));
  $('#bsBigTag').textContent = finger ? '—' : `${colorOf(res.bigOd)} ${res.bigOd}`;
  $('#bsSmTag').textContent = finger ? '—' : `${colorOf(res.smOd)} ${res.smOd}`;
  $('#bsBigSel').value = st.bigTh;
  $('#bsSmSel').value = st.smallTh;
  $('#bsBigSel').disabled = finger || st.bigMode === 'auto';
  $('#bsSmSel').disabled = finger || st.smallMode === 'auto';
  panel.querySelectorAll('.bs-chip[data-ring]').forEach(b => { b.disabled = finger; });
  $('#bsHint4').innerHTML = finger
   ? `<span class="bs-ng">フィンガー方式のためゴムリングは使いません。</span>板厚を ${M.P.fingerMax} 以上にすると、この設定が効きます。`
   : (IX.ringsByTh.length
    ? 'バリ方向が反転すると、上軸と下軸で大径・小径が入れ替わります。'
    : '<span class="bs-ng">この設備のゴムリングが1本も登録されていません。</span>マスタ管理 &gt; 刃組 &gt; ゴムリング で登録してください。');
 }

 const ringMeta = od => BS().ringMeta(M, IX, od);
 const colorOf = od => ringMeta(od).color || '—';
 const hexOf = od => ringMeta(od).hex || 'transparent';

 /* ---------- ロットの表 ---------- */
 function renderLots() {
  $('#bsLotTbl').innerHTML =
   '<thead><tr><th>ロット</th><th>幅 mm</th><th>本数</th><th></th></tr></thead><tbody>'
   + st.lots.map((l, i) => `<tr>
      <td><input data-lot="${i}" data-k="name" value="${esc(l.name)}"></td>
      <td><input type="number" data-lot="${i}" data-k="w" value="${esc(l.w)}" step="0.05"></td>
      <td><input type="number" data-lot="${i}" data-k="n" value="${esc(l.n)}" step="1" min="1"></td>
      <td><button type="button" class="bs-x" data-del-lot="${i}" aria-label="このロットを外す">×</button></td>
     </tr>`).join('') + '</tbody>';
 }

 /* ---------- 条の並び（つまんで動かす） ---------- */
 function widthColorIndex() {
  const m = new Map();
  st.lots.forEach(L => { const k = (+L.w).toFixed(3); if (!m.has(k)) m.set(k, m.size % WIDTH_COLORS); });
  return m;
 }
 function renderOrder() {
  const order = BS().syncOrder(st), color = widthColorIndex();
  $('#bsOrdN').textContent = `${order.length} 条`;
  const list = $('#bsOrdList');
  list.classList.toggle('is-flip', !!st.flip);
  $('#bsOrdHint').textContent = st.flip
   ? 'DS側（左）から部材を入れます。条はOS側（右）から順に切ります。つまんで動かすと並びが変わります。'
   : 'OS側（左）から順に切ります。つまんで動かすと並びが変わります。';
  list.innerHTML = order.map((li, pos) => {
   const L = st.lots[li], ci = color.get((+L.w).toFixed(3)) || 0;
   return `<span class="bs-oc bs-w${ci}" draggable="true" data-pos="${pos}">`
    + `<span class="bs-on">${esc(L.name)}</span>`
    + `<span class="bs-ow">${(+L.w).toFixed(2)}</span></span>`;
  }).join('');
 }

 /* ====================== 図 ======================
    アーバー全長を viewBox に写して描く。実寸 mm と図の座標の対応は V が持つ。 */
 const FIG = {
  vw: 1000, left: 100, right: 990,
  /* `capW`＝**有効幅の境目に置く青い印**の幅（§9.378、利用者の指示「有効幅の
     両側に目印の青い図形を置くだけにしてください」）。以前は軸を有効幅より
     左右へ 58px 張り出させ、その先端に青を置き、さらに内側へ「積みが続く」
     ことを示す白っぽい張り出し（34px）を入れていた——**青が有効幅の端では
     なく絵の端に居た**ので、有効幅の範囲が比率どおりに見えず、両端に不要な
     図形が2種類入って横幅を食っていた。どちらも消し、器を左右へ広げた
     （中身に使える幅 802 → 890px）。 */
  capW: 15,
  band: 78, topY: 64, openGap: 120,
  matShare: 0.10, reachShare: 2.6, tailGap: 34,
  minKnifePx: 4, capD: 300, growMax: 2.2, textShare: 0.65
 };

 function viewport(A, PAL, ratio) {
  const PW = FIG.right - FIG.left;
  /* 元板がアーバーより広いといった成立しない入力でも、枠の外へ描き出さない。 */
  const x0 = Math.min(0, A.matStart), x1 = Math.max(A.arborLen, A.matStart + st.W);
  const T = Math.max(1, x1 - x0);
  const dir = st.flip ? -1 : 1;
  const px = mm => (st.flip ? FIG.right - (mm - x0) / T * PW : FIG.left + (mm - x0) / T * PW);
  const pw = mm => mm / T * PW;
  const knifeD = st.knife;
  const bigD = BS().odFromTh(M, st.bigTh), smallD = BS().odFromTh(M, st.smallTh);
  const spacerD = +M.P.spacerOD || 240, shaftD = +M.P.shaftDia || 200;
  const maxD = Math.max(knifeD, bigD, spacerD, 322);
  const unit = FIG.topY + FIG.band / 2 + FIG.band * knifeD / maxD + FIG.openGap
             + FIG.band / 2 + FIG.tailGap;
  /* `grow` は**縦の詰まり具合**だけを決める（§9.378 の実測）。描画は
     `preserveAspectRatio` で必ず横幅に律速される（viewBox 1000 幅 →
     器の幅いっぱい）ので、ここをいじっても**図は1pxも広がらない**。
     横を広げたいときに動かすのは器の側（`--bs-side-w`）。 */
  const grow = Math.max(1, Math.min(FIG.growMax, FIG.vw * ratio / unit));
  const ts = 1 + (grow - 1) * FIG.textShare;
  const band = FIG.band * grow, hOf = d => band * d / maxD;
  const upC = FIG.topY * grow + hOf(maxD) / 2;
  const loC = upC + hOf(knifeD) + FIG.openGap * grow;
  return { PW, T, px, pw, dir, hOf, maxD, knifeD, bigD, smallD, spacerD, shaftD, grow, PAL,
    fs: n => +(n * ts).toFixed(1),
    matH: FIG.openGap * grow * FIG.matShare,
    upC, loC, midY: (upC + loC) / 2, vh: unit * grow,
    kw: Math.max(FIG.minKnifePx, pw(st.tk)),
    ringHex: t => hexOf(t === 'big' ? bigD : smallD) };
 }

 /* 軸に通す部材1個。径をそのまま高さに写すので、太い部材ほど背が高く見える。 */
 function block(V, cx, cy, w, dia, fill, stroke, label) {
  const h = V.hOf(dia);
  let o = `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="2"`
   + ` fill="${fill}" stroke="${stroke || V.PAL['spacer-edge']}"/>`;
  if (label && w > 15) {
   o += `<text x="${cx}" y="${cy + V.fs(8)}" text-anchor="middle" font-size="${V.fs(21)}"`
    + ` font-weight="800" fill="#fff" stroke="${V.PAL.ink}" stroke-width="${V.fs(2.6)}"`
    + ` style="paint-order:stroke">${label}</text>`;
  }
  return o;
 }
 function rowLabel(V, name, cy, fill) {
  /* **青い印のぶんまで避ける**（§9.380、利用者の指摘「上軸、下軸の文字が図と
     被っている」）。§9.378 で青い印を有効幅の外側（`x0 - capW`）へ出したので、
     軸の左端は `FIG.left - FIG.capW` まで伸びている。見出しの席をそのままに
     していたため、字の右端（`FIG.left - 10`）と印（85〜100）が重なっていた。
     字も1段小さくする（読めればよい添え字で、主役は部材の並び）。 */
  const edge = FIG.left - FIG.capW - 8;
  const room = edge - 6;
  const fs = Math.min(V.fs(15), room / Math.max(1, name.length));
  return `<text x="${edge}" y="${cy + fs * 0.36}" text-anchor="end"`
   + ` font-size="${fs.toFixed(1)}" font-weight="700" fill="${fill || V.PAL.label}">${name}</text>`;
 }
 /* 軸は**有効幅ちょうど**に描き、その両端に青い印を置く（§9.378）。
    青＝有効幅の境目、という1つの意味に統一する——絵の端に置くと、有効幅を
    変えても見た目の比率が変わらず、範囲を読み違える。 */
 function drawShafts(V, A) {
  const xa = V.px(0), xb = V.px(A.arborLen);
  const x0 = Math.min(xa, xb), w = Math.max(2, Math.abs(xb - xa));
  /* 青い印は有効幅の**外側**へ出す（§9.378、利用者の指示「軸のエンドの青
     オブジェクトと端部のスペーサーのオブジェクトが干渉しています。エンドなので
     干渉しないように配置してください」）。内側に置くと、有効幅の中に並ぶ
     端部のスペーサーの上に重なって、1枚目が読めなくなる。 */
  const cw = FIG.capW, sx = x0 - cw, sw = w + cw * 2;
  let back = '', front = '';
  [[V.upC, '上軸'], [V.loC, '下軸']].forEach(([cy, name]) => {
   back += `<rect class="bs-shaft" x="${sx}" y="${cy - V.hOf(V.shaftD) / 2}"`
    + ` width="${sw}" height="${V.hOf(V.shaftD)}" rx="5"`
    + ` fill="url(#bsSh)" stroke="${V.PAL['shaft-edge']}"/>`
    + `<rect class="bs-cap" x="${sx}" y="${cy - V.hOf(FIG.capD) / 2}" width="${cw}"`
    + ` height="${V.hOf(FIG.capD)}" rx="3" fill="${V.PAL.cap}"/>`
    + `<rect class="bs-cap" x="${x0 + w}" y="${cy - V.hOf(FIG.capD) / 2}"`
    + ` width="${cw}" height="${V.hOf(FIG.capD)}" rx="3" fill="${V.PAL.cap}"/>`;
   front += rowLabel(V, name, cy);
  });
  return { back, front };
 }
 const expand = d => BS().expand(d);
 const widthPx = (V, pieces) => pieces.reduce((a, sz) => a + V.pw(sz), 0);

 function partsRun(V, from, limit, cy, pieces, dia, fill, stroke, label, k) {
  const d = V.dir, s = k || 1;
  let svg = '', at = from;
  for (const sz of pieces) {
   const w = V.pw(sz) * s;
   if ((at + d * w - limit) * d > 0.6) break;
   svg += block(V, at + d * w / 2, cy, Math.max(1.2, w - 0.4), dia, fill, stroke, label);
   at += d * w;
  }
  return { svg, end: at };
 }
 /* 1区間の中身を描く。軸の寸法はスペーサーが作る。保持層はその上に被さる別の層。
    図の上での区間は刃の位置を見えるように広げたぶん実寸とずれる（最大で刃厚ぶん）
    ので、区間ごとに縮尺を合わせてぴったり埋める。 */
 function fillZone(V, xa, xb, cy, parts) {
  const d = V.dir, span = Math.abs(xb - xa);
  if (span <= 1) return '';
  const k = parts.len > 0 ? span / V.pw(parts.len) : 1;
  const fill = partsRun(V, xa, xb, cy, expand(parts.spacer), V.spacerD,
                        V.PAL.spacer, V.PAL['spacer-edge'], null, k);
  let svg = fill.svg;
  if ((xb - fill.end) * d > 0.8) {
   svg += block(V, (fill.end + xb) / 2, cy, Math.abs(xb - fill.end), V.spacerD,
                V.PAL.filler, V.PAL['filler-edge']);
  }
  if (parts.hold) svg += holdLayer(V, xa, xb, cy, parts, k);
  return svg;
 }
 /* 保持層（ゴムリング／フィンガー）。スペーサーの外側に出る輪の部分を上下に描く。
    幅は刻みしかないので区間長にぴったり合うとはかぎらない。その余りを片側へ寄せると
    クリアランスのように見えるので、左右へ均等に振り分けて中央に置く。 */
 function holdLayer(V, xa, xb, cy, z, k) {
  /* **フィンガーは板押さえ**（§9.379、利用者の指示4）。軸に被る輪ではなく、
     上下軸と板のあいだに差し込まれて板を挟むので、軸のまわりではなく
     **板の両側**へ描く。以前は輪と同じ場所に「指」と書いた帯を出していたが、
     それでは「軸に何かが被っている」としか読めず、どこを押さえているのかが
     図から分からなかった。 */
  if (z.hold.kind === 'finger') return fingerLayer(V, xa, xb, cy, z, k);
  const isRing = z.hold.kind === 'ring';
  const bore = +M.P.ringBore || 241;
  const od = isRing ? z.hold.od : V.spacerD + 20;
  const ri = V.hOf(bore) / 2, ro = V.hOf(od) / 2, th = ro - ri;
  const hex = isRing ? V.ringHex(z.hold.ringT) : V.PAL['strip-edge'];
  const d = V.dir, s = k || 1;
  const pieces = expand(z.gom);
  const slack = Math.max(0, Math.abs(xb - xa) - widthPx(V, pieces) * s);
  let o = '', at = xa + d * slack / 2;
  for (const sz of pieces) {
   const w = V.pw(sz) * s;
   if ((at + d * w - xb) * d > 0.6) break;
   const x = Math.min(at, at + d * w) + 0.4, ww = Math.max(1.2, w - 0.8);
   o += `<rect x="${x}" y="${cy - ro}" width="${ww}" height="${th}" rx="2" fill="${hex}" stroke="${V.PAL.ink}"/>`
      + `<rect x="${x}" y="${cy + ri}" width="${ww}" height="${th}" rx="2" fill="${hex}" stroke="${V.PAL.ink}"/>`;
   at += d * w;
  }
  /* **落とさない**（§9.378）。大小はラップ構成そのものを表すので、狭い区間でも
     出す——出ないと「小は省略されているのか」を読む側が確かめられない。
     大きさは`V.zoneMin`でそろえ、帯の厚みにも収める。 */
  const cap = Math.min(V.fs(16), th * 0.86);
  const fit = V.zoneMin > 0 ? (V.zoneMin - 2) / 1.1 : cap;
  const fs = Math.max(V.fs(7), Math.min(cap, fit));
  o += `<text x="${(xa + xb) / 2}" y="${cy - ri - th / 2 + fs * 0.36}" text-anchor="middle"`
   + ` font-size="${fs.toFixed(1)}" font-weight="800" fill="#fff" stroke="${V.PAL.ink}"`
   + ` stroke-width="${(fs * 0.16).toFixed(2)}" style="paint-order:stroke">`
   + `${z.hold.ringT === 'big' ? '大' : '小'}</text>`;
  return o;
 }

 /* フィンガー（板押さえ）を**板の両側**へ描く。
    ・横（軸方向）はマスタの「幅」＝W寸法。区間を埋める割付は輪と同じ仕組み。
    ・縦はマスタの「厚み」（図面 20mm）。板を押さえる向きの厚みなので、
      径ではなく厚みを縦へ写す。
    ・両端は図面どおり先細り（研削長×研削量）。先端のランドは 厚み−研削量×2。
    上軸の区間は板の**上**、下軸の区間は板の**下**へ置く——どちらの軸から
    差し込まれた押さえかが、置き場所だけで分かるようにする。 */
 function fingerLayer(V, xa, xb, cy, z, k) {
  const shape = (M.fingerShape || {});
  const one = (M.fingers || [])[0] || {};
  const th = +(one.thickness || shape.thickness) || 20;
  const upper = cy < V.midY;
  const h = Math.max(2.4, V.hOf(th));
  /* **板に貼り付ける**（§9.385、利用者の指摘「フィンガーの図と板の図の間
     隙間があります」）。当てる先は**その押さえの真下にある板の面**——
     1枚ごとに `V.bands` から引く。
     §9.380 では「いちばん外へ寄った面（`midY ± matH`）」に固定していたが、
     それは**食い込みを避けただけで、貼り付いてはいなかった**：条は千鳥で
     上下へ `matH/2` ずつ寄るので、反対側へ寄った条に対して**板厚1枚ぶんの
     隙間**が残る（区間の約半分がこれに当たる）。
     板が見つからない横位置（端の外など）だけ、これまでどおり外へ逃がす。 */
  const far = upper ? V.midY - V.matH - h : V.midY + V.matH;
  const yOf = x => {
   const z2 = bandAt(V.bands || [], x);
   if (!z2) return far;
   return upper ? z2.top - h : z2.bot;
  };
  const d = V.dir, s = k || 1;
  const pieces = expand(z.gom);
  const slack = Math.max(0, Math.abs(xb - xa) - widthPx(V, pieces) * s);
  let o = '', at = xa + d * slack / 2, lastY = far;
  for (const sz of pieces) {
   const w = V.pw(sz) * s;
   if ((at + d * w - xb) * d > 0.6) break;
   const x = Math.min(at, at + d * w) + 0.4, ww = Math.max(1.2, w - 0.8);
   /* 当てる先は**この1枚の真ん中の真下**にある板で決める。端で決めると、
      境目にかかった1枚が隣の条の面へ飛ぶ。 */
   const y0 = yOf(x + ww / 2);
   lastY = y0;
   /* **この向きでは先細りは見えない。** 図面の研削（20×6）は「全長×厚み」の
      面にあり、全長は板の流れる向き＝この図では紙の奥行きなので、軸方向から
      見た形は 幅×厚み の四角。奥行きの形は立体図が受け持つ（§9.379）。
      ここに先細りを描くと、削る向きを1つ取り違えた絵になる。 */
   /* 角は落とさない（§9.380、利用者の指示「四角で丸みは必要ない」）——
      丸めると板との当たり際に隙間があるように見える。 */
   o += `<rect class="bs-fng" x="${x}" y="${y0.toFixed(1)}" width="${ww}"`
    + ` height="${h.toFixed(1)}" fill="${V.PAL.finger}"`
    + ` stroke="${V.PAL.ink}" stroke-width=".8"/>`;
   at += d * w;
  }
  /* 字は**入るときだけ**。押さえの帯は輪より薄いので、無理に入れると潰れる
     （色だけで伝えないぶんは、下の「保持」の欄と所要が受け持つ）。
     置くのは区間の真ん中なので、**そこの1枚と同じ高さ**に合わせる。 */
  const fs = Math.min(V.fs(11), h * 0.7, V.zoneMin > 0 ? (V.zoneMin - 2) / 1.1 : V.fs(11));
  if (fs >= V.fs(7)) {
   const y0 = o ? yOf((xa + xb) / 2) : lastY;
   o += `<text x="${(xa + xb) / 2}" y="${(y0 + h / 2 + fs * 0.36).toFixed(1)}"`
    + ` text-anchor="middle" font-size="${fs.toFixed(1)}" font-weight="800" fill="#fff"`
    + ` stroke="${V.PAL.ink}" stroke-width="${(fs * 0.16).toFixed(2)}"`
    + ' style="paint-order:stroke">指</text>';
  }
  return o;
 }
 /* 図の上での刃の位置。クリアランスは実寸 0.15mm ほどで、アーバー全長を 800px に
    写すと 0.07px になり上下のずれが見えない。ずれの**向き**はそのままに、
    見てわかる最小限の量（刃厚ぶん）まで広げて描く。 */
 function knifePx(V, A) {
  const min = Math.max(V.kw, 3.5);
  return A.U.map((u, i) => {
   const xu = V.px(u), xl = V.px(A.Lo[i]), d = xu - xl;
   if (Math.abs(d) >= min) return { u: xu, l: xl };
   const mid = (xu + xl) / 2, s = d === 0 ? 0 : Math.sign(d);
   return { u: mid + s * min / 2, l: mid - s * min / 2 };
  });
 }
 const kxOf = (kx, i, upper) => (upper ? kx[i].u : kx[i].l);

 function drawStack(V, A, segs, upper, zp) {
  const cy = upper ? V.upC : V.loC, side = upper ? 'up' : 'lo', kx = V.KX;
  const lastZ = A.zones.length - 1, lastK = kx.length - 1;
  const d = V.dir, at = i => kxOf(kx, i, upper), half = d * V.kw / 2;
  /* 有効幅の外へ「積みが続く」ことを示す張り出しは**置かない**（§9.378）——
     端に置くのは有効幅の境目を示す青い印だけ。 */
  let svg = fillZone(V, V.px(0), at(0) - half, cy, zp.zones[0][side]);
  for (let j = 0; j < segs.length; j++) {
   svg += fillZone(V, at(j) + half, at(j + 1) - half, cy, zp.zones[j + 1][side]);
  }
  svg += fillZone(V, at(lastK) + half, V.px(A.arborLen), cy, zp.zones[lastZ][side]);
  return svg;
 }
 function drawKnives(V) {
  let o = '';
  V.KX.forEach(k => {
   o += block(V, k.u, V.upC, V.kw, V.knifeD, V.PAL.knife, V.PAL['knife-edge'])
      + block(V, k.l, V.loC, V.kw, V.knifeD, V.PAL.knife, V.PAL['knife-edge']);
  });
  return o;
 }
 /* 構成記号。どの区間がどの組み合わせかを示す、刃組の要。**全区間に置く**
    （「×8」とまとめるとどの区間を指すのか分からなくなる）。 */
 /* いちばん狭い区間の幅（図の座標）。上下の両軸を見る——片方だけで決めると、
    もう片方の狭い区間で文字が隣へはみ出す。 */
 function minZoneSpan(V, segs) {
  const half = V.dir * V.kw / 2;
  let m = Infinity;
  [true, false].forEach(upper => {
   for (let j = 0; j < segs.length; j++) {
    const a = kxOf(V.KX, j, upper) + half, b = kxOf(V.KX, j + 1, upper) - half;
    m = Math.min(m, Math.abs(b - a));
   }
  });
  return Number.isFinite(m) ? m : 0;
 }

 function drawBadges(V, A, bmap) {
  const half = V.dir * V.kw / 2;
  const zoneX = (upper, k) => {
   const n = V.KX.length - 1;
   const a = (k === 0) ? V.px(0) : kxOf(V.KX, k - 1, upper) + half;
   const b = (k === n + 1) ? V.px(A.arborLen) : kxOf(V.KX, k, upper) - half;
   return [Math.min(a, b), Math.max(a, b)];
  };
  /* 記号の字数は塊によって変わりうるので、**いちばん長い記号**で寸法を決める。 */
  let len = 1;
  [['up', true], ['lo', false]].forEach(([side]) => {
   for (let k = 1; k < A.zones.length - 1; k++) {
    const r = bmap[side][k];
    if (r) len = Math.max(len, String(r.badge).length);
   }
  });
  const unit = 0.72 * len + 0.7;
  /* 狭い区間にも同じ形で収まる大きさへ落とす。**下限は決める**——小さくし過ぎると
     読めない札を出すことになる（読めないなら出さないのと同じ）。 */
  const fs = Math.max(V.fs(8),
                      Math.min(V.fs(13), V.zoneMin > 0 ? (V.zoneMin - 3) / unit : V.fs(13)));
  const w = fs * unit, h = fs * 1.5;
  let o = '';
  [['up', true, V.upC], ['lo', false, V.loC]].forEach(([side, upper, cy]) => {
   for (let k = 1; k < A.zones.length - 1; k++) {
    const r = bmap[side][k];
    if (!r) continue;
    const [a, b] = zoneX(upper, k), cx = (a + b) / 2;
    /* **記号は重ねる的**（§9.378、利用者の指示「ガイダンスのアルファベットを
       クリックすると対象の刃組の準備対象の表の部分が見やすくなるように連動」
       →その後「マウスオーバーしている間だけに変更」と改めて指示があった）。
       同じ記号は上下軸の両方に出るので、塊ごとに記号を名乗らせて一緒に光らせる。 */
    /* **的は区間ぜんたい**（§9.386、利用者の指示「マウスオーバーの対象範囲を
       広げて、反応しやすく」）。記号の札だけを的にしていたので**27×29px**しか
       無く、狙わないと反応しなかった。区間は記号が指している範囲そのものなので、
       広げても「何に重ねたか」は曖昧にならない。
       この1枚が的と強調を兼ねる——ふつうは透明、当たると淡く塗る。 */
    const H = V.hOf(V.maxD);
    o += `<g class="bs-bhit" data-badge="${esc(r.badge)}">`
     + `<rect class="bs-zhit" x="${a.toFixed(1)}" y="${(cy - H / 2).toFixed(1)}"`
     + ` width="${Math.max(1, b - a).toFixed(1)}" height="${H.toFixed(1)}" rx="3"/>`
     + `<rect class="bs-bdgr" x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}"`
     + ` rx="${(h * 0.28).toFixed(1)}" fill="${V.PAL.badge}" stroke="#fff" stroke-width="1.2"/>`
     + `<text x="${cx}" y="${cy + fs * 0.36}" text-anchor="middle" font-size="${fs.toFixed(1)}"`
     + ` font-weight="800" fill="#fff">${r.badge}</text></g>`;
   }
  });
  return o;
 }
 /* 材料の並びと、切られた条が上下どちらへ寄るかは**計算の側**が持つ
    （`blade-core.js`）——模式図と立体図が同じ答えを見るため。 */
 const materialRun = (A, segs) => BS().materialRun(A, segs);
 const matShift = (A, run, i) => BS().matShift(A, run, i);
 /* 板1枚ぶんの場所（横の範囲と上下の面）を**1箇所**で答える（§9.385）。
    材料を描く側と、押さえ（フィンガー）を当てる側が**同じ答え**を見るため
    ——別々に出すと、条が千鳥で寄ったぶんだけ押さえが浮く（実際に浮いた）。
    §9.377 の「両方が使う小道具は1箇所へ置く」と同じ理由。 */
 function matBands(V, A, run) {
  const y = V.midY, h = V.matH;
  const n = A.sign.length - 1, lead = run[0].sg.type === 'trim' ? 1 : 0;
  const half = V.dir * V.kw / 2;
  return run.map(({ sg, from, to }, i) => {
   const j = i - lead, up = matShift(A, run, i) < 0;
   const kx = k => ((k < 0 || k > n) ? null : (up ? V.KX[k].u : V.KX[k].l));
   const a0 = j <= -1 ? V.px(from) : (kx(j) !== null ? kx(j) + half : V.px(from));
   const b0 = j >= n ? V.px(to) : (kx(j + 1) !== null ? kx(j + 1) - half : V.px(to));
   const a = Math.min(a0, b0), b = Math.max(a0, b0);
   const cy = y + matShift(A, run, i) * h / 2;
   return { sg, i, a, b, w: b - a, cx: (a + b) / 2, up,
            cy, top: cy - h / 2, bot: cy + h / 2 };
  });
 }
 /* その横位置にある板の面。**押さえを当てる先**（§9.385）。
    見つからなければ `null` を返し、呼ぶ側が「外へ逃がす」を選ぶ。 */
 function bandAt(bands, x) {
  return bands.find(z => x >= z.a - 0.6 && x <= z.b + 0.6) || null;
 }

 function drawMaterial(V, A, run, bands) {
  const y = V.midY, h = V.matH, color = widthColorIndex();
  let back = '', front = rowLabel(V, '材料', y, V.PAL.label);
  let botMost = y, topMost = y;
  const marks = [], last = run.length - 1;
  bands.forEach(({ sg, a, b, w, cx, cy, top, bot }, i) => {
   const strip = sg.type === 'strip', trim = sg.type === 'trim', scrap = sg.type === 'scrap';
   const ci = strip ? (color.get(sg.w.toFixed(3)) || 0) : 0;
   const edge = strip ? V.PAL['w' + ci + 'e'] : (scrap ? V.PAL['scrap-edge'] : V.PAL['trim-edge']);
   const face = strip ? V.PAL.strip : (scrap ? V.PAL.scrap : V.PAL.trim);
   const up = matShift(A, run, i) < 0;
   botMost = Math.max(botMost, bot);
   topMost = Math.min(topMost, top);
   back += `<rect class="bs-mat" x="${a + 0.6}" y="${top}" width="${Math.max(1.6, w - 1.2)}"`
    + ` height="${h}" rx="1" fill="${face}" stroke="${edge}" stroke-width="1"/>`;
   if (strip || (trim && (i === 0 || i === last))) {
    /* `up`＝この条の板が中心より上へ寄っているか（§9.378、利用者の指示
       「板がある側に番号バッジを出してください」）。番号は板を指すものなので、
       板と反対側に置くと、どの条の番号なのかを目で辿り直すことになる。 */
    marks.push({ cx, strip, up, text: strip ? String((sg.lotIx | 0) + 1) : '耳',
                 w, fill: edge, cy, top, bot, mm: strip ? +sg.w : null,
                 outer: (i === 0) === (V.dir > 0) ? -1 : 1 });
   }
   if (strip && sg.flip && w > V.fs(30)) {
    front += `<text x="${cx}" y="${top - V.fs(6)}" text-anchor="middle" font-size="${V.fs(12)}"`
     + ` font-weight="700" fill="${V.PAL['strip-edge']}">反転</text>`;
   }
  });
  /* **すべての条に番号を振る**（§9.378、利用者の指示「条の狭いエリアで…
     表示されていません。板の図の上下に番号をばらす等、隣同士の番号の干渉が
     無いようにしつつすべてに番号を振ってください」）。
     以前は `m.w < mfs*1.4` で狭い条の番号を落としており、9条のうち**1個**しか
     出ていなかった。落とす代わりに**1つ飛ばしで上下へ振り分ける**——同じ段に
     並ぶ番号は2条ぶん離れるので、隣同士がぶつからない。 */
  const my = Math.max(botMost, y + V.matH * FIG.reachShare) + V.fs(13);
  const strips = marks.filter(m => m.strip);
  /* 同じ段に並ぶ隣り合わせは2条ぶん離れる。そのいちばん狭いところに合わせる。 */
  let pair = Infinity;
  for (let i = 0; i + 1 < strips.length; i++) pair = Math.min(pair, strips[i].w + strips[i + 1].w);
  if (!Number.isFinite(pair)) pair = strips.length ? strips[0].w * 2 : V.fs(13) * 2;
  const mfs = Math.max(V.fs(8), Math.min(V.fs(13), (pair - 4) / 1.4));
  const upY = Math.min(topMost, y - V.matH * FIG.reachShare) - V.fs(4);
  /* 条ごとの寸法（§9.380、利用者の指示「模式図に板ごとの寸法表示を
     つぶれないように注意しながら入れたい」）。番号の**すぐ外側**へ重ねて置く
     ——番号と同じ段に並ぶので、上下に振り分かれるぶんだけ隣と離れる。
     字は「同じ段の隣どうしの間隔（`pair`）」から決め、**読めない大きさには
     しない**（下限を割るなら出さない＝潰れた字を出すより無いほうがよい）。 */
  const wLen = Math.max(...strips.map(m => (m.mm === null ? 0 : m.mm.toFixed(2).length)), 1);
  const wfs = Math.min(V.fs(11), (pair - 4) / (wLen * 0.62));
  const showMm = wfs >= V.fs(7);
  marks.forEach(m => {
   /* **板がある側へ出す**（§9.378）。条は切られた向きに応じて上下どちらかへ
      寄るので、番号もその側へ置く。千鳥では隣どうしが逆へ寄るため、
      結果として上下に振り分かれて番号がぶつからない。 */
   if (!m.strip) {
    /* **耳は耳屑のそばへ**（§9.380、利用者の指示）。番号の段（板から離れた行）に
       置くと、どの塊を指しているのかを目で辿り直すことになる。耳屑は狭いので
       字は中に入らない——板の**外側の縁**へ、その耳屑と同じ高さで添える。 */
    const efs = Math.min(V.fs(12), Math.max(V.fs(8), (m.bot - m.top) * 0.9));
    const ex = m.cx + m.outer * (m.w / 2 + efs * 0.45);
    front += `<text class="bs-mk" data-side="edge" x="${ex.toFixed(1)}"`
     + ` y="${(m.cy + efs * 0.36).toFixed(1)}" text-anchor="middle"`
     + ` font-size="${efs.toFixed(1)}" font-weight="800" fill="${m.fill}">耳</text>`;
    return;
   }
   const below = !m.up;
   const ty = below ? my : upY;
   front += `<circle cx="${m.cx}" cy="${ty - mfs * 0.34}" r="${(mfs * 0.72).toFixed(1)}"`
    + ` fill="#fff" stroke="${m.fill}" stroke-width="1.3"/>`;
   front += `<text class="bs-mk" data-side="${below ? 'down' : 'up'}" x="${m.cx}" y="${ty}"`
    + ` text-anchor="middle" font-size="${mfs.toFixed(1)}"`
    + ` font-weight="800" fill="${m.fill}">${esc(m.text)}</text>`;
   if (showMm && m.mm !== null) {
    const wy = below ? ty + wfs * 1.15 : ty - mfs * 0.9 - wfs * 0.5;
    front += `<text class="bs-mw" x="${m.cx}" y="${wy.toFixed(1)}" text-anchor="middle"`
     + ` font-size="${wfs.toFixed(1)}" font-weight="700" fill="${V.PAL.label}"`
     + ` font-variant-numeric="tabular-nums">${m.mm.toFixed(2)}</text>`;
   }
  });
  return { back, front };
 }
 /* 板を切っている刃。上刃は下から、下刃は上から板へ入り、板の位置で行き違う。 */
 function drawLap(V) {
  const y = V.midY, reach = V.matH * FIG.reachShare, w = Math.max(2.4, V.kw);
  const blade = (cx, dir) =>
   `<rect x="${(cx - w / 2).toFixed(1)}" y="${(dir > 0 ? y - reach : y).toFixed(1)}"`
   + ` width="${w.toFixed(1)}" height="${reach.toFixed(1)}" rx="1.5"`
   + ` fill="${V.PAL.knife}" stroke="${V.PAL['knife-edge']}" stroke-width=".6"/>`;
  let o = '';
  V.KX.forEach(k => { o += blade(k.u, +1) + blade(k.l, -1); });
  return o;
 }
 /* バッジの字。**規格の刻みから選ぶ**（16→13。§CLAUDE 7 見た目の値は
    トークンから選ぶ）。図の主役は部材の並びで、設定値はその添え物なので、
    本文より1段小さくする。 */
 const FS_CHIP = 13;
 /* 主要値の帯（§CLAUDE 12「余白があるなら、そこへ置くべきものを出す」）。
    **クリアランスとラップは図のどこか1点を指して示せない寸法**なので、
    寸法線ではなく値そのものをバッジで置く（クリアランスのずれの向きは
    切断ごとに変わる）。ゴムリングは色が外径そのものなので、色の意味だけを
    図の中に置く——それ以外（スペーサー・刃・屑条・耳）は形と並びで読める。
    帯が長くなったときは全体を縮めて収め、折り返しや欠けを起こさない。 */
 function drawChipBand(V, finger) {
  const textW = t => [...t].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 16 : 9), 0);
  const P = V.PAL;
  /* **3つだけ・短く**（§9.380、利用者の指示「不要な文字は極力カット」）。
     言い添え（目安の割合・手入力・ゴムリング無し・大径小径の値）は**手順バーと
     刃組表がすでに言っている**ので、図の上でもう一度言わない（§CLAUDE 8）。
     図が答えるのは「いまどの設定で組むか」の3点だけ。 */
  const chips = [
   { t: `クリアランス：${st.clr.toFixed(2)}mm`,
     bg: P['chip-clr-bg'], fg: P['chip-clr-fg'], bd: P['chip-clr-bd'] },
   { t: `ラップ：${st.ov.toFixed(2)}mm`,
     bg: P['chip-ov-bg'], fg: P['chip-ov-fg'], bd: P['chip-ov-bd'] },
   { t: `板押さえ：${finger ? 'フィンガー' : 'ゴムリング'}`,
     bg: P['chip-bg'], fg: P['chip-fg'], bd: P['chip-bd'] }
  ];
  const CW = chips.map(c => V.fs(18 + textW(c.t) * FS_CHIP / 16));
  const total = CW.reduce((a, w) => a + w, 0) + (chips.length - 1) * 9;
  /* 帯は図の上端の中央。左右の隅は OS・DS の見出しが使っているので、その分を
     除いた幅に収める。 */
  const side = V.fs(46), room = FIG.vw - side * 2;
  const fit = Math.min(1, room / total);
  let x = side / fit + Math.max(0, (room / fit - total) / 2), band = '';
  chips.forEach((c, i) => {
   const w = CW[i], h = V.fs(25), y = 8;
   band += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${c.bg}" stroke="${c.bd}"/>`;
   band += `<text x="${x + 9}" y="${y + h / 2 + V.fs(FS_CHIP * 0.36)}" font-size="${V.fs(FS_CHIP)}"`
    + ` font-weight="700" fill="${c.fg}">${esc(c.t)}</text>`;
   x += w + 9;
  });
  return fit < 1 ? `<g transform="scale(${fit.toFixed(4)})">${band}</g>` : band;
 }
 const drawEdgeLabels = V =>
  `<text x="10" y="${V.fs(24)}" font-size="${V.fs(17)}" font-weight="800" fill="${V.PAL.label}">${st.flip ? 'DS' : 'OS'}</text>`
  + `<text x="${FIG.vw - 10}" y="${V.fs(24)}" text-anchor="end" font-size="${V.fs(17)}"`
  + ` font-weight="800" fill="${V.PAL.label}">${st.flip ? 'OS' : 'DS'}</text>`;

 function drawFigure(res) {
  const svg = $('#bsStage');
  if (!svg) return;
  const PAL = figPalette(panel);
  const box = svg.parentNode.getBoundingClientRect();
  const ratio = box.width > 10 ? Math.max(0.3, Math.min(1.2, box.height / box.width)) : 0.55;
  const V = viewport(res.A, PAL, ratio);
  V.KX = knifePx(V, res.A);
  /* 記号・大小の札は**1つの寸法にそろえて全部出す**（§9.378、利用者の指示
     「Aだけ特異なデザインを使っています。統一感を出してください」「小って
     感じが省略されているだけでしょうか」）。以前は区間ごとに幅を見て、狭ければ
     **落とす／別のデザインへ切り替える**作りだったので、広いOS端の区間だけ
     枠付きバッジになり（＝Aだけ別物）、狭い区間の大小の札は1枚も出なかった
     （実測: 大1枚・小0枚・ロット番号1個）。いちばん狭い区間に合わせて寸法を
     1つ決め、全部同じ形で描く（§CLAUDE 11 群の中はそろえる）。 */
  V.zoneMin = minZoneSpan(V, res.segs);
  const shafts = drawShafts(V, res.A), run = materialRun(res.A, res.segs);
  /* 板の場所は**先に1度だけ**出す（§9.385）。材料を描く側と、押さえを当てる
     側（`fillZone`→`fingerLayer`）が同じ答えを見るので、`V` に預ける。 */
  V.bands = matBands(V, res.A, run);
  const mat = drawMaterial(V, res.A, run, V.bands);
  const back = shafts.back
   + drawStack(V, res.A, res.segs, true, res.zp)
   + drawStack(V, res.A, res.segs, false, res.zp)
   + drawKnives(V) + mat.back + drawLap(V);
  const front = shafts.front + drawBadges(V, res.A, res.badges)
   + mat.front + drawEdgeLabels(V) + drawChipBand(V, res.finger);
  svg.setAttribute('viewBox', `0 0 ${FIG.vw} ${V.vh}`);
  svg.innerHTML = `<defs><linearGradient id="bsSh" x1="0" y1="0" x2="0" y2="1">`
   + `<stop offset="0" stop-color="${PAL.sheen}"/><stop offset=".45" stop-color="${PAL.shaft}"/>`
   + `<stop offset="1" stop-color="${PAL['shaft-edge']}"/></linearGradient></defs>${back}${front}`;
 }

 /* ====================== 刃組表 ====================== */
 const K = () => BS().sizeKeys;
 function usesCell(row, k, sep) {
  const cls = 'bs-it' + (sep ? ' bs-sep' : '');
  const uses = row.uses.filter(u => (k === 'up') === !!u.upper);
  if (!uses.length) return `<td class="${cls} bs-z">·</td>`;
  const slots = (row.zones || []).filter(z => (k === 'up') === !!z.upper).map(z => z.i);
  const burr = [...new Set(uses.map(u => u.burr))]
   .map(b => `<span class="bs-bt is-${b}">${b === 'down' ? '下' : '上'}</span>`).join('');
  const n = uses.reduce((a, u) => a + u.n, 0);
  return `<td class="${cls}">${burr}<span class="bs-slot">`
   + `${[...new Set(slots)].sort((a, b) => a - b).join(' ')}</span><span class="bs-ct">${n}</span></td>`;
 }
 function renderTables(res) {
  const rows = res.rows, keys = K();
  const Ss = [...new Set(rows.flatMap(r => keys(r.c.sp)))].sort((a, b) => b - a);
  const Gs = [...new Set(rows.flatMap(r => keys(r.c.G)))].sort((a, b) => b - a);
  const hasRem = rows.some(r => r.c.rem > 0.001);
  const holdLabel = res.finger ? 'フィンガー' : 'ゴムリング';
  const num = v => (v ? `<b>${v}</b>` : '<span class="bs-z">·</span>');
  const head = `<thead>
    <tr>
     <th class="bs-grp" rowspan="2">区分<small>ロット・条幅</small></th>
     <th class="bs-bd" rowspan="2">記号</th>
     <th class="bs-it bs-sep" colspan="2">取付位置<small>バリ／OS側から何番目の区間か／区間数</small></th>
     ${Ss.length ? `<th colspan="${Ss.length}" class="bs-sep">スペーサー</th>` : ''}
     ${Gs.length ? `<th colspan="${Gs.length}" class="bs-sep">${holdLabel}</th>` : ''}
     ${hasRem ? `<th rowspan="2" class="bs-sep">隙間<small>許容 0〜${M.P.gapMax}</small></th>` : ''}
    </tr>
    <tr><th class="bs-ax bs-sep">上軸</th><th class="bs-ax">下軸</th>
     ${Ss.map((x, i) => `<th class="bs-sz${i ? '' : ' bs-sep'}">${x}</th>`).join('')}
     ${Gs.map((x, i) => `<th class="bs-sz${i ? '' : ' bs-sep'}">${x}</th>`).join('')}</tr>
   </thead>`;
  /* 区分（ロット・屑条）はいちばん左の列にまとめて1回だけ示す（縦に伸ばさない）。 */
  const key = r => (r.sg.type === 'strip' ? r.sg.lot : '屑条');
  const runs = [];
  rows.forEach(r => {
   const k = key(r);
   if (runs.length && runs[runs.length - 1].k === k) runs[runs.length - 1].rs.push(r);
   else runs.push({ k, rs: [r] });
  });
  const body = runs.map(({ k, rs }) => rs.map((r, i) => {
   const head0 = i ? '' : `<td class="bs-grp" rowspan="${rs.length}">`
    + `<b>${r.sg.type === 'strip' ? `<span class="bs-lno">${(r.sg.lotIx | 0) + 1}</span>` : ''}${esc(k)}</b>`
    + `<span class="bs-gw">${r.sg.w.toFixed(2)}</span>`
    + (r.sg.flip ? '<span class="bs-gw is-flip">反転巻き</span>' : '') + '</td>';
   return `<tr data-badge="${esc(r.badge)}">${head0}`
    + `<td class="bs-bd"><span class="bs-bdg">${r.badge}</span></td>`
    + usesCell(r, 'up', true) + usesCell(r, 'lo')
    + Ss.map((x, i2) => `<td class="bs-num${i2 ? '' : ' bs-sep'}">${num(r.c.sp[x])}</td>`).join('')
    + Gs.map((x, i2) => `<td class="bs-num${i2 ? '' : ' bs-sep'}">${num(r.c.G[x])}</td>`).join('')
    + (hasRem ? `<td class="bs-num bs-sep ${gapCell(r.c.rem)}">`
       + `${r.c.rem > 0.001 ? r.c.rem.toFixed(2) : '·'}</td>` : '')
    + '</tr>';
  }).join('')).join('');
  $('#bsTables').innerHTML = `<table class="bs-g">${head}<tbody>${body}</tbody></table>`;
 }
 /* 端数は、そのまま「刃と刃のあいだに残る隙間」になる。ぴったり埋まったものと
    許容内で隙間があるものを見分けられるようにする。 */
 const gapCell = rem => (rem <= 1e-9 ? 'is-zero'
  : (rem <= (+M.P.gapMax || 0) + 1e-9 ? 'is-ok' : 'is-bad'));

 /* ---------- 端部（OS端／DS端）を図の左右へ ---------- */
 function renderEnds(res) {
  const keys = K();
  const at = sd => ((sd === 'OS') !== !!st.flip ? '左' : '右');
  [['OS', '#bsOsSide'], ['DS', '#bsDsSide']].forEach(([sd, sel]) => {
   const rows = res.ends.filter(r => r.endSide === sd);
   const el = $(sel);
   if (!el) return;
   if (!rows.length) { el.innerHTML = ''; return; }
   const trim = rows[0].trim;
   const pick = up => rows.find(r => r.uses.some(u => u.upper === up)) || rows[0];
   const U = pick(true), L = pick(false);
   const two = (a, b) => `<td>${a}</td><td>${b}</td>`;
   const n = v => (v ? `<b>${v}</b>` : '<span class="bs-z">·</span>');
   const ss = [...new Set([...keys(U.c.sp), ...keys(L.c.sp)])].sort((a, b) => b - a);
   let h = '<tr class="bs-sec"><td colspan="3">スペーサー</td></tr>';
   h += ss.length
    ? ss.map(x => `<tr><td class="bs-a">${x}</td>${two(n(U.c.sp[x]), n(L.c.sp[x]))}</tr>`).join('')
    : '<tr><td colspan="3" class="bs-note">なし</td></tr>';
   const len = r => `<b class="${r.c.len < 0 ? 'bs-ng' : ''}">${r.c.len.toFixed(2)}</b>`;
   h += `<tr class="bs-tot"><td class="bs-a">区間長</td>${two(len(U), len(L))}</tr>`;
   if (U.c.rem > 0.001 || L.c.rem > 0.001) {
    const openEnd = sd === 'DS';
    const gv = r => (r.c.rem > 0.001
     ? `<span class="${openEnd ? '' : gapCell(r.c.rem)}">${r.c.rem.toFixed(2)}</span>`
     : '<span class="bs-z">·</span>');
    h += `<tr class="bs-rem"><td class="bs-a">${openEnd ? '残り' : '隙間'}</td>${two(gv(U), gv(L))}</tr>`;
   }
   const why = `${sd === 'OS' ? 'いちばん先に取り付けます' : 'いちばん後に取り付けます'}。`
    + '最外刃より外なのでスペーサーのみです。';
   el.innerHTML = `<div class="bs-fh" title="${esc(why)}">`
    + `<span class="bs-pin">${sd}</span><span class="bs-lr">${at(sd)}</span>`
    + `<span class="bs-trim ${trim < 0 ? 'bs-ng' : ''}">耳 ${trim.toFixed(2)}</span></div>`
    + '<table class="bs-e"><thead><tr><th class="bs-a">部材<small>mm</small></th>'
    + '<th>上軸</th><th>下軸</th></tr></thead><tbody>' + h + '</tbody></table>';
  });
 }

 /* ====================== 所要 ====================== */
 const VERDICT = { good: ['is-good', '適正'], warn: ['is-warn', '要注意'], bad: ['is-bad', '不適'] };
 function gaugeHtml(id, name, unit) {
  return `<div class="bs-ga" data-g="${id}"><span class="bs-gn">${name}</span>`
   + `<b class="bs-gv">—<i>${unit}</i></b>`
   + '<span class="bs-gt"><i class="bs-gz"></i><i class="bs-gm"></i></span>'
   + '<span class="bs-vb">—</span></div>';
 }
 function renderGauges(res) {
  const box = $('#bsGauges');
  if (!box.dataset.ready) {
   box.innerHTML = gaugeHtml('push', '大径 押上げ', 'mm')
    + gaugeHtml('nip', '板ニップ', 'mm')
    + `<div class="bs-ga bs-ga-wide" data-g="offset"><span class="bs-gn">上下の左右差（端数の累積）</span>`
    + '<b class="bs-gv">—<i>mm</i></b>'
    + '<span class="bs-gt"><i class="bs-gz"></i><i class="bs-gm"></i></span>'
    + '<span class="bs-vb">—</span>'
    + '<details class="bs-ox"><summary>読み方</summary><div class="bs-oxb"></div></details></div>';
   box.dataset.ready = '1';
  }
  paintGauge('push', res.contact.push, res.finger, 0, 1.5);
  paintGauge('nip', res.contact.nip, res.finger, 0, 2.0);
  paintOffset(res.err);
 }
 function paintGauge(kind, value, off, lo, hi) {
  const g = $(`.bs-ga[data-g="${kind}"]`);
  if (!g) return;
  const vb = g.querySelector('.bs-vb');
  if (off) {
   g.querySelector('.bs-gv').innerHTML = '—';
   g.querySelector('.bs-gt').hidden = true;
   vb.className = 'bs-vb is-off';
   vb.textContent = 'フィンガー方式';
   return;
  }
  g.querySelector('.bs-gt').hidden = false;
  const band = BS().bandOf(M, kind), pct = v => (v - lo) / (hi - lo) * 100;
  g.querySelector('.bs-gm').style.left = Math.max(2, Math.min(98, pct(value))) + '%';
  g.querySelector('.bs-gv').innerHTML = value.toFixed(2) + '<i>mm</i>';
  const z = g.querySelector('.bs-gz');
  z.style.left = pct(band.min) + '%';
  z.style.width = (pct(band.max) - pct(band.min)) + '%';
  const [cls, text] = VERDICT[BS().judge(value, band)];
  vb.className = 'bs-vb ' + cls;
  vb.textContent = text;
 }
 function paintOffset(e) {
  const g = $('.bs-ga[data-g="offset"]');
  if (!g) return;
  const p = M.P, lim = Math.max((+p.offsetHardTol || 0) * 2, 0.02);
  const pct = v => (v + lim) / (2 * lim) * 100;
  g.querySelector('.bs-gm').style.left = Math.max(2, Math.min(98, pct(e.worst))) + '%';
  g.querySelector('.bs-gv').innerHTML =
   `${e.worst > 0 ? '＋' : e.worst < 0 ? '−' : '±'}${Math.abs(e.worst).toFixed(3)}<i>mm</i>`;
  const z = g.querySelector('.bs-gz');
  z.style.left = pct(-p.offsetTol) + '%';
  z.style.width = (pct(p.offsetTol) - pct(-p.offsetTol)) + '%';
  const [cls, text] = VERDICT[BS().judge(e.worst, BS().offsetBand(M))];
  const vb = g.querySelector('.bs-vb');
  vb.className = 'bs-vb ' + cls;
  vb.textContent = text;
  const shift = Math.min(e.cumU, e.cumL), diff = Math.abs(e.worst);
  const lines = ['DS側から部材を入れ、OS側へ詰めます。区間を手持ち寸法で埋めきれない分（端数）だけ、それより DS 側の刃は OS 側へ寄ります。'];
  if (diff > 1e-9) {
   lines.push(`上軸と下軸で端数の出方が違います。差がいちばん大きいのは <b>${e.worstAt + 1} 本目の刃</b>`
    + `（上軸の累積 ${e.cumU.toFixed(3)} ／ 下軸の累積 ${e.cumL.toFixed(3)} mm）。`);
  } else if (shift > 1e-9) lines.push('上下とも同じだけ寄るため、左右差にはなりません。');
  else lines.push('端数は出ていません。手持ち寸法で全区間を割り切れています。');
  if (shift > 1e-9) {
   lines.push(`刃全体が <b>${shift.toFixed(3)} mm</b> OS 側へ寄ります。OS耳はそのぶん狭く、DS耳は広くなります。`);
  }
  const tail = Math.max(e.tail.up, e.tail.lo);
  if (tail > 0.001) lines.push(`DS端に残る ${tail.toFixed(2)} mm は開放端の余りで、刃の位置はずらしません。`);
  g.querySelector('.bs-oxb').innerHTML = lines.join('<br>');
 }

 /* 準備するものは「寸法 × 必要数」だけ分かればよい。寸法ごとに1行の表にすると
    スペーサーだけで十数行になり必ずスクロールになるので、チップにして折り返す。 */
 const needChip = (label, u, l, have) => {
  const need = u + l;
  const short = typeof have === 'number' && have < need;
  return `<span class="bs-nc${short ? ' is-ng' : ''}" title="上軸 ${u} ／ 下軸 ${l}`
   + `${typeof have === 'number' ? ` ／ 使える ${have}` : ''}">${esc(label)}<b>${need}</b></span>`;
 };
 const needGroup = (name, chips, note) => ((chips.length || note)
  ? `<div class="bs-ng2"><span class="bs-nh">${name}</span><span class="bs-nb">`
    + `${chips.join('')}${note ? `<span class="bs-nn">${esc(note)}</span>` : ''}</span></div>`
  : '');
 function renderBom(res) {
  const g = res.g, keys = K();
  const blade = M.blades.find(k => k.currentDia !== null
   && Math.abs(k.currentDia - st.knife) < 0.05 && Math.abs((k.thickness || 0) - st.tk) < 0.01);
  const n = res.A.U.length;
  const sizes = [...new Set([...keys(g.spacerU), ...keys(g.spacerL)])].sort((a, b) => b - a);
  let html = needGroup(`刃 Φ${st.knife.toFixed(1)}`,
   [needChip(`t${st.tk}`, n, n, blade ? blade.qty : null)],
   blade ? '' : 'この径・刃厚の刃がマスタにありません');
  html += needGroup('スペーサー', sizes.map(s => {
   const x = g.plan.spacer.get(+s);
   return needChip(s, g.spacerU[s] || 0, g.spacerL[s] || 0, x ? x.free : 0);
  }));
  if (res.finger) {
   const fs = keys(g.finger);
   html += needGroup('フィンガー', fs.map(sz => {
    const w = g.finger[sz], x = g.plan.finger.get(+sz);
    return needChip(sz, w.u, w.l, x ? x.free : 0);
   }), fs.length ? '' : 'この設備のフィンガーが登録されていません');
   html += needGroup('ゴムリング', [], 'フィンガー方式のため使いません');
  } else {
   const ods = Object.keys(g.ring).map(Number).sort((a, b) => b - a);
   html += ods.map(od => {
    const t = BS().odOfType(st, M, 'big') === od ? '大'
     : (BS().odOfType(st, M, 'small') === od ? '小' : '');
    const name = `<span class="bs-rchip" style="--bs-dot:${esc(hexOf(od))}">${t || '·'}</span>${od}`;
    return needGroup(name, keys(g.ring[od]).map(sz => {
     const w = g.ring[od][sz], x = g.plan.ring.get(`${od}|${sz}`);
     return needChip(sz, w.u, w.l, x ? x.free : 0);
    }));
   }).join('');
   if (!ods.length) html += needGroup('ゴムリング', [], 'この設備のゴムリングが登録されていません');
  }
  $('#bsBom').innerHTML = html;
 }

 /* ====================== 台車差分 ====================== */
 const itemKeys = o => Object.keys(o).sort((a, b) => {
  const pa = a.split('|').map(Number), pb = b.split('|').map(Number);
  return (pb[0] - pa[0]) || ((pb[1] || 0) - (pa[1] || 0));
 });
 function targetRecord() {
  const h = M.history || [];
  for (let i = 1; i < h.length; i++) if (h[i].carriage === st.carriage) return { rec: h[i], back: i + 1 };
  return { rec: null, back: 0 };
 }
 function diffRows(title, cur, prev, shelf, fmt) {
  const keys = itemKeys(Object.assign({}, prev || {}, cur));
  if (!keys.length) return { html: '', add: 0, back: 0, keep: 0, short: [] };
  let html = `<tr class="bs-sec"><td colspan="5">${title}</td></tr>`;
  let add = 0, back = 0, keep = 0;
  const short = [];
  keys.forEach(k => {
   const need = cur[k] || 0, on = (prev || {})[k] || 0;
   const plus = Math.max(0, need - on), minus = Math.max(0, on - need), same = Math.min(need, on);
   add += plus; back += minus; keep += same;
   const avail = shelf ? (shelf(k) - on) : null;
   const lack = avail !== null && plus > Math.max(0, avail);
   if (lack) short.push(String(k));
   html += `<tr><td class="bs-a">${fmt ? fmt(k) : esc(k)}</td><td>${on || '—'}</td><td>${need || '—'}</td>`
    + `<td class="${plus ? 'is-plus' : ''}${lack ? ' is-short' : ''}">${plus || '—'}</td>`
    + `<td class="${minus ? 'is-minus' : ''}">${minus || '—'}</td></tr>`;
  });
  return { html, add, back, keep, short };
 }
 function renderDiff(res) {
  const cur = BS().snapshot(st, M, res.g);
  const h = M.history || [], inUse = h[0] || null;
  const { rec: prev, back } = targetRecord();
  const plan = res.g.plan;
  const shelf = {
   spacer: k => { const x = plan.spacer.get(+k); return x ? x.free : 0; },
   ring: k => { const x = plan.ring.get(String(k)); return x ? x.free : 0; },
   finger: k => { const x = plan.finger.get(+k); return x ? x.free : 0; },
   blade: k => {
    const [dia, tk] = String(k).split('|');
    const x = M.blades.find(y => y.currentDia !== null && Math.abs(y.currentDia - +dia) < 0.05
     && Math.abs((y.thickness || 0) - +tk) < 0.01);
    return x ? x.qty : 0;
   }
  };
  const pd = prev && prev.detail ? prev.detail : null;
  const parts = [
   diffRows('スペーサー', cur.spacer, pd && pd.spacer, shelf.spacer),
   diffRows('ゴムリング', cur.ring, pd && pd.ring, shelf.ring, k => {
    const [od, sz] = String(k).split('|');
    return `<span class="bs-swc"><i style="--bs-dot:${esc(hexOf(+od))}"></i>`
     + `${esc(colorOf(+od))}${esc(od)}<small>幅 ${esc(sz)}</small></span>`;
   }),
   diffRows('フィンガー', cur.finger, pd && pd.finger, shelf.finger),
   diffRows('刃', cur.blade, pd && pd.blade, shelf.blade, k => {
    const [dia, tk] = String(k).split('|');
    return `Φ${esc(dia)}${tk ? `<small>刃厚 ${esc(tk)}</small>` : ''}`;
   })
  ];
  $('#bsDiffHead').innerHTML =
   (inUse ? `<div class="bs-alert"><b>ラインで稼働中（直前の刃組）</b>　台車 ${esc(inUse.carriage)}<br>`
     + `${esc(inUse.at)}<br>${esc(inUse.note)}<br>ここに載っている部材は外せないため、今回は使えません。</div>` : '')
   + (prev
    ? `<div class="bs-alert is-info"><b>組み替える台車 ${esc(st.carriage)} の現在の構成（${back}回前）</b><br>`
      + `${esc(prev.at)}<br>${esc(prev.note)}<br>ここに載っている部材はそのまま使えます。</div>`
    : `<div class="bs-alert">台車 ${esc(st.carriage)} に組み替え対象となる記録がありません。`
      + '刃組を終えるたびに記録すると、次回から2回前の構成との差分が出ます。</div>');
  const total = k => parts.reduce((a, x) => a + x[k], 0);
  const short = parts.flatMap(x => x.short);
  $('#bsDiffSum').innerHTML = '<div class="bs-kpis">'
   + `<div class="bs-kpi"><span>そのまま使える</span><b>${total('keep')}</b></div>`
   + `<div class="bs-kpi is-good"><span>棚から持ち出す</span><b>${total('add')}</b></div>`
   + `<div class="bs-kpi is-ng"><span>棚に戻す</span><b>${total('back')}</b></div></div>`
   + (short.length ? `<div class="bs-alert is-bad">棚にも足りない部材が ${short.length} 種あります。数を確かめてください。</div>` : '');
  $('#bsDiff').innerHTML = '<thead><tr><th class="bs-a">部品</th><th>台車</th><th>今回</th>'
   + '<th>追加</th><th>戻す</th></tr></thead><tbody>'
   + parts.map(x => x.html).join('') + '</tbody>';
  $('#bsHist').innerHTML = h.length
   ? h.slice(0, 6).map((r, i) => `<div class="bs-hrow${i === 0 ? ' is-use' : ''}${prev && r === prev ? ' is-tgt' : ''}">`
     + `<span class="bs-hi">${i === 0 ? '1回前 稼働中' : (i + 1) + '回前'}</span>`
     + `<span class="bs-hc">台車 ${esc(r.carriage)}</span><span class="bs-hn">${esc(r.at)}</span>`
     + `<button type="button" class="bs-btn is-sm" data-hdel="${esc(r.id)}">削除</button></div>`).join('')
   : '<div class="bs-hempty">記録がありません</div>';
  /* 刃セットの候補は**刃マスタの「組」**から作る（§9.378、利用者の指示
     「マスタを整備すれば入力を不要にできるものがあればマスタの導入も検討」）
     ——人が綴りを打つ場面を作らない。1つしか無ければ初めから選んでおく。 */
  const sel = $('#bsSetPick');
  if (sel) {
   const gs = [...new Set((M.blades || []).map(k => String(k.group || '').trim()))]
    .filter(Boolean).sort();
   if (!gs.includes(st.bladeGroup)) st.bladeGroup = gs.length === 1 ? gs[0] : '';
   sel.innerHTML = `<option value="">選ぶ</option>`
    + gs.map(g => `<option value="${esc(g)}"${g === st.bladeGroup ? ' selected' : ''}>`
                  + `セット${esc(g)}</option>`).join('');
   sel.disabled = !gs.length;
   sel.title = gs.length ? '刃マスタの「組」から選びます'
                         : '刃マスタに「組」の登録がありません';
  }
  $('#bsSaveCar').textContent = `刃組完了：台車 ${st.carriage} として記録`;
 }

 /* ====================== 刃の状態 ====================== */
 function renderSets() {
  const a = BS().warnings(st, M);
  renderFoot(a);
  $('#bsSetAlerts').innerHTML = a.length
   ? `<div class="bs-alert is-bad"><b>要確認 ${a.length}件</b><br>`
     + `${a.slice(0, 6).map(x => esc(x.text)).join('<br>')}`
     + `${a.length > 6 ? '<br>ほか ' + (a.length - 6) + '件' : ''}</div>`
   : '<div class="bs-alert is-ok">在庫・研磨・使用限界に要確認はありません。</div>';
  const groups = [];
  M.blades.forEach(k => {
   const g = groups.find(x => x.group === (k.group || ''));
   if (g) g.items.push(k); else groups.push({ group: k.group || '', items: [k] });
  });
  const days = d => (d ? Math.floor((Date.now() - new Date(d)) / 86400000) : null);
  $('#bsSetList').innerHTML = groups.length ? groups.map(g => {
   const on = g.items.some(k => BS().selectable(k, M));
   const rows = g.items.sort((a2, b2) => (b2.thickness || 0) - (a2.thickness || 0)).map(k => {
    const d = days(k.lastGrind), lim = k.currentDia !== null && M.P.minDia && k.currentDia <= M.P.minDia;
    return `<div class="bs-kr"><b class="bs-tk">${esc(k.thickness)}mm</b>`
     + `<span class="bs-dia${lim ? ' bs-ng' : ''}">Φ${esc(k.currentDia)}</span>`
     + `<span class="bs-gr">研磨 ${esc(k.lastGrind || '—')}${d !== null ? `（${d}日）` : ''}</span>`
     + `<span class="bs-qt">${esc(k.qty)}枚</span>`
     + `<button type="button" class="bs-btn is-sm" data-load-blade="${esc(k.name)}">呼出</button></div>`;
   }).join('');
   return `<div class="bs-sc${on ? ' is-on' : ''}"><div class="bs-sch">`
    + `<b>${esc(g.group ? '組 ' + g.group : '（組の指定なし）')}</b>`
    + `<span class="bs-sb">${esc(g.items[0].status || '—')}</span></div>`
    + `<div class="bs-kl">${rows}</div></div>`;
  }).join('')
   : '<p class="bs-note">この設備の刃が登録されていません（マスタ管理 &gt; 刃組 &gt; 刃）。</p>';
 }

 /* 足元の一言。**件数と行き先だけ**（中身は「刃の状態」が持つ）。 */
 function renderFoot(a) {
  const foot = $('#bsFoot');
  if (!foot) return;
  if (!a.length) {
   foot.className = 'bs-rail-foot is-ok';
   foot.innerHTML = '<span>在庫・研磨・使用限界に要確認はありません</span>';
   return;
  }
  foot.className = 'bs-rail-foot is-ng';
  foot.innerHTML = `<span><b>要確認 ${a.length}件</b>${esc(a[0].text)}`
   + `${a.length > 1 ? ' ほか' + (a.length - 1) + '件' : ''}</span>`
   + '<button type="button" class="bs-btn is-sm" data-r="set">刃の状態を見る</button>';
 }

 /* ====================== 入力の配線 ====================== */
 function paintInputs() {
  $('#bsKnife').value = st.knife;
  $('#bsThick').value = st.thick;
  $('#bsTk').value = st.tk;
  $('#bsClr').value = st.clr;
  $('#bsOv').value = st.ov;
  $('#bsW').value = st.W;
  $('#bsNkWidth').value = st.nkWidth;
  $('#bsCanNk').checked = !!st.canNk;
  $('#bsTrimEven').checked = st.trimMode === 'even';
  $('#bsOsTrim').disabled = st.trimMode === 'even';
  panel.querySelectorAll('#bsAlign input').forEach(r => { r.checked = r.value === st.align; });
  markAlign();
  renderLots();
  setFlip(st.flip);
 }
 const markAlign = () => panel.querySelectorAll('#bsAlign label')
  .forEach(l => l.classList.toggle('is-on', l.dataset.v === st.align));

 function fillBladePick() {
  const sel = $('#bsBladePick'), cur = sel.value;
  sel.innerHTML = '<option value="">（手で入力）</option>'
   + M.blades.map((k, i) => `<option value="${i}">${esc(k.name)}　Φ${esc(k.currentDia)}`
     + `　刃厚${esc(k.thickness)}　${esc(k.status)}</option>`).join('');
  sel.value = cur;
  if (sel.selectedIndex < 0) sel.selectedIndex = 0;
 }
 function fillRingSelects() {
  const opts = IX.ringsByTh.map(r =>
   `<option value="${BS().thOf(r)}">${esc(r.color)} ${r.od}（肉厚 ${BS().thOf(r).toFixed(1)}）</option>`).join('');
  $('#bsBigSel').innerHTML = opts;
  $('#bsSmSel').innerHTML = opts;
 }
 function loadBlade(k) {
  if (!k) return;
  if (k.currentDia) st.knife = k.currentDia;
  if (k.thickness) st.tk = k.thickness;
  $('#bsKnife').value = st.knife;
  $('#bsTk').value = st.tk;
 }
 /* 図面向き／段取り向き。**模式図は見せ方を裏返し、立体図は台車そのものを回す**
    ——どちらも「DS を手前（左）に置く」という同じ1つの状態から出す（§9.377）。 */
 function setFlip(on) {
  st.flip = !!on;
  const b = $('#bsFlip');
  b.classList.toggle('is-on', st.flip);
  b.textContent = st.flip ? '段取り向き（DS左）' : '図面向き（OS左）';
  $('#bsFigRow').classList.toggle('is-flip', st.flip);
  if (WL.bladeSolid) WL.bladeSolid.spinTo(st.flip ? Math.PI : 0);
 }

 const closePops = () => panel.querySelectorAll('.bs-step').forEach(p => p.classList.remove('is-open'));

 /* 模式図／立体図。**器の出し入れはここが持ち、中身は`WL.bladeSolid`が持つ**。 */
 let figKind = '2d';
 function figMode(mode) {
  figKind = mode === '3d' ? '3d' : '2d';
  panel.querySelectorAll('#bsFigTabs [data-fig]')
   .forEach(b => b.classList.toggle('is-on', b.dataset.fig === figKind));
  panel.querySelector('.bs-stage').hidden = figKind === '3d';
  $('#bsStage3').hidden = figKind !== '3d';
  if (!WL.bladeSolid) return;
  WL.bladeSolid.sync({ st, M, res: LAST, ringHex: hexOf });
  WL.bladeSolid.setMode(figKind === '3d');
 }

 function wire() {
  /* 数値欄は id をそのまま状態の鍵にする。 */
  [['bsKnife', 'knife'], ['bsThick', 'thick'], ['bsTk', 'tk'], ['bsClr', 'clr'],
   ['bsOv', 'ov'], ['bsW', 'W'], ['bsOsTrim', 'osTrim'], ['bsNkWidth', 'nkWidth']]
   .forEach(([id, key]) => {
    const el = panel.querySelector('#' + id);
    el.addEventListener('input', e => {
     st[key] = +e.target.value;
     /* **板厚を変えたらクリアランスを引き直す**（自動のときだけ）。
        クリアランスを手で打ったら、以降はその値を尊重する。 */
     if (key === 'clr') st.clrAuto = false;
     if (key === 'thick') syncClearance();
     scheduleRender();
    });
   });
  $('#bsAlign').addEventListener('change', e => {
   if (e.target.name !== 'bsAl') return;
   st.align = e.target.value;
   markAlign();
   scheduleRender();
  });
  $('#bsCanNk').addEventListener('change', e => { st.canNk = e.target.checked; scheduleRender(); });
  $('#bsTrimEven').addEventListener('change', e => {
   st.trimMode = e.target.checked ? 'even' : 'manual';
   $('#bsOsTrim').disabled = e.target.checked;
   scheduleRender();
  });
  $('#bsBladePick').addEventListener('change', e => {
   if (e.target.value === '') return;
   loadBlade(M.blades[+e.target.value]);
   scheduleRender();
  });
  $('#bsBigSel').addEventListener('change', e => { st.bigTh = +e.target.value; scheduleRender(); });
  $('#bsSmSel').addEventListener('change', e => { st.smallTh = +e.target.value; scheduleRender(); });
  /* ロットの表 */
  $('#bsLotTbl').addEventListener('input', e => {
   const el = e.target;
   if (el.dataset.lot === undefined) return;
   const k = el.dataset.k;
   st.lots[+el.dataset.lot][k] = (k === 'name') ? el.value : +el.value;
   renderOrder();
   scheduleRender();
  });
  $('#bsLotTbl').addEventListener('click', e => {
   const b = e.target.closest('[data-del-lot]');
   if (!b || st.lots.length <= 1) return;
   const gone = +b.dataset.delLot;
   st.lots.splice(gone, 1);
   st.order = st.order.filter(i => i !== gone).map(i => (i > gone ? i - 1 : i));
   renderLots(); renderOrder(); scheduleRender();
  });
  /* 条の設計を**その場で記録**（§9.381）。刃組完了のときにも記録するが、
     測定が先に始まることがあるので、**完了を待たずに残せる**ようにする。 */
  $('#bsDsSave').addEventListener('click', async () => {
   const btn = $('#bsDsSave');
   if (!designState().total) {
    await alertModal('ロットがありません。元板巾とロットを入れてください。');
    return;
   }
   btn.disabled = true;
   try {
    const n = await saveDesigns();
    if (!n) {
     await alertModal('条の設計を記録できませんでした。ロット番号が空かもしれません。');
    } else {
     await loadContext(st.equipment);
     renderDesignState();
     showToast('条の設計を記録しました',
               `${n}ロット分。測定画面はこの並びで条を埋めます。`, 3800);
    }
   } catch (e) {
    await alertModal('条の設計を記録できませんでした：' + (e && e.message ? e.message : e));
   } finally { btn.disabled = false; }
  });
  $('#bsAddLot').addEventListener('click', () => {
   st.lots.push({ name: 'LOT' + (st.lots.length + 1), w: 200, n: 1 });
   renderLots(); renderOrder(); scheduleRender();
  });
  /* 条の並びをつまんで動かす */
  let dragFrom = null;
  const list = $('#bsOrdList');
  list.addEventListener('dragstart', e => {
   const c = e.target.closest('.bs-oc');
   if (!c) return;
   dragFrom = +c.dataset.pos;
   c.classList.add('is-drag');
   e.dataTransfer.effectAllowed = 'move';
   try { e.dataTransfer.setData('text/plain', String(dragFrom)); } catch (err) {
    WL.quiet.note('ドラッグの持ち物を置けない（並べ替えは動く）', err);
   }
  });
  list.addEventListener('dragend', () => {
   dragFrom = null;
   list.querySelectorAll('.bs-oc').forEach(x => x.classList.remove('is-drag', 'is-over'));
  });
  list.addEventListener('dragover', e => {
   if (dragFrom === null) return;
   e.preventDefault();
   const c = e.target.closest('.bs-oc');
   list.querySelectorAll('.bs-oc').forEach(x => x.classList.remove('is-over'));
   if (c) c.classList.add('is-over');
  });
  list.addEventListener('drop', e => {
   if (dragFrom === null) return;
   e.preventDefault();
   const c = e.target.closest('.bs-oc');
   let to = c ? +c.dataset.pos : st.order.length - 1;
   const r = c ? c.getBoundingClientRect() : null;
   if (r && e.clientX > r.left + r.width / 2) to++;
   const moved = st.order.splice(dragFrom, 1)[0];
   if (to > dragFrom) to--;
   st.order.splice(Math.max(0, Math.min(st.order.length, to)), 0, moved);
   dragFrom = null;
   renderOrder(); scheduleRender();
  });
  panel.querySelectorAll('[data-ord]').forEach(b => b.addEventListener('click', () => {
   BS().reorder(st, b.dataset.ord);
   renderOrder(); scheduleRender();
  }));
  /* リングの自動／手動 */
  panel.querySelectorAll('.bs-chip[data-ring]').forEach(b => b.addEventListener('click', () => {
   const ring = b.dataset.ring, auto = b.dataset.mode === 'auto';
   panel.querySelectorAll(`.bs-chip[data-ring="${ring}"]`)
    .forEach(x => x.classList.toggle('is-on', x === b));
   st[ring === 'big' ? 'bigMode' : 'smallMode'] = b.dataset.mode;
   $(ring === 'big' ? '#bsBigSel' : '#bsSmSel').disabled = auto;
   scheduleRender();
  }));
  /* 手順のポップオーバー */
  panel.querySelectorAll('[data-step-open]').forEach(b => b.addEventListener('click', e => {
   e.stopPropagation();
   const host = b.closest('.bs-step'), was = host.classList.contains('is-open');
   closePops();
   if (!was) host.classList.add('is-open');
  }));
  document.addEventListener('click', e => {
   if (!panel || panel.hidden) return;
   if (e.target.closest('.bs-step')) return;
   closePops();
  });
  document.addEventListener('keydown', e => {
   if (e.key === 'Escape' && panel && !panel.hidden) closePops();
  });
  /* 記号に**重ねている間だけ**図と表を連動させる（§9.378）。**図でも表でも
     同じ的**（`[data-badge]`）で受けるので、重ねる場所によって効き方が
     変わらない。押す操作は持たない——持たせると解除も手で要る。 */
  panel.addEventListener('pointerover', e => {
   const hit = e.target.closest('[data-badge]');
   pickBadge(hit && panel.contains(hit) ? hit.dataset.badge : '');
  });
  /* 器の外へ出たら消す（最後に重ねた記号が光ったまま残らない）。 */
  panel.addEventListener('pointerleave', () => pickBadge(''));
  /* 段取りへ戻る（§9.378）。**左メニューと同じ口**を呼ぶ——入口を2つにしない。 */
  $('#bsFrom').addEventListener('click', () => {
   const api = WL.scheduleView;
   if (!api || typeof api.open !== 'function') {
    alertModal({ title: '作業スケジュールを開けません',
                 message: '左のメニューの「作業スケジュール」から開いてください。' });
    return;
   }
   Promise.resolve(api.open()).catch(e => {
    WL.quiet.note('作業スケジュールへ戻れない', e);
    alertModal({ title: '作業スケジュールへ戻れません',
                 message: String((e && e.message) || e || '') });
   });
  });
  /* 図の向き */
  $('#bsFlip').addEventListener('click', () => { setFlip(!st.flip); renderOrder(); scheduleRender(); });
  /* 模式図／立体図（§9.377 追補）。**押した札はすぐ濃くする**——部品を取りに
     行くあいだ何も変わらないと、押せていないように見える。読めなかったときは
     立体図の器の中に理由が出る（模式図へは勝手に戻さない・選んだのは利用者）。 */
  $('#bsFigTabs').addEventListener('click', e => {
   const b = e.target.closest('[data-fig]');
   if (!b) return;
   figMode(b.dataset.fig);
  });
  if (WL.bladeSolid) {
   WL.bladeSolid.attach($('#bsStage3'), { onSpin: () => {
    setFlip(!st.flip); renderOrder(); scheduleRender();
   } });
  }
  /* 右の段 */
  /* 段の切り替え。**足元の「刃の状態を見る」も同じ道を通る**（入口を2つに
     しない・§9.207）ので、器ではなく`[data-r]`を持つ物で受ける。 */
  panel.addEventListener('click', e => {
   const b = e.target.closest('[data-r]');
   if (!b || !panel.contains(b)) return;
   railTab = b.dataset.r;
   panel.querySelectorAll('#bsRailTabs [data-r]')
    .forEach(x => x.classList.toggle('is-on', x.dataset.r === railTab));
   panel.querySelectorAll('.bs-pb [data-p]').forEach(p => { p.hidden = p.dataset.p !== railTab; });
  });
  panel.querySelectorAll('[data-car]').forEach(b => b.addEventListener('click', () => {
   panel.querySelectorAll('[data-car]').forEach(x => x.classList.toggle('is-on', x === b));
   st.carriage = b.dataset.car;
   scheduleRender();
  }));
  $('#bsSetPick').addEventListener('change', e => { st.bladeGroup = e.target.value; });
  $('#bsSaveCar').addEventListener('click', saveCarriage);
  $('#bsHist').addEventListener('click', e => {
   const b = e.target.closest('[data-hdel]');
   if (b) deleteHistory(b.dataset.hdel);
  });
  $('#bsSetList').addEventListener('click', e => {
   const b = e.target.closest('[data-load-blade]');
   if (!b) return;
   loadBlade(M.blades.find(x => x.name === b.dataset.loadBlade));
   scheduleRender();
  });
  /* 足りないマスタの受け皿 */
  panel.querySelector('#bsEmpty').addEventListener('click', e => {
   if (e.target.closest('#bsSeed')) seedMasters();
   else if (e.target.closest('#bsToMaster')) {
    if (WL.mm && typeof WL.mm.openMasterMaint === 'function') WL.mm.openMasterMaint('bladesetSpacer');
    else showToast('マスタ管理を開けません', 'この端末ではマスタ管理の画面が読み込まれていません', 4200);
   }
  });
  window.addEventListener('resize', () => { if (panel && !panel.hidden && LAST) drawFigure(LAST); });
 }

 /* ---------- 書く ---------- */
 async function seedMasters() {
  const ok = await confirmModal({
   title: '刃組マスタの初期セットを登録します',
   bodyHtml: `<p class="confirm-modal-message">${esc(st.equipment || 'この設備')} へ、`
    + 'このアプリが持っている標準の部材構成を登録します。</p>'
    + '<p class="confirm-modal-message">刃 6／スペーサー 26寸法／ゴムリング 50（10色×5幅）／フィンガー 4。'
    + '<b>既に登録がある種類には足しません。</b></p>',
   confirmLabel: '登録する' });
  if (!ok) return;
  try {
   const r = await api('/api/bladeset/seed', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withUserId({ equipment: st.equipment }))
   });
   showToast('刃組マスタ', (r && r.message) || '登録しました', 4200);
   await loadContext(st.equipment);
   fillBladePick(); fillRingSelects(); render();
   const miss = missingMasters();
   if (miss) showEmptyMissing(miss); else showEmpty('');
  } catch (e) {
   await alertModal('初期セットを登録できませんでした：' + (e && e.message ? e.message : e));
  }
 }
 /* 刃組完了。**足りない入力はその場で言う**（§9.378、利用者の指示「刃組完了と
    する場合に必要なデータは入力を促すような工夫」）。人が決めるのは台車と
    刃セットの2つだけで、残りは計算とマスタから入る——だから足りないのが
    どちらなのかを名指しできる（§CLAUDE 4・6）。 */
 /* 確定保存に載る「本数・1本目の材料」を**押す前に見せる**（§CLAUDE 6 出どころ）。
    予定から開いていないときは、そう書く——黙って空で残すと、あとから
    「なぜ本数が無いのか」を探すことになる。 */
 function runConfirmHtml() {
  if (!seededRun) {
   return '<p class="confirm-modal-message bs-note">予定から開いていないため、'
    + '<b>切る予定本数と1本目の材料は残りません</b>'
    + '（作業スケジュールの段取りの行から開くと記録されます）。</p>';
  }
  const f = seededRun.first || {};
  const bits = [f.material, f.thickness != null && f.thickness !== '' ? `t${f.thickness}` : '',
                f.width != null && f.width !== '' ? `幅${f.width}` : '', f.purpose]
   .map(x => String(x || '').trim()).filter(Boolean);
  return `<p class="confirm-modal-message"><b>予定本数</b>　${seededRun.planned} 本`
   + `　<b>1本目</b>　${esc(f.lot || '（読めません）')}`
   + (bits.length ? `（${esc(bits.join(' / '))}）` : '（材質・寸法が読めません）') + '</p>';
 }
 async function saveCarriage() {
  if (!LAST) return;
  const B = BS();
  const gs = [...new Set((M.blades || []).map(k => String(k.group || '').trim()))].filter(Boolean);
  if (gs.length && !st.bladeGroup) {
   await alertModal({ title: '刃セットを選んでください',
     message: '「台車差分」の上にある〈刃セット〉から、この刃組で使った組を選びます。'
            + '候補は刃マスタの「組」から出しています。' });
   const sel = $('#bsSetPick'); if (sel && sel.focus) sel.focus();
   return;
  }
  const detail = B.snapshot(st, M, LAST.g);
  detail.set = st.bladeGroup || '';
  /* **確定保存に載せるもの**（§9.382、利用者の指示）。刃組スケジュール一覧が
     読むのはこの1件なので、**そのとき決まっていたことを全部ここへ**置く
     ——別々の場所から集め直すと、後から片方だけ変わって食い違う。
       台車・刃セット      … `carriage` と `set`
       板押さえ・部材の員数 … `cond.hold` と `spacer`/`ring`/`finger`
       クリアランス・ラップ … `cond.clearance` / `cond.overlap`
       1本目の材料・予定本数 … ここで足す（予定から運んだもの）
     予定から開いていないときは `run` を置かない（空の器を作らない）。 */
  if (seededRun) detail.run = { planned: seededRun.planned, first: seededRun.first };
  detail.from = seededFrom || '';
  detail.stopId = seededStopId || '';
  const c = detail.cond || {};
  const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const note = `${B.METHOD_NAME[LAST.method]}／Φ${st.knife.toFixed(1)}／${B.holdName(st, M)}／`
   + st.lots.map(l => `${l.name} ${l.w}×${l.n}`).join(' , ');
  /* **何が残るかを見せてから**記録する。取り消せる操作ではあるが、次の段取りの
     差分がこの1件から出るので、条件を目で確かめられるようにする。 */
  const ok = await confirmModal({
   title: `台車 ${st.carriage} の刃組を記録します`,
   bodyHtml: '<p class="confirm-modal-message">この内容で残します。'
    + '次の段取りは、この記録との差分から「持ち出す／戻す／そのまま使える」を出します。</p>'
    + `<p class="confirm-modal-message"><b>条件</b>　${c.strips || 0}条 ／ `
    + `板厚 ${(+c.thickness || 0).toFixed(2)} ／ Φ${(+c.knife || 0).toFixed(1)} ／ `
    + `${esc(c.method ? B.METHOD_NAME[c.method] || c.method : '')} ／ ${esc(c.hold || '')}</p>`
    + `<p class="confirm-modal-message"><b>刃セット</b>　${esc(st.bladeGroup || '（登録なし）')}`
    + `　<b>条の設計</b>　${B.designByParent(st).length} ロット分</p>`
    + runConfirmHtml(),
   confirmLabel: '記録する' });
  if (!ok) return;
  try {
   await api('/api/bladeset/history', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withUserId({ equipment: st.equipment, carriage: st.carriage,
                                      at, note, detail }))
   });
   /* **条の設計も同じ瞬間に残す**（§9.378）——「この条の並びで刃組をした」と
      「測定でこの条を測る」は同じ1つの決定なので、別々の操作にしない。
      記録は**親ロット1件ごと**（測定が開くのは親ロット1件）。 */
   const designs = await saveDesigns();
   showToast('刃組の記録',
             `台車 ${st.carriage} として残しました`
             + (designs ? `／条の設計 ${designs} ロット分` : ''), 3800);
   await loadContext(st.equipment);
   render();
  } catch (e) {
   await alertModal('刃組の記録を残せませんでした：' + (e && e.message ? e.message : e));
  }
 }
 /* 条の設計を親ロットごとに書く。**失敗しても刃組の記録は残す**——先に書いた
    履歴まで巻き戻すと、組んだ事実が消える。失敗は理由を残して件数に数えない。 */
 /* いまの並びが**記録済みか**を言う（§9.381）。測定はここへ記録した並びで
    条を埋めるので、**記録していないことに気づけない**と、測定が既定の並びで
    始まってしまう（§CLAUDE 推測させない）。
    比べるのは「どの子ロットを何本・どの順で」——幅は条の設計の従属値。 */
 function designSignature(groups) {
  return (groups || []).map(g => `${g.lot}:${g.count}`).join('|');
 }
 function designState() {
  const list = BS().designByParent(st);
  const saved = (M && M.designs) || [];
  const out = { total: list.length, same: 0, diff: 0, none: 0, parents: [] };
  list.forEach(d => {
   const hit = saved.find(x => x.lot === d.parent);
   const state = !hit ? 'none'
    : (designSignature(hit.groups) === designSignature(d.groups) ? 'same' : 'diff');
   out[state] += 1;
   out.parents.push({ parent: d.parent, state });
  });
  return out;
 }
 function renderDesignState() {
  const el = $('#bsDsState'), note = $('#bsDsNote');
  if (!el) return;
  const d = designState();
  if (!d.total) {
   el.textContent = 'ロットがありません';
   el.className = 'bs-dzs';
   if (note) note.textContent = '元板巾とロットを入れると、その並びが条の設計になります。';
   return;
  }
  /* **色だけで言わない**（§CLAUDE 3）——分類名と件数を字で出す。 */
  if (d.diff) {
   el.textContent = `記録と違う ${d.diff}件`;
   el.className = 'bs-dzs is-diff';
  } else if (d.none) {
   el.textContent = `未記録 ${d.none}件`;
   el.className = 'bs-dzs is-none';
  } else {
   el.textContent = `記録済み ${d.same}件`;
   el.className = 'bs-dzs is-same';
  }
  if (note) {
   note.textContent = d.diff
    ? '画面の並びと、記録してある並びが違います。記録し直すと測定もこの並びになります。'
    : (d.none
       ? '記録すると、測定画面がこの並びで条を埋めます。記録しないと測定は既定の並びで始まります。'
       : '測定画面はこの並びで条を埋めます。');
  }
 }
 async function saveDesigns() {
  const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const list = BS().designByParent(st);
  let done = 0;
  for (const d of list) {
   if (!d.parent || !d.groups.length) continue;
   try {
    await api('/api/bladeset/strip-design', {
     method: 'POST', headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify(withUserId({
      equipment: st.equipment, lot: d.parent, strips: d.strips,
      coilWidth: st.W, thickness: st.thick, groups: d.groups, at,
      note: `刃組（台車 ${st.carriage}）` }))
    });
    done += 1;
   } catch (e) {
    WL.quiet.note(`条の設計を記録できない（${d.parent}）`, e);
   }
  }
  return done;
 }
 async function deleteHistory(id) {
  const ok = await confirmModal({ title: '刃組の記録を消します',
                                  message: 'この記録を消すと、台車差分の比べる相手が1つ前へずれます。',
                                  confirmLabel: '消す', danger: true });
  if (!ok) return;
  try {
   await api('/api/bladeset/history/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withUserId({ id }))
   });
   await loadContext(st.equipment);
   render();
  } catch (e) {
   await alertModal('記録を消せませんでした：' + (e && e.message ? e.message : e));
  }
 }

 /* ====================== 画面の登録 ====================== */
 WL.onReady(() => {
  WL.registerView({
   /* **左メニューには置かない**（§9.379、利用者の指示）。刃組は「予定の
      どの段取りの刃組か」が決まって初めて意味を持つので、入口は作業
      スケジュールの設備停止行のチップだけにする。文脈の無いまま開けると、
      どのロットの刃組なのかを人が思い出して入れ直すことになる。
      そのため `nav` も持たない（選択状態を点ける相手が居ない）。 */
   key: 'bladeset', bodyClass: 'bs-mode',
   header: ['刃組ガイダンス', ''],
   /* **自分の`bodyClass`は自分で外す**（`enterView`は付けるだけ・他の画面と
      同じ作法）。外し忘れると`.bs-shell`が次の画面の上に居座る。 */
   exit: () => {
    document.body.classList.remove('bs-mode');
    /* 立体図は毎フレーム描くものではないが、**画面を出たら描かせない**
       （器の大きさが0になり、次に入ったとき比率がおかしくなる）。 */
    if (WL.bladeSolid && WL.bladeSolid.on) WL.bladeSolid.setMode(false);
    if (panel) { panel.hidden = true; closePops(); }
   }
  });
 });

 WL.bladeGuide = { open, state: st, get masters() { return M; } };
})();
