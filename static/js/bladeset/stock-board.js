/* ============================================================
   stock-board.js: スペーサー・フィンガーの盤（§9.531、利用者の指示）

   「刃組基準値、スペーサー、フィンガーのマスタはもっと使いやすく再設計してください。」
   利用者の選択: 中身に合わせて——頭・部品は刃／ゴムリングと共通（`board-kit.js`）。
     スペーサー … 寸法の在庫表を**その場で直す1枚**（寸法の大きい順・下限を割ったら橙の札）
     フィンガー … ゴムリングと同じ2ペイン（左＝材質、右＝その材質の幅ごとの本数）

   どちらも「1本＝設備＋寸法（幅）」の在庫で、行の中身は同じ形（寸法｜保有｜下限｜状態｜候補に使う）。
   表は`stockTable()`の1本で組み、盤は列の顔ぶれと保存の口だけを渡す。前は1行ごとに窓を開いて
   直していた（本数1つを直すのに 編集→欄→保存 の3手）。いまは欄を離れるとすぐ保存（1手）。
   ============================================================ */
(function(){
 const K=()=>WL.bsKit;
 const fmt=v=>(v==null||v===''?'—':String(+(+v).toFixed(3)));
 const low=x=>x.enabled!==false&&+x.minQty>0&&(+x.qty||0)<+x.minQty;
 const total=rows=>rows.filter(x=>x.enabled!==false).reduce((s,x)=>s+(+x.qty||0),0);

 /* ---------- 在庫の表（2つの盤が共有） ----------
    `o`: {dim:'size'|'width', dimLabel, unit, extra?:{f,label,list}, newId} */
 function stockTable(rows,o){
  const ex=o.extra;
  const body=rows.map(x=>`<tr data-id="${x.id}"${x.enabled===false?' class="is-off"':''}>
   <th>${fmt(x[o.dim])}<u>mm</u></th>
   <td><input type="number" data-f="qty" min="0" step="1" value="${esc(x.qty??'')}" aria-label="${fmt(x[o.dim])}mm の保有${o.unit}数"><u>${o.unit}</u></td>
   <td><input type="number" data-f="minQty" min="0" step="1" value="${esc(x.minQty||'')}" placeholder="—" aria-label="${fmt(x[o.dim])}mm の下限${o.unit}数"><u>${o.unit}</u></td>
   ${ex?`<td><input type="text" data-f="${ex.f}" list="${o.newId}L" value="${esc(x[ex.f]||'')}" placeholder="—" aria-label="${ex.label}"></td>`:''}
   <td class="bk-st">${x.enabled===false?'<i class="bk-tag">候補から外しています</i>':low(x)?'<i class="bk-tag is-warn">下限を下回っています</i>':''}</td>
   <td><label class="bk-use" title="外すと刃組ガイダンスが候補に使いません（行は残ります）"><input type="checkbox" data-f="enabled"${x.enabled===false?'':' checked'}>候補に使う</label></td>
   <td><button type="button" class="bk-x" data-act="del" data-id="${x.id}" title="この行を消す" aria-label="${fmt(x[o.dim])}mm を消す">×</button></td></tr>`).join('');
  const n=1+2+(ex?1:0)+3;
  return `<table class="bk-table bk-stock"><thead><tr><th>${esc(o.dimLabel)}</th><th>保有</th><th>下限</th>${ex?`<th>${esc(ex.label)}</th>`:''}<th></th><th></th><th></th></tr></thead>
   <tbody>${body||`<tr><td colspan="${n}" class="bk-none">まだありません。下の行から足してください。</td></tr>`}</tbody>
   <tfoot><tr class="bk-new"><th><input type="number" id="${o.newId}D" min="0" step="any" placeholder="${esc(o.dimLabel)}" aria-label="足す${esc(o.dimLabel)}"><u>mm</u></th>
    <td><input type="number" id="${o.newId}Q" min="0" step="1" placeholder="0" aria-label="足す行の保有${o.unit}数"><u>${o.unit}</u></td>
    <td colspan="${n-2}"><button type="button" class="mm-btn-ghost sm" data-act="add">＋ ${esc(o.dimLabel)}を足す</button></td></tr>
   <tr class="bk-sum"><th>合計</th><td><b>${total(rows)}${o.unit}</b></td><td colspan="${n-2}"><small>${rows.length}種${rows.some(low)?`・<b class="bk-low">下限割れ ${rows.filter(low).length}</b>`:''}</small></td></tr></tfoot></table>
   ${ex?`<datalist id="${o.newId}L">${(ex.list||[]).map(v=>`<option value="${esc(v)}">`).join('')}</datalist>`:''}`;
 }
 /* 表の配線。保存の口（`path`）と、足す行に添える値（`extra()`）は盤が渡す。 */
 function wireStock(box,st,o){
  const rowOf=id=>o.rows().find(x=>x.id===id);
  box.querySelectorAll('tr[data-id] [data-f]').forEach(el=>{el.onchange=async()=>{
   const id=+el.closest('tr').dataset.id,f=el.dataset.f;
   const v=f==='enabled'?el.checked:(el.value===''&&f!==o.extra?.f?0:el.value);
   const ok=await K().guarded(st,async uid=>{await K().post(o.path+'/update',{id,[f]:v,user_id:uid})},'保存できませんでした');
   if(!ok)return void o.reload();
   const x=rowOf(id);if(x)x[f]=f==='enabled'?v:(f===o.extra?.f?v:+v);
   K().keepFocus(o.paint);
  }});
  const add=box.querySelector('[data-act="add"]');
  if(add)add.onclick=async()=>{
   const d=box.querySelector(`#${o.newId}D`).value,q=box.querySelector(`#${o.newId}Q`).value;
   if(String(d).trim()===''||!(+d>0))return void alertModal(`足す${o.dimLabel}（mm）を入れてください。`);
   /* 同じ寸法の2行目は作らない——在る行の本数を直す（どちらが効くか分からなくなるため）。 */
   const same=o.rows().find(x=>Math.abs(+x[o.dim]-(+d))<1e-9);
   if(same){const el=box.querySelector(`tr[data-id="${same.id}"] [data-f="qty"]`);
    await alertModal(`${fmt(d)}mm はもう在ります。その行の保有数を直してください。`);
    if(el){el.focus();el.select()}return}
   const ok=await K().guarded(st,async uid=>{
    await K().post(o.path,Object.assign({equipment:st.equipment,[o.dim]:d,qty:q===''?0:q,user_id:uid},o.addExtra?o.addExtra():{}));
   },`${o.dimLabel}を足せませんでした`);
   if(ok){await o.reload();const nd=document.querySelector(`#${o.newId}D`);if(nd)nd.focus()}
  };
  box.querySelectorAll('[data-act="del"]').forEach(b=>{b.onclick=async()=>{
   const x=rowOf(+b.dataset.id);if(!x)return;
   if(!await confirmModal({title:'この行を消す',eyebrow:o.what,
     bodyHtml:`<p class="confirm-modal-message">${esc(o.title(x))}（${x.qty||0}${o.unit}）を消します。元に戻せません。<br>しばらく使わないだけなら「候補に使う」を外してください（行は残ります）。</p>`,
     confirmLabel:'消す',cancelLabel:'やめる'}))return;
   if(await K().guarded(st,async()=>{await K().post(o.path+'/delete',{id:x.id})},'消せませんでした'))await o.reload();
  }});
 }

 /* =================== スペーサー（1枚の在庫表） =================== */
 const sp={equipment:'',rows:[],uses:[],busy:false,loaded:false};
 function spHead(){
  const n=sp.rows.filter(low).length;
  K().renderHead(sp,{id:'spEq',tone:n?'warn':'',
   state:sp.loaded?`寸法 <b>${sp.rows.length}</b>種・合計 <b>${total(sp.rows)}</b>枚${n?`・下限割れ <b>${n}</b>`:''}`:'',
   hint:'<b>軸方向の寸法を作るのはスペーサー</b>です。ここの寸法の組み合わせで刃と刃のあいだを埋めます（ゴムリングはその上に被る別の層）。保有・下限・用途は<b>欄を離れるとすぐ保存</b>されます。細かい刻み（10.025 など）を持つほど端数が小さくなります。',
   onEquipment:()=>spLoad(true)});
 }
 function spPaint(){
  spHead();
  const box=document.getElementById('masterMaintList');if(!box||!sp.loaded)return;
  box.innerHTML=`<section class="bk-card bk-stockcard">${stockTable(sp.rows,{dim:'size',dimLabel:'寸法',unit:'枚',newId:'spNew',
   extra:{f:'use',label:'用途',list:sp.uses}})}</section>`;
  wireStock(box,sp,{path:'/api/bladeset-spacer-master',dim:'size',dimLabel:'寸法',unit:'枚',newId:'spNew',what:'スペーサー',
   extra:{f:'use'},rows:()=>sp.rows,paint:spPaint,reload:()=>spLoad(true),title:x=>`寸法 ${fmt(x.size)}mm`});
 }
 async function spLoad(force){
  if(!document.getElementById('masterMaintList'))return;
  sp.loaded=false;spHead();
  if(!await K().prologue(sp,force))return;
  await K().loading(async()=>{
   const r=await api('/api/bladeset-spacer-master?equipment='+encodeURIComponent(sp.equipment));
   Object.assign(sp,{rows:(r.items||[]).filter(x=>x.equipment===sp.equipment).sort((a,b)=>b.size-a.size),
                     uses:r.spacerUses||[],loaded:true});
   spPaint();
  });
 }

 /* =================== フィンガー（2ペイン: 材質 → 幅ごとの本数） =================== */
 const fg={equipment:'',rows:[],materials:[],sel:'',busy:false,loaded:false};
 const matRows=m=>fg.rows.filter(x=>x.material===m).sort((a,b)=>b.width-a.width);
 /* 見本の色は刃組図と同じ鍵（`fingerTone()`・§9.527）——表と図で材質の色を取り違えない。 */
 const fgSw=m=>`<i class="rb-sw is-lube" style="--sw:var(--bs-fig-${esc(WL.bladeSet.fingerTone(m))})" aria-hidden="true"></i>`;
 function fgHead(){
  const n=fg.rows.filter(low).length;
  K().renderHead(fg,{id:'fgEq',tone:n?'warn':'',
   state:fg.loaded?`材質 <b>${fg.materials.filter(m=>matRows(m).length).length}</b>・幅 <b>${fg.rows.length}</b>種・合計 <b>${total(fg.rows)}</b>本${n?`・下限割れ <b>${n}</b>`:''}`:'',
   hint:'1本は<b>設備＋材質＋幅</b>。左で材質を選び、右で<b>幅ごとの本数</b>を直します（欄を離れるとすぐ保存）。フィンガーで保持するか・どの材質かは<b>「保持方式」の表</b>が決めます。',
   onEquipment:()=>fgLoad(true)});
 }
 function fgPaint(){
  fgHead();
  const box=document.getElementById('masterMaintList');if(!box||!fg.loaded)return;
  const items=fg.materials.map(m=>{const rs=matRows(m),n=rs.filter(low).length;
   return {key:m,on:m===fg.sel,mark:fgSw(m),title:m,sub:rs.length?`幅 ${rs.length}種・${total(rs)}本`:'まだありません',
    tags:n?[{text:`下限割れ ${n}`,tone:'warn'}]:[]}});
  const rs=matRows(fg.sel);
  box.innerHTML=K().pane({label:'フィンガーの材質',items,detail:`<article class="bk-card">
   <header class="bk-card-h">${fgSw(fg.sel)}<div class="bk-card-t"><h3>${esc(fg.sel)}</h3>
    <small>${fg.sel===fg.materials[0]?'既定の材質（保持方式の表で材質を決めていないときはこれ）':'保持方式の表でこの材質に決まったときに使います'}</small></div></header>
   ${stockTable(rs,{dim:'width',dimLabel:'幅',unit:'本',newId:'fgNew'})}</article>`});
  K().wirePane(box,{onPick:k=>{fg.sel=k;fgPaint()}});
  wireStock(box,fg,{path:'/api/bladeset-finger-master',dim:'width',dimLabel:'幅',unit:'本',newId:'fgNew',what:'フィンガー',
   rows:()=>matRows(fg.sel),paint:fgPaint,reload:()=>fgLoad(true),addExtra:()=>({material:fg.sel}),
   title:x=>`${x.material} 幅 ${fmt(x.width)}mm`});
 }
 async function fgLoad(force){
  if(!document.getElementById('masterMaintList'))return;
  fg.loaded=false;fgHead();
  if(!await K().prologue(fg,force))return;
  await K().loading(async()=>{
   const r=await api('/api/bladeset-finger-master?equipment='+encodeURIComponent(fg.equipment));
   const rows=(r.items||[]).filter(x=>x.equipment===fg.equipment);
   /* 材質の顔ぶれ＝サーバーの語彙＋行に在る材質（語彙から外れた古い行も見えるように）。 */
   const mats=[...new Set((r.fingerMaterials||[]).concat(rows.map(x=>x.material)).filter(Boolean))];
   Object.assign(fg,{rows,materials:mats,loaded:true});
   if(!mats.includes(fg.sel))fg.sel=mats[0]||'';
   fgPaint();
  });
 }

 WL.mm.registerSpecial('spacer-board',{load:spLoad});
 WL.mm.registerSpecial('finger-board',{load:fgLoad});
 WL.stockBoard={spacer:sp,finger:fg,spLoad,fgLoad,stockTable};
})();
