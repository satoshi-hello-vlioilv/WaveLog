/* ============================================================
   stock-board.js: スペーサー・フィンガーの盤（§9.531、利用者の指示）

   「刃組基準値、スペーサー、フィンガーのマスタはもっと使いやすく再設計してください。」
   利用者の選択: 中身に合わせて——頭・部品は刃／ゴムリングと共通（`board-kit.js`）。
     スペーサー … 寸法の在庫表を**その場で直す1枚**（寸法の大きい順）
     フィンガー … ゴムリングと同じ2ペイン（左＝材質、右＝その材質の幅ごとの本数）

   どちらも「1本＝設備＋寸法（幅）」の在庫で、行の中身は同じ形（寸法｜保有｜状態｜候補）。
   在庫の下限は持たない（§9.539 利用者の指示「そもそも下限という管理項目が不要」で項目ごと外した）。
   表は`stockTable()`の1本で組み、盤は列の顔ぶれと保存の口だけを渡す。前は1行ごとに窓を開いて
   直していた（本数1つを直すのに 編集→欄→保存 の3手）。§9.603 で保存はほかのマスタと同じ足元の1つ
   （本数を上から順に打ち・Enter で次の行・最後に1回保存）。
   ============================================================ */
(function(){
 const K=()=>WL.bsKit;
 const fmt=v=>(v==null||v===''?'—':String(+(+v).toFixed(3)));
 const total=rows=>rows.filter(x=>x.enabled!==false).reduce((s,x)=>s+(+x.qty||0),0);

 /* 控えの鍵（行の id＋欄）。保存は行ごとにまとめて書く。 */
 const ek=(id,f)=>`row:${id}:${f}`;
 /* 控えを重ねた行（見通し・合計は打った値で数える——保存の前に効き方が分かる・§CLAUDE 15）。 */
 function withEdits(st,rows){
  const e=st.edits||{};
  return rows.map(x=>{const y=Object.assign({},x);
   ['qty','use','enabled'].forEach(f=>{const k=ek(x.id,f);if(Object.prototype.hasOwnProperty.call(e,k))y[f]=f==='enabled'?e[k]==='1':f==='qty'?(e[k]===''?0:+e[k]):e[k]});
   return y});
 }

 /* ---------- 在庫の表（2つの盤が共有） ----------
    `o`: {dim:'size'|'width', dimLabel, unit, extra?:{f,label,list}, newId, calc?:[{label,html(x)}]}
    `calc`＝保有の右に並べる計算の列（読み取り専用・§9.540 の内訳と「次に使える」）。
    欄は打っても書かない（控え・足元の保存・§9.603）。「候補」は見出しに1回（行ごとに同じ字を並べない）。 */
 function stockTable(st,rows,o){
  const ex=o.extra,calc=o.calc||[],K_=K();
  const val=(x,f,cur)=>K_.editOf(st,ek(x.id,f),cur);
  const body=rows.map(x=>{const on=val(x,'enabled',x.enabled===false?'0':'1')==='1';
   return `<tr data-id="${x.id}"${on?'':' class="is-off"'}>
   <th>${fmt(x[o.dim])}<u>mm</u></th>
   <td><input type="number" data-f="qty" data-edit="${ek(x.id,'qty')}" data-was="${esc(x.qty??'')}" class="${K_.editCls(st,ek(x.id,'qty')).trim()}" min="0" step="1" value="${esc(val(x,'qty',x.qty??''))}" aria-label="${fmt(x[o.dim])}mm の保有${o.unit}数"><u>${o.unit}</u></td>
   ${calc.map(c=>`<td class="bk-calc">${c.html(x)}</td>`).join('')}
   ${ex?`<td><input type="text" data-f="${ex.f}" data-edit="${ek(x.id,ex.f)}" data-was="${esc(x[ex.f]||'')}" class="${K_.editCls(st,ek(x.id,ex.f)).trim()}" list="${o.newId}L" value="${esc(val(x,ex.f,x[ex.f]||''))}" placeholder="—" aria-label="${ex.label}"></td>`:''}
   <td class="bk-st">${on?'':'<i class="bk-tag">候補から外しています</i>'}</td>
   <td class="bk-use"><input type="checkbox" data-f="enabled" data-edit="${ek(x.id,'enabled')}" data-was="${x.enabled===false?'0':'1'}"${on?' checked':''} aria-label="${fmt(x[o.dim])}mm を候補に使う" title="外すと刃組ガイダンスが候補に使いません（行は残ります）"></td>
   <td><button type="button" class="bk-x" data-act="del" data-id="${x.id}" title="この行を消す" aria-label="${fmt(x[o.dim])}mm を消す">×</button></td></tr>`}).join('');
  const n=1+1+calc.length+(ex?1:0)+3;
  const shownRows=withEdits(st,rows);
  return `<table class="bk-table bk-stock"><thead><tr><th>${esc(o.dimLabel)}</th><th>保有</th>${calc.map(c=>`<th>${esc(c.label)}</th>`).join('')}${ex?`<th>${esc(ex.label)}</th>`:''}<th></th><th title="外すと刃組ガイダンスが候補に使いません（行は残ります）">候補</th><th></th></tr></thead>
   <tbody>${body||`<tr><td colspan="${n}" class="bk-none">まだありません。下の行から足してください。</td></tr>`}</tbody>
   <tfoot><tr class="bk-new"><th><input type="number" id="${o.newId}D" min="0" step="any" placeholder="${esc(o.dimLabel)}" aria-label="足す${esc(o.dimLabel)}"><u>mm</u></th>
    <td><input type="number" id="${o.newId}Q" min="0" step="1" placeholder="0" aria-label="足す行の保有${o.unit}数"><u>${o.unit}</u></td>
    <td colspan="${n-2}"><button type="button" class="mm-btn-ghost sm" data-act="add">＋ ${esc(o.dimLabel)}を足す</button></td></tr>
   <tr class="bk-sum"><th>合計</th><td><b>${total(shownRows)}${o.unit}</b></td><td colspan="${n-2}"><small>${rows.length}種</small></td></tr></tfoot></table>
   ${ex?`<datalist id="${o.newId}L">${(ex.list||[]).map(v=>`<option value="${esc(v)}">`).join('')}</datalist>`:''}`;
 }
 /* 足す行へ（頭の主の操作「＋ 寸法を足す」）。表の下の欄に焦点を置き、見える所まで送る。 */
 function focusAdd(newId){
  const el=document.getElementById(newId+'D');
  if(el){el.scrollIntoView({block:'nearest'});el.focus()}
 }
 /* 表の配線。控え（打つ・欄を離れたら`o.paint`で計算の列を描き直す）、足す・消す（構造の操作＝その場で書く）。 */
 function wireStock(box,st,o){
  const rowOf=id=>o.rows().find(x=>x.id===id);
  K().bindEdits(box,st,()=>K().keepFocus(o.paint));
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
   if(ok){WL.mm.headSay(`${fmt(d)}mm を足しました`);await o.reload();focusAdd(o.newId)}
  };
  box.querySelectorAll('[data-act="del"]').forEach(b=>{b.onclick=async()=>{
   const x=rowOf(+b.dataset.id);if(!x)return;
   if(!await confirmModal({title:'この行を消す',eyebrow:o.what,
     bodyHtml:`<p class="confirm-modal-message">${esc(o.title(x))}（${x.qty||0}${o.unit}）を消します。元に戻せません。<br>しばらく使わないだけなら「候補」を外してください（行は残ります）。</p>`,
     confirmLabel:'消す',cancelLabel:'やめる'}))return;
   if(await K().guarded(st,async()=>{await K().post(o.path+'/delete',{id:x.id})},'消せませんでした')){
    Object.keys(st.edits||{}).filter(k=>k.startsWith(`row:${x.id}:`)).forEach(k=>delete st.edits[k]);
    WL.mm.headSay(`${o.title(x)} を消しました`);await o.reload();
   }
  }});
 }
 /* 足元の保存: 控えを行ごとにまとめて書く（1行＝1回・送った鍵だけ書く口）。 */
 function saveStock(st,path,reload,what){
  const byRow={};
  Object.entries(st.edits||{}).forEach(([k,v])=>{const m=/^row:(\d+):(\w+)$/.exec(k);if(!m)return;
   const f=m[2];(byRow[m[1]]=byRow[m[1]]||{})[f]=f==='enabled'?v==='1':f==='qty'?(v===''?0:v):v});
  const ids=Object.keys(byRow);if(!ids.length)return;
  return K().saveEdits(st,async uid=>{
   for(const id of ids)await K().post(path+'/update',Object.assign({id:+id,user_id:uid},byRow[id]));
  },{done:`${what}の ${ids.length}行を保存しました`,reload});
 }
 /* 変更のある行の名前（足元の「変更 N件（50mm・20mm）」）。数を2回言わない——どの行かを言う。3行を超えたら「ほか N行」。 */
 function rowsEdited(st,dim){
  const ids=[...new Set(Object.keys(st.edits||{}).map(k=>+k.split(':')[1]))];
  const names=ids.map(id=>{const x=st.rows.find(r=>r.id===id);return x?`${fmt(x[dim])}mm`:''}).filter(Boolean);
  return names.length>3?`${names.slice(0,3).join('・')}・ほか${names.length-3}行`:names.join('・');
 }

 /* =================== スペーサー（1枚の在庫表） =================== */
 /* `ctx`＝刃組ガイダンスと同じ材料（台車の記録・基準値）、`view`＝いま開いている札（§9.540）、`cell`＝選んだ端数（null＝いちばん作りにくい端数）。 */
 const sp={equipment:'',rows:[],uses:[],busy:false,loaded:false,ctx:null,view:'table',cell:null,edits:{}};
 /* 在庫の見通し。**いまの表の値（控えを重ねた値）で毎回計算する**——保有を直すとその場で札と図が変わる（§CLAUDE 15）。 */
 function spOutlook(){
  if(!sp.ctx)return null;
  try{
   const B=WL.bladeSet,M=B.normalize(Object.assign({},sp.ctx,{spacers:withEdits(sp,sp.rows).filter(x=>x.enabled!==false)}));
   return B.spacerOutlook(M,B.buildIndex(M));
  }catch(e){WL.quiet.note('在庫の見通しを計算できない（表だけ出す）',e);return null}
 }
 function spHead(){
  K().head({primary:sp.loaded?{id:'spAdd',label:'寸法を足す',title:'表の下の行に寸法と枚数を入れて足します',onClick:()=>focusAdd('spNew')}:null});
 }
 function spPaint(){
  spHead();
  if(!sp.loaded)return;
  const O=WL.spacerOutlook,o=spOutlook(),view=o?sp.view:'table';
  O.closePeek();   // 描き直すと浮いた図の中身は古くなる
  const shown=withEdits(sp,sp.rows);
  const table=()=>`<section class="bk-card bk-stockcard">${stockTable(sp,sp.rows,{dim:'size',dimLabel:'寸法',unit:'枚',newId:'spNew',
   extra:{f:'use',label:'用途',list:sp.uses},calc:o?O.tableCols(o):[]})}</section>`;
  /* 3つの札は表の右の列（表の右の空きを使う・押すと左を入れ替える）。凡例は札の下。 */
  const main=view==='table'?table():O.viewHtml(view,o,sp.cell);
  const body=K().frame(sp,{key:'spacer',label:'スペーサー',onEquipment:()=>spLoad(true),
   note:`寸法 ${sp.rows.length}種・合計 ${total(shown)}枚`,
   save:()=>saveStock(sp,'/api/bladeset-spacer-master',()=>spLoad(true),'スペーサー'),cancel:()=>{sp.edits={};spPaint()},what:()=>rowsEdited(sp,'size'),
   body:o?`<div class="bk-spgrid"><div class="bk-spmain">${main}</div><aside class="bk-spside">${O.bandHtml(o,view)}${O.legend(o,true)}</aside></div>`:table()});
  if(!body)return;
  if(o)O.wire(body,o,{onView:v=>{sp.view=v;spPaint()},onCell:u=>{sp.cell=u;spPaint()}});
  if(view==='table')wireStock(body,sp,{path:'/api/bladeset-spacer-master',dim:'size',dimLabel:'寸法',unit:'枚',newId:'spNew',what:'スペーサー',
   rows:()=>sp.rows,paint:spPaint,reload:()=>spLoad(true),title:x=>`寸法 ${fmt(x.size)}mm`});
 }
 async function spLoad(force){
  if(!document.getElementById('masterMaintList'))return;
  sp.loaded=false;spHead();
  if(!await K().prologue(sp,force))return;
  await K().loading(async()=>{
   const q=encodeURIComponent(sp.equipment);
   /* 刃組の材料（台車の記録・基準値）は見通しのためだけに読む。読めなくても表は出す（§9.540）。 */
   const [r,ctx]=await Promise.all([api('/api/bladeset-spacer-master?equipment='+q),
    api('/api/bladeset/context?equipment='+q).catch(e=>{WL.quiet.note('刃組の材料が読めない（在庫の見通しを出さない）',e);return null})]);
   Object.assign(sp,{rows:(r.items||[]).filter(x=>x.equipment===sp.equipment).sort((a,b)=>b.size-a.size),
                     uses:r.spacerUses||[],ctx,loaded:true});
   spPaint();
  });
 }

 /* =================== フィンガー（2ペイン: 材質 → 幅ごとの本数） =================== */
 const fg={equipment:'',rows:[],materials:[],sel:'',busy:false,loaded:false,edits:{}};
 const matRows=m=>fg.rows.filter(x=>x.material===m).sort((a,b)=>b.width-a.width);
 /* 見本の色は刃組図と同じ鍵（`fingerTone()`・§9.527）——表と図で材質の色を取り違えない。 */
 const fgSw=m=>`<i class="rb-sw is-lube" style="--sw:var(--bs-fig-${esc(WL.bladeSet.fingerTone(m))})" aria-hidden="true"></i>`;
 /* 在庫の帯（スペーサーの内訳の棒と同じ形・目盛りはこの材質の最大）。打った本数で描く。 */
 function fgBar(rows){
  const shown=withEdits(fg,rows),max=Math.max(1,...shown.map(x=>+x.qty||0)),by=new Map(shown.map(x=>[x.id,x]));
  return [{label:'在庫',html:x=>{const v=+(by.get(x.id)||x).qty||0;
   return `<span class="bk-split" aria-hidden="true"><i class="is-shelf" style="width:${(v/max*100).toFixed(1)}%"></i></span>`}}];
 }
 function fgHead(){
  K().head({primary:fg.loaded&&fg.sel?{id:'fgAdd',label:'幅を足す',title:`${fg.sel} の表の下の行に幅と本数を入れて足します`,onClick:()=>focusAdd('fgNew')}:null});
 }
 function fgPaint(){
  fgHead();
  if(!fg.loaded)return;
  const items=fg.materials.map(m=>{const rs=withEdits(fg,matRows(m));
   return {key:m,on:m===fg.sel,mark:fgSw(m),title:m,sub:rs.length?`幅 ${rs.length}種・${total(rs)}本`:'まだありません',tags:[]}});
  const rs=matRows(fg.sel),all=withEdits(fg,fg.rows);
  const body=K().frame(fg,{key:'finger',label:'フィンガー',onEquipment:()=>fgLoad(true),
   note:`材質 ${fg.materials.filter(m=>matRows(m).length).length}・幅 ${fg.rows.length}種・合計 ${total(all)}本`,
   save:()=>saveStock(fg,'/api/bladeset-finger-master',()=>fgLoad(true),'フィンガー'),cancel:()=>{fg.edits={};fgPaint()},what:()=>rowsEdited(fg,'width'),
   body:K().pane({label:'フィンガーの材質',items,detail:`<article class="bk-card">
   <header class="bk-card-h">${fgSw(fg.sel)}<div class="bk-card-t"><h3>${esc(fg.sel)}</h3>
    <small>${fg.sel===fg.materials[0]?'既定の材質（保持方式の表で材質を決めていないときはこれ）':'保持方式の表でこの材質に決まったときに使います'}</small></div></header>
   ${stockTable(fg,rs,{dim:'width',dimLabel:'幅',unit:'本',newId:'fgNew',calc:fgBar(rs)})}</article>`})});
  if(!body)return;
  K().wirePane(body,{onPick:k=>{fg.sel=k;fgPaint()}});
  wireStock(body,fg,{path:'/api/bladeset-finger-master',dim:'width',dimLabel:'幅',unit:'本',newId:'fgNew',what:'フィンガー',
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

 WL.mm.registerSpecial('spacer-board',{load:spLoad,dirty:()=>K().editCount(sp)>0});
 WL.mm.registerSpecial('finger-board',{load:fgLoad,dirty:()=>K().editCount(fg)>0});
 WL.stockBoard={spacer:sp,finger:fg,spLoad,fgLoad,stockTable};
})();
