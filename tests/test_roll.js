/* test_roll.js: ロールマスタとピッチ→ロール判定(§9.239 ⑥、利用者の指示)
   ============================================================
   「モーダルにタブを追加し、欠陥を発見した際にピッチがある場合、ピッチを
    入力し、当設備の対象ロールを判定する機能を実装したいです。（略）
    使うデータはこのカラムのうちロール径MAXを主とし、ロール径MINも
    データがあるものはそれも計算に用いる。」

   ここで固定するのは次の点。
    1. ロールマスタの4本セット（GET/POST/update/delete）が通る
    2. **1ロール1設備**（§9.239 ⑥ 訂正、利用者の指示「同一ロール名でも全く
       違う設備の全く違うものとして管理する。厳密に設備を割ってから個別に
       ロール管理したい。1ロール1設備が正しい」）——
       ・**同じロール名を別々の設備に登録でき、両方が別の行として残る**
       ・カンマ区切り／`'*'`／空／未登録の設備は**理由つきで断る**
       ・ある設備の判定に**他の設備のロールが混ざらない**
    3. **空欄は0にしない**（径MIN・面長・本数が未入力なら null のまま）
    4. **径MIN>MAXは断る**（黙って入れ替えない）
    5. 語彙（入出位置・接触面・駆動方式）は**サーバーが返す**
    6. 異常位置判定にタブが2つあり、②でピッチを入れると候補が出る
    7. **直接一致と倍音を言葉で分ける**
    8. **ロールが未登録でも「このピッチに合うロール径」は出る**
    9. **設備の改名にロールが追随する**

   **材料は自分で注ぎ込むこと**——検証用フィクスチャにロールは1本も無く、
   「候補0件」を見ても壊れていても同じ結果になる（§9.239 ⑥の risks）。
   径MAXだけの行・MAX/MIN両方の行・径が空の行の3種を入れる。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const TAG='RT'+process.pid;
const EQ='テスト設備A',EQ2='テスト設備B';
let b=null;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const getj=async p=>(await fetch(B+p)).json();
const made=[];
(async()=>{
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 try{
  await post('/api/access-mode',{mode:'edit'});

  /* ---- 1) 4本セットと保存の作法 ---- */
  const mk=async body=>{
   const r=await (await post('/api/roll-master',{user_id:'test',...body})).json();
   if(r.id)made.push(r.id);
   return r;
  };
  /* 周長を狙い撃ちできる径を使う: π×250 ≒ 785.40 */
  const a=await mk({equipment:EQ,name:TAG+'A',entryPos:'入側',contactFace:'上面',
                    diaMax:250,material:'ゴム',hardness:'Hs70',count:2,refNo:'RN-1'});
  rec('ロールを登録できる',!!a.id,JSON.stringify(a));
  /* 摩耗の範囲を持つロール: π×(200〜210) ≒ 628.3〜659.7 */
  const c=await mk({equipment:EQ,name:TAG+'B',entryPos:'出側',contactFace:'下面',
                    diaMax:210,diaMin:200});
  rec('径MAX/MINの両方を持てる',!!c.id,JSON.stringify(c));
  /* 径が空の行（判定できないと言う相手） */
  const d=await mk({equipment:EQ,name:TAG+'C',entryPos:'中間'});
  rec('径が空でも登録はできる（判定できないと言うため）',!!d.id,JSON.stringify(d));
  /* ---- 1b) 1ロール1設備（§9.239 ⑥ 訂正、利用者の指示） ----
     **これがこの訂正の要件そのもの**: 同じ呼び名でも設備が違えば別のロール。
     径をわざと変える——同じ名前で「同じ1本が共有されている」実装だと、
     あとの判定で片方の径しか出てこないので必ず落ちる。 */
  const sameA=await mk({equipment:EQ, name:TAG+'SAME',diaMax:250});
  const sameB=await mk({equipment:EQ2,name:TAG+'SAME',diaMax:100});
  rec('同じロール名を別々の設備に登録できる',
      !!sameA.id&&!!sameB.id&&sameA.id!==sameB.id,
      JSON.stringify({A:sameA.id,B:sameB.id}));

  /* **断る側も見る。** 断り文は「何が悪いか」を名指しすること（§CLAUDE 4／§6）。 */
  const reject=async(eq,label)=>{
   const r=await post('/api/roll-master',{user_id:'test',equipment:eq,name:TAG+'NG'+label,diaMax:50});
   const j=await r.json().catch(()=>({}));
   if(j.id)made.push(j.id);
   return {code:r.status,err:String(j.error||''),id:j.id};
  };
  const rejAll=await reject('*','ALL');
  rec('「すべての設備」は断る',rejAll.code===400&&!rejAll.id&&/設備を1つ/.test(rejAll.err),
      JSON.stringify(rejAll));
  const rejCsv=await reject(EQ+','+EQ2,'CSV');
  rec('カンマ区切りは断る',rejCsv.code===400&&!rejCsv.id&&/1つだけ/.test(rejCsv.err),
      JSON.stringify(rejCsv));
  const rejEmpty=await reject('','EMPTY');
  rec('設備が空なら断る',rejEmpty.code===400&&!rejEmpty.id&&/設備を選んで/.test(rejEmpty.err),
      JSON.stringify(rejEmpty));
  const rejUnknown=await reject('存在しない設備'+TAG,'UNK');
  rec('設備マスタに無い設備は断る（理由を名指しする）',
      rejUnknown.code===400&&!rejUnknown.id&&/設備マスタに/.test(rejUnknown.err),
      JSON.stringify(rejUnknown));

  const one=await getj('/api/roll-master?equipment='+encodeURIComponent(EQ));
  const mine=(one.items||[]).filter(x=>x.name.startsWith(TAG));
  rec('設備で絞れる（この設備に入れた4本だけ）',mine.length===4,
      JSON.stringify(mine.map(x=>x.name)));
  const two=await getj('/api/roll-master?equipment='+encodeURIComponent(EQ2));
  const other=(two.items||[]).filter(x=>x.name.startsWith(TAG));
  /* **他の設備のロールが1本も混ざらないこと。** ここが通らないと
     「当設備の対象ロールを判定する」という機能の意味が消える。 */
  rec('他の設備のロールは混ざらない（同名の1本だけ・径も別物）',
      other.length===1&&other[0].name===TAG+'SAME'&&other[0].diaMax===100,
      JSON.stringify(other.map(x=>({n:x.name,d:x.diaMax}))));
  rec('同じ名前でも設備ごとに別の径を持てる',
      (mine.find(x=>x.name===TAG+'SAME')||{}).diaMax===250,
      JSON.stringify(mine.map(x=>({n:x.name,d:x.diaMax}))));

  const hitC=mine.find(x=>x.name===TAG+'C');
  rec('空欄は0にしない（径MIN・面長・本数はnullのまま）',
      !!hitC&&hitC.diaMax===null&&hitC.diaMin===null&&hitC.faceLen===null&&hitC.count===null,
      JSON.stringify(hitC&&{max:hitC.diaMax,min:hitC.diaMin,len:hitC.faceLen,n:hitC.count}));
  const hitB=mine.find(x=>x.name===TAG+'B');
  rec('径MAX/MINが往復する',!!hitB&&hitB.diaMax===210&&hitB.diaMin===200,
      JSON.stringify(hitB&&{max:hitB.diaMax,min:hitB.diaMin}));

  /* 語彙はサーバーが答える */
  rec('入出位置・接触面・駆動方式の候補をサーバーが返す',
      Array.isArray(one.entryPositions)&&one.entryPositions.length>0
      &&Array.isArray(one.contactFaces)&&Array.isArray(one.driveKinds),
      JSON.stringify({p:one.entryPositions,f:one.contactFaces,d:one.driveKinds}));

  /* ---- 2) 径MIN>MAXは断る（黙って入れ替えない） ---- */
  const bad=await post('/api/roll-master',{user_id:'test',equipment:EQ,name:TAG+'X',
                                           diaMax:100,diaMin:200});
  const badJson=await bad.json();
  rec('径MINがMAXより大きい登録は断る',bad.status===400&&/MIN/.test(badJson.error||''),
      JSON.stringify(badJson));

  /* ---- 3) 送っていない項目は消えない（§9.212 ②） ---- */
  await post('/api/roll-master/update',{user_id:'test',id:a.id,refNo:'RN-2'});
  const after=(await getj('/api/roll-master?equipment='+encodeURIComponent(EQ))).items
    .find(x=>x.id===a.id);
  rec('送っていない項目は消えない',
      after&&after.diaMax===250&&after.material==='ゴム'&&after.refNo==='RN-2',
      JSON.stringify(after&&{max:after.diaMax,mat:after.material,ref:after.refNo}));

  /* ---- 3b) 設備マスタから消えた設備のロールも編集できる（§9.204と同じ罠） ----
     `equipment-select`は候補（設備マスタ）から`<option>`を作る。**いま入って
     いる設備が候補に無いときに足さないと**、開いた瞬間に「選択...」へ落ち、
     **保存し直しただけで設備が空になる**（保存側は空を断るので、その行は
     編集も付け替えもできなくなる）。ここは画面を開いて実際に見る。 */
  {
   const EQGONE=TAG+'消える設備';
   await post('/api/equipment-master',{name:EQGONE,user_id:'test'});
   const gone=((await getj('/api/equipment-master')).items||[]).find(x=>x.name===EQGONE);
   if(gone){
    const orphan=await mk({equipment:EQGONE,name:TAG+'ORPHAN',diaMax:180});
    /* 設備マスタから消す（ロールの行は残る）。 */
    try{await post('/api/equipment-master/delete',{id:gone.id,force:true,user_id:'test'})}catch(_){}
    b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
    const page=await b.newPage({viewport:{width:1600,height:1000}});
    try{
     await page.goto(B+'/',{waitUntil:'domcontentloaded'});
     await page.waitForSelector('#openMasterMaint',{timeout:20000});
     await page.click('#openMasterMaint');
     await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:10000});
     await page.fill('#masterUserId','tester');
     await page.evaluate(()=>document.querySelector('#masterUserId').dispatchEvent(new Event('change')));
     await page.evaluate(()=>{
      const t=[...document.querySelectorAll('#masterMaintNav [data-master]')]
        .find(x=>x.dataset.master==='roll');
      if(t)t.click();
     });
     await page.waitForSelector('#masterMaintList .mm-row:not(.head)',{timeout:10000});
     /* **その行の編集フォームを実際に開く**（一覧の見た目ではなく入力欄を見る）。 */
     const opened=await page.evaluate(async name=>{
      const rows=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')];
      const row=rows.find(r=>r.textContent.includes(name));
      if(!row)return {前提なし:'ロールの行が一覧に無い'};
      row.click();
      for(let i=0;i<40;i++){
       if(document.querySelector('[data-field="equipment"]'))break;
       await new Promise(r=>requestAnimationFrame(r));
      }
      const sel=document.querySelector('[data-field="equipment"]');
      if(!sel)return {前提なし:'設備の欄が開かない'};
      return {値:sel.value,
              候補:[...sel.options].map(x=>x.textContent.trim()),
              注記:(sel.closest('.mm-field')||sel.parentElement||{}).textContent||''};
     },TAG+'ORPHAN');
     rec('消えた設備のロールでも編集フォームを開ける',!opened.前提なし,JSON.stringify(opened));
     rec('候補に無い今の設備名を捨てない（選ばれたまま）',
         opened.値===EQGONE,JSON.stringify({値:opened.値,候補:(opened.候補||[]).slice(0,4)}));
     rec('設備マスタに無いことを文字で言う（§4）',
         /設備マスタにありません/.test(String(opened.注記||'')),
         String(opened.注記||'').slice(0,120));
    }finally{ await b.close(); b=null; }
   }
  }

  /* ---- 4) 設備の改名に追随する（§CLAUDE「改名連動の一覧へ足す」） ----
     **足し忘れると設備を改名した瞬間にその設備のロールが1本も出なくなる**
     （VER2.44.0 で一度直した不具合の再発）。改名は設備マスタのIDで頼む。 */
  {
   const EQOLD=TAG+'旧設備',EQNEW=TAG+'新設備';
   const mkEq=await (await post('/api/equipment-master',{name:EQOLD,user_id:'test'})).json();
   const eqRow=((await getj('/api/equipment-master')).items||[]).find(x=>x.name===EQOLD);
   rec('検証用の設備を作れる',!!eqRow,JSON.stringify(mkEq));
   if(eqRow){
    const named=await mk({equipment:EQOLD,name:TAG+'REN',diaMax:120});
    await post('/api/equipment-master/update',{id:eqRow.id,name:EQNEW,user_id:'test'});
    const moved=((await getj('/api/roll-master')).items||[]).find(x=>x.id===named.id);
    rec('設備を改名するとロールの対象設備も追随する',
        !!moved&&moved.equipment===EQNEW,JSON.stringify(moved&&moved.equipment));
    /* 後片付け（設備マスタも実行をまたいで残る）。 */
    try{await post('/api/equipment-master/delete',{id:eqRow.id,force:true,user_id:'cleanup'})}catch(_){}
   }
  }

  /* ---- 5) 画面: タブとピッチ判定 ---- */
  b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
  const page=await b.newPage({viewport:{width:1700,height:1000}});
  const errs=[];page.on('pageerror',x=>errs.push(x.message));
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('aside [data-db-key]',{timeout:25000});
  await page.waitForTimeout(600);
  /* 測定を開かずに判定だけ確かめる——**判定は1箇所**(`WL.defect.rollMatches`)
     なので、画面の外から同じ関数を通せる。 */
  const calc=await page.evaluate(rows=>{
   const f=WL.defect.rollMatches;
   const direct=f({pitch:785.4,tol:2,face:'',harmonics:1},rows);
   const harm=f({pitch:392.7,tol:2,face:'',harmonics:3},rows);   // 周長の半分
   const band=f({pitch:640,tol:1,face:'',harmonics:1},rows);     // 628.3〜659.7 の中
   const none=f({pitch:12345,tol:1,face:'',harmonics:1},rows);
   const empty=f({pitch:0,tol:2,face:'',harmonics:1},rows);
   const pick=r=>({n:(r.hits||[]).length,先頭:(r.hits||[])[0]&&r.hits[0].roll.name,
                   種類:(r.hits||[])[0]&&r.hits[0].kind,径:r.needDia,
                   飛ばした:(r.skipped||[]).length,error:r.error||''});
   return {direct:pick(direct),harm:pick(harm),band:pick(band),none:pick(none),empty:pick(empty)};
  },mine.map(x=>({...x})));
  rec('ピッチ＝周長のロールが直接一致で当たる',
      calc.direct.n>=1&&calc.direct.種類==='direct',JSON.stringify(calc.direct));
  rec('このピッチに合うロール径を必ず返す（ピッチ÷π）',
      Math.abs(calc.direct.径-250)<0.5,String(calc.direct.径));
  rec('周長の半分のピッチは「1周に複数」として出る',
      calc.harm.n>=1&&calc.harm.種類!=='direct',JSON.stringify(calc.harm));
  rec('径MAX/MINの範囲に入るピッチも当たる',calc.band.n>=1,JSON.stringify(calc.band));
  rec('径が空のロールは「判定できない」として数える',
      calc.direct.飛ばした>=1,String(calc.direct.飛ばした));
  rec('当てはまらないピッチでは候補0件（それでも径は返す）',
      calc.none.n===0&&calc.none.径>0,JSON.stringify(calc.none));
  rec('ピッチが空なら理由を返す（0として判定しない）',
      !!calc.empty.error,calc.empty.error);

  /* ---- 6) モーダルのタブ ---- */
  const tabs=await page.evaluate(()=>({
   数:document.querySelectorAll('#defectModal .defect-tab').length,
   面:document.querySelectorAll('#defectModal [data-defect-pane]').length,
   ピッチ欄:!!document.getElementById('defectPitch'),
   許容差:!!document.getElementById('defectPitchTol'),
   結果枠:!!document.getElementById('defectRollResult'),
   一覧:!!document.getElementById('defectRollList'),
  }));
  rec('異常位置判定にタブが2つある',tabs.数===2&&tabs.面===2,JSON.stringify(tabs));
  rec('②の入力欄と結果の枠がある',tabs.ピッチ欄&&tabs.許容差&&tabs.結果枠&&tabs.一覧,
      JSON.stringify(tabs));
  const paneSize=await page.evaluate(()=>{
   const a=document.getElementById('defectPanePos'),c=document.getElementById('defectPaneRoll');
   return {幅方向が見えている:!a.hidden,長手方向は畳んでいる:!!c.hidden};
  });
  rec('開いた直後は①（幅方向）を見せる',paneSize.幅方向が見えている&&paneSize.長手方向は畳んでいる,
      JSON.stringify(paneSize));
  rec('画面の例外が出ていない',errs.length===0,errs.join(' / '));
 }catch(e){
  console.log('FATAL '+(e&&e.message||e));R.push({ok:false});
 }finally{
  /* **後片付け**（§9.121）。ロールマスタは実行をまたいで残る。 */
  for(const id of made){
   try{await post('/api/roll-master/delete',{user_id:'test',id})}catch(_){}
  }
  try{
   const left=(await getj('/api/roll-master')).items.filter(x=>x.name&&x.name.startsWith(TAG));
   for(const x of left){try{await post('/api/roll-master/delete',{user_id:'test',id:x.id})}catch(_){}}
  }catch(_){}
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
