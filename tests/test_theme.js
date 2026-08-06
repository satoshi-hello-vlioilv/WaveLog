/* test_theme.js: 配色・文字サイズの統一（トークン化）と、
   作業スケジュールの削除ボタン表記・アクセス権限の対象設備（複数/すべて）。
   ------------------------------------------------------------
   「統一感」は主観になりやすいので、**実測できる形**に落として固定する:
    - 文字サイズは表示サイズ(--ui-scale)へ必ず追随する＝拡大で全部が変わる
    - 同じ役割の色は同じ値になる（枠線・補助文字の種類数が増えていない）
    - 測定画面の地色が一覧画面と同じ（以前は選択項目が常時琥珀だった） */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const API='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(`${API}/api/access-mode`,
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 try{
  await setMode('edit');
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#grid',{timeout:20000});
  await page.waitForTimeout(1500);

  /* ---- 1) CSSに残るリテラルの文字サイズは印刷物だけ ---- */
  const css=await page.evaluate(async()=>{
   const link=[...document.styleSheets].map(s=>s.href).find(h=>h&&h.includes('app.css'));
   return await (await fetch(link)).text();
  });
  const noComment=css.replace(/\/\*[\s\S]*?\*\//g,'');
  const literals=[];
  noComment.split('\n').forEach((l,i)=>{
   const m=l.match(/font-size:\s*[0-9.]+px/);
   if(m)literals.push({line:i+1,text:l.trim().slice(0,60)});
  });
  // A4帳票(.rp-page配下 / .df-page配下)とサイズ見本だけが例外。
  const pageStart=noComment.split('\n').findIndex(l=>l.startsWith('.rp-page{'));
  const stray=literals.filter(x=>!/rp-|df-|ui-size-swatch/.test(x.text)&&x.line<pageStart);
  rec('文字サイズのリテラルpxは印刷物とサイズ見本だけ',stray.length===0,
   stray.map(x=>`${x.line}:${x.text}`).join(' / ').slice(0,200));

  /* ---- 2) 表示サイズを変えると測定画面の文字も全部変わる ---- */
  const sizes=await page.evaluate(async()=>{
   const pick=()=>{
    const ids=['#search','#pageSize'];
    const els=[...document.querySelectorAll('.nav-item span'),...ids.map(s=>document.querySelector(s))].filter(Boolean);
    return els.slice(0,6).map(e=>parseFloat(getComputedStyle(e).fontSize));
   };
   document.documentElement.dataset.uiSize='md';const md=pick();
   document.documentElement.dataset.uiSize='xl';const xl=pick();
   document.documentElement.dataset.uiSize='md';
   return {md,xl};
  });
  rec('表示サイズの変更が全体の文字へ効く',
   sizes.md.length>0&&sizes.md.every((v,i)=>sizes.xl[i]>v),
   `中=${sizes.md.join(',')} / 特大=${sizes.xl.join(',')}`);

  /* ---- 3) 中間色の種類が増えていない（同じ役割は同じ値） ---- */
  const neutrals=[...noComment.matchAll(/#([0-9a-fA-F]{6})\b/g)].map(m=>m[1].toLowerCase())
   .filter(h=>{const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
    return Math.max(r,g,b)-Math.min(r,g,b)<=22});
  const kinds=new Set(neutrals).size;
  rec('中間色(枠線・面・補助文字)の種類が抑えられている',kinds<=95,`${kinds}種`);

  /* ---- 4) 測定画面の地色が一覧画面と同じ ---- */
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:20000});
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r)r.querySelector('.sc-row-start').click();return !!r;
  });
  rec('予定から測定画面を開ける',started);
  if(!started)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:20000});
  await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000}).catch(()=>{});

  const bg=await page.evaluate(()=>{
   const cs=id=>{const el=document.getElementById(id);return el?getComputedStyle(el).backgroundColor:''};
   return {chosen:cs('widthOrder'),chosen2:cs('unwind'),burr:cs('burr'),
           pending:cs('inspector'),
           pendingShadow:(()=>{const el=document.getElementById('inspector');return el?getComputedStyle(el).boxShadow:''})()};
  });
  rec('選択済みのコントロールは白（一覧画面と同じ地色）',
   bg.chosen==='rgb(255, 255, 255)'&&bg.chosen2==='rgb(255, 255, 255)'&&bg.burr==='rgb(255, 255, 255)',
   JSON.stringify(bg));
  rec('未選択だけが淡い色で、面ではなく左のバーで合図する',
   bg.pending!=='rgb(255, 255, 255)'&&/inset/.test(bg.pendingShadow),JSON.stringify(bg));
  // 以前の琥珀(#fff0d6 = rgb(255,240,214))そのままではないこと
  rec('未選択の色は警告色そのままではない（淡い）',
   bg.pending!=='rgb(255, 240, 214)',bg.pending);

  const blue=await page.evaluate(()=>{
   const st=[...document.styleSheets].flatMap(s=>{try{return [...s.cssRules]}catch(e){return []}})
    .map(r=>r.cssText||'').join('\n');
   return /0b79c9/i.test(st);
  });
  rec('一覧の選択色がパレット外の原色ではない',!blue,String(blue));

  /* ---- 5) 作業スケジュールの削除ボタン表記 ----
     実績削除のボタンは「実績のある行」にしか出ない。フィクスチャの予定には
     実績が無いので、いま開いている測定画面を「編集中」で保存して作業中に
     してから、スケジュールを開き直して確かめる(test_scsyncと同じ手順)。 */
  await page.click('#saveDraft');
  await page.waitForTimeout(3500);
  await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000}).catch(()=>{});
  await page.waitForFunction(()=>document.querySelector('#measureModal')?.hidden,null,{timeout:20000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:20000});
  await page.waitForTimeout(2500);
  const labels=await page.evaluate(()=>{
   const btns=[...document.querySelectorAll('.sc-row-delete-history')];
   return {n:btns.length,texts:[...new Set(btns.map(b=>b.textContent.trim()))],
           titles:[...new Set(btns.map(b=>b.title))]};
  });
  rec('実績のある行に削除ボタンが出る',labels.n>0,JSON.stringify(labels));
  rec('実績削除のボタンが「削除」と読める',
   labels.texts.length>0&&labels.texts.every(t=>/削除/.test(t)&&!/実績/.test(t)),
   JSON.stringify(labels.texts));
  rec('ボタンの説明に何を消すのか書いてある',
   labels.titles.length>0&&labels.titles.every(t=>/測定データ/.test(t)&&/削除/.test(t)),
   JSON.stringify(labels.titles));

  await page.evaluate(async()=>{
   if(typeof S!=='undefined'&&S.measure&&typeof reliableDelete==='function')
    await reliableDelete(S.measure.id);
  }).catch(()=>{});

  /* ---- 6) アクセス権限: 対象設備の複数指定と「すべての設備」 ---- */
  const rule=await page.evaluate(()=>({
   none:WL.fieldReorderAllows('','テスト設備A'),
   one:WL.fieldReorderAllows('テスト設備A','テスト設備A'),
   oneNg:WL.fieldReorderAllows('テスト設備A','テスト設備B'),
   many:WL.fieldReorderAllows('テスト設備A,テスト設備B','テスト設備B'),
   manyNg:WL.fieldReorderAllows('テスト設備A,テスト設備B','テスト設備C'),
   all:WL.fieldReorderAllows('*','どの設備でも'),
   labelAll:WL.fieldReorderLabel('*'),
   labelMany:WL.fieldReorderLabel('テスト設備A,テスト設備B'),
   labelNone:WL.fieldReorderLabel(''),
  }));
  rec('未設定は権限なし（空欄＝全許可ではない）',rule.none===false,JSON.stringify(rule));
  rec('1設備の指定はその設備だけ',rule.one===true&&rule.oneNg===false,JSON.stringify(rule));
  rec('複数設備を指定できる',rule.many===true&&rule.manyNg===false,JSON.stringify(rule));
  rec('「すべての設備」はどの設備でも許可',rule.all===true,String(rule.all));
  rec('表示名が読める形になる',
   rule.labelAll==='すべての設備'&&rule.labelMany==='テスト設備A / テスト設備B'&&rule.labelNone==='',
   JSON.stringify([rule.labelAll,rule.labelMany,rule.labelNone]));

  // マスタ管理の入力欄
  await setMode('edit');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:20000});
  await page.waitForTimeout(1200);
  await page.click('#openMasterMaint');await page.waitForTimeout(1500);
  await page.click('#masterMaintNav [data-master="accessPermission"]');await page.waitForTimeout(2000);
  const form=await page.evaluate(()=>{
   const btn=document.querySelector('#masterMaintPanel .mm-new,#masterMaintPanel [data-mm-new]')
    ||[...document.querySelectorAll('#masterMaintPanel button')].find(b=>/新規|追加/.test(b.textContent));
   if(btn)btn.click();
   const all=document.querySelector('[data-equipment-all="fieldReorderEquipment"]');
   const box=document.querySelector('[data-equipment-box="fieldReorderEquipment"]');
   const legacy=document.querySelector('select[data-field="fieldReorderEquipment"]');
   return {hasAll:!!all,hasBox:!!box,legacySelect:!!legacy,
           label:(all?.closest('label')?.textContent||'').trim()};
  });
  rec('対象設備の欄に「すべての設備」がある',form.hasAll&&/すべての設備/.test(form.label),JSON.stringify(form));
  rec('対象設備は複数選べるタグ入力になっている',form.hasBox&&!form.legacySelect,JSON.stringify(form));
  const toggled=await page.evaluate(()=>{
   const all=document.querySelector('[data-equipment-all="fieldReorderEquipment"]');
   all.checked=true;all.dispatchEvent(new Event('change',{bubbles:true}));
   const box=document.querySelector('[data-equipment-box="fieldReorderEquipment"]');
   const search=document.querySelector('[data-equipment-search="fieldReorderEquipment"]');
   return {disabled:box.classList.contains('is-disabled'),searchDisabled:!!search.disabled};
  });
  rec('「すべての設備」を選ぶと個別選択は触れなくなる',
   toggled.disabled&&toggled.searchDisabled,JSON.stringify(toggled));

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
