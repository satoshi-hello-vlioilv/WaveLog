/* test_bootflash.js: 起動の引き渡しで白い画面を挟まないこと(§9.86)
   ------------------------------------------------------------
   起動待機画面(loading.html)からアプリ本体へ移る瞬間、以前は白い画面が
   一瞬見えていた。原因は「アプリ本体が最初の1枚を描くまでが遅い」こと。
   実測(このリポジトリのCDPスクリーンキャスト)では、白から暗い起動画面に
   変わるまで **348ms**。ブラウザは前のページの絵を保持してくれるが、
   その猶予を超えると素の白を映す。内訳は
     ・</body>直前の<script>17本 … パーサーはそこで止まり、全部実行し
       終えるまで1度も描画しない
     ・356KBのCSSが描画をブロックする
   だった。どちらも「起動オーバーレイを最初に描く」ことを妨げていた。

   直し方(この3つが揃って初めて白が消える):
     1. CSSを2本に分ける。起動用(00-base+95-boot、27KB)だけが描画を
        ブロックし、本体(329KB)はブロックしない。
     2. アプリのJSは、起動オーバーレイが描かれてから読み込む
        (index.htmlの起動ローダー)。
     3. 起動中はルート要素の地の色も暗くしておく。覆いが出るまでの
        わずかな間も、待機画面と同じ色でつながる。

   ここでは**順序の契約**を固定する。時間の実測は環境で揺れるので、
   「JSより先にCSSが適用されている」「HTMLにパーサー実行のJSが無い」
   といった、崩れたら必ず白が戻る条件を見る。 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const API='http://127.0.0.1:5029';
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1400,height:900}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
 try{
  /* ---- 1) 配信が2本に分かれている ---- */
  const bootCss=await (await fetch(API+'/css/boot.css')).text();
  const appCss=await (await fetch(API+'/css/app.css')).text();
  rec('起動用CSS(/css/boot.css)が配信されている',bootCss.length>1000,`${bootCss.length}B`);
  rec('起動用CSSに起動オーバーレイの見た目が入っている',
   bootCss.includes('#appBoot')&&bootCss.includes('--teal'),'#appBoot / トークン');
  /* 小さいほど白い時間が短い。画面のCSSを足していないかの歯止め。 */
  rec('起動用CSSは十分小さい(80KB未満)',bootCss.length<80000,`${Math.round(bootCss.length/1024)}KB`);
  rec('本体CSSに起動オーバーレイは含まれない(二重定義でない)',
   !appCss.includes('#appBoot{'),`${Math.round(appCss.length/1024)}KB`);
  rec('起動中は地の色も暗い(白い素地を見せない)',
   /html\.app-booting\{[^}]*background/.test(bootCss.replace(/\s+/g,''))
   ||/html\.app-booting\{[\s\S]*?background/.test(bootCss),'html.app-booting の background');

  /* ---- 2) HTMLはパーサーを止めない ---- */
  const html=await (await fetch(API+'/')).text();
  const parserScripts=(html.match(/<script[^>]+src=["'][^"']*\/js\//g)||[]).length;
  rec('HTMLにパーサー実行のアプリJSが無い(描画を止めない)',parserScripts===0,`${parserScripts}本`);
  rec('起動用CSSはブロッキングで読む',/core\.boot_css|\/css\/boot\.css/.test(html)&&
   /href="[^"]*boot\.css[^"]*" rel="stylesheet"/.test(html));
  rec('本体CSSはブロッキングでない形で読む',/id="appCss"[^>]*media="print"/.test(html));

  /* ---- 3) 画面としてちゃんと立ち上がる ---- */
  await page.goto(API+'/',{waitUntil:'load'});
  await page.waitForFunction(()=>!document.documentElement.classList.contains('app-booting'),{timeout:20000});
  await page.waitForTimeout(1500);
  const s=await page.evaluate(()=>{
   const css=performance.getEntriesByType('resource').filter(r=>/css\/app\.css/.test(r.name))[0];
   const js=performance.getEntriesByType('resource').filter(r=>/\/static\/js\//.test(r.name))
     .sort((a,b)=>a.startTime-b.startTime);
   const paint=performance.getEntriesByType('paint').filter(p=>p.name==='first-contentful-paint')[0];
   return {
    scripts:document.querySelectorAll('script[src]').length,
    cssMedia:document.getElementById('appCss')?.media||'',
    cssEnd:css?css.responseEnd:null, firstJs:js.length?js[0].startTime:null, jsCount:js.length,
    fcp:paint?paint.startTime:null,
    overlayGone:!document.getElementById('appBoot'),
    booting:document.documentElement.classList.contains('app-booting'),
    cold:document.documentElement.classList.contains('boot-cold'),
    nav:document.querySelectorAll('aside .nav-item').length,
    asideWidth:parseFloat(getComputedStyle(document.querySelector('aside')).width)||0,
    reloadBtn:typeof document.getElementById('connectionLostReload')?.onclick,
    onReady:typeof (window.WL||{}).onReady,
   };
  });
  rec('アプリのJSは全部読み込まれている',s.scripts===19&&s.jsCount>=19,`script=${s.scripts} / 資源=${s.jsCount}`);
  rec('本体CSSは最終的に適用される(media=all)',s.cssMedia==='all',s.cssMedia);
  /* **これが崩れると、スタイルの当たっていない状態でJSが寸法を測る。** */
  rec('本体CSSが適用されてからアプリのJSが動く',
   s.cssEnd!=null&&s.firstJs!=null&&s.firstJs>=s.cssEnd,
   `CSS完了=${Math.round(s.cssEnd)}ms / 最初のJS=${Math.round(s.firstJs)}ms`);
  rec('最初の描画はアプリのJSより前に起きる',
   s.fcp!=null&&s.firstJs!=null&&s.fcp<=s.firstJs+50,
   `描画=${Math.round(s.fcp)}ms / 最初のJS=${Math.round(s.firstJs)}ms`);
  rec('起動オーバーレイは最後に外れる',s.overlayGone&&!s.booting);
  /* レイアウト省略の印は、寸法を測る処理(=アプリのJS)が動く前に外れること。
     外し忘れると「幅が0のまま組み立てる」類の不具合になる。
     CSS側を .app-booting との組にしてあるので、12秒の保険で app-booting が
     外れれば、この指定も道連れで無効になる(印が残っても実害が出ない)。 */
  rec('レイアウト省略の印は残っていない',!s.cold,String(s.cold));
  rec('レイアウト省略は保険と連動している(.app-booting との組)',
   /html\.app-booting\.boot-cold/.test(bootCss),'html.app-booting.boot-cold');
  rec('画面が組み上がっている(ナビ・左ペインの幅)',s.nav>=5&&s.asideWidth>100,
   `ナビ${s.nav}件 / 幅${s.asideWidth}px`);
  /* JSを後から読む方式にすると DOMContentLoaded は既に終わっている。
     直接待ち受けていた処理は動かなくなる(実際に踏んだ)。 */
  rec('DOMContentLoadedを直接待っていた処理も動く(再読込ボタン)',s.reloadBtn==='function',String(s.reloadBtn));
  rec('WL.onReady が公開されている',s.onReady==='function',String(s.onReady));
  rec('コンソールエラーが出ない',errs.length===0,errs.slice(0,3).join(' / '));

  /* ---- 4) 読み込み後に登録しても動く(WL.onReadyの契約) ---- */
  const late=await page.evaluate(()=>new Promise(res=>{
   let done=false;WL.onReady(()=>{done=true;res(true)});setTimeout(()=>res(done),500);
  }));
  rec('読み込み後にWL.onReadyへ渡した処理もすぐ動く',late===true,String(late));

  console.log('\n=== SUMMARY ===');
  const f=R.filter(r=>!r.ok);console.log(`${R.length-f.length}/${R.length} passed`);
  f.forEach(x=>console.log(' -',x.n,x.d||''));
  await b.close();b=null;
  process.exit(f.length?1:0);
 }catch(e){
  // 落ちてもブラウザは必ず閉じる(開いたままだと後続のスケジュール系が
  // 「編集中です」で連鎖的に落ちる)。
  console.error('FATAL',e);
  if(b)await b.close().catch(()=>{});
  process.exit(2);
 }
})();
