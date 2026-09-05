"use strict";
/* master-data.js: マスタ管理の専用画面——データと接続・作業スケジュール・管理
   ============================================================
   §9.324 R3 で master-maint.js から切り出した（中身はそのまま）。
   換算係数（§6/§9.8）・測定データの保存（§9.202）・データ引継ぎ・
   データ接続（§9.168）・クエリ結合（§9.193）・共通設定（§9.208 ⑨）・
   勤務形態・不要ファイル掃除（§9.249 ①）・テーブル生データ（§9.249 ②）・
   接続状況（§9.272）。
   盤（master-maint.js）から `WL.mm` で受け取り、`registerSpecial` で名乗る。
   ============================================================ */
(function(){
 const {CAPABILITY_LABEL,CAPABILITY_ORDER,CAPABILITY_SHORT,allDefs,bindInputHelpers,bindMaintTabs,bindPathFields,closeMaintEditor,ensureMaintEditor,firstVisibleDefKey,fmtDT,hintHtml,loadMaint,maintState,numFieldHtml,numRaw,pageFoldHtml,pageTabsHtml,renderMaintNav,requireMaintUser,setMaintLoading,syncNav}=WL.mm;
 let loadFactorState={equipment:'',configured:true,model:null,accuracy:null};
 function loadFactorBasisLabel(b){return {equipment:'自設備の実績',pooled:'全設備プール(自設備は実績不足)',default:'算出不可(実績なし)'}[b]||b||'-'}
 function fmtLfMinutes(min){if(min===null||min===undefined)return '-';const v=Math.round(min);if(v<60)return `${v}分`;return `${Math.floor(v/60)}時間${v%60?(v%60)+'分':''}`}
 async function loadLoadFactorMaint(force){
  const list=$('#masterMaintList');if(!list)return;
  if(typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){WL.quiet.note('設備マスタが読めなくても画面表示は継続する',e)}}
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
 /* 閲覧が手元の写しから読めているか（§9.268）。**「写している」だけでなく、
    実物のまま読んでいる本数も出す**——写しがまだ無いあいだは実物を読む
    （fail-open）ので、そこを黙ると「もう写しから読んでいる」と誤解される。 */
 function msMirrorText(m){
  if(!m)return '—';
  if(m.enabled===null)return '確かめられません';
  if(m.enabled===false)return '共有を直接読む（写しは無効）';
  const mins=Math.max(1,Math.round(Number(m.intervalSec||60)/60));
  if(!m.mirrored)return `写しの用意中（あと${mins}分以内）`;
  return `写し${m.mirrored}本`+(m.direct?` ／ 実物${m.direct}本`:'');
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
  /* **1行1段**にする（§9.261）。以前は3段を横に並べていたが、盤は
     ビューポートより狭く（1366pxの窓で875px）、矢印2本が240pxを取るので
     1段あたり204pxしか残らず、**値が「未設定（…」「08/28 15:2…」と
     切れていた**（実測。CLAUDE 画面基準 11「器は中身の長さから決める」）。
     縦に積めば値は切れず、流れも上から下で読める。 */
  const stage=(no,title,sub,rows,note,cls)=>`<div class="ms-stage ${cls||''}">
    <div class="ms-stage-head"><span class="ms-no">${no}</span><b>${esc(title)}</b><small>${esc(sub)}</small></div>
    <dl class="ms-kv">${rows.map(([k,val,warn])=>
      `<dt>${esc(k)}</dt><dd${warn?' class="is-warn"':''}>${val}</dd>`).join('')}</dl>
    <p class="ms-note">${note}</p></div>`;
  const arrow=(a,b)=>`<div class="ms-arrow" aria-hidden="true"><i>↓</i><b>${esc(a)}</b><small>${esc(b)}</small></div>`;
  form.innerHTML=`
   <div class="mm-form-head"><span class="mm-mode-chip editing">この端末の設定</span></div>
   <p class="ms-lead">測定データは<b>3か所</b>に置かれます。上から下へ流れます。
    <b>打っている最中はまだどこにも入っていません</b>——「保存して一覧へ」か「測定を完了」を押した時点で①と②へ入ります。</p>
   <div class="ms-next"><span class="ms-next-label">次にすること</span><span>${next}</span></div>
   ${pageTabsHtml([
    {name:'いまの状態',body:`   <div class="ms-flow">
    ${stage('①','この端末のブラウザ','IndexedDB＋控え',[
      ['編集中',msNum(draft)+(draft===null?'':'件')],
      ['完了',msNum(done)+(done===null?'':'件')],
      ['②へ未送信',msNum(unsent)+(unsent===null?'':'件'),!!unsent],
     ],'入力した値の実体です。<b>この端末でしか見えません</b>。ブラウザのデータを消すと失われます。',
      unsent?'is-warn':'')}
    ${arrow('保存のたび','自動')}
    ${stage('②',loc.perEquipment?'測定データのDB':'この端末のDB',
      loc.perEquipment?'共有・設備ごとに1ファイル':'db/records.sqlite3',[
      ['記録',msNum(loc.count)+(loc.count===null?'':'件')],
      ['最終書込',msWhen(loc.lastWriteAt)],
      ['大きさ',msSize(loc.size)],
     ].concat(loc.perEquipment?[['読む先',(loc.readPaths||[]).length+'ファイル'],
                                ['読み方',msMirrorText(loc.mirrored)]]:[]),
     loc.perEquipment
      ?`<b>設備ごとに1ファイル</b>に分けています——書くのはその設備の担当端末だけなので、同じファイルを2台が変えることがありません。
        一覧は<b>全設備ぶん</b>を読みますが、<b>開くのは手元の写し</b>です——共有を直接開くと、
        読んでいるあいだ測定端末の書き込みを待たせます（自分が書いたぶんだけは実物を読むので、
        自分の記録はすぐ見えます）。<br><code title="${esc(loc.shareDir||'')}">${esc(loc.shareDir||'—')}\\&lt;設備&gt;\\records.sqlite3</code>`
      :`<b>他のPCから続きを開けるのはここ</b>です（データ一覧はここも読みます）。<br><code title="${esc(loc.path||'')}">${esc(loc.path||'—')}</code>`)}
    ${arrow(exp.retired?'使いません':`変わったら${mins}分ごと`,exp.retired?'—':(exp.configured?'自動':'未設定'))}
    ${stage('③','閲覧用の複製','Box等・読むだけ',[
      ['状態',exp.retired?'<b>使いません</b>':(exp.configured?(exp.exists===false?'まだ作られていません':'複製しています'):'<b>未設定（複製しません）</b>'),exp.retired||!exp.configured],
      ['最終複製',(!exp.retired&&exp.configured)?msWhen(exp.lastOkAt):'—'],
      ['未反映の変更',(!exp.retired&&exp.configured)?(exp.pending?'あり':'なし'):'—'],
     ],exp.retired
        ?esc(exp.retired)
        :(exp.configured
        ?`閲覧モードの端末はここを読みます。書き戻しはしません。<br><code title="${esc(exp.path||'')}">${esc(exp.path||'—')}</code>`
        :'設定すると、②の中身をまるごとBox等へ写します。<b>測定・共有には必要ありません</b>——閲覧専用の端末に見せたいときだけ設定してください。'),
      (exp.retired||!exp.configured)?'is-off':'')}
   </div>
   ${exp.lastError?`<p class="ms-err">前回の複製に失敗しました: ${esc(exp.lastError)}</p>`:''}
   <div class="mm-cd-toolbar"><div class="mm-cd-actions">
    <button type="button" id="msSyncNow" class="${unsent?'mm-btn-primary':'mm-btn-ghost sm'}"${unsent?'':' disabled'}
      title="${unsent?'①のうち②へ送れていないものを、まとめて送ります':'未送信のデータはありません'}">未送信を今すぐ送る${unsent?`（${unsent}件）`:''}</button>
    <button type="button" id="msExportNow" class="mm-btn-ghost sm"${exp.configured?'':' disabled'}
      title="${exp.configured?'間隔を待たずに、いま②を③へ写します':'複製先が未設定です'}">いま複製する</button>
    <button type="button" id="msReload" class="mm-btn-ghost sm">状態を読み直す</button>
   </div></div>`},
    {name:'置き場と引っ越し',body:`   <div class="ms-settings">
    <h4>② 測定データの置き場</h4>
    <!-- **置き場を決めるのは共通設定の1箇所**（§9.267、§9.207「入口を2つに
         しない」）。以前はここにも欄があり、共通設定の「置き場」にも同じ
         設定が出ていた——同じ設定が2画面にあると、どちらが効くのか分からない。
         ここは**いまどこか**を言って、直す場所へ連れて行くだけにする。 -->
    <div class="ms-where${loc.perEquipment?' is-on':''}">
     <span class="ms-where-label">いまの置き場</span>
     <code class="ms-where-path">${esc(v.records_share_dir||'（未設定：この端末の db/records.sqlite3 に貯めています）')}</code>
     <button type="button" class="mm-btn-ghost sm" data-ms-goto="pathConfig">共通設定 &gt; 置き場 で決める</button>
    </div>
    <p class="mm-field-hint">決めた置き場の下に<b>設備の名前のフォルダ</b>を作り、その中に <code>records.sqlite3</code> を置きます。
     書くのはその設備を担当する端末だけなので、<b>同じファイルを2台が変えることがありません</b>。
     空欄なら今までどおり、この端末の <code>db/records.sqlite3</code> 1本に貯めます。
     <b>変えたときはアプリの再起動が必要です</b>（接続先は起動時に1回だけ決まります）。
     設定しても<b>今までの記録は消えません</b>——読むときは旧い置き場も一緒に見ます。</p>
    <!-- 置き場を決めたあとの引っ越し(§9.258)。**既定は下見**(§9.193)で、
         押す前に「どの設備へ何件」を出す。元のファイルは消さない。 -->
    <div class="ms-split" id="msSplitBox">
     <b class="ms-split-head">今ある測定データを設備ごとに振り分ける</b>
     <p class="mm-field-hint">この端末の <code>db/records.sqlite3</code> にある記録を、
      設備ごとのフォルダへ写します。<b>元のファイルは消しません</b>——読むときは旧い置き場も
      一緒に見るので、記録は1件も消えず、二重にも出ません。</p>
     <div class="mm-cd-actions">
      <button type="button" id="msSplitPreview" class="mm-btn-ghost sm"${loc.perEquipment?'':' disabled'}
       title="${loc.perEquipment?'どの設備へ何件になるかを、書き込む前に見ます':'先に共有の置き場を決めて、アプリを再起動してください'}">どうなるか見る</button>
      <button type="button" id="msSplitApply" class="mm-btn-primary" disabled
       title="下見を見てから押せます">振り分ける</button>
     </div>
     ${loc.perEquipment?'':'<p class="ms-split-why">共有の置き場が<b>まだ効いていません</b>。上で置き場を決めて保存し、アプリを再起動すると押せるようになります。</p>'}
     <div class="ms-split-result" id="msSplitResult" hidden></div>
    </div>
   </div>`},
    {name:'閲覧用の複製',body:`   <div class="ms-settings">
    <h4>③ 閲覧用の複製の設定</h4>
    <!-- **置き場を決めるのは共通設定の1箇所**（§9.267、利用者の指示
         「バックアップの置き場などを含めた全ての設定を共通設定に」）。
         §9.202ではここに置くと決めていたが、置き場が画面に散っているのが
         そもそもの困りごとだったので撤回した。ここに残すのは**間隔**だけ
         ——あれは置き場ではなく、保存後すぐ効く動きの設定。 -->
    <div class="ms-where${exp.configured?' is-on':''}">
     <span class="ms-where-label">いまの複製先</span>
     <code class="ms-where-path">${esc(v.records_backup_export_path||'（未設定：複製しません）')}</code>
     <button type="button" class="mm-btn-ghost sm" data-ms-goto="pathConfig">共通設定 &gt; 置き場 で決める</button>
    </div>
    <label class="mm-field"><span>複製を見に行く間隔</span>
     <span class="mm-field-num"><input type="number" id="msExportInterval" min="30" step="30"
       value="${esc(String(v.records_backup_export_interval_sec||exp.intervalSec||600))}"><em>秒</em></span>
     <small class="mm-field-hint"><b>変わったときだけ</b>複製するので、短くしても無駄な複製は増えません。
      こちらは保存後すぐ反映されます（再起動は要りません）。</small></label>
    <div class="mm-cd-actions"><button type="button" id="msSaveCfg" class="mm-btn-primary">この設定を保存</button></div>
   </div>
   <p class="mm-field-hint">測定画面の「DBへ同期」は、<b>いま開いている測定を①②へ即座に書く</b>ボタンです
    （保存して閉じずに、そこまでの入力を確実に残したいときに使います）。他のPCへ渡したい・PCを入れ替えるときは
    「データ引継ぎ」タブを使ってください。</p>`},
   ])}`;
  list.innerHTML='';
  /* 段の切り替えを配線する（§9.261）。編集窓と同じ`bindMaintTabs`なので、
     キーボード操作（←→）も見出しの一言もそのまま効く。 */
  bindMaintTabs(form);
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
  /* 置き場を直す場所へ連れて行く（§9.207。ここには欄を置かない）。
     **段まで連れて行く**——「共通設定を開く」だけだと、置き場の段を
     自分で探すことになる（§2）。飛び先は `pcPendingSection` が覚え、
     共通設定が組み上がった時点で開く（描く前に押しても取りこぼさない）。 */
  form.querySelectorAll('[data-ms-goto]').forEach(btn=>{
   btn.onclick=()=>{
    pcPendingSection='schedule';
    document.querySelector(`#masterMaintNav [data-master="${btn.dataset.msGoto}"]`)?.click();
   };
  });
  /* 引っ越しは**下見 → 振り分ける**の2段(§9.193)。下見を見るまで
     「振り分ける」は押せない（押した瞬間に何が起きるか分からない操作にしない）。 */
  let splitSeen=false;
  const msSplitRun=async apply=>{
   const box=$('#msSplitResult');
   try{
    setMaintLoading(true,apply?'振り分けています…':'調べています…');
    const r=await api('/api/measurement/records/split',
     {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({apply,user_id:String($('#masterUserId')?.value||'').trim()})});
    const gs=r.groups||[];
    box.hidden=false;
    box.innerHTML=gs.length
     ?`<p class="ms-split-total">${apply?'振り分けました':'下見'}：全 ${r.total} 件 → ${gs.length} 設備</p>`
      +`<ul class="ms-split-list">${gs.map(g=>
        `<li><b>${esc(g.equipment||'（設備なし）')}</b> ${g.count}件
          <code title="${esc(g.path||'')}">${esc(g.dirName||'')}</code>
          ${g.error?`<em class="ms-split-err">${esc(g.error)}</em>`:''}</li>`).join('')}</ul>`
      +`<p class="mm-field-hint">${esc(r.note||'')}</p>`
     :`<p class="ms-split-total">振り分ける記録がありません（${esc(r.note||'')}）</p>`;
    if(apply){
     splitSeen=false;$('#msSplitApply').disabled=true;
     showToast&&showToast('振り分けました',`${r.moved}件を設備ごとのフォルダへ写しました`,6000);
     measStorageState.loaded=false;loadMeasStorageMaint(true);
    }else{
     splitSeen=gs.length>0;$('#msSplitApply').disabled=!splitSeen;
    }
   }catch(e){
    showToast&&showToast(apply?'振り分けられませんでした':'調べられませんでした',e.message,7000);
   }finally{setMaintLoading(false)}
  };
  if($('#msSplitPreview'))$('#msSplitPreview').onclick=()=>msSplitRun(false);
  if($('#msSplitApply'))$('#msSplitApply').onclick=async()=>{
   if(!splitSeen)return;
   if(!confirm('今ある測定データを、設備ごとのフォルダへ写します。\n\n'
              +'元のファイルは消しません（記録は1件も消えず、二重にも出ません）。\n'
              +'よろしいですか？'))return;
   await msSplitRun(true);
  };
  $('#msSaveCfg').onclick=async()=>{
   /* **送るのはこの2つだけ**。パス設定の保存は「送られてきた項目だけ」を
      書くので、他の設定を巻き添えにしない(§9.192)。 */
   /* **置き場はここでは送らない**（§9.267）——`records_share_dir`も
      `records_backup_export_path`も決めるのは共通設定の1箇所で、
      送ると2画面から同じ設定を書くことになる。ここは間隔だけ。 */
   const body={records_backup_export_interval_sec:String($('#msExportInterval').value||'').trim(),
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
    try{ev.dataTransfer.setData('text/plain',side+'\t'+col);ev.dataTransfer.effectAllowed='link'}catch(_){WL.quiet.note('掴んだ印を渡せない（押す道は残る）',_)}
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
        if(t.length===2)from={side:t[0],col:t[1]}}catch(_){WL.quiet.note('掴んだ印を渡せない（押す道は残る）',_)}
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
   const r=await api('/api/query-join-master/probe',{quiet:true,method:'POST',
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
  try{r=await api('/api/data-source-master/probe',{quiet:true,method:'POST',headers:{'Content-Type':'application/json'},
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
 /* 他の画面から「置き場で決める」で来たときの行き先（§9.267）。共通設定は
    非同期で組み上がるので、押した時点ではまだ段が無い。 */
 let pcPendingSection='';
 let pathConfigState={values:{},defaults:{},active:{},sources:[],storage:null,storageError:"",loaded:false};
 /* 再起動しないと反映されない項目。データソースぶんは登録内容から作るので
    ここには固定で書かない(§9.81)。以前は「仕掛(SIKALOTNOW)」等が直接
    書かれており、データソースを増やしても増えず、名前を変えても古い
    ままだった。 */
 const PATH_CONFIG_RESTART_BASE=[['sikalot_source','参照データの取得元']];
 const PATH_CONFIG_RESTART_TAIL=[
  ['records_share_dir','測定データの置き場（設備ごと）'],
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
   /* 置き場は**別の口**が答える（§9.267）——`config/local.json`の側も
      含めた1枚の答えで、パス設定マスタの読み書きとは持ち主が違う。
      **読めなくても共通設定は開く**（置き場の節だけが空になる）。 */
   const [r,st]=await Promise.all([
    api('/api/path-config-master'),
    api('/api/storage-layout').catch(e=>({error:e.message})),
   ]);
   pathConfigState.values=r.values||{};pathConfigState.defaults=r.defaults||{};pathConfigState.active=r.active||{};pathConfigState.sources=r.sources||[];
   pathConfigState.storage=(st&&st.items)?st:null;
   pathConfigState.storageError=(st&&st.error)||'';
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
  {id:'schedule',name:'置き場',when:'一部は再起動後に反映',cls:'is-restart'},
  {id:'rne',     name:'RNE抽出',when:'保存後すぐ反映',cls:'is-live'},
 ];
 /* 1項目＝「名前 / 入力 / 一行の説明 / いまどうなっているか」。
    状態欄(`data-pc-state`)は`renderPathConfigList()`が後から埋める。 */
 function pcStateHtml(key){return `<small class="pc-state" data-pc-state="${esc(key)}"></small>`}
 /* 畳んだ段の見出しへ出す「いま効いている値」（§3・§9.125）。
    **保存値が空なら既定を名乗る**——空欄のままだと、畳んだ中に何が
    入っているのか読めない。 */
 function pcNowText(key,fallback){
  const v=pathConfigState.values||{},a=pathConfigState.active||{};
  const raw=String(v[key]||a[key]||'').trim();
  if(!raw)return fallback||'';
  const def=(_PC_CHOICE_LABELS[key]||{})[raw];
  return def||raw;
 }
 /* 選択肢の綴り→画面の言葉。綴りをそのまま出すと`auto`としか読めない。 */
 const _PC_CHOICE_LABELS={
  schedule_watch_enabled:{auto:'auto: 見張る',on:'on: 見張る',off:'off: 見張らない'},
  schedule_owner_enabled:{off:'off: 各PCが自分で書く',on:'on: 1台が書く（既定）'},
  schedule_session_block:{off:'off: 止めない（既定）',on:'on: 後から入った端末は読み取り専用'},
  db_mirror_enabled:{auto:'auto: 写して読む',on:'on: 写して読む',off:'off: 共有を直接読む'},
  rne_extract_enabled:{auto:'auto: localのときだけ',on:'on: 定期実行',off:'off: 手動のみ'},
 };
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
  const SEC_TERMINAL=group('terminal','この端末','保存後すぐ反映','is-live',`
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
    <div id="pcNotes"></div>`);
  const SEC_READ=group('read','どこから読むか','サーバー再起動後に反映','is-restart',`
    <div class="pc-source-list" id="pcSourceList"></div>
    <p class="mm-field-hint">読み込み先を変えるには「データ接続」のカードから <b>編集</b> を押してください
     （同じ設定を2画面に置くと、どちらが効くのか分からなくなるためここでは変えられません）。</p>
    ${pickField('sikalot_source','読み方を決めていないデータソースの既定',
      [['','（既定）network'],['network','network'],['local','local']],
      'network=共有フォルダを読む ／ local=この端末でRNEから抽出したものを読む。<b>読み方を決めたデータソースには効きません</b>。')}
    ${pcStateHtml('sikalot_source')}`);
  /* **置き場は1枚**（§9.267、利用者の指示「マスタの置き場、スケジュールの
     置き場、測定データの置き場、バックアップの置き場などを含めた全ての設定を
     共通設定に視覚的に表現した上でそのままその表示とリンクして設定を簡単に
     わかりやすく」）。以前は同じ「置き場の設定」なのに直す場所が3つに
     分かれており、`config/local.json` の3つは**画面に一切出ていなかった**。
     判定はサーバーが持つ（§9.163）ので、ここは答えを並べて直す口を添えるだけ。 */
  const SEC_SCHEDULE=group('schedule','置き場','一部は再起動後に反映','is-restart',`
    <div class="pc-share" id="pcShare">
     <!-- 見出しは節の題(「置き場」)が既に言っている（§8 同じことを2度言わない）。
          ここに出すのは**揃っているかどうか**だけ。 -->
     <div class="pc-share-head"><span class="pc-share-root" id="pcShareRoot"></span></div>
     <div class="pc-share-rows" id="pcShareRows"></div>
    </div>
    ${pageFoldHtml('共有の変化をどう取り込むか',pcNowText('schedule_watch_enabled','auto: 見張る'),`
     <p class="mm-field-hint">共有（Box等）のschedule.sqlite3は<b>他の端末も書きます</b>。読むときは手元へ写したものを読み、
      <b>改訂番号が変わったときだけ</b>写し直します（読むたびに写すと共有を掴み続け、他の端末の書込とぶつかります）。</p>
     ${pickField('schedule_watch_enabled','共有の変化を見張る',
       [['','（既定）auto: 見張る'],['auto','auto: 見張る'],['on','on: 見張る'],['off','off: 見張らない（読むたびに共有から写す）']],
       'offにすると以前の動きに戻ります（共有が遅い環境では読み込みも遅くなります）。')}
     ${numField('schedule_watch_interval_sec','変化を見る間隔','秒',5,5)}
     ${numField('schedule_watch_pause_sec','取り込んだあと休む時間','秒',5,0)}`)}
    ${pageFoldHtml('同時に書いたときの取り合い',
      'ロック'+esc(String(v.schedule_lock_ttl_sec||pathConfigState.defaults.schedule_lock_ttl_sec||''))+'秒',`
     ${numField('schedule_lock_ttl_sec','書込ロックの有効期限','秒',5,1)}
     ${numField('schedule_lock_verify_delay_ms','ロック確認までの待機時間','ミリ秒',100,0)}`)}
    ${pageFoldHtml('書く役を1台に絞る',pcNowText('schedule_owner_enabled','on: 1台が書く（既定）'),`
     <p class="mm-field-hint">共有へ<b>実際に書く役を1台に絞る</b>仕掛けです。他のPCは書き込みだけをその1台へLAN内のHTTPで頼み、
      <b>読みは今までどおり手元の写しから</b>読みます（画面のURLは全員 http://127.0.0.1:5029/ のまま）。
      <b>持ち主が落ちていても止まりません</b>——頼めなかったPCは自分で共有へ書きます。
      <b>既定で入っています。</b>切ってよいのは、社内規程などで<b>受け口のポートを開けられない</b>ときです
      （切っても動きます——各PCが自分で共有へ書く形に戻るだけです）。</p>
     ${pickField('schedule_owner_enabled','書き込み役を1台に絞る',
       [['','（既定）on: 最初に入った1台が書き込み役になる'],['on','on: 最初に入った1台が書き込み役になる'],['off','off: 各PCが自分で共有へ書く']],
       '書き込み役になったPCだけが下のポートを<b>LANへ開きます</b>（合言葉つきの決められた書き込みしか受け付けません）。')}
     ${numField('schedule_owner_port','書き込み役の受け口ポート','',1,1025)}
     ${numField('schedule_owner_ttl_sec','書き込み役の目印の有効期限','秒',10,30)}
     <div id="scheduleOwnerStatus" class="pc-owner-status">状態を読み込んでいます…</div>`)}
    ${pageFoldHtml('同じ設備を2人で触るとき',pcNowText('schedule_session_block','off: 止めない（既定）'),`
     <p class="mm-field-hint"><b>編集セッション</b>は「この設備の主担当は誰か」を見せる仕掛けです。
      <b>既定では操作を止めません</b>——データの整合は、上の<b>書く役を1台に絞る</b>のと、
      書き込みのたびの<b>ロック→取り直し→適用→改訂番号</b>で守られており、
      並べ替えは<b>顔ぶれが変わっていたら断り</b>、<b>先に並べ替えられていたら上書きせず読み直します</b>。
      <b>on</b> にすると以前の動きに戻り、後から入った端末は読み取り専用になります
      （追加・削除・並べ替え・設備停止・申し送りができなくなります）。</p>
     ${pickField('schedule_session_block','編集セッションで操作を止める',
       [['','（既定）off: 止めない（主担当を表示するだけ）'],['off','off: 止めない（主担当を表示するだけ）'],
        ['on','on: 後から入った端末は読み取り専用にする']],
       '止めない場合でも、同じ顔ぶれのまま2人が同時に並べ替えたときは<b>後から保存したほうの並びが残ります</b>。')}`)}`);
  const SEC_RNE=group('rne','RNE抽出','保存後すぐ反映','is-live',`
    <p class="mm-field-hint">RNE（Navigator問い合わせ定義）から <code>.sqlite3</code> を作り、それを一覧として読む仕組みです。
     取得元が <b>local</b> のデータソースだけが、ここで作ったファイルを読みます。</p>
    ${pickField('rne_extract_enabled','RNE抽出の定期実行',
      [['','（既定）auto: 取得元がlocalのときだけ'],['auto','auto: 取得元がlocalのときだけ'],
       ['on','on: 取得元に関わらず定期実行する'],['off','off: 定期実行しない（手動のみ）']],
      '「今すぐ抽出」は、この設定に関わらず資材が配置されていれば実行できます。')}
    ${numField('rne_extract_interval_sec','RNE抽出間隔','秒',60,60)}
    ${pathField('rne_assets_dir','RNE資材の置き場（フォルダ）','dir','RNEファイルと symnavim.conf をまとめて置くフォルダです。RNEファイルはこの下の rne/ 配下に置きます。共有フォルダを指定すれば、端末ごとにコピーせず1式を共用できます。空欄ならアプリ内の config/rne_extract です。')}
    ${pathField('rne_conf_path','接続情報 symnavim.conf の場所','file','認証情報だけを別の場所に置きたい場合に指定します。空欄なら上の資材置き場の直下（symnavim.conf）です。')}
    ${rneStatusPanelHtml()}`);
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

   <!-- ② 章は**段（タブ）**（§9.261、利用者の指示「タブとアコーディオンを主構成に」）。
        以前は全部を縦に並べて飛ぶだけで、実測2768pxを736pxの器で見ていた
        （4回ぶんスクロール）。段にすれば1章ぶんだけになる。 -->
   <nav class="pc-rail" id="pcRail" aria-label="共通設定の状態">
    <span class="pc-rail-restart" id="pcRestartCount" hidden></span>
   </nav>

   ${pageTabsHtml([
    {name:'この端末',body:SEC_TERMINAL},
    {name:'どこから読むか',body:SEC_READ},
    {name:'置き場',body:SEC_SCHEDULE},
    {name:'RNE抽出',body:SEC_RNE},
   ])}

  </div>
  <div class="mm-form-tail mm-set-sticky"><button type="submit" class="mm-btn-primary">共通設定を保存</button><span class="mm-form-hint">更新者IDは画面右上の入力欄を使用します。</span></div>`;
  form.onsubmit=ev=>{ev.preventDefault();savePathConfigMaint()};
  /* 段の切り替えを配線する（§9.261）。編集窓と同じ`bindMaintTabs`なので、
     キーボード操作（←→）も見出しの一言もそのまま効く。 */
  bindMaintTabs(form);
  /* 図から章へ飛ぶのは**段を切り替えること**（入口を2本作らない）。
     段になったので、スクロールではなく表示の切り替えで連れて行く。 */
  /* **委譲で受ける**（§9.265と同じ理由）——置き場の行は後から描かれるので、
     このとき1つずつ配線すると、行の中の「直す場所を開く」だけ効かない。 */
  form.addEventListener('click',ev=>{
   const btn=ev.target.closest('[data-pc-jump]');if(!btn||!form.contains(btn))return;
   ev.preventDefault();
   const sec=form.querySelector(`#pcSec-${btn.dataset.pcJump}`);
   if(!sec)return;
   const panel=sec.closest('.mm-tabpanel');
   if(panel&&typeof form.__mmShowTab==='function'){
    const i=[...form.querySelectorAll('.mm-tabpanel')].indexOf(panel);
    if(i>=0)form.__mmShowTab(i);
   }
   sec.scrollIntoView({block:'start',behavior:'smooth'});
   sec.classList.add('is-jumped');
   setTimeout(()=>sec.classList.remove('is-jumped'),1200);
  });
  /* 「直す場所」からその画面へ飛ぶ。**行が持つ印で開く**ので、置き場が
     増えてもここは触らなくてよい（飛び先はサーバーの答えの一部）。 */
  form.addEventListener('click',ev=>{
   const b=ev.target.closest('[data-pc-goto]');if(!b)return;
   document.querySelector(`#masterMaintNav [data-master="${b.dataset.pcGoto}"]`)?.click();
  });
  bindInputHelpers(form);
  /* 他の画面から「置き場で決める」で来たときは、その段を開いて印を付ける。
     **一度きり**——次に共通設定を開いたときまで覚えていると、身に覚えの
     無い段が開く。 */
  if(pcPendingSection){
   const want=pcPendingSection;pcPendingSection='';
   const btn=form.querySelector(`[data-pc-jump="${want}"]`);
   if(btn)btn.click();
   else{
    const sec=form.querySelector(`#pcSec-${want}`),panel=sec&&sec.closest('.mm-tabpanel');
    if(panel&&typeof form.__mmShowTab==='function'){
     const i=[...form.querySelectorAll('.mm-tabpanel')].indexOf(panel);
     if(i>=0)form.__mmShowTab(i);
    }
   }
  }
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
    const r=await api('/api/rne-extract/run',{quiet:true,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:String($('#masterUserId')?.value||'').trim()})});
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
 /* 共有の置き場を1枚で出す(§9.260)。**判定はサーバーが持つ**（§9.163）ので、
    ここは受け取った答えを並べるだけ——「UNCかどうか」「同じ根の下か」を
    画面でも判定すると答えが2通りになる。
    **色だけで伝えない**(§3)ので、置き場の種類は必ず文字で書く。 */
 /* 置き場の種類は**必ず文字で**（§3。色だけで伝えない）。 */
 const PC_SHARE_KIND={network:'共有（ネットワーク）',cloud:'共有（クラウド同期）',
                      local:'この端末の中','':'未設定'};
 /* 群の題と、その群が何のためにあるか。**3つより増やさない**（§9.105と
    同じ理由——群の意味を覚える手間のほうが大きくなる）。 */
 const PC_STORE_GROUPS=[
  {id:'terminal',name:'① この端末の中',
   why:'この端末だけが使うもの。<b>置き場は config/local.json が決めます</b>（起動時に1回だけ読むので再起動が要ります）。'},
  {id:'share',name:'② みんなで使う',
   why:'他の端末とやりとりするもの。ここを共有フォルダにすると全員で同じものを見ます。'},
  {id:'read',name:'③ 読むだけ',
   why:'別のシステムが書いたものを読むだけです。書き換えません。'},
 ];
 /* 「在るか」は3値（§CLAUDE「共有DBを開く前にstatを置かない」）。
    **null（確かめられなかった）を「無い」と同じに扱わない。** */
 function pcExistsText(x){
  if(!x.path)return {t:'未設定',c:'is-unset'};
  if(x.exists===true)return {t:'あります',c:'is-ok'};
  if(x.exists===false)return {t:'まだありません',c:'is-missing'};
  return {t:'確かめられません',c:'is-unknown'};
 }
 /* 置き場の1行。**直せるものには欄と「参照…」を、無いものには「作る」を**
    その場に置く（§9.207。直す場所へ行かせない）。 */
 function pcStorageRowHtml(x,lcFields){
  /* `config/local.json`の行は、**その欄の説明も一緒に出す**（利用者の混乱の元
     ——「フォルダなのかファイルなのか」「共有の置き場と何が違うのか」が
     行だけからは読めなかった）。説明は`localConfig`が持っている。 */
  const lcDef=(lcFields||[]).find(f=>f.key===x.field)||null;
  /* 種類と「在るか」は**別のこと**だが、置き場が未設定のときはどちらも
     「未設定」になり、同じ言葉が2つ並ぶ（§8）。そのときは種類を出さない。 */
  const kind=x.path?(PC_SHARE_KIND[x.kind||'']||''):'';
  const ex=pcExistsText(x);
  const onShare=x.kind==='network'||x.kind==='cloud';
  const lc=x.store==='local-json';
  const field=lc?`data-lc-field="${esc(x.field)}"`:`data-pc-field="${esc(x.field)}"`;
  const canEdit=x.editable&&x.field;
  const box=canEdit
   ? `<span class="mm-path" data-path-drop="${esc(x.field)}">
       <input ${field} data-field="${esc(x.field)}" type="text" value="${esc(x.saved!=null?x.saved:x.path)}"
        placeholder="未設定（既定を使います）" autocomplete="off" spellcheck="false">
       <button type="button" class="mm-path-browse" data-path-browse="${esc(x.field)}" data-path-mode="${esc(x.mode||'dir')}">参照…</button>
      </span>`
   : `<code class="pc-share-path" title="${esc(x.path||'')}">${esc(x.path||'（未設定）')}</code>`;
  /* **作れるのは「無いと分かっている」ときだけ**——確かめられなかった
     ものに「作る」を出すと、在るものを作りに行ったように見える。 */
  const canMake=x.creatable&&x.path&&x.exists===false;
  /* **1行＝3段**（題と素性／欄／打つ手）。素性を別の段にすると1件が4段に
     なり、9件で器の2倍を超える（実測 1955px を 828px の器で見ていた）。
     題の右へ添えれば読む順は変わらない（§CLAUDE 画面基準 1・12）。 */
  return `<div class="pc-store-row${onShare?' is-shared':''}${lc?' is-local':''}" data-store-key="${esc(x.key)}">
   <div class="pc-store-head">
    <b class="pc-store-label">${esc(x.label)}</b>
    <small class="pc-store-what">${esc(x.what||'')}</small>
    ${kind?`<span class="pc-store-kind">${esc(kind)}</span>`:''}
    <span class="pc-store-exists ${ex.c}">${esc(ex.t)}</span>
    ${lc?'<span class="pc-store-tag">この端末だけ</span>':''}
    ${x.retired?'<span class="pc-store-tag is-retired">役目を終えました</span>':''}
   </div>
   ${x.pending?`<small class="pc-store-note is-pending">保存済みですが、まだ効いていません。
     いまは <code>${esc(x.active||'（未設定）')}</code> を使っています——
     <b>アプリを再起動すると切り替わります</b>。置き場は先に作っておけます。</small>`:''}
   ${box}
   <div class="pc-store-foot">
    ${canEdit?`<code class="pc-store-eff" title="${esc(x.path||'')}">${
      x.pending?'これから':'いま'}: ${esc(x.path||'（未設定）')}</code>`:''}
    ${x.from?`<span>出どころ <b>${esc(x.from)}</b></span>`:''}
    ${x.pending
      ? `<span class="pc-store-pending" title="いまは ${esc(x.active||'（未設定）')} を使っています">再起動待ち</span>`
      : `<span>${x.when==='live'?'保存後すぐ反映':'再起動後に反映'}</span>`}
    ${canMake?`<button type="button" class="mm-btn-ghost pc-make" data-pc-make="${esc(x.key)}"
       data-pc-make-mode="${esc(x.mode||'dir')}">無いので作る…</button>`:''}
    ${x.jump?`<button type="button" class="mm-btn-ghost pc-goto" data-pc-goto="${esc(x.jump)}">直す場所を開く</button>`:''}
    ${x.section?`<button type="button" class="mm-btn-ghost" data-pc-jump="${esc(x.section)}">直す場所を開く</button>`:''}
   </div>
   ${x.note?`<small class="pc-store-note">${esc(x.note)}</small>`:''}
   ${lcDef&&lcDef.hint?`<small class="pc-store-note">${hintHtml(lcDef.hint)}${
     lcDef.expanded?` この端末では <code>${esc(lcDef.expanded)}</code> になります。`:''}</small>`:''}
  </div>`;
 }
 /* `config/local.json` の残り2つ（まとめて決める / 書込サイクル）。
    **優先順位はサーバーが言う**——段を1つ足したときに2箇所直さない。 */
 /* 説明は**マスタと同じ書き方**を通す（`**強調**`が生で出ないように・§9.222 ⑧）。
    変数で書いてあるときは**展開後の姿も出す**（§6。書いたものと効くものが
    違うので、片方だけ見せると確かめようがない）。 */
 function pcLcNow(f){
  const exp=f.expanded?`<br>この端末では <code>${esc(f.expanded)}</code> になります。`:'';
  return `<small class="mm-field-hint">${hintHtml(f.hint||'')}
    いまは <b>${esc(f.effective||'')}</b> です。${exp}</small>`;
 }
 /* **読めなかったことを画面のいちばん上に出す**（§9.271）。以前はサーバーが
    黙って空の設定として扱っていたので、`master_db_path` を書いてあるのに
    アプリは既定の `db\master.sqlite3` を読み、画面は「未設定」に見えていた。
    ここに出る＝**このファイルに書いた設定は1つも効いていない**。 */
 function pcLocalErrorHtml(err){
  if(!err)return '';
  return `<p class="mm-warn-note" id="pcLocalConfigError"><b>この端末の設定ファイルを読めませんでした。</b>
   ${esc(err)}<br>そのため、<b>下の3つに書いた内容は効いていません</b>（アプリは既定の置き場を読んでいます）。
   このまま下の欄から保存し直すと、正しい形で書き直せます。</p>`;
 }
 function pcLocalExtraHtml(fields){
  const rows=(fields||[]).filter(f=>f.key==='db_dir'||f.key==='master_share_mode');
  if(!rows.length)return '';
  return rows.map(f=>f.mode==='choice'
   ? `<label class="mm-field"><span>${esc(f.label)}</span>
      <select data-lc-field="${esc(f.key)}">${(f.choices||[]).map(([v,t])=>
       `<option value="${esc(v)}"${(f.value||'')===v?' selected':''}>${esc(t)}</option>`).join('')}</select>
      ${pcLcNow(f)}</label>`
   : `<div class="mm-field mm-field-wide mm-field-path"><span>${esc(f.label)}</span>
      <span class="mm-path" data-path-drop="${esc(f.key)}">
       <input data-lc-field="${esc(f.key)}" data-field="${esc(f.key)}" type="text" value="${esc(f.value||'')}"
        placeholder="未設定（既定: ${esc(f.default||'')}）" autocomplete="off" spellcheck="false">
       <button type="button" class="mm-path-browse" data-path-browse="${esc(f.key)}" data-path-mode="${esc(f.mode||'dir')}">参照…</button>
      </span>
      ${pcLcNow(f)}</div>`
  ).join('');
 }
 /* 置き場を1枚で出す(§9.260→§9.267)。**判定はサーバーが持つ**（§9.163）ので、
    ここは受け取った答えを並べて直す口を添えるだけ——「UNCかどうか」
    「どの段で決まったか」を画面でも判定すると答えが2通りになる。 */
 /* 置き場を「無ければ作る」（§9.267、利用者の指示「設定さえ書いてあれば
    フォルダやファイルが存在しない場合には強制的に作成して、ユーザーの操作を
    妨げないようにしたい。但し作成する前にユーザーに確認する方式に」）。
    **下見 → 確認 → 作る**の3段（§9.193）——何ができるのかを先に出す。 */
 async function makeStoragePath(key,mode){
  const row=document.querySelector(`[data-store-key="${CSS.escape(key)}"]`);
  const input=row&&row.querySelector('[data-field]');
  /* **欄に打った値で作る**（保存していなくてよい）——「保存してから作る」に
     すると、打ち間違えた値をマスタへ入れてから確かめることになる。 */
  const path=input?String(input.value||'').trim():'';
  const label=row?(row.querySelector('.pc-store-label')||{}).textContent||'':'';
  try{
   setMaintLoading(true,'どうなるか調べています…');
   const pre=await api('/api/storage-layout/prepare',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({path,mode,apply:false})});
   setMaintLoading(false);
   const plan=(pre&&pre.plan)||{};
   if(plan.already){
    showToast&&showToast('もうあります',`${plan.path} は既にあります。`,4500);
    return;
   }
   const made=[...(plan.dirs||[]),...(plan.file?[plan.file]:[])];
   /* **何ができるのかを1つずつ出す**（§4・§6）。「作ります」だけでは、
      どこに何ができるのか確かめようがない。 */
   const body=`<p class="confirm-modal-message">これから <b>${made.length}件</b> 作ります。</p>
     <ul class="pc-make-list">${made.map(x=>`<li><code>${esc(x)}</code></li>`).join('')}</ul>
     <p class="confirm-modal-message">${plan.kind==='network'||plan.kind==='cloud'
       ?'共有の置き場です。<b>作るだけ</b>で、中のデータは触りません。'
       :'この端末の中に作ります。'}</p>`;
   const ok=(typeof confirmModal==='function')
    ? await confirmModal({title:`${label||'置き場'}を作ります`,eyebrow:'CREATE',
                          bodyHtml:body,confirmLabel:'作る'})
    : window.confirm(`${made.length}件のフォルダ／ファイルを作ります。よろしいですか？`);
   if(!ok)return;
   setMaintLoading(true,'作っています…');
   const r=await api('/api/storage-layout/prepare',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({path,mode,apply:true})});
   const done=(r&&r.plan)||{};
   /* **作れても書けない共有がある**ので、書けるかまで見て言う（§4）。 */
   if(done.writable===false){
    showToast&&showToast('作りましたが書き込めません',
      `${done.path} を作りましたが、書き込みを試すと失敗しました。${done.writeError||''}`,9000);
   }else{
    showToast&&showToast('作りました',`${done.path} を用意しました。`,5000);
   }
   pathConfigState.loaded=false;await loadPathConfigMaint(true);
  }catch(e){
   setMaintLoading(false);
   showToast&&showToast('作れませんでした',e.message,7000);
  }finally{setMaintLoading(false)}
 }
 function bindStorageActions(root){
  root.querySelectorAll('[data-pc-make]').forEach(btn=>{
   btn.onclick=()=>makeStoragePath(btn.dataset.pcMake,btn.dataset.pcMakeMode||'dir');
  });
 }
 function paintShareLayout(sl,err){
  const rows=$('#pcShareRows'),root=$('#pcShareRoot');
  if(!rows)return;
  const items=(sl&&sl.items)||[];
  if(!items.length){
   rows.innerHTML=`<p class="mm-field-hint">置き場の一覧を読めませんでした${
     err?`: ${esc(err)}`:''}。他の設定はこのまま直せます。</p>`;
   return;
  }
  const byGroup={};items.forEach(x=>{(byGroup[x.group]=byGroup[x.group]||[]).push(x)});
  rows.innerHTML=PC_STORE_GROUPS.map(g=>{
   const list=byGroup[g.id]||[];
   if(!list.length)return '';
   return `<section class="pc-store-group" data-store-group="${esc(g.id)}">
    <h5 class="pc-store-group-head">${esc(g.name)}<small>${g.why}</small></h5>
    ${list.map(r=>pcStorageRowHtml(r,sl&&sl.localConfig)).join('')}
    ${g.id==='terminal'?`<div class="pc-store-extra">${pcLocalErrorHtml(sl&&sl.localConfigError)}${pcLocalExtraHtml(sl&&sl.localConfig)}
     <small class="mm-field-hint">この3つは <code>${esc((sl&&sl.localConfigPath)||'config/local.json')}</code> に入ります。
      <b>マスタDB自身の置き場を決める値</b>なので、マスタの中には置けません（読みに行く先が分からなくなるため）。
      直す前の内容は <code>local.json.bak</code> に控えます。</small></div>`:''}
   </section>`;
  }).join('');
  if(root){
   /* **揃っているときだけ言う**。揃っていない置き方が悪いわけではないので、
      「バラバラです」とは書かない（直す必要のない状態を不備に見せない）。 */
   root.textContent=(sl&&sl.sameRoot)?`本体3つとも同じ場所の下です: ${sl.sameRoot}`:'';
   root.hidden=!(sl&&sl.sameRoot);
   /* **器ごと畳む**——中身が隠れただけだと、器の余白が1行ぶん残る。 */
   const head=root.closest('.pc-share-head');if(head)head.hidden=root.hidden;
  }
  bindPathFields(rows);
  bindStorageActions(rows);
 }

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
  /* 置き場は`/api/storage-layout`の答え（§9.267）。読めなかったときは
     理由を出す——空のまま黙ると「設定が消えた」と読まれる（§4）。 */
  paintShareLayout(pathConfigState.storage,pathConfigState.storageError);
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
 /* 保存の口は**2つある**（§9.267）——パス設定マスタ（`data-pc-field`）と
    `config/local.json`（`data-lc-field`）。**ボタンは1つ**にする（利用者の
    指示「一元管理したい」）が、片方だけ失敗しうるので**どちらがどうなったかは
    分けて言う**（§4。まとめて「保存しました」と言うと、効いていない側に
    気づけない）。 */
 function pcLocalConfigBody(){
  const body={};
  document.querySelectorAll('#masterMaintForm [data-lc-field]').forEach(el=>{
   body[el.dataset.lcField]=String(el.value||'').trim();
  });
  return body;
 }
 /* いま画面に出ている `local.json` の値と、保存済みの値が違うか。
    **違うときだけ送る**——`local.json`は起動を左右するファイルなので、
    触っていない保存で毎回書き換えない。 */
 function pcLocalConfigChanged(body){
  const saved={};
  ((pathConfigState.storage&&pathConfigState.storage.localConfig)||[])
   .forEach(f=>{saved[f.key]=String(f.value||'')});
  return Object.keys(body).some(k=>String(body[k]||'')!==String(saved[k]||''));
 }
 async function savePathConfigMaint(){
  const uid=requireMaintUser();if(uid===null)return;
  const body={user_id:uid};
  // 数値欄は表示用の3桁区切りが入るので、送る前に外す(§9.49)
  document.querySelectorAll('#masterMaintForm [data-pc-field]').forEach(el=>{
   body[el.dataset.pcField]=el.classList.contains('mm-num-input')?numRaw(el.value):el.value;
  });
  const lc=pcLocalConfigBody();
  const lcChanged=pcLocalConfigChanged(lc);
  try{
   setMaintLoading(true,'パス設定を保存しています…');
   const r=await api('/api/path-config-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   let extra=(r&&r.message)||'';
   if(lcChanged){
    setMaintLoading(true,'この端末の置き場を保存しています…');
    try{
     const lr=await api('/api/storage-layout/local-config',{method:'POST',
       headers:{'Content-Type':'application/json'},body:JSON.stringify(lc)});
     extra=(extra?extra+' ／ ':'')
       +`この端末の置き場（${(lr&&lr.path)||'config/local.json'}）も保存しました。`
       +'<b>サーバーを再起動すると反映されます。</b>';
    }catch(e){
     /* **片方だけ失敗したことを必ず言う**——まとめて「保存しました」と
        返すと、効いていない側に気づけない（§4・§9.190と同じ理由）。 */
     pathConfigState.loaded=false;await loadPathConfigMaint(true);
     showToast&&showToast('この端末の置き場だけ保存できませんでした',
       `他の設定は保存しました。config/local.json は書けませんでした: ${e.message}`,9000);
     return;
    }
   }
   pathConfigState.loaded=false;await loadPathConfigMaint(true);
   showToast&&showToast('パス設定を保存しました',extra,lcChanged?7000:5200);
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
  if(typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){WL.quiet.note('設備が読めなくても編集は続行',e)}}
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


 /* ================================================================
    不要ファイルの掃除（§9.249 ①、利用者の指示）
    ----------------------------------------------------------------
    「溜まってくると問題なので、不要なキャッシュファイルや不要なバックアップ
      ファイルを削除する機能を実装してください。いらないものや世代の古いものは
      定期的に削除するような機能も欲しいです。」

    **判定はサーバーの1箇所**（`backend/file_cleanup.py`）。画面は
    返ってきた種別をそのまま並べるだけで、「どのファイルが要る／要らない」の
    規則を持たない（§9.163。2つ持つと画面が「消える」と言ったものが残る）。

    画面の作り（§CLAUDE「画面を作るときの基準」）:
     ・**面積は頻度×重要度。** いちばん大きいのは「いま何MB片付くか」と
       押すボタン——ここへ来る人はそれを見に来ている。設定は下段。
     ・**次にすることを1つだけ指す。** 溜まっていなければ「いまは何もする
       必要がありません」と書き、ボタンを押せなくする（§4）。
     ・**色だけで伝えない。** 種別ごとに件数・容量・**何が消えて何が残るか**を
       文字で出す。残す理由も1件ずつ言う（推測させない）。
     ・**消す前に何が消えるかを出す**（§9.193の下見と同じ作法）。確認は
       まとめて1回だけ（種別ごとに聞くと読まずに押す癖が付く・§9.170）。
    ================================================================ */
 let cleanupState={data:null,loaded:false,picked:null,busy:false};
 function clSize(n){
  const v=Number(n)||0;
  /* **単位を落とさない**（§CLAUDE 6）。「0・1件」だと0が何の0なのか読めない。 */
  if(v<=0)return '0B';
  if(v<1024)return v+'B';
  if(v<1048576)return (v/1024).toFixed(0)+'KB';
  if(v<1073741824)return (v/1048576).toFixed(1)+'MB';
  return (v/1073741824).toFixed(2)+'GB';
 }
 function clWhen(sec){
  if(!sec)return '—';
  const t=Number(sec)*1000;
  if(!Number.isFinite(t))return '—';
  const d=Math.floor((Date.now()-t)/86400000);
  const stamp=new Date(t).toLocaleDateString('ja-JP',{month:'2-digit',day:'2-digit'});
  return d<1?`${stamp}（今日）`:`${stamp}（${d}日前）`;
 }
 function clEvery(sec){
  const n=Math.max(1,Math.round(Number(sec||0)/60));
  return n<60?`${n}分ごと`:(n%60?`${Math.floor(n/60)}時間${n%60}分ごと`:`${Math.floor(n/60)}時間ごと`);
 }
 /* 選んでいる種別。**既定は「消せるものがある種別」すべて**。
    以前は自動掃除の対象だけを選んでいたが、そうすると上の帯が
    「8.2MB片付けられます」と言っているのにボタンが押せない、という
    **画面が自分の言ったことを否定する**状態が作れた（§CLAUDE 2「次にする
    ことを1つだけ指す」・§4）。消す前には必ず**何が消えるかを1件ずつ並べた
    確認**が出る（§9.193）ので、選んだまま押しても不意打ちにはならない。
    自動掃除の対象外であることは、カードにも確認にも文字で出す（§CLAUDE 3）。 */
 function clPicked(){
  const cats=(cleanupState.data&&cleanupState.data.categories)||[];
  if(!cleanupState.picked){
   cleanupState.picked=new Set(cats.filter(c=>c.removable>0).map(c=>c.key));
  }
  return cleanupState.picked;
 }
 function clPickedStats(){
  const cats=((cleanupState.data&&cleanupState.data.categories)||[]).filter(c=>clPicked().has(c.key));
  return {n:cats.reduce((a,c)=>a+c.removable,0),bytes:cats.reduce((a,c)=>a+c.removableBytes,0),cats};
 }
 async function loadCleanupMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&cleanupState.loaded){renderCleanup();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">溜まっているファイルを調べています…</div>';
  try{
   const [d,cfg]=await Promise.all([api('/api/cleanup'),api('/api/path-config-master')]);
   cleanupState.data=d;cleanupState.cfg=cfg;cleanupState.loaded=true;cleanupState.picked=null;
   renderCleanup();
  }catch(e){list.innerHTML=`<div class="mm-empty error">調べられませんでした: ${esc(e.message)}</div>`}
 }
 function renderCleanup(){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  const d=cleanupState.data||{};
  const cats=d.categories||[],tot=d.total||{},pol=d.policy||{},st=d.state||{},places=d.places||{};
  const v=(cleanupState.cfg&&cleanupState.cfg.values)||{};
  const pick=clPicked(),sel=clPickedStats();
  /* 次にすること。**1つだけ指す**（§2）。 */
  const next=sel.n
   ? `いま <b>${clSize(sel.bytes)}（${sel.n}件）</b>を片付けられます。`
     +`何が消えるかは下のカードに出ています——確かめて「選んだものを掃除する」を押してください。`
   : (tot.removable
      ? `片付けられるものは <b>${clSize(tot.removableBytes)}（${tot.removable}件）</b>ありますが、`
        +`<b>種別を1つも選んでいません</b>。下のカードの左端で選んでください。`
      : 'いまは何もする必要がありません。<b>片付けられるファイルはありません</b>（定期掃除が効いています）。');
  form.innerHTML=`
   <div class="mm-form-head"><span class="mm-mode-chip editing">この端末のファイル</span></div>
   <p class="cl-lead">アプリが動くうちに増える<b>作り直せるファイル</b>だけを片付けます。
    <b>測定データ・マスタ・共有スケジュールには一切触れません</b>——ここから消せるのは、
    消しても次に使うときに作り直されるものだけです。</p>
   <div class="cl-top">
    <div class="cl-gauge">
     <div class="cl-gauge-main"><b>${clSize(tot.removableBytes||0)}</b><span>片付けられます</span></div>
     <div class="cl-gauge-sub">${tot.removable||0}件 ／ 全体 ${clSize(tot.bytes||0)}・${tot.files||0}件</div>
     <div class="cl-bar" role="img" aria-label="全体のうち片付けられる割合">
      <i style="width:${tot.bytes?Math.max(2,Math.round((tot.removableBytes/tot.bytes)*100)):0}%"></i></div>
    </div>
    <div class="cl-next"><span class="cl-next-label">次にすること</span><span>${next}</span></div>
   </div>`;
  /* **面積は頻度×重要度**（§CLAUDE 1）。片付けられる種別だけをカードで
     大きく出し、**いま空の種別は1行の札に畳む**——溜まっていないのが
     ふつうの状態なので、そこへ画面の大半を割くと、肝心の「消せるもの」が
     埋もれる。**畳んでも消さない**（何を見ているのかが分からなくなる・
     §CLAUDE 12）。並びはサーバーの順のままにする（開くたびに場所が
     変わると探すことになる）。 */
  const card=c=>{
   const on=pick.has(c.key);
   const none=!c.removable;
   return `<div class="cl-card${on?' is-on':''}${none?' is-empty':''}" data-cl-card="${esc(c.key)}">
    <label class="cl-card-head">
     <input type="checkbox" data-cl-pick="${esc(c.key)}"${on?' checked':''}${none?' disabled':''}>
     <span class="cl-ico" aria-hidden="true">${esc(c.icon||'')}</span>
     <b>${esc(c.label)}</b>
     <span class="cl-badge${none?' is-none':''}">${none?'なし':`${clSize(c.removableBytes)}・${c.removable}件`}</span>
    </label>
    <p class="cl-note">${esc(c.note)}</p>
    <dl class="cl-kv">
     <dt>消し方</dt><dd>${hintHtml(c.why)}</dd>
     <dt>いちばん古い</dt><dd>${clWhen(c.oldest)}</dd>
     <dt>自動掃除</dt><dd>${c.auto?'対象<small>（定期掃除でも消えます）</small>':'<b>対象外</b><small>（押したときだけ消えます）</small>'}</dd>
    </dl>
    ${c.examples&&c.examples.length?`<div class="cl-ex"><b>消えるもの</b><ul>${
      c.examples.map(x=>`<li><code title="${esc(x.name)}">${esc(x.name)}</code><em>${clSize(x.size)}</em><i>${clWhen(x.mtime)}</i></li>`).join('')
     }${c.removable>c.examples.length?`<li class="cl-more">ほか${c.removable-c.examples.length}件</li>`:''}</ul></div>`:''}
    ${c.keptExamples&&c.keptExamples.length?`<div class="cl-keep"><b>残すもの（${c.kept}件）</b><ul>${
      c.keptExamples.map(x=>`<li><code title="${esc(x.name)}">${esc(x.name)}</code><i>${esc(x.why)}</i></li>`).join('')}</ul></div>`
     :(c.kept?`<div class="cl-keep"><b>残すもの</b><span>${c.kept}件</span></div>`:'')}
   </div>`;
  };
  const hot=cats.filter(c=>c.removable>0),cold=cats.filter(c=>!c.removable);
  list.innerHTML=`
   ${hot.length?`<div class="cl-grid">${hot.map(card).join('')}</div>`
    :'<p class="cl-none">片付けられるファイルは<b>1件もありません</b>。溜まってきたらここへ出ます。</p>'}
   ${cold.length?`<div class="cl-cold"><b>いま空の種別（${cold.length}）</b>${cold.map(c=>
     `<span class="cl-cold-chip" title="${esc(c.label)}｜${esc(c.note)}">`
     +`<i aria-hidden="true">${esc(c.icon||'')}</i>${esc(c.label)}`
     +`${c.kept?`<em>${c.kept}件は残します</em>`:''}</span>`).join('')}</div>`:''}
   <div class="cl-foot">
    <div class="cl-foot-sum">選んでいるのは <b>${sel.cats.length}種別</b>
     ${sel.n?`／ <b>${clSize(sel.bytes)}（${sel.n}件）</b>が消えます`:'／ <b>消えるものはありません</b>'}</div>
    <div class="cl-foot-act">
     <button type="button" id="clReload" class="mm-btn-ghost sm">調べ直す</button>
     <button type="button" id="clRun" class="mm-btn-primary"${sel.n?'':' disabled'}
       title="${sel.n?'選んだ種別のファイルを消します（消す前に確認します）':'選んだ種別に消せるファイルがありません'}">選んだものを掃除する${sel.n?`（${clSize(sel.bytes)}）`:''}</button>
    </div>
   </div>
   <div class="cl-auto">
    <h4>定期掃除 — ${pol.auto?`<span class="cl-on">入</span> ${esc(clEvery(pol.intervalSec))}`:'<span class="cl-off">切</span>'}</h4>
    <p class="cl-auto-lead">アプリが動いているあいだ、<b>自動掃除の対象</b>の種別だけを決めた間隔で片付けます。
     <b>バイトコードと古い作業フォルダは自動では消しません</b>（消すと次の起動が一度だけ遅くなる／中身を確かめてから消したいため）。</p>
    <div class="cl-auto-fields">
     <label class="mm-field mm-w-md"><span>定期掃除</span>
      <select id="clAuto">
       <option value="on"${pol.auto?' selected':''}>入（決めた間隔で片付ける）</option>
       <option value="off"${pol.auto?'':' selected'}>切（押したときだけ片付ける）</option></select>
      <small class="mm-field-hint">切にしても、この画面から手で掃除できます。</small></label>
     <label class="mm-field mm-w-sm"><span>掃除の間隔</span>
      <span class="mm-field-num"><input type="number" id="clInterval" min="300" step="300"
        value="${esc(String(v.cleanup_interval_sec||pol.intervalSec||21600))}"><em>秒</em></span>
      <small class="mm-field-hint">300秒（5分）以上。既定は21600秒＝6時間です。</small></label>
     <label class="mm-field mm-w-xs"><span>残す世代</span>
      <span class="mm-field-num"><input type="number" id="clGens" min="1" max="50" step="1"
        value="${esc(String(v.cleanup_keep_generations||pol.keepGenerations||3))}"><em>世代</em></span>
      <small class="mm-field-hint">ログ・バックアップで<b>新しいほうから残す本数</b>です。</small></label>
     <label class="mm-field mm-w-xs"><span>残す日数</span>
      <span class="mm-field-num"><input type="number" id="clDays" min="1" max="3650" step="1"
        value="${esc(String(v.cleanup_keep_days||pol.keepDays||14))}"><em>日</em></span>
      <small class="mm-field-hint">この日数以内のものは、世代の数に関わらず残します。</small></label>
    </div>
    <div class="mm-cd-actions"><button type="button" id="clSaveCfg" class="mm-btn-primary">この設定を保存</button>
     <span class="mm-form-hint">保存後すぐ反映されます（再起動は要りません）。</span></div>
    <dl class="cl-kv cl-places">
     <dt>最後の掃除</dt><dd>${st.lastRunAt?`${clWhen(st.lastRunAt)}・${st.lastRemoved||0}件 ${clSize(st.lastFreed||0)}`:'まだ走っていません'}</dd>
     ${st.lastError?`<dt>前回の言い分</dt><dd class="is-warn">${esc(st.lastError)}</dd>`:''}
     <dt>写しの置き場</dt><dd><code title="${esc(places.cache||'')}">${esc(places.cache||'—')}</code></dd>
     <dt>ログの置き場</dt><dd><code title="${esc(places.logs||'')}">${esc(places.logs||'—')}</code></dd>
     <dt>控えの置き場</dt><dd><code title="${esc(places.backup||'')}">${esc(places.backup||'—')}</code></dd>
    </dl>
   </div>`;
  /* **チェックは`click`で受ける**（§9.90。`change`は`click`の後に飛ぶため、
     行ごと作り直す作りでは反映されない）。ここは器だけを描き直す。 */
  list.querySelectorAll('[data-cl-pick]').forEach(b=>b.onclick=()=>{
   const k=b.dataset.clPick;
   if(b.checked)pick.add(k);else pick.delete(k);
   renderCleanup();
  });
  $('#clReload').onclick=()=>{cleanupState.loaded=false;loadCleanupMaint(true)};
  const run=$('#clRun');
  if(run)run.onclick=()=>cleanupRun();
  $('#clSaveCfg').onclick=async()=>{
   /* **送るのはこの4つだけ。** パス設定の保存は「送られてきた項目だけ」を
      書くので、他の設定を巻き添えにしない（§9.192）。 */
   const body={cleanup_auto_enabled:String($('#clAuto').value||'on'),
               cleanup_interval_sec:String($('#clInterval').value||'').trim(),
               cleanup_keep_generations:String($('#clGens').value||'').trim(),
               cleanup_keep_days:String($('#clDays').value||'').trim(),
               user_id:String($('#masterUserId')?.value||'').trim()};
   try{
    setMaintLoading(true,'保存しています…');
    await api('/api/path-config-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    pathConfigState.loaded=false;
    showToast&&showToast('保存しました','次の掃除から新しい決まりで片付けます',4000);
   }catch(e){showToast&&showToast('保存できませんでした',e.message,7000)}
   finally{setMaintLoading(false);cleanupState.loaded=false;loadCleanupMaint(true)}
  };
 }
 /* 消す。**確認はまとめて1回**（§9.170）。何が消えるかは種別ごとの件数と
    容量で出す——「本当によろしいですか？」だけでは読まずに押す癖が付く。 */
 async function cleanupRun(){
  if(cleanupState.busy)return;
  const sel=clPickedStats();
  if(!sel.n)return;
  const body=`<p class="confirm-modal-message">次のファイルを消します。<b>取り消せません。</b></p>
   <ul class="cl-confirm">${sel.cats.filter(c=>c.removable).map(c=>
     `<li><b>${esc(c.label)}</b>${c.auto?'':'<i>自動掃除の対象外</i>'}<em>${clSize(c.removableBytes)}・${c.removable}件</em></li>`).join('')}</ul>
   <p class="confirm-modal-message">合計 <b>${clSize(sel.bytes)}（${sel.n}件）</b>。
    どれも<b>作り直せるファイル</b>で、測定データ・マスタ・共有スケジュールには触れません。</p>`;
  const ok=typeof confirmModal==='function'
   ? await confirmModal({title:'不要ファイルを消します',eyebrow:'CLEANUP',bodyHtml:body,
                         confirmLabel:'掃除する',danger:true})
   : window.confirm(`${clSize(sel.bytes)}（${sel.n}件）を消します。よろしいですか？`);
  if(!ok)return;
  cleanupState.busy=true;
  try{
   setMaintLoading(true,'掃除しています…');
   const r=await api('/api/cleanup/run',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({categories:[...clPicked()]})});
   /* **消せなかったものは失敗にしない**（§9.108）——待てば消せるので次の
      掃除で消える。黙らずに件数と理由を言う（§CLAUDE 4）。 */
   showToast&&showToast(`${r.removed||0}件・${clSize(r.bytes||0)}を片付けました`,
     r.failed?`${r.failed}件は使用中のため残りました（次の掃除で消えます）`:'',
     r.failed?7000:3600);
  }catch(e){showToast&&showToast('掃除できませんでした',e.message,7000)}
  finally{cleanupState.busy=false;setMaintLoading(false);cleanupState.loaded=false;loadCleanupMaint(true)}
 }


 /* ================================================================
    専用タブを持たないマスタを、階層の中で編集する（§9.249 ②、利用者の指示）
    ----------------------------------------------------------------
    「テーブル生データ内で閲覧可能なマスタかつ、テーブル生データマスタの配置
      された階層にないものは、この階層に配置し、編集可能な形に実装してください。」

    これまで`master.sqlite3`の表のうちタブを持たないものは、「テーブル生データ」
    から**眺めることしかできなかった**。直したいときは、その表を書いている
    画面（列の設定パネル・登録フィルタ・行の色…）を思い出して探しに行く必要が
    あり、**どこからも直せない表**（移行済みの旧マスタ）も混ざっていた。

    作り（**新しい画面を作らない**のが要点・§9.120）:
     ・**表の一覧と扱いはサーバーが答える**（`/api/master-table/catalog`）。
       画面には表の名前を1つも書かない（§9.163）。
     ・答えを**`def`の形へ翻訳するだけ**で、一覧・編集モーダル・削除・検索は
       既存の汎用CRUDがそのまま動く（`endpoint`＋`/update`＋`/delete`の
       4本セット・§CLAUDE「マスタ管理の汎用CRUDは4本セット」）。
     ・**入力欄は表の作り（PRAGMA）から組み立てる**——列を足しても書き足さない。
     ・**ふだんの直し方があるものは、それを画面に書く**（§CLAUDE 6）。
       ここで直せることと、専用の画面があることは両立する。
     ・**移行済みの表は別の群にして「もう読みません」と書く**（§4）。
       直せると書いておいて画面が変わらないのは、押せないボタンより悪い。
    ================================================================ */
 let mtState={loaded:false,loading:null,tables:[],err:''};
 /* 列の作りから入力欄を組み立てる。**監査列と主キーは出さない**
    （サーバーが埋める・付け替えられない）。 */
 function mtFieldOf(col,longNames){
  const name=String(col.name||'');
  const decl=String(col.decl||'').toUpperCase();
  const f={k:name,label:name};
  if(/INT|REAL|NUM|FLOA|DOUB/.test(decl))f.type='number';
  else if(longNames.some(x=>name.indexOf(x)>=0))Object.assign(f,{type:'textarea',rows:4,size:'full'});
  /* **必須は「空を受け付けない列」だけ**。既定値のある列は空でも通る。 */
  if(col.notnull&&col.default===null&&!/INT|REAL|NUM/.test(decl))f.required=true;
  return f;
 }
 function mtDefOf(t){
  const longNames=t.long||[];
  /* **「触らせない列」の判定はサーバーの1つの印を見る**（§9.163）。
     監査列と、rowidの別名になる`INTEGER PRIMARY KEY`だけが`auto`。
     利用者が決める鍵（`TEXT PRIMARY KEY`）は編集できる。 */
  const cols=(t.schema||[]).filter(c=>!(c.auto!==undefined?c.auto:(c.audit||c.pk)));
  const fields=cols.map(c=>mtFieldOf(c,longNames));
  /* 一覧の列は**先頭から6本まで**。全部並べると1列あたりが潰れて読めない
     （残りは編集モーダルで見る。§CLAUDE 11「入れ物は中身の長さから決める」）。 */
  const shown=cols.slice(0,6);
  const retired=t.kind==='retired';
  const where=t.where?`ふだんは**${t.where}**から書き換えています。`:'';
  return {group:retired?'retired':'internal',key:'mt:'+t.table,
          label:t.label||t.table,icon:(t.label||t.table).slice(0,1),
          endpoint:'/api/master-table/'+encodeURIComponent(t.table),
          hasDelete:!retired,editorModal:!retired,readOnly:retired,
          rawTable:t.table,rawKind:t.kind,
          titleText:t.table+(t.note?' — '+t.note:''),
          /* **消すのは本当に行を消すこと**。汎用の言い回し（無効化）は
             有効フラグを持つマスタのためのもので、ここでは嘘になる。 */
          deleteWord:'削除',
          fields:retired?[]:fields,
          cols:shown.length?shown.map((c,i)=>({k:c.name,label:c.name,grow:i===0?2:1}))
                          :[{k:'id',label:'行'}],
          /* **説明は`**強調**`で書く**（§9.222 ⑧）——`hintHtml()`は
             エスケープしてから印を`<b>`へ変えるので、生のHTMLを書くと
             タグがそのまま画面に出る。 */
          hint:(retired
            ? '**この表はアプリがもう読みません。**'+(t.where?t.where+'。':'')
              +'ここに残してあるのは、移行前の中身を見返せるようにするためです。'
              +'**書き換えても画面は変わりません**——だからこの表は読み取り専用にしてあります。'
            : (t.note?t.note+'。':'')+where
              +'ここでは**行をそのまま**足す・直す・消せます。'
              +'列の意味はアプリの内部の決まりに沿っているので、'
              +'**値の形（書き方）を変えると、その設定は読めなくなることがあります**。'
              +'迷ったときは、ふだんの画面から設定し直してください。')};
 }
 /* 移行済みの表を丸ごと消す（§9.250 ③）。**取り消せないので、消す前に
    「何を・何件」を名乗る**（§9.193の下見と同じ作法）。消したあとは
    タブごと消えるので、**次にどこへ行くのかも先に決めておく**（§CLAUDE 2）。 */
 async function dropRetiredTable(def){
  const rows=(maintState.items||[]).length;
  const body=`<p class="confirm-modal-message"><b>${esc(def.rawTable)}</b> をマスタDBから
    <b>丸ごと消します</b>。取り消せません。</p>
   <ul class="cl-confirm"><li><b>${esc(def.rawTable)}</b><em>${rows}件</em></li></ul>
   <p class="confirm-modal-message">この表は<b>アプリがもう読みません</b>
    （中身は移行先へ移っています）。消しても画面の動きは変わりません。</p>`;
  const ok=typeof confirmModal==='function'
   ? await confirmModal({title:'移行済みの表を削除します',eyebrow:'DROP TABLE',bodyHtml:body,
                         confirmLabel:'削除する',danger:true})
   : window.confirm(`${def.rawTable} を丸ごと消します。よろしいですか？`);
  if(!ok)return;
  try{
   setMaintLoading(true,'削除しています…');
   const r=await api('/api/master-table/'+encodeURIComponent(def.rawTable)+'/drop',
     {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({user_id:String($('#masterUserId')?.value||'').trim()})});
   /* **消えたタブに留まらない**——写しを捨てて一覧を取り直し、
      いま居るタブが無くなっていたら見えているものの先頭へ移す。 */
   mtState.loaded=false;
   await loadMasterTableCatalog(true);
   if(!allDefs().some(d=>d.key===maintState.defKey))maintState.defKey=firstVisibleDefKey();
   syncNav();await loadMaint(true);
   showToast&&showToast('削除しました',(r&&r.message)||def.rawTable,3600);
  }catch(e){showToast&&showToast('削除できませんでした',e.message,7000)}
  finally{setMaintLoading(false)}
 }
 async function loadMasterTableCatalog(force){
  if(!force&&mtState.loaded)return mtState.tables;
  if(mtState.loading)return mtState.loading;
  mtState.loading=(async()=>{
   try{
    const r=await api('/api/master-table/catalog');
    mtState.tables=(r&&r.tables)||[];mtState.err=(r&&r.error)||'';
   }catch(e){mtState.tables=[];mtState.err=e.message}
   mtState.loaded=true;mtState.loading=null;
   /* 「ここで編集」→「ふだんは別画面」の順（作業導線と視覚導線を揃える）。 */
   const rank={here:0,elsewhere:1,retired:2};
   WL.mm.setRawDefs(mtState.tables.filter(t=>t.kind!=='covered')
    .sort((a,b)=>(rank[a.kind]??9)-(rank[b.kind]??9)||String(a.table).localeCompare(b.table,'ja'))
    .map(mtDefOf));
   renderMaintNav();syncNav();
   return mtState.tables;
  })();
  return mtState.loading;
 }
 /* ---------- テーブル生データ(旧「マスタ一覧」、ARCHITECTURE.md「マスタ管理の画面形態」で統合) ----------
    master.sqlite3のテーブルをそのまま読み取り専用で表示する。上のタブが
    面倒を見ていないテーブル(表示マスタ・スケジュール列表示マスタ・
    パス設定マスタの実体など)も確認できる、最後の手段としての生データ閲覧。
    編集は各専用タブから行う前提のため、ここでは書込導線を一切出さない。 */
 let rawTableState={tables:[],table:'',columns:[],rows:[],loaded:false};

 /* ==================================================================
    接続状況（§9.272、利用者の指示「誰がアクセス中か見える化し、接続中の
    ユーザーを視覚化し、強制的に接続切断したりする機能」）
    ------------------------------------------------------------------
    **できること（区分）の判定はサーバーが答える**（`can`／行ごとの
    `canDisconnect`）。画面で書き写すと「ボタンは出るのに断られる」が作れる。
    **押せない理由はその場に書く**（§4）。
    ================================================================== */
 const presenceState={data:null,err:'',timer:0,busy:''};

 function pzAgo(sec){
  const n=Math.max(0,Math.round(Number(sec)||0));
  if(n<60)return `${n}秒前`;
  if(n<3600)return `${Math.floor(n/60)}分前`;
  return `${Math.floor(n/3600)}時間前`;
 }
 function pzModeLabel(m){
  return {edit:'編集可能',view:'閲覧',schedule:'スケジュール'}[String(m||'')]||'—';
 }
 /* 画面の呼び名。**知らない鍵はそのまま出す**（黙って空欄にすると、
    新しい画面が増えたときに「何もしていない」ように見える・§9.204）。 */
 const PZ_VIEWS={list:'一覧',records:'データ一覧',schedule:'作業スケジュール',
  master:'マスタ管理',report:'測定帳票',dashboard:'ダッシュボード',
  calendar:'カレンダー',actuals:'実績データ',logs:'ログ'};
 function pzViewLabel(v){const k=String(v||'');return k?(PZ_VIEWS[k]||k):'—'}
 function pzStopTimer(){if(presenceState.timer){clearInterval(presenceState.timer);presenceState.timer=0}}

 async function loadPresenceMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.innerHTML='';
  if(force||!presenceState.data)list.innerHTML='<div class="mm-empty">接続状況を調べています…</div>';
  await pzFetch();
  pzStopTimer();
  /* **10秒ごとに読み直す**。人が入れ替わる画面なので、押して更新させると
     古い一覧を見たまま切断することになる。**画面を離れたら止める**
     （器が消えたことで気づく——専用の後始末を各所へ足さない）。 */
  presenceState.timer=setInterval(()=>{
   const el=document.getElementById('pzList');
   if(!el||!document.body.contains(el)){pzStopTimer();return}
   pzFetch();
  },10000);
 }

 async function pzFetch(){
  try{presenceState.data=await api('/api/presence');presenceState.err=''}
  catch(e){presenceState.err=e.message||String(e)}
  renderPresence();
 }

 function renderPresence(){
  const list=$('#masterMaintList');if(!list)return;
  const d=presenceState.data;
  if(!d){
   list.innerHTML=`<div class="mm-empty error">接続状況を読めませんでした: ${esc(presenceState.err||'原因不明')}</div>`;
   return;
  }
  const can=d.can||{},me=d.me||{},items=d.items||[];
  /* いまの自分の区分と、できることを**必ず文字で**出す（§3）。 */
  const roleNote=can.canDisconnect
   ?(can.canDisconnectDeveloper?'すべての端末を切断できます'
     :'開発者以外の端末を切断できます')
   :'切断はできません（見るだけです）';
  /* 置き場が共有でなければ、**見えていないことをそう言う**——「1件だけ」を
     「他に誰も居ない」と読まれないため。 */
  const scope=d.shared
   ?`共有の置き場を見ています（${esc(d.source==='master'?'マスタの隣':'作業予定の隣')}）`
   :'<b>この端末しか出ません</b>。マスタか作業予定を共有に置くと、他のPCも並びます';
  const mine=d.revoked;
  const banner=mine?`<div class="mm-warn-note" id="pzRevoked"><b>この端末は接続を解除されています。</b>
    ${esc(mine.by||'不明')}／${esc(mine.byPc||'不明')} により解除されました${mine.reason?`（理由: ${esc(mine.reason)}）`:''}。
    <b>書き込みだけが止まっています</b>——開いている画面と入力中の内容はそのままです。
    あと約${Math.max(1,Math.ceil((mine.remainingSec||0)/60))}分で自動的に戻ります。</div>`:'';

  const rows=items.map(x=>{
   const state=x.isMe?'<span class="pz-badge is-me">この端末</span>'
    :x.revoked?'<span class="pz-badge is-cut">切断中</span>'
    :'<span class="pz-badge is-on">接続中</span>';
   let action='';
   if(x.isMe)action='<span class="pz-why">自分自身は切断できません</span>';
   else if(x.revoked)action=can.canDisconnect
    ?`<button type="button" class="mm-btn-ghost sm" data-pz-allow="${esc(x.key)}">切断を取り消す</button>`
    :`<span class="pz-why">あと約${Math.max(1,Math.ceil((x.revoked.remainingSec||0)/60))}分</span>`;
   else if(x.canDisconnect)
    action=`<button type="button" class="mm-btn-ghost sm danger" data-pz-cut="${esc(x.key)}">切断する</button>`;
   else action=`<span class="pz-why">${can.canDisconnect?`「${esc(x.role)}」は切断できません`:'切断の権限がありません'}</span>`;
   return `<div class="pz-row${x.isMe?' is-me':''}">
     <span class="pz-c-state">${state}</span>
     <span class="pz-c-login">${esc(x.login||'（不明）')}</span>
     <span class="pz-c-pc">${esc(x.pc||'（不明）')}</span>
     <span class="pz-c-role">${esc(x.role||'')}</span>
     <span class="pz-c-mode">${esc(pzModeLabel(x.mode))}</span>
     <span class="pz-c-view">${esc(pzViewLabel(x.view))}</span>
     <span class="pz-c-seen">${esc(pzAgo(x.idleSec))}</span>
     <span class="pz-c-act">${action}</span>
   </div>`;
  }).join('');

  const empty=!items.length
   ?`<div class="mm-empty">${d.readable?'接続している端末がありません（この端末の在席は次のハートビートで出ます）。'
      :'在席の置き場を読めませんでした。共有フォルダへの接続を確認してください。'}</div>`:'';

  list.innerHTML=`${banner}
   <div class="pz-head">
    <div class="pz-me">この端末は <b>${esc(me.role||'')}</b> です — ${esc(roleNote)}
     <small>${esc(me.login||'（ログインID不明）')} ／ ${esc(me.pc||'（PC名不明）')}</small></div>
    <div class="pz-scope">${scope}<small>${esc(d.dir||'')}</small></div>
    <div class="pz-count">接続中 <b>${items.length}</b> 台<small>10秒ごとに読み直します</small></div>
   </div>
   <div class="pz-table" id="pzList">
    <div class="pz-row pz-headrow">
     <span class="pz-c-state">状態</span><span class="pz-c-login">ログインID</span>
     <span class="pz-c-pc">PC名</span><span class="pz-c-role">権限区分</span>
     <span class="pz-c-mode">モード</span><span class="pz-c-view">開いている画面</span>
     <span class="pz-c-seen">最後の応答</span><span class="pz-c-act">操作</span>
    </div>
    ${rows}
   </div>${empty}
   ${presenceState.err?`<div class="mm-empty error">読み直しに失敗しました: ${esc(presenceState.err)}</div>`:''}`;

  list.querySelectorAll('[data-pz-cut]').forEach(b=>b.addEventListener('click',()=>pzCut(b.dataset.pzCut)));
  list.querySelectorAll('[data-pz-allow]').forEach(b=>b.addEventListener('click',()=>pzAllow(b.dataset.pzAllow)));
 }

 async function pzCut(key){
  const x=(presenceState.data?.items||[]).find(r=>r.key===key);if(!x)return;
  /* **危ない操作なので相手を名指しで1回だけ確認する**（§5・§9.211 ②）。 */
  const reason=prompt(`${x.login||'（不明）'}／${x.pc||'（不明）'} の接続を解除します。\n`
   +`相手の書き込みが止まります（開いている画面は残ります）。\n`
   +`理由があれば書いてください（相手の画面に出ます）。`,'');
  if(reason===null)return;
  try{
   const r=await api('/api/presence/disconnect',{method:'POST',body:JSON.stringify({key,reason})});
   showToast('切断しました',`${x.login||''}／${x.pc||''} の書き込みを止めました（約${Math.round((r.cooldownSec||300)/60)}分）。`);
  }catch(e){showToast('切断できませんでした',e.message||String(e),6000)}
  pzFetch();
 }

 async function pzAllow(key){
  try{await api('/api/presence/allow',{method:'POST',body:JSON.stringify({key})});
      showToast('切断を取り消しました','その端末はすぐに書き込めるようになります。')}
  catch(e){showToast('取り消せませんでした',e.message||String(e),6000)}
  pzFetch();
 }

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
  try{await loadMasterTableCatalog()}catch(e){WL.quiet.note('読めなくても一覧は出す',e)}
  renderRawTableForm();
  await loadRawTableRows();
 }
 function renderRawTableForm(){
  const form=$('#masterMaintForm');if(!form)return;
  if(!rawTableState.tables.length){form.innerHTML='<div class="mm-form-head"><span class="mm-mode-chip new">テーブルがありません</span></div>';return}
  const opts=rawTableState.tables.map(t=>`<option value="${esc(t)}"${t===rawTableState.table?' selected':''}>${esc(t)}</option>`).join('');
  /* **行き止まりにしない**（§9.249 ②）。ここは読むだけの画面なので、
     **その表をどこから直すのか**を必ず出して連れて行く（§CLAUDE 4・6）。
     判定はサーバーの答え（`/api/master-table/catalog`）で、画面には
     表と画面の対応を書き写さない（§9.163）。 */
  const info=(mtState.tables||[]).find(t=>t.table===rawTableState.table);
  const goKey=info?(info.kind==='covered'?info.tab:(info.kind==='retired'?'':'mt:'+info.table)):'';
  const goLabel=goKey?(allDefs().find(d=>d.key===goKey)||{}).label||'':'';
  const where=!info?''
   :(info.kind==='retired'
     ?`<p class="mm-def-hint">${hintHtml('**この表はアプリがもう読みません。**'+(info.where||''))}</p>`
     :(goLabel?`<div class="mm-raw-goto"><span>この表は<b>${esc(goLabel)}</b>から編集できます</span>`
       +`<button type="button" id="rawTableGo" class="mm-btn-primary sm">${esc(goLabel)}を開く</button></div>`:''));
  form.innerHTML=`<div class="mm-form-head">
    <label class="mm-field mm-field-inline"><span>テーブル</span><select id="rawTableSelect">${opts}</select></label>
    <button type="button" id="rawTableReload" class="mm-btn-ghost sm">再読込</button>
    <span class="mm-form-hint">ここは読むだけの画面です。編集は表ごとの専用タブから行います。</span>
   </div>
   <p class="mm-def-hint">${hintHtml('マスタDB(master.sqlite3)のテーブルをそのまま表示します。**専用タブを持たないマスタも「内部データ」から編集できます**（この一覧はどの表でも中身を確かめられる最後の手段です）。先頭200件まで表示します。')}</p>
   ${where}`;
  form.onsubmit=ev=>ev.preventDefault();
  const sel=$('#rawTableSelect');if(sel)sel.onchange=()=>{rawTableState.table=sel.value;renderRawTableForm();loadRawTableRows()};
  const rb=$('#rawTableReload');if(rb)rb.onclick=()=>loadRawTableRows();
  const go=$('#rawTableGo');
  if(go)go.onclick=()=>{maintState.defKey=goKey;maintState.editing=null;maintState.query='';syncNav();loadMaint(true)};
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


 /* 盤の登録簿へ名乗る（§9.324 R3）。 */
 WL.mm.registerSpecial('meas-storage',{load:loadMeasStorageMaint});
 WL.mm.registerSpecial('import-backup',{load:loadImportBackupMaint});
 WL.mm.registerSpecial('load-factor',{load:loadLoadFactorMaint});
 WL.mm.registerSpecial('data-source',{load:loadDataSourceMaint,onEditorClose:()=>{dsState.editing=null;renderDataSourceList()}});
 WL.mm.registerSpecial('query-join',{load:loadQueryJoinMaint,onEditorClose:()=>{qjState.editing=null;renderQueryJoinList()}});
 WL.mm.registerSpecial('path-config',{load:loadPathConfigMaint});
 WL.mm.registerSpecial('shift-pattern',{load:loadShiftPatternMaint});
 WL.mm.registerSpecial('cleanup',{load:loadCleanupMaint});
 WL.mm.registerSpecial('raw-table',{load:loadRawTableMaint});
 WL.mm.registerSpecial('presence',{load:loadPresenceMaint});
 Object.assign(WL.mm,{dropRetiredTable,loadMasterTableCatalog,mtState});
})();
