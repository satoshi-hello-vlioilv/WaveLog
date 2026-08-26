/* test_scmodecols.js: 作業スケジュール表の列は、モードが違っても同じ（§9.246）
   ============================================================
   利用者の報告:
     「編集モードから作業スケジュール表をみると表示列の項目数が明らかに
      少ないです。スケジュールモードに切り替えてからすぐに編集モードに
      切り替えると表示列数がスケジュールモードと同じになります。
      不具合なので初めからスケジュールモードと同じ表示列数で表示するように
      修正してください」

   原因: `refreshAllInner()`が
     if(scState.fullControl){jobs.push(loadScheduleColumnPrefs(),loadScheduleContentPrefs())}
   と**scheduleモードのときしか**表示設定を読んでおらず、編集モードでは
   `scContentPrefs.items`がnullのまま＝内容欄が既定の4項目へ落ちていた。
   モジュール変数なのでモードを一往復すると値が残り、`chosenContentKeys()`は
   モードを見ないので列がそろって見える——これが「切り替えると直る」の正体。

   ここで固定するのは次の点。**どれも「直す前なら落ちる」こと**を確かめてある。
    1. 編集モードで**開いた最初から**、スケジュールモードと同じ列が出る
       （キーの並びまで一致。件数だけを見る網は既定4件と偶然一致しうる）
    2. モードを一往復しても列は変わらない（往復で直る＝壊れている、の裏返し）
    3. 編集モードでも設定パネルに**足せる候補**が並ぶ
       （サーバーは`masters`Blueprint＝editへ開いているので、
         画面だけが塞いでいた。押せない候補を並べない§9.120の逆側）
    4. 編集モードで設定パネルを保存しても、**内容表示マスタの項目が消えない**
       （既定4項目しか見えていない状態で保存すると`sameItems`が成立し、
         `items:[]`＝未設定として書き戻して**設定が消える**）
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EQ='テスト設備A';
const TARGET='timeline:'+EQ;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)}).then(r=>r.json().catch(()=>({})));
const get=p=>fetch(B+p).then(r=>r.json());
let b=null;

/* 既定(4項目)と**必ず違う**並びにする。既定と同じ数・同じ並びだと、
   読んでいなくても偶然一致してしまい網が空振りする。 */
const ITEMS=['lotNo','purposeName','mfgMaterial','mfgTemper','mfgThickness','mfgWidth','customerName'];

async function cleanup(){
 try{await post('/api/access-mode',{mode:'edit'})}catch(e){}
 try{await post('/api/schedule-content-master',{equipment:EQ,items:[],user_id:'test'})}catch(e){}
 try{await post('/api/column-layout-master',{target:TARGET,clear:true,order:[],hidden:[],widths:{},
   names:{},formats:{},rules:{},formulas:{},locks:[],sorts:{},user_id:'test'})}catch(e){}
}

(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1800,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));

 /* 画面を開く。**モードはサーバー側で先に切り替える**（画面が起動時に
    `/api/whoami`で読むので、あとから変えても`scState.fullControl`は動かない）。 */
 const openSchedule=async mode=>{
  await post('/api/access-mode',{mode});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  /* **scheduleモードは全体俯瞰から入る**——`#openSchedule`を押すと設備の盤
     （`.sc-board-row`）が出るので、その設備の行を押して1設備の表へ入る。
     編集モードは最初から1設備の表なので盤は出ない。**両方を1本の手順で
     通せるようにしておくこと**——片方だけの手順で書くと、比べたい2つの
     画面のうち一方を一度も開けない（実際にscheduleモードで30秒待って落ちた）。 */
  const board=await page.waitForSelector('.sc-board-row,.sc-row-line',{timeout:30000})
    .then(()=>page.evaluate(()=>!!document.querySelector('.sc-board-row')));
  if(board){
   await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
     .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  }
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  /* **時間でなく条件で待つ**（§9.102）。表示設定は`refreshAllInner()`が
     `Promise.all`で待ち合わせてから描くので、見出しが1つでも出れば
     揃った状態のはず——だが描き直しが1フレーム遅れる経路があるので、
     見出しのキーが2回続けて同じになるまで待つ。 */
  await page.waitForFunction(()=>{
   const h=document.querySelector('#scTimeline .sc-row-head');
   return !!h&&h.querySelectorAll('[data-col]').length>0;
  },null,{timeout:25000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 };
 /* **`scState`は`window`に居ない**（`schedule-view.js`のIIFEの中のlet）ので、
    `window.scState.fullControl`を見る網は**常にfalse**＝何も確かめていない
    （実際にそう書いて素通りした）。見るのは画面に出ている事実だけにする:
     ・`accessMode.mode`（これは`window`に公開されている）
     ・`fullControl`でしか出ないボタン（設備停止・申し送り・枠）が出ているか
       ——`updateScheduleUi()`が`hidden=!scState.fullControl||inBoard`で決める。 */
 const cols=()=>page.evaluate(()=>{
  const h=document.querySelector('#scTimeline .sc-row-head');
  const shown=id=>{const e=document.getElementById(id);return !!e&&!e.hidden};
  return {
   all:[...h.querySelectorAll('[data-col]')].map(x=>x.dataset.col),
   content:[...h.querySelectorAll('[data-content-col]')].map(x=>x.dataset.contentCol),
   mode:(window.accessMode&&accessMode.mode)||'',
   /* 予定を足す道具＝scheduleモードだけの権限。 */
   canAdd:shown('scStopModalBtn')||shown('scCommentBtn')||shown('scFrameBtn'),
  };
 });

 try{
  await cleanup();

  /* ==========================================================
     0) 前提: 内容表示マスタに既定と違う7項目を入れておく
     ========================================================== */
  await post('/api/schedule-content-master',{equipment:EQ,items:ITEMS,user_id:'test'});
  const saved=await get('/api/schedule-content-master?equipment='+encodeURIComponent(EQ));
  rec('前提: 内容表示マスタに7項目が入っている（既定の4項目とは違う）',
      Array.isArray(saved.items)&&saved.items.length===ITEMS.length,
      JSON.stringify(saved.items));

  /* ==========================================================
     1) スケジュールモードで開く＝これが「正しい姿」
     ========================================================== */
  await openSchedule('schedule');
  const sc=await cols();
  rec('前提: スケジュールモードでは予定を足す道具が出ている（権限あり）',
      sc.mode==='schedule'&&sc.canAdd===true,`mode=${sc.mode} 足す道具=${sc.canAdd}`);
  rec('前提: スケジュールモードでは7項目ぶんの内容列が出る',
      sc.content.length===ITEMS.length,`${sc.content.length}列: ${sc.content.join(',')}`);

  /* ==========================================================
     2) 編集モードで**開いた最初から**同じ列が出る（本題）
        ここが直す前は「4列」で落ちる。
        **件数だけでなくキーの並びまで**見る——既定の4項目は7項目の
        先頭4つと同じなので、件数を見ないと素通りしうる。
     ========================================================== */
  await openSchedule('edit');
  const ed=await cols();
  /* **見えるものはそろえるが、書ける範囲は今までどおり**（§9.246 ②）。
     ここが一緒に緩んでいたら、直したのは「列」ではなく「権限」になる。 */
  rec('編集モードでは予定を足す道具が出ない（権限は今までどおり）',
      ed.mode==='edit'&&ed.canAdd===false,`mode=${ed.mode} 足す道具=${ed.canAdd}`);
  rec('編集モードでも、開いた最初から内容列が7つ出る',
      ed.content.length===ITEMS.length,`${ed.content.length}列: ${ed.content.join(',')}`);
  rec('編集モードの列の並びがスケジュールモードと完全に一致する',
      ed.content.join(',')===sc.content.join(','),
      `edit=[${ed.content.join(',')}] / schedule=[${sc.content.join(',')}]`);
  rec('固定列も含めた全列がモードで変わらない',
      ed.all.join(',')===sc.all.join(','),
      `edit=${ed.all.length}列 / schedule=${sc.all.length}列`);

  /* ==========================================================
     3) 画面を開いたまま**モードを往復しても**列は変わらない
        利用者の報告そのもの:「スケジュールモードに切り替えてからすぐに
        編集モードに切り替えると表示列数がスケジュールモードと同じになる」

        **読み直し（reload）を挟まないこと**——`scContentPrefs`はモジュール
        変数なので、読み直すと消えて症状が出ない（挟んだ網は直す前でも
        通った。実際にそうなった）。`switchAccessMode()`と同じ順序
        ——サーバーのモードを変えてから`openScheduleView()`で開き直す
        （`access-mode.js`の`refreshOpenViewsForMode()`）——で往復する。
     ========================================================== */
  const switchTo=async m=>{
   await post('/api/access-mode',{mode:m});
   await page.evaluate(()=>window.openScheduleView&&window.openScheduleView());
   await page.waitForFunction(()=>!!document.querySelector('#scTimeline .sc-row-head [data-col]'),
     null,{timeout:25000});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  };
  await switchTo('schedule');
  await switchTo('edit');
  const ed2=await cols();
  rec('画面を開いたままモードを往復しても編集モードの列は変わらない',
      ed2.content.join(',')===ed.content.join(','),
      `往復前=[${ed.content.join(',')}] / 往復後=[${ed2.content.join(',')}]`);

  /* ==========================================================
     4) 編集モードでも設定パネルに足せる候補が並ぶ
        サーバーは masters Blueprint = {'edit'} なので保存は通る（
        `backend/access_mode.py`の`_WRITE_ALLOWED_MODES`）。画面だけが
        `fullControl`で塞いでおり、**できることをできないと書いて**いた。

        **実物のパネルを開いて見る**——口を直接呼ぶと、ボタンから開いたときに
        別の判定が挟まっていても素通りする。
        ここは「候補が既に出している7項目より多い」ことで見る（出している列
        だけでも一覧は空にならないので、0件かどうかを見る網は素通りする）。
     ========================================================== */
  await page.click('#scContentModalBtn');
  await page.waitForSelector('#listColumnPanel:not([hidden]) .lc-item',{timeout:15000});
  const panel=await page.evaluate(()=>({
   keys:[...document.querySelectorAll('#listColumnPanel .lc-item')].map(x=>x.dataset.key),
   lead:document.getElementById('lcLead')?.textContent||'',
  }));
  const extra=panel.keys.filter(k=>!/^__/.test(k)&&ITEMS.indexOf(k)<0);
  rec('編集モードでも「まだ出していない項目」が候補に並ぶ',
      extra.length>0,`余分な候補 ${extra.length}件: ${extra.slice(0,6).join(',')}`);
  rec('「足せません」という案内が残っていない',
      !/足せません/.test(panel.lead),panel.lead.slice(-100));

  /* ==========================================================
     5) 編集モードで保存しても内容表示マスタが消えない
        直す前は、見えている項目が既定の4つなので`sameItems`が成立して
        `items:[]`（＝未設定）で書き戻し、**7項目の設定が消えていた**。
        **実際に保存ボタンを押して**からサーバーを読む。
     ========================================================== */
  await page.click('#lcSave');
  await page.waitForFunction(()=>{
   const p=document.getElementById('listColumnPanel');return !p||p.hidden;
  },null,{timeout:15000}).catch(()=>{});
  const after=await get('/api/schedule-content-master?equipment='+encodeURIComponent(EQ));
  rec('編集モードから保存しても内容表示マスタの7項目が消えない',
      Array.isArray(after.items)&&after.items.length===ITEMS.length,
      JSON.stringify(after.items));

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  console.log('FATAL: '+(e&&e.stack||e));
  R.push({n:'FATAL',ok:false});
 }finally{
  /* **落ちてもブラウザを閉じる**（tests/README.md）。残ると次のテストが
     編集セッションを掴んだままの画面に巻き込まれる。 */
  try{await cleanup()}catch(e){}
  try{await post('/api/access-mode',{mode:'edit'})}catch(e){}
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok).length;
 console.log(`\n${R.length-ng}/${R.length} PASS`);
 process.exit(ng?1:0);
})();
