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
 await W.nav(page,'#openDashboard');
 await W.until(page,()=>!!document.querySelector('#dashGrid .dash-p'),null,{ms:20000,what:'ダッシュボードが開く'});
 await idle();
 const head=await page.evaluate(()=>{
  // パネル側は画面名も見出しバーも持たない(ヘッダーの#fileNameと
  // #headerViewBarが担う)。以前はダッシュボード/実績カレンダー/マスタ管理が
  // 同じ名前を二重に出し、さらに操作だけの帯が1本残って本文の高さを食っていた。
  const screenName=document.querySelector('#fileName')?.textContent?.trim()||'';
  const dup=[...document.querySelectorAll('#dashScreen h1,#dashScreen h2,#dashScreen h3')]
   .map(x=>x.textContent.trim()).filter(t=>t===screenName);
  const bar=document.getElementById('headerViewBar');
  return {screenName,dup,mounted:bar?bar.children.length:-1,tools:!!(bar&&bar.querySelector('#dashBar'))};
 });
 rec('画面の操作はヘッダーの操作列へ載る',head.mounted===1&&head.tools,JSON.stringify(head));
 rec('パネル側がヘッダーの画面名を繰り返さない',head.dup.length===0,JSON.stringify(head));

 // ---- §9.64 ダッシュボード（§9.628 でグリッドのパネルへ移した。前の3つの表示は組み込みのダッシュボード） ----
 /* 既定は「生産の状況」（§9.630 ④。前は稼働状況・§9.64）。稼働状況は2つ目の組み込みとして残る——開いて中身を見る */
 const defName=await page.evaluate(()=>(document.querySelector('#dashBar .dash-pick b')||{}).textContent||'');
 rec('ダッシュボードは既定で「生産の状況」を表示する（§9.630）',defName==='生産の状況',defName);
 await page.evaluate(()=>WL.dashboard._open('b:status'));
 await W.until(page,()=>WL.dashboard._state().id==='b:status'&&document.querySelectorAll('#dashGrid .dash-p[data-id="board"] tbody tr').length>0,null,{ms:20000,what:'稼働状況の表が出る'});
 const dash=await page.evaluate(()=>({
  name:(document.querySelector('#dashBar .dash-pick b')||{}).textContent||'',
  kpi:document.querySelectorAll('#dashGrid .dash-p .dp-kpi').length,
  equipRows:document.querySelectorAll('#dashGrid .dash-p[data-id="board"] tbody tr').length,
 }));
 rec('組み込み「稼働状況」を開ける',dash.name==='稼働状況',JSON.stringify(dash));
 rec('稼働状況にKPIが4枚出る',dash.kpi===4,dash.kpi+'枚');
 rec('作業予定から設備ごとの状況が出る',dash.equipRows>0,dash.equipRows+'行');
 const built=await page.evaluate(async()=>(await (await fetch('/api/dashboards')).json()).items.filter(x=>x.builtin));
 const ana=built.find(x=>x.id==='b:analysis');
 rec('自由集計のよく使う組み合わせ4つは「作業時間の分析」に残っている',!!ana&&ana.body.panels.length===4,
   JSON.stringify(ana?ana.body.panels.map(x=>x.title):null));
 // 自由な組み合わせはパネルを組み直して作る（編集の入口が道具の行にある）
 const edit=await page.evaluate(()=>{const e=document.querySelector('#dashBar [data-db-editmode]');
   if(!e)return null;const cs=getComputedStyle(e);return {h:Math.round(e.getBoundingClientRect().height),bg:cs.backgroundColor,text:e.textContent.trim()}});
 rec('自由に組む入口（編集）がヘッダーの操作列にある',!!edit&&edit.h>20&&edit.bg!=='rgba(0, 0, 0, 0)',JSON.stringify(edit));

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
