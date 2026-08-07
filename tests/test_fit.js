/* test_fit.js: 中身が器から溢れていないかを、表示サイズ5段階で実測する。
   ------------------------------------------------------------
   §9.73。余白(gap/padding)を役割へ揃える作業は、値をそろえると同時に
   **画面に収まるかどうか**を動かす。実際、タブの高さを表示サイズへ追随
   させただけで測定画面の左ペインが特大で3px溢れた(VER1.85.0)。
   「揃っているか」の網(test_scale.js)とは別に、「収まっているか」の網が要る。

   見るのは2つだけ:
     ・スクロールできない器から中身がはみ出していないか
       (overflow:hidden なら切れて読めない / visible なら隣へかぶる)
     ・ページ全体に横スクロールが出ていないか

   スクロールできる器(overflow:auto/scroll)は、はみ出して当たり前なので数えない。
   表示サイズは xs〜xl の5段階すべてで見る——既定(md)だけ合わせても、
   現場で特大にした瞬間に崩れるのでは意味がない。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const SIZES=['xs','sm','md','lg','xl'];
/* 数px の溢れは字形の丸めでも出るので、これを超えたものだけ数える。 */
const SLACK=2;

/* 例外。**理由が書けるものだけ**載せる。 */
const EXCEPT=[
 ['qa-graph-stage','グラフの描画面。SVGが器より大きいときは中でスクロールさせる設計'],
 ['rp-page','A4帳票。用紙サイズ固定で、表示は倍率で合わせる'],
 ['df-page','同上（異常位置判定書）'],
];

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 try{
  const settle=async(ms=800)=>{
   await page.waitForTimeout(ms);
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  };
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await settle(1500);

  const probe=(slack)=>page.evaluate(sl=>{
   const out=[];
   /* 先祖にスクロールできる器があれば、はみ出した分は手が届く(切れて
      読めないわけではない)。「どこにもスクロールが無いのに溢れている」
      ものだけを不具合として数える。 */
   const scrollable=(el,axis)=>{
    for(let p=el.parentElement;p;p=p.parentElement){
     const cs=getComputedStyle(p);
     if(/auto|scroll/.test(axis==='x'?cs.overflowX:cs.overflowY))return true;
    }
    return false;
   };
   document.querySelectorAll('*').forEach(el=>{
    /* <option> は選択肢の実体で、描画はブラウザ任せ(幅の比較に意味がない)。 */
    if(el.tagName==='OPTION'||el.tagName==='OPTGROUP')return;
    const r=el.getBoundingClientRect();
    if(r.width<2||r.height<2)return;
    const s=getComputedStyle(el);
    if(s.visibility==='hidden')return;
    const scrollY=/auto|scroll/.test(s.overflowY)||scrollable(el,'y');
    const scrollX=/auto|scroll/.test(s.overflowX)||scrollable(el,'x');
    /* 「…」で切り詰める指定がある欄は、はみ出して切れるのが設計どおり
       (画面名・使用設備名など、長い文字列を1行に収める箇所)。 */
    const ellipsis=s.textOverflow==='ellipsis';
    const overY=el.scrollHeight-el.clientHeight, overX=el.scrollWidth-el.clientWidth;
    const bad=[];
    if(!scrollY&&overY>sl)bad.push('縦+'+overY);
    if(!scrollX&&!ellipsis&&overX>sl)bad.push('横+'+overX);
    if(!bad.length)return;
    const cls=(typeof el.className==='string'?el.className:'').split(/\s+/).filter(Boolean).slice(0,2).join('.');
    out.push({name:el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(cls?'.'+cls:''),
              why:bad.join(' '),over:Math.max(overY,overX)});
   });
   return {items:out,
           pageX:document.documentElement.scrollWidth-document.documentElement.clientWidth};
  },slack);

  const findings=[];let pageX=0;
  const visit=async(name,fn)=>{
   await fn(); await settle(1400);
   for(const size of SIZES){
    await page.evaluate(s=>{document.documentElement.dataset.uiSize=s},size);
    await settle(500);
    const r=await probe(SLACK);
    r.items.forEach(i=>findings.push({...i,screen:name,size}));
    pageX=Math.max(pageX,r.pageX);
   }
   await page.evaluate(()=>{document.documentElement.dataset.uiSize='md'});
   await settle(300);
  };

  await visit('仕掛一覧',()=>page.click('aside [data-db-key="SIKALOTNOW"]'));
  await visit('品質データ',()=>page.click('aside [data-db-key="SIKALOTDEF"]'));
  await visit('品質データ_グラフ',async()=>{
   await page.click('[data-qa-tab="graph"]');await settle(700);
   await page.evaluate(()=>document.querySelectorAll('.qa-acc:not(.open) .qa-acc-head').forEach(x=>x.click()));
  });
  await page.click('[data-qa-tab="raw"]');await settle(500);
  await visit('作業スケジュール',()=>page.click('#openSchedule'));
  await visit('ダッシュボード',()=>page.click('#openDashboard'));
  await visit('実績カレンダー',()=>page.click('#openCalendar'));
  await visit('マスタ管理',()=>page.click('#openMasterMaint'));
  /* 測定画面。左ペインが一番きつい(VER1.85.0で3px溢れを踏んだ場所)。 */
  await page.click('aside [data-db-key="SIKALOTNOW"]');await settle(2200);
  const opened=await page.evaluate(()=>{
   const b=document.querySelector('.measurement-action-button');if(b){b.click();return true}return false;
  });
  if(opened){
   await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:20000}).catch(()=>{});
   await settle(2500);
   await visit('測定画面',async()=>{});
  }
  rec('測定画面を開けた',opened);

  const excepted=f=>EXCEPT.some(([k])=>f.name.includes(k));
  const real=findings.filter(f=>!excepted(f));
  const byKey={};
  real.forEach(f=>{const k=`${f.screen}/${f.size}: ${f.name} ${f.why}`;byKey[k]=(byKey[k]||0)+1});
  const keys=Object.keys(byKey);
  rec('スクロールできない器から中身が溢れていない',keys.length===0,
   keys.length?keys.slice(0,8).join(' / '):`${SIZES.length}段階 × 8画面 で溢れ0`);
  rec('ページ全体に横スクロールが出ていない',pageX<=SLACK,`最大 +${pageX}px`);

  console.log('\n=== SUMMARY ===');
  const f=R.filter(r=>!r.ok);console.log(`${R.length-f.length}/${R.length} passed`);
  f.forEach(x=>console.log(' -',x.n,x.d||''));
  await b.close();process.exit(f.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  await b.close().catch(()=>{});
  process.exit(2);
 }
})().catch(async e=>{console.error('FATAL',e);if(b)await b.close().catch(()=>{});process.exit(2)});
