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
  fields:()=>hs.fields,groups:()=>hs.groups,sourceCols:()=>hs.sourceCols,samples:()=>hs.samples,
  probe:hs.probe,onChange:()=>K().paintFoot(),
  seedNote:'空——どの作業も既定の行（ゴムリング）',
  lead:'上から順に見て、最初に当たった行の方式で板を保持します。同じ行のセルはすべて満たしたときだけ当たり、空欄のセルは「問わない」。セルに入ると書き方と値の候補が出ます。',
  answers:()=>outChoices(),answerOf:r=>`${r.hold}|${matOf(r)}`,answerLabel:outLabel,
  /* 答えの地図の色は刃組図と同じ（§9.535）: フィンガーは材質の色、ゴムリングは青、一体型は水色。 */
  answerTone:r=>isFingerHold(r.hold)?`var(--bs-fig-${WL.bladeSet.fingerTone(matOf(r))})`:r.hold===hs.methods[2]?'var(--rs-cyan)':'var(--look-blue)',
  setAnswer:(r,v)=>{const [hold,material]=v.split('|');Object.assign(r,{hold,material:material||''})},
  blankRow:()=>({hold:hs.methods[0]||'フィンガー',material:''}),
  rowOut:r=>({hold:r.hold,material:matOf(r)}),
  endpoint:'/api/bladeset/hold-pick',payload:()=>({equipment:hs.equipment}),reload:()=>load(true),
 });
 function renderHead(){K().head(hs.loaded?K().ruleActs([table]):{})}
 /* 骨組み（対象の札の行・流れの1行・表・足元）。表の描き直しは表の`render()`だけ（器は作り直さない）。 */
 function render(){
  renderHead();
  if(!hs.loaded)return;
  const body=K().frame(hs,Object.assign({key:'holdPick',label:'保持方式',onEquipment:()=>load(true),
   top:K().flowHtml([0],'<span class="bk-flow-k">ここの答え（板押さえ方式・フィンガー材質）は「刃選択」の表で条件に使えます</span>'),
   body:'<section class="rt" data-table="hold"></section>'},K().ruleFoot([table],()=>load(true))));
  if(body)table.render();
 }

 async function load(force){
  const box=document.getElementById('masterMaintList');if(!box)return;
  hs.loaded=false;renderHead();
  if(!await K().prologue(hs,force))return;
  await K().loading(async()=>{
   const [c,src]=await Promise.all([api('/api/bladeset/hold-pick?equipment='+encodeURIComponent(hs.equipment)),WL.ruleTable.loadSource()]);
   Object.assign(hs,{fields:c.fields||[],groups:c.groups||[],methods:c.methods||['フィンガー','ゴムリング'],
                     materials:c.fingerMaterials||[],sourceCols:src.columns,samples:src.samples,loaded:true});
   table.setData((c.rows||[]).map(r=>({conditions:r.conditions||[],hold:r.hold,material:r.material||'',note:r.note||''})),!!c.stored,c.cols);
   render();
  });
 }

 WL.mm.registerSpecial('hold-pick',{load,dirty:()=>table.dirty});
 WL.holdPick={state:hs,table,load};
})();
