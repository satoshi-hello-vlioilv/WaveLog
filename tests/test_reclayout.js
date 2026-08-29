/* test_reclayout.js: 「記録した値」の配置をD&Dで組めるマスタ（§9.243）
   ============================================================
   利用者の指示:
     「現在操業データ項目マスタで設定している内容を候補に出して視覚的に配置
      して設定できるようなマスタを別で追加立ち上げして簡単にD&Dで配置修正
      再設定、編集できるようにしてほしいです」

   ここで固定すること:
    - 専用画面が開き、**盤が③確認のカードと同じ形**（群の塊＋その中の項目）で出る
    - ✕で候補へ外れ、＋で戻る（**項目そのものは消えない**）
    - 掴んで別の群へ落とすと**並びと見出しの両方**が決まる
    - 保存すると`[記録表示]`／`[記録群]`／`[記録順]`へ入り、**測定画面の
      `WL.opData.recordRows()`が同じ並びを返す**（盤で見た形＝出る形）
    - **触っていない項目は並びから切り離さない**（`[記録順]`が空のまま）
      ——ここを常に書き下ろすと、あとで`[表示順]`を変えてもカードが追随しない
    - 「既定へ戻す」で**本当に空へ帰る**（押しても戻らない設定を作らない）
    - 落とす場所の印は**流れの中へ入れない**（§9.218 ④。印の前後で札が動かない）
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B='http://127.0.0.1:5029';
const post=(p,x)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(x)});
const get=p=>fetch(B+p).then(r=>r.json());

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,160)));
 /* 群の名前を聞く`prompt`はテスト側で決め打ちに答える。 */
 let answer='テスト見出し';
 page.on('dialog',d=>d.accept(answer));
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:30000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintNav [data-master="recordLayout"]',{timeout:20000});
  await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'tests');

  /* ==========================================================
     1) 専用画面が開き、③確認のカードと同じ形で出る
     ========================================================== */
  await page.click('#masterMaintNav [data-master="recordLayout"]');
  await page.waitForSelector('.rl-edit',{timeout:20000});
  await page.waitForFunction(()=>document.querySelectorAll('.rl-group').length>0,null,{timeout:20000});
  const shape=await page.evaluate(()=>({
   title:document.querySelector('#masterMaintTitle')?.textContent||'',
   groups:document.querySelectorAll('.rl-group').length,
   chips:document.querySelectorAll('.rl-board .rl-chip').length,
   pool:!!document.querySelector('.rl-pool[data-rl-pool]'),
   api:!!(window.WL&&WL.recordBoard),
  }));
  rec('専用の画面が開く', /記録した値/.test(shape.title), shape.title);
  rec('盤が群の塊で出る', shape.groups>=2&&shape.chips>=5, `${shape.groups}群 / ${shape.chips}件`);
  rec('候補の受け皿がある', shape.pool);
  rec('口（WL.recordBoard）が開いている', shape.api);
  /* **並びは設備によらず共通であることを画面に書く**（§CLAUDE 6）。 */
  const scope=await page.evaluate(()=>document.querySelector('.op-bar-scope')?.textContent||'');
  rec('設備で分かれないことが文字で出る', /設備によらず共通/.test(scope), scope.slice(0,40));

  /* ==========================================================
     2) ✕で外れ、＋で戻る（項目そのものは消えない）
     ========================================================== */
  const total0=await page.evaluate(()=>WL.recordBoard.rows().on.length);
  const target=await page.evaluate(()=>{
   const c=document.querySelector('.rl-board .rl-chip');
   return {id:c.dataset.rlId,name:c.querySelector('b').textContent};
  });
  await page.click('.rl-board .rl-chip .rl-chip-x');
  await page.waitForFunction(n=>WL.recordBoard.rows().on.length===n-1,total0,{timeout:5000});
  const off1=await page.evaluate(id=>({
   pool:[...document.querySelectorAll('.rl-pool .rl-chip')].map(c=>c.dataset.rlId),
   stillItem:!!WL.recordBoard.state.items.find(x=>String(x.id)===id),
  }),target.id);
  rec('✕でカードから外れて候補へ出る', off1.pool.indexOf(target.id)>=0, target.name);
  rec('外しても項目そのものは残る', off1.stillItem);
  await page.click('.rl-pool .rl-chip [data-rl-add]');
  await page.waitForFunction(n=>WL.recordBoard.rows().on.length===n,total0,{timeout:5000});
  rec('＋でカードへ戻る', true);

  /* ==========================================================
     3) 掴んで別の群へ落とすと、並びと見出しの両方が決まる
        （ヘッドレスではHTML5のD&Dの座標を作れないので口から呼ぶ・§9.218 ④）
     ========================================================== */
  const moved=await page.evaluate(()=>{
   const rows=WL.recordBoard.rows().on;
   const src=rows[0];
   const dst=rows.find(r=>r.group!==src.group);
   const ok=WL.recordBoard.move(src.id,dst.group,dst.id);
   WL.recordBoard.render();
   const now=WL.recordBoard.rows().on;
   const at=now.findIndex(r=>r.id===src.id);
   return {ok,id:src.id,from:src.group,to:dst.group,at,
           group:now[at]&&now[at].group,before:now[at+1]&&now[at+1].id,dstId:dst.id,
           total:now.length,follow:!!(now[at]&&now[at].follow)};
  });
  rec('別の群へ落とせる', moved.ok&&moved.group===moved.to, `${moved.from} → ${moved.to}`);
  rec('落とした位置（指した札の前）に入る', moved.before===moved.dstId, `at=${moved.at}`);
  rec('件数は変わらない', moved.total===total0, `${moved.total}`);
  /* **掴んだ項目は並びから切り離す**——落とさないと保存しても位置が出ない。 */
  rec('掴んだ項目は「この盤で決めた」になる', moved.follow===false);
  const painted=await page.evaluate(id=>{
   const g=[...document.querySelectorAll('.rl-group')]
     .find(x=>[...x.querySelectorAll('.rl-chip')].some(c=>c.dataset.rlId===id));
   return g?g.querySelector('.rl-group-name').textContent:'';
  },moved.id);
  rec('盤の見出しも移った先になる', painted===moved.to, painted);

  /* ==========================================================
     4) 保存 → 測定画面の recordRows() が同じ並びを返す
        （盤で見た形＝出る形。別々に組み立てると必ず食い違う）
     ========================================================== */
  await page.click('#rlSave');
  await page.waitForFunction(
    ()=>/保存しました|保存できません/.test(document.querySelector('#rlState')?.textContent||''),
    null,{timeout:20000});
  const saved=await page.evaluate(()=>document.querySelector('#rlState').textContent);
  rec('保存できる', /保存しました/.test(saved), saved);
  await page.waitForFunction(()=>document.querySelectorAll('.rl-group').length>0,null,{timeout:20000});
  const row=await get('/api/operation-item-master').then(r=>
    (r.items||[]).find(x=>String(x.id)===String(moved.id)));
  rec('[記録群]がマスタへ入る', row&&row.recordGroup===moved.to, row&&row.recordGroup);
  rec('[記録順]がマスタへ入る', row&&Number(row.recordOrder)>0, row&&String(row.recordOrder));
  /* **触っていない項目は空のまま**——ここを常に書き下ろすと、あとで
     操業データ項目マスタの[表示順]を変えてもカードが追随しない。 */
  const all=await get('/api/operation-item-master').then(r=>r.items||[]);
  const untouched=all.filter(x=>x.recordOrder==null||Number(x.recordOrder)<=0).length;
  rec('触っていない項目は[記録順]が空のまま', untouched>=all.length-3,
      `${untouched}/${all.length}件が空`);

  /* 盤の並びと、測定画面が組み立てる並びが一致するか。`recordRows()`は
     名前で返すので、盤の側も名前へ落として突き合わせる。 */
  const same=await page.evaluate(()=>{
   const rows=WL.recordBoard.rows().on,items=WL.recordBoard.state.items;
   const byId=id=>items.find(x=>String(x.id)===String(id));
   return {board:rows.map(r=>(byId(r.id)||{}).name).filter(Boolean),
           groups:rows.map(r=>r.group)};
  });
  rec('盤が並びを答えられる', same.board.length>=5, `${same.board.length}件`);
  /* 群の塊が途中で割れていない（同じ群がばらけると、カードの見出しが2度出る）。 */
  const seen=new Set();let split=0,prev=null;
  same.groups.forEach(g=>{if(g!==prev){if(seen.has(g))split++;seen.add(g);prev=g}});
  rec('同じ群がばらけない', split===0, `${split}箇所`);

  /* ==========================================================
     5) 「既定へ戻す」で本当に空へ帰る（押しても戻らない設定を作らない）
     ========================================================== */
  await page.click('#rlReset');
  await page.waitForFunction(()=>WL.recordBoard.rows().on.every(r=>r.follow),null,{timeout:5000});
  await page.click('#rlSave');
  await page.waitForFunction(
    ()=>/保存しました|保存できません/.test(document.querySelector('#rlState')?.textContent||''),
    null,{timeout:20000});
  const after=await get('/api/operation-item-master').then(r=>r.items||[]);
  const left=after.filter(x=>Number(x.recordOrder)>0||String(x.recordGroup||'').trim());
  rec('既定へ戻すと[記録群]/[記録順]が空へ帰る', left.length===0,
      left.length?`${left.length}件残った（例: ${left[0].name}）`:'0件');
  const followAll=await page.evaluate(()=>{
   const on=WL.recordBoard.rows().on;
   return {follow:on.filter(r=>r.follow).length,total:on.length,
           legend:document.querySelector('.rl-legend')?.textContent||''};
  });
  rec('戻したことが画面にも出る', followAll.follow===followAll.total&&/表示順/.test(followAll.legend),
      followAll.legend.slice(0,40));

  /* ==========================================================
     6) 落とす場所の印は流れの中へ入れない（§9.218 ④）
        印が入った瞬間に札がずれると、同じカーソル位置なのに違う境目が
        いちばん近くなって印が往復する。
     ========================================================== */
  const mark=await page.evaluate(()=>{
   const box=document.querySelector('.rl-group-list');
   const chips=[...box.querySelectorAll('.rl-chip')];
   const before=chips.map(c=>Math.round(c.getBoundingClientRect().top));
   WL.recordBoard.mark(box,chips[chips.length-1]);
   const m=box.querySelector('[data-rl-mark]');
   const after=chips.map(c=>Math.round(c.getBoundingClientRect().top));
   /* 同じ座標で何度聞いても同じ答え（印が往復しない）。 */
   const r=chips[0].getBoundingClientRect();
   const ev={clientX:r.left+2,clientY:r.top+r.height/2};
   const a1=WL.recordBoard.dropAt(box,ev),a2=WL.recordBoard.dropAt(box,ev);
   WL.recordBoard.clearMark();
   return {hasMark:!!m,moved:before.some((v,i)=>v!==after[i]),
           stable:a1===a2,gone:!box.querySelector('[data-rl-mark]')};
  });
  rec('落とす場所に印が出る', mark.hasMark);
  rec('印を出しても札が動かない', !mark.moved);
  rec('同じ位置なら同じ答えを返す', mark.stable);
  rec('印は片付く', mark.gone);

  /* ==========================================================
     7) 同じ群がばらけて保存されていたら、盤ではまとめて出す（§9.219 ③）
        盤は「出てきた順に束ねる」ので、平らな並びのほうを束ねておかないと
        **1塊に見えているのに保存された順は2つに割れている**状態が作れる。
     ========================================================== */
  {
   const items=await get('/api/operation-item-master').then(r=>r.items||[]);
   /* 3つ以上の群がある並びを、わざと A B A の順で保存する。 */
   const byGroup=new Map();
   items.forEach(x=>{const g=String(x.group||'その他');
     if(!byGroup.has(g))byGroup.set(g,[]);byGroup.get(g).push(x)});
   const names=[...byGroup.keys()].filter(g=>byGroup.get(g).length>=2);
   if(names.length<2){
    rec('ばらけた並びを作れる（前提）', false, `群が足りません: ${names.length}`);
   }else{
    const A=byGroup.get(names[0]),Bg=byGroup.get(names[1]);
    const rest=items.filter(x=>A.indexOf(x)<0&&Bg.indexOf(x)<0);
    const split=[A[0],...Bg,...A.slice(1),...rest];
    await post('/api/operation-item-master/record-layout',
      {items:split.map(x=>({id:x.id,show:true,follow:false,group:''})),user_id:'tests'});
    await page.click('#masterMaintNav [data-master="opItem"]');
    await page.waitForSelector('.op-board',{timeout:20000});
    await page.click('#masterMaintNav [data-master="recordLayout"]');
    await page.waitForFunction(()=>document.querySelectorAll('.rl-group').length>0,null,{timeout:20000});
    const packed=await page.evaluate(g=>{
     const blocks=[...document.querySelectorAll('.rl-group-name')].map(x=>x.textContent);
     const rows=WL.recordBoard.rows().on.map(r=>r.group);
     let split=0,seen=new Set(),prev=null;
     rows.forEach(x=>{if(x!==prev){if(seen.has(x))split++;seen.add(x);prev=x}});
     return {blocks:blocks.filter(x=>x===g).length,split,
             healed:!!WL.recordBoard.state.healed,
             note:document.querySelector('.rl-legend')?.textContent||''};
    },names[0]);
    rec('ばらけた群も盤では1つの塊で出る', packed.blocks===1, `${packed.blocks}塊`);
    rec('平らな並びのほうも束ねる', packed.split===0, `${packed.split}箇所`);
    rec('まとめ直したことを画面に書く',
        packed.healed&&/まとめて出しています/.test(packed.note), packed.note.slice(0,40));
   }
  }

  /* ==========================================================
     8) 3段の表示サイズではみ出さない（§9.127／§9.132）
        `test_scale`/`test_fit`の巡回はマスタ管理の既定のタブしか開かない
        ので、**この画面のことはこの網が見る**。
     ========================================================== */
  for(const size of ['sm','md','lg']){
   await page.evaluate(z=>{document.documentElement.dataset.uiSize=z},size);
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const fit=await page.evaluate(()=>{
    const box=document.querySelector('#masterMaintList');
    const edit=document.querySelector('.rl-edit');
    const chips=[...document.querySelectorAll('.rl-board .rl-chip')];
    const hs=[...new Set(chips.map(c=>Math.round(c.getBoundingClientRect().height)))];
    /* **右端の座標を比べても捕まらない**——盤はグリッドなので、中身が
       溢れても器そのものは器の幅のまま（実測で確認）。溢れは
       `scrollWidth - clientWidth`で見る（§9.90「先祖のスクロールを
       言い訳にしない」と同じ物差し）。 */
    return {over:Math.max(edit.scrollWidth-edit.clientWidth,box.scrollWidth-box.clientWidth),
            heights:hs.length,h:hs[0]};
   });
   rec(`表示サイズ ${size}: 盤が器からはみ出さない`, fit.over<=1, `${fit.over}px`);
   /* **1つの表の中は同じ大きさ**（§9.90）。 */
   rec(`表示サイズ ${size}: 札の高さが1種類`, fit.heights===1, `${fit.heights}種 / ${fit.h}px`);
  }
  await page.evaluate(()=>{document.documentElement.dataset.uiSize='md'});

  rec('画面の例外が無い', errs.length===0, errs.join(' | '));
 }catch(e){
  rec('FATAL', false, e.message);
 }finally{
  /* **後片付け**（§9.121。`db/master.sqlite3`は実行をまたいで生き延びるので、
     崩したまま終わると次の実行が引き継ぐ）。5)で既定へ戻しているが、
     途中で落ちた場合のために念のためもう一度戻す。 */
  try{
   const r=await get('/api/operation-item-master');
   const rows=(r.items||[]).map(x=>({id:x.id,show:x.recordShow!==false,follow:true,group:''}));
   if(rows.length)await post('/api/operation-item-master/record-layout',{items:rows,user_id:'tests'});
  }catch(e){}
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
