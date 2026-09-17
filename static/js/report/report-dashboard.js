"use strict";
/* report-dashboard.js: 測定帳票・生産管理ダッシュボード */
/* ============================================================
2026-07-21 ロット別測定帳票
--------------------------------------------------------------
方針（IA / 認知心理学）:
- モーダルではなく、品質データ分析(qa-v7)と同じ「メイン画面の
  表示切り替え」とする。表示エリアを最大限確保するため、#grid の
  兄弟要素としてパネルを差し込み、body.rp-mode で他の要素を隠す。
- 左に端末保存済みロットの一覧（再認）、右にプレビュー（詳細）。
  帳票本体はセクション見出しでチャンク化し、1画面で読み切れる粒度にする。
- 画面プレビューは印刷と同じ密度のCSSでA4実寸(210mm×297mm)のまま
  組み、既定では「ページ全体」表示（縮小フィット）にして帳票の
  全体像を一目で把握できるようにする。100%表示にも切り替え可能。
- 「records.sqlite3」への保存内容と同一のローカル保存レコード
  （reliableAll）を対象データとする。印刷・PDF保存はブラウザーの
  印刷機能を使い、追加ライブラリなしで完結させる。
============================================================ */
(function(){
 let rpState={items:[],query:'',sort:'updated-desc',selectedId:''},rpZoom='fit',rpCurrentScale=1;
 // 条ごとのロット№/公差ラベルを、連続する行でも毎回表示するか、変化した
 // 行だけに表示するか(見た目上のグルーピング)を切り替えられるようにする。
 let rpRepeatLabels=true;
 /* 異常位置判定(参考)を帳票へ載せるか。載るのは**モーダルで保存された
    ロットだけ**で、保存が無ければこのトグルに関わらず出ない。保存は
    「オペレータが意図的に残した」という合図なので、既定は表示ON。 */
 let rpShowDefect=true;
 // 帳票の一括印刷用の複数選択。ロットを切り替えるたびにクリアはしない
 // (絞り込みや並び替えを挟んでも選択を保てるようにするため)。
 let rpSelectedIds=new Set();
 const $id=id=>document.getElementById(id);
 function fmtDT(v){if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?'-':d.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
 function fmtDimSafe(v,d){const raw=String(v??'').trim();if(raw==='')return '';const n=Number(raw);return Number.isFinite(n)?n.toFixed(d):raw}
 // statusClass/statusLabelはbase.jsの共通定義を使う(以前はここに同一内容を重複定義していた)。

 /* 2026-07-22: 帳票へはメニューから直接遷移させず、編集中/完了データ一覧の
    各行からのみ開けるようにする(一覧側が起点になる運用のため、サイドバー
    の直接導線は廃止)。 */
 function exitReportView(){
  if(!document.body.classList.contains('rp-mode'))return;
  /* **組み換え中に画面を離れたら、まだ投げていない保存を流してから閉じる**
     （§9.303 ③）。触っていなければ下書きを捨てる——保存せずに当てている
     状態のまま抜けると、他の画面が触ったつもりの無い設定で描かれる
     （列レイアウトマスタは画面をまたいで共有のキャッシュ・§9.169）。 */
  closeArrange();
  document.body.classList.remove('rp-mode');
  const panel=$id('reportPanel');if(panel)panel.hidden=true;
 }
 /* `ownPrint`＝専用の印刷を持つ画面（§9.300 ①）。ヘッダーの汎用の
    「画面を印刷」と二重にしない。 */
 WL.registerView({key:'report',bodyClass:'rp-mode',header:['測定帳票',''],ownPrint:true,exit:exitReportView});
 /* 自作の塊の写しを捨てる口（§9.217）。マスタ管理で足した・直した直後に
    呼ぶ——**「あれば使う」で呼ぶこと**（読み込み順に依存させない）。 */
 window.WL=window.WL||{};
 /* `keys()`はコードが持っている既定の塊の一覧（§9.219 ②）。マスタの種と
    **食い違っていないこと**を網が突き合わせる——片方だけ増えると、マスタに
    出ない塊／画面に無い塊が黙って生まれる。 */
 /* **`keys`を2つ書かない**（§9.274）——同じオブジェクトに同じ名前を2度書くと
    後の方だけが残り、先に書いたほうは**一度も呼ばれない死んだコード**になる
    （`rpBlockKeys()`がそれだった。網が`keys()`で「自作の塊が候補に並ぶ」を
    見ていたので、**見ていたのはコードの既定の塊だけ**だった）。
    ここが答えるのは**コードが持っている既定の塊**（マスタの種と食い違って
    いないことを網が突き合わせる）。 */
 WL.reportBlocks={
  keys:()=>RP_BLOCKS.map(b=>b.k),
  /* いま紙に出せる塊ぜんぶ（既定＋自作）。`keys()`と**役が違う**ので名前も分ける。 */
  allKeys:()=>rpBlockKeys(),
  forget:()=>{rpUserBlocks=[];rpMasterRows=[];rpBuiltinOff=new Set();rpUserBlocksFor=null;
   /* 設備ごとの写しも一緒に捨てる（§9.239 ③）。片方だけ捨てると
      「マスタで直したのに紙が変わらない」が残る。 */
   rpBlocksByEq.clear()}};

 function ensurePanel(){
  let panel=$id('reportPanel');if(panel)return panel;
  panel=document.createElement('section');panel.className='rp-panel';panel.id='reportPanel';panel.hidden=true;
  /* A4縦をできるだけ大きく見せるため、操作類は1本のバーへ統合する。
     ボタンはアイコン化し、名称と補足はtitle(ツールチップ)で示す。
     表示設定(ラベルの出し方)は使用頻度が低いので左パネルの最下段へ置き、
     バーを薄いまま保つ。 */
  const icon=d=>`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  panel.innerHTML=`
   <header class="rp-bar">
    <button type="button" id="reportBack" class="rp-back-btn" title="元の一覧に戻ります">${icon('<polyline points="15 18 9 12 15 6"/>')}戻る</button>
    <div class="rp-bar-title" id="reportSelectedTitle">ロットを選択してください</div>
    <div class="rp-bar-actions">
     <div class="rp-zoom-seg" data-seg="rpOrientSeg" role="group" aria-label="用紙の向き">
      <button type="button" data-orient="portrait" title="A4縦（210×297mm）で作成します">縦</button>
      <button type="button" data-orient="landscape" title="A4横（297×210mm）で作成します。列の多い測定データ表が読みやすくなります">横</button>
     </div>
     <div class="rp-zoom-seg" data-seg="rpZoomSeg" role="group" aria-label="表示倍率">
      <button type="button" data-val="fit" class="active" title="ページ全体が収まる倍率">全体</button>
      <button type="button" data-val="width">幅</button>
      <button type="button" data-val="100">100%</button>
     </div>
     <span class="rp-zoom-readout" id="rpZoomReadout" title="Ctrlを押しながらホイールで拡大・縮小できます">100%</span>
     <button type="button" id="reportArrange" class="rp-icon-btn" title="帳票に出す塊・並び・幅をその場で組み換えます" aria-label="帳票の配置を変える">${icon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="4" rx="1"/><rect x="14" y="11" width="7" height="10" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>')}</button>
     <button type="button" id="reportNavToggle" class="rp-icon-btn" title="ロット一覧を隠して帳票を広く表示します" aria-label="ロット一覧の表示切替">${icon('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>')}</button>
     <button type="button" id="reportPrint" class="rp-icon-btn rp-icon-btn--primary" title="印刷する（帳票だけの1枚ものを組み立てて刷ります。刷り上がりがプレビューより小さいときは、印刷ダイアログの用紙をA4・倍率を100%（実際のサイズ）にしてください）" aria-label="印刷する" disabled>${icon('<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>')}</button>
     <button type="button" id="reportPdf" class="rp-icon-btn" title="PDFで保存する（印刷ダイアログが開きます。出力先で「PDFに保存」、用紙をA4・倍率を100%（実際のサイズ）にしてください）" aria-label="PDFで保存する" disabled>${icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>')}</button>
    </div>
   </header>
   <div class="rp-body">
    <nav class="rp-nav" aria-label="ロット一覧">
     <div class="rp-nav-toolbar">
      <label class="rp-search"><span class="rp-search-icon" aria-hidden="true">${icon('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>')}</span><input id="reportSearch" type="search" placeholder="ロット・設備で絞り込み" aria-label="ロット検索" autocomplete="off"></label>
      <select id="reportSort" aria-label="並び順">
       <option value="updated-desc">新しい順</option>
       <option value="updated-asc">古い順</option>
       <option value="lot-asc">ロット順</option>
      </select>
     </div>
     <div class="rp-lot-list" id="reportLotList"></div>
     <!-- 出していない塊の置き場（§9.217／§9.276 ①、利用者の指示
          「帳票ブロックは上部ではなく左サイドバーに変更し、説明文は
           ポップオーバーなど場所を取らない方法にしてください」）。
          **紙の外**なのは今までどおり（紙の中へ入れると刷り上がりに混ざる）。
          上の帯に横一列で置いていたときは、塊が増えるほど横スクロールに
          なり、しかも紙の高さをそのぶん削っていた。縦に積めば名前が
          そのまま読め、削るのは一覧の高さだけで済む。 -->
     <div class="rp-palette" id="rpPalette" hidden></div>
     <div class="rp-nav-foot rp-bulk-foot">
      <label class="rp-foot-selectall" title="表示中のロットをすべて選択/解除します"><input type="checkbox" id="reportSelectAll">全選択</label>
      <button type="button" id="reportBulkPrintBtn" class="rp-foot-btn rp-foot-btn--primary" disabled title="チェックした帳票をまとめて1回の印刷で出力します(1ロット1ページ)">選択した帳票を印刷 (<span id="reportBulkCount">0</span>)</button>
     </div>
     <div class="rp-nav-foot rp-display-foot">
      <span class="rp-foot-label">表示</span>
      <button type="button" id="reportLabelToggle" class="rp-foot-btn" title="条ごとのロット№・板幅公差のラベルを、連続する行でも毎回表示するか、変化した行だけに表示するかを切り替えます">ラベル: 毎行表示</button>
      <button type="button" id="reportDefectToggle" class="rp-foot-btn" title="異常位置判定モーダルで保存した判定を、帳票へ載せるかどうかを切り替えます（保存されていないロットには出ません）">異常位置判定: 載せる</button>
     </div>
    </nav>
    <section class="rp-main">
     <!-- 組み換え中だけ出る帯。**帯を紙の外に置く**——紙の中に置くと
          印刷物に混ざる危険があるうえ、A4の割り付けを崩す。 -->
     <div class="rp-arrange-bar" id="rpArrangeBar" hidden>
      <span class="rp-arrange-info"></span>
      <!-- **保存ボタンは持たない**（§9.303 ③、利用者の指示「保存ボタンは
           無くしバックグラウンドで常に保存するタイプに変更してほしい…
           帳票ブロックマスタに頻繁に移動…移動するたびに修正していた内容が
           飛ぶので現在の都度保存ボタンは使いづらい」）。触ったら裏で保存する
           ので、残すのは**終える**だけ。**黙って保存しない**（§3）——
           いまどうなっているかを隣に文字で出す。
           「既定に戻す」は取り消せない操作なので、主要動線から離して
           「⋯」の中へ置く（§CLAUDE 5）。 -->
      <span class="rp-arrange-act">
       <b class="rp-arrange-auto" id="rpArrangeAuto" title="組み換えの内容は触るたびに自動で保存します。帳票ブロックマスタへ移っても消えません。">自動で保存します</b>
       <button type="button" id="rpArrangeCancel" class="rp-bar-btn">組み換えを終える</button>
      </span>
      <!-- 「⋯」で開く小さな面。**帯の子のまま position:fixed で浮かせる**
           （テンプレートリテラルの中なのでバッククォートは書かない・§9.211 ③）
           ——body直下へ出すと「帯の中に在るか」を見る網が空振りする。 -->
      <div class="rp-bar-menu" id="rpArrangeMenu" hidden></div>
     </div>
     <div class="rp-scroll" id="rpScroll">
      <div class="rp-page-box" id="rpPageBox">
       <div class="rp-report rp-page" id="reportContent"><div class="rp-empty">左の一覧からロットを選ぶと、帳票プレビューがここに表示されます。</div></div>
      </div>
     </div>
    </section>
   </div>`;
  const grid=$id('grid');grid?.parentNode?.insertBefore(panel,grid);
  /* 配置設定は**描く前に読む**（読めなくても既定の並びで紙は出る）。 */
  WL.columnLayout.load(rpTarget()).catch(WL.quiet('列の設定を取れない（既定の並びで出す）'));
  const search=$id('reportSearch');if(search)search.oninput=()=>{rpState.query=search.value;renderLotList()};
  const sort=$id('reportSort');if(sort)sort.onchange=()=>{rpState.sort=sort.value;renderLotList()};
  $id('reportPrint').onclick=printReport;$id('reportPdf').onclick=printReport;
  $id('reportBack').onclick=backToRecordList;
  $id('reportLabelToggle').onclick=()=>{rpRepeatLabels=!rpRepeatLabels;updateLabelToggle();const cur=rpState.items.find(i=>i.id===rpState.selectedId);if(cur)renderReport(cur)};
  $id('reportDefectToggle').onclick=()=>{rpShowDefect=!rpShowDefect;updateDefectToggle();const cur=rpState.items.find(i=>i.id===rpState.selectedId);if(cur)renderReport(cur)};
  $id('reportSelectAll').onchange=e=>{
   const items=sortedFiltered();
   if(e.target.checked)items.forEach(x=>rpSelectedIds.add(x.id));else items.forEach(x=>rpSelectedIds.delete(x.id));
   renderLotList();
  };
  $id('reportBulkPrintBtn').onclick=printSelectedReports;
  panel.querySelectorAll('[data-seg="rpZoomSeg"] button').forEach(b=>b.onclick=()=>setZoom(b.dataset.val));
  panel.querySelectorAll('[data-seg="rpOrientSeg"] button').forEach(b=>b.onclick=()=>setOrientation(b.dataset.orient));
  $id('reportNavToggle').onclick=toggleNav;
  $id('reportArrange').onclick=toggleArrange;
  /* **保存ボタンは無い**（§9.303 ③）——触ったら`rpStage()`が裏で保存する。 */
  $id('rpArrangeCancel').onclick=()=>closeArrange();
  /* 「既定に戻す」は「⋯」の中（`updateArrangeBar`が組み立てて配線する）。 */
  applyOrientation();applyNavVisibility();
  window.addEventListener('resize',()=>{if(rpZoom==='fit')fitPage();else if(rpZoom==='width')fitWidth()});
  // Ctrl(⌘)+ホイールで拡大縮小。通常のホイールは一覧のスクロールを妨げないよう素通しする。
  $id('rpScroll').addEventListener('wheel',e=>{
   if(!e.ctrlKey&&!e.metaKey)return;
   e.preventDefault();
   rpZoom='custom';
   document.querySelectorAll('[data-seg="rpZoomSeg"] button').forEach(b=>b.classList.remove('active'));
   applyScale(rpCurrentScale*(e.deltaY<0?1.1:1/1.1));
  },{passive:false});
  updateLabelToggle();updateDefectToggle();
  return panel;
 }

 /* ---------- A4ページの表示倍率 ----------
    'fit'=ページ全体(縦横ともに収まるよう縮小)、'width'=表示エリアの幅に
    最大化(高さは超えてよく、縦スクロールで閲覧)、'100'=実寸、
    'custom'=Ctrl+ホイールによる任意倍率。印刷/PDF出力時はCSS側で
    transformを強制解除するため、画面上の倍率は出力に影響しない。 ---------- */
 function updateLabelToggle(){
  const b=$id('reportLabelToggle');if(!b)return;
  b.textContent=rpRepeatLabels?'ラベル: 毎行表示':'ラベル: 変化時のみ表示';
  b.classList.toggle('active',!rpRepeatLabels);
 }
 function updateDefectToggle(){
  const b=$id('reportDefectToggle');if(!b)return;
  b.textContent=rpShowDefect?'異常位置判定: 載せる':'異常位置判定: 載せない';
  b.classList.toggle('active',!rpShowDefect);
 }
 /* 異常位置判定(参考)。描画は defect-locator.js が持つ(モーダルの図と
    同じ計算・同じ配色を1箇所に置き、帳票側で作り直さないため)。
    保存されていないロットでは空文字が返るので、そのまま連結してよい。 */
 /* ---------- 長手方向（ピッチ）の入切は**塊の「紙に出す」へ移した**（§9.319-C）
    ----------
    §9.305 ②-2では「異常位置判定」の中の`長手:`という印で入切していたが、
    塊を2つに分けた以上、**同じことをする入口が2つ**になる（§9.207・
    §CLAUDE 8）。ふつうの塊と同じ「紙に出す」に一本化し、印は廃した。
    **既定は出す**——記録が無いロットでは1行も増えないので、いま刷っている
    紙は変わらない（§9.132）。 */
 const RP_DEFECT_KEY='異常位置判定';
 const RP_DEFECT_ROLL_KEY='ピッチ判定';
 /* ---------- 幅方向とピッチは**別の塊**（§9.319-C、利用者の指示） ----------
    「異常位置判定とピッチ判定のブロックを分けてほしいです」
    「印刷レイアウトでピッチ測定の場合、見切れが生じる不具合」

    以前は1つの塊で、ピッチを幅方向の節の中へ差し込んでいた。**器の高さは
    塊ごとに決まる**ので、幅方向の図に合わせた高さのままピッチだけの中身を
    入れると、背丈がまるで違って`overflow:hidden`に切り落とされる。
    分ければ高さはそれぞれの中身から決まる（`rpFitRows()`が測る）。 */
 /* ---------- 欄の見せ方は塊の設定が決める（§9.323 ④、利用者の指示） ----------
    「ピッチ判定の部分ラベルの上下や横位置や列数が半自動になっていますが、
     ここもユーザーが選んでカスタムを正しくできるように」

    §9.320-Fは**器の幅で自動**に切り替えていた（「設定を置いても当てる先が
    無い」と書いてあった）。**その前提を本当にした**——コードが描く塊にも
    帳票ブロックマスタの設定（列数・ラベル位置・揃え）を渡す。
    **渡すだけで、当て方はCSSが持つ**（§9.163）。未設定なら今までどおり
    器の幅なり（§9.132）。 */
 function defectSection(x,opt){
  if(!rpShowDefect)return '';
  const d=window.WL&&WL.defect;
  if(!d||!d.reportSectionHtml)return '';
  return d.reportSectionHtml(x,opt)||'';
 }
 function defectRollSection(x,opt){
  if(!rpShowDefect)return '';
  const d=window.WL&&WL.defect;
  if(!d||!d.rollSectionHtml)return '';
  return d.rollSectionHtml(x,opt)||'';
 }
 /* ---------- 用紙の向き（A4縦 / A4横） ----------
    横向きは列の多い測定データ表(板幅ほか15列)に効く。用紙寸法はCSSの
    .rp-landscape で入れ替え、印刷側は @page の size を差し替える。@page は
    クラスで切り替えられないため、専用の<style>を書き換える方式にする
    (app.css側の既定 @page より後に挿入されるため、こちらが優先される)。
    向きは端末ごとの表示設定として保持する。 */
 const RP_ORIENT_KEY='WaveLogReportOrientationV1';
 let rpOrientation=(()=>{try{return localStorage.getItem(RP_ORIENT_KEY)==='landscape'?'landscape':'portrait'}catch(e){return 'portrait'}})();
 /* ---------- 紙の余白は**0**（§9.243、利用者の指摘「アプリ内の印刷プレビューと
       WINDOWSのプレビューに違いが出ています…用紙に対して80％くらいの比率と
       共に表示内容のクオリティも下がっている」） ----------
    §9.242 ⑦で`90-state.css`の`@page`を`margin:0`にしたのに、**ここが`5mm`の
    ままだった**。この`<style>`は`<head>`の末尾へ挿すので後から読まれ、
    **こちらが勝つ**——版面が 200×287mm になり、紙（`.rp-page`＝210×297mm）が
    はみ出す。はみ出すとブラウザは**全体を縮めて版面へ収める**ので、
    プレビューと比率が変わり、そのぶん文字も潰れる（＝報告そのもの）。

    **`RP_PAGE_MARGIN`はここ1箇所**で、`90-state.css`の保険（JSが動く前・
    差し替えが間に合わなかったとき用）と**必ず同じ値にする**。食い違うと、
    後ろに読まれた側が黙って勝つ——2枚あることが問題なのではなく、
    **違う値の2枚がある**ことが問題（`tests/test_rpprint.js`が突き合わせる）。 */
 const RP_PAGE_MARGIN='0';
 /* 紙の余白（`.rp-page{padding:8mm}`と同じ数）。**2箇所に書かない**
    ——収まりの判定（§9.281）が中身の下端へ足すのはこのぶん。 */
 const RP_PAGE_PAD_MM=8;
 /* 紙と紙のあいだの余白（§9.281 の追補、利用者の指示「各ページ間は完全な
    背景と同じ色の余白が欲しいです。よくある印刷プレビューの作りです」）。
    **色は指定しない**——紙を透かして`.rp-scroll`の地をそのまま見せるので、
    背景色が変わっても必ず同じ色になる（2箇所に色を書かない）。 */
 const RP_SHEET_GAP_MM=10;
 /* ページに割ったときの**ずらし量を答えるのは1箇所**（§9.282）。
    塊・空きマスの印・落とし先のゴースト・カーソルの座標が同じ答えを見る
    ——別々に持つと「掴んだ場所と落ちる場所がずれる」が作れる。
    単位は**拡大前のpx**（`--rp-scale`を掛ける前）。割っていなければ0。

    **控えないこと**（§9.283、利用者の報告「D&Dすると位置座標が無茶苦茶で
    とんでもない場所にいってしまいます」）——以前は塗ったとき（`rpPaintPages`）の
    値をモジュール変数へ控えていた。控えると、**上の帯の高さ・段数・マス数・
    紙の向きが変わった瞬間に古くなる**（そのどれも塗り直しを伴わない経路がある）。
    古い物差しで数えた行は本物と何行でもずれうるので、**そのつど測る**。
    塗る側も同じここを通るので、塗った位置と数えた位置が食い違わない（§9.163）。 */
 function rpPageMetrics(){
  const z={gap:0,sheet:0,gridTop:0,rowStep:0,paged:false};
  const page=$id('reportContent');
  if(!page||!page.classList)return z;
  const grid=page.querySelector('.rp-blocks');
  if(!grid)return z;
  const cs=getComputedStyle(page),gcs=getComputedStyle(grid);
  const sc=Number(cs.getPropertyValue('--rp-scale'))||1;
  const pr=page.getBoundingClientRect();
  /* **1行ぶんの高さと器の位置は、割っていなくても答える**（§9.283）
     ——ここを0で返すと、呼ぶ側が`step||1`のような受けをして
     **座標がそのまま行の番号になる**（実測: 空きマスの枠が44→1620個）。
     割っているかどうかで変わるのは`gap`／`sheet`だけ。 */
  const rowStep=(parseFloat(gcs.gridAutoRows)||0)+(parseFloat(gcs.rowGap)||0);
  if(!(rowStep>0))return z;
  const gridTop=(grid.getBoundingClientRect().top-pr.top)/sc;
  const land=page.classList.contains('rp-landscape');
  const pxPerMm=(pr.width/(sc||1))/(land?297:210);
  if(!page.classList.contains('rp-paged')||!(pxPerMm>0))
   return {gap:0,sheet:0,gridTop,rowStep,paged:false};
  return {gap:RP_SHEET_GAP_MM*pxPerMm,sheet:(land?210:297)*pxPerMm,
    gridTop,rowStep,paged:true};
 }
 /* ずらす前のy（紙の上端から） → 何枚目の紙か × 余白 */
 const rpShiftAt=(m,y)=>(m.gap>0&&m.sheet>0)
   ?Math.max(0,Math.floor(y/m.sheet+1e-6))*m.gap:0;
 /* **ずらすのは「行」の単位**（§9.282）。塊もゴーストも空きマスの印も
    グリッドの行の頭から始まるので、**行がどの紙に乗るか**で決めれば
    3つとも必ず同じ答えになる。カーソルの座標だけを紙で割ると、
    **紙をまたぐ行**（頭は1枚目・裾は2枚目）で答えが食い違い、
    掴んだ場所と落ちる場所がずれる（実測: 指した312.6mmに対して枠は295.2mm）。 */
 const rpRowShiftM=(m,r)=>rpShiftAt(m,m.gridTop+Math.max(0,r)*m.rowStep);
 /* 描かれているグリッド内のy → その位置に見えている「行」（0から数える）。
    **行の見た目の上端で数える**——`r*行の高さ + その行のずらし量`は`r`に対して
    必ず増えるので、そこから逆に辿れば必ず1つに決まる。
    **「ずらす前のyへ直してから割る」で数えないこと**（§9.282）——紙と紙の
    あいだ（**どの行も無い場所**）に落ちた点は、直した先が1つ手前の行の中に
    なり、**戻した行のずらし量と食い違う**（実測: 指した312.6mmに対して枠が
    295.2mm。1pxの差で出るので、境目を狙わない網では捕まらない）。
    余白の中は**次の紙の先頭の行へ寄せる**——手前へ寄せると、枠がカーソルより
    紙1枚ぶん上に出る。 */
 const rpRowTopM=(m,r)=>Math.max(0,r)*m.rowStep+rpRowShiftM(m,r);
 function rpRowAtGridM(m,gy){
  const step=m.rowStep;
  if(!(m.gap>0&&step>0))return Math.max(0,Math.floor(gy/Math.max(1,step)));
  let r=Math.max(0,Math.floor(gy/step));          /* ずらしぶん必ず本物以上 */
  while(r>0&&rpRowTopM(m,r)>gy)r--;
  while(rpRowTopM(m,r+1)<=gy)r++;
  /* 行の裾より下＝紙と紙のあいだ。次の紙の頭へ。 */
  if(gy>=rpRowTopM(m,r)+step&&rpRowTopM(m,r+1)>rpRowTopM(m,r)+step)r++;
  return r;
 }
 /* **「行の頭に置かれている座標」から行を出すのは別の関数**（§9.283）。
    カーソルは「その点を含む行」なので切り捨てでよいが、塊や印の上端は
    **その行の頭ちょうど**なので、切り捨てると端数で1行上に落ちる
    （実測: 4行目の塊が`3.9998`で3行目と数えられ、**下の1行が空きに見えて
    「空き」の枠が1619個**出た）。近い行へ丸めてから、ずらしぶんを戻す。 */
 function rpRowOfTop(m,gy){
  const step=m.rowStep;
  if(!(step>0))return 0;
  if(!(m.gap>0))return Math.max(0,Math.round(gy/step));
  let r=Math.max(0,Math.round(gy/step));           /* ずらしぶん必ず本物以上 */
  while(r>0&&rpRowTopM(m,r)>gy+0.5)r--;
  return r;
 }
 /* **呼ぶ側は`rpPageMetrics()`を1回取って`*M`へ渡すこと。** 引数無しの
    薄い包み（`rpRowShift(r)`のような形）は置かない——1行数えるたびに
    測り直すことになり、`rpRowAtGridM()`の中の走査で何十回も測る。 */
 /* `@page`は**用紙の名前でなく実寸mm**で頼む（§9.252・§9.332）。
    この紙はA4だけなので`size:A4`でも同じ絵になるが、**名前で頼む書き方が
    残っていると、用紙を1つ足したときにそこだけ既定のA4で刷られる**
    （作業予定表がB4でまさにそれを踏んだ）。作り方は`WL.paper`の1箇所。 */
 function updatePageSizeStyle(){
  WL.paper.applyPageStyle('rpPageSizeStyle',
   'a4-'+(rpOrientation==='landscape'?'landscape':'portrait'),null,RP_PAGE_MARGIN);
 }
 function applyOrientation(){
  const page=$id('reportContent');
  if(page)page.classList.toggle('rp-landscape',rpOrientation==='landscape');
  document.querySelectorAll('[data-seg="rpOrientSeg"] button')
   .forEach(b=>b.classList.toggle('active',b.dataset.orient===rpOrientation));
  updatePageSizeStyle();
  /* 測定データ表の組み方が向きで変わる(横は2ブロック)ため、描画済みなら作り直す。 */
  const cur=rpState.items.find(i=>i.id===rpState.selectedId);
  if(cur)renderReport(cur);
  /* 用紙の縦横が変わると収まる倍率も変わるため、現在の指定で計算し直す。 */
  if(rpZoom==='fit')fitPage();else if(rpZoom==='width')fitWidth();else applyScale(rpCurrentScale);
 }
 /* ロット一覧の表示切替。A4横は倍率が「幅」で決まるため、一覧を畳むと
    そのぶん帳票が大きくなる(実測 77%→98%)。縦は高さで決まるので倍率は
    変わらないが、余白が減って見やすくなる。 */
 const RP_NAV_KEY='WaveLogReportNavHiddenV1';
 let rpNavHidden=(()=>{try{return localStorage.getItem(RP_NAV_KEY)==='1'}catch(e){return false}})();
 /* 組み換えのあいだだけこちらで開いたかどうか（§9.276 ①）。**覚え
    （localStorage）は触らない**——利用者が畳んでいた状態を勝手に変えない。 */
 let rpNavWasHidden=false;
 function applyNavVisibility(){
  const body=$id('reportPanel')?.querySelector('.rp-body');
  if(body)body.classList.toggle('rp-nav-hidden',rpNavHidden);
  const btn=$id('reportNavToggle');
  if(btn){
   btn.classList.toggle('active',rpNavHidden);
   btn.title=rpNavHidden?'ロット一覧を表示します':'ロット一覧を隠して帳票を広く表示します';
  }
  if(rpZoom==='fit')fitPage();else if(rpZoom==='width')fitWidth();
 }
 function toggleNav(){
  rpNavHidden=!rpNavHidden;
  /* **利用者が自分で押したら、こちらの都合の控えは捨てる**（§9.276 ①）
     ——組み換えのあいだにわざわざ畳んだ／開いた人に対して、抜けるときに
     元へ戻すのは「押しても戻される」になる。 */
  rpNavWasHidden=false;
  try{localStorage.setItem(RP_NAV_KEY,rpNavHidden?'1':'0')}catch(e){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',e)}
  applyNavVisibility();
 }
 function setOrientation(v){
  const next=v==='landscape'?'landscape':'portrait';
  if(next===rpOrientation)return;
  rpOrientation=next;
  try{localStorage.setItem(RP_ORIENT_KEY,rpOrientation)}catch(e){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',e)}
  applyOrientation();
 }
 function setZoom(v){
  rpZoom=v;
  document.querySelectorAll('[data-seg="rpZoomSeg"] button').forEach(b=>b.classList.toggle('active',b.dataset.val===v));
  if(v==='fit')fitPage();else if(v==='width')fitWidth();else applyScale(1);
 }
 /* 拡大率は**カスタムプロパティで渡す**(transform/width/heightを直接書かない)。
    インラインstyleはCSSのどのレイヤより強いので、直接書くと印刷用の
    「等倍で出す」指定が効かず、打ち消すために !important が必要になっていた。
    値だけをインラインで渡し、その値をどう使うかはCSS側に残す。 */
 function applyScale(scale){
  const box=$id('rpPageBox'),page=$id('reportContent');if(!box||!page)return;
  scale=Math.max(.25,Math.min(3,scale));
  rpCurrentScale=scale;
  const pw=page.offsetWidth,ph=page.offsetHeight;
  page.style.setProperty('--rp-scale',scale);
  if(pw&&ph){
   box.style.setProperty('--rp-box-w',`${pw*scale}px`);
   box.style.setProperty('--rp-box-h',`${ph*scale}px`);
  }
  const readout=$id('rpZoomReadout');if(readout)readout.textContent=`${Math.round(scale*100)}%`;
 }
 function resetPageScale(){
  const box=$id('rpPageBox'),page=$id('reportContent');if(!box||!page)return;
  page.style.removeProperty('--rp-scale');
  box.style.removeProperty('--rp-box-w');box.style.removeProperty('--rp-box-h');
 }
 function fitPage(){
  if(rpZoom!=='fit')return;
  const scroll=$id('rpScroll'),box=$id('rpPageBox'),page=$id('reportContent');
  if(!scroll||!box||!page)return;
  resetPageScale();
  requestAnimationFrame(()=>{
   if(rpZoom!=='fit')return;
   const pw=page.offsetWidth,ph=page.offsetHeight;if(!pw||!ph)return;
   const availW=Math.max(60,scroll.clientWidth-44),availH=Math.max(60,scroll.clientHeight-44);
   const scale=Math.max(.1,Math.min(availW/pw,availH/ph,1));
   applyScale(scale);
  });
 }
 function fitWidth(){
  if(rpZoom!=='width')return;
  const scroll=$id('rpScroll'),box=$id('rpPageBox'),page=$id('reportContent');
  if(!scroll||!box||!page)return;
  resetPageScale();
  requestAnimationFrame(()=>{
   if(rpZoom!=='width')return;
   const pw=page.offsetWidth;if(!pw)return;
   const availW=Math.max(60,scroll.clientWidth-44);
   const scale=Math.max(.1,availW/pw);
   applyScale(scale);
  });
 }

 function searchText(x){return [x.basic?.lotNo,x.basic?.inspectionNo,x.basic?.castingNo,x.basic?.orderNo,x.settings?.registeredEquipment,x.registeredEquipment,x.status].map(v=>String(v||'').normalize('NFKC').toLowerCase()).join(' ')}
 function sortedFiltered(){
  const q=String(rpState.query||'').normalize('NFKC').toLowerCase();
  let items=rpState.items.filter(x=>!q||searchText(x).includes(q));items=[...items];
  if(rpState.sort==='updated-asc')items.sort((a,b)=>String(a.updatedAt||'').localeCompare(String(b.updatedAt||'')));
  else if(rpState.sort==='lot-asc')items.sort((a,b)=>String(a.basic?.lotNo||'').localeCompare(String(b.basic?.lotNo||''),'ja'));
  else items.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  return items;
 }

 /* 一括印刷ボタンの有効/disabled・件数表示・「全選択」チェックボックスの
    tri-state(表示中の一部だけ選択されている場合は中間状態)を更新する。 */
 function updateBulkPrintButton(){
  const items=sortedFiltered(),btn=$id('reportBulkPrintBtn'),count=$id('reportBulkCount'),selectAll=$id('reportSelectAll');
  if(!btn||!count)return;
  const n=rpSelectedIds.size;
  count.textContent=String(n);btn.disabled=n===0;
  if(selectAll&&items.length){
   const checkedInView=items.filter(x=>rpSelectedIds.has(x.id)).length;
   selectAll.checked=checkedInView===items.length;
   selectAll.indeterminate=checkedInView>0&&checkedInView<items.length;
  }else if(selectAll){selectAll.checked=false;selectAll.indeterminate=false}
 }
 function renderLotList(){
  const list=$id('reportLotList');if(!list)return;
  const items=sortedFiltered();
  if(!items.length){
   list.innerHTML=rpState.items.length?'<div class="rp-empty"><b>検索条件に一致するロットがありません。</b><button id="rpEmptyClearSearch" type="button">検索条件を解除</button></div>':'<div class="rp-empty">端末に保存されたロットがありません。測定画面で保存すると一覧に表示されます。</div>';
   const clearBtn=$id('rpEmptyClearSearch');
   if(clearBtn)clearBtn.onclick=()=>{rpState.query='';const search=$id('reportSearch');if(search)search.value='';renderLotList()};
   updateBulkPrintButton();return;
  }
  const frag=document.createDocumentFragment();
  items.forEach(x=>{
   const equipment=x.settings?.registeredEquipment||x.registeredEquipment||x.snapshot?.registeredEquipment||'-';
   /* 一括印刷用のチェックボックスと、プレビュー選択用のボタンを分ける
      (ボタンの中へinputをネストするのはアクセシビリティ・仕様上避ける)。 */
   const row=document.createElement('div');row.className='rp-lot-row'+(x.id===rpState.selectedId?' active':'');
   const checked=rpSelectedIds.has(x.id);
   row.innerHTML=`<label class="rp-lot-check" title="一括印刷の対象に含めます" onclick="event.stopPropagation()"><input type="checkbox"${checked?' checked':''}></label><button type="button" class="rp-lot-main-btn"><span class="rp-lot-main"><b title="${esc(x.basic?.lotNo||x.id)}">${esc(x.basic?.lotNo||x.id)}</b><em class="rp-status-badge ${WL.base.statusClass(x.status)}">${esc(WL.base.statusLabel(x.status))}</em></span><span class="rp-lot-sub" title="${esc(equipment)}">${esc(equipment)}・${esc(x.basic?.inspectionNo||'-')}</span><span class="rp-lot-date">${esc(fmtDT(x.updatedAt))}</span></button>`;
   row.querySelector('.rp-lot-check input').onchange=e=>{
    if(e.target.checked)rpSelectedIds.add(x.id);else rpSelectedIds.delete(x.id);
    row.classList.toggle('checked',e.target.checked);updateBulkPrintButton();
   };
   const mainBtn=row.querySelector('.rp-lot-main-btn');
   mainBtn.onclick=()=>selectLot(x.id);
   mainBtn.ondblclick=e=>{e.preventDefault();e.stopPropagation();if(typeof WL.records.resumeRecordFromList==='function')WL.records.resumeRecordFromList(x)()};
   frag.append(row);
  });
  list.innerHTML='';list.append(frag);
  updateBulkPrintButton();
 }
 /* ---------- 帳票の一括印刷 ----------
    選択した複数ロットをまとめて1回の印刷ダイアログで出力する。既存の
    単一プレビュー(#reportContent/rpPageBox)は画面表示・ズーム操作の
    状態を持つため、それを一切崩さないよう、印刷専用の別コンテナ
    (#reportBulkPrintArea)へロットごとに.rp-pageを生成して流し込み、
    画面上は隠したまま@media printでのみ表示する。 */
 function ensureBulkPrintArea(){
  let el=$id('reportBulkPrintArea');if(el)return el;
  el=document.createElement('div');el.id='reportBulkPrintArea';el.className='rp-bulk-print-area';
  document.body.appendChild(el);return el;
 }
 function printSelectedReports(){
  const items=rpState.items.filter(x=>rpSelectedIds.has(x.id));
  if(!items.length)return;
  const area=ensureBulkPrintArea();
  /* **設備ごとの設定は組み立てる前に読み終えておく**（§9.239 ③／§9.235 ⑤
     「取得はなり代わるより前に済ませる」）。読んでいないと
     `WL.columnLayout.get()`が空を返し、**選んでいる設備以外のロットは
     コードの既定で刷られる**（保存した配置が効かない）。 */
  const need=[...new Set(items.map(rpTargetOf))];
  const eqs=[...new Set(items.map(x=>rpEquipmentOf(x)||''))];
  Promise.all([...need.map(t=>WL.columnLayout.load(t).catch(WL.quiet('列の設定を取れない（既定の並びで出す）'))),
               ...eqs.map(eq=>rpLoadUserBlocks(eq).catch(WL.quiet('自作の塊を取れない（コードの既定の塊で出す）')))])
   .then(()=>bulkPrintNow(items,area))
   .catch(()=>bulkPrintNow(items,area));
 }
 /* ---------- 外から「選んだ記録の帳票をまとめて刷る」（§9.241 ③） ----------
    実績データリストから呼ぶ。**組み立ては既存の1本**（`printSelectedReports`
    と同じ道）を通す——別に持つと、設備ごとの設定の読み込み（§9.239 ③）や
    1枚ずつの測り直し（§9.174）を片方だけ直した状態が作れる。
    **端末に無い記録はサーバーから1件ずつ取り込む**（`fetchRecordFromBackup`）
    ——実績は共有された記録なので、その端末で測っていないものが普通にある。 */
 async function bulkPrintByIds(ids){
  const want=[...new Set((ids||[]).map(String))];
  if(!want.length)return;
  await openReportView();
  const missing=want.filter(id=>!rpState.items.some(x=>String(x.id)===id));
  if(missing.length){
   const got=(await Promise.all(missing.map(id=>fetchRecordFromBackup(id).catch(()=>null))))
    .filter(Boolean);
   if(got.length){rpState.items=[...got,...rpState.items];renderLotList()}
  }
  const found=want.filter(id=>rpState.items.some(x=>String(x.id)===id));
  if(!found.length){
   showToast&&showToast('帳票を刷れませんでした',
     '選んだ記録がこの端末にも測定バックアップにも見つかりませんでした。',6000);
   return;
  }
  /* **見つからなかったぶんは黙って落とさない**（§CLAUDE 4）。 */
  if(found.length<want.length)
   showToast&&showToast(`${want.length-found.length}件は見つかりませんでした`,
     `${found.length}件だけ刷ります。`,5200);
  rpSelectedIds=new Set(found);
  renderLotList();
  printSelectedReports();
 }
 window.WL=window.WL||{};
 WL.report={bulkPrint:bulkPrintByIds};
 /* 測定した値の統計（§9.242 ⑨）。**引き口を1つ出す**——値の作り方は
    ここが持ち、選べる綴りはサーバー（`report_block_repo.STAT_*`）が持つ。
    外へ出すのは「1つの道を引く」だけで、内部の表は渡さない。 */
 WL.reportStat=(x,path)=>rpValueAt(x,path);
 /* ロットごとの統計と、その表そのもの（§9.244）。**網はここを直に呼ぶ**
    ——紙に出す/出さないの状態に左右されずに「値が分かれているか」を見たい。
    **素の`window.*`を増やさない**（CLAUDE.md「新規公開は名前空間経由」）。 */
 WL.reportStat.lots=x=>rpStat(x).byLot||[];
 WL.reportStat.tableHtml=(x,k)=>statSection(x,k||RP_STAT_BLOCK);
 /* **鍵は関数で返す**——`RP_STAT_BLOCK`はこの行より後ろで宣言される`const`
    なので、ここで値として読むと読み込み時に落ちる（TDZ。ファイル全体が
    動かなくなり、画面が組み上がらない）。 */
 WL.reportStat.blockKey=()=>RP_STAT_BLOCK;
 /* 子ロットごとの繰り返し（§9.247 ②）。**網は「紙になる節そのもの」を見る**
    ——値を1つ引くだけの口を見ても、繰り返しが効いているかは分からない
    （`rpFieldsSection`が実際に紙を組む1本なので、そこを通す）。
    `repeatLots`は「何回・どの子ロットで描くか」の答えで、
    `sectionHtml`は塊1つぶんの紙。 */
 WL.reportStat.repeatLots=(x,on)=>rpRepeatLots(x,!!on);
 WL.reportStat.sectionHtml=(x,name,fields,cols,repeat,repeatDir)=>
   rpFieldsSection(x,name,fields||[],cols||0,repeat||'',repeatDir||'');
 /* エリアの塊（§9.234 ⑤）。**帳票ブロックマスタの見本もここを通す**
    （§9.163。2つ目の組み立てを持つと、盤で見た枠と紙の枠が食い違う）。 */
 WL.reportStat.areaHtml=t=>rpAreaHtml(t==null?'':String(t));
 /* 節そのものを組む1本（§9.279）。**網はここを直に呼ぶ**——内訳の列数を
    空にしたときの形は、塊を保存しないと確かめられないでは網が重くなる。 */
 WL.reportSectionHtml=(title,rows,cols)=>reportSection(title,rows||[],cols||0);
 /* 用紙の切れ目を引き直す（§9.281）。**網はここを直に呼ぶ**——塊を減らした
    ときに「1枚へ戻る」ことは、実際に測り直させないと確かめられない。 */
 WL.reportSheets=()=>rpUpdateSheets();
 /* 余白の詰めと縮めを測り直す（§9.298）。**網はここを直に呼ぶ**——
    「詰めを止めたら文字が小さくなる」は、実際に測り直させないと
    確かめられない（宣言を見るだけの網は素通りする・§9.289）。 */
 WL.reportFit=()=>rpFitAll();

 function bulkPrintNow(items,area){
  area.innerHTML=items.map(x=>`<div class="rp-report rp-page${rpOrientation==='landscape'?' rp-landscape':''}">${reportHtml(x)}</div>`).join('');
  document.body.classList.add('rp-bulk-print');
  const prevTitle=document.title;
  document.title=`測定帳票_${items.length}件`;
  let cleaned=false;
  const cleanup=()=>{
   if(cleaned)return;cleaned=true;
   document.body.classList.remove('rp-bulk-print');
   document.title=prevTitle;area.innerHTML='';
   window.removeEventListener('afterprint',cleanup);
  };
  window.addEventListener('afterprint',cleanup);
  // 描画が反映されるのを待ってから印刷ダイアログを開く(同期的に呼ぶと白紙になる)。
  // **行の割り付けもここで当てる**(§9.217)——測ってからでないと、跨ぎの
  // 効いていない紙が刷られる。
  /* **測り直しも1枚ずつその紙の設備で**（§9.239 ③）。`rpFitAll()`は
     全ページをまとめて回すので、そのままだと最後に組み立てたロットの
     設備で行高が解かれる（§9.174の罠の後半）。 */
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
   const pages=[...area.querySelectorAll('.rp-page')];
   pages.forEach((h,i)=>{
    const x=items[i];
    if(!x){try{rpFitPage(h)}catch(e){WL.quiet.note('紙の割り付けを測り直せない（前の寸法のまま出る）',e)}return}
    rpWithLot(x,()=>{try{rpFitPage(h)}catch(e){console.warn('帳票の割り付けに失敗',e)}});
   });
   /* 画面のプレビューは選んでいるロットのままで測る。 */
   const own=$id('reportContent');
   if(own){try{rpFitPage(own)}catch(e){WL.quiet.note('紙の割り付けを測り直せない（前の寸法のまま出る）',e)}}
   /* **1枚ずつと同じ道**（§9.244）——ここだけ`window.print()`のままにすると、
      「1枚なら合うのに一括だけ縮む」という分かりにくい形になる（§9.242 ⑦で
      箱の作り方を揃えたのと同じ理由）。測り終わったDOMをそのまま渡す。 */
   const html=pages.map(rpPageHtmlFor).join('');
   rpPrintPages(html,document.title).then(cleanup,cleanup);
  }));
 }

 /* 節の中身。`rows`は`[ラベル,値]`か`[ラベル,値,{span,rows,blank}]`（§9.245）。
    **列数はいつも`--rp-cols`で渡す**（§9.289、利用者の報告「帳票ブロック
    マスタで調整する列数が全く効いておらず…5列にしようとしたところ、
    プレビューは2列、紙レイアウトの方のプレビューも2列」）。以前は
    マス数を持つ行があるときだけ`--rp-cols`で、無ければ`rp-grid-N`という
    クラスに落としていたが、**CSSには`1`と`4`の規則しか無かった**ので、
    選べる12通りのうち`3`と`5`〜`12`は**既定の2列で刷られていた**
    （§9.233 ③と同じ「選択肢を1つ足すたびにCSSを書き足す」作り。
    足し忘れた側だけが静かに壊れる）。数を答えるのは下の`n`の1箇所で、
    **クラスへ数を焼き込まないこと**。
    §9.255 ②で**縦のマス数**（`rows`）も持てるようにした（利用者の指示
    「単純に何列何行だけでなく、データ内もグリッドに対応する形で細かく
    調整できるように」）。縦に伸ばした項目の隣が空くので、**詰め方は
    `dense`**——空いたマスへ後ろの1マスの項目が入る（そこも空けたいときは
    「空きマス」を置く）。 */
 /* 内訳の列数が空のとき、**マスの並びから何列かを当てる**（§9.279、利用者の
    報告「保存した設定と帳票レイアウト(プレビュー)が合っていません」）。
    欄の説明は「空欄なら**中身の数から決まります**」と約束しているのに、紙は
    いつも2列に落ちていた——**表に組んだ塊が2列に潰れる**ので、見出しと値が
    総崩れになる（利用者の画像がまさにこれ）。
    当て方は「その列数で**すき間なく敷き詰められるか**」を1つずつ試すだけ
    ——表に組んだ形は必ずぴったり埋まるので、いちばん小さい列数が答え。
    **埋まらなければ0を返す**（当てずっぽうで並べない。呼ぶ側が2列へ落とす）。 */
 function rpPackFits(rows,n){
  const occ=[];let r=0,c=0;
  const at=(rr,cc)=>(occ[rr]&&occ[rr][cc])||0;
  const put=(rr,cc)=>{occ[rr]=occ[rr]||[];occ[rr][cc]=1};
  for(const row of rows){
   const o=(row&&row[2])||{};
   const sp=Math.max(1,Math.min(n,Number(o.span)||1));
   const tall=Math.max(1,Math.min(12,Number(o.rows)||1));
   let guard=0;
   while(guard++<400){
    while(c<n&&at(r,c))c++;
    if(c+sp>n){r++;c=0;continue}
    break;
   }
   if(guard>=400)return false;
   for(let i=0;i<tall;i++)for(let j=0;j<sp;j++)put(r+i,c+j);
   c+=sp;
  }
  /* **どの段もぴったり埋まっていること**——1つでも欠けていれば、その列数では
     見出しと値がずれる（＝この形ではない）。 */
  for(let rr=0;rr<occ.length;rr++){
   let filled=0;
   for(let cc=0;cc<n;cc++)if(at(rr,cc))filled++;
   if(filled!==n)return false;
  }
  return occ.length>0;
 }
 /* **当てられるときだけ当てる**（§9.279／§9.280）。「すき間なく埋まる」だけ
    では決まらない——マスの合計が3でも5でも割り切れることがあり、**小さいほうを
    選ぶと見出しがずれる**（実際に5列の表が3列と判定された）。だから探さずに、
    **盤が組んだ形をそのまま読む**（§9.280、利用者の報告「帳票ブロックでの
    表示が正です」）:

      左上は**空きマス**で、`横`＝行の見出しの本数(R)・`縦`＝見出しの段数(H)。
      そのあとに**見出しの段**が続き、段の合計は必ず `H×(n−R)` になる。
      よって **n = R + （見出しの段の横幅の合計）÷ H**。

    見出しの段と**行の見出し**の見分けは`寄せ`——盤は段の見出しに寄せを
    与えず（＝中央）、行の見出しには必ず`左`を与える。**幅で見分けないこと**
    （§9.280）——以前は「同じ幅の見出しが続くあいだ」で数えており、
    ①段が1つのとき（`行=項目／列=集計`＝**いちばん多い形**）は行の見出しまで
    数えてしまうので当てるのを諦めていた ②段が2つでも内側の軸が1個だと
    段1と段2の幅が同じになり数えすぎる、の2つで外れていた。
    **最後に必ず敷き詰められるか確かめる**（外れたら0＝呼ぶ側が2列へ落とす）。 */
 function rpDeriveCols(rows){
  const at=i=>(rows[i]&&rows[i][2])||{};
  const corner=at(0);
  if(!corner.blank)return 0;
  const R=Math.max(1,Number(corner.span)||1);
  const H=Math.max(1,Number(corner.rows)||1);
  /* 先頭から続く見出しのマス。`寄せ`を持つものは**行の見出し**（盤は必ず
     `左`を与える）なので、そこから先は段ではない。 */
  const run=[];
  for(let i=1;i<rows.length;i++){
   const x=at(i);
   if(!x.head)break;
   run.push({w:Math.max(1,Number(x.span)||1),named:!!(x.align||'')});
  }
  let sum=0,k=0;
  while(k<run.length&&!run[k].named){sum+=run[k].w;k++}
  if(!sum||sum%H)return 0;
  const n=R+sum/H;
  /* **最後に必ず敷き詰められるか確かめる**——外れたら0を返し、呼ぶ側が
     今までどおり2列へ落とす（当てずっぽうで並べない）。
     **「敷き詰まる形を探す」ことはしない**（§9.279）——合計が3でも5でも
     割り切れることがあり、探すと**見出しがずれた形を選びうる**。 */
  return (n>=2&&n<=12&&rpPackFits(rows,n))?n:0;
 }
 function reportSection(title,rows,cols){
  /* 「マトリクスとして組む」のは、1マスでない行か空きマスがあるときだけ。 */
  const matrix=rows.some(r=>r&&r[2]&&((Number(r[2].span)||1)>1
    ||(Number(r[2].rows)||1)>1||r[2].blank||r[2].head));
  /* **欄に数が入っていればそれが持ち主**（§CLAUDE 8）。空のときだけ当てる
     ——ふつうの「ラベル＝値」の並びは今までどおり2列（現場の紙を変えない）。
     **「欄の数が並びと合わないなら並びを正とする」はやらない**（§9.280）
     ——たまたま敷き詰まってしまう数があるので網で守れず、しかも見本
     （盤）と紙は同じこの1本を通るので、欄に従うかぎり**2つは必ず一致する**。
     欄が古いままなら「表に組む」で入れ直せば両方が直る。 */
  const want=Math.max(0,Math.min(12,Number(cols)||0));
  const n=Math.max(1,want||(matrix?(rpDeriveCols(rows)||2):2));
  /* 寄せは`@layer utility`の`.al-*`（§9.239 ④）——一覧と同じ1組を使う
     （帳票だけ別の綴りを作らない）。 */
  const AL={left:' al-l',center:' al-c',right:' al-r'};
  const cell=([label,value,o])=>{
   const span=Math.max(1,Math.min(n,Number(o&&o.span)||1));
   const tall=Math.max(1,Math.min(12,Number(o&&o.rows)||1));
   const st=matrix?` style="grid-column:span ${span}${tall>1?`;grid-row:span ${tall}`:''}"`:'';
   /* 空きマスは**中身を持たない**（場所を取るのが役目）。 */
   if(o&&o.blank)return `<div class="rp-field rp-field-blank"${st} aria-hidden="true"></div>`;
   const al=AL[(o&&o.align)||'']||'';
   /* 見出しのマス（§9.274）。**値を持たず文字だけ**——表の軸はこれが無いと
      組めない。既定は中央寄せ（軸の見出しは列の真ん中に来るのがふつう）。 */
   if(o&&o.head)return `<div class="rp-field rp-field-head${al||' al-c'}"${st}>`
    +`<span class="rp-field-headtext">${esc(label)}</span></div>`;
   /* **理由を渡せる**（§9.247 ②）——子ロットへ割り当てられない項目は`—`に
      なるので、なぜそうなのかを`title`で言う（黙って`—`だと壊れて見える）。 */
   const tip=(o&&o.title)||value||'-';
   /* 共通の軸で並べた表では、ラベルが見出しと二重になる（§9.274・§CLAUDE 8）。
      **ラベルの箱ごと落とす**——空の`<span>`を残すと`min-content`の列が
      そのぶん残り、値が右へずれる。 */
   const bare=o&&o.showLabel===false;
   /* ラベルを**値の上**へ置く（§9.292 ⑤）。印はマスが持つので、
      **紙も盤の見本も同じここを通る**（見本と紙が食い違わない・§9.279）。 */
   const stack=!bare&&!!(o&&o.stack);
   return `<div class="rp-field${bare?' rp-field-bare':''}${stack?' rp-field-stack':''}${al}"${st}>`
    +(bare?'':`<span class="rp-field-label">${esc(label)}</span>`)
    +`<span class="rp-field-value" title="${esc(tip)}">${esc(value||'-')}</span></div>`;
  };
  const body=rows.map(cell).join('');
  /* `rp-grid-m`は**表として組んだという印**（§9.282。紙自身に答えさせる）で、
     列数はここでは持たない。列数は`--rp-cols`が1本で運ぶ。 */
  const cls=matrix?'rp-grid rp-grid-m':'rp-grid';
  const st=` style="--rp-cols:${n}"`;
  return `<section class="rp-section"><h3>${esc(title)}</h3><div class="${cls}"${st}>${body}</div></section>`;
 }
 function dimensionSection(b){
  const row=(label,mat,temper,thick,width,length)=>`<tr><th>${esc(label)}</th><td>${esc(mat||'-')}</td><td>${esc(temper||'-')}</td><td>${esc(fmtDimSafe(thick,3)||'-')}</td><td>${esc(fmtDimSafe(width,1)||'-')}</td><td>${esc(fmtDimSafe(length,1)||'-')}</td></tr>`;
  return `<section class="rp-section"><h3>寸法（オーダー／製造）</h3><table class="rp-dim-table"><thead><tr><th></th><th>材質</th><th>調質</th><th>板厚</th><th>板幅</th><th>板丈</th></tr></thead><tbody>${row('オーダー',b.orderMaterial,b.orderTemper,b.orderThickness,b.orderWidth,b.orderLength)}${row('製造',b.mfgMaterial,b.mfgTemper,b.mfgThickness,b.mfgWidth,b.mfgLength)}</tbody></table></section>`;
 }

 /* ---------- 複数丈（N分割）対応: 1(頭) と N(尾) のみを帳票に載せる ----------
    旧VBA帳票（B5帳票モジュール）と同じ考え方。丈位置は 0=1(頭) 、
    末尾(=縦割数)=N(尾) に固定して読む。巻ずれ・テレスコープはN(尾)のみ対象。 */
 function lengthLabels(s){
  const n=Math.max(1,Math.min(9,+s?.verticalCount||1));
  return {headIdx:0,tailIdx:n,headLabel:'1(頭)',tailLabel:`${n}(尾)`};
 }
 function measAt(x,key,li,col){const v=x.measurements?.[key]?.[li]?.[col];return (v===undefined||v===null||v==='')?'':String(v)}
 function fieldNum(row,names){for(const n of names){if(row[n]!==undefined&&row[n]!==null&&row[n]!==''){const v=Number(row[n]);if(Number.isFinite(v))return v}}return null}
 /* 公差範囲: レコード保存時点の仕掛スナップショット(source)から製造/オーダー公差を読む。
    フィールド名は toleranceDataForSource（測定画面側）と同じ候補を使う。 */
 function toleranceRangeLocal(x,kind){
  const row=x.source||x.snapshot?.source||{};
  const base=Number(kind==='thickness'?x.basic?.mfgThickness:x.basic?.mfgWidth);
  if(!Number.isFinite(base))return null;
  const isT=kind==='thickness',dim=isT?'板厚':'板幅';
  const fieldsFor=order=>({
   plus:[`${dim}公差_${order?'オーダー':'製造'}_プラス`,`${dim}公差_${order?'ｵｰﾀﾞｰ':'製造'}_ﾌﾟﾗｽ`,isT?(order?'KOSAXSOP':'KOSAXSMP'):(order?'KOSAYSOP':'KOSAYSMP')],
   minus:[`${dim}公差_${order?'オーダー':'製造'}_マイナス`,`${dim}公差_${order?'ｵｰﾀﾞｰ':'製造'}_ﾏｲﾅｽ`,isT?(order?'KOSAXSOM':'KOSAXSMM'):(order?'KOSAYSOM':'KOSAYSMM')],
  });
  const wantOrder=x.settings?.toleranceSource==='order';
  let f=fieldsFor(wantOrder),plus=fieldNum(row,f.plus),minus=fieldNum(row,f.minus);
  if((plus===null||minus===null)&&wantOrder){f=fieldsFor(false);plus=fieldNum(row,f.plus);minus=fieldNum(row,f.minus)}
  if(plus===null||minus===null)return null;
  return [base-minus,base+plus];
 }
 function qualityGradeSection(x){
  const g=x.qualityGrades||{};
  const rows=[['生地外観','アルマイト','表面処理','付着油'],['方向性','強度','ラテラルボー','直角度'],['切断面','板厚公差','幅丈公差','フラットネス']];
  const body=rows.map(group=>`<tr>${group.map(l=>`<th>${esc(l)}</th><td>${esc(g[l]||'-')}</td>`).join('')}</tr>`).join('');
  return `<section class="rp-section"><h3>品質等級</h3><table class="rp-dim-table rp-grade-table"><tbody>${body}</tbody></table></section>`;
 }
 /* 仕掛データ取込時に別ファイル（品質情報テーブル）から取得し保存している
    異常/保留情報。旧帳票では品質等級欄の上（右上ブロック）に表示されていた。 */
 /* 品質情報の枠は**カードの大きさいっぱい**（§9.242 ⑧、利用者の指摘
    「異常登録のデータがない場合…その表示する枠は文字量に合わせて可変と
     なっており、折角帳票レイアウトで最低表示領域を確保しても中の枠が
     小さくなるのでバランスが悪くなってしまいます」）。
    印は`rp-section-fill`の1つで、**高さを決めた塊のときだけ**効く
    （CSSが`.rp-block.is-sized`で絞る）——中身なりの塊で効かせると、
    `rpFitRows()`が測る`scrollHeight`が器の高さになって行数が決まらない。 */
 function qualityInfoSection(x){
  const text=String(x.qualityInfo||'異常情報なし');
  return `<section class="rp-section rp-section-fill"><h3>品質情報（仕掛）</h3><div class="rp-info-box">${esc(text).replace(/\n/g,'<br>')}</div></section>`;
 }
 function motherSection(x){
  const m=x.mother||{},originalWidth=fmtDim(x.basic?.originalWidth,1);
  return `<section class="rp-section"><h3>母材実績／カード指示</h3><table class="rp-dim-table"><thead><tr><th></th><th>元幅</th><th>手計算</th><th>全長</th><th>前オフ</th><th>後オフ</th></tr></thead><tbody><tr><th>実績</th><td rowspan="2">${esc(originalWidth||'-')}</td><td>${esc(m.manual||'-')}</td><td>${esc(m.fullLength||'-')}</td><td>${esc(m.front||'-')}</td><td>${esc(m.rear||'-')}</td></tr><tr><th>カード指示</th><td>${esc(m.minCard||'-')}</td><td>${esc(m.maxCard||'-')}</td><td>${esc(m.frontCard||'-')}</td><td>${esc(m.rearCard||'-')}</td></tr></tbody></table></section>`;
 }
 /* 条割(分割)が設定されている場合、条(col, 0始まり)がどのロット・どの
    目標幅(公差)に属するかを求める。以前は「条割 分割公差」として別表に
    していたが、条ごとのロット№・範囲上下限として板幅の実測データ表へ
    直接統合し、判定に使った公差の根拠をその場で確認できるようにする。
    分割されていない(またはグループが1つ以下)場合は、レコード自身の
    ロット№と全体の板幅公差(fallbackTol)をそのまま返す。 */
 function widthRowContext(x,col,fallbackTol){
  const groups=x.settings?.splitGroups;
  if(Array.isArray(groups)&&groups.length>=2){
   let start=0;
   for(const g of groups){
    const count=g.count||0,end=start+count;
    if(col>=start&&col<end){
     const w=g.tol?.width?.manufacturing||g.tol?.width?.order;
     const range=(w&&Number.isFinite(g.base?.width))?[g.base.width-w.minus,g.base.width+w.plus]:null;
     return {lot:g.lot||'-',range};
    }
    start=end;
   }
  }
  return {lot:x.basic?.lotNo||'-',range:fallbackTol};
 }
 function thicknessMeasurementSection(x){
  const s=x.settings||{},{headIdx,tailIdx,headLabel,tailLabel}=lengthLabels(s),tol=toleranceRangeLocal(x,'thickness');
  const rows=['OS','CL','DS'].map((label,col)=>`<tr><th>${label}</th><td>${tol?fmtDimSafe(tol[0],3):'-'}</td><td>${esc(measAt(x,'thickness',headIdx,col)||'-')}</td><td>${esc(measAt(x,'thickness',tailIdx,col)||'-')}</td><td>${tol?fmtDimSafe(tol[1],3):'-'}</td></tr>`).join('');
  return `<section class="rp-section"><h3>測定データ（板厚）</h3><table class="rp-dim-table"><thead><tr><th>測定位置</th><th>範囲下限</th><th>${esc(headLabel)}</th><th>${esc(tailLabel)}</th><th>範囲上限</th></tr></thead><tbody>${rows}</tbody></table></section>`;
 }
 /* コイル№は実際の横割数に関わらず常に最大40行を確保する。旧帳票（B5帳票）は
    条数に関わらず固定グリッドを印刷しており、余白も注記・手書き用の必要領域
    のため、実データがない行も空欄のまま枠だけ残す（"-"を書かず空欄にする）。 */
 /* ---------- 測定データは「列の集まり」(§9.173) ----------
    利用者の指示は「今までの縦方向に幅情報、横方向に検査した項目を並べて
    表示する方式も残してほしい／特に測定項目は組み合わせて表示した方が
    効率的に面積を利用できるので通常は今までどおり軸を共通にして組み合わせた
    形／分解したときに個別内容になるように」。

    **紙の1列＝1つの部品**にする。こうしておくと3つが同じ仕組みで書ける。
      - まとめ  : 条番号を共通の軸にして、選ばれた列を横に並べる（既定＝今までの紙）
      - 分解    : 項目ごとの小さい表になり、1枚ずつ場所と幅を決められる
      - 絞り込み: 「入りきらない」ときに**落とせる単位**が列そのものになる
    列を落とす／群を分解するの2つが同じ`hidden`で表せるので、新しい保存先を
    作らずに済む（列レイアウトマスタの order/hidden/widths だけで足りる）。 */
 const RP_MEAS_GROUPS=[
  {g:'板幅',cols:[{c:'範囲下限',kind:'low'},{c:'頭',f:'width',li:'head'},{c:'尾',f:'width',li:'tail'},{c:'範囲上限',kind:'high'}]},
  {g:'ラテラルボー',cols:[{c:'頭',f:'lateral',li:'head'},{c:'尾',f:'lateral',li:'tail'}]},
  {g:'バリ',cols:[{c:'頭',f:'burr',li:'head'},{c:'尾',f:'burr',li:'tail'}]},
  {g:'巻ずれ',cols:[{c:'尾',f:'offset',li:'tail'}]},
  {g:'テレスコープ',cols:[{c:'尾',f:'telescope',li:'tail'}]},
  {g:'フラットネス',cols:[{c:'頭',f:'flatness',li:'head'},{c:'尾',f:'flatness',li:'tail'}]},
  {g:'備考',cols:[{c:'',f:'comments',li:'tail'}]},
 ];
 const RP_MEAS_COMBINED='板幅ほかの測定データ';          /* まとめの器（既存キーのまま） */
 /* 測定値の統計（§9.244）。**既定は出さない**——今まで無かった塊なので、
    置いていない現場の紙を勝手に増やさない（`rpInitialHidden()`に入れる）。 */
 const RP_STAT_BLOCK='測定値の統計';
 const rpMeasColKey=(g,c)=>`測定列:${g}:${c||'値'}`;      /* 1列ぶんの部品 */
 const rpMeasSoloKey=g=>`測定データ・${g}`;               /* 分解したときの1枚 */
 const RP_MEAS_GROUP_BY=new Map(RP_MEAS_GROUPS.map(x=>[x.g,x]));
 /* この群が「単独で置かれている」か。まとめの中に出すか単独で出すかは
    **単独ブロックが出ているかどうか**の1点で決まる（同じ内容を2箇所に
    出さない、§9.129）。 */
 function rpMeasSolo(g,hidden){return !(hidden||rpHiddenSet()).has(rpMeasSoloKey(g))}
 function rpMeasVisibleCols(g,hidden){
  const h=hidden||rpHiddenSet();
  return (RP_MEAS_GROUP_BY.get(g)||{cols:[]}).cols.filter(c=>!h.has(rpMeasColKey(g,c.c)));
 }
 /* まとめに載る群＝単独で置いていない、かつ出す列が1つ以上ある群。 */
 function rpMeasGroupsFor(mode,hidden){
  const h=hidden||rpHiddenSet();
  return RP_MEAS_GROUPS.filter(x=>rpMeasSolo(x.g,h)===(mode==='solo')&&rpMeasVisibleCols(x.g,h).length);
 }
 /* 条番号を軸にした表を1枚組み立てる。**まとめも分解も同じ関数**が書く
    ——別々に持つと、片方だけ直した状態が作れる（実際に何度も踏んだ罠）。 */
 /* ---------- 行・列を「最大」で出す（§9.309、利用者の指示） ----------
    「データが最大に入ったときの行や列の表示になるような設定を追加してほしい
      です。行や列はデータが入ったときのように出るがデータはないので空で
      表示するイメージです。**板幅表示が40条まで常時表示しているのと同じ形**
      です。この表示方法にするかどうか切り替えられるように、この項目の設定も
      ブロックマスタに足してください」

    紙の高さがロットごとに変わると置き場所を決め直すことになるので、
    **入れ物を最大に固定して足りないぶんは空欄で出す**。測定データの表は
    元からそう組んである（40条ぶんを常に出す）ので、足したのは
    **切り替えられること**と、丈のように今までデータなりだった塊への適用。

    **既定（`''`）はその塊の今までの出し方**（§9.132）——測定データは最大、
    丈別データはデータなり。2択にすると、既定をどちらにしても片方の塊の
    見え方が黙って変わる。**語彙はサーバーが持つ**（§9.163）ので、ここは
    綴りを2つ見るだけ。 */
 function rpFullMode(k){return String((rpBlockOf(k)||{}).full||'')}
 function rpShowFull(k,def){
  const m=rpFullMode(k);
  return m==='最大'?true:(m==='データなり'?false:!!def);
 }
 /* その塊がいま何行ぶん出すか。**最大と実データの両方を渡す**——呼ぶ側で
    `Math.min`を書くと、片方だけ直した状態が作れる。 */
 function rpFullCount(k,def,max,actual){
  return rpShowFull(k,def)?max:Math.max(1,Math.min(max,actual));
 }
 function measTableHtml(x,groups,from,to,blockKey){
  const s=x.settings||{},actual=Math.max(1,Math.min(40,+s.horizontalCount||1));
  const {headIdx,tailIdx,headLabel,tailLabel}=lengthLabels(s),tol=toleranceRangeLocal(x,'width');
  const label=c=>c.kind?c.c:(c.c==='頭'?headLabel:c.c==='尾'?tailLabel:c.c);
  const flat=[];groups.forEach(gr=>rpMeasVisibleCols(gr.g).forEach(c=>flat.push({gr,c})));
  /* 列幅は**指定があるものだけ**colgroupで固定し、残りは今までどおり中身なり
     （§9.174。既定はオートフィットで、必要な列だけ手で決める）。 */
  const colName=f=>`${f.gr.g}${f.c.c?':'+f.c.c:''}`;
  const widths=['条番号','ロット№'].map(n=>rpColWidth(blockKey,n))
    .concat(flat.map(f=>rpColWidth(blockKey,colName(f))));
  const colgroup=widths.some(w=>w>0)
   ?`<colgroup>${widths.map(w=>`<col${w?` style="width:${w}px"`:''}>`).join('')}</colgroup>` : '';
  const head=`<thead><tr><th rowspan="2">条番号</th><th rowspan="2">ロット№</th>`
   +groups.map(gr=>{const n=rpMeasVisibleCols(gr.g).length;
     return n===1&&!rpMeasVisibleCols(gr.g)[0].c?`<th rowspan="2">${esc(gr.g)}</th>`
       :`<th colspan="${n}">${esc(gr.g)}</th>`}).join('')
   +`</tr><tr>`
   +flat.filter(f=>f.c.c).map(f=>`<th>${esc(label(f.c))}</th>`).join('')
   +`</tr></thead>`;
  const rowHtml=(col,prev)=>{
   const real=col<actual,cell=v=>real?esc(v||'-'):'';
   let lotText='',key=prev,range=null;
   if(real){
    const ctx=widthRowContext(x,col,tol);key=`${ctx.lot}|${ctx.range?ctx.range.join(','):''}`;
    lotText=(rpRepeatLabels||key!==prev)?esc(ctx.lot):'';range=ctx.range;
   }
   const cells=flat.map(({c})=>{
    if(c.kind==='low')return `<td>${real?(range?fmtDimSafe(range[0],2):(tol?fmtDimSafe(tol[0],2):'')):''}</td>`;
    if(c.kind==='high')return `<td>${real?(range?fmtDimSafe(range[1],2):(tol?fmtDimSafe(tol[1],2):'')):''}</td>`;
    return `<td>${cell(measAt(x,c.f,c.li==='head'?headIdx:tailIdx,col))}</td>`;
   }).join('');
   return {html:`<tr><th class="rp-colno">${col+1}</th><td class="rp-collot">${lotText}</td>${cells}</tr>`,key};
  };
  let prev=null,body='';
  for(let col=from;col<to;col++){const r=rowHtml(col,prev);body+=r.html;prev=r.key}
  /* **行列入れ替え**（§9.174、利用者の指示「縦横表の構成方法行列入れ替えなど、
     パターン組み合わせもできるように」）。条数が少なく項目が多いロットでは、
     こちらのほうが紙の面積を使い切れる。組み立ては同じ材料を使い、並べる
     向きだけを変える——別の関数にすると、片方だけ直した状態が作れる。 */
  if(rpTransposed(blockKey)){
   const cols=[];for(let col=from;col<to;col++)cols.push(col);
   const trHead=`<thead><tr><th>項目</th>${cols.map(c=>`<th>${c+1}</th>`).join('')}</tr></thead>`;
   const s2=x.settings||{},act=Math.max(1,Math.min(40,+s2.horizontalCount||1));
   const {headIdx:hi,tailIdx:ti}=lengthLabels(s2),tol2=toleranceRangeLocal(x,'width');
   const trBody=flat.map(({gr,c})=>{
    const name=`${gr.g}${c.c?' '+label(c):''}`;
    const tds=cols.map(col=>{
     if(col>=act)return '<td></td>';
     if(c.kind){
      const ctx=widthRowContext(x,col,tol2),r=ctx.range||tol2;
      return `<td>${r?fmtDimSafe(r[c.kind==='low'?0:1],2):''}</td>`;
     }
     return `<td>${esc(measAt(x,c.f,c.li==='head'?hi:ti,col)||'-')}</td>`;
    }).join('');
    return `<tr><th class="rp-collot">${esc(name)}</th>${tds}</tr>`;
   }).join('');
   return `<table class="rp-dim-table rp-wide-table rp-transposed">${trHead}<tbody>${trBody}</tbody></table>`;
  }
  return `<table class="rp-dim-table rp-wide-table">${colgroup}${head}<tbody>${body}</tbody></table>`;
 }
 /* 表の本体。40条ぶんの枠は旧帳票と同じで、A4横のときだけ左右へ割る
    （高さが210mmしかなく、1本で積むと実測59mmはみ出す）。 */
 function measSectionHtml(x,title,note,groups,blockKey){
  if(!groups.length)return '';
  /* 行列を入れ替えたときは左右に割らない（横に40条ぶん並ぶので、割ると
     かえって読みにくい）。 */
  const landscape=rpOrientation==='landscape'&&!rpTransposed(blockKey);
  /* **何条ぶん出すか**（§9.309）。既定は`true`＝今までどおり40条ぶん。
     「データなり」にすると記録された条数だけになる。 */
  const n=rpFullCount(blockKey,true,40,
    Math.max(1,Math.min(40,+((x.settings||{}).horizontalCount)||1)));
  const half=Math.ceil(n/2);
  const tables=landscape
   ?`<div class="rp-wide-split">${measTableHtml(x,groups,0,half,blockKey)}${measTableHtml(x,groups,half,n,blockKey)}</div>`
   :measTableHtml(x,groups,0,n,blockKey);
  return `<section class="rp-section"><h3>${esc(title)}</h3>`
   +(note?`<p class="rp-note">${note}</p>`:'')
   +`<div class="rp-wide-wrap">${tables}</div></section>`;
 }
 function widthMeasurementSection(x){
  const groups=rpMeasGroupsFor('combined');
  if(!groups.length)return '';
  const s=x.settings||{},actual=Math.max(1,Math.min(40,+s.horizontalCount||1));
  const {tailLabel}=lengthLabels(s);
  const landscape=rpOrientation==='landscape';
  /* **書いてあることと起きていることを合わせる**（§3）。「データなり」に
     すると空欄の控え行は出ないので、その一文は書かない。 */
  const full=rpShowFull(RP_MEAS_COMBINED,true);
  const shown=full?40:actual;
  const note=`巻ずれ・テレスコープは ${esc(tailLabel)} のデータのみ対象です。`
   +(full?`横割数（${actual}条）を超える行は控え欄として空欄にしています。`
         :`記録された ${actual}条ぶんだけ出しています（控え欄は出しません）。`)
   +`幅ロット分割時は条ごとのロット№・目標幅(公差)を条番号の右に表示します。`
   +(landscape?`A4横のため1〜${Math.ceil(shown/2)}条と${Math.ceil(shown/2)+1}〜${shown}条を左右に分けています。`:'');
  return measSectionHtml(x,`測定データ（${groups.map(g=>g.g).join('・')}）`,note,groups,RP_MEAS_COMBINED);
 }
 function measSoloSection(x,g){
  const gr=RP_MEAS_GROUP_BY.get(g);
  if(!gr||rpMeasSolo(g)!==true||!rpMeasVisibleCols(g).length)return '';
  return measSectionHtml(x,`測定データ（${g}）`,'',[gr],rpMeasSoloKey(g));
 }
 /* 丈(1..N)別の長さ・肉厚・揃い判定。旧帳票の「丈」テーブル（長さ/肉厚/揃い/外観/備考）に対応。
    「外観」列は旧帳票でも実データが書き込まれない控え欄のため、空欄のまま残す。
    旧B5帳票と同じ「丈を行に、指標を列に」持つ構成に統一する。以前は丈数
    (最大9)ぶんを列に転置していたが、丈数が多いと列がセルの表示幅に収まらず、
    テキストが隣接セル(この帳票では板厚/板幅の実測値テーブル)の領域まで
    はみ出して表示されてしまう不具合があったため、丈ごとに行を積む
    シンプルな構成に戻した(丈は最大9のため縦方向の圧迫も小さい)。 */
 /* ---------- 揃い欄の出し方(§9.205、利用者の指示「内訳と合否両方(デフォルト)と
    内訳のみ、合否のみを切り替えほしい」) ----------
    以前の紙は**合否(OK/NG)しか載っていなかった**ので、のこぎり状なのか
    テレスコープ状なのか、どこに何mm出たのかが紙からは分からなかった。
    保存先は**列レイアウトマスタの`formats`**（この塊の組み立て方。§9.169で
    「転置」に使っているのと同じ欄で、丈別データは転置を持たないので競合
    しない）。**新しいマスタも新しいキーも作らない。** */
 const RP_PRODUCT_KEY='丈別データ';
 const RP_PRODUCT_MODES=[
  {v:'',    label:'内訳と合否',note:'形状・発生位置・方向などの内訳と、切断面等級で出した合否の両方を載せます。'},
  {v:'内訳',label:'内訳だけ',  note:'記録した内訳だけを載せます。合否（OK/NG）は載せません。'},
  {v:'合否',label:'合否だけ',  note:'合否（OK/NG）だけを載せます（今までの紙と同じ）。'},
 ];
 /* **知らない値は既定へ倒す**（設定を手で書き換えた・古い値が残っている
    ときに、紙が空欄になるより既定で刷れるほうがよい）。 */
 function rpProductMode(){
  const t=rpTokens(RP_PRODUCT_KEY);
  return t.indexOf('内訳')>=0?'内訳':(t.indexOf('合否')>=0?'合否':'');
 }
 function productRowsSection(x){
  const rows=x.product?.rows||[],actual=Math.max(1,Math.min(9,+x.settings?.verticalCount||1));
  /* **何丈ぶん出すか**（§9.309）。既定は`false`＝今までどおり記録された丈だけ。
     「最大」にすると9丈ぶんの枠を空欄で出す（測定データの40条と同じ形）。 */
  const shownRows=rpFullCount(RP_PRODUCT_KEY,false,9,actual);
  const mode=rpProductMode(),showJudge=mode!=='内訳',showBreak=mode!=='合否';
  /* **等級はこの紙のレコードから引く**（§9.205）。渡さないと`S.measure`＝
     いま開いている測定の等級で判定してしまい、一括印刷では途中から全部
     同じ基準になる。 */
  const grades=x.qualityGrades||{};
  /* ---------- 中身のある列だけ出す（§9.393、利用者の指示の7件目） ----------
     「１）〜６）の対応により帳票の連動が必要な部分はフレキシブルに対応し
      連動して正しく表示・非表示するように」

     外観・巻ズレ(OS/DS)は**丈ごとの手入力**で、書かない現場もある。
     **1件も書いていない列は紙に出さない**——空欄の列は紙の幅を食うだけで、
     読む側には「まだ書いていない」のか「この設備では測らない」のかも
     分からない（§CLAUDE 4・§9.107）。
     **`外観`はもともと見出しだけ在って中身が空だった**（列を作った当時、
     記録する場所が無かった）。§9.393で記録できるようになったので、
     ここで初めて中身が入る。 */
  const filledIn=k=>rows.slice(0,shownRows).some(r=>String((r||{})[k]||'').trim()!=='');
  const extra=[{k:'appearance',label:'外観',w:8},
               {k:'offsetOs',label:'巻ズレ OS',w:10},
               {k:'offsetDs',label:'巻ズレ DS',w:10}].filter(c=>filledIn(c.k));
  const body=Array.from({length:shownRows},(_,i)=>{
   /* 揃いの判定は`judgeProductRow`の1箇所が答える(§9.203)。
      4桁コードを廃止したので、`alignmentCode`だけを見ると新しい記録が
      すべて空欄になる（旧データはあちらが面倒を見る）。 */
   const r=rows[i]||{},j=showJudge?WL.measureView.judgeProductRow(r,grades):'';
   const badge=j?`<span class="product-judge${j==='OK'?' ok':j==='NG'?' ng':' pend'}">${esc(j)}</span>`:'';
   const br=showBreak?WL.product.breakdown(r):[];
   const brHtml=br.length
     ?`<span class="rp-product-break">${br.map(b=>
        `<span class="rp-pb"><i>${esc(b.label)}</i>${esc(b.text)}</span>`).join('')}</span>`
     :'';
   return `<tr><th>${i+1}</th><td>${esc(r.productLength||'-')}</td><td>${esc(r.wallThickness||'-')}</td>`
     +`<td class="${showBreak?'rp-product-cell':''}">${badge}${brHtml}</td>`
     +extra.map(c=>`<td>${esc(r[c.k]||'-')}</td>`).join('')
     +`<td>${esc(r.note||'-')}</td></tr>`;
  }).join('');
  /* 内訳を出すときは**揃いの列へ幅を回す**——6等分のままだと1行に2〜3文字
     しか入らず、内訳が縦に伸びて紙が溢れる（§11「入れ物は中身の長さから」）。
     合否だけのときは**今までの紙のまま**にする（列幅を触らない）。 */
  /* 列幅は**出す列だけで100%に配り直す**（§CLAUDE 11）。合否だけで追加の
     列も無いときは**今までの紙のまま**にする（列幅を1つも触らない）。 */
  const widths=showBreak||extra.length
    ? [6,11,11,showBreak?44:14,...extra.map(c=>c.w),18]
    : null;
  const cg=widths
    ? `<colgroup>${widths.map(w=>`<col style="width:${(w*100/widths.reduce((a,b)=>a+b,0)).toFixed(1)}%">`).join('')}</colgroup>`
    : '';
  /* **合否の根拠は紙にも書く**（§6）。紙には`title`が出ないので、画面の帯と
     同じ材料から作った1行を節の下へ置く。**内訳だけのときは書かない**
     ——合否を載せていないのに基準の話をしても読む相手が居ない。 */
  const note=showJudge?`<p class="rp-note">${esc(WL.product.paperNote(grades))}</p>`:'';
  return `<section class="rp-section"><h3>丈別データ（長さ・肉厚・揃い）</h3>`
   +`<table class="rp-dim-table rp-product-table">${cg}`
   +`<thead><tr><th>丈</th><th>長さ</th><th>肉厚</th><th>揃い</th>`
   +extra.map(c=>`<th>${esc(c.label)}</th>`).join('')
   +`<th>備考</th></tr></thead>`
   +`<tbody>${body}</tbody></table>${note}</section>`;
 }
 /* 作業班構成: オペレータ・検査員は既存データから、梱包員は現状データ未実装
    のため常に「-」表示。旧帳票の梱包員欄に相当する表示エリアだけ先に確保する。 */
 function crewSection(x){
  const s=x.settings||{};
  return reportSection('作業班構成',[['オペレータ',s.operator],['検査員',s.inspector],['梱包員',s.packer],['作業人数',(s.crewSize&&s.crewSize!=='-')?`${s.crewSize}名班`:'-']]);
 }

 /* ある測定項目(measurements[key])にひとつでも実測値が入っているか。
    「入力内容」セレクトは1レコード内の作業タブ切替に過ぎず、保存時点の
    選択値ではないため、帳票にどのセクションを載せるかは実際にデータが
    あるかどうかで判定する(現在の選択値だけで判定すると、板幅を測定した
    後にラテラルボー等の別タブに切り替えたまま保存した場合、板厚/板幅の
    実測データが帳票から消えてしまう不具合があった)。 */
 function hasMeasurementValues(x,keys){
  return keys.some(key=>(x.measurements?.[key]||[]).some(row=>(row||[]).some(v=>String(v??'').trim()!=='')));
 }
 /* ======================================================================
    帳票の中身は「塊（ブロック）の並び」（§9.169、利用者の指示
    「データの塊ごとに(カードのように扱い)表示非表示を修正できるように／
    リアルタイムでその表示状況を確認しながら帳票の配置(グリッド化)も
    組み換えできるように／汎用的な構造に」）
    ----------------------------------------------------------------------
    以前は`reportHtml()`が「ゾーン(3列/2列…)」をHTMLへ直接書いており、
    載せる・載せないも幅も**コードを直さないと変えられなかった**。
    1塊＝1ブロックとして登録し、
      ・並び      … 列レイアウトマスタの`order`
      ・出す/出さない … 同じく`hidden`
      ・幅        … 同じく`widths`（px幅ではなく**12分割の何マスぶんか**）
    に載せる。**新しいマスタを作らない**——同じ「見せ方の設定」なので、
    保存・全置換・staging（保存せずに当てる）の作りをそのまま使える。

    紙は12マスの粗いグリッド（§9.135「可能な限り粗いグリッド」）。選べる幅は
    5つだけ（1/4・1/3・1/2・2/3・全幅）で、細かくするほど左端の候補が増えて
    そろって見えなくなる。 */
 /* ---------- 帳票の見せ方は設備ごとに覚える(§9.174、利用者の指示) ----------
    設備が変われば紙に載せたいものが変わる（測る項目も条数も違う）。
    `timeline:<設備>`・`print:<設備>`と同じ作法で**設備ごとの1件**にする。
    設備が分からないレコードは`report:共通`へ落とす（保存先が無いと、
    触っても次に開いたとき戻る）。
    **描いている最中はその紙の設備で固定する**——一括印刷は複数ロットを
    続けて流し込むので、「今選んでいるロット」を見に行くと途中から別の
    設備の設定で描かれる。 */
 const RP_LAYOUT_PREFIX='report:';
 let rpActiveTarget=null;
 /* ---------- どの設備の配置を触っているか（§9.239 ③、利用者の指示） ----------
    「帳票カスタム機能について、設備ごとレイアウト調整できるようにして
     ください」

    保存の器は§9.174で**既に設備ごと**（`report:<設備>`）になっている。
    足りなかったのは**設備を選ぶ手立て**で、編集できるのは「いま選んで
    いるロットの設備」だけだった——その設備で測ったロットがこの端末に
    1件も無ければ、その設備の配置は**永久に編集できない**。
    `rpEditEquipment`が入っているあいだは、そちらの設定を読み書きする。
    **判定は`rpTarget()`の1関数のまま**——`rpRaw`/`rpLayoutNow`/`rpStage`/
    `rpHiddenSet`/`rpBlockKeys`が全部ここを通っているので、他は1行も
    触らずに切り替わる。 */
 let rpEditEquipment=null;
 function rpEquipmentOf(x){
  return String((x&&(x.settings?.registeredEquipment||x.registeredEquipment
    ||x.snapshot?.registeredEquipment))||'').trim();
 }
 function rpTargetOf(x){return RP_LAYOUT_PREFIX+(rpEquipmentOf(x)||'共通')}
 function rpTarget(){
  if(rpActiveTarget)return rpActiveTarget;
  if(rpEditEquipment!=null)return RP_LAYOUT_PREFIX+(rpEditEquipment||'共通');
  return rpTargetOf(rpCurrentLot());
 }
 /* 1枚の紙を**その紙の設備で固定して**組み立てる（§9.174・§9.235 ⑤）。
    以前は`reportHtml()`が`rpActiveTarget`へ代入しっぱなしで、
    **rAFのあとに走る測り直し（`rpFitAll`）は常に最後のロットの設備**で
    解いていた——一括印刷で他設備の紙に別の設備の行高が当たる。
    差し替えは**同期の間だけ**にし、終わったら必ず戻す（`finally`）。 */
 /* いま組み立てている紙のロット（§9.248 ②）。**既定の見せ方がロットで
    変わる**——異幅分割で子ロットが複数あるロットだけ「測定値の統計」を
    既定で出す（`rpInitialHidden`）。一括印刷は1枚ずつ設備を差し替えるので、
    ロットも同じ`rpWithLot()`の中で持ち替える（別に持つと食い違う）。 */
 let rpActiveLot=null;
 function rpWithLot(x,fn){
  const prev=rpActiveTarget,prevEq=rpUserBlocksFor,prevLot=rpActiveLot;
  rpActiveLot=x;
  rpActiveTarget=rpTargetOf(x);
  /* 塊の顔ぶれも一緒に合わせる（読んであるときだけ）。 */
  rpUseEquipmentBlocks(rpEquipmentOf(x)||'');
  try{return fn()}finally{
   rpActiveTarget=prev;rpActiveLot=prevLot;
   if(prevEq!=null)rpUseEquipmentBlocks(prevEq);
  }
 }
 /* 1行＝1ブロック。`html(x)`が''を返したら**このロットには中身が無い**。
    紙には出さず、組み換え中だけ「中身なし」と分かる形で置く（黙って消えると
    自分で隠したのかデータが無いのか分からない）。 */
 /* ---------- エリアの塊（§9.234 ⑤、利用者の指示「ラベル貼り付けエリアと
    同じタイプのエリア確保だけのタイプで文字を配置できる感じのものを追加
    してください」） ----------
    **値を出さず、場所を空けるだけ**の塊（ラベル貼付・手書き・確認印の欄）。
    組み立ては**ここ1箇所**——既定の塊（ラベル貼付スペース）も、マスタで
    作った塊も同じ関数を通るので、見え方が2通りにならない。
    **必ず中身のある器を返す**（`html(x)`が''だと「このロットには中身が無い」
    と判定されて紙に出ない）。 */
 function rpAreaHtml(text){
  const t=String(text||'');
  return `<div class="rp-area">${t?`<span class="rp-area-text">${esc(t).replace(/\n/g,'<br>')}</span>`:''}</div>`;
 }
 const RP_BLOCKS=[
  /* **中身が無くても枠として意味がある塊は、既定の高さを持つ**（§9.174）。
     ラベルを貼る場所は「何も書いていないこと」が中身なので、自動高さに
     任せると1行ぶんに潰れて役に立たない（実機で指摘された）。 */
  {k:'ラベル貼付スペース',span:3,h:112,rows:5,area:true,
   html:()=>rpAreaHtml('ラベル貼付スペース')},
  {k:'基本情報',span:6,html:x=>{const b=x.basic||{};
   return reportSection('基本情報',[['ロット番号',b.lotNo],['検査番号',b.inspectionNo],['鋳造番号',b.castingNo],['オーダー番号',b.orderNo],['引当番号',b.allocationNo],['用途コード',b.purposeCode],['用途名',b.purposeName],['取引先',b.customer],['納入先',b.delivery]])}},
  {k:'コース情報',span:3,html:x=>{const b=x.basic||{};
   return reportSection('コース情報',[['設計コース',b.designCourse],['実績コース',b.course],['残コース',b.residualCourse]],1)}},
  {k:'寸法（オーダー／製造）',span:4,html:x=>dimensionSection(x.basic||{})},
  {k:'品質等級',span:4,html:x=>qualityGradeSection(x)},
  {k:'品質情報（仕掛）',span:4,html:x=>qualityInfoSection(x)},
  {k:'測定条件',span:8,html:x=>{const s=x.settings||{};
   const equipment=s.registeredEquipment||x.registeredEquipment||x.snapshot?.registeredEquipment||'-';
   return reportSection('測定条件',[['登録設備',equipment],['入力内容',s.measureType],['丈位置',s.lengthPos],['縦割数',s.verticalCount],['横割数',s.horizontalCount],['巻出方向',s.unwind],['内径',s.innerDiameter],['スプール',s.spool],['板厚測定器',s.thicknessGauge],['板幅測定器',s.widthGauge],['条入力順',s.widthOrder],['方向',s.widthDirection],['バリ揃え',s.burr],
    /* コイル止めはマスタ化前まで「内巻両面テープ」チェックボックス(真偽値)
       だった。過去の帳票が空欄にならないよう旧値も読む。 */
    ['コイル止め',s.coilStop||(s.innerTape===undefined?'':(s.innerTape?'内巻両面テープ':'指定なし'))]],4)}},
  {k:'作業班構成',span:4,html:x=>crewSection(x)},
  {k:'母材実績／カード指示',span:6,html:x=>motherSection(x)},
  {k:'丈別データ',span:6,html:x=>rpShowProduct(x)?productRowsSection(x):''},
  {k:'板厚の測定データ',span:12,html:x=>rpIsDimensional(x)?thicknessMeasurementSection(x):''},
  {k:RP_MEAS_COMBINED,span:12,html:x=>rpShowWidthTable(x)?widthMeasurementSection(x):''},
  /* 分解したときの1枚ずつ。**既定は「出さない」**——通常はまとめの中に
     入っている（利用者の指示「通常は今までどおり軸を共通にして組み合わせた形」）。 */
  ...RP_MEAS_GROUPS.map(gr=>({k:rpMeasSoloKey(gr.g),span:gr.cols.length>=3?6:4,meas:gr.g,
    html:x=>rpShowWidthTable(x)?measSoloSection(x,gr.g):''})),
  {k:RP_DEFECT_KEY,span:12,html:(x,opt)=>defectSection(x,opt)},
  {k:RP_DEFECT_ROLL_KEY,span:6,html:(x,opt)=>defectRollSection(x,opt)},
  {k:'作業時間',span:6,html:x=>{const w=x.workTime||{};
   const dur=w.startAt&&w.endAt?WL.base.formatDuration(new Date(w.endAt)-new Date(w.startAt)):(w.startAt?'作業中':'未計測');
   return reportSection('作業時間',[['開始時刻',WL.measureView.formatWorkTime(w.startAt)],['終了時刻',WL.measureView.formatWorkTime(w.endAt)],['実働時間',dur]])}},
  {k:'登録状態',span:6,html:x=>reportSection('登録状態',[['状態',WL.base.statusLabel(x.status)],['更新日時',fmtDT(x.updatedAt)],['NG回数',x.settings?.ngCount||0]])},
  /* 測定値の統計（§9.244、利用者の指示「異幅分割の複数ロットが混在する
     パターンにおいてもロットごとに統計データが出てくるように」）。
     **既定は出さない**——今まで無かった塊なので、置いていない現場の紙を
     勝手に増やさない（§9.173の「既定はまとめだけ」と同じ作法）。 */
  {k:RP_STAT_BLOCK,span:6,stat:true,html:x=>statSection(x,RP_STAT_BLOCK)},
 ];
 /* ---------- 塊はマスタでも足せる（§9.217、利用者の指示） ----------
    「内部データについても各項目ごと設計できるようにする」。中身の作り方が
    仕事になっている塊（測定表・条の図・異常位置判定）はコードの側のままで、
    **「ラベルと値の出どころを並べただけの塊」はマスタで作れる**ようにした。
    描く側は区別しない——`RP_BLOCKS`と同じ形へ包んでから混ぜる。 */
 let rpUserBlocks=[],rpUserBlocksFor=null;
 /* マスタの行（既定の塊への上書き＋自作の塊）と、**この設備では出さない**
    既定の塊（§9.219 ②）。読めなかったときは空——コードの既定でそのまま出す
    （fail-open。帳票が丸ごと出なくなるほうが困る）。 */
 let rpMasterRows=[],rpBuiltinOff=new Set();
 /* 既定の塊にマスタの行を重ねる（§9.219 ②、利用者の指示「既定の帳票ブロック
    についても編集ができるように、マスタに登録されている状態に汎用化」）。
    **中身の作り方はコードのまま**で、マスタが決めるのは名前・幅・行数・
    出す/出さない・対象設備。ただし**「ラベルと値の出どころを並べただけ」の
    塊は`[内容]`もマスタが持つ**——内容を空にすると画面が持っている中身へ
    戻る（消したのか未設定なのかを分けずに済む）。 */
 /* 塊の見出しを付け替える。**自分で組み立てたHTMLの最初の`<h3>`だけ**を
    差し替える（節はどれも`<section class="rp-section"><h3>…</h3>`で始まる）。

    **名前を1つにするための処理**（§9.219 ②／§CLAUDE 8）。マスタで改名した
    とき、組み換えの帯・パレット・ゴーストだけが新しい名前になり、**紙の
    見出しはコードが持つ題のまま**だと、同じ塊に2つの名前が出る。中身の
    作り方がコードの塊（測定表・条の図・異常位置判定）でも、題は文字なので
    ここで揃えられる。**組み立てには触らない。** */
 function rpRetitle(html,name){
  const s=String(html||'');
  if(!s)return s;
  return s.replace(/<h3([^>]*)>[\s\S]*?<\/h3>/,(m,attr)=>`<h3${attr}>${esc(name)}</h3>`);
 }
 function rpMergeBuiltin(b,r){
  const name=r.name||b.k;
  /* **マスの並びがあれば、それが紙の正**（§9.278、利用者の指示「帳票ブロックの
     表の形を正としてそれが、紙帳票レイアウトの方にそのまま表示されるように」）。
     以前は`r.contentEditable`（＝既定の中身をマスタに持っている塊か）でも
     絞っていたため、**盤では組めるのに紙はコードの既定のまま**という塊が
     あった——`測定値の統計`がまさにそれで、ピボットに組んでも紙は今までの
     横一列の表が出ていた（押せるのに何も起きない・§4）。
     **空なら今までどおりコードの中身**（`[内容]`を触っていない現場の紙は
     1マスも変わらない）。 */
  const fields=(r.fields||[]).length?r.fields:null;
  const renamed=name!==b.k;
  /* **種別が先**（§9.234 ⑤）。マスタで「エリア」にした既定の塊も、
     コードの側で`area:true`の塊も、同じ`rpAreaHtml()`を通す。
     ——これでラベル貼付スペースの**改名が紙にも届く**（`rpRetitle()`は
     `<h3>`を持たない塊に届かないので、以前は名前を変えても紙は元のままだった）。 */
  const area=(r.kind==='エリア')||b.area===true;
  return Object.assign({},b,{
   k:b.k,name,master:true,area,full:r.full||'',
   span:r.span||b.span,rows:r.rows||b.rows||0,
   html:area
     ?(()=>rpAreaHtml(r.kind==='エリア'&&r.text!=null&&r.text!==''?r.text:name))
     :(fields
       /* §9.247 ②。**既定の塊でも繰り返せる**（中身を差し替えてある塊は
          自作の塊と同じ「ラベル＝出どころ」の並びなので、道を分けない）。 */
       ?(x=>rpFieldsSection(x,name,fields,r.cols,r.repeat,r.repeatDir))
       /* **コードが描く塊にも設定を渡す**（§9.323 ④）。マスの並びを持たない
          塊（ピッチ判定・異常位置判定）は、ここで受け取った列数・ラベル位置・
          揃えを自分の欄へ当てる。**受けない描き手は今までどおり**（第2引数を
          見ないだけなので、既存の塊は1行も変わらない）。 */
       :(x=>{const h=b.html(x,{cols:r.cols||0,labelPlace:r.labelPlace||'',
                               factAlign:r.factAlign||''});
             return renamed?rpRetitle(h,name):h}))});
 }
 function rpAllBlocks(){
  const code=new Map(RP_BLOCKS.map(b=>[b.k,b]));
  const out=[],used=new Set();
  /* **同じ名前の塊を2つ並べない**（§9.282、利用者の報告「帳票ブロックマスタ
     では正しく表示するのに紙は全然違う表を持ってくる」）。塊は**名前が鍵**で、
     並び・幅・高さ・出す出さないは列レイアウトマスタへその名前で入る
     （§9.113 と同じ理由）。既定の塊と同じ名前の自作ブロックが1行あるだけで、
     紙はどちらを出すか決められない——実測では、ふつうのプレビューから
     既定の塊が消えて自作のほうが出た（利用者の「全然違う表」の正体）。
     **入口で1回だけ落とす**（散らばった場所で気を付けるのではなく）。
     残すのは**設備を名指ししている行**——`*`より具体的なほうが、その設備の
     紙のために作られたものだから。 */
  const seen=new Map();
  const pick=(k,def,row)=>{
   const hit=seen.get(k);
   const eq=String((row&&row.equipment)||'').trim();
   const strong=!!(eq&&eq!=='*');
   if(hit){
    /* 既に採ってある。より具体的な行が来たときだけ差し替える。 */
    if(strong&&!hit.strong){out[hit.i]=def;seen.set(k,{i:hit.i,strong});}
    return;
   }
   seen.set(k,{i:out.length,strong});
   out.push(def);
  };
  rpMasterRows.forEach(r=>{
   if(r.builtin){
    const b=code.get(r.builtin);
    if(!b)return;
    used.add(r.builtin);
    pick(r.builtin,rpMergeBuiltin(b,r),r);
   }else{
    const d=rpUserBlockDef(r);
    /* 既定の塊と名前がぶつかる行は`rpApplyUserBlocks()`が既に落としている。
       ここは**同じ名前の自作どうし**（設備別と`*`）の畳み込みだけ。 */
    pick(d.k,d,r);
   }
  });
  /* **マスタに無い既定の塊は今までどおり出す**（移行前・読めなかったとき）。
     ただし「出さない」と名指しされたものは出さない——伝わっていないと、
     外したつもりの塊が出たままになる（§9.216 ②の`builtinOff`と同じ）。 */
  RP_BLOCKS.forEach(b=>{if(!used.has(b.k)&&!rpBuiltinOff.has(b.k))out.push(b)});
  return out;
 }
 function rpBlockOf(k){return rpAllBlocks().find(b=>b.k===k)||null}
 /* 塊の見出し。**既定の塊はコードが持つ題をそのまま使う**（`k`が鍵で、
    列レイアウトマスタの設定もこの名前に紐づく）ので、マスタで名前を変えても
    変わるのは**組み換え中の呼び名と、内容をマスタが持つ塊の題**だけ。 */
 function rpBlockLabel(k){const b=rpBlockOf(k);return (b&&b.name)||k}
 /* 測定レコードの中の道をたどる（`basic.lotNo` / `settings.opData.運転方式`）。
    **見つからなければ空**——値の無い項目を「-」で埋めるのは`reportSection`の
    仕事なので、ここでは無いことをそのまま返す。 */
 /* **導出のある値も「道」で引けるようにする**（§9.219 ②）。実働時間・状態・
    「N名班」・コイル止めの旧データは計算が要るので、素の道では引けない。
    ここで`calc.◯◯`として1箇所にまとめる——マスタの`[内容]`から書けるように
    なり、既定の塊（作業時間・登録状態・作業班構成・測定条件）を**中身ごと
    マスタで組み替えられる**。 */
 function rpCalc(x){
  const s=x.settings||{},w=x.workTime||{};
  const dur=(w.startAt&&w.endAt)?WL.base.formatDuration(new Date(w.endAt)-new Date(w.startAt))
    :(w.startAt?'作業中':'未計測');
  return {
   equipment:s.registeredEquipment||x.registeredEquipment||(x.snapshot||{}).registeredEquipment||'-',
   /* コイル止めはマスタ化前まで「内巻両面テープ」チェックボックス(真偽値)
      だった。過去の帳票が空欄にならないよう旧値も読む。 */
   coilStop:s.coilStop||(s.innerTape===undefined?'':(s.innerTape?'内巻両面テープ':'指定なし')),
   crewSize:(s.crewSize&&s.crewSize!=='-')?`${s.crewSize}名班`:'-',
   workStart:WL.measureView.formatWorkTime(w.startAt),workEnd:WL.measureView.formatWorkTime(w.endAt),workDuration:dur,
   status:WL.base.statusLabel(x.status),updatedAt:fmtDT(x.updatedAt),
  };
 }
 /* ---------- 測定した値の統計（§9.242 ⑨、利用者の指示） ----------
    「測定したデータの計算値や集計値など…特にロットごとの板厚MIN、MAXや
     板幅MIN、MAXや板丈MIN、MAXなど測定した項目の統計値なども含めて
     設計できるようにしたい」

    **選べる綴りはサーバーが持つ**（`report_block_repo.STAT_ITEMS`／
    `STAT_AGGS`）。ここが持つのは**値の作り方**だけ——測定値はレコードの
    中にあるので、サーバーからは引けない（§9.163と同じ分け方）。

    数える範囲は**そのロットの丈数・条数まで**（`measure-progress.js`の
    `countsOf`と同じ考え方）——配列は12丈×40条で確保してあるので、素で
    走査すると**条数を減らす前に入っていた値**まで数える。
    板厚だけは条ではなく丈ごとに3点（OS/CL/DS。§9.138）。

    桁は**記録されている値の小数桁にそろえる**（項目ごとの桁数の表を
    ここへ持つと、測定側の丸めと2箇所になる）。 */
 const RP_STAT_KEYS={thickness:'thickness',width:'width',lateral:'lateral',
   burr:'burr',telescope:'telescope',offset:'offset'};
 /* 丈ごとの記録（`product.rows`）。**板丈＝「長さ」**（§9.203の丈の表）。 */
 const RP_STAT_ROWS={length:'productLength',wall:'wallThickness'};
 function rpStatValues(x,item){
  const out=[];
  const st=(x&&x.settings)||{};
  const vertical=Math.max(1,Math.min(9,Number(st.verticalCount)||1));
  const horizontal=Math.max(1,Math.min(40,Number(st.horizontalCount)||1));
  const key=RP_STAT_KEYS[item];
  if(key){
   const rows=((x&&x.measurements)||{})[key]||[];
   const slots=Math.min(WL.base.LENGTH_SLOTS,vertical+1);
   const n=key==='thickness'?3:horizontal;
   for(let li=0;li<slots;li++){
    const row=rows[li]||[];
    for(let j=0;j<n;j++)out.push(row[j]);
   }
   return out;
  }
  const field=RP_STAT_ROWS[item];
  if(!field)return out;
  const rows=((x&&x.product)||{}).rows||[];
  for(let i=0;i<vertical;i++)out.push((rows[i]||{})[field]);
  return out;
 }
 /* 小数桁は**記録されている文字から数える**（3桁まで）。 */
 function rpStatDigits(raws){
  let d=0;
  raws.forEach(t=>{
   const m=/\.(\d+)$/.exec(String(t).trim());
   if(m)d=Math.max(d,Math.min(3,m[1].length));
  });
  return d;
 }
 /* 値の並びから1組の統計を作る。**まとめもロットごとも同じ関数**が作る
    ——別々に持つと、片方だけ直した状態が作れる（§9.243と同じ理由）。 */
 function rpStatOf(raw){
  const raws=raw.map(v=>String(v==null?'':v).trim()).filter(t=>t!=='');
  const nums=raws.map(Number).filter(v=>Number.isFinite(v));
  if(!nums.length)return {min:'',max:'',avg:'',span:'',n:'0'};
  const d=rpStatDigits(raws);
  const f=v=>v.toFixed(d);
  const min=Math.min(...nums),max=Math.max(...nums);
  return {min:f(min),max:f(max),
    avg:f(nums.reduce((a,v)=>a+v,0)/nums.length),
    span:f(max-min),n:String(nums.length)};
 }
 /* ---------- 統計は「条に紐づくか」で2種類に分かれる（§9.244） ----------
    利用者の指示:「異幅分割の複数ロットが混在するパターンにおいてもロットごとに
    統計データが出てくるように対応をお願いします」。

    **条ごとに測る項目だけがロットごとに切れる**（§9.214で一度書いたとおり）:
      条ごと … 板幅・ラテラルボー・バリ・テレスコープ・巻ずれ
      丈ごと … 板厚（丈位置ごとにOS/CL/DSの3点）・板丈・肉厚

    子ロットは**条の範囲**（`settings.splitGroups`の`count`を先頭から積む）で
    決まるので、丈ごとの項目はどの子ロットのものとも言えない。**言えないことは
    そう書く**（§4）——`byLot`には入れず、表では「—」と注記で理由を出す。 */
 const RP_STAT_BY_STRIP={width:1,lateral:1,burr:1,telescope:1,offset:1};
 const RP_STAT_LABEL={thickness:'板厚',width:'板幅',lateral:'ラテラルボー',
   burr:'バリ',telescope:'テレスコープ',offset:'巻ずれ',length:'板丈',wall:'肉厚'};
 const RP_STAT_AGG=[['min','MIN'],['max','MAX'],['avg','平均'],['span','ばらつき'],['n','N数']];
 /* 子ロットの区切り。**判定は`widthRowContext`と同じ材料**（`splitGroups`）で、
    ここで別の数え方をすると紙の中で条番号とロット№の対応が2通りになる。
    分割が無い（群が1つ以下）ときは**空**——「全体」1行だけで足りる。 */
 function rpSplitLots(x){
  const g=x&&x.settings&&x.settings.splitGroups;
  if(!Array.isArray(g)||g.length<2)return [];
  const out=[];let start=0;
  g.forEach(gr=>{
   const count=Math.max(0,Number(gr.count)||0);
   if(count>0)out.push({lot:String(gr.lot||'-'),from:start,to:start+count,count});
   start+=count;
  });
  return out.length>=2?out:[];
 }
 /* **同じレコードなら作り直さない**（1枚の紙に何本も統計の欄が並びうる）。 */
 let rpStatFor=null,rpStatCache=null;
 function rpStat(x){
  if(rpStatFor===x&&rpStatCache)return rpStatCache;
  const out={byLot:[]};
  const items=Object.keys(RP_STAT_KEYS).concat(Object.keys(RP_STAT_ROWS));
  items.forEach(item=>{out[item]=rpStatOf(rpStatValues(x,item))});
  /* ロットごと（条ごとに測る項目だけ）。 */
  const lots=rpSplitLots(x);
  if(lots.length){
   const s=(x&&x.settings)||{};
   const vertical=Math.max(1,Math.min(9,Number(s.verticalCount)||1));
   const slots=Math.min(WL.base.LENGTH_SLOTS,vertical+1);
   out.byLot=lots.map(L=>{
    const bag={lot:L.lot,from:L.from,to:L.to,count:L.count};
    items.forEach(item=>{
     if(!RP_STAT_BY_STRIP[item]){bag[item]=null;return}   /* 条に紐づかない＝言えない */
     const rows=((x&&x.measurements)||{})[RP_STAT_KEYS[item]]||[];
     const raw=[];
     for(let li=0;li<slots;li++){
      const row=rows[li]||[];
      for(let j=L.from;j<L.to;j++)raw.push(row[j]);
     }
     bag[item]=rpStatOf(raw);
    });
    return bag;
   });
  }
  rpStatFor=x;rpStatCache=out;
  return out;
 }
 /* 統計の表（§9.244）。**行＝ロット・列＝項目×集計**で、分割が無いロットでは
    「全体」の1行だけになる（同じ塊が両方の場面で使える）。
    どの項目を出すかは塊の見せ方（`項目:`）が持つ——**既定は板厚・板幅・板丈**
    （利用者が名指しした3つ）。 */
 const RP_STAT_DEFAULT_ITEMS=['thickness','width','length'];
 function rpStatItems(k){
  const t=rpToken(k,'項目:');
  const list=t?t.split('/').filter(v=>RP_STAT_LABEL[v]):[];
  return list.length?list:RP_STAT_DEFAULT_ITEMS.slice();
 }
 function rpStatAggs(k){
  const t=rpToken(k,'集計:');
  const list=t?t.split('/').filter(v=>RP_STAT_AGG.some(a=>a[0]===v)):[];
  return list.length?list:['min','max','n'];
 }
 function statSection(x,k){
  const items=rpStatItems(k),aggs=rpStatAggs(k);
  if(!items.length)return '';
  const st=rpStat(x),lots=st.byLot||[];
  const aggLabel=v=>(RP_STAT_AGG.find(a=>a[0]===v)||[v,v])[1];
  const head=`<thead><tr><th rowspan="2">対象</th>`
   +items.map(it=>`<th colspan="${aggs.length}">${esc(RP_STAT_LABEL[it]||it)}</th>`).join('')
   +`</tr><tr>`
   +items.map(it=>aggs.map(a=>`<th>${esc(aggLabel(a))}</th>`).join('')).join('')
   +`</tr></thead>`;
  const cells=bag=>items.map(it=>{
   const b=bag[it];
   /* **言えない組み合わせは「—」**（0や空にすると「測っていない」と読める）。 */
   if(b===null)return aggs.map(()=>`<td class="rp-stat-na" title="この項目は丈ごとに測るので、条で分かれる子ロットには割り当てられません">—</td>`).join('');
   return aggs.map(a=>`<td>${esc((b&&b[a])||'')}</td>`).join('');
  }).join('');
  const rows=[`<tr><th>全体</th>${cells(st)}</tr>`]
   .concat(lots.map(L=>`<tr><th class="rp-collot" title="${esc(`条 ${L.from+1}〜${L.to}（${L.count}条）`)}">`
     +`${esc(L.lot)}<small>${L.from+1}〜${L.to}条</small></th>${cells(L)}</tr>`)).join('');
  /* **出どころと分母を書く**（§CLAUDE 6）——同じ「MIN」でも1点と80点では
     当たる見込みが違う。ロットごとに出せない項目があることも書く。 */
  const na=items.filter(it=>!RP_STAT_BY_STRIP[it]).map(it=>RP_STAT_LABEL[it]||it);
  const note=lots.length
   ?`子ロットごとの値は<b>その子ロットの条だけ</b>から数えています。`
    +(na.length?`${esc(na.join('・'))}は丈ごとに測るので、子ロットには割り当てられません（—）。`:'')
   :'このロットは幅分割されていないので、全体の1行だけです。';
  return `<section class="rp-section"><h3>測定値の統計</h3>`
   +`<table class="rp-dim-table rp-stat-table">${head}<tbody>${rows}</tbody></table>`
   +`<p class="rp-note">${note}</p></section>`;
 }
 /* ---------- 繰り返しの1回ぶん（§9.247 ②、利用者の指示） ----------
    「異幅分割ありのロットでロット番号が1ロット内に複数混在するパターンに
     おいても各分割ロット単位ごとに統計データが出てくるように」

    塊を子ロットの数だけ描くとき、**その回がどの子ロットなのか**を持ち回る。
    分割の無いロット（と繰り返さない塊）では**親ロット自身**を指す1件を返す
    ——こうしておくと`lot.*`がどこに置いても空欄にならず、繰り返しの
    有無で紙の作り方を分けなくて済む（§4）。
    **子ロットの区切りは`rpSplitLots()`の1箇所**（`statSection`と同じ材料）
    ——別の数え方をすると、同じ紙の中で条番号とロット№の対応が2通りになる。 */
 function rpRepeatLots(x,on){
  const st=rpStat(x);
  const lots=(st.byLot||[]);
  if(!on||!lots.length){
   /* 繰り返さない（または分割が無い）ときの1件。**`bag`は全体の統計**で、
      `null`にしないこと——`stat.*`がそこを見るので、`null`にすると
      繰り返していない塊の統計まで「—」になる。 */
   return [{lot:String((x&&x.basic&&x.basic.lotNo)||''),
            from:0,to:0,count:0,index:1,total:1,bag:st,split:false}];
  }
  return lots.map((L,i)=>Object.assign({},L,
    {index:i+1,total:lots.length,bag:L,split:true}));
 }
 /* 条に紐づかない項目（板厚・板丈・肉厚）を子ロットへ割り当てられない理由。
    **文字で言う**（§4）——空欄にすると「測っていない」と読める。 */
 const RP_LOT_NA='この項目は丈ごとに測るので、条で分かれる子ロットには割り当てられません';
 /* ---------- 「1つの鍵」で持っている入れ物（§9.285 ④） ----------
    `source.<列名>`（仕掛の生の行）・`qualityGrades.<等級名>`・
    `settings.opData.<項目名>`は、**中の名前を現場やデータが決める**。
    `.`で機械的に割ると、名前に`.`が1つ入っただけで**その項目だけが黙って
    空になる**（列名は200を超えるので、気づける見込みが薄い）。
    ここに並べた入れ物では、頭を落とした**残り全部を1つの鍵**として引く。 */
 const RP_FLAT_ROOTS=['source.','qualityGrades.','settings.opData.'];
 function rpDig(x,path){
  const p=String(path||'');
  const flat=RP_FLAT_ROOTS.find(r=>p.indexOf(r)===0);
  if(flat){
   let bag=x;
   for(const k of flat.slice(0,-1).split('.')){
    if(bag==null||typeof bag!=='object')return null;
    bag=bag[k];
   }
   const key=p.slice(flat.length);
   let v=(bag&&typeof bag==='object')?bag[key]:undefined;
   /* 仕掛の生の行は保存のときに凍らせた写しも持つ（`snapshot.source`）。
      **開いているほうが先**——測定中は`source`が最新。
      **どちらにも無ければ空**（§9.285 ④の「元データからなくなれば出ない」）。 */
   if(v==null&&flat==='source.'){
    const snap=x&&x.snapshot&&x.snapshot.source;
    if(snap&&typeof snap==='object')v=snap[key];
   }
   return v==null?null:v;
  }
  let v=x;
  for(const part of p.split('.')){
   if(v==null||typeof v!=='object')return null;
   v=v[part];
  }
  return v==null?null:v;
 }
 function rpValueAt(x,path,ctx){
  const p=String(path||'');
  if(p.indexOf('calc.')===0){
   const v=rpCalc(x)[p.slice(5)];
   return v==null?'':String(v);
  }
  /* §9.247 ②。`lot.<なに>`。繰り返しの**その回の子ロット**を指す。
     繰り返していない塊では親ロット自身へ落ちる（`rpRepeatLots`が1件返す）。 */
  if(p.indexOf('lot.')===0){
   const L=(ctx&&ctx.lot)||rpRepeatLots(x,false)[0];
   const k=p.slice(4);
   if(k==='no')return String(L.lot||'');
   if(k==='index')return String(L.index||1);
   if(k==='count')return String(L.total||1);
   /* **分割していないロットでは条の範囲を作らない**——`0〜0条`と出すと、
      1本も測っていないように読める（§4。言えないことは言わない）。 */
   if(k==='strips')return L.split?String(L.count||0):'';
   if(k==='range')return L.split?`${L.from+1}〜${L.to}`:'';
   return '';
  }
  /* §9.242 ⑨。`stat.<項目>.<集計>`。**知らない綴りは空**——`calc.*`と同じ
     作法で、書き間違えても紙は出る（黙って別の値を出さない）。
     §9.247 ②で**その回の子ロットの統計**を見るようになった（`ctx.lot.bag`）
     ——`rpStat()`の中身をそのまま使うので、まとめもロットごとも
     値の作り方は1箇所（`rpStatOf`）のまま。 */
  if(p.indexOf('stat.')===0){
   const part=p.slice(5).split('.');
   const src=(ctx&&ctx.lot&&ctx.lot.bag)||rpStat(x);
   const bag=src[part[0]];
   /* **`null`は「言えない」**（条に紐づかない項目）。0や空にすると
      「測っていない」と読めるので、`—`と理由を出す（§4）。 */
   if(bag===null)return '—';
   const v=bag?bag[part[1]]:'';
   return v==null?'':String(v);
  }
  const v=rpDig(x,p);
  if(v==null||typeof v==='object')return '';
  const t=String(v);
  /* ISOの日時はそのまま出すと読めない（末尾Z）。他は素のまま。
     **書式より先にここを通すこと**（§9.285 ③）——`fmtDT`は地方時へ直して
     **秒まで**返すので、`yyyy/MM/dd HH:mm:ss`もここから作れる。生のISOを
     書式へ渡すとUTCの成分が読まれ、時差ぶんずれる（§9.162と同じ罠）。 */
  return /^\d{4}-\d{2}-\d{2}T/.test(t)?fmtDT(t):t;
 }
 /* ---------- 塊の中身を「子ロットごとに繰り返して」描く（§9.247 ②） ----------
    **自作の塊も、中身を差し替えた既定の塊も同じここを通る**——別々に持つと、
    片方だけ繰り返す状態が作れる（§CLAUDE「同じ処理を2つ持たない」）。

    繰り返さない塊（と分割の無いロット）では`rpRepeatLots()`が1件を返すので、
    **今までとまったく同じ1つの節**が出る（見え方を勝手に変えない）。
    繰り返すときは見出しに子ロット番号を添える——同じ名前の節が並ぶと、
    どれがどの子ロットのものか読めなくなる（§2）。 */
 /* マスごとの書式（§9.274、利用者の指示「数値の桁数、日付の書式、文字列を
    寄せる方向など一般的に対応できるものを準備して」）。
    **整えるのは`WL.cellFormat`の1箇所**（`base.js`）——一覧・実績データ・
    作業予定表と同じ道具を通す。帳票だけ2つ目の整形器を持つと、同じ
    「小数2桁」が画面によって違う結果になる（§9.163）。
    **整形に失敗したら生の値**（`value()`がそう作ってある）——空欄にしない。 */
 /* **書式へ渡すのは「地方時へ直した値」**（§9.285 ③）。生のISO（末尾Z）を
    渡すとUTCの成分がそのまま読まれ、**書式を付けた欄だけ時差ぶんずれる**
    （§9.162でデータ一覧が踏んだのと同じ罠。実測: JSTで9時間ずれる）。
    `rpValueAt`がISOを`fmtDT`で秒まで直してから返すので、そのまま渡す。 */
 function rpFormatCell(raw,spec){
  if(!spec)return raw;
  try{return WL.cellFormat.value(spec,raw)}catch(e){return raw}
 }
 /* ---------- 塊の中身を1回ぶん描く（§9.247 ②／§9.277） ----------
    子ロットとの噛み合わせは2通りある。

     ①**塊ごと繰り返す**（今までどおり）——子ロットの数だけ節を出す。
       並べる向きは`repeatDir`（既定は縦に積む・§9.277）。
     ②**1つの表の中で繰り返す**（§9.277）——`lot:true`の印が付いたマスだけを
       子ロットの数だけ複製する。盤の「表に組む」で「対象」の軸を**行**へ
       置くとこの形になり、`測定値の統計`の既定の塊と同じ絵になる。

    **どちらかは印が決める**（`lot:true`のマスが在るか）——設定を2つ持つと、
    「繰り返すのに表にもする」という決まらない状態が作れる。 */
 function rpCellTuple(x,f,L){
  if(f.blank)return [f.label,'',{span:f.span,rows:f.rows,blank:true}];
  /* 見出しのマス（§9.274）。**値を引かない**——道を持たないので、
     引きに行くと空文字を`-`として出すことになる。 */
  if(f.kind==='head')return [f.label,'',{span:f.span,rows:f.rows,head:true,align:f.align}];
  const v=rpFormatCell(rpValueAt(x,f.path,{lot:L}),f.format);
  /* 割り当てられない項目は`—`（`rpValueAt`が返す）。**理由を添える**（§4）。 */
  /* **マスの持ちものは1つも落とさない**（§9.113／§9.212 ②で5度踏んだ形）
     ——ここが`cell()`へ渡す唯一の口なので、書き漏らした設定は
     **保存も盤の札も効いているのに、見本も紙も1pxも変わらない**（§9.292 ⑤の
     `stack`が実際にそれで、利用者から「ボタンを押しても変化が全くなく、
     プレビューも横のまま」と報告された）。 */
  return [f.label,v,{span:f.span,rows:f.rows,title:(v==='—'?RP_LOT_NA:''),
                     align:f.align,showLabel:f.showLabel!==false,stack:!!f.stack}];
 }
 function rpFieldsSection(x,name,fields,cols,repeat,repeatDir){
  const live=fields.filter(f=>!f.blank);
  if(!live.length)return '';
  const on=repeat==='子ロット';
  const lots=rpRepeatLots(x,on);
  /* ---- ② 表の中で繰り返す（§9.277） ---- */
  if(on&&fields.some(f=>f.lot)){
   const rows=[];
   let put=false;
   /* **印の無いマスは「全体」**（§9.277）——盤は「対象」の軸に`全体`と
      子ロットの2つを並べるので、印の無い側はロット全体の統計で埋める。
      `lots[0]`を使わないこと——1本目の子ロットの値が「全体」の欄に出る。 */
   const whole=rpRepeatLots(x,false)[0];
   fields.forEach(f=>{
    if(!f.lot){rows.push(rpCellTuple(x,f,whole));return}
    /* **印の付いた並びはひとかたまり**（盤が行として作る）。最初に出て
       きたところで、そのかたまりを子ロットの数だけ展開する。 */
    if(put)return;
    put=true;
    const run=fields.filter(y=>y.lot);
    lots.forEach(L=>run.forEach(y=>rows.push(rpCellTuple(x,y,L))));
   });
   return reportSection(name,rows,cols||0);
  }
  /* ---- ① 塊ごと繰り返す（今までどおり） ---- */
  const html=lots.map(L=>{
   const title=(on&&L.split)
     ?`${name}　${L.lot||'(番号なし)'}（${L.from+1}〜${L.to}条）`:name;
   return reportSection(title,fields.map(f=>rpCellTuple(x,f,L)),cols||0);
  }).join('');
  /* 横に並べる（§9.277、利用者の指示「縦に積むが標準で横に積むか」）。
     **繰り返しが1回のときは器を作らない**——1件しかないのに横並びの器で
     包むと、幅の計算だけが変わって見え方が微妙にずれる。 */
  return (repeatDir==='横'&&lots.length>1)
    ? `<div class="rp-repeat-row" style="--rp-repeat:${lots.length}">${html}</div>`
    : html;
 }
 function rpUserBlockDef(b){
  const fields=b.fields||[];
  /* エリアの塊（§9.234 ⑤）。**既定の行数はここで与える**——0（中身なり）の
     ままだと`rpFitRows()`が1行に潰し、場所を空けるという役目を果たせない
     （§9.174「枠だけの塊は既定の高さを持つ」と同じ理由）。 */
  const area=b.kind==='エリア';
  return {k:b.k||b.name,name:b.name,span:b.span||6,rows:b.rows||(area?5:0),user:true,area,
   /* **設定は1つも落とさない**（§9.113）。自作の塊は表に組めるので、
      行・列の出し方（§9.309）もここを通らないと紙へ届かない。 */
   full:b.full||'',
   html:area?(()=>rpAreaHtml(b.text))
     /* マス数と空きマスは**そのまま渡す**（§9.245）——ここで潰すと、
        設定画面で組んだマトリクスが紙では1列ずつの並びに戻る。
        **空きマスだけの塊は「中身なし」**（紙には出さない）。 */
     :(x=>rpFieldsSection(x,b.name,fields,b.cols,b.repeat,b.repeatDir))};
 }
 /* その設備の自作ブロックを読む。**読めなくても帳票は出す**（fail-open）。 */
 /* 設備ごとの写し（§9.239 ③）。1設備ぶんしか持たないと、一括印刷で
    設備をまたいだ瞬間に**設備Bの紙へ設備Aの塊集合が当たる**（`rpAllBlocks`
    と`rpBuiltinOff`が最後に読んだ設備で固定される）。 */
 const rpBlocksByEq=new Map();
 async function rpLoadUserBlocks(equipment){
  const eq=String(equipment||'').trim();
  if(rpUserBlocksFor===eq)return rpUserBlocks;
  const hit=rpBlocksByEq.get(eq);
  if(hit){rpApplyUserBlocks(eq,hit);return rpUserBlocks}
  let got={rows:[],off:new Set()};
  try{
   const r=await api('/api/report-block-master?equipment='+encodeURIComponent(eq));
   got={rows:r.items||[],off:new Set(r.builtinOff||[])};
  }catch(e){got={rows:[],off:new Set()}}
  rpBlocksByEq.set(eq,got);
  rpApplyUserBlocks(eq,got);
  return rpUserBlocks;
 }
 /* いま効かせる設備を切り替えるだけ（取得はしない）。 */
 function rpApplyUserBlocks(eq,got){
  /* **既定の塊と同じ名前の自作の塊は、入口で1回だけ落とす**（§9.282、
     利用者の報告「紙は全然違う表を持ってくる」）。塊は**名前が鍵**なので、
     同じ名前が2つあると`rpHiddenSet()`が「並びに載っていない自作の塊」として
     **既定の塊のほうを隠してしまう**——実測では、盤で正しく組んだ
     `測定値の統計`が紙から丸ごと消えた。サーバーは新しく作らせないが、
     **現場に既に保存されている行**が残りうるので読む側でも落とす。
     散らばった場所で気を付けるのではなく、ここ1箇所で。 */
  const builtinKeys=new Set(RP_BLOCKS.map(b=>b.k));
  const bad=got.rows.filter(r=>!r.builtin&&builtinKeys.has(r.name));
  if(bad.length)console.warn('帳票ブロックマスタに、既定の塊と同じ名前の行があります（紙には出しません）:',
    bad.map(r=>`${r.equipment}/${r.name}`).join(', '));
  rpMasterRows=got.rows.filter(r=>!(!r.builtin&&builtinKeys.has(r.name)));
  rpBuiltinOff=got.off;
  rpUserBlocks=rpMasterRows.filter(b=>!b.builtin).map(rpUserBlockDef);
  rpUserBlocksFor=eq;
 }
 /* 一括印刷で1枚ずつ設備を合わせる。**取得は済ませてから呼ぶこと**
    （§9.235 ⑤「awaitは差し替えるより前に」）。 */
 function rpUseEquipmentBlocks(eq){
  const key=String(eq||'').trim();
  const got=rpBlocksByEq.get(key);
  if(got)rpApplyUserBlocks(key,got);
 }
 /* 「このロットに中身があるか」の判定は**元の場所から動かさない**。
    保存済みレコードは旧名`板厚/板幅`を持つ（§9.138で分けた）ので**両方**を
    見る——落とすと過去の帳票からその節が黙って消える。 */
 function rpIsDimensional(x){
  const t=x.settings?.measureType;
  return t==='板厚'||t==='板幅'||t==='板厚/板幅'||hasMeasurementValues(x,['thickness']);
 }
 function rpShowWidthTable(x){
  const t=x.settings?.measureType;
  return ['板厚','板幅','板厚/板幅','ラテラルボー','バリ','テレスコープ','巻ずれ','フラットネス'].includes(t)
    ||hasMeasurementValues(x,['width','lateral','burr','offset','telescope','flatness']);
 }
 function rpShowProduct(x){
  const has=(x.product?.rows||[]).some(r=>r&&WL.measureView.PRODUCT_FILLED_KEYS.some(k=>String(r[k]||'').trim()!==''));
  /* **丈毎の面を選んだ記録か、丈の行が1つでも埋まっていれば出す**
     （§9.391）。母材だけを選んで丈を1行も書いていない記録に、空の
     「丈別データ」を刷らない。旧名（母材/丈毎）は母材へ寄るので、
     その頃の記録は`has`のほうで拾う。 */
  return WL.measureItem.isPiece(x.settings?.measureType)||has;
 }
 /* 並び。**知らない名前は捨て、登録済みで並びに無いものは末尾へ**（一覧の
    `listColumnKeys`と同じ作法。項目が増えても設定が壊れない）。 */
 function rpBlockKeys(){
  const l=WL.columnLayout.get(rpTarget()),seen=new Set(),out=[];
  (l.order||[]).forEach(k=>{if(rpBlockOf(k)&&!seen.has(k)){seen.add(k);out.push(k)}});
  rpAllBlocks().forEach(b=>{if(!seen.has(b.k)){seen.add(b.k);out.push(b.k)}});
  return out;
 }
 /* **一度も保存していないうちの既定**（§9.162と同じ約束）。列レイアウトマスタの
    hiddenは空なので、そのまま使うと分解した1枚ずつが全部紙に出てしまい、
    同じ測定値が2箇所に並ぶ。保存前は「まとめだけ」を既定にする。 */
 /* 子ロットが複数あるロットか（§9.248 ②）。**判定は`rpStat()`の1箇所**を
    通す——別の数え方をすると、紙の中で条番号とロット№の対応が2通りになる。 */
 function rpHasSplitLots(x){
  if(!x)return false;
  try{return (rpStat(x).byLot||[]).length>=2}catch(e){return false}
 }
 function rpLotForDefaults(){return rpActiveLot||rpCurrentLot()}
 /* **一度も配置を触っていないときの既定**（§9.162と同じ約束）。
    §9.244で足した「測定値の統計」は**既定で出していなかった**——今まで
    無かった塊なので、現場の紙を勝手に増やさないため。ところがそのせいで、
    §9.247 ②で子ロットごとの統計を出せるようにしても**利用者からは何も
    変わって見えなかった**（利用者が同じ指摘を2度した・§9.248 ②）。
    **異幅分割で子ロット番号が複数あるロットのときだけ既定で出す**
    ——そのときこそ子ロットごとのMIN/MAXが要る場面で、分割の無いロットの
    紙は今までどおり1枚も増えない（§2「先回りして提示する」）。 */
 function rpInitialHidden(){
  const solo=RP_MEAS_GROUPS.map(gr=>rpMeasSoloKey(gr.g));
  return rpHasSplitLots(rpLotForDefaults())?solo:solo.concat([RP_STAT_BLOCK]);
 }
 /* ---------- 「紙に出す」は1箇所が答える（§9.274、利用者の報告） ----------
    「帳票ブロックマスタをいじっても、帳票の紙レイアウトのところで見えている
     データ、プレビューのデータは変わりません」

    原因は**並びに載っていない自作の塊は必ず隠す**（下の`rpHiddenSet()`）と、
    **並びを書き下ろすのは`order`が空のときだけ**（`rpStage()`）の組み合わせ。
    一度でも配置を保存した紙では`order`が空でなくなるので、**あとから足した
    塊は「出す」を押しても次に読むと消える**——押しても何も起きないボタン
    （§4）そのもので、しかも黙って戻るので壊れているようにしか見えない。

    **出すときは並びにも載せる**のが「並びに載るまで出さない」の裏返し。
    出す・出さないの経路は3つ（塊の編集窓・組み換えの札・帳票レイアウト
    マスタ）あるので、**判定も書き込みもここ1つ**を通す（§9.163）。 */
 function rpShowBlock(k,on){
  const set=new Set(rpHiddenSet());
  const patch={};
  if(on){
   set.delete(k);
   const order=[...(rpLayoutNow().order||[])];
   /* **末尾へ足す**（§9.248 ③と同じ作法）——載っていない列を前へ挿すと、
      利用者が並べた順が押し出される。 */
   if(order.length&&order.indexOf(k)<0){order.push(k);patch.order=order}
  }else set.add(k);
  patch.hidden=[...set];
  /* **旧`長手:なし`は、押されたその場で捨てる**（§9.319-C／§9.132）。
     下の`rpHiddenSet()`が旧い印を「ピッチ判定を隠す」と読み替えているので、
     捨てないと**「出す」を押しても次に読むとまた隠れる**——§9.274でここへ
     集約した「押しても何も起きないボタン」（§4）を、別の道でもう一度作る
     ことになる。**旧い印を持っていないときは触らない**。 */
  if(k===RP_DEFECT_ROLL_KEY&&rpToken(RP_DEFECT_KEY,'長手:'))
   patch.formats=rpTokenPatch(RP_DEFECT_KEY,'長手:','');
  rpStage(patch);
 }
 function rpHiddenSet(){
  const l=WL.columnLayout.get(rpTarget());
  const set=new Set((l.order||[]).length?(l.hidden||[]):rpInitialHidden());
  /* **自作の塊は、並びに載るまで紙に出さない**（§9.217）——マスタへ足した
     瞬間に全員の紙が1枚増えるのは行き過ぎ。組み換えの「出していない塊」から
     落として初めて出る。判定は「保存済みの並びに載っているか」（§9.197の
     監査列・日付(太陽暦)と同じ約束）——`hidden`に書くと、利用者が一度でも
     出したあとに「隠した」のか「まだ出していない」のかが区別できなくなる。 */
  const known=new Set(l.order||[]);
  rpUserBlocks.forEach(b=>{if(!known.has(b.k))set.add(b.k)});
  /* **旧`長手:なし`を「ピッチ判定を出さない」として読み替える**（§9.319-C）。
     §9.305 ②-2ではこの入切を「異常位置判定」の中の印で持っていた。塊を2つに
     分けた以上その印はもう誰も読まないので、**わざわざ「出さない」を選んだ
     紙が、版を上げただけで黙って1枚増える**（§9.132）。読み替えは
     ここ1箇所で、`rpShowBlock()`が押された時点で印そのものを捨てる。 */
  if(rpToken(RP_DEFECT_KEY,'長手:')==='なし')set.add(RP_DEFECT_ROLL_KEY);
  return set;
 }
 /* ---------- 紙のマス数(§9.173) ----------
    利用者の指示は「使用するグリッドサイズを標準で設定したうえで、各帳票
    ブロックの使用グリッドサイズの変更＆組合せができるように」。**粗いほど
    左端がそろう**（§9.135）ので、選べるのは4つだけにしてある。
    保存先は列レイアウトマスタの`widths`で、40＋数で入れる（§9.222 ②）。 */
 const RP_GRID_KEY='__グリッド__';
 /* ---------- 数の入れ方は「掛け算」から「足し算」へ（§9.222 ②） ----------
    列レイアウトマスタの`widths`はpxとして**40〜900へ丸められる**
    （`normalize_column_width`）。これまでは「数×倍率」で押し込んでいたが、
    マス数を24×48まで細かくした時点で**成り立つ倍率が1つも無くなる**——
    いちばん小さい1が下限に潰れないためには倍率≧40、いちばん大きい288が
    上限に潰れないためには倍率≦3。両立しない（§9.169・§9.221の追補で
    60→30と2度直したのは、この式の限界へ近づいていたということ）。
    なので**掛けるのをやめて足す**: 保存値＝40＋数。40が0（未設定）、
    900が860まで表せるので、いまの最大288に対して3倍の余裕がある。
    丸めが1度も起きないので「押しても保存されない設定」が原理的に作れない。

    古い保存値（×40 / ×60 / ×30）と見分けるために`__配置版__`を置く。
    **無い＝古い**として読み替え、**書くときは必ず全部を新しい形へ**
    書き直す（1つだけ新しい形で書くと、同じ`widths`に2つの意味が混ざる）。 */
 const RP_ENC_KEY='__配置版__';
 const RP_ENC_VER=3;
 const RP_ENC_BASE=40;                      /* `widths`の下限。0＝未設定 */
 const rpEnc=v=>RP_ENC_BASE+Math.max(0,Math.round(Number(v)||0));
 const rpDec=x=>Math.max(0,Math.round(Number(x)||0)-RP_ENC_BASE);
 /* ---------- 保存の基準（§9.222 ②） ----------
    マス数・段数を変えても意味が変わらないように、位置と大きさは**共通の
    細かい目盛**で持つ。目盛は選べるマス数の最小公倍数にしてあるので、
    どのマス数へ割り付け直しても**丸めが起きない**（144/24=6・/36=4・/48=3、
    288/48=6・/72=4・/96=3）。以前は12マス・12段基準だったため、24マスへ
    細かくしても保存の時点で半分に丸められ、**細かい調整が効かなかった**。 */
 const RP_COL_BASE=144;
 const RP_ROW_BASE=288;
 /* ---------- 紙の割り（§9.222 ②、利用者の指示） ----------
    「紙の段数とマス数を増やしてマス数24×段数48を最小値にしてそれ以上の
      数値も準備、さらに細かい調整もしっかりできるようにしたい」
    §9.135の「可能な限り粗いグリッド」は**画面のカード**の話で、紙の割付は
    別（利用者がここを明示的に上書きした）。粗いほど左端はそろうが、
    A4に十数個の塊を置くには12マスでは刻みが足りなかった。 */
 const RP_GRIDS=[24,36,48];
 const RP_GRID_DEFAULT=24;
 const RP_COLS=12;                          /* 古い保存値の既定（移行にだけ使う） */
 const RP_GRIDS_LEGACY=[4,6,8,12];          /* §9.173の紙のマス数 */
 const RP_PAGE_ROWS_LEGACY_CHOICES=[8,12,16,24];
 /* ---------- 古い割り（§9.222 ②の追補） ----------
    古い保存値は**そのとき選んでいたマス数・段数の中の位置**なので、
    読み替えの分母は**保存されている古い割り**でなければならない。12・12で
    決め打ちにすると、6マス24段で組んでいた現場の塊が**列は半分・段は倍**の
    ところへ飛ぶ（マス数を変えられる設定なのだから、既定だったとは限らない）。
    分母を出すのは`rpNum()`より前でよい——どちらも`__グリッド__`／
    `__行グリッド__`の生の値しか見ないので、塊の読み替えとは循環しない。 */
 function rpLegacyGrid(){
  const v=Math.round(rpRaw(RP_GRID_KEY)/60);
  return RP_GRIDS_LEGACY.includes(v)?v:RP_COLS;
 }
 function rpLegacyPageRows(){
  const v=Math.round(rpRaw(RP_PAGE_ROWS_KEY)/30);
  return RP_PAGE_ROWS_LEGACY_CHOICES.includes(v)?v:RP_PAGE_ROWS_LEGACY;
 }
 /* 保存されている生の数。**古い形なら読み替える**。`kind`は
    `count`（そのままの数）／`col`（列の基準）／`row`（段の基準）。 */
 function rpRaw(key){return Math.round(Number(WL.columnLayout.width(rpTarget(),key))||0)}
 function rpEncoded(){return rpRaw(RP_ENC_KEY)>RP_ENC_BASE}
 function rpNum(key,kind,legacyUnit){
  const raw=rpRaw(key);
  if(!raw)return 0;
  if(rpEncoded())return rpDec(raw);
  const v=Math.round(raw/legacyUnit);        /* 古い形（×40 / ×60 / ×30） */
  if(v<=0)return 0;
  const lg=rpLegacyGrid(),lr=rpLegacyPageRows();
  if(kind==='col')return Math.round((v-1)*(RP_COL_BASE/lg))+1;
  if(kind==='colspan')return Math.round(v*(RP_COL_BASE/lg));
  if(kind==='row')return Math.round((v-1)*(RP_ROW_BASE/lr))+1;
  if(kind==='rowspan')return Math.round(v*(RP_ROW_BASE/lr));
  return v;
 }
 function rpGrid(){
  const raw=rpRaw(RP_GRID_KEY);
  const v=rpEncoded()?rpDec(raw):Math.round(raw/60);
  return RP_GRIDS.includes(v)?v:RP_GRID_DEFAULT;
 }
 /* 幅の選択肢は**マス数から作る**（1/4・1/3・1/2・2/3・全幅）。割り切れない
    ものは近いマスへ寄せ、同じ幅が2つ並ばないようまとめる。 */
 function rpSpanChoices(){
  const g=rpGrid();
  const out=[];
  [[1,4],[1,3],[1,2],[2,3],[1,1]].forEach(([a,b])=>{
   const v=Math.max(1,Math.min(g,Math.round(g*a/b)));
   if(!out.some(o=>o.v===v))out.push({v,label:b===1?'全幅':`${a}/${b}`});
  });
  return out;
 }
 const rpSpanStore=v=>rpEnc(Math.max(1,Math.min(RP_COL_BASE,Math.round(v))));
 /* いまのマス数での幅。保存は`RP_COL_BASE`基準なので割り付け直す。 */
 function rpSpan(k){
  const g=rpGrid();
  const stored=rpNum(k,'colspan',60);
  /* 既定（`RP_BLOCKS`の`span`）は**12マス基準**で書いてある。 */
  const base=stored>0?stored:(((rpBlockOf(k)||{}).span||RP_COLS)*(RP_COL_BASE/RP_COLS));
  return Math.max(1,Math.min(g,Math.round(base*g/RP_COL_BASE)));
 }
 /* 保存する数へ戻す（`RP_COL_BASE`基準）。 */
 function rpSpanFromGrid(v){return Math.max(1,Math.min(RP_COL_BASE,Math.round(v*RP_COL_BASE/rpGrid())))}
 /* ---------- 高さと列幅(§9.174) ----------
    どちらも**列レイアウトマスタの`widths`**へ、接頭辞つきのキーで入れる
    （`高さ:<塊>` / `列幅:<塊>:<列>`）。`widths`はpxとして40〜900へ丸められる
    ので、pxで持つものはそのまま入る。**新しい保存先を作らない**——帳票の
    見せ方は全部この1件に載っている（§9.169）。
    ブロックのキーではないので`rpBlockKeys()`は拾わない（`__グリッド__`と同じ）。 */
 const RP_H_MIN=40,RP_H_MAX=900;
 const rpHeightKey=k=>`高さ:${k}`;
 const rpColWKey=(k,c)=>`列幅:${k}:${c}`;
 function rpDefaultHeight(k){return (rpBlockOf(k)||{}).h||0}
 /* 0＝中身なり（オートフィット）。**既定を持つ塊はその高さから始める**。 */
 function rpHeight(k){
  const raw=Math.round(Number(WL.columnLayout.width(rpTarget(),rpHeightKey(k)))||0);
  if(raw>=RP_H_MIN)return Math.min(RP_H_MAX,raw);
  return rpDefaultHeight(k);
 }
 /* ---------- 高さは「行数」で持つ（§9.217、利用者の指示） ----------
    「縦方向にはブロックが干渉回避のため行単位でのレイヤーが設けてありますが、
     下方向に余白がある場合は以降のレイヤーにも跨いで表示できるようにしたい。
     そのためにブロックごとに既定の高さを設定してその既定の高さでブロック
     高さを計算して配置させる必要があります。」

    以前は`align-items:start`の暗黙の行だったので、**1つ背の高い塊がいると
    その行ぜんぶがその高さになり**、隣に空白が残っていた。行の高さを
    `RP_ROW_PX`で固定し、塊は`grid-row: span R`で何行ぶんかを占める形にすると、
    背の低い塊が背の高い塊の隣へ回り込める（`grid-auto-flow:dense`）。

    **既定の行数は中身から測る**（`rpFitRows`）。決め打ちにすると、ロットに
    よって中身の量が違う塊（測定表・丈別データ）が必ずどちらかで崩れる。
    利用者が決めた行数があればそちらが勝つ。
    保存先は列レイアウトマスタの`widths`で、40＋数で入れる（§9.222 ②）。 */
 /* ---------- 紙は「縦12×横6」の粗いグリッド（§9.221 ⑨、利用者の指示） ----------
    「内容毎にカード(ブロック)サイズを正しく管理できていないようで、重なりが
     生じているのと、余白も含めて任意の場所に置けるようにしないと、意図しない
     形で詰まっていくので狙い通りの配置にできません。…縦12横6くらいのグリッドを
     作って、グリッドに収まる範囲でカード設計を行い設計したカードのサイズに
     合わせてコンテンツ貼り付けが良いと思います」

    以前との違いは3つ。
     ① **行の高さを紙から作る。** 24px固定だったので、A4縦1枚が44行あり、
        「1行」がカードの単位として意味を持たなかった。紙の刷れる高さを
        行数で割る（既定12行）ので、1マスがそのまま**紙の1/12**になる。
     ② **置き場所を利用者が決める。** 以前は`grid-auto-flow:dense`の自動配置
        だったので、1つ大きさを変えると後ろが全部動いた（「意図しない形で
        詰まっていく」の実体）。いまは塊ごとに「何列目・何行目」を持つ。
     ③ **中身を器へ合わせる。** 行数より背の高い中身は器から溢れて下の塊に
        重なっていた（「重なりが生じている」の実体）。器は`overflow:hidden`で
        大きさを守り、中身は入るところまで縮める（`rpFitBlockBodies`）。 */
 const RP_PAGE_ROWS_KEY='__行グリッド__';
 /* 紙の段数。**24マス×48段が最小**（利用者の指示）。段数は「紙の縦を
    何等分するか」なので、1マスがそのまま紙の1/N になる（48段でA4縦は
    1マス約5.9mm）。`RP_ROW_BASE`(288)はどれで割っても整数。 */
 const RP_PAGE_ROW_CHOICES=[48,72,96];
 const RP_PAGE_ROWS_DEFAULT=48;
 const RP_PAGE_ROWS_LEGACY=12;              /* 古い保存値の基準（移行にだけ使う） */
 function rpPageRows(){
  const raw=rpRaw(RP_PAGE_ROWS_KEY);
  const v=rpEncoded()?rpDec(raw):Math.round(raw/30)*(RP_PAGE_ROWS_DEFAULT/RP_PAGE_ROWS_LEGACY);
  if(RP_PAGE_ROW_CHOICES.includes(v))return v;
  /* 古い段数（8/12/16/24）は**いちばん近い新しい段数へ寄せる**——無効値と
     して既定へ落とすと、わざわざ選んでいた人ほど設定が黙って戻る
     （§9.132の`UI_SIZE_ALIASES`と同じ考え方）。 */
  if(v>0)return RP_PAGE_ROW_CHOICES.reduce((m,c)=>Math.abs(c-v)<Math.abs(m-v)?c:m,
    RP_PAGE_ROWS_DEFAULT);
  return RP_PAGE_ROWS_DEFAULT;
 }
 const rpPageRowsStore=v=>rpEnc(v);
 /* ---------- 紙ぜんたいの余白（§9.308、利用者の指摘） ----------
    「帳票ブロックマスタの余白詰めはうまくいっていないように見えます。
      項目間の余白や、項目内の余白も詰める余地があります」

    §9.303 ①の**詰める段は「溢れたときだけ」動く**ので、余っている塊では
    一度も走らない（実測: どの塊も詰めの印を持っておらず、器と中身の差は
    0px）。足りなかったのは**利用者が詰めると言える手立て**で、仕組みその
    ものは既にある——紙(`.rp-page`)へ余白の倍率を与えるだけにした
    （掛ける先はCSSが持つ・§9.163）。
    **既定は`ふつう`＝1**（詰めていない紙の見え方は1pxも変わらない・§9.132）。
    溢れた塊はこれより**さらに**詰まる（段は今までどおり）。 */
 /* ---------- 余白は「横」と「縦」の別の軸（§9.311 C、利用者の指示） ----------
    「縦横余白をコントロールする部分は分けたいです。また、横をメインで詰めたい
      ところ縦ばっかりでした」
    「『余白を詰める』＝**有効な文字の表示領域を増やす**と言い換えてもよい…
      同じ横幅のうち、**文字が折り返している部分**に特に注目する必要があります…
      セル内の余白、表の枠線に該当する部分の余白や、その枠線自体の太さ…
      **セル外の項目間の余白**が目立つ作りになっていてそこが詰まっていかない…
      「板厚」「板幅」と書いてある部分の**ラベル内の空白**も目立ちます…
      一番左側に表示しているロット№が**文字列折り返している**ので、そこを
      **1行で表示するような状態**に持っていきたいです」

    §9.308の余白の倍率は1つで両方を動かしていたが、**打つ手が正反対**
    （§9.294 ②で作業予定表について一度出した結論と同じ）——**縦**を詰めても
    行が薄くなるだけだが、**横**を詰めると空いたぶんが**文字の表示領域**へ回り、
    折り返していた文字列が1行に収まる。1つの軸だと「横を詰めたくて押したら
    行間ばかり詰まった」になる。
    `--rp-dense-x`／`--rp-dense-y`に分け、**掛ける先はCSSが持つ**（§9.163）。
    旧`__余白__`は**1度だけ両方へ移し、鍵は捨てる**（§9.294 ②／§9.132。
    わざわざ選んだ人の見え方を変えず、触っていない紙には新しい既定が届く）。

    **横は「余白を細くする」だけでは足りない**——表（`.rp-grid`）の列は
    `1fr`＝等分なので、余っている列が幅を抱えたまま詰まった列だけが折り返す。
    詰める段では**中身なりの列**へ切り替えて余力を要るところへ回す
    （§9.303 ①④の`rp-pack-share`と同じ考え方を`.rp-grid`へ広げたもの）。
    **合格の物差しは「折り返しが減ること」**（利用者の言葉「改行している状況で
    あれば余白の最適化はできていない」）——札が並ぶことではない。 */
 const RP_PACK_KEY='__余白__';                  /* 旧・1つで両方（移行用に読むだけ） */
 const RP_PACK_X_KEY='__余白横__';
 const RP_PACK_Y_KEY='__余白縦__';
 /* 横の段。**`share`＝列を中身なりにする**（等分をやめる）／**`thin`＝枠線を細く**。 */
 const RP_PACK_X_LEVELS=[
  {v:1,   share:false,thin:false,label:'ふつう',
   hint:'今までどおりの左右の余白です'},
  {v:.6,  share:true, thin:false,label:'詰める',
   hint:'項目間・セル内・ラベルの左右を6割へ。表の列を中身なりにして、余っている列の幅を詰まった列へ回します'},
  {v:.25, share:true, thin:true, label:'もっと詰める',
   hint:'左右を限界まで詰め、表の枠線も細くします。文字の大きさは変わりません'},
 ];
 const RP_PACK_Y_LEVELS=[
  {v:1,   label:'ふつう',      hint:'今までどおりの上下の余白・行送りです'},
  {v:.6,  label:'詰める',      hint:'項目の上下・表のセル・行送りを6割まで詰めます'},
  {v:.35, label:'もっと詰める',hint:'上下を限界まで詰めます。文字の大きさは変わりません'},
 ];
 /* 旧`__余白__`の段（1始まり。0＝未設定）。**読むだけ**——書き戻さない。
    `rpNum`の第3引数は**古い形の単位**（既定値ではない）ので1。 */
 function rpPackLegacyLevel(){
  const i=rpNum(RP_PACK_KEY,'count',1);
  return (i>=1&&i<=RP_PACK_Y_LEVELS.length)?i-1:-1;
 }
 function rpPackLevelOf(key,levels){
  const i=rpNum(key,'count',1);
  if(i>=1&&i<=levels.length)return i-1;
  /* まだ分けていない紙は、旧`__余白__`をそのまま両方の段として読む。 */
  const old=rpPackLegacyLevel();
  return old>=0?Math.min(old,levels.length-1):0;
 }
 const rpPackXLevel=()=>rpPackLevelOf(RP_PACK_X_KEY,RP_PACK_X_LEVELS);
 const rpPackYLevel=()=>rpPackLevelOf(RP_PACK_Y_KEY,RP_PACK_Y_LEVELS);
 const rpPackX=()=>RP_PACK_X_LEVELS[rpPackXLevel()];
 const rpPackY=()=>RP_PACK_Y_LEVELS[rpPackYLevel()];
/* 塊ごとの段（`rpApplyPack`）は`--rp-pack`という**別の変数**で持ち、CSSが
    紙の軸へ掛ける（§9.313）。以前ここにあった`rpPackDense()`（＝縦の段を
    下限として使う）は**廃した**——1つの値で両軸を決めることが、そもそも
    「横と縦を別々に」と食い違っていた。 */
 const rpPackStore=(i,levels)=>rpEnc(Math.max(1,Math.min(levels.length,i+1)));
 /* 紙へ与える。**CSSが読むのは`--rp-dense-x`／`--rp-dense-y`の2本**で、
    塊ごとの段（`rpApplyPack`）は`--rp-pack`という**別の1本**。CSSが
    `軸 × 段`と掛けるので（§9.313）、段はこれより**詰める方向にしか
    動けない**——以前は`Math.min`で気を付けていたが、フォールバックで
    読んでいたぶん「軸が未設定なら段がその軸になる」という抜け道があった。 */
 function rpApplyPaperPack(){
  const page=$id('reportContent');if(!page)return;
  const x=rpPackX(),y=rpPackY();
  const set=(name,v)=>{if(v>=1)page.style.removeProperty(name);
                       else page.style.setProperty(name,String(v))};
  set('--rp-dense-x',x.v);
  set('--rp-dense-y',y.v);
  /* **印はCSSが読む**（掛け算はCSSが持つ・§9.163）。`share`＝列を中身なりに、
     `thin`＝表の枠線を細く。 */
  page.classList.toggle('rp-packx-share',!!x.share);
  page.classList.toggle('rp-packx-thin',!!x.thin);
 }
 /* 巡回ボタン1枚（§9.247 ①）。**いま選んでいるものは文字で出す**（§3）——
    畳んだだけでは「思い出させない」に反する。次の値と何番目かは`title`。 */
 function rpPackCycleHtml(axis,name,levels,now){
  const cur=levels[now],next=levels[(now+1)%levels.length];
  return `<button type="button" class="rp-cycle" data-rp-pack="${axis}"`
   +` title="${esc(name)}の余白: ${esc(cur.label)}（${now+1}/${levels.length}）`
   +`&#10;${esc(cur.hint)}&#10;押すと「${esc(next.label)}」になります">`
   +`<i>${esc(name)}</i>${esc(cur.label)}</button>`;
 }
 /* 1行のpx。**CSSが紙から計算した値を読む**（`grid-auto-rows`の使用値）
    ——JSで紙のmmからpxを起こすと、表示倍率と紙の向きで必ずずれる。 */
 function rpRowPx(grid){
  const el=grid||document.querySelector('.rp-page .rp-blocks');
  const v=el?parseFloat(getComputedStyle(el).gridAutoRows):0;
  return v>0?v:24;
 }
 /* 高さの選択肢は**紙のぶんの1**で作る（§9.222 ②）。段数を細かくしたので、
    絶対の行数（1〜12行）を並べると48段の紙では全部「上のほう」にしかならず、
    どれを選んでも見た目が変わらない。1/12・1/8…と**紙に占める割合**で
    出し、いまの段数へ割り付ける。 */
 function rpRowChoices(){
  const pr=rpPageRows();
  const out=[];
  [[1,12],[1,8],[1,6],[1,4],[1,3],[1,2],[2,3],[1,1]].forEach(([a,b])=>{
   const v=Math.max(1,Math.round(pr*a/b));
   if(!out.some(o=>o.v===v))out.push({v,label:b===1?'全高':`${a}/${b}`});
  });
  return out;
 }
 /* 紙の下端よりどこまで下へ置けるか。**紙1.8枚ぶん**（旧: 12段の紙に対して
    22段まで）。溢れたぶんは紙が2枚になることを`rpUpdateSheets()`が言う。 */
 const RP_ROW_OVER=22/12;
 const rpRowCap=()=>Math.max(1,Math.round(rpPageRows()*RP_ROW_OVER));
 const rpRowCapBase=()=>Math.max(1,Math.round(RP_ROW_BASE*RP_ROW_OVER));
 const rpColKey=k=>`列:${k}`;
 const rpRowPosKey=k=>`行:${k}`;
 /* 位置は`RP_COL_BASE`／`RP_ROW_BASE`基準で持ち、読むときに今の割りへ
    当て直す。**丸めが起きない目盛**にしてあるので、マス数を往復しても
    置いた場所は1マスも動かない（以前は12基準だったので往復で流れた）。 */
 const rpColStore=c=>rpEnc(Math.max(1,Math.min(RP_COL_BASE,Math.round(c))));
 const rpRowStore=r=>rpEnc(Math.max(1,Math.min(rpRowCapBase(),Math.round(r))));
 const rpProject=(v,base,to,cap)=>Math.max(1,Math.min(cap||to,Math.round((v-1)*to/base)+1));
 const rpColToBase=c=>Math.max(1,Math.min(RP_COL_BASE,
   Math.round((c-1)*RP_COL_BASE/rpGrid())+1));
 const rpRowToBase=r=>Math.max(1,Math.min(rpRowCapBase(),
   Math.round((r-1)*RP_ROW_BASE/rpPageRows())+1));
 /* 置き場所が決まっているか。**0＝まだ決めていない**（初めて組み換えに
    入った時点で今の見え方をそのまま書き下ろす・`rpSeedPositions`）。 */
 function rpPos(k){
  const c=rpNum(rpColKey(k),'col',40),r=rpNum(rpRowPosKey(k),'row',40);
  if(!(c>0&&r>0))return null;
  return {col:rpProject(c,RP_COL_BASE,rpGrid()),
          row:rpProject(r,RP_ROW_BASE,rpPageRows(),rpRowCap())};
 }
 const rpRowsKey=k=>`行数:${k}`;
 /* 高さ（行数）も`RP_ROW_BASE`基準。**段数を変えても見た目の高さが
    変わらない**——以前は「絶対の行数」で持っていたので、段数を12から24へ
    変えると全部の塊が紙の半分の高さになっていた。 */
 const rpRowsStore=v=>rpEnc(Math.max(1,Math.min(rpRowCapBase(),Math.round(v))));
 /* **マスタに書いてある高さか**（§9.311 ④）。`rpRows()`は**コードの既定**
    （`rpBlockOf(k).rows`。ラベル貼付スペースのような枠だけの塊が持つ・§9.174）
    や旧いpxの高さも答えるので、「書き込んでよいか」の判定には使えない
    ——既定で立っている塊にも書いてしまい、**そのときの実測の高さが既定の
    代わりに焼き付く**（利用者の報告「この余白を詰めるボタンを押すと、また
    ブロックのサイズが勝手に変わる」の実体。実測: 押しただけで
    `行数:ラベル貼付スペース`が0件→1件）。書き戻してよいのは**利用者が
    自分で高さを決めた塊だけ**。 */
 const rpRowsSet=k=>rpNum(rpRowsKey(k),'rowspan',30)>0;
 function rpRows(k){
  const stored=rpNum(rpRowsKey(k),'rowspan',30);
  const toNow=v=>Math.max(1,Math.min(rpRowCap(),Math.round(v*rpPageRows()/RP_ROW_BASE)));
  if(stored>0)return toNow(stored);
  /* **旧いpxの高さ（§9.174）は行数へ読み替える。** 設定した人の意図
     （このくらいの高さ）はそのまま残す——読み替えないと、行の仕組みへ
     変えた瞬間に現場の設定が全部「中身なり」へ戻る。当時の1行=24px。 */
  const px=rpHeight(k);
  if(px>0)return toNow(Math.ceil(px/24)*(RP_ROW_BASE/RP_PAGE_ROWS_LEGACY));
  const def=(rpBlockOf(k)||{}).rows||0;      /* 既定も12段基準で書いてある */
  return def>0?toNow(def*(RP_ROW_BASE/RP_PAGE_ROWS_LEGACY)):0;   /* 0＝中身なり */
 }
 /* いまのマス（画面の数）→ 保存の基準。位置・幅・高さの**書き込みは
    必ずこの3つを通す**（散らばると片方だけ基準が古い状態が作れる）。 */
 const rpRowsFromGrid=r=>Math.max(1,Math.min(rpRowCapBase(),
   Math.round(r*RP_ROW_BASE/rpPageRows())));
 function rpColWidth(k,c){
  const raw=Math.round(Number(WL.columnLayout.width(rpTarget(),rpColWKey(k,c)))||0);
  return raw>=RP_H_MIN?Math.min(RP_H_MAX,raw):0;   /* 0＝オートフィット */
 }
 /* 表示パターン（そのまま／行列入れ替え／揃い欄の出し方）。`formats`は
    「値の整え方」の欄なので、帳票では「この塊の組み立て方」を持たせる。
    **hidden/widthsへ混ぜない**（あちらは出す出さないと寸法で、意味が違う）。

    **文字列のまま入れないこと**（§9.205）。サーバーの`normalize_format()`は
    **辞書以外をNoneへ落とす**ので、`formats[k]='転置'`と書くと画面では効くのに
    保存だけが黙って消える——実際に「行と列の入れ替え」は一度も保存されて
    いなかった（押した瞬間は変わるので、開き直すまで気づけない）。
    書式の`pattern`（60字まで）へ入れて往復させる。 */
 function rpPattern(k){
  const v=(WL.columnLayout.get(rpTarget()).formats||{})[k];
  if(!v)return '';
  /* 触っただけでまだ保存していない値は文字列のこともある（stageは素通し）。 */
  return String(typeof v==='string'?v:(v.pattern||''));
 }
 /* 表示パターンを差し替えた`formats`。**既定は行ごと消す**——空を保存すると
    「空という設定」になり、既定を変えたときに追随しない。 */
 function rpPatternPatch(k,v){
  const f={...rpLayoutNow().formats};
  if(v)f[k]={kind:'',pattern:String(v),decimals:null,thousands:false,prefix:'',suffix:''};
  else delete f[k];
  return f;
 }
 /* ---------- 見せ方の印は「|」で並べる（§9.226 ③） ----------
    1つの塊が持つ見せ方は1つとは限らない（行と列の入れ替え・中のデータの
    並べ方・丈別データの出し方）。**`formats`の置き場は1つ**（`pattern`、
    60字）なので、印を`|`で並べて持つ。**古い保存値はそのまま読める**
    ——`転置`だけ／`内訳`だけの文字列も、区切って読めば1つの印になる。 */
 function rpTokens(k){return String(rpPattern(k)||'').split('|').filter(Boolean)}
 function rpToken(k,prefix){
  const t=rpTokens(k).find(x=>x.indexOf(prefix)===0);
  return t?t.slice(prefix.length):'';
 }
 /* 印を1つだけ差し替えた`formats`（他の印は残す）。 */
 function rpTokenPatch(k,prefix,val){
  const t=rpTokens(k).filter(x=>x.indexOf(prefix)!==0);
  if(val)t.push(prefix+val);
  return rpPatternPatch(k,t.join('|'));
 }
 function rpFlagPatch(k,flag,on){
  const t=rpTokens(k).filter(x=>x!==flag);
  if(on)t.push(flag);
  return rpPatternPatch(k,t.join('|'));
 }
 function rpTransposed(k){return rpTokens(k).indexOf('転置')>=0}
 /* ---------- カードの中のデータの並べ方（§9.226 ③、利用者の指示） ----------
    「データの並びは横にある程度並べて次の行に行く形で横長に配置が多い。
     しかしその並び方を縦を先に並べていくパターンや幅方向長さが許す限り
     並べていくパターン、縦方向高さが許す限り並べるパターンなど、より
     フレキシブルなカードサイズに合わせたデータ配置が連動するように」

    4つ。**カードの大きさに連動するのは後ろの2つ**——列数を決めず、
    器に入るだけ並べる。 */
 const RP_FLOWS=[
  {v:'',    label:'横（列数を決める）',note:'左から右へ並べ、決めた列数で折り返します（今までの紙）。'},
  {v:'縦',  label:'縦（列数を決める）',note:'上から下へ並べ、決めた列数ぶんの段で次の列へ移ります。'},
  {v:'幅なり',label:'幅が許すかぎり横へ',note:'カードの幅に入るだけ横に並べます（列数はカードの大きさで決まります）。'},
  {v:'高さなり',label:'高さが許すかぎり縦へ',note:'カードの高さに入るだけ縦に並べ、入らなくなったら次の列へ（<b>高さを決めた塊だけ</b>）。'},
 ];
 function rpFlow(k){
  const v=rpToken(k,'流:');
  return RP_FLOWS.some(f=>f.v===v)?v:'';
 }
 const RP_FLOW_CLASS={'':'','縦':'rp-flow-col','幅なり':'rp-flow-fit','高さなり':'rp-flow-tall'};
 /* ---------- 枠（§9.234 ⑤、利用者の指示「エリアを枠(角丸の枠線)で囲う
    感じにしたいのでサイズ調整に合うようにカードサイズとほぼ同じ枠を
    付けたり外したりカスタム機能に追加してください」） ----------
    **3つの段**（既定／付ける／付けない）を`流:`と同じ`|`区切りの印で持つ
    （§9.226 ③。`formats`へ文字列を直に書かない＝§9.205）。
    **既定はエリアの塊だけ枠あり**——いまのラベル貼付スペースの見え方を保つ。
    枠は`.rp-block`（グリッドの子＝カードそのもの）に描くので、**大きさは
    常にカードと一致する**（中身側に描くと、中身なりの高さまでしか伸びない）。 */
 const RP_FRAMES=[
  {v:'',    label:'既定',    note:'エリアの塊は枠あり、ふつうの塊は枠なしです。'},
  {v:'あり',label:'付ける',  note:'カードとほぼ同じ大きさの角丸の枠で囲みます。'},
  {v:'なし',label:'付けない',note:'枠を出しません（中身だけを置きます）。'},
 ];
 function rpFramed(k){
  const v=rpToken(k,'枠:');
  if(v==='あり')return true;
  if(v==='なし')return false;
  return !!(rpBlockOf(k)||{}).area;
 }
 /* 帳票本体のHTML生成。一括印刷（複数ロットをまとめて別ページへ流し込む）でも
    同じHTMLを使うため、単一プレビューへの書き込みとは分離してある。
    `arranging`が真のときだけ、ブロックごとの操作帯を差し込む——**紙には
    絶対に出さない**ので、印刷経路（`arranging`を渡さない）では組み立て自体を
    しない（CSSで隠すやり方だと、隠し忘れがそのまま紙に出る）。 */
 function reportHtml(x,arranging){
  /* **組み立てのあいだだけ**その紙の設備で固定する（§9.239 ③）。
     以前は代入しっぱなしで、`requestAnimationFrame`のあとに走る測り直しが
     最後のロットの設備で解いていた（§9.174の罠が半分だけ塞がっていた）。
     組み換え中は`rpEditEquipment`が選んだ設備で描くので固定しない
     ——他設備の配置を編集するときに、見本の紙だけ別の設定になるのを防ぐ。 */
  if(rpArranging&&rpEditEquipment!=null)return reportHtmlInner(x,arranging);
  return rpWithLot(x,()=>reportHtmlInner(x,arranging));
 }
 function reportHtmlInner(x,arranging){
  const b=x.basic||{},s=x.settings||{};
  const equipment=s.registeredEquipment||x.registeredEquipment||x.snapshot?.registeredEquipment||'-';
  /* 帳票の頭は**「どこで・いつ・どのロットか」**（§9.161、利用者の指示
     「設備名と作業年月日をロット番号の前に追加して」）。紙は1枚ずつ配られ、
     手元では並べ替えられるので、ロット番号だけでは束ねられない。
     **この見出しはブロックにしない**——この紙がどれかを決める鍵なので、
     隠せてしまうと配ったあとで区別が付かなくなる。
     作業年月日は**作業開始時刻の日付**。未記録なら終了時刻→更新日時の順に
     落とし、**どこから取ったかを添える**（同じ日付でも当たる見込みが違う。
     紙にはtitleが出ないので画面と同じ文字で書く）。 */
  const w=x.workTime||{};
  const workDay=(()=>{
   const pick=[[w.startAt,''],[w.endAt,'（終了時刻から）'],[x.updatedAt,'（更新日時から）']]
     .find(([v])=>v&&!Number.isNaN(new Date(v).getTime()));
   if(!pick)return{text:'未記録',note:''};
   const d=new Date(pick[0]);
   return{text:d.toLocaleDateString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit'}),note:pick[1]};
  })();
  /* 3つは**同じ大きさで左から横に並べる**（利用者の指示）。どれも「この紙が
     どれか」を決める鍵で、大きさに差を付けると設備・日付が添え物に見える。 */
  return `
   <div class="rp-report-head">
    <div class="rp-report-head-id">
     <span class="rp-head-fact"><small>設備名</small><b>${esc(equipment)}</b></span>
     <span class="rp-head-fact"><small>作業年月日</small><b>${esc(workDay.text)}</b>${workDay.note?`<i>${esc(workDay.note)}</i>`:''}</span>
     <h2 class="rp-head-fact"><small>ロット番号</small><b>${esc(b.lotNo||x.id)}</b></h2>
    </div>
    <div class="rp-report-head-meta"><span class="rp-status-badge ${WL.base.statusClass(x.status)}">${esc(WL.base.statusLabel(x.status))}</span><span>帳票作成: ${esc(fmtDT(new Date().toISOString()))}</span></div>
   </div>
   ${reportBlocksHtml(x,arranging)}
  `;
 }
 /* ---------- 「出さない塊」は配置面に出さない（§9.222 ③、利用者の指示） ----------
    「非表示がゴーストで表示エリアに出現しているため、配置調整できない。
      非表示内容はレイアウト上からも非表示にしてほしい。非表示があるせいで、
      本来の見た目の大きさと表のサイズ感がわからない。ゴーストが重なりまくる
      ので位置調整がしにくいしわかりにくい。」
    以前は「何を外しているか分かるように」薄く並べていたが、**外した塊も
    マスを占有していた**ので、外せば外すほど紙が埋まって置き場所が無くなる
    ——直したい姿（刷り上がり）とまるで違うものを見ながら調整していた。
    いまは**置き場（`#rpPalette`）だけ**に出す。何を外しているかは置き場の
    見出しが件数で言い、掴めば戻せる（§9.217の入口をそのまま使う）。 */
 let rpPaperView=false;
 function reportBlocksHtml(x,arranging){
  const hidden=rpHiddenSet();
  const paper=arranging&&rpPaperView;      /* 組み換え中だが、紙のとおりに見る */
  /* **重ならないところまでを描く側が決める**（§9.221 ⑨）。保存されている
     位置は「希望」で、マス数・段数を変えたときの丸めや古い設定で重なりうる。 */
  const spots=rpResolvePlacement();
  const cells=rpBlockKeys().map(k=>{
   const bl=rpBlockOf(k);if(!bl)return '';
   /* **出さない塊はここで落とす**（§9.222 ③）。組み換え中も落とす——
      占有したままだと、外した塊のぶんだけ置き場所が無くなる。 */
   if(hidden.has(k))return '';
   let body='';
   try{body=bl.html(x)||''}catch(e){body=''}   /* 1つ壊れても紙全体を落とさない */
   if(!body&&(!arranging||paper))return '';
   const span=rpSpan(k),rows=rpRows(k);
   /* 行数が決まっているものはここで割り当てる。0（中身なり）は描いてから
      `rpFitRows()`が測って入れる（§9.217）。 */
   /* **置き場所が決まっていればそのマスへ置く**（§9.221 ⑨）。決まって
      いない塊だけが今までどおり自動で流れる——初めて組み換えに入った
      時点で`rpSeedPositions()`が今の見え方を書き下ろすので、そこから先は
      触った塊以外は1ミリも動かない。 */
   const at=spots&&spots.get(k);
   const place=at
     ?`grid-column:${at.col}/span ${at.span};grid-row:${at.row}/span ${at.rows}`
     :`grid-column:span ${span}${rows?`;grid-row:span ${rows}`:''}`;
   /* 重なりは**縁と文字**で言う（§3）。数は帯のチップが持つ。 */
   const ov=(arranging&&!paper&&rpOverlaps.indexOf(k)>=0);
   /* 中のデータの並べ方（§9.226 ③）。**紙でも同じ**なので、組み換え中か
      どうかに関わらず当てる（刷り上がりと違う姿を見せない）。 */
   const flow=RP_FLOW_CLASS[rpFlow(k)]||'';
   /* 枠（§9.234 ⑤）。**紙も画面も同じ組み立てを通る**ので、刷り上がりと
      組み換え中の姿が食い違わない。 */
   const framed=rpFramed(k),isArea=!!bl.area;
   /* **高さを決めた塊か**（§9.242 ⑧）。中の枠を器いっぱいへ伸ばしてよいのは
      こちらだけ——中身なりの塊で伸ばすと、`rpFitRows()`が測る`scrollHeight`が
      器の高さになり、行数が決まらなくなる（自分の高さで自分の高さを決める）。 */
   return `<div class="rp-block${body?'':' is-empty'}${at?' is-placed':''}${ov?' is-overlap':''}`
    +`${rows?' is-sized':''}`
    +`${framed?' is-framed':''}${isArea?' is-area':''}`
    +`${flow?' '+flow:''}" data-rp-block="${esc(k)}"`
    +` style="${place}"`
    +`${(arranging&&!paper)?' draggable="true"':''}>`
    /* **マウスオーバーの浮き帯は置かない**（§9.226 ③、利用者の指示
       「カードのサイズ変更をしやすいように、マウスオーバー時のフローティング
        表示は不要なので削除してください」）。縁を掴んで大きさを変える操作の
       上に、触れると出る帯が重なっていたため、掴む前に帯が現れて的が消えて
       いた。塊の名前は**刷り上がりの見出し（`<h3>`）がそのまま名乗る**ので、
       帯が無くてもどれがどれかは読める。設定はダブルクリックで開く窓が持つ。 */
    /* **中身は1枚の器に包む**（§9.221 ⑨）。器の大きさは利用者が決めた
       ものなので、入らないときは中身のほうを縮める（`rpFitBlockBodies`）
       ——包まないと、縮める対象が「操作帯ごと」になって帯まで小さくなる。 */
    +`<div class="rp-block-fit">`
    +(body||((arranging&&!paper)?'<p class="rp-block-empty">このロットにはこの内容がありません（紙には出ません）。</p>':''))
    +'</div>'
    /* **縁を引いて大きさを変えられる**（§9.218 ⑥、利用者の指示「選択した
       ときに縦横のサイズ変更ができるように」）。掴んでいるあいだ何マス×何行に
       なるかを出す。
       **四辺と四隅の8方向すべてで変えられる**（§9.283、利用者の指示「左、
       左下、左上、上、右上の部分でもすべての頂点、辺でサイズ変更できるように」）
       ——以前は右・下・右下の3つだけで、**紙の右下へ寄せた塊は左や上へ
       広げる手立てが無かった**（いったん動かしてから広げて戻す、という
       3手が要る）。左・上を引いたときは**置き場所も一緒に動かす**
       （引いた辺だけが動き、反対の辺は釘で留まったように見えるのが正しい）。
       綴りは`t/b/l/r`＋四隅で、**`w`を「幅」の意味で使わない**——方角の
       `west`と読み違える（旧`w`＝右辺・`h`＝下辺・`wh`＝右下）。 */
    /* **この紙だけの見え方の入口**（§9.274）。左上の隅の取っ手と重なるので
       **取っ手より手前に出す**（`z-index`。§9.226 ③で浮き帯を外したのは、
       掴む的の上に帯が現れて的が消えたからで、こちらは的が小さく固定）。 */
    +((arranging&&!paper)?'<button type="button" class="rp-block-paper" data-rp-paper'
      +' title="この紙（この設備）でだけの幅・高さ・列幅・行列入れ替えを決めます。'
      +'塊そのもの（名前・載せる項目・書式）はダブルクリックで帳票ブロックマスタへ">紙</button>':'')
    +((arranging&&!paper)?RP_GRIPS.map(g=>
        `<span class="rp-size-grip rp-size-${g.k}" data-rp-grip="${g.k}" title="${esc(g.t)}"></span>`).join(''):'')
    +'</div>';
  }).join('');
  /* **マスの目盛を器が持つ**（§9.218 ⑥、利用者の指摘「横がそろっていても
     グリッドがなくなってしまった」）。列数と行の高さをCSSへ渡し、背景の
     線として引く——要素を作らないので、塊の並びにも印刷にも一切影響しない。 */
  return `<div class="rp-blocks${(arranging&&!paper)?' is-arranging':''}"`
   +` style="--rp-grid:${rpGrid()};--rp-page-rows:${rpPageRows()}">${cells}</div>`;
 }
 /* 大きさを変える取っ手は**四辺＋四隅の8つ**（§9.283）。**辺を先・隅を後**に
    並べること——同じ`z-index`なので、後に書いたほうが手前に来る（隅は辺の
    上に重なるので、先に書くと角が掴めない）。 */
 const RP_GRIPS=[
  {k:'t',t:'上の辺。引くと高さ（行）が変わり、上へ広げると置き場所も上がります'},
  {k:'b',t:'下の辺。引くと高さ（行）が変わります'},
  {k:'l',t:'左の辺。引くと幅（マス）が変わり、左へ広げると置き場所も左へ動きます'},
  {k:'r',t:'右の辺。引くと幅（マス）が変わります'},
  {k:'tl',t:'左上の角。引くと幅と高さが変わり、置き場所も動きます'},
  {k:'tr',t:'右上の角。引くと幅と高さが変わります（上へ広げると置き場所も上がります）'},
  {k:'bl',t:'左下の角。引くと幅と高さが変わります（左へ広げると置き場所も左へ動きます）'},
  {k:'br',t:'右下の角。引くと幅と高さが変わります'},
 ];
 /* 組み換え中だけ出る操作帯。**押した結果がその場の紙に出る**のがこの機能の
    値打ちなので、確認を挟まず即座に当てる（保存するまでは戻せる）。 */
 /* この塊が測定データなら、どの群を持っているか。まとめは載っている群ぜんぶ、
    分解した1枚はその群だけ。**落とせる単位＝列**を出すために使う（§9.173）。 */
 function rpBlockMeasGroups(k){
  if(k===RP_MEAS_COMBINED)return rpMeasGroupsFor('combined');
  const bl=rpBlockOf(k);
  return bl&&bl.meas?[RP_MEAS_GROUP_BY.get(bl.meas)].filter(Boolean):[];
 }
 /* 旧・組み換え中の浮き帯（`rpBlockBarHtml`）は廃止した（§9.226 ③、
    利用者の指示「マウスオーバー時のフローティング表示は不要なので削除して
    ください」）。持っていた操作は**ダブルクリックで開く設定の窓**へ移した
    ——幅・高さ・行と列・列幅・紙に出す/出さない・まとめ↔分解・落とせる列。
    入口を2つ持つと、片方だけ直した状態が作れる（§CLAUDE 8）。 */
 /* **入りきらないことは黙って隠さない**（§9.173、利用者の指示「グリッド変更時
    データが入りきらない場合は選択できるがデータを絞るように絞れる内容を提示
    する」）。幅は選べるままにして、**何を落とせるか**をその場に出す。
    判定は描いたあとの実寸で行う——列の数や文字数から見積もると、表示サイズ・
    紙の向き・ロットごとの列数で必ずずれる。 */
 /* **紙に収まっているかを実寸で言う**（§9.174）。用紙はmm固定なので、
    中身の高さと刷れる高さを比べれば何枚になるかまで言える。**見た目の
    拡大率(--rp-scale)を打ち消してから測る**——倍率を掛けたまま比べると、
    表示を縮めただけで「収まった」ことになる。 */
 /* **紙が何枚になるかは`rpSheetFacts()`の1箇所が答える**（§9.281）。
    切れ目の描画・収まりの帯・切れる塊の印が同じ答えを見る——別々に数えると
    「帯は1枚と言うのに紙は2枚ぶん出ている」が作れる（実際にそうなっていた）。

    **物差しは紙の「幅」から作る**（§9.281）——高さは中身が溢れるとそのぶん
    伸びるので、高さを基準にすると**自分自身と比べる**ことになり、
    どれだけ溢れても必ず「1枚（残り0mm）」になる。幅は210mm（横向きは297mm）で
    動かないので、`px/mm`はここからしか作れない。 */
 function rpSheetFacts(page){
  if(!page)return null;
  const cs=getComputedStyle(page);
  const scale=Number(cs.getPropertyValue('--rp-scale'))||1;
  const land=page.classList.contains('rp-landscape');
  const sheetMm=land?210:297, wideMm=land?297:210;
  const pr=page.getBoundingClientRect();
  const pxPerMm=(pr.width/(scale||1))/wideMm;
  if(!(pxPerMm>0))return null;
  const top=pr.top;
  const blocks=[...page.querySelectorAll('.rp-block')];
  const body=page.querySelector('.rp-blocks');
  /* **中身の下端で測る**（§9.174）。紙は`min-height`を持つので、
     `scrollHeight`は常に紙いっぱいになり「残り0mm」としか言えない。 */
  const bottom=blocks.reduce((m,b)=>Math.max(m,b.getBoundingClientRect().bottom),
    body?body.getBoundingClientRect().bottom:top);
  const mmOf=px=>(px/(scale||1))/pxPerMm;
  const contentMm=mmOf(bottom-top)+RP_PAGE_PAD_MM;   /* 下の余白ぶんも要る */
  const sheets=Math.max(1,Math.ceil((contentMm-0.5)/sheetMm));
  /* 切れ目にかかる塊。**下端は少しだけ内側で見る**——罫線の丸めで
     ちょうど境目に接している塊まで「切れる」と数えてしまう。 */
  const at=mm=>Math.floor(mm/sheetMm+1e-6);
  const cut=blocks.filter(b=>{
   const r=b.getBoundingClientRect();
   return at(mmOf(r.top-top))!==at(Math.max(0,mmOf(r.bottom-top)-0.4));
  });
  return {sheets,sheetMm,contentMm,land,cut,scale,pxPerMm,
    overMm:Math.max(0,contentMm-sheetMm),
    restMm:Math.max(0,sheets*sheetMm-contentMm)};
 }
 /* 紙の切れ目を描き、収まりを帯へ出す（§9.281、利用者の指示「印刷プレビュー
    らしくどこで用紙が区切られて表示が切れるかわかるように」）。
    **描くのはプレビューだけ**——刷る側のDOM（`#reportBulkPrintArea`と
    `rpPageHtmlFor()`の写し）からは外す（紙に線が出る）。 */
 /* **測る前に前回の割り当てを外す**（§9.217と同じ作法）。ページに割ると
    塊へ`transform`が付くので、外さずに測ると**ずらしたぶんだけ紙が伸び続ける**
    ——`rpFitRows()`など`getBoundingClientRect()`で測る処理も同じ理由でここを
    先に通す（`rpFitAll`／`rpMarkOverflow`の頭）。 */
 function rpClearSheets(page){
  if(!page||!page.classList)return;
  page.classList.remove('rp-paged');
  page.style.removeProperty('--rp-sheets');
  page.style.removeProperty('--rp-gap');
  const lay=page.querySelector(':scope > .rp-sheets');
  if(lay)lay.remove();
  page.querySelectorAll('.rp-block[data-rp-shift]').forEach(b=>{
   b.removeAttribute('data-rp-shift');b.removeAttribute('data-rp-clip');
   b.style.removeProperty('--rp-shift');
   b.style.removeProperty('--rp-clip-t');b.style.removeProperty('--rp-clip-b');
  });
  page.querySelectorAll('.rp-block[data-rp-cut]').forEach(b=>{
   b.removeAttribute('data-rp-cut');b.classList.remove('is-cut');b.removeAttribute('title');
  });
 }
 /* 紙の切れ目を描き、収まりを帯へ出す（§9.281、利用者の指示「印刷プレビュー
    らしくどこで用紙が区切られて表示が切れるかわかるように」）。
    **描くのはプレビューだけ**——刷る側のDOM（`#reportBulkPrintArea`と
    `rpPageHtmlFor()`の写し）からは外す（紙に線が出る）。 */
 function rpUpdateSheets(){
  /* **紙は`#reportContent`そのもの**（`.rp-report.rp-page`）。
     `#reportContent .rp-page`と書くと1つも見つからない。 */
  const page=$id('reportContent');
  if(!page||!page.classList.contains('rp-page')){rpPaintPageFit(null);return null}
  rpClearSheets(page);
  const f=rpSheetFacts(page);
  if(!f)return null;
  page.style.setProperty('--rp-sheets',String(f.sheets));
  if(f.sheets>1){
   rpPaintPages(page,f);
   f.cut.forEach(b=>{
    b.classList.add('is-cut');b.dataset.rpCut='1';
    b.title='この塊は用紙の切れ目にかかっています（途中で切れて次の紙へ続きます）。';
   });
  }
  rpPaintPageFit(f);
  return f;
 }
 /* 紙を1枚ずつに割る（§9.281 の追補）。
    **ページのあいだへ本物の余白を空け、中身を1枚ぶんずつ下へずらす**
    ——各紙の中での位置は1mmも変わらないので、刷り上がりとは食い違わない
    （§9.242 ⑦「プレビューどおりに刷る」）。よくある印刷プレビューと同じ形。

    **組み換え中はつなげたまま**にする——掴んで置く座標は`rpLocal()`と
    `rpFreeCells()`が`getBoundingClientRect()`から解いており、塊をずらすと
    **落とす先が余白のぶんずれる**。組み換えは1枚のキャンバスの上で行い、
    どこで紙が変わるかは点線が言う（帯にも書く）。 */
 function rpPaintPages(page,f){
  /* **組み換え中でも割る**（§9.282、利用者の報告「点線が引かれるだけ」）。
     以前はここで`!rpArranging`にしていたが、利用者が紙を見るのは
     組み換え中の画面なので、いちばん見たいところで割れていなかった。
     掴んで置く座標は`rpLocal()`が余白を差し引き、空きマスの印と
     ゴーストは同じだけずらすので、落とす先はずれない。 */
  const paged=true;
  page.classList.toggle('rp-paged',paged);
  page.style.setProperty('--rp-gap',(paged?RP_SHEET_GAP_MM:0)+'mm');
  const lay=document.createElement('div');
  lay.className='rp-sheets';lay.setAttribute('aria-hidden','true');
  let h='';
  for(let k=0;k<f.sheets;k++)
   h+=`<span class="rp-sheet" style="--k:${k}"></span>`
     +`<span class="rp-sheet-no" style="--k:${k}">${k+1}枚目</span>`;
  /* つなげて出すときだけ切れ目の線が要る（割ってあれば余白がそれを言う）。 */
  if(!paged)for(let k=1;k<f.sheets;k++)h+=`<span class="rp-sheet-cut" style="--k:${k}"></span>`;
  lay.innerHTML=h;
  page.appendChild(lay);
  if(!paged)return;
  const sc=f.scale||1;
  const pr=page.getBoundingClientRect();
  /* **組み換え中は塊を切らない**（§9.283、利用者の報告「今までできていた
     ドラッグアンドドロップによる紙帳票レイアウト修正のところができなくなる」）。
     `clip-path`は**当たり判定まで切る**ので、紙をまたぐ塊は切れ目から下が
     掴めなくなり、大きさを変えるつまみ（右・下・右下）が**1つも押せなくなる**
     ——しかもいちばん直したい塊（紙からはみ出している塊）でだけ起きる。
     続きの写し（`.rp-blk-tail`）は`.rp-sheets`の中＝`pointer-events:none`
     なので、そちらを掴んでも何も起きない。
     組み換え中は**丸ごと出して**余白をまたがせ、切れることは
     `is-cut`の印と帯の件数が言う（§3）。ふだんのプレビューは今までどおり
     切って、続きを次の紙の頭へ置く（刷り上がりと同じ絵）。 */
  const keepWhole=rpArranging;
  /* **物差しは`rpPageMetrics()`の1箇所**（§9.283）。塗る側と数える側が
     同じ答えを見るので、「掴んだ場所と落ちる場所がずれる」を作れない
     ——`f`から別に計算し直すと、同じ数を2箇所で作ることになる。 */
  const M0=rpPageMetrics();
  const S=M0.sheet;                            /* 拡大前の1枚ぶん(px) */
  const G=M0.gap;                              /* 拡大前の余白(px) */
  if(!(S>0))return;
  page.querySelectorAll('.rp-block').forEach(b=>{
   const r=b.getBoundingClientRect();
   const bt=(r.top-pr.top)/sc,bb=(r.bottom-pr.top)/sc;
   const bl=(r.left-pr.left)/sc,bw=r.width/sc,bh=r.height/sc;
   const k0=Math.floor(bt/S+1e-6);
   const k1=Math.max(k0,Math.floor(Math.max(0,bb-0.4)/S+1e-6));
   /* **計算した数はカスタムプロパティで渡す**（`tests/test_csslint.py`）
      ——`transform`のような見た目をインラインで直書きすると、どのレイヤからも
      打ち消せなくなる。使い方（ずらす・切る）はCSSに残す。 */
   b.dataset.rpShift='1';
   b.style.setProperty('--rp-shift',(k0*G)+'px');
   if(k1===k0||keepWhole)return;
   /* **切れ目にかかる塊は切って、続きを次の紙の頭へ置く**（紙の上で
      起きることと同じ）。元は1枚目に残るぶんだけ見せ、続きは写しで出す
      ——写しは`data-rp-block`を持たないので、置き場所を数える処理
      （`rpFreeCells`等）からは見えない。 */
   b.dataset.rpClip='1';
   b.style.setProperty('--rp-clip-t','0px');
   b.style.setProperty('--rp-clip-b',Math.max(0,bb-(k0+1)*S)+'px');
   for(let k=k0+1;k<=k1;k++){
    const y0=k*S,y1=Math.min(bb,(k+1)*S);
    const c=b.cloneNode(true);
    c.removeAttribute('id');c.removeAttribute('data-rp-block');
    c.removeAttribute('data-rp-shift');
    c.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));
    c.classList.add('rp-blk-tail');
    c.style.setProperty('--tx',bl+'px');c.style.setProperty('--ty',(bt+k*G)+'px');
    c.style.setProperty('--tw',bw+'px');c.style.setProperty('--th',bh+'px');
    c.style.setProperty('--rp-clip-t',(y0-bt)+'px');
    c.style.setProperty('--rp-clip-b',Math.max(0,bb-y1)+'px');
    lay.appendChild(c);
   }
  });
  /* **空きマスの印も同じだけずらす**（§9.282）——ずらさないと、組み換え中に
     「ここが空いています」の枠だけが紙をまたいで残る。印は`rpFreeCells()`が
     グリッドの中へpxで置いているので、その`top`へ足すだけでよい。
     **元の位置を覚えてから足すこと**（§9.283）——`style.top`へ足し込む形だと
     `rpUpdateSheets()`が2回走っただけで**印だけが1枚ぶんずつ下へ流れていく**
     （印は`rpFreeCells()`が作り直したときしか元に戻らない）。 */
  page.querySelectorAll('.rp-free-layer > i').forEach(i=>{
   const t=(i.dataset.rpTop!==undefined)?Number(i.dataset.rpTop):(parseFloat(i.style.top)||0);
   i.dataset.rpTop=String(t);
   i.style.top=(t+rpShiftAt(M0,t+M0.gridTop))+'px';
  });
 }
 /* ---------- 収まりは短く言い、続きは`title`（§9.255 ①） ----------
    帯を1行にした（利用者の指示「コンパクトに2行分くらいに」）ので、
    ここの文が長いと**帯だけで折り返す**。**数は落とさない**
    （§CLAUDE 6「暗算をさせない」）——枚数と残り／超過のmmは短い形で必ず
    出し、言い回しは`title`が持つ。 */
 function rpPaintPageFit(f){
  const el=$id('rpPageFit');if(!el)return;
  if(!f){el.textContent='';el.removeAttribute('title');return}
  const dir=f.land?'横':'縦';
  const mm=v=>Math.round(v);
  if(f.sheets<=1){
   el.className='rp-page-fit is-ok';
   el.textContent=`A4${dir} 1枚（残り${mm(f.restMm)}mm）`;
   el.title=`いまの配置はA4${dir}1枚に収まっています（残り約${mm(f.restMm)}mm）。`;
   return;
  }
  /* **切れる塊は件数を文字で出す**（§3。紙の上の点線だけでは、いくつが
     切れるのか数えることになる）。 */
  const n=f.cut.length;
  el.className='rp-page-fit is-over';
  el.textContent=`A4${dir} ${f.sheets}枚（${mm(f.overMm)}mm超過`+(n?`・切れる塊${n}件`:'')+'）';
  el.title=`いまの配置はA4${dir}1枚に収まりません（約${mm(f.overMm)}mm超過するので${f.sheets}枚になります）。`
   +(n?`用紙の切れ目にかかる塊が${n}件あり、途中で切れて次の紙へ続きます。`:'')
   /* **見え方が場面で違うことは書く**（§4）——組み換え中だけ紙をつなげて
      出しているので、黙っていると「さっきまで割れていたのに」と読まれる。 */
   +(rpArranging
     ?'組み換え中は1枚のキャンバスとしてつなげて出しています（切れ目は点線）。'
     :'プレビューはページごとに割って出しています。')
   +'塊の高さを下げるか、要らない塊を「出していない塊」へ落としてください。';
 }
 /* **既定の高さは中身から測る**（§9.217）。
    **測る前に前回の割り当てを外すこと**——付いたまま測ると、一度低くなった
    塊は二度と高くならない（§9.210 ④で条の図のラベルが踏んだのと同じ罠）。
    外すのと測るのは**別のまわし**にする（1つずつ外して測ると、その都度
    グリッド全体が組み直されて遅い）。 */
 function rpFitRows(host){
  const grid=host.querySelector('.rp-blocks');if(!grid)return;
  const gap=parseFloat(getComputedStyle(grid).rowGap)||0;
  const auto=[];
  const rowPx=rpRowPx(grid);
  grid.querySelectorAll('[data-rp-block]').forEach(el=>{
   const k=el.dataset.rpBlock,fixed=rpRows(k);
   /* **高さを決めた塊は測らない**（§9.221 ⑨）。器の大きさは利用者が
      決めたものなので、中身に合わせて伸ばすと隣へ重なる（それが「重なりが
      生じている」の実体だった）。中身のほうを`rpFitBlockBodies()`が縮める。
      **場所を決めただけの塊は測る**（§9.222 ②）——場所で切ると、置いた
      瞬間に「中身なり」の塊まで1行へ潰れる（当たり判定は`rpEffRows()`が
      描かれている高さを見るので、重なりはちゃんと数えられる）。 */
   if(fixed>0)return;
   el.style.gridRowEnd='';el.style.minHeight='';
   const fit=el.querySelector(':scope>.rp-block-fit');
   /* 前回の縮小と**詰め**を外してから測る（§9.298。詰めたまま測ると、
      その塊に要る段数を少なく見積もる）。 */
   if(fit){fit.style.removeProperty('--rp-fit');fit.style.removeProperty('--rp-pack');
           fit.classList.remove(...RP_PACK_CLASSES)}
   auto.push(el);
  });
  if(!auto.length)return;
  /* **中身の高さを測る。器の高さではない**（§9.222 ②）。器は
     `grid-auto-rows`で1行ぶんに決まっていて`overflow:hidden`なので、
     `getBoundingClientRect().height`は**いつも1行**を返す——それを1行で
     割れば必ず1行になり、**どの塊も「中身なり」で伸びない**。段数が12
     だった頃は1行が88pxあってたまたま入っていたが、48段（1行22px）に
     した瞬間に全部が「入りきりません」になった（実測）。
     `scrollHeight`／`offsetHeight`は**拡大前のCSS px**なので、`rowPx`
     （こちらも拡大前）とそのまま比べられる（`getBoundingClientRect()`は
     拡大後なので混ぜないこと）。 */
  /* **操作帯の高さは足さない**（§9.223 ①）。帯は`position:absolute`の層に
     なったので流れの中に場所を取らない——足すと組み換え中だけ器が高くなり、
     「刷ったとおりの見た目」が崩れる。 */
  const need=auto.map(el=>{
   const fit=el.querySelector(':scope>.rp-block-fit');
   return fit?fit.scrollHeight:el.scrollHeight;
  });
  auto.forEach((el,i)=>{
   const rows=Math.max(1,Math.min(rpRowCap()*2,
     Math.ceil((need[i]+gap)/(rowPx+gap))));
   el.style.gridRowEnd='span '+rows;
  });
 }
 /* ---------- 空いているマスを見せる（§9.218 ⑥、利用者の指示） ----------
    「配置のしにくさはグリッドとの関係性がわからないことにありそうです。
      配置している周辺のブロックから空白部分のグリッドを計算できるので
      配置しやすい、配置できるかどうかわかりやすくしてください」

    **グリッドの中へ要素として入れないこと。** `grid-column`/`grid-row`を
    数字で指定した子は、`span`しか持たない塊より**先に**置かれるので、
    空きの印を入れた瞬間に塊のほうが押し出される（`dense`の自動配置は
    位置が決まっているものを先に処理する）。器の上へ**絶対配置の層**として
    重ね、px で置く——並びにも印刷にも一切影響しない。 */
 function rpFreeCells(host){
  const grid=host.querySelector('.rp-blocks');if(!grid)return 0;
  let layer=grid.querySelector(':scope>.rp-free-layer');
  if(!grid.classList.contains('is-arranging')){if(layer)layer.remove();return 0}
  if(!layer){layer=document.createElement('div');layer.className='rp-free-layer';grid.appendChild(layer)}
  layer.innerHTML='';
  /* **座標は必ず`rpLocal()`を通す**（§9.222 ②）。紙は`--rp-scale`で縮めて
     出しているので`getBoundingClientRect()`は拡大後、`gap`と`grid-auto-rows`は
     拡大前。混ぜて割ると器の左上から離れるほど誤差が積み上がり、下のほうの
     空きマスが1マスずれる。印を置く層はグリッドの中なので**拡大前**で書く。 */
  const L=rpLocal(grid,0,0);
  const cols=L.cols,gapX=L.gapX,gapY=L.gapY,colW=L.colW,sc=L.sc;
  if(!(colW>0))return 0;
  const rowH=L.rowPx;
  const gr=grid.getBoundingClientRect();
  const used=new Set();
  let maxRow=0;
  /* **行はずらしを外して数える**（§9.283）——ページに割ると塊は`transform`で
     1枚ぶんずつ下へ動いており、`getBoundingClientRect()`はその**動かしたあと**を
     返す。素直に行の高さで割ると、2枚目以降の塊が1〜2行ぶん下に居ることに
     なり、**埋まっているマスに「空き」の枠が出る**。塊の上端は「行の頭
     ちょうど」なので`rpRowOfTop()`のほう（切り捨てだと端数で1行上に落ちる）。
     高さはずらしの影響を受けない。 */
  const M=L.m||rpPageMetrics();
  grid.querySelectorAll('[data-rp-block]').forEach(el=>{
   const r=el.getBoundingClientRect();
   const c0=Math.max(0,Math.round(((r.left-gr.left)/sc)/(colW+gapX)));
   const r0=Math.max(0,rpRowOfTop(M,(r.top-gr.top)/sc));
   const cn=Math.max(1,Math.round((r.width/sc+gapX)/(colW+gapX)));
   const rn=Math.max(1,Math.round((r.height/sc+gapY)/(rowH+gapY)));
   for(let i=0;i<rn;i++)for(let j=0;j<cn;j++)used.add((r0+i)+':'+(c0+j));
   maxRow=Math.max(maxRow,r0+rn);
  });
  /* **重なっているマスを赤い網で出す**（§9.223 ③）。`rpResolvePlacement()`が
     集めたマスをそのまま描く——縁だけでは「どこが当たっているのか」が読めず、
     直しようがない。**空きより先に置く**（同じ層なので後勝ち、重なりのほうを
     上に出したい）。座標は`列:行`ではなく`行:列`（`rpOverlapCells`と同じ形）。 */
  const put=(cls,c0,r0,w,label)=>{
   const i=document.createElement('i');
   i.className=cls;
   i.style.left=(c0*(colW+gapX))+'px';
   i.style.top=(r0*(rowH+gapY))+'px';
   i.style.width=(w*colW+(w-1)*gapX)+'px';
   i.style.height=rowH+'px';
   if(label)i.dataset.rpFree=label;
   layer.appendChild(i);
   return i;
  };
  let over=0;
  for(let r=0;r<maxRow;r++){
   let c=0;
   while(c<cols){
    if(!rpOverlapCells.has((r+1)+':'+(c+1))){c++;continue}
    let w=0;
    while(c+w<cols&&rpOverlapCells.has((r+1)+':'+(c+w+1)))w++;
    put('rp-overlap-cell',c,r,w,over?'':'重なっています');
    over++;c+=w;
   }
  }
  /* **横につないで1つの枠にする**（1マスずつ描くと、マスの数だけ点線が
     並んで「置ける場所」ではなく方眼紙に見える）。 */
  let n=0;
  for(let r=0;r<maxRow;r++){
   let c=0;
   while(c<cols){
    if(used.has(r+':'+c)){c++;continue}
    let w=0;
    while(c+w<cols&&!used.has(r+':'+(c+w)))w++;
    /* **どのくらい空いているかを文字で言う**（§3。枠だけでは「何マス
       ぶんか」を数えることになる）。1行ぶんの帯には入らないので、
       2行以上つながっている先頭だけに出す。 */
    put('rp-free',c,r,w,(w>=2&&!used.has((r+1)+':'+c)&&r+1<maxRow)?w+'マス空き':'');
    n++;c+=w;
   }
  }
  return n;
 }
 function rpMarkOverflow(host){
  /* **測る前に片付ける**（§9.281 の追補）——ページに割ると塊へ`transform`が
     付くので、外さずに`getBoundingClientRect()`で測ると位置を読み違える。 */
  rpClearSheets($id('reportContent'));
  rpFitRows(host);
  /* **中身を器へ合わせる**（§9.221 ⑨）。行を測って器を伸ばす（`rpFitRows`）
     のは置き場所の決まっていない塊だけで、決まっている塊はこちらが縮める。
     刷るときも同じ関数を通る（`rpFitAll`）——別々に持つと、画面では入って
     見えるのに紙で切れる、という形で食い違う。 */
  const cramped=rpFitBlockBodies(host);
  rpFreeCells(host);
  rpUpdateSheets();
  /* **直ったら消す。** 「入りきらない」が0件になっても文字が残ると、
     直前の操作が通ったのかどうかが読めない（§CLAUDE 2）。 */
  rpSay(cramped?`${cramped}件は器に入りきりませんでした（縮めきれない大きさです）。行数を増やすか、中身を減らしてください。`:'',!!cramped,'fit');
  host.querySelectorAll('[data-rp-block]').forEach(el=>{
   /* **表だけを見る。** 節そのものを測ると、枠線や余白の丸めで1〜2px
      はみ出した扱いになり、入っている塊にまで案内が出る（実際に出た）。 */
   const box=el.querySelector('.rp-wide-wrap');
   const tbl=el.querySelector('table');
   const over=!!box&&(box.scrollWidth>box.clientWidth+2
     ||(!!tbl&&tbl.getBoundingClientRect().width>box.getBoundingClientRect().width+2));
   el.classList.toggle('is-overflow',over);
   /* **絞り込みの案内は紙に置かない**（§9.226 ⑤）——落とせる列の一覧は
      塊の設定の窓が持つ。ここで紙へ書き足すと刷り上がりが変わる。
      **縁の色だけで終わらせない**（§3）ので、あと何px足りないかは
      `title`で言う（紙に出る文字は1つも増えない）。 */
   if(over)el.title=`この幅には入りません（あと${Math.max(1,Math.round(box.scrollWidth-box.clientWidth))}px）。`
     +`幅を広げるか、ダブルクリックして開く窓で列を落として絞ってください。`;
   else if(el.title)el.removeAttribute('title');
  });
 }

 /* ---------- 塊を大きく開いて決める(§9.174) ----------
    幅・高さ・行列・列幅を1枚で決める。**左に実物、右に決めること**——
    触った結果がその場で見えないと、数字を入れても当たっているか分からない。 */
 function rpBlockColumns(k){
  const groups=rpBlockMeasGroups(k);
  if(!groups.length)return [];
  const out=[{n:'条番号'},{n:'ロット№'}];
  groups.forEach(gr=>rpMeasVisibleCols(gr.g).forEach(c=>out.push({n:`${gr.g}${c.c?':'+c.c:''}`})));
  return out;
 }
 function ensureBlockEditor(){
  let m=$id('rpBlockModal');if(m)return m;
  m=document.createElement('div');m.className='record-modal';m.id='rpBlockModal';m.hidden=true;
  m.innerHTML=`<div class="settings-dialog rp-block-dialog" role="dialog" aria-modal="true">
    <header><div><small>この紙での見え方</small><h2 id="rpBlockTitle">塊</h2></div>
     <button id="rpBlockToMaster" type="button" class="rp-to-master"
      title="名前・載せる項目・書式・既定の幅と高さは帳票ブロックマスタで直します">帳票ブロックマスタで直す</button>
     <button id="rpBlockClose" type="button" aria-label="閉じる">×</button></header>
    <div class="rp-block-edit">
     <div class="rp-block-preview" id="rpBlockPreview"></div>
     <div class="rp-block-form" id="rpBlockForm"></div>
    </div></div>`;
  document.body.append(m);
  $id('rpBlockClose').onclick=()=>closeBlockEditor();
  /* **どこで直すのかを言い、そこへ連れて行く**（§2）。ここが持つのは
     「この紙（この設備）だけの見え方」で、塊そのものはマスタが持つ。 */
  $id('rpBlockToMaster').onclick=()=>{const k=rpEditKey;closeBlockEditor();rpOpenBlockMaster(k)};
  WL.modal.keepOpen(m);
  document.addEventListener('keydown',e=>{if(WL.modal.escCloses(e)&&!m.hidden)closeBlockEditor()},true);
  return m;
 }
 let rpEditKey=null;
 /* **閉じたら中身も捨てる**（§9.226 ⑤）: 落とせる列のボタン(`[data-rp-drop]`)は
    この窓の中にしか無い約束なので、隠すだけだと畳んだ塊のぶんがDOMに残り、
    「紙に絞り込みの案内が出ていないか」を数える網に引っ掛かる。掴んだ鍵ごと
    捨てて、次に開いたときに組み立て直す。 */
 function closeBlockEditor(){
  const m=$id('rpBlockModal');if(m)m.hidden=true;
  const f=$id('rpBlockForm');if(f)f.innerHTML='';
  const pv=$id('rpBlockPreview');if(pv)pv.innerHTML='';
  rpEditKey=null;
 }
 /* 分解／まとめ（§9.226 ③で設定の窓へ移した）。**hiddenを付け外しするだけ**
    ——まとめに載るかどうかは「単独ブロックが出ているか」の1点で決まる
    （同じ内容を2箇所に出さない・§9.173）。 */
 function rpApplySplit(k,dir){
  const set=new Set(rpHiddenSet());
  if(dir==='out'){
   /* まとめ→分解: 中身のある群だけを単独で出し、まとめは畳む。 */
   rpMeasGroupsFor('combined').forEach(gr=>set.delete(rpMeasSoloKey(gr.g)));
   set.add(RP_MEAS_COMBINED);
  }else{
   set.add(k);set.delete(RP_MEAS_COMBINED);
  }
  rpStage({hidden:[...set]});
  updateArrangeBar();
 }
 function openBlockEditor(k){
  rpEditKey=k;ensureBlockEditor().hidden=false;renderBlockEditor();
 }
 /* この塊のマスタの行ID。**既定の塊は`[組み込みキー]`、自作の塊は名前が鍵**
    （`rpAllBlocks()`と同じ引き当て方）。 */
 function rpMasterRowOf(k){
  return rpMasterRows.find(r=>String(r.builtin||r.name||'')===String(k))||null;
 }
 /* 帳票ブロックマスタのその行を開く（§9.274）。**行が無いことは黙らない**
    ——「押しても何も起きない」を作らない（§4）。 */
 function rpOpenBlockMaster(k){
  const row=rpMasterRowOf(k);
  if(!(window.WL&&WL.reportBlockMaster&&WL.reportBlockMaster.open)){
   /* **公開漏れは黙って素通しにしない**（§CLAUDE）。 */
   console.error('WL.reportBlockMaster が見つかりません（master-maint.js）');
   showToast&&showToast('帳票ブロックマスタを開けません','マスタ管理の画面が読み込まれていません。',5000);
   return;
  }
  if(!row){
   showToast&&showToast('この塊はマスタに行がありません',
     `「${k}」はこの端末のマスタにまだ登録されていません（マスタ管理 > 帳票ブロックを一度開くと作られます）。`,5600);
   return;
  }
  /* **移る前に保存を流す**（§9.303 ③、利用者の指示）——ここが
     「移動するたびに修正していた内容が飛ぶ」の入口だった。 */
  rpFlushSave();
  WL.reportBlockMaster.open(row.id);
 }
 function renderBlockEditor(){
  const k=rpEditKey,m=$id('rpBlockModal');if(!k||!m||m.hidden)return;
  const x=rpCurrentLot();if(!x)return;
  const bl=rpBlockOf(k)||{};
  $id('rpBlockTitle').textContent=k;
  /* **どちらで直すのかを毎回思い出させない**（§2）。この窓が書き換えるのは
     `report:<設備>`（紙1枚ぶん）で、塊そのものは帳票ブロックマスタ。 */
  const toM=$id('rpBlockToMaster');
  if(toM)toM.title=`「${k}」の名前・載せる項目・書式・既定の幅と高さは帳票ブロックマスタで直します`
    +`（この窓で決まるのは「${rpEditEquipment||rpEquipmentOf(x)||'共通'}」の紙だけの見え方です）`;
  let body='';try{body=bl.html(x)||''}catch(e){body=''}
  $id('rpBlockPreview').innerHTML=body
   ||'<p class="rp-block-empty">このロットにはこの内容がありません。枠の大きさだけ決められます。</p>';
  /* **表かどうかは紙自身に答えさせる**（§9.282）。`reportSection()`が
     表として組んだときだけ`.rp-grid-m`を貼るので、ここを見れば
     「表かどうか」の2つ目の判定を持たずに済む（§9.163）。 */
  const matrixBlock=!!$id('rpBlockPreview').querySelector('.rp-grid-m');
  const grid=rpGrid(),span=rpSpan(k),rows=rpRows(k),def=(rpBlockOf(k)||{}).rows||0;
  const cols=rpBlockColumns(k);
  const canTurn=cols.length>0;
  /* 浮き帯から移してきた操作（§9.226 ③）。**組み立てはここ1箇所**。 */
  const groups=rpBlockMeasGroups(k);
  const split=k===RP_MEAS_COMBINED
   ?`<button type="button" data-rp-split="out" title="項目ごとの表に分けます（それぞれ場所と幅を決められます）">項目ごとに分ける</button>`
   :((rpBlockOf(k)||{}).meas?`<button type="button" data-rp-split="in" title="測定データのまとめへ戻します（条番号の軸を共有して1枚になります）">まとめへ戻す</button>`:'');
  const dropCols=groups.length
   ?groups.map(gr=>rpMeasVisibleCols(gr.g).map(c=>
      `<button type="button" data-rp-drop="${esc(gr.g)}|${esc(c.c||'値')}" title="この列を紙から落とします">${esc(gr.g)}${c.c?' '+esc(c.c):''} ×</button>`).join('')).join('')
    +`<button type="button" data-rp-restore title="落とした列を全部戻します">落とした列を戻す</button>`
   :'';
  $id('rpBlockForm').innerHTML=`
   <div class="rp-form-row"><span class="rp-form-label">幅</span>
    <span class="rp-form-ctl">${rpSpanChoices().map(c=>
      `<button type="button" data-e-span="${c.v}" class="${c.v===span?'is-on':''}">${esc(c.label)}</button>`).join('')}
     <i class="rp-form-note">${span}/${grid}マス</i></span></div>
   <div class="rp-form-row"><span class="rp-form-label">高さ</span>
    <span class="rp-form-ctl">
     <button type="button" data-e-rows="0" class="${rows?'':'is-on'}">中身なり（自動）</button>
     ${rpRowChoices().map(c=>`<button type="button" data-e-rows="${c.v}" class="${rows===c.v?'is-on':''}" title="${c.v}行（紙の${esc(c.label)}）">${esc(c.label)}</button>`).join('')}
     <i class="rp-form-note">1行＝紙の縦の1/${rpPageRows()}（いまは${rows||'中身なり'}${rows?'行':''}）。器より背の高い中身は<b>入るところまで縮めて</b>収めます（縮めきれないときは帯で言います）。${def?`この塊の既定は${def}行です。`:'「中身なり」は描いてから測って決めます。'}</i></span></div>
   ${canTurn?`<div class="rp-form-row"><span class="rp-form-label">行と列</span>
    <span class="rp-form-ctl">
     <button type="button" data-e-turn="" class="${rpTransposed(k)?'':'is-on'}">縦＝条番号（今までの紙）</button>
     <button type="button" data-e-turn="転置" class="${rpTransposed(k)?'is-on':''}">縦＝項目（入れ替える）</button>
     <i class="rp-form-note">条が少なく項目が多いロットでは、入れ替えたほうが面積を使い切れます。</i></span></div>
   <div class="rp-form-row rp-form-cols"><span class="rp-form-label">列幅</span>
    <span class="rp-form-ctl">
     ${cols.map(c=>`<label class="rp-col-w"><span>${esc(c.n)}</span>
       <input type="number" data-e-col="${esc(c.n)}" value="${rpColWidth(k,c.n)||''}" placeholder="自動" min="${RP_H_MIN}" max="${RP_H_MAX}" step="4"></label>`).join('')}
     <button type="button" data-e-colreset>全部オートフィットへ</button>
     <i class="rp-form-note">空欄＝オートフィット（中身なり）。入れた列だけ固定します。</i></span></div>`:''}
   ${bl.area?'':`<div class="rp-form-row"><span class="rp-form-label">中の並べ方</span>
    <span class="rp-form-ctl">
     ${RP_FLOWS.map(f=>`<button type="button" data-e-flow="${esc(f.v)}" class="${f.v===rpFlow(k)?'is-on':''}"`
       +(matrixBlock&&f.v?' disabled':'')
       +` title="${esc(matrixBlock&&f.v?'この塊は表に組んであるので選べません':String(f.note).replace(/<[^>]+>/g,''))}">${esc(f.label)}</button>`).join('')}
     <i class="rp-form-note">${matrixBlock
       ?'<b>この塊は表（マトリクス）に組んであるので、並べ方は選べません。</b>'
        +'表の形は帳票ブロックマスタで組んだ軸（行と列）がそのまま紙に出ます'
        +'——段組へ変えると軸のマスがばらけて別の表になるので、当てていません。'
       :(RP_FLOWS.find(f=>f.v===rpFlow(k))||RP_FLOWS[0]).note
        +(rpFlow(k)==='高さなり'&&!rpRows(k)?'<b>いまは高さが「中身なり」なので1列のままです。</b>上の「高さ」で行数を決めてください。':'')}</i>
    </span></div>`}
   <div class="rp-form-row"><span class="rp-form-label">枠</span>
    <span class="rp-form-ctl">
     ${RP_FRAMES.map(f=>`<button type="button" data-e-frame="${esc(f.v)}" class="${f.v===rpToken(k,'枠:')?'is-on':''}"`
       +` title="${esc(String(f.note).replace(/<[^>]+>/g,''))}">${esc(f.label)}</button>`).join('')}
     <i class="rp-form-note">${(RP_FRAMES.find(f=>f.v===rpToken(k,'枠:'))||RP_FRAMES[0]).note}
      いまは<b>${rpFramed(k)?'枠あり':'枠なし'}</b>です。枠はカードそのものに描くので、幅や高さを変えると枠も一緒に変わります。</i>
    </span></div>
   ${split?`<div class="rp-form-row"><span class="rp-form-label">まとめ</span>
    <span class="rp-form-ctl">${split}
     <i class="rp-form-note">項目ごとに分けると、それぞれ場所と幅を決められます。まとめると条番号の軸を共有して1枚になります。</i></span></div>`:''}
   ${dropCols?`<div class="rp-form-row"><span class="rp-form-label">落とす列</span>
    <span class="rp-form-ctl">${dropCols}
     <i class="rp-form-note">紙に入りきらないときは、要らない列を落として幅を空けられます。</i></span></div>`:''}
   ${k===RP_STAT_BLOCK?`<div class="rp-form-row"><span class="rp-form-label">出す項目</span>
    <span class="rp-form-ctl">
     ${Object.keys(RP_STAT_LABEL).map(it=>`<button type="button" data-e-stitem="${esc(it)}"`
       +` class="${rpStatItems(k).indexOf(it)>=0?'is-on':''}"`
       +` title="${RP_STAT_BY_STRIP[it]?'条ごとに測るので、子ロットごとの値も出せます':'丈ごとに測るので、子ロットごとには出せません（全体のみ）'}">`
       +`${esc(RP_STAT_LABEL[it])}${RP_STAT_BY_STRIP[it]?'':'<small>全体のみ</small>'}</button>`).join('')}
     <i class="rp-form-note">1つ以上選んでください（何も選ばないと既定の
      <b>${esc(RP_STAT_DEFAULT_ITEMS.map(v=>RP_STAT_LABEL[v]).join('・'))}</b>に戻ります）。
      <b>条ごとに測る項目だけ</b>が子ロットごとに分かれます——板厚・板丈・肉厚は
      丈ごとの測定なので、どの子ロットのものとも言えません（「—」で出します）。</i></span></div>
   <div class="rp-form-row"><span class="rp-form-label">出す集計</span>
    <span class="rp-form-ctl">
     ${RP_STAT_AGG.map(([v,lb])=>`<button type="button" data-e-stagg="${esc(v)}"`
       +` class="${rpStatAggs(k).indexOf(v)>=0?'is-on':''}">${esc(lb)}</button>`).join('')}
     <i class="rp-form-note">列は<b>項目 × 集計</b>で増えます（いま
      ${rpStatItems(k).length}×${rpStatAggs(k).length}＝<b>${rpStatItems(k).length*rpStatAggs(k).length}列</b>）。
      <b>N数は必ず添えることを勧めます</b>——同じMINでも1点と80点では当たる見込みが違います。</i></span></div>`:''}
   ${k===RP_PRODUCT_KEY?`<div class="rp-form-row"><span class="rp-form-label">揃いの欄</span>
    <span class="rp-form-ctl">
     ${RP_PRODUCT_MODES.map(m=>`<button type="button" data-e-pmode="${esc(m.v)}" class="${m.v===rpProductMode()?'is-on':''}">${esc(m.label)}${m.v===''?'（既定）':''}</button>`).join('')}
     <i class="rp-form-note">${esc((RP_PRODUCT_MODES.find(m=>m.v===rpProductMode())||RP_PRODUCT_MODES[0]).note)}</i></span></div>`:''}
   <div class="rp-form-row"><span class="rp-form-label">紙に出す</span>
    <span class="rp-form-ctl">
     <button type="button" data-e-vis>${rpHiddenSet().has(k)?'出す':'出さない'}</button>
     <i class="rp-form-note">${rpHiddenSet().has(k)?'いまは紙に出していません。':'いまは紙に出しています。'}</i></span></div>`;
  const form=$id('rpBlockForm');
  const w=()=>({...rpLayoutNow().widths});
  /* 測定値の統計（§9.244）。**印は`|`で並べる**ので1つずつ差し替える
     （まるごと書くと他の見せ方が消える。§9.226 ⑤と同じ約束）。 */
  const stToggle=(prefix,cur,v,order)=>{
   const set=new Set(cur);
   if(set.has(v))set.delete(v);else set.add(v);
   const list=order.filter(o=>set.has(o));
   /* **全部外したら既定へ戻す**（0列の表は作らない・§4）。 */
   rpStage({formats:rpTokenPatch(k,prefix,list.join('/'))});
   renderBlockEditor();
  };
  form.querySelectorAll('[data-e-stitem]').forEach(b=>b.onclick=()=>
    stToggle('項目:',rpStatItems(k),b.dataset.eStitem,Object.keys(RP_STAT_LABEL)));
  form.querySelectorAll('[data-e-stagg]').forEach(b=>b.onclick=()=>
    stToggle('集計:',rpStatAggs(k),b.dataset.eStagg,RP_STAT_AGG.map(a=>a[0])));
  form.querySelectorAll('[data-e-span]').forEach(b=>b.onclick=()=>{
   /* **幅の当て方は1箇所**（§9.221 ⑨）——帯と設定窓で別々に書くと、
      「入らないときに左へ寄せる」が片方だけ効いた状態が作れる。 */
   rpApplySpan(k,Number(b.dataset.eSpan));renderBlockEditor();
  });
  form.querySelectorAll('[data-e-rows]').forEach(b=>b.onclick=()=>{
   const v=Number(b.dataset.eRows),wid=w();
   /* 旧いpxの高さは**捨てる**（§9.217）。両方残すと「どちらが効いて
      いるのか」が決まらない——行数を触った時点でそちらが正。 */
   delete wid[rpHeightKey(k)];
   if(v>0)wid[rpRowsKey(k)]=rpRowsStore(rpRowsFromGrid(v));else delete wid[rpRowsKey(k)];
   rpStage({widths:wid});renderBlockEditor();
  });
  /* 揃いの出し方も`formats`。**既定は行ごと消す**——空文字を保存すると
     「空という設定」になり、既定を変えたときに追随しない（§9.198）。 */
  /* **印は1つずつ差し替える**（§9.226 ③）。`pattern`には行と列の入れ替え・
     並べ方・丈別データの出し方が同居するので、まるごと書くと他が消える。 */
  form.querySelectorAll('[data-e-pmode]').forEach(b=>b.onclick=()=>{
   const t=rpTokens(RP_PRODUCT_KEY).filter(x=>x!=='内訳'&&x!=='合否');
   if(b.dataset.ePmode)t.push(b.dataset.ePmode);
   rpStage({formats:rpPatternPatch(RP_PRODUCT_KEY,t.join('|'))});renderBlockEditor();
  });
  form.querySelectorAll('[data-e-turn]').forEach(b=>b.onclick=()=>{
   rpStage({formats:rpFlagPatch(k,'転置',b.dataset.eTurn==='転置')});renderBlockEditor();
  });
  form.querySelectorAll('[data-e-flow]').forEach(b=>b.onclick=()=>{
   rpStage({formats:rpTokenPatch(k,'流:',b.dataset.eFlow)});renderBlockEditor();
  });
  /* 枠（§9.234 ⑤）。**`rpTokenPatch`を必ず通す**——`formats[k]`へ文字列を
     直に書くと`normalize_format()`が辞書以外をNoneへ落とし、**保存だけが
     黙って消える**（§9.205）。まるごと書かないので、転置・並べ方・
     丈別データの印は残る（§9.226 ③）。 */
  form.querySelectorAll('[data-e-frame]').forEach(b=>b.onclick=()=>{
   rpStage({formats:rpTokenPatch(k,'枠:',b.dataset.eFrame)});renderBlockEditor();
  });
  /* 浮き帯から移してきた操作（§9.226 ③）。**当て方は元のまま**——判定が
     2つに分かれないよう、同じ`rpStage`の書き方を使う。 */
  form.querySelectorAll('[data-rp-split]').forEach(b=>b.onclick=()=>{
   rpApplySplit(k,b.dataset.rpSplit);
   /* **出さなくなった塊の設定窓は閉じる**——紙から消えたものの設定を
      触り続けられると、どこを直しているのか分からなくなる。 */
   if(rpHiddenSet().has(k)){closeBlockEditor();return}
   renderBlockEditor();
  });
  form.querySelectorAll('[data-rp-drop]').forEach(b=>b.onclick=()=>{
   const [g,c]=String(b.dataset.rpDrop).split('|');
   const set=new Set(rpLayoutNow().hidden);
   set.add(rpMeasColKey(g,c==='値'?'':c));
   rpStage({hidden:[...set]});renderBlockEditor();
  });
  const rst=form.querySelector('[data-rp-restore]');
  if(rst)rst.onclick=()=>{
   const set=new Set(rpLayoutNow().hidden);
   RP_MEAS_GROUPS.forEach(gr=>gr.cols.forEach(c=>set.delete(rpMeasColKey(gr.g,c.c))));
   rpStage({hidden:[...set]});renderBlockEditor();
  };
  form.querySelectorAll('[data-e-col]').forEach(inp=>inp.onchange=()=>{
   const v=Math.round(Number(inp.value)||0),wid=w(),key=rpColWKey(k,inp.dataset.eCol);
   if(v<RP_H_MIN)delete wid[key];else wid[key]=Math.min(RP_H_MAX,v);
   rpStage({widths:wid});renderBlockEditor();
  });
  const cr=form.querySelector('[data-e-colreset]');
  if(cr)cr.onclick=()=>{
   const wid=w();Object.keys(wid).forEach(key=>{if(key.startsWith(`列幅:${k}:`))delete wid[key]});
   rpStage({widths:wid});renderBlockEditor();
  };
  const vis=form.querySelector('[data-e-vis]');
  if(vis)vis.onclick=()=>{
   rpShowBlock(k,rpHiddenSet().has(k));
   updateArrangeBar();renderBlockEditor();
  };
 }

 /* ---- 組み換えモード -------------------------------------------------
    **保存せずに当てる**（列の設定パネルと同じ作り。§9.90）。触った結果が
    そのまま紙に出るのが分かりやすく、「やめる」で開いた時点へ必ず戻せる。 */
 let rpArranging=false,rpDragKey=null,rpDragFrom=null;
 /* 重なっている塊（§9.222 ②）。**自動で動かさなくなったぶん、重なりは
    起こりうる**ので、起きたことを数で言い、直す手立て（並べ直す）を
    同じ場所に置く。色だけで伝えない（§3）。 */
 let rpOverlaps=[];
 /* 重なっているマス（`行:列`）。`rpResolvePlacement()`が数えるついでに集め、
    `rpFreeCells()`が赤い網として描く（§9.223 ③）。 */
 let rpOverlapCells=new Set();
 /* 操作の説明は畳んでおく（§9.222 ④）。常設だと帯の半分を文が占める。 */
 let rpHelpOpen=false;
 /* 「⋯」の面（§9.255 ①）。**開いた器は必ず控える**（§9.222 ①）——控えないと
    外クリック・Escのどれでも閉じられないまま押すたびに積み上がる。 */
 let rpMoreOpen=false;
 function rpMoreEl(){return $id('rpArrangeMenu')}
 function rpCloseMore(){
  const el=rpMoreEl();
  if(!el||el.hidden)return;
  el.hidden=true;rpMoreOpen=false;
  const b=document.querySelector('#rpArrangeBar [data-rp-more]');
  if(b)b.setAttribute('aria-expanded','false');
 }
 function rpToggleMore(btn){
  const el=rpMoreEl();if(!el)return;
  if(!el.hidden){rpCloseMore();return}
  rpMoreOpen=true;el.hidden=false;
  btn.setAttribute('aria-expanded','true');
  /* **開いてから測る**（中身の高さが分からないと画面の外へ出る・§9.247 ①）。 */
  const b=btn.getBoundingClientRect(),m=el.getBoundingClientRect();
  const left=Math.max(8,Math.min(window.innerWidth-m.width-8,b.right-m.width));
  const top=(b.bottom+m.height+8>window.innerHeight)?Math.max(8,b.top-m.height-4):b.bottom+4;
  el.style.left=Math.round(left)+'px';
  el.style.top=Math.round(top)+'px';
 }
 /* 中身は**組み立て直すたびに配線し直す**（帯は innerHTML ごと作り直る）。 */
 function rpRenderArrangeMenu(){
  const el=rpMoreEl();if(!el)return;
  el.innerHTML=
    `<button type="button" class="rp-bar-menu-item" data-rp-copy`
     +` title="いまの設備の配置を、他の設備へもそのまま当てます（それぞれの今の配置は置き換わります）">`
     +`他の設備へ当てる</button>`
   +`<button type="button" class="rp-bar-menu-item" data-rp-help`
     +` aria-expanded="${rpHelpOpen?'true':'false'}">操作の仕方を${rpHelpOpen?'閉じる':'見る'}</button>`
   +`<hr class="rp-bar-menu-sep">`
   /* **取り消せない操作は主要動線から離す**（§CLAUDE 5）。 */
   +`<button type="button" class="rp-bar-menu-item is-danger" id="rpArrangeReset"`
     +` title="この設備の配置（並び・幅・高さ・出す/出さない・紙の割り）を消して既定へ戻します">`
     +`既定に戻す</button>`;
  el.querySelector('[data-rp-copy]').onclick=()=>{rpCloseMore();rpCopyLayoutTo()};
  el.querySelector('[data-rp-help]').onclick=()=>{rpHelpOpen=!rpHelpOpen;rpCloseMore();updateArrangeBar()};
  el.querySelector('#rpArrangeReset').onclick=()=>{rpCloseMore();resetArrange()};
  if(el.dataset.wired)return;
  el.dataset.wired='1';
  /* 外を押したら閉じる（mousedown で受ける・§9.247 ①）。 */
  document.addEventListener('mousedown',e=>{
   const m=rpMoreEl();
   if(!m||m.hidden)return;
   if(m.contains(e.target))return;
   if(e.target.closest&&e.target.closest('[data-rp-more]'))return;
   rpCloseMore();
  },true);
  document.addEventListener('keydown',e=>{
   const m=rpMoreEl();
   if(m&&!m.hidden&&WL.modal.escCloses(e)){e.stopPropagation();rpCloseMore()}
  },true);
 }
 /* **落ちる場所を実物大で見せる**（§9.217、利用者の指示「ゴーストが出て
    配置可能な部分がわかりやすいように」）。線1本だと「どこへ何マスぶん
    入るのか」が読めないので、掴んでいる塊と同じ幅・高さの枠をその位置へ
    実際に挿し込む——グリッドが自分で場所を空けるので、**そのまま置いたら
    どうなるか**がそのまま見える。 */
 function rpGhostEl(){
  let g=document.getElementById('rpGhost');
  if(!g){g=document.createElement('div');g.id='rpGhost';g.className='rp-ghost'}
  return g;
 }
 /* 落とし先の枠も**塊と同じだけ下へずらす**（§9.282）。**行の番号で決める**
    ——描いたあとに測ると、紙をまたぐ行では「枠の頭」と「指した場所」が
    別の紙になり、掴んだ場所と落ちる場所がずれる。`row`は1から数える。 */
 function rpFitGhost(g,row){
  if(!g)return;
  g.style.removeProperty('--rp-shift');
  const m=rpPageMetrics();
  if(!m.paged)return;
  g.style.setProperty('--rp-shift',rpRowShiftM(m,Math.max(0,(row||1)-1))+'px');
 }
 /* ---------- 落ちる先はマスで示す（§9.221 ⑨） ----------
    置き場所を利用者が決める形にしたので、ゴーストも**そのマスへ実寸で**
    出す。**置けないときは赤くして理由を書く**——置いてから断られるのでは
    掴んだ手間が無駄になる（§4／§9.116と同じ約束）。 */
 function rpShowGhostAt(grid,cell){
  if(!grid||!rpDragKey||!cell)return;
  const g=rpGhostEl(),k=rpDragKey,cols=rpGrid();
  const span=Math.min(rpSpan(k),cols),rows=rpGhostRows(k);
  const col=Math.max(1,Math.min(cols-span+1,cell.col));
  const row=Math.max(1,cell.row);
  const ok=rpFits(col,row,span,rows,rpOccupied(k));
  g.style.gridColumn=col+'/span '+span;
  g.style.gridRow=row+'/span '+rows;
  g.classList.toggle('is-blocked',!ok);
  g.innerHTML=`<b>${esc(rpBlockLabel(k))}</b><small>${col}列目・${row}行目／${span}×${rows}マス</small>`
   +(ok?'':'<small class="rp-ghost-why">ここには別の塊が置かれています</small>');
  if(g.parentElement!==grid)grid.appendChild(g);
  rpFitGhost(g,row);
 }
 function rpShowGhost(grid,ref,after){
  if(!grid||!rpDragKey)return;
  const g=rpGhostEl(),k=rpDragKey;
  const span=rpSpan(k),rows=rpGhostRows(k);
  g.classList.remove('is-blocked');
  g.style.gridColumn='span '+span;
  g.style.gridRow='span '+rows;
  /* **何マス×何行がここへ入るのかを数字でも言う**（§9.218 ⑥、利用者の
     指摘「D&Dでつかんでもゴーストがサイズで出ないのでわかりにくい」）。
     枠の大きさだけでは、隣とくらべて「1マス多いのか少ないのか」が読めない。 */
  g.innerHTML=`<b>${esc(rpBlockLabel(k))}</b><small>${span}/${rpGrid()}マス×${rows}行</small>`;
  if(ref){if(after)ref.after(g);else ref.before(g)}else grid.appendChild(g);
  /* 並べ替えのゴーストはマスを指定しないので、置いてから測って決める。 */
  const m=rpPageMetrics();
  if(m.paged){
   g.style.removeProperty('--rp-shift');
   const pg=$id('reportContent');
   if(pg&&g.parentElement){
    const sc=rpScaleOf(g.parentElement)||1;
    const pr=pg.getBoundingClientRect(),r0=g.getBoundingClientRect();
    g.style.setProperty('--rp-shift',rpShiftAt(m,(r0.top-pr.top)/sc)+'px');
   }
  }
 }
 /* ゴーストの行数。**「中身なり」の塊は今そこに描かれている高さを借りる**
    ——決め打ちの2行だと、測定表のような背の高い塊が実際の1/5で出て、
    「入りそうに見えたのに入らない」ことになる。 */
 /* 当たり判定に使う高さ。**指定が無い塊は「いま描かれている高さ」**
    （§9.222 ②）。0を2行と決め打ちにすると、中身なりで8行に伸びている塊が
    2行ぶんしかマスを押さえず、下に置いた塊と黙って重なる。 */
 const rpEffRows=k=>Math.max(1,rpRows(k)||rpGhostRows(k));
 function rpGhostRows(k){
  const fixed=rpRows(k);
  if(fixed>0)return fixed;
  const el=document.querySelector(`[data-rp-block="${CSS.escape(k)}"]`);
  if(el){
   const m=/span\s+(\d+)/.exec(el.style.gridRowEnd||'');
   if(m)return Math.max(1,Number(m[1]));
  }
  return 2;
 }
 /* ---------- 置き場所は「1度だけ書き下ろして、あとは動かさない」（§9.221 ⑨） ----------
    自動配置のままだと、1つ大きさを変えるだけで後ろが全部動く（利用者の指摘
    「意図しない形で詰まっていくので狙い通りの配置にできません」）。
    **初めて組み換えに入った時点で、今そこに見えている位置をそのまま
    マスタへ書く**——書き下ろさずに「触った塊だけ位置を持つ」形にすると、
    位置のある塊と無い塊が混ざって、無いほうが毎回流れ直す（§9.173の
    「触った時点で既定を書き下ろす」と同じ約束）。 */
 /* **1回の組み換えで1度だけ**。書き下ろし→描き直し→また書き下ろし…と
    回り続けると、画面は動いているのに操作を受け付けなくなる（§9.131で
    起動オーバーレイが外れなくなったのと同じ壊れ方）。**必ず終わること**を
    旗で担保する——「全部に位置が付いたか」だけを条件にすると、1つでも
    付かない塊があった瞬間に無限に回る。 */
 let rpSeeded=false;
 function rpSeedPositions(host){
  if(rpSeeded)return false;
  const grid=host&&host.querySelector('.rp-blocks');if(!grid)return false;
  const els=[...grid.querySelectorAll('[data-rp-block]')];
  if(!els.length)return false;
  if(els.every(el=>rpPos(el.dataset.rpBlock))){rpSeeded=true;return false}
  rpSeeded=true;
  /* **中身なりの高さを先に割り当ててから測る**（§9.222 ②）。書き下ろしは
     `bindArrangeHandlers()`の2×rAFで走り、`rpAfterPaint()`の2×rAFより
     **先に**呼ばれるので、そのままだと`rpFitRows()`がまだ動いておらず、
     自動高さの塊は全部`span 1`のまま。段数が12だった頃は1行が88pxあって
     たまたま入っていたが、48段（1行22px）にした瞬間に**全部の塊が
     「入りきりません」になる**（実測）。 */
  /* **測る前に片付ける**（§9.283、`rpMarkOverflow`と同じ作法）——ページに
     割ると塊へ`transform`が付くので、外さずに`getBoundingClientRect()`で
     測ると**2枚目以降の塊だけ1〜2行ぶん下**として書き下ろしてしまう。
     書き下ろしはマスタへ入るので、読み違えるとそのまま残る。 */
  try{rpClearSheets($id('reportContent'))}catch(e){WL.quiet.note('紙の切れ目を片付けられない（次の測り直しで片付く）',e)}
  try{rpFitRows(host)}catch(e){WL.quiet.note('行の割り付けを測り直せない（前の高さのまま出る）',e)}
  /* **書き下ろしも拡大前で測る**（§9.222 ②）。`getBoundingClientRect()`は
     拡大後、`gap`／`gridAutoRows`は拡大前なので、混ぜると**書き下ろした
     大きさが倍率のぶん小さくなる**——初めて組み換えに入った瞬間に、全部の
     塊が「入りきりません」になる。 */
  /* **紙に出ない札を外してから測る**（§9.310）。中身なしの塊は組み換え中
     だけ流れの中に居るので、そのまま測ると**その札のぶんだけ下がった位置**を
     書き下ろすことになる（実測: 触っただけで作業時間・登録状態が157px下へ
     動き、その隙間がマスタへ焼き付いた）。外した状態＝刷り上がりの並び
     そのものなので、**測り終えたら必ず戻すこと**（`finally`）。 */
  const ghosts=[...grid.querySelectorAll('[data-rp-block].is-empty')];
  const ghostSet=new Set(ghosts);
  /* **中身なしの塊から借りるのは「大きさ」だけ**（§9.311 A）。伏せたまま
     測ると矩形が0になり紙の左上へ1マスに潰れるので、大きさは伏せる前に
     控える。**ただし「場所」は借りないこと**——控えた矩形は
     *中身なしの塊が流れに居る並び*（画面）のもので、他の塊は
     *伏せた並び*（刷り上がり）で測る。**2つの並びを混ぜると重なる**
     （実測: `板厚の測定データ`と`作業時間`が同じマス`1,21`に書き下ろされた。
     利用者の報告「D&Dで位置ずれがかなりひどくなりました」の実体で、
     重なった2枚のうち下が掴めなくなる）。
     場所は**伏せた並びの空いているマス**から探す（下の`later`）。
     **位置を持たせない形は採らない**——描くたびに空きを探して紙の下へ伸び、
     刷り上がりがA4を超える（§9.310。実測 210×336.7mm）。 */
  const ghostRect=new Map(ghosts.map(el=>[el,el.getBoundingClientRect()]));
  /* **伏せるのは`hidden`属性で**（インラインの`style.display`を書かない・
     `tests/test_csslint.py`）。`[hidden]{display:none}`はutilityレイヤなので
     コンポーネント側の`display`に必ず勝つ（§9.131）。 */
  ghosts.forEach(el=>{el.hidden=true});
  try{
  const L=rpLocal(grid,0,0);
  const cols=L.cols,rowPx=L.rowPx,gapX=L.gapX,gapY=L.gapY,colW=L.colW,sc=L.sc;
  const gr=grid.getBoundingClientRect();
  if(!(colW>0)||!(rowPx>0))return false;
  const wid={...rpLayoutNow().widths};
  /* 埋まったマス。**中身なしの塊を置く場所を探すのに使う**ので、
     `rpFits()`と同じ`行:列`の形で持つ（判定を2通り書かない・§9.163）。 */
  const used=new Set();
  const mark=(col,row,span,rows)=>{
   for(let r=0;r<rows;r++)for(let c=0;c<span;c++)used.add((row+r)+':'+(col+c));
  };
  const later=[];
  const put=(k,col,row,span,rows)=>{
   wid[rpColKey(k)]=rpColStore(rpColToBase(col));
   wid[rpRowPosKey(k)]=rpRowStore(rpRowToBase(row));
   wid[k]=rpSpanStore(rpSpanFromGrid(span));
   /* **「中身なり」の塊に高さを書き込まない**（§9.310、§9.222 ②）。
      同じ禁止事項が`rpRelayout()`には書いてあるのに、書き下ろし側だけが
      無条件に書いていた——**組み換えに入って1マス引いただけで、触っても
      いない塊の高さが全部そのときの見た目で凍る**（実測: 引く前は`行数:`が
      0件、1回引いたら15件）。凍ると`.is-sized`が付いて中の枠が器いっぱいへ
      伸びる（§9.242 ⑧）ので、**触っていない塊の見た目が変わる**（実測:
      丈別データの中の枠が52→74pxで42%大きくなった）。これが利用者の報告
      「初めて触ったときに、隣とは限らずどこかのブロックが共にサイズ変更
      される」の実体で、**凍るのは1回だけ**だから2回目以降は再現しない
      ——原因に辿り着きにくいのはこのため。
      流れ直しを止めるのに要るのは位置（`列:`／`行:`）だけ。高さは
      `rpFitRows()`が毎回中身から入れ直す。 */
   if(rpRowsSet(k))wid[rpRowsKey(k)]=rpRowsStore(rpRowsFromGrid(rows));
   mark(col,row,span,rows);
  };
  /* 大きさは矩形から。**中身なしの塊だけ大きさを控えから取る**（伏せてある）。 */
  const sizeOf=el=>{
   const rr=(ghostSet.has(el)&&ghostRect.get(el))||el.getBoundingClientRect();
   return {left:(rr.left-gr.left)/sc,top:(rr.top-gr.top)/sc,
           width:rr.width/sc,height:rr.height/sc};
  };
  els.forEach(el=>{
   const k=el.dataset.rpBlock,r=sizeOf(el);
   const span=Math.max(1,Math.min(cols,Math.round((r.width+gapX)/(colW+gapX))));
   const rows=Math.max(1,Math.min(rpRowCap(),Math.round((r.height+gapY)/(rowPx+gapY))));
   if(ghostSet.has(el)){later.push({k,span,rows});return}
   const col=Math.max(1,Math.min(cols,Math.round(r.left/(colW+gapX))+1));
   const row=Math.max(1,Math.min(rpRowCap(),Math.round(r.top/(rowPx+gapY))+1));
   put(k,col,row,Math.min(span,cols-col+1),rows);
  });
  /* **中身なしの塊は、刷り上がりの並びの空いているマスへ置く**（§9.311 A）。
     画面での場所をそのまま持たせると、他の塊（伏せた並びで測った）と
     重なる。上から左へ順に最初に入るところ——`rpFits()`を通すので
     「入るかどうか」の判定は1箇所のまま（§9.163）。 */
  later.forEach(({k,span,rows})=>{
   const cap=rpRowCap();
   let col=1,row=1,found=false;
   for(let r=1;r+rows-1<=cap&&!found;r++){
    for(let c=1;c+span-1<=cols;c++){
     if(rpFits(c,r,span,rows,used,cap)){col=c;row=r;found=true;break}
    }
   }
   put(k,col,row,Math.min(span,cols-col+1),rows);
  });
  /* **書き下ろしは保存しない**（§9.303 ③）——利用者が触っていないので、
     開いて閉じただけで紙の設定が確定してしまう。次に何か触った時点で、
     この書き下ろしごと保存される（下書きに載っている）。 */
  rpStage({widths:wid},{persist:false});
  return true;
  }finally{ghosts.forEach(el=>{el.hidden=false})}
 }
/* ---------- 置き場所を重ならないように解く（§9.221 ⑨） ----------
    保存されている`列:`/`行:`は**希望**。マス数・段数を変えたときの丸めや、
    古い設定、複数の塊が同じマスを指す形はいくらでも起こりうる。**描く前に
    1回だけ解いて**、重なった塊は次に空いているマスへ送る——重なったまま
    描くと、下の塊のボタンが押せなくなる（実測。組み換えの操作帯が別の塊に
    覆われた）。
    **1つも位置を持っていないうちは解かない**（`null`を返す）——初めて
    組み換えに入るまでは今までどおり自動で流し、その姿を`rpSeedPositions()`が
    書き下ろす。 */
 function rpResolvePlacement(){
  const cols=rpGrid();
  /* **隠した塊はマスを押さえない**（§9.222 ③）。以前は数えていたので、
     外した塊の場所が空かず「空いて見えるのに落とせない」が起きていた。 */
  const hidden=rpHiddenSet();
  const keys=rpBlockKeys().filter(k=>rpBlockOf(k)&&!hidden.has(k));
  /* **数え直しは早く帰るときも**（§CLAUDE 2）。まだ誰も場所を決めていない
     ときにここで帰ると、前回の重なりの件数が残り、帯が「重なり N件」と
     言い続ける（外して重なりが消えたのに直らない、という形で出る）。 */
  rpOverlaps=[];rpOverlapCells=new Set();
  if(!keys.some(k=>rpPos(k)))return null;
  const used=new Set(),out=new Map();
  const take=(col,row,span,rows)=>{
   for(let r=0;r<rows;r++)for(let c=0;c<span;c++)used.add((row+r)+':'+(col+c));
  };
  /* **希望の位置を持つ塊を先に**置く（持たない塊に押しのけられないように）。 */
  const order=keys.slice().sort((a,b)=>{
   const pa=rpPos(a),pb=rpPos(b);
   if(pa&&pb)return (pa.row-pb.row)||(pa.col-pb.col);
   return pa?-1:(pb?1:0);
  });
  order.forEach(k=>{
   const span=Math.max(1,Math.min(cols,rpSpan(k)));
   const rows=rpEffRows(k);
   const at=rpPos(k);
   let col=at?Math.max(1,Math.min(cols-span+1,at.col)):1;
   let row=at?Math.max(1,at.row):1;
   /* ---------- 位置を持つ塊は**動かさない**（§9.222 ②、利用者の指示） ----------
      「各カードのサイズを変更しても、位置調整は自動で変更にならないように
        してほしいです。位置調整は基本手動、自動整列は機能としてボタンにして
        押した瞬間だけください。」
      以前はここで重なりを解いて**空いている次のマスへ送っていた**ので、
      1つ大きさを変えるだけで後ろが芋づるに動いた。いまは指定どおりに置き、
      **重なったことを数で言う**（帯の「重なり N件」と塊の赤い縁）。
      詰め直すのは「並べ直す」を押したときだけ。
      場所を**まだ決めていない塊**（新しく足した塊・置き場から出したばかりの
      塊）は今までどおり空いているマスを探す——探さないと、既に置いてある
      塊の真上に重なって出るので、置いた覚えのない重なりが生まれる。 */
   if(at){
    if(!rpFits(col,row,span,rows,used,rpRowCap()*3)){
     rpOverlaps.push(k);
     /* **重なったマスそのものを控える**（§9.223 ③、利用者の指示「重なった
        部分を強調表示など視覚表示で修正をうながす」）。縁だけでは、どの塊の
        どこが当たっているのかが読めない——直すには当たっている場所が要る。 */
     for(let r=0;r<rows;r++)for(let c=0;c<span;c++){
      const cell=(row+r)+':'+(col+c);
      if(used.has(cell))rpOverlapCells.add(cell);
     }
    }
    take(col,row,span,rows);
    out.set(k,{col,row,span,rows});
    return;
   }
   if(!rpFits(col,row,span,rows,used)){
    /* **必ず見つかるところまで探す**（下へは何段でも伸ばせる）。見つから
       ないまま置くと重なってしまい、下の塊のボタンが押せなくなる。
       `rpRowCap()`は**紙の下へどこまで置けるか**（紙1.8枚ぶん）であって、
       置ける段の上限ではない——溢れたぶんは`rpUpdateSheets()`が言う。 */
    let found=false;
    for(let r=row;r<=row+rpRowCap()*2&&!found;r++)
     for(let c=(r===row?col:1);c<=cols-span+1;c++)
      if(rpFits(c,r,span,rows,used,row+rpRowCap()*3)){col=c;row=r;found=true;break}
    if(!found){col=1}
   }
   take(col,row,span,rows);
   out.set(k,{col,row,span,rows});
  });
  return out;
 }
 /* 幅を変える（§9.222 ②）。**大きさを変えても場所は動かさない**
    ——利用者の指示「各カードのサイズを変更しても、位置調整は自動で変更に
    ならないようにしてほしい」。以前はここで①左へ寄せる→②別の段を探す→
    ③縮める、と3段で場所まで決めていたので、幅を1つ押しただけで塊が
    別の段へ飛んでいた（「意図しない形で詰まっていく」の一因）。
    いまは**その場で入るところまで**にして、入らなかったことを文字で言う。
    詰め直したいときは「並べ直す」を押す。 */
 function rpApplySpan(k,span){
  const cols=rpGrid();
  let want=Math.max(1,Math.min(cols,span));
  const at=rpSpotOf(k);
  const wid={...rpLayoutNow().widths};
  if(at){
   const used=rpOccupied(k);
   const rows=Math.max(1,rpEffRows(k));
   const room=cols-at.col+1;                 /* 紙の右端まで */
   /* **紙の外へは広げられない**（物理的な限界なので詰める）。 */
   if(want>room){
    rpSay(`${span}マスは紙の右端からはみ出すので${room}マスにしました（左へ動かすともっと広げられます）。`,true,'overlap');
    want=room;
   }else{
    /* **隣に当たっても縮めない**（§9.223 ③、利用者の指示）。以前はここで
       黙って幅を詰めており、「広げたのに広がらない」＝自動で直された、と
       いう見え方になっていた。重なることは**言う**だけにする。 */
    rpSay(rpFits(at.col,at.row,want,rows,used)?''
      :`${want}マスにしたので隣の塊と重なりました（重なったマスを赤い網で出しています）。`,true,'overlap');
   }
  }
  wid[k]=rpSpanStore(rpSpanFromGrid(want));
  rpStage({widths:wid});
 }
 /* いま埋まっているマス。**自分（掴んでいる塊）は数えない**——数えると
    その場に置き直すことすらできなくなる。 */
 function rpOccupied(exceptKey){
  /* **見えているとおりの埋まり方を見る**（§9.221 ⑨）。保存値（希望）を
     直接見ると、重なりを解いたあとの実際の位置と食い違い、「空いて見える
     マスへ落とせない」「埋まっているマスへ落とせる」の両方が起きる。 */
  const spots=rpResolvePlacement();
  const used=new Set();
  if(!spots)return used;
  spots.forEach((at,k)=>{
   if(k===exceptKey)return;
   for(let r=0;r<at.rows;r++)for(let c=0;c<at.span;c++)used.add((at.row+r)+':'+(at.col+c));
  });
  return used;
 }
 /* いまその塊が置かれているマス（解いたあと）。**保存値ではなくこちらを
    見る**——縁を引く・幅を変えるの基準は「見えている位置」でなければ、
    引いた瞬間に別の場所へ飛ぶ。 */
 function rpSpotOf(k){
  const spots=rpResolvePlacement();
  return (spots&&spots.get(k))||rpPos(k);
 }
 /* `max`を渡すと段の上限を変えられる。**保存できる段の上限
    （`rpRowCap()`）と、探すときの上限は別**——重なりを解くときは下へ
    何段でも伸ばせる（溢れたぶんは紙が2枚になることを帯が言う）。 */
 function rpFits(col,row,span,rows,used,max){
  const cols=rpGrid();
  const top=max||rpRowCap();
  if(col<1||row<1||col+span-1>cols||row+rows-1>top)return false;
  for(let r=0;r<rows;r++)for(let c=0;c<span;c++)if(used.has((row+r)+':'+(col+c)))return false;
  return true;
 }
 /* ---------- 座標は「拡大前」へ直してから測る（§9.222 ②） ----------
    紙(`.rp-page`)は`transform:scale(var(--rp-scale))`で縮めて出しているので、
    **`getBoundingClientRect()`は拡大後のpx**を返す。いっぽう
    `getComputedStyle`の`gap`・`gridAutoRows`は**拡大前のpx**。この2つを
    そのまま割り算すると、器の左上から離れるほど誤差が積み上がる
    ——利用者の指摘「ドラッグ位置とゴーストの位置が合わない。**移動量が
    多いほどずれを感じる**」の正体がこれで、既定の表示（画面に合わせる＝
    倍率0.6前後）では紙の下のほうで数マスぶんずれる。
    **測る前に必ず倍率で割ること。** 窓口は`rpLocal()`の1箇所で、
    マスの割り出し（`rpCellAt`）と縁を引く（`rpBindSizeGrips`）が同じ
    ものを見る——別々に持つと、掴む位置と伸びる量が食い違う。 */
 function rpScaleOf(el){
  const page=(el&&el.closest&&el.closest('.rp-page'))||document.querySelector('.rp-page');
  const v=page?Number(getComputedStyle(page).getPropertyValue('--rp-scale')):1;
  return (v>0&&isFinite(v))?v:1;
 }
 /* 器の中の**拡大前**の座標と、1マスの大きさ。 */
 function rpLocal(grid,clientX,clientY){
  const cols=rpGrid(),rowPx=rpRowPx(grid);
  const cs=getComputedStyle(grid);
  const gapX=parseFloat(cs.columnGap)||0,gapY=parseFloat(cs.rowGap)||0;
  const sc=rpScaleOf(grid),gr=grid.getBoundingClientRect();
  const inner=gr.width/sc;                       /* 拡大前の器の幅 */
  const colW=(inner-gapX*(cols-1))/cols;
  /* **ページに割った余白ぶんは`rpRowAtGridM()`が引き受ける**（§9.282）——
     割ると塊が1枚ぶんずつ下へずれているので、素直に行の高さで割ると
     **落とす先が余白のぶんずれる**。
     **行はここで1度だけ数える**——数える場所が2つあると、掴んだ場所と
     落ちる場所が食い違う。`row`は1から数える。`y`は**描かれているまま**
     （割っていないときの値と同じ）で、行を数えるのに使わないこと。
     物差し(`m`)も返すので、続けて何度も引く側は測り直さなくてよい。 */
  const m=rpPageMetrics();
  const y=(clientY-gr.top)/sc;                    /* 描かれている座標 */
  return {cols,rowPx,gapX,gapY,sc,colW,m,row:rpRowAtGridM(m,y)+1,
          x:(clientX-gr.left)/sc,y};
 }
 /* カーソルの座標 → マスの番号。**掴んだところのぶんを引いて、塊の左上が
    来るマス**を返す（§9.222 ②）。以前はカーソルの真下のマスを左上にして
    いたので、塊の右下を掴むと**掴んだぶんだけ塊が飛んだ**——大きい塊ほど
    ずれが大きく、狙った場所へ一度で置けなかった。掴んだ位置は
    `rpDragGrab`が覚える（一覧の外＝置き場から掴んだときは0）。 */
 let rpDragGrab={dc:0,dr:0};
 function rpCellAt(grid,clientX,clientY){
  const L=rpLocal(grid,clientX,clientY);
  if(!(L.colW>0))return null;
  const c=Math.floor(L.x/(L.colW+L.gapX))+1-(rpDragGrab.dc||0);
  const r=L.row-(rpDragGrab.dr||0);
  return {col:Math.max(1,Math.min(L.cols,c)),
          row:Math.max(1,Math.min(rpRowCap(),r))};
 }
 /* 掴んだ点が塊の左上から何マスぶん内側か。
    **塊の左上のマスは「いま置かれているマス」から取る**（`rpSpotOf`）——
    実寸（`getBoundingClientRect()`）から数えると、境目のわずかな端数で
    `floor`が1つ下の値を返し、**端を掴んだときに1段ずれる**（実測: 20行の
    塊の下端付近を掴むと置いた結果が1段上へ寄る。`tests/test_rplayout.js`が
    2度捕まえた）。カーソル側だけ`rpCellAt`と同じ`floor`で数え、
    **マスの番号どうしを引く**。 */
 function rpSetGrab(grid,el,clientX,clientY){
  rpDragGrab={dc:0,dr:0};
  if(!grid||!el)return;
  const at=el.dataset&&el.dataset.rpBlock?rpSpotOf(el.dataset.rpBlock):null;
  if(!at)return;                              /* 置き場から掴んだときは左上 */
  const L=rpLocal(grid,clientX,clientY);
  if(!(L.colW>0))return;
  rpDragGrab={dc:Math.max(0,Math.floor(L.x/(L.colW+L.gapX))+1-at.col),
              dr:Math.max(0,L.row-at.row)};
 }
 /* ---------- 器に合わせて中身を縮める（§9.221 ⑨） ----------
    「設計したカードのサイズに合わせてコンテンツ貼り付け」。器の大きさは
    利用者が決めたものなので、中身のほうを合わせる。**下限を割ったら
    諦めて、入りきっていないことを文字で言う**（読めない大きさまで縮めるのは
    切れているより悪い・§9.209 ③⑤と同じ約束）。
    **測る前に前回の倍率を外すこと**——付いたまま測ると、一度縮んだ塊は
    二度と元へ戻らない（§9.210 ④・§9.217で踏んだのと同じ罠）。 */
 const RP_FIT_MIN=.55;
 /* ---------- 詰める順序（§9.303 ①、利用者の指示） ----------
    「列内の全体余白の調整→個別に余力のあるもの余白調整→改行による文字
      表示エリア確保(高さ方向への逃げ)→文字サイズ調整による表示用量アップ
      といったような順序でできる限り大きな文字で効率よく表示する」

    §9.298では「余白を詰める（3段）→丸ごと縮める」の2手だったが、
    **折り返しが制御できていなかった**——幅が足りなくなると表のセルは
    その場で折り返すので、**1行で収まるはずのものが2行になり**、増えた高さで
    余白詰めと文字縮小が起きていた（利用者の報告「ある一定程度以上に小さく
    縮めると改行してしまうので1行で納めたいところ2行になってしまったりする」）。

    段は5つ:
     ① そのまま           … **今までどおり**。入る塊の見え方は1pxも変えない（§9.132）
     ② 1行に戻す           … 折り返しで伸びた高さを畳む（`rp-pack-nowrap`）
     ③ 列内の全体余白      … `--rp-pack` .55
     ④ 余力のある列を回す  … `--rp-pack` .25 ＋ `rp-pack-share`
                             （`table-layout:fixed`の等分をやめ、中身の短い列が
                               余らせている幅を、詰まった列へ配り直す）
     ⑤ 折り返す            … ここで初めて高さ方向へ逃がす（文字はまだ縮めない）
    そのうえで、どうしても入らないものだけ`--rp-fit`で文字を縮める。

    **段の中身（どの余白をどれだけ詰めるか・何を1行にするか）は
    `60-report.css`が持ち**、ここが決めるのは**どの段まで進むか**だけ（§9.163）。
    **文字サイズには掛けないこと**——文字を保つのがこの仕組みの目的。 */
 const RP_PACK_STEPS=[
  {dense:1,   nowrap:false,share:false},
  {dense:1,   nowrap:true, share:false},
  {dense:.55, nowrap:true, share:false},
  {dense:.25, nowrap:true, share:true },
  {dense:.25, nowrap:false,share:true },
 ];
 const RP_PACK_CLASSES=['rp-pack-nowrap','rp-pack-share'];
 function rpApplyPack(b,st){
  /* ---------- 塊ごとの段は「紙の余白に掛ける」（§9.313） ----------
     以前はこの段が`--rp-dense`という**1つの値**で、CSS側は
     `var(--rp-dense-x,var(--rp-dense,1))`と**フォールバックで**読んでいた。
     つまり紙の軸が「ふつう」で未設定のとき、**塊の段がその軸の値そのものに
     化ける**——横は「ふつう」のままなのに、縦を押して段が変わると左右の
     余白まで動いた（実測: 縦ふつう→詰める→もっと詰めるで、欄の左右が
     2 → 1.1 → 0.5 → 2 と動いた）。逆に紙の軸を決めると塊の段を**置き換えて
     しまう**ので、「横＝詰める」を押したのに左右が1.1→1.2と**緩む**という
     ことも起きていた。利用者の報告「縦横の余白変更ボタンは別々に機能させ
     たいのに、どちらを押しても両方反応して別々に機能してくれません」。
     いまは**別の変数を掛け算する**（CSSが`× var(--rp-pack,1)`で掛ける）。
     ①紙の軸（利用者が決める）は軸ごとにそのまま効く
     ②塊の段（入りきらないときの自動の詰め）は、その上から**さらに詰める
       方向にしか動かない**——`Math.min`で紙より緩めない配慮も要らなくなる
       （掛け算なので構造として緩められない）。 */
  const d=st.dense;
  if(d>=1)b.style.removeProperty('--rp-pack');
  else b.style.setProperty('--rp-pack',String(d));
  b.classList.toggle('rp-pack-nowrap',!!st.nowrap);
  b.classList.toggle('rp-pack-share',!!st.share);
 }
 function rpFitBlockBodies(host){
  const grid=host&&host.querySelector('.rp-blocks');if(!grid)return 0;
  const boxes=[...grid.querySelectorAll('[data-rp-block].is-placed>.rp-block-fit')];
  if(!boxes.length)return 0;
  /* **倍率はカスタムプロパティで渡す**（`--rp-fit`）。インラインの
     `style.transform`はどのレイヤより強く、CSSから打ち消せなくなる
     （帳票の`--rp-scale`と同じ約束）。
     **測る前に前回の段と縮めを全部外すこと**——1つでも残すと、一度詰まった
     塊は二度と元へ戻らない（§9.210 ④・§9.217で踏んだ罠）。 */
  boxes.forEach(b=>{b.style.removeProperty('--rp-fit');b.style.removeProperty('--rp-pack');
    b.classList.remove(...RP_PACK_CLASSES);
    b.parentElement.classList.remove('is-cramped')});
  const tooTall=b=>{const room=b.parentElement.clientHeight;
    return !!room&&b.scrollHeight>room+1};
  const tooWide=b=>b.clientWidth>0&&b.scrollWidth>b.clientWidth+1;
  /* **①から出る理由は高さだけ**（§9.303 ①）。横溢れは「1行に揃えた結果」
     なので、まだ①（今までどおり）に居る塊を横溢れで動かすと、
     **切り詰めて出す作りの表まで詰め直す**——`table-layout:fixed`＋省略記号の
     表は常に横へ溢れているので、全部が最後の段（折り返す）まで進み、
     そのぶん背が伸びて**刷り上がりがA4に収まらなくなった**（実測 329.8mm）。
     ②以降は「1行に揃えているのに幅が足りない」＝次の段へ進む理由になる。 */
  /* **段ごとにまとめて測る**（塊を1つずつ試すと、その都度グリッド全体が
     組み直されて遅い・`rpFitRows()`と同じ理由）。入りきらないものだけが
     次の段へ進み、入った段でそのまま止まる。 */
  let over=boxes.filter(tooTall);
  for(let i=1;i<RP_PACK_STEPS.length&&over.length;i++){
   over.forEach(b=>rpApplyPack(b,RP_PACK_STEPS[i]));
   over=over.filter(b=>tooTall(b)||tooWide(b));
  }
  let cramped=0;
  /* 段を全部使っても入らないものだけ縮める（今までどおり）。 */
  over.forEach(b=>{
   const room=b.parentElement.clientHeight;
   const need=b.scrollHeight;
   if(!room||need<=room+1)return;
   const k=Math.max(RP_FIT_MIN,room/need);
   b.style.setProperty('--rp-fit',k.toFixed(3));
   if(need*k>room+1){b.parentElement.classList.add('is-cramped');cramped++}
  });
  return cramped;
 }
 function rpEndDrag(){
  rpDragKey=null;rpDragFrom=null;rpDragGrab={dc:0,dr:0};
  document.getElementById('rpGhost')?.remove();
  document.querySelectorAll('.rp-block.is-dragging,.rp-palette-item.is-dragging')
   .forEach(x=>x.classList.remove('is-dragging'));
  document.querySelectorAll('.rp-blocks').forEach(x=>x.classList.remove('is-dropping'));
  const pal=$id('rpPalette');if(pal)pal.classList.remove('is-target');
 }
 function rpCurrentLot(){return rpState.items.find(i=>i.id===rpState.selectedId)||null}
 function rpRepaint(){
  const x=rpCurrentLot();if(!x)return;
  $id('reportContent').innerHTML=reportHtml(x,rpArranging);
  if(rpArranging)bindArrangeHandlers();
  /* **描き直すたびに行を測り直す**（§9.217）。`innerHTML`で作り直すと前の
     割り当ては消えるので、ここを忘れると「最初の1回だけ効く」——設定を
     読み終えたあとの描き直し（`rpLoadLayoutFor`）が必ず通るので、忘れると
     **実質いつも効かない**（実際にそうなった）。 */
  rpAfterPaint();
 }
 /* 描いたあとに1回だけ測る。**2フレーム待つ**——1フレームでは`innerHTML`の
    レイアウトが確定しておらず、高さを読み違える。 */
 function rpAfterPaint(){
  requestAnimationFrame(()=>requestAnimationFrame(rpFitAll));
 }
 /* **写しは必ず新しい形で配る**（§9.222 ②）。widthsを書く呼び出しは全て
    `{...rpLayoutNow().widths}`＝全件の写しを土台にして1〜2キーだけ差し替える
    ので、ここが古い形のままだと**書き込みの入口で敷き直しても後勝ちで
    捨てられる**（実際にそうなっていた。以降`__配置版__`だけが立ち、古い値が
    「値-40」として読まれて配置が飛ぶ）。読み替えは`rpNum()`＝読む側と同じ
    換算を通すので、画面に出ている位置と保存される位置が食い違わない。 */
 function rpLayoutNow(){
  const l=WL.columnLayout.get(rpTarget());
  return {order:[...(l.order||[])],widths:rpEncoded()?{...(l.widths||{})}:rpLegacyWidths(),
          hidden:[...(l.hidden||[])],
          names:{...(l.names||{})},formats:{...(l.formats||{})},rules:{...(l.rules||{})},
          formulas:{...(l.formulas||{})},locks:[...(l.locks||[])],
          /* **写し漏らさない**（§9.113）。`saveArrange()`は全置換なので、
             ここに無いキーは保存のたびに空へ落ちる。帳票では使っていない
             設定でも、同じ対象を別の画面が触りうる以上そのまま運ぶ。 */
          sorts:JSON.parse(JSON.stringify(l.sorts||{})),
          aligns:JSON.parse(JSON.stringify(l.aligns||{}))};
 }
 /* ---------- 古い形の`widths`を新しい形へ（§9.222 ②） ----------
    「40＋数」へ切り替えたので、古い保存値（×40 / ×60 / ×30）が混ざると
    同じ`widths`に2つの意味が同居する。**書き込みの入口で1回だけ**まとめて
    直す（§9.113の「散らばった場所で気を付けるのではなく入口で落とす」）。
    読み替えは`rpNum()`＝**読む側とまったく同じ換算**を通す（別に持つと、
    画面に出ている位置と保存される位置が食い違う）。
    pxとして意味を持つ`高さ:`と`列幅:`は触らない。 */
 function rpLegacyWidths(){
  const l=WL.columnLayout.get(rpTarget());
  const src=l.widths||{};
  const out={};
  /* **塊かどうかは「並びに載っているか」でも見る**。自作の塊は非同期で
     届くので、`rpBlockOf()`だけだと**まだ届いていない塊の幅が古い形のまま
     残る**（新旧の数の範囲は重なるので、値からは見分けられない）。 */
  const known=new Set(l.order||[]);
  Object.keys(src).forEach(key=>{
   if(key===RP_GRID_KEY){out[key]=rpEnc(rpGrid());return}
   if(key===RP_PAGE_ROWS_KEY){out[key]=rpEnc(rpPageRows());return}
   /* 余白は新しい形でしか書かれないが、**紙ぜんたいの設定はここに並べる**
      ——一覧から漏れると、次に読み替えが走ったとき塊の幅として扱われる。 */
   if(key===RP_PACK_KEY){out[key]=rpEnc(0);return}   /* 旧鍵は捨てる（§9.311 C） */
   if(key===RP_PACK_X_KEY){out[key]=rpPackStore(rpPackXLevel(),RP_PACK_X_LEVELS);return}
   if(key===RP_PACK_Y_KEY){out[key]=rpPackStore(rpPackYLevel(),RP_PACK_Y_LEVELS);return}
   if(key.startsWith('列:')){out[key]=rpEnc(rpNum(key,'col',40));return}
   if(key.startsWith('行:')){out[key]=rpEnc(rpNum(key,'row',40));return}
   if(key.startsWith('行数:')){out[key]=rpEnc(rpNum(key,'rowspan',30));return}
   if(key.startsWith('高さ:')||key.startsWith('列幅:')){out[key]=src[key];return}
   if(rpBlockOf(key)||known.has(key)){out[key]=rpEnc(rpNum(key,'colspan',60));return}
   out[key]=src[key];
  });
  return out;
 }
 /* **渡す設定を1つでも書き漏らさない**（§9.113。保存もstageも全置換）。 */
 /* ---------- 紙の配置は「触ったら裏で保存」（§9.303 ③） ----------
    利用者の指示「帳票の紙のレイアウトを触るとき、保存ボタンがありますが、
    保存ボタンは無くしバックグラウンドで常に保存するタイプに変更してほしい
    …帳票ブロックマスタに頻繁に移動したりする…移動するたびに修正していた
    内容が飛ぶので現在の都度保存ボタンは使いづらい」。

    以前は下書き（`stage`）へ溜めて「保存」で確定していたので、**塊の
    ダブルクリックで帳票ブロックマスタへ移る・設備を切り替える・画面を
    離れる**のどれでも触ったぶんが消えた（`closeArrange(false)`が
    `discard()`する）。**書き込みの入口は`rpStage()`の1箇所**なので、
    そこで落ち着いてから1回保存する（§9.113）。

    **保存は直列に流すこと**（`rpSaveChain`）——掴んで動かすと連続で
    呼ばれるので、前の保存の途中で次を投げると、どちらが最後に書いたのかが
    決まらない（§9.197の列幅と同じ作法）。
    **落ち着いてから**（`RP_AUTOSAVE_MS`）——1マス動かすたびに共有へ
    往復すると、掴んでいる最中に画面が止まる。 */
 const RP_AUTOSAVE_MS=400;
 let rpSaveTimer=null,rpSaveChain=Promise.resolve(),rpSaveDirty=false,rpSaveErr='';
 /* ---------- 往復のあいだに触ったぶんを捨てない（§9.312） ----------
    利用者の報告「サイズ変更した際にその近くにある帳票ブロックのサイズも
    一緒に変更される／なんとなく位置が戻されるような感覚がある」。

    **触った回数**。保存の往復のあいだに触ったかどうかは、これでしか
    見分けられない——`rpSaveDirty`は真偽1つなので、往復の**始まりで**
    立った旗と**途中で**立った旗が同じものになり、往復を終えた側が
    「自分の保存は済んだ」つもりで**新しく立った旗まで下ろす**。 */
 let rpEditSeq=0;
 function rpQueueSave(){
  rpSaveDirty=true;rpSaveErr='';rpEditSeq++;
  if(rpSaveTimer)clearTimeout(rpSaveTimer);
  rpSaveTimer=setTimeout(()=>{rpSaveTimer=null;rpSaveNow()},RP_AUTOSAVE_MS);
  rpPaintAutoSave();
 }
 function rpSaveNow(){
  /* **どの紙へ書くかは投げる時点で決める**——設備を切り替えると`rpTarget()`が
     変わるので、後から読むと別の設備の紙へ書きうる（切り替えの側も
     `rpFlushSave()`を通す）。 */
  const target=rpTarget();
  rpSaveChain=rpSaveChain.then(async()=>{
   if(!rpSaveDirty)return;
   /* **初めて保存する瞬間に既定を書き下ろす**（§9.162と同じ）。忘れると、
      幅を1回変えただけで分解した1枚ずつが全部紙に出る。 */
   const now=rpLayoutNow();
   if(!(now.order||[]).length)now.hidden=[...new Set([...(now.hidden||[]),...rpInitialHidden()])];
   if(!(now.order||[]).length)now.order=rpBlockKeys();
   /* **いつの形を送るのかを控えてから投げる**（§9.312）。 */
   const seq=rpEditSeq;
   await WL.columnLayout.save(target,now);
   rpSaveErr='';
   /* ---------- ここで下書きを捨てないこと（§9.312） ----------
      `WL.columnLayout.save()`は**投げる前に**下書きを捨て、保存済み(saved)へ
      当ててから網へ出る（`base.js`）。だから往復のあいだに触ったぶんは
      **新しい下書き**に載っている——ここで`discard()`すると、その新しい
      下書きごと捨てることになる。捨てるのはデータだけで画面はそのままなので、
      **利用者が次に別の塊を触った瞬間**（`rpRepaint()`）に、さっき触った塊が
      元の大きさ・元の場所へ戻る。これが報告された「別の塊を触ったら近くの
      塊のサイズも変わった」「位置が戻される感覚」の実体（実測: 幅10マスに
      した塊が、別の塊を1マス引いただけで12マスへ戻った）。
      マスタが共有にあると1回の保存に数秒かかる（§9.263／§9.273）ので、
      **往復のあいだに次を触るのがふつう**——手元にマスタがある端末では
      往復が一瞬なので、この道をほとんど通らずに見過ごされていた。
      **旗を下ろすのも「触った回数が変わっていないとき」だけ。**
      下ろしてしまうと、後ろに並んでいる保存が`if(!rpSaveDirty)return`で
      取り下げられ、触ったぶんが**どこへも書かれない**（実測: 往復中に
      変えた幅がマスタに1バイトも入らなかった）。 */
   if(rpEditSeq===seq)rpSaveDirty=false;
   /* 往復のあいだに触っていたら、追いかけの保存が要る。ふつうは
      `rpQueueSave()`の待ちが控えているが、**待ちが既に使われていた場合**
      （`rpFlushSave()`が流したあとに触った等）に取りこぼさないよう、
      無ければここで置く。 */
   else if(!rpSaveTimer)rpSaveTimer=setTimeout(()=>{rpSaveTimer=null;rpSaveNow()},RP_AUTOSAVE_MS);
   rpPaintAutoSave();
  }).catch(e=>{
   /* **黙って捨てない**（§9.212 ④）。旗は下ろさない——次に触ったとき、
      あるいは画面を離れるときの`rpFlushSave()`でもう一度書きに行く。
      画面の値は`save()`が保存済み(saved)へ当てているのでそのまま残る。 */
   rpSaveErr=String((e&&e.message)||e||'保存できませんでした');
   rpPaintAutoSave();
  });
  return rpSaveChain;
 }
 /* 画面を離れる・設備を切り替える・マスタへ移るときは**待たずに投げる**。
    返すのは直列の鎖なので、待ちたい側は`await`できる。 */
 function rpFlushSave(){
  if(rpSaveTimer){clearTimeout(rpSaveTimer);rpSaveTimer=null;return rpSaveNow()}
  return rpSaveChain;
 }
 /* **いまどうなっているかを文字で出す**（§3）。黙って保存すると、
    保存されたのか消えたのかが読めない。 */
 function rpPaintAutoSave(){
  const el=$id('rpArrangeAuto');if(!el)return;
  el.classList.toggle('is-bad',!!rpSaveErr);
  el.textContent=rpSaveErr?'保存できませんでした'
    :(rpSaveDirty||rpSaveTimer)?'保存しています…':'自動で保存します';
  el.title=rpSaveErr
    ?`${rpSaveErr}\n直したところは画面に残しています。もう一度触ると保存し直します。`
    :'組み換えの内容は触るたびに自動で保存します。帳票ブロックマスタへ移っても消えません。';
 }
 /* `opts.persist===false`は**利用者が触っていない書き込み**（組み換えに
    入った時点の書き下ろし・`rpSeedPositions`）。ここまで保存すると、
    **開いて閉じただけで紙の設定が確定してしまう**（§9.132）。 */
 function rpStage(patch,opts){
  const base=rpLayoutNow();                 /* 既に新しい形へ直してある */
  /* 書いたものが新しい形であることを**刻む**。読み替えは`rpLayoutNow()`が
     済ませているので、ここでするのは印だけ（2箇所で直すと、どちらが先かで
     結果が変わる）。
     **`widths`を触らない呼び出し（`hidden`だけ・`formats`だけ）でも刻む。**
     土台の`base.widths`は既に読み替え済みなので、印を付けずに置くと
     次に読むときまた古い形とみなして**二重に読み替える**（位置が跳ね上がる）。 */
  base.widths={...base.widths,[RP_ENC_KEY]:rpEnc(RP_ENC_VER)};
  if(patch&&patch.widths)patch={...patch,widths:{...patch.widths,[RP_ENC_KEY]:rpEnc(RP_ENC_VER)}};
  /* **触った時点で既定を書き下ろす。** `rpHiddenSet()`は「まだ一度も並びを
     保存していない＝既定」で判断するので、orderが空のままhiddenだけ書くと、
     次に読むときまた既定へ戻り、**押しても何も起きない**（分解が効かない、で
     実際に踏んだ）。 */
  if(!(base.order||[]).length){
   base.hidden=[...new Set([...(base.hidden||[]),...rpInitialHidden()])];
   base.order=rpBlockKeys();
  }
  WL.columnLayout.stage(rpTarget(),{...base,...patch});
  if(!(opts&&opts.persist===false))rpQueueSave();
  rpRepaint();
  /* **設定を触ったら帯も言い直す**（§CLAUDE 2/8）。重なり件数・外している
     件数・残りmmは全部この帯にあるので、置き直し・幅・高さ・出し入れの
     どれを変えても言い直さないと、直前の操作が通ったのかが読めない。
     経路は十数箇所あるので**書き込みの入口で1回だけ**呼ぶ（§9.113）。 */
  if(rpArranging)updateArrangeBar();
 }
 async function toggleArrange(){
  if(rpArranging){closeArrange();return}
  if(!rpState.selectedId){showToast&&showToast('先にロットを選んでください','左の一覧から選ぶと、その帳票を見ながら組み換えられます',4000);return}
  /* 開いた時点では**そのロットの設備**を編集対象にする（§9.239 ③）。 */
  rpEditEquipment=rpEquipmentOf(rpCurrentLot())||'';
  /* **設備マスタも読む**——「この端末にその設備のロットが無いから編集
     できない」を無くすのがこの機能の目的なので、レコードから拾える設備
     だけでは足りない（実際、検証用データでは1つしか出なかった）。
     読めなくても組み換えは開ける（fail-open）。 */
  try{if(typeof WL.records.loadEquipmentMaster==='function')await WL.records.loadEquipmentMaster()}catch(e){WL.quiet.note('設備マスタを取れない（設備を選ぶ欄が減るだけ）',e)}
  try{await Promise.all([WL.columnLayout.load(rpTarget()),
                         rpLoadUserBlocks(rpEditEquipment)])}catch(e){WL.quiet.note('列の設定を取れない（既定の並びで出す）',e)}
  rpArranging=true;rpSeeded=false;
  /* **置き場は左サイドバーの中**（§9.276 ①）なので、畳んだままだと
     組み換えの主要動線が消える（§CLAUDE 4）。入るときだけ開く——
     抜けたあとは利用者が選んだ状態へ戻す（覚えは触らない）。 */
  if(rpNavHidden){rpNavWasHidden=true;rpNavHidden=false;applyNavVisibility()}
  document.body.classList.add('rp-arranging');
  updateArrangeBar();rpRepaint();
 }
 /* 閉じる。**触ったぶんは既に保存されている**（§9.303 ③）ので、
    ここでするのは**まだ投げていない保存を流すこと**だけ。
    触っていなければ下書き（＝組み換えに入った時点の書き下ろし）を捨てる
    ——残すと、開いて閉じただけの紙が他の画面でその重ねのまま描かれる
    （§9.212 ③）。 */
 function closeArrange(){
  if(!rpArranging)return;
  if(rpSaveTimer||rpSaveDirty)rpFlushSave();      /* 保存が下書きを片付ける */
  else WL.columnLayout.discard(rpTarget());
  /* **選んだ設備は組み換えを抜けたら戻す**（§9.239 ③）。戻さないと、
     通常表示のプレビューまで別設備の設定で描かれる。 */
  rpEditEquipment=null;
  rpUseEquipmentBlocks(rpEquipmentOf(rpCurrentLot())||'');
  rpArranging=false;rpPaperView=false;
  /* 開いたのはこちらの都合なので、抜けるときに元へ戻す（§9.276 ①）。 */
  if(rpNavWasHidden){rpNavWasHidden=false;rpNavHidden=true;applyNavVisibility()}
  closeBlockEditor();
  document.body.classList.remove('rp-arranging');
  updateArrangeBar();rpRepaint();
 }
 function resetArrange(){
  /* 既定へ戻す＝設定を空にする（登録順・登録幅・全部出す）。 */
  rpStage({order:[],widths:{},hidden:[]});
 }
 /* **閲覧モードでは配置ボタンごと出さない**（§9.169）。列レイアウトマスタの
    保存はedit/scheduleにしか開いていないので、組み換えても保存で弾かれる
    ——押せるのに何も起きないボタンは、無い機能より質が悪い（§9.120）。 */
 function syncArrangeButton(){
  const btn=$id('reportArrange');if(!btn)return;
  const mode=(window.accessMode&&window.accessMode.mode)||'edit';
  btn.hidden=(mode==='view');
  if(btn.hidden&&rpArranging)closeArrange();
 }
/* 組み換え中の一言（§9.221 ⑨）。**黙って何も起きないのがいちばん悪い**
    ——置けなかった・縮めた・入りきらない、はその場で文字にする。 */
 /* 組み換え中の一言。**常設の案内を潰さない**（§CLAUDE 2/6）——以前は
    `innerHTML`ごと差し替えていたので、①最初の1回で「置き方」と「いま
    外しているのは N 件」という常設の説明が消え、②断りの赤文字は成功
    しても消えなかった（直前の操作が通ったのか分からない）。常設の文は
    そのまま残し、一言だけを継ぎ足す／空文字で引っ込める。 */
 /* **一言は状態として持つ。** 帯は`innerHTML`ごと組み直すので、DOMへ書いた
    だけだと次の組み直しで消える（設定を触るたびに帯を言い直すようにしたので、
    断りの文が**書いた次の瞬間に消える**）。`kind`は「なぜ言っているか」で、
    入りきらない知らせ(`fit`)は直ったら自分で消えるが、**操作の断り(`tip`)を
    それで巻き添えにしない**。 */
 let rpNote={text:'',bad:false,kind:'tip'};
 function rpSay(text,bad,kind){
  const k=kind||'tip';
  /* 直ったら消す、は**同じ種類のときだけ**。 */
  if(!text&&rpNote.text&&rpNote.kind!==k)return;
  rpNote={text:String(text||''),bad:!!bad,kind:k};
  rpPaintNote();
 }
 function rpPaintNote(){
  const el=$id('rpArrangeNote');if(!el)return;
  let tip=el.querySelector('.rp-arrange-tip');
  /* **言うなら見えるところへ。** 常設の案内は`?`で畳めるようにしてあるので、
     畳んだままだと断りの文が`hidden`の中へ入って**一度も読まれない**
     （押しても何も起きないのと同じ・§CLAUDE 4）。文があるあいだは開き、
     消えたら畳んだ状態へ戻す。 */
  if(!rpNote.text){
   if(tip)tip.remove();
   el.classList.remove('is-bad');
   el.hidden=!rpHelpOpen;
   return;
  }
  if(!tip){tip=document.createElement('b');tip.className='rp-arrange-tip';el.appendChild(tip)}
  tip.textContent=rpNote.text;
  el.classList.toggle('is-bad',rpNote.bad);
  el.hidden=false;
 }
 /* 左上から詰め直す（§9.221 ⑨）。**「任意の場所へ置ける」の裏側**として
    要る——1つずつ動かして整えるのは手間なので、いったん整列させてから
    直したいところだけ動かせるようにする。並びの順に置く。 */
 function rpRelayout(){
  const cols=rpGrid();
  const wid={...rpLayoutNow().widths};
  const used=new Set();
  const hidden=rpHiddenSet();
  rpBlockKeys().forEach(k=>{
   if(hidden.has(k))return;
   const span=Math.max(1,Math.min(cols,rpSpan(k)));
   const rows=rpEffRows(k);
   let col=1,row=1;
   while(row<=rpRowCap()){
    if(rpFits(col,row,span,rows,used))break;
    col++;
    if(col+span-1>cols){col=1;row++}
   }
   if(row>rpRowCap()){row=rpRowCap();col=1}
   for(let r=0;r<rows;r++)for(let c=0;c<span;c++)used.add((row+r)+':'+(col+c));
   wid[rpColKey(k)]=rpColStore(rpColToBase(col));
   wid[rpRowPosKey(k)]=rpRowStore(rpRowToBase(row));
   /* **「中身なり」の塊に高さを書き込まない**（§9.222 ②）。並べ直しは
      場所を詰めるだけの操作なので、ここで行数を書くと**押しただけで
      全部の塊の高さが固定される**（そのときの見た目のまま凍り、以降
      中身が増えても伸びない）。高さを決めるのは縁を引いたときだけ。 */
   if(rpRowsSet(k))wid[rpRowsKey(k)]=rpRowsStore(rpRowsFromGrid(rows));
  });
  rpStage({widths:wid});
  rpSay('左上から詰め直しました。');
 }
 /* ---------- どの設備の配置を編集するか（§9.239 ③、利用者の指示） ----------
    「帳票カスタム機能について、設備ごとレイアウト調整できるように」

    保存の器は§9.174で既に`report:<設備>`。足りなかったのは
    **選ぶ手立て**と**いま何を触っているかの表示**（§9.176「どの表の設定かを
    見出しに出す」が帳票では守られていなかった）。
    **見本の紙は必ずそのロットのデータで描く**ので、選んだ設備のロットが
    この端末に無いときは**そう書く**（§4／§9.107「0件は無いとは限らない」）。 */
 function rpEquipmentChoices(){
  const seen=new Map();
  (rpState.items||[]).forEach(x=>{
   const eq=rpEquipmentOf(x)||'';
   seen.set(eq,(seen.get(eq)||0)+1);
  });
  /* 設備マスタにあってレコードが1件も無い設備も選べるようにする
     ——「その設備のロットがまだ無いから設定できない」を作らない。
     **`window.` を付けて参照しないこと**（§9.215と同じ罠）——
     `WL.records.equipmentMasterState`は`records-store.js`のトップレベルの`let`で、
     `window`のプロパティにならない。`window.equipmentMasterState`と書くと
     **常にundefined**になり、設備マスタの設備が1つも候補に出ない
     （実際にそうなり、`test_rplayout`が「選択肢が1つしかない」で捕まえた）。 */
  const master=(typeof WL.records.equipmentMasterState!=='undefined'&&WL.records.equipmentMasterState.items)||[];
  /* **絞るのは「ロットが1件も無い設備」だけ**（§9.302）——記録のある設備は
     使える機能を外しても候補に残す（履歴なので、外した瞬間にその設備の紙が
     開けなくなるのは行き過ぎ・§9.15）。 */
  master.forEach(e=>{
   const n=String(e.name||'').trim();if(!n||seen.has(n))return;
   if(typeof WL.records.equipmentUsableFor==='function'&&!WL.records.equipmentUsableFor(e,'report'))return;
   seen.set(n,0);
  });
  const out=[...seen.entries()].map(([eq,n])=>({eq,n,label:eq||'共通（設備の分からないロット）'}));
  out.sort((a,b)=>(a.eq?1:0)-(b.eq?1:0)||a.eq.localeCompare(b.eq,'ja'));
  return out;
 }
 function rpEditEqNow(){
  return rpEditEquipment!=null?rpEditEquipment:(rpEquipmentOf(rpCurrentLot())||'');
 }
 function rpEqPickHtml(){
  const cur=rpEditEqNow();
  const choices=rpEquipmentChoices();
  const hit=choices.find(c=>c.eq===cur);
  const lotEq=rpEquipmentOf(rpCurrentLot())||'';
  /* 見本の紙とちがう設備を編集しているときは**必ず言う**（§CLAUDE 6）。 */
  const mismatch=cur!==lotEq;
  return `<span class="rp-bar-group rp-bar-eq${mismatch?' is-warn':''}">`
   +`<i class="rp-bar-label" title="この配置を保存する対象です。設備ごとに別の配置を持てます">設備</i>`
   +`<select class="rp-eq-pick" data-rp-eq title="どの設備の配置を編集するかを選びます。`
   +`見本の紙はその設備のロットで描きます（無いときは今のロットで形だけ確かめます）">`
   +choices.map(c=>`<option value="${esc(c.eq)}"${c.eq===cur?' selected':''}>`
     +`${esc(c.label)}${c.n?`（${c.n}件）`:'（この端末にロットなし）'}</option>`).join('')
   +(hit?'':`<option value="${esc(cur)}" selected>${esc(cur||'共通')}</option>`)
   +`</select>`
   +(mismatch?`<b class="rp-chip is-bad" title="見本の紙は「${esc(lotEq||'共通')}」のロットです。`
      +`形は確かめられますが、値はそのロットのものです">見本は${esc(lotEq||'共通')}のロット</b>`:'')
   +`</span>`;
 }
 function rpBindEqPick(root){
  const sel=root.querySelector('[data-rp-eq]');if(!sel)return;
  sel.onchange=async()=>{
   const eq=String(sel.value||'');
   /* **切り替える前に、いまの設備ぶんの保存を流し切る**（§9.303 ③）——
      投げ残したまま`rpTarget()`が変わると、直したぶんが**別の設備の紙**へ
      書かれる（自動保存にした以上、ここは待ってから進む）。 */
   try{await rpFlushSave()}catch(e){WL.quiet.note('配置を書き切れない（下書きは残るので次に保存される）',e)}
   /* **読み終えてから切り替える**（§9.239 ③）。読む前に`rpStage()`が走ると
      `order`が空＝既定と見なして書き下ろし、その設備の保存済みの配置を
      空だと思って上書きする（§9.173の罠）。 */
   const t=RP_LAYOUT_PREFIX+(eq||'共通');
   try{await Promise.all([WL.columnLayout.load(t),rpLoadUserBlocks(eq)])}catch(e){WL.quiet.note('列の設定を取れない（既定の並びで出す）',e)}
   rpEditEquipment=eq;
   rpUseEquipmentBlocks(eq);
   /* その設備のロットがあれば見本もそちらへ移す（紙は必ずそのロットの
      データで描く、を崩さない）。 */
   const same=(rpState.items||[]).find(x=>(rpEquipmentOf(x)||'')===eq);
   if(same&&same.id!==rpState.selectedId){selectLot(same.id);updateArrangeBar();return}
   rpRepaint();updateArrangeBar();
  };
 }
 /* この配置を他の設備へも当てる（§9.239 ③）。設備ごとに1件ずつ組み直す
    のは現実的でないので、これが「設備ごとにできる」を実用にする鍵。
    **材料は保存済みから取る**（`saved()`。`get()`は組み換え中の下書きを
    含むので、触っただけの内容が他設備へ焼き付く。§9.212 ③）。
    **上書きになるので宛先を名指しで1回だけ確認する**（§5）。 */
 async function rpCopyLayoutTo(){
  const from=rpTarget();
  const src=WL.columnLayout.saved(from);
  if(!(src.order||[]).length){
   showToast&&showToast('先に保存してください','この設備の配置がまだ保存されていません',4500);return;
  }
  const others=rpEquipmentChoices().filter(c=>c.eq!==rpEditEqNow());
  if(!others.length){showToast&&showToast('他の設備がありません','',3500);return}
  const names=others.map(c=>c.label).join('、');
  if(!(await confirmModal(`いまの配置を次の設備へも当てますか？\n\n${names}\n\n`
    +'それぞれの今の配置は置き換わります（元へは戻せません）。')))return;
  let ok=0,ng=0;
  for(const c of others){
   try{await WL.columnLayout.save(RP_LAYOUT_PREFIX+(c.eq||'共通'),src);ok++}
   catch(e){ng++;console.warn('帳票の配置のコピーに失敗',c.eq,e)}
  }
  showToast&&showToast(`${ok}件の設備へ当てました`,ng?`${ng}件は失敗しました`:'次に開いたときも同じ形で出ます',5000);
 }
 function updateArrangeBar(){
  const bar=$id('rpArrangeBar'),btn=$id('reportArrange');
  if(btn){
   btn.classList.toggle('is-on',rpArranging);
   btn.title=rpArranging?'組み換えをやめます':'帳票に出す塊・並び・幅をその場で組み換えます';
  }
  if(!bar)return;
  bar.hidden=!rpArranging;
  if(!rpArranging){renderPalette();return}
  /* **帯の件数は置き場の件数と同じ数え方にする**（§CLAUDE 8）。`rpHiddenSet()`は
     まだ届いていない自作の塊まで含むので、そのまま数えると「外している 3件」と
     出ているのに置き場には2枚しか無い、という食い違いが起きる。 */
  const hiddenSet=rpHiddenSet();
  const hidden=rpBlockKeys().filter(k=>hiddenSet.has(k)).length;
  const info=bar.querySelector('.rp-arrange-info');
  if(info){
   const g=rpGrid();
   /* **重なりは数え直してから出す**（§9.222 ②）。`rpOverlaps`は最後に
      解いたときの結果なので、帯だけ先に描くと1手前の数が出る。 */
   rpResolvePlacement();
   const over=rpOverlaps.length;
   /* ---------- 帯は「割り／整える／見る／状態」の4つだけ（§9.222 ④） ----------
      利用者の指摘「メニューがごちゃごちゃ。ボタンが大きすぎるものや
      長すぎる説明。直感的ではないメニューを整理してもう少し使いやすく
      コンパクトにわかりやすい使いやすい高性能で多機能なモダンなメニューに
      してほしい」。
      直したのは3つ。①**塊で分ける**（同じ目的のものを並べ、群の見出しを
      1語にする）②**説明は畳む**（常設の2行の文が帯の半分を占めていた。
      「?」で開く）③**寸法をトークンへ**（`--ctl-h-xs`。`--ctl-h-sm`の
      「紙のとおりに見る」だけが一回り大きく、押し間違いの的になっていた）。
      **状態は文字で出す**（§3）——収まり・重なり・外している数の3つ。 */
   const seg=(label,hint,items)=>`<span class="rp-bar-group"><i class="rp-bar-label" title="${esc(hint)}">${esc(label)}</i>`
     +`<span class="rp-seg">${items}</span></span>`;
   /* ---------- 帯は1行（§9.255 ①、利用者の指示） ----------
      「帳票表示画面の上部がごちゃついているので、すっきりわかりやすい
       メニューでコンパクトに2行分くらいにまとめてほしいです」

      直す前は**帯だけで実測137px（3行）**＋置き場70px＋見本の帯41pxで、
      紙が始まるのは297pxから。減らしたのは3つ。
       ①**同じことを2度言わない**（§CLAUDE 8）——「配置を組み換え中」は
         帯の色と`#reportArrange`の点灯が既に言っている。短い札1枚にする。
       ②**たまにしか押さないものは「⋯」の中へ**（他の設備へ当てる・
         既定に戻す・操作の説明）。取り消せない「既定に戻す」を主要動線から
         離せるので、§CLAUDE 5にも合う。
       ③**状態は1行に詰める**——収まり・重なり・外しの3つは変わらないが、
         「重なりなし」「全部出しています」のような**何も起きていないこと**は
         短い印で足りる（§3の「文字で言う」は保つ）。 */
   info.innerHTML=
     `<b class="rp-arrange-tag" title="いまは配置の組み換え中です。紙の塊を掴んで動かせます">組み換え中</b>`
    +rpEqPickHtml()
    +seg('割り','紙を何マス×何段で割るか。細かいほど自由に置けます',
       RP_GRIDS.map(v=>`<button type="button" data-rp-grid="${v}" class="${v===g?'is-on':''}"`
        +` title="紙を横${v}マスで割ります">${v}</button>`).join('')
       +`<b class="rp-seg-x">×</b>`
       +RP_PAGE_ROW_CHOICES.map(v=>`<button type="button" data-rp-prow="${v}" class="${v===rpPageRows()?'is-on':''}"`
        +` title="紙の縦を${v}段で割ります（1マスが紙の1/${v}）">${v}</button>`).join(''))
    /* **余白は「割り」の隣**（§9.308）——どちらも紙ぜんたいの見え方で、
       決める順も「何マスに割るか → どれだけ詰めるか」。段が足りない塊は
       これより**さらに**詰まる（今までどおり）。 */
    /* **余白は横と縦の2つの巡回ボタン**（§9.311 C／D。利用者の指示
       「無駄にスペースを使っている部分は節約してすっきりシンプルに」）——
       3段×2軸を札で並べると6個になる。**押すたびに次へ進み、いま選んで
       いるものをボタンの文字が言う**（§9.247 ①の`切替`と同じ作法）。 */
    +seg('余白','紙ぜんたいの余白。横は文字の表示領域が広がり、縦は行が薄くなります（文字の大きさは変わりません）',
       rpPackCycleHtml('x','横',RP_PACK_X_LEVELS,rpPackXLevel())
      +rpPackCycleHtml('y','縦',RP_PACK_Y_LEVELS,rpPackYLevel()))
    +`<span class="rp-bar-state">`
      +`<span class="rp-page-fit" id="rpPageFit"></span>`
      +(over?`<b class="rp-chip is-bad" title="場所が重なっている塊です。「並べ直す」で整えられます">重なり ${over}</b>`
            :`<b class="rp-chip is-ok" title="場所が重なっている塊はありません">重なりなし</b>`)
      +(hidden?`<b class="rp-chip" title="下の置き場にあります。掴んで紙へ落とすと出ます">外し ${hidden}</b>`
             :`<b class="rp-chip" title="すべての塊を紙に出しています">全部出す</b>`)
    +`</span>`
    +`<span class="rp-bar-group rp-bar-tools">`
      +`<button type="button" class="rp-bar-btn" data-rp-relayout title="いま出ている塊を左上から詰め直します。押した瞬間だけ効きます（ふだんは自動で動きません）">並べ直す</button>`
      +`<button type="button" class="rp-bar-btn${rpPaperView?' is-on':''}" data-rp-paper`
        +` aria-pressed="${rpPaperView?'true':'false'}"`
        +` title="${rpPaperView?'いまは「紙のとおり」です。押すと操作の帯へ戻ります':'操作の帯を隠して、刷ったとおりの姿で確かめます'}">`
        +`紙のとおり${rpPaperView?'：中':''}</button>`
      +`<button type="button" class="rp-bar-btn rp-bar-more" data-rp-more`
        +` aria-haspopup="menu" aria-expanded="${rpMoreOpen?'true':'false'}"`
        +` title="他の設備へ当てる・既定に戻す・操作の仕方">⋯</button>`
    +`</span>`;
   rpRenderArrangeMenu();
   info.querySelectorAll('[data-rp-grid]').forEach(b=>b.onclick=()=>{
    rpStage({widths:{...rpLayoutNow().widths,[RP_GRID_KEY]:rpEnc(Number(b.dataset.rpGrid))}});
    updateArrangeBar();
   });
   info.querySelectorAll('[data-rp-prow]').forEach(b=>b.onclick=()=>{
    rpStage({widths:{...rpLayoutNow().widths,[RP_PAGE_ROWS_KEY]:rpPageRowsStore(Number(b.dataset.rpProw))}});
    updateArrangeBar();
   });
   /* **押すたびに次の段へ**（一巡する）。**両方の鍵を必ず書き、旧鍵は捨てる**
      ——片方だけ書くと、もう片方が旧`__余白__`を読み続けて食い違う（§9.294 ②）。 */
   info.querySelectorAll('[data-rp-pack]').forEach(b=>b.onclick=()=>{
    const ax=b.dataset.rpPack;
    const lv=ax==='x'?RP_PACK_X_LEVELS:RP_PACK_Y_LEVELS;
    const now=ax==='x'?rpPackXLevel():rpPackYLevel();
    const next=(now+1)%lv.length;
    rpStage({widths:{...rpLayoutNow().widths,
      [RP_PACK_KEY]:rpEnc(0),
      [RP_PACK_X_KEY]:rpPackStore(ax==='x'?next:rpPackXLevel(),RP_PACK_X_LEVELS),
      [RP_PACK_Y_KEY]:rpPackStore(ax==='y'?next:rpPackYLevel(),RP_PACK_Y_LEVELS)}});
    updateArrangeBar();
   });
   rpBindEqPick(info);
   const rel=info.querySelector('[data-rp-relayout]');
   if(rel)rel.onclick=()=>rpRelayout();
   const pv=info.querySelector('[data-rp-paper]');
   if(pv)pv.onclick=()=>{rpPaperView=!rpPaperView;rpRepaint();updateArrangeBar()};
   const mo=info.querySelector('[data-rp-more]');
   if(mo)mo.onclick=e=>{e.preventDefault();rpToggleMore(mo)};
  }
  renderPalette();
  /* **帯を組み直したら残りmmと一言も入れ直す**（§CLAUDE 2）。`#rpPageFit`と
     `#rpArrangeNote`はこの`innerHTML`の中なので、入れ直さないと次に
     `rpMarkOverflow()`が走るまで空欄のまま——マス数を変えた直後こそ
     「収まるか」を知りたいし、断りの文は書いた瞬間に消えてしまう。 */
  try{rpUpdateSheets()}catch(e){WL.quiet.note('紙の切れ目を引き直せない（枚数の帯が古いまま）',e)}
  rpPaintNote();
 }
 function bindArrangeHandlers(){
  const host=$id('reportContent');if(!host)return;
  /* **描いてから測る**（§9.173）。レイアウトが決まる前に測ると必ず読み違える。 */
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
   /* **初めて組み換えに入った時点で、今の見え方を置き場所として書き下ろす**
      （§9.221 ⑨）。書き下ろすと`rpStage`が描き直すので、そのときは測り直しを
      そちらへ任せる（ここで続けると、消えた要素を測ることになる）。 */
   if(rpSeedPositions(host))return;
   rpMarkOverflow(host);
  }));
  /* 塊と塊のあいだ・紙の余白へ落としたら**末尾へ**。落とせる場所を
     「塊の上だけ」に絞ると、掴んだまま行き場を探すことになる。 */
  const grid=host.querySelector('.rp-blocks');
  if(grid&&!grid.dataset.wired){
   grid.dataset.wired='1';
   /* **落ちる先はカーソルのマス**（§9.221 ⑨）。塊の上でも紙の余白でも
      同じ規則にする——「塊の上なら並べ替え／余白なら末尾」と分けると、
      同じ操作の結果が場所で変わる。 */
   grid.addEventListener('dragover',ev=>{
    if(!rpDragKey)return;
    ev.preventDefault();
    rpShowGhostAt(grid,rpCellAt(grid,ev.clientX,ev.clientY));
   });
   grid.addEventListener('drop',ev=>{
    if(!rpDragKey)return;
    ev.preventDefault();
    rpDropCell(grid,rpCellAt(grid,ev.clientX,ev.clientY));
   });
  }
  host.querySelectorAll('[data-rp-block]').forEach(el=>{
   const k=el.dataset.rpBlock;
   /* **塊の中に操作の道具は無い**（§9.226 ③）。幅・分解・落とす列・
      出す/出さないは、ダブルクリックで開く窓が持つ——ここに残すと入口が
      2つになり、片方だけ直した状態が作れる。 */
   /* 並べ替え。落とす位置を線で見せてから離せるようにする（一覧の見出しの
      D&Dと同じ作法）。並びは**全ブロック**で保存する——見えているものだけ
      にすると、隠した塊の位置が失われる。 */
   /* **ダブルクリックで大きく開く**（§9.174、利用者の指示）。狭い操作帯で
      高さ・列幅・行列まで触らせると、押し間違いと読み違いが増える。
      よく使う「幅・隠す・分解」だけ帯に残し、残りは開いた先で決める。 */
   /* **ダブルクリックは帳票ブロックマスタへ**（§9.274、利用者の指示
      「今のモーダルでできることは少ないのでマスタに繋いできちんと修正
       できるようにしたい」）。塊そのもの（名前・載せる項目・書式・既定の
      幅と高さ）を直せるのはあちらだけ。
      **この紙だけの見え方**（この設備での幅・高さ・列幅・行列入れ替え）は
      あちらが持てないので、左上の「この紙での見え方」から今までどおり開く
      ——入口を消さない（§4）。 */
   el.addEventListener('dblclick',ev=>{
    if(ev.target.closest('button'))return;
    ev.preventDefault();rpOpenBlockMaster(k);
   });
   const pb=el.querySelector('[data-rp-paper]');
   if(pb)pb.onclick=ev=>{ev.preventDefault();ev.stopPropagation();openBlockEditor(k)};
   rpBindSizeGrips(el,k);
   el.addEventListener('dragstart',ev=>{
    rpDragKey=k;rpDragFrom='sheet';el.classList.add('is-dragging');
    /* **掴んだところを覚える**（§9.222 ②）。覚えないと、塊の右下を掴んだ
       ときに左上がカーソルへ吸い寄せられ、掴んだぶんだけ飛ぶ。 */
    rpSetGrab(el.parentElement,el,ev.clientX,ev.clientY);
    el.parentElement&&el.parentElement.classList.add('is-dropping');
    try{ev.dataTransfer.setData('text/plain',k);ev.dataTransfer.effectAllowed='move'}catch(_){WL.quiet.note('掴んだ印を渡せない（押す道は残る）',_)}
   });
   el.addEventListener('dragend',rpEndDrag);
   /* 塊の上でも**マスの規則は同じ**（§9.221 ⑨）。器の`dragover`／`drop`が
      拾うので、ここでは何もしない——2通りの落とし方を持つと、同じ場所へ
      落としても結果が変わる。 */
  });
 }
 /* ---------- 縁を引いて大きさを変える（§9.218 ⑥、利用者の指示） ----------
    「選択したときに縦横のサイズ変更ができるように」。マスと行にきっちり
    吸い付かせ、**引いている最中に何マス×何行になるかを出す**——離してから
    数えるのでは、狙った大きさに一度で決められない。
    **掴んだ縁は`draggable`を止めること**——止めないと塊ごとのD&D（並べ替え）
    が同時に始まり、引いたつもりが場所の入れ替えになる。 */
 function rpBindSizeGrips(el,k){
  el.querySelectorAll('[data-rp-grip]').forEach(g=>{
   g.addEventListener('pointerdown',ev=>{
    ev.preventDefault();ev.stopPropagation();
    const grid=el.parentElement;if(!grid)return;
    /* 綴りは方角（`t`上／`b`下／`l`左／`r`右と四隅）。文字が重ならないので
       含まれるかで見る——**向きの表を2つ持たない**（§9.163）。 */
    const kind=String(g.dataset.rpGrip||'');
    const north=kind.includes('t'),south=kind.includes('b');
    const west=kind.includes('l'),east=kind.includes('r');
    const wide=west||east,tall=north||south;
    const cols=rpGrid(),cap=rpRowCap();
    /* **拡大前の座標で数える**（§9.222 ②）。`getBoundingClientRect()`は
       拡大後、`gap`／`gridAutoRows`は拡大前なので、混ぜると引くほどずれる。 */
    const L=rpLocal(grid,0,0);
    const gapX=L.gapX,gapY=L.gapY,colW=L.colW,rowPx=L.rowPx,sc=L.sc;
    const gr=grid.getBoundingClientRect();
    const brRaw=el.getBoundingClientRect();
    const br={left:(brRaw.left-gr.left)/sc,top:(brRaw.top-gr.top)/sc,
              height:brRaw.height/sc};
    const px=e=>({x:(e.clientX-gr.left)/sc,y:(e.clientY-gr.top)/sc});
    /* **置き場所が決まっている塊は、その位置に留めたまま大きさだけ変える**
       （§9.221 ⑨）。`span`だけを書き換えると自動配置へ戻ってしまい、
       引いた瞬間に別の場所へ飛ぶ。 */
    const at=rpSpotOf(k);
    const used=rpOccupied(k);
    /* 掴んでいない側の辺は**釘で留める**（§9.283）。左を引けば右端が、
       上を引けば下端が動かないのが「辺を掴んでいる」ということ。 */
    const b0={col:at?at.col:1,row:at?at.row:1,
              span:Math.max(1,(at&&at.span)||rpSpan(k)),
              rows:Math.max(1,(at&&at.rows)||rpRows(k)
                    ||Math.round((br.height+gapY)/(rowPx+gapY)))};
    const rightEdge=b0.col+b0.span-1, bottomEdge=b0.row+b0.rows-1;
    let col=b0.col,row=b0.row,span=b0.span,rows=b0.rows;
    /* いま重なっているか。**縮めずに言う**ので、言うための控えだけ持つ。 */
    let over=false;
    el.setAttribute('draggable','false');
    const tip=document.createElement('div');
    tip.className='rp-size-tip';document.body.appendChild(tip);
    const show=(x,y)=>{
     /* **動いた側は位置も出す**（§6。数字が無いと、辺が動いたのか塊ごと
        動いたのかが読めない）。 */
     tip.textContent=`${span}/${cols}マス × ${rows}行`
      +(at&&(col!==b0.col||row!==b0.row)?`（${col}列目・${row}行目）`:'')
      +(over?'　ほかの塊と重なります':'');
     tip.style.left=(x+14)+'px';tip.style.top=(y+14)+'px';
    };
    const move=e=>{
     const q=px(e);
     /* **行の数え方は`rpRowAtGridM()`の1箇所**（§9.282）。ページに割ると
        紙と紙のあいだに余白が入るので、見た目の差を行の高さで割ると
        **紙をまたいで引いたときだけ1行ぶん多く数える**。物差しはそのつど
        測る（§9.283）——控えると帯や段数が変わった瞬間に古くなる。 */
     const m=rpPageMetrics();
     const cc=Math.max(1,Math.min(cols,Math.floor(q.x/(colW+gapX))+1));
     const rr=Math.max(1,Math.min(cap,rpRowAtGridM(m,q.y)+1));
     if(east){col=b0.col;span=Math.max(1,Math.min(cols-col+1,cc-col+1))}
     else if(west){
      if(at){col=Math.max(1,Math.min(rightEdge,cc));span=rightEdge-col+1}
      /* 置き場所を持たない塊は左へ広げられない（動かす先が無い）。 */
      else span=Math.max(1,Math.min(cols,rightEdge-Math.max(1,Math.min(rightEdge,cc))+1));
     }
     if(south){row=b0.row;rows=Math.max(1,Math.min(cap-row+1,rr-row+1))}
     else if(north){
      if(at){row=Math.max(1,Math.min(bottomEdge,rr));rows=bottomEdge-row+1}
      else rows=Math.max(1,bottomEdge-Math.max(1,Math.min(bottomEdge,rr))+1);
     }
     /* ---------- 重なっても縮めない（§9.310、§9.223 ③の利用者の指示） ----------
        「重なっても配置でき、重なった部分を強調表示など視覚表示で修正を
          うながす」。以前はここで**入るところまで戻して**おり、
        **既に重なっている塊の縁を掴んだ瞬間に、1px動かしただけでめちゃくちゃ
        縮んだ**（利用者の報告）——掴んだ時点で`rpFits()`が偽なので、戻し
        （`back()`）が最初の一手から全力で走る。しかもどこへ戻しても入らない
        配置では**幅も高さも1マス**まで潰れる。
        `rpApplySpan()`（幅のボタン）と`rpDropCell()`（落とす）は既に
        「重なることは**言う**だけ」で揃っているのに、縁だけが黙って直す側に
        残っていた（§9.163。同じ問いに2つ目の答えを持っていた）。
        紙の外へは出さない（物理的な限界）——それは上の`Math.min`が受ける。
        §9.283の「戻し方を2通り試して広いほうを採る」は、戻しそのものを
        廃したので要らない。 */
     over=!!at&&!rpFits(col,row,span,rows,used);
     if(at){
      el.style.gridColumn=col+'/span '+span;
      el.style.gridRow=row+'/span '+rows;
     }else{
      el.style.gridColumn='span '+span;
      el.style.gridRowEnd='span '+rows;
     }
     el.style.minHeight='';
     show(e.clientX,e.clientY);
    };
    const up=()=>{
     window.removeEventListener('pointermove',move);
     window.removeEventListener('pointerup',up);
     tip.remove();
     el.removeAttribute('draggable');
     const wid={...rpLayoutNow().widths};
     if(wide)wid[k]=rpSpanStore(rpSpanFromGrid(span));
     if(tall){
      /* 旧いpxの高さは**捨てる**（§9.217）——両方残すと「どちらが効いて
         いるのか」が決まらない。行数を触った時点でそちらが正。 */
      delete wid[rpHeightKey(k)];
      wid[rpRowsKey(k)]=rpRowsStore(rpRowsFromGrid(rows));
     }
     /* **左・上を引くと置き場所も動く**（§9.283）。書き忘れると、離した
        瞬間に元の位置へ戻り「幅だけ増えて反対側へ伸びた」ように見える。 */
     if(at&&west&&col!==b0.col)wid[rpColKey(k)]=rpColStore(rpColToBase(col));
     if(at&&north&&row!==b0.row)wid[rpRowPosKey(k)]=rpRowStore(rpRowToBase(row));
     /* **重なったことは必ず言う**（§3・§9.223 ③）。縮めなくなったぶん、
        言わないと「はみ出したまま気づかない」になる。種類は`overlap`で、
        `rpApplySpan()`／`rpDropCell()`と同じ場所に同じ言い方で出す。 */
     rpSay(over?'ほかの塊と重ねました（重なったマスを赤い網で出しています）。そのままでも保存できますが、刷ると重なって出ます。':'',
           over,'overlap');
     rpStage({widths:wid});
    };
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',up);
    show(ev.clientX,ev.clientY);
   });
  });
 }
 /* ---------- マスへ落とす（§9.221 ⑨・§9.223 ③） ----------
    **位置・大きさ・「出す/出さない」を1回で書く**——別々に保存すると、
    途中で切れたときに片方だけ効いた状態が残る（§9.217と同じ約束）。
    **埋まっているマスでも置ける**（§9.223 ③、利用者の指示「重なっても
    配置でき、重なった部分を強調表示など視覚表示で修正をうながす」）。
    断ると、詰めたい場所へ一度も置けないまま「空くまで別の塊を先に動かす」
    という手順を強いることになる——置かせてから、**重なっていることを
    その場に出す**（縁・チップ・重なったマスの網掛け）。 */
 function rpDropCell(grid,cell){
  const key=rpDragKey,from=rpDragFrom;
  if(!key||!cell){rpEndDrag();return}
  const cols=rpGrid();
  const span=Math.min(rpSpan(key),cols),rows=rpGhostRows(key);
  const col=Math.max(1,Math.min(cols-span+1,cell.col));
  const row=Math.max(1,cell.row);
  const over=!rpFits(col,row,span,rows,rpOccupied(key));
  rpEndDrag();
  rpSay(over?'ほかの塊と重ねて置きました（重なったマスを赤い網で出しています）。そのままでも保存できますが、刷ると重なって出ます。':'',over,'overlap');
  const wid={...rpLayoutNow().widths};
  wid[rpColKey(key)]=rpColStore(rpColToBase(col));
  wid[rpRowPosKey(key)]=rpRowStore(rpRowToBase(row));
  /* 高さは触らない。**落とすのは場所を決める操作**なので、ここで行数を
     書くと置き場から出した塊が`rpGhostRows()`の当て推量（2行）で凍る。 */
  const patch={widths:wid};
  if(from==='palette'){
   const set=new Set(rpHiddenSet());set.delete(key);patch.hidden=[...set];
   /* 並びにも載せる（並びは「紙に出る順」＝印刷の読み順として残る）。 */
   const order=rpBlockKeys();
   if(order.indexOf(key)<0)order.push(key);
   patch.order=order;
  }
  rpStage(patch);
 }
 /* 落とす。**並びと「出す/出さない」を1回で決める**（§9.217）——パレット
    から落としたときに「並べ替え」と「出す」を別々に保存すると、途中で
    切れた場合に片方だけ効いた状態が残る。 */
 function rpDropAt(refKey,after){
  const key=rpDragKey,from=rpDragFrom;
  if(!key)return;
  const order=rpBlockKeys(),i=order.indexOf(key);
  if(i>=0)order.splice(i,1);
  let at=refKey?order.indexOf(refKey):-1;
  if(at<0)at=order.length-(after?0:0);
  order.splice(refKey?(after?at+1:at):order.length,0,key);
  const patch={order};
  if(from==='palette'){
   const set=new Set(rpHiddenSet());set.delete(key);patch.hidden=[...set];
  }
  rpEndDrag();
  rpStage(patch);
  updateArrangeBar();
 }
 /* ---------- 出していない塊の置き場（§9.217／§9.276 ①、利用者の指示） ----------
    「これら帳票の項目は、規格化してブロック(カード)サイズとイメージと共に
     一覧で管理し、帳票内に表示させるときに項目からD&Dで表示…D&Dで非表示
     などできるようにしてください。」
    「帳票ブロックは上部ではなく左サイドバーに変更し、説明文はポップオーバー
     など場所を取らない方法にしてください」

    **紙の外に置く**——紙の中へ入れると刷り上がりに混ざる。
    §9.276 ①で置き場を**左サイドバー（`.rp-nav`）へ移し、縦に積む**:
      ・上の帯だと塊が増えるほど横スクロールになり、名前は省略記号で切れる
      ・そのぶん紙の高さを削っていた（紙が主役の画面で面積の配り方が逆）
    **説明はポップオーバーへ**（`?`）——常時1行を占めていた案内は、
    押したときだけ出せば足りる。**消さない**（§9.234 ①・§9.255 ①）——
    「押すだけでも出せる」は札の形からは読めず、掴めない環境の唯一の道。 */
 function renderPalette(){
  const el=$id('rpPalette');if(!el)return;
  el.hidden=!rpArranging||rpPaperView;
  if(el.hidden){el.innerHTML='';rpClosePaletteHelp();return}
  const hidden=rpHiddenSet();
  const items=rpBlockKeys().filter(k=>hidden.has(k));
  el.innerHTML=`<div class="rp-palette-head">`
   +`<b>出していない塊 <i>${items.length}</i></b>`
   +`<button type="button" class="rp-palette-help" data-rp-pal-help`
     +` aria-haspopup="true" aria-expanded="false" aria-label="置き場の使い方">?</button>`
   +`</div>`
   +(items.length
     ?`<div class="rp-palette-list">`+items.map(k=>{
        const r=rpRows(k);
        return `<button type="button" class="rp-palette-item" draggable="true" data-rp-pal="${esc(k)}"`
         +` title="${esc(rpBlockLabel(k))}／幅 ${rpSpan(k)}/${rpGrid()}マス・高さ ${r?r+'行':'中身なり'}`
         +`／掴んで紙へ落とすと出ます（押すだけでも出せます）">`
         +`<span class="rp-palette-name">${esc(rpBlockLabel(k))}</span>`
         /* **単位を落とさない**（§CLAUDE 6）——`6×20`では「6行×20列」とも
            「6mm」とも読める。詰めてよいのは言い回しで、単位はその対象外。 */
         +`<span class="rp-palette-size">${rpSpan(k)}マス×${r?r+'行':'自動'}</span></button>`;
       }).join('')+`</div>`
     :`<div class="rp-palette-list is-empty">全部の塊を紙に出しています。</div>`)
   /* 直前の一言（入りきらない・置けない）は**見えるところ**へ（§9.222 ④）。
      `rpPaintNote()`がここへ書き足す。 */
   +`<span class="rp-arrange-note" id="rpArrangeNote"${rpHelpOpen?'':' hidden'}>`
     +`掴んで<b>置きたいマスへ</b>。<b>縁を引く</b>と大きさ（右＝幅・下＝高さ・右下＝両方）。`
     +`<b>ダブルクリック</b>で<b>帳票ブロックマスタ</b>の編集画面が開きます。`
     +`大きさを変えても<b>場所は動きません</b>。`
   +`</span>`;
  bindPalette();
  rpPaintNote();
 }
 /* 使い方の浮き出し（§9.276 ①）。**器は`body`直下**——`.rp-nav`は
    `overflow`を持つので、中で開くと切られる（§9.201）。**開いた器は必ず
    控える**（§9.222 ①。控えないと外クリックでもEscでも閉じられない）。 */
 let rpPalHelpEl=null;
 function rpClosePaletteHelp(){
  if(rpPalHelpEl){rpPalHelpEl.remove();rpPalHelpEl=null}
  document.removeEventListener('mousedown',rpPalHelpOutside,true);
  document.removeEventListener('keydown',rpPalHelpKey,true);
  const b=document.querySelector('[data-rp-pal-help]');
  if(b)b.setAttribute('aria-expanded','false');
 }
 function rpPalHelpOutside(e){
  if(rpPalHelpEl&&!rpPalHelpEl.contains(e.target)&&!e.target.closest('[data-rp-pal-help]'))
   rpClosePaletteHelp();
 }
 function rpPalHelpKey(e){
  if(typeof WL.base.escClosesModal==='function'?WL.base.escClosesModal(e):e.key==='Escape')rpClosePaletteHelp();
 }
 function rpOpenPaletteHelp(anchor){
  rpClosePaletteHelp();
  const d=document.createElement('div');
  d.className='rp-pal-help';d.id='rpPaletteHelp';
  d.innerHTML=`<b>置き場の使い方</b>`
   +`<ul><li>掴んで<b>紙へ落とす</b>と出ます（落ちる場所は枠で見えます）</li>`
   +`<li><b>押すだけでも出せます</b>（掴めない環境でも行き止まりにしないため）</li>`
   +`<li>紙の塊を<b>ここへ落とす</b>と外れます</li></ul>`;
  document.body.appendChild(d);
  rpPalHelpEl=d;
  const r=anchor.getBoundingClientRect();
  d.style.left=Math.round(Math.min(r.left,window.innerWidth-d.offsetWidth-8))+'px';
  d.style.top=Math.round(Math.min(r.bottom+6,window.innerHeight-d.offsetHeight-8))+'px';
  anchor.setAttribute('aria-expanded','true');
  requestAnimationFrame(()=>{
   document.addEventListener('mousedown',rpPalHelpOutside,true);
   document.addEventListener('keydown',rpPalHelpKey,true);
  });
 }
 function bindPalette(){
  const el=$id('rpPalette');if(!el)return;
  const help=el.querySelector('[data-rp-pal-help]');
  if(help)help.onclick=()=>{if(rpPalHelpEl)rpClosePaletteHelp();else rpOpenPaletteHelp(help)};
  el.querySelectorAll('[data-rp-pal]').forEach(b=>{
   const k=b.dataset.rpPal;
   b.addEventListener('dragstart',ev=>{
    rpDragKey=k;rpDragFrom='palette';b.classList.add('is-dragging');
    rpDragGrab={dc:0,dr:0};      /* 置き場から掴んだときは左上がカーソル */
    document.querySelectorAll('.rp-blocks').forEach(x=>x.classList.add('is-dropping'));
    try{ev.dataTransfer.setData('text/plain',k);ev.dataTransfer.effectAllowed='move'}catch(_){WL.quiet.note('掴んだ印を渡せない（押す道は残る）',_)}
   });
   b.addEventListener('dragend',rpEndDrag);
   /* **押すだけでも出せる**（§4）。掴めない環境・タッチでも行き止まりに
      しない。位置は末尾で、あとから掴んで動かせる。 */
   b.onclick=()=>{
    /* **出す・出さないは`rpShowBlock()`の1つを通す**（§9.274）。ここだけが
       自前で`hidden`と`order`を書いていたので、あちらが持っている決まり
       （並びにも載せる・§9.217／旧い印を捨てる・§9.319-C）が効かなかった
       ——**置き場から押して出した塊だけ、次に読むとまた隠れる**。 */
    rpShowBlock(k,true);updateArrangeBar();
   };
  });
  if(el.dataset.wired)return;
  el.dataset.wired='1';
  el.addEventListener('dragover',ev=>{
   if(rpDragFrom!=='sheet')return;
   ev.preventDefault();el.classList.add('is-target');
  });
  el.addEventListener('dragleave',()=>el.classList.remove('is-target'));
  el.addEventListener('drop',ev=>{
   if(rpDragFrom!=='sheet'||!rpDragKey)return;
   ev.preventDefault();
   const set=new Set(rpHiddenSet());set.add(rpDragKey);
   rpEndDrag();
   rpStage({hidden:[...set]});updateArrangeBar();
  });
 }
 /* 単一プレビューへの書き込み。組み換え中はその状態のまま描き直す。 */
 /* ロットを開いたら、その設備ぶんの設定を読んでから描き直す。**読まずに
    描くと既定の形が一瞬出てから入れ替わる**（設備を切り替えるたびにちらつく）。 */
 /* 組み換え中でなくても行の割り付けは要る（紙がそれで組まれる）。
    描いたあとに1回だけ測る。 */
 /* 1枚ぶんの割り付け。**設備を差し替えて呼べるように切り出してある**
    （§9.239 ③）——`rpFitAll()`は今までどおり画面ぶんをまとめて回す。 */
 function rpFitPage(h){
  try{rpApplyPaperPack()}catch(e){WL.quiet.note('紙の余白を当て直せない（前の余白で測る）',e)}
  try{rpFitRows(h)}catch(e){console.warn('帳票の行の割り付けに失敗',e)}
  try{rpFitBlockBodies(h)}catch(e){console.warn('帳票の中身の合わせ込みに失敗',e)}
  try{rpFreeCells(h)}catch(e){console.warn('帳票の空きマスの計算に失敗',e)}
 }
 function rpFitAll(){
  /* **紙の余白は行を測る前に与える**（§9.308）——あとから与えると、
     `rpFitRows()`が詰める前の中身で行数を数えてしまい、詰めたぶんが
     そのまま空きになる（詰めたのに紙が縮まない、という見え方）。 */
  try{rpApplyPaperPack()}catch(e){WL.quiet.note('紙の余白を当て直せない（前の余白で測る）',e)}
  /* **測る前に片付ける**（§9.281 の追補。理由は`rpMarkOverflow`と同じ）。 */
  rpClearSheets($id('reportContent'));
  document.querySelectorAll('#reportContent,#reportBulkPrintArea .rp-page').forEach(h=>{
   try{rpFitRows(h)}catch(e){console.warn('帳票の行の割り付けに失敗',e)}
   /* **紙にも中身の合わせ込みが要る**（§9.221 ⑨）。器は`overflow:hidden`で
      大きさを守るので、ここを組み換え中だけにすると**刷った紙で中身が
      切れる**（画面では入って見えるのに、というのがいちばん悪い）。 */
   try{rpFitBlockBodies(h)}catch(e){console.warn('帳票の中身の合わせ込みに失敗',e)}
   /* **行を測り直したら空きも引き直す**（§9.218 ⑥）——塊の高さが変われば
      空いているマスも変わるので、忘れると前の形の空きが残る。 */
   try{rpFreeCells(h)}catch(e){console.warn('帳票の空きマスの計算に失敗',e)}
  });
  /* **切れ目は組み換え中でなくても描く**（§9.281）——ふだん見ているのは
     ただのプレビューなので、ここで描かないと「どこで紙が変わるか」は
     組み換えに入らないと分からない。刷る側（`#reportBulkPrintArea`）には
     描かない（紙に線が出る）。 */
  try{rpUpdateSheets()}catch(e){console.warn('用紙の切れ目の計算に失敗',e)}
  /* **高さが決まってから倍率を合わせ直す**（§9.281 の追補）。`fitPage()`は
     描いた直後＝**行の割り付けもページ割りも済む前**に測るので、
     「全体」が1枚目しか映さないことがあった（実測 85% → 押し直すと42%）。
     **変わったときだけ**合わせ直す（毎回だとちらつく）。倍率は`transform`
     なので`offsetHeight`は動かず、ここが回り続けることはない。 */
  try{rpRefitZoom()}catch(e){WL.quiet.note('倍率を合わせ直せない（前の倍率のまま）',e)}
 }
 let rpFitHeight=0;
 function rpRefitZoom(){
  const page=$id('reportContent');if(!page)return;
  const h=page.offsetHeight;
  if(!h||h===rpFitHeight)return;
  rpFitHeight=h;
  if(rpZoom==='fit')fitPage();else if(rpZoom==='width')fitWidth();
 }
 function rpLoadLayoutFor(x){
  const t=rpTargetOf(x),eq=rpEquipmentOf(x)||'';
  /* 設定と**自作の塊**を両方読んでから描き直す（§9.217）。塊だけ先に
     届くと、まだ並びを知らない状態で末尾へ並べてしまう。 */
  Promise.all([WL.columnLayout.load(t).catch(WL.quiet('列の設定を取れない（既定の並びで出す）')),rpLoadUserBlocks(eq)])
   .then(()=>{if(rpCurrentLot()&&rpTargetOf(rpCurrentLot())===t)rpRepaint()})
   .catch(WL.quiet('配置と自作の塊を取れない（既定の並びで出す）'));
 }
 /* 長手方向の候補に要るロールを先に読む。**この関数だけが取りに行く**
    （紙を描く側は控えを見るだけ・§9.163）。 */
 function rpWarmRolls(x){
  const d=window.WL&&WL.defect;
  if(!d||!d.ensureRolls||!d.hasRoll||!d.hasRoll(x))return;
  const eq=d.rollEquipmentOf?d.rollEquipmentOf(x):'';
  const id=x&&x.id;
  d.ensureRolls(eq).then(got=>{
   if(got&&rpState.selectedId===id&&rpState.items.some(i=>i.id===id))selectLot(id);
  }).catch(WL.quiet('ロールを先に読めない（長手の候補が出ないだけ）'));
 }
 function renderReport(x){
  rpLoadLayoutFor(x);                /* その設備ぶんの設定を読む（届いたら描き直す） */
  $id('reportContent').innerHTML=reportHtml(x,rpArranging);
  if(rpArranging)bindArrangeHandlers();
  /* **行の割り付けは組み換え中でなくても要る**（紙がそれで組まれる）。
     描いてから測る——中身の量はロットで変わるので決め打ちにできない。 */
  rpAfterPaint();
 }

 function selectLot(id){
  rpState.selectedId=id;renderLotList();
  const x=rpState.items.find(i=>i.id===id);if(!x)return;
  /* バーは1層に詰めているため、左の一覧で選択中が分かることを前提に短く出す。 */
  $id('reportSelectedTitle').textContent=[x.basic?.lotNo||x.id,x.basic?.inspectionNo,WL.base.statusLabel(x.status)].filter(Boolean).join(' / ');
  $id('reportPrint').disabled=false;$id('reportPdf').disabled=false;
  renderReport(x);
  fitPage();fitWidth();
  renderSplitHint(x);
  /* 長手方向の候補は**ロールマスタから引く**（§9.305 ②-2）。紙は同期で
     描くので、控えが無ければ**取りに行って、取れたら描き直す**（§9.278の
     見本と同じ作法）。**取れたときだけ描き直す**——毎回描き直すと止まらない。
     失敗は黙って捨てる（候補が出ないだけで、幅方向の判定は紙に出る）。 */
  rpWarmRolls(x);
  /* 見本の帯（§9.253）。**選び直したら必ず消す**——実データを開いたのに
     「見本です」と出たままだと、本物を見本と読み違える。 */
  renderSampleBar(x);
 }
 /* ---------- 子ロットの統計を先回りして知らせる（§9.248 ②） ----------
    既定（`rpInitialHidden`）は**一度も配置を触っていない設備**にしか効かない。
    既に配置を保存してある設備では「測定値の統計」が`hidden`に焼き付いて
    いるので、子ロットが複数あるロットを開いても紙は増えない。
    **そのことを画面で言い、出す手立てを同じ場所に置く**（§2「探させない」・
    §4「できることを書く」）——紙に注意書きを刷るのではなく、画面で伝える。 */
 function renderSplitHint(x){
  const bar=document.querySelector('#reportPanel .rp-bar-title');
  let el=$id('rpSplitHint');
  const lots=rpHasSplitLots(x)?(rpStat(x).byLot||[]):[];
  const hidden=lots.length&&rpHiddenSet().has(RP_STAT_BLOCK);
  if(!hidden){if(el)el.remove();return}
  if(!el){
   el=document.createElement('button');
   el.type='button';el.id='rpSplitHint';el.className='rp-split-hint';
   if(bar&&bar.parentNode)bar.parentNode.insertBefore(el,bar.nextSibling);
  }
  el.innerHTML=`子ロット${lots.length}件 <b>統計を出す</b>`;
  el.title=`このロットは幅分割されていて、子ロット番号が${lots.length}件あります`
   +`（${lots.map(L=>L.lot||'(番号なし)').join('・')}）。`
   +'押すと「測定値の統計」の塊を紙に出します——子ロットごとの板幅MIN/MAXなどが、'
   +'その子ロットの条だけから数え直されて並びます。';
  el.onclick=async()=>{
   /* **出すのは1つだけ**——他の塊の設定は触らない（§9.212 ②）。 */
   const t=rpTargetOf(x);
   const cur=WL.columnLayout.saved(t);
   const order=(cur.order||[]).length?cur.order:rpBlockKeys();
   const hide=(cur.order||[]).length?(cur.hidden||[]):rpInitialHidden();
   try{
    await WL.columnLayout.patch(t,{order:[...order],
      hidden:hide.filter(k=>k!==RP_STAT_BLOCK)});
    renderReport(x);fitPage();fitWidth();renderSplitHint(x);
    showToast&&showToast('「測定値の統計」を紙に出しました',
      '子ロットごとのMIN/MAXが並びます。戻すときは「配置を組み換え」から外せます',4000);
   }catch(e){showToast&&showToast('設定を保存できませんでした',e.message,5000)}
  };
 }

/* ==================================================================
   刷るのは「帳票だけの1枚もの」（§9.244、利用者の指示）
   ------------------------------------------------------------------
   利用者の報告:
     「アプリ内の印刷プレビューと、実際の印刷直前のWINDOWSのプレビューに
      違いが出ています。…用紙を最大活かせておらず、用紙に対して80％くらいの
      比率と共に表示内容のクオリティも下がっているように見えます」
     「このままうまくいかないようであれば、印刷ボタンの挙動を変更し、
      印刷をWINDOWS介さず…独自モーダルから出力する方法でもよいです」

   §9.243で`@page`の余白を1つにそろえたが、それでも縮んだ。**こちらの
   割り付けは正しい**——`page.pdf({preferCSSPageSize:true})`で確かめると
   1ページ・`MediaBox`はぴったりA4（`tests/test_rpprint.js`が固定）。
   残る差は**アプリの画面ごと刷っている**ことから来る:

     刷っている書類 ＝ SPA全体（`.layout`／`main`／`.rp-scroll`…）で、
     帳票以外は`display:none`で伏せているだけ。

   伏せた要素も**器の幅・`min-width`・`--ui-scale`・スクロール器**として
   版面の組み立てに関わり得るし、`@media print`の規則が1つ増えるたびに
   「刷るときだけ効く」経路が増える。**紙に出したいものだけの書類を作って
   それを刷る**のがいちばん短い道で、利用者の言う「独自の出力」でもある。

   同じ生成元の`<iframe>`へ、帳票のCSSと**測り終わった`.rp-page`のDOM**を
   そのまま書き出して`print()`する。倍率（`--rp-fit`）はインラインで付いて
   いるので**プレビューで見たものが1対1で出る**。
   **`--rp-scale`（画面の拡大縮小）は等倍へ戻すこと**——あれは画面で見る
   ためだけの倍率で、紙には関係が無い。

   **窓（`window.open`）ではなく`<iframe>`**にしてある——ポップアップの
   ブロックに掛からず、閉じ忘れも起きない。
   **失敗したら今までどおり`window.print()`へ落とす**（刷れないより、
   今までの形でも刷れるほうがよい）。理由はトーストで言う（§4）。
   ================================================================== */
 function rpPrintCssHref(){
  /* 画面が読んでいるものと**同じ束**を読む（写しを作らない。版が変われば
     `?t=`も変わるので、古いCSSで刷ることがない）。 */
  return [...document.querySelectorAll('link[rel="stylesheet"]')]
    .map(l=>l.getAttribute('href')).filter(Boolean);
 }
 function rpPrintDocHtml(pagesHtml,title){
  const de=document.documentElement;
  /* 表示サイズ・テーマは**プレビューと同じものを持ち込む**——`--ui-scale`は
     プレビューにも効いており、`--rp-fit`はその状態で測った値。片方だけ
     変えると測った倍率と食い違う。 */
  const attrs=['data-ui-size','data-theme']
    .map(k=>de.getAttribute(k)?` ${k}="${esc(de.getAttribute(k))}"`:'').join('');
  const links=rpPrintCssHref().map(h=>`<link rel="stylesheet" href="${esc(h)}">`).join('');
  const land=rpOrientation==='landscape';
  return `<!doctype html><html lang="ja"${attrs}><head><meta charset="utf-8">`
   +`<title>${esc(title)}</title>${links}<style>`
   +WL.paper.pageRule('a4-'+(land?'landscape':'portrait'),null,RP_PAGE_MARGIN)
   +`html,body{margin:0;padding:0;background:#fff;--rp-scale:1}`
   +`.rp-page{width:210mm;min-height:297mm;margin:0;padding:8mm;`
   +`box-sizing:border-box;box-shadow:none;transform:none;background:#fff}`
   +`.rp-page.rp-landscape{width:297mm;min-height:210mm}`
   +`.rp-page+.rp-page{page-break-before:always}`
   /* 組み換え中の道具は紙に出さない（画面だけの道具）。 */
   +`.rp-block-tools,.rp-block-paper,.rp-free-layer,.rp-bar,.rp-nav{display:none!important}`
   +`</style></head><body class="rp-print-doc">${pagesHtml}</body></html>`;
 }
 /* 刷り終わる（またはやめる）まで待って片付ける。**`afterprint`だけに
    頼らないこと**——出ない環境があるので、時間でも必ず片付ける。 */
 function rpPrintFrame(pagesHtml,title){
  return new Promise((resolve,reject)=>{
   let f=$id('rpPrintFrame');
   if(f)f.remove();
   f=document.createElement('iframe');
   f.id='rpPrintFrame';f.className='rp-print-frame';f.setAttribute('aria-hidden','true');
   /* **器の幅は紙の幅にそろえる**——刷る前の組み立てもこの幅で解かれるので、
      紙より広い器で組むと`width:100%`のものだけが別の幅で決まる。 */
   f.style.width=(rpOrientation==='landscape'?'297mm':'210mm');
   f.style.height=(rpOrientation==='landscape'?'210mm':'297mm');
   document.body.appendChild(f);
   let done=false;
   const finish=ok=>{
    if(done)return;done=true;
    setTimeout(()=>{try{f.remove()}catch(e){WL.quiet.note('刷り終えた器を片付けられない（画面の外なので見えない）',e)}},400);
    ok?resolve():reject(new Error('印刷の書類を組み立てられませんでした'));
   };
   /* **刷るのは1回だけ**（§9.247 ③、利用者の報告「印刷ボタンを押すと…
      キャンセルボタンを押すと、もう一度同じプレビューが出てくる」）。
      書類の用意ができた合図は**2つある**——`<iframe>`の`load`と、書き込んだ
      `<link>`の読み込み数え（`document.write`では`load`が飛ばないことが
      あるので、片方だけでは足りない）。どちらも`go()`へ入るので、
      **多重防止が無いと`w.print()`が2回走る**。`finish()`の`done`では
      止められない——`print()`は`finish()`より前に呼ばれるので、
      2回目は「ダイアログを開いてから何もしない」形になる。
      実機では1回目のダイアログが閉じるまでJSが止まるため、
      **キャンセルした直後に2枚目が開く**という見え方になっていた。
      **合図のほうを1つに減らさないこと**——どちらが先に来るかは端末で
      変わるので、早いほうで刷って遅いほうは捨てるのが正しい。 */
   let started=false;
   const go=()=>{
    if(started)return;started=true;
    try{
     const w=f.contentWindow;
     w.addEventListener('afterprint',()=>finish(true));
     /* **描き終わってから刷る**（同期で呼ぶと白紙になる。`bulkPrintNow`と
        同じ理由）。フォントの読み込みも待つ——待たないと字送りが変わる。 */
     const fire=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
      try{w.focus();w.print();finish(true)}catch(e){finish(false)}
     }));
     if(w.document.fonts&&w.document.fonts.ready)w.document.fonts.ready.then(fire,fire);
     else fire();
    }catch(e){finish(false)}
   };
   f.onload=go;
   try{
    const d=f.contentDocument;
    d.open();d.write(rpPrintDocHtml(pagesHtml,title));d.close();
    /* `document.write`では`onload`が飛ばないことがあるので、CSSの読み込みを
       自分で待つ（`<link>`のonloadを数える）。 */
    const links=[...d.querySelectorAll('link[rel="stylesheet"]')];
    if(!links.length){go();return}
    let left=links.length;
    const tick=()=>{if(--left<=0)go()};
    links.forEach(l=>{l.addEventListener('load',tick);l.addEventListener('error',tick)});
    /* **読み込みが返ってこなくても刷れること**が最優先（§CLAUDE 起動の覆いと
       同じ考え方）。3秒で先へ進む。 */
    setTimeout(()=>{if(left>0){left=0;go()}},3000);
   }catch(e){finish(false)}
  });
 }
 /* 紙に出す`.rp-page`のHTMLを、**測り終わった状態のまま**取り出す。 */
 function rpPageHtmlFor(el){
  if(!el)return '';
  const c=el.cloneNode(true);
  /* **画面だけの道具は写しから外す**——`.rp-sheets`は用紙の切れ目の目印
     （§9.281）なので、残すと紙に点線が刷られる。 */
  c.querySelectorAll('.rp-block-tools,.rp-block-paper,.rp-free-layer,.rp-sheets').forEach(x=>x.remove());
  /* 伸ばした紙の高さも持ち込まない（刷る側は`min-height:297mm`で1枚ずつ切る）。 */
  /* ページ割り（伸ばした高さ・余白・塊のずらし）も持ち込まない——刷る側は
     `min-height:297mm`で、あとはブラウザが1枚ずつ切る。 */
  const unpage=x=>{x.classList.remove('rp-paged');
   x.style.removeProperty('--rp-sheets');x.style.removeProperty('--rp-gap')};
  c.querySelectorAll('.rp-page').forEach(unpage);
  if(c.classList&&c.classList.contains('rp-page'))unpage(c);
  c.querySelectorAll('.rp-block[data-rp-shift]').forEach(b=>{
   b.removeAttribute('data-rp-shift');b.removeAttribute('data-rp-clip');
  });
  return c.outerHTML;
 }
 async function rpPrintPages(pagesHtml,title){
  try{
   await rpPrintFrame(pagesHtml,title);
   return true;
  }catch(e){
   /* **黙って落とさない**（§4）——今までの形で刷れることと、なぜそうなったかを言う。
      **`toast` という関数は無い**（`showToast`）。`typeof` で囲ってあったので
      例外にはならず、**断りの一言が一度も出ていなかった**（§9.354）。 */
   showToast('画面ごと印刷します','帳票だけの書類を作れませんでした（'+e.message+'）');
   const prev=document.title;document.title=title;
   window.print();
   setTimeout(()=>{document.title=prev},500);
   return false;
  }
 }
 function printReport(){
  if(!rpState.selectedId)return;
  const x=rpState.items.find(i=>i.id===rpState.selectedId);
  const title=`測定帳票_${x?.basic?.lotNo||x?.id||'lot'}`;
  rpPrintPages(rpPageHtmlFor($id('reportContent')),title);
 }

 /* 帳票は測定画面から開く場合もある。重なって残らないよう#measureModalを
    閉じるのはenterView()の共通処理(測定内容は呼び出し側で保存済み。
    戻る操作で開き直す)。 */
 async function openReportView(){
  WL.enterView('report');
  /* **自作の塊は開くたびに読み直す**（§9.217）。マスタ管理で足した直後に
     帳票を開くのがふつうの順番なので、設備ごとの写しを持ったままだと
     「登録したのに候補に出ない」になる（実際にそうなった）。
     **設備ごとの写し（§9.239 ③）も一緒に捨てること**——片方だけ消しても
     `rpLoadUserBlocks()`がMapから古い顔ぶれを拾ってくる（実際にそうなり、
     `test_rplayout`の「自作の塊が候補に並ぶ」が落ちた）。 */
  rpUserBlocksFor=null;rpBlocksByEq.clear();
  ensurePanel().hidden=false;
  setZoom(rpZoom);
  $id('reportSelectedTitle').textContent='ロットを選択してください';
  $id('reportPrint').disabled=true;$id('reportPdf').disabled=true;
  $id('reportContent').innerHTML='<div class="rp-empty">左の一覧からロットを選ぶと、帳票プレビューがここに表示されます。</div>';
  const listEl=$id('reportLotList');listEl.innerHTML='<div class="rp-empty">読み込んでいます…</div>';
  try{
   /* 閲覧モード・スケジュールモードでは、この端末のIndexedDBではなく
      閲覧用バックアップ(Box等へ複製したrecords.sqlite3)を読む
      (static/js/core/access-mode.js window.loadViewModeRecords)。どちらも
      この端末で測定データを書き込まない点は同じため、editモード以外は
      同じ経路にする(編集モードのみ従来どおりreliableAll())。 */
   const viewMode=window.accessMode&&window.accessMode.mode!=='edit';
   const all=viewMode&&typeof window.loadViewModeRecords==='function'?await window.loadViewModeRecords():await WL.records.reliableAll();
   rpState={items:all,query:'',sort:$id('reportSort')?.value||'updated-desc',selectedId:''};
   const search=$id('reportSearch');if(search)search.value='';
   renderLotList();
  }catch(e){listEl.innerHTML=`<div class="rp-empty">一覧を読み込めませんでした: ${esc(e.message)}</div>`}
 }

 /* 帳票を開いた起点。「戻る」の行き先をここで覚えておく。
    'records' = 編集中/完了データ一覧(従来) / 'measure' = 測定画面。 */
 let rpReturnTo='records';

 /* 編集中/完了データ一覧は統合された1つの一覧のため、帳票から戻る際は
    現在のトグル状態(編集中/完了それぞれのON/OFF)をそのまま維持して
    再度開く(WL.records.openRecordsSafe(null)はopenRecords()側でプリセットを
    上書きせず現在のrecordListState.statusesを引き継ぐ)。 */
 /* サーバー側の測定バックアップから1件だけ取り込む(§9.43)。
    帳票一覧は編集モードならこの端末のIndexedDBを見るが、作業スケジュールが
    出す実績は共有の測定バックアップ(他端末が測った分・PC入替前の分を含む)を
    突合したものなので、IndexedDBに無い記録IDを開こうとすることがある。
    そのままだと帳票が「ロットを選択してください」のまま何も出ず、理由も
    分からない。ここでサーバー側から拾って一覧へ足す。 */
 async function fetchRecordFromBackup(id){
  for(const url of ['/api/measurement/backup/list','/api/measurement/backup/list-view']){
   try{
    const r=await api(url);
    const hit=(r.items||[]).find(it=>String(it.id)===String(id));
    if(!hit)continue;
    const rec=WL.measureView.ensureMeasureShape(JSON.parse(hit.payload));rec.id=hit.id;return rec;
   }catch(e){WL.quiet.note('次の取得先を試す',e)}
  }
  return null;
 }
 const RP_RETURNS=['measure','actuals','blocks','layout'];
 window.openReportForRecord=async function(id,options){
  const opt=options||{};
  /* 戻り先（§9.241 ③で実績データリストが増えた／§9.253で帳票ブロック
     マスタが増えた）。**知らない値はデータ一覧へ落とす**——戻り先が無い
     画面へ戻すと行き止まりになる。 */
  rpReturnTo=RP_RETURNS.indexOf(opt.returnTo)>=0?opt.returnTo:'records';
  await openReportView();           // ここで初めてパネル(戻るボタン)が作られる
  updateBackButton();
  syncArrangeButton();
  if(id&&!rpState.items.some(x=>String(x.id)===String(id))){
   const rec=await fetchRecordFromBackup(id);
   if(rec){rpState.items=[rec,...rpState.items];renderLotList()}
   else{
    $id('reportSelectedTitle').textContent='帳票を表示できません';
    $id('reportContent').innerHTML='<div class="rp-empty">この測定データがこの端末にも測定バックアップにも見つかりませんでした。</div>';
    return;
   }
  }
  selectLot(id);
  /* 印刷は描画後でないと白紙になるため、1フレーム置いてから開く。 */
  if(opt.print)requestAnimationFrame(()=>requestAnimationFrame(printReport));
 };
 /* ---------- 見本のロットで帳票を見る（§9.253、利用者の指示） ----------
    「全入力可能データのダミーデータを1データ、内部に持っておくこととその
     データを活用し帳票のプレビューを帳票ブロックマスタから確認用に実際の
     データを配置した形かつ、現在のレイアウトでのデータを見られる、試し印刷も
     できるようにしてください」

    それまでは**実データが1件も無いと配置を確かめられなかった**。しかも
    確かめるには「データ一覧を開く→ロットを探す→行を開く→帳票」と辿る
    必要があり、マスタを直すたびに毎回それをやることになる。

    **描くのは今までと同じ1本**（`selectLot`→`renderReport`）——見本のための
    別の描き方を持つと、「見本では出るのに実データでは出ない」が作れる
    （§CLAUDE「同じ処理を2つ持たない」）。ここがやるのは
    **レコードを1件、一覧の先頭へ差し込むこと**だけ。

    **絶対に保存しない。** `rpState.items`は`openReportView()`のたびに
    作り直されるので、画面を離れれば消える。IndexedDBにも共有DBにも
    入らない（見本のロットが実データの一覧に並ぶのは、どんな見間違いより
    悪い）。**そのことが分かる番号と帯を必ず出す**（§CLAUDE 3・§6）。 */
 const RP_SAMPLE_ID='__sample__';
 function rpIsSample(x){return !!(x&&(x.__sample||x.id===RP_SAMPLE_ID))}
 /* 見本であることは**文字で**言う（色だけで伝えない・§CLAUDE 3）。
    帯には**どの設備の配置で見ているか**まで出す——帳票の配置は
    `report:<設備>`（§9.174）なので、設備が違えば別の紙になる。 */
 function renderSampleBar(x){
  let el=$id('rpSampleBar');
  if(!rpIsSample(x)){if(el)el.remove();return}
  if(!el){
   /* ---------- 見本の印は題の帯へ（§9.255 ①、利用者の指示） ----------
      「帳票表示画面の上部がごちゃついているので…コンパクトに2行分くらいに」

      以前は**横いっぱいの帯を1本**（実測41px）使って
      「見本データです／実際の測定データではありません。保存されません。／
       配置は◯◯のもの」と3つの文を並べ、右端に幅いっぱいの「試し印刷」を
      置いていた。言っていることは1つ（**これは見本**）なので、
      題のとなりの札1枚へ詰め、続きは`title`で読む（§9.234 ①）。
      **紙の外**であることは変わらない——`#reportContent`はA4の紙そのもので、
      中へ入れると刷り上がりに混ざる。 */
   el=document.createElement('span');el.id='rpSampleBar';el.className='rp-sample-chip';
   const title=document.querySelector('#reportPanel .rp-bar-title');
   if(title&&title.parentNode)title.parentNode.insertBefore(el,title.nextSibling);
   else return;
  }
  const eq=rpEquipmentOf(x)||'';
  /* **色だけで伝えない**（§CLAUDE 3）ので、見本であることと**どの設備の
     配置で見ているか**は文字で出す（配置は`report:<設備>`・§9.174）。 */
  el.title='実際の測定データではありません。保存されません。'
   +`配置は「${eq||'共通'}」のものです`
   +(eq?'。':'（この端末に使用設備が登録されていないため）。');
  /* **「保存されません」は`title`へ落とさない**（§9.222 ④）——これは
     「見本だ」という分類ではなく、**取り違えを防ぐ唯一の事実**で、
     触る画面では`title`が読めない。畳んでよいのは言い回しのほうだけ
     （§CLAUDE 8）。札1枚に収まる長さなので、詰めても消さない。 */
  el.innerHTML=`<b>見本データ</b><span class="rp-sample-safe">保存されません</span>`
   +`<span class="rp-sample-eq">${esc(eq||'共通')}</span>`
   +`<button type="button" id="rpSamplePrint"`
   +` title="いまの配置のまま、この見本データで試しに1枚刷ります">試し印刷</button>`;
  const pb=el.querySelector('#rpSamplePrint');
  if(pb)pb.onclick=()=>printReport();
 }
 /* 見本を開く。`equipment`を省くとこの端末の使用設備（無ければ共通）。 */
 async function openSampleReport(options){
  const opt=options||{};
  let eq=opt.equipment;
  if(eq==null&&typeof currentConfiguredEquipment==='function'){
   try{eq=currentConfiguredEquipment()}catch(e){eq=''}
  }
  eq=String(eq||'');
  let rec=null;
  try{
   const r=await api('/api/report-block-master/sample-record?equipment='+encodeURIComponent(eq));
   rec=r&&r.record;
  }catch(e){
   showToast&&showToast('見本を作れませんでした',e.message,6000);return;
  }
  if(!rec){showToast&&showToast('見本を作れませんでした','サーバーが見本のロットを返しませんでした。',6000);return}
  rec.id=RP_SAMPLE_ID;rec.__sample=true;
  if(typeof WL.measureView.ensureMeasureShape==='function')WL.measureView.ensureMeasureShape(rec);
  rpReturnTo=RP_RETURNS.indexOf(opt.returnTo)>=0?opt.returnTo:'blocks';
  await openReportView();
  updateBackButton();
  syncArrangeButton();
  /* **先頭へ差し込む**（探させない・§2）。同じidが残っていたら入れ替える
     ——2回開くと見本が2件並ぶ。 */
  rpState.items=[rec,...(rpState.items||[]).filter(i=>!rpIsSample(i))];
  renderLotList();
  selectLot(RP_SAMPLE_ID);
  if(opt.print)requestAnimationFrame(()=>requestAnimationFrame(printReport));
 }
 WL.reportSample={open:openSampleReport,id:()=>RP_SAMPLE_ID};

 /* ---------- 帳票レイアウトマスタの口（§9.254 ③、利用者の指示） ----------
    「帳票の表示画面からいける、レイアウト調整画面ですが、これは実質、帳票
     レイアウトマスタなので、マスタとしても配置し、この帳票レイアウトマスタと
     帳票ブロックマスタを配線しリンクさせて…機能が重複する部分は統合して
     帳票マスタとして親子関係のある高性能マスタとして」

    親＝**設備1つぶんの紙**（`report:<設備>`）／子＝**その紙に載る塊**
    （帳票ブロックマスタの行＋コードが持つ既定の塊）。マスタ管理はこの口
    だけを見る——**組み換えの画面を写さない**（§9.163／§CLAUDE「同じ処理を
    2つ持たない」）。幅の詰め方も既定の書き下ろしも版の刻印も`rpStage()`の
    1箇所にしか無いので、マスタから触っても紙から触っても同じ答えになる。

    **成り代わりは同期の間だけ**（§9.235 ⑤）。`await`はすべて外側で済ませ、
    差し替えている最中に別のコードが割り込む隙を作らない。 */
 function rpWithEquipment(eq,fn){
  const prev={edit:rpEditEquipment,target:rpActiveTarget,forEq:rpUserBlocksFor,
              rows:rpMasterRows,off:rpBuiltinOff,user:rpUserBlocks};
  rpEditEquipment=String(eq==null?'':eq);
  /* 紙を組み立てている最中の固定より弱い印なので、いったん外す。 */
  rpActiveTarget=null;
  rpUseEquipmentBlocks(rpEditEquipment);
  try{return fn()}finally{
   rpEditEquipment=prev.edit;rpActiveTarget=prev.target;
   rpMasterRows=prev.rows;rpBuiltinOff=prev.off;
   rpUserBlocks=prev.user;rpUserBlocksFor=prev.forEq;
  }
 }
 const rpLayoutTarget=eq=>RP_LAYOUT_PREFIX+(String(eq==null?'':eq).trim()||'共通');
 /* 塊そのものの既定（帳票ブロックマスタの`[幅]`/`[高さ]`）を、いまの割りの
    マス数で言う。**設備ごとの上書きと見比べられるように**（§9.254 ③）
    ——どちらで直すのかを毎回思い出させないための材料（§2）。
    式は`rpSpan()`/`rpRows()`の既定の枝と同じ（12マス・12段基準）。 */
 function rpSpanDefault(k){
  const g=rpGrid(),d=(rpBlockOf(k)||{}).span||RP_COLS;
  return Math.max(1,Math.min(g,Math.round(d*g/RP_COLS)));
 }
 function rpRowsDefault(k){
  const d=(rpBlockOf(k)||{}).rows||0;
  return d>0?Math.max(1,Math.min(rpRowCap(),Math.round(d*rpPageRows()/RP_PAGE_ROWS_LEGACY))):0;
 }
 /* その設備の紙1枚ぶん。**塊の顔ぶれと配置を読んでから**答える。 */
 async function rpLayoutInfo(equipment){
  const eq=String(equipment==null?'':equipment).trim();
  const target=rpLayoutTarget(eq);
  await rpLoadUserBlocks(eq);
  try{await WL.columnLayout.load(target)}catch(e){WL.quiet.note('列の設定を取れない（既定の並びで出す）',e)}
  return rpWithEquipment(eq,()=>{
   const savedOrder=(WL.columnLayout.saved(target).order||[]);
   const hidden=rpHiddenSet();
   /* 塊の鍵→マスタの行。既定の塊は`[既定]`、自作の塊は名前が鍵。 */
   const byKey=new Map();
   rpMasterRows.forEach(r=>byKey.set(String(r.builtin||r.name||''),r));
   const blocks=rpBlockKeys().map(k=>{
    const b=rpBlockOf(k)||{},r=byKey.get(k)||null,at=rpPos(k);
    return {key:k,label:rpBlockLabel(k),
            span:rpSpan(k),rows:rpRows(k),
            defSpan:rpSpanDefault(k),defRows:rpRowsDefault(k),
            shown:!hidden.has(k),
            col:at?at.col:0,row:at?at.row:0,
            area:!!b.area,user:!!b.user,
            id:r?r.id:null,kind:r?(r.kindText||''):'',
            equipment:r?(r.equipment||''):'',
            contentEditable:r?!!r.contentEditable:false,
            fields:r?((r.fields||[]).length):0};
   });
   /* **選べる数もここが答える**（§9.163）——画面へ写すと、割りを1つ足した
      ときに2箇所直すことになる（実際、写した直後は6/12/24という
      実在しない割りが並んでいた）。 */
   return {target,equipment:eq,grid:rpGrid(),pageRows:rpPageRows(),
           gridChoices:RP_GRIDS.slice(),pageRowChoices:RP_PAGE_ROW_CHOICES.slice(),
           saved:savedOrder.length>0,
           spans:rpSpanChoices(),rowChoices:rpRowChoices(),blocks};
  });
 }
 /* マスタから直す。**当て方は組み換えと同じ`rpStage()`を通し、保存まで行く**
    ——マスタは「触ったら残る」画面なので、下書きのまま置いていくと
    別の画面が触った覚えのない設定で描かれる（§9.169）。 */
 async function rpLayoutCommit(eq,fn){
  const target=rpLayoutTarget(eq);
  await rpLoadUserBlocks(String(eq==null?'':eq).trim());
  try{await WL.columnLayout.load(target)}catch(e){WL.quiet.note('列の設定を取れない（既定の並びで出す）',e)}
  rpWithEquipment(eq,fn);                     /* 下書きへ当てる（同期） */
  const now=WL.columnLayout.get(target);
  const body={};
  ['order','widths','hidden','names','formats','rules','formulas','locks','sorts','aligns']
   .forEach(k=>{body[k]=now[k]});
  WL.columnLayout.discard(target);
  await WL.columnLayout.save(target,body);
 }
 WL.reportLayout={
  targetOf:rpLayoutTarget,
  info:rpLayoutInfo,
  /* 出す/出さない。**並びも一緒に書き下ろす**のは`rpStage()`の役目。 */
  setShown:(eq,key,on)=>rpLayoutCommit(eq,()=>rpShowBlock(key,!!on)),
  setSpan:(eq,key,n)=>rpLayoutCommit(eq,()=>rpApplySpan(key,Number(n)||1)),
  setRows:(eq,key,n)=>rpLayoutCommit(eq,()=>{
   const v=Number(n)||0,wid={...rpLayoutNow().widths};
   /* 旧いpxの高さは捨てる（§9.217。両方残すとどちらが効くか決まらない）。 */
   delete wid[rpHeightKey(key)];
   if(v>0)wid[rpRowsKey(key)]=rpRowsStore(rpRowsFromGrid(v));else delete wid[rpRowsKey(key)];
   rpStage({widths:wid});
  }),
  /* 紙のマス数（列×段）。組み換えの帯と**同じ`rpSetGrid`は使わない**
     ——あちらは帯を描き直すので、ここでは値だけを書いて保存する。 */
  setGrid:(eq,cols,rows)=>rpLayoutCommit(eq,()=>{
   const wid={...rpLayoutNow().widths};
   wid[RP_GRID_KEY]=rpEnc(Math.max(1,Math.round(Number(cols)||rpGrid())));
   wid[RP_PAGE_ROWS_KEY]=rpEnc(Math.max(1,Math.round(Number(rows)||rpPageRows())));
   rpStage({widths:wid});
  }),
  /* 既定へ戻す＝この設備の設定を消す（登録順・登録幅・全部出す）。 */
  reset:async eq=>{
   const target=rpLayoutTarget(eq);
   await WL.columnLayout.save(target,{});
   WL.columnLayout.forget(target);
   try{await WL.columnLayout.load(target)}catch(e){WL.quiet.note('列の設定を取れない（既定の並びで出す）',e)}
  },
  /* 紙で組み換える。**見本のロットで開く**ので、その設備で測ったロットが
     この端末に1件も無くても配置を直せる（§9.253）。 */
  arrange:async(eq,opt)=>{
   const o=opt||{};
   if(!(WL.reportSample&&typeof WL.reportSample.open==='function')){
    console.error('WL.reportSample.open が見つかりません');return false;
   }
   await WL.reportSample.open({equipment:String(eq==null?'':eq),
     returnTo:o.returnTo||'layout'});
   if(o.arrange!==false&&!rpArranging)await toggleArrange();
   return true;
  }};
 function updateBackButton(){
  const btn=$id('reportBack');if(!btn)return;
  /* ボタンの中身は <svg>アイコン</svg> + 文字列。アイコンは残して文字だけ差し替える。
     **戻り先の名前をそのまま出す**（§2「探させない」）——「戻る」だけだと
     どこへ帰るのか押すまで分からない。 */
  const NAMES={measure:['測定へ戻る','測定画面へ戻ります'],
               actuals:['実績へ戻る','実績データリストへ戻ります'],
               blocks:['帳票ブロックへ戻る','マスタ管理の「帳票ブロック」へ戻ります'],
               layout:['帳票レイアウトへ戻る','マスタ管理の「帳票レイアウト」へ戻ります'],
               records:['戻る','元の一覧に戻ります']};
  const n=NAMES[rpReturnTo]||NAMES.records;
  const label=[...btn.childNodes].find(x=>x.nodeType===Node.TEXT_NODE);
  if(label)label.textContent=n[0];
  btn.title=n[1];
 }
 function backToRecordList(){
  exitReportView();
  if(rpReturnTo==='measure'){
   rpReturnTo='records';updateBackButton();
   const modal=document.getElementById('measureModal');
   if(modal){
    modal.hidden=false;
    /* 帳票へ出ている間に描画が止まっているため、戻った時点の内容で
       検証表示と測定進捗を作り直す(古い件数が残るのを防ぐ)。 */
    if(typeof WL.measureView.updateValidationVisuals==='function')WL.measureView.updateValidationVisuals();
    requestAnimationFrame(()=>$id('deviceInput')?.focus());
   }
   return;
  }
  if(rpReturnTo==='actuals'&&WL.actuals&&typeof WL.actuals.open==='function'){
   rpReturnTo='records';updateBackButton();
   WL.actuals.open();return;
  }
  /* 帳票ブロックマスタへ（§9.253）。**開いていたタブまで戻す**——
     「マスタ管理」の先頭へ落とすと、直していた塊をもう一度探すことになる。 */
  if(rpReturnTo==='blocks'&&typeof window.openMasterMaint==='function'){
   rpReturnTo='records';updateBackButton();
   window.openMasterMaint('reportBlock');return;
  }
  /* 帳票レイアウトマスタへ（§9.254 ③）。組み換えはあちらから開くので、
     **開いていたタブまで戻す**（帳票ブロックと同じ作法）。 */
  if(rpReturnTo==='layout'&&typeof window.openMasterMaint==='function'){
   rpReturnTo='records';updateBackButton();
   window.openMasterMaint('reportLayout');return;
  }
  if(typeof WL.records.openRecordsSafe==='function')WL.records.openRecordsSafe(null);
 }

 /* 測定画面(操作レール)から帳票を開く。帳票は端末に保存済みのレコードを
    読んで描画するため、画面上の入力内容をそのまま出せるよう先に保存する。
    WL.records.saveLocal()の既定値は'編集中'なので、完了済みのデータを開いていた場合に
    状態を巻き戻さないよう、現在の状態を明示して渡す。 */
 async function openReportFromMeasure(print){
  if(!S.measure){showToast?.('測定データがありません','測定画面を開いてから実行してください。',4000);return}
  try{
   await WL.records.saveLocal(S.measure.status||'編集中');
  }catch(e){
   showToast?.('帳票を開けませんでした','入力内容を端末へ保存できませんでした: '+e.message,6000);return;
  }
  await window.openReportForRecord(S.measure.id,{returnTo:'measure',print:!!print});
 }
 document.addEventListener('click',e=>{
  const btn=e.target.closest?.('#openReport,#printReport');if(!btn)return;
  e.preventDefault();
  openReportFromMeasure(btn.id==='printReport');
 });
 window.openReportFromMeasure=openReportFromMeasure;
})();

/* ============================================================
2026-07-21 生産管理ダッシュボード（KPI集計）
--------------------------------------------------------------
方針:
- 端末保存済みの測定データ(reliableAll)を対象とする。品質データ分析
  (qa-v7)はAccess側のテーブルをサーバー集計するのに対し、こちらは
  ローカルのみのデータのためクライアント側で集計する。
- 「設備別効率」「人数別内訳」「品種別作業時間」を個別画面にせず、
  軸(X)×系列×指標×期間/集計単位を自由に組み合わせる汎用集計に
  统一する（品質データ分析と同じ設計思想）。プリセットボタンは
  この汎用設定に対する「よく使う組み合わせのショートカット」。
============================================================ */
(function(){
 const $id=id=>document.getElementById(id);
 const val=id=>{const el=$id(id);return el?el.value:''};
 const fmt=n=>Number(n||0).toLocaleString(undefined,{maximumFractionDigits:1});
 const ell=(s,n)=>{s=String(s??'');return s.length>n?s.slice(0,n-1)+'…':s};
 function niceMax(m){if(!(m>0))return 1;const p=Math.pow(10,Math.floor(Math.log10(m)));const n=m/p;const f=n<=1?1:n<=2?2:n<=5?5:10;return f*p}
 function bandGap(slot,factor){return Math.max(2,Math.min(slot*(1-factor),34))}
 function bandWidth(slot,factor,min){return Math.max(min||4,slot-bandGap(slot,factor))}
 const stackPalette=['#087c89','#2563eb','#16a34a','#f59e0b','#dc2626','#7c3aed','#0f766e','#e11d48','#64748b','#84cc16'];

 function legendLayout(keys,maxW){
  const rowH=17,chipW=10,padX=10;
  let cx=0,rows=1;const placements=[];
  keys.forEach((k,i)=>{
   const label=ell(String(k),14);
   // eslint-disable-next-line no-control-regex -- \x00〜\xff＝半角1文字ぶんの幅と見なす（意図した範囲）
   const textW=Math.max(20,[...label].reduce((w,ch)=>w+(/[\x00-\xff]/.test(ch)?6.4:11.5),0));
   const itemW=chipW+4+textW+padX;
   if(cx+itemW>maxW&&cx>0){cx=0;rows++}
   placements.push({label,row:rows-1,x:cx,col:stackPalette[i%stackPalette.length]});
   cx+=itemW;
  });
  return {placements,rows,rowH};
 }
 function legendSvg(info,x0,y0){
  if(!info)return '';
  return info.placements.map(p=>`<rect x="${x0+p.x}" y="${y0+p.row*info.rowH-9}" width="10" height="10" rx="2" fill="${p.col}"></rect><text class="db-svg-legend-label" x="${x0+p.x+14}" y="${y0+p.row*info.rowH}">${esc(p.label)}</text>`).join('');
 }

 /* ---------- ローカル測定データ → KPI用フラット行 ---------- */
 function crewLabel(size){return(size&&size!=='-')?`${size}名班`:'人数未設定'}
 function toKpiRow(x){
  const b=x.basic||{},s=x.settings||{},w=x.workTime||{};
  const start=w.startAt?new Date(w.startAt):null,end=w.endAt?new Date(w.endAt):null;
  const validRange=start&&end&&!isNaN(start)&&!isNaN(end)&&end>start;
  const durationMin=validRange?(end-start)/60000:null;
  const vertical=Math.max(1,+s.verticalCount||1),horizontal=Math.max(1,+s.horizontalCount||1);
  const dateBase=start&&!isNaN(start)?start:(x.updatedAt?new Date(x.updatedAt):null);
  return {
   id:x.id,status:x.status||'編集中',
   lotNo:b.lotNo||'',                 // 稼働状況ビューの「直近の実績」で使う(§9.64)
   equipment:s.registeredEquipment||x.registeredEquipment||b.equipment||'-',
   crewSize:(s.crewSize&&s.crewSize!=='-')?String(s.crewSize):'',
   operator:s.operator||'-',
   measureType:s.measureType||'-',
   purposeName:b.purposeName||'用途未設定',
   productType:`${b.purposeName||'用途未設定'} / ${vertical}丈×${horizontal}条`,
   durationMin,
   date:(dateBase&&!isNaN(dateBase))?dateBase:null,
  };
 }

 const DIMENSIONS={
  equipment:{label:'設備',get:r=>r.equipment},
  crewSize:{label:'作業人数',get:r=>crewLabel(r.crewSize)},
  productType:{label:'品種（用途名・丈数×条数）',get:r=>r.productType},
  purposeName:{label:'用途名',get:r=>r.purposeName},
  operator:{label:'オペレータ',get:r=>r.operator},
  measureType:{label:'入力内容',get:r=>r.measureType},
 };
 const METRICS={
  count:{label:'件数',compute:c=>c.count},
  avgMin:{label:'平均作業時間（分/件）',compute:c=>c.durCount?c.durSum/c.durCount:null},
  sumHour:{label:'合計作業時間（時間）',compute:c=>c.durSum/60},
  perHour:{label:'時間あたり処理数（件/時）',compute:c=>c.durSum>0?c.count/(c.durSum/60):null},
 };
 function bucketKey(date,bucket){
  if(!date)return null;
  const y=date.getFullYear(),m=date.getMonth()+1,d=date.getDate(),p2=n=>String(n).padStart(2,'0');
  if(bucket==='year')return `${y}年`;
  if(bucket==='month')return `${y}-${p2(m)}`;
  return `${y}-${p2(m)}-${p2(d)}`;
 }

 /* ---------- 汎用集計: 軸(分類/時系列)×系列×指標 ---------- */
 function aggregate(rows,{axis,bucket,series,metricKey}){
  const metric=METRICS[metricKey]||METRICS.count;
  const groups=new Map(),seriesKeys=new Set();
  rows.forEach(r=>{
   const key=axis==='time'?bucketKey(r.date,bucket):(DIMENSIONS[axis]?DIMENSIONS[axis].get(r):'-');
   if(key==null||key==='')return;
   if(!groups.has(key))groups.set(key,{label:key,cells:new Map()});
   const g=groups.get(key);
   const sk=series&&DIMENSIONS[series]?DIMENSIONS[series].get(r):'__all__';
   seriesKeys.add(sk);
   if(!g.cells.has(sk))g.cells.set(sk,{count:0,durSum:0,durCount:0});
   const c=g.cells.get(sk);
   c.count++;if(r.durationMin!=null){c.durSum+=r.durationMin;c.durCount++}
  });
  let items=[...groups.values()].map(g=>{
   const totalCell={count:0,durSum:0,durCount:0};const stacks={};
   g.cells.forEach((c,k)=>{stacks[k]=metric.compute(c);totalCell.count+=c.count;totalCell.durSum+=c.durSum;totalCell.durCount+=c.durCount});
   return {label:g.label,value:metric.compute(totalCell),stacks,count:totalCell.count};
  });
  if(axis==='time')items.sort((a,b)=>String(a.label).localeCompare(String(b.label)));
  else items.sort((a,b)=>(Number(b.value)||0)-(Number(a.value)||0));
  const keys=series?[...seriesKeys].filter(k=>k!=='__all__').sort((a,b)=>String(a).localeCompare(String(b),'ja')):[];
  return {items,keys,metricLabel:metric.label,total:rows.length};
 }

 /* ---------- グラフ描画（縦棒/集合棒。品質データ分析のSVG設計を踏襲） ---------- */
 function stage(){const el=$id('dashboardChart');if(!el)return{w:900,h:460};const w=el.clientWidth,h=el.clientHeight;if(w<80||h<80)return{w:Math.max(760,w||900),h:Math.max(400,h||460)};return{w:Math.max(320,w-20),h:Math.max(240,h-20)}}
 function svgBar(items,cfg){
  const {W,H,keys,hasSeries,showVal,color,title,subtitle,xTitle,yTitle}=cfg;
  if(!items.length)return '';
  const labels=items.map(it=>String(it.label));
  const maxLen=Math.max(...labels.map(s=>ell(s,18).length),1);
  const rotate=items.length>6||maxLen>5;
  const R=16,L0=60+(yTitle?18:0);
  const legendKeys=hasSeries?keys:[];
  const legendInfo=legendKeys.length?legendLayout(legendKeys,Math.max(140,W-L0-R)):null;
  const titleH=title?21:0,subtitleH=subtitle?15:0,legendH=legendInfo?legendInfo.rows*17+6:0;
  const B=(rotate?Math.min(150,Math.max(46,34+maxLen*7)):40)+(xTitle?20:0);
  const T=12+titleH+subtitleH+legendH,L=L0;
  const plotH=Math.max(90,H-T-B),plotW=Math.max(140,W-L-R);
  const n=items.length,slot=plotW/n,x=i=>L+slot*i+slot/2;
  const primVals=hasSeries?items.map(it=>Math.max(...keys.map(k=>Number(it.stacks?.[k])||0),0)):items.map(it=>Number(it.value)||0);
  const pmax=niceMax(Math.max(...primVals,1));
  const yB=v=>T+plotH-(Number(v||0)/pmax)*plotH;
  let grid='';for(let r=0;r<=4;r++){const gy=T+plotH*r/4,gv=pmax*(4-r)/4;grid+=`<line class="db-gridline" x1="${L}" y1="${gy}" x2="${W-R}" y2="${gy}"></line><text class="db-label" x="${L-8}" y="${gy+4}" text-anchor="end">${fmt(gv)}</text>`}
  const bw=bandWidth(slot,.62,3);
  let body='';
  if(hasSeries){
   const clusterW=bandWidth(slot,.62,10),innerGap=Math.min(4,clusterW/keys.length*0.15);
   const gw=Math.max(3,clusterW/keys.length-innerGap),groupW=gw*keys.length+innerGap*(keys.length-1);
   body=items.map((it,i)=>{const x0=x(i)-groupW/2;return keys.map((k,si)=>{const v=it.stacks?.[k];if(v==null||Number.isNaN(v))return '';return `<rect x="${x0+si*(gw+innerGap)}" y="${yB(v)}" width="${gw}" height="${Math.max(1,T+plotH-yB(v))}" rx="2" fill="${stackPalette[si%stackPalette.length]}"><title>${esc(it.label)} / ${esc(k)}: ${fmt(v)}</title></rect>`}).join('')}).join('');
  }else{
   body=items.map((it,i)=>{const v=it.value;if(v==null||Number.isNaN(v))return '';return `<rect x="${x(i)-bw/2}" y="${yB(v)}" width="${bw}" height="${Math.max(1,T+plotH-yB(v))}" rx="4" fill="${color}" opacity=".9"><title>${esc(it.label)}: ${fmt(v)}</title></rect>`}).join('');
   if(showVal){const st=Math.ceil(items.length/22||1);body+=items.map((it,i)=>{const v=it.value;if(v==null||Number.isNaN(v)||i%st!==0)return '';return `<text class="db-value" x="${x(i)}" y="${yB(v)-6}" text-anchor="middle">${fmt(v)}</text>`}).join('')}
  }
  const xlabels=items.map((it,i)=>rotate?`<text class="db-label" x="${x(i)}" y="${T+plotH+14}" text-anchor="end" transform="rotate(-40 ${x(i)} ${T+plotH+14})">${esc(ell(it.label,18))}<title>${esc(it.label)}</title></text>`:`<text class="db-label" x="${x(i)}" y="${T+plotH+18}" text-anchor="middle">${esc(ell(it.label,10))}<title>${esc(it.label)}</title></text>`).join('');
  const head=(title?`<text class="db-chart-title" x="${W/2}" y="16" text-anchor="middle">${esc(title)}</text>`:'')+(subtitle?`<text class="db-chart-subtitle" x="${W/2}" y="${16+titleH}" text-anchor="middle">${esc(subtitle)}</text>`:'')+legendSvg(legendInfo,L,16+titleH+subtitleH+10);
  const axisTitles=(xTitle?`<text class="db-axis-title" x="${L+plotW/2}" y="${T+plotH+B-6}" text-anchor="middle">${esc(xTitle)}</text>`:'')+(yTitle?`<text class="db-axis-title" x="14" y="${T+plotH/2}" text-anchor="middle" transform="rotate(-90 14 ${T+plotH/2})">${esc(yTitle)}</text>`:'');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title||'ダッシュボードグラフ')}">${head}${axisTitles}${grid}<line class="db-axis" x1="${L}" y1="${T}" x2="${L}" y2="${T+plotH}"></line><line class="db-axis" x1="${L}" y1="${T+plotH}" x2="${W-R}" y2="${T+plotH}"></line>${body}${xlabels}</svg>`;
 }

 /* ---------- モーダル/コントロール ---------- */
 let dbCache=null,dbLast=null,dbLoading=null;
 /* 結果ではなく**進行中のPromise**を持つ。結果だけをキャッシュすると、
    1回の描画から2箇所が同時に呼んだときに両方ともキャッシュ未命中となり、
    端末内データの全件読みが2回走る(実測で発生していた)。 */
 async function ensureData(force){
  if(dbCache&&!force)return dbCache;
  if(dbLoading&&!force)return dbLoading;
  dbLoading=(async()=>{
   try{dbCache=(await WL.records.reliableAll()).map(toKpiRow);return dbCache}
   finally{dbLoading=null}
  })();
  return dbLoading;
 }

 function ensureNavButton(){
  const nav=document.querySelector('#analysisNav');if(!nav||$id('openDashboard'))return;
  const b=document.createElement('button');b.type='button';b.id='openDashboard';b.className='db nav-item nav-item--view';
  b.innerHTML='<svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg><span>ダッシュボード</span>';
  b.title='端末保存済みの測定データからKPI（設備別効率・人数別内訳・品種別作業時間など）を集計します';
  b.onclick=openDashboardView;nav.append(b);
 }

 function exitDashboardView(){
  if(!document.body.classList.contains('db-mode'))return;
  document.body.classList.remove('db-mode');
  $id('openDashboard')?.classList.remove('active');
  const panel=$id('dashboardPanel');if(panel)panel.hidden=true;
 }
 /* 表示切替タブと再読込はヘッダーの#headerViewBarへ移す。画面名の無い
    見出しバーが1本残っていて本文の高さを食っていた。 */
 WL.registerView({key:'dashboard',bodyClass:'db-mode',nav:'openDashboard',toolbar:'#dbHeadActions',
  header:['ダッシュボード','作業予定と測定実績の集計'],exit:exitDashboardView});

 const AXIS_OPTS=[['time','時系列'],['equipment','設備'],['crewSize','作業人数'],['productType','品種（用途名・丈数×条数）'],['purposeName','用途名'],['operator','オペレータ'],['measureType','入力内容']];
 const SERIES_OPTS=[['','なし'],['equipment','設備'],['crewSize','作業人数'],['productType','品種'],['operator','オペレータ']];
 const METRIC_OPTS=[['avgMin','平均作業時間（分/件）'],['count','件数'],['sumHour','合計作業時間（時間）'],['perHour','時間あたり処理数（件/時）']];
 const PRESETS={
  equipEfficiency:{axis:'equipment',series:'crewSize',metric:'avgMin'},
  crewBreakdown:{axis:'crewSize',series:'equipment',metric:'count'},
  productType:{axis:'productType',series:'',metric:'avgMin'},
  trend:{axis:'time',bucket:'month',series:'equipment',metric:'count'},
 };

 function ensurePanel(){
  let panel=$id('dashboardPanel');if(panel)return panel;
  panel=document.createElement('section');panel.className='db-panel';panel.id='dashboardPanel';panel.hidden=true;
  panel.innerHTML=`
    <div class="rp-head-actions db-head-actions" id="dbHeadActions">
      <div class="db-viewtabs" role="tablist" aria-label="表示の切り替え">
       <button type="button" role="tab" data-dbview="status" class="active" title="作業予定と実績から、いまの稼働状況をまとめて表示します">稼働状況</button>
       <button type="button" role="tab" data-dbview="equipment" title="この端末の使用設備にしぼって、実績ベースで表示します">自設備</button>
       <button type="button" role="tab" data-dbview="pivot" title="期間・軸・指標を自分で選んで集計します">自由集計</button>
      </div>
      <button type="button" id="dbStatusRefresh" class="rp-btn-secondary" title="作業予定と実績を取り直します">再読込</button>
    </div>
    <div class="db-status-view" id="dbStatusView">
     <div class="db-summary" id="dbStatusKpi"></div>
     <div class="db-status-grid">
      <section class="db-status-card">
       <div class="db-status-card-head"><b>設備の稼働状況</b><span>作業スケジュールの予定と実績から</span></div>
       <div class="db-status-body" id="dbEquipStatus"></div>
      </section>
      <section class="db-status-card">
       <div class="db-status-card-head"><b>直近の実績</b><span>この端末に保存された測定データ</span></div>
       <div class="db-status-body" id="dbRecentActual"></div>
      </section>
     </div>
    </div>
    <div class="db-equip-view" id="dbEquipView" hidden>
     <div class="db-equip-head">
      <b id="dbEquipName">使用設備が未登録です</b>
      <div class="db-seg" data-seg="dbEquipRangeSeg" role="group" aria-label="対象期間">
       <button type="button" data-val="7" title="直近7日の実績で集計します">7日</button>
       <button type="button" data-val="30" class="active" title="直近30日の実績で集計します">30日</button>
       <button type="button" data-val="90" title="直近90日の実績で集計します">90日</button>
      </div>
     </div>
     <div class="db-summary" id="dbEquipKpi"></div>
     <div class="db-equip-grid">
      <section class="db-card"><h3>品種別の平均作業時間</h3><div id="dbEquipProduct"></div></section>
      <section class="db-card"><h3>オペレータ別の実績</h3><div id="dbEquipOperator"></div></section>
      <section class="db-card db-card-wide"><h3>直近の実績</h3><div id="dbEquipRecent"></div></section>
     </div>
    </div>
    <div class="db-layout" id="dbPivotView" hidden>
     <aside class="db-controls">
      <div class="db-presets">
       <button type="button" data-preset="equipEfficiency" class="active">設備別効率</button>
       <button type="button" data-preset="crewBreakdown">人数別内訳</button>
       <button type="button" data-preset="productType">品種別作業時間</button>
       <button type="button" data-preset="trend">月次推移</button>
      </div>
      <div class="db-ctl-group">
       <span class="db-ctl-label">期間</span>
       <div class="db-seg" data-seg="dbPeriodSeg">
        <button type="button" data-val="7d">直近7日</button><button type="button" data-val="30d">直近30日</button><button type="button" data-val="90d">直近90日</button>
        <button type="button" data-val="thisMonth" class="active">今月</button><button type="button" data-val="lastMonth">先月</button><button type="button" data-val="ytd">今年</button><button type="button" data-val="all">全期間</button>
       </div>
       <div class="db-field-grid"><label>開始<input id="dbStart" type="date"></label><label>終了<input id="dbEnd" type="date"></label></div>
      </div>
      <div class="db-ctl-group">
       <span class="db-ctl-label">軸（X）</span>
       <select id="dbAxis">${AXIS_OPTS.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join('')}</select>
       <div class="db-sub" id="dbBucketWrap" hidden>
        <span>集計単位</span>
        <div class="db-seg db-seg-sm" data-seg="dbBucketSeg"><button type="button" data-val="day" class="active">日</button><button type="button" data-val="month">月</button><button type="button" data-val="year">年</button></div>
       </div>
      </div>
      <div class="db-ctl-group"><span class="db-ctl-label">内訳（系列）</span><select id="dbSeries">${SERIES_OPTS.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
      <div class="db-ctl-group"><span class="db-ctl-label">指標（Y）</span><select id="dbMetric">${METRIC_OPTS.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
      <div class="db-ctl-group"><span class="db-ctl-label">対象ステータス</span><select id="dbStatus"><option value="done">完了のみ</option><option value="all">すべて（編集中含む）</option></select></div>
      <button type="button" id="dbRefresh" class="rp-btn-primary">この条件で集計</button>
     </aside>
     <main class="db-main">
      <div class="db-summary" id="dashboardSummary"></div>
      <div class="db-chart-wrap"><div class="db-chart" id="dashboardChart"><div class="db-empty">左の設定で集計条件を選び、「この条件で集計」を押してください。</div></div></div>
      <div class="db-table-wrap"><table class="db-table" id="dashboardTable"></table></div>
     </main>
    </div>`;
  const grid=$id('grid');grid?.parentNode?.insertBefore(panel,grid);
  panel.querySelectorAll('[data-seg="dbPeriodSeg"] button').forEach(b=>b.onclick=()=>applyPeriod(b.dataset.val));
  panel.querySelectorAll('[data-seg="dbBucketSeg"] button').forEach(b=>b.onclick=()=>{setSeg('dbBucketSeg',b.dataset.val);runDashboard()});
  $id('dbStart').addEventListener('change',()=>{setSeg('dbPeriodSeg','');runDashboard()});
  $id('dbEnd').addEventListener('change',()=>{setSeg('dbPeriodSeg','');runDashboard()});
  $id('dbAxis').addEventListener('change',()=>{toggleBucket();runDashboard()});
  ['dbSeries','dbMetric','dbStatus'].forEach(id=>$id(id).addEventListener('change',runDashboard));
  $id('dbRefresh').onclick=()=>runDashboard(true);
  panel.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>applyPreset(b.dataset.preset));
  panel.querySelectorAll('[data-dbview]').forEach(b=>b.onclick=()=>setDashboardView(b.dataset.dbview));
  $id('dbStatusRefresh').onclick=()=>{
   if(dbView==='status')runStatusView(true);
   else if(dbView==='equipment')runEquipmentView(true);
   else runDashboard(true);
  };
  panel.querySelectorAll('[data-seg="dbEquipRangeSeg"] button').forEach(b=>b.onclick=()=>{
   panel.querySelectorAll('[data-seg="dbEquipRangeSeg"] button').forEach(x=>x.classList.toggle('active',x===b));
   runEquipmentView();
  });
  return panel;
 }

 /* ---------- 稼働状況ビュー(§9.64) ----------
    ダッシュボードの既定は「自分で条件を組み立てる集計」だったが、開いた
    直後は条件未設定で空("対象データがありません")のことが多く、何のための
    画面か分からない状態だった。既定を**いまの稼働状況**にする。
    データ源は2つ:
      - 作業予定と進み具合 … /api/schedule/overview(俯瞰ボードと同じ1往復)
      - 実績            … 端末内の測定データ(ensureData、既存と共用)
    自由集計は「自由集計」タブとしてそのまま残す(汎用の集計機能は担保する)。 */
 let dbView='status';
 function setDashboardView(view){
  dbView=['pivot','equipment'].includes(view)?view:'status';
  const panel=$id('dashboardPanel');if(!panel)return;
  panel.querySelectorAll('[data-dbview]').forEach(b=>{
   const on=b.dataset.dbview===dbView;
   b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));
  });
  $id('dbStatusView').hidden=(dbView!=='status');
  $id('dbEquipView').hidden=(dbView!=='equipment');
  $id('dbPivotView').hidden=(dbView!=='pivot');
  if(dbView==='status')runStatusView();
  else if(dbView==='equipment')runEquipmentView();
  else runDashboard();
 }

 let scheduleOverviewCache=null;
 async function fetchOverview(force){
  if(scheduleOverviewCache&&!force)return scheduleOverviewCache;
  try{scheduleOverviewCache=await api('/api/schedule/overview')}
  catch(e){scheduleOverviewCache={ok:false,error:e.message,equipment:[]}}
  return scheduleOverviewCache;
 }
 /* 時間の書き方を変えたら、いま出ている稼働状況も書き直す（§9.341）。
    取り直しはしない（`force`を渡さない）——変わったのは書き方だけで、
    数字そのものは同じ。 */
 document.addEventListener('wl:duration-style',()=>{
  const panel=$id('dashboardPanel');if(!panel||panel.hidden)return;
  if(dbView==='status')runStatusView();
  else if(dbView==='equipment')runEquipmentView();
 });
 async function runStatusView(force){
  const panel=$id('dashboardPanel');if(!panel||panel.hidden||dbView!=='status')return;
  if(typeof WL.records.withWaiting!=='function')return runStatusViewInner(force,()=>{});
  return WL.records.withWaiting({title:'稼働状況を集計しています',detail:'作業予定と測定実績を読み込んでいます',
   progress:'作業予定を取得しています',step:1},report=>runStatusViewInner(force,report));
 }
 async function runStatusViewInner(force,report){
  const [ov,all]=await Promise.all([fetchOverview(force),ensureData(force)]);
  report({progress:'実績と突き合わせています',step:2});
  const rows=(ov&&ov.equipment)||[];
  const running=rows.filter(r=>r.active);
  const pendingCount=rows.reduce((s,r)=>s+(r.pendingCount||0),0);
  const pendingMin=rows.reduce((s,r)=>s+(r.pendingMinutes||0),0);
  const late=rows.filter(r=>(r.maxOverdueMinutes||0)>0);
  // 実績側(今日ぶん)
  const today=new Date();today.setHours(0,0,0,0);
  const todayRows=all.filter(r=>r.date&&r.date>=today);
  const doneToday=todayRows.filter(r=>r.status==='完了');
  const durs=doneToday.filter(r=>r.durationMin!=null).map(r=>r.durationMin);
  const avg=durs.length?durs.reduce((a,b)=>a+b,0)/durs.length:null;

  const notConfigured=ov&&ov.configured===false;
  const failed=ov&&ov.ok===false;
  $id('dbStatusKpi').innerHTML=`
   <div class="db-card"><span class="db-card-label">稼働中の設備</span><b class="db-card-value">${fmt(running.length)}</b><small class="db-card-note">全 ${fmt(rows.length)} 設備</small></div>
   <div class="db-card"><span class="db-card-label">残っている予定</span><b class="db-card-value">${fmt(pendingCount)}<small>件</small></b><small class="db-card-note">見込 ${esc(WL.duration.text(pendingMin))}</small></div>
   <div class="db-card${late.length?' is-warn':''}"><span class="db-card-label">遅れている設備</span><b class="db-card-value">${fmt(late.length)}</b><small class="db-card-note">${late.length?'最大 '+esc(WL.duration.text(Math.max(...late.map(r=>r.maxOverdueMinutes||0)))):'遅れなし'}</small></div>
   <div class="db-card"><span class="db-card-label">本日の完了</span><b class="db-card-value">${fmt(doneToday.length)}<small>件</small></b><small class="db-card-note">${avg!=null?'平均 '+fmt(avg)+' 分':'実績なし'}</small></div>`;

  if(notConfigured||failed){
   $id('dbEquipStatus').innerHTML=`<div class="db-empty">${notConfigured
     ?'作業予定の共有先が未設定です。マスタ管理 &gt; パス設定で設定してください。'
     :'作業予定を取得できませんでした。'+esc(ov.error||'')}</div>`;
  }else if(!rows.length){
   $id('dbEquipStatus').innerHTML='<div class="db-empty">設備マスタに有効な設備がありません。</div>';
  }else{
   // 動いている設備・遅れている設備を上に出す(見るべきものから目に入る順)
   const sorted=[...rows].sort((a,b)=>
     (b.maxOverdueMinutes||0)-(a.maxOverdueMinutes||0)||
     (b.active?1:0)-(a.active?1:0)||(b.pendingCount||0)-(a.pendingCount||0));
   $id('dbEquipStatus').innerHTML=`<table class="db-status-table">
    <thead><tr><th>設備</th><th>状態</th><th>作業中のロット</th><th>経過</th><th>残り</th><th>見込</th><th>遅れ</th></tr></thead>
    <tbody>${sorted.map(r=>{
     const od=r.maxOverdueMinutes||0;
     return `<tr class="${od>0?'is-late':(r.active?'is-running':'')}">
      <th>${esc(r.equipment)}</th>
      <td><span class="db-state-badge ${r.active?'running':'idle'}">${r.active?'稼働中':'空き'}</span></td>
      <td class="db-lot">${esc(r.active?(r.active.lotNo||r.active.title||'-'):'-')}</td>
      <td>${r.active&&r.active.elapsedMinutes!=null?esc(WL.duration.text(r.active.elapsedMinutes)):'-'}</td>
      <td>${fmt(r.pendingCount||0)}件</td>
      <td>${esc(WL.duration.text(r.pendingMinutes||0))}</td>
      <td>${od>0?`<b class="db-late">${esc(WL.duration.text(od))}</b>`:'-'}</td>
     </tr>`}).join('')}</tbody></table>`;
  }

  const recent=[...all].filter(r=>r.date).sort((a,b)=>b.date-a.date).slice(0,12);
  $id('dbRecentActual').innerHTML=recent.length?`<table class="db-status-table">
   <thead><tr><th>ロット</th><th>設備</th><th>状態</th><th>作業時間</th><th>日時</th></tr></thead>
   <tbody>${recent.map(r=>`<tr>
    <th class="db-lot">${esc(r.lotNo||'-')}</th>
    <td>${esc(r.equipment||'-')}</td>
    <td><span class="db-state-badge ${r.status==='完了'?'done':(r.status==='測定値NG'?'ng':'editing')}">${esc(WL.base.statusShortLabel(r.status))}</span></td>
    <td>${r.durationMin!=null?fmt(r.durationMin)+' 分':'-'}</td>
    <td>${esc(r.date.toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}))}</td>
   </tr>`).join('')}</tbody></table>`
   :'<div class="db-empty">この端末にはまだ測定データがありません。</div>';
 }

 function setSeg(group,value){document.querySelectorAll(`[data-seg="${group}"] button`).forEach(b=>b.classList.toggle('active',b.dataset.val===value))}
 function toggleBucket(){const el=$id('dbBucketWrap');if(el)el.hidden=val('dbAxis')!=='time'}

 function periodRange(kind){
  const now=new Date();let a=null,b=null;
  if(kind==='7d'){a=new Date(now);a.setDate(now.getDate()-6);b=now}
  else if(kind==='30d'){a=new Date(now);a.setDate(now.getDate()-29);b=now}
  else if(kind==='90d'){a=new Date(now);a.setDate(now.getDate()-89);b=now}
  else if(kind==='thisMonth'){a=new Date(now.getFullYear(),now.getMonth(),1);b=now}
  else if(kind==='lastMonth'){a=new Date(now.getFullYear(),now.getMonth()-1,1);b=new Date(now.getFullYear(),now.getMonth(),0)}
  else if(kind==='ytd'){a=new Date(now.getFullYear(),0,1);b=now}
  return {a,b};
 }
 function applyPeriod(kind){
  const {a,b}=periodRange(kind),pad=n=>String(n).padStart(2,'0'),d=dt=>dt?`${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`:'';
  $id('dbStart').value=d(a);$id('dbEnd').value=d(b);setSeg('dbPeriodSeg',kind);runDashboard();
 }
 function applyPreset(name){
  const p=PRESETS[name];if(!p)return;
  document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset===name));
  $id('dbAxis').value=p.axis;$id('dbSeries').value=p.series||'';$id('dbMetric').value=p.metric;
  if(p.bucket)setSeg('dbBucketSeg',p.bucket);
  toggleBucket();runDashboard();
 }

 function summaryCards(rows){
  const n=rows.length,withDur=rows.filter(r=>r.durationMin!=null);
  const avg=withDur.length?withDur.reduce((s,r)=>s+r.durationMin,0)/withDur.length:null;
  const equipCount=new Set(rows.map(r=>r.equipment)).size;
  const crewCount=new Set(rows.map(r=>r.crewSize).filter(Boolean)).size;
  return `<div class="db-card"><span class="db-card-label">対象ロット数</span><b class="db-card-value">${fmt(n)}</b></div>
   <div class="db-card"><span class="db-card-label">平均作業時間</span><b class="db-card-value">${avg!=null?fmt(avg)+' 分':'-'}</b></div>
   <div class="db-card"><span class="db-card-label">稼働設備数</span><b class="db-card-value">${fmt(equipCount)}</b></div>
   <div class="db-card"><span class="db-card-label">記録済み人数区分</span><b class="db-card-value">${fmt(crewCount)}</b></div>`;
 }
 function axisLabelOf(axis){return axis==='time'?'期間':(DIMENSIONS[axis]?DIMENSIONS[axis].label:axis)}
 function tableHtml(data,ctx){
  if(!data.items.length)return '<tbody><tr><td class="db-empty-cell">対象データがありません</td></tr></tbody>';
  const hasSeries=!!ctx.series&&data.keys.length>0;
  const showCount=ctx.metricKey!=='count';
  const countCol=showCount?'<th>件数</th>':'';
  const head=hasSeries?`<tr><th>${esc(axisLabelOf(ctx.axis))}</th>${data.keys.map(k=>`<th>${esc(k)}</th>`).join('')}<th>${esc(data.metricLabel)}</th>${countCol}</tr>`:`<tr><th>${esc(axisLabelOf(ctx.axis))}</th><th>${esc(data.metricLabel)}</th>${countCol}</tr>`;
  const body=data.items.map(it=>{
   const cells=hasSeries?data.keys.map(k=>`<td>${it.stacks[k]!=null?fmt(it.stacks[k]):'-'}</td>`).join(''):'';
   const countCell=showCount?`<td>${fmt(it.count)}</td>`:'';
   return `<tr><th>${esc(it.label)}</th>${cells}<td>${it.value!=null?fmt(it.value):'-'}</td>${countCell}</tr>`;
  }).join('');
  return `<thead>${head}</thead><tbody>${body}</tbody>`;
 }

 function renderDashboard(data,ctx,scopeRows){
  dbLast={data,ctx};
  const hasSeries=!!ctx.series&&data.keys.length>0;
  const axisLabel=axisLabelOf(ctx.axis);
  const title=hasSeries?`${axisLabel} × ${DIMENSIONS[ctx.series].label} 別 ${data.metricLabel}`:`${axisLabel} 別 ${data.metricLabel}`;
  const subtitle=`対象 ${fmt(scopeRows.length)}件・表示 ${data.items.length}項目`;
  const {w,h}=stage();
  const svg=svgBar(data.items,{W:w,H:h,keys:data.keys,hasSeries,showVal:!hasSeries,color:'#087c89',title,subtitle,xTitle:axisLabel,yTitle:data.metricLabel});
  $id('dashboardChart').innerHTML=svg||'<div class="db-empty">対象データがありません。条件を見直してください。</div>';
  $id('dashboardSummary').innerHTML=summaryCards(scopeRows);
  $id('dashboardTable').innerHTML=tableHtml(data,ctx);
 }

 /* ---------- 自設備ビュー(§9.74) ----------
    稼働状況・自由集計は「全設備を見渡す」スケジューラ視点で、設備で作業する
    人にとってはマクロすぎる。この端末の使用設備だけに絞り、実績ベースで
    「自分の設備がどうだったか」を出す。全設備平均との差を併記するのは、
    自設備の数字だけでは速いのか遅いのか判断できないため。 */
 function equipRangeDays(){
  const b=document.querySelector('#dashboardPanel [data-seg="dbEquipRangeSeg"] button.active');
  return Math.max(1,+(b?.dataset.val)||30);
 }
 function statOf(rows){
  const durs=rows.map(r=>r.durationMin).filter(v=>Number.isFinite(v)&&v>0);
  const sum=durs.reduce((a,b)=>a+b,0);
  return {count:rows.length,measured:durs.length,sumMin:sum,
          avgMin:durs.length?sum/durs.length:null};
 }
 /* 所要時間の書き方は`WL.duration`の1箇所(§9.341)。ここには置かない——
    以前はこの2行が`150分`と`2.5時間`を別々に決めており、同じ画面の中で
    「見込 150分」と「合計作業時間 2.5時間」が並んでいた。 */
 async function runEquipmentView(force){
  const panel=$id('dashboardPanel');if(!panel||panel.hidden)return;
  if(typeof WL.records.withWaiting!=='function')return runEquipmentViewInner(force);
  return WL.records.withWaiting({title:'自設備の実績を集計しています',
   detail:'この端末に保存された測定データを読み込んでいます',
   progress:'対象期間の実績を集計しています'},()=>runEquipmentViewInner(force));
 }
 async function runEquipmentViewInner(force){
  const panel=$id('dashboardPanel');if(!panel||panel.hidden||dbView!=='equipment')return;
  const eq=(typeof currentConfiguredEquipment==='function'?currentConfiguredEquipment():'')||'';
  const nameEl=$id('dbEquipName');
  if(nameEl)nameEl.textContent=eq?`使用設備: ${eq}`:'使用設備が未登録です';
  const kpi=$id('dbEquipKpi');
  if(!eq){
   if(kpi)kpi.innerHTML='<div class="db-empty">ヘッダーの「使用設備」から設備を登録すると、この設備の実績を集計します。</div>';
   ['dbEquipProduct','dbEquipOperator','dbEquipRecent'].forEach(id=>{const e=$id(id);if(e)e.innerHTML=''});
   return;
  }
  const all=await ensureData(force);
  const days=equipRangeDays(),since=new Date(Date.now()-days*86400000);
  const inRange=all.filter(r=>r.status==='完了'&&r.date&&r.date>=since);
  const mine=inRange.filter(r=>r.equipment===eq);
  const others=inRange.filter(r=>r.equipment!==eq);
  const me=statOf(mine),ot=statOf(others);

  /* 比較は「自設備の平均 − 全設備(自設備以外)の平均」。速い=マイナス。
     色だけに頼らず符号と語(速い/遅い)も出す。 */
  const diff=(Number.isFinite(me.avgMin)&&Number.isFinite(ot.avgMin))?me.avgMin-ot.avgMin:null;
  const diffText=diff===null?'比較できる実績がありません'
   :(Math.abs(diff)<0.5?'他設備とほぼ同じ'
     :`他設備より${WL.duration.text(Math.abs(diff))}${diff<0?'速い':'遅い'}`);
  const perDay=me.count/days;
  if(kpi)kpi.innerHTML=[
   ['完了ロット',`${me.count}件`,`直近${days}日`],
   ['合計作業時間',WL.duration.text(me.sumMin),`実測できた${me.measured}件ぶん`],
   ['平均作業時間',WL.duration.text(me.avgMin),diffText],
   ['1日あたり',`${perDay.toFixed(1)}件`,`直近${days}日の平均`],
  // 稼働状況ビューと同じ視覚語彙(.db-card)を使う。新しいクラスを作ると
  // 同じ意味の要素が2種類の見た目になる(統一の逆行)。
  ].map(([k,v,sub])=>`<div class="db-card"><span class="db-card-label">${esc(k)}</span>`
    +`<b class="db-card-value">${esc(v)}</b><small class="db-card-note">${esc(sub)}</small></div>`).join('');

  /* 品種別・オペレータ別。件数の多い順に出す(自設備で何を多く流しているか
     が先に目に入る方が、現場の判断に近い)。 */
  const groupTable=(rows,keyOf,emptyText)=>{
   const map=new Map();
   rows.forEach(r=>{const k=keyOf(r)||'-';if(!map.has(k))map.set(k,[]);map.get(k).push(r)});
   const list=[...map.entries()].map(([k,v])=>({k,...statOf(v)}))
    .sort((a,b)=>b.count-a.count).slice(0,12);
   if(!list.length)return `<div class="db-empty">${esc(emptyText)}</div>`;
   return `<table class="db-table"><thead><tr><th>区分</th><th>件数</th><th>平均</th></tr></thead><tbody>`
    +list.map(x=>`<tr><td>${esc(x.k)}</td><td class="num">${x.count}</td>`
      +`<td class="num">${esc(WL.duration.text(x.avgMin))}</td></tr>`).join('')
    +`</tbody></table>`;
  };
  $id('dbEquipProduct').innerHTML=groupTable(mine,r=>r.productType,'この期間の完了実績がありません。');
  $id('dbEquipOperator').innerHTML=groupTable(mine,r=>r.operator,'この期間の完了実績がありません。');

  const recent=[...mine].sort((a,b)=>b.date-a.date).slice(0,15);
  $id('dbEquipRecent').innerHTML=recent.length
   ?`<table class="db-table"><thead><tr><th>日時</th><th>ロット</th><th>用途</th><th>作業時間</th></tr></thead><tbody>`
     +recent.map(r=>`<tr><td>${esc(r.date?r.date.toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'-')}</td>`
       +`<td>${esc(r.lotNo||'-')}</td><td>${esc(r.purposeName||'-')}</td>`
       +`<td class="num">${esc(WL.duration.text(r.durationMin))}</td></tr>`).join('')
     +`</tbody></table>`
   :'<div class="db-empty">この期間の完了実績がありません。</div>';
 }

 async function runDashboard(force){
  const panel=$id('dashboardPanel');if(!panel||panel.hidden)return;
  if(typeof WL.records.withWaiting!=='function')return runDashboardInner(force,()=>{});
  return WL.records.withWaiting({title:'分析データを集計しています',detail:'この端末の測定データを読み込んでいます',
   progress:'対象データを取得しています',step:1},report=>runDashboardInner(force,report));
 }
 async function runDashboardInner(force,report){
  const panel=$id('dashboardPanel');if(!panel||panel.hidden||dbView!=='pivot')return;
  const all=await ensureData(force);
  report({progress:'指標を計算してグラフを描画しています',step:2});
  const statusFilter=val('dbStatus')||'done';
  const startStr=val('dbStart'),endStr=val('dbEnd');
  const startD=startStr?new Date(startStr+'T00:00:00'):null;
  const endD=endStr?new Date(endStr+'T23:59:59'):null;
  let rows=all.filter(r=>statusFilter==='all'||r.status==='完了');
  rows=rows.filter(r=>{
   if(!r.date)return !startD&&!endD;
   if(startD&&r.date<startD)return false;
   if(endD&&r.date>endD)return false;
   return true;
  });
  const axis=val('dbAxis')||'equipment',bucket=(document.querySelector('[data-seg="dbBucketSeg"] button.active')||{}).dataset?.val||'day',series=val('dbSeries')||'',metricKey=val('dbMetric')||'avgMin';
  const data=aggregate(rows,{axis,bucket,series,metricKey});
  renderDashboard(data,{axis,bucket,series,metricKey},rows);
 }

 async function openDashboardView(){
  WL.enterView('dashboard');
  const panel=ensurePanel();panel.hidden=false;
  WL.syncViewToolbar('dashboard');   // 操作列(#dbHeadActions)はパネル生成後にヘッダーへ載せる
  // 自由集計側の初期条件は最初の1回だけ整えておく(タブを開いたときに
  // 条件未設定の空表示にならないようにする)。既定で見せるのは稼働状況(§9.64)。
  if(!panel.dataset.inited){
   panel.dataset.inited='1';
   const p=PRESETS.equipEfficiency;
   $id('dbAxis').value=p.axis;$id('dbSeries').value=p.series||'';$id('dbMetric').value=p.metric;
   const {a,b}=periodRange('thisMonth'),pad=n=>String(n).padStart(2,'0'),
         d=dt=>dt?`${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`:'';
   $id('dbStart').value=d(a);$id('dbEnd').value=d(b);setSeg('dbPeriodSeg','thisMonth');
   toggleBucket();
  }
  setDashboardView(dbView);
 }

 queueMicrotask(ensureNavButton);
})();

/* v36: 検査員・作業人数・内径・スプール・板厚測定器・板幅測定器は必須ではないが、
   「-」のまま未選択の間は背景色で目立たせ、何か選んだら白背景に戻す。 */
const SOFT_CHOICE_IDS=['inspector','crewSize','innerDiameter','spool','thicknessGauge','widthGauge'];
function updateSoftChoiceVisuals(){
 SOFT_CHOICE_IDS.forEach(id=>{
  const el=$('#'+id);if(!el)return;
  const chosen=el.value!==''&&el.value!=='-';
  el.classList.toggle('choice-pending',!chosen);
  el.classList.toggle('choice-made',chosen);
 });
}
SOFT_CHOICE_IDS.forEach(id=>{const el=$('#'+id);if(el)el.addEventListener('change',updateSoftChoiceVisuals)});
WL.measureHooks.afterRender(()=>{updateSoftChoiceVisuals();if(typeof WL.measureView.syncInputModeLock==='function')WL.measureView.syncInputModeLock()});
WL.measureHooks.on('afterOptionFill',()=>updateSoftChoiceVisuals());
