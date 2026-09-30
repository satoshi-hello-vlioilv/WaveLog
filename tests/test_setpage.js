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

 // ---------- 共通設定（旧「パス設定」。§9.168でデータソースぶんを分離） ----------
 await tab('共通設定');
 const p=await page.evaluate(()=>{
  const sc=document.querySelector('.mm-set-scroll');
  const panel=document.querySelector('#masterMaintPanel').getBoundingClientRect();
  const save=document.querySelector('.mm-set-sticky button');
  const sr=save.getBoundingClientRect();
  // 入力欄が枠外へ切れていないか(親のスクロール領域の内側に収まっているか)
  const scr=sc.getBoundingClientRect();
  /* **いま開いている段の中だけを測る**（§9.261）。畳んだ段の欄は
     `display:none`なので寸法を持たず、全部「見切れ」に数えられてしまう
     （実際に14件と出た）。見えていない欄は切れようがない。 */
  const clipped=[...sc.querySelectorAll('input,select')].filter(e=>{
   if(!e.offsetParent)return false;
   const r=e.getBoundingClientRect();
   return r.height<8||r.right>scr.right+1;
  }).length;
  return {scrollable:sc.scrollHeight>sc.clientHeight,
    saveInsidePanel:sr.bottom<=panel.bottom+1&&sr.top>=panel.top,
    groups:document.querySelectorAll('.mm-set-group').length,
    badges:document.querySelectorAll('.mm-apply-badge').length,
    /* **置き場の行の中の欄は数えない**（§9.267）——あれは「置き場」の
       1枚に並ぶ行で、1つの保存ボタンで送るために`data-pc-field`を持つ。
       ここが見たいのは「素の欄として二重に置いていないか」。 */
    fields:[...document.querySelectorAll('[data-pc-field]')]
      .filter(e=>!e.closest('.pc-store-row')).map(e=>e.dataset.pcField),
    storeRows:document.querySelectorAll('.pc-store-row').length,
    clipped,listWrap:getComputedStyle(document.querySelector('.mm-list-wrap')).display,
    tabs:document.querySelectorAll('.mm-tabbar.is-page .mm-tab').length,
    shownPanels:[...document.querySelectorAll('.mm-tabpanel.is-page')].filter(x=>!x.hidden).length,
    scrollH:sc.scrollHeight,clientH:sc.clientHeight};
 });
 /* **1本の長いスクロールはやめた**（§9.261、利用者の指示「タブとアコーディオンを
    主構成に」）。以前は実測2768pxを736pxの器で見ており、4回ぶんスクロール
    していた。いまは章＝段（タブ）で、開いている章だけが出る。 */
 rec('章が段（タブ）になっている',p.tabs>=4,`${p.tabs}段`);
 rec('章の数だけまとまりがある',p.groups>=4,`${p.groups}グループ`);
 rec('開いている章は1つだけ',p.shownPanels===1,`${p.shownPanels}段が開いている`);
 /* **1画面に収まる**（段に分けた値打ちはここ）。器より中身が高いと
    「畳んだのに結局スクロールする」ことになる。 */
 rec('1つの章は器に収まる（長いスクロールにならない）',
     p.scrollH<=p.clientH+2,`中身${p.scrollH}px / 器${p.clientH}px`);
/* 件数ではなく**キーの一覧**で見る。項目は増える(RNE資材の置き場・
    symnavim.confの場所を§9.79で追加した)ので、数を固定すると足すたびに
    落ちる。「あるべきものが全部出ているか」が見たいこと。 */
 /* **データソースごとの読み込み先はここに無い**（§9.168）。同じ「どこを読むか」を
    2画面に置くと、どちらが効くのか分からなくなるため「データ接続」へ寄せた。
    **置き場（作業予定・測定データ・複製先・マスタ）は「置き場」の段が持つ**
    （§9.267、利用者の指示「全ての設定を共通設定に視覚的に表現した上で」）。
    §9.202では複製先を「測定データの保存」に置くと決めていたが、置き場が
    画面に散っているのがそもそもの困りごとだったので撤回した。あちらは
    `data-pc-field`ではなく置き場の行（`.pc-store-row`）として出るので、
    ここが数える欄の一覧には**入らない**。 */
 const WANT=['sikalot_source','rne_extract_enabled',
   'rne_extract_interval_sec','rne_assets_dir','rne_conf_path',
   'schedule_lock_ttl_sec','schedule_lock_verify_delay_ms'];
 /* 置き場の欄をここ（`data-pc-field`）へ戻さない——戻すと同じ設定が
    「置き場」の行と欄の2箇所に出る。 */
 const MOVED=['records_backup_export_path','records_share_dir','schedule_share_path'];
 const missing=WANT.filter(k=>!p.fields.includes(k));
 rec('よそへ移した設定をここに残さない',MOVED.every(k=>!p.fields.includes(k)),
     MOVED.filter(k=>p.fields.includes(k)).join(',')||'なし');
 rec('設定項目が漏れなく出ている',missing.length===0,
   missing.length?`不足: ${missing.join(',')}`:`${p.fields.length}件`);
 rec('入力欄が枠外へ切れていない',p.clipped===0,p.clipped+'件が見切れ');
 /* データソースの読み込み先は**ここでは変えられない**（読み取り専用の
    並びだけ出す）。入力欄が残っていたら2画面に同じ設定がある状態。 */
 const dup=p.fields.filter(k=>/_path$/.test(k)&&!['schedule_share_path','records_backup_export_path','rne_conf_path'].includes(k));
 rec('データソースごとの読み込み先の欄は共通設定に無い',dup.length===0,dup.join(','));
 /* **起動アイコンの盤はここに無い**（§9.445）。盤はヘッダーの「表示」へ移した
    ——共通設定はスケジュールモードでは出ないので、あそこだけに置くと現場の
    端末からは作れない。ここに残るのは**いまの状態と行き先**だけで、
    名前・絵の欄（`data-pc-field`）は1つも無いこと（設定を直す面を2つにしない）。 */
 const sc=await page.evaluate(()=>({
   欄:[...document.querySelectorAll('[data-pc-field]')].map(e=>e.dataset.pcField)
     .filter(k=>/^shortcut_/.test(k)),
   状態:!!document.querySelector('#pcShortcut [data-sc-state]'),
   行き先:!!document.getElementById('pcScOpen'),
   作る:!!document.getElementById('lnkMake')}));
 rec('起動アイコンの名前・絵の欄は共通設定に無い（盤は「表示」の1箇所）',
   sc.欄.length===0&&!sc.作る,sc.欄.join(',')||'なし');
 rec('共通設定にはいまの状態と行き先が残る（探させない）',
   sc.状態&&sc.行き先,`状態${sc.状態} 行き先${sc.行き先}`);
 rec('反映タイミングがまとまりごとに示されている',p.badges>=4,p.badges+'個');
 rec('保存ボタンが常にパネル内に見えている',p.saveInsidePanel);
 rec('設定ページでは下段の一覧枠を畳む',p.listWrap==='none',p.listWrap);
 // 一番下までスクロールしても保存ボタンは見えたまま
 await page.evaluate(()=>{const sc=document.querySelector('.mm-set-scroll');sc.scrollTop=sc.scrollHeight});
 await paint();
 const bottom=await page.evaluate(()=>{
  const panel=document.querySelector('#masterMaintPanel').getBoundingClientRect();
  const sr=document.querySelector('.mm-set-sticky button').getBoundingClientRect();
  const sc=document.querySelector('.mm-set-scroll');
  const last=sc.lastElementChild.getBoundingClientRect(),scr=sc.getBoundingClientRect();
  return {save:sr.bottom<=panel.bottom+1,lastVisible:last.bottom<=scr.bottom+2};
 });
 rec('最後までスクロールしても保存ボタンが押せる',bottom.save);
 rec('最下部の内容まで表示できる',bottom.lastVisible);
 /* 段を切り替えても保存ボタンは動かない（本文の外にある・§9.222 ⑦）。 */
 const afterTab=await page.evaluate(()=>{
  const t=[...document.querySelectorAll('.mm-tabbar.is-page .mm-tab')];
  if(t.length>2)t[2].click();
  const panel=document.querySelector('#masterMaintPanel').getBoundingClientRect();
  const sr=document.querySelector('.mm-set-sticky button').getBoundingClientRect();
  return {save:sr.bottom<=panel.bottom+1,
          shown:[...document.querySelectorAll('.mm-tabpanel.is-page')].filter(x=>!x.hidden).length};
 });
 rec('段を切り替えても保存ボタンはパネル内に居る',afterTab.save);
 rec('段を切り替えても開くのは1つだけ',afterTab.shown===1,`${afterTab.shown}段`);
 /* ---- 状態は**その欄のすぐ下**（§9.208 ⑨、利用者の指示で作り直した） ----
    以前は画面のいちばん下に「保存値／いま効いている値」の対比表があり、
    直した欄がその表のどの行なのかを探すことになっていた。表は廃止し、
    状態は欄が持つ（§8 同じ情報を2箇所に出さない）。 */
 const cmp=await page.evaluate(()=>{
  const st=[...document.querySelectorAll('.pc-state')];
  const near=st.filter(el=>{
   const f=el.closest('.mm-field');
   return !!f&&!!f.querySelector('[data-pc-field]');
  });
  return{旧表:!!document.getElementById('pathConfigActive'),
    状態欄:st.length,欄の下にある:near.length,
    比べている:st.filter(el=>/いま/.test(el.textContent)&&/保存値/.test(el.textContent)).length,
    章:[...document.querySelectorAll('[data-pc-section]')].map(x=>x.dataset.pcSection),
    図:document.querySelectorAll('.pc-map .pc-node').length,
    図の値:[...document.querySelectorAll('[data-pc-map]')].map(x=>x.textContent.trim()).filter(Boolean).length,
    /* レールは§9.261で**段（タブ）**になった。 */
    段:document.querySelectorAll('.mm-tabbar.is-page .mm-tab').length};
 });
 rec('下段の対比表は廃止した（状態は欄が持つ）',cmp.旧表===false,String(cmp.旧表));
 rec('保存値と現在有効な値を欄のすぐ下で見比べられる',
   cmp.比べている>=1&&cmp.欄の下にある>=1,JSON.stringify(cmp));
 rec('この端末のつながりを図で出す',cmp.図>=3&&cmp.図の値>=3,JSON.stringify({図:cmp.図,値:cmp.図の値}));
 rec('章立てと段（タブ）がある',cmp.段===cmp.章.length&&cmp.章.length>=4,
     cmp.章.join('／')+' / '+cmp.段+'段');
 /* 押すとその章へ連れて行く（探させない）。 */
 /* 章は段になったので、**飛ぶ＝段を切り替えること**（§9.261・§9.266）。
    図のノードから飛べることを見る（入口を2本作らない）。 */
 const jumped=await page.evaluate(async()=>{
  const btn=document.querySelector('.pc-map [data-pc-jump="schedule"]');
  if(!btn)return{無い:true};
  btn.click();
  await new Promise(r=>setTimeout(r,700));
  const sec=document.getElementById('pcSec-schedule');
  const panel=sec&&sec.closest('.mm-tabpanel');
  return{見えている:!!panel&&!panel.hidden,
    開いている段:[...document.querySelectorAll('.mm-tabpanel.is-page')].filter(x=>!x.hidden).length};
 });
 rec('図から章へ飛ぶとその段が開く',
     jumped.見えている===true&&jumped.開いている段===1,JSON.stringify(jumped));
 // 一致している項目に「再起動待ち」を出さない(表示文字列で誤検知しない)
 const pend=await page.evaluate(()=>[...document.querySelectorAll('.pc-state.is-pending-restart,.pc-source.is-pending-restart')]
   .map(r=>r.innerText.split('\n')[0]));
 rec('値が同じ項目を「再起動待ち」と誤表示しない',pend.length===0,JSON.stringify(pend));
 /* PC名は**この端末の章**に出る（§9.208 ⑧）。取れない端末があったので、
    名前そのものと出どころ、名乗り直す欄までを1箇所に置く。 */
 const who=await page.evaluate(()=>({
  欄:document.querySelectorAll('#pcWho>div').length,
  PC名:(document.querySelector('#pcWho b')||{}).textContent||'',
  出どころ:(document.querySelector('#pcWho i')||{}).textContent||'',
  名乗り直す:!!document.querySelector('[data-pc-field="pc_name"]')}));
 rec('この端末のPC名・出どころ・名乗り直す欄がある（§9.208 ⑧）',
   who.欄===3&&!!who.PC名&&who.PC名!=='（取得できていません）'&&!!who.出どころ&&who.名乗り直す,
   JSON.stringify(who));

 // 他タブへ移ると設定ページ用の指定が残らない
 // （オペレータマスタは §9.221 ③ で操業データ選択肢マスタへ統合して撤去した）
 await tab('アクセス権限');
 const other=await page.evaluate(()=>({page:document.querySelector('#masterMaintForm').classList.contains('mm-form-page'),
   listWrap:getComputedStyle(document.querySelector('.mm-list-wrap')).display}));
 rec('他マスタへ移ると設定ページ指定が残らない',!other.page&&other.listWrap!=='none',JSON.stringify(other));
 /* **器（#masterMaintForm）は描き直しても同じ要素**（§9.522 の追補）。受け手を描くたびに付けると
    積み上がり、3回開くと図のボタン1回で3回走っていた。段の一言も最初の描画の段を閉じ込めたままで、
    2回目以降は打った字を追わなかった。**2回目・3回目の描画**で見る（1回目だけでは見分けられない）。 */
 for(const k of [2,3]){
  if(k===3)await tab('アクセス権限');
  await tab('共通設定');
  const w=await page.evaluate(k=>{
   const o=Element.prototype.scrollIntoView;let n=0;
   Element.prototype.scrollIntoView=function(...a){if(/^pcSec-/.test(this.id||''))n++;return o.apply(this,a)};
   try{document.querySelector('.pc-map [data-pc-jump="read"]').click()}finally{Element.prototype.scrollIntoView=o}
   document.querySelector('#masterMaintForm .mm-tab[data-mmtab="0"]').click();
   const el=document.querySelector('#masterMaintForm [data-pc-field="pc_name"]');
   const was=el.value;el.value='ZZ'+k;el.dispatchEvent(new Event('input',{bubbles:true}));
   const sum=(document.querySelector('#masterMaintForm [data-mmtab-sum="0"]')||{}).textContent||'';
   el.value=was;el.dispatchEvent(new Event('input',{bubbles:true}));   /* 打った字は保存しない・元へ戻す */
   return {走った:n,一言:sum};
  },k);
  rec(`${k}回目に描いた共通設定でも、図のボタン1回で受け手は1回だけ走る（積み上がらない）`,w.走った===1,JSON.stringify(w));
  rec(`${k}回目に描いた共通設定でも、段の見出しの一言が打った字を追う`,w.一言.indexOf('ZZ'+k)>=0,JSON.stringify(w));
 }

 // ---------- データ引継ぎ ----------
 await tab('データ引継ぎ');
 const d0=await page.evaluate(()=>({
  cols:document.querySelectorAll('.mm-imp-state-col').length,
  now:(document.querySelector('.mm-imp-state-list')||{}).innerText||'',
  preview:(document.querySelector('#mmImpPreview')||{}).innerText||'',
  active:document.querySelector('#mmImpPreview')?.classList.contains('is-active'),
  flow:document.querySelectorAll('.mm-imp-flow').length,
  head:[...document.querySelectorAll('#masterMaintList .mm-row.head span')].map(s=>s.textContent).join('/'),
 }));
 rec('「いまの状態」が件数で示される',/バックアップ/.test(d0.now)&&/この端末に/.test(d0.now),
   d0.now.replace(/\s+/g,' ').slice(0,90));
 rec('未選択のときは変化の予定を出さない',!d0.active,d0.preview.slice(0,50));
 rec('行ごとに「いまの状態 → 取り込むと」が出る',d0.flow>0&&/いまの状態/.test(d0.head),
   `${d0.flow}行 / 見出し=${d0.head}`);
 // 選ぶと変化の予定が出る
 await page.evaluate(()=>{const c=document.querySelector('#masterMaintList [data-imp-id]:not(:disabled)');
   if(c){c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}))}});
 await W.until(page,()=>!!document.querySelector('#mmImpPreview')?.classList.contains('is-active'),null,{ms:5000,what:'変化の予定が出る'});
 const d1=await page.evaluate(()=>({
  active:document.querySelector('#mmImpPreview').classList.contains('is-active'),
  txt:document.querySelector('#mmImpPreview').innerText.replace(/\s+/g,' ')}));
 rec('選ぶと「実行すると何が起きるか」が出る',
   d1.active&&/取り込む/.test(d1.txt)&&/削除/.test(d1.txt),d1.txt.slice(0,110));
 rec('取り込みと削除の結果が別々に示される',
   /新しく追加/.test(d1.txt)&&/上書き/.test(d1.txt)&&/バックアップから/.test(d1.txt));
 // 逆の結果になるボタンが見分けられる
 const btn=await page.evaluate(()=>{
  const imp=document.querySelector('#mmImpRun'),del=document.querySelector('#mmImpDelete');
  return {impCls:imp.className,delCls:del.className,
    sep:!!document.querySelector('.mm-cd-sep'),
    sameColor:getComputedStyle(imp).backgroundColor===getComputedStyle(del).backgroundColor};
 });
 rec('取り込みと削除が色で見分けられる',!btn.sameColor&&btn.sep,JSON.stringify(btn));
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
