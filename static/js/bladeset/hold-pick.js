/* ============================================================
   hold-pick.js: 保持方式マスタの盤（§9.524 → §9.529 で判定表の部品へ）

   「フィンガーとゴムリングを選ぶ条件を今は板厚だけで…条件が複雑になるので、
     取得済みデータを列に持つ条件テーブルを組めるようにマスタを追加してください。」
   利用者の選択: 列＝計算値＋仕掛の列／表の形＝列がデータの判定表／
   当たらないときは表の最後の既定行で決める。

   表そのもの（セルの書き方・候補・試す・読み上げ・並べ替え・保存の段取り）は
   `rule-table.js`（刃選択の2つの表と同じ部品）。ここが持つのは**答えの列**だけ——
   保持方式×フィンガー材質の1つの選択（§9.527「答えの列を2つに割らない」）。
   決める順の**1番目**なので、ほかの表の答えは条件に使えない（材料だけ）。
   ============================================================ */
(function(){
 const K=()=>WL.bsKit;
 const hs={equipment:'',fields:[],groups:[],methods:[],materials:[],sourceCols:[],samples:{},probe:{},loaded:false};
 const isFingerHold=m=>m===(hs.methods[0]||'フィンガー');
 const matOf=r=>(isFingerHold(r.hold)?(r.material||hs.materials[0]||''):'');
 /* 答えの列の選択肢＝保持方式×フィンガー材質（§9.527）。値は「方式|材質」。 */
 /* スペーサー一体型（§9.531）はゴムリングの1種類なので「ゴムリング（スペーサー一体型）」と読ませる。 */
 const methodWord=m=>(m===(hs.methods[2]||'スペーサー一体型')?`${hs.methods[1]||'ゴムリング'}（${m}）`:m);
 const outChoices=()=>hs.methods.flatMap(m=>isFingerHold(m)&&hs.materials.length
  ?hs.materials.map(x=>({v:`${m}|${x}`,label:`${m}（${x}）`})):[{v:`${m}|`,label:methodWord(m)}]);
 const outLabel=r=>(matOf(r)?`${r.hold}（${matOf(r)}）`:methodWord(r.hold));

 const table=WL.ruleTable.create({
  key:'hold',label:'保持方式',answerHead:'保持方式',
  host:()=>document.querySelector('#masterMaintList [data-table="hold"]'),
  fields:()=>hs.fields,groups:()=>hs.groups,sourceCols:()=>hs.sourceCols,valuesOf:f=>valuesOf(f),
  probe:hs.probe,defaultCols:['thickness'],
  seedNote:'刃組基準値のフィンガー切替板厚から作った表',
  lead:'板を保持する方式を決める<b>最初の表</b>です。ここの答え（板押さえ方式・フィンガー材質）は「刃選択」の表で条件に使えます。',
  answers:()=>outChoices(),answerOf:r=>`${r.hold}|${matOf(r)}`,answerLabel:outLabel,
  setAnswer:(r,v)=>{const [hold,material]=v.split('|');Object.assign(r,{hold,material:material||''})},
  blankRow:()=>({hold:hs.methods[0]||'フィンガー',material:''}),
  rowOut:r=>({hold:r.hold,material:matOf(r)}),
  save:async(rows,cols)=>{
   const uid=WL.mm.requireMaintUser();if(uid===null)throw new Error('更新者IDが決まっていません');
   await K().post('/api/bladeset/hold-pick',{equipment:hs.equipment,rows,cols,user_id:uid});
   await load(true);
   showToast&&showToast('保持方式の表を保存しました',`${hs.equipment}・${rows.length}行`,2600);
  },
  reset:async()=>{
   const uid=WL.mm.requireMaintUser();if(uid===null)return;
   await K().post('/api/bladeset/hold-pick',{equipment:hs.equipment,reset:true,user_id:uid});
   await load(true);
  },
 });
 /* 列の値の候補: 仕掛の列は実データの見本（20行から3つまで）。材質・調質は名前に字を含む列の見本。 */
 function valuesOf(f){
  if(String(f).startsWith('source.'))return hs.samples[f.slice(7)]||[];
  const fd=hs.fields.find(x=>x.field===f);
  if(!fd||fd.group!=='material')return [];
  return Object.entries(hs.samples).filter(([n])=>n.includes(fd.label)).flatMap(([,v])=>v);
 }

 function renderHead(){
  K().renderHead(hs,{id:'hpEq',
   hint:'<b>上から順に見て、最初に当たった行</b>の方式で板を保持します。同じ行のセルはすべて満たしたときだけ当たり、<b>空欄のセルは「問わない」</b>。セルに入ると書き方と値の候補が出ます。',
   leaveOk:()=>K().leave(table.dirty,'保持方式'),
   onEquipment:()=>load(true)});
 }
 function render(){
  renderHead();
  const box=document.getElementById('masterMaintList');if(!box||!hs.loaded)return;
  box.innerHTML='<section class="rt" data-table="hold"></section>';
  table.render();
 }

 /* 仕掛の列名と見本（条件の列の候補）。**読めなければ空**——計算値の列だけで組める。 */
 async function loadSource(){
  const db=WL.dataSource&&WL.dataSource.workKey&&WL.dataSource.workKey();
  if(!db)return {columns:[],samples:{}};
  try{const r=await api('/api/table-columns?samples=1&db='+encodeURIComponent(db),{quiet:true});
   return {columns:Array.isArray(r.columns)?r.columns:[],samples:r.samples||{}}}
  catch(e){WL.quiet.note('仕掛の列名を取れない（計算値の列だけで組める）',e);return {columns:[],samples:{}}}
 }
 async function load(force){
  const box=document.getElementById('masterMaintList');if(!box)return;
  hs.loaded=false;renderHead();
  if(!await K().prologue(hs,force))return;
  await K().loading(async()=>{
   const [c,src]=await Promise.all([api('/api/bladeset/hold-pick?equipment='+encodeURIComponent(hs.equipment)),loadSource()]);
   Object.assign(hs,{fields:c.fields||[],groups:c.groups||[],methods:c.methods||['フィンガー','ゴムリング'],
                     materials:c.fingerMaterials||[],sourceCols:src.columns,samples:src.samples,loaded:true});
   table.setData((c.rows||[]).map(r=>({conditions:r.conditions||[],hold:r.hold,material:r.material||'',note:r.note||''})),!!c.stored,c.cols);
   render();
  });
 }

 WL.mm.registerSpecial('hold-pick',{load});
 WL.holdPick={state:hs,table,load,loadSource};
})();
