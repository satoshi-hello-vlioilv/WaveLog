/* test_scframe.js: 空の日付・直の枠（§9.238 ②）
   ------------------------------------------------------------
   利用者の指示:
    「予定を少し飛ばして設定する場合に、何も予定がない領域にセットできる、
     空の日付や直の枠を登録できるようにしたいです。これを作ると、日にちや
     直をいくつか飛ばして、先のスケジュールを先に決めることができるように
     なるので、そういった都合よく使える枠を実装してください。スケジュールが
     押し出してくる際は連動してロットが自然にその設定枠に入るようにします」

   ここで固定すること:
    1. 入口があり、コメントと同じ作法（押す／掴んで落とす）で入れられる
    2. **中身の無い枠は作らない**——日付を聞いてから入れる（§4）
    3. 枠は**自分では時間を使わない**（見積0分）
    4. 枠の**次の予定が、選んだ日・選んだ直の頭から始まる**（これが本体）
    5. 枠の**手前の予定は動かない**
    6. **起点が枠を追い越していたら何もしない**（reached）——これが利用者の
       言う「押し出してくる際は連動してロットが自然にその設定枠に入る」。
       過去日の枠で同じ道を通す。
    7. 直の候補は**勤務形態マスタから引く**（画面に書き写さない・§9.163）
    8. ダブルクリックで日付・直を変えられる／右クリックにも入口がある
    9. 予定から外せる

   **確かめるときは「枠の次の予定」まで見ること**——枠が行として並ぶことだけを
   見る網は、時刻をまったく動かさない実装でも通る。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';

const two=n=>String(n).padStart(2,'0');
const isoDay=d=>`${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())}`;

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 const setMode=m=>page.evaluate(async mm=>{await fetch('/api/access-mode',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mm})})},m);
 const post=(p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-scframe'},a.b))});
  let j={};try{j=await r.json()}catch(e){}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 const plan=()=>page.evaluate(async e=>{
  const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e));
  return (await r.json()).entries||[];
 },EQ);
 const made=[];

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
  await setMode('schedule');
  await post('/api/schedule/session/acquire',{equipment:EQ});

  /* ---- 0) 直の候補は勤務形態マスタから来る ---- */
  const shifts=await page.evaluate(async e=>{
   const r=await fetch('/api/schedule/shift-pattern-master?equipment='+encodeURIComponent(e));
   const j=await r.json();
   const out=[];
   (j.items||[]).forEach(p=>(p.segments||[]).forEach(s=>out.push({name:s.name,start:s.start})));
   return out;
  },EQ);
  rec('直の候補を勤務形態マスタから引ける',shifts.length>0,JSON.stringify(shifts).slice(0,140));
  const shift=shifts[0]||null;

  /* ---- 1) 枠を「既存の予定の手前」へ入れる ----
     **末尾へ入れても何も確かめられない**（後続が無い）ので、必ず手前へ。 */
  const before=await plan();
  const movable=before.filter(e=>e.kind==='作業'&&e.reorderable&&e.parentId==null);
  rec('動かせる予定がフィクスチャにある',movable.length>=2,`${movable.length}件`);
  const anchor=movable[movable.length-1];        // この行の手前へ枠を入れる
  const ahead=movable[0];                        // 枠より前の行（動いてはいけない）
  const aheadStart0=ahead.plannedStart;

  const target=new Date();target.setDate(target.getDate()+9);
  const day=isoDay(target);
  const add=await post('/api/schedule/plan/add',
    {equipment:EQ,kind:'枠',position:`before:${anchor.id}`,
     detail:{frameDate:day,frameShift:shift?shift.name:'',frameNote:'先の予定を先に決める'}});
  const frameId=add.body&&add.body.id;
  if(frameId)made.push(frameId);
  rec('日付・直の枠を予定の手前へ入れられる',add.status===200&&!!frameId,
      `${add.status} ${JSON.stringify(add.body).slice(0,90)}`);

  /* ---- 2) 日付の無い枠は断る（中身の無い行を作らない・§4） ---- */
  const bad=await post('/api/schedule/plan/add',{equipment:EQ,kind:'枠',detail:{frameShift:'1直'}});
  rec('日付の無い枠は断る',bad.status>=400&&/日付/.test(String(bad.body&&bad.body.error||'')),
      `${bad.status} ${String(bad.body&&bad.body.error||'').slice(0,60)}`);

  /* ---- 3) 枠は時間を使わず、次の予定がその日・その直から始まる ---- */
  const after=await plan();
  const fr=after.find(e=>String(e.id)===String(frameId));
  const at=after.findIndex(e=>String(e.id)===String(frameId));
  const next=after.slice(at+1).find(e=>e.parentId==null&&e.plannedStart);
  rec('枠は「枠」という区分で並ぶ',!!fr&&fr.kind==='枠',JSON.stringify(fr&&{kind:fr.kind,state:fr.state}));
  rec('枠の見積は0分（自分では時間を使わない）',
      !!fr&&fr.estimate&&Number(fr.estimate.minutes)===0,JSON.stringify(fr&&fr.estimate));
  rec('枠は「いつから・どれだけ空けたか」を返す',
      !!fr&&!!fr.frame&&fr.frame.date===day&&Number.isFinite(Number(fr.frame.gapMinutes)),
      JSON.stringify(fr&&fr.frame));
  /* **これが本体。** 枠の次の予定が、選んだ日・選んだ直の頭から始まる。 */
  const nextAt=next&&next.plannedStart?new Date(next.plannedStart):null;
  rec('枠の次の予定は、選んだ日から始まる',
      !!nextAt&&isoDay(nextAt)===day,
      JSON.stringify({枠:day,次:next&&next.plannedStart,件:next&&(next.lotNo||next.title)}));
  if(shift&&shift.start){
   const [h,m]=String(shift.start).split(':').map(Number);
   rec('枠の次の予定は、選んだ直の開始時刻から始まる',
       !!nextAt&&nextAt.getHours()===h&&nextAt.getMinutes()===m,
       JSON.stringify({直:shift.name,開始:shift.start,次:next&&next.plannedStart}));
  }else{
   rec('枠の次の予定は、選んだ直の開始時刻から始まる',true,'この設備に勤務区分がありません');
  }
  /* 枠自身は場所だけ取る（次の予定と同じ時刻に居る＝時間を食っていない）。 */
  rec('枠自身は時間を食っていない（次の予定と同じ時刻に居る）',
      !!fr&&!!next&&fr.plannedStart===next.plannedStart,
      JSON.stringify({枠:fr&&fr.plannedStart,次:next&&next.plannedStart}));
  /* ---- 4) 枠の手前の予定は動かない ---- */
  const aheadNow=after.find(e=>String(e.id)===String(ahead.id));
  rec('枠より前の予定は動かない',
      !!aheadNow&&String(aheadNow.plannedStart||'').slice(0,16)===String(aheadStart0||'').slice(0,16),
      JSON.stringify({前:aheadStart0,後:aheadNow&&aheadNow.plannedStart}));

  /* ---- 5) 起点が追い越していたら何もしない（押し出しで自然に埋まる） ---- */
  const past=isoDay(new Date(Date.now()-3*24*3600*1000));
  const up=await post('/api/schedule/plan/update',{id:frameId,frame:{frameDate:past,frameShift:''}});
  rec('枠の日付・直をあとから変えられる',up.status===200,`${up.status}`);
  const after2=await plan();
  const fr2=after2.find(e=>String(e.id)===String(frameId));
  const at2=after2.findIndex(e=>String(e.id)===String(frameId));
  const next2=after2.slice(at2+1).find(e=>e.parentId==null&&e.plannedStart);
  rec('過ぎた日の枠は「ここまで埋まりました」になる',
      !!fr2&&!!fr2.frame&&fr2.frame.reached===true&&Number(fr2.frame.gapMinutes)===0,
      JSON.stringify(fr2&&fr2.frame));
  rec('過ぎた日の枠は後続の時刻を動かさない（自然に埋まった状態）',
      !!next2&&new Date(next2.plannedStart).getTime()<new Date(`${day}T00:00:00`).getTime(),
      JSON.stringify({次:next2&&next2.plannedStart}));

  /* ---- 6) 画面: 入口・行・直し方 ---- */
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await page.waitForFunction(id=>(WL.scheduleView.entries()||[]).some(e=>String(e.id)===String(id)),
    frameId,{timeout:30000});

  const entry=await page.evaluate(()=>{
   const el=document.getElementById('scFrameBtn'),cmt=document.getElementById('scCommentBtn');
   return el?{出ている:!el.hidden,掴める:el.getAttribute('draggable')==='true',
              コメントのとなり:!!cmt&&cmt.nextElementSibling===el,
              文字:el.textContent.replace(/\s+/g,'')}:null;
  });
  rec('枠の入口がコメントのとなりにある',
      !!entry&&entry.出ている&&entry.コメントのとなり,JSON.stringify(entry));
  rec('枠の入口は掴んで落とせる',!!entry&&entry.掴める,JSON.stringify(entry));

  const rowInfo=await page.evaluate(id=>{
   const row=[...document.querySelectorAll('.sc-row-line')].find(r=>String(r.dataset.id)===String(id));
   if(!row)return null;
   const cat=row.querySelector('[data-col="__cat__"]');
   return {区分:cat?cat.textContent.trim():'',
           文字:row.innerText.replace(/\s+/g,' ').slice(0,120),
           直せる印:row.classList.contains('sc-row-frame-edit'),
           title:row.title};
  },frameId);
  rec('行の区分が「枠」と文字で出る',!!rowInfo&&/枠/.test(rowInfo.区分),JSON.stringify(rowInfo));
  rec('行に「いつから」と状態が文字で出る',
      !!rowInfo&&/埋まりました|空き/.test(rowInfo.文字),JSON.stringify(rowInfo&&rowInfo.文字));
  rec('ダブルクリックで直せる印が付く',!!rowInfo&&rowInfo.直せる印,JSON.stringify(rowInfo&&rowInfo.title));

  /* 直す窓が開き、直の候補がマスタから並ぶこと。 */
  await page.evaluate(id=>{
   const row=[...document.querySelectorAll('.sc-row-line')].find(r=>String(r.dataset.id)===String(id));
   row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  },frameId);
  await page.waitForSelector('#scFrameDate',{timeout:12000});
  const dlg=await page.evaluate(()=>({
   日付:document.getElementById('scFrameDate').value,
   直の数:document.querySelectorAll('input[name="scFrameShift"]').length,
   その日の頭:[...document.querySelectorAll('.sc-frame-shift b')].some(b=>/その日の頭/.test(b.textContent)),
   説明:document.querySelector('.sc-frame-edit .confirm-modal-note')?.textContent||''}));
  rec('ダブルクリックで日付・直の窓が開く',!!dlg.日付,JSON.stringify(dlg.日付));
  rec('直の候補がマスタから並ぶ（「その日の頭から」も選べる）',
      dlg.直の数>=1&&dlg.その日の頭,JSON.stringify({数:dlg.直の数,頭:dlg.その日の頭}));
  rec('「時間を使わない」ことを窓に書いてある',/時間を使いません/.test(dlg.説明),dlg.説明.slice(0,60));
  await page.click('#appConfirmCancel');
  await page.waitForTimeout(400);

  /* 右クリックにも入口がある（入口を種別ごとに変えない）。 */
  const menu=await page.evaluate(id=>{
   const row=[...document.querySelectorAll('.sc-row-line')].find(r=>String(r.dataset.id)===String(id));
   row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:400,clientY:300}));
   const items=[...document.querySelectorAll('.sc-row-menu button')].map(b=>b.textContent.trim());
   document.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
   return items;
  },frameId);
  rec('右クリックにも「枠の日付・直を変える」がある',
      menu.some(t=>/枠の日付・直を変える/.test(t)),JSON.stringify(menu).slice(0,180));

  /* ---- 7) 予定から外せる ---- */
  const del=await post('/api/schedule/plan/delete',{id:frameId});
  rec('枠は予定から外せる',del.status===200,`${del.status}`);
  if(del.status===200)made.length=0;
  const gone=(await plan()).every(e=>String(e.id)!==String(frameId));
  rec('外したら一覧から消える',gone);

 }catch(e){
  console.log('FATAL: '+e.message);
  R.push({n:'FATAL',ok:false});
 }finally{
  /* **落ちてもブラウザを閉じる**（tests/README.md）。残ると編集セッションを
     掴んだままになり、後続のスケジュール系が連鎖で落ちる。 */
  try{for(const id of made)await post('/api/schedule/plan/delete',{id})}catch(_){}
  try{await post('/api/schedule/session/release',{equipment:EQ})}catch(_){}
  try{await setMode('edit')}catch(_){}
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok);
 console.log(`\n=== SUMMARY ===\n${R.length-ng.length}/${R.length} passed`);
 ng.forEach(x=>console.log(' -',x.n,x.d||''));
 process.exit(ng.length?1:0);
})();
