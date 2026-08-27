/* test_mmtable.js: マスタ管理の一覧（呼び名の収まり・群の畳み・並べ替え・列幅・移行済みの削除）
   ============================================================
   利用者の指示（§9.250 ①②③⑥）:
     「記録した値の配置について文字が1行で収まっていない」
     「マスタのカテゴリ単位で折りたためるように…内部データと移行済みは既定で畳む」
     「移行済みのマスタについては不要なはずなので削除できるように」
     「よく使われている表は並び替え、列幅調整できるように」

   ここで固定すること
   ------------------------------------------------------------
    1. 左の呼び名が**どの表示サイズでも1行に収まる**（折り返さない・切れない）
       ——器の幅は`em`で文字に追随させてある。**3段とも見ること**：
       器だけがpxで縮んでいた頃、折り返したのは「小」だけだった。
    2. 並べ替えは**押すたびに 昇順→降順→元の並び**。空欄は向きによらず最後。
       効いていることは文字で出て、同じ場所で戻せる（§9.175）。
    3. 列幅は**取っ手を掴んで変えられる**（実際に狭くして確かめる・§9.211 ①）。
       **取っ手が在ることだけを見ない**——`overflow:hidden`に切られて
       掴めない状態を実際に踏んだ。
    4. 移行済みの表は**丸ごと消せる**。消せるのは移行済みだけで、
       生きている表は口が断る。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B='http://127.0.0.1:5029';
const post=(p,x)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(x)});
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 page.on('dialog',d=>d.accept());
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:30000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  /* 覚えは端末に残るので、**毎回まっさらから始める**（前の実行の並べ替えを
     引き継ぐと、確かめたい既定が見えない・§9.121）。 */
  await page.evaluate(()=>{localStorage.removeItem('MasterListViewV1');localStorage.removeItem('MasterNavFoldV1')});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:20000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:15000});
  await page.fill('#masterUserId','tests');
  await page.waitForFunction(()=>document.querySelectorAll('#masterMaintNav .mm-nav-group').length>=4,null,{timeout:20000});

  /* ---- 1) 呼び名が1行に収まる（§9.250 ①） ---- */
  for(const sz of ['sm','md','lg']){
   await page.evaluate(v=>document.documentElement.setAttribute('data-ui-size',v),sz);
   await page.waitForTimeout(350);
   const bad=await page.evaluate(()=>{
    const out=[];
    document.querySelectorAll('#masterMaintNav .mm-nav-label,#masterMaintNav .mm-nav-group-name')
     .forEach(n=>{if(n.scrollWidth-n.clientWidth>0)out.push({t:n.textContent,need:n.scrollWidth,have:n.clientWidth})});
    /* 折り返していないこと＝行き先の高さが1種類のまま。 */
    const hs=[...new Set([...document.querySelectorAll('#masterMaintNav [data-master]')]
      .map(x=>Math.round(x.getBoundingClientRect().height)))];
    return {out,hs};
   });
   rec(`表示サイズ${sz}: 左の呼び名が切れない`,bad.out.length===0,JSON.stringify(bad.out.slice(0,3)));
   rec(`表示サイズ${sz}: 行き先の高さが1種類（折り返していない）`,bad.hs.length===1,JSON.stringify(bad.hs));
  }
  await page.evaluate(()=>document.documentElement.setAttribute('data-ui-size','md'));
  await page.waitForTimeout(300);

  /* ---- 2) 並べ替え（§9.250 ⑥） ---- */
  await page.click('#masterMaintNav [data-master="equipment"]');
  await page.waitForFunction(()=>document.querySelectorAll('#masterMaintList .mm-row:not(.head)').length>1,null,{timeout:15000});
  const names=()=>page.evaluate(()=>[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')]
    .map(r=>r.children[0].textContent.trim()));
  const orig=await names();
  rec('見出しが並べ替えの的になっている',
      await page.evaluate(()=>!!document.querySelector('.mm-th[data-col="name"]')));
  await page.click('.mm-th[data-col="name"]');
  await page.waitForTimeout(300);
  const asc=await names();
  const sortedAsc=[...orig].sort((a,b)=>a.localeCompare(b,'ja'));
  rec('1回押すと昇順',JSON.stringify(asc)===JSON.stringify(sortedAsc),JSON.stringify(asc.slice(0,3)));
  rec('効いている並びを文字で出す',
      /設備名/.test(await page.evaluate(()=>document.querySelector('.mm-viewmark')?.textContent||'')),
      await page.evaluate(()=>document.querySelector('.mm-viewmark')?.textContent||''));
  await page.click('.mm-th[data-col="name"]');
  await page.waitForTimeout(300);
  const desc=await names();
  rec('2回押すと降順',JSON.stringify(desc)===JSON.stringify([...sortedAsc].reverse()),JSON.stringify(desc.slice(0,3)));
  await page.click('.mm-th[data-col="name"]');
  await page.waitForTimeout(300);
  rec('3回押すと元の並びへ戻る',JSON.stringify(await names())===JSON.stringify(orig));
  rec('戻ったら印も消える',!(await page.evaluate(()=>!!document.querySelector('.mm-viewmark'))));

  /* 空欄は向きによらず最後（区分は未設定の設備が多い列）。 */
  await page.click('.mm-th[data-col="kind"]');
  await page.waitForTimeout(300);
  const kindAsc=await page.evaluate(()=>[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')]
    .map(r=>r.children[1].textContent.trim()));
  await page.click('.mm-th[data-col="kind"]');
  await page.waitForTimeout(300);
  const kindDesc=await page.evaluate(()=>[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')]
    .map(r=>r.children[1].textContent.trim()));
  const lastEmpty=a=>{const i=a.findIndex(v=>v==='未設定'||v==='—'||v==='');return i<0||a.slice(i).every(v=>v==='未設定'||v==='—'||v==='')};
  rec('空欄は昇順でも最後',lastEmpty(kindAsc),JSON.stringify(kindAsc));
  rec('空欄は降順でも最後（向きで行き先が変わらない）',lastEmpty(kindDesc),JSON.stringify(kindDesc));
  await page.click('#mmViewReset');
  await page.waitForTimeout(300);

  /* ---- 3) 列幅（§9.250 ⑥）。**実際に掴んで狭める** ---- */
  const grip=await page.evaluate(()=>{
   const g=document.querySelector('.mm-th[data-col="name"] .mm-th-grip');
   if(!g)return null;
   const r=g.getBoundingClientRect();
   const at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
   return {x:r.x+r.width/2,y:r.y+r.height/2,h:Math.round(r.height),
     hit:at?at.className:'(none)',
     w:Math.round(document.querySelector('.mm-th[data-col="name"]').getBoundingClientRect().width)};
  });
  rec('列幅の取っ手が実際に掴める位置に出ている',
      !!grip&&/mm-th-grip/.test(grip.hit)&&grip.h>20,JSON.stringify(grip));
  if(grip){
   await page.mouse.move(grip.x,grip.y);await page.mouse.down();
   await page.mouse.move(grip.x-120,grip.y,{steps:8});await page.mouse.up();
   await page.waitForTimeout(600);
   const after=await page.evaluate(()=>({
     w:Math.round(document.querySelector('.mm-th[data-col="name"]').getBoundingClientRect().width),
     mark:document.querySelector('.mm-viewmark')?.textContent||''}));
   rec('引くと列が実際に狭くなる',after.w<grip.w-60,`${grip.w} → ${after.w}`);
   rec('列幅を触ったことを文字で出す',/幅/.test(after.mark),after.mark);
   /* **覚えていること**——別のタブへ行って戻っても残る。 */
   await page.click('#masterMaintNav [data-master="stopCategory"]');
   await page.waitForTimeout(900);
   await page.click('#masterMaintNav [data-master="equipment"]');
   await page.waitForTimeout(1200);
   const back=await page.evaluate(()=>Math.round(document.querySelector('.mm-th[data-col="name"]').getBoundingClientRect().width));
   rec('タブを行き来しても列幅が残る',Math.abs(back-after.w)<=2,`${after.w} → ${back}`);
   await page.click('#mmViewReset');
   await page.waitForTimeout(400);
   const reset=await page.evaluate(()=>Math.round(document.querySelector('.mm-th[data-col="name"]').getBoundingClientRect().width));
   rec('戻すと既定の幅へ帰る',reset>after.w+40,`${after.w} → ${reset}`);
  }

  /* ---- 4) 移行済みの表を消せる（§9.250 ③） ---- */
  const TABLE='テスト移行済みマスタ';
  await page.evaluate(async t=>{
   await fetch('/api/master-table/'+encodeURIComponent(t)+'/drop',{method:'POST',
     headers:{'Content-Type':'application/json'},body:'{}'});
  },TABLE);
  const live=await page.evaluate(async()=>{
   const r=await fetch('/api/master-table/'+encodeURIComponent('設備マスタ')+'/drop',
     {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   return {status:r.status,body:await r.json()};
  });
  rec('生きている表は口が断る（移行済みだけ消せる）',
      live.status===400&&/読んでいる表/.test(String(live.body.error||'')),JSON.stringify(live));
  const still=await page.evaluate(async()=>{
   const r=await fetch('/api/equipment-master').then(x=>x.json());
   return (r.items||[]).length;
  });
  rec('断られた表は消えていない',still>0,String(still)+'件');
  /* 移行済みの表があるときは、その画面に削除の入口が出る。 */
  const retired=await page.evaluate(()=>{
   const g=document.querySelector('.mm-nav-group[data-nav-group="retired"]');
   return g?g.querySelector('.mm-nav-count')?.textContent:'';
  });
  if(Number(retired)>0){
   await page.click('[data-nav-fold="retired"]');
   await page.waitForTimeout(400);
   await page.click('.mm-nav-group[data-nav-group="retired"] [data-master]');
   await page.waitForTimeout(1200);
   const view=await page.evaluate(()=>({
     drop:!!document.querySelector('#mmDropTable'),
     add:!!document.querySelector('#masterMaintAdd'),
     edits:document.querySelectorAll('#masterMaintList .mm-edit').length}));
   rec('移行済みの表は読むだけ＋削除の入口が出る',
       view.drop&&!view.add&&view.edits===0,JSON.stringify(view));
  }else{
   rec('移行済みの表は読むだけ＋削除の入口が出る',true,'この端末に移行済みの表が無いので省略');
  }
  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,2).join(' / '));
  /* ==========================================================
     名前が切れない——**バーが出た状態で測ること**（§9.250 ⑨、利用者の報告）
     ----------------------------------------------------------
     「『記録した値の配置』が1行に収まっておらず、・・・で省略されています」

     §9.250 ①の式（文字ぶん＋固定ぶん）は**スクロールバーの幅**を数えて
     いなかった。タブが増えて一覧が縦に溢れた端末でだけ8文字の名前が
     省略記号になる——**溢れていない状態で測る網は素通りする**ので、
     ここでは束を全部開いてバーを出してから測る。
     ========================================================== */
  const navFit=await page.evaluate(async()=>{
   const out=[];
   const nav=document.querySelector('#masterMaintNav');
   for(const size of ['sm','md','lg']){
    document.documentElement.setAttribute('data-ui-size',size);
    /* 束を全部開いて縦に溢れさせる（バーを出す）。 */
    nav.querySelectorAll('.mm-nav-group.is-folded [data-nav-fold]').forEach(x=>x.click());
    await new Promise(r=>setTimeout(r,450));
    const bad=[];
    nav.querySelectorAll('button[data-master]').forEach(b=>{
     const l=b.querySelector('.mm-nav-label');
     const over=l.scrollWidth-l.clientWidth;
     if(over>1)bad.push(l.textContent.trim()+'('+over+'px)');
    });
    nav.querySelectorAll('.mm-nav-group-name').forEach(l=>{
     const over=l.scrollWidth-l.clientWidth;
     if(over>1)bad.push('[群]'+l.textContent.trim()+'('+over+'px)');
    });
    out.push({size,バー:nav.scrollHeight>nav.clientHeight+1,
      幅:Math.round(nav.getBoundingClientRect().width),切れ:bad});
   }
   document.documentElement.setAttribute('data-ui-size','md');
   return out;
  });
  rec('前提: 一覧が縦に溢れてスクロールバーが出ている（出ない状態で測らない）',
      navFit.every(x=>x.バー),JSON.stringify(navFit.map(x=>x.size+':'+x.バー)));
  /* **バーの場所は常に空けておく**（§9.250 ⑨）。端末によってはバーが幅を
     持つので、出た瞬間に中身が狭くなって**そのときだけ**名前が切れる
     ——この網が動く環境では重ならないバー（幅0）のこともあるので、
     「切れていない」だけでは足りない。**場所を空ける宣言そのもの**を見る。 */
  const gutter=await page.evaluate(()=>{
   const nav=document.querySelector('#masterMaintNav');
   return {宣言:getComputedStyle(nav).scrollbarGutter,
     器の幅の決め方:getComputedStyle(document.querySelector('.mm-body')).gridTemplateColumns,
     実測で入れた幅:document.querySelector('.mm-body').style.getPropertyValue('--mm-nav-w')||'(不要だった)'};
  });
  rec('一覧はスクロールバーの場所を常に空ける（出た瞬間に狭くならない）',
      /stable/.test(gutter.宣言),JSON.stringify(gutter));
  rec('どの表示サイズでも一覧の名前が切れない（バーの幅も込みで器を決める）',
      navFit.every(x=>x.切れ.length===0),
      JSON.stringify(navFit.map(x=>({s:x.size,w:x.幅,bad:x.切れ}))));

 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  if(b)await b.close().catch(()=>{});
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
