/* test_wipgone.js: 外したロットを、仕掛に無ければ一覧へ戻さない（§9.368）
   ============================================================
   利用者の報告:「作業段取りから外したときに、すでに最新の仕掛データには
   載っていないものがあったとしても、外したらそのままそのロットが仕掛に
   戻ります。本来は載ってこないようにしたいです」。

   **なぜ起きるか**（この網が模す状態）: 仕掛一覧の行（`S.rows`）は
   読み込んだ時点の写しで、§9.15 はそこから「予定に居るロット」を伏せて
   いるだけ。仕掛の元データは15分に1回入れ替わるので、予定へ入れてから
   外すまでの間にその行が落ちていることがある——写しには残っているので、
   外すと戻ってきてしまう。

   ここで固定すること:
    1. **仕掛にまだ在るロットは、今までどおり戻る**（隠しすぎない）。
       確かめられないものを消すほうが危ないので、ここは緩めない。
    2. **仕掛に無いロットは戻らない**。写しに残っていても伏せる。
    3. **黙って消さない**（§3）。戻さなかった件数と理由を字で出す。
    4. **確かめるのは外したロットだけ**。予定を全部読み直さない
       ——`/api/table`への往復数を数えて見る。

   後片付けは finally で必ず行う（自分が足した予定だけを消す）。
   落ちてもブラウザを閉じる。
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
const GONE='RTGONE'+process.pid;      // 仕掛に**居ない**ロット番号（実行ごとに一意）

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 /* 「そのロットだけ」を確かめているかを見るため、仕掛への問い合わせを控える。
    **数だけでは足りない**——一覧の行ごとの追い判定（§9.94）も同じ口を使うので、
    数は画面の中身で揺れる。見たいのは「**全件を読み直していない**」ことなので、
    `filters=`が付かない大きな読み出し（＝仕掛を丸ごと辿る問い合わせ）を数える。 */
 const tableUrls=[];
 page.on('request',r=>{if(r.url().includes('/api/table?'))tableUrls.push(r.url())});
 const filterOf=u=>{
  try{return (JSON.parse(new URLSearchParams(u.split('?')[1]||'').get('filters')||'null')||[])[0]||null}
  catch(e){return null}
 };
 /* そのロット**1件だけ**を名指しで引いた問い合わせ。まとめ引き（§9.94の
    `starts_any`）は読点で複数並ぶので、こちらには数えない。 */
 const soloAsk=(lot,since)=>tableUrls.slice(since).filter(u=>{
  const f=filterOf(u);if(!f)return false;
  const vals=String(f.value||'').split(',').filter(Boolean);
  return vals.length===1&&vals[0]===lot;
 });
 /* **まとめて1往復**で引いた問い合わせ（§9.94の`starts_any`）。値は読点区切り。 */
 const batchedAsk=()=>tableUrls.map(u=>{
   const f=filterOf(u);
   return (f&&f.op==='starts_any')?String(f.value||'').split(',').filter(Boolean).length:0;
  }).filter(n=>n>=2);

 const post=(p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-wipgone'},a.b))});
  let j={};try{j=await r.json()}catch(e){j={parseError:String(e)}}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 /* **待った結果を捨てない**（§9.360）。`catch(()=>{})`で握ると、失敗が
    「古い値のまま比べて不一致」という別の顔で出て、何を待っていたのかが
    記録に残らない。**真偽で受けて、そのまま`rec`に使う。** */
 const waitOk=(fn,arg,ms=20000)=>page.waitForFunction(fn,arg,{timeout:ms}).then(()=>true,()=>false);
 const gridHas=lot=>page.evaluate(l=>{
  const t=document.querySelector('#grid tbody');
  return !!t&&t.innerText.includes(l);
 },lot);
 /* 予定を1件足す。**共有スケジュールの書込ロックは1つ**（§4.2・TTL30秒）なので、
    画面側の書込キューと重なると423で弾かれる。**空くまで試す**——ここは
    「材料を用意できたこと」を確かめたいのであって、ロックの取り合いを
    確かめたいのではない（ロックの網は`test_sclock`）。 */
 const addPlan=lot=>page.evaluate(async a=>{
  const t0=Date.now();let last=null;
  while(Date.now()-t0<20000){
   const r=await fetch('/api/schedule/plan/add',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({user_id:'test-wipgone',equipment:a.eq,kind:'作業',lotNo:a.lot})});
   let j={};try{j=await r.json()}catch(e){j={parseError:String(e)}}
   last={status:r.status,body:j};
   if(r.status!==423)return last;
   await new Promise(z=>setTimeout(z,400));    // ロックが空くのを待つ
  }
  return last;
 },{eq:EQ,lot});
 const made=[];
 /* **製品の入口を通す**——行の「外す」ボタンと確認モーダル。網のためだけの
    入口を作らない（作ると、画面から辿れない道だけが通っていることになる）。 */
 const removeRow=async id=>{
  const sel=`.sc-row-line[data-id="${id}"] .sc-row-delete`;
  await page.click(sel);
  await page.waitForSelector('#appConfirmOk',{state:'visible',timeout:10000});
  await page.click('#appConfirmOk');
  await page.waitForFunction(i=>!document.querySelector(`.sc-row-line[data-id="${i}"]`),id,{timeout:15000});
 };

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
  await post('/api/access-mode',{mode:'schedule'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await page.waitForSelector('#grid tbody tr',{timeout:30000});
  await settle();

  /* **いま一覧に見えている**ロットを1件選ぶ（＝確かに仕掛に在り、まだ予定に
     入っていない）。`S.rows`の先頭をそのまま使うと、フィクスチャの予定に
     既に入っているロットを引きうる——そのロットは最初から伏せられているので、
     「外したら戻る」を確かめたことにならない（偽の合格）。 */
  const real=await page.evaluate(()=>{
   const col=(WL.base.aliases.lotNo||[]).find(n=>S.columns.includes(n));
   const hidden=WL.scheduleView.hiddenLotSet()||new Set();
   const row=(S.rows||[]).find(r=>{
    const v=String(r[col]||'').trim();
    return v&&!hidden.has(v);
   });
   return {col,lot:row?String(row[col]).trim():'',hidden:hidden.size,rows:(S.rows||[]).length};
  });
  rec('仕掛一覧からロット番号を1件取れる', !!real.lot,
      `${real.col}=${real.lot} / 一覧${real.rows}行・伏せ${real.hidden}件`);

  /* ---- 1. 仕掛にまだ在るロットは、外したら戻る ---------------------- */
  const add1=await addPlan(real.lot);
  if(add1.body&&add1.body.id)made.push(String(add1.body.id));
  rec('仕掛に在るロットを予定へ足せた', add1.status===200&&!!(add1.body||{}).id, JSON.stringify(add1.body).slice(0,120));
  /* **行はidで待つ**——タイムラインの「内容」欄に何を出すかは設備ごとの
     設定なので、ロット番号が字として出ているとは限らない（§9.246）。 */
  await page.evaluate(()=>WL.refreshScheduleIfOpen());
  await page.waitForSelector(`.sc-row-line[data-id="${(add1.body||{}).id}"]`,{timeout:20000});
  await settle();
  rec('予定に入れたロットは仕掛一覧から消える（§9.15）', !(await gridHas(real.lot)));

  const before1=tableUrls.length;
  await removeRow(made[made.length-1]);
  const back=await waitOk(l=>{
   const t=document.querySelector('#grid tbody');return !!t&&t.innerText.includes(l);
  },real.lot);
  await settle();
  rec('仕掛に在るロットは外したら一覧へ戻る', back&&await gridHas(real.lot));
  rec('外したロットの確認は、そのロットを名指しで引く（多くて1回）',
      soloAsk(real.lot,before1).length<=1,
      `名指し${soloAsk(real.lot,before1).length}回／この間の問い合わせ${tableUrls.length-before1}回`);
  made.pop();

  /* ---- 2. 仕掛に無いロットは戻らない ------------------------------- */
  /* **写しにだけ残っている行**を作る（元データが入れ替わった状態を模す）。
     1行目を複製してロット番号だけ差し替え、先頭へ置く（仮想スクロールで
     見えない位置へ行かないように）。 */
  await page.evaluate(a=>{
   const src=(S.rows||[])[0];
   const clone=Object.assign({},src);
   clone[a.col]=a.lot;
   S.rows.unshift(clone);
   WL.list.renderGrid();
  },{col:real.col,lot:GONE});
  await settle();
  rec('写しにだけ在る行を仕掛一覧に置けた', await gridHas(GONE));

  /* 突合キー（鋳造番号）を渡さないので、サーバーの完了突合は「分からない」と
     答え、行は「予定」のまま残る（§9.367）——外せる状態でなければ、
     この不具合そのものを再現できない。 */
  const add2=await addPlan(GONE);
  if(add2.body&&add2.body.id)made.push(String(add2.body.id));
  rec('仕掛に無いロットを予定へ足せた', add2.status===200&&!!(add2.body||{}).id,
      JSON.stringify(add2.body).slice(0,160));
  await page.evaluate(()=>WL.refreshScheduleIfOpen());
  await page.waitForFunction(id=>!!document.querySelector(`.sc-row-line[data-id="${id}"]`),
    made[made.length-1],{timeout:20000}).catch(async()=>{
     const st=await page.evaluate(async e=>{
      const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e));
      const j=await r.json();
      return (j.entries||[]).slice(-4).map(x=>`${x.id}:${x.kind}:${x.state}:${x.lotNo}`).join(' | ');
     },EQ);
     rec('足した予定がタイムラインに出る', false, st);
    });
  await settle();
  const removable=await page.evaluate(id=>{
   const row=document.querySelector(`.sc-row-line[data-id="${CSS.escape(String(id))}"]`);
   return !!(row&&row.querySelector('.sc-row-delete'));
  },made[made.length-1]);
  rec('仕掛に無いロットの予定は「予定」のまま外せる（再現の前提）', removable);
  rec('予定に入れたロットは仕掛一覧から消える（写しの行でも）', !(await gridHas(GONE)));

  const before2=tableUrls.length;
  await removeRow(made[made.length-1]);
  // 在席の照会が終わって一覧が組み直されるのを待つ（条件で待つ・§9.102）
  const hidden=await waitOk(l=>{
   const t=document.querySelector('#grid tbody');
   return !!t&&!t.innerText.includes(l);
  },GONE);
  await settle();
  rec('**仕掛に無いロットは外しても一覧へ戻らない**', hidden&&!(await gridHas(GONE)));
  /* **確かめるのはそのロットだけ**（§9.368 ③）。控えにあれば往復ゼロ、
     無ければ**1件だけ**を名指しで引く——予定も仕掛も読み直さない。 */
  rec('消えていた側も、そのロットだけを名指しで引く（多くて1回）',
      soloAsk(GONE,before2).length<=1,
      `名指し${soloAsk(GONE,before2).length}回／この間の問い合わせ${tableUrls.length-before2}回`);
  rec('予定のロットはまとめて1往復で確かめる（§9.94の束ね方）',
      batchedAsk().length>=1, `まとめ引き ${batchedAsk().join('件/')}件`);
  made.pop();

  /* ---- 3. 戻さなかったことを字で言う（§3） ------------------------- */
  const toast=await page.evaluate(()=>document.querySelector('#toastArea')?.innerText||'');
  rec('戻さなかったことを画面が字で言う',
      toast.includes('戻していません'), toast.replace(/\n/g,' / ').slice(0,160));

  /* ---- 4. 一覧を取り直したら、伏せた事実も捨てる ------------------- */
  /* 取り直した一覧はもう最新なので、伏せ続ける理由が無い。**同じ行を
     置き直して見えれば**、控えが捨てられていることが外から分かる。 */
  await page.evaluate(a=>{
   window.invalidateTableCache();
   const clone=Object.assign({},(S.rows||[])[0]);
   clone[a.col]=a.lot;
   S.rows.unshift(clone);
   WL.list.renderGrid();
  },{col:real.col,lot:GONE});
  await settle();
  rec('一覧を取り直すと、伏せていたロットも伏せなくなる', await gridHas(GONE));

  rec('画面のエラーが出ていない', errs.length===0, errs.join(' / '));
 }catch(e){
  rec('例外なく最後まで進む', false, String(e).slice(0,300));
 }finally{
  try{
   for(const id of made)await post('/api/schedule/plan/delete',{equipment:EQ,id});
  }catch(e){console.log('後片付けに失敗: '+e)}
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok).length;
 console.log(`\n${R.length-ng} PASS / ${ng} FAIL`);
 process.exit(ng?1:0);
})().catch(async e=>{console.log('FATAL: '+e);if(b)await b.close();process.exit(1)});
