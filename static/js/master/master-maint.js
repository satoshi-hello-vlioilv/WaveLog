"use strict";
/* master-maint.js: マスタ管理画面の盤（統合パネル・編集モーダル・汎用CRUD）
   ============================================================
   §9.324 R3 で「定義／盤／専用画面」に分けた。分け方:
     master-defs.js    MASTER_DEFS / MASTER_GROUPS（何のマスタがあるか）
     master-maint.js   この盤（状態・ナビ・入力支援・編集モーダル・一覧・submit/delete）
     master-report.js  帳票ブロックの見本と帳票レイアウトマスタ
     master-data.js    データと接続・作業スケジュール・管理の専用画面
     master-opdata.js  操業データ項目・選択肢・記録した値の配置の専用画面
   ファイル間の受け渡しは **`WL.mm`** の1つだけ（素の`window.*`を増やさない）。
   専用画面は `WL.mm.registerSpecial(key,{load,onEditorClose})` で名乗り、
   盤は `WL.mm.special` の登録簿から引く——画面を1つ足しても盤の`if`を
   足さなくてよい。読み込み順は backend/routes/core.py の JS_FILES
   （master-defs.js → master-maint.js → 専用画面の3本）。
   ============================================================ */
(function(){
 WL.mm=WL.mm||{};
 /* 専用画面の登録簿（§9.324 R3）。`load(force)`＝その画面を描く／
    `onEditorClose()`＝汎用の編集モーダルを閉じたときの描き直し（任意）。 */
 WL.mm.special=WL.mm.special||{};
 WL.mm.registerSpecial=(key,handlers)=>{WL.mm.special[key]=handlers};
 const MASTER_DEFS=WL.mm.MASTER_DEFS,MASTER_GROUPS=WL.mm.MASTER_GROUPS;
 let maintState={defKey:MASTER_DEFS[0].key,items:[],editing:null,query:'',meta:{},loadGen:0};
 /* ---------- 専用タブを持たないマスタ（§9.249 ②） ----------
    タブの一覧は**固定のMASTER_DEFSと、サーバーが答える表から作った分**の
    2本立て。**どちらも同じ`def`の形**にしてあるので、一覧・編集モーダル・
    削除・検索の道具は1つも書き足していない（§9.164「同じ道具を使い回す」）。
    ここから先は`allDefs()`を見ること——`MASTER_DEFS`を直に見ると、
    足したタブがそこだけ見えない状態が作れる。 */
 let rawDefs=[];
 /* ---------- マスタ編集の段（§9.322、利用者の指示） ----------
    「アクセス権限マスタの管理カテゴリに『マスタ編集』を追加してください、
      非表示・閲覧のみ・部分的編集可・編集可のパターンが欲しいです」

    **判定はサーバーが答える**（§9.163）——どのタブが「管理のマスタ」かも
    上限の掛け算も`/api/access-mode`が名前で返すので、ここでは受け取った
    答えを`def.readOnly`という**既にある1つのレバー**へ翻訳するだけ。
    そうすると上のフォーム・行の「編集/削除」・行クリックの3箇所が
    今までどおり同じ印を見て閉じる（新しい閉じ方を作らない）。
    **書けないだけで、見えるものは減らさない**——タブごと消すと、なぜ
    出てこないのかが画面から読めなくなる（消えるのは「非表示」のときの
    マスタ管理そのものだけ・`access-mode.js`）。 */
 function masterEditLevel(){
  const a=window.accessMode||{};
  return a.masterEdit||'編集可';
 }
 function masterDefWritable(def){
  const a=window.accessMode||{};
  /* **書き先が段に載っていないタブは対象外**（`masterEditExempt`）——接続状況の
     切断は区分（§9.272）が、データ引継ぎは測定データの側が決める。ここへ
     混ぜると、帯が「読み取り専用」と名乗るのに実際は動く（§CLAUDE 6）。 */
  if(def&&def.masterEditExempt)return true;
  if(a.canEditFieldMaster===false&&a.canEditAdminMaster===false)return false;
  const admin=Array.isArray(a.adminMasters)&&a.adminMasters.indexOf(def.key)>=0;
  return admin?a.canEditAdminMaster!==false:a.canEditFieldMaster!==false;
 }
 /* **元の定義は書き換えない**（写しに印を足す）——書き換えると、段が上がった
    ときに`readOnly`が残ったままになる（`MASTER_DEFS`はモジュールの寿命で
    生き続ける）。読み取り専用が元から立っている定義（テーブル生データ）は
    そのまま。 */
 function withMasterEditGate(def){
  if(!def||def.readOnly)return def;
  return masterDefWritable(def)?def:Object.assign({},def,{readOnly:true,readOnlyByLevel:true});
 }
 function allDefs(){return (rawDefs.length?MASTER_DEFS.concat(rawDefs):MASTER_DEFS).map(withMasterEditGate)}
 function currentDef(){return allDefs().find(d=>d.key===maintState.defKey)||withMasterEditGate(MASTER_DEFS[0])}
 // scheduleモードは作業予定(schedule Blueprint)以外のマスタへ書込できない
 // (backend/access_mode.pyの_WRITE_ALLOWED_MODES)。マスタ管理モーダル自体は
 // 開けるようにしつつ(設備停止マスタはscheduleモードでのみ書込可能なため)、
 // タブは自分のBlueprintで書けるものだけに絞る。
 function maintDefVisible(def){
  /* **他のタブへ統合した定義はナビに出さない**（§9.397）。設備停止の分類と
     内訳は「設備停止マスタ」の1枚へ畳んだが、**定義そのものは残す**
     ——APIの綴りと`tests/test_crudroutes.py`の見張りがここを読む。 */
  if(def.navHidden)return false;
  const mode=(window.accessMode&&window.accessMode.mode)||'edit';
  if(mode!=='schedule')return true;
  // 読み取り専用のタブ(テーブル生データ)は書込権限と無関係なのでどのモードでも
  // 出す。旧「マスタ一覧」ナビが全モードで見られた挙動を統合後も保つため(ARCHITECTURE.md「マスタ管理の画面形態」)。
  if(def.readOnly)return true;
  return !!(def.endpoint&&def.endpoint.indexOf('/api/schedule/')===0);
 }
 function firstVisibleDefKey(){const d=allDefs().find(maintDefVisible);return d?d.key:MASTER_DEFS[0].key}
 /* **そのタブをいま開けるか**（§9.445）。行き先を出す側（「表示」の節・他の
    画面の「〜で決める」）が、押す前に確かめるための口。判定は
    `maintDefVisible()`の1箇所のまま——問い合わせ口を足すだけで、規則を写さない
    （写すと、モードの見分けが2箇所になる）。 */
 function maintTabOpenable(key){
  const def=allDefs().find(d=>d.key===key);
  return !!(def&&maintDefVisible(def));
 }
 /* マスタ種別のグループ(情報アーキテクチャ): 13種を平坦に並べると
    「どれが何の設定か」を毎回読んで探すことになるため、利用者の頭の中の
    分類(誰が・何を使うか / 作業スケジュールの設定 / システム寄りの設定)で
    3つに束ねる。1グループ5件前後=一度に見渡せる粒度(Miller)。 */
 let mmNavFitting=false,mmNavRO=null;
 let mmNavFitPending=false,mmNavSizeMO=null;
 function fitMaintNav(){
  const nav=$('#masterMaintNav');
  if(!nav)return;
  /* **測っている最中に頼まれたら、あとでもう一度測る**（§9.264）。
     以前は`return`で捨てていたため、**群を開いた直後の測り直しが黙って
     落ちて**、長い名前が切れたままになっていた（`列レイアウト個人設定`が
     10px切れる。畳んだ群の中は行を作らないので、開くまで測れない）。 */
  if(mmNavFitting){mmNavFitPending=true;return}
  const body=nav.closest('.mm-body');
  if(!body)return;
  mmNavFitting=true;
  requestAnimationFrame(()=>{
   try{
    /* 既定の幅へ戻して測る（前回広げたぶんを持ち越さない）。 */
    body.style.removeProperty('--mm-nav-w');
    const base=nav.getBoundingClientRect().width;
    if(!(base>0))return;
    let need=0;
    nav.querySelectorAll('button[data-master]').forEach(b=>{
     const l=b.querySelector('.mm-nav-label');
     if(!l)return;
     const over=l.scrollWidth-l.clientWidth;
     if(over>need)need=over;
    });
    /* 束の見出し（件数つき）も切らさない。 */
    nav.querySelectorAll('.mm-nav-group-name').forEach(l=>{
     const over=l.scrollWidth-l.clientWidth;
     if(over>need)need=over;
    });
    if(need>0)body.style.setProperty('--mm-nav-w',Math.ceil(base+need+1)+'px');
   }finally{
    /* **見張りが自分の書き換えで回らないように**、1フレーム置いて解く。 */
    requestAnimationFrame(()=>{
     mmNavFitting=false;
     if(mmNavFitPending){mmNavFitPending=false;fitMaintNav()}
    });
   }
  });
  /* **表示サイズを変えたら測り直す**（§9.264。§9.130と同じ理由）——幅は
     「そのときの文字サイズで測った結果」なので、文字だけが1.1倍になると
     器はそのままで名前が切れる（実測: 中で10px切れていた）。器の幅は
     変わらないので`ResizeObserver`では気づけない。 */
  if(!mmNavSizeMO&&typeof MutationObserver==='function'){
   mmNavSizeMO=new MutationObserver(()=>fitMaintNav());
   mmNavSizeMO.observe(document.documentElement,{attributes:true,attributeFilter:['data-ui-size']});
  }
  if(!mmNavRO&&typeof ResizeObserver==='function'){
   /* 表示サイズを変えた・窓の幅が変わった、で測り直す（`--ui-scale`は
      文字だけを伸ばすので、同じ器でも切れ方が変わる・§9.130）。 */
   mmNavRO=new ResizeObserver(()=>{if(!mmNavFitting)fitMaintNav()});
   mmNavRO.observe(nav);
  }
 }
 const MM_NAVFOLD_KEY='MasterNavFoldV1';
 const MM_NAVFOLD_DEFAULT=['internal','retired'];
 function mmNavFolded(){
  try{
   const raw=localStorage.getItem(MM_NAVFOLD_KEY);
   if(raw===null)return new Set(MM_NAVFOLD_DEFAULT);
   const v=JSON.parse(raw);
   return new Set(Array.isArray(v)?v:[]);
  }catch(e){return new Set(MM_NAVFOLD_DEFAULT)}
 }
 function mmSetNavFolded(set){
  try{localStorage.setItem(MM_NAVFOLD_KEY,JSON.stringify([...set]))}catch(e){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',e)}
 }
 function renderMaintNav(){
  const nav=$('#masterMaintNav');if(!nav)return;
  const visible=allDefs().filter(maintDefVisible);
  const folded=mmNavFolded();
  /* **いま開いているタブの群は必ず開く**（§CLAUDE 4）。畳んだ群の中の
     タブを選んだままにすると、「今どこにいるか」が画面から消える。 */
  const cur=visible.find(d=>d.key===maintState.defKey);
  if(cur)folded.delete(cur.group||'system');
  const html=MASTER_GROUPS.map(g=>{
   const defs=visible.filter(d=>(d.group||'system')===g.key);
   if(!defs.length)return '';
   /* 群の中は`items`の順（決める順）。**載っていないものは末尾**——
      足し忘れても消えないようにする（並びが決まらないだけ）。 */
   if(g.items&&g.items.length){
    const rank=k=>{const i=g.items.indexOf(k);return i<0?g.items.length:i};
    defs.sort((a,b)=>rank(a.key)-rank(b.key));
   }
   const off=folded.has(g.key);
   /* **見出しは`<button>`にしない**——`10-roles.css`の`.mm-nav button`が
      「行き先の的」の寸法（`--ctl-h`・`--fs`）を配るので、見出しまで
      行き先と同じ大きさになる（実測: 文字が14pxになり「作業スケジュール」が
      入らなくなった）。役割が違うものへ同じ役割の寸法を配らない。 */
   return `<div class="mm-nav-group${off?' is-folded':''}" data-nav-group="${esc(g.key)}">`
    +`<div class="mm-nav-group-label" data-nav-fold="${esc(g.key)}" role="button" tabindex="0"`
    +` aria-expanded="${off?'false':'true'}" title="${esc(g.hint)}｜押すと${off?'開きます':'畳みます'}">`
    +`<span class="mm-nav-caret" aria-hidden="true">${off?'▸':'▾'}</span>`
    +`<span class="mm-nav-group-name">${esc(g.label)}</span>`
    +`<span class="mm-nav-count">${defs.length}</span></div>`
    +(off?'':defs.map(d=>`<button type="button" data-master="${d.key}" title="${esc(d.label)}"><span class="mm-nav-ico" aria-hidden="true">${esc(d.icon)}</span><span class="mm-nav-label">${esc(d.label)}</span></button>`).join(''))
    +'</div>';
  }).join('');
  nav.innerHTML=html;
  fitMaintNav();
  nav.querySelectorAll('[data-nav-fold]').forEach(b=>{
   const toggle=()=>{
    const k=b.dataset.navFold,now=mmNavFolded();
    if(now.has(k))now.delete(k);else now.add(k);
    mmSetNavFolded(now);renderMaintNav();
   };
   b.onclick=toggle;
   b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle()}};
  });
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
    <!-- 上部の操作は3つだけ（§9.266、利用者の指示「アイコンなども活用し…
         1行に収める」）。**アイコンだけにしない**——何の欄かはツールチップでは
         読めない（§4）ので、更新者IDは印と短い名前、絞り込みは虫めがねと
         短い誘い文句、再読込は印とaria-labelにする。
         **この中にバッククォートを書かないこと**（§9.211 ③。テンプレート
         リテラルがそこで閉じ、以降がJSとして解釈されて画面が組み上がらない）。 -->
    <button type="button" id="masterUserId" class="mm-head-user"
     title="この端末のログインIDです。マスタを更新した人として記録します（書き換えられません）。押すと「接続状況」を開きます">
     <span class="mm-head-ico" aria-hidden="true">👤</span>
     <b id="masterUserName">—</b></button>
    <div class="mm-search"><span class="mm-search-icon" aria-hidden="true">🔍</span><input id="masterMaintSearch" type="search" placeholder="絞り込み" autocomplete="off"></div>
    ${hintBadgeHtml()}
    <button id="reloadMasterMaint" type="button" class="mm-btn-ghost mm-head-icobtn"
     title="マスタを読み直します" aria-label="再読込"><span aria-hidden="true">↻</span></button>
   </div>
   <div class="mm-body">
    <nav class="mm-nav" id="masterMaintNav" aria-label="マスタ種別"></nav>
    <section class="mm-main">
     <!-- 見出しだけを残す。絞り込みと再読込は**操作**なのでヘッダーの
          操作列(#mmHead → #headerViewBar)が持つ(§9.100)。ここに残すと、
          この画面だけ操作の置き場が2段になる。 -->
     <div class="mm-toolbar">
      <div class="mm-toolbar-left"><b id="masterMaintTitle">オペレータ</b><span class="mm-count" id="masterMaintCount"></span>
       <!-- マスタ編集の段（§9.322）。**書けないときだけ出す**——器は常に
            置いておき、中身の出し入れだけで済ませる（出入りで見出しの行が
            跳ねないように・§9.227 ②）。専用の画面（共通設定・データ接続など）は
            自前で欄を組み立てるので、断るのはサーバーだけ——**先に読める形で
            言う**のがこの帯の役目（§4）。 -->
       <span class="mm-mode-chip" id="masterMaintLevel" hidden></span></div>
      <!-- 束ねた見出しの開閉（§9.241 ①）。**群を持つマスタのときだけ**中身が
           入る（renderMaintList が出し入れする。押せるのに何も起きない
           ボタンを置かない・§CLAUDE 4）。 -->
      <div class="mm-fold" id="masterMaintFold" hidden></div>
     </div>
     <form class="mm-form" id="masterMaintForm"></form>
     <div class="mm-list-wrap"><div class="mm-list" id="masterMaintList"></div></div>
    </section>
   </div>
  </div>`;
  const grid=$('#grid');grid?.parentNode?.insertBefore(panel,grid);
  /* ---------- 更新者IDは名乗るだけ（§9.276 ③、利用者の指示） ----------
     「ユーザーIDを表示する上部のメニュー部分は、IDを書き換えられないように
      してください。また、ボタン化して接続状況確認と配線してください」

     ここは**この端末のログインID**（`/api/whoami`＝`current_login_id()`）で、
     アクセス権限マスタの照合・監査列・フィルタの持ち主が見ている値。
     打ち込めると**他人の名前で更新できてしまい、記録の意味が無くなる**。
     押したときの行き先は「接続状況」——いま誰がどの端末で繋いでいるかを
     見る画面で、自分の名乗りを確かめる場所でもある（§9.272）。 */
  paintMaintUser();
  /* 説明の量（§9.274・§9.276 ②）。**選んだらその場で描き直す**——次に開くまで
     変わらないと、押しても何も起きないように見える（§4）。描き直しは
     `refreshMaintScreen()`の1箇所（専用の画面を潰さない）。
     **「出さない」だけはCSSでも効かせる**（`html[data-hint]`）——描き直しの
     効かない場面でも消えるようにするため。 */
  document.documentElement.setAttribute('data-hint',hintLevel());
  const hb=$('#mmHintBadge');
  if(hb)hb.onclick=()=>{if(mmHintMenu)closeHintMenu();else openHintMenu(hb)};
  $('#reloadMasterMaint').onclick=()=>loadMaint(true);
  const search=$('#masterMaintSearch');if(search){search.oninput=()=>{maintState.query=search.value;renderMaintList()}}
  renderMaintNav();
  return panel;
 }
 function exitMasterMaint(){
  if(!document.body.classList.contains('mm-mode'))return;
  /* **開いた浮きメニューは器と一緒に畳む**（§9.222 ①）——残すと、画面を
     出たあとも説明の量のメニューだけが宙に浮く。 */
  closeHintMenu();
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
  /* 操作は3つだけなので、ヘッダーの1行目へ相乗りする（§9.266）。 */
  compactToolbar:true,
  header:['マスタ管理','登録内容の追加・編集・無効化（更新者IDとともに記録）'],exit:exitMasterMaint});
 function syncNav(){document.querySelectorAll('#masterMaintNav [data-master]').forEach(b=>b.classList.toggle('active',b.dataset.master===maintState.defKey))}
 /* いまの更新者IDをボタンへ書く。**IDは`/api/whoami`から後から届く**
    （§9.184と同じ罠）ので、届いていなければその場で取りに行く。 */
 function paintMaintUser(){
  const b=$('#masterUserId'),n=$('#masterUserName');
  if(!b||!n)return;
  const id=currentUserId();
  n.textContent=id||'IDが取れていません';
  b.classList.toggle('is-unknown',!id);
  b.onclick=()=>openMasterMaint('presence');
  if(!id&&typeof WL.base.fetchWhoami==='function'){
   WL.base.fetchWhoami().then(v=>{if(v){WL.base.setUserId(v);paintMaintUser()}}).catch(WL.quiet('利用者IDを取れない（この端末の共通の設定として続ける）'));
  }
 }
 /* **打ち込ませない**（§9.276 ③）。取れていないときは、無言で断らずに
    どこを見ればよいかまで言う（§4）——押せば接続状況へ行ける。 */
 function requireMaintUser(){
  const id=currentUserId();
  if(!id){
   showToast('更新者IDが分かりません',
     'この端末のログインIDを読み取れませんでした。マスタの更新は「誰が直したか」を記録するので、'
     +'IDが取れないうちは保存できません。上の👤を押すと接続状況を確認できます。',6000);
   paintMaintUser();
   return null;
  }
  return id;
 }

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

 /* ================= 入力支援(docs/decisions/9.49.md) =================
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
 /* 説明文の`**強調**`（§9.222 ⑧）。マスタの`hint`は最初から`**…**`で
    書いてあるのに、そのまま`esc()`して出していたので**画面に`**`が並んで
    いた**（実機のスクリーンショットで「**空欄＝すべての設備**」と読める）。
    **エスケープしてから印を`<b>`へ変える**——順番が逆だと、マスタへ入れた
    文字列の中のHTMLがそのまま効く。 */
 /* ---------- 説明の量は選べる（§9.274、利用者の指示） ----------
    「帳票ブロックマスタに説明書きみたいなものが出ているものがありますが、
     ON/OFF、ONも短め、通常など調整できるようにしてほしいです。文章が
     長すぎて影響が出ているものがあるので調整したいです」

    3段（`full`＝通常／`short`＝短め／`off`＝出さない）。**置き場はこの端末**
    （読み方の好みなのでPCごとに違ってよい・§9.199／§9.242 ⑥）。
    **既定は今までどおり`full`**——わざわざ選んでいない人の見え方を変えない。

    **`?`（くわしい説明）は消さない**——押したときだけ開く、場所を取らない
    入口なので、消すと「短め」にした人が全文へ辿り着けなくなる（§9.234 ①
    「消した説明は落とし先を用意する」）。だから`off`でも`?`は残す。

    **通すのは`hintHtml()`の1箇所**（§9.163）——説明を出す場所は十数箇所
    あるので、そこへ足すと**足し忘れた欄だけが長いまま残る**。 */
 const HINT_LEVEL_KEY='MasterHintLevelV1';
 const HINT_LEVELS=[
  {v:'full',label:'通常',note:'説明を全部出す'},
  {v:'short',label:'短め',note:'最初の1文だけ'},
  {v:'off',label:'出さない',note:'「?」からは読める'}];
 function hintLevel(){
  try{
   const v=localStorage.getItem(HINT_LEVEL_KEY);
   return HINT_LEVELS.some(x=>x.v===v)?v:'full';
  }catch(e){return 'full'}
 }
 function setHintLevel(v){
  try{localStorage.setItem(HINT_LEVEL_KEY,HINT_LEVELS.some(x=>x.v===v)?v:'full')}catch(e){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',e)}
  document.documentElement.setAttribute('data-hint',hintLevel());
 }
 /* 短めは**最初の1文だけ**（`。`まで）。**文の途中で切らない**——途中で
    切ると意味が反転しうる（「〜しないでください」の前半だけが残る）。
    `。`が無ければ丸ごと残す（短い注記はそのままでよい）。 */
 function hintShorten(t){
  const s=String(t||'');
  const i=s.indexOf('。');
  return (i>=0&&i+1<s.length)?s.slice(0,i+1):s;
 }
 /* 印の解き方は`WL.markup()`の1箇所（§9.286 ⑦）——エスケープしてから
    `**強調**`とバッククォート囲みを戻す。ここが持つのは**量の段**だけ。 */
 function hintHtml(t){
  const lv=hintLevel();
  if(lv==='off')return '';
  return WL.markup(lv==='short'?hintShorten(String(t||'')):String(t||''));
 }
 /* ---------- 帯ではなくポップオーバー（§9.276 ②、利用者の指示） ----------
    「このボタンは3つもエリアを使っているがそんなに頻繁に使うものでもないので、
     隣の文字サイズ切り替えUIのように、ポップオーバーメニューなど場所を
     使わない方法で切り替えできるようにしてください」

    **隣の`#uiSizeBadge`と同じ言語で揃える**（小さなボタン→選択肢を並べた
    浮きメニュー）——同じ役割のUIが画面ごとに違う形だと、押す前にどちらの
    形か思い出すことになる。**いまどれかはボタンに文字で出す**（§CLAUDE 3。
    畳んだだけで現在値が読めなくなるのでは、隠した意味が無い）。 */
 function hintBadgeHtml(){
  const cur=HINT_LEVELS.find(x=>x.v===hintLevel())||HINT_LEVELS[0];
  return `<button type="button" id="mmHintBadge" class="mm-btn-ghost mm-head-icobtn mm-hintbadge"`
   +` aria-haspopup="true" aria-expanded="false"`
   +` title="欄の下に出る説明文の量を選びます（いまは「${esc(cur.label)}」）。`
   +`「くわしい説明」（?）はどの段でも読めます">`
   +`<span class="mm-hint-ico" aria-hidden="true">💬</span><b id="mmHintLabel">${esc(cur.label)}</b></button>`;
 }
 /* 浮きメニュー。**器は`body`直下**（`#mmHead`は`overflow`を持つ器の中に
    あるので、中で開くと切られる・§9.201）。**開いた器は必ず控える**
    （§9.222 ①——控えないと外クリックもEscも閉じられず、押すたびに積み上がる）。 */
 let mmHintMenu=null;
 function closeHintMenu(){
  if(mmHintMenu){mmHintMenu.remove();mmHintMenu=null}
  document.removeEventListener('click',onHintOutside,true);
  document.removeEventListener('keydown',onHintKey,true);
  const b=$('#mmHintBadge');if(b)b.setAttribute('aria-expanded','false');
 }
 function onHintOutside(e){
  if(mmHintMenu&&!mmHintMenu.contains(e.target)&&!e.target.closest('#mmHintBadge'))closeHintMenu();
 }
 function onHintKey(e){if(WL.base.escClosesModal(e))closeHintMenu()}
 function openHintMenu(anchor){
  closeHintMenu();
  const cur=hintLevel();
  const m=document.createElement('div');
  m.className='access-mode-menu mm-hint-menu';m.id='mmHintMenu';
  m.innerHTML=HINT_LEVELS.map(x=>`<button type="button" data-hint-lv="${esc(x.v)}"`
    +` class="${x.v===cur?'is-current':''}"><span>${esc(x.label)}</span>`
    +`<small>${esc(x.note||'')}</small></button>`).join('');
  document.body.appendChild(m);
  mmHintMenu=m;
  m.querySelectorAll('[data-hint-lv]').forEach(b=>b.onclick=()=>{
   setHintLevel(b.dataset.hintLv);
   const lab=$('#mmHintLabel');
   const cur2=HINT_LEVELS.find(x=>x.v===hintLevel())||HINT_LEVELS[0];
   if(lab)lab.textContent=cur2.label;
   const badge=$('#mmHintBadge');
   if(badge)badge.title=`欄の下に出る説明文の量を選びます（いまは「${cur2.label}」）。`
     +`「くわしい説明」（?）はどの段でも読めます`;
   closeHintMenu();
   refreshMaintScreen();
  });
  const r=anchor.getBoundingClientRect();
  m.style.top=`${r.bottom+6}px`;
  m.style.left=`${Math.max(8,Math.min(r.left,window.innerWidth-m.offsetWidth-8))}px`;
  anchor.setAttribute('aria-expanded','true');
  requestAnimationFrame(()=>{
   document.addEventListener('click',onHintOutside,true);
   document.addEventListener('keydown',onHintKey,true);
  });
 }
 /* ---------- いま出ている画面を描き直す（§9.276 ②、利用者の報告） ----------
    「マスタを確認しているときに説明文の長さを切り替えると、マスタ表示内容が
     消えます。再読み込みすると表示されますが」

    原因は`renderMaintList()`が**汎用の一覧**（`def.cols`から見出しを組む）を
    無条件に書いていたこと——専用の画面（`special:*`）は`#masterMaintList`へ
    自前の中身を描いているので、そこへ汎用の空表を書き込むと**丸ごと消える**。
    **描き直しの入口は1つ**（§9.163）——専用の画面は`loadMaintInner()`が
    既に唯一の受け口なので、そこへ戻す（2つ目の対応表を作らない）。 */
 function refreshMaintScreen(){
  const def=currentDef();
  if(def&&def.special){loadMaintInner(false).catch(WL.quiet('専用の画面を描き直せない（前の中身が残る）'));return}
  try{renderMaintForm()}catch(e){WL.quiet.note('入力欄を描き直せない（前の欄が残る）',e)}
  try{renderMaintList()}catch(e){WL.quiet.note('一覧を描き直せない（前の一覧が残る）',e)}
 }
 /* ---------- 説明を階層にする（§9.276 ④、利用者の指示） ----------
    「説明文長すぎてわかりにくくて読みにくいので、タブやアコーディオンなど
     使ってわかりやすく階層化しながらコンパクトに表示・説明する方法も」

    常時出すのは**リード文（`hint`）だけ**で、詳しい話は`hintMore`の節へ畳む
    （`<details>`——欄の`?`と同じ言語・§9.250 ④）。**節は既定で閉じる**
    ——開いておくと畳んだ意味が無い。
    **`hintHtml()`を通す**（§9.163）ので、説明の量（通常／短め／出さない）が
    リード文へそのまま効き、`**強調**`も同じ書き方でよい。
    **「出さない」でも節は残す**——押したときだけ開く入口なので、消すと
    短くした人が全文へ辿り着けなくなる（§9.234 ①・`?`と同じ約束）。 */
 function hintSectionsHtml(def){
  const secs=(def&&def.hintMore)||[];
  if(!secs.length)return '';
  return `<div class="mm-hint-more">`+secs.map(x=>
    `<details class="mm-hint-sec"><summary>${esc(x.t)}</summary>`
    +`<div>${String(x.b||'').split('\n').map(line=>
        `<p>${esc(line).replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')}</p>`).join('')}</div></details>`
   ).join('')+`</div>`;
 }
 /* 一覧の上に出す説明。**通すのはここ1箇所**——`hint`だけを書いている
    4箇所が同じ形になるので、`hintMore`を足したマスタは自動で階層になる。
    **編集窓では節を出さない**（§CLAUDE 8「窓の説明は一覧の説明と同じに
    しない」）——窓に要るのは「いま決めることの一言」で、マスタ全体の
    説明は一覧の側が持つ。窓の中の細かい話は各欄の`?`が言う。 */
 function defHintHtml(def,text){
  const modal=text!==undefined;
  const t=modal?text:(def&&def.hint);
  const lead=t?`<p class="mm-def-hint">${hintHtml(t)}</p>`:'';
  return modal?lead:(lead+hintSectionsHtml(def));
 }
 /* **消した説明は`title`へ落とす**（§9.234 ①）。欄の説明を短くすると
    読めるようになるが、消してしまうと調べようが無くなる。`more`を持つ欄は
    見出しにマウスを当てれば全文が読める（§CLAUDE 8）。 */
 function fieldLabelHtml(f){
  const t=f.more?` title="${esc(f.label+'｜'+String(f.more).replace(/\*\*/g,''))}"`:'';
  /* ---------- 続きは畳んで置く（§9.250 ④、利用者の指示） ----------
     「タブとアコーディオンによる情報の階層化、チャンク化を取り入れて」

     以前は`?`が**マウスを乗せたときだけ**出る`title`で、触る画面では
     一度も読めなかった（説明があること自体は見えているので、
     「押しても何も起きない」に見える・§4）。押すと開く形にする。
     `title`は残す——読み方が2つあって困るものではない。 */
  return `<span${t}>${esc(f.label)}${f.required?'<i>*</i>':''}${f.key?'<em class="mm-keytag">キー</em>':''}`
   +(f.more?`<button type="button" class="mm-more" aria-expanded="false"`
     +` aria-label="${esc(f.label)}のくわしい説明" data-more="${esc(String(f.more))}">?</button>`:'')
   +`</span>`;
 }
 /* 押したら欄の下へ開く。**器へ足すのは押したときだけ**——最初から置くと、
    畳んでいても`.mm-field`の子が1つ増えて並びの計算が変わる。
    **`<label>`の中なので`preventDefault()`が要る**（押すと欄へフォーカスが
    飛んで、開いた瞬間に入力欄が選ばれる）。 */
 function bindMoreToggles(form){
  form.querySelectorAll('.mm-more').forEach(b=>{
   if(b.dataset.moreWired)return;
   b.dataset.moreWired='1';
   b.onclick=e=>{
    e.preventDefault();e.stopPropagation();
    const fld=b.closest('.mm-field');if(!fld)return;
    let body=fld.querySelector(':scope>.mm-more-body');
    if(!body){
     body=document.createElement('small');
     body.className='mm-more-body';
     body.innerHTML=hintHtml(String(b.dataset.more||''));
     fld.appendChild(body);
    }
    const on=b.getAttribute('aria-expanded')!=='true';
    b.setAttribute('aria-expanded',on?'true':'false');
    b.classList.toggle('is-on',on);
    body.hidden=!on;
   };
  });
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
  /* マスタ編集（§9.322）。**保存値と効いている段が食い違ったら両方書く**
     ——区分の上限で頭打ちになっているのに保存値だけを出すと、「編集可に
     したのに触れない」という読み方しかできなくなる（§3・§4）。 */
  if(col.format==='masterEdit'){
   const eff=col.row&&col.row.masterEditEffective;
   const stored=v.trim()||'編集可';
   return (eff&&eff!==stored)?`${stored} → ${eff}（区分の上限）`:stored;
  }
  /* 1ロットあたり標準時間(§9.114)。**未設定を「0分」に見せない**——
     空欄は「登録していない＝全体の暫定既定値を使う」であって0分ではない。 */
  if(col.format==='standardMinutes')return v.trim()===''?'120分（既定）':`${v}分`;
  /* §9.231 ①。**未設定は「未設定」と書く**——0や既定値を出すと、
     参照している項目に上限が掛かっているように読める（§4）。 */
  if(col.format==='maxLineSpeed')return v.trim()===''?'未設定':`${v} m/min`;
  // 区分(§9.85)。空欄は「まだ決めていない」であって「無い」ではないので、
  // 「—」ではなくそう書く(既存の設備は空のまま動く)。
  if(col.format==='equipmentKind')return v.trim()===''?'未設定':v;
  /* 親の値（§9.306）。**空欄は「どの親でも」と書き切る**——空のままだと
     「まだ決めていない」と読めるが、この行の意味は「すべての親で出る」（§4）。
     **親が張られていない行には何も書かない**（意味を持たない欄なので）。 */
  if(col.format==='parentValue'){
   if(!(col.row&&col.row.parent))return '';
   return v.trim()===''?'どの親でも':v.replace(/、/g,',').split(',')
     .map(x=>x.trim()).filter(Boolean).join(' / ');
  }
  /* 使える機能（§9.302）。**残る側を並べる**——保存値は「使わない機能」だが、
     一覧で知りたいのは「どこに出るか」。全部使えるのがふつうなので、そこは
     1語で済ませて（「すべて」）、外してある行だけが目に留まるようにする。
     **0個は「なし」と書き切る**（空欄にすると「まだ決めていない」と読める・§4）。 */
  /* **`check-set`の一覧は1つの書き方**（§9.392で2つ目が増えたので束ねた）。
     語彙は`meta[metaKey]`、保存値は行の`rowKey`（「使わないほう」）。 */
  const checkSetSummary=(metaKey,rowKey,noneWord)=>{
   const all=(maintState.meta&&Array.isArray(maintState.meta[metaKey]))?maintState.meta[metaKey]:[];
   if(!all.length)return '';
   const off=new Set(Array.isArray(col.row&&col.row[rowKey])?col.row[rowKey]
    :String(v).split(',').map(t=>t.trim()).filter(Boolean));
   const on=all.filter(o=>!off.has(o.key));
   return !on.length?noneWord:on.length===all.length?'すべて':on.map(o=>o.label).join(' / ');
  };
  if(col.format==='equipmentFeatures')
   return checkSetSummary('equipmentFeatures','disabledFeatures','なし（どこにも出ません）');
  /* 使う入力内容（§9.392）。**「なし」は作れない**（サーバーが断る）が、
     古いデータで全部外れていることはあり得るので言葉は用意しておく。 */
  if(col.format==='measureItems')
   return checkSetSummary('measureItems','disabledMeasureItems','なし（測定できません）');
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
  /* 内訳（サブカテゴリ）の件数（§9.389）。**0は「—」で言う**——`0`のままだと
     「0件」なのか「まだ数えていない」のか読めない（§CLAUDE 3）。 */
  if(col.format==='subCount'){
   const n=Number(v||0);
   return n>0?`${n}件`:'—';
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
  /* ---------- 段（タブ）に分ける（§9.250 ④、利用者の指示） ----------
     「スクロールレス設計をベースにSPAで構成することを軸にしたいので
      基本的に**情報量が多くなった時には**、タブとアコーディオンによる
      情報の階層化、チャンク化を取り入れてください」

     縦に積むと窓に入らない（帳票ブロックは1700×1000の窓で実測**227px**
     はみ出していた）。束はもともと「決める順番」で切ってあるので、
     **束ごとに段へ分ければ1段ぶんの高さで済む**。

     **段の見出しにいまの値を出す**（§2「思い出させない」）——開かないと
     何を決めたか分からない段は、結局全部開いて回ることになる。
     **見本（`asideHtml`）は段の外**に置くので、どの段を見ていても
     刷り上がりが見える（§CLAUDE 14「視覚導線と作業導線を一致させる」）。 */
  if(!def.groupsAsTabs){
   let prev=null;const out=[];
   groups.forEach((g,i)=>{
    if(g&&g!==prev)out.push(`<h4 class="mm-fieldgroup">${esc(g)}</h4>`);
    prev=g||prev;out.push(html[i]);
   });
   return out.join('');
  }
  const order=[],bucket=new Map();
  let prev='';
  groups.forEach((g,i)=>{
   const k=g||prev||'';
   if(!bucket.has(k)){bucket.set(k,[]);order.push(k)}
   bucket.get(k).push(i);
   prev=k;
  });
  const tabs=order.map((g,i)=>
   `<button type="button" class="mm-tab" role="tab" id="mmTab${i}" data-mmtab="${i}"`
   +` aria-selected="${i?'false':'true'}" aria-controls="mmPanel${i}" tabindex="${i?-1:0}">`
   +`<span class="mm-fieldgroup">${esc(g)}</span>`
   +`<small class="mm-tab-sum" data-mmtab-sum="${i}"></small></button>`).join('');
  /* **盤を持つ段は器いっぱいに伸ばす**（§9.254 ①）。パネルは欄を規格幅で
     並べる折り返す横並びなので、既定では中身なりの高さで止まる（それが
     正しい——欄が縦に伸びても嬉しくない）。組み立ての盤（`field-builder`）
     だけは「余った高さがそのまま作業面」なので、その段にだけ印を付ける。
     **`:has()`に頼らない**（§9.218 ②——当たらなかったときに誰も気づけない）。 */
  const panels=order.map((g,i)=>{
   const idx=bucket.get(g);
   const fill=idx.some(j=>((def.fields||[])[j]||{}).type==='field-builder');
   return `<section class="mm-tabpanel${fill?' is-fill':''}" role="tabpanel" id="mmPanel${i}"`
    +` aria-labelledby="mmTab${i}" data-mmtab="${i}"${i?' hidden':''}>`
    +`${idx.map(j=>html[j]).join('')}</section>`;
  }).join('');
  return `<div class="mm-tabbar" role="tablist">${tabs}</div>`
   +`<div class="mm-tabbody">${panels}</div>`;
 }
 /* 段の見出しに出す一言。**欄の値そのものから作る**——束ごとに文言を
    書き分けると、欄を1つ足したときに書き足す場所が増える。
    空の欄は言わない（「未設定・未設定・未設定」は何も語らない）。 */
 /* その欄が**いま出ている面に在るか**（§9.433）。段の札の一言は「畳んだ中で
    何が効いているか」を言うものなので、**伏せてある欄は数えない**——たとえば
    ショートカットの設定は作れない端末では器ごと伏せてあるのに、その名前が
    段の札に出て「この端末の名前」と読めてしまっていた（§9.391「必須に数える
    のはいま出している面の欄だけ」と同じ考え）。
    見るのは`[hidden]`だけ（`offsetParent`は`position:fixed`と未組み立ての
    両方で`null`になる・§9.346）。**段そのものの`hidden`は数えない**
    ——選ばれていない段は伏せてあるので、そこで止めないと全部空になる。 */
 function mmFieldShown(fld,panel){
  for(let el=fld;el&&el!==panel;el=el.parentElement){
   if(el.hasAttribute&&el.hasAttribute('hidden'))return false;
  }
  return true;
 }
 function mmTabSummaryText(panel){
  const parts=[];
  panel.querySelectorAll('.mm-field').forEach(fld=>{
   if(!mmFieldShown(fld,panel))return;
   /* 設定ページの欄は`data-pc-field`（§9.261で段に分けた）。**両方見る**
      ——片方だけだと、そのページの段だけ一言が空になる。 */
   const el=fld.querySelector('[data-field],[data-pc-field]');
   if(!el)return;
   /* **触れない欄は数えない**（§CLAUDE 8）——組み込みの印のような
      読み取り専用の値を並べても、決めたことは1つも増えない。 */
   if(fld.classList.contains('mm-field-ro')||el.hasAttribute('readonly'))return;
   let v=String(el.value||'').trim();
   /* 行数は**空も`0`も「中身なり」**（§9.250 ④）。「何も決めていない」と
      「既定のまま」は別のことなので、空欄として落とさず言う。 */
   if(fld.classList.contains('mm-rowsfield')&&(v===''||v==='0')){parts.push('中身なり');return}
   if(!v)return;
   /* 見て選ぶ欄・幅・高さは**押した札の言葉**で言う（保存値の綴りは長い）。 */
   const card=fld.querySelector(`[data-card="${CSS.escape(el.dataset.field)}"].is-on`);
   if(card)v=(card.querySelector('.mm-card-txt>b')||card).textContent.trim()||v;
   else if(fld.classList.contains('mm-spanfield'))v=v+'マス';
   else if(fld.classList.contains('mm-rowsfield'))v=v+'行';
   else if(fld.dataset.fb)v=String(v).split(/[\n,、]/).filter(Boolean).length+'項目';
   if(v.length>14)v=v.slice(0,13)+'…';
   parts.push(v);
  });
  return parts.slice(0,3).join('・')+(parts.length>3?' ほか':'');
 }
 /* ---------- 設定ページの段（タブ）と畳み（アコーディオン）（§9.261） ----------
    利用者の指示「認知心理学に基づきSPAをベースにわかりやすく使いやすいように
    タブとアコーディオンを主構成にして再構成」。

    **編集窓の段と同じ受け皿を使う**（`.mm-tabbar`/`.mm-tabpanel`）——CSSも
    キーボード操作も`bindMaintTabs`もそのまま効く。ここで別の作りを持つと、
    段の見た目と動きが画面ごとに違うことになる（§9.163と同じ理由）。

    畳みは素の`<details>`。**畳んだままでも「いま何が効いているか」は
    見出しに出す**（§3。隠したものを何も書かずに隠すと、設定の存在ごと
    忘れられる・§9.125）。 */
 function pageTabsHtml(items){
  const tabs=items.map((x,i)=>
   `<button type="button" class="mm-tab" role="tab" id="mmTab${i}" data-mmtab="${i}"`
   +` aria-selected="${i?'false':'true'}" aria-controls="mmPanel${i}" tabindex="${i?-1:0}">`
   +`<span class="mm-fieldgroup">${esc(x.name)}</span>`
   +`<small class="mm-tab-sum" data-mmtab-sum="${i}"></small></button>`).join('');
  const panels=items.map((x,i)=>
   `<section class="mm-tabpanel is-page" role="tabpanel" id="mmPanel${i}"`
   +` aria-labelledby="mmTab${i}" data-mmtab="${i}"${i?' hidden':''}>${x.body}</section>`).join('');
  return `<div class="mm-tabbar is-page" role="tablist">${tabs}</div>`
   +`<div class="mm-tabbody is-page">${panels}</div>`;
 }
 /* 畳み。`open`を渡したときだけ開いた状態で出す（既定は畳む）。 */
 function pageFoldHtml(title,now,body,open){
  return `<details class="pc-acc"${open?' open':''}>`
   +`<summary><b>${esc(title)}</b>${now?`<span class="pc-acc-now">${esc(now)}</span>`:''}</summary>`
   +`<div class="pc-acc-body">${body}</div></details>`;
 }
 function bindMaintTabs(form){
  const bar=form.querySelector('.mm-tabbar');
  if(!bar)return;
  const tabs=[...bar.querySelectorAll('[data-mmtab]')];
  const panels=[...form.querySelectorAll('.mm-tabpanel')];
  const show=i=>{
   tabs.forEach((t,j)=>{
    const on=j===i;
    t.setAttribute('aria-selected',on?'true':'false');
    t.tabIndex=on?0:-1;
    t.classList.toggle('is-on',on);
   });
   panels.forEach((p,j)=>{if(p.hidden!==(j!==i))p.hidden=j!==i});
  };
  const paint=()=>panels.forEach((p,i)=>{
   const el=bar.querySelector(`[data-mmtab-sum="${i}"]`);
   if(el)el.textContent=mmTabSummaryText(p);
  });
  if(form.dataset.mmTabsWired!=='1'){
   form.dataset.mmTabsWired='1';
   /* **値が変わったら見出しの一言を描き直す**（忘れると、直したのに
      畳んだ段だけ古い値を名乗る）。 */
   form.addEventListener('change',()=>paint());
   form.addEventListener('input',()=>paint());
  }
  tabs.forEach((t,i)=>{
   t.onclick=()=>show(i);
   t.onkeydown=e=>{
    if(['ArrowRight','ArrowLeft'].indexOf(e.key)<0)return;
    e.preventDefault();
    const nx=(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    show(nx);tabs[nx].focus();
   };
  });
  show(0);
  paint();
  form.__mmShowTab=show;
 }
 /* 入っていない必須の欄がある段を開く（§4）。**開かずに断らないこと**
    ——畳んだ段の中の欄を「入れてください」と言われても、どこにあるのか
    分からない。 */
 function mmRevealField(form,el){
  if(!form||!el||typeof form.__mmShowTab!=='function')return;
  const panel=el.closest('.mm-tabpanel');
  if(!panel)return;
  const i=[...form.querySelectorAll('.mm-tabpanel')].indexOf(panel);
  if(i>=0)form.__mmShowTab(i);
 }
 /* ---------- モーダルの中の欄は「中身の長さ」で決める(§9.221 ④) ----------
    利用者の指摘「モーダル内のUIサイズの設計がモーダル横幅いっぱいまで
    伸びているケースが多いです。規格化してきれいに整列、不用意な余白も
    ないように注意しながら設計してほしいです」。

    以前は編集モーダルが**1行1欄・幅100%**で、表示順（2桁）の欄にも
    600px前後を与えていた（§CLAUDE 11「1桁しか入らない欄に250pxを与えない」）。
    大きさは**`--w-*`の6段から選ぶ**——中身なりの実測をそのまま使うと
    1画面に何種類もの幅が生まれて並ばない（§9.131）。

    段は**型から自動で決まる**（数値=xs／日付=sm／選択=md／自由記述=md）ので、
    マスタを増やしても書き足す必要は無い。合わないものだけ`size:`で名指しする。 */
 /* 12マス中の幅を「読める言葉」にする（§9.249 ③）。6を1/2と読み替えるのは
    人の側の仕事にしない。割り切れないものは「◯マス」のまま言う。 */
 function mmFracText(n,max){
  const m=max||12;
  const map={1:'1/12',2:'1/6',3:'1/4',4:'1/3',6:'1/2',8:'2/3',9:'3/4',12:'全幅'};
  return map[n]||`${n}マス`;
 }
 const MM_SIZE_BY_TYPE={number:'xs',time:'xs',date:'sm',select:'md',
   'master-combo':'md','master-suggest':'md','equipment-select':'md',
   textarea:'full',path:'full','equipment-multi':'full','equipment-multi-text':'full',
   /* 見て選ぶ欄は横いっぱい（札が折り返さないように・§9.249 ③）。 */
   /* §9.311 D/E 幅・高さは「− 数 ＋」1つに畳んだので、行を丸ごと使わない
      （利用者の指示「無駄にスペースを使っている部分は節約」）。 */
   /* **入切の札も横いっぱい**（§9.392）——`check-set`だけこの並びから
      漏れており、器が210pxで止まって**札が1列に縦積み**になっていた
      （実測: 使える機能3枚で3段、入力内容9枚で9段・高さ560px）。
      器を728pxまで広げれば3列で収まる。 */
   'choice-card':'full','span-grid':'md','rows-pick':'md','tag-set':'full',
   'check-set':'full'};
 function mmFieldSize(f){
  if(f.size)return f.size;
  const t=String(f.type||'text');
  if(MM_SIZE_BY_TYPE[t])return MM_SIZE_BY_TYPE[t];
  /* 自由記述は**役割**から見当を付ける。長い文が入るものだけ広くする。 */
  if(/備考|説明|メモ|内容|コメント|理由|条件|式/.test(String(f.label||'')))return 'lg';
  return 'md';
 }
 /* 先頭の`class="mm-field…"`へ段の印を差し込む。**器そのものは各分岐が
    組み立てる**ので、後から印だけを足す（分岐ごとに書くと足し忘れる）。 */
 function mmSized(html,f){
  return String(html).replace('class="mm-field','class="mm-field mm-w-'+mmFieldSize(f)+' ');
 }
 function buildFieldControls(def,editing){
  return groupFieldControls(def,def.fields.map(f=>mmWhen(mmSized(buildOneFieldControl(f,editing),f),f)));
 }
 /* ---------- 「別の欄で選んだときだけ出す」（§9.234 ⑤） ----------
    帳票ブロックの種別（項目の並び／エリア）のように、**選んだ種別で
    決めることが変わる**設定がある。押せるのに何も起きない欄を残さない（§4）。
    **作り直さないこと**——`hidden`の付け外しだけにする（値もフォーカスも
    失わない。§9.117の「入力中に描き直さない」と同じ理由）。
    印は器へ付ける（`data-when="鍵=値"`）。 */
 function mmWhen(html,f){
  if(!f||!f.when)return html;
  const k=Object.keys(f.when)[0];
  if(!k)return html;
  const v=String(f.when[k]);
  return String(html).replace(/^(\s*<(?:div|label)\b)/,
    (m,head)=>`${head} data-when="${esc(k)}=${esc(v)}"`);
 }
 /* 指し先の欄の値で出し入れする。**値は消さない**（戻せば元の値が残る）。 */
 function bindWhenFields(form){
  const boxes=[...form.querySelectorAll('[data-when]')];
  if(!boxes.length)return;
  const apply=()=>boxes.forEach(box=>{
   const raw=String(box.dataset.when||''),i=raw.indexOf('=');
   if(i<0)return;
   const key=raw.slice(0,i),want=raw.slice(i+1);
   const src=form.querySelector(`[data-field="${CSS.escape(key)}"]`);
   const on=!src||String(src.value||'')===want;
   if(box.hidden!==!on)box.hidden=!on;
  });
  boxes.forEach(box=>{
   const raw=String(box.dataset.when||''),i=raw.indexOf('=');
   if(i<0)return;
   const src=form.querySelector(`[data-field="${CSS.escape(raw.slice(0,i))}"]`);
   if(src&&!src.dataset.whenWired){src.dataset.whenWired='1';src.addEventListener('change',apply)}
  });
  apply();
 }
 function buildOneFieldControl(f,editing){
  return (function(){
   const val=editing?String(editing[f.k]??''):'';
   if(f.type==='equipment-select'){
    const opts=WL.records.equipmentMasterState.items||[];
    /* **いま入っている設備が候補に無くても捨てないこと**（§9.204と同じ罠）。
       設備マスタからその設備が消えても、行そのものは残っている——候補に
       足さずに描くと`<select>`は「選択...」に落ち、**開いて保存し直した
       だけで設備が空になる**（保存側は空を断るので、その行は編集も
       できなくなる）。足したうえで**無いことを文字で言う**（§4）。 */
    const missing=!!val&&!opts.some(eq=>eq.name===val);
    if(!opts.length&&!missing){
     return `<div class="mm-field"><span>${esc(f.label)}</span><span class="mm-empty-inline">設備マスタが未登録です。先に「設備」タブで登録してください。</span></div>`;
    }
    const optHtml=(missing?`<option value="${esc(val)}" selected>${esc(val)}（設備マスタにありません）</option>`:'')
      +opts.map(eq=>`<option value="${esc(eq.name)}"${eq.name===val?' selected':''}>${esc(eq.name)}</option>`).join('');
    return `<label class="mm-field"><span>${esc(f.label)}${f.required?'<i>*</i>':''}${f.key?'<em class="mm-keytag">キー</em>':''}</span><select data-field="${f.k}">${missing?'':'<option value="">選択...</option>'}${optHtml}</select>${missing?`<small class="mm-field-hint">この設備は設備マスタにありません（消されたか、名前が変わっています）。**そのままにすれば今の設備名を保ちます**。登録済みの設備へ付け替えることもできます。</small>`:(f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:'')}</label>`;
   }
   /* 対象設備を複数選べる欄。作業可能設備(equipment-multi)と同じタグUIだが、
      保存先が配列ではなくカンマ区切りの1列で、さらに「すべての設備」という
      ワイルドカード('*')を持つ。開発・保守用に全設備の権限を1行で渡せる
      ようにするため(設備を増やすたびに権限行を足さなくてよい)。 */
   if(f.type==='equipment-multi-text'){
    const raw=String(editing?(editing[f.k]??''):'').trim();
    const isAll=raw===EQUIPMENT_ALL;
    const selected=new Set(isAll?[]:raw.replace(/、/g,',').split(',').map(s=>s.trim()).filter(Boolean));
    const opts=WL.records.equipmentMasterState.items||[];
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
     <small class="mm-field-hint">${hintHtml(tagHint)}</small></div>`;
   }
   if(f.type==='equipment-multi'){
    const selected=new Set((editing&&Array.isArray(editing[f.k])?editing[f.k]:[]).map(String));
    const opts=WL.records.equipmentMasterState.items||[];
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
    /* **説明を書いたら出す**（§9.222 ⑧）。ここだけ`f.hint`を捨てていたので、
       マスタ定義に書いた注意書きが選択欄でだけ黙って消えていた。 */
    return `<label class="mm-field">${fieldLabelHtml(f)}<select data-field="${f.k}">${opts}</select>`
      +(f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:'')+`</label>`;
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
      <small class="mm-field-hint">${hintHtml(f.hint||'一覧から選ぶだけで入力できます。無いものは「＋ 新しく追加」を選ぶとこの場で登録できます。')}</small></div>`;
   }
   /* 候補を出すだけの自由記述（§9.239 ⑥）。**選択肢で塞がない**——
      現場の呼び名は事前に数え切れないので、一覧に無い値も打てるようにする。
      候補の出どころは**サーバーの戻り**（`maintState.meta[source.key]`）で、
      画面には綴りを書き写さない（§9.163）。 */
   if(f.type==='master-suggest'){
    const key=(f.source&&f.source.key)||'';
    const opts=(maintState.meta&&Array.isArray(maintState.meta[key]))?maintState.meta[key]:[];
    const lid=`mmSuggest_${f.k}`;
    return `<label class="mm-field">${fieldLabelHtml(f)}
      <input data-field="${f.k}" type="text" list="${lid}" autocomplete="off" value="${esc(val)}">
      <datalist id="${lid}">${opts.map(o=>`<option value="${esc(o)}"></option>`).join('')}</datalist>
      ${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</label>`;
   }
   if(f.type==='number'){
    return `<label class="mm-field mm-field-num">${fieldLabelHtml(f)}${numFieldHtml(f,val)}${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</label>`;
   }
   /* ---------- 選んで組み立てる（§9.226 ④、利用者の指示） ----------
      「帳票ブロックを新規登録が難しすぎて作成できない。入力データ(汎用入力
       データも含む)の中から選んで組み合わせたり配置する方式で、直感的に
       組み合わせてデータブロックを作ることができるようにしてほしい」

      保存の形は今までどおり`ラベル=出どころ`の並び（`[内容]`）で、
      **書く手段を変えただけ**——保存の形まで変えると、既に登録してある
      塊が読めなくなる（§9.171の「印は名前で運ぶ」と同じ考え方）。
      左が候補（出どころごとにまとまっている）、右が載せる項目。押すと
      移り、掴んで並べ替えられる。ラベルはその場で直せる。
      **候補はサーバーが答える**（`catalog`）ので、操業データの項目を足せば
      そのままここに増える（§9.163「判定を画面に書かない」）。 */
   /* ---------- 選ばせる欄を「見て選ぶ」形にする（§9.249 ③） ----------
      利用者の指摘「文字が多いわりにわかりにくく」。選択肢の意味が
      **選ぶ前に読めない**のが原因で、プルダウンは名前しか出せない。
      札に**絵・名前・一言**を並べれば、開かなくても違いが分かる（§CLAUDE 2）。
      値を持つのは今までどおり隠し欄なので、`submitMaint`は型を知らなくてよい。 */
   if(f.type==='choice-card'){
    /* **選択欄と同じ既定にする**（§9.249 ③）——`<select>`は先頭の選択肢が
       最初から選ばれている。札にした途端に「どれも選ばれていない」状態が
       生まれると、②の欄が`data-when`で消えて**決めることが1つ消える**
       （新規登録で実際にそうなった）。 */
    /* **語彙をサーバーから取れるようにする**（§9.305 ①）——`source.key`を
       書いたときは`maintState.meta[key]`（`{key,label,note}`の並び）を札に
       する。画面へ綴りを書き写さないための口で、静的な`cards`は今までどおり。 */
    const srcKey=(f.source&&f.source.key)||'';
    const list=srcKey
      ?((maintState.meta&&Array.isArray(maintState.meta[srcKey])?maintState.meta[srcKey]:[])
         .map(o=>({v:o.key,label:o.label||o.key,note:o.note||''})))
      :(f.cards||[]);
    const cur=String(val||'')||String((list[0]||{}).v||'');
    const cards=list.map(c=>{
     const on=cur===String(c.v);
     return `<button type="button" class="mm-card-opt${on?' is-on':''}" data-card="${f.k}" data-card-v="${esc(c.v)}"`
      +` aria-pressed="${on?'true':'false'}" title="${esc(c.note||c.label)}">`
      +`<span class="mm-card-ico" aria-hidden="true">${esc(c.icon||'')}</span>`
      +`<span class="mm-card-txt"><b>${esc(c.label)}</b>`
      +`${c.note?`<small>${esc(c.note)}</small>`:''}</span></button>`;
    }).join('');
    return `<div class="mm-field mm-field-area mm-cards">${fieldLabelHtml(f)}
      <div class="mm-card-row">${cards}</div>
      <input type="hidden" data-field="${f.k}" value="${esc(cur)}">
      ${list.length?'':'<small class="mm-field-hint">選べる候補をこの端末では読めませんでした。</small>'}
      ${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</div>`;
   }
   /* ---------- 選んだ側を保存する札（§9.306） ----------
      利用者の指示「親マスタの選択肢から選んで登録することができるように」。
      `check-set`（§9.302）と**箱も配線も同じ**で、違うのは
      **保存するのが「入」の側**であることだけ——あちらは「空欄＝すべて
      使える」を保つために裏返していたが、こちらは「親の値」なので
      素直に選んだものを書く（**空欄＝すべての親**は同じ約束）。
      候補は`f.source.key`（＋`f.source.by`＝行のどの欄で引くか）で
      **サーバーの戻りから**取る（§9.163。画面に値を書き写さない）。
      **候補が無いときは欄を出さず理由を書く**（§4）——親を張っていない
      まとまりで空の札を並べても、押しても何も起きない。 */
   if(f.type==='tag-set'){
    const src=f.source||{};
    const table=(maintState.meta&&maintState.meta[src.key])||null;
    const list=Array.isArray(table)?table
      :(table&&src.by?(table[String((editing&&editing[src.by])||'')]||[]):[]);
    if(!list.length)
     return `<div class="mm-field mm-field-area">${fieldLabelHtml(f)}
       <small class="mm-field-hint">${hintHtml(f.emptyHint||'いまは選べる候補がありません。')}</small></div>`;
    const raw=String(editing?(editing[f.k]??''):'').trim();
    /* **空欄＝すべて**（`[対象設備]`と同じ約束）。全部入で描く。 */
    const on=raw?new Set(raw.replace(/、/g,',').split(',').map(x=>x.trim()).filter(Boolean))
      :new Set(list);
    const cards=list.map(v=>{
     const yes=on.has(v);
     return `<button type="button" class="mm-card-opt${yes?' is-on':''}" data-checkset="${f.k}"`
      +` data-checkset-v="${esc(v)}" aria-pressed="${yes?'true':'false'}">`
      +`<span class="mm-card-ico" aria-hidden="true">${yes?'✓':'—'}</span>`
      +`<span class="mm-card-txt"><b>${esc(v)}</b></span></button>`;
    }).join('');
    return `<div class="mm-field mm-field-area mm-cards" data-checkset-box="${f.k}" data-checkset-mode="on">${fieldLabelHtml(f)}
      <div class="mm-card-row">${cards}</div>
      <input type="hidden" data-field="${f.k}" value="${esc(raw)}">
      <small class="mm-field-hint" data-checkset-note="${f.k}"></small>
      ${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</div>`;
   }
   /* ---------- いくつでも入切できる札（§9.302） ----------
      利用者の指示「有効無効の範囲については機能別に分けて変更できるように」。
      `choice-card`は1つしか選べないので、**入切を並べる型**を1つ足す。
      **語彙はサーバーの戻り**（`maintState.meta[f.source.key]`）から取る
      ——画面へ綴りを書き写すと、機能を1つ足したときに直す場所が2つになる
      （§9.163。`master-suggest`と同じ作法）。

      **画面は「使う機能」を出し、保存値は「使わない機能」**（§9.302）。
      裏返しなのは保存の側に理由があって——空欄＝すべて使える、にしないと
      **あとで機能を足したときに既存の設備で黙って無効になる**。裏返す場所は
      この型の描画と入切の2箇所だけで、規則（空欄の意味・知らない綴りの扱い）は
      サーバーが持つ。 */
   if(f.type==='check-set'){
    const key=(f.source&&f.source.key)||'';
    const opts=(maintState.meta&&Array.isArray(maintState.meta[key]))?maintState.meta[key]:[];
    const off=new Set(String(Array.isArray(val)?val.join(','):(val||'')).split(',').filter(Boolean));
    const cards=opts.map(o=>{
     const on=!off.has(o.key);
     return `<button type="button" class="mm-card-opt${on?' is-on':''}" data-checkset="${f.k}"`
      +` data-checkset-v="${esc(o.key)}" aria-pressed="${on?'true':'false'}"`
      +` title="${esc(o.note||o.label)}">`
      +`<span class="mm-card-ico" aria-hidden="true">${on?'✓':'—'}</span>`
      +`<span class="mm-card-txt"><b>${esc(o.label)}</b>`
      +`${o.note?`<small>${esc(o.note)}</small>`:''}</span></button>`;
    }).join('');
    /* **一言は定義が持てる**（§9.392）——同じ箱を「機能」と「入力内容」で
       使い回すので、文言を`機能`に固定すると片方が別のことを言う。
       `{names}`は札の名前に置き換える。 */
    const w=f.checkWords||{};
    return `<div class="mm-field mm-field-area mm-cards" data-checkset-box="${f.k}"
      data-checkset-all="${esc(w.all||'すべての機能で使えます（既定）。')}"
      data-checkset-none="${esc(w.none||'どの機能でも使いません。設備マスタには残りますが、{names}のどこにも出ません。')}"
      data-checkset-some="${esc(w.some||'{names}では使いません。')}">${fieldLabelHtml(f)}
      <div class="mm-card-row">${cards}</div>
      <input type="hidden" data-field="${f.k}" value="${esc([...off].join(','))}">
      <small class="mm-field-hint" data-checkset-note="${f.k}"></small>
      ${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</div>`;
   }
   /* 紙の12マスをそのまま出して、**押した幅がそのまま見える**ようにする。
      「6＝1/2」を頭の中で割り算させない（§CLAUDE 6）。 */
   /* ---------- 数で決まるものは「− 数 ＋」の1つに畳む（§9.311 D/E） ----------
      利用者の指示「各項目のサイズを決めるボタンは**小さくなった時に見切れる**
      ので、**数字をトグルボタンとセットでコンパクトに**表示できるように」
      「列数を指定する部分もボタンでたくさんあるので、数字を決めればよい部分
      なので、ここもコンパクトにトグルボタンをつけて**決めた数値1つが見えれば
      よい**」「それ以外のボタンも多い部分なので無駄にスペースを使っている部分は
      節約してすっきりシンプルに」。
      幅は12マスぶんの札、高さは8枚、列数は12枚——**選べる段しか作れない**のに
      段の数だけボタンを並べていた（幅は12枚あって選べるのは5段）。
      **いま決めた数だけを出し、前後は−／＋で動かす**（§9.247 ①の`切替`と
      同じ作法。値は隠し欄が持つので`submitMaint`は型を知らなくてよい・§9.250 ④）。
      **選べる値は器が持つ**（`data-allow`）——紙の見本の縁を掴む処理が
      ここから読むので、一覧を2箇所に書かない（§9.250 ④・§9.163）。 */
   if(f.type==='span-grid'||f.type==='rows-pick'){
    const isSpan=f.type==='span-grid';
    const max=f.max||12;
    /* 幅は数の並び、高さは`''`（中身なり）を先頭に持つ並び。 */
    const opts=isSpan
      ?((f.options||[]).map(Number).filter(n=>n>0).sort((a,b)=>a-b))
      :(f.options||['']).map(String);
    const cur=isSpan?Math.max(1,Math.min(max,Number(val)||max)):String(val||'');
    const at=isSpan
      ?Math.max(0,opts.reduce((bi,x,i)=>Math.abs(x-cur)<Math.abs(opts[bi]-cur)?i:bi,0))
      :Math.max(0,opts.indexOf(cur));
    const label=v=>isSpan?`${v} / ${max} マス`:(String(v)===''?'中身なり':`${v} 行`);
    const sub=isSpan?esc(mmFracText(cur,max))
      :(String(cur)===''?'描いてから測って、中身の高さに合わせます'
                        :`1行＝紙の1/${WL.mm.RB_PAGE_ROWS}`);
    return `<div class="mm-field mm-field-num mm-stepfield">${fieldLabelHtml(f)}
      <div class="mm-step" data-step-field="${f.k}" data-step-kind="${isSpan?'span':'rows'}"
        data-allow="${esc(opts.join(','))}" role="group" aria-label="${esc(f.label||'')}">
       <button type="button" class="mm-step-btn" data-step="-1" title="1つ小さく">−</button>
       <b class="mm-step-val" data-step-read="${f.k}">${esc(label(cur))}</b>
       <button type="button" class="mm-step-btn" data-step="1" title="1つ大きく">＋</button>
      </div>
      <em class="mm-step-sub" data-step-sub="${f.k}">${sub}</em>
      <input type="hidden" data-field="${f.k}" value="${esc(val)}">
      ${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</div>`;
   }
   if(f.type==='field-builder'){
    return `<div class="mm-field mm-field-area fb" data-fb="${f.k}">${fieldLabelHtml(f)}
      <div class="fb-body">
       <div class="fb-pick">
        <div class="fb-pick-head"><b>選べる項目</b>
         <input type="search" class="fb-search" placeholder="項目名で絞る" autocomplete="off"></div>
        <div class="fb-cats" role="tablist"></div>
        <div class="fb-list"></div>
       </div>
       <div class="fb-chosen">
        <div class="fb-chosen-head"><b>紙での並び</b><span class="fb-count"></span>
         <span class="fb-cols" role="group" aria-label="列数"></span>
         <button type="button" class="fb-head ghost" title="値を持たず文字だけを出すマスを1つ足します（表の軸の見出しに使います）">見出し</button>
         <button type="button" class="fb-blank ghost" title="何も出さずに場所だけ取るマスを1つ足します（区切りの良い並びに整えるため）">空きマス</button>
         <button type="button" class="fb-table ghost" title="選んだ項目を、行と列の軸で表に組み直します">表に組む</button>
         <!-- ラベルと値の並べ方をまとめて変える（§9.292 ⑤）。**設定は
              マス側の1つだけ**で、これは「全部のマスへ同じ値を書く」操作
              （「既定の中身を写す」と同じ立ち位置。設定を2つ持たない）。 -->
         <button type="button" class="fb-stack ghost"
           title="ラベルを出しているマスを、まとめて「上下（ラベルの下に値）」／「横（ラベル：値）」へ切り替えます">ラベルを上下に</button>
         <button type="button" class="fb-seed ghost" hidden>既定の中身を写す</button>
         <button type="button" class="fb-clear ghost">全部外す</button></div>
        <!-- 軸の置き場（§9.277）。**組める材料があるときだけ中身が入る**
             （押せるのに何も起きない帯を置かない・§4）。 -->
        <div class="fb-axes" hidden></div>
        <p class="fb-hint">下の枠が<b>紙のこの塊そのもの</b>です。掴んで動かすと並びが変わり、
         各マスの<b>数字</b>で横に使うマス数を決められます。<b>マスを押すと</b>下で
         種別・寄せ・書式を決められます。</p>
        <div class="fb-rows"></div>
        <div class="fb-insp" hidden></div>
       </div>
      </div>
      <input type="hidden" data-field="${f.k}" value="${esc(val)}">
      <small class="mm-field-hint">${hintHtml(f.hint||'')}</small></div>`;
   }
   /* 複数行の入力欄（§9.217）。1行1件を書かせる設定（帳票ブロックの内容）で
      使う——1行の欄に押し込むと、何件書いたのかが読めない。 */
   if(f.type==='textarea'){
    return `<label class="mm-field mm-field-area">${fieldLabelHtml(f)}`
     +`<textarea data-field="${f.k}" rows="${f.rows||6}" spellcheck="false"`
     +` placeholder="${esc(f.placeholder||'')}">${esc(val)}</textarea>`
     +`${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</label>`;
   }
   if(f.type==='date'){
    return `<label class="mm-field">${fieldLabelHtml(f)}<span class="mm-date"><input data-field="${f.k}" type="date" value="${esc(val)}"><button type="button" class="mm-date-today" data-date-today="${f.k}">今日</button></span>${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</label>`;
   }
   if(f.type==='time'){
    return `<label class="mm-field">${fieldLabelHtml(f)}<input data-field="${f.k}" type="time" step="60" value="${esc(val)}">${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</label>`;
   }
   if(f.type==='path'){
    return `<div class="mm-field mm-field-path">${fieldLabelHtml(f)}
      <span class="mm-path" data-path-drop="${f.k}">
       <input data-field="${f.k}" type="text" value="${esc(val)}" autocomplete="off" spellcheck="false" placeholder="${esc(f.placeholder||'')}">
       <button type="button" class="mm-path-browse" data-path-browse="${f.k}" data-path-mode="${esc(f.pathMode||'file')}">参照…</button>
      </span>
      <small class="mm-field-hint">${hintHtml(f.hint||'「参照…」で選ぶか、エクスプローラーからここへドラッグ&ドロップできます。')}</small></div>`;
   }
   /* 見せるが触らせない欄（§9.219 ②）。付け替えられない値（帳票ブロックの
      組み込みキー）は、隠すと「なぜ中身を変えられないのか」が読めなくなる
      ——出しておいて、変えられないことを`readonly`で示す（`disabled`に
      しないのは、そのまま保存へ戻すため）。 */
   if(f.type==='readonly'||f.readonly){
    return `<label class="mm-field mm-field-ro">${fieldLabelHtml(f)}`
     +`<input data-field="${f.k}" type="text" value="${esc(val)}" readonly tabindex="-1">`
     +`${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</label>`;
   }
   return `<label class="mm-field">${fieldLabelHtml(f)}<input data-field="${f.k}" type="text" value="${esc(val)}" autocomplete="off"></label>`;
  })();
 }

 /* ---------- Excelの持ち出し・取り込み（§9.240、利用者の指示） ----------
    「ロールマスタについて EXCELでのインポート＆エクスポート機能を実装して
     ください。」

    作法は §9.171（フィルタ）・§9.178（列設定）に合わせる:
     ・**モーダルを増やさない。** 一覧の上の帯に置く——何が出て行くのかを
       実物の一覧を見たまま確かめられるのが値打ち。
     ・**運ぶもの・運ばないものを画面に書く。** IDは運ばない（端末ごとの
       連番なので、別のPCで取り込むと無関係な行を書き換える）。
     ・**保存する前に下見できる**（§9.193）。何件が追加で何件が上書きか、
       どの行がなぜ飛ばされるかを、書き込む前に出す。
     ・**飛ばした件数と理由を必ず文字で言う**（§CLAUDE 4）。 */
 /* ---------- 見本のロットで帳票を見る（§9.253、利用者の指示） ----------
    「今の状態だと、登録済みのデータから、帳票の表示を行うパターンで実データ
     での確認が必要です。クリックのステップ数が多いのと、実データがないと
     確認できない点が問題です。全入力可能データのダミーデータを1データ、
     内部に持っておくこととそのデータを活用し帳票のプレビューを帳票ブロック
     マスタから確認用に実際のデータを配置した形かつ、現在のレイアウトでの
     データを見られる、試し印刷もできるようにしてください」

    **1押しで刷り上がりまで行く**（§2「探させない」）——それまでは
    「データ一覧を開く→ロットを探す→行を開く→帳票」の4段で、しかも
    実データが1件も無い端末では**確かめる手立てが無かった**。
    見本のロットはサーバーが1件だけ作る（§9.163。値は設定画面の
    「見本の値」と同じ`SAMPLE_VALUES`が持つので、欄で確かめた文字が
    そのまま紙に出る）。

    印は`sampleReport:true`の1つ（`excelIo`・`bulkDelete`と同じ差し替え口）。 */
 function sampleReportHtml(def){
  if(!def.sampleReport)return '';
  return `<span class="mm-sample-tools">
    <button type="button" id="mmSampleView" class="mm-btn-ghost sm"
      title="見本のロット1件で、いまの配置のまま帳票のプレビューを開きます（実データは要りません。保存もされません）">見本で帳票を見る</button>
    <button type="button" id="mmSamplePrint" class="mm-btn-ghost sm"
      title="見本のロットで、いまの配置のまま試しに1枚刷ります">試し印刷</button>
   </span>`;
 }
/* ---------- 親子のマスタを行き来する（§9.254 ③、利用者の指示
    「帳票レイアウトマスタと帳票ブロックマスタを配線しリンクさせて」） ----------
    **印1つの差し替え口**（`excelIo`・`bulkDelete`・`sampleReport`と同じ作法）。
    `linkTo:{key,label,title}`を足すと、一覧の帯に相手のタブへ渡るボタンが出る。
    **入口を2つにしない**——渡す先は左のナビと同じボタンを押すだけなので、
    タブの選び方が2通りにならない。 */
 function linkMasterHtml(def){
  const l=def&&def.linkTo;if(!l)return '';
  return `<button type="button" id="mmLinkMaster" class="mm-btn-ghost sm"
    title="${esc(l.title||'')}">${esc(l.label)}</button>`;
 }
 function bindLinkMaster(def){
  const b=$('#mmLinkMaster'),l=def&&def.linkTo;if(!b||!l)return;
  b.onclick=()=>{
   const nav=document.querySelector(`#masterMaintNav [data-master="${CSS.escape(l.key)}"]`);
   if(nav)nav.click();
   else showToast&&showToast('移れませんでした',`「${l.label}」のタブが見つかりません。`,5000);
  };
 }
 function bindSampleReport(def){
  if(!def.sampleReport)return;
  const go=async print=>{
   if(!(window.WL&&WL.reportSample&&typeof WL.reportSample.open==='function')){
    /* **公開漏れは黙って素通しにしない**（§CLAUDE）——「あれば使う」で
       書くと、名前を変えた日に押しても何も起きない欄になる。 */
    console.error('WL.reportSample.open が見つかりません');
    showToast&&showToast('帳票を開けません','帳票の画面が読み込まれていません。',6000);return;
   }
   await WL.reportSample.open({returnTo:'blocks',print:!!print});
  };
  const v=$('#mmSampleView');if(v)v.onclick=()=>go(false);
  const pr=$('#mmSamplePrint');if(pr)pr.onclick=()=>go(true);
 }

 /* ---------- まとめて消す（§9.251、利用者の指示「ロールマスタの全削除機能
    （ロールマスタの完全入替機能）を実装してください」） ----------
    **印を1つ付けるだけ**の差し替え口（`excelIo`と同じ作法）。
    `bulkDelete:true` を足すと、`<endpoint>/delete-all` を叩く帯が出る。
    **範囲の選択肢はサーバーが数える**（下見の`byEquipment`）——画面が
    一覧から数え直すと、消す範囲と選択肢が別々の数え方になる（§9.163）。 */
 function bulkDeleteHtml(def){
  if(!def.bulkDelete)return '';
  return `<button type="button" id="mmBulkDel" class="mm-btn-danger sm mm-bulk-del"
    title="登録されているロールをまとめて消します。押すと、範囲（すべて／設備を1つ）と件数を確かめてから消します">全部消す…</button>`;
 }
 function bindBulkDelete(def){
  const b=$('#mmBulkDel');if(!b||!def.bulkDelete)return;
  b.onclick=()=>bulkDeleteFlow(def);
 }
 async function bulkDeleteFlow(def){
  const uid=requireMaintUser();if(uid===null)return;
  let plan;
  try{
   /* **まず下見**（`apply`を付けない＝1件も消えない）。ここで初めて
      「どの設備に何件あるか」がサーバーの数え方で分かる。 */
   plan=await api(def.endpoint+'/delete-all',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({scope:'all',user_id:uid})});
  }catch(e){showToast&&showToast('件数を数えられませんでした',e.message,7000);return}
  if(!plan.total){
   showToast&&showToast('消すものがありません',`${def.label}は0件です。`,3600);return;
  }
  const by=plan.byEquipment||[];
  const rows=by.map((x,i)=>`<label class="mm-bulk-pick"><input type="radio" name="mmBulkScope"
     value="eq:${i}"><span>${esc(x.equipment||'設備の入っていない行')}</span><em>${x.count}件</em></label>`).join('');
  /* **既定を持たせない**——「消す」に既定の範囲があると、押し間違いが
     そのまま全消しになる。選ぶまでボタンは押せず、その理由をその場に書く
     （§CLAUDE 4）。 */
  const body=`<p class="confirm-modal-message">${esc(def.label)}を<b>まとめて消します</b>。取り消せません。
    <b>どの範囲を消すか</b>を選んでください。</p>
   <div class="mm-bulk-scopes">
    ${rows}
    <label class="mm-bulk-pick is-all"><input type="radio" name="mmBulkScope" value="all">
     <span>すべての設備</span><em>${plan.total}件</em></label>
   </div>
   <p class="confirm-modal-message mm-bulk-tip">元へ戻すには、消す前に「書き出す」でExcelへ残してください
    （そのファイルを「取り込む」で戻せます）。</p>`;
  const p=confirmModal({title:`${def.label}をまとめて削除します`,eyebrow:'DELETE ALL',
                        bodyHtml:body,confirmLabel:'削除する',danger:true});
  /* 確認モーダルは**画面で1枚を使い回す**（`ensureConfirmModal`）ので、
     ここで足した見張りと`disabled`は**必ず自分で外す**——外さないと、
     次にどこかが確認を出したときに前の流れの見張りが一緒に動く。 */
  const ok=$('#appConfirmOk'),box=$('#appConfirmBody');
  let pick=null,onPick=null,note=null;
  if(ok&&box){
   ok.disabled=true;
   note=document.createElement('p');
   note.className='confirm-modal-message mm-bulk-need';
   note.textContent='範囲を選ぶと「削除する」を押せます。';
   box.append(note);
   onPick=ev=>{
    const el=ev.target;if(!el||el.name!=='mmBulkScope')return;
    pick=el.value;ok.disabled=false;if(note)note.remove();
   };
   box.addEventListener('change',onPick);
  }
  let go=false;
  try{go=await p}
  finally{
   if(ok)ok.disabled=false;
   if(box&&onPick)box.removeEventListener('change',onPick);
  }
  if(!go||!pick)return;
  const scope=pick==='all'?'all':'equipment';
  const eq=pick==='all'?undefined:(by[Number(pick.slice(3))]||{}).equipment;
  try{
   setMaintLoading(true,'削除しています…');
   const body2={scope,user_id:uid,apply:true};
   if(scope==='equipment')body2.equipment=eq||'';
   const r=await api(def.endpoint+'/delete-all',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify(body2)});
   await loadMaintInner(true);
   showToast&&showToast('削除しました',(r&&r.message)||'',4200);
  }catch(e){showToast&&showToast('削除できませんでした',e.message,7000)}
  finally{setMaintLoading(false)}
 }

 /* **取り込み方は3つ**（§9.251、利用者の指示「ロールマスタの全削除機能
    （ロールマスタの完全入替機能）を実装してください」）。綴りはサーバーの
    `roll_repo.REPLACE_MODES`と1対1で、**何が消えるかを画面は決めない**
    ——決めるのは`import_rows()`の1箇所（§9.163）。ここが持つのは
    「どう名乗るか」だけ。 */
 const XIO_MODES=[
  {v:'',    label:'足す・上書きする',
   note:'ファイルに在る行だけを足す・上書きします。<i>ファイルに無いロールはそのまま残ります（今までどおり）。'
       +'突き合わせは<b>設備名・ロール名・接触面・ロール径MAX・ロール径MIN・備考</b>なので、'
       +'この6つのどれかを書き直した行は「上書き」ではなく<b>追加</b>になります。</i>'},
  {v:'file',label:'ファイルの設備を入れ替える',
   note:'<b>ファイルに出てくる設備</b>のロールを、ファイルの内容そのものにします。<i>その設備の、ファイルに無いロールは削除されます。他の設備は触りません。</i>'},
  {v:'all', label:'すべての設備を入れ替える',
   note:'<b>すべての設備</b>のロールを、ファイルの内容そのものにします。<i>ファイルに1行も出てこない設備のロールも削除されます。</i>'}];
 const xioMode=()=>String($('#mmXioMode')?.value||'');
 function xioModeNote(){
  const m=XIO_MODES.find(x=>x.v===xioMode())||XIO_MODES[0],box=$('#mmXioNote');
  if(box)box.innerHTML=m.note;
 }
 function excelIoHtml(def){
  if(!def.excelIo)return '';
  return `<div class="mm-xio" id="mmXio">
    <div class="mm-xio-head">
     <b>Excel</b>
     <button type="button" id="mmXioOut" class="mm-btn-ghost sm"
       title="いまの一覧をそのままExcelファイル（.xlsx）で保存します。無効にした行も出ます">書き出す</button>
     <label class="mm-xio-mode" for="mmXioMode">取り込み方
      <select id="mmXioMode">${XIO_MODES.map(m=>
        `<option value="${esc(m.v)}">${esc(m.label)}</option>`).join('')}</select></label>
     <button type="button" id="mmXioPick" class="mm-btn-ghost sm"
       title="Excelファイル（.xlsx）を選ぶと、取り込む前に「何件追加・何件上書き・何件削除」を出します">取り込む…</button>
     <input type="file" id="mmXioFile" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
     <span class="mm-xio-note">突き合わせは<b>設備名＋ロール名＋接触面</b>。同じ組み合わせがあれば上書き、無ければ追加します。
      <i>IDは運びません（別のPCでも同じファイルが使えます）。</i>
      <span id="mmXioNote"></span></span>
    </div>
    <div class="mm-xio-result" id="mmXioResult" hidden></div>
   </div>`;
 }
 let xioPending=null;          // 下見が通ったファイル（適用ボタンが使う）
 function bindExcelIo(def){
  if(!def.excelIo)return;
  const say=(html,cls)=>{
   const box=$('#mmXioResult');if(!box)return;
   box.hidden=!html;box.className='mm-xio-result'+(cls?' '+cls:'');box.innerHTML=html||'';
  };
  xioModeNote();
  const mode=$('#mmXioMode');
  if(mode)mode.onchange=()=>{
   xioModeNote();
   /* **取り込み方を変えたら下見をやり直す**（§CLAUDE 2「次にすることを
      常に1つだけ指す」）——古い下見を残すと、「削除0件」と書いてある画面の
      ボタンを押した瞬間に削除が走る。選び直したその場で数え直す。 */
   if(xioPending)xioPreview(def,say,xioPending.b64,xioPending.uid,xioPending.name);
   else say('');
  };
  const out=$('#mmXioOut');
  if(out)out.onclick=()=>{
   /* サーバーが組み立てた .xlsx をそのまま落とす（`logs.py`のログ保存と
      同じ作法）。**画面側で組み立てない**——列の並びと見出しは
      `roll_repo.IO_COLUMNS` の1箇所が持つ（書き写すと取り込みと食い違う）。 */
   say('書き出しています…');
   location.href=def.endpoint+'/export';
   setTimeout(()=>say('書き出しました（ブラウザの保存先を確認してください）。','is-ok'),900);
  };
  const pick=$('#mmXioPick'),file=$('#mmXioFile');
  if(pick&&file)pick.onclick=()=>{file.value='';file.click()};
  if(file)file.onchange=async()=>{
   const f=file.files&&file.files[0];if(!f)return;
   const uid=requireMaintUser();if(uid===null)return;
   say('読んでいます…');
   let b64;
   try{
    b64=await new Promise((ok,ng)=>{
     const r=new FileReader();
     r.onload=()=>ok(String(r.result||'').split(',')[1]||'');
     r.onerror=()=>ng(new Error('ファイルを読めませんでした'));
     r.readAsDataURL(f);
    });
   }catch(e){say(esc(e.message),'is-bad');return}
   xioPending={b64,uid,name:f.name};
   await xioPreview(def,say,b64,uid,f.name);
  };
 }
 /* 入れ替えは取り消せないので、**消える件数と設備を名乗って1回だけ確かめる**
    （§CLAUDE 5。`WL.mm.dropRetiredTable()`と同じ作法）。 */
 async function xioConfirmReplace(r){
  const by={};
  (r.remove||[]).forEach(x=>{const k=x.equipment||'（設備なし）';by[k]=(by[k]||0)+1});
  const list=Object.keys(by).map(k=>`<li><b>${esc(k)}</b><em>${by[k]}件${
    r.removeMore?'以上':''}</em></li>`).join('');
  const body=`<p class="confirm-modal-message">ファイルに出てこないロール
    <b>${r.removeCount}件</b>を<b>削除します</b>。取り消せません。</p>
   <ul class="cl-confirm">${list}</ul>
   <p class="confirm-modal-message">同時に 追加${r.add||0}件・上書き${r.update||0}件 を行います。
    元へ戻すには、いまのマスタを先に「書き出す」でExcelへ残してください。</p>`;
  return await confirmModal({title:'ロールを入れ替えます',eyebrow:'REPLACE',
                             bodyHtml:body,confirmLabel:'入れ替える',danger:true});
 }
 /* **下見と適用は同じ1本を通る**（§9.240 の`RollIndex`と同じ理由）——
    取り込み方・ファイル・利用者が同じなら、見せた内容と起きることが必ず
    一致する。取り込み方を選び直したときもここへ戻ってくる。 */
 async function xioPreview(def,say,b64,uid,name){
  const replace=xioMode();
  say('読んでいます…');
  try{
   const r=await api(def.endpoint+'/import',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({fileBase64:b64,user_id:uid,replace})});
   xioPending={b64,uid,name};
   const nothing=!(r.add+r.update+(r.removeCount||0));
   say(xioPreviewHtml(r,name),(nothing||r.blocked)?'is-bad':'');
   const go=$('#mmXioApply');
   if(go)go.onclick=async()=>{
    if(!xioPending)return;
    /* **消える行があるときだけ、もう一度だけ確かめる**（§CLAUDE 5）。
       件数が0のときは今までどおり1押しで通す——確認を毎回出すと読まずに
       押す癖が付く（§9.170）。 */
    if(r.removeCount&&!(await xioConfirmReplace(r)))return;
    go.disabled=true;say('取り込んでいます…');
    try{
     const done=await api(def.endpoint+'/import',{method:'POST',
       headers:{'Content-Type':'application/json'},
       body:JSON.stringify({fileBase64:xioPending.b64,user_id:xioPending.uid,
                            replace,apply:true})});
     xioPending=null;
     say(xioPreviewHtml(done,name),'is-ok');
     await loadMaintInner(true);
    }catch(e){say('取り込めませんでした: '+esc(e.message),'is-bad')}
   };
  }catch(e){xioPending=null;say('取り込めませんでした: '+esc(e.message),'is-bad')}
 }
 /* 下見・結果の見せ方。**件数は必ず文字で**、飛ばした行は**理由つきで
    全部**出す（§CLAUDE 4。「N件飛ばしました」だけでは直せない）。 */
 function xioPreviewHtml(r,fileName){
  const skipped=r.skipped||[];
  const rows=skipped.map(x=>`<li><b>${esc(String(x.row||'-'))}行目</b>${
    x.name?` <span>${esc(x.name)}</span>`:''} — ${esc(x.why||'')}</li>`).join('');
  const done=!r.dryRun;
  /* **消える行は件数だけで済ませない**（§CLAUDE 4／§3）——取り消せない
     ので、どのロールが消えるのかを名前で出す。全部は並べないが、
     **並べなかった件数は必ず言う**。 */
  const rm=r.remove||[],rmN=r.removeCount||0;
  /* **見分けが付く形で出す**（§9.257 ③）——1本を見分けるのは6つなので、
     設備と名前だけでは「消える3件」が同じ行に見える（同じ名前で接触面・
     径・備考だけが違う行が並ぶのが、この鍵を広げた理由そのもの）。 */
  const rmTag=x=>[x.contactFace,
                  (x.diaMax!=null||x.diaMin!=null)
                    ?'φ'+[x.diaMax,x.diaMin].filter(v=>v!=null).join('〜'):'',
                  x.note].filter(Boolean).join(' ／ ');
  const rmRows=rm.map(x=>{const t=rmTag(x);
    return `<li><b>${esc(x.equipment||'（設備なし）')}</b> <span>${esc(x.name||'')}</span>${
      t?` — ${esc(t)}`:''}</li>`}).join('')
   +(r.removeMore?`<li>ほか ${r.removeMore}件</li>`:'');
  const kept=r.keptNoEquipment||0;
  const canGo=!r.blocked&&(r.add||r.update||rmN);
  return `<div class="mm-xio-sum">
    <b>${esc(fileName||'')}</b>
    <span>シート「${esc(r.sheet||'')}」／データ ${r.total||0}行</span>
    <span class="mm-xio-num">追加 <b>${r.add||0}</b></span>
    <span class="mm-xio-num">上書き <b>${r.update||0}</b></span>
    ${r.replace?`<span class="mm-xio-num${rmN?' is-warn':''}">削除 <b>${done?(r.removed||0):rmN}</b></span>`:''}
    ${skipped.length?`<span class="mm-xio-num is-bad">取り込めない <b>${skipped.length}</b></span>`:''}
   </div>
   ${kept?`<p class="mm-xio-kept">設備の入っていない行 ${kept}件は残します（Excelでは設備名が空のまま表せないため）。消すときは「全部消す…」から。</p>`:''}
   ${done?`<p class="mm-xio-done">${esc(r.message||'取り込みました。')}</p>`
     :(r.blocked
       ?`<p class="mm-xio-done is-bad">${hintHtml(r.blocked)}</p>`
       :(canGo
        ?`<div class="mm-xio-go"><button type="button" id="mmXioApply" class="mm-btn-${rmN?'danger':'primary'} sm">${
            rmN?`この内容で入れ替える（${rmN}件削除）`:'この内容で取り込む'}</button>
          <span>まだ書き込んでいません。押すまでマスタは変わりません。</span></div>`
        :`<p class="mm-xio-done">取り込める行がありません。下の理由を直してから、もう一度選んでください。</p>`))}
   ${(!done&&rmN)?`<details class="mm-xio-skip is-warn" open><summary>消えるロール ${rmN}件（ファイルに出てこない行）</summary><ul>${rmRows}</ul></details>`:''}
   ${skipped.length?`<details class="mm-xio-skip" open><summary>取り込めない行 ${skipped.length}件（この行だけ飛ばします）</summary><ul>${rows}</ul></details>`:''}`;
 }
 function renderMaintForm(){
  const def=currentDef(),form=$('#masterMaintForm');if(!form)return;const editing=maintState.editing;
  // 入力項目が多いマスタは、上部に常設のフォームを置かず(一覧の表示領域を
  // 空けるため)、編集専用モーダルへ入口だけを出す(ARCHITECTURE.md「マスタ管理の画面形態」)。
  /* **読み取り専用のマスタは追加の入口ごと出さない**（§CLAUDE 4。
     押せるのに何も起きないボタンを残さない）。理由は`hint`が書く。 */
  if(def.readOnly&&!def.special){
   form.classList.add('mm-form-compact');
   /* **移行済みの表は丸ごと消せる**（§9.250 ③、利用者の指示「移行済みの
      マスタについては不要なはずなので削除できるようにしてください」）。
      **危ない操作なので主要動線に置かない**（§CLAUDE 5）——器の右端へ寄せ、
      押すと**表の名前と件数を名乗る確認**を1回だけ出す。消せるのは
      サーバーが`RETIRED`と名指ししている表だけ（判定は1箇所・§9.163）。 */
   const drop=def.rawKind==='retired'&&def.rawTable
    ?`<button type="button" id="mmDropTable" class="mm-btn-danger sm"
        title="この表をマスタDBから丸ごと消します（取り消せません）">この表を削除</button>`:'';
   form.innerHTML=`<div class="mm-form-head"><span class="mm-mode-chip">読み取り専用</span>
     <span class="mm-form-hint">この表は見るだけです。追加・編集はできません。</span>${drop}</div>
    ${defHintHtml(def)}`;
   form.onsubmit=ev=>ev.preventDefault();
   const db=$('#mmDropTable');
   if(db)db.onclick=()=>WL.mm.dropRetiredTable(def);
   return;
  }
  if(defUsesEditorModal(def)){
   form.classList.add('mm-form-compact');
   form.innerHTML=`<div class="mm-form-head">
     <span class="mm-mode-chip new">新規登録</span>
     <button type="button" id="masterMaintAdd" class="mm-btn-primary sm">＋ ${esc(def.label)}を追加</button>
     <span class="mm-form-hint">一覧の行をクリック（またはダブルクリック・「編集」ボタン）で編集ウィンドウを開きます。</span>
     ${sampleReportHtml(def)}
     ${linkMasterHtml(def)}
     ${bulkDeleteHtml(def)}
    </div>
    ${defHintHtml(def)}
    ${excelIoHtml(def)}`;
   form.onsubmit=ev=>ev.preventDefault();
   const ab=$('#masterMaintAdd');if(ab)ab.onclick=()=>openMaintEditor(null);
   bindExcelIo(def);bindBulkDelete(def);bindSampleReport(def);bindLinkMaster(def);
   return;
  }
  form.classList.remove('mm-form-compact');
  const controls=buildFieldControls(def,editing);
  const chip=editing?`<span class="mm-mode-chip editing">編集中 <b>${esc(editing[def.cols[0].k]||'')}</b><small>ID:${esc(editing.id)}</small></span>`:`<span class="mm-mode-chip new">新規登録</span>`;
  form.innerHTML=`<div class="mm-form-head">${chip}${editing?'<button type="button" id="masterMaintNew" class="mm-btn-ghost sm">＋ 新規入力に切替</button>':''}${sampleReportHtml(def)}${linkMasterHtml(def)}${bulkDeleteHtml(def)}</div>
   ${defHintHtml(def)}
   <div class="mm-form-fields">${controls}${
    typeof def.extraHtml==='function'?def.extraHtml(editing):''}</div>
   <div class="mm-form-tail"><button type="submit" class="mm-btn-primary">${editing?'更新を保存':'追加登録'}</button><span class="mm-form-hint">${editing?'キー項目（名称・区分など）も変更できます。保存すると同じIDのまま更新（リネーム）されます。同名が既にある場合は更新できません。':'必須(*)を入力して追加登録します。'}</span></div>
   ${excelIoHtml(def)}`;
  form.onsubmit=ev=>{ev.preventDefault();submitMaint()};
  const nb=$('#masterMaintNew');if(nb)nb.onclick=()=>{maintState.editing=null;renderMaintForm()};
  bindEquipmentPickers(form);bindInputHelpers(form);bindMaintTabs(form);bindMoreToggles(form);
  bindExcelIo(def);bindBulkDelete(def);bindSampleReport(def);bindLinkMaster(def);
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
  WL.modal.keepOpen(modal);
  /* **閉じ方は×／キャンセル／Escの3つ**（§9.221 ①）。背景クリックを
     止めたぶん、Escが無いモーダルは「どれが閉じてどれが閉じないか」を
     覚えることになる——規則が禁じた状態を以前より強い形で作ってしまう。
     変換中のEscは`escCloses()`が除く。 */
  document.addEventListener('keydown',e=>{
   if(WL.modal.escCloses(e)&&!modal.hidden){e.stopPropagation();closeMaintEditor()}
  },true);
  return modal;
 }
 function openMaintEditor(item){
  const def=currentDef();if(!defUsesEditorModal(def))return;
  const modal=ensureMaintEditor();
  /* 組み立ての盤を持つ窓は広く取る（§9.226 ④）。**印を付け外しすること**
     ——付けっぱなしにすると、次に開いた別のマスタの窓まで広いまま
     （`mm-form-page`と同じ作法・§9.222 ⑤）。 */
  const dlg=modal.querySelector('.mm-editor-dialog');
  if(dlg)dlg.classList.toggle('is-builder',def.fields.some(f=>f.type==='field-builder'));
  maintState.editing=item?Object.assign({},item):null;
  const editing=maintState.editing;
  $('#maintEditorEyebrow').textContent=def.label+'マスタ';
  /* 窓の題は**その行を名指しできる欄**から作る（§9.254 ③）。既定は一覧の
     先頭列だが、帳票ブロックのように先頭が「対象設備」のマスタだと
     「* を編集」としか出ず、どの塊を開いたのか分からない（親のマスタから
     直接この窓へ渡れるようにしたぶん、名前が出ないと迷子になる）。 */
  const titleKey=def.titleKey||def.cols[0].k;
  $('#maintEditorTitle').textContent=editing?`${String(editing[titleKey]??'')||'(名称なし)'} を編集`:`${def.label}を新規登録`;
  $('#maintEditorHint').textContent=editing
   ?'キー項目（名称・区分など）も変更できます。保存すると同じIDのまま更新されます。'
   :'必須(*)を入力して登録します。';
  $('#maintEditorSave').textContent=editing?'更新を保存':'追加登録';
  modal.querySelector('.mm-editor-dialog')?.classList.remove('is-wide','is-tall');
  $('#maintEditorSave').onclick=()=>submitMaint('#maintEditorForm');
  const form=$('#maintEditorForm');
  /* **決めることの隣に、刷り上がりを置く**（§9.249 ③）。`asideHtml`を持つ
     マスタだけ2段組みになる（持たないマスタは今までどおり1段）。 */
  /* **窓の説明は一覧の説明と同じにしない**（§CLAUDE 8）。一覧の`hint`は
     「このマスタは何か」を書くので長い。窓では**いま決めることの一言**だけを
     出し、詳しくは各欄の説明が言う（`hintShort`を持たないマスタは今までどおり）。 */
  const modalHint=def.hintShort||def.hint;
  form.innerHTML=`${defHintHtml(def,modalHint)}
   <div class="mm-form-fields">${buildFieldControls(def,editing)}${
    typeof def.extraHtml==='function'?def.extraHtml(editing):''}</div>
   ${typeof def.asideHtml==='function'?def.asideHtml(editing):''}`;
  form.onsubmit=ev=>{ev.preventDefault();submitMaint('#maintEditorForm')};
  bindEquipmentPickers(form);bindInputHelpers(form);bindMaintTabs(form);bindMoreToggles(form);
  if(typeof def.bindAside==='function')def.bindAside(form);
  modal.hidden=false;
  /* **最初のフォーカスに「候補が出る欄」を選ばない**（§9.221 ④）。タグ入力は
     フォーカスした時点で候補の一覧を開くので、窓を開けた瞬間にその一覧が
     **他の欄の上へかぶさる**——欄を横に並べるようにしたぶん、下ではなく
     隣の欄を覆う（実測: 設備停止の「標準所要分」の＋が候補に覆われて
     押せず、`tests/test_stopcat.js`が30秒待って落ちた）。
     打ち込む欄が1つも無いときだけタグ入力へ落とす。
     `type=hidden`は除く——選択肢の組み合わせ欄が値を持つための隠し欄で、
     フォーカスは載らない（載らないまま「当てた」ことにすると、次の欄へ
     進めない）。 */
  requestAnimationFrame(()=>{
   const first=form.querySelector('[data-field]:not([type=hidden])')
             ||form.querySelector('[data-equipment-search]');
   if(first)first.focus();
  });
 }
 function closeMaintEditor(){
  const modal=$('#maintEditorModal');if(!modal||modal.hidden)return;
  modal.hidden=true;maintState.editing=null;
  /* 描き直す先はタブごとに違う。**汎用の一覧を呼ぶと専用タブの中身が
     消える**ので、いまのタブに合わせる。 */
  /* 専用画面は登録簿（`WL.mm.special`・§9.324 R3）が持つ`onEditorClose`で
     描き直す。**閉じたら描き直すだけ**（§9.222 ⑥）。以前ここには「op-item なら
     項目を1つ足す／op-choice ならまとまりを作る」という分岐があった。専用画面には
     編集モーダルが無かったので到達しない死んだ分岐だったが、選択肢の値を
     汎用モーダルへ寄せた時点で**閉じるたびに新しいまとまりが増える**ように
     なる。追加は追加のボタンからだけ始める。 */
  const sp=WL.mm.special[currentDef().special];
  if(sp&&sp.onEditorClose){sp.onEditorClose();return}
  renderMaintList();
 }
 /* 入力支援の配線(§9.49)。buildFieldControls()が出した各型を動かす。
    どの型も「data-field を持つ要素の value が最終的な値」という約束を守るので、
    submitMaint()側は型を知らなくてよい。 */
 /* 見て選ぶ欄の配線（§9.249 ③）。**値は隠し欄が持つ**ので、
    押したら`change`を飛ばす——`data-when`の出し入れも紙の見本も、
    値が変わったことを`change`で知る（§9.218 ②と同じ作法）。 */
 function mmSetHidden(form,key,value){
  const el=form.querySelector(`[data-field="${CSS.escape(key)}"]`);
  if(!el)return;
  el.value=String(value);
  el.dispatchEvent(new Event('change',{bubbles:true}));
 }
 function bindChoiceCards(form){
  form.querySelectorAll('[data-card]').forEach(b=>{
   if(b.dataset.cardWired)return;
   b.dataset.cardWired='1';
   b.onclick=()=>{
    const k=b.dataset.card,v=b.dataset.cardV;
    form.querySelectorAll(`[data-card="${CSS.escape(k)}"]`).forEach(x=>{
     const on=x===b;x.classList.toggle('is-on',on);x.setAttribute('aria-pressed',on?'true':'false');
    });
    mmSetHidden(form,k,v);
   };
  });
 }
 /* 入切の札（§9.302）。**いま何が起きるかを文字で書く**（§4）——0個に
    したら「どの機能でも使いません」と言い切る（黙って一覧から消えると、
    設定したことと画面で起きたことが結び付かない）。 */
 function bindCheckSets(form){
  form.querySelectorAll('[data-checkset-box]').forEach(box=>{
   const k=box.dataset.checksetBox;
   /* §9.306 **保存するのがどちら側か**は箱が言う（`on`＝選んだ側）。
      配線は同じなので、ここだけ分ければ済む。 */
   const keepOn=box.dataset.checksetMode==='on';
   const paint=()=>{
    const btns=[...box.querySelectorAll('[data-checkset]')];
    const off=btns.filter(b=>b.getAttribute('aria-pressed')!=='true');
    const names=a=>a.map(b=>b.querySelector('b')?.textContent||'').filter(Boolean).join('・');
    if(keepOn){
     const yes=btns.filter(b=>b.getAttribute('aria-pressed')==='true');
     /* **全部選んでいれば空で保存**——「すべての親」は空欄で表す
        （`[対象設備]`と同じ。行を作るたびに全部を書かせない）。 */
     mmSetHidden(form,k,off.length?yes.map(b=>b.dataset.checksetV).join(','):'');
     const note0=box.querySelector(`[data-checkset-note="${CSS.escape(k)}"]`);
     if(note0){
      note0.textContent=!btns.length?''
       :!off.length?'どの親でも出ます（既定）。'
       :!yes.length?'どの親でも出ません（この値は選べなくなります）。'
       :`${names(yes)}のときだけ出ます。`;
      note0.classList.toggle('is-warn',!!btns.length&&!yes.length);
     }
     return;
    }
    mmSetHidden(form,k,off.map(b=>b.dataset.checksetV).join(','));
    const note=box.querySelector(`[data-checkset-note="${CSS.escape(k)}"]`);
    if(note){
     const on=btns.length-off.length;
     /* **呼び名は札から読む**（§9.163）——文言へ書き写すと、機能を1つ
        足したり呼び名を変えたときに、ここだけ古いことを言い続ける。 */
     const say=(t,list)=>String(t||'').replace('{names}',names(list));
     note.textContent=!btns.length?''
      :on===btns.length?say(box.dataset.checksetAll,btns)
      :on===0?say(box.dataset.checksetNone,btns)
      :say(box.dataset.checksetSome,off);
     note.classList.toggle('is-warn',on===0);
    }
   };
   box.querySelectorAll('[data-checkset]').forEach(b=>{
    if(b.dataset.checksetWired)return;
    b.dataset.checksetWired='1';
    b.onclick=()=>{
     const on=b.getAttribute('aria-pressed')!=='true';
     b.setAttribute('aria-pressed',on?'true':'false');
     b.classList.toggle('is-on',on);
     const ico=b.querySelector('.mm-card-ico');if(ico)ico.textContent=on?'✓':'—';
     paint();
    };
   });
   paint();
  });
 }
 /* ---------- 「− 数 ＋」の配線（§9.311 D/E） ----------
    **値は隠し欄が持つ**（§9.250 ④）ので、ここがするのは
    ①押したら選べる並びの1つ隣へ ②隠し欄の`change`で文字を塗り直す、の2つ。
    **`change`でも塗ること**——紙の見本の縁を掴んで大きさを変えたときに
    文字が追随しないと、出ている数と実際の値が食い違う（§CLAUDE 6）。
    **端で止める**（一巡させない）——幅や行数は大小の並びなので、
    12の次が1へ戻ると「増やしたのに縮んだ」になる（§9.288 ③の`ダイヤル`と
    同じ理由）。押せないことは`disabled`で言う（§4）。 */
 function bindSteppers(form){
  form.querySelectorAll('.mm-stepfield').forEach(box=>{
   const step=box.querySelector('.mm-step');if(!step)return;
   const key=step.dataset.stepField;
   const isSpan=step.dataset.stepKind==='span';
   const opts=String(step.dataset.allow||'').split(',');
   if(!opts.length)return;
   const hidden=form.querySelector(`[data-field="${CSS.escape(key)}"]`);
   const read=box.querySelector(`[data-step-read="${CSS.escape(key)}"]`);
   const sub=box.querySelector(`[data-step-sub="${CSS.escape(key)}"]`);
   const max=12;
   /* **`0`は「中身なり」**（§9.250 ④）——保存済みの塊が`0`を持っているので、
      素で比べるとどの段にも当たらない。 */
   const norm=v=>{
    const t=String(v==null?'':v);
    if(isSpan)return String(Math.max(1,Math.min(max,Number(t)||max)));
    return (t==='0')?'':t;
   };
   const indexOf=v=>{
    const t=norm(v);
    const i=opts.indexOf(t);
    if(i>=0)return i;
    if(!isSpan)return 0;
    const n=Number(t)||0;
    return opts.reduce((bi,x,k)=>Math.abs(Number(x)-n)<Math.abs(Number(opts[bi])-n)?k:bi,0);
   };
   const label=v=>isSpan?`${v} / ${max} マス`
                        :(String(v)===''?'中身なり':`${v} 行`);
   const subText=v=>isSpan?mmFracText(Number(v)||0,max)
     :(String(v)===''?'描いてから測って、中身の高さに合わせます'
                     :`1行＝紙の1/${WL.mm.RB_PAGE_ROWS}`);
   const paint=v=>{
    const i=indexOf(v),cur=opts[i];
    if(read)read.textContent=label(cur);
    if(sub)sub.textContent=subText(cur);
    step.querySelectorAll('[data-step]').forEach(b=>{
     const d=Number(b.dataset.step)||0;
     const at=i+d;
     b.disabled=at<0||at>=opts.length;
     b.title=b.disabled?(d<0?'これ以上小さくできません':'これ以上大きくできません')
                       :`${label(opts[at])}にします`;
    });
   };
   if(!box.dataset.stepWired){
    box.dataset.stepWired='1';
    step.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{
     const i=indexOf(hidden?hidden.value:''),d=Number(b.dataset.step)||0;
     const at=Math.max(0,Math.min(opts.length-1,i+d));
     paint(opts[at]);mmSetHidden(form,key,opts[at]);
    });
    if(hidden)hidden.addEventListener('change',()=>paint(hidden.value));
   }
   paint(hidden?hidden.value:'');
  });
 }
 function bindInputHelpers(form){
  bindChoiceCards(form);bindCheckSets(form);bindSteppers(form);
  bindNumberFields(form);
  bindDateFields(form);
  bindComboFields(form);
  bindPathFields(form);
  WL.mm.bindFieldBuilders(form);
  bindWhenFields(form);
  bindRoleCapFields(form);
 }
 /* ---------- 権限区分でマスタ編集の段を頭打ちにする（§9.322、利用者の指示
    「権限区分以上の権限は付与できないようにしてください」） ----------
    **上限の表はサーバーが答える**（`/api/access-permission-master`の
    `masterEditByRole`）——画面へ写すと、上限を1つ直したときに片方だけ
    古い約束のまま残る（§9.163）。ここがするのは、届いた並びに無い段を
    **押せなくして理由を書く**（§4）ことだけ。
    **候補ごと消さないこと**——消すと「なぜ選べないのか」が読めなくなるし、
    区分を戻したときに元の段へ戻せない。 */
 function bindRoleCapFields(form){
  const role=form.querySelector('[data-field="role"]');
  const level=form.querySelector('[data-field="masterEdit"]');
  if(!role||!level)return;
  const note=level.closest('.mm-field')?.querySelector('.mm-field-hint');
  const apply=()=>{
   const table=(maintState.meta&&maintState.meta.masterEditByRole)||null;
   const allow=table?table[role.value]:null;
   const ok=Array.isArray(allow)?allow:null;
   [...level.options].forEach(o=>{
    const on=!ok||ok.indexOf(o.value)>=0;
    o.disabled=!on;
    o.title=on?'':`権限区分「${role.value}」には与えられません`;
   });
   /* 選べない段が選ばれたままなら、**上限まで下げる**（保存で断られる値を
      画面に残さない）。上限は並びの最後（サーバーが下から順に返す）。 */
   if(ok&&ok.length&&ok.indexOf(level.value)<0)level.value=ok[ok.length-1];
   if(note){
    note.textContent=ok
     ?`権限区分「${role.value}」で選べるのは ${ok.join('・')} です。`
     :'選べるのは権限区分の上限までです（設備作業者は「非表示」だけ）。';
   }
  };
  if(!role.dataset.capWired){role.dataset.capWired='1';role.addEventListener('change',apply)}
  apply();
 }
 /* ---------- 選んで組み立てる（§9.226 ④、利用者の指示） ----------
    保存の形は`ラベル=出どころ`の並びのままで、**書く手段だけ**を変える。
    候補（`catalog`）はサーバーが答えたものをそのまま並べる——操業データの
    項目もここに入るので、現場が項目を足せば候補に増える。

    **右（載せる項目）が正**。押す・掴む・ラベルを直す、どの操作のあとも
    `syncFieldBuilder()`が隠し欄（`data-field`）へ書き戻す——書き戻しを
    1箇所にしておかないと、「並べ替えただけでは保存されない」のような
    片方だけ効く状態が作れる（§9.201と同じ形）。 */
 const fbCatalog={groups:[],loadedFor:null,loading:null};

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
    }catch(e){WL.quiet.note('壊れたURIは無視',e)}
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
  WL.modal.keepOpen(modal);
  /* Escでも閉じる（§9.221 ①）。**選ばなかった**ことにするので`null`。 */
  document.addEventListener('keydown',e=>{
   if(WL.modal.escCloses(e)&&!modal.hidden){e.stopPropagation();close(null)}
  },true);
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
   const opts=WL.records.equipmentMasterState.items||[];
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
   if(!box){box=document.createElement('div');box.className='mm-loading';box.innerHTML='<div class="mm-loading-box">'+WL.loader.html(16)+'<b></b></div>';dialog.appendChild(box)}
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
  const body={user_id:uid};let ok=true,firstMissing=null;
  if(editing)body.id=editing.id;
  def.fields.forEach(f=>{
   if(f.type==='equipment-multi'){body[f.k]=[...document.querySelectorAll(`${root} [data-equipment-field="${f.k}"]:checked`)].map(el=>el.value);return}
   if(f.type==='equipment-multi-text'){
    const all=document.querySelector(`${root} [data-equipment-all="${f.k}"]`);
    body[f.k]=all&&all.checked?EQUIPMENT_ALL
     :[...document.querySelectorAll(`${root} [data-equipment-field="${f.k}"]:checked`)].map(el=>el.value).join(',');
    // 必須のタグ欄(設備停止マスタの対象設備)は未選択で送らせない。素の入力欄と
    // 違い、空でも「未設定」として通ってしまうため、ここで同じ扱いに揃える。
    if(f.required&&!body[f.k]){ok=false;
     if(!firstMissing)firstMissing=document.querySelector(`${root} [data-equipment-all="${f.k}"]`);}
    return;
   }
   const el=$(`${root} [data-field="${f.k}"]`);
   // 数値欄は表示用の3桁区切りが入っているので、送る前に外す(§9.49)
   const v=f.type==='number'?numRaw(el?el.value:''):String(el?el.value:'').trim();
   if(f.required&&!v){ok=false;if(!firstMissing)firstMissing=el}
   body[f.k]=v;
  });
  if(!ok){
   /* **入っていない欄の段を開いてから断る**（§9.250 ④・§4）——段（タブ）に
      分けたので、畳んだ先の欄を「入れてください」と言われても、どこにあるのか
      分からない。開いてから知らせる。 */
   const form=document.querySelector(root);
   if(form&&firstMissing){
    mmRevealField(form,firstMissing);
    if(firstMissing.focus){try{firstMissing.focus()}catch(e){WL.quiet.note('焦点を当てられない（値も操作も残る）',e)}}
   }
   showToast('入力を確認してください','必須項目が未入力です。',4000);return;
  }
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
   /* 画面が覚えている写しも捨てる（§9.216／§9.217）——マスタで足した直後に
      その画面を開くのがふつうの順番なので、写しを持ったままだと
      「登録したのに出てこない」になる。**「あれば使う」で呼ぶこと**
      （読み込み順に依存させない）。 */
   if(def.key==='reportBlock')WL.mm.forgetReportCaches();
   if((def.key==='opItem'||def.key==='opChoice')&&window.WL&&WL.opData)WL.opData.forget();
   /* ロールを足した直後に異常位置判定を開くのがふつうの順番なので、
      控えを持ったままだと「登録したのに候補に出ない」になる（§9.241 ④）。 */
   if(def.key==='roll'&&window.WL&&WL.defect&&WL.defect.forgetRolls)WL.defect.forgetRolls();
   /* 生の表を触ったら件数の写しを捨てる（§9.249 ②）。持ったままだと
      「足したのに件数が増えない」になる。 */
   if(def.rawTable)WL.mm.mtState.loaded=false;
   /* **保存した行の群は開く**（§9.241 ①）——畳んだ設備へ足したとき、
      保存できたのに一覧に出ないのは「消えた」と読まれる。 */
   if(def.groupBy)mmOpenGroupOf(def,body[def.groupBy]);
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
  /* **言い回しはdefが決める**（§9.249 ②）。有効フラグを持つマスタの削除は
     「無効化」だが、生の表は**本当に行が消える**——同じ文言で言うと嘘になる。 */
  const word=def.deleteWord||'無効化（削除）';
  if(!await confirmModal(`${def.label}「${nm}」を${word}しますか？`))return;
  try{
   setMaintLoading(true,`${def.label}を${def.deleteWord||'無効化'}しています…`);
   await api(def.endpoint+'/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,user_id:uid})});
   /* **消したら写しも捨てる**（§9.274）——持ったままだと「消したのに紙に
      残っている」になる（足したときと同じ理由。§9.217）。 */
   if(def.key==='reportBlock')WL.mm.forgetReportCaches();
   if(maintState.editing&&maintState.editing.id===item.id)maintState.editing=null;
   await loadMaint(true);showToast&&showToast(def.label+'を'+(def.deleteWord||'無効化')+'しました',nm,3600);
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
 /* ================================================================
    一覧の並べ替えと列幅（§9.250 ⑥、利用者の指示）
    ----------------------------------------------------------------
    「マスタのデータが並べてある、よく使われている表は並び替え、列幅調整
      できるようにしてください。」

    ・**覚えるのはこの端末**（`MasterListViewV1`）。読み方の好みなので、
      共有マスタへ入れて全員を縛らない（§9.199の`childBadge`と同じ）。
    ・**列幅の掴み方は書き写さない**——`WL.columnWidthGrip`をそのまま呼ぶ
      （§9.164。仕掛一覧・データ一覧・実績と同じ手つきになる）。
    ・**触ったことは画面に出し、戻す手立てを同じ場所に置く**（§9.175）。
    ================================================================ */
 const MM_VIEW_KEY='MasterListViewV1';
 let mmViewPref=null;
 function mmView(){
  if(mmViewPref)return mmViewPref;
  try{mmViewPref=JSON.parse(localStorage.getItem(MM_VIEW_KEY)||'{}')||{}}catch(e){mmViewPref={}}
  return mmViewPref;
 }
 function mmViewOf(def){const v=mmView()[def.key];return v&&typeof v==='object'?v:{}}
 function mmViewSet(def,patch){
  const all=mmView();
  const cur=Object.assign({},all[def.key]||{},patch);
  if(!cur.sort&&!(cur.widths&&Object.keys(cur.widths).length))delete all[def.key];
  else all[def.key]=cur;
  try{localStorage.setItem(MM_VIEW_KEY,JSON.stringify(all))}catch(e){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',e)}
 }
 function mmViewTouched(def){
  const v=mmViewOf(def);
  return !!(v.sort||(v.widths&&Object.keys(v.widths).length));
 }
 /* 幅は**指定があるものだけ**px で固定し、残りは今までどおり割合で分ける
    （§9.119と同じ考え方。全部を px にすると器の広さに追随しなくなる）。 */
 function maintGridTemplate(def){
  const w=mmViewOf(def).widths||{};
  const data=def.cols.map(c=>w[c.k]?`${Math.round(w[c.k])}px`:`minmax(0,${c.grow||1}fr)`).join(' ');
  return maintShowsAudit(def)?`${data} 96px 128px 108px`:`${data} 108px`;
 }
 /* 並べ替えの物差し。**空欄は必ず最後**（向きを変えても最後）——空欄が
    先頭に集まると、探している行が画面の外へ押し出される（§9.187の
    「向きは塊の中の値だけを反転する」と同じ考え方を、小さく持つ）。
    数字は数として、それ以外は日本語の並びで比べる。 */
 function mmSortValue(it,col){
  const raw=it[col.k];
  const t=String(raw??'').trim();
  if(!t)return {empty:true,n:0,s:''};
  const n=Number(t.replace(/,/g,''));
  return {empty:false,n:Number.isFinite(n)?n:null,s:t.normalize('NFKC')};
 }
 function mmSortItems(def,items){
  const sort=mmViewOf(def).sort;
  if(!sort)return items;
  const col=(def.cols||[]).find(c=>c.k===sort.k);
  if(!col)return items;
  const dir=sort.dir==='desc'?-1:1;
  /* **安定に並べる**（同点は元の順のまま）。`Array.prototype.sort`は
     仕様上安定だが、比較が0を返さないと崩れるので明示的に添え字で解く。 */
  return items.map((it,i)=>({it,i})).sort((a,b)=>{
   const x=mmSortValue(a.it,col),y=mmSortValue(b.it,col);
   if(x.empty!==y.empty)return x.empty?1:-1;      // 空欄は向きによらず最後
   if(!x.empty){
    if(x.n!==null&&y.n!==null&&x.n!==y.n)return (x.n-y.n)*dir;
    if(x.s!==y.s)return x.s.localeCompare(y.s,'ja')*dir;
   }
   return a.i-b.i;
  }).map(x=>x.it);
 }
 function filteredMaintItems(def){
  const q=String(maintState.query||'').trim().normalize('NFKC').toLowerCase();
  let items=maintState.items||[];
  if(q)items=items.filter(it=>{const hay=[...def.cols.map(c=>it[c.k]),it.updated_by].map(v=>String(v??'').normalize('NFKC').toLowerCase()).join(' ');return hay.includes(q)});
  return mmSortItems(def,items);
 }
 /* ---------- 束ねた見出しの開閉（§9.241 ①、利用者の指示「ロールマスタに
    ついて、設備名毎に折りたためるようにしてください」） ----------
    ロールは設備ごとに何十本もあり、`groupBy`で束ねてはいたが**全部が出たまま**
    だったので、目的の設備へ着くまで他の設備を通り過ぎることになっていた。

    ・**畳んだ群の行は作らない**（§9.104）。`display:none`で隠すだけでは
      レイアウトから外れないので、行が増えるほど描き直しが重くなる。
    ・**覚えるのはこの端末**（読み方の好みなのでPCごとに違ってよい。§9.199の
      `childBadge`と同じ）。**触った群だけ**を覚え、触っていない群は既定
      （開く）に追随する——既定を変えないので、今までの見え方は変わらない。
    ・**絞り込み中は畳まない**——畳んだ群の中に当たりがあると、見出しの件数
      だけが出て行が1つも出ない（探しているのに出ない、が起きる）。
      そのことは画面に書く（§CLAUDE 2）。
    ・**登録・更新した行の群は開く**（§CLAUDE「思い出させない」）——畳んだ
      設備へ足したとき、保存できたのに一覧に出ないのは「消えた」と読まれる。 */
 const MM_FOLD_KEY='MasterListFoldV1';
 let mmFoldPref=new Map();
 try{mmFoldPref=new Map(Object.entries(JSON.parse(localStorage.getItem(MM_FOLD_KEY)||'{}')))}catch(e){WL.quiet.note('端末の覚えが読めない（既定で続ける）',e)}
 const mmFoldKey=(def,g)=>`${def.key}::${g}`;
 function mmFoldRemember(){try{localStorage.setItem(MM_FOLD_KEY,JSON.stringify(Object.fromEntries(mmFoldPref)))}catch(e){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',e)}}
 function mmIsFolded(def,g){return mmFoldPref.get(mmFoldKey(def,g))===true}
 function mmSetFolded(def,g,on){
  /* **開いた群は覚えない**（鍵ごと消す）——既定が「開く」なので、
     覚えると既定を変えたときに追随しなくなる。 */
  if(on)mmFoldPref.set(mmFoldKey(def,g),true);else mmFoldPref.delete(mmFoldKey(def,g));
  mmFoldRemember();
 }
 /* 束ねの見出し。**空を「すべての設備」と読み替えないこと**（§9.239 ⑥ 訂正）
    ——1行＝1設備になったので「すべて」という状態は無く、空は**設備が
    決まっていない直すべき行**。「すべての設備」と出すと、壊れている行が
    正常に見えて誰も直さない（§CLAUDE 4）。 */
 function maintGroupLabel(v){
  const t=String(v??'').trim();
  return t&&t!=='*'?t:'設備が未設定（この行を開いて設備を選んでください）';
 }
 /* 保存した行の群を開く。**畳みの鍵は見出しの文字**なので、生の値ではなく
    `maintGroupLabel()`を通してから消す（通さないと、設備が未設定の行を
    足したときに畳んだままになる）。 */
 function mmOpenGroupOf(def,rawValue){
  if(!def||!def.groupBy)return;
  mmSetFolded(def,maintGroupLabel(rawValue),false);
 }
 function maintGroupHeadEl(def,info){
  const h=document.createElement('div');
  h.className='mm-group-head'+(info.folded?' is-folded':'');
  h.setAttribute('role','button');h.tabIndex=0;
  h.setAttribute('aria-expanded',info.folded?'false':'true');
  h.dataset.mmGroup=info.label;
  /* **状態は色だけで伝えない**（§CLAUDE 3）——印(▸/▾)と一緒に、件数と
     「畳んでいます」を必ず文字で出す。 */
  h.innerHTML=`<i class="mm-group-mark" aria-hidden="true">${info.folded?'▸':'▾'}</i>`
   +`<b>${esc(info.label)}</b><span>${info.count}件</span>`
   +(info.folded?'<span class="mm-group-folded">畳んでいます（押すと開きます）</span>':'');
  h.title=info.folded
   ?`${info.label} の${def.label} ${info.count}件を畳んでいます。押すと開きます。`
   :`${info.label} に登録されている${def.label}です（${info.count}件）。押すと畳みます。`;
  const toggle=()=>{
   mmSetFolded(def,info.label,!info.folded);
   renderMaintList();
   /* 押した見出しを画面の中へ戻す。**上の群を畳むと下が巻き上がる**ので、
      戻さないと押した場所が視界から消える（何が起きたのか読めない）。
      見出しは作り直されているので、**同じ文字の見出しを引き直す**
      （属性セレクタは設備名に引用符が入ると壊れる）。 */
   const back=[...document.querySelectorAll('#masterMaintList .mm-group-head')]
    .find(el=>el.dataset.mmGroup===info.label);
   if(back)back.scrollIntoView({block:'nearest'});
  };
  h.onclick=toggle;
  h.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle()}};
  return h;
 }
 /* 一覧の上の「すべて開く／すべて畳む」。**群を持たないマスタでは帯ごと
    出さない**（押せるのに何も起きないボタンを置かない・§CLAUDE 4）。 */
 function renderMaintFoldTools(def,groups,searching){
  const box=$('#masterMaintFold');if(!box)return;
  if(!def.groupBy||!groups.length){box.hidden=true;box.innerHTML='';return}
  box.hidden=false;
  const open=groups.filter(g=>!g.folded).length;
  const allOpen=open===groups.length;
  box.innerHTML=`<b class="mm-fold-state">${groups.length}${esc(def.groupWord||'設備')}`
    +` <span>${searching?'絞り込み中は全部開きます':`開 ${open} / 畳 ${groups.length-open}`}</span></b>`
   +`<button type="button" class="mm-btn-ghost sm" data-mm-fold="open"${allOpen?' disabled':''}`
   +` title="${allOpen?'すべて開いています':'畳んでいる'+esc(def.groupWord||'設備')+'をすべて開きます'}">すべて開く</button>`
   +`<button type="button" class="mm-btn-ghost sm" data-mm-fold="close"${(searching||!open)?' disabled':''}`
   +` title="${searching?'絞り込み中は畳みません（当たった行が出なくなるため）'
      :(open?'見出しだけを残して行を畳みます':'すべて畳んでいます')}">すべて畳む</button>`;
  box.querySelectorAll('[data-mm-fold]').forEach(b=>b.onclick=()=>{
   const close=b.dataset.mmFold==='close';
   groups.forEach(g=>mmSetFolded(def,g.label,close));
   renderMaintList();
  });
 }
 function renderMaintList(){
  const def=currentDef(),list=$('#masterMaintList');if(!list)return;
  const all=maintState.items||[],items=filteredMaintItems(def),tmpl=maintGridTemplate(def);
  const cnt=$('#masterMaintCount');
  if(cnt){
   /* **覚えていることは画面に書き、忘れさせる手立ても同じ場所に置く**
      （§9.175・§9.250 ⑥）。黙って並べ替えたままだと「順番がおかしい」と
      読まれる。件数の隣に、いま効いている並びと戻すボタンを出す。 */
   const v=mmViewOf(def),sc=(def.cols||[]).find(c=>v.sort&&c.k===v.sort.k);
   const wn=Object.keys(v.widths||{}).length;
   const marks=[];
   if(sc)marks.push(`並び: ${esc(sc.label)} ${v.sort.dir==='desc'?'降順':'昇順'}`);
   if(wn)marks.push(`幅: ${wn}列`);
   cnt.innerHTML=(maintState.query?`${items.length} / 有効 ${all.length}件`:`有効 ${all.length}件`)
    +(marks.length?`<span class="mm-viewmark">${marks.map(esc).join('・')}`
      +`<button type="button" id="mmViewReset" title="この表の並びと列幅を既定へ戻します">✕</button></span>`:'');
   const rb=$('#mmViewReset');
   if(rb)rb.onclick=()=>{mmViewSet(def,{sort:null,widths:{}});renderMaintList()};
  }
  const showAudit=maintShowsAudit(def);
  /* 見出しは**押すと並べ替え・右端を引くと幅**（§9.250 ⑥）。
     いまの向きは矢印と`aria-sort`の両方で言う（色だけで伝えない・§CLAUDE 3）。 */
  const sort=mmViewOf(def).sort||null;
  const headCols=def.cols.map(c=>{
   const on=sort&&sort.k===c.k;
   const mark=on?(sort.dir==='desc'?'▼':'▲'):'';
   return `<span class="mm-th" data-col="${esc(c.k)}" role="button" tabindex="0"`
    +` aria-sort="${on?(sort.dir==='desc'?'descending':'ascending'):'none'}"`
    +` title="${esc(c.label)}｜押すと並べ替え（もう一度で逆順・3回目で元の並び）／右端を引くと幅が変わります">`
    +`<b>${esc(c.label)}</b>${mark?`<i class="mm-th-mark" aria-hidden="true">${mark}</i>`:''}`
    +`<i class="mm-th-grip" aria-hidden="true"></i></span>`;
  }).join('');
  list.innerHTML=`<div class="mm-row head" style="grid-template-columns:${tmpl}">${headCols}${showAudit?'<span>更新者</span><span>更新日時</span>':''}<span class="mm-act">操作</span></div>`;
  bindMaintHeadTools(def,list);
  if(!items.length){
   /* 行が無いときは開閉の帯も出さない（畳む対象が無いのにボタンだけ残ると、
      押せるのに何も起きない・§CLAUDE 4）。 */
   renderMaintFoldTools(def,[],false);
   list.insertAdjacentHTML('beforeend',`<div class="mm-empty">${all.length&&maintState.query?'絞り込み条件に一致するデータがありません。':'有効なデータがありません。上のフォームから追加してください。'}</div>`);return}
  const frag=document.createDocumentFragment();
  /* ---------- 親子で束ねる(§9.239 ⑥、利用者の指示) ----------
     「設備のカラムはマスタに親子関係を持たせ、設備単位でロールマスタを
      持つ形とする」。**マスタを2つに割らない**——所属を変えるのは
     `[対象設備]`を1つ直すだけで済む（割ると、移すために消して作り直す
     ことになる）。見出しには**件数を文字で**添える（§3）。
     `groupBy`を持たないマスタは今までどおり平らに並ぶ。 */
  const gkey=def.groupBy||'';
  let lastGroup=null,foldedNow=false;
  /* 群ごとの件数と畳み。**出てくる順のまま**並べる（並べ替えるとサーバーが
     返した順＝表示順の設定が効かなくなる）。**絞り込み中は畳まない**
     （§9.241 ①）——当たった行が出ないと、探しているのに無いと読まれる。 */
  const searching=!!String(maintState.query||'').trim();
  const groups=[],gidx={};
  if(gkey)items.forEach(it=>{
   const g=maintGroupLabel(it[gkey]);
   if(gidx[g]===undefined){gidx[g]=groups.length;groups.push({label:g,count:0,folded:false})}
   groups[gidx[g]].count++;
  });
  groups.forEach(g=>{g.folded=!searching&&mmIsFolded(def,g.label)});
  renderMaintFoldTools(def,groups,searching);
  items.forEach(it=>{
   if(gkey){
    const g=maintGroupLabel(it[gkey]);
    if(g!==lastGroup){
     lastGroup=g;
     const info=groups[gidx[g]];
     foldedNow=info.folded;
     frag.append(maintGroupHeadEl(def,info));
    }
    /* 畳んだ群の行は**作らない**（§9.104。隠すだけでは組み直しが重い）。 */
    if(foldedNow)return;
   }
   const row=document.createElement('div');row.className='mm-row'+(maintState.editing&&maintState.editing.id===it.id?' editing':'');row.style.gridTemplateColumns=tmpl;row.tabIndex=0;row.setAttribute('role','button');
   // 列として出さない監査情報(更新者・更新日時)は行のツールチップで補う。
   const audit=`更新者: ${it.updated_by||'-'} / 更新日時: ${fmtDT(it.updated_at)}`;
   row.title=showAudit?'クリックで編集フォームに読み込みます':`クリックで編集\n${audit}`;
   const cells=def.cols.map(c=>{const v=cellText({...c,row:it},it[c.k]);
    return `<span title="${esc(v)}">${esc(v)||'<em class="mm-blank">—</em>'}</span>`}).join('');
   const acts=def.readOnly?'<em class="mm-blank">—</em>'
     :`<button type="button" class="mm-edit" title="この行の内容を編集します">編集</button>${def.hasDelete?'<button type="button" class="mm-del" title="この行を削除します（確認画面が出ます）">削除</button>':''}`;
   row.innerHTML=`${cells}${showAudit?`<span class="mm-user" title="${esc(it.updated_by||'')}">${esc(it.updated_by||'-')}</span><span class="mm-date">${esc(fmtDT(it.updated_at))}</span>`:''}<span class="mm-act">${acts}</span>`;
   // 入力項目が多いマスタは編集専用モーダル、少ないマスタは従来どおり
   // 上部のインラインフォームへ読み込む(ARCHITECTURE.md「マスタ管理の画面形態」、defUsesEditorModal)。
   const edit=()=>{
    if(defUsesEditorModal(def)){openMaintEditor(it);return}
    maintState.editing=Object.assign({},it);renderMaintForm();
    const f=$('#masterMaintForm');if(f)f.scrollIntoView({block:'nearest'});
   };
   const eb=row.querySelector('.mm-edit');if(eb)eb.onclick=e=>{e.stopPropagation();edit()};
   const del=row.querySelector('.mm-del');if(del)del.onclick=e=>{e.stopPropagation();deleteMaint(it)};
   if(!def.readOnly){
    row.onclick=()=>edit();row.ondblclick=()=>edit();
    row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){if(e.key===' ')e.preventDefault();edit()}};
   }
   frag.append(row);
  });
  list.append(frag);
 }
 /* 見出しの配線（§9.250 ⑥）。**掴む道具は書き写さない**——列幅は
    `WL.columnWidthGrip`（§9.164）が「掴む→追う→離す→保存」を持っている。 */
 function bindMaintHeadTools(def,list){
  list.querySelectorAll('.mm-row.head>.mm-th').forEach(cell=>{
   const key=cell.dataset.col;
   const sortNow=()=>{
    const cur=mmViewOf(def).sort;
    /* 3回で一周する（昇順→降順→元の並び）。**戻す道を同じ場所に置く**
       ——別に「戻す」を作ると、押した本人が探すことになる（§CLAUDE 4）。 */
    const next=!cur||cur.k!==key?{k:key,dir:'asc'}
      :cur.dir==='asc'?{k:key,dir:'desc'}:null;
    mmViewSet(def,{sort:next});
    renderMaintList();
   };
   cell.addEventListener('click',e=>{
    if(e.target.closest('.mm-th-grip'))return;     // 取っ手は並べ替えに渡さない
    sortNow();
   });
   cell.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();sortNow()}
   });
   const grip=cell.querySelector('.mm-th-grip');
   if(!grip||typeof WL.columnWidthGrip!=='function')return;
   /* **今そこに在る見出しから測る**（§9.211 ①）——一覧は`innerHTML`ごと
      作り直されるので、綴じ込んだ`cell`はすぐ孤児になる。孤児は幅0で、
      掴んでも動かない。 */
   const liveCell=()=>document.querySelector(
     `#masterMaintList .mm-row.head>.mm-th[data-col="${CSS.escape(key)}"]`)||cell;
   WL.columnWidthGrip(grip,{
    startWidth:()=>liveCell().getBoundingClientRect().width,
    /* 引いている最中は**トラックだけ**入れ替える（行を作り直さない）。 */
    preview:w=>{
     const widths=Object.assign({},mmViewOf(def).widths||{},{[key]:w});
     const tmpl=(()=>{
      const data=def.cols.map(c=>widths[c.k]?`${Math.round(widths[c.k])}px`:`minmax(0,${c.grow||1}fr)`).join(' ');
      return maintShowsAudit(def)?`${data} 96px 128px 108px`:`${data} 108px`;
     })();
     document.querySelectorAll('#masterMaintList .mm-row').forEach(r=>r.style.gridTemplateColumns=tmpl);
    },
    commit:w=>{
     mmViewSet(def,{widths:Object.assign({},mmViewOf(def).widths||{},{[key]:w})});
     renderMaintList();
    },
   });
  });
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
  if(typeof WL.records.withWaiting!=='function')return loadMaintInner(force);
  return WL.records.withWaiting({title:def.label+'マスタを読み込んでいます',detail:'マスタDB: '+(def.endpoint||'-'),
   progress:'登録済みの内容を取得しています'},()=>loadMaintInner(force));
 }
 /* いま書けるかを**見出しの隣で名乗る**（§3・§9.322）。段の名前だけでなく
    「なぜこのタブが読むだけなのか」まで書く——「部分的編集可」だけだと、
    どのタブが該当するのかを覚えていないと読めない。 */
 function paintMasterEditLevel(def){
  const chip=$('#masterMaintLevel');if(!chip)return;
  const a=window.accessMode||{};
  const writable=masterDefWritable(def);
  if(writable&&def.readOnly&&!def.readOnlyByLevel){chip.hidden=true;return}  // 元から読むだけの表は既存の帯が言う
  if(writable){chip.hidden=true;return}
  const lv=masterEditLevel();
  const admin=Array.isArray(a.adminMasters)&&a.adminMasters.indexOf(def.key)>=0;
  chip.hidden=false;
  chip.textContent=lv==='部分的編集可'?'読み取り専用（管理のマスタ）':'読み取り専用';
  chip.title=lv==='部分的編集可'
   ?`この端末のマスタ編集は「部分的編集可」です。${admin?'このタブは権限・置き場・接続などの管理のマスタなので保存できません。':''}測定・帳票・設備・スケジュールの設定は今までどおり保存できます。`
   :`この端末のマスタ編集は「${lv}」です（権限区分: ${a.role||'不明'}）。保存が要る場合は、アクセス権限マスタで「マスタ編集」を上げてもらってください。`;
 }

 async function loadMaintInner(force){
  const def=currentDef();const title=$('#masterMaintTitle');
  /* いま何回目の読み込みか（§9.331）。**取りに行った応答は「いつの分か」で
     捨てる**（§9.200と同じ約束）——タブを切り替えると前の読み込みは止められ
     ないので、届いた時点で世代を突き合わせる。 */
  const gen=++maintState.loadGen;
  /* 見出しは**その画面の呼び名**。「〜マスタ」を機械的に足すと
     「データ接続マスタ」のような読みにくい名前ができる。 */
  if(title)title.textContent=def.titleText||(def.label+'マスタ');
  paintMasterEditLevel(def);
  // 設定ページ形式(パス設定・§9.68)はフォーム自体がスクロール領域になる。
  // タブを移ったら必ず外す(付いたままだと他のマスタで上部フォームが
  // 伸び縮みして一覧の高さが安定しない)。
  $('#masterMaintForm')?.classList.remove('mm-form-page');
  /* **器の高さを渡す印も必ず外す**（§9.222 ⑤。`mm-form-page`と同じ作法）。
     外し忘れると、他のマスタの一覧がスクロールしない枠になって行が切れる。 */
  const mList=$('#masterMaintList');
  if(mList){mList.classList.remove('is-fill');mList.parentElement?.classList.remove('is-fill')}
  /* 専用画面（`special:`）は**登録簿**から引く（§9.324 R3）。各画面のファイルが
     読み込み時に`WL.mm.registerSpecial()`で名乗るので、画面を1つ足すときに
     ここへ`if`を1行足す必要が無い。**名乗っていない`special`は黙って汎用へ
     落とさない**（§CLAUDE「公開漏れは黙って素通しになる」）。 */
  if(def.special){
   const sp=WL.mm.special[def.special];
   if(sp){setMaintSearchVisible(false);
    /* **描き終えたときに、まだそのタブが開いているか確かめる**（§9.331・§9.200）。
       専用の画面は取りに行ってから描くので、**取りに行っている最中に別のタブへ
       移ると、後から届いた前のタブの盤が今の画面を上書きする**——見出しだけ
       新しいマスタで、中身は前の盤（実際に「設備停止マスタ」の見出しの下に
       操業データ項目の盤が出て、「追加」が押せなくなった）。
       **負けたほうが今のタブを描き直す**（応答を捨てるだけでは、上書き済みの
       画面が戻らない）。 */
    return Promise.resolve(sp.load(force)).then(()=>{
     if(gen!==maintState.loadGen)return loadMaintInner(force);
    });}
   console.error('専用画面が登録されていません: '+def.special);
  }
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
  if(needsEquipmentMaster&&typeof WL.records.loadEquipmentMaster==='function'){try{await WL.records.loadEquipmentMaster(force)}catch(e){WL.quiet.note('設備マスタが読めなくても一覧の表示は継続する',e)}}
  renderMaintForm();
  try{
   const r=await api(def.endpoint);let items=(r&&r.items)||[];
   if(multiField)items=items.map(it=>({...it,[multiField.k+'Text']:(Array.isArray(it[multiField.k])&&it[multiField.k].length)?it[multiField.k].join('、'):'（制限なし・全設備）'}));
   /* 取りに行っている最中に別のタブへ移っていたら描かない（§9.331）。
      控え（`maintState.items`）まで書き換えると、いま開いているタブの
      一覧が前のタブの中身で並ぶ。 */
   if(gen!==maintState.loadGen)return;
   maintState.items=items;
   /* **語彙はサーバーだけが持つ**（§9.163）。GETの戻りの`items`以外の
      キー（ロールマスタの入出位置・接触面・駆動方式など）はここで控え、
      `master-suggest`の欄が候補として出す。画面へ写さないための1行。 */
   maintState.meta=r||{};
   renderMaintList();
   /* **語彙が届いてから当て直す**（§9.234 ⑧と同じ罠）——上のフォームは
      取得より前に描かれるので、届いた上限を当てる人がここに要る。 */
   const ff=$('#masterMaintForm');if(ff)bindRoleCapFields(ff);
  }catch(e){if(gen===maintState.loadGen&&list)list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }

 /* ---------- 換算係数モデル(docs/SCHEDULE_MODE_DESIGN.md §6・docs/decisions/9.8.md) ----------
    因子×水準の一覧(自動算出値・N数・上書き値)は「自動算出＋上書き」の2層
    構造で汎用CRUDのフォームに載らないため、専用の描画を持つ特別扱いにする。 */
 function openMasterMaint(defKey){
  WL.enterView('master');
  /* どのタブを開くか指定できる(§9.183)。左メニューの「再起動待ち」から
     押したときに、データ接続のタブを開いた状態で出すため。 */
  if(defKey&&allDefs().some(d=>d.key===defKey))maintState.defKey=defKey;
  const panel=ensureMaintPanel();
  WL.syncViewToolbar('master');   // 更新者ID(#mmHead)はパネル生成後にヘッダーへ載せる
  renderMaintNav();
  paintMaintUser();
  if(!maintDefVisible(currentDef()))maintState.defKey=firstVisibleDefKey();
  maintState.editing=null;maintState.query='';
  const se=$('#masterMaintSearch');if(se)se.value='';
  syncNav();panel.hidden=false;loadMaint(true);
  /* 専用タブを持たないマスタ（§9.249 ②）。**画面は待たせない**——届いたら
     ナビを描き直す。読めなくても他のタブは今までどおり使える。 */
  WL.mm.loadMasterTableCatalog().catch(WL.quiet('マスタ表の一覧を取れない（他のタブは今までどおり）'));
  /* 更新者IDは打ち込む欄では無くなった（§9.276 ③）ので、最初のフォーカスは
     絞り込みへ渡す（打てない物へ当てると、そこで手が止まる）。 */
  requestAnimationFrame(()=>{const s=$('#masterMaintSearch');if(s)s.focus()});
 }
 window.openMasterMaint=openMasterMaint;

 // #openMasterMaintのクリックはここ(document委譲・capture)一箇所のみで処理する。
 // 以前はbindMasterMaint()でボタン自身にもonclickを付けていたが、この

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
  if(!WL.modal.escCloses(e))return;
  // 編集モーダルが開いていればそちらだけ閉じる(画面自体は開いたまま)。
  if($('#maintEditorModal')&&!$('#maintEditorModal').hidden){closeMaintEditor();return}
 },true);
 /* 盤が専用画面へ渡すもの（§9.324 R3）。**ここに無い名前は他のファイルから
    見えない**——足すときは使う側の`const {…}=WL.mm`と対で。 */
 Object.assign(WL.mm,{CAPABILITY_LABEL,CAPABILITY_ORDER,CAPABILITY_SHORT,EQUIPMENT_ALL,allDefs,bindInputHelpers,bindMaintTabs,bindPathFields,closeMaintEditor,ensureMaintEditor,fbCatalog,firstVisibleDefKey,maintTabOpenable,fmtDT,hintHtml,loadMaint,maintState,mmFracText,mmSetHidden,numFieldHtml,numRaw,openMaintEditor,openMasterMaint,pageFoldHtml,pageTabsHtml,renderMaintNav,requireMaintUser,setMaintLoading,syncNav});
 WL.mm.setRawDefs=v=>{rawDefs=v};   // 生の表の一覧はデータ側が届ける（§9.249 ②）
})();
