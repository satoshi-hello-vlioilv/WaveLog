/* tests/lib/harness.js: 網の土台を1本にする（3-15 ①・§9.347）
   ============================================================
   161本の網のうち159本が「起動・rec・pageerror・close」を書き写していた。
   写しが159あると、§9.342 のような横断の変更（素のダイアログをやめる）が
   159箇所の問題になる。ここに集める。

     const {run}=require('./lib/harness.js');
     run('test_x: 何を見るか', async ({page,rec,B,setMode,idle,paint,W})=>{
       await page.goto(B+'/',{waitUntil:'domcontentloaded'});
       await W.booted(page); await idle();
       rec('…',cond,detail);
     }, {mode:'edit', viewport:{width:1700,height:1000}});

   この土台が受け持つこと:
    ・起動（環境変数で上書き可）と page（取得の数え上げ `track` を航行の前に張る）
    ・rec と集計（`PASS:`/`FAIL:` の行と `=== SUMMARY ===`——run_all.sh が数える形）
    ・pageerror の収集（`errs` で読める。**落とすかどうかは網が決める**——
      既存の網は「JSエラーが出ていない」を自分の判定として持っているので、
      土台が勝手に足すと二重に数える）
    ・**素のダイアログが1度も出ないこと**（§9.342。ここは横断の約束なので
      土台が1つ判定を足す。出たら閉じずに記録する——閉じると次の待ちが通って
      何事も無かったように見える）
    ・`mode` を渡した網は、終わりに必ず `edit` へ戻す
    ・**落ちてもブラウザを閉じる**（閉じ忘れは後続の網を連鎖で落とす）
    ・終了コード: 0＝全部PASS ／ 1＝FAILあり ／ 2＝FATAL（例外）
   ============================================================ */
'use strict';
const W=require('./wait.js');
const B='http://127.0.0.1:5029';

async function run(title,body,opts={}){
 const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
 const exe=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
 const R=[],errs=[],native=[];
 const rec=(n,ok,d)=>{R.push({n,ok:!!ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const setMode=async m=>{await fetch(B+'/api/access-mode',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
 if(title)console.log('# '+title);
 let b=null,fatal=null;
 try{
  if(opts.mode)await setMode(opts.mode);
  b=await chromium.launch({executablePath:exe});
  /* 文脈を1つ作る。`init` は最初の航行より前に走らせる小さな仕込み
     （localStorage へ使用設備を入れる等。test_listcache が使う）。 */
  const ctx=await b.newContext({viewport:opts.viewport||{width:1700,height:1000}});
  if(opts.init)await ctx.addInitScript(opts.init);
  const page=await ctx.newPage();
  page.on('pageerror',e=>{errs.push(e.message);console.log('[pageerror]',String(e.message||e).slice(0,160))});
  page.on('dialog',async d=>{native.push(d.type()+':'+d.message().slice(0,60));await d.dismiss().catch(()=>{})});
  const t=W.track(page);
  await body({page,rec,B,setMode,idle:t.idle,pending:t.pending,paint:()=>W.paint(page),W,errs,browser:b});
 }catch(e){
  fatal=e;console.log('FATAL: '+(e&&e.stack||e));
  R.push({n:'FATAL',ok:false,d:String(e&&e.message||e)});
 }finally{
  if(opts.mode&&opts.mode!=='edit')await setMode('edit').catch(()=>{});
  if(b)await b.close().catch(()=>{});
  /* 置いた実績は土台が消す（§9.351・§9.360）。**1箇所に置く**——網ごとに
     書き写すと、書き忘れた本だけが無関係な網を落とす形で現れる。 */
  await clearRecords().catch(()=>{});
 }
 rec('素のダイアログが1度も出ていない（§9.342）',native.length===0,native.join(' / '));
 const ng=R.filter(x=>!x.ok);
 console.log(`\n=== SUMMARY ===\n${R.length-ng.length}/${R.length} passed`);
 ng.forEach(x=>console.log(' -',x.n,x.d||''));
 process.exit(fatal?2:(ng.length?1:0));
}
/* 後片付け: 触った一覧の列レイアウトを白紙へ戻す（§9.360 の追補）。
   **画面の列を触るとその一覧のレイアウトが保存される**ので、触った網は
   自分で消す。通しはランナーがマスタを丸ごと戻すので実害は出ないが、
   残すと①単独で回したとき自分のDBを汚し、②「共有状態を残した本」の
   報告がうるさくなって**本物の置き土産が埋もれる**。
   payload は `run_all.sh` の `resetcontent` と同じ形（送っていない設定だけが
   生き延びるのを防ぐため `clear:true` を必ず付ける・§9.212 ②）。 */
async function clearLayout(target,userId='test'){
 await fetch(B+'/api/column-layout-master',{method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({target,clear:true,order:[],hidden:[],widths:{},names:{},
     formats:{},rules:{},formulas:{},locks:[],sorts:{},user_id:userId})}).catch(()=>{});
}
/* 後片付け: この網が置いた実績（`Web測定バックアップ`）を空へ戻す（§9.351）。
   残った実績は**計画外実績として予定表に現れ**（§9.33）、行数・作業可否・
   「作業中」の有無を変える——後片付けを忘れた1本が、無関係な網を落とす。
   ランナーは1本ごとに空へ戻す（§9.360）ので、ここで消えるのは
   **この網が作ったぶんだけ**。単独で回したときも同じように綺麗になる。
   戻り値は消した件数（0なら何も置いていない）。 */
async function clearRecords(){
 const r=await fetch(B+'/api/measurement/backup/list').then(x=>x.json()).catch(()=>({items:[]}));
 const ids=[...new Set((r.items||[]).map(i=>i.id).filter(Boolean))];
 if(!ids.length)return 0;
 await fetch(B+'/api/measurement/backup/delete',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})}).catch(()=>{});
 return ids.length;
}
module.exports={run,B,clearLayout,clearRecords};
