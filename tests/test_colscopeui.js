/* test_colscopeui.js: 列の見せ方を「みんなと同じ／自分だけ」で選ぶ・画面側（§9.259）
   ============================================================
   利用者の指示:
     「列の表示の部分については、こだわりが強い人もいるので、表示する一覧表毎に
      共通のものを使うか、個別ID単位のものを使うか選べるようにしたいです。」

   ここで固定すること。**どれも直す前なら落ちる**ことを確かめてある。
    1. 列の設定パネルに、いまどちらで見ているかが**文字で**出る（§3）
    2. 押すと自分だけの設定になり、**いまの見え方がそのまま写る**
       （白紙から始めない＝こだわって作った並びが消えたように見えない）
    3. 自分だけの設定を変えても、**共通の設定は変わらない**
    4. みんなと同じに戻せる。**戻しても自分の設定は消えない**
    5. 利用者IDが分からない端末では**押せなくして理由を書く**（§4）
    6. 紙の割り付け（操業データ表）には切り替えを出さない
       ——同じ名前の紙を2人が刷って中身が違う、が起きるため
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)}).then(async r=>({code:r.status,json:await r.json().catch(()=>({}))}));
const UID='tests-colscope-'+Date.now();
let b=null,TARGET='';
/* 列レイアウトマスタは**実行をまたいで生き延びる**（§9.121）ので必ず片付ける。 */
async function cleanup(){
 if(!TARGET)return;
 const wipe=u=>post('/api/column-layout-master',{target:TARGET,clear:true,order:[],widths:{},hidden:[],
   names:{},formats:{},rules:{},formulas:{},locks:[],user_id:u}).catch(()=>{});
 /* **個人設定を先に消す**（§9.121）。誰の行を読み書きするかは
    `column_layout_owner()`が答える（§9.259）ので、先に「みんなのもの」へ
    戻してから消すと、**消えるのは共通の行だけ**で個人の行が残る
    ——実行のたびに`tests-colscope-<時刻>`の行が積み上がっていた（実測436行）。 */
 await wipe(UID);
 await post('/api/column-layout-master/scope',{target:TARGET,scope:'common',user_id:UID}).catch(()=>{});
 for(const u of [UID,'']) await wipe(u);
}

(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('dialog',d=>d.accept());
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:30000});
  await page.evaluate(u=>{
   localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A');
   /* 利用者IDはこの端末の設定。**明示的に置く**——空のままだと
      「IDが分からない端末」の道しか通らない。 */
   localStorage.setItem('AccessMeasurementUserId',u);
  },UID);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#grid table',{timeout:30000});
  await page.waitForSelector('#grid th[data-col]',{timeout:30000});
  await page.waitForFunction(()=>typeof listLayoutTarget==='function'&&!!listLayoutTarget(),
                             null,{timeout:30000});
  TARGET=await page.evaluate(()=>listLayoutTarget());
  const uidSeen=await page.evaluate(()=>(window.currentUserId&&currentUserId())||'');
  rec('前提: 仕掛一覧が開けて対象と利用者IDが決まる',!!TARGET&&uidSeen===UID,TARGET+' / '+uidSeen);
  await cleanup();
  await page.evaluate(()=>WL.columnLayout.forget&&WL.columnLayout.forget());

  const openPanel=async()=>{
   await page.evaluate(()=>{
    const p=document.getElementById('listColumnPanel');if(p)p.hidden=true;
    WL.listColumns.open();
   });
   await page.waitForSelector('#lcScope:not([hidden])',{timeout:15000});
   await page.waitForFunction(()=>{
    const n=document.getElementById('lcScopeNow');
    return n&&n.textContent.trim().length>0;
   },null,{timeout:15000});
  };
  const scopeUi=()=>page.evaluate(()=>{
   const n=document.getElementById('lcScopeNow'),b=document.getElementById('lcScopeBtn'),
         t=document.getElementById('lcScopeNote'),box=document.getElementById('lcScope');
   return {hidden:!!box.hidden,now:(n.textContent||'').trim(),btn:(b.textContent||'').trim(),
           note:(t.textContent||'').trim(),disabled:!!b.disabled,
           scope:WL.columnLayout.scope(listLayoutTarget())};
  });

  /* ========== 1) いまどちらで見ているかが文字で出る ========== */
  await openPanel();
  let ui=await scopeUi();
  rec('パネルに「いまどちら」が文字で出る',!ui.hidden&&/みんなと同じ/.test(ui.now),
      ui.now+' / '+ui.scope);
  rec('既定は「みんなと同じ」',ui.scope==='common',ui.scope);
  rec('押すと何になるかがボタンに書いてある',/自分だけ/.test(ui.btn),ui.btn);
  rec('効く範囲が文で書いてある',/全員/.test(ui.note),ui.note);

  /* ========== 2) 共通の並びを作ってから、自分だけへ切り替える ========== */
  const COMMON=await page.evaluate(async()=>{
   const t=listLayoutTarget(),live=WL.listColumnKeys();
   /* 共通の設定として「先頭の列に決まった幅」を入れておく。 */
   await WL.columnLayout.save(t,{order:live,widths:{[live[0]]:123},hidden:[],names:{},
     formats:{},rules:{},formulas:{},locks:[]});
   return {col:live[0],w:(WL.columnLayout.saved(t).widths||{})[live[0]]};
  });
  rec('前提: 共通の設定を作れた',COMMON.w===123,JSON.stringify(COMMON));

  await openPanel();
  await page.click('#lcScopeBtn');
  await page.waitForFunction(()=>WL.columnLayout.scope(listLayoutTarget())==='personal',
                             null,{timeout:15000});
  ui=await scopeUi();
  rec('押すと「自分だけの設定」になる',ui.scope==='personal'&&/自分だけ/.test(ui.now),
      ui.now+' / '+ui.scope);
  rec('自分だけのときは「他の人の見え方は変わらない」と書く',/他の人/.test(ui.note),ui.note);
  const copied=await page.evaluate(c=>(WL.columnLayout.saved(listLayoutTarget()).widths||{})[c],
                                   COMMON.col);
  rec('切り替えた時点で、いまの見え方がそのまま写っている（白紙にしない）',
      copied===123,String(copied));

  /* ========== 3) 自分だけを変えても共通は変わらない ========== */
  await page.evaluate(async c=>{
   const t=listLayoutTarget();
   await WL.columnLayout.patch(t,{widths:{...(WL.columnLayout.saved(t).widths||{}),[c]:456}});
  },COMMON.col);
  const mine=await fetch(B+'/api/column-layout-master?target='+encodeURIComponent(TARGET)
                         +'&user='+encodeURIComponent(UID)).then(r=>r.json());
  const common=await fetch(B+'/api/column-layout-master?target='+encodeURIComponent(TARGET)
                           +'&user=').then(r=>r.json());
  rec('自分だけの幅が変わっている',(mine.widths||{})[COMMON.col]===456,
      JSON.stringify((mine.widths||{})[COMMON.col]));
  rec('共通の幅は変わっていない',(common.widths||{})[COMMON.col]===123,
      JSON.stringify((common.widths||{})[COMMON.col]));
  rec('サーバーもどちらを見ているか答える',mine.scope==='personal'&&common.scope==='common',
      mine.scope+' / '+common.scope);

  /* ========== 4) みんなと同じに戻せる。戻しても自分の設定は消えない ========== */
  await openPanel();
  await page.click('#lcScopeBtn');
  await page.waitForFunction(()=>WL.columnLayout.scope(listLayoutTarget())==='common',
                             null,{timeout:15000});
  const back=await page.evaluate(c=>(WL.columnLayout.saved(listLayoutTarget()).widths||{})[c],
                                 COMMON.col);
  rec('戻すと共通の見え方になる',back===123,String(back));
  const kept=await fetch(B+'/api/column-layout-master/scope',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({target:TARGET,scope:'personal',user_id:UID})}).then(r=>r.json());
  rec('もう一度自分だけにすると続きから使える',(kept.widths||{})[COMMON.col]===456,
      JSON.stringify((kept.widths||{})[COMMON.col]));

  /* ========== 5) 利用者IDが分からない端末では押せない ==========
     **「空を送れば断られる」を期待しないこと。** 誰の操作かは
     `request_user_id()`＝`current_login_id()`の1箇所が答える（§9.276 ③）ので、
     ログインIDを持つ端末では空にならない——空を送っても**この端末のID**で
     受ける。ここで守りたいのは§9.259の「**空を1つの入れ物にしない**」
     （IDを名乗れない端末どうしが同じ個人設定を共有してしまう）ほうなので、
     **空の持ち主の行ができないこと**を見る。IDを本当に持たない端末で断る
     ことは、この下の網（`user=`で読んで「持てない」と答える）が見ている。 */
  const noUid=await post('/api/column-layout-master/scope',{target:TARGET,scope:'personal',user_id:''});
  const asEmpty=await fetch(B+'/api/column-layout-master?target='+encodeURIComponent(TARGET)+'&user=')
    .then(r=>r.json()).catch(()=>({}));
  rec('空のIDでは「空の持ち主」を作らない',
      (noUid.code===400&&/利用者ID/.test(noUid.json.error||''))
      ||(noUid.code===200&&asEmpty.scope==='common'),
      noUid.code+' '+JSON.stringify({scope:noUid.json&&noUid.json.scope,空で読むと:asEmpty.scope}));
  /* この端末のIDで個人設定にしてしまったので共通へ戻す（§9.121）。 */
  await post('/api/column-layout-master/scope',{target:TARGET,scope:'common'});
  await page.evaluate(()=>localStorage.removeItem('AccessMeasurementUserId'));
  await page.evaluate(()=>WL.columnLayout.forget&&WL.columnLayout.forget());
  const noUidUi=await page.evaluate(async()=>{
   const t=listLayoutTarget();
   /* IDの無い状態で読み直す。**サーバーが「持てない」と答える**。 */
   const r=await api('/api/column-layout-master?target='+encodeURIComponent(t)+'&user=');
   return {can:!!r.canPersonalize,scope:r.scope};
  });
  rec('IDが無ければサーバーは「自分だけの設定は持てない」と答える',
      noUidUi.can===false&&noUidUi.scope==='common',JSON.stringify(noUidUi));

  /* ========== 6) 口が personalScope:false と言えば切り替えごと出ない ==========
     **実際にその口でパネルを開いて確かめる**——印の値を読むだけの網は、
     `renderScope()`が印を一度も見ていなくても通る。 */
  await page.evaluate(u=>localStorage.setItem('AccessMeasurementUserId',u),UID);
  const offHidden=await page.evaluate(async()=>{
   const p=document.getElementById('listColumnPanel');if(p)p.hidden=true;
   const live=WL.listColumnKeys();
   WL.listColumns.open({
    key:'__scopetest__',eyebrow:'検証',title:()=>'検証',
    target:()=>listLayoutTarget(),
    keys:()=>live,healed:()=>null,rows:()=>[],valueOf:()=>'',
    joined:()=>new Set(),joinFrom:()=>'',virtual:()=>({}),
    origins:()=>['source'],originOf:()=>'source',
    features:{formula:false,preset:false,width:true,format:false,rule:false,sort:false,
              personalScope:false},
   });
   const box=document.getElementById('lcScope');
   return !!(box&&box.hidden);
  });
  rec('personalScope:false の口では切り替えが出ない',offHidden===true,String(offHidden));
 }catch(e){
  console.log('FATAL '+(e&&e.message||e));R.push({n:'FATAL',ok:false,d:String(e&&e.message||e)});
 }finally{
  await cleanup().catch(()=>{});
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok);
 console.log('\n=== SUMMARY ===');
 console.log(`${R.length-ng.length}/${R.length} passed`);
 ng.forEach(x=>console.log(' - '+x.n+(x.d?' '+x.d:'')));
 process.exit(ng.length?1:0);
})();
