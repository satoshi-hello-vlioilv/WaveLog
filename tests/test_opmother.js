/* test_opmother.js: 母材の欄も操業データの項目にする（§9.232）
   ============================================================
   利用者の指示:
     「測定画面の入力内容の母材の部分も汎用設定で作った形にしたいので、
       今の項目データを抜き出し、今の汎用設定で作りこみできるように
       必要な設定を追加してください。」

   ここで固定すること:
    - 11欄が`置き場=母材`のマスタの行として届く（画面に焼き付けない）
    - 測定画面の母材の面は**群の見出し＋マスタの項目名**で組む
    - 名前を変えると測定画面の見出しが変わる（§9.228 ①と同じ道）
    - 「出さない」にすると測定画面から消える
    - **記録の鍵は変えない**（`m.mother.<key>`）——変えると過去の記録が読めない
    - 参考値（画面が値を入れる欄）は**選ばせ方も初期値も出さない**（§4）
    - マスタ管理の盤に「母材」の盤が出る
    - 器からはみ出さない
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B='http://127.0.0.1:5029';
const TAG='mo-'+Date.now().toString(36);
const post=(p,x)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(x)}).then(async r=>({st:r.status,body:await r.json().catch(()=>({}))}));
const get=p=>fetch(B+p).then(r=>r.json());
const EQ='テスト設備A';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1920,height:1080}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('dialog',d=>d.accept());
 /* 触った行は**丸ごと控えて丸ごと戻す**（§9.121）——`item_upsert`は全列を
    書くので、1項目だけ送り返すと他の設定が消える。 */
 const backup=[];
 const saveItem=async x=>post('/api/operation-item-master/update',{user_id:'tests',
   id:x.id,equipment:x.equipment||'*',group:x.group,name:x.name,type:x.type||'',
   place:x.place,span:x.span,required:!!x.required,enabled:x.enabled!==false,
   widget:x.widget,unit:x.unit||'',note:x.note||'',initial:x.initial||'',
   layout:x.layout||'自動',groupSpan:x.groupSpan||0,dummy:!!x.dummy,noBlank:!!x.noBlank,
   role:x.role||'',look:x.look||null,unitPlace:x.unitPlace,align:x.align,
   valueFormat:x.valueFormat,digits:x.digits,choice:x.choice||'',
   minFrom:x.minFrom||'',maxFrom:x.maxFrom||''});
 try{
  await post('/api/access-mode',{mode:'edit'});

  /* ==========================================================
     1) サーバー: 11欄が「置き場=母材」の行として届く
     ========================================================== */
  const form=await get('/api/operation-form?equipment='+encodeURIComponent(EQ));
  const mo=(form.items||[]).filter(x=>x.place==='母材');
  rec('母材の欄がマスタの行として届く（11欄）',mo.length===11,String(mo.length));
  const keys=mo.map(x=>x.builtin).sort().join(',');
  rec('組み込みキーは画面の欄と1対1',
      keys==='motherCalcLength,motherFront,motherFrontCard,motherFullLength,motherManual,'
            +'motherMaxCard,motherMinCard,motherOriginalWidth,motherRear,motherRearCard,motherScrapWidth',keys);
  const groups=[...new Set(mo.map(x=>x.group))];
  rec('群は「自動で出る値／全長／オフセット」の3つ',
      groups.length===3&&groups.includes('全長')&&groups.includes('オフセット')
      &&groups.includes('自動で出る値'),JSON.stringify(groups));
  /* **同じ名前を2つ並べない**（§9.113）。以前は「前オフ」が実績とカード指示の
     2箇所にあり、見出しだけが違いを引き受けていた。 */
  const names=mo.map(x=>x.name);
  rec('項目名が重ならない（見出し無しでも読み分けられる）',
      new Set(names).size===names.length,names.join('/'));
  const fam=Object.fromEntries(mo.map(x=>[x.builtin,x.widgetFamily]));
  rec('参考値3つは「画面が値を入れる欄」として届く',
      fam.motherOriginalWidth==='output'&&fam.motherScrapWidth==='output'
      &&fam.motherCalcLength==='output',JSON.stringify(fam));
  rec('打ち込む8欄は数値の欄',
      ['motherManual','motherFullLength','motherMinCard','motherMaxCard',
       'motherFront','motherRear','motherFrontCard','motherRearCard']
        .every(k=>fam[k]==='number'),JSON.stringify(fam));
  const target=mo.find(x=>x.builtin==='motherFullLength');
  const auto=mo.find(x=>x.builtin==='motherScrapWidth');
  backup.push({...target},{...auto});

  /* ==========================================================
     2) マスタ管理: 母材の盤が出て、設定窓が開く
     ========================================================== */
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:30000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintNav [data-master="opItem"]',{timeout:20000});
  await page.evaluate(()=>{const el=document.querySelector('#masterUserId');
    if(el){el.value='tests';el.dispatchEvent(new Event('change',{bubbles:true}))}});
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('.op-board',{timeout:20000});
  const boards=await page.$$eval('.op-board',es=>es.map(e=>e.dataset.opPlace||''));
  rec('盤に「母材」の置き場が出る（設定できる場所が画面にある）',
      boards.includes('母材'),boards.join('/'));
  /* 参考値の欄は**選ばせ方も初期値も出さない**（§4）。 */
  await page.evaluate(id=>{const t=document.querySelector(`.op-tile[data-op-id="${id}"]`);if(t)t.click()},
    String(auto.id));
  await page.waitForFunction(()=>{const m=document.getElementById('opItemModal');return !!m&&!m.hidden},
    null,{timeout:10000});
  await page.evaluate(()=>{const t=[...document.querySelectorAll('.op-tab')]
    .find(x=>/見せ/.test(x.textContent));if(t)t.click()});
  await page.waitForTimeout(500);
  const look=await page.evaluate(()=>({
   形の数:document.querySelectorAll('[data-op-widget]').length,
   文:(document.querySelector('#opModalForm')?.textContent||'')}));
  /* **2つの事実を別々に見る**——サーバーが「この族に選ばせ方は無い」と
     答えることと、画面が枠ごと出さないこと。1つにまとめると、片方を
     壊しても もう片方が隠してしまい網が空振りする（実際にそうなった）。 */
  const famList=(await get('/api/operation-item-master')).widgetFamilies||{};
  rec('サーバーが「画面が値を入れる欄に選ばせ方は無い」と答える',
      Array.isArray(famList.output)&&famList.output.length===0,
      JSON.stringify(famList.output));
  rec('参考値の欄には選ばせ方を並べない',look.形の数===0,String(look.形の数));
  rec('選ばせ方が無い理由を文字で書く（§4）',
      /画面が値を入れます/.test(look.文)&&/決められるのは/.test(look.文),
      look.文.slice(0,120));
  await page.evaluate(()=>{const t=[...document.querySelectorAll('.op-tab')]
    .find(x=>/記録/.test(x.textContent));if(t)t.click()});
  await page.waitForTimeout(400);
  const what=await page.evaluate(()=>({
   初期値欄:!!document.getElementById('opdInitial'),
   文:(document.querySelector('#opModalForm')?.textContent||'')}));
  rec('参考値の欄には初期値の入力を出さない',what.初期値欄===false);
  rec('初期値が無い理由も文字で書く（§4）',/初期値はありません/.test(what.文),
      what.文.slice(0,120));
  await page.evaluate(()=>{const m=document.getElementById('opItemModal');if(m)m.hidden=true});

  /* ==========================================================
     3) 測定画面: 群の見出し＋マスタの名前で組む
     ========================================================== */
  const openMeasure=async()=>{
   await page.goto(B+'/',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('#openSchedule',{timeout:25000});
   await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForSelector('#openSchedule',{timeout:25000});
   await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
   await page.click('#openSchedule');
   await page.waitForSelector('.sc-row-line',{timeout:25000});
   const ok=await page.evaluate(()=>{
    const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
    if(r){r.querySelector('.sc-row-start').click();return true}return false;
   });
   if(!ok)throw Error('開始できる行が無い');
   await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
   await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
   await page.evaluate(()=>WL.measureSteps.go(2));
   await page.waitForTimeout(900);
  };
  await openMeasure();
  const shown=()=>page.evaluate(()=>{
   const box=document.querySelector('.material-grid');
   if(!box)return null;
   const vis=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0};
   const lab=el=>[...el.childNodes].filter(n=>n.nodeType===3)
     .map(n=>n.textContent.trim()).join('').trim();
   const r=box.getBoundingClientRect();
   let over=0;
   box.querySelectorAll(':scope>label').forEach(el=>{
    if(!vis(el))return;
    const q=el.getBoundingClientRect();
    over=Math.max(over,Math.round(q.right-r.right),Math.round(r.left-q.left));
   });
   return {
    見出し:[...box.querySelectorAll(':scope>.prep-head')].map(x=>x.textContent.trim()),
    欄:[...box.querySelectorAll(':scope>label')].filter(vis).map(lab),
    群:[...box.querySelectorAll(':scope>label')].filter(vis).map(x=>x.dataset.opgroup||''),
    マス:getComputedStyle(box).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
    はみ出し:over};
  });
  let v=await shown();
  rec('母材の面が組み上がる',!!v,JSON.stringify(!!v));
  rec('群の見出しが出る（全長・オフセット・自動で出る値）',
      v&&['全長','オフセット','自動で出る値'].every(g=>v.見出し.includes(g)),
      JSON.stringify(v&&v.見出し));
  rec('欄はマスタの項目名で出る（画面に焼き付けない）',
      v&&v.欄.includes('MIN（カード指示）')&&v.欄.includes('前オフ（カード指示）'),
      JSON.stringify(v&&v.欄));
  rec('①準備と同じ12マスのグリッド',v&&v.マス===12,String(v&&v.マス));
  rec('器からはみ出さない',v&&v.はみ出し<=1,String(v&&v.はみ出し));

  /* **記録の鍵は変えない**（§9.232）——変えると過去の記録が読めなくなる。 */
  const kept=await page.evaluate(()=>{
   const el=document.querySelector('[data-mother="fullLength"]');
   if(!el)return null;
   el.value='1234.5';el.dispatchEvent(new Event('input',{bubbles:true}));
   el.dispatchEvent(new Event('change',{bubbles:true}));
   return String(S.measure.mother.fullLength||'');
  });
  rec('打った値は今までどおり`mother.<key>`へ入る',kept==='1234.5',String(kept));

  /* ==========================================================
     4) マスタで名前を変える／外す → 測定画面が追随する
     ========================================================== */
  await saveItem({...target,name:'全長'+TAG});
  await openMeasure();
  v=await shown();
  rec('マスタで名前を変えると測定画面の見出しが変わる',
      v&&v.欄.includes('全長'+TAG),JSON.stringify(v&&v.欄));
  /* ③の「記録した値」は`#recordedList`の1箇所（`.measure-shell`を見ると
     ②の入力欄まで入るので、何も確かめないまま通る）。 */
  const rec3=await page.evaluate(async()=>{
   const el=document.querySelector('[data-mother="fullLength"]');
   if(el){el.value='777';el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new Event('change',{bubbles:true}))}
   WL.measureSteps.go(3);
   await new Promise(r=>setTimeout(r,700));
   const box=document.getElementById('recordedList');
   return {ある:!!box,文:(box&&box.textContent||'')};
  });
  rec('前提: ③の「記録した値」の器がある（`.measure-shell`全体を見ない）',rec3.ある);
  rec('③の「記録した値」も新しい名前で出る（同じ読み方を2つ持たない）',
      rec3.ある&&rec3.文.includes('全長'+TAG),rec3.文.slice(0,140));

  /* 外す前の分母を控える。**外した欄まで数えると「どう頑張っても埋まらない
     1件」が残る**（§9.227 ③と同じ罠）。 */
  const total=()=>page.evaluate(()=>{
   const c=[...document.querySelectorAll('#measureTypeChips .type-chip')]
     .find(x=>/母材/.test(x.dataset.typeChip||''));
   const t=c&&c.querySelector('.type-chip-state')?.textContent||'';
   const m=/^(\d+)\/(\d+)$/.exec(t.trim());
   return {文:t,分母:m?Number(m[2]):null,鍵:(WL.opData.motherKeys()||[]).length};
  });
  const before=await total();
  rec('前提: 母材の進捗が「済んだ数／全部の数」で出ている',
      before.分母!==null,JSON.stringify(before));

  await saveItem({...target,name:'全長'+TAG,enabled:false});
  await openMeasure();
  v=await shown();
  rec('「出さない」にすると測定画面から消える',
      v&&!v.欄.includes('全長'+TAG),JSON.stringify(v&&v.欄));
  rec('外しても残りの欄は出たまま（面ごと消さない）',
      v&&v.欄.length>=9,String(v&&v.欄.length));
  const after=await total();
  rec('外した欄は入力数の分母から外れる（埋まらない1件を残さない）',
      after.分母===before.分母-1&&after.鍵===before.鍵-1,
      JSON.stringify({前:before,後:after}));

  console.log('\n合計 '+R.filter(r=>r.ok).length+'/'+R.length+' PASS'
    +'  (FAIL: '+R.filter(r=>!r.ok).length+')');
  process.exitCode=R.some(r=>!r.ok)?1:0;
 }catch(e){
  console.log('FATAL: '+(e&&e.message));process.exitCode=1;
 }finally{
  for(const x of backup){try{await saveItem(x)}catch(e){}}
  if(b)await b.close();
 }
})();
