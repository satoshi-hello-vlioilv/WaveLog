/* test_acinput.js: 測定実績の列——入力した項目を左に既定で出し、作業開始で並べる（利用者の指示・§9.630 ①）
   ============================================================
   「測定実績のリストに、測定項目から入れたデータもリスト上に表示し、特にその作業開始終了をアプリ上で入力した開始＆終了時刻を
    表示しソートしてリストにするようにしてください。列は入力項目すべてです。アプリ側で使用し入力したデータを優先的に表示し、
    列へ結合して追加しただけで直接的に使用されていないデータは列右側へお願いします。」
   物差し（評価関数）:
     - 既定で出ている「入力した項目」（準備・操業データ・作業時間の群）の列の数／候補にある数
     - 結合で写しただけの列が、入力した項目の列より左にある数（0 が正）
     - 同じ値を出す列が2つ並ぶ数（作業開始と作業開始時刻など。0 が正）
     - 作業開始の順に並んでいるか・見出しで逆にできるか
   ============================================================ */
'use strict';
const H=require('./lib/harness.js');
const {run}=H;
const B='http://127.0.0.1:5029';
const TAG='AI'+process.pid;
const EQ='テスト設備A';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const localIso=(y,m,d,hh,mm)=>new Date(y,m-1,d,hh,mm,0).toISOString();
async function mk(o){
 const payload=JSON.stringify({id:o.id,status:'完了',updatedAt:localIso(2026,3,10,o.hh,0),
  basic:{lotNo:o.lotNo},settings:{registeredEquipment:EQ,operator:'検査太郎',opData:{[TAG+'項目']:o.v}},
  workTime:{startAt:localIso(2026,3,10,o.hh,0),endAt:localIso(2026,3,10,o.hh,30)},measurements:{}});
 await post('/api/measurement/backup',{id:o.id,lotNo:o.lotNo,inspectionNo:'',equipment:EQ,status:'完了',codec:'json-full-v32',payload,
   user_id:'test',updated_at_iso:localIso(2026,3,10,o.hh,0)});
}

run('test_acinput: 測定実績の列（入力した項目を左・作業開始で並べる）',async({page,rec,idle})=>{
 const layout0=await H.snapLayout('actuals:list');
 try{
  await H.clearLayout('actuals:list');
  /* 作業開始が 14時 → 9時 → 11時 の順に入れる（入れた順と作業開始の順を違える） */
  for(const [i,hh] of [[1,14],[2,9],[3,11]])await mk({id:`${TAG}-${i}`,lotNo:`${TAG}L${i}`,hh,v:String(i)});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openActuals',{timeout:25000});
  await page.click('#openActuals');
  await page.waitForSelector('#actualsPanel .ac-row.head',{timeout:20000});
  await page.evaluate(()=>{for(const id of ['acFrom','acTo']){const e=document.getElementById(id);e.value='2026-03-10';e.dispatchEvent(new Event('change'))}});
  await page.waitForFunction(TAG=>[...document.querySelectorAll('#acList .ac-row:not(.head)')].filter(r=>r.textContent.includes(TAG)).length===3,TAG,{timeout:20000});
  await idle();
  const m=await page.evaluate(()=>{
   /* 群の使い方は群の名前で数える（物差しは製品の答えに頼らない: 前のコードでも同じに測れる） */
   const kind=c=>/^(準備で決めた値|操業データ|作業時間)/.test(c.group||'')?'input':/^計算した値/.test(c.group||'')?'calc':c.path?'joined':'app';
   const cols=WL.actuals.columns(),use=new Map(cols.map(c=>[c.k,kind(c)]));
   const head=[...document.querySelectorAll('#acList .ac-row.head>span')].map(s=>s.dataset.col),shown=head;
   const inputs=cols.filter(c=>kind(c)==='input').map(c=>c.k);
   const lastInput=Math.max(-1,...head.map((k,i)=>use.get(k)==='input'||use.get(k)==='app'?i:-1));
   const joinedLeft=head.filter((k,i)=>use.get(k)==='joined'&&i<lastInput).length;
   const dup=['作業開始時刻','作業終了時刻','実働時間'].filter(k=>head.includes(k)).length;
   return {inputs:inputs.length,shownInputs:inputs.filter(k=>shown.includes(k)).length,joinedLeft,dup,head:head.slice(0,24),
     hasOp:head.some(k=>/項目$/.test(k))};
  });
  rec(`入力した項目は既定で全部出る（${m.shownInputs}/${m.inputs}）`,m.inputs>0&&m.shownInputs===m.inputs,m.head.join(' '));
  rec('現場で足した操業データの項目も列に出る',m.hasOp,m.head.join(' '));
  rec(`結合で写しただけの列は入力した項目より右（左にある数 ${m.joinedLeft}）`,m.joinedLeft===0);
  rec(`同じ値の列を2つ並べない（${m.dup}）`,m.dup===0);
  const order=()=>page.evaluate(TAG=>[...document.querySelectorAll('#acList .ac-row:not(.head)')].map(r=>r.textContent).filter(t=>t.includes(TAG))
    .map(t=>(t.match(new RegExp(TAG+'L(\\d)'))||[])[1]).join(''),TAG);
  rec('既定は作業開始の古い順（9時→11時→14時）',await order()==='231',await order());
  rec('並べている列の見出しに ▲',await page.evaluate(()=>{const h=document.querySelector('#acList .ac-row.head>span[data-col="作業開始"]');return !!h&&h.classList.contains('is-sorted')&&/▲/.test(h.textContent)}));
  await page.click('#acList .ac-row.head>span[data-col="作業開始"]');
  await page.waitForFunction(()=>/▼/.test((document.querySelector('#acList .ac-row.head>span[data-col="作業開始"]')||{}).textContent||''),null,{timeout:8000});
  rec('見出しを押すと新しい順（14時→11時→9時）',await order()==='132',await order());
  await page.click('#acList .ac-row.head>span[data-col="ロット番号"]');
  await page.waitForFunction(()=>/▲/.test((document.querySelector('#acList .ac-row.head>span[data-col="ロット番号"]')||{}).textContent||''),null,{timeout:8000});
  rec('ほかの列でも並べ替えられる（ロット番号の順）',await order()==='123',await order());
 }finally{
  await H.restoreLayout('actuals:list',layout0).catch(()=>{});
 }
},{mode:'edit',viewport:{width:1728,height:1152}});
