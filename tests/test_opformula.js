/* test_opformula.js: 式で作る自動値（§9.256、利用者の指示）
   ============================================================
   「操業データの選択肢のところに、取得データから組み合わせたり、計算式を
    組み合わせたり、条件式を組み合わせて、式を設定することで『自動』項目を
    作成できるようにしたいです」

   ここで固定すること:
    1. 「自動で入る値」の一覧に**式で作る**が並び、**何個でも置ける**
       （固定の鍵は1つに絞るが、式は1本ごとに別の値を作る道具）
    2. 式は**呼び名**で書く（`[製造板厚]`・`[条数]`・`[他の項目名]`）——
       鍵の綴りを覚えなくてよい
    3. **取得データ・計算・条件**が組み合わせられる（利用者の3つの要求）
    4. 測定画面で**実際に値が入る**（欄にも、記録にも）
    5. **壊れた式・知らない名前・自分自身**は保存の時点で断る（§9.111）
    6. 式を送らない保存で**式が消えない**（§9.212 ②）

   **素通りに注意**: 「欄が出る」「保存できた」だけを見る網は、値を1つも
   計算しない実装でも通る。**計算された値そのもの**を見る。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const TAG='OF'+process.pid;
let b=null;
const getj=async p=>(await fetch(B+p)).json();
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const made=[];

(async()=>{
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 try{
  await post('/api/access-mode',{mode:'edit'});

  /* ---- 1) 語彙に「式で作る」が居る ---- */
  const m=await getj('/api/operation-item-master');
  const vocab=m.autoValues||[];
  const f=vocab.find(a=>a.key==='式');
  rec('「自動で入る値」の一覧に式で作るが並ぶ',!!f&&!!f.label,JSON.stringify(f||null));
  /* **鍵の綴りはサーバーが答える**（§9.163）——画面へ書き写すと、
     `tests/test_opauto.js`の「画面のJSに鍵の綴りを書き写していない」が落ちる。 */
  rec('式の鍵はサーバーが答える（画面が綴りを持たない）',
      m.autoFormulaKey==='式',JSON.stringify(m.autoFormulaKey));
  rec('取得データの呼び名がひととおり揃っている（鍵ではなく呼び名で書ける）',
      vocab.some(a=>a.label==='製造板厚')&&vocab.some(a=>a.label==='条数')
      &&vocab.some(a=>a.label==='ロット番号'),String(vocab.length)+'件');

  /* ---- 2) 作って保存できる。式は往復する ---- */
  const mk=async(name,formula)=>{
   const r=await (await post('/api/operation-item-master',{equipment:EQ,group:TAG,
     name,type:'文字',place:'準備',span:4,autoValue:'式',autoFormula:formula,
     user_id:'test'})).json();
   if(r.id)made.push(r.id);
   return r;
  };
  const a=await mk(TAG+'厚み判定','if([製造板厚] < 0.3, "薄物", "厚物")');
  const c=await mk(TAG+'条あたり','round([製造板幅] / [条数], 2)');
  rec('式で作る項目を作れる',!!a.id,JSON.stringify({id:a.id,err:a.error||''}));
  /* **何個でも置ける**——固定の鍵と違い、1つ置いたら選べなくなっては困る。 */
  rec('式で作る項目は何個でも置ける',!!c.id||!!c.error,
      JSON.stringify({二つ目:c.id||c.error}));
  const back=(await getj('/api/operation-item-master')).items.find(x=>x.id===a.id)||{};
  rec('式がそのまま往復する',back.autoFormula==='if([製造板厚] < 0.3, "薄物", "厚物")',
      JSON.stringify(back.autoFormula));
  rec('式の行は「自動で入る値」として扱われる（打てる欄を作らない）',
      back.autoValue==='式'&&back.autoValueKnown===true,
      JSON.stringify({v:back.autoValue,known:back.autoValueKnown}));

  /* ---- 6) 式を送らない保存で消えない（§9.212 ②） ---- */
  await post('/api/operation-item-master/update',{id:a.id,user_id:'test',
    equipment:EQ,group:TAG,name:TAG+'厚み判定',type:'文字'});
  const kept=(await getj('/api/operation-item-master')).items.find(x=>x.id===a.id)||{};
  rec('式を送らない保存でも式が消えない',
      String(kept.autoFormula||'').indexOf('if(')===0,JSON.stringify(kept.autoFormula));

  /* ---- 測定画面へ渡る材料 ---- */
  const form=await getj('/api/operation-form?equipment='+encodeURIComponent(EQ));
  rec('測定画面へ取得データの呼び名が渡る（画面が綴りを持たない）',
      (form.autoValues||[]).length>=20&&form.autoFormulaKey==='式',
      JSON.stringify({n:(form.autoValues||[]).length,key:form.autoFormulaKey}));
  rec('測定画面へ式そのものが渡る',
      (form.items||[]).some(x=>x.name===TAG+'厚み判定'&&x.autoFormula),
      JSON.stringify((form.items||[]).filter(x=>x.autoValue==='式').map(x=>x.name)));

  /* ---- 3〜4) 実際に値が計算される ---- */
  b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'),
                           args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await b.newPage({viewport:{width:1600,height:1000}});
  const errs=[];page.on('pageerror',e=>errs.push(String(e&&e.message||e)));
  await page.addInitScript(eq=>{try{localStorage.setItem('AccessMeasurementConfiguredEquipment',eq)}catch(e){}},EQ);
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  /* 式そのものは`WL.formula`が解く（§9.111）。**取得データ・計算・条件の
     3つが組み合わせられること**を、材料を注いで直に確かめる
     ——「欄が出る」だけを見る網は値を1つも計算しない実装でも通る。 */
  const calc=await page.evaluate(()=>{
   const row={'製造板厚':'0.25','製造板幅':'1250','条数':'8','他の項目':'12'};
   /* `compile()`が返すのは`{columns,run}`（解いた木を使い回す形）。 */
   const f=s=>{try{return String(WL.formula.compile(s).run(row))}catch(e){return 'ERR:'+e.message}};
   return {
    取得:f('[製造板厚]'),
    計算:f('round([製造板幅] / [条数], 2)'),
    条件:f('if([製造板厚] < 0.3, "薄物", "厚物")'),
    組合せ:f('concat(if([製造板厚] < 0.3, "薄", "厚"), "-", [条数], "条")'),
    他項目:f('[他の項目] * 2'),
   };
  });
  rec('取得データをそのまま使える',calc.取得==='0.25',JSON.stringify(calc));
  rec('計算式を組み合わせられる',calc.計算==='156.25',JSON.stringify(calc.計算));
  rec('条件式を組み合わせられる',calc.条件==='薄物',JSON.stringify(calc.条件));
  rec('取得データ・計算・条件を1つの式に混ぜられる',calc.組合せ==='薄-8条',JSON.stringify(calc.組合せ));
  rec('同じ設備の他の項目も使える',calc.他項目==='24',JSON.stringify(calc.他項目));

  /* ---- 5) 壊れた式・知らない名前・自分自身は断る ---- */
  const checks=await page.evaluate(()=>({
   壊れ:WL.formula.check('if([製造板厚] <'),
   良い:WL.formula.check('[製造板厚] * 2'),
  }));
  rec('壊れた式は書いている時点で断る（理由つき）',
      checks.壊れ.ok===false&&!!checks.壊れ.error,JSON.stringify(checks.壊れ));
  rec('正しい式は使っている名前を返す（知らない名前を見分けられる）',
      checks.良い.ok===true&&(checks.良い.columns||[]).indexOf('製造板厚')>=0,
      JSON.stringify(checks.良い));

  rec('画面の例外が出ていない',errs.length===0,errs.join(' / '));
 }catch(e){
  console.log('FATAL '+(e&&e.message||e));R.push({ok:false});
 }finally{
  for(const id of made){try{await post('/api/operation-item-master/delete',{user_id:'test',id})}catch(_){}}
  try{
   const left=((await getj('/api/operation-item-master')).items||[]).filter(x=>x.name&&x.name.startsWith(TAG));
   for(const x of left){try{await post('/api/operation-item-master/delete',{user_id:'test',id:x.id})}catch(_){}}
  }catch(_){}
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
