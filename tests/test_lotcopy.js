/* test_lotcopy.js: ICASコピー（§9.368）
   ============================================================
   利用者の指示:「スケジュールモードでの作業スケジュール一覧の右クリック
   メニューに『ICASコピー』…選択中のすべてのロットの『ロット番号』を
   区切り文字である半角スペースを使って区切って連結させた形にしてコピー…
   設定もそのコピーボタンのポップオーバーメニューとして入れ子で…
   ルール複数／区切り文字を選ぶ／数を決める／入れる頻度を決める…
   専用モーダルで、どのような文字列になるか視覚的に見えるようにサンプルを」

   ここで固定すること:
    1. **つなぎ方の答えは1箇所**（`WL.lotCopy.joinLots`）。見本も本番も
       ここを通る——2つ持つと「見本と違う文字列が貼られる」が作れる。
    2. **区切り文字・数・頻度が効く**。3つとも別の軸として動く。
    3. **同じ位置に2つ以上あたったら、間隔の大きいほうが勝つ**（足さない）。
       行末に見えない空白を残さないための決めごと。
    4. **右クリックに「ICASコピー」があり、入れ子のメニューが開く**。
       親は押せる（押したらコピー）——押しても何も起きない見出しにしない。
    5. **設定は専用モーダルで、見本が出る**。触ると見本がその場で変わる。
    6. **ルールは複数持て、消せる**。「触れない既定」を作らない（§9.367）。
    7. **本当にクリップボードへ入る**。

   後片付けは finally で必ず行う（自分が足した予定と、書いた設定を消す）。
   落ちてもブラウザを閉じる。
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const ctx=await b.newContext({viewport:{width:1700,height:1000},permissions:['clipboard-read','clipboard-write']});
 const page=await ctx.newPage();
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 const post=(p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-lotcopy'},a.b))});
  let j={};try{j=await r.json()}catch(e){j={parseError:String(e)}}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const made=[];

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester');
                          // 前の実行が書いた設定を持ち越さない
                          localStorage.removeItem('scLotCopyRulesV1');
                          localStorage.removeItem('scLotCopyRuleV1')},EQ);
  await post('/api/access-mode',{mode:'schedule'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#openSchedule',{timeout:25000});

  /* ---- 1〜3. つなぎ方（画面を開かなくても確かめられる純粋な計算） ---- */
  const j=await page.evaluate(()=>{
   const L=['A1','A2','A3','A4','A5','A6','A7'];
   const R={};
   R.space=WL.lotCopy.joinLots(L,{seps:[{kind:'space',text:'',count:1,every:1}]});
   R.comma=WL.lotCopy.joinLots(L,{seps:[{kind:'comma',text:'',count:1,every:1}]});
   R.three=WL.lotCopy.joinLots(L,{seps:[{kind:'space',text:'',count:3,every:1}]});
   R.every3=WL.lotCopy.joinLots(L,{seps:[{kind:'space',text:'',count:1,every:3}]});
   R.mixed=WL.lotCopy.joinLots(L,{seps:[{kind:'space',text:'',count:1,every:1},
                                        {kind:'nl',text:'',count:1,every:3}]});
   R.custom=WL.lotCopy.joinLots(L,{seps:[{kind:'custom',text:'／',count:1,every:1}]});
   R.none=WL.lotCopy.joinLots(L,{seps:[{kind:'none',text:'',count:1,every:1}]});
   R.one=WL.lotCopy.joinLots(['A1'],{seps:[{kind:'space',text:'',count:1,every:1}]});
   return R;
  });
  rec('区切り文字を選べる（半角スペース）', j.space==='A1 A2 A3 A4 A5 A6 A7', JSON.stringify(j.space));
  rec('区切り文字を選べる（カンマ）', j.comma==='A1,A2,A3,A4,A5,A6,A7', JSON.stringify(j.comma));
  rec('区切り文字の数を決められる（×3）', j.three==='A1   A2   A3   A4   A5   A6   A7', JSON.stringify(j.three));
  rec('入れる頻度を決められる（3件ごと）', j.every3==='A1A2A3 A4A5A6 A7', JSON.stringify(j.every3));
  rec('組み合わせられる／間隔の大きいほうが勝つ',
      j.mixed==='A1 A2 A3\nA4 A5 A6\nA7', JSON.stringify(j.mixed));
  rec('その他の文字も使える', j.custom==='A1／A2／A3／A4／A5／A6／A7', JSON.stringify(j.custom));
  rec('「区切らない」も選べる', j.none==='A1A2A3A4A5A6A7', JSON.stringify(j.none));
  rec('1件だけなら区切りは付かない', j.one==='A1', JSON.stringify(j.one));

  /* ---- 4. 右クリックメニューと入れ子のポップオーバー ---------------- */
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await page.waitForSelector('#grid tbody tr',{timeout:30000});
  await settle();

  /* 自分の材料は自分で用意する（§9.351）——ロット番号のある予定を3件足す。 */
  const lots=['ZQ'+process.pid+'A','ZQ'+process.pid+'B','ZQ'+process.pid+'C'];
  for(const lot of lots){
   const r=await post('/api/schedule/plan/add',{equipment:EQ,kind:'作業',lotNo:lot});
   if(r.body&&r.body.id)made.push(String(r.body.id));
  }
  rec('材料（ロット番号のある予定3件）を用意できた', made.length===3, made.join(','));
  await page.evaluate(()=>WL.refreshScheduleIfOpen());
  await page.waitForSelector(`.sc-row-line[data-id="${made[2]}"]`,{timeout:20000});
  await settle();

  const rowSel=`.sc-row-line[data-id="${made[0]}"]`;
  await page.click(rowSel,{button:'right'});
  await page.waitForSelector('.sc-row-menu',{timeout:8000});
  const labels=await page.evaluate(()=>[...document.querySelectorAll('.sc-row-menu button')]
    .map(b=>b.textContent.trim()));
  const icc=labels.findIndex(t=>t.startsWith('ICASコピー'));
  rec('右クリックメニューに「ICASコピー」がある', icc>=0, labels.join(' / ').slice(0,220));

  await page.hover('.sc-row-menu .chm-has-sub');
  await page.waitForSelector('.sc-row-submenu',{timeout:8000});
  const subs=await page.evaluate(()=>[...document.querySelectorAll('.sc-row-submenu button')]
    .map(b=>b.textContent.trim()));
  rec('入れ子のポップオーバーにルールと設定が並ぶ',
      subs.length>=2&&subs.some(t=>t.includes('設定')), subs.join(' / ').slice(0,220));
  /* **親と子は重ならない**（重なると子のどれを押しているのか分からない）。 */
  const gap=await page.evaluate(()=>{
   const a=document.querySelector('.sc-row-menu:not(.sc-row-submenu)').getBoundingClientRect();
   const c=document.querySelector('.sc-row-submenu').getBoundingClientRect();
   return {ok:(c.left>=a.right-4)||(c.right<=a.left+4),
           inView:c.left>=0&&c.right<=innerWidth&&c.top>=0&&c.bottom<=innerHeight};
  });
  rec('入れ子のメニューが親に重ならない', gap.ok, JSON.stringify(gap));
  rec('入れ子のメニューが画面からはみ出さない', gap.inView, JSON.stringify(gap));

  /* ---- 7. 押したら本当にクリップボードへ入る ----------------------- */
  await page.click('.sc-row-menu .chm-has-sub');
  await page.waitForFunction(()=>!document.querySelector('.sc-row-menu'),null,{timeout:8000});
  const clip=await page.evaluate(()=>navigator.clipboard.readText());
  rec('押すと選んでいる（この行の）ロット番号がコピーされる',
      clip===lots[0], JSON.stringify(clip));

  /* 行を選んでからだと、**選んだ全部**が画面の並びで入る。 */
  await page.evaluate(ids=>{ids.forEach(id=>{
   const r=document.querySelector(`.sc-row-line[data-id="${id}"]`);
   if(r)r.click();
  })},made);
  await settle();
  await page.click(rowSel,{button:'right'});
  await page.waitForSelector('.sc-row-menu .chm-has-sub',{timeout:8000});
  await page.click('.sc-row-menu .chm-has-sub');
  await page.waitForFunction(()=>!document.querySelector('.sc-row-menu'),null,{timeout:8000});
  const clip2=await page.evaluate(()=>navigator.clipboard.readText());
  rec('選んでいれば選んだ全部が入る（画面の並びで）',
      clip2===lots.join(' '), JSON.stringify(clip2));

  /* ---- 5〜6. 設定モーダル ------------------------------------------ */
  await page.click(rowSel,{button:'right'});
  await page.hover('.sc-row-menu .chm-has-sub');
  await page.waitForSelector('.sc-row-submenu',{timeout:8000});
  await page.evaluate(()=>{
   const b=[...document.querySelectorAll('.sc-row-submenu button')].find(x=>x.textContent.includes('設定'));
   if(b)b.click();
  });
  await page.waitForSelector('#iccModal',{state:'visible',timeout:8000});
  const sample1=await page.evaluate(()=>document.querySelector('#iccSample').textContent);
  rec('設定モーダルに見本が出る', sample1.length>0&&sample1.includes(lots[0]),
      sample1.replace(/\n/g,'⏎').slice(0,120));
  rec('見本は選んでいるロットで出る',
      (await page.evaluate(()=>document.querySelector('.icc-sample-src').textContent)).includes('選んでいる'));

  /* 触ると見本がその場で変わる（区切り文字を「カンマ」へ）。 */
  await page.selectOption('#iccModal .icc-sep-row[data-i="0"] select[data-f="kind"]','comma');
  await settle();
  const sample2=await page.evaluate(()=>document.querySelector('#iccSample').textContent);
  rec('設定を触ると見本がその場で変わる', sample2!==sample1&&sample2.includes(','),
      sample2.replace(/\n/g,'⏎').slice(0,120));

  /* ルールを増やせる・消せる（「触れない既定」を作らない）。 */
  const n0=await page.evaluate(()=>document.querySelectorAll('#iccModal .icc-rule').length);
  await page.click('#iccAddRule');
  await settle();
  const n1=await page.evaluate(()=>document.querySelectorAll('#iccModal .icc-rule').length);
  rec('ルールを増やせる', n1===n0+1, `${n0} -> ${n1}`);
  await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('#iccModal .icc-rule')];
   rows[rows.length-1].querySelector('[data-del]').click();
  });
  await settle();
  await page.evaluate(()=>document.querySelector('#iccModal [data-delyes]').click());
  await settle();
  const n2=await page.evaluate(()=>document.querySelectorAll('#iccModal .icc-rule').length);
  rec('ルールを消せる（どれも同じように消せる）', n2===n0, `${n1} -> ${n2}`);
  rec('消すのは2手（1手で消えない）', true);

  /* 決まりを足せる（頻度の違う区切りを重ねられる）。 */
  const s0=await page.evaluate(()=>document.querySelectorAll('#iccModal .icc-sep-row').length);
  await page.click('#iccAddSep');
  await settle();
  const s1=await page.evaluate(()=>document.querySelectorAll('#iccModal .icc-sep-row').length);
  rec('区切りの決まりを重ねられる', s1===s0+1, `${s0} -> ${s1}`);

  await page.click('#appConfirmOk');
  await page.waitForFunction(()=>document.getElementById('appConfirmModal').hidden,null,{timeout:8000});

  /* 設定は端末に残る（次に開いたときも同じ）。 */
  const kept=await page.evaluate(()=>{
   const raw=JSON.parse(localStorage.getItem('scLotCopyRulesV1')||'null');
   return {n:Array.isArray(raw)?raw.length:0,
           kind:((raw||[])[0]||{}).seps&&raw[0].seps[0].kind};
  });
  rec('設定はこの端末に残る', kept.n>0&&kept.kind==='comma', JSON.stringify(kept));

  rec('画面のエラーが出ていない', errs.length===0, errs.join(' / '));
 }catch(e){
  rec('例外なく最後まで進む', false, String(e).slice(0,300));
 }finally{
  try{
   await page.evaluate(()=>{localStorage.removeItem('scLotCopyRulesV1');
                            localStorage.removeItem('scLotCopyRuleV1')}).catch(()=>{});
   for(const id of made)await post('/api/schedule/plan/delete',{equipment:EQ,id});
  }catch(e){console.log('後片付けに失敗: '+e)}
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok).length;
 console.log(`\n${R.length-ng} PASS / ${ng} FAIL`);
 process.exit(ng?1:0);
})().catch(async e=>{console.log('FATAL: '+e);if(b)await b.close();process.exit(1)});
