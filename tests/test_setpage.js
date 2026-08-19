/* §9.68 パス設定を設定ページ形式へ / データ引継ぎの「現状→実行後」可視化 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(B+'/api/access-mode',{method:'POST',
 headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
let b=null;
(async()=>{
 await setMode('edit');
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:900}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));
 const tab=async label=>{await page.evaluate(l=>{const t=[...document.querySelectorAll('#masterMaintNav [data-master]')]
   .find(x=>x.textContent.includes(l));if(t)t.click()},label);await page.waitForTimeout(2200)};
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openMasterMaint',{timeout:15000});
 await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(1500);
 await page.click('#openMasterMaint');await page.waitForTimeout(1200);

 // ---------- 共通設定（旧「パス設定」。§9.168でデータソースぶんを分離） ----------
 await tab('共通設定');
 const p=await page.evaluate(()=>{
  const sc=document.querySelector('.mm-set-scroll');
  const panel=document.querySelector('#masterMaintPanel').getBoundingClientRect();
  const save=document.querySelector('.mm-set-sticky button');
  const sr=save.getBoundingClientRect();
  // 入力欄が枠外へ切れていないか(親のスクロール領域の内側に収まっているか)
  const scr=sc.getBoundingClientRect();
  const clipped=[...sc.querySelectorAll('input,select')].filter(e=>{
   const r=e.getBoundingClientRect();
   return r.height<8||r.right>scr.right+1;
  }).length;
  return {scrollable:sc.scrollHeight>sc.clientHeight,
    saveInsidePanel:sr.bottom<=panel.bottom+1&&sr.top>=panel.top,
    groups:document.querySelectorAll('.mm-set-group').length,
    badges:document.querySelectorAll('.mm-apply-badge').length,
    fields:[...document.querySelectorAll('[data-pc-field]')].map(e=>e.dataset.pcField),
    clipped,listWrap:getComputedStyle(document.querySelector('.mm-list-wrap')).display};
 });
 rec('パス設定が1本のスクロール領域になっている',p.scrollable,`${p.groups}グループ`);
 rec('章の数だけまとまりがある',p.groups>=4,`${p.groups}グループ`);
/* 件数ではなく**キーの一覧**で見る。項目は増える(RNE資材の置き場・
    symnavim.confの場所を§9.79で追加した)ので、数を固定すると足すたびに
    落ちる。「あるべきものが全部出ているか」が見たいこと。 */
 /* **データソースごとの読み込み先はここに無い**（§9.168）。同じ「どこを読むか」を
    2画面に置くと、どちらが効くのか分からなくなるため「データ接続」へ寄せた。
    **測定データバックアップの複製先もここに無い**（§9.202）——置き場の図・
    件数・「いま複製する」と同じ画面（測定データの保存）にあるほうが、
    何が起きるか分かるため。 */
 const WANT=['sikalot_source',
   'schedule_share_path','rne_extract_enabled',
   'rne_extract_interval_sec','rne_assets_dir','rne_conf_path',
   'schedule_lock_ttl_sec','schedule_lock_verify_delay_ms'];
 const MOVED=['records_backup_export_path'];
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
 rec('反映タイミングがまとまりごとに示されている',p.badges>=4,p.badges+'個');
 rec('保存ボタンが常にパネル内に見えている',p.saveInsidePanel);
 rec('設定ページでは下段の一覧枠を畳む',p.listWrap==='none',p.listWrap);
 // 一番下までスクロールしても保存ボタンは見えたまま
 await page.evaluate(()=>{const sc=document.querySelector('.mm-set-scroll');sc.scrollTop=sc.scrollHeight});
 await page.waitForTimeout(400);
 const bottom=await page.evaluate(()=>{
  const panel=document.querySelector('#masterMaintPanel').getBoundingClientRect();
  const sr=document.querySelector('.mm-set-sticky button').getBoundingClientRect();
  const sc=document.querySelector('.mm-set-scroll');
  const last=sc.lastElementChild.getBoundingClientRect(),scr=sc.getBoundingClientRect();
  return {save:sr.bottom<=panel.bottom+1,lastVisible:last.bottom<=scr.bottom+2};
 });
 rec('最後までスクロールしても保存ボタンが押せる',bottom.save);
 rec('最下部の内容まで表示できる',bottom.lastVisible);
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
    レール:document.querySelectorAll('.pc-rail [data-pc-jump]').length};
 });
 rec('下段の対比表は廃止した（状態は欄が持つ）',cmp.旧表===false,String(cmp.旧表));
 rec('保存値と現在有効な値を欄のすぐ下で見比べられる',
   cmp.比べている>=1&&cmp.欄の下にある>=1,JSON.stringify(cmp));
 rec('この端末のつながりを図で出す',cmp.図>=3&&cmp.図の値>=3,JSON.stringify({図:cmp.図,値:cmp.図の値}));
 rec('章立てとレールがある',cmp.レール===cmp.章.length&&cmp.章.length>=4,cmp.章.join('／'));
 /* 押すとその章へ連れて行く（探させない）。 */
 const jumped=await page.evaluate(async()=>{
  const btn=document.querySelector('.pc-rail [data-pc-jump="rne"]');
  if(!btn)return{無い:true};
  btn.click();
  await new Promise(r=>setTimeout(r,700));
  const sec=document.getElementById('pcSec-rne'),sc=document.querySelector('.mm-set-scroll');
  return{上端:Math.round(sec.getBoundingClientRect().top-sc.getBoundingClientRect().top)};
 });
 rec('章のレールを押すとその章へ移る',Math.abs(jumped.上端??999)<80,JSON.stringify(jumped));
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
 await tab('オペレータ');
 const other=await page.evaluate(()=>({page:document.querySelector('#masterMaintForm').classList.contains('mm-form-page'),
   listWrap:getComputedStyle(document.querySelector('.mm-list-wrap')).display}));
 rec('他マスタへ移ると設定ページ指定が残らない',!other.page&&other.listWrap!=='none',JSON.stringify(other));

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
 await page.waitForTimeout(400);
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
 await page.evaluate(()=>{const u=document.querySelector('#masterUserId');
   if(u){u.value='test-user';u.dispatchEvent(new Event('change',{bubbles:true}))}});
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
