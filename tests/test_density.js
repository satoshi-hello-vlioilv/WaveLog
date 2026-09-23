/* test_density.js: 一覧の密度と、右端に隠れがちな操作列、
   そして再読込の選び方（§9.78）。
   ------------------------------------------------------------
   指摘は3つあった。
     ・作業スケジュールの削除などのボタンが一番右端で、幅を変えると隠れる
     ・列の間と区分バッジが余白を取りすぎて、入る情報が少ない
     ・仕掛一覧も作業スケジュールも縦に余白がありすぎる
   「詰めた」は主観になりやすいので、**行ピッチと到達性**という測れる形で
   固定する。詰めすぎて文字が切れては本末転倒なので、溢れ検査
   (tests/test_fit.js)と対で見ること。 */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';
/* 行ピッチの上限(標準サイズ)。以前は39px。ここを超えたら「また太った」。
   下限も見る——0に近い値は、行が潰れて読めなくなっている合図。 */
const MAX_ROW_PITCH=37, MIN_ROW_PITCH=24;

const setMode=async m=>{await fetch(`${API}/api/access-mode`,
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};

run('test_density: 一覧の密度と、右端に隠れがちな操作列、', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 try{
  await setMode('edit');
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  /* 起動の取得が静まってから書き換え・読み込み直す（すぐ reload すると初期化の取得が
     打ち切られ、アプリが「初期化エラー」を console へ出す・§9.451）。 */
  await W.booted(page); await idle();
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:20000});
  await page.click('aside [data-db-key="SIKALOTNOW"]');
  await W.until(page,()=>document.querySelectorAll('#grid tbody tr').length>0,null,{ms:20000,what:'仕掛一覧の行が出る'});
  await idle();

  /* ---- 1) 仕掛一覧の行ピッチ ---- */
  const pitchOf=sel=>page.evaluate(s=>{
   const rows=[...document.querySelectorAll(s)].slice(0,10);
   if(rows.length<2)return 0;
   const a=rows[0].getBoundingClientRect().top,z=rows[rows.length-1].getBoundingClientRect().top;
   return Math.round((z-a)/(rows.length-1));
  },sel);
  const listPitch=await pitchOf('#grid tbody tr');
  rec('仕掛一覧の行が詰まっている',listPitch>=MIN_ROW_PITCH&&listPitch<=MAX_ROW_PITCH,
      `${listPitch}px (上限${MAX_ROW_PITCH})`);

  /* ---- 2) 再読込は読み直し方を選べる ---- */
  /* §9.286 ④: 入口はヘッダーの`#reload`から**一覧ツールバーの鮮度チップ**へ
     移した——「いつのデータか」と「取り直す」を同じ場所に置く。 */
  await page.click('#listFreshness');await W.until(page,()=>!!document.getElementById('reloadMenu'),null,{ms:4000,what:'再読込の選択肢が出る'});
  const menu=await page.evaluate(()=>{
   const m=document.getElementById('reloadMenu');if(!m)return null;
   return [...m.querySelectorAll('button')].map(x=>({
    action:x.dataset.reloadAction||'',
    label:(x.querySelector('span')||{}).textContent||'',
    hint:(x.querySelector('small')||{}).textContent||'',
    disabled:x.disabled}));
  });
  rec('再読込を押すと選択肢が出る',!!menu&&menu.length>=2,
      menu?menu.map(x=>x.action).join('/'):'メニューが出ない');
  rec('「一覧を再読込」が選べる',!!menu&&menu.some(x=>x.action==='list'&&!x.disabled));
  const rne=menu&&menu.find(x=>x.action==='rne');
  rec('「RNEファイルから作成」の項目がある',!!rne,rne?rne.label:'なし');
  /* 実行できない端末では**隠さずに理由を出す**。あるはずの機能を探させない。 */
  rec('実行できないときは理由が読める',!rne||!rne.disabled||rne.hint.length>4,
      rne?`${rne.disabled?'無効':'有効'}: ${rne.hint}`:'-');
  await page.mouse.click(5,600);await W.until(page,()=>!document.getElementById('reloadMenu'),null,{ms:4000,what:'他所を押して選択肢が閉じる'});
  rec('画面の他所を押すと閉じる',
      await page.evaluate(()=>!document.getElementById('reloadMenu')));

  /* 「一覧を再読込」が実際に効く(押しても何も起きない、にしない) */
  await page.click('#listFreshness');await W.until(page,()=>!!document.getElementById('reloadMenu'),null,{ms:4000,what:'再読込の選択肢が出る'});
  await page.evaluate(()=>document.querySelector('[data-reload-action="list"]').click());
  await idle(600,15000);
  rec('「一覧を再読込」で一覧が出ている',
      await page.evaluate(()=>!!document.querySelector('#grid tbody tr')));

  /* ---- 3) RNE抽出の進捗表示の器 ---- */
  const prog=await page.evaluate(()=>{
   const box=document.getElementById('rneProgress');
   if(!box)return null;
   const bar=document.getElementById('rneProgressBar');
   return {hidden:box.hidden,role:box.getAttribute('role'),
           hasBar:!!bar&&bar.getAttribute('role')==='progressbar',
           hasFill:!!bar?.querySelector('i'),
           hasJobs:!!document.getElementById('rneProgressJobs')};
  });
  rec('RNE抽出の進捗バーが用意されている',
      !!prog&&prog.hasBar&&prog.hasFill&&prog.hasJobs,JSON.stringify(prog));
  rec('進捗バーは普段は出ていない',!!prog&&prog.hidden===true);
  /* 割合はカスタムプロパティで渡す(見た目の指定はCSSに残す)。 */
  const bar=await page.evaluate(()=>{
   const box=document.getElementById('rneProgress');
   const fill=document.querySelector('#rneProgressBar i');
   if(!fill||!box)return null;
   box.hidden=false;                       // 隠れたままでは寸法が測れない
   fill.style.setProperty('--rne-pct','50%');
   const w=fill.getBoundingClientRect().width;
   const track=document.getElementById('rneProgressBar').getBoundingClientRect().width;
   fill.style.removeProperty('--rne-pct');
   box.hidden=true;
   return {w:Math.round(w),track:Math.round(track)};
  });
  rec('割合を渡すとバーが伸びる',!!bar&&bar.track>0&&Math.abs(bar.w-bar.track/2)<=2,
      bar?`${bar.w}/${bar.track}px`:'-');

  /* ---- 4) 作業スケジュール: 行の密度と操作列の到達性 ---- */
  await page.click('#openSchedule');
  await W.until(page,()=>document.querySelectorAll('.sc-row-line').length>0,null,{ms:25000,what:'作業スケジュールの行が出る'});
  await W.settleFlags(page);await idle();
  const scPitch=await pitchOf('.sc-row-line');
  rec('作業スケジュールの行が詰まっている',scPitch>=MIN_ROW_PITCH&&scPitch<=MAX_ROW_PITCH,
      `${scPitch}px (上限${MAX_ROW_PITCH})`);
  /* 区分は「ただの状態表示」。押せる部品の高さ(--ctl-h-xs=26px)を
     占有していたら、また行が厚くなる。 */
  const cat=await page.evaluate(()=>{
   const c=document.querySelector('.sc-row-cat');if(!c)return null;
   const ctl=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ctl-h-xs'))||26;
   return {h:Math.round(c.getBoundingClientRect().height),ctl:Math.round(ctl)};
  });
  rec('区分バッジが押せる部品ほどの高さを取っていない',
      !!cat&&cat.h<cat.ctl,cat?`${cat.h}px < ${cat.ctl}px`:'-');

  /* **帯は面とセットのときだけ**（§9.344）。面の無い区分に2pxの縦棒だけを
     残すと、角丸のせいで開き括弧`[`に見え、同じ表の列の区切り線とも形が
     競合する。**全部の区分を見る**——1つだけ見ると、面のある「作業中」を
     たまたま拾って素通りする。 */
  const bands=await page.evaluate(()=>[...document.querySelectorAll('.sc-row-cat')].map(n=>{
   const cs=getComputedStyle(n);
   return {字:n.textContent.trim(),
           面:cs.backgroundColor,
           帯:Math.round(parseFloat(cs.borderLeftWidth)||0)};
  }));
  const 浮いた帯=bands.filter(b=>b.帯>0&&/rgba\(0, 0, 0, 0\)|transparent/.test(b.面));
  rec('面を持たない区分に帯（左の縦棒）を出さない',
      bands.length>0&&浮いた帯.length===0,
      `${bands.length}件中 ${浮いた帯.length}件が浮いた帯: `
      +浮いた帯.map(b=>b.字).join('・'));
  /* 行の色を選んだときは、面と帯が揃って出る（帯そのものを捨てたのではない）。
     実物の行を作らずCSSだけを測る——**規則が生きていることの確認**。 */
  const styled=await page.evaluate(()=>{
   const n=document.createElement('span');
   n.className='sc-row-cat sc-rs-blue';n.textContent='見本';
   document.body.appendChild(n);
   const cs=getComputedStyle(n);
   const r={面:cs.backgroundColor,帯:Math.round(parseFloat(cs.borderLeftWidth)||0)};
   n.remove();return r;
  });
  rec('行の色を選んだときは面と帯が揃って出る',
      styled.帯>0&&!/rgba\(0, 0, 0, 0\)/.test(styled.面),JSON.stringify(styled));

  /* 本題。幅を狭めても操作へ手が届くこと。
     **届かせ方が変わった**（§9.207、利用者の指示「操作ボタンの列固定は不要
     です。…代わりに右クリックメニューに操作と同等の機能を実装し…」）。
     以前は操作の列を右端へ貼り付けて(position:sticky)常に見せていたが、
     §9.176で操作の列も移動・表示/非表示ができるようになったため、
     **真ん中へ動かした列を右端に貼り付ける**という辻褄の合わない状態が
     作れてしまう。いまは**行の右クリック**が同じことを全部できる。
     ここで見るのは「狭くても操作へ手が届くか」で、**その手立ては
     右クリック**——広い幅ではボタンも直接押せることも併せて見る。 */
  const reachOf=()=>page.evaluate(()=>{
   const row=document.querySelector('.sc-row-line');if(!row)return null;
   const act=row.querySelector('.sc-row-actions');const btn=act&&act.querySelector('button');
   const wrap=row.closest('.sc-timeline');
   const out={overflow:wrap?Math.round(wrap.scrollWidth-wrap.clientWidth):0,
              sticky:act?getComputedStyle(act).position:'-',noButton:!btn};
   if(btn){
    const r=btn.getBoundingClientRect();
    const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    out.reachable=!!(top&&(top===btn||btn.contains(top)||top.closest('.sc-row-actions')));
   }
   return out;
  });
  const menuItemsOf=()=>page.evaluate(()=>{
   document.querySelector('.sc-row-menu')?.remove();
   const row=document.querySelector('.sc-row-line');if(!row)return [];
   const r=row.getBoundingClientRect();
   row.dispatchEvent(new MouseEvent('contextmenu',
     {bubbles:true,clientX:Math.round(r.left+30),clientY:Math.round(r.top+5)}));
   const m=document.querySelector('.sc-row-menu');
   const items=m?[...m.querySelectorAll('button')].map(b=>b.textContent.trim()):[];
   if(m)m.remove();
   return items;
  });
  await page.setViewportSize({width:1600,height:1000});
  await paint();
  const wide=await reachOf();
  rec('広い幅では操作ボタンをそのまま押せる',!!wide&&(wide.noButton||wide.reachable),
      wide?`はみ出し${wide.overflow}px / ${wide.sticky}`:'行が無い');
  /* **操作の列は普通の列**（貼り付けない）。 */
  rec('操作の列を右端へ貼り付けていない',!!wide&&wide.sticky!=='sticky',
      wide?wide.sticky:'-');
  for(const w of [1200,980]){
   await page.setViewportSize({width:w,height:1000});
   await paint();
   const items=await menuItemsOf();
   rec(`幅${w}pxでも右クリックから操作へ手が届く`,
       items.length>0&&items.some(t=>/表示列/.test(t)),
       `${items.length}件: ${items.slice(0,4).join(' / ')}`);
  }
  await page.setViewportSize({width:1600,height:1000});await paint();
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }
}, {viewport:{width:1600,height:1000}});
