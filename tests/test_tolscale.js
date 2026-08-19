/* test_tolscale.js: 測定画面の公差数直線(基準値に対する図示)。
   ------------------------------------------------------------
   フィクスチャの仕掛データには公差カラムが無く、そのままでは
   「公差情報なし」カードしか出ない(数直線が描かれない)。実機相当の
   非対称公差(基準1000 / +3 / -1)を注入してから測る。
   非対称にするのが要点: 範囲の中点(1001)と基準値(1000)がずれるので、
   図示が基準値を正しく指しているかどうかが判定できる。 */
const fs=require('fs');
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const API='http://127.0.0.1:5029';
const DUMP=process.env.WAVELOG_TOLDUMP||'';
const setMode=async m=>{await fetch(`${API}/api/access-mode`,
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
const BASE=1000,PLUS=3,MINUS=1;          // 判定範囲 999〜1003 / 中点1001
const VALUES=['999.5','1002.8','1000.2','1004.0','998.5',''];
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 try{
  await setMode('edit');
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.waitForTimeout(1500);
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:20000});
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r)r.querySelector('.sc-row-start').click();
   return !!r;
  });
  rec('予定から測定画面を開ける',started);
  if(!started)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:20000});
  await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,
   null,{timeout:30000}).catch(()=>{});
  /* 公差数直線は測定パネルの中にある。測定画面は「準備」から始まる（§9.123）
     ので、②測定へ移らないと**高さ0のまま測ることになる**（隠れている要素を
     測って「上限が下限より上にない」と読み違える）。 */
  await page.evaluate(()=>WL.measureSteps.go('2'));
  await page.waitForTimeout(400);

  const inj=await page.evaluate(([base,plus,minus,vals])=>{
   const s=S.measure.source=S.measure.source||{};
   s['製造板幅']=base;s['板幅公差_製造_ﾌﾟﾗｽ']=plus;s['板幅公差_製造_ﾏｲﾅｽ']=minus;
   S.measure.basic.mfgWidth=base;
   document.querySelector('#measureType').value='板幅';
   document.querySelector('#horizontalCount').value=String(vals.length);
   const w=S.measure.measurements.width[lengthIndex()];
   vals.forEach((v,i)=>w[i]=v);
   /* 測定パネルは入力内容(measureType)に応じてapplyRightLayoutが出し分ける。
      値を差し替えるだけでは隠れたままで、寸法が全て0になり測れない。 */
   applyRightLayout();renderMeasureGrid();
   const d=toleranceDetail('width');
   return {range:d&&d.range,base:Number(S.measure.basic.mfgWidth)};
  },[BASE,PLUS,MINUS,VALUES]);
  rec('非対称公差を注入できる(範囲999〜1003・基準1000)',
   !!inj.range&&Math.abs(inj.range[0]-(BASE-MINUS))<1e-6&&Math.abs(inj.range[1]-(BASE+PLUS))<1e-6,
   JSON.stringify(inj));
  await page.waitForTimeout(700);

  const g=await page.evaluate(()=>{
   const box=document.querySelector('.accurate-numberline');
   if(!box)return {none:true};
   // 祖先の表示状態。パネルが隠れていると全要素の寸法が0になり、原因が
   // 分からないまま位置の検証だけが落ちるので、失敗時の手がかりに残す。
   const chain=[];for(let e=box;e&&e!==document.documentElement;e=e.parentElement){
    const c=getComputedStyle(e),r=e.getBoundingClientRect();
    chain.push(`${e.tagName}.${(e.className||'').toString().split(' ')[0]}#${e.id||''} d=${c.display} h=${Math.round(r.height)} hid=${e.hidden}`);}
   const br=box.getBoundingClientRect(),side=box.parentElement,sr=side.getBoundingClientRect();
   /* 図は**縦＝条・横＝測定値**（§9.150）。位置は要素の中心のXで測る
      （点はtranslateで中心合わせしているので左端で測ると半径ぶんずれる）。 */
   const pick=sel=>[...box.querySelectorAll(sel)].map(e=>{const r=e.getBoundingClientRect();
     return {cls:(e.className||'').toString(),
             x:+(r.left-br.left+r.width/2).toFixed(1),
             y:+(r.top-br.top+r.height/2).toFixed(1),w:+r.width.toFixed(1),
             text:(e.textContent||'').trim(),title:e.title||'',
             inside:r.left>=br.left-1&&r.right<=br.right+1};});
   /* **行が測定表とそろっているか**——この図の値打ちそのもの。 */
   const rows=[...box.querySelectorAll('.tc-row')];
   const trs=[...document.querySelectorAll('#measurementGrid .measure-matrix tbody tr')];
   let rowGap=null;
   if(rows.length===trs.length&&rows.length){
    rowGap=0;
    rows.forEach((r,i)=>{const u=r.getBoundingClientRect(),v=trs[i].getBoundingClientRect();
      rowGap=Math.max(rowGap,Math.abs((u.top+u.height/2)-(v.top+v.height/2)))});
    rowGap=+rowGap.toFixed(1);
   }
   return {
    chain,boxH:+br.height.toFixed(1),boxW:+br.width.toFixed(1),
    sideH:+sr.height.toFixed(1),overflowPx:+(br.bottom-sr.bottom).toFixed(1),
    行:rows.length,表の行:trs.length,行のずれ:rowGap,
    ticks:pick('.tc-tick'),lines:pick('.tc-line'),dots:pick('.tc-dot'),
    現在行:box.querySelectorAll('.tc-row.is-current').length,
    summary:(document.querySelector('#toleranceSummary')?.innerText||'').replace(/\s+/g,' ').slice(0,200),
   };
  });
  if(DUMP){fs.writeFileSync(DUMP,JSON.stringify(g,null,1));
   const el=await page.$('.compact-tolerance-side');
   if(el)await el.screenshot({path:DUMP.replace(/\.json$/,'.png')}).catch(()=>{});}
  rec('公差の図が描かれる',!g.none,g.none?'.accurate-numberline が無い':`高さ${g.boxH}px`);
  if(g.none)throw Error('公差の図が描かれない');

  /* --- 1) はみ出し: 図が入れ物より高いと下端の条が切れて見えない --- */
  rec('図が入れ物からはみ出していない',g.overflowPx<=1,
   `はみ出し${g.overflowPx}px (図${g.boxH} / 枠${g.sideH})`);
  rec('目盛りの札が全て枠内に収まる',g.ticks.every(t=>t.inside),
   g.ticks.map(t=>`${t.text}:${t.inside?'可視':'見切れ'}`).join(' / '));

  /* --- 2) この図の値打ち: **1条1行で、測定表の行と1対1にそろう**（§9.150）。
     ずれると「外れている条を目を横に振るだけで読む」ができなくなり、
     スウォーム時代の「どの点が何条か分からない」へ逆戻りする。 --- */
  rec('図の行数が測定表の行数と同じ',g.行>0&&g.行===g.表の行,`図${g.行} / 表${g.表の行}`);
  rec('図の行が測定表の行と同じ高さに並ぶ',
   g.行のずれ!==null&&g.行のずれ<=2,`最大ずれ ${g.行のずれ}px`);

  /* --- 3) 位置の整合: 既定は**実寸(mm)の軸**（§9.152）。基準は必ず中心で、
     横1pxが表すmmはどの条でも同じ。非対称公差(+3/-1)なので、上限までの
     距離と下限までの距離は**3:1になる**（等距離になったら、それは公差比の
     軸＝mmの情報が消えている）。 --- */
  const lineX={};g.lines.forEach(l=>{
   if(/tc-line-low/.test(l.cls))lineX.low=l.x;
   if(/tc-line-high/.test(l.cls))lineX.high=l.x;
   if(/tc-line-base/.test(l.cls))lineX.base=l.x;});
  /* 1mmあたりのpx。上限が基準の何px右かはプラス公差ぶん。 */
  const perMm=()=>(lineX.high-lineX.base)/PLUS;
  const expect=v=>lineX.base+(v-BASE)*perMm();
  const mid=(BASE-MINUS+BASE+PLUS)/2;
  rec('下限が上限より左にある',lineX.low<lineX.high,
   `下限x=${lineX.low} 上限x=${lineX.high}`);
  /* 基準の線は**札を畳んでも必ず引く**（狙う値がどこかが図から消えるため）。 */
  rec('基準の線がある',Number.isFinite(lineX.base),JSON.stringify(lineX));
  /* **基準は図のちょうど真ん中**（§9.152。データで動かない）。 */
  rec('基準が図の中央にある',Math.abs(lineX.base-g.boxW/2)<=2,
   `基準x=${lineX.base} 図の中央=${(g.boxW/2).toFixed(1)}`);
  /* 実寸の軸なので、公差＋3・公差−1は基準から**3:1の距離**に出る。 */
  rec('上限と下限の距離が公差の比(3:1)になる',
   Math.abs((lineX.high-lineX.base)/(lineX.base-lineX.low)-PLUS/MINUS)<=.15,
   `基準-上限=${(lineX.high-lineX.base).toFixed(1)} 下限-基準=${(lineX.base-lineX.low).toFixed(1)}`);
  /* **基準は範囲の中点ではない。** 非対称公差(+3/-1)では中点1001が基準の
     右へずれることで、写像が基準に錨を下ろしていることが分かる。 */
  rec('範囲の中点は基準の線に乗らない',
   Math.abs(expect(mid)-lineX.base)>2,
   `中点の位置=${expect(mid).toFixed(1)} 基準x=${lineX.base}`);
  /* 軸の端の札は**実寸を書く**（出どころ・単位を画面に出す。§9.129の6番）。 */
  rec('軸の端に実寸(mm)の札が出る',
   g.ticks.filter(t=>/^[+−]\d/.test(t.text)).length===2&&g.ticks.some(t=>t.text==='基準'),
   g.ticks.map(t=>t.text).join(' / '));

  const dotErr=g.dots.map(d=>{
   const v=Number((d.title.match(/:\s*([\d.]+)/)||[])[1]);
   return Number.isFinite(v)?{v,x:d.x,y:d.y,err:+(d.x-expect(v)).toFixed(1)}:null;
  }).filter(Boolean);
  rec('測定点が値どおりの位置にある',
   dotErr.length>0&&dotErr.every(d=>Math.abs(d.err)<=2),
   dotErr.map(d=>`${d.v}:ズレ${d.err}px`).join(' / '));

  /* --- 4) 公差外の値も見える位置に置かれる(端で潰さない)。 --- */
  const ngDot=dotErr.find(d=>d.v>BASE+PLUS);
  rec('公差外(上振れ)の点が上限より右に描かれる',
   !!ngDot&&ngDot.x>lineX.high,ngDot?JSON.stringify(ngDot):'(該当点なし)');
  rec('公差外の点が右端に張り付いていない(はみ出し量が読める)',
   !!ngDot&&ngDot.x<g.boxW-4,ngDot?`x=${ngDot.x} (図の幅${g.boxW})`:'(該当点なし)');

  /* --- 5) 確定前の先読みリングが確定後の点と同じ写像で置かれる --- */
  const pend=await page.evaluate(()=>{
   updateNumberlinePending('DT11+1002.8M');   // ノギス受信中(未確定)
   const m=document.querySelector('#numberlinePending'),box=document.querySelector('.accurate-numberline');
   if(!m||!box)return null;
   const r=m.getBoundingClientRect(),br=box.getBoundingClientRect();
   return {hidden:m.hidden,x:+(r.left-br.left+r.width/2).toFixed(1)};
  });
  rec('確定前の先読みリングが出る',!!pend&&!pend.hidden,JSON.stringify(pend));
  rec('先読みリングが確定後の点と同じ横位置に出る',
   !!pend&&!pend.hidden&&Math.abs(pend.x-expect(1002.8))<=2,
   pend?`x=${pend.x} 期待=${expect(1002.8).toFixed(1)}`:'(リング無し)');

  /* --- 6) 写像そのもの(WL.toleranceAxisView を直接) --- */
  const u=await page.evaluate(()=>{
   const one=m=>{
    const v=WL.toleranceAxisView('width',['1000','1003','999'],3,{mode:m,span:2});
    if(!v)return null;
    return{
     端:v.edge,一様:v.uniform,軸外:v.out,
     位置:{基準:+v.x(1000,0).toFixed(3),上限:+v.x(1003,0).toFixed(3),
           下限:+v.x(999,0).toFixed(3),中点:+v.x(1001,0).toFixed(3)},
     帯:[+v.band(0).low.toFixed(3),+v.band(0).high.toFixed(3)],
     線:Object.keys(v.lines).sort().join(','),
     札:v.ticks.map(t=>t.label),
     頭打ち:[v.x(-9999,0),v.x(9999,0)],
    };
   };
   return{abs:one('abs'),rel:one('rel')};
  });
  rec('実寸の軸: 基準は必ず中央(50%)',
   !!u.abs&&u.abs.位置.基準===50,JSON.stringify(u.abs&&u.abs.位置));
  rec('実寸の軸: 端は「一番広い片側公差×表示幅」',
   !!u.abs&&u.abs.端===PLUS*2,String(u.abs&&u.abs.端));
  rec('実寸の軸: 上限・下限は公差の実寸どおり(+3は+25% / -1は-8.33%)',
   !!u.abs&&Math.abs(u.abs.位置.上限-75)<.01&&Math.abs(u.abs.位置.下限-(50-100/12))<.01,
   JSON.stringify(u.abs&&u.abs.位置));
  rec('実寸の軸: 端の札は実寸の数字(±6.00)',
   !!u.abs&&u.abs.札.length===3&&/6\.00$/.test(u.abs.札[0])&&u.abs.札[1]==='基準',
   JSON.stringify(u.abs&&u.abs.札));
  rec('公差比の軸: 下限・上限が全条でそろう(±1が固定位置)',
   !!u.rel&&Math.abs(u.rel.位置.下限-25)<.01&&Math.abs(u.rel.位置.上限-75)<.01,
   JSON.stringify(u.rel&&u.rel.位置));
  rec('公差比の軸: 札は下限・基準・上限',
   !!u.rel&&u.rel.札.join(',')==='下限,基準,上限',JSON.stringify(u.rel&&u.rel.札));
  rec('どちらの軸でも範囲の中点は基準に乗らない(基準に錨を下ろしている)',
   !!u.abs&&!!u.rel&&u.abs.位置.中点!==50&&u.rel.位置.中点!==50,
   `実寸${u.abs&&u.abs.位置.中点} / 公差比${u.rel&&u.rel.位置.中点}`);
  rec('帯の縁が下限・上限の位置と一致する',
   !!u.abs&&Math.abs(u.abs.帯[0]-u.abs.位置.下限)<.01&&Math.abs(u.abs.帯[1]-u.abs.位置.上限)<.01,
   JSON.stringify(u.abs&&u.abs.帯));
  rec('桁違いの値は端で頭打ちにする(軸は動かさない)',
   !!u.abs&&u.abs.頭打ち[0]===0&&u.abs.頭打ち[1]===100,JSON.stringify(u.abs&&u.abs.頭打ち));

  /* --- 6b) **異幅分割: 公差の違いが「段差」として見える**（§9.152）---
     利用者の指示。基準を重ねて実寸で見るので、幅300±1の条と幅500+3/-1の条は
     **帯の右の縁だけがずれる**。絶対値（幅そのもの）の軸だったころは、
     選んでいない側の点が端に張り付いて赤くなった（§9.150）。 */
  const mixedSetup=async()=>page.evaluate(async()=>{
   S.measure.settings.splitGroups=[
    {lot:'AAA300',count:2,base:{width:300},tol:{width:{manufacturing:{plus:1,minus:1}}},missing:false},
    {lot:'BBB500',count:2,base:{width:500},tol:{width:{manufacturing:{plus:3,minus:1}}},missing:false}];
   S.measure.settings.splitPositionGroup=[0,0,1,1];
   document.querySelector('#horizontalCount').value='4';
   const w=S.measure.measurements.width[lengthIndex()];
   /* どちらも「自分のプラス公差の半分」上振れ（＝公差比では同じ位置、
      実寸では300側が+0.5mm・500側が+1.5mmなので別の位置） */
   ['300.50','300.00','501.50','500.00'].forEach((v,i)=>w[i]=v);
   S.measure.settings.wStep=0;
   renderMeasureGrid();
   await new Promise(r=>setTimeout(r,300));
  });
  const mixedRead=async()=>page.evaluate(()=>{
   const box=document.querySelector('.accurate-numberline'),br=box.getBoundingClientRect();
   const at=e=>{const r=e.getBoundingClientRect();return +(r.left-br.left+r.width/2).toFixed(1)};
   const dots=[...box.querySelectorAll('.tc-row')].map(r=>{
    const d=r.querySelector('.tc-dot');return d?{x:at(d),ng:d.className.includes('ng'),t:d.title}:null});
   const 帯=[...box.querySelectorAll('.tc-row')].map(r=>
     getComputedStyle(r).getPropertyValue('--r-low').trim()+'..'+getComputedStyle(r).getPropertyValue('--r-high').trim());
   return{軸:box.dataset.mode,dots,帯,
     色:[...box.querySelectorAll('.tc-lot')].map(e=>getComputedStyle(e).backgroundColor),
     セルNG:[...document.querySelectorAll('.measure-matrix td.is-current input')].map(e=>e.classList.contains('ng'))};
  });
  await mixedSetup();
  const mixed=await mixedRead();
  rec('異幅分割でも全条が公差内と判定される',
   mixed.dots.every(d=>d&&!d.ng)&&mixed.セルNG.every(v=>!v),
   JSON.stringify(mixed.dots.map(d=>d&&d.t)));
  rec('実寸の軸: 基準どおりの条はどのロットでも中央に乗る',
   mixed.dots[1]&&mixed.dots[3]&&Math.abs(mixed.dots[1].x-mixed.dots[3].x)<=2,
   `${mixed.dots[1]&&mixed.dots[1].x} / ${mixed.dots[3]&&mixed.dots[3].x}`);
  /* **これが今回の目的**——公差の広い子ロットの帯は右へ伸びる（段差）。 */
  rec('実寸の軸: 公差の違う子ロットで帯の縁がずれる(段差になる)',
   new Set(mixed.帯).size===2&&mixed.帯[0]===mixed.帯[1]&&mixed.帯[2]===mixed.帯[3],
   mixed.帯.join(' / '));
  rec('実寸の軸: 帯の左の縁はそろう(下限は両方-1mm)',
   mixed.帯[0].split('..')[0]===mixed.帯[2].split('..')[0],mixed.帯.join(' / '));
  rec('実寸の軸: 上振れの実寸が違えば点の位置も違う(+0.5mm と +1.5mm)',
   mixed.dots[0]&&mixed.dots[2]&&mixed.dots[2].x-mixed.dots[0].x>4,
   `幅300の+0.5=${mixed.dots[0]&&mixed.dots[0].x} / 幅500の+1.5=${mixed.dots[2]&&mixed.dots[2].x}`);
  rec('子ロットの色帯が条ごとに付く(2ロットで2色)',
   mixed.色.length===4&&new Set(mixed.色).size===2,mixed.色.join(' / '));

  /* --- 6c) **軸を切り替えられる**（§9.152、利用者の指示）---
     入口は**アイコン1つ**で、中身は器の外の浮き窓（§9.210 ①）。
     以前は同じ帯の中で開いており、開いた瞬間に見出しが1行増えて測定表が
     縮んでいた。**閉じていること・窓が器の外に在ることも固定する**。 */
  const nlFolded=await page.evaluate(()=>{
   const btn=document.getElementById('numberlineFold'),win=document.getElementById('numberlinePanel');
   return{窓なし:!win||win.hidden,入口:!!btn&&btn.getBoundingClientRect().width>0,
          印:btn&&btn.getAttribute('aria-expanded'),
          文字なし:!!btn&&!btn.textContent.trim(),
          名乗る:!!btn&&!!btn.getAttribute('aria-label')};
  });
  rec('図の見せ方はアイコン1つで、既定では開いていない（§9.210 ①）',
   nlFolded.窓なし===true&&nlFolded.入口===true&&nlFolded.印==='false'
   &&nlFolded.文字なし===true&&nlFolded.名乗る===true,
   JSON.stringify(nlFolded));
  await page.click('#numberlineFold');
  await page.waitForSelector('#numberlinePanel:not([hidden])',{timeout:8000});
  const nlOpen=await page.evaluate(()=>{
   const win=document.getElementById('numberlinePanel');
   return{出た:!win.hidden,
    印:document.getElementById('numberlineFold').getAttribute('aria-expanded'),
    /* **器の外に在ること**（§9.201）。見出しの中へ戻すと`overflow`で切られる。 */
    body直下:win.parentElement===document.body,
    位置:getComputedStyle(win).position,
    横軸の候補:win.querySelectorAll('[data-nl-mode]').length,
    表示幅の候補:win.querySelectorAll('[data-nl-span]').length,
    /* 選ぶ前に見える（§9.200）——2枚のカードは**別の絵**でなければ意味が無い。 */
    絵:[...win.querySelectorAll('[data-nl-mode] .nl-art')]
      .map(x=>[...x.querySelectorAll('.nl-art-band')].map(r=>r.getAttribute('width')).join(',')),
    説明:[...win.querySelectorAll('[data-nl-mode] small')].filter(x=>x.textContent.trim()).length,
    状態:(win.querySelector('#nlState')||{}).textContent||''};
  });
  rec('押すと図の見せ方が別窓で開く',nlOpen.出た===true&&nlOpen.印==='true'
   &&nlOpen.body直下===true&&nlOpen.位置==='fixed',JSON.stringify(nlOpen));
  rec('横軸2つ・表示幅6つを全部出す（選ぶ前に見える）',
   nlOpen.横軸の候補===2&&nlOpen.表示幅の候補===6&&nlOpen.説明===2,
   JSON.stringify({横:nlOpen.横軸の候補,幅:nlOpen.表示幅の候補,説明:nlOpen.説明}));
  rec('2枚のカードの図が別の絵になっている',
   nlOpen.絵.length===2&&nlOpen.絵[0]!==nlOpen.絵[1],nlOpen.絵.join(' / '));
  rec('いま軸の外に何件あるかを文字で言う',/軸の外/.test(nlOpen.状態),nlOpen.状態);
  await page.click('#numberlinePanel [data-nl-mode="rel"]');
  await page.waitForTimeout(350);
  const relMixed=await mixedRead();
  rec('切り替えると図が描き直される(公差比の軸になる)',
   relMixed.軸==='rel',String(relMixed.軸));
  rec('公差比の軸: 公差が違っても帯の縁は全条そろう',
   new Set(relMixed.帯).size===1,relMixed.帯.join(' / '));
  rec('公差比の軸: 自分の公差で同じだけ上振れした条は同じ位置に出る',
   relMixed.dots[0]&&relMixed.dots[2]&&Math.abs(relMixed.dots[0].x-relMixed.dots[2].x)<=2,
   `${relMixed.dots[0]&&relMixed.dots[0].x} / ${relMixed.dots[2]&&relMixed.dots[2].x}`);
  rec('選んだ候補に印が付く',
   await page.evaluate(()=>document.querySelector('[data-nl-mode="rel"]').classList.contains('is-on')),'');
  await page.click('#numberlinePanel [data-nl-mode="abs"]');
  await page.waitForTimeout(350);

  /* 軸の外は**件数を文字で言い、表示幅を広げれば入る**（黙って端で潰さない）。 */
  const far=async()=>page.evaluate(()=>{
   const box=document.querySelector('.accurate-numberline');
   const n=document.getElementById('numberlineOutside');
   return{端:Number(box.dataset.edge),軸外:Number(box.dataset.out),
          文:n&&!n.hidden?n.textContent:'',
          印:[...box.querySelectorAll('.tc-dot.out')].length};
  });
  await page.evaluate(async()=>{
   S.measure.measurements.width[lengthIndex()][0]='315.00';   /* +15mm。軸(±2mm)の外 */
   renderMeasureGrid();await new Promise(r=>setTimeout(r,300));
  });
  const out1=await far();
  rec('軸をはみ出した点は件数を文字で出す',
   out1.軸外===1&&/軸の外\s*1件/.test(out1.文)&&out1.印===1,JSON.stringify(out1));
  await page.click('#numberlinePanel [data-nl-span="10"]');
  await page.waitForTimeout(350);
  const out2=await far();
  rec('表示幅を広げると軸の端が広がり、はみ出しが収まる',
   out2.端>out1.端&&out2.軸外===0&&out2.文==='',JSON.stringify({前:out1.端,後:out2.端,軸外:out2.軸外}));
  await page.click('#numberlinePanel [data-nl-span="2"]');
  await page.waitForTimeout(300);
  /* 開けたら閉じられること。閉じてから先へ進む（窓が測定表に重なる）。 */
  await page.click('#nlPanelClose');
  rec('閉じられる',await page.evaluate(()=>document.getElementById('numberlinePanel').hidden===true
    &&document.getElementById('numberlineFold').getAttribute('aria-expanded')==='false'),'');

  await page.evaluate(async()=>{
   S.measure.settings.splitGroups=null;S.measure.settings.splitPositionGroup=null;
   document.querySelector('#horizontalCount').value='6';
   renderMeasureGrid();
   await new Promise(r=>setTimeout(r,200));
  });

  /* --- 7) 基準値のすぐ近くを測ったときの見え方（§9.150）---
     スウォームのころは、公差4mmに対し0.1mm刻みだと点の高さの差が数pxしか
     なく、重なり回避の左右ずらしが要った。**縦を条に取れば重なりようがない**
     ——同じ値でも別の行に居る。ここではその約束（近い値でも全部見える・
     行の順は条の順）を固定する。 */
  const near=await page.evaluate(async()=>{
   document.querySelector('[data-mode="manual"]')?.click();
   const w=S.measure.measurements.width[lengthIndex()];
   [1000,1000.02,1000.04,999.2,1002.9].forEach((v,i)=>w[i]=v.toFixed(3));
   renderMeasureGrid();
   await new Promise(r=>setTimeout(r,300));
   const box=document.querySelector('.accurate-numberline'),br=box.getBoundingClientRect();
   const rows=[...box.querySelectorAll('.tc-row')];
   const dots=rows.map((row,i)=>{
    const e=row.querySelector('.tc-dot');if(!e)return null;
    const r=e.getBoundingClientRect();
    return {idx:i,title:e.title,
            x:+(r.left-br.left+r.width/2).toFixed(1),
            y:+(r.top-br.top+r.height/2).toFixed(1),d:r.width};
   }).filter(Boolean);
   return {dots,行:rows.length};
  });
  rec('測定した条ぶんの点が全て描かれる',near.dots.length===5,
   near.dots.map(d=>`条${d.idx+1}:${d.title}`).join(' / '));
  /* 同じ値に近い3条（1000 / 1000.02 / 1000.04）でも、行が違うので重ならない。 */
  const nearTrio=near.dots.filter(d=>d.idx<3);
  rec('値がほぼ同じ条でも点が重ならない(行が違うため)',
   nearTrio.length===3&&nearTrio.every((d,i)=>nearTrio.slice(i+1).every(o=>
     Math.hypot(d.x-o.x,d.y-o.y)>=(d.d+o.d)/2)),
   nearTrio.map(d=>`条${d.idx+1}(x${d.x},y${d.y},径${d.d})`).join(' / '));
  rec('点は条の順に上から並ぶ',
   near.dots.every((d,i)=>i===0||d.y>near.dots[i-1].y),
   near.dots.map(d=>`条${d.idx+1}:y${d.y}`).join(' / '));
  rec('点は条番号と測定値を持つ(印だけにしない)',
   near.dots.every(d=>/:/.test(d.title||'')),
   near.dots.map(d=>d.title).join(' / '));

  /* --- 8) クリックした条の行を強調する --- */
  const clicked=await page.evaluate(async()=>{
   const cell=document.querySelector('input[data-mkey="width"][data-j="0"]');
   cell?.click();cell?.focus();
   await new Promise(r=>setTimeout(r,300));
   const box=document.querySelector('.accurate-numberline');
   const cur=[...box.querySelectorAll('.tc-row.is-current')];
   const rows=[...box.querySelectorAll('.tc-row')];
   const size=e=>Math.round((e?.querySelector('.tc-dot')||e)?.getBoundingClientRect().width||0);
   return {count:cur.length,idx:cur.map(e=>rows.indexOf(e)),
           強調:size(cur[0]),通常:size(rows.find(r=>!r.classList.contains('is-current')))};
  });
  rec('クリックした条の行だけが強調される',
   clicked.count===1&&clicked.idx[0]===0,JSON.stringify(clicked));
  rec('強調された条の点は他の条より大きい',
   clicked.強調>clicked.通常,`強調${clicked.強調}px / 通常${clicked.通常}px`);

  await page.evaluate(async()=>{
   if(typeof S!=='undefined'&&S.measure&&typeof reliableDelete==='function')
    await reliableDelete(S.measure.id);
  }).catch(()=>{});

  console.log('\n=== SUMMARY ===');
  const f=R.filter(r=>!r.ok);console.log(`${R.length-f.length}/${R.length} passed`);
  f.forEach(x=>console.log(' -',x.n,x.d||''));
  await b.close();process.exit(f.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  await b.close().catch(()=>{});
  process.exit(2);
 }
})().catch(async e=>{
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
