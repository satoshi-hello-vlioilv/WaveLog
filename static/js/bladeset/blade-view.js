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

 /* ---------- 状態（画面で選んでいる条件。保存はしない） ----------
    **既定値は`blade-core.js`の`defaultState()`が持つ**（§9.408）。刃組
    スケジュール一覧が「標準どおり組んだらどうなるか」を同じ既定から計算する
    ので、ここに書き写すと2箇所になる（片方だけ直すと一覧と画面が食い違う）。 */
 const st = BS().defaultState();
 let M = null, IX = null, LAST = null;
 let panel = null, railTab = 'ends', loadToken = 0;
 let seededFrom = null;     /* どの予定から開いたか（画面に出どころを出す） */
 /* **来た道**（§9.407、利用者の指摘①「戻るボタンで作業スケジュール一覧に
    戻れず、全体のスケジュール一覧に戻ってしまう」）。作業スケジュールは段を
    3つ持つ（全体／個別／刃組）ので、**開いた段をそのまま返す**。
    `{mode}`だけを持ち、段の呼び名は向こう（`WL.scheduleView.modeName()`）が
    答える——こちらに綴りを写すと、札の字を直したときにここだけ古くなる。 */
 let seededBack = null;
 /* 予定から拾えなかった行の数（分割ありで子ロットの切断巾が読めない等）。
    **0で埋めずに件数を言う**（§9.231・§CLAUDE 4）——黙って落とすと、
    条が1本足りないことに現場が気づけない。 */
 let seededSkip = 0;
 /* 予定から運んだ「本数・1本目の材料」（§9.382）。刃組の記録へそのまま残す。 */
 let seededRun = null;
 /* どの段取りの行から開いたか（§9.383）。記録と予定の行を結ぶ鍵。 */
 let seededStopId = '';
 /* **1本目に切るコイル（親ロット）**（§9.387）。刃組はこの1本で組み、条の
    設計もこの1件で引く。予定から開いていないときは空のまま。 */
 let seededHeadLot = '';
 /* 1本目が分割ありか（§9.388）。分割ありのときは幅を持っているのが
    子ロットなので、仕掛データからの取り直しは当てない。 */
 let seededHeadSplit = false;

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
                   'trim-edge', 'finger', 'lube', 'lube-edge', 'label', 'ink', 'sheen',
                   'lead0', 'lead1', 'lead2',
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
      ${factHtml('クリアランス', 'bsFClr')}
      <!-- **板押さえは1項目**（§9.465、利用者の指示「板押さえにしないと、ゴムリングの
           フィンガーみたいな謎の言葉を生み出す」「表示の重複もある」）。名前は層の総称
           （板押さえ）、値が方式（ゴムリング／フィンガー）を言う。「保持」の欄は同じ
           ことを2度言っていたので畳んだ（§CLAUDE 8）。 -->
      ${stepHtml(0, '板押さえ', 'bsV4', step4Html(), 'auto')}
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
       <!-- 断面図（§9.412、利用者の指示）。**立体図と同じ模型**を、機械まわりを
            伏せて・平行投影の真横から・軸の中心で切って見る。模式図の読み取り
            やすさ（真横・同じ並び）と、立体の質感を両方持たせるための1枚。 -->
       <div class="bs-seg" id="bsFigTabs">
        <button type="button" class="bs-chip" data-fig="2d">模式図</button>
        <button type="button" class="bs-chip is-on" data-fig="cut" title="立体の模型を軸の中心で切り、真横から平行投影で見ます。寸法は模式図と同じ読み方ができます">断面図</button>
        <button type="button" class="bs-chip" data-fig="3d">立体図</button>
       </div>
       <!-- **向きの切り替えは図の見出しへ置く**（§9.380、利用者の指示
            「OSDS入替ボタンは模式図に移動させて」）。効く先はこの図の
            左右（DS／OSの字と部材の並び）なので、手順バーの尻尾に置くと
            「何に効くボタンか」を探すことになる（§CLAUDE 14 視覚導線と
            作業導線を一致させる）。 -->
       <!-- **向きは「基準原点を左／右」の2つの札**（§9.463、利用者の指示「段取り向きとか
            図面向きというのをやめて、基準原点を左、基準原点を右といった形で迷いの少ない
            呼び方に」）。1つの札を押すたびに字が入れ替わる形だと、字が「いま」なのか
            「押すと」なのかで迷う——**2つ並べ、いまの側を濃くする**（§9.229）。
            呼び方と既定の側は刃組基準値マスタが持つ（viewLabelLeft/Right・viewDatumPos）。 -->
       <div class="bs-hide bs-datumpos" id="bsFlip" role="group" aria-label="図の向き">
        <button type="button" data-datum-pos="左" aria-pressed="false">基準原点を左</button>
        <button type="button" data-datum-pos="右" aria-pressed="false">基準原点を右</button>
       </div>
       <span class="bs-ph-note" id="bsFigNote"></span></div>
      <!-- **両脇の表は右レールへ移した**（§9.379、利用者の指示）。ここを1列に
           したぶん模式図が広がる（実測 760→1112px・+46%）。端部の表は
           「組む前に一度見る」もので、模式図のように常時見比べるものでは
           ない——常時載せる面積は「頻度 × 重要度」で配る（§CLAUDE 1）。 -->
      <p class="bs-stopnote">組めない材料なので、刃組図は描いていません（理由は刃組表の場所に出ています）。</p>
      <div class="bs-figrow" id="bsFigRow">
       <div class="bs-figmain">
        <div class="bs-stage" hidden><svg id="bsStage" viewBox="0 0 1000 300"
         preserveAspectRatio="xMidYMid meet" role="img" aria-label="刃組図"></svg></div>
        <!-- **区間の拡大**（§9.413、利用者の指示「アルファベットをクリックしたら、
             ポップオーバーでその部分だけの組み合わせを拡大した図を…すべての
             サイズのものにラベルを貼って詳しく並びと対象の寸法を伝える」）。
             模式図は軸ぜんたいを1枚に収めるので、狭い区間は十数pxしかなく
             **部材の幅は字が入らないので出していない**。ここは1区間だけを
             器いっぱいに使うので、全部の寸法に字を添えられる。 -->
        <div class="bs-zoom" id="bsZoom" hidden role="dialog" aria-label="区間の拡大">
         <!-- 見出しの帯は**掴んで動かす取っ手**（§9.437、利用者の指示）。
              押せるのに何も起きない的を作らないため、カーソルの形と説明の字の
              両方で言う。（この中は文字列リテラルの中なので、逆引用符は書けない） -->
         <div class="bs-zoom-hd" title="この帯をドラッグすると、拡大図の位置を変えられます">
          <span class="bs-zoom-bd" id="bsZoomBadge">A</span>
          <span class="bs-zoom-tx"><b id="bsZoomTitle">—</b><small id="bsZoomSub">—</small></span>
          <button type="button" class="bs-zoom-x" id="bsZoomClose" title="閉じる（Esc）" aria-label="閉じる">✕</button>
         </div>
         <svg id="bsZoomFig" viewBox="0 0 760 300" preserveAspectRatio="xMidYMid meet"
          role="img" aria-label="区間の拡大図"></svg>
         <p class="bs-zoom-note" id="bsZoomNote"></p>
        </div>
        <div class="bs-stage3 is-cut" id="bsStage3">
         <canvas class="bs-c3"></canvas>
         <!-- **寸法の層**（§9.418）。刃の上下のずれを示す縦の破線と、部材の幅の
              字を置く。図形の上に重ねる線と字なので、WebGL の中ではなく SVG で
              描く（破線・引き出し線・字の縁取りが素直に書け、色もトークンから
              選べる）。押す的は持たない（掴んで回す道をふさがない）。 -->
         <svg class="bs-t3v" id="bsCutDim" aria-hidden="true"></svg>
         <span class="bs-t3 bs-t3-os is-os" data-badge="OS" hidden title="OS 側。重ねると OS端の区間と右の端部の表が光ります">OS</span>
         <span class="bs-t3 bs-t3-ds is-ds" data-badge="DS" hidden title="DS 側。軸端部を外し、こちらから部材を入れます。重ねると DS端の区間と右の端部の表が光ります">DS</span>
         <!-- **設定有効長と、組んだときの上下それぞれの合計長**（§9.418 追補、
              利用者の指示）。図の読み方の段とは別に置く——あちらは
              「どう見るか」、こちらは「合っているか」の突き合わせ。
              （この中は文字列リテラルの中なので、逆引用符は書けない） -->
         <!-- **断面図にも設定を出す**（§9.443、利用者の指示）。**帯は増やさない**
              ——この左上の帯が既に「この図の読み方（bs-o3）」と「突き合わせ
              （bs-len3）」を積んでいる、いまの設定の置き場。3行目として載せる
              （帯を新しく作ると、左上の帯と真上で重なった・実測5364px2）。
              中身は模式図の帯と同じ1箇所（chipBandItems）が作る。
              （この中は文字列リテラルの中なので、逆引用符は書けない） -->
         <div class="bs-hud is-tl"><div class="bs-o3" hidden></div>
          <div class="bs-len3" hidden></div>
          <div class="bs-cutset" hidden></div></div>
         <div class="bs-hud is-tr">
          <button type="button" class="bs-hlp bs-help3" aria-expanded="false">使い方</button>
          <div class="bs-hpop" hidden>
           <dl>
            <dt>段取りの順</dt>
            <dd>①引き出す（レールで回転テーブルへ）→②軸端部を外す（330mm 送り出し、
              テーブルの外の土台に降ろす）→③台車を回す（テーブルごと 180°）</dd>
            <dt>向き</dt>
            <dd>DS 側から部材を入れ、OS 側へ詰めます。材料の入側は、ラインを正面に見て左です。</dd>
            <dt>断面図の見え方</dt>
            <dd>板厚は実寸だと1pxも出ないので、断面図でだけ<b>太らせています</b>
              （倍率は左上に出ます）。<b>上下軸はそのぶん離して</b>あります。
              <b>破線は切断の位置</b>——材料のところは刃を描けない（刃は軸のまわりの
              丸で、切り口では材料の高さまで届かない）ためです。</dd>
            <dt>視点</dt>
            <dd>ドラッグ＝回す／ホイール＝寄る／Shift＋ドラッグ（または右ドラッグ）＝平行移動／
              「視点を戻す」で元へ。<b>断面図では板幅の中心を起点に回ります</b>。
              断面図でも<b>ホイールで拡大・縮小</b>できます（マウスの下の点を中心に。
              拡大したらShift＋ドラッグ／右ドラッグで動かせます）。いまの倍率は
              「視点を戻す」の横に出ます。細い部材の寸法は、拡大すると中に書けます。</dd>
            <dt>表示</dt>
            <dd>下で板・刃・ゴムリング・スペーサーを消せます。点が付いているものが出ています。
              <b>消したものを</b>「薄く」（薄く残す）／「線だけ」（輪郭のワイヤーフレーム）／
              「出さない」（まったく描かない）から選べます。刃だけを見たいけれど
              <b>スペーサーがどこに居たかも知りたい</b>ときは「薄く」が読みやすく、
              位置だけを確かめたいときは「線だけ」、何も邪魔されたくないときは
              「出さない」です。</dd>
           </dl>
          </div>
         </div>
         <div class="bs-hud is-bot">
          <div class="bs-hud-grp"><span class="bs-hud-cap">表示</span>
           <button type="button" class="bs-tg is-on" data-show="mat" data-show-name="板" aria-pressed="true">板</button>
           <button type="button" class="bs-tg is-on" data-show="knife" data-show-name="刃" aria-pressed="true">刃</button>
           <button type="button" class="bs-tg is-on" data-show="ring" data-show-name="ゴムリング" aria-pressed="true">ゴムリング</button>
           <button type="button" class="bs-tg is-on" data-show="liner" data-show-name="スペーサー" aria-pressed="true">スペーサー</button>
           <!-- **隠し方は「表示」と同じ群の中**（§9.422）。消したものをどう出すかは
                上の入切に**かかる設定**なので、別の群に離すと何に効くのか読めない。
                1つだけ選ぶのでセグメント（押した札が濃い）で、入切のトグルとは
                作りを分ける（§9.247）。既定は「出さない」＝今までの動き。 -->
           <span class="bs-hud-sep"></span>
           <span class="bs-hud-cap">消したものは</span>
           <div class="bs-hide" role="group" aria-label="消した部材の見せ方">
            <button type="button" data-hide="ghost" aria-pressed="false">薄く</button>
            <button type="button" data-hide="wire" aria-pressed="false">線だけ</button>
            <button type="button" class="is-on" data-hide="gone" aria-pressed="true">出さない</button>
           </div>
          </div>
          <div class="bs-hud-grp bs-hud-grp--rig"><span class="bs-hud-cap">段取り</span>
           <button type="button" class="bs-btn is-sm is-on bs-step3-pull">①ラインへ戻す</button>
           <button type="button" class="bs-btn is-sm is-on bs-step3-open">②軸端部を戻す</button>
           <button type="button" class="bs-btn is-sm bs-step3-spin">③台車を回す</button>
          </div>
          <!-- **「視点を戻す」は段取りの外**（§9.413 追補）。断面図では段取りの
               群ごと伏せるが、断面図でも視点は回せるので戻す道が要る。 -->
          <div class="bs-hud-grp"><span class="bs-hud-cap">視点</span>
           <button type="button" class="bs-btn is-sm bs-step3-reset">視点を戻す</button>
           <!-- 断面図の倍率（§9.463）。等倍のときは伏せる。 -->
           <span class="bs-zoom3" hidden title="断面図の倍率（全体が収まる大きさ＝×1）。ホイールで変わり、「視点を戻す」で×1へ"></span>
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
      <p class="bs-stopnote">組めない材料なので、端部・所要・台車差分は出していません。</p>
      <!-- 端部（OS端／DS端）。表そのものは renderEnds() が id で書き込むので、
           置き場所を変えても描き手は変わらない。 -->
      <div data-p="ends">
       <!-- 端部の表も**図と同じ印で名乗る**（§9.463、利用者の指示「OS,DSのエリアに
            マウスオーバーでフォーカスしたときに右側の一覧表が強調されるように」）。
            刃の区間と同じ[data-badge]の道に載るので、重ねる場所で効き方が変わらない。 -->
       <div class="bs-side" id="bsOsSide" data-badge="OS"></div>
       <div class="bs-side" id="bsDsSide" data-badge="DS"></div>
       <p class="bs-note" id="bsEndsNote"></p>
      </div>
      <div data-p="bom" hidden>
       <div class="bs-gauges" id="bsGauges"></div>
       <div class="bs-need" id="bsBom"></div>
      </div>
      <div data-p="diff" hidden>
       <!-- 完了に必要なのは「どの台車へ」と「どの刃セットで」の2つ（§9.378）。
            **員数・条件・条の設計は計算とマスタから入る**ので、人が決めるのは
            ここだけ——決める場所を1つにまとめ、完了のボタンのすぐ上に置く。 -->
       <!-- **台車の札は台車マスタが作る**（§9.424、利用者の指示「台車マスタは
            A台車、B台車を登録しておいて」「刃組ガイダンス使う設備＝台車マスタ
            必要」）。ここに A／B を直に書いていたので、3台あるラインを
            登録できず、呼び名も変えられなかった。器だけ置いて中身は
            renderCarPick() が作る。
            **この中は文字列リテラルの中なので、逆引用符は書けない**（§9.420）。 -->
       <div class="bs-carbar"><span class="bs-lbl">台車</span>
        <span id="bsCarPick" class="bs-carpick"></span>
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
  <p class="bs-note">同じ切断で向かい合う上下の刃は、軸方向に<b>刃厚＋クリアランス</b>＝<b id="bsDVal">—</b> mm だけ中心がずれます（向かい合うのは面と面で、そのあいだの隙間がクリアランスです）。刃どうしは円周が食い違うので、これだけ離れていないと円周でぶつかって切れません。バリの向きで切断ごとに左右が入れ替わるため、<b>千鳥では上下のスペーサー長が「刃1枚ぶん広い／狭い」の交互</b>になります。</p>
  <p class="bs-note" id="bsHold2"></p>`;

 const step3Html = () => `
  <h3>元板とロット</h3>
  <p class="bs-lead">元板巾に対する条の割付を確認します。</p>
  <div class="bs-g2">
   <div class="bs-f"><label for="bsW">元板巾 W</label><input type="number" id="bsW" step="0.1"><small>mm</small></div>
   <div class="bs-f"><label for="bsOsTrim">OS耳</label><input type="number" id="bsOsTrim" step="0.05" min="0" disabled><small>mm</small></div>
   <!-- 板の中心（§9.456、利用者の指示「中心位置をずらして設定したい場合がある」）。
        **空欄＝打っていない**（基準値 → 有効長の中央）。出どころは右の一言が言う。
        （この中は文字列リテラルの中なので、逆引用符は書けない） -->
   <div class="bs-f"><label for="bsCenter">板の中心</label><input type="number" id="bsCenter" step="0.1" min="0"><small id="bsCenterUnit">mm</small></div>
   <p class="bs-csrc" id="bsCenterSrc"></p>
  </div>
  <label class="bs-sw"><span>耳を左右均等にする（板を中心位置に通す）</span><input type="checkbox" id="bsTrimEven" checked></label>
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
   <!-- **やり直せる道**（§9.387、利用者の指示「再設計ができる配線」）。
        記録した並びと画面が違うときだけ出す——同じときに出しても押す理由が
        無く、押せて何も起きないボタンになる（§CLAUDE 4）。 -->
   <button type="button" class="bs-btn bs-wide" id="bsDsReset" hidden>記録した並びに戻す</button>
  </div>
  <p class="bs-note" id="bsHint3"></p>`;

 const step4Html = () => `
  <h3>板押さえ（ゴムリング）</h3>
  <p class="bs-lead">ゴムリングで押さえるとき、同じ条の両側は必ず同じリングになります。</p>
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
  syncCarriage();          /* 台車マスタの顔ぶれに合わせる（§9.424） */
  /* 図の向きは**その設備の既定の側**から始める（§9.463・既定は基準原点を右）。 */
  st.flip = flipOf(String((M.P || {}).viewDatumPos || '右'));
  return true;
 }
 /* 基準値から**画面の既定値**を入れ、使う刃を決める。**中身は
    `blade-core.js`の1箇所**（§9.408）——一覧の見込みと同じ答えを通す。
    **利用者が触った値は上書きしない**（§9.361と同じ約束）ので、呼ぶのは
    設備を開き直したときだけ。 */
 function applyStandards() { BS().applyStandards(st, M); }
 function applyBladePick() { BS().applyBladePick(st, M); }

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
  seededBack = (o.back && o.back.mode) ? { mode: String(o.back.mode) } : null;
  seededSkip = Math.max(0, (o.seed && o.seed.skipped) | 0);
  /* その段取りで切る本数と、1本目に切る材料（§9.382）。**予定から来た
     ものだけ**を控える——手で開いたときは空のままにして、記録にも
     「予定から開いていない」と分かる形で残す（§9.231 0で埋めない）。 */
  seededStopId = String(o.stopId || '');
  seededHeadLot = String((o.seed && o.seed.headLot) || '');
  seededHeadSplit = !!(o.seed && o.seed.headSplit);
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
  if (o.seed) {
   /* 記録が勝ったときは取り直さない（§9.387 記録のほうが新しい決定）。 */
   if (!applySeed(o.seed, changed)) await fillFromSource();
   /* **材料が決まってから刃を選ぶ**（§9.408）。刃選択マスタの条件は板厚・
      条数・幅なので、既定のまま選ぶと当たる行が変わる——刃組スケジュール
      一覧の見込み（`standardState()`）と同じ順にそろえる。 */
   applyBladePick();
  } else if (changed) BS().syncOrder(st);
  fillBladePick();
  fillRingSelects();
  paintInputs();
  render();
  /* 画面を出るときに立体図を止めている（`exit`）ので、戻ってきたら選んで
     あった側へ戻す——利用者が選んだ見方を勝手に変えない。 */
  figMode(figKind, figKind === FIG_DEFAULT && !figChosen);
  const miss = missingMasters();
  if (miss) showEmptyMissing(miss);
 }

 /* 戻り先の呼び名（§9.407）。**答えるのは作業スケジュール側**——段の札の字と
    同じ表から引くので、札を直せばこの字も一緒に変わる。読めないときは総称
    （`作業スケジュール`）で書く：嘘の段名を出さない。 */
 function backName() {
  const api = WL.scheduleView;
  const name = (seededBack && api && typeof api.modeName === 'function')
   ? String(api.modeName(seededBack.mode) || '') : '';
  return name || '作業スケジュール';
 }

 /* クリアランスの答えは**`blade-core.js`の1箇所**（§9.378・§9.408）。
    ここは今見ているマスタ（`M`）を渡すだけの薄い口。 */
 const clearanceRate = () => BS().clearanceRate(M);
 const clearanceFor = t => BS().clearanceFor(M, t);
 function syncClearance() {
  if (!st.clrAuto) return false;
  const v = clearanceFor(st.thick);
  if (!v || v === st.clr) return false;
  st.clr = v;
  const el = panel && panel.querySelector('#bsClr');
  if (el) el.value = String(v);
  return true;
 }

 /* 画面が仮に付けた条の名前（`LOT1`・`LOT2`…）。ロット番号ではない。 */
 const LOT_PLACEHOLDER = /^LOT\d*$/;
 /* 予定から持ってきた文脈を当てる。 */
 function applySeed(seed, force) {
  const s = seed || {};
  if (s.thickness > 0) { st.thick = +s.thickness; syncClearance(); }
  if (s.originalWidth > 0) st.W = +s.originalWidth;
  /* **区分はロット番号で言う**（§9.463、利用者の指示「区分のロットの表示は
     『LOT1』ではなくロット番号を表示して」）。予定の写しに条の幅が無いと
     `lots`は空で届き、画面の初期値（`LOT1`）が名前のまま残っていた——
     1本目のコイルの番号（`headLot`）は分かっているので、仮の名前をそれにする。
     手で足した条（`LOT2`…）はそのまま（番号を知らない条に番号を付けない）。 */
  const head = String(s.headLot || '');
  if (Array.isArray(s.lots) && s.lots.length) {
   /* `parent`＝どの親ロットの条か（§9.378）。条の設計は**親ロットで引く**
      ので、ここで落とすと記録先が決められない。分割の無いロットは自分自身。 */
   st.lots = s.lots.map(L => ({ name: String(L.name || head || 'LOT'), w: +L.w || 0,
                                n: Math.max(1, L.n | 0),
                                parent: String(L.parent || L.name || head || '') }))
    .filter(L => L.w > 0);
   if (!st.lots.length) st.lots = [{ name: head || 'LOT1', w: 100, n: 1, parent: head }];
   st.order = [];
  } else if (head) {
   st.lots.forEach(L => { if (LOT_PLACEHOLDER.test(String(L.name || ''))) { L.name = head; L.parent = head; } });
  }
  /* **条の設計が済んでいれば、その並びで開く**（§9.387、利用者の指示
     「条設計済みの場合はそのまま開いて」）。予定の写しから組み直すと、
     現場が決めた並びを**黙って上書き**することになる——記録があるほうが
     新しい決定なので、そちらを正とする。
     引くのは**1本目のコイル（親ロット）1件**（`headLot`）——条の設計は
     親ロットで持つ（§9.378）。 */
  const used = applyDesign(String(s.headLot || ''));
  void force;
  BS().syncOrder(st);
  return used;
 }
 /* **幅と条数は仕掛データから取り直す**（§9.388、利用者の報告
    「分割対象ではないものも…幅何条取りといったデータは持っていますが…
    1条取り確定になってしまっている」）。
    予定の写しは一覧の行から作るので、**列表示マスタに出していない列
    （`BOX設計_横割数`）は最初から入っていない**。測定画面が
    `refreshSelfSourceFull()` でしているのと同じく、完全な生データを取り直す。

    当てないのは2つ:
      ・**条の設計が記録済み**のとき（記録のほうが新しい決定・§9.387）
      ・**1本目が分割あり**のとき（幅を持っているのは子ロット） */
 async function fillFromSource() {
  if (!seededHeadLot || seededHeadSplit) return false;
  const get = WL.split && WL.split.lotRow;
  if (typeof get !== 'function') return false;
  let row = null;
  try { row = await get(seededHeadLot); }
  catch (e) {
   WL.quiet.note('仕掛データを読み直せない（予定の写しの値で進む）', e);
   return false;
  }
  const f = WL.scheduleView.bladeLotsFromSource(row, seededHeadLot);
  if (!f) return false;
  if (f.thickness > 0 && f.thickness !== st.thick) { st.thick = f.thickness; syncClearance(); }
  if (f.originalWidth > 0) st.W = f.originalWidth;
  if (!f.lots.length) return false;
  st.lots = f.lots.map(L => ({ name: String(L.name || 'LOT'), w: +L.w || 0,
                               n: Math.max(1, L.n | 0),
                               parent: String(L.parent || L.name || '') }));
  st.order = [];
  BS().syncOrder(st);
  return true;
 }
 /* 記録してある条の設計を画面へ載せる。**戻り値は載せたかどうか**。
    見つからない・中身が読めないときは何もしない（予定から組んだ並びが残る）。 */
 function applyDesign(parent) {
  if (!parent) return false;
  const hit = ((M && M.designs) || []).find(x => String(x.lot) === parent);
  const gs = hit && Array.isArray(hit.groups) ? hit.groups : null;
  if (!gs || !gs.length) return false;
  const lots = gs.map(g => ({ name: String(g.lot || parent), w: +g.width || 0,
                              n: Math.max(1, g.count | 0), parent }))
   .filter(L => L.w > 0);
  if (!lots.length) return false;
  st.lots = lots;
  st.order = [];
  return true;
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
 /* いま開いている拡大図の記号（§9.413）。**描き直しても開いたまま**にする
    ——設定をいじって寸法がどう動くかを見るための窓なので、触るたびに閉じると
    見比べられない。行が消えたときだけ閉じる。 */
 let zoomBadge = '';
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
  /* **組めない材料では図も表も描かない**（§9.454）。負の耳のまま描くと、
     板だけが横へずれた「組めた顔の図」になる（実測 matOff 523.95）。
     理由と直す場所は刃組表の場所に出す——いちばん先に読む場所なので。 */
  /* 潤滑リングの色（§9.455）。**行に「画面の色」があればそれ**、無ければトークン
     （紫）。器に1回だけ当てるので、表の色見本・模式図・拡大図・断面図が同じ色を読む。 */
  const lhex = BS().ringRule(M).lubeHex;
  if (lhex) panel.style.setProperty('--bs-fig-lube', lhex);
  else panel.style.removeProperty('--bs-fig-lube');
  const stop = res.stop || [];
  panel.classList.toggle('is-stop', stop.length > 0);
  if (stop.length) { renderStop(res); return; }
  drawFigure(res);
  /* 立体図も**同じ割付（res）**から作る（§9.377 追補）。渡すだけで、
     組み直すかどうかは向こうが決める（立体図を出していなければ何もしない）。 */
  if (WL.bladeSolid) {
   WL.bladeSolid.sync({ st, M, res, ringHex: hexOf });
  }
  syncZoneZoom();
  renderTables(res);
  renderEnds(res);
  renderGauges(res);
  renderBom(res);
  renderDiff(res);
  renderSets();
  paintBadgePick();
 }

 /* 組めないときの1枚（§9.454）。**何が・どれだけ・どこで直すか**を言い、
    直す場所の窓を開くボタンを1つだけ置く（§CLAUDE 2 次にすることを1つ）。
    図・端部・所要・台車差分は`.is-stop`で伏せる（前の絵を残さない・§9.433）。 */
 function renderStop(res) {
  const stop = res.stop || [];
  closeZoneZoom();
  if (WL.bladeSolid) WL.bladeSolid.sync({ st, M, res: null, ringHex: hexOf });
  const step = stop[0].step;
  $('#bsTables').innerHTML = '<div class="bs-alert is-bad bs-stop" data-stop="'
   + esc(stop.map(x => x.key).join(' ')) + '"><b>この材料では刃組を組めません</b>'
   + stop.map(x => `<br>${esc(x.text)}。${esc(x.fix)}。`).join('')
   + `<span class="bs-stop-acts"><button type="button" class="bs-btn is-primary"`
   + ` data-stop-open="${esc(step)}">幅構成を開いて直す</button></span></div>`;
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
  /* 出すのは**組んだ値**。打った値と違えば並べ、理由は`title`で言う（§9.454）。 */
  const cu = clrUse(), fc = $('#bsFClr');
  const src = st.clrAuto ? `目安: 板厚の${Math.round(clearanceRate() * 100)}%` : '手入力';
  fc.textContent = cu.rounded
   ? `${clrMmText(cu.used)}（${src} ${clrMmText(cu.want)} を四捨五入）`
   : `${clrMmText(cu.used)}（${src}）`;
  fc.title = clrWhy(cu);
  $('#bsV2').textContent = `Φ${st.knife.toFixed(1)} / t${st.thick.toFixed(1)}`;
  $('#bsV3').textContent = st.lots.length === 1
   ? `${st.lots[0].w}×${st.lots[0].n}` : `${st.lots.length}ロット`;
  /* **「表示」の保持層の札は、いまの方式の名前で出す**（§9.441）。器は1つの
     まま（`data-show="ring"`）で字だけ差し替える——押す物を増やさない
     （§CLAUDE 4 できないことは書く／§9.422 隠し方の札と同じ群）。 */
  /* 断面図の設定の帯（§9.443）。**模式図と同じ`chipBandItems()`**から作る。
     立体図では出さない——あちらは機械の見た目を見る図で、設定の値は主役でない。 */
  const cs = panel.querySelector('.bs-cutset');
  if (cs) {
   cs.innerHTML = chipBandItems(res.finger).map(c =>
    `<span class="bs-cutchip" data-k="${c.k}"><s>${esc(c.name)}</s>`
    + `<b>${esc(c.val)}</b></span>`).join('');
  }
  panel.querySelectorAll('[data-show="ring"]').forEach(b => {
   const nm = BS().holdName(st, M);
   b.textContent = nm;
   b.dataset.showName = nm;
  });
  $('#bsV4').textContent = res.finger ? B.holdName(st, M)
   : `${B.holdName(st, M)} ${colorOf(res.bigOd)}${res.bigOd} / ${colorOf(res.smOd)}${res.smOd}`;
  /* 出すのは**中心間**（説明文がそう言っている）。クリアランスそのものは
     「クリアランス」の欄とチップの帯が持つ（§9.420）。 */
  $('#bsDVal').textContent = (res.A.dKnife || res.A.dReal).toFixed(2);
  $('#bsHold2').innerHTML = `板を保持する方式は<b>${B.holdName(st, M)}</b>です。`
   + (res.finger
    ? `板厚 ${st.thick.toFixed(1)} は ${M.P.fingerMax} 未満のため、板押さえ（フィンガー）で保持します。軸はスペーサーのみで構成します。`
    : `板厚 ${st.thick.toFixed(1)} は ${M.P.fingerMax} 以上のため、ゴムリング主体で構成します。`);
  const from = $('#bsFrom');
  if (from) {
   from.hidden = !seededFrom;
   if (seededFrom) {
    /* **戻る先を名指しする**（§9.407）。「この予定から」だけだと、押したあと
       どの段へ出るのかが分からない（実際に俯瞰へ落ちていた）。段の呼び名は
       作業スケジュール側の1箇所が答える——読めないときは総称で書く。 */
    const to = backName();
    from.innerHTML = `<i aria-hidden="true">←</i>`
     + `<span><s>${esc(to)}へ戻る</s><b>${esc(seededFrom)}</b></span>`;
    from.title = `${to}へ戻ります（${seededFrom}）`;
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
  /* 板の中心の出どころ（§9.456・§CLAUDE 6）。打っていないときは効いている値を
     欄の薄い字（placeholder）で見せる——空欄のままでも何が効いているか読める。 */
  const C = BS().centerOf(st, M);
  /* **中心は基準面から測る**（§9.461、利用者の指示「基準原点を変更したら、中心位置の
     測り方も連動して」）。どちらから測るかは欄の単位の所が言う（推測させない）。 */
  $('#bsCenterUnit').textContent = `mm（${C.datum}から）`;
  $('#bsCenter').placeholder = C.value.toFixed(2);
  $('#bsCenterSrc').textContent = C.from === 'job' ? 'この作業で指定'
   : (C.from === 'master' ? `刃組基準値の ${C.value.toFixed(2)}` : `有効長の中央 ${C.value.toFixed(2)}`);
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
  /* **軸は viewBox の中央に置く**（§9.440、利用者の指摘「模式図全体がやや右に
     よっているような感じです」）。以前は `left:100 / right:990` で、左の余白
     100 に対し右は 10——**軸の中心が中央より 45px 右**に居た（実測）。さらに
     有効幅の青い印は軸の外へ `capW` だけ張り出すので、右端は 1005 まで伸びて
     **viewBox を 5px はみ出して**いた（実測）。
     左右の余白は同じ `60` にする。内訳は左右とも
     「青い印 15 ＋ 見出しとの間 8 ＋ 見出しの字 ~31 ＋ 縁 6」で、
     **左の見出し（上軸・下軸）が縮まない最小の幅**から決めてある
     （これ以上詰めると `rowLabel()` の `room / 字数` が効いて字が小さくなる）。
     中身に使える幅は 890 → 880（−1.1%）。 */
  vw: 1000, left: 60, right: 940,
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

 /* 模式図に描く「物」は**角を落とさない**（§9.415、利用者の指示「2Dのエッジ
    部分の丸角は無しにしてほしい」）。この図は実寸を目で比べるためのものなので、
    角丸は縁を実際より短く見せる——0.05mm刻みのスペーサーが何枚も並ぶ図で、
    1枚ぶんの幅が角丸2つに食われる（実測: 幅 1.2px の部材に rx=2）。
    **角丸を残すのは文字の器だけ**——記号バッジ（`bs-bdgr`）と設定の帯。
    部材・軸・青い印・板／条／耳・刃、そして拡大図の同じものは、すべて直角。 */
 /* 軸に通す部材1個。径をそのまま高さに写すので、太い部材ほど背が高く見える。 */
 function block(V, cx, cy, w, dia, fill, stroke, label) {
  const h = V.hOf(dia);
  let o = `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}"`
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
     字も1段小さくする（読めればよい添え字で、主役は部材の並び）。

     **大きさは条の番号と同じ段（13）まで落とす**（§9.415、利用者の指示
     「やや文字が大きすぎてバランスが悪い表示を見直してほしい」）。ここは
     「どこを見ているか」の目印で、読み取る値（条番号・条幅・耳屑幅）より
     大きいのは**順序が逆**だった（実測 18.4px 対 15.9px）。 */
  const edge = FIG.left - FIG.capW - 8;
  const room = edge - 6;
  const fs = Math.min(V.fs(13), room / Math.max(1, name.length));
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
    + ` width="${sw}" height="${V.hOf(V.shaftD)}"`
    + ` fill="url(#bsSh)" stroke="${V.PAL['shaft-edge']}"/>`
    + `<rect class="bs-cap" x="${sx}" y="${cy - V.hOf(FIG.capD) / 2}" width="${cw}"`
    + ` height="${V.hOf(FIG.capD)}" fill="${V.PAL.cap}"/>`
    + `<rect class="bs-cap" x="${x0 + w}" y="${cy - V.hOf(FIG.capD) / 2}"`
    + ` width="${cw}" height="${V.hOf(FIG.capD)}" fill="${V.PAL.cap}"/>`;
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
 function fillZone(V, xa, xb, cy, parts, floatAt) {
  const d = V.dir, span = Math.abs(xb - xa);
  if (span <= 1) return '';
  const k = parts.len > 0 ? span / V.pw(parts.len) : 1;
  /* フローティングシートがこの区間の**始まりの側**（OS端・§9.461）にあるときは、
     スペーサーを基準面の側（刃の側）へ寄せて積み、残りを始まりの側へ空ける。 */
  const lead = floatAt === 'start' ? V.pw(Math.max(0, parts.rem || 0)) * k * d : 0;
  const fill = partsRun(V, xa + lead, xb, cy, expand(parts.spacer), V.spacerD,
                        V.PAL.spacer, V.PAL['spacer-edge'], null, k);
  let svg = fill.svg;
  /* フローティングシートの側の端の残りは押さえる量（§9.457）——端数の色で塞がない。 */
  if (!floatAt && (xb - fill.end) * d > 0.8) {
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
  /* **潤滑リング**（§9.454）は刃の内側の両端に1本ずつ。ゴムリングはその
     あいだに置く（空きもそのあいだに振り分ける）。径は潤滑リング自身の値。 */
  let o = '', a0 = xa, b0 = xb;
  if (z.lube) {
   const lw = V.pw(z.lube.w) * s, lri = V.hOf(z.lube.bore) / 2, lro = V.hOf(z.lube.od) / 2;
   const lth = Math.max(1, lro - lri), ww = Math.max(1.2, lw - 0.8);
   [xa, xb - d * lw].forEach(at0 => {
    const x = Math.min(at0, at0 + d * lw) + 0.4;
    o += `<rect class="bs-lube" x="${x}" y="${cy - lro}" width="${ww}" height="${lth}"`
       + ` fill="${V.PAL.lube}" stroke="${V.PAL['lube-edge']}"/>`
       + `<rect class="bs-lube" x="${x}" y="${cy + lri}" width="${ww}" height="${lth}"`
       + ` fill="${V.PAL.lube}" stroke="${V.PAL['lube-edge']}"/>`;
   });
   a0 = xa + d * lw; b0 = xb - d * lw;
  }
  const slack = Math.max(0, Math.abs(b0 - a0) - widthPx(V, pieces) * s);
  let at = a0 + d * slack / 2;
  for (const sz of pieces) {
   const w = V.pw(sz) * s;
   if ((at + d * w - b0) * d > 0.6) break;
   const x = Math.min(at, at + d * w) + 0.4, ww = Math.max(1.2, w - 0.8);
   o += `<rect x="${x}" y="${cy - ro}" width="${ww}" height="${th}" fill="${hex}" stroke="${V.PAL.ink}"/>`
      + `<rect x="${x}" y="${cy + ri}" width="${ww}" height="${th}" fill="${hex}" stroke="${V.PAL.ink}"/>`;
   at += d * w;
  }
  /* **落とさない**（§9.378）。大小はラップ構成そのものを表すので、狭い区間でも
     出す——出ないと「小は省略されているのか」を読む側が確かめられない。
     大きさは`V.zoneMin`でそろえ、帯の厚みにも収める。 */
  const cap = Math.min(V.fs(16), th * 0.86);
  /* **径も帯の上で読めるようにする**（§9.433 追補、利用者の指示「ゴムリングの
     色だけでなく、ゴムリング径もガイダンス上でわかるように」）。色は外径その
     ものだが、**色と径の対応は覚えていないと引けない**（§CLAUDE「思い出させ
     ない」）。入るときは`大Φ319`、入らなければ`大`だけ——落とすのは大小では
     なく**添え物の径**のほうで、径は図の上の帯と所要がいつでも言う。 */
  const word = z.hold.ringT === 'big' ? '大' : '小';
  const full = `${word}Φ${od}`;
  const room = V.zoneMin > 0 ? V.zoneMin : Math.abs(xb - xa);
  const fsFull = Math.min(cap, fitFs(V, full, room, 16, 7));
  const label = fsFull > 0 ? full : word;
  const fs = fsFull > 0 ? fsFull
   : Math.max(V.fs(7), Math.min(cap, room > 0 ? (room - 2) / 1.1 : cap));
  o += `<text x="${(xa + xb) / 2}" y="${cy - ri - th / 2 + fs * 0.36}" text-anchor="middle"`
   + ` font-size="${fs.toFixed(1)}" font-weight="800" fill="#fff" stroke="${V.PAL.ink}"`
   + ` stroke-width="${(fs * 0.16).toFixed(2)}" style="paint-order:stroke">`
   + `${esc(label)}</text>`;
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
 /* 図の上での刃の位置。**上下のずれは刃厚＋クリアランス**（§9.419）なので、
    ふつうはそのまま描いても見える（アーバー全長を 800px に写して約5px）。
    それでも足りない縮尺のために、ずれの**向き**はそのままに、見てわかる
    最小限の量（刃厚ぶん）までは広げる。 */
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
  /* フローティングシートの側の端（§9.461）。OS端なら区間の始まり、DS端なら終わりが空く。 */
  const fz = A.floatZ;
  let svg = fillZone(V, V.px(0), at(0) - half, cy, zp.zones[0][side], fz === 0 ? 'start' : '');
  for (let j = 0; j < segs.length; j++) {
   svg += fillZone(V, at(j) + half, at(j + 1) - half, cy, zp.zones[j + 1][side]);
  }
  svg += fillZone(V, at(lastK) + half, V.px(A.arborLen), cy, zp.zones[lastZ][side],
                  fz === lastZ ? 'end' : '');
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
 /* 字の幅（em）。全角は1・半角は0.62で数える。**測るのはここ1箇所**——
    「入るかどうか」を場所ごとに別の係数で見積もると、片方だけ溢れる。 */
 const txtEm = t => [...String(t || '')]
   .reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 1 : 0.62), 0);
 /* 幅`w`の席へ字を入れるときの文字サイズ。入らなければ`0`（呼ぶ側が短い字へ
    落とすか、出すのをやめる）。 */
 function fitFs(V, t, w, max, min) {
  const em = txtEm(t);
  if (em <= 0) return 0;
  const fs = Math.min(V.fs(max), (w - 4) / em);
  return fs >= V.fs(min) ? fs : 0;
 }

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

 /* 記号の色の番号（§9.455）。答えは`blade-core`の`buildRows()`が振った`tone`
    ——ここは名乗らせるだけ。端部の行は持たない（中立の色）。 */
 const bcAttr = r => (r && Number.isInteger(r.tone) ? ` data-bc="${r.tone}"` : '');
 const setBc = (el, r) => {
  if (!el) return;
  if (r && Number.isInteger(r.tone)) el.dataset.bc = String(r.tone); else delete el.dataset.bc;
 };
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
  /* **端の区間（OS端・DS端）も重ねる的**（§9.463）。記号の札は持たない（端は刃組表の
     行ではなく右の端部の表が受ける）ので、区間ぜんたいの面だけ。押しても拡大図は
     開かない（`bs-bhit`ではなく`bs-ehit`）。 */
  const last = A.zones.length - 1, H0 = V.hOf(V.maxD);
  [['up', true, V.upC], ['lo', false, V.loC]].forEach(([side, upper, cy]) => {
   [[0, 'OS'], [last, 'DS']].forEach(([k, sd]) => {
    const [a, b] = zoneX(upper, k);
    o += `<g class="bs-ehit" data-badge="${sd}" data-axis="${side}">`
     + `<rect class="bs-zhit" x="${a.toFixed(1)}" y="${(cy - H0 / 2).toFixed(1)}"`
     + ` width="${Math.max(1, b - a).toFixed(1)}" height="${H0.toFixed(1)}"/></g>`;
   });
  });
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
    /* **的は「どちらの軸か」も名乗る**（§9.442、利用者の指示「上軸は上の図、
       下軸は下の図を選ぶようにしてほしい」）。同じ記号は上下の両方に出るので、
       軸を渡さないと拡大図が`r.zones[0]`＝先に来たほうで開き、
       **下軸を押したのに上軸の図**が出ていた。
       **色は文字ごと**（§9.455。§9.442 の「軸で色を分ける」は撤回）——軸は
       上下の位置が言う。塗りはCSSが`data-bc`から引く（重ねても変えない）。 */
    o += `<g class="bs-bhit" data-badge="${esc(r.badge)}" data-axis="${side}"${bcAttr(r)}>`
     + `<rect class="bs-zhit" x="${a.toFixed(1)}" y="${(cy - H / 2).toFixed(1)}"`
     + ` width="${Math.max(1, b - a).toFixed(1)}" height="${H.toFixed(1)}"/>`
     + `<rect class="bs-bdgr" x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}"`
     + ` rx="${(h * 0.28).toFixed(1)}" stroke="#fff" stroke-width="1.2"/>`
     + `<text x="${cx}" y="${cy + fs * 0.36}" text-anchor="middle" font-size="${fs.toFixed(1)}"`
     + ` font-weight="800" fill="#fff">${r.badge}</text></g>`;
   }
  });
  return o;
 }

 /* ---- 刃が作る寸法（§9.433 追補、利用者の指示） ----
    「今は純粋な板幅しか表示がないので、クリアランス分の計算が入った寸法で
      上下正確に刃の幅を示すラベルも必要かもしれません」

    条幅（材料の行の`259.80`）は**注文の幅**で、刃が実際に作る幅ではない。
    同じ切断でも上下の刃は**刃厚＋クリアランス**だけ軸方向にずれている
    （§9.419）ので、1つの条を挟む寸法は軸ごとに違う:

      内々 … 区間の両端の刃の**内側の面どうし**（＝スペーサーの合計＝区間長）
      外々 … 同じ2枚の**外側の面どうし**（＝内々＋刃厚×2）

    条幅に当たるのは、**どちらか一方の軸の内々と、もう一方の軸の外々**で、
    その2つが条幅をクリアランスの半分ずつ挟む（下バリなら上軸が内々・
    下軸が外々、上バリはその逆）。**どちらがどちらかは図の上で読めること**が
    ここの狙いなので、数だけでなく`広い`／`狭い`の字も添える（§9.466、利用者の指示
    「内とか外とか作業者視点ではわかりづらいので、広いとか狭いとかの表現にして」。
    内々＝製品幅＋クリアランス×2＝広い対、外々＝製品幅そのもの＝狭い対）。

    置き場は**記号の札のすぐ下**（その区間の中）。指し示す物の上に置くので
    引き出し線が要らず、隣の区間とも混ざらない（§9.430）。狭くて入らない
    ぶんは出さない——**区間長は刃組表と拡大図がいつでも言う**（§9.429 と
    同じ逃がし方）。 */
 /* 区間長（＝刃の内々）と条幅から、**条幅を作っているのは内々か外々か**を
    答える（§9.434）。**幅から決める**——バリ方向の規則をここへ写すと、規則を
    直したときに図と表だけが古いことを言う（§CLAUDE 8）。
    答えるのはここ1箇所で、図・刃組表・拡大図が同じ言葉を使う。 */
 function bladeSpan(len, w) {
  const tk = st.tk;
  return (Math.abs(len - w) <= Math.abs(len + 2 * tk - w))
   ? { word: SPAN_WORD.in, v: len } : { word: SPAN_WORD.out, v: len + 2 * tk };
 }
 /* 呼び名の綴りはここ1箇所（見出し・図・拡大図・潤滑リングの説明が同じ語を使う）。 */
 const SPAN_WORD = { in: '広い', out: '狭い' };
 /* 字は「広い／狭い」＋値。**丸めは条幅と同じ2桁**（§9.413 の部材とは別物——
    これは割り付けの計算値なので、在庫の寸法名にはならない）。 */
 const spanText = p => `${p.word} ${(+p.v).toFixed(2)}`;
 function drawZoneSpans(V, A, segs) {
  const half = V.dir * V.kw / 2;
  const pick = bladeSpan;
  /* 大きさは**いちばん長い字といちばん狭い区間**で1つ決める（§9.378 群の中は
     そろえる）。1つでも入らなければ全部出さない——出ている区間と出ていない
     区間が混ざるほうが読み違えのもとになる。 */
  let longest = '';
  segs.forEach((sg, j) => {
   [A.zones[j + 1].up, A.zones[j + 1].lo].forEach(len => {
    const t = spanText(pick(len, sg.w));
    if (txtEm(t) > txtEm(longest)) longest = t;
   });
  });
  const fs = fitFs(V, longest, V.zoneMin, 11, 7);
  if (!fs) return '';
  const bh = fs * 1.5;                       /* 記号の札の高さ（同じ組み立て） */
  let o = '';
  [[true, V.upC, 'up'], [false, V.loC, 'lo']].forEach(([upper, cy, side]) => {
   segs.forEach((sg, j) => {
    const a = kxOf(V.KX, j, upper) + half, b = kxOf(V.KX, j + 1, upper) - half;
    const cx = (a + b) / 2;
    const p = pick(A.zones[j + 1][side], sg.w);
    o += `<text class="bs-zspan" x="${cx.toFixed(1)}"`
     + ` y="${(cy + bh / 2 + fs * 0.95).toFixed(1)}" text-anchor="middle"`
     + ` font-size="${fs.toFixed(1)}" font-weight="700" fill="${V.PAL.label}"`
     + ` stroke="${V.PAL.sheen}" stroke-width="${(fs * 0.22).toFixed(2)}"`
     + ` style="paint-order:stroke" font-variant-numeric="tabular-nums">`
     + `${esc(spanText(p))}</text>`;
   });
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
    + ` height="${h}" fill="${face}" stroke="${edge}" stroke-width="1"/>`;
   if (strip || (trim && (i === 0 || i === last))) {
    /* `up`＝この条の板が中心より上へ寄っているか（§9.378、利用者の指示
       「板がある側に番号バッジを出してください」）。番号は板を指すものなので、
       板と反対側に置くと、どの条の番号なのかを目で辿り直すことになる。 */
    marks.push({ cx, strip, up, text: strip ? String((sg.lotIx | 0) + 1) : '耳',
                 w, fill: edge, cy, top, bot, mm: (strip || trim) ? +sg.w : null,
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
    /* **耳屑の幅も字で出す**（§9.413、利用者の指示「2D表示は耳屑の計算幅の
       表示が欲しい」）。耳屑は `W − Σ条` の**計算値**で、条幅のように利用者が
       入れた値ではない——図の上に出ていないと、「この並びで合っているか」を
       確かめる手がかりだけが耳に無かった。耳屑は狭いので横へは並ばない。
       耳の字の**真下**へ積み、2行ぶんを耳屑の高さの中心にそろえる。
       図の外へはみ出さないよう、数の箱の幅を見て左右の端で止める。 */
    const nfs = Math.max(V.fs(7), efs * 0.78);
    const txt = (m.mm === null ? '' : m.mm.toFixed(2));
    const nw = txt.length * nfs * 0.62;
    const nx = Math.min(FIG.vw - nw / 2 - 4, Math.max(nw / 2 + 4, ex));
    front += `<text class="bs-mk" data-side="edge" x="${ex.toFixed(1)}"`
     + ` y="${(m.cy + efs * 0.36 - (txt ? efs * 0.52 : 0)).toFixed(1)}" text-anchor="middle"`
     + ` font-size="${efs.toFixed(1)}" font-weight="800" fill="${m.fill}">耳</text>`;
    if (txt) {
     front += `<text class="bs-mw" data-side="edge" x="${nx.toFixed(1)}"`
      + ` y="${(m.cy + efs * 0.36 + nfs * 0.92).toFixed(1)}" text-anchor="middle"`
      + ` font-size="${nfs.toFixed(1)}" font-weight="700" fill="${V.PAL.label}"`
      + ` font-variant-numeric="tabular-nums">${txt}</text>`;
    }
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
   + ` width="${w.toFixed(1)}" height="${reach.toFixed(1)}"`
   + ` fill="${V.PAL.knife}" stroke="${V.PAL['knife-edge']}" stroke-width=".6"/>`;
  /* **模式図に破線は引かない**（§9.418、利用者の指摘「2Dは正しく刃が並んで
     いるので破線を引く必要がない」）。この図は刃そのものを上下それぞれの
     位置に描いており（`knifePx()` が見える量まで広げている）、線を足しても
     同じことを2回言うだけになる（§CLAUDE 8）。破線が要るのは**刃を描けない
     断面図の材料の部分**だけ。 */
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
 /* 「大 緑Φ319」の1つぶん。色の名前は`ゴムリングマスタ`が持つ（外径から
    引く・§9.377）。登録の無い径では色名が空になるので、そのときは出さない。 */
 function ringWord(t) {
  const od = BS().odOfType(st, M, t);
  const color = (BS().ringMeta(M, IX, od) || {}).color || '';
  return `${t === 'big' ? '大' : '小'} ${color}Φ${od}`;
 }
 /* 帯に出す3つ（§9.443、利用者の指示「断面図でも板押さえ（フィンガーまたは
    ゴムリングの色や外径）の情報、ラップなど必要な情報を良い感じに表示を」）。
    **顔ぶれと字は、ここ1箇所が答える**——模式図のSVGの帯と、断面図の
    HTMLの帯が同じものを読む（§CLAUDE 8 同じ情報を2箇所に出さない、の逆で
    「同じ情報は1箇所が作る」）。色の鍵（`k`）はパレットの接頭辞。 */
 /* **組んだクリアランス**（§9.454）。打った値は手持ちの刻みへ四捨五入して
    使う——答えは`blade-core`の`clearanceUsed()`の1箇所。字は2桁を下限に、
    刻みが細かい（0.125 等）ときだけ3桁まで出す。 */
 const clrUse = () => BS().clearanceUsed(M, st.tk, st.clr);
 const clrMmText = v => (+v || 0).toFixed(3).replace(/0$/, '');
 /* 丸めたときの出どころ（§CLAUDE 6「推測させない」）。丸めていなければ空。 */
 function clrWhy(c) {
  return c.rounded
   ? `指定 ${clrMmText(c.want)} を、スペーサーの刻み ${c.step} で組める値へ四捨五入しています`
     + '（刃厚＋クリアランスが刻みの倍数でないと、下軸のOS端に端数が残るため）'
   : '';
 }
 function chipBandItems(finger) {
  /* 潤滑リング（§9.454）は**同じ札の中身**として言う——札は3つのまま
     （§9.380）。色は紫で、表と所要の色見本と同じトークン。 */
  const lw = BS().ringRule(M).lubeW;
  const hold = finger ? 'フィンガー'
   : `ゴムリング ${ringWord('big')}／${ringWord('small')}`
     + (lw > 0 ? `＋潤滑 Φ${BS().ringRule(M).lubeOd}` : '');
  const c = clrUse();
  return [
   { k: 'chip-clr', name: 'クリアランス',
     val: `${clrMmText(c.used)}mm${c.rounded ? `（指定${clrMmText(c.want)}）` : ''}`,
     t: `クリアランス：${clrMmText(c.used)}mm${c.rounded ? `（指定${clrMmText(c.want)}）` : ''}` },
   { k: 'chip-ov', name: 'ラップ', val: `${st.ov.toFixed(2)}mm`,
     t: `ラップ：${st.ov.toFixed(2)}mm` },
   { k: 'chip', name: '板押さえ', val: hold, t: `板押さえ：${hold}` }
  ];
 }
 function drawChipBand(V, finger) {
  const textW = t => [...t].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 16 : 9), 0);
  const P = V.PAL;
  /* **3つだけ・短く**（§9.380、利用者の指示「不要な文字は極力カット」）。
     言い添え（目安の割合・手入力・ゴムリング無し・大径小径の値）は**手順バーと
     刃組表がすでに言っている**ので、図の上でもう一度言わない（§CLAUDE 8）。
     図が答えるのは「いまどの設定で組むか」の3点だけ。 */
  /* **色と径の対応をここで言い切る**（§9.433 追補、利用者の指示「ゴムリングの
     色だけでなく、ゴムリング径もガイダンス上でわかるように」）。色は外径その
     ものだが（§9.377）、**どの色が何ミリかは覚えていないと引けない**。帯の上の
     字が狭い区間で落ちても、ここは必ず読める（§CLAUDE 6 出どころを出す）。
     チップは3つのまま——増やさずに中身を具体的にする（§9.380）。 */
  const chips = chipBandItems(finger).map(c => ({
   t: c.t, bg: P[c.k + '-bg'], fg: P[c.k + '-fg'], bd: P[c.k + '-bd'] }));
  const CW = chips.map(c => V.fs(18 + textW(c.t) * FS_CHIP / 16));
  const total = CW.reduce((a, w) => a + w, 0) + (chips.length - 1) * 9;
  /* 帯は図の上端の中央。左右の隅は OS・DS の見出しが使っているので、その分を
     除いた幅に収める。 */
  const side = V.fs(46), room = FIG.vw - side * 2;
  const fit = Math.min(1, room / total);
  let x = side / fit + Math.max(0, (room / fit - total) / 2), band = '';
  chips.forEach((c, i) => {
   const w = CW[i], h = V.fs(25), y = 8;
   /* **角丸を持ってよいのは文字の器だけ**（§9.415）。名前を付けておく——
      「部材はすべて直角」を網が名指しで見られるようにするため。 */
   band += `<rect class="bs-chip-band" x="${x}" y="${y}" width="${w}" height="${h}" rx="9"`
    + ` fill="${c.bg}" stroke="${c.bd}"/>`;
   band += `<text x="${x + 9}" y="${y + h / 2 + V.fs(FS_CHIP * 0.36)}" font-size="${V.fs(FS_CHIP)}"`
    + ` font-weight="700" fill="${c.fg}">${esc(c.t)}</text>`;
   x += w + 9;
  });
  return fit < 1 ? `<g transform="scale(${fit.toFixed(4)})">${band}</g>` : band;
 }
 /* 図の左右がどちら側かの目印。**図の中でいちばん大きい字にしない**（§9.415）
    ——向きは位置（左右の端）と太さで読めるので、大きさは要らない。
    読み取る値（条番号・条幅・耳屑幅）と同じ段（13）へそろえる。 */
 const drawEdgeLabels = V =>
  `<text x="10" y="${V.fs(19)}" font-size="${V.fs(13)}" font-weight="800" fill="${V.PAL.label}">${st.flip ? 'DS' : 'OS'}</text>`
  + `<text x="${FIG.vw - 10}" y="${V.fs(19)}" text-anchor="end" font-size="${V.fs(13)}"`
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
   + drawZoneSpans(V, res.A, res.segs)
   + mat.front + drawEdgeLabels(V) + drawChipBand(V, res.finger);
  svg.setAttribute('viewBox', `0 0 ${FIG.vw} ${V.vh}`);
  svg.innerHTML = `<defs><linearGradient id="bsSh" x1="0" y1="0" x2="0" y2="1">`
   + `<stop offset="0" stop-color="${PAL.sheen}"/><stop offset=".45" stop-color="${PAL.shaft}"/>`
   + `<stop offset="1" stop-color="${PAL['shaft-edge']}"/></linearGradient></defs>${back}${front}`;
 }

 /* ====================== 区間の拡大（§9.413） ======================
    模式図の区間（記号）を押すと、**その区間だけ**を器いっぱいに描き直し、
    出てくる寸法すべてに字を添える。模式図と**同じ描き方**を保つ
    （部材＝軸の寸法・保持層＝その上下・刃＝両端）——別の描き方にすると、
    拡大したものが元のどこなのか読めなくなる。
    字は**部材の中には入れない**。狭い部材（隙間は1mm台）では入らないので、
    入る部材だけ中に書くと「出ている物と出ていない物」が混ざる。等間隔の
    スロットへ引き出し線で降ろし、**名前と値を縦にそろえる**（§CLAUDE 9）。 */
 /* 拡大図の器。**縦は半径**（§9.432）——`rad`が「軸心から外周まで」の px、
    `cap`は外周の外に空ける余白、`dim`は軸心の反対側へ出す区間の寸法線ぶん。
    左の余白（`sideL`）は層の名前（軸・スペーサー・ゴムリング・刃）を置く席。 */
 const ZOOM = { vw: 760, sideL: 78, sideR: 44, rad: 190, cap: 16, dim: 30 };
 /* 部材の寸法は**マスタの値そのまま**を出す。2桁へ丸めると `10.025` が
    `10.03` になり、**在庫に無い別の部材の名前**になってしまう（実測で出た）。
    3桁まで持ち、末尾の0は落として読みやすくする。 */
 const zmm = v => (+v || 0).toFixed(3).replace(/\.?0+$/, '') || '0';
 /* 字の幅の見積り。SVGは描く前に測れないので、**和字＝1em・欧字＝0.58em**で数える
    （部材の中に入るかどうかの判定に使う）。 */
 const zoomTextW = (t, fs) => [...String(t || '')]
  .reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? fs : fs * 0.58), 0);
 /* **縦書きの字**（§9.430、利用者の指示「拡大図はスペースがあるので、ラベルを
    直接表示したいものに貼って」）。拡大図は1区間だけを器いっぱいに使うので、
    **横に入らない部材でも縦になら入る**——実測 S≒2.2px/mm なので、9mm の
    スペーサーでも幅20px あり、帯の高さは110px ある（字は35px）。
    回す中心はその字の置き場そのもの（`rotate(-90 x y)`）。 */
 function zoomVText(x, y, t, fs, fill, halo, weight) {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle"`
   + ` transform="rotate(-90 ${x.toFixed(1)} ${y.toFixed(1)})"`
   + ` font-size="${fs}" font-weight="${weight || 800}" fill="${fill}"`
   + (halo ? ` stroke="${halo}" stroke-width="${(fs * 0.14).toFixed(2)}"`
     + ' style="paint-order:stroke"' : '')
   + ` font-variant-numeric="tabular-nums">${esc(t)}</text>`;
 }
 /* 全体の寸法線（両端に立ち上がり）。 */
 function zoomSpan(a, b, y, text, PAL) {
  return `<path d="M${a.toFixed(1)} ${(y - 6).toFixed(1)}L${a.toFixed(1)} ${(y + 6).toFixed(1)}`
   + `M${a.toFixed(1)} ${y.toFixed(1)}L${b.toFixed(1)} ${y.toFixed(1)}`
   + `M${b.toFixed(1)} ${(y - 6).toFixed(1)}L${b.toFixed(1)} ${(y + 6).toFixed(1)}"`
   + ` fill="none" stroke="${PAL.label}" stroke-width="1.2"/>`
   + `<text x="${((a + b) / 2).toFixed(1)}" y="${(y - 10).toFixed(1)}" text-anchor="middle"`
   + ` font-size="13" font-weight="800" fill="${PAL.ink}"`
   + ` font-variant-numeric="tabular-nums">${esc(text)}</text>`;
 }
 /* 区間1つぶんの拡大図。`null` を返したときは開かない（描けないものは出さない）。

    **縦は「半径」**（§9.432、利用者の指摘「軸がスペーサーみたいな表示になって
    いて軸の位置が無視されているので、比率が圧倒的におかしい。選択した軸の
    上半分か下半分を表示してほしい」）。以前は部材の**直径**ぶんの塊を中心に
    置いて描いていたので、**軸（Φ200）がどこにも描かれず**、スペーサーは
    Φ240 の塊に見えていた——実物は軸に嵌まる**厚さ20mmの輪**である。
    中心線から外へ、実際の半径で描けば比率がそのまま出る:

      刃      100 〜 159.1（刃径の半分）
      ゴムリング 120.5 〜 外径の半分
      スペーサー 100 〜 120
      軸        0 〜 100
      ─── 軸心（中心線）───

    **選んだ軸の側の半分を出す**——上軸の区間なら中心線が下、下軸なら上。
    押した区間と同じ向きに見えるので、どちらの軸の話か迷わない。 */
 /* `axis`＝押した軸（`'up'`／`'lo'`）。**同じ記号は上下の両方に出る**ので、
    渡された軸の区間を選ぶ（§9.442）。その軸に無ければ元どおり先頭へ倒す。 */
 function zoomFigure(res, r, axis) {
  const zs = r.zones || [];
  const want = axis === 'up' ? true : (axis === 'lo' ? false : null);
  const z0 = (want === null ? null : zs.find(z => !!z.upper === want)) || zs[0];
  /* **どの区間から組んだか**を器が名乗る（§9.442）。上下で寸法が同じ材料では
     絵が同じになるので、**絵では取り違えを確かめられない**——網は数で見る。 */
  if (!z0 || !res.zp || !res.zp.zones[z0.i]) return null;
  const P = res.zp.zones[z0.i][z0.upper ? 'up' : 'lo'];
  if (!P || !(P.len > 0)) return null;
  const PAL = figPalette(panel), B = BS();
  const tk = +st.tk || 0;
  /* 端部の区間は刃が片側だけ。反対側は**有効幅の端**なので、刃と間違えない
     よう破線で示す（§CLAUDE 4 できないことは、できると書かない）。 */
  const twoKnife = !r.end;
  const knifeRight = twoKnife || ((r.endSide === 'OS') === !st.flip);
  const knifeLeft = twoKnife || !knifeRight;
  const nK = (knifeLeft ? 1 : 0) + (knifeRight ? 1 : 0);
  const totalMm = P.len + tk * nK;
  if (!(totalMm > 0)) return null;
  const S = (ZOOM.vw - ZOOM.sideL - ZOOM.sideR) / totalMm;
  /* ---- 縦（半径方向）の物差し ---- */
  const ring = P.hold && P.hold.kind === 'ring' ? P.hold : null;
  const finger = P.hold && P.hold.kind === 'finger';
  const shaftR = (+M.P.shaftDia || 200) / 2;
  const spacerR = (+M.P.spacerOD || 240) / 2;
  const knifeR = (+st.knife || 0) / 2;
  const holdIn = ring ? (+M.P.ringBore || 241) / 2 : spacerR;
  const holdOut = ring ? (+ring.od || 0) / 2 : spacerR + 10;
  const maxR = Math.max(knifeR, spacerR, (ring || finger) ? holdOut : 0, 1);
  const k = ZOOM.rad / maxR;
  const up = !!z0.upper;
  const sg = up ? -1 : 1;                     /* 半径が増える向き（画面のy） */
  /* 軸心の位置。下軸のときは**区間の寸法線が上に来る**ので、その字（寸法線の
     10px 上に置く）が器からはみ出さないだけの余白を足す（実測で切れた）。 */
  const cl = up ? ZOOM.cap + ZOOM.rad : ZOOM.cap + ZOOM.dim + 10;
  const Yr = rr => cl + sg * rr * k;
  const band = (r0, r1) => {
   const a = Yr(r0), b = Yr(r1);
   return { y: Math.min(a, b), h: Math.max(1, Math.abs(b - a)) };
  };
  /* 軸の並び。模式図と同じ順（OS側→DS側）で、`flip` のときだけ左右を返す。 */
  const core = B.expand(P.spacer).map(mm => ({ mm, kind: 'spacer', name: 'スペーサー' }));
  if (P.rem > 0.001) core.push({ mm: P.rem, kind: 'gap', name: '隙間' });
  const run = st.flip ? core.slice().reverse() : core.slice();
  const knife = () => ({ mm: tk, kind: 'knife', name: '刃（厚み）' });
  const seq = [];
  if (knifeLeft) seq.push(knife());
  run.forEach(q => seq.push(q));
  if (knifeRight) seq.push(knife());
  const face = { spacer: PAL.spacer, gap: PAL.filler, knife: PAL.knife };
  const edge = { spacer: PAL['spacer-edge'], gap: PAL['filler-edge'], knife: PAL['knife-edge'] };
  const topR = { spacer: spacerR, gap: spacerR, knife: knifeR };
  let x = ZOOM.sideL, body = '', zoneA = null, zoneB = null;
  seq.forEach(q => {
   const w = Math.max(1.2, q.mm * S), bd = band(shaftR, topR[q.kind]);
   q.a = x; q.b = x + w; q.cx = x + w / 2; q.bd = bd;
   body += `<rect x="${x.toFixed(1)}" y="${bd.y.toFixed(1)}" width="${w.toFixed(1)}"`
    + ` height="${bd.h.toFixed(1)}" fill="${face[q.kind]}" stroke="${edge[q.kind]}"`
    + ` stroke-width="1.2"/>`;
   if (q.kind !== 'knife') { if (zoneA === null) zoneA = x; zoneB = x + w; }
   x += w;
  });
  if (zoneA === null) { zoneA = ZOOM.sideL; zoneB = x; }
  /* **軸は1本で通す**（§9.432）。部材はこの上に載るので、先に描く。 */
  const sb = band(0, shaftR);
  body = `<rect x="${ZOOM.sideL.toFixed(1)}" y="${sb.y.toFixed(1)}"`
   + ` width="${(x - ZOOM.sideL).toFixed(1)}" height="${sb.h.toFixed(1)}"`
   + ` fill="${PAL.shaft}" stroke="${PAL['shaft-edge']}" stroke-width="1.2"/>` + body;
  /* 軸心（一点鎖線）。**半断面であることは、この線が言う。** */
  body += `<path class="bs-zc" d="M${(ZOOM.sideL - 24).toFixed(1)} ${cl.toFixed(1)}`
   + `L${(x + 16).toFixed(1)} ${cl.toFixed(1)}" fill="none" stroke="${PAL.label}"`
   + ` stroke-width="1" stroke-dasharray="14 4 3 4"/>`;
  /* 有効幅の端（刃の無い側）。 */
  if (!twoKnife) {
   const ex = knifeLeft ? x : ZOOM.sideL;
   const kb = band(shaftR, knifeR);
   body += `<path d="M${ex.toFixed(1)} ${kb.y.toFixed(1)}L${ex.toFixed(1)}`
    + ` ${(kb.y + kb.h).toFixed(1)}" stroke="${PAL.label}" stroke-width="1.6"`
    + ` stroke-dasharray="5 4" fill="none"/>`
    + `<text x="${ex.toFixed(1)}" y="${(Yr(knifeR) + sg * -6).toFixed(1)}"`
    + ` text-anchor="${knifeLeft ? 'end' : 'start'}" font-size="11" font-weight="700"`
    + ` fill="${PAL.label}">有効幅の端</text>`;
  }
  /* **反対側の軸の刃（破線）は描かない**（§9.458、利用者の指示「拡大図の刃の横の点線は
     消してください」。§9.442 の「破線の刃は残す」は撤回）。クリアランスの値は足元の
     説明が言う。 */
  /* 保持層（ゴムリング／フィンガー）。**スペーサーの外側の輪**なので、
     軸の上下ではなく**半径の続き**に1本だけ置く（§9.432）。 */
  let hold = '';
  const holdList = [];
  if (ring || finger) {
   const hb = band(holdIn, holdOut);
   const hex = ring ? hexOf(ring.od) : PAL.finger;
   const list = (st.flip ? B.expand(P.gom).reverse() : B.expand(P.gom))
    .map(mm => ({ mm, cx: 0 }));
   /* **潤滑リング**（§9.454）は刃の内側の両端。ゴムリングはそのあいだ。 */
   let a0 = zoneA, b0 = zoneB;
   if (P.lube) {
    const lb = band(P.lube.bore / 2, P.lube.od / 2), lw = Math.max(1.2, P.lube.w * S);
    [zoneA, zoneB - lw].forEach(x0 => {
     const q = { mm: P.lube.w, cx: x0 + lw / 2, w: lw, bd: lb, name: '潤滑' };
     hold += `<rect class="bs-lube" x="${x0.toFixed(1)}" y="${lb.y.toFixed(1)}" width="${lw.toFixed(1)}"`
      + ` height="${lb.h.toFixed(1)}" fill="${PAL.lube}" stroke="${PAL['lube-edge']}" stroke-width="1"/>`;
     holdList.push(q);
    });
    a0 = zoneA + lw; b0 = zoneB - lw;
   }
   /* 幅は刻みしかないので区間にぴったり合うとはかぎらない。余りを片側へ
      寄せるとクリアランスのように見えるので、模式図と同じく中央へ置く。 */
   const wsum = list.reduce((a, q) => a + Math.max(1.2, q.mm * S), 0);
   let at = a0 + Math.max(0, (b0 - a0 - wsum) / 2);
   list.forEach(q => {
    const w = Math.max(1.2, q.mm * S);
    q.cx = at + w / 2; q.w = w; q.bd = hb;
    hold += `<rect x="${at.toFixed(1)}" y="${hb.y.toFixed(1)}" width="${w.toFixed(1)}"`
     + ` height="${hb.h.toFixed(1)}" fill="${hex}" stroke="${PAL.ink}" stroke-width="1"/>`;
    at += w;
    holdList.push(q);
   });
  }
  /* ---- 層の名前は**左の余白に1回ずつ**（§9.432・§CLAUDE 8）----
     部材1枚ずつに「スペーサー」と書くと、同じ字が10個並ぶ。層の名前は
     縦位置が言えるので、左の縁へ1回だけ置く。 */
  const layers = [['軸', 0, shaftR], ['スペーサー', shaftR, spacerR]];
  if (ring) layers.push(['ゴムリング', holdIn, holdOut]);
  else if (finger) layers.push(['フィンガー', holdIn, holdOut]);
  let caps = '';
  const cap = (x, y, nm, at) => `<text x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}"`
   + ` text-anchor="${at}" font-size="10" font-weight="700" fill="${PAL.label}">${esc(nm)}</text>`;
  layers.forEach(([nm, r0, r1]) => {
   caps += cap(ZOOM.sideL - 8, (Yr(r0) + Yr(r1)) / 2, nm, 'end');
  });
  caps += cap(ZOOM.sideL - 8, cl, '軸心', 'end');
  /* **刃は右の余白へ**。刃の張り出し（軸の外〜刃先）は保持層と半径が重なるので、
     同じ側に置くと字がぶつかる（実際にぶつかった）。 */
  caps += cap(x + 8, (Yr(spacerR) + Yr(knifeR)) / 2, '刃', 'start');
  /* ---- 寸法の字 ----
     **入るものはその部材の中へ**（§9.430。横→縦の順）。入らないものは
     **軸の帯の中へ**引き出す（§9.429 の断面図と同じ作法・段は`x`順に振り分け、
     段の中は`spread()`で押し広げる）——軸は半径100mmぶんの高さがあり、
     この図でいちばん広く空いている場所である。 */
  const VFS = 13, NFS = 10;
  const items = [];
  seq.forEach(q => {
   /* `plain`＝層の名前（左の余白）で言えている部材。**引き出すときは値だけ**
      書く（§CLAUDE 8 同じ情報を2箇所に出さない）——「スペーサー」が段に何度も
      並ぶより、値が読めるほうが要る。隙間と上下刃の中心間はそうではないので、
      名前も添える（どちらも部材ではない）。 */
   items.push({ cx: q.cx, name: q.name, val: zmm(q.mm), w: q.b - q.a, bd: q.bd, layer: 'core',
                plain: q.kind === 'spacer' || q.kind === 'knife',
                ink: q.kind === 'knife' ? '#fff' : PAL.ink, halo: q.kind === 'knife' });
   /* **「上下刃の中心間」は拡大図には出さない**（§9.442、利用者の指示
      「上下刃の中心線は、拡大図に不要です。表示が重ならないように注意して」）。
      貼る相手が無いので必ず引き出すことになり、**席を1つ余計に食って**
      他の寸法を押し出していた。値は刃組図の見出し（`#bsDVal`）が持つ。
      反対側の軸の刃（破線）も§9.458で描かなくなった。 */
  });
  holdList.forEach(q => {
   /* 保持層（ゴムリング／フィンガー）は層の名前が左の余白にあるので値だけ。
      潤滑リングは名前（「潤滑」）を添える——左の余白は「ゴムリング」としか言わない。 */
   items.push({ cx: q.cx, name: q.name || '', val: zmm(q.mm), w: q.w, bd: q.bd, layer: 'hold',
                plain: !q.name, ink: '#fff', halo: true });
  });
  /* **中へ貼るのを先に試す**（§9.458、利用者の指示「フィンガーやゴムリングもその材料の
     中に数値ラベル貼れるとおもうので、極力貼って無理やり軸にラベル貼らず」）。
     13px で入らなければ**読める下限（9px）まで小さくして**中へ貼る——フィンガーの帯は
     高さ約12pxで、13px 固定では1枚も入らず、全部が軸へ引き出されていた。 */
  const ZFS_MIN = 9;
  const inside = [], vert = [], outs = [];
  items.forEach(q => {
   const wv = zoomTextW(q.val, VFS), wn = zoomTextW(q.name, NFS);
   const h = q.bd ? q.bd.h : 0;
   if (q.w >= Math.max(wv, wn) + 8 && h >= VFS + (q.name ? NFS + 6 : 4)) {
    inside.push(q); return;
   }
   if (q.w >= wv + 8 && h >= VFS + 3) { q.valOnly = true; inside.push(q); return; }
   if (q.w >= VFS + 3 && h >= wv + 8) {
    q.vName = q.name && q.w >= VFS + NFS + 6 && h >= wn + 8;
    vert.push(q);
    return;
   }
   /* 縦にも入らなければ**字を小さくして**横に貼る（縦の13pxを先に試す——縦なら入る
      部材の字まで小さくしない）。 */
   for (let fs = VFS - 1; fs >= ZFS_MIN; fs--) {
    if (q.w >= zoomTextW(q.val, fs) + 4 && h >= fs + 1) { q.valOnly = true; q.fs = fs; inside.push(q); return; }
   }
   outs.push(q);
  });
  let marks = '';
  inside.forEach(q => {
   const mid = q.bd.y + q.bd.h / 2;
   const halo = q.halo
    ? ` stroke="${PAL.ink}" stroke-width="${(VFS * 0.14).toFixed(2)}" style="paint-order:stroke"` : '';
   const one = q.valOnly || !q.name;
   const fs = q.fs || VFS;
   marks += `<text x="${q.cx.toFixed(1)}" y="${(one ? mid + fs * 0.36 : mid - 1).toFixed(1)}"`
    + ` text-anchor="middle" font-size="${fs}" font-weight="800" fill="${q.ink}"`
    + ` font-variant-numeric="tabular-nums"${halo}>${esc(q.val)}</text>`;
   if (!one) {
    marks += `<text x="${q.cx.toFixed(1)}" y="${(mid + NFS + 3).toFixed(1)}"`
     + ` text-anchor="middle" font-size="${NFS}" font-weight="600" fill="${q.ink}"${halo}>`
     + `${esc(q.name)}</text>`;
   }
  });
  vert.forEach(q => {
   const mid = q.bd.y + q.bd.h / 2;
   const halo = q.halo ? PAL.ink : '';
   const vx = q.vName ? q.cx + NFS / 2 + 1 : q.cx;
   marks += zoomVText(vx, mid, q.val, VFS, q.ink, halo, 800);
   if (q.vName) marks += zoomVText(q.cx - VFS / 2 - 1, mid, q.name, NFS, q.ink, halo, 600);
  });
  /* **引き出す先は層で分ける**（§9.458、利用者の指示「軸に近いスペーサーで書ききれない
     場合は軸に、ゴムリングやフィンガーで書ききれない場合は軸と反対の外側に」）。
     スペーサー（と刃）は軸の帯の中の段へ、保持層は部材のいちばん外より**さらに外**の段へ。
     どちらも作法は同じ（段は`x`順に振り分け・段ごとの色・線は字のきわから対象の中心へ・
     終端に点）。外の段は図の器の外へはみ出すので、あとで器を広げる（`grow`）。 */
  const rowH = VFS + NFS + 5;
  const coreOuts = outs.filter(q => q.layer !== 'hold'), holdOuts = outs.filter(q => q.layer === 'hold');
  const shaftRows = Math.max(1, Math.min(3, Math.floor((sb.h - 6) / rowH)));
  const outerR = Yr(maxR);
  let lead = 0, off = 0, ln = '', minY = Infinity, maxY = -Infinity;
  /* `where`＝'shaft'（軸心のそばから軸の中へ）／'outer'（部材の外から外へ）。 */
  const placeRows = (list, maxRows, where) => {
   list.sort((a, b) => a.cx - b.cx);
   /* 外の段は**1段に入るなら1段**（白地の上なので、段を振る理由は「横に入らない」だけ）。 */
   const need = list.reduce((a, q) => a + Math.max(zoomTextW(q.val, VFS),
                                                   q.plain ? 0 : zoomTextW(q.name, NFS)) + 10, 0);
   const rows = where === 'outer' && need <= ZOOM.vw - ZOOM.sideL ? 1 : maxRows;
   list.forEach((q, i) => { q.tier = i % rows; });
   for (let t = 0; t < rows; t++) {
    const row = list.filter(q => q.tier === t);
    if (!row.length) continue;
    const half = row.map(q => Math.max(zoomTextW(q.val, VFS),
                                       q.plain ? 0 : zoomTextW(q.name, NFS)) / 2 + 3);
    const xs = B.spread(row.map(q => q.cx), half, ZOOM.sideL, ZOOM.vw - 4, 4);
    /* **段ごとに色を変える**（§9.437）。線と字を同じ色にして「同じ色＝同じ組」を辿れる。 */
    /* 外の段は白地の上——軸の地に合わせた淡い段の色では線が消えるので、濃い字＋白の縁取り。 */
    const tint = where === 'outer' ? PAL.ink : (PAL['lead' + (t % 3)] || PAL['lead0'] || '#fff');
    const rim = where === 'outer' ? '#fff' : PAL.ink;
    row.forEach((q, i) => {
     if (xs[i] - half[i] < 0 || xs[i] + half[i] > ZOOM.vw) { off++; return; }
     /* 字の塊の高さ（値だけ／値＋名前）。**線は字の縁から出す**（§9.437）。 */
     const blk = VFS + (q.plain ? 0 : NFS + 2);
     const oRow = blk + 6;
     /* 段の上端。軸の段は軸心のそばから軸の中へ、外の段は部材の外から外へ積む。 */
     const top = where === 'shaft'
      ? (sg < 0 ? cl - 6 - (t + 1) * rowH : cl + 6 + t * rowH)
      : (sg < 0 ? outerR - 8 - (t + 1) * oRow : outerR + 8 + t * oRow);
     /* 線が出る縁: 対象のある側の縁（軸の段は外向き、外の段は軸向き）。 */
     const toward = where === 'shaft' ? sg : -sg;
     const near = toward < 0 ? top - 1 : top + blk + 2;
     /* **行き先は対象の中心**（§9.437）。終端に点を打つ。 */
     const hitY = q.bd ? q.bd.y + q.bd.h / 2 : cl;
     ln += `<path class="bs-zl" data-zl="${where}" data-layer="${q.layer}" fill="none" stroke="${tint}" stroke-width="1.3" opacity=".95"`
      + ` stroke-linejoin="round" stroke-linecap="round"`
      + ` d="M${xs[i].toFixed(1)} ${near.toFixed(1)}`
      + `L${xs[i].toFixed(1)} ${(near + toward * 5).toFixed(1)}`
      + `L${q.cx.toFixed(1)} ${hitY.toFixed(1)}"/>`
      + `<circle class="bs-zl-dot" cx="${q.cx.toFixed(1)}" cy="${hitY.toFixed(1)}" r="2.2"`
      + ` fill="${tint}" stroke="${rim}" stroke-width=".7"/>`;
     /* 字は明るい色＋濃い縁取り（§9.432。軸の地でも白地でも読める）。 */
     const hl = ` stroke="${rim}" stroke-width="${(VFS * 0.14).toFixed(2)}"`
      + ' style="paint-order:stroke"';
     marks += `<text x="${xs[i].toFixed(1)}" y="${(top + VFS).toFixed(1)}"`
      + ` text-anchor="middle" font-size="${VFS}" font-weight="800" fill="${tint}"`
      + ` font-variant-numeric="tabular-nums"${hl}>${esc(q.val)}</text>`
      + (q.plain ? '' : `<text x="${xs[i].toFixed(1)}" y="${(top + VFS + NFS + 2).toFixed(1)}"`
        + ` text-anchor="middle" font-size="${NFS}" font-weight="600" fill="${tint}"${hl}>`
        + `${esc(q.name)}</text>`);
     minY = Math.min(minY, top - 2); maxY = Math.max(maxY, top + blk + 4);
     lead++;
    });
   }
  };
  placeRows(coreOuts, shaftRows, 'shaft');
  placeRows(holdOuts, 2, 'outer');
  /* 区間の寸法線は**軸心の反対側**（半断面の外）。図と重ならない。 */
  const spanY = cl - sg * ZOOM.dim;
  const spans = zoomSpan(zoneA, zoneB, spanY, `区間 ${P.len.toFixed(2)} mm`, PAL);
  let vh = up ? spanY + 16 : cl + ZOOM.rad + 16;
  /* 外の段が器からはみ出すぶん、器を広げる（上へはみ出すなら全体を下げる）。 */
  let grow = 0;
  if (Number.isFinite(minY) && minY < 2) { grow = 2 - minY; vh += grow; }
  if (Number.isFinite(maxY) && maxY + grow > vh - 2) vh = maxY + grow + 4;
  /* **引き出した「部材」のいちばん広い幅**（§9.430）。ラベルは対象へ直に貼る
     ので、引き出しに落ちてよいのは「貼る相手が無いもの」（上下刃の中心間）と
     「字が入らないほど細い部材」だけ。ここが字の高さを超えたら、**貼れるはずの
     物を引き出している**。 */
  const leadWmax = outs.filter(q => q.w > 0).reduce((m, q) => Math.max(m, q.w), 0);
  return {
   vh, dims: items.length, inside: inside.length + vert.length, lead, off, leadWmax,
   axis: z0.upper ? 'up' : 'lo', zone: z0.i,
   svg: grow ? `<g transform="translate(0 ${grow.toFixed(1)})">${body}${hold}${caps}${ln}${marks}${spans}</g>`
    : `${body}${hold}${caps}${ln}${marks}${spans}`,
   /* 図が言えないことだけを添える（§CLAUDE 8 同じ情報を2箇所に出さない）。 */
   note: zoomNote(res, r, P, ring, finger)
  };
 }
 /* 図の外で言うこと。**図に出ている寸法は繰り返さない**——繰り返すと、
    読む側は「違うものかもしれない」と数え直すことになる（§CLAUDE 8）。 */
 function zoomNote(res, r, P, ring, finger) {
  const up = (r.zones || []).filter(z => z.upper).map(z => z.i);
  const lo = (r.zones || []).filter(z => !z.upper).map(z => z.i);
  const where = [];
  if (up.length) where.push(`上軸 ${up.join('・')}`);
  if (lo.length) where.push(`下軸 ${lo.join('・')}`);
  const bits = [`この組み方が入る区間：${where.join(' ／ ') || 'なし'}`];
  bits.push(`刃 Φ${(+st.knife).toFixed(1)}`);
  /* この区間の刃どうしの寸法（§9.434）。条幅は注文の幅、こちらは**刃が実際に
     作る寸法**——同じ数字に見えて別物なので、両方を並べて言う。 */
  if (r && r.sg && !r.end) {
   bits.push(`刃の間隔 ${spanText(bladeSpan(r.c.len, r.sg.w))}`
     + `（条幅 ${(+r.sg.w).toFixed(2)}）`);
  }
  /* 破線は反対側の軸の刃。**中心間は刃厚＋クリアランス**あるので、この縮尺でも
     そのまま描ける（§9.420。以前はクリアランスだけのずれで1px未満だった）。
     クリアランスは2枚の刃の**面と面のあいだ**に見えている。 */
  bits.push(`クリアランス ${clrMmText(clrUse().used)}（反対側の軸の刃との面と面のあいだ）`);
  if (ring) {
   bits.push(`ゴムリング ${ring.ringT === 'big' ? '大' : '小'} Φ${ring.od}`
     + `（内径 Φ${+M.P.ringBore || 241}）`);
  }
  if (P.lube) bits.push(`潤滑リング 幅${P.lube.w}×2（刃の内側の両端・Φ${P.lube.od}/Φ${P.lube.bore}）`);
  if (ring && P.gom.out.length) bits.push(`ゴムリングの空き ${P.holdRem.toFixed(2)}mm`);
  if (finger) bits.push(`フィンガー（板押さえ）は板の側へ入るので、ここでは軸の上下に置いています`);
  if (P.rem > 0.001) bits.push(`スペーサーの端数 ${P.rem.toFixed(3)}mm（0 が正）`);
  return bits.join('　/　');
 }
 /* 拡大図の窓は**掴んで動かせる**（§9.437、利用者の指示「拡大図のポップオーバー
    モーダルは表示位置調整できるようにしてください」）。押した区間の真下へ出すのは
    変えない（どこを開いたのかを目で辿れる）——そのうえで、隠れてしまった物を
    見たいときに利用者が自分でどかせるようにする。
    掴むのは**見出しの帯だけ**（図そのものを掴めると、図の中の的を押す道をふさぐ）。
    はみ出す側は器の縁で止める（画面の外へ持って行かれると戻せない）。 */
 function bindZoomDrag(box) {
  const hd = box.querySelector('.bs-zoom-hd');
  if (!hd || hd.dataset.drag === '1') return;
  hd.dataset.drag = '1';
  let st = null;
  hd.addEventListener('pointerdown', e => {
   if (e.button !== 0 || e.target.closest('button')) return;
   const main = box.parentNode.getBoundingClientRect();
   const r = box.getBoundingClientRect();
   st = { dx: e.clientX - r.left, dy: e.clientY - r.top, main, w: r.width, h: r.height };
   box.classList.add('is-dragging');
   /* `setPointerCapture`は掴めないと投げる（§9.413）。掴めなくても動かすこと
      自体はできるので、理由を1行残して続ける（黙って捨てない・§9.328）。 */
   try { hd.setPointerCapture(e.pointerId); } catch (err) {
    WL.quiet.note('拡大図の窓を掴めない（動かすこと自体はできる）', err);
   }
   e.preventDefault();
  });
  hd.addEventListener('pointermove', e => {
   if (!st) return;
   const x = Math.min(Math.max(0, st.main.width - st.w),
                      Math.max(0, e.clientX - st.main.left - st.dx));
   const y = Math.min(Math.max(0, st.main.height - st.h),
                      Math.max(0, e.clientY - st.main.top - st.dy));
   box.style.setProperty('--bs-zoom-x', x.toFixed(1) + 'px');
   box.style.setProperty('--bs-zoom-y', y.toFixed(1) + 'px');
  });
  const end = () => { if (!st) return; st = null; box.classList.remove('is-dragging'); };
  hd.addEventListener('pointerup', end);
  hd.addEventListener('pointercancel', end);
 }
 /* 開く・閉じる。**器は1枚**（開き直しは中身の差し替えだけ）。 */
 function closeZoneZoom() {
  zoomBadge = '';
  zoomAxis = '';          // 次に開くときは押した軸から決め直す（§9.442）
  const box = $('#bsZoom');
  if (box && !box.hidden) {
   box.hidden = true;
   box.style.removeProperty('--bs-zoom-x');
   box.style.removeProperty('--bs-zoom-y');
  }
 }
 /* いま開いている拡大図の軸（§9.442）。描き直し（`syncZoneZoom`）でも
    **同じ軸のまま**開き直す——軸が飛ぶと、見ていたのと違う図が出る。 */
 let zoomAxis = '';
 function openZoneZoom(badge, hit, axis) {
  const box = $('#bsZoom');
  if (!box || !LAST) return;
  const r = (LAST.rows || []).concat(LAST.ends || [])
   .find(q => String(q.badge) === String(badge));
  if (!r) { closeZoneZoom(); return; }
  const ax = axis || (hit && hit.dataset ? hit.dataset.axis : '') || zoomAxis;
  const fig = zoomFigure(LAST, r, ax);
  if (!fig) { closeZoneZoom(); return; }
  zoomBadge = String(badge);
  zoomAxis = ax || '';
  $('#bsZoomBadge').textContent = r.badge;
  setBc($('#bsZoomBadge'), r);
  $('#bsZoomTitle').textContent = r.end
   ? `${r.name}の組み合わせ`
   : `ロット ${r.sg.lot}／条幅 ${(+r.sg.w).toFixed(2)} mm`;
  $('#bsZoomSub').textContent = r.end
   ? '最外刃より外の区間です'
   : `バリ ${r.sg.burr === 'down' ? '下' : '上'}／同じ組み方の区間 ${r.n} か所`;
  const svg = $('#bsZoomFig');
  svg.setAttribute('viewBox', `0 0 ${ZOOM.vw} ${fig.vh}`);
  /* 出すべき寸法の数と、その内訳（中に書いた／引き出した）。網が足し算を見る。 */
  svg.dataset.dims = String(fig.dims);
  svg.dataset.inside = String(fig.inside);
  svg.dataset.lead = String(fig.lead);
  svg.dataset.leadw = String(Math.round(fig.leadWmax || 0));
  /* **出しきれなかった数**（§9.432）。0でないときだけ足元の一言が言う。 */
  svg.dataset.off = String(fig.off || 0);
  svg.dataset.axis = String(fig.axis || '');
  svg.dataset.zone = String(fig.zone);
  svg.innerHTML = fig.svg;
  $('#bsZoomNote').textContent = fig.note;
  box.hidden = false;
  bindZoomDrag(box);
  /* 押した区間の**真下**へ置く（どこを開いたのかを目で辿らせない）。
     器からはみ出す側は端で止める。描き直しのときは `hit` が無いので、
     **いまの位置のまま**中身だけ差し替える（窓が飛ぶと探し直しになる）。 */
  if (!hit) return;
  const main = box.parentNode.getBoundingClientRect();
  const at = hit.getBoundingClientRect();
  const w = box.offsetWidth || 560, h = box.offsetHeight || 340;
  const x = Math.min(Math.max(0, main.width - w),
                     Math.max(0, at.left + at.width / 2 - main.left - w / 2));
  /* 縦は**押した軸の反対側の半分**へ置く。押した区間を窓が覆うと、
     「どこを開いたのか」を確かめられない（実際に上軸を覆った）。
     上か下かの2択に固定して、いつも同じ場所に出るようにする。 */
  const mid = at.top + at.height / 2 - main.top;
  const y = mid < main.height / 2 ? Math.max(6, main.height - h - 6) : 6;
  box.style.setProperty('--bs-zoom-x', x.toFixed(1) + 'px');
  box.style.setProperty('--bs-zoom-y', y.toFixed(1) + 'px');
 }
 /* 描き直したあとの追従。開いていなければ何もしない。 */
 const syncZoneZoom = () => { if (zoomBadge) openZoneZoom(zoomBadge, null, zoomAxis); };
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
 /* 組んでみて初めて分かる断り（§9.441）。マスタの在庫を見る `renderSets()` とは
    別に、**この割付でどこが埋まらなかったか**を刃組表のすぐ上へ出す
    ——表の列だけだと、30区間のどこが悪いのかを数えることになる（§CLAUDE 2）。 */
 function fitAlertHtml(res) {
  const f = (res && res.fit) || {};
  const gap = f.spacerGap || [], bare = f.bareHold || [];
  const cut = (a, n) => a.slice(0, n).join('・') + (a.length > n ? ` ほか${a.length - n}面` : '');
  let o = '';
  if (gap.length) {
   o += `<div class="bs-alert is-bad"><b>スペーサーで埋め切れていない区間が ${gap.length}面あります</b><br>`
     + `組んだものは${esc(f.floatSeat ? f.floatSeat.datum : '基準面')}側へ押し付けて組むので、ここは 0 でなければなりません（計算の不具合です）。<br>`
     + `${esc(cut(gap, 8))}</div>`;
  }
  /* フローティングシートの側の端の残りが押さえ代を超える（§9.457）——吸えない＝隙間。 */
  const fo = (f.floatSeat && f.floatSeat.over) || [];
  if (fo.length) {
   o += `<div class="bs-alert is-bad"><b>${esc(f.floatSeat.side)}端の残りがフローティングシートの押さえ代 ${f.floatSeat.stroke}mm を超えます（${fo.length}面）</b><br>`
     + 'このままでは隙間が残ります。手持ちのスペーサーでは押さえ代に収まる積みが作れませんでした'
     + '（在庫が尽きたか、合う寸法がありません）。不足は「所要」に出ています。<br>'
     + `${esc(cut(fo, 4))}</div>`;
  }
  /* 潤滑リングの行が無い（§9.455）。**入れられないことを言い、足す場所を言う**。 */
  if (f.lubeMissing) {
   o += '<div class="bs-alert is-warn"><b>潤滑リングを入れられません</b><br>'
     + 'ゴムリングマスタに、種類が「潤滑リング」の行がありません。'
     + '「マスタ管理 &gt; 刃組 &gt; ゴムリング」で、種類を「潤滑リング」にした行（幅・外径・内径・本数）を足してください。</div>';
  }
  /* 板押さえの空きが帯を外れた面（ゴムリング・フィンガーとも・§9.462）。 */
  const rg = f.holdGap || [];
  if (rg.length) {
   const kind = res.finger ? 'finger' : 'ring', b = BS().holdBand(M, kind);
   const nm = res.finger ? 'フィンガー' : 'ゴムリング';
   o += `<div class="bs-alert is-warn"><b>${nm}の空きが ${b.gapMin}〜${b.gapMax}mm に収まらない区間が ${rg.length}面あります</b><br>`
     + '手持ちの幅では、刃のあいだより少し小さく詰め切れませんでした。'
     + `幅の違う${nm}を足すか、「刃組基準値」の「板押さえの空き」を確かめてください。<br>`
     + `${esc(cut(rg, 8))}</div>`;
  }
  if (bare.length) {
   o += `<div class="bs-alert is-bad"><b>${esc(f.holdName || '板押さえ')}が1本も載らない区間が ${bare.length}面あります</b><br>`
     + `手持ちの幅では埋められませんでした（在庫が尽きたか、その区間に入る幅がありません）。`
     + `不足は「所要」に出ています。<br>${esc(cut(bare, 10))}</div>`;
  }
  return o;
 }
 function renderTables(res) {
  const rows = res.rows, keys = K();
  const Ss = [...new Set(rows.flatMap(r => keys(r.c.sp)))].sort((a, b) => b - a);
  const Gs = [...new Set(rows.flatMap(r => keys(r.c.G)))].sort((a, b) => b - a);
  /* **余りは2つに分ける**（§9.441、利用者の指示）。
       スペーサーの端数 … **0が正**。0でないのは計算の不具合なので、
                          出たときだけ列を立てて赤く出す。
       板押さえの空き   … 手持ちの幅で埋め切れないぶん。わずかなら差し支えない
                          ——**1本も載らない区間**だけは字で名指しする。 */
  const hasRem = rows.some(r => r.c.rem > 0.001);
  const hasHold = rows.some(r => r.c.kind);
  const holdLabel = res.finger ? 'フィンガー' : 'ゴムリング';
  /* 潤滑リング（§9.454）。広い側の区間にだけ両端1本ずつ入る。列は入る区間が
     1つでもあるときだけ立てる。空きの帯はゴムリング方式のときだけ判定する。 */
  const hasLube = rows.some(r => r.c.lube > 0);
  /* 空きの帯は**いまの方式の板押さえ**のもの（§9.462。フィンガーにも帯がある）。 */
  const R = { ...BS().ringRule(M), ...BS().holdBand(M, res.finger ? 'finger' : 'ring') };
  const ringBand = R.gapMax > 0;
  const holdCell = r => {
   if (!r.c.kind) return '<span class="bs-z">·</span>';
   if (r.c.bare) return `<b>${r.c.len.toFixed(2)}</b>（1本も載りません）`;
   return r.c.holdRem > 0.001 ? r.c.holdRem.toFixed(2) : '·';
  };
  const holdCls = r => (r.c.bare ? ' is-bad'
   : (ringBand
      ? (r.c.holdRem < R.gapMin - 1e-6 || r.c.holdRem > R.gapMax + 1e-6 ? ' is-warn' : ' is-zero') : ''));
  const num = v => (v ? `<b>${v}</b>` : '<span class="bs-z">·</span>');
  const head = `<thead>
    <tr>
     <th class="bs-grp" rowspan="2">区分<small>ロット・条幅</small></th>
     <th class="bs-bd" rowspan="2">記号</th>
     <th class="bs-it bs-sep" colspan="2">取付位置<small>バリ／OS側から何番目の区間か／区間数</small></th>
     <!-- **刃が作る寸法は表にも置く**（§9.434、利用者の指示「クリアランス分の
          計算が入った寸法で上下正確に刃の幅を示すラベル」）。図の上の字は
          狭い区間では入らないので、**必ず読める場所**をここに持つ。 -->
     <th class="bs-sep" rowspan="2">刃の間隔<small>${SPAN_WORD.in}＝製品幅＋クリアランス×2／${SPAN_WORD.out}＝製品幅</small></th>
     ${Ss.length ? `<th colspan="${Ss.length}" class="bs-sep">スペーサー</th>` : ''}
     ${Gs.length ? `<th colspan="${Gs.length + (res.finger ? 0 : 1)}" class="bs-sep">${holdLabel}</th>` : ''}
     ${hasLube ? `<th rowspan="2" class="bs-sep bs-lubeh" title="刃を潤滑するリングです。${SPAN_WORD.in}側の刃の内側に両側1本ずつ入ります">潤滑リング<small>幅${R.lubeW}・Φ${R.lubeOd}/${R.lubeBore}</small></th>` : ''}
     ${hasHold ? `<th rowspan="2" class="bs-sep">板押さえの空き<small>${ringBand ? `刃のあいだ−${esc(holdLabel)}／${R.gapMin}〜${R.gapMax} が正` : `${esc(holdLabel)}で埋め切れない幅`}</small></th>` : ''}
     ${hasRem ? '<th rowspan="2" class="bs-sep bs-bad">スペーサーの端数<small>0 が正（出たら不具合）</small></th>' : ''}
    </tr>
    <tr><th class="bs-ax bs-sep">上軸</th><th class="bs-ax">下軸</th>
     ${Ss.map((x, i) => `<th class="bs-sz${i ? '' : ' bs-sep'}">${x}</th>`).join('')}
     ${Gs.length && !res.finger ? '<th class="bs-sz bs-sep">径・色・外径</th>' : ''}
     ${Gs.map((x, i) => `<th class="bs-sz${i || !res.finger ? '' : ' bs-sep'}">${x}</th>`).join('')}</tr>
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
   return `<tr data-badge="${esc(r.badge)}"${bcAttr(r)}>${head0}`
    + `<td class="bs-bd"><span class="bs-bdg">${r.badge}</span></td>`
    + usesCell(r, 'up', true) + usesCell(r, 'lo')
    + `<td class="bs-num bs-sep bs-kgap" title="この区間の刃どうしの寸法。`
    + `条幅 ${r.sg.w.toFixed(2)} を作っている側を出しています">`
    + `${esc(spanText(bladeSpan(r.c.len, r.sg.w)))}</td>`
    + Ss.map((x, i2) => `<td class="bs-num${i2 ? '' : ' bs-sep'}">${num(r.c.sp[x])}</td>`).join('')
    /* **ゴムリングは色（＝外径）×幅で1本**（§9.377）。幅だけでは注文できないので、
       **色と外径も表で読める**ようにする（§9.441、利用者の指示「ゴムリングの色や
       外径については表の方にもほしいです」）。図の帯の字は狭い区間で落ちるが、
       ここは必ず読める（§9.434 と同じ「落ちない置き場」）。 */
    + (Gs.length && !res.finger
       ? `<td class="bs-num bs-sep bs-ringid" title="このゴムリングの色と外径です。`
         + `色は外径そのもので、${r.c.ringT === 'big' ? `大径＝${SPAN_WORD.out}側（製品幅を作る刃）` : `小径＝${SPAN_WORD.in}側（広げた刃）`}です">`
         /* **大径か小径かを字で言う**（§9.466、利用者の指示「ゴムリングの場合は、大径と
            小径どっちがどっちかわかるように」）。同じ行の「刃の間隔」が広い／狭いを言うので、
            広い＝小径・狭い＝大径が1行で読める。 */
         + `<b class="bs-ringsz">${r.c.ringT === 'big' ? '大径' : '小径'}</b>`
         + `<span class="bs-ringdot" style="background:${esc(hexOf(r.c.od) || 'transparent')}"></span>`
         + `${esc(colorOf(r.c.od))}Φ${r.c.od}</td>` : '')
    + Gs.map((x, i2) => `<td class="bs-num${i2 || !res.finger ? '' : ' bs-sep'}">${num(r.c.G[x])}</td>`).join('')
    + (hasLube ? `<td class="bs-num bs-sep">${r.c.lube ? `<span class="bs-lubedot"></span><b>${r.c.lube}</b>` : '<span class="bs-z">·</span>'}</td>` : '')
    + (hasHold ? `<td class="bs-num bs-sep${holdCls(r)}"`
       + ` title="${ringBand
          ? `刃のあいだと${esc(holdLabel)}${res.finger ? '' : '（潤滑リングを含む）'}の差です。${R.gapMin}〜${R.gapMax}mm に収めます`
          : `${esc(holdLabel)}で埋め切れなかった幅です`}。`
       + `軸の寸法はスペーサーが作るので、ここが空いても刃の位置は動きません">`
       + holdCell(r) + '</td>' : '')
    + (hasRem ? `<td class="bs-num bs-sep ${gapCell(r.c.rem)}"`
       + ' title="スペーサーで区間を埋め切れなかった幅です。組んだものはOS側へ'
       + '押し付けて組むので、ここは 0 でなければなりません">'
       + `${r.c.rem > 0.001 ? r.c.rem.toFixed(3) : '·'}</td>` : '')
    + '</tr>';
  }).join('')).join('');
  $('#bsTables').innerHTML = fitAlertHtml(res)
   + `<table class="bs-g">${head}<tbody>${body}</tbody></table>`;
 }
 /* 端数は、そのまま「刃と刃のあいだに残る隙間」になる。ぴったり埋まったものと
    許容内で隙間があるものを見分けられるようにする。 */
 /* **スペーサーの端数は 0 が正**（§9.441、利用者の指示「スペーサー層の余りは
    本来0のはずで、0でないのは計算の不具合です。組んだものをOS側に押し付けて
    組んでいくので隙間がなくなります」）。以前は `gapMax`（5mm）までを「許容」と
    して緑で出していたが、**許容ではなく不具合**なので、0 でなければ赤で出す。 */
 const gapCell = rem => (rem <= 1e-9 ? 'is-zero' : 'is-bad');

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
   /* **基準面の反対の端はフローティングシートが押さえる**（§9.456／§9.461、利用者の指示）。
      スペーサーを基準面から敷き詰め、有効長に近づいたら反対の端から押さえるので、その端の
      残りは隙間ではない——**押さえる量**として常に出す（0でも行は残す＝在ることを言う）。
      基準面の側の残りは今までどおり「隙間」（0が正・§9.441）。 */
   const datum = res.A.datum, far = datum === 'OS' ? 'DS' : 'OS';
   const openEnd = sd === far;
   /* 押さえ代（§9.457）。超えたぶんは吸えない＝赤。 */
   const stroke = BS().floatStroke(M);
   if (openEnd || U.c.rem > 0.001 || L.c.rem > 0.001) {
    const cls = r => (openEnd ? (stroke > 0 && r.c.rem > stroke + 1e-6 ? 'bs-ng' : '') : gapCell(r.c.rem));
    const gv = r => (r.c.rem > 0.001
     ? `<span class="${cls(r)}">${r.c.rem.toFixed(openEnd ? 3 : 2)}</span>`
     : '<span class="bs-z">·</span>');
    h += `<tr class="bs-rem"${openEnd ? ` title="有効長に近づいたら、${far}側から${datum}側へフローティングシートで押さえます。その量です（隙間ではありません）。押さえ代は ${stroke}mm まで"` : ''}>`
     + `<td class="bs-a">${openEnd ? `フローティングシート<small>押さえ代 ${stroke}</small>` : '隙間'}</td>${two(gv(U), gv(L))}</tr>`;
   }
   /* 取り付ける順（OS端が先）は入れる向き（DS側から）で決まる機械の事実。基準面とは別（§9.461）。 */
   const why = `${sd === 'OS' ? 'いちばん先に取り付けます' : 'いちばん後に取り付けます'}`
    + `（${sd === datum ? '基準面' : 'フローティングシートで押さえる側'}）。`
    + '最外刃より外なのでスペーサーのみです。';
   el.innerHTML = `<div class="bs-fh" title="${esc(why)}">`
    + `<span class="bs-pin">${sd}</span><span class="bs-lr">${at(sd)}</span>`
    + `<span class="bs-trim ${trim < 0 ? 'bs-ng' : ''}">耳 ${trim.toFixed(2)}</span></div>`
    + '<table class="bs-e"><thead><tr><th class="bs-a">部材<small>mm</small></th>'
    + '<th>上軸</th><th>下軸</th></tr></thead><tbody>' + h + '</tbody></table>';
  });
  /* 端部の説明も基準面から言う（§9.461）。 */
  const dn = res.A.datum, fr = dn === 'OS' ? 'DS' : 'OS', note = $('#bsEndsNote');
  if (note) note.innerHTML = '最外刃より外の区間です。<b>OS</b>から先に取り付け、<b>DS</b>が最後になります。'
   + `基準面は<b>${dn}</b>、${fr}端は<b>フローティングシート</b>で押さえるので、残りは隙間になりません。`;
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
  paintOffset(res.err, res.A.datum);
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
 function paintOffset(e, datum) {
  const dn = datum === 'OS' ? 'OS' : 'DS', fr = dn === 'OS' ? 'DS' : 'OS';
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
  /* 入れる側（DS・台車の開く側）は機械の事実で、押し付ける側（基準面）とは別の軸（§9.461）。 */
  const lines = [`DS側から部材を入れ、${dn}側（基準面）へ押し付けて組みます。区間を手持ち寸法で埋めきれない分（端数）だけ、それより ${fr} 側の刃は ${dn} 側へ寄ります。`];
  if (diff > 1e-9) {
   lines.push(`上軸と下軸で端数の出方が違います。差がいちばん大きいのは <b>${e.worstAt + 1} 本目の刃</b>`
    + `（上軸の累積 ${e.cumU.toFixed(3)} ／ 下軸の累積 ${e.cumL.toFixed(3)} mm）。`);
  } else if (shift > 1e-9) lines.push('上下とも同じだけ寄るため、左右差にはなりません。');
  else lines.push('端数は出ていません。手持ち寸法で全区間を割り切れています。');
  if (shift > 1e-9) {
   lines.push(`刃全体が <b>${shift.toFixed(3)} mm</b> ${dn} 側へ寄ります。${dn}耳はそのぶん狭く、${fr}耳は広くなります。`);
  }
  const tail = Math.max(e.tail.up, e.tail.lo);
  if (tail > 0.001) lines.push(`${fr}端に残る ${tail.toFixed(2)} mm はフローティングシートが押さえる余りで、刃の位置はずらしません。`);
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
   /* 潤滑リング（§9.455）。在庫は**ゴムリングマスタの潤滑リングの行**が持つので、
      ゴムリングと同じく「使える数」と比べる（稼働中の台車に載っているぶんは引く）。 */
   const lb = g.lube || {};
   if (lb.u + lb.l > 0) {
    const x = g.plan.lube && g.plan.lube.get(String(lb.w));
    html += needGroup(`<span class="bs-lubedot"></span>潤滑リング`,
     [needChip(`幅${lb.w}`, lb.u, lb.l, x ? x.free : 0)], `Φ${lb.od}/Φ${lb.bore}`);
   } else if (res.fit && res.fit.lubeMissing) {
    html += needGroup('<span class="bs-lubedot"></span>潤滑リング', [],
     'ゴムリングマスタに潤滑リングの行がありません');
   }
  }
  $('#bsBom').innerHTML = html;
 }

 /* ====================== 台車差分 ====================== */
 const itemKeys = o => Object.keys(o).sort((a, b) => {
  const pa = a.split('|').map(Number), pb = b.split('|').map(Number);
  return (pb[0] - pa[0]) || ((pb[1] || 0) - (pa[1] || 0));
 });
 /* 組み替える台車に**いま載っている**記録を探す。
    2台を交互に使うラインでは、直前の刃組（`h[0]`）はラインで稼働中なので
    飛ばす——いま組み替える台車に載っているのは、その前の記録。
    **台車が1つのラインでは飛ばさない**（§9.424、利用者の指示「ごくまれに
    スリッターがある設備でも、台車なしというパターンがありました」）。
    台車を使わないラインでは、**いま機械に載っているのが直前の刃組そのもの**で、
    それが組み替える相手になる。飛ばすと1つ古い記録と比べてしまう。 */
 function targetRecord() {
  const h = M.history || [];
  const from = carriageNames().length > 1 ? 1 : 0;
  for (let i = from; i < h.length; i++) {
   if (h[i].carriage === st.carriage) return { rec: h[i], back: i + 1 };
  }
  return { rec: null, back: 0 };
 }
 /* **記録が無い台車の基準は「標準構成」**（§9.415、利用者の指示「差分が
    デフォルトでも出るように、デフォルトの刃組設定で決定している状態にして、
    それを基に差分を出してください」）。

    以前は記録が1件も無いと台車の列が全部「—」になり、**部材を1つ残らず棚から
    持ち出す**（実測: そのまま使える 0 ／ 持ち出す 14）という読みになっていた
    ——台車が空であることは分かっていないので、これは事実ではない。
    既定の刃組設定（`刃組基準値マスタ`＋既定値）でこの材料を組んだ構成を
    「載っているとみなす」基準に置くと、**標準から何を動かしたか**が差分に出る。

    計算は**スケジュール一覧の見込みと同じ1本**（`standardState()`＋`solve()`＋
    `snapshot()`・§9.408）から引く——2つ持つと「一覧とガイダンスで数が違う」を
    作れてしまう。**出どころは必ず字で書き分ける**（§CLAUDE 6）。 */
 function standardSnapshot(seed) {
  const B = BS();
  if (!M || !IX || typeof B.standardState !== 'function') return null;
  try {
   const s2 = B.standardState(seed, M);
   if (!s2) return null;                 /* 条が1本も読めない（§9.231: 0で埋めない） */
   s2.carriage = st.carriage;
   return B.snapshot(s2, M, B.solve(s2, M, IX).g);
  } catch (err) {
   WL.quiet.note('標準構成を計算できない（台車の列は「—」のままにする）', err);
   return null;
  }
 }
 /* いま画面に入っている材料。**これから流す物**なので、基準に置くのは最後
    （§9.425）——これで計算すると「もう組んである」と読める差分になる。 */
 function nowSeed() {
  return { thickness: st.thick, originalWidth: st.W,
           lots: (st.lots || []).map(L => ({ name: L.name, w: L.w, n: L.n,
                                             parent: L.parent || L.name })) };
 }
 /* **前回流した材料**（§9.425、利用者の指示「記録が無ければ前回流した材料から
    標準設定で計算」）。履歴の新しい順に見て、**材料を組み直せる最初の1件**を採る
    ——元板巾が入っていない古い記録は飛ばす（`seedFromCond` が `null` を返す）。
    その台車の記録とは限らない（台車に記録が無いとき、その台車が前回何を流したかは
    どこにも残っていない）ので、**どの記録から起こしたかを字で言う**。 */
 function prevSeed() {
  const B = BS();
  for (const r of (M.history || [])) {
   const seed = B.seedFromCond(r.detail && r.detail.cond);
   if (seed) return { seed, rec: r };
  }
  return null;
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
   lube: k => { const x = plan.lube && plan.lube.get(String(k)); return x ? x.free : 0; },
   blade: k => {
    const [dia, tk] = String(k).split('|');
    const x = M.blades.find(y => y.currentDia !== null && Math.abs(y.currentDia - +dia) < 0.05
     && Math.abs((y.thickness || 0) - +tk) < 0.01);
    return x ? x.qty : 0;
   }
  };
  const pd = prev && prev.detail ? prev.detail : null;
  /* 比べる相手は**4段**（§9.425。§9.415 の3段を1段増やした）。
       ① その台車の記録        … 実際に組んだ事実。いちばん強い
       ② 前回流した材料        … 履歴の直近1件の条件を既定の刃組設定で組んだ計算値
       ③ いまの材料            … これから流す物。**いちばん弱い**
       ④ 無し                  … 条の幅が読めない
     ②を①の次に置くのが §9.425 の要点。以前は①の次が③で、**これから流す材料**で
     計算していたため差分がほとんど出ず、「もう組んである」と読めた。 */
  let std = null, stdFrom = null;
  if (!pd) {
   const p2 = prevSeed();
   if (p2) { std = standardSnapshot(p2.seed); if (std) stdFrom = p2.rec; }
   if (!std) std = standardSnapshot(nowSeed());
  }
  const base = pd || std;
  const baseKind = pd ? 'rec' : (std ? (stdFrom ? 'prev' : 'std') : 'none');
  const parts = [
   diffRows('スペーサー', cur.spacer, base && base.spacer, shelf.spacer),
   diffRows('ゴムリング', cur.ring, base && base.ring, shelf.ring, k => {
    const [od, sz] = String(k).split('|');
    return `<span class="bs-swc"><i style="--bs-dot:${esc(hexOf(+od))}"></i>`
     + `${esc(colorOf(+od))}${esc(od)}<small>幅 ${esc(sz)}</small></span>`;
   }),
   diffRows('フィンガー', cur.finger, base && base.finger, shelf.finger),
   /* 潤滑リング（§9.454）。在庫を持たないので棚の数は出さない（`null`）。
      古い記録には鍵が無い——無いものは0本として比べる。 */
   diffRows('潤滑リング', cur.lube || {}, base && (base.lube || {}), shelf.lube,
            k => `幅 ${esc(k)}`),
   diffRows('刃', cur.blade, base && base.blade, shelf.blade, k => {
    const [dia, tk] = String(k).split('|');
    return `Φ${esc(dia)}${tk ? `<small>刃厚 ${esc(tk)}</small>` : ''}`;
   })
  ];
  /* 「稼働中なので使えない」と言えるのは**別の台車**のときだけ（§9.424）。
     台車が1つのラインでは、稼働中の構成そのものを組み替えるので、
     その部材は**外して使える**——ここで断ると事実と食い違う。 */
  const busyOther = inUse && inUse.carriage !== st.carriage ? inUse : null;
  $('#bsDiffHead').innerHTML =
   (busyOther ? `<div class="bs-alert"><b>ラインで稼働中（直前の刃組）</b>　${esc(busyOther.carriage)}<br>`
     + `${esc(busyOther.at)}<br>${esc(busyOther.note)}<br>ここに載っている部材は外せないため、今回は使えません。</div>` : '')
   + (baseKind === 'rec'
    ? `<div class="bs-alert is-info" data-base="rec"><b>組み替える ${esc(st.carriage)} の現在の構成（${back}回前）</b><br>`
      + `${esc(prev.at)}<br>${esc(prev.note)}<br>ここに載っている部材はそのまま使えます。</div>`
    /* **出どころを書き分ける**（§CLAUDE 6）。「記録＝組んだ事実」と
       「標準構成＝いまの材料を既定の設定で組んだときの計算値」は別物で、
       取り違えると「もう組んである」と読める（§9.408 と同じ線引き）。 */
    : baseKind === 'prev'
     ? `<div class="bs-alert is-info" data-base="prev"><b>${esc(st.carriage)} の記録がありません。`
       + '<u>前回流した材料</u>で組んだ構成と比べています</b><br>'
       + `<b>「前回」の列</b>＝${esc(stdFrom.at)} の刃組（${esc(stdFrom.carriage)}）に`
       + '残っている材料を、<b>既定の刃組設定</b>（刃組基準値マスタ）で組んだときの'
       + '<b>計算値</b>。組んだ事実ではありません。<br>'
       + 'この台車で刃組を終えて記録すると、次回からは実際に組んだ構成と比べます。</div>'
     : baseKind === 'std'
     ? `<div class="bs-alert is-info" data-base="std"><b>${esc(st.carriage)} の記録がありません。`
       + '<u>標準構成</u>と比べています</b><br>'
       + '<b>「標準」の列</b>＝<b>いまの材料</b>を<b>既定の刃組設定</b>（刃組基準値マスタ）で'
       + '組んだときの<b>計算値</b>。組んだ事実ではありません。<br>'
       + '<b>これから流す材料</b>で計算しているので、差分は小さく出ます'
       + '——この設備で刃組を1件でも記録すると、そのときの材料と比べます。</div>'
     : `<div class="bs-alert" data-base="none">${esc(st.carriage)} に組み替え対象となる記録がなく、`
       + '標準構成も計算できません（条の幅がまだ読めません）。'
       + '手順3で条の幅を入れると、標準構成との差分が出ます。</div>');
  const total = k => parts.reduce((a, x) => a + x[k], 0);
  const short = parts.flatMap(x => x.short);
  $('#bsDiffSum').innerHTML = '<div class="bs-kpis">'
   + `<div class="bs-kpi"><span>そのまま使える</span><b>${total('keep')}</b></div>`
   + `<div class="bs-kpi is-good"><span>棚から持ち出す</span><b>${total('add')}</b></div>`
   + `<div class="bs-kpi is-ng"><span>棚に戻す</span><b>${total('back')}</b></div></div>`
   + (short.length ? `<div class="bs-alert is-bad">棚にも足りない部材が ${short.length} 種あります。数を確かめてください。</div>` : '');
  /* 列の見出しで**どちらと比べているか**を言う（§CLAUDE 6・§9.415）。
     同じ「台車」の字で記録と計算値を並べない。断りの器は `data-base` で
     **どの段か**を名乗る（§9.425）——字で見分けると、稼働中の断りに同じ
     言葉が入っただけで網が取り違える（実際に取り違えた）。 */
  const baseCol = baseKind === 'prev'
   ? `<th title="${esc(stdFrom.at)} の刃組（${esc(stdFrom.carriage)}）に残っている材料を`
     + '、既定の刃組設定で組んだときの構成（計算値）">前回</th>'
   : baseKind === 'std'
   ? '<th title="いまの材料を既定の刃組設定で組んだときの構成（計算値）">標準</th>'
   : `<th title="${esc(st.carriage)} にいま載っている構成（刃組の記録）">台車</th>`;
  $('#bsDiff').innerHTML = `<thead><tr><th class="bs-a">部品</th>${baseCol}<th>今回</th>`
   + '<th>追加</th><th>戻す</th></tr></thead><tbody>'
   + parts.map(x => x.html).join('') + '</tbody>';
  $('#bsHist').innerHTML = h.length
   ? h.slice(0, 6).map((r, i) => `<div class="bs-hrow${i === 0 ? ' is-use' : ''}${prev && r === prev ? ' is-tgt' : ''}">`
     + `<span class="bs-hi">${i === 0 ? '1回前 稼働中' : (i + 1) + '回前'}</span>`
     + `<span class="bs-hc">${esc(r.carriage)}</span><span class="bs-hn">${esc(r.at)}</span>`
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
  renderCarPick();
 }
 /* 台車の札（§9.424）。**顔ぶれは台車マスタ**で、1行も無ければ札を出さずに
    「登録がない」と言い、記録も止める——**できないことは、できないと書く**
    （§CLAUDE 4）。勝手に A／B を作ると、無い台車の差分を出せてしまう。 */
 function carriageNames() {
  return (M && M.carriages ? M.carriages : []).map(x => String(x.name || '').trim())
   .filter(Boolean);
 }
 function renderCarPick() {
  const names = carriageNames();
  const box = $('#bsCarPick');
  if (!box) return;
  box.innerHTML = names.length
   ? names.map(n => `<button type="button" class="bs-chip${n === st.carriage ? ' is-on' : ''}"`
      + ` data-car="${esc(n)}">${esc(n)}</button>`).join('')
   : '<span class="bs-none">登録がありません</span>';
  const save = $('#bsSaveCar');
  if (!save) return;
  if (!names.length) {
   save.disabled = true;
   save.textContent = '台車マスタに登録がないため記録できません';
   /* **直し方をその場に書く**（§CLAUDE 4）。綴りはサーバーが持つ値を使う
      ——ここに書き写すと、片方だけ変わったときに案内だけが古くなる。 */
   save.title = '手順1の「初期セット」で ' + (M.carriageSeed || []).join('・')
    + ' が入ります。台車を使わないラインでは、マスタ管理の「テーブル」→ 台車マスタへ'
    + '「' + (M.carriageNone || '台車なし') + '」を1行足すと選べます。';
   return;
  }
  save.disabled = false;
  save.title = '';
  save.textContent = `刃組完了：${st.carriage} として記録`;
 }
 /* いま選んでいる台車を、台車マスタの顔ぶれに合わせる。**無い台車は選ばない**
    ——設備を替えたときに前の設備の台車名が残ると、その名前で記録してしまう。 */
 function syncCarriage() {
  const names = carriageNames();
  if (!names.length) { st.carriage = ''; return; }
  if (!names.includes(st.carriage)) st.carriage = names[0];
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
  $('#bsCenter').value = st.center > 0 ? st.center : '';
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
 /* 図の左右。**模式図は見せ方を裏返し、立体図は台車そのものを回す**
    ——どちらも「DS を左に置く」（`flip`）という同じ1つの状態から出す（§9.377）。
    利用者が選ぶのは`flip`ではなく**基準原点を左か右か**（§9.463）。基準面が DS か
    OS かで同じ「右」でも`flip`が入れ替わるので、**答えは`flipOf()`の1箇所**。 */
 const VIEW_POS = ['左', '右'];
 const datumNow = () => BS().datumOf(M || {});
 const flipOf = pos => (datumNow() === 'DS') === (pos === '左');
 const posOfFlip = flip => ((datumNow() === 'DS') === !!flip ? '左' : '右');
 function viewLabel(pos) {
  const P = (M && M.P) || {};
  return String((pos === '左' ? P.viewLabelLeft : P.viewLabelRight) || `基準原点を${pos}`);
 }
 function setFlip(on) {
  st.flip = !!on;
  const pos = posOfFlip(st.flip), dn = datumNow(), other = dn === 'DS' ? 'OS' : 'DS';
  $('#bsFlip').querySelectorAll('[data-datum-pos]').forEach(b => {
   const p = b.dataset.datumPos, me = p === pos;
   b.textContent = viewLabel(p);
   b.classList.toggle('is-on', me);
   b.setAttribute('aria-pressed', me ? 'true' : 'false');
   b.title = `基準原点（${dn}）を図の${p}、${other}を${p === '左' ? '右' : '左'}に置きます`
     + (me ? '（いまこの向きです）' : '');
  });
  $('#bsFigRow').classList.toggle('is-flip', st.flip);
  if (WL.bladeSolid) WL.bladeSolid.spinTo(st.flip ? Math.PI : 0);
 }
 function setViewPos(pos) { setFlip(flipOf(VIEW_POS.includes(pos) ? pos : '右')); }

 const closePops = () => panel.querySelectorAll('.bs-step').forEach(p => p.classList.remove('is-open'));

 /* 模式図／断面図／立体図。**器の出し入れはここが持ち、中身は`WL.bladeSolid`が
    持つ**。顔ぶれは`FIG_KINDS`の1箇所（増やすときはここと札だけ・§9.412）。 */
 const FIG_KINDS = ['2d', 'cut', '3d'];
 const FIG_SOLID = { cut: true, '3d': true };    /* 立体の模型を使う図 */
 /* **最初に出す図は断面図**（§9.440、利用者の指示「断面図を初期値にして
    ください」）。答えは1箇所——札の`is-on`・器の出し入れ・`figKind`の初期値・
    読めない値を受けたときの倒れ先が、ここを見て揃う。 */
 const FIG_DEFAULT = 'cut';
 let figKind = FIG_DEFAULT;
 /* 利用者が自分で図を選んだか。**選んだあとは既定へ戻さない**（開き直しても
    選んであった側で出す・§9.412）。倒れ先の判断にも使う。 */
 let figChosen = false;
 /* 立体の部品（three.js）を読めない端末では**模式図へ倒す**（§9.377「部品を
    読めない端末では字で断る。模式図はそのまま使える」）。ただし**倒すのは
    既定で開いたときだけ**——自分で断面図を押した人には断りの字を出す
    （黙って別の図へ移すと、押した結果が消えたように見える）。 */
 function figMode(mode, auto) {
  figKind = FIG_KINDS.includes(mode) ? mode : FIG_DEFAULT;
  const solid = !!FIG_SOLID[figKind];
  panel.querySelectorAll('#bsFigTabs [data-fig]')
   .forEach(b => b.classList.toggle('is-on', b.dataset.fig === figKind));
  panel.querySelector('.bs-stage').hidden = solid;
  $('#bsStage3').hidden = !solid;
  /* 拡大図は模式図の区間を指している（§9.413）。立体の図へ移ったら閉じる
     ——指している先が画面から消えるので、残すと何の窓なのか読めない。 */
  if (solid) closeZoneZoom();
  /* 断面図では機械まわりを伏せているので、**段取りの3つは押しても何も起きない**
     ——押せるのに何も起きない的を残さない（§CLAUDE 4）。器ごと伏せる。 */
  $('#bsStage3').classList.toggle('is-cut', figKind === 'cut');
  /* 設定の帯は**断面図だけ**（§9.443）。立体図は機械の見た目を見る図。 */
  const cutSet = panel.querySelector('.bs-cutset');
  if (cutSet) cutSet.hidden = figKind !== 'cut';
  if (!WL.bladeSolid) return;
  /* **切り替えは1回で組む**（§9.428）。以前はここで`sync()`を呼んでから
     `setMode()`を呼んでおり、`sync()`が**前の図のまま**1回組んで1枚描いて
     いた（組むのも2回）。いまの割付は`setMode()`へ渡す。 */
  const want = figKind;
  Promise.resolve(WL.bladeSolid.setMode(solid, figKind, { st, M, res: (LAST && !(LAST.stop || []).length) ? LAST : null, ringHex: hexOf }))
   .then(ok => {
    if (ok || !auto || figKind !== want || want === '2d') return;
    /* 倒すときは断りの字も引っ込める——模式図はふつうに使えるので、
       赤い断りだけが残ると「壊れている」と読める。 */
    const ng = panel.querySelector('.bs-ng3');
    if (ng) ng.hidden = true;
    figMode('2d');
   })
   .catch(e => WL.quiet.note('図を組めない（模式図はそのまま使える）', e));
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
  /* 板の中心（§9.456）。**空にしたら「打っていない」へ戻す**（0を入れない）。 */
  $('#bsCenter').addEventListener('input', e => {
   const v = e.target.value.trim();
   st.center = v === '' || !(+v > 0) ? null : +v;
   scheduleRender();
  });
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
  /* 記録した並びへ戻す（§9.387、利用者の指示「再設計ができる配線」）。
     **記録は消さない**——画面を記録の側へ合わせるだけなので、押し間違えても
     失うものが無い（取り消せない操作を主要動線に置かない・§CLAUDE 5）。 */
  $('#bsDsReset').addEventListener('click', () => {
   if (!applyDesign(seededHeadLot)) {
    alertModal('記録した条の設計を読めませんでした。');
    return;
   }
   BS().syncOrder(st);
   paintInputs(); renderLots(); renderOrder(); render();
   showToast('記録した並びに戻しました', '条の設計として残してある並びです。', 3000);
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
  /* 組めないときの「直す場所を開く」（§9.454）。手順の窓を開く道は1本
     （`[data-step-open]`）なので、その札を押す。 */
  $('#bsTables').addEventListener('click', e => {
   const b = e.target.closest('[data-stop-open]');
   if (!b) return;
   e.stopPropagation();
   const host = panel.querySelector(`.bs-step[data-step="${CSS.escape(b.dataset.stopOpen)}"]`);
   closePops();
   if (host) host.classList.add('is-open');
  });
  document.addEventListener('click', e => {
   if (!panel || panel.hidden) return;
   if (!e.target.closest('.bs-step')) closePops();
   /* 拡大図は**自分の中**と**区間そのもの**を押したときだけ残す（§9.413）。
      押した区間の上で閉じると、開いた次の瞬間に消えることになる。 */
   if (!e.target.closest('.bs-zoom') && !e.target.closest('.bs-bhit')) closeZoneZoom();
  });
  document.addEventListener('keydown', e => {
   if (e.key !== 'Escape' || !panel || panel.hidden) return;
   closePops();
   closeZoneZoom();
  });
  /* **区間を押すと拡大図**（§9.413、利用者の指示「アルファベットをクリック
     したら、ポップオーバーでその部分だけの組み合わせを拡大した図を…」）。
     的は重ねたときと**同じ区間ぜんたい**（§9.386）——記号の札だけを的に
     すると、狙わないと押せない（実測 27×29px）。 */
  panel.addEventListener('click', e => {
   const hit = e.target.closest('.bs-bhit');
   if (!hit || !panel.contains(hit)) return;
   if (zoomBadge === String(hit.dataset.badge)) { closeZoneZoom(); return; }
   openZoneZoom(hit.dataset.badge, hit, hit.dataset.axis);
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
  $('#bsZoomClose').addEventListener('click', closeZoneZoom);
  /* 段取りへ戻る（§9.378）。**左メニューと同じ口**を呼ぶ——入口を2つにしない。 */
  $('#bsFrom').addEventListener('click', () => {
   const api = WL.scheduleView;
   if (!api || typeof api.open !== 'function') {
    alertModal({ title: '作業スケジュールを開けません',
                 message: '左のメニューの「作業スケジュール」から開いてください。' });
    return;
   }
   /* **来た道を返す**（§9.407）。渡さないと向こうの既定（設備を選べる端末は
      俯瞰ボード）で開き直すので、個別のタイムラインや刃組スケジュール一覧から
      来た人は「戻れていない」ように見える。 */
   Promise.resolve(api.open(seededBack ? { mode: seededBack.mode } : undefined)).catch(e => {
    WL.quiet.note('作業スケジュールへ戻れない', e);
    alertModal({ title: '作業スケジュールへ戻れません',
                 message: String((e && e.message) || e || '') });
   });
  });
  /* 図の向き */
  $('#bsFlip').addEventListener('click', e => {
   const b = e.target.closest('[data-datum-pos]');
   if (!b || b.classList.contains('is-on')) return;
   setViewPos(b.dataset.datumPos); renderOrder(); scheduleRender();
  });
  /* 模式図／立体図（§9.377 追補）。**押した札はすぐ濃くする**——部品を取りに
     行くあいだ何も変わらないと、押せていないように見える。読めなかったときは
     立体図の器の中に理由が出る（模式図へは勝手に戻さない・選んだのは利用者）。 */
  $('#bsFigTabs').addEventListener('click', e => {
   const b = e.target.closest('[data-fig]');
   if (!b) return;
   figChosen = true;              // 自分で選んだら、以後は既定へ戻さない（§9.440）
   figMode(b.dataset.fig);
  });
  if (WL.bladeSolid) {
   WL.bladeSolid.attach($('#bsStage3'), { onSpin: () => {
    setFlip(!st.flip); renderOrder(); scheduleRender();
   },
   /* 断面図の区間の記号が組み直されたら**印を塗り直す**（§9.417）。
      記号は図を描くたびに作り直されるので、塗らないと重ねている最中に
      光りが消える。呼ばれるのは**顔ぶれが変わったときだけ**（回している
      あいだ毎フレームではない）。 */
   onBadges: () => { paintBadgePick(); syncZoneZoom(); } });
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
  /* 台車の札は**描き直されるたびに作り替わる**（台車マスタが顔ぶれを決める）
     ので、配線は**器**で受ける（§9.424）。 */
  $('#bsCarPick').addEventListener('click', e => {
   const b = e.target.closest('[data-car]');
   if (!b) return;
   st.carriage = b.dataset.car;
   scheduleRender();
  });
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
  /* 組めない材料は記録しない（§9.454）。ボタンは伏せてあるが、道は1本に絞る。 */
  if ((LAST.stop || []).length) {
   await alertModal({ title: 'この材料では刃組を組めません',
     message: LAST.stop.map(x => `${x.text}。${x.fix}。`).join('\n') });
   return;
  }
  const B = BS();
  const gs = [...new Set((M.blades || []).map(k => String(k.group || '').trim()))].filter(Boolean);
  if (gs.length && !st.bladeGroup) {
   await alertModal({ title: '刃セットを選んでください',
     message: '「台車差分」の上にある〈刃セット〉から、この刃組で使った組を選びます。'
            + '候補は刃マスタの「組」から出しています。' });
   const sel = $('#bsSetPick'); if (sel && sel.focus) sel.focus();
   return;
  }
  /* **条の設計が済むまで確定させない**（§9.387、利用者の指示「条設計が必須の
     流れで、その内容で刃組をしてください」）。刃組はこの並びで組むものなので、
     記録が無いまま確定すると**測定は既定の並びで始まり、組んだ形と食い違う**。
     止めるのはここ1箇所だけ——図も刃組表も所要も見られるままにして、
     「決めた形を残す」手前でだけ断る（見ながら決める動線を壊さない）。
     **理由と次の一手を字で出す**（§CLAUDE 4 できないことは、できないと書く）。 */
  const ds = designState();
  if (!ds.total || ds.none || ds.diff) {
   const why = !ds.total ? 'ロットがまだ入っていません。'
    : (ds.none ? `条の設計が未記録です（${ds.none}件）。`
               : `画面の並びが、記録してある条の設計と違います（${ds.diff}件）。`);
   await alertModal({ title: '先に条の設計を記録してください',
     message: why + '〈幅構成〉の「この並びを条の設計として記録する」で残すと、'
            + 'この並びで刃組を確定でき、測定も同じ並びで条を埋めます。' });
   const b = $('#bsDsSave');
   if (b && b.scrollIntoView) b.scrollIntoView({ block: 'center' });
   if (b && b.focus) b.focus();
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
   title: `${st.carriage} の刃組を記録します`,
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
             `${st.carriage} として残しました`
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
       ? '記録すると、測定画面がこの並びで条を埋めます。記録しないと刃組を確定できません。'
       : '測定画面はこの並びで条を埋めます。');
  }
  /* **押す言葉を状態に合わせる**（§9.387）。「記録する」と「記録し直す」は
     結果が違う（後者は上書き）ので、同じ字で出すと取り違える。
     戻す道は**違うときだけ**出す（§CLAUDE 4）。 */
  const save = $('#bsDsSave'), reset = $('#bsDsReset');
  if (save) {
   save.textContent = d.diff ? 'この並びで条の設計を記録し直す'
                             : 'この並びを条の設計として記録する';
  }
  if (reset) reset.hidden = !(d.diff && seededHeadLot);
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
      note: `刃組（${st.carriage}）` }))
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
