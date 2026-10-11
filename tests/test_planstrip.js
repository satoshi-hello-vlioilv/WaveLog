/* test_planstrip.js: 初期画面の「作業予定」の帯（§9.580）。
   ------------------------------------------------------------
   ① 仕掛の一覧で設備が決まっていれば出る・品質の一覧と設備なしでは出ない
   ② 数は予定の画面の答え（`/api/schedule/plan`の作業ロット・子は親の1本）と同じ
   ③ 「次にすること」は1つ（塗りのボタン1つ）。押すと予定の行の「開始」と同じ道で
      その行のロットの測定を開く（測定画面は開かずに、渡った行を控えて確かめる）
   ④ 字が入っても帯の高さと一覧の上端は動かない（起動の覆いのあとに組み替えない）
   ⑤ 測っている途中・始められない・読めない、の字（`WL.planStrip.plan()`の答え） */
const API='http://127.0.0.1:5029';
const {run}=require('./lib/harness.js');
run('test_planstrip: 初期画面の「作業予定」の帯（§9.580）',async({page,rec,setMode,W,idle})=>{
 const EQ='テスト設備A';
 await setMode('edit');
 await page.goto(API+'/',{waitUntil:'domcontentloaded'});
 const before=await page.evaluate(()=>localStorage.getItem('AccessMeasurementConfiguredEquipment'));
 try{
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);await idle();
  await page.waitForFunction(()=>/残り|予定はありません/.test((document.querySelector('#planStrip .ps-meta')||{}).textContent||''),null,{timeout:15000});

  const s=await page.evaluate(async eq=>{
   const el=document.getElementById('planStrip'),grid=document.getElementById('grid');
   const r=await (await fetch('/api/schedule/plan?equipment='+encodeURIComponent(eq))).json();
   const works=(r.entries||[]).filter(e=>e.kind==='作業'&&!e.parentId);
   return {shown:!el.hidden&&el.getBoundingClientRect().height>0,
    h:el.getBoundingClientRect().height,gridTop:grid.getBoundingClientRect().top,
    title:el.querySelector('.ps-title').textContent,meta:el.querySelector('.ps-meta').textContent,
    filled:el.querySelectorAll('.ps-go').length,go:(el.querySelector('[data-ps="go"]')||{}).textContent||'',
    rest:works.filter(e=>e.state==='予定'||e.state==='着手').length,
    firstLot:(works.find(e=>e.state==='予定')||{}).lotNo||''};
  },EQ);
  rec('① 仕掛の一覧で設備が決まっていれば帯が出る',s.shown&&s.title===`${EQ} の作業予定`,`${s.title} h=${s.h}`);
  rec('② 残りの数が予定の画面の答えと同じ',s.meta.includes(`残り ${s.rest}件`),`${s.meta} / API=${s.rest}`);
  rec('③ 塗りのボタンは1つだけ（次にすることを1つ指す）',s.filled===1,`${s.filled}個`);
  rec('③ 次の1本は予定の最初の仕掛かっているロット',s.go.includes(s.firstLot)&&s.meta.includes(`次 ${s.firstLot}`),s.go);

  /* ④ 読み直しても（字が入れ替わっても）高さと一覧の上端は同じ。 */
  await page.evaluate(()=>WL.planStrip.refresh(true));
  const s2=await page.evaluate(()=>({h:document.getElementById('planStrip').getBoundingClientRect().height,
   gridTop:document.getElementById('grid').getBoundingClientRect().top}));
  rec('④ 読み直しても帯の高さ・一覧の上端は動かない',s2.h===s.h&&s2.gridTop===s.gridTop,
   `h ${s.h}→${s2.h} / top ${s.gridTop}→${s2.gridTop}`);

  /* ③ 押すと予定の「開始」と同じ道（WL.scheduleView.start → WL.records.openMeasurement）で
     そのロットの行が渡る。測定画面そのものは開かない（端末に下書きを作らない）。 */
  /* 待つのは「測定を開く口に行が渡った」か「断りの窓が出た」のどちらか（渡らないまま窓で止まると、
     行を待つだけの網は終わらない）。窓が出たら閉じてから先へ進む。 */
  await page.evaluate(()=>{window.__psOrig=WL.records.openMeasurement;window.__psGot=null;
   WL.records.openMeasurement=async row=>{window.__psGot=row};
   document.querySelector('#planStrip [data-ps="go"]').click()});
  /* 窓の器は初めて開くときに作られる（無い＝出ていない）。 */
  await page.waitForFunction(()=>{const m=document.getElementById('appConfirmModal');return !!window.__psGot||!!(m&&!m.hidden)},null,{timeout:10000});
  const opened=await page.evaluate(()=>{
   WL.records.openMeasurement=window.__psOrig;
   const got=window.__psGot;
   const modal=document.getElementById('appConfirmModal');
   if(!got&&modal&&!modal.hidden)document.getElementById('closeAppConfirm').click();
   return got?(WL.base.aliases.lotNo.map(k=>got[k]).find(Boolean)||got.lotNo||''):'(断りの窓が出た)';
  });
  rec('③ 押すとそのロットの行で測定を開く（予定の「開始」と同じ道）',opened===s.firstLot,`渡った行: ${opened}`);

  /* ⑤ 字の答え（合成した要約で）。 */
  const p=await page.evaluate(eq=>{
   const P=d=>WL.planStrip.plan(eq,d,'');
   const doing=P({doing:[{lotNo:'L7'}],waiting:3,next:{lotNo:'L8',plannedStart:''}});
   const stuck=P({doing:[],waiting:2,next:null});
   const none=P({doing:[],waiting:0,next:null});
   const bad=WL.planStrip.plan(eq,null,'HTTP 500');
   return {doing:[doing.meta,doing.go&&doing.go.label],stuck:[stuck.meta,!!stuck.go],none:none.meta,bad:[bad.meta,bad.bad]};
  },EQ);
  rec('⑤ 測っている途中があれば「続き」が次にすること',p.doing[1]==='測定の続きを開く（L7）'&&p.doing[0].includes('作業中 1件（L7）'),p.doing.join(' / '));
  rec('⑤ 始められるロットが無ければ理由を字で言い、塗りは作業スケジュールへ',!p.stuck[1]&&p.stuck[0].includes('いま始められるロットはありません'),p.stuck[0]);
  rec('⑤ 予定が無ければ「予定はありません」',p.none==='予定はありません',p.none);
  rec('⑤ 読めなければ理由を字で（橙の縁）',p.bad[1]===true&&p.bad[0].includes('HTTP 500'),p.bad[0]);

  /* ① 品質の一覧へ移ると出ない・戻ると出る。設備を外すと出ない（上の設定の帯が言う）。 */
  const qk=await page.evaluate(()=>WL.dataSource.qualityKey&&WL.dataSource.qualityKey());
  if(qk){
   await page.click(`[data-db-key="${qk}"]`);
   /* 移り終えた（一覧の表が品質のもの）のを待ってから見る。「消えた」を待つと、消えない不具合が時間切れになって理由が読めない。 */
   await page.waitForFunction(k=>S.db===k,qk,{timeout:10000});await idle();
   rec('① 品質の一覧では出ない',await page.evaluate(()=>document.getElementById('planStrip').hidden));
  }else rec('① 品質の一覧では出ない（品質のデータソースが無いので確かめていない）',false,'qualityKey なし');
  await page.evaluate(()=>WL.equipment.set(''));
  await page.evaluate(()=>WL.planStrip.refresh(true));
  rec('① 設備が無ければ出ない',await page.evaluate(()=>document.getElementById('planStrip').hidden));
 }finally{
  await page.evaluate(v=>{if(v===null)localStorage.removeItem('AccessMeasurementConfiguredEquipment');
   else localStorage.setItem('AccessMeasurementConfiguredEquipment',v)},before);
 }
},{mode:'edit'});
