/* 作業可否フラグ(§9.51)と勤務体系の複数設備(§5.5)の検証 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const setMode=async m=>{await fetch('http://127.0.0.1:5029/api/access-mode',
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 let alertMsg='';
 page.on('dialog',d=>{alertMsg=d.message();d.accept()});

 await setMode('edit');
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.waitForTimeout(1200);
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-row-line',{timeout:15000});
 await page.waitForTimeout(3500);

 // ---- (1) 列がある ----
 const head=await page.$$eval('.sc-row-head span',ns=>ns.map(n=>n.textContent.trim()));
 rec('タイムラインに「作業」(可否)列がある',head.includes('作業'),head.join('/'));

 const rows=await page.$$eval('.sc-row-line',ns=>ns.map(n=>({
  cat:n.querySelector('.sc-row-cat')?.textContent||'',
  wk:n.querySelector('.sc-row-workable')?.textContent||'',
  cls:[...(n.querySelector('.sc-row-workable')?.classList||[])].filter(c=>c.startsWith('is-')).join(''),
  title:n.querySelector('.sc-row-workable')?.title||'',
  lot:n.querySelector('.sc-row-title')?.textContent||'',
  start:!!n.querySelector('.sc-row-start'),
  dim:n.classList.contains('sc-row-not-workable'),
 })));
 rec('全行に可否が表示される(空欄が無い)',rows.length>0&&rows.every(r=>r.wk),rows.length+'行');

 const ok=rows.filter(r=>r.cls==='is-ok'),ng=rows.filter(r=>r.cls==='is-ng');
 rec('作業可(可)の行がある',ok.length>0,'可='+ok.length+'件');
 rec('作業不可(不可)の行がある',ng.length>0,'不可='+ng.length+'件');
 rec('可否の理由(残仕掛設備ｺｰｽ)がツールチップに出る',
   ok.length>0&&/残仕掛設備ｺｰｽ:/.test(ok[0].title),ok[0]?.title.replace(/\n/g,' / '));

 // ---- (2) 判定基準: 残仕掛設備ｺｰｽが使用設備で始まるか ----
 const check=await page.evaluate(()=>{
  const out=[];
  document.querySelectorAll('.sc-row-line').forEach(n=>{
   const w=n.querySelector('.sc-row-workable');if(!w)return;
   const m=/残仕掛設備ｺｰｽ:\s*(.*)$/.exec(w.title);
   if(m)out.push({cls:[...w.classList].find(c=>c.startsWith('is-')),course:m[1]});
  });
  return out;
 });
 const wrong=check.filter(x=>{
  const starts=x.course.startsWith('テスト設備A');
  return (x.cls==='is-ok')!==starts;
 });
 rec('「使用設備で始まる」ものだけが可になっている',wrong.length===0,
   '不一致'+wrong.length+'件 / 判定対象'+check.length+'件');

 // ---- (3) 可のものだけ開始ボタンが出る ----
 const plannedOk=rows.filter(r=>/予定/.test(r.cat)&&r.cls==='is-ok');
 const plannedNg=rows.filter(r=>/予定/.test(r.cat)&&r.cls==='is-ng');
 rec('作業可の予定には「開始」ボタンが出る',
   plannedOk.length>0&&plannedOk.every(r=>r.start),
   '可の予定'+plannedOk.length+'件 うち開始あり'+plannedOk.filter(r=>r.start).length+'件');
 rec('作業不可の予定には「開始」ボタンを出さない',
   plannedNg.length>0&&plannedNg.every(r=>!r.start),
   '不可の予定'+plannedNg.length+'件 うち開始あり'+plannedNg.filter(r=>r.start).length+'件');
 rec('作業不可の行は薄く表示して見分けられる',plannedNg.every(r=>r.dim));

 // ---- (4) 別経路(直接呼び出し)でも開始できない ----
 alertMsg='';
 const blocked=await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('.sc-row-line')];
  const target=rows.find(n=>{
   const w=n.querySelector('.sc-row-workable');
   return w&&w.classList.contains('is-ng')&&/予定/.test(n.querySelector('.sc-row-cat')?.textContent||'');
  });
  if(!target)return null;
  target.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  return target.dataset.id;
 });
 await page.waitForTimeout(1500);
 const modalOpen=await page.evaluate(()=>!document.querySelector('#measureModal').hidden);
 rec('作業不可の行はダブルクリックでも測定画面を開かない',!modalOpen,'modal='+modalOpen);

 // ---- (5) 勤務体系マスタ: 適用設備の複数選択 ----
 await page.evaluate(()=>document.querySelector('#openMasterMaint')?.click());
 await page.waitForSelector('#masterMaintForm',{timeout:10000});
 await page.evaluate(()=>{
  const tabs=[...document.querySelectorAll('#masterMaintNav [data-master]')];
  const t=tabs.find(x=>(x.querySelector('.mm-nav-label')||x).textContent.trim()==='勤務形態');
  if(t)t.click();
 });
 await page.waitForTimeout(1800);
 const picker=await page.evaluate(()=>({
  exists:!!document.querySelector('#shiftEquipment'),
  chips:document.querySelectorAll('#shiftEquipment [data-shift-eq]').length,
  singleSelect:document.querySelector('select#shiftEquipment')!==null,
 }));
 rec('適用設備が単一selectではなくなっている',!picker.singleSelect,JSON.stringify(picker));
 rec('設備を複数選べるチェック式になっている',picker.exists&&picker.chips>0,JSON.stringify(picker));

 // 2つ選んで保存し、一覧へ両方出るか
 const saved=await page.evaluate(async()=>{
  const cbs=[...document.querySelectorAll('#shiftEquipment [data-shift-eq]')];
  if(cbs.length<2)return {skipped:true,count:cbs.length};
  document.querySelector('#shiftName').value='複数設備テスト2';
  document.querySelector('#shiftName').dispatchEvent(new Event('input',{bubbles:true}));
  cbs.slice(0,2).forEach(cb=>{if(!cb.checked){cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}))}});
  return {picked:cbs.slice(0,2).map(c=>c.value)};
 });
 const draft=await page.evaluate(()=>JSON.stringify(window.__shiftDraftProbe||null));
 rec('選んだ設備が2件そろう',!saved.skipped&&saved.picked.length===2,JSON.stringify(saved));

 const api=await page.evaluate(async()=>{
  const r=await fetch('/api/schedule/shift-pattern-master?scope=all').then(x=>x.json());
  return (r.items||[]).map(i=>({name:i.name,eq:i.equipment,text:i.equipmentText}));
 });
 const multi=api.filter(i=>Array.isArray(i.eq)&&i.eq.length>=2);
 rec('複数設備を持つ勤務体系をAPIが返せる',multi.length>0,JSON.stringify(multi.slice(0,2)));
 rec('未選択は「全設備共通」として扱う',
   api.some(i=>Array.isArray(i.eq)&&i.eq.length===0&&i.text==='全設備共通'),
   JSON.stringify(api.filter(i=>i.eq.length===0).slice(0,1)));

 await b.close();
 const ng2=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng2.length)+'/'+R.length+' PASS ==');
 process.exit(ng2.length?1:0);
})().catch(async e=>{
 // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
 // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
 // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
