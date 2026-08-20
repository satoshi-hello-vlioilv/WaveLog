"use strict";
/* master-maint.js: マスタ管理画面(統合パネル・編集モーダル・特殊タブ)
   ============================================================
   measurement-worklog.js から分離した(docs/REFACTORING_PLAN.md フェーズ3.1)。
   分離前は同ファイルの92%(1,700行超)がマスタ管理で、「マスタ管理を直すのに
   measurement-worklog を開く」状態が誤読・誤編集の温床になっていた。
   関数はそのまま移しており、改名・再分割はしていない(移動と分割を同時に
   やると差分レビューが不能になるため)。

   読み込み順は templates/index.html を参照。base.js の WL.registerView() を
   使うので base.js より後、access-mode.js より前に置くこと。
   ============================================================ */
(function(){
 /* ---------- マスタ管理モーダル（刷新版: 大画面・高密度・検索・IDリネーム更新） ---------- */
 const MASTER_DEFS=[
  {group:'equip',key:'operator',label:'オペレータ',icon:'人',endpoint:'/api/operator-master',hasDelete:true,
   fields:[{k:'name',label:'氏名',required:true,key:true},{k:'yomi',label:'ヨミガナ'},{k:'equipment',label:'作業可能設備',type:'equipment-multi'}],
   cols:[{k:'name',label:'氏名',grow:2},{k:'yomi',label:'ヨミガナ',grow:1},{k:'equipmentText',label:'作業可能設備',grow:3}]},
  {group:'equip',key:'device',label:'機器',icon:'器',endpoint:'/api/device-master',hasDelete:true,
   fields:[{k:'kind',label:'測定区分',type:'select',options:['板厚','板幅','その他',''],key:true},{k:'name',label:'機器名',required:true,key:true},{k:'note',label:'備考'}],
   cols:[{k:'kind',label:'測定区分',grow:1},{k:'name',label:'機器名',grow:2},{k:'note',label:'備考',grow:3}]},
  {group:'equip',key:'spool',label:'スプール種別',icon:'巻',endpoint:'/api/spool-master',hasDelete:true,
   fields:[{k:'name',label:'種別名',required:true,key:true},{k:'note',label:'備考'}],
   cols:[{k:'name',label:'種別名',grow:2},{k:'note',label:'備考',grow:3}]},
  {group:'equip',key:'inner',label:'内径種別',icon:'径',endpoint:'/api/inner-master',hasDelete:true,
   fields:[{k:'name',label:'内径種別',required:true,key:true},{k:'note',label:'備考'}],
   cols:[{k:'name',label:'内径種別',grow:2},{k:'note',label:'備考',grow:3}]},
  {group:'equip',key:'burr',label:'バリ揃え',icon:'バ',endpoint:'/api/burr-master',hasDelete:true,
   fields:[{k:'name',label:'バリ揃え',required:true,key:true},{k:'note',label:'備考'}],
   cols:[{k:'name',label:'バリ揃え',grow:2},{k:'note',label:'備考',grow:3}]},
  {group:'equip',key:'coilStop',label:'コイル止め',icon:'止',endpoint:'/api/coil-stop-master',hasDelete:true,
   fields:[{k:'name',label:'コイル止め',required:true,key:true},{k:'note',label:'備考'}],
   cols:[{k:'name',label:'コイル止め',grow:2},{k:'note',label:'備考',grow:3}]},
  /* 設備はインラインのまま(§9.114)。項目が4つになってモーダルの基準に
     かかるが、**どれも短い1行**なのでフォームは縦に伸びず、モーダルにする
     理由(一覧を圧迫する)が当てはまらない。設備の登録は他マスタの下ごしらえ
     として一番よく使うので、1画面で完結するほうが速い。 */
  /* ---------- 操業データ（§9.215、利用者の指示） ----------
     「項目自体をマスタ化し他の設備でも使えるように設備ごとに持たせ、変更
      できるようにする、設定値も必要に応じてマスタ化して関連付け。各項目ごと、
      入力方式や入力上限値、入力データの型を選べるようにする」。
     項目と選択肢を**別のマスタ**にしてあるのは、同じ選択肢（リング色など）を
     複数の項目が参照するため。結び付けは**名前**で行う（IDだと別PCで連番が
     食い違う。§9.171）。 */
  /* **並べたときにどう見えるかを出す**（§9.216 ④）。行を1つずつ編集する
     一覧では、カードに収まるかどうかも群のまとまりも分からない。
     `special`の画面で測定画面と同じ6列のグリッドを出し、掴んで動かす。
     `fields`/`cols`は残す——編集モーダルの部品としてではなく、
     `tests/test_crudroutes.py`が4本のCRUDを見張る材料になっている。 */
  {group:'equip',key:'opItem',label:'操業データ項目',icon:'操',endpoint:'/api/operation-item-master',
   hasDelete:true,special:'op-item',titleText:'操業データ — 測定画面に出す入力欄と並び',
   fields:[{k:'equipment',label:'対象設備',type:'equipment-multi-text',required:true,key:true,
            tagHint:'この項目をどの設備の測定画面へ出すかです。複数選べます。「すべての設備」を選ぶと、これから増える設備でも自動的に出ます。'},
           {k:'group',label:'群',hint:'測定画面でひとまとまりに並べる見出しです（例: 巻取り／スリット）。空欄なら「その他」。'},
           {k:'name',label:'項目名',required:true,key:true,
            hint:'測定画面に出る名前で、記録の鍵にもなります。**変えると、それまでの記録は前の名前のまま残ります。**'},
           {k:'type',label:'型',type:'select',options:['整数','正の整数','数値','正の数','選択','文字'],
            hint:'整数=小数点なし／正の◯=マイナス不可／選択=下の「選択肢」から選ぶ／文字=自由記述。'},
           {k:'decimals',label:'小数桁',type:'number',min:0,max:4,
            hint:'小数点以下の桁数（型が「数値」「正の数」のときだけ効きます）。空欄なら1桁。'},
           {k:'min',label:'最小値',type:'number',hint:'これより小さい値は入力時に戻します。空欄なら下限なし。'},
           {k:'max',label:'最大値',type:'number',hint:'これより大きい値は入力時に戻します。空欄なら上限なし。'},
           {k:'choice',label:'選択肢',type:'master-combo',source:{endpoint:'/api/operation-choice-master',valueKey:'name'},
            hint:'型が「選択」のとき、操業データ選択肢マスタのどのまとまりから選ばせるかです。名前で結び付けます。'},
           {k:'unit',label:'単位',hint:'欄の右へ小さく添えます（mm など）。'},
           {k:'order',label:'表示順',type:'number',min:0,step:10,
            hint:'小さいほど上に出ます。空欄で保存すると今の並びのままです。'}],
   cols:[{k:'equipment',label:'対象設備',grow:2,format:'equipmentTarget'},{k:'group',label:'群',grow:1},
         {k:'name',label:'項目名',grow:2},{k:'type',label:'型',grow:1},
         {k:'choice',label:'選択肢',grow:1},{k:'order',label:'表示順',grow:1}],
   hint:'測定画面①準備の「操業データ」に出る入力欄です。1行＝1つの欄で、設備ごとに変えられます（「すべての設備」を選べば設備が増えても登録し直す必要はありません）。**値そのものは測定データの中に入る**ので、このマスタには記録は残りません。項目名を変えると、それまでに記録した値は前の名前のまま残ります（消えはしませんが、新しい名前の欄は空で始まります）。'},
  {group:'equip',key:'opChoice',label:'操業データ選択肢',icon:'択',endpoint:'/api/operation-choice-master',hasDelete:true,
   fields:[{k:'name',label:'選択肢名',required:true,key:true,
            hint:'まとまりの名前です。操業データ項目マスタの「選択肢」からこの名前で参照します（例: リング色）。'},
           {k:'value',label:'値',required:true,key:true,hint:'実際に選ばせる1つの値です（例: 茶）。'},
           {k:'order',label:'表示順',type:'number',min:0,step:10,
            hint:'小さいほど先に出ます。空欄で保存すると今の並びのままです。'}],
   cols:[{k:'name',label:'選択肢名',grow:2},{k:'value',label:'値',grow:2},{k:'order',label:'表示順',grow:1},
         /* **どの項目が使っているか**(§9.216 ④)。使い道の見えない選択肢は
            消してよいのか判断できず、消すと項目側は黙って空の欄になる。 */
         {k:'usedBy',label:'使っている項目',grow:3}],
   hint:'操業データの「選択」型の項目で選ばせる値です。1行＝1つの値で、同じ選択肢名の行がまとまって1つの選択肢になります。**同じまとまりを複数の項目が参照できます**（大径リング色と小径リング色はどちらも「リング色」を見ています）。ここで値を足すと、参照しているすべての項目の選択肢に増えます。'},
  {group:'equip',key:'equipment',label:'設備',icon:'設',endpoint:'/api/equipment-master',hasDelete:true,
   editorModal:false,
   fields:[{k:'name',label:'設備名',required:true,key:true},
           {k:'kind',label:'区分',type:'select',options:['','コイル','板'],
            hint:'この設備が扱う材料の形です。空欄のままでも登録・編集できます（未設定）。'},
           {k:'maxStrips',label:'最大条数',type:'number',min:1,max:40,
            hint:'この設備で幅方向に割れる条数の上限。空欄なら40（測定データの構造上の上限）。'},
           {k:'standardMinutes',label:'1ロットあたり標準時間（分）',type:'number',min:1,max:1440,step:1,
            hint:'実績がまだ無いときに作業スケジュールの見積として使う分数です。空欄なら120分（全体の暫定既定値）。実績がたまると自動で実績由来の見積へ切り替わります。'}],
   cols:[{k:'name',label:'設備名',grow:2},{k:'kind',label:'区分',grow:1,format:'equipmentKind'},
         {k:'maxStrips',label:'最大条数',grow:1,format:'maxStrips'},
         {k:'standardMinutes',label:'標準時間',grow:1,format:'standardMinutes'}],
   hint:'「区分」はその設備が扱う材料の形（コイル／板）です。既に登録してある設備は未設定のままでも今までどおり動きます。「最大条数」は幅分割（条割）で割れる条数の上限です。設備によって割れる本数が違うため設備ごとに登録します。空欄のままなら40条（測定データの構造上の上限）として扱います。子ロットの数（最大9ロット）とは別の値です。「1ロットあたり標準時間」は、実績がまだ1件も無い設備の作業スケジュールで見積として使う分数です。実績がたまると実績から算出した見積（換算係数）が優先されるため、あくまで最初の保険として登録します。'},
  {group:'system',key:'accessPermission',label:'アクセス権限',icon:'権',endpoint:'/api/access-permission-master',hasDelete:true,
   fields:[{k:'loginId',label:'ログインID',key:true},{k:'pcName',label:'PC名',key:true},
           {k:'canEdit',label:'編集可否',type:'select',options:['編集可','閲覧のみ']},
           {k:'canSchedule',label:'スケジュール可否',type:'select',options:['不可','可']},
           {k:'canFieldReorder',label:'現場段取り可否',type:'select',options:['不可','可']},
           {k:'fieldReorderEquipment',label:'現場段取り対象設備',type:'equipment-multi-text'}],
   cols:[{k:'loginId',label:'ログインID',grow:2},{k:'pcName',label:'PC名',grow:2},{k:'canEdit',label:'編集可否',grow:1},{k:'canSchedule',label:'スケジュール',grow:1},{k:'canFieldReorder',label:'現場段取り',grow:1},{k:'fieldReorderEquipment',label:'対象設備',grow:2,format:'equipmentTarget'}],
   hint:'ログインID・PC名はどちらか一方だけの登録もできます(汎用的な運用のため)。片方だけ登録した場合、もう一方は「問わない」という意味になります(例: ログインIDだけ登録すると、そのユーザーはどの端末からでもこの権限になります)。両方登録した組み合わせが最優先で一致し、次に片方だけの登録、両方空欄の登録(全端末共通の既定)の順に判定します。登録の無い組み合わせは既定で編集可能・スケジュール不可・現場段取り不可として扱われます。特定の端末を閲覧専用にしたい場合はその端末を「閲覧のみ」で、作業スケジュールを操作させたい場合は「スケジュール可否」を「可」で登録してください。「現場段取り可否」は編集モードの端末に限り、対象設備の並べ替えだけを追加で許可します。対象設備は複数選べます。「すべての設備」を選ぶと全設備の並べ替えを許可します（開発・保守用。設備が増えても権限行を足さずに済みます）。'},
  {group:'schedule',key:'loadFactor',label:'換算係数',icon:'率',special:'load-factor',endpoint:'/api/schedule/load-factors'},
  {group:'schedule',key:'stopCategory',label:'設備停止分類',icon:'類',endpoint:'/api/schedule/stop-category-master',hasDelete:true,
   fields:[{k:'name',label:'分類名',required:true,key:true}],
   cols:[{k:'name',label:'分類名',grow:2}],
   hint:'設備停止マスタの「分類」の選択肢です。分類は設備をまたいだ集計・色分けに使うため、設備ごとではなく全設備共通で持ちます。設備停止マスタで未登録の分類を入力して保存すると、ここへも自動で登録されます(先にこの画面で作っておく必要はありません)。使用中の分類を削除しようとすると、何件で使われているかを確認したうえで消します。'},
  {group:'schedule',key:'stopReason',label:'設備停止',icon:'停',endpoint:'/api/schedule/stop-reason-master',hasDelete:true,
   fields:[{k:'equipment',label:'対象設備',type:'equipment-multi-text',required:true,key:true,
            tagHint:'この停止内容をどの設備で選べるようにするかです。複数選べます。「すべての設備」を選ぶと、これから増える設備でも自動的に選べます。'},
           {k:'category',label:'分類',type:'master-combo',source:{endpoint:'/api/schedule/stop-category-master',valueKey:'name'},
            hint:'設備停止分類マスタから選びます。無い分類は「＋ 新しく追加…」で入力すると、保存時に分類マスタへも登録されます。'},
           {k:'name',label:'名称',required:true,key:true},
           {k:'standardMinutes',label:'標準所要分',required:true,type:'number',unit:'分',step:5,min:0,
            hint:'この停止に通常かかる時間です。対象設備で時間が違う場合は、設備ごとに分けて登録してください。＋−ボタンで5分ずつ増減できます。'}],
   cols:[{k:'equipment',label:'対象設備',grow:2,format:'equipmentTarget'},{k:'category',label:'分類',grow:1},{k:'name',label:'名称',grow:2},{k:'standardMinutes',label:'標準所要分',grow:1}],
   hint:'作業スケジュール(docs/SCHEDULE_MODE_DESIGN.md §5.3)の設備停止予定で選べる名称と、標準所要分(分)です。1件の停止内容を複数の設備へまとめて登録できます。「すべての設備」を選べば、設備が増えても登録し直す必要がありません。標準所要分が設備ごとに違う場合は、設備を分けて別々に登録してください(同じ名称で対象設備が重なる登録はできません。どちらの時間が効くのか決まらなくなるためです)。「突発停止」は現場からの連絡を受けた計画担当が投入する運用のため、名称に登録しておくだけで自動では動きません。'},
  {group:'schedule',key:'shiftMaster',label:'勤務形態',icon:'勤',special:'shift-pattern',endpoint:'/api/schedule/shift-pattern-master'},
  /* 測定データの置き場(§9.202、利用者の指示)。**3段あることを図で示す**
     ——「入力したのに完了に出ない」「DBへ同期が何をするのか分からない」
     「バックアップの設定画面が無い」は、どれも置き場の関係が画面に
     書かれていないことが元だった。設定もここへ集める（共通設定から移動。
     同じ設定を2画面に置かない＝§9.168と同じ作法）。 */
  {group:'system',key:'measStorage',label:'測定データの保存',icon:'測',special:'meas-storage',
   titleText:'測定データの保存 — どこに何が入るか'},
  {group:'system',key:'importBackup',label:'データ引継ぎ',icon:'継',special:'import-backup'},
  /* データ接続(§9.168)。**1行＝1つのデータソース**で、「これは何か／どこから
     読むか／この設定で何ができるか」を1枚のカードにまとめる。読み込み先の
     個別上書きは以前パス設定タブにあったが、同じ「どこを読むか」の設定が
     2画面に分かれていたため、**データソース側へ寄せた**（保存先は今までどおり
     パス設定マスタなので、検証用の差し替えはそのまま効く）。 */
  {group:'system',key:'dataSource',label:'データ接続',icon:'源',special:'data-source',
   titleText:'データ接続 — このアプリが読むデータ',
   endpoint:'/api/data-source-master',hasDelete:true},
  /* クエリ結合(§9.193)。**データ接続に登録済みのものだけを組み合わせる**
     （利用者の指示）。データ接続のすぐ下に置くのは、「読む」→「つなぐ」が
     そのまま作業の順番だから（視覚導線と作業導線を一致させる）。 */
  {group:'system',key:'queryJoin',label:'クエリ結合',icon:'結',endpoint:'/api/query-join-master',hasDelete:true,
   special:'query-join',titleText:'クエリ結合 — 読んだデータ同士をつなぐ'},
  {group:'system',key:'pathConfig',label:'共通設定',icon:'共',special:'path-config',
   titleText:'共通設定 — この端末の共有パス・RNE・間隔',endpoint:'/api/path-config-master'},
  // 旧「マスタ一覧」(サイドバーのMASTERナビ→汎用グリッド)をここへ統合した
  // (ARCHITECTURE.md「マスタ管理の画面形態」)。上のタブが扱わないテーブル(スケジュール列表示マスタ
  // 等)も含め、master.sqlite3の中身をそのまま確認するための読み取り専用タブ。
  {group:'system',key:'rawTable',label:'テーブル生データ',icon:'表',special:'raw-table',readOnly:true},
 ];
 let maintState={defKey:'operator',items:[],editing:null,query:''};
 function currentDef(){return MASTER_DEFS.find(d=>d.key===maintState.defKey)||MASTER_DEFS[0]}
 // scheduleモードは作業予定(schedule Blueprint)以外のマスタへ書込できない
 // (backend/access_mode.pyの_WRITE_ALLOWED_MODES)。マスタ管理モーダル自体は
 // 開けるようにしつつ(設備停止マスタはscheduleモードでのみ書込可能なため)、
 // タブは自分のBlueprintで書けるものだけに絞る。
 function maintDefVisible(def){
  const mode=(window.accessMode&&window.accessMode.mode)||'edit';
  if(mode!=='schedule')return true;
  // 読み取り専用のタブ(テーブル生データ)は書込権限と無関係なのでどのモードでも
  // 出す。旧「マスタ一覧」ナビが全モードで見られた挙動を統合後も保つため(ARCHITECTURE.md「マスタ管理の画面形態」)。
  if(def.readOnly)return true;
  return !!(def.endpoint&&def.endpoint.indexOf('/api/schedule/')===0);
 }
 function firstVisibleDefKey(){const d=MASTER_DEFS.find(maintDefVisible);return d?d.key:MASTER_DEFS[0].key}
 /* マスタ種別のグループ(情報アーキテクチャ): 13種を平坦に並べると
    「どれが何の設定か」を毎回読んで探すことになるため、利用者の頭の中の
    分類(誰が・何を使うか / 作業スケジュールの設定 / システム寄りの設定)で
    3つに束ねる。1グループ5件前後=一度に見渡せる粒度(Miller)。 */
 const MASTER_GROUPS=[
  {key:'equip',label:'設備・人',hint:'測定の現場で使う基本マスタ'},
  {key:'schedule',label:'作業スケジュール',hint:'計画の時間計算に使う設定'},
  {key:'system',label:'表示・システム',hint:'画面表示と端末・データの設定'},
 ];
 function renderMaintNav(){
  const nav=$('#masterMaintNav');if(!nav)return;
  const visible=MASTER_DEFS.filter(maintDefVisible);
  const html=MASTER_GROUPS.map(g=>{
   const defs=visible.filter(d=>(d.group||'system')===g.key);
   if(!defs.length)return '';
   return `<div class="mm-nav-group"><div class="mm-nav-group-label" title="${esc(g.hint)}">${esc(g.label)}</div>`+
    defs.map(d=>`<button type="button" data-master="${d.key}"><span class="mm-nav-ico" aria-hidden="true">${esc(d.icon)}</span><span class="mm-nav-label">${esc(d.label)}</span></button>`).join('')+
    '</div>';
  }).join('');
  nav.innerHTML=html;
  nav.querySelectorAll('[data-master]').forEach(b=>b.onclick=()=>{maintState.defKey=b.dataset.master;maintState.editing=null;maintState.query='';const se=$('#masterMaintSearch');if(se)se.value='';syncNav();loadMaint(true)});
  syncNav();
 }

 /* ---------- 画面の形態(ARCHITECTURE.md「マスタ管理の画面形態」改訂) ----------
    以前は全画面シェード付きのモーダル(.record-modal.mm-modal)だったが、
    「モーダルにした意味が無い使い方(常時開きっぱなしで一覧を見る画面)」
    という指摘のため、帳票(rp-mode)・実績カレンダー(cal-mode)・作業スケジュール
    (sc-mode)と同じメイン画面統合型(body.mm-mode + #masterMaintPanel)へ
    作り直した。内側の構造(.mm-dialog以下)とid(#masterMaintNav/
    #masterMaintForm/#masterMaintList等)は一切変えていないため、
    データ引継ぎ・換算係数・パス設定といった特殊タブの描画コードは
    そのまま動く(.mm-panel .mm-dialogのCSSで寸法だけ上書きする)。 */
 function ensureMaintPanel(){
  let panel=$('#masterMaintPanel');if(panel)return panel;
  panel=document.createElement('section');panel.className='mm-panel';panel.id='masterMaintPanel';panel.hidden=true;
  /* 見出しの帯は持たない。画面名と説明はヘッダー(#fileName)が、更新者IDは
     ヘッダーの操作列(#headerViewBar)が受け持つ。「×」も置かない——他の画面に
     無く、左のメニューから移れば閉じるため、この画面だけ閉じ方が違っていた。 */
  panel.innerHTML=`<div class="mm-dialog">
   <div class="mm-head" id="mmHead">
    <label class="mm-head-user">更新者ID<input id="masterUserId" type="text" autocomplete="off" placeholder="社員番号など"></label>
    <div class="mm-search"><span class="mm-search-icon" aria-hidden="true">🔍</span><input id="masterMaintSearch" type="search" placeholder="一覧を絞り込み（名称・更新者など）" autocomplete="off"></div>
    <button id="reloadMasterMaint" type="button" class="mm-btn-ghost">再読込</button>
   </div>
   <div class="mm-body">
    <nav class="mm-nav" id="masterMaintNav" aria-label="マスタ種別"></nav>
    <section class="mm-main">
     <!-- 見出しだけを残す。絞り込みと再読込は**操作**なのでヘッダーの
          操作列(#mmHead → #headerViewBar)が持つ(§9.100)。ここに残すと、
          この画面だけ操作の置き場が2段になる。 -->
     <div class="mm-toolbar">
      <div class="mm-toolbar-left"><b id="masterMaintTitle">オペレータ</b><span class="mm-count" id="masterMaintCount"></span></div>
     </div>
     <form class="mm-form" id="masterMaintForm"></form>
     <div class="mm-list-wrap"><div class="mm-list" id="masterMaintList"></div></div>
    </section>
   </div>
  </div>`;
  const grid=$('#grid');grid?.parentNode?.insertBefore(panel,grid);
  const uid=$('#masterUserId');if(uid){uid.value=currentUserId();uid.onchange=()=>setUserId(uid.value)}
  $('#reloadMasterMaint').onclick=()=>loadMaint(true);
  const search=$('#masterMaintSearch');if(search){search.oninput=()=>{maintState.query=search.value;renderMaintList()}}
  renderMaintNav();
  return panel;
 }
 function exitMasterMaint(){
  if(!document.body.classList.contains('mm-mode'))return;
  document.body.classList.remove('mm-mode');
  const panel=$('#masterMaintPanel');if(panel)panel.hidden=true;
  closeMaintEditor();
  document.getElementById('openMasterMaint')?.classList.remove('active');
 }
 window.exitMasterMaint=exitMasterMaint;
 /* 更新者IDの入力はヘッダーの#headerViewBarへ移す(WL.enterViewの
    mountViewToolbar参照)。副題は保存先のファイル名ではなく、この画面で
    何ができるかを書く(ファイル名は開発者向けの情報で、現場では読めても
    意味が無い)。 */
 WL.registerView({key:'master',bodyClass:'mm-mode',nav:'openMasterMaint',toolbar:'#mmHead',
  header:['マスタ管理','登録内容の追加・編集・無効化（更新者IDとともに記録）'],exit:exitMasterMaint});
 function syncNav(){document.querySelectorAll('#masterMaintNav [data-master]').forEach(b=>b.classList.toggle('active',b.dataset.master===maintState.defKey))}
 function requireMaintUser(){const el=$('#masterUserId');const id=String(el?el.value:'').trim();if(!id){showToast('更新者IDを入力してください','マスタ更新には更新者IDが必要です。',4200);el&&el.focus();return null}setUserId(id);return id}

 /* ---------- モーダル化の基準(ARCHITECTURE.md「マスタ管理の画面形態」) ----------
    「モーダルにする意味」をここ1箇所で定義する。
      ・一覧・検索・軽い追加は常にメイン画面(統合パネル)側で完結させる。
        画面を覆う理由が無く、覆うと背後の一覧と見比べられなくなるため。
      ・入力項目が多い/専用コントロールを伴う編集だけをモーダルにする。
        上部インラインフォームのままだと縦幅を大きく取って一覧の表示領域を
        圧迫し、フォームと一覧のどちらも中途半端に見える状態になるため
        (実際に報告された指摘)。編集の間は一覧を操作させない方が安全でもある。
    判定は「入力項目がEDITOR_MODAL_MIN_FIELDS以上」「専用コントロール
    (設備の複数選択タグ入力)を含む」「defで明示(editorModal:true)」のいずれか。
    現状: オペレータ(タグ入力)・アクセス権限(6項目)・設備停止(4項目)・
    勤務形態(4項目)がモーダル、機器/スプール/内径/設備はインラインのまま。

    **項目数はあくまで「フォームが縦に伸びるか」の目安**であって、目的
    そのものではない(§9.114)。短い1行の項目が4つ並ぶだけならフォームは
    伸びないので、モーダルにする理由が無い。`editorModal:false`で外せる
    ようにしてあるが、**理由の書けるものだけ**にすること
    ——外すたびに「どの画面がどちらなのか」が覚えられなくなる。
    しきい値そのものを動かさないこと: 5へ上げると設備停止(4項目)・
    勤務形態(4項目)が黙ってインラインへ戻り、頼まれていない画面が変わる。 */
 const EDITOR_MODAL_MIN_FIELDS=4;
 const RICH_FIELD_TYPES=['equipment-multi','equipment-multi-text'];
 function defUsesEditorModal(def){
  if(!def||!Array.isArray(def.fields)||!def.fields.length)return false;
  if(def.editorModal===false)return false;   // 明示で外す(理由はdef側に書く)
  if(def.editorModal===true)return true;
  if(def.fields.some(f=>RICH_FIELD_TYPES.includes(f.type)))return true;
  return def.fields.length>=EDITOR_MODAL_MIN_FIELDS;
 }

 /* ================= 入力支援(docs/SCHEDULE_MODE_DESIGN.md §9.49) =================
    マスタの入力は「マウスだけで最後まで終えられる」ことを基本にする。現場の
    端末はキーボードが使いにくい場所にあることがあり、また手入力は表記ゆれ
    (全角/半角・余分な空白)をそのままマスタへ持ち込む原因になるため。
      - number : 上下ボタン付き。右づめ・3桁区切りで表示し、単位を添える
      - date   : ブラウザ標準のカレンダー入力(type=date)
      - master-combo: 別マスタの登録値から選ぶ。未登録の値も入力でき、
                      保存時にその別マスタへ連動登録される(§5.3.1)
      - path   : サーバー側のフォルダ参照ダイアログ + ドラッグ&ドロップ
    いずれも最終的な値は data-field を持つ input/select が保持するので、
    submitMaint() 側の読み取りは変えない。 */
 const numFmt=new Intl.NumberFormat('ja-JP',{maximumFractionDigits:6});
 // 表示用に3桁区切りへ。編集中は素の数値に戻す(区切りが入ったままだと打ち直せない)。
 function numDisplay(v){
  const s=String(v??'').trim();if(!s)return '';
  const n=Number(s.replace(/,/g,''));
  return Number.isFinite(n)?numFmt.format(n):s;
 }
 function numRaw(v){
  const s=String(v??'').replace(/,/g,'').trim();
  return s;
 }
 // extraAttrは呼び出し側が別の収集属性を足すため(パス設定タブはdata-pc-fieldで集める)
 function numFieldHtml(f,val,extraAttr){
  const step=f.step==null?1:f.step;
  const attrs=[`data-step="${esc(String(step))}"`];
  if(f.min!=null)attrs.push(`data-min="${esc(String(f.min))}"`);
  if(f.max!=null)attrs.push(`data-max="${esc(String(f.max))}"`);
  if(extraAttr)attrs.push(extraAttr);
  return `<span class="mm-num" data-num-wrap>
    <button type="button" class="mm-num-btn" data-num-step="-1" tabindex="-1" aria-label="${esc(f.label)}を減らす">−</button>
    <input data-field="${f.k}" class="mm-num-input" type="text" inputmode="decimal" autocomplete="off"
           value="${esc(numDisplay(val))}" ${attrs.join(' ')}>
    <button type="button" class="mm-num-btn" data-num-step="1" tabindex="-1" aria-label="${esc(f.label)}を増やす">＋</button>
    ${f.unit?`<span class="mm-num-unit">${esc(f.unit)}</span>`:''}
   </span>`;
 }
 function fieldLabelHtml(f){
  return `<span>${esc(f.label)}${f.required?'<i>*</i>':''}${f.key?'<em class="mm-keytag">キー</em>':''}</span>`;
 }
 /* master-combo の選択肢は別マスタから取る。同じマスタを何度も引かないよう
    タブを開いている間だけ持つ(登録すると連動して増えるので、保存後の
    loadMaint()で作り直す)。 */
 const comboCache=new Map();
 function invalidateComboCache(){comboCache.clear()}
 async function comboOptions(source){
  if(!source||!source.endpoint)return [];
  if(comboCache.has(source.endpoint))return comboCache.get(source.endpoint);
  try{
   const r=await api(source.endpoint);
   /* **同じ名前を2つ並べない。** 選択肢マスタのように1行＝1値のマスタでは
      同じ名前が値の数だけ返るので、そのまま並べると候補が重複する。 */
   const list=[...new Set((r.items||[]).map(x=>String(x[source.valueKey||'name']??'').trim()).filter(Boolean))];
   comboCache.set(source.endpoint,list);return list;
  }catch(e){comboCache.set(source.endpoint,[]);return []}
 }
 /* 「すべての設備」を表す保存値。backend/repositories/master_repo.py の
    FIELD_REORDER_ALL と必ず同じにすること(判定はサーバー側と画面側の
    両方にあり、片方だけ変えると権限の見え方と実際が食い違う)。 */
 const EQUIPMENT_ALL='*';
 /* ---------- データソースの「この設定でできること」(§9.163) ----------
    データソースは1行足せば一覧には出るが、**測定・予定投入・品質結合は
    行に要る列が無いと画面が黙って出さない**（必須列を決め打ちしない方針の
    裏返し）。登録した本人からは「登録したのにボタンが出ない」としか
    見えないので、**できること／できない理由**をここで言い切る。
    判定はサーバー(backend/source_capability.py)の1箇所が持ち、画面は
    受け取った結果を並べるだけ——判定を画面にも書くと、2つの答えが出る。 */
 const CAPABILITY_ORDER=['list','measure','plan','quality','schedule'];
 const CAPABILITY_LABEL={list:'一覧として見る',measure:'測定を開く',
                         plan:'スケジュールへ投入',quality:'品質として結合',
                         schedule:'予定の本体にする'};
 const CAPABILITY_SHORT={list:'一覧',measure:'測定',plan:'予定',quality:'結合',schedule:'予定本体'};
 /* 一覧の表示用テキスト。保存値そのままだと '*' が生で見えて意味が伝わらない。 */
 function cellText(col,value){
  const v=String(value??'');
  if(col.format==='maxStrips')return v.trim()===''?'40（既定）':v;
  /* 1ロットあたり標準時間(§9.114)。**未設定を「0分」に見せない**——
     空欄は「登録していない＝全体の暫定既定値を使う」であって0分ではない。 */
  if(col.format==='standardMinutes')return v.trim()===''?'120分（既定）':`${v}分`;
  // 区分(§9.85)。空欄は「まだ決めていない」であって「無い」ではないので、
  // 「—」ではなくそう書く(既存の設備は空のまま動く)。
  if(col.format==='equipmentKind')return v.trim()===''?'未設定':v;
  /* 設定した場所に実物があるか。設定と実態のずれは、値だけ眺めていても
     気づけない(「登録したのに動かない」の大半がこれ)。 */
  if(col.format==='rneState'){
   if(!v.trim())return '（抽出しない）';
   return v+(col.row&&col.row.rneExists===false?'  ⚠ 未配置':'  ✓');
  }
  if(col.format==='fileState'){
   if(!v.trim())return '';
   return v+(col.row&&col.row.outputExists===false?'  （未作成）':'');
  }
  if(col.format==='equipmentTarget'){
   if(!v.trim())return '';
   return v.trim()===EQUIPMENT_ALL?'すべての設備':v.replace(/、/g,',').split(',').map(s=>s.trim()).filter(Boolean).join(' / ');
  }
  return v;
 }
 /* 入力欄をグループへ束ねる(§9.79)。fieldGroup を持つ欄が現れたら、その
    直前に見出しを1枚挟む。項目が9個並ぶと「どれとどれが関係するのか」を
    毎回読み解くことになるため、3〜4個ずつのまとまりにして、まとまりの
    名前で意味を渡す(チャンク化)。fieldGroup を持たないマスタは従来どおり
    平坦に並ぶ。 */
 function groupFieldControls(def,html){
  const groups=(def.fields||[]).map(f=>f.fieldGroup||'');
  if(!groups.some(Boolean))return html.join('');
  let prev=null;const out=[];
  groups.forEach((g,i)=>{
   if(g&&g!==prev)out.push(`<h4 class="mm-fieldgroup">${esc(g)}</h4>`);
   prev=g||prev;out.push(html[i]);
  });
  return out.join('');
 }
 function buildFieldControls(def,editing){
  return groupFieldControls(def,def.fields.map(f=>{
   const val=editing?String(editing[f.k]??''):'';
   if(f.type==='equipment-select'){
    const opts=equipmentMasterState.items||[];
    if(!opts.length){
     return `<div class="mm-field"><span>${esc(f.label)}</span><span class="mm-empty-inline">設備マスタが未登録です。先に「設備」タブで登録してください。</span></div>`;
    }
    const optHtml=opts.map(eq=>`<option value="${esc(eq.name)}"${eq.name===val?' selected':''}>${esc(eq.name)}</option>`).join('');
    return `<label class="mm-field"><span>${esc(f.label)}${f.required?'<i>*</i>':''}${f.key?'<em class="mm-keytag">キー</em>':''}</span><select data-field="${f.k}"><option value="">選択...</option>${optHtml}</select></label>`;
   }
   /* 対象設備を複数選べる欄。作業可能設備(equipment-multi)と同じタグUIだが、
      保存先が配列ではなくカンマ区切りの1列で、さらに「すべての設備」という
      ワイルドカード('*')を持つ。開発・保守用に全設備の権限を1行で渡せる
      ようにするため(設備を増やすたびに権限行を足さなくてよい)。 */
   if(f.type==='equipment-multi-text'){
    const raw=String(editing?(editing[f.k]??''):'').trim();
    const isAll=raw===EQUIPMENT_ALL;
    const selected=new Set(isAll?[]:raw.replace(/、/g,',').split(',').map(s=>s.trim()).filter(Boolean));
    const opts=equipmentMasterState.items||[];
    const hiddenBoxes=opts.map(eq=>`<input type="checkbox" data-equipment-field="${f.k}" value="${esc(eq.name)}"${selected.has(eq.name)?' checked':''} hidden>`).join('');
    // マスタから消えた設備名も選択として残す(黙って権限が消えないように)。
    const strays=[...selected].filter(n=>!opts.some(eq=>eq.name===n));
    const strayBoxes=strays.map(n=>`<input type="checkbox" data-equipment-field="${f.k}" value="${esc(n)}" checked hidden>`).join('');
    // 補足文はマスタごとに意味が違う(権限の対象か/停止内容の対象か)ので
    // def側からf.tagHintで渡す。未指定はアクセス権限マスタの従来文言。
    const tagHint=f.tagHint||'複数選べます。「すべての設備」は開発・保守用の全設備権限です（設備を増やしても権限行を足さずに済みます）。未選択は「未設定」＝権限なしです。';
    return `<div class="mm-field mm-tagfield" data-tagfield="${f.k}" data-tagfield-all="1"><span>${esc(f.label)}${f.required?'<i>*</i>':''}${f.key?'<em class="mm-keytag">キー</em>':''}</span>
     <div class="mm-tagfield-inner">
      <label class="mm-tag-all"><input type="checkbox" data-equipment-all="${f.k}"${isAll?' checked':''}>すべての設備</label>
      <div class="mm-tag-box" data-equipment-box="${f.k}" tabindex="-1">${strayBoxes}<input type="text" class="mm-tag-search" data-equipment-search="${f.k}" placeholder="設備名で検索・追加" autocomplete="off">${hiddenBoxes}</div>
      <div class="mm-tag-suggest" data-equipment-suggest="${f.k}" hidden></div>
     </div>
     <small class="mm-field-hint">${esc(tagHint)}</small></div>`;
   }
   if(f.type==='equipment-multi'){
    const selected=new Set((editing&&Array.isArray(editing[f.k])?editing[f.k]:[]).map(String));
    const opts=equipmentMasterState.items||[];
    if(!opts.length){
     return `<div class="mm-field"><span>${esc(f.label)}</span><span class="mm-empty-inline">設備マスタが未登録です。先に「設備」タブで登録してください。</span></div>`;
    }
    const hiddenBoxes=opts.map(eq=>`<input type="checkbox" data-equipment-field="${f.k}" value="${esc(eq.name)}"${selected.has(eq.name)?' checked':''} hidden>`).join('');
    const tags=opts.filter(eq=>selected.has(eq.name)).map(eq=>`<span class="mm-tag">${esc(eq.name)}<button type="button" class="mm-tag-remove" aria-label="${esc(eq.name)}を削除">×</button></span>`).join('');
    return `<div class="mm-field mm-tagfield" data-tagfield="${f.k}"><span>${esc(f.label)}</span>
     <div class="mm-tagfield-inner">
      <div class="mm-tag-box" data-equipment-box="${f.k}" tabindex="-1">${tags}<input type="text" class="mm-tag-search" data-equipment-search="${f.k}" placeholder="設備名で検索・追加" autocomplete="off">${hiddenBoxes}</div>
      <div class="mm-tag-suggest" data-equipment-suggest="${f.k}" hidden></div>
     </div>
     <small class="mm-field-hint">クリックで追加・×で削除。未選択なら制限なし（全設備で表示対象）。</small></div>`;
   }
   if(f.type==='select'){
    const opts=(f.options||[]).map(o=>`<option value="${esc(o)}"${o===val?' selected':''}>${esc(o||'（指定なし）')}</option>`).join('');
    return `<label class="mm-field">${fieldLabelHtml(f)}<select data-field="${f.k}">${opts}</select></label>`;
   }
   /* 別マスタ連動の選択欄(§5.3.1)。選ぶだけで済むのが基本で、無い値は
      「＋ 新しく追加」から入力する。保存時に相手のマスタへも登録される。 */
   if(f.type==='master-combo'){
    return `<div class="mm-field mm-combo" data-combo="${f.k}" data-combo-endpoint="${esc(f.source&&f.source.endpoint||'')}" data-combo-valuekey="${esc(f.source&&f.source.valueKey||'name')}">
      ${fieldLabelHtml(f)}
      <div class="mm-combo-inner">
       <select data-combo-select="${f.k}"><option value="">読み込んでいます…</option></select>
       <input data-field="${f.k}" type="hidden" value="${esc(val)}">
       <input class="mm-combo-new" data-combo-new="${f.k}" type="text" placeholder="新しい${esc(f.label)}を入力" autocomplete="off" hidden>
      </div>
      <small class="mm-field-hint">${esc(f.hint||'一覧から選ぶだけで入力できます。無いものは「＋ 新しく追加」を選ぶとこの場で登録できます。')}</small></div>`;
   }
   if(f.type==='number'){
    return `<label class="mm-field mm-field-num">${fieldLabelHtml(f)}${numFieldHtml(f,val)}${f.hint?`<small class="mm-field-hint">${esc(f.hint)}</small>`:''}</label>`;
   }
   if(f.type==='date'){
    return `<label class="mm-field">${fieldLabelHtml(f)}<span class="mm-date"><input data-field="${f.k}" type="date" value="${esc(val)}"><button type="button" class="mm-date-today" data-date-today="${f.k}">今日</button></span>${f.hint?`<small class="mm-field-hint">${esc(f.hint)}</small>`:''}</label>`;
   }
   if(f.type==='time'){
    return `<label class="mm-field">${fieldLabelHtml(f)}<input data-field="${f.k}" type="time" step="60" value="${esc(val)}">${f.hint?`<small class="mm-field-hint">${esc(f.hint)}</small>`:''}</label>`;
   }
   if(f.type==='path'){
    return `<div class="mm-field mm-field-path">${fieldLabelHtml(f)}
      <span class="mm-path" data-path-drop="${f.k}">
       <input data-field="${f.k}" type="text" value="${esc(val)}" autocomplete="off" spellcheck="false" placeholder="${esc(f.placeholder||'')}">
       <button type="button" class="mm-path-browse" data-path-browse="${f.k}" data-path-mode="${esc(f.pathMode||'file')}">参照…</button>
      </span>
      <small class="mm-field-hint">${esc(f.hint||'「参照…」で選ぶか、エクスプローラーからここへドラッグ&ドロップできます。')}</small></div>`;
   }
   return `<label class="mm-field">${fieldLabelHtml(f)}<input data-field="${f.k}" type="text" value="${esc(val)}" autocomplete="off"></label>`;
  }));
 }
 function renderMaintForm(){
  const def=currentDef(),form=$('#masterMaintForm');if(!form)return;const editing=maintState.editing;
  // 入力項目が多いマスタは、上部に常設のフォームを置かず(一覧の表示領域を
  // 空けるため)、編集専用モーダルへ入口だけを出す(ARCHITECTURE.md「マスタ管理の画面形態」)。
  if(defUsesEditorModal(def)){
   form.classList.add('mm-form-compact');
   form.innerHTML=`<div class="mm-form-head">
     <span class="mm-mode-chip new">新規登録</span>
     <button type="button" id="masterMaintAdd" class="mm-btn-primary sm">＋ ${esc(def.label)}を追加</button>
     <span class="mm-form-hint">一覧の行をクリック（またはダブルクリック・「編集」ボタン）で編集ウィンドウを開きます。</span>
    </div>
    ${def.hint?`<p class="mm-def-hint">${esc(def.hint)}</p>`:''}`;
   form.onsubmit=ev=>ev.preventDefault();
   const ab=$('#masterMaintAdd');if(ab)ab.onclick=()=>openMaintEditor(null);
   return;
  }
  form.classList.remove('mm-form-compact');
  const controls=buildFieldControls(def,editing);
  const chip=editing?`<span class="mm-mode-chip editing">編集中 <b>${esc(editing[def.cols[0].k]||'')}</b><small>ID:${esc(editing.id)}</small></span>`:`<span class="mm-mode-chip new">新規登録</span>`;
  form.innerHTML=`<div class="mm-form-head">${chip}${editing?'<button type="button" id="masterMaintNew" class="mm-btn-ghost sm">＋ 新規入力に切替</button>':''}</div>
   ${def.hint?`<p class="mm-def-hint">${esc(def.hint)}</p>`:''}
   <div class="mm-form-fields">${controls}${
    typeof def.extraHtml==='function'?def.extraHtml(editing):''}</div>
   <div class="mm-form-tail"><button type="submit" class="mm-btn-primary">${editing?'更新を保存':'追加登録'}</button><span class="mm-form-hint">${editing?'キー項目（名称・区分など）も変更できます。保存すると同じIDのまま更新（リネーム）されます。同名が既にある場合は更新できません。':'必須(*)を入力して追加登録します。'}</span></div>`;
  form.onsubmit=ev=>{ev.preventDefault();submitMaint()};
  const nb=$('#masterMaintNew');if(nb)nb.onclick=()=>{maintState.editing=null;renderMaintForm()};
  bindEquipmentPickers(form);bindInputHelpers(form);
 }

 /* ---------- 汎用の編集専用モーダル(ARCHITECTURE.md「マスタ管理の画面形態」新設) ----------
    どのマスタでも同じ枠を使う。中身(入力欄)はbuildFieldControls()が
    MASTER_DEFSのfields定義から組み立てるため、マスタを増やしても
    このモーダル自体には手を入れなくてよい。 */
 function ensureMaintEditor(){
  let modal=$('#maintEditorModal');if(modal)return modal;
  modal=document.createElement('div');modal.className='record-modal mm-editor-modal';modal.id='maintEditorModal';modal.hidden=true;
  modal.innerHTML=`<div class="mm-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="maintEditorTitle">
    <header class="mm-editor-head">
     <div><small id="maintEditorEyebrow">MASTER</small><h2 id="maintEditorTitle">編集</h2></div>
     <button type="button" id="maintEditorClose" class="mm-close" aria-label="閉じる">×</button>
    </header>
    <form class="mm-editor-body" id="maintEditorForm"></form>
    <!-- 下段は<footer>ではなく<div>にすること。メイン画面統合型ビューの
         共通ルール(body.mm-mode footer{display:none}等、@layer mode)は要素
         セレクタのfooterを対象にしているため、<footer>で組むとこのモーダルの
         保存・キャンセルボタンごと消える(実装時に踏んだ不具合)。 -->
    <div class="mm-editor-foot">
     <span class="mm-form-hint" id="maintEditorHint"></span>
     <div class="mm-editor-actions">
      <button type="button" id="maintEditorCancel" class="mm-btn-ghost">キャンセル</button>
      <button type="button" id="maintEditorSave" class="mm-btn-primary">保存</button>
     </div>
    </div>
   </div>`;
  document.body.append(modal);
  $('#maintEditorClose').onclick=()=>closeMaintEditor();
  $('#maintEditorCancel').onclick=()=>closeMaintEditor();
  $('#maintEditorSave').onclick=()=>submitMaint('#maintEditorForm');
  modal.addEventListener('click',ev=>{if(ev.target===modal)closeMaintEditor()});
  return modal;
 }
 function openMaintEditor(item){
  const def=currentDef();if(!defUsesEditorModal(def))return;
  const modal=ensureMaintEditor();
  maintState.editing=item?Object.assign({},item):null;
  const editing=maintState.editing;
  $('#maintEditorEyebrow').textContent=def.label+'マスタ';
  $('#maintEditorTitle').textContent=editing?`${String(editing[def.cols[0].k]??'')||'(名称なし)'} を編集`:`${def.label}を新規登録`;
  $('#maintEditorHint').textContent=editing
   ?'キー項目（名称・区分など）も変更できます。保存すると同じIDのまま更新されます。'
   :'必須(*)を入力して登録します。';
  $('#maintEditorSave').textContent=editing?'更新を保存':'追加登録';
  modal.querySelector('.mm-editor-dialog')?.classList.remove('is-wide','is-tall');
  $('#maintEditorSave').onclick=()=>submitMaint('#maintEditorForm');
  const form=$('#maintEditorForm');
  form.innerHTML=`${def.hint?`<p class="mm-def-hint">${esc(def.hint)}</p>`:''}
   <div class="mm-form-fields">${buildFieldControls(def,editing)}${
    typeof def.extraHtml==='function'?def.extraHtml(editing):''}</div>`;
  form.onsubmit=ev=>{ev.preventDefault();submitMaint('#maintEditorForm')};
  bindEquipmentPickers(form);bindInputHelpers(form);
  modal.hidden=false;
  requestAnimationFrame(()=>{const first=form.querySelector('[data-field],[data-equipment-search]');if(first)first.focus()});
 }
 function closeMaintEditor(){
  const modal=$('#maintEditorModal');if(!modal||modal.hidden)return;
  modal.hidden=true;maintState.editing=null;
  /* 描き直す先はタブごとに違う。**汎用の一覧を呼ぶと専用タブの中身が
     消える**ので、いまのタブに合わせる。 */
  if(currentDef().special==='data-source'){dsState.editing=null;renderDataSourceList();return}
  if(currentDef().special==='query-join'){qjState.editing=null;renderQueryJoinList();return}
  /* 「新規」は項目を1つ足す（この画面には編集モーダルが無い）。 */
  if(currentDef().special==='op-item'){opCreateItem();return}
  renderMaintList();
 }
 /* 入力支援の配線(§9.49)。buildFieldControls()が出した各型を動かす。
    どの型も「data-field を持つ要素の value が最終的な値」という約束を守るので、
    submitMaint()側は型を知らなくてよい。 */
 function bindInputHelpers(form){
  bindNumberFields(form);
  bindDateFields(form);
  bindComboFields(form);
  bindPathFields(form);
 }
 /* --- 数値: 上下ボタン・3桁区切り・右づめ --- */
 function bindNumberFields(form){
  form.querySelectorAll('[data-num-wrap]').forEach(wrap=>{
   const input=wrap.querySelector('.mm-num-input');if(!input)return;
   const step=Number(input.dataset.step||1)||1;
   const min=input.dataset.min===undefined?null:Number(input.dataset.min);
   const max=input.dataset.max===undefined?null:Number(input.dataset.max);
   const clamp=n=>{
    if(min!=null&&n<min)n=min;
    if(max!=null&&n>max)n=max;
    return n;
   };
   // 桁区切りが入ったままだと打ち直せないので、編集中は素の数値に戻す。
   input.addEventListener('focus',()=>{input.value=numRaw(input.value);input.select()});
   input.addEventListener('blur',()=>{
    const raw=numRaw(input.value);
    if(raw===''){input.value='';return}
    const n=Number(raw);
    input.value=Number.isFinite(n)?numDisplay(clamp(n)):raw;
   });
   const bump=dir=>{
    const raw=numRaw(input.value);
    // 空欄から「＋」を1回押したら1目盛(step)になるのが素直。0を起点にする。
    const base=raw===''?0:Number(raw);
    const n=clamp((Number.isFinite(base)?base:0)+dir*step);
    // 小数のstepで 0.30000000000000004 のような値にしない
    const fixed=Number(n.toFixed(6));
    input.value=document.activeElement===input?String(fixed):numDisplay(fixed);
    input.dispatchEvent(new Event('input',{bubbles:true}));
   };
   wrap.querySelectorAll('[data-num-step]').forEach(btn=>{
    const dir=Number(btn.dataset.numStep)||1;
    // 押しっぱなしで連続増減(マウスだけで大きく動かせるように)
    let timer=null,repeat=null;
    const stop=()=>{clearTimeout(timer);clearInterval(repeat);timer=repeat=null};
    btn.addEventListener('pointerdown',ev=>{
     ev.preventDefault();bump(dir);
     timer=setTimeout(()=>{repeat=setInterval(()=>bump(dir),60)},400);
    });
    ['pointerup','pointerleave','pointercancel'].forEach(e=>btn.addEventListener(e,stop));
   });
   // 上下キーでも同じ操作(キーボード派の手も止めない)
   input.addEventListener('keydown',ev=>{
    if(ev.key==='ArrowUp'){ev.preventDefault();bump(1)}
    else if(ev.key==='ArrowDown'){ev.preventDefault();bump(-1)}
   });
  });
 }
 /* --- 日付: カレンダー入力 + 「今日」 --- */
 function bindDateFields(form){
  form.querySelectorAll('[data-date-today]').forEach(btn=>{
   btn.onclick=()=>{
    const input=form.querySelector(`[data-field="${btn.dataset.dateToday}"]`);
    if(!input)return;
    const d=new Date();
    input.value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    input.dispatchEvent(new Event('change',{bubbles:true}));
   };
  });
 }
 /* --- 別マスタ連動の選択欄 --- */
 const COMBO_NEW='__new__';
 function bindComboFields(form){
  form.querySelectorAll('[data-combo]').forEach(async field=>{
   const fk=field.dataset.combo;
   const sel=field.querySelector(`[data-combo-select="${fk}"]`);
   const hidden=field.querySelector(`[data-field="${fk}"]`);
   const newInput=field.querySelector(`[data-combo-new="${fk}"]`);
   if(!sel||!hidden)return;
   const current=String(hidden.value||'').trim();
   const names=await comboOptions({endpoint:field.dataset.comboEndpoint,valueKey:field.dataset.comboValuekey});
   // 既存データの値がマスタから消えていても選択肢に残す(選び直しを強要しない)
   const list=names.slice();
   if(current&&!list.includes(current))list.push(current);
   sel.innerHTML=`<option value="">（指定なし）</option>`
    +list.map(n=>`<option value="${esc(n)}"${n===current?' selected':''}>${esc(n)}</option>`).join('')
    +`<option value="${COMBO_NEW}">＋ 新しく追加…</option>`;
   const sync=()=>{
    if(sel.value===COMBO_NEW){
     newInput.hidden=false;hidden.value=String(newInput.value||'').trim();
    }else{
     newInput.hidden=true;newInput.value='';hidden.value=sel.value;
    }
   };
   sel.onchange=()=>{sync();if(sel.value===COMBO_NEW)newInput.focus()};
   newInput.oninput=()=>{hidden.value=String(newInput.value||'').trim()};
   sync();
  });
 }
 /* --- パス: サーバー側フォルダ参照 + ドラッグ&ドロップ --- */
 function bindPathFields(form){
  form.querySelectorAll('[data-path-browse]').forEach(btn=>{
   btn.onclick=async()=>{
    const input=form.querySelector(`[data-field="${btn.dataset.pathBrowse}"]`);
    if(!input)return;
    const picked=await openPathPicker({mode:btn.dataset.pathMode||'file',start:input.value});
    if(picked!=null){input.value=picked;input.dispatchEvent(new Event('change',{bubbles:true}))}
   };
  });
  form.querySelectorAll('[data-path-drop]').forEach(zone=>{
   const input=zone.querySelector('[data-field]');if(!input)return;
   const over=on=>zone.classList.toggle('is-dragover',on);
   zone.addEventListener('dragover',ev=>{ev.preventDefault();over(true)});
   zone.addEventListener('dragleave',()=>over(false));
   zone.addEventListener('drop',ev=>{
    ev.preventDefault();over(false);
    const path=pathFromDrop(ev.dataTransfer);
    if(path){input.value=path;input.dispatchEvent(new Event('change',{bubbles:true}));return}
    // ブラウザはセキュリティ上ファイルの完全パスを渡さないことがある。
    // 名前しか取れなかったときは黙って捨てず、参照ダイアログへ誘導する。
    const name=ev.dataTransfer.files&&ev.dataTransfer.files[0]&&ev.dataTransfer.files[0].name;
    showToast('パスを取得できませんでした',
      name?`「${name}」の完全なパスはブラウザからは読み取れませんでした。「参照…」から選んでください。`
          :'「参照…」ボタンから選んでください。',6000);
   });
  });
 }
 /* エクスプローラーからのドロップは text/uri-list か text/plain に
    file:///C:/... 形式で入ってくることが多い。files[0].pathはElectron等
    でしか使えないため、テキスト側を先に見る。 */
 function pathFromDrop(dt){
  if(!dt)return '';
  for(const type of ['text/uri-list','text/plain']){
   const raw=String(dt.getData(type)||'').split(/[\r\n]+/).find(s=>s&&!s.startsWith('#'));
   if(!raw)continue;
   if(/^file:\/\//i.test(raw)){
    try{
     let p=decodeURIComponent(raw.replace(/^file:\/\//i,''));
     // file://server/share/... はUNCなので先頭の\\を復元する
     if(/^\/[A-Za-z]:/.test(p))p=p.slice(1);
     else if(!/^\//.test(p))p='\\\\'+p;
     return p.replace(/\//g,'\\');
    }catch(e){/* 壊れたURIは無視 */}
   }
   if(/^[A-Za-z]:\\|^\\\\/.test(raw))return raw;
  }
  const f=dt.files&&dt.files[0];
  return (f&&f.path)?f.path:'';
 }

 /* ---------- パス参照ダイアログ(§9.49) ----------
    ブラウザのファイル選択はセキュリティ上、完全なパスを返さない(名前だけ)。
    このアプリはその端末自身で動くローカルサーバーなので、**サーバー側の
    ディレクトリ一覧**(/api/browse-path)を辿る形にすれば実際のパスが得られる。
    共有(UNC)も同じ経路で辿れるため、\\server\share\... もマウスだけで選べる。 */
 let pathPickerResolve=null;
 function ensurePathPicker(){
  let modal=$('#pathPickerModal');
  if(modal)return modal;
  modal=document.createElement('div');
  modal.className='record-modal';modal.id='pathPickerModal';modal.hidden=true;
  modal.innerHTML=`<div class="settings-dialog pathpick-dialog" role="dialog" aria-modal="true" aria-labelledby="pathPickerTitle">
    <header><div><h2 id="pathPickerTitle">場所を選択</h2></div>
     <button id="pathPickerClose" type="button" aria-label="閉じる">×</button></header>
    <div class="settings-body pathpick-body">
     <div class="pathpick-bar">
      <button type="button" id="pathPickerUp" class="mm-btn-ghost sm" title="1つ上の階層へ">↑ 上へ</button>
      <input id="pathPickerPath" type="text" spellcheck="false" autocomplete="off" aria-label="現在の場所">
      <button type="button" id="pathPickerGo" class="mm-btn-ghost sm">移動</button>
     </div>
     <div class="pathpick-places" id="pathPickerPlaces"></div>
     <div class="pathpick-list" id="pathPickerList"></div>
     <div class="pathpick-status" id="pathPickerStatus"></div>
     <div class="settings-actions">
      <button type="button" id="pathPickerCancel" class="mm-btn-ghost">キャンセル</button>
      <button type="button" id="pathPickerPick" class="mm-btn-primary">この場所を選択</button>
     </div>
    </div></div>`;
  document.body.append(modal);
  const close=v=>{modal.hidden=true;if(pathPickerResolve){pathPickerResolve(v);pathPickerResolve=null}};
  $('#pathPickerClose').onclick=()=>close(null);
  $('#pathPickerCancel').onclick=()=>close(null);
  $('#pathPickerPick').onclick=()=>close(String($('#pathPickerPath').value||''));
  modal.addEventListener('click',ev=>{if(ev.target===modal)close(null)});
  return modal;
 }
 async function openPathPicker(opts){
  const modal=ensurePathPicker();
  const mode=opts&&opts.mode||'file';
  $('#pathPickerTitle').textContent=mode==='dir'?'フォルダを選択':'ファイルを選択';
  $('#pathPickerPick').textContent=mode==='dir'?'このフォルダを選択':'この場所を選択';
  modal.hidden=false;
  await browsePath(String(opts&&opts.start||''),mode);
  return new Promise(resolve=>{pathPickerResolve=resolve});
 }
 async function browsePath(path,mode){
  const list=$('#pathPickerList'),status=$('#pathPickerStatus');
  if(!list)return;
  list.innerHTML='<div class="pathpick-loading">読み込んでいます…</div>';
  let r;
  try{r=await api('/api/browse-path?path='+encodeURIComponent(path||''))}
  catch(e){list.innerHTML=`<div class="pathpick-error">${esc(e.message)}</div>`;return}
  $('#pathPickerPath').value=r.path||'';
  $('#pathPickerPlaces').innerHTML=(r.places||[]).map(p=>
    `<button type="button" class="pathpick-place" data-go="${esc(p.path)}" title="${esc(p.path)}">${esc(p.label)}</button>`).join('');
  const rows=(r.entries||[]).filter(e=>mode==='dir'?e.isDir:true);
  list.innerHTML=rows.length
   ? rows.map(e=>`<button type="button" class="pathpick-row${e.isDir?' is-dir':''}" data-name="${esc(e.name)}" data-dir="${e.isDir?1:0}" data-path="${esc(e.path)}">
        <span class="pathpick-icon">${e.isDir?'📁':'📄'}</span><span class="pathpick-name">${esc(e.name)}</span>
        <span class="pathpick-size">${e.isDir?'':esc(e.sizeText||'')}</span></button>`).join('')
   : '<div class="pathpick-empty">表示できる項目がありません。</div>';
  status.textContent=r.error?r.error:`${rows.length}件`;
  status.className='pathpick-status'+(r.error?' is-warn':'');
  $('#pathPickerUp').onclick=()=>browsePath(r.parent||'',mode);
  $('#pathPickerGo').onclick=()=>browsePath($('#pathPickerPath').value,mode);
  $('#pathPickerPath').onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();browsePath($('#pathPickerPath').value,mode)}};
  $('#pathPickerPlaces').querySelectorAll('[data-go]').forEach(b=>{b.onclick=()=>browsePath(b.dataset.go,mode)});
  list.querySelectorAll('.pathpick-row').forEach(b=>{
   // フォルダはクリックで潜る。ファイルはクリックで「その場所」として確定する。
   b.onclick=()=>{
    if(b.dataset.dir==='1')browsePath(b.dataset.path,mode);
    else $('#pathPickerPath').value=b.dataset.path;
   };
   b.ondblclick=()=>{if(b.dataset.dir!=='1'){$('#pathPickerPath').value=b.dataset.path;$('#pathPickerPick').click()}};
  });
 }

 // 作業可能設備タグ入力: フォーカスで登録済み設備をサジェスト、クリックで
 // 連続追加できるようにする（認識優先＝再入力不要、逐次追加を高速化）。
 // 送信時の互換性のため、選択状態は非表示チェックボックス(data-equipment-field)
 // で保持し、submitMaint()側の読み取りロジックは変更しない。
 function bindEquipmentPickers(form){
  form.querySelectorAll('[data-tagfield]').forEach(field=>{
   const fk=field.dataset.tagfield;
   const box=field.querySelector(`[data-equipment-box="${fk}"]`);
   const search=field.querySelector(`[data-equipment-search="${fk}"]`);
   const suggest=field.querySelector(`[data-equipment-suggest="${fk}"]`);
   if(!box||!search||!suggest)return;
   const opts=equipmentMasterState.items||[];
   const checkbox=name=>[...box.querySelectorAll(`[data-equipment-field="${fk}"]`)].find(b=>b.value===name);
   const selectedNames=()=>opts.filter(eq=>{const cb=checkbox(eq.name);return cb&&cb.checked}).map(eq=>eq.name);
   const setChecked=(name,val)=>{const cb=checkbox(name);if(cb)cb.checked=val};
   function renderTags(){
    box.querySelectorAll('.mm-tag').forEach(t=>t.remove());
    selectedNames().forEach(name=>{
     const tag=document.createElement('span');tag.className='mm-tag';
     tag.innerHTML=`${esc(name)}<button type="button" class="mm-tag-remove" aria-label="${esc(name)}を削除">×</button>`;
     tag.querySelector('.mm-tag-remove').onclick=ev=>{ev.stopPropagation();setChecked(name,false);renderTags();renderSuggest();search.focus()};
     box.insertBefore(tag,search);
    });
   }
   function renderSuggest(){
    const q=String(search.value||'').normalize('NFKC').toLowerCase().trim();
    const selected=new Set(selectedNames());
    const items=opts.filter(eq=>!selected.has(eq.name)&&(!q||eq.name.normalize('NFKC').toLowerCase().includes(q)));
    if(!items.length){suggest.innerHTML=`<div class="mm-tag-suggest-empty">${selected.size>=opts.length?'すべて選択済みです':'該当する設備がありません'}</div>`;return}
    suggest.innerHTML=items.map(eq=>`<button type="button" class="mm-tag-suggest-item" data-pick="${esc(eq.name)}">${esc(eq.name)}</button>`).join('');
    suggest.querySelectorAll('[data-pick]').forEach(btn=>{btn.onclick=ev=>{ev.stopPropagation();setChecked(btn.dataset.pick,true);search.value='';renderTags();renderSuggest();search.focus()}});
   }
   search.addEventListener('focus',()=>{renderSuggest();suggest.hidden=false});
   search.addEventListener('input',()=>{renderSuggest();suggest.hidden=false});
   search.addEventListener('keydown',ev=>{
    if(ev.key==='Backspace'&&!search.value){const names=selectedNames();if(names.length){setChecked(names[names.length-1],false);renderTags();renderSuggest()}}
    else if(ev.key==='Escape'){suggest.hidden=true;search.blur()}
    else if(ev.key==='Enter'){
     // このinputはフォーム内にあるため、既定動作のままだとEnterで
     // フォーム送信(登録・更新)が誤爆する。先頭の候補を追加する操作として扱う。
     ev.preventDefault();
     const first=suggest.querySelector('[data-pick]');
     if(first){setChecked(first.dataset.pick,true);search.value='';renderTags();renderSuggest()}
    }
   });
   search.addEventListener('blur',()=>{setTimeout(()=>{if(document.activeElement!==search)suggest.hidden=true},150)});
   box.addEventListener('mousedown',ev=>{if(ev.target===box){ev.preventDefault();search.focus()}});
   /* 「すべての設備」を選んでいるあいだは個別選択を触らせない。両方が
      効いているように見えると、どちらが保存されるのか分からなくなる。 */
   const all=field.querySelector(`[data-equipment-all="${fk}"]`);
   if(all){
    const syncAll=()=>{
     box.classList.toggle('is-disabled',all.checked);
     search.disabled=all.checked;
     if(all.checked)suggest.hidden=true;
    };
    all.addEventListener('change',syncAll);
    syncAll();
   }
   renderTags();
  });
 }

 function setMaintLoading(show,text){
  const dialog=$('#masterMaintPanel .mm-dialog');if(!dialog)return;
  let box=dialog.querySelector(':scope > .mm-loading');
  if(show){
   if(!box){box=document.createElement('div');box.className='mm-loading';box.innerHTML='<div class="mm-loading-box"><span class="mini-spinner"></span><b></b></div>';dialog.appendChild(box)}
   box.querySelector('b').textContent=text||'処理しています…';box.hidden=false;
  }else if(box){box.hidden=true}
 }
 /* 設備マスタの新規登録専用: 過去に削除(無効化)された同名設備があると
    サーバーはinactive_equipment_name_conflictで409を返す(選択の余地がある
    ため)。既存の確認モーダル(2択)をそのまま2段階連ねて選ばせ、共通
    コンポーネント自体には手を入れない。どちらもキャンセルした場合はnullを
    返し、呼び出し側(submitMaint)は何も表示せず処理を終える。 */
 async function registerEquipmentWithChoice(body){
  try{
   return await api('/api/equipment-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  }catch(e){
   if(e.code!=='inactive_equipment_name_conflict')throw e;
   const restore=await confirmModal({
    eyebrow:'設備マスタ',title:'過去に削除された設備名です',
    message:`「${body.name}」は過去に削除(無効化)された設備と同じ名前です。\n\n同じ設備として復元しますか？\n(これまでのスケジュール等の履歴はそのまま引き継がれます)`,
    confirmLabel:'同じ設備として復元',cancelLabel:'別の選択肢を見る'
   });
   if(restore)return api('/api/equipment-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,reuseExisting:true})});
   const asNew=await confirmModal({
    eyebrow:'設備マスタ',title:'別の新しい設備として登録しますか？',
    message:`「${body.name}」を、過去の設備とは別の新しい設備として登録します。\n\n過去の履歴は「${body.name}(旧…)」という名前へ切り離され、以後は新しい「${body.name}」の履歴として記録されます。`,
    confirmLabel:'新しい設備として登録'
   });
   if(!asNew)return null;
   return api('/api/equipment-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,reuseExisting:false})});
  }
 }
 /* rootSel: 入力欄を読む対象。インラインフォーム(#masterMaintForm)と
    編集モーダル(#maintEditorForm)のどちらからでも同じ処理で保存する。 */
 async function submitMaint(rootSel){
  const root=rootSel||'#masterMaintForm';
  const def=currentDef(),uid=requireMaintUser();if(uid===null)return;const editing=maintState.editing;
  const body={user_id:uid};let ok=true;
  if(editing)body.id=editing.id;
  def.fields.forEach(f=>{
   if(f.type==='equipment-multi'){body[f.k]=[...document.querySelectorAll(`${root} [data-equipment-field="${f.k}"]:checked`)].map(el=>el.value);return}
   if(f.type==='equipment-multi-text'){
    const all=document.querySelector(`${root} [data-equipment-all="${f.k}"]`);
    body[f.k]=all&&all.checked?EQUIPMENT_ALL
     :[...document.querySelectorAll(`${root} [data-equipment-field="${f.k}"]:checked`)].map(el=>el.value).join(',');
    // 必須のタグ欄(設備停止マスタの対象設備)は未選択で送らせない。素の入力欄と
    // 違い、空でも「未設定」として通ってしまうため、ここで同じ扱いに揃える。
    if(f.required&&!body[f.k])ok=false;
    return;
   }
   const el=$(`${root} [data-field="${f.k}"]`);
   // 数値欄は表示用の3桁区切りが入っているので、送る前に外す(§9.49)
   const v=f.type==='number'?numRaw(el?el.value:''):String(el?el.value:'').trim();
   if(f.required&&!v)ok=false;body[f.k]=v;
  });
  if(!ok){showToast('入力を確認してください','必須項目が未入力です。',4000);return}
  const endpoint=editing?def.endpoint+'/update':def.endpoint;
  try{
   setMaintLoading(true,editing?`${def.label}を更新しています…`:`${def.label}を登録しています…`);
   const r=(def.key==='equipment'&&!editing)?await registerEquipmentWithChoice(body):await api(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(r===null)return; // 設備の新規/復元どちらもキャンセルされた
   // 編集モーダルから保存した場合は閉じてから一覧を更新する(closeMaintEditor
   // 自身もrenderMaintListを呼ぶが、直後のloadMaintで最新データに置き換わる)。
   const modal=$('#maintEditorModal');
   if(modal&&!modal.hidden){modal.hidden=true}
   // 連動登録(§5.3.1)で相手のマスタが増えている可能性があるため、
   // 選択肢のキャッシュは毎回捨てる(次に開いたとき新しい分類が出る)。
   invalidateComboCache();
   maintState.editing=null;await loadMaint(true);
   showToast&&showToast(def.label+(editing?'を更新しました':'を登録しました'),(r&&r.message)||'',3600);
  }catch(e){showToast&&showToast(editing?'更新できませんでした':'登録できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }
 /* 設備マスタの削除確認: docs/SCHEDULE_MODE_DESIGN.md §5.0.1のとおり、まず
    拒否して関連スケジュールデータの内訳を提示し、利用者が再確認のうえ
    明示的に選んだ場合のみforce:trueで再送する(削除してもスケジュール側の
    データ自体は一切書き換えない・履歴として残る)。 */
 function scheduleReferenceLabels(){
  return {pendingPlans:'未着手の作業予定',inProgressPlans:'着手中の作業予定',completedPlans:'完了済みの作業予定',
          calendarRows:'稼働カレンダー',stopReasonRows:'設備停止マスタ',loadFactorOverrideRows:'換算係数の手動上書き',
          fieldReorderTerminals:'現場段取り対象に設定中の端末'};
 }
 async function deleteEquipmentWithReferenceCheck(item,uid){
  try{
   setMaintLoading(true,'設備マスタを無効化しています…');
   await api('/api/equipment-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,user_id:uid})});
   return true;
  }catch(e){
   if(e.code!=='schedule_references_exist')throw e;
   setMaintLoading(false);
   const labels=scheduleReferenceLabels();
   const rows=Object.entries(e.references||{}).filter(([,v])=>v>0)
    .map(([k,v])=>`<tr class="${k==='inProgressPlans'?'eq-ref-warn':''}"><td>${esc(labels[k]||k)}</td><td>${v}件</td></tr>`).join('');
   const proceed=await confirmModal({
    eyebrow:'設備マスタ',title:'関連するスケジュールデータがあります',danger:true,
    bodyHtml:`<p class="confirm-modal-message">「${esc(item.name||'')}」には以下のスケジュールデータが関連しています。削除すると、これらは履歴として残りますが、今後この設備は仕掛一覧・スケジュール画面・現場段取りの選択肢から外れます。よろしいですか?</p>
     <table class="eq-ref-table"><tbody>${rows}</tbody></table>`,
    confirmLabel:'削除する',cancelLabel:'キャンセル'
   });
   if(!proceed)return false;
   setMaintLoading(true,'設備マスタを無効化しています…');
   await api('/api/equipment-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,user_id:uid,force:true})});
   return true;
  }finally{
   setMaintLoading(false);
  }
 }
 async function deleteMaint(item){
  const def=currentDef();if(!def.hasDelete)return;const uid=requireMaintUser();if(uid===null)return;
  const nm=item[def.cols[0].k]||item.name||'';
  if(def.key==='equipment'){
   try{
    const proceeded=await deleteEquipmentWithReferenceCheck(item,uid);
    if(!proceeded)return;
    if(maintState.editing&&maintState.editing.id===item.id)maintState.editing=null;
    await loadMaint(true);showToast&&showToast(def.label+'を無効化しました',nm,3600);
   }catch(e){showToast&&showToast('削除できませんでした',e.message,6500)}
   return;
  }
  if(!confirm(`${def.label}「${nm}」を無効化（削除）しますか？`))return;
  try{
   setMaintLoading(true,`${def.label}を無効化しています…`);
   await api(def.endpoint+'/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,user_id:uid})});
   if(maintState.editing&&maintState.editing.id===item.id)maintState.editing=null;
   await loadMaint(true);showToast&&showToast(def.label+'を無効化しました',nm,3600);
  }catch(e){showToast&&showToast('削除できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }

 function fmtDT(v){if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?'-':d.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
 /* 横スクロールを出さないための列幅設計。
    - データ列は minmax(0,fr) で「入るだけ縮む」ようにする(以前は最小120pxが
      効いて、6列のアクセス権限マスタでは常に1100px超を要求し横スクロールが出た)。
    - 更新者・更新日時は監査用の副次情報。列数の多いマスタでは列として持たず、
      行のツールチップ(title)へ退避して主情報の幅を確保する。 */
 const MAINT_AUDIT_MAX_COLS=3;
 function maintShowsAudit(def){return (def.cols||[]).length<=MAINT_AUDIT_MAX_COLS}
 function maintGridTemplate(def){
  const data=def.cols.map(c=>`minmax(0,${c.grow||1}fr)`).join(' ');
  return maintShowsAudit(def)?`${data} 96px 128px 108px`:`${data} 108px`;
 }
 function filteredMaintItems(def){
  const q=String(maintState.query||'').trim().normalize('NFKC').toLowerCase();
  let items=maintState.items||[];
  if(q)items=items.filter(it=>{const hay=[...def.cols.map(c=>it[c.k]),it.updated_by].map(v=>String(v??'').normalize('NFKC').toLowerCase()).join(' ');return hay.includes(q)});
  return items;
 }
 function renderMaintList(){
  const def=currentDef(),list=$('#masterMaintList');if(!list)return;
  const all=maintState.items||[],items=filteredMaintItems(def),tmpl=maintGridTemplate(def);
  const cnt=$('#masterMaintCount');if(cnt)cnt.textContent=maintState.query?`${items.length} / 有効 ${all.length}件`:`有効 ${all.length}件`;
  const showAudit=maintShowsAudit(def);
  const headCols=def.cols.map(c=>`<span>${esc(c.label)}</span>`).join('');
  list.innerHTML=`<div class="mm-row head" style="grid-template-columns:${tmpl}">${headCols}${showAudit?'<span>更新者</span><span>更新日時</span>':''}<span class="mm-act">操作</span></div>`;
  if(!items.length){list.insertAdjacentHTML('beforeend',`<div class="mm-empty">${all.length&&maintState.query?'絞り込み条件に一致するデータがありません。':'有効なデータがありません。上のフォームから追加してください。'}</div>`);return}
  const frag=document.createDocumentFragment();
  items.forEach(it=>{
   const row=document.createElement('div');row.className='mm-row'+(maintState.editing&&maintState.editing.id===it.id?' editing':'');row.style.gridTemplateColumns=tmpl;row.tabIndex=0;row.setAttribute('role','button');
   // 列として出さない監査情報(更新者・更新日時)は行のツールチップで補う。
   const audit=`更新者: ${it.updated_by||'-'} / 更新日時: ${fmtDT(it.updated_at)}`;
   row.title=showAudit?'クリックで編集フォームに読み込みます':`クリックで編集\n${audit}`;
   const cells=def.cols.map(c=>{const v=cellText({...c,row:it},it[c.k]);
    return `<span title="${esc(v)}">${esc(v)||'<em class="mm-blank">—</em>'}</span>`}).join('');
   row.innerHTML=`${cells}${showAudit?`<span class="mm-user" title="${esc(it.updated_by||'')}">${esc(it.updated_by||'-')}</span><span class="mm-date">${esc(fmtDT(it.updated_at))}</span>`:''}<span class="mm-act"><button type="button" class="mm-edit" title="この行の内容を編集します">編集</button>${def.hasDelete?'<button type="button" class="mm-del" title="この行を削除します（確認画面が出ます）">削除</button>':''}</span>`;
   // 入力項目が多いマスタは編集専用モーダル、少ないマスタは従来どおり
   // 上部のインラインフォームへ読み込む(ARCHITECTURE.md「マスタ管理の画面形態」、defUsesEditorModal)。
   const edit=()=>{
    if(defUsesEditorModal(def)){openMaintEditor(it);return}
    maintState.editing=Object.assign({},it);renderMaintForm();
    const f=$('#masterMaintForm');if(f)f.scrollIntoView({block:'nearest'});
   };
   row.querySelector('.mm-edit').onclick=e=>{e.stopPropagation();edit()};
   const del=row.querySelector('.mm-del');if(del)del.onclick=e=>{e.stopPropagation();deleteMaint(it)};
   row.onclick=()=>edit();row.ondblclick=()=>edit();
   row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){if(e.key===' ')e.preventDefault();edit()}};
   frag.append(row);
  });
  list.append(frag);
 }
 function setMaintSearchVisible(show){
  const search=document.querySelector('#masterMaintPanel .mm-search');if(search)search.style.display=show?'':'none';
  const cnt=$('#masterMaintCount');if(cnt)cnt.style.display=show?'':'none';
 }
 // マスタは共有DBを読む種類があり数秒かかることがある。無反応に見えて
 // タブを連打されないよう、読み込みはWAITING表示で包む(records-store.jsの
 // withWaiting。速いときは出ないので通常の操作感は変わらない)。
 async function loadMaint(force){
  const def=currentDef();
  if(typeof withWaiting!=='function')return loadMaintInner(force);
  return withWaiting({title:def.label+'マスタを読み込んでいます',detail:'マスタDB: '+(def.endpoint||'-'),
   progress:'登録済みの内容を取得しています'},()=>loadMaintInner(force));
 }
 async function loadMaintInner(force){
  const def=currentDef();const title=$('#masterMaintTitle');
  /* 見出しは**その画面の呼び名**。「〜マスタ」を機械的に足すと
     「データ接続マスタ」のような読みにくい名前ができる。 */
  if(title)title.textContent=def.titleText||(def.label+'マスタ');
  // 設定ページ形式(パス設定・§9.68)はフォーム自体がスクロール領域になる。
  // タブを移ったら必ず外す(付いたままだと他のマスタで上部フォームが
  // 伸び縮みして一覧の高さが安定しない)。
  $('#masterMaintForm')?.classList.remove('mm-form-page');
  if(def.special==='meas-storage'){setMaintSearchVisible(false);return loadMeasStorageMaint(force)}
  if(def.special==='import-backup'){setMaintSearchVisible(false);return loadImportBackupMaint(force)}
  if(def.special==='load-factor'){setMaintSearchVisible(false);return loadLoadFactorMaint(force)}
  if(def.special==='data-source'){setMaintSearchVisible(false);return loadDataSourceMaint(force)}
  if(def.special==='query-join'){setMaintSearchVisible(false);return loadQueryJoinMaint(force)}
  if(def.special==='path-config'){setMaintSearchVisible(false);return loadPathConfigMaint(force)}
  if(def.special==='shift-pattern'){setMaintSearchVisible(false);return loadShiftPatternMaint(force)}
  if(def.special==='op-item'){setMaintSearchVisible(false);return loadOpItemMaint(force)}
  if(def.special==='raw-table'){setMaintSearchVisible(false);return loadRawTableMaint(force)}
  setMaintSearchVisible(true);
  const list=$('#masterMaintList');if(list&&force)list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  // 一覧に「作業可能設備」を文章で出すのは配列で持つequipment-multiだけ
  // (equipment-multi-textは保存値が文字列で、列側はformat:'equipmentTarget'が
  //  そのまま整形する。両方を拾うと使われない`〜Text`が生えるだけになる)。
  const multiField=def.fields.find(f=>f.type==='equipment-multi');
  const needsEquipmentMaster=multiField||def.fields.some(f=>f.type==='equipment-select'||f.type==='equipment-multi-text');
  // force未指定(キャッシュ利用)のままだと、設備マスタタブで新規登録・削除した
  // 直後でもオペレータ/設備停止タブの選択肢が古いままになる。loadMaint()の
  // forceをそのまま伝播し、タブを開き直すたびに最新の設備マスタを反映する。
  if(needsEquipmentMaster&&typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){/* 設備マスタが読めなくても一覧の表示は継続する */}}
  renderMaintForm();
  try{
   const r=await api(def.endpoint);let items=(r&&r.items)||[];
   if(multiField)items=items.map(it=>({...it,[multiField.k+'Text']:(Array.isArray(it[multiField.k])&&it[multiField.k].length)?it[multiField.k].join('、'):'（制限なし・全設備）'}));
   maintState.items=items;
   renderMaintList();
  }catch(e){if(list)list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }

 /* ---------- 換算係数モデル(docs/SCHEDULE_MODE_DESIGN.md §6・§9.8) ----------
    因子×水準の一覧(自動算出値・N数・上書き値)は「自動算出＋上書き」の2層
    構造で汎用CRUDのフォームに載らないため、専用の描画を持つ特別扱いにする。 */
 let loadFactorState={equipment:'',configured:true,model:null,accuracy:null};
 function loadFactorBasisLabel(b){return {equipment:'自設備の実績',pooled:'全設備プール(自設備は実績不足)',default:'算出不可(実績なし)'}[b]||b||'-'}
 function fmtLfMinutes(min){if(min===null||min===undefined)return '-';const v=Math.round(min);if(v<60)return `${v}分`;return `${Math.floor(v/60)}時間${v%60?(v%60)+'分':''}`}
 async function loadLoadFactorMaint(force){
  const list=$('#masterMaintList');if(!list)return;
  if(typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){/* 設備マスタが読めなくても画面表示は継続する */}}
  const opts=equipmentMasterState.items||[];
  if(!loadFactorState.equipment&&opts.length)loadFactorState.equipment=opts[0].name;
  renderLoadFactorForm();
  if(!loadFactorState.equipment){list.innerHTML='<div class="mm-empty">設備マスタが未登録です。先に「設備」タブで登録してください。</div>';return}
  list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const [lf,acc]=await Promise.all([
    api('/api/schedule/load-factors?equipment='+encodeURIComponent(loadFactorState.equipment)),
    api('/api/schedule/accuracy?equipment='+encodeURIComponent(loadFactorState.equipment)).catch(()=>null),
   ]);
   loadFactorState.configured=!!(lf&&lf.configured);
   loadFactorState.model=loadFactorState.configured?lf.model:null;
   loadFactorState.accuracy=acc;
   renderLoadFactorList();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 function renderLoadFactorForm(){
  const form=$('#masterMaintForm');if(!form)return;
  const opts=equipmentMasterState.items||[];
  const optHtml=opts.map(eq=>`<option value="${esc(eq.name)}"${eq.name===loadFactorState.equipment?' selected':''}>${esc(eq.name)}</option>`).join('');
  form.innerHTML=`<div class="mm-form-head"><span class="mm-mode-chip new">換算係数モデル</span></div>
   <div class="mm-cd-toolbar">
    <div class="mm-cd-dbtabs"><select id="mmLfEquipment">${optHtml||'<option value="">設備マスタが未登録です</option>'}</select></div>
    <div class="mm-cd-actions"><button type="button" id="mmLfRecalc" class="mm-btn-ghost sm">再計算</button></div>
   </div>
   <p class="mm-form-hint">因子ごとの自動算出係数(§6)と手動上書きです。係数を入力して保存すると上書きが有効になり、空欄で保存すると解除されます。「BASE」行は基準時間T0(1件あたりの基準所要分)自体を分単位で上書きします。</p>`;
  form.onsubmit=ev=>ev.preventDefault();
  const sel=$('#mmLfEquipment');
  if(sel)sel.onchange=()=>{loadFactorState.equipment=sel.value;loadLoadFactorMaint(false)};
  const recalc=$('#mmLfRecalc');
  if(recalc)recalc.onclick=async()=>{
   const uid=requireMaintUser();if(uid===null)return;
   try{
    setMaintLoading(true,'再計算しています…');
    await api('/api/schedule/load-factors/recalc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({equipment:loadFactorState.equipment,user_id:uid})});
    await loadLoadFactorMaint(true);
    showToast&&showToast('再計算しました','',3200);
   }catch(e){showToast&&showToast('再計算できませんでした',e.message,6500)}
   finally{setMaintLoading(false)}
  };
 }
 function renderLoadFactorList(){
  const list=$('#masterMaintList');if(!list)return;
  if(!loadFactorState.configured){list.innerHTML='<div class="mm-empty">スケジュール機能が設定されていません(config/local.jsonのschedule_share_path未設定)。</div>';return}
  const model=loadFactorState.model;
  if(!model){list.innerHTML='<div class="mm-empty">この設備の完了実績がまだ無く、係数を算出できません。</div>';return}
  const acc=loadFactorState.accuracy;
  const baseOv=(model.overrides||[]).find(o=>o.factor==='BASE');
  const summary=`<div class="lf-summary">
   <div><small>基準</small><b>${esc(loadFactorBasisLabel(model.basis))}</b></div>
   <div><small>基準時間T0</small><b>${fmtLfMinutes(model.T0)}</b>${baseOv?`<span class="lf-override-note">→ 上書き適用中: ${fmtLfMinutes(baseOv.coefficient)}</span>`:''}</div>
   <div><small>実績件数</small><b>${model.n}件${model.excluded?`(外れ値${model.excluded}件除外)`:''}</b></div>
   <div><small>ばらつき(σ)</small><b>${model.sigmaLog!=null?model.sigmaLog:'-'}</b></div>
   ${acc&&acc.n?`<div><small>精度: 中央値バイアス</small><b>${acc.medianLogBias>0?'+':''}${acc.medianLogBias}</b></div>
   <div><small>精度: MAPE相当</small><b>${Math.round((acc.mape||0)*100)}%(n=${acc.n})</b></div>`:''}
  </div>`;
  const overrideMap={};
  (model.overrides||[]).forEach(o=>{overrideMap[o.factor+'\u0000'+(o.level||'')]=o});
  const baseOverride=overrideMap['BASE\u0000'];
  const baseRow=`<div class="lf-row lf-row-base">
   <span class="lf-row-key">BASE</span><span class="lf-row-level">基準時間T0</span>
   <span class="lf-row-value">${fmtLfMinutes(model.T0)}</span><span class="lf-row-n">n=${model.n}</span>
   <span class="lf-row-override"><input type="number" step="0.1" min="0" placeholder="分で上書き" data-lf-factor="BASE" data-lf-level="" value="${baseOverride?baseOverride.coefficient:''}"></span>
   <span class="lf-row-actions"><button type="button" class="mm-btn-ghost sm" data-lf-save="BASE|">保存</button>${baseOverride?'<button type="button" class="mm-btn-ghost sm" data-lf-clear="BASE|">解除</button>':''}</span>
  </div>`;
  const factorRows=(model.factors||[]).map(f=>{
   const ov=overrideMap[f.key+'\u0000'+f.level];
   return `<div class="lf-row">
    <span class="lf-row-key">${esc(f.key)}</span><span class="lf-row-level">${esc(f.level)}</span>
    <span class="lf-row-value">×${f.value}</span><span class="lf-row-n">n=${f.n}</span>
    <span class="lf-row-override"><input type="number" step="0.01" min="0" placeholder="係数で上書き" data-lf-factor="${esc(f.key)}" data-lf-level="${esc(f.level)}" value="${ov?ov.coefficient:''}"></span>
    <span class="lf-row-actions"><button type="button" class="mm-btn-ghost sm" data-lf-save="${esc(f.key)}|${esc(f.level)}">保存</button>${ov?`<button type="button" class="mm-btn-ghost sm" data-lf-clear="${esc(f.key)}|${esc(f.level)}">解除</button>`:''}</span>
   </div>`;
  }).join('');
  list.innerHTML=`${summary}
   <div class="lf-table">
    <div class="lf-row lf-row-head"><span>因子</span><span>水準</span><span>係数</span><span>N</span><span>手動上書き</span><span></span></div>
    ${baseRow}
    ${factorRows||'<div class="mm-empty">この設備には因子(水準)がありません。</div>'}
   </div>`;
  list.querySelectorAll('[data-lf-save]').forEach(btn=>btn.onclick=()=>saveLoadFactorOverride(btn.dataset.lfSave,false));
  list.querySelectorAll('[data-lf-clear]').forEach(btn=>btn.onclick=()=>saveLoadFactorOverride(btn.dataset.lfClear,true));
 }
 async function saveLoadFactorOverride(key,clear){
  const uid=requireMaintUser();if(uid===null)return;
  const [factor,level]=key.split('|');
  let coefficient=null;
  if(!clear){
   const input=document.querySelector(`[data-lf-factor="${CSS.escape(factor)}"][data-lf-level="${CSS.escape(level)}"]`);
   const raw=input?String(input.value).trim():'';
   if(!raw){showToast&&showToast('係数(またはBASEは分)を入力してください','',3200);return}
   coefficient=Number(raw);
   if(!Number.isFinite(coefficient)){showToast&&showToast('数値を入力してください','',3200);return}
  }
  try{
   setMaintLoading(true,clear?'解除しています…':'保存しています…');
   await api('/api/schedule/load-factors/override',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({equipment:loadFactorState.equipment,factor,level,coefficient,user_id:uid})});
   await loadLoadFactorMaint(true);
   showToast&&showToast(clear?'上書きを解除しました':'上書きを保存しました','',3200);
  }catch(e){showToast&&showToast('保存できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }
 /* ---------- 測定データの保存(§9.202、利用者の指示) ----------
    「入力したのに完了へ反映されない」「測定バックアップの設定部分が無い」
    「『DBに同期』の使い方が分からない」は、**3つの置き場の関係が
    どこにも書かれていない**ことが元だった。ここで1枚にまとめる。

     ① この端末のブラウザ (IndexedDB＋localStorageの控え)
        …入力の実体。**「保存」を押すまで入らない**（打っている最中は
          画面の中だけ）。この端末を替えると見えない。
     ② この端末のDB       (db/records.sqlite3)
        …①を保存するたびに自動で送る。**他のPCから続きを開けるのはここ**。
     ③ 閲覧用の複製       (Box等・読むだけ)
        …②が変わったら間隔ごとに丸ごと写す。閲覧モードはここを読む。

    守っていること:
     ・**流れの順に左から右**へ置く（視覚導線と作業導線を一致させる。§14）
     ・**いま何件どこにあるか**を数字で出す。数えられなければ「—」にして
       0件と言い切らない（§9.107と同じ約束）
     ・**次にすることを1つだけ指す**（未送信があるときだけ「今すぐ送る」を
       強調する。§2）
     ・設定はこの画面だけが持つ（共通設定からは移動した。§9.168） */
 let measStorageState={loaded:false,server:null,local:null,err:''};
 async function loadMeasStorageMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&measStorageState.loaded){renderMeasStorage();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">測定データの置き場を調べています…</div>';
  try{
   /* ①はブラウザの中なのでサーバーからは見えない。**画面側が数える**。
      読めなくても画面は出す（数えられなかったことを書く）。 */
   const [srv,cfg,localItems]=await Promise.all([
    api('/api/measurement/storage'),
    api('/api/path-config-master'),
    (typeof reliableAll==='function'?reliableAll():Promise.resolve(null)).catch(()=>null),
   ]);
   measStorageState.server=srv;
   measStorageState.cfg=cfg;
   measStorageState.local=localItems;
   measStorageState.loaded=true;measStorageState.err='';
   renderMeasStorage();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 function msNum(n){return (n===null||n===undefined)?'—':String(n)}
 function msWhen(v){
  if(!v)return '—';
  const t=typeof v==='number'?v*1000:Date.parse(String(v).replace(' ','T'));
  if(!Number.isFinite(t))return String(v);
  const min=Math.round((Date.now()-t)/60000);
  const stamp=new Date(t).toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  if(min<1)return `${stamp}（たった今）`;
  if(min<60)return `${stamp}（${min}分前）`;
  return `${stamp}（${Math.round(min/60)}時間前）`;
 }
 function msSize(n){return (n===null||n===undefined)?'—':(n/1048576).toFixed(1)+'MB'}
 function renderMeasStorage(){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  const srv=measStorageState.server||{},exp=srv.export||{},loc=srv.local||{};
  const items=measStorageState.local;
  const draft=items?items.filter(x=>x.status!=='完了').length:null;
  const done=items?items.filter(x=>x.status==='完了').length:null;
  const unsent=items?items.filter(x=>(x.syncState&&x.syncState.status)!=='synced').length:null;
  const v=(measStorageState.cfg&&measStorageState.cfg.values)||{};
  const interval=Number(exp.intervalSec||600);
  const mins=Math.max(1,Math.round(interval/60));
  /* 次にすること。**1つだけ指す**(§2)。 */
  const next=unsent
   ?`この端末に<b>まだ②へ送っていないデータが${unsent}件</b>あります。「未送信を今すぐ送る」を押してください。`
   :(!exp.configured
     ?'②までは保存できています。他のPCから<b>閲覧だけ</b>させたい場合は、下の「閲覧用の複製先」を設定してください（設定しなくても測定・共有はできます）。'
     :(exp.pending?'②に新しい変更があります。次の複製で③へ写ります（すぐ写したいときは「いま複製する」）。'
                  :'すべて送信・複製できています。いまは何もする必要がありません。'));
  const stage=(no,title,sub,rows,note,cls)=>`<div class="ms-stage ${cls||''}">
    <div class="ms-stage-head"><span class="ms-no">${no}</span><b>${esc(title)}</b><small>${esc(sub)}</small></div>
    <dl class="ms-kv">${rows.map(([k,val,warn])=>
      `<dt>${esc(k)}</dt><dd${warn?' class="is-warn"':''}>${val}</dd>`).join('')}</dl>
    <p class="ms-note">${note}</p></div>`;
  const arrow=(a,b)=>`<div class="ms-arrow" aria-hidden="true"><b>${esc(a)}</b><i>→</i><small>${esc(b)}</small></div>`;
  form.innerHTML=`
   <div class="mm-form-head"><span class="mm-mode-chip editing">この端末の設定</span></div>
   <p class="ms-lead">測定データは<b>3か所</b>に置かれます。左から右へ流れます。
    <b>打っている最中はまだどこにも入っていません</b>——「保存して一覧へ」か「測定を完了」を押した時点で①と②へ入ります。</p>
   <div class="ms-next"><span class="ms-next-label">次にすること</span><span>${next}</span></div>
   <div class="ms-flow">
    ${stage('①','この端末のブラウザ','IndexedDB＋控え',[
      ['編集中',msNum(draft)+(draft===null?'':'件')],
      ['完了',msNum(done)+(done===null?'':'件')],
      ['②へ未送信',msNum(unsent)+(unsent===null?'':'件'),!!unsent],
     ],'入力した値の実体です。<b>この端末でしか見えません</b>。ブラウザのデータを消すと失われます。',
      unsent?'is-warn':'')}
    ${arrow('保存のたび','自動')}
    ${stage('②','この端末のDB','db/records.sqlite3',[
      ['記録',msNum(loc.count)+(loc.count===null?'':'件')],
      ['最終書込',msWhen(loc.lastWriteAt)],
      ['大きさ',msSize(loc.size)],
     ],`<b>他のPCから続きを開けるのはここ</b>です（データ一覧はここも読みます）。<br><code title="${esc(loc.path||'')}">${esc(loc.path||'—')}</code>`)}
    ${arrow(`変わったら${mins}分ごと`,exp.configured?'自動':'未設定')}
    ${stage('③','閲覧用の複製','Box等・読むだけ',[
      ['状態',exp.configured?(exp.exists===false?'まだ作られていません':'複製しています'):'<b>未設定（複製しません）</b>',!exp.configured],
      ['最終複製',exp.configured?msWhen(exp.lastOkAt):'—'],
      ['未反映の変更',exp.configured?(exp.pending?'あり':'なし'):'—'],
     ],exp.configured
        ?`閲覧モードの端末はここを読みます。書き戻しはしません。<br><code title="${esc(exp.path||'')}">${esc(exp.path||'—')}</code>`
        :'設定すると、②の中身をまるごとBox等へ写します。<b>測定・共有には必要ありません</b>——閲覧専用の端末に見せたいときだけ設定してください。',
      exp.configured?'':'is-off')}
   </div>
   ${exp.lastError?`<p class="ms-err">前回の複製に失敗しました: ${esc(exp.lastError)}</p>`:''}
   <div class="mm-cd-toolbar"><div class="mm-cd-actions">
    <button type="button" id="msSyncNow" class="${unsent?'mm-btn-primary':'mm-btn-ghost sm'}"${unsent?'':' disabled'}
      title="${unsent?'①のうち②へ送れていないものを、まとめて送ります':'未送信のデータはありません'}">未送信を今すぐ送る${unsent?`（${unsent}件）`:''}</button>
    <button type="button" id="msExportNow" class="mm-btn-ghost sm"${exp.configured?'':' disabled'}
      title="${exp.configured?'間隔を待たずに、いま②を③へ写します':'複製先が未設定です'}">いま複製する</button>
    <button type="button" id="msReload" class="mm-btn-ghost sm">状態を読み直す</button>
   </div></div>
   <div class="ms-settings">
    <h4>③ 閲覧用の複製の設定</h4>
    <label class="mm-field"><span>複製先のフォルダ</span>
     <input type="text" id="msExportPath" value="${esc(v.records_backup_export_path||'')}"
       placeholder="例: C:\\Users\\…\\Box\\WaveLog閲覧用" autocomplete="off">
     <small class="mm-field-hint">フォルダを指定します（この下に records.sqlite3 を作ります）。
      空欄なら複製しません。<b>複製先を変えたときはアプリの再起動が必要です</b>（接続先は起動時に1回だけ決まります）。</small></label>
    <label class="mm-field"><span>複製を見に行く間隔</span>
     <span class="mm-field-num"><input type="number" id="msExportInterval" min="30" step="30"
       value="${esc(String(v.records_backup_export_interval_sec||exp.intervalSec||600))}"><em>秒</em></span>
     <small class="mm-field-hint"><b>変わったときだけ</b>複製するので、短くしても無駄な複製は増えません。
      こちらは保存後すぐ反映されます（再起動は要りません）。</small></label>
    <div class="mm-cd-actions"><button type="button" id="msSaveCfg" class="mm-btn-primary">この設定を保存</button></div>
   </div>
   <p class="mm-field-hint">測定画面の「DBへ同期」は、<b>いま開いている測定を①②へ即座に書く</b>ボタンです
    （保存して閉じずに、そこまでの入力を確実に残したいときに使います）。他のPCへ渡したい・PCを入れ替えるときは
    「データ引継ぎ」タブを使ってください。</p>`;
  list.innerHTML='';
  $('#msReload').onclick=()=>{measStorageState.loaded=false;loadMeasStorageMaint(true)};
  $('#msSyncNow').onclick=async()=>{
   if(typeof syncPendingRecords!=='function'){showToast&&showToast('この画面からは送れません','',4000);return}
   await syncPendingRecords({silent:false});
   measStorageState.loaded=false;loadMeasStorageMaint(true);
  };
  $('#msExportNow').onclick=async()=>{
   try{
    setMaintLoading(true,'複製しています…');
    await api('/api/measurement/backup/export-now',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    showToast&&showToast('複製しました','',3200);
   }catch(e){showToast&&showToast('複製できませんでした',e.message,7000)}
   finally{setMaintLoading(false);measStorageState.loaded=false;loadMeasStorageMaint(true)}
  };
  $('#msSaveCfg').onclick=async()=>{
   /* **送るのはこの2つだけ**。パス設定の保存は「送られてきた項目だけ」を
      書くので、他の設定を巻き添えにしない(§9.192)。 */
   const body={records_backup_export_path:String($('#msExportPath').value||'').trim(),
               records_backup_export_interval_sec:String($('#msExportInterval').value||'').trim(),
               user_id:String($('#masterUserId')?.value||'').trim()};
   try{
    setMaintLoading(true,'保存しています…');
    await api('/api/path-config-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    pathConfigState.loaded=false;
    showToast&&showToast('保存しました','複製先を変えた場合は、アプリを再起動すると反映されます',6000);
   }catch(e){showToast&&showToast('保存できませんでした',e.message,7000)}
   finally{setMaintLoading(false);measStorageState.loaded=false;loadMeasStorageMaint(true)}
  };
 }
 /* ---------- データ引継ぎ（PC引継ぎ等でrecords.sqlite3からIndexedDBへ取り込む） ----------
    通常はIndexedDB→records.sqlite3の一方通行だが、PC更新等でIndexedDBが
    空の端末に対しては逆方向の取り込みが必要になる。対象のペイロードは
    codec='json-full-v32'（現行の完全JSONスナップショット）のみをサポートし、
    それ以外(旧形式等)は安全側に倒して「非対応」として選択不可にする。
    既存IDと衝突する場合は上書きになるため、選択状態を可視化した上で
    確認ダイアログを挟んでから実行する。 ---------- */
 let importBackupState={items:[],loaded:false,localIds:new Set()};
 async function loadImportBackupMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&importBackupState.loaded){renderImportBackupForm();renderImportBackupList();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">records.sqlite3を読み込んでいます…</div>';
  try{
   const [backupResult,localItems]=await Promise.all([api('/api/measurement/backup/list'),reliableAll().catch(()=>[])]);
   importBackupState.items=(backupResult&&backupResult.items)||[];
   importBackupState.localIds=new Set(localItems.map(x=>x.id));
   importBackupState.loaded=true;
   renderImportBackupForm();renderImportBackupList();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 function renderImportBackupForm(){
  const form=$('#masterMaintForm');if(!form)return;
  const items=importBackupState.items,supported=items.filter(x=>x.codec==='json-full-v32');
  // 端末内(IndexedDB)に対応が無い行 = データ一覧に出ないのに実績突合には効く残骸候補(§9.52)
  const orphans=items.filter(x=>!importBackupState.localIds.has(x.id));
  form.innerHTML=`<div class="mm-form-head"><span class="mm-mode-chip editing">PC引継ぎ専用</span></div>
   <div class="mm-import-warning">
    <b>注意: この操作はこの端末のIndexedDB（編集中/完了データ）を書き換えます。</b>
    <span>records.sqlite3（Web測定バックアップ）の内容を、この端末のローカルデータへ取り込みます。同じIDの既存データは上書きされ、元に戻せません。PC更新・端末交換時の引継ぎなど、特別な場合以外は実行しないでください。</span>
   </div>
   <div class="mm-imp-state">
    <div class="mm-imp-state-col">
     <span class="mm-imp-state-label">いまの状態</span>
     <ul class="mm-imp-state-list">
      <li>バックアップ(records.sqlite3): <b>${esc(String(items.length))}</b>件</li>
      <li>うちこの端末にも有る: <b>${esc(String(items.length-orphans.length))}</b>件</li>
      <li>うちこの端末に<b>無い</b>: <b class="${orphans.length?'is-warn':''}">${esc(String(orphans.length))}</b>件</li>
      <li>取込できる形式: <b>${esc(String(supported.length))}</b>件${supported.length<items.length?`（非対応 ${esc(String(items.length-supported.length))}件）`:''}</li>
     </ul>
    </div>
    <div class="mm-imp-arrow" aria-hidden="true">→</div>
    <div class="mm-imp-state-col">
     <span class="mm-imp-state-label">選択中の操作で起きること</span>
     <div id="mmImpPreview" class="mm-imp-preview">まだ何も選ばれていません。下の一覧で対象を選ぶと、ここに変化の予定が出ます。</div>
    </div>
   </div>
   <div class="mm-cd-toolbar">
    <div class="mm-cd-actions">
     <button type="button" id="mmImpReload" class="mm-btn-ghost sm">再読込</button>
     <button type="button" id="mmImpSelectAll" class="mm-btn-ghost sm">取込可能をすべて選択</button>
     <button type="button" id="mmImpSelectOrphan" class="mm-btn-ghost sm"${orphans.length?'':' disabled'}>この端末に無いものを選択</button>
     <button type="button" id="mmImpSelectNone" class="mm-btn-ghost sm">選択解除</button>
     <button type="button" id="mmImpRun" class="mm-btn-primary">選択した項目をこの端末へ取り込む</button>
     <span class="mm-cd-sep" aria-hidden="true"></span>
     <button type="button" id="mmImpDelete" class="mm-btn-danger">選択した項目をバックアップから削除</button>
    </div>
   </div>
   ${orphans.length?`<div class="mm-import-warning is-orphan">
     <b>この端末のデータ一覧に無いバックアップが ${esc(String(orphans.length))}件あります。</b>
     <span>作業スケジュールの「作業中」「完了」はこのバックアップを見て表示するため、端末から削除済みのデータが残っていると、データ一覧には何も無いのにスケジュールにだけ作業中が並びます。心当たりの無い行は「この端末に無いものを選択」→「選択した項目をバックアップから削除」で消せます。<b>他のPCで測定したデータをこのPCで参照している場合は、それも「無し」になります。消す前に内容をご確認ください。</b></span>
    </div>`:''}`;
  form.onsubmit=ev=>ev.preventDefault();
  const reload=$('#mmImpReload'),selAll=$('#mmImpSelectAll'),selNone=$('#mmImpSelectNone'),run=$('#mmImpRun');
  if(reload)reload.onclick=()=>loadImportBackupMaint(true);
  if(selAll)selAll.onclick=()=>document.querySelectorAll('#masterMaintList [data-imp-id]:not(:disabled)').forEach(b=>b.checked=true);
  if(selNone)selNone.onclick=()=>document.querySelectorAll('#masterMaintList [data-imp-id]').forEach(b=>b.checked=false);
  if(run)run.onclick=()=>runImportBackup();
  const selOrphan=$('#mmImpSelectOrphan'),del=$('#mmImpDelete');
  if(selOrphan)selOrphan.onclick=()=>{
   document.querySelectorAll('#masterMaintList [data-imp-id]').forEach(b=>{b.checked=b.dataset.impOrphan==='1'});
   updateImportPreview();
  };
  if(del)del.onclick=()=>deleteBackupSelection();
  [selAll,selNone].forEach(b=>{if(b){const prev=b.onclick;b.onclick=()=>{prev&&prev();updateImportPreview()}}});
  updateImportPreview();
 }
 /* 選択した内容で「何がどう変わるか」を実行前に言葉で示す(§9.68)。
    取り込みも削除も元に戻せないので、押す前に結果を読めることが重要。 */
 function updateImportPreview(){
  const box=$('#mmImpPreview');if(!box)return;
  const checked=[...document.querySelectorAll('#masterMaintList [data-imp-id]:checked')];
  if(!checked.length){
   box.className='mm-imp-preview';
   box.textContent='まだ何も選ばれていません。下の一覧で対象を選ぶと、ここに変化の予定が出ます。';
   return;
  }
  const orphan=checked.filter(b=>b.dataset.impOrphan==='1').length;
  const overwrite=checked.length-orphan;
  box.className='mm-imp-preview is-active';
  box.innerHTML=`<div class="mm-imp-preview-row"><b>${esc(String(checked.length))}件</b>を選択中</div>
   <div class="mm-imp-preview-plan"><span class="mm-imp-plan-title">「この端末へ取り込む」を押すと</span>
    <ul><li>この端末へ<b>新しく追加</b>: ${esc(String(orphan))}件</li>
     <li>既存データを<b>上書き</b>（元に戻せません）: ${esc(String(overwrite))}件</li></ul></div>
   <div class="mm-imp-preview-plan"><span class="mm-imp-plan-title">「バックアップから削除」を押すと</span>
    <ul><li>バックアップから<b>消える</b>: ${esc(String(checked.length))}件</li>
     <li>作業スケジュールの実績表示から消える: ${esc(String(checked.length))}件</li>
     <li>この端末のデータ一覧は<b>変わらない</b>（端末内データは残ります）</li></ul></div>`;
 }
 function renderImportBackupList(){
  const list=$('#masterMaintList');if(!list)return;
  const items=importBackupState.items;
  if(!items.length){list.innerHTML='<div class="mm-empty">records.sqlite3に取込可能なバックアップがありません。</div>';return}
  const tmpl='40px minmax(90px,1fr) minmax(70px,.7fr) minmax(60px,.6fr) minmax(70px,.7fr) minmax(90px,.8fr) minmax(90px,.9fr) minmax(230px,1.4fr)';
  const head=`<div class="mm-row head" style="grid-template-columns:${tmpl}"><span></span><span>ロット番号</span><span>検査番号</span><span>状態</span><span>設備</span><span>更新日時</span><span>形式</span><span>いまの状態 → 取り込むと</span></div>`;
  const rows=items.map(it=>{
   const supported=it.codec==='json-full-v32';
   const conflict=importBackupState.localIds.has(it.id);
   // 端末内(IndexedDB)に対応するデータが無い行。データ一覧には出ないのに
   // 作業スケジュールの実績突合には効いてしまう「残骸」の候補(§9.52)。
   const orphan=!conflict;
   // 「今どうなっていて、取り込むとどうなるか」を1つの列で示す(§9.68)。
   // 以前は「取込先(新規/上書き)」と「端末内(有り/無し)」が別々の列で、
   // 2列を突き合わせないと変化が読み取れなかった。
   const targetLabel=supported
    ?(conflict?'<span class="mm-imp-flow"><span class="mm-imp-badge has">端末内に有り</span><i>→</i><span class="mm-imp-badge overwrite">上書きされる</span></span>'
              :'<span class="mm-imp-flow"><span class="mm-imp-badge orphan">端末内に無し</span><i>→</i><span class="mm-imp-badge new">新しく追加</span></span>')
    :'<span class="mm-imp-badge unsupported">非対応（取り込めません）</span>';
   return `<div class="mm-row${orphan?' is-orphan':''}" style="grid-template-columns:${tmpl}">`+
    `<span><input type="checkbox" data-imp-id="${esc(it.id)}" data-imp-orphan="${orphan?1:0}"${supported?'':' disabled'}></span>`+
    `<span title="${esc(it.lotNo)}">${esc(it.lotNo)||'<em class="mm-blank">—</em>'}</span>`+
    `<span>${esc(it.inspectionNo)||'<em class="mm-blank">—</em>'}</span>`+
    `<span>${esc(it.status)||'<em class="mm-blank">—</em>'}</span>`+
    `<span title="${esc(it.equipment)}">${esc(it.equipment)||'<em class="mm-blank">—</em>'}</span>`+
    `<span class="mm-date">${esc(fmtDT(it.updated_at))}</span>`+
    `<span>${esc(it.codec)||'<em class="mm-blank">—</em>'}</span>`+
    `<span>${targetLabel}</span></div>`;
  }).join('');
  list.innerHTML=head+rows;
  list.querySelectorAll('[data-imp-id]').forEach(b=>b.addEventListener('change',updateImportPreview));
  updateImportPreview();
 }
/* バックアップ(records.sqlite3)から選択行を削除する(§9.52)。
    端末内データの削除はreliableDelete()がバックアップも消すようになったが、
    それ以前に消したもの・他端末で消したものは残骸として残っている。
    実績突合はこのテーブルを見るため、残骸があるとスケジュールにだけ
    「作業中」が出続ける。ここから明示的に消せるようにする。 */
 async function deleteBackupSelection(){
  const ids=[...document.querySelectorAll('#masterMaintList [data-imp-id]:checked')].map(b=>b.dataset.impId);
  if(!ids.length){showToast('選択されていません','削除する行を選んでください。',4000);return}
  const orphan=[...document.querySelectorAll('#masterMaintList [data-imp-id]:checked')].filter(b=>b.dataset.impOrphan==='1').length;
  const msg=`バックアップから ${ids.length}件を削除します。`
   +(orphan<ids.length?`\n\nうち ${ids.length-orphan}件はこの端末のデータ一覧にも存在します。削除するとスケジュールの実績表示から消えますが、端末内のデータは残ります。`:'')
   +'\n\nこの操作は元に戻せません。よろしいですか?';
  const ok=typeof confirmModal==='function'?await confirmModal(msg):window.confirm(msg);
  if(!ok)return;
  try{
   setMaintLoading(true,`バックアップから ${ids.length}件を削除しています…`);
   const r=await api('/api/measurement/backup/delete',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ids})});
   // 実績が変わったので作業スケジュールの予定キャッシュを捨てる
   if(typeof window.invalidateSchedulePlanCache==='function')window.invalidateSchedulePlanCache();
   await loadImportBackupMaint(true);
   showToast('バックアップから削除しました',`${r.deleted}/${r.requested}件`,4600);
  }catch(e){showToast('削除できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }
 async function runImportBackup(){
  const uid=requireMaintUser();if(uid===null)return;
  const checked=[...document.querySelectorAll('#masterMaintList [data-imp-id]:checked')].map(b=>b.dataset.impId);
  if(!checked.length){showToast&&showToast('取込対象が選択されていません','取込可能な項目にチェックを付けてください。',4000);return}
  const targets=importBackupState.items.filter(it=>checked.includes(it.id));
  const overwriteCount=targets.filter(it=>importBackupState.localIds.has(it.id)).length;
  // 取り消せない操作なので、何がどう変わるかを箇条書きで示してから確認する
  // (以前はブラウザ標準のconfirm()で、他画面の確認と作法が揃っていなかった)。
  const okRun=typeof confirmModal==='function'?await confirmModal({
   eyebrow:'IMPORT TO THIS TERMINAL',title:'この端末へ取り込みます',
   danger:true,confirmLabel:'取り込む',
   bodyHtml:`<p class="confirm-modal-message">選択した <b>${esc(String(targets.length))}件</b> をこの端末のデータへ取り込みます。</p>
    <ul class="confirm-modal-points">
     <li>新しく追加: <b>${esc(String(targets.length-overwriteCount))}</b>件</li>
     <li>既存データを上書き: <b>${esc(String(overwriteCount))}</b>件${overwriteCount?'（<b>元に戻せません</b>）':''}</li>
     <li>PC更新・端末交換の引継ぎ以外では実行しないでください。</li>
    </ul>`}):window.confirm(`選択した${targets.length}件を取り込みます。よろしいですか?`);
  if(!okRun)return;
  let okCount=0,ngCount=0;const errors=[];
  try{
   setMaintLoading(true,`インポートしています… (0/${targets.length})`);
   for(let i=0;i<targets.length;i++){
    const it=targets[i];
    setMaintLoading(true,`インポートしています… (${i+1}/${targets.length})`);
    try{
     const record=ensureMeasureShape(JSON.parse(it.payload));
     record.id=it.id;
     await reliablePut(record);okCount++;
    }catch(e){ngCount++;errors.push(`${it.lotNo||it.id}: ${e.message}`)}
   }
  }finally{setMaintLoading(false)}
  await refreshDraftCount();importBackupState.loaded=false;await loadImportBackupMaint(true);
  showToast&&showToast('インポートが完了しました',`成功 ${okCount}件 / 失敗 ${ngCount}件`+(errors.length?`\n${errors.slice(0,3).join('\n')}`:''),8000);
 }
 /* ======================================================================
    データ接続（§9.168。利用者の指示「データソースマスタとパス設定マスタの
    統合／今のUIが使いにくくわかりにくいので再構築」）
    ----------------------------------------------------------------------
    直す前の問題は3つだった。
      ① 同じ「どこを読むか」が2画面に分かれていた（データソースの共有パス・
         出力ファイルと、パス設定の個別上書き）。どちらが効くのかは画面の
         どこにも書いていなかった。
      ② 読み方を決めるのが`sikalot_source`という**全体で1つのスイッチ**
         だけで、「このソースは共有、あのソースはRNE」が表現できなかった。
         RNEの無い端末では、使わない抽出が回り続けて失敗ログだけが残る。
      ③ 保存しても接続先は再起動まで変わらないので、**打ち間違いに
         気づけるのが再起動のあと**だった。
    そこで、
      ・1行＝1カードにして「何か／どこから／何ができるか」を同時に見せる
      ・読み方は行ごとに選ぶ（共有 / RNEから作る / 直接指定）
      ・編集ウィンドウは**スクロールさせない**代わりに大きく取り、
        右半分で「この設定でできること」を**保存する前に**確かめる
    という形にした。 */
 let dsState={items:[],loaded:false,assets:{},editing:null,probe:null,probePath:'',probeSeq:0,probing:false};
 /* 読み方の呼び名は**1箇所**。サーバー（backend/db_access.pyの
    source_read_mode）が返す語をそのまま画面の言葉へ写す。 */
 const DS_MODES=[
  {v:'share',label:'共有フォルダのファイルを読む',
   hint:'ネットワーク共有に置いてある .sqlite3 をそのまま読みます。RNEは要りません。'},
  {v:'rne',label:'この端末でRNEから作って読む',
   hint:'RNE（抽出定義）から .sqlite3 を作り、それを読みます。RNEの資材を置いた端末だけです。'},
  {v:'direct',label:'このファイルを直接読む（検証・一時的な差し替え）',
   hint:'上の2つに関わらず、ここに入れた場所を最優先で読みます。空にすると上の設定へ戻ります。'},
 ];
 const DS_MODE_SHORT={share:'共有フォルダ',rne:'RNEから作る',direct:'直接指定'};
 const DS_ROLE_CLASS={'仕掛':'is-work','品質':'is-quality','スケジュール':'is-schedule'};
 async function loadDataSourceMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&dsState.loaded){renderDataSourceForm();renderDataSourceList();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const r=await api('/api/data-source-master');
   dsState.items=r.items||[];
   dsState.assets={assetsDir:r.assetsDir||'',confPath:r.confPath||'',confExists:!!r.confExists};
   /* 選べる役割と、いま埋まっている行は**サーバーが答える**(§9.193)。
      「各1件」という決まりを持っているのはあちらなので、画面で数え直さない
      ——無効にした行まで数えて「埋まっている」と言ってしまう。 */
   dsState.purposes=Array.isArray(r.purposes)&&r.purposes.length?r.purposes:['仕掛','品質','スケジュール'];
   dsState.purposeHolders=r.purposeHolders||{};
   dsState.loaded=true;
   renderDataSourceForm();renderDataSourceList();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 /* 上段は**要約と入口だけ**。面積は「頻度×重要度」で配る——ここで毎日見るのは
    「何件あって、再起動待ちがあるか」で、1件ずつの中身は下のカードが持つ。 */
 function renderDataSourceForm(){
  const form=$('#masterMaintForm');if(!form)return;
  const on=dsState.items.filter(x=>x.active);
  const work=on.filter(x=>x.purpose==='仕掛').length,quality=on.filter(x=>x.purpose==='品質').length;
  const sched=on.filter(x=>x.purpose==='スケジュール').length;
  const pending=on.filter(dsPending).length;
  const rne=on.filter(x=>x.readMode==='rne').length;
  form.className='mm-form';
  form.innerHTML=`
   <div class="ds-summary">
    <div class="ds-summary-facts">
     <span class="ds-sum"><b>${on.length}</b> 件が有効</span>
     <span class="ds-sum${work?'':' is-warn'}">仕掛 <b>${work}</b></span>
     <span class="ds-sum">品質 <b>${quality}</b></span>
     <span class="ds-sum">スケジュール <b>${sched}</b></span>
     <span class="ds-sum">RNEで作る <b>${rne}</b></span>
     ${pending?`<span class="ds-sum is-pending"><b>${pending}</b> 件が再起動待ち</span>`:''}
    </div>
    <div class="ds-summary-act">
     <button type="button" class="mm-btn-ghost" id="dsCommonBtn" title="共有パス・RNE資材の置き場・間隔の設定へ移ります">共通設定…</button>
     <button type="button" class="mm-btn-primary" id="dsAddBtn">＋ データソースを追加</button>
    </div>
   </div>
   <p class="mm-def-hint">${work?'':'<b>役割「仕掛」のデータソースがありません。</b>測定・作業スケジュールへの投入はできません。 '
     }役割は<b>「読むかどうか」ではなく「何として使うか」</b>です（仕掛・品質・スケジュールは各1件、それ以外は「その他」として一覧に出るだけ）。 <b>名称と読み込み先</b>の変更はサーバー再起動後に反映されます（それまでは今までの名前・場所のままです）。</p>`;
  form.onsubmit=ev=>ev.preventDefault();
  const add=$('#dsAddBtn');if(add)add.onclick=()=>openDataSourceEditor(null);
  /* 共通設定へは**そのタブを押したのと同じ道**で移る（入口を2本作らない）。 */
  const common=$('#dsCommonBtn');
  if(common)common.onclick=()=>document.querySelector('#masterMaintNav [data-master="pathConfig"]')?.click();
 }
 /* 保存値と、いま効いている場所が違う＝再起動待ち。**まだ読んでいない
    データソース**（登録したばかり）も待ちに含める（§9.163）。 */
 function dsPending(x){return dsPendingKinds(x).length>0}
 /* 何が再起動待ちなのかを**文字で**返す(§9.183)。以前は読み込み先だけを
    見ていたため、**名称を変えても何も言わなかった**（表示名も接続先と同じく
    起動時に1回だけ決まる）。 */
 function dsPendingKinds(x){
  if(!x.active)return [];
  if(x.loaded===false)return ['この端末ではまだ読んでいません'];
  const out=[];
  if(String(x.plannedPath||'')!==String(x.activePath||''))out.push('読み込み先');
  if(x.activeLabel!=null&&String(x.label||'')!==String(x.activeLabel||''))out.push('名称');
  /* 一覧に出すかどうか(§9.193)も起動時に1回だけ決まる（左メニューの元に
     なるカタログはDBSの写しから作る）。**黙っていると「設定したのに
     消えない」**ので、名称と同じ扱いで再起動待ちに数える。 */
  if(x.activeListed!=null&&(x.listed!==false)!==(x.activeListed!==false))out.push('一覧に出すかどうか');
  return out;
 }
 /* 一覧は**行**で組む（§9.193、利用者の指摘「もう少し高密度で、必要な情報を
    バランスよく」）。カード1枚1枚に見出しと定義リストを持たせていたため、
    5件でも縦に長く、しかも**項目の左端がカードごとにずれていて**列として
    追えなかった（CLAUDE.md §9「情報欄は縦にそろえる」）。1行＝1データソース、
    列は固定幅でそろえ、**言うことがあるときだけ**2行目を出す。 */
 const DS_LIST_COLS=[
  {k:'role',label:'役割',hint:'このデータを何として使うか。仕掛・品質・スケジュールは各1件です。'},
  {k:'name',label:'名称 / キー'},
  {k:'listed',label:'一覧',hint:'左メニュー「一覧を見る」に出すかどうか。結合の相手としてだけ読むデータは「出さない」にできます。'},
  {k:'mode',label:'読み方'},
  {k:'path',label:'いま読んでいる'},
  {k:'caps',label:'できること'},
  {k:'act',label:''},
 ];
 function renderDataSourceList(){
  const list=$('#masterMaintList');if(!list)return;
  if(!dsState.items.length){
   list.innerHTML='<div class="mm-empty">データソースがまだありません。「＋ データソースを追加」から登録してください。</div>';
   return;
  }
  const head=DS_LIST_COLS.map(c=>`<span class="ds-h ds-c-${c.k}"${c.hint?` title="${esc(c.hint)}"`:''}>${esc(c.label)}</span>`).join('');
  list.innerHTML=`<div class="ds-rows"><div class="ds-row ds-row-head">${head}</div>`
    +dsState.items.map(dsRowHtml).join('')+`</div>`;
  list.querySelectorAll('[data-ds-edit]').forEach(b=>b.onclick=()=>{
   const x=dsState.items.find(i=>String(i.id)===b.dataset.dsEdit);if(x)openDataSourceEditor(x);
  });
  list.querySelectorAll('[data-ds-del]').forEach(b=>b.onclick=()=>dsDelete(b.dataset.dsDel));
 }
 function dsRowHtml(x){
  const cap=x.capability||{},f=cap.features||{};
  /* できることは**できるものだけ**を出す（§4「できないことは書く」は
     編集画面の役目。一覧では×印が並ぶほうがノイズになる）。理由は title。 */
  const caps=CAPABILITY_ORDER.filter(k=>f[k]&&f[k].ok).map(k=>
    `<i class="ds-cap is-ok" title="${esc(CAPABILITY_LABEL[k]+': '+(f[k].note||''))}">${esc(CAPABILITY_SHORT[k])}</i>`).join('');
  const kinds=dsPendingKinds(x);
  const pending=kinds.length>0;
  const role=x.purpose||'その他';
  const sameLabel=x.activeLabel==null||String(x.label||'')===String(x.activeLabel||'');
  const same=String(x.plannedPath||'')===String(x.activePath||'');
  const listed=x.listed!==false;
  /* 2行目は**打つ手があるときだけ**。同じ場所・同じ名前なら黙っている
     （§9.129 同じものを2箇所に出さない）。 */
  const notes=[];
  if(!same)notes.push(`再起動後は <b>${esc(x.plannedPath||'—')}</b> を読みます`);
  if(!sameLabel)notes.push(`再起動すると名称が「<b>${esc(x.label||'')}</b>」になります（いまは ${esc(x.activeLabel||'—')}）`);
  if(cap.error)notes.push(esc(cap.error));
  return `<div class="ds-row${x.active?'':' is-off'}${pending?' is-pending':''}">
   <span class="ds-c-role"><span class="ds-role ${DS_ROLE_CLASS[role]||''}">${esc(role)}</span></span>
   <span class="ds-c-name">
    <b class="ds-name" title="${esc(x.label||'')}">${esc(x.label||x.key)}</b>
    <code class="ds-key" title="一覧を指す識別子です">${esc(x.key)}</code>
    ${x.active?'':'<span class="ds-flag is-off">無効</span>'}
    ${pending?`<span class="ds-flag is-pending" title="${esc(kinds.join('・'))}が再起動待ちです">再起動待ち</span>`:''}
   </span>
   <span class="ds-c-listed"><span class="ds-listed${listed?'':' is-off'}" title="${
     listed?'左メニュー「一覧を見る」に出ます。':'左メニューには出しません（結合の相手としては読めます）。'
   }">${listed?'出す':'出さない'}</span></span>
   <span class="ds-c-mode">${esc(DS_MODE_SHORT[x.readMode]||'—')}</span>
   <span class="ds-c-path" title="${esc(x.activePath||'')}">${
     esc(x.activePath||'（この端末ではまだ読んでいません）')}</span>
   <span class="ds-c-caps">${caps||'<i class="ds-cap">—</i>'}</span>
   <span class="ds-c-act">
    <button type="button" class="mm-btn-ghost sm" data-ds-edit="${esc(String(x.id))}">編集</button>
    ${x.active?`<button type="button" class="mm-btn-ghost sm" data-ds-del="${esc(String(x.id))}">無効にする</button>`:''}
   </span>
   ${notes.length?`<span class="ds-c-note">${notes.join(' ／ ')}</span>`:''}
  </div>`;
 }
 /* ==================================================================
    クエリ結合(§9.193) — 読んだデータ同士を突合キーでつなぐ
    ------------------------------------------------------------------
    **組み合わせられるのはデータ接続に登録済みのものだけ**（利用者の指示）。
    選択肢はサーバーが返す `sources` から作る——画面で別に一覧を組み立てると、
    無効にしたデータソースが選択肢に残る。

    並びは作業の順番そのもの:「①どの一覧に足すか → ②どこから → ③どうつなぐ
    → ④何を足す → ⑤結果」。**保存する前に当ててみられる**(下見)のが値打ちで、
    読み込み先は起動時に1回だけ決まるため、これが無いと打ち間違いに気づける
    のが再起動のあとになる（§9.168と同じ作法）。
    ================================================================== */
 let qjState={items:[],sources:[],builtin:null,builtinEnabled:true,kinds:[],kindDefault:'left',
              loaded:false,editing:null,
              cols:{},probe:null,probeSeq:0,probing:false,probeSig:'',
              /* 突合キーを選んでいる最中の状態(§9.197)。`pick`＝1つ目に押した列、
                 `search`＝列名の絞り込み（左右それぞれ）。 */
              pick:null,search:{left:'',right:''}};
 /* 結合の仕方(§9.194)。**説明も動きも「一致した行／左だけ／右だけ」の3つの
    真偽値から作る**——サーバー(query_join.JOIN_KINDS)が答えるものをそのまま
    使い、画面で別の判定を書かない。見本の表も同じ3つから組み立てるので、
    「説明はこう書いてあるのに実際は違う」が原理的に起きない。 */
 const QJ_SAMPLE={
  left:{title:'この一覧',cols:['ロット番号','品名'],rows:[['L001','帯鋼'],['L002','条']]},
  right:{title:'相手',cols:['ロット番号','等級'],rows:[['L001','A'],['L003','B']]}};
 function qjKind(key){
  const list=qjState.kinds||[];
  return list.find(k=>k.key===key)||list.find(k=>k.key===(qjState.kindDefault||'left'))||null;
 }
 /* 2つの円で「どこを残すか」を塗る。**色だけで伝えない**(§3)ので、名前・
    一行説明・見本の表を必ず添える。idは同じ図が2箇所に出ても衝突しないよう
    場所ごとの接頭辞を付ける。 */
 function qjVennHtml(k,scope){
  if(!k)return '';
  const id=x=>`qjv-${scope}-${k.key}-${x}`;
  return `<svg class="qj-venn" viewBox="0 0 100 52" role="img" aria-label="${esc(k.label)}の図">
   <defs>
    <clipPath id="${id('c')}"><circle cx="38" cy="26" r="20"/></clipPath>
    <mask id="${id('ml')}"><rect x="0" y="0" width="100" height="52" fill="#fff"/><circle cx="62" cy="26" r="20" fill="#000"/></mask>
    <mask id="${id('mr')}"><rect x="0" y="0" width="100" height="52" fill="#fff"/><circle cx="38" cy="26" r="20" fill="#000"/></mask>
   </defs>
   ${k.leftOnly?`<circle class="on" cx="38" cy="26" r="20" mask="url(#${id('ml')})"/>`:''}
   ${k.rightOnly?`<circle class="on" cx="62" cy="26" r="20" mask="url(#${id('mr')})"/>`:''}
   ${k.matched?`<circle class="on" cx="62" cy="26" r="20" clip-path="url(#${id('c')})"/>`:''}
   <circle class="ring" cx="38" cy="26" r="20"/><circle class="ring" cx="62" cy="26" r="20"/>
  </svg>`;
 }
 /* 行がどう増減するかを**文字で**言う（図と色だけでは伝わらない）。 */
 function qjRowEffect(k){
  if(!k)return '';
  if(k.matched&&k.leftOnly&&!k.rightOnly)return '行は減らない';
  if(k.rightOnly&&k.leftOnly)return '行が増えることがある';
  if(k.rightOnly&&k.matched)return '行が減り、増えることもある';
  if(k.rightOnly)return 'この一覧の行は残らない';
  return '行が減る';
 }
 /* 結合の見本。左2行・右2行の作り物を、上の3つの真偽値どおりに突き合わせる。 */
 function qjSampleHtml(k){
  if(!k)return '';
  const addCols=k.matched||k.rightOnly;
  const cols=['ロット番号','品名'].concat(addCols?['等級']:[]);
  const rows=[];
  if(k.matched)rows.push(['L001','帯鋼','A']);
  if(k.leftOnly)rows.push(['L002','条','']);
  if(k.rightOnly)rows.push(['L003','','B']);
  const cell=v=>v===''?'<td class="is-blank">（空）</td>':`<td>${esc(v)}</td>`;
  const src=(x)=>`<table class="qj-sample-t"><caption>${esc(x.title)}</caption><thead><tr>${
    x.cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
    x.rows.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return `<div class="qj-sample">
    ${src(QJ_SAMPLE.left)}${src(QJ_SAMPLE.right)}
    <span class="qj-sample-arrow" aria-hidden="true">→</span>
    <table class="qj-sample-t is-result"><caption>結合した結果</caption><thead><tr>${
      cols.slice(0,addCols?3:2).map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
      rows.length?rows.map(r=>`<tr>${r.slice(0,addCols?3:2).map(cell).join('')}</tr>`).join('')
        :'<tr><td class="is-blank" colspan="3">1行も残りません</td></tr>'}</tbody></table>
   </div>`;
 }
 const QJ_MULTI_LABEL={first:'最初の1件を使う',blank:'空にする（どれか決められないので出さない）'};
 const QJ_LIST_COLS=[
  {k:'state',label:'状態'},
  {k:'name',label:'結合名'},
  {k:'left',label:'足す先（この一覧に）'},
  {k:'right',label:'相手（ここから持ってくる）'},
  {k:'keys',label:'突合キー'},
  {k:'kind',label:'結合の仕方'},
  {k:'cols',label:'足す列'},
  {k:'act',label:''},
 ];
 function qjSourceLabel(key){
  const x=(qjState.sources||[]).find(s=>s.key===key);
  return x?(x.label||x.key):(key||'—');
 }
 async function loadQueryJoinMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&qjState.loaded){renderQueryJoinForm();renderQueryJoinList();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const r=await api('/api/query-join-master');
   qjState.items=r.items||[];qjState.sources=r.sources||[];qjState.builtin=r.builtin||null;
   qjState.kinds=r.kinds||[];qjState.kindDefault=r.kindDefault||'left';
   qjState.builtinEnabled=r.builtinEnabled!==false;
   qjState.loaded=true;
   renderQueryJoinForm();renderQueryJoinList();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 function renderQueryJoinForm(){
  const form=$('#masterMaintForm');if(!form)return;
  const on=qjState.items.filter(x=>x.active).length;
  const off=qjState.items.length-on;
  const few=(qjState.sources||[]).length<2;
  form.className='mm-form';
  form.innerHTML=`
   <div class="ds-summary">
    <div class="ds-summary-facts">
     <span class="ds-sum"><b>${on}</b> 件が有効</span>
     ${off?`<span class="ds-sum">停止中 <b>${off}</b></span>`:''}
     <span class="ds-sum">つなげるデータ <b>${(qjState.sources||[]).length}</b> 件</span>
    </div>
    <div class="ds-summary-act">
     <button type="button" class="mm-btn-ghost" id="qjSourceBtn" title="データ接続の登録へ移ります">データ接続…</button>
     <button type="button" class="mm-btn-primary" id="qjAddBtn"${few?' disabled':''}>＋ 結合を追加</button>
    </div>
   </div>
   <p class="mm-def-hint">${few
     ?'<b>つなげるデータが足りません。</b>結合には登録済みのデータ接続が2件以上要ります。'
     :'一覧を開いたときに、<b>相手のデータから列を足して</b>表示します。足した列は並べ替え・絞り込みの対象にはなりませんが、'
      +'列の設定（幅・表示名・書式・読み替え）はふつうの列と同じように効き、<b>スケジュール表の内容欄でも選べます</b>。'}</p>`;
  form.onsubmit=ev=>ev.preventDefault();
  const add=$('#qjAddBtn');if(add)add.onclick=()=>openQueryJoinEditor(null);
  const src=$('#qjSourceBtn');
  if(src)src.onclick=()=>document.querySelector('#masterMaintNav [data-master="dataSource"]')?.click();
 }
 function renderQueryJoinList(){
  const list=$('#masterMaintList');if(!list)return;
  const head=QJ_LIST_COLS.map(c=>`<span class="ds-h qj-c-${c.k}">${esc(c.label)}</span>`).join('');
  const rows=qjState.items.map(qjRowHtml).join('');
  /* 既定の品質データ結合は**保存されていない**が、効いているものは画面に
     出す(§9.129「出どころを画面に出す」)。出さないと「登録していないのに
     列が増える」ことになり、どこの設定か探すはめになる。 */
  /* 既定の品質データ結合は**解除できる**(§9.194、利用者の指示)。解除しても
     内容は見えたままにする——「どうつないでいるのか」を見て真似できることが
     値打ちなので、解除＝見えなくする、にはしない。 */
  const bOn=qjState.builtinEnabled!==false;
  const bKind=qjKind((qjState.builtin||{}).kind||qjState.kindDefault);
  const b=qjState.builtin?`<div class="ds-row qj-row is-builtin${bOn?'':' is-off'}">
    <span class="qj-c-state"><span class="ds-listed${bOn?'':' is-off'}">${bOn?'既定':'解除中'}</span></span>
    <span class="qj-c-name"><b class="ds-name">${esc(qjState.builtin.name)}</b></span>
    <span class="qj-c-left">${esc(qjSourceLabel(qjState.builtin.left))}</span>
    <span class="qj-c-right">${esc(qjSourceLabel(qjState.builtin.right))}</span>
    <span class="qj-c-keys">${esc((qjState.builtin.keys||[]).map(k=>k.left).join('・'))}</span>
    <span class="qj-c-kind">${esc(bKind?bKind.label:'左外部結合')}</span>
    <span class="qj-c-cols">相手の全列</span>
    <span class="qj-c-act">
     <button type="button" class="mm-btn-ghost sm" id="qjBuiltinCopy">複製して編集</button>
     <button type="button" class="mm-btn-ghost sm" id="qjBuiltinToggle">${bOn?'解除する':'既定に戻す'}</button>
    </span>
    <span class="ds-c-note">${bOn
      ?'役割「仕掛」と「品質」が揃っているので自動で効いています。同じ相手への結合を登録すると、そちらが優先されます。「複製して編集」で、この設定を下敷きにした結合を作れます。'
      :'解除中です。品質データの列は一覧に出ません（<b>エラーにはなりません</b>——足していた列が無くなるだけで、その列を見ていた設定は静かに落ちます）。品質データは相手として選べるので、自分で結合を登録すれば出せます。'}</span>
   </div>`:'';
  if(!rows&&!b){
   list.innerHTML='<div class="mm-empty">結合はまだ登録されていません。「＋ 結合を追加」から登録してください。</div>';
   return;
  }
  list.innerHTML=`<div class="ds-rows">
    <div class="ds-row qj-row ds-row-head">${head}</div>${b}${rows}</div>`;
  list.querySelectorAll('[data-qj-edit]').forEach(btn=>btn.onclick=()=>{
   const x=qjState.items.find(i=>String(i.id)===btn.dataset.qjEdit);if(x)openQueryJoinEditor(x);
  });
  list.querySelectorAll('[data-qj-del]').forEach(btn=>btn.onclick=()=>qjDelete(btn.dataset.qjDel));
  const tg=$('#qjBuiltinToggle');if(tg)tg.onclick=()=>qjToggleBuiltin(!bOn);
  const cp=$('#qjBuiltinCopy');if(cp)cp.onclick=()=>openQueryJoinEditor(qjBuiltinDraft(),{copy:true});
 }
 /* 既定の結合を下敷きにした「新規の1件」。**IDを持たせない**——上書きでは
    なく複製なので、保存すると普通の登録として1行増える。 */
 function qjBuiltinDraft(){
  const b=qjState.builtin||{};
  return {id:null,name:`${b.name||'品質データ'}（複製）`,
          left:b.left||'',leftTable:b.leftTable||'',right:b.right||'',rightTable:b.rightTable||'',
          keys:(b.keys||[]).map(k=>({left:k.left,right:k.right})),
          columns:[],prefix:'',multi:b.multi||'first',kind:b.kind||qjState.kindDefault,
          order:(qjState.items.length+1)*10,active:true};
 }
 async function qjToggleBuiltin(on){
  const uid=requireMaintUser();if(uid===null)return;
  if(!on&&!confirm('既定の品質データ結合を解除します。\n品質データの列（鋳造番号・製造材質・検査結果など）は一覧に出なくなります。\nエラーにはならず、その列を見ていた設定は静かに落ちます。よろしいですか？'))return;
  try{
   setMaintLoading(true,on?'既定に戻しています…':'解除しています…');
   const r=await api('/api/query-join-master/builtin',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:on,user_id:uid})});
   qjState.loaded=false;await loadQueryJoinMaint(true);
   window.invalidateTableCache&&window.invalidateTableCache();
   showToast&&showToast(on?'既定に戻しました':'既定を解除しました',(r&&r.message)||'一覧を開き直すと反映されます',4500);
  }catch(e){showToast&&showToast('切り替えられませんでした',e.message,6000)}
  finally{setMaintLoading(false)}
 }
 function qjRowHtml(x){
  const keys=(x.keys||[]).map(k=>k.left===k.right?k.left:`${k.left}＝${k.right}`).join('・');
  const kind=qjKind(x.kind||qjState.kindDefault);
  const cols=(x.columns||[]).length?`${x.columns.length}列を選択`:'相手の全列';
  const missing=[];
  if(!(qjState.sources||[]).some(s=>s.key===x.left))missing.push('足す先');
  if(!(qjState.sources||[]).some(s=>s.key===x.right))missing.push('相手');
  return `<div class="ds-row qj-row${x.active?'':' is-off'}${missing.length?' is-pending':''}">
   <span class="qj-c-state"><span class="ds-listed${x.active?'':' is-off'}">${x.active?'有効':'停止中'}</span></span>
   <span class="qj-c-name"><b class="ds-name" title="${esc(x.name)}">${esc(x.name)}</b>
    ${x.prefix?`<code class="ds-key" title="足す列の名前に付ける文字">${esc(x.prefix)}…</code>`:''}</span>
   <span class="qj-c-left" title="${esc(x.left+(x.leftTable?' / '+x.leftTable:''))}">${
     esc(qjSourceLabel(x.left))}${x.leftTable?`<i class="qj-sub">${esc(x.leftTable)}</i>`:''}</span>
   <span class="qj-c-right" title="${esc(x.right+(x.rightTable?' / '+x.rightTable:''))}">${
     esc(qjSourceLabel(x.right))}${x.rightTable?`<i class="qj-sub">${esc(x.rightTable)}</i>`:''}</span>
   <span class="qj-c-keys" title="${esc(keys)}">${esc(keys||'—')}</span>
   <span class="qj-c-kind" title="${esc(kind?kind.summary:'')}">${esc(kind?kind.label:'左外部結合')}</span>
   <span class="qj-c-cols">${esc(cols)}</span>
   <span class="qj-c-act">
    <button type="button" class="mm-btn-ghost sm" data-qj-edit="${esc(String(x.id))}">編集</button>
    <button type="button" class="mm-btn-ghost sm" data-qj-del="${esc(String(x.id))}">削除</button>
   </span>
   ${missing.length?`<span class="ds-c-note">${esc(missing.join('と'))}のデータ接続が見つかりません（無効にした・キーを変えた・再起動していない、のいずれかです）。この結合は当たりません。</span>`:''}
  </div>`;
 }
 async function qjDelete(id){
  const x=qjState.items.find(i=>String(i.id)===String(id));if(!x)return;
  if(!confirm(`結合「${x.name}」を削除します。\nこの結合で足していた列は一覧から消えます。よろしいですか？`))return;
  const uid=requireMaintUser();if(uid===null)return;
  try{
   setMaintLoading(true,'削除しています…');
   await api('/api/query-join-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:x.id,user_id:uid})});
   qjState.loaded=false;await loadQueryJoinMaint(true);
   window.invalidateTableCache&&window.invalidateTableCache();
   showToast&&showToast('削除しました','一覧を開き直すと反映されます',4000);
  }catch(e){showToast&&showToast('削除に失敗しました',e.message,5000)}
  finally{setMaintLoading(false)}
 }
 /* 列の名前は**名前だけを引く**(/api/table-columns)。`/api/table`を叩くと
    実データ200列ぶんの行まで運ぶことになる(§9.94)。1度引いたら覚える。 */
 async function qjColumns(db,table){
  const key=db+'\t'+(table||'');
  if(qjState.cols[key])return qjState.cols[key];
  if(!db)return {tables:[],columns:[]};
  try{
   const q=new URLSearchParams({db:db,samples:'1'});if(table)q.set('table',table);
   const r=await api('/api/table-columns?'+q.toString());
   const v={tables:r.tables||[],columns:r.columns||[],table:r.table||'',
            normalized:r.normalized||{},samples:r.samples||{}};
   qjState.cols[key]=v;
   if(!table&&v.table)qjState.cols[db+'\t'+v.table]=v;
   return v;
  }catch(e){
   const v={tables:[],columns:[],normalized:{},samples:{},error:e.message};
   qjState.cols[key]=v;return v;
  }
 }
 function openQueryJoinEditor(item,opts){
  const modal=ensureMaintEditor();
  /* **中身が縦に長いのでスクロールさせる**(§9.197)。データ接続の編集窓は
     「スクロールさせない代わりに大きく取る」(§9.168)ため
     `.is-wide .mm-editor-body{overflow:hidden}`にしてあり、そのままだと
     ここは**下の節（結果の下見）が丸ごと切れて見えなかった**（実機で
     「モーダル内で表示が一部切れている」と指摘）。 */
  const dlg=modal.querySelector('.mm-editor-dialog');
  if(dlg){dlg.classList.add('is-wide');dlg.classList.add('is-tall')}
  const sources=qjState.sources||[];
  const copy=!!(opts&&opts.copy);
  qjState.editing=item?JSON.parse(JSON.stringify(item)):{
   id:null,name:'',left:(sources.find(s=>s.purpose==='仕掛')||sources[0]||{}).key||'',
   leftTable:'',right:(sources.find(s=>s.purpose==='品質')||sources[1]||sources[0]||{}).key||'',
   rightTable:'',keys:[],columns:[],prefix:'',multi:'first',
   kind:qjState.kindDefault||'left',
   order:(qjState.items.length+1)*10,active:true};
  if(!qjState.editing.kind)qjState.editing.kind=qjState.kindDefault||'left';
  qjState.probe=null;qjState.probeSig='';
  /* **開くたびに選びかけ・絞り込みを白紙へ**——前に開いた結合の状態が
     残っていると、押していないのに列が選ばれているように見える。 */
  qjState.pick=null;qjState.search={left:'',right:''};
  $('#maintEditorEyebrow').textContent='クエリ結合';
  $('#maintEditorTitle').textContent=copy?'既定の結合を下敷きに作る'
    :(item&&item.id?`${item.name} を編集`:'結合を追加');
  $('#maintEditorHint').textContent='足した列は一覧を開き直すと反映されます（サーバー再起動は要りません）。';
  $('#maintEditorSave').textContent=(item&&item.id)?'更新を保存':'追加登録';
  $('#maintEditorSave').onclick=()=>saveQueryJoinEditor();
  renderQueryJoinEditor();
  modal.hidden=false;
  qjRefreshColumns();
 }
 function qjEdit(){return qjState.editing||{}}
 function renderQueryJoinEditor(){
  const form=$('#maintEditorForm');if(!form)return;
  form.innerHTML=qjEditorHtml(qjEdit());
  form.onsubmit=ev=>{ev.preventDefault();saveQueryJoinEditor()};
  qjBindEditor(form);
 }
 function qjOptions(list,sel,blank){
  const head=blank?`<option value=""${sel?'':' selected'}>${esc(blank)}</option>`:'';
  return head+list.map(v=>{
   const value=typeof v==='string'?v:v.value;
   const label=typeof v==='string'?v:v.label;
   return `<option value="${esc(value)}"${value===sel?' selected':''}>${esc(label)}</option>`;
  }).join('');
 }
 function qjSourceOptions(sel){
  return qjOptions((qjState.sources||[]).map(s=>({
   value:s.key,
   label:(s.label||s.key)+(s.purpose?`（${s.purpose}）`:'')+(s.listed?'':'・一覧に出さない')})),sel,'選んでください');
 }
 /* ---------- 突合キーは「両側の列を並べて結ぶ」(§9.197、利用者の指示) ----------
    以前は`<select>`を左右に並べた行で、①どんな列があるのか探せない
    ②いま何と何が結ばれているのかが読み取りにくい ③選ぶ相手のデータ・表が
    ただのプルダウンで「どのファイルのどの表を見ているのか」が画面に出て
    いない、という状態だった（実機で「対象ファイルを選ぶところの視覚表示が
    少なくわかりづらい」と指摘）。
    **EXCELのパワークエリのマージと同じ作法**にする——左右に表を1枚ずつ置き、
    列を1つずつ押す（またはドラッグして重ねる）と、その2列が結ばれる。
    結ばれた列には両側に同じ「鍵N」の印が付き、下に組の一覧が出る。 */
 function qjSampleText(c,col){
  const v=((c.samples||{})[col]||[]).slice(0,3);
  return v.join(' / ');
 }
 function qjSide(x,side){
  const db=side==='left'?x.left:x.right;
  const table=side==='left'?x.leftTable:x.rightTable;
  const key=db+'\t'+(table||'');
  return {db,table,c:qjState.cols[key]||{},loaded:!!qjState.cols[key]};
 }
 /* この列が何番目の鍵か（0=鍵ではない）。**両側に同じ番号を出す**ので、
    どの列とどの列が組んでいるのかが列の一覧だけで読める。 */
 function qjKeyIndexOf(x,side,col){
  const arr=x.keys||[];
  for(let i=0;i<arr.length;i++)if((side==='left'?arr[i].left:arr[i].right)===col)return i+1;
  return 0;
 }
 /* 同じ名前の列を候補として出す。**名前のゆれを吸収する規則は画面に
    書かない**——サーバーが返した正規化済みの名前(normalized)どうしを
    比べるだけにする(§9.163)。 */
 function qjSuggestPairs(x,lc,rc){
  const ln=lc.normalized||{},rn=rc.normalized||{};
  if(!Object.keys(ln).length||!Object.keys(rn).length)return [];
  const byNorm={};Object.keys(rn).forEach(c=>{if(!(rn[c] in byNorm))byNorm[rn[c]]=c});
  const used=new Set((x.keys||[]).map(k=>k.left+'\t'+k.right));
  const out=[];
  Object.keys(ln).forEach(c=>{
   const hit=byNorm[ln[c]];
   if(!hit)return;
   if(used.has(c+'\t'+hit))return;
   out.push({left:c,right:hit});
  });
  return out;
 }
 /* 列の一覧。**実データの例を必ず添える**——キーが合うかどうかは形を見れば
    分かる（L0001 と A-1 は突き合わない）ので、選ぶ前に出す。 */
 function qjFieldsHtml(side){
  const x=qjEdit(),s=qjSide(x,side);
  const cols=s.c.columns||[];
  /* **「読めていない」と「選んでいない」を分ける**——同じ空欄にすると、
     待てばよいのか操作が要るのかが分からない。 */
  if(!cols.length)return `<p class="qj-fields-empty">${
    s.c.error?esc(s.c.error)
    :(!s.db?'データを選ぶと、列がここに並びます。'
     :(s.loaded?'この表には列がありません。':'列を読み込んでいます…'))}</p>`;
  const q=String((qjState.search||{})[side]||'').trim().toLowerCase();
  const hit=cols.filter(c=>!q||String(c).toLowerCase().includes(q));
  if(!hit.length)return `<p class="qj-fields-empty">「${esc(q)}」に当てはまる列がありません。</p>`;
  const pick=qjState.pick;
  const other=side==='left'?'相手':'この一覧';
  return hit.map(c=>{
   const n=qjKeyIndexOf(x,side,c);
   const on=!!(pick&&pick.side===side&&pick.col===c);
   const eg=qjSampleText(s.c,c);
   return `<button type="button" class="qj-field${n?' is-key':''}${on?' is-pick':''}" draggable="true"`
    +` data-qj-fld="${side}" data-col="${esc(c)}"`
    +` title="${esc(c)}${eg?'\n例: '+eg:''}\n押してから${esc(other)}の列を押すと結び付きます（ドラッグして重ねても同じです）">`
    +`<span class="qj-fld-name">${esc(c)}</span>`
    +(eg?`<span class="qj-fld-eg">${esc(eg)}</span>`
        :'<span class="qj-fld-eg is-empty">先頭20行が空</span>')
    +(n?`<i class="qj-fld-key">鍵${n}</i>`:'')
    +`</button>`;
  }).join('');
 }
 /* **次にすることを1つだけ指す**(§2)。選んでいる列があるときは「次に反対側を
    押す」、無いときは「1つずつ押す」。 */
 function qjStatusHtml(){
  const x=qjEdit(),p=qjState.pick;
  const n=(x.keys||[]).length;
  if(p){
   const here=p.side==='left'?'この一覧':'相手';
   const other=p.side==='left'?'相手':'この一覧';
   return `<span class="qj-status-now">${esc(here)}の<b>${esc(p.col)}</b>を選んでいます。`
    +`次に${esc(other)}の列を押すと結び付きます</span>`
    +`<button type="button" class="qj-status-cancel" id="qjPickCancel">選ぶのをやめる</button>`;
  }
  return n
   ?`<span class="qj-status-now">突合キーは<b>${n}</b>組。列をもう1組押せば足せます</span>`
   :'<span class="qj-status-now"><b>突合キーがまだありません。</b>'
    +'左右の列を1つずつ押すか、片方をもう片方へドラッグしてください</span>';
 }
 /* 結ばれた組。**外す手立てを組の隣に置く**——一覧の下に別の「外す」を
    並べると、どの組を外すのか数え直すことになる。 */
 function qjPairsHtml(x){
  const keys=x.keys||[];
  if(!keys.length)return '';
  const L=qjSide(x,'left').c,R=qjSide(x,'right').c;
  const gone=(col,side)=>{const cs=(side==='left'?L:R).columns;return !!(cs&&cs.length&&!cs.includes(col))};
  return keys.map((k,i)=>{
   const bad=gone(k.left,'left')||gone(k.right,'right');
   return `<span class="qj-pair${bad?' is-missing':''}" data-qj-pair="${i}">`
    +`<i class="qj-pair-no">鍵${i+1}</i>`
    +`<b>${esc(k.left)}</b><i class="qj-pair-eq">＝</i><b>${esc(k.right)}</b>`
    +(bad?'<i class="qj-pair-warn">いま選んでいる表にこの列がありません</i>':'')
    +`<button type="button" class="qj-pair-del" data-qj-keydel="${i}" title="この組を外す">×</button>`
    +`</span>`;
  }).join('');
 }
 /* 片側の表。**どのデータのどの表を見ているのかを画面に出す**——列数と表名を
    添えると、選び間違いがその場で分かる(以前はプルダウンだけだった)。 */
 function qjPaneHtml(side){
  const x=qjEdit(),s=qjSide(x,side);
  const isL=side==='left';
  const cnt=(s.c.columns||[]).length;
  const meta=cnt
   ?`表: <b>${esc(s.c.table||s.table||'—')}</b> ／ <b>${cnt}</b>列`
   :(s.c.error?`<span class="is-warn">${esc(s.c.error)}</span>`:'列を読み込んでいます…');
  return `<div class="qj-pane" data-qj-pane="${side}">
   <div class="qj-pane-head">
    <span class="qj-pane-tag${isL?'':' is-right'}">${isL?'この一覧（足す先）':'相手（持ってくる側）'}</span>
    <select data-qj-field="${isL?'left':'right'}" data-qj-re aria-label="${isL?'足す先のデータ':'相手のデータ'}">${
      qjSourceOptions(isL?x.left:x.right)}</select>
    <select data-qj-field="${isL?'leftTable':'rightTable'}" data-qj-re aria-label="表">${
      qjOptions(s.c.tables||[],(isL?x.leftTable:x.rightTable)||'',isL?'どの表でも':'既定の表')}</select>
    <span class="qj-pane-meta">${meta}</span>
   </div>
   <input type="search" class="qj-search" data-qj-search="${side}" placeholder="列名で絞り込み"
     value="${esc((qjState.search||{})[side]||'')}" autocomplete="off" spellcheck="false">
   <div class="qj-fields" data-qj-list="${side}">${qjFieldsHtml(side)}</div>
  </div>`;
 }
 function qjEditorHtml(x){
  const lc=qjSide(x,'left').c,rc=qjSide(x,'right').c;
  const kind=qjKind(x.kind)||{};
  const sugg=qjSuggestPairs(x,lc,rc);
  const suggHtml=sugg.length?`<div class="qj-sugg">
    <span class="qj-sugg-label">同じ名前の列:</span>
    ${sugg.slice(0,6).map(pp=>`<button type="button" class="qj-sugg-btn" data-qj-sugg="${esc(pp.left)}\t${esc(pp.right)}">${esc(pp.left)}${pp.left===pp.right?'':' ＝ '+esc(pp.right)}</button>`).join('')}
    ${sugg.length>1?`<button type="button" class="mm-btn-ghost sm" id="qjKeyAuto">${sugg.length}組すべて足す</button>`:''}
   </div>`:'';
  const kindCards=(qjState.kinds||[]).map(k=>`<label class="qj-kind${k.key===kind.key?' is-on':''}">
    <input type="radio" name="qjKind" value="${esc(k.key)}" data-qj-re${k.key===kind.key?' checked':''}>
    ${qjVennHtml(k,'card')}
    <b>${esc(k.label)}</b>
    <span class="qj-kind-short">${esc(k.short)}</span>
    <span class="qj-kind-rows">${esc(qjRowEffect(k))}</span>
   </label>`).join('');
  const pickAll=!(x.columns||[]).length;
  const colList=(rc.columns||[]).filter(c=>!(x.keys||[]).some(k=>k.right===c));
  return `<div class="qj-edit">
   <section class="qj-sec qj-sec-name">
    <h4 class="mm-fieldgroup">① これは何か</h4>
    <div class="qj-name-row">
     <label class="mm-field qj-f-name"><span>結合名</span>
      <input data-qj-field="name" type="text" value="${esc(x.name||'')}" required autocomplete="off" spellcheck="false">
      <small class="mm-field-hint">一覧の帯と、列の設定パネルの「結合」欄に出ます。</small></label>
     <label class="mm-field qj-f-order"><span>表示順</span>
      <input data-qj-field="order" type="number" min="0" max="9999" value="${esc(String(x.order==null?0:x.order))}">
      <small class="mm-field-hint">小さいほど先に当たります。</small></label>
     <label class="mm-field qj-f-enabled"><span>使う / 使わない</span>
      <select data-qj-field="enabled" data-qj-re>${qjOptions(['有効','無効'],x.active===false?'無効':'有効')}</select>
      <small class="mm-field-hint">「無効」にすると列を足しません（設定は残ります）。</small></label>
    </div>
   </section>
   <section class="qj-sec qj-sec-merge">
    <h4 class="mm-fieldgroup">② つなぐ2つのデータと突合キー</h4>
    <div class="qj-merge">
     ${qjPaneHtml('left')}
     <div class="qj-merge-mid" aria-hidden="true"><span class="qj-merge-eq">＝</span></div>
     ${qjPaneHtml('right')}
    </div>
    <p class="qj-merge-status">${qjStatusHtml()}</p>
    <div class="qj-pairs">${qjPairsHtml(x)}</div>
    ${suggHtml}
    <p class="mm-field-hint">すべてのキーが一致した行だけを結び付けます。全角/半角と前後の空白は無視します。
     選べるのは<b>データ接続に登録してあるデータ</b>だけです（一覧に出していないデータも選べます）。</p>
   </section>
   <section class="qj-sec qj-sec-kind">
    <h4 class="mm-fieldgroup">③ 結合の仕方 — <span class="qj-kind-now">${esc(kind.label||'')}</span></h4>
    ${kindCards?`<div class="qj-kinds">${kindCards}</div>
    <div class="qj-kind-detail">
     <p class="qj-kind-summary">${esc(kind.summary||'')}</p>
     <p class="mm-field-hint">${esc(kind.when||'')}</p>
     ${qjSampleHtml(kind)}
     ${kind.rightOnly?'<p class="mm-field-hint is-warn">「相手にしかない行」を出すため、<b>相手の表を全部読みます</b>。また、一致しているかどうかはこの一覧の全行と突き合わせます（表示中のページだけでは決めません）。</p>':''}
    </div>`:'<p class="mm-field-hint">結合の仕方の一覧を読めませんでした。左外部結合（この一覧は全部残す）として扱います。</p>'}
   </section>
   <section class="qj-sec qj-sec-add">
    <h4 class="mm-fieldgroup">④ 何を足すか</h4>
    ${(kind.key&&!kind.matched&&!kind.rightOnly)?`<p class="mm-field-hint">
      <b>この結合は列を足しません。</b>「${esc(kind.label)}」は相手に当たらなかった行だけを残す使い方なので、
      相手の値がありません（足しても全部空欄になります）。列を足したいときは、③で
      「${esc((qjKind('left')||{}).label||'左外部結合')}」などを選んでください。</p>`:`
    <div class="qj-pick">
     <label class="qj-radio"><input type="radio" name="qjPick" value="all" data-qj-re${pickAll?' checked':''}>
      <span>相手の列をすべて</span></label>
     <label class="qj-radio"><input type="radio" name="qjPick" value="some" data-qj-re${pickAll?'':' checked'}>
      <span>選んだ列だけ<i>（${(x.columns||[]).length}列を選択中）</i></span></label>
    </div>
    ${pickAll?'':`<div class="qj-cols">${colList.length?colList.map(c=>
      `<label class="qj-col"><input type="checkbox" data-qj-col="${esc(c)}"${(x.columns||[]).includes(c)?' checked':''}><span>${esc(c)}</span></label>`
     ).join(''):'<p class="mm-field-hint">相手の列がまだ分かりません。②でデータと表を選んでください。</p>'}</div>`}
    <div class="qj-add-opts">
     <label class="mm-field"><span>足す列の名前に付ける文字</span>
      <input data-qj-field="prefix" type="text" value="${esc(x.prefix||'')}" maxlength="20" autocomplete="off" spellcheck="false" placeholder="例: 品質_">
      <small class="mm-field-hint">空のままだと、一覧に同じ名前の列があるものは<b>足しません</b>（元の一覧の値を残します）。付けると両方を並べられます。</small></label>
     <label class="mm-field"><span>相手が2件以上あったら</span>
      <select data-qj-field="multi" data-qj-re>${qjOptions(
        Object.keys(QJ_MULTI_LABEL).map(v=>({value:v,label:QJ_MULTI_LABEL[v]})),x.multi||'first')}</select>
      <small class="mm-field-hint">当たった件数は下の「結果」に出ます。</small></label>
    </div>`}
   </section>
   <section class="qj-sec qj-sec-result">
    <h4 class="mm-fieldgroup">⑤ 結果（保存する前の下見） <span class="ds-probe-state" id="qjProbeState"></span></h4>
    <div id="qjProbeBox" class="ds-probe"></div>
   </section>
  </div>`;
 }
 function qjBindEditor(form){
  form.querySelectorAll('[data-qj-field]').forEach(el=>{
   const k=el.dataset.qjField;
   const commit=()=>{
    const x=qjEdit();
    if(k==='enabled')x.active=el.value!=='無効';
    else if(k==='order')x.order=parseInt(el.value||'0',10)||0;
    else x[k]=el.value;
    if(k==='left')x.leftTable='';
    if(k==='right'){x.rightTable='';x.columns=[]}
    /* **データを取り替えたら組は外す**(§9.197)。以前は片側だけを空にして
       組の行を残していたが、列の一覧そのものが入れ替わるので、残しても
       当たらない組が並ぶだけだった。選び直しは列を押すだけで済む。
       表(leftTable/rightTable)を変えただけのときは残す——同じ列名が
       あることが多く、無ければ組の側に「この表にありません」と出る。 */
    if(k==='left'||k==='right'){x.keys=[];qjState.pick=null}
    /* 表を変えると列の一覧が入れ替わる。**選びかけは捨てる**——残すと
       いま一覧に無い列を「選んでいます」と言い続ける。 */
    if(k==='leftTable'||k==='rightTable')qjState.pick=null;
   };
   /* **値の入力中に組み直さないこと**(§9.117)。文字を打つたびに入力欄が
      作り替わるとカーソルが飛ぶ。組み直すのは選択肢(data-qj-re)だけ。 */
   if(el.matches('[data-qj-re]'))el.onchange=()=>{commit();renderQueryJoinEditor();qjRefreshColumns()};
   else{el.oninput=()=>{commit();qjProbeSoon()};el.onchange=()=>commit()}
  });
  form.querySelectorAll('[name="qjKind"]').forEach(el=>el.onchange=()=>{
   if(!el.checked)return;
   qjEdit().kind=el.value;
   renderQueryJoinEditor();qjProbeSoon(0);
  });
  form.querySelectorAll('[data-qj-sugg]').forEach(el=>el.onclick=()=>{
   const [l,r]=String(el.dataset.qjSugg||'').split('\t');
   qjAddKey(l,r);
  });
  const auto=form.querySelector('#qjKeyAuto');
  if(auto)auto.onclick=()=>{
   const x=qjEdit();
   const lc=qjState.cols[x.left+'\t'+(x.leftTable||'')]||{};
   const rc=qjState.cols[x.right+'\t'+(x.rightTable||'')]||{};
   qjSuggestPairs(x,lc,rc).forEach(pp=>qjAddKey(pp.left,pp.right,true));
   renderQueryJoinEditor();qjProbeSoon(0);
  };
  /* 組を外す。**空の組は作らない**——押すたびに空行が増えると、そのぶん
     「外す」を押させることになる(§9.197で行そのものを廃止した)。 */
  form.querySelectorAll('[data-qj-keydel]').forEach(el=>el.onclick=()=>{
   const x=qjEdit();x.keys.splice(+el.dataset.qjKeydel,1);
   qjState.pick=null;
   renderQueryJoinEditor();qjProbeSoon(0);
  });
  /* 列名の絞り込み。**一覧だけを描き直す**(§9.117)——入力欄を作り替えると
     1文字ごとにカーソルが飛ぶ。 */
  form.querySelectorAll('[data-qj-search]').forEach(el=>{
   el.oninput=()=>{
    qjState.search=qjState.search||{};
    qjState.search[el.dataset.qjSearch]=el.value;
    qjRenderFieldList(el.dataset.qjSearch);
   };
   /* **Enterで保存させないこと。** この欄はフォームの中にあるので、
      既定では Enter が送信＝「追加登録」になる（絞り込むつもりで打った
      Enter で登録されてしまう）。 */
   el.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();ev.stopPropagation()}};
  });
  qjBindFields(form);
  const cancel=form.querySelector('#qjPickCancel');
  if(cancel)cancel.onclick=()=>{qjState.pick=null;qjRefreshMerge()};
  form.querySelectorAll('[name="qjPick"]').forEach(el=>el.onchange=()=>{
   const x=qjEdit();
   if(el.value==='all'&&el.checked)x.columns=[];
   else if(el.checked&&!x.columns.length){
    const rc=qjState.cols[x.right+'\t'+(x.rightTable||'')]||{};
    x.columns=(rc.columns||[]).filter(c=>!(x.keys||[]).some(k=>k.right===c)).slice(0,20);
   }
   renderQueryJoinEditor();qjProbeSoon(0);
  });
  form.querySelectorAll('[data-qj-col]').forEach(el=>el.onclick=()=>{
   /* チェックは`click`で受ける(§9.90)。`change`は`click`の後に飛ぶため、
      行のクリックで組み直す作りだと反映されない。 */
   const x=qjEdit(),c=el.dataset.qjCol;
   if(el.checked){if(!x.columns.includes(c))x.columns.push(c)}
   else x.columns=x.columns.filter(v=>v!==c);
   qjProbeSoon();
  });
  qjRenderProbe();
 }
 /* 1組足す。**同じ組は増やさない**——同じキーを2回押しても増えないので、
    押し間違いを外す手間が要らない。 */
 function qjAddKey(left,right,quiet){
  if(!left||!right)return;
  const x=qjEdit();
  x.keys=(x.keys||[]).filter(k=>k.left&&k.right);
  if(!x.keys.some(k=>k.left===left&&k.right===right))x.keys.push({left:left,right:right});
  if(!quiet){renderQueryJoinEditor();qjProbeSoon(0)}
 }
 /* ---------- 列を押す／ドラッグして結ぶ(§9.197) ----------
    **どちらの操作でも同じことが起きる**（片方だけ効くと、効かない側を
    「壊れている」と読まれる）。押した1つ目は`qjState.pick`に覚え、
    反対側を押した時点で組にする。同じ側をもう一度押したら選び直し。 */
 function qjBindFields(root){
  (root||document).querySelectorAll('[data-qj-fld]').forEach(el=>{
   const side=el.dataset.qjFld,col=el.dataset.col;
   el.onclick=ev=>{ev.preventDefault();qjPickField(side,col)};
   el.ondragstart=ev=>{
    qjState.pick={side,col};
    try{ev.dataTransfer.setData('text/plain',side+'\t'+col);ev.dataTransfer.effectAllowed='link'}catch(_){}
    el.classList.add('is-pick');
   };
   el.ondragend=()=>{el.classList.remove('is-pick');
    (root||document).querySelectorAll('.qj-field.is-drop').forEach(x=>x.classList.remove('is-drop'))};
   el.ondragover=ev=>{
    const p=qjState.pick;
    if(!p||p.side===side)return;        // 同じ側へ落としても組にならない
    ev.preventDefault();el.classList.add('is-drop');
   };
   el.ondragleave=()=>el.classList.remove('is-drop');
   el.ondrop=ev=>{
    ev.preventDefault();el.classList.remove('is-drop');
    let from=null;
    try{const t=String(ev.dataTransfer.getData('text/plain')||'').split('\t');
        if(t.length===2)from={side:t[0],col:t[1]}}catch(_){}
    if(!from)from=qjState.pick;
    if(!from||from.side===side)return;
    qjState.pick=null;
    qjAddKey(side==='left'?col:from.col,side==='left'?from.col:col);
   };
  });
 }
 function qjPickField(side,col){
  const p=qjState.pick;
  if(p&&p.side!==side){
   qjState.pick=null;
   qjAddKey(side==='left'?col:p.col,side==='left'?p.col:col);
   return;
  }
  qjState.pick=(p&&p.side===side&&p.col===col)?null:{side,col};
  qjRefreshMerge();
 }
 /* 列の一覧だけを差し替える（絞り込みの入力中に呼ぶので、**入力欄には
    触らない**）。 */
 function qjRenderFieldList(side){
  const box=document.querySelector(`[data-qj-list="${side}"]`);
  if(!box)return;
  box.innerHTML=qjFieldsHtml(side);
  qjBindFields(box);
 }
 /* 押した結果をその場に出す。**全部を組み直さない**——組み直すと絞り込みの
    文字とスクロールが巻き戻る。 */
 function qjRefreshMerge(){
  qjRenderFieldList('left');qjRenderFieldList('right');
  const st=document.querySelector('.qj-merge-status');
  if(st){
   st.innerHTML=qjStatusHtml();
   const c=st.querySelector('#qjPickCancel');
   if(c)c.onclick=()=>{qjState.pick=null;qjRefreshMerge()};
  }
 }
 async function qjRefreshColumns(){
  const x=qjEdit();
  const before=JSON.stringify([x.left,x.leftTable,x.right,x.rightTable]);
  await Promise.all([qjColumns(x.left,x.leftTable),qjColumns(x.right,x.rightTable)]);
  // 途中で選び直されていたら、そのときの結果で描き直す側に任せる。
  if(JSON.stringify([x.left,x.leftTable,x.right,x.rightTable])!==before)return;
  renderQueryJoinEditor();
  qjProbeSoon(0);
 }
 let qjProbeTimer=null;
 function qjProbeSoon(delay){
  clearTimeout(qjProbeTimer);
  qjProbeTimer=setTimeout(qjProbe,delay==null?450:delay);
 }
 async function qjProbe(){
  const x=qjEdit();
  const body={left:x.left,leftTable:x.leftTable,right:x.right,rightTable:x.rightTable,
              keys:(x.keys||[]).filter(k=>k.left&&k.right),columns:x.columns,
              prefix:x.prefix,multi:x.multi,kind:x.kind||qjState.kindDefault,
              name:x.name||'(下見)'};
  const sig=JSON.stringify(body);
  if(sig===qjState.probeSig)return;
  qjState.probeSig=sig;
  const seq=++qjState.probeSeq;
  qjState.probing=true;qjRenderProbe();
  try{
   const r=await api('/api/query-join-master/probe',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(seq!==qjState.probeSeq)return;
   qjState.probe=r.result||null;
  }catch(e){
   if(seq!==qjState.probeSeq)return;
   qjState.probe={ok:false,reason:e.message,sampled:0,matched:0,ambiguous:0,
                  addedColumns:0,addedColumnNames:[],table:'',examples:[]};
  }finally{
   if(seq===qjState.probeSeq){qjState.probing=false;qjRenderProbe()}
  }
 }
 function qjRenderProbe(){
  const box=$('#qjProbeBox'),state=$('#qjProbeState');if(!box)return;
  if(state)state.textContent=qjState.probing?'確かめています…':'';
  const p=qjState.probe;
  if(!p){box.innerHTML='<p class="mm-field-hint">突合キーを選ぶと、いまのデータで当ててみた結果がここに出ます。</p>';return}
  /* **色だけで伝えない**(§3)。当たった件数・足す列数・実例を文字で出す。 */
  const names=(p.addedColumnNames||[]);
  const cols=p.addedColumns?`<b>${p.addedColumns}</b> 列を足します`:'列は足しません';
  const head=p.ok
   ?`<p class="qj-probe-ok"><b>${p.matched}</b> / ${p.sampled} 行に当たりました。${cols}（相手の表: ${esc(p.table||'—')}）。</p>`
   :`<p class="qj-probe-ng">当たりませんでした。${esc(p.reason||'')}</p>`;
  /* **行が増減することは必ず文字で言う**(§9.194)。結合の仕方によっては
     一覧から行が消える／相手の行が増えるので、黙って変えると「絞り込んで
     いないのに件数が合わない」としか見えない。 */
  const rowLine=(p.ok&&(p.droppedRows||p.addedRows))
   ?`<p class="qj-probe-rows">行数: ${p.sampled} → <b>${p.rowsAfter}</b>`
     +(p.droppedRows?`／一致しない ${p.droppedRows} 行は出しません`:'')
     +(p.addedRows?`／相手にしかない ${p.addedRows} 行が増えます`:'')+'</p>'
   :'';
  const noteLine=p.note?`<p class="mm-field-hint">${esc(p.note)}</p>`:'';
  const amb=p.ambiguous?`<p class="mm-field-hint">相手が2件以上あったキーが ${p.ambiguous} 件あります（いまの設定: ${esc(QJ_MULTI_LABEL[qjEdit().multi||'first'])}）。</p>`:'';
  const colLine=names.length?`<p class="mm-field-hint">足す列: ${esc(names.slice(0,12).join('・'))}${names.length>12?` ほか${names.length-12}列`:''}</p>`:'';
  /* 実例は3件(§9.105)。1件では「たまたま」と区別が付かない。 */
  const ex=(p.examples||[]).length?`<table class="qj-ex"><thead><tr>${
    Object.keys(p.examples[0]).map(k=>`<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${
    p.examples.map(r=>`<tr>${Object.values(r).map(v=>`<td>${esc(String(v))}</td>`).join('')}</tr>`).join('')
   }</tbody></table>`:'';
  box.innerHTML=head+rowLine+noteLine+amb+colLine+ex;
 }
 async function saveQueryJoinEditor(){
  const x=qjEdit();
  const uid=requireMaintUser();if(uid===null)return;
  const body={id:x.id,user_id:uid,name:x.name,left:x.left,leftTable:x.leftTable,
              right:x.right,rightTable:x.rightTable,
              keys:(x.keys||[]).filter(k=>k.left&&k.right),columns:x.columns,
              prefix:x.prefix,multi:x.multi,kind:x.kind||qjState.kindDefault,order:x.order,
              enabled:x.active===false?'無効':'有効'};
  try{
   setMaintLoading(true,'保存しています…');
   const url=x.id?'/api/query-join-master/update':'/api/query-join-master';
   const r=await api(url,{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify(body)});
   closeMaintEditor();
   qjState.loaded=false;await loadQueryJoinMaint(true);
   /* **一覧の控えを捨てる。** 捨てないと、開き直しても結合前の写しが出て
      「保存したのに何も変わらない」に見える（一覧は問い合わせの結果を
      TTLで覚えている）。 */
   window.invalidateTableCache&&window.invalidateTableCache();
   showToast&&showToast('保存しました',r.message||'一覧を開き直すと反映されます',4000);
  }catch(e){showToast&&showToast('保存できません',e.message,6000)}
  finally{setMaintLoading(false)}
 }
 async function dsDelete(id){
  const x=dsState.items.find(i=>String(i.id)===String(id));if(!x)return;
  if(!confirm(`「${x.label||x.key}」を無効にします。\n一覧から消えるのはサーバー再起動後です。よろしいですか？`))return;
  const uid=requireMaintUser();if(uid===null)return;
  try{
   setMaintLoading(true,'無効にしています…');
   await api('/api/data-source-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:x.id,user_id:uid})});
   dsState.loaded=false;await loadDataSourceMaint(true);
   showToast&&showToast('無効にしました','一覧から消えるのはサーバー再起動後です',5000);
  }catch(e){showToast&&showToast('無効にできませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }

 /* ---- 編集ウィンドウ（スクロールさせない・大きく取る） --------------------
    視覚導線と作業導線を合わせる（①これは何か → ②どこから読むか →
    ③この設定でできること → ④いまの状態）。③は**保存する前に**実際に
    ファイルを開いて確かめた結果で、欄を触るたびに取り直す。 */
 function openDataSourceEditor(item){
  const modal=ensureMaintEditor();
  /* **スクロールさせない**（§9.168）。クエリ結合の窓を先に開いていると
     `is-tall`が残るので、ここで必ず外す。 */
  const dlg=modal.querySelector('.mm-editor-dialog');
  if(dlg){dlg.classList.add('is-wide');dlg.classList.remove('is-tall')}
  dsState.editing=item?Object.assign({},item):null;
  dsState.probe=item?(item.capability||null):null;
  dsState.probePath='';
  const x=dsState.editing||{};
  $('#maintEditorEyebrow').textContent='データ接続';
  $('#maintEditorTitle').textContent=item?`${x.label||x.key} を編集`:'データソースを追加';
  $('#maintEditorHint').textContent='読み込み先の変更はサーバー再起動後に反映されます。';
  $('#maintEditorSave').textContent=item?'更新を保存':'追加登録';
  const form=$('#maintEditorForm');
  form.innerHTML=dsEditorHtml(x,!item);
  form.onsubmit=ev=>{ev.preventDefault();saveDataSourceEditor()};
  /* 保存ボタンはウィンドウ共通（1つしか無い）ので、**開くたびに持ち主を
     決め直す**。汎用CRUDのsubmitMaintのままだと、この画面の入力を
     読まずに空で保存してしまう。 */
  $('#maintEditorSave').onclick=()=>saveDataSourceEditor();
  bindInputHelpers(form);
  form.querySelectorAll('[data-ds-mode]').forEach(r=>r.onchange=()=>{dsSyncMode();dsProbeSoon(0)});
  form.querySelectorAll('[data-field]').forEach(el=>{
   el.addEventListener('change',()=>dsProbeSoon());
   el.addEventListener('input',()=>dsProbeSoon());
  });
  dsSyncMode();dsRenderProbe();
  modal.hidden=false;
  requestAnimationFrame(()=>{const first=form.querySelector('[data-field="label"]');if(first)first.focus()});
  dsProbeSoon(0);
 }
 /* 役割の選択肢。**埋まっている役割にはその行の名前を添える**(§9.193)
    ——選んでから「既に付いています」と断られるのでは、開き直して確かめる
    手間が増えるだけ(§4「できないことは、できないと書く」)。自分が今
    持っている役割は素のまま出す(付け替えではないので断られない)。 */
 function dsPurposeOptions(x){
  const cur=x.purpose||'その他';
  const opt=(v,label,sel)=>`<option value="${esc(v)}"${v===sel?' selected':''}>${esc(label)}</option>`;
  const holders=dsState.purposeHolders||{};
  const list=['その他',...(dsState.purposes||[])];
  return list.map(v=>{
   if(v==='その他')return opt(v,'その他（一覧として見るだけ）',cur);
   const who=String(holders[v]||'');
   const taken=who&&who!==x.key;
   return opt(v,taken?`${v}（いまは ${who}）`:v,cur);
  }).join('');
 }
 function dsEditorHtml(x,isNew){
  const mode=x.readMode||(x.overridePath?'direct':(x.mode||'share'));
  // 役割「仕掛」は一覧から隠せない（隠すと測定・予定投入の入口が消える）。
  // **選ばせてから断らない**——選べない理由を欄のところに書く（§4）。
  const lockListed=(x.purpose||'')==='仕掛';
  const f=(k,label,val,attrs,hint)=>`<label class="mm-field"><span>${esc(label)}</span>
    <input data-field="${k}" type="text" value="${esc(val==null?'':String(val))}" ${attrs||''} autocomplete="off" spellcheck="false">
    ${hint?`<small class="mm-field-hint">${esc(hint)}</small>`:''}</label>`;
  const pf=(k,label,val,pmode,hint)=>`<div class="mm-field mm-field-path"><span>${esc(label)}</span>
    <span class="mm-path" data-path-drop="${k}">
     <input data-field="${k}" type="text" value="${esc(val==null?'':String(val))}" autocomplete="off" spellcheck="false">
     <button type="button" class="mm-path-browse" data-path-browse="${k}" data-path-mode="${pmode||'file'}">参照…</button>
    </span>${hint?`<small class="mm-field-hint">${esc(hint)}</small>`:''}</div>`;
  const opt=(v,label,sel)=>`<option value="${esc(v)}"${v===sel?' selected':''}>${esc(label)}</option>`;
  /* **RNEが無い端末では、無いと書く**（§9.168、利用者の指摘「RNEがない場合も
     あるのでそのあたりの切り替えもできるように」）。選ばせないのではなく、
     選んだ結果どうなるかを先に言う。 */
  const rneNote=dsState.assets.confExists?''
    :`この端末には接続情報 symnavim.conf がありません（${dsState.assets.assetsDir||''}）。置くまで抽出は動きません。`;
  const modeBlock=m=>{
   if(m.v==='share')return pf('share','共有パスの .sqlite3',x.share,'file',
     'ファイル名だけなら既定の共有フォルダ配下を探します。UNC（\\\\サーバー\\共有\\…）も入れられます。');
   if(m.v==='rne')return `${f('rne','RNE（抽出定義）ファイル',x.rne,'','ファイル名だけなら「RNE資材の置き場」の rne/ 配下です。')}
     ${f('table','抽出テーブル',x.table,'','RNEの中の表の名前。未入力なら「仕掛」です。')}
     ${pf('output','作った .sqlite3 の置き場',x.output,'file','ファイル名だけなら db/ 配下です。')}
     ${rneNote?`<p class="ds-warn">${esc(rneNote)}</p>`:''}`;
   return pf('overridePath','直接読むファイル',x.overridePath,'file',
     '検証や一時的な差し替えに使います。値がある間は上の設定より優先されます。');
  };
  return `<div class="ds-edit">
   <section class="ds-edit-zone">
    <h4 class="mm-fieldgroup">① これは何か</h4>
    ${f('label','表示名',x.label,'required','左メニュー「一覧を見る」に出る名前です。')}
    ${f('key','キー',x.key,'required','半角英数と _。一覧を指す識別子で、変えると この一覧向けの登録フィルタ・表示列の設定が結び付かなくなります。')}
    <label class="mm-field"><span>どのデータとして使うか（役割）</span>
     <select data-field="purpose">${dsPurposeOptions(x)}</select>
     <small class="mm-field-hint">「仕掛」＝測定・予定投入の対象／「品質」＝仕掛の一覧へ結合／「スケジュール」＝作業予定の本体。<b>この3つは各1件だけ</b>で、「その他」は一覧として見るだけです。別のデータをつなげたいときは マスタ管理 &gt; クエリ結合 で結合を登録します（役割は要りません）。</small></label>
    <div class="ds-edit-pair">
     <label class="mm-field"><span>表示順</span>
      <input data-field="order" type="number" min="0" max="9999" value="${esc(String(x.order==null?0:x.order))}">
      <small class="mm-field-hint">小さいほど上に出ます。</small></label>
     <label class="mm-field"><span>使う / 使わない</span>
      <select data-field="enabled">${['有効','無効'].map(v=>opt(v,v,x.enabled||'有効')).join('')}</select>
      <small class="mm-field-hint">「無効」にすると読み込みも抽出も止まります（結合の相手にもなりません）。</small></label>
    </div>
    <label class="mm-field"><span>左メニューの一覧に出す</span>
     <select data-field="listed"${lockListed?' disabled':''}>${
       ['出す','出さない'].map(v=>opt(v,v,(x.listed===false&&!lockListed)?'出さない':'出す')).join('')}</select>
     <small class="mm-field-hint">${lockListed
       ?'役割「仕掛」は測定・予定投入の入口なので、一覧から隠せません。'
       :'「出さない」にしても<b>データは読みます</b>。クエリ結合の相手としてだけ使いたいデータ（品質・単価表など）を、左メニューに並べずに済ませるための設定です。'}</small></label>
   </section>
   <section class="ds-edit-zone">
    <h4 class="mm-fieldgroup">② どこから読むか</h4>
    <div class="ds-modes">${DS_MODES.map(m=>`
     <div class="ds-mode" data-ds-mode-box="${m.v}">
      <label class="ds-mode-pick"><input type="radio" name="dsMode" value="${m.v}" data-ds-mode${m.v===mode?' checked':''}>
       <span><b>${esc(m.label)}</b><i>${esc(m.hint)}</i></span></label>
      <div class="ds-mode-body">${modeBlock(m)}</div>
     </div>`).join('')}</div>
    ${f('preferred','既定テーブル',x.preferred,'','この一覧を開いた直後に選ぶ表の名前。未入力なら抽出テーブルと同じです。')}
   </section>
   <section class="ds-edit-zone ds-edit-result">
    <h4 class="mm-fieldgroup">③ この設定でできること <span class="ds-probe-state" id="dsProbeState"></span></h4>
    <div id="dsProbeBox" class="ds-probe"></div>
   </section>
   <section class="ds-edit-zone ds-edit-now">
    <h4 class="mm-fieldgroup">④ いまの状態</h4>
    <dl class="ds-now">
     <div><dt>いま読んでいる</dt><dd title="${esc(x.activePath||'')}">${esc(x.activePath||(isNew?'（未登録）':'（この端末ではまだ読んでいません）'))}</dd></div>
     <div><dt>保存すると</dt><dd id="dsPlannedPath">—</dd></div>
    </dl>
    <p class="mm-field-hint">読み込み先はサーバー起動時に1回だけ決まります。保存したあとアプリを再起動すると「保存すると」の場所を読みます。</p>
   </section>
  </div>`;
 }
 /* 選んだ読み方の欄だけを開く。**閉じた側も値は残す**ので、切り替えて戻せば
    元の値が入っている。 */
 function dsSyncMode(){
  const form=$('#maintEditorForm');if(!form)return;
  const picked=form.querySelector('[data-ds-mode]:checked');
  const v=picked?picked.value:'share';
  form.querySelectorAll('[data-ds-mode-box]').forEach(box=>{
   box.classList.toggle('is-on',box.dataset.dsModeBox===v);
  });
 }
 function dsDraft(){
  const form=$('#maintEditorForm');if(!form)return null;
  const val=k=>{const el=form.querySelector(`[data-field="${k}"]`);return el?el.value:''};
  const picked=form.querySelector('[data-ds-mode]:checked');
  const pick=picked?picked.value:'share';
  const d={id:dsState.editing?dsState.editing.id:null,
   key:String(val('key')||'').trim().toUpperCase(),label:val('label'),purpose:val('purpose'),
   order:val('order'),enabled:val('enabled'),listed:val('listed')!=='出さない',
   rne:val('rne'),table:val('table'),
   output:val('output'),share:val('share'),preferred:val('preferred'),
   overridePath:String(val('overridePath')||'').trim()};
  /* 「直接読む」以外を選んでいるときは上書きを**空で送る＝解除する**。
     直接指定は保存値を持たず、パス設定マスタの上書きの有無そのものなので、
     選択と実体を必ず一致させる（2箇所に持つと必ず食い違う）。 */
  if(pick!=='direct')d.overridePath='';
  /* 「直接読む」を選んでいる間は、**下の設定（共有かRNEか）をそのまま残す**
     ——直接指定を外したときに、覚えのない読み方へ切り替わらないようにする。 */
  const stored=String((dsState.editing&&dsState.editing.mode)||'').trim();
  d.mode=(pick==='rne')?'rne':(pick==='share'?'share':(stored||'share'));
  return d;
 }
 let dsProbeTimer=null;
 function dsProbeSoon(delay){
  clearTimeout(dsProbeTimer);
  dsProbeTimer=setTimeout(dsProbeRun,delay==null?450:delay);
 }
 async function dsProbeRun(){
  const d=dsDraft();if(!d)return;
  const seq=++dsState.probeSeq;
  dsState.probing=true;dsRenderProbe();
  let r=null;
  try{r=await api('/api/data-source-master/probe',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(d)})}
  catch(e){r={error:e.message,capability:{features:{}}}}
  if(seq!==dsState.probeSeq)return;          /* 打っている最中の古い結果は捨てる */
  dsState.probing=false;
  dsState.probe=r.capability||{};dsState.probePath=r.path||'';
  if(r.error&&dsState.probe&&!dsState.probe.error)dsState.probe.error=r.error;
  dsRenderProbe();
 }
 function dsRenderProbe(){
  const box=$('#dsProbeBox'),state=$('#dsProbeState'),planned=$('#dsPlannedPath');
  if(!box)return;
  if(state)state.textContent=dsState.probing?'確かめています…':'いまの入力で確認';
  if(planned){
   planned.textContent=dsState.probePath||'—';
   planned.title=dsState.probePath||'';
  }
  const cap=dsState.probe||{},f=cap.features||{};
  const rows=CAPABILITY_ORDER.filter(k=>f[k]).map(k=>{
   const v=f[k];
   return `<div class="mm-cap-row${v.ok?' is-ok':' is-ng'}">
     <span class="mm-cap-mark">${v.ok?'できます':'できません'}</span>
     <span class="mm-cap-name">${esc(CAPABILITY_LABEL[k])}</span>
     <span class="mm-cap-note">${esc(v.note||'')}${v.detail?`<i>${esc(v.detail)}</i>`:''}</span>
    </div>`;
  }).join('');
  box.innerHTML=`${cap.error?`<p class="mm-cap-error">${esc(cap.error)}</p>`:''}
   ${rows||'<p class="mm-cap-error">まだ確かめていません。</p>'}
   <p class="mm-cap-foot">${esc(cap.table?`読んだのは表「${cap.table}」の${cap.columnCount}列です。`:'')}
    保存する前に、いま入力している場所を実際に開いて確かめています。</p>`;
 }
 async function saveDataSourceEditor(){
  const d=dsDraft();if(!d)return;
  const uid=requireMaintUser();if(uid===null)return;
  if(!d.key){showToast&&showToast('キーを入れてください','一覧を指す識別子です（半角英数と _）',5000);return}
  const url=d.id?'/api/data-source-master/update':'/api/data-source-master';
  try{
   setMaintLoading(true,'保存しています…');
   const r=await api(url,{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({...d,user_id:uid})});
   closeMaintEditor();
   dsState.loaded=false;await loadDataSourceMaint(true);
   showToast&&showToast('保存しました',(r&&r.message)||'',5200);
  }catch(e){showToast&&showToast('保存できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }

 /* ---------- パス設定（参照データの読み込み先・共有パス・各種間隔。旧config/local.json） ----------
    複数の値を持つ一覧ではなく1組の設定値のため、列表示マスタと同じ「特別扱い」
    にする。sikalot_source/sikalotnow_path/sikalotdef_path/records_backup_export_path/
    schedule_share_pathはサーバー起動時に1回だけ接続先へ反映されるため、保存後も
    このプロセスでは反映されない(再起動が必要)。一覧欄には「保存値」と「現在
    有効な値(このプロセス)」を並べて表示し、反映済みかを確認できるようにする。 ---------- */
 let pathConfigState={values:{},defaults:{},active:{},sources:[],loaded:false};
 /* 再起動しないと反映されない項目。データソースぶんは登録内容から作るので
    ここには固定で書かない(§9.81)。以前は「仕掛(SIKALOTNOW)」等が直接
    書かれており、データソースを増やしても増えず、名前を変えても古い
    ままだった。 */
 const PATH_CONFIG_RESTART_BASE=[['sikalot_source','参照データの取得元']];
 const PATH_CONFIG_RESTART_TAIL=[
  ['records_backup_export_path','測定データバックアップの複製先'],
  ['schedule_share_path','スケジュール共有パス(schedule.sqlite3)'],
 ];
 function pathConfigRestartFields(){
  return [...PATH_CONFIG_RESTART_BASE,
          ...(pathConfigState.sources||[]).map(src=>[src.valueKey,`${src.label}（${src.key}）の読み込み先`]),
          ...PATH_CONFIG_RESTART_TAIL];
 }
 async function loadPathConfigMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&pathConfigState.loaded){renderPathConfigForm();renderPathConfigList();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const r=await api('/api/path-config-master');
   pathConfigState.values=r.values||{};pathConfigState.defaults=r.defaults||{};pathConfigState.active=r.active||{};pathConfigState.sources=r.sources||[];
   pathConfigState.loaded=true;
   renderPathConfigForm();renderPathConfigList();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 /* ---------- 共通設定の作り（§9.208 ⑨、利用者の指示） ----------
    「多機能がゆえにわかりにくい説明になっているので、視覚的に表現できる
     ところやUIを工夫して直感的にわかるように」

    直したのは4点。
     ① **図を先に出す。** この端末が「どこから読み、どこへ書き、どこへ写すか」は
        文で並べても頭の中で組み立て直すことになる。1枚の絵にして、節ごとの
        いまの値をその中へ書く。図の枠は押せて、その設定の章まで連れて行く。
     ② **状態は欄のすぐ下。** 以前は画面のいちばん下に「いま効いている値」の
        対比表があり、再起動待ちかどうかを見るのに視線が上下していた
        （§8 同じ情報を2箇所に出さない／§2 次にすることを1つだけ指す）。
     ③ **章立てとレール。** 7つの節が1本の長いスクロールに並んでいて、いま
        どこにいるのかが分からなかった。章の一覧を上に置き、**再起動待ちの
        件数もそこに出す**（探させない）。
     ④ **「この端末」を最初の章にする。** PC名・ログインID・モードはすべての
        権限判定の入口なのに、どこにも書かれていなかった（§9.208 ⑧）。

    保存の仕組み（`[data-pc-field]`を集めて`POST /api/path-config-master`）は
    変えていない——**変えたのは並べ方と見せ方だけ**。 */
 const PC_SECTIONS=[
  {id:'terminal',name:'この端末',icon:'PC',when:'保存後すぐ反映',cls:'is-live'},
  {id:'read',    name:'どこから読むか',when:'サーバー再起動後に反映',cls:'is-restart'},
  {id:'schedule',name:'共有スケジュール',when:'一部は再起動後に反映',cls:'is-restart'},
  {id:'rne',     name:'RNE抽出',when:'保存後すぐ反映',cls:'is-live'},
 ];
 /* 1項目＝「名前 / 入力 / 一行の説明 / いまどうなっているか」。
    状態欄(`data-pc-state`)は`renderPathConfigList()`が後から埋める。 */
 function pcStateHtml(key){return `<small class="pc-state" data-pc-state="${esc(key)}"></small>`}
 function renderPathConfigForm(){
  const form=$('#masterMaintForm');if(!form)return;
  const v=pathConfigState.values||{};
  /* パス欄は「参照…」ダイアログとドラッグ&ドロップに対応させる(§9.49)。
     手打ちのUNCパスは打ち間違いに気づきにくいのが実際の問題だった。 */
  const pathField=(key,label,mode,hint)=>`<div class="mm-field mm-field-wide mm-field-path"><span>${esc(label)}</span>
    <span class="mm-path" data-path-drop="${key}">
     <input data-pc-field="${key}" data-field="${key}" type="text" value="${esc(v[key]||'')}" placeholder="未設定（既定値を使用）" autocomplete="off" spellcheck="false">
     <button type="button" class="mm-path-browse" data-path-browse="${key}" data-path-mode="${mode||'file'}">参照…</button>
    </span>
    <small class="mm-field-hint">${esc(hint||'「参照…」で選ぶか、エクスプローラーからここへドラッグ&ドロップできます。空欄で保存すると既定値に戻ります。')}</small>
    ${pcStateHtml(key)}</div>`;
  const numField=(key,label,unit,step,min)=>`<label class="mm-field mm-field-num"><span>${esc(label)}</span>${
   numFieldHtml({k:key,label,unit,step,min},v[key]||'',`data-pc-field="${key}"`)
  }<small class="mm-field-hint">未入力なら既定値 ${esc(pathConfigState.defaults[key]||'')}${esc(unit||'')} を使用します。</small></label>`;
  const pickField=(key,label,opts,hint)=>`<label class="mm-field"><span>${esc(label)}</span><select data-pc-field="${key}">${
   opts.map(([val,text])=>`<option value="${esc(val)}"${(v[key]||'')===val?' selected':''}>${esc(text)}</option>`).join('')
  }</select><small class="mm-field-hint">${hint||''}</small></label>`;
  const group=(id,title,when,whenCls,body)=>`<section class="mm-set-group" id="pcSec-${id}" data-pc-section="${id}">
    <div class="mm-set-group-head"><h4>${esc(title)}</h4><span class="mm-apply-badge ${whenCls}">${esc(when)}</span></div>
    <div class="mm-set-group-body">${body}</div></section>`;
  /* PC名は**サーバーが解決した結果**を出す（§9.208 ⑧）。画面が持つ
     `WL.terminal`は`/api/access-mode`の答えで、保存した直後は古い。 */
  const term=(window.WL&&WL.terminal)||null;
  const act=pathConfigState.active||{};
  const pcNow=act.pc_name||(term&&term.pcName())||'';
  const pcFrom=act.pc_name_source||(term&&term.pcNameSource())||'';
  form.className='mm-form mm-form-page';
  form.innerHTML=`<div class="mm-set-scroll pc-page">
   <!-- ① 図：この端末が何とつながっているか -->
   <div class="pc-map" id="pcMap" aria-label="この端末のつながり">
    <button type="button" class="pc-node" data-pc-jump="read">
     <b>参照データ</b><span class="pc-node-sub">仕掛・品質（読むだけ）</span>
     <span class="pc-node-val" data-pc-map="read">—</span></button>
    <span class="pc-arrow" aria-hidden="true"><i></i><em>読む</em></span>
    <button type="button" class="pc-node is-self" data-pc-jump="terminal">
     <b>この端末</b><span class="pc-node-sub">WaveLog</span>
     <span class="pc-node-val" data-pc-map="terminal">—</span></button>
    <span class="pc-arrow" aria-hidden="true"><i></i><em>書く</em></span>
    <button type="button" class="pc-node" data-pc-jump="schedule">
     <b>共有スケジュール</b><span class="pc-node-sub">作業予定（みんなで使う）</span>
     <span class="pc-node-val" data-pc-map="schedule">—</span></button>
   </div>
   <p class="pc-map-note">測定データの置き場（この端末のDB → 閲覧用の複製）は
    <button type="button" class="mm-btn-ghost pc-goto" id="pcGoRecords">測定データの保存</button>にあります。</p>

   <!-- ② 章のレール -->
   <nav class="pc-rail" id="pcRail" aria-label="共通設定の章">
    ${PC_SECTIONS.map(x=>`<button type="button" data-pc-jump="${x.id}">${esc(x.name)}</button>`).join('')}
    <span class="pc-rail-restart" id="pcRestartCount" hidden></span>
   </nav>

   ${group('terminal','この端末','保存後すぐ反映','is-live',`
    <div class="pc-who" id="pcWho">
     <div><small>PC名</small><b>${esc(pcNow||'（取得できていません）')}</b>
      <i>${esc(pcFrom||'出どころ不明')}</i></div>
     <div><small>ログインID</small><b>${esc((term&&term.loginId())||'（取得できていません）')}</b><i>OS</i></div>
     <div><small>いまのモード</small><b>${esc((window.accessMode&&accessMode.mode)||'edit')}</b>
      <i>アクセス権限マスタ</i></div>
    </div>
    <label class="mm-field mm-field-wide"><span>この端末の名前を決め打ちする</span>
     <input data-pc-field="pc_name" type="text" value="${esc(v.pc_name||'')}" placeholder="空欄ならOSから自動で取得します" autocomplete="off" spellcheck="false">
     <small class="mm-field-hint">アクセス権限マスタとの照合・記録の「更新端末名」・編集中の持ち主表示は、
      <b>すべてこの名前</b>を見ます。自動で取れない端末だけここで名乗ってください。</small>
     ${pcStateHtml('pc_name')}</label>
    <div id="pcNotes"></div>`)}

   ${group('read','どこから読むか','サーバー再起動後に反映','is-restart',`
    <div class="pc-source-list" id="pcSourceList"></div>
    <p class="mm-field-hint">読み込み先を変えるには「データ接続」のカードから <b>編集</b> を押してください
     （同じ設定を2画面に置くと、どちらが効くのか分からなくなるためここでは変えられません）。</p>
    ${pickField('sikalot_source','読み方を決めていないデータソースの既定',
      [['','（既定）network'],['network','network'],['local','local']],
      'network=共有フォルダを読む ／ local=この端末でRNEから抽出したものを読む。<b>読み方を決めたデータソースには効きません</b>。')}
    ${pcStateHtml('sikalot_source')}`)}

   ${group('schedule','共有スケジュール','一部は再起動後に反映','is-restart',`
    ${pathField('schedule_share_path','作業予定の共有データ置き場（schedule.sqlite3）','file','共有フォルダ上のschedule.sqlite3を選びます。空欄ならスケジュール機能は無効です。')}
    <div class="pc-sub">
     <b class="pc-sub-head">共有の変化をどう取り込むか</b>
     <p class="mm-field-hint">共有（Box等）のschedule.sqlite3は<b>他の端末も書きます</b>。読むときは手元へ写したものを読み、
      <b>改訂番号が変わったときだけ</b>写し直します（読むたびに写すと共有を掴み続け、他の端末の書込とぶつかります）。</p>
     ${pickField('schedule_watch_enabled','共有の変化を見張る',
       [['','（既定）auto: 見張る'],['auto','auto: 見張る'],['on','on: 見張る'],['off','off: 見張らない（読むたびに共有から写す）']],
       'offにすると以前の動きに戻ります（共有が遅い環境では読み込みも遅くなります）。')}
     ${numField('schedule_watch_interval_sec','変化を見る間隔','秒',5,5)}
     ${numField('schedule_watch_pause_sec','取り込んだあと休む時間','秒',5,0)}
    </div>
    <div class="pc-sub">
     <b class="pc-sub-head">同時に書いたときの取り合い</b>
     ${numField('schedule_lock_ttl_sec','書込ロックの有効期限','秒',5,1)}
     ${numField('schedule_lock_verify_delay_ms','ロック確認までの待機時間','ミリ秒',100,0)}
    </div>
    <div class="pc-sub">
     <b class="pc-sub-head">書く役を1台に絞る（既定はoff）</b>
     <p class="mm-field-hint">共有へ<b>実際に書く役を1台に絞る</b>仕掛けです。他のPCは書き込みだけをその1台へLAN内のHTTPで頼み、
      <b>読みは今までどおり手元の写しから</b>読みます（画面のURLは全員 http://127.0.0.1:5029/ のまま）。
      <b>持ち主が落ちていても止まりません</b>——頼めなかったPCは自分で共有へ書きます。</p>
     ${pickField('schedule_owner_enabled','書き込み役を1台に絞る',
       [['','（既定）off: 各PCが自分で共有へ書く'],['off','off: 各PCが自分で共有へ書く'],['on','on: 最初に入った1台が書き込み役になる']],
       'onにすると、書き込み役になったPCだけが下のポートを<b>LANへ開きます</b>（合言葉つきの決められた書き込みしか受け付けません）。')}
     ${numField('schedule_owner_port','書き込み役の受け口ポート','',1,1025)}
     ${numField('schedule_owner_ttl_sec','書き込み役の目印の有効期限','秒',10,30)}
     <div id="scheduleOwnerStatus" class="pc-owner-status">状態を読み込んでいます…</div>
    </div>`)}

   ${group('rne','RNE抽出','保存後すぐ反映','is-live',`
    <p class="mm-field-hint">RNE（Navigator問い合わせ定義）から <code>.sqlite3</code> を作り、それを一覧として読む仕組みです。
     取得元が <b>local</b> のデータソースだけが、ここで作ったファイルを読みます。</p>
    ${pickField('rne_extract_enabled','RNE抽出の定期実行',
      [['','（既定）auto: 取得元がlocalのときだけ'],['auto','auto: 取得元がlocalのときだけ'],
       ['on','on: 取得元に関わらず定期実行する'],['off','off: 定期実行しない（手動のみ）']],
      '「今すぐ抽出」は、この設定に関わらず資材が配置されていれば実行できます。')}
    ${numField('rne_extract_interval_sec','RNE抽出間隔','秒',60,60)}
    ${pathField('rne_assets_dir','RNE資材の置き場（フォルダ）','dir','RNEファイルと symnavim.conf をまとめて置くフォルダです。RNEファイルはこの下の rne/ 配下に置きます。共有フォルダを指定すれば、端末ごとにコピーせず1式を共用できます。空欄ならアプリ内の config/rne_extract です。')}
    ${pathField('rne_conf_path','接続情報 symnavim.conf の場所','file','認証情報だけを別の場所に置きたい場合に指定します。空欄なら上の資材置き場の直下（symnavim.conf）です。')}
    ${rneStatusPanelHtml()}`)}
  </div>
  <div class="mm-form-tail mm-set-sticky"><button type="submit" class="mm-btn-primary">共通設定を保存</button><span class="mm-form-hint">更新者IDは画面右上の入力欄を使用します。</span></div>`;
  form.onsubmit=ev=>{ev.preventDefault();savePathConfigMaint()};
  /* 図と章のレールは**同じ道**で章へ連れて行く（入口を2本作らない）。 */
  form.querySelectorAll('[data-pc-jump]').forEach(btn=>btn.onclick=ev=>{
   ev.preventDefault();
   const sec=form.querySelector(`#pcSec-${btn.dataset.pcJump}`);
   if(!sec)return;
   sec.scrollIntoView({block:'start',behavior:'smooth'});
   sec.classList.add('is-jumped');
   setTimeout(()=>sec.classList.remove('is-jumped'),1200);
  });
  const rec=$('#pcGoRecords');
  if(rec)rec.onclick=()=>document.querySelector('#masterMaintNav [data-master="measStorage"]')?.click();
  bindInputHelpers(form);
  refreshRneStatus();
  refreshOwnerStatus();
 }
 /* ---------- 書き込み役の状態(§9.192) ----------
    「入れたのに効いているのか分からない」を作らない。誰が役をしていて、
    このPCから見えているか（届いているか）までを文字で出す。 */
 async function refreshOwnerStatus(){
  const box=$('#scheduleOwnerStatus');if(!box)return;
  let o;
  try{o=await api('/api/schedule/owner-status')}
  catch(e){box.innerHTML=`<span class="pc-owner-off">状態を取得できません: ${esc(e.message)}</span>`;return}
  if(!o.configured){box.innerHTML='<span class="pc-owner-off">スケジュールの共有データ置き場が未設定のため、この設定は効きません。</span>';return}
  if(!o.enabled){box.innerHTML='<span class="pc-owner-off">いまは <b>off</b>（各PCが自分で共有へ書いています）。</span>';return}
  const who=o.isOwner?'<b>このPCが書き込み役です。</b>'
           :(o.ownerPc?`書き込み役は <b>${esc(o.ownerPc)}</b>${o.ownerLogin?`（${esc(o.ownerLogin)}）`:''} です。`
                      :'書き込み役はまだ決まっていません（決まるまでは各PCが自分で書きます）。');
  const lines=[
   o.isOwner?`受け口: ${esc((o.myUrls||[]).join(' / '))}`:(o.ownerUrl?`話しかけ先: ${esc(o.ownerUrl)}`:''),
   o.ownerAliveSec!=null?`最後の生存確認: ${Math.round(o.ownerAliveSec)}秒前（期限 ${esc(String(o.ttlSec))}秒）`:'',
   o.relays?`頼んだ回数: ${o.relays}回${o.relayFail?` / 届かなかった: ${o.relayFail}回`:''}`:'',
   o.lastError?`最後のエラー: ${esc(o.lastError)}（届かないあいだは自分で書きます）`:''
  ].filter(Boolean);
  box.innerHTML=`<div class="pc-owner-who${o.isOwner?' is-me':''}">${who}</div>`+
   (lines.length?`<div class="pc-owner-lines">${lines.map(t=>`<span>${t}</span>`).join('')}</div>`:'');
 }

 /* ---------- RNE抽出の状態表示と手動実行(§9.50) ----------
    ローカル運用(sikalot_source=local)のとき、抽出は背景で定期実行される。
    以前は成否がアプリログにしか出ず、「動いているのか」「今すぐ取り直したい」
    に画面から答えられなかった(「実際に起動させる方法が分からない」という指摘)。 */
 let rneTimer=null;
 function rneStatusPanelHtml(){
  return `<div class="rne-panel" id="rnePanel">
    <div class="rne-head">
     <h4>RNE抽出（参照データのローカル運用）</h4>
     <span class="rne-state" id="rneState">確認中…</span>
     <button type="button" class="mm-btn-ghost sm" id="rneRunBtn">今すぐ抽出</button>
    </div>
    <div id="rneBody"><div class="rne-note">状態を読み込んでいます…</div></div>
   </div>`;
 }
 function fmtWhen(sec){
  if(!sec)return '—';
  const d=new Date(sec*1000),diff=Math.floor((Date.now()-d.getTime())/60000);
  return `${d.toLocaleString('ja-JP')}（${diff<1?'たった今':diff+'分前'}）`;
 }
 async function refreshRneStatus(){
  const panel=$('#rnePanel');if(!panel)return;
  clearTimeout(rneTimer);rneTimer=null;
  let s;
  try{s=await api('/api/rne-extract/status')}
  catch(e){const b=$('#rneBody');if(b)b.innerHTML=`<div class="rne-note">状態を取得できません: ${esc(e.message)}</div>`;return}
  const state=$('#rneState'),body=$('#rneBody'),btn=$('#rneRunBtn');
  if(!state||!body||!btn)return;
  state.textContent=s.running?'抽出中…':(s.enabled?'定期実行 有効':'定期実行 停止中');
  state.className='rne-state '+(s.running?'is-running':(s.enabled?'is-on':'is-off'));
  // 手動実行は取得元に関わらず、資材が配置されていれば押せる
  btn.disabled=!!s.running||!s.canRun;
  btn.title=s.canRun?'取得元の設定に関わらず、今この場でRNEから抽出し直します。'
                    :'抽出に必要なファイル(RNE定義・symnavim.conf)が配置されていません。';
  const jobs=(s.jobs||[]).map(j=>`<div class="rne-job${j.ok?'':' is-ng'}"><b>${esc(j.name)}</b>${
    j.ok?`成功 ${esc(String(j.rows??'-'))}行 / ${(j.elapsed||0).toFixed(1)}秒`:`失敗: ${esc(j.error||'')}`}</div>`).join('');
  const outs=(s.outputs||[]).map(o=>`<div class="rne-job"><b>${esc(o.name)}</b>${
    o.exists?`最終更新 ${esc(fmtWhen(o.mtime))}`:'まだ作成されていません'}</div>`).join('');
  const missing=(s.assets&&s.assets.rneMissing)||[];
  body.innerHTML=`
   ${s.enabled?'':`<div class="rne-note"><b>定期実行は停止中です</b>（設定: ${esc(s.scheduleMode||'auto')}${s.scheduleMode==='off'?'':` / 取得元: ${esc(s.source||'')}`}）。
     定期実行を回すには、上の「RNE抽出の定期実行」を <b>on</b> にするか、「参照データの取得元」を <b>local</b> にしてください（取得元の変更はサーバー再起動後に反映されます。定期実行の設定は再起動不要です）。
     <b>「今すぐ抽出」は取得元の設定に関わらず実行できます。</b></div>`}
   ${missing.length?`<div class="rne-note" style="color:var(--danger)"><b>抽出定義(RNE)が未配置です: ${esc(missing.join(', '))}</b><br>${esc(s.assetsDir||'')}\\rne へ配置してください（機密のためリポジトリには含まれません。config/rne_extract/README.md 参照）。</div>`:''}
   ${(s.assets&&!s.assets.symnavimConf)?`<div class="rne-note" style="color:var(--danger)">接続情報 symnavim.conf が未配置です（${esc(s.assetsDir||'')}）。</div>`:''}
   <div class="rne-jobs">${outs}</div>
   ${jobs?`<div class="rne-jobs">${jobs}</div>`:''}
   <div class="rne-note">定期実行: ${s.enabled?`起動直後に1回、以降 ${esc(String(s.intervalSec))}秒ごと`:'（停止中）'} ／ 手動実行: ${s.canRun?'可能':'資材が未配置のため不可'} ／ 直近の実行: ${esc(fmtWhen(s.finishedAt||s.startedAt))}${s.trigger?`（${s.trigger==='manual'?'手動':'定期'}）`:''}</div>`;
  btn.onclick=async()=>{
   btn.disabled=true;
   try{
    const r=await api('/api/rne-extract/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:String($('#masterUserId')?.value||'').trim()})});
    showToast('抽出を開始しました',r.message||'',4000);
   }catch(e){showToast('抽出を開始できません',e.message,7000);btn.disabled=false;return}
   refreshRneStatus();
  };
  // 実行中だけ短い間隔で追いかける(終わったら止める。無駄な問い合わせを残さない)
  if(s.running)rneTimer=setTimeout(refreshRneStatus,2000);
 }
 /* ---------- 状態はその欄のすぐ下（§9.208 ⑨） ----------
    以前は画面のいちばん下に「保存値 ／ いま効いている値」の対比表を置いて
    いた。項目が10件を超えると、直した欄がその表のどの行なのかを探すことに
    なり、**再起動待ちかどうかを見るのに視線が上下する**。状態は欄の持ち物
    なので欄が持つ——表そのものは廃止した（§8 同じ情報を2箇所に出さない）。
    ここが埋めるのは「各欄の状態」「図の中の値」「章のレールの件数」の3つ。 */
 function renderPathConfigList(){
  const form=$('#masterMaintForm');if(!form||!form.classList.contains('mm-form-page'))return;
  const v=pathConfigState.values||{},a=pathConfigState.active||{};
  /* 「いま効いている値」の言い方。空欄は**何が起きるか**まで書く
     （「未設定」だけでは、既定へ落ちるのか機能が止まるのかが分からない）。 */
  const activeText={
   sikalot_source:a.sikalot_source||'',
   schedule_share_path:a.schedule_share_path||'（未設定・スケジュール機能は無効）',
  };
  const savedText={
   sikalot_source:v.sikalot_source||'（既定）network',
   schedule_share_path:v.schedule_share_path||'（未設定・スケジュール機能は無効）',
  };
  /* まだ読んでいないデータソースは**「解決できていません」ではなく
     「再起動後に反映」**と書く（§9.163）。前者は不具合に読めるが、
     実際は設計どおりの待ち状態で、打つ手が違う。 */
  const pendingKeys=new Set();
  (pathConfigState.sources||[]).forEach(src=>{
   if(src.loaded===false){
    pendingKeys.add(src.valueKey);
    activeText[src.valueKey]=`（未反映）再起動すると ${src.planned||'—'} を読みます`;
   }else{
    activeText[src.valueKey]=src.active||'（解決できていません）';
   }
   savedText[src.valueKey]=v[src.valueKey]||'（既定値を使用）';
  });
  /* 「再起動待ち」の判定は**表示文字列ではなく生の値**で行う。表示側は
     現在値にエンジン種別を添えたり、未設定を「（既定）network」と書き換えたり
     するので、文字列比較では中身が同じ行まで再起動待ちに見える（実際にそう出た）。
     保存値が空＝既定を使う指定なので、待ちにはしない。 */
  const isPending=key=>{
   const savedRaw=String(v[key]||'').trim(),activeRaw=String(a[key]||'').trim();
   return pendingKeys.has(key)||(!!savedRaw&&savedRaw!==activeRaw);
  };
  /* 各欄の状態。**再起動が要らない項目は「保存後すぐ反映」とだけ言う**
     ——比べる相手（いま効いている値）が無いのに空欄の対比を並べない。 */
  let pending=0;
  form.querySelectorAll('[data-pc-state]').forEach(el=>{
   const key=el.dataset.pcState;
   const restartable=pathConfigRestartFields().some(([k])=>k===key);
   if(!restartable){
    if(key==='pc_name'){
     const term=(window.WL&&WL.terminal)||null;
     const now=a.pc_name||(term&&term.pcName())||'（取得できていません）';
     const from=a.pc_name_source||(term&&term.pcNameSource())||'出どころ不明';
     el.className='pc-state';
     el.textContent=`いま名乗っている名前: ${now}（${from}）`;
    }else{
     el.className='pc-state';
     el.textContent='保存するとすぐに反映されます。';
    }
    return;
   }
   const p=isPending(key);
   if(p)pending++;
   el.className='pc-state'+(p?' is-pending-restart':'');
   el.innerHTML=`<span class="pc-state-now"><i>いま</i>${esc(activeText[key]||'—')}</span>`
    +`<span class="pc-state-saved"><i>保存値</i>${esc(savedText[key]||'—')}</span>`
    +(p?'<b class="mm-restart-flag">再起動待ち</b>':'');
   el.title=`いま効いている値: ${activeText[key]||'—'}\n保存値（次回起動から）: ${savedText[key]||'—'}`;
  });
  /* データソースは入力欄を持たない（「データ接続」が持つ）ので、
     読み取り専用の並びとして章の中へ出す。再起動待ちはここでも数える。 */
  const list=$('#pcSourceList');
  if(list){
   const rows=(pathConfigState.sources||[]);
   if(!rows.length){
    list.innerHTML='<p class="mm-field-hint">データソースが登録されていません。「データ接続」で登録してください。</p>';
   }else{
    list.innerHTML=rows.map(src=>{
     const p=isPending(src.valueKey);
     if(p&&!form.querySelector(`[data-pc-state="${src.valueKey}"]`))pending++;
     return `<div class="pc-source${p?' is-pending-restart':''}"><b>${esc(src.label)}</b><code>${esc(src.key)}</code>
      <span title="${esc(src.active||'')}">${esc(src.active||'（この端末ではまだ読んでいません）')}</span>
      ${src.loaded===false?`<i class="pc-source-next">再起動すると ${esc(src.planned||'—')} を読みます</i>`:''}
      ${p?'<b class="mm-restart-flag">再起動待ち</b>':''}</div>`;
    }).join('');
   }
  }
  /* 図の中の値。**節ごとの「いま」を絵の中で読める**ようにする。 */
  const term=(window.WL&&WL.terminal)||null;
  const short=t=>{const s=String(t||'—');return s.length>44?'…'+s.slice(-43):s};
  const mapText={
   read:short((pathConfigState.sources||[]).map(x=>x.active).filter(Boolean)[0]
     ||(activeText.sikalot_source?`取得元 ${activeText.sikalot_source}`:'（未設定）')),
   terminal:short((term&&term.pcName())||'（PC名を取得できていません）'),
   schedule:short(a.schedule_share_path||'（未設定・機能無効）'),
  };
  form.querySelectorAll('[data-pc-map]').forEach(el=>{
   const t=mapText[el.dataset.pcMap]||'—';
   el.textContent=t;el.title=t;
  });
  /* 章のレールに再起動待ちの件数を出す（探させない）。 */
  const badge=$('#pcRestartCount');
  if(badge){
   badge.textContent=pending?`再起動待ち ${pending}件`:'';
   badge.hidden=!pending;
   badge.title=pending?'保存した値は、サーバーを再起動すると効きます（stop.bat → Start.vbs）。':'';
  }
  /* **作り直せるファイルの置き場**(§9.109)と、**マスタDBが同期フォルダーの
     中にあるとき**の注意(§9.192)。どちらも設定ではないが、共有(BOX等)に置いた
     ファイル群を複数のPCから起動する現場では、**知らないと壊れ方が分からない**。 */
  const notes=$('#pcNotes');
  if(notes){
   const wd=v.work_dir?`<p class="mm-def-hint">作り直せるファイル（写し・スケジュールの作業コピー）の置き場: ${esc(v.work_dir)}`
     +`${v.work_dir_reason?`<b>（${esc(v.work_dir_reason)}）</b>`:''}</p>`:'';
   const cloud=v.master_cloud?`<p class="mm-warn-note"><b>マスタDBが${esc(v.master_cloud)}の中にあります</b>（${esc(v.db_dir||'')}）。
     このフォルダーを<b>複数のPCから同時に起動すると、全員が同じマスタへ書き込みます</b>——
     同期の衝突で設定が失われることがあります。各PCの手元へ置く場合は
     <code>config/local.json</code> の <code>db_dir</code> を、そのPCのローカルフォルダーへ向けてください
     （共有したいのは作業予定だけです。上の「作業予定の共有データ置き場」で共有します）。</p>`:'';
   notes.innerHTML=wd+cloud;
  }
 }
 async function savePathConfigMaint(){
  const uid=requireMaintUser();if(uid===null)return;
  const body={user_id:uid};
  // 数値欄は表示用の3桁区切りが入るので、送る前に外す(§9.49)
  document.querySelectorAll('#masterMaintForm [data-pc-field]').forEach(el=>{
   body[el.dataset.pcField]=el.classList.contains('mm-num-input')?numRaw(el.value):el.value;
  });
  try{
   setMaintLoading(true,'パス設定を保存しています…');
   const r=await api('/api/path-config-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   pathConfigState.loaded=false;await loadPathConfigMaint(true);
   showToast&&showToast('パス設定を保存しました',(r&&r.message)||'',5200);
  }catch(e){showToast&&showToast('保存できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }

 /* ---------- 勤務体系マスタ(親: 勤務体系 / 子: 勤務区分) ----------
    現場の言い方どおりの2階層で編集する。
      日勤              -> 日勤 8:15-17:05
      交替勤務(1,2,3直) -> 1直 7:00-15:00 / 2直 15:00-23:00 / 3直 23:00-翌7:00
    汎用のMASTER_DEFS(1行=1レコードの表)では親子を表現できないため専用画面にする。
    入力負荷を下げる工夫(直打ちを極力減らす):
      - 時刻はinput[type=time]。キーボードでもピッカーでも入れられ、
        "8:15"のような表記ゆれ・全角数字が原理的に入らない。
      - よくある勤務体系はテンプレートからワンクリックで投入できる。
      - 24時間バーで「どの時間帯が埋まっているか」を色で即座に確認できる
        (時刻の数字だけを見比べて抜け漏れを探さなくて済む)。 */
 const SHIFT_TEMPLATES=[
  {label:'日勤',segments:[{name:'日勤',start:'08:15',end:'17:05'}]},
  {label:'交替勤務(1,2,3直)',segments:[
    {name:'1直',start:'07:00',end:'15:00'},{name:'2直',start:'15:00',end:'23:00'},
    {name:'3直',start:'23:00',end:'07:00',dayOffset:-1}]},
  {label:'交替勤務(4,5直)',segments:[
    {name:'4直',start:'11:00',end:'19:10'},{name:'5直',start:'21:20',end:'05:45',dayOffset:-1}]},
 ];
 let shiftState={patterns:[],selectedId:null,draft:null,loading:false};
 /* 適用設備の複数選択(勤務体系マスタ)。**入で選ばれている設備名**を配列で返す。
    印はタグの入切(aria-pressed)で持つ——チェックボックスは`.mm-field input`の
    `min-width:200px`に当たり、器の幅を全部取って**設備名の文字が押し出されて
    見えなくなっていた**(実機で「設備名が消えている」と報告。§9.197)。 */
 function selectedShiftEquipment(){
  return [...document.querySelectorAll('#shiftEquipment [data-shift-eq][aria-pressed="true"]')]
   .map(x=>x.dataset.shiftEq);
 }
 function shiftDraftFrom(p){
  // equipmentは設備名の配列(複数可)。空配列=全設備共通。サーバーが古い形式
  // (単一文字列)を返しても配列へ寄せる。
  const eqList=v=>Array.isArray(v)?v.filter(Boolean).map(String):(String(v||'').trim()?[String(v).trim()]:[]);
  return p?{id:p.id,equipment:eqList(p.equipment),name:p.name||'',
            segments:(p.segments||[]).map(x=>({name:x.name,start:x.start,end:x.end,
              dayOffset:(x.dayOffset==null?null:Number(x.dayOffset))}))}
           :{id:null,equipment:[],name:'',segments:[]};
 }
 async function loadShiftPatternMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.classList.remove('mm-form-compact');
  if(typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){/* 設備が読めなくても編集は続行 */}}
  list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const r=await api('/api/schedule/shift-pattern-master?scope=all');
   shiftState.patterns=r.items||[];
   if(!shiftState.patterns.some(p=>p.id===shiftState.selectedId))shiftState.selectedId=shiftState.patterns[0]?.id??null;
   shiftState.draft=shiftDraftFrom(shiftState.patterns.find(p=>p.id===shiftState.selectedId));
   renderShiftPattern();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 // 24時間バー上の位置(%)。日跨ぎ(終了<=開始)は2本に分けて描く。
 function shiftBarPieces(seg){
  const toMin=v=>{const m=/^(\d{1,2}):(\d{2})$/.exec(String(v||''));return m?(+m[1])*60+(+m[2]):null};
  const s=toMin(seg.start),e=toMin(seg.end);
  if(s==null||e==null)return [];
  const pct=v=>(v/1440*100);
  return (e<=s)?[[pct(s),pct(1440)-pct(s)],[0,pct(e)]]:[[pct(s),pct(e)-pct(s)]];
 }
 /* 日を跨ぐ区分だけが持つ「日付の数え方」(§9.195の現場歴)。**跨がない区分
    には出さない**——効かない欄を置くと、設定したのに変わらないと読まれる。 */
 const SHIFT_DAYOFF_OPTIONS=[
  {v:-1,label:'前の日として数える（−1日）'},
  {v:0,label:'暦どおり（0日）'},
  {v:1,label:'翌日として数える（＋1日）'},
 ];
 /* **何が選ばれているかを文字で言う**(§3)。チェックの見た目だけだと、
    設備が多いときに「全設備共通なのか選び忘れなのか」が読めない。 */
 function shiftEqSummaryHtml(names,total){
  if(!total)return '';
  return names.length
   ? `<b>${names.length}</b> 設備に適用（${esc(names.slice(0,3).join('、'))}${names.length>3?' ほか':''}）`
   : '<b>全設備共通</b>（どれも選んでいないので既定として使われます）';
 }
 /* チェックのたびに**画面を組み直さないこと**——設備が多いと選ぶ器が
    スクロールごと巻き戻り、続けて選べない（§9.117と同じ罠）。文字だけ
    差し替える。 */
 function refreshShiftEqSummary(){
  const sum=$('#masterMaintList .shift-eq-sum');
  const names=selectedShiftEquipment();
  if(sum)sum.innerHTML=shiftEqSummaryHtml(names,(equipmentMasterState.items||[]).length);
  const none=$('#shiftEqNone');if(none)none.disabled=!names.length;
 }
 function shiftCrossesMidnight(seg){
  const t=v=>{const m=/^(\d{1,2}):(\d{2})$/.exec(String(v||''));return m?(+m[1])*60+(+m[2]):null};
  const a=t(seg&&seg.start),b=t(seg&&seg.end);
  return a!==null&&b!==null&&b<=a;
 }
 function shiftDayOffsetOf(seg){
  if(!shiftCrossesMidnight(seg))return 0;
  return (seg&&seg.dayOffset!=null&&seg.dayOffset!=='')?Number(seg.dayOffset):-1;
 }
 /* 勤務区分の1行。**見出しと同じグリッド定義を共有する**（別々に組むと
    左端がずれる。§9.176と同じ土台）。 */
 const SHIFT_SEG_COLS=[
  {k:'dot',label:''},{k:'name',label:'区分の名称'},{k:'time',label:'時間帯'},
  {k:'next',label:'日跨ぎ'},{k:'dayoff',label:'日付の数え方'},{k:'act',label:''},
 ];
 function renderShiftPattern(){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  const d=shiftState.draft||shiftDraftFrom(null);
  const eqSelected=new Set((d.equipment||[]).map(String));
  const eqItems=(equipmentMasterState.items||[]);
  /* 設備は**名前のタグの入切**で選ぶ(§9.197、利用者の指示「設備名のバッジを
     出して、配色のONOFF」)。名前そのものが押せる的なので、四角い枠と
     チェックの位置を目で往復しなくてよい。入は面の色で、**色だけで伝えない**
     ため上の要約が件数と名前を文字で言う。 */
  const eqChips=eqItems.length
   ? eqItems.map(x=>{
      const on=eqSelected.has(x.name);
      return `<button type="button" class="shift-eq-tag${on?' is-on':''}" data-shift-eq="${esc(x.name)}"`
       +` aria-pressed="${on?'true':'false'}" title="${esc(x.name)}を${on?'外す':'この勤務体系の対象にする'}">`
       +`<i aria-hidden="true">${on?'✓':'＋'}</i>${esc(x.name)}</button>`;
     }).join('')
   : '<span class="mm-empty-inline">設備マスタが未登録です。先に「設備」タブで登録してください。</span>';
  const eqSummary=shiftEqSummaryHtml([...eqSelected],eqItems.length);
  form.innerHTML=`<div class="mm-form-head">
    <span class="mm-mode-chip ${d.id?'editing':'new'}">${d.id?`編集中 <b>${esc(d.name||'')}</b>`:'新規の勤務体系'}</span>
    <button type="button" id="shiftNew" class="mm-btn-ghost sm">＋ 勤務体系を追加</button>
    <span class="mm-form-hint">テンプレート:</span>
    ${SHIFT_TEMPLATES.map((t,i)=>`<button type="button" class="mm-btn-ghost sm" data-shift-tmpl="${i}">${esc(t.label)}</button>`).join('')}
   </div>
   <p class="mm-def-hint">勤務体系(日勤・交替勤務など)の中に、各直の時間帯を並べます。作業スケジュールの「勤務」列は、予定の時刻が入る区分の名称を表示します。終了が開始以下の区分は翌日にまたがる勤務として扱い、<b>跨いだ後の時間帯は「日付の数え方」で決めた日付で数えます</b>（3直 23:00〜翌7:00 を1つの日としてまとめるための設定です）。適用設備を空欄にすると全設備の既定になり、設備を指定した体系があればそちらが優先されます。</p>`;
  form.onsubmit=ev=>ev.preventDefault();
  $('#shiftNew').onclick=()=>{shiftState.selectedId=null;shiftState.draft=shiftDraftFrom(null);renderShiftPattern()};
  form.querySelectorAll('[data-shift-tmpl]').forEach(b=>b.onclick=()=>{
   const t=SHIFT_TEMPLATES[+b.dataset.shiftTmpl];
   shiftState.draft={...d,name:d.name||t.label,segments:t.segments.map(x=>({...x}))};
   renderShiftPattern();
  });

  const bars=d.segments.map((seg,i)=>shiftBarPieces(seg).map(([left,w])=>
    `<span class="shift-bar-piece" data-i="${i%6}" style="left:${left}%;width:${w}%" title="${esc(seg.name)} ${esc(seg.start)}〜${esc(seg.end)}"></span>`).join('')).join('');
  const segHead=`<div class="shift-seg-head">${
    SHIFT_SEG_COLS.map(c=>`<span class="shift-seg-h shift-seg-c-${c.k}">${esc(c.label)}</span>`).join('')}</div>`;
  const segRow=(seg,i)=>{
   const cross=shiftCrossesMidnight(seg);
   const off=shiftDayOffsetOf(seg);
   return `<div class="shift-seg" data-i="${i}">
     <span class="shift-seg-dot" data-i="${i%6}"></span>
     <input class="shift-seg-name" type="text" value="${esc(seg.name)}" placeholder="例: 1直" autocomplete="off">
     <span class="shift-seg-time">
      <input class="shift-seg-start" type="time" value="${esc(seg.start)}">
      <span class="shift-seg-sep">〜</span>
      <input class="shift-seg-end" type="time" value="${esc(seg.end)}"></span>
     <span class="shift-seg-next${cross?'':' is-empty'}">${cross?'翌日':''}</span>
     ${cross
       ?`<select class="shift-seg-dayoff" title="日を跨いだ後の時間帯を、どの日として数えるか">${
          SHIFT_DAYOFF_OPTIONS.map(o=>`<option value="${o.v}"${o.v===off?' selected':''}>${esc(o.label)}</option>`).join('')}</select>`
       :'<span class="shift-seg-dayoff is-na" title="日を跨がない区分なので、日付の補正はありません">—</span>'}
     <span class="shift-seg-act">
      <button type="button" class="shift-seg-up" title="上へ"${i===0?' disabled':''}>▲</button>
      <button type="button" class="shift-seg-down" title="下へ"${i===d.segments.length-1?' disabled':''}>▼</button>
      <button type="button" class="shift-seg-del" title="この区分を削除">×</button></span>
    </div>`;
  };
  list.innerHTML=`<div class="shift-editor">
    <aside class="shift-list">
     <div class="shift-list-head">登録済みの勤務体系</div>
     ${shiftState.patterns.length?shiftState.patterns.map(p=>`<button type="button" class="shift-list-item${p.id===d.id?' active':''}" data-shift-pattern="${p.id}">
        <b>${esc(p.name)}</b><small>${esc(p.equipmentText||'全設備共通')} ・ ${(p.segments||[]).length}区分</small></button>`).join('')
       :'<div class="mm-empty-inline">まだありません。テンプレートから作れます。</div>'}
    </aside>
    <section class="shift-detail">
     <div class="shift-fields">
      <label class="mm-field shift-f-name"><span>勤務体系の名称<i>*</i></span>
       <input id="shiftName" type="text" value="${esc(d.name)}" placeholder="例: 交替勤務(1,2,3直)" autocomplete="off"></label>
      <div class="mm-field shift-f-eq"><span>適用設備</span>
       <div class="shift-eq-bar">
        <span class="shift-eq-sum">${eqSummary}</span>
        ${eqItems.length?`<span class="shift-eq-act">
          <button type="button" class="mm-btn-ghost sm" id="shiftEqAll">すべて選ぶ</button>
          <button type="button" class="mm-btn-ghost sm" id="shiftEqNone"${eqSelected.size?'':' disabled'}>全設備共通に戻す</button>
         </span>`:''}
       </div>
       <div class="shift-eq-picker" id="shiftEquipment">${eqChips}</div></div>
     </div>
     <div class="shift-bar-wrap">
      <div class="shift-bar" title="24時間のうち、どの時間帯がどの区分か">${bars}<span class="shift-bar-noon"></span></div>
      <div class="shift-bar-scale"><span>0時</span><span>6時</span><span>12時</span><span>18時</span><span>24時</span></div>
     </div>
     <div class="shift-segs" id="shiftSegs">${
       d.segments.length?segHead+d.segments.map(segRow).join('')
       :'<div class="mm-empty-inline">区分がありません。「＋ 区分を追加」かテンプレートから追加してください。</div>'}
     </div>
     <div class="shift-actions">
      <button type="button" id="shiftAddSeg" class="mm-btn-ghost sm">＋ 区分を追加</button>
      <span class="mm-form-hint" id="shiftCoverage"></span>
      <span class="shift-actions-tail">
       ${d.id?'<button type="button" id="shiftDelete" class="mm-btn-ghost sm">この勤務体系を削除</button>':''}
       <button type="button" id="shiftSave" class="mm-btn-primary sm">保存</button>
      </span>
     </div>
    </section>
   </div>`;

  list.querySelectorAll('[data-shift-pattern]').forEach(b=>b.onclick=()=>{
   shiftState.selectedId=+b.dataset.shiftPattern;
   shiftState.draft=shiftDraftFrom(shiftState.patterns.find(p=>p.id===shiftState.selectedId));
   renderShiftPattern();
  });
  const sync=()=>{
   const dd=shiftState.draft;
   dd.name=$('#shiftName').value;dd.equipment=selectedShiftEquipment();
   dd.segments=[...list.querySelectorAll('.shift-seg')].map(el=>{
    const off=el.querySelector('select.shift-seg-dayoff');
    return {name:el.querySelector('.shift-seg-name').value,
            start:el.querySelector('.shift-seg-start').value,
            end:el.querySelector('.shift-seg-end').value,
            dayOffset:off?Number(off.value):null};
   });
  };
  $('#shiftName').oninput=()=>{shiftState.draft.name=$('#shiftName').value};
  /* タグの入切。**押した瞬間にその場で切り替える**——画面を組み直すと器が
     スクロールごと巻き戻り、続けて選べない(§9.117と同じ罠)。 */
  $('#shiftEquipment')?.querySelectorAll('[data-shift-eq]').forEach(tag=>{
   tag.onclick=ev=>{
    ev.preventDefault();
    const on=tag.getAttribute('aria-pressed')!=='true';
    tag.setAttribute('aria-pressed',on?'true':'false');
    tag.classList.toggle('is-on',on);
    const mark=tag.querySelector('i');if(mark)mark.textContent=on?'✓':'＋';
    tag.title=`${tag.dataset.shiftEq}を${on?'外す':'この勤務体系の対象にする'}`;
    shiftState.draft.equipment=selectedShiftEquipment();
    refreshShiftEqSummary();
   };
  });
  const eqAll=$('#shiftEqAll');
  if(eqAll)eqAll.onclick=()=>{sync();
   shiftState.draft.equipment=(equipmentMasterState.items||[]).map(x=>x.name);renderShiftPattern()};
  const eqNone=$('#shiftEqNone');
  if(eqNone)eqNone.onclick=()=>{sync();shiftState.draft.equipment=[];renderShiftPattern()};
  list.querySelectorAll('.shift-seg').forEach(el=>{
   const i=+el.dataset.i;
   // 時刻・名称の変更はその場でバーへ反映する(保存前に結果が見える)。
   el.querySelectorAll('input').forEach(inp=>inp.onchange=()=>{sync();renderShiftPattern()});
   const off=el.querySelector('select.shift-seg-dayoff');
   if(off)off.onchange=()=>{sync();renderShiftPattern()};
   el.querySelector('.shift-seg-del').onclick=()=>{sync();shiftState.draft.segments.splice(i,1);renderShiftPattern()};
   el.querySelector('.shift-seg-up').onclick=()=>{sync();if(i>0)shiftState.draft.segments.splice(i-1,0,shiftState.draft.segments.splice(i,1)[0]);renderShiftPattern()};
   el.querySelector('.shift-seg-down').onclick=()=>{sync();const a=shiftState.draft.segments;if(i<a.length-1)a.splice(i+1,0,a.splice(i,1)[0]);renderShiftPattern()};
  });
  $('#shiftAddSeg').onclick=()=>{
   sync();
   const segs=shiftState.draft.segments;
   const last=segs[segs.length-1];
   // 直前の区分の終了時刻を次の開始時刻の初期値にする(連続する直の入力が
   // ほぼクリックだけで済む)。
   segs.push({name:`${segs.length+1}直`,start:last?last.end:'08:00',end:last?last.end:'17:00',dayOffset:null});
   renderShiftPattern();
  };
  const del=$('#shiftDelete');if(del)del.onclick=()=>deleteShiftPattern(d);
  $('#shiftSave').onclick=()=>{sync();saveShiftPattern()};
  renderShiftCoverage(d);
 }
 function renderShiftCoverage(d){
  const el=$('#shiftCoverage');if(!el)return;
  const total=d.segments.reduce((a,seg)=>a+shiftBarPieces(seg).reduce((x,[,w])=>x+w,0),0);
  if(!d.segments.length){el.textContent='';return}
  el.textContent=total>=99.5?'24時間をすべてカバーしています':`24時間のうち約${Math.round(total)}%をカバーしています`;
  el.className='mm-form-hint'+(total>=99.5?' shift-cov-ok':'');
 }
 async function saveShiftPattern(){
  const uid=requireMaintUser();if(uid===null)return;
  const d=shiftState.draft;
  if(!String(d.name||'').trim()){showToast('入力を確認してください','勤務体系の名称を入力してください。',4000);return}
  try{
   setMaintLoading(true,'勤務体系を保存しています…');
   const r=await api('/api/schedule/shift-pattern-master',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:d.id,equipment:d.equipment||[],name:d.name,segments:d.segments,user_id:uid})});
   shiftState.selectedId=r.id;
   await loadShiftPatternMaint(true);
   showToast&&showToast('勤務体系を保存しました',`${d.name}(${d.segments.length}区分)`,3600);
  }catch(e){showToast&&showToast('保存できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }
 async function deleteShiftPattern(d){
  const uid=requireMaintUser();if(uid===null)return;
  if(!d.id)return;
  if(typeof confirmModal==='function'){
   const ok=await confirmModal({eyebrow:'勤務形態',title:'この勤務体系を削除しますか？',
    message:`「${d.name}」とその配下の区分(${d.segments.length}件)を無効化します。`,confirmLabel:'削除する',danger:true});
   if(!ok)return;
  }
  try{
   setMaintLoading(true,'勤務体系を削除しています…');
   await api('/api/schedule/shift-pattern-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:d.id,user_id:uid})});
   shiftState.selectedId=null;
   await loadShiftPatternMaint(true);
   showToast&&showToast('勤務体系を削除しました',d.name,3600);
  }catch(e){showToast&&showToast('削除できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }

 /* ---------- テーブル生データ(旧「マスタ一覧」、ARCHITECTURE.md「マスタ管理の画面形態」で統合) ----------
    master.sqlite3のテーブルをそのまま読み取り専用で表示する。上のタブが
    面倒を見ていないテーブル(表示マスタ・スケジュール列表示マスタ・
    パス設定マスタの実体など)も確認できる、最後の手段としての生データ閲覧。
    編集は各専用タブから行う前提のため、ここでは書込導線を一切出さない。 */
 let rawTableState={tables:[],table:'',columns:[],rows:[],loaded:false};
 async function loadRawTableMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.classList.remove('mm-form-compact');
  if(force||!rawTableState.loaded){
   form.innerHTML='<div class="mm-form-head"><span class="mm-mode-chip new">読み込み中</span></div>';
   list.innerHTML='<div class="mm-empty">テーブル一覧を取得しています…</div>';
   try{
    const r=await api('/api/tables?db=MASTER');
    rawTableState.tables=r.tables||[];rawTableState.loaded=true;
    if(!rawTableState.tables.includes(rawTableState.table))rawTableState.table=rawTableState.tables[0]||'';
   }catch(e){
    form.innerHTML='';
    list.innerHTML=`<div class="mm-empty error">テーブル一覧を取得できませんでした: ${esc(e.message)}</div>`;
    return;
   }
  }
  renderRawTableForm();
  await loadRawTableRows();
 }
 function renderRawTableForm(){
  const form=$('#masterMaintForm');if(!form)return;
  if(!rawTableState.tables.length){form.innerHTML='<div class="mm-form-head"><span class="mm-mode-chip new">テーブルがありません</span></div>';return}
  const opts=rawTableState.tables.map(t=>`<option value="${esc(t)}"${t===rawTableState.table?' selected':''}>${esc(t)}</option>`).join('');
  form.innerHTML=`<div class="mm-form-head">
    <label class="mm-field mm-field-inline"><span>テーブル</span><select id="rawTableSelect">${opts}</select></label>
    <button type="button" id="rawTableReload" class="mm-btn-ghost sm">再読込</button>
    <span class="mm-form-hint">読み取り専用です。編集は左の各マスタタブから行ってください。</span>
   </div>
   <p class="mm-def-hint">マスタDB(master.sqlite3)のテーブルをそのまま表示します。専用タブが用意されていないテーブルの中身を確認したいときに使います。先頭200件まで表示します。</p>`;
  form.onsubmit=ev=>ev.preventDefault();
  const sel=$('#rawTableSelect');if(sel)sel.onchange=()=>{rawTableState.table=sel.value;loadRawTableRows()};
  const rb=$('#rawTableReload');if(rb)rb.onclick=()=>loadRawTableRows();
 }
 async function loadRawTableRows(){
  const list=$('#masterMaintList');if(!list)return;
  if(!rawTableState.table){list.innerHTML='<div class="mm-empty">テーブルを選択してください。</div>';return}
  list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const q=new URLSearchParams({db:'MASTER',table:rawTableState.table,page:1,page_size:200});
   const d=await api('/api/table?'+q);
   rawTableState.columns=d.columns||[];rawTableState.rows=d.rows||[];
   renderRawTableList(d.count);
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 function renderRawTableList(count){
  const list=$('#masterMaintList');if(!list)return;
  const cols=rawTableState.columns,rows=rawTableState.rows;
  if(!cols.length){list.innerHTML='<div class="mm-empty">列がありません。</div>';return}
  const head=cols.map(c=>`<th>${esc(c)}</th>`).join('');
  const body=rows.map(r=>`<tr>${cols.map(c=>{const v=r[c];return `<td title="${esc(v??'')}">${esc(v??'')||'<em class="mm-blank">—</em>'}</td>`}).join('')}</tr>`).join('');
  list.innerHTML=`<div class="mm-raw-meta">${esc(rawTableState.table)} — ${rows.length}件を表示${(count!=null&&count>rows.length)?` (全${count}件)`:''}</div>
   <div class="mm-raw-scroll"><table class="mm-raw-table"><thead><tr>${head}</tr></thead><tbody>${body||`<tr><td colspan="${cols.length}">データがありません。</td></tr>`}</tbody></table></div>`;
 }

 function openMasterMaint(defKey){
  WL.enterView('master');
  /* どのタブを開くか指定できる(§9.183)。左メニューの「再起動待ち」から
     押したときに、データ接続のタブを開いた状態で出すため。 */
  if(defKey&&MASTER_DEFS.some(d=>d.key===defKey))maintState.defKey=defKey;
  const panel=ensureMaintPanel();
  WL.syncViewToolbar('master');   // 更新者ID(#mmHead)はパネル生成後にヘッダーへ載せる
  renderMaintNav();
  const uid=$('#masterUserId');if(uid)uid.value=currentUserId();
  if(!maintDefVisible(currentDef()))maintState.defKey=firstVisibleDefKey();
  maintState.editing=null;maintState.query='';
  const se=$('#masterMaintSearch');if(se)se.value='';
  syncNav();panel.hidden=false;loadMaint(true);
  requestAnimationFrame(()=>{const u=$('#masterUserId');if(u&&!u.value){u.focus();return}const s=$('#masterMaintSearch');if(s)s.focus()});
 }
 window.openMasterMaint=openMasterMaint;

 // #openMasterMaintのクリックはここ(document委譲・capture)一箇所のみで処理する。
 // 以前はbindMasterMaint()でボタン自身にもonclickを付けていたが、この

 /* ================================================================
    操業データの配置（§9.216 ④、利用者の指示）
    ----------------------------------------------------------------
    「特に『操業データ項目』と『操業データ選択肢』について、相互リンク、
      連携を強めてより登録の負荷を下げて汎用性を向上させてほしい」
    「描画可能なエリア(縦2×横3のカード)内の中でレイアウトも含めてマスタ上で
      視覚的に調整D&Dで並び替え編集ができる汎用設定機能」

    行を1つずつ編集する一覧では、**並べたときにどう見えるか**が分からない。
    ここでは測定画面のカードと**同じ6列のグリッド**を出し、掴んで動かす。
    群は「直前の見出し帯」で決まるので、**1回の操作で並びと群の両方**が
    決まる（別々に選ばせない）。

    右側は選んだ1項目の設定。**選択肢はその場で足せる**——項目を作る手を
    止めて別のタブへ行かせない（利用者の言う「登録の負荷」の正体）。
    ================================================================ */
 const opState={equipment:'',items:[],types:[],places:['準備','入力内容'],spans:[1,2,3,6],
                gridCols:6,choiceNames:[],choices:[],usage:{},picked:null,busy:false};
 const OP_PLACE_NOTE={
  '準備':'①準備の「操業データ」カード（横3マス×縦2マス）',
  '入力内容':'②測定の「入力内容」カード（畳んでおき、下の「開く条件」に当たる項目を選ぶと開きます）',
 };
 function opItemById(id){return opState.items.find(x=>String(x.id)===String(id))||null}
 /* 置き場ごとの並び。**群は「直前の見出し」で決まる**ので、ここで帯と
    項目を1本の列に混ぜて作る（画面もこの列をそのまま描く）。 */
 function opRows(place){
  const items=opState.items.filter(x=>(x.place||'準備')===place)
    .sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));
  const rows=[];let cur=null;
  items.forEach(x=>{
   const g=x.group||'その他';
   if(g!==cur){rows.push({type:'group',name:g,place,fold:!!x.fold,showWhen:x.showWhen||[]});cur=g}
   rows.push({type:'item',x});
  });
  return rows;
 }
 function opSpanOf(x){return Math.max(1,Math.min(opState.gridCols,Number(x.span)||2))}
 function opTileHtml(x){
  const span=opSpanOf(x);
  const off=x.enabled===false;
  const tip=[x.name,x.builtin?'画面がもともと持っている入力欄':x.type,
             span+'列',x.required?'必須':'',off?'出さない':''].filter(Boolean).join('｜');
  return `<div class="op-tile${String(opState.picked)===String(x.id)?' is-picked':''}`
   +`${off?' is-off':''}" draggable="true" data-op-id="${esc(x.id)}"`
   +` style="grid-column:span ${span}" title="${esc(tip)}" tabindex="0">`
   +`<span class="op-tile-name">${esc(x.name)}</span>`
   +`<span class="op-tile-meta">`
   +(x.builtin?'<b class="op-chip op-chip-builtin">画面の欄</b>':'')
   +(x.required?'<b class="op-chip op-chip-req">必須</b>':'')
   +(off?'<b class="op-chip op-chip-off">出さない</b>':'')
   +`<span class="op-tile-type">${esc(x.builtin?'—':x.type||'')}</span>`
   +`<span class="op-tile-span">${span}列</span></span></div>`;
 }
 function opBandHtml(r,count){
  const cond=(r.showWhen||[]).length?`／開く条件: ${esc((r.showWhen||[]).join('、'))}`:'';
  return `<div class="op-band" data-op-band="${esc(r.name)}" data-op-place="${esc(r.place)}"`
   +` style="grid-column:1/-1" title="この帯より下の項目が「${esc(r.name)}」になります">`
   +`<b class="op-band-name">${esc(r.name)}</b>`
   +`<small class="op-band-note">${count}項目${r.fold?'／畳む':''}${cond}</small>`
   +`<span class="op-band-tools">`
   +`<button type="button" class="ghost" data-op-rename="${esc(r.name)}" data-op-place="${esc(r.place)}">名前</button>`
   +`<button type="button" class="ghost" data-op-fold="${esc(r.name)}" data-op-place="${esc(r.place)}"`
   +` aria-pressed="${r.fold?'true':'false'}">${r.fold?'畳む':'開いたまま'}</button>`
   +`</span></div>`;
 }
 function opBoardHtml(place){
  const rows=opRows(place);
  const counts={};
  rows.forEach(r=>{if(r.type==='item'){const g=r.x.group||'その他';counts[g]=(counts[g]||0)+1}});
  const body=rows.map(r=>r.type==='group'?opBandHtml(r,counts[r.name]||0):opTileHtml(r.x)).join('')
   ||'<p class="mm-empty-inline" style="grid-column:1/-1">この置き場の項目はまだありません。右の一覧から掴んで持ってくるか、「項目を追加」で作ります。</p>';
  const n=rows.filter(r=>r.type==='item').length;
  return `<section class="op-board" data-op-place="${esc(place)}">`
   +`<div class="op-board-head"><b>${esc(place)}</b>`
   +`<small>${esc(OP_PLACE_NOTE[place]||'')}</small>`
   +`<span class="op-board-count">${n}項目</span></div>`
   +`<div class="op-board-grid" data-op-place="${esc(place)}"`
   +` style="--op-cols:${opState.gridCols}">${body}</div></section>`;
 }
 /* 選んだ1項目の設定。**組み込みの欄は型・上下限・選択肢を持たない**
    （画面が持っている入力欄なので、ここで決めても効かない）。
    **できないことは書く**（§CLAUDE 4）——欄を出しておいて無視しない。 */
 function opDetailHtml(){
  const x=opItemById(opState.picked);
  if(!x)return `<div class="op-detail-empty">左のカードで項目を選ぶと、ここで設定できます。<br>`
   +`掴んで動かすと<b>並びと群</b>が決まり、置き場（準備／入力内容）も帯をまたげば変わります。</div>`;
  const opt=(v,cur)=>`<option value="${esc(v)}"${String(cur)===String(v)?' selected':''}>${esc(v)}</option>`;
  const isChoice=x.type==='選択';
  const vals=(opState.choices||[]).filter(c=>c.name===x.choice).map(c=>c.value);
  const users=(opState.usage||{})[x.choice]||[];
  return `<div class="op-detail-head"><b>${esc(x.name)}</b>`
   +(x.builtin?`<span class="op-chip op-chip-builtin">画面の欄（${esc(x.builtin)}）</span>`:'')+`</div>`
   +`<div class="mm-field"><label>対象設備<input id="opdEquipment" type="text" value="${esc(x.equipment||'*')}"`
   +` title="'*'＝すべての設備。カンマ区切りで複数指定できます（設備停止マスタと同じ書式）"></label></div>`
   +(x.builtin?`<p class="op-note-line">この欄は画面がもともと持っています（内径のプリセット・条数の上限など、それぞれの仕掛けを持っているため）。ここで決められるのは<b>並び・群・列幅・必須・出す/出さない・置き場</b>だけです。名前と型は変えられません。</p>`
     :`<div class="mm-field"><label>項目名<input id="opdName" type="text" value="${esc(x.name)}"`
      +` title="測定画面に出る名前で、記録の鍵にもなります。変えると、それまでの記録は前の名前のまま残ります"></label></div>`
      +`<div class="mm-field"><label>型<select id="opdType">`
      +opState.types.map(t=>opt(t,x.type)).join('')+`</select></label></div>`
      +`<div class="mm-field op-num-row"><label>小数桁<input id="opdDecimals" type="number" min="0" max="4" value="${x.decimals==null?'':esc(x.decimals)}"></label>`
      +`<label>最小値<input id="opdMin" type="number" step="any" value="${x.min==null?'':esc(x.min)}"></label>`
      +`<label>最大値<input id="opdMax" type="number" step="any" value="${x.max==null?'':esc(x.max)}"></label>`
      +`<label>単位<input id="opdUnit" type="text" value="${esc(x.unit||'')}"></label></div>`
      /* **候補に無い現在値を捨てない**（§9.204と同じ罠）。値をまだ1つも
         登録していない選択肢名は`choiceNames`に載らないので、そのまま
         並べると`select.value`が空になり、**その場で値を足す口が使えない**
         （実際に踏んだ）。参照している名前は必ず候補へ入れる。 */
      +`<div class="mm-field"><label>選択肢<select id="opdChoice"${isChoice?'':' disabled'}>`
      +['<option value=""></option>']
        .concat(opState.choiceNames.map(n=>opt(n,x.choice)))
        .concat(x.choice&&!opState.choiceNames.includes(x.choice)
          ?[`<option value="${esc(x.choice)}" selected>${esc(x.choice)}（値が未登録）</option>`]:[])
        .join('')
      +`</select></label>`
      +(isChoice?`<div class="op-choice-box">`
        +`<div class="op-choice-vals">${vals.length?vals.map(v=>`<span class="op-chip">${esc(v)}</span>`).join('')
          :'<em class="mm-empty-inline">この選択肢にはまだ値がありません</em>'}</div>`
        +`<div class="op-choice-add"><input id="opdNewChoiceValue" type="text" placeholder="値を足す（例: 茶）">`
        +`<button type="button" id="opdAddChoiceValue" class="ghost">値を足す</button></div>`
        +`<small class="op-choice-use">${users.length?`この選択肢を使っている項目: ${esc(users.join('、'))}`
          :'この選択肢を使っている項目はまだありません'}</small>`
        +`</div>`:`<small class="mm-empty-inline">型が「選択」のときだけ使います</small>`)
      +`</div>`)
   +`<div class="mm-field op-num-row"><label>列幅<select id="opdSpan">`
   +opState.spans.map(v=>`<option value="${v}"${opSpanOf(x)===v?' selected':''}>${v}列</option>`).join('')
   +`</select></label>`
   +`<label>置き場<select id="opdPlace">`+opState.places.map(p=>opt(p,x.place||'準備')).join('')+`</select></label>`
   +`<label class="op-check"><input id="opdRequired" type="checkbox"${x.required?' checked':''}>必須</label>`
   +`<label class="op-check"><input id="opdEnabled" type="checkbox"${x.enabled===false?'':' checked'}>出す</label></div>`
   +`<div class="mm-field"><label>群<input id="opdGroup" type="text" value="${esc(x.group||'その他')}"></label></div>`
   +`<div class="mm-field"><label>開く条件（畳んだ群を自動で開く測定項目。カンマ区切り）`
   +`<input id="opdShowWhen" type="text" value="${esc((x.showWhen||[]).join(','))}"`
   +` title="例: 板幅,ラテラルボー。空欄なら畳んだままです"></label></div>`
   +`<div class="op-detail-actions"><button type="button" id="opdSave">この項目を保存</button>`
   +(x.builtin?`<span class="mm-empty-inline">画面の欄は消せません（「出す」を外すと隠れます）</span>`
     :`<button type="button" id="opdDelete" class="danger ghost">削除</button>`)+`</div>`;
 }
 function renderOpItem(){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  const eqs=(equipmentMasterState.items||[]).map(e=>e.name).filter(Boolean);
  form.innerHTML=`<div class="op-bar">`
   +`<label class="op-bar-eq">設備<select id="opEqPick">`
   +`<option value="">すべての登録を見る</option>`
   +eqs.map(n=>`<option value="${esc(n)}"${opState.equipment===n?' selected':''}>${esc(n)}</option>`).join('')
   +`</select></label>`
   +`<span class="op-bar-note">掴んで動かすと<b>並び</b>が決まり、<b>帯より下</b>がその群になります。`
   +`置き場をまたげば「準備」と「入力内容」も入れ替わります。</span>`
   +`<button type="button" id="opAddItem" class="ghost">項目を追加</button>`
   +`<button type="button" id="opAddGroup" class="ghost">群を追加</button>`
   +`<span class="op-bar-state" id="opLayoutState"></span></div>`;
  list.innerHTML=`<div class="op-edit">`
   +`<div class="op-boards">`+opState.places.map(opBoardHtml).join('')+`</div>`
   +`<aside class="op-detail" id="opDetail">${opDetailHtml()}</aside></div>`;
  bindOpItem();
 }
 function opSay(text,bad){
  const el=$('#opLayoutState');if(!el)return;
  el.textContent=text||'';el.classList.toggle('is-bad',!!bad);
 }
 /* 画面に出ている順をそのままマスタへ書く。**帯より下がその群**なので、
    並びと群を1回の保存で決められる（§9.216 ④）。 */
 function opCollectLayout(){
  const rows=[];
  document.querySelectorAll('#masterMaintList .op-board-grid').forEach(grid=>{
   const place=grid.dataset.opPlace||'準備';
   let group='その他',fold=false,showWhen=[];
   [...grid.children].forEach(el=>{
    if(el.dataset.opBand!==undefined){
     group=el.dataset.opBand;
     const btn=el.querySelector('[data-op-fold]');
     fold=btn?btn.getAttribute('aria-pressed')==='true':false;
     const g=opState.items.find(x=>(x.group||'その他')===group&&(x.place||'準備')===place);
     showWhen=g?(g.showWhen||[]):[];
     return;
    }
    const x=opItemById(el.dataset.opId);
    if(!x)return;
    rows.push({id:x.id,group,place,span:opSpanOf(x),required:!!x.required,
               enabled:x.enabled!==false,fold,showWhen});
   });
  });
  return rows;
 }
 async function opSaveLayout(){
  if(opState.busy)return;
  const rows=opCollectLayout();
  if(!rows.length)return;
  const uid=requireMaintUser();if(uid===null)return;
  opState.busy=true;opSay('保存しています…');
  try{
   await api('/api/operation-item-master/layout',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({items:rows,user_id:uid})});
   /* 覚えを捨てて取り直す——保存の結果（表示順の振り直し）を画面へ戻す。 */
   await loadOpItemMaint(true);
   opSay('保存しました');
   if(window.WL&&WL.opData)WL.opData.forget();
  }catch(e){opSay('保存できませんでした: '+e.message,true)}
  finally{opState.busy=false}
 }
 function bindOpItem(){
  const pick=$('#opEqPick');
  if(pick)pick.onchange=()=>{opState.equipment=pick.value;loadOpItemMaint(true)};
  const add=$('#opAddItem');
  if(add)add.onclick=()=>opCreateItem();
  const addG=$('#opAddGroup');
  if(addG)addG.onclick=()=>opCreateGroup();
  document.querySelectorAll('#masterMaintList .op-tile').forEach(t=>{
   t.onclick=()=>{opState.picked=t.dataset.opId;renderOpItem()};
   t.ondragstart=e=>{
    opState.drag=t.dataset.opId;t.classList.add('is-dragging');
    try{e.dataTransfer.setData('text/plain',t.dataset.opId);e.dataTransfer.effectAllowed='move'}catch(_){}
   };
   t.ondragend=()=>{opState.drag=null;t.classList.remove('is-dragging');opClearMark()};
  });
  document.querySelectorAll('#masterMaintList .op-board-grid').forEach(grid=>{
   grid.ondragover=e=>{
    if(!opState.drag)return;
    e.preventDefault();
    opMark(grid,opDropAt(grid,e));
   };
   grid.ondrop=e=>{
    if(!opState.drag)return;
    e.preventDefault();
    const at=opDropAt(grid,e);
    const el=document.querySelector(`#masterMaintList .op-tile[data-op-id="${CSS.escape(opState.drag)}"]`);
    if(el){at?grid.insertBefore(el,at):grid.appendChild(el)}
    opClearMark();
    opSaveLayout();
   };
  });
  document.querySelectorAll('#masterMaintList [data-op-rename]').forEach(b=>{
   b.onclick=async e=>{
    e.stopPropagation();
    const now=b.dataset.opRename,place=b.dataset.opPlace;
    const next=prompt('群の名前',now);
    if(next===null)return;
    const name=String(next).trim();
    if(!name||name===now)return;
    await opRenameGroup(place,now,name);
   };
  });
  document.querySelectorAll('#masterMaintList [data-op-fold]').forEach(b=>{
   b.onclick=async e=>{
    e.stopPropagation();
    const uid=requireMaintUser();if(uid===null)return;
    const on=b.getAttribute('aria-pressed')==='true';
    const place=b.dataset.opPlace,group=b.dataset.opFold;
    const g=opState.items.find(x=>(x.place||'準備')===place&&(x.group||'その他')===group);
    try{
     await opSyncGroupFlags(place,group,g?(g.showWhen||[]):[],!on,uid);
     await loadOpItemMaint(true);
     opSay(on?'この群は開いたままにしました':'この群は畳んで出します');
     if(window.WL&&WL.opData)WL.opData.forget();
    }catch(err){opSay('保存できませんでした: '+err.message,true)}
   };
  });
  bindOpDetail();
 }
 /* 落とす場所は**掴んでいる列の中で、いちばん近い境目**。帯もそのまま
    位置として扱う（帯より下がその群になるので、帯の前後で群が変わる）。 */
 function opDropAt(grid,e){
  const kids=[...grid.children].filter(el=>el!==document.querySelector('.op-tile.is-dragging'));
  let best=null,bestD=Infinity;
  kids.forEach(el=>{
   const r=el.getBoundingClientRect();
   const d=Math.hypot(e.clientX-r.left,e.clientY-(r.top+r.height/2));
   if(d<bestD){bestD=d;best=el}
  });
  if(!best)return null;
  const r=best.getBoundingClientRect();
  return (e.clientX>r.left+r.width/2)?best.nextElementSibling:best;
 }
 function opMark(grid,at){
  opClearMark();
  const m=document.createElement('div');
  m.className='op-drop-mark';m.dataset.opMark='1';
  at?grid.insertBefore(m,at):grid.appendChild(m);
 }
 function opClearMark(){document.querySelectorAll('[data-op-mark]').forEach(x=>x.remove())}
 async function opRenameGroup(place,from,to){
  const uid=requireMaintUser();if(uid===null)return;
  const rows=opCollectLayout().map(r=>(r.place===place&&r.group===from)?{...r,group:to}:r);
  try{
   await api('/api/operation-item-master/layout',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({items:rows,user_id:uid})});
   await loadOpItemMaint(true);opSay('群の名前を変えました');
  }catch(e){opSay('名前を変えられませんでした: '+e.message,true)}
 }
 async function opCreateGroup(){
  const name=prompt('新しい群の名前（この名前の見出しが測定画面に出ます）','新しい群');
  if(name===null)return;
  const n=String(name).trim();if(!n)return;
  await opCreateItem({group:n,name:n+' 1'});
 }
 async function opCreateItem(seed){
  const uid=requireMaintUser();if(uid===null)return;
  const base=seed||{};
  const name=base.name||prompt('項目名（測定画面に出る名前で、記録の鍵にもなります）','新しい項目');
  if(name===null)return;
  const nm=String(name).trim();if(!nm)return;
  try{
   const r=await api('/api/operation-item-master',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({equipment:opState.equipment||'*',group:base.group||'その他',
       name:nm,type:'文字',place:'準備',span:2,user_id:uid})});
   opState.picked=r.id;
   await loadOpItemMaint(true);
   opSay('項目を追加しました');
   if(window.WL&&WL.opData)WL.opData.forget();
  }catch(e){opSay('追加できませんでした: '+e.message,true)}
 }
 function bindOpDetail(){
  const save=$('#opdSave');
  if(save)save.onclick=()=>opSaveItem();
  const del=$('#opdDelete');
  if(del)del.onclick=()=>opDeleteItem();
  const type=$('#opdType');
  if(type)type.onchange=()=>{
   const x=opItemById(opState.picked);if(!x)return;
   x.type=type.value;                       // 「選択」に切り替えた瞬間に選択肢の欄を出す
   const box=$('#opDetail');if(box){box.innerHTML=opDetailHtml();bindOpDetail()}
  };
  const addV=$('#opdAddChoiceValue');
  if(addV)addV.onclick=()=>opAddChoiceValue();
 }
 function opDetailValues(){
  const v=id=>{const el=$('#'+id);return el?el.value:undefined};
  const c=id=>{const el=$('#'+id);return el?!!el.checked:undefined};
  const num=s=>(s===''||s===undefined||s===null)?null:Number(s);
  return {equipment:v('opdEquipment'),name:v('opdName'),type:v('opdType'),
          decimals:num(v('opdDecimals')),min:num(v('opdMin')),max:num(v('opdMax')),
          unit:v('opdUnit'),choice:v('opdChoice'),group:v('opdGroup'),
          span:num(v('opdSpan')),place:v('opdPlace'),
          required:c('opdRequired'),enabled:c('opdEnabled'),
          showWhen:String(v('opdShowWhen')||'').split(',').map(s=>s.trim()).filter(Boolean)};
 }
 async function opSaveItem(){
  const x=opItemById(opState.picked);if(!x)return;
  const uid=requireMaintUser();if(uid===null)return;
  const d=opDetailValues();
  /* 組み込みの欄は名前も型も画面のものなので送らない（送っても効かない
     欄を作らない・§CLAUDE 4）。 */
  const body={id:x.id,user_id:uid,
    equipment:d.equipment||'*',group:d.group||'その他',
    name:x.builtin?x.name:(d.name||x.name),
    type:x.builtin?x.type:(d.type||'文字'),
    decimals:x.builtin?null:d.decimals,min:x.builtin?null:d.min,max:x.builtin?null:d.max,
    unit:x.builtin?'':(d.unit||''),choice:x.builtin?'':(d.choice||''),
    span:d.span,place:d.place,required:d.required,enabled:d.enabled,
    /* 「開く条件」と「畳む」は**群のもの**。1行だけに書くと、同じ群の中で
       食い違う（`form_for_equipment`は「1つでも畳むと言えば畳む」で読むので
       消したはずの条件が残る）。群ぜんぶへ同じ値を書く。 */
    showWhen:d.showWhen,fold:!!(d.showWhen||[]).length||!!x.fold};
  try{
   await api('/api/operation-item-master/update',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   await opSyncGroupFlags(d.place||x.place,d.group||x.group,d.showWhen,body.fold,uid);
   await loadOpItemMaint(true);
   opSay('保存しました');
   if(window.WL&&WL.opData)WL.opData.forget();
  }catch(e){opSay('保存できませんでした: '+e.message,true)}
 }
 /* 群のふるまい（畳む・開く条件）は**群の全部の行へ同じ値**を書く。
    `form_for_equipment`は「1つでも畳むと言えば畳む」で読むので、1行だけ
    直すと消したはずの条件が残る（同じ設定が2箇所にある状態になる）。

    **`layout`で代用しないこと。** あちらは行の中身をまるごと書くので、
    直前に1件だけ更新した内容（列幅など）を**手元の古い写しで上書き
    してしまう**——「列幅を変えても元に戻る」として実際に踏んだ。
    専用の口は2列だけ触る。 */
 async function opSyncGroupFlags(place,group,showWhen,fold,uid){
  await api('/api/operation-item-master/group',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({place,group,fold:!!fold,showWhen:showWhen||[],user_id:uid})});
 }
 async function opDeleteItem(){
  const x=opItemById(opState.picked);if(!x||x.builtin)return;
  const uid=requireMaintUser();if(uid===null)return;
  if(!(await confirmModal(`「${x.name}」を削除しますか？\n記録済みの値は測定データの中に残りますが、入力欄は出なくなります。`)))return;
  try{
   await api('/api/operation-item-master/delete',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({id:x.id,user_id:uid})});
   opState.picked=null;
   await loadOpItemMaint(true);
   opSay('削除しました');
   if(window.WL&&WL.opData)WL.opData.forget();
  }catch(e){opSay('削除できませんでした: '+e.message,true)}
 }
 /* 選択肢の値を**その場で足す**（§9.216 ④）。項目を作る手を止めて別の
    タブへ行かせないのが、この画面のいちばんの値打ち。 */
 async function opAddChoiceValue(){
  const x=opItemById(opState.picked);if(!x)return;
  const name=String(($('#opdChoice')||{}).value||'').trim();
  const val=String(($('#opdNewChoiceValue')||{}).value||'').trim();
  if(!name){opSay('先に選択肢を選ぶか、名前を入力してください',true);return}
  if(!val){opSay('足す値を入力してください',true);return}
  const uid=requireMaintUser();if(uid===null)return;
  try{
   await api('/api/operation-choice-master',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({name,value:val,user_id:uid})});
   await loadOpItemMaint(true);
   opSay(`「${name}」に「${val}」を足しました`);
   if(window.WL&&WL.opData)WL.opData.forget();
  }catch(e){opSay('足せませんでした: '+e.message,true)}
 }
 async function loadOpItemMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.classList.remove('mm-form-compact');
  if(typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){}}
  if(!list.querySelector('.op-edit'))list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const q=opState.equipment?('?equipment='+encodeURIComponent(opState.equipment)):'';
   const [it,ch]=await Promise.all([
     api('/api/operation-item-master'+q),
     api('/api/operation-choice-master')]);
   opState.items=(it.items||[]).map(x=>({...x}));
   opState.types=it.types||opState.types;
   opState.places=it.places||opState.places;
   opState.spans=it.spans||opState.spans;
   opState.gridCols=it.gridCols||opState.gridCols;
   opState.choiceNames=ch.names||[];
   opState.choices=ch.items||[];
   opState.usage=ch.usage||it.choiceUsage||{};
   if(opState.picked&&!opItemById(opState.picked))opState.picked=null;
   renderOpItem();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }

 // capture段リスナーがstopImmediatePropagation()で先に処理を完結させるため
 // ボタン側のonclickは常に発火しない到達不能コードだった(削除済み)。
 document.addEventListener('click',e=>{const t=e.target.closest('#openMasterMaint');if(!t)return;e.preventDefault();e.stopImmediatePropagation();openMasterMaint()},true);
 /* 他ビューへ移るときの後始末は、各ビューの「開くときに他を閉じる」ブロックが
    window.exitMasterMaint()を呼ぶ方式にしてある(docs/ARCHITECTURE.mdの
    「画面の開き方・閉じ方の約束」。records-store.js / report-dashboard.js /
    calendar-view.js / schedule-view.js の各openXxx)。
    以前はここでサイドバーのクリックをcaptureで拾って閉じていたが、
    records-store.jsが先に読み込まれ、[data-open-records]/#homeDraftsの
    captureリスナーでstopImmediatePropagation()しているため、データ一覧へ
    移動したときだけこのリスナーが呼ばれず、マスタ管理のパネルが画面下部に
    残ったまま重なる不具合になっていた(クリックの横取りに依存する作りは
    読み込み順序に左右されて壊れるので使わない)。 */
 // 一覧(DB)切替でも閉じる(report-dashboard.jsのexitReportViewと同じ考え方)。
 document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  // 編集モーダルが開いていればそちらだけ閉じる(画面自体は開いたまま)。
  if($('#maintEditorModal')&&!$('#maintEditorModal').hidden){closeMaintEditor();return}
 },true);
})();
