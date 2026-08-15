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

  /* --- 3) 位置の整合: 値→横位置の写像が線形で、上限/下限/基準の線と一致する。
     非対称公差なので範囲の中点(1001)と基準値(1000)はずれる。図示すべきなのは
     基準値のほう。 --- */
  const lineX={};g.lines.forEach(l=>{
   if(/tc-line-low/.test(l.cls))lineX.low=l.x;
   if(/tc-line-high/.test(l.cls))lineX.high=l.x;
   if(/tc-line-base/.test(l.cls))lineX.base=l.x;});
  const expect=v=>{const hi=BASE+PLUS,lo=BASE-MINUS;
   return lineX.low+(v-lo)/(hi-lo)*(lineX.high-lineX.low)};
  const mid=(BASE-MINUS+BASE+PLUS)/2;
  rec('下限が上限より左にある',lineX.low<lineX.high,
   `下限x=${lineX.low} 上限x=${lineX.high}`);
  /* 基準の線は**札を畳んでも必ず引く**（狙う値がどこかが図から消えるため）。 */
  rec('基準の線がある',Number.isFinite(lineX.base),JSON.stringify(lineX));
  rec('基準の線が基準値そのものを指す(範囲の中点ではない)',
   Number.isFinite(lineX.base)&&Math.abs(lineX.base-expect(BASE))<=2
   &&Math.abs(lineX.base-expect(mid))>2,
   `基準x=${lineX.base} 期待=${expect(BASE).toFixed(1)} (中点なら${expect(mid).toFixed(1)})`);

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

  /* --- 6) 写像そのものの境界(WL.toleranceScaleView を直接) --- */
  const u=await page.evaluate(()=>{
   const f=WL.toleranceScaleView,R=[999,1003];
   const cap=f({range:R,base:1000},['1200'],1);
   return {
    noRange:f({},[],0),
    // 基準値が渡らなければ範囲の中点へ落とす(0扱いにしない)
    noBase:f({range:R,base:null},[],0).base,
    fromMinus:f({range:R,minus:1},[],0).base,
    declared:f({range:R,base:1000},[],0).base,
    // 桁違いの値が1件あっても窓は公差幅の1.5倍までしか広げない
    capViewHigh:cap.viewHigh,capClamp:cap.clamp(1200),
   };
  });
  rec('公差が無ければ写像を作らない',u.noRange===null,String(u.noRange));
  rec('基準値が無ければ範囲の中点へ落とす(0にしない)',u.noBase===1001,String(u.noBase));
  rec('基準値が無くても公差－から復元する',u.fromMinus===1000,String(u.fromMinus));
  rec('渡された基準値をそのまま使う',u.declared===1000,String(u.declared));
  rec('桁違いの値でも表示範囲は公差幅の1.5倍までに留める',
   Math.abs(u.capViewHigh-(1003+ (1003-999)*1.5))<1e-6&&u.capClamp===6,
   `viewHigh=${u.capViewHigh} clamp=${u.capClamp}`);

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
