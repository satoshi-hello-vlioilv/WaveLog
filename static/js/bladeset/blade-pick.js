/* ============================================================
   blade-pick.js: 刃選択マスタの盤（§9.380 → §9.529 で2つの判定表へ）

   利用者の指示（§9.529）:「専用刃を使う条件だけになっていますが、刃厚を選ぶテーブルと通常刃か
   専用刃を選ぶテーブルの2つを準備し、5㎜刃か10㎜刃かなど、登録している刃厚を選択対象にできるように
   してください。条件テーブルは『保持方式』の選択マスタみたいな条件テーブルの作りが好ましいです。
   自由に条件設定ができ、他マスタで設定した項目(例えば板押さえ)も条件に加えられるようにしたいです。
   条件式の書き方はわかりやすく、サジェスト機能もつけて使いやすく再設計してください。」
   利用者の選択: 専用刃は**答えでセットも選べる**（専用刃（B）など）。

   決める順は **① 保持方式（別のタブ）→ ② 刃のカテゴリ → ③ 刃厚**。後ろの表は前の表の答えを
   列に使える（②は板押さえ方式・フィンガー材質、③はさらに刃のカテゴリ）。表の作りは保持方式と
   同じ部品（`rule-table.js`）で、「試す」の値は2つの表で共有する——上の帯が「この作業なら
   → カテゴリ → 刃厚」を1行で言う。判定は`blade-core.js`の`firstRule()`（ガイダンスと同じ1本）。
   ============================================================ */
(function(){
 const K=()=>WL.bsKit;
 const ps={equipment:'',defs:[],groups:[],sets:[],thicknesses:[],categories:[],sourceCols:[],samples:{},probe:{},loaded:false};
 const defOf=k=>ps.defs.find(d=>d.key===k)||{fields:[]};
 const normal=()=>ps.categories[0]||'通常刃',special=()=>ps.categories[1]||'専用刃';

 /* ---------- 答えの列 ---------- */
 /* 刃のカテゴリ: 通常刃／専用刃（使えるどのセットでも）／専用刃（セット B）…（値は「カテゴリ|セット」）。 */
 const catChoices=r=>{
  const out=[{v:`${normal()}|`,label:normal()},{v:`${special()}|`,label:`${special()}（使えるセットのどれでも）`}];
  ps.sets.forEach(x=>out.push({v:`${special()}|${x.group}`,label:`${special()}（セット ${x.group}）${x.category===special()?'':'※カテゴリが通常刃'}`}));
  if(r&&r.group&&!ps.sets.some(x=>x.group===r.group))out.push({v:`${special()}|${r.group}`,label:`${special()}（セット ${r.group}・未登録）`});
  return out;
 };
 const catLabel=r=>(r.answer===special()?`${special()}${r.group?`（セット ${r.group}）`:''}`:normal());
 /* 刃厚: 登録している刃厚（厚い順）＋「いちばん厚い刃」（空＝今までの選び方）。 */
 const thChoices=r=>{
  const out=[{v:'',label:'いちばん厚い刃'}].concat(ps.thicknesses.map(t=>({v:String(t),label:`${t}mm`})));
  if(r&&r.answer&&!out.some(x=>x.v===String(r.answer)))out.push({v:String(r.answer),label:`${r.answer}mm（未登録の刃厚）`});
  return out;
 };
 const thLabel=r=>(r.answer?`${r.answer}mm`:'いちばん厚い刃');

 function makeTable(key,o){
  return WL.ruleTable.create(Object.assign({
   key,host:()=>document.querySelector(`#masterMaintList [data-table="${key}"]`),
   fields:()=>defOf(key).fields,groups:()=>ps.groups,sourceCols:()=>ps.sourceCols,valuesOf:f=>valuesOf(f),
   probe:ps.probe,onProbe:()=>render(),onChange:quiet=>{if(!quiet)paintTry()},
   blankRow:()=>({answer:'',group:''}),rowOut:r=>({answer:r.answer||'',group:r.group||''}),
   save:async rows=>{
    const uid=WL.mm.requireMaintUser();if(uid===null)throw new Error('更新者IDが決まっていません');
    const r=await K().post('/api/bladeset/blade-pick',{equipment:ps.equipment,table:key,rows,user_id:uid});
    await load(true);
    showToast&&showToast(r.message||'保存しました',ps.equipment,2600);
   },
   reset:async()=>{
    const uid=WL.mm.requireMaintUser();if(uid===null)return;
    await K().post('/api/bladeset/blade-pick',{equipment:ps.equipment,table:key,reset:true,user_id:uid});
    await load(true);
   },
  },o));
 }
 const T={
  category:makeTable('category',{label:'刃のカテゴリ',step:'2',answerHead:'刃のカテゴリ',defaultCols:['hold','thickness'],
   seedNote:'すべて通常刃（今までの選び方）',
   lead:'通常刃か専用刃かを決めます。専用刃は<b>セットまで選べます</b>（「どれでも」なら使用中の専用刃のセットを A から順に）。研磨中のセットは選ばれません（「刃」で切り替え）。',
   answers:catChoices,answerOf:r=>`${r.answer||normal()}|${r.group||''}`,answerLabel:catLabel,
   setAnswer:(r,v)=>{const [a,g]=v.split('|');Object.assign(r,{answer:a,group:a===special()?(g||''):''})},
   blankRow:()=>({answer:special(),group:''})}),
  thickness:makeTable('thickness',{label:'刃厚',step:'3',answerHead:'刃厚',defaultCols:['category','thickness'],
   seedNote:'いちばん厚い刃（今までの選び方）',
   lead:'②で決まったカテゴリのセットから、<b>どの刃厚の刃を使うか</b>を決めます。答えは「刃」に登録している刃厚です。',
   answers:thChoices,answerOf:r=>String(r.answer||''),answerLabel:thLabel,
   setAnswer:(r,v)=>{r.answer=v},
   blankRow:()=>({answer:String(ps.thicknesses[0]||''),group:''})}),
 };
 function valuesOf(f){
  if(String(f).startsWith('source.'))return ps.samples[f.slice(7)]||[];
  const fd=(defOf('thickness').fields||[]).find(x=>x.field===f);
  if(!fd||fd.group!=='material')return [];
  return Object.entries(ps.samples).filter(([n])=>n.includes(fd.label)).flatMap(([,v])=>v);
 }

 /* ---------- 頭と「試す」の帯 ---------- */
 const dirty=()=>T.category.dirty||T.thickness.dirty;
 function renderHead(){
  K().renderHead(ps,{id:'bpEq',
   hint:'刃組ガイダンスは <b>① 保持方式 → ② 刃のカテゴリ → ③ 刃厚</b> の順に表を見て刃を選びます。どの表も<b>上から見て最初に当たった行</b>の答え（最後の行は既定）。後ろの表は前の表の答えを列に使えます。',
   leaveOk:()=>K().leave(dirty(),'刃選択'),onEquipment:()=>load(true)});
 }
 /* 「この作業なら」を1行で（2つの表の当たりを順に）。字は`ruleTable.sentence()`と同じ読み方。 */
 function tryHtml(){
  const c=T.category.probeHit(),t=T.thickness.probeHit();
  if(!c&&!t)return '<span class="is-idle">表の「試す」行に値を入れると、この作業でどの刃になるかがここに出ます（値は2つの表で共通）</span>';
  const one=(tb,h,lab)=>h?`<b>${esc(lab(h.row))}</b><small>（${esc(tb.label)}・${tb.isDefault(h.row)?'既定の行':`${h.index+1}行目`}）</small>`
   :`<span class="is-idle">${esc(tb.label)}: 当たる行なし</span>`;
  return `この作業なら → ${one(T.category,c,catLabel)} → ${one(T.thickness,t,thLabel)}`
   +`<button type="button" class="mm-btn-ghost sm" id="bpClear">試す値を空にする</button>`;
 }
 function paintTry(){
  const el=document.querySelector('#masterMaintList .bp-try');if(!el)return;
  el.innerHTML=tryHtml();
  const clr=el.querySelector('#bpClear');
  if(clr)clr.onclick=()=>{Object.keys(ps.probe).forEach(k=>delete ps.probe[k]);render()};
 }
 function render(){
  renderHead();
  const box=document.getElementById('masterMaintList');if(!box||!ps.loaded)return;
  /* 試す欄の焦点は表の`render()`が戻すので、器は作り直さず中身だけ描き直す。 */
  if(!box.querySelector('.bp-try')){
   box.innerHTML='<div class="bp-try" aria-live="polite"></div><section class="rt" data-table="category"></section><section class="rt" data-table="thickness"></section>';
  }
  T.category.render();T.thickness.render();paintTry();
 }

 async function load(force){
  const box=document.getElementById('masterMaintList');if(!box)return;
  ps.loaded=false;renderHead();
  if(!await K().prologue(ps,force))return;
  await K().loading(async()=>{
   const q=encodeURIComponent(ps.equipment);
   const [c,sets,src]=await Promise.all([api('/api/bladeset/blade-pick?equipment='+q),api('/api/bladeset/blade-sets?equipment='+q),
                                       WL.holdPick.loadSource()]);
   const tk=[...new Set((sets.items||[]).flatMap(x=>x.thicknesses||[]))].sort((a,b)=>b-a);
   Object.assign(ps,{defs:c.defs||[],groups:c.groups||[],sets:(sets.items||[]).filter(x=>x.group),thicknesses:tk,
                     categories:sets.categories||['通常刃','専用刃'],sourceCols:src.columns,samples:src.samples,loaded:true});
   const tb=c.tables||{};
   T.category.setData((tb.category||{}).rows,(tb.category||{}).stored);
   T.thickness.setData((tb.thickness||{}).rows,(tb.thickness||{}).stored);
   box.innerHTML='';
   render();
  });
 }

 WL.mm.registerSpecial('blade-pick',{load});
 WL.bladePick={state:ps,tables:T,load};
})();
