/* test_smalltext.js: 読ませる字は 12px 以上（§9.560）・字の太さは3段（§9.562）・字の灰色は3段（§9.564）
   ------------------------------------------------------------
   利用者の指摘:「まだ残っている統一基準になってない小さな文字や冗長な表示や表現」（§9.556）、
   続けて「残りの小さな字の修正を進めてください」。

   決まり: **読ませる字（文字・数字を含む字）は`--fs-sm`（12px）以上**。10〜11px（`--fs-badge`／`--fs-micro`）・
   9.5px（`--fs-tiny`）は**図の中の字**（目盛り・寸法・凡例）と、開閉の印（▾）のような**記号だけ**の物に使う。
   ここで数えないもの（理由つき）:
    ・SVG／canvas の中の字 … 図の目盛り・寸法。図の縮尺と一緒に決まる
    ・紙（帳票・印刷の見本）… 用紙の寸法で決める（`print-core.js`）
    ・記号だけの字（▾▸◂▴×✕…・など）… 読ませる字ではなく印
   表示サイズは既定（md・倍率1）で測る。sm（.92）では 12px が 11.04px になるが、それは利用者が選んだ縮小。

   画面ごとに「12px 未満の読ませる字」を数え、**0**を見張る（巡回する画面は下の`visit`）。 */
'use strict';
const {run}=require('./lib/harness.js');

/* 記号だけの字（読ませる字ではない）。 */
const GLYPH=/^[\s▾▸◂▴▼▲►◄×✕✓✔…・·|｜/／\-–—+＋※●○◆◇■□▪▫★☆♪→←↑↓⇄⇅↺↻⟳💬🔒🔓⚠⠿]*$/u;

run('test_smalltext: 読ませる字は 12px 以上（§9.560）',async({page,rec,B,W,idle})=>{
 const settle=async()=>{await idle(400,15000);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))};
 const collect=name=>page.evaluate(([name,glyph])=>{
  const G=new RegExp(glyph,'u');
  const out=[];
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  const seen=new Set();
  while(walker.nextNode()){
   const t=walker.currentNode;const tx=t.textContent.trim();
   if(!tx||G.test(tx))continue;
   const el=t.parentElement;if(!el||seen.has(el))continue;seen.add(el);
   if(el.closest('svg,canvas,.rp-page,.df-page,.rp-report,.df-print-area,script,style,template,noscript,[hidden],[aria-hidden="true"]'))continue;
   const r=el.getBoundingClientRect();
   if(r.width<1||r.height<1||r.bottom<0||r.right<0||r.top>innerHeight||r.left>innerWidth)continue;
   const s=getComputedStyle(el);
   if(s.visibility==='hidden'||+s.opacity===0)continue;
   const fs=parseFloat(s.fontSize);
   /* 字の灰色は3段（§9.564）: 明るい地の上の中立の灰色は --ink／--ink-2／--muted のどれか（濃い地・使えない物は数えない） */
   {const m=/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s.color);
    if(m&&!el.closest(':disabled,[disabled],.is-disabled')){const [r,g,b]=[+m[1],+m[2],+m[3]];
     const gray=Math.max(r,g,b)-Math.min(r,g,b)<=45&&b>=r&&g>=r-4&&Math.max(r,g,b)<190;
     let e=el,bg='';while(e){const c=getComputedStyle(e).backgroundColor;if(c&&c!=='transparent'&&!/rgba\(\d+, \d+, \d+, 0\)/.test(c)){bg=c;break}e=e.parentElement}
     const bm=/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg||'rgb(255,255,255)');const light=bm&&(+bm[1]+ +bm[2]+ +bm[3])/3>200;
     const ok=['rgb(23, 39, 45)','rgb(58, 86, 93)','rgb(96, 116, 123)'];
     if(gray&&light&&!ok.includes(s.color.replace(/rgba\((\d+), (\d+), (\d+), 1\)/,'rgb($1, $2, $3)')))window.__wlOddGray=(window.__wlOddGray||[]).concat(name+':'+s.color+' '+tx.slice(0,10));}}
   /* 太さは3段（§9.562）。アイコンの字体（Font Awesome の solid は 900）は数えない */
   if(![400,600,700].includes(+s.fontWeight)&&!/Font Awesome/.test(s.fontFamily))window.__wlOddW=(window.__wlOddW||[]).concat(name+':'+s.fontWeight+' '+tx.slice(0,10));
   /* 字を大きくした副作用の見張り: 省略記号で切れている字（数えるだけ・#MEASURE） */
   if(s.textOverflow==='ellipsis'&&el.scrollWidth>el.clientWidth+1)window.__wlCut=(window.__wlCut||[]).concat(name+':'+tx.slice(0,12));
   if(fs>=11.95)continue;
   const cls=(el.className&&el.className.baseVal===undefined?String(el.className):'').trim();
   out.push({screen:name,fs:Math.round(fs*100)/100,tx:tx.slice(0,24),sel:el.tagName.toLowerCase()+(cls?'.'+cls.split(/\s+/).join('.'):'')+(el.id?'#'+el.id:'')});
  }
  return out;
 },[name,GLYPH.source]);
 const found=[];
 const visit=async(name,fn)=>{await fn();await settle();found.push(...await collect(name));
  /* WAVELOG_SHOT=<dir> のときだけ、画面ごとの見た目を書き出す（字を大きくした結果を目で確かめる用） */
  if(process.env.WAVELOG_SHOT)await page.screenshot({path:require('path').join(process.env.WAVELOG_SHOT,`small_${name}.png`)});
 };
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 await page.reload({waitUntil:'domcontentloaded'});await W.booted(page);
 await visit('起動直後',async()=>{});
 await visit('測定データ一覧',()=>page.click('#homeDrafts'));
 await visit('測定実績',()=>page.click('#openActuals'));
 await visit('仕掛一覧',()=>page.click('aside [data-db-key="SIKALOTNOW"]'));
 await visit('作業スケジュール',()=>page.click('#openSchedule'));
 await visit('マスタ管理・設備',async()=>{
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintNav [data-master="equipment"]',{timeout:15000});
  await page.click('#masterMaintNav [data-master="equipment"]');
 });
 await visit('マスタ管理・共通設定',()=>page.click('#masterMaintNav [data-master="pathConfig"]'));
 await visit('マスタ管理・アプリの更新',async()=>{
  await page.evaluate(()=>{const b=[...document.querySelectorAll('#masterMaintForm [role=tab],#masterMaintForm button')].find(x=>x.textContent.trim().startsWith('アプリの更新'));b&&b.click()});
  await page.waitForSelector('#appUpdate .au-where,#appUpdate .au-bad',{timeout:15000}).catch(()=>{/* 届かない置き場でも数える */});
 });
 const by={};found.forEach(f=>{(by[f.screen]=by[f.screen]||[]).push(f)});
 const cut=await page.evaluate(()=>window.__wlCut||[]);
 const oddW=await page.evaluate(()=>window.__wlOddW||[]);
 const oddGray=await page.evaluate(()=>window.__wlOddGray||[]);
 console.log('#MEASURE '+JSON.stringify({cut:cut.length,cutList:cut.slice(0,40)}));
 console.log('#MEASURE '+JSON.stringify({total:found.length,perScreen:Object.fromEntries(Object.entries(by).map(([k,v])=>[k,v.length]))}));
 if(process.env.WAVELOG_SHOT)require('fs').writeFileSync(require('path').join(process.env.WAVELOG_SHOT,'smalltext.json'),JSON.stringify({found,cut},null,1));
 const kinds=[...new Set(found.map(f=>`${f.sel} ${f.fs}px「${f.tx}」`))];
 rec('読ませる字に 12px 未満が無い（画面を巡回して数える）',found.length===0,`${found.length}件 ${kinds.slice(0,8).join(' / ')}`);
rec('描いた字の太さは 400／600／700 の3段だけ（§9.562・500 は 400 と同じに、800・900 は英数字だけ Black になる）',
  oddW.length===0,`${oddW.length}件 ${oddW.slice(0,6).join(' / ')}`);
rec('明るい地の上の灰色の字は3段（--ink／--ink-2／--muted）だけ（§9.564）',
  oddGray.length===0,`${oddGray.length}件 ${[...new Set(oddGray)].slice(0,6).join(' / ')}`);
},{mode:'edit',viewport:{width:1728,height:1152}});
