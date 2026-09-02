/* test_rbmodal.js: 帳票ブロックの編集窓を組み直す（§9.249 ③）
   ============================================================
   利用者の指示:
     「帳票ブロックマスタに関して、モーダルを大きくしてください。大きくした
      モーダルに合うようにバランスよく再構築して、もっとわかりやすく視覚化
      した形で表示を工夫し設定しやすいものを作成してください。文字が多い
      わりにわかりにくく、情報の階層化、チャンク化も駆使し」

   ここで固定すること:
    - 窓が**大きく2段組み**（左＝決めること／右＝刷り上がりの見本）で、
      **横に溢れない**
    - 決めることが**4つの群**に束ねてある（チャンク化）
    - 種別・繰り返し・紙に出すが**見て選ぶ札**で、**新規でも既定が選ばれている**
      （選ばれていないと `data-when` で②の欄が丸ごと消える。実際に起きた）
    - 幅・高さが**紙のマス目**で決まり、**見本が実際に変わる**
    - 説明が**縦に長い列にならない**（短くして続きは`?`のtitleへ）
    - 保存の形は今までどおり（札が書いた値がそのまま保存される）
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B='http://127.0.0.1:5029';
const TAG='rb-'+Date.now().toString(36);
const post=(p,x)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(x)});
const get=p=>fetch(B+p).then(r=>r.json());

let b=null,page=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 page=await b.newPage({viewport:{width:1760,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));
 page.on('dialog',d=>d.accept());
 const made=[];
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:30000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintNav [data-master="reportBlock"]',{timeout:20000});
  await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'tests');
  await page.click('#masterMaintNav [data-master="reportBlock"]');
  await page.waitForSelector('#masterMaintAdd',{timeout:20000});
  await page.click('#masterMaintAdd');
  await page.waitForSelector('#maintEditorModal .mm-editor-dialog.is-builder',{state:'visible',timeout:15000});
  await page.waitForSelector('.rb-paper-grid > i',{timeout:10000});

  /* ---- 1) 大きい窓・2段組み・溢れない ---- */
  const box=await page.evaluate(()=>{
   const dlg=document.querySelector('.mm-editor-dialog');
   const body=document.querySelector('.mm-editor-body');
   const aside=document.querySelector('.rb-aside');
   const fields=document.querySelector('.mm-form-fields');
   const r=x=>x?x.getBoundingClientRect():null;
   const d=r(dlg),a=r(aside),f=r(fields);
   return {w:d&&Math.round(d.width),h:d&&Math.round(d.height),
     asideX:a&&Math.round(a.x),asideW:a&&Math.round(a.width),
     fieldsX:f&&Math.round(f.x),fieldsRight:f&&Math.round(f.right),
     overflowX:Math.round(body.scrollWidth-body.clientWidth),
     overflowY:Math.round(body.scrollHeight-body.clientHeight),
     inView:d&&d.right<=window.innerWidth+1&&d.left>=-1};
  });
  rec('窓が大きい（1700pxの窓で1400px以上）',box.w>=1400,JSON.stringify(box));
  rec('窓が画面からはみ出していない',box.inView===true,JSON.stringify({w:box.w}));
  rec('左＝決めること／右＝見本の2段組み',
      box.asideX>box.fieldsX&&box.fieldsRight<=box.asideX+1,
      JSON.stringify({fieldsRight:box.fieldsRight,asideX:box.asideX}));
  rec('横に溢れない',box.overflowX<=1,String(box.overflowX));
  /* ---- 1b) 縦も横も使い切る（§9.254 ①②、利用者の指示） ----
     「モーダルの表示領域を使い切れていません。表示エリアがもったいないので
      余白のままにせず、最大限活用するようにしてください。モーダルも縦方向に
      まだ大きくする余裕があるはずなのでこちらも含めて最大活用するように」
     **`max-height`だけだと中身なりの高さで止まる**（実測: 1000pxの画面で
     窓877px）。器の高さを与え、余りは中の盤へ配る。 */
  rec('窓が画面の縦をほぼ使い切る（中身なりの高さで止まらない）',
      box.h>=Math.round(1000*0.9),JSON.stringify({h:box.h,vh:1000}));
  rec('縦にも溢れない（外側がスクロールしない）',box.overflowY<=1,String(box.overflowY));

  /* ---- 1c) 「何を載せるか」の盤が余った高さを全部使う（§9.254 ①②） ----
     以前は`.fb-list`/`.fb-rows`が`max-height:18em`で頭打ちだったので、窓を
     いくら大きくしても候補126px・並び252pxで止まっていた（実測）。
     **左＝選べる項目：右＝紙での並び＝3:7**（利用者の指示「メインを最も
     大きく表示することを心掛けてください」）。
     **素通りに注意**: 「盤が在る」だけを見る網は、頭打ちのままでも通る。
     器（段のパネル）に対する割合と、左右の比を実測で見る。 */
  await page.evaluate(()=>{
   const t=[...document.querySelectorAll('.mm-tab')].find(x=>x.textContent.includes('何を載せるか'));
   if(t)t.click();
  });
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const fb=await page.evaluate(()=>{
   const r=x=>x?x.getBoundingClientRect():null;
   const panel=r(document.querySelector('.mm-tabpanel:not([hidden])'));
   const body=r(document.querySelector('.fb-body'));
   const pick=r(document.querySelector('.fb-pick')),ch=r(document.querySelector('.fb-chosen'));
   const list=r(document.querySelector('.fb-list')),rows=r(document.querySelector('.fb-rows'));
   return {panelH:panel&&Math.round(panel.height),bodyH:body&&Math.round(body.height),
     pickW:pick&&Math.round(pick.width),chosenW:ch&&Math.round(ch.width),
     listH:list&&Math.round(list.height),rowsH:rows&&Math.round(rows.height)};
  });
  rec('盤が段の高さをほぼ全部使う（余白のまま残さない）',
      fb.bodyH>=fb.panelH-40,JSON.stringify(fb));
  rec('選べる項目：紙での並び＝3:7（メインがいちばん大きい）',
      Math.abs(fb.pickW/(fb.pickW+fb.chosenW)-0.3)<0.03&&fb.chosenW>fb.pickW,
      JSON.stringify({pick:fb.pickW,chosen:fb.chosenW,
        比:(fb.pickW/(fb.pickW+fb.chosenW)).toFixed(2)}));
  rec('候補も並びも縦を使い切る（頭打ちで止まらない）',
      fb.listH>=fb.bodyH*0.6&&fb.rowsH>=fb.bodyH*0.6,JSON.stringify(fb));
  /* ---- 候補が多いときは**器の中でスクロールする**（§9.291 ①、利用者の報告
     「ブロックマスタの選べる項目がスクロールしないので、選べません」） ----
     段のパネルは「欄を規格幅で並べる**折り返す横並び**」が既定なので、
     盤を入れたままだと`.mm-field.fb{flex:1 1 100%}`の`100%`は**行の幅**の
     意味にしかならず、**高さは中身なり**になる。実データの候補は194件
     （仕掛の生データ）あるため盤が3,900px近くまで伸び、パネル
     （`overflow:hidden`）に**切り落とされて**下の項目へ辿り着けなかった。
     **材料は自分で注ぎ込む**——検証用の仕掛は34列しかなく、そのままでは
     器に収まってしまい、この道を一度も通らない（直す前でも通る）。 */
  const many=await page.evaluate(()=>{
   const l=document.querySelector('.fb-list');
   if(!l)return null;
   for(let i=0;i<200;i++){
    const b=document.createElement('button');
    b.type='button';b.className='fb-item';
    b.innerHTML='<span>ダミー'+i+'</span><small>source.dummy'+i+'</small>';
    l.appendChild(b);
   }
   const m=e=>e?{h:e.clientHeight,sh:e.scrollHeight,of:getComputedStyle(e).overflowY}:null;
   return {list:m(l),panel:m(document.querySelector('.mm-tabpanel:not([hidden])')),
           field:m(document.querySelector('.mm-field.fb')),
           札:l.querySelectorAll('.fb-item').length};
  });
  rec('前提: 候補を実データ相当まで増やせた',!!many&&many.札>=200,JSON.stringify(many&&many.札));
  rec('候補が多くても器の中でスクロールする（切り落とさない）',
      !!many&&many.list.sh>many.list.h+50&&many.list.of==='auto',
      JSON.stringify(many&&many.list));
  rec('段のパネルは伸びない（盤が段からはみ出さない）',
      !!many&&many.panel.sh<=many.panel.h+1&&many.field.h<=many.panel.h+1,
      JSON.stringify(many&&{panel:many.panel,field:many.field}));
  /* 見本の紙は**A4の比**（§9.254 ①。`max-height`で切ると比が崩れ、
     「紙に入るか」を確かめる道具にならない）。 */
  const paper=await page.evaluate(()=>{
   const b=document.querySelector('.rb-paper').getBoundingClientRect();
   return {w:Math.round(b.width),h:Math.round(b.height),r:+(b.height/b.width).toFixed(3)};
  });
  rec('見本の紙がA4の比（210:297）で出る',Math.abs(paper.r-297/210)<0.03,JSON.stringify(paper));

  /* ---- 2) 決めることが4つの段（タブ）に束ねてある（§9.250 ④） ----
     以前は縦に積んでいたので、1700×1000の窓でも**227pxはみ出していた**
     （利用者の指摘「スクロールベースで文字が配置されており、使いづらい」）。
     **段の見出しには決めた値の一言を出す**（開かないと分からない段は、
     結局全部開いて回ることになる・§2）。 */
  const groups=await page.evaluate(()=>[...document.querySelectorAll('#maintEditorForm .mm-fieldgroup')].map(x=>x.textContent.trim()));
  rec('決めることが4つの群に束ねてある',groups.length===4,JSON.stringify(groups));
  rec('群の並びが決める順番と同じ',
      groups[0].startsWith('①')&&groups[1].startsWith('②')&&groups[2].startsWith('③')&&groups[3].startsWith('④'),
      JSON.stringify(groups));
  const tabState=await page.evaluate(()=>({
    tabs:document.querySelectorAll('.mm-tab').length,
    panels:document.querySelectorAll('.mm-tabpanel').length,
    open:[...document.querySelectorAll('.mm-tabpanel')].filter(p=>!p.hidden).length,
    sums:[...document.querySelectorAll('.mm-tab-sum')].map(x=>x.textContent.trim())}));
  rec('段は一度に1つだけ開く（縦に積まない）',
      tabState.tabs===4&&tabState.panels===4&&tabState.open===1,JSON.stringify(tabState));
  rec('畳んだ段でも決めた値が見出しに出る（思い出させない）',
      tabState.sums.filter(Boolean).length>=2,JSON.stringify(tabState.sums));
  /* 段の帯と欄は**器の全幅を使う**（§9.250 ⑨、利用者の報告「タブを出す位置と、
     メインコンテンツ表示エリアがずれており、左側のスペースが完全に死に
     スペースになっていてもったいないです」）。`.mm-form-fields`は折り返す
     横並びなので、帯をそのまま入れると**欄1つぶんの札**として左に縮み、
     欄がその右へ回り込んで左下が丸ごと空く。
     **札の2行目が下に潜っていないこと**も見る（同「タブの中身もレイヤー
     表示を間違っていて下にもぐって見えなくなっています」）。 */
  const bar=await page.evaluate(()=>{
   const b=document.querySelector('.mm-tabbar');
   const f=document.querySelector('.mm-form-fields');
   const p=document.querySelector('.mm-tabpanel:not([hidden])');
   const r=e=>e.getBoundingClientRect();
   /* **縦の見切れは箱の中で起きる**（§9.253）——`.mm-tab-sum`は
      `overflow:hidden`なので、行送りぶんの高さが無いと**箱は札に収まった
      まま文字の下だけが欠ける**。「下へ潜る」（札からのはみ出し）だけを
      見る網はこれを素通りする（実際に素通りしていた。実測で
      箱10.05px / 中身15px＝5px欠け）。 */
   const cut=e=>Math.round(e.scrollHeight-e.clientHeight);
   const sums=[...document.querySelectorAll('.mm-tab')].map(t=>({
     下へ潜る:Math.round(r(t.querySelector('.mm-tab-sum')).bottom-r(t).bottom),
     切れ:Math.round(t.querySelector('.mm-tab-sum').scrollWidth-t.querySelector('.mm-tab-sum').clientWidth),
     縦切れ:cut(t.querySelector('.mm-tab-sum')),
     名の縦切れ:cut(t.querySelector('.mm-fieldgroup'))}));
   return {帯:Math.round(r(b).width),欄:Math.round(r(f).width),
     パネル:Math.round(r(p).width),
     帯の左:Math.round(r(b).left),パネルの左:Math.round(r(p).left),
     札:sums};
  });
  rec('段の帯と欄が器の全幅を使う（左が死にスペースにならない）',
      Math.abs(bar.帯-bar.欄)<=2&&Math.abs(bar.パネル-bar.欄)<=2
      &&Math.abs(bar.帯の左-bar.パネルの左)<=2,JSON.stringify(bar));
  rec('段の札の2行目が下に潜らない（見出しと今の値が両方読める）',
      bar.札.every(x=>x.下へ潜る<=0&&x.切れ<=1),JSON.stringify(bar.札));
  rec('段の札の文字が箱の中で切れない（§9.253。行送りぶんの高さがある）',
      bar.札.every(x=>x.縦切れ<=0&&x.名の縦切れ<=0),JSON.stringify(bar.札));
  rec('窓を開いた時点で縦に溢れない（スクロールレス）',box.overflowY===0,String(box.overflowY));
  /* 段を見出しの言葉で開く。**番号で探さないこと**——段が1つ増えただけで
     番号がずれる網は、直していないのに落ちる。 */
  const tab=async name=>{
   await page.evaluate(n=>{
    const t=[...document.querySelectorAll('.mm-tab')].find(x=>x.textContent.indexOf(n)>=0);
    if(t)t.click();
   },name);
   await page.waitForTimeout(200);
  };
  await tab('何を載せるか');

  /* ---- 3) 見て選ぶ札。**新規でも既定が選ばれている** ---- */
  const cards=await page.evaluate(()=>{
   const of=k=>{
    const on=document.querySelector(`[data-card="${k}"].is-on`);
    const hidden=document.querySelector(`#maintEditorForm [data-field="${k}"]`);
    return {n:document.querySelectorAll(`[data-card="${k}"]`).length,
            on:on?on.dataset.cardV:'',v:hidden?hidden.value:''};
   };
   return {kind:of('kindText'),repeat:of('repeatText'),enabled:of('enabledText')};
  });
  rec('種別・繰り返し・紙に出すが札で選べる',
      cards.kind.n===2&&cards.repeat.n===2&&cards.enabled.n===2,JSON.stringify(cards));
  rec('新規でも既定の札が選ばれている（選ばれていないと②が消える）',
      cards.kind.v==='項目の並び'&&cards.repeat.v&&cards.enabled.v==='有効',JSON.stringify(cards));
  const shown=await page.evaluate(()=>{
   const fb=document.querySelector('[data-fb]');
   return {builder:!!fb&&fb.offsetParent!==null,
           area:(()=>{const t=document.querySelector('#maintEditorForm textarea[data-field="text"]');
             return !!t&&t.closest('.mm-field').offsetParent!==null})()};
  });
  rec('②に「載せる項目」が出ている（既定が選ばれているから）',
      shown.builder&&!shown.area,JSON.stringify(shown));

  /* ---- 4) 幅は紙のマス目で決まり、見本が実際に変わる ---- */
  const measure=()=>page.evaluate(()=>{
   const bk=document.querySelector('#rbPaperBlock').getBoundingClientRect();
   const pg=document.querySelector('#rbPaperGrid').getBoundingClientRect();
   return {span:document.querySelector('#maintEditorForm [data-field="span"]').value,
           rows:document.querySelector('#maintEditorForm [data-field="rows"]').value,
           w:Math.round(bk.width/pg.width*100),h:Math.round(bk.height/pg.height*100),
           read:document.querySelector('#rbFactSpan').textContent,
           rowsRead:document.querySelector('#rbFactRows').textContent};
  });
  await tab('紙のどこへ出すか');
  const m0=await measure();
  await page.click('#maintEditorForm .mm-span-cell:nth-child(6)');
  await page.waitForTimeout(150);
  const m1=await measure();
  rec('紙のマス目を押すと幅が決まる',m1.span==='6',JSON.stringify(m1));
  rec('見本の塊の幅が実際に変わる',m1.w!==m0.w&&Math.abs(m1.w-50)<=2,
      JSON.stringify({before:m0.w,after:m1.w}));
  rec('何マス中の何分かを文字で出す',/6 \/ 12/.test(m1.read)&&/1\/2/.test(m1.read),m1.read);
  await page.click('#maintEditorForm .mm-rows-opt:nth-child(4)');
  await page.waitForTimeout(150);
  const m2=await measure();
  rec('高さを押すと見本の高さが変わる',m2.rows==='4'&&m2.h!==m1.h&&Math.abs(m2.h-33)<=2,
      JSON.stringify({rows:m2.rows,before:m1.h,after:m2.h}));
  rec('高さも文字で言う（中身なりか固定か）',/4行/.test(m2.rowsRead),m2.rowsRead);

  /* ---- 5) 種別を変えると②の中身が入れ替わり、見本も変わる ---- */
  await tab('これは何の塊か');
  await page.click('[data-card="kindText"][data-card-v="エリア（枠と文字）"]');
  await page.waitForTimeout(200);
  await tab('何を載せるか');
  const area=await page.evaluate(()=>{
   const fb=document.querySelector('[data-fb]');
   const t=document.querySelector('#maintEditorForm textarea[data-field="text"]');
   return {builder:!!fb&&fb.offsetParent!==null,
           area:!!t&&t.closest('.mm-field').offsetParent!==null,
           sec:document.querySelector('#rbSection').className,
           cols:document.querySelector('#rbFactCols').textContent};
  });
  rec('エリアにすると②が「置く文字」へ入れ替わる',!area.builder&&area.area,JSON.stringify(area));
  rec('エリアでは見本も枠だけの形になる',/is-area/.test(area.sec),area.sec);
  rec('エリアでは列数を「—」と言う（効かない設定を数字で見せない）',
      area.cols.indexOf('—')===0,area.cols);
  await tab('これは何の塊か');
  await page.click('[data-card="kindText"][data-card-v="項目の並び"]');
  await page.waitForTimeout(200);

  /* ---- 6) 説明が縦に長い列にならない ---- */
  const hints=await page.evaluate(()=>[...document.querySelectorAll('#maintEditorForm .mm-field-hint')]
    .map(h=>({t:h.textContent.trim().slice(0,16),h:Math.round(h.getBoundingClientRect().height)}))
    .filter(x=>x.h>72));
  rec('説明が縦に長い列にならない（3行以内）',hints.length===0,JSON.stringify(hints));
  const more=await page.evaluate(()=>{
   const s=[...document.querySelectorAll('#maintEditorForm .mm-field>span')].filter(x=>x.querySelector('.mm-more'));
   return {n:s.length,titled:s.filter(x=>(x.getAttribute('title')||'').length>20).length};
  });
  rec('短くした説明の続きは見出しのtitleから読める',more.n>=4&&more.n===more.titled,JSON.stringify(more));
  /* 続きは**押すと開く**（§9.250 ④）。`title`は触る画面では読めないので、
     「説明があるのに読めない」を残さない（§4）。 */
  const acc=await page.evaluate(async()=>{
   const raf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const b=document.querySelector('.mm-tabpanel:not([hidden]) .mm-more');
   if(!b)return {none:true};
   const before=!!document.querySelector('.mm-tabpanel:not([hidden]) .mm-more-body:not([hidden])');
   b.click();await raf();
   const body=b.closest('.mm-field').querySelector('.mm-more-body');
   const open=!!body&&!body.hidden&&body.textContent.trim().length>10;
   b.click();await raf();
   return {before,open,closed:!!body&&body.hidden,aria:b.getAttribute('aria-expanded')};
  });
  rec('くわしい説明は押すと開いて、もう一度押すと畳む',
      acc.before===false&&acc.open===true&&acc.closed===true,JSON.stringify(acc));

  /* ---- 6b) 紙の見本を四方から掴んで大きさを変えられる（§9.250 ④） ----
     利用者の指示「刷り上がりの見本という視覚表示があるのでこれを四方の
     どこからでもドラッグアンドドロップで大きさの変更ができるように」。
     **つまみが在ることだけを見ないこと**——実際に引いて、幅の値・札の印・
     紙の中の塊の3つが揃って変わることまで見る。 */
  await tab('紙のどこへ出すか');
  const grip=await page.evaluate(async()=>{
   const raf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const grid=document.querySelector('#rbPaperGrid').getBoundingClientRect();
   const cw=grid.width/12,ch=grid.height/12;
   const pull=async(dir,dx,dy)=>{
    const g=document.querySelector('.rb-grip-'+dir);
    if(!g)return null;
    const r=g.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    const ev=(t,cx,cy)=>{const e=new PointerEvent(t,{bubbles:true,clientX:cx,clientY:cy,pointerId:1,buttons:1});
      (t==='pointerdown'?g:document).dispatchEvent(e)};
    ev('pointerdown',x,y);ev('pointermove',x+dx,y+dy);await raf();ev('pointerup',x+dx,y+dy);await raf();
    return true;
   };
   const n=document.querySelectorAll('.rb-grip').length;
   const span0=document.querySelector('[data-field="span"]').value;
   await pull('e',-cw*3,0);
   const span1=document.querySelector('[data-field="span"]').value;
   const cells1=document.querySelectorAll('.mm-span-cell.is-on').length;
   const w1=Math.round(document.querySelector('#rbPaperBlock').getBoundingClientRect().width/grid.width*100);
   await pull('w',-cw*2,0);
   const span2=document.querySelector('[data-field="span"]').value;
   const rows0=document.querySelector('[data-field="rows"]').value;
   await pull('s',0,ch*2);
   const rows1=document.querySelector('[data-field="rows"]').value;
   const allow=(sel,attr)=>[...new Set([...document.querySelectorAll(sel)]
     .map(x=>Number(x.dataset[attr])).filter(n=>n>0))].sort((a,b)=>a-b);
   return {n,span0,span1,span2,cells1,w1,rows0,rows1,
     spanAllow:allow('.mm-span-grid [data-span-v]','spanV'),
     rowsAllow:allow('.mm-rows-pick [data-rows-v]','rowsV'),
     rowsOn:document.querySelector('.mm-rows-opt.is-on')?.dataset.rowsV};
  });
  rec('紙の見本に四方＋四隅の8つのつまみが出る',grip.n===8,JSON.stringify({n:grip.n}));
  rec('右の辺を引くと幅が縮み、マス目の札もそろう',
      Number(grip.span1)<Number(grip.span0)&&grip.cells1===Number(grip.span1)
      &&Math.abs(grip.w1-Number(grip.span1)/12*100)<=3,JSON.stringify(grip));
  rec('左の辺を引くと反対向きに広がる（四方から変えられる）',
      Number(grip.span2)>Number(grip.span1),JSON.stringify(grip));
  /* **選べる幅にしか止まらない**（§9.250 ④）。紙の幅は5段しかなく、
     サーバーが近い段へ丸めるので、途中の数を作れると**見本と保存が
     食い違う**（見本が嘘をつく・§CLAUDE 6）。 */
  rec('掴んで作れるのは選べる幅・高さだけ（見本と保存が食い違わない）',
      grip.spanAllow.indexOf(Number(grip.span1))>=0
      &&grip.spanAllow.indexOf(Number(grip.span2))>=0
      &&grip.rowsAllow.indexOf(Number(grip.rows1))>=0,JSON.stringify(grip));
  rec('下の辺を引くと高さが決まり、高さの札もそろう',
      Number(grip.rows1)>0&&String(grip.rowsOn)===String(grip.rows1),JSON.stringify(grip));

  /* ---- 6c) ダミーの値と紙全体（§9.250 ⑤、利用者の指示） ----
     「データダミーをつかって、帳票の表示が最終的にどうなるか…すぐに確認
      できる導線を準備してください」 */
  /* **中身の見本は紙と同じ組み立て**（§9.278、利用者の指示「帳票ブロックでの
     中身の作り込みが重要なのでダミーデータで中身の表示プレビューができる
     ように」）。以前はここに**2つ目の組み立て**（`.rb-cell`）があり、
     子ロットの繰り返しも「全体」の行も統計の値も出せず、大きさを見る以外の
     役に立っていなかった（§9.163）。 */
  /* **中身を入れてから見る**——空の塊で見ると「載せる項目がありません」が
     出るだけで、見本が紙と同じ組み立てかどうかを一度も通らない。 */
  await tab('何を載せるか');
  await page.evaluate(()=>{
   const c=[...document.querySelectorAll('[data-fb-cat]')].find(b=>/仕掛/.test(b.textContent||''));
   c&&c.click();
  });
  await page.waitForTimeout(250);
  await page.evaluate(()=>{
   const b=document.querySelector('[data-fb-add="basic.lotNo"]')
     ||document.querySelector('[data-fb-add]');
   b&&b.click();
  });
  await page.waitForTimeout(400);
  await page.waitForFunction(()=>{
   const s=document.querySelector('#rbSection');
   return s&&s.querySelector('.rp-section');
  },null,{timeout:20000}).catch(()=>{});
  const dummy=await page.evaluate(()=>{
   const s=document.querySelector('#rbSection');
   return {節:s.querySelectorAll('.rp-section').length,
     旧:s.querySelectorAll('.rb-cell').length,
     値:[...s.querySelectorAll('.rp-field-value')].map(x=>x.textContent.trim()).slice(0,6),
     note:(document.querySelector('#rbPreviewNote')||{}).textContent||''};
  });
  rec('中身の見本は紙と同じ組み立てで描く（2つ目の組み立てを持たない）',
      dummy.節===1&&dummy.旧===0,JSON.stringify(dummy));
  rec('見本の値の場所に見本のロットの値が入る（桁と文字数が実物に近い）',
      dummy.値.length>0&&dummy.値.some(v=>v&&v!=='-'),JSON.stringify(dummy.値));
  /* **どこから来た値かを書く**（§CLAUDE 6）——書かないと「見本に値が出て
     いる＝もう記録されている」と読まれる。 */
  rec('見本のロットで描いていること・保存されないことを書く',
      /見本のロット/.test(dummy.note)&&/保存されません/.test(dummy.note),dummy.note);
  /* **もう片側**——「見本の値」を切ると枠だけになる（片側だけを見る網は、
     いつも値を入れる実装でも通る）。 */
  await page.evaluate(()=>document.querySelector('#rbToggleDummy').click());
  await page.waitForTimeout(500);
  const bare=await page.evaluate(()=>({
   値:[...document.querySelectorAll('#rbSection .rp-field-value')].map(x=>x.textContent.trim()),
   note:(document.querySelector('#rbPreviewNote')||{}).textContent||''}));
  rec('「見本の値」を切ると枠だけになる（理由も言い直す）',
      bare.値.length>0&&bare.値.every(v=>v==='-')&&/値を入れずに/.test(bare.note),
      JSON.stringify(bare.値.slice(0,4))+' / '+bare.note);
  await page.evaluate(()=>document.querySelector('#rbToggleDummy').click());
  await page.waitForTimeout(400);
  const whole=await page.evaluate(async()=>{
   document.querySelector('#rbToggleOthers').click();
   await new Promise(r=>setTimeout(r,1200));
   const paper=document.querySelector('#rbPaper').getBoundingClientRect();
   const slot=document.querySelector('#rbPaperOthers [data-me]');
   const block=document.querySelector('#rbPaperBlock');
   const br=block.getBoundingClientRect(),sr=slot?slot.getBoundingClientRect():null;
   const body=document.querySelector('.mm-editor-body');
   return {n:document.querySelectorAll('#rbPaperOthers>i').length,
     hasSlot:!!slot,
     onSlot:!!sr&&Math.abs(br.left-sr.left)<=3&&Math.abs(br.top-sr.top)<=3
       &&Math.abs(br.width-sr.width)<=3&&Math.abs(br.height-sr.height)<=3,
     grips:document.querySelectorAll('#rbPaperBlock .rb-grip').length,
     inPaper:br.top>=paper.top-1&&br.bottom<=paper.bottom+1,
     ov:Math.round(body.scrollHeight-body.clientHeight)};
  });
  rec('「紙全体で見る」で同じ設備の塊が流し込まれる',whole.n>1&&whole.hasSlot,JSON.stringify(whole));
  rec('編集中の塊は流れの中の自分の席に重なる（掴めるまま）',
      whole.onSlot===true&&whole.grips===8,JSON.stringify(whole));
  rec('紙の外へはみ出さず、窓もスクロールしない',
      whole.inPaper===true&&whole.ov===0,JSON.stringify(whole));
  await page.evaluate(()=>document.querySelector('#rbToggleOthers').click());
  await page.waitForTimeout(300);

  /* ---- 7) 札が書いた値がそのまま保存される ---- */
  await tab('これは何の塊か');
  await page.fill('#maintEditorForm [data-field="name"]',TAG+'塊');
  await page.evaluate(()=>{
   const all=document.querySelector('[data-equipment-all="equipment"]');
   if(all&&!all.checked){all.checked=true;all.dispatchEvent(new Event('change',{bubbles:true}))}
  });
  await tab('紙のどこへ出すか');
  await page.click('[data-card="repeatText"][data-card-v="分割後の子ロットごと"]');
  /* **保存の前に画面の値を控える**（§9.250 ④）。札で押した値と掴んで
     変えた値のどちらもここへ来るので、**期待値を数で書き込まないこと**
     ——つまみの網を1つ足しただけで落ちる網になる。 */
  const want=await page.evaluate(()=>({
    span:document.querySelector('[data-field="span"]').value,
    rows:document.querySelector('[data-field="rows"]').value}));
  await page.click('#maintEditorSave');
  await page.waitForTimeout(1500);
  const rows=await get('/api/report-block-master');
  const saved=(rows.items||[]).find(x=>x.name===TAG+'塊');
  if(saved)made.push(saved.id);
  rec('札で選んだ値・掴んで変えた値がそのまま保存される',
      !!saved&&saved.kindText==='項目の並び'&&saved.repeatText==='分割後の子ロットごと'
      &&String(saved.span)===String(want.span)&&String(saved.rows)===String(want.rows),
      JSON.stringify({want,got:saved&&{k:saved.kindText,r:saved.repeatText,s:saved.span,rw:saved.rows}}));

  /* ---- 8) 開き直すと保存した値が札に出ている ---- */
  if(saved){
   await page.evaluate(id=>{
    const row=[...document.querySelectorAll('#masterMaintList .mm-row')]
      .find(r=>r.textContent.indexOf(id)>=0);
    if(row)row.click();
   },TAG+'塊');
   await page.waitForTimeout(900);
   await tab('紙のどこへ出すか');
   const back=await page.evaluate(()=>{
    const on=k=>{const e=document.querySelector(`[data-card="${k}"].is-on`);return e?e.dataset.cardV:''};
    return {kind:on('kindText'),repeat:on('repeatText'),
            span:document.querySelector('#maintEditorForm [data-field="span"]')?.value,
            spanOn:document.querySelectorAll('.mm-span-cell.is-on').length,
            name:document.querySelector('#rbPaperName')?.textContent};
   });
   rec('開き直すと保存した値が札とマス目に出ている',
       back.repeat==='分割後の子ロットごと'&&String(back.span)===String(want.span)
       &&back.spanOn===Number(want.span),
       JSON.stringify({back,want}));
   rec('見本の題が編集中の塊の名前になる',String(back.name).indexOf(TAG)>=0,String(back.name));
  }
  /* ==========================================================
     §9.303 ② 盤のマスが多段で重なる（利用者の報告）
     ----------------------------------------------------------
     「表を組み、多段になってくると、調整用のブロックが重なったりして
      乱れる」。盤のマスの下段（出どころ＋横N・縦M のつまみ）は列数が
     増えると折り返すが、**グリッドの行高はその折り返しを見込まない**
     ——`grid-auto-rows:minmax(3.4em,auto)`の`auto`（max-content）は
     「折り返さない前提」で高さを見積もるので、はみ出したぶんが**下のマスへ
     重なる**（実測: 中身83px／マスの内寸75px）。

     **材料は自分で注ぎ込むこと**（§9.291 ①）——検証用の塊は縦1列の
     少数なので、そのまま見ると折り返しが一度も起きずに通る。
     画像と同じ形（4列・見出し2段・縦2マスの札あり）をAPIで作って開く。
     ========================================================== */
  try{
   const cells=[];
   const put=o=>cells.push(Object.assign(
     {label:'',path:'',kind:'value',span:1,rows:1,showLabel:false},o));
   put({kind:'blank',span:2});
   put({kind:'head',label:'MIN'});put({kind:'head',label:'MAX'});
   put({kind:'head',label:'全体'});put({kind:'head',label:'板厚'});
   put({label:'板厚 MIN',path:'stat.thickness.min'});
   put({label:'板厚 MAX',path:'stat.thickness.max'});
   put({kind:'blank'});put({kind:'head',label:'板幅'});
   put({label:'板幅 MIN',path:'stat.width.min'});
   put({label:'板幅 MAX',path:'stat.width.max'});
   put({kind:'head',label:'対象',rows:2});
   put({kind:'head',label:'板厚'});
   put({label:'板厚 MIN',path:'stat.thickness.min'});
   put({label:'板厚 MAX',path:'stat.thickness.max'});
   put({kind:'blank'});put({kind:'head',label:'板幅'});
   put({label:'板幅 MIN',path:'stat.width.min'});
   put({label:'板幅 MAX',path:'stat.width.max'});
   const mx=await (await post('/api/report-block-master',
     {name:TAG+'マトリクス',equipment:'*',span:6,rows:0,cols:4,
      content:JSON.stringify(cells),user_id:'tests'})).json();
   if(mx&&mx.id)made.push(mx.id);
   rec('前提: 4列のマトリクスをマスタに作れた',!!(mx&&mx.ok&&mx.id),JSON.stringify(mx));
   await page.evaluate(()=>document.querySelector('#masterMaintNav [data-master="reportBlock"]')?.click());
   await page.waitForSelector('#masterMaintList .mm-row',{timeout:20000});
   await page.evaluate(n=>{
    const row=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')]
      .find(r=>(r.textContent||'').indexOf(n)>=0);
    if(row)row.click();
   },TAG+'マトリクス');
   await page.waitForSelector('#maintEditorModal',{state:'visible',timeout:20000});
   await tab('何を載せるか');
   await page.waitForSelector('#maintEditorModal .fb-rows .fb-row',{timeout:20000});
   await page.waitForTimeout(900);
   const fb=await page.evaluate(()=>{
    const wrap=document.querySelector('#maintEditorModal .fb-rows');
    const rows=[...wrap.querySelectorAll('.fb-row')];
    /* **枠から中身が出ていないか**を見る（これが「重なり」の実体——
       `.fb-row`は`overflow`を持たないので、溢れた下段が次のマスの上に
       描かれる）。 */
    const over=rows.filter(el=>el.scrollHeight>el.clientHeight+1)
      .map(el=>({i:el.dataset.fbI,sh:el.scrollHeight,ch:el.clientHeight}));
    /* 矩形どうしの重なりも数える（同じ段のマスは左右で分かれる）。 */
    const R=rows.map(el=>el.getBoundingClientRect());
    let hit=0;
    for(let a=0;a<R.length;a++)for(let c=a+1;c<R.length;c++){
     const ox=Math.min(R[a].right,R[c].right)-Math.max(R[a].left,R[c].left);
     const oy=Math.min(R[a].bottom,R[c].bottom)-Math.max(R[a].top,R[c].top);
     if(ox>1&&oy>1)hit++;
    }
    return {rows:rows.length,over,hit,
            cellH:wrap.style.getPropertyValue('--fb-cell-h'),
            /* 下段が本当に折り返している状態で見ているか（前提）。 */
            wrapped:rows.some(el=>{
             const b=el.querySelector('.fb-row-bot');
             return !!b&&b.getBoundingClientRect().height>20;
            })};
   });
   rec('前提: マスの下段が折り返す形で見ている（4列＋横/縦のつまみ）',
       fb.rows>=15&&fb.wrapped===true,JSON.stringify({rows:fb.rows,wrapped:fb.wrapped}));
   rec('マスの中身が枠からはみ出さない（下のマスへ重ならない）',
       fb.over.length===0,JSON.stringify(fb.over.slice(0,4)));
   rec('マスどうしの矩形が重ならない',fb.hit===0,String(fb.hit));
   /* **実測した高さを入れていること**——`minmax(3.4em,auto)`のままでは
      折り返しを見込めない（§9.303 ②）。 */
   rec('マスの高さを実測して入れている（--fb-cell-h）',
       /^\d+(\.\d+)?px$/.test(fb.cellH||''),String(fb.cellH));
   await page.evaluate(()=>{const b=document.getElementById('maintEditorClose');if(b)b.click()});
   await page.waitForTimeout(300);
  }catch(e){rec('FATAL(§9.303 ②)',false,e.message)}

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  /* **後始末**（§9.121）。db/master.sqlite3は実行をまたいで生き延びる。 */
  for(const id of made){
   try{await post('/api/report-block-master/delete',{id,user_id:'tests'})}catch(e){}
  }
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
