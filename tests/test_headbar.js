/* test_headbar.js: 画面ごとの操作はヘッダーの操作列が持つ（§9.100）

   ============================================================
   ここで固定すること
   ------------------------------------------------------------
   この土台の約束は「**画面名はヘッダーが持ち、操作ボタンは
   `#headerViewBar` へ相乗りさせる**」(base.js の mountViewToolbar)。
   画面ごとに見出しの帯を持つと、画名がヘッダーと二重に出るうえ、
   バー1本ぶん(40〜50px)本文の高さを食う。

   守られているかは**画面を開くまで分からない**——登録
   (registerView の toolbar)を書き忘れても、パネルの中に操作列が
   残ったまま普通に動いてしまう。だから機械で見る。

    1. 各画面の操作列が本当にヘッダーへ載っている（元の親に残っていない）
    2. 操作はパネルの中に**二重に**置かれていない
    3. 画面を出ると操作列は元の場所へ戻る（次の画面のものと混ざらない）
    4. ヘッダーへ載せた操作の高さ・文字が揃っている
       (**移すと `.hd-viewbar input` が左右の余白を上書きする**ので、
        アイコン付きの入力は文字が重なりやすい。実際に重なった)
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
let b=null;

/* 画面 → [ナビのid, ヘッダーへ載る操作列のid] */
const VIEWS=[
 ['作業スケジュール','openSchedule','scHead'],
 ['ダッシュボード','openDashboard','dbHeadActions'],
 ['実績カレンダー','openCalendar','calToolbar'],
 ['マスタ管理','openMasterMaint','mmHead'],
 ['ログ・診断','openLogView','lgHead'],
];

(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:950}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));

 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openMasterMaint',{timeout:20000});

 for(const [label,nav,bar] of VIEWS){
  await page.click('#'+nav);
  await page.waitForTimeout(1400);
  const s=await page.evaluate(id=>{
   const el=document.getElementById(id);
   if(!el)return {missing:true};
   const slot=document.getElementById('headerViewBar');
   const ctls=[...slot.querySelectorAll('input,select,button')].filter(e=>e.offsetParent!==null);
   return {
    inHeader:el.parentElement===slot,
    // 同じ操作がパネル側にも残っていないか(id は文書内で一意なので、
    // 「ヘッダーの外にも同じ操作がある」形＝別要素の重複を見る)
    strays:[...document.querySelectorAll('#headerViewBar input,#headerViewBar select')]
      .map(e=>e.id).filter(Boolean)
      .filter(x=>document.querySelectorAll('#'+CSS.escape(x)).length>1),
    heights:[...new Set(ctls.map(e=>Math.round(e.getBoundingClientRect().height)))].sort((a,b)=>a-b),
    // アイコンだけのボタン(‹ ›)は記号なので文字サイズの対象外。
    // tests/test_theme.js が既に置いている例外と同じ扱いにする——
    // ここだけ厳しくすると、既存の意図的な作りが落ちるだけになる。
    fonts:[...new Set(ctls.filter(e=>!e.classList.contains('rp-btn-icon'))
                          .map(e=>getComputedStyle(e).fontSize))],
    clipped:ctls.filter(e=>e.scrollWidth-e.clientWidth>2).map(e=>e.id||e.className),
   };
  },bar);
  rec(`${label}: 操作列がヘッダーへ載る`,!s.missing&&s.inHeader===true,JSON.stringify(s.missing?'#'+bar+'が無い':s.inHeader));
  rec(`${label}: 同じ操作がパネル側に二重に残らない`,!s.missing&&s.strays.length===0,JSON.stringify(s.strays||[]));
  rec(`${label}: 操作の高さがトークンに収まる(30/26px)`,
      !s.missing&&s.heights.length>0&&s.heights.every(h=>h===30||h===26),JSON.stringify(s.heights));
  rec(`${label}: 操作の文字サイズが1種類(アイコンのみのボタンを除く)`,
      !s.missing&&s.fonts.length===1,JSON.stringify(s.fonts));
  rec(`${label}: 操作の中身が見切れていない`,!s.missing&&s.clipped.length===0,JSON.stringify(s.clipped||[]));
 }

 /* マスタ管理は今回の移設(§9.100)の当事者なので、個別に確かめる。
    絞り込み・再読込がヘッダーにあり、パネルには見出しだけが残ること。 */
 await page.click('#openMasterMaint');
 await page.waitForTimeout(1400);
 const mm=await page.evaluate(()=>{
  const inBar=id=>!!document.querySelector('#headerViewBar #'+id);
  const icon=document.querySelector('#mmHead .mm-search-icon');
  const inp=document.getElementById('masterMaintSearch');
  const cs=inp?getComputedStyle(inp):null;
  return {
   search:inBar('masterMaintSearch'),reload:inBar('reloadMasterMaint'),user:inBar('masterUserId'),
   toolbarCtls:document.querySelectorAll('.mm-toolbar input,.mm-toolbar button,.mm-toolbar select').length,
   title:!!document.querySelector('.mm-toolbar #masterMaintTitle'),
   // 虫めがねの右端より内側から文字が始まること
   iconRight:icon?Math.round(icon.getBoundingClientRect().right):0,
   textStart:inp?Math.round(inp.getBoundingClientRect().left+parseFloat(cs.paddingLeft)+parseFloat(cs.borderLeftWidth)):0,
  };
 });
 rec('マスタ管理: 絞り込みがヘッダーにある',mm.search);
 rec('マスタ管理: 再読込がヘッダーにある',mm.reload);
 rec('マスタ管理: 更新者IDもヘッダーのまま',mm.user);
 rec('マスタ管理: パネルに残るのは見出しだけ(操作は0件)',mm.toolbarCtls===0&&mm.title,
     '操作 '+mm.toolbarCtls+'件 / 見出し '+mm.title);
 rec('マスタ管理: 虫めがねが文字に重ならない',mm.textStart>mm.iconRight,
     `アイコン右端 ${mm.iconRight} < 文字開始 ${mm.textStart}`);

 // 画面を出たら元の場所へ戻る(次の画面のものと混ざらない)
 await page.click('#openSchedule');
 await page.waitForTimeout(1200);
 const back=await page.evaluate(()=>({
  inHeader:[...document.getElementById('headerViewBar').children].map(e=>e.id),
  mmHome:document.getElementById('mmHead')?.parentElement?.className||'(無し)',
 }));
 rec('別の画面へ移ると前の操作列はヘッダーから外れる',
     !back.inHeader.includes('mmHead')&&back.inHeader.includes('scHead'),JSON.stringify(back.inHeader));
 rec('外した操作列は元の親へ戻る(捨てない)',/mm-dialog/.test(back.mmHome),back.mmHome);

 await b.close();
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
