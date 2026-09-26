/* test_reccols.js: データ一覧の表示列（§9.162）
   ============================================================
   仕掛一覧・作業スケジュールの内容欄と**同じパネル**で決める。設定画面を
   2つ持たないのがこの機能の主旨なので、ここで固定するのは
   「同じパネルが開く」「既定の見え方が変わっていない」「触った結果が
   一覧に出る」「保存して開き直しても残る」の4点。

   **既定の15列と並びが今までと同じであること**が一番大事。候補は44列
   あるので、`initialHidden`が効いていないと保存した瞬間に見覚えの無い
   29列が並ぶ（§9.120で内容欄が踏んだのと同じ罠）。

   後片付けは finally で必ず行う。**列レイアウトマスタは実行をまたいで
   生き延びる**（§9.121）ので、消し忘れると次の実行が引き継ぐ。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
/* 材料は自分で注ぎ込む（§9.351・§9.362 ⑥）。この網は「取り込める記録が
   ある」ことを前提にするが、**フィクスチャに記録は無い**——今まで見えて
   いたのは前の実行の置き土産で、ランナーが実績を1本ごとに空へ戻すように
   なった（§9.362 ①）とたんに0行になった。片付けは`clearRecords()`。 */
const {seedRecord,clearRecords}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const TARGET='records:list';
/* 今まで出ていた15列。**この並びを変えないこと**（設定していない端末の
   見え方を変えないため）。 */
const DEFAULT_HEAD=['状態','ロット番号','検査番号','製造材質','製造板厚','用途名','コース',
                    'オペレータ','検査員','作業人数','分割','作業開始時刻','更新日時',
                    '実作業時間','操作'];
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function cleanup(){
 try{await post('/api/column-layout-master',{target:TARGET,clear:true,order:[],widths:{},hidden:[],
      names:{},formats:{},rules:{},formulas:{},locks:[],user_id:'test'})}catch(e){}
}
const settle=async page=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))};
const head=page=>page.evaluate(()=>[...document.querySelectorAll('.record-list-head>span')].map(s=>s.textContent.trim()));
async function openList(page){
 await page.evaluate(()=>WL.records.openRecordsSafe('編集中'));
 await page.waitForSelector('.record-list-head',{timeout:20000});
 await settle(page);
}
run('test_reccols: データ一覧の表示列（§9.162）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 await cleanup();
 await seedRecord();
 page.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:30000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await openList(page);

  /* ---- 1) 既定の見え方が変わっていない ---- */
  const h0=await head(page);
  rec('既定は今までの15列で並びも同じ',JSON.stringify(h0)===JSON.stringify(DEFAULT_HEAD),
      h0.join('／'));
  const cols0=await page.evaluate(()=>getComputedStyle(document.getElementById('recordList'))
    .getPropertyValue('--rec-cols').trim());
  rec('列幅はJSが--rec-colsへ入れている',cols0.split(')').length-1>=15,
      cols0.slice(0,60)+'…');

  /* ---- 2) 「表示列」ボタンで**同じパネル**が開く ---- */
  const btn=await page.$('#recordColumnsBtn');
  rec('「表示列」ボタンがある',!!btn);
  /* ---- §9.507 帯は仕掛一覧と同じ部品・同じ言葉・同じ並び ----
     前: 「絞り込み」の名前＋欄の字「…で検索」／「検索解除」（欄の ✕ と同じ働き）／「並び順」／
     「0 / 0件を表示」／表示列に印が無い／名前と件数だけ11px。 */
  const band=await page.evaluate(()=>{
   const bar=document.getElementById('recordSearchBar');
   const order=['recordSearch','recordSearchResult','recordSort','recordColumnsBtn']
     .map(id=>[...bar.querySelectorAll('*')].indexOf(document.getElementById(id)));
   return {fs:(sel=>{
   const vis=e=>{const r=e.getBoundingClientRect();return r.width>1&&r.height>1&&!e.closest('[hidden]')};
   const bar=document.querySelector(sel);
   const txt=[...bar.querySelectorAll('*')].filter(e=>vis(e)&&!e.matches('i,option')
     &&[...e.childNodes].some(n=>n.nodeType===3&&n.nodeValue.trim()));
   return [...new Set(txt.map(e=>getComputedStyle(e).fontSize))];
  })('#recordSearchBar'),
    search:!!bar.querySelector('label.lt-search #recordSearch'),
    clear:!!document.getElementById('clearRecordSearch'),
    count:(document.getElementById('recordSearchResult')?.textContent||'').trim(),
    sortName:(bar.querySelector('.rec-sort>span')?.textContent||'').trim(),
    icon:!!bar.querySelector('#recordColumnsBtn .fa-table-columns'),
    ordered:order.every((v,i)=>v>=0&&(i===0||v>order[i-1]))};
  });
  rec('帯の字は1つの大きさ（前: 12・11px）',band.fs.length===1,JSON.stringify(band.fs));
  rec('検索欄は一覧と同じ部品（.lt-search）・「検索解除」のボタンは無い（欄の ✕ と同じ働き）',
      band.search&&!band.clear,JSON.stringify(band));
  rec('件数は仕掛一覧と同じ書き方（全 N件／n件 / 全 N件）',/^(全 [\d,]+件|[\d,]+件 \/ 全 [\d,]+件)$/.test(band.count),band.count);
  rec('並びは「絞り込む（検索→件数）→ 見せ方（並び→表示列）」・語は「並び」・表示列に印',
      band.ordered&&band.sortName==='並び'&&band.icon,JSON.stringify(band));
  await page.click('#recordColumnsBtn');
  await page.waitForSelector('#listColumnPanel:not([hidden]) .lc-item',{timeout:15000});
  await settle(page);
  const panel=await page.evaluate(()=>({
   id:document.getElementById('listColumnPanel')?'listColumnPanel':'',
   title:document.getElementById('lcTitle')?.textContent||'',
   rows:document.querySelectorAll('#listColumnPanel .lc-item').length,
   checked:[...document.querySelectorAll('#listColumnPanel .lc-item input[type=checkbox]')]
     .filter(x=>x.checked).length,
   /* 出どころの札だけを数える（§9.248 ④で「表示中／非表示中」の札が
      同じ帯に並んだ。**別の軸**なので出どころの数には入れない）。 */
   origins:[...document.querySelectorAll('#lcOrigins button[data-origin]')].map(x=>x.textContent.trim()),
   states:[...document.querySelectorAll('#lcOrigins button[data-state]')].map(x=>x.textContent.trim()),
   fx:!document.getElementById('lcAddCol')?.hidden,
  }));
  rec('仕掛一覧と同じパネル（#listColumnPanel）が開く',panel.id==='listColumnPanel',panel.title);
  rec('候補が既定の15列より多い',panel.rows>DEFAULT_HEAD.length,panel.rows+'列');
  rec('一度も保存していないうちは既定の15列だけがチェック済み',
      panel.checked===DEFAULT_HEAD.length,panel.checked+' / '+panel.rows);
  rec('分類は「元データ」と「計算・操作」の2つ（結合は無いので出さない）',
      panel.origins.length===3&&panel.origins.join('').includes('元データ')
      &&panel.origins.join('').includes('計算・操作')
      &&!panel.origins.join('').includes('結合'),panel.origins.join(' / '));
  /* §9.248 ④: 出どころとは**別の軸**として「表示中／非表示中」が並ぶ。
     **件数を文字で出すこと**まで見る（§3。札が在るだけでは何件か読めない）。 */
  rec('「表示中の列」「非表示中の列」の札が別の軸として並ぶ',
      panel.states.length===2&&panel.states.join('').includes('表示中')
      &&panel.states.join('').includes('非表示中'),panel.states.join(' / '));
  rec('札は件数を文字で出す（表示中＝既定の15列）',
      /表示中\s*15$/.test(panel.states[0]||'')
      &&/非表示中\s*\d+$/.test(panel.states[1]||''),panel.states.join(' / '));
  rec('計算式で列を作れる（仕掛一覧と同じ機能）',panel.fx===true);

  /* ---- 3) 触った結果がそのまま一覧に出る（保存していなくても） ---- */
  await page.evaluate(()=>{
   const row=[...document.querySelectorAll('#lcList [data-key]')].find(r=>r.dataset.key==='鋳造番号');
   if(!row)throw Error('鋳造番号の行が無い');
   row.querySelector('input[type=checkbox]').click();
  });
  await settle(page);
  const h1=await head(page);
  rec('チェックを入れると保存せずに一覧へ出る',h1.includes('鋳造番号'),h1.join('／'));

  /* ---- 4) 表示名を変えると見出しが変わる ---- */
  await page.evaluate(()=>{
   [...document.querySelectorAll('#lcList [data-key]')].find(r=>r.dataset.key==='更新日時').click();
  });
  await settle(page);
  await page.fill('#lcName','最終更新');
  await page.dispatchEvent('#lcName','input');
  await settle(page);
  const h2=await head(page);
  rec('表示名が見出しに出る',h2.includes('最終更新')&&!h2.includes('更新日時'),h2.join('／'));

  /* ---- 5) 保存せずに閉じたら開いた時点へ戻る ---- */
  await page.evaluate(()=>WL.listColumns.close());
  await settle(page);
  const h3=await head(page);
  rec('保存せずに閉じたら元へ戻る',JSON.stringify(h3)===JSON.stringify(DEFAULT_HEAD),h3.join('／'));

  /* ---- 6) 保存すると再読込後も残る ---- */
  await page.click('#recordColumnsBtn');
  await page.waitForSelector('#listColumnPanel:not([hidden]) .lc-item',{timeout:15000});
  await page.evaluate(()=>{
   const row=[...document.querySelectorAll('#lcList [data-key]')].find(r=>r.dataset.key==='使用設備');
   row.querySelector('input[type=checkbox]').click();
  });
  await settle(page);
  await page.click('#lcSave');
  await idle();
  await page.evaluate(()=>WL.listColumns.close());
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await openList(page);
  const h4=await head(page);
  rec('保存した設定は再読込後も残る',h4.includes('使用設備'),h4.join('／'));
  rec('保存しても既定の15列は消えていない',
      DEFAULT_HEAD.every(x=>h4.includes(x)),
      DEFAULT_HEAD.filter(x=>!h4.includes(x)).join('／')||'欠けなし');

  /* ---- 7) 切れる値には生の値のtitleが付く（§9.94の約束） ---- */
  const tips=await page.evaluate(()=>{
   const cells=[...document.querySelectorAll('.record-list-row .record-list-cell')];
   if(!cells.length)return {n:0,withTitle:0};
   return {n:cells.length,withTitle:cells.filter(c=>c.getAttribute('title')).length};
  });
  rec('セルに生の値のtitleが付いている',tips.n===0||tips.withTitle>0,
      tips.withTitle+' / '+tips.n);

  /* ---- 7b) 見出しの操作（§9.164。仕掛一覧と同じ道具） ----
     固定するのは「同じ道具が動いていること」と、**この一覧だけが持つ約束**
     ——見出しから初めて保存する瞬間に隠す列を種まきしないと、幅を1回引いた
     だけで候補44列が全部並ぶ（§9.162で入れた約束が崩れる）。 */
  await cleanup();
  await page.evaluate(()=>{WL.columnLayout.forget('records:list')});
  await openList(page);
  const grips=await page.evaluate(()=>{
   const cells=[...document.querySelectorAll('.record-list-head [data-col]')];
   return {cols:cells.length,grips:cells.filter(c=>c.querySelector('.col-resize')).length,
           tip:(cells[1]||{}).title||''};
  });
  rec('見出しに列幅の取っ手がある',grips.grips===grips.cols&&grips.cols>0,
      `${grips.grips}/${grips.cols}`);
  /* **今の状態を文で言う**（押せるだけでは、今が自動なのか手動なのか分からない）。 */
  rec('取っ手の使い方と今の幅の状態がtitleに出る',
      /幅:/.test(grips.tip)&&/ドラッグ/.test(grips.tip)&&/右クリック/.test(grips.tip),grips.tip);
  const gEl=await page.$('.record-list-head [data-col="ロット番号"] .col-resize');
  const gb=await gEl.boundingBox();
  const w0=await page.evaluate(()=>document.querySelector('.record-list-head [data-col="ロット番号"]').getBoundingClientRect().width);
  await page.mouse.move(gb.x+gb.width/2,gb.y+gb.height/2);
  await page.mouse.down();
  await page.mouse.move(gb.x+gb.width/2+80,gb.y+gb.height/2,{steps:8});
  await page.mouse.up();
  await idle();
  const wres=await page.evaluate(()=>({
   w:Math.round(document.querySelector('.record-list-head [data-col="ロット番号"]').getBoundingClientRect().width),
   saved:WL.columnLayout.get('records:list').widths['ロット番号'],
   cols:document.querySelectorAll('.record-list-head [data-col]').length,
   visible:WL.recordColumns.visible().length}));
  rec('取っ手を引くと幅が変わって保存される',wres.w>w0+40&&Number(wres.saved)>0,
      JSON.stringify({前:Math.round(w0),後:wres.w,保存:wres.saved}));
  rec('幅を引いても列が増えない（既定の15列のまま）',wres.cols===DEFAULT_HEAD.length,
      `${wres.cols}列 / 見えている${wres.visible}`);
  /* 右クリックのメニューは仕掛一覧と**同じもの**。 */
  await page.click('.record-list-head [data-col="検査番号"]',{button:'right'});
  await page.waitForSelector('.col-head-menu',{timeout:5000});
  const menu=await page.evaluate(()=>{
   const m=document.querySelector('.col-head-menu');
   return {items:[...m.querySelectorAll('button')].map(x=>x.textContent),
           labels:[...m.querySelectorAll('.chm-label')].map(x=>x.textContent)};
  });
  rec('見出しの右クリックで同じメニューが出る',
      menu.items.includes('この列を隠す')&&menu.items.includes('幅を内容に合わせる（自動）')
      &&menu.items.some(t=>/固定/.test(t))&&menu.items.includes('表示列の設定を開く…')
      &&menu.labels.some(t=>/^幅:/.test(t)),JSON.stringify(menu.items.slice(0,4)));
  await page.click('.col-head-menu .chm-hide');
  await idle();
  const hid=await head(page);
  rec('「この列を隠す」がその場で効く',
      !hid.includes('検査番号')&&hid.length===DEFAULT_HEAD.length-1,hid.join('／'));
  /* 自動へ戻す（幅の指定も固定も消える）。 */
  await page.click('.record-list-head [data-col="ロット番号"]',{button:'right'});
  await page.waitForSelector('.col-head-menu',{timeout:5000});
  await page.click('.col-head-menu .chm-autofit');
  await idle();
  const auto=await page.evaluate(()=>({
   w:WL.columnLayout.get('records:list').widths['ロット番号'],
   mode:WL.columnLayout.widthMode('records:list','ロット番号')}));
  rec('「幅を内容に合わせる」で自動へ戻る',!auto.w&&auto.mode==='auto',JSON.stringify(auto));

  /* ==================================================================
     §9.208 ⑥ 横スクロールしても地と罫線が続く（実機で報告）
     ------------------------------------------------------------------
     行は`display:grid`の**ブロック**なので幅は器いっぱいまでで、はみ出した
     列の後ろには器の地（灰）がそのまま出ていた。**確かめるときは実際に
     溢れさせること**——収まっている幅で見ても、直す前でも通る。
     ================================================================== */
  await post('/api/access-mode',{mode:'edit'});
  await page.setViewportSize({width:900,height:900});
  await page.evaluate(()=>WL.records.renderRecordListRows());
  await settle(page);
  const edge=await page.evaluate(()=>{
   const list=document.getElementById('recordList');
   list.scrollLeft=list.scrollWidth;
   const row=document.querySelector('.record-list-row');
   const head=document.querySelector('.record-list-head');
   if(!row)return{行なし:true};
   const cs=el=>getComputedStyle(el).backgroundColor;
   const cells=[...row.children];
   const last=cells[cells.length-1];
   const lr=last.getBoundingClientRect(),rr=row.getBoundingClientRect();
   return{溢れている:list.scrollWidth>list.clientWidth+8,
     器の地:cs(list),行の地:cs(row),
     はみ出した先のセルの地:cs(last),
     見出しの地:cs(head.children[head.children.length-1]),
     行の外にある:lr.right>rr.right+1,
     罫線:getComputedStyle(last).borderBottomWidth};
  });
  rec('データ一覧が横に溢れている（この節の前提）',edge.溢れている===true,JSON.stringify(edge));
  rec('はみ出した列の後ろにも行の地が続く（§9.208 ⑥）',
      edge.はみ出した先のセルの地===edge.行の地&&edge.はみ出した先のセルの地!==edge.器の地,
      JSON.stringify({セル:edge.はみ出した先のセルの地,行:edge.行の地,器:edge.器の地}));
  rec('はみ出した列にも行の罫線が続く',parseFloat(edge.罫線)>=1,String(edge.罫線));
  rec('見出しの地も途切れない',edge.見出しの地!==edge.器の地,edge.見出しの地);

  /* ==================================================================
     §9.208 ⑦ 幅を変えると「掴んだ列」が伸び縮みする（利用者の指摘）
     ------------------------------------------------------------------
     右端まで送った状態で列を細くすると、表が縮んだぶん`scrollLeft`の上限も
     下がってブラウザが位置を切り詰めるため、**掴んだ縁はその場に残り、
     左の列だけが右へ流れて**いた。**右端まで送ってから確かめること**——
     左端で試すと直す前でも通る。
     ================================================================== */
  const drag=await page.evaluate(async()=>{
   const list=document.getElementById('recordList');
   list.scrollLeft=list.scrollWidth;                       /* 右端まで送る */
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const keep=list.scrollLeft;
   const heads=[...document.querySelectorAll('.record-list-head [data-col]')];
   /* 画面に見えている見出しのうち、右端に近いものを掴む。
      **操作列は選ばない**（§9.222 ①）——ボタンが切れない下限を持たせて
      あるので、細くならないのが正しい（下限そのものは別の網で見る）。 */
   const box=list.getBoundingClientRect();
   const cand=heads.filter(h=>h.dataset.col!=='__actions__');
   const target=cand.filter(h=>{const r=h.getBoundingClientRect();
     return r.left>=box.left&&r.right<=box.right+1&&r.width>90}).pop()||cand[cand.length-1];
   const grip=target.querySelector('.col-resize');
   if(!grip)return{取っ手なし:true};
   const before={列:Math.round(target.getBoundingClientRect().width),
                 左端:Math.round(heads[0].getBoundingClientRect().left),
                 位置:keep};
   const gr=grip.getBoundingClientRect();
   const x=gr.left+gr.width/2,y=gr.top+gr.height/2;
   grip.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:x,clientY:y}));
   document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:x-60,clientY:y}));
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const during={列:Math.round(target.getBoundingClientRect().width),
                 左端:Math.round(heads[0].getBoundingClientRect().left),
                 位置:list.scrollLeft};
   document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:x-60,clientY:y}));
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const after={左端:Math.round(document.querySelectorAll('.record-list-head [data-col]')[0].getBoundingClientRect().left),
                位置:list.scrollLeft,余白:WL.columnResize.spare(list)};
   return{列名:target.dataset.col,before,during,after};
  });
  rec('掴んだのは操作列以外の列（操作列には下限がある）',
      drag.列名&&drag.列名!=='__actions__',String(drag.列名));
  rec('右端が見えていても掴んだ列そのものが細くなる（§9.208 ⑦）',
      !drag.取っ手なし&&drag.during.列<=drag.before.列-40,
      JSON.stringify({列:drag.列名,前:drag.before&&drag.before.列,中:drag.during&&drag.during.列}));
  rec('引いている間、左側の列は動かない（§9.208 ⑦）',
      !drag.取っ手なし&&Math.abs(drag.during.左端-drag.before.左端)<=1,
      JSON.stringify({前:drag.before&&drag.before.左端,中:drag.during&&drag.during.左端}));
  rec('離しても左側の列は動かない（便宜上の余白で位置を保つ）',
      !drag.取っ手なし&&Math.abs(drag.after.左端-drag.before.左端)<=1&&drag.after.余白>0,
      JSON.stringify(drag.after));
  /* 余白は**必要な量だけ**。左へ戻れば消える（収まっている表に意味の無い
     空白を残さない）。 */
  const spare=await page.evaluate(async()=>{
   const list=document.getElementById('recordList');
   list.scrollLeft=0;
   list.dispatchEvent(new Event('scroll'));
   await new Promise(r=>setTimeout(r,80));
   return{余白:WL.columnResize.spare(list),padding:getComputedStyle(list).paddingRight};
  });
  rec('左へ戻ると便宜上の余白は消える',spare.余白===0,JSON.stringify(spare));

  /* ==================================================================
     §9.222 ① 操作列は「ボタンが切れない幅」より下へは行かない
     ------------------------------------------------------------------
     セルは切れても`title`から読めるが、**切れたボタンは押す前に何のボタンか
     分からない**（実機で「続きか…」「帳…」と3つとも省略記号になっていた）。
     器に`em`の下限を持たせてあるので、手で狭めても3つのボタンは切れない。
     **狭めたあとに実際に切れていないかを見ること**——幅の数字だけを見ると、
     下限が効いていなくても「変わらなかった」で通る。
     ================================================================== */
  const floorTest=await page.evaluate(async()=>{
   const head=document.querySelector('.record-list-head [data-col="__actions__"]');
   if(!head)return{見出しなし:true};
   const grip=head.querySelector('.col-resize');
   if(!grip)return{取っ手なし:true};
   const before=Math.round(head.getBoundingClientRect().width);
   const gr=grip.getBoundingClientRect();
   const x=gr.left+gr.width/2,y=gr.top+gr.height/2;
   grip.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:x,clientY:y}));
   document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:x-140,clientY:y}));
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:x-140,clientY:y}));
   await new Promise(r=>setTimeout(r,500));
   /* **掴んだ見出しは保存後の描き直しで入れ替わる**ので、測るときは
      **キーで引き直す**（掴んだときの参照は切り離されていて幅0を返す）。 */
   const now=document.querySelector('.record-list-head [data-col="__actions__"]');
   const cell=document.querySelector('.record-list-actions');
   const btns=cell?[...cell.querySelectorAll('button')]:[];
   return{before,after:now?Math.round(now.getBoundingClientRect().width):0,
     ボタン幅の合計:Math.round(btns.reduce((a,b)=>a+b.getBoundingClientRect().width,0)),
     切れたボタン:cell?btns.filter(b=>b.scrollWidth>b.clientWidth+1)
       .map(b=>b.textContent.trim()):['セルなし']};
  });
  rec('操作列を狭めてもボタンが切れない（下限が効く）',
      !floorTest.見出しなし&&!floorTest.取っ手なし
      &&(floorTest.切れたボタン||[]).length===0
      /* **「何も起きなかった」で通らないように**、ボタンが入る幅を
         保っていることまで見る。 */
      &&floorTest.after>=floorTest.ボタン幅の合計,JSON.stringify(floorTest));

  await page.setViewportSize({width:1700,height:1000});
  await settle(page);

  /* ==================================================================
     §9.216 ① 右クリックの「この列を隠す」が**最初の保存**でも既定を守る
     ------------------------------------------------------------------
     データ一覧は「一度も保存していないうちは既定の15列」（§9.162）なので、
     保存値の`hidden`は**空**——29列は既定として畳んでいるだけで、隠す指定は
     持っていない。右クリックのメニューは`hidden`を**上書きで渡す**ので、
     口が「いま隠している列」を答えないと、1回押しただけで**畳んでいた29列が
     まとめて出る**（押した列は消えるのに見覚えの無い列が並ぶ）。

     **確かめるときは「この列を隠す」を最初の操作にすること**——上の7bは
     先に幅を引いており、そこで`hidden`が種まきされるので、この不具合を
     素通りする（実際にそれで見逃していた）。
     ================================================================== */
  await cleanup();
  /* **開き直してから確かめること。** ここまでの節が保存した設定は
     `WL.columnLayout`の写しに残っており、`forget()`だけでは
     「まだ一度も保存していない端末」にならない（実際にそれで
     この網が空振りしていた）。 */
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await openList(page);
  const h5=await head(page);
  const seed=await page.evaluate(()=>({
   saved:(WL.columnLayout.saved('records:list').hidden||[]).length,
   order:(WL.columnLayout.saved('records:list').order||[]).length}));
  rec('前提: まだ何も保存していない（既定の15列・保存値は空）',
      h5.length===DEFAULT_HEAD.length&&seed.saved===0&&seed.order===0,
      `${h5.length}列 / ${JSON.stringify(seed)}`);
  await page.click('.record-list-head [data-col="検査番号"]',{button:'right'});
  await page.waitForSelector('.col-head-menu',{timeout:5000});
  /* 隠している列は**この場で戻せる**（§9.110）ので、既定で畳んでいる29列も
     メニューの「隠している列」に並ぶ。ここが0件なら口が答えていない。 */
  const menuHidden=await page.evaluate(()=>{
   const m=document.querySelector('.col-head-menu');
   const lab=[...m.querySelectorAll('.chm-label')].map(x=>x.textContent).join(' / ');
   return {label:lab,rows:m.querySelectorAll('.chm-show').length};
  });
  rec('既定で畳んでいる列も「隠している列」として戻せる',
      /隠している列（\d+）/.test(menuHidden.label)&&menuHidden.rows>0,
      JSON.stringify(menuHidden));
  await page.click('.col-head-menu .chm-hide');
  await idle();
  const h6=await head(page);
  rec('最初の操作が「この列を隠す」でも1列だけ減る（§9.216 ①）',
      h6.length===DEFAULT_HEAD.length-1&&!h6.includes('検査番号'),
      `${h6.length}列: `+h6.join('／'));
  const savedHidden=await (await fetch(B+'/api/column-layout-master?target='+encodeURIComponent(TARGET))).json();
  rec('マスタにも既定の非表示ごと書かれる',
      (savedHidden.hidden||[]).includes('検査番号')&&(savedHidden.hidden||[]).length>1,
      `${(savedHidden.hidden||[]).length}件`);
  /* 戻す操作も同じ場所にある。戻したら**その1列だけ**が増える。
     戻せる列は上限（10件）で切るので、**並び順で出すこと**——保存された
     配列の順のままだと、既定で29列を畳んでいるこの一覧では
     「いま隠した列」が上限の外へ押し出されて戻せない（実際にそうなった）。 */
  await page.click('.record-list-head [data-col="ロット番号"]',{button:'right'});
  await page.waitForSelector('.col-head-menu',{timeout:5000});
  const restore=await page.evaluate(()=>{
   const keys=WL.recordColumns.keys();
   const list=[...document.querySelectorAll('.col-head-menu .chm-show')].map(x=>x.dataset.key);
   const pos=list.map(k=>keys.indexOf(k));
   return {list,並び順:pos.every((v,i)=>i===0||v>=pos[i-1])};
  });
  rec('戻せる列は列の並び順で出す（上限で切っても探せる）',
      restore.並び順===true&&restore.list.includes('検査番号'),
      restore.list.slice(0,6).join('／'));
  await page.evaluate(()=>{
   const b2=[...document.querySelectorAll('.col-head-menu .chm-show')]
     .find(x=>x.dataset.key==='検査番号');
   if(!b2)throw Error('戻すボタンが無い');
   b2.click();
   });
   await idle();
  const h7=await head(page);
  rec('同じメニューから戻すと1列だけ増える',
      h7.length===DEFAULT_HEAD.length&&h7.includes('検査番号'),
      `${h7.length}列`);

  /* ---- 8) 閲覧モードでは「表示列」を出さない（保存が403になるため） ---- */
  await post('/api/access-mode',{mode:'view'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.evaluate(()=>WL.records.openRecordsSafe('編集中')).catch(()=>{});
  /* 一覧が描かれ、取得が静まるまで。見るのは「ボタンを出さない」ことなので、
     描き終えたあと（出るなら出ている時点）で見る。 */
  await W.until(page,()=>!!document.querySelector('.record-list-head'),null,{ms:10000,what:'閲覧モードでデータ一覧が描かれる'});
  await idle(800);
  const hidden=await page.evaluate(()=>{
   const b2=document.getElementById('recordColumnsBtn');
   return !b2||b2.hidden;
  });
  rec('閲覧モードでは「表示列」ボタンを出さない',hidden===true);

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  try{await post('/api/access-mode',{mode:'edit'})}catch(e){}
  await cleanup();
  /* 置いた実績は自分で消す（§9.351・§9.362）。 */
  try{await require('./lib/harness.js').clearRecords()}catch(e){console.log('!! 実績の後片付けに失敗: '+(e&&e.message||e))}
 }
}, {viewport:{width:1700,height:1000}});
