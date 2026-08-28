"use strict";
/* list-columns.js: 列の設定パネル(§9.88 段2-3 / §9.90で作り直し)
   ============================================================
   1つの列の設定は1箇所に集める。名前・幅・並び・表示・書式を別々の画面へ
   散らすと、利用者は毎回「これはどこで設定するんだったか」を思い出す
   ことになる——認知コストの最大の発生源はそこ。

   画面は2面:
     左  **列のリスト**(縦に並ぶ。1行=1列)。チェックで表示/非表示、
         つまみで並べ替え、右端に**その列の実データ1件がどう見えるか**
     右  選んだ1列の設定だけ(一度に見せる情報を絞る)

   §9.90で下段の横長プレビュー表をやめ、**例をリストの中へ入れた**。
   横長の表は「1行ぶんの見え方」を確かめるには向くが、37列あると端が
   見えず、並べ替えの操作(縦のリスト)と結果(横の表)が別の場所に出るため
   視線が往復する。1行=1列で「名前・出す/出さない・見え方」が同じ行に
   並んでいれば、その行だけを見て判断できる。**例は1件でよい**——
   書式や読み替えが効いているかは1件見れば分かる。

   触った結果は**そのまま後ろの一覧へ即反映**する(WL.columnLayout.stage)。
   設定画面の中の見本で想像させるより、本物の一覧が変わるほうが速く確実。
   保存は別操作で、閉じるときに保存していなければ元へ戻す。

   計算列・ボタン列(#・分割・測定・予定)も同じ一覧に並べる。利用者から
   見れば同じ「列」で、別扱いする理由が無い。ただし値を持たないので、
   右ペインは幅と表示名だけになる。
   ============================================================ */
(function(){
 const PANEL_ID='listColumnPanel';
 /* **開いた時点の写し(`original`)は持たない**(§9.212 ③)——戻すのは
    `WL.columnLayout.discard()`の役目で、控えを2箇所に持つと必ず食い違う
    （保存済みの幅まで巻き戻す／未保存の下書きまで保存する、を両方やった）。 */
 let target='',draft=null,picked='';

 /* 値を持たない列(行番号・ボタン)。並びと幅と名前は変えられるが、
    書式や読み替えは持たない。 */
 const LIST_VIRTUAL={
  '#':{label:'#（行番号）',note:'行の番号'},
  '__split__':{label:'分割',note:'分割の有無'},
  '__measure__':{label:'測定',note:'測定画面を開くボタン'},
  '__plan__':{label:'予定',note:'スケジュールへ追加するボタン'},
  '__select__':{label:'選択',note:'まとめて選ぶチェックボックス'},
 };

 /* ---------- 差し替え口(§9.120) ----------
    このパネルが**画面を触る口はここだけ**にしてある。既定は仕掛一覧で、
    `open(source)`へ別の口を渡すと、同じパネルを別の対象へ使える
    （作業スケジュールの「内容」欄がそれ。設定画面を2つ作らない）。

    **仕掛一覧の側は既定の口をそのまま使う**ので、動きは1つも変わらない
    ——汎用化のために既存の画面が変わるなら、それは作り直しであって
    流用ではない。 */
 const LIST_SOURCE={
  key:'list',
  /* **どの表の設定かを名前に出す**(§9.176)。同じパネルを仕掛一覧・データ
     一覧・スケジュール表で使い回すので、「表示列の設定」だけでは開いた
     本人にも分からない（実機で「今開いているモーダルがどの表のものか
     分からない」と報告された）。 */
  title:()=>{
   const db=(typeof S!=='undefined'&&S.db)||'',tb=(typeof S!=='undefined'&&S.table)||'';
   return (db||tb)?`表示列の設定（仕掛一覧：${db||'-'} / ${tb||'-'}）`:'表示列の設定（仕掛一覧）';
  },
  target:()=>typeof listLayoutTarget==='function'?listLayoutTarget():'',
  /* 候補の全列。**並びの出どころは一覧側と同じ1本**(§9.106)——ここで
     別に組み立てると、設定画面で動かした並びが一覧に出ない。 */
  keys:()=>{
   if(typeof WL.listColumnKeys!=='function'){
    console.error('列の設定パネル: WL.listColumnKeys が見つかりません');
    return [...(S.columns||[])];
   }
   return WL.listColumnKeys();
  },
  /* 覚えている並びの直し方。一覧と同じ関数を通す(§9.110)。 */
  healed:t=>typeof WL.healedColumnOrder==='function'?WL.healedColumnOrder(t):null,
  rows:()=>S.rows||[],
  valueOf:(row,k)=>row?row[k]:undefined,
  /* 式へ渡す1行。**既定は行そのまま**（一覧の行は`{列名:値}`なので、
     `[列名]`がそのまま当たる）。スケジュール表のように行が生の
     `{列名:値}`でない画面だけ、口が組み立て直す（§9.207）。 */
  formulaRowOf:null,
  /* 読み替えが見る1行。**既定は行そのまま**（一覧の行は`{列名:値}`）。
     スケジュール表のように行が生の`{列名:値}`でない画面だけ、口が
     組み立て直す（§9.234 ⑥）。**見本と実際の表が同じ行を見る**ことが
     要件——別の行で評価すると「設定画面では当たるのに表では空」になる。 */
  ruleRowOf:null,
  virtual:()=>LIST_VIRTUAL,
  /* 結合されてきた列の名前は**サーバーが返す**(§9.105)。列名から
     見分ける手がかりは無いので、画面側で推測しない。 */
  joined:()=>new Set(Array.isArray(S.joinQuality&&S.joinQuality.addedColumnNames)
                      ?S.joinQuality.addedColumnNames:[]),
  /* 結合は1件とは限らない(§9.193)。**名前で言う**——「別のデータソース」
     では、どの結合で来た列なのかが分からない。 */
  joinFrom:()=>{const info=S.joinQuality||{};
                const names=(info.names||[]).filter(Boolean);
                if(names.length)return names.join('・');
                return info.table?`別のデータソース（${info.table}）`:'別のデータソース'},
  /* 使う分類(§9.105)。内容欄のように1つしか無い対象では減らす
     ——「結合0 / 計算・操作0」が並んでも、覚える手間が増えるだけ。 */
  origins:()=>ORIGIN_ORDER,
  /* sort=並べ替えの決まり(§9.187)を出すか。**並べるのはサーバー**なので、
     サーバーで並べていない一覧（タイムライン・データ一覧）では出さない
     ——設定できるのに効かないのが一番悪い。 */
  features:{formula:true,preset:true,width:true,format:true,rule:true,sort:true},
  afterApply:()=>{if(typeof renderGrid==='function')renderGrid()},
  /* 並べ替えの決まりを変えたら、**その列で並べているときだけ**取り直す
     (並びはサーバーが決めるので、描き直しでは変わらない)。 */
  resort:col=>{
   if(!WL.listSort||typeof load!=='function')return;
   /* 問い合わせに決まりが入るので、素の`load()`で取り直せる(§9.187)。 */
   if((WL.listSort.keys()||[]).some(k=>k.column===col))load();
  },
  save:null,        // null=列レイアウトマスタへそのまま保存する
 };
 /* **`src`という名前は使わない**——式の編集が`const src=…`(式の文字列)を
    既に使っており、その関数の中では差し替え口が文字列に隠れて
    `panel.rows is not a function`になる(実際に踏んだ)。 */
 let panelSrc=LIST_SOURCE;
 /* ---------- まとめて動かすための複数選択(§9.177) ----------
    列を1本ずつ動かすのは、5本まとめて先頭へ寄せたいときに同じ操作を5回
    することになる。**選んでからまとめてドラッグ**できるようにする
    (仕掛一覧のまとめて投入・スケジュールのまとめて外すと同じ考え方)。
    右ペインに出す1列(`picked`)とは別に持つ——見え方を整える相手は常に
    1列で、まとめて動かす相手は複数、と役割が違う。 */
 const marked=new Set();
 const isVirtual=k=>Object.prototype.hasOwnProperty.call(panelSrc.virtual(),k);
 /* 幅の3つの状態(§9.119)。**「自動か手動か」を暗黙にしない**——以前は
    数値欄が空かどうかで決まっており、画面のどこにも書いていなかったため、
    一度触った列が二度と自動へ戻らない(戻し方が分からない)状態だった。 */
 const widthModeOf=k=>draft.locks.has(k)?'locked':(draft.widths[k]?'manual':'auto');
 const WIDTH_MODE_NOTE={
  auto:'見出しと実データの先頭40行から幅を決め直します。',
  manual:'入れた幅にします。入り切らない文字は「…」で切り、元の値はマウスを乗せると出ます。',
  locked:'幅を動かしません。見出しの右端の取っ手も掴めなくなります。',
 };
 /* 表示名 → **口が知っている元の呼び名** → キー、の順に落とす(§9.120)。
    内容欄の項目は`lotNo`/`purposeName`のようなalias名なので、キーをそのまま
    出すと選んだ本人以外には何の項目か分からない。仕掛一覧の列名は元から
    日本語なので、既定の口は`labelOf`を持たない(＝今までどおりキーが出る)。 */
 const srcLabel=k=>{
  if(typeof panelSrc.labelOf!=='function')return '';
  const s=panelSrc.labelOf(k);
  return (s&&s!==k)?String(s):'';
 };
 const labelOf=k=>isVirtual(k)?panelSrc.virtual()[k].label:(draft.names[k]||srcLabel(k)||k);
 /* 値の出どころ・作り方の一言(§9.162)。**同じ「コース」でも、どの列から
    落として出しているかで当たる見込みが違う**ので、口が知っているなら
    書く。答えない口では今までどおり出ない。 */
 const srcNote=k=>{
  if(typeof panelSrc.noteOf!=='function')return '';
  return String(panelSrc.noteOf(k)||'');
 };

 /* ---------- 出どころの分類(§9.105) ----------
    利用者が列を前にして最初に思うのは「この項目はどこから来たのか」
    (元のデータにある項目なのか / このアプリが足した列なのか /
    別のテーブルから結合されてきたのか)。同じ「列」でも出どころが違えば
    できることも意味も違う——結合列は元データを直しても変わらないし、
    計算列は値を持たないので書式が無い。**分類が見えていないと、
    利用者はそれを一つずつ試して覚えるしかない。**
    3つだけにする(増やすと色の意味を覚える手間のほうが大きくなる)。 */
 const ORIGIN={
  source:{label:'元データ',short:'元',
          note:'読み込んだデータがそのまま持っている項目です。'},
  join:  {label:'結合',short:'結',
          note:'別のデータソースから、キーが一致した行に足された項目です。'},
  calc:  {label:'計算・操作',short:'計',
          note:'このアプリが足した列です。番号やボタン、式で作った列が入ります。'},
 };
 const ORIGIN_ORDER=['source','join','calc'];
 /* 結合されてきた列の名前はサーバーが返す(`joinQuality.addedColumnNames`)。
    **画面側で推測しないこと**——どのデータソースをどのキーで結合したかを
    知っているのはサーバーだけで、列名から見分ける手がかりは無い。 */
 function joinedKeys(){return panelSrc.joined()}
 let joined=new Set();
 /* 式で作った列(§9.111 ⑦)も「計算・操作」。元データにも結合にも属さない。
    **キーの有無で見る**——作った直後は式が空文字なので、値の真偽で
    見ると「作ったのに編集欄が出ない」ことになる(実際にそうなった)。 */
 const isFormulaCol=k=>!!draft&&!!draft.formulas
   &&Object.prototype.hasOwnProperty.call(draft.formulas,k);
 /* **分類を口が答えてもよい**(§9.162)。仕掛一覧は「元データか結合か」で
    足りるが、測定データの一覧のように**この画面が作っている列**(状態・
    実作業時間)が混ざる対象では、値を持つ列でも「計算・操作」が正しい。
    答えない口は今までどおり(番号・ボタン・式だけが計算・操作)。 */
 function originOf(k){
  if(isVirtual(k)||isFormulaCol(k))return 'calc';
  if(typeof panelSrc.originOf==='function'){
   const o=panelSrc.originOf(k);
   if(o&&ORIGIN[o])return o;
  }
  return joined.has(k)?'join':'source';
 }
 /* 結合元のデータソース名。分類の説明に添える(「どこから」まで言う)。 */
 function joinFrom(){return panelSrc.joinFrom()}
 /* 読み替えルールの編集を開く。閉じたら、作った(or 消した)結果を
    この列の選択へ反映する——「作ったのに選ばれていない」を無くすため。 */
 function editRule(name){
  if(typeof WL.listRules?.open!=='function'){
   console.error('列の設定パネル: WL.listRules が見つかりません');return;
  }
  /* **いま設定している表の口を渡す**（§9.234 ⑥）——渡さないと「他の列」の
     候補も「試してみる」も仕掛一覧のままで、書いた本人が確かめられない。 */
  WL.listRules.open({name,column:picked,source:panelSrc,onDone:saved=>{
   if(saved)draft.rules[picked]=saved;else delete draft.rules[picked];
   renderDetail();renderList();renderPreview();
  }});
 }
 /* 一覧の「書」バッジの説明。何の書式が効いているかを一言で。 */
 function fmtNote(f){
  if(!f)return '';
  if(f.kind==='number')return '数値'+(f.decimals!=null?`（小数${f.decimals}桁）`:'')
   +(f.thousands?'・3桁区切り':'')+(f.prefix||f.suffix?`・単位${f.prefix||''}〜${f.suffix||''}`:'');
  if(f.kind==='datetime')return '日付・時刻（'+(f.pattern||'yyyy/MM/dd')+'）';
  if(f.kind==='text')return '文字（前後の空白を落とす）';
  return '書式を設定しています';
 }

 function ensurePanel(){
  let el=document.getElementById(PANEL_ID);
  if(el)return el;
  el=document.createElement('div');
  el.className='sc-float-win';el.id=PANEL_ID;el.hidden=true;
  el.innerHTML=`
   <div class="sc-float-header lc-header">
    <div class="lc-title">
     <small class="lc-eyebrow" id="lcEyebrow">一覧の見せ方</small>
     <h2 id="lcTitle">列の設定</h2>
    </div>
    <p class="lc-lead" id="lcLead">左で<b>出す列と並び</b>を決め、右で<b>選んだ1列の見え方</b>を整えます。
     触った結果はすぐ後ろの一覧に出ます（<b>保存するまでは元に戻せます</b>）。</p>
    <!-- この一覧の列を「みんなと同じ」で持つか「自分だけ」で持つか(§9.259)。
         **いまどちらかを必ず文字で出す**(§3)——黙って個人の並びを出すと、
         自分にだけ違って見える理由が画面のどこにも無くなる。 -->
    <div class="lc-scope" id="lcScope" hidden>
     <span class="lc-scope-now" id="lcScopeNow"></span>
     <button type="button" id="lcScopeBtn" class="lc-side-btn"></button>
     <small class="lc-scope-note" id="lcScopeNote"></small>
    </div>
    <button type="button" id="lcClose" class="lc-close" title="閉じる（保存していない変更は元に戻ります）">×</button></div>
   <div class="sc-float-body lc-body">
    <div class="lc-side">
     <div class="lc-side-head">
      <input type="search" id="lcFilter" class="lc-filter" placeholder="列名で絞り込み" autocomplete="off">
      <button type="button" id="lcAddCol" class="lc-side-btn"
       title="いまある列から式で新しい列を作ります（元の列が無くても足せます）">＋ 列を作る</button>
      <button type="button" id="lcAutoFit" class="lc-side-btn"
       title="列の幅を、見出しと実データの長さに合わせて決め直します（手で決めた幅は消えます）">幅を内容に合わせる</button>
     </div>
     <div class="lc-origins" id="lcOrigins" role="group" aria-label="出どころで絞り込む"></div>
     <!-- 「出す」の見出しに全選択チェックを置く(§9.106)。**押す場所と効く
          場所を同じ列に置く**——離れたボタンだと、どの列に効くのかを
          読んで確かめる必要がある。効くのは絞り込んで見えている列だけ。 -->
     <div class="lc-list-head">
      <label class="lc-vis lc-vis-all" title="いま見えている列をまとめて出す/隠す">
       <input type="checkbox" id="lcAllVis"></label>
      <span title="行のどこを掴んでも並べ替えられます。Ctrl（⌘）クリックで1つずつ、Shiftクリックで範囲を選ぶと、選んだぶんをまとめて動かせます。">列（上下にドラッグで並べ替え・Ctrl/Shiftクリックでまとめて選ぶ）</span>
      <span>この列の見え方（実データ1件）</span></div>
     <div class="lc-list" id="lcList"></div>
    </div>
    <div class="lc-detail" id="lcDetail"></div>
   </div>
   <!-- 名前を付けて覚えさせる(§9.111)。**マスタへ置くので他のPCからも
        呼び出せる**——これが要望の主目的。ファイルへの書き出し/読み込みは
        その場のバックアップと持ち出し用で、同じ中身をそのまま扱う。 -->
   <div class="lc-presets">
    <label class="lc-preset-pick">
     <span>保存した設定</span>
     <select id="lcPresetSel"><option value="">（選ぶと読み込みます）</option></select>
    </label>
    <button type="button" id="lcPresetSave" class="lc-side-btn"
     title="今の設定に名前を付けてマスタへ登録します（他のPCからも読み出せます）">名前を付けて登録</button>
    <button type="button" id="lcPresetDel" class="lc-side-btn" disabled
     title="選んでいる設定をマスタから削除します">削除</button>
    <span class="lc-preset-sep"></span>
    <button type="button" id="lcExport" class="lc-side-btn"
     title="列の設定をファイル(JSON)に書き出します。この一覧だけ／すべての一覧を選べます">書き出し…</button>
    <button type="button" id="lcImport" class="lc-side-btn"
     title="書き出したファイル(JSON)から列の設定を取り込みます">読み込み…</button>
    <input type="file" id="lcImportFile" accept="application/json,.json" hidden>
   </div>
   <!-- 列の設定の持ち出し・取り込み(§9.178)。**このパネルの中に置く**
        ——モーダルを増やさず、実物の一覧を見たまま「何が出て行くのか」を
        確かめられるのが値打ち(フィルタの入出力・§9.171と同じ作法)。 -->
   <div class="lc-io" id="lcIo" hidden>
    <div class="lc-io-head">
     <b id="lcIoTitle">列の設定を書き出す</b>
     <button type="button" id="lcIoClose" class="lc-side-btn" title="閉じる">×</button>
    </div>
    <div class="lc-io-body" id="lcIoBody"></div>
    <div class="lc-io-foot">
     <span class="lc-io-note" id="lcIoNote"></span>
     <button type="button" id="lcIoRun" class="lc-btn-primary">実行</button>
    </div>
   </div>
   <div class="sc-float-foot lc-foot">
    <span class="lc-count" id="lcCount"></span>
    <span class="lc-foot-note" id="lcFootNote"></span>
    <div class="sc-content-foot-actions">
     <button type="button" id="lcReset" class="lc-btn-ghost">既定に戻す</button>
     <button type="button" id="lcSave" class="sc-column-save lc-btn-primary">保存</button>
    </div>
   </div>
   <div class="sc-float-resize" title="ドラッグで大きさを変えられます"></div>`;
  document.body.appendChild(el);
  el.querySelector('#lcClose').onclick=close;
  el.querySelector('#lcSave').onclick=save;
  el.querySelector('#lcReset').onclick=reset;
  el.querySelector('#lcPresetSel').onchange=e=>applyPreset(e.target.value);
  el.querySelector('#lcPresetSave').onclick=savePreset;
  el.querySelector('#lcPresetDel').onclick=deletePreset;
  el.querySelector('#lcExport').onclick=()=>openIo('export');
  el.querySelector('#lcImport').onclick=()=>openIo('import');
  el.querySelector('#lcImportFile').onchange=pickIoFile;
  el.querySelector('#lcIoClose').onclick=closeIo;
  el.querySelector('#lcIoRun').onclick=runIo;
  el.querySelector('#lcFilter').addEventListener('input',()=>{renderOrigins();renderList()});
  /* まとめて出す/隠すは**いま絞り込んで見えている列だけ**に効かせる。
     見えていない列まで動くと、何が起きたのか画面から分からない。 */
  el.querySelector('#lcAllVis').addEventListener('click',e=>{
   /* **`click`で受ける**(§9.90と同じ理由)。`change`はリストを作り直した
      後に飛ぶので反映されない。 */
   setAllVisible(e.currentTarget.checked);
  });
  el.querySelector('#lcAutoFit').onclick=autoFitWidths;
  el.querySelector('#lcAddCol').onclick=addFormulaColumn;
  /* 位置と大きさは共通のフローティングウィンドウに任せる(§9.16)。
     **これが効かないとパネルは画面外へ開く**(幅も高さも与えられず、
     中身の実データの列数だけ横に伸びる)ので、無ければ気づけるようにする。
     §9.90で既定を広げた(880×620→1180×760)。列が37本ある一覧で
     11本しか見えず、下段のプレビュー表が場所を取っていたため。
     §9.105で更に広げた(1180×760→1440×820)——右ペインを「この列の素性・
     見せ方・整え方・読み替え・プレビュー」の5段に組み直したので、
     左のリストと右の設定が両方とも詰まらない幅が要る。
     §9.111で高さを足した(820→880)——保存した設定の帯を1段増やしたぶん、
     同じ高さのままだと足元の「保存」が画面の外へ出る(実測で切れていた)。
     **保存キーも変える**——既に小さい値を覚えている端末があるので、
     同じキーのままだと新しい既定が誰にも見えない。 */
  if(typeof WL.makeFloatingWindow==='function')
   WL.makeFloatingWindow(el,{storageKey:'listColumnPanelRectV5',defaultWidth:1440,defaultHeight:880,
                             defaultTop:40,minWidth:860,minHeight:560});
  else console.error('列の設定パネル: WL.makeFloatingWindow が見つかりません');
  return el;
 }

 /* 今の一覧の全列(番号・ボタンを含む)。表示中かどうかに関わらず並べる。
    **並びの出どころは一覧側と同じ1本**(§9.106)——ここで別に組み立てると、
    設定画面で動かした並びが一覧に出ない(実際にそうなっていた)。 */
 function allKeys(){return panelSrc.keys()}

 function loadDraft(){
  const l=WL.columnLayout.get(target);
  const keys=allKeys();
  const known=(l.order||[]).filter(k=>keys.includes(k));
  /* **一覧と同じ直し方を通す**(§9.110)。番号・ボタンの列が入っていない
     古い並びは、一覧側が本来の位置へ戻して描く。ここで素直に末尾へ
     並べると、パネルと一覧の並びが食い違って見える(§9.106で1本に
     したものを、直し方の違いで2本に戻してしまう)。
     非表示の列もパネルには出す(チェックの外れた行として)ので、
     **非表示を落とさない`healedColumnOrder`のほう**を借りる。 */
  const order=panelSrc.healed(target)||[...known,...keys.filter(k=>!known.includes(k))];
  draft={
   order,
   /* **「出す/出さない」の出どころが別のこともある**(§9.120)。内容欄は
      スケジュール内容表示マスタが持つので、差し替え口が答える。
      指定が無ければ従来どおり列レイアウトマスタのhidden。 */
   hidden:new Set((typeof panelSrc.initialHidden==='function'
                    ? panelSrc.initialHidden(keys,l)
                    : (l.hidden||[])).filter(k=>keys.includes(k))),
   widths:{...(l.widths||{})},
   names:{...(l.names||{})},
   formats:JSON.parse(JSON.stringify(l.formats||{})),
   rules:{...(l.rules||{})},
   formulas:{...(l.formulas||{})},
   locks:new Set((l.locks||[]).filter(k=>keys.includes(k))),
   /* 並べ替えの決まり(§9.187)。列ごとに1つ。 */
   sorts:JSON.parse(JSON.stringify(l.sorts||{})),
   /* 揃え(§9.239 ④)。値と見出しを**別々に**持つ。 */
   aligns:JSON.parse(JSON.stringify(l.aligns||{})),
  };
  if(!picked||!draft.order.includes(picked))picked=draft.order.find(k=>!isVirtual(k))||draft.order[0]||'';
 }

 /* 読み替えが見る行は**口が答える**（§9.234 ⑥）。答えない口は行そのまま。 */
 function ruleRow(row){return panelSrc.ruleRowOf?panelSrc.ruleRowOf(row):row}
 /* この列の実データ1件が、今の設定でどう見えるか。書式・読み替えを
    通した結果をそのまま出す(一覧のセルと同じ関数)。 */
 function sampleCell(k){
  if(isVirtual(k))return {text:'（ボタン）',color:'',raw:''};
  const raw=sampleValue(k);
  /* **値が空でも、読み替えが付いていれば通す**（§9.234 ⑥）——「他の列だけを
     見るルール」は自分の列に値が無くても中身を作れるので、ここで早く
     引き返すと**読み替えだけの列は設定画面で一度も結果が見えない**。 */
  if(raw===''&&!draft.rules[k])return {text:'',color:'',raw:''};
  const src=raw===''?panelSrc.rows()[0]
    :panelSrc.rows().find(r=>String(panelSrc.valueOf(r,k)??'')===String(raw));
  const out=WL.cellFormat.cell({raw,format:draft.formats[k]||null,rule:draft.rules[k]||'',
                                row:ruleRow(src),column:k});
  return {text:out.text,color:out.color,raw:String(raw)};
 }

 /* いま絞り込みに残っている列。分類チップ・まとめて操作・リストが
    **同じ答え**を使う(別々に数えると画面の中で数が食い違う)。 */
 let originFilter='';
 /* ---------- 「表示中／非表示中」で絞る（§9.248 ④、利用者の指示） ----------
    「列のカスタム機能の中の表示する列のフィルタ機能について、バッジを使って
     フィルタする機能がありますが、『表示中の列』と『非表示中の列』という
     バッジを追加してほしいです。」

    **出どころとは別の軸**なので、同じ帯の中で群を分けて置き、
    **かけ合わせ（AND）で効かせる**——1つの群にまとめると「結合」と
    「非表示中」が排他になり、「結合された列のうち隠しているものだけ」を
    見る、という**いちばん使いたい形**が作れない。
    件数は**相手の軸を効かせたまま**数える（そうしないと、絞り込んだあとに
    出る数と実際に並ぶ行数が食い違う）。 */
 let stateFilter='';                   /* ''＝すべて／'on'＝表示中／'off'＝非表示中 */
 function shownKeys(ignoreOrigin,ignoreState){
  const q=String(document.getElementById('lcFilter')?.value||'').trim().toLowerCase();
  return draft.order.filter(k=>{
   if(q&&!labelOf(k).toLowerCase().includes(q)&&!k.toLowerCase().includes(q))return false;
   if(!ignoreOrigin&&originFilter&&originOf(k)!==originFilter)return false;
   if(!ignoreState&&stateFilter&&(stateFilter==='off')!==draft.hidden.has(k))return false;
   return true;
  });
 }
 function setAllVisible(on){
  shownKeys().forEach(k=>{if(on)draft.hidden.delete(k);else draft.hidden.add(k)});
  renderPreview();renderOrigins();renderList();
 }
 /* 「出す」の見出しのチェックは3状態(全部出す/全部隠す/一部)。
    **一部のときは中間表示**にする——チェックが外れて見えると
    「全部隠れている」と読めてしまう。 */
 function syncAllVisible(){
  const box=document.getElementById('lcAllVis');if(!box)return;
  const rows=shownKeys(),on=rows.filter(k=>!draft.hidden.has(k)).length;
  box.checked=rows.length>0&&on===rows.length;
  box.indeterminate=on>0&&on<rows.length;
  box.disabled=rows.length===0;
 }
 /* ---------- 幅を内容に合わせる(§9.106) ----------
    手で決めた幅を捨てて、見積りへ戻す。見積りは**見出しと実データ**から
    決まる(list-view.jsのestimateColumnWidth)ので、これだけで「1列だけ
    やたら広い」状態は消える。**取り消せるように**、外した幅は保存を
    押すまで元へ戻せる(このパネルの他の操作と同じ)。 */
 function autoFitWidths(){
  const keys=shownKeys();
  let n=0;
  keys.forEach(k=>{if(draft.widths[k]!=null){delete draft.widths[k];n++}});
  renderPreview();renderDetail();
  const note=document.getElementById('lcFootNote');
  if(note)note.textContent=n?`${n}列の幅を内容に合わせました（保存するまでは元に戻せます）`
                            :'すべての列がすでに内容に合わせた幅です';
 }
 /* 出どころの絞り込み。**件数を必ず出す**——「結合された列がそもそも
    あるのか」は数が出ていて初めて分かる(0件なら押しても意味が無いので
    押せなくする)。 */
 /* ---------- 列の見せ方は「みんなと同じ／自分だけ」(§9.259、利用者の指示) ----------
    「列の表示の部分については、こだわりが強い人もいるので、表示する一覧表毎に
     共通のものを使うか、個別ID単位のものを使うか選べるように」。

    **持ち主を決めるのはサーバーの1箇所**(`column_layout_owner`)で、画面は
    受け取った答えを出して切り替えを頼むだけ。ここで画面が独自に判断すると、
    「見えているのは自分の並びなのに保存は共通へ行く」が作れる。 */
 const scopeAsked=new Set();
 function renderScope(){
  const box=document.getElementById('lcScope');if(!box)return;
  const now=document.getElementById('lcScopeNow'),btn=document.getElementById('lcScopeBtn'),
        note=document.getElementById('lcScopeNote');
  /* `target`はこのモジュールが持つ「いま開いている対象」。 */
  /* この口が個人設定を扱えるかは**差し替え口が答える**(§9.120)。
     答えない口は今までどおり＝みんなと同じ設定だけ。 */
  const allow=!(panelSrc.features&&panelSrc.features.personalScope===false);
  box.hidden=!(target&&allow);
  if(box.hidden)return;
  let scope=WL.columnLayout.scope(target);
  /* まだ一度も読んでいなければ、読んでから描き直す。**パネルは一覧より先に
     開きうる**し、利用者IDは`/api/whoami`から後から届く(§9.184)ので、
     「読む前だから分からない」を「みんなと同じ」と言い切らない。
     1対象につき1回だけ頼む（読めなかったときに回り続けないように）。 */
  if(!scope&&!scopeAsked.has(target)){
   scopeAsked.add(target);
   WL.columnLayout.load(target).then(()=>renderScope()).catch(()=>{});
  }
  scope=WL.columnLayout.scope(target);
  const mine=scope==='personal';
  const can=WL.columnLayout.personalizable();
  now.textContent=mine?'自分だけの設定':'みんなと同じ設定';
  now.className='lc-scope-now'+(mine?' is-mine':'');
  btn.textContent=mine?'みんなと同じに戻す':'自分だけの設定にする';
  /* **できないことは、できないと書く**(§4)。利用者IDが分からない端末では
     自分だけの設定を持てない——押せるボタンを残すと壊れて見える。 */
  btn.disabled=!can&&!mine;
  if(!can&&!mine){
   note.textContent='この端末では利用者IDが分からないため、自分だけの設定は持てません。';
  }else if(mine){
   note.textContent='この一覧の列は、あなたにだけこう見えています。他の人の見え方は変わりません。';
  }else{
   note.textContent='この一覧の列は、いま全員で同じものを使っています。変えると全員に効きます。';
  }
  btn.title=mine
   ?'みんなと同じ設定に戻します（自分だけの設定は消さないので、いつでも戻せます）'
   :'いまの見え方をそのまま写して、この一覧だけ自分専用の設定にします（他の人の見え方は変わりません）';
  btn.onclick=async()=>{
   const to=!mine;
   if(mine&&!confirm('この一覧の列を、みんなと同じ設定に戻します。\n\n'
                     +'自分だけの設定は消さないので、あとで戻せます。よろしいですか？'))return;
   btn.disabled=true;
   try{
    const r=await WL.columnLayout.setScope(target,to);
    /* **触った結果をそのまま一覧へ出す**(§9.90)。切り替えは保存そのものなので
       下書きは持たず、開き直した形にそろえる。 */
    loadDraft();renderScope();renderOrigins();renderList();renderDetail();
    if(typeof panelSrc.afterScope==='function')panelSrc.afterScope(target);
    showToast&&showToast(to?'自分だけの設定にしました':'みんなと同じ設定に戻しました',
                         (r&&r.message)||'',5200);
   }catch(e){
    showToast&&showToast('切り替えられませんでした',e.message,7000);
    renderScope();
   }
  };
 }
 function renderOrigins(){
  const box=document.getElementById('lcOrigins');if(!box)return;
  /* 出どころの件数は**状態の絞り込みを効かせたまま**数える（逆も同じ）。 */
  const pool=shownKeys(true,false);
  const spool=shownKeys(false,true);
  const n=o=>pool.filter(k=>originOf(k)===o).length;
  const chip=(o,label,count,note)=>
   `<button type="button" class="lc-origin-chip lc-origin-${o}${originFilter===o?' is-on':''}"
     data-origin="${o}"${count?'':' disabled'} title="${esc(note)}"
     aria-pressed="${originFilter===o?'true':'false'}">${esc(label)}<b>${count}</b></button>`;
  /* 状態の札（§9.248 ④）。**出どころとは別の群**として仕切りで分ける
     ——同じ並びに混ぜると、押したときに何が外れるのか読めない。 */
  const on=spool.filter(k=>!draft.hidden.has(k)).length;
  const off=spool.length-on;
  const st=(v,label,count,note)=>
   `<button type="button" class="lc-origin-chip lc-state-chip lc-state-${v||'all'}${stateFilter===v?' is-on':''}"
     data-state="${v}"${count||!v?'':' disabled'} title="${esc(note)}"
     aria-pressed="${stateFilter===v?'true':'false'}">${esc(label)}<b>${count}</b></button>`;
  box.innerHTML=
   `<button type="button" class="lc-origin-chip lc-origin-all${originFilter?'':' is-on'}" data-origin=""
     aria-pressed="${originFilter?'false':'true'}" title="すべての列">すべて<b>${pool.length}</b></button>`
   +(panelSrc.origins?panelSrc.origins():ORIGIN_ORDER).map(o=>chip(o,ORIGIN[o].label,n(o),
       o==='join'?`${ORIGIN[o].note}（${joinFrom()}）`:ORIGIN[o].note)).join('')
   +`<i class="lc-chip-sep" aria-hidden="true"></i>`
   +st('on','表示中',on,'一覧に出している列だけを並べます（出どころの絞り込みと重ねて効きます）')
   +st('off','非表示中',off,'一覧に出していない列だけを並べます。戻したい列を探すときに使います');
  box.querySelectorAll('.lc-origin-chip').forEach(b=>{
   b.onclick=()=>{
    if(b.dataset.state!==undefined){
     /* **同じ札をもう一度押したら外す**——「すべて」を探させない（§2）。 */
     stateFilter=(stateFilter===b.dataset.state)?'':b.dataset.state;
    }else originFilter=b.dataset.origin||'';
    renderOrigins();renderList();
   };
  });
 }
 function renderList(){
  const box=document.getElementById('lcList');if(!box)return;
  const rows=shownKeys();
  box.innerHTML=rows.map(k=>{
   const s=sampleCell(k);
   const changed=s.raw&&s.raw!==s.text;
   const o=originOf(k);
   return `
   <div class="lc-item${k===picked?' is-picked':''}${marked.has(k)?' is-marked':''}${draft.hidden.has(k)?' is-off':''}" data-key="${esc(k)}" data-origin="${o}">
    <label class="lc-vis" title="一覧に出すかどうか">
     <input type="checkbox" ${draft.hidden.has(k)?'':'checked'}></label>
    <span class="lc-grip" title="上下にドラッグして並べ替え">⠿</span>
    <span class="lc-name" title="${esc(k)}"><i class="lc-dot lc-origin-${o}" aria-hidden="true"
      title="${esc(ORIGIN[o].label)}"></i>${esc(labelOf(k))}</span>
    <span class="lc-marks">${draft.names[k]?'<i class="lc-mark" title="表示名を変えています">名</i>':''}${
      draft.formats[k]?`<i class="lc-mark" title="${esc(fmtNote(draft.formats[k]))}">書</i>`:''}${
      draft.rules[k]?`<i class="lc-mark" title="読み替え: ${esc(draft.rules[k])}">替</i>`:''}</span>
    <span class="lc-eg">${changed?`<s>${esc(s.raw)}</s>`:''}<b class="${s.color?'cell-'+s.color:''}">${
      esc(s.text)||'<i class="lc-eg-none">（値のある行がありません）</i>'}</b></span>
   </div>`}).join('')||'<div class="sc-empty-note">該当する列がありません</div>';
  box.querySelectorAll('.lc-item').forEach(el=>{
   const k=el.dataset.key;
   /* **チェックは click で受ける。** change は click の後(=行の
      クリックで作り直した後)に飛ぶため、以前は反映されなかった
      ——外しても一覧に残る、という不具合として出ていた(実測で確認)。
      ここで止めておけば行のクリック(=列を選ぶ)とも衝突しない。 */
   el.querySelector('.lc-vis').addEventListener('click',e=>{
    e.stopPropagation();
    const on=el.querySelector('input').checked;   // clickの時点で反転済み
    if(on)draft.hidden.delete(k);else draft.hidden.add(k);
    el.classList.toggle('is-off',!on);
    /* 見出しの全選択チェックも合わせる(§9.106)。ここで合わせ忘れると、
       1つ外しても「全部出ている」ままに見える。**リストは作り直さない**
       ——作り直すと今掴んでいる行が入れ替わる。 */
    /* **札の件数も合わせる**（§9.248 ④）——「表示中 12／非表示中 3」は
       チェックを1つ触るたびに動く。ここで合わせ忘れると、画面の数と
       実際に並ぶ行数が食い違う（§CLAUDE 8）。
       **リストは作り直さない**——掴んでいる行が入れ替わる。 */
    renderCount();syncAllVisible();renderOrigins();applyLive();
   });
   /* **選ぶのは click。** mouseup で選ぶ作りにすると、`el.click()` のような
      素のクリック(キーボード操作・自動化・支援技術)で選べなくなる。 */
   el.addEventListener('click',e=>{
    if(e.target.closest('.lc-vis'))return;
    /* Ctrl/⌘で1つずつ、Shiftで範囲。**素のクリックは選び直し**——選んだ
       つもりのない選択が残り続けるほうが厄介(§9.177)。 */
    if(e.ctrlKey||e.metaKey){
     if(marked.has(k))marked.delete(k);else marked.add(k);
     if(marked.size===1)marked.forEach(x=>{picked=x});else picked=k;
    }else if(e.shiftKey&&picked){
     const ks=shownKeys();
     const a=ks.indexOf(picked),b=ks.indexOf(k);
     if(a>=0&&b>=0)ks.slice(Math.min(a,b),Math.max(a,b)+1).forEach(x=>marked.add(x));
     picked=k;
    }else{marked.clear();marked.add(k);picked=k}
    renderList();renderDetail();
   });
   /* **行のどこを掴んでも並べ替えられる**。つまみは目印で、そこしか
      掴めない作りにすると「掴めない＝並べ替えられない」と受け取られる。
      動かさなければ何もしない(上の click が選ぶ)、**4px以上動かしたら
      並べ替え**、としきい値で分けるので、選ぶ操作とは衝突しない。 */
   el.addEventListener('mousedown',e=>{
    if(e.button!==0||e.target.closest('.lc-vis'))return;
    const sx=e.clientX,sy=e.clientY;let started=false;
    const move=ev=>{
     if(started)return;
     if(Math.abs(ev.clientX-sx)+Math.abs(ev.clientY-sy)<4)return;
     started=true;cleanup();startReorder(ev,el,k);
    };
    const up=()=>cleanup();
    function cleanup(){document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up)}
    document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
    e.preventDefault();   // 掴んでいる間に文字が選択されるのを防ぐ(clickは残る)
   });
  });
  renderCount();syncAllVisible();
 }

 /* 並べ替えは**ポインタで掴んで動かす**(§9.90)。HTML5のD&Dは行の
    クリック(列を選ぶ)と紛れやすく、掴んだ手応えも出ない。掴んでいる間は
    入る位置に線を出し、離した時点で確定してそのまま一覧へ反映する。 */
 function startReorder(ev,el,key){
  ev.preventDefault();ev.stopPropagation();
  const box=el.parentElement;
  /* 掴んだ列が選択に入っていれば**選択全体を運ぶ**(§9.177)。入っていなければ
     今までどおり1列だけ(選択は残す——掴み損ねただけかもしれない)。
     運ぶ順は**画面に出ている順**で、選んだ順ではない。 */
  const moving=(marked.size>=2&&marked.has(key))?draft.order.filter(k=>marked.has(k)):[key];
  const movingEls=moving.map(k=>box.querySelector(`.lc-item[data-key="${CSS.escape(k)}"]`)).filter(Boolean);
  movingEls.forEach(x=>x.classList.add('lc-dragging'));
  el.classList.add('lc-dragging');
  const mark=document.createElement('div');mark.className='lc-drop-mark';
  /* **掴んだものが指に付いてくる(ゴースト)。** 入る位置の線だけだと
     「何を」動かしているかが画面から消える(掴んだ行は薄くなるだけで、
     線は行の間にあるので離れて見える)。行の写しを指の横へ出し、
     線とゴーストの2つで「何を」「どこへ」を同時に見せる。
     写しは`pointer-events:none`で、下の行の判定を邪魔しない。 */
  const ghost=el.cloneNode(true);
  ghost.className='lc-item lc-ghost';
  ghost.style.width=el.getBoundingClientRect().width+'px';
  /* まとめて運んでいるときは**写しにも件数を出す**——1行ぶんの写ししか
     出ないと「1列しか運んでいない」と読める(§9.170で仕掛一覧が踏んだ罠)。 */
  if(moving.length>1){
   const badge=document.createElement('b');
   badge.className='lc-ghost-count';badge.textContent=`${moving.length}列`;
   ghost.appendChild(badge);
  }
  document.body.appendChild(ghost);
  const moveGhost=(x,y)=>{ghost.style.left=x+'px';ghost.style.top=y+'px'};
  const place=y=>{
   const items=[...box.querySelectorAll('.lc-item:not(.lc-dragging)')];
   let before=null;
   for(const it of items){
    const r=it.getBoundingClientRect();
    if(y<r.top+r.height/2){before=it;break}
   }
   box.insertBefore(mark,before);
   return before?before.dataset.key:null;
  };
  let beforeKey=place(ev.clientY);
  moveGhost(ev.clientX+14,ev.clientY-10);
  const onMove=e=>{beforeKey=place(e.clientY);moveGhost(e.clientX+14,e.clientY-10)};
  const onUp=()=>{
   document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);
   mark.remove();ghost.remove();
   movingEls.forEach(x=>x.classList.remove('lc-dragging'));
   el.classList.remove('lc-dragging');
   /* **まとめて抜いてから、落とした位置へまとめて挿す。** 1本ずつ動かすと
      2本目以降の行き先が1本目の移動でずれる。 */
   const o=draft.order;
   const rest=o.filter(k=>!moving.includes(k));
   const at=beforeKey?rest.indexOf(beforeKey):rest.length;
   rest.splice(at<0?rest.length:at,0,...moving);
   draft.order=rest;
   renderList();applyLive();
  };
  document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
 }

 /* 触った結果を**保存せずに**後ろの一覧へ当てる(§9.90)。 */
 function applyLive(){
  WL.columnLayout.stage(target,{locks:[...draft.locks],
                                order:draft.order,widths:draft.widths,hidden:[...draft.hidden],
                                formulas:draft.formulas,sorts:draft.sorts,aligns:draft.aligns,
                                names:draft.names,formats:draft.formats,rules:draft.rules});
  panelSrc.afterApply();
  const note=document.getElementById('lcFootNote');
  if(note)note.textContent='一覧に反映しています（保存すると次に開いたときも同じ形で出ます）';
 }

 function renderCount(){
  const el=document.getElementById('lcCount');if(!el)return;
  const shown=draft.order.filter(k=>!draft.hidden.has(k)).length;
  /* **選択中は件数を文字で出す**(§9.177)。行の色だけでは、何列選んだのか
     数え直すことになる。 */
  el.textContent=`${shown} / ${draft.order.length} 列`
   +(marked.size>=2?`　／　${marked.size}列を選択中（そのままドラッグでまとめて移動）`:'');
  el.classList.toggle('has-mark',marked.size>=2);
 }

 /* 日付時刻のよく使う形。**書き方を覚えなくても選べる**ようにするのが目的で、
    パターンの直接入力はその下に置く(細かく詰めたい人だけが触ればよい)。 */
 const DATE_PRESETS=[
  ['yyyy/MM/dd','2026/08/11'],
  ['yyyy/MM/dd HH:mm','2026/08/11 09:30'],
  ['yyyy/MM/dd HH:mm:ss','2026/08/11 09:30:15'],
  ['yy/MM/dd HH:mm','26/08/11 09:30'],
  ['MM/dd','08/11'],
  ['M月d日','8月11日'],
  ['yyyy年M月d日(ddd)','2026年8月11日(火)'],
  ['HH:mm','09:30'],
 ];
 const fmtOf=k=>draft.formats[k]||null;
 /* 書式の変更。**入力中の欄を作り直さない**ように、右ペイン全体を描き直すのは
    種別を変えたとき(=出る項目が変わるとき)だけにする。文字を打つたびに
    描き直すと、1文字ごとにカーソルが飛ぶ。 */
 function setFmt(patch,rerender){
  const cur=fmtOf(picked)||{kind:'',pattern:'',decimals:null,thousands:false,prefix:'',suffix:''};
  const next={...cur,...patch};
  const bare=!next.kind&&!next.pattern&&next.decimals==null&&!next.thousands&&!next.prefix&&!next.suffix;
  if(bare)delete draft.formats[picked];else draft.formats[picked]=next;
  if(rerender)renderDetail();else renderSample();
  renderPreview();
 }
 /* 書式は読んで想像するものではなく、**結果を見て決めるもの**(設計方針2)
    なので、打つそばから結果を描き直す。 */
 function renderSample(){
  const el=document.getElementById('lcSample');if(!el||isVirtual(picked))return;
  el.innerHTML=previewHtml();
 }
 /* ---------- この列の素性(§9.105) ----------
    右ペインが空々しかったのは、飾りが足りないからではなく**書いてある
    ことが少なかった**から。列を前にして本当に知りたいのは
    「そもそも値が入っているのか」「何種類あるのか」「数字なのか日付なのか」で、
    それが分かって初めて書式を決められる。表示中の行から数える
    (全件の統計ではないので、そう言い切れる範囲だけを出す)。 */
 function columnStats(k){
  const rows=panelSrc.rows();
  const vals=[];
  for(const r of rows){
   const v=panelSrc.valueOf(r,k);
   if(v!==null&&v!==undefined&&String(v).trim()!=='')vals.push(String(v));
  }
  const set=new Set(vals);
  return {total:rows.length,filled:vals.length,blank:rows.length-vals.length,
          distinct:set.size,kindGuess:guessKind(vals)};
 }
 /* 値の見た目からの**推測**。書式を選ぶ手がかりで、決めつけではない
    (「〜が多い」と書くのはそのため)。 */
 function guessKind(vals){
  if(!vals.length)return '値がまだありません';
  const n=Math.min(vals.length,80),head=vals.slice(0,n);
  const num=head.filter(v=>/^-?[\d,]+(\.\d+)?$/.test(v.trim())).length;
  const date=head.filter(v=>/^\d{4}[-/]?\d{1,2}[-/]?\d{1,2}/.test(v.trim())).length;
  if(date/n>=0.8)return '日付らしい値が多い';
  if(num/n>=0.8)return '数値らしい値が多い';
  return '文字の値が多い';
 }
 /* ---------- プレビュー(§9.105) ----------
    1件だけでは「たまたまその値がそう見えただけ」かどうかが分からない。
    **違う値を3件**並べ、生の値と画面に出る値を左右に置く。変わらない行も
    出す(変わらないと分かることも結果のうち)。 */
 function previewSamples(k,max){
  const out=[],seen=new Set();
  for(const r of panelSrc.rows()){
   const v=panelSrc.valueOf(r,k);
   if(v===null||v===undefined||String(v).trim()==='')continue;
   const s=String(v);
   if(seen.has(s))continue;
   seen.add(s);out.push({raw:s,row:r});
   if(out.length>=max)break;
  }
  return out;
 }
 function previewHtml(){
  if(!picked||isVirtual(picked))return '';
  const rule0=draft.rules[picked]||'';
  let rows=previewSamples(picked,3);
  /* **値を持たない列でも、読み替えが付いていれば結果を出す**（§9.234 ⑥）。
     「他の列だけを見るルール」で中身を作る列は自分の値が空なので、
     ここで引き返すと**書いた本人が確かめられない**（§9.117）。 */
  if(!rows.length&&rule0)rows=panelSrc.rows().slice(0,3).map(r=>({raw:'',row:r}));
  if(!rows.length)return `<div class="lc-preview-head">結果</div>
    <p class="lc-preview-empty">この列に値のある行が、いま表示中の中にありません。</p>`;
  const f=fmtOf(picked),rule=rule0;
  const body=rows.map(({raw,row})=>{
   const out=WL.cellFormat.cell({raw,format:f,rule,row:ruleRow(row),column:picked});
   const same=String(out.text)===raw;
   return `<tr class="${same?'is-same':''}"><td class="lc-pv-raw">${esc(raw)}</td>
     <td class="lc-pv-arrow" aria-hidden="true">→</td>
     <td class="lc-pv-out"><b class="${out.color?'cell-'+out.color:''}">${esc(out.text)}</b>${
       same?'<i class="lc-pv-same">変わりません</i>':''}</td></tr>`;
  }).join('');
  return `<div class="lc-preview-head">結果<small>実データ${rows.length}件で確かめる</small></div>
   <table class="lc-pv"><thead><tr><th>元の値</th><th aria-hidden="true"></th><th>一覧に出る値</th></tr></thead>
   <tbody>${body}</tbody></table>`;
 }
 /* この列の実データの先頭(空でないもの)。書式の「例」に使う。 */
 function sampleValue(k){
  for(const r of panelSrc.rows()){
   const v=panelSrc.valueOf(r,k);
   if(v!==null&&v!==undefined&&String(v).trim()!=='')return v;
  }
  return '';
 }

 function formatFields(f){
  const kind=f?.kind||'';
  if(kind==='number')return `
   <div class="lc-sub">
    <label class="lc-field"><span>小数桁</span>
     <select id="lcDecimals">${['','0','1','2','3','4','5','6'].map(v=>
      `<option value="${v}"${String(f?.decimals??'')===v?' selected':''}>${v===''?'そのまま':v+'桁'}</option>`).join('')}</select></label>
    <label class="lc-check"><input type="checkbox" id="lcThousands"${f?.thousands?' checked':''}>
     <span>3桁ごとに区切る（1,234）</span></label>
    <label class="lc-field"><span>単位</span>
     <span class="lc-units">前<input type="text" id="lcPrefix" maxlength="8" value="${esc(f?.prefix||'')}"
      placeholder="¥"> 後<input type="text" id="lcSuffix" maxlength="8" value="${esc(f?.suffix||'')}"
      placeholder="mm"></span></label>
   </div>`;
  if(kind==='datetime')return `
   <div class="lc-sub">
    <label class="lc-field"><span>形</span>
     <select id="lcPreset">${DATE_PRESETS.map(([p,e])=>
      `<option value="${esc(p)}"${(f?.pattern||'')===p?' selected':''}>${esc(e)}</option>`).join('')}
      <option value=""${DATE_PRESETS.some(([p])=>p===(f?.pattern||''))?'':' selected'}>自分で指定</option></select></label>
    <label class="lc-field"><span>パターン</span>
     <input type="text" id="lcPattern" maxlength="60" value="${esc(f?.pattern||'')}"
      placeholder="yyyy/MM/dd HH:mm" autocomplete="off"></label>
    <p class="lc-hint lc-hint-tokens">y=年 M=月 d=日 H=時 m=分 s=秒 ddd=曜日（2つ重ねると0埋め）</p>
   </div>`;
  return '';
 }

 /* ---------- 式で作る列(§9.111 ⑦) ----------
    要望は「計算式で条件を追加できるが、元の列が無いと使えない」。
    つまり**データ側に無い列を、既にある列から作って並べたい**。
    作った列は列レイアウトマスタの1行として持つので、並び・幅・書式・
    読み替えはデータ側の列とまったく同じ仕組みに乗る。 */
 function addFormulaColumn(){
  const name=prompt('新しい列の名前を入力してください（一覧の見出しになります）','計算列');
  if(name===null)return;
  const key=String(name).trim();
  if(!key){showToast&&showToast('名前を入力してください','',3000);return}
  if(draft.order.includes(key)){
   showToast&&showToast('その名前の列はすでにあります',key,4000);return;
  }
  /* 選んでいる列の**次**へ入れる。末尾へ足すと214列の一覧では画面外に
     でき、作った直後に見つけられない。 */
  const at=draft.order.indexOf(picked);
  draft.order.splice(at>=0?at+1:draft.order.length,0,key);
  draft.formulas[key]='';
  picked=key;
  renderOrigins();renderList();renderDetail();applyLive();
  requestAnimationFrame(()=>document.getElementById('lcFormula')?.focus());
 }
 function deleteFormulaColumn(key){
  draft.order=draft.order.filter(k=>k!==key);
  draft.hidden.delete(key);
  delete draft.formulas[key];delete draft.names[key];delete draft.widths[key];
  delete draft.formats[key];delete draft.rules[key];
  picked=draft.order.find(k=>!isVirtual(k))||draft.order[0]||'';
  renderOrigins();renderList();renderDetail();applyLive();
 }
 /* 式の段。**書いたそばから確かめられる**ようにする——式は書き間違えても
    一覧では空欄になるだけなので、ここで言わないと原因に辿り着けない。 */
 function formulaStepHtml(){
  const src=draft.formulas[picked]||'';
  const chk=src.trim()?WL.formula.check(src):{ok:false,error:'まだ式が入っていません'};
  const rows=panelSrc.rows().slice(0,3);
  let sampleHtml='';
  if(chk.ok&&rows.length){
   const c=WL.formula.compile(src);
   /* 行の形は画面によって違う（§9.207）。口が答えるならそちらへ通す
      ——通さないと、スケジュール表の見本だけ全部「（空）」になる。 */
   const fxRow=r=>typeof panelSrc.formulaRowOf==='function'
     ?panelSrc.formulaRowOf(r,c.columns):r;
   sampleHtml=rows.map(r=>{
    const v=c.run(fxRow(r));
    return `<div class="lc-fx-row"><code>${esc(String(v==null?'':v))||'<i class="lc-eg-none">（空）</i>'}</code></div>`;
   }).join('');
  }
  return `
   <div class="lc-step lc-step-fx">
    <h4 class="lc-step-head"><i class="lc-step-no">式</i>この列の作り方
     <small>いまある列から値を作ります</small></h4>
    <textarea id="lcFormula" class="lc-fx-input" rows="2" spellcheck="false"
     placeholder="例: [製造板厚] * [幅]　／　if([数量] > 100, '大', '小')">${esc(src)}</textarea>
    <div class="lc-fx-state ${chk.ok?'is-ok':'is-ng'}">${chk.ok
      ?`使える式です${chk.columns.length?`（使っている列: ${esc(chk.columns.join('、'))}）`:''}`
      :esc(chk.error)}</div>
    ${sampleHtml?`<div class="lc-fx-samples"><span>先頭3件の結果</span>${sampleHtml}</div>`:''}
    <details class="lc-fx-help"><summary>書き方</summary>
     <dl>${WL.formula.help.map(([a,b])=>`<div><dt><code>${esc(a)}</code></dt><dd>${esc(b)}</dd></div>`).join('')}</dl>
    </details>
    <p class="lc-fx-note"><b>この列は表示だけです。</b>並べ替え・絞り込みは元のデータに対して行うため、
     この列は対象になりません。<b>この列の「元の値」は式の結果です</b>——読み替え（③）が
     当たればその言葉で確定し、当たらなければ式の結果がそのまま出ます。
     <b>式が空でも読み替えを付けていればこの列は残ります</b>（読み替えだけで中身を作る列）。
     式も読み替えも空のまま保存すると、この列は消えます。</p>
    <button type="button" id="lcFormulaDel" class="lc-btn-ghost lc-fx-del">この列を削除する</button>
   </div>`;
 }
 function renderDetail(){
  const box=document.getElementById('lcDetail');if(!box)return;
  if(!picked){box.innerHTML='<div class="sc-empty-note">左の一覧から列を選んでください。</div>';return}
  const virt=isVirtual(picked);
  const fx=isFormulaCol(picked);
  const f=fmtOf(picked);
  const sample=virt?'':sampleValue(picked);
  const shown=virt?'':WL.cellFormat.cell({raw:sample,format:f,rule:draft.rules[picked]||'',
                                          row:ruleRow(String(sample)===''?panelSrc.rows()[0]
                                            :panelSrc.rows().find(r=>String(panelSrc.valueOf(r,picked)??'')===String(sample))),
                                          column:picked}).text;
  const o=originOf(picked);
  const st=columnStats(picked);
  /* **右ペインは上から順に読める形にする(§9.105)。** 以前はラベルと入力が
     並ぶだけで、どれが素性の説明でどれが操作なのか、どの順で触ればよいのか
     が形から分からなかった。「この列は何者か」→「①名前と幅」→「②値の
     整え方」→「③読み替え」→「結果」の順に置き、番号を振る。 */
  box.innerHTML=`
   <div class="lc-card">
    <div class="lc-card-top">
     <span class="lc-chip lc-origin-${o}" title="${esc(o==='join'?ORIGIN[o].note+'（'+joinFrom()+'）':ORIGIN[o].note)}">${esc(ORIGIN[o].label)}</span>
     <h3 class="lc-card-name" title="${esc(picked)}">${esc(labelOf(picked))}</h3>
    </div>
    <dl class="lc-facts">
     <div><dt>元の項目名</dt><dd class="lc-mono" title="${esc(picked)}">${esc(virt?'（この列はデータを持ちません）':picked)}</dd></div>
     ${o==='join'?`<div><dt>取得元</dt><dd>${esc(joinFrom())}</dd></div>`:''}
     ${virt?`<div><dt>役割</dt><dd>${esc(panelSrc.virtual()[picked].note)}</dd></div>`
           :`<div><dt>値のある行</dt><dd>${st.filled} / ${st.total}<i class="lc-fact-sub">${st.blank?`空欄 ${st.blank}`:'空欄なし'}</i></dd></div>
             <div><dt>値の種類</dt><dd>${st.distinct}<i class="lc-fact-sub">${esc(st.kindGuess)}</i></dd></div>`}
     ${srcNote(picked)?`<div class="lc-fact-note"><dt>この列について</dt><dd title="${esc(srcNote(picked))}">${esc(srcNote(picked))}</dd></div>`:''}
    </dl>
   </div>
   <div class="lc-step">
    <h4 class="lc-step-head"><i class="lc-step-no">1</i>見せ方<small>一覧の見出しと列の幅</small></h4>
    <label class="lc-field"><span>表示名</span>
     <input type="text" id="lcName" value="${esc(draft.names[picked]||'')}"
      placeholder="${esc(virt?panelSrc.virtual()[picked].label:picked)}" autocomplete="off"></label>
    <div class="lc-field lc-field-width"><span>幅</span>
     <div class="lc-widthbox">
      <div class="lc-widthmodes" id="lcWidthMode">${[
        ['auto','自動','見出しと実データの長さに合わせます'],
        ['manual','手で決める','入れた幅にします（文字が長くても狭くできます）'],
        ['locked','固定','いまの幅から動かしません（見出しの取っ手も掴めなくなります）'],
       ].map(([v,t,note])=>`<label class="lc-widthmode" title="${esc(note)}">
        <input type="radio" name="lcWidthMode" value="${v}"${widthModeOf(picked)===v?' checked':''}>
        <span>${t}</span></label>`).join('')}</div>
      <span class="lc-width"><input type="number" id="lcWidth" min="40" max="900" step="10"
       value="${draft.widths[picked]||''}" placeholder="自動"
       ${widthModeOf(picked)==='auto'?'disabled':''}> px</span>
      <small class="lc-hint">${esc(WIDTH_MODE_NOTE[widthModeOf(picked)]||'')}</small>
     </div></div>
   ${alignFieldsHtml()}
   </div>
   ${fx&&panelSrc.features.formula?formulaStepHtml():''}
   ${virt?`<div class="lc-note-calc"><b>この列は値を持ちません。</b>
      番号やボタンを出す列なので、書式や読み替えはありません。名前と幅、出す/出さないだけを決められます。</div>`:`
   <div class="lc-step">
    <h4 class="lc-step-head"><i class="lc-step-no">2</i>値の整え方<small>桁・単位・日付の形</small></h4>
    <div class="lc-field lc-field-kind"><span>書式</span>
     <div class="lc-kinds" id="lcKinds">${[['','そのまま'],['number','数値'],['datetime','日付・時刻'],['text','文字']]
      .map(([v,t])=>`<label class="lc-kind"><input type="radio" name="lcKind" value="${v}"${(f?.kind||'')===v?' checked':''}><span>${t}</span></label>`).join('')}</div></div>
    ${formatFields(f)}
   </div>
   <div class="lc-step">
    <h4 class="lc-step-head"><i class="lc-step-no">3</i>読み替え<small>値を決まった言葉へ置き換える</small></h4>
    <label class="lc-field"><span>ルール</span>
     <span class="lc-rulepick">
      <select id="lcRule">${[['','しない'],...WL.displayRules.names().map(n=>[n,n])]
       .map(([v,t])=>`<option value="${esc(v)}"${(draft.rules[picked]||'')===v?' selected':''}>${esc(t)}</option>`).join('')}
       <option value="__new__">＋ 新しいルールを作る…</option></select>
      <button type="button" id="lcRuleEdit" ${draft.rules[picked]?'':'disabled'}>ルールを編集</button>
     </span></label>
    <p class="lc-hint">読み替えが当たった行はその言葉で確定し、当たらなければ書式で整形します。どちらもできない値は元のまま表示します。</p>
   </div>
   ${panelSrc.features.sort===false?'':sortStepHtml()}
   <div class="lc-preview" id="lcSample">${previewHtml()}</div>`}`;
  box.querySelector('#lcName').addEventListener('input',e=>{
   const v=e.target.value.trim();
   if(v)draft.names[picked]=v;else delete draft.names[picked];
   renderPreview();
  });
  box.querySelector('#lcWidth').addEventListener('input',e=>{
   const n=Number(e.target.value);
   if(n>=40)draft.widths[picked]=Math.min(900,n);else delete draft.widths[picked];
   renderPreview();
  });
  /* 幅の3つの状態(§9.119)。**「自動へ戻す」は幅を消す**——数値を残したまま
     自動にすると、次に開いたときその数値が復活して「戻したのに戻っていない」
     ことになる。固定は幅を持ったまま動かさない状態なので、幅が無ければ
     **いま画面に出ている幅**を書き留める(でないと固定した意味が無い)。 */
  box.querySelectorAll('input[name="lcWidthMode"]').forEach(el=>el.addEventListener('change',ev=>{
   const mode=ev.target.value;
   if(mode==='auto'){delete draft.widths[picked];draft.locks.delete(picked)}
   else{
    if(draft.widths[picked]==null){
     /* **いま出ている幅**を書き留める。以前は`#grid`の見出しだけを見ており、
        仕掛一覧以外の対象では必ず120pxになった(§9.162)。どこを測るかは
        口が答える(答えなければ仕掛一覧の見出し)。 */
     const w=typeof panelSrc.currentWidthOf==='function'
       ?Math.round(Number(panelSrc.currentWidthOf(picked))||0)
       :(()=>{const th=document.querySelector(`#grid thead th[data-col="${CSS.escape(picked)}"]`);
              return th?Math.round(th.getBoundingClientRect().width):0})();
     draft.widths[picked]=w>=40?Math.min(900,w):120;
    }
    if(mode==='locked')draft.locks.add(picked);else draft.locks.delete(picked);
   }
   renderDetail();renderList();applyLive();
  }));
  /* 式の段の配線。**入力のたびに一覧まで作り直さない**——214列の一覧では
     1文字ごとに数百msかかる。式が通ったときだけ当てる。 */
  const fxIn=box.querySelector('#lcFormula');
  if(fxIn){
   let timer=null;
   fxIn.addEventListener('input',e=>{
    draft.formulas[picked]=e.target.value;
    clearTimeout(timer);
    timer=setTimeout(()=>{
     const at=fxIn.selectionStart;
     renderDetail();
     const again=document.getElementById('lcFormula');
     if(again){again.focus();try{again.setSelectionRange(at,at)}catch(_){}}
     if(WL.formula.check(draft.formulas[picked]||'').ok){renderList();applyLive()}
    },350);
   });
   box.querySelector('#lcFormulaDel').onclick=async()=>{
    if(await confirmModal(`列「${labelOf(picked)}」を削除しますか？\n式で作った列なので、元のデータには影響しません。`))
     deleteFormulaColumn(picked);
   };
  }
  /* 揃えは**番号・ボタンの列にも効く**ので、`virt`で降りる前に配線する。 */
  wireAlign(box);
  if(virt)return;
  box.querySelectorAll('input[name="lcKind"]').forEach(el=>{
   el.onchange=()=>{
    /* 種別を変えたら、その種別で意味のない指定は落とす(数値の桁数が
       日付の設定として残っていると、戻したときに驚く)。 */
    const kind=el.value;
    if(kind==='datetime')setFmt({kind,decimals:null,thousands:false,prefix:'',suffix:'',
                                 pattern:fmtOf(picked)?.pattern||DATE_PRESETS[0][0]},true);
    else if(kind==='number')setFmt({kind,pattern:''},true);
    else if(kind==='text')setFmt({kind,pattern:'',decimals:null,thousands:false},true);
    else setFmt({kind:'',pattern:'',decimals:null,thousands:false,prefix:'',suffix:''},true);
   };
  });
  const on=(id,ev,fn)=>{const el=box.querySelector(id);if(el)el.addEventListener(ev,fn)};
  on('#lcDecimals','change',e=>setFmt({decimals:e.target.value===''?null:Number(e.target.value)}));
  on('#lcThousands','change',e=>setFmt({thousands:e.target.checked}));
  on('#lcPrefix','input',e=>setFmt({prefix:e.target.value.slice(0,8)}));
  on('#lcSuffix','input',e=>setFmt({suffix:e.target.value.slice(0,8)}));
  on('#lcPreset','change',e=>{
   if(!e.target.value)return;                       // 「自分で指定」は下の欄で
   setFmt({pattern:e.target.value},true);
  });
  on('#lcPattern','input',e=>{
   setFmt({pattern:e.target.value.slice(0,60)});
   // 「形」の選択も追随させる(パターンを直接打った結果が既定形と同じになる
   //  ことがあるため。ここだけは作り直さずに値を差し替える)
   const sel=box.querySelector('#lcPreset');
   if(sel)sel.value=DATE_PRESETS.some(([p])=>p===e.target.value)?e.target.value:'';
  });
  /* 読み替え(段4)。ルールは列に属さないので、ここでは**名前を選ぶだけ**。
     中身の編集は専用の画面へ渡す(同じルールを複数の列から使うため)。 */
  on('#lcRule','change',e=>{
   if(e.target.value==='__new__'){
    e.target.value=draft.rules[picked]||'';
    editRule('');return;
   }
   if(e.target.value)draft.rules[picked]=e.target.value;else delete draft.rules[picked];
   renderDetail();renderList();renderPreview();
  });
  on('#lcRuleEdit','click',()=>editRule(draft.rules[picked]||''));
  wireSortStep(box);
 }

 /* ---------- 揃え(§9.239 ④、利用者の指示) ----------
    「数値は右詰め、文字列は左詰めなど自動で書式に合わせた設定になりますが、
     手動での任意変更もできるように」「カラムの文字列はデータとは別で
     中央位置をデフォルトにして、データの位置に追従するか、別で設定するかを
     選べるように」

    **2段に分けて出す**——データと見出しは別の設定だと利用者が言っている。
    1つの並びに混ぜると「見出しだけ中央」がどこの設定か分からなくなる。
    **いま何が効いているかを文字で出す**（§3・§6）——「自動」を選んで
    いるときは、その結果（右詰め／左詰め）と**理由**（書式が数値だから）を
    添える。同じ「右詰め」でも、自動で右になっているのか手で決めたのかで
    次にすることが違う。 */
 const ALIGN_DIRS=[['left','左'],['center','中央'],['right','右']];
 function alignOf(k){
  /* **下書きに`aligns`が無くても落ちないこと。** 右ペインは1箇所でも
     例外を投げると丸ごと描けなくなるので、設定が欠けたときは「既定」で
     出す（直せる場所へ辿れる状態を保つ・§9.111 ⑦と同じ考え方）。 */
  const a=(draft.aligns||{})[k]||{};
  return {data:String(a.data||''),head:String(a.head||'')};
 }
 /* 自動のときに実際どちらへ寄るか。**判定は`WL.columnAlign`の1箇所**を
    通す（パネルだけ別の答えを出すと、見本と一覧が食い違う）。 */
 function autoDataDir(k){
  const kind=(draft.formats[k]||{}).kind||'';
  return kind==='number'?'right':'left';
 }
 function alignFieldsHtml(){
  const a=alignOf(picked);
  const auto=autoDataDir(picked);
  const kind=(draft.formats[picked]||{}).kind||'';
  const eff=a.data||auto;
  const headEff=a.head==='follow'?eff:(a.head||'center');
  const seg=(name,cur,opts)=>`<div class="lc-aligns" id="${name}">`+opts.map(([v,t,tip])=>
    `<label class="lc-align${cur===v?' is-on':''}" title="${esc(tip||t)}">`
    +`<input type="radio" name="${name}" value="${esc(v)}"${cur===v?' checked':''}><span>${esc(t)}</span></label>`).join('')+'</div>';
  return `
   <div class="lc-field lc-field-align"><span>データの揃え</span>
    <div class="lc-alignbox">
     ${seg('lcAlignData',a.data,[['','自動','書式に合わせます（数値なら右、それ以外は左）'],
                                 ...ALIGN_DIRS.map(([v,t])=>[v,t,`このデータを${t}へそろえます`])])}
     <small class="lc-hint">${a.data
       ?`手で決めています（${esc(WL.columnAlign.LABEL[a.data])}）。書式を変えても動きません。`
       :`自動 → いまは<b>${esc(WL.columnAlign.LABEL[auto])}</b>（書式は${esc(kind==='number'?'数値':kind==='datetime'?'日付・時刻':kind==='text'?'文字':'指定なし')}）`}</small>
    </div></div>
   <div class="lc-field lc-field-align"><span>見出しの揃え</span>
    <div class="lc-alignbox">
     ${seg('lcAlignHead',a.head,[['','中央','見出しは中央にそろえます（既定）'],
                                 ['follow','データに追従','データの揃えと同じにします'],
                                 ...ALIGN_DIRS.map(([v,t])=>[v,t,`見出しを${t}へそろえます`])])}
     <small class="lc-hint">いまは<b>${esc(WL.columnAlign.LABEL[headEff])}</b>${
       a.head==='follow'?'（データに追従）':a.head?'（手で決めています）':'（既定）'}</small>
    </div></div>`;
 }
 function wireAlign(box){
  const put=(kind,v)=>{
   const a=alignOf(picked);
   a[kind]=v;
   if(!draft.aligns)draft.aligns={};
   if(!a.data&&!a.head)delete draft.aligns[picked];
   else draft.aligns[picked]={data:a.data,head:a.head};
   /* **右ペインも描き直す**——「いまは右詰め」の説明が古いままだと、
      効いていないように見える（§9.90の`renderPreview`と同じ理由）。 */
   renderDetail();renderList();applyLive();
  };
  box.querySelectorAll('input[name="lcAlignData"]').forEach(el=>
   el.addEventListener('change',e=>put('data',e.target.value)));
  box.querySelectorAll('input[name="lcAlignHead"]').forEach(el=>
   el.addEventListener('change',e=>put('head',e.target.value)));
 }

 /* ---------- ④ 並べ替え(§9.187) ----------
    見出しのクリックはこれまで「SQLの素の並び」だけだった。実データの
    同じ項目には '' / '3' / '10' / '2026/08/01' / 'A2' が混ざるので、
    **どの種類を先に置くか**を列ごとに決められるようにする。
    あわせて「読み替え・書式で文字にしてから並べる」も選べる
    ——画面に出ているのは言い換えた文字なのに、並ぶのは生の値だった。

    **処理の順番を図で見せる**のが要点。「変換してから並べる」と言われても、
    今どちらなのかが分からないと選べない。 */
 const SORT_FLOW={
  raw:['生の値','並べ替え','読み替え','書式','画面'],
  display:['生の値','読み替え','書式','並べ替え','画面'],
 };
 function sortStepHtml(){
  const spec=WL.sortSpec.normalize(draft.sorts[picked])||{buckets:[],on:'raw',natural:false};
  const values=panelSrc.rows().map(r=>panelSrc.valueOf(r,picked));
  const useBuckets=spec.buckets.length>0;
  const chips=(useBuckets?spec.buckets:WL.sortSpec.defaultBuckets()).map((k,i,a)=>
   `<span class="lc-bucket" data-bucket="${k}">
     <b>${i+1}</b>${esc(WL.sortSpec.LABEL[k])}
     <button type="button" class="lc-bucket-up" data-bup="${i}" title="1つ前へ"${i===0?' disabled':''}>◀</button>
     <button type="button" class="lc-bucket-down" data-bdown="${i}" title="1つ後へ"${i===a.length-1?' disabled':''}>▶</button>
    </span>`).join('<i class="lc-bucket-arrow" aria-hidden="true">→</i>');
  const flow=SORT_FLOW[spec.on].map((t,i,a)=>
   `<span class="lc-flow-step${t==='並べ替え'?' is-sort':''}">${esc(t)}</span>`
   +(i<a.length-1?'<i class="lc-flow-arrow" aria-hidden="true">→</i>':'')).join('');
  return `<div class="lc-step">
    <h4 class="lc-step-head"><i class="lc-step-no">4</i>並べ替え<small>見出しを押したときの並び</small></h4>
    <p class="lc-sort-census">この列の実データ: ${esc(WL.sortSpec.censusText(values))}</p>
    <div class="lc-field lc-field-kind"><span>処理の順番</span>
     <div class="lc-kinds" id="lcSortOn">${[
       ['raw','生の値で並べる','今までどおり。並べたあとに読み替え・書式で見せます'],
       ['display','変換後の文字で並べる','読み替え・書式を当てた文字で並べます（画面の通りの並びになります）'],
      ].map(([v,t,note])=>`<label class="lc-kind" title="${esc(note)}">
       <input type="radio" name="lcSortOn" value="${v}"${spec.on===v?' checked':''}><span>${esc(t)}</span></label>`).join('')}</div></div>
    <div class="lc-flow">${flow}</div>
    <div class="lc-field lc-field-kind"><span>種類の順</span>
     <div class="lc-kinds" id="lcSortMix">${[
       ['off','区別しない','今までどおりの並びです'],
       ['on','順番を決める','空欄・数値・日付・文字列をどの順に置くか決めます'],
      ].map(([v,t,note])=>`<label class="lc-kind" title="${esc(note)}">
       <input type="radio" name="lcSortMix" value="${v}"${(useBuckets?'on':'off')===v?' checked':''}><span>${esc(t)}</span></label>`).join('')}</div></div>
    ${useBuckets?`<div class="lc-buckets" id="lcBuckets">${chips}</div>
     <p class="lc-hint">昇順・降順は<b>塊の中の値だけ</b>を反転します（空欄の行き先が向きで変わらないように、塊の順はここで決めたままです）。</p>`:''}
    <label class="lc-check"><input type="checkbox" id="lcSortNatural"${spec.natural?' checked':''}>
     <span>数字混じりの文字列を人の読む順にする<small>A2 → A10（切らないと A10 → A2 になります）</small></span></label>
    <p class="lc-hint">いまの並べ替え: <b>${esc(WL.sortSpec.describe(draft.sorts[picked]))}</b>${
      spec.on==='display'?'　※読み替え・書式を当てた文字で並べます':''}</p>
   </div>`;
 }
 function setSortSpec(patch){
  const cur=WL.sortSpec.normalize(draft.sorts[picked])||{buckets:[],on:'raw',natural:false};
  const next=WL.sortSpec.normalize({...cur,...patch});
  if(next)draft.sorts[picked]=next;else delete draft.sorts[picked];
  /* 一覧は**並べ直して取り直す**必要がある(並べるのはサーバー)。
     この列で並べていないときは取り直さない(見た目が変わらないため)。 */
  renderDetail();renderList();applyLive();
  if(typeof panelSrc.resort==='function')panelSrc.resort(picked);
 }
 function wireSortStep(box){
  box.querySelectorAll('input[name="lcSortOn"]').forEach(el=>el.addEventListener('change',ev=>
   setSortSpec({on:ev.target.value})));
  box.querySelectorAll('input[name="lcSortMix"]').forEach(el=>el.addEventListener('change',ev=>
   setSortSpec({buckets:ev.target.value==='on'?WL.sortSpec.defaultBuckets():[]})));
  const nat=box.querySelector('#lcSortNatural');
  if(nat)nat.addEventListener('change',ev=>setSortSpec({natural:ev.target.checked}));
  const move=(i,d)=>{
   const cur=WL.sortSpec.normalize(draft.sorts[picked]);
   const list=(cur&&cur.buckets.length?cur.buckets:WL.sortSpec.defaultBuckets()).slice();
   const to=i+d;
   if(to<0||to>=list.length)return;
   const [x]=list.splice(i,1);list.splice(to,0,x);
   setSortSpec({buckets:list});
  };
  box.querySelectorAll('[data-bup]').forEach(b=>b.onclick=()=>move(Number(b.dataset.bup),-1));
  box.querySelectorAll('[data-bdown]').forEach(b=>b.onclick=()=>move(Number(b.dataset.bdown),1));
 }

 /* 一覧そのものが見本なので、パネルの中に別の表は持たない(§9.90)。
    設定を変えたら**リストの「見え方」と後ろの一覧の両方**を描き直す。
    **リストを忘れないこと**——書式や読み替えを変えても行の例が古いままだと、
    「効いていない」と受け取られる(実際にそう見える状態を作ってしまった)。 */
 function renderPreview(){renderOrigins();renderList();applyLive()}

 /* **パネルに出ていない列も並びから落とさない**（§9.248 ③、利用者の報告
    「一覧表関係の表示列が一部表示されなかったり消えていることがあります」）。

    パネルが並べるのは`panelSrc.keys()`＝**いま出せる列**だけ。結合が当たって
    いない・別のモードで開いた・マスタがまだ届いていない、のどれでも顔ぶれは
    縮むので、そのまま保存すると**居なかった列が保存済みの並びから消える**
    （次に出てきたとき「知らない列」として末尾へ回る）。
    **保存済みにあってパネルに無い列は、元の隣の列の後ろへ挿し直す**
    ——末尾へまとめて足すと、戻ってきたときに並びがひとかたまり動く。
    **差し替え口が自前で保存する対象（作業スケジュールの内容欄）は触らない**
    ——あちらは`body.order`から「内容表示マスタへ書く項目」を作るので、
    出せない列を混ぜると**選んだ覚えの無い項目**がマスタへ入る。 */
 function orderForSave(){
  const saved=(WL.columnLayout.saved(target).order)||[];
  const shown=new Set(draft.order);
  const out=[...draft.order];
  let anchor=-1;                       /* 直前に見た「パネルにも在る列」の位置 */
  saved.forEach(k=>{
   if(shown.has(k)){anchor=out.indexOf(k);return}
   if(out.includes(k))return;
   anchor=anchor<0?0:anchor+1;
   out.splice(anchor,0,k);
  });
  return out;
 }
 async function save(){
  try{
   /* 保存先が違う対象もある(§9.120)。作業スケジュールの内容欄は
      「どの項目を出すか」だけスケジュール内容表示マスタが持つので、
      **振り分けは差し替え口の1箇所**で行う(パネルは知らなくてよい)。 */
   const body={order:(typeof panelSrc.save==='function'?draft.order:orderForSave()),
               widths:draft.widths,
               hidden:[...draft.hidden],names:draft.names,
               formats:draft.formats,rules:draft.rules,
               formulas:draft.formulas,locks:[...draft.locks],sorts:draft.sorts,
               aligns:draft.aligns};
   if(typeof panelSrc.save==='function')await panelSrc.save(target,body);
   else await WL.columnLayout.save(target,body);
   /* 保存が通ったら**下書きは役目を終える**(§9.212 ③)。`save()`が
      保存済みの重ねへ入れて下書きを捨てるので、ここで控えを作る必要はない
      ——差し替え口が独自に保存する場合(`panelSrc.save`)だけは
      こちらで捨てる。 */
   WL.columnLayout.discard(target);
   showToast&&showToast(panelSrc.savedToast||'列の設定を保存しました',
                        panelSrc.savedNote||'この一覧を次に開いたときも同じ形で出ます',2600);
   const note=document.getElementById('lcFootNote');
   if(note)note.textContent='保存しました';
   panelSrc.afterApply();
   /* **保存したら閉じる**（§9.207、利用者の指示「表示列の設定で保存ボタンを
      押したら、モーダルを閉じてほしい」）。保存＝この作業は終わりなので、
      開いたままだと「まだ何かするのか」と読ませる。**失敗したら閉じない**
      ——直す場所が消えてしまう。 */
   close();
  }catch(e){showToast&&showToast('保存に失敗しました',e.message,5000)}
 }
 /* ---------- 名前を付けて覚えさせる(§9.111) ----------
    保存するのは**今パネルに出ている下書き**(draft)。「保存」を押していない
    状態でも登録できるほうが自然で、そのまま一覧にも当たっている。 */
 let presets=[];
 const draftBody=()=>({order:[...draft.order],widths:{...draft.widths},
                       hidden:[...draft.hidden],names:{...draft.names},
                       formats:JSON.parse(JSON.stringify(draft.formats)),rules:{...draft.rules},
                       formulas:{...draft.formulas},locks:[...draft.locks],
                       sorts:JSON.parse(JSON.stringify(draft.sorts||{})),
                       /* 揃え(§9.239 ④)も一緒に運ぶ。**1つでも書き漏らすと
                          その設定だけが黙って消える**（§9.113）。 */
                       aligns:JSON.parse(JSON.stringify(draft.aligns||{}))});
 function renderPresets(){
  const sel=document.getElementById('lcPresetSel');if(!sel)return;
  const cur=sel.value;
  sel.innerHTML='<option value="">（選ぶと読み込みます）</option>'
   +presets.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if(presets.some(p=>String(p.id)===String(cur)))sel.value=cur;
  const del=document.getElementById('lcPresetDel');
  if(del)del.disabled=!sel.value;
 }
 async function loadPresets(){
  try{
   const r=await api('/api/column-preset-master?target='+encodeURIComponent(target));
   presets=r.items||[];
  }catch(e){presets=[];console.warn('列プリセットを読めませんでした',e)}
  renderPresets();
 }
 /* 読み込んだ設定は**保存せずに当てる**(§9.90と同じ)。押した結果がその場で
    一覧に出て、気に入らなければ閉じれば戻る。 */
 /* ---------- 設定を読み込む(プリセット・ファイル) ----------
    **今ある列だけに当てる**(§9.119)。元データの項目名は変わることがあり、
    保存した設定に無くなった列名が混ざる。**当たらない列は黙って捨てる**
    のが正しい(そこで止めると、1つ変わっただけで設定全体が使えなくなる)。

    ただし**捨てたことは必ず言う**——以前は「読み込みました」とだけ出て
    いたので、10列ぶんの設定を読んで2列しか当たらなくても気づけなかった。
    「効かなかった」のか「そもそも当たっていない」のかが分かれるのは大きい。 */
 function pickKnown(map,keys){
  const out={},lost=[];
  Object.keys(map||{}).forEach(k=>{if(keys.includes(k))out[k]=map[k];else lost.push(k)});
  return {out,lost};
 }
 function useBody(body,note){
  const keys=allKeys();
  const known=(body.order||[]).filter(k=>keys.includes(k));
  const lostOrder=(body.order||[]).filter(k=>!keys.includes(k));
  const w=pickKnown(body.widths,keys),n=pickKnown(body.names,keys);
  const f=pickKnown(body.formats,keys),r=pickKnown(body.rules,keys);
  /* **計算式で作る列だけは、今ある列に無くても復元する**——その設定
     こそが列の定義なので、落とすと列そのものが消える。 */
  const formulas={...(body.formulas||{})};
  draft={
   order:[...known,...Object.keys(formulas).filter(k=>!known.includes(k)),
          ...keys.filter(k=>!known.includes(k)&&!formulas[k])],
   hidden:new Set((body.hidden||[]).filter(k=>keys.includes(k)||formulas[k])),
   widths:w.out,names:n.out,
   formats:JSON.parse(JSON.stringify(f.out)),rules:r.out,
   formulas,
   locks:new Set((body.locks||[]).filter(k=>keys.includes(k)||formulas[k])),
   sorts:pickKnown(body.sorts,keys).out,
   aligns:JSON.parse(JSON.stringify(pickKnown(body.aligns,keys).out)),
  };
  marked.clear();
  if(!draft.order.includes(picked))picked=draft.order.find(k=>!isVirtual(k))||draft.order[0]||'';
  renderOrigins();renderList();renderDetail();applyLive();
  const lost=new Set([...lostOrder,...w.lost,...n.lost,...f.lost,...r.lost]
                     .filter(k=>!formulas[k]));
  const foot=document.getElementById('lcFootNote');
  const base=note||'読み込みました（保存するまでは元に戻せます）';
  if(foot)foot.textContent=lost.size
   ? `${base}／この一覧に無い ${lost.size}列は飛ばしました: ${[...lost].slice(0,4).join('、')}${lost.size>4?' ほか':''}`
   : base;
  if(lost.size)showToast&&showToast(`${lost.size}列ぶんは飛ばしました`,
   `この一覧に無い列名です: ${[...lost].slice(0,6).join('、')}${lost.size>6?` ほか${lost.size-6}件`:''}`,6000);
  return {applied:known.length,skipped:lost.size};
 }
 function applyPreset(id){
  const del=document.getElementById('lcPresetDel');if(del)del.disabled=!id;
  if(!id)return;
  const p=presets.find(x=>String(x.id)===String(id));
  if(!p)return;
  useBody(p.body||{},`「${p.name}」を読み込みました（保存するまでは元に戻せます）`);
 }
 async function savePreset(){
  const sel=document.getElementById('lcPresetSel');
  const suggest=(presets.find(x=>String(x.id)===String(sel&&sel.value))||{}).name||'';
  const name=prompt('この設定に付ける名前を入力してください（同じ名前があれば上書きします）',suggest);
  if(name===null)return;
  if(!String(name).trim()){showToast&&showToast('名前を入力してください','',3000);return}
  try{
   const r=await api('/api/column-preset-master',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({target,name:String(name).trim(),body:draftBody()}))});
   presets=r.items||[];renderPresets();
   const hit=presets.find(p=>p.name===String(name).trim());
   if(hit&&sel)sel.value=hit.id;
   renderPresets();
   showToast&&showToast('登録しました',`「${String(name).trim()}」は他のPCからも読み出せます`,3600);
  }catch(e){showToast&&showToast('登録できませんでした',e.message,5000)}
 }
 async function deletePreset(){
  const sel=document.getElementById('lcPresetSel');
  const p=presets.find(x=>String(x.id)===String(sel&&sel.value));
  if(!p)return;
  if(!(await confirmModal(`「${p.name}」を削除しますか？\nこの一覧の保存済み設定から消えます（今の表示は変わりません）。`)))return;
  try{
   const r=await api('/api/column-preset-master/delete',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({id:p.id,target}))});
   presets=r.items||[];if(sel)sel.value='';renderPresets();
   showToast&&showToast('削除しました',p.name,2600);
  }catch(e){showToast&&showToast('削除できませんでした',e.message,5000)}
 }
/* ---------- 列の設定の持ち出し・取り込み(§9.178) ----------
    フィルタと同じ要望(「全てまたは各一覧単位で」)が列の設定にも来た。
    **運ぶのは列レイアウトマスタの中身だけ**——並び・幅・表示名・書式・
    読み替えルール名・計算式・幅固定。「名前を付けて登録した設定」
    (列プリセットマスタ)は別の入れ物なので運ばない、と**画面に書く**
    (黙って落とすと、取り込んだ側は登録が消えたと受け取る)。

    **対象(target)ごとに1件**として運ぶ。対象は`list:<DB>:<表>`のように
    画面が組み立てる文字列で、取り込む先の端末にその一覧が無いこともある
    ——そのときも**書き込みは通す**(先に一覧を開かなくても設定だけ先に
    配れる。当たらなければ次に開いたときに知らない列として無視される)。

    **読み替えルールの中身は運ばない**(表示ルールマスタは別の入出力)。
    ルール名だけが残るので、無いルール名＝読み替えなしとして静かに素通り
    する(§9.88の約束どおり)。これも画面に書く。 */
 const IO_KIND='wavelog-column-layouts';
 const IO_KIND_ONE='wavelog-column-preset';    // 旧・単一対象の形も読める
 let ioMode='export',ioAll=null,ioFile=null,ioScope='one',ioImportScope='one';
 const ioEl=id=>document.getElementById(id);
 function ioTargetLabel(t){
  const s2=String(t||'');
  if(s2.startsWith('list:'))return `仕掛一覧 ${s2.slice(5).replace(':',' / ')}`;
  if(s2.startsWith('timeline:'))return `作業スケジュール表 ${s2.slice(9)}`;
  if(s2.startsWith('print:'))return `スケジュールの印刷 ${s2.slice(6)}`;
  if(s2.startsWith('report:'))return `帳票 ${s2.slice(7)}`;
  if(s2==='records:list')return 'データ一覧';
  return s2;
 }
 const ioCount=b=>((b&&b.order)||[]).length;
 const ioHidden=b=>((b&&b.hidden)||[]).length;
 function openIo(mode){
  ioMode=mode;ioFile=null;
  const box=ioEl('lcIo');if(!box)return;
  box.hidden=false;
  ioEl('lcIoTitle').textContent=mode==='export'?'列の設定を書き出す':'列の設定を取り込む';
  ioEl('lcIoRun').textContent=mode==='export'?'ファイルへ書き出す':'取り込む';
  renderIo();
  if(mode==='export')loadIoAll();
 }
 function closeIo(){const box=ioEl('lcIo');if(box)box.hidden=true}
 async function loadIoAll(){
  try{
   const r=await api('/api/column-layout-master?all=1');
   ioAll=(r.items||[]).map(x=>({target:x.target,body:{order:x.order||[],widths:x.widths||{},
     hidden:x.hidden||[],names:x.names||{},formats:x.formats||{},rules:x.rules||{},
     formulas:x.formulas||{},locks:x.locks||[]}}));
  }catch(e){ioAll=null;console.warn('保存済みの列設定を読めませんでした',e)}
  renderIo();
 }
 function renderIo(){
  const body=ioEl('lcIoBody'),note=ioEl('lcIoNote'),run=ioEl('lcIoRun');
  if(!body)return;
  if(ioMode==='export'){
   /* いま画面で触っている下書きも運べるようにする——保存していない形を
      別のPCへ渡したい場面があるので、「この一覧だけ」は**下書き**を書く。 */
   const list=ioAll===null
    ?'<div class="lc-io-loading">保存済みの設定を読み込んでいます…</div>'
    :(ioAll.length
      ?`<ul class="lc-io-list">${ioAll.map(x=>`<li><b>${esc(ioTargetLabel(x.target))}</b>`
        +`<span>${ioCount(x.body)}列${ioHidden(x.body)?`（うち${ioHidden(x.body)}列は非表示）`:''}</span>`
        +`<code>${esc(x.target)}</code></li>`).join('')}</ul>`
      :'<div class="lc-io-empty">マスタに保存済みの列設定はまだありません（「この一覧だけ」なら今の下書きを書き出せます）。</div>');
   body.innerHTML=`
    <div class="lc-io-scope" role="radiogroup" aria-label="書き出す範囲">
     <label><input type="radio" name="lcIoScope" value="one"${ioScope==='one'?' checked':''}>
      <b>この一覧だけ</b><span>${esc(ioTargetLabel(target))}（いま画面に当たっている形）</span></label>
     <label><input type="radio" name="lcIoScope" value="all"${ioScope==='all'?' checked':''}>
      <b>すべての一覧</b><span>${ioAll===null?'…':`${ioAll.length}件`}（マスタに保存済みの形）</span></label>
    </div>
    ${ioScope==='all'?list:''}
    <p class="lc-io-what"><b>運ぶもの</b>: 列の並び・幅（自動/手で決める/固定）・表示名・書式・
     読み替えルールの<b>名前</b>・計算式。<br>
     <b>運ばないもの</b>: 「名前を付けて登録」した設定（列プリセット）と、読み替えルールの中身
     （表示ルールマスタ）。ルール名だけが残るので、取り込んだ先に同じ名前のルールが無ければ
     読み替えなしとして扱われます。</p>`;
   body.querySelectorAll('input[name=lcIoScope]').forEach(r=>{
    r.onchange=()=>{ioScope=r.value;renderIo()};
   });
   note.textContent=ioScope==='all'
    ?(ioAll===null?'読み込み中…':`${ioAll.length}件の対象を1つのファイルへ書き出します`)
    :'この一覧ぶん（1件）を書き出します';
   run.disabled=ioScope==='all'&&(ioAll===null||!ioAll.length);
   return;
  }
  // ---- 取り込み ----
  const items=ioFile?ioFile.items:null;
  const hit=items?items.find(x=>x.target===target):null;
  body.innerHTML=`
   <div class="lc-io-pick">
    <button type="button" id="lcIoFile" class="lc-side-btn">ファイルを選ぶ…</button>
    <span class="lc-io-fname">${ioFile?esc(ioFile.name):'まだ選んでいません'}</span>
   </div>
   ${items?`<ul class="lc-io-list">${items.map(x=>`<li${x.target===target?' class="is-here"':''}>`
     +`<b>${esc(ioTargetLabel(x.target))}</b><span>${ioCount(x.body)}列</span>`
     +`<code>${esc(x.target)}</code>${x.target===target?'<i>この一覧</i>':''}</li>`).join('')}</ul>`:''}
   ${items?`<div class="lc-io-scope" role="radiogroup" aria-label="取り込む範囲">
     <label><input type="radio" name="lcIoImp" value="one"${ioImportScope==='one'?' checked':''}
       ${hit?'':'disabled'}>
      <b>この一覧へ当てる</b><span>${hit?'保存せずに画面へ当てます（気に入らなければ閉じれば戻ります）'
        :'ファイルにこの一覧ぶんが入っていません'}</span></label>
     <label><input type="radio" name="lcIoImp" value="all"${ioImportScope==='all'?' checked':''}>
      <b>ファイルにある全部をマスタへ書き込む</b>
      <span>${items.length}件。<b>今の設定は対象ごとに置き換わります</b>（元へは戻せません）</span></label>
    </div>`:''}
   <p class="lc-io-what">取り込むのは列の設定だけです。<b>この端末に無い列の設定は飛ばします</b>
    （項目名が変わっていることに気づけるよう、飛ばした件数を必ず出します）。</p>`;
  const fb=ioEl('lcIoFile');
  if(fb)fb.onclick=()=>ioEl('lcImportFile').click();
  body.querySelectorAll('input[name=lcIoImp]').forEach(r=>{
   r.onchange=()=>{ioImportScope=r.value;renderIo()};
  });
  if(items&&!hit)ioImportScope='all';
  note.textContent=items?(ioImportScope==='all'
    ?`${items.length}件をマスタへ書き込みます`
    :'この一覧へ当てます（保存は別操作）')
   :'書き出したファイル(JSON)を選んでください';
  run.disabled=!items;
 }
 async function pickIoFile(e){
  const file=e.target.files&&e.target.files[0];
  e.target.value='';
  if(!file)return;
  try{
   const data=JSON.parse(await file.text());
   let items=null;
   if(data&&data.kind===IO_KIND&&Array.isArray(data.items))
    items=data.items.filter(x=>x&&x.target&&x.body).map(x=>({target:String(x.target),body:x.body}));
   else if(data&&data.kind===IO_KIND_ONE&&data.body)
    items=[{target:String(data.target||target),body:data.body}];
   if(!items||!items.length)throw Error('列の設定ファイルではありません（中身が空です）。');
   ioFile={name:file.name,items};
   ioImportScope=items.some(x=>x.target===target)?'one':'all';
  }catch(err){ioFile=null;showToast&&showToast('読み込めませんでした',err.message,5000)}
  renderIo();
 }
 function ioDownload(payload,name){
  const blob=new Blob([JSON.stringify(payload,null,1)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=name;
  document.body.appendChild(a);a.click();
  requestAnimationFrame(()=>{URL.revokeObjectURL(a.href);a.remove()});
 }
 const ioSafe=t=>String(t||'').replace(/[^\w一-龠ぁ-んァ-ヶー]+/g,'_');
 async function runIo(){
  if(ioMode==='export'){
   const items=ioScope==='all'?(ioAll||[]):[{target,body:draftBody()}];
   if(!items.length){showToast&&showToast('書き出すものがありません','',3000);return}
   ioDownload({kind:IO_KIND,version:1,savedAt:new Date().toISOString(),items},
    ioScope==='all'?`列の設定_すべて_${items.length}件.json`:`列の設定_${ioSafe(target)}.json`);
   showToast&&showToast('書き出しました',`${items.length}件の対象を1つのファイルへ入れました`,3200);
   closeIo();
   return;
  }
  const items=ioFile&&ioFile.items;
  if(!items)return;
  if(ioImportScope==='one'){
   const hit=items.find(x=>x.target===target);
   if(!hit)return;
   useBody(hit.body,`ファイル「${ioFile.name}」から読み込みました（保存するまでは元に戻せます）`);
   closeIo();
   return;
  }
  if(!(await confirmModal(`ファイルにある ${items.length}件の列設定をマスタへ書き込みますか？\n`
    +`対象ごとに今の設定を置き換えます（元へは戻せません）。\n\n`
    +items.slice(0,8).map(x=>'・'+ioTargetLabel(x.target)).join('\n')
    +(items.length>8?`\n…ほか${items.length-8}件`:''))))return;
  let ok=0,ng=0;
  for(const x of items){
   try{
    await WL.columnLayout.save(x.target,{order:x.body.order||[],widths:x.body.widths||{},
      hidden:x.body.hidden||[],names:x.body.names||{},formats:x.body.formats||{},
      rules:x.body.rules||{},formulas:x.body.formulas||{},locks:x.body.locks||[],
      /* **`sorts`・`aligns`を書き漏らさない**（§9.211 ①。全置換なので消える） */
      sorts:x.body.sorts||{},aligns:x.body.aligns||{}});
    ok++;
   }catch(e){ng++;console.warn('列設定の書き込みに失敗',x.target,e)}
  }
  /* 書き込んだ先の写しは捨てる——次に開いたときにマスタから取り直させる
     (当てた覚えの無い古い形で描かれるのを防ぐ)。 */
  WL.columnLayout.forget();
  /* **捨てるだけでは足りない**（§9.216 ③）。`get()`は畳んだ結果を覚える
     （§9.212 ③のメモ化）ので、捨てた直後に誰かが引くと**まだ取り直して
     いない空の形**がそのまま写しへ入り直す——`load()`は「写しがあれば
     取りに行かない」ので、取り込んだ設定が画面から消えたまま戻らない
     （実際には保存できているのに、一覧を開き直すまで消えたように見える）。
     **いま開いている一覧ぶんだけは取り直してから続ける**（他の対象は
     次に開いたときの`load()`が取りに行く）。 */
  try{await WL.columnLayout.load(target)}catch(_){}
  closeIo();
  showToast&&showToast(`${ok}件を取り込みました`,ng?`${ng}件は書き込めませんでした（ログ・診断を確認してください）`
                                                 :'一覧を開き直すと反映されます',5000);
  /* 取り込んだ結果は**もう保存済み**なので、下書きは置かない——`useBody()`で
     当てると「未保存の変更」に見え、保存せずに閉じた拍子に`discard()`で
     捨てられる（＝取り込んだのに戻ったように見える）。保存済みから
     パネルを組み直す。 */
  loadDraft();renderOrigins();renderList();renderDetail();
  panelSrc.afterApply();
  const foot=document.getElementById('lcFootNote');
  if(foot)foot.textContent=`ファイルから ${ok}件を取り込みました（マスタへ保存済みです）`;
 }

 async function reset(){
  marked.clear();
  /* 式で作った列は**残す**——「既定に戻す」で消えると、作った本人が
     作り直すことになる(見せ方の初期化と、列そのものの削除は別の操作)。 */
  /* **下書きの項目を1つでも書き漏らさないこと**（§9.113と同じ形）。
     `aligns`を落とすと`alignFieldsHtml()`が`undefined[列名]`で落ち、
     右ペインが丸ごと描けなくなる（`test_colpreset`が捕まえた）。 */
  draft={order:allKeys(),hidden:new Set(),widths:{},names:{},formats:{},rules:{},
         formulas:{...(draft&&draft.formulas||{})},locks:new Set(),sorts:{},aligns:{}};
  renderOrigins();renderList();renderDetail();applyLive();
 }

 /* source を渡すと別の対象へ同じパネルを使う(§9.120)。省略＝仕掛一覧。 */
 function open(source){
  panelSrc=source||LIST_SOURCE;
  target=panelSrc.target();
  if(!target){showToast&&showToast(panelSrc.noTargetToast||'一覧を先に開いてください',
                                   panelSrc.noTargetNote||'列の設定はその一覧ごとに保存します',3200);return}
  ensurePanel();
  /* 閉じたときは下書きを捨てるだけでよい(§9.212 ③)ので、控えは持たない。 */
  marked.clear();
  closeIo();
  /* **どの対象の設定かを見出しに出す。** 同じ見た目のパネルを別の対象へ
     使い回すので、名前が変わらないと「いま何を触っているか」が分からない。 */
  const eb=document.getElementById('lcEyebrow'),ti=document.getElementById('lcTitle'),
        ld=document.getElementById('lcLead');
  if(eb)eb.textContent=panelSrc.eyebrow||'一覧の見せ方';
  if(ti)ti.textContent=panelSrc.title?panelSrc.title():'列の設定';
  if(ld&&panelSrc.lead)ld.innerHTML=panelSrc.lead;
  /* 使えない機能は**ボタンごと消す**(§9.120)——押せるのに何も起きない、
     では壊れているようにしか見えない。内容欄は計算式を持たない。 */
  const fxBtn=document.getElementById('lcAddCol');
  if(fxBtn)fxBtn.hidden=!(panelSrc.features&&panelSrc.features.formula);
  const presetBox=document.querySelector('#'+PANEL_ID+' .lc-presets');
  if(presetBox)presetBox.hidden=!(panelSrc.features&&panelSrc.features.preset);
  /* 結合されてきた列は一覧を読むたびに変わり得る(結合できたかどうかで
     増えたり減ったりする)ので、**開くたびに取り直す**。 */
  /* 開き直したら一度は聞き直す（前回読めなかったときのため）。 */
  scopeAsked.delete(target);
  renderScope();
  joined=joinedKeys();
  originFilter='';
  /* **状態の絞り込みも開くたびに外す**（§9.248 ④）——覚えたままだと、
     次に開いたとき候補が半分しか無く「列が消えた」と読まれる。 */
  stateFilter='';
  loadDraft();
  renderOrigins();renderList();renderDetail();
  document.getElementById(PANEL_ID).hidden=false;
  /* 保存済みの設定は**開くたびに取り直す**——他のPCで登録されたものが
     あるので、覚えたままだと出てこない(それが登録先をマスタにした理由)。
     一覧の描画は待たせない。 */
  loadPresets();
 }
 /* 保存せずに閉じたら、後ろの一覧を開いたときの形へ戻す。**触った結果が
    そのまま残ると「保存」の意味が無くなる**(何が保存済みか分からなくなる)。

    **戻し方は「下書きを捨てる」だけ**(§9.212 ③)。以前は開いた時点の写し
    (`original`)を`stage()`で当て直していたが、この写しは**保存済みと同じ
    入れ物**を上書きするので:
     - パネルを開いたまま見出しの取っ手で引いた幅（保存済み）まで巻き戻り、
       **保存したはずの幅が画面から消える**（§9.211 ①でその場しのぎの
       `noteSaved()`を足したが、控えを2重に持つのが元の無理）
     - 逆に見出し側の保存が**パネルの未保存の下書きごと**マスタへ書いた
    いまは下書きが別の重ねなので、捨てれば保存済みがそのまま出る。 */
 function close(){
  const el=document.getElementById(PANEL_ID);if(el)el.hidden=true;
  closeIo();
  if(target){
   WL.columnLayout.discard(target);
   panelSrc.afterApply();
  }
 }
 function toggle(){
  const el=document.getElementById(PANEL_ID);
  if(el&&!el.hidden)close();else open();
 }

 window.WL=window.WL||{};
 WL.listColumns={open,close,toggle};
})();
