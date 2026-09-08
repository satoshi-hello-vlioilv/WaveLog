/* test_opauto.js: 自動で入る値・計算値を操業データ項目として置く（§9.234 ②）
   ============================================================
   利用者の指示:
     「操業データ項目マスタ（操業データ — 測定画面に出す入力欄と並び）に
      ついて、自動で入る値、計算値についても、現在使っているものは、その
      リストから選んで表示設定できるようにしてください。」

   ここで固定すること:
    - **語彙はサーバーが答える**（`/api/operation-item-master`の`autoValues`）。
      画面へ鍵の綴りを書き写さない（§9.163）。
    - 足した行は**族が`output`**＝打てる欄を作らない（§4）。
      型・数の決まり・初期値・手打ちの段は出さない。
    - 測定画面では`<output>`で**実際の値が入る**（ロット番号・製造板厚・
      条数）。**値はレコード（`settings.opData`）にも入る**——入らないと
      帳票からも③「記録した値」からも見えない。
    - **人が入れる欄ではないので「記録した値」の分母に入れない**
      （§9.227 ③の空きと同じ罠——どう頑張っても埋まらない件が残る）。
    - **もう置いてある値は一覧で押せない**（同じ数字が2箇所に出る・§8）。
    - **送らない更新で鍵が消えない**（§9.212 ②「送った項目だけ書く」）。
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B='http://127.0.0.1:5029';
const TAG='auto-'+Date.now().toString(36);
const post=(p,x)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(x)});
const get=p=>fetch(B+p).then(r=>r.json());
const EQ='テスト設備A';
const NM_LOT='ZZ'+TAG+'ロット番号';
const NM_CNT='ZZ'+TAG+'条数';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1920,height:1080}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 page.on('dialog',d=>d.accept());
 const made=[];
 try{
  await post('/api/access-mode',{mode:'edit'});

  /* ==========================================================
     1) 語彙はサーバーが答える
     ========================================================== */
  const cat=await get('/api/operation-item-master');
  const av=cat.autoValues||[];
  rec('自動で入る値の一覧をサーバーが返す',av.length>=10,'件数='+av.length);
  rec('鍵・呼び名・群・説明がそろっている',
      av.every(a=>a.key&&a.label&&a.group&&a.note),
      JSON.stringify(av[0]||null));
  const groups=[...new Set(av.map(a=>a.group))];
  rec('出どころごとに分かれている（仕掛／測定の記録／計算した値）',
      groups.length>=3,JSON.stringify(groups));
  /* **画面へ鍵の綴りを書き写していないこと**（§9.163）。写すと増やしたときに
     2箇所直すことになり、片方だけ直った状態が作れる。 */
  /* §9.324 R3: 操業データの盤は master-opdata.js（定義は master-defs.js）。 */
  const src=(await Promise.all(['master/master-defs','master/master-maint','master/master-opdata']
    .map(n=>fetch(B+'/static/js/'+n+'.js').then(r=>r.text())))).join('\n');
  if(src.length<20000)throw new Error('画面のJSを読めていない（取れた長さ '+src.length
    +'）——空の材料では「書き写していない」が必ず通る');
  const hard=av.filter(a=>src.indexOf("'"+a.key+"'")>=0||src.indexOf('"'+a.key+'"')>=0);
  rec('画面のJSに鍵の綴りを書き写していない',hard.length===0,
      JSON.stringify(hard.map(a=>a.key)));

  /* ==========================================================
     2) 足すと族が`output`になり、送らない更新で消えない
     ========================================================== */
  const r1=await (await post('/api/operation-item-master',
    {equipment:'*',group:'ZZ自動'+TAG,name:NM_LOT,type:'文字',place:'準備',span:4,
     autoValue:'lot.lotNo',user_id:'tests'})).json();
  if(r1&&r1.id)made.push(r1.id);
  const r2=await (await post('/api/operation-item-master',
    {equipment:'*',group:'ZZ自動'+TAG,name:NM_CNT,type:'文字',place:'準備',span:4,
     unit:'条',autoValue:'calc.stripCount',user_id:'tests'})).json();
  if(r2&&r2.id)made.push(r2.id);
  rec('前提: 自動で入る値の項目を2つ作れた',made.length===2,JSON.stringify([r1,r2]));
  const after=await get('/api/operation-item-master');
  const row=(after.items||[]).find(x=>x.id===r1.id)||{};
  rec('族は`output`＝打てる欄を作らない',row.widgetFamily==='output',
      JSON.stringify({fam:row.widgetFamily,fill:row.autoFill}));
  rec('自動で入る値として分類される（カードの配色と同じ判定）',
      row.autoFill==='computed',String(row.autoFill));
  rec('呼び名・群・説明が行に載る',
      row.autoValueLabel==='ロット番号'&&!!row.autoValueGroup&&row.autoValueKnown===true,
      JSON.stringify({l:row.autoValueLabel,g:row.autoValueGroup,k:row.autoValueKnown}));
  /* **送らない更新で消えない**（§9.212 ②）。設定窓は`autoValue`を送らない。 */
  await post('/api/operation-item-master/update',
    {id:r1.id,equipment:'*',group:'ZZ自動'+TAG,name:NM_LOT,type:'文字',user_id:'tests'});
  const kept=((await get('/api/operation-item-master')).items||[]).find(x=>x.id===r1.id)||{};
  rec('`autoValue`を送らない更新でも鍵が残る',kept.autoValue==='lot.lotNo',String(kept.autoValue));
  /* **知らない鍵も残す**（§9.204）——語彙を減らした版が1度読んだだけで
     現場の設定が黙って消えるのを避ける。引けないことは行が言う。 */
  const rx=await (await post('/api/operation-item-master',
    {equipment:'*',group:'ZZ自動'+TAG,name:'ZZ'+TAG+'知らない鍵',type:'文字',place:'準備',
     span:4,autoValue:'lot.しらない',user_id:'tests'})).json();
  if(rx&&rx.id)made.push(rx.id);
  const rowx=((await get('/api/operation-item-master')).items||[]).find(x=>x.id===rx.id)||{};
  rec('知らない鍵は捨てずに「引けません」と返す',
      rowx.autoValue==='lot.しらない'&&rowx.autoValueKnown===false,
      JSON.stringify({v:rowx.autoValue,k:rowx.autoValueKnown}));

  /* ==========================================================
     3) 盤: 一覧から選べる／もう置いてあるものは押せない
     ========================================================== */
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:30000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintNav [data-master="opItem"]',{timeout:20000});
  await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'tests');
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('.op-board',{timeout:20000});
  await page.waitForTimeout(900);
  rec('盤に「自動で入る値を足す」の入口がある',
      await page.$eval('#opAddAuto',e=>!!e.offsetParent).catch(()=>false),'');
  await page.click('#opAddAuto');
  await page.waitForSelector('.op-menu-auto',{timeout:8000});
  const menu=await page.evaluate(()=>{
   const m=document.querySelector('.op-menu-auto');
   const btns=[...m.querySelectorAll('button')];
   return {群:[...m.querySelectorAll('.op-menu-group')].map(e=>e.textContent.trim()),
     押せる:btns.filter(b=>!b.disabled).length,
     済み:btns.filter(b=>b.disabled).map(b=>b.textContent.trim().slice(0,40)),
     画面内:(()=>{const r=m.getBoundingClientRect();
       return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1})()};
  });
  rec('一覧は出どころの群で分かれている',menu.群.length>=3,JSON.stringify(menu.群));
  rec('一覧は画面の外へ出ない',menu.画面内===true,JSON.stringify(menu.画面内));
  rec('もう置いてある値は押せず、どのカードかを文字で言う',
      menu.済み.some(t=>/ロット番号/.test(t)&&/もう/.test(t)),JSON.stringify(menu.済み.slice(0,4)));
  /* **閉じる操作で閉じること**（§9.222 ①）——開いたことだけを見る網は、
     閉じられないメニューを素通りさせる。 */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  rec('Escで閉じる',(await page.$$('.op-menu-auto')).length===0,'');

  /* ==========================================================
     4) 設定窓: 型・数の決まり・初期値の段を出さない（§4）
     ========================================================== */
  await page.evaluate(n=>{
   const t=[...document.querySelectorAll('.op-tile')]
     .find(e=>(e.querySelector('.op-tile-name')||{}).textContent===n);
   if(t)t.click();
  },NM_LOT);
  await page.waitForSelector('#opItemModal:not([hidden])',{timeout:8000});
  await page.waitForSelector('#opModalForm .op-form-sec[data-op-sec="data"]',{timeout:8000});
  await page.waitForTimeout(300);
  const dlg=await page.evaluate(()=>{
   const f=document.getElementById('opItemModal');
   const rows=[...f.querySelectorAll('.op-form-row')].map(r=>
     (r.querySelector('.op-form-label')||{}).textContent||'');
   const out=f.querySelector('#opPrevField output');
   return {行:rows,自動あり:rows.includes('自動で入る値'),
     数の決まり:rows.includes('数の決まり'),
     初期値の欄:!!f.querySelector('#opdInitial'),
     型の選択:!!f.querySelector('[data-op-type]'),
     見本:out?out.textContent.trim():null};
  });
  rec('②に「自動で入る値」の行が出る',dlg.自動あり===true,JSON.stringify(dlg.行));
  rec('型は選ばせない（値の形は出どころが決める）',dlg.型の選択===false,String(dlg.型の選択));
  rec('数の決まりの行は出さない',dlg.数の決まり===false,String(dlg.数の決まり));
  rec('初期値の入力欄は出さない',dlg.初期値の欄===false,String(dlg.初期値の欄));
  rec('見本も`<output>`で描く',dlg.見本!==null,String(dlg.見本));

  /* ==========================================================
     5) 測定画面: 実際の値が入り、レコードにも入る
     ========================================================== */
  await page.evaluate(()=>{const m=document.getElementById('masterMaintModal');if(m)m.hidden=true});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r){r.querySelector('.sc-row-start').click();return true}return false;
  });
  if(!started)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
  await page.waitForTimeout(1800);
  const shown=await page.evaluate(n=>{
   const el=document.querySelector(`.selectors [data-opfield="${CSS.escape(n)}"]`)
     ||document.querySelector(`[data-opfield="${CSS.escape(n)}"]`);
   if(!el)return {あり:false};
   const out=el.querySelector(':scope>output');
   const cs=out?getComputedStyle(out):null;
   return {あり:true,印:el.dataset.opauto||'',値:out?out.value:null,
     打てる欄:!!el.querySelector('input,select,textarea'),
     枠:cs?cs.borderTopWidth:'',高さ:out?Math.round(out.getBoundingClientRect().height):0};
  },NM_LOT);
  rec('測定画面に自動で入る値の欄が出る',shown.あり===true,JSON.stringify(shown));
  rec('打てる欄は作らない（押しても効かない欄を残さない）',
      shown.あり&&shown.打てる欄===false,JSON.stringify(shown));
  rec('ロット番号が実際に入る',
      shown.あり&&!!shown.値&&shown.値!=='—',JSON.stringify(shown.値));
  rec('欄には枠と高さが当たる（器の名前で書き分けていない）',
      shown.あり&&parseFloat(shown.枠||'0')>0&&shown.高さ>=20,
      JSON.stringify({枠:shown.枠,高さ:shown.高さ}));
  const lot=await page.evaluate(()=>String((S.measure&&S.measure.basic&&S.measure.basic.lotNo)||''));
  rec('入った値はロットのロット番号と同じ',shown.値===lot,JSON.stringify({shown:shown.値,lot}));
  const bag=await page.evaluate(n=>{
   const d=(S.measure&&S.measure.settings&&S.measure.settings.opData)||{};
   return {値:d[n]==null?null:String(d[n]),鍵:Object.keys(d).length};
  },NM_LOT);
  rec('値はレコード（settings.opData）にも入る',bag.値===lot&&!!lot,JSON.stringify(bag));
  const cnt=await page.evaluate(n=>{
   const el=document.querySelector(`[data-opfield="${CSS.escape(n)}"] output`);
   return el?el.value:null;
  },NM_CNT);
  rec('計算値（条数）も入る',cnt!==null&&cnt!==''&&Number(cnt)>0,String(cnt));
  /* **条の設計が動いたら引き直す**（古いまま紙に出さない）。 */
  const changed=await page.evaluate(async n=>{
   const h=document.getElementById('horizontalCount');
   const was=Number(h.value)||1;
   h.value=String(was+1);h.dispatchEvent(new Event('change',{bubbles:true}));
   await new Promise(r=>setTimeout(r,600));
   const el=document.querySelector(`[data-opfield="${CSS.escape(n)}"] output`);
   const now=el?el.value:null;
   h.value=String(was);h.dispatchEvent(new Event('change',{bubbles:true}));
   return {was,now};
  },NM_CNT);
  rec('条数を変えたら引き直す',
      String(changed.now)===String(Number(changed.was)+1),JSON.stringify(changed));
  /* **「記録した値」の分母に入れない**（人が入れる欄ではない）。 */
  const filled=await page.evaluate(()=>{
   const f=(window.WL&&WL.opData&&WL.opData.filled)?WL.opData.filled():null;
   const defs=(window.WL&&WL.opData&&WL.opData.defs)?WL.opData.defs():[];
   return {f,auto:defs.filter(d=>d.autoValue).length,
     自由:defs.filter(d=>!d.builtin).length,dummy:defs.filter(d=>d.dummy).length};
  });
  rec('前提: 自動で入る値の行は測定画面まで届いている',filled.auto>=2,JSON.stringify(filled));
  rec('自動で入る値は「記録した値」の分母に入らない',
      !!filled.f&&filled.f.total===filled.自由-filled.dummy-filled.auto,
      JSON.stringify(filled));

  rec('画面のエラーが出ていない',errs.length===0,errs.join(' / '));
  const ng=R.filter(x=>!x.ok).length;
  console.log(`\n${R.length-ng}/${R.length} PASS`);
  process.exitCode=ng?1:0;
 }catch(e){
  console.log('FAIL: FATAL -- '+(e&&e.message));
  process.exitCode=1;
 }finally{
  /* **後始末は必ず**（§検証。落ちた側にも書く——次の実行が設定を引き継ぐ）。 */
  for(const id of made){
   try{await post('/api/operation-item-master/delete',{id,user_id:'tests'})}catch(_){}
  }
  /* 置いた実績は自分で消す（§9.351・§9.362）。残った実績は計画外実績として
     予定表に現れ、無関係な網を落とす。 */
  try{await require('./lib/harness.js').clearRecords()}catch(e){console.log('!! 実績の後片付けに失敗: '+(e&&e.message||e))}
  if(b)await b.close();
 }
})();
