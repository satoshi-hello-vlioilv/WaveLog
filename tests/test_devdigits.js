/* test_devdigits.js: 測定器で桁が変わる／公差の桁／全〇／レールと自動保存
                      （§9.320-A/B/C/G）

   ============================================================
   利用者の指示・報告
   ------------------------------------------------------------
   ④「測定機器によって保証できる測定精度が違うため、最終的な測定値は自動
      転送で判断される測定機器の情報で見極めデータの桁数を変更するように
      ……マイクロメータ＝小数点以下3桁、ノギスは小数点2桁、コンベックス
      ルールの場合は小数点1桁までの保証……判定された機器が何か、表示の
      エリアを無理やりつくらず今あるスペースにうまくなじませて」
   ⑤「板厚製造公差の表示が桁数溢れしている」
   ⑥「測定画面の『フラットネス』の全〇ボタンが使えません」
   ⑦「『データ一覧を開く』と『いますぐDBへ保存』は削除しシンプルに。
      DBに保存していることがわかるように右上のバッジをうまく使って」

   **電文の綴りに注意**（実際に踏んだ）: `DT1x0`の**下2桁目**が器で、
   `0`=マイクロメータ／`1`=ノギス／`2`=デプス。`+#L…`がコンベックス。
   `DT101`はマイクロメータなので、板幅へ流すと弾かれて何も入らない。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
const setMode=m=>fetch(API+'/api/access-mode',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})});
run('test_devdigits: 測定器で桁が変わる／公差の桁／全〇／レールと自動保存', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 let lotId='';
 try{
  await setMode('edit');
  /* ---- ⑦ レールのボタンは2つ消えている（測定を開く前に見える） ---- */
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  const rail=await page.evaluate(()=>({
   一覧:!!document.getElementById('openDrafts'),
   DB:!!document.getElementById('backupNow'),
   保存して一覧へ:!!document.getElementById('saveDraft'),
   完了:!!document.getElementById('complete'),
   /* **新しいバッジを足さない**（利用者の指示）——保存状態の器は1つだけ。 */
   バッジ:document.querySelectorAll('.save-state #localState').length}));
  rec('「データ一覧を開く」を消した',rail.一覧===false,JSON.stringify(rail));
  rec('「いますぐDBへ保存」を消した',rail.DB===false,JSON.stringify(rail));
  rec('通常使うボタンは残っている',rail.保存して一覧へ&&rail.完了,JSON.stringify(rail));
  rec('保存状態のバッジは1つだけ（新しく足さない）',rail.バッジ===1,String(rail.バッジ));

  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r){r.querySelector('.sc-row-start').click();return true}return false});
  if(!started)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
  await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000}).catch(()=>{});
  await idle();
  lotId=await page.evaluate(()=>S.measure.id);

  /* ---- ⑤ 公差の桁（板厚は3桁） ---- */
  await page.evaluate(()=>{
   const m=S.measure;m.basic.mfgThickness=1.5;m.source=m.source||{};
   /* 1.5±0.025 は二進で表せないので、生の`range`は`1.4749999999999999`になる。 */
   m.source['板厚公差_製造_プラス']=0.025;m.source['板厚公差_製造_マイナス']=0.025;
   const ty=document.getElementById('measureType');ty.value='板厚';
   ty.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await idle();
  const tol=await page.evaluate(()=>(document.querySelector('#toleranceSummary .tol-pill')||{}).textContent||'');
  rec('板厚の公差は小数3桁で出る（桁が溢れない）',
      /1\.475〜1\.525/.test(tol)&&!/\d\.\d{5,}/.test(tol),JSON.stringify(tol));

  /* ---- ④ 器で桁が変わる ---- */
  const send=async(raw,key)=>{
   await page.evaluate(v=>{const el=document.getElementById('deviceInput');
     el.value=v;WL.measureInput.processDeviceInput(v)},raw);
   await paint();   // 受信の処理は同期（processDeviceInput を直に呼んでいる）
   return page.evaluate(k=>({
     値:S.measure.measurements[k][0][0],
     器:(S.measure.settings.deviceOf||{})[k]||'',
     札:(document.querySelector('.mhead-device')||{}).textContent||''}),key);
  };
  const micro=await send('DT100+1.4567','thickness');
  rec('マイクロメータは小数3桁',micro.値==='1.457'&&micro.器==='micrometer',JSON.stringify(micro));
  rec('判定した器を今ある1行の中に出す（マイクロメータ）',
      /マイクロメータ/.test(micro.札)&&/3桁/.test(micro.札),JSON.stringify(micro.札));

  await page.evaluate(()=>{const ty=document.getElementById('measureType');ty.value='板幅';
    ty.dispatchEvent(new Event('change',{bubbles:true}));S.measure.settings.wStep=0});
  // 起きないことを見る判定（札を出さない）: 項目を替えた描き直しと往復が静まるまで待つ。
  await idle();
  rec('まだ転送を受けていなければ器の札は出さない',
      (await page.evaluate(()=>document.querySelectorAll('.mhead-device').length))===0,'');
  const cal=await send('DT110+1234.56','width');
  rec('ノギスは小数2桁',cal.値==='1234.56'&&cal.器==='caliper',JSON.stringify(cal));
  rec('判定した器を出す（ノギス）',/ノギス/.test(cal.札)&&/2桁/.test(cal.札),JSON.stringify(cal.札));
  await page.evaluate(()=>{S.measure.settings.wStep=0});
  const tape=await send('+#L1234.56','width');
  rec('コンベックスルールは小数1桁',tape.値==='1234.6'&&tape.器==='tape',JSON.stringify(tape));
  rec('判定した器を出す（コンベックスルール）',
      /コンベックス/.test(tape.札)&&/1桁/.test(tape.札),JSON.stringify(tape.札));
  /* **欄を離れても桁が戻らない**（§9.320-C。桁を1箇所で答えているかの物差し）
     ——記録した器を見るので、手入力の丸めが転送の桁を上書きしない。 */
  const settled=await page.evaluate(()=>WL.measureRound.settle('width','1234.56'));
  rec('欄を離れたときも記録した器の桁にそろう',settled==='1234.6',JSON.stringify(settled));

  /* ---- ⑥ フラットネスの全〇 ---- */
  /* **②測定の段へ入ること**——測定表は`.mstep-2`の面にあり、①準備の
     段では`display:none`（§9.123）。段を移らずに`#measureType`だけ
     変えても、器が畳まれたままなので`#flatAllOk`は矩形0のまま押せない。 */
  await page.click('.mstep[data-mstep="2"]');
  await paint();
  await page.evaluate(()=>{
   const m=S.measure;m.settings.horizontalCount=4;
   const h=document.getElementById('horizontalCount');if(h)h.value='4';
   const ty=document.getElementById('measureType');ty.value='フラットネス';
   ty.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForSelector('#flatAllOk',{timeout:10000});
  await page.click('#flatAllOk');
  await paint();
  const flat=await page.evaluate(()=>{
   const j=lengthIndex(),n=Math.max(1,+document.getElementById('horizontalCount').value||1);
   return {行:S.measure.measurements.flatness[j].slice(0,n),
     undefinedが入った:S.measure.measurements.flatness[j].slice(0,n)
       .some(v=>v===undefined||String(v)==='undefined')};
  });
  rec('全〇でその丈の条が全部〇になる',
      flat.行.length>0&&flat.行.every(v=>v==='〇'),JSON.stringify(flat));
  rec('記号を持たないボタンが値を壊さない',flat.undefinedが入った===false,JSON.stringify(flat));

  /* ---- ⑦ 押していないのにDBへ入る／バッジが言う ---- */
  await page.evaluate(()=>{
   const ty=document.getElementById('measureType');ty.value='板幅';
   ty.dispatchEvent(new Event('change',{bubbles:true}));S.measure.settings.wStep=0});
  await paint();
  await page.evaluate(()=>{const el=document.getElementById('deviceInput');
    el.value='DT110+1200.00';WL.measureInput.processDeviceInput('DT110+1200.00')});
  const soon=await page.evaluate(()=>document.getElementById('localState').textContent||'');
  rec('打った直後は「未保存」と言う（嘘をつかない）',/未保存/.test(soon),JSON.stringify(soon));
  await page.waitForFunction(()=>/DBへ保存済み|再送します|保存できませんでした/
    .test(document.getElementById('localState').textContent||''),null,{timeout:20000});
  const done=await page.evaluate(()=>document.getElementById('localState').textContent||'');
  rec('落ち着いたら「DBへ保存済み」とバッジが言う',/DBへ保存済み/.test(done),JSON.stringify(done));
  /* **本当にDBへ入っているか**まで見る（バッジの文字だけを見る網は、
     何も書いていない実装でも通る・§9.289）。 */
  const inDb=await page.evaluate(async id=>{
   const r=await fetch('/api/measurement/backup/summary');const d=await r.json();
   return ((d.items||d.rows||[]).some(x=>String(x.id||x.recordId||'')===id));
  },lotId);
  rec('ボタンを押していないのにDBへ入っている',inDb===true,String(inDb));

  /* ---- ⑦-b 書き込みの往復中に打っても取りこぼさない（§9.320-G 追補） ----
     裏の保存は「落ち着いてから1回」なので、**書き込みの最中に次の1文字が
     来る**のがふつう。ここで見るのは、そのとき打った値が
     **端末内の記録まで届くこと**と、**旗（未保存）が残らないこと**。

     **実測して分かったこと**（推測で書かない）: `WL.measureView.collect()`が返す写しは
     測定値の配列を**実体で共有**しており、さらに`backupAndTrackSync()`が
     `finally`でもう一度`reliablePut(m)`する。だから往復中の1文字は
     取りこぼされない——**この網はその成り立ちを固定する**もので、
     `WL.measureView.collect()`を深い写しへ変えるような直しが入れば落ちる。

     **遅らせるのは端末内への書き込み（`reliablePut`）**——共有DBへの送信を
     遅らせても`autoSaveAgain`が拾うので、窓が開かない（実際に空振りした）。 */
  await page.evaluate(ms=>{
   /* **被せない**（§9.352）——閉じたファイルの関数は外から差し替えられない。
      持ち替えは登録表の `own` で行い、元の道は核（`reliablePutCore`）を呼ぶ。 */
   /* 網の側の数え（製品には触らない）: 書き込みが始まった回数と、いま往復中の数。 */
   window.__rpStarted=0;window.__rpBusy=0;
   WL.measureHooks.own('reliablePut',async m=>{
    window.__rpStarted++;window.__rpBusy++;
    try{
     await new Promise(s=>setTimeout(s,ms));
     return WL.records.reliablePutCore(m);
    }finally{window.__rpBusy--}
   });
   S.measure.settings.wStep=0;
  },1200);
  await page.evaluate(()=>{const el=document.getElementById('deviceInput');
    el.value='DT110+1201.00';WL.measureInput.processDeviceInput('DT110+1201.00')});
  /* 書き込みが始まった（＝`WL.measureView.collect()`は済んだ）ところで、もう1つ打つ。 */
  await page.waitForFunction(()=>/保存しています/
    .test(document.getElementById('localState').textContent||''),null,{timeout:20000});
  /* 端末内への書き込み（1200msに遅らせた）が**実際に始まった**ことを待つ。 */
  await W.until(page,()=>window.__rpStarted>0,null,{ms:10000,what:'遅らせた端末内の書き込みが始まる'});
  await page.evaluate(()=>{const el=document.getElementById('deviceInput');
    el.value='DT110+1202.00';WL.measureInput.processDeviceInput('DT110+1202.00')});
  /* 落ち着くまで待つ。**時間で決め打ちにしない**（§9.102）。 */
  await page.waitForFunction(()=>!WL.base.measureDirty&&/保存済み|再送します/
    .test(document.getElementById('localState').textContent||''),null,{timeout:30000}).catch(()=>{});
  /* finally のもう1回の書き込み（遅らせてある）も終わるまで待つ。 */
  await W.until(page,()=>window.__rpBusy===0,null,{ms:10000,what:'遅らせた端末内の書き込みが全部終わる'});
  await idle();
  const late=await page.evaluate(async()=>{
   WL.measureHooks.own('reliablePut',null);   // 返上（§9.352）
   const saved=await WL.records.reliableGet(S.measure.id).catch(()=>null);
   const row=((saved&&saved.measurements&&saved.measurements.width)||[])[lengthIndex()]||[];
   return {画面:(S.measure.measurements.width[lengthIndex()]||[]).slice(0,3),
     端末内:row.slice(0,3),旗:WL.base.measureDirty,
     バッジ:document.getElementById('localState').textContent||''};
  });
  /* **端末内の記録まで見る**（画面の配列だけを見る網は、どこへも書いて
     いない実装でも通る・§9.289）。 */
  rec('書き込みの往復中に打った値も端末内の記録へ入る',
      late.端末内[1]==='1202.00',JSON.stringify(late));
  rec('書き終えたあとは「未保存」が残らない',late.旗===false,JSON.stringify(late));
  rec('画面のエラーが出ていない',true,'');
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }
 /* 後片付け（§9.121）。この検証で作った記録を端末と共有から消す。

    **名前空間で呼ぶこと**（§9.359）。画面のJSはIIFEで閉じたので、素の
    `deleteBackupRows(...)`は`ReferenceError`になる——それを`catch`が握って
    いたため、**後片付けが何もしないまま緑**で、実績が1件ずつ残っていた
    （§9.360の指紋が`Web測定バックアップ +1`で名指しした）。
    捨てるときは理由を1行残す（§9.328）——黙ると次も同じことが起きる。 */
 try{
  if(lotId){
   const why=await page.evaluate(async id=>{
    const R=WL.records;
    try{await R.deleteBackupRows([id])}catch(e){return '共有から消せない: '+(e&&e.message||e)}
    try{await R.reliableDelete(id)}catch(e){return '端末内から消せない: '+(e&&e.message||e)}
    return '';
   },lotId);
   if(why)console.log('!! 後片付け: '+why);
  }
 }catch(e){console.log('!! 後片付けに届かなかった: '+(e&&e.message||e))}
}, {viewport:{width:1920,height:1080}});
