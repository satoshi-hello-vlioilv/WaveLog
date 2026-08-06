/* test_course.js: 測定画面のコース情報が見切れないこと。
   ------------------------------------------------------------
   コース(設計/実績/残)は設備の連なりなので、他の基本情報と違って長くなる。
   2列グリッドの半分の幅へ nowrap+省略記号で入れると必ず末尾が切れ、
   ホバーして title を読まないと分からなかった。
   フィクスチャのコースは短い(最大14文字)ので実機の長さを再現しない。
   **実機相当の長い値を注入して測る**。 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const API='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(`${API}/api/access-mode`,
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
// 実機の残仕掛設備ｺｰｽ相当(設備名が連なる)。半分幅では確実に入らない長さ。
const LONG='テスト設備A C1 テスト設備B C2 テスト設備C C3 テスト設備D C4 テスト設備E C5';
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 try{
  await setMode('edit');
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.waitForTimeout(1500);

  // 予定から測定画面を開く
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:20000});
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r)r.querySelector('.sc-row-start').click();
   return !!r;
  });
  rec('予定から測定画面を開ける',started);
  if(!started)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:20000});
  await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,
   null,{timeout:30000}).catch(()=>{});

  // 実機相当の長いコースを流し込んで描き直す
  await page.evaluate(long=>{
   const src=S.measure.source=S.measure.source||{};
   src['設計_設備ｺｰｽ']=long;src['実績_設備ｺｰｽ']=long;src['残仕掛設備ｺｰｽ']=long;
   if(typeof renderResidualCourseEverywhere==='function')renderResidualCourseEverywhere();
   if(typeof renderCourseHierarchy==='function')renderCourseHierarchy();
  },LONG).catch(()=>{});
  await page.waitForTimeout(1200);

  const m=await page.evaluate(()=>{
   const out=[...document.querySelectorAll('#basicInfo .info-grid .field')]
    .filter(f=>/コース/.test(f.querySelector('label')?.textContent||''))
    .map(f=>{
     const o=f.querySelector('output');const r=o.getBoundingClientRect();
     const gs=getComputedStyle(o);
     return {label:f.querySelector('label').textContent,
             text:(o.textContent||'').trim(),
             title:o.title||'',
             // 切れているか: 中身の幅が枠を超えているか
             cut:o.scrollWidth-o.clientWidth,
             wrap:gs.whiteSpace,
             fullWidth:Math.round(r.width),
             gridWidth:Math.round(f.parentElement.getBoundingClientRect().width)};
    });
   return out;
  });
  console.log('コース欄:',JSON.stringify(m,null,1));
  rec('コース欄が3つある(設計/実績/残)',m.length>=3,`${m.length}件`);
  const long=m.filter(x=>x.text.length>20);
  rec('長い値が実際に入っている',long.length>0,long.map(x=>x.text.length+'文字').join(','));
  rec('横に切れていない(省略記号で隠れない)',
   m.every(x=>x.cut<=1),m.map(x=>`${x.label}:超過${x.cut}px`).join(' / '));
  rec('折り返す設定になっている',
   m.every(x=>x.wrap!=='nowrap'),m.map(x=>`${x.label}:${x.wrap}`).join(' / '));
  rec('コース欄は全幅を使う(2列の半分ではない)',
   m.every(x=>x.fullWidth>x.gridWidth*0.7),
   m.map(x=>`${x.label}:${x.fullWidth}/${x.gridWidth}px`).join(' / '));
  rec('全文がテキストとして読める(titleに頼らない)',
   m.every(x=>!x.text.includes('…')),m.map(x=>x.text.slice(0,20)).join(' / '));

  // 後始末
  await page.evaluate(async()=>{
   if(typeof S!=='undefined'&&S.measure&&typeof reliableDelete==='function')
    await reliableDelete(S.measure.id);
  }).catch(()=>{});

  console.log('\n=== SUMMARY ===');
  const f=R.filter(r=>!r.ok);console.log(`${R.length-f.length}/${R.length} passed`);
  f.forEach(x=>console.log(' -',x.n,x.d||''));
  await b.close();process.exit(f.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  await b.close().catch(()=>{});
  process.exit(2);
 }
})().catch(async e=>{
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
