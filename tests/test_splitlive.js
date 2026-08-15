/* 条割のリアルタイム反映（§9.149）
   ============================================================
   「条割を実行」ボタンは廃止した。**触ったその場で測定表へ効く**ことと、
   **当てられないときは理由を文字で出す**ことを固定する。

   ここで見るのは3つ。
   - 開いた直後: 材料がそろった時点で当たっている（表の条数・ロット列が図と一致）
   - 並べ替え: 帯をドラッグして離した時点で、測定表のロット列が入れ替わる
   - 初めから: 既定の並びへ戻り、それも当たる

   **ダイアログが出ないこと**も見る——以前はalertで止めており、ドラッグの
   たびにダイアログが出る作りでは使えない。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B='http://127.0.0.1:5029',EQ='テスト設備A',LOT='L9000';
const setMode=m=>fetch(B+'/api/access-mode',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})});
let b=null;
const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
const snap=page=>page.evaluate(()=>({
 条数:document.getElementById('horizontalCount').value,
 groups:(S.measure.settings.splitGroups||[]).map(g=>g.lot+'×'+g.count),
 行:document.querySelectorAll('.measure-matrix tbody tr').length,
 ロット列:[...document.querySelectorAll('.measure-matrix td.mx-lot .strip-lot-badge')].map(e=>e.textContent),
 帯:[...document.querySelectorAll('#splitVisualStrip .split-visual-block')].map(e=>e.textContent.trim().slice(0,3)),
 実行ボタン:!!document.getElementById('applySplit'),
}));
const settle=async page=>{
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await page.waitForTimeout(250);
};
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1920,height:1080}});
 const dialogs=[],errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 page.on('dialog',d=>{dialogs.push(d.message().slice(0,80));d.accept()});
 try{
  await setMode('edit');
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  const opened=await page.evaluate(async lot=>{
   const r=await fetch('/api/table?'+new URLSearchParams({db:'SIKALOTNOW',table:'仕掛',page:1,page_size:5,
     include_hidden:1,filters:JSON.stringify([{column:'ロット番号',op:'eq',value:lot}])}));
   const row=((await r.json()).rows||[])[0];
   if(!row)return 'ロットが見つからない';
   await openMeasurement(row);return 'ok';
  },LOT).catch(e=>'例外: '+e.message);
  rec('分割ありロットを開ける',opened==='ok',String(opened));
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
  /* 子ロット候補がそろうまで待つ（条件待ち。固定待ちにしない） */
  await page.waitForFunction(
    ()=>document.querySelectorAll('#splitVisualStrip .split-visual-block').length>0,
    null,{timeout:20000}).catch(()=>{});
  await page.click('.mstep[data-mstep="2"]');
  await page.evaluate(()=>{const mt=document.getElementById('measureType');mt.value='板幅';
    mt.dispatchEvent(new Event('change',{bubbles:true}))});
  await settle(page);

  const a=await snap(page);
  rec('「条割を実行」ボタンは無い',a.実行ボタン===false,JSON.stringify(a));
  rec('開いた時点で条割が当たっている',
      a.groups.length===2&&a.条数==='2'&&a.行===2,JSON.stringify(a));
  rec('測定表のロット列が帯と同じ並び',
      a.ロット列.length===2&&a.ロット列.join()===a.帯.join(),JSON.stringify(a));

  /* 帯の1条目をつかんで右端へ運ぶ（実機と同じポインタ操作） */
  const boxes=await page.$$('#splitVisualStrip .split-visual-block');
  if(boxes.length>=2){
   const p=await boxes[0].boundingBox(),q=await boxes[boxes.length-1].boundingBox();
   await page.mouse.move(p.x+p.width/2,p.y+p.height/2);
   await page.mouse.down();
   await page.mouse.move(p.x+p.width/2+20,p.y+p.height/2,{steps:3});
   await page.mouse.move(q.x+q.width-4,q.y+q.height/2,{steps:8});
   await page.mouse.up();
   await settle(page);
  }
  const c=await snap(page);
  rec('並べ替えたら測定表がその場で入れ替わる',
      c.ロット列.join()!==a.ロット列.join()&&c.ロット列.join()===c.帯.join(),
      JSON.stringify({前:a.ロット列,後:c.ロット列,帯:c.帯}));
  rec('並べ替えでも条数は変わらない',c.条数===a.条数&&c.行===a.行,JSON.stringify(c));

  await page.click('#resetSplit').catch(()=>{});
  await settle(page);
  const d=await snap(page);
  rec('「初めから」で既定の並びへ戻り、それも当たる',
      d.ロット列.join()===a.ロット列.join()&&d.ロット列.join()===d.帯.join(),
      JSON.stringify({戻り:d.ロット列,帯:d.帯}));

  /* **ダイアログで止めない。** 以前はalertだったので、ドラッグのたびに
     手が止まった。理由は状態行の文字で伝える。 */
  rec('操作の途中でダイアログを出さない',dialogs.length===0,dialogs.join(' / '));
  rec('コンソールに例外を出さない',errs.length===0,errs.join(' / '));
 }catch(e){rec('FATAL',false,e.message)}
 finally{if(b)await b.close()}
 const ng=R.filter(x=>!x.ok).length;
 console.log(`\n${R.length-ng} PASS / ${ng} FAIL`);
 process.exit(ng?1:0);
})();
