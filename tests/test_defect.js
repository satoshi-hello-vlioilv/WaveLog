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
  /* バリ揃え・コイル止めは操業データ選択肢マスタの**まとまり**へ移した
     （§9.221 ③、利用者の指示）。見ているのは「現場が値を増やせること」と
     「既定の選択肢が消えていないこと」なので、移った先で同じことを見る。 */
  const ch=await api('/api/operation-choice-master');
  rec('操業データ選択肢マスタのAPIが応答する',ch.status===200&&ch.body.ok,JSON.stringify(ch.body).slice(0,120));
  const valuesOf=n=>(ch.body.items||[]).filter(i=>i.name===n).map(i=>i.value);
  rec('バリ揃えの既定値が入っている',
   ['上バリ揃え','下バリ揃え','指定なし'].every(n=>valuesOf('バリ揃え').includes(n)),
   valuesOf('バリ揃え').join(','));
  rec('コイル止めの既定値が入っている',
   ['内巻両面テープ','指定なし'].every(n=>valuesOf('コイル止め').includes(n)),
   valuesOf('コイル止め').join(','));

  // マスタ管理画面では「選択肢の値」1枚にまとまっている
  await page.click('#openMasterMaint');await page.waitForTimeout(1800);
  const menu=await page.$$eval('#masterMaintNav [data-master]',n=>n.map(x=>x.dataset.master));
  rec('マスタ管理に専用タブを残していない',
   !menu.includes('burr')&&!menu.includes('coilStop')&&!menu.includes('operator')
   &&!menu.includes('spool')&&!menu.includes('inner')&&!menu.includes('device'),menu.join(','));
  rec('「選択肢の値」1枚にまとまっている',menu.includes('opChoice'),menu.join(','));

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

  /* ---------- 3b) 器の大きさは中身で変わらない（VER1.84.0） ----------
     以前は .defect-dialog に height が無く、該当条が増える・エラー文が出る
     たびにモーダル自体が伸び縮みしていた。フッターが画面外へ押し出され
     「印刷ボタンが消える」という指摘になっていたので、外形が一定であること・
     どの状態でも操作列がモーダルの中に収まっていることを固定する。 */
  const dialogBox=()=>page.evaluate(()=>{
   const d=document.querySelector('#defectModal .defect-dialog').getBoundingClientRect();
   return {w:Math.round(d.width),h:Math.round(d.height)};
  });
  const clearDistance=()=>page.evaluate(()=>{
   const el=document.getElementById('defectDistance');
   el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await set({basis:'os',widthBasis:'product',distance:250,defectWidth:0});   // 該当1条
  const box1=await dialogBox();
  await set({basis:'os',widthBasis:'product',distance:450,defectWidth:900}); // 全条該当
  const box2=await dialogBox();
  await clearDistance();                                                     // 未入力(案内表示)
  const box3=await dialogBox();
  rec('該当条の数が変わってもモーダルの大きさは変わらない',
   box1.h===box2.h&&box1.w===box2.w,`1条${JSON.stringify(box1)} 全条${JSON.stringify(box2)}`);
  rec('入力途中でもモーダルの大きさは変わらない',
   box1.h===box3.h&&box1.w===box3.w,`判定済${JSON.stringify(box1)} 未入力${JSON.stringify(box3)}`);

  /* 操作列とプレビュー枠は、判定できない状態でも消えない・器からはみ出さない */
  const visible=()=>page.evaluate(()=>{
   const dlg=document.querySelector('#defectModal .defect-dialog').getBoundingClientRect();
   const inside=el=>{if(!el||el.hidden)return false;const b=el.getBoundingClientRect();
    return b.width>0&&b.height>0&&b.top>=dlg.top-1&&b.bottom<=dlg.bottom+1};
   const q=id=>inside(document.getElementById(id));
   return {print:q('defectPrint'),save:q('defectSave'),reset:q('defectReset'),
           strip:q('defectStrip'),answer:q('defectResult'),detail:q('defectDetail'),
           disabled:document.getElementById('defectPrint').disabled,
           title:document.getElementById('defectPrint').title,
           placeholder:!!document.querySelector('#defectStrip .defect-figure-empty, #defectStrip .defect-lane')};
  });
  const vEmpty=await visible();
  rec('判定できない状態でも印刷・保存ボタンがモーダルの中に残る',
   vEmpty.print&&vEmpty.save&&vEmpty.reset,JSON.stringify(vEmpty));
  rec('判定できない状態でもプレビュー枠と結論欄が残る',
   vEmpty.strip&&vEmpty.answer&&vEmpty.detail&&vEmpty.placeholder,JSON.stringify(vEmpty));
  rec('押せない印刷ボタンは消さず、理由をツールチップに出す',
   vEmpty.disabled&&/判定できていない/.test(vEmpty.title),vEmpty.title);
  await set({basis:'os',widthBasis:'product',distance:450,defectWidth:900});
  const vFull=await visible();
  rec('全条が該当しても操作列は器の中に収まる',
   vFull.print&&vFull.save&&vFull.reset&&!vFull.disabled,JSON.stringify(vFull));

  /* 条数が最大(40条)でも器の大きさは同じ */
  await page.evaluate(()=>{
   const groups=[],pos=[];
   for(let i=0;i<40;i++){groups.push({lot:'Z'+String(i).padStart(5,'0'),count:1,base:{width:25}});pos.push(i)}
   S.measure.settings.splitGroups=groups;S.measure.settings.splitPositionGroup=pos;
   document.getElementById('horizontalCount').value='40';
   WL.defect.refresh();
  });
  const box40=await dialogBox();
  rec('条が40本でもモーダルの大きさは変わらない',
   box1.h===box40.h&&box1.w===box40.w,`6条${JSON.stringify(box1)} 40条${JSON.stringify(box40)}`);
  // 元の3ロット6条へ戻す
  await page.evaluate(([lots,original])=>{
   const groups=lots.map(g=>({lot:g.lot,count:g.count,base:{width:g.width},tol:null,missing:false}));
   const pos=[];groups.forEach((g,gi)=>{for(let k=0;k<g.count;k++)pos.push(gi)});
   S.measure.settings.splitGroups=groups;S.measure.settings.splitPositionGroup=pos;
   S.measure.basic.originalWidth=original;
   document.getElementById('horizontalCount').value=String(pos.length);
   WL.defect.refresh();
  },[LOTS,ORIGINAL]);

  /* 位置ラベル(帯の外に出した▼付きバッジ)が図の端でも見切れない */
  const flagBox=async d=>{
   await set({basis:'os',widthBasis:'product',distance:d});
   return page.evaluate(()=>{
    const wrap=document.getElementById('defectFlags').getBoundingClientRect();
    const f=document.querySelector('#defectFlags .defect-flag');
    if(!f)return null;const b=f.getBoundingClientRect();
    return {inLeft:Math.round(b.left-wrap.left),inRight:Math.round(wrap.right-b.right),cls:f.className};
   });
  };
  /* WAVELOG_SHOT=<dir> を付けたときだけ、各状態のモーダルを書き出す。
     見た目の変更をレビューするための補助で、判定には使わない。 */
  if(process.env.WAVELOG_SHOT){
   const dir=process.env.WAVELOG_SHOT;
   const el=await page.$('#defectModal .defect-dialog');
   await set({basis:'os',widthBasis:'original',distance:270,defectWidth:5});
   await el.screenshot({path:dir+'/defect_ok.png'});
   await clearDistance();await el.screenshot({path:dir+'/defect_empty.png'});
   await set({basis:'os',widthBasis:'original',distance:450,defectWidth:120});
   await el.screenshot({path:dir+'/defect_wide.png'});
   await page.evaluate(()=>{
    const groups=[],pos=[];
    for(let i=0;i<40;i++){groups.push({lot:'Z'+String(i%7).padStart(5,'0'),count:1,base:{width:22.5}});pos.push(i)}
    S.measure.settings.splitGroups=groups;S.measure.settings.splitPositionGroup=pos;
    document.getElementById('horizontalCount').value='40';WL.defect.refresh();
   });
   await el.screenshot({path:dir+'/defect_40.png'});
   await page.evaluate(([lots,original])=>{
    const groups=lots.map(g=>({lot:g.lot,count:g.count,base:{width:g.width},tol:null,missing:false}));
    const pos=[];groups.forEach((g,gi)=>{for(let k=0;k<g.count;k++)pos.push(gi)});
    S.measure.settings.splitGroups=groups;S.measure.settings.splitPositionGroup=pos;
    S.measure.basic.originalWidth=original;
    document.getElementById('horizontalCount').value=String(pos.length);WL.defect.refresh();
   },[LOTS,ORIGINAL]);
  }
  const nearOs=await flagBox(1),nearDs=await flagBox(899);
  rec('OS端でも位置ラベルが図からはみ出さない',
   !!nearOs&&nearOs.inLeft>=-1&&/at-start/.test(nearOs.cls),JSON.stringify(nearOs));
  rec('DS端でも位置ラベルが図からはみ出さない',
   !!nearDs&&nearDs.inRight>=-1&&/at-end/.test(nearDs.cls),JSON.stringify(nearDs));

  /* ---------- 3c) 保存はユーザーが押したときだけ ----------
     入力は一時データとして残る(開き直して続きができる)が、帳票へ載るのは
     保存ボタンを押したときだけ。シミュレーションと正式な記載を分ける。 */
  await set({basis:'os',widthBasis:'original',distance:270,defectWidth:5});
  const beforeSave=await page.evaluate(()=>({
   temp:!!S.measure.settings.defectLocation,
   saved:!!S.measure.settings.defectLocation?.saved,
   state:document.getElementById('defectSaveState').textContent,
   unsaveHidden:document.getElementById('defectUnsave').hidden}));
  rec('入力しただけでは一時データに留まり、帳票用の保存はされない',
   beforeSave.temp&&!beforeSave.saved,JSON.stringify(beforeSave));
  rec('未保存であることを操作列に出す',/未保存/.test(beforeSave.state),beforeSave.state);
  rec('未保存なら「帳票から外す」は出さない',beforeSave.unsaveHidden,String(beforeSave.unsaveHidden));

  const afterSave=await page.evaluate(()=>{
   document.getElementById('defectSave').click();
   const sv=S.measure.settings.defectLocation.saved;
   return {saved:!!sv,hits:(sv?.hits||[]).map(h=>h.index+1).join(','),lanes:(sv?.lanes||[]).length,
    pos:sv?.pos,state:document.getElementById('defectSaveState').textContent,
    unsave:!document.getElementById('defectUnsave').hidden};
  });
  rec('保存ボタンで判定が凍結される',
   afterSave.saved&&afterSave.hits==='3'&&afterSave.lanes===6&&Math.abs(afterSave.pos-250)<1e-6,
   JSON.stringify(afterSave));
  rec('保存済みであることを操作列に出す',/保存済み/.test(afterSave.state),afterSave.state);
  rec('保存後は「帳票から外す」を出す',afterSave.unsave,String(afterSave.unsave));

  await set({basis:'os',widthBasis:'original',distance:520});
  const stale=await page.evaluate(()=>({
   state:document.getElementById('defectSaveState').textContent,
   isStale:document.getElementById('defectSaveState').classList.contains('is-stale'),
   kept:(S.measure.settings.defectLocation.saved?.hits||[]).map(h=>h.index+1).join(','),
   label:document.getElementById('defectSave').textContent}));
  rec('保存後に入力を変えても保存内容は据え置く',stale.kept==='3',JSON.stringify(stale));
  rec('保存が古くなったことを知らせる',
   stale.isStale&&/入力が変わりました/.test(stale.state)&&/保存を更新/.test(stale.label),JSON.stringify(stale));
  const resaved=await page.evaluate(()=>{
   document.getElementById('defectSave').click();
   return {hits:(S.measure.settings.defectLocation.saved?.hits||[]).map(h=>h.index+1).join(','),
           isStale:document.getElementById('defectSaveState').classList.contains('is-stale')};
  });
  rec('保存し直すと内容が更新される',resaved.hits==='4,5'&&!resaved.isStale,JSON.stringify(resaved));

  /* ---------- 3d) 保存したときだけ測定帳票に載る ---------- */
  await set({basis:'os',widthBasis:'original',distance:270});
  await page.evaluate(()=>document.getElementById('defectSave').click());
  const repSec=await page.evaluate(()=>{
   const html=WL.defect.reportSectionHtml(S.measure)||'';
   const d=document.createElement('div');d.innerHTML=html;
   return {has:!!html,title:/異常位置判定（参考）/.test(html),
    lanes:d.querySelectorAll('.rp-defect-lane').length,
    hits:d.querySelectorAll('.rp-defect-lane.is-hit').length,
    mark:d.querySelectorAll('.rp-defect-mark').length,
    flag:d.querySelectorAll('.rp-defect-flag').length,
    facts:[...d.querySelectorAll('.rp-defect-fact')].map(x=>x.textContent.replace(/\s+/g,'')).join('|')};
  });
  rec('保存済みなら帳票用のセクションを作れる',
   repSec.has&&repSec.title&&repSec.lanes===6&&repSec.mark===1&&repSec.flag===1,JSON.stringify(repSec).slice(0,200));
  rec('帳票の図でも該当条を強調する',repSec.hits===1,String(repSec.hits));
  rec('帳票に該当条・基準・欠陥幅などの要点が載る',
   /該当条/.test(repSec.facts)&&/基準幅/.test(repSec.facts)&&/欠陥の幅/.test(repSec.facts),repSec.facts.slice(0,180));

  /* 実際の帳票プレビューへ出るか・ツールバーで消せるか */
  const inReport=await page.evaluate(async()=>{
   await reliablePut(collect());
   const id=S.measure.id;
   document.getElementById('defectModal').hidden=true;
   await window.openReportForRecord(id);
   const read=()=>{
    const c=document.getElementById('reportContent');
    return {text:/異常位置判定（参考）/.test(c.innerText),
            lanes:c.querySelectorAll('.rp-defect-lane').length};
   };
   const on=read();
   const btn=document.getElementById('reportDefectToggle');
   const label=btn.textContent;
   btn.click();const off=read();
   btn.click();const back=read();
   return {on,off,back,label,id};
  });
  if(process.env.WAVELOG_SHOT){
   await page.evaluate(()=>{document.getElementById('measureModal').hidden=true;
    document.querySelector('[data-seg="rpZoomSeg"] [data-val="100"]').click()});
   await page.screenshot({path:process.env.WAVELOG_SHOT+'/defect_report.png',fullPage:false});
   const sec=await page.evaluateHandle(()=>[...document.querySelectorAll('#reportContent .rp-section')]
    .find(x=>x.querySelector('.rp-defect-body')));
   const secEl=sec.asElement();
   if(secEl)await secEl.screenshot({path:process.env.WAVELOG_SHOT+'/defect_report_zoom.png'});
   await page.evaluate(()=>{document.getElementById('measureModal').hidden=false});
  }
  rec('帳票プレビューに異常位置判定(参考)が出る',
   inReport.on.text&&inReport.on.lanes===6,JSON.stringify(inReport.on));
  rec('既定は「載せる」',/載せる/.test(inReport.label),inReport.label);
  rec('ツールバーのトグルで帳票から外せる',!inReport.off.text&&inReport.off.lanes===0,JSON.stringify(inReport.off));
  rec('もう一度押すと戻る',inReport.back.text&&inReport.back.lanes===6,JSON.stringify(inReport.back));

  const unsavedReport=await page.evaluate(async()=>{
   delete S.measure.settings.defectLocation.saved;
   await reliablePut(collect());
   const html=WL.defect.reportSectionHtml(S.measure)||'';
   return {html,hasSaved:WL.defect.hasSaved(S.measure)};
  });
  rec('保存されていないロットは帳票に出ない',
   unsavedReport.html===''&&!unsavedReport.hasSaved,JSON.stringify(unsavedReport).slice(0,120));

  // 以降の検証は測定画面へ戻ってから続ける
  await page.evaluate(()=>{
   document.getElementById('reportBack')?.click();
   document.getElementById('measureModal').hidden=false;
  });
  await page.waitForTimeout(400);
  await page.evaluate(()=>{document.getElementById('defectModal').hidden=false;WL.defect.refresh()});

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
