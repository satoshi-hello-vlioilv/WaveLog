/* ============================================================
   board-kit.js: 刃組のマスタの盤が共有する作り（§9.529、利用者の指示）

   「マスタのデザインがイマイチなので、すっきり統一感が欲しいです。」
   利用者の選択: 刃とゴムリングは同じ形——「一覧＋詳細の2ペイン」。

   刃組のマスタの専用の盤（刃・ゴムリング・刃選択・保持方式）は、前は盤ごとに頭の作りが
   違っていた（設備の選び方・状態の字・操作の置き場・説明の位置・名札の有無）。実測で
   **頭から本文までの高さが盤ごとに169pxばらつき**、同じ「設備を選ぶ→中身を直す」を
   毎回探し直すことになっていた。ここに**頭・2ペイン・2択の札・保存の段取り**を1つずつ置き、
   盤は中身だけを書く（同じ役目の物を2つ作らない・§CLAUDE コードの基準）。

     頭（`#masterMaintForm`）… 設備 ｜ いまの状態（1行の字） ｜ 操作（右寄せ・主役は1つ）
                              その下に説明を1行（何をする盤か・どう効くか）
     本文（`#masterMaintList`）… 左＝一覧（まとまりを全部・選ぶ）／右＝選んだ1つの詳細
   ============================================================ */
(function(){
 const {requireMaintUser,setMaintLoading}=WL.mm;

 /* いま選べる設備（設備マスタの行）。 */
 const equipments=()=>((WL.records&&WL.records.equipmentMasterState&&WL.records.equipmentMasterState.items)||[]).map(e=>e.name);

 /* 盤を開くときの前置き: 設備マスタを読み、設備が未選択なら先頭を選ぶ。設備が無ければ本文に
    「先に設備を」と言って空文字を返す（盤ごとに書き写していた8行）。 */
 async function prologue(st,force){
  if(typeof WL.records.loadEquipmentMaster==='function'){
   try{await WL.records.loadEquipmentMaster(force)}
   catch(e){WL.quiet.note('設備マスタが読めなくても盤は開く',e)}
  }
  const eqs=equipments();
  if(!st.equipment||!eqs.includes(st.equipment))st.equipment=eqs[0]||'';
  if(!st.equipment){
   const box=document.getElementById('masterMaintList');
   if(box)box.innerHTML='<div class="mm-empty">設備マスタが未登録です。先に「設備」タブで登録してください。</div>';
  }
  return st.equipment;
 }

 /* 頭。`state`は1行の字（HTML可・`tone`で地の意味）、`actions`は右寄せの操作、`hint`は説明の1行。 */
 function head(o){
  const opt=equipments().map(n=>`<option value="${esc(n)}"${n===o.equipment?' selected':''}>${esc(n)}</option>`).join('');
  return `<div class="bk-head">
   <label class="bk-eq"><s>設備</s><select id="${esc(o.id)}">${opt||'<option value="">設備マスタが未登録です</option>'}</select></label>
   <span class="bk-state${o.tone?' is-'+o.tone:''}" aria-live="polite">${o.state||''}</span>
   <span class="bk-acts">${o.actions||''}</span></div>
   ${o.hint?`<p class="bk-hint">${o.hint}</p>`:''}`;
 }
 /* 頭を描いて設備の切り替えを配線する。切り替える前に`leaveOk()`（保存していない変更を捨てるか）を聞く。 */
 function renderHead(st,o){
  const form=document.getElementById('masterMaintForm');if(!form)return null;
  form.innerHTML=head(Object.assign({equipment:st.equipment},o));
  form.onsubmit=ev=>ev.preventDefault();
  const sel=form.querySelector('#'+o.id);
  if(sel)sel.onchange=async()=>{
   if(o.leaveOk&&!await o.leaveOk()){sel.value=st.equipment;return}
   st.equipment=sel.value;o.onEquipment&&o.onEquipment(sel.value);
  };
  return form;
 }

 /* 2ペイン。左＝一覧（`items`の項目を全部。まとまりで分けて描く盤は組み上がった`listHtml`）、右＝詳細。
    一覧の下に「足す」の1つ。`cls`は盤ごとの寸法の名乗り（`--bk-list-w`を宣言し直す）。 */
 function pane(o){
  const list=o.listHtml!=null?o.listHtml:(o.items||[]).map(itemHtml).join('');
  return `<div class="bk-pane${o.cls?' '+o.cls:''}">
   <nav class="bk-list" aria-label="${esc(o.label||'一覧')}">
    <div class="bk-items" role="listbox">${list||`<p class="bk-none">${esc(o.empty||'まだありません')}</p>`}</div>
    ${o.add?`<button type="button" class="bk-add" data-bk-add>${esc(o.add)}</button>`:''}
   </nav>
   <section class="bk-detail">${o.detail||''}</section></div>`;
 }
 /* 一覧の1項目。`mark`（左の見本・字の札）・`title`・`sub`（2行目）・`tags`（右の札: {text,tone}）。 */
 function itemHtml(it){
  return `<button type="button" role="option" class="bk-item${it.on?' is-on':''}${it.tone?' is-'+it.tone:''}"`
   +` aria-selected="${!!it.on}" data-bk-key="${esc(it.key)}"${it.title2?` title="${esc(it.title2)}"`:''}>`
   +`<span class="bk-mark">${it.mark||''}</span>`
   +`<span class="bk-tx"><b>${esc(it.title)}</b>${it.sub?`<small>${esc(it.sub)}</small>`:''}</span>`
   +`<span class="bk-tags">${(it.tags||[]).map(t=>`<i class="bk-tag${t.tone?' is-'+t.tone:''}">${esc(t.text)}</i>`).join('')}</span></button>`;
 }
 /* 一覧の選ぶ・足すを配線する。 */
 function wirePane(box,o){
  box.querySelectorAll('[data-bk-key]').forEach(b=>{b.onclick=()=>o.onPick&&o.onPick(b.dataset.bkKey)});
  const add=box.querySelector('[data-bk-add]');
  if(add)add.onclick=()=>o.onAdd&&o.onAdd();
 }

 /* 2択の札（1つの枠を割った形・§9.247）。押せるのは今と違う側だけ。 */
 function seg(o){
  return `<span class="bk-seg" role="radiogroup" aria-label="${esc(o.label)}">${
   o.list.map(v=>`<button type="button" role="radio" aria-checked="${v===o.cur}" class="bk-opt${v===o.cur?' is-on':''}"`
    +` data-seg="${esc(o.key)}" data-v="${esc(v)}"${v===o.cur||o.busy?' disabled':''}>${esc(v)}</button>`).join('')
  }</span>`;
 }

 const post=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 /* 書く操作の段取り: 更新者IDを確かめ→忙しい印→失敗は窓で理由を言う。成功で真を返す。 */
 async function guarded(st,fn,fail,paint){
  const uid=requireMaintUser();if(uid===null)return false;
  st.busy=true;paint&&paint();
  try{await fn(uid);return true}
  catch(e){await alertModal(fail+'：'+(e&&e.message?e.message:e));return false}
  finally{st.busy=false;paint&&paint()}
 }
 /* 保存していない変更を捨てて離れてよいか（変更が無ければ聞かない）。 */
 function leave(dirty,what){
  if(!dirty)return Promise.resolve(true);
  return confirmModal({title:'保存していない変更を捨てる',eyebrow:what,
   bodyHtml:'<p class="confirm-modal-message">保存していない変更があります。捨てて切り替えますか？</p>',
   confirmLabel:'捨てて切り替える',cancelLabel:'やめる'});
 }
 /* 読み込みの器（本文に「読み込んでいます…」・頭の印）。 */
 async function loading(fn){
  const box=document.getElementById('masterMaintList');
  setMaintLoading&&setMaintLoading(true);
  try{return await fn()}
  catch(e){if(box)box.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e&&e.message?e.message:e)}</div>`;return null}
  finally{setMaintLoading&&setMaintLoading(false)}
 }

 /* 描き直しても**焦点を同じ欄へ戻す**（欄を離れて保存→描き直すと、Tabで移った先の欄が消えるため）。
    欄は「行の`data-id`＋欄の`data-f`」で見分ける。 */
 function keepFocus(paint){
  const a=document.activeElement,box=document.getElementById('masterMaintList');
  const tr=a&&box&&box.contains(a)&&a.closest('tr[data-id]');
  const key=tr&&a.dataset.f?[tr.dataset.id,a.dataset.f]:null;
  paint();
  if(!key)return;
  const el=box.querySelector(`tr[data-id="${CSS.escape(key[0])}"] [data-f="${CSS.escape(key[1])}"]`);
  if(el){el.focus();try{el.select&&el.select()}catch(_e){WL.quiet.note('選べない欄（日付）は焦点だけ戻す',_e)}}
 }

 WL.bsKit={keepFocus,equipments,prologue,head,renderHead,pane,itemHtml,wirePane,seg,post,guarded,leave,loading};
})();
