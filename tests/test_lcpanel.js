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
  await page.evaluate(()=>{localStorage.removeItem('listColumnPanelRectV3');
                          localStorage.removeItem('listColumnPanelRectV4')});
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

  /* ---- 9) 出どころの分類(§9.105) ----
     列を前にして最初に知りたいのは「この項目はどこから来たのか」。
     元データ／結合／計算・操作の3つを、**色だけでなく文字と件数**で示す。 */
  const cls=await page.evaluate(()=>{
   const p=document.getElementById('listColumnPanel');
   const chips=[...p.querySelectorAll('.lc-origin-chip')].map(c=>({
    origin:c.dataset.origin,text:c.textContent.trim(),n:Number(c.querySelector('b')?.textContent||0),
    disabled:c.disabled}));
   const rows=[...p.querySelectorAll('.lc-item')];
   const kinds={};rows.forEach(r=>{kinds[r.dataset.origin]=(kinds[r.dataset.origin]||0)+1});
   const dot=c=>{const d=p.querySelector(`.lc-item[data-origin="${c}"] .lc-dot`);
                 return d?getComputedStyle(d).backgroundColor:''};
   return {chips,kinds,行数:rows.length,
           点の色:{source:dot('source'),calc:dot('calc')},
           印付き:rows.filter(r=>r.querySelector('.lc-dot')).length};
  });
  rec('出どころのチップが「すべて＋3分類」ある',cls.chips.length===4,
    cls.chips.map(c=>c.text).join(' / '));
  rec('チップは件数を数字で出す（色だけに頼らない）',
    cls.chips.every(c=>/\d/.test(c.text)),cls.chips.map(c=>c.text).join(' / '));
  rec('3分類の合計が全列数と合う',
    cls.chips.filter(c=>c.origin).reduce((a,c)=>a+c.n,0)===cls.行数,
    JSON.stringify(cls.kinds));
  rec('どの行にも出どころの印が付く',cls.印付き===cls.行数,`${cls.印付き}/${cls.行数}`);
  rec('分類ごとに色が違う（元データと計算列）',
    !!cls.点の色.source&&cls.点の色.source!==cls.点の色.calc,JSON.stringify(cls.点の色));
  rec('0件の分類は押せない（押しても何も起きないボタンを見せない）',
    cls.chips.filter(c=>c.origin&&c.n===0).every(c=>c.disabled),
    cls.chips.filter(c=>c.n===0).map(c=>c.text).join(','));

  /* 分類で絞ると、その分類の行だけになる。 */
  const calcN=cls.chips.find(c=>c.origin==='calc')?.n||0;
  await page.evaluate(()=>document.querySelector('.lc-origin-chip[data-origin="calc"]')?.click());
  await page.waitForTimeout(250);
  const filtered=await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('#listColumnPanel .lc-item')];
   return {n:rows.length,ok:rows.every(r=>r.dataset.origin==='calc')};
  });
  rec('分類で絞るとその分類だけになる',filtered.ok&&filtered.n===calcN,
    `${filtered.n}行 / 期待${calcN}行`);
  /* まとめて出す/隠すは「出す」列の見出しのチェック(§9.106)。
     **押す場所と効く場所が同じ列**にあり、効くのは絞り込んで見えている列だけ。 */
  const headsBefore=await page.$$eval('#grid thead th',ns=>ns.length);
  const allBox=await page.evaluate(()=>{
   const b=document.getElementById('lcAllVis');
   return b?{checked:b.checked,indeterminate:b.indeterminate}:null;
  });
  rec('「出す」の見出しに全選択チェックがある',!!allBox,JSON.stringify(allBox));
  await page.click('#lcAllVis');                    // いま絞り込み中の3列を隠す
  await page.waitForTimeout(400);
  const headsHidden=await page.$$eval('#grid thead th',ns=>ns.length);
  rec('全選択チェックを外すと絞り込んだぶんだけ隠れる',
    headsHidden===headsBefore-calcN,`${headsBefore} → ${headsHidden}（計算列${calcN}本）`);
  const midway=await page.evaluate(()=>{
   const b=document.getElementById('lcAllVis');return {checked:b.checked,ind:b.indeterminate};
  });
  rec('全部隠したらチェックも外れる',midway.checked===false&&midway.ind===false,JSON.stringify(midway));
  await page.click('#lcAllVis');
  await page.waitForTimeout(400);
  const headsShown=await page.$$eval('#grid thead th',ns=>ns.length);
  rec('チェックし直すと戻る',headsShown===headsBefore,`${headsHidden} → ${headsShown}`);
  await page.evaluate(()=>document.querySelector('.lc-origin-chip[data-origin=""]')?.click());
  await page.waitForTimeout(250);

  /* 一部だけ出ている状態では中間表示にする(外れて見えると「全部隠れている」と読める)。 */
  await page.evaluate(()=>{
   const r=[...document.querySelectorAll('#listColumnPanel .lc-item')][0];
   r?.querySelector('.lc-vis input')?.click();
  });
  await page.waitForTimeout(350);
  const partial=await page.evaluate(()=>{
   const b=document.getElementById('lcAllVis');return {checked:b.checked,ind:b.indeterminate};
  });
  rec('一部だけ出ているときは中間表示になる',partial.ind===true,JSON.stringify(partial));
  await page.evaluate(()=>{
   const r=[...document.querySelectorAll('#listColumnPanel .lc-item')][0];
   r?.querySelector('.lc-vis input')?.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(()=>document.querySelector('.lc-origin-chip[data-origin=""]')?.click());
  await page.waitForTimeout(250);

  /* ---- 9b) 幅を内容に合わせる(§9.106) ---- */
  const fit=await page.evaluate(async()=>{
   const key=[...document.querySelectorAll('#listColumnPanel .lc-item')]
     .find(r=>r.dataset.origin==='source')?.dataset.key;
   if(!key)return null;
   const th=()=>document.querySelector(`#grid thead th[data-sort-col="${CSS.escape(key)}"]`);
   const before=Math.round(th().getBoundingClientRect().width);
   // わざと広げてから「幅を内容に合わせる」で戻す
   const t=listLayoutTarget();
   const cur=WL.columnLayout.get(t);
   WL.columnLayout.stage(t,{...cur,widths:{...(cur.widths||{}),[key]:600}});
   renderGrid();
   await new Promise(r=>setTimeout(r,300));
   const wide=Math.round(th().getBoundingClientRect().width);
   return {key,before,wide};
  });
  if(fit){
   rec('幅を手で決めると一覧の列も広がる',fit.wide>fit.before+100,JSON.stringify(fit));
   /* パネルを開き直して(下地の値を読ませて)からオートフィット。 */
   await page.click('#lcClose');await page.waitForTimeout(300);
   await page.click('#listColumnBtn');
   await page.waitForSelector('#listColumnPanel .lc-item',{timeout:10000});
   await page.waitForTimeout(400);
   await page.click('#lcAutoFit');
   await page.waitForTimeout(500);
   const after=await page.evaluate(k=>Math.round(
     document.querySelector(`#grid thead th[data-sort-col="${CSS.escape(k)}"]`).getBoundingClientRect().width),fit.key);
   rec('「幅を内容に合わせる」で余分な幅が消える',after<fit.wide-100,
     `${fit.wide}px → ${after}px（元 ${fit.before}px）`);
  }

  /* ---- 10) 右ペインは「素性 → ①②③ → 結果」の順(§9.105) ---- */
  await page.evaluate(()=>{
   const r=[...document.querySelectorAll('#listColumnPanel .lc-item')]
     .find(x=>x.dataset.origin==='source');
   if(r)r.click();
  });
  await page.waitForTimeout(350);
  const pane=await page.evaluate(()=>{
   const d=document.getElementById('lcDetail');
   const y=s=>{const e=d.querySelector(s);return e?Math.round(e.getBoundingClientRect().top):-1};
   return {カード:y('.lc-card'),手順:[...d.querySelectorAll('.lc-step-no')].map(n=>n.textContent),
           手順の位置:[...d.querySelectorAll('.lc-step')].map(e=>Math.round(e.getBoundingClientRect().top)),
           結果:y('.lc-preview'),
           素性の数:d.querySelectorAll('.lc-facts dt').length,
           分類チップ:(d.querySelector('.lc-chip')?.textContent||'').trim(),
           プレビュー行:d.querySelectorAll('.lc-pv tbody tr').length};
  });
  rec('右ペインの先頭に「この列は何者か」のカードが出る',
    pane.カード>=0&&pane.素性の数>=2&&!!pane.分類チップ,JSON.stringify(pane.分類チップ));
  rec('手順に番号が振ってある（①②③）',pane.手順.join()==='1,2,3',pane.手順.join(','));
  rec('番号の順に上から並んでいる',
    pane.手順の位置.every((v,i,a)=>i===0||v>a[i-1]),JSON.stringify(pane.手順の位置));
  rec('結果は手順のあと（下）に出る',
    pane.結果>Math.max(...pane.手順の位置),`結果${pane.結果} / 手順${pane.手順の位置.join(',')}`);
  /* **1件では「たまたま」と区別が付かない**ので複数件で見せる。 */
  rec('結果は実データを複数件そろえて見せる',pane.プレビュー行>=2&&pane.プレビュー行<=3,
    `${pane.プレビュー行}件`);

  /* 計算列は値を持たないので、②③を出さずに理由を書く。 */
  await page.evaluate(()=>{
   const r=[...document.querySelectorAll('#listColumnPanel .lc-item')]
     .find(x=>x.dataset.origin==='calc');
   if(r)r.click();
  });
  await page.waitForTimeout(350);
  const virt=await page.evaluate(()=>{
   const d=document.getElementById('lcDetail');
   return {手順:d.querySelectorAll('.lc-step').length,
           断り:(d.querySelector('.lc-note-calc')?.textContent||'').trim().slice(0,24),
           結果:!!d.querySelector('.lc-preview')};
  });
  rec('計算列では書式・読み替えを出さず、理由を書く',
    virt.手順===1&&!!virt.断り&&!virt.結果,JSON.stringify(virt));

  /* ---- 11) モーダルの並び＝一覧の並び(§9.106) ----
     番号・ボタンの列(#・分割・測定・予定)も**データ列と同じ1本の並び**に
     載っていること。以前はデータ列だけを並べ替え、番号・ボタンは決まった
     位置へ無条件に描いていたため、パネルで動かしても一覧は変わらなかった。 */
  const same=async()=>page.evaluate(()=>{
   const panel=[...document.querySelectorAll('#listColumnPanel .lc-item')]
     .filter(r=>r.querySelector('.lc-vis input').checked).map(r=>r.dataset.key);
   const label=k=>{
    const el=document.querySelector(`#listColumnPanel .lc-item[data-key="${CSS.escape(k)}"] .lc-name`);
    return (el?.textContent||'').trim();
   };
   const grid=[...document.querySelectorAll('#grid thead th')].map(th=>th.textContent.trim());
   return {panel,grid,panelLabels:panel.map(label)};
  });
  const ord0=await same();
  rec('見えている列の本数がモーダルと一覧で一致する',
    ord0.panel.length===ord0.grid.length,`モーダル${ord0.panel.length} / 一覧${ord0.grid.length}`);

  /* `#`を下へ動かすと、一覧でも同じ位置へ動くこと。 */
  const moved=await page.evaluate(async()=>{
   const list=document.getElementById('lcList');
   const rows=[...list.querySelectorAll('.lc-item')];
   const from=rows.findIndex(r=>r.dataset.key==='#');
   if(from<0)return {skip:true};
   const src=rows[from],dst=rows[from+3];
   if(!dst)return {skip:true};
   const box=e=>e.getBoundingClientRect();
   const a=box(src),b2=box(dst);
   const ev=(t,x,y)=>src.dispatchEvent(new MouseEvent(t,{bubbles:true,clientX:x,clientY:y,button:0}));
   ev('mousedown',a.left+40,a.top+a.height/2);
   for(let i=1;i<=6;i++){
    const y=a.top+a.height/2+(b2.bottom-a.top)*i/6;
    document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:a.left+40,clientY:y}));
   }
   document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:a.left+40,clientY:b2.bottom}));
   await new Promise(r=>setTimeout(r,500));
   return {skip:false};
  });
  if(moved.skip){
   rec('「#」を動かすと一覧の並びも同じになる',false,'並べ替えの起点が見つからなかった');
  }else{
   await page.waitForTimeout(600);
   const ord1=await same();
   const idxPanel=ord1.panel.indexOf('#');
   /* 一覧側の「#」の位置は見出しの文字で探す(パネルの表示名と同じ)。 */
   const idxGrid=ord1.grid.indexOf('#');
   rec('「#」がモーダルで先頭から動いた',idxPanel>0,`モーダル ${idxPanel}番目`);
   rec('「#」を動かすと一覧の並びも同じ位置になる',idxPanel===idxGrid&&idxGrid>0,
     `モーダル${idxPanel} / 一覧${idxGrid}`);
  }

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
