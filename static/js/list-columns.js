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
 let target='',draft=null,picked='',original=null,saved=false;

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
  title:()=>'表示列の設定',
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
  virtual:()=>LIST_VIRTUAL,
  /* 結合されてきた列の名前は**サーバーが返す**(§9.105)。列名から
     見分ける手がかりは無いので、画面側で推測しない。 */
  joined:()=>new Set(Array.isArray(S.joinQuality&&S.joinQuality.addedColumnNames)
                      ?S.joinQuality.addedColumnNames:[]),
  joinFrom:()=>{const t=S.joinQuality&&S.joinQuality.table;
                return t?`品質データ（${t}）`:'別のデータソース'},
  /* 使う分類(§9.105)。内容欄のように1つしか無い対象では減らす
     ——「結合0 / 計算・操作0」が並んでも、覚える手間が増えるだけ。 */
  origins:()=>ORIGIN_ORDER,
  features:{formula:true,preset:true,width:true,format:true,rule:true},
  afterApply:()=>{if(typeof renderGrid==='function')renderGrid()},
  save:null,        // null=列レイアウトマスタへそのまま保存する
 };
 /* **`src`という名前は使わない**——式の編集が`const src=…`(式の文字列)を
    既に使っており、その関数の中では差し替え口が文字列に隠れて
    `panel.rows is not a function`になる(実際に踏んだ)。 */
 let panelSrc=LIST_SOURCE;
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
  WL.listRules.open({name,column:picked,onDone:saved=>{
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
      <span>列（上下にドラッグで並べ替え）</span>
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
     title="今の設定をファイル(JSON)に書き出します">書き出し</button>
    <button type="button" id="lcImport" class="lc-side-btn"
     title="書き出したファイル(JSON)を読み込みます">読み込み</button>
    <input type="file" id="lcImportFile" accept="application/json,.json" hidden>
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
  el.querySelector('#lcExport').onclick=exportPreset;
  el.querySelector('#lcImport').onclick=()=>el.querySelector('#lcImportFile').click();
  el.querySelector('#lcImportFile').onchange=importPreset;
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
  };
  if(!picked||!draft.order.includes(picked))picked=draft.order.find(k=>!isVirtual(k))||draft.order[0]||'';
 }

 /* この列の実データ1件が、今の設定でどう見えるか。書式・読み替えを
    通した結果をそのまま出す(一覧のセルと同じ関数)。 */
 function sampleCell(k){
  if(isVirtual(k))return {text:'（ボタン）',color:'',raw:''};
  const raw=sampleValue(k);
  if(raw==='')return {text:'',color:'',raw:''};
  const row=panelSrc.rows().find(r=>String(panelSrc.valueOf(r,k)??'')===String(raw));
  const out=WL.cellFormat.cell({raw,format:draft.formats[k]||null,rule:draft.rules[k]||'',row,column:k});
  return {text:out.text,color:out.color,raw:String(raw)};
 }

 /* いま絞り込みに残っている列。分類チップ・まとめて操作・リストが
    **同じ答え**を使う(別々に数えると画面の中で数が食い違う)。 */
 let originFilter='';
 function shownKeys(ignoreOrigin){
  const q=String(document.getElementById('lcFilter')?.value||'').trim().toLowerCase();
  return draft.order.filter(k=>{
   if(q&&!labelOf(k).toLowerCase().includes(q)&&!k.toLowerCase().includes(q))return false;
   if(!ignoreOrigin&&originFilter&&originOf(k)!==originFilter)return false;
   return true;
  });
 }
 function setAllVisible(on){
  shownKeys().forEach(k=>{if(on)draft.hidden.delete(k);else draft.hidden.add(k)});
  renderPreview();renderList();
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
 function renderOrigins(){
  const box=document.getElementById('lcOrigins');if(!box)return;
  const pool=shownKeys(true);
  const n=o=>pool.filter(k=>originOf(k)===o).length;
  const chip=(o,label,count,note)=>
   `<button type="button" class="lc-origin-chip lc-origin-${o}${originFilter===o?' is-on':''}"
     data-origin="${o}"${count?'':' disabled'} title="${esc(note)}"
     aria-pressed="${originFilter===o?'true':'false'}">${esc(label)}<b>${count}</b></button>`;
  box.innerHTML=
   `<button type="button" class="lc-origin-chip lc-origin-all${originFilter?'':' is-on'}" data-origin=""
     aria-pressed="${originFilter?'false':'true'}" title="すべての列">すべて<b>${pool.length}</b></button>`
   +(panelSrc.origins?panelSrc.origins():ORIGIN_ORDER).map(o=>chip(o,ORIGIN[o].label,n(o),
       o==='join'?`${ORIGIN[o].note}（${joinFrom()}）`:ORIGIN[o].note)).join('');
  box.querySelectorAll('.lc-origin-chip').forEach(b=>{
   b.onclick=()=>{originFilter=b.dataset.origin||'';renderOrigins();renderList()};
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
   <div class="lc-item${k===picked?' is-picked':''}${draft.hidden.has(k)?' is-off':''}" data-key="${esc(k)}" data-origin="${o}">
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
    renderCount();syncAllVisible();applyLive();
   });
   /* **選ぶのは click。** mouseup で選ぶ作りにすると、`el.click()` のような
      素のクリック(キーボード操作・自動化・支援技術)で選べなくなる。 */
   el.addEventListener('click',e=>{
    if(e.target.closest('.lc-vis'))return;
    picked=k;renderList();renderDetail();
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
   mark.remove();ghost.remove();el.classList.remove('lc-dragging');
   const o=draft.order,i=o.indexOf(key);
   if(i>=0){
    o.splice(i,1);
    const at=beforeKey?o.indexOf(beforeKey):o.length;
    o.splice(at<0?o.length:at,0,key);
   }
   renderList();applyLive();
  };
  document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
 }

 /* 触った結果を**保存せずに**後ろの一覧へ当てる(§9.90)。 */
 function applyLive(){
  WL.columnLayout.stage(target,{locks:[...draft.locks],
                                order:draft.order,widths:draft.widths,hidden:[...draft.hidden],
                                formulas:draft.formulas,
                                names:draft.names,formats:draft.formats,rules:draft.rules});
  panelSrc.afterApply();
  const note=document.getElementById('lcFootNote');
  if(note)note.textContent='一覧に反映しています（保存すると次に開いたときも同じ形で出ます）';
 }

 function renderCount(){
  const el=document.getElementById('lcCount');if(!el)return;
  const shown=draft.order.filter(k=>!draft.hidden.has(k)).length;
  el.textContent=`${shown} / ${draft.order.length} 列`;
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
  const rows=previewSamples(picked,3);
  if(!rows.length)return `<div class="lc-preview-head">結果</div>
    <p class="lc-preview-empty">この列に値のある行が、いま表示中の中にありません。</p>`;
  const f=fmtOf(picked),rule=draft.rules[picked]||'';
  const body=rows.map(({raw,row})=>{
   const out=WL.cellFormat.cell({raw,format:f,rule,row,column:picked});
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
   sampleHtml=rows.map(r=>{
    const v=c.run(r);
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
     この列は対象になりません。式が空のまま保存すると、この列は消えます。</p>
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
                                          row:panelSrc.rows().find(r=>String(panelSrc.valueOf(r,picked)??'')===String(sample)),
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
 }

 /* 一覧そのものが見本なので、パネルの中に別の表は持たない(§9.90)。
    設定を変えたら**リストの「見え方」と後ろの一覧の両方**を描き直す。
    **リストを忘れないこと**——書式や読み替えを変えても行の例が古いままだと、
    「効いていない」と受け取られる(実際にそう見える状態を作ってしまった)。 */
 function renderPreview(){renderOrigins();renderList();applyLive()}

 async function save(){
  try{
   /* 保存先が違う対象もある(§9.120)。作業スケジュールの内容欄は
      「どの項目を出すか」だけスケジュール内容表示マスタが持つので、
      **振り分けは差し替え口の1箇所**で行う(パネルは知らなくてよい)。 */
   const body={order:draft.order,widths:draft.widths,
               hidden:[...draft.hidden],names:draft.names,
               formats:draft.formats,rules:draft.rules,
               formulas:draft.formulas,locks:[...draft.locks]};
   if(typeof panelSrc.save==='function')await panelSrc.save(target,body);
   else await WL.columnLayout.save(target,body);
   saved=true;
   original={order:[...draft.order],hidden:[...draft.hidden],widths:{...draft.widths},
             names:{...draft.names},formats:JSON.parse(JSON.stringify(draft.formats)),
             rules:{...draft.rules},formulas:{...draft.formulas},locks:[...draft.locks]};
   showToast&&showToast(panelSrc.savedToast||'列の設定を保存しました',
                        panelSrc.savedNote||'この一覧を次に開いたときも同じ形で出ます',2600);
   const note=document.getElementById('lcFootNote');
   if(note)note.textContent='保存しました';
   panelSrc.afterApply();
  }catch(e){showToast&&showToast('保存に失敗しました',e.message,5000)}
 }
 /* ---------- 名前を付けて覚えさせる(§9.111) ----------
    保存するのは**今パネルに出ている下書き**(draft)。「保存」を押していない
    状態でも登録できるほうが自然で、そのまま一覧にも当たっている。 */
 let presets=[];
 const draftBody=()=>({order:[...draft.order],widths:{...draft.widths},
                       hidden:[...draft.hidden],names:{...draft.names},
                       formats:JSON.parse(JSON.stringify(draft.formats)),rules:{...draft.rules},
                       formulas:{...draft.formulas},locks:[...draft.locks]});
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
  };
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
 /* ファイルへの書き出し・読み込み。**対象(target)も一緒に書く**——
    別の一覧のファイルを読み込んだときに気づけるようにするため。 */
 function exportPreset(){
  const payload={kind:'wavelog-column-preset',version:1,target,
                 savedAt:new Date().toISOString(),body:draftBody()};
  const blob=new Blob([JSON.stringify(payload,null,1)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`列の設定_${target.replace(/[^\w一-龠ぁ-んァ-ヶー]+/g,'_')}.json`;
  document.body.appendChild(a);a.click();
  requestAnimationFrame(()=>{URL.revokeObjectURL(a.href);a.remove()});
 }
 async function importPreset(e){
  const file=e.target.files&&e.target.files[0];
  e.target.value='';
  if(!file)return;
  try{
   const data=JSON.parse(await file.text());
   if(!data||data.kind!=='wavelog-column-preset'||!data.body)
    throw Error('この一覧の設定ファイルではありません。');
   if(data.target&&data.target!==target
      &&!(await confirmModal(`このファイルは別の一覧（${data.target}）のものです。\n列名が違うと当たらない設定は捨てられます。読み込みますか？`)))return;
   useBody(data.body,`ファイル「${file.name}」を読み込みました（保存するまでは元に戻せます）`);
  }catch(err){showToast&&showToast('読み込めませんでした',err.message,5000)}
 }

 async function reset(){
  /* 式で作った列は**残す**——「既定に戻す」で消えると、作った本人が
     作り直すことになる(見せ方の初期化と、列そのものの削除は別の操作)。 */
  draft={order:allKeys(),hidden:new Set(),widths:{},names:{},formats:{},rules:{},
         formulas:{...(draft&&draft.formulas||{})},locks:new Set()};
  renderOrigins();renderList();renderDetail();applyLive();
 }

 /* source を渡すと別の対象へ同じパネルを使う(§9.120)。省略＝仕掛一覧。 */
 function open(source){
  panelSrc=source||LIST_SOURCE;
  target=panelSrc.target();
  if(!target){showToast&&showToast(panelSrc.noTargetToast||'一覧を先に開いてください',
                                   panelSrc.noTargetNote||'列の設定はその一覧ごとに保存します',3200);return}
  ensurePanel();
  /* 閉じたときに戻せるよう、開いた時点の値を控える。 */
  const cur=WL.columnLayout.get(target);
  original={order:[...(cur.order||[])],hidden:[...(cur.hidden||[])],widths:{...(cur.widths||{})},
            names:{...(cur.names||{})},formats:JSON.parse(JSON.stringify(cur.formats||{})),
            rules:{...(cur.rules||{})},formulas:{...(cur.formulas||{})},
            locks:[...(cur.locks||[])]};
  saved=false;
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
  joined=joinedKeys();
  originFilter='';
  loadDraft();
  renderOrigins();renderList();renderDetail();
  document.getElementById(PANEL_ID).hidden=false;
  /* 保存済みの設定は**開くたびに取り直す**——他のPCで登録されたものが
     あるので、覚えたままだと出てこない(それが登録先をマスタにした理由)。
     一覧の描画は待たせない。 */
  loadPresets();
 }
 /* 保存せずに閉じたら、後ろの一覧を開いたときの形へ戻す。**触った結果が
    そのまま残ると「保存」の意味が無くなる**(何が保存済みか分からなくなる)。 */
 function close(){
  const el=document.getElementById(PANEL_ID);if(el)el.hidden=true;
  if(!saved&&original&&target){
   WL.columnLayout.stage(target,original);
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
