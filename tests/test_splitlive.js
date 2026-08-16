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

  /* ---- 条の設計カードの姿（§9.157、利用者の指示「2枚目の条の設計も
     表示を最適化して」「スクロールレス設計で」） ----
     見るのは**実際の寸法**。DOMの数だけを見る網は、器が中身より大きくても
     素通りする（§9.126で実際に素通りした）。 */
  await page.evaluate(()=>WL.measureSteps.go('2'));
  await settle(page);
  const card=await page.evaluate(()=>{
   const c=document.getElementById('splitCard');
   const cs=getComputedStyle(c),r=c.getBoundingClientRect();
   /* **器そのものを測らないこと**——`.split-visual`は`flex:1`で必ず器の底まで
      伸びるので、直下の子の下端を見ると「余り0」と出て素通りする（この網を
      書いたときに実際に素通りした）。**いちばん下に見えている中身**
      （操作ボタンの行）で測る。 */
    const last=Math.max(...[...c.querySelectorAll('*')]
      .filter(e=>{const b=e.getBoundingClientRect();
        return b.height>0&&b.width>0&&e.children.length===0})
      .map(e=>e.getBoundingClientRect().bottom).concat([r.top]));
   const heads=[...c.querySelectorAll('h2,h3,.split-visual-head,.card-title')]
     .filter(e=>e.getBoundingClientRect().height>0);
   const strip=document.getElementById('splitVisualStrip').getBoundingClientRect();
   return{
    ころがし:Math.max(0,c.scrollHeight-c.clientHeight),
    余り:Math.round(r.bottom-parseFloat(cs.paddingBottom||0)-parseFloat(cs.borderBottomWidth||0)-last),
    見出し:heads.map(e=>e.textContent.trim().slice(0,20)),
    帯の高さ:Math.round(strip.height),
    条数の表示:[...c.querySelectorAll('*')].filter(e=>e.children.length===0
      &&/(^|[^0-9])9\s*条/.test(e.textContent||'')).map(e=>e.textContent.trim().slice(0,30)),
    説明欄:(()=>{const d=document.getElementById('splitVisualDetail');
      return{隠れ:!!d.hidden,高:Math.round(d.getBoundingClientRect().height)}})(),
   };
  });
  rec('条の設計カードはスクロールしない',card.ころがし===0,JSON.stringify(card));
  /* 余りは「置くべきものを別の場所へ隠している」ことの現れ（§9.131）。
     ここには畳んでいるものが無いので、**図が使い切る**のが正しい。 */
  rec('カードの下に余りを残さない',card.余り<=8,'余り='+card.余り+'px');
  /* 図は1つしかないので**カードの題がそのまま図の題**。中に群の見出しを
     置くと、同じことを2回言うことになる（§CLAUDE.md 同じ情報を2箇所に
     出さない）。 */
  rec('カードの中の見出しは題の1つだけ',card.見出し.length===1,JSON.stringify(card.見出し));
  /* 条数は`#splitGrid`の状態行が言う。隣にもう1つ「9条」のチップを
     置かないこと。 */
  rec('条数を2箇所に書かない',card.条数の表示.length<=1,JSON.stringify(card.条数の表示));
  /* 掴んだ条の説明は**中身が無いときは畳む**（空のまま場所を取っていた）。 */
  rec('説明欄は掴む前は畳んでいる',card.説明欄.隠れ&&card.説明欄.高===0,JSON.stringify(card.説明欄));
  /* 掴む的は大きいほどよい。以前は88px固定で、下に45pxの空きが残っていた。 */
  rec('帯はカードの高さを使い切る（88px固定に戻っていない）',card.帯の高さ>100,
      card.帯の高さ+'px');

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
