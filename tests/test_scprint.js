/* test_scprint.js: 作業予定表の印刷（§9.115/§9.235）
   ------------------------------------------------------------
   現場へ配る紙。**画面のタイムラインは刷らない**（15列以上あり、A4へ
   押し込むと読めない）ので、専用の割り付けを別に組んでいる。
   紙は「渡した相手が、それだけを見て作業できる」ことが要件なので、
   ここで固定するのは見た目の好みではなく**配れるかどうか**:

    - **1枚が用紙に収まること。** 溢れると次の物理ページへこぼれ、脚の
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

   §9.235（利用者の指示）で刷新した3つも固定する:
    - **紙の列は画面（`timeline:<設備>`）とそのまま同じ。** 並び・
      表示/非表示・表示名・書式・読み替え・計算式のどれを画面で変えても、
      紙のためだけの列選択（旧`print:<設備>`）を経由せずそのまま紙に出る。
    - **用紙サイズ・向きをA4/A3×縦/横から選べる。**
    - **分割後の子ロットの情報を載せる/載せないを選べる**。親と同じ塊として
      改ページされ、子だけ次の紙へ逃げない。

   紙を組み立てるだけで window.print() は呼ばない（ヘッドレスで
   ダイアログを開くと戻ってこない）。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
const PARENT='L9000';
const TARGET='timeline:'+EQ;

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 const setMode=m=>page.evaluate(async mm=>{await fetch('/api/access-mode',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mm})})},m);
 let savedLayout=null;   // timeline:テスト設備A の保存済みの写し(復元用)
 const made=[];          // 予定へ入れたロット(あとで削除)

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
  await page.evaluate(t=>WL.columnLayout.load(t),TARGET);
  savedLayout=await page.evaluate(t=>WL.columnLayout.saved(t),TARGET);

  /* ---- 0) 受け渡しと入口 ---- */
  const seam=await page.evaluate(()=>({
   view:typeof WL.scheduleView==='object',
   print:typeof WL.schedulePrint?.open,
   split:typeof WL.schedulePrint?.splitToSheets,
   cols:typeof WL.schedulePrint?.printColumns,
   sizes:typeof WL.schedulePrint?.paperSizes,
   pats:typeof WL.schedulePrint?.writePatterns,
   btn:!!document.getElementById('scPrintBtn'),
   count:(WL.scheduleView?.entries?.()||[]).length,
  }));
  rec('印刷の入口がある',seam.view&&seam.print==='function'&&seam.split==='function'
      &&seam.cols==='function'&&seam.sizes==='function'&&seam.pats==='function'&&seam.btn,
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
   const sheetH=parseFloat(cs(pgs[0]).minHeight)||0;
   /* 「no」は`printColumns()`が最初に足す印刷専用列なので、常に先頭列。 */
   const rows=[...area.querySelectorAll('tbody tr[data-row]:not(.sp-row-child)')];
   const numOf=p=>[...p.querySelectorAll('tbody tr[data-row]:not(.sp-row-child) td:first-child')]
     .map(td=>Number(td.textContent));
   return {
    groups:groups.map(g=>g.rows.length),
    sheets:sheets.map(s=>s.rows.length),
    sheetH:Math.round(sheetH),
    heights:pgs.map(p=>Math.round(p.getBoundingClientRect().height)),
    over:pgs.filter(p=>p.getBoundingClientRect().height>sheetH+1).length,
    /* 器が overflow:hidden なので、はみ出しは高さでなく scrollHeight で見る */
    clipped:pgs.filter(p=>p.scrollHeight>Math.ceil(sheetH)+2).length,
    rowH:[...new Set(rows.map(t=>Math.round(t.getBoundingClientRect().height)))],
    rowBg:[...new Set(rows.map(t=>cs(t).backgroundColor))],
    cellFg:[...new Set(rows.map(t=>cs(t.querySelector('td:nth-child(3)')||t).color))],
    numbers:pgs.map(numOf),
    counts:pgs.map(p=>p.querySelector('.sp-count').textContent.trim()),
    days:pgs.map(p=>p.querySelector('.sp-day').textContent.trim()),
    foots:pgs.map(p=>p.querySelector('.sp-foot').lastElementChild.textContent.trim()),
    cols:pgs.map(p=>p.querySelectorAll('thead th').length),
    wide:pgs.filter(p=>{const t=p.querySelector('.sp-table');return t.scrollWidth>t.clientWidth+1}).length,
    dataPaper:pgs.map(p=>p.dataset.paper),
    childRows:area.querySelectorAll('.sp-row-child').length,
   };
  },opt);
  const clear=()=>page.evaluate(()=>{const a=document.getElementById('schedulePrintArea');
                                     if(a){a.style.display='';a.innerHTML=''}});

  /* ---- 2) まとめて1つの紙にすると、用紙の高さで切れる ---- */
  const all=await build({includeDone:true,pageByDate:false,paper:'a4-portrait'});
  const total=all.groups.reduce((s,n)=>s+n,0);
  rec('A4の高さで測れている',all.sheetH>1000&&all.sheetH<1200,'297mm='+all.sheetH+'px');
  rec('1つのまとまりが複数枚へ切れる',all.groups.length===1&&all.sheets.length>1,
      JSON.stringify({まとまり:all.groups,枚:all.sheets}));
  rec('切っても件数が減らない',all.sheets.reduce((s,n)=>s+n,0)===total,
      all.sheets.join('+')+' vs '+total);
  rec('どの紙も用紙に収まる',all.over===0&&all.clipped===0,
      JSON.stringify({高さ:all.heights,溢れ:all.clipped}));
  rec('横にはみ出さない',all.wide===0);

  /* ---- 3) 引き伸ばし・しま模様・文字色 ---- */
  /* §9.235で画面の列をそのまま紙へ載せるようになったため、列数が増え、
     内容が長い行（実行中の行の「計画外 +987分」等）は中身なりに2行へ
     折り返すことがある——これは中身が多いだけで「引き伸ばし」ではない。
     **固定したいのは`flex:1`のような器の伸ばし**（以前は7件の日で
     30px→140pxへ伸びていた＝約4.7倍）。中身の折り返しは高々2行ぶん
     （基準の高さの1.6倍まで）に収まることと、高さの種類が少数
     （中身の長さで決まる、地の高さと折り返した高さの数種類）で収まる
     ことを見る。 */
  const baseRowH=Math.min(...all.rowH);
  rec('行の高さは中身なりで、器を伸ばして引き伸ばしていない（以前はflex:1で30px→140pxへ伸びていた）',
      all.rowH.length<=4&&all.rowH.every(h=>h<=baseRowH*1.6),
      JSON.stringify({高さ:all.rowH,基準:baseRowH}));
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
  rec('用紙の指定がsectionへ出る(§9.235。@pageの差し替えが見る印)',
      all.dataPaper.every(p=>p==='a4-portrait'),JSON.stringify(all.dataPaper));
  await clear();

  /* ---- 5) 日付ごとに分けても引き伸ばさない ---- */
  const byDay=await build({includeDone:false,pageByDate:true,paper:'a4-portrait'});
  rec('日付ごとに紙が分かれる',byDay.groups.length>1,JSON.stringify(byDay.groups));
  rec('件数の少ない紙でも行の基準の高さは変わらない（ページの割り方で伸び縮みしない）',
      Math.min(...byDay.rowH)===baseRowH&&byDay.rowH.every(h=>h<=baseRowH*1.6),
      JSON.stringify({日付ごと:byDay.rowH,まとめての基準:baseRowH}));
  rec('日付ごとでも用紙に収まる',byDay.over===0&&byDay.clipped===0,JSON.stringify(byDay.heights));
  await clear();

  /* ---- 6) 測り終えたら器を空にして帰る ---- */
  rec('測ったあとに紙が残らない',
      await page.evaluate(()=>{
       const o={includeDone:true,pageByDate:false};
       WL.schedulePrint.splitToSheets(
         WL.schedulePrint.buildPages('テスト設備A',WL.scheduleView.entries(),o),o);
       const a=document.getElementById('schedulePrintArea');
       return !!a&&!a.innerHTML&&getComputedStyle(a).display==='none';
      }));

  /* ============================================================
     §9.235 ① 紙の列は画面（timeline:設備）とそのまま同じ
     利用者の指示「列の情報や並びもそのまま、『内容』で表示内容をまとめずに、
     画面印刷に近い形で、列の成型した内容が生きるように」
     ============================================================ */
  /* ---- 7) 何も触っていなければ、画面の列とそのまま同じ ---- */
  const mirror=await page.evaluate(()=>{
   const screenKeys=WL.scheduleView.printColumnKeys();
   const printKeys=WL.schedulePrint.printColumns({includeDone:true,pageByDate:false}).map(c=>c.key);
   return {screenKeys,printKeys,
           // 先頭2つは印刷専用の「#」「状態」。そのあとが画面の列とそのまま同じ並び。
           tail:printKeys.slice(2,2+screenKeys.length)};
  });
  rec('印刷専用の「#」「状態」が先頭に立つ',
      mirror.printKeys[0]==='no'&&mirror.printKeys[1]==='state',JSON.stringify(mirror.printKeys.slice(0,2)));
  rec('残りは画面の列とそのまま同じ並び（紙だけの列選択を持たない）',
      JSON.stringify(mirror.tail)===JSON.stringify(mirror.screenKeys),
      JSON.stringify({画面:mirror.screenKeys,紙:mirror.tail}));

  /* ---- 8) 画面で列を隠す/表示名を変える/並べ替えると、紙もそのまま変わる ---- */
  const keysBefore=mirror.screenKeys;
  const hideKey=keysBefore.find(k=>k!=='lotNo');
  const moveKey=[...keysBefore].reverse().find(k=>k!=='lotNo'&&k!==hideKey)
    ||keysBefore[keysBefore.length-1];
  const customLabel='ロットNo.(印刷確認用)';
  const mutated=await page.evaluate(async a=>{
   const order=[a.moveKey,...WL.scheduleView.printColumnKeys().filter(k=>k!==a.moveKey)];
   await WL.columnLayout.patch(a.t,{hidden:[a.hideKey],names:{lotNo:a.label},order});
   return {
    screenKeys:WL.scheduleView.printColumnKeys(),
    cols:WL.schedulePrint.printColumns({includeDone:true,pageByDate:false}).map(c=>({key:c.key,label:c.label})),
   };
  },{t:TARGET,hideKey,moveKey,label:customLabel});
  rec('画面で隠した列は紙にも出ない（紙だけの列選択が無いので、隠す/出すは画面が持つ）',
      !mutated.screenKeys.includes(hideKey)&&!mutated.cols.some(c=>c.key===hideKey),
      JSON.stringify({隠した:hideKey,画面の列:mutated.screenKeys,紙の列:mutated.cols.map(c=>c.key)}));
  rec('画面で変えた表示名がそのまま紙の見出しに出る',
      mutated.cols.some(c=>c.key==='lotNo'&&c.label===customLabel),
      JSON.stringify(mutated.cols.find(c=>c.key==='lotNo')));
  rec('画面で動かした列の並びが紙にもそのまま出る',
      mutated.cols[2]&&mutated.cols[2].key===moveKey,
      `先頭のデータ列=${mutated.cols[2]&&mutated.cols[2].key} / 動かした列=${moveKey}`);
  /* 元へ戻す（このあとの検査へ影響を残さない。§9.121と同じ理由）。 */
  await page.evaluate(a=>WL.columnLayout.save(a.t,a.orig),{t:TARGET,orig:savedLayout});
  await page.waitForTimeout(300);
  const restored=await page.evaluate(()=>WL.scheduleView.printColumnKeys());
  rec('列の設定を元へ戻せた',JSON.stringify(restored)===JSON.stringify(keysBefore),
      JSON.stringify({元:keysBefore,いま:restored}));

  /* ---- 9) 記入欄はパターンで選ぶ(§9.191) ----
     「開始・終了」固定をやめ、よく使う形に名前を付けて選べるようにした。
     **既定は「実績を書いてもらう」**（紙だけの列選択が無くなったので、
     紙の列で決めたままという以前の既定は成り立たない）。 */
  const pats=await page.evaluate(()=>{
   const base={includeDone:true,pageByDate:false};
   const keys=o=>WL.schedulePrint.printColumns(o).map(c=>c.key);
   return {
    一覧:WL.schedulePrint.writePatterns().map(p=>p.key),
    既定:keys(base),                                     // writePattern未指定
    実績:keys({...base,writePattern:'actual'}),
    実績備考:keys({...base,writePattern:'actualNote'}),
    備考だけ:keys({...base,writePattern:'note'}),
    確認だけ:keys({...base,writePattern:'check'}),
    なし:keys({...base,writePattern:'none'}),
    古い設定:keys({...base,actualColumns:false}),        // 旧`actualColumns`
    古い並び:keys({...base,writePattern:'custom'}),       // 旧`custom`は既定へ読み替え
   };
  });
  rec('書き込む欄のパターンが選べる（実績＋4つ）',
      pats.一覧.join(',')==='actual,actualNote,note,check,none',pats.一覧.join(','));
  rec('既定は「実績を書いてもらう」（開始・終了・確認の3欄）',
      pats.既定.filter(k=>k.startsWith('write:')).join(',')==='write:start,write:end,write:check',
      pats.既定.join(','));
  rec('「実績」を選ぶと3欄になる',
      pats.実績.filter(k=>k.startsWith('write:')).join(',')==='write:start,write:end,write:check',
      pats.実績.join(','));
  rec('「実績＋備考」を選ぶと4欄になる',
      pats.実績備考.filter(k=>k.startsWith('write:')).join(',')==='write:start,write:end,write:check,write:note',
      pats.実績備考.join(','));
  rec('「備考だけ」を選ぶと備考1欄だけになる',
      pats.備考だけ.filter(k=>k.startsWith('write:')).join(',')==='write:note',pats.備考だけ.join(','));
  rec('「確認だけ」を選ぶと確認1欄だけになる',
      pats.確認だけ.filter(k=>k.startsWith('write:')).join(',')==='write:check',pats.確認だけ.join(','));
  rec('「記入欄なし」を選ぶと1つも出ない',
      !pats.なし.some(k=>k.startsWith('write:')),pats.なし.join(','));
  rec('古い設定（記入欄をつけない）もそのまま効く',
      !pats.古い設定.some(k=>k.startsWith('write:')),pats.古い設定.join(','));
  rec('古い保存値(custom)は既定へ読み替える',
      pats.古い並び.filter(k=>k.startsWith('write:')).join(',')==='write:start,write:end,write:check',
      pats.古い並び.join(','));

  /* ============================================================
     §9.235 ② 用紙サイズ・向き（A4/A3 × 縦/横）
     利用者の指示「印刷サイズA4だけでなくA3や縦向きや横向きも選べるように」
     ============================================================ */
  /* ---- 10) 4つの用紙が実寸(mm)どおりCSSへ効いている ---- */
  const sizes=await page.evaluate(()=>WL.schedulePrint.paperSizes());
  rec('用紙は4通り（A4/A3 × 縦/横）',
      sizes.length===4&&['a4-portrait','a4-landscape','a3-portrait','a3-landscape']
        .every(k=>sizes.some(s=>s.key===k)),JSON.stringify(sizes));
  const paperCss=await page.evaluate(keys=>{
   const wrap=document.createElement('div');wrap.style.cssText='position:fixed;left:-10000px;top:0';
   document.body.appendChild(wrap);
   const out={};
   keys.forEach(k=>{
    const el=document.createElement('section');el.className='sp-page';el.dataset.paper=k;
    wrap.appendChild(el);
    const cs=getComputedStyle(el);
    out[k]={w:parseFloat(cs.width),h:parseFloat(cs.minHeight)};
   });
   wrap.remove();
   return out;
  },sizes.map(s=>s.key));
  const mm=px=>Math.round(px/96*25.4);
  sizes.forEach(s=>{
   const css=paperCss[s.key];
   rec(`${s.label}(${s.key})は${s.w}×${s.h}mmでCSSに効いている`,
       !!css&&mm(css.w)===s.w&&mm(css.h)===s.h,
       JSON.stringify({期待:{w:s.w,h:s.h},実測mm:css?{w:mm(css.w),h:mm(css.h)}:null}));
  });

  /* ---- 11) 選んだ用紙が実際に組んだ紙の`data-paper`へ通る ---- */
  const a3=await build({includeDone:true,pageByDate:false,paper:'a3-landscape'});
  rec('A3横を選ぶとsectionのdata-paperがa3-landscapeになる',
      a3.dataPaper.length>0&&a3.dataPaper.every(p=>p==='a3-landscape'),JSON.stringify(a3.dataPaper));
  rec('A3横でも用紙に収まる',a3.over===0&&a3.clipped===0&&a3.wide===0,
      JSON.stringify({高さ:a3.heights,溢れ:a3.clipped,横:a3.wide}));
  const a3p=await build({includeDone:true,pageByDate:false,paper:'a3-portrait'});
  rec('A3縦は420mmで測れている',a3p.sheetH>1550&&a3p.sheetH<1650,'420mm='+a3p.sheetH+'px');
  rec('A3縦のほうがA4縦より1枚に多く入る(枚数が減るか同じ)',
      a3p.sheets.length<=all.sheets.length,`A4=${all.sheets.length}枚 / A3縦=${a3p.sheets.length}枚`);
  await clear();

  /* ============================================================
     §9.235 ③ 分割後の子ロット情報を印刷ON/OFF
     利用者の指示「分割後の子ロットの情報も印刷表示ONOFFできるように」
     ============================================================ */
  /* ---- 12) 分割ありの親を1件入れて、子ロットの内訳を紙に出せる ---- */
  const added=await page.evaluate(async lot=>{
   const r=await fetch('/api/table?'+new URLSearchParams({db:'SIKALOTNOW',table:'仕掛',page:1,page_size:5,
     include_hidden:1,filters:JSON.stringify([{column:'ロット番号',op:'eq',value:lot}])}));
   const row=((await r.json()).rows||[])[0];
   if(!row)return false;
   await window.scheduleAddFromRow(row);
   return true;
  },PARENT);
  await page.waitForTimeout(3500);
  const pid=await page.evaluate(async e=>{
   const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e));
   const es=((await r.json()).entries||[]).filter(x=>x.lotNo==='L9000'&&x.parentId==null);
   return es.length?es[es.length-1].id:null;
  },EQ);
  if(pid)made.push(pid);
  rec('分割ありの親を予定へ入れられる',added&&!!pid);

  const noKids=await build({includeDone:true,pageByDate:false,includeChildren:false});
  rec('既定（載せない）では子ロットの行が出ない',noKids.childRows===0,String(noKids.childRows));
  await clear();

  const withKids=await build({includeDone:true,pageByDate:false,includeChildren:true});
  rec('「載せる」にすると子ロットの行が出る',withKids.childRows===2,String(withKids.childRows));
  const kidsInfo=await page.evaluate(()=>{
   const box=document.getElementById('schedulePrintArea');
   const kidRows=[...box.querySelectorAll('.sp-row-child')];
   return {
    lots:kidRows.map(r=>(r.querySelector('.sp-c-child-lot')||{}).textContent||''),
    infos:kidRows.map(r=>(r.querySelector('.sp-c-child-info')||{}).textContent||''),
    dataRow:kidRows.map(r=>r.dataset.row),
    /* 親と同じ`data-row`の実行(main)行が、同じ紙(.sp-page)の中にあるか。
       ブロック単位で改ページするので、子だけ別の紙へ逃げてはいけない
       (§9.235 ③)。ロット番号の列は`.sp-c-lot`で引く——並び順しだいで
       末尾に来るとは限らないので、位置ではなく印で探す。 */
    sameSheet:kidRows.every(r=>{
     const page=r.closest('.sp-page');
     const parentRow=page.querySelector(`tbody tr[data-row="${r.dataset.row}"]:not(.sp-row-child)`);
     const lot=parentRow&&parentRow.querySelector('.sp-c-lot');
     return !!lot&&lot.textContent.trim()==='L9000';
    }),
   };
  });
  rec('子ロットの番号が「└ 子ロット番号」の形で出る',
      kidsInfo.lots.some(t=>/└ ?L90001/.test(t))&&kidsInfo.lots.some(t=>/└ ?L90002/.test(t)),
      JSON.stringify(kidsInfo.lots));
  rec('子ロットの内訳（条数など）が読める',
      kidsInfo.infos.every(t=>/条/.test(t)),JSON.stringify(kidsInfo.infos));
  rec('子ロットの行は親と同じ紙に載る（親子で1つの塊。§9.235 ③）',
      kidsInfo.sameSheet,JSON.stringify(kidsInfo));
  rec('子ロットの行でも用紙に収まる',withKids.over===0&&withKids.clipped===0,
      JSON.stringify(withKids.heights));
  await clear();

  /* ============================================================
     §9.186 印刷はプレビューを先に出す
     ============================================================ */
  /* ---- 13) 押すとすぐプレビューが出る（先に聞かない） ---- */
  await page.evaluate(()=>WL.schedulePrint.openPreview('テスト設備A'));
  await page.waitForSelector('#schedulePrintPreview:not([hidden])',{timeout:10000});
  await page.waitForFunction(()=>document.querySelectorAll('#spPvPaper .sp-pv-sheet').length>0
    ||document.querySelector('.sp-pv-empty'),null,{timeout:20000});
  const pv=await page.evaluate(()=>({
   sheets:document.querySelectorAll('.sp-pv-sheet').length,
   pages:document.querySelectorAll('.sp-pv-sheet .sp-page').length,
   facts:(document.getElementById('spPvFacts')||{}).innerText||'',
   caption:(document.querySelector('.sp-pv-sheet figcaption')||{}).textContent||'',
   opts:document.querySelectorAll('#spPvOptions [data-opt]').length,
   optKeys:[...document.querySelectorAll('#spPvOptions [data-opt]')].map(i=>i.dataset.opt),
   sizeOpts:document.querySelectorAll('#spPvSize .sp-pat').length,
   printBtn:!!document.getElementById('spPvPrint'),
   ask:!!document.querySelector('#appConfirm:not([hidden])'),
  }));
  rec('押すとすぐ紙のプレビューが出る（先に聞かない）',
      pv.sheets>0&&pv.pages===pv.sheets&&!pv.ask,JSON.stringify(pv));
  rec('枚数と用紙サイズを文字で出す',/枚/.test(pv.facts),pv.facts.replace(/\n/g,' / '));
  rec('「分割後の子ロットの情報も載せる」がチェック項目にある(§9.235 ③)',
      pv.optKeys.includes('includeChildren'),JSON.stringify(pv.optKeys));
  rec('用紙の選択肢が4つ並ぶ(§9.235 ②)',pv.sizeOpts===4,String(pv.sizeOpts));
  /* **紙が切れていないこと。** 器の寸法を`getBoundingClientRect()`（倍率を
     掛けたあとの値）から作ると、そこへもう一度倍率が掛かって右側が
     切り落とされる（実際に切れた）。列の数で見る。 */
  const cut=await page.evaluate(()=>{
   const pg=document.querySelector('.sp-pv-sheet .sp-page');
   const box=pg.closest('.sp-pv-scale');
   const zoom=Number(getComputedStyle(document.getElementById('spPvPaper'))
     .getPropertyValue('--sp-zoom'))||1;
   return {cols:pg.querySelectorAll('thead th').length,
           器:box.clientWidth,紙:Math.round(pg.offsetWidth*zoom),zoom};
  });
  rec('紙が器からはみ出して切れていない',Math.abs(cut.器-cut.紙)<=2,JSON.stringify(cut));
  const want=await page.evaluate(()=>WL.schedulePrint.printColumns(
    {includeDone:false,pageByDate:true}).length);
  rec('プレビューの列は紙の列と同じ数',cut.cols===want,`${cut.cols}列 / 紙は${want}列`);
  rec('何枚目かを紙ごとに出す',/\d+ \/ \d+/.test(pv.caption),pv.caption);
  rec('設定も用紙サイズもプレビューの中から触れる',pv.opts>=4&&pv.printBtn,JSON.stringify(pv));

  /* ---- 14) 設定を触るとその場で刷り上がりが変わる ---- */
  const before=pv.sheets;
  await page.click('#spPvOptions [data-opt="pageByDate"]');
  await page.waitForFunction(n=>document.querySelectorAll('.sp-pv-sheet').length!==n,
    before,{timeout:15000}).catch(()=>{});
  const after=await page.evaluate(()=>document.querySelectorAll('.sp-pv-sheet').length);
  rec('設定を触るとその場で刷り上がりが変わる',after!==before&&after>0,`${before}枚 → ${after}枚`);
  /* 見たものをそのまま刷る(組み直さない)。 */
  const same=await page.evaluate(()=>{
   const shown=document.querySelectorAll('.sp-pv-sheet').length;
   return {shown,kept:WL.schedulePrint.previewSheets().length};
  });
  rec('刷るのは見えている紙そのもの',same.shown===same.kept,JSON.stringify(same));
  await page.click('#spPvOptions [data-opt="pageByDate"]');   // 元へ戻す
  await page.waitForTimeout(400);

  /* ---- 15) 「分割後の子ロットの情報も載せる」もプレビューへその場で効く ---- */
  const kidsOff=await page.evaluate(()=>document.querySelectorAll('.sp-page .sp-row-child').length);
  rec('既定ではプレビューにも子ロットの行が出ない',kidsOff===0,String(kidsOff));
  await page.click('#spPvOptions [data-opt="includeChildren"]');
  await page.waitForFunction(()=>document.querySelectorAll('.sp-page .sp-row-child').length>0,
    null,{timeout:15000}).catch(()=>{});
  const kidsOn=await page.evaluate(()=>document.querySelectorAll('.sp-page .sp-row-child').length);
  rec('チェックすると子ロットの行がその場で出る',kidsOn>0,String(kidsOn));
  await page.click('#spPvOptions [data-opt="includeChildren"]');
  await page.waitForTimeout(400);

  /* ---- 16) 用紙サイズを選ぶとその場でプレビューの紙が変わる ---- */
  const beforePaper=await page.evaluate(()=>{
   const pg=document.querySelector('.sp-pv-sheet .sp-page');
   return {paper:pg?pg.dataset.paper:'',minH:pg?parseFloat(getComputedStyle(pg).minHeight):0};
  });
  await page.click('#spPvSize input[value="a3-portrait"]');
  await page.waitForFunction(()=>{
   const pg=document.querySelector('.sp-pv-sheet .sp-page');
   return pg&&pg.dataset.paper==='a3-portrait';
  },null,{timeout:15000}).catch(()=>{});
  const afterPaper=await page.evaluate(()=>{
   const pg=document.querySelector('.sp-pv-sheet .sp-page');
   return {paper:pg?pg.dataset.paper:'',minH:pg?parseFloat(getComputedStyle(pg).minHeight):0};
  });
  rec('用紙サイズを選ぶとその場でプレビューの紙が変わる',
      afterPaper.paper==='a3-portrait'&&afterPaper.minH>beforePaper.minH,
      JSON.stringify({前:beforePaper,後:afterPaper}));
  rec('選んだ用紙は端末に残る',
      (await page.evaluate(()=>{try{return JSON.parse(localStorage.getItem('SchedulePrintPrefV1')||'{}').paper}
        catch(e){return null}}))==='a3-portrait');
  // A4縦へ戻す(このあとの検査・後片付けを素直にするため)
  await page.click('#spPvSize input[value="a4-portrait"]');
  await page.waitForTimeout(700);

  /* ---- 17) 画面のまとめを紙にも入れる／申し送りの欄(§9.189) ---- */
  const grouped=await page.evaluate(async()=>{
   /* 画面のまとめを「区分ごと」にして、紙に見出しが入るかを見る。
      **日付ごとにすると紙の頭と同じ文字**になるので出さない決まり
      (§9.129 同じものを2箇所に出さない)——ここでは区分で確かめる。 */
   const sel=document.getElementById('scGroupSelect');
   sel.value='category';sel.dispatchEvent(new Event('change',{bubbles:true}));
   return true;
  });
  await page.waitForTimeout(1200);
  await page.evaluate(()=>WL.schedulePrint.openPreview('テスト設備A'));
  await page.waitForFunction(()=>document.querySelectorAll('.sp-pv-sheet').length>0,null,{timeout:20000});
  await page.waitForTimeout(500);
  const gp=await page.evaluate(()=>({
   見出し:[...document.querySelectorAll('.sp-row-group')].map(n=>n.innerText.replace(/\s+/g,' ')),
   申し送り:document.querySelectorAll('.sp-note').length,
   紙:document.querySelectorAll('.sp-pv-sheet .sp-page').length,
   行:document.querySelectorAll('.sp-page tbody tr[data-row]:not(.sp-row-child)').length,
   件数:(WL.schedulePrint.previewSheets()||[]).reduce((n,p)=>n+(p.rows||[]).length,0),
  }));
  rec('画面のまとめが紙にも見出しとして入る',gp.見出し.length>0,gp.見出し.slice(0,2).join(' / '));
  rec('見出しには件数も出る',gp.見出し.some(t=>/\d+件/.test(t)),gp.見出し[0]||'');
  /* **見出し行を「行」として数えないこと**——数えると、見出しのぶんだけ
     予定が紙から抜け落ちる。 */
  rec('見出しを行として数えていない（予定が抜けない）',gp.行===gp.件数,`${gp.行} / ${gp.件数}`);
  rec('申し送りの欄が紙ごとに付く',gp.申し送り===gp.紙,`${gp.申し送り} / ${gp.紙}枚`);
  await page.click('#spPvOptions [data-opt="commentBox"]');
  await page.waitForTimeout(900);
  rec('外すと申し送りの欄は消える',
      (await page.evaluate(()=>document.querySelectorAll('.sp-note').length))===0);
  await page.click('#spPvOptions [data-opt="commentBox"]');
  await page.waitForTimeout(700);
  await page.evaluate(()=>{const s=document.getElementById('scGroupSelect');
    s.value='none';s.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.waitForTimeout(900);
  await page.evaluate(()=>WL.schedulePrint.closePreview());
  rec('閉じても刷らない（プレビューだけ消える）',
      await page.evaluate(()=>document.getElementById('schedulePrintPreview').hidden
        &&!document.body.classList.contains('sc-print')));

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
  /* 画面の列設定(timeline:テスト設備A)を触っているので必ず元へ戻す
     (残すと次の実行が「前の実行の置き土産」を引き継ぐ。§9.121)。 */
  try{if(savedLayout)await page.evaluate(a=>WL.columnLayout.save(a.t,a.orig),{t:TARGET,orig:savedLayout})}
  catch(e){}
  /* 印刷の好み(用紙・記入欄など)もこの端末に残るので既定へ戻す。 */
  try{await page.evaluate(()=>localStorage.removeItem('SchedulePrintPrefV1'))}catch(e){}
  /* 分割ありの親を入れたので消す(子も一緒に消える)。 */
  try{
   for(const id of made)await page.evaluate(async i=>{
    await fetch('/api/schedule/plan/delete',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:i,user_id:'test-scprint'})});
   },id);
  }catch(e){}
  try{await setMode('edit')}catch(e){}
  if(b)await b.close().catch(()=>{});
 }
})().catch(async e=>{console.error('FATAL',e);if(b)await b.close().catch(()=>{});process.exit(2)});
