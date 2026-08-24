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
 try{await post('/api/column-layout-master',{target:TARGET,clear:true,order:[],widths:{},hidden:[],names:{},formats:{},rules:{},formulas:{},locks:[],user_id:'test'})}catch(e){}
 try{await post('/api/schedule-content-master',{equipment:EQ,items:[],user_id:'test'})}catch(e){}
}
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 /* 見え方の設定（まとめ・さかのぼり・表示列・行の色・配置）は「表示」
    パネル(§9.199)の中にある。開く→選ぶ→**閉じる**まで1つの手順にする
    ——開いたままにすると、パネルが表の右上を覆って次のクリックが
    「要素が隠れている」で落ちる（実際に落ちた）。 */
 const openView=()=>page.evaluate(()=>window.WL&&WL.scheduleView&&WL.scheduleView.openViewPop&&WL.scheduleView.openViewPop());
 const closeView=()=>page.evaluate(()=>window.WL&&WL.scheduleView&&WL.scheduleView.closeViewPop&&WL.scheduleView.closeViewPop());
 const pickView=async(sel,val)=>{await openView();await page.selectOption(sel,val).catch(()=>{});await closeView()};
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
  const g=await page.evaluate(()=>{const r=document.querySelector('.sc-row-head [data-col="__time__"] .col-resize').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width}});
  /* **掴める幅**(§9.197)。ここだけ6pxで、実機で「うまく掴めない」と報告された。
     一覧・データ一覧と同じ帯（--space-2 + 2px = 10px）にそろえる。 */
  rec('取っ手の掴める幅が一覧と同じくらいある',g.w>=8,`${Math.round(g.w)}px`);
  /* **引いている最中に通信しない・離してから0.3秒でまとめて1回**(§9.197、
     利用者の指示)。以前は離した瞬間に保存し、そのあいだに共有の見張りが
     表を組み直して掴んでいた見出しごと入れ替わっていた。 */
  await page.evaluate(()=>{
   window.__wfp=[];window.__rel=0;
   document.addEventListener('mouseup',()=>{window.__rel=Date.now()},true);
   const f=window.fetch;
   window.fetch=function(u,o){
    const url=String((u&&u.url)||u||'');
    if(url.includes('/api/column-layout-master')&&o&&String(o.method||'').toUpperCase()==='POST')
     window.__wfp.push(Date.now());
    return f.apply(this,arguments);
   };
  });
  await page.mouse.move(g.x,g.y);await page.mouse.down();
  await page.mouse.move(g.x+60,g.y,{steps:8});
  const during=await page.evaluate(()=>({posts:window.__wfp.length,
   body:document.body.classList.contains('col-resizing'),
   busy:!!(window.WL&&WL.columnResize&&WL.columnResize.busy())}));
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const after=await page.evaluate(()=>({posts:window.__wfp.length,
   lag:window.__wfp.length?window.__wfp[0]-window.__rel:null,
   body:document.body.classList.contains('col-resizing'),
   busy:!!(window.WL&&WL.columnResize&&WL.columnResize.busy())}));
  rec('引いている最中は保存の通信をしない',during.posts===0,JSON.stringify(during));
  rec('引いている最中はそうと分かる（自動の読み直しを止める）',
      during.body&&during.busy,JSON.stringify(during));
  rec('離してから0.3秒ほど落ち着いてから1回だけ保存する',
      after.posts===1&&after.lag>=250,JSON.stringify(after));
  rec('離したあとは元の状態へ戻る',!after.body&&!after.busy,JSON.stringify(after));
  const w1=await page.evaluate(()=>Math.round(document.querySelector('.sc-row-head [data-col="__time__"]').getBoundingClientRect().width));
  rec('固定列の幅を取っ手で変えられる',w1>=w0+40,`${w0} -> ${w1}`);
  const s2=await saved();
  rec('変えた幅が保存される',(s2.widths||{})['__time__']>=w0+40,JSON.stringify(s2.widths));

  /* ---- 4b. 2回目・3回目の幅も掴んだ列だけが動く(§9.211 ①) ----
     **実機で報告された不具合。**「1回目はスムーズだが2回目以降はコントロール
     が効かない」。原因は`bindTimelineHeadTools`が関数の頭で
     `WL.columnLayout.get()`の**結果を束縛**していたこと——`save()`/`stage()`は
     キャッシュを新しいオブジェクトへ差し替えるので、1回保存した時点でその写しは
     切り離され、2回目以降は**1回目より前の幅**を土台に保存し直していた。
     **1回だけ引く網（上の4）はこれを素通りする。** */
  const wOf=k=>page.evaluate(kk=>{const c=document.querySelector(`.sc-row-head [data-col="${kk}"]`);
    return c?Math.round(c.getBoundingClientRect().width):0},k);
  const dragOf=async(k,dx)=>{
   /* **掴む前に表を組み直す**。現場ではこれが常に起きている——共有の見張り
      (§9.188)が10秒ごとに、結合の解決(§9.193)が描画のあとに表を作り直すので、
      2回目に掴む見出しは1回目とは**別の要素**になっている。組み直さずに
      続けて引く網は、孤児から測る不具合(§9.197)も古い写しの束縛(§9.211 ①)も
      素通りする（どちらも注入して54/54で通ることを確認済み）。 */
   await page.evaluate(()=>WL.scheduleView.render());
   await page.waitForTimeout(300);
   const gg=await page.evaluate(kk=>{
    const el=document.querySelector(`.sc-row-head [data-col="${kk}"] .col-resize`);
    if(!el)return null;const r=el.getBoundingClientRect();
    return{x:r.x+r.width/2,y:r.y+r.height/2}},k);
   if(!gg)return false;
   await page.mouse.move(gg.x,gg.y);await page.mouse.down();
   await page.mouse.move(gg.x+dx,gg.y,{steps:8});
   await page.mouse.up();
   /* 保存が戻ってから次を引く——**戻る前に引くと、直っていなくても通る**。 */
   await page.waitForTimeout(1200);
   return true;
  };
  const t1=await wOf('__time__');
  const ok2=await dragOf('__time__',50);
  const t2=await wOf('__time__');
  const ok3=ok2&&await dragOf('__time__',50);
  const t3=await wOf('__time__');
  rec('2回目の幅変更も掴んだぶんだけ動く（1回目より前の幅へ戻らない）',
      ok2&&t2-t1>=35,`${t1}→${t2}`);
  rec('3回目も続けて動く',ok3&&t3-t2>=35,`${t2}→${t3}`);
  const sMulti=await saved();
  rec('保存された幅が画面の幅と一致する（保存は一方通行）',
      ok3&&Math.abs(((sMulti.widths||{})['__time__']||0)-t3)<=4,
      JSON.stringify({保存:(sMulti.widths||{})['__time__'],画面:t3}));
  /* 掴んでいない列は動かないこと（掴んだ列だけが伸縮する。§9.208 ⑦）。 */
  const relW=await wOf('__rel__');
  await dragOf('__time__',-40);
  const relW2=await wOf('__rel__');
  rec('掴んでいない列は動かない',Math.abs(relW-relW2)<=3,`${relW}→${relW2}`);
  /* **触った幅は元へ戻してから次の節へ渡す**（§CLAUDE「前の実行の置き土産を
     疑う」の同じ話がテストの中でも起きる。ここで広げたままにすると、
     下の「空きは右」が別の幅で測ることになって落ちる）。 */
  await page.evaluate(async w=>{
   const tg=`timeline:${WL.scheduleView.equipment()}`;
   const cur=WL.columnLayout.get(tg);
   await WL.columnLayout.save(tg,{...cur,widths:{...(cur.widths||{}),__time__:w}});
   WL.scheduleView.render();
  },w1);
  await page.waitForTimeout(600);

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
  await openView();
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

  /* ---- 8. 日付は「現場歴」と「太陽暦」の2列(§9.197、利用者の指示) ----
     既定で出すのは現場歴の1列だけ（列を1本増やすと全員の画面が狭くなる）。
     太陽暦は**選べば出る**。 */
  const dateCands=await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('#lcList .lc-item')];
   const pick=k=>{const r=rows.find(x=>x.dataset.key===k);
    return r?{label:r.querySelector('.lc-name')?.textContent.trim()||'',
              on:!!r.querySelector('input[type=checkbox]')?.checked}:null};
   return {work:pick('__date__'),cal:pick('__caldate__')};
  });
  rec('日付が現場歴・太陽暦の2つの候補になっている',
      !!dateCands.work&&!!dateCands.cal
      &&dateCands.work.label.includes('現場歴')&&dateCands.cal.label.includes('太陽暦'),
      JSON.stringify(dateCands));
  rec('太陽暦は既定では出さない（現場歴だけ）',
      !!dateCands.cal&&dateCands.cal.on===false&&dateCands.work.on===true,
      JSON.stringify(dateCands));
  /* パネルのチェックで出す。**保存まで通す**——当てただけでは、次に開いた
     ときに戻るかどうかが分からない。 */
  await page.evaluate(()=>{
   const r=[...document.querySelectorAll('#lcList .lc-item')].find(x=>x.dataset.key==='__caldate__');
   const cb=r&&r.querySelector('input[type=checkbox]');
   if(cb&&!cb.checked)cb.click();
  });
  await page.waitForTimeout(400);
  await page.click('#lcSave');
  await page.waitForTimeout(1500);
  const twoDates=await page.evaluate(()=>{
   const head=[...document.querySelectorAll('.sc-row-head [data-col]')].map(h=>h.dataset.col);
   const rows=[...document.querySelectorAll('.sc-row-line')].map(r=>({
    work:r.querySelector('[data-col="__date__"]')?.textContent.trim()||'',
    cal:r.querySelector('[data-col="__caldate__"]')?.textContent.trim()||'',
    shift:r.querySelector('[data-col="__shift__"]')?.textContent.trim()||''}));
   return {head,both:head.includes('__date__')&&head.includes('__caldate__'),
           diff:rows.filter(x=>x.work&&x.cal&&x.work!==x.cal).slice(0,3),
           same:rows.filter(x=>x.work&&x.cal&&x.work===x.cal).length};
  });
  rec('選ぶと日付が2列出る',twoDates.both,JSON.stringify(twoDates.head.slice(0,6)));
  /* **中身が違うことを確かめる。** 「列が2つある」だけなら、同じ値を2箇所に
     出しているのと区別が付かない（§8）。日を跨ぐ勤務(3直)の行では、
     現場歴が前の日・太陽暦が翌日になる。 */
  rec('日を跨ぐ勤務では2つの日付が違う値になる',twoDates.diff.length>0,
      JSON.stringify(twoDates.diff));
  rec('跨がない行では同じ日付になる',twoDates.same>0,`同じ ${twoDates.same}行`);

  /* ==========================================================
     9〜13) §9.207（利用者の指示・報告）
     ========================================================== */
  /* ---- 9. 保存したらパネルが閉じる ---- */
  const closedAfterSave=await page.evaluate(()=>document.getElementById('listColumnPanel').hidden);
  rec('保存するとモーダルが閉じる（§9.207）',closedAfterSave===true,String(closedAfterSave));

  /* ---- 10. 固定列の「非表示」が開き直しても外れたまま ----
     **これが報告された不具合の真因の網**（`initialHidden`が固定列を
     無条件に「出す」へ倒していたので、開き直すとチェックが戻り、
     保存し直すと列が復活していた）。日付・時刻・残りなどが対象。 */
  const hideFixed=async key=>{
   await openView();
   await page.click('#scContentModalBtn');
   await page.waitForSelector('#listColumnPanel:not([hidden])',{timeout:8000});
   await page.waitForTimeout(600);
   await page.evaluate(k=>{
    const r=[...document.querySelectorAll('#lcList .lc-item')].find(x=>x.dataset.key===k);
    const cb=r&&r.querySelector('input[type=checkbox]');
    if(cb&&cb.checked)cb.click();
   },key);
   await page.waitForTimeout(400);
   await page.click('#lcSave');
   await page.waitForTimeout(1500);
  };
  const reopenState=async key=>{
   await openView();
   await page.click('#scContentModalBtn');
   await page.waitForSelector('#listColumnPanel:not([hidden])',{timeout:8000});
   await page.waitForTimeout(600);
   const v=await page.evaluate(k=>{
    const r=[...document.querySelectorAll('#lcList .lc-item')].find(x=>x.dataset.key===k);
    return r?!!r.querySelector('input[type=checkbox]')?.checked:null;
   },key);
   await page.evaluate(()=>WL.listColumns.close());
   await page.waitForTimeout(300);
   return v;
  };
  await hideFixed('__rel__');
  const relGone=await page.evaluate(()=>({
   head:!document.querySelector('.sc-row-head [data-col="__rel__"]'),
   cell:!document.querySelector('.sc-row-line [data-col="__rel__"]')}));
  rec('固定列（残り）を外すと表から消える',relGone.head&&relGone.cell,JSON.stringify(relGone));
  const relChecked=await reopenState('__rel__');
  rec('開き直してもチェックは外れたまま（§9.207の真因）',relChecked===false,String(relChecked));
  const s4=await saved();
  rec('外した固定列がサーバーに残る',(s4.hidden||[]).includes('__rel__'),JSON.stringify(s4.hidden));

  /* ---- 11. 操作列は右端に貼り付かない ---- */
  const actSticky=await page.evaluate(()=>{
   const c=document.querySelector('.sc-row-line [data-col="__actions__"]');
   const h=document.querySelector('.sc-row-head [data-col="__actions__"]');
   return {cell:c?getComputedStyle(c).position:'',head:h?getComputedStyle(h).position:''};
  });
  rec('操作列は普通の列（右端に貼り付けない）',
      actSticky.cell!=='sticky'&&actSticky.head!=='sticky',JSON.stringify(actSticky));

  /* ---- 12. 行の右クリックで操作と同じことができる ----
     **メニューが出るだけでは網にならない**（何が並ぶかが値打ち）ので、
     項目の文字を見る。危ない操作が下にあることも見る（§5）。 */
  await page.evaluate(()=>{
   const row=document.querySelector('.sc-row-line');
   const r=row.getBoundingClientRect();
   row.dispatchEvent(new MouseEvent('contextmenu',
     {bubbles:true,clientX:Math.round(r.left+30),clientY:Math.round(r.top+5)}));
  });
  await page.waitForSelector('.sc-row-menu',{timeout:5000});
  const rowMenu=await page.evaluate(()=>{
   const m=document.querySelector('.sc-row-menu');
   const items=[...m.querySelectorAll('button')].map(b=>b.textContent.trim());
   const danger=[...m.querySelectorAll('button')].map((b,i)=>b.classList.contains('chm-danger')?i:-1)
     .filter(i=>i>=0);
   return {head:m.querySelector('.chm-head')?.textContent.trim()||'',items,
     dangerLast:danger.length?Math.min(...danger)>=items.length-danger.length:true};
  });
  rec('行の右クリックでメニューが出る',rowMenu.items.length>0,rowMenu.items.join(' / '));
  rec('メニューにどの行かを出す',!!rowMenu.head,rowMenu.head);
  rec('表示列の設定をメニューからも開ける',
      rowMenu.items.some(t=>/表示列/.test(t)),rowMenu.items.join(' / '));
  rec('危ない操作は下へ離す（§5）',rowMenu.dangerLast===true,rowMenu.items.join(' / '));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  rec('Escでメニューが閉じる',
      await page.evaluate(()=>!document.querySelector('.sc-row-menu')));

  /* ---- 13. 計算式の列（§9.207、利用者の指示） ----
     **見出しの言葉で書けること**が値打ち（`__date__`のような内側のキーを
     覚えさせない）。**確かめるときは実際に値が出ることまで見る**——
     列が増えただけなら、式が当たっていなくても通る。 */
  page.on('dialog',d=>d.accept('計算テスト'));
  await openView();
  await page.click('#scContentModalBtn');
  await page.waitForSelector('#listColumnPanel:not([hidden])',{timeout:8000});
  await page.waitForTimeout(600);
  const addable=await page.evaluate(()=>!document.getElementById('lcAddCol').hidden);
  rec('スケジュール表でも「列を作る」が使える',addable===true,String(addable));
  await page.click('#lcAddCol');
  await page.waitForTimeout(500);
  await page.evaluate(()=>{
   const ta=document.getElementById('lcFormula');
   ta.value='concat("★",[ロット番号])';
   ta.dispatchEvent(new Event('input',{bubbles:true}));
   ta.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForTimeout(700);
  const fxState=await page.evaluate(()=>({
   ok:!!document.querySelector('.lc-fx-state.is-ok'),
   msg:document.querySelector('.lc-fx-state')?.textContent.trim()||'',
   sample:[...document.querySelectorAll('.lc-fx-samples code')].map(c=>c.textContent.trim())}));
  rec('見出しの言葉（[ロット番号]）で式を書ける',fxState.ok===true,fxState.msg);
  rec('設定画面の見本に式の結果が出る',
      fxState.sample.some(t=>t.startsWith('★')&&t.length>1),JSON.stringify(fxState.sample));
  await page.click('#lcSave');
  await page.waitForTimeout(1600);
  const fxCells=await page.evaluate(()=>({
   head:!!document.querySelector('.sc-row-head [data-col="計算テスト"]'),
   vals:[...document.querySelectorAll('.sc-row-line [data-col="計算テスト"]')]
     .map(x=>x.textContent.trim()).filter(Boolean).slice(0,3)}));
  rec('計算式の列がスケジュール表に出る',fxCells.head===true,String(fxCells.head));
  rec('計算式の結果が行に並ぶ',
      fxCells.vals.length>0&&fxCells.vals.every(t=>t.startsWith('★')),
      JSON.stringify(fxCells.vals));
  const s5=await saved();
  rec('計算式がサーバーに残る',
      /ロット番号/.test((s5.formulas||{})['計算テスト']||''),JSON.stringify(s5.formulas));

  /* ---- 13b. 計算式の列にも読み替え（表示ルール）が効く（§9.234 ⑥、利用者の報告
       「スケジュールのルール作成で、他の列のみで構成されたルールを適用した場合、
        表示が何も出ません」） ----
     以前は計算列だけが`WL.cellFormat.cell()`を通っておらず、式の結果を素で
     埋めていた。そのため読み替えも書式も色も一切乗らず、「他の列だけを見る
     ルール」で中身を作ろうとすると出るものが何も無かった。
     **素通り注意**: 「セルに文字がある」だけを見ると、式の結果が出ている
     だけの現状でも通る。①当たる行はルールの言葉＋色になること
     ②**当たらない行では式の結果がそのまま出る**こと の両方を見る。 */
  const RULE='__sctimecols_rule__';
  await post('/api/display-rule-master',{name:RULE,user_id:'test',rows:[
   /* 「区分が『完了』の行だけ」——**全行に当たる条件にしない**（当たらない
      行で式の結果が出ることを確かめられなくなる）。条件は**画面に出ている
      列の言葉**で書く（仕掛の生カラム名は予定の行に無い）。 */
   {conditions:[{left:{kind:'column',column:'区分'},op:'eq',right:{kind:'value',value:'完了'}}],
    text:'★済',color:'ok'}]});
  /* **`save()`ではなく`patch()`**（§9.212 ②）——`save()`は「全部を送る」口で、
     キャッシュを渡した内容へ丸ごと差し替えるので、`rules`だけ渡すと
     `formulas`が消えて計算列が画面から落ちる（実際に落ちた）。 */
  await page.evaluate(async(o)=>{
   const {TARGET,RULE}=o;
   const cur=WL.columnLayout.get(TARGET);
   await WL.columnLayout.patch(TARGET,{rules:Object.assign({},cur.rules,{'計算テスト':RULE})});
   WL.displayRules.forget(); await WL.displayRules.load(true);
   if(WL.scheduleView&&WL.scheduleView.render)WL.scheduleView.render();
  },{TARGET,RULE});
  await page.waitForTimeout(1200);
  const ruled=await page.evaluate(()=>{
   const cells=[...document.querySelectorAll('.sc-row-line')].map(r=>{
    const c=r.querySelector('[data-col="計算テスト"]'),cat=r.querySelector('[data-col="__cat__"]');
    return c?{cat:(cat&&cat.textContent.trim())||'',t:c.textContent.trim(),
              ok:c.classList.contains('cell-ok'),ti:c.getAttribute('title')||''}:null;
   }).filter(Boolean);
   return{当たり:cells.filter(x=>x.cat==='完了'),外れ:cells.filter(x=>x.cat!=='完了').slice(0,3),件数:cells.length};
  });
  rec('前提: 当たる行と当たらない行の両方がある（§9.234 ⑥）',
      ruled.当たり.length>0&&ruled.外れ.length>0,
      JSON.stringify({当:ruled.当たり.length,外:ruled.外れ.length,計:ruled.件数}));
  rec('計算式の列にも読み替えが効く（他の列だけの条件でも）',
      ruled.当たり.every(x=>x.t==='★済'&&x.ok===true),JSON.stringify(ruled.当たり.slice(0,2)));
  rec('当たらない行は式の結果がそのまま出る（§9.234 ⑥）',
      ruled.外れ.every(x=>x.t.startsWith('★')&&x.t!=='★済'&&x.ok===false),
      JSON.stringify(ruled.外れ));
  rec('置き換わっても元の値（式の結果）はtitleで読める',
      ruled.当たり.every(x=>x.ti.startsWith('★')&&x.ti!=='★済'),
      JSON.stringify(ruled.当たり.slice(0,1)));

  /* ---- 13c. 式が空でも「読み替えだけの列」は残る（§9.234 ⑥） ----
     以前はサーバーが空の計算式をNULLで捨てていたため、式を空にして
     読み替えだけを付けた列は保存の往復で`formulas`から消え、画面は
     「知らない列」として並びごと落としていた（＝報告の「何も出ません」）。
     **空の辞書（＝全部消す）と、キーはあるが値が空（＝式が空の計算列）は別**。 */
  await page.evaluate(async(o)=>{
   const {TARGET,RULE}=o;
   const cur=WL.columnLayout.get(TARGET);
   await WL.columnLayout.patch(TARGET,{
    order:[...(cur.order||[]).filter(k=>k!=='ルールだけ'),'ルールだけ'],
    formulas:Object.assign({},cur.formulas,{'ルールだけ':''}),
    rules:Object.assign({},cur.rules,{'ルールだけ':RULE}),
    hidden:(cur.hidden||[]).filter(k=>k!=='ルールだけ')});
   if(WL.scheduleView&&WL.scheduleView.render)WL.scheduleView.render();
  },{TARGET,RULE});
  await page.waitForTimeout(1200);
  const s6=await saved();
  rec('式が空でも読み替えだけの列はサーバーに残る（§9.234 ⑥）',
      Object.prototype.hasOwnProperty.call(s6.formulas||{},'ルールだけ')
      &&String((s6.formulas||{})['ルールだけ'])==='',JSON.stringify(s6.formulas));
  const onlyRule=await page.evaluate(()=>{
   const cells=[...document.querySelectorAll('.sc-row-line')].map(r=>{
    const c=r.querySelector('[data-col="ルールだけ"]'),cat=r.querySelector('[data-col="__cat__"]');
    return c?{cat:(cat&&cat.textContent.trim())||'',t:c.textContent.trim(),ok:c.classList.contains('cell-ok')}:null;
   }).filter(Boolean);
   return{見出し:!!document.querySelector('.sc-row-head [data-col="ルールだけ"]'),
     当たり:cells.filter(x=>x.cat==='完了'),外れ:cells.filter(x=>x.cat!=='完了').slice(0,3)};
  });
  rec('読み替えだけの列が表に出る（§9.234 ⑥）',onlyRule.見出し===true,String(onlyRule.見出し));
  rec('読み替えだけの列でも当たった行に中身が出る',
      onlyRule.当たり.length>0&&onlyRule.当たり.every(x=>x.t==='★済'&&x.ok===true),
      JSON.stringify(onlyRule.当たり.slice(0,2)));
  rec('読み替えだけの列は当たらない行では空のまま',
      onlyRule.外れ.every(x=>x.t===''),JSON.stringify(onlyRule.外れ));
  /* **後片付け**（§9.121）。足した列とルールを残すと、このあとの列幅の検査で
     列の合計が器を超えて「空きは右にできる」が成立しなくなる（実際に落ちた）。 */
  await page.evaluate(async(o)=>{
   const {TARGET}=o;
   const cur=WL.columnLayout.get(TARGET);
   const fx=Object.assign({},cur.formulas);delete fx['ルールだけ'];
   const rl=Object.assign({},cur.rules);delete rl['ルールだけ'];delete rl['計算テスト'];
   await WL.columnLayout.patch(TARGET,{
    order:(cur.order||[]).filter(k=>k!=='ルールだけ'),formulas:fx,rules:rl});
   if(WL.scheduleView&&WL.scheduleView.render)WL.scheduleView.render();
  },{TARGET});
  await page.waitForTimeout(900);
  try{await post('/api/display-rule-master/delete',{name:RULE,user_id:'test'})}catch(e){}

  /* ---- 列幅の合計が器より狭くても、決めた幅がそのまま効く（§9.209 ①） ----
     以前は「伸びる列が1つも無いときは最後の列を`minmax(w,1fr)`にする」と
     していたため、**その列だけ幅を狭められなかった**（器の余りを引き受けて
     しまう）。さらに行の下限（`--sc-row-min`）を**既定幅の合計**で決めて
     いたので、細くしても下限が下がらず余りが列へ配り直されていた。
     余りは**セルを持たない1本**が受ける。
     **確かめるときは実際に狭める操作をすること**——保存値を見るだけでは、
     配り直されて画面では戻っていることに気づけない。 */
  const before=await page.evaluate(()=>{
   const head=document.querySelector('.sc-row-head');
   const cell=head.querySelector('[data-col="__time__"]');
   const g=cell.querySelector('.col-resize').getBoundingClientRect();
   return{列:Math.round(cell.getBoundingClientRect().width),
     行:Math.round(head.getBoundingClientRect().width),
     器:Math.round(head.parentElement.clientWidth),
     x:g.x+g.width/2,y:g.y+g.height/2,
     トラック:getComputedStyle(head).gridTemplateColumns.split(' ').length,
     列数:head.querySelectorAll('[data-col]').length,
     /* 最後の列の右端から行の右端まで＝余りを受ける1本の幅。 */
     余り:Math.round(head.getBoundingClientRect().right
       -[...head.querySelectorAll('[data-col]')].pop().getBoundingClientRect().right),
     すべて:Object.fromEntries([...head.querySelectorAll('[data-col]')]
       .map(x=>[x.dataset.col,Math.round(x.getBoundingClientRect().width)]))};
  });
  await page.mouse.move(before.x,before.y);await page.mouse.down();
  await page.mouse.move(before.x-80,before.y,{steps:8});
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const narrow=await page.evaluate(()=>{
   const head=document.querySelector('.sc-row-head');
   return{列:Math.round(head.querySelector('[data-col="__time__"]').getBoundingClientRect().width),
     行:Math.round(head.getBoundingClientRect().width),
     器:Math.round(head.parentElement.clientWidth),
     余り:Math.round(head.getBoundingClientRect().right
       -[...head.querySelectorAll('[data-col]')].pop().getBoundingClientRect().right),
     すべて:Object.fromEntries([...head.querySelectorAll('[data-col]')]
       .map(x=>[x.dataset.col,Math.round(x.getBoundingClientRect().width)]))};
  });
  rec('掴んだ列がそのぶん細くなる（§9.209 ①）',
      narrow.列<=before.列-70,`${before.列} -> ${narrow.列}`);
  /* **余りは「セルを持たない1本」が受ける。** 他の列へ配り直すと、狭めた
     ぶんが隣の列を太らせるだけで、掴んだ列だけが細くなったように見えない。 */
  /* **狭めたぶんが隣の列へ回らないこと**が要点。回ると、掴んだ列だけが
     細くなったようには見えず「狭められない」と読まれる。空きは右にできる。 */
  const moved=Object.keys(before.すべて).filter(k=>k!=='__time__'
    &&Math.abs((narrow.すべて[k]||0)-before.すべて[k])>2);
  rec('狭めたぶんが他の列へ回らない（§9.209 ①）',moved.length===0,moved.join(','));
  rec('空きは右（セルを持たない1本）にできる',narrow.余り>=before.余り+50,
      JSON.stringify({前:before.余り,後:narrow.余り,列:`${before.列}->${narrow.列}`}));
  rec('余りは「セルを持たない1本」が受ける（列は増えない）',
      before.トラック===before.列数+2,
      `トラック${before.トラック} / 列${before.列数}+取っ手+余り`);

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
