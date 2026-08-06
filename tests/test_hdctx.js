/* §9.60 ヘッダーの画面名表示 / §9.59 hidden属性 / 同期バナー文言 の検証 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(B+'/api/access-mode',{method:'POST',
 headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
let b=null;
(async()=>{
 await setMode('edit');
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','LS4'));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForTimeout(2500);
 const ctx=()=>page.evaluate(()=>({
   title:document.querySelector('#fileName').textContent.trim(),
   src:document.querySelector('#headerContextSource')?.hidden?'':document.querySelector('#headerContextSource').textContent.trim()}));
 const go=async(sel,wait=1800)=>{await page.click(sel);await page.waitForTimeout(wait)};

 await go('[data-db-key="SIKALOTNOW"]',2500);
 let c=await ctx();
 rec('仕掛(現在): 画面名が主・ファイル名が副',c.title==='仕掛一覧'&&/sikalotnow/i.test(c.src),JSON.stringify(c));
 // ここから他画面へ移り、DBファイル名が残らないことを見る
 for(const [sel,want] of [['#homeDrafts','データ一覧'],['#openDashboard','ダッシュボード'],
                          ['#openCalendar','実績カレンダー'],['#openSchedule','作業スケジュール'],
                          ['#openMasterMaint','マスタ管理']]){
  await go(sel,2200);c=await ctx();
  rec(`${want}: 見出しが画面名になる`,c.title===want,JSON.stringify(c));
  rec(`${want}: 前に見たDBファイル名が残らない`,!/sikalot/i.test(c.title+' '+c.src),JSON.stringify(c));
 }
 // 品質データ→データ一覧でも残らない
 await go('[data-db-key="SIKALOTDEF"]',2500);c=await ctx();
 rec('品質データ: 画面名が主',c.title==='品質データ',JSON.stringify(c));
 await go('#homeDrafts',2200);c=await ctx();
 rec('品質データ→データ一覧でも名残なし',c.title==='データ一覧'&&!/sikalot/i.test(c.src),JSON.stringify(c));

 // 同期バナー: 0件なら出ない / 文言にAccessが出ない
 const bar=await page.evaluate(()=>{
  const el=document.querySelector('#recordSyncBar');
  return {visible:!!el&&getComputedStyle(el).display!=='none',
          count:document.querySelector('#recordSyncCount')?.textContent,
          text:el?el.textContent.replace(/\s+/g,' ').trim():''};
 });
 rec('未送信0件なら同期バナーを出さない',!bar.visible,JSON.stringify(bar));
 const accessLeft=await page.evaluate(()=>{
  const walk=document.body.innerText;
  const titles=[...document.querySelectorAll('[title]')].map(e=>e.title).join(' ');
  return (walk+' '+titles).match(/Access[^\s]*/g)||[];
 });
 rec('画面文言に「Access」が残っていない',accessLeft.length===0,JSON.stringify(accessLeft));

 // hidden属性が全画面で効いている
 const badHidden=await page.evaluate(()=>[...document.querySelectorAll('[hidden]')]
   .filter(e=>getComputedStyle(e).display!=='none').length);
 rec('hidden属性が効いていない要素が無い',badHidden===0,badHidden+'件');

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
