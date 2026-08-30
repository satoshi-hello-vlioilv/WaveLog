/* test_rbcells.js: 帳票ブロックを「セル」で組む（§9.274、利用者の指示）。

   ① 読み方が**サーバーと同じ**こと（`tests/fixtures/report_cells.json`の同じ例で
      `fbParse`/`fbText`を通す）。2通りあると、盤で組んだ形と紙が食い違う。
   ② 盤の「表に組む」が**見出し＋ラベルを出さない値**のマトリクスを作ること。
   ③ 紙に**表として出る**こと（見出しのマス・ラベル無しのマス・寄せ・書式）。
   ④ **あとから足した塊が「出す」で紙に出る**こと——ここが利用者の報告
      「帳票ブロックマスタをいじっても紙は変わりません」の本体。一度でも配置を
      保存した紙では`order`が埋まっており、`rpHiddenSet()`が並びに載っていない
      自作の塊を必ず隠すので、**押しても次に読むと消えていた**。
   ⑤ 紙の塊のダブルクリックで**帳票ブロックマスタへ移る**こと（§9.274）。
   ⑥ 説明の量（通常／短め／出さない）が効くこと。

   **後始末は`finally`**（§9.121）——作った塊と紙の設定を残すと、次の実行が
   それを引き継いで別のテストが落ちる。 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const fs=require('fs'),path=require('path');
const B='http://127.0.0.1:5029';
const EQ='スリッター1号';          /* 見本のロットの設備（サーバーのSAMPLE_VALUES） */
const TAG='rbcells-'+Date.now();
const NAME=TAG+'表';
const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+String(d).slice(0,220):''))};
let b=null,page=null;

const CASES=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','report_cells.json'),'utf8'));
const KEYS=['label','path','kind','span','rows','showLabel','align','format','lot'];

(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,160)));
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openMasterMaint',{timeout:20000});
 await page.waitForSelector('#saveState',{state:'attached',timeout:20000});
 await page.click('#openMasterMaint');
 await page.waitForSelector('#masterMaintNav',{timeout:20000});
 await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'rbcells');
 await page.evaluate(()=>document.querySelector('#masterMaintNav [data-master="reportBlock"]')?.click());
 await page.waitForSelector('#masterMaintList .mm-row',{timeout:20000});

 try{
  // ---- ① 読み方・書き方がサーバーと同じ --------------------------------
  /* **口を通して確かめる**（`WL.reportCells`）——盤のDOM越しに見ると、
     盤が読み直さない形でも「0件」で通ってしまう（実際にそうなった）。 */
  const two=await page.evaluate(([cases,dumps,keys])=>{
   if(!(window.WL&&WL.reportCells))return {err:'WL.reportCells が無い'};
   const shape=c=>{const o={};keys.forEach(k=>o[k]=(c[k]===undefined?null:c[k]));return o};
   const parse=cases.map(c=>({why:c.why,
     got:WL.reportCells.parse(c.text).map(shape),
     want:c.cells.map(shape)}));
   const dump=dumps.map(c=>({why:c.why,json:!!c.json,
     got:WL.reportCells.text(c.cells),want:c.text===undefined?null:c.text}));
   return {parse,dump};
  },[CASES.parse,CASES.dump,KEYS]);
  if(two.err){rec('① WL.reportCells が公開されている',false,two.err)}
  else{
   const bad=two.parse.filter(x=>JSON.stringify(x.got)!==JSON.stringify(x.want))
     .map(x=>[x.why,x.want,x.got]);
   rec('① 読み方はサーバー（parse_content）と同じ',!bad.length,JSON.stringify(bad.slice(0,2)));
   const dbad=two.dump.filter(x=>x.json?(String(x.got).charAt(0)!=='['):(x.got!==x.want))
     .map(x=>[x.why,x.want,x.got]);
   rec('① 書き方はサーバー（dump_content）と同じ（触っていない塊の保存値は変わらない）',
       !dbad.length,JSON.stringify(dbad.slice(0,2)));
   /* **往復で形が変わらない**（保存→読み直しで設定が落ちない）。 */
   const rt=await page.evaluate(cases=>cases.map(c=>{
    const a=WL.reportCells.parse(c.text);
    const b=WL.reportCells.parse(WL.reportCells.text(a));
    return {why:c.why,same:JSON.stringify(a)===JSON.stringify(b)};
   }),CASES.parse);
   rec('① 往復しても形が変わらない',rt.every(x=>x.same),
       JSON.stringify(rt.filter(x=>!x.same).slice(0,2)));
  }

  /* ---- ①-b 属性へ埋めても切れない（§9.276 ⑤、利用者の報告） ----
     「帳票ブロックのカスタムで表で組み替えて保存したらその瞬間はきれいに
      保存されますが、再度読み込むと『表に組む』というボタンが押せなく
      なっていたり」

     本体は`esc()`——`textContent`→`innerHTML`に任せていたので**引用符を
     逃がさず**、`value="${esc(v)}"`の属性がセルのJSON（`[{"label":…`）の
     最初の`"`で閉じ、保存値が`[{`まで切り詰められていた。
     **中身に使ったときの見え方は変わらない**（`&quot;`は`"`として出る）。 */
  const escOk=await page.evaluate(()=>{
   const raw='[{"a":1}] \'x\' <b> & ';
   const out=esc(raw);
   const d=document.createElement('div');
   d.innerHTML=`<input value="${out}">`;
   const i=d.querySelector('input');
   const p=document.createElement('p');p.innerHTML=out;
   return {属性で往復:i?i.value:null,中身の見え方:p.textContent,元:raw};
  });
  rec('① 引用符を含む値を属性へ埋めても切れない（§9.276 ⑤）',
      escOk.属性で往復===escOk.元,JSON.stringify(escOk));
  rec('① 中身に使ったときの見え方は変わらない',
      escOk.中身の見え方===escOk.元,JSON.stringify(escOk));

  // 新規登録の窓を開く
  await page.evaluate(()=>{
   const b=[...document.querySelectorAll('#masterMaintForm button,#masterMaintPanel button')]
    .find(x=>/追加|新規/.test(x.textContent||''));
   b&&b.click();
  });
  await page.waitForSelector('#maintEditorModal:not([hidden])',{timeout:15000});
  await page.waitForSelector('#maintEditorForm [data-field="content"]',{state:'attached',timeout:15000});
  // ②タブを開く（盤はそこにある）
  await page.evaluate(()=>{
   const t=[...document.querySelectorAll('#maintEditorModal .mm-tabbar button')]
    .find(b=>/何を載せる/.test(b.textContent||''));
   t&&t.click();
  });
  await page.waitForSelector('.fb-rows',{timeout:15000});

  // ---- ② 表に組む ------------------------------------------------------
  await page.evaluate(()=>{
   const cat=[...document.querySelectorAll('[data-fb-cat]')].find(b=>/統計/.test(b.textContent||''));
   cat&&cat.click();
  });
  await page.waitForTimeout(200);
  const disabledFirst=await page.evaluate(()=>{
   const b=document.querySelector('.fb-table');return b?{dis:b.disabled,title:b.title}:null});
  rec('② 材料が無いうちは「表に組む」を押せない（理由を言う）',
      !!disabledFirst&&disabledFirst.dis&&/選んで/.test(disabledFirst.title),
      JSON.stringify(disabledFirst));

  for(const p of ['stat.thickness.min','stat.thickness.max','stat.width.min',
                  'stat.width.max','stat.length.min','stat.length.max']){
   await page.evaluate(x=>{const b=document.querySelector(`[data-fb-add="${x}"]`);b&&b.click()},p);
   await page.waitForTimeout(80);
  }
  const ready=await page.evaluate(()=>{
   const b=document.querySelector('.fb-table');return {dis:b.disabled,title:b.title}});
  rec('② 軸を名乗る項目がそろうと押せる（いまどの軸をどこへ置くかを先に言う）',
      !ready.dis&&/行＝項目/.test(ready.title)&&/列＝集計/.test(ready.title)
      &&/3列/.test(ready.title),
      JSON.stringify(ready));
  /* **軸の帯**（§9.277、利用者の指示「軸の位置と数がわかれば表の形状が
     わからずに最終形の出力に困らない」）。押す前に形が読めることが要件。 */
  const bar0=await page.evaluate(()=>{
   const bar=document.querySelector('.fb-axes');
   if(!bar||bar.hidden)return {hidden:true};
   return {軸:[...bar.querySelectorAll('.fb-axis>b')].map(e=>e.textContent),
     置き場:[...bar.querySelectorAll('[data-fb-box]')].map(x=>x.dataset.fbBox+'='
       +[...x.querySelectorAll('.fb-axis')].map(c=>c.dataset.fbAxis).join('・')),
     いま:(bar.querySelector('.fb-axes-now')||{}).textContent||''};
  });
  rec('② 軸の箱が「どの軸をどこへ置くか」を出す（既定は1つ目が行・残りが列）',
      !bar0.hidden&&bar0.軸.join(',')==='項目,集計'
      &&bar0.置き場.join(' / ')==='行=項目 / 列=集計'
      &&/3列/.test(bar0.いま),
      JSON.stringify(bar0));

  await page.evaluate(()=>document.querySelector('.fb-table').click());
  await page.waitForTimeout(400);
  const built=await page.evaluate(()=>({
   rows:document.querySelectorAll('.fb-row').length,
   heads:[...document.querySelectorAll('.fb-row-head .fb-label')].map(e=>e.value),
   bare:document.querySelectorAll('.fb-row-bare').length,
   blanks:document.querySelectorAll('.fb-row-blank').length,
   cols:(document.querySelector('#maintEditorForm [data-field="cols"]')||{}).value}));
  rec('② 見出し（列＝MIN/MAX・行＝板厚/板幅/板丈）と値6つのマトリクスになる',
      built.rows===12&&built.bare===6&&built.blanks===1&&built.cols==='3'
      &&built.heads.join(',')==='MIN,MAX,板厚,板幅,板丈',
      JSON.stringify(built));
  rec('② 列数は「内訳の列数」の欄が持ち主（同じ数を2箇所に置かない）',
      built.cols==='3');

  /* ---- ②-b 軸は入れ替えられる（§9.277、利用者の指示） ----
     「EXCELのピボットテーブルのように自由に組めるように」

     §9.274 の頃は候補が`row`/`col`という**置き場つきの名前**を名乗って
     おり、「板厚は行・MINは列」の**1通り**しか作れなかった。 */
  /* **掴めない環境でも置き場を変えられること**（§9.278）——札は掴んで
     動かせるが、`◯◯へ`のボタンでも同じことが起きる。片方だけの実装を
     通さないため、網は**押す道**で確かめる（掴む道は⑧で別に見る）。 */
  const axAt=(name,at)=>page.evaluate(([n,a])=>{
   const b=document.querySelector(`[data-fb-move="${n}"]`);
   if(!b||b.disabled||b.dataset.fbTo!==a)return false;
   b.click();return true;
  },[name,at]);
  const axState=()=>page.evaluate(()=>{
   const bar=document.querySelector('.fb-axes');
   const t=document.querySelector('.fb-table');
   return {hidden:!bar||bar.hidden,
     置き場:bar&&!bar.hidden?[...bar.querySelectorAll('[data-fb-box]')].map(x=>
       x.dataset.fbBox+'='+[...x.querySelectorAll('.fb-axis')]
         .map(c=>c.dataset.fbAxis).join('・')).join(' / '):'',
     bad:!!(bar&&bar.querySelector('.fb-axes-bad')),
     いま:(bar&&(bar.querySelector('.fb-axes-now')||{}).textContent)||'',
     組む:{dis:t.disabled,title:t.title}};
  });
  /* **組んだあとも軸の帯は残る**（§9.277）——盤が作ったマス（「対象」の行の
     見出し）を「軸を名乗らない項目」と数えると、**一度組んだ表は二度と
     組み直せなくなる**（帯が消え、ボタンが理由の分からない断りで固まる。
     利用者の報告「何回でも『表に組む』ボタンを押せる」の裏返し）。 */
  rec('②-b 組んだあとも軸の帯が残り、組み直せる',
      !(await axState()).hidden&&!(await axState()).組む.dis,
      JSON.stringify(await axState()));
  await axAt('項目','列');await page.waitForTimeout(250);
  const bothCol=await axState();
  rec('②-b 行に置く軸が無くなったら押せなくして理由を書く（§4）',
      bothCol.bad&&bothCol.組む.dis&&/行/.test(bothCol.組む.title)
      &&bothCol.置き場==='行= / 列=集計・項目',
      JSON.stringify(bothCol));
  await axAt('集計','行');await page.waitForTimeout(250);
  await page.evaluate(()=>document.querySelector('.fb-table').click());
  await page.waitForTimeout(400);
  const swapped=await page.evaluate(()=>({
   rows:document.querySelectorAll('.fb-row').length,
   heads:[...document.querySelectorAll('.fb-row-head .fb-label')].map(e=>e.value).join(','),
   cols:(document.querySelector('#maintEditorForm [data-field="cols"]')||{}).value}));
  rec('②-b 入れ替えると表の形が変わる（行＝集計・列＝項目）',
      swapped.heads==='板厚,板幅,板丈,MIN,MAX'&&swapped.cols==='4'
      &&swapped.rows===12,
      JSON.stringify(swapped));
  /* 元へ戻して、以降の節は既定の形で確かめる。 */
  await axAt('集計','列');await page.waitForTimeout(200);
  await axAt('項目','行');await page.waitForTimeout(200);
  await page.evaluate(()=>document.querySelector('.fb-table').click());
  await page.waitForTimeout(400);

  /* ---- ②-c 「対象（子ロット）」の軸（§9.277、利用者の報告の本体） ----
     「子ロット分縦に積む形が今までなので縦に積むが標準で横に積むか
      表を組むときに…選んだ項目の中に必要な共通軸を抽出してそれを置く場所を
      自動もしくはその後ユーザーに修正させる形で」

     対象の軸は**候補の項目ではなく塊の設定（繰り返し）から生える**。
     子ロットの数はレコードごとに違うので、盤に置けるのは**1行ぶんの型**
     だけで、数は紙が決める——だから**行にしか置けない**（§4で理由を書く）。 */
  const card=t=>page.evaluate(x=>{
   const b=[...document.querySelectorAll('#maintEditorModal .mm-card-opt')]
     .find(e=>(e.textContent||'').indexOf(x)>=0);
   if(!b)return false;b.click();return true;},t);
  rec('②-c 繰り返しを「子ロットごと」にできる',await card('子ロットごと'));
  await page.waitForTimeout(500);
  const lotAx=await page.evaluate(()=>{
   const bar=document.querySelector('.fb-axes');
   const rowBox=bar&&bar.querySelector('[data-fb-box="行"]');
   const first=rowBox&&rowBox.querySelector('.fb-axis');
   const mv=bar&&bar.querySelector('[data-fb-move="対象"]');
   const chip=bar&&bar.querySelector('.fb-axis[data-fb-axis="対象"]');
   return {あり:!!chip,
     /* **行のいちばん外側**（§9.278）——内側だと、紙が複製する
        ひとかたまりが途切れて行がばらける。 */
     先頭:!!(first&&first.dataset.fbAxis==='対象'),
     掴めない:!!(chip&&chip.getAttribute('draggable')!=='true'),
     移す:mv?{dis:mv.disabled,title:mv.title}:null,
     総計:[...bar.querySelectorAll('[data-fb-grand]')].map(c=>c.dataset.fbGrand+':'+c.checked),
     いま:(bar&&(bar.querySelector('.fb-axes-now')||{}).textContent)||''};
  });
  rec('②-c 繰り返す塊では「対象」の軸が生え、行のいちばん外側に固定される',
      lotAx.あり&&lotAx.先頭&&/子ロットぶん/.test(lotAx.いま),JSON.stringify(lotAx));
  rec('②-c 「対象」は動かせない——押せなくして理由を書く（§4）',
      !!lotAx.移す&&lotAx.移す.dis&&/行のいちばん外側/.test(lotAx.移す.title)
      &&lotAx.掴めない,
      JSON.stringify(lotAx.移す));
  /* 総計（§9.278、利用者の指示「集計(小計や総計)のONOFF」）。**出せる軸に
     だけ欄を出す**——MINとMAXは足し合わせても意味のある数にならない。 */
  rec('②-c 総計（全体）の入切は「対象」にだけ出る（既定は出す）',
      lotAx.総計.join(',')==='対象:true',JSON.stringify(lotAx.総計));
  await page.evaluate(()=>document.querySelector('.fb-table').click());
  await page.waitForTimeout(400);
  const lotBuilt=await page.evaluate(()=>{
   let j=null;try{j=JSON.parse((document.querySelector('#maintEditorForm [data-field="content"]')||{}).value)}catch(e){}
   const cells=(j||[]).map(c=>!!c.lot);
   const first=cells.indexOf(true),last=cells.lastIndexOf(true);
   const bar=document.querySelector('.fb-axes'),t=document.querySelector('.fb-table');
   return {n:cells.length,印:cells.filter(Boolean).length,
     /* **ひとかたまり**——最初と最後のあいだに印の無いマスがあると、紙は
        そのマスだけを先頭へ抜き出してしまい、行がばらける。 */
     連続:first>=0&&cells.slice(first,last+1).every(Boolean),
     全体:(j||[]).some(c=>c.kind==='head'&&c.label==='全体'),
     帯:!!(bar&&!bar.hidden),組み直せる:!!(t&&!t.disabled),
     cols:(document.querySelector('#maintEditorForm [data-field="cols"]')||{}).value};
  });
  rec('②-c 「対象」の行は見出しも値もまとめて印が付き、ひとかたまりになる',
      lotBuilt.連続&&lotBuilt.印>=3&&lotBuilt.全体,JSON.stringify(lotBuilt));
  /* **組んだあとも組み直せる**（§9.277）——盤が作ったマス（子ロット番号）は
     軸を名乗らないが、それを「軸を名乗らない項目」と数えると、
     一度組んだ表は二度と組み直せなくなる。 */
  rec('②-c 「対象」を含む表を組んだあとも軸の帯が残る',
      lotBuilt.帯&&lotBuilt.組み直せる,JSON.stringify(lotBuilt));

  /* ---- ②-d 掴んで動かす・総計・階層ラベル（§9.278、利用者の指示） ----
     「PIVOTももっとEXCELくらい簡単に軸単位のドラッグアンドドロップと
      集計(小計や総計)のONOFF、軸毎に管理し、縦軸、横軸それぞれ項目が
      ２つ以上あるときはその並びによってEXCELのピボットのように階層構造で
      ラベル付け、表を作成してください」 */
  /* 掴んで落とす。**`dragstart`→`drop`をそのまま流す**——`click`で代用すると
     押す道しか通らず、掴む道が壊れていても通る。 */
  const drop=(name,to)=>page.evaluate(([n,t])=>{
   const chip=document.querySelector(`.fb-axis[data-fb-axis="${n}"]`);
   const bx=document.querySelector(`[data-fb-box="${t}"]`);
   if(!chip||!bx)return 'no-el';
   const dt=new DataTransfer();
   chip.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
   const r=bx.getBoundingClientRect();
   bx.dispatchEvent(new DragEvent('dragover',
     {bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.right-2,clientY:r.top+r.height/2}));
   bx.dispatchEvent(new DragEvent('drop',
     {bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.right-2,clientY:r.top+r.height/2}));
   chip.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
   return 'ok';
  },[name,to]);
  /* ②-cの続きなので、まず「行＝対象・項目／列＝集計」から始まる。
     **2回落として入れ替える**——1回だけだと列が空になり、「組めない」の
     道へ入って以降の節が何も確かめられない（実際にそうなった）。 */
  await drop('項目','列');await page.waitForTimeout(300);
  await drop('集計','行');await page.waitForTimeout(300);
  const dragged=await axState();
  rec('②-d 軸を掴んで別の箱へ落とせる',
      dragged.置き場==='行=対象・集計 / 列=項目',JSON.stringify(dragged));
  /* **対象は落とせない**（落とし先が列でも内側でも受けない）。 */
  await drop('対象','列');await page.waitForTimeout(300);
  const denied=await axState();
  rec('②-d 「対象」は掴んでも列へ落ちない（行のいちばん外側のまま）',
      denied.置き場==='行=対象・集計 / 列=項目',JSON.stringify(denied));
  /* 階層ラベル——外側（対象）が同じ行は2行目以降を空きにする。 */
  await page.evaluate(()=>document.querySelector('.fb-table').click());
  await page.waitForTimeout(400);
  const cellStat=()=>page.evaluate(()=>{
   let j=null;try{j=JSON.parse(document.querySelector('#maintEditorForm [data-field="content"]').value)}catch(e){}
   const c=j||[];
   return {全体:c.filter(x=>x.kind==='head'&&x.label==='全体').length,
     対象:c.filter(x=>x.path==='lot.no').length,
     空き:c.filter(x=>x.kind==='blank').length,
     並び:c.map(x=>(x.kind==='blank'?'□':(x.kind==='head'?'['+x.label+']':x.label))
       +(x.lot?'*':'')).join(' ')};
  });
  const nest=await cellStat();
  /* 行＝対象（全体＋子ロット）・集計（MIN/MAX）なので本体は4段。
     **外側が同じ2段目は空き**になるので、「全体」も子ロット番号も**1つずつ**。 */
  rec('②-d 外側のラベルは繰り返さず、階層に見せる（EXCELの既定と同じ）',
      nest.全体===1&&nest.対象===1&&nest.空き>=3,
      JSON.stringify({全体:nest.全体,対象:nest.対象,空き:nest.空き})
      +' / '+nest.並び.slice(0,140));
  /* 「毎行くり返す」に切り替えると空きが減る（切り替えが効いていること）。 */
  await page.evaluate(()=>{const c=document.querySelector('[data-fb-replab]');
   c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.waitForTimeout(250);
  await page.evaluate(()=>document.querySelector('.fb-table').click());
  await page.waitForTimeout(400);
  const flat=await cellStat();
  rec('②-d 「ラベルを毎行くり返す」にすると空きにせず毎行出す',
      flat.全体===2&&flat.対象===2&&flat.空き<nest.空き,
      JSON.stringify({全体:flat.全体,対象:flat.対象,空き:flat.空き}));
  await page.evaluate(()=>{const c=document.querySelector('[data-fb-replab]');
   c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.waitForTimeout(250);
  /* 総計を切ると「全体」が消え、本体の段が減る。 */
  await page.evaluate(()=>{const c=document.querySelector('[data-fb-grand="対象"]');
   c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.waitForTimeout(300);
  const grandOff=await axState();
  await page.evaluate(()=>document.querySelector('.fb-table').click());
  await page.waitForTimeout(400);
  const noGrand=await cellStat();
  rec('②-d 総計を切ると「全体」の行が消える（案内も言い直す）',
      noGrand.全体===0&&noGrand.対象>0&&/子ロットぶん/.test(grandOff.いま)
      &&grandOff.いま.indexOf('全体＋')<0,
      JSON.stringify(noGrand)+' / '+grandOff.いま);
  await page.evaluate(()=>{const c=document.querySelector('[data-fb-grand="対象"]');
   c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.waitForTimeout(250);
  /* **置き場も元へ戻す**——`state.axes`は掴んだ順を覚えているので、
     戻さないと以降の節が別の形の表を見ることになる。 */
  await axAt('集計','列');await page.waitForTimeout(200);
  await axAt('項目','行');await page.waitForTimeout(200);

  /* 以降の節は「1回だけ」の塊で確かめる（紙の見え方を変えない）。 */
  await card('1回だけ');await page.waitForTimeout(400);
  await page.evaluate(()=>document.querySelector('.fb-table').click());
  await page.waitForTimeout(400);

  // 書式を1つ当てる（板厚MINを小数3桁＋単位）
  await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('.fb-row')];
   const r=rows.find(x=>x.classList.contains('fb-row-bare'));
   r&&r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
  });
  await page.waitForTimeout(250);
  await page.evaluate(()=>{
   const b=[...document.querySelectorAll('.fb-insp [data-fb-fmt]')].find(x=>x.dataset.fbFmt==='number');
   b&&b.click();
  });
  await page.waitForTimeout(250);
  await page.evaluate(()=>{
   const el=document.querySelector('.fb-insp [data-fb-dec]');
   if(el){el.value='3';el.dispatchEvent(new Event('input',{bubbles:true}))}
   const su=document.querySelector('.fb-insp [data-fb-suf]');
   if(su){su.value='mm';su.dispatchEvent(new Event('input',{bubbles:true}))}
  });
  await page.waitForTimeout(300);
  const fmt=await page.evaluate(()=>{
   const v=(document.querySelector('#maintEditorForm [data-field="content"]')||{}).value;
   let j=null;try{j=JSON.parse(v)}catch(e){}
   const hit=(j||[]).find(c=>c.format);
   return {json:!!j,fmt:hit?hit.format:null};
  });
  rec('④ 書式（小数桁・単位）が保存の形へ入る',
      fmt.json&&fmt.fmt&&fmt.fmt.kind==='number'&&fmt.fmt.decimals===3&&fmt.fmt.suffix==='mm',
      JSON.stringify(fmt));

  // 名前と設備を入れて保存
  await page.evaluate(n=>{
   const tab=[...document.querySelectorAll('#maintEditorModal .mm-tabbar button')]
     .find(b=>/これは何の塊/.test(b.textContent||''));
   tab&&tab.click();
   const el=document.querySelector('#maintEditorForm [data-field="name"]');
   if(el){el.value=n;el.dispatchEvent(new Event('change',{bubbles:true}))}
   const all=document.querySelector('#maintEditorForm [data-equipment-all="equipment"]');
   if(all&&!all.checked){all.checked=true;all.dispatchEvent(new Event('change',{bubbles:true}))}
  },NAME);
  await page.waitForTimeout(300);
  await page.evaluate(()=>document.querySelector('#maintEditorSave').click());
  await page.waitForTimeout(2200);
  const saved=await page.evaluate(async n=>{
   const l=await api('/api/report-block-master?equipment=');
   const r=(l.items||[]).find(x=>x.name===n);
   return r?{id:r.id,cols:r.cols,fields:(r.fields||[]).length,
             kinds:(r.fields||[]).map(f=>f.kind).join(','),
             fmt:(r.fields||[]).filter(f=>f.format).length}:null;
  },NAME);
  rec('② 保存の口を通しても見出し・書式が落ちない',
      !!saved&&saved.fields===12&&saved.fmt===1&&/head/.test(saved.kinds),
      JSON.stringify(saved));

  /* ---- ②-b 開き直しても組んだ表が残る（§9.276 ⑤、利用者の報告） ----
     「再度読み込むと『表に組む』というボタンが押せなくなっていたり」

     保存は通っていた——壊れていたのは**開き直し**で、セルのJSONを
     `value="…"`へ埋めるときに`esc()`が引用符を逃がさず`[{`まで切れていた。
     そのまま保存すると**マスタの中身まで壊れる**。
     **保存の口だけを見る網では捕まらない**（サーバーは正しかった）ので、
     **窓を開き直して盤の中身**を見る。 */
  await page.evaluate(n=>{
   const rows=[...document.querySelectorAll('#masterMaintList .mm-row')];
   const r=rows.find(x=>(x.textContent||'').indexOf(n)>=0);
   if(r)r.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  },NAME);
  await page.waitForSelector('#maintEditorModal:not([hidden])',{timeout:15000});
  await page.evaluate(()=>{
   const t=[...document.querySelectorAll('#maintEditorModal .mm-tabbar button')]
    .find(b=>/何を載せる/.test(b.textContent||''));t&&t.click()});
  await page.waitForSelector('.fb-rows',{timeout:15000});
  await page.waitForTimeout(600);
  const again=await page.evaluate(()=>{
   const b=document.querySelector('.fb-table');
   const raw=String((document.querySelector('#maintEditorForm [data-field="content"]')||{}).value);
   return {表に組む:b?!b.disabled:null,
     マス:document.querySelectorAll('.fb-row').length,
     見出し:[...document.querySelectorAll('.fb-row-head .fb-label')].map(e=>e.value),
     ラベル無し:document.querySelectorAll('.fb-row-bare').length,
     /* **切れていないこと**——`[{`だけになっていたのが元の症状。 */
     保存値の長さ:raw.length,JSONで読める:(()=>{try{return Array.isArray(JSON.parse(raw))}catch(e){return false}})()};
  });
  rec('②-b 開き直しても組んだ表がそのまま残る（保存値が切れない）',
      again.マス===12&&again.ラベル無し===6&&again.JSONで読める===true
      &&again.見出し.join(',')==='MIN,MAX,板厚,板幅,板丈',
      JSON.stringify(again));
  rec('②-b 開き直しても「表に組む」を押せる',again.表に組む===true,JSON.stringify(again));
  await page.evaluate(()=>{const c=document.getElementById('maintEditorCancel');if(c)c.click()});
  await page.waitForTimeout(400);

  // ---- ④ あとから足した塊が「出す」で紙に出る --------------------------
  const shownOk=await page.evaluate(async ([eq,n])=>{
   WL.reportBlocks.forget();
   /* **「一度配置を保存した紙」を自分で作る**（§9.121）——以前は前の実行が
      残した保存済みの配置に頼っており、まっさらなDBでは`saved:false`で
      この網が落ちた（**置き土産が前提になっている網は網ではない**）。
      いま出ている塊の並びをそのまま保存し、この塊だけを`hidden`にする。 */
   {
    const t=WL.reportLayout.targetOf(eq);
    const info=await WL.reportLayout.info(eq);
    const keys=(info.blocks||[]).map(b=>b.key);
    await WL.columnLayout.save(t,{order:keys.filter(k=>k!==n),
      hidden:[...new Set([...(WL.columnLayout.saved(t).hidden||[]),n])]});
    WL.reportBlocks.forget();
   }
   const before=await WL.reportLayout.info(eq);
   const had=(before.blocks||[]).find(x=>x.key===n);
   await WL.reportLayout.setShown(eq,n,true);
   const after=await WL.reportLayout.info(eq);
   const now=(after.blocks||[]).find(x=>x.key===n);
   return {saved:before.saved,beforeShown:had?had.shown:null,afterShown:now?now.shown:null};
  },[EQ,NAME]);
  rec('④ 一度配置を保存した紙でも、あとから足した塊を「出す」にできる',
      shownOk.saved===true&&shownOk.beforeShown===false&&shownOk.afterShown===true,
      JSON.stringify(shownOk));

  // ---- ③ 紙に表として出る ----------------------------------------------
  await page.evaluate(eq=>WL.reportSample.open({equipment:eq}),EQ);
  await page.waitForSelector('#reportContent .rp-section',{timeout:20000});
  await page.waitForFunction(n=>[...document.querySelectorAll('#reportContent .rp-section h3')]
    .some(h=>h.textContent===n),NAME,{timeout:20000}).catch(()=>{});
  const paper=await page.evaluate(n=>{
   const s=[...document.querySelectorAll('#reportContent .rp-section')]
     .find(x=>(x.querySelector('h3')||{}).textContent===n);
   if(!s)return null;
   const g=s.querySelector('.rp-grid');
   return {matrix:g.classList.contains('rp-grid-m'),
           cols:getComputedStyle(g).gridTemplateColumns.split(' ').length,
           heads:[...s.querySelectorAll('.rp-field-head')].map(e=>e.textContent),
           bare:s.querySelectorAll('.rp-field-bare').length,
           right:[...s.querySelectorAll('.rp-field-bare')].filter(e=>e.classList.contains('al-r')).length,
           vals:[...s.querySelectorAll('.rp-field-value')].map(e=>e.textContent),
           labels:s.querySelectorAll('.rp-field-label').length};
  },NAME);
  rec('③ 紙が3列のマトリクスになる（見出し5・値6・ラベルは出さない）',
      !!paper&&paper.matrix&&paper.cols===3&&paper.heads.length===5
      &&paper.bare===6&&paper.labels===0,
      JSON.stringify(paper));
  rec('③ 見出しの文字はMIN/MAXと板厚/板幅/板丈',
      !!paper&&paper.heads.join(',')==='MIN,MAX,板厚,板幅,板丈',
      paper&&paper.heads.join(','));
  rec('③ 寄せ（右）が当たる',!!paper&&paper.right===6,paper&&paper.right);
  /* **書式が実際に効いていること**（値そのもので見る・§CLAUDE）。
     板厚MINの見本は`0.296`なので、3桁＋`mm`で`0.296mm`。 */
  rec('④ 書式（小数3桁＋単位）が紙の値に効く',
      !!paper&&paper.vals.some(v=>/mm$/.test(v)),JSON.stringify(paper&&paper.vals));

  // ---- ⑤ 紙の塊のダブルクリック → 帳票ブロックマスタ --------------------
  const jumped=await page.evaluate(async n=>{
   /* 組み換えを開かないと塊は`draggable`にならないが、ダブルクリックの
      配線は組み換え中の塊にしか付かない。**その状態で確かめる**。 */
   const btn=document.querySelector('#reportArrange,#rpArrange,[data-rp-arrange]');
   if(btn)btn.click();
   await new Promise(r=>setTimeout(r,900));
   const el=[...document.querySelectorAll('#reportContent [data-rp-block]')]
     .find(x=>x.dataset.rpBlock===n);
   if(!el)return {err:'塊が見つからない'};
   el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));
   await new Promise(r=>setTimeout(r,1500));
   return {view:document.body.className,
           modal:!(document.querySelector('#maintEditorModal')||{hidden:true}).hidden,
           title:(document.querySelector('#maintEditorTitle')||{}).textContent};
  },NAME);
  rec('⑤ 紙の塊をダブルクリックすると帳票ブロックマスタのその行が開く',
      !!jumped&&/mm-mode/.test(jumped.view||'')&&jumped.modal===true
      &&String(jumped.title||'').indexOf(NAME)>=0,
      JSON.stringify(jumped));

  // ---- ⑥ 説明の量 -------------------------------------------------------
  await page.evaluate(()=>{const m=document.querySelector('#maintEditorModal');if(m)m.hidden=true});
  await page.waitForTimeout(200);
  const hints=async()=>page.evaluate(()=>({
   lv:document.documentElement.getAttribute('data-hint'),
   def:(document.querySelector('#masterMaintForm .mm-def-hint')||{}).textContent||'',
   more:document.querySelectorAll('#masterMaintForm .mm-more').length}));
  /* §9.276 ②。**帯ではなく浮きメニュー**になったので、押して開いてから選ぶ。
     `#mmHintMenu`は`body`直下（`#mmHead`は`overflow`を持つ器の中）。 */
  const setHint=async v=>{
   await page.evaluate(()=>document.querySelector('#mmHintBadge').click());
   await page.waitForSelector('#mmHintMenu',{timeout:5000});
   await page.evaluate(x=>document.querySelector(`#mmHintMenu [data-hint-lv="${x}"]`).click(),v);
   await page.waitForFunction(x=>document.documentElement.getAttribute('data-hint')===x
     &&!document.getElementById('mmHintMenu'),v,{timeout:5000});
   await page.waitForTimeout(250);
  };
  await page.evaluate(()=>document.querySelector('#masterMaintNav [data-master="equipment"]')?.click());
  await page.waitForTimeout(900);
  const full=await hints();
  await setHint('short');
  const short=await hints();
  await setHint('off');
  const off=await hints();
  await setHint('full');
  rec('⑥ 「短め」は最初の1文だけ（文の途中で切らない）',
      short.def.length>0&&short.def.length<full.def.length&&/。$/.test(short.def),
      JSON.stringify({full:full.def.length,short:short.def}));
  rec('⑥ 「出さない」で説明が消える',off.def==='' &&off.lv==='off',JSON.stringify(off));
  rec('⑥ 通常へ戻せる（片道にしない）',(await hints()).def===full.def);
  /* **いま何を選んでいるかはボタンに文字で出す**（§CLAUDE 3）——畳んだだけで
     現在値が読めなくなるのでは、場所を空けた意味が無い。 */
  await setHint('short');
  const badge=await page.evaluate(()=>({
   label:(document.querySelector('#mmHintLabel')||{}).textContent||'',
   title:(document.querySelector('#mmHintBadge')||{}).title||''}));
  rec('⑥ いま選んでいる量をボタンが名乗る',
      badge.label==='短め'&&/短め/.test(badge.title),JSON.stringify(badge));

  /* ---- ⑦ 専用の画面（`special:*`）を潰さない（§9.276 ②、利用者の報告） ----
     「マスタを確認しているときに説明文の長さを切り替えると、マスタ表示内容が
      消えます」——`renderMaintList()`が汎用の一覧を無条件に書いていたため。
     **専用の画面で試すこと**——ふつうのマスタ（設備）で切り替える網は、
     直す前でも通る（あちらは汎用の一覧そのものなので描き直せば戻る）。 */
  await page.evaluate(()=>document.querySelector('#masterMaintNav [data-master="presence"]')?.click());
  /* **待つのは「その画面の実物」**（§9.102）——「文字が10字を超えた」で
     待つと、読み込み中の一言でも通ってしまい、まだ描けていない画面を
     測ることになる（実際にそれで落ちた）。 */
  await page.waitForSelector('#pzList',{timeout:20000});
  const before=await page.evaluate(()=>({
   len:document.getElementById('masterMaintList').textContent.replace(/\s+/g,'').length,
   pz:!!document.getElementById('pzList')}));
  await setHint('off');
  await page.waitForTimeout(600);
  const after=await page.evaluate(()=>({
   len:document.getElementById('masterMaintList').textContent.replace(/\s+/g,'').length,
   pz:!!document.getElementById('pzList')}));
  rec('⑦ 説明の量を切り替えても専用の画面の中身が消えない',
      before.pz&&after.pz&&after.len>10,JSON.stringify({before,after}));
  await setHint('full');

 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  /* **後始末**（§9.121）——作った塊と紙の設定を残さない。 */
  try{
   await page.evaluate(async ([n,eq])=>{
    try{
     const l=await api('/api/report-block-master?equipment=');
     const r=(l.items||[]).find(x=>x.name===n);
     if(r)await api('/api/report-block-master/delete',{method:'POST',
       headers:{'Content-Type':'application/json'},
       body:JSON.stringify({user_id:'rbcells',id:r.id})});
     if(window.WL&&WL.reportBlocks)WL.reportBlocks.forget();
     /* 紙の並びからも外す（残すと次の実行が「知らない列」として末尾へ回す）。 */
     /* **紙の設定ごと消す**（§9.121）——この網は④で自分から配置を保存する
        ので、残すと次の実行がその置き土産を引き継ぐ（見本のロットの設備は
        `run_all.sh`の`resetcontent`の対象でもなかった）。 */
     const t=WL.reportLayout.targetOf(eq);
     await api('/api/column-layout-master',{method:'POST',
       headers:{'Content-Type':'application/json'},
       body:JSON.stringify({target:t,clear:true,order:[],hidden:[],widths:{},
         names:{},formats:{},rules:{},formulas:{},locks:[],sorts:{},user_id:'rbcells'})});
     WL.columnLayout.forget(t);
    }catch(e){}
   },[NAME,EQ]);
   await page.evaluate(()=>{try{localStorage.removeItem('MasterHintLevelV1')}catch(e){}});
  }catch(e){}
  try{if(b)await b.close()}catch(e){}
 }
 const ng=R.filter(x=>!x.ok);
 console.log('\n=== SUMMARY ===');console.log(`${R.length-ng.length}/${R.length} passed`);
 ng.forEach(x=>console.log(' -',x.n,x.d||''));
 process.exit(ng.length?1:0);
})().catch(async e=>{
 console.log('FATAL:',e.message);
 try{if(b)await b.close()}catch(_){}
 process.exit(1);
});
