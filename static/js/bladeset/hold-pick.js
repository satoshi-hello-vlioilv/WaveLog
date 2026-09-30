/* ============================================================
   hold-pick.js: 保持方式マスタの盤（§9.524、利用者の指示）

   「フィンガーとゴムリングを選ぶ条件を今は板厚だけで…条件が複雑になるので、
     取得済みデータを列に持つ条件テーブルを組めるようにマスタを追加してください。」
   利用者の選択: 列＝計算値＋仕掛の列／表の形＝列がデータの判定表／
   当たらないときは表の最後の既定行で決める。

   **判定表**（Excel の判定表と同じ読み方）:
     ・列＝データ（板厚・条数…・仕掛の列）、行＝1つの決まり、右端＝保持方式
     ・セルに条件を書く（`< 0.6`・`0.6〜1.0`・`>= 20`・`SUS`・`*SUS*`）。**空欄＝問わない**
     ・**上から順に見て、最初に当たった行**の方式を使う。最後の行は「どれにも
       当てはまらないとき」で、消せない（方式が決まらない作業を作らない）
     ・見出しのすぐ下の「試す」行に値を入れると、当たる行が光り、セルごとに○×が付く

   判定は**書かない**。`blade-core.js` の `firstRule()`／`condHits()` をそのまま呼ぶ
   ——盤と刃組ガイダンスで判定が食い違うと、「盤では当たるのに現場では当たらない」
   という最も分かりにくい形で壊れる（§9.379）。表は1枚として編集し、保存は丸ごと。
   ============================================================ */
(function(){
 const {requireMaintUser,setMaintLoading}=WL.mm;
 const BS=()=>WL.bladeSet;
 const hs={equipment:'',rows:[],cols:[],fields:[],ops:[],methods:[],materials:[],sourceCols:[],
           stored:false,probe:{},dirty:false,loaded:false};
 const SRC='source.';
 const isSrc=f=>String(f).startsWith(SRC);
 const colLabel=f=>isSrc(f)?String(f).slice(SRC.length):(((hs.fields.find(x=>x.field===f)||{}).label)||f);
 const kindOf=f=>((hs.fields.find(x=>x.field===f)||{}).kind)||(isSrc(f)?'auto':'text');

 /* ---------- セルの字 ⇔ 条件 ----------
    書き方は1箇所で読む。**読めない字は条件にしない**（理由を字で返す）——黙って
    落とすと「書いたのに当たらない」になる。 */
 const OP_SIGNS=[[/^(>=|≧|=>)/,'ge'],[/^(<=|≦|=<)/,'le'],[/^(!=|≠|<>)/,'ne'],
                 [/^(>|＞)/,'gt'],[/^(<|＜)/,'lt'],[/^(=|＝)/,'eq']];
 const OP_TEXT={ge:'≧ ',le:'≦ ',ne:'≠ ',gt:'＞ ',lt:'＜ ',eq:''};
 function parseCell(text,field){
  const t=String(text||'').trim();
  if(!t)return {cond:null};
  const numOnly=kindOf(field)==='num';
  const range=t.match(/^(.+?)\s*[〜~～]\s*(.+)$/);
  if(range){
   const a=Number(range[1]),b=Number(range[2]);
   if(!isFinite(a)||!isFinite(b))return {error:'範囲は「0.6〜1.0」のように数で書いてください'};
   return {cond:{field,op:'between',value:String(a),value2:String(b)}};
  }
  const like=t.match(/^\*(.+)\*$/);
  if(like){
   if(numOnly)return {error:'この列は数なので「含む」は使えません'};
   return {cond:{field,op:'contains',value:like[1].trim()}};
  }
  let op='eq',v=t;
  for(const [re,o] of OP_SIGNS){const m=t.match(re);if(m){op=o;v=t.slice(m[0].length).trim();break}}
  if(!v)return {error:'比べる値を書いてください'};
  if((numOnly||/^(ge|le|gt|lt)$/.test(op))&&!isFinite(Number(v)))return {error:'この比べ方は数で書いてください'};
  return {cond:{field,op,value:v}};
 }
 function cellText(c){
  if(!c)return '';
  if(c.op==='between')return `${c.value}〜${c.value2}`;
  if(c.op==='contains')return `*${c.value}*`;
  return (OP_TEXT[c.op]??'')+c.value;
 }
 /* 答えの列の選択肢＝保持方式×フィンガー材質（§9.527、利用者の選択「保持方式の表で決める」）。
    フィンガーだけ材質ごとに分け、値は「方式|材質」。空の材質は既定（候補の先頭）として見せる。 */
 const isFingerHold=m=>m===(hs.methods[0]||'フィンガー');
 const matOf=r=>(isFingerHold(r.hold)?(r.material||hs.materials[0]||''):'');
 const outChoices=()=>hs.methods.flatMap(m=>isFingerHold(m)&&hs.materials.length
  ?hs.materials.map(x=>({v:`${m}|${x}`,label:`${m}（${x}）`})):[{v:`${m}|`,label:m}]);
 const outLabel=r=>(matOf(r)?`${r.hold}（${matOf(r)}）`:r.hold);
 const condOf=(row,f)=>(row.conditions||[]).find(c=>c.field===f)||null;
 /* 既定の行＝条件の無い行。**足したばかりで条件をまだ書いていない行**（`fresh`）は違う。 */
 const isDefault=r=>!(r.conditions||[]).length&&!r.fresh;

 /* ---------- 試す ---------- */
 /* **見えている列の値だけ**を読む——消した列・戻した表に無い列の値が裏で効くと、
    画面に無い条件で答えが変わる（実際に「未登録に戻す」のあと前の条数で当たっていた）。 */
 function probeCtx(){
  const c={};
  hs.cols.forEach(f=>{
   const v=hs.probe[f];
   if(v===undefined||String(v).trim()==='')return;
   c[f]=kindOf(f)==='num'?Number(v):String(v);
  });
  return c;
 }
 const probeFilled=()=>hs.cols.some(f=>String(hs.probe[f]??'').trim()!=='');
 function probeHit(){
  if(!probeFilled())return null;
  /* 書きかけの行（条件なし）は当てない——既定の行と取り違えないように。番号は表の並びのまま。 */
  return BS().firstRule(hs.rows.map(r=>r.fresh&&!(r.conditions||[]).length?Object.assign({},r,{enabled:false}):r),probeCtx(),hs.fields,true);
 }
 /* セル1つの○×（試しの値があるときだけ）。空欄のセルは「問わない」なので印を付けない。 */
 function cellMark(c){
  if(!c||!probeFilled())return '';
  const kinds={};hs.fields.forEach(f=>{kinds[f.field]=f.kind});
  return BS().condHits(c,probeCtx(),kinds)?'is-hit':'is-miss';
 }

 /* ---------- 描く ---------- */
 function renderForm(){
  const form=document.getElementById('masterMaintForm');if(!form)return;
  const eqs=(WL.records&&WL.records.equipmentMasterState&&WL.records.equipmentMasterState.items)||[];
  const opt=eqs.map(e=>`<option value="${esc(e.name)}"${e.name===hs.equipment?' selected':''}>${esc(e.name)}</option>`).join('');
  const state=!hs.loaded?'':hs.dirty?'<span class="hp-state is-dirty">保存していない変更があります</span>'
   :hs.stored?'<span class="hp-state">登録済みの表</span>'
   :'<span class="hp-state is-seed">未登録——刃組基準値の<b>フィンガー切替板厚</b>から作った表です（保存すると登録になります）</span>';
  form.innerHTML=`<div class="mm-form-head"><span class="mm-mode-chip new">保持方式</span></div>
   <div class="mm-cd-toolbar">
    <div class="mm-cd-dbtabs"><select id="hpEq">${opt||'<option value="">設備マスタが未登録です</option>'}</select>${state}</div>
    <div class="mm-cd-actions">
     <select id="hpAddCol" aria-label="列を足す">${addColOptions()}</select>
     <button type="button" class="mm-btn-ghost sm" id="hpAddRow">＋ 決まりを足す</button>
     ${hs.stored?'<button type="button" class="mm-btn-ghost sm" id="hpReset" title="この設備の表の登録を消し、刃組基準値のフィンガー切替板厚で決める状態へ戻します">未登録に戻す</button>':''}
     <button type="button" class="mm-btn-primary sm" id="hpSave"${hs.dirty?'':' disabled'}>保存</button>
    </div>
   </div>
   <p class="mm-form-hint"><b>上から順に見て、最初に当たった行</b>の方式で板を保持します。同じ行のセルはすべて満たしたときだけ当たり、
    <b>空欄のセルは「問わない」</b>。セルの書き方: <code>&lt; 0.6</code>・<code>0.6〜1.0</code>・<code>&gt;= 20</code>・<code>SUS</code>・<code>!= X</code>・<code>*SUS*</code>（含む）</p>`;
  form.onsubmit=ev=>ev.preventDefault();
  wireForm(form);
 }
 function addColOptions(){
  const used=new Set(hs.cols);
  const calc=hs.fields.filter(f=>!used.has(f.field))
   .map(f=>`<option value="${esc(f.field)}">${esc(f.label)}</option>`).join('');
  const src=hs.sourceCols.filter(n=>!used.has(SRC+n))
   .map(n=>`<option value="${esc(SRC+n)}">${esc(n)}</option>`).join('');
  return '<option value="">＋ 列（データ）を足す</option>'
   +(calc?`<optgroup label="計算値">${calc}</optgroup>`:'')
   +(src?`<optgroup label="仕掛の列">${src}</optgroup>`:'<optgroup label="仕掛の列（読めませんでした）"></optgroup>');
 }
 function renderList(){
  const box=document.getElementById('masterMaintList');if(!box)return;
  if(!hs.loaded)return;
  const hit=probeHit();
  const head=`<tr><th class="hp-no">#</th>${hs.cols.map((f,ci)=>`<th class="hp-col" data-src="${isSrc(f)?1:0}">`
   +`<span>${esc(colLabel(f))}</span>${isSrc(f)?'<small>仕掛</small>':''}`
   +`<button type="button" class="hp-x" data-act="delcol" data-c="${ci}" title="この列を消す" aria-label="この列を消す">×</button></th>`).join('')}
   <th class="hp-out">→ 保持方式</th><th class="hp-note">備考</th><th class="hp-ops"></th></tr>`;
  const probe=`<tr class="hp-try"><th class="hp-no">試す</th>${hs.cols.map(f=>`<td><input class="hp-p" data-p="${esc(f)}"`
   +` type="${kindOf(f)==='num'?'number':'text'}" step="any" value="${esc(hs.probe[f]??'')}" placeholder="値"></td>`).join('')}
   <td class="hp-ans" colspan="3">${!probeFilled()?'<span class="is-idle">値を入れると、当たる行が光ります</span>'
    :hit?`<b>${esc(outLabel(hit.row))}</b>（${isDefault(hit.row)?'最後の既定の行':`${hit.index+1}行目`}に当たる）`:'<span class="is-idle">当たる行がありません</span>'}</td></tr>`;
  const body=hs.rows.map((r,i)=>rowHtml(r,i,hit)).join('');
  box.innerHTML=`<div class="hp-wrap"><table class="hp-table"><thead>${head}${probe}</thead><tbody>${body}</tbody></table></div>`;
  wireList(box);
 }
 function rowHtml(r,i,hit){
  const def=isDefault(r),won=hit&&hit.index===i;
  const last=hs.rows.length-2;
  const cells=def?`<td class="hp-any" colspan="${Math.max(1,hs.cols.length)}">どれにも当てはまらないとき</td>`
   :hs.cols.map(f=>{const c=condOf(r,f),mk=cellMark(c),bad=(r.bad||{})[f];
     /* 読めなかった字は**直すまでそのまま残す**（描き直しで消すと、受け付けたと読める）。 */
     if(bad)return `<td class="hp-cell"><input class="hp-c is-bad" data-r="${i}" data-f="${esc(f)}" value="${esc(bad.text)}"`
      +` title="${esc(bad.why)}" autocomplete="off"></td>`;
     return `<td class="hp-cell ${mk}"><input class="hp-c" data-r="${i}" data-f="${esc(f)}" value="${esc(cellText(c))}"`
      +` placeholder="問わない" autocomplete="off"${mk?` title="${mk==='is-hit'?'○ 当たる':'× 当たらない'}"`:''}>`
      +(mk?`<i class="hp-mk" aria-hidden="true">${mk==='is-hit'?'○':'×'}</i>`:'')+'</td>'}).join('');
  const cur=`${r.hold}|${matOf(r)}`;
  const sel=`<select class="hp-hold" data-r="${i}" aria-label="保持方式">${outChoices().map(o=>
   `<option value="${esc(o.v)}"${o.v===cur?' selected':''}>${esc(o.label)}</option>`).join('')}</select>`;
  const ops=def?'':`<button type="button" class="hp-mv" data-act="up" data-r="${i}" title="1つ上へ"${i===0?' disabled':''}>▲</button>`
   +`<button type="button" class="hp-mv" data-act="down" data-r="${i}" title="1つ下へ"${i>=last?' disabled':''}>▼</button>`
   +`<button type="button" class="hp-x" data-act="delrow" data-r="${i}" title="この決まりを消す" aria-label="この決まりを消す">×</button>`;
  return `<tr class="hp-row${def?' is-default':''}${won?' is-won':''}" data-r="${i}"><th class="hp-no">${def?'既定':i+1}</th>${cells}`
   +`<td class="hp-out">${sel}</td><td class="hp-note"><input class="hp-n" data-r="${i}" value="${esc(r.note||'')}" placeholder="—"></td>`
   +`<td class="hp-ops">${ops}</td></tr>`;
 }

 /* ---------- 触る ---------- */
 function touch(){hs.dirty=true;renderForm()}
 function wireForm(form){
  const sel=form.querySelector('#hpEq');
  if(sel)sel.onchange=async()=>{
   if(hs.dirty&&!await confirmModal({title:'保存していない変更を捨てる',eyebrow:'保持方式',
     bodyHtml:'<p class="confirm-modal-message">この設備の表に保存していない変更があります。捨てて設備を切り替えますか？</p>',
     confirmLabel:'捨てて切り替える',cancelLabel:'やめる'})){sel.value=hs.equipment;return}
   hs.equipment=sel.value;load(true);
  };
  const add=form.querySelector('#hpAddCol');
  if(add)add.onchange=()=>{if(add.value&&!hs.cols.includes(add.value)){hs.cols.push(add.value);touch();renderList()}};
  const row=form.querySelector('#hpAddRow');
  if(row)row.onclick=()=>{hs.rows.splice(hs.rows.length-1,0,{conditions:[],hold:hs.methods[0]||'フィンガー',note:'',fresh:true});touch();renderList()};
  const save=form.querySelector('#hpSave');
  if(save)save.onclick=()=>saveTable();
  const reset=form.querySelector('#hpReset');
  if(reset)reset.onclick=()=>resetTable();
 }
 function wireList(box){
  box.querySelectorAll('[data-act]').forEach(b=>{b.onclick=()=>act(b.dataset.act,+b.dataset.r,+b.dataset.c)});
  box.querySelectorAll('.hp-c').forEach(el=>{
   el.onchange=()=>setCell(+el.dataset.r,el.dataset.f,el.value,el);
  });
  box.querySelectorAll('.hp-hold').forEach(el=>{el.onchange=()=>{
   const [hold,material]=el.value.split('|');Object.assign(hs.rows[+el.dataset.r],{hold,material:material||''});touch();renderList()}});
  box.querySelectorAll('.hp-n').forEach(el=>{el.oninput=()=>{hs.rows[+el.dataset.r].note=el.value;touch()}});
  box.querySelectorAll('.hp-p').forEach(el=>{
   el.oninput=()=>{hs.probe[el.dataset.p]=el.value;renderList();
    const again=document.querySelector(`#masterMaintList .hp-p[data-p="${CSS.escape(el.dataset.p)}"]`);
    if(again){again.focus();try{again.setSelectionRange(again.value.length,again.value.length)}catch(_e){WL.quiet.note('カーソル位置を戻せない（値は入っている）',_e)}}};
  });
 }
 /* セルを書いたら条件へ直す。**読めない字はそのセルに理由を出して、前の条件を残す**。
    条件の無くなった行（全部空欄）は既定の行と見分けが付かないので、保存では落ちる。 */
 function setCell(ri,f,text,el){
  const r=hs.rows[ri];if(!r)return;
  const p=parseCell(text,f);
  if(p.error){r.bad=Object.assign(r.bad||{},{[f]:{text,why:p.error}});el.classList.add('is-bad');el.title=p.error;touch();return}
  if(r.bad){delete r.bad[f];if(!Object.keys(r.bad).length)delete r.bad}
  el.classList.remove('is-bad');el.title='';
  r.conditions=(r.conditions||[]).filter(c=>c.field!==f);
  if(p.cond)r.conditions.push(p.cond);
  r.conditions.sort((a,b)=>hs.cols.indexOf(a.field)-hs.cols.indexOf(b.field));
  delete r.fresh;
  touch();renderList();
 }
 async function act(a,ri,ci){
  if(a==='up'||a==='down'){
   const j=ri+(a==='up'?-1:1);
   if(j<0||j>=hs.rows.length-1)return;
   [hs.rows[ri],hs.rows[j]]=[hs.rows[j],hs.rows[ri]];touch();renderList();return;
  }
  if(a==='delrow'){hs.rows.splice(ri,1);touch();renderList();return}
  if(a==='delcol'){
   const f=hs.cols[ci],n=hs.rows.filter(r=>condOf(r,f)).length;
   if(n&&!await confirmModal({title:'列を消す',eyebrow:'保持方式',
     bodyHtml:`<p class="confirm-modal-message">「${esc(colLabel(f))}」の条件 ${n}個も一緒に消えます。</p>`,
     confirmLabel:'消す',cancelLabel:'やめる'}))return;
   hs.cols.splice(ci,1);delete hs.probe[f];
   hs.rows.forEach(r=>{r.conditions=(r.conditions||[]).filter(c=>c.field!==f)});
   touch();renderList();
  }
 }
 async function saveTable(){
  const uid=requireMaintUser();if(uid===null)return;
  const bad=hs.rows.filter(r=>r.bad).length;
  if(bad)return void alertModal(`読めないセルが ${bad}行にあります。赤い枠のセルを直してから保存してください（枠に乗せると理由が出ます）。`);
  const empty=hs.rows.filter(r=>!isDefault(r)||r.fresh).filter(r=>!(r.conditions||[]).length).length;
  if(empty&&!await confirmModal({title:'条件の無い決まり',eyebrow:'保持方式',
    bodyHtml:`<p class="confirm-modal-message">条件が1つも無い決まりが ${empty}行あります。条件の無い行は既定の行と同じ意味になるので、保存では落とします。</p>`,
    confirmLabel:'落として保存する',cancelLabel:'やめる'}))return;
  const rows=hs.rows.filter(r=>(r.conditions||[]).length||r===hs.rows[hs.rows.length-1])
   .map(r=>({conditions:r.conditions||[],hold:r.hold,material:matOf(r),note:r.note||''}));
  try{
   await api('/api/bladeset/hold-pick',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({equipment:hs.equipment,rows,user_id:uid})});
   hs.dirty=false;await load(true);
   showToast&&showToast('保持方式の表を保存しました',`${hs.equipment}・${rows.length}行`,2600);
  }catch(e){await alertModal('保存できませんでした：'+(e&&e.message?e.message:e))}
 }

 async function resetTable(){
  const uid=requireMaintUser();if(uid===null)return;
  if(!await confirmModal({title:'未登録に戻す',eyebrow:'保持方式',
    bodyHtml:`<p class="confirm-modal-message">「${esc(hs.equipment)}」の表の登録を消します。以後は刃組基準値の<b>フィンガー切替 板厚</b>だけで決めます。</p>`,
    confirmLabel:'未登録に戻す',cancelLabel:'やめる'}))return;
  try{
   await api('/api/bladeset/hold-pick',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({equipment:hs.equipment,reset:true,user_id:uid})});
   await load(true);
  }catch(e){await alertModal('戻せませんでした：'+(e&&e.message?e.message:e))}
 }

 /* ---------- 読む ---------- */
 /* 仕掛の列名（条件の列の候補）。**読めなければ空**——計算値の列だけで組める。 */
 async function loadSourceCols(){
  const db=WL.dataSource&&WL.dataSource.workKey&&WL.dataSource.workKey();
  if(!db)return [];
  try{const r=await api('/api/table-columns?db='+encodeURIComponent(db),{quiet:true});return Array.isArray(r.columns)?r.columns:[]}
  catch(e){WL.quiet.note('仕掛の列名を取れない（計算値の列だけで組める）',e);return []}
 }
 async function load(force){
  const box=document.getElementById('masterMaintList');if(!box)return;
  if(typeof WL.records.loadEquipmentMaster==='function'){
   try{await WL.records.loadEquipmentMaster(force)}
   catch(e){WL.quiet.note('設備マスタが読めなくても盤は開く',e)}
  }
  const eqs=(WL.records.equipmentMasterState.items)||[];
  if(!hs.equipment&&eqs.length)hs.equipment=eqs[0].name;
  hs.loaded=false;hs.dirty=false;
  renderForm();
  if(!hs.equipment){box.innerHTML='<div class="mm-empty">設備マスタが未登録です。先に「設備」タブで登録してください。</div>';return}
  setMaintLoading&&setMaintLoading(true);
  box.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const [c,src]=await Promise.all([api('/api/bladeset/hold-pick?equipment='+encodeURIComponent(hs.equipment)),loadSourceCols()]);
   hs.fields=c.fields||[];hs.ops=c.ops||[];hs.methods=c.methods||['フィンガー','ゴムリング'];hs.stored=!!c.stored;
   hs.materials=c.fingerMaterials||[];
   hs.sourceCols=src;
   hs.rows=(c.rows||[]).map(r=>({conditions:(r.conditions||[]).map(x=>Object.assign({},x)),hold:r.hold,material:r.material||'',note:r.note||''}));
   /* 列＝表に書いてある項目（上の行・左の条件から順に）。何も無ければ板厚を1列目に。 */
   const cols=[];hs.rows.forEach(r=>(r.conditions||[]).forEach(x=>{if(!cols.includes(x.field))cols.push(x.field)}));
   hs.cols=cols.length?cols:['thickness'];
   hs.loaded=true;
   renderForm();renderList();
  }catch(e){
   box.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e&&e.message?e.message:e)}</div>`;
  }finally{setMaintLoading&&setMaintLoading(false)}
 }

 WL.mm.registerSpecial('hold-pick',{load});
 WL.holdPick={state:hs,parseCell,cellText,probeHit,load};
})();
