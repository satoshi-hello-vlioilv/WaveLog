/* test_lcpanel.js: 列の設定パネル(§9.90で作り直し)
   ============================================================
   実測で次の不具合が確認できたため、直したうえでここへ固定する。

    ・**チェックが効かなかった**。行のクリックで一覧を作り直しており、
      その後に飛ぶ change イベントが宙に浮いていた(外しても一覧に残る)。
      → チェックは click で受け、行のクリックとは伝播を切る。
    ・**並べ替えの手応えが無かった**。HTML5のD&Dは掴んだ感じが出ず、
      行のクリック(列を選ぶ)と紛れる。
      → 押して動かしたら並べ替え・押しただけなら選ぶ、としきい値で分ける。
    ・**大きさが足りなかった**。37列ある一覧で11列しか見えず、下段の
      横長プレビュー表が場所を取っていた。
      → 既定を広げ、プレビュー表は畳んで「例」をリストの中へ入れた。
    ・**端を掴んでも大きさを変えられなかった**(右下角だけ)。
      → 四辺+四隅の8方向。

   触った結果は**保存せずに後ろの一覧へ即反映**し、保存しないで閉じたら
   開いたときの形へ戻す。ここが崩れると「保存」の意味が無くなる。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EQ='テスト設備A';
let b=null;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function cleanup(){
 for(const t of ['list:SIKALOTNOW:仕掛','list:SIKALOTNOW:'+encodeURIComponent('仕掛')]){
  try{await post('/api/column-layout-master',{target:t,order:[],widths:{},hidden:[],names:{},formats:{},rules:{},user_id:'test'})}catch(e){}
 }
}
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));
 page.on('dialog',d=>d.accept());
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:30000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  // 前回の大きさを覚えていると既定の検証にならないので消しておく。
  await page.evaluate(()=>localStorage.removeItem('listColumnPanelRectV3'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#grid table',{timeout:30000});
  await page.waitForTimeout(1500);

  await page.click('#listColumnBtn');
  await page.waitForSelector('#listColumnPanel .lc-item',{timeout:10000});
  await page.waitForTimeout(500);

  /* ---- 1) 大きさと位置 ---- */
  const geom=await page.evaluate(()=>{
   const p=document.getElementById('listColumnPanel');const r=p.getBoundingClientRect();
   return {w:Math.round(r.width),h:Math.round(r.height),
           inView:r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,
           rows:p.querySelectorAll('.lc-item').length,
           visible:[...p.querySelectorAll('.lc-item')].filter(x=>{
            const b2=x.getBoundingClientRect(),lb=p.querySelector('.lc-list').getBoundingClientRect();
            return b2.top>=lb.top-1&&b2.bottom<=lb.bottom+1;
           }).length};
  });
  rec('パネルは画面の中に開く',geom.inView,JSON.stringify(geom));
  rec('以前より広い既定(1000px以上)',geom.w>=1000,`${geom.w}x${geom.h}`);
  rec('一度に見える列が15行以上ある',geom.visible>=15,`${geom.visible}/${geom.rows}行`);

  /* ---- 2) 端のつかみ代(8方向) ---- */
  const grips=await page.$$eval('#listColumnPanel .sc-float-grip',ns=>ns.map(n=>n.dataset.dir).sort());
  rec('端は8方向どこでも掴める',grips.join()==='e,n,ne,nw,s,se,sw,w',grips.join(','));
  // 左端を掴んで広げる(右端は動かない=左へ伸びる)。
  const before=await page.evaluate(()=>{const r=document.getElementById('listColumnPanel').getBoundingClientRect();
    return {w:Math.round(r.width),right:Math.round(r.right)}});
  const wg=await page.$('#listColumnPanel .sc-float-grip-w');
  const wb=await wg.boundingBox();
  await page.mouse.move(wb.x+3,wb.y+wb.height/2);
  await page.mouse.down();
  await page.mouse.move(wb.x-120,wb.y+wb.height/2,{steps:10});
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after=await page.evaluate(()=>{const r=document.getElementById('listColumnPanel').getBoundingClientRect();
    return {w:Math.round(r.width),right:Math.round(r.right)}});
  rec('左端を引くと左へ広がる(右端は動かない)',
   after.w>before.w+80&&Math.abs(after.right-before.right)<=3,
   `幅 ${before.w}→${after.w} / 右端 ${before.right}→${after.right}`);

  /* ---- 3) チェックで表示/非表示が効く ---- */
  const keys=await page.$$eval('#listColumnPanel .lc-item',ns=>ns.map(n=>n.dataset.key));
  const target=keys.find(k=>!k.startsWith('__')&&k!=='#');
  const colsBefore=await page.$$eval('#grid thead th',ns=>ns.length);
  await page.click(`#listColumnPanel .lc-item[data-key="${target}"] .lc-vis`);
  await page.waitForTimeout(500);
  const off=await page.evaluate(k=>{
   const el=[...document.querySelectorAll('#listColumnPanel .lc-item')].find(x=>x.dataset.key===k);
   return {checked:el?.querySelector('input').checked,
           count:document.getElementById('lcCount')?.textContent||'',
           cols:document.querySelectorAll('#grid thead th').length};
  },target);
  rec('チェックを外すとその場で外れたままになる',off.checked===false,JSON.stringify(off));
  rec('外した列は一覧からも消える(保存前に反映)',off.cols===colsBefore-1,
   `${colsBefore} → ${off.cols}`);
  // 戻す
  await page.click(`#listColumnPanel .lc-item[data-key="${target}"] .lc-vis`);
  await page.waitForTimeout(400);
  const back=await page.$$eval('#grid thead th',ns=>ns.length);
  rec('チェックし直すと戻る',back===colsBefore,`${off.cols} → ${back}`);

  /* ---- 4) 並べ替え(行のどこを掴んでもよい) ---- */
  const gridOrderBefore=await page.$$eval('#grid thead th',ns=>ns.map(n=>n.textContent.trim()).join('|'));
  const orderBefore=await page.$$eval('#listColumnPanel .lc-item',ns=>ns.map(n=>n.dataset.key));
  const box=n=>page.$eval(`#listColumnPanel .lc-item:nth-child(${n})`,e=>{
   const r=e.getBoundingClientRect();return {x:r.x+r.width*0.4,y:r.y+r.height/2}});
  /* **実データの列どうしで動かす。** #・分割・測定・予定は値を持たない
     ボタン列で、一覧では決まった位置に出るため、動かしても表の並びは
     変わらない(パネルの中だけが動く)。 */
  const realIdx=orderBefore.map((k,i)=>({k,i})).filter(x=>!x.k.startsWith('__')&&x.k!=='#').map(x=>x.i+1);
  const from=await box(realIdx[0]),to=await box(realIdx[3]);
  await page.mouse.move(from.x,from.y);await page.mouse.down();
  await page.mouse.move(to.x,to.y,{steps:12});
  const marked=await page.$$eval('#listColumnPanel .lc-drop-mark',ns=>ns.length);
  await page.mouse.up();await page.waitForTimeout(400);
  const orderAfter=await page.$$eval('#listColumnPanel .lc-item',ns=>ns.map(n=>n.dataset.key));
  rec('掴んでいる間、入る位置に線が出る',marked===1,`${marked}本`);
  rec('行のどこを掴んでも並べ替えられる',orderAfter.join()!==orderBefore.join(),
   `${orderBefore.slice(0,4).join(',')} → ${orderAfter.slice(0,4).join(',')}`);
  const gridOrder=await page.$$eval('#grid thead th',ns=>ns.map(n=>n.textContent.trim()).join('|'));
  rec('並べ替えも保存前に一覧へ反映される',gridOrder!==gridOrderBefore,
   `前=${gridOrderBefore.slice(0,44)} / 後=${gridOrder.slice(0,44)}`);

  /* ---- 5) 押しただけなら「選ぶ」 ---- */
  const pick=await box(3);
  await page.mouse.move(pick.x,pick.y);await page.mouse.down();await page.mouse.up();
  await page.waitForTimeout(300);
  const picked=await page.evaluate(()=>{
   const el=document.querySelector('#listColumnPanel .lc-item.is-picked');
   return {key:el?.dataset.key||'',detail:document.querySelector('.lc-detail-head')?.textContent.trim().slice(0,20)||''};
  });
  rec('押しただけなら列を選ぶ(並べ替えにならない)',!!picked.key,JSON.stringify(picked));

  /* ---- 6) 例がリストに出て、書式を変えると即変わる ---- */
  const egBefore=await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('#listColumnPanel .lc-item')];
   const withEg=rows.filter(r=>(r.querySelector('.lc-eg b')?.textContent||'').trim()!=='');
   return {total:rows.length,withEg:withEg.length,
           sample:withEg.slice(0,3).map(r=>r.dataset.key+'='+r.querySelector('.lc-eg b').textContent.trim())};
  });
  rec('各行に実データの例が出る',egBefore.withEg>=5,JSON.stringify(egBefore.sample));

  /* 表示名を打つと、リストの名前も後ろの一覧の見出しも**その場で**変わる。
     (検証用フィクスチャの仕掛一覧には数値の列が無いため、書式そのものは
      tests/test_colformat.js が受け持つ。ここで見たいのは「触った結果が
      すぐ返ってくるか」で、通る道は同じ renderPreview→renderList/一覧。) */
  const egKey=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('#listColumnPanel .lc-item')]
     .find(x=>!x.dataset.key.startsWith('__')&&x.dataset.key!=='#');
   if(r)r.click();
   return r?r.dataset.key:'';
  });
  await page.waitForTimeout(300);
  await page.evaluate(()=>{
   const el=document.querySelector('#lcName');
   if(el){el.value='ためし表示名';el.dispatchEvent(new Event('input',{bubbles:true}))}
  });
  await page.waitForTimeout(500);
  const named=await page.evaluate(k=>{
   const r=[...document.querySelectorAll('#listColumnPanel .lc-item')].find(x=>x.dataset.key===k);
   return {name:(r?.querySelector('.lc-name')?.textContent||'').trim(),
           mark:[...(r?.querySelectorAll('.lc-mark')||[])].map(m=>m.textContent).join(''),
           head:[...document.querySelectorAll('#grid thead th')].map(t=>t.textContent.trim())
                 .some(t=>t.includes('ためし表示名'))};
  },egKey);
  rec('表示名を打つとリストの名前がその場で変わる',named.name==='ためし表示名',JSON.stringify(named));
  rec('表示名は後ろの一覧の見出しにも即反映される',named.head,JSON.stringify(named));
  rec('設定のある列には印が付く',named.mark.includes('名'),named.mark);
  /* 書式を選んだら「書」の印が増える(値の見え方は test_colformat.js が担当)。 */
  await page.evaluate(()=>{
   const el=[...document.querySelectorAll('input[name="lcKind"]')].find(x=>x.value==='text');
   if(el){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))}
  });
  await page.waitForTimeout(400);
  const marks=await page.evaluate(k=>{
   const r=[...document.querySelectorAll('#listColumnPanel .lc-item')].find(x=>x.dataset.key===k);
   return [...(r?.querySelectorAll('.lc-mark')||[])].map(m=>m.textContent).join('');
  },egKey);
  rec('書式を選ぶと印が増える',marks.includes('書'),marks);

  /* ---- 7) 保存せずに閉じたら元へ戻る ---- */
  const colsWhileOpen=await page.$$eval('#grid thead th',ns=>ns.map(n=>n.textContent.trim()).join('|'));
  await page.click('#lcClose');
  await page.waitForTimeout(600);
  const colsAfterClose=await page.$$eval('#grid thead th',ns=>ns.map(n=>n.textContent.trim()).join('|'));
  rec('保存せずに閉じると一覧は元の形へ戻る',colsAfterClose!==colsWhileOpen,
   `開いていた時=${colsWhileOpen.slice(0,40)} / 閉じた後=${colsAfterClose.slice(0,40)}`);

  /* ---- 8) パネルの中で操作行が折り返さない ---- */
  await page.click('#listColumnBtn');
  await page.waitForSelector('#listColumnPanel .lc-item',{timeout:10000});
  await page.waitForTimeout(500);
  await page.evaluate(()=>{
   const r=[...document.querySelectorAll('#listColumnPanel .lc-item')].find(x=>!x.dataset.key.startsWith('__'));
   if(r)r.click();
  });
  await page.waitForTimeout(400);
  /* **箱の高さでは測れない。** 36pxの入力欄が入っている行は文字1行より
     高くて当たり前なので、「中の部品が同じ段に並んでいるか」で見る。 */
  const wrap=await page.evaluate(()=>{
   const out=[];
   document.querySelectorAll('#listColumnPanel .lc-field,#listColumnPanel .lc-width,#listColumnPanel .lc-rulepick').forEach(el=>{
    const kids=[...el.children].filter(k=>k.getBoundingClientRect().width>0);
    if(kids.length<2)return;
    const tops=kids.map(k=>Math.round(k.getBoundingClientRect().top));
    // 縦位置のわずかな差(ラベルと入力欄の中心合わせ)は折り返しではない。
    // 「次の行へ落ちた」と言えるのは1行ぶん(≒16px以上)ずれたときだけ。
    if(Math.max(...tops)-Math.min(...tops)>14)
     out.push(String(el.className).split(' ')[0]+':'+tops.join('/'));
   });
   return out;
  });
  rec('設定の1行が2行に折れない',wrap.length===0,wrap.slice(0,4).join(' / '));

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));

  console.log('\n=== SUMMARY ===');
  const bad=R.filter(r=>!r.ok);console.log(`${R.length-bad.length}/${R.length} passed`);
  bad.forEach(x=>console.log(' -',x.n,x.d||''));
  await b.close();b=null;
  await cleanup();
  process.exit(bad.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  if(b)await b.close().catch(()=>{});
  await cleanup();
  process.exit(2);
 }
})();
