/* test_coltint.js: 列に一時的な色を付ける(§9.239 ⑤-3、利用者の指示)
   ============================================================
   「カラムに色を一時的に付けられる機能を実装してください。列移動させる際
    などに目印にしたいです。右クリックのメニューに実装し、解除もセットで
    お願いします。」

   ここで固定するのは次の点。
    1. 見出しの右クリックに**色の段**があり、7色から選べる
    2. 選ぶと見出しとセルの地が変わる。**表は描き直さない**
       （同じ`<table>`のまま・横スクロールの位置も保たれる）
    3. **色だけで伝えない**——いまの色は名前で出て、「この端末だけ・
       一時的」と書いてある
    4. **解除が同じ場所にある**（この列だけ／すべて）
    5. **マスタへ行っていない**（`/api/column-layout-master`が変わらない）
    6. ツールバーに「色 N列 ✕」が常時出て、押すと全部外れる
    7. 読み直しても残り、`sessionStorage`を消すと消える

   **保存値だけを見る網では捕まらない**（塗る処理が丸ごと壊れていても
   通る）ので、必ず`getComputedStyle`で**実際のセルと見出しの両方**を読む。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
run('test_coltint: 列に一時的な色を付ける(§9.239 ⑤-3、利用者の指示)', async ({page,rec,B,W,idle,errs})=>{
 /* 一覧の行が出そろうまで（以前は行数が3回続けて同じになるまで150msごとに数えていた）。 */
 const settle=async()=>{
  await idle(400,15000);
  return page.evaluate(()=>document.querySelectorAll('#grid tbody tr').length);
 };
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('aside [data-db-key]',{timeout:25000});
  /* 前の実行の置き土産を持ち込まない(§9.121)。 */
  await page.evaluate(()=>{try{sessionStorage.removeItem('WaveLogColumnTintV1')}catch(_){}} );
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('aside [data-db-key]',{timeout:25000});
  await W.booted(page);await idle();
  await page.click('aside [data-db-key]');
  await page.waitForSelector('#grid tbody tr',{timeout:25000});
  await settle();

  const target=await page.evaluate(()=>WL.list.listLayoutTarget());
  rec('この一覧のスコープが決まる',/^list:.+:.+$/.test(target),target);

  /* ---- 0) 道具が公開されている（公開漏れは黙って素通しになる） ---- */
  const api=await page.evaluate(()=>({
   有る:!!(window.WL&&WL.columnTint),
   色数:(window.WL&&WL.columnTint)?WL.columnTint.keys().length:0,
   器に印:!!document.querySelector('#grid')?.dataset.lt,
  }));
  rec('WL.columnTint が公開されている',api.有る,JSON.stringify(api));
  /* §9.286 ⑥で7色→14色。**数を決め打ちにしない**——色を足すたびにここが
     落ちるのでは、増やすこと自体が面倒になる。見るのは「色の表が1箇所に
     あって、下限の色数がある」ことと、**メニューの見本が表と一致する**こと。 */
  rec('色の表が1箇所にあり、十分な数がある',api.色数>=14,String(api.色数));
  rec('一覧の器に対象が刻まれている（別の一覧へ色が漏れない）',api.器に印,JSON.stringify(api));

  /* ---- 1) 見出しの右クリックに色の段がある ---- */
  const col=await page.evaluate(()=>{
   const th=document.querySelector('#grid thead th[data-sort-col]');
   return th?th.dataset.col:'';
  });
  rec('データ列がある',!!col,col);
  const openMenu=async c=>{
   await page.evaluate(k=>{
    const th=document.querySelector(`#grid thead th[data-col="${CSS.escape(k)}"]`);
    th.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:200}));
   },c);
   await page.waitForSelector('.col-head-menu',{timeout:5000});
  };
  await openMenu(col);
  const menu=await page.evaluate(()=>{
   const m=document.querySelector('.col-head-menu');
   return {色の数:m.querySelectorAll('.chm-tint').length,
           いまの色:[...m.querySelectorAll('.chm-label')].map(x=>x.textContent).find(t=>/^色:/.test(t))||'',
           断り:m.textContent.includes('この端末だけ')&&m.textContent.includes('一時的'),
           色名:[...m.querySelectorAll('.chm-tint span')].map(x=>x.textContent.trim()),
           解除:!!m.querySelector('.chm-tint-off'),
           全解除:!!m.querySelector('.chm-tint-clear')};
  });
  rec('右クリックのメニューの見本が色の表と一致する',menu.色の数===api.色数,
      `${menu.色の数}/${api.色数} ${JSON.stringify(menu.色名)}`);
  rec('見本には色名が文字で添えてある（色だけで伝えない）',
      menu.色名.length===api.色数&&menu.色名.every(t=>t.length>0),JSON.stringify(menu.色名));
  rec('いまの色を文字で出す',/^色: なし/.test(menu.いまの色),menu.いまの色);
  rec('「この端末だけ・一時的」と書いてある',menu.断り,String(menu.断り));
  rec('まだ色が無いときは「この列の色を外す」を出さない',!menu.解除,String(menu.解除));

  /* ---- 2) 選ぶと塗られる。表は描き直さない ---- */
  const before=await page.evaluate(()=>{
   const t=document.querySelector('#grid table');
   t.__mark=1;                                  // 同一性の目印
   const g=document.querySelector('#grid');
   g.scrollLeft=120;
   return {左:g.scrollLeft};
  });
  await page.evaluate(()=>{
   document.querySelector('.col-head-menu .chm-tint[data-tint="blue"]').click();
  });
  await W.until(page,k=>{const q=s=>document.querySelector(s);const th=q(`#grid thead th[data-col="${CSS.escape(k)}"]`);const other=q('#grid thead th[data-sort-col]:not([data-col="'+CSS.escape(k)+'"])');if(!th||!other)return false;const a=getComputedStyle(th).backgroundColor,b=getComputedStyle(other).backgroundColor;return a!==b},col,{ms:5000,what:'選んだ列の見出しが塗られる'});
  const after=await page.evaluate(k=>{
   const th=document.querySelector(`#grid thead th[data-col="${CSS.escape(k)}"]`);
   const td=document.querySelector(`#grid tbody td[data-col="${CSS.escape(k)}"]`);
   const other=document.querySelector('#grid thead th[data-sort-col]:not([data-col="'+CSS.escape(k)+'"])');
   const t=document.querySelector('#grid table');
   const g=document.querySelector('#grid');
   return {見出し:th?getComputedStyle(th).backgroundColor:'',
           セル:td?getComputedStyle(td).backgroundColor:'',
           他の見出し:other?getComputedStyle(other).backgroundColor:'',
           同じ表:t.__mark===1,左:g.scrollLeft,
           style:!!document.getElementById('wlColumnTintStyle')};
  },col);
  rec('色を付けると<style>が1枚できる',after.style,JSON.stringify(after));
  rec('見出しの地が変わる',!!after.見出し&&after.見出し!==after.他の見出し,
      JSON.stringify({付けた:after.見出し,他:after.他の見出し}));
  rec('セルの地も変わる',!!after.セル&&after.セル!=='rgba(0, 0, 0, 0)',after.セル);
  rec('表は描き直さない（同じ<table>のまま）',after.同じ表,String(after.同じ表));
  rec('横スクロールの位置が保たれる',after.左===before.左,JSON.stringify({前:before.左,後:after.左}));

  /* ---- 3) マスタへ行っていない ---- */
  const saved=await (await fetch(B+'/api/column-layout-master?target='+encodeURIComponent(target))).json();
  rec('マスタには保存しない（一時的なもの）',
      !JSON.stringify(saved).includes('blue'),JSON.stringify(saved).slice(0,120));

  /* ---- 4) ツールバーに常時出て、押すと外れる ---- */
  const chip=await page.evaluate(()=>{
   const el=document.getElementById('listTintChip');
   return el&&!el.hidden?{文字:el.textContent,説明:el.title}:null;
  });
  rec('ツールバーに「色 N列」が常時出る',!!chip&&/色 1列/.test(chip.文字),JSON.stringify(chip));
  rec('チップの説明に「マスタには保存していません」がある',
      !!chip&&chip.説明.includes('マスタには保存していません'),(chip||{}).説明);

  /* ---- 5) 読み直しても残る ---- */
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('aside [data-db-key]',{timeout:25000});
  await W.booted(page);await idle();
  await page.click('aside [data-db-key]');
  await page.waitForSelector('#grid tbody tr',{timeout:25000});
  await settle();
  const kept=await page.evaluate(k=>{
   const th=document.querySelector(`#grid thead th[data-col="${CSS.escape(k)}"]`);
   const other=document.querySelector('#grid thead th[data-sort-col]:not([data-col="'+CSS.escape(k)+'"])');
   return {色:th?getComputedStyle(th).backgroundColor:'',他:other?getComputedStyle(other).backgroundColor:''};
  },col);
  rec('読み直しても色が残る（同じタブのあいだ）',
      !!kept.色&&kept.色!==kept.他,JSON.stringify(kept));

  /* ---- 6) 解除が同じ場所にある ---- */
  await openMenu(col);
  const menu2=await page.evaluate(()=>{
   const m=document.querySelector('.col-head-menu');
   return {いまの色:[...m.querySelectorAll('.chm-label')].map(x=>x.textContent).find(t=>/^色:/.test(t))||'',
           解除:!!m.querySelector('.chm-tint-off'),
           全解除文:(m.querySelector('.chm-tint-clear')||{}).textContent||''};
  });
  rec('いまの色を名前で出す',/^色: 青/.test(menu2.いまの色),menu2.いまの色);
  rec('色が付いていれば「この列の色を外す」が出る',menu2.解除,String(menu2.解除));
  rec('「すべての色を外す」に件数が入る',/1列/.test(menu2.全解除文),menu2.全解除文);
  await page.evaluate(()=>document.querySelector('.col-head-menu .chm-tint-off').click());
  await W.until(page,k=>{const q=s=>document.querySelector(s);const th=q(`#grid thead th[data-col="${CSS.escape(k)}"]`);const other=q('#grid thead th[data-sort-col]:not([data-col="'+CSS.escape(k)+'"])');if(!th||!other)return false;const a=getComputedStyle(th).backgroundColor,b=getComputedStyle(other).backgroundColor;const c=document.getElementById('listTintChip');return a===b&&(!c||c.hidden)},col,{ms:5000,what:'色が外れてチップも消える'});
  const off=await page.evaluate(k=>{
   const th=document.querySelector(`#grid thead th[data-col="${CSS.escape(k)}"]`);
   const other=document.querySelector('#grid thead th[data-sort-col]:not([data-col="'+CSS.escape(k)+'"])');
   const chipEl=document.getElementById('listTintChip');
   return {色:th?getComputedStyle(th).backgroundColor:'',他:other?getComputedStyle(other).backgroundColor:'',
           チップ:!chipEl||chipEl.hidden};
  },col);
  rec('外すと元の地に戻る',off.色===off.他,JSON.stringify(off));
  rec('外すとツールバーのチップも消える',off.チップ,String(off.チップ));

  /* ---- 7) 番号・ボタンの列にも付けられる ---- */
  const hasSplit=await page.evaluate(()=>!!document.querySelector('#grid thead th[data-col="__split__"]'));
  if(hasSplit){
   await openMenu('__split__');
   const splitBg=await page.evaluate(()=>{const th=document.querySelector('#grid thead th[data-col="__split__"]');return th?getComputedStyle(th).backgroundColor:''});
   await page.evaluate(()=>document.querySelector('.col-head-menu .chm-tint[data-tint="amber"]').click());
   await W.until(page,was=>{const th=document.querySelector('#grid thead th[data-col="__split__"]');return !!th&&getComputedStyle(th).backgroundColor!==was},splitBg,{ms:5000,what:'分割の列が塗られる'});
   const v=await page.evaluate(()=>{
    const th=document.querySelector('#grid thead th[data-col="__split__"]');
    const td=document.querySelector('#grid tbody td[data-col="__split__"]');
    return {見出し:th?getComputedStyle(th).backgroundColor:'',
            セル:td?getComputedStyle(td).backgroundColor:''};
   });
   rec('番号・ボタンの列にも色が付く（見出しとセルの両方）',
       !!v.見出し&&!!v.セル&&v.セル!=='rgba(0, 0, 0, 0)',JSON.stringify(v));
  }else rec('「分割」の列がこの一覧にある',false,'見つからない');

  rec('画面の例外が出ていない',errs.length===0,errs.join(' / '));
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }finally{
  /* **後片付け**（§9.121）。sessionStorage は端末に残る。 */
  try{await page.evaluate(()=>{try{sessionStorage.removeItem('WaveLogColumnTintV1')}catch(_){}} )}catch(_){}
 }
}, {viewport:{width:1700,height:1000}});
