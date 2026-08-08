const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const setMode=async m=>{await fetch('http://127.0.0.1:5029/api/access-mode',
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 await setMode('edit');
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.waitForTimeout(1200);

 // 基準: 仕掛一覧のデータセル
 await page.click('aside [data-db-key="SIKALOTNOW"]');
 await page.waitForTimeout(3000);
 const base=await page.evaluate(()=>{
  const td=document.querySelector('#grid tbody td');const th=document.querySelector('#grid thead th');
  return {cell:td?parseFloat(getComputedStyle(td).fontSize):null,
          head:th?parseFloat(getComputedStyle(th).fontSize):null,
          rowH:td?Math.round(td.getBoundingClientRect().height):null};
 });
 await page.click('#openSchedule');
 await page.waitForTimeout(3500);
 const sc=await page.evaluate(()=>{
  const g=s=>{const e=document.querySelector(s);return e?parseFloat(getComputedStyle(e).fontSize):null};
  const r=[...document.querySelectorAll('.sc-row-line')]
    .find(x=>/予定/.test(x.querySelector('.sc-row-cat')?.textContent||''));
  return {title:g('.sc-row-title'),time:g('.sc-row-time'),date:g('.sc-row-date'),
          shift:g('.sc-row-shift'),rel:g('.sc-row-rel'),est:g('.sc-row-est'),
          actual:g('.sc-row-actual'),head:g('.sc-row-head'),cat:g('.sc-row-cat'),
          rowH:r?Math.round(r.getBoundingClientRect().height):null};
 });
 console.log('一覧の基準',JSON.stringify(base));
 console.log('スケジュール',JSON.stringify(sc));

 rec('内容(主データ)は一覧のセルと同じ文字サイズ',sc.title===base.cell,`sc=${sc.title} / 一覧=${base.cell}`);
 rec('時刻・日付・勤務・残り・見積・実績が12px以上(以前は11px)',
  [sc.time,sc.date,sc.shift,sc.rel,sc.est,sc.actual].every(v=>v>=12),
  JSON.stringify([sc.time,sc.date,sc.shift,sc.rel,sc.est,sc.actual]));
 rec('列見出しが一覧の見出しから2段以上離れていない',Math.abs(sc.head-base.head)<=3,`sc=${sc.head} / 一覧=${base.head}`);
 // タイムラインは一覧より意図的に少しだけ密(多くの行を一度に見渡す画面)。
 // ただし「一段小さいUI」に見えるほど離してはいけない。一覧の85%以上を保つ。
 rec('行の高さが一覧の行から離れすぎていない(85%以上)',
  sc.rowH>=base.rowH*0.85&&sc.rowH<=base.rowH,`sc=${sc.rowH} / 一覧=${base.rowH} (${(sc.rowH/base.rowH*100).toFixed(0)}%)`);
 // §9.39で見出し方式を廃止し、区分は行内の列になった。列内の文字は
 // データ列と同じ水準(小さすぎない)であればよい。
 rec('区分チップの文字がデータ列と同水準',sc.cat>=12&&sc.cat<=sc.title,`cat=${sc.cat} title=${sc.title}`);

 // 表示サイズを変えても関係が保たれる
 for(const size of ['xs','xl']){
  await page.evaluate(v=>document.documentElement.setAttribute('data-ui-size',v),size);
  await page.waitForTimeout(300);
  const s2=await page.evaluate(()=>{
   const g=s=>{const e=document.querySelector(s);return e?parseFloat(getComputedStyle(e).fontSize):null};
   return {title:g('.sc-row-title'),body:parseFloat(getComputedStyle(document.body).fontSize)};
  });
  rec(`表示サイズ${size}でも内容は本文と同じ大きさ`,Math.abs(s2.title-s2.body)<0.01,JSON.stringify(s2));
 }
 await page.evaluate(()=>document.documentElement.setAttribute('data-ui-size','md'));
 await page.waitForTimeout(300);
 rec('横スクロールバーが出ない',await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
 await page.screenshot({path:'sched_balanced.png'});

 /* ---- 縦の間隔(§9.84) ----
    「リストの間隔が広いものと狭いものがあってバランスが悪い」という指摘。
    実測した原因は2つ:
     ・俯瞰ボードの印の欄が160px固定+折り返しで、チップが2つ付く行だけ
       背が高くなっていた(61px 対 44px)
     ・タイムラインの列見出しをまとめの箱ごとに入れており、日付＋勤務で
       まとめると18回繰り返され、行と行の間に見出し2枚+空きが挟まっていた
    どちらも「同じ意味の行は同じ高さ・同じ間隔」に揃える。 */
 await setMode('schedule');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:20000});
 await page.waitForTimeout(1500);
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-board-row',{timeout:20000});
 await page.waitForTimeout(1200);
 const board=await page.$$eval('.sc-board-row',ns=>ns.map(n=>Math.round(n.getBoundingClientRect().height)));
 rec('俯瞰ボードの行の高さが揃っている',new Set(board).size===1,`高さ=${[...new Set(board)].join('/')} (${board.length}行)`);

 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')]
   .find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await page.waitForSelector('.sc-row-line',{timeout:20000});
 await page.waitForTimeout(1500);
 // まとめ方を変えても、列見出しは1枚・行の間隔は一定であること
 for(const mode of ['none','date','dateshift']){
  await page.selectOption('#scGroupSelect',mode).catch(()=>{});
  await page.waitForTimeout(1200);
  const m=await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('.sc-row-line')];
   const heads=document.querySelectorAll('.sc-row-head').length;
   // 同じまとまりの中で連続する行どうしのピッチ
   const pitch=[];
   for(let i=1;i<rows.length;i++){
    if(rows[i].parentElement!==rows[i-1].parentElement)continue;
    if(rows[i].previousElementSibling!==rows[i-1])continue;  // 間に何か挟まる行は別扱い
    pitch.push(Math.round((rows[i].getBoundingClientRect().top-rows[i-1].getBoundingClientRect().top)*10)/10);
   }
   return {heads,rows:rows.length,pitch:[...new Set(pitch)],
           rowH:[...new Set(rows.map(r=>Math.round(r.getBoundingClientRect().height)))]};
  });
  rec(`まとめ「${mode}」で列見出しは1枚だけ`,m.heads===1,`${m.heads}枚 / ${m.rows}行`);
  rec(`まとめ「${mode}」で行の高さが揃っている`,m.rowH.length===1,m.rowH.join('/'));
  rec(`まとめ「${mode}」で連続する行の間隔が一定`,m.pitch.length<=1,m.pitch.join('/'));
 }
 await page.selectOption('#scGroupSelect','none').catch(()=>{});
 await setMode('edit');

 console.log('\n=== SUMMARY ===');
 const f=R.filter(r=>!r.ok);console.log(`${R.length-f.length}/${R.length} passed`);
 f.forEach(x=>console.log(' -',x.n,x.d||''));
 await b.close();process.exit(f.length?1:0);
})().catch(async e=>{
 // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
 // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
 // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
