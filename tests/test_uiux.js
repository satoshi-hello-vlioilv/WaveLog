/* §9.59 hidden / §9.62 折りたたみ / §9.63 パネル見出し /
   §9.64 ダッシュボード稼働状況 / §9.65 ボタンの基本作法 の検証 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(B+'/api/access-mode',{method:'POST',
 headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
let b=null;
(async()=>{
 await setMode('edit');
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.evaluate(()=>{localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A');
   localStorage.setItem('scSplitListCollapsedV1','0')});
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForTimeout(2500);

 // ---- §9.65 ボタンの基本作法 ----
 const base=await page.evaluate(()=>{
  const probe=document.createElement('button');probe.textContent='x';
  document.body.appendChild(probe);
  const cs=getComputedStyle(probe);const cur=cs.cursor;
  probe.disabled=true;const dis=getComputedStyle(probe);
  const r={cursor:cur,disCursor:dis.cursor,disOpacity:+dis.opacity};
  probe.remove();return r;
 });
 rec('押せるボタンはpointerになる',base.cursor==='pointer',base.cursor);
 rec('押せないボタンはnot-allowed+減光',base.disCursor==='not-allowed'&&base.disOpacity<1,JSON.stringify(base));
 const pressRule=await page.evaluate(()=>{
  for(const sh of document.styleSheets){let l;try{l=sh.cssRules}catch(e){continue}
   for(const r of l){if(r.selectorText&&/^button.*:active/.test(r.selectorText)&&/filter/.test(r.style.cssText))return r.selectorText}}
  return '';
 });
 rec('押した瞬間の見た目変化が全ボタン共通で定義されている',!!pressRule,pressRule);
 rec('押下フィードバックはtransformを使わない(配置を壊さないため)',
   !/transform/.test(await page.evaluate(()=>{
     for(const sh of document.styleSheets){let l;try{l=sh.cssRules}catch(e){continue}
      for(const r of l){if(r.selectorText&&/^button.*:active/.test(r.selectorText))return r.style.cssText}}
     return '';})));
 // 左ナビが押せる形に見える(実測でpointerが無かった箇所)
 const navCur=await page.evaluate(()=>getComputedStyle(document.querySelector('#openSchedule')).cursor);
 rec('左ナビが押せる形に見える',navCur==='pointer',navCur);

 // 一覧のページ送りは1ページ目で押せないと分かる
 await page.click('[data-db-key="SIKALOTNOW"]');await page.waitForTimeout(2500);
 const prev=await page.evaluate(()=>{const e=document.querySelector('#prev');
   const cs=getComputedStyle(e);return {dis:e.disabled,cur:cs.cursor,op:+cs.opacity,title:e.title}});
 rec('1ページ目の「前へ」は押せないと見た目で分かる',
   prev.dis&&prev.cur==='not-allowed'&&prev.op<1,JSON.stringify(prev));
 rec('ページ送りに説明が付いている',!!prev.title,prev.title);

 // ---- §9.63 パネル見出し ----
 await page.click('#openDashboard');await page.waitForTimeout(3000);
 const head=await page.evaluate(()=>{
  const h=document.querySelector('#dashboardPanel .rp-head');const cs=getComputedStyle(h);
  const h2=getComputedStyle(h.querySelector('h2'));
  return {bg:cs.backgroundColor,pad:cs.paddingTop,margin:h2.marginTop,color:h2.color};
 });
 rec('パネル見出しに様式が当たっている(素の見出しではない)',
   head.bg!=='rgba(0, 0, 0, 0)'&&head.margin==='0px',JSON.stringify(head));

 // ---- §9.64 ダッシュボード ----
 const dash=await page.evaluate(()=>({
  statusVisible:!document.querySelector('#dbStatusView').hidden,
  pivotHidden:document.querySelector('#dbPivotView').hidden,
  kpi:document.querySelectorAll('#dbStatusKpi .db-card').length,
  equipRows:document.querySelectorAll('#dbEquipStatus tbody tr').length,
  activeTab:document.querySelector('[data-dbview].active')?.dataset.dbview,
 }));
 rec('ダッシュボードは既定で稼働状況を表示する',
   dash.statusVisible&&dash.pivotHidden&&dash.activeTab==='status',JSON.stringify(dash));
 rec('稼働状況にKPIが4枚出る',dash.kpi===4,dash.kpi+'枚');
 rec('作業予定から設備ごとの状況が出る',dash.equipRows>0,dash.equipRows+'行');
 await page.click('[data-dbview="pivot"]');await page.waitForTimeout(2000);
 const pivot=await page.evaluate(()=>({
  pivotVisible:!document.querySelector('#dbPivotView').hidden,
  presets:document.querySelectorAll('[data-preset]').length,
  axis:document.querySelector('#dbAxis')?.value,
  period:document.querySelector('#dbStart')?.value,
 }));
 rec('自由集計は従来機能のまま残っている',
   pivot.pivotVisible&&pivot.presets===4&&!!pivot.axis&&!!pivot.period,JSON.stringify(pivot));
 // 自由集計タブを開いた状態でボタンの寸法を測る(隠れている間は箱が無い)
 const btn=await page.evaluate(()=>{const e=document.querySelector('#dbRefresh');
   const cs=getComputedStyle(e);return {h:Math.round(e.getBoundingClientRect().height),bg:cs.backgroundColor}});
 rec('rp-btn-primaryに様式が当たっている',btn.h>20&&btn.bg!=='rgba(0, 0, 0, 0)',JSON.stringify(btn));
 await page.click('[data-dbview="status"]');await page.waitForTimeout(1200);
 rec('稼働状況へ戻れる',await page.evaluate(()=>!document.querySelector('#dbStatusView').hidden));

 // ---- §9.62 スケジュールの折りたたみ ----
 await setMode('schedule');
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.waitForTimeout(1500);
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-board-row',{timeout:15000});
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await page.waitForSelector('.sc-row-line',{timeout:15000});
 await page.waitForTimeout(1500);
 const openW=await page.evaluate(()=>Math.round(document.querySelector('#grid').getBoundingClientRect().width));
 await page.click('.sc-split-collapse-btn');await page.waitForTimeout(700);
 const folded=await page.evaluate(()=>{
  const ids=['genericFilterBar','listToolbar','grid'];
  return {shown:ids.filter(i=>{const e=document.getElementById(i);return e&&getComputedStyle(e).display!=='none'}),
          label:document.querySelector('.sc-split-collapse-label')?.textContent||'',
          divider:Math.round(document.querySelector('.sc-split-divider').getBoundingClientRect().width),
          expanded:document.querySelector('.sc-split-collapse-btn').getAttribute('aria-expanded')};
 });
 rec('畳むと仕掛一覧の中身が完全に消える(破片が残らない)',
   folded.shown.length===0,JSON.stringify(folded.shown));
 rec('畳んだ状態でも何が畳まれているか分かる',folded.label==='仕掛一覧',folded.label);
 rec('取っ手は掴める太さがある',folded.divider>=20,folded.divider+'px');
 rec('開閉状態が支援技術へ伝わる',folded.expanded==='false',folded.expanded);
 await page.click('.sc-split-collapse-btn');await page.waitForTimeout(700);
 const back=await page.evaluate(()=>Math.round(document.querySelector('#grid').getBoundingClientRect().width));
 rec('開き直すと元に戻る',Math.abs(back-openW)<=2,`${openW}px → ${back}px`);

 // ---- §9.59 hidden ----
 const badHidden=await page.evaluate(()=>[...document.querySelectorAll('[hidden]')]
   .filter(e=>getComputedStyle(e).display!=='none').length);
 rec('hidden属性が効いていない要素が無い',badHidden===0,badHidden+'件');

 await setMode('edit');
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
