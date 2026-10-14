/* §9.68 パス設定を設定ページ形式へ / データ引継ぎの「現状→実行後」可視化 */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
/* 材料は自分で注ぎ込む（§9.351・§9.362 ⑥）。この網は「取り込める記録が
   ある」ことを前提にするが、**フィクスチャに記録は無い**——今まで見えて
   いたのは前の実行の置き土産で、ランナーが実績を1本ごとに空へ戻すように
   なった（§9.362 ①）とたんに0行になった。片付けは`clearRecords()`。 */
const {seedRecord,clearRecords}=require('./lib/harness.js');
const setMode=async m=>{await fetch(B+'/api/access-mode',{method:'POST',
 headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
run('test_setpage: §9.68 パス設定を設定ページ形式へ / データ引継ぎの「現状→実行後」可視化', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 await setMode('edit');
 await seedRecord();
 const tab=async label=>{await page.evaluate(l=>{const t=[...document.querySelectorAll('#masterMaintNav [data-master]')]
   .find(x=>x.textContent.includes(l));if(t)t.click()},label);await idle(400,10000)};
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openMasterMaint',{timeout:15000});
 await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 await page.reload({waitUntil:'domcontentloaded'});await W.booted(page);await idle();
 await page.click('#openMasterMaint');
 await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:10000});await idle();

 // ---------- 共通設定（§9.583でゼロから組み直した。旧「パス設定」・§9.168でデータソースぶんを分離） ----------
 await tab('共通設定');
 await W.until(page,()=>document.querySelectorAll('#masterMaintForm .pc-store-row').length>0,null,{ms:15000,what:'置き場の行が描かれる'});
 await idle();
 const NAMES=['この端末','置き場','共有と同期','RNE抽出','アプリの更新'];
 const p=await page.evaluate(()=>{
  const sc=document.querySelector('.pc-page>.mm-tabbody');
  const panel=document.querySelector('#masterMaintPanel').getBoundingClientRect();
  const sr=document.querySelector('#pcSave button[type=submit]').getBoundingClientRect();
  const scr=sc.getBoundingClientRect();
  /* **いま開いている段の中だけを測る**（§9.261）。畳んだ段の欄は寸法を持たないので「見切れ」に数えない。 */
  const clipped=[...sc.querySelectorAll('input,select')].filter(e=>{
   if(!e.offsetParent)return false;
   const r=e.getBoundingClientRect();
   return r.height<8||r.right>scr.right+1;
  }).length;
  const tabs=[...document.querySelectorAll('.mm-tabbar.is-page .mm-tab')];
  return {scrollH:sc.scrollHeight,clientH:sc.clientHeight,
    saveInsidePanel:sr.bottom<=panel.bottom+1&&sr.top>=panel.top,
    /* **置き場の行の中の欄は数えない**（§9.267）——あれは「置き場」の1枚に並ぶ行。 */
    fields:[...document.querySelectorAll('[data-pc-field]')].filter(e=>!e.closest('.pc-store-row')).map(e=>e.dataset.pcField),
    storeRows:document.querySelectorAll('.pc-store-row').length,
    clipped,listWrap:getComputedStyle(document.querySelector('.mm-list-wrap')).display,
    names:tabs.map(t=>(t.querySelector('.mm-fieldgroup')||{}).textContent||''),
    icons:tabs.filter(t=>t.querySelector('.mm-tab-icon')).length,
    sums:tabs.map(t=>(t.querySelector('.mm-tab-sum')||{}).textContent.trim()),
    /* §9.598 1h: 札は左の一覧。副題（何の段か）・状態の札（OK・要対応 N・停止中…）・いまの一言は札の title。 */
    rail:!!document.querySelector('.pc-page>.mm-tabbar.is-page.is-rail'),
    states:tabs.map(t=>{const b=t.querySelector('.mm-tab-badge');return b&&!b.hidden?b.textContent.trim():''}),
    titles:tabs.map(t=>t.title||''),
    shownPanels:[...document.querySelectorAll('.mm-tabpanel.is-page')].filter(x=>!x.hidden).length,
    /* 段の名前を中でもう一度見出しで言わない（§9.583・§CLAUDE 8） */
    rep:[...document.querySelectorAll('#masterMaintForm h3,#masterMaintForm h4,#masterMaintForm h5')]
      .map(h=>h.textContent.trim()).filter(t=>tabs.some(x=>(x.querySelector('.mm-fieldgroup')||{}).textContent===t)),
    oldMap:!!document.querySelector('.pc-map,.pc-rail,.mm-set-group')};
 });
 rec('段は5つ（この端末・置き場・共有と同期・RNE抽出・アプリの更新）',
     JSON.stringify(p.names)===JSON.stringify(NAMES),p.names.join('／'));
 /* **札が状態を言う**（§9.583 ①、利用者の報告「タブがわかりにくい」）——絵・名前・いまの一言。 */
 rec('札は左の一覧で、絵・名前・副題（何の段か）を持つ（§9.598 1h）',
     p.rail&&p.icons===5&&p.sums.every(s=>s.length>0),JSON.stringify(p.sums));
 rec('札は状態を字で言い（OK・要対応 N・停止中…）、いまの一言は札の title が持つ（開かずに状態が読める）',
     p.states.every(s=>s.length>0)&&p.titles.every(s=>s.length>0),JSON.stringify({states:p.states,titles:p.titles}));
 rec('開いている段は1つだけ',p.shownPanels===1,`${p.shownPanels}段`);
 rec('上の図・章のレール・段の名前の見出しの繰り返しは無い（主役の場所を空ける）',
     !p.oldMap&&p.rep.length===0,JSON.stringify({旧:p.oldMap,繰り返し:p.rep}));
 /* 1つの段は器に収まる（段に分けた値打ちはここ）。 */
 rec('最初の段は器に収まる（長いスクロールにならない）',p.scrollH<=p.clientH+2,`中身${p.scrollH}px / 器${p.clientH}px`);
 /* 件数ではなく**キーの一覧**で見る（項目は増える）。**データソースごとの読み込み先はここに無い**（§9.168）。
    **置き場（作業予定・測定データ・複製先・マスタ）は「置き場」の段の行が持つ**（§9.267）。 */
 const WANT=['pc_name','sikalot_source','db_mirror_update','db_mirror_interval_sec',
   'schedule_watch_enabled','schedule_owner_enabled','schedule_session_block','schedule_source_sync',
   'rne_extract_enabled','rne_extract_interval_sec','rne_assets_dir','rne_conf_path',
   'schedule_lock_ttl_sec','schedule_lock_verify_delay_ms','update_dir'];
 const MOVED=['records_backup_export_path','records_share_dir','schedule_share_path'];
 const missing=WANT.filter(k=>!p.fields.includes(k));
 rec('よそへ移した設定をここに残さない',MOVED.every(k=>!p.fields.includes(k)),
     MOVED.filter(k=>p.fields.includes(k)).join(',')||'なし');
 rec('設定項目が漏れなく出ている',missing.length===0,missing.length?`不足: ${missing.join(',')}`:`${p.fields.length}件`);
 rec('同じ設定の欄を2つ置かない',new Set(p.fields).size===p.fields.length,p.fields.join(','));
 rec('入力欄が枠外へ切れていない',p.clipped===0,p.clipped+'件が見切れ');
 const dup=p.fields.filter(k=>/_path$/.test(k)&&!['rne_conf_path'].includes(k));
 rec('データソースごとの読み込み先の欄は共通設定に無い',dup.length===0,dup.join(','));
 /* **起動アイコンの盤はここに無い**（§9.445）。ここに残るのは**いまの状態と行き先**だけ。 */
 const sc=await page.evaluate(()=>({
   欄:[...document.querySelectorAll('[data-pc-field]')].map(e=>e.dataset.pcField).filter(k=>/^shortcut_/.test(k)),
   状態:!!document.querySelector('#pcShortcut [data-sc-state]'),
   行き先:!!document.getElementById('pcScOpen'),
   作る:!!document.getElementById('lnkMake')}));
 rec('起動アイコンの名前・絵の欄は共通設定に無い（盤は「表示」の1箇所）',sc.欄.length===0&&!sc.作る,sc.欄.join(',')||'なし');
 rec('共通設定にはいまの状態と行き先が残る（探させない）',sc.状態&&sc.行き先,`状態${sc.状態} 行き先${sc.行き先}`);
 rec('保存ボタンが常にパネル内に見えている',p.saveInsidePanel);
 rec('設定ページでは下段の一覧枠を畳む',p.listWrap==='none',p.listWrap);
 /* ---- 段ごと: 器に収まるか・札は動かないか・保存の帯は動かないか ---- */
 const per=[];
 for(const n of NAMES){
  const r=await page.evaluate(async n=>{
   const t=[...document.querySelectorAll('.mm-tabbar.is-page .mm-tab')].find(x=>(x.querySelector('.mm-fieldgroup')||{}).textContent===n);
   t.click();
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const sc=document.querySelector('.pc-page>.mm-tabbody');
   const bar0=document.querySelector('.mm-tabbar.is-page').getBoundingClientRect().top;
   sc.scrollTop=sc.scrollHeight;
   await new Promise(r=>requestAnimationFrame(r));
   const bar1=document.querySelector('.mm-tabbar.is-page').getBoundingClientRect().top;
   const panel=document.querySelector('#masterMaintPanel').getBoundingClientRect();
   const save=document.querySelector('#pcSave');
   const sr=save.querySelector('button').getBoundingClientRect();
   const open=[...document.querySelectorAll('.mm-tabpanel.is-page')].find(x=>!x.hidden);
   const last=open.lastElementChild;
   const lr=last?last.getBoundingClientRect():{bottom:0},scr=sc.getBoundingClientRect();
   sc.scrollTop=0;
   return {n,ratio:+(sc.scrollHeight/sc.clientHeight).toFixed(2),barStill:Math.abs(bar1-bar0)<1,
     save:save.hidden||(sr.bottom<=panel.bottom+1),lastVisible:lr.bottom<=scr.bottom+2,
     selected:t.getAttribute('aria-selected')==='true'};
  },n);
  per.push(r);
 }
 rec('段を切り替えると、その札が選ばれる',per.every(r=>r.selected),JSON.stringify(per.map(r=>r.n+':'+r.selected)));
 rec('段の中を送っても札は動かない（段を切り替える場所を探させない）',per.every(r=>r.barStill),JSON.stringify(per.map(r=>r.n+':'+r.barStill)));
 rec('どの段でも保存ボタンはパネル内に居る',per.every(r=>r.save),JSON.stringify(per.map(r=>r.n+':'+r.save)));
 rec('どの段でも最下部の内容まで表示できる',per.every(r=>r.lastVisible),JSON.stringify(per.map(r=>r.n+':'+r.lastVisible)));
 /* **段は器の1.1倍まで**（以前の置き場は2倍——説明の文と状態の対比で1件が4段あった）。 */
 rec('どの段も器の1.1倍に収まる（以前は置き場が2倍）',per.every(r=>r.ratio<=1.1),JSON.stringify(per.map(r=>r.n+':'+r.ratio)));
 /* ---- 説明は ⓘ へ畳む（§9.583 ②）。押すと浮いて読める（押しても何も起きない物を残さない） ---- */
 await page.evaluate(()=>[...document.querySelectorAll('.mm-tabbar.is-page .mm-tab')].find(x=>/共有と同期/.test(x.textContent)).click());
 await idle();
 const tips=await page.evaluate(()=>({n:document.querySelectorAll('#masterMaintForm [data-tip]').length,
   hints:[...document.querySelectorAll('#masterMaintForm .mm-field-hint')].filter(e=>e.offsetParent).length}));
 rec('説明の文は ⓘ に畳む（段に説明の段落を並べない）',tips.n>=10&&tips.hints===0,JSON.stringify(tips));
 await page.click('#pcSync-mirror summary .wl-tip-i');
 const tipOpen=await W.until(page,()=>{const t=document.querySelector('.wl-menu.wl-tip');return !!t&&/手元へ写して/.test(t.textContent)},null,{ms:5000,what:'ⓘ の説明が浮く'});
 rec('ⓘ を押すと説明が浮く（畳みは開け閉めしない）',tipOpen&&await page.evaluate(()=>!document.getElementById('pcSync-mirror').open));
 await page.keyboard.press('Escape');
 /* 共有と同期は1節1行の畳みで、**同時に開くのは1つ**（`<details name>`）。見出しにいまの値。 */
 const acc=await page.evaluate(async()=>{
  const a=document.querySelector('#pcSync-watch'),b=document.querySelector('#pcSync-owner');
  a.open=true;await new Promise(r=>requestAnimationFrame(r));b.open=true;await new Promise(r=>requestAnimationFrame(r));
  const r={a:a.open,b:b.open,now:[...document.querySelectorAll('.pc-sync .pc-acc-now')].map(x=>x.textContent.trim())};
  b.open=false;return r;
 });
 rec('共有と同期の節は同時に1つだけ開く',acc.a===false&&acc.b===true,JSON.stringify({a:acc.a,b:acc.b}));
 rec('畳んだ節の見出しにいまの値が出る（思い出させない）',acc.now.length>=7&&acc.now.every(x=>x.length>0),acc.now.join(' | '));
 /* ---- 再起動が要る欄（§9.208 ⑨ → §9.583）。効く時を字で言い、食い違いだけを「再起動待ち」と言う ---- */
 const rs=await page.evaluate(()=>{
  const c=document.querySelector('[data-pc-state="sikalot_source"]');
  return {txt:c?c.textContent.trim():'',title:c?c.title:'',
    pend:[...document.querySelectorAll('#masterMaintForm .pc-pending')].map(x=>(x.closest('[data-pc-row],tr')||x).textContent.trim().slice(0,30))};
 });
 rec('再起動が要る欄は効く時を字で言い、いまの値と保存値は札の説明が持つ',
     /再起動/.test(rs.txt)&&/いま効いている値/.test(rs.title)&&/保存値/.test(rs.title),JSON.stringify(rs));
 rec('値が同じ項目を「再起動待ち」と誤表示しない',rs.pend.length===0,JSON.stringify(rs.pend));
 /* PC名は**この端末の段**に出る（§9.208 ⑧）。読むだけの値に入力欄風の枠を付けない（§CLAUDE 10）。 */
 await page.evaluate(()=>document.querySelector('.mm-tab[data-tab-key="terminal"]').click());
 const who=await page.evaluate(()=>{
  const d=[...document.querySelectorAll('#pcWho>div')];
  const b=document.querySelector('#pcWho b');
  const cs=d[0]?getComputedStyle(d[0]):null;
  return {欄:d.length,PC名:b?b.textContent:'',出どころ:(document.querySelector('#pcWho small')||{}).textContent||'',
   枠:cs?parseFloat(cs.borderTopWidth):-1,名乗り直す:!!document.querySelector('[data-pc-field="pc_name"]'),
   /* ログインIDとモードはヘッダーの札が言う（§9.598 1h・同じ情報を2か所に出さない）。 */
   頭のID:((document.getElementById('mmHead')||{}).textContent||'').trim().slice(0,30),
   頭のモード:((document.getElementById('accessModeLabel')||{}).textContent||'').trim()};
 });
 rec('この端末のPC名・出どころ・名乗り直す欄がある（§9.208 ⑧）',
   who.欄===1&&!!who.PC名&&who.PC名!=='（取得できていません）'&&!!who.出どころ&&who.名乗り直す,JSON.stringify(who));
 rec('ログインIDとモードは名乗りに重ねず、ヘッダーの札が言う',!!who.頭のID&&!!who.頭のモード,JSON.stringify(who));
 rec('名乗り（読むだけ）に入力欄風の枠を付けない',who.枠===0,String(who.枠));
 /* §9.598 1h: 足元は右の詳細と同じ並び——状態と記録者＋キャンセル＋保存（変更が無いうちは押せない）。キャンセルは描いたときの値へ。 */
 const ft=await page.evaluate(()=>{
  const f=document.querySelector('#masterMaintForm'),el=f.querySelector('[data-pc-field="pc_name"]');
  const st=()=>({txt:(f.querySelector('#pcDirty')||{}).textContent||'',cancel:f.querySelector('#pcCancel').disabled,
   save:f.querySelector('#pcSave button[type=submit]').disabled});
  const s0=st(),was=el.value;
  el.value=was+'ZZ';el.dispatchEvent(new Event('input',{bubbles:true}));
  const s1=st();
  f.querySelector('#pcCancel').click();
  return {s0,s1,s2:{...st(),back:el.value===was}};
 });
 rec('足元はキャンセル＋保存（変更が無いうちは押せない）・キャンセルで描いたときの値へ戻る',
   ft.s0.cancel&&ft.s0.save&&/^変更なし・記録者/.test(ft.s0.txt)&&!ft.s1.cancel&&!ft.s1.save&&/^変更 1件/.test(ft.s1.txt)
   &&ft.s2.back&&ft.s2.cancel&&/^変更なし/.test(ft.s2.txt),JSON.stringify(ft));
 /* 起動アイコンを作れない端末（Windows 以外）は誤りではなく端末の事実——灰の字で言い、行き先は押せない形（§9.598 1h）。 */
 await W.until(page,()=>!/確認しています/.test((document.querySelector('#pcShortcut [data-sc-state]')||{}).textContent||''),null,{ms:10000,what:'起動アイコンの状態が届く'});
 const lnk=await page.evaluate(()=>{const s=document.querySelector('#pcShortcut [data-sc-state]'),b=document.getElementById('pcScOpen');
  return {cls:s?s.className:'',txt:s?s.textContent:'',hidden:b?(b.hidden||getComputedStyle(b).display==='none'):null}});
 /* §9.598 1j: 使えない機能はボタンごと消す（押せない灰のボタンを残さない）。 */
 rec('起動アイコンを作れない端末は灰の字で言い、行き先のボタンを出さない（作れる端末では出す）',
   /is-na/.test(lnk.cls)?lnk.hidden===true&&!/is-bad/.test(lnk.cls):lnk.hidden===false,JSON.stringify(lnk));

 // 他タブへ移ると設定ページ用の指定が残らない
 await tab('アクセス権限');
 const other=await page.evaluate(()=>({page:document.querySelector('#masterMaintForm').classList.contains('mm-form-page'),
   pc:!!document.querySelector('#masterMaintForm .pc-page'),
   listWrap:getComputedStyle(document.querySelector('.mm-list-wrap')).display}));
 rec('他マスタへ移ると設定ページ指定が残らない',!other.page&&!other.pc&&other.listWrap!=='none',JSON.stringify(other));
 /* **器（#masterMaintForm）は描き直しても同じ要素**（§9.522 の追補）。受け手を描くたびに付けると積み上がる。
    **2回目・3回目の描画**で見る（1回目だけでは見分けられない）——行き先1回で段の切り替えが1回、
    1字打って「変更 1件」（受け手が3重なら数え直しは同じでも、段の切り替えは3回走る）。 */
 for(const k of [2,3]){
  if(k===3)await tab('アクセス権限');
  await tab('共通設定');
  await W.until(page,()=>!!document.querySelector('#masterMaintForm [data-pc-jump="rne"]'),null,{ms:15000,what:'置き場の行（RNE資材の行き先）'});
  const w=await page.evaluate(k=>{
   const f=document.querySelector('#masterMaintForm');
   const o=f.__mmShowTab;let n=0;
   f.__mmShowTab=i=>{n++;return o(i)};
   try{document.querySelector('#masterMaintForm [data-pc-jump="rne"]').click()}finally{f.__mmShowTab=o}
   const onRne=document.querySelector('.mm-tab[data-tab-key="rne"]').getAttribute('aria-selected')==='true';
   document.querySelector('.mm-tab[data-tab-key="terminal"]').click();
   const el=f.querySelector('[data-pc-field="pc_name"]');
   const was=el.value;el.value='ZZ'+k;el.dispatchEvent(new Event('input',{bubbles:true}));
   const dirty=(f.querySelector('#pcDirty')||{}).textContent||'';
   el.value=was;el.dispatchEvent(new Event('input',{bubbles:true}));   /* 打った字は保存しない・元へ戻す */
   const clean=(f.querySelector('#pcDirty')||{}).textContent||'';
   return {走った:n,RNEの段:onRne,打った後:dirty,戻した後:clean};
  },k);
  rec(`${k}回目に描いた共通設定でも、行き先1回で段の切り替えは1回だけ（積み上がらない）`,w.走った===1&&w.RNEの段,JSON.stringify(w));
  rec(`${k}回目に描いた共通設定でも、保存の帯が変えた数を追う（押す前に何が変わるかを言う）`,
      /変更 1件/.test(w.打った後)&&/変更なし/.test(w.戻した後),JSON.stringify(w));
 }
 // ---------- データ引継ぎ（§9.68 → §9.601） ----------
 /* 「いまどうなっていて、取り込むと何が起きるか」は頭の下の帯（上書き／新しく追加／取り込めない形式）と表の札（件数）、
    選んだときの結果は足元の一言が言う。逆の結果になる「バックアップから消す」は取り込むの隣に置かず、頭の ⋯ の先。 */
 await tab('データ引継ぎ');
 await W.until(page,()=>document.querySelectorAll('#mmImpList .mm-row.mm-imp-row').length>0,null,{ms:15000,what:'取り込める記録の行'});
 const d0=await page.evaluate(()=>({
  bar:document.querySelectorAll('.mm-set-fig .mm-set-bar .mm-set-leg').length,
  tabs:[...document.querySelectorAll('#mmImpList .mm-ltab')].map(t=>t.textContent.replace(/\s+/g,'')),
  preview:(document.querySelector('#mmImpPreview')||{}).textContent||'',
  active:document.querySelector('#mmImpPreview')?.classList.contains('is-active'),
  rows:document.querySelectorAll('#mmImpList .mm-row.mm-imp-row').length,
  flow:document.querySelectorAll('#mmImpList .mm-imp-badge').length,
  head:[...document.querySelectorAll('#mmImpList .mm-row.head .mm-th')].map(s=>s.textContent).join('/'),
  run:(document.querySelector('#mmImpRun')||{}).disabled,
  delOnPage:!!document.querySelector('#mmImpDelete'),
 }));
 rec('「いまの状態」が帯と札の件数で示される',d0.bar===3&&d0.tabs.some(t=>/^すべて\d+件$/.test(t))&&d0.tabs.some(t=>/^この端末に無い\d+件$/.test(t)),JSON.stringify(d0.tabs));
 rec('未選択のときは変化の予定を出さず、取り込むは押せない理由を字で言う',!d0.active&&d0.run===true&&/選んでいません/.test(d0.preview),d0.preview.slice(0,50));
 rec('行ごとに「取り込むと」どうなるかが出る',d0.rows>0&&d0.flow===d0.rows&&/取り込むと/.test(d0.head),`${d0.flow}行 / 見出し=${d0.head}`);
 rec('バックアップから消すは取り込むの隣に置かない',!d0.delOnPage);
 // 選ぶと変化の予定が出る（行を押して選ぶ・的は行いっぱい）
 await page.evaluate(()=>{const r=[...document.querySelectorAll('#mmImpList .mm-row.mm-imp-row')].find(x=>!x.querySelector('[data-imp-id]:disabled'));if(r)r.querySelector('span:nth-child(2)').click()});
 await W.until(page,()=>!!document.querySelector('#mmImpPreview')?.classList.contains('is-active'),null,{ms:5000,what:'変化の予定が出る'});
 const d1=await page.evaluate(()=>({
  txt:document.querySelector('#mmImpPreview').textContent.replace(/\s+/g,' '),
  run:document.querySelector('#mmImpRun').disabled,runText:document.querySelector('#mmImpRun').textContent}));
 rec('選ぶと「取り込むと何が起きるか」が出る',/取り込むと/.test(d1.txt)&&/新しく追加/.test(d1.txt)&&/上書き/.test(d1.txt),d1.txt.slice(0,110));
 rec('選ぶと取り込むが押せ、件数を名乗る',!d1.run&&/選んだ 1件を取り込む/.test(d1.runText),d1.runText);
 // 消すは頭の ⋯ の中の危ない操作
 await page.click('#masterMaintMore');
 await page.waitForSelector('#mmActMenu [data-imp-act="delete"]',{state:'visible',timeout:5000});
 const del=await page.evaluate(()=>({danger:document.querySelector('#mmActMenu [data-imp-act="delete"]').classList.contains('is-danger'),
  text:document.querySelector('#mmActMenu [data-imp-act="delete"]').textContent}));
 await page.keyboard.press('Escape');
 rec('バックアップから消すは ⋯ の中で、危ない操作の形',del.danger&&/バックアップから消す/.test(del.text),JSON.stringify(del));
 // 取り込みは確認モーダルで内容を示す(更新者IDが必要なので先に入れる)
 await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'test-user');
 await page.evaluate(()=>document.querySelector('#mmImpRun').click());
 const shown=await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:6000})
   .then(()=>true).catch(()=>false);
 rec('取り込み前に確認モーダルが出る',shown);
 if(shown){
  const body=await page.evaluate(()=>document.querySelector('#appConfirmBody').innerText);
  rec('確認モーダルに新規/上書きの内訳が出る',/新しく追加/.test(body)&&/上書き/.test(body),
    body.replace(/\s+/g,' ').slice(0,110));
  await page.click('#appConfirmCancel');
 }
 /* 置いた実績は自分で消す（§9.351・§9.362）。 */
 try{await require('./lib/harness.js').clearRecords()}catch(e){console.log('!! 実績の後片付けに失敗: '+(e&&e.message||e))}
}, {viewport:{width:1600,height:900}});
