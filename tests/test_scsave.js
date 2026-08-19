/* test_scsave.js: 変更が戻ってしまう不具合・保存できない不具合（§9.200）
   ------------------------------------------------------------
   利用者の報告:
    ・「行の見せ方」を変えても保存できない（トーストに
      「<!doctype html> … 404 Not Found」が丸ごと出た）
    ・「スケジュールを入れ替えたり変更して位置が変わっても、画面を切り替えて
      戻ってくると位置が元に戻ってしまっています」

   ここで固定すること:
    1. 予定を変えたあとに**変更前のGETが遅れて届いても**、画面もキャッシュも
       巻き戻さない（世代で捨てる）
    2. 画面を切り替えて戻っても並べ替えが残る
    3. サーバーがHTMLを返しても、**生のHTMLをそのまま見せない**
       （状態コードから言い直し、打つ手を書く）
    4. 「更新は届いたが再起動していない」をサーバーが答える
    5. 行の色とアイコン: 絵を見たまま選べて、その場で保存される
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1050}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 const setMode=m=>page.evaluate(async mm=>{await fetch('/api/access-mode',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mm})})},m);

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
    localStorage.setItem('AccessMeasurementUserId','tester');
    localStorage.setItem('scLayoutPrefsV1',JSON.stringify({swap:false,open:'schedule'}))},EQ);
  await setMode('schedule');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});

  /* ---- 3) 応答がHTMLでも、生のHTMLを見せない ------------------
     **実際に404を起こして確かめる**——文言だけを読む網では、
     言い直しが効いていなくても通ってしまう。 */
  const err=await page.evaluate(async()=>{
   try{await api('/api/この道はありません',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
       return {threw:false}}
   catch(e){return {threw:true,msg:String(e.message||''),status:e.status,body:String(e.body||'').slice(0,40)}}
  });
  rec('404は投げる',err.threw&&err.status===404,JSON.stringify(err).slice(0,120));
  rec('生のHTMLをそのまま見せない',!/<!doctype|<html|<title>/i.test(err.msg||''),err.msg);
  rec('打つ手を書く（再起動）',/再起動/.test(err.msg||''),err.msg);
  rec('生の本文は診断用に残す',/404|Not Found|<!doctype/i.test(err.body||''),err.body);

  /* ---- 4) 更新後に再起動していないかをサーバーが答える ---- */
  const build=await page.evaluate(async()=>await api('/api/build'));
  rec('/api/build が再起動の要否を返す',
      Object.prototype.hasOwnProperty.call(build,'restartNeeded')
      &&[true,false,null].includes(build.restartNeeded),JSON.stringify(build.restartNeeded));
  rec('いま動いているサーバーは最新（検証中は再起動済み）',build.restartNeeded===false,
      String(build.restartNeeded));

  /* ---- スケジュールを開く ---- */
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await page.waitForTimeout(2000);

  const ids=()=>page.$$eval('#scTimeline .sc-row-line',n=>n.map(x=>x.dataset.id));
  const srvIds=()=>page.evaluate(async e=>{
   const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e));
   return ((await r.json()).entries||[]).map(x=>String(x.id));
  },EQ);

  /* ---- 1) 変更前の応答が遅れて届いても巻き戻さない -------------
     **1本目のGETだけ遅らせる**——全部遅らせると、遅れて届く順番が
     変わらないので競合そのものが起きず、直す前でも通ってしまう。 */
  let delayed=0;
  await page.route('**/api/schedule/plan?*',async route=>{
   if(route.request().method()!=='GET'||delayed){await route.continue();return}
   delayed=1;
   /* **先に取ってから、届けるのを遅らせる**。`continue()`の前に待つと
      サーバーへ届くのが3秒後になり、返ってくるのは並べ替え**後**の内容
      ——競合そのものが起きず、直す前でも通ってしまう（実際に通った）。 */
   const resp=await route.fetch();
   const body=await resp.text();
   await new Promise(r=>setTimeout(r,3000));
   await route.fulfill({response:resp,body});
  });
  const before=await ids();
  // 遅れる1本目を走らせてから、すぐ並べ替える
  await page.evaluate(()=>{WL.scheduleView.refresh(true)});
  await page.waitForTimeout(250);
  /* **動かせる行の1つ目**を選ぶ（最後の行はこれ以上下がらないので、
     動かなくても「直っている」と読めてしまう）。フォーカスは要素ハンドルで
     当てる——`click()`だけではキー操作が行へ届かない。 */
  const moveIds=await page.$$eval('#scTimeline .sc-row-line',n=>n.filter(x=>x.draggable).map(x=>x.dataset.id));
  const moved=moveIds[0]||null;
  if(moved){
   const h=await page.$(`.sc-row-line[data-id="${moved}"]`);
   await h.focus();
   await page.keyboard.down('Alt');await page.keyboard.press('ArrowDown');await page.keyboard.up('Alt');
  }
  await page.waitForTimeout(1200);
  const justAfter=await ids();
  rec('並べ替えると画面の並びが変わる',!!moved&&moveIds.length>1&&before.join()!==justAfter.join(),
      `${moved} / ${before.slice(0,6).join(',')} → ${justAfter.slice(0,6).join(',')}`);
  // 遅れていた「変更前」の応答が届くのを待つ
  await page.waitForTimeout(4000);
  const afterLate=await ids();
  rec('遅れて届いた変更前の応答で画面を巻き戻さない',afterLate.join()===justAfter.join(),
      `${justAfter.slice(0,6).join(',')} / ${afterLate.slice(0,6).join(',')}`);
  /* サーバーの並びとも突き合わせる。**比べるのは並べ替えられる予定だけ**
     ——画面は時刻順に並べる(§9.39)ので、完了・実績の行の位置は
     サーバーの予定順とは一致しない（一致させるほうが間違い）。
     合成id(`actual:*`)は共有DBに行が無いので、はじめから対象外。 */
  const srv=await srvIds();
  const plan=x=>/^\d+$/.test(x)&&srv.includes(x)&&afterLate.includes(x);
  rec('サーバーにも並べ替えが残っている',
      srv.filter(plan).join()===afterLate.filter(plan).join(),
      `画面 ${afterLate.filter(plan).slice(0,6).join(',')} / サーバ ${srv.filter(plan).slice(0,6).join(',')}`);
  await page.unroute('**/api/schedule/plan?*');

  /* ---- 2) 画面を切り替えて戻っても残る ---- */
  await page.click('#openMasterMaint');
  await page.waitForTimeout(2500);
  await page.click('#openSchedule');
  await page.waitForTimeout(1200);
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await page.waitForTimeout(2500);
  const back=await ids();
  rec('画面を切り替えて戻っても並べ替えが残る',back.join()===afterLate.join(),
      `${afterLate.slice(0,6).join(',')} / ${back.slice(0,6).join(',')}`);

  /* ---- 5) 行の色とアイコン ---- */
  await page.evaluate(()=>WL.scheduleView.openViewPop());
  await page.waitForTimeout(200);
  await page.click('#scRowStyleBtn');
  await page.waitForSelector('#scRowStylePop:not([hidden])',{timeout:8000});
  await page.waitForTimeout(800);
  const panel=await page.evaluate(()=>{
   const btn=document.querySelector('.sc-rs-row[data-rs="cat:stop"] [data-rs-iconbtn]');
   const legend=document.querySelector('.sc-rs-legend');
   return {btn:!!btn,name:btn&&btn.querySelector('.sc-rs-iconname').textContent.trim(),
           glyph:btn&&btn.querySelector('.sc-rs-iconview').innerHTML.trim().length>0,
           legend:legend&&legend.textContent.replace(/\s+/g,' ').trim()};
  });
  rec('アイコンは「いまの絵＋呼び名」のボタンで選ぶ',panel.btn&&panel.glyph&&!!panel.name,
      JSON.stringify(panel).slice(0,140));
  rec('既定の欄にも元の絵が出る（名前を2度読ませない）',panel.name==='既定'&&panel.glyph,
      `${panel.name}`);
  rec('色の目安を先に書く',/目立たせない/.test(panel.legend||'')&&/停止・異常/.test(panel.legend||''),
      String(panel.legend).slice(0,80));
  await page.click('.sc-rs-row[data-rs="cat:stop"] [data-rs-iconbtn]');
  await page.waitForTimeout(300);
  const pick=await page.evaluate(()=>{
   const box=document.querySelector('.sc-rs-row[data-rs="cat:stop"] .sc-icon-pick');
   const cells=[...box.querySelectorAll('.sc-icon-cell')];
   return {open:!box.hidden,n:cells.length,
     groups:[...box.querySelectorAll('.sc-icon-grp')].map(x=>x.textContent),
     drawn:cells.filter(c=>c.querySelector('.sc-icon-glyph').innerHTML.trim()).length};
  });
  rec('絵を見たまま選べる（全部の枠に絵か印が出る）',pick.open&&pick.n>20&&pick.drawn===pick.n,
      JSON.stringify(pick).slice(0,140));
  rec('種類ごとに見出しで分ける',pick.groups.length>=3,JSON.stringify(pick.groups));
  await page.click('.sc-rs-row[data-rs="cat:stop"] [data-icon-pick="svg:bolt"]');
  await page.waitForTimeout(1200);
  const saved=await page.evaluate(async()=>{
   const r=await fetch('/api/schedule/row-style-master');
   const hit=((await r.json()).items||[]).find(x=>x.key==='cat:stop');
   const nm=document.querySelector('.sc-rs-row[data-rs="cat:stop"] .sc-rs-iconname');
   const svg=document.querySelector('#scTimeline .sc-row-cat.sc-cat-stop svg.sc-ic');
   return {icon:hit&&hit.icon,name:nm&&nm.textContent.trim(),onRow:!!svg};
  });
  rec('選んだ瞬間に保存される',saved.icon==='svg:bolt',JSON.stringify(saved));
  rec('その場で表の行にも当たる',saved.name==='稲妻',JSON.stringify(saved));
  /* **文字が見切れていないこと**を実寸で見る（幅の数字だけを見る網では
     捕まらない）。 */
  const clipped=await page.evaluate(()=>{
   const bad=[];
   document.querySelectorAll('#scRowStylePop *').forEach(el=>{
    const r=el.getBoundingClientRect();if(r.width<2||r.height<2)return;
    const s=getComputedStyle(el);
    if(s.textOverflow==='ellipsis')return;
    if(/auto|scroll/.test(s.overflowX)||/auto|scroll/.test(s.overflowY))return;
    const ox=el.scrollWidth-el.clientWidth,oy=el.scrollHeight-el.clientHeight;
    if(ox>1||oy>1)bad.push(((el.className&&el.className.baseVal)||el.className||el.tagName)+':'+ox+'/'+oy);
   });
   return bad.slice(0,8);
  });
  rec('パネルの文字が見切れていない',clipped.length===0,clipped.join(' '));
  // 既定へ戻せる
  await page.click('.sc-rs-row[data-rs="cat:stop"] [data-rs-reset]');
  await page.waitForTimeout(1000);
  const gone=await page.evaluate(async()=>{
   const r=await fetch('/api/schedule/row-style-master');
   return ((await r.json()).items||[]).some(x=>x.key==='cat:stop');
  });
  rec('「⟲ 戻す」で設定の行ごと消える',gone===false,String(gone));

 }catch(e){console.log('FATAL',e.message)}finally{
  try{
   await page.evaluate(async()=>{
    const r=await fetch('/api/schedule/row-style-master');
    for(const it of ((await r.json()).items||[]))
     await fetch('/api/schedule/row-style-master/delete',{method:'POST',
       headers:{'Content-Type':'application/json'},body:JSON.stringify({id:it.id})});
   });
   await setMode('edit');
  }catch(e){}
  await b.close();
  console.log('\n=== SUMMARY ===');
  console.log(`${R.filter(r=>r.ok).length}/${R.length} PASS`);
  R.filter(r=>!r.ok).forEach(r=>console.log('  FAIL '+r.n+(r.d?' -- '+r.d:'')));
 }
})();
