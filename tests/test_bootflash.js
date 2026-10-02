/* test_bootflash.js: 起動の引き渡しで白い画面を挟まないこと(§9.86)
   ------------------------------------------------------------
   起動画面からアプリ本体へ移る瞬間（いまはデスクトップ版の起動画面 desktop/splash から。
   以前はブラウザ版の待機画面 loading.html から・§9.548で外した）、以前は白い画面が
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
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';
/* 本数は起動ローダーの一覧(FILES)から数える。**直値で持たない**
   ——JSを1本足すたびにこのテストだけが落ちて、意味のない数字合わせになる
   (実際に19→20で落ちた)。見たいのは「一覧にあるものが全部読み込まれたか」。
   §9.324 R3: 一覧は core.py の JS_FILES へ移り index.html は描くだけなので、
   **配られたHTML**（下で取る）から数える。 */
let EXPECTED_JS=0;
run('test_bootflash: 起動の引き渡しで白い画面を挟まないこと(§9.86)', async ({page,rec,B,W,idle,errs,browser})=>{
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
  // 領域フォルダ（§9.334）なので `'<領域>/<名前>.js'`。折りの無い綴りだけを
  // 見ると **3-9 以降0本**になる（`EXPECTED_JS>0` の門で落ちるので気づけたが、
  // 門が無ければ静かに素通りしていた・§9.335）。
  EXPECTED_JS=(html.match(/var FILES=\[[\s\S]*?\]/)||[''])[0].match(/'[a-z0-9-]+\/[a-z0-9-]+\.js'/g)?.length||0;
  const parserScripts=(html.match(/<script[^>]+src=["'][^"']*\/js\//g)||[]).length;
  rec('HTMLにパーサー実行のアプリJSが無い(描画を止めない)',parserScripts===0,`${parserScripts}本`);
  rec('起動用CSSはブロッキングで読む',/core\.boot_css|\/css\/boot\.css/.test(html)&&
   /href="[^"]*boot\.css[^"]*" rel="stylesheet"/.test(html));
  rec('本体CSSはブロッキングでない形で読む',/id="appCss"[^>]*media="print"/.test(html));

  /* ---- 3) 画面としてちゃんと立ち上がる ---- */
  await page.goto(API+'/',{waitUntil:'load'});
  await page.waitForFunction(()=>!document.documentElement.classList.contains('app-booting'),{timeout:20000});
  await idle();
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
  rec('アプリのJSは全部読み込まれている',
      EXPECTED_JS>0&&s.scripts===EXPECTED_JS&&s.jsCount>=EXPECTED_JS,
      `script=${s.scripts} / 資源=${s.jsCount} / 一覧=${EXPECTED_JS}`);
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

  /* ---- 引き継ぎの継ぎ目(§9.92) ----
     起動画面から移ってくるとき、新しい文書の最初の1枚までブラウザ（WebView）は既定の白を
     塗る。起動画面もこの
     画面も深い紺なので、そこだけが白く光って「覆いが一度消えてまた
     出た」ように見えていた。**CSSの到着を待たずに**効く必要があるため、
     背景は html の属性で持たせてある。 */
  /* 生のHTMLで見る。**JSが --nav-w 等を足すため live DOM の style 属性は
     書き換わる**ので、そちらで正規表現を当てると取り違える。 */
  const rawHtml=await (await fetch(API+'/')).text();
  const painted=await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor);
  rec('引き継ぎの白い一瞬を消す背景がhtmlに直接ある',
   /<html[^>]*style="[^"]*background:\s*#0d2029/i.test(rawHtml),
   (rawHtml.match(/<html[^>]*>/)||[''])[0].slice(0,90));
  rec('その背景が実際に塗られている',painted==='rgb(13, 32, 41)',painted);

  /* 覆いを外す条件に assets を含める(§9.92)。読み込みの遅い端末で
     最後のJSが走る前に本体が見えると、そのぶんの組み替えが目に入る。 */
  const gate=await page.evaluate(()=>{
   const src=[...document.querySelectorAll('script[src]')].map(s2=>s2.src).find(u=>/base\.js/.test(u));
   return src||'';
  });
  const baseSrc=gate?await (await fetch(gate)).text():'';
  rec('覆いはassetsも揃ってから外す',
   /done\.has\('assets'\)&&done\.has\('permission'\)&&done\.has\('list'\)/.test(baseSrc),
   baseSrc?'base.jsを確認':'base.jsを取得できない');
  rec('時間切れでも中身の無い枠を見せない(読み込み中の置き換えを入れる)',
   /一覧を読み込んでいます/.test(baseSrc),'');

 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }
}, {viewport:{width:1400,height:900}});
