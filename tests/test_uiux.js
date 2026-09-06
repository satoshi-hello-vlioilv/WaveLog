/* §9.59 hidden / §9.62 折りたたみ / §9.63 パネル見出し /
   §9.64 ダッシュボード稼働状況 / §9.65 ボタンの基本作法 の検証 */
/* 待ちは「時間」ではなく「条件」（§9.102・3-15 ③・§9.347）。骨組み
   （起動・rec・pageerror・素のダイアログ・集計・閉じる）は tests/lib/harness.js。
   置き換え前後で全PASS行（測った値ごと）を突き合わせてある。 */
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
run('test_uiux: §9.59〜§9.65 の作法',async({page,rec,setMode,W,idle,paint})=>{
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 /* ---- 初回案内は1箇所（§9.343、画面基準8「同じ情報を2箇所に出さない」） ----
    **使用設備を入れる前に見る**。ここから下は設定済みの画面なので、
    未設定のときの見え方を確かめられるのはこの一瞬だけ。
    以前は帯と表の中が**まったく同じ見出し**（「最初に使用設備を設定して
    ください」）を出し、しかも表の中の本文が「上の『使用設備を設定』から」
    と帯を指していた——読む側は2回読んで、同じことだと確かめる。 */
 await page.waitForSelector('.setup-first',{timeout:15000});
 const first=await page.evaluate(()=>{
  const t=n=>n?n.innerText.replace(/\s+/g,' ').trim():'';
  const band=document.getElementById('equipmentSetupBanner');
  return {帯:t(band),帯見える:!!(band&&band.offsetParent),表:t(document.querySelector('.setup-first'))};
 });
 rec('使用設備が未設定なら帯が出て、次にすることを指す',
     first.帯見える&&/最初に使用設備を設定してください/.test(first.帯),first.帯.slice(0,60));
 rec('同じ見出しを表の中で繰り返さない',
     !/最初に使用設備を設定してください/.test(first.表),first.表);
 rec('表の中は「この場所に何が出るか」だけを言う（帯を指し返さない）',
     /ここに仕掛一覧が出ます/.test(first.表)&&!/上の/.test(first.表),first.表);

 await page.evaluate(()=>{localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A');
   localStorage.setItem('scSplitListCollapsedV1','0')});
 await page.reload({waitUntil:'domcontentloaded'});
 await W.booted(page);await idle();

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
 /* CSSは@layerで包んであるので、ルールは入れ子になっている。
    最上位だけ舐めると見つからない(VER1.83.0でここが落ちた)。 */
 const pressRule=await page.evaluate(()=>{
  const hit=rules=>{
   for(const r of rules){
    if(r.selectorText&&/^button.*:active/.test(r.selectorText)&&/filter/.test(r.style.cssText))return r.selectorText;
    if(r.cssRules){const d=hit(r.cssRules);if(d)return d}
   }
   return '';
  };
  for(const sh of document.styleSheets){let l;try{l=sh.cssRules}catch(e){continue}
   const d=hit(l);if(d)return d}
  return '';
 });
 rec('押した瞬間の見た目変化が全ボタン共通で定義されている',!!pressRule,pressRule);
 rec('押下フィードバックはtransformを使わない(配置を壊さないため)',
   !/transform/.test(await page.evaluate(()=>{
     const hit=rules=>{
      for(const r of rules){
       if(r.selectorText&&/^button.*:active/.test(r.selectorText))return r.style.cssText;
       if(r.cssRules){const d=hit(r.cssRules);if(d)return d}
      }
      return '';
     };
     for(const sh of document.styleSheets){let l;try{l=sh.cssRules}catch(e){continue}
      const d=hit(l);if(d)return d}
     return '';})));
 // 左ナビが押せる形に見える(実測でpointerが無かった箇所)
 const navCur=await page.evaluate(()=>getComputedStyle(document.querySelector('#openSchedule')).cursor);
 rec('左ナビが押せる形に見える',navCur==='pointer',navCur);

 /* 一覧のページ送りは1ページ目で押せないと分かる。
    §9.286 ②: 置き場は画面下の`<footer>`から**一覧ツールバー**へ移した
    （分割表示ではfooterが`display:none`で、ページを繰る手立てが無かった）。 */
 await page.click('[data-db-key="SIKALOTNOW"]');await idle();
 await page.waitForSelector('#listToolbar #prev',{timeout:10000});
 const prev=await page.evaluate(()=>{const e=document.querySelector('#prev');
   const cs=getComputedStyle(e);return {dis:e.disabled,cur:cs.cursor,op:+cs.opacity,title:e.title}});
 rec('1ページ目の「前へ」は押せないと見た目で分かる',
   prev.dis&&prev.cur==='not-allowed'&&prev.op<1,JSON.stringify(prev));
 rec('ページ送りに説明が付いている',!!prev.title,prev.title);

 // ---- §9.63 パネル見出し ----
 await page.click('#openDashboard');await idle(400,15000);
 const head=await page.evaluate(()=>{
  // パネル側は画面名も見出しバーも持たない(ヘッダーの#fileNameと
  // #headerViewBarが担う)。以前はダッシュボード/実績カレンダー/マスタ管理が
  // 同じ名前を二重に出し、さらに操作だけの帯が1本残って本文の高さを食っていた。
  const screenName=document.querySelector('#fileName')?.textContent?.trim()||'';
  const dup=[...document.querySelectorAll('#dashboardPanel h1,#dashboardPanel h2,#dashboardPanel h3')]
   .map(x=>x.textContent.trim()).filter(t=>t===screenName);
  const bar=document.getElementById('headerViewBar');
  return {screenName,dup,
          panelHead:!!document.querySelector('#dashboardPanel .rp-head'),
          mounted:bar?bar.children.length:-1,
          tabs:bar?bar.querySelectorAll('[data-dbview]').length:0};
 });
 rec('パネル側に操作だけの見出しバーを残さない',!head.panelHead,JSON.stringify(head));
 rec('画面の操作はヘッダーの操作列へ載る',head.mounted===1&&head.tabs===3,JSON.stringify(head));
 rec('パネル側がヘッダーの画面名を繰り返さない',head.dup.length===0,JSON.stringify(head));

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
 await page.click('[data-dbview="pivot"]');await idle(400,15000);
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
 await page.click('[data-dbview="status"]');await idle(400,15000);
 rec('稼働状況へ戻れる',await page.evaluate(()=>!document.querySelector('#dbStatusView').hidden));

 // ---- §9.62 スケジュールの折りたたみ ----
 await setMode('schedule');
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await W.booted(page);
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-board-row',{timeout:15000});
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await page.waitForSelector('.sc-row-line',{timeout:15000});
 await W.settleFlags(page);await paint();
 const openW=await page.evaluate(()=>Math.round(document.querySelector('#grid').getBoundingClientRect().width));
 await page.click('.sc-split-collapse-btn');await paint();
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
 await page.click('.sc-split-collapse-btn');await paint();
 const back=await page.evaluate(()=>Math.round(document.querySelector('#grid').getBoundingClientRect().width));
 rec('開き直すと元に戻る',Math.abs(back-openW)<=2,`${openW}px → ${back}px`);

 // ---- §9.59 hidden ----
 const badHidden=await page.evaluate(()=>[...document.querySelectorAll('[hidden]')]
   .filter(e=>getComputedStyle(e).display!=='none').length);
 rec('hidden属性が効いていない要素が無い',badHidden===0,badHidden+'件');

 await setMode('edit');
},{mode:'edit'});
