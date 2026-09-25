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
    ・**アクセスモードは始めの値へ戻す**（§9.494）。`mode` を渡した網も、網の中で自分で切り替えた網も同じ。
      持ち越すと、次の網の書込が403で黙って弾かれる（`test_scpick`→`test_sctimecols`で踏んだ）
    ・**落ちてもブラウザを閉じる**（閉じ忘れは後続の網を連鎖で落とす）
    ・終了コード: 0＝全部PASS ／ 1＝FAILあり ／ 2＝FATAL（例外）
    ・**製品が「ふだんの操作の副作用」で育てる表**の、この網が増やした行を消す（`SIDE_EFFECT_TABLES`）
   ============================================================ */
'use strict';
const W=require('./wait.js');
const B='http://127.0.0.1:5029';
/* **製品が副作用で育てる表**（網が狙って書くのではなく、ふだんの操作でサーバーが増やす）。
   選択履歴マスタは測定を保存するたびに選んだ値の回数を数える（§9.133）ので、測定を保存する網は
   **全部**1行増やす（通しで5本が名指しされた）。網ごとに控えと片付けを書き写すと書き忘れが出るので、
   実績（`clearRecords()`）と同じく**土台の1箇所**で「触る前に居なかった行」を消す。
   副作用で育つ表を製品に足したら、ここへ足す。 */
const SIDE_EFFECT_TABLES=['選択履歴マスタ'];

/* いまのアクセスモード（読めなければ空）。 */
async function getMode(){
 return fetch(B+'/api/access-mode').then(r=>r.json()).then(j=>String(j.mode||'')).catch(()=>'');
}
async function run(title,body,opts={}){
 const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
 const exe=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
 const R=[],errs=[],native=[];
 const rec=(n,ok,d)=>{R.push({n,ok:!!ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const setMode=async m=>{await fetch(B+'/api/access-mode',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
 if(title)console.log('# '+title);
 let b=null,fatal=null,sideSnap=null,mode0='';
 try{
  mode0=await getMode();
  if(opts.mode)await setMode(opts.mode);
  sideSnap=await masterSnapshot(SIDE_EFFECT_TABLES).catch(()=>null);
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
  /* 後片付けは**editで**行う（scheduleのままだと実績の削除が403で黙って弾かれる・testing.md）。
     終わったら**始めのモードへ戻す**（§9.494）。網の中で切り替えたまま終えると、次の網が
     別のモードで走り出し、前提を作る書込が403で弾かれる——落ちるのは離れた網の離れた判定。 */
  const modeEnd=await getMode();
  if(modeEnd&&modeEnd!=='edit')await setMode('edit').catch(()=>{});
  if(b)await b.close().catch(()=>{});
  /* 置いた実績は土台が消す（§9.351・§9.360）。**1箇所に置く**——網ごとに
     書き写すと、書き忘れた本だけが無関係な網を落とす形で現れる。 */
  await clearRecords().catch(()=>{});
  /* 副作用で育った行も土台が消す（上の`SIDE_EFFECT_TABLES`）。 */
  if(sideSnap)await dropNewMasterRows(sideSnap).catch(()=>{});
  if(mode0&&mode0!=='edit')await setMode(mode0).catch(()=>{});
  /* **網の中で自分で切り替えたまま終えた**ものだけ名指しする（`mode`を渡した網は土台が切り替えて
     土台が戻すので正しい）。黙って直すと、網の書き方の癖が見えないまま残る。 */
  const want=opts.mode||mode0;
  if(want&&modeEnd&&modeEnd!==want)console.log(`MODE-LEAK: 始め ${want} → 終わり ${modeEnd}（土台が ${mode0} へ戻した）`);
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
     formats:{},rules:{},formulas:{},locks:[],sorts:{},aligns:{},user_id:userId})}).catch(()=>{});
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
/* 素の表の中身（`id`は rowid）。**持ち主や論理削除まで見える唯一の口**——
   製品のAPIは「いま使える行」しか返さないので、残った行はここからしか分からない。 */
async function masterRows(table){
 const j=await fetch(B+'/api/master-table/'+encodeURIComponent(table)+'?limit=2000')
   .then(r=>r.json()).catch(()=>({}));
 return j.items||[];
}
/* 触る前の行を控える（§9.362 ⑤）。
   製品の「削除」が**論理削除**（`有効=0`）のマスタ——設備・勤務体系など——は、
   APIで消しても**行は残る**。触った網は自分で片付ける必要がある。
   **名前で拾わないこと**——名前を前提にすると、同じ名前を使う他の網の期待と
   食い違う（§9.284）。「**触る前に居なかった行**」だけを消す。 */
async function masterSnapshot(tables){
 const snap=new Map();
 for(const t of tables)snap.set(t,new Set((await masterRows(t)).map(r=>r.id)));
 return snap;
}
/* 控えより後に増えた行を消す。戻り値は消した件数（0なら何も残していない）。 */
async function dropNewMasterRows(snap){
 let n=0;
 for(const [t,ids] of snap){
  for(const r of await masterRows(t)){
   if(ids.has(r.id))continue;
   await fetch(B+'/api/master-table/'+encodeURIComponent(t)+'/delete',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({id:r.id})}).catch(()=>{});
   n++;
  }
 }
 return n;
}
/* 材料は自分で注ぎ込む（§9.351・§9.362 ⑥）。「記録が1件ある」ことを前提に
   する網は、**他の本の置き土産に頼らない**——ランナーが実績を1本ごとに空へ
   戻すようになった（§9.362 ①）ので、頼っていた網は待ちが timeout する。

   中身は`codec:'json-full-v32'`＝**レコードそのままのJSON**で渡すこと。
   `'x'`のような当て字だと一覧には出るが、**開いた先の帳票が組み立てられない**
   （実測: `.record-list-row`は出るのに`#reportContent .rp-blocks`で25秒待つ）。
   戻り値は記録ID。後片付けは`clearRecords()`が持つ。 */
async function seedRecord(opt={}){
 const id=opt.id||('seed-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6));
 const equipment=opt.equipment||'テスト設備A';
 const lotNo=opt.lotNo||('SEED-'+String(id).slice(-6));
 const basic={lotNo,inspectionNo:opt.inspectionNo||'',castingNo:opt.castingNo||''};
 const status=opt.status||'編集中';
 const body={id,equipment,lotNo,inspectionNo:basic.inspectionNo,castingNo:basic.castingNo,
   status,codec:'json-full-v32',user_id:opt.userId||'tests',
   payload:JSON.stringify(Object.assign(
     {id,status,basic,settings:{registeredEquipment:equipment},measurements:{}},opt.extra||{}))};
 await fetch(B+'/api/measurement/backup',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).catch(()=>{});
 return id;
}
/* 列レイアウトを**控えて、控えた形へ丸ごと戻す**（§9.360 の追補）。`clearLayout()`は白紙へ戻すので、
   **元から設定が在った対象では消しすぎる**（通しで test_actuals が「列レイアウトマスタ -1」と名指しされた）。
   逆に一部の鍵（`formulas`だけ等）を戻すと、元が空の対象に行が残る（test_colsrcfx が +3）。
   触る前に`snapLayout()`で控え、`restoreLayout()`で戻す——元が空なら白紙、そうでなければ控えた全部。 */
const LAYOUT_KEYS=['order','widths','hidden','names','formats','rules','formulas','locks','sorts','aligns'];
async function snapLayout(target){
 return fetch(B+'/api/column-layout-master?target='+encodeURIComponent(target)).then(r=>r.json()).catch(()=>({}));
}
async function restoreLayout(target,l,userId='test'){
 const v=l||{};
 const empty=!LAYOUT_KEYS.some(k=>{const x=v[k];return Array.isArray(x)?x.length:(x&&Object.keys(x).length)});
 if(empty){await clearLayout(target,userId);return}
 const body={target,user_id:userId};
 LAYOUT_KEYS.forEach(k=>{body[k]=v[k]||(k==='order'||k==='hidden'||k==='locks'?[]:{})});
 await fetch(B+'/api/column-layout-master',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(body)}).catch(()=>{});
}
module.exports={run,B,clearLayout,clearRecords,seedRecord,masterRows,masterSnapshot,dropNewMasterRows,snapLayout,restoreLayout};
