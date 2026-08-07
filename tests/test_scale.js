/* test_scale.js: 文字・UIの階層（役割 → 寸法）を実測で固定する。
   ------------------------------------------------------------
   §9.71。app.css のトークン(--fs-* / --ctl-h-* / --radius-*)は宣言だけ
   見ても守られているか分からない。**実際に画面へ出ている寸法**を数えて、
   「同じ役割は同じ寸法」が崩れていないことを確かめる。

   これを入れる前の実測（VER1.84.0時点）:
     ・ボタンの高さ … 22/24/26/28/30/31/32/34/35/36/38/40/42/44/46px の15種
     ・角丸         … 28種
     ・見出しの文字 … 8種、ラベル6種、補足5種、バッジ6種
   文字サイズ自体はトークン化済みだったのに「揃って見えない」原因はここ。

   既知の例外はテスト内に**理由付きで**列挙する。増やすときは理由も書くこと
   （理由の書けない例外を足し始めた時点で、この網は意味を失う）。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';

/* コントロールの高さトークン(--ctl-h-xs/sm/(std)/lg、--ui-scale=1のとき) */
const CTL_H=[26,30,36,40];
/* 角丸トークン(--radius-xs/sm/md/lg/pill/round)。0(角を落とす)も可。 */
const RADIUS=['0px','4px','8px','10px','14px','999px'];
/* 例外。**理由が書けるものだけ**載せる。 */
const CTL_EXCEPT={
 '#search':'ヘッダーのチップの中に枠なしで置く検索欄。高さはチップ側が持つ',
 '#pageSize':'同上（表示件数の選択）',
 'cal-day':'実績カレンダーのマス目。コントロールではなく面',
 'qa-acc-head':'アコーディオンの見出し行。主要動作と同じ--ctl-h-lg',
};

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 try{
  const settle=async(ms=900)=>{
   await page.waitForTimeout(ms);
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  };
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await settle(1500);

  /* 画面に出ているコントロールを集める。A4帳票(.rp-page/.df-page)は用紙の
     割り付けのためpx固定が正しいので数えない。 */
  const collect=()=>page.evaluate(()=>{
   const out=[];
   document.querySelectorAll('button,select,input,textarea').forEach(el=>{
    if(el.closest('.rp-page,.df-page,.rp-report,.df-print-area'))return;
    const r=el.getBoundingClientRect();
    if(r.width<1||r.height<1)return;
    const s=getComputedStyle(el);
    if(s.visibility==='hidden')return;
    /* チェックボックス・ラジオは文字の横に置く四角で、高さのスケール
       (26/30/36/40)には乗らない。一辺は --ctl-box で別に揃えてある。 */
    if(el.tagName==='INPUT'&&(el.type==='checkbox'||el.type==='radio')){
     out.push({name:'box:'+el.tagName.toLowerCase(),h:Math.round(r.height),
               radius:s.borderTopLeftRadius,over:0,box:Math.round(r.width)});
     return;
    }
    out.push({name:el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+
                   (el.className&&typeof el.className==='string'?'.'+el.className.split(/\s+/).filter(Boolean).slice(0,2).join('.'):''),
              h:Math.round(r.height),radius:s.borderTopLeftRadius,
              over:el.scrollWidth-el.clientWidth});
   });
   return out;
  });
  /* 役割ごとの文字サイズ。同じ役割は1種類であること。 */
  const roles=()=>page.evaluate(()=>{
   const pick=sel=>[...document.querySelectorAll(sel)]
     .filter(el=>el.getBoundingClientRect().height>0)
     .map(el=>Math.round(parseFloat(getComputedStyle(el).fontSize)*100)/100);
   return {
    cardTitle:pick('.qa-v7 .qa-acc-title,.disclosure-title,.wtb-title,.record-list-head'),
    summary:pick('.qa-v7 .qa-acc-sum,.qa-v7 .qa-hint,.disclosure-sum,.split-hint-text'),
    chip:pick('.qa-v7 .qa-chip,.list-join-chip,.field-reorder-badge'),
   };
  });

  const all=[]; const roleAgg={cardTitle:[],summary:[],chip:[]};
  const visit=async(name,fn)=>{
   await fn(); await settle(1800);
   (await collect()).forEach(c=>all.push({...c,screen:name}));
   const r=await roles();
   Object.keys(roleAgg).forEach(k=>roleAgg[k].push(...r[k]));
  };
  await visit('仕掛一覧',()=>page.click('aside [data-db-key="SIKALOTNOW"]'));
  await visit('品質データ',()=>page.click('aside [data-db-key="SIKALOTDEF"]'));
  await visit('品質データ_グラフ',async()=>{
   await page.click('[data-qa-tab="graph"]');await settle(900);
   await page.evaluate(()=>document.querySelectorAll('.qa-acc:not(.open) .qa-acc-head').forEach(x=>x.click()));
  });
  await page.click('[data-qa-tab="raw"]');await settle(600);
  await visit('作業スケジュール',()=>page.click('#openSchedule'));
  await visit('ダッシュボード',()=>page.click('#openDashboard'));
  await visit('実績カレンダー',()=>page.click('#openCalendar'));
  await visit('マスタ管理',()=>page.click('#openMasterMaint'));

  const excepted=c=>c.name.startsWith('box:')||
                    Object.keys(CTL_EXCEPT).some(k=>c.name.includes(k.replace('#','')));
  const badH=all.filter(c=>!CTL_H.includes(c.h)&&!excepted(c));
  const hKinds=[...new Set(all.filter(c=>!excepted(c)).map(c=>c.h))].sort((a,b)=>a-b);
  rec('コントロールの高さがトークン(26/30/36/40)に収まる',badH.length===0,
   badH.length?[...new Set(badH.map(c=>`${c.screen}:${c.name}=${c.h}px`))].slice(0,6).join(' / '):`種類 ${hKinds.join(',')}`);

  const badR=all.filter(c=>!RADIUS.includes(c.radius)&&!excepted(c));
  rec('角丸がトークン(0/4/8/10/14/999)に収まる',badR.length===0,
   badR.length?[...new Set(badR.map(c=>`${c.name}=${c.radius}`))].slice(0,6).join(' / ')
             :[...new Set(all.map(c=>c.radius))].sort().join(','));

  /* ボタンの文字が枠からあふれていない(寸法を揃えた副作用の見張り)。 */
  const overflow=all.filter(c=>c.over>1&&!/input|select|textarea/.test(c.name));
  rec('寸法を揃えた結果、ボタンの文字があふれていない',overflow.length===0,
   overflow.length?[...new Set(overflow.map(c=>`${c.screen}:${c.name}+${c.over}px`))].slice(0,6).join(' / '):'あふれ0');

  const uniq=a=>[...new Set(a)];
  const boxes=[...new Set(all.filter(c=>c.name.startsWith('box:')).map(c=>c.box))];
  rec('チェックボックス・ラジオの一辺が1種類',boxes.length<=1,`${boxes.join(',')}px`);

  rec('カード見出しの文字サイズは1種類',uniq(roleAgg.cardTitle).length<=1,
   `${uniq(roleAgg.cardTitle).join(',')} (${roleAgg.cardTitle.length}件)`);
  rec('要約・補足の文字サイズは1種類',uniq(roleAgg.summary).length<=1,
   `${uniq(roleAgg.summary).join(',')} (${roleAgg.summary.length}件)`);
  rec('チップの文字サイズは1種類',uniq(roleAgg.chip).length<=1,
   `${uniq(roleAgg.chip).join(',')} (${roleAgg.chip.length}件)`);

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
