/* test_stoppos.js: 設備停止は「選んだ位置」＝「帯の字が言う位置」へ入る（§9.517）
   ------------------------------------------------------------
   利用者から届いた不具合報告:
     「作業スケジュール一覧で、停止項目を選択して追加すると選択した位置に入らず
      ページの先頭位置に項目が入ります」

   原因は**入る位置の答えが3つあった**こと——帯の追加ボタンの字は
   `scState.insertBefore`、入れる位置と入る時刻の見積は手順の控え`stopPick.before`。
   控えは窓を閉じても捨てず、選び直しでも奪わないので、**最初に入れた位置が以後ずっと
   使い回された**（字は「L0030 の前へ追加」なのに、前に入れた L0005 の前へ入る）。
   直す前 3/7 → 直したあと 7/7。

   道ごとに ①選んだ位置 ②追加ボタンの字 ③サーバーに入った位置 の3つがそろうことを見る:
    ① 位置を決めずにボタンで開く           → いちばん後ろ
    ② 行間（L0005 の前）を押す              → L0005 の前
    ③ 同じ窓で続けてもう1件                 → L0005 の前（固定している間は同じ位置）
    ④ スクロールして行間（L0030 の前）       → L0030 の前（前の位置を引きずらない）
    ⑤ もう一度ボタンで開く                  → いちばん後ろ
    ⑥ 停止ボタンを表の L0020 の前へ落とす    → L0020 の前
    ⑦ 落としたあと続けてもう1件             → いちばん後ろ（落とした位置は1回きり） */
'use strict';
const H=require('./lib/harness.js');
const W=require('./lib/wait.js');
const B=H.B, EQ='テスト設備A';
const TAG='SPOS'+Date.now().toString().slice(-6);
const NAME=TAG+'点検';
const SNAP=['設備停止マスタ','設備停止サブカテゴリマスタ'];
const plan=()=>fetch(B+'/api/schedule/plan?equipment='+encodeURIComponent(EQ)).then(r=>r.json()).then(j=>j.entries||[]);
H.run('test_stoppos: 設備停止は選んだ位置へ入る（§9.517）',async({page,rec,setMode})=>{
 const snap=await H.masterSnapshot(SNAP);
 try{
  const stop=await (await fetch(B+'/api/schedule/stop-reason-master',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({user_id:'test-stoppos',equipment:EQ,name:NAME,category:'保全',standardMinutes:15})})).json();
  rec('材料の停止内容を作れた',!!stop.id,JSON.stringify(stop).slice(0,80));
  const BTN=`.sc-stop-button[data-id="${stop.id}"]`;
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});await W.booted(page);
  /* 行間の線は「スケジュールだけ」の見え方で出る（§9.179）。 */
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
   localStorage.setItem('scLayoutPrefsV1',JSON.stringify({swap:false,open:'schedule',insert:'tip'}));
   localStorage.removeItem('scSplitListCollapsedV1')},EQ);
  await page.reload({waitUntil:'domcontentloaded'});await W.booted(page);
  await W.openSchedule(page,EQ);
  const idOf=async lot=>((await plan()).find(e=>e.lotNo===lot)||{}).id;
  const rowAt=id=>page.evaluate(id=>{const r=[...document.querySelectorAll('.sc-row-line')].find(x=>String(x.dataset.id)===String(id));
    if(!r)return null;r.scrollIntoView({block:'center'});const b=r.getBoundingClientRect();return {x:b.x+b.width*0.4,y:b.top}},id);
  const winOpen=()=>page.evaluate(()=>document.querySelector('#scStopModal')?.hidden===false);
  const openWin=async()=>{if(await winOpen())return;await page.click('#scStopModalBtn');
    await W.until(page,()=>document.querySelector('#scStopModal')?.hidden===false,null,{ms:8000,what:'停止の窓'})};
  const closeWin=async()=>{await page.evaluate(()=>document.querySelector('#scStopModalClose')?.click());
    await W.until(page,()=>document.querySelector('#scStopModal')?.hidden!==false,null,{ms:5000,what:'窓を閉じる'})};
  const gap=async lot=>{
   const id=await idOf(lot);await rowAt(id);await W.settle(page);
   const b=await rowAt(id);
   await page.mouse.move(b.x,b.y+20);await W.paint(page);
   await page.mouse.move(b.x,b.y);await W.paint(page);
   await W.until(page,id=>(document.querySelector('#scInsertGhost')||{dataset:{}}).dataset.beforeId===String(id),id,
     {ms:5000,what:'行間の線が出る'});
   await page.click('#scInsertGhost .sc-insert-line');
   await W.until(page,()=>document.querySelector('#scStopModal')?.hidden===false,null,{ms:8000,what:'停止の窓'});
  };
  /* 追加を押して入った位置を読む。want＝すぐ後ろに来るべきロット（''＝いちばん後ろ）。 */
  const commit=async(label,want)=>{
   const base=await plan();
   await page.waitForSelector(BTN,{state:'visible',timeout:10000});
   await page.click(BTN);
   await W.until(page,()=>{const g=document.getElementById('scSpGo');return !!g&&!g.disabled},null,{ms:8000,what:'追加が押せる'});
   const goTxt=await page.evaluate(()=>document.getElementById('scSpGo').textContent.trim());
   await page.click('#scSpGo');
   const es=await W.poll(()=>plan(),x=>x.length>base.length,15000);
   const ids=new Set(base.map(e=>String(e.id)));
   const i=es.findIndex(e=>!ids.has(String(e.id)));
   let j=i+1;while(es[j]&&es[j].kind!=='作業')j++;   // 同じ位置へ続けて入れた停止は飛ばす
   const got=i<0?'?':(es[j]?es[j].lotNo:'');
   const said=(goTxt.match(/(L\d+) の前/)||[])[1]||(/いちばん後ろ/.test(goTxt)?'':'?');
   rec(`${label}: 選んだ=${want||'後ろ'}・字=${said||'後ろ'}・入った=${got||'後ろ'}`,got===want&&said===want,goTxt);
  };
  await openWin();await commit('① ボタンで開く','');await closeWin();
  await gap('L0005');await commit('② 行間 L0005 の前','L0005');
  await commit('③ 同じ窓で続けてもう1件','L0005');await closeWin();
  await gap('L0030');await commit('④ スクロールして行間 L0030 の前','L0030');await closeWin();
  await openWin();await commit('⑤ もう一度ボタンで開く','');await closeWin();
  await openWin();
  const to=await idOf('L0020');await rowAt(to);await W.settle(page);
  await page.dragAndDrop(BTN,`.sc-row-line[data-id="${to}"]`,{targetPosition:{x:200,y:3}});
  await W.until(page,()=>/L0020 の前/.test((document.getElementById('scSpGo')||{}).textContent||''),null,
    {ms:5000,what:'落とした位置が帯の字に出る'});
  await commit('⑥ ボタンを L0020 の前へ落とす','L0020');
  await commit('⑦ 落としたあと続けてもう1件（落とした位置は1回きり）','');await closeWin();
 }finally{
  for(const e of (await plan()).filter(x=>x.kind==='設備停止'&&x.title===NAME))
   await fetch(B+'/api/schedule/plan/delete',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:e.id,equipment:EQ,user_id:'test-stoppos'})}).catch(()=>{});
  /* マスタを消すのは編集モードで（scheduleのままだと403で黙って弾かれる・§9.389）。 */
  await setMode('edit');
  await H.dropNewMasterRows(snap);
 }
 const left=(await plan()).filter(e=>e.title===NAME).length;
 let rest=0;
 for(const [t,ids] of await H.masterSnapshot(SNAP))rest+=[...ids].filter(i=>!snap.get(t).has(i)).length;
 rec('後片付け: 置いた予定と増やしたマスタの行が残っていない',left===0&&rest===0,`予定${left}件・マスタ${rest}行`);
},{mode:'schedule',viewport:{width:1728,height:1050}});
