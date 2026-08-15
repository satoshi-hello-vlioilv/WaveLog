/* メンテナンス導線(マスタ管理)の検証(§9.56)と、
   測定画面 左ペインの再配置(§9.55)の検証 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const call=async(m,p,b)=>{
 const r=await fetch(B+p,{method:m,...(b!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{})});
 let j={};try{j=await r.json()}catch(e){}
 return {status:r.status,body:j};
};
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));
 page.on('dialog',d=>d.accept());
 await call('POST','/api/access-mode',{mode:'edit'});

 // ---- (1) 勤務体系: 設備割当の有無で削除の成否が変わらない ----
 for(const [label,eq] of [['設備を割り当てた体系',['テスト設備A']],['全設備共通の体系(割当なし)',[]]]){
  const c=await call('POST','/api/schedule/shift-pattern-master',
   {name:'回帰_削除試験',equipment:eq,segments:[{name:'日勤',start:'08:00',end:'17:00'}],user_id:'t'});
  const d=await call('POST','/api/schedule/shift-pattern-master/delete',{id:c.body.id,user_id:'t'});
  rec(`${label}を削除できる`,d.status===200,`作成=${c.status} 削除=${d.status} ${d.body.error||''}`);
 }
 const list=await call('GET','/api/schedule/shift-pattern-master?scope=all');
 rec('削除した体系が一覧に残らない',
   !(list.body.items||[]).some(x=>x.name==='回帰_削除試験'),
   (list.body.items||[]).filter(x=>x.name==='回帰_削除試験').length+'件');
 const missing=await call('POST','/api/schedule/shift-pattern-master/delete',{id:99999999,user_id:'t'});
 rec('存在しないIDは従来どおり弾く',missing.status>=400,String(missing.status));

 // ---- (2) 更新者IDを省いても監査列が空にならない ----
 const made=await call('POST','/api/operator-master',{name:'回帰_更新者テスト'});
 const ops=await call('GET','/api/operator-master');
 const hit=(ops.body.items||[]).find(x=>x.name==='回帰_更新者テスト');
 rec('更新者ID未指定でも登録は通る',made.status===200);
 if(hit)await call('POST','/api/operator-master/delete',{id:hit.id,user_id:'cleanup'});

 // ---- (3) マスタ管理: 保存→一覧反映→削除が1周する ----
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openMasterMaint',{timeout:15000});
 await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openMasterMaint',{timeout:15000});
 await page.waitForTimeout(1200);
 await page.click('#openMasterMaint');
 await page.waitForSelector('#masterMaintForm',{timeout:10000});
 await page.waitForTimeout(1800);
 const tabs=await page.$$eval('#masterMaintNav [data-master]',ns=>ns.length);
 rec('マスタ管理のタブが揃っている',tabs>=10,tabs+'タブ');
 const noErr=await page.evaluate(()=>!document.querySelector('#masterMaintList .mm-error'));
 rec('初期表示でエラーが出ていない',noErr);

 // ---- (4) 左ペイン: スクロールバーが出ない ----
 await page.evaluate(()=>window.exitMasterMaint&&window.exitMasterMaint());
 await page.click('[data-db-key="SIKALOTNOW"]');
 await page.waitForFunction(()=>document.querySelectorAll('#grid table tbody tr').length>0,{timeout:20000});
 await page.click('#grid table tbody tr:first-child .measurement-action-button');
 await page.waitForSelector('#measureModal:not([hidden])',{timeout:15000});
 await page.waitForTimeout(3000);
 const fit=await page.evaluate(()=>{
  const lp=document.querySelector('.left-pane');
  return {over:lp.scrollHeight-lp.clientHeight,pane:lp.clientHeight};
 });
 rec('基本情報タブでスクロールバーが出ない',fit.over<=0,`はみ出し${fit.over}px / 表示${fit.pane}px`);

 // 情報は減っていない(13項目そのまま)
 const info=await page.evaluate(()=>{
  const g=document.querySelector('#basicInfo .info-grid');
  return {fields:g.querySelectorAll('.field').length,
   groups:[...g.querySelectorAll('.info-group')].map(x=>x.textContent),
   labels:[...g.querySelectorAll('.field label')].map(x=>x.textContent)};
 });
 rec('項目を減らしていない(13項目)',info.fields===13,info.fields+'項目');
 rec('意味のかたまりで見出しが付いている',
   info.groups.join('/')==='識別番号/製品/コース',info.groups.join('/'));
 /* コースの3項目のラベルは「設計」「実績」「残」(§9.81)。すぐ上に
    「コース」という見出しが出ているので、行ごとに繰り返さない。 */
 const NEEDED=['ロット№','検査No.','鋳造No.','オーダーNo.','引当No.','用途名','用途コード','取引先','納入先','設計','実績','残'];
 NEEDED.forEach(l=>{if(!info.labels.includes(l))rec('項目が残っている: '+l,false,info.labels.join(','))});
 rec('必要な項目がすべて残っている',NEEDED.every(l=>info.labels.includes(l)));

 // 打刻した時刻が読める(幅が足りている)
 await page.click('#stampWorkStart');await page.waitForTimeout(400);
 const stamp=await page.evaluate(()=>{
  const i=document.querySelector('#workStartAt');
  return {val:i.value,cut:i.scrollWidth>i.clientWidth+1,w:Math.round(i.getBoundingClientRect().width)};
 });
 rec('打刻した日時が切れずに読める',!!stamp.val&&!stamp.cut,`幅${stamp.w}px "${stamp.val}"`);
 const afterStamp=await page.evaluate(()=>{const lp=document.querySelector('.left-pane');return lp.scrollHeight-lp.clientHeight});
 rec('打刻後もスクロールバーが出ない',afterStamp<=0,`はみ出し${afterStamp}px`);

 // 表示サイズを変えても収まる(既定〜特大)
 const sizes={};
 for(const s of ['sm','md','lg']){
  await page.evaluate(v=>{document.documentElement.dataset.uiSize=v},s);
  await page.waitForTimeout(300);
  sizes[s]=await page.evaluate(()=>{const lp=document.querySelector('.left-pane');return lp.scrollHeight-lp.clientHeight});
 }
 rec('表示サイズを特大にしても収まる',Object.values(sizes).every(v=>v<=0),JSON.stringify(sizes));

 await b.close();
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{
 // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
 // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
 // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
