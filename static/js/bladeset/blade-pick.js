/* ============================================================
   blade-pick.js: 刃選択マスタの盤（§9.380、利用者の指示）

   「条件テーブルをGUIで組む盤を実装してほしいです。条件は視覚的に直感的に
     扱えるようにしてください。」

   ここが答えるのは1つ——**「この作業のとき、どの刃が選ばれるか」**。
   ふつうは状態が「一般」の刃で、そこから外れる作業だけをここに書く（§9.379）。

   直感的にするために置いたものは3つ:
     ① 決まりは**文として読める**（「板厚 ≧ 1.6 かつ 条数 ＝ 6 → 専用 X」）
     ② **試し欄**に値を入れると、どの決まりが当たるかがその場で出る
        ——書いた本人が確かめられることが要件（§9.117 と同じ考え）
     ③ 試し欄に値があるときは**条件1つずつに○×が付く**。落ちた決まりは
        「どの条件で落ちたか」が見えるので、直す場所を探さずに済む

   判定は**書かない**。`blade-core.js` の `pickGroup()`／`condHits()` をそのまま
   呼ぶ——盤とガイダンスで判定が食い違うと、「盤では当たるのに現場では
   当たらない」という最も分かりにくい形で壊れる（§9.379）。
   ============================================================ */
(function(){
 const {requireMaintUser,setMaintLoading}=WL.mm;
 const BS=()=>WL.bladeSet;
 let ps={equipment:'',rules:[],fields:[],ops:[],groups:[],editing:null,probe:{},loaded:false};

 const opLabel=o=>((ps.ops.find(x=>x.op===o)||{}).label||o);
 const fieldOf=f=>(ps.fields.find(x=>x.field===f)||null);
 const fieldLabel=f=>((fieldOf(f)||{}).label||f);
 const isTwo=o=>!!((ps.ops.find(x=>x.op===o)||{}).two);

 /* 試し欄の値を、判定が読む形（文脈）へ直す。**空欄は「無い」**として渡す
    ——0で埋めると、空の欄が条件に当たってしまう（§9.231）。 */
 function probeCtx(){
  const c={};
  ps.fields.forEach(f=>{
   const v=ps.probe[f.field];
   if(v===undefined||v===null||String(v).trim()==='')return;
   c[f.field]=f.kind==='num'?Number(v):String(v);
  });
  return c;
 }
 const probeFilled=()=>Object.keys(probeCtx()).length>0;

 /* 当たった決まり。**判定は blade-core の1箇所**（盤は答えを受け取るだけ）。 */
 function probeHit(){
  if(!probeFilled())return null;
  return BS().pickGroup(ps.rules,probeCtx(),ps.fields);
 }

 /* ---------- 描く ---------- */
 function condChipHtml(c,ri,ci,ctx){
  const two=isTwo(c.op);
  const val=two?`${esc(c.value||'')} 〜 ${esc(c.value2||'')}`:esc(c.value||'');
  /* 試し欄に値があるときだけ○×を出す（無いときに灰色の印を並べると、
     「まだ判定していない」のか「落ちた」のかが読めない）。 */
  let mark='';
  if(ctx){
   const ok=BS().condHits(c,ctx,Object.fromEntries(ps.fields.map(f=>[f.field,f.kind])));
   mark=`<i class="bp-hit ${ok?'is-ok':'is-ng'}" aria-hidden="true">${ok?'○':'×'}</i>`;
  }
  return `<span class="bp-cond${ctx?(BS().condHits(c,ctx,Object.fromEntries(ps.fields.map(f=>[f.field,f.kind])))?' is-ok':' is-ng'):''}"`
   +` data-r="${ri}" data-c="${ci}">${mark}`
   +`<b>${esc(fieldLabel(c.field))}</b><s>${esc(opLabel(c.op))}</s><u>${val}</u></span>`;
 }

 function ruleCardHtml(r,i,hit,ctx){
  const conds=(r.conditions||[]);
  const body=conds.length
   ? conds.map((c,ci)=>condChipHtml(c,i,ci,ctx)).join('<span class="bp-and">かつ</span>')
   : '<span class="bp-none">条件がありません（この決まりは当たりません）</span>';
  const on=r.enabled!==false;
  const won=hit&&String(hit.id)===String(r.id);
  return `<article class="bp-card${won?' is-won':''}${on?'':' is-off'}" data-r="${i}" data-id="${esc(r.id)}">
   <header class="bp-ch">
    <span class="bp-no">${i+1}</span>
    <b class="bp-name">${esc(r.name||'(名前なし)')}</b>
    ${won?'<span class="bp-won">この作業はこれ</span>':''}
    ${on?'':'<span class="bp-offtag">使わない</span>'}
    <span class="bp-cta">
     <button type="button" class="mm-btn-ghost sm" data-act="up" data-r="${i}" title="ひとつ上へ"${i===0?' disabled':''}>↑</button>
     <button type="button" class="mm-btn-ghost sm" data-act="down" data-r="${i}" title="ひとつ下へ"${i===ps.rules.length-1?' disabled':''}>↓</button>
     <button type="button" class="mm-btn-ghost sm" data-act="edit" data-r="${i}">直す</button>
    </span>
   </header>
   <div class="bp-cb">${body}</div>
   <footer class="bp-cf"><span class="bp-arrow">→</span>
    ${r.group?`専用の刃 <b class="bp-grp">${esc(r.group)}</b> を使う`:'<span class="bp-none">使う刃の組が未設定です</span>'}</footer>
  </article>`;
 }

 /* 直す窓（カードの中でひらく）。行は「項目→比べ方→値」の順で、
    **決める順に左から右**（§CLAUDE 14）。 */
 function editorHtml(r){
  const fopt=f=>ps.fields.map(x=>`<option value="${esc(x.field)}"${x.field===f?' selected':''}>${esc(x.label)}</option>`).join('');
  const oopt=o=>ps.ops.map(x=>`<option value="${esc(x.op)}"${x.op===o?' selected':''}>${esc(x.label)}</option>`).join('');
  const gopt=g=>['<option value="">（選んでください）</option>']
   .concat(ps.groups.map(x=>`<option value="${esc(x.group)}"${x.group===g?' selected':''}>${esc(x.group)}${x.special?'':'（専用の刃なし）'}</option>`)).join('');
  const rows=(r.conditions||[]).map((c,ci)=>`<div class="bp-row" data-c="${ci}">
    <select class="bp-f" data-c="${ci}">${fopt(c.field)}</select>
    <select class="bp-o" data-c="${ci}">${oopt(c.op)}</select>
    <input class="bp-v" data-c="${ci}" type="text" value="${esc(c.value||'')}" placeholder="値">
    <input class="bp-v2" data-c="${ci}" type="text" value="${esc(c.value2||'')}" placeholder="上限"${isTwo(c.op)?'':' hidden'}>
    <button type="button" class="mm-btn-ghost sm" data-act="delcond" data-c="${ci}" title="この条件を消す">×</button>
   </div>`).join('');
  return `<div class="bp-ed">
   <label class="bp-lb">この決まりの名前
    <input id="bpName" type="text" value="${esc(r.name||'')}" placeholder="例: 厚板は専用"></label>
   <div class="bp-lb">条件（**すべて**満たしたときに当たります）</div>
   <div class="bp-rows" id="bpRows">${rows||'<p class="bp-none">まだ条件がありません。下の「条件を足す」から足してください。</p>'}</div>
   <button type="button" class="mm-btn-ghost sm" data-act="addcond">＋ 条件を足す</button>
   <label class="bp-lb">当たったときに使う刃の組
    <select id="bpGroup">${gopt(r.group)}</select></label>
   <label class="bp-ck"><input id="bpOn" type="checkbox"${r.enabled!==false?' checked':''}> この決まりを使う</label>
   <div class="bp-eda">
    <button type="button" class="mm-btn-primary sm" data-act="save">保存</button>
    <button type="button" class="mm-btn-ghost sm" data-act="cancel">やめる</button>
    ${r.id?'<button type="button" class="mm-btn-ghost sm bp-del" data-act="delete">この決まりを消す</button>':''}
   </div></div>`;
 }

 /* **描き直しは「編集中の窓を壊さない」**（§9.361・§9.227）。打ちかけの値は
    まだモデルに入っていないので、窓ごと作り直すと**打った字が消える**——
    実際にそれで条件の値と刃の組が空のまま保存されかけた（値を`change`で
    受けており、`change`が来る前に窓が作り直されていた）。
    なので描き直すのは**編集していないカードだけ**。窓を作り直すのは
    「条件を足す・消す」のように形が変わるときに限る（`rebuildEditor`）。 */
 function renderList(rebuildEditor){
  const box=document.getElementById('masterMaintList');if(!box)return;
  if(!ps.equipment){box.innerHTML='<div class="mm-empty">設備を選んでください。</div>';return}
  if(!ps.rules.length&&ps.editing===null){
   box.innerHTML='<div class="mm-empty">まだ決まりがありません。'
    +'この設備では<b>すべての作業で「一般」の刃</b>が選ばれます。<br>'
    +'そこから外れる作業だけを「＋ 決まりを足す」で書いてください。</div>';
   return;
  }
  const live=ps.editing!==null&&!rebuildEditor
   &&box.querySelector(`.bp-card.is-edit[data-r="${ps.editing}"]`);
  if(live){
   /* 窓はそのまま。**周りのカードだけ**塗り直す（試し欄の○×が動くため）。 */
   paintCards();
   return;
  }
  box.innerHTML='<div class="bp-list">'+ps.rules.map((r,i)=>(
   ps.editing===i?`<article class="bp-card is-edit" data-r="${i}">${editorHtml(r)}</article>`
                 :cardShell(r,i)
  )).join('')+'</div>';
  paintCards();
  bindList();
 }
 /* カード1枚の器。中身は `paintCards()` が入れる（試し欄を触るたびに
    ○×が変わるので、中身だけ差し替えられる形にしておく）。 */
 const cardShell=(r,i)=>`<article class="bp-card" data-r="${i}" data-id="${esc(r.id)}"></article>`;
 function paintCards(){
  const box=document.getElementById('masterMaintList');if(!box)return;
  const ctx=probeFilled()?probeCtx():null;
  const hit=probeHit();
  box.querySelectorAll('.bp-card:not(.is-edit)').forEach(el=>{
   const i=+el.dataset.r;const r=ps.rules[i];if(!r)return;
   el.outerHTML=ruleCardHtml(r,i,hit,ctx);
  });
  bindList();
 }

 function renderForm(){
  const form=document.getElementById('masterMaintForm');if(!form)return;
  const eqs=(WL.records&&WL.records.equipmentMasterState&&WL.records.equipmentMasterState.items)||[];
  const opt=eqs.map(e=>`<option value="${esc(e.name)}"${e.name===ps.equipment?' selected':''}>${esc(e.name)}</option>`).join('');
  const hit=probeHit();
  const probes=ps.fields.map(f=>`<label class="bp-pf"><s>${esc(f.label)}</s>`
   +`<input data-p="${esc(f.field)}" type="${f.kind==='num'?'number':'text'}" step="any"`
   +` value="${esc(ps.probe[f.field]===undefined?'':ps.probe[f.field])}"></label>`).join('');
  const answer=!probeFilled()
   ? '<span class="bp-ans is-idle">値を入れると、その作業でどの決まりが当たるかが出ます</span>'
   : (hit?`<span class="bp-ans is-hit">「${esc(hit.rule||'(名前なし)')}」に当たる → <b>専用の刃 ${esc(hit.group)}</b></span>`
         :'<span class="bp-ans is-none">どの決まりにも当たらない → <b>一般の刃</b></span>');
  form.innerHTML=`<div class="mm-form-head"><span class="mm-mode-chip new">刃選択</span></div>
   <div class="mm-cd-toolbar">
    <div class="mm-cd-dbtabs"><select id="bpEq">${opt||'<option value="">設備マスタが未登録です</option>'}</select></div>
    <div class="mm-cd-actions"><button type="button" class="mm-btn-primary sm" id="bpAdd">＋ 決まりを足す</button></div>
   </div>
   <p class="mm-form-hint">ふつうは状態が<b>「一般」</b>の刃が選ばれます。そこから外れる作業だけをここに書いてください。
    <b>上から順に見て、最初に当たった1つ</b>が効きます。</p>
   <div class="bp-try"><div class="bp-tryh">試す<s>この値の作業なら、どれが当たるか</s></div>
    <div class="bp-tryf">${probes}</div>
    <div class="bp-trya">${answer}<button type="button" class="mm-btn-ghost sm" id="bpClear">空にする</button></div></div>`;
  form.onsubmit=ev=>ev.preventDefault();
  const sel=document.getElementById('bpEq');
  if(sel)sel.onchange=()=>{ps.equipment=sel.value;ps.editing=null;load(true)};
  const add=document.getElementById('bpAdd');
  if(add)add.onclick=()=>{
   ps.rules.push({id:null,equipment:ps.equipment,name:'',conditions:[],group:'',enabled:true});
   ps.editing=ps.rules.length-1;renderList(true);
  };
  const clr=document.getElementById('bpClear');
  if(clr)clr.onclick=()=>{ps.probe={};renderForm();renderList()};
  form.querySelectorAll('[data-p]').forEach(el=>{
   el.oninput=()=>{ps.probe[el.dataset.p]=el.value;renderForm();renderList();
    const again=document.querySelector(`#masterMaintForm [data-p="${CSS.escape(el.dataset.p)}"]`);
    if(again){again.focus();try{again.setSelectionRange(again.value.length,again.value.length)}catch(_e){WL.quiet.note('カーソル位置を戻せない（値は入っている）',_e)}}};
  });
 }

 /* ---------- 触る ---------- */
 function bindList(){
  const box=document.getElementById('masterMaintList');if(!box)return;
  box.querySelectorAll('[data-act]').forEach(b=>{
   b.onclick=()=>act(b.dataset.act,b);
  });
  const ed=box.querySelector('.bp-card.is-edit');
  if(!ed)return;
  /* **打つそばからモデルへ写す**（`input`で受ける）。`change`だけで受けると、
     欄から出る前に保存を押された値が入らない——実際に条件の値と刃の組が
     空のまま保存されかけた。写すだけで**窓は作り直さない**。 */
  ed.querySelectorAll('input,select').forEach(el=>{
   el.oninput=()=>{readEditor();paintCards()};
   el.onchange=()=>{
    readEditor();
    /* 「範囲」を選んだときだけ上限の欄を出す。**窓ごと作り直さず**、
       その欄の hidden だけを動かす（打ちかけの値を消さない）。 */
    if(el.classList.contains('bp-o')){
     const row=el.closest('.bp-row'),v2=row&&row.querySelector('.bp-v2');
     if(v2)v2.hidden=!isTwo(el.value);
    }
    paintCards();
   };
  });
 }
 /* 窓の今の値を、編集中の決まりへ写す。**写すだけで描き直さない**
    （描き直すと打ちかけの字が消える・§9.361）。 */
 function readEditor(){
  const i=ps.editing;if(i===null)return;
  const r=ps.rules[i];
  const nameEl=document.getElementById('bpName');
  if(nameEl)r.name=nameEl.value;
  const g=document.getElementById('bpGroup');
  if(g)r.group=g.value;
  const on=document.getElementById('bpOn');
  if(on)r.enabled=on.checked;
  const rows=document.getElementById('bpRows');
  if(rows){
   r.conditions=[...rows.querySelectorAll('.bp-row')].map(row=>{
    const f=row.querySelector('.bp-f').value,o=row.querySelector('.bp-o').value;
    const c={field:f,op:o,value:row.querySelector('.bp-v').value};
    if(isTwo(o))c.value2=row.querySelector('.bp-v2').value;
    return c;
   });
  }
 }
 async function act(a,btn){
  const i=+(btn.dataset.r!==undefined?btn.dataset.r:ps.editing);
  if(a==='edit'){ps.editing=i;renderList(true);return}
  if(a==='cancel'){
   /* 保存していない新しい行は、やめたら残さない。 */
   if(ps.rules[ps.editing]&&!ps.rules[ps.editing].id)ps.rules.splice(ps.editing,1);
   ps.editing=null;renderList(true);return;
  }
  if(a==='addcond'){
   readEditor();
   const f=ps.fields[0];
   ps.rules[ps.editing].conditions.push({field:f?f.field:'',op:'eq',value:''});
   renderList(true);return;
  }
  if(a==='delcond'){
   readEditor();
   ps.rules[ps.editing].conditions.splice(+btn.dataset.c,1);
   renderList(true);return;
  }
  if(a==='up'||a==='down')return void move(i,a==='up'?-1:1);
  if(a==='save')return void save();
  if(a==='delete')return void remove();
 }

 async function post(path,body){
  return api(path,{method:'POST',headers:{'Content-Type':'application/json'},
                   body:JSON.stringify(body)});
 }
 async function save(){
  readEditor();
  const uid=requireMaintUser();if(uid===null)return;
  const r=ps.rules[ps.editing];
  if(!r.name.trim())return void alertModal('この決まりの名前を入れてください。');
  if(!r.group)return void alertModal('当たったときに使う刃の組を選んでください。');
  if(!(r.conditions||[]).length)
   return void alertModal('条件がありません。条件が1つも無い決まりは当たらないので、1つ以上足してください。');
  try{
   await post('/api/bladeset/blade-pick',{id:r.id,equipment:ps.equipment,name:r.name,
     conditions:r.conditions,group:r.group,enabled:r.enabled,user_id:uid});
   ps.editing=null;await load(true);
  }catch(e){await alertModal('保存できませんでした：'+(e&&e.message?e.message:e))}
 }
 async function remove(){
  const r=ps.rules[ps.editing];
  if(!r||!r.id)return;
  if(!await confirmModal({title:'この決まりを消す',eyebrow:'刃選択',
    bodyHtml:`<p class="confirm-modal-message">「${esc(r.name||'(名前なし)')}」を消します。`
      +'この決まりで選ばれていた作業は、以後<b>一般の刃</b>になります。</p>',
    confirmLabel:'消す',cancelLabel:'やめる'}))return;
  try{
   await post('/api/bladeset/blade-pick/delete',{id:r.id});
   ps.editing=null;await load(true);
  }catch(e){await alertModal('消せませんでした：'+(e&&e.message?e.message:e))}
 }
 /* 並びは「上から順に見て最初に当たった1つ」が効くので、**順番そのものが設定**。
    入れ替えたら両方の行の表示順を書き直す（片方だけだと同値で並びが決まらない）。 */
 async function move(i,d){
  const j=i+d;
  if(j<0||j>=ps.rules.length)return;
  const uid=requireMaintUser();if(uid===null)return;
  const a=ps.rules[i],b=ps.rules[j];
  ps.rules[i]=b;ps.rules[j]=a;
  renderList();
  try{
   await post('/api/bladeset/blade-pick',{id:b.id,order:(i+1)*10,user_id:uid});
   await post('/api/bladeset/blade-pick',{id:a.id,order:(j+1)*10,user_id:uid});
   await load(true);
  }catch(e){await alertModal('並びを保存できませんでした：'+(e&&e.message?e.message:e));await load(true)}
 }

 /* ---------- 読む ---------- */
 async function load(force){
  const box=document.getElementById('masterMaintList');if(!box)return;
  if(typeof WL.records.loadEquipmentMaster==='function'){
   try{await WL.records.loadEquipmentMaster(force)}
   catch(e){WL.quiet.note('設備マスタが読めなくても盤は開く',e)}
  }
  const eqs=(WL.records.equipmentMasterState.items)||[];
  if(!ps.equipment&&eqs.length)ps.equipment=eqs[0].name;
  renderForm();
  if(!ps.equipment){box.innerHTML='<div class="mm-empty">設備マスタが未登録です。先に「設備」タブで登録してください。</div>';return}
  setMaintLoading&&setMaintLoading(true);
  box.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const c=await api('/api/bladeset/context?equipment='+encodeURIComponent(ps.equipment));
   ps.fields=c.pickFields||[];ps.ops=c.pickOps||[];
   ps.rules=(c.picks||[]).map(r=>Object.assign({},r,{conditions:(r.conditions||[]).map(x=>Object.assign({},x))}));
   /* 刃の組の候補。**「専用の刃がある組」を先に**出し、無い組も選べるようにして
      「先に決まりを書いて、あとで刃を登録する」順でも詰まらないようにする。 */
   const sp=c.bladeSpecial||'専用';
   const seen=new Map();
   (c.blades||[]).forEach(b=>{
    const g=b.group||'';if(!g)return;
    const cur=seen.get(g)||{group:g,special:false};
    if(b.status===sp)cur.special=true;
    seen.set(g,cur);
   });
   ps.groups=[...seen.values()].sort((a,b)=>(b.special-a.special)||a.group.localeCompare(b.group));
   ps.loaded=true;
   renderForm();renderList();
  }catch(e){
   box.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e&&e.message?e.message:e)}</div>`;
  }finally{setMaintLoading&&setMaintLoading(false)}
 }

 WL.mm.registerSpecial('blade-pick',{load});
 WL.bladePick={state:ps,probeHit,load};
})();
