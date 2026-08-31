/* test_actuals.js: 実績データリスト（§9.241 ③、利用者の指示）
   ============================================================
   「メインメニューに『実績』のデータをリストとして表示する機能。設備単位で
    切り替えて対象期間のデータを一覧で確認できる。データ一覧の完了とは別扱いで
    **閲覧のみ**（閲覧権限で扱える）。作業時に記録した**全データ**を扱える。
    ここから帳票や操業データ表の出力も出せるように。」

   ここで固定するのは次の点。
    1. メインメニューに入口があり、押すと一覧が出る
    2. **現場日と直はサーバーが答える**（§9.163・§9.195）——日付補正が
       効いた日付が出る。画面に判定を書き写していない
    3. **設備で切り替えられる**（他の設備の実績が混ざらない）
    4. **期間で絞れる**（現場日で数える）
    5. **状態で絞らない**——データ一覧の「完了」とは別扱いで、編集中も完了も
       全部出る（これがこの画面の存在理由）
    6. **閲覧モードでも開ける**（GETだけ。列の設定ボタンは出さない）
    7. 行から帳票を開ける／操業データ表のプレビューを開ける

   **材料は自分で注ぎ込むこと**——検証用フィクスチャの実績は日付も設備も
   偏っているので、そのまま見ても「絞り込みが効いている」と「たまたま同じ」を
   見分けられない。設備2つ・日付2つ・状態2つを作って入れる。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const TAG='AC'+process.pid;
const EQ='テスト設備A',EQ2='テスト設備B';
let b=null;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const getj=async p=>(await fetch(B+p)).json();
const made=[];

/* 現場日を狙って作る。**`new Date('...')`で組み立てない**（§9.195。UTCの
   0時として読まれ、地方時で1日ずれる）——地方時の年月日時分から作る。 */
function localIso(y,m,d,hh,mm){
 return new Date(y,m-1,d,hh,mm,0).toISOString();
}
function ymd(y,m,d){
 const p=n=>String(n).padStart(2,'0');
 return `${y}-${p(m)}-${p(d)}`;
}
async function mk(o){
 const id=o.id;
 const payload=JSON.stringify({
  id,status:o.status||'編集中',updatedAt:localIso(o.y,o.m,o.d,o.hh,o.mm),
  basic:{lotNo:o.lotNo,inspectionNo:o.inspectionNo||'',mfgMaterial:o.material||'',
         mfgThickness:o.thickness||''},
  settings:{registeredEquipment:o.equipment,opData:o.opData||{}},
  workTime:{startAt:localIso(o.y,o.m,o.d,o.hh,o.mm),
            endAt:localIso(o.y,o.m,o.d,o.hh,(o.mm||0)+30)},
  measurements:{},
 });
 await post('/api/measurement/backup',{id,lotNo:o.lotNo,inspectionNo:o.inspectionNo||'',
   equipment:o.equipment,status:o.status||'編集中',codec:'json-full-v32',payload,
   user_id:'test',updated_at_iso:localIso(o.y,o.m,o.d,o.hh,o.mm)});
 made.push(id);
}

(async()=>{
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 try{
  await post('/api/access-mode',{mode:'edit'});
  /* 設備Bはマスタに無くてもよい（実績は履歴なので、マスタから消した設備の
     ぶんも見られる必要がある）。 */
  const Y=2026,M=3;
  /* 1直(8:15-17:05相当)の昼と、3直(23:00-翌7:00)の深夜。深夜は**前の日**の
     実績として数えられるはず（日付補正 -1）。 */
  await mk({id:TAG+'-A1',lotNo:TAG+'L1',equipment:EQ,y:Y,m:M,d:10,hh:9,mm:0,
            status:'完了',material:'A1050',thickness:'0.5',
            opData:{[TAG+'項目']:'123'}});
  await mk({id:TAG+'-A2',lotNo:TAG+'L2',equipment:EQ,y:Y,m:M,d:10,hh:14,mm:0,
            status:'編集中'});
  /* 3/11の2:00 → 3直なので現場日は3/10（日付補正 -1）。 */
  await mk({id:TAG+'-A3',lotNo:TAG+'L3',equipment:EQ,y:Y,m:M,d:11,hh:2,mm:0});
  /* 別の日 */
  await mk({id:TAG+'-A4',lotNo:TAG+'L4',equipment:EQ,y:Y,m:M,d:12,hh:9,mm:0});
  /* 別の設備 */
  await mk({id:TAG+'-B1',lotNo:TAG+'M1',equipment:EQ2,y:Y,m:M,d:10,hh:9,mm:0});

  /* ---- サーバーの答え（現場日・直・絞り込み） ---- */
  const day=ymd(Y,M,10);
  const all=await getj(`/api/measurement/actuals?from=${day}&to=${day}`);
  const mine=(all.items||[]).filter(x=>String(x.id).startsWith(TAG));
  rec('現場日で絞れる（この日の実績だけ返る）',mine.length===4,
      JSON.stringify(mine.map(x=>[x.id,x.workDate,x.shift])));
  const a3=mine.find(x=>x.id===TAG+'-A3');
  rec('日を跨ぐ直は前の日として数える（日付補正が効く）',
      !!a3&&a3.workDate===day&&a3.calDate===ymd(Y,M,11)&&a3.shiftDayOffset===-1,
      JSON.stringify(a3&&{workDate:a3.workDate,calDate:a3.calDate,off:a3.shiftDayOffset,shift:a3.shift}));
  rec('直の名前が入る（サーバーが勤務区分マスタから決める）',
      !!a3&&!!a3.shift,JSON.stringify(a3&&a3.shift));
  const eqOnly=await getj(`/api/measurement/actuals?equipment=${encodeURIComponent(EQ)}&from=${day}&to=${day}`);
  const eqMine=(eqOnly.items||[]).filter(x=>String(x.id).startsWith(TAG));
  rec('設備で絞ると他の設備が混ざらない',
      eqMine.length===3&&eqMine.every(x=>x.equipment===EQ),
      JSON.stringify(eqMine.map(x=>x.equipment)));
  rec('状態では絞らない（編集中も完了も出る）',
      new Set(eqMine.map(x=>x.status)).size===2,
      JSON.stringify(eqMine.map(x=>x.status)));
  rec('操業データがそのまま運ばれる',
      !!eqMine.find(x=>x.id===TAG+'-A1'&&(x.opData||{})[TAG+'項目']==='123'),
      JSON.stringify((eqMine.find(x=>x.id===TAG+'-A1')||{}).opData));
  rec('仕掛の列の呼び名はサーバーが返す',
      Array.isArray(all.lotFields)&&all.lotFields.some(f=>f.key==='mfgThickness'&&f.label),
      JSON.stringify((all.lotFields||[]).slice(0,3)));

  /* ---- 画面 ---- */
  b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
  const page=await b.newPage({viewport:{width:1600,height:1000}});
  const errs=[];
  page.on('pageerror',e=>errs.push(String(e&&e.message||e)));
  const openList=async()=>{
   await page.waitForSelector('#openActuals',{timeout:25000});
   await page.click('#openActuals');
   await page.waitForSelector('#actualsPanel .ac-row.head',{timeout:20000});
  };
  const setRange=async()=>page.evaluate(d=>{
   const f=document.getElementById('acFrom'),t=document.getElementById('acTo');
   f.value=d;t.value=d;
   f.dispatchEvent(new Event('change'));
   t.dispatchEvent(new Event('change'));
  },day);
  const snap=()=>page.evaluate(TAG=>{
   const rows=[...document.querySelectorAll('#acList .ac-row:not(.head)')];
   return {
    heads:[...document.querySelectorAll('#acList .ac-row.head>span')].map(s=>s.dataset.col),
    rows:rows.length,
    mine:rows.filter(r=>r.textContent.includes(TAG)).length,
    text:rows.map(r=>r.textContent).join(' | '),
    列設定:!!document.querySelector('#acColumns:not([hidden])'),
    帳票ボタン:document.querySelectorAll('#acList [data-report]').length,
    表ボタン:!!document.getElementById('acSheet'),
   };
  },TAG);

  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await openList();
  await setRange();
  await page.waitForFunction(t=>[...document.querySelectorAll('#acList .ac-row:not(.head)')]
    .filter(r=>r.textContent.includes(t)).length===4,TAG,{timeout:20000});
  const s1=await snap();
  rec('メインメニューから一覧が開く',s1.rows>0&&s1.heads.includes('ロット番号'),JSON.stringify(s1.heads));
  rec('既定の列に現場日と直が出る',s1.heads.includes('現場日')&&s1.heads.includes('直'),
      JSON.stringify(s1.heads));
  rec('この日の実績が全部出る（状態で絞らない）',s1.mine===4,String(s1.mine));
  rec('行から帳票を開くボタンがある',s1.帳票ボタン===s1.rows,
      JSON.stringify({帳票:s1.帳票ボタン,行:s1.rows}));
  rec('操業データ表の入口がある',s1.表ボタン===true,String(s1.表ボタン));

  /* 設備で切り替える */
  await page.selectOption('#acEquipment',EQ);
  /* **待ちは「無くなったこと」だけで置かない**（§9.102）——読み込み中は行が
     0件になるので、その瞬間に条件が満たされて空の一覧を測ってしまう
     （実際に通しで1件だけ落ちた）。「3件出ていて、かつ他設備が無い」で待つ。 */
  await page.waitForFunction(t=>{
   const rows=[...document.querySelectorAll('#acList .ac-row:not(.head)')];
   return rows.filter(r=>r.textContent.includes(t)).length===3
       && !rows.some(r=>r.textContent.includes(t+'M1'));
  },TAG,{timeout:20000});
  const s2=await snap();
  rec('画面でも設備を切り替えられる（他設備が消える）',
      s2.mine===3&&!s2.text.includes(TAG+'M1'),String(s2.mine));

  /* ---- 閲覧モードでも開ける（この画面の要件） ---- */
  await post('/api/access-mode',{mode:'view'});
  await page.reload({waitUntil:'domcontentloaded'});
  await openList();
  await setRange();
  await page.waitForFunction(t=>[...document.querySelectorAll('#acList .ac-row:not(.head)')]
    .some(r=>r.textContent.includes(t)),TAG,{timeout:20000}).catch(()=>{});
  const s3=await snap();
  rec('閲覧モードでも一覧が開く（閲覧権限で扱える）',s3.mine>0,String(s3.mine));
  rec('閲覧モードでは列の設定ボタンを出さない（保存できないので）',
      s3.列設定===false,String(s3.列設定));
  await post('/api/access-mode',{mode:'edit'});

  /* ---------- 記録した全部を列にできる（§9.288 ⑧、利用者の指示） ----------
     「実績データについては、一覧としてのリストは記録したすべてを対象に出力
      可能にしたいです。表示列についても対応できるように…」

     以前は仕掛の23件＋操業データの項目名だけだった。いまは**帳票と同じ候補**
     （`report_block_repo.field_catalog()`）から作る。
     **「候補に在る」だけを見ないこと**——実際にその列を出して**値が入る**
     ことまで見る（サーバーが道で引けていないと空欄のまま並ぶ）。 */
  const cat=await page.evaluate(()=>{
   const s=WL.actuals&&WL.actuals.state;
   return {groups:((s&&s.fieldCatalog)||[]).map(g=>g.group),
           note:String((s&&s.fieldNote)||''),
           keys:(WL.actuals?WL.actuals.columnKeys():[]).length};
  });
  rec('記録した値の候補がサーバーから届く（帳票と同じ1箇所）',
      cat.groups.length>=5&&cat.keys>40,JSON.stringify({g:cat.groups,keys:cat.keys}));
  rec('準備で決めた値・仕掛の生データも候補に出る',
      cat.groups.some(g=>/準備で決めた値/.test(g))&&cat.groups.some(g=>/生データ/.test(g)),
      JSON.stringify(cat.groups));
  /* **出せないものは名前で言う**（§4）——統計と子ロットは派生値なので扱わない。 */
  rec('扱えない群は理由を文字で言う（黙って落とさない）',
      /統計/.test(cat.note)&&/帳票では出せます/.test(cat.note),cat.note.slice(0,80));
  /* 実際に1列出して値が入るか。**記録した`製造板厚`**（`basic.mfgThickness`）。 */
  const label=await page.evaluate(()=>{
   const s=WL.actuals.state;
   for(const g of (s.fieldCatalog||[]))
    for(const it of (g.items||[]))
     if(it.path==='basic.mfgThickness')return it.label;
   return '';
  });
  if(!label)rec('前提: 製造板厚が候補にある',false,'見つかりません');
  else{
   await post('/api/column-layout-master',{target:'actuals:list',user_id:'test',
     order:['ロット番号',label],hidden:[]});
   await page.evaluate(()=>{try{WL.columnLayout.forget()}catch(e){}});
   await openList();
   await setRange();
   await page.waitForTimeout(2500);
   const cell=await page.evaluate(l=>{
    const heads=[...document.querySelectorAll('#acList .ac-row.head>span')].map(x=>x.dataset.col);
    const at=heads.indexOf(l);
    const rows=[...document.querySelectorAll('#acList .ac-row:not(.head)')];
    const hit=rows.find(r=>r.textContent.includes('L1'));
    return {at,heads,v:(at>=0&&hit)?(hit.children[at]?hit.children[at].textContent.trim():''):''};
   },label);
   rec('選んだ記録の項目が列として出て、値も入る',cell.at>=0&&cell.v==='0.5',
       JSON.stringify(cell).slice(0,220));
  }

  /* ---------- 一覧の道具が残っていないこと（§9.288 ⑥、利用者の報告） ----------
     「実績データ確認時に、フィルタバーが下部に落ちている不具合を発見しました」

     `body.ac-mode`が`#grid`と`.pager`しか伏せておらず、仕掛一覧の
     **絞り込みバー・一覧ツールバー・表のタブ**が実績の表の下に残っていた。
     **「在るかどうか」ではなく実際に見えているかで見る**——要素はいつでも
     DOMに在るので、`display:none`が効いているかは寸法で確かめる。
     **他のメイン画面ビューも一緒に見る**——同じ形の書き写しなので、
     1つ直しても次に足す画面でまた起きる（§9.233 ③）。 */
  await post('/api/access-mode',{mode:'edit'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  const chrome=()=>page.evaluate(()=>{
   const vis=id=>{
    const e=document.getElementById(id)||document.querySelector(id);
    if(!e)return false;
    const r=e.getBoundingClientRect();
    return !!(r.width>1&&r.height>1&&getComputedStyle(e).display!=='none');
   };
   return {mode:document.body.className,
           grid:vis('grid'),tabs:vis('tabs'),
           bar:vis('genericFilterBar'),tool:vis('listToolbar')};
  });
  const views=[['実績データ','#openActuals'],['データ一覧','#openDrafts'],
               ['作業スケジュール','#openSchedule'],['マスタ管理','#openMasterMaint']];
  const left=[];
  for(const [name,sel] of views){
   const ok=await page.evaluate(s=>{const b=document.querySelector(s);if(!b)return false;b.click();return true},sel);
   if(!ok)continue;
   await page.waitForTimeout(900);
   const c=await chrome();
   if(c.grid||c.tabs||c.bar||c.tool)left.push(name+':'+JSON.stringify(c));
  }
  rec('メイン画面ビューでは一覧の道具（表・タブ・絞り込みバー・ツールバー）が残らない',
      left.length===0,left.join(' / ').slice(0,300));

  rec('画面の例外が出ていない',errs.length===0,errs.join(' / '));
 }catch(e){
  console.log('FATAL '+(e&&e.message||e));R.push({ok:false});
 }finally{
  /* **後片付け**（§9.121）。実績も列レイアウトマスタも実行をまたいで残る。 */
  try{await post('/api/measurement/backup/delete',{ids:made})}catch(_){}
  for(const tg of ['actuals:list']){
   try{await post('/api/column-layout-master',{target:tg,clear:true,order:[],hidden:[],
     widths:{},names:{},formats:{},rules:{},formulas:{},locks:[],sorts:{},user_id:'test'})}catch(_){}
  }
  try{await post('/api/access-mode',{mode:'edit'})}catch(_){}
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
