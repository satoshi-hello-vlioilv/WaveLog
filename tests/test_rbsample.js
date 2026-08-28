/* test_rbsample.js: 見本のロットで帳票を見る・試し印刷（§9.253、利用者の指示）
   ============================================================
   「このマスタのままで、それぞれ『紙全体を見る』ボタンがそうなのでしょうが、
    ロットのダミーデータを入れて帳票の表示（プレビュー）を見たいという意味
    だったのですが正しく実装されていません。今の状態だと、登録済みのデータ
    から、帳票の表示を行うパターンで実データでの確認が必要です。クリックの
    ステップ数が多いのと、実データがないと確認できない点が問題です。
    全入力可能データのダミーデータを1データ、内部に持っておくこととその
    データを活用し帳票のプレビューを帳票ブロックマスタから確認用に実際の
    データを配置した形かつ、現在のレイアウトでのデータを見られる、試し印刷も
    できるようにしてください」

   ここで固定すること:
    1. 帳票ブロックマスタから**1押しで**帳票のプレビューが開く
       （それまでは「データ一覧→ロットを探す→行を開く→帳票」の4段）
    2. **実データが1件も無くても開ける**（見本はサーバーが作る）
    3. **既定の塊が全部埋まっている**——`-`だらけだと、紙に入るかどうかを
       見誤る（§9.130「入れ物の大きさは中身の長さから決める」）
    4. 見本であることを**文字で**言い、**紙の外**へ置く（刷り上がりに混ぜない）
    5. 戻り先を名乗り、押すと帳票ブロックマスタへ帰る
    6. 試し印刷が**帳票だけの書類**を組み立て、見本の値が載る
    7. **保存されない**——見本を開いても測定データは1件も増えない

   **素通りに注意**: 「ボタンが在る」「画面が開く」だけを見る網は、
   中身が空の紙でも通る。**値が実際に載っていること**と、**件数が増えて
   いないこと**まで見る。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
let b=null;
const getj=async p=>(await fetch(B+p)).json();
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

(async()=>{
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 try{
  await post('/api/access-mode',{mode:'edit'});

  /* ---- 0) サーバーが見本のロットを1件作れる ---- */
  const s=await getj('/api/report-block-master/sample-record?equipment='+encodeURIComponent(EQ));
  const r0=s.record||{};
  rec('サーバーが見本のロットを返す',!!s.ok&&!!r0.basic,JSON.stringify(Object.keys(r0)));
  rec('見本の番号はひと目で見本と分かる（実データと取り違えない）',
      s.id==='__sample__'&&r0.id==='__sample__',String(s.id));
  rec('設備を渡すとその設備の記録になる（配置は report:<設備>）',
      (r0.settings||{}).registeredEquipment===EQ,(r0.settings||{}).registeredEquipment);
  /* **全部の欄が埋まっている**のが値打ち（§9.253 ③）。空の欄が残ると、
     その塊だけ紙の上で実物より痩せて見える。 */
  const need=['basic.lotNo','basic.allocationNo','basic.purposeCode','basic.designCourse',
              'basic.mfgMaterial','basic.mfgThickness','basic.orderLength'];
  const at=(o,p)=>p.split('.').reduce((v,k)=>(v==null?v:v[k]),o);
  const empty=need.filter(p=>String(at(r0,p)??'').trim()==='');
  rec('既定の塊が読む道が全部埋まっている',!empty.length,JSON.stringify(empty));
  rec('品質等級と公差の材料も持つ（合否・範囲が紙で確かめられる）',
      !!(r0.qualityGrades&&r0.qualityGrades['切断面'])&&!!(r0.source&&r0.source['板厚公差_製造_プラス']),
      JSON.stringify({等級:(r0.qualityGrades||{})['切断面'],公差:Object.keys(r0.source||{}).length}));
  rec('測定値と子ロットを持つ（統計・条ごとの表が出る）',
      Array.isArray((r0.measurements||{}).width)&&((r0.settings||{}).splitGroups||[]).length>=2,
      JSON.stringify({丈:(r0.measurements||{}).width?.length,子:(r0.settings||{}).splitGroups?.length}));

  /* ---- 0b) 器の上限まで埋まっている（§9.254 ④、利用者の指示） ----
     「最大データ数40条分埋まっているなど、埋まっていないデータがないように
      すべてのデータ項目で表示したいです。条の異常位置判定がある場合なども
      異常データがあるものとして、異常情報もあるものとして設定をお願いします。
      ダミーデータのロット№の桁数は7桁にしてください」
     **件数だけを見ないこと**——40列の器を作っても中身が空なら意味が無いので、
     実際に値が入っているセルを数える。 */
  const LOT=String(r0.basic?.lotNo||'');
  rec('ロット№は7桁（LotDspのlinkkeyと同じ幅）',LOT.length===7,LOT);
  const st0=r0.settings||{},ms0=r0.measurements||{};
  rec('条は器の上限（40条）まで埋まっている',
      Number(st0.horizontalCount)===40
      &&(ms0.width||[]).every(row=>row.length>=40)
      &&(ms0.width||[])[0].filter(v=>String(v||'').trim()!=='').length===40,
      JSON.stringify({横割数:st0.horizontalCount,列:(ms0.width||[])[0]?.length,
                      埋:(ms0.width||[])[0]?.filter(v=>String(v||'').trim()!=='').length}));
  rec('丈も選べる上限まで埋まっている（頭9＋尾1）',
      Number(st0.verticalCount)===9&&(ms0.width||[]).length===10
      &&(ms0.width||[]).every(row=>row.filter(v=>String(v||'').trim()!=='').length===40),
      JSON.stringify({縦割数:st0.verticalCount,丈:(ms0.width||[]).length}));
  const blankCells=['thickness','width','lateral','burr','telescope','offset','flatness','comments']
    .filter(k=>{const rows=ms0[k]||[];
      if(!rows.length)return true;
      return rows.some(row=>row.some(v=>String(v||'').trim()===''))&&k!=='comments';});
  rec('測定値に空のマスが残らない',!blankCells.length,JSON.stringify(blankCells));
  const prod=(r0.product||{}).rows||[];
  rec('丈別データも全部の丈が埋まっている（長さ・肉厚・揃い・備考）',
      prod.length>=10&&prod.slice(0,10).every(r=>String(r.productLength||'').trim()!==''
        &&String(r.wallThickness||'').trim()!==''&&String(r.edgeShape||'').trim()!==''
        &&String(r.note||'').trim()!==''),
      JSON.stringify({丈:prod.length,先頭:prod[0]}));
  const sv=(st0.defectLocation||{}).saved||null;
  rec('異常位置判定が保存済みで、該当条がある（帳票に載る）',
      !!sv&&Array.isArray(sv.hits)&&sv.hits.length>0&&Array.isArray(sv.lanes)&&sv.lanes.length===40,
      JSON.stringify({該当条:(sv&&sv.hits||[]).map(h=>h.index+1),条:(sv&&sv.lanes||[]).length}));
  rec('長手方向（ロール）の入力も埋まっている',
      !!(st0.defectRoll&&Number(st0.defectRoll.pitch)>0),JSON.stringify(st0.defectRoll||null));
  rec('異常情報も「有る」ほうで持つ',
      String(r0.qualityInfo||'').trim()!==''&&!/異常情報なし/.test(String(r0.qualityInfo||'')),
      String(r0.qualityInfo||''));
  rec('子ロットは異幅で、公差の材料も持つ（子ロットごとの範囲が出る）',
      (st0.splitGroups||[]).length>=2
      &&new Set((st0.splitGroups||[]).map(g=>g.base&&g.base.width)).size>=2
      &&(st0.splitGroups||[]).every(g=>g.tol&&g.tol.width),
      JSON.stringify((st0.splitGroups||[]).map(g=>[g.lot,g.count,g.base&&g.base.width])));
  rec('条→子ロットの対応が条数ぶんある（条の図が組める）',
      (st0.splitPositionGroup||[]).length===40,String((st0.splitPositionGroup||[]).length));
  /* 子ロットの番号も**親と同じ7桁で、下3桁が重ならない**（条の図のバッジは下3桁）。 */
  const kids=(st0.splitGroups||[]).map(g=>String(g.lot||''));
  rec('子ロット番号も7桁で下3桁が重ならない',
      kids.length>=2&&kids.every(v=>v.length===7)
      &&new Set(kids.map(v=>v.slice(-3))).size===kids.length,JSON.stringify(kids));

  /* 見本を開く前の件数。**保存されないこと**を後で突き合わせる。 */
  let before=null;
  try{const sum=await getj('/api/measurement/backup/summary');
      before=(sum.items||sum.rows||[]).length}catch(e){before=null}

  b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'),
                           args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await b.newPage({viewport:{width:1600,height:1000}});
  const errs=[];page.on('pageerror',e=>errs.push(String(e&&e.message||e)));
  /* **リロードしないこと**——タブが0件になった合図でアプリが落ちる（§9.98）。 */
  await page.addInitScript(eq=>{try{localStorage.setItem('AccessMeasurementConfiguredEquipment',eq)}catch(e){}},EQ);
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:20000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:10000});
  await page.fill('#masterUserId','tester');
  await page.evaluate(()=>document.querySelector('#masterUserId').dispatchEvent(new Event('change')));
  await page.waitForSelector('#masterMaintNav [data-master="reportBlock"]',{timeout:20000});
  await page.click('#masterMaintNav [data-master="reportBlock"]');

  /* ---- 1) 帳票ブロックマスタから1押しで開く ---- */
  await page.waitForSelector('#mmSampleView',{timeout:15000});
  const tools=await page.evaluate(()=>({
   見る:!!document.getElementById('mmSampleView'),
   刷る:!!document.getElementById('mmSamplePrint'),
   説明:(document.getElementById('mmSampleView')||{}).title||''}));
  rec('帳票ブロックマスタに「見本で帳票を見る」と「試し印刷」が並ぶ',
      tools.見る&&tools.刷る,JSON.stringify(tools));
  rec('押す前に何が起きるかを名乗る（実データが要らないことも書く）',
      /見本/.test(tools.説明)&&/実データ/.test(tools.説明),tools.説明);

  await page.click('#mmSampleView');
  await page.waitForFunction(()=>document.body.classList.contains('rp-mode'),null,{timeout:20000});
  await page.waitForFunction(()=>{
   const c=document.getElementById('reportContent');
   return c&&c.textContent.length>500;
  },null,{timeout:20000});
  const view=await page.evaluate(()=>{
   const c=document.getElementById('reportContent'),bar=document.getElementById('rpSampleBar');
   return {題:(document.getElementById('reportSelectedTitle')||{}).textContent||'',
           帯:bar?bar.innerText.replace(/\s+/g,' '):null,
           帯は紙の中:bar?!!bar.closest('#reportContent'):null,
           戻る:(document.getElementById('reportBack')||{}).textContent.trim()||'',
           刷れる:!(document.getElementById('reportPrint')||{}).disabled,
           本文:c.textContent.replace(/\s+/g,' ')};
  });
  /* **期待値に綴りを直接書かない**（§9.200）——見本の値が変わるたびに
     テストも直すことになる。サーバーが返した見本そのものと突き合わせる。 */
  rec('1押しで帳票のプレビューが開き、見本のロットが選ばれている',
      view.題.indexOf(LOT)>=0,view.題);
  /* ---- 3) 実際のデータが配置されている ---- */
  const shown=['A-24-0087','TZ-02','S-3','C1020','端子用条','○○電機株式会社'];
  const miss=shown.filter(v=>view.本文.indexOf(v)<0);
  rec('既定の塊に実際の値が載る（`-`のままの欄が残らない）',!miss.length,JSON.stringify(miss));
  rec('測定値の表に公差の範囲が出る（仕掛の生の行が効いている）',
      /0\.295/.test(view.本文)&&/0\.305/.test(view.本文),
      view.本文.slice(view.本文.indexOf('測定データ（板厚'),view.本文.indexOf('測定データ（板厚')+90));
  rec('子ロットごとの統計が出る（分割が効いている）',
      kids.length>=2&&view.本文.indexOf(kids[0])>=0&&view.本文.indexOf(kids[kids.length-1])>=0,
      view.本文.slice(view.本文.indexOf('測定値の統計'),view.本文.indexOf('測定値の統計')+80));
  rec('保存済みの異常位置判定が紙に載る',
      /異常位置判定/.test(view.本文)&&view.本文.indexOf('該当条')>=0,
      view.本文.slice(view.本文.indexOf('異常位置判定'),view.本文.indexOf('異常位置判定')+90));
  /* ---- 4) 見本であることを文字で言い、紙の外に置く ---- */
  rec('見本であることを文字で言う（色だけで伝えない）',
      !!view.帯&&/見本/.test(view.帯)&&/保存されません/.test(view.帯),view.帯);
  rec('どの設備の配置で見ているかを出す',!!view.帯&&view.帯.indexOf(EQ)>=0,view.帯);
  rec('帯は紙の外（刷り上がりに混ざらない）',view.帯は紙の中===false,String(view.帯は紙の中));
  /* ---- 5) 戻り先を名乗る ---- */
  rec('戻るボタンが帳票ブロックへ帰ると名乗る',/帳票ブロック/.test(view.戻る),view.戻る);

  /* ---- 6) 試し印刷は帳票だけの書類を組み立てる ---- */
  const printed=await page.evaluate(()=>new Promise(resolve=>{
   let hooked=false;
   const iv=setInterval(()=>{
    const f=document.getElementById('rpPrintFrame'),w=f&&f.contentWindow;
    if(!w||!w.document||!w.document.body||hooked)return;
    hooked=true;
    w.print=()=>{clearInterval(iv);
     const pgs=[...w.document.querySelectorAll('.rp-page')];
     resolve({枚数:pgs.length,
       中身:w.document.body.innerText.replace(/\s+/g,' ').slice(0,400),
       塊:w.document.querySelectorAll('.rp-block').length});
    };
   },15);
   setTimeout(()=>{clearInterval(iv);resolve(null)},9000);
   document.getElementById('rpSamplePrint').click();
  }));
  rec('試し印刷は帳票だけの書類を組み立てる',!!printed&&printed.枚数===1,JSON.stringify(printed&&{枚数:printed.枚数,塊:printed.塊}));
  rec('刷る書類に見本の値が載っている（白紙ではない）',
      !!printed&&printed.中身.indexOf(LOT)>=0,printed?printed.中身.slice(0,120):'');

  /* ---- 5b) 実際に帳票ブロックマスタへ帰る ---- */
  await page.click('#reportBack');
  await page.waitForFunction(()=>document.body.classList.contains('mm-mode'),null,{timeout:20000});
  const back=await page.evaluate(()=>({
   タブ:(document.querySelector('#masterMaintNav .active')||{}).dataset?.master||'',
   見本の帯:!!document.getElementById('rpSampleBar')}));
  rec('戻ると帳票ブロックのタブが開いている（探し直させない）',
      back.タブ==='reportBlock',JSON.stringify(back));

  /* ---- 7) 保存されない ---- */
  let after=null;
  try{const sum=await getj('/api/measurement/backup/summary');
      after=(sum.items||sum.rows||[]).length}catch(e){after=null}
  rec('見本を開いても測定データは1件も増えない',
      before===null||after===null||before===after,`${before} → ${after}`);
  const inList=await getj('/api/measurement/backup/summary').then(
    d=>JSON.stringify(d).indexOf('__sample__')>=0).catch(()=>false);
  rec('見本のロットが共有の測定データに現れない',inList===false,String(inList));

  rec('画面の例外が出ていない',errs.length===0,errs.join(' / '));
 }catch(e){
  console.log('FATAL '+(e&&e.message||e));R.push({ok:false});
 }finally{
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
