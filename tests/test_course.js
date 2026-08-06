/* test_course.js: 測定画面のコース情報が見切れないこと。
   ------------------------------------------------------------
   コース(設計/実績/残)は設備の連なりなので、他の基本情報と違って長くなる。
   実機では「3文字+空白」×25程度=100文字近く、平均でも4文字×10=40文字前後。
   2列グリッドの半分の幅へ nowrap+省略記号で入れると必ず末尾が切れ、
   ホバーして title を読まないと分からなかった。
   **3項目とも縦に1行ずつ・常に全幅**にしてある(以前は長いものだけ全幅に
   していたが、平均的な長さですら半分幅に入らないうえ、値の長さで行の位置が
   動いて読み取りにくかった)。
   フィクスチャのコースは短い(最大14文字)ので実機の長さを再現しない。
   **実機相当の長い値を注入して測る**。 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const API='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(`${API}/api/access-mode`,
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
// 実機の残仕掛設備ｺｰｽ相当(設備名が連なる)。半分幅では確実に入らない長さ。
const LONG='テスト設備A C1 テスト設備B C2 テスト設備C C3 テスト設備D C4 テスト設備E C5';
// 実機の最長ケース: 「3文字+空白」×25 ≒ 100文字。
const MAXCASE=Array.from({length:25},(_,i)=>['LS4','HOT','AN2','DL2','CL1'][i%5]).join(' ');
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

  const probe=()=>page.evaluate(()=>{
   const g=document.querySelector('#basicInfo .info-grid');
   const out=[...g.querySelectorAll('.field')]
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
             top:Math.round(f.getBoundingClientRect().top),
             gridWidth:Math.round(g.getBoundingClientRect().width)};
    });
   const lp=document.querySelector('.left-pane');
   return {out,over:lp.scrollHeight-lp.clientHeight};
  });
  const {out:m}=await probe();
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
  // 縦並び: 3項目のtopが全部違う(横に2つ並んだ瞬間があってはいけない)
  rec('設計/実績/残が縦に1行ずつ並ぶ',
   new Set(m.map(x=>x.top)).size===m.length,m.map(x=>`${x.label}:${x.top}`).join(' / '));
  rec('全文がテキストとして読める(titleに頼らない)',
   m.every(x=>!x.text.includes('…')),m.map(x=>x.text.slice(0,20)).join(' / '));

  /* 短い値でも同じ形(縦1行ずつ・全幅)であること。以前は長いときだけ全幅に
     切り替えていたので、ロットによって行の位置が動いていた。 */
  await page.evaluate(()=>{
   const src=S.measure.source=S.measure.source||{};
   src['設計_設備ｺｰｽ']='LS4';src['実績_設備ｺｰｽ']='HOT';src['残仕掛設備ｺｰｽ']='AN2';
   if(typeof renderCourseHierarchy==='function')renderCourseHierarchy();
  }).catch(()=>{});
  await page.waitForTimeout(600);
  const {out:sh}=await probe();
  rec('短い値でも縦1行ずつ・全幅のまま(値の長さで形が変わらない)',
   sh.length>=3&&new Set(sh.map(x=>x.top)).size===sh.length
   &&sh.every(x=>x.fullWidth>x.gridWidth*0.7),
   sh.map(x=>`${x.label}:${x.fullWidth}/${x.gridWidth}px@${x.top}`).join(' / '));

  /* 実機の最長ケース(100文字)でも、表示サイズを特大にして左ペインが破綻しない。
     折り返して縦に伸びるぶんはスクロールで吸収する(切って隠すよりよい)。 */
  await page.evaluate(v=>{
   const src=S.measure.source=S.measure.source||{};
   src['設計_設備ｺｰｽ']=v;src['実績_設備ｺｰｽ']=v;src['残仕掛設備ｺｰｽ']=v;
   if(typeof renderCourseHierarchy==='function')renderCourseHierarchy();
  },MAXCASE).catch(()=>{});
  const worst={};
  for(const s of ['md','lg','xl']){
   await page.evaluate(v=>{document.documentElement.dataset.uiSize=v},s);
   await page.waitForTimeout(400);
   const p=await probe();worst[s]={over:p.over,cut:p.out.map(x=>x.cut)};
  }
  await page.evaluate(()=>{document.documentElement.dataset.uiSize='md'});
  rec('最長100文字でもどの表示サイズでも横に切れない',
   Object.values(worst).every(x=>x.cut.every(c=>c<=1)),JSON.stringify(worst));

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
