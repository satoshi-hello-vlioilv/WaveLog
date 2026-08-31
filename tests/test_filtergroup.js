/* test_filtergroup.js: 登録フィルタの群と、プリセット中心のバー（§9.286 ①）

   ============================================================
   利用者の指示
   ------------------------------------------------------------
   「フィルタのプリセット機能。登録フィルタのグループ化登録及びグループごとの
    一括切り替え機能を実装してください。フィルタ機能がモリモリでゴチャついて
    きたので、コンパクトかつ分かりやすくタブ、アコーディオン、ポップオーバー
    メニューなど駆使してわかりやすく使いやすいメニューに再構成してください。
    最終的にプリセット登録したフィルタの切り替えだけで使えるようにしつつ、
    その場フィルタ(展開時縦に長すぎるのでこれもコンパクトにしたい)で
    スポットのフィルタを組み合わせて使う形が運用の形と考えています」

   ここで固定すること
   ------------------------------------------------------------
    1. 登録フィルタに**群**を持たせ、選ぶだけで付け替わる（保存に往復する）
    2. 絞り込みバーは**1行**。主動線は「群を選ぶ → 札を押す」の2手
    3. 札を押すと当たる／もう一度押すと外れる（件数と行数が実際に動く）
    4. 群ごとに**まとめて当てる／外す**（対で持つ・§9.170）
    5. たまにしか使わない入口は`⋯`へ畳む——**消していない**
    6. その場フィルタは今までどおり効く（畳んでも1行）

   **「札が並ぶ」だけを見ないこと**——押しても何も起きない実装でも通る。
   件数（`#filterCount`）と一覧の行数まで見る。
   後片付けは finally で必ず行う（§9.121。名前に実行ごとの印を入れる）。
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const TAG='fg'+Date.now().toString(36);
const USER='u-'+TAG;
const DB='SIKALOTNOW',TBL='仕掛';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 page.on('pageerror',e=>{errs.push(e.message.slice(0,200));console.log('[pageerror]',e.message.slice(0,200),'\n',String(e.stack||'').slice(0,900))});
 page.on('console',m=>{if(m.type()==='error')console.log('[console]',m.text().slice(0,200))});
 page.on('requestfailed',r=>console.log('[reqfail]',r.url().slice(0,120)));
 const settle=ms=>page.waitForTimeout(ms);
 const post=(p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-filtergroup'},a.b))});
  let j={};try{j=await r.json()}catch(e){}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 const listPresets=()=>page.evaluate(async u=>{
  const r=await fetch('/api/filter-presets?user='+encodeURIComponent(u));
  return (await r.json()).items||[];
 },USER);
 /* 一覧の状態。**件数と行数の両方**を見る（札が塗り変わっただけでは
    絞り込めていない）。 */
 const state=()=>page.evaluate(()=>({
  count:(document.querySelector('#filterCount')?.textContent||'').trim(),
  tags:document.querySelectorAll('#filterTokenInput .filter-tag').length,
  /* **DOMの行数で数えないこと**（§9.286 ③）——1000件の既定では仮想行が
     効くので、同じ絞り込みでも数が揺れる。サーバーが数えた件数で見る。 */
  rows:(typeof S!=='undefined'&&Number.isFinite(S.count))?S.count
       :document.querySelectorAll('#grid table tbody tr').length,
  chips:[...document.querySelectorAll('#filterPresetChips .fb-chip')]
    .map(x=>({t:(x.querySelector('span')?.textContent||'').trim(),on:x.classList.contains('is-on')})),
  group:(document.querySelector('#filterGroupName')?.textContent||'').trim(),
 }));
 const clickChip=t=>page.evaluate(x=>{
  const b=[...document.querySelectorAll('#filterPresetChips .fb-chip')]
    .find(e=>(e.querySelector('span')?.textContent||'').trim()===x);
  if(!b)throw new Error('札が見つかりません: '+x);
  b.click();
 },t);
 let made=[];

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(u=>localStorage.setItem('AccessMeasurementUserId',u),USER);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await post('/api/access-mode',{mode:'edit'});
  await page.click('aside [data-db-key="SIKALOTNOW"]',{timeout:20000});
  await page.waitForSelector('#grid tbody tr',{timeout:30000});
  await settle(900);

  /* ---- 用意: 3件の登録フィルタ（あとで2件を同じ群へ入れる） ---- */
  const col=await page.evaluate(()=>{
   /* 実際に絞れる列を選ぶ——どの行も同じ値の列だと、当てても件数が
      変わらず**効いていなくても通る**（§9.238 ⑤の教訓）。 */
   /* **`window.S`で参照しないこと**（§9.215）——`S`は`base.js`のトップレベルの
      `const`なので`window`のプロパティにならない。素の名前で引く。 */
   const names=(typeof S!=='undefined'&&S.columns)||[];
   const best=names.map(c=>({c,n:new Set((S.rows||[]).map(r=>String(r[c]??''))).size}))
     .filter(x=>x.n>3).sort((a,b)=>b.n-a.n)[0];
   return best?best.c:names[0];
  });
  const vals=await page.evaluate(c=>[...new Set((S.rows||[]).map(r=>String(r[c]??'').trim()).filter(Boolean))].slice(0,3),col);
  rec('検証の前提: 絞れる列と値がある',!!col&&vals.length>=2,`${col} / ${vals.join(',')}`);
  const mk=async(name,value)=>{
   const r=await post('/api/filter-presets',{name,db:DB,table:TBL,mode:'',user:USER,
     filters:[{column:col,op:'contains',value}]});
   made.push(name);return r;
  };
  await mk(`${TAG}-A`,vals[0]);
  await mk(`${TAG}-B`,vals[1]);
  await mk(`${TAG}-C`,vals[0]);

  /* ---- 1) 群を付け替えられる（サーバーに残る） ---- */
  const items=(await listPresets()).filter(p=>String(p.name||'').startsWith(TAG));
  rec('登録フィルタが3件できた',items.length===3,`${items.length}件`);
  rec('群は既定で空欄（分類なし）',items.every(p=>!String(p.group||'').trim()),
      JSON.stringify(items.map(p=>p.group)));
  const GA=TAG+'群';
  for(const p of items.slice(0,2)){
   const r=await post('/api/filter-presets/group',{id:p.id,group:GA,user:USER});
   if(r.status!==200)rec('群を付け替えられる',false,JSON.stringify(r));
  }
  const after=(await listPresets()).filter(p=>String(p.name||'').startsWith(TAG));
  const inG=after.filter(p=>String(p.group||'').trim()===GA);
  rec('群がサーバーに残る（読み直しても消えない）',inG.length===2,
      JSON.stringify(after.map(p=>[p.name.slice(-1),p.group])));

  /* 画面へ反映（登録一覧の再読込と同じ道を通す）。 */
  await page.evaluate(()=>document.querySelector('#filterMoreBtn').click());
  await settle(200);
  await page.click('#openFilterPresets');
  await page.waitForSelector('#filterPresetModal:not([hidden])',{timeout:10000});
  await settle(900);
  /* サーバーで付け替えたので、画面の写しを取り直す（利用者は「再読込」を
     押すか、次に一覧を開いたときに同じ道を通る）。 */
  await page.click('#reloadFilterPresets');
  await settle(2000);
  const sel=await page.evaluate(t=>{
   const items=[...document.querySelectorAll('.filter-preset-item')]
     .filter(x=>(x.querySelector('.fp-name')?.textContent||'').includes(t));
   return items.map(x=>({n:(x.querySelector('.fp-name')?.textContent||'').trim().slice(0,12),
                         g:x.querySelector('.fp-group')?.value,
                         opts:[...(x.querySelector('.fp-group')?.options||[])].map(o=>o.textContent)}));
  },TAG);
  rec('登録一覧に群の欄がある',sel.length===3&&sel.every(x=>x.g!==undefined),JSON.stringify(sel.map(x=>x.g)));
  rec('群の欄に「分類なし」と「＋ 新しい群…」がある',
      sel[0]&&sel[0].opts.includes('分類なし')&&sel[0].opts.some(o=>o.includes('新しい群')),
      JSON.stringify(sel[0]?.opts));
  rec('付け替えた群が欄に出ている',sel.filter(x=>x.g===GA).length===2,
      JSON.stringify(sel.map(x=>x.g)));
  await page.evaluate(()=>{const m=document.querySelector('#filterPresetModal');if(m)m.hidden=true});
  await settle(500);

  /* ---- 2) バーは1行で、主動線は群と札 ---- */
  const bar=await page.evaluate(()=>{
   const row=document.querySelector('.filter-search-row');
   const kids=[...row.children].filter(e=>e.offsetParent!==null&&!e.hasAttribute('hidden'));
   const tops=[...new Set(kids.map(e=>Math.round(e.getBoundingClientRect().top)))];
   const h=Math.round(row.getBoundingClientRect().height);
   const tall=Math.max(...kids.map(e=>Math.round(e.getBoundingClientRect().height)));
   return {h,tall,rows:tops.length,over:h>tall+16,
     hasGroup:!!document.querySelector('#filterGroupBtn'),
     hasChips:!!document.querySelector('#filterPresetChips'),
     hasMore:!!document.querySelector('#filterMoreBtn'),
     adhocHidden:document.querySelector('#filterAdhocRow')?.hidden};
  });
  rec('絞り込みバーは1行に収まる',!bar.over,JSON.stringify(bar));
  rec('群のボタンと札の帯と⋯がある',bar.hasGroup&&bar.hasChips&&bar.hasMore,JSON.stringify(bar));

  /* ---- 3) 札を押すと当たる／もう一度押すと外れる ---- */
  /* 全解除は**画面の道**を通す（`renderGenericFilterBar()`はIIFEの中に
     あり、`page.evaluate`からは呼べない）。 */
  await page.evaluate(()=>{const m=document.querySelector('#filterPresetModal');if(m)m.hidden=true});
  await settle(300);
  await page.click('#filterMoreBtn');
  await page.click('#clearGenericFilters');
  await settle(1800);
  const s0=await state();
  rec('用意した3件が札で並ぶ',s0.chips.filter(c=>c.t.startsWith(TAG)).length===3,
      JSON.stringify(s0.chips.map(c=>c.t)));
  rec('はじめはどれも効いていない',s0.chips.every(c=>!c.on),JSON.stringify(s0));

  await clickChip(`${TAG}-A`);
  await settle(1800);
  const s1=await state();
  rec('札を押すと条件が当たる（札・件数・行数が動く）',
      s1.chips.find(c=>c.t===`${TAG}-A`)?.on&&s1.tags===1&&s1.rows<=s0.rows,
      JSON.stringify({on:s1.chips.find(c=>c.t===`${TAG}-A`)?.on,count:s1.count,rows:`${s0.rows}→${s1.rows}`}));

  await clickChip(`${TAG}-A`);
  await settle(1800);
  const s2=await state();
  rec('もう一度押すと外れる（押す場所を別に作らない）',
      !s2.chips.find(c=>c.t===`${TAG}-A`)?.on&&s2.tags===0&&s2.rows===s0.rows,
      JSON.stringify({count:s2.count,rows:s2.rows}));

  /* ---- 4) 群を選ぶ／群ごとにまとめて当てる・外す ---- */
  await page.click('#filterGroupBtn');
  await page.waitForSelector('#filterGroupMenu',{timeout:5000});
  const menu=await page.evaluate(()=>{
   const m=document.querySelector('#filterGroupMenu');
   return {items:[...m.querySelectorAll('.fb-group-item')].map(x=>({
     name:(x.querySelector('.fb-group-pick span')?.textContent||'').trim(),
     note:(x.querySelector('.fb-group-pick small')?.textContent||'').trim(),
     on:!!x.querySelector('[data-group-on]'),off:!!x.querySelector('[data-group-off]')}))};
  });
  rec('群の一覧に「すべて」と作った群が並ぶ',
      menu.items.some(x=>x.name==='すべて')&&menu.items.some(x=>x.name===GA),
      JSON.stringify(menu.items.map(x=>x.name)));
  rec('群ごとに件数を文字で出す',menu.items.every(x=>/件中 \d+件が効いています/.test(x.note)),
      JSON.stringify(menu.items.map(x=>x.note)));
  rec('「全部当てる」と「全部外す」を対で持つ',menu.items.every(x=>x.on&&x.off),
      JSON.stringify(menu.items.map(x=>[x.on,x.off])));

  /* まとめて当てる（この群の2件）。 */
  await page.evaluate(g=>{
   const m=document.querySelector('#filterGroupMenu');
   const it=[...m.querySelectorAll('.fb-group-item')]
     .find(x=>(x.querySelector('.fb-group-pick span')?.textContent||'').trim()===g);
   it.querySelector('[data-group-on]').click();
  },GA);
  await settle(2000);
  const s3=await state();
  rec('群ごとにまとめて当てられる',s3.tags===2,JSON.stringify({count:s3.count,tags:s3.tags}));

  /* 群を選ぶと札がその群だけになる。 */
  await page.click('#filterGroupBtn');
  await page.waitForSelector('#filterGroupMenu',{timeout:5000});
  await page.evaluate(g=>{
   const m=document.querySelector('#filterGroupMenu');
   const it=[...m.querySelectorAll('.fb-group-item')]
     .find(x=>(x.querySelector('.fb-group-pick span')?.textContent||'').trim()===g);
   it.querySelector('[data-group-i]').click();
  },GA);
  await settle(600);
  const s4=await state();
  rec('群を選ぶとその群の札だけになる',s4.group===GA&&s4.chips.length===2,
      JSON.stringify({group:s4.group,chips:s4.chips.map(c=>c.t)}));
  rec('選んだ群はボタンに文字で出る',s4.group===GA,s4.group);

  /* まとめて外す。 */
  await page.click('#filterGroupBtn');
  await page.waitForSelector('#filterGroupMenu',{timeout:5000});
  await page.evaluate(g=>{
   const m=document.querySelector('#filterGroupMenu');
   const it=[...m.querySelectorAll('.fb-group-item')]
     .find(x=>(x.querySelector('.fb-group-pick span')?.textContent||'').trim()===g);
   it.querySelector('[data-group-off]').click();
  },GA);
  await settle(2000);
  const s5=await state();
  rec('群ごとにまとめて外せる',s5.tags===0,JSON.stringify({count:s5.count,tags:s5.tags}));

  /* 覚えているので、開き直しても選んだ群のまま。 */
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('aside [data-db-key="SIKALOTNOW"]',{timeout:20000});
  await page.waitForSelector('#grid tbody tr',{timeout:30000});
  await settle(1500);
  const s6=await state();
  rec('選んだ群は次に開いたときも覚えている',s6.group===GA,s6.group);

  /* ---- 5) たまにしか使わない入口は畳んだだけで、消していない ---- */
  const more=await page.evaluate(()=>{
   const m=document.querySelector('#filterMoreMenu');
   return {hiddenFirst:m.hidden,
     ids:[...m.querySelectorAll('button')].map(b=>b.id)};
  });
  rec('⋯は畳んだ状態で始まる',more.hiddenFirst===true,String(more.hiddenFirst));
  rec('条件を作る・登録一覧・全解除は消していない',
      ['filterToggle','openFilterPresets','clearGenericFilters'].every(id=>more.ids.includes(id)),
      JSON.stringify(more.ids));
  await page.click('#filterMoreBtn');
  await settle(300);
  const opened=await page.evaluate(()=>{
   const m=document.querySelector('#filterMoreMenu');
   const r=m.getBoundingClientRect();
   /* **「hiddenでない」だけを見ないこと**——器（`.generic-filter-bar`）は
      角丸のため`overflow:hidden`を持つので、`position:absolute`だと
      **メニューが丸ごと切り落とされたまま**この網を通る（実機のキャプチャで
      判明。押した印は付くのに何も出ない・§9.201）。**本当に見えているか**を
      `elementFromPoint`で確かめる。 */
   const cx=Math.round(r.left+r.width/2),cy=Math.round(r.top+8);
   const at=document.elementFromPoint(cx,cy);
   return {hidden:m.hidden,
    expanded:document.querySelector('#filterMoreBtn').getAttribute('aria-expanded'),
    w:Math.round(r.width),h:Math.round(r.height),
    画面内:r.top>=0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,
    手前:!!at&&(at===m||m.contains(at))};
  });
  rec('⋯を押すと開く',opened.hidden===false&&opened.expanded==='true',JSON.stringify(opened));
  rec('⋯のメニューが実際に見えている（器に切り落とされない）',
      opened.w>40&&opened.h>40&&opened.画面内&&opened.手前,JSON.stringify(opened));
  await page.click('#filterToggle');
  await settle(500);
  const builder=await page.evaluate(()=>({
   body:!document.querySelector('#filterBody').hidden,
   menu:document.querySelector('#filterMoreMenu').hidden}));
  rec('畳んだ先の項目が押せる（条件を作るが開く）',builder.body,JSON.stringify(builder));
  rec('項目を押したら⋯は畳む',builder.menu===true,String(builder.menu));

  /* ---- 6) その場フィルタは今までどおり（畳んでも1行） ---- */
  await page.click('#filterAdhocToggle');
  await settle(500);
  const adhoc=await page.evaluate(()=>{
   const r=document.querySelector('#filterAdhocRow');
   if(r.hidden)return {hidden:true};
   const kids=[...r.children].filter(e=>e.offsetParent!==null);
   const h=Math.round(r.getBoundingClientRect().height);
   const tall=Math.max(...kids.map(e=>Math.round(e.getBoundingClientRect().height)));
   return {hidden:false,h,tall,over:h>tall+16};
  });
  rec('その場フィルタは開いても1行',adhoc.hidden===false&&!adhoc.over,JSON.stringify(adhoc));

  rec('コンソールに例外が出ていない',errs.length===0,errs.slice(0,2).join(' / '));
 }catch(e){
  console.error('FATAL',e);
  console.log('errs:',JSON.stringify(errs.slice(0,4)));
  try{console.log('state:',JSON.stringify(await page.evaluate(()=>({
    bar:!!document.querySelector('#genericFilterBar'),
    grid:document.querySelectorAll('#grid table tbody tr').length,
    db:typeof S!=='undefined'&&S.db,table:typeof S!=='undefined'&&S.table,
    rows:(typeof S!=='undefined'&&S.rows||[]).length,
    err:(document.querySelector('#grid')?.textContent||'').slice(0,160)}))))}catch(_){}
  rec('FATAL',false,String(e&&e.message||e));
 }finally{
  /* 後片付け（§9.121）——登録フィルタと、この端末の覚えを消す。 */
  try{
   const all=await listPresets();
   for(const p of all.filter(x=>String(x.name||'').startsWith(TAG))){
    await post('/api/filter-presets/delete',{id:p.id,user:USER});
   }
   await page.evaluate(()=>{
    try{localStorage.removeItem('MeasurementFilterGroupV1')}catch(_){}
    try{localStorage.removeItem('MeasurementFilterActiveV1')}catch(_){}
   });
  }catch(e){console.log('cleanup skipped:',e&&e.message)}
  console.log('\n=== SUMMARY ===');
  const f=R.filter(r=>!r.ok);console.log(`${R.length-f.length}/${R.length} passed`);
  f.forEach(x=>console.log(' -',x.n,x.d||''));
  await b.close();
  process.exit(f.length?1:0);
 }
})().catch(async e=>{
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
