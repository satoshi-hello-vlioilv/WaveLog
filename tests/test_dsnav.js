/* test_dsnav.js: 左メニュー「一覧を見る」はデータソースマスタが唯一の正(§9.87)
   ============================================================
   実機で起きたこと(再現済み):
     データソースマスタの「仕掛（現在）」の**キー**を既定(SIKALOTNOW)から
     変えたところ、左メニューに「仕掛（現在）」が2つ並び、上の1つを押すと
     「仕掛一覧を開けませんでした / データベース指定が不正です」になった。

   原因は**消す処理が無かった**こと。index.htmlに仕掛・品質データのボタンを
   直接置き、カタログ側は「無ければ足す」だけをしていたため、
     ・カタログに無くなった古いキーの静的ボタンが残り続ける(押すと必ず失敗)
     ・マスタの行から作られたボタンが別に増える(同じ名前が2つ)
   となった。左メニューは毎回カタログから組み直す(renderDbNav)。

   あわせて「どれが作業対象の一覧か」をキーの綴りではなく**役割**で判定する
   ようになったので、キーを変えても測定・予定の列が消えないことも見る。

   ここではカタログ応答を差し替えて確かめる(サーバー再起動が要らず、
   実行するたびに同じ結果になるため)。 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1500,height:950}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));
 try{
  await page.goto(B+'/',{waitUntil:'load'});
  /* **本物のカタログが入り終わるまで待つ。** アプリのJSは起動オーバーレイが
     描かれてから読み込まれ(§9.86)、init()が/api/catalogを取ってから
     setCatalog()する。関数が生えた時点で差し替えると、あとから届いた本物に
     上書きされて「キーを変えても作業対象」が落ちる(通しで回したときだけ
     落ちる形で実際に踏んだ)。all()が入っていれば本物の反映は済んでいる。 */
  await page.waitForFunction(()=>window.WL&&WL.dataSource&&typeof WL.renderDbNav==='function'
    &&WL.dataSource.all().length>0,{timeout:20000});

  /* 画面の状態を作らずに、カタログだけを与えて左メニューを組み直す。 */
  const navFor=cat=>page.evaluate(c=>{
   WL.dataSource.setCatalog(c);WL.renderDbNav();
   return [...document.querySelectorAll('#nav [data-db-key]')]
     .map(n=>({key:n.dataset.dbKey,label:n.querySelector('span')?.textContent||''}));
  },cat);

  /* ---- 1) 既定の2件 ---- */
  const base={databases:[
   {key:'SIKALOTNOW',label:'仕掛（現在）',file_name:'a.sqlite3',role:'readonly',purpose:'作業'},
   {key:'SIKALOTDEF',label:'品質データ',file_name:'b.sqlite3',role:'readonly',purpose:'品質'},
   {key:'MASTER',label:'マスタ一覧',file_name:'m.sqlite3',role:'master',purpose:''},
  ],workKey:'SIKALOTNOW',qualityKey:'SIKALOTDEF'};
  let nav=await navFor(base);
  rec('マスタの件数どおりに並ぶ(マスタDBは出さない)',nav.length===2,JSON.stringify(nav.map(x=>x.key)));

  /* ---- 2) キーを変えると、古いキーのボタンは**消える** ---- */
  // これが実機の症状そのもの。消えないと「不正です」を出すボタンが残る。
  const renamed={databases:[
   {key:'SIKALOTNOW2',label:'仕掛（現在）',file_name:'a.sqlite3',role:'readonly',purpose:'作業'},
   {key:'SIKALOTDEF',label:'品質データ',file_name:'b.sqlite3',role:'readonly',purpose:'品質'},
  ],workKey:'SIKALOTNOW2',qualityKey:'SIKALOTDEF'};
  nav=await navFor(renamed);
  rec('キーを変えると古いキーのボタンは残らない',
   !nav.some(x=>x.key==='SIKALOTNOW'),JSON.stringify(nav.map(x=>x.key)));
  rec('同じ表示名が2つ並ばない',
   nav.filter(x=>x.label==='仕掛（現在）').length===1,
   JSON.stringify(nav.map(x=>x.label)));
  rec('キーを変えても作業対象として扱われる',
   await page.evaluate(()=>WL.dataSource.isWork('SIKALOTNOW2')&&!WL.dataSource.isWork('SIKALOTNOW')));

  /* ---- 3) 増やす・減らす・並べ替えが、そのまま反映される ---- */
  const three={databases:[
   {key:'AAA',label:'あ',file_name:'1.sqlite3',role:'readonly',purpose:'作業'},
   {key:'BBB',label:'い',file_name:'2.sqlite3',role:'readonly',purpose:'品質'},
   {key:'CCC',label:'う',file_name:'3.sqlite3',role:'readonly',purpose:''},
  ],workKey:'AAA',qualityKey:'BBB'};
  nav=await navFor(three);
  rec('データソースを増やすと増える',nav.length===3,JSON.stringify(nav.map(x=>x.key)));
  rec('マスタの表示順どおりに並ぶ',
   nav.map(x=>x.key).join(',')==='AAA,BBB,CCC',nav.map(x=>x.key).join(','));
  // 並べ替え(表示順を入れ替えた)
  nav=await navFor({...three,databases:[three.databases[2],three.databases[0],three.databases[1]]});
  rec('並べ替えも画面の順に出る',
   nav.map(x=>x.key).join(',')==='CCC,AAA,BBB',nav.map(x=>x.key).join(','));
  // 減らす
  nav=await navFor({databases:[three.databases[0]],workKey:'AAA',qualityKey:null});
  rec('データソースを減らすと消える',nav.length===1&&nav[0].key==='AAA',
   JSON.stringify(nav.map(x=>x.key)));

  /* ---- 4) 役割が無いときは、勝手にどれかを作業対象にしない ---- */
  await navFor({databases:[{key:'ZZZ',label:'ぜ',file_name:'z.sqlite3',role:'readonly',purpose:''}],
                workKey:null,qualityKey:null});
  rec('役割が決まっていなければ作業対象にはしない',
   await page.evaluate(()=>!WL.dataSource.isWork('ZZZ')&&!WL.dataSource.workKey()));

  /* ---- 5) HTMLにDBのボタンを直書きしていない ---- */
  // 直書きが復活すると、また「消えないボタン」が生まれる。
  const html=await (await fetch(B+'/')).text();
  rec('index.htmlに一覧のボタンを直書きしていない',
   !/data-db-key=/.test(html),String((html.match(/data-db-key=/g)||[]).length)+'件');

  /* ---- 6) 列が増減しても一覧は出る(項目は運用中に変わる) ---- */
  // 一覧は取得した列名をそのまま並べる。**必須列を決め打ちしない**ので、
  // 見たことのない列だけの表でも表として出る(測定など一部の機能は、
  // 対応する列が見つからないときだけ静かに出ない)。
  await page.route('**/api/table?*',r=>r.fulfill({status:200,contentType:'application/json',
   body:JSON.stringify({columns:['謎の列A','謎の列B','ロット番号'],
     rows:[{'謎の列A':'1','謎の列B':'2','ロット番号':'L1'}],count:1})}));
  const odd=await page.evaluate(async()=>{
   S.db=WL.dataSource.workKey()||'AAA';S.table='T';
   const d=await api('/api/table?db='+encodeURIComponent(S.db)+'&table=T');
   applyTableData(d);renderGrid();
   return {heads:[...document.querySelectorAll('#grid table thead th')].map(t=>t.textContent.trim()),
           rows:document.querySelectorAll('#grid table tbody tr').length};
  });
  rec('知らない列だけの表でも一覧として出る',
   odd.rows===1&&odd.heads.includes('謎の列A')&&odd.heads.includes('謎の列B'),
   JSON.stringify(odd.heads));
  // 列がまるごと入れ替わっても落ちない
  await page.unroute('**/api/table?*');
  await page.route('**/api/table?*',r=>r.fulfill({status:200,contentType:'application/json',
   body:JSON.stringify({columns:['X'],rows:[{X:'v'}],count:1})}));
  const swapped=await page.evaluate(async()=>{
   const d=await api('/api/table?db='+encodeURIComponent(S.db)+'&table=T');
   applyTableData(d);renderGrid();
   return {heads:[...document.querySelectorAll('#grid table thead th')].map(t=>t.textContent.trim()),
           rows:document.querySelectorAll('#grid table tbody tr').length};
  });
  rec('列が総入れ替えになっても落ちない',swapped.rows===1&&swapped.heads.includes('X'),
   JSON.stringify(swapped.heads));

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));

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
