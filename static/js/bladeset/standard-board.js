/* ============================================================
   standard-board.js: 刃組基準値の盤（§9.531 → §9.533 で2ペイン＋図、利用者の指示）

   「刃組基準値、スペーサー、フィンガーのマスタはもっと使いやすく再設計してください。」
   利用者の選択: 刃組基準値は**節ごとの設定**——既定値を薄字で見せ、欄を離れたら保存。

   前の形（汎用の表＋窓）は、登録の無い設備では**空の表だけ**が出て、いま効いている値が
   1つも見えなかった（実測 0／31）。1設備1行なので「一覧」は要らない——設備を選べば、その設備で
   **いま効いている値が全部**、節ごとに並ぶ。空欄の欄は既定値で効き（欄の中の薄字）、
   変えた欄には「変更」の札と「既定へ」の1手が付く（どれを変えたかを思い出させない）。

   欄の顔ぶれ・単位・刻み・説明は**マスタの定義（`master-defs.js`の`bladesetStandard`）の1箇所**
   から読む（盤に書き写さない）。保存は渡した鍵だけを書く口（`standard_upsert()`・§9.212 ②）。

   §9.533（「2ペインで選びながら見ながら設定…その部分が何の調整にどう影響するのか、わかった状態で触れるように」）:
   左＝節の一覧（何に効くか・変更の数）、右＝選んだ節の**図**（`standard-figs.js`・いま効いている値で描く）と欄。
   欄に入る・乗ると図の同じ部品が光り、図の部品に乗ると欄が光る。打っている途中の値で図がすぐ動く。
   本物の台車（断面図・立体図）は刃組ガイダンスが持つので、見本の作業でそこを開く1手を置く。
   ============================================================ */
(function(){
 const K=()=>WL.bsKit;
 const sb={equipment:'',row:null,defaults:{},sel:'',busy:false,loaded:false};
 const def=()=>(WL.mm.MASTER_DEFS||[]).find(d=>d.key==='bladesetStandard')||{fields:[]};
 /* 設備は頭が選ぶので欄に出さない。 */
 const fields=()=>def().fields.filter(f=>f.k!=='equipment');
 /* 保存する鍵（選択欄は呼び名の鍵`〜Text`で定義されている——値の鍵は`defaultOf`）。 */
 const keyOf=f=>f.defaultOf||f.k;
 /* 真偽の欄の字は**その欄の選択肢**（先頭＝入・2つ目＝切）。「できる／できない」を決め打ちしない（§9.532・載せる／載せない）。 */
 const flagWord=(f,v)=>(f.options||[])[v?0:1]||'';
 const fmtDef=(f,v)=>{
  if(v==null||v==='')return f.k==='centerFromDatum'?'中央':(f.k.startsWith('sideName')?f.k.slice(-2):'—');
  if(typeof v==='boolean')return flagWord(f,v);
  return String(v);
 };
 const stored=f=>{const r=sb.row;if(!r)return null;const v=r[keyOf(f)];return v==null||v===''?null:v};
 const changedCount=()=>fields().filter(f=>stored(f)!=null&&f.k!=='note').length;

 function renderHead(){
  const n=changedCount();
  K().renderHead(sb,{id:'sbEq',
   state:!sb.loaded?'':sb.row?(n?`既定と違う値 <b>${n}</b>項目（ほかは既定値）`:'登録あり・すべて既定値'):'未登録——<b>すべて既定値</b>で効いています',
   actions:sb.row?'<button type="button" class="mm-btn-ghost sm bk-danger" id="sbReset">すべて既定へ戻す</button>':'',
   hint:'刃組ガイダンスが使う<b>このラインの諸元と判定の帯</b>です（1設備に1つ）。<b>空欄の欄は既定値</b>（欄の中の薄い字）で効きます。変えたいところだけ打ち、<b>欄を離れるとすぐ保存</b>されます。',
   onEquipment:()=>load(true)});
  const rs=document.getElementById('sbReset');
  if(rs)rs.onclick=resetAll;
 }
 function ctrlHtml(f){
  const v=stored(f),d=sb.defaults[keyOf(f)];
  if(f.type==='select'){
   return `<select data-k="${esc(f.k)}" aria-label="${esc(f.label)}"><option value="">既定（${esc(fmtDef(f,d))}）</option>${
    (f.options||[]).map(o=>{const cur=typeof v==='boolean'?flagWord(f,v):v;
     return `<option${String(cur??'')===o?' selected':''}>${esc(o)}</option>`}).join('')}</select>`;
  }
  const num=f.type==='number';
  return `<input data-k="${esc(f.k)}" type="${num?'number':'text'}"${num?` step="${f.step??'any'}"${f.min!=null?` min="${f.min}"`:''}`:''}`
   +` value="${esc(v??'')}" placeholder="${esc(f.k==='note'?'—':fmtDef(f,d))}" aria-label="${esc(f.label)}"${f.size==='lg'?' class="is-lg"':''}>`;
 }
 function rowHtml(f){
  const on=stored(f)!=null&&f.k!=='note';
  const st=on?`<i class="bk-tag is-teal">変更</i><button type="button" class="bk-x sb-undo" data-undo="${esc(f.k)}" title="既定値（${esc(fmtDef(f,sb.defaults[keyOf(f)]))}）へ戻す">既定へ</button>`
   :(f.k==='note'?'':'<small class="sb-def">既定</small>');
  return `<div class="sb-row${on?' is-set':''}"><label class="sb-l" for="sb_${esc(f.k)}">${esc(f.label)}</label>`
   +`<span class="sb-c">${ctrlHtml(f).replace('<input ',`<input id="sb_${esc(f.k)}" `).replace('<select ',`<select id="sb_${esc(f.k)}" `)}${f.unit?`<u>${esc(f.unit)}</u>`:''}</span>`
   +`<span class="sb-s">${st}</span>${f.hint?`<small class="sb-h">${WL.mm.hintHtml(f.hint)}</small>`:''}</div>`;
 }
 const groupsOf=()=>{const out=[];
  fields().forEach(f=>{const g=f.fieldGroup||'';let x=out.find(y=>y.name===g);if(!x)out.push(x={name:g,list:[]});x.list.push(f)});
  return out};
 const changedIn=g=>g.list.filter(f=>stored(f)!=null&&f.k!=='note').length;
 /* 図が読む「いまの値」——打っている途中の欄 → 登録 → 既定。鍵は欄の鍵でも値の鍵でもよい。 */
 function valueOf(k){
  const f=fields().find(x=>x.k===k||keyOf(x)===k);if(!f)return sb.defaults[k];
  const el=document.querySelector(`#masterMaintList .sb-rows [data-k="${CSS.escape(f.k)}"]`);
  const typed=el&&el.value!==''?el.value:null;
  const v=typed!=null?typed:stored(f);
  if(v==null)return sb.defaults[keyOf(f)];
  if(typeof sb.defaults[keyOf(f)]==='boolean'&&typeof v==='string')return v===(f.options||[])[0];
  return v;
 }
 function render(){
  renderHead();
  const box=document.getElementById('masterMaintList');if(!box||!sb.loaded)return;
  const gs=groupsOf(),F=WL.standardFigs;
  if(!gs.some(g=>g.name===sb.sel))sb.sel=(gs[0]||{}).name||'';
  const g=gs.find(x=>x.name===sb.sel)||{list:[]};
  box.innerHTML=K().pane({label:'刃組基準値の節',items:gs.map(x=>{const n=changedIn(x);
   return {key:x.name,on:x.name===sb.sel,mark:`<i class="sb-ico" aria-hidden="true">${esc(x.name.slice(0,1))}</i>`,title:x.name,
    sub:F.sayOf(x.name)||`${x.list.length}項目`,tags:n?[{text:`変更 ${n}`,tone:'teal'}]:[]}}),
   detail:`<article class="bk-card sb-card"><header class="bk-card-h"><div class="bk-card-t"><h3>${esc(g.name)}</h3>
    <small>${esc(F.sayOf(g.name))}${F.sayOf(g.name)?'。':''}欄に入ると図の同じところが光り、打った値で図が動きます。</small></div>
    <button type="button" class="mm-btn-ghost sm" id="sbGuide" title="見本の作業（50mm×22条・元板巾1130・板厚1.2）で刃組ガイダンスを開きます">刃組ガイダンスの図で確かめる</button></header>
    <div class="sb-fig">${F.figOf(g.name,valueOf)||''}</div><div class="sb-rows">${g.list.map(rowHtml).join('')}</div></article>`});
  K().wirePane(box,{onPick:k=>{sb.sel=k;render()}});
  wireDetail(box);
 }
 /* 欄と図の部品を同じ鍵（`data-k`）で結ぶ。光らせるのは`is-on`の1つ。 */
 function light(box,k){
  box.querySelectorAll('.sb-fig [data-k].is-on,.sb-row.is-on').forEach(e=>e.classList.remove('is-on'));
  if(!k)return;
  box.querySelectorAll(`.sb-fig [data-k="${CSS.escape(k)}"]`).forEach(e=>e.classList.add('is-on'));
  const el=box.querySelector(`.sb-rows [data-k="${CSS.escape(k)}"]`);if(el)el.closest('.sb-row').classList.add('is-on');
 }
 const paintFig=box=>{const fig=box.querySelector('.sb-fig'),on=(box.querySelector('.sb-fig [data-k].is-on')||{}).dataset;
  if(fig){fig.innerHTML=WL.standardFigs.figOf(sb.sel,valueOf)||'';if(on)light(box,on.k)}};
 function wireDetail(box){
  box.querySelectorAll('.sb-rows [data-k]').forEach(el=>{
   el.onchange=()=>save(el.dataset.k,el.value);
   el.oninput=()=>paintFig(box);
   el.onfocus=()=>light(box,el.dataset.k);
   el.closest('.sb-row').onmouseenter=()=>light(box,el.dataset.k);
  });
  box.querySelector('.sb-rows').onmouseleave=()=>{const a=document.activeElement;light(box,a&&a.dataset&&box.contains(a)?a.dataset.k:'')};
  const fig=box.querySelector('.sb-fig');
  if(fig)fig.onmouseover=ev=>{const t=ev.target.closest('[data-k]');if(t)light(box,t.dataset.k)};
  box.querySelectorAll('[data-undo]').forEach(b=>{b.onclick=()=>save(b.dataset.undo,'')});
  const gd=box.querySelector('#sbGuide');
  if(gd)gd.onclick=()=>WL.bladeGuide.open({equipment:sb.equipment,seed:{thickness:1.2,originalWidth:1130,
   lots:[{name:'見本',w:50,n:22,parent:'見本'}],headLot:''}});
 }
 /* 描き直しても焦点は同じ欄へ（Tabで次の欄へ移った人の手を止めない）。 */
 function paintKeep(){
  const a=document.activeElement,k=a&&a.dataset&&a.dataset.k;
  render();
  const el=k&&document.querySelector(`#masterMaintList .sb-rows [data-k="${CSS.escape(k)}"]`);
  if(el){el.focus();try{el.select&&el.select()}catch(_e){WL.quiet.note('選べない欄は焦点だけ戻す',_e)}}
 }
 async function save(k,value){
  const f=fields().find(x=>x.k===k);if(!f)return;
  const key=keyOf(f);
  const ok=await K().guarded(sb,async uid=>{
   const r=await K().post('/api/bladeset-standard-master',Object.assign(
    {equipment:sb.equipment,user_id:uid,[key]:value},sb.row?{id:sb.row.id}:{}));
   if(!sb.row)sb.row={id:r.id};
  },'保存できませんでした');
  if(!ok)return void load(true);
  /* 控えを直して塗り直す（読み直さない＝打っている途中の欄を奪わない）。選択欄の呼び名は真偽へ。 */
  sb.row[key]=value===''?null:(f.type==='number'?+value:(typeof sb.defaults[key]==='boolean'?value===(f.options||[])[0]:value));
  paintKeep();
 }
 async function resetAll(){
  if(!sb.row)return;
  if(!await confirmModal({title:'すべて既定へ戻す',eyebrow:'刃組基準値',
    bodyHtml:`<p class="confirm-modal-message">${esc(sb.equipment)} の登録（変更 ${changedCount()}項目）を消し、すべて既定値に戻します。元に戻せません。</p>`,
    confirmLabel:'既定へ戻す',cancelLabel:'やめる'}))return;
  if(await K().guarded(sb,async()=>{await K().post('/api/bladeset-standard-master/delete',{id:sb.row.id})},'戻せませんでした'))await load(true);
 }
 async function load(force){
  if(!document.getElementById('masterMaintList'))return;
  sb.loaded=false;renderHead();
  if(!await K().prologue(sb,force))return;
  await K().loading(async()=>{
   const r=await api('/api/bladeset-standard-master?equipment='+encodeURIComponent(sb.equipment));
   Object.assign(sb,{row:(r.items||[]).find(x=>x.equipment===sb.equipment)||null,defaults:r.standardDefaults||{},loaded:true});
   render();
  });
 }
 WL.mm.registerSpecial('standard-board',{load});
 WL.standardBoard={state:sb,load};
})();
