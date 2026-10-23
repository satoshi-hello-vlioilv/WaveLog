/* test_dashboard.js: ダッシュボード（§9.628・LotScope のグリッドのパネルを移植）
   ============================================================
   物差し（評価関数）: 組み込みのダッシュボードを1つずつ開き、パネルごとに
     - 答えが来たか（数えています… のままでない）・断りの字が出ていないか
     - パネルの中身が枠からはみ出していないか（横・縦）
     - 画面の外へはみ出したパネルが無いか（スクロールしない画面）
   を数える。前の画面（稼働状況・自設備・自由集計の3つの表示）は消えていること。
   WAVELOG_SHOT=<dir> で画面を撮る（利用者の PC 1728×1152 とフル HD・125% の 1536×864）。
   ============================================================ */
'use strict';
const {run,seedRecord,clearRecords}=require('./lib/harness.js');
const path=require('path');
const SHOT=process.env.WAVELOG_SHOT||'';
const SIZES=[['1728',{width:1728,height:1152}],['1536',{width:1536,height:864}]];

/** いま出ているダッシュボードの物差し（パネルごとの状態） */
const measure=page=>page.evaluate(()=>{
 const grid=document.getElementById('dashGrid'),g=grid.getBoundingClientRect();
 const panels=[...grid.querySelectorAll('.dash-p[data-id]')].map(p=>{
  const r=p.getBoundingClientRect(),body=p.querySelector('.dash-pb')||p;
  const wait=!!p.querySelector('.dp-wait'),err=(p.querySelector('.dp-err')||{}).textContent||'';
  /* 読み手が「推測する」ことになる物（§9.628 の物差し）: 切れた題・切れた添え書き・分からない数（–）・同じ元の名前のくり返し・
     意味の分からない「条件 n」・字の上を通る線 */
  const cutEl=e=>e.scrollWidth-e.clientWidth>1||e.scrollHeight-e.clientHeight>1;
  const h3=p.querySelector('.dash-ph h3');
  const metas=[...p.querySelectorAll('.dash-psub:not([hidden]),.dp-kmeta,.dash-meta')];
  const segs=metas.flatMap(m=>m.textContent.split('　').map(x=>x.trim().split('・')[0]).filter(Boolean));
  const box=e=>e.getBoundingClientRect(),hit=(a,b)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
  const line=p.querySelector('.og-now'),texts=line?[...p.querySelectorAll('.og-msg,.og-bl')].filter(t=>t.textContent.trim()):[];
  return {id:p.dataset.id,title:((p.querySelector('.dash-ph')||{}).textContent||'').trim().slice(0,30),wait,err:err.trim(),
   overX:body.scrollWidth-body.clientWidth>2,overY:body.scrollHeight-body.clientHeight>2,
   outside:r.right>g.right+1||r.bottom>window.innerHeight+1,
   cutTitle:!!h3&&cutEl(h3),cutMeta:metas.filter(cutEl).length,unknown:[...p.querySelectorAll('.dp-num')].filter(n=>n.textContent.trim().startsWith('–')).length,
   dupSrc:segs.length-new Set(segs).size,vague:metas.reduce((n,m)=>n+(m.textContent.match(/条件 \d/g)||[]).length,0),
   /* 字と「いま」の線が重ならない（字を線の横へ寄せる。地を敷いて線を隠すのも「重なる」と数える） */
   cross:line?texts.filter(t=>hit(box(line),box(t))).length:0};
 });
 return {name:(document.querySelector('.dash-pick b')||{}).textContent||'',panels,
  scroll:document.scrollingElement.scrollHeight>window.innerHeight+1};
});

/** 見本の測定データ: 直近 14 日・2 設備・用途 3 種・人数 2〜4・作業 20〜90 分（いまの時刻から引くので毎回同じ形） */
async function seedWork(){
 const now=Date.now(),ids=[],P=['一般用材','分割検証用','深絞り用'],OP=['佐藤','鈴木','高橋'];
 for(let i=0;i<36;i++){
  const day=i%14,eq=i%3?'テスト設備A':'テスト設備B',min=20+((i*17)%71);
  const st=new Date(now-day*864e5-(2+(i%5))*36e5),en=new Date(st.getTime()+min*6e4);
  ids.push(await seedRecord({equipment:eq,status:'完了',lotNo:`DASH-${String(i).padStart(3,'0')}`,
   extra:{workTime:{startAt:st.toISOString(),endAt:en.toISOString()},basic:{lotNo:`DASH-${String(i).padStart(3,'0')}`,purposeName:P[i%3]},
    settings:{registeredEquipment:eq,crewSize:String(2+(i%3)),operator:OP[i%3],verticalCount:1+(i%2),horizontalCount:4+(i%4)}}}));
 }
 return ids;
}

run('test_dashboard: ダッシュボード',async({page,rec,B,W,idle})=>{
 const errors=[];
 await clearRecords();
 await seedWork();
 try{
 page.on('pageerror',e=>errors.push(String(e.message||e)));
 for(const [tag,vp] of SIZES){
  await page.setViewportSize(vp);
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.booted(page);await idle();
  await page.evaluate(()=>WL.equipment.set('テスト設備A'));
  /* 並びを読んでいる最中に開くよう言われても、読み終えてからその物を開く（前は空のグリッドのまま止まった）。
     押した直後（読み込み中）に別の組み込みを開かせて、読み終えた後にそれが出ていることを見る */
  await page.evaluate(()=>{document.getElementById('openDashboard').click();WL.dashboard._open('b:mine')});
  await W.until(page,()=>WL.dashboard._state().id==='b:mine'&&!!document.querySelector('#dashGrid .dash-p'),null,{ms:20000,what:'読み込み中に頼んだ「自設備」が開く'});
  rec(`読み込み中に開くよう言われた物を、読み終えてから開く（${tag}）`,await page.evaluate(()=>WL.dashboard._state().id==='b:mine'));
  await W.until(page,()=>{const p=document.getElementById('dashScreen');return !!p&&!p.hidden&&!!document.querySelector('#dashGrid .dash-p')},null,{ms:20000,what:'ダッシュボードが開く'});
  rec(`前のダッシュボードの画面は無い（${tag}）`,await page.evaluate(()=>!document.getElementById('dashboardPanel')&&!document.querySelector('[data-dbview]')));
  const list=await page.evaluate(async()=>(await (await fetch('/api/dashboards')).json()).items.filter(x=>x.builtin).map(x=>({id:x.id,name:x.name})));
  const times=[],scores=[];
  rec(`組み込みのダッシュボードが4つ（${tag}）`,list.length===4,list.map(x=>x.name).join('・'));
  for(const it of list){
   const t0=Date.now();
   await page.evaluate(id=>WL.dashboard._open(id),it.id);
   await W.until(page,()=>![...document.querySelectorAll('#dashGrid .dash-p')].some(p=>p.querySelector('.dp-wait')),null,{ms:30000,what:`「${it.name}」の数が出る`});
   times.push(`${tag} ${it.name} ${((Date.now()-t0)/1000).toFixed(1)}秒`);
   await idle();
   const m=await measure(page);
   const bad=m.panels.filter(p=>p.err||p.overX||p.overY||p.outside);
   rec(`「${it.name}」: パネル ${m.panels.length} 枚がどれも数を出し、はみ出さない（${tag}）`,m.panels.length>0&&!bad.length,
    JSON.stringify(bad.slice(0,4)));
   rec(`「${it.name}」: 画面がスクロールしない（${tag}）`,!m.scroll);
   const sum=k=>m.panels.reduce((n,p)=>n+(+p[k]||0),0);
   scores.push(`${tag} ${it.name} 切れた題${sum('cutTitle')} 切れた添え書き${sum('cutMeta')} 分からない数${sum('unknown')} 元のくり返し${sum('dupSrc')} 条件n${sum('vague')} 字の上の線${sum('cross')}`);
   if(process.env.WAVELOG_SHOT)await page.screenshot({path:path.join(SHOT,`after_${tag}_${it.id.replace(/\W/g,'_')}.png`)});
   if(it.id==='b:status'){
    /* 合わせた表の行は数えた設備ぜんぶ（数の無い設備も 0 の行・単位つき。前は数のある設備だけで、隣のガントの設備とそろわなかった） */
    const b=await page.evaluate(()=>({rows:[...document.querySelectorAll('#dashGrid .dash-p[data-id="board"] tbody th[scope=row]')].map(x=>x.textContent.trim()),
     gantt:[...document.querySelectorAll('#dashGrid .dash-p[data-id="gantt"] .og-name')].map(x=>String((x.firstChild||{}).nodeValue||'').trim()),   // 字の後ろの title（乗せたときの説明）は読まない
     zero:[...document.querySelectorAll('#dashGrid .dash-p[data-id="board"] tbody tr')].filter(tr=>/テスト設備[CD]/.test(tr.textContent)).map(tr=>[...tr.querySelectorAll('td.dash-lots b')].map(x=>x.textContent.trim()))}));
    rec(`稼働状況: 表の設備はガントの設備とそろう（${tag}）`,b.gantt.length>0&&b.gantt.every(n=>b.rows.includes(n)),JSON.stringify(b));
    rec(`稼働状況: 数の無い設備の分の値も単位つき（0分）（${tag}）`,b.zero.length>0&&b.zero.every(r=>r.some(x=>x==='0分')),JSON.stringify(b.zero));
   }
   if(it.id==='b:mine'){
    /* オペレータごとの合わせた表: この端末の設備だけを数える（ロット数の和＝完了ロット。前は全設備を数えて 37 本と出た） */
    const o=await page.evaluate(()=>{const n=t=>+String(t).replace(/[^\d.]/g,'');
     const kpi=n((document.querySelector('#dashGrid .dash-p[data-id="mineLots"] .dp-num')||{}).textContent||'');
     const lots=[...document.querySelectorAll('#dashGrid .dash-p[data-id="mineOp"] tbody tr')].map(tr=>n((tr.querySelector('td.dash-lots b')||{}).textContent||'0'));
     return {kpi,lots,sum:lots.reduce((a,x)=>a+x,0)}});
    rec(`自設備: オペレータの表のロット数の和は完了ロットと同じ（${tag}）`,o.lots.length>0&&o.sum===o.kpi,JSON.stringify(o));
   }
   if(it.id==='b:standard'){
    /* 合わせた表: パネル共通に条件があるとき、条件の無いまとまり（仕掛ロット数）は「条件 なし」と言う（共通の条件で数えたと読ませない） */
    const g=await page.evaluate(()=>({common:(document.querySelector('#dashBar .dash-common')||{}).textContent||'',
     heads:[...document.querySelectorAll('#dashGrid .dash-p[data-id="board"] thead tr:first-child th')].map(th=>th.textContent.replace(/\s+/g,' ').trim())}));
    rec(`合わせた表の条件の無いまとまりは「条件 なし」（${tag}）`,!/条件/.test(g.common)||g.heads.some(h=>/仕掛ロット数.*条件 なし/.test(h)),JSON.stringify(g));
   }
   if(it.id==='b:analysis'){
    /* 同じ設備はどのパネルでも同じ色（稼働状況の直近14日・月ごとの推移＝時系列が、設備の色の1箇所 equipColor() と同じ。
       前は系列の何番目かで色を決め、時系列は 1 つずらして始まるので、同じ設備が橙と青緑に分かれた） */
    const c=await page.evaluate(()=>['テスト設備A','テスト設備B'].map(n=>[WL.dashPanels.equipColor(n),...['trend14','monthly'].map(id=>WL.dashPanels.drawnColor(id,n))]));
    rec(`同じ設備はどのパネルでも同じ色（${tag}）`,c.every(x=>x[0]&&x.every(y=>y===x[0]))&&c[0][0]!==c[1][0],JSON.stringify(c));
    /* 設備でない系列（人数）は色相を使わない（色相は設備だけ・§9.628）: 「設備ごとの完了（人数ごと）」の系列の色は設備の色のどれとも違う */
    const crew=await page.evaluate(()=>{const eq=new Set(['テスト設備A','テスト設備B','テスト設備C','テスト設備D'].map(n=>WL.dashPanels.equipColor(n)));return ['2名班','3名班','4名班'].map(n=>WL.dashPanels.drawnColor('crew',n)).map(x=>[x,eq.has(x)])});
    rec(`設備でない系列は設備の色を使わない（${tag}）`,crew.every(([x,hit])=>x&&!hit),JSON.stringify(crew));
   }
  }
  /* 物差し: 開いてから全部のパネルが数を出すまで（1回目は写しを作る・2回目からは答えの控え）。遅さを数で残す */
  rec(`開いてから全部のパネルが数を出すまでの時間（${tag}）`,true,times.join(' / '));
  rec(`読み手に推測させる物の数（${tag}）`,true,scores.join(' / '));
 }
 rec('画面のスクリプトの例外が出ていない',!errors.length,errors.slice(0,3).join(' / '));
 }finally{await clearRecords()}
},{mode:'edit'});
