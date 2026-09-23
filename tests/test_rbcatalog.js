/* test_rbcatalog.js: 帳票ブロックの「引ける範囲」と「書式」（§9.285 ②③④）
   ============================================================
   利用者の指示（3件）:
    ②「帳票ブロックの部分で汎用化できていない部分を汎用表現を追加し編集可能
       範囲に取り込む改良」
    ③「帳票ブロックの部分で表示する書式を変更する実装、『日付』、『数値』の
       桁数など」
    ④「帳票ブロックマスタで仕掛情報などリンクしているデータのうち、直接
       アプリで使用していないデータでも元データからなくなれば出ないという
       制限付きで出すことができるようにひっぱれるデータ範囲の拡張」

   ここで固定すること:
    1. 候補に**品質等級・品質情報・仕掛の生データ**の群がある
    2. 母材の道は`mother.<キー>`（`settings.mother*`は記録に存在しない）
    3. **記録に残らない欄は候補に出さず、出さない理由を書く**（§4）
    4. `寸法（オーダー／製造）`などは**既定の中身を写せる**——写した紙が
       コードの既定と**同じ値**を出す（白紙から組み直させない）
    5. `source.<列名>`が紙に出る。**元データに無い列は空欄**（④の但し書き）
    6. 書式（日付の秒・数値の桁）が**紙まで届く**
    7. 効いている書式と「候補に無い道」を**盤が文字で出す**（§3）

   **素通りに注意**:
    - 「候補に在る」だけを見る網は、紙に値が出ない実装でも通る。
      **紙の文字**まで見ること。
    - 書式は`WL.cellFormat`だけを見ると通る（あれは最初から正しい）。
      **紙のセル**で秒が出ることを見る。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const getj=async p=>(await fetch(B+p)).json();
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)}).then(r=>r.json());

run('test_rbcatalog: 帳票ブロックの「引ける範囲」と「書式」（§9.285 ②③④）', async ({rec,B,W,idle,paint,errs,browser})=>{
 /* 触った行は必ず戻す（§9.121。`db/master.sqlite3`は実行をまたいで生き延びる）。 */
 const undo=[];
 try{
  await post('/api/access-mode',{mode:'edit'});
  const j0=await getj('/api/report-block-master?equipment='+encodeURIComponent(EQ));
  const groups=(j0.catalog||[]).map(g=>g.group);
  const pathsOf=name=>{
   const g=(j0.catalog||[]).find(x=>x.group===name||String(x.group).indexOf(name)===0);
   return g?g.items.map(i=>i.path):[];
  };

  /* ---- ② 汎用化できていなかった塊の道が候補に出る ---- */
  rec('品質等級の道が候補に出る（12件）',
      pathsOf('品質等級（仕掛）').length===12
      &&pathsOf('品質等級（仕掛）').includes('qualityGrades.切断面'),
      JSON.stringify(pathsOf('品質等級（仕掛）').slice(0,3)));
  rec('品質情報（仕掛）の道が候補に出る',
      pathsOf('品質情報（仕掛）').includes('qualityInfo'),JSON.stringify(groups));
  /* **母材は`mother.<キー>`**——以前は`settings.motherManual`を答えており、
     実データでは必ず空だった（`WL.measureView.collect()`が`[data-mother]`から`mother`へ書く）。 */
  const prep=pathsOf('準備で決めた値');
  rec('母材の道は mother.<キー>（settings.mother* ではない）',
      prep.includes('mother.manual')&&prep.includes('mother.rearCard')
      &&!prep.some(p=>/^settings\.mother/.test(p)),
      JSON.stringify(prep.filter(p=>/mother/i.test(p))));
  /* **記録に残らない欄は出さない。ただし理由は書く**（§4）。 */
  const prepNote=((j0.catalog||[]).find(g=>g.group==='準備で決めた値')||{}).note||'';
  rec('記録に残らない欄は候補に出さず、名前を挙げて理由を書く',
      !prep.includes('settings.motherScrapWidth')&&!prep.includes('settings.motherCalcLength')
      &&prepNote.indexOf('屑幅')>=0&&prepNote.indexOf('計算全長')>=0,
      prepNote.slice(0,120));

  /* ---- ④ 仕掛の生の列（アプリが名前を付けていない列も引ける） ---- */
  const raw=(j0.catalog||[]).find(g=>String(g.group).indexOf('仕掛の生データ')===0);
  rec('仕掛の生データの群がある（列名がそのまま候補になる）',
      !!raw&&raw.items.length>10&&raw.items.every(i=>i.path.indexOf('source.')===0),
      raw?`${raw.items.length}列 ${raw.items.slice(0,2).map(i=>i.path).join(',')}`:'なし');
  rec('「元データから無くなれば空欄」と候補の説明に書く',
      !!raw&&/無くなれば空欄/.test(raw.note||''),(raw&&raw.note||'').slice(0,90));
  /* 見本の値は**実データの1行**から作る——8列しか無い見本だと、選んだ列が
     ほとんど空欄になって紙に入るかどうかを確かめられない。 */
  rec('候補に実データの見本が添う',
      !!raw&&raw.items.filter(i=>i.sample&&i.sample!=='（空）').length>5,
      raw?JSON.stringify(raw.items.slice(0,2)):'');

  /* ---- ② 既定の中身を写せる ---- */
  const dcKeys=Object.keys(j0.defaultCells||{});
  rec('既定の中身を写せる塊が4つある',
      ['寸法（オーダー／製造）','品質等級','品質情報（仕掛）','母材実績／カード指示']
        .every(k=>dcKeys.includes(k)),JSON.stringify(dcKeys));
  rec('写す並びは列数も一緒に答える（写した瞬間に別の絵にならない）',
      (j0.defaultCells['寸法（オーダー／製造）']||{}).cols===6,
      JSON.stringify((j0.defaultCells['寸法（オーダー／製造）']||{}).cols));

  /* **時差のある地方時で見ること**（§9.285 ③）——検証環境はUTCなので、
     素のままだと「生のISOを書式へ渡す」欠陥と正しい実装が**同じ絵**になり、
     地方時の網が一度も効かない（§9.108・§9.275と同じ「この環境では通らない道」）。
     現場と同じJSTを明示して、時差ぶんずれたら落ちるようにする。 */
  const page=await (await browser.newContext({viewport:{width:1600,height:1000},timezoneId:'Asia/Tokyo'})).newPage();
  page.on('pageerror',e=>console.log('[pageerror]',e.message));
  page.on('dialog',d=>d.accept());
  await page.addInitScript(eq=>{try{
    localStorage.setItem('AccessMeasurementConfiguredEquipment',eq);
    localStorage.setItem('AccessMeasurementUserId','tester');
  }catch(e){}},EQ);
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:20000});

  /* 見本の紙を開いて、ある塊の中身（文字）を取る。 */
  const paperOf=async name=>{
   await page.evaluate(()=>{
    if(document.body.classList.contains('rp-mode')){
     const back=document.getElementById('reportBack');if(back)back.click();
    }
   });
   await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:20000});
   await page.waitForSelector('#mmSampleView',{timeout:20000});
   await page.click('#mmSampleView');
   await page.waitForFunction(()=>document.body.classList.contains('rp-mode'),null,{timeout:20000});
   await page.waitForFunction(()=>{
    const c=document.getElementById('reportContent');
    return c&&c.textContent.length>500;
   },null,{timeout:20000});
   return page.evaluate(n=>{
    const blocks=[...document.querySelectorAll('#reportContent .rp-block')];
    const hit=blocks.find(el=>{
     const h=el.querySelector('h3');
     return h&&h.textContent.trim()===n;
    });
    return {found:!!hit,text:hit?hit.innerText.replace(/\s+/g,' ').trim():'',
            all:document.getElementById('reportContent').innerText.replace(/\s+/g,' ')};
   },name);
  };
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:20000});
  await page.waitForSelector('#masterMaintNav [data-master="reportBlock"]',{timeout:20000});
  await page.click('#masterMaintNav [data-master="reportBlock"]');

  const DIM='寸法（オーダー／製造）';
  const codePaper=await paperOf(DIM);
  rec('コードの既定で寸法の塊が出ている',codePaper.found&&/材質/.test(codePaper.text),
      codePaper.text.slice(0,90));

  /* 既定の中身を写して保存する（画面の「既定の中身を写す」と同じ内容を入れる）。 */
  const rowOf=async key=>{
   const j=await getj('/api/report-block-master');
   return (j.items||[]).find(x=>x.builtin===key)||null;
  };
  const dimRow=await rowOf(DIM);
  undo.push({id:dimRow.id,equipment:dimRow.equipment,name:dimRow.name,span:dimRow.span,
             rows:dimRow.rows,content:dimRow.content||'',cols:dimRow.cols||0,kindText:'項目の並び'});
  await post('/api/report-block-master/update',
    {id:dimRow.id,equipment:dimRow.equipment,name:dimRow.name,span:dimRow.span,rows:dimRow.rows,
     content:j0.defaultCells[DIM].content,cols:j0.defaultCells[DIM].cols,kindText:'項目の並び'});
  await page.evaluate(()=>{if(window.WL&&WL.reportBlocks&&WL.reportBlocks.forget)WL.reportBlocks.forget()});
  const cellPaper=await paperOf(DIM);
  /* **同じ値が出ること**まで見る（「塊が在る」だけでは通ってしまう）。
     見出しの並びと数値の桁がコードの表と揃っていること。 */
  const nums=s=>(s.match(/\d+\.\d+/g)||[]);
  rec('写した中身で紙が同じ値を出す（白紙にならない）',
      cellPaper.found&&nums(cellPaper.text).length>=4
      &&nums(codePaper.text).every(v=>cellPaper.text.indexOf(v)>=0),
      JSON.stringify({コード:nums(codePaper.text),マス:nums(cellPaper.text)}));
  rec('写した中身でも見出しの語（材質・調質・板厚）が残る',
      ['材質','調質','板厚','板幅','板丈','オーダー','製造'].every(w=>cellPaper.text.indexOf(w)>=0),
      cellPaper.text.slice(0,110));

  /* ---- ④ 生の列が紙に出る／無い列は空欄 ---- */
  /* **新しい塊を作らないこと**——自作の塊は「並びに載っていなければ隠す」
     （§9.274 の`rpHiddenSet()`）ので、作っただけでは紙に出ない。ここで見たいのは
     道が引けるかどうかなので、**紙に出ている既定の塊の中身を入れ替える**。 */
  const swap=async(key,content,cols)=>{
   const row=await rowOf(key);
   undo.push({id:row.id,equipment:row.equipment,name:row.name,span:row.span,rows:row.rows,
              content:row.content||'',cols:row.cols||0,kindText:'項目の並び'});
   await post('/api/report-block-master/update',
     {id:row.id,equipment:row.equipment,name:row.name,span:row.span,rows:row.rows,
      content,cols,kindText:'項目の並び'});
   await page.evaluate(()=>{if(window.WL&&WL.reportBlocks&&WL.reportBlocks.forget)WL.reportBlocks.forget()});
   return paperOf(key);
  };
  const col=raw.items.find(i=>i.sample&&i.sample!=='（空）'&&i.name!=='ロット番号')||raw.items[0];
  const colName=col.path.slice('source.'.length);
  const rawPaper=await swap('コース情報',
    `実在する列=${col.path}\n無い列=source.__無い列__回帰__`,2);
  rec('仕掛の生の列が紙に出る（アプリが名前を付けていない列）',
      rawPaper.found&&rawPaper.text.indexOf(String(col.sample))>=0,
      JSON.stringify({列:colName,見本:col.sample,紙:rawPaper.text.slice(0,90)}));
  rec('元データに無い列は空欄（出ないという制限つき）',
      rawPaper.found&&/無い列 -/.test(rawPaper.text),rawPaper.text.slice(0,110));

  /* ---- ③ 書式が紙まで届く ---- */
  const iso=String((await getj('/api/report-block-master/sample-record')).record.updatedAt||'');
  const fmtPaper=await swap('登録状態',JSON.stringify([
      {label:'秒まで',path:'updatedAt',kind:'value',showLabel:true,
       format:{kind:'datetime',pattern:'yyyy/MM/dd HH:mm:ss'}},
      {label:'日だけ',path:'updatedAt',kind:'value',showLabel:true,
       format:{kind:'datetime',pattern:'yyyy年M月d日'}},
      {label:'桁と単位',path:'basic.mfgThickness',kind:'value',showLabel:true,
       format:{kind:'number',decimals:4,suffix:' mm'}}]),1);
  /* **秒まで出ること**。見本の`updatedAt`は記録と同じISO（末尾Z）なので、
     ここは「書式が届いているか」と「地方時へ直してから当てているか」を
     同時に見る網になる。 */
  const hhmmss=(fmtPaper.text.match(/(\d{2}):(\d{2}):(\d{2})/)||[]);
  rec('日付の書式が秒まで届く',
      fmtPaper.found&&hhmmss.length===4&&hhmmss[3]==='37',
      JSON.stringify({紙:fmtPaper.text.slice(0,90),iso}));
  /* **生のISOを書式へ渡さないこと**（§9.162と同じ罠）——渡すとUTCの成分が
     そのまま読まれ、書式を付けた欄だけ時差ぶんずれる。**この端末の地方時**と
     突き合わせる（実行環境のTZに依らない）。 */
  const want=await page.evaluate(v=>{
   const d=new Date(v);
   const p=n=>String(n).padStart(2,'0');
   return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  },iso);
  rec('書式は地方時に当たる（生のISOを渡していない）',
      fmtPaper.found&&fmtPaper.text.indexOf(want)>=0,
      JSON.stringify({欲しい:want,紙:fmtPaper.text.slice(0,90)}));
  rec('日付だけの書式も効く',
      fmtPaper.found&&/\d{4}年\d{1,2}月\d{1,2}日/.test(fmtPaper.text),
      fmtPaper.text.slice(0,110));
  rec('数値の桁と単位が紙に出る',
      fmtPaper.found&&/0\.3000 mm/.test(fmtPaper.text),fmtPaper.text.slice(0,110));

  /* **写した中身の桁は変えられる**（③の本題）——コードが持っていた
     `fmtDimSafe(x,3)`は現場から触れなかった。写したあとは1マスずつ直せる。 */
  const dim2=JSON.parse(j0.defaultCells[DIM].content).map(c=>(
    c.path==='basic.mfgThickness'?Object.assign({},c,{format:{kind:'number',decimals:1}}):c));
  const dimPaper2=await swap(DIM,JSON.stringify(dim2),j0.defaultCells[DIM].cols);
  /* **触ったマスだけが変わること**まで見る——全部の桁が動いたら、
     1マスずつ決められていない（オーダー側は3桁のまま）。 */
  rec('写したあとは桁を変えられる（製造板厚だけ 3桁→1桁）',
      dimPaper2.found&&/製造[^0-9]*C1020[^0-9]*1\/2H 0\.3 /.test(dimPaper2.text)
      &&/オーダー[^0-9]*C1020[^0-9]*1\/2H 0\.300 /.test(dimPaper2.text),
      dimPaper2.text.slice(0,140));

  /* ---- ③ 盤が「効いている書式」と「候補に無い道」を文字で出す ---- */
  await page.evaluate(()=>{
   if(document.body.classList.contains('rp-mode')){
    const back=document.getElementById('reportBack');if(back)back.click();
   }
  });
  await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:20000});
  await page.waitForSelector('#masterMaintList .mm-row',{timeout:20000});
  /* **段（タブ）は見出しの言葉で開く**（§9.250 ④。番号で探すと、段が1つ
     増えただけで直していないのに落ちる）。開かないと盤は`[hidden]`の中で、
     `waitForSelector`は「見えていない」ので必ず時間切れになる。 */
  const openBuilderTab=async()=>{
   await page.evaluate(()=>{
    const t=[...document.querySelectorAll('#maintEditorModal .mm-tabbar button')]
      .find(b=>/何を載せる/.test(b.textContent||''));
    if(t)t.click();
   });
   await page.waitForSelector('#maintEditorForm .fb-body',{timeout:20000});
  };
  const opened=await page.evaluate(name=>{
   const rows=[...document.querySelectorAll('#masterMaintList .mm-row')];
   const hit=rows.find(r=>r.textContent.indexOf(name)>=0);
   if(!hit)return false;
   hit.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
   return true;
  },'登録状態');
  rec('盤（編集窓）が開ける',opened,String(opened));
  await openBuilderTab();
  await page.waitForSelector('#maintEditorForm .fb-rows .fb-row',{timeout:20000});
  await page.waitForFunction(()=>document.querySelectorAll('#maintEditorForm .fb-rows .fb-fmttag').length>0,
                             null,{timeout:20000}).catch(()=>{});
  const board=await page.evaluate(()=>({
   fmt:[...document.querySelectorAll('#maintEditorForm .fb-rows .fb-fmttag')].map(x=>x.textContent.trim()),
   warn:[...document.querySelectorAll('#maintEditorForm .fb-rows .fb-warn')].map(x=>x.textContent.trim()),
   seed:(()=>{const b=document.querySelector('#maintEditorForm .fb-seed');return b?{hidden:b.hidden,text:b.textContent.trim()}:null})()}));
  rec('効いている書式を盤が文字で出す（1マスずつ押さなくても読める）',
      board.fmt.length===3&&board.fmt.some(t=>/HH:mm:ss/.test(t))
      &&board.fmt.some(t=>/小数4桁/.test(t))&&board.fmt.some(t=>/後「 mm」/.test(t)),
      JSON.stringify(board.fmt));
  rec('写す既定を持たない塊では「既定の中身を写す」を出さない',
      !board.seed||board.seed.hidden===true,JSON.stringify(board.seed));

  /* 「候補に無い道」の印は、無い列を持つ塊で見る。 */
  await page.evaluate(()=>{const c=document.getElementById('maintEditorCancel');if(c)c.click()});
  await page.waitForSelector('#masterMaintList .mm-row',{timeout:20000});
  await page.evaluate(name=>{
   const rows=[...document.querySelectorAll('#masterMaintList .mm-row')];
   const hit=rows.find(r=>r.textContent.indexOf(name)>=0);
   if(hit)hit.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  },'コース情報');
  await openBuilderTab();
  await page.waitForSelector('#maintEditorForm .fb-rows .fb-row',{timeout:20000});
  await page.waitForFunction(()=>document.querySelectorAll('#maintEditorForm .fb-rows .fb-warn').length>0,
                             null,{timeout:20000}).catch(()=>{});
  const board2=await page.evaluate(()=>({
   warn:[...document.querySelectorAll('#maintEditorForm .fb-rows .fb-warn')].length,
   rows:document.querySelectorAll('#maintEditorForm .fb-rows .fb-row').length,
   title:(document.querySelector('#maintEditorForm .fb-rows .fb-warn')||{}).title||''}));
  rec('候補に無い道は印を出す（元データから消えた列が分かる）',
      board2.warn===1&&board2.rows===2,JSON.stringify(board2));
  rec('印は理由と結果を書く（紙では空欄になる）',
      /空欄/.test(board2.title),board2.title.slice(0,80));

  /* 既定の塊では「既定の中身を写す」が出る。
     **`品質等級`は§9.320-Eで自動で種をまく側**になったので、開いた時点で
     既にマスが入っている——ボタンの文字は「既定を写す」ではなく
     「既定へ戻す」（`master-maint.js`の`state.rows.length?'既定へ戻す':
     '既定を写す'`）。**どちらでも「白紙から組ませない」は満たしている**
     （押せば1回でその塊の既定形へ揃う点は同じ）ので、両方を受ける。 */
  await page.evaluate(()=>{const c=document.getElementById('maintEditorCancel');if(c)c.click()});
  await page.waitForSelector('#masterMaintList .mm-row',{timeout:20000});
  await page.evaluate(name=>{
   const rows=[...document.querySelectorAll('#masterMaintList .mm-row')];
   const hit=rows.find(r=>r.textContent.indexOf(name)>=0);
   if(hit)hit.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  },'品質等級');
  await openBuilderTab();
  await page.waitForFunction(()=>{
   const b=document.querySelector('#maintEditorForm .fb-seed');return b&&!b.hidden;
  },null,{timeout:20000}).catch(()=>{});
  const seed=await page.evaluate(()=>{
   const b=document.querySelector('#maintEditorForm .fb-seed');
   return b?{hidden:b.hidden,text:b.textContent.trim(),title:b.title}:null;
  });
  rec('既定の塊では「既定の中身を写す／戻す」が出る（白紙から組ませない）',
      !!seed&&seed.hidden===false&&/写す|置き換え|戻す/.test(seed.text),JSON.stringify(seed));
  if(seed&&!seed.hidden){
   await page.click('#maintEditorForm .fb-seed');
   await page.waitForFunction(()=>document.querySelectorAll('#maintEditorForm .fb-rows .fb-row').length>=12,
                              null,{timeout:10000}).catch(()=>{});
   const after=await page.evaluate(()=>({
    n:document.querySelectorAll('#maintEditorForm .fb-rows .fb-row').length,
    cols:(document.querySelector('#maintEditorForm [data-field="cols"]')||{}).value||''}));
   rec('押すと既定の並びと列数がそのまま入る',after.n===12&&String(after.cols)==='4',
       JSON.stringify(after));
  }else rec('押すと既定の並びと列数がそのまま入る',false,'ボタンが出ていない');
  await page.evaluate(()=>{const c=document.getElementById('maintEditorCancel');if(c)c.click()});

 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }finally{
  /* **後片付け**（§9.121）——直した行を戻し、作った塊は消す。 */
  for(const u of undo){
   try{
    if(u.__delete!=null)await post('/api/report-block-master/delete',{id:u.__delete});
    else await post('/api/report-block-master/update',u);
   }catch(e){console.log('cleanup failed',e&&e.message||e)}
  }
 }
}, {});
