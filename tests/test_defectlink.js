/* test_defectlink.js: 異常位置判定と条の設計の連携（§9.226 ④）
   ============================================================
   利用者の指示:
     「欠陥をつかんで位置調整をできるようにしたい。条の設計（幅の割り付け）と
      異常位置判定をより連携させたいです。欠陥判定したら、条の設計にも
      表示したい(ONOFF可能)。判定した場合はバッジを表示して、欠陥が入って
      いることを表示する。バッジのダブルクリックから異常位置判定モーダルに
      移行できる。」

   ここで固定すること:
    - **図をつかんで位置を決められる**（距離が動き、判定が付いてくる）
    - **掴む対象は器**（欠陥の帯は描き直されるので、帯を掴む作りだと消える）
    - 条の設計に**該当条の印**が出る（色だけでなく文字も）
    - 印は**ダブルクリック**で判定の窓へ（単クリックは今までどおり条を選ぶ）
    - 出す/出さないを切り替えられ、**切でも「判定はある」ことは言う**

   **確かめるときは材料ごと注ぎ込むこと。** 検証用フィクスチャは母材幅を
   持たないので、そのまま開くと条を1本も描けず「0件」で素通りする
   （§CLAUDE「検証用フィクスチャには…材料ごと注ぎ込む」）。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
const setMode=m=>fetch(API+'/api/access-mode',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})});

let b=null,page=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 page=await b.newPage({viewport:{width:1920,height:1080}});
 const W=require('./lib/wait.js');const {idle}=W.track(page);const paint=()=>W.paint(page);
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));
 page.on('dialog',d=>d.accept());
 try{
  await setMode('edit');
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  /* 印は端末の覚え（`SplitDefectShowV1`）。**前の実行の置き土産を疑う**
     （§9.121）ので、始める前に既定へ戻す。 */
  await page.evaluate(()=>localStorage.removeItem('SplitDefectShowV1'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r){r.querySelector('.sc-row-start').click();return true}return false;
  });
  if(!started)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
  await idle(400,15000);

  /* 材料を注ぐ（母材幅・元幅・横割数）。 */
  await page.evaluate(()=>{
   S.measure.basic=S.measure.basic||{};
   S.measure.basic.mfgWidth=300;S.measure.basic.originalWidth=1250;
   const h=document.getElementById('horizontalCount');
   if(h){h.value='4';h.dispatchEvent(new Event('change',{bubbles:true}))}
  });
  await idle(300,5000);

  /* ---- 1) 図をつかんで位置を決める ---- */
  await page.click('#openDefect');
  await page.waitForFunction(()=>!document.querySelector('#defectModal')?.hidden,null,{timeout:8000});
  await paint();
  const st=await page.evaluate(()=>{
   const e=document.querySelector('#defectStrip');const r=e.getBoundingClientRect();
   return {x:r.x,y:r.y,w:r.width,h:r.height,
           lanes:e.querySelectorAll('.defect-lane').length,
           /* **掴めることを形でも言う**（`title`だけでは載せるまで分からない）。 */
           カーソル:getComputedStyle(e).cursor};
  });
  rec('前提: 条が描けている（材料を注いだ）',st.lanes>=2,JSON.stringify({lanes:st.lanes}));
  rec('図は掴める形をしている',st.カーソル==='ew-resize',st.カーソル);
  const before=await page.inputValue('#defectDistance');
  await page.mouse.move(st.x+st.w*0.30,st.y+st.h/2);
  await page.mouse.down();
  await page.mouse.move(st.x+st.w*0.62,st.y+st.h/2,{steps:8});
  await page.mouse.up();
  await paint();
  const dragged=await page.evaluate(()=>({
   距離:document.querySelector('#defectDistance').value,
   答え:(document.querySelector('#defectResult')||{}).textContent||'',
   印:document.querySelectorAll('#defectStrip .defect-lane.is-hit').length}));
  rec('図をつかむと距離が動く',
      dragged.距離!==before&&Number(dragged.距離)>0,
      JSON.stringify({前:before,後:dragged.距離}));
  rec('つかんだ位置に応じて判定が付いてくる',
      /条目/.test(dragged.答え)&&dragged.印>=1,JSON.stringify(dragged));
  /* **左右で違う答えになること**——同じ答えしか出ないなら、掴んでも
     何も起きていないのと同じ（座標を読んでいない実装でも通ってしまう）。 */
  await page.mouse.move(st.x+st.w*0.15,st.y+st.h/2);
  await page.mouse.down();await page.mouse.up();
  await paint();
  const left=await page.inputValue('#defectDistance');
  rec('押した場所で距離が変わる（座標を読んでいる）',
      Number(left)<Number(dragged.距離),JSON.stringify({左:left,右:dragged.距離}));

  /* ---- 2) 保存すると条の設計に印が出る ---- */
  await page.mouse.move(st.x+st.w*0.62,st.y+st.h/2);
  await page.mouse.down();await page.mouse.up();
  await paint();
  await page.click('#defectSave');
  await idle(300,5000);
  await page.click('#closeDefect');
  await page.waitForFunction(()=>document.querySelector('#defectModal')?.hidden,null,{timeout:8000}).catch(()=>{});
  await idle(300,5000);
  const marks=await page.evaluate(()=>{
   const chip=document.querySelector('#splitDefectChip');
   const tg=document.querySelector('#splitDefectToggle');
   const flags=[...document.querySelectorAll('.svb-defect')];
   /* **読むのは「見えている文字」**（§9.234 ①）。印は「異常 → ! → 出さない」の
      3段を持ち、狭い条では`異常`が入らないので段を落とす。`textContent`は
      隠している段まで拾うので、それで判定すると段の切り替えが見えない。 */
   const shown=el=>[...el.children].filter(c=>c.offsetParent!==null||c.getClientRects().length)
       .map(c=>c.textContent.trim()).join('')||el.textContent.trim();
   return {印:flags.length,
           /* **色だけで伝えない**（§3）ので、文字が出ていること。 */
           文字:flags.length?shown(flags[0]):'',
           /* **切り落として`異`だけ残さない**（§9.234 ①）。 */
           はみ出し:flags.filter(f=>f.scrollWidth>f.offsetWidth+1).length,
           縁:document.querySelectorAll('.split-visual-block.is-defect').length,
           帯:chip&&!chip.hidden?chip.textContent.replace(/\s+/g,''):'(hidden)',
           入切:tg&&!tg.hidden?tg.textContent.trim():'(hidden)'};
  });
  rec('条の設計に該当条の印が出る',marks.印>=1&&marks.縁>=1,JSON.stringify(marks));
  rec('印は色だけでなく文字でも言う',marks.文字==='異常',marks.文字);
  rec('印は器からはみ出さない（§9.234 ①）',marks.はみ出し===0,JSON.stringify(marks));

  /* ---- 2b) 狭い条では印の段が落ちる（§9.234 ①、利用者の報告
       「異常位置の図の表示のラベルが別の表示と重なる」） ----
     以前は`異常`を`overflow:hidden`で切っていたため、25条のロットでは
     **`異`だけが残って読めなかった**。段は「異常 → ! → 出さない」で、
     どの段でも器からはみ出さないこと。**条数を実際に増やして見る**
     ——4条のままでは広いので、直す前でも通ってしまう。 */
  /* **条数の上限は屑幅から決まる**（§9.210 ⑤ `stripCountLimit()`）。
     元幅1250／製造板幅300では**4条が上限**なので、横割数へ25を入れても
     受け付けられない——先に条幅を細くすること（入れないまま測ると
     「幅285px＝広いまま」で、直す前でも通ってしまう）。 */
  await page.evaluate(()=>{
   S.measure.basic.mfgWidth=28;
   const h=document.getElementById('horizontalCount');
   if(h){h.value='40';h.dispatchEvent(new Event('change',{bubbles:true}))}
  });
  await idle(300,5000);
  const narrow=await page.evaluate(()=>{
   const flags=[...document.querySelectorAll('.svb-defect')];
   const shown=el=>[...el.children].filter(c=>c.offsetParent!==null||c.getClientRects().length)
       .map(c=>c.textContent.trim()).join('');
   const blk=flags.length?flags[0].closest('.split-visual-block'):null;
   return{印:flags.length,幅:blk?Math.round(blk.getBoundingClientRect().width):0,
     文字:flags.length?shown(flags[0]):'',
     はみ出し:flags.filter(f=>f.scrollWidth>f.offsetWidth+1).length,
     /* 該当条の見せ方は**全部そろっていること**（出たり出なかったりを混ぜない）。 */
     段の数:new Set(flags.map(f=>shown(f))).size};
  });
  /* **前提を先に確かめる**——広いままだと段を落とす道を一度も通らず、
     直す前でも通ってしまう。`異常`は実測30px要るので、それより狭くする。 */
  rec('前提: 条が狭くなっている（40条）',narrow.幅>0&&narrow.幅<30,JSON.stringify(narrow));
  rec('狭い条では印の段が落ちる（異常→!→出さない）',
      narrow.印>=1&&narrow.文字!=='異常',JSON.stringify(narrow));
  rec('狭い条でも印は器からはみ出さない（§9.234 ①）',
      narrow.はみ出し===0,JSON.stringify(narrow));
  rec('該当条の見せ方はそろっている（§9.210 ④）',narrow.段の数<=1,JSON.stringify(narrow));
  await page.evaluate(()=>{
   S.measure.basic.mfgWidth=300;
   const h=document.getElementById('horizontalCount');
   if(h){h.value='4';h.dispatchEvent(new Event('change',{bubbles:true}))}
  });
  await idle(300,5000);
  rec('帯に件数と保存の状態が出る',
      /異常/.test(marks.帯)&&/保存済み/.test(marks.帯),marks.帯);

  /* ---- 3) 印はダブルクリックで判定の窓へ（単クリックは条を選ぶ） ---- */
  const one=await page.evaluate(()=>{
   const f=document.querySelector('.svb-defect');
   f.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:
     f.getBoundingClientRect().x+2,clientY:f.getBoundingClientRect().y+2}));
   return !document.querySelector('#defectModal')?.hidden;
  });
  rec('単クリックでは判定の窓を開かない（条を選ぶまま）',one===false,String(one));
  await page.dblclick('.svb-defect');
  await page.waitForFunction(()=>!document.querySelector('#defectModal')?.hidden,null,{timeout:5000}).catch(()=>{});
  await paint();
  const opened=await page.evaluate(()=>!document.querySelector('#defectModal')?.hidden);
  rec('印のダブルクリックで異常位置判定が開く',opened===true,String(opened));
  await page.click('#closeDefect');
  await page.waitForFunction(()=>document.querySelector('#defectModal')?.hidden,null,{timeout:8000}).catch(()=>{});
  await paint();

  /* ---- 4) 出す/出さない（切でも「判定はある」ことは言う） ---- */
  await page.click('#splitDefectToggle');
  await idle(300,5000);
  const off=await page.evaluate(()=>({
   印:document.querySelectorAll('.svb-defect').length,
   帯:(document.querySelector('#splitDefectChip')||{}).hidden===false,
   入切:(document.querySelector('#splitDefectToggle')||{}).textContent||''}));
  rec('切にすると条の印は消える',off.印===0,JSON.stringify(off));
  rec('切でも「判定はある」ことは帯が言う',off.帯===true&&/出さない/.test(off.入切),
      JSON.stringify(off));
  await page.click('#splitDefectToggle');
  await idle(300,5000);
  const back=await page.evaluate(()=>document.querySelectorAll('.svb-defect').length);
  rec('入に戻すと印が戻る',back>=1,String(back));

  /* ---- ピッチだけでも保存できる（§9.319-B、利用者の指示） ----
     「異常位置判定のピッチだけの場合も保存できるようにしてください。」
     **幅方向を空にしてから見る**——距離が入ったままだと①だけで保存でき、
     ②を見ない実装でも通る（材料は自分で作る・§9.291 ①）。 */
  await page.evaluate(()=>{
   if(document.querySelector('#defectModal')?.hidden)WL.defect.open();
   const d=document.getElementById('defectDistance');
   if(d){d.value='';d.dispatchEvent(new Event('input',{bubbles:true}))}
   const s=S.measure&&S.measure.settings;
   if(s){delete s.defectLocation;delete s.defectRoll}
   const pitch=document.getElementById('defectPitch');
   if(pitch){pitch.value='';pitch.dispatchEvent(new Event('input',{bubbles:true}))}
   WL.defect.refresh();
  });
  await paint();
  const none=await page.evaluate(()=>({
   押せる:!document.getElementById('defectSave').disabled,
   帯:(document.getElementById('defectSaveState')||{}).textContent||'',
  }));
  rec('距離もピッチも無ければ、今までどおり押せない',
      none.押せる===false&&/未保存/.test(none.帯),JSON.stringify(none));

  await page.evaluate(()=>{
   WL.defect.setTab('roll');
   const el=document.getElementById('defectPitch');
   el.value='785.4';el.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await idle(400,5000);
  const only=await page.evaluate(()=>({
   押せる:!document.getElementById('defectSave').disabled,
   説明:document.getElementById('defectSave').getAttribute('title')||'',
   帯:(document.getElementById('defectSaveState')||{}).textContent||'',
  }));
  rec('ピッチだけでも保存を押せる',only.押せる===true,JSON.stringify(only));
  rec('幅方向は保存しないことを説明に書く（§4）',
      /幅方向は判定できていない/.test(only.説明),only.説明.slice(0,70));
  rec('帳票に出せることを帯が言う（「出ません」と嘘をつかない）',
      /長手方向（ピッチ）は記録済み/.test(only.帯)&&!/帳票に出ません/.test(only.帯),only.帯);

  await page.click('#defectSave');
  await idle(300,5000);
  const saved=await page.evaluate(()=>{
   const s=(S.measure&&S.measure.settings)||{};
   return {ピッチ:(s.defectRoll||{}).pitch,
           幅方向の保存:!!(s.defectLocation&&s.defectLocation.saved),
           紙に出る:!!(WL.defect.hasRoll&&WL.defect.hasRoll(S.measure))};
  });
  rec('押すとピッチが記録に入る',Number(saved.ピッチ)===785.4,JSON.stringify(saved));
  rec('ピッチだけのときは幅方向の判定を作らない（空の判定を残さない）',
      saved.幅方向の保存===false,JSON.stringify(saved));
  rec('記録したピッチは帳票の対象になる',saved.紙に出る===true,JSON.stringify(saved));

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  /* **後始末**（§9.121）。保存した判定と端末の覚えを残さない。 */
  try{
   await page.evaluate(()=>{
    localStorage.removeItem('SplitDefectShowV1');
    if(S&&S.measure&&S.measure.settings)delete S.measure.settings.defectLocation;
   });
  }catch(e){}
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
