/* test_savechip.js: 遅い書き込みに「保存しています…」を出す（§9.273、利用者の
   指示「共有へ保存しているときに、少しタイムラグがあるので保存していますという
   メッセージが欲しいです。保存しましたというメッセージが出るまで6秒くらい
   待たされます」）。

   固定するのは5つ。
    ① 遅い保存では**待っているあいだ**「保存しています…」が出る
    ② 終わったら「保存しました」に変わり、しばらくして消える
    ③ **速い保存では出さない**（光って消えるだけの帯を作らない）
    ④ **読むだけのPOST（`quiet:true`）では出さない**（保存と嘘をつかない）
    ⑤ 失敗したら「保存できませんでした」と残り、**やり直しのボタンは出さない**
       （同じPOSTをもう一度投げると二重に書きうる）

   応答は`page.route`で**差し替える**ので、サーバーへは1件も届かない
   （検証で本物のマスタを書き換えない・§9.121）。 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
let b=null;

(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1400,height:900}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));

 /* 保存の見せかけ。`delay`ミリ秒待ってから`status`で返す。 */
 let plan={delay:0,status:200};
 await page.route('**/api/__savechip__*',async route=>{
  await new Promise(r=>setTimeout(r,plan.delay));
  route.fulfill({status:plan.status,contentType:'application/json',
   body:JSON.stringify(plan.status===200?{ok:true}:{error:'共有へ届きませんでした'})});
 });

 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#saveState',{state:'attached',timeout:15000});
 await page.waitForSelector('#openMasterMaint',{timeout:15000});

 /* 帯の中身を読む。**見えていることまで見る**（hiddenのまま文字だけ入って
    いても`textContent`は取れる・§9.222 ④）。 */
 const chip=()=>page.evaluate(()=>{
  const el=document.getElementById('saveState');
  return {shown:!!el&&!el.hidden&&!!el.offsetParent,
          text:(el&&el.textContent||'').trim(),
          retry:!!(el&&el.querySelector('.save-chip-retry'))};
 });
 /* 画面の中で`api()`を呼ぶ。**返りを待たない**ので、待っているあいだの
    帯を覗ける。 */
 const fire=(opts)=>page.evaluate(o=>{
  window.__done=null;
  api('/api/__savechip__?x='+Date.now(),o).then(()=>{window.__done='ok'}).catch(()=>{window.__done='ng'});
 },opts);
 const waitDone=()=>page.waitForFunction(()=>window.__done!==null,{timeout:10000});

 // ---- ① 遅い保存では待っているあいだ出る -----------------------------
 plan={delay:2000,status:200};
 await fire({method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 await page.waitForTimeout(300);
 let c=await chip();
 rec('③ 500msまでは出さない（速い保存で光らせない）',!c.shown,JSON.stringify(c));
 await page.waitForTimeout(600);
 c=await chip();
 rec('① 待っているあいだ「保存しています…」が出る',c.shown&&/保存しています/.test(c.text),
   JSON.stringify(c));

 // ---- ② 終わったら「保存しました」 -----------------------------------
 await waitDone();
 await page.waitForTimeout(150);
 c=await chip();
 rec('② 終わると「保存しました」に変わる',c.shown&&/保存しました/.test(c.text),JSON.stringify(c));
 await page.waitForTimeout(2400);
 c=await chip();
 rec('② しばらくすると消える（読み終えたあとも残す情報ではない）',!c.shown,JSON.stringify(c));

 // ---- ③ 速い保存では最後まで出さない ---------------------------------
 plan={delay:0,status:200};
 await fire({method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 await waitDone();
 await page.waitForTimeout(700);
 c=await chip();
 rec('③ 速い保存では「保存しています」を出さない',!/保存しています/.test(c.text),
   JSON.stringify(c));

 // ---- ④ 読むだけのPOSTでは出さない -----------------------------------
 plan={delay:1500,status:200};
 await fire({quiet:true,method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 await page.waitForTimeout(900);
 c=await chip();
 rec('④ 読むだけのPOST（quiet:true）では出さない',!c.shown,JSON.stringify(c));
 await waitDone();

 // ---- GET には出さない -------------------------------------------------
 plan={delay:1500,status:200};
 await fire({});
 await page.waitForTimeout(900);
 c=await chip();
 rec('読み込み（GET）にも出さない',!c.shown,JSON.stringify(c));
 await waitDone();

 // ---- ⑤ 失敗 ----------------------------------------------------------
 plan={delay:900,status:500};
 await fire({method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 await waitDone();
 await page.waitForTimeout(200);
 c=await chip();
 rec('⑤ 失敗したら「保存できませんでした」と残る',c.shown&&/保存できませんでした/.test(c.text),
   JSON.stringify(c));
 rec('⑤ やり直しのボタンは出さない（二重に書かないため）',!c.retry,JSON.stringify(c));

 await b.close();b=null;
 const ng=R.filter(x=>!x.ok);
 console.log('\n=== SUMMARY ===');console.log(`${R.length-ng.length}/${R.length} passed`);
 ng.forEach(x=>console.log(' -',x.n,x.d||''));
 process.exit(ng.length?1:0);
})().catch(async e=>{
 console.log('FATAL:',e.message);
 try{if(b)await b.close()}catch(_){}
 process.exit(1);
});
