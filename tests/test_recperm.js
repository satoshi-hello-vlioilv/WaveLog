/* test_recperm.js: 「データが無い」と「このモードでは見せられない」を言い分ける(§9.107)
   ============================================================
   報告された症状: 「編集中データ一覧をスケジュールモードで開くとデータが
   あるのに見えない形になります。データはあるけど見えないではなく、権限が
   ないので見えないという正しい事実を理解できるような表示表現にしてほしい。」

   edit以外のモードでは、この一覧が読むのは**共有された閲覧用データ**だけで、
   端末内(IndexedDB)の編集中データは開かない(その端末は測定データを書かない
   前提のため)。ところが0件のとき「表示できるデータがありません」とだけ
   出していたので、**手元にあるのに消えたように見えた**。

   ここで固定するのは表示の事実関係:
    1. 端末内に件数があるなら、その件数を数えて「このモードでは開けない」と書く
    2. 「表示できるデータがありません」で終わらせない
    3. 0件の理由(未設定 / 読めない / 該当なし)を言い分ける
    4. 編集モードへ戻す導線が効き、戻したら案内は消えて手元のデータが出る
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const TAG='recperm-'+Date.now();
const LOT='RECP'+String(Date.now()).slice(-5);
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

run('test_recperm: 「データが無い」と「このモードでは見せられない」を言い分ける(§9.107)', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 try{
  await post('/api/access-mode',{mode:'edit'});

  /* 閲覧用バックアップの中身はテスト側で決める。実物(パス設定マスタの
     records_backup_export_path)はサーバー起動時に1回だけ確定するため、
     ここを差し替えるにはサーバー再起動が要る。見たいのは**画面の表現**
     なので、返す中身だけを差し替える。 */
  let viewPayload={ok:true,configured:false,items:[],count:0,table_exists:false,meas_path:null};
  await page.route('**/api/measurement/backup/list-view',route=>route.fulfill({
   status:200,contentType:'application/json',body:JSON.stringify(viewPayload)}));

  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:30000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#grid table',{timeout:30000});

  /* 端末内に「編集中2件・完了1件」を置く。共有DBへは送らない(送ると
     他のテストの共有データを汚す)ので、reliablePut だけを呼ぶ。 */
  const seeded=await page.evaluate(async({tag,lot,eq})=>{
   const mk=(n,st)=>WL.measureView.ensureMeasureShape({id:`${tag}-${n}`,status:st,
     basic:{lotNo:`${lot}-${n}`,inspectionNo:'INS-'+n},
     registeredEquipment:eq,updatedAt:new Date().toISOString()});
   for(const m of [mk(1,'編集中'),mk(2,'編集中'),mk(3,'完了')])await WL.records.reliablePut(m);
   return (await WL.records.reliableAll()).filter(x=>String(x.id||'').startsWith(tag)).length;
  },{tag:TAG,lot:LOT,eq:EQ});
  rec('端末内に3件(編集中2・完了1)を用意できた',seeded===3,'seeded='+seeded);

  /* スケジュールモードへ。モードはサーバーが持つので、切り替えたら
     画面側にも取り直させる(リロードせずに済む)。 */
  await post('/api/access-mode',{mode:'schedule'});
  const mode=await page.evaluate(async()=>{await refreshAccessMode();return accessMode.mode});
  rec('スケジュールモードへ切り替えられた',mode==='schedule','mode='+mode);

  const openList=async()=>{
   await page.click('#homeDrafts');
   await page.waitForSelector('#recordList .record-list-head',{timeout:15000});
   await page.waitForFunction(()=>!/閲覧データを読み込んでいます/.test(document.querySelector('#recordList')?.textContent||''),null,{timeout:15000});
  };
  const view=()=>page.evaluate(()=>{
   const notice=document.querySelector('.record-mode-notice');
   const empty=document.querySelector('#recordList .record-empty');
   return {
    notice:notice?notice.innerText.replace(/\s+/g,' '):null,
    empty:empty?empty.innerText.replace(/\s+/g,' '):null,
    hasSwitch:!!document.querySelector('.record-mode-switch'),
    rows:document.querySelectorAll('#recordList .record-list-row').length,
    sub:document.querySelector('#headerContextSource')?.textContent||'',
   };
  });

  /* ===== (A) 閲覧用データの置き場が未設定 ===== */
  await openList();
  let v=await view();
  rec('(A)モードの案内が一覧の中に出る',!!v.notice&&/スケジュールモード/.test(v.notice),String(v.notice).slice(0,120));
  rec('(A)端末内の件数を数えて出す',!!v.notice&&/編集中 2件/.test(v.notice)&&/完了 1件/.test(v.notice),String(v.notice).slice(0,200));
  rec('(A)「データが無いのではない」と言い切る',!!v.notice&&/データが無いのではなく/.test(v.notice),String(v.notice).slice(0,200));
  rec('(A)0件の本文が「表示できるデータがありません」で終わらない',
    !!v.empty&&!/^表示できるデータがありません/.test(v.empty),String(v.empty).slice(0,160));
  rec('(A)理由が「未設定」だと分かる',!!v.empty&&/未設定/.test(v.empty),String(v.empty).slice(0,200));
  rec('(A)編集モードへ戻す導線がある',v.hasSwitch===true,'switch='+v.hasSwitch);
  rec('(A)副題も「共有された閲覧用データ」だと言う',/閲覧用/.test(v.sub),v.sub);

  /* ===== (B) 置き場はあるが該当0件 ===== */
  viewPayload={ok:true,configured:true,items:[],count:0,table_exists:true,meas_path:'/tmp/dummy.sqlite3'};
  await openList();
  v=await view();
  rec('(B)未設定とは違う理由を出す',!!v.empty&&/条件に合うもの/.test(v.empty)&&!/未設定/.test(v.empty),String(v.empty).slice(0,200));
  rec('(B)権限の話であることは変わらず伝える',!!v.empty&&/権限/.test(v.empty),String(v.empty).slice(0,200));

  /* ===== (C) 共有された閲覧用データが1件ある ===== */
  const shared=JSON.stringify({id:TAG+'-remote',status:'編集中',
    basic:{lotNo:LOT+'-REMOTE',inspectionNo:'INS-R'},
    registeredEquipment:EQ,updatedAt:new Date().toISOString()});
  viewPayload={ok:true,configured:true,table_exists:true,count:1,meas_path:'/tmp/dummy.sqlite3',
    items:[{id:TAG+'-remote',status:'編集中',updated_at:new Date().toISOString(),
            lotNo:LOT+'-REMOTE',codec:'json-full-v32',payload:shared}]};
  await openList();
  v=await view();
  rec('(C)共有された分はちゃんと出る',v.rows===1,'rows='+v.rows);
  rec('(C)行が出ていても「ここに出るのは共有分だけ」と添える',
    !!v.notice&&/共有された閲覧用データ/.test(v.notice),String(v.notice).slice(0,120));
  rec('(C)行が出ているときは0件の本文を出さない',v.empty===null,String(v.empty));

  /* ===== (D) 導線を押すと編集モードへ戻り、手元のデータが出る ===== */
  await page.click('.record-mode-switch');
  await page.waitForFunction(()=>window.accessMode&&window.accessMode.mode==='edit',null,{timeout:15000});
  await page.waitForFunction(t=>[...document.querySelectorAll('#recordList .record-list-row')]
    .some(r=>r.textContent.includes(t)),LOT+'-1',{timeout:15000});
  v=await view();
  const editMode=await page.evaluate(()=>accessMode.mode);
  rec('(D)導線を押すと編集モードへ戻る',editMode==='edit','mode='+editMode);
  rec('(D)戻したら案内は消える',v.notice===null,String(v.notice));
  rec('(D)戻したら端末内の編集中データが出る',v.rows>=2,'rows='+v.rows);
  rec('(D)副題も端末内の表示へ戻る',/この端末/.test(v.sub),v.sub);

  /* ===== (E) 編集モードで本当に0件のときは、従来どおりの素直な文言 ===== */
  await page.evaluate(()=>{WL.records.recordListState.query='';WL.records.recordListState.items=[];WL.records.renderRecordListRows()});
  v=await view();
  rec('(E)編集モードの0件は「表示できるデータがありません」のまま',
    !!v.empty&&/表示できるデータがありません/.test(v.empty)&&!/権限/.test(v.empty),String(v.empty).slice(0,120));

 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }finally{
  // 落ちてもブラウザを閉じ、モードを既定へ戻す(tests/README.md)。
  try{await post('/api/access-mode',{mode:'edit'})}catch(e){}
 }
}, {viewport:{width:1500,height:950}});
