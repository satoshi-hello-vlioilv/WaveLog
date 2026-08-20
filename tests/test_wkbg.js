/* 作業可否フラグが操作を止めないこと・裏で追いつくこと(§9.51)、
   RNE抽出が取得元に依らず実行できること(§9.50)の検証 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(B+'/api/access-mode',{method:'POST',
 headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 await setMode('edit');

 // 仕掛の取得をわざと遅らせ、「可否の取得を待たずに予定が出るか」を見る。
 // 索引は仕掛を500件ずつ辿る(§9.57)ので、遅らせるのは**最初の1回だけ**に
 // する(全ページを遅らせると、確かめたい「後から埋まる」まで到達しない)。
 //
 // **見分けの手掛かりが今も存在するかを確かめること**(§9.200)。ここは
 // 以前`include_hidden`が付いているかで見分けていたが、§9.165でその引数は
 // 廃止され、**どの問い合わせにも付かなくなっていた**——つまり遅延が一度も
 // 効いておらず、「材料が揃う前は?」は**たまたま間に合っていただけ**で、
 // 通しの実行で実際に落ちた(is-ok 30件/is-ng 11件)。
 // いまの手掛かりは可否索引のページ送り(page_size=500・search=空)。
 const WORKABLE_PAGE_SIZE=500;   // schedule-view.js の同名の定数と合わせる
 let holdTable=true,held=0;
 await page.route('**/api/table?*',async r=>{
  const u=r.request().url();
  if(holdTable&&held===0&&u.includes('SIKALOTNOW')&&u.includes('page_size='+WORKABLE_PAGE_SIZE)){
   held++;
   await new Promise(x=>setTimeout(x,6000));
  }
  await r.continue();
 });

 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.waitForTimeout(1200);

 const t0=Date.now();
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-row-line',{timeout:20000});
 const shownAt=Date.now()-t0;
 rec('可否の取得(6秒遅延)を待たずに予定が表示される',shownAt<5000,shownAt+'ms');

 /* この時点では**索引をまだ作っていない**。
    **「?」の件数で見ないこと**——予定の行は作られた時点の残仕掛設備ｺｰｽを
    detailに持っていることがあり（§9.67）、その行は索引を引く前から可否が
    確定している。フィクスチャの中身で0件にも41件にもなるので、件数で見ると
    **通しの実行で落ちる**（実際に is-ok 30 / is-ng 11 で落ちた）。
    ここで確かめたい約束は2つで、どちらも中身に依らない:
      ・材料(仕掛)を読み終える前に予定を描いている（索引が空のまま出ている）
      ・**材料の無い行を勝手に「可」にしない** */
 const early=await page.evaluate(()=>{
  const st=window.scheduleWorkableState();
  const c={};let 材料なし=0,材料なしで可=0;
  [...document.querySelectorAll('.sc-row-line')].forEach(n=>{
   const w=n.querySelector('.sc-row-workable');if(!w)return;
   const k=[...w.classList].find(x=>x.startsWith('is-'));c[k]=(c[k]||0)+1;
   const e=n.__scEntry;if(!e||e.kind!=='作業')return;
   const known=!!(e.detail&&String(e.detail.residualCourse??'')!=='');
   if(!known){材料なし++;if(k==='is-ok')材料なしで可++}
  });
  return {c,indexSize:st.indexSize,材料なし,材料なしで可};
 });
 rec('材料(仕掛)を読み終える前に予定を描いている',early.indexSize===0,JSON.stringify(early));
 rec('判定材料が揃う前は「?」で出す(勝手に可にしない)',
   early.材料なしで可===0,JSON.stringify(early));

 // 待機オーバーレイが出っぱなしになっていない = 操作できる
 const overlayHidden=await page.evaluate(()=>document.querySelector('#saveOverlay').hidden);
 rec('待機表示で操作が止まっていない',overlayHidden);

 // 遅延分が明けると、フラグだけが後から埋まる
 await page.waitForFunction(()=>[...document.querySelectorAll('.sc-row-workable')]
   .some(n=>n.classList.contains('is-ok')||n.classList.contains('is-ng')),{timeout:20000});
 const later=await page.$$eval('.sc-row-line .sc-row-workable',ns=>{
  const c={};ns.forEach(n=>{const k=[...n.classList].find(x=>x.startsWith('is-'));c[k]=(c[k]||0)+1});return c;
 });
 rec('取得できたら可否が後から埋まる',(later['is-ok']||0)>0&&(later['is-ng']||0)>0,JSON.stringify(later));
 /* **遅らせる問い合わせを実際に捕まえたか**（§9.200）。捕まえていなければ
    「6秒遅らせた」という前提そのものが成り立っておらず、上の2件は
    何も確かめていない。**ここで見る**——索引の取得は最初の描画より後に
    始まるので、描いた直後に数えると必ず0件になる（実際にそう落ちた）。 */
 rec('遅らせる問い合わせを実際に捕まえた（この網が空振りしていないこと）',
     held>0,`捕まえた${held}件`);

 // 差し替えは行を作り直さない(スクロール位置・展開状態を壊さない)
 const stable=await page.evaluate(async()=>{
  const first=document.querySelector('.sc-row-line');
  first.dataset.probe='keep';               // 目印を付ける
  await window.refreshScheduleWorkable(true); // 可否だけ差し替える
  const again=document.querySelector('.sc-row-line');
  return {kept:again.dataset.probe==='keep',same:first===again};
 });
 rec('可否の反映で行を作り直さない(操作中の状態を壊さない)',stable.kept&&stable.same,JSON.stringify(stable));

 // 可になった行には開始ボタンが後から現れる
 const startBtns=await page.$$eval('.sc-row-line',ns=>ns.filter(n=>{
  const w=n.querySelector('.sc-row-workable');
  return w&&w.classList.contains('is-ok')&&/予定/.test(n.querySelector('.sc-row-cat')?.textContent||'');
 }).map(n=>!!n.querySelector('.sc-row-start')));
 rec('可になった予定には開始ボタンが後から出る',
   startBtns.length>0&&startBtns.every(Boolean),startBtns.length+'件');

 // 可でない行が残っている間は裏の見張りが動いている
 const watching=await page.evaluate(()=>{
  const pending=[...document.querySelectorAll('.sc-row-line')].some(n=>{
   const w=n.querySelector('.sc-row-workable');
   return w&&!w.classList.contains('is-ok')&&!w.classList.contains('is-na')
          &&/予定/.test(n.querySelector('.sc-row-cat')?.textContent||'');
  });
  return {pending,hasTimer:window.scheduleWorkableState().watching};
 });
 rec('可でない予定が残っている間は裏で追いかける',watching.pending&&watching.hasTimer,JSON.stringify(watching));

 // 画面を出たら止める(無駄な問い合わせを残さない)
 await page.evaluate(()=>window.exitScheduleView());
 await page.waitForTimeout(400);
 const stopped=await page.evaluate(()=>!window.scheduleWorkableState().watching);
 rec('画面を出たら裏の見張りを止める',stopped);

 holdTable=false;

 // ---- RNE抽出: 取得元に依らず実行できる ----
 // RNE資材はリポジトリに含めない(実環境でPCごとに配置する)ため、
 // 「配置されている」状態をこのテスト内で一時的に作ってから確かめる。
 const fs=require('fs'),path=require('path');
 const AD=require('path').join(__dirname,'..','config','rne_extract');
 const made=[];
 const put=(rel,body)=>{const f=path.join(AD,rel);
  fs.mkdirSync(path.dirname(f),{recursive:true});
  if(!fs.existsSync(f)){fs.writeFileSync(f,body);made.push(f)}};
 put('symnavim.conf','[dummy]\n');
 put('rne/SIKALOTNOW.RNE','dummy');
 put('rne/SIKALOTDEF.RNE','dummy');

 const rne=await page.evaluate(async()=>{
  const s=await fetch('/api/rne-extract/status').then(x=>x.json());
  return {source:s.source,scheduleMode:s.scheduleMode,enabled:s.enabled,canRun:s.canRun};
 });
 rec('network運用でも手動実行は可能(canRun)',rne.source==='network'&&rne.canRun===true,JSON.stringify(rne));
 const run=await page.evaluate(async()=>{
  const r=await fetch('/api/rne-extract/run',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({user_id:'t'})});
  return {status:r.status,body:await r.json()};
 });
 rec('取得元がnetworkのままでも「今すぐ抽出」を受け付ける',
   run.status===200&&run.body.started===true,JSON.stringify(run.body).slice(0,90));
 // 一時的に置いた資材を片付ける(リポジトリには残さない)
 made.forEach(f=>{try{fs.unlinkSync(f)}catch(e){}});

 await b.close();
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{
 // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
 // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
 // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
