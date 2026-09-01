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
 const madeStops=[];     // 足した停止理由マスタ(あとで削除。§9.121)

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

  /* 設定の段（§9.293 ③）。**段の名前で開く**——番号で探すと、段が1つ
     増えただけで直していない網が落ちる。 */
  const openTab=async key=>{
   const bar=await page.$('#spPvTabs');
   if(!bar)return;                       // プレビューを開いていない場面
   await page.click(`[data-pv-tab="${key}"]`);
   await page.waitForTimeout(120);
  };
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
    /* **表が用紙の内寸を食っていないか**（§9.237）。`wide`は表の中しか見て
       いないので、列幅の下限(4mm)の積み上げで表そのものが余白へ食い込んでも
       0のまま——実際に16列A4縦で3.8mm食い込んでいた（右余白8mm→4.2mm）。 */
    tableOver:pgs.filter(p=>{
     const t=p.querySelector('.sp-table');if(!t)return false;
     const s=cs(p);
     const inner=p.getBoundingClientRect().width
       -parseFloat(s.paddingLeft)-parseFloat(s.paddingRight);
     return t.getBoundingClientRect().width>inner+1;
    }).length,
    dataPaper:pgs.map(p=>p.dataset.paper),
    childRows:area.querySelectorAll('.sp-row-child').length,
   };
  },opt);
  const clear=()=>page.evaluate(()=>{const a=document.getElementById('schedulePrintArea');
                                     if(a){a.style.display='';a.innerHTML=''}});

  /* ---- 2) まとめて1つの紙にすると、用紙の高さで切れる ---- */
  /* **通し番号を見る節なので「#」を足した状態で組む**（§9.293 ①で
     印刷専用の列は既定で足さなくなった。番号の約束そのものは変えていない）。 */
  const all=await build({includeDone:true,pageByDate:false,paper:'a4-portrait',printExtras:true});
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
  /* §9.237で「真っ黒(#000)」から画面の本文色(--ink #173842)へそろえた
     ——**要件は「白黒コピーで飛ばない濃さ」**であって、literalの黒では
     ない。相対輝度で見る（黒に見える濃さかどうか）。 */
  const lum=c=>{const m=/rgba?\((\d+), ?(\d+), ?(\d+)/.exec(c||'');
   if(!m)return 1;
   const f=v=>{v=Number(v)/255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};
   return .2126*f(m[1])+.7152*f(m[2])+.0722*f(m[3])};
  rec('文字は黒に見える濃さで刷る（白黒コピーでも飛ばない）',
      all.cellFg.every(c=>lum(c)<=.08),JSON.stringify(all.cellFg));

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
  /* **紙をまたいだ同値比較はやめた**（§9.294 ④）——列の幅を文字に合わせる
     ようになったので、載る行が違えば列の要る幅も違い、そのぶん倍率＝行の
     高さも変わる（それが「余ったぶんを文字へ回す」の中身）。固定したいのは
     **器を伸ばしていないこと**（以前は7件の日で30px→140pxへ4.7倍）なので、
     同じ紙の中で高さが揃っていることと、まとめた紙と桁が違わないことを見る。 */
  const byDayBase=Math.min(...byDay.rowH);
  rec('件数の少ない紙でも行を引き伸ばさない（ページの割り方で倍にならない）',
      byDay.rowH.every(h=>h<=byDayBase*1.6)&&byDayBase<=baseRowH*1.6&&byDayBase>=baseRowH*0.6,
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
   const o={includeDone:true,pageByDate:false,writePattern:'none'};
   const printKeys=WL.schedulePrint.printColumns(o).map(c=>c.key);
   const withExtra=WL.schedulePrint.printColumns({...o,printExtras:true}).map(c=>c.key);
   return {screenKeys,printKeys,withExtra,
           /* §9.293 ①で「#」「状態」は**既定では足さない**（画面と同じ列）。
              足したときだけ先頭に立つ。 */
           tail:withExtra.slice(2,2+screenKeys.length)};
  });
  rec('既定では紙の列が画面の列とそのまま同じ（§9.293 ①）',
      JSON.stringify(mirror.printKeys)===JSON.stringify(mirror.screenKeys),
      JSON.stringify({画面:mirror.screenKeys,紙:mirror.printKeys}));
  rec('印刷専用の「#」「状態」は足したときだけ先頭に立つ',
      mirror.withExtra[0]==='no'&&mirror.withExtra[1]==='state'
      &&JSON.stringify(mirror.tail)===JSON.stringify(mirror.screenKeys),
      JSON.stringify(mirror.withExtra.slice(0,4)));

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
  /* §9.293 ①で印刷専用の列は既定で足さなくなったので、**先頭がそのまま
     画面の先頭のデータ列**になる。 */
  rec('画面で動かした列の並びが紙にもそのまま出る',
      mutated.cols[0]&&mutated.cols[0].key===moveKey,
      `先頭のデータ列=${mutated.cols[0]&&mutated.cols[0].key} / 動かした列=${moveKey}`);
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
     §9.236 ① 列の範囲（見える範囲の列／全ての列）
     利用者の指示「見える範囲の列か、全ての列かを選べるようにして」
     ============================================================ */
  const scopes=await page.evaluate(()=>WL.schedulePrint.columnScopes());
  rec('列の範囲は2通り（見える範囲/全て）',
      scopes.length===2&&scopes.some(s=>s.key==='all')&&scopes.some(s=>s.key==='visible'),
      JSON.stringify(scopes));
  const wide=await page.evaluate(()=>({
   既定:WL.schedulePrint.printColumns({}).map(c=>c.key),
   全て:WL.schedulePrint.printColumns({columnScope:'all'}).map(c=>c.key),
   見える範囲:WL.schedulePrint.printColumns({columnScope:'visible'}).map(c=>c.key),
   /* `printColumns()`は記入欄を末尾へ足すので、その2つを比べても
      「途中の列が抜けているか」は分からない（見える範囲でも記入欄は
      今までどおり無条件で末尾に付く）。画面の列だけを見るには
      `WL.scheduleView`側の素の値で比べる。
      **印刷専用の「#」「状態」は既定で足さない**（§9.293 ①）。 */
   画面の全て:WL.scheduleView.printColumnKeys(),
   画面の見える範囲:WL.scheduleView.visibleColumnKeys(),
  }));
  rec('columnScope未指定の既定は「全ての列」と同じ（既定は今までの見え方のまま）',
      JSON.stringify(wide.既定)===JSON.stringify(wide.全て),JSON.stringify(wide));
  rec('printColumns()のcolumnScopeは画面の列(visibleColumnKeys/printColumnKeys)をそのまま使っている',
      JSON.stringify(wide.全て.slice(0,wide.画面の全て.length))===JSON.stringify(wide.画面の全て)&&
      JSON.stringify(wide.見える範囲.slice(0,wide.画面の見える範囲.length))===JSON.stringify(wide.画面の見える範囲),
      JSON.stringify(wide));
  rec('見える範囲の列は、画面の並びの先頭からの一部（全ての列の件数以下）',
      wide.画面の見える範囲.length<=wide.画面の全て.length&&
      wide.画面の全て.slice(0,wide.画面の見える範囲.length).join(',')===wide.画面の見える範囲.join(','),
      JSON.stringify(wide));
  /* 画面を狭くすると、見える範囲の列も連動して減ることを確かめる
     （「全ての列」は画面幅に関わらず変わらない）。 */
  await page.setViewportSize({width:640,height:1000});
  await page.waitForTimeout(400);
  const narrow=await page.evaluate(()=>({
   全て:WL.schedulePrint.printColumns({columnScope:'all'}).map(c=>c.key),
   見える範囲:WL.schedulePrint.printColumns({columnScope:'visible'}).map(c=>c.key),
  }));
  await page.setViewportSize({width:1700,height:1000});
  await page.waitForTimeout(400);
  rec('画面を狭くすると見える範囲の列も減る（画面の見た目に連動する）',
      narrow.見える範囲.length<wide.見える範囲.length,
      `狭いとき${narrow.見える範囲.length}列 / 広いとき${wide.見える範囲.length}列`);
  rec('「全ての列」は画面幅に関わらず変わらない',
      narrow.全て.join(',')===wide.全て.join(','),
      JSON.stringify({狭いとき:narrow.全て,広いとき:wide.全て}));
  rec('見える範囲の列でも最低1列は残る（画面が極端に狭くても紙が空にならない）',
      narrow.見える範囲.length>=1,String(narrow.見える範囲.length));

  /* ============================================================
     §9.236 ② → §9.292 ⑥ 列幅は画面の比のまま、紙の余りぶんだけ一緒に伸縮
     利用者の指示「列幅も設定したものを活かして」（§9.236）
     利用者の指示「枠のサイズに対してはみ出さない程度に文字サイズを
       できるだけぎりぎりまで大きくしたい」（§9.292 ⑥）

     **§9.236の「収まるならそのまま使う」は撤回した**——列の少ない設備では
     紙の右に何十mmも余り、そのぶん文字が小さいままだった。いまは
     **余っているぶんだけ幅も文字も同じ比率で大きくする**（縮めるときと
     向きが逆になっただけ）。**画面で決めた「この列に何文字入るか」は
     変わらない**——列どうしの比は保たれ、はみ出さないことも変わらない。
     ============================================================ */
  /* 列が少なく(見える範囲)用紙が広い(A3横)ときは、画面の実効px幅の比のまま
     `--sp-fit`ぶんだけ拡大される（用紙いっぱいへ「配り直す」のではない）。 */
  /* **`colFit:'screen'`で見る**（§9.294 ④）——「画面の幅の比のまま」は
     いまや画面の幅を使うと選んだときの約束で、既定（文字に合わせる）では
     成り立たない（列ごとに要る幅が違うので比は変わる。それが目的）。
     文字に合わせる側の約束は下の §9.294 ④ の節が見る。 */
  /* **`padX:'1'`で見る**——ここが確かめたいのは「画面の幅の比のまま倍率ぶん
     だけ」で、左右の余白（既定は「詰める」）は列の必要量から引かれるぶん
     （§9.293 ④）。余白を中立にしておかないと、比の話に余白の話が混ざる
     （余白そのものは上の §9.294 ② の節が見る）。 */
  const naturalOpt={includeDone:true,pageByDate:false,paper:'a3-landscape',columnScope:'visible',
                    colFit:'screen',padX:'1'};
  const naturalBuild=await build(naturalOpt);
  const naturalInfo=await page.evaluate(o=>{
   const pg=document.querySelector('#schedulePrintArea .sp-page');
   const cols=WL.schedulePrint.printColumns(o);
   const mmCols=[...pg.querySelectorAll('colgroup col')].map(c=>parseFloat(c.style.width));
   /* **効いている倍率は紙を組むのと同じ関数に聞く**（§9.163／§9.292 ⑥）
      ——ここで別に計算すると、網が製品と違う約束を固定することになる。 */
   const fit=WL.schedulePrint.fitOf(cols,420-8*2,o);
   const naturalMm=cols.map(c=>Math.round((c.w||60)*25.4/96*fit*10)/10);
   /* **刷り上がりの幅で見る**（§9.237）。宣言した`<col style>`だけを見ると、
      `.sp-table{width:100%}`が余りを各列へ配り直していても素通りする
      ——実際にそうなっており、利用者から「設定した列幅が印刷に反映され
      ない」と報告された。実測pxを画面と同じ96dpiでmmへ直して比べる。 */
   const row=pg.querySelector('tbody tr[data-row]:not(.sp-row-child)');
   const realMm=row?[...row.children].map(td=>
     Math.round(td.getBoundingClientRect().width*25.4/96*10)/10):[];
   const raw=cols.map(c=>(c.w||60)*25.4/96);
   return {mmCols,naturalMm,realMm,fit:Math.round(fit*1000)/1000,
           /* 列どうしの比（1.0なら画面のまま）。狭い列は丸めの影響が大きいので
              広い順の上位だけを見る。 */
           ratios:mmCols.map((v,i)=>raw[i]>10?(v/raw[i])/fit:1)
             .map(r=>Math.round(r*1000)/1000),
           sum:Math.round(mmCols.reduce((s,v)=>s+v,0)*10)/10,usableMm:420-8*2,
           /* 画面の実効px幅と、刷り上がりのpx幅の比（1.0なら設定どおり） */
           ratio:realMm.length&&naturalMm.length
             ?Math.round(realMm.reduce((s,v)=>s+v,0)/naturalMm.reduce((s,v)=>s+v,0)*100)/100:0};
  },naturalOpt);
  /* **許容0.3mm**——「余りいっぱいまで」の倍率では合計がちょうど予算に
     なるので、0.1mm へ丸めた誤差ぶんを`shareMm()`がいちばん広い列から
     引く（紙からはみ出させない保証が優先・§9.237）。0.1mm単位の丸めと
     その引き算を足しても0.3mmを超えない。 */
  rec('列が少なく用紙が広いときは、画面の幅の比のまま倍率ぶんだけ大きくなる（配り直さない）',
      naturalInfo.mmCols.length===naturalInfo.naturalMm.length
      &&naturalInfo.mmCols.every((v,i)=>Math.abs(v-naturalInfo.naturalMm[i])<=.3),
      JSON.stringify({宣言:naturalInfo.mmCols,期待:naturalInfo.naturalMm,倍率:naturalInfo.fit}));
  /* 宣言だけでなく**刷り上がりの1列ずつ**が同じであること（許容0.5mm）。 */
  rec('刷り上がりの列幅そのものが設定どおり（表を用紙いっぱいへ配り直さない）',
      naturalInfo.realMm.length===naturalInfo.naturalMm.length
      &&naturalInfo.realMm.every((v,i)=>Math.abs(v-naturalInfo.naturalMm[i])<=.5),
      JSON.stringify({実測:naturalInfo.realMm,期待:naturalInfo.naturalMm,比:naturalInfo.ratio}));
  /* **列どうしの比は変わらない**——これが「画面で決めた幅を活かす」の中身
     （§9.236）。全体の倍率が変わっても、隣り合う列の幅の比は同じ。 */
  rec('列どうしの幅の比は画面のまま（大きくしても痩せる列を作らない）',
      naturalInfo.ratios.every(r=>Math.abs(r-1)<=.03),
      JSON.stringify(naturalInfo.ratios));
  rec('大きくしても用紙の使える幅を超えない',
      naturalInfo.sum<=naturalInfo.usableMm,
      `表=${naturalInfo.sum}mm / 用紙=${naturalInfo.usableMm}mm`);
  rec('自然な幅でも紙からはみ出さない',naturalBuild.over===0&&naturalBuild.clipped===0&&naturalBuild.wide===0);
  await clear();
  /* 列が多く(全ての列)用紙が狭い(A4縦)ときは、いままでどおり比率で圧縮され、
     紙からはみ出さない（§9.235で固定した既存の保証がそのまま生きている）。 */
  const denseBuild=await build({includeDone:true,pageByDate:false,paper:'a4-portrait',columnScope:'all'});
  rec('列が多くても表そのものが用紙の余白へ食い込まない(§9.237)',
      denseBuild.tableOver===0,String(denseBuild.tableOver));
  rec('列が多く用紙が狭いときは、いままでどおり比率で圧縮されて紙からはみ出さない',
      denseBuild.wide===0&&denseBuild.over===0&&denseBuild.clipped===0,
      JSON.stringify({横:denseBuild.wide,溢れ:denseBuild.over,切れ:denseBuild.clipped}));
  await clear();

  /* ============================================================
     §9.236 ③ 枠線ON/OFF
     利用者の指示「枠線もなくすONOFF機能を追加し…アプリのさわやかな
     見た目をそのまま印刷できるようなイメージに近づけたい」
     ============================================================ */
  const bordersOn=await build({includeDone:true,pageByDate:false,borders:true});
  const onInfo=await page.evaluate(()=>{
   const pg=document.querySelector('#schedulePrintArea .sp-page');
   const td=pg.querySelector('tbody td'),td2=pg.querySelectorAll('tbody tr td')[1];
   const wrap=pg.querySelector('.sp-table-wrap');
   const g=el=>el?getComputedStyle(el):null;
   const cw=g(wrap),c=g(td),c2=g(td2);
   return {dataBorders:pg.dataset.borders||'',
           /* 器の枠と角丸（画面の一覧と同じ「角丸の器」。§9.237） */
           wrapW:cw?parseFloat(cw.borderTopWidth):0,
           wrapRadius:cw?parseFloat(cw.borderTopLeftRadius):0,
           /* 中は「行の下線」と「列と列のあいだ」だけ。上下左の全周は引かない */
           rowLine:c?parseFloat(c.borderBottomWidth):0,
           firstLeft:c?parseFloat(c.borderLeftWidth):0,
           nextLeft:c2?parseFloat(c2.borderLeftWidth):0,
           top:c?parseFloat(c.borderTopWidth):0};
  });
  rec('既定(枠線あり)ではdata-bordersが付かない',onInfo.dataBorders==='',JSON.stringify(onInfo));
  /* §9.237: 「画面の見た目を正に」。**黒い格子ではなく、角丸の器＋細い区切り**
     ——数や有無ではなく実寸で見る（枠が在るだけなら黒い格子でも通る）。 */
  rec('表は角丸の器に入っている（カクカクの黒枠ではない）',
      onInfo.wrapW>0&&onInfo.wrapRadius>=3,JSON.stringify(onInfo));
  rec('セルは全周を囲まず、行の下線と列の区切りだけ',
      onInfo.top===0&&onInfo.firstLeft===0&&onInfo.rowLine>0&&onInfo.nextLeft>0,
      JSON.stringify(onInfo));
  await clear();
  const bordersOff=await build({includeDone:true,pageByDate:false,borders:false});
  const offInfo=await page.evaluate(()=>{
   const pg=document.querySelector('#schedulePrintArea .sp-page');
   const td=pg.querySelector('tbody td'),td2=pg.querySelectorAll('tbody tr td')[1];
   const wrap=pg.querySelector('.sp-table-wrap'),th=pg.querySelector('thead th');
   const g=el=>el?getComputedStyle(el):null;
   const cw=g(wrap),c=g(td),c2=g(td2),ch=g(th);
   const sum=s=>s?['Top','Right','Bottom','Left']
     .reduce((n,k)=>n+(parseFloat(s['border'+k+'Width'])||0),0):0;
   return {dataBorders:pg.dataset.borders||'',
           wrapW:cw?parseFloat(cw.borderTopWidth):0,
           tdBorders:sum(c),td2Borders:sum(c2),thBorders:sum(ch),
           /* 面は残る（線ではないので「枠線を消す」の対象外。§9.237） */
           thBg:ch?ch.backgroundColor:''};
  });
  rec('枠線を外すとdata-borders="off"が付く',offInfo.dataBorders==='off',JSON.stringify(offInfo));
  /* §9.237（利用者の指摘「チェックを外しても薄く残る」）。§9.236の
     「薄い線で残す」は**撤回**した——**本当に0にする**。太さで見ること
     （色で見ると、線が無くても既定の色名が返るので素通りする）。 */
  rec('枠線を外すと表の格子が本当に消える（薄くも残らない）',
      offInfo.wrapW===0&&offInfo.tdBorders===0&&offInfo.td2Borders===0&&offInfo.thBorders===0,
      JSON.stringify(offInfo));
  /* 面（見出しの帯）は残す。ここまで消すと列の並びが読めなくなる。 */
  rec('枠線を外しても見出しの帯（面）は残る',
      !!offInfo.thBg&&offInfo.thBg!=='rgba(0, 0, 0, 0)',JSON.stringify(offInfo));
  rec('枠線を外しても紙からはみ出さない',bordersOff.over===0&&bordersOff.clipped===0);
  await clear();

  /* ============================================================
     §9.237 画面の一覧の見た目を紙でも出す
     利用者の指示「画面印刷の時に映るスケジュール一覧表の見た目を正にして
     その見た目に近づけてほしい」
     ============================================================ */
  const look=await build({includeDone:true,pageByDate:false});
  const lookInfo=await page.evaluate(()=>{
   const pg=document.querySelector('#schedulePrintArea .sp-page');
   const cs=getComputedStyle(pg);
   const th=pg.querySelector('thead th');
   const badges=[...pg.querySelectorAll('tbody .sp-badge')];
   const tone=b=>[...b.classList].filter(c=>c.indexOf('sp-b-')===0).join(',');
   const hue=b=>{const s=getComputedStyle(b);return s.color+'|'+s.backgroundColor+'|'+s.borderLeftColor};
   return {
    /* 背景色を刷る指定（無いとブラウザが印刷時に落とし、帯もバッジも白紙） */
    colorAdjust:(cs.printColorAdjust||cs.webkitPrintColorAdjust||''),
    /* 見出しは折り返さない（§9.90。実機では「用途コ／ード」と2行に割れていた） */
    thWrap:th?getComputedStyle(th).whiteSpace:'',
    thWrapped:th?(th.scrollHeight>th.clientHeight+1):false,
    badgeCount:badges.length,
    /* 状態・可否のバッジが実際に色分けされているか（種類の数で見る） */
    tones:[...new Set(badges.map(tone))].filter(Boolean),
    colors:[...new Set(badges.map(hue))],
    radius:badges.length?parseFloat(getComputedStyle(badges[0]).borderTopLeftRadius):0,
    badgeClass:badges.length?badges[0].className:'',
    radiusRaw:badges.length?getComputedStyle(badges[0]).borderTopLeftRadius:'',
    pillVar:getComputedStyle(document.documentElement).getPropertyValue('--radius-pill').trim(),
    badgeBox:badges.length?(()=>{const r=badges[0].getBoundingClientRect();
      const s=getComputedStyle(badges[0]);
      return Math.round(r.width)+'x'+Math.round(r.height)+' '+s.display+' w'+s.fontWeight})():'',
    radiusRules:badges.length?(()=>{const out=[];
      const walk=rs=>{for(const r of rs){
        if(r.cssRules&&!r.selectorText){walk(r.cssRules);continue}
        if(r.selectorText&&r.style&&r.style.borderTopLeftRadius!==''){
         try{if(badges[0].matches(r.selectorText))
           out.push(r.selectorText+'=>'+r.style.borderTopLeftRadius)}catch(_){}}
      }};
      for(const sh of document.styleSheets){let rs;try{rs=sh.cssRules}catch(_){continue}walk(rs)}
      return out})():[],
   };
  });
  rec('背景色を紙にも刷る指定がある（print-color-adjust）',
      /exact/.test(lookInfo.colorAdjust),JSON.stringify(lookInfo.colorAdjust));
  rec('列の見出しは折り返さない（§9.90と同じ約束）',
      lookInfo.thWrap==='nowrap'&&!lookInfo.thWrapped,JSON.stringify(lookInfo));
  rec('状態・可否は画面と同じバッジで出る',lookInfo.badgeCount>0,String(lookInfo.badgeCount));
  rec('バッジは角丸（カクカクではない）',lookInfo.radius>=3,
      JSON.stringify({半径:lookInfo.radiusRaw,class:lookInfo.badgeClass,pill:lookInfo.pillVar,
                      箱:lookInfo.badgeBox,規則:lookInfo.radiusRules}));
  /* **色の種類を数える**——1色で塗っただけの実装が通らないように
     （画面は可否・区分で色が違う。§3の「色だけで伝えない」は文字側で担保）。 */
  rec('バッジは状態ごとに色が違う（灰色一色ではない）',
      lookInfo.colors.length>=2,JSON.stringify({種類:lookInfo.tones,色:lookInfo.colors}));
  rec('画面の見た目に寄せても紙からはみ出さない',look.over===0&&look.clipped===0);
  /* §9.237: 列幅の下限(4mm)を積み上げても**表が余白へ食い込まない**
     （以前は16列A4縦で3.8mm食い込み、右余白が8mm→4.2mmへ痩せていた）。
     `wide`は表の中しか見ないので、器の内寸と突き合わせる別の網が要る。 */
  rec('表が用紙の余白へ食い込まない（列幅の下限を積んでも）',look.tableOver===0,
      String(look.tableOver));
  await clear();

  /* ---- §9.237 収まらないときは文字も一緒に縮める（幅だけ詰めない） ---- */
  /* 全ての列 × A4縦＝ふつう収まらない組み合わせ／
     見える範囲 × A3横＝ふつう収まる組み合わせ、で見比べる。 */
  await build({includeDone:true,pageByDate:false,columnScope:'all',paper:'a4-portrait'});
  const dense=await page.evaluate(()=>{
   const pg=document.querySelector('#schedulePrintArea .sp-page');
   return {fit:parseFloat(pg.style.getPropertyValue('--sp-fit'))||1,
           td:parseFloat(getComputedStyle(pg.querySelector('tbody td')).fontSize)};
  });
  await clear();
  await build({includeDone:true,pageByDate:false,columnScope:'visible',paper:'a3-landscape'});
  const roomy=await page.evaluate(()=>{
   const pg=document.querySelector('#schedulePrintArea .sp-page');
   return {fit:parseFloat(pg.style.getPropertyValue('--sp-fit'))||1,
           td:parseFloat(getComputedStyle(pg.querySelector('tbody td')).fontSize)};
  });
  await clear();
  /* **§9.292 ⑥で向きが増えた**——収まる組み合わせでは「縮めない」だけでなく
     **余っているぶんだけ大きくする**。縮むことだけは起きない。 */
  rec('収まる組み合わせでは文字を縮めない（余っていれば大きくする）',
      roomy.fit>=1,JSON.stringify(roomy));
  /* **縮めるときは幅だけでなく文字も**（§9.237）。幅の比だけ詰めると、
     同じ文字が入らずに折り返し/切り落としになる（実機で見出しが2行に割れた）。
     ここは「収まらない組み合わせ」でだけ効くので、そうならない環境では
     この1件は素通りしてよい——そのことが分かるよう理由を出す。 */
  rec('収まらないときは文字も一緒に縮む（幅だけ詰めない）',
      dense.fit>=1||dense.td<roomy.td,
      JSON.stringify({狭い:dense,広い:roomy,
                      注:dense.fit>=1?'この環境では全列でもA4縦に収まったため縮小なし':''}));

  /* ============================================================
     §9.235 ② 用紙サイズ・向き（A4/A3 × 縦/横）
     利用者の指示「印刷サイズA4だけでなくA3や縦向きや横向きも選べるように」
     ============================================================ */
  /* ---- 10) 用紙が実寸(mm)どおりCSSへ効いている（§9.252 でB4を追加） ---- */
  const sizes=await page.evaluate(()=>WL.schedulePrint.paperSizes());
  rec('用紙は6通り（A4/B4/A3 × 縦/横）',
      sizes.length===6&&['a4-portrait','a4-landscape','b4-portrait','b4-landscape',
                         'a3-portrait','a3-landscape'].every(k=>sizes.some(s=>s.key===k)),
      JSON.stringify(sizes));
  /* **B4はJIS(257×364mm)**（§9.252）。CSSの`B4`はISO(250×353mm)なので、
     `@page`を名前で頼むと紙だけ小さくなり中身が縮む。ここは寸法そのものを
     見る——「B4という選択肢が在る」だけを見る網では捕まらない。 */
  const b4=sizes.find(s=>s.key==='b4-portrait')||{};
  rec('B4はJIS(257×364mm)で持っている（ISOの250×353ではない）',
      b4.w===257&&b4.h===364,JSON.stringify(b4));
  /* **`@page`は用紙の名前ではなく実寸mmで頼む**（§9.252）。名前で頼むと
     ①用紙を1つ足したときにその用紙だけ既定のA4で刷られ（以前は
     `key.indexOf('a3')===0`で当てていた）②CSSの`B4`はISOなので紙が
     小さくなり中身が縮む。**刷り上がりでしか見えない**ので、規則そのものを
     見る。 */
  const rules=await page.evaluate(ks=>ks.map(k=>WL.schedulePrint.pageRule(k)),
                                  sizes.map(s=>s.key));
  const ruleOk=sizes.every((s,i)=>rules[i]===`@page{size:${s.w}mm ${s.h}mm;margin:0}`);
  rec('@pageは用紙の名前ではなく実寸mmで頼む（全6通り）',ruleOk,JSON.stringify(rules));
  rec('@pageに用紙の名前(A4/B4/A3)を書いていない',
      rules.every(r=>!/\b(A4|A3|B4|Letter)\b/.test(r)),JSON.stringify(rules));
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
     /* §9.237でロット番号のセルには「子N」の印も入るので、**値の側だけ**を
        見る（`textContent`ごと比べると`L9000子2`になって当たらない）。 */
     const v=lot&&(lot.querySelector('.sp-cell-in')||lot);
     return !!v&&v.textContent.trim()==='L9000';
    }),
    /* §9.237: 画面と同じ「子N」の印が紙にも出る（押せないただの印）。
       **紙は何枚にも分かれる**ので、1枚目だけでなく器の全体から探す。 */
    kidBadge:(()=>{const b=document.querySelector('#schedulePrintArea tbody .sp-kid');
      return b?b.textContent.trim():''})(),
   };
  });
  rec('子ロットの番号が「└ 子ロット番号」の形で出る',
      kidsInfo.lots.some(t=>/└ ?L90001/.test(t))&&kidsInfo.lots.some(t=>/└ ?L90002/.test(t)),
      JSON.stringify(kidsInfo.lots));
  rec('子ロットの内訳（条数など）が読める',
      kidsInfo.infos.every(t=>/条/.test(t)),JSON.stringify(kidsInfo.infos));
  rec('親ロットに画面と同じ「子N」の印が付く（§9.237）',
      /^(子\d+|親)$/.test(kidsInfo.kidBadge),JSON.stringify(kidsInfo.kidBadge));
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
   opts:document.querySelectorAll('.sp-pv-side [data-opt]').length,
   optKeys:[...document.querySelectorAll('.sp-pv-side [data-opt]')].map(i=>i.dataset.opt),
   sizeOpts:document.querySelectorAll('#spPvSize .sp-pat').length,
   kindOpts:document.querySelectorAll('#spPaperKinds .sp-pat').length,
   orientOpts:document.querySelectorAll('#spPaperOrients .sp-pat').length,
   scopeOpts:document.querySelectorAll('#spColumnScope .sp-pat').length,
   printBtn:!!document.getElementById('spPvPrint'),
   ask:!!document.querySelector('#appConfirm:not([hidden])'),
  }));
  rec('押すとすぐ紙のプレビューが出る（先に聞かない）',
      pv.sheets>0&&pv.pages===pv.sheets&&!pv.ask,JSON.stringify(pv));
  rec('枚数と用紙サイズを文字で出す',/枚/.test(pv.facts),pv.facts.replace(/\n/g,' / '));
  rec('「分割後の子ロットの情報も載せる」がチェック項目にある(§9.235 ③)',
      pv.optKeys.includes('includeChildren'),JSON.stringify(pv.optKeys));
  rec('「枠線を出す」がチェック項目にある(§9.236 ③)',
      pv.optKeys.includes('borders'),JSON.stringify(pv.optKeys));
  /* **掛け算で並べない**（§9.252）——大きさ3＋向き2＝5枚。掛け合わせると
     用紙を1つ足すたびに札が2枚増える（B4を足した時点で8枚になっていた）。 */
  rec('用紙は「大きさ3枚＋向き2枚」に分かれて並ぶ(§9.252)',
      pv.sizeOpts===5&&pv.kindOpts===3&&pv.orientOpts===2,
      JSON.stringify({計:pv.sizeOpts,大きさ:pv.kindOpts,向き:pv.orientOpts}));
  rec('列の範囲の選択肢が2つ並ぶ(§9.236 ①)',pv.scopeOpts===2,String(pv.scopeOpts));
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
  await page.click('.sp-pv-side [data-opt="pageByDate"]');
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
  await page.click('.sp-pv-side [data-opt="pageByDate"]');   // 元へ戻す
  await page.waitForTimeout(400);

  /* ---- 14b) 列の範囲・枠線もその場でプレビューに効く(§9.236) ---- */
  const colsBefore=await page.evaluate(()=>
    (document.querySelector('.sp-pv-sheet .sp-page')||{}).querySelectorAll?.('thead th').length||0);
  await openTab('look');
  await page.click('#spColumnScope input[value="visible"]');
  await page.waitForTimeout(700);
  const colsAfterVisible=await page.evaluate(()=>
    (document.querySelector('.sp-pv-sheet .sp-page')||{}).querySelectorAll?.('thead th').length||0);
  rec('「見える範囲の列だけ」を選ぶとその場で列数が減る',
      colsAfterVisible<colsBefore&&colsAfterVisible>0,`${colsBefore}列 → ${colsAfterVisible}列`);
  await openTab('look');
  await page.click('#spColumnScope input[value="all"]');      // 元へ戻す
  await page.waitForTimeout(700);
  const bordersBefore=await page.evaluate(()=>
    (document.querySelector('.sp-pv-sheet .sp-page')||{}).dataset?.borders||'');
  await openTab('look');
  await page.click('.sp-pv-side [data-opt="borders"]');
  await page.waitForTimeout(700);
  const bordersAfter=await page.evaluate(()=>
    (document.querySelector('.sp-pv-sheet .sp-page')||{}).dataset?.borders||'');
  rec('「枠線を出す」を外すとその場でdata-borders="off"になる',
      bordersBefore===''&&bordersAfter==='off',JSON.stringify({前:bordersBefore,後:bordersAfter}));
  await openTab('look');
  await page.click('.sp-pv-side [data-opt="borders"]');      // 元へ戻す
  await page.waitForTimeout(700);

  /* ---- 15) 「分割後の子ロットの情報も載せる」もプレビューへその場で効く ---- */
  const kidsOff=await page.evaluate(()=>document.querySelectorAll('.sp-page .sp-row-child').length);
  rec('既定ではプレビューにも子ロットの行が出ない',kidsOff===0,String(kidsOff));
  await openTab('load');
  await page.click('.sp-pv-side [data-opt="includeChildren"]');
  await page.waitForFunction(()=>document.querySelectorAll('.sp-page .sp-row-child').length>0,
    null,{timeout:15000}).catch(()=>{});
  const kidsOn=await page.evaluate(()=>document.querySelectorAll('.sp-page .sp-row-child').length);
  rec('チェックすると子ロットの行がその場で出る',kidsOn>0,String(kidsOn));
  await openTab('load');
  await page.click('.sp-pv-side [data-opt="includeChildren"]');
  await page.waitForTimeout(400);

  /* ---- 16) 用紙サイズを選ぶとその場でプレビューの紙が変わる ---- */
  const beforePaper=await page.evaluate(()=>{
   const pg=document.querySelector('.sp-pv-sheet .sp-page');
   return {paper:pg?pg.dataset.paper:'',minH:pg?parseFloat(getComputedStyle(pg).minHeight):0};
  });
  /* 大きさと向きは**別の欄**（§9.252）。まず大きさだけを選ぶ。 */
  const waitPaper=async k=>page.waitForFunction(want=>{
   const pg=document.querySelector('.sp-pv-sheet .sp-page');
   return pg&&pg.dataset.paper===want;
  },k,{timeout:15000}).catch(()=>{});
  const paperNow=()=>page.evaluate(()=>{
   const pg=document.querySelector('.sp-pv-sheet .sp-page');
   return {paper:pg?pg.dataset.paper:'',minH:pg?parseFloat(getComputedStyle(pg).minHeight):0};
  });
  await openTab('paper');
  await page.click('#spPaperKinds input[value="a3"]');
  await waitPaper('a3-portrait');
  const afterPaper=await paperNow();
  rec('大きさを選ぶとその場でプレビューの紙が変わる',
      afterPaper.paper==='a3-portrait'&&afterPaper.minH>beforePaper.minH,
      JSON.stringify({前:beforePaper,後:afterPaper}));
  rec('選んだ用紙は端末に残る',
      (await page.evaluate(()=>{try{return JSON.parse(localStorage.getItem('SchedulePrintPrefV1')||'{}').paper}
        catch(e){return null}}))==='a3-portrait');
  /* **向きだけを変えても大きさは残る**（§9.252。片方だけ選び直したときに
     もう片方が既定へ落ちると、選び直すたびに元へ戻る）。 */
  await page.click('#spPaperOrients input[value="landscape"]');
  await waitPaper('a3-landscape');
  const turned=await paperNow();
  rec('向きだけを変えても大きさは残る（A3のまま横になる）',
      turned.paper==='a3-landscape',JSON.stringify(turned));
  /* **B4も実際に紙が変わる**——選択肢が並ぶだけでは、CSSの規則を足し忘れて
     いても通る（幅がA4のまま出る）。 */
  await openTab('paper');
  await page.click('#spPaperKinds input[value="b4"]');
  await waitPaper('b4-landscape');
  const b4Now=await page.evaluate(()=>{
   const pg=document.querySelector('.sp-pv-sheet .sp-page');
   const cs=pg?getComputedStyle(pg):null;
   return {paper:pg?pg.dataset.paper:'',
           w:cs?Math.round(parseFloat(cs.width)/96*25.4):0,
           h:cs?Math.round(parseFloat(cs.minHeight)/96*25.4):0,
           note:(document.getElementById('spPaperNow')||{}).textContent||''};
  });
  rec('B4を選ぶと紙がJISのB4横(364×257mm)になる',
      b4Now.paper==='b4-landscape'&&b4Now.w===364&&b4Now.h===257,JSON.stringify(b4Now));
  /* **刷れる範囲まで文字で出す**（§CLAUDE 6。余白を引く暗算をさせない）。 */
  rec('いまの用紙と刷れる範囲を文字で出す',
      /B4 横/.test(b4Now.note)&&/364×257mm/.test(b4Now.note)&&/348×241mm/.test(b4Now.note),
      b4Now.note.replace(/\s+/g,' ').slice(0,120));
  // A4縦へ戻す(このあとの検査・後片付けを素直にするため)
  await openTab('paper');
  await page.click('#spPaperKinds input[value="a4"]');
  await page.click('#spPaperOrients input[value="portrait"]');
  await waitPaper('a4-portrait');
  await page.waitForTimeout(400);

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
  /* §9.237: まとまりの帯は**画面の`.sc-group-head`と同じ3点**（名前・
     どの日付で数えているか・件数）で、濃い灰色のベタ帯ではない。 */
  const band=await page.evaluate(()=>{
   const g=document.querySelector('.sp-pv-sheet .sp-row-group');
   const td=g&&g.querySelector('td');
   return {label:!!(g&&g.querySelector('.sp-group-label')),
           basis:((g&&g.querySelector('.sp-group-basis'))||{}).textContent||'',
           count:!!(g&&g.querySelector('.sp-group-count')),
           bg:td?getComputedStyle(td).backgroundColor:'',
           accent:td?parseFloat(getComputedStyle(td).borderLeftWidth):0};
  });
  rec('まとまりの帯は名前と件数を持つ(§9.237)',band.label&&band.count,JSON.stringify(band));
  rec('まとまりの帯は濃い灰色のベタ帯ではない（画面に近い淡い面＋左の色帯）',
      band.bg!=='rgb(216, 216, 216)'&&band.accent>0,JSON.stringify(band));
  /* 「現場歴／太陽暦」の印は**日付でまとめているときだけ**（画面の
     `groupHeadHtml`も同じ。区分でまとめているときは日付を数えていないので
     出ない）。日付でまとめ、かつ紙を日付で分けない形にして確かめる
     ——分けると見出しが紙の頭と同じ文字になって出ない決まり（§9.129）。 */
  await page.evaluate(()=>{const sel=document.getElementById('scGroupSelect');
   sel.value='dateshift';sel.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.waitForTimeout(1200);
  await page.evaluate(()=>WL.schedulePrint.openPreview('テスト設備A'));
  await page.waitForFunction(()=>document.querySelectorAll('.sp-pv-sheet').length>0,null,{timeout:20000});
  const wasByDate=await page.evaluate(()=>
    !!document.querySelector('#spPvOptions [data-opt="pageByDate"]')?.checked);
  if(wasByDate){await openTab('load');await page.click('#spPvOptions [data-opt="pageByDate"]');await page.waitForTimeout(900)}
  const basis=await page.evaluate(()=>{
   const g=document.querySelector('.sp-pv-sheet .sp-row-group');
   return {basis:((g&&g.querySelector('.sp-group-basis'))||{}).textContent||'',
           label:((g&&g.querySelector('.sp-group-label'))||{}).textContent||'',
           mode:WL.scheduleView.groupBasis()};
  });
  rec('日付でまとめたときは「現場歴／太陽暦」の印も紙に出る(§9.237)',
      /現場歴|太陽暦/.test(basis.basis),JSON.stringify(basis));
  if(wasByDate){await openTab('load');await page.click('#spPvOptions [data-opt="pageByDate"]');await page.waitForTimeout(700)}
  await page.evaluate(()=>{const sel=document.getElementById('scGroupSelect');
   sel.value='category';sel.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.waitForTimeout(1000);
  await page.evaluate(()=>WL.schedulePrint.openPreview('テスト設備A'));
  await page.waitForFunction(()=>document.querySelectorAll('.sp-pv-sheet').length>0,null,{timeout:20000});
  await page.waitForTimeout(400);
  /* **見出し行を「行」として数えないこと**——数えると、見出しのぶんだけ
     予定が紙から抜け落ちる。 */
  rec('見出しを行として数えていない（予定が抜けない）',gp.行===gp.件数,`${gp.行} / ${gp.件数}`);
  rec('申し送りの欄が紙ごとに付く',gp.申し送り===gp.紙,`${gp.申し送り} / ${gp.紙}枚`);
  await openTab('look');
  await page.click('.sp-pv-side [data-opt="commentBox"]');
  await page.waitForTimeout(900);
  rec('外すと申し送りの欄は消える',
      (await page.evaluate(()=>document.querySelectorAll('.sp-note').length))===0);
  await openTab('look');
  await page.click('.sp-pv-side [data-opt="commentBox"]');
  await page.waitForTimeout(700);
  await page.evaluate(()=>{const s=document.getElementById('scGroupSelect');
    s.value='none';s.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.waitForTimeout(900);
  /* ============================================================
     §9.238 ③ 表示倍率 ／ ④ メニューの再構成
     利用者の指示:
      「プレビューを幅に合わせて、縦に合わせて、100%、など表示のスケール
       調整も含めて調整できるようにしてください」
      「使えないメニューも混在しているので…再構成して必要な機能は追加実装、
       使えない不要な機能は整理してください」
     ============================================================ */
  /* ---- 18) 表示倍率の帯があり、選ぶと実際に見え方が変わる ---- */
  await page.evaluate(()=>WL.schedulePrint.openPreview('テスト設備A'));
  await page.waitForFunction(()=>document.querySelectorAll('.sp-pv-sheet').length>0,null,{timeout:20000});
  await page.waitForTimeout(600);
  const zoomBar=await page.evaluate(()=>{
   const bar=document.getElementById('spPvZoom');
   return {ある:!!bar&&!!bar.offsetParent,
           段:[...document.querySelectorAll('#spPvZoom [data-zoom]')].map(b=>b.dataset.zoom),
           いま:(document.getElementById('spPvZoomNow')||{}).textContent||'',
           /* 倍率は**刷り上がりの設定とは別の場所**に置く（同じ欄に置くと
              「100%で刷られる」と読まれる）。 */
           左の欄にない:!document.querySelector('.sp-pv-side #spPvZoom')};
  });
  rec('表示倍率の帯が紙の側にある',zoomBar.ある&&zoomBar.左の欄にない,JSON.stringify(zoomBar));
  rec('「幅」「縦」「100%」「全体」が選べる',
      ['fit','width','height','actual'].every(k=>zoomBar.段.includes(k)),JSON.stringify(zoomBar.段));
  rec('いまの倍率を%で出す',/%$/.test(zoomBar.いま.trim()),zoomBar.いま);

  /* **実際に見え方が変わることまで見る**——ボタンが在ることだけを見る網は、
     押しても何も起きない実装を素通りさせる。器の幅・高さと突き合わせる。 */
  const zoomOf=()=>page.evaluate(()=>{
   const paper=document.getElementById('spPvPaper');
   const pg=document.querySelector('.sp-pv-sheet .sp-page');
   const box=pg?pg.closest('.sp-pv-scale'):null;
   return {zoom:Number(getComputedStyle(paper).getPropertyValue('--sp-zoom'))||1,
           器W:paper.clientWidth,器H:paper.clientHeight,
           紙W:box?box.clientWidth:0,紙H:box?box.clientHeight:0,
           素のW:pg?pg.offsetWidth:0,素のH:pg?pg.offsetHeight:0};
  });
  await page.click('#spPvZoom [data-zoom="width"]');
  await page.waitForTimeout(500);
  const zw=await zoomOf();
  rec('「幅」を選ぶと紙の横幅が器いっぱいになる',
      Math.abs(zw.紙W-(zw.器W-24))<=3,JSON.stringify(zw));
  await page.click('#spPvZoom [data-zoom="height"]');
  await page.waitForTimeout(500);
  const zh=await zoomOf();
  rec('「縦」を選ぶと紙の高さが器いっぱいになる',
      Math.abs(zh.紙H-(zh.器H-56))<=3,JSON.stringify(zh));
  await page.click('#spPvZoom [data-zoom="actual"]');
  await page.waitForTimeout(500);
  const za=await zoomOf();
  rec('「100%」は実寸で出す',Math.abs(za.zoom-1)<0.001&&Math.abs(za.紙W-za.素のW)<=2,JSON.stringify(za));
  /* ＋／−で1段ずつ動く（100%からは下がる／上がる）。 */
  await page.click('#spPvZoom [data-zoom-step="-1"]');
  await page.waitForTimeout(400);
  const zminus=await zoomOf();
  rec('−で1段小さくなる',zminus.zoom<za.zoom&&zminus.zoom>0.2,JSON.stringify(zminus));
  await page.click('#spPvZoom [data-zoom-step="1"]');
  await page.waitForTimeout(400);
  const zplus=await zoomOf();
  rec('＋で1段大きくなる',zplus.zoom>zminus.zoom,JSON.stringify(zplus));
  /* **倍率は刷り上がりを変えない**（見え方だけ）。枚数・列数が動かないこと。 */
  const sameSheets=await page.evaluate(()=>({
   枚:document.querySelectorAll('.sp-pv-sheet').length,
   列:(document.querySelector('.sp-pv-sheet .sp-page')||{}).querySelectorAll?.('thead th').length||0}));
  await page.click('#spPvZoom [data-zoom="fit"]');
  await page.waitForTimeout(500);
  const stillSame=await page.evaluate(()=>({
   枚:document.querySelectorAll('.sp-pv-sheet').length,
   列:(document.querySelector('.sp-pv-sheet .sp-page')||{}).querySelectorAll?.('thead th').length||0}));
  rec('倍率を変えても刷り上がり（枚数・列数）は変わらない',
      sameSheets.枚===stillSame.枚&&sameSheets.列===stillSame.列,
      JSON.stringify({前:sameSheets,後:stillSame}));
  rec('選んだ倍率は端末に残る',
      (await page.evaluate(()=>{try{return JSON.parse(localStorage.getItem('SchedulePrintPrefV1')||'{}').zoomMode}
        catch(e){return null}}))==='fit');

  /* ---- 19) メニューは決める理由ごとの段になっている(§9.238 ④ → §9.293 ③) ----
     利用者の指示「印刷のメニューがかなり複雑になってきたので、タブ、
     アコーディオン、ポップオーバーメニューなどを駆使して階層化し
     わかりやすく使いやすく改良再構築してほしい」。
     §9.238 ④の4節を縦に積むと2画面ぶんになったので、3段（タブ）へ。
     **確かめるのは札が並ぶことではなく、開いている段だけが見えること**と、
     **段の見出しにいまの値が出ていること**（開かないと分からない段を作らない）。 */
  const menu=await page.evaluate(()=>{
   const tabs=[...document.querySelectorAll('#spPvTabs .sp-pv-tab')].map(b=>({
    key:b.dataset.pvTab,name:(b.querySelector('b')||{}).textContent||'',
    now:(b.querySelector('small')||{}).textContent||'',on:b.classList.contains('is-on')}));
   const vis=id=>{const e=document.getElementById(id);
    return !!(e&&e.getBoundingClientRect().height>0)};
   return {段:tabs,
           載せるもの:[...document.querySelectorAll('#spPvOptions [data-opt]')].map(i=>i.dataset.opt),
           見せ方:[...document.querySelectorAll('#spPvLook [data-opt]')].map(i=>i.dataset.opt),
           用紙:!!document.querySelector('#spPvSize .sp-pat'),
           見えている:{load:vis('spPvOptions'),look:vis('spPvLook'),paper:vis('spPvSize')},
           既定へ戻す:!!document.getElementById('spPvReset'),
           枚数:!!document.getElementById('spPvFacts')};
  });
  rec('段は「載せるもの／見せ方／用紙」の3つ',
      menu.段.map(t=>t.key).join(',')==='load,look,paper',JSON.stringify(menu.段.map(t=>t.name)));
  /* **`undefined`が混ざっていないこと**まで見る（一言が壊れていても
     「文字がある」だけの網は通る。実際に`undefined列`と出ていた）。 */
  rec('段の見出しにいまの値が出ている（開かないと分からない段を作らない）',
      menu.段.every(t=>t.now.trim().length>0&&!/undefined|NaN/.test(t.now)),
      JSON.stringify(menu.段.map(t=>t.now)));
  rec('開いている段だけが見えている（縦に積まない）',
      Object.values(menu.見えている).filter(Boolean).length===1,JSON.stringify(menu.見えている));
  /* 見出しと中身が合っていること——以前は「何を載せるか」の中に用紙以外の
     すべて（列・枠線・記入欄）が入っており、見出しが嘘をついていた。 */
  rec('「載せるもの」には中身の話だけが入っている',
      menu.載せるもの.every(k=>['allEquipment','includeDone','includeChildren','useGroups','pageByDate'].includes(k))
      &&menu.載せるもの.length===5,JSON.stringify(menu.載せるもの));
  rec('「見せ方」には枠線と申し送り欄が入っている',
      menu.見せ方.includes('borders')&&menu.見せ方.includes('commentBox'),JSON.stringify(menu.見せ方));
  /* 枚数と「既定へ戻す」は**段の外**（どの段からでも読める・触れる）。 */
  rec('枚数と「既定へ戻す」はどの段からでも見える',
      menu.既定へ戻す&&menu.枚数&&!!(await page.evaluate(()=>{
       const s=document.querySelector('.sp-pv-sum');
       return !!(s&&s.getBoundingClientRect().height>0);
      })),JSON.stringify({既定へ戻す:menu.既定へ戻す,枚数:menu.枚数}));
  /* 段を切り替えたら中身も入れ替わり、覚えている。 */
  await openTab('paper');
  const swapped=await page.evaluate(()=>({
   look:!!(document.getElementById('spPvLook')||{}).getBoundingClientRect
     &&document.getElementById('spPvLook').getBoundingClientRect().height>0,
   paper:document.getElementById('spPvSize').getBoundingClientRect().height>0,
   kept:(()=>{try{return JSON.parse(localStorage.getItem('SchedulePrintPrefV1')||'{}').tab}catch(e){return ''}})(),
  }));
  rec('段を切り替えると中身が入れ替わり、開いていた段を覚える',
      swapped.paper&&!swapped.look&&swapped.kept==='paper',JSON.stringify(swapped));
  await openTab('load');

  /* ---- 20) いま効かない設定は押せなくして理由を書く(§4) ---- */
  /* 「すべての設備」は、検証用フィクスチャの設備が1台なら押せない。
     **押せる/押せないの一方だけを見ないこと**——どちらの道も通す。 */
  await openTab('load');
  const offs=await page.evaluate(()=>[...document.querySelectorAll('.sp-pv-side .sp-opt.is-off')]
    .map(l=>({key:(l.querySelector('[data-opt]')||{}).dataset?.opt||'',
              理由:(l.querySelector('.sp-opt-why')||{}).textContent||'',
              押せない:!!(l.querySelector('input')||{}).disabled})));
  rec('押せない設定には必ず理由が書いてある',
      offs.every(o=>o.理由.length>0&&o.押せない),JSON.stringify(offs));
  /* 「まとめ」は画面を「まとめない」に戻してあるので、必ず押せない側に居る。 */
  rec('画面が「まとめない」なら、まとめの見出しは押せず理由が出る',
      offs.some(o=>o.key==='useGroups'),JSON.stringify(offs.map(o=>o.key)));
  /* 逆に、効く設定は押せたまま（全部を塞いでいない）。 */
  /* **段をまたいで数える**——`borders`と`commentBox`は「見せ方」の段に居る。 */
  const live=await page.evaluate(()=>[...document.querySelectorAll('.sp-pv-side [data-opt]')]
    .filter(i=>!i.disabled).map(i=>i.dataset.opt));
  rec('効く設定は今までどおり押せる',live.includes('borders')&&live.includes('commentBox'),
      JSON.stringify(live));

  /* ---- 21) 印刷範囲を指定できる(§9.292 ①) ----
     利用者の指示「スケジュール印刷範囲の指定ができるようにしてください」。
     §9.291 ②で予定が何ヶ月先まででも並ぶようになったので、全部刷ると紙が
     何十枚にもなる。**確かめるのは札が並ぶことではなく、紙になる行が
     実際に減ること**——札だけを見る網は、1件も絞らない実装でも通る。 */
  {
   const seam=await page.evaluate(()=>({
    modes:(WL.schedulePrint.rangeModes?.()||[]).map(r=>r.key),
    apply:typeof WL.schedulePrint.applyRange,
    picked:typeof WL.scheduleView.pickedIds,
   }));
   rec('印刷範囲は3つ（すべて／日付／選んだぶん）で、画面から数えられる',
       seam.modes.join(',')==='all,date,picked'&&seam.apply==='function'
       &&seam.picked==='function',JSON.stringify(seam));

   /* 素の状態で開く。**既定は`all`＝今までどおり全部**（設定を触っていない
      現場の刷り上がりを黙って変えない）。 */
   await page.evaluate(()=>localStorage.removeItem('SchedulePrintPrefV1'));
   await page.evaluate(e=>WL.schedulePrint.openPreview(e),EQ);
   await page.waitForSelector('#spRange',{timeout:15000});
   await page.waitForFunction(()=>(WL.schedulePrint.previewSheets()||[]).length>0,null,{timeout:20000});
   const rowsOf=()=>page.evaluate(()=>(WL.schedulePrint.previewSheets()||[])
     .reduce((s,x)=>s+x.rows.length,0));
   const base=await rowsOf();
   const first=await page.evaluate(()=>({
    on:document.querySelector('#spRange input:checked')?.value,
    note:document.getElementById('spRangeNote')?.textContent||'',
    days:!document.getElementById('spRangeFrom'),
   }));
   rec('既定は「いまの表示範囲ぜんぶ」で、日付の欄は出ていない',
       first.on==='all'&&first.days&&base>0,JSON.stringify({...first,base}));
   rec('刷る件数を文字で出す（絞れているのか予定が少ないのかが読める）',
       /\d+\s*件/.test(first.note),first.note.slice(0,80));

   /* 日付で絞る。**空欄のまま「絞る」にしない**——押しても何も変わらない
      のは壊れて見えるので、いま出ている最初と最後の日を入れておく。 */
   await openTab('load');
   await page.click('#spRange input[value="date"]');
   await page.waitForSelector('#spRangeFrom',{timeout:8000});
   await page.waitForFunction(n=>(WL.schedulePrint.previewSheets()||[])
     .reduce((s,x)=>s+x.rows.length,0)===n,base,{timeout:15000}).catch(()=>{});
   const full=await page.evaluate(()=>({
    from:document.getElementById('spRangeFrom').value,
    to:document.getElementById('spRangeTo').value,
    opts:[...document.getElementById('spRangeFrom').options].map(o=>o.value),
   }));
   rec('「日付で絞る」へ切り替えると、実際にある日が入っている',
       !!full.from&&!!full.to&&full.opts.length>0&&full.opts.includes(full.from)
       &&full.opts.includes(full.to),JSON.stringify(full));
   rec('日付は打たせず、予定のある日から選ぶ（無い日・逆さまの範囲を作れない）',
       await page.evaluate(()=>{
        const f=document.getElementById('spRangeFrom');
        return f&&f.tagName==='SELECT';
       }));
   const rowsFull=await rowsOf();
   rec('範囲を目いっぱいにすると「ぜんぶ」と同じ件数',rowsFull===base,
       JSON.stringify({base,rowsFull}));

   /* **狭めたら紙の行が減ること**——ここがこの機能の本体。
      日が1つしか無いフィクスチャでも確かめられるよう、日が2つ以上の
      ときだけ日付で狭め、そうでなければ「選んだ予定だけ」で確かめる。 */
   if(full.opts.length>1){
    await openTab('load');
   await page.selectOption('#spRangeTo',full.opts[0]);
    await page.waitForFunction(n=>(WL.schedulePrint.previewSheets()||[])
      .reduce((s,x)=>s+x.rows.length,0)<n,base,{timeout:15000}).catch(()=>{});
    const narrowed=await rowsOf();
    const note=await page.evaluate(()=>document.getElementById('spRangeNote')?.textContent||'');
    rec('日付を狭めると紙になる行が実際に減る',narrowed>0&&narrowed<base,
        JSON.stringify({base,narrowed}));
    rec('絞ったことは「N件中M件」と文字で出る',note.includes(String(narrowed)),
        note.slice(0,90));
    /* **逆さまの範囲は作らせない**（掴んだほうを正として、もう一方を合わせる）。 */
    const flipped=await page.evaluate(()=>({
     from:document.getElementById('spRangeFrom').value,
     to:document.getElementById('spRangeTo').value,
    }));
    rec('「この日から」が「この日まで」を追い越さない',flipped.from<=flipped.to,
        JSON.stringify(flipped));
   }else{
    rec('日付を狭めると紙になる行が実際に減る',true,'この設備の予定が1日ぶんしかないので、選んだ予定だけで確かめる');
    rec('絞ったことは「N件中M件」と文字で出る',true,'同上');
    rec('「この日から」が「この日まで」を追い越さない',true,'同上');
   }

   /* 「選んだ予定だけ」。**選んでいなければ押せなくして理由を書く**（§4）。 */
   const noPick=await page.evaluate(()=>{
    const i=document.querySelector('#spRange input[value="picked"]');
    return {off:!!i.disabled,why:(i.closest('.sp-pat')?.querySelector('small')?.textContent||'')};
   });
   rec('何も選んでいなければ「選んだ予定だけ」は押せず、理由が出る',
       noPick.off&&noPick.why.length>0,JSON.stringify(noPick));

   /* 実際に1件選んでから、その1件だけが紙になることを見る。 */
   const pickable=await page.evaluate(()=>{
    const boxes=[...document.querySelectorAll('.sc-row-line .sc-pick-check')];
    return boxes.length;
   });
   if(pickable>0){
    await page.evaluate(()=>{
     const box=document.querySelector('.sc-row-line .sc-pick-check');
     if(box&&!box.checked)box.click();
    });
    await page.evaluate(e=>WL.schedulePrint.openPreview(e),EQ);
    await page.waitForSelector('#spRange',{timeout:15000});
    await page.waitForFunction(()=>(WL.schedulePrint.previewSheets()||[]).length>0,null,{timeout:20000});
    await openTab('load');
   await page.click('#spRange input[value="picked"]');
    await page.waitForFunction(()=>(WL.schedulePrint.previewSheets()||[])
      .reduce((s,x)=>s+x.rows.length,0)===1,null,{timeout:15000}).catch(()=>{});
    const one=await rowsOf();
    rec('「選んだ予定だけ」にすると、選んだ1件だけが紙になる',one===1,
        JSON.stringify({one,base}));
    await page.evaluate(()=>{
     const box=document.querySelector('.sc-row-line .sc-pick-check:checked');
     if(box)box.click();
    });
   }else{
    rec('「選んだ予定だけ」にすると、選んだ1件だけが紙になる',true,
        'この画面に選べる予定（未着手の親）がない');
   }

   /* **左の欄からはみ出さない**（日付の文字列は長い）。 */
   const fit=await page.evaluate(()=>{
    const side=document.querySelector('.sp-pv-side');
    const sels=[...document.querySelectorAll('.sp-range-day')];
    return {sideOver:side.scrollWidth>side.clientWidth+1,
            selOver:sels.filter(s=>s.getBoundingClientRect().right
              >side.getBoundingClientRect().right+1).length};
   });
   rec('印刷範囲の欄が左のペインからはみ出さない',!fit.sideOver&&!fit.selOver,
       JSON.stringify(fit));

   await page.evaluate(()=>{localStorage.removeItem('SchedulePrintPrefV1')});
  }

  /* ---- 21b) 紙の列は画面と同じ（§9.293 ①、利用者の報告） ----
     「作業スケジュールの表示内容と印刷内容が違います。設定は今の表示内容
      全部にしていますが、表示していない内容まで出ています」

     §9.235で「#」「状態」を紙にだけ足していた。理由（現場が番号で行を指す・
     白黒コピーで色分けが消える）はいまも正しいが、**既定で足すのは間違い**
     ——「画面の見た目が正」（§9.237）と言いながら画面に無い列を黙って
     2本増やしていた。いまは入切でき、**既定は足さない**。

     **確かめるのは札ではなく、紙の見出しそのもの**——設定が在るだけを見る
     網は、紙が変わらなくても通る。 */
  {
   await page.evaluate(()=>localStorage.removeItem('SchedulePrintPrefV1'));
   const headsOf=o=>page.evaluate(x=>{
    const groups=WL.schedulePrint.buildPages('テスト設備A',WL.scheduleView.entries(),x);
    const sheets=WL.schedulePrint.splitToSheets(groups,x);
    let area=document.getElementById('schedulePrintArea');
    if(!area){area=document.createElement('div');area.id='schedulePrintArea';
              area.className='sp-print-area';document.body.appendChild(area)}
    area.innerHTML=WL.schedulePrint.pageHtml(sheets[0],x,1,sheets.length);
    area.style.display='block';
    const h=[...area.querySelectorAll('.sp-page thead th')].map(t=>t.textContent.trim());
    area.innerHTML='';area.style.display='';
    return h;
   },o);
   const base={includeDone:true,pageByDate:false,paper:'a4-portrait',columnScope:'all',
               writePattern:'none',range:'all'};
   const plain=await headsOf(base);
   const extra=await headsOf({...base,printExtras:true});
   const screen=await page.evaluate(()=>({
    keys:WL.scheduleView.printColumnKeys(),
    labels:WL.scheduleView.printColumnKeys().map(k=>WL.scheduleView.columnLabelOf(k)),
   }));
   rec('既定では紙の列が画面の列とそのまま同じ（#・状態を足さない）',
       plain.join('|')===screen.labels.join('|'),
       JSON.stringify({紙:plain.slice(0,6),画面:screen.labels.slice(0,6),
                       紙の数:plain.length,画面の数:screen.labels.length}));
   rec('「#」「状態」は足したいときだけ足せる（理由があるので消さない）',
       extra.length===plain.length+2&&extra[0]==='#'&&extra[1]==='状態',
       JSON.stringify(extra.slice(0,4)));
  }

  /* ---- 22) 紙の文字を枠ぎりぎりまで大きく／セルの余白（§9.292 ⑥・§9.293 ②） ----
     利用者の指示「枠に対して文字が小さすぎて非常に見にくいです。カラムも
     含めて、枠のサイズに対してはみ出さない程度に文字サイズをできるだけ
     ぎりぎりまで大きくしたいです。ベースサイズを大きめの設定で変更した
     うえで、印刷時の文字サイズやセル内の余白の調整＆設定保存ができる
     ようにしてください」

     **確かめるのは札が並ぶことではなく、刷り上がりの文字が実際に大きく
     なること**——`--sp-fit`の宣言値だけを見る網は、CSSが読んでいなくても通る
     （§9.289と同じ罠）。描いた`<td>`の解決値を測る。 */
  {
   await page.evaluate(()=>localStorage.removeItem('SchedulePrintPrefV1'));
   const seam=await page.evaluate(()=>({
    fs:(WL.schedulePrint.fontScales?.()||[]).map(x=>x.key),
    padX:(WL.schedulePrint.padXs?.()||[]).map(x=>x.key),
    padY:(WL.schedulePrint.padYs?.()||[]).map(x=>x.key),
    day:(WL.schedulePrint.dayGaps?.()||[]).map(x=>x.key),
    colFit:(WL.schedulePrint.colFits?.()||[]).map(x=>x.key),
    fit:typeof WL.schedulePrint.fitOf,font:typeof WL.schedulePrint.fontOf,
    /* 既定（§9.294 ⑤⑥、利用者の指示「文字サイズ『大』がベースにしたい」
       「余白『詰める』＋文字サイズ『大』が最も理想に近い」）。 */
    def:(()=>{localStorage.removeItem('SchedulePrintPrefV1');
      const d=WL.schedulePrint.defaults?.();return d?
       {fontScale:d.fontScale,padX:d.padX,padY:d.padY,dayGap:d.dayGap,colFit:d.colFit,bold:d.bold}:null})(),
   }));
   /* §9.293 ④で「極大」「最大」を足した（利用者の指示「おじいちゃんも見るので
      文字はもっと限界まで大きく」）。**今までの綴りは1つも変えない**
      （変えると保存値が「知らない値」になる・§9.204）。 */
   rec('文字の大きさは自動＋6段、余白は左右4段・上下3段・区切り4段（語彙は1箇所から）',
       seam.fs.join(',')==='auto,0.85,1,1.15,1.3,1.7,2.2'
       &&seam.padX.join(',')==='0.3,0.6,1,1.5'&&seam.padY.join(',')==='0.6,1,1.5'
       &&seam.day.join(',')==='0.6,1,1.5,2.2'&&seam.colFit.join(',')==='text,screen'
       &&seam.fit==='function'&&seam.font==='function',JSON.stringify(seam));
   /* **既定そのものを固定する**（§9.294 ⑤⑥）——札が並ぶだけを見る網は、
      既定が変わっていなくても通る。 */
   rec('既定は 文字「大」＋左右「詰める」＋行間「標準」＋区切り「広め」＋文字に合わせる',
       !!seam.def&&seam.def.fontScale==='1.15'&&seam.def.padX==='0.6'&&seam.def.padY==='1'
       &&seam.def.dayGap==='1.5'&&seam.def.colFit==='text'&&seam.def.bold===false,
       JSON.stringify(seam.def));
   /* ---- §9.293 ② 文字は幅の圧縮に引きずられない（利用者の報告） ----
      「文字のサイズ変更機能は印刷で見てもプレビューで見ても全く変化して
       いるように感じません」

      §9.292 ⑥は幅と文字を同じ比率で動かしたため、列の多い設備では比率が
      下限に張り付き、**どの大きさを選んでも同じ絵**になっていた。
      幅（紙に必ず収める）と文字（利用者が決める）は**別の答え**にする。 */
   const split=await page.evaluate(()=>{
    /* 紙に入りきらない列数を作る（実機の18列と同じ状況）。 */
    const many=Array.from({length:30},(_,i)=>({key:'c'+i,label:'C',w:120}));
    const of=(o,k)=>WL.schedulePrint[k](many,190,o);
    return {幅:{小:of({fontScale:'0.85'},'fitOf'),標準:of({fontScale:'1'},'fitOf'),
                特大:of({fontScale:'1.3'},'fitOf')},
            文字:{自動:of({fontScale:'auto'},'fontOf'),小:of({fontScale:'0.85'},'fontOf'),
                  標準:of({fontScale:'1'},'fontOf'),特大:of({fontScale:'1.3'},'fontOf'),
                  最大:of({fontScale:'2.2'},'fontOf')},
            /* セルの余白を詰めると、そのぶんが**文字の大きさになる**
               （§9.293 ④）——以前は空いた場所が誰にも配られなかった。
               **床に着いていない列数で見ること**——30列だとどちらも
               下限(MIN_FIT)に張り付いて、直す前でも同じ数になる。 */
            余白:(()=>{
             const few=Array.from({length:6},(_,i)=>({key:'f'+i,label:'F',w:100}));
             const g=o=>WL.schedulePrint.fontOf(few,190,{colFit:'screen',...o});
             return {標準:g({fontScale:'auto',padX:'1'}),
                     詰める:g({fontScale:'auto',padX:'0.6'}),
                     最小:g({fontScale:'auto',padX:'0.3'}),
                     広め:g({fontScale:'auto',padX:'1.5'}),
                     /* **上下は文字に効かない**（§9.294 ②）——行が薄くなる
                        だけ。同じ軸に戻すと「詰めたのに変わらない」か
                        「大きくしたら行間まで詰まる」のどちらかになる。 */
                     行間詰め:g({fontScale:'auto',padX:'1',padY:'0.6'})};
            })()};
   });
   rec('列が多くて幅が床に着いても、文字の大きさは選んだとおりに効く',
       split.文字.小<split.文字.標準&&split.文字.標準<split.文字.特大
       &&split.文字.特大===1.3,JSON.stringify(split.文字));
   rec('幅は選び直しても紙に収める側のまま（はみ出させない）',
       split.幅.小===split.幅.標準&&split.幅.標準===split.幅.特大,JSON.stringify(split.幅));
   rec('左右の余白を詰めると、そのぶん「自動」の文字が大きくなる（§9.293 ④／§9.294 ②）',
       split.余白.最小>split.余白.詰める&&split.余白.詰める>split.余白.標準
       &&split.余白.広め<split.余白.標準,
       JSON.stringify(split.余白));
   rec('行間（上下）は文字の大きさに効かない（左右とは別の軸・§9.294 ②）',
       split.余白.行間詰め===split.余白.標準,JSON.stringify(split.余白));
   /* **余っているぶんだけ大きくする**（幅も文字も同じ比率で）。 */
   const grow=await page.evaluate(()=>{
    const cols=[{key:'a',label:'A',w:100},{key:'b',label:'B',w:100}];
    return {auto:WL.schedulePrint.fitOf(cols,190,{fontScale:'auto'}),
            std:WL.schedulePrint.fitOf(cols,190,{fontScale:'1'}),
            /* 列が多くて入らないときは今までどおり縮む。 */
            tight:WL.schedulePrint.fitOf(
              Array.from({length:30},(_,i)=>({key:'c'+i,label:'C',w:120})),190,{fontScale:'auto'})};
   });
   rec('紙が余っていれば「自動」で1倍より大きくなる',grow.auto>1.05,JSON.stringify(grow));
   rec('「標準」を選べば1倍のまま（自動で勝手に伸ばさない）',grow.std===1,JSON.stringify(grow));
   rec('列が多いときは今までどおり縮む（紙からはみ出させない）',grow.tight<1,JSON.stringify(grow));

   /* 実際の紙で測る。**選ぶ前と後で本文の文字が変わること**まで見る。 */
   /* **列を絞って測る**——検証用の設備は列が多く、どの大きさを選んでも
      床（`MIN_FIT`）に着いて同じ絵になる（＝何も確かめられない）。
      紙が余っている形でだけ、選んだ大きさが効くことを見る。 */
   const fontOf=async(pref,narrow)=>page.evaluate(([o,n])=>{
    const groups=WL.schedulePrint.buildPages('テスト設備A',WL.scheduleView.entries(),o);
    const sheets=WL.schedulePrint.splitToSheets(groups,o);
    if(n)sheets.forEach(s=>{s.cols=(s.cols||WL.schedulePrint.printColumns(o)).slice(0,n)});
    let area=document.getElementById('schedulePrintArea');
    if(!area){area=document.createElement('div');area.id='schedulePrintArea';
              area.className='sp-print-area';document.body.appendChild(area)}
    area.innerHTML=WL.schedulePrint.pageHtml(sheets[0],o,1,sheets.length);
    area.style.display='block';
    /* **ふつうの行のセルで測る**——`tbody td`の先頭はまとまりの帯
       （`.sp-row-group td`）になりうるので、そこを測ると「区切りだけ
       変えたのに本文まで変わった」と読める（実際に踏んだ）。 */
    const td=area.querySelector('.sp-table tbody tr[data-row] td')
      ||area.querySelector('.sp-table tbody td');
    const cs=getComputedStyle(td);
    const page=area.querySelector('.sp-page');
    const wrap=area.querySelector('.sp-table-wrap');
    const inner=page.getBoundingClientRect().width
      -parseFloat(cs.getPropertyValue('padding-left')||0);
    const r={fs:Math.round(parseFloat(cs.fontSize)*10)/10,
             pad:Math.round(parseFloat(cs.paddingTop)*10)/10,
             padX:Math.round(parseFloat(cs.paddingLeft)*10)/10,
             bold:Number(cs.fontWeight)||0,
             /* 区切りの帯の上下（§9.294 ③）。**帯そのものを測る**
                ——設定が在るだけを見る網は、CSSが読んでいなくても通る。 */
             dayPad:(()=>{const g=area.querySelector('.sp-row-group td');
               return g?Math.round(parseFloat(getComputedStyle(g).paddingTop)*10)/10:null})(),
             /* 作業以外の行（§9.294 ①）。束ねた1マスの列数と、切れていないか。 */
             nonWork:(()=>{const td=area.querySelector('.sp-c-nonwork');
               return td?{span:Number(td.getAttribute('colspan')||1),
                          text:(td.textContent||'').trim(),
                          cut:td.scrollWidth>td.clientWidth+1}:null})(),
             /* 値が切れている列の数（§9.294 ④）。 */
             clipped:[...area.querySelectorAll('.sp-table tbody td')]
               .filter(t=>t.scrollWidth>t.clientWidth+1).length,
             colMm:[...area.querySelectorAll('colgroup col')].map(c=>parseFloat(c.style.width)),
             over:wrap.getBoundingClientRect().right>page.getBoundingClientRect().right
                  -parseFloat(getComputedStyle(page).paddingRight)+1};
    area.innerHTML='';area.style.display='';
    return r;
   },[pref,narrow||0]);
   const base={...(await page.evaluate(()=>JSON.parse(JSON.stringify(
     {includeDone:false,actualColumns:true,pageByDate:true,allEquipment:false,useGroups:true,
      commentBox:true,writePattern:'actual',includeChildren:false,paper:'a4-portrait',
      columnScope:'all',borders:true,range:'all'}))))};
   const small=await fontOf({...base,fontScale:'0.85'},4);
   const std=await fontOf({...base,fontScale:'1'},4);
   const big=await fontOf({...base,fontScale:'1.3'},4);
   const auto=await fontOf({...base,fontScale:'auto'},4);
   rec('文字の大きさを選ぶと、刷り上がりの本文の文字が実際に変わる',
       small.fs<std.fs&&std.fs<big.fs,JSON.stringify({small:small.fs,std:std.fs,big:big.fs}));
   rec('地の大きさをひと回り上げた（標準で本文12px以上）',std.fs>=12,String(std.fs));
   rec('「自動」は紙の余りぶんまで大きくする（既定でいちばん大きい）',
       auto.fs>=big.fs,JSON.stringify({auto:auto.fs,big:big.fs}));
   rec('どの大きさでも紙からはみ出さない',!small.over&&!std.over&&!big.over&&!auto.over,
       JSON.stringify({small:small.over,std:std.over,big:big.over,auto:auto.over}));
   /* **列が多い設備でも、選んだ大きさがそのまま紙に出る**（§9.293 ②）
      ——ここが「全く変化しない」と報告された箇所。 */
   const wideAuto=await fontOf({...base,fontScale:'auto'});
   const wideBig=await fontOf({...base,fontScale:'1.3'});
   rec('列が多い設備でも、文字の大きさを選ぶと紙の文字が実際に変わる',
       wideBig.fs>wideAuto.fs+1,JSON.stringify({自動:wideAuto.fs,特大:wideBig.fs}));
   rec('「自動」は今までどおり幅なり（列が多ければ小さいまま）',
       wideAuto.fs<std.fs,JSON.stringify({自動:wideAuto.fs,標準:std.fs}));
   rec('文字を大きくしても紙からはみ出さない（幅は収める側のまま）',
       !wideBig.over,String(wideBig.over));
   /* ---- §9.294 ② 余白は上下と左右で別の軸（利用者の指示） ----
      **文字の大きさを揃えて比べること**——余白は`--sp-fit`でも伸縮する
      （§9.294 ④。幅・文字・余白の3つが同じ比率で動いて初めて「測った幅に
      必ず収まる」が成り立つ）ので、倍率が違う紙どうしを比べると
      「詰めたのに広い」という無関係な差を見ることになる。 */
   const padBase={...base,fontScale:'1'};
   const tight=await fontOf({...padBase,padY:'0.6'},4);
   const wide=await fontOf({...padBase,padY:'1.5'},4);
   rec('行間（上下）を選ぶと、実際にセルの上下の余白が変わる',
       tight.pad<std.pad&&std.pad<wide.pad,
       JSON.stringify({tight:tight.pad,std:std.pad,wide:wide.pad}));
   const xMin=await fontOf({...padBase,padX:'0.3'},4);
   const xStd=await fontOf({...padBase,padX:'1'},4);
   const xWide=await fontOf({...padBase,padX:'1.5'},4);
   rec('左右を選ぶと、実際にセルの左右の余白が変わる',
       xMin.padX<xStd.padX&&xStd.padX<xWide.padX,
       JSON.stringify({最小:xMin.padX,標準:xStd.padX,広め:xWide.padX}));
   /* **上下を触っても左右は動かない／左右を触っても上下は動かない**
      ——1つの軸へ戻すと、この2つのどちらかが必ず落ちる。 */
   rec('上下と左右は互いに動かさない（1つの軸へ戻していない）',
       tight.padX===std.padX&&wide.padX===std.padX&&xMin.pad===std.pad&&xWide.pad===std.pad,
       JSON.stringify({上下を触ったときの左右:[tight.padX,std.padX,wide.padX],
                       左右を触ったときの上下:[xMin.pad,std.pad,xWide.pad]}));
   /* ---- §9.294 ③ 区切り（日付）の行間だけ別に空ける（利用者の指示） ----
      **まとまりの帯を実際に出してから測る**——既定の「まとめない」のままだと
      帯が1本も出ず、`null`同士を比べて何も確かめないまま通る。 */
   const grouped=await page.evaluate(()=>{
    const g=document.getElementById('scGroupSelect');
    if(!g)return false;
    const prev=g.value;g.value='date';g.dispatchEvent(new Event('change',{bubbles:true}));
    return prev;
   });
   const dayNarrow=await fontOf({...padBase,useGroups:true,pageByDate:false,dayGap:'0.6'},4);
   const dayWide=await fontOf({...padBase,useGroups:true,pageByDate:false,dayGap:'2.2'},4);
   await page.evaluate(p2=>{const g=document.getElementById('scGroupSelect');
    if(g&&p2!==false){g.value=p2;g.dispatchEvent(new Event('change',{bubbles:true}))}},grouped);
   rec('区切りの行間を選ぶと、まとまりの帯の上下だけが変わる',
       dayNarrow.dayPad!=null&&dayWide.dayPad!=null&&dayWide.dayPad>dayNarrow.dayPad
       &&dayNarrow.pad===dayWide.pad,
       JSON.stringify({詰める:dayNarrow.dayPad,とても広め:dayWide.dayPad,
                       ふつうの行:[dayNarrow.pad,dayWide.pad]}));
   /* ---- §9.294 ⑤ 太字（利用者の指示「文字を太字にしたりする機能も」） ---- */
   const boldOn=await fontOf({...padBase,bold:true},4);
   rec('太字を選ぶと、刷り上がりの本文が実際に太くなる',
       boldOn.bold>=700&&std.bold<700,JSON.stringify({太字:boldOn.bold,既定:std.bold}));

   /* **設定が端末に残る**（毎回選び直させない）。 */
   await page.evaluate(e=>WL.schedulePrint.openPreview(e),EQ);
   await page.waitForSelector('#spPvTabs',{timeout:15000});
   /* 設定は段に分かれた（§9.293 ③）ので、**段の名前で開く**
      （番号で探すと段が1つ増えただけで落ちる）。 */
   await page.click('[data-pv-tab="look"]');
   await page.waitForSelector('#spFontScale',{state:'visible',timeout:8000});
   await page.click('#spFontScale label:has(input[value="1.3"])');
   await page.click('#spCellPad label:has(input[name="spPadX"][value="0.3"])');
   await page.click('#spCellPad label:has(input[name="spPadY"][value="1.5"])');
   await page.click('#spCellPad label:has(input[name="spDayGap"][value="2.2"])');
   await page.waitForTimeout(800);
   const kept=await page.evaluate(()=>{
    const p=JSON.parse(localStorage.getItem('SchedulePrintPrefV1')||'{}');
    return {fs:p.fontScale,padX:p.padX,padY:p.padY,day:p.dayGap,legacy:p.cellPad,
            note:(document.getElementById('spFitNote')||{}).textContent||''};
   });
   rec('選んだ文字の大きさ・余白（左右・上下・区切り）はこの端末に残る',
       kept.fs==='1.3'&&kept.padX==='0.3'&&kept.padY==='1.5'&&kept.day==='2.2'
       /* **読まない鍵は残さない**（§9.294 ②）——どちらが効くのか分からなくなる。 */
       &&kept.legacy===undefined,JSON.stringify(kept));
   /* **本文が何pxで刷られるか**を文字で出す（§3・§6）。列幅の%は足元の
      「刷り上がり」が言うので、ここでは繰り返さない（§CLAUDE 8）。 */
   rec('いま本文が何pxで刷られるかを文字で出す（§3・§6）',
       /px/.test(kept.note)&&/刷り上がり/.test(kept.note),kept.note.slice(0,90));
   rec('列幅の%は足元の「刷り上がり」が1箇所で言う（同じ数字を2度出さない）',
       !/%/.test(kept.note)&&/%/.test(await page.evaluate(()=>
         (document.getElementById('spPvFacts')||{}).innerText||'')),kept.note.slice(0,90));
   /* この設備は列が多いので、特大にすると**文字が列より大きくなる**。
      **そうなることを先に書く**（§4）——黙って「…」で切ると壊れて見える。 */
   rec('文字が列より大きいときは、値が切れることを先に書く',
       /切れます/.test(kept.note),kept.note.slice(0,160));
   await page.evaluate(()=>WL.schedulePrint.closePreview());
   await page.evaluate(()=>localStorage.removeItem('SchedulePrintPrefV1'));
  }

  /* ---- 23) 左の欄が縦に伸びず、いちばん内側だけがスクロールする(§9.293 ③) ----
     段に分けた値打ちは「探すのに毎回スクロールしなくていい」ことなので、
     **左の欄そのものが画面より高くならない**ことまで見る（§9.254 ①）。 */
  {
   await page.evaluate(e=>WL.schedulePrint.openPreview(e),EQ);
   await page.waitForSelector('#spPvTabs',{timeout:15000});
   await page.waitForTimeout(400);
   const fit=await page.evaluate(()=>{
    const side=document.querySelector('.sp-pv-side');
    const box=document.querySelector('.sp-pv-box');
    const pane=[...document.querySelectorAll('.sp-pv-pane')].find(p=>!p.hidden);
    const sum=document.querySelector('.sp-pv-sum');
    const r=side.getBoundingClientRect(),b=box.getBoundingClientRect();
    return {側の溢れ:side.scrollHeight>side.clientHeight+1,
            窓から出た:r.bottom>b.bottom+1,
            段が伸びる:!!(pane&&pane.clientHeight>0),
            /* 枚数と「既定へ戻す」は段の外なので、どの段でも見えている。 */
            足元:!!(sum&&sum.getBoundingClientRect().height>0
                    &&sum.getBoundingClientRect().bottom<=b.bottom+1)};
   });
   rec('左の欄は窓に収まり、スクロールするのは開いている段だけ',
       !fit.側の溢れ&&!fit.窓から出た&&fit.段が伸びる&&fit.足元,JSON.stringify(fit));
   await page.evaluate(()=>WL.schedulePrint.closePreview());
  }

  await page.evaluate(()=>WL.schedulePrint.closePreview());

  /* ============================================================
     §9.294 ① 作業以外の行は「題名だけ」（利用者の指示）
     「作業スケジュール表の設備停止名はカラムに関係なく表示できるように
      してほしいです。一番左に配置した基準のカラムに所属させた形で文字が
      見切れたりしてしまうので…」
     「設備停止を入れた行は、ロットの情報と全く関係ないので、設備停止名
      以外表示させたくない…組み込み条件も含めて設備停止は無関係情報に
      なるので行での処理を除外するようにしてください」

     **材料は自分で注ぎ込む**——検証用の予定に設備停止がある保証は無く、
     「無ければ素通り」の書き方だと直す前でも通る。
     ============================================================ */
  {
   const STOP_NAME='RT印刷_停止'+Date.now();
   const stopId=await page.evaluate(async ([e,name])=>{
    const j=async(u,b)=>(await (await fetch(u,{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})).json());
    const m=await j('/api/schedule/stop-reason-master',
      {equipment:e,category:'その他',name,standardMinutes:20,user_id:'test-scprint'});
    await j('/api/schedule/session/acquire',{equipment:e});
    const a=await j('/api/schedule/plan/add',{equipment:e,kind:'設備停止',
      stopReasonId:m&&m.id,user_id:'test-scprint'});
    return {plan:a&&a.id,reason:m&&m.id};
   },[EQ,STOP_NAME]);
   if(stopId&&stopId.plan)made.push(stopId.plan);
   /* **後始末を必ず足す**（§9.121）——停止理由マスタは`db/master.sqlite3`に
      残り、実行のたびに1行ずつ増える。 */
   if(stopId&&stopId.reason)madeStops.push(stopId.reason);
   rec('前提: 設備停止の予定を1件足せた',!!(stopId&&stopId.plan),JSON.stringify(stopId));

   /* ---- 画面（タイムライン）側 ---- */
   /* **足した予定が画面に載るまで待つ**（固定待ちだと、まだ届いていない
      画面を測って通る・§9.102）。開き直しはtest_scdropと同じ作法。 */
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
   await page.waitForSelector('#openSchedule',{timeout:25000});
   await page.click('#openSchedule');
   await page.waitForSelector('.sc-board-row',{timeout:25000});
   await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
     .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
   await page.waitForSelector('.sc-row-line',{timeout:30000});
   await page.waitForFunction(n=>[...document.querySelectorAll('.sc-row-line')]
     .some(r=>(r.textContent||'').includes(n)),STOP_NAME,{timeout:30000});
   const scr=await page.evaluate(name=>{
    const row=[...document.querySelectorAll('.sc-row-line')]
      .find(r=>(r.textContent||'').includes(name));
    if(!row)return null;
    const t=row.querySelector('.sc-row-nonwork');
    const fixed=[...row.querySelectorAll('[data-col]')]
      .filter(x=>String(x.dataset.col||'').startsWith('__'));
    return {found:true,
            /* 題名が1マスに束ねられ、その中で切れていない。 */
            span:t?getComputedStyle(t).gridColumn:'',
            text:t?(t.textContent||'').trim():'',
            cut:t?t.scrollWidth>t.clientWidth+1:true,
            /* 内容・計算の列（`__`で始まらない）は**1つも中身を持たない**
               （題名の1マスを除く）。表示ルールの既定行が書き込んでいたら
               ここで落ちる。 */
            leftover:[...row.querySelectorAll('[data-col]')]
              .filter(x=>!String(x.dataset.col||'').startsWith('__')
                         &&!x.classList.contains('sc-row-nonwork')
                         &&(x.textContent||'').trim()!=='').length,
            /* 作業可否はロットの話なので落とす。 */
            workable:!!row.querySelector('.sc-row-workable'),
            /* 日付・時刻・区分は残す（停止そのものの事実）。 */
            keptFixed:fixed.filter(x=>(x.textContent||'').trim()!=='').length};
   },STOP_NAME);
   rec('画面: 設備停止の題名は内容の列を束ねた1マスに出る',
       !!scr&&scr.text.includes(STOP_NAME)&&/span/.test(scr.span),JSON.stringify(scr));
   rec('画面: 束ねたので題名が見切れない',!!scr&&!scr.cut,JSON.stringify(scr&&scr.text));
   rec('画面: 内容・計算の列にロットと無関係な値が残らない',
       !!scr&&scr.leftover===0,JSON.stringify(scr&&scr.leftover));
   rec('画面: 作業可否（ロットの話）は出さない',!!scr&&!scr.workable,JSON.stringify(scr&&scr.workable));
   rec('画面: 日付・時刻・区分（停止そのものの事実）は残す',
       !!scr&&scr.keptFixed>=3,JSON.stringify(scr&&scr.keptFixed));

   /* ---- 紙側 ---- */
   const paper=await build({includeDone:true,pageByDate:false,columnScope:'all'});
   const pinfo=await page.evaluate(name=>{
    const td=[...document.querySelectorAll('#schedulePrintArea .sp-c-nonwork')]
      .find(x=>(x.textContent||'').includes(name));
    if(!td)return null;
    const tr=td.closest('tr');
    const cols=tr.closest('table').querySelectorAll('colgroup col').length;
    return {span:Number(td.getAttribute('colspan')||1),cols,
            cut:td.scrollWidth>td.clientWidth+1,
            /* 題名以外のセルに中身が残っていないこと（区分・日付などの
               固定列は残ってよいので、内容の列だけを見る）。 */
            cells:[...tr.children].length};
   },STOP_NAME);
   rec('紙: 設備停止の題名は内容の列を束ねた1マスに出る',
       !!pinfo&&pinfo.span>1,JSON.stringify(pinfo));
   rec('紙: 束ねたので題名が切れない',!!pinfo&&!pinfo.cut,JSON.stringify(pinfo));
   /* **セルの数＋束ねたぶん−1＝列の数**（束ねて列がずれていない）。 */
   rec('紙: 束ねても列がずれない（colspanと列数が合う）',
       !!pinfo&&pinfo.cells+pinfo.span-1===pinfo.cols,JSON.stringify(pinfo));
   await clear();
   void paper;

   /* ============================================================
      §9.294 ④ カラム幅の自動調整（利用者の指示「カラムの文字列は
      見切れないようにしたいのでカラム幅の自動調整機能も欲しいです」）
      ============================================================ */
   /* **宣言ではなく刷り上がりで見る**——「文字に合わせる」を選んでも
      `withMm`が実測を渡していなければ何も変わらない（§9.289と同じ罠）。 */
   const fitCmp=await page.evaluate(async ()=>{
    const of=async o=>{
     const groups=WL.schedulePrint.buildPages('テスト設備A',WL.scheduleView.entries(),o);
     const sheets=WL.schedulePrint.splitToSheets(groups,o);
     let area=document.getElementById('schedulePrintArea');
     if(!area){area=document.createElement('div');area.id='schedulePrintArea';
               area.className='sp-print-area';document.body.appendChild(area)}
     area.innerHTML=WL.schedulePrint.pageHtml(sheets[0],o,1,sheets.length);
     area.style.display='block';
     const cols=[...area.querySelectorAll('colgroup col')].map(c=>parseFloat(c.style.width));
     const td=area.querySelector('.sp-table tbody td');
     const fs=Math.round(parseFloat(getComputedStyle(td).fontSize)*10)/10;
     const clipped=[...area.querySelectorAll('.sp-table tbody td:not(.sp-c-nonwork)')]
       .filter(t=>t.scrollWidth>t.clientWidth+1).length;
     const wrap=area.querySelector('.sp-table-wrap'),pg=area.querySelector('.sp-page');
     const over=wrap.getBoundingClientRect().right>pg.getBoundingClientRect().right
       -parseFloat(getComputedStyle(pg).paddingRight)+1;
     area.innerHTML='';area.style.display='';
     return {cols,fs,clipped,over,sum:Math.round(cols.reduce((a,b)=>a+b,0)*10)/10};
    };
    const base={includeDone:true,pageByDate:false,paper:'a4-portrait',columnScope:'all',
                borders:true,range:'all',useGroups:true,commentBox:true,writePattern:'actual',
                fontScale:'auto',padX:'0.6',padY:'1',dayGap:'1.5'};
    return {text:await of({...base,colFit:'text'}),screen:await of({...base,colFit:'screen'})};
   });
   /* **列ごとの幅が変わる**（比が保たれない＝要る幅に合わせて配り直した）。 */
   const changed=fitCmp.text.cols.filter((v,i)=>Math.abs(v-fitCmp.screen.cols[i])>0.5).length;
   rec('列の幅を「文字に合わせる」と、刷り上がりの列幅が実際に配り直される',
       changed>=3,JSON.stringify({変わった列:changed,
         文字:fitCmp.text.cols.slice(0,6),画面:fitCmp.screen.cols.slice(0,6)}));
   /* **余ったぶんが文字へ回る**——これが「見切れさせずに大きくする」の中身。 */
   rec('文字に合わせると、そのぶん「自動」の文字が大きくなる',
       fitCmp.text.fs>fitCmp.screen.fs,
       JSON.stringify({文字に合わせる:fitCmp.text.fs,画面のまま:fitCmp.screen.fs}));
   /* **「自動」＋「文字に合わせる」なら1つも切れない**（§9.294 ④）——これが
      利用者の「カラムの文字列は見切れないように」への答え。**減ることでは
      なく0であること**を見る（減るだけの網は、余白が文字と一緒に縮まない
      実装＝実測で31セル切れていた形を素通りさせる）。 */
   rec('「自動」＋「文字に合わせる」なら、切れるセルが1つも無い',
       fitCmp.text.clipped===0,
       JSON.stringify({文字:fitCmp.text.clipped,画面:fitCmp.screen.clipped}));
   rec('文字に合わせても紙からはみ出さない',!fitCmp.text.over&&fitCmp.text.sum<=194+0.5,
       JSON.stringify({はみ出し:fitCmp.text.over,合計:fitCmp.text.sum}));
   /* この節で画面を読み直したので、プレビューの器も作り直されている。
      最後の「閉じても刷らない」は器が在る前提なので、1度開いておく。 */
   await page.evaluate(e=>WL.schedulePrint.openPreview(e),EQ);
   await page.waitForSelector('#spPvTabs',{timeout:15000});
  }

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
  try{
   for(const id of madeStops)await page.evaluate(async i=>{
    await fetch('/api/schedule/stop-reason-master/delete',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:i,user_id:'test-scprint'})});
   },id);
  }catch(e){}
  try{await setMode('edit')}catch(e){}
  if(b)await b.close().catch(()=>{});
 }
})().catch(async e=>{console.error('FATAL',e);if(b)await b.close().catch(()=>{});process.exit(2)});
