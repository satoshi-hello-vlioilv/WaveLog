/* test_opchoice.js: 選択肢の値マスタの階層化と6マスタの統合（§9.221 ②③）
   ============================================================
   利用者の指示:
     「まとまり名毎にまとめて管理したいです。まとまり名毎にさらに子マスタを
      持つような感じにしてマスタに階層構造を持たせたいです」
     「オペレータ、機器、スプール種別、内径種別、バリ揃え、コイル止めに
      ついても汎用化した操業データ項目マスタに移行させてください」

   ここで固定するのは次の点。
    1. 左＝まとまり／右＝その中の値、の2階層で出る
    2. まとまりを選ぶと、その中の値だけが出る
    3. 値を足す／消す／並べ替えるのが**そのまとまりの中で**できる
    4. まとまり名を変えると、**参照している項目の選択肢名も**変わる
    5. 使っている項目があるまとまりは**消せない**（理由が返る）
    6. 6つのマスタが**まとまりとして引ける**（表が在るだけでは通らない）
    7. 専用タブは残っていない（探す場所が1つ）
    8. **画面の高さを使い切る**（§9.222 ⑤）——外側にスクロールを出さず、
       スクロールするのはいちばん内側の一覧だけ
    9. **行を押すと汎用モーダルが開く**（§9.222 ⑥）——設備はタグ入力
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const G='回帰_選択肢'+Date.now().toString().slice(-5);
const G2=G+'_改名';
let b=null;
let madeEquipment='';
let manyGroup='';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)}).then(async r=>({status:r.status,body:await r.json()}));
const getj=p=>fetch(B+p).then(r=>r.json());
async function cleanup(){
 try{
  for(const nm of [G,G2,manyGroup].filter(Boolean))
   await post('/api/operation-choice-master/delete-group',{name:nm,user_id:'cleanup'});
  const it=await getj('/api/operation-item-master');
  for(const x of (it.items||[]))
   if(String(x.name||'').startsWith('回帰_選択肢項目'))
    await post('/api/operation-item-master/delete',{id:x.id,user_id:'cleanup'});
  for(const nm of [G,G2])await post('/api/operation-choice-master/delete-group',{name:nm,user_id:'cleanup'});
  /* 検証で作った設備も片付ける。**落ちても通る**ように名前で引き直す。 */
  if(madeEquipment){
   const eq=await getj('/api/equipment-master');
   const row=(eq.items||[]).find(x=>String(x.name)===madeEquipment);
   if(row)await post('/api/equipment-master/delete',{id:row.id,force:true,user_id:'cleanup'});
  }
 }catch(e){}
}
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];page.on('pageerror',e=>errs.push(e.message));
 try{
  await cleanup();
  await post('/api/access-mode',{mode:'edit'});

  /* ---- 1) 6つのマスタが「まとまり」として引ける ---- */
  const ch0=await getj('/api/operation-choice-master');
  const groups=(ch0.groups||[]).map(g=>g.name);
  const legacy=ch0.legacyGroups||[];
  rec('移行したまとまりの名前をサーバーが答える',
      legacy.length===7&&legacy.includes('オペレータ')&&legacy.includes('板厚測定器'),legacy.join('/'));
  /* **表が在るだけでは通らない**。値まで引けることを見る（バリ揃え・
     コイル止めは新規導入でも種を持つので、どの環境でも必ず在る）。 */
  const valuesOf=n=>(ch0.items||[]).filter(x=>x.name===n).map(x=>x.value);
  rec('バリ揃えがまとまりとして引ける',
      ['上バリ揃え','下バリ揃え','指定なし'].every(v=>valuesOf('バリ揃え').includes(v)),
      valuesOf('バリ揃え').join(','));
  rec('コイル止めがまとまりとして引ける',
      ['内巻両面テープ','指定なし'].every(v=>valuesOf('コイル止め').includes(v)),
      valuesOf('コイル止め').join(','));
  rec('まとまりの件数・使い道をサーバーが数える',
      (ch0.groups||[]).every(g=>typeof g.count==='number'&&Array.isArray(g.usedBy)),
      JSON.stringify((ch0.groups||[])[0]||{}));

  /* ---- 2) よみ・対象設備を選択肢が持てる ---- */
  await post('/api/operation-choice-master',
    {name:G,value:'あか',note:'説明あか',reading:'アカ',equipment:'テスト設備A',user_id:'test'});
  await post('/api/operation-choice-master',{name:G,value:'あお',user_id:'test'});
  const ch1=await getj('/api/operation-choice-master');
  const mine=(ch1.items||[]).filter(x=>x.name===G);
  rec('よみと対象設備を選択肢が持てる',
      mine.length===2&&mine.some(x=>x.reading==='アカ'&&x.equipment==='テスト設備A'),
      JSON.stringify(mine.map(x=>({v:x.value,r:x.reading,e:x.equipment}))));

  /* ---- 3) 画面: 左＝まとまり／右＝値 ---- */
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:15000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:8000});
  /* 更新者IDは打ち込む欄ではなくなった（§9.276 ③）。端末の覚え（localStorage）へ入れる。 */
  await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'tester');
  const menu=await page.$$eval('#masterMaintNav [data-master]',n=>n.map(x=>x.dataset.master));
  rec('専用タブ（オペレータ・機器・スプール・内径・バリ・コイル止め）を残していない',
      !['operator','device','spool','inner','burr','coilStop'].some(k=>menu.includes(k)),menu.join(','));
  rec('「選択肢の値」が1枚だけある',menu.filter(k=>k==='opChoice').length===1,menu.join(','));

  await page.evaluate(()=>{
   const b=[...document.querySelectorAll('#masterMaintNav [data-master]')]
     .find(x=>x.dataset.master==='opChoice');
   if(b)b.click();
  });
  await page.waitForSelector('.oc-edit',{timeout:8000});
  const shape=await page.evaluate(()=>({
    groups:document.querySelectorAll('.oc-groups .oc-group').length,
    hasValues:!!document.querySelector('.oc-values'),
    hasAdd:!!document.querySelector('#ocAddValue')}));
  rec('左にまとまり・右に値の2階層で出る',
      shape.groups>0&&shape.hasValues&&shape.hasAdd,JSON.stringify(shape));

  await page.evaluate(g=>{
   const b=[...document.querySelectorAll('[data-oc-group]')].find(x=>x.dataset.ocGroup===g);
   if(b)b.click();
  },G);
  await page.waitForTimeout(500);
  /* **行は読むだけ**（§9.222 ⑥）。編集は汎用モーダル1枚に寄せたので、
     行の中には入力欄が無い——値は先頭のセルの文字で見る。 */
  const picked=await page.evaluate(()=>({
    name:document.querySelector('#ocGroupName')?.value,
    rows:[...document.querySelectorAll('.oc-row[data-oc-id]')]
      .map(r=>(r.querySelector('.oc-cell')||{}).textContent||'')}));
  rec('まとまりを選ぶとその中の値だけが出る',
      picked.name===G&&picked.rows.length===2&&picked.rows.includes('あか'),JSON.stringify(picked));

  /* ---- 4) まとまり名を変えると、使っている項目も付け替わる ---- */
  const item=await post('/api/operation-item-master',
    {equipment:'*',group:'回帰',name:'回帰_選択肢項目',type:'選択',choice:G,user_id:'test'});
  rec('前提: この選択肢を使う項目を作れた',item.status===200,JSON.stringify(item.body).slice(0,80));
  const ren=await post('/api/operation-choice-master/rename-group',{from:G,to:G2,user_id:'test'});
  const after=await getj('/api/operation-item-master');
  const hit=(after.items||[]).find(x=>x.name==='回帰_選択肢項目');
  rec('まとまり名を変えると、参照している項目の選択肢名も変わる',
      ren.status===200&&hit&&hit.choice===G2,JSON.stringify({ren:ren.body,choice:hit&&hit.choice}));

  /* ---- 5) 使っているまとまりは消せない（理由が返る） ---- */
  const del=await post('/api/operation-choice-master/delete-group',{name:G2,user_id:'test'});
  rec('使っている項目があるまとまりは消せない',
      del.status===409&&/回帰_選択肢項目/.test(String(del.body.error||'')),
      String(del.body.error||del.status));

  /* ---- 6) 並べ替えがまとまりの中で効く ---- */
  const ch2=await getj('/api/operation-choice-master');
  const ids=(ch2.items||[]).filter(x=>x.name===G2).map(x=>x.id);
  await post('/api/operation-choice-master/reorder',{ids:[ids[1],ids[0]],user_id:'test'});
  const ch3=await getj('/api/operation-choice-master');
  const order=(ch3.items||[]).filter(x=>x.name===G2).map(x=>x.value);
  rec('まとまりの中で並べ替えられる',order[0]!=='あか',order.join('/'));

  /* ================================================================
     §9.221 ③の追補: **設備名を改名したら[対象設備]も追従する**
     ----------------------------------------------------------------
     作業可能設備の実体はオペレータ設備マスタから 操業データ選択肢マスタの
     `[対象設備]` へ移った。改名連動の一覧（`equipment_name_references()`）へ
     足し忘れると、VER2.44.0で一度直した「その設備を選べるはずのオペレータが
     選択肢に出てこなくなる」がそのまま再発する。
     **カンマ区切りの中の1つだけが変わること**まで見る——丸ごと比較する
     実装だと「設備A,設備B」の行が1件も当たらず、黙って旧名が残る。
     ================================================================ */
  const EQOLD='回帰設備'+Date.now().toString().slice(-5);
  const EQNEW=EQOLD+'改';
  const mkEq=await post('/api/equipment-master',{name:EQOLD,user_id:'test'});
  madeEquipment=mkEq.body&&mkEq.body.ok?EQOLD:'';
  const eqList=await getj('/api/equipment-master');
  const eqRow=(eqList.items||[]).find(x=>String(x.name)===EQOLD);
  await post('/api/operation-choice-master',
    {name:G2,value:'改名テスト',equipment:EQOLD+',テスト設備A',user_id:'test'});
  await post('/api/equipment-master/update',{id:eqRow&&eqRow.id,name:EQNEW,user_id:'test'});
  madeEquipment=EQNEW;
  const afterRename=await getj('/api/operation-choice-master');
  const moved=(afterRename.items||[]).find(x=>x.name===G2&&x.value==='改名テスト')||{};
  rec('設備名を改名すると[対象設備]も追従する',
      String(moved.equipment||'').includes(EQNEW),String(moved.equipment||'(無し)'));
  rec('同じ欄の他の設備は巻き添えにしない',
      String(moved.equipment||'').includes('テスト設備A'),String(moved.equipment||'(無し)'));

  /* ================================================================
     §9.222 ⑤: 画面の高さを使い切る（外側にスクロールを出さない）
     ----------------------------------------------------------------
     利用者の指摘「画面レイアウトを使い切れていない。使い切れていないのに
     縦スクロールバーが出る」。**値をたくさん注ぎ込んでから測ること**——
     数件では溢れの道を一度も通らず、直す前でも通る。
     ================================================================ */
  const MANY='回帰_多'+Date.now().toString().slice(-5);
  for(let i=0;i<40;i++)await post('/api/operation-choice-master',
    {name:MANY,value:'値'+String(i).padStart(2,'0'),note:'説明をそれなりの長さで '+i,
     reading:'よみ'+i,equipment:i%3===0?'テスト設備A':'',user_id:'test'});
  manyGroup=MANY;
  await page.evaluate(()=>{
   const b=[...document.querySelectorAll('#masterMaintNav [data-master]')]
     .find(x=>x.dataset.master==='opChoice');
   if(b)b.click();
  });
  await page.waitForSelector('.oc-edit',{timeout:8000});
  await page.waitForTimeout(900);
  await page.evaluate(g=>{
   const b=[...document.querySelectorAll('[data-oc-group]')].find(x=>x.dataset.ocGroup===g);
   if(b)b.click();
  },MANY);
  await page.waitForTimeout(700);
  const fill=await page.evaluate(()=>{
   const q=s=>document.querySelector(s);
   const wrap=q('.mm-list-wrap'),edit=q('.oc-edit');
   const vals=q('.oc-values'),grp=q('.oc-groups');
   const scroll=q('.oc-table-scroll'),glist=q('.oc-group-list');
   const row=q('.oc-row[data-oc-id]');
   const bottom=e=>e?Math.round(e.getBoundingClientRect().bottom):0;
   return {
    外側の縦スクロール:wrap?wrap.scrollHeight-wrap.clientHeight:null,
    左右の下端がそろう:Math.abs(bottom(vals)-bottom(grp))<=2,
    枠の中に収まる:!!edit&&bottom(edit)<=bottom(wrap)+2,
    内側が流れる:{値:scroll?scroll.scrollHeight-scroll.clientHeight:0,
                  まとまり:glist?glist.scrollHeight-glist.clientHeight:0},
    /* **溢れているかは中身の量しだい**（§9.266でヘッダーが96px→54pxになり、
       まとまりの一覧は溢れなくなった）。器が「溢れたら自分で流す」側に
       なっているか＝宣言そのものを見るほうが、中身の量に左右されない。 */
    内側が流す側:{値:scroll?getComputedStyle(scroll).overflowY:'',
                  まとまり:glist?getComputedStyle(glist).overflowY:''},
    行の横溢れ:row?row.scrollWidth-row.clientWidth:null,
    件数:document.querySelectorAll('.oc-row[data-oc-id]').length,
   };
  });
  rec('前提: 溢れるだけの値が入っている',fill.件数>=40,String(fill.件数));
  rec('外側（一覧の器）に縦スクロールを出さない',fill.外側の縦スクロール===0,
      JSON.stringify(fill));
  rec('左右のペインが枠いっぱいまで伸びて下端がそろう',
      fill.左右の下端がそろう===true&&fill.枠の中に収まる===true,JSON.stringify(fill));
  /* 外側が流れないことは1つ上で見ている。ここは**内側が流す側になっている**
     ことを見る——実際に溢れているかは中身の量しだいで、値の一覧は種を
     蒔いてあるので溢れる（そちらは実測で見る）。 */
  rec('スクロールするのはいちばん内側の一覧だけ',
      fill.内側が流れる.値>0
      &&/auto|scroll/.test(fill.内側が流す側.値)
      &&/auto|scroll/.test(fill.内側が流す側.まとまり),
      JSON.stringify({流れた:fill.内側が流れる,流す側:fill.内側が流す側}));
  rec('行が横へはみ出さない（削除ボタンが切り落とされない）',
      fill.行の横溢れ<=1,String(fill.行の横溢れ));

  /* ---- 狭い窓でも列がそろい、潰れない（§9.222 ⑥） ----
     `.oc-row`の列を`minmax(0,1fr)`と`auto`の混成で書いていたときは、
     ①`1fr`は基準0なので余りの配り直しに参加できず、隣の
     `minmax(--w-sm,--w-md)`が先に伸びて**説明の列が0pxまで潰れ**、
     ②末尾の`auto`が見出し行（空）と本文行（削除ボタン）で違う幅になり、
     **行ごとに別のグリッドなので手前の列の左端までずれた**。
     **1700pxで見ても出ない**（余りが十分ある）ので、実際に狭くして見る。 */
  await page.setViewportSize({width:1366,height:900});
  await page.waitForTimeout(400);
  const narrow=await page.evaluate(()=>{
   const head=document.querySelector('.oc-row.is-head');
   const row=document.querySelector('.oc-row[data-oc-id]');
   if(!head||!row)return {前提なし:true};
   const L=e=>[...e.children].map(c=>Math.round(c.getBoundingClientRect().left));
   const W=e=>[...e.children].map(c=>Math.round(c.getBoundingClientRect().width));
   const hl=L(head),rl=L(row);
   const ずれ=hl.map((v,i)=>Math.abs(v-(rl[i]||0)));
   return {見出し:hl,本文:rl,幅:W(row),最大ずれ:Math.max(...ずれ),
           潰れた列:W(row).filter(w=>w<8).length};
  });
  rec('狭い窓（1366px）でも見出しと本文の列がそろう',
      !narrow.前提なし&&narrow.最大ずれ<=1,JSON.stringify(narrow));
  rec('狭い窓でも0pxまで潰れる列が無い',
      !narrow.前提なし&&narrow.潰れた列===0,JSON.stringify(narrow.幅));
  await page.setViewportSize({width:1700,height:1000});
  await page.waitForTimeout(400);

  /* §9.222 ⑥: 行を押すと汎用モーダルが開き、設備はタグ入力になる。 */
  await page.click('.oc-row[data-oc-id]');
  await page.waitForTimeout(700);
  const editor=await page.evaluate(()=>{
   const m=document.getElementById('maintEditorModal');
   return {開いた:!!m&&!m.hidden,
     欄:[...document.querySelectorAll('#maintEditorForm [data-field]')].map(e=>e.dataset.field),
     設備タグ:!!document.querySelector('#maintEditorForm [data-tagfield="equipment"]'),
     サジェスト:!!document.querySelector('#maintEditorForm [data-equipment-search]')};
  });
  rec('行を押すと汎用モーダルが開く',editor.開いた===true,JSON.stringify(editor.欄));
  rec('よみ・出す・表示順も同じ窓で決められる',
      ['reading','enabledText','order'].every(k=>editor.欄.includes(k)),JSON.stringify(editor.欄));
  rec('出る設備は直接入力ではなくタグ＋サジェスト',
      editor.設備タグ===true&&editor.サジェスト===true,JSON.stringify(editor));
  /* **閉じてもまとまりが増えない**（`closeMaintEditor`の死んだ分岐を外した）。 */
  const before2=await page.evaluate(()=>document.querySelectorAll('[data-oc-group]').length);
  await page.evaluate(()=>document.getElementById('maintEditorClose')?.click());
  await page.waitForTimeout(600);
  const after2=await page.evaluate(()=>document.querySelectorAll('[data-oc-group]').length);
  rec('窓を閉じてもまとまりが増えない',after2===before2,`${before2}→${after2}`);

  /* 印は**タブを移ったら外す**（外し忘れると他の一覧がスクロールしない枠になる）。 */
  await page.evaluate(()=>{
   const b=[...document.querySelectorAll('#masterMaintNav [data-master]')]
     .find(x=>x.dataset.master==='equipment');
   if(b)b.click();
  });
  await page.waitForTimeout(900);
  const away=await page.evaluate(()=>{
   const w=document.querySelector('.mm-list-wrap');
   return {印:!!(w&&w.classList.contains('is-fill')),
           overflow:w?getComputedStyle(w).overflowY:''};
  });
  rec('他のタブへ移ると「高さを渡す」印は外れる',
      away.印===false&&away.overflow==='auto',JSON.stringify(away));

  rec('JSエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){console.log('FATAL: '+e.message);R.push({n:'FATAL',ok:false,d:e.message})}
 finally{
  await cleanup().catch(()=>{});
  await b.close();
  const ok=R.filter(x=>x.ok).length;
  console.log(`\n=== SUMMARY ===\n${ok}/${R.length} passed`);
  process.exit(ok===R.length?0:1);
 }
})();
