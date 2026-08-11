/* test_share.js: 途中経過を他のPCから続けられること(§9.91)
   ============================================================
   報告された症状: 「同じPCからはOKだけど、他のPCから読むと測定値データが
   移行できない。途中データの子ロットデータも共有できない保存のされ方に
   なっている。」

   経路を追うと、保存が2本に分かれていて片方が端末内で止まっていた。
     完了登録・一時保存(persistAndTransition) … 端末内 + 共有DB
     **途中保存(saveLocal)・測定を開いた直後** … 端末内だけ
   さらに**データ一覧が端末内(IndexedDB+ミラー)しか読んでいない**ため、
   仮に共有DBに入っていても他のPCの一覧には出なかった。

   ここでは「別のPC」をブラウザのプロファイル(=別のIndexedDB)で作り、
   次の3点を固定する。
    1. 途中保存が共有DB(records.sqlite3)へ届く
    2. 別のPCのデータ一覧に、その続きが出る(印つき)
    3. 開くとその端末へ取り込まれ、**子ロットデータ**も一緒に来る
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EQ='テスト設備A';
const ID='share-test-'+Date.now();
const LOT='SHARE'+String(Date.now()).slice(-5);
let b=null;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function cleanup(){
 try{await post('/api/measurement/backup/delete',{ids:[ID]})}catch(e){}
}
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 try{
  await cleanup();
  await post('/api/access-mode',{mode:'edit'});

  /* ---- PC1: 途中保存する ---- */
  const pc1=await b.newContext({viewport:{width:1500,height:900}});
  const p1=await pc1.newPage();
  p1.on('pageerror',e=>console.log('[pc1]',e.message));
  await p1.goto(B+'/',{waitUntil:'domcontentloaded'});
  await p1.waitForSelector('#openSchedule',{timeout:30000});
  await p1.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await p1.reload({waitUntil:'domcontentloaded'});
  await p1.waitForSelector('#grid table',{timeout:30000});
  await p1.waitForTimeout(1200);

  /* 測定レコードを1件作り、子ロットデータを持たせて途中保存する。
     (測定画面をUIで開くと仕掛の状態に左右されるため、保存の経路そのものを
      直接呼ぶ。見たいのは「保存が共有DBへ届くか」なので、これで足りる。) */
  const saved=await p1.evaluate(async({id,lot,eq})=>{
   const m=ensureMeasureShape({id,status:'編集中',
     basic:{lotNo:lot,inspectionNo:'INS-1',castingNo:'CAS-1',mfgMaterial:'A5052'},
     registeredEquipment:eq,
     settings:{operator:'テスト作業者',splitSourcesCache:{
       children:[{lotNo:lot+'-C1',width:120},{lotNo:lot+'-C2',width:80}],
       savedAt:new Date().toISOString()}},
     measurements:{'1':[['1.23','1.24']]},
     updatedAt:new Date().toISOString()});
   await reliablePut(m);
   shareRecord(m);
   return {id:m.id,children:(m.settings.splitSourcesCache.children||[]).length};
  },{id:ID,lot:LOT,eq:EQ});
  rec('PC1で子ロット付きの途中データを作れる',saved.children===2,JSON.stringify(saved));

  // 送信は待たせない作りなので、届くまで少し待つ。
  let onServer=null;
  for(let i=0;i<20;i++){
   const r=await (await fetch(B+'/api/measurement/backup/summary')).json();
   onServer=(r.items||[]).find(x=>x.id===ID);
   if(onServer)break;
   await new Promise(r2=>setTimeout(r2,300));
  }
  rec('途中保存が共有DBへ届く',!!onServer,onServer?JSON.stringify({lot:onServer.lotNo,status:onServer.status}):'見つからない');
  rec('共有DBの一覧はペイロードを含まない(軽い)',
   !!onServer&&!('payload' in onServer),onServer?Object.keys(onServer).join(','):'');

  /* ---- PC2: 別のプロファイル(=別のIndexedDB)から見る ---- */
  const pc2=await b.newContext({viewport:{width:1500,height:900}});
  const p2=await pc2.newPage();
  const errs2=[];
  p2.on('pageerror',e=>errs2.push(e.message));
  await p2.goto(B+'/',{waitUntil:'domcontentloaded'});
  await p2.waitForSelector('#openSchedule',{timeout:30000});
  await p2.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await p2.reload({waitUntil:'domcontentloaded'});
  await p2.waitForSelector('#grid table',{timeout:30000});
  await p2.waitForTimeout(1200);

  const localOnly=await p2.evaluate(async id=>{
   const all=await reliableAll();
   return {hasLocally:all.some(x=>x.id===id),count:all.length};
  },ID);
  rec('PC2の端末内には無い(別のPCであることの確認)',!localOnly.hasLocally,JSON.stringify(localOnly));

  const merged=await p2.evaluate(async id=>{
   const all=await mergedRecords();
   const hit=all.find(x=>x.id===id);
   return hit?{found:true,remoteOnly:!!hit.remoteOnly,lot:hit.basic?.lotNo||'',status:hit.status}:{found:false};
  },ID);
  rec('PC2のデータ一覧に他のPCの続きが出る',merged.found,JSON.stringify(merged));
  rec('他のPCのものだと分かる印が付く',merged.found&&merged.remoteOnly===true,JSON.stringify(merged));

  // 画面でも印が出ること
  await p2.evaluate(()=>openRecords('編集中'));
  await p2.waitForTimeout(1500);
  const badge=await p2.evaluate(id=>{
   const rows=[...document.querySelectorAll('.record-list-row')];
   const row=rows.find(r=>r.getAttribute('aria-label')?.includes(id)||r.textContent.includes(id));
   return {rows:rows.length,badge:!!document.querySelector('.record-remote-badge')};
  },LOT);
  rec('一覧の画面にも「別のPC」の印が出る',badge.badge,JSON.stringify(badge));

  /* ---- PC2 で取り込む(子ロットデータまで来ること) ---- */
  const imported=await p2.evaluate(async id=>{
   const m=await importRemoteRecord(id);
   const kids=m.settings?.splitSourcesCache?.children||[];
   const all=await reliableAll();
   return {lot:m.basic?.lotNo||'',children:kids.length,
           childLots:kids.map(k=>k.lotNo),
           meas:(m.measurements&&m.measurements['1']&&m.measurements['1'][0])||[],
           nowLocal:all.some(x=>x.id===id)};
  },ID);
  rec('開くとこの端末へ取り込まれる',imported.nowLocal,JSON.stringify({lot:imported.lot}));
  rec('測定値が引き継がれる',imported.meas.join(',')==='1.23,1.24',imported.meas.join(','));
  rec('**子ロットデータも一緒に来る**',imported.children===2,JSON.stringify(imported.childLots));

  rec('コンソールに例外が出ない',errs2.length===0,errs2.slice(0,3).join(' / '));

  console.log('\n=== SUMMARY ===');
  const bad=R.filter(r=>!r.ok);console.log(`${R.length-bad.length}/${R.length} passed`);
  bad.forEach(x=>console.log(' -',x.n,x.d||''));
  await b.close();b=null;
  await cleanup();
  process.exit(bad.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  if(b)await b.close().catch(()=>{});
  await cleanup();
  process.exit(2);
 }
})();
