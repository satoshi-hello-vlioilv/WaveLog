/* actuals-view.js: 実績データリスト（§9.241 ③、利用者の指示）
   ============================================================
   「メインメニューに『実績』のデータをリストとして表示する機能を実装して
    ください。設備単位で切り替えて対象期間のデータを一覧で確認できる機能が
    欲しいです。データ一覧の完了とは別扱いでデータを閲覧するのみで編集は
    しないので、閲覧権限で扱えるものとする。データ一覧の完了の方は、表示
    データ数は少ないが、今回実装したい実績データリストは作業時に記録した
    全データを扱える機能です。ここから、実装済みの帳票や、操業データ表の
    出力も出せるようにしてください。」

   データ一覧（`records-store.js`）との違いを最初に書いておく:
    ・**読む先が違う。** データ一覧は端末内(IndexedDB)＋共有DBの突合で、
      「保存を押していない途中経過」まで出す。実績は**共有された記録だけ**
      （`GET /api/measurement/actuals`）——編集しないので混ぜない。混ぜると
      途中経過が実績として紙に出る。
    ・**編集しない。** 開く・再開する・消すが無いので、**閲覧権限のまま
      使える**（サーバー側もGETだけ）。
    ・**絞り込みが違う。** 状態ではなく**設備＋期間**で絞る。データ一覧の
      「完了」は少数だが、こちらは作業のたびに記録された全部を扱う。

   **現場日と直はサーバーが答える**（§9.163・§9.195）。時刻→直の判定は
   `schedule_calc.resolve_shift_info()` の1箇所しか無いので、画面へ写さない。
   ============================================================ */
(function(){
 'use strict';
 window.WL=window.WL||{};
 const $id=id=>document.getElementById(id);

 /* 期間の既定は「今日を含む7日」。**全期間を既定にしない**——実績は増える
    一方なので、開いた瞬間に何千件も運ぶことになる（狭めるのは利用者の
    操作だが、広げるのは1回押せば済む）。 */
 const AC_DEFAULT_DAYS=7;
 const AC_TARGET='actuals:list';
 /* この端末の覚え（設備・期間の幅・基準）。**読み方の好みなのでPCごと**
    （§9.199の`childBadge`と同じ）。期間の「日付そのもの」は覚えない
    ——次に開いたときには古い日付になっているので、幅だけを覚える。 */
 const AC_PREF_KEY='ActualsViewPrefV1';

 const acState={equipment:'',from:'',to:'',basis:'work',days:AC_DEFAULT_DAYS,
                items:[],total:0,truncated:false,limit:0,loading:false,error:'',
                lotFields:[],opKeys:[],opDefs:[],equipments:[],selected:new Set(),
                /* 記録した値の候補（§9.288 ⑧）。**サーバーが答える**——
                   帳票の候補と同じ1箇所（`report_block_repo.field_catalog()`）。 */
                fieldCatalog:[],fieldNote:'',
                query:'',gen:0};

 function loadPref(){
  /* **既定はこの端末の使用設備**（§9.248 ⑥、利用者の指示「実施した設備ごとに
     見せる範囲を変えたい…他の設備の情報が表示されていたら混乱してしまい
     データも混ざってしまう」）。以前の既定は`''`＝すべての設備だったので、
     何も選ばずに開くと**他の設備の実績が混ざって並んでいた**。
     **覚えがあればそちらが勝つ**——「すべての設備」を明示的に選んだ人の
     見え方を勝手に戻さない（§9.132の作法）。使用設備が未登録の端末では
     今までどおりすべてを出す（絞る材料が無い）。 */
  try{
   const eq=(typeof currentConfiguredEquipment==='function')
     ?String(currentConfiguredEquipment()||'').trim():'';
   if(eq)acState.equipment=eq;
   const v=JSON.parse(localStorage.getItem(AC_PREF_KEY)||'{}')||{};
   /* `equipment`は**キーがあれば**そのまま採る（空文字＝「すべての設備」を
      選んだという意思表示なので、真偽値で見ると拾えない）。 */
   if(Object.prototype.hasOwnProperty.call(v,'equipment'))
    acState.equipment=String(v.equipment||'');
   if(v.basis==='cal')acState.basis='cal';
   const d=Number(v.days);
   if(Number.isFinite(d)&&d>0&&d<=3660)acState.days=d;
  }catch(e){WL.quiet.note('端末の覚えが読めない（既定で続ける）',e)}
 }
 function savePref(){
  try{localStorage.setItem(AC_PREF_KEY,JSON.stringify(
   {equipment:acState.equipment,basis:acState.basis,days:acState.days}))}catch(e){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',e)}
 }
 /* **`new Date('2026-08-18')`で組み立てないこと**（§9.195）——UTCの0時として
    読まれ、地方時へ直すと1日ずれる端末がある。地方時の年月日から文字列を作る。 */
 function ymd(d){
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
 }
 function shiftDays(base,n){
  const d=new Date(base.getFullYear(),base.getMonth(),base.getDate()+n);
  return ymd(d);
 }
 function applyDays(days){
  const now=new Date();
  acState.days=days;
  acState.to=ymd(now);
  acState.from=days>=3650?'':shiftDays(now,-(days-1));
 }

 /* ---------- 列 ----------
    **鍵は日本語の項目名**（§9.162）。英字キーにすると計算式が`[lotNo]`に
    なって書いた本人以外に読めない。 */
 const AC_COLUMNS=[
  {k:'#',virtual:true,def:1,track:'56px',cls:'ac-idx'},
  {k:'現場日',def:1,track:'110px',get:x=>x.workDate||'',
   note:'勤務区分マスタの日付補正が効いた日付です（暦とずれることがあります）。'},
  {k:'直',def:1,track:'72px',get:x=>x.shift||''},
  {k:'ロット番号',def:1,track:'minmax(96px,1fr)',get:x=>x.lotNo||''},
  {k:'検査番号',def:1,track:'minmax(84px,1fr)',get:x=>x.inspectionNo||''},
  {k:'鋳造番号',track:'minmax(84px,1fr)',get:x=>x.castingNo||''},
  {k:'状態',def:1,track:'78px',get:x=>x.status||''},
  {k:'作業開始',def:1,track:'132px',get:x=>localStamp(x.workStart)},
  {k:'作業終了',def:1,track:'132px',get:x=>localStamp(x.workEnd)},
  {k:'実働(分)',def:1,track:'80px',cls:'ac-num',get:x=>(x.durationMin==null?'':x.durationMin)},
  {k:'使用設備',track:'minmax(96px,1fr)',get:x=>x.equipment||''},
  {k:'更新者',def:1,track:'96px',get:x=>x.updatedBy||''},
  {k:'更新端末',track:'110px',get:x=>x.updatedPc||''},
  {k:'登録者',track:'96px',get:x=>x.createdBy||''},
  {k:'登録端末',track:'110px',get:x=>x.createdPc||''},
  {k:'更新日時',track:'146px',get:x=>localStamp(x.updatedAt)||x.updatedAtDb||''},
  {k:'日付(太陽暦)',track:'110px',get:x=>x.calDate||''},
  {k:'日付の出どころ',track:'118px',get:x=>({start:'作業開始',end:'作業終了',updated:'更新時刻'}[x.workDateFrom]||''),
   note:'現場日をどの時刻から決めたかです。同じ日付でも当たる見込みが違います。'},
  {k:'記録ID',track:'minmax(140px,1fr)',get:x=>x.id||''},
  {k:'操作',virtual:true,def:1,track:'128px',cls:'ac-act'},
 ];
 /* 値を持たない列（§9.105。**「出す/出さない」には従う**）。形は
    データ一覧の`RECORD_VIRTUAL`と同じ**辞書**——列の設定パネルが
    `panelSrc.virtual()[k].label` で引く。 */
 const AC_VIRTUAL={
  '#':{label:'#（行番号）',note:'絞り込んだあとの並びで数えた番号と、帳票をまとめて刷るための選択です。'},
  '操作':{label:'操作',note:'この記録の測定帳票を開くボタン。消しても、上の「選択した帳票」からは刷れます。'},
 };
 const AC_VIRTUAL_KEYS=new Set(Object.keys(AC_VIRTUAL));

 /* ISO(UTC)→地方時。**生のまま出さないこと**（§9.162）——保存値は末尾Zなので
    時差のぶんずれる。 */
 function localStamp(iso){
  if(!iso)return '';
  const d=new Date(iso);
  if(Number.isNaN(d.getTime()))return String(iso);
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
 }

 /* ---------- 記録した値ぜんぶを列にする（§9.288 ⑧、利用者の指示） ----------
    「実績データについては、一覧としてのリストは記録したすべてを対象に出力
     可能にしたいです。表示列についても対応できるように、実績として記録した
     すべてを一覧に出せるように、さらに表示列の機能で扱えるようにしてください。」

    以前は**仕掛の23件（`lotFields`）と操業データの項目名**だけだった。
    いまは**帳票と同じ候補**（`report_block_repo.field_catalog()`）をサーバーが
    返し、そこから列を作る——準備で決めた値・母材・揃い・品質等級・品質情報・
    仕掛の生の200列・作業時間・計算した値まで、記録に残っているものは全部
    選べる。**候補の一覧を画面へ写さない**（§9.163。操業データ項目を足せば
    帳票にも一覧にも同時に増える）。

    **値はサーバーが道で引く**（`actuals.field_values()`）——記録の中の置き場
    （母材は`mother.*`、生の列は`source.*`…）を知っているのはあちらだけで、
    ここへ写すと道を1本足したときに2箇所直すことになる（§9.285 ②と同じ）。
    **頼むのはいま出す列の道だけ**（§9.94）——1件で数百項目あるので、
    全部返すと一覧1回で数MBになる。 */
 function catalogColumns(){
  const out=[];
  (acState.fieldCatalog||[]).forEach(g=>{
   (g.items||[]).forEach(it=>{
    const label=String(it.label||'').trim();
    const path=String(it.path||'').trim();
    if(!label||!path)return;
    out.push({k:label,path,track:'minmax(84px,1fr)',origin:'rec',group:g.group||'',
              /* **どの群の項目かを説明に出す**（§6。同じ「板厚」でも
                 準備で決めた値と仕掛の生の列では出どころが違う）。 */
              note:(g.group?g.group+'：':'')+(it.note||g.note||''),
              /* **サーバーが引いた値だけを見る**——道の読み方（`source.`は
                 `.`で割らない等・§9.285 ④）を画面へ写さない。頼んでいない
                 道は`undefined`なので空欄になる。 */
              get:x=>((x&&x.fields)?(x.fields[path]??''):'')});
   });
  });
  return out;
 }
 /* 道 → 列名。**引くのは1箇所**（設定パネルの説明も一覧のセルもここを見る）。 */
 function pathOf(k){const c=columnOf(k);return (c&&c.path)||''}
 /* サーバーへ頼む道。**いま出す列＋保存済みの並びに載っている列**——
    出す列だけだと、1列出すたびに往復が要る（§9.94の「要る列だけ頼む」は
    「次に要る列も含めて1回で」の意味）。**上限はサーバー側が400で切る。** */
 function wantedPaths(){
  const seen=new Set(),out=[];
  const add=k=>{const p=pathOf(k);if(p&&!seen.has(p)){seen.add(p);out.push(p)}};
  try{visibleColumnKeys().forEach(add)}catch(e){WL.quiet.note('出す列を数えられない（残りの道で候補を作る）',e)}
  const layout=WL.columnLayout.get(AC_TARGET)||{};
  (layout.order||[]).forEach(add);
  return out;
 }
 /* **同じ名前を2つ並べない**（§9.113）。**入口で1回だけ落とす**——
    固定の列（ロット番号・検査番号…）と候補の項目（`basic.lotNo`…）は
    同じ呼び名になりうる。落とさないと`rowView()`が**後から来たほうで
    上書き**し、値の入っている列が空になる（実際に踏んだ：一覧の行は
    出ているのにロット番号が空欄）。**最初に出てきた位置を残す。** */
 function allColumns(){
  const seen=new Set(),out=[];
  AC_COLUMNS.concat(catalogColumns()).forEach(c=>{
   if(!c||!c.k||seen.has(c.k))return;seen.add(c.k);out.push(c);
  });
  return out;
 }
 function columnOf(k){return allColumns().find(c=>c.k===k)||null}
 /* **同じ名前を2つ並べない**（§9.113）——仕掛の呼び名と操業データの項目名が
    ぶつかりうるので、入口で1回だけ落とす。最初に出てきた位置を残す。 */
 function allColumnKeys(){
  const seen=new Set(),out=[];
  allColumns().forEach(c=>{if(seen.has(c.k))return;seen.add(c.k);out.push(c.k)});
  const layout=WL.columnLayout.get(AC_TARGET)||{};
  (layout.order||[]).forEach(k=>{if(!seen.has(k)){seen.add(k);out.push(k)}});
  Object.keys(layout.formulas||{}).forEach(k=>{if(!seen.has(k)){seen.add(k);out.push(k)}});
  return out;
 }
 /* **既定で出す列の判定は1箇所**（§9.162／§9.164）。一覧・設定パネル・
    見出しからの初回保存が同じ答えを見る。 */
 function initialHidden(keys,layout){
  const l=layout||WL.columnLayout.get(AC_TARGET)||{};
  if((l.order||[]).length)return null;      /* 一度でも保存していれば保存値が正 */
  const def=new Set(AC_COLUMNS.filter(c=>c.def).map(c=>c.k));
  return (keys||allColumnKeys()).filter(k=>!def.has(k));
 }
 function visibleColumnKeys(){
  const keys=allColumnKeys(),seed=initialHidden(keys);
  if(seed){const off=new Set(seed);return keys.filter(k=>!off.has(k))}
  return keys.filter(k=>WL.columnLayout.shows(AC_TARGET,k));
 }
 function trackOf(k){
  const w=WL.columnLayout.width(AC_TARGET,k);
  if(w)return `${w}px`;
  const c=columnOf(k);
  return (c&&c.track)||'minmax(84px,1fr)';
 }
 function labelOf(k){return WL.columnLayout.label(AC_TARGET,k)||k}

 /* 1行＝{列名:生の値}。計算式が`[ロット番号]`のように**見出しの言葉**で
    書けるのはこの形のため（§9.162）。 */
 function rowView(x,index){
  const row={};
  allColumns().forEach(c=>{
   if(c.k==='#'){row['#']=index+1;return}
   if(c.virtual)return;
   try{row[c.k]=c.get?c.get(x):''}catch(e){row[c.k]=''}
  });
  return row;
 }
 /* 1セル。**戻りは`{text,color}`**（`WL.cellFormat.cell`の契約）——読み替えが
    当たると色が付く。読み替え→書式→生の値の順は`cellFormat`が持つので、
    ここで組み立て直さない。**整形に失敗したら生の値を出す**（空欄にしない）。 */
 function cellText(k,raw,row){
  try{
   const r=WL.cellFormat.cell({raw,format:WL.columnLayout.format(AC_TARGET,k),
     rule:WL.columnLayout.rule(AC_TARGET,k),row,column:k});
   return {text:(r&&r.text)!=null?String(r.text):(raw==null?'':String(raw)),
           color:(r&&r.color)||''};
  }catch(e){return {text:raw==null?'':String(raw),color:''}}
 }

 /* ---------- 画面 ---------- */
 function exitActualsView(){
  if(!document.body.classList.contains('ac-mode'))return;
  document.body.classList.remove('ac-mode');
  const p=$id('actualsPanel');if(p)p.hidden=true;
 }
 WL.registerView({key:'actuals',bodyClass:'ac-mode',nav:'openActuals',
   toolbar:'#acHead',header:['測定実績','共有された測定記録を設備と期間で読みます（閲覧のみ）'],exit:exitActualsView});

 const RANGE_PRESETS=[{d:1,label:'今日'},{d:7,label:'7日'},{d:31,label:'31日'},
                      {d:92,label:'3か月'},{d:3650,label:'全期間'}];

 function ensurePanel(){
  let panel=$id('actualsPanel');if(panel)return panel;
  panel=document.createElement('section');
  panel.className='ac-panel';panel.id='actualsPanel';panel.hidden=true;
  panel.innerHTML=`
   <div class="ac-head" id="acHead">
    <label class="ac-field">設備<select id="acEquipment" title="実績が記録されている設備から選びます"></select></label>
    <label class="ac-field">期間<input type="date" id="acFrom" title="この日から（現場日で数えます）"></label>
    <label class="ac-field">〜<input type="date" id="acTo" title="この日まで（現場日で数えます）"></label>
    <span class="ac-presets" id="acPresets"></span>
    <label class="ac-field">基準<select id="acBasis" title="日付をどちらで数えるか。現場歴は勤務区分マスタの日付補正が効きます">
      <option value="work">現場歴</option><option value="cal">太陽暦</option></select></label>
    <label class="ac-search"><input type="search" id="acSearch" placeholder="ロット・検査番号で絞り込み" autocomplete="off"></label>
    <button type="button" id="acReload" class="ac-btn">再読込</button>
    <!-- 表示列の入口は**どの画面でも同じ印**（§9.476・fa-table-columns。スケジュール表・仕掛一覧と同じ）。 -->
    <button type="button" id="acColumns" class="ac-btn" title="この一覧に出す列・並び・幅・書式を決めます"><i class="fa-solid fa-table-columns" aria-hidden="true"></i> 表示列</button>
    <button type="button" id="acSheet" class="ac-btn ac-btn--primary" title="いま出ている実績を、日＋直ごとに1枚の操業データ表として刷ります">操業データ表</button>
    <button type="button" id="acReport" class="ac-btn" title="選んだ行の測定帳票をまとめて刷ります" disabled>選択した帳票 (<span id="acReportCount">0</span>)</button>
   </div>
   <div class="ac-body">
    <div class="ac-note" id="acNote" hidden></div>
    <div class="ac-list" id="acList"></div>
   </div>`;
  const grid=$id('grid');grid?.parentNode?.insertBefore(panel,grid);
  bindHead();
  return panel;
 }

 function bindHead(){
  $id('acEquipment').onchange=e=>{acState.equipment=e.target.value;savePref();load(true)};
  $id('acBasis').onchange=e=>{acState.basis=e.target.value==='cal'?'cal':'work';savePref();load(true)};
  $id('acFrom').onchange=e=>{acState.from=e.target.value;acState.days=0;load(true)};
  $id('acTo').onchange=e=>{acState.to=e.target.value;acState.days=0;load(true)};
  $id('acSearch').oninput=e=>{acState.query=e.target.value;renderList()};
  $id('acReload').onclick=()=>load(true);
  $id('acColumns').onclick=openColumnPanel;
  $id('acSheet').onclick=openSheet;
  $id('acReport').onclick=printSelectedReports;
  const box=$id('acPresets');
  box.innerHTML=RANGE_PRESETS.map(p=>
   `<button type="button" class="ac-chip" data-days="${p.d}">${esc(p.label)}</button>`).join('');
  box.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>{
   applyDays(Number(b.dataset.days));savePref();syncHead();load(true);
  });
 }
 function syncHead(){
  const eq=$id('acEquipment');
  if(eq){
   const names=acState.equipments.map(x=>x.name);
   /* **候補に無い今の設備を捨てないこと**（§9.204と同じ罠）——実績が
      1件も無い設備を選んでいると、黙って別の設備の実績が出る。 */
   if(acState.equipment&&!names.includes(acState.equipment))names.unshift(acState.equipment);
   eq.innerHTML=`<option value="">すべての設備</option>`
    +names.map(n=>{
      const hit=acState.equipments.find(x=>x.name===n);
      return `<option value="${esc(n)}"${acState.equipment===n?' selected':''}>${esc(n)}${hit?`（${hit.count}件）`:'（実績なし）'}</option>`;
     }).join('');
  }
  const f=$id('acFrom'),t=$id('acTo');
  if(f)f.value=acState.from||'';
  if(t)t.value=acState.to||'';
  const b=$id('acBasis');if(b)b.value=acState.basis;
  document.querySelectorAll('#acPresets [data-days]').forEach(x=>
   x.classList.toggle('is-on',Number(x.dataset.days)===acState.days));
  const btn=$id('acColumns');
  /* **閲覧モードでは列の設定を出さない**（列レイアウトマスタの保存は
     edit/scheduleにしか開いていない・§9.162）。押せるのに保存できない
     ボタンを残さない（§CLAUDE 4）。 */
  if(btn)btn.hidden=!columnsEditable();
 }
 function columnsEditable(){
  const m=(window.accessMode&&window.accessMode.mode)||'edit';
  return m!=='view';
 }

 /* ---------- 読み込み ---------- */
 async function loadEquipments(){
  try{
   const r=await api('/api/measurement/actuals/equipments');
   acState.equipments=(r&&r.items)||[];
  }catch(e){acState.equipments=[]}
 }
 /* この設備の操業データ項目（列の並びと呼び名の出どころ）。
    **失敗しても一覧は出す**——項目マスタが読めないだけで実績が見えなく
    なるのは行き過ぎ（fail-open）。 */
 async function loadOpDefs(){
  acState.opDefs=[];
  try{
   const q=acState.equipment?('?equipment='+encodeURIComponent(acState.equipment)):'';
   const r=await api('/api/operation-form'+q);
   acState.opDefs=(r&&r.items)||[];
  }catch(e){WL.quiet.note('操業データ項目を取れない（項目の呼び名が出ないだけ）',e)}
 }
 function rebuildOpKeys(){
  /* **並びは項目マスタの順**（現場が決めた順）。マスタに無い鍵（項目名を
     変えた後の古い記録）も落とさず後ろへ足す——落とすと記録があるのに
     列に出せない。 */
  const out=[],seen=new Set();
  (acState.opDefs||[]).forEach(d=>{
   const n=String(d&&d.name||'').trim();
   if(!n||seen.has(n))return;seen.add(n);out.push(n);
  });
  (acState.items||[]).forEach(x=>Object.keys(x.opData||{}).forEach(n=>{
   if(!n||seen.has(n))return;seen.add(n);out.push(n);
  }));
  acState.opKeys=out;
 }
 async function load(force){
  const gen=++acState.gen;
  acState.loading=true;acState.error='';
  renderList();
  const q=new URLSearchParams();
  if(acState.equipment)q.set('equipment',acState.equipment);
  if(acState.from)q.set('from',acState.from);
  if(acState.to)q.set('to',acState.to);
  q.set('basis',acState.basis);
  try{
   /* **いま出す列の道だけ頼む**（§9.94／§9.288 ⑧）。**保存済みの並びに
      載っている列も入れる**——次に出す列を先に持っておかないと、列を
      1つ出すたびに往復が要る。候補が未着（初回）のときは何も頼まない。 */
   const want=wantedPaths();
   if(want.length)q.set('fields',JSON.stringify(want));
   const [r]=await Promise.all([api('/api/measurement/actuals?'+q.toString()),
                                force?loadOpDefs():Promise.resolve()]);
   /* **いつの分かで捨てる**（§9.200）——設備を続けて切り替えると、前の
      設備の応答が後から届いて画面に出る。 */
   if(gen!==acState.gen)return;
   acState.items=(r&&r.items)||[];
   acState.total=(r&&r.total)||0;
   acState.truncated=!!(r&&r.truncated);
   acState.limit=(r&&r.limit)||0;
   acState.lotFields=(r&&r.lotFields)||[];
   /* 候補（§9.288 ⑧）。**落とした群の理由もそのまま持つ**（§4）。 */
   const cat=(r&&r.fieldCatalog)||[];
   const had=(acState.fieldCatalog||[]).length;
   acState.fieldCatalog=cat;
   acState.fieldNote=(r&&r.fieldNote)||'';
   rebuildOpKeys();
   /* **候補が初めて届いたら、その道ぶんを取り直す**——1回目は「どの列が
      あるか」を知らないので値を頼めない。**列が増えたときだけ**取り直す
      （毎回だと往復が倍になる）。 */
   if(!had&&cat.length&&wantedPaths().length){
    acState.loading=false;
    return load(false);
   }
   /* 消えた行のidを選んだまま持たない（§9.170）。 */
   const live=new Set(acState.items.map(x=>x.id));
   [...acState.selected].forEach(id=>{if(!live.has(id))acState.selected.delete(id)});
  }catch(e){
   if(gen!==acState.gen)return;
   acState.items=[];acState.total=0;acState.error=e&&e.message||String(e);
  }finally{
   if(gen===acState.gen){acState.loading=false;renderList()}
  }
 }

 function filtered(){
  const q=String(acState.query||'').trim().normalize('NFKC').toLowerCase();
  if(!q)return acState.items;
  return acState.items.filter(x=>[x.lotNo,x.inspectionNo,x.castingNo,x.equipment,x.status]
   .map(v=>String(v||'').normalize('NFKC').toLowerCase()).join(' ').includes(q));
 }

 /* ---------- 描画 ---------- */
 function noteHtml(){
  const parts=[];
  if(acState.error)parts.push(`<b class="ac-bad">読み込めませんでした</b><span>${esc(acState.error)}</span>`);
  if(acState.truncated)parts.push(`<b class="ac-bad">${acState.total}件のうち${acState.limit}件だけ出しています</b>`
    +`<span>期間を狭めるか、設備を選んでください（黙って切らないためにお知らせしています）。</span>`);
  const unread=acState.items.filter(x=>!x.readable).length;
  if(unread)parts.push(`<b>中身を読めなかった記録 ${unread}件</b>`
    +`<span>ロット番号や状態は出ますが、操業データと作業時間は空欄になります。</span>`);
  if(!parts.length)return '';
  return parts.map(p=>`<span class="ac-note-line">${p}</span>`).join('');
 }
 function renderList(){
  const list=$id('acList');if(!list)return;
  const note=$id('acNote');
  if(note){const h=noteHtml();note.hidden=!h;note.innerHTML=h}
  syncSelectionUi();
  if(acState.loading){list.innerHTML='<div class="ac-empty">読み込んでいます…</div>';return}
  const keys=visibleColumnKeys(),items=filtered();
  list.style.setProperty('--ac-cols',keys.map(trackOf).join(' '));
  const head=`<div class="ac-row head">`
   +keys.map(k=>`<span data-col="${esc(k)}" title="${esc(labelOf(k))}">${esc(labelOf(k))}</span>`).join('')
   +`</div>`;
  if(!items.length){
   const why=acState.error?'読み込みに失敗しました。上の「再読込」で試せます。'
    :(acState.query?'絞り込み条件に一致する実績がありません。'
      :'この設備・期間には記録された実績がありません。期間を広げるか、設備を「すべての設備」にしてみてください。');
   list.innerHTML=head+`<div class="ac-empty">${esc(why)}</div>`;
   return;
  }
  const frag=document.createDocumentFragment();
  list.innerHTML=head;
  items.forEach((x,i)=>{
   const view=rowView(x,i);
   const row=document.createElement('div');
   row.className='ac-row'+(acState.selected.has(x.id)?' is-picked':'');
   row.dataset.id=x.id;
   row.innerHTML=keys.map(k=>{
    const c=columnOf(k);
    if(k==='#')return `<span class="ac-idx"><label class="ac-pick" title="帳票をまとめて刷る行を選びます"><input type="checkbox" data-pick="${esc(x.id)}"${acState.selected.has(x.id)?' checked':''}><b>${i+1}</b></label></span>`;
    if(k==='操作')return `<span class="ac-act"><button type="button" class="ac-row-btn" data-report="${esc(x.id)}" title="この記録の測定帳票を開きます">帳票</button></span>`;
    const raw=view[k];
    const out=cellText(k,raw,view);
    /* **切れた値には生の値の`title`**（§9.94の約束）。色は読み替えが
       指定したときだけで、**クラスで当てる**（一覧と同じ`cell-<色>`。
       インラインの直値を増やさない・§CLAUDE 7）。揃えも既存の道具を
       そのまま呼ぶ（§9.239 ④）。 */
    const cls=['ac-cell',(c&&c.cls)||'',
      (WL.columnAlign&&WL.columnAlign.cellClass)?WL.columnAlign.cellClass(AC_TARGET,k):'',
      out.color?'cell-'+out.color:''].filter(Boolean).join(' ');
    return `<span class="${esc(cls)}" data-col="${esc(k)}"`
     +` title="${esc(raw==null?'':String(raw))}">${esc(out.text)}</span>`;
   }).join('');
   frag.append(row);
  });
  list.append(frag);
  list.querySelectorAll('[data-pick]').forEach(cb=>cb.onclick=e=>{
   e.stopPropagation();
   const id=cb.dataset.pick;
   if(cb.checked)acState.selected.add(id);else acState.selected.delete(id);
   cb.closest('.ac-row')?.classList.toggle('is-picked',cb.checked);
   syncSelectionUi();
  });
  list.querySelectorAll('[data-report]').forEach(b=>b.onclick=e=>{
   e.stopPropagation();openReport(b.dataset.report);
  });
  bindHeadTools(list);
 }
 function syncSelectionUi(){
  const n=acState.selected.size;
  const c=$id('acReportCount');if(c)c.textContent=String(n);
  const b=$id('acReport');if(b)b.disabled=!n;
 }
 /* 見出しの取っ手と右クリックは**既存の道具をそのまま呼ぶ**（§9.164。
    書き写すと、直したときに片方だけ直った状態になる）。 */
 function bindHeadTools(list){
  if(!columnsEditable())return;
  const keys=visibleColumnKeys();
  list.querySelectorAll('.ac-row.head>span[data-col]').forEach(cell=>{
   const key=cell.dataset.col;
   if(typeof WL.columnWidthGrip==='function'){
    const grip=document.createElement('i');
    grip.className='ac-grip';cell.appendChild(grip);
    /* **今そこに在る見出しから測る**（§9.211 ①）——一覧は`innerHTML`ごと
       作り直されるので、綴じ込んだ`cell`はすぐ孤児になる。孤児を測ると
       幅0になり、掴んでも動かない。 */
    const liveCell=()=>document.querySelector(
      `#acList .ac-row.head>span[data-col="${CSS.escape(key)}"]`)||cell;
    WL.columnWidthGrip(grip,{
     locked:WL.columnLayout.locked(AC_TARGET,key),
     startWidth:()=>liveCell().getBoundingClientRect().width,
     /* 引いている最中は`hold()`（§9.212 ③。保存済みにも下書きにも触らない）
        で当て、トラックの並びだけ入れ替える。 */
     preview:w=>{
      const cur=WL.columnLayout.get(AC_TARGET);
      WL.columnLayout.hold(AC_TARGET,{widths:{...(cur.widths||{}),[key]:w}});
      const l=$id('acList');
      if(l)l.style.setProperty('--ac-cols',visibleColumnKeys().map(trackOf).join(' '));
     },
     commit:w=>{
      const widths={...(WL.columnLayout.get(AC_TARGET).widths||{}),[key]:w};
      saveColumns({widths}).catch(WL.quiet('列幅を保存できない（画面の幅はそのまま）')).finally(()=>WL.columnLayout.release(AC_TARGET));
     },
     reset:()=>{
      const widths={...(WL.columnLayout.get(AC_TARGET).widths||{})};delete widths[key];
      WL.columnLayout.hold(AC_TARGET,{widths});
      saveColumns({widths}).catch(WL.quiet('列幅を保存できない（画面の幅はそのまま）')).finally(()=>{WL.columnLayout.release(AC_TARGET);renderList()});
     },
    });
   }
   cell.oncontextmenu=ev=>{
    if(typeof WL.openColumnHeaderMenu!=='function')return;
    ev.preventDefault();
    WL.openColumnHeaderMenu(ev,key,AC_TARGET,keys,columnMenuSource());
   };
  });
 }
 function headCellWidth(k){
  const cell=document.querySelector(`#acList .ac-row.head>span[data-col="${CSS.escape(k)}"]`);
  return cell?Math.round(cell.getBoundingClientRect().width):120;
 }
 function columnMenuSource(){
  return {
   keys:()=>allColumnKeys(),
   label:k=>labelOf(k),
   currentWidthOf:headCellWidth,
   hiddenOf:()=>{
    const keys=allColumnKeys(),seed=initialHidden(keys);
    return seed||keys.filter(k=>!WL.columnLayout.shows(AC_TARGET,k));
   },
   refresh:()=>renderList(),
   openPanel:()=>openColumnPanel(),
   persist:patch=>saveColumns(patch),
  };
 }
 /* **既定で出す列を、初めて保存する瞬間に書き下ろす**（§9.164）。
    忘れると幅を1回引いただけで候補が全部並ぶ。 */
 async function saveColumns(patch){
  const keys=allColumnKeys(),seed=initialHidden(keys);
  const body=Object.assign({},patch);
  if(seed&&body.hidden===undefined)body.hidden=seed;
  if(body.order===undefined)body.order=keys;
  try{await WL.columnLayout.patch(AC_TARGET,body)}
  catch(e){showToast&&showToast('列の設定を保存できませんでした',e.message,6000);throw e}
  renderList();
 }
 function openColumnPanel(){
  if(!columnsEditable()){
   showToast&&showToast('列の設定は閲覧モードでは変えられません',
     '編集できる端末で設定すると、この端末にも同じ並びで出ます。',5200);
   return;
  }
  if(!WL.listColumns||typeof WL.listColumns.open!=='function'){
   console.error('列の設定パネル(WL.listColumns.open)がありません');
   return;
  }
  /* 差し替え口の形は既定の口と同じ（**関数で答える**）。データ一覧の
     `WL.records.recordColumnPanelSource()`と同じ作法で、パネル自体には手を入れない
     （§9.120。同じパネルを使い回す）。 */
  WL.listColumns.open({
   key:'actuals',eyebrow:'測定実績',
   title:()=>`表示列の設定（測定実績${acState.equipment?'：'+acState.equipment:''}）`,
   lead:'左で<b>出す列と並び</b>を決め、右で<b>選んだ1列の見え方</b>を整えます。'
       +'設備や期間を変えても同じ設定が使われます（<b>保存するまでは元に戻せます</b>）。'
       /* **出せないものは名前で言う**（§4／§9.288 ⑧）——統計と子ロットは
          測定値から**その場で計算する**値なので一覧では扱わない。黙って
          候補から落とすと「探しても無い」になり、打つ手を持てない。 */
       +(acState.fieldNote?'<br>'+acState.fieldNote:''),
   target:()=>AC_TARGET,
   savedToast:'測定実績の表示列を保存しました',
   savedNote:'次に開いたときも同じ形で出ます',
   keys:()=>allColumnKeys(),
   healed:()=>null,
   initialHidden:(keys,l)=>initialHidden(keys,l),
   rows:()=>filtered().slice(0,40).map((x,i)=>rowView(x,i)),
   valueOf:(row,k)=>(row?row[k]:undefined),
   virtual:()=>AC_VIRTUAL,
   joined:()=>new Set(),
   joinFrom:()=>'',
   origins:()=>['source','calc'],
   originOf:k=>(AC_VIRTUAL_KEYS.has(k)?'calc':'source'),
   noteOf:k=>{const c=columnOf(k);return (c&&c.note)||''},
   currentWidthOf:headCellWidth,
   features:{formula:true,preset:true,width:true,format:true,rule:true,sort:false},
   afterApply:()=>renderList(),
   save:null,
  });
 }

 /* ---------- 出力 ---------- */
 function openReport(id){
  if(typeof window.openReportForRecord!=='function'){
   showToast&&showToast('帳票を開けません','帳票の画面が読み込まれていません。',5000);return;
  }
  window.openReportForRecord(id,{returnTo:'actuals'});
 }
 function printSelectedReports(){
  const ids=[...acState.selected];
  if(!ids.length)return;
  if(!WL.report||typeof WL.report.bulkPrint!=='function'){
   showToast&&showToast('帳票をまとめて刷れません','帳票の画面が読み込まれていません。',5000);return;
  }
  WL.report.bulkPrint(ids).catch(e=>
   showToast&&showToast('帳票を刷れませんでした',e&&e.message||String(e),6000));
 }
 function openSheet(){
  if(!WL.opSheet||typeof WL.opSheet.open!=='function'){
   showToast&&showToast('操業データ表を開けません','操業データ表の画面が読み込まれていません。',5000);return;
  }
  WL.opSheet.open({equipment:acState.equipment,items:filtered(),basis:acState.basis,
                   from:acState.from,to:acState.to,opDefs:acState.opDefs,
                   lotFields:acState.lotFields});
 }

 /* ---------- 入口 ---------- */
 async function openActuals(){
  WL.enterView('actuals');
  const panel=ensurePanel();
  panel.hidden=false;
  WL.syncViewToolbar('actuals');
  if(!acState.from&&!acState.to)applyDays(acState.days||AC_DEFAULT_DAYS);
  syncHead();
  renderList();
  /* 配置設定は**描く前に読む**（読めなくても既定の並びで一覧は出る）。 */
  await Promise.all([WL.columnLayout.load(AC_TARGET).catch(WL.quiet('列の設定を取れない（既定の並びで出す）')),
                     (WL.displayRules&&WL.displayRules.load)?WL.displayRules.load().catch(WL.quiet('表示ルールを取れない（読み替え無しで出す）')):Promise.resolve(),
                     loadEquipments()]);
  syncHead();
  await load(true);
 }
 loadPref();
 WL.onReady(()=>{
  const btn=$id('openActuals');
  if(btn)btn.onclick=()=>openActuals().catch(e=>
    showToast&&showToast('測定実績を開けませんでした',e&&e.message||String(e),6000));
 });
 WL.actuals={open:openActuals,state:acState,columns:allColumns,columnKeys:allColumnKeys,
             labelOf,rowView,cellText,target:AC_TARGET,localStamp};
})();
