/* test_bootui.js: 起動オーバーレイ(#appBoot)の振る舞いを固定する。
   ------------------------------------------------------------
   §9.76。「起動直後だけ一瞬レイアウトが崩れて見える」という指摘の実測では、
   最初の描画(+85ms)から落ち着く(+451ms)までに**5回**の組み替えが起きていた
   (案内バーが出て消える／ナビ項目が5→7／バージョンバッジの文字が変わる／
   モードバッジが現れてヘッダーが組み替わる／一覧の中身が入る)。
   組み上がるまで本体を伏せることで解決している。

   ここで見るのは4つ:
     ・最初の描画から覆いが出ていて、本体が見えていないこと
     ・覆いが外れた**後**に組み替えが起きていないこと(これが本題)
     ・進捗が待機画面から引き継いだ60%で始まり、100%で終わること
     ・**必ず外れること**(段階が終わらなくても時間切れで外す)

   最後の1つが一番重要。覆いが外れないと画面が出ないまま固まるので、
   崩れて見えるより悪い。 */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';
/* base.js の BOOT_TIMEOUT_MS。ここを変えたら向こうも合わせる
   (段階数の一致は tests/test_boot.py が固定している)。 */
const BOOT_TIMEOUT_MS=8000;

run('test_bootui: 起動オーバーレイ(#appBoot)の振る舞いを固定する。', async ({page,rec,B,W,idle,paint,errs,browser})=>{

 /* 起動中の1フレームごとの様子を採る。addInitScript は本体のJSより前に
    走るので、「最初の描画で何が見えていたか」まで拾える。 */
 const RECORDER=()=>{
  window.__boot=[];
  const loop=()=>{
   if(document.body){
    const o=document.getElementById('appBoot');
    const grid=document.getElementById('grid');
    const r=grid?grid.getBoundingClientRect():null;
    window.__boot.push({
     t:Math.round(performance.now()),
     overlay:!o?'none':(o.classList.contains('is-hiding')?'hiding':'shown'),
     booting:document.documentElement.classList.contains('app-booting'),
     pct:parseInt((document.getElementById('bootPct')||{}).textContent||'-1',10),
     ver:(document.getElementById('bootVer')||{}).textContent||'',
     gridVisible:grid?getComputedStyle(grid).visibility==='visible':false,
     gridY:r?Math.round(r.y):0, gridH:r?Math.round(r.height):0,
     navItems:document.querySelectorAll('aside .nav-item').length,
     badge:(document.querySelector('.build-badge')||{}).textContent||'',
     modeShown:!!document.getElementById('accessModeBadge')&&!document.getElementById('accessModeBadge').hidden,
     steps:o?[...o.querySelectorAll('.boot-steps li')].map(x=>x.className||''):null,
    });
   }
   if(performance.now()<12000)requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
 };

 try{
  /* 使用設備が未登録だと一覧を取りに行かないので、実運用に近い状態にする。 */
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  /* 1回目の起動が落ち着いてから開き直す（途中で航行すると取得が宙に浮く）。 */
  await W.booted(page); await idle();

  await page.addInitScript(RECORDER);
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:20000});
  /* 起きないことを見る判定（覆いが外れた後に組み替わらない）の観測窓。
     条件では待てないので、一覧の取得が静まってから 1.2秒（元の窓と同じ長さ）
     静かなままであるまで待つ——その間のフレームを RECORDER が採る。 */
  await idle(1200,8000);
  const f=await page.evaluate(()=>window.__boot);

  rec('起動中の様子を採取できた',f.length>10,`${f.length}フレーム`);
  const first=f[0];
  rec('最初の描画から起動画面が出ている',first.overlay==='shown'&&first.booting,
      `overlay=${first.overlay} booting=${first.booting}`);
  rec('覆っている間は本体が見えていない',
      f.filter(x=>x.overlay==='shown').every(x=>!x.gridVisible),
      `見えたフレーム=${f.filter(x=>x.overlay==='shown'&&x.gridVisible).length}`);

  /* 本題。覆いが外れた後に一覧の位置・高さ・ナビ項目数・バッジが変わって
     いたら、それは利用者から見える組み替え(＝崩れ)が残っているということ。 */
  const after=f.filter(x=>x.overlay==='none');
  const keys=['gridY','gridH','navItems','badge','modeShown'];
  const shifts=after.slice(1).filter((x,i)=>keys.some(k=>x[k]!==after[i][k]));
  rec('覆いが外れた後にレイアウトが組み替わらない',shifts.length===0,
      shifts.length?`${shifts.length}回 (例: +${shifts[0].t}ms)`:`${after.length}フレーム変化なし`);
  /* 逆に、覆っている間には組み替えが起きているはず(=隠す意味がある)。
     ここが0なら、そもそも隠す必要が無かったか、採取が効いていない。 */
  const during=f.filter(x=>x.overlay!=='none');
  const hidden=during.slice(1).filter((x,i)=>keys.some(k=>x[k]!==during[i][k]));
  rec('組み替えは覆いの裏で起きている',hidden.length>0,`${hidden.length}回`);

  const pcts=f.map(x=>x.pct).filter(v=>v>=0);
  rec('進捗は待機画面から引き継いだ60%で始まる',pcts[0]===60,`${pcts[0]}%`);
  rec('進捗は後戻りしない',pcts.every((v,i)=>i===0||v>=pcts[i-1]),
      [...new Set(pcts)].join('→')+'%');
  rec('最後は100%になる',pcts[pcts.length-1]===100,`${pcts[pcts.length-1]}%`);

  const lastSteps=(f.filter(x=>x.steps).pop()||{}).steps||[];
  /* 見せる段は4つ（§9.580・boot_status.PHASES）。途中の様子でも「いま」は1つだけ・最後は全部済み。 */
  rec('段の並びは4つ',lastSteps.length===4,`${lastSteps.length}項目`);
  rec('最後は全段が済みになる',lastSteps.length===4&&lastSteps.every(c=>c.includes('is-done')),
      lastSteps.join(' / '));
  const midSteps=(f.find(x=>x.steps&&x.steps.some(c=>c.includes('is-current')))||{}).steps||[];
  rec('途中は「いま」が1つだけで、前の2段は済み',
      midSteps.filter(c=>c.includes('is-current')).length===1&&midSteps.slice(0,2).every(c=>c.includes('is-done')),
      midSteps.join(' / '));

  /* バージョンはサーバー描画で埋めるので、最初の描画から正しい値が出る。 */
  const ver=await page.evaluate(async()=>(await (await fetch('/api/build')).json()).version);
  rec('起動画面にバージョンが出る(最初の描画から)',first.ver===`VER${ver}`,
      `${first.ver} / API=VER${ver}`);

  rec('覆いはDOMから取り除かれる(後の操作を邪魔しない)',
      await page.evaluate(()=>!document.getElementById('appBoot')));
  /* 伏せる印も外れていること。残ると全画面が visibility:hidden のままになる。 */
  rec('本体を伏せる印が外れている',
      await page.evaluate(()=>!document.documentElement.classList.contains('app-booting')));

  await page.close();

  /* ---- 段階が終わらなくても必ず解除される ----
     権限確認の応答を返さないまま止める。時間切れ(8秒)で覆いが外れ、
     操作できる画面になることを確かめる。 */
  const page2=await browser.newPage({viewport:{width:1600,height:1000}});
  page2.on('pageerror',e=>console.log('[pageerror2]',e.message));
  await page2.route('**/api/access-mode',()=>{/* 応答しない(ぶら下げる) */});
  const t0=Date.now();
  await page2.goto(API+'/',{waitUntil:'domcontentloaded'});
  let released=true;
  try{
   await page2.waitForFunction(()=>!document.documentElement.classList.contains('app-booting'),
     null,{timeout:BOOT_TIMEOUT_MS+6000});
  }catch(e){released=false}
  const waited=Date.now()-t0;
  rec('段階が終わらなくても時間切れで必ず解除される',released,`${waited}ms`);
  rec('時間切れの解除が長すぎない',released&&waited<BOOT_TIMEOUT_MS+4000,`${waited}ms`);
  rec('解除後は画面を操作できる',
      await page2.evaluate(()=>{const b=document.getElementById('openSchedule');
        return !!b&&getComputedStyle(b).visibility==='visible'}));
  await page2.close();

  /* ---- 窓の起動画面（desktop/splash・§9.580）: 窓の段 → 見せる4段 ----
     窓（Rust）が呼ぶ順に splash.step を打ち、段の印・字・進み具合を見る。
     Python の場所（窓の細かな字）は title にだけ残り、画面の字には出ない。 */
  const sp=await browser.newPage({viewport:{width:1536,height:864}});
  await sp.goto('file://'+require('path').resolve(__dirname,'..','desktop','splash','index.html'));
  const seen=await sp.evaluate(()=>{
   const cls=()=>['update','app','screen','ready'].map(k=>document.getElementById('p-'+k).className).join(',');
   const out={};
   splash.step('update','ok','版 2.474.0（配る版と同じ）');out.a=cls();
   splash.step('python','ok','C:\\Python312\\pythonw.exe');out.b=cls();
   out.bText=document.querySelector('#p-app').innerText;out.bTitle=document.querySelector('#p-app').title;
   splash.step('backend','ok','版 2.474.0 ・ 1.2 秒');out.c=cls();
   splash.step('open','now','画面を開いています…');out.d=cls();out.pct=document.getElementById('pct').textContent;
   splash.fail('アプリの中身（Python）が起動できません','No module named flask');
   out.fail=document.getElementById('fail').innerText;out.e=cls();
   return out;
  });
  rec('窓の起動画面: 版がそろえば次の段へ',seen.a==='ok,now,wait,wait',seen.a);
  rec('窓の起動画面: Python が見つかっても「アプリを起こす」は続く',seen.b==='ok,now,wait,wait',seen.b);
  rec('窓の起動画面: Python の場所は画面に出さず title に残す',
      !/Python312/.test(seen.bText)&&/Python312/.test(seen.bTitle),seen.bText.replace(/\s+/g,' '));
  rec('窓の起動画面: 中身が起きたら「画面を組み立てる」へ（覆いが60%から引き継ぐ）',
      seen.c==='ok,ok,now,wait'&&seen.d==='ok,ok,now,wait'&&seen.pct==='60%',`${seen.d} ${seen.pct}`);
  rec('窓の起動画面: 失敗は段に×・次にすることと理由を字で',
      seen.e==='ok,ok,bad,wait'&&/次にすること/.test(seen.fail)&&/No module named flask/.test(seen.fail),seen.e);
  await sp.close();

 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }
}, {viewport:{width:1600,height:1000}});
