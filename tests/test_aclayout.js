/* test_aclayout.js: 測定実績の一覧——横に送っても素直に動く・切れない・入れた値が全部出る（利用者の指示・§9.631 ①②）
   ============================================================
   「横スクロールしたときに固定される部分とスクロールする部分があり気持ち悪いので、変に固定せず素直な挙動にして
    わかりやすい列表示にしてください。列も見切れが多くみられ、横スクロール操作後はさらにレイアウトが崩れてしまいます。」
   「入力してあるはずの操業データや測定データで打ち込まれたなどがほとんど表示されておらず、すべてを対象にしたいです。」
   物差し（評価関数）。利用者の PC（1728×1152）とフル HD・125%（1536×864）で、左端・中ほど・右端へ送って測る:
     - 横に送ると留まる列（position:sticky で left を持つセル）の数（0 が正）
     - 見出しの字が切れている列の数・値が切れているセルの割合
     - 送った後に、行の地と罫線が列の途中で切れている行の数（行の幅が中身より狭い。0 が正）
     - 見出しと値の列の左端のずれ（px。0 が正）
     - 記録に値がある「測定画面で入れた項目」のうち、一覧に値が出ている列の数（全部が正）
     - 作業開始・作業終了の列が出ている
   WAVELOG_SHOT=<dir> で画面を撮る。
   ============================================================ */
'use strict';
const path=require('path');
const H=require('./lib/harness.js');
const {run}=H;
const B='http://127.0.0.1:5029';
const TAG='AL'+process.pid;
const EQ='テスト設備A';
const SHOT=process.env.WAVELOG_SHOT||'';
const SIZES=[['1728',{width:1728,height:1152}],['1536',{width:1536,height:864}]];
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const localIso=(y,m,d,hh,mm)=>new Date(y,m-1,d,hh,mm,0).toISOString();

async function seed(){
 const form=await (await fetch(B+'/api/operation-form?equipment='+encodeURIComponent(EQ))).json();
 /* 操業データ項目マスタの自由項目ぜんぶに値を入れる（組み込みの欄は置き場が別なので除く）。長い字も混ぜる（切れ方を見る） */
 const names=(form.items||[]).filter(d=>d&&d.name&&!d.builtin).map(d=>String(d.name));
 for(let i=1;i<=6;i++){
  const op={};names.forEach((n,j)=>{op[n]=j%5===0?`長い値の確認用テキスト${i}-${j}`:String(i*10+j)});
  const start=localIso(2026,3,10,7+i,0),end=localIso(2026,3,10,7+i,40);
  const payload=JSON.stringify({id:`${TAG}-${i}`,status:'完了',updatedAt:end,
   basic:{lotNo:`${TAG}L${i}`,inspectionNo:`K${i}`},settings:{registeredEquipment:EQ,operator:'検査太郎',crewSize:2,opData:op},
   workTime:i===6?{}:{startAt:start,endAt:end},measurements:{}});
  const r=await post('/api/measurement/backup',{id:`${TAG}-${i}`,lotNo:`${TAG}L${i}`,inspectionNo:`K${i}`,equipment:EQ,status:'完了',codec:'json-full-v32',payload,
   user_id:'test',updated_at_iso:end});
  if(!r.ok)throw new Error('記録を置けない: '+r.status);
 }
 return names;
}

/* いまの一覧を測る（送る位置 at＝0〜1） */
function measure(page,at){
 return page.evaluate(at=>{
  const l=document.getElementById('acList');
  l.scrollLeft=Math.round((l.scrollWidth-l.clientWidth)*at);
  const head=l.querySelector('.ac-row.head'),rows=[...l.querySelectorAll('.ac-row[data-id]')];
  const lr=l.getBoundingClientRect();
  const cells=[...l.querySelectorAll('.ac-row>span')];
  const sticky=new Set(cells.filter(c=>{const s=getComputedStyle(c);return s.position==='sticky'&&s.left!=='auto'}).map(c=>c.dataset.col||c.className)).size;
  const vis=c=>{const r=c.getBoundingClientRect();return r.right>lr.left&&r.left<lr.right};
  const hs=[...head.children].filter(vis);
  const truncHead=hs.filter(h=>h.scrollWidth>h.clientWidth+1).map(h=>h.dataset.col);
  const body=rows.flatMap(r=>[...r.children]).filter(vis);
  const truncCell=body.filter(c=>c.scrollWidth>c.clientWidth+1).length;
  /* 行の地: 行の箱の右端が、行の中の最後のセルの右端より左にある＝地と罫線が途中で切れて見える */
  const broken=[head,...rows].filter(r=>{const last=r.lastElementChild;return last&&last.getBoundingClientRect().right>r.getBoundingClientRect().right+1}).length;
  /* 見出しと値の列の左端のずれ */
  let shift=0;
  if(rows[0])[...head.children].forEach((h,i)=>{const c=rows[0].children[i];if(c)shift=Math.max(shift,Math.abs(h.getBoundingClientRect().left-c.getBoundingClientRect().left))});
  return {at,sticky,truncHead,truncCell,cells:body.length,broken,shift:Math.round(shift)};
 },at);
}

run('test_aclayout: 測定実績の一覧（素直な横送り・切れない・入れた値が全部出る）',async({page,rec,idle})=>{
 const layout0=await H.snapLayout('actuals:list');
 try{
  await H.clearLayout('actuals:list');
  const names=await seed();
  rec(`操業データ項目マスタの自由項目に値を入れた記録を置いた（${names.length}項目）`,names.length>0);
  for(const [tag,vp] of SIZES){
   await page.setViewportSize(vp);
   await page.goto(B+'/',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('#openActuals',{timeout:25000});
   await page.click('#openActuals');
   await page.waitForSelector('#actualsPanel .ac-row.head',{timeout:20000});
   await page.evaluate(()=>{const e=document.getElementById('acEquipment');e.value='テスト設備A';e.dispatchEvent(new Event('change'))});
   await page.evaluate(()=>{for(const id of ['acFrom','acTo']){const e=document.getElementById(id);e.value='2026-03-10';e.dispatchEvent(new Event('change'))}});
   await page.waitForFunction(TAG=>[...document.querySelectorAll('#acList .ac-row[data-id]')].filter(r=>r.textContent.includes(TAG)).length===6,TAG,{timeout:20000})
    .catch(async e=>{console.log('一覧の状態: '+await page.evaluate(()=>((document.getElementById('acNote')||{}).textContent||'')+' / '+((document.getElementById('acList')||{}).innerText||'').slice(0,300)));throw e});
   await idle();
   await page.evaluate(()=>document.fonts.ready);
   const ms=[];
   for(const at of [0,0.5,1]){
    ms.push(await measure(page,at));
    if(process.env.WAVELOG_SHOT)await page.screenshot({path:path.join(SHOT,`ac_${tag}_${Math.round(at*100)}.png`)});
   }
   const worst=k=>Math.max(...ms.map(m=>Array.isArray(m[k])?m[k].length:m[k]));
   rec(`${tag}: 横に送ると留まる列 0（${worst('sticky')}）`,worst('sticky')===0);
   rec(`${tag}: 見出しの字が切れない（${worst('truncHead')}列）`,worst('truncHead')===0,ms.map(m=>m.truncHead.join('・')).filter(Boolean).join(' / '));
   const tc=Math.max(...ms.map(m=>m.cells?m.truncCell/m.cells:0));
   rec(`${tag}: 値が切れるセルは 5% 未満（${(tc*100).toFixed(1)}%）`,tc<0.05,ms.map(m=>`${m.truncCell}/${m.cells}`).join(' '));
   rec(`${tag}: 送った後も行の地と罫線が途切れない（${worst('broken')}行）`,worst('broken')===0);
   rec(`${tag}: 見出しと値の列がそろう（ずれ ${worst('shift')}px）`,worst('shift')<=1);
   /* 分母は置いた値（正解）。一覧自身の答えで数えると、空で返る列は分母からも消えて素通りする（§9.630 の網が通した不具合） */
   const v=await page.evaluate(names=>{
    const head=[...document.querySelectorAll('#acList .ac-row.head>span')].map(s=>s.dataset.col);
    const shown=names.filter(k=>head.includes(k)&&[...document.querySelectorAll(`#acList .ac-row[data-id]>span[data-col="${CSS.escape(k)}"]`)].some(s=>s.textContent.trim()!==''));
    return {has:names.length,shown:shown.length,missing:names.filter(k=>!shown.includes(k)).slice(0,12),se:['作業開始','作業終了'].every(k=>head.includes(k))};
   },names);
   rec(`${tag}: 記録に値を入れた操業データの項目は全部、値つきで出る（${v.shown}/${v.has}）`,v.has>0&&v.shown===v.has,v.missing.join('・'));
   rec(`${tag}: 作業開始・作業終了の列が出ている`,v.se);
   /* 列の案内（§9.631・E の手順の3回目で V11）: 区画の名前が切れない・押すとその群へ送る・範囲の帯が見えている所を指す */
   const g=await page.evaluate(()=>{
    const box=document.getElementById('acGuide');if(!box)return null;
    const segs=[...box.querySelectorAll('.ac-map-seg')];
    return {n:segs.length,cut:segs.filter(s=>{const b=s.querySelector('b');return b&&b.scrollWidth>b.clientWidth+1}).map(s=>s.textContent),
     names:segs.map(s=>s.querySelector('b').textContent)};
   });
   rec(`${tag}: 列の案内の区画の名前が切れない（${g?g.n:0}区画）`,g&&g.n>=3&&g.cut.length===0,g&&(g.cut.join('・')||g.names.join('・')));
   const seg=await page.$('#acGuide .ac-map-seg:last-child');
   const sb=await seg.boundingBox();
   await page.evaluate(()=>{document.getElementById('acList').scrollLeft=0});
   await page.mouse.click(sb.x+sb.width/2,sb.y+sb.height/2);
   /* 待つのは押した物そのもの（その区画が範囲に入った）。送り始めただけでは帯はまだ動いていない */
   await page.waitForFunction(()=>(document.querySelector('#acGuide .ac-map-seg:last-child')||{classList:{contains:()=>false}}).classList.contains('is-in'),null,{timeout:8000}).catch(()=>{});
   const hit=await page.evaluate(()=>{const l=document.getElementById('acList'),last=document.querySelector('#acGuide .ac-map-seg:last-child');
    const win=document.querySelector('#acGuide .ac-map-win').getBoundingClientRect(),r=last.getBoundingClientRect();
    return {in:last.classList.contains('is-in'),over:win.right>r.left&&win.left<r.right,sl:l.scrollLeft}});
   rec(`${tag}: 区画を押すとその群へ送り、範囲の帯がその区画に重なる`,hit.in&&hit.over,JSON.stringify(hit));
  }
 }finally{
  await H.restoreLayout('actuals:list',layout0).catch(()=>{});
 }
},{mode:'edit',viewport:{width:1728,height:1152}});
