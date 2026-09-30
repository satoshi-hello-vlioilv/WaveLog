/* ============================================================
   blade-sets.js: 刃セットの盤（§9.526、利用者の指示）

   「刃のセットの使用状態を切り替えられるようにしてください。使用中、研磨中」
   「カテゴリを追加して通常刃、専用刃の選択も追加してください」（選択: セット（組）ごと）

   セット＝設備＋組（刃マスタの「組」）。1行が1セットで、**カテゴリ**と**使用状態**の
   2つの切り替えを持つ。**札を押すとその場で書く**（保存ボタンを持たない）——切り替えは
   1手で終わる操作なので、押したあとに別のボタンを探させない。結果は字で返す（色だけにしない）。
   答え（刃組ガイダンスがどの刃を選ぶか）は `blade-core.js` の `selectable()`／`applyBladePick()`。
   ============================================================ */
(function(){
 const {requireMaintUser,setMaintLoading}=WL.mm;
 const ss={equipment:'',items:[],categories:[],uses:[],busy:'',note:''};

 /* 2択の札（1つの枠を割った形・§9.247）。押せるのは今と違う側だけ。 */
 function seg(group,kind,list,cur){
  return `<span class="bss-seg" role="radiogroup" aria-label="${esc(kind==='category'?'カテゴリ':'使用状態')}">${
   list.map(v=>`<button type="button" role="radio" aria-checked="${v===cur}" class="bss-opt${v===cur?' is-on':''}"`
    +` data-g="${esc(group)}" data-k="${kind}" data-v="${esc(v)}"${v===cur||ss.busy?' disabled':''}>${esc(v)}</button>`).join('')
  }</span>`;
 }
 function rowHtml(x){
  const grind=x.use===(ss.uses[1]||'研磨中');
  const th=(x.thicknesses||[]).slice().sort((a,b)=>a-b).map(t=>`t${t}`).join('・');
  return `<tr class="bss-row${grind?' is-grind':''}">
   <th class="bss-group">${esc(x.group||'（組なし）')}</th>
   <td>${seg(x.group,'category',ss.categories,x.category)}</td>
   <td>${seg(x.group,'use',ss.uses,x.use)}</td>
   <td class="bss-blades">${x.blades}枚<small>${esc(th)}</small></td>
   <td class="bss-say">${grind?'<b>刃組ガイダンスで選ばれません</b>':x.category===(ss.categories[1]||'専用刃')
     ?'「刃選択」の決まりに当たったときだけ選ばれます':'ふつうはこれが選ばれます'}${x.stored?'':'<small>（未登録——刃の「状態」から起こした初期値）</small>'}</td></tr>`;
 }
 function renderList(){
  const box=document.getElementById('masterMaintList');if(!box)return;
  if(!ss.items.length){box.innerHTML='<div class="mm-empty">この設備には刃が登録されていません。「刃」で組（例: A）を付けて登録すると、ここにセットが出ます。</div>';return}
  box.innerHTML=`<table class="bss-table"><thead><tr><th>組</th><th>カテゴリ</th><th>使用状態</th><th>刃</th><th>刃組ガイダンスでは</th></tr></thead>`
   +`<tbody>${ss.items.map(rowHtml).join('')}</tbody></table>`;
  box.querySelectorAll('.bss-opt').forEach(b=>{b.onclick=()=>flip(b.dataset.g,b.dataset.k,b.dataset.v)});
 }
 function renderForm(){
  const form=document.getElementById('masterMaintForm');if(!form)return;
  const eqs=(WL.records&&WL.records.equipmentMasterState&&WL.records.equipmentMasterState.items)||[];
  const opt=eqs.map(e=>`<option value="${esc(e.name)}"${e.name===ss.equipment?' selected':''}>${esc(e.name)}</option>`).join('');
  form.innerHTML=`<div class="mm-form-head"><span class="mm-mode-chip new">刃セット</span></div>
   <div class="mm-cd-toolbar"><div class="mm-cd-dbtabs"><select id="bssEq">${opt||'<option value="">設備マスタが未登録です</option>'}</select>
    <span class="bss-note" aria-live="polite">${esc(ss.note)}</span></div></div>
   <p class="mm-form-hint">札を押すとすぐ保存されます。<b>研磨中</b>のセットは刃組ガイダンスで選ばれません。<b>専用刃</b>は「刃選択」の決まりに当たったときだけ選ばれます。</p>`;
  form.onsubmit=ev=>ev.preventDefault();
  const sel=form.querySelector('#bssEq');
  if(sel)sel.onchange=()=>{ss.equipment=sel.value;ss.note='';load(true)};
 }
 async function flip(group,kind,value){
  const uid=requireMaintUser();if(uid===null)return;
  ss.busy=group;renderList();
  try{
   const r=await api('/api/bladeset/blade-sets',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({equipment:ss.equipment,group,[kind]:value,user_id:uid})});
   ss.note=r.message||'';
   const x=ss.items.find(i=>i.group===group);
   if(x&&r.set)Object.assign(x,r.set);
  }catch(e){await alertModal('切り替えられませんでした：'+(e&&e.message?e.message:e))}
  finally{ss.busy='';renderForm();renderList()}
 }
 async function load(force){
  const box=document.getElementById('masterMaintList');if(!box)return;
  if(typeof WL.records.loadEquipmentMaster==='function'){
   try{await WL.records.loadEquipmentMaster(force)}
   catch(e){WL.quiet.note('設備マスタが読めなくても盤は開く',e)}
  }
  const eqs=(WL.records.equipmentMasterState.items)||[];
  if(!ss.equipment&&eqs.length)ss.equipment=eqs[0].name;
  renderForm();
  if(!ss.equipment){box.innerHTML='<div class="mm-empty">設備マスタが未登録です。先に「設備」タブで登録してください。</div>';return}
  setMaintLoading&&setMaintLoading(true);
  box.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const r=await api('/api/bladeset/blade-sets?equipment='+encodeURIComponent(ss.equipment));
   ss.items=r.items||[];ss.categories=r.categories||['通常刃','専用刃'];ss.uses=r.uses||['使用中','研磨中'];
   renderList();
  }catch(e){box.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e&&e.message?e.message:e)}</div>`}
  finally{setMaintLoading&&setMaintLoading(false)}
 }
 WL.mm.registerSpecial('blade-sets',{load});
 WL.bladeSets={state:ss,load};
})();
