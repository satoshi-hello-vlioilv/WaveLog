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
  /* 更新者IDは打ち込む欄ではなくなった（§9.276 ③）。端末の覚え（localStorage）へ入れる。 */
  await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'tester');
  await page.waitForSelector('#masterMaintNav [data-master="reportBlock"]',{timeout:20000});

  /* ---- 0c) 見本が「いまの入力の決まり」に乗っている（§9.321、利用者の指示） ----
     「デモデータを最新のデータのパターンに合わせてアップデートしてください。
      ステップ刻みのあるデータや、小数点の桁数が変わるものを想定しています」

     **決まりは製品のコードに聞く**（`WL.measureRound`／`WL.measureDevice`）
     ——網へ数（0.5・3桁・2桁）を書き写すと、決まりを直したときに網だけが
     古い約束のまま残る（§9.163）。ここが見るのは「見本がその決まりを
     破っていないか」だけ。

     **素通りに注意**: 「値が入っている」を見る網は、刻みから外れた値でも
     通る。**丸めを実際に当てて、値が1つも変わらないこと**で見る——変わる
     なら、その値は現場では絶対に出ない値（＝見本が嘘をつく・§CLAUDE 6）。 */
  const rules=await page.evaluate(()=>({round:!!(window.WL&&WL.measureRound),
                                        device:!!(window.WL&&WL.measureDevice)}));
  rec('入力の決まりを画面に聞ける（WL.measureRound／WL.measureDevice）',
      rules.round&&rules.device,JSON.stringify(rules));
  const fit=await page.evaluate(r=>{
   const ms=r.measurements||{},of=(r.settings||{}).deviceOf||{};
   const out={刻み:[],桁:[],器:[],揃い:[]};
   /* ① 刻み（`MEASURE_ROUND`）。丸めて変わる値＝刻みから外れている。 */
   Object.keys(WL.measureRound.rules()).forEach(k=>{
    const rows=k==='alignValue'
      ?[((r.product||{}).rows||[]).map(x=>x.alignmentValue)]:(ms[k]||[]);
    rows.forEach(row=>(row||[]).forEach(v=>{
     const t=String(v==null?'':v).trim();
     if(t===''||WL.measureRound.apply(k,t)===t)return;
     if(out.刻み.length<6)out.刻み.push(k+':'+t+'→'+WL.measureRound.apply(k,t));
    }));
   });
   /* ② 桁（`MEASURE_DEVICE_DIGITS`）。器を記録し、その器の桁で書いてあるか。 */
   ['thickness','width'].forEach(k=>{
    const dev=of[k]||'';
    if(!dev){out.器.push(k);return}
    const want=WL.measureDevice.digits(k,dev);
    (ms[k]||[]).forEach(row=>(row||[]).forEach(v=>{
     const t=String(v==null?'':v).trim();if(t==='')return;
     const d=t.indexOf('.')<0?0:t.length-t.indexOf('.')-1;
     if(d!==want&&out.桁.length<6)out.桁.push(k+'('+dev+'は'+want+'桁):'+t);
    }));
   });
   return out;
  },(await getj('/api/report-block-master/sample-record?equipment='+encodeURIComponent(EQ))).record||{});
  rec('刻みのある欄（ラテラルボー・テレスコープ・巻ずれ・揃いの値）が刻みに乗っている',
      !fit.刻み.length,JSON.stringify(fit.刻み));
  rec('板厚・板幅は測定器を記録している（器で桁が決まることを見本で確かめられる）',
      !fit.器.length,JSON.stringify(fit.器));
  rec('測定値の桁が、記録した測定器の保証する桁とそろっている',
      !fit.桁.length,JSON.stringify(fit.桁));
  /* **器は準備の「板厚測定器／板幅測定器」と食い違わない**——ここだけ別の器に
     すると「ノギスで測ったのに3桁」という嘘を見本が言う。 */
  const gauge=await page.evaluate(r=>{
   const st=r.settings||{},of=st.deviceOf||{};
   const same=(name,dev)=>String(name||'').indexOf(WL.measureDevice.label(dev))===0;
   return {板厚:same(st.thicknessGauge,of.thickness),板幅:same(st.widthGauge,of.width),
           値:[st.thicknessGauge,of.thickness,st.widthGauge,of.width]};
  },(await getj('/api/report-block-master/sample-record?equipment='+encodeURIComponent(EQ))).record||{});
  rec('記録した器が、準備で選んだ測定器と食い違わない',
      gauge.板厚&&gauge.板幅,JSON.stringify(gauge.値));

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
  /* ==========================================================
     §9.309 「データなり」にすると注記も言い直す（§3）
     ----------------------------------------------------------
     利用者の指示「データが最大に入ったときの行や列の表示になるような設定」。
     **行数そのものは見本では確かめられない**——見本は40条・9丈まで埋めて
     ある（§9.254 ④）ので「最大」と「データなり」が同じ数になる。数のほうは
     実データのロットで`tests/test_rpblocks.js`が見る。
     ここで見るのは、**書いてあることと起きていることが合っていること**
     ——控え欄を出していないのに「空欄にしています」と書いてあると紙が嘘を
     つく。測定データの表が在るのは見本のロットだけなので、ここで見る。
     ========================================================== */
  const noteNow=async()=>await page.evaluate(()=>
    [...document.querySelectorAll('.rp-note')].map(e=>e.textContent).join(' '));
  const setFull=async(name,label)=>{
   const l=await getj('/api/report-block-master');
   const r=(l.items||[]).find(x=>x.name===name);
   if(!r)return null;
   await post('/api/report-block-master',{id:r.id,equipment:r.equipment,name:r.name,
     span:r.span,rows:r.rows,content:r.content,note:r.note,enabledText:r.enabledText,
     cols:r.cols,kindText:r.kindText,text:r.text,repeatText:r.repeatText,
     repeatDirText:r.repeatDirText,fullText:label,user_id:'test'});
   return r;
  };
  const reopenSample=async()=>{
   await page.evaluate(()=>WL.reportBlocks.forget&&WL.reportBlocks.forget());
   /* **帰り道は「戻る」**（§9.253。帰り先を名乗り、開いていたタブまで戻す）
      ——`exitReportView()`はデータ一覧へ抜けるので、帳票ブロックマスタの
      「見本で帳票を見る」がどこにも無くなる。 */
   await page.click('#reportBack');
   await page.waitForSelector('#mmSampleView',{timeout:20000});
   await page.click('#mmSampleView');
   await page.waitForFunction(()=>{
    const c=document.getElementById('reportContent');
    return c&&c.textContent.length>500;
   },null,{timeout:20000});
   await page.waitForTimeout(700);
   return noteNow();
  };
  try{
   const N0=await noteNow();
   rec('§9.309 の前提: 既定では控え欄のことが書いてある',
       N0.indexOf('控え欄として空欄')>=0,N0.slice(0,90));
   await setFull('板幅ほかの測定データ','記録された数だけ出す');
   const N1=await reopenSample();
   rec('§9.309 「データなり」にすると注記も言い直す（控え欄の話を書かない）',
       N1.indexOf('控え欄は出しません')>=0&&N1.indexOf('控え欄として空欄')<0,
       N1.slice(0,120));
   await setFull('板幅ほかの測定データ','この塊のふつうの出し方（既定）');
   const N2=await reopenSample();
   rec('§9.309 「ふつう」へ戻すと注記も元へ戻る',
       N2.indexOf('控え欄として空欄')>=0,N2.slice(0,90));
  }catch(e){rec('FATAL(§9.309)',false,e.message)}

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

  /* ---- 7) 異常位置判定の図は**面ごと紙に出る**（§9.290、利用者の報告） ----
     「帳票ブロックマスタの異常位置判定結果の表示について、実際に印刷をすると、
      条の表示が消えたり見た目に変化があります。紙のレイアウトで表示している
      見た目通りの印刷結果にしたいので修正をお願いします」

     この図は**面だけで出来ている**——条は`background-color`、屑は縞の
     グラデーション、欠陥の帯と位置の旗は赤い面。ブラウザは印刷時に背景色を
     落とすのが既定（`print-color-adjust:economy`）なので、`.rp-page`に
     `exact`が無いと**条がまるごと消え**、条の番号と旗の文字（どちらも白）が
     白地に白で残る。

     **「指定が在る」だけを見ない**——実際に「背景画像を刷らない」設定
     （`printBackground:false`＝印刷ダイアログの既定）でPDFにして、
     **条の色が中身として出てくるか**を見る。直す前は 条=0（実測）。 */
  const laneHex=await page.evaluate(()=>{
   const l=document.querySelector('.rp-defect-lane');
   return l?getComputedStyle(l).getPropertyValue('--defect-lane-bg').trim():'';
  });
  rec('前提: 紙に条の帯が出ている（色は画面から引く）',/^#[0-9a-f]{6}$/i.test(laneHex),laneHex);
  if(/^#[0-9a-f]{6}$/i.test(laneHex)){
   await page.emulateMedia({media:'print'});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const pdf=await page.pdf({preferCSSPageSize:true,printBackground:false});
   await page.emulateMedia({media:null});
   /* PDFの中身（Flate）を解いて、塗りつぶし（`r g b rg`）を探す。 */
   const zlib=require('zlib');
   const parts=[];
   for(let i=0;;){
    const at=pdf.indexOf('stream',i);
    if(at<0)break;
    let s0=at+6;
    if(pdf[s0]===13)s0++;
    if(pdf[s0]===10)s0++;
    const e0=pdf.indexOf('endstream',s0);
    if(e0<0)break;
    try{parts.push(zlib.inflateSync(pdf.slice(s0,e0)))}catch(_){}
    i=e0+9;
   }
   const blob=Buffer.concat(parts).toString('latin1');
   /* Chromeは小数4桁・先頭の0を落として書く（`#a32424`→`.6392 .1412 .1412 rg`）。
      端の0と1はそのまま`0`／`1`。**3桁の前置き**で見る（丸めの1桁ぶんを許す）。 */
   const comp=v=>{const n=Math.round(v/255*1e4);
    if(n===0)return '0';
    if(n===10000)return '1';
    return '\\.'+String(n).padStart(4,'0').slice(0,3)+'\\d*';};
   const rgb=[1,3,5].map(i=>parseInt(laneHex.slice(i,i+2),16));
   const src=rgb.map(comp).join(' ')+' rg';
   const hit=(blob.match(new RegExp(src,'g'))||[]).length;
   rec('刷ると条の面がそのまま出る（背景を切っていても）',hit>0,
       `${laneHex} → /${src}/ ／ ${hit}箇所 ／ PDF ${pdf.length}B`);
  }

  /* ==========================================================
     8) 異常位置判定（§9.305 ②、利用者の指示）
     ----------------------------------------------------------
     ①「『内容』のコメント欄の折り返し方が変で2行目が右寄せになっている」
       → **折り返す値は左づめ**。数は右づめのまま（欄が縦にそろう）。
     ②「長手方向のデータがある場合はそれも表示したり、しなかったり選べる」
       → 既定は出す。設定で出さないにできる。

     **素通りに注意**: 「クラスが付いた」だけを見る網は絵が変わっていなくても
     通る（§9.229 ⑥）。**解決した`text-align`**と、**紙に出ている文字**で見る。
     ========================================================== */
  const alignOf=await page.evaluate(()=>{
   const box=document.querySelector('.rp-defect-facts');
   if(!box)return null;
   const pick=lb=>[...box.querySelectorAll('.rp-defect-fact')]
     .find(f=>(f.querySelector('span')?.textContent||'').trim()===lb);
   const memo=pick('内容'),base=pick('基準');
   return {内容:memo?getComputedStyle(memo.querySelector('b')).textAlign:'',
           基準:base?getComputedStyle(base.querySelector('b')).textAlign:'',
           内容の字:memo?(memo.querySelector('b').textContent||'').trim():''};
  });
  rec('前提: 異常位置判定の「内容」が紙に出ている',
      !!alignOf&&alignOf.内容の字.length>0,JSON.stringify(alignOf));
  rec('折り返す「内容」は左づめ（2行目が右寄せにならない）',
      !!alignOf&&alignOf.内容==='left',alignOf?alignOf.内容:'');
  /* **片側だけ見ない**——全部を左づめにしてしまうと欄が縦にそろわなくなる。 */
  rec('数の欄は右づめのまま（欄が縦にそろう）',
      !!alignOf&&alignOf.基準==='right',alignOf?alignOf.基準:'');

  const rollOn=await page.evaluate(()=>{
   const el=document.querySelector('.rp-defect-roll');
   if(!el)return null;
   const t=el.textContent||'';
   return {見出し:(el.querySelector('h3')||{}).textContent==='ピッチ判定',
           ピッチ:/314\.2/.test(t),
           径:/合うロール径/.test(t),
           /* §9.323 ③: 欄には式を書かない（狭い欄で折り返して不自然だった）。
              式は足元の注記が言うので、**注記には残っている**こと。
              **「合うロール径のすぐ後ろに」で見ないこと**——ラベルと値は
              `</span><b>`で隔てられているので、`[^<]*`のような近さで見る網は
              式を書き戻しても通る（実際に素通りした）。塊のどこにも
              `ピッチ÷π`が無いことで見る（注記は`π×径`と書くので当たらない）。 */
           式を欄に書かない:!/ピッチ÷π/.test(t),
           式は注記に在る:/ロールの周長/.test(t),
           判定:!!el.querySelector('.rp-defect-roll-answer')};
  });
  rec('ピッチ判定が独立した塊として既定で紙に出る（§9.319-C）',
      !!rollOn&&rollOn.見出し&&rollOn.ピッチ&&rollOn.判定,JSON.stringify(rollOn));
  rec('合うロール径も紙に出る',!!rollOn&&rollOn.径,JSON.stringify(rollOn));
  rec('欄には式（ピッチ÷π）を書かない／式は足元の注記が言う（§9.323 ③）',
      !!rollOn&&rollOn.式を欄に書かない&&rollOn.式は注記に在る,JSON.stringify(rollOn));

  /* 出す／出さないを切り替える。**紙の文字が実際に変わること**まで見る。
     §9.319-Cで塊を分けたので、入切は**ふつうの塊と同じ「紙に出す」**
     （`長手:`の専用の印は廃した——同じことをする入口を2つ置かない・§9.207）。
     **消す道と出す道は別々に通す**（塊の編集窓／置き場の札）——片方だけを
     見る網は、もう片方が壊れていても通る（§9.278と同じ理由）。 */
  const settleRp=async()=>{
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   await page.waitForTimeout(300);
   return page.evaluate(()=>({
     長手:!!document.querySelector('.rp-defect-roll'),
     幅方向:!!document.querySelector('.rp-defect-figure')}));
  };
  await page.click('#reportArrange');
  await page.waitForTimeout(400);
  await page.evaluate(()=>document.querySelector('[data-rp-block="ピッチ判定"] [data-rp-paper]').click());
  await page.waitForFunction(()=>{const m=document.getElementById('rpBlockModal');return !!m&&!m.hidden},null,{timeout:8000});
  await page.click('#rpBlockForm [data-e-vis]');
  await page.evaluate(()=>{const c=document.getElementById('rpBlockClose');if(c)c.click()});
  const off=await settleRp();
  rec('「出さない」にするとピッチ判定が紙から消える',
      !!off&&off.長手===false,JSON.stringify(off));
  /* **幅方向は消さない**——切り替えたのはピッチの塊だけ（§4）。 */
  rec('「出さない」でも幅方向（どの条か）は残る',!!off&&off.幅方向===true,JSON.stringify(off));
  /* 置き場の札は**押すだけでも出せる**（§4）。ここも`rpShowBlock()`を通る。 */
  const palette=await page.evaluate(()=>{
   const b=document.querySelector('[data-rp-pal="ピッチ判定"]');
   if(!b)return false;b.click();return true;
  });
  rec('出していない塊は置き場の札から押して出せる',palette===true,String(palette));
  const on=await settleRp();
  rec('「出す」に戻すとピッチ判定がまた出る',!!on&&on.長手===true,JSON.stringify(on));
  /* 組み換えを閉じてから先へ（触ったぶんは自動で保存される・§9.303 ③）。 */
  await page.evaluate(()=>{const c=document.getElementById('rpArrangeCancel');if(c&&!document.getElementById('rpArrangeBar')?.hidden)c.click()});
  await page.waitForTimeout(400);

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
