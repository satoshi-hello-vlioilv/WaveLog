/* test_recvalues.js: ③「記録した値」はマスタが決める（§9.242 ④）
   ============================================================
   利用者の指示:
     「メイン測定画面の3枚目の『記録した値』のカードについては汎用設計に
      したいです。操業データ項目で配置した内容の中から選んで表示できるように
      マスタ化してください」

   ここで固定すること:
    - **中身は操業データ項目マスタの行**（群・並び・呼び名・単位もその行のもの）
    - **画面に入っている値をそのまま出す**（`settings`は保存のときしか
      書かれないので、そこだけを見ると選んだ直後は「—」のまま・§9.206）
    - **マスタで外すとカードからも消える**（`[記録表示]`）
    - **群ごとに件数を文字で出す**（値が「—」ばかりの群を読む前に見分ける）

   **項目名の写しを画面へ戻さないこと**——`RECORD_GROUPS`という4群ぶんの
   ベタ書きが元の姿で、現場では群も並びも変えられなかった。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
/* 外した項目は**必ず戻す**（操業データ項目マスタは`db/master.sqlite3`に
   残り、実行をまたいで生き延びる・§9.121）。 */
const TARGET_ITEM='スプール';
const setMode=m=>fetch(API+'/api/access-mode',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})});

let b=null,page=null,turnedOff=false;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 page=await b.newPage({viewport:{width:1920,height:1080}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 page.on('dialog',d=>d.accept());

 const card=()=>page.evaluate(()=>{
  const groups=[...document.querySelectorAll('#recordedList .rv-group')].map(g=>({
   名:(g.querySelector('b')?.firstChild?.textContent||'').trim(),
   件数:(g.querySelector('b>small')?.textContent||'').trim(),
   項目:[...g.querySelectorAll('dt')].map(t=>t.textContent.trim())}));
  const pair={};
  [...document.querySelectorAll('#recordedList dt')].forEach(t=>{
   const dd=t.parentElement&&t.parentElement.querySelector('dd');
   pair[t.textContent.trim()]=dd?dd.textContent.trim():'';
  });
  return{群:groups,値:pair,
    自動:[...document.querySelectorAll('#recordedList dd.rv-auto')].length};
 });
 /* マスタの盤で1項目の「③に出す」を切り替える。**UIを通す**——保存の本体は
    全列書き（§9.212 ②）なので、部分的なPOSTで済ませるとフィクスチャの
    他の設定まで既定へ落ちる。 */
 const toggleRecordShow=async name=>{
  await page.evaluate(()=>{const m=document.querySelector('#measureModal');if(m)m.hidden=true});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintNav [data-master="opItem"]',{timeout:20000});
  await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'tests');
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('.op-board',{timeout:20000});
  await page.waitForTimeout(700);
  const opened=await page.evaluate(n=>{
   const t=[...document.querySelectorAll('.op-tile')].find(e=>e.textContent.indexOf(n)>=0);
   if(!t)return false;t.click();return true;
  },name);
  if(!opened)throw Error('盤に項目が無い: '+name);
  await page.waitForFunction(()=>{
   const m=document.getElementById('opItemModal');return !!m&&!m.hidden;
  },null,{timeout:10000});
  await page.waitForTimeout(300);
  const was=await page.evaluate(()=>{
   const t=document.getElementById('opdRecordShow');
   if(!t)return null;
   const on=t.getAttribute('aria-pressed')==='true';
   t.click();return on;
  });
  if(was===null)throw Error('「③に出す」の入切が無い');
  await page.waitForTimeout(200);
  await page.click('#opdSave');
  await page.waitForFunction(()=>{
   const m=document.getElementById('opItemModal');return !m||m.hidden;
  },null,{timeout:15000});
  await page.waitForTimeout(600);
  return was;
 };
 const openMeasure=async()=>{
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  const ok=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'))
     ||[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-resume'));
   const btn=r&&(r.querySelector('.sc-row-start')||r.querySelector('.sc-row-resume'));
   if(btn){btn.click();return true}return false;
  });
  if(!ok)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
  await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000}).catch(()=>{});
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
  /* **マスタが届くのを待つ**（§9.234 ⑧）。固定待ちだと「まだ届いていない
     画面」を測って通る。 */
  await page.waitForFunction(()=>!!(window.WL&&WL.opData&&WL.opData.defs&&WL.opData.defs().length),
    null,{timeout:20000});
  await page.evaluate(()=>WL.measureSteps.go('3'));
  await page.waitForTimeout(700);
 };

 try{
  await setMode('edit');
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await openMeasure();

  const c1=await card();
  rec('③に「記録した値」が出る',c1.群.length>0,JSON.stringify(c1.群.map(g=>g.名)));
  /* **群の名前はマスタのもの**（`操業データ項目マスタ`の`[群]`）。以前は
     画面に4群ぶんベタ書きしていたので、現場では変えられなかった。 */
  rec('群の名前は操業データ項目マスタの群',
      c1.群.some(g=>g.名==='誰が測るか')&&c1.群.some(g=>g.名==='使う機材'),
      JSON.stringify(c1.群.map(g=>g.名)));
  rec('群ごとに件数を文字で出す（色だけで伝えない）',
      c1.群.every(g=>/^\d+\/\d+$/.test(g.件数)),
      JSON.stringify(c1.群.map(g=>g.名+':'+g.件数)));
  /* 母材の欄も同じカードに乗る（§9.232で操業データの項目になった）。 */
  rec('母材の欄も同じ仕組みで並ぶ',
      Object.prototype.hasOwnProperty.call(c1.値,'全長'),
      JSON.stringify(Object.keys(c1.値).slice(0,20)));
  rec('自動で入る値は見分けが付く',c1.自動>0,String(c1.自動));
  rec('前提: 外す対象の項目がカードに居る',
      Object.prototype.hasOwnProperty.call(c1.値,TARGET_ITEM),
      JSON.stringify(Object.keys(c1.値).slice(0,20)));

  /* **画面に入っている値がそのまま出る**（§9.206）。 */
  const live=await page.evaluate(async()=>{
   WL.measureSteps.go('1');
   const op=document.getElementById('operator');
   const val=[...op.options].map(o=>o.value).find(v=>v&&v!=='-')||'';
   op.value=val;op.dispatchEvent(new Event('change',{bubbles:true}));
   WL.measureSteps.go('3');
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const dt=[...document.querySelectorAll('#recordedList dt')]
     .find(t=>t.textContent.trim()==='オペレータ');
   const dd=dt&&dt.parentElement?dt.parentElement.querySelector('dd'):null;
   return{選んだ:val,出た:dd?dd.textContent.trim():''};
  });
  rec('①で選んだ値がそのまま出る（保存を待たない）',
      !!live.選んだ&&live.出た===live.選んだ,JSON.stringify(live));

  /* ---- マスタで外すとカードからも消える ---- */
  const wasOn=await toggleRecordShow(TARGET_ITEM);
  turnedOff=true;
  rec('前提: 外す前は「③に出す」が入っていた',wasOn===true,String(wasOn));
  await openMeasure();
  const c2=await card();
  rec('マスタで外すとカードから消える',
      !Object.prototype.hasOwnProperty.call(c2.値,TARGET_ITEM),
      JSON.stringify(Object.keys(c2.値).slice(0,20)));
  /* **他の項目は巻き添えにしない**（全列書きの罠・§9.212 ②）。 */
  rec('外した項目以外はそのまま残る',
      Object.prototype.hasOwnProperty.call(c2.値,'オペレータ')
      &&Object.prototype.hasOwnProperty.call(c2.値,'内径'),
      JSON.stringify(Object.keys(c2.値).slice(0,20)));
  /* **測定画面の入力欄は消えない**（③に出すかどうかと、測定画面に出すかは別）。 */
  const stillThere=await page.evaluate(()=>!!document.getElementById('spool'));
  rec('③から外しても測定画面の入力欄は残る',stillThere===true,String(stillThere));

  const wasOff=await toggleRecordShow(TARGET_ITEM);
  turnedOff=false;
  rec('戻せる（入切が往復する）',wasOff===false,String(wasOff));
  await openMeasure();
  const c3=await card();
  rec('戻すとカードにも戻る',
      Object.prototype.hasOwnProperty.call(c3.値,TARGET_ITEM),
      JSON.stringify(Object.keys(c3.値).slice(0,20)));

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));

  console.log('\n=== SUMMARY ===');
  const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
  ng.forEach(x=>console.log(' -',x.n,x.d||''));
  await cleanup();
  process.exit(ng.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  await cleanup();
  process.exit(2);
 }
 /* 後片付け（§9.121）。**落ちた側でも通す**——外したままにすると、次の実行が
    「③に出さない」状態を引き継ぐ（マスタは実行をまたいで生き延びる）。 */
 async function cleanup(){
  if(turnedOff){
   try{await toggleRecordShow(TARGET_ITEM)}catch(e){console.error('戻せませんでした',e.message)}
  }
  try{await page.evaluate(async()=>{
   const id=(typeof S!=='undefined'&&S.measure)?S.measure.id:'';
   if(id&&typeof reliableDelete==='function')await reliableDelete(id).catch(()=>{});
   if(id){
    for(let k=0;k<6;k++){
     const r=await fetch('/api/measurement/backup/list').then(x=>x.json()).catch(()=>({items:[]}));
     const ids=(r.items||[]).map(i=>i.id).filter(x=>x===id||String(x).endsWith(id));
     if(!ids.length)break;
     await fetch('/api/measurement/backup/delete',{method:'POST',
       headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})}).catch(()=>{});
     await new Promise(r2=>setTimeout(r2,250));
    }
   }
   const m=document.querySelector('#measureModal');if(m)m.hidden=true;
  })}catch(e){}
  try{await setMode('edit')}catch(e){}
  if(b)await b.close().catch(()=>{});
 }
})().catch(async e=>{console.error('FATAL',e);if(b)await b.close().catch(()=>{});process.exit(2)});
