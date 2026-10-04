/* test_recordlayout.js: 段組の配置——使うデータ・段・位置・幅を盤で決め、紙と一覧が同じ配置を読む（§9.553、利用者の指示）
   ============================================================
   「操業データ表の2段組の繰り返し部分のリスト表示の方法について使うデータを選んで、表示位置を
    細かくカスタム出来るように作り込んで欲しいです。紙への印刷はもちろんのこと、通常のリスト表示も
    切り替えて2段組みリスト表示も出来るようにして下さい。」

   ここで固定すること:
    1. **答え（`WL.recordLayout.plan`）**: 置いた位置どおり・重なりは後から来たほうを自動へ回して名指す・
       盤に入らない列は名指す・置いていなければ幅から自動（古い「段:2」の印も手がかり）
    2. **盤の寸法は画面とサーバーで同じ**（`UNITS`/`LINES` と `master_repo.PLACE_UNITS`/`PLACE_LINES`）
    3. **配置の保存の往復**: `places`は保存して読み直しても同じ。**列の設定パネルの全置換（`save()`）で消えない**
    4. **紙**: 配置の盤どおりに段・位置・幅が紙の表へ出る（検査番号がロット番号の**真下**＝同じ`colspan`の位置）
    5. **一覧の2段組**: 測定実績を「2段組」へ切り替えると、紙と同じ配置の答えで並ぶ（同じ縦線）
    6. **盤**: 開く・項目を掴んで別の段へ動かす・数の欄で幅を変える・保存すると紙が変わる
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const fs=require('fs');
const path=require('path');
const B='http://127.0.0.1:5029';
const TAG='RL'+process.pid;
const EQ='テスト設備A';
const TARGET='opsheet:'+EQ;
const SHOT=process.env.WAVELOG_SHOT||'';
async function shot(page,name){if(process.env.WAVELOG_SHOT)await page.screenshot({path:SHOT+'-'+name+'.png'})}
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const made=[];
function localIso(y,m,d,hh,mm){return new Date(y,m-1,d,hh,mm,0).toISOString()}
function ymd(y,m,d){const p=n=>String(n).padStart(2,'0');return `${y}-${p(m)}-${p(d)}`}
async function mk(o){
 const id=o.id;
 const payload=JSON.stringify({
  id,status:'完了',updatedAt:localIso(o.y,o.m,o.d,o.hh,0),
  basic:{lotNo:o.lotNo,inspectionNo:o.lotNo+'K',mfgMaterial:'A1050',mfgThickness:'0.5'},
  settings:{registeredEquipment:EQ,opData:o.opData||{}},
  workTime:{startAt:localIso(o.y,o.m,o.d,o.hh,0),endAt:localIso(o.y,o.m,o.d,o.hh,45)},
  measurements:{},
 });
 await post('/api/measurement/backup',{id,lotNo:o.lotNo,equipment:EQ,status:'完了',
   codec:'json-full-v32',payload,user_id:'test',updated_at_iso:localIso(o.y,o.m,o.d,o.hh,0)});
 made.push(id);
}
const cleanupLayout=async()=>{
 try{await post('/api/column-layout-master',{target:TARGET,clear:true,order:[],hidden:[],
   widths:{},names:{},formats:{},rules:{},formulas:{},locks:[],sorts:{},aligns:{},places:{},user_id:'test'})}catch(_){/* 片付け: 消せなければ次の実行の始めがもう一度消す */}
};
const getLayout=()=>fetch(B+'/api/column-layout-master?target='+encodeURIComponent(TARGET)).then(r=>r.json());

run('test_recordlayout: 段組の配置（§9.553、利用者の指示）', async ({page,rec,W,errs})=>{
 try{
  await post('/api/access-mode',{mode:'edit'});
  await cleanupLayout();
  const Y=2026,M=5,D=11,day=ymd(Y,M,D);
  const OP1=TAG+'温度',OP2=TAG+'速度';
  await mk({id:TAG+'-1',lotNo:TAG+'L1',y:Y,m:M,d:D,hh:9,opData:{[OP1]:'250',[OP2]:'80'}});
  await mk({id:TAG+'-2',lotNo:TAG+'L2',y:Y,m:M,d:D,hh:10,opData:{[OP1]:'251',[OP2]:'81'}});

  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{try{localStorage.removeItem('OpSheetPrintPrefV1');localStorage.removeItem('ActualsViewPrefV1')}catch(e){/* 保存が使えない端末では前の控えも無い */}});
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);

  /* ---- 1) 答え（純粋な関数） ---- */
  const pure=await page.evaluate(()=>{
   const R=WL.recordLayout;
   const w={A:100,B:100,C:100,D:100};
   const o=(places,usable=10000,hint)=>({placeOf:k=>places[k]||null,naturalPx:k=>w[k]||100,usablePx:usable,lineHint:hint||null});
   const placed=R.plan(['A','B','C'],o({A:{line:1,col:0,span:4},B:{line:2,col:0,span:4}}));
   const conflict=R.plan(['A','B'],o({A:{line:1,col:0,span:6},B:{line:1,col:2,span:4}}));
   const auto1=R.plan(['A','B','C','D'],o({},10000));
   const auto2=R.plan(['A','B','C','D'],o({},250));
   const hinted=R.plan(['A','B','C'],o({},10000,k=>k==='C'?2:0));
   const many=R.plan(Array.from({length:120},(_,i)=>'K'+i),o({},100));
   const seg=R.segments(placed,1);
   const crowd=R.plan(['A',...Array.from({length:59},(_,i)=>'K'+i)],o({A:{line:1,col:0,span:4}},100));
   const sum=p=>[1,2].map(l=>p.cells.filter(c=>c.line===l).reduce((s,c)=>s+c.span,0));
   return {U:R.UNITS,L:R.LINES,
    placedA:placed.cells.find(c=>c.k==='A'),placedB:placed.cells.find(c=>c.k==='B'),placedC:placed.cells.find(c=>c.k==='C'),
    conflict:{conf:conflict.conflicts,b:conflict.cells.find(c=>c.k==='B')},
    auto1:{lines:auto1.lines,sum:sum(auto1)},auto2:{lines:auto2.lines,sum:sum(auto2)},
    hinted:hinted.cells.find(c=>c.k==='C').line,
    many:{overflow:many.overflow.length,cells:many.cells.length},
    crowd:{lines:crowd.lines,overflow:crowd.overflow.length,cells:crowd.cells.length},
    segSum:seg.reduce((s,g)=>s+g.span,0),segGap:seg.filter(g=>g.k==null).length};
  });
  rec('置いた位置どおり（ロット番号の真下へ検査番号を置ける）',
      pure.placedA.line===1&&pure.placedB.line===2&&pure.placedA.col===pure.placedB.col&&pure.placedA.span===pure.placedB.span,
      JSON.stringify([pure.placedA,pure.placedB]));
  rec('置いていない列は空いたマスへ自動で入る（点線＝auto）',pure.placedC&&pure.placedC.auto===true&&pure.placedC.col>=4,JSON.stringify(pure.placedC));
  rec('重なった位置は後から来たほうを自動へ回して名指す',pure.conflict.conf.join()==='B'&&pure.conflict.b&&pure.conflict.b.auto===true,JSON.stringify(pure.conflict));
  rec('置いていなければ幅から自動: 紙に入るなら1段・各段のマスの合計は24',
      pure.auto1.lines===1&&pure.auto1.sum[0]===pure.U,JSON.stringify(pure.auto1));
  rec('紙に入らなければ2段へ割る（各段24マスちょうど）',pure.auto2.lines===2&&pure.auto2.sum.every(v=>v===pure.U),JSON.stringify(pure.auto2));
  rec('古い「段:2」の印は手がかりとして読む',pure.hinted===2,String(pure.hinted));
  rec('盤に入らない列は名指す（黙って落とさない）',pure.many.overflow===120-pure.U*pure.L&&pure.many.cells===pure.U*pure.L,JSON.stringify(pure.many));
  rec('置いた位置の残りへは入りきる最小の段数で入れ、広い列は空きに合わせて縮める（あふれない）',
      pure.crowd.lines===3&&pure.crowd.overflow===0&&pure.crowd.cells===60,JSON.stringify(pure.crowd));
  rec('段の並びは空いたマスも数えて24マスちょうど',pure.segSum===pure.U&&pure.segGap>=1,JSON.stringify({sum:pure.segSum,gap:pure.segGap}));

  /* ---- 2) 盤の寸法は画面とサーバーで同じ ---- */
  const py=fs.readFileSync(path.join(__dirname,'..','backend','repositories','master_repo.py'),'utf8');
  const pu=Number((/^PLACE_UNITS=(\d+)/m.exec(py)||[])[1]),plines=Number((/^PLACE_LINES=(\d+)/m.exec(py)||[])[1]);
  rec('盤の寸法はサーバーと同じ（UNITS・LINES）',pu===pure.U&&plines===pure.L,JSON.stringify({画面:[pure.U,pure.L],サーバー:[pu,plines]}));

  /* ---- 3) 保存の往復・全置換で消えない ---- */
  const places={'ロット番号':{line:1,col:0,span:5},'検査番号':{line:2,col:0,span:5},[OP1]:{line:1,col:5,span:3},[OP2]:{line:2,col:5,span:3}};
  await post('/api/column-layout-master',{target:TARGET,places,user_id:'test'});
  const back=await getLayout();
  const same=(x,y)=>!!x&&!!y&&x.line===y.line&&x.col===y.col&&x.span===y.span;
  rec('配置は保存して読み直しても同じ',Object.keys(places).every(k=>same(back.places[k],places[k]))&&Object.keys(back.places).length===4,
      JSON.stringify(back.places));
  await post('/api/column-layout-master',{target:TARGET,places:{X:{line:1,col:20,span:9}},user_id:'test'});
  const bad=await getLayout();
  rec('盤からはみ出す配置は保存しない（縮めて救わない）',!bad.places.X,JSON.stringify(bad.places));
  await post('/api/column-layout-master',{target:TARGET,places,user_id:'test'});
  const kept=await page.evaluate(async t=>{
   await WL.columnLayout.load(t);
   const l=WL.columnLayout.get(t);
   /* 列の設定パネルの保存と同じ形（`places`を知らない全置換） */
   await WL.columnLayout.save(t,{order:l.order,widths:l.widths,hidden:l.hidden,names:l.names,formats:l.formats,
     rules:l.rules,formulas:l.formulas,locks:l.locks,sorts:l.sorts,aligns:l.aligns});
   return Object.keys(WL.columnLayout.get(t).places||{}).length;
  },TARGET);
  const kept2=await getLayout();
  rec('列の設定パネルの全置換（places を渡さない save）で配置が消えない',kept===4&&Object.keys(kept2.places||{}).length===4,
      JSON.stringify({画面:kept,サーバー:Object.keys(kept2.places||{}).length}));

  /* ---- 4) 紙: 配置の盤どおり ---- */
  await page.click('#openActuals');
  await page.waitForSelector('#actualsPanel .ac-row.head',{timeout:20000});
  await page.selectOption('#acEquipment',EQ);
  await page.evaluate(d=>{
   const f=document.getElementById('acFrom'),t=document.getElementById('acTo');
   f.value=d;t.value=d;f.dispatchEvent(new Event('change'));t.dispatchEvent(new Event('change'));
  },day);
  await page.waitForFunction(t=>[...document.querySelectorAll('#acList .ac-row:not(.head)')].filter(r=>r.textContent.includes(t)).length===2,TAG,{timeout:20000});
  await page.click('#acSheet');
  await page.waitForSelector('#osPreview .os-page',{timeout:20000});
  const paper=await page.evaluate(()=>{
   const p=document.querySelector('#osPreview .os-page');
   const at=(tr,word)=>{let u=0;for(const th of tr.children){const n=Number(th.getAttribute('colspan'))||1;if(th.textContent.trim()===word)return {col:u,span:n};u+=n}return null};
   const h1=p.querySelector('thead tr.os-head-1'),h2=p.querySelector('thead tr.os-head-2');
   const sum=tr=>tr?[...tr.children].reduce((s,c)=>s+(Number(c.getAttribute('colspan'))||1),0):0;
   return {tracks:p.querySelectorAll('colgroup col').length,lot:h1&&at(h1,'ロット番号'),insp:h2&&at(h2,'検査番号'),
           s1:sum(h1),s2:sum(h2),rows:p.querySelectorAll('tbody tr').length,lines:p.querySelectorAll('thead tr').length,
           note:(document.getElementById('osPvRowsNote')||{}).textContent||''};
  });
  rec('紙は24本のトラック（盤の1マス＝紙の刷れる幅の1/24）',paper.tracks===24&&paper.s1===24&&paper.s2===24,JSON.stringify(paper));
  rec('紙でも検査番号はロット番号の真下（同じ位置・同じ幅）',paper.lot&&paper.insp&&paper.lot.col===paper.insp.col&&paper.lot.span===5&&paper.insp.span===5,
      JSON.stringify({lot:paper.lot,insp:paper.insp}));
  rec('紙の説明は段数と置いた位置の数を字で言う',new RegExp(`^${paper.lines}段構成`).test(paper.note)&&/置いた位置 4項目/.test(paper.note)&&!/盤に入らない/.test(paper.note),paper.note.slice(0,80));
  await shot(page,'paper');

  /* ---- 6) 盤: 開く・動かす・数で直す・保存 ---- */
  await page.click('#osPvBoardOpen');
  await page.waitForSelector('#osPvBoard .rcl-chip',{timeout:10000});
  const b0=await page.evaluate(()=>({chips:document.querySelectorAll('#osPvBoard .rcl-chip').length,
   pal:document.querySelectorAll('#osPvBoard .rcl-pal-item').length}));
  rec('盤が開き、項目の札と使うデータの一覧が出る',b0.chips>=4&&b0.pal>=b0.chips,JSON.stringify(b0));
  const lane=await page.evaluate(()=>{const bd=document.querySelector('#osPvBoard .rcl-board'),btn=document.querySelector('#osPvBoard [data-rl="lane"]');
   const L=()=>Number(getComputedStyle(bd).getPropertyValue('--rcl-lines'));const before=L();
   if(btn&&!btn.disabled)btn.click();
   return {before,after:L(),names:document.querySelectorAll('#osPvBoard .rcl-lanes span').length,disabled:!!(btn&&btn.disabled)};});
  rec('「段を足す」で段が1つ増え、上限（4段）では押せない',lane.before>=4?lane.after===lane.before:(lane.after===lane.before+1&&lane.names===lane.after),JSON.stringify(lane));
  await shot(page,'board');
  /* 掴んで動かす: OP1 の札を下段の12マス目あたりへ */
  const box=await page.evaluate(k=>{
   const bd=document.querySelector('#osPvBoard .rcl-board'),c=bd.querySelector(`.rcl-chip[data-k="${CSS.escape(k)}"]`);
   const r=bd.getBoundingClientRect(),q=c.getBoundingClientRect();
   /* 段の数は項目の数で変わる（既定2段・最大4段）——2段目の真ん中の高さを段の数から出す */
   const L=Number(getComputedStyle(bd).getPropertyValue('--rcl-lines'))||2;
   return {bx:r.left,by:r.top,bw:r.width,bh:r.height,L,cx:q.left+q.width/3,cy:q.top+q.height/2};
  },OP1);
  await page.mouse.move(box.cx,box.cy);await page.mouse.down();
  await page.mouse.move(box.bx+box.bw*0.5,box.by+box.bh*1.5/box.L,{steps:8});
  await page.mouse.up();
  const moved=await page.evaluate(k=>{const c=document.querySelector(`#osPvBoard .rcl-chip[data-k="${CSS.escape(k)}"]`);
   return c?c.style.gridRow:''},OP1);
  const note=()=>page.evaluate(()=>(document.querySelector('#osPvBoard .rcl-note')||{}).textContent||'');
  rec('札を掴んで下段へ動かせる',/^2/.test(moved),moved+' / '+(await note()).slice(0,120));
  /* 数の欄で幅を変える（選んだ項目＝いま動かした札） */
  await page.fill('#osPvBoard .rcl-insp [data-num="span"]','6');
  await page.press('#osPvBoard .rcl-insp [data-num="span"]','Tab');
  const wide=await page.evaluate(k=>{const c=document.querySelector(`#osPvBoard .rcl-chip[data-k="${CSS.escape(k)}"]`);
   return c?c.style.gridColumn:''},OP1);
  rec('選んだ項目の幅を数の欄で直せる',/span 6/.test(wide),wide);
  await page.click('#osPvBoard [data-rl="save"]');
  await W.until(page,()=>document.getElementById('osPvBoard').hidden===true,null,{ms:8000,what:'盤が閉じる'});
  const saved=await getLayout();
  rec('保存すると配置がマスタへ入る',saved.places[OP1]&&saved.places[OP1].line===2&&saved.places[OP1].span===6,JSON.stringify(saved.places[OP1]));
  await page.click('#osPvClose');

  /* ---- 5) 一覧の2段組 ---- */
  await page.click('#acView [data-view="stack"]');
  await page.waitForSelector('#acList .rcl-rec:not(.rcl-head)',{timeout:10000});
  const list=await page.evaluate(k=>{
   const head=document.querySelector('#acList .rcl-head');
   const pos=word=>{const el=[...head.querySelectorAll('.rcl-c')].find(x=>x.textContent.trim()===word);
     return el?{col:el.style.gridColumn,row:el.style.gridRow}:null};
   const recs=document.querySelectorAll('#acList .rcl-rec:not(.rcl-head)');
   return {recs:recs.length,lot:pos('ロット番号'),insp:pos('検査番号'),op:pos(k),
           word:(document.getElementById('acColumnsWord')||{}).textContent||'',
           picks:document.querySelectorAll('#acList .rcl-rec [data-pick]').length};
  },OP1);
  rec('一覧を段組にすると1件が1つの塊で並ぶ（選ぶ印も残る）',list.recs===2&&list.picks===2,JSON.stringify(list));
  rec('一覧でも検査番号はロット番号の真下（紙と同じ縦線）',list.lot&&list.insp&&list.lot.col===list.insp.col&&list.lot.row==='1'&&list.insp.row==='2',
      JSON.stringify({lot:list.lot,insp:list.insp}));
  rec('盤で動かした項目は一覧でも同じ段・位置',list.op&&list.op.row==='2'&&/span 6/.test(list.op.col),JSON.stringify(list.op));
  rec('段組のときは「表示列」が「段組の配置」になる（1行の表示列を変えても段組は変わらない）',list.word==='段組の配置',list.word);
  await shot(page,'list');
  await page.click('#acView [data-view="line"]');
  await page.waitForSelector('#acList .ac-row.head',{timeout:10000});
  rec('1行へ戻せる',await page.evaluate(()=>!!document.querySelector('#acList .ac-row.head')&&!document.querySelector('#acList .rcl-rec')));
  rec('画面の例外が出ていない',errs.length===0,errs.join(' / '));
 }finally{
  await cleanupLayout();
  try{await page.evaluate(()=>{try{localStorage.removeItem('ActualsViewPrefV1')}catch(e){/* 保存が使えない端末では消す物も無い */}})}catch(_){/* 片付け: 画面が閉じていれば控えも無い */}
  await post('/api/access-mode',{mode:'edit'});
  try{await post('/api/measurement/backup/delete',{ids:made})}catch(_){/* 片付け: 消せなければ名前（TAG）で見分けられる */}
 }
},{viewport:{width:1600,height:1000}});
