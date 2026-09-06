/* test_colio.js: 列の設定の持ち出し・取り込み(§9.178)
   ============================================================
   フィルタと同じ要望(「全てまたは各一覧単位で」)が列の設定にも来た。
   ここで固定するのは次の点。
    1. サーバーが**保存済みの全対象**を返す(画面はここでしか知れない)
    2. パネルの中に帯として開く(モーダルを増やさない)
    3. 「この一覧だけ／すべての一覧」を選べて、件数が文字で出る
    4. 運ぶもの・運ばないものを画面に書く
    5. 取り込みは「この一覧へ当てる」と「全部マスタへ書き込む」の2つ
    6. 取り込みで実際にマスタが書き換わる
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const fs=require('fs');const os=require('os');const path=require('path');
const B='http://127.0.0.1:5029';
const T1='list:__io_test_a__:表A';
const T2='list:__io_test_b__:表B';
let b=null,curTarget='';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const layout=t=>fetch(B+'/api/column-layout-master?target='+encodeURIComponent(t)).then(r=>r.json());
async function cleanup(){
 for(const t of [T1,T2,curTarget]){
  if(!t)continue;
  try{await post('/api/column-layout-master',{target:t,clear:true,order:[],widths:{},hidden:[],names:{},formats:{},rules:{},formulas:{},locks:[],user_id:'test'})}catch(e){}
 }
}
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const W=require('./lib/wait.js');const {idle}=W.track(page);const paint=()=>W.paint(page);
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];page.on('pageerror',e=>errs.push(e.message));
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wl-colio-'));
 try{
  await cleanup();
  // ---- 1. 全対象を返すAPI
  await post('/api/column-layout-master',{target:T1,order:['あ','い'],widths:{'あ':120},
   hidden:['い'],names:{'あ':'アー'},formats:{},rules:{},formulas:{},locks:[],user_id:'test'});
  const all=await (await fetch(B+'/api/column-layout-master?all=1')).json();
  const hit=(all.items||[]).find(x=>x.target===T1);
  rec('all=1 が保存済みの全対象を返す',!!hit&&hit.order.join(',')==='あ,い',JSON.stringify(hit&&hit.order));
  rec('all=1 の中身に幅・非表示・表示名が入る',
      !!hit&&hit.widths['あ']===120&&hit.hidden.includes('い')&&hit.names['あ']==='アー',
      JSON.stringify(hit&&{w:hit.widths,h:hit.hidden,n:hit.names}));

  // ---- 2-4. 画面
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('aside [data-db-key]',{timeout:25000});
  await W.booted(page);
  await page.click('aside [data-db-key]');
  await page.waitForSelector('#grid tbody tr',{timeout:25000});
  await idle(400,15000);
  /* この一覧そのものにも設定を1つ持たせておく（§9.216 ③の下ごしらえ）。
     取り込みは**写しを丸ごと捨てる**ので、捨てたあと取り直さないと、
     取り込みと無関係なこの一覧の設定まで画面から消える。 */
  curTarget=await page.evaluate(()=>listLayoutTarget());
  const RENAMED=await page.evaluate(async()=>{
   const t=listLayoutTarget();
   const k=[...document.querySelectorAll('#grid th[data-sort-col]')]
     .map(x=>x.dataset.sortCol).find(x=>x&&!x.startsWith('__')&&x!=='#');
   await WL.columnLayout.patch(t,{names:{[k]:'取り込み前の名前'}});
   renderGrid();
   return k;
  });
  await paint();
  await page.click('#listColumnBtn');
  await page.waitForSelector('#listColumnPanel:not([hidden])',{timeout:8000});
  await idle(300,5000);
  const before=await page.evaluate(()=>document.querySelectorAll('.sc-float-win,#listColumnPanel').length);
  await page.click('#lcExport');
  await page.waitForSelector('#lcIo:not([hidden])',{timeout:8000}).catch(()=>{});
  await paint();
  const io=await page.evaluate(()=>{const x=document.getElementById('lcIo');
   return x&&!x.hidden?{title:document.getElementById('lcIoTitle').textContent,
     scopes:[...x.querySelectorAll('input[name=lcIoScope]')].map(r=>r.value),
     note:document.getElementById('lcIoNote').textContent,
     what:x.querySelector('.lc-io-what')?.textContent.replace(/\s+/g,' ')}:null});
  const after=await page.evaluate(()=>document.querySelectorAll('.sc-float-win,#listColumnPanel').length);
  rec('入出力はパネルの中に開く(モーダルを増やさない)',!!io&&after===before,`${before} -> ${after}`);
  rec('「この一覧だけ／すべての一覧」を選べる',!!io&&io.scopes.join(',')==='one,all',JSON.stringify(io&&io.scopes));
  rec('運ぶもの・運ばないものを画面に書く',
      !!io&&io.what.includes('運ぶもの')&&io.what.includes('運ばないもの'),String(io&&io.what).slice(0,90));
  const noteBefore=await W.textOf(page,'#lcIoNote');
  await page.click('#lcIo input[name=lcIoScope][value=all]');
  await W.changed(page,'#lcIoNote',noteBefore,5000);  // 説明文が「すべての一覧」の文へ変わるまで
  const allNote=await page.evaluate(()=>({note:document.getElementById('lcIoNote').textContent,
   list:[...document.querySelectorAll('#lcIo .lc-io-list li code')].map(x=>x.textContent)}));
  rec('「すべての一覧」で件数と対象が出る',allNote.list.includes(T1)&&/\d+件/.test(allNote.note),
      JSON.stringify(allNote).slice(0,160));

  // ---- 実際に書き出す
  const dl=page.waitForEvent('download',{timeout:15000});
  await page.click('#lcIoRun');
  const d=await dl;
  const file=path.join(tmp,'out.json');
  await d.saveAs(file);
  const payload=JSON.parse(fs.readFileSync(file,'utf-8'));
  rec('ファイルの形が決まっている',payload.kind==='wavelog-column-layouts'&&Array.isArray(payload.items),
      JSON.stringify({kind:payload.kind,n:(payload.items||[]).length}));
  rec('書き出したファイルに対象ぶんが入る',(payload.items||[]).some(x=>x.target===T1),
      JSON.stringify((payload.items||[]).map(x=>x.target)).slice(0,120));

  // ---- 5-6. 取り込みでマスタが書き換わる
  const imp=path.join(tmp,'in.json');
  fs.writeFileSync(imp,JSON.stringify({kind:'wavelog-column-layouts',version:1,items:[
   {target:T2,body:{order:['X','Y'],widths:{'X':240},hidden:['Y'],names:{'X':'エックス'},
                    formats:{},rules:{},formulas:{},locks:[]}}]}));
  await page.click('#lcImport');
  await paint();
  await page.setInputFiles('#lcImportFile',imp);
  // ファイルを読んで中身の一覧が出るまで
  await page.waitForFunction(()=>document.querySelectorAll('#lcIo .lc-io-list code').length>0,null,{timeout:8000}).catch(()=>{});
  await paint();
  const impUi=await page.evaluate(()=>{const x=document.getElementById('lcIo');
   return {scopes:[...x.querySelectorAll('input[name=lcIoImp]')].map(r=>r.value+(r.disabled?'(不可)':'')),
     list:[...x.querySelectorAll('.lc-io-list code')].map(c=>c.textContent),
     note:document.getElementById('lcIoNote').textContent}});
  rec('ファイルの中身を先に見せる',impUi.list.includes(T2),JSON.stringify(impUi.list));
  rec('この一覧に無い対象は「当てる」を選べない',impUi.scopes.some(s=>s.startsWith('one')&&s.includes('不可')),
      JSON.stringify(impUi.scopes));
  await page.click('#lcIoRun');
  /* **置き換えは取り消せない**ので確認を挟む。押した先を待ってから答える
     (先に押しておくと、まだ出ていないボタンを押すことになる)。 */
  await page.waitForSelector('#appConfirmOk',{timeout:8000});
  const imported=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('column-layout'),{timeout:15000}).catch(()=>null);
  await page.click('#appConfirmOk');
  await imported;await idle(400,8000);
  const got=await layout(T2);
  rec('取り込みでマスタが書き換わる',(got.order||[]).join(',')==='X,Y'&&(got.widths||{})['X']===240,
      JSON.stringify({order:got.order,widths:got.widths}));
  rec('非表示・表示名も一緒に入る',(got.hidden||[]).includes('Y')&&(got.names||{})['X']==='エックス',
      JSON.stringify({hidden:got.hidden,names:got.names}));

  /* ---- 7) 取り込みのあと、この一覧の設定が消えない(§9.216 ③) ----
     `forget()`は写しを丸ごと捨てるが、`load()`は「写しがあれば取りに
     行かない」ので、捨てた直後に誰かが`get()`を呼ぶと**空の形**が写しへ
     入り直す。パネルは`useBody()`で下書きを当てて隠していたが、
     **保存せずに閉じた拍子に`discard()`で捨てられ**、一覧の設定が
     まるごと消えたように見えた（マスタには残っている）。

     **確かめるときは「保存せずに閉じる」まで通すこと**——パネルを
     開いたままでは下書きが覆い隠すので、直す前でも通る。 */
  const afterImport=await page.evaluate(k=>({
   name:WL.columnLayout.get(listLayoutTarget()).names[k]||'',
   head:[...document.querySelectorAll('#grid th[data-sort-col]')]
     .map(x=>x.textContent.replace(/\s+/g,'')).join('／'),
  }),RENAMED);
  rec('取り込み直後もこの一覧の設定が生きている（§9.216 ③）',
      afterImport.name==='取り込み前の名前',JSON.stringify(afterImport.name));
  await page.evaluate(()=>WL.listColumns.close());
  await idle(300,5000);
  const afterClose=await page.evaluate(k=>({
   name:WL.columnLayout.get(listLayoutTarget()).names[k]||'',
   shown:[...document.querySelectorAll('#grid th[data-sort-col]')]
     .some(x=>x.textContent.includes('取り込み前の名前')),
  }),RENAMED);
  rec('保存せずに閉じてもこの一覧の設定は戻らない（§9.216 ③）',
      afterClose.name==='取り込み前の名前'&&afterClose.shown===true,
      JSON.stringify(afterClose));

  rec('JSエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){console.log('FATAL: '+e.message);R.push({n:'FATAL',ok:false,d:e.message})}
 finally{
  await cleanup().catch(()=>{});
  try{fs.rmSync(tmp,{recursive:true,force:true})}catch(e){}
  await b.close();
  const ok=R.filter(x=>x.ok).length;
  console.log(`\n=== SUMMARY ===\n${ok}/${R.length} passed`);
  process.exit(ok===R.length?0:1);
 }
})();
