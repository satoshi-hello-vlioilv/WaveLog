/* test_defect.js: 異常位置判定・バリ揃え/コイル止めのマスタ化・分割数の表示。
   ------------------------------------------------------------
   フィクスチャの仕掛データには分割(親子管理_子カード)が入っていないため、
   条割は settings.splitGroups / splitPositionGroup を直接組み立てて再現する
   (条割変更モーダルの「適用」が作るのと同じ形)。
   異幅3ロット・計6条・元幅に屑幅40mmを載せた構成で、屑幅を含む/含まない・
   4通りの基準位置がすべて同じ条を指すことを確かめる。 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const API='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(`${API}/api/access-mode`,
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
/* 条: A100 A100 B150 B150 C200 C200 → 条幅合計1100 / 元幅1140 (屑40, 片側20)
   条1[0,100) 条2[100,200) 条3[200,350) 条4[350,500) 条5[500,700) 条6[700,900)
   …ではなく実際は 200+300+400=900? → 下で実値を持たせる。 */
const LOTS=[{lot:'AAA111',width:100,count:2},{lot:'BBB222',width:150,count:2},{lot:'CCC333',width:200,count:2}];
const SLIT=LOTS.reduce((a,g)=>a+g.width*g.count,0);   // 900
const SCRAP=40, ORIGINAL=SLIT+SCRAP;                  // 940
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

  /* ---------- 1) バリ揃え・コイル止めのマスタ ---------- */
  const api=async(u,opt)=>page.evaluate(async([u,opt])=>{
   const res=await fetch(u,opt||undefined);return {status:res.status,body:await res.json()};
  },[u,opt]);
  const burr=await api('/api/burr-master');
  rec('バリ揃えマスタのAPIが応答する',burr.status===200&&burr.body.ok,JSON.stringify(burr.body).slice(0,120));
  rec('バリ揃えの既定値が入っている',
   ['上バリ揃え','下バリ揃え','指定なし'].every(n=>(burr.body.items||[]).some(i=>i.name===n)),
   (burr.body.items||[]).map(i=>i.name).join(','));
  const coil=await api('/api/coil-stop-master');
  rec('コイル止めマスタのAPIが応答する',coil.status===200&&coil.body.ok,JSON.stringify(coil.body).slice(0,120));
  rec('コイル止めの既定値が入っている',
   ['内巻両面テープ','指定なし'].every(n=>(coil.body.items||[]).some(i=>i.name===n)),
   (coil.body.items||[]).map(i=>i.name).join(','));

  // マスタ管理画面に他のマスタと同じ形で並ぶ
  await page.click('#openMasterMaint');await page.waitForTimeout(1800);
  const menu=await page.$$eval('#masterMaintNav [data-master]',n=>n.map(x=>x.dataset.master));
  rec('マスタ管理に「バリ揃え」「コイル止め」が並ぶ',
   menu.includes('burr')&&menu.includes('coilStop'),menu.join(','));

  /* ---------- 2) 測定画面の選択欄が他項目と同じ形 ---------- */
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
  await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000}).catch(()=>{});

  const sel=await page.evaluate(()=>{
   const cell=id=>{const el=document.getElementById(id);if(!el)return null;
    return {tag:el.tagName,opts:[...(el.options||[])].map(o=>o.value),
            inSelectors:!!el.closest('.selectors'),
            label:(el.closest('label')?.textContent||'').replace(/\s+/g,'').replace(/[^ぁ-んァ-ン一-龥]/g,'').slice(0,8)};
   };
   return {burr:cell('burr'),coil:cell('coilStop'),
           spool:cell('spool'),                  // 比較用(既存のマスタ項目)
           fieldsets:document.querySelectorAll('.center-pane fieldset').length,
           radios:document.querySelectorAll('[name=burr]').length,
           innerTape:!!document.getElementById('innerTape')};
  });
  rec('バリ揃えがセレクトになっている',sel.burr?.tag==='SELECT',JSON.stringify(sel.burr));
  rec('コイル止めがセレクトになっている',sel.coil?.tag==='SELECT',JSON.stringify(sel.coil));
  rec('他の選択項目と同じ並び(.selectors)に入る',
   sel.burr?.inSelectors&&sel.coil?.inSelectors&&sel.spool?.inSelectors,
   `バリ${sel.burr?.inSelectors} コイル${sel.coil?.inSelectors} スプール${sel.spool?.inSelectors}`);
  rec('ラジオ・チェックボックスは残っていない',
   sel.fieldsets===0&&sel.radios===0&&!sel.innerTape,
   `fieldset${sel.fieldsets} radio${sel.radios} innerTape${sel.innerTape}`);
  rec('バリ揃えの選択肢がマスタから来る',
   (sel.burr?.opts||[]).includes('上バリ揃え')&&(sel.burr?.opts||[]).includes('指定なし'),
   (sel.burr?.opts||[]).join(','));
  rec('コイル止めの選択肢がマスタから来る',
   (sel.coil?.opts||[]).includes('内巻両面テープ'),(sel.coil?.opts||[]).join(','));

  // 旧データ(innerTape:true)を開くと「内巻両面テープ」へ読み替わる
  const legacy=await page.evaluate(()=>{
   const m={settings:{innerTape:true}};
   ensureMeasureShape(m);
   const m2={settings:{innerTape:false}};ensureMeasureShape(m2);
   return {on:m.settings.coilStop,off:m2.settings.coilStop,left:m.settings.innerTape};
  });
  rec('旧データの内巻両面テープ(真)をコイル止めへ読み替える',legacy.on==='内巻両面テープ',JSON.stringify(legacy));
  rec('旧データの内巻両面テープ(偽)は指定なしになる',legacy.off==='指定なし',JSON.stringify(legacy));
  rec('読み替えたら旧フィールドは残さない',legacy.left===undefined,String(legacy.left));

  // 選んだ値が保存データへ入る
  const kept=await page.evaluate(()=>{
   document.getElementById('burr').value='下バリ揃え';
   document.getElementById('coilStop').value='内巻両面テープ';
   collect();
   return {burr:S.measure.settings.burr,coil:S.measure.settings.coilStop};
  });
  rec('選んだ値が保存データへ入る',kept.burr==='下バリ揃え'&&kept.coil==='内巻両面テープ',JSON.stringify(kept));

  /* ---------- 3) 異常位置判定 ---------- */
  await page.evaluate(([lots,original])=>{
   const groups=lots.map(g=>({lot:g.lot,count:g.count,base:{width:g.width},tol:null,missing:false}));
   const pos=[];groups.forEach((g,gi)=>{for(let k=0;k<g.count;k++)pos.push(gi)});
   S.measure.settings.splitGroups=groups;
   S.measure.settings.splitPositionGroup=pos;
   S.measure.basic.originalWidth=original;
   document.getElementById('horizontalCount').value=String(pos.length);
  },[LOTS,ORIGINAL]);

  await page.click('#openDefect');
  await page.waitForFunction(()=>!document.getElementById('defectModal')?.hidden,null,{timeout:10000});
  rec('メニューから異常位置判定を開ける',true);

  const lanes=await page.evaluate(()=>WL.defect.lanes());
  rec('条の並びを条割から組み立てる',
   lanes.list.length===6&&lanes.complete&&Math.abs(lanes.slit-900)<1e-6,
   `条${lanes.list.length} 合計${lanes.slit}`);
  rec('条ごとの子ロットを持つ',
   lanes.list[0].lot==='AAA111'&&lanes.list[2].lot==='BBB222'&&lanes.list[5].lot==='CCC333',
   lanes.list.map(l=>l.lot).join(','));

  /* 元幅基準・OSから270mm → 屑20を引いて製品座標250 → 条3[200,350) */
  const set=async(o)=>page.evaluate(o=>{
   document.getElementById('defectBasis').value=o.basis;
   document.getElementById('defectWidthBasis').value=o.widthBasis;
   document.getElementById('defectDistance').value=String(o.distance);
   document.getElementById('defectWidth').value=String(o.defectWidth??5);
   ['defectBasis','defectWidthBasis','defectDistance','defectWidth']
    .forEach(id=>document.getElementById(id).dispatchEvent(new Event('change',{bubbles:true})));
   const box=document.getElementById('defectModal');
   const r=WL.defect.compute({basis:o.basis,widthBasis:o.widthBasis,distance:o.distance,defectWidth:o.defectWidth??5});
   return {pos:r.pos,hits:(r.hits||[]).map(h=>h.index+1),lots:[...new Set((r.hits||[]).map(h=>h.lot))],
           error:r.error||'',scrap:r.scrap,baseWidth:r.baseWidth,
           marks:box.querySelectorAll('.defect-mark').length,
           hitLanes:box.querySelectorAll('.defect-lane.is-hit').length,
           answer:(box.querySelector('.defect-answer')?.textContent||'').replace(/\s+/g,' ').trim()};
  },o);

  const a=await set({basis:'os',widthBasis:'original',distance:270});
  rec('元幅基準・OSから: 屑幅の半分を引いて製品座標へ直す',
   Math.abs(a.pos-250)<1e-6&&Math.abs(a.baseWidth-940)<1e-6,JSON.stringify(a));
  rec('該当する条とロットを特定する',
   a.hits.join(',')==='3'&&a.lots.join(',')==='BBB222',JSON.stringify(a));
  rec('帯グラフで該当条を強調する',a.hitLanes===1&&a.marks===1,`該当${a.hitLanes} マーク${a.marks}`);
  rec('答えを文章で出す',/OSから 3 条目/.test(a.answer)&&/BBB222/.test(a.answer),a.answer);

  const p=await set({basis:'os',widthBasis:'product',distance:250});
  rec('製品幅合計基準・OSから: 屑幅を引かない',
   Math.abs(p.pos-250)<1e-6&&Math.abs(p.baseWidth-900)<1e-6&&p.hits.join(',')==='3',JSON.stringify(p));
  const wrong=await set({basis:'os',widthBasis:'product',distance:270});
  rec('基準幅の取り違えは屑幅の半分だけずれる（別々に扱えている）',
   Math.abs(wrong.pos-270)<1e-6,`製品基準270→${wrong.pos} / 元幅基準270→${a.pos}`);

  const ds=await set({basis:'ds',widthBasis:'original',distance:940-270});
  rec('DSから測っても同じ条になる',ds.hits.join(',')==='3'&&Math.abs(ds.pos-250)<1e-6,JSON.stringify(ds));
  const co=await set({basis:'center-os',widthBasis:'original',distance:200});
  rec('センターからOSへ測っても同じ条になる',co.hits.join(',')==='3'&&Math.abs(co.pos-250)<1e-6,JSON.stringify(co));
  const cd=await set({basis:'center-ds',widthBasis:'original',distance:-200});
  rec('センターからDSへは符号が逆向きに効く',Math.abs(cd.pos-250)<1e-6,JSON.stringify(cd));

  // 境界に掛かる欠陥は両方の条を返す(既定5mm=±2.5mm)
  const edge=await set({basis:'os',widthBasis:'product',distance:200});
  rec('条の境目にある欠陥は両側の条を返す',edge.hits.join(',')==='2,3',JSON.stringify(edge.hits));
  const point=await set({basis:'os',widthBasis:'product',distance:200,defectWidth:0});
  rec('欠陥の幅を0にすると1条だけになる',point.hits.join(',')==='3',JSON.stringify(point.hits));
  // 幅400 → 製品座標0〜400 に掛かるのは 条1[0,100) 条2 条3 条4[350,500) の4条。
  const wide=await set({basis:'os',widthBasis:'product',distance:200,defectWidth:400});
  rec('欠陥の幅を広げると掛かる条が増える',wide.hits.join(',')==='1,2,3,4',JSON.stringify(wide.hits));

  // 屑の中は「製品に掛からない」
  const inScrap=await set({basis:'os',widthBasis:'original',distance:5});
  rec('屑幅の中なら製品に掛からないと答える',
   inScrap.hits.length===0&&/掛かる条はありません/.test(inScrap.answer),inScrap.answer);

  // 入力はレコードへ残る(再開時に復元できる)
  const saved=await page.evaluate(()=>S.measure.settings.defectLocation||null);
  rec('判定の入力と結果がレコードへ残る',
   !!saved&&saved.basis==='os'&&Number(saved.distance)===5,JSON.stringify(saved).slice(0,140));

  // 帳票
  const rep=await page.evaluate(()=>{
   document.getElementById('defectDistance').value='270';
   document.getElementById('defectBasis').value='os';
   document.getElementById('defectWidthBasis').value='original';
   document.getElementById('defectDistance').dispatchEvent(new Event('change',{bubbles:true}));
   const origPrint=window.print;let called=0;window.print=()=>{called++};
   document.getElementById('defectPrint').click();
   return new Promise(res=>setTimeout(()=>{
    const area=document.getElementById('defectPrintArea');
    const txt=(area?.textContent||'').replace(/\s+/g,' ');
    const out={called,has:!!area,lot:/[A-Z0-9]/.test(txt),
      title:/異常位置判定書/.test(txt),basic:/ロット番号/.test(txt),
      cond:/基準位置/.test(txt)&&/欠陥の幅/.test(txt),
      hit:/該当条/.test(txt)&&/BBB222/.test(txt),
      strip:!!area?.querySelector('.df-strip .defect-lane'),
      printClass:document.body.classList.contains('df-print')};
    window.print=origPrint;
    document.body.classList.remove('df-print');
    res(out);
   },400));
  });
  rec('帳票を印刷できる',rep.called===1&&rep.has,JSON.stringify(rep));
  rec('帳票に判定書の見出しと基本情報が載る',rep.title&&rep.basic,JSON.stringify(rep));
  rec('帳票に判定条件と該当条が載る',rep.cond&&rep.hit,JSON.stringify(rep));
  rec('帳票にも帯グラフが載る',rep.strip,String(rep.strip));

  /* ---------- 4) 「Nロットに分割」は子ロットの数 ---------- */
  const split=await page.evaluate(()=>{
   document.getElementById('closeDefect').click();
   // 同じ子ロットを離して置く並べ方(A B A)。区間は3つだがロットは2つ。
   const groups=[{lot:'AAA111',count:1,base:{width:100}},{lot:'BBB222',count:1,base:{width:150}},
                 {lot:'AAA111',count:1,base:{width:100}}];
   const pos=[0,1,2];
   S.measure.settings.splitGroups=groups;S.measure.settings.splitPositionGroup=pos;
   if(typeof refreshSplitStatusPanel==='function')refreshSplitStatusPanel();
   const panel=document.getElementById('splitGrid');
   return (panel?.textContent||'').replace(/\s+/g,' ');
  });
  rec('離して置いた同じ子ロットを二重に数えない',
   /2ロット/.test(split)&&!/3ロット/.test(split),split.slice(0,110));
  rec('ロット数と条数を別々に出す',/2ロット\s*\/\s*3条/.test(split),split.slice(0,110));

  /* ---- 5) 分割数(条)とロット数は別物 ----
     1つの子ロットを何条にも割れるので、条数をロット数として数えてはいけない。
     子カード2枠(=2ロット)・切断巾6枠(=6条)の行で、両者が分かれることを見る。 */
  const counts=await page.evaluate(()=>{
   /* データ上の持ち方:
      ・切断巾N / 子カードN の「枠」1つ = 子ロット1つ(枠は10まで)
      ・各枠の条数は YKN / K05JON。条数はその合計。
      ここでは3ロット(枠3つ)で条数 4+6+2=12 の行を作る。 */
   const row={'ロット番号':'L00001'};
   [1,2,3].forEach(i=>{row['親子管理_子カード'+i]=i;row['コンマ5本分割_切断巾'+i]=100+i});
   row['YK1']=4;row['YK2']=6;row['YK3']=2;
   const a=window.analyzeRowSplit(row);
   // 条数フィールドが無い場合は1枠=1条として安全側に数える
   const row2={'ロット番号':'L00003'};
   [1,2].forEach(i=>{row2['親子管理_子カード'+i]=i;row2['コンマ5本分割_切断巾'+i]=200+i});
   const c=window.analyzeRowSplit(row2);
   const b=window.analyzeRowSplit({'ロット番号':'L00002'});
   return {a,b,c};
  });
  rec('ロット数は子ロットの枠の数(切断巾＝ロットの分割数)',
   counts.a.lotCount===3,JSON.stringify(counts.a));
  rec('条数は各子ロットの条数の合計',counts.a.stripCount===12,JSON.stringify(counts.a));
  rec('条数が入っていなければ1枠=1条で安全側に数える',
   counts.c.lotCount===2&&counts.c.stripCount===2,JSON.stringify(counts.c));
  rec('分割データが無ければ分割なし',counts.b.hasSplit===false,JSON.stringify(counts.b));

  /* ---- 6) 最大条数は設備マスタから ---- */
  const eq=await page.evaluate(async()=>{
   const r=await (await fetch('/api/equipment-master')).json();
   return {ok:r.ok,limit:r.stripLimit,def:r.defaultMaxStrips,
           sample:(r.items||[])[0]||null,
           hasField:(r.items||[]).every(i=>'maxStrips' in i&&'maxStripsEffective' in i)};
  });
  rec('設備マスタが最大条数を返す',eq.ok&&eq.hasField,JSON.stringify(eq).slice(0,160));
  rec('構造上の上限と既定値を返す',eq.limit===40&&eq.def===40,`limit=${eq.limit} 既定=${eq.def}`);

  const eqSave=await page.evaluate(async()=>{
   const post=(u,b)=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify(Object.assign({user_id:'tests'},b))}).then(r=>r.json());
   const before=await (await fetch('/api/equipment-master')).json();
   const target=(before.items||[]).find(i=>i.name==='テスト設備A');
   if(!target)return {skip:true};
   const r1=await post('/api/equipment-master/update',{id:target.id,name:'テスト設備A',maxStrips:12});
   const mid=await (await fetch('/api/equipment-master')).json();
   const after=(mid.items||[]).find(i=>i.id===target.id);
   // 上限(40)を超える指定は丸める
   await post('/api/equipment-master/update',{id:target.id,name:'テスト設備A',maxStrips:99});
   const over=((await (await fetch('/api/equipment-master')).json()).items||[]).find(i=>i.id===target.id);
   // 空欄へ戻すと「未設定＝既定」
   await post('/api/equipment-master/update',{id:target.id,name:'テスト設備A',maxStrips:''});
   const cleared=((await (await fetch('/api/equipment-master')).json()).items||[]).find(i=>i.id===target.id);
   return {ok:r1.ok,saved:after?.maxStrips,savedEff:after?.maxStripsEffective,
           over:over?.maxStrips,cleared:cleared?.maxStrips,clearedEff:cleared?.maxStripsEffective};
  });
  rec('設備ごとに最大条数を保存できる',
   eqSave.skip||(eqSave.saved===12&&eqSave.savedEff===12),JSON.stringify(eqSave));
  rec('構造上の上限(40)を超える指定は丸める',eqSave.skip||eqSave.over===40,JSON.stringify(eqSave));
  rec('空欄へ戻すと未設定(既定40)になる',
   eqSave.skip||(eqSave.cleared===''&&eqSave.clearedEff===40),JSON.stringify(eqSave));

  const applied=await page.evaluate(()=>{
   S.measure.settings.maxStrips=12;
   applyMaxStripsToInputs();
   const el=document.getElementById('horizontalCount');
   const before=el.value;
   el.value='30';el.dispatchEvent(new Event('change',{bubbles:true}));
   const after=el.value;
   return {max:el.max,title:el.title,before,after,limit:WL.maxStripsForEquipment()};
  });
  rec('横割数の入力上限が設備の最大条数になる',applied.max==='12',JSON.stringify(applied));
  rec('上限を超える条数は入力時に戻す',applied.after==='12',JSON.stringify(applied));
  rec('条割の上限判定も設備の最大条数を見る',applied.limit===12,String(applied.limit));

  // 仕掛一覧のセルも「Nロット/M条」で言い分ける
  await page.evaluate(()=>{document.getElementById('measureModal').hidden=true});
  await page.click('aside [data-db-key="SIKALOTNOW"]');await page.waitForTimeout(3000);
  const cell=await page.evaluate(()=>{
   const c=document.querySelector('.split-flag-cell.split-yes');
   return c?{text:c.textContent.trim(),title:c.title}:null;
  });
  rec('仕掛一覧の分割セルもロットと条を言い分ける',
   !cell||(/ロット/.test(cell.text)&&/条/.test(cell.text)&&/ロット/.test(cell.title)&&/条/.test(cell.title)),
   JSON.stringify(cell));

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
