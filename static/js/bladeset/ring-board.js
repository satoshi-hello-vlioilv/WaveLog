/* ============================================================
   ring-board.js: ゴムリングマスタの盤（§9.528、利用者の指示）

   「ゴムリングの管理は、色ごとに外径内径は共通にして、幅毎に本数を管理できるように…
     色はコードではわかりにくいのでカラーピッカーなど直感的に色が判断できるもの、
     今まで登録した色と被らないようにしたいのでそれらの登録状況がわかるもの、
     色ごとにゴムリングをまとめて表示できるようにしてください。」
   利用者の選択: 上の帯＝登録済みの色（見本つき）＋選んだ色のカード／同じは断る・近いは注意。

   ・帯（`#masterMaintForm`）: 登録済みの色を**外径の順に全部**並べる。見本・色名・外径。
     押すとその色のカード。「＋ 色を足す」は空いている標準の色を最初から入れて開く。
   ・カード（`#masterMaintList`）: 色（ピッカー）・色名・外径・内径は**1回だけ**（その色の
     幅ぜんぶに効く）。幅ごとの本数は表の中でその場で直す（欄を離れると保存）。
   ・被り: 色・色名・外径を触るたびにサーバーへ聞く（`ring_color_conflicts()`の1箇所）。
     断る被りは保存を止めて理由を字で、近い色は注意として帯の見本にも印を付ける。
   ============================================================ */
(function(){
 const {requireMaintUser,setMaintLoading}=WL.mm;
 const NEW='__new';
 const WIDTH_SEED=[50,30,20,15,10];
 const rs={equipment:'',colors:[],cycle:[],suggest:null,nearDe:20,sel:'',draft:null,
           check:{hard:[],near:[],text:''},busy:false};
 let checkTimer=0,checkSeq=0;

 const colorOf=name=>rs.colors.find(g=>g.color===name)||null;
 const num=v=>(String(v??'').trim()===''?null:Number(v));
 const fmt=v=>(v==null||v===''?'—':String(+(+v).toFixed(2)));
 const swatch=(hex,lube)=>`<i class="rb-sw${lube?' is-lube':''}"${hex?` style="--sw:${esc(hex)}"`:''} aria-hidden="true"></i>`;
 const post=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

 /* ---------- 下書き（カードの中身） ---------- */
 function draftOf(g){
  if(g)return {current:g.color,color:g.color,hex:g.hex||'',od:g.od,bore:g.bore,lube:!!g.lube};
  const s=rs.suggest||{};
  const ws=[...new Set(rs.colors.filter(x=>!x.lube).flatMap(x=>x.widths.map(w=>w.width)))].sort((a,b)=>b-a);
  return {current:'',color:s.color||'',hex:s.hex||'#8a3ad9',od:s.od??'',bore:s.bore??'',lube:false,
          widths:(ws.length?ws:WIDTH_SEED).map(w=>({width:w,qty:'',minQty:''}))};
 }
 const isDirty=()=>{const d=rs.draft,g=colorOf(d&&d.current);
  return !!d&&(!g||d.color!==g.color||(d.hex||'')!==(g.hex||'')||num(d.od)!==g.od||num(d.bore)!==g.bore)};

 /* ---------- 帯（登録済みの色） ---------- */
 function renderForm(){
  const form=document.getElementById('masterMaintForm');if(!form)return;
  const eqs=(WL.records&&WL.records.equipmentMasterState&&WL.records.equipmentMasterState.items)||[];
  const opt=eqs.map(e=>`<option value="${esc(e.name)}"${e.name===rs.equipment?' selected':''}>${esc(e.name)}</option>`).join('');
  const rubber=rs.colors.filter(g=>!g.lube).length,lube=rs.colors.length-rubber;
  form.innerHTML=`<div class="mm-form-head"><span class="mm-mode-chip new">ゴムリング</span></div>
   <div class="mm-cd-toolbar"><div class="mm-cd-dbtabs"><select id="rbEq">${opt||'<option value="">設備マスタが未登録です</option>'}</select>
    <span class="rb-count">登録済みの色 <b>${rubber}色</b>${lube?`＋潤滑リング ${lube}`:''}（外径の大きい順）</span></div>
    <div class="mm-cd-actions"><button type="button" class="mm-btn-primary sm" id="rbAdd"${rs.equipment?'':' disabled'}>＋ 色を足す</button></div></div>
   <div class="rb-strip" role="list">${rs.colors.map(chipHtml).join('')||'<span class="rb-none">まだ1色もありません。「＋ 色を足す」から登録してください。</span>'}</div>`;
  form.onsubmit=ev=>ev.preventDefault();
  const sel=form.querySelector('#rbEq');
  if(sel)sel.onchange=async()=>{if(!await leaveOk())return void(sel.value=rs.equipment);rs.equipment=sel.value;rs.sel='';load(true)};
  form.querySelector('#rbAdd').onclick=async()=>{if(await leaveOk())select(NEW)};
  form.querySelectorAll('.rb-chip').forEach(b=>{b.onclick=async()=>{if(await leaveOk())select(b.dataset.color)}});
  paintMarks();
 }
 function chipHtml(g){
  return `<button type="button" role="listitem" class="rb-chip${g.color===rs.sel?' is-on':''}" data-color="${esc(g.color)}"`
   +` title="${esc(`${g.color}　外径 ${fmt(g.od)}／内径 ${fmt(g.bore)}　幅 ${g.widths.length}種・${g.total}本`)}">`
   +`${swatch(g.hex,g.lube)}<b>${esc(g.color)}</b><small>${g.lube?'潤滑 ':''}${fmt(g.od)}</small></button>`;
 }
 /* 被りの印は帯の見本へ（断る＝赤の枠・近い＝橙の枠）。字は title とカードの中が持つ。 */
 function paintMarks(){
  const hard=new Set(rs.check.hard.map(x=>x.color)),near=new Set(rs.check.near.map(x=>x.color));
  document.querySelectorAll('#masterMaintForm .rb-chip').forEach(b=>{
   b.classList.toggle('is-hard',hard.has(b.dataset.color));
   b.classList.toggle('is-near',!hard.has(b.dataset.color)&&near.has(b.dataset.color));
  });
 }

 /* ---------- カード（選んだ色） ---------- */
 function select(name){
  rs.sel=name;rs.draft=draftOf(name===NEW?null:colorOf(name));rs.check={hard:[],near:[],text:''};
  renderForm();renderCard();runCheck();
 }
 function renderCard(){
  const box=document.getElementById('masterMaintList');if(!box)return;
  const d=rs.draft;
  if(!d){box.innerHTML=`<div class="mm-empty">${rs.colors.length?'上の帯から色を選ぶと、その色の幅と本数が出ます。':'「＋ 色を足す」から最初の色を登録してください。'}</div>`;return}
  const g=colorOf(d.current),isNew=!g;
  box.innerHTML=`<section class="rb-card${d.lube?' is-lube':''}">
   <header class="rb-head">${swatch(d.hex,d.lube)}<h3>${isNew?'新しい色':esc(g.color)}</h3>
    <span class="rb-sub">${isNew?'色・外径・内径を決めて、幅ごとの本数を入れます':`外径・内径は幅 ${g.widths.length}種 すべてで共通`}</span></header>
   <div class="rb-attrs">${attrsHtml(d,isNew)}</div>
   <div class="rb-check" aria-live="polite"></div>
   ${isNew?newWidthsHtml(d):widthTableHtml(g)}
   <footer class="rb-foot">${isNew
    ?'<button type="button" class="mm-btn-primary sm" data-act="create">この色を登録する</button><button type="button" class="mm-btn-ghost sm" data-act="cancel">やめる</button>'
    :`<button type="button" class="mm-btn-primary sm" data-act="save" disabled>色・外径・内径を保存（${g.widths.length}行）</button>`
     +`<span class="rb-gap"></span><button type="button" class="mm-btn-ghost sm rb-danger" data-act="delcolor">この色を消す（${g.widths.length}行）</button>`}</footer>
  </section>`;
  wireCard(box);paintCheck();
 }
 function attrsHtml(d,isNew){
  const kind=isNew?`<label class="rb-f"><s>種類</s><select data-k="lube"><option value="">ゴムリング</option><option value="1"${d.lube?' selected':''}>潤滑リング</option></select></label>`:'';
  const th=num(d.od)!=null&&num(d.bore)!=null?((num(d.od)-num(d.bore))/2).toFixed(2):'—';
  return `${kind}<label class="rb-f rb-pick"><s>色</s><input type="color" data-k="hex" value="${esc(d.hex||'#8a3ad9')}"><code>${esc(d.hex||'（未設定）')}</code></label>
   <label class="rb-f"><s>色名</s><input type="text" data-k="color" value="${esc(d.color)}" placeholder="例: 赤" autocomplete="off"></label>
   <label class="rb-f"><s>外径</s><input type="number" data-k="od" step="0.1" min="0" value="${esc(d.od??'')}"><u>mm</u></label>
   <label class="rb-f"><s>内径</s><input type="number" data-k="bore" step="1" min="0" value="${esc(d.bore??'')}"><u>mm</u></label>
   <span class="rb-f rb-ro"><s>肉厚</s><b data-k="th">${th}</b><u>mm</u></span>${isNew?unusedHtml():''}`;
 }
 /* まだ使っていない標準の色（外径1mmごとの周期）。押すと色・色名・外径が入る。 */
 function unusedHtml(){
  const names=new Set(rs.colors.map(g=>g.color)),ods=new Set(rs.colors.filter(g=>!g.lube).map(g=>g.od));
  const free=rs.cycle.filter(x=>!names.has(x.color)&&!ods.has(x.od));
  return free.length?`<div class="rb-free"><s>空いている標準の色</s>${free.map(x=>`<button type="button" class="rb-chip is-sm" data-free="${esc(x.color)}">${swatch(x.hex)}<b>${esc(x.color)}</b><small>${fmt(x.od)}</small></button>`).join('')}</div>`:'';
 }
 function widthTableHtml(g){
  const rows=g.widths.map(w=>`<tr data-id="${w.id}"><th>${fmt(w.width)}<u>mm</u></th>
   <td><input type="number" class="rb-q" data-f="qty" min="0" step="1" value="${esc(w.qty??'')}" aria-label="幅${fmt(w.width)}の保有本数"></td>
   <td><input type="number" class="rb-q" data-f="minQty" min="0" step="1" value="${esc(w.minQty??'')}" aria-label="幅${fmt(w.width)}の下限本数"></td>
   <td class="rb-st">${w.minQty&&w.qty<w.minQty?'<b class="rb-low">下限を下回っています</b>':''}</td>
   <td><button type="button" class="rb-x" data-act="delwidth" data-id="${w.id}" title="この幅を消す" aria-label="幅${fmt(w.width)}を消す">×</button></td></tr>`).join('');
  return `<table class="rb-table"><thead><tr><th>幅</th><th>保有本数</th><th>下限本数</th><th></th><th></th></tr></thead>
   <tbody>${rows}</tbody><tfoot><tr><th><input type="number" id="rbNewW" min="0" step="1" placeholder="幅"></th>
   <td><input type="number" id="rbNewQ" min="0" step="1" placeholder="本数"></td><td></td>
   <td><button type="button" class="mm-btn-ghost sm" data-act="addwidth">＋ 幅を足す</button></td><td></td></tr>
   <tr class="rb-sum"><th>合計</th><td><b>${g.total}本</b></td><td colspan="3"></td></tr></tfoot></table>`;
 }
 function newWidthsHtml(d){
  return `<table class="rb-table"><thead><tr><th>幅</th><th>保有本数</th><th>下限本数</th><th></th></tr></thead><tbody>${
   d.widths.map((w,i)=>`<tr><th><input type="number" data-nw="${i}" data-f="width" min="0" step="1" value="${esc(w.width)}"><u>mm</u></th>
    <td><input type="number" data-nw="${i}" data-f="qty" min="0" step="1" value="${esc(w.qty)}" placeholder="0"></td>
    <td><input type="number" data-nw="${i}" data-f="minQty" min="0" step="1" value="${esc(w.minQty)}" placeholder="0"></td>
    <td><button type="button" class="rb-x" data-act="dropnew" data-i="${i}" aria-label="この幅を外す">×</button></td></tr>`).join('')}</tbody>
   <tfoot><tr><td colspan="4"><button type="button" class="mm-btn-ghost sm" data-act="addnew">＋ 幅の行を足す</button></td></tr></tfoot></table>`;
 }

 /* ---------- 被り（サーバーへ聞く） ---------- */
 function runCheck(){
  clearTimeout(checkTimer);
  const d=rs.draft;if(!d)return;
  checkTimer=setTimeout(async()=>{
   const seq=++checkSeq;
   try{
    const r=await post('/api/bladeset/ring-colors/check',{equipment:rs.equipment,color:d.color,hex:d.hex,od:d.od,
      lube:d.lube,current:d.current});
    if(seq!==checkSeq)return;   // 古い問い合わせの答えは捨てる（打ち続けている間に届いた分）
    rs.check={hard:r.hard||[],near:r.near||[],text:r.text||''};
   }catch(e){WL.quiet.note('被りの確認に失敗（保存のときにサーバーがもう一度見る）',e)}
   paintCheck();paintMarks();
  },180);
 }
 function paintCheck(){
  const box=document.querySelector('#masterMaintList .rb-check');if(!box)return;
  const c=rs.check;
  box.innerHTML=(c.hard.length?`<p class="rb-hard">${esc(c.text)}</p>`:'')
   +(c.near.length?`<p class="rb-near">見分けにくいほど近い色があります: ${c.near.map(x=>`${swatch(x.hex)}<b>${esc(x.color)}</b>（色差 ${x.de}）`).join('・')}。現場で取り違えないか確かめてください（保存はできます）。</p>`:'')
   +(!c.hard.length&&!c.near.length&&rs.draft?'<p class="rb-ok">登録済みの色と被っていません。</p>':'');
  const save=document.querySelector('#masterMaintList [data-act="save"]');
  if(save)save.disabled=!!c.hard.length||!isDirty()||rs.busy;
  const make=document.querySelector('#masterMaintList [data-act="create"]');
  if(make)make.disabled=!!c.hard.length||rs.busy;
 }

 /* ---------- 触る ---------- */
 function wireCard(box){
  box.querySelectorAll('[data-k]').forEach(el=>{
   const k=el.dataset.k;if(k==='th')return;
   el.oninput=el.onchange=()=>{
    const d=rs.draft;
    d[k]=k==='lube'?!!el.value:el.value;d.touched=true;
    if(k==='hex'){const code=el.parentElement.querySelector('code');if(code)code.textContent=el.value;
     box.querySelectorAll('.rb-head .rb-sw').forEach(s=>{s.style.setProperty('--sw',el.value)})}
    const th=box.querySelector('[data-k="th"]');
    if(th)th.textContent=num(d.od)!=null&&num(d.bore)!=null?((num(d.od)-num(d.bore))/2).toFixed(2):'—';
    paintCheck();runCheck();
   };
  });
  box.querySelectorAll('[data-free]').forEach(b=>{b.onclick=()=>{
   const x=rs.cycle.find(c=>c.color===b.dataset.free);if(!x)return;
   Object.assign(rs.draft,{color:x.color,hex:x.hex,od:x.od});renderCard();runCheck();
  }});
  box.querySelectorAll('.rb-q').forEach(el=>{el.onchange=()=>setCount(+el.closest('tr').dataset.id,el.dataset.f,el.value)});
  box.querySelectorAll('[data-nw]').forEach(el=>{el.oninput=()=>{rs.draft.widths[+el.dataset.nw][el.dataset.f]=el.value;rs.draft.touched=true}});
  box.querySelectorAll('[data-act]').forEach(b=>{b.onclick=()=>act(b.dataset.act,b)});
 }
 async function act(a,b){
  if(a==='cancel'){rs.sel='';rs.draft=null;rs.check={hard:[],near:[],text:''};renderForm();renderCard();return}
  if(a==='addnew'){rs.draft.widths.push({width:'',qty:'',minQty:''});renderCard();return}
  if(a==='dropnew'){rs.draft.widths.splice(+b.dataset.i,1);renderCard();return}
  if(a==='save'||a==='create')return void saveColor(a==='create');
  if(a==='addwidth')return void addWidth();
  if(a==='delwidth')return void delWidth(+b.dataset.id);
  if(a==='delcolor')return void delColor();
 }
 async function guarded(fn,fail){
  const uid=requireMaintUser();if(uid===null)return false;
  rs.busy=true;paintCheck();
  try{await fn(uid);return true}
  catch(e){await alertModal(fail+'：'+(e&&e.message?e.message:e));return false}
  finally{rs.busy=false;paintCheck()}
 }
 async function saveColor(isNew){
  const d=rs.draft;
  const ok=await guarded(async uid=>{
   const r=await post('/api/bladeset/ring-colors',{equipment:rs.equipment,color:d.color,hex:d.hex,od:d.od,bore:d.bore,
     lube:d.lube,current:isNew?'':d.current,user_id:uid,
     widths:isNew?d.widths.filter(w=>String(w.width).trim()!==''):undefined});
   showToast&&showToast(r.message||'保存しました',rs.equipment,2600);
  },isNew?'この色を登録できませんでした':'保存できませんでした');
  if(ok){rs.sel=d.color;await load(true)}
 }
 async function setCount(id,field,value){
  await guarded(async uid=>{
   await post('/api/bladeset-ring-master/update',{id,[field]:value===''?0:value,user_id:uid});
   const g=colorOf(rs.sel),w=g&&g.widths.find(x=>x.id===id);
   if(w){w[field]=value===''?0:+value;g.total=g.widths.reduce((s,x)=>s+(+x.qty||0),0)}
  },'本数を保存できませんでした');
  renderForm();renderCard();
 }
 async function addWidth(){
  const w=document.getElementById('rbNewW').value,q=document.getElementById('rbNewQ').value;
  if(String(w).trim()==='')return void alertModal('足す幅（mm）を入れてください。');
  const ok=await guarded(async uid=>{
   await post('/api/bladeset-ring-master',{equipment:rs.equipment,color:rs.sel,width:w,qty:q===''?0:q,user_id:uid});
  },'幅を足せませんでした');
  if(ok)await load(true);
 }
 async function delWidth(id){
  const g=colorOf(rs.sel),w=g&&g.widths.find(x=>x.id===id);if(!w)return;
  if(!await confirmModal({title:'この幅を消す',eyebrow:'ゴムリング',
    bodyHtml:`<p class="confirm-modal-message">「${esc(g.color)}」の幅 ${fmt(w.width)}mm（${w.qty||0}本）を消します。</p>`,
    confirmLabel:'消す',cancelLabel:'やめる'}))return;
  if(await guarded(async()=>{await post('/api/bladeset-ring-master/delete',{id})},'消せませんでした'))await load(true);
 }
 async function delColor(){
  const g=colorOf(rs.sel);if(!g)return;
  if(!await confirmModal({title:'この色を消す',eyebrow:'ゴムリング',
    bodyHtml:`<p class="confirm-modal-message">「${esc(g.color)}」の幅 ${g.widths.length}種（合計 ${g.total}本）をすべて消します。元に戻せません。</p>`,
    confirmLabel:'消す',cancelLabel:'やめる'}))return;
  if(await guarded(async uid=>{await post('/api/bladeset/ring-colors',{equipment:rs.equipment,current:g.color,delete:true,user_id:uid})},'消せませんでした')){
   rs.sel='';await load(true);
  }
 }
 /* 直しかけの色を捨てて離れてよいか（保存していない変更があるときだけ聞く）。 */
 async function leaveOk(){
  const d=rs.draft;
  if(!d||(d.current?!isDirty():!d.touched))return true;
  return confirmModal({title:'保存していない変更を捨てる',eyebrow:'ゴムリング',
   bodyHtml:'<p class="confirm-modal-message">この色に保存していない変更があります。捨てて切り替えますか？</p>',
   confirmLabel:'捨てて切り替える',cancelLabel:'やめる'});
 }

 /* ---------- 読む ---------- */
 async function load(force){
  const box=document.getElementById('masterMaintList');if(!box)return;
  if(typeof WL.records.loadEquipmentMaster==='function'){
   try{await WL.records.loadEquipmentMaster(force)}
   catch(e){WL.quiet.note('設備マスタが読めなくても盤は開く',e)}
  }
  const eqs=(WL.records.equipmentMasterState.items)||[];
  if(!rs.equipment&&eqs.length)rs.equipment=eqs[0].name;
  if(!rs.equipment){renderForm();box.innerHTML='<div class="mm-empty">設備マスタが未登録です。先に「設備」タブで登録してください。</div>';return}
  setMaintLoading&&setMaintLoading(true);
  try{
   const r=await api('/api/bladeset/ring-colors?equipment='+encodeURIComponent(rs.equipment));
   Object.assign(rs,{colors:r.colors||[],cycle:r.cycle||[],suggest:r.suggest||null,nearDe:r.nearDe||20});
   if(rs.sel!==NEW&&!colorOf(rs.sel))rs.sel=(rs.colors[0]||{}).color||'';
   rs.draft=rs.sel===NEW?draftOf(null):(rs.sel?draftOf(colorOf(rs.sel)):null);
   rs.check={hard:[],near:[],text:''};
   renderForm();renderCard();runCheck();
  }catch(e){box.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e&&e.message?e.message:e)}</div>`}
  finally{setMaintLoading&&setMaintLoading(false)}
 }
 WL.mm.registerSpecial('ring-board',{load});
 WL.ringBoard={state:rs,load,select};
})();
