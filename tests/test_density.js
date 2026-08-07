/* test_density.js: 一覧の密度と、右端に隠れがちな操作列、
   そして再読込の選び方（§9.78）。
   ------------------------------------------------------------
   指摘は3つあった。
     ・作業スケジュールの削除などのボタンが一番右端で、幅を変えると隠れる
     ・列の間と区分バッジが余白を取りすぎて、入る情報が少ない
     ・仕掛一覧も作業スケジュールも縦に余白がありすぎる
   「詰めた」は主観になりやすいので、**行ピッチと到達性**という測れる形で
   固定する。詰めすぎて文字が切れては本末転倒なので、溢れ検査
   (tests/test_fit.js)と対で見ること。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
/* 行ピッチの上限(標準サイズ)。以前は39px。ここを超えたら「また太った」。
   下限も見る——0に近い値は、行が潰れて読めなくなっている合図。 */
const MAX_ROW_PITCH=37, MIN_ROW_PITCH=24;

const setMode=async m=>{await fetch(`${API}/api/access-mode`,
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 const settle=(ms=700)=>page.waitForTimeout(ms);
 try{
  await setMode('edit');
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:20000});
  await page.click('aside [data-db-key="SIKALOTNOW"]');
  await settle(1800);

  /* ---- 1) 仕掛一覧の行ピッチ ---- */
  const pitchOf=sel=>page.evaluate(s=>{
   const rows=[...document.querySelectorAll(s)].slice(0,10);
   if(rows.length<2)return 0;
   const a=rows[0].getBoundingClientRect().top,z=rows[rows.length-1].getBoundingClientRect().top;
   return Math.round((z-a)/(rows.length-1));
  },sel);
  const listPitch=await pitchOf('#grid tbody tr');
  rec('仕掛一覧の行が詰まっている',listPitch>=MIN_ROW_PITCH&&listPitch<=MAX_ROW_PITCH,
      `${listPitch}px (上限${MAX_ROW_PITCH})`);

  /* ---- 2) 再読込は読み直し方を選べる ---- */
  await page.click('#reload');await settle(900);
  const menu=await page.evaluate(()=>{
   const m=document.getElementById('reloadMenu');if(!m)return null;
   return [...m.querySelectorAll('button')].map(x=>({
    action:x.dataset.reloadAction||'',
    label:(x.querySelector('span')||{}).textContent||'',
    hint:(x.querySelector('small')||{}).textContent||'',
    disabled:x.disabled}));
  });
  rec('再読込を押すと選択肢が出る',!!menu&&menu.length>=2,
      menu?menu.map(x=>x.action).join('/'):'メニューが出ない');
  rec('「一覧を再読込」が選べる',!!menu&&menu.some(x=>x.action==='list'&&!x.disabled));
  const rne=menu&&menu.find(x=>x.action==='rne');
  rec('「RNEファイルから作成」の項目がある',!!rne,rne?rne.label:'なし');
  /* 実行できない端末では**隠さずに理由を出す**。あるはずの機能を探させない。 */
  rec('実行できないときは理由が読める',!rne||!rne.disabled||rne.hint.length>4,
      rne?`${rne.disabled?'無効':'有効'}: ${rne.hint}`:'-');
  await page.mouse.click(5,600);await settle(400);
  rec('画面の他所を押すと閉じる',
      await page.evaluate(()=>!document.getElementById('reloadMenu')));

  /* 「一覧を再読込」が実際に効く(押しても何も起きない、にしない) */
  await page.click('#reload');await settle(600);
  await page.evaluate(()=>document.querySelector('[data-reload-action="list"]').click());
  await settle(1500);
  rec('「一覧を再読込」で一覧が出ている',
      await page.evaluate(()=>!!document.querySelector('#grid tbody tr')));

  /* ---- 3) RNE抽出の進捗表示の器 ---- */
  const prog=await page.evaluate(()=>{
   const box=document.getElementById('rneProgress');
   if(!box)return null;
   const bar=document.getElementById('rneProgressBar');
   return {hidden:box.hidden,role:box.getAttribute('role'),
           hasBar:!!bar&&bar.getAttribute('role')==='progressbar',
           hasFill:!!bar?.querySelector('i'),
           hasJobs:!!document.getElementById('rneProgressJobs')};
  });
  rec('RNE抽出の進捗バーが用意されている',
      !!prog&&prog.hasBar&&prog.hasFill&&prog.hasJobs,JSON.stringify(prog));
  rec('進捗バーは普段は出ていない',!!prog&&prog.hidden===true);
  /* 割合はカスタムプロパティで渡す(見た目の指定はCSSに残す)。 */
  const bar=await page.evaluate(()=>{
   const box=document.getElementById('rneProgress');
   const fill=document.querySelector('#rneProgressBar i');
   if(!fill||!box)return null;
   box.hidden=false;                       // 隠れたままでは寸法が測れない
   fill.style.setProperty('--rne-pct','50%');
   const w=fill.getBoundingClientRect().width;
   const track=document.getElementById('rneProgressBar').getBoundingClientRect().width;
   fill.style.removeProperty('--rne-pct');
   box.hidden=true;
   return {w:Math.round(w),track:Math.round(track)};
  });
  rec('割合を渡すとバーが伸びる',!!bar&&bar.track>0&&Math.abs(bar.w-bar.track/2)<=2,
      bar?`${bar.w}/${bar.track}px`:'-');

  /* ---- 4) 作業スケジュール: 行の密度と操作列の到達性 ---- */
  await page.click('#openSchedule');await settle(2500);
  const scPitch=await pitchOf('.sc-row-line');
  rec('作業スケジュールの行が詰まっている',scPitch>=MIN_ROW_PITCH&&scPitch<=MAX_ROW_PITCH,
      `${scPitch}px (上限${MAX_ROW_PITCH})`);
  /* 区分は「ただの状態表示」。押せる部品の高さ(--ctl-h-xs=26px)を
     占有していたら、また行が厚くなる。 */
  const cat=await page.evaluate(()=>{
   const c=document.querySelector('.sc-row-cat');if(!c)return null;
   const ctl=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ctl-h-xs'))||26;
   return {h:Math.round(c.getBoundingClientRect().height),ctl:Math.round(ctl)};
  });
  rec('区分バッジが押せる部品ほどの高さを取っていない',
      !!cat&&cat.h<cat.ctl,cat?`${cat.h}px < ${cat.ctl}px`:'-');

  /* 本題。幅を狭めても操作ボタンへ手が届くこと。 */
  for(const w of [1600,1200,980]){
   await page.setViewportSize({width:w,height:1000});
   await settle(800);
   const hit=await page.evaluate(()=>{
    const row=document.querySelector('.sc-row-line');if(!row)return null;
    const act=row.querySelector('.sc-row-actions');const btn=act&&act.querySelector('button');
    if(!btn)return {noButton:true};
    const r=btn.getBoundingClientRect();
    const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    const wrap=row.closest('.sc-timeline');
    return {reachable:!!(top&&(top===btn||btn.contains(top)||top.closest('.sc-row-actions'))),
            overflow:wrap?Math.round(wrap.scrollWidth-wrap.clientWidth):0,
            sticky:getComputedStyle(act).position};
   });
   rec(`幅${w}pxでも操作ボタンを押せる`,!!hit&&(hit.noButton||hit.reachable),
       hit?`はみ出し${hit.overflow}px / ${hit.sticky}`:'行が無い');
  }
  await page.setViewportSize({width:1600,height:1000});await settle(500);

  console.log('\n=== SUMMARY ===');
  const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
  ng.forEach(x=>console.log(' -',x.n,x.d||''));
  await b.close();
  process.exit(ng.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  await b.close().catch(()=>{});
  process.exit(2);
 }
})().catch(async e=>{console.error('FATAL',e);if(b)await b.close().catch(()=>{});process.exit(2)});
