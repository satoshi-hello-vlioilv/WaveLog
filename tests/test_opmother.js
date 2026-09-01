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
    - 参考値（画面が値を入れる欄）は**初期値を出さない**（§4。見せ方の3つは
      §9.233 ①で持たせた——`tests/test_opunit.js`が固定する）
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
 /* 大きい選び物は浮き出しの中（§9.299）。**一度開けば描き直しても開いたまま**
    なので、窓を開くたびに1回でよい（`opState.pop`が覚えている）。 */
 /* **浮き出しは他の欄を覆う**（`position:fixed`）。実機では外側を1回押せば
    畳まれるが、`page.click()`は押す前に当たり判定をするので、開いたまま
    別の列を押すと「覆われている」で必ず失敗する。**塊を移る前に畳む**。 */
 const closePop=async()=>{
  await page.evaluate(()=>{
   const b=document.querySelector('#opItemModal [data-op-pop][aria-expanded="true"]');
   if(b)b.click();
  });
  await page.waitForFunction(()=>!document.querySelector(
    '#opItemModal [data-op-pop-panel]:not([hidden])'),null,{timeout:8000});
 };
 const openPop=async k=>{
  await page.evaluate(key=>{
   const b=document.querySelector(`#opItemModal [data-op-pop="${key}"]`);
   if(!b)throw Error('浮き出しの入口が無い: '+key);
   if(b.getAttribute('aria-expanded')!=='true')b.click();
  },k);
  await page.waitForSelector(`#opItemModal [data-op-pop-panel="${k}"]:not([hidden])`,{timeout:8000});
 };
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
  await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'tests');
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('.op-board',{timeout:20000});
  const boards=await page.$$eval('.op-board',es=>es.map(e=>e.dataset.opPlace||''));
  rec('盤に「母材」の置き場が出る（設定できる場所が画面にある）',
      boards.includes('母材'),boards.join('/'));
  /* 参考値の欄は**見せ方だけ選べる**（§9.233 ①、利用者の指示「自動で入る値に
     ついても、選んで設定できるようにしてください」）。§9.232では「選ばせ方も
     初期値も出さない」としていたが、①で**見せ方の3つ**（枠つき／文字だけ／
     強調）を持たせた。**初期値は今までどおり出さない**——打ち込む欄では
     ないので、入れても誰も読まない（§4）。 */
  await page.evaluate(id=>{const t=document.querySelector(`.op-tile[data-op-id="${id}"]`);if(t)t.click()},
    String(auto.id));
  await page.waitForFunction(()=>{const m=document.getElementById('opItemModal');return !!m&&!m.hidden},
    null,{timeout:10000});
  await page.waitForSelector('#opModalForm .op-form-sec[data-op-sec="look"]',{timeout:8000});
  await openPop('widget');
  await page.waitForTimeout(500);
  const look=await page.evaluate(()=>({
   形の数:document.querySelectorAll('[data-op-widget]').length,
   文:(document.querySelector('#opModalForm')?.textContent||'')}));
  /* **2つの事実を別々に見る**——サーバーが「この族に選ばせ方は無い」と
     答えることと、画面が枠ごと出さないこと。1つにまとめると、片方を
     壊しても もう片方が隠してしまい網が空振りする（実際にそうなった）。 */
  const famList=(await get('/api/operation-item-master')).widgetFamilies||{};
  rec('サーバーが「画面が値を入れる欄の見せ方」を答える（§9.233 ①）',
      JSON.stringify(famList.output||[])==='["プルダウン","文字だけ","強調"]',
      JSON.stringify(famList.output));
  rec('参考値の欄にも見せ方が並ぶ（§9.233 ①）',look.形の数===3,String(look.形の数));
  rec('打ち込む部品が要らない理由を文字で書く（§4）',
      /画面が値を入れます/.test(look.文)&&/見せ方/.test(look.文),
      look.文.slice(0,120));
  await page.waitForSelector('#opModalForm .op-form-sec[data-op-sec="data"]',{timeout:8000});
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
  /* ---------- マスタの到着を必ず「後」にする（§9.234 ⑧、§9.200） ----------
     測定を開く経路は`WL.opData.refresh()`を投げっぱなしで走らせ、進捗の
     チップは同じタスクで積んだ`requestAnimationFrame`が塗る。**どちらが先に
     着くかは決まっていない**ので、素のままだとマスタが先に着いた回だけ
     「直っていなくても通る」網になる（実際に、直す前でも単体では通っていた）。
     **遅らせるのは「先に取ってから届けるまで」**——`route.continue()`の前で
     待つとサーバーへ届くのが後になり、競合そのものが起きない（§9.200で
     一度踏んだ罠）。これで受け皿（8欄）の絵が必ず先に出るので、
     「割り付けの最後に塗り直す」が無ければ下の断定は必ず落ちる。 */
  await page.route('**/api/operation-form*',async route=>{
   const res=await route.fetch();
   const body=await res.text();
   await new Promise(r=>setTimeout(r,350));
   await route.fulfill({response:res,body});
  });
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
   /* **時間でなく条件で待つ**（§9.102）。操業データのマスタ
      （`/api/operation-form`）は`WL.opData.refresh()`が**投げっぱなし**で
      取りに行くので、固定待ちだと「まだ届いていない画面」を測ることになる
      ——実際、進捗の分母が受け皿の8欄のままの状態を測って通っていた
      （§9.234 ⑧）。`motherKeys()`が答えられる＝`defs`が入った、が条件。 */
   await page.waitForFunction(
     ()=>!!(window.WL&&WL.opData&&WL.opData.motherKeys&&WL.opData.motherKeys()),
     null,{timeout:20000});
   /* 割り付け（`layout()`→`apply()`）が終わって進捗が塗り直るまで1フレーム。 */
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  };
  await openMeasure();
  const shown=()=>page.evaluate(()=>{
   const box=document.querySelector('.material-grid');
   if(!box)return null;
   const vis=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0};
   /* 名前は`<span class="opf-name">`が持つ（§9.233 ⑤）。**製品と同じ
      読み方を通すこと**——ここだけ素のテキスト節点を見ていると、
      `motherFieldLabel()`が壊れても網が空振りする。 */
   const lab=el=>{
    const box=el.querySelector(':scope>.opf-name')||el;
    return [...box.childNodes].filter(n=>n.nodeType===3)
      .map(n=>n.textContent.trim()).join('').trim();
   };
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
  /* **「呼ばれること」を見る。「公開されていること」ではない**（§9.234 ⑧）。
     `window.refreshMeasureProgress`は`measure-progress.js`が無条件に公開して
     いるので、存在を見るだけの網は**不具合があっても通る**。割り付け
     （`WL.opData.layout()`）が実際に呼ぶかどうかを数える。 */
  const called=await page.evaluate(async()=>{
   const org=window.refreshMeasureProgress;
   let n=0;
   window.refreshMeasureProgress=function(){n++;return org.apply(this,arguments)};
   try{WL.opData.layout()}finally{window.refreshMeasureProgress=org}
   return n;
  });
  rec('割り付けの最後に進捗を塗り直す（無いと分母が古いまま残る）',called>0,String(called));
  /* **分母は「鍵＋丈の数」ちょうど**（§9.234 ⑧）。`分母>=鍵`では丈が必ず1本
     以上あるので**常に真＝何も確かめていない**（実際にそう書いて素通りした）。
     受け皿（`MOTHER_FIELDS_FALLBACK`）は8欄で、いま有効な欄も8欄なので、
     **全部有効なうちは古い値と新しい値が区別できない**——だから等式で締める。 */
  const vertical=await page.evaluate(()=>Number((S.measure&&S.measure.settings&&S.measure.settings.verticalCount)||1));
  rec('前提: 分母は「母材の欄数＋丈の数」ちょうど',
      before.分母===before.鍵+vertical,JSON.stringify({...before,丈:vertical}));

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
