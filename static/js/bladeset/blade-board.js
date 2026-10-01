/* ============================================================
   blade-board.js: 刃マスタの盤（§9.529、利用者の指示）

   「刃マスタについて ①名称をキーには使わない ②選択する内容、設備、刃の厚さ、セット名
     (アルファベットから選択)、というキーは3つで管理してください。③マスタが使いにくい。
     カテゴリや使用状態がマスタのモーダルから取り扱いできないので使いやすく再構築してください。」
   利用者の選択: 盤の形は「一覧＋詳細の2ペイン」（ゴムリングと同じ形）。

   ・左＝セット（A〜Z）の一覧。カテゴリ・使用状態を札で、刃厚と枚数を2行目で言う。
   ・右＝選んだセット: カテゴリ／使用状態の2択（押すとすぐ保存）と、**刃厚ごとの行**
     （現状径・枚数・研磨の記録は表の中でその場で直す・欄を離れると保存）。
   1種類の刃を見分けるのは**設備＋セット＋刃厚**（サーバーの`blade_upsert()`が同じ3つの2行目を断る）。
   前の「刃」（名称つきの汎用の表）と「刃セット」（別タブ）はこの1枚に統合した。
   ============================================================ */
(function(){
 const K=()=>WL.bsKit;
 const NEW='__new';
 const bb={equipment:'',sets:[],categories:[],uses:[],setNames:[],sel:'',draft:null,busy:false,loaded:false};
 const setOf=g=>bb.sets.find(x=>x.group===g)||null;
 const fmt=v=>(v==null||v===''?'—':String(+(+v).toFixed(2)));
 const isSpecial=x=>x.category===(bb.categories[1]||'専用刃');
 const isGrind=x=>x.use===(bb.uses[1]||'研磨中');
 const freeNames=()=>bb.setNames.filter(n=>!bb.sets.some(x=>x.group===n));
 /* セットの札（左の一覧と詳細の頭が同じ物を使う）。地はカテゴリ、研磨中は斜線（色だけにしない＝字の札も付く）。 */
 const tile=(g,x)=>`<i class="bb-tile${x&&isSpecial(x)?' is-special':''}${x&&isGrind(x)?' is-grind':''}" aria-hidden="true">${esc(g||'?')}</i>`;
 /* 刃組ガイダンスでどう扱われるか（1文・§CLAUDE 6 出どころ）。 */
 const sayOf=x=>(isGrind(x)?'研磨中なので、刃組ガイダンスでは選ばれません。'
  :isSpecial(x)?'「刃選択」の刃のカテゴリの表で専用刃に当たったときだけ選ばれます。'
  :'ふつうはこのカテゴリ（通常刃）から選ばれます。刃厚は「刃選択」の刃厚の表が決めます。');

 /* ---------- 頭 ---------- */
 function renderHead(){
  const n=bb.sets.length,rows=bb.sets.reduce((s,x)=>s+x.rows.length,0);
  K().renderHead(bb,{id:'bbEq',
   state:bb.loaded?`セット <b>${n}</b>・刃 <b>${rows}</b>種類`:'',
   actions:'',
   hint:'1種類の刃は<b>設備＋セット（A〜Z）＋刃厚</b>で決まります。左でセットを選び、右で<b>カテゴリ・使用状態</b>と<b>刃厚ごとの径・枚数・研磨の記録</b>を直します（欄を離れるとすぐ保存）。',
   leaveOk,onEquipment:()=>{bb.sel='';bb.draft=null;load(true)}});
 }

 /* ---------- 本文（2ペイン） ---------- */
 function render(){
  renderHead();
  const box=document.getElementById('masterMaintList');if(!box||!bb.loaded)return;
  const items=bb.sets.map(x=>({key:x.group,on:x.group===bb.sel,mark:tile(x.group,x),
   title:`セット ${x.group||'（なし）'}`,
   sub:`${x.thicknesses.map(t=>fmt(t)).join('・')||'—'} mm／${x.total}枚`,
   tags:[{text:x.category,tone:isSpecial(x)?'teal':''}].concat(isGrind(x)?[{text:x.use,tone:'warn'}]:[])}));
  if(bb.sel===NEW)items.push({key:NEW,on:true,mark:tile(bb.draft.group,null),title:`新しいセット ${bb.draft.group}`,sub:'まだ登録していません'});
  box.innerHTML=K().pane({label:'刃セット',items,empty:'まだセットがありません。下の「＋ セットを足す」から登録してください。',
   add:freeNames().length?'＋ セットを足す':'',detail:detailHtml()});
  K().wirePane(box,{onPick:async k=>{if(k!==bb.sel&&await leaveOk())select(k)},onAdd:async()=>{if(await leaveOk())select(NEW)}});
  wireDetail(box);
 }
 function detailHtml(){
  if(bb.sel===NEW)return newHtml();
  const x=setOf(bb.sel);
  if(!x)return `<div class="mm-empty">${bb.sets.length?'左の一覧からセットを選ぶと、刃厚ごとの径・枚数が出ます。':'「＋ セットを足す」から最初のセットを登録してください。'}</div>`;
  const rename=`<label class="bk-mini"><s>セット名</s><select data-rename>${[x.group].concat(freeNames()).map(n=>
   `<option value="${esc(n)}"${n===x.group?' selected':''}>${esc(n||'（なし）')}</option>`).join('')}</select></label>`;
  return `<article class="bk-card">
   <header class="bk-card-h">${tile(x.group,x)}<div class="bk-card-t"><h3>セット ${esc(x.group||'（なし）')}</h3>
    <small>${esc(sayOf(x))}${x.stored?'':'（カテゴリ・使用状態は未登録——刃の前の「状態」から起こした値）'}</small></div>${rename}</header>
   <div class="bk-fields">
    <div class="bk-field"><s>カテゴリ</s>${K().seg({label:'カテゴリ',key:'category',list:bb.categories,cur:x.category,busy:bb.busy})}</div>
    <div class="bk-field"><s>使用状態</s>${K().seg({label:'使用状態',key:'use',list:bb.uses,cur:x.use,busy:bb.busy})}</div>
   </div>
   ${rowsTable(x)}
   <footer class="bk-card-f"><span class="bk-gap"></span>
    <button type="button" class="mm-btn-ghost sm bk-danger" data-act="delset">このセットを消す（刃 ${x.rows.length}行）</button></footer>
  </article>`;
 }
 /* 刃厚ごとの行。欄を離れると保存（1手で終わる操作に保存ボタンを探させない・§9.528と同じ）。 */
 const COLS=[['currentDia','現状径','mm',0.1],['qty','保有枚数','枚',1],['minQty','下限枚数','枚',1],
             ['lastGrind','研磨日','',null],['grindCount','研磨回数','回',1]];
 function rowsTable(x){
  const cell=(b,[k,label,unit,step])=>step==null
   ?`<td><input type="date" class="bb-in" data-f="${k}" value="${esc(b[k]||'')}" aria-label="${esc(b.name)}の${label}"></td>`
   :`<td><input type="number" class="bb-in" data-f="${k}" min="0" step="${step}" value="${esc(b[k]??'')}" aria-label="${esc(b.name)}の${label}"><u>${unit}</u></td>`;
  const body=x.rows.map(b=>{
   const low=b.minQty&&b.qty<b.minQty;
   return `<tr data-id="${b.id}"${b.enabled?'':' class="is-off"'}><th>${fmt(b.thickness)}<u>mm</u></th>${COLS.map(c=>cell(b,c)).join('')}
    <td class="bk-st">${low?'<b class="bk-low">下限を下回っています</b>':''}${b.enabled?'':'<b class="bk-low">無効</b>'}</td>
    <td><button type="button" class="bk-x" data-act="delrow" data-id="${b.id}" aria-label="刃厚${fmt(b.thickness)}mmを消す" title="この刃厚を消す">×</button></td></tr>`;
  }).join('');
  return `<table class="bk-table"><thead><tr><th>刃厚</th>${COLS.map(c=>`<th>${c[1]}</th>`).join('')}<th></th><th></th></tr></thead>
   <tbody>${body}</tbody><tfoot><tr><th><input type="number" id="bbNewT" min="0" step="0.5" placeholder="刃厚"></th>
   <td><input type="number" id="bbNewD" min="0" step="0.1" placeholder="現状径"></td><td><input type="number" id="bbNewQ" min="0" step="1" placeholder="枚数"></td>
   <td colspan="3"><button type="button" class="mm-btn-ghost sm" data-act="addrow">＋ 刃厚を足す</button></td><td colspan="2"></td></tr>
   <tr class="bk-sum"><th>合計</th><td></td><td><b>${x.total}枚</b></td><td colspan="5"></td></tr></tfoot></table>`;
 }
 function newHtml(){
  const d=bb.draft;
  return `<article class="bk-card is-new">
   <header class="bk-card-h">${tile(d.group,null)}<div class="bk-card-t"><h3>新しいセット</h3><small>セット名を選び、刃厚ごとの径と枚数を入れて登録します</small></div></header>
   <div class="bk-fields">
    <label class="bk-field"><s>セット名</s><select data-nk="group">${freeNames().map(n=>`<option${n===d.group?' selected':''}>${esc(n)}</option>`).join('')}</select></label>
    <div class="bk-field"><s>カテゴリ</s>${K().seg({label:'カテゴリ',key:'category',list:bb.categories,cur:d.category})}</div>
    <div class="bk-field"><s>使用状態</s>${K().seg({label:'使用状態',key:'use',list:bb.uses,cur:d.use})}</div>
   </div>
   <table class="bk-table"><thead><tr><th>刃厚</th><th>現状径</th><th>保有枚数</th><th>下限枚数</th><th></th></tr></thead><tbody>${
    d.rows.map((r,i)=>`<tr><th><input type="number" data-nr="${i}" data-f="thickness" min="0" step="0.5" value="${esc(r.thickness)}"><u>mm</u></th>
     <td><input type="number" data-nr="${i}" data-f="currentDia" min="0" step="0.1" value="${esc(r.currentDia)}" placeholder="径"><u>mm</u></td>
     <td><input type="number" data-nr="${i}" data-f="qty" min="0" step="1" value="${esc(r.qty)}" placeholder="0"><u>枚</u></td>
     <td><input type="number" data-nr="${i}" data-f="minQty" min="0" step="1" value="${esc(r.minQty)}" placeholder="0"><u>枚</u></td>
     <td><button type="button" class="bk-x" data-act="dropnew" data-i="${i}" aria-label="この刃厚を外す">×</button></td></tr>`).join('')}</tbody>
   <tfoot><tr><td colspan="5"><button type="button" class="mm-btn-ghost sm" data-act="addnew">＋ 刃厚の行を足す</button></td></tr></tfoot></table>
   <footer class="bk-card-f"><button type="button" class="mm-btn-primary sm" data-act="create">セット ${esc(d.group)} を登録する</button>
    <button type="button" class="mm-btn-ghost sm" data-act="cancel">やめる</button></footer></article>`;
 }

 /* ---------- 触る ---------- */
 function select(k){
  bb.sel=k;
  if(k===NEW){
   /* 新しいセットは**登録済みの刃厚の顔ぶれ**で行を並べて開く（思い出させない）。径は最も新しいセットの値を薄く見せる代わりに空。 */
   const ths=[...new Set(bb.sets.flatMap(x=>x.thicknesses))].sort((a,b)=>b-a);
   bb.draft={group:freeNames()[0]||'',category:bb.categories[0]||'通常刃',use:bb.uses[0]||'使用中',touched:false,
             rows:(ths.length?ths:[10,5]).map(t=>({thickness:t,currentDia:'',qty:'',minQty:''}))};
  }else bb.draft=null;
  render();
 }
 function wireDetail(box){
  box.querySelectorAll('[data-seg]').forEach(b=>{b.onclick=()=>{
   if(bb.sel===NEW){bb.draft[b.dataset.seg]=b.dataset.v;bb.draft.touched=true;render();return}
   flip(b.dataset.seg,b.dataset.v);
  }});
  box.querySelectorAll('.bb-in').forEach(el=>{el.onchange=()=>setCell(+el.closest('tr').dataset.id,el.dataset.f,el.value)});
  box.querySelectorAll('[data-nr]').forEach(el=>{el.oninput=()=>{bb.draft.rows[+el.dataset.nr][el.dataset.f]=el.value;bb.draft.touched=true}});
  const nk=box.querySelector('[data-nk="group"]');
  if(nk)nk.onchange=()=>{bb.draft.group=nk.value;render()};
  const rn=box.querySelector('[data-rename]');
  if(rn)rn.onchange=()=>rename(rn.value);
  box.querySelectorAll('[data-act]').forEach(b=>{b.onclick=()=>act(b.dataset.act,b)});
 }
 async function act(a,b){
  if(a==='cancel'){bb.sel=(bb.sets[0]||{}).group||'';bb.draft=null;render();return}
  if(a==='addnew'){bb.draft.rows.push({thickness:'',currentDia:'',qty:'',minQty:''});render();return}
  if(a==='dropnew'){bb.draft.rows.splice(+b.dataset.i,1);render();return}
  if(a==='create')return void create();
  if(a==='addrow')return void addRow();
  if(a==='delrow')return void delRow(+b.dataset.id);
  if(a==='delset')return void delSet();
 }
 const run=(fn,fail)=>K().guarded(bb,fn,fail,()=>{});
 async function flip(kind,value){
  const g=bb.sel;
  if(await run(async uid=>{
   const r=await K().post('/api/bladeset/blade-sets',{equipment:bb.equipment,group:g,[kind]:value,user_id:uid});
   Object.assign(setOf(g)||{},r.set||{});
   showToast&&showToast(r.message||'切り替えました',bb.equipment,2200);
  },'切り替えられませんでした'))render();
 }
 async function setCell(id,field,value){
  const v=value===''&&field!=='lastGrind'?0:value;
  const ok=await run(async uid=>{await K().post('/api/bladeset-blade-master/update',{id,[field]:v,user_id:uid})},'保存できませんでした');
  /* 手元の行を直して描き直す（読み直さない・焦点は同じ欄へ戻す）。失敗したら読み直して元の値を見せる。 */
  if(!ok)return void load(true);
  const x=setOf(bb.sel),b=x&&x.rows.find(r=>r.id===id);
  if(b){b[field]=field==='lastGrind'?v:+v;x.total=x.rows.filter(r=>r.enabled).reduce((s,r)=>s+(+r.qty||0),0)}
  K().keepFocus(render);
 }
 async function addRow(){
  const t=document.getElementById('bbNewT').value,dia=document.getElementById('bbNewD').value,q=document.getElementById('bbNewQ').value;
  if(String(t).trim()==='')return void alertModal('足す刃厚（mm）を入れてください。');
  if(await run(async uid=>{await K().post('/api/bladeset-blade-master',{equipment:bb.equipment,group:bb.sel,thickness:t,
    currentDia:dia===''?undefined:dia,qty:q===''?0:q,user_id:uid})},'刃厚を足せませんでした'))await load(true);
 }
 async function delRow(id){
  const x=setOf(bb.sel),b=x&&x.rows.find(r=>r.id===id);if(!b)return;
  if(!await confirmModal({title:'この刃厚を消す',eyebrow:'刃',
    bodyHtml:`<p class="confirm-modal-message">セット ${esc(x.group)} の刃厚 ${fmt(b.thickness)}mm（${b.qty||0}枚）を消します。</p>`,
    confirmLabel:'消す',cancelLabel:'やめる'}))return;
  if(await run(async()=>{await K().post('/api/bladeset-blade-master/delete',{id})},'消せませんでした'))await load(true);
 }
 async function delSet(){
  const x=setOf(bb.sel);if(!x)return;
  if(!await confirmModal({title:'このセットを消す',eyebrow:'刃',
    bodyHtml:`<p class="confirm-modal-message">セット ${esc(x.group)} の刃 ${x.rows.length}行（合計 ${x.total}枚）をすべて消します。元に戻せません。</p>`,
    confirmLabel:'消す',cancelLabel:'やめる'}))return;
  if(await run(async uid=>{await K().post('/api/bladeset/blade-sets',{equipment:bb.equipment,group:x.group,delete:true,user_id:uid})},'消せませんでした')){
   bb.sel='';await load(true);
  }
 }
 async function rename(to){
  const from=bb.sel;
  if(to===from)return;
  if(await run(async uid=>{const r=await K().post('/api/bladeset/blade-sets',{equipment:bb.equipment,group:from,rename:to,user_id:uid});
    showToast&&showToast(r.message||'変えました',bb.equipment,2400)},'セット名を変えられませんでした'))bb.sel=to;
  await load(true);
 }
 async function create(){
  const d=bb.draft;
  const rows=d.rows.filter(r=>String(r.thickness).trim()!=='');
  if(await run(async uid=>{
   const r=await K().post('/api/bladeset/blade-sets',{equipment:bb.equipment,group:d.group,create:true,category:d.category,use:d.use,
     blades:rows,user_id:uid});
   showToast&&showToast(r.message||'登録しました',bb.equipment,2400);
  },'このセットを登録できませんでした')){bb.sel=d.group;bb.draft=null;await load(true)}
 }
 const leaveOk=()=>K().leave(bb.sel===NEW&&bb.draft&&bb.draft.touched,'刃');

 /* ---------- 読む ---------- */
 async function load(force){
  const box=document.getElementById('masterMaintList');if(!box)return;
  bb.loaded=false;renderHead();
  if(!await K().prologue(bb,force))return;
  await K().loading(async()=>{
   const r=await api('/api/bladeset/blade-sets?equipment='+encodeURIComponent(bb.equipment));
   Object.assign(bb,{sets:r.items||[],categories:r.categories||['通常刃','専用刃'],uses:r.uses||['使用中','研磨中'],
                     setNames:r.setNames||[],loaded:true});
   if(bb.sel!==NEW&&!setOf(bb.sel))bb.sel=(bb.sets[0]||{}).group??'';
   render();
  });
 }
 WL.mm.registerSpecial('blade-board',{load});
 WL.bladeBoard={state:bb,load,select};
})();
