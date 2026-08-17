/* test_sctimecols.js: スケジュール表の全列を一覧と同じ仕組みへ(§9.176)
   ============================================================
   以前は内容欄(項目ごとの列)だけが列レイアウトマスタに乗っており、
   区分・作業・日付・時刻・勤務・残り・見積・実績・備考・操作の10列は
   CSSに直書きの固定列だった。「同じ仕組みを流用した」と言いながら
   流用できていたのは一部だけで、実機では
     ・掴んでも動かない列がある
     ・列幅を引いても効かない列がある
     ・右クリックのメニューが無い
     ・「表示列」から消せない列がある
   という形で出ていた。ここで固定するのは次の点。
    1. 見出しに固定列も並び、すべてが draggable + 取っ手を持つ
    2. 見出しとセルの並び・左端が一致する(キーで引く)
    3. D&Dで固定列を動かせて、列レイアウトマスタへ保存される
    4. 取っ手で幅を変えられて保存される
    5. 右クリックのメニューが開き、「この列を隠す」が効く
    6. 隠した列は見出しからもセルからも消える(数がずれない)
    7. ボタン名は他の一覧と同じ「表示列」、モーダルの見出しに設備名が出る
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const TARGET='timeline:'+EQ;
const FIXED=['__cat__','__workable__','__date__','__time__','__shift__','__rel__',
             '__est__','__actual__','__flags__','__actions__'];
let b=null;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function cleanup(){
 try{await post('/api/column-layout-master',{target:TARGET,order:[],widths:{},hidden:[],names:{},formats:{},rules:{},formulas:{},locks:[],user_id:'test'})}catch(e){}
 try{await post('/api/schedule-content-master',{equipment:EQ,items:[],user_id:'test'})}catch(e){}
}
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];page.on('pageerror',e=>errs.push(e.message));
 const heads=()=>page.evaluate(()=>[...document.querySelectorAll('.sc-row-head [data-col]')].map(h=>h.dataset.col));
 const saved=async()=>(await (await fetch(B+'/api/column-layout-master?target='+encodeURIComponent(TARGET))).json());
 try{
  await cleanup();
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.waitForTimeout(1200);
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  await page.waitForTimeout(1500);

  // ---- 1. 固定列も見出しに並ぶ / 全部が掴めて取っ手を持つ
  const h0=await heads();
  rec('見出しに固定列(区分〜操作)がすべて並ぶ',FIXED.every(k=>h0.includes(k)),
      FIXED.filter(k=>!h0.includes(k)).join(',')||h0.length+'列');
  const tools=await page.evaluate(()=>{
   const hs=[...document.querySelectorAll('.sc-row-head [data-col]')];
   return {n:hs.length,drag:hs.filter(h=>h.draggable).length,grip:hs.filter(h=>h.querySelector('.col-resize')).length};
  });
  rec('すべての見出しが掴めて右端に取っ手がある',tools.n>0&&tools.drag===tools.n&&tools.grip===tools.n,JSON.stringify(tools));

  // ---- 2. 見出しとセルの並び・左端が一致する
  const align=await page.evaluate(()=>{
   const hs=[...document.querySelectorAll('.sc-row-head [data-col]')];
   const row=document.querySelector('.sc-row-line');
   const cells=[...row.children].filter(c=>c.dataset.col);
   return {hk:hs.map(h=>h.dataset.col),ck:cells.map(c=>c.dataset.col),
    hx:hs.map(h=>Math.round(h.getBoundingClientRect().left)),
    cx:cells.map(c=>Math.round(c.getBoundingClientRect().left))};
  });
  rec('見出しとセルのキーの並びが同じ',JSON.stringify(align.hk)===JSON.stringify(align.ck),
      JSON.stringify(align.ck.slice(0,4)));
  {
   /* 左端は「セルの中の寄せ」で数px動く列がある(作業可否は中央寄せ)ので、
      **グリッドの列そのもの**が同じかを見る。ここでずれると桁が読めない。 */
   const bad=align.hk.map((k,i)=>Math.abs(align.hx[i]-align.cx[i])).filter(d=>d>6).length;
   rec('見出しとセルの左端がそろう',bad===0,'ずれた列 '+bad);
  }

  // ---- 3. D&Dで固定列を動かす
  const dnd=async(from,to)=>{
   await page.evaluate(([f,t])=>{
    const q=k=>document.querySelector(`.sc-row-head [data-col="${k}"]`);
    const a=q(f),c=q(t),dt=new DataTransfer();
    a.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
    const r=c.getBoundingClientRect();
    const at={bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.right-2,clientY:r.top+4};
    c.dispatchEvent(new DragEvent('dragover',at));
    c.dispatchEvent(new DragEvent('drop',at));
    a.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
   },[from,to]);
   await page.waitForTimeout(900);
  };
  await dnd('__cat__','__rel__');
  const h1=await heads();
  rec('固定列をD&Dで動かせる',h1.indexOf('__cat__')>h1.indexOf('__rel__'),JSON.stringify(h1.slice(0,7)));
  const s1=await saved();
  rec('動かした並びが列レイアウトマスタへ保存される',
      (s1.order||[]).indexOf('__cat__')>(s1.order||[]).indexOf('__rel__'),
      JSON.stringify((s1.order||[]).slice(0,7)));
  const rowKeys=await page.evaluate(()=>[...document.querySelector('.sc-row-line').children].filter(c=>c.dataset.col).map(c=>c.dataset.col));
  rec('セルの並びも一緒に動く',JSON.stringify(rowKeys)===JSON.stringify(h1),JSON.stringify(rowKeys.slice(0,7)));

  // ---- 4. 取っ手で幅を変える
  const w0=await page.evaluate(()=>Math.round(document.querySelector('.sc-row-head [data-col="__time__"]').getBoundingClientRect().width));
  const g=await page.evaluate(()=>{const r=document.querySelector('.sc-row-head [data-col="__time__"] .col-resize').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}});
  await page.mouse.move(g.x,g.y);await page.mouse.down();
  await page.mouse.move(g.x+60,g.y,{steps:8});await page.mouse.up();
  await page.waitForTimeout(1200);
  const w1=await page.evaluate(()=>Math.round(document.querySelector('.sc-row-head [data-col="__time__"]').getBoundingClientRect().width));
  rec('固定列の幅を取っ手で変えられる',w1>=w0+40,`${w0} -> ${w1}`);
  const s2=await saved();
  rec('変えた幅が保存される',(s2.widths||{})['__time__']>=w0+40,JSON.stringify(s2.widths));

  // ---- 5-6. 右クリックのメニュー / 隠す
  await page.click('.sc-row-head [data-col="__shift__"]',{button:'right'});
  await page.waitForTimeout(400);
  const menu=await page.evaluate(()=>{const m=document.querySelector('.col-head-menu');
   return m?{head:m.querySelector('.chm-head')?.textContent,n:m.querySelectorAll('button').length}:null});
  rec('見出しの右クリックでメニューが開く',!!menu&&menu.head==='勤務',JSON.stringify(menu));
  await page.click('.col-head-menu .chm-hide');
  await page.waitForTimeout(1200);
  const h2=await heads();
  const rowKeys2=await page.evaluate(()=>[...document.querySelector('.sc-row-line').children].filter(c=>c.dataset.col).map(c=>c.dataset.col));
  rec('隠した固定列が見出しから消える',!h2.includes('__shift__'),JSON.stringify(h2.slice(0,7)));
  rec('隠した固定列はセルからも消える(数がずれない)',
      !rowKeys2.includes('__shift__')&&rowKeys2.length===h2.length,
      `head ${h2.length} / cell ${rowKeys2.length}`);
  const s3=await saved();
  rec('隠した列が保存される',(s3.hidden||[]).includes('__shift__'),JSON.stringify(s3.hidden));

  // ---- 7. ボタン名とモーダルの見出し
  const btn=await page.evaluate(()=>{const x=document.querySelector('#scContentModalBtn');return x?{t:x.textContent.trim(),hidden:x.hidden}:null});
  rec('ボタン名が他の一覧と同じ「表示列」',!!btn&&btn.t.includes('表示列')&&!btn.t.includes('内容の項目'),JSON.stringify(btn));
  rec('編集モードでも列の設定を開ける',!!btn&&btn.hidden===false,JSON.stringify(btn));
  await page.click('#scContentModalBtn');
  await page.waitForSelector('#listColumnPanel:not([hidden])',{timeout:8000});
  await page.waitForTimeout(900);
  const title=await page.evaluate(()=>document.getElementById('lcTitle')?.textContent||'');
  rec('モーダルの見出しにどの表かが出る',title.includes('作業スケジュール表')&&title.includes(EQ),title);
  const panel=await page.evaluate(()=>({
   keys:[...document.querySelectorAll('#lcList .lc-item')].map(x=>x.dataset.key),
   calc:[...document.querySelectorAll('#lcList .lc-item[data-origin="calc"]')].map(x=>x.dataset.key),
   sample:[...document.querySelectorAll('#lcList .lc-item')].filter(x=>x.dataset.key==='__cat__')
          .map(x=>x.querySelector('.lc-eg')?.textContent.trim())[0]}));
  rec('設定パネルの候補に固定列が並ぶ',FIXED.every(k=>panel.keys.includes(k)),
      FIXED.filter(k=>!panel.keys.includes(k)).join(','));
  rec('固定列は「計算・操作」に分類される',FIXED.every(k=>panel.calc.includes(k)),
      FIXED.filter(k=>!panel.calc.includes(k)).join(','));
  /* 見本は**行の組み立てと同じ関数**を通す(§9.176)。以前はここが
     e.detail しか見ておらず、画面に出ているのに「値のある行がありません」
     と書かれていた。 */
  rec('固定列の見本に実データが出る',!!panel.sample&&!panel.sample.includes('値のある行がありません'),String(panel.sample));

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
