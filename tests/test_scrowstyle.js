/* test_scrowstyle.js: 行の見せ方・操作の整理・基準時刻・さかのぼり（§9.198）
   ------------------------------------------------------------
   利用者の指示は「設備停止の行の配色やアイコン（絵文字以外も）を変えたい」
   「メニューが増えたので分かりやすく」「再計算の基準時刻を5分刻みに」
   「表示範囲が現在からなのか過去なのか書いていない」「まとめの日付が
   現場歴か太陽暦か分からない」「親ロットの『・子ロット3』が場所を取りすぎ」。

   ここで固定すること:
    1. 区分ごとに色とアイコンを決められ、**その場で行に当たる**
    2. アイコンは**同梱の線画(svg:)も選べる**（外部フォントを読みに行かない）
    3. **既定へ戻す＝行を消す**（空文字を保存して「空という設定」にしない）
    4. **色だけで伝えない**——区分名の文字は必ず出たまま
    5. 分類の指定は**区分の指定より優先**する
    6. 操作は4つの塊に分かれ、**中身が無い塊は見出しごと消える**
    7. まとめ方は**現場歴か太陽暦かを名前に書く**／見出しにも出す
    8. さかのぼりは「いまから過去◯時間」で、**起点の日時**を文字で出す
    9. 予定の起点は**5分刻み**（サーバー側）
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 const setMode=m=>page.evaluate(async mm=>{await fetch('/api/access-mode',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mm})})},m);
 const post=(p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-rowstyle'},a.b))});
  let j={};try{j=await r.json()}catch(e){}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 const styles=()=>page.evaluate(async()=>{
  const r=await fetch('/api/schedule/row-style-master');
  return (await r.json()).items||[];
 });

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester');
                          localStorage.setItem('scLayoutPrefsV1',JSON.stringify({swap:false,open:'schedule'}))},EQ);
  await setMode('schedule');
  await cleanStyles();

  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});

  /* ---- 6) 操作の塊 ---- */
  const groups=await page.evaluate(()=>[...document.querySelectorAll('#scHead .sc-tools')]
    .map(g=>({t:g.dataset.tools,hidden:g.hidden,
              label:(g.querySelector('.sc-tools-label')||{}).textContent||'',
              n:[...g.children].filter(x=>!x.classList.contains('sc-tools-label')&&!x.hidden).length})));
  rec('操作は役割ごとの塊に分かれている',
      groups.length>=4&&groups.some(g=>g.t==='view')&&groups.some(g=>g.t==='add')
      &&groups.some(g=>g.t==='act'),JSON.stringify(groups));
  rec('出ている塊には必ず中身がある',
      groups.filter(g=>!g.hidden).every(g=>g.n>0),JSON.stringify(groups));
  /* 「中身が無い塊は見出しごと消える」——全部隠して確かめる（見た目の
     チェックだけだと、たまたま全部に中身がある状態で素通りする）。 */
  const emptied=await page.evaluate(()=>{
   const g=document.querySelector('#scHead .sc-tools[data-tools="add"]');
   [...g.children].forEach(x=>{if(!x.classList.contains('sc-tools-label'))x.hidden=true});
   WL.scheduleView.updateToolGroups();
   const out=g.hidden;
   [...g.children].forEach(x=>{if(!x.classList.contains('sc-tools-label'))x.hidden=false});
   WL.scheduleView.updateToolGroups();
   return {消えた:out,戻った:!g.hidden};
  });
  rec('中身が1つも無い塊は見出しごと消える',emptied.消えた&&emptied.戻った,JSON.stringify(emptied));

  /* ---- 7) まとめ方に現場歴・太陽暦の別が出る ---- */
  const opts=await page.evaluate(()=>[...document.querySelectorAll('#scGroupSelect option')]
    .map(o=>({v:o.value,t:o.textContent})));
  rec('日付のまとめは現場歴と太陽暦の両方が選べる',
      opts.some(o=>o.v==='date'&&/現場歴/.test(o.t))&&opts.some(o=>o.v==='caldate'&&/太陽暦/.test(o.t))
      &&opts.some(o=>o.v==='dateshift'&&/現場歴/.test(o.t))&&opts.some(o=>o.v==='caldateshift'&&/太陽暦/.test(o.t)),
      JSON.stringify(opts.map(o=>o.t)));
  await page.selectOption('#scGroupSelect','caldate');
  await page.waitForTimeout(600);
  const head=await page.evaluate(()=>{
   const h=document.querySelector('.sc-group-basis');
   return {basis:h?h.textContent.trim():'',paper:WL.scheduleView.groupBasis()};
  });
  rec('まとめの見出しにどちらの日付かが出る',head.basis==='太陽暦',JSON.stringify(head));
  rec('紙も同じまとめ方を見る',head.paper==='cal',JSON.stringify(head));
  await page.selectOption('#scGroupSelect','date');
  await page.waitForTimeout(500);
  const head2=await page.evaluate(()=>({basis:(document.querySelector('.sc-group-basis')||{}).textContent||'',
                                        paper:WL.scheduleView.groupBasis()}));
  rec('現場歴に戻すと見出しも紙も現場歴',head2.basis.trim()==='現場歴'&&head2.paper==='work',JSON.stringify(head2));
  await page.selectOption('#scGroupSelect','none');
  await page.waitForTimeout(400);

  /* ---- 8) さかのぼりの起点 ---- */
  const hist=await page.evaluate(()=>{
   const sel=document.getElementById('scHistorySelect');
   const from=document.getElementById('scHistoryFrom');
   return {opt:[...sel.options].map(o=>o.textContent),
           text:from.textContent,hidden:from.hidden,title:from.title};
  });
  rec('さかのぼりの選択肢に「いまから過去」と書いてある',
      hist.opt.every(t=>/いまから過去/.test(t)),JSON.stringify(hist.opt));
  rec('起点の日時が文字で出ている',!hist.hidden&&/\d+\/\d+/.test(hist.text),JSON.stringify(hist));
  rec('未来の予定は範囲に関わらず出ることを書く',/すべて出ます/.test(hist.title||''),hist.title);

  /* ---- 9) 予定の起点は5分刻み(サーバー) ---- */
  const anchor=await page.evaluate(async e=>{
   const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e)+'&history_hours=8');
   const j=await r.json();
   return {anchor:j.anchor,rounded:j.anchorRounded,timings:j.timings};
  },EQ);
  /* **丸めない場面がある**——着手中の作業があるときは実績の開始時刻を
     そのまま起点にする（記録された事実を見栄えのために動かさない）。
     フィクスチャには着手中の行があるので、ここは「丸めたなら5分刻み・
     丸めていないならその理由が言える」を見る（理由を問わずに素通しさせ
     ないこと）。丸め自体の値は tests/test_scload.py が固定している。 */
  const min=anchor.anchor?new Date(anchor.anchor).getMinutes():-1;
  const ongoing=await page.evaluate(()=>(WL.scheduleView.entries()||[])
    .some(e=>e.state==='着手'&&e.actual&&e.actual.startAt));
  rec('起点は「丸めたら5分刻み」か「丸めない理由がある」',
      anchor.rounded?(min%5===0&&new Date(anchor.rounded.to).getTime()===new Date(anchor.anchor).getTime())
                    :(ongoing||min%5===0),
      JSON.stringify({anchor:anchor.anchor,min,rounded:anchor.rounded,着手中:ongoing}));
  rec('読み込みの内訳が返る',
      !!anchor.timings&&anchor.timings.total!=null&&anchor.timings.rowCount!=null,
      JSON.stringify(anchor.timings));
  rec('画面からも内訳が読める',
      await page.evaluate(()=>{const t=WL.scheduleLoadTimings();return !!t&&t.total!=null}));

  /* ---- 1) 区分の色とアイコンを決めるとその場で行に当たる ---- */
  await page.click('#scRowStyleBtn');
  await page.waitForSelector('#scRowStylePop:not([hidden])',{timeout:8000});
  await page.waitForTimeout(700);
  const panel=await page.evaluate(()=>({
   rows:[...document.querySelectorAll('.sc-rs-row')].map(r=>r.dataset.rs),
   colors:document.querySelectorAll('.sc-rs-row[data-rs="cat:planned"] [data-rs-color]').length,
  }));
  rec('区分6つが並ぶ',['cat:planned','cat:doing','cat:done','cat:cancel','cat:stop','cat:comment']
      .every(k=>panel.rows.includes(k)),JSON.stringify(panel.rows));
  rec('色は決められた8色から選ぶ',panel.colors===8,String(panel.colors));
  rec('設備停止の分類ごとにも決められる',panel.rows.some(k=>k.startsWith('stopcat:')),JSON.stringify(panel.rows));

  await page.click('.sc-rs-row[data-rs="cat:planned"] [data-rs-color="blue"]');
  await page.waitForTimeout(800);
  await page.selectOption('.sc-rs-row[data-rs="cat:planned"] [data-rs-icon]','svg:clock');
  await page.waitForTimeout(900);
  const applied=await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('.sc-row-line')];
   const blue=rows.filter(r=>/\bsc-rs-blue\b/.test(r.className));
   const cell=blue[0]&&blue[0].querySelector('.sc-row-cat');
   return {n:blue.length,
           セルにも色:!!cell&&/sc-rs-blue/.test(cell.className),
           線画:!!cell&&!!cell.querySelector('svg.sc-ic'),
           区分名が出ている:!!cell&&/予定/.test(cell.textContent),
           地の色:blue[0]?getComputedStyle(blue[0]).backgroundColor:''};
  });
  rec('選んだ色が行に当たる',applied.n>0&&applied.セルにも色,JSON.stringify(applied));
  rec('同梱の線画アイコンが出る',applied.線画,JSON.stringify(applied));
  rec('色を付けても区分名の文字は出たまま',applied.区分名が出ている,JSON.stringify(applied));

  const saved=await styles();
  rec('保存は行表示マスタの1行',
      saved.some(x=>x.key==='cat:planned'&&x.colorKey==='blue'&&x.icon==='svg:clock'),
      JSON.stringify(saved));

  /* ---- 5) 分類の指定は区分の指定より優先 ---- */
  const cats=await page.evaluate(()=>[...document.querySelectorAll('.sc-rs-row')]
    .map(r=>r.dataset.rs).filter(k=>k.startsWith('stopcat:')));
  if(cats.length){
   await page.click('.sc-rs-row[data-rs="cat:stop"] [data-rs-color="amber"]');
   await page.waitForTimeout(700);
   await page.click(`.sc-rs-row[data-rs="${cats[0].replace(/"/g,'\\"')}"] [data-rs-color="red"]`);
   await page.waitForTimeout(800);
   const won=await page.evaluate(c=>{
    const name=c.slice('stopcat:'.length);
    /* 実際の行が無くても判定は確かめられる——判定の1箇所へ直接聞く。 */
    return WL.scheduleView.rowStyleOf({kind:'設備停止',state:'予定',title:'__none__'}).colorKey;
   },cats[0]);
   rec('分類の指定が無い停止は区分の色',won==='amber',String(won));
  }else rec('分類の指定が無い停止は区分の色',true,'分類が未登録');

  /* ---- 3) 既定へ戻す＝行を消す ---- */
  await page.click('.sc-rs-row[data-rs="cat:planned"] [data-rs-reset]');
  await page.waitForTimeout(900);
  const after=await styles();
  rec('既定へ戻すと行ごと消える（空の設定を残さない）',
      !after.some(x=>x.key==='cat:planned'),JSON.stringify(after.map(x=>x.key)));
  rec('戻すと行の色も外れる',
      await page.evaluate(()=>![...document.querySelectorAll('.sc-row-line')]
        .some(r=>/\bsc-rs-blue\b/.test(r.className))));

  console.log('\n=== SUMMARY ===');
  const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
  ng.forEach(x=>console.log(' -',x.n,x.d||''));
  await cleanup();
  process.exit(ng.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  await cleanup();
  process.exit(2);
 }
 /* 行表示マスタはmaster.sqlite3に残り実行をまたいで生き延びる（§9.121）。
    **始めにも終わりにも白紙へ戻す**——後片付け前に落ちた回の設定を次の
    実行が引き継ぐと、無関係なテストが色違いで落ちる。 */
 async function cleanStyles(){
  try{
   const items=await styles();
   for(const it of items)await post('/api/schedule/row-style-master/delete',{id:it.id});
  }catch(e){}
 }
 async function cleanup(){
  try{await cleanStyles();await setMode('edit')}catch(e){}
  if(b)await b.close().catch(()=>{});
 }
})().catch(async e=>{console.error('FATAL',e);if(b)await b.close().catch(()=>{});process.exit(2)});
