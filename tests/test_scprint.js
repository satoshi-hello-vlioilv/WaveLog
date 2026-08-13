/* test_scprint.js: 作業予定表の印刷（§9.115）
   ------------------------------------------------------------
   現場へ配る紙。**画面のタイムラインは刷らない**（15列以上あり、A4へ
   押し込むと読めない）ので、専用の割り付けを別に組んでいる。
   紙は「渡した相手が、それだけを見て作業できる」ことが要件なので、
   ここで固定するのは見た目の好みではなく**配れるかどうか**:

    - **1枚がA4に収まること。** 溢れると次の物理ページへこぼれ、脚の
      「1 / 4」が嘘になる（受け取った側が「自分のぶんが足りない」と
      判断できなくなる）。枚数は定数で決め打ちせず実測で切る。
    - **件数が少なくても行が引き伸ばされないこと。** 以前 .sp-table に
      flex:1 が付いており、7件の日は1行が30px→140pxになっていた。
    - **画面のしま模様を紙へ持ち込まないこと。** 30-measure.css の
      `tbody tr:nth-child(even)` は要素セレクタなのでこの表にも当たる。
      白黒コピーでは灰色の帯になり、記入欄が塗り潰されて見える。
    - **通し番号はその日の頭から続くこと。** 紙が2枚に分かれても#1へ
      戻すと、同じ日に#1が2つでき、現場が番号で指せなくなる。
    - **見出しの件数は「その日の合計」**。切り分けた2枚目に「13件」と
      出ると、その日が13件だと読まれてしまう。
    - **紙は画面に出ていないこと**（印刷のときだけ出る）。

   紙を組み立てるだけで window.print() は呼ばない（ヘッドレスで
   ダイアログを開くと戻ってこない）。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 const setMode=m=>page.evaluate(async mm=>{await fetch('/api/access-mode',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mm})})},m);

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
  await setMode('schedule');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  /* 予定が読み終わるまで待つ（件数が0のまま測ると何も確かめられない）。 */
  await page.waitForFunction(()=>(WL.scheduleView?.entries?.()||[]).length>0,null,{timeout:30000});

  /* ---- 0) 受け渡しと入口 ---- */
  const seam=await page.evaluate(()=>({
   view:typeof WL.scheduleView==='object',
   print:typeof WL.schedulePrint?.open,
   split:typeof WL.schedulePrint?.splitToSheets,
   btn:!!document.getElementById('scPrintBtn'),
   count:(WL.scheduleView?.entries?.()||[]).length,
  }));
  rec('印刷の入口がある',seam.view&&seam.print==='function'&&seam.split==='function'&&seam.btn,
      JSON.stringify(seam));

  /* ---- 1) 紙は画面に出ていない ---- */
  rec('紙は画面では隠れている',await page.evaluate(()=>{
   const el=document.createElement('div');el.className='sp-print-area';document.body.appendChild(el);
   const hidden=getComputedStyle(el).display==='none';el.remove();return hidden;
  }));

  /* 紙を組み立てて器へ入れる（測るために一時的に出す）。 */
  const build=(opt)=>page.evaluate(o=>{
   const groups=WL.schedulePrint.buildPages('テスト設備A',WL.scheduleView.entries(),o);
   const sheets=WL.schedulePrint.splitToSheets(groups,o);
   let area=document.getElementById('schedulePrintArea');
   if(!area){area=document.createElement('div');area.id='schedulePrintArea';
             area.className='sp-print-area';document.body.appendChild(area)}
   area.innerHTML=sheets.map((p,i)=>WL.schedulePrint.pageHtml(p,o,i+1,sheets.length)).join('');
   area.style.display='block';
   const cs=el=>getComputedStyle(el);
   const pgs=[...area.querySelectorAll('.sp-page')];
   const a4=parseFloat(cs(pgs[0]).minHeight)||0;
   const rows=[...area.querySelectorAll('tbody tr')];
   const numOf=p=>[...p.querySelectorAll('tbody .sp-c-no')].map(td=>Number(td.textContent));
   return {
    groups:groups.map(g=>g.rows.length),
    sheets:sheets.map(s=>s.rows.length),
    a4:Math.round(a4),
    heights:pgs.map(p=>Math.round(p.getBoundingClientRect().height)),
    over:pgs.filter(p=>p.getBoundingClientRect().height>a4+1).length,
    /* 器が overflow:hidden なので、はみ出しは高さでなく scrollHeight で見る */
    clipped:pgs.filter(p=>p.scrollHeight>Math.ceil(a4)+2).length,
    rowH:[...new Set(rows.map(t=>Math.round(t.getBoundingClientRect().height)))],
    rowBg:[...new Set(rows.map(t=>cs(t).backgroundColor))],
    cellFg:[...new Set(rows.map(t=>cs(t.querySelector('.sp-c-content')||t).color))],
    numbers:pgs.map(numOf),
    counts:pgs.map(p=>p.querySelector('.sp-count').textContent.trim()),
    days:pgs.map(p=>p.querySelector('.sp-day').textContent.trim()),
    foots:pgs.map(p=>p.querySelector('.sp-foot').lastElementChild.textContent.trim()),
    cols:pgs.map(p=>p.querySelectorAll('thead th').length),
    wide:pgs.filter(p=>{const t=p.querySelector('.sp-table');return t.scrollWidth>t.clientWidth+1}).length,
   };
  },opt);
  const clear=()=>page.evaluate(()=>{const a=document.getElementById('schedulePrintArea');
                                     if(a){a.style.display='';a.innerHTML=''}});

  /* ---- 2) まとめて1つの紙にすると、A4へ収まるところで切れる ---- */
  const all=await build({includeDone:true,actualColumns:true,pageByDate:false});
  const total=all.groups.reduce((s,n)=>s+n,0);
  rec('A4の高さで測れている',all.a4>1000&&all.a4<1200,'297mm='+all.a4+'px');
  rec('1つのまとまりが複数枚へ切れる',all.groups.length===1&&all.sheets.length>1,
      JSON.stringify({まとまり:all.groups,枚:all.sheets}));
  rec('切っても件数が減らない',all.sheets.reduce((s,n)=>s+n,0)===total,
      all.sheets.join('+')+' vs '+total);
  rec('どの紙もA4に収まる',all.over===0&&all.clipped===0,
      JSON.stringify({高さ:all.heights,溢れ:all.clipped}));
  rec('横にはみ出さない',all.wide===0);

  /* ---- 3) 引き伸ばし・しま模様・文字色 ---- */
  rec('行の高さが揃っている（引き伸ばさない）',all.rowH.length===1,JSON.stringify(all.rowH));
  rec('画面のしま模様が紙へ漏れない',
      all.rowBg.every(c=>c==='rgb(255, 255, 255)'),JSON.stringify(all.rowBg));
  rec('文字は黒で刷る',all.cellFg.every(c=>c==='rgb(0, 0, 0)'),JSON.stringify(all.cellFg));

  /* ---- 4) 通し番号は続く・見出しの件数はその日の合計 ---- */
  const nums=all.numbers;
  rec('通し番号が紙をまたいで続く',
      nums.length>1&&nums[0][0]===1&&nums[1][0]===nums[0][nums[0].length-1]+1,
      JSON.stringify(nums.map(a=>[a[0],a[a.length-1]])));
  rec('見出しの件数はその日の合計のまま',
      new Set(all.counts).size===1&&all.counts[0].startsWith(String(total)+'件'),
      JSON.stringify(all.counts));
  rec('続きの紙だと分かる',all.days.every(d=>d.includes('枚目 / 全'+all.sheets.length+'枚')),
      JSON.stringify(all.days));
  rec('脚の枚数が実際の枚数と合う',
      all.foots[0]==='1 / '+all.sheets.length&&
      all.foots[all.foots.length-1]===all.sheets.length+' / '+all.sheets.length,
      JSON.stringify(all.foots));
  rec('日付で分けないときは範囲を書く（日付未定にしない）',
      all.days.every(d=>!d.startsWith('日付未定')),JSON.stringify(all.days.slice(0,1)));
  await clear();

  /* ---- 5) 日付ごとに分けても引き伸ばさない ---- */
  const byDay=await build({includeDone:false,actualColumns:true,pageByDate:true});
  rec('日付ごとに紙が分かれる',byDay.groups.length>1,JSON.stringify(byDay.groups));
  rec('件数の少ない紙でも行の高さは同じ',
      byDay.rowH.length===1&&byDay.rowH[0]===all.rowH[0],
      JSON.stringify({日付ごと:byDay.rowH,まとめて:all.rowH}));
  rec('日付ごとでもA4に収まる',byDay.over===0&&byDay.clipped===0,JSON.stringify(byDay.heights));
  await clear();

  /* ---- 6) 記入欄の有無で列数が変わる ---- */
  const noWrite=await build({includeDone:true,actualColumns:false,pageByDate:false});
  rec('記入欄を外すと列が減る',noWrite.cols[0]===all.cols[0]-3,
      JSON.stringify({有:all.cols[0],無:noWrite.cols[0]}));
  rec('記入欄を外してもA4に収まる',noWrite.over===0&&noWrite.clipped===0);
  await clear();

  /* ---- 7) 測り終えたら器を空にして帰る ---- */
  rec('測ったあとに紙が残らない',
      await page.evaluate(()=>{
       const o={includeDone:true,actualColumns:true,pageByDate:false};
       WL.schedulePrint.splitToSheets(
         WL.schedulePrint.buildPages('テスト設備A',WL.scheduleView.entries(),o),o);
       const a=document.getElementById('schedulePrintArea');
       return !!a&&!a.innerHTML&&getComputedStyle(a).display==='none';
      }));

  /* ============================================================
     §9.118 紙のレイアウトは画面と別に持てる
     ============================================================ */
  /* ---- 8) 何も設定していなければ、今までと同じ紙 ---- */
  const base=await page.evaluate(()=>{
   const o={includeDone:true,actualColumns:true,pageByDate:false};
   const cat=WL.schedulePrint.paperCatalog();
   return {列:WL.schedulePrint.paperColumns('テスト設備A',o).map(c=>c.key),
           候補:cat.map(c=>c.key),
           分類:[...new Set(cat.map(c=>c.kind))].sort(),
           内容:cat.filter(c=>c.kind==='content').length};
  });
  rec('設定が無いときの紙は今までと同じ並び',
      base.列.join(',')==='no,state,time,shift,lotNo,content,estimate,write:start,write:end,write:check',
      base.列.join(','));
  rec('紙に置ける候補に内容の項目が入る',base.内容>0,`内容項目 ${base.内容}件 / 候補 ${base.候補.length}件`);
  rec('候補は出どころで分けてある（同名の列を見分けられる）',
      base.分類.join(',')==='content,plan,write',base.分類.join(','));

  /* ---- 9) 保存したレイアウトが紙に効く ---- */
  const custom=await page.evaluate(async()=>{
   const cat=WL.schedulePrint.paperCatalog();
   const item=cat.find(c=>c.kind==='content');
   const order=['no','date','lotNo',item?item.key:'content','write:check'];
   const hidden=cat.map(c=>c.key).filter(k=>!order.includes(k));
   await WL.columnLayout.save('print:テスト設備A',{
    order:[...order,...hidden],hidden,
    widths:{no:8,date:22,lotNo:30,'write:check':12},
    names:{lotNo:'ロットNo.'},formats:{},rules:{},formulas:{}});
   const o={includeDone:true,actualColumns:true,pageByDate:false};
   const cols=WL.schedulePrint.paperColumns('テスト設備A',o);
   const noWrite=WL.schedulePrint.paperColumns('テスト設備A',{...o,actualColumns:false});
   return {列:cols.map(c=>c.key),見出し:cols.map(c=>c.label),幅:cols.map(c=>c.mm),
           記入欄なし:noWrite.map(c=>c.key)};
  });
  rec('保存したレイアウトの列だけが紙に出る',custom.列.length===5,custom.列.join(','));
  rec('保存した並びのとおりに出る',custom.列.join(',').startsWith('no,date,lotNo,'),custom.列.join(','));
  rec('表示名の上書きが紙の見出しに出る',custom.見出し[2]==='ロットNo.',custom.見出し.join(','));
  rec('幅(mm)の指定が効く',custom.幅[0]===8&&custom.幅[1]===22,JSON.stringify(custom.幅));
  /* **紙は幅が有限**なので、載せていない列が勝手に増えないこと。
     並びに**一度も載っていない**列で確かめる（hiddenで消した列だけを見ると、
     「あとから内容の項目が増えたとき」を再現できず素通りする）。 */
  const grew=await page.evaluate(async()=>{
   const cat=WL.schedulePrint.paperCatalog();
   const order=['no','lotNo','estimate'];          // 3列だけを保存(残りは並びに無い)
   await WL.columnLayout.save('print:テスト設備A',{
    order,hidden:[],widths:{},names:{},formats:{},rules:{},formulas:{}});
   const cols=WL.schedulePrint.paperColumns('テスト設備A',
     {includeDone:true,actualColumns:true,pageByDate:false});
   return {列:cols.map(c=>c.key),候補:cat.length};
  });
  rec('並びに無い列は紙へ出ない（項目が増えても紙は変わらない）',
      grew.列.join(',')==='no,lotNo,estimate',`${grew.列.join(',')}（候補${grew.候補}件）`);
  rec('設定に無い列は紙へ出ない',!custom.列.includes('state')&&!custom.列.includes('content'),
      custom.列.join(','));
  /* 元の5列の設定へ戻す(このあとの検査が使う)。 */
  await page.evaluate(async()=>{
   const cat=WL.schedulePrint.paperCatalog();
   const item=cat.find(c=>c.kind==='content');
   const order=['no','date','lotNo',item?item.key:'content','write:check'];
   const hidden=cat.map(c=>c.key).filter(k=>!order.includes(k));
   await WL.columnLayout.save('print:テスト設備A',{
    order:[...order,...hidden],hidden,
    widths:{no:8,date:22,lotNo:30,'write:check':12},
    names:{lotNo:'ロットNo.'},formats:{},rules:{},formulas:{}});
  });
  rec('「記入欄をつけない」は保存後も効く',
      !custom.記入欄なし.some(k=>k.startsWith('write:')),custom.記入欄なし.join(','));

  /* ---- 10) 組んだ紙もA4に収まる ---- */
  const drawn=await build({includeDone:true,actualColumns:true,pageByDate:false});
  rec('組んだレイアウトでもA4に収まる',drawn.over===0&&drawn.clipped===0&&drawn.wide===0,
      JSON.stringify({高さ:drawn.heights,溢れ:drawn.clipped,横:drawn.wide}));
  rec('組んだレイアウトでも行の高さは揃う',drawn.rowH.length===1,JSON.stringify(drawn.rowH));
  /* 幅は**colgroupが持つ**（CSSに書くと利用者が変えられない）。 */
  const widthSource=await page.evaluate(()=>{
   const pg=document.querySelector('#schedulePrintArea .sp-page');
   const cols=[...pg.querySelectorAll('colgroup col')];
   const th=pg.querySelector('thead th');
   return {col数:cols.length,先頭の幅:cols[0]?cols[0].style.width:'',
           CSSの幅:getComputedStyle(th).width};
  });
  rec('幅はcolgroupがmmで与える',widthSource.col数===5&&/mm$/.test(widthSource.先頭の幅),
      JSON.stringify(widthSource));
  await clear();

  /* ---- 11) レイアウトを組む画面 ---- */
  await page.evaluate(()=>WL.schedulePrint.openLayoutPanel('テスト設備A'));
  await page.waitForSelector('#schedulePrintLayoutPanel:not([hidden])',{timeout:8000});
  const panel=await page.evaluate(()=>{
   const p=document.getElementById('schedulePrintLayoutPanel');
   const r=p.getBoundingClientRect();
   return {行:p.querySelectorAll('.spl-row').length,
           選択:p.querySelectorAll('.spl-row:not(.is-off)').length,
           分類の印:p.querySelectorAll('.spl-kind').length,
           目盛:document.getElementById('splGauge').textContent.replace(/\s+/g,' ').trim(),
           画面内:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};
  });
  rec('候補が全部並ぶ（出していない列も消さない）',
      panel.行===base.候補.length,`${panel.行}行 / 候補${base.候補.length}件`);
  rec('選んでいる列が先に並ぶ',panel.選択===5,String(panel.選択));
  rec('行ごとに出どころが文字で出る',panel.分類の印===panel.行,`${panel.分類の印}/${panel.行}`);
  rec('レイアウトの画面は画面の中に開く',panel.画面内,JSON.stringify(panel));
  /* **要点**: 幅の合計と残りが見える。刷ってから気づくのでは紙が無駄になる。 */
  rec('幅の合計と残りが出る',/幅の合計/.test(panel.目盛)&&/残り/.test(panel.目盛),
      panel.目盛.slice(0,90));

  const over=await page.evaluate(()=>{
   const w=document.querySelector('#splRows [data-w]');
   w.value='190';w.dispatchEvent(new Event('input',{bubbles:true}));
   const g=document.getElementById('splGauge');
   return {印:g.classList.contains('is-over'),文:g.querySelector('small').textContent.trim()};
  });
  rec('紙幅を超えたら「何mm多いか」を言う',over.印&&/はみ出/.test(over.文)&&/\d+mm/.test(over.文),
      over.文.slice(0,60));
  const reset=await page.evaluate(()=>{
   document.getElementById('splReset').click();
   return [...document.querySelectorAll('#splRows .spl-row:not(.is-off) .spl-name')].length;
  });
  rec('既定に戻せる',reset===10,`${reset}列`);
  /* 「やめる」は保存しない＝紙は組んだままのはず。 */
  await page.evaluate(()=>document.getElementById('splCancel').click());
  rec('やめても保存済みの紙は変わらない',
      (await page.evaluate(()=>WL.schedulePrint.paperColumns('テスト設備A',
        {includeDone:true,actualColumns:true,pageByDate:false}).length))===5);

  console.log('\n=== SUMMARY ===');
  const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
  ng.forEach(x=>console.log(' -',x.n,x.d||''));
  await cleanup();
  process.exit(ng.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  await cleanup();
  process.exit(2);
 }
 async function cleanup(){
  /* 紙のレイアウトを保存するので必ず消す(残すと次の実行が既定でなくなる)。 */
  try{await page.evaluate(async()=>{await WL.columnLayout.save('print:テスト設備A',
    {order:[],hidden:[],widths:{},names:{},formats:{},rules:{},formulas:{}})})}catch(e){}
  try{await setMode('edit')}catch(e){}
  if(b)await b.close().catch(()=>{});
 }
})().catch(async e=>{console.error('FATAL',e);if(b)await b.close().catch(()=>{});process.exit(2)});
