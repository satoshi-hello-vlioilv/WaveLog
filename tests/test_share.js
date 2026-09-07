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
   const m=WL.measureView.ensureMeasureShape({id,status:'編集中',
     basic:{lotNo:lot,inspectionNo:'INS-1',castingNo:'CAS-1',mfgMaterial:'A5052'},
     registeredEquipment:eq,
     settings:{operator:'テスト作業者',splitSourcesCache:{
       children:[{lotNo:lot+'-C1',width:120},{lotNo:lot+'-C2',width:80}],
       savedAt:new Date().toISOString()}},
     measurements:{'1':[['1.23','1.24']]},
     updatedAt:new Date().toISOString()});
   await WL.records.reliablePut(m);
   WL.records.shareRecord(m);
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
   const all=await WL.records.reliableAll();
   return {hasLocally:all.some(x=>x.id===id),count:all.length};
  },ID);
  rec('PC2の端末内には無い(別のPCであることの確認)',!localOnly.hasLocally,JSON.stringify(localOnly));

  const merged=await p2.evaluate(async id=>{
   const all=await WL.records.mergedRecords();
   const hit=all.find(x=>x.id===id);
   return hit?{found:true,remoteOnly:!!hit.remoteOnly,lot:hit.basic?.lotNo||'',status:hit.status}:{found:false};
  },ID);
  rec('PC2のデータ一覧に他のPCの続きが出る',merged.found,JSON.stringify(merged));
  rec('他のPCのものだと分かる印が付く',merged.found&&merged.remoteOnly===true,JSON.stringify(merged));

  // 画面でも印が出ること
  await p2.evaluate(()=>WL.records.openRecords('編集中'));
  await p2.waitForTimeout(1500);
  const badge=await p2.evaluate(id=>{
   const rows=[...document.querySelectorAll('.record-list-row')];
   const row=rows.find(r=>r.getAttribute('aria-label')?.includes(id)||r.textContent.includes(id));
   return {rows:rows.length,badge:!!document.querySelector('.record-remote-badge')};
  },LOT);
  rec('一覧の画面にも「別のPC」の印が出る',badge.badge,JSON.stringify(badge));

  /* ---- PC2 で取り込む(子ロットデータまで来ること) ---- */
  const imported=await p2.evaluate(async id=>{
   const m=await WL.records.importRemoteRecord(id);
   const kids=m.settings?.splitSourcesCache?.children||[];
   const all=await WL.records.reliableAll();
   return {lot:m.basic?.lotNo||'',children:kids.length,
           childLots:kids.map(k=>k.lotNo),
           meas:(m.measurements&&m.measurements['1']&&m.measurements['1'][0])||[],
           nowLocal:all.some(x=>x.id===id)};
  },ID);
  rec('開くとこの端末へ取り込まれる',imported.nowLocal,JSON.stringify({lot:imported.lot}));
  rec('測定値が引き継がれる',imported.meas.join(',')==='1.23,1.24',imported.meas.join(','));
  rec('**子ロットデータも一緒に来る**',imported.children===2,JSON.stringify(imported.childLots));

  /* ==================================================================
     「新しい版あり」は同じ物差しで比べる（§9.208 ⑤、実機で報告）
     ------------------------------------------------------------------
     自分の端末で保存しただけのデータに印が付いていた。比べていた2つの
     時刻の物差しが違ったため:
       画面(IndexedDB) `updatedAt`  … UTCのISO  2026-08-19T05:12:33.123Z
       共有   [更新日時]            … 現地時刻  2026-08-19 14:12:33.123456
     文字列で比べると10桁目が' '(0x20)と'T'(0x54)なので、ふつうは常に
     「共有が古い」＝**本物の別PC更新を見落とし**、現地の日付がUTCの日付を
     追い越す時間帯（JSTなら0〜9時）は**常に「共有が新しい」**＝身に覚えの
     ない印、という両方向に壊れた状態だった。
     ================================================================== */
  const ver=await p2.evaluate(()=>{
   const f=WL.recordVersion.remoteIsNewer;
   const mine={updatedAt:'2026-08-19T05:12:33.123Z'};
   return{
    /* 同じ物差し（レコード自身の更新時刻）がそろっていれば、それだけで決める */
    同じ版:f({record_updated_at:'2026-08-19T05:12:33.123Z'},mine),
    本当に新しい:f({record_updated_at:'2026-08-19T05:13:00.000Z'},mine),
    本当に古い:f({record_updated_at:'2026-08-19T05:12:00.000Z'},mine),
    /* 古い行（ISOの列を持たない）は現地時刻を**日付として**読む。
       JSTなら現地は 14:12 で、素直に文字列で比べると日付が追い越す */
    現地時刻の日跨ぎ:f({updated_at:'2026-08-20 01:00:00.000000'},
                       {updatedAt:new Date(2026,7,20,1,0,0).toISOString()}),
    /* 往復のぶん（数百ms）は同じ版として扱う */
    往復のずれ:f({updated_at:(()=>{const d=new Date(2026,7,19,14,12,34);
      const p=n=>String(n).padStart(2,'0');
      return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`})()},
      {updatedAt:new Date(2026,7,19,14,12,33).toISOString()}),
    /* 読めない値は「分からない」＝印を付けない */
    読めない:f({updated_at:'???'},mine),
    片方だけ:f({},mine),
   };
  });
  rec('自分で保存しただけのデータに「新しい版あり」を出さない（§9.208 ⑤）',
      ver.同じ版===false&&ver.現地時刻の日跨ぎ===false&&ver.往復のずれ===false,
      JSON.stringify(ver));
  rec('本当に新しい版は見落とさない',ver.本当に新しい===true&&ver.本当に古い===false,
      JSON.stringify({新:ver.本当に新しい,古:ver.本当に古い}));
  rec('時刻が読めないときは印を付けない',ver.読めない===false&&ver.片方だけ===false,
      JSON.stringify({読めない:ver.読めない,片方だけ:ver.片方だけ}));
  /* レコード自身の更新時刻がサーバーへ渡り、一覧の見出しに戻ってくること
     （これが無いと上の判定は古い行の経路しか通らない）。 */
  const iso=await p2.evaluate(async id=>{
   const r=await fetch('/api/measurement/backup/summary').then(x=>x.json());
   const row=(r.items||[]).find(x=>x.id===id)||{};
   return{ある:'record_updated_at' in row,値:row.record_updated_at||''};
  },ID);
  rec('共有DBがレコード自身の更新時刻を持ち帰る（§9.208 ⑤）',
      iso.ある&&/^\d{4}-\d{2}-\d{2}T/.test(iso.値),JSON.stringify(iso));

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
