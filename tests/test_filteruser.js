/* test_filteruser.js: フィルタを個人単位で記録する（§9.172）
   ============================================================
   利用者の指示は「フィルタ機能は個人単位で記録できるようにしたいです。
   ローカル保存だったかとは思いますが」。

   直す前は2つの意味でずれていた。
     - 登録フィルタ（条件そのもの）は**マスタにあって全員共有**。誰かが登録
       すると全員の一覧に並ぶ。
     - 「デフォルト」「鍵」の印は**端末のlocalStorage**。同じPCを別の人が
       使うと相手の既定が当たり、自分が別のPCへ移ると印が消える。

   ここで固定すること:
    1. 登録フィルタには**持ち主**がある。自分のものと「みんなのもの」は見え、
       **他人の個人フィルタは見えない**。
    2. 既にある登録（所有者が空欄）は**みんなのもの**として全員に見え続ける。
       個人単位を後から入れたからといって、既存の登録が消えてはいけない。
    3. 印は**人に付く**。同じ端末でも人が違えば当たらない。人が同じなら
       端末が違っても当たる（＝置き場がマスタ側にある）。
    4. **他人の個人フィルタは消せない**（持ち主だけ）。
    5. 「自分だけ」と「みんな」を行き来できる。
    6. 端末に残っていた古い印（V1）は、**一度だけ**その人の印へ移る。

   後片付けは finally で必ず行う。名前に実行ごとの印を入れて、他のテストの
   登録を巻き込まない。
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const TAG='fu'+Date.now().toString(36);
const A='u-'+TAG+'-a', B='u-'+TAG+'-b';   // 2人ぶん
const DB='SIKALOTNOW',TBL='仕掛';

/* 触る前の行を控える（§9.362 ⑤）。製品の「登録フィルタを削除」は
   **論理削除**（`有効=0`）なので、APIで消しても行は残る。**この実行で
   増えた行だけ**を素の表から片付ける（名前で拾うと、同じ名前を使う
   他の網の期待と食い違う・§9.284）。 */
const H=require('./lib/harness.js');
const SNAP_TABLES=['フィルタプリセットマスタ','フィルタ個人設定マスタ'];
let snapM=null;
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 snapM=await H.masterSnapshot(SNAP_TABLES);
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 /* 「端末が違う」は**別のブラウザコンテキスト**（localStorageが別）で表す。 */
 const newTerminal=async user=>{
  const ctx=await b.newContext({viewport:{width:1500,height:950}});
  const page=await ctx.newPage();
  page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  if(user!==undefined)await page.evaluate(u=>localStorage.setItem('AccessMeasurementUserId',u),user);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('aside [data-db-key="SIKALOTNOW"]',{timeout:20000});
  await page.waitForSelector('#grid tbody tr',{timeout:30000});
  await page.waitForTimeout(700);
  return {ctx,page};
 };
 const post=(page,p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-filteruser'},a.b))});
  let j={};try{j=await r.json()}catch(e){}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 const seen=(page,user)=>page.evaluate(async u=>{
  const r=await fetch('/api/filter-presets?user='+encodeURIComponent(u));
  return (await r.json()).items||[];
 },user);
 const openPresets=async page=>{
  /* §9.286 ①: たまにしか使わない入口は`⋯`の浮きメニューへ畳んだ。**消していない**ので、開いてから押す。 */
  await page.click('#filterMoreBtn');
  await page.click('#openFilterPresets');
  await page.waitForSelector('#filterPresetModal:not([hidden])',{timeout:10000});
  await page.waitForTimeout(900);
 };
 let t1=null,t2=null;

 try{
  t1=await newTerminal(A);
  await post(t1.page,'/api/access-mode',{mode:'edit'});

  /* 用意: Aの個人フィルタ2件、Bの個人フィルタ1件、みんなのもの1件。 */
  const mk=(name,user,shared)=>post(t1.page,'/api/filter-presets',
    {name,db:DB,table:TBL,mode:'',user,shared:!!shared,
     filters:[{column:'ロットNo',op:'contains',value:name}]});
  await mk(`${TAG}-A1`,A);
  await mk(`${TAG}-A2`,A);
  await mk(`${TAG}-B1`,B);
  await mk(`${TAG}-S1`,A,true);

  /* ---- 1・2) 見えるのは「自分のもの」と「みんなのもの」だけ ---- */
  const forA=(await seen(t1.page,A)).filter(x=>x.name.startsWith(TAG)).map(x=>x.name);
  const forB=(await seen(t1.page,B)).filter(x=>x.name.startsWith(TAG)).map(x=>x.name);
  rec('自分のものとみんなのものが見える',
      forA.includes(`${TAG}-A1`)&&forA.includes(`${TAG}-A2`)&&forA.includes(`${TAG}-S1`),forA.join('、'));
  rec('他人の個人フィルタは見えない',
      !forA.includes(`${TAG}-B1`)&&!forB.includes(`${TAG}-A1`),
      `A: ${forA.join('、')} ｜ B: ${forB.join('、')}`);
  rec('みんなのものは相手にも見える',forB.includes(`${TAG}-S1`),forB.join('、'));

  /* 既にある登録（所有者が空欄）は、誰から見ても「みんなのもの」。 */
  const shared=(await seen(t1.page,A)).find(x=>x.name===`${TAG}-S1`);
  rec('所有者が空欄の登録は「みんなのもの」として扱う',
      !!shared&&shared.owner===''&&shared.shared===true&&shared.mine===false,
      JSON.stringify(shared&&{owner:shared.owner,shared:shared.shared}));

  /* ---- 3) 印は人に付く ---- */
  const a1=(await seen(t1.page,A)).find(x=>x.name===`${TAG}-A1`);
  await post(t1.page,'/api/filter-presets/marks',{user:A,id:a1.id,isDefault:true,isLocked:true});
  await post(t1.page,'/api/filter-presets/marks',{user:B,id:shared.id,isDefault:true,isLocked:false});
  const markA=(await seen(t1.page,A)).find(x=>x.id===a1.id);
  const sharedForA=(await seen(t1.page,A)).find(x=>x.id===shared.id);
  const sharedForB=(await seen(t1.page,B)).find(x=>x.id===shared.id);
  rec('自分で付けた印は自分に当たる',markA.isDefault&&markA.isLocked,
      JSON.stringify({d:markA.isDefault,l:markA.isLocked}));
  /* **同じ登録でも、印は人ごと。** ここが以前は端末ごとで、同じPCを使う
     2人目に相手の既定が当たっていた。 */
  rec('同じ登録でも他人の印は自分に当たらない',
      sharedForB.isDefault===true&&sharedForA.isDefault===false,
      `Bさん=${sharedForB.isDefault} / Aさん=${sharedForA.isDefault}`);

  /* ---- 3b) 端末が変わっても人に付いてくる ---- */
  t2=await newTerminal(A);        // 別のlocalStorage、同じ人
  const onOther=(await seen(t2.page,A)).find(x=>x.id===a1.id);
  rec('別の端末でも同じ人なら印が付いてくる',onOther.isDefault&&onOther.isLocked,
      JSON.stringify({d:onOther.isDefault,l:onOther.isLocked}));
  await t2.ctx.close();t2=null;

  /* ---- 4) 他人の個人フィルタは消せない ---- */
  const b1id=(await seen(t1.page,B)).find(x=>x.name===`${TAG}-B1`).id;
  const denied=await post(t1.page,'/api/filter-presets/delete',{id:b1id,user:A});
  const stillThere=(await seen(t1.page,B)).some(x=>x.id===b1id);
  rec('他人の個人フィルタは消せない',denied.status===403&&stillThere,
      `${denied.status} ${JSON.stringify(denied.body).slice(0,70)}`);
  /* みんなのものは今までどおり誰でも消せる（作った人が辞めたあと、誰も
     片付けられなくなるのを避けるため）。 */
  const okDel=await post(t1.page,'/api/filter-presets/owner',{id:a1.id,user:B,shared:true});
  rec('他人の個人フィルタは持ち主も変えられない',okDel.status===403,
      `${okDel.status} ${JSON.stringify(okDel.body).slice(0,70)}`);

  /* ---- 5) 「自分だけ」と「みんな」を行き来できる ---- */
  await post(t1.page,'/api/filter-presets/owner',{id:a1.id,user:A,shared:true});
  rec('「みんな」へ出すと他の人にも見える',
      (await seen(t1.page,B)).some(x=>x.id===a1.id));
  await post(t1.page,'/api/filter-presets/owner',{id:a1.id,user:A,shared:false});
  rec('「自分だけ」へ戻すと他の人から消える',
      !(await seen(t1.page,B)).some(x=>x.id===a1.id)
      &&(await seen(t1.page,A)).some(x=>x.id===a1.id));

  /* ---- 画面: 誰の設定を見ているのかが読める ---- */
  await openPresets(t1.page);
  const ui=await t1.page.evaluate(()=>({
   summary:(document.getElementById('filterPresetSummary')||{}).textContent||'',
   owns:[...document.querySelectorAll('.filter-preset-item .fp-own')].map(x=>x.textContent),
  }));
  rec('誰の設定かを画面に書く',ui.summary.includes(`${'u-'}`)&&/自分だけ/.test(ui.summary)&&/みんな/.test(ui.summary),
      ui.summary.trim().slice(0,90));
  /* **色だけで持ち主を伝えない。** 言葉をそのまま出す。 */
  rec('1件ごとに持ち主を言葉で出す',
      ui.owns.length>0&&ui.owns.every(t=>t==='自分だけ'||t==='みんな'),ui.owns.join('、'));
  await t1.page.evaluate(()=>{document.getElementById('filterPresetModal').hidden=true});

  /* ---- 6) 端末に残っていた古い印は一度だけ移る ---- */
  const c=await mk(`${TAG}-C1`,A);
  const c1id=c.body&&c.body.id;
  t2=await newTerminal(undefined);   // まっさらな端末
  await t2.page.evaluate(([u,db,tbl,id])=>{
   localStorage.setItem('AccessMeasurementUserId',u);
   const put=(k,v)=>{const m={};m[`${db}::${tbl}::`]=[String(v)];localStorage.setItem(k,JSON.stringify(m))};
   put('MeasurementDefaultFilterPresetsV1',id);
   put('MeasurementLockedDefaultFilterPresetsV1',id);
  },[`u-${TAG}-c`,DB,TBL,c1id]);
  /* このC1はAさんのものなので、cさんには見えない。移行の題材にするため
     「みんなのもの」へ出しておく。 */
  await post(t1.page,'/api/filter-presets/owner',{id:c1id,user:A,shared:true});
  await t2.page.reload({waitUntil:'domcontentloaded'});
  await t2.page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await t2.page.click('aside [data-db-key="SIKALOTNOW"]',{timeout:20000});
  await t2.page.waitForSelector('#grid tbody tr',{timeout:30000});
  await t2.page.waitForTimeout(1800);
  const moved=(await seen(t2.page,`u-${TAG}-c`)).find(x=>x.id===c1id);
  rec('端末に残っていた古い印は、その人の印へ一度だけ移る',
      !!moved&&moved.isDefault===true&&moved.isLocked===true,
      JSON.stringify(moved&&{d:moved.isDefault,l:moved.isLocked}));
  /* 移したあとに外したら、次の起動で**戻ってこない**（移行は一度きり）。 */
  await post(t2.page,'/api/filter-presets/marks',{user:`u-${TAG}-c`,id:c1id,isDefault:false,isLocked:false});
  await t2.page.reload({waitUntil:'domcontentloaded'});
  await t2.page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await t2.page.click('aside [data-db-key="SIKALOTNOW"]',{timeout:20000});
  await t2.page.waitForSelector('#grid tbody tr',{timeout:30000});
  await t2.page.waitForTimeout(1800);
  const again=(await seen(t2.page,`u-${TAG}-c`)).find(x=>x.id===c1id);
  rec('移したあとに外した印は、次に開いても戻ってこない',
      !!again&&again.isDefault===false&&again.isLocked===false,
      JSON.stringify(again&&{d:again.isDefault,l:again.isLocked}));

  rec('コンソールに例外を出さない',errs.length===0,errs.slice(0,2).join(' / '));
 }catch(e){rec('FATAL',false,e.message)}
 finally{
  try{
   const page=(t1&&t1.page)||(t2&&t2.page);
   if(page){
    for(const u of [A,B,`u-${TAG}-c`]){
     const items=await seen(page,u);
     for(const x of items)if(String(x.name||'').startsWith(TAG))
       await post(page,'/api/filter-presets/delete',{id:x.id,user:x.owner||u});
    }
   }
  }catch(e){}
  try{if(t1)await t1.ctx.close()}catch(e){}
  try{if(t2)await t2.ctx.close()}catch(e){}
  try{if(snapM)await H.dropNewMasterRows(snapM)}
  catch(e){console.log('!! 増えた行を消せませんでした: '+(e&&e.message||e))}
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
