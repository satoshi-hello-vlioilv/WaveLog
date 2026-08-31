/* test_opblanktint.js: 未入力・未選択の配色と、増やした色（§9.286 ⑥）

   ============================================================
   利用者の指示
   ------------------------------------------------------------
   「未入力・未選択の場合にオレンジ色の着色をするというものも汎用設計前の
    ものなので、この機能も未選択、未入力の場合、配色するという機能を実装して
    ください。選択肢やこの背景色の選択で使う色のパレットの種類をさらに
    増やしてほしいです。」

   直す前は`updateValidationVisuals()`が**必須の欄だけ**に橙を当てており、
   ①必須でない欄は空でも何も出ない ②色は橙で固定、だった。

   ここで固定すること
   ------------------------------------------------------------
    1. 色の表は`WL.columnTint.PALETTE`の**1箇所**で、14色ある
    2. どの色も**実際に違う色**になる（トークンが解ける）
    3. 操業データ項目に「未入力の色」の欄があり、選ぶと保存される
    4. 選んだ色は**空のあいだだけ**測定画面の欄に付き、値を入れると消える
    5. 既定（設定していない欄）は今までどおり——**色の印を持たない**

   **「札が並ぶ」だけを見ないこと**——実際に描かれた色（`background-color`）で
   見る。クラスや属性が付くだけでは絵は変わらない（§9.229 ⑥の教訓）。
   後片付けは finally で必ず（§9.121。組み込みの行は消せないので元へ戻す）。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EQ='テスト設備A';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)}).then(async r=>({code:r.status,json:await r.json().catch(()=>({}))}));
const get=p=>fetch(B+p).then(r=>r.json());
let b=null;

(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1800,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,160)));
 page.on('dialog',d=>d.accept());

 const items=async()=>(await get('/api/operation-item-master')).items||[];
 const byName=async nm=>(await items()).find(x=>x.name===nm)||{};
 /* **`/update`は全列を書く**（§9.113／§9.212 ②）ので、触らない値も送り返す。 */
 const put=async(name,patch)=>{
  const r=await byName(name);
  const body={};
  ['id','name','group','place','type','unit','choice','decimals','min','max',
   'widget','order','required','enabled','initial','noBlank','freeText','layout',
   'span','groupSpan','role','unitPlace','align','valueFormat','digits',
   'note','minFrom','maxFrom','sourceNote','blankTint'].forEach(k=>{if(k in r)body[k]=r[k]});
  body.equipment=r.equipmentText||r.equipment||'*';
  body.user_id='tests';
  Object.assign(body,patch);
  return post('/api/operation-item-master/update',body);
 };
 const openMeasure=async()=>{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  const ok=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r){r.querySelector('.sc-row-start').click();return true}return false;
  });
  if(!ok)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
  await page.waitForFunction(()=>!!(window.WL&&WL.opData&&WL.opData.defs&&WL.opData.defs().length),
    null,{timeout:25000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 };
 const TARGET='オペレータ',KEY='operator';
 let saved=null;

 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});

  /* ==========================================================
     1) 色の表は1箇所。14色あって、どれも違う色になる
     ========================================================== */
  const pal=await page.evaluate(()=>{
   const t=window.WL&&WL.columnTint;
   if(!t)return null;
   const keys=t.keys();
   /* **実際に描かれる色で見る**——`var(--…)`の字を数えても、トークンが
      無ければ同じ「解けない色」になる（§9.229 ⑥）。 */
   const probe=document.createElement('div');
   document.body.appendChild(probe);
   const seen=keys.map(k=>{
    probe.style.background=t.PALETTE[k].bg;
    probe.style.color=t.PALETTE[k].ink;
    const cs=getComputedStyle(probe);
    return {k,label:t.label(k),note:t.note(k),bg:cs.backgroundColor,ink:cs.color};
   });
   probe.remove();
   return {keys,seen};
  });
  rec('色の表が WL.columnTint にある',!!pal,pal?'':'WL.columnTint が無い');
  rec('色が14色ある（7色から増やした）',pal&&pal.keys.length>=14,
      pal?`${pal.keys.length}色: ${pal.keys.join(',')}`:'-');
  const uniqBg=pal?new Set(pal.seen.map(x=>x.bg)).size:0;
  rec('どの色も実際に違う面になる（トークンが解ける）',uniqBg===(pal?pal.keys.length:-1),
      `${uniqBg}/${pal?pal.keys.length:0} 種類`);
  rec('どの色にも呼び名と意味がある（色だけで伝えない）',
      !!pal&&pal.seen.every(x=>x.label&&x.note),
      pal?JSON.stringify(pal.seen.map(x=>x.label)):'-');

  /* ==========================================================
     2) マスタに「未入力の色」の欄がある／選ぶと保存される
     ========================================================== */
  const before=await byName(TARGET);
  if(before.id==null){rec('前提: オペレータの行がある',false,'見つかりません');throw Error('前提なし')}
  saved=String(before.blankTint||'');
  const vocab=(await get('/api/operation-item-master')).blankTints||[];
  rec('配色の語彙はサーバーが答える（画面へ写さない）',
      vocab.includes('')&&vocab.includes('なし')&&vocab.includes('pink'),
      JSON.stringify(vocab));

  const r1=await put(TARGET,{blankTint:'pink'});
  rec('未入力の色を保存できる',r1.code===200,JSON.stringify(r1.json).slice(0,120));
  const after=await byName(TARGET);
  rec('保存した色が読み直しても残る',after.blankTint==='pink',String(after.blankTint));
  /* **触っていない設定を巻き込まない**（§9.113）。 */
  rec('群・選択肢・置き場は巻き込まれない',
      after.group===before.group&&after.choice===before.choice&&after.place===before.place,
      `${after.group}/${after.choice}/${after.place}`);

  /* ==========================================================
     3) 空のあいだだけ色が付く（値を入れると消える）
     ========================================================== */
  await openMeasure();
  /* **塗られるのは中の欄**（`.validation-required`と同じ言語）。器ごと塗ると
     名前の文字まで色の上に乗る（§9.286 ⑥）。 */
  const shot=()=>page.evaluate(key=>{
   const sel=document.getElementById(key);
   const host=sel&&sel.closest('.opf-host');
   if(!host)return {ある:false};
   const cs=getComputedStyle(sel);
   return {ある:true,tint:host.dataset.opBlankTint||'',
           空:host.classList.contains('is-blank'),
           値:sel.value,
           面:cs.backgroundColor,帯:cs.boxShadow,
           器:getComputedStyle(host).backgroundColor};
  },KEY);
  const empty=await shot();
  rec('未入力のあいだ、その欄に色の印が付く',
      empty.ある&&empty.tint==='pink'&&empty.空===true,JSON.stringify(empty));
  /* **実際に塗られていること**まで見る（印だけでは絵は変わらない）。 */
  rec('未入力のあいだ、実際に欄の面が塗られる',
      empty.ある&&empty.面!=='rgba(0, 0, 0, 0)'&&empty.面!=='transparent'
      &&empty.面!=='rgb(255, 255, 255)',
      String(empty.面));
  /* **必須の欄でも、選んだ色が既定の橙より優先する**（選んだのに効かないの
     では§4）——`@layer state`に置いてあることの確認。 */
  rec('合図は面と左端の帯（.validation-requiredと同じ言語）',
      /inset/.test(String(empty.帯||'')),String(empty.帯).slice(0,60));
  rec('器（名前の行）は塗らない',
      empty.器==='rgba(0, 0, 0, 0)'||empty.器==='transparent',String(empty.器));

  const filled=await page.evaluate(key=>{
   const sel=document.getElementById(key);
   const v=[...sel.options].map(o=>o.value).find(x=>x!=='');
   if(v===undefined)return null;
   sel.value=v;sel.dispatchEvent(new Event('change',{bubbles:true}));
   const host=sel.closest('.opf-host');
   return {値:sel.value,空:host.classList.contains('is-blank'),
           面:getComputedStyle(host).backgroundColor};
  },KEY);
  if(filled)rec('値を入れると色が消える',filled.空===false&&filled.面!==empty.面,
                JSON.stringify(filled));
  else rec('値を入れると色が消える',false,'選べる値がありません');

  /* ==========================================================
     4) 既定（設定していない欄）は今までどおり印を持たない
     ========================================================== */
  await put(TARGET,{blankTint:''});
  await openMeasure();
  const def=await shot();
  rec('設定していない欄は色の印を持たない（今までどおり）',
      def.ある&&def.tint===''&&def.空===false,JSON.stringify(def));

  /* 「なし」も印を持たない（＝空でも塗らない）が、**保存値は残る**。 */
  await put(TARGET,{blankTint:'なし'});
  const none=await byName(TARGET);
  rec('「なし」は保存値として残る',none.blankTint==='なし',String(none.blankTint));
  await openMeasure();
  const noneShot=await shot();
  rec('「なし」のときは空でも塗らない',noneShot.ある&&noneShot.tint==='',
      JSON.stringify(noneShot));

  /* ==========================================================
     5) **窓から保存できる**（§9.287-H、利用者の報告「未入力の色については
        保存がききません」）

        直す前は`opSaveItem()`の`body`に`blankTint`が無かった。`item_upsert`は
        `None`を「触っていない」と読んで今の値を残すので、**押した瞬間は
        見本の色が変わるのに、開き直すと元へ戻る**——いちばん気づきにくい形。
        **APIを直接叩くだけの網では捕まらない**（サーバーは最初から受け付けて
        いた・§9.228 ①と同じ教訓）ので、**必ず窓を通す**。
     ========================================================== */
  await put(TARGET,{blankTint:''});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:30000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.evaluate(()=>{try{localStorage.setItem('AccessMeasurementUserId','tests')}catch(e){}});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintNav [data-master="opItem"]',{timeout:20000});
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('.op-board',{timeout:20000});
  await page.waitForTimeout(900);
  const opened=await page.evaluate(nm=>{
   const t=[...document.querySelectorAll('.op-tile')].find(e=>e.textContent.indexOf(nm)>=0);
   if(!t)return false;t.click();return true;
  },TARGET);
  if(!opened){rec('前提: 盤にオペレータのカードがある',false,TARGET)}
  else{
   await page.waitForFunction(()=>{
    const m=document.getElementById('opItemModal');return !!m&&!m.hidden;
   },null,{timeout:10000});
   await page.evaluate(()=>{
    const t=[...document.querySelectorAll('.op-tab')].find(x=>/見せる/.test(x.textContent));
    if(t)t.click();
   });
   await page.waitForTimeout(400);
   /* ---- 意匠の「色」も同じ画面（§9.287-G、利用者の指示「色の部分も
          もっとたくさんの色を選べるように」） ----
      **見本の丸は実物と同じ色を引く**（見本が嘘をつかない・§CLAUDE 6）ので、
      札が並ぶだけでなく**実際に違う色になる**ことまで見る。 */
   const hues=await page.evaluate(()=>{
    const bs=[...document.querySelectorAll('.op-look-swatch')];
    const seen=bs.map(b=>{
     const i=b.querySelector('i');
     return {name:(b.querySelector('span')?.textContent||'').trim(),
             bg:i?getComputedStyle(i).backgroundColor:'',
             note:b.title||''};
    });
    return {n:bs.length,seen};
   });
   rec('意匠の色が増えている（既定＋13色）',hues.n>=14,`${hues.n}色`);
   rec('どの色も実際に違う面になる（トークンが解ける）',
       new Set(hues.seen.map(x=>x.bg)).size===hues.n,
       JSON.stringify([...new Set(hues.seen.map(x=>x.bg))].length+'/'+hues.n));
   rec('どの色にも意味が書いてある（名前だけの色を増やさない）',
       hues.seen.every(x=>x.note&&x.note!==x.name),
       JSON.stringify(hues.seen.filter(x=>!x.note||x.note===x.name).map(x=>x.name)));

   const clicked=await page.evaluate(()=>{
    const b=document.querySelector('[data-op-btint="purple"]');
    if(!b)return false;b.click();return true;
   });
   rec('「未入力の色」の札が窓にある',clicked,String(clicked));
   await page.click('#opdSave');
   await page.waitForTimeout(1800);
   const savedUi=await byName(TARGET);
   rec('窓から選んだ色がマスタに残る（画面の保存経路）',
       savedUi.blankTint==='purple',String(savedUi.blankTint));
   /* **触っていない設定を巻き添えにしない**（§9.113）。 */
   rec('窓から保存しても群・選択肢は変わらない',
       savedUi.group===before.group&&savedUi.choice===before.choice,
       `${savedUi.group}/${savedUi.choice}`);
  }

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  console.log('FATAL: '+(e&&e.stack||e));
  R.push({n:'FATAL',ok:false});
 }finally{
  try{if(saved!==null)await put(TARGET,{blankTint:saved})}catch(e){}
  try{await post('/api/access-mode',{mode:'edit'})}catch(e){}
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok).length;
 console.log(`\n${R.length-ng}/${R.length} PASS`);
 process.exit(ng?1:0);
})();
