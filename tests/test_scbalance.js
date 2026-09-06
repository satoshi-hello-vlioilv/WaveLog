/* 待ちは「時間」ではなく「条件」（§9.102・3-15 ③・§9.347）。骨組み
   （起動・rec・pageerror・素のダイアログ・集計・閉じる）は tests/lib/harness.js。
   置き換え前後で全PASS行（測った値ごと）を突き合わせてある。 */
const {run}=require('./lib/harness.js');
const setMode=async m=>{await fetch('http://127.0.0.1:5029/api/access-mode',
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
run('test_scbalance: 一覧とスケジュールの釣り合い',async({page,rec,W,idle,paint})=>{
 /* 見え方の設定（まとめ・さかのぼり・表示列・行の色・配置）は「表示」
    パネル(§9.199)の中にある。開く→選ぶ→**閉じる**まで1つの手順にする
    ——開いたままにすると、パネルが表の右上を覆って次のクリックが
    「要素が隠れている」で落ちる（実際に落ちた）。 */
 const openView=()=>page.evaluate(()=>window.WL&&WL.scheduleView&&WL.scheduleView.openViewPop&&WL.scheduleView.openViewPop());
 const closeView=()=>page.evaluate(()=>window.WL&&WL.scheduleView&&WL.scheduleView.closeViewPop&&WL.scheduleView.closeViewPop());
 const pickView=async(sel,val)=>{await openView();await page.selectOption(sel,val).catch(()=>{});await closeView()};
 await setMode('edit');
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await W.booted(page);

 // 基準: 仕掛一覧のデータセル
 await page.click('aside [data-db-key="SIKALOTNOW"]');
 await idle();
 const base=await page.evaluate(()=>{
  const td=document.querySelector('#grid tbody td');const th=document.querySelector('#grid thead th');
  return {cell:td?parseFloat(getComputedStyle(td).fontSize):null,
          head:th?parseFloat(getComputedStyle(th).fontSize):null,
          rowH:td?Math.round(td.getBoundingClientRect().height):null};
 });
 await page.click('#openSchedule');
 await W.until(page,()=>!!document.querySelector(".sc-board-row,.sc-row-line"),null,15000);await idle();
 const sc=await page.evaluate(()=>{
  const g=s=>{const e=document.querySelector(s);return e?parseFloat(getComputedStyle(e).fontSize):null};
  const r=[...document.querySelectorAll('.sc-row-line')]
    .find(x=>/予定/.test(x.querySelector('.sc-row-cat')?.textContent||''));
  return {title:g('.sc-row-title'),time:g('.sc-row-time'),date:g('.sc-row-date'),
          shift:g('.sc-row-shift'),rel:g('.sc-row-rel'),est:g('.sc-row-est'),
          actual:g('.sc-row-actual'),head:g('.sc-row-head'),cat:g('.sc-row-cat'),
          rowH:r?Math.round(r.getBoundingClientRect().height):null};
 });
 console.log('一覧の基準',JSON.stringify(base));
 console.log('スケジュール',JSON.stringify(sc));

 rec('内容(主データ)は一覧のセルと同じ文字サイズ',sc.title===base.cell,`sc=${sc.title} / 一覧=${base.cell}`);
 rec('時刻・日付・勤務・残り・見積・実績が12px以上(以前は11px)',
  [sc.time,sc.date,sc.shift,sc.rel,sc.est,sc.actual].every(v=>v>=12),
  JSON.stringify([sc.time,sc.date,sc.shift,sc.rel,sc.est,sc.actual]));
 rec('列見出しが一覧の見出しから2段以上離れていない',Math.abs(sc.head-base.head)<=3,`sc=${sc.head} / 一覧=${base.head}`);
 // タイムラインは一覧より意図的に少しだけ密(多くの行を一度に見渡す画面)。
 // ただし「一段小さいUI」に見えるほど離してはいけない。一覧の85%以上を保つ。
 rec('行の高さが一覧の行から離れすぎていない(85%以上)',
  sc.rowH>=base.rowH*0.85&&sc.rowH<=base.rowH,`sc=${sc.rowH} / 一覧=${base.rowH} (${(sc.rowH/base.rowH*100).toFixed(0)}%)`);
 // §9.39で見出し方式を廃止し、区分は行内の列になった。列内の文字は
 // データ列と同じ水準(小さすぎない)であればよい。
 rec('区分チップの文字がデータ列と同水準',sc.cat>=12&&sc.cat<=sc.title,`cat=${sc.cat} title=${sc.title}`);

 // 表示サイズを変えても関係が保たれる
 for(const size of ['sm','lg']){
  await page.evaluate(v=>document.documentElement.setAttribute('data-ui-size',v),size);
  await paint();
  const s2=await page.evaluate(()=>{
   const g=s=>{const e=document.querySelector(s);return e?parseFloat(getComputedStyle(e).fontSize):null};
   return {title:g('.sc-row-title'),body:parseFloat(getComputedStyle(document.body).fontSize)};
  });
  rec(`表示サイズ${size}でも内容は本文と同じ大きさ`,Math.abs(s2.title-s2.body)<0.01,JSON.stringify(s2));
 }
 await page.evaluate(()=>document.documentElement.setAttribute('data-ui-size','md'));
 await paint();
 rec('横スクロールバーが出ない',await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
 await page.screenshot({path:'sched_balanced.png'});

 /* ---- 縦の間隔(§9.84) ----
    「リストの間隔が広いものと狭いものがあってバランスが悪い」という指摘。
    実測した原因は2つ:
     ・俯瞰ボードの印の欄が160px固定+折り返しで、チップが2つ付く行だけ
       背が高くなっていた(61px 対 44px)
     ・タイムラインの列見出しをまとめの箱ごとに入れており、日付＋勤務で
       まとめると18回繰り返され、行と行の間に見出し2枚+空きが挟まっていた
    どちらも「同じ意味の行は同じ高さ・同じ間隔」に揃える。 */
 await setMode('schedule');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:20000});
 await W.booted(page);
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-board-row',{timeout:20000});
 await idle();
 const board=await page.$$eval('.sc-board-row',ns=>ns.map(n=>Math.round(n.getBoundingClientRect().height)));
 rec('俯瞰ボードの行の高さが揃っている',new Set(board).size===1,`高さ=${[...new Set(board)].join('/')} (${board.length}行)`);

 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')]
   .find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await page.waitForSelector('.sc-row-line',{timeout:20000});
 await W.settleFlags(page);await paint();
 // まとめ方を変えても、列見出しは1枚・行の間隔は一定であること
 for(const mode of ['none','date','dateshift']){
  await pickView('#scGroupSelect',mode);
  await paint();
  const m=await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('.sc-row-line')];
   const heads=document.querySelectorAll('.sc-row-head').length;
   // 同じまとまりの中で連続する行どうしのピッチ
   const pitch=[];
   for(let i=1;i<rows.length;i++){
    if(rows[i].parentElement!==rows[i-1].parentElement)continue;
    if(rows[i].previousElementSibling!==rows[i-1])continue;  // 間に何か挟まる行は別扱い
    pitch.push(Math.round((rows[i].getBoundingClientRect().top-rows[i-1].getBoundingClientRect().top)*10)/10);
   }
   return {heads,rows:rows.length,pitch:[...new Set(pitch)],
           rowH:[...new Set(rows.map(r=>Math.round(r.getBoundingClientRect().height)))]};
  });
  rec(`まとめ「${mode}」で列見出しは1枚だけ`,m.heads===1,`${m.heads}枚 / ${m.rows}行`);
  rec(`まとめ「${mode}」で行の高さが揃っている`,m.rowH.length===1,m.rowH.join('/'));
  rec(`まとめ「${mode}」で連続する行の間隔が一定`,m.pitch.length<=1,m.pitch.join('/'));
 }
 await pickView('#scGroupSelect','none');
 await setMode('edit');

 /* ---- 行の高さは中身で変わらない(§9.88 段0) ----
    以前は min-height だったため、その行にだけ出るもの(開始ボタン・遅延
    バッジ・子ロットの折りたたみ等)が1pxでも高いと、その行だけ伸びていた。
    「行間がバラバラ」の正体がこれ。**縦の刻みを一定にする**のが一覧の
    読みやすさの土台なので、高さは --row-h で決め打ちにしてある。 */
 const fixed=await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('.sc-row-line')];
  if(rows.length<2)return null;
  const before=Math.round(rows[1].getBoundingClientRect().height);
  const cell=rows[1].querySelector('.sc-row-title')||rows[1].firstElementChild;
  const tall=document.createElement('div');tall.style.height='120px';
  cell.appendChild(tall);
  const after=Math.round(rows[1].getBoundingClientRect().height);
  tall.remove();
  // 行間のつまみ1本で全行が揃って動くこと(利用者が調整する土台)
  const root=document.documentElement;
  root.style.setProperty('--row-gap','10px');
  const wide=[...new Set([...document.querySelectorAll('.sc-row-line')]
    .map(x=>Math.round(x.getBoundingClientRect().height)))];
  root.style.removeProperty('--row-gap');
  const back=[...new Set([...document.querySelectorAll('.sc-row-line')]
    .map(x=>Math.round(x.getBoundingClientRect().height)))];
  return {before,after,wide,back};
 });
 rec('背の高い中身を入れても行の高さが変わらない',
   !!fixed&&fixed.before===fixed.after,fixed?`${fixed.before}px → ${fixed.after}px`:'行が足りない');
 rec('行間のつまみで全行が揃って変わる',
   !!fixed&&fixed.wide.length===1&&fixed.wide[0]>fixed.before,
   fixed?`--row-gap:10px で ${fixed.wide.join('/')}px`:'');
 rec('つまみを戻すと元の高さへ戻る',
   !!fixed&&fixed.back.length===1&&fixed.back[0]===fixed.before,
   fixed?`${fixed.back.join('/')}px`:'');
});
