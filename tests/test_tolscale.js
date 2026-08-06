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

  const inj=await page.evaluate(([base,plus,minus,vals])=>{
   const s=S.measure.source=S.measure.source||{};
   s['製造板幅']=base;s['板幅公差_製造_ﾌﾟﾗｽ']=plus;s['板幅公差_製造_ﾏｲﾅｽ']=minus;
   S.measure.basic.mfgWidth=base;
   document.querySelector('#measureType').value='板厚/板幅';
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
   const cs=getComputedStyle(box);
   /* 位置は要素の中心で測る。点(.numberline-swarm-dot)は8px角をtranslateで
      中心合わせしているので、上端で測ると常に4pxずれた値になる。 */
   const pick=sel=>[...box.querySelectorAll(sel)].map(e=>{const r=e.getBoundingClientRect();
     return {cls:e.className,styleTop:e.style.top||'',
             y:+(r.top-br.top+r.height/2).toFixed(1),h:+r.height.toFixed(1),
             text:(e.textContent||'').trim(),title:e.title||'',
             inside:r.top>=sr.top-1&&r.bottom<=sr.bottom+1};});
   return {
    chain,boxH:+br.height.toFixed(1),boxW:+br.width.toFixed(1),
    minH:cs.minHeight,cssVars:{upper:cs.getPropertyValue('--upper'),lower:cs.getPropertyValue('--lower'),
                               base:cs.getPropertyValue('--base')},
    sideH:+sr.height.toFixed(1),sideScrollH:side.scrollHeight,sideOverflow:getComputedStyle(side).overflow,
    overflowPx:+(br.bottom-sr.bottom).toFixed(1),
    ticks:pick('.numberline-tick'),bands:pick('.numberline-band'),
    dots:pick('.numberline-swarm-dot'),measure:pick('.numberline-measure'),
    summary:(document.querySelector('#toleranceSummary')?.innerText||'').replace(/\s+/g,' ').slice(0,200),
   };
  });
  if(DUMP){fs.writeFileSync(DUMP,JSON.stringify(g,null,1));
   const el=await page.$('.compact-width-body');
   if(el)await el.screenshot({path:DUMP.replace(/\.json$/,'.png')}).catch(()=>{});}
  rec('数直線が描かれる',!g.none,g.none?'.accurate-numberline が無い':`高さ${g.boxH}px`);
  if(g.none)throw Error('数直線が描かれない');

  /* --- 1) はみ出し: 数直線が入れ物より高いと下端(下限側)が切れて見えない --- */
  rec('数直線が入れ物からはみ出していない',g.overflowPx<=1,
   `はみ出し${g.overflowPx}px (数直線${g.boxH} / 枠${g.sideH}, min-height=${g.minH})`);
  rec('目盛りが全て枠内に収まる',g.ticks.every(t=>t.inside),
   g.ticks.map(t=>`${t.text}:${t.inside?'可視':'見切れ'}`).join(' / '));

  /* --- 2) 基準値: 非対称公差では範囲の中点(1001)と基準値(1000)がずれる。
     図示すべきなのは基準値のほう。 --- */
  const tickText=g.ticks.map(t=>t.text).join(' ');
  rec('基準値の目盛りがある',/基準/.test(tickText),tickText);
  const baseTick=g.ticks.find(t=>/基準/.test(t.text));
  const mid=(BASE-MINUS+BASE+PLUS)/2;
  rec('基準値の目盛りが基準値そのもの(範囲の中点ではない)',
   !!baseTick&&baseTick.text.includes(String(BASE))&&!baseTick.text.includes(String(mid)),
   baseTick?baseTick.text:'(無し)');

  /* --- 3) 位置の整合: 値→縦位置の写像が線形で、上限/下限/基準が一致する --- */
  const pos={};g.ticks.forEach(t=>{if(/上限/.test(t.text))pos.upper=t.y;
   if(/下限/.test(t.text))pos.lower=t.y;if(/基準/.test(t.text))pos.base=t.y;});
  const expect=(v)=>{ // 上限と下限の実測位置から線形補間した期待位置
   const hi=BASE+PLUS,lo=BASE-MINUS;
   return pos.upper+(hi-v)/(hi-lo)*(pos.lower-pos.upper);
  };
  rec('上限が下限より上にある',pos.upper<pos.lower,`上限y=${pos.upper} 下限y=${pos.lower}`);
  rec('基準値の目盛りが値どおりの位置にある',
   Math.abs(pos.base-expect(BASE))<=2,
   `基準y=${pos.base} 期待=${expect(BASE).toFixed(1)}(範囲中点なら${expect(mid).toFixed(1)})`);

  const measured=g.measure[0];
  const lastVal=Number([...VALUES].reverse().find(v=>v!==''));
  rec('直前値のマーカーが値どおりの位置にある',
   !!measured&&Math.abs(measured.y-expect(lastVal))<=2,
   measured?`y=${measured.y} 期待=${expect(lastVal).toFixed(1)} (${measured.text})`:'(マーカー無し)');

  const dotErr=g.dots.map(d=>{
   const v=Number((d.title.match(/:\s*([\d.]+)/)||[])[1]);
   return Number.isFinite(v)?{v,y:d.y,err:+(d.y-expect(v)).toFixed(1)}:null;
  }).filter(Boolean);
  rec('他の測定点も値どおりの位置にある',
   dotErr.length>0&&dotErr.every(d=>Math.abs(d.err)<=2),
   dotErr.map(d=>`${d.v}:ズレ${d.err}px`).join(' / '));

  /* --- 4) 公差外の値も見える位置に置かれる(端で潰さない)。
     以前は表示範囲を公差幅の±25%で固定していたため、上限を25%超えた値は
     すべて同じ高さ(上端5%)に張り付き、1つ外れと大きく外れが同じに見えた。 --- */
  const ngDot=dotErr.find(d=>d.v>BASE+PLUS);
  rec('公差外(上振れ)の点が上限より上に描かれる',
   !!ngDot&&ngDot.y<pos.upper,ngDot?JSON.stringify(ngDot):'(該当点なし)');
  rec('公差外の点が上端に張り付いていない(はみ出し量が読める)',
   !!ngDot&&ngDot.y>4,ngDot?`y=${ngDot.y} (数直線の高さ${g.boxH})`:'(該当点なし)');

  /* --- 5) 確定前の先読みリングが確定後の点と同じ写像で置かれる --- */
  const pend=await page.evaluate(()=>{
   updateNumberlinePending('DT11+1002.8M');   // ノギス受信中(未確定)
   const m=document.querySelector('#numberlinePending'),box=document.querySelector('.accurate-numberline');
   if(!m||!box)return null;
   const r=m.getBoundingClientRect(),br=box.getBoundingClientRect();
   return {hidden:m.hidden,y:+(r.top-br.top+r.height/2).toFixed(1)};
  });
  rec('確定前の先読みリングが出る',!!pend&&!pend.hidden,JSON.stringify(pend));
  rec('先読みリングが確定後の点と同じ高さに出る',
   !!pend&&!pend.hidden&&Math.abs(pend.y-expect(1002.8))<=2,
   pend?`y=${pend.y} 期待=${expect(1002.8).toFixed(1)}`:'(リング無し)');

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
