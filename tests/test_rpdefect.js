/* test_rpdefect.js: 紙の異常位置判定とピッチ判定（§9.319-C、利用者の指示）

   ============================================================
   「印刷レイアウトでピッチ測定の場合、見切れが生じる不具合と、文字の大きさも
     小さすぎて見えない読めないので、コンパクトに表示しつつ、文字のサイズを
     他の帳票項目と同じくらいにしてほしいです。異常位置判定とピッチ判定の
     ブロックを分けてほしいです。異常位置判定も文字が小さいので他の項目並みに
     大きくしてほしいです。異常位置判定の文字の項目は必要な範囲でコンパクトに
     条の分割の図を最大化したいです。異常位置判定（参考）となっていますが、
     異常位置判定に変更してください。」

   ここで固定すること
    1. **塊が2つに分かれている**（異常位置判定 / ピッチ判定）
    2. 題は「異常位置判定」（**（参考）を付けない**）／もう一方は「ピッチ判定」
    3. ピッチは**独立した節**として紙に出る（幅方向の節の中ではない）
    4. **文字は他の帳票項目と同じ大きさ**（`.rp-field`＝本文8.5px／ラベル8px）
    5. **図は全幅**——欄は図の横ではなく下（条の分割の図を最大化）
    6. **見切れない**——どちらの塊も中身が器からはみ出さない

   **見本のロットで見る**（§9.253）——幅方向の保存とピッチの両方を持つので、
   2つの塊が同時に紙へ出る唯一の材料。**宣言ではなく実測で見る**（§9.289）。
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
let b=null;
/* 候補の表は**ロールが1本も無いと出ない**ので、材料を自分で注ぎ込む（§9.291 ①）。
   見本のピッチは314.2mm＝径 100.01mm（ピッチ÷π）。 */
const TAG='RTrpdef';
const post=async(u,body)=>{
 const r=await fetch(B+u,{method:'POST',headers:{'Content-Type':'application/json'},
                         body:JSON.stringify(body)});
 let j={};try{j=await r.json()}catch(e){}
 return {code:r.status,...j};
};
const made=[];

(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'),
                          args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',String(e&&e.message||e).slice(0,140)));

 try{
  const seeded=await post('/api/roll-master',{user_id:'test',equipment:EQ,
    name:TAG+'A',contactFace:'上面',diaMax:100.01,diaMin:99.5,note:'検証用'});
  if(seeded.id)made.push(seeded.id);
  rec('候補の表の材料（ロール1本）を注ぎ込めた',!!seeded.id,JSON.stringify(seeded).slice(0,90));

  await page.addInitScript(eq=>{try{localStorage.setItem('AccessMeasurementConfiguredEquipment',eq)}catch(e){}},EQ);
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:20000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:10000});
  await page.waitForSelector('#masterMaintNav [data-master="reportBlock"]',{timeout:20000});
  await page.click('#masterMaintNav [data-master="reportBlock"]');
  await page.waitForSelector('#mmSampleView',{timeout:15000});
  await page.click('#mmSampleView');
  await page.waitForFunction(()=>document.body.classList.contains('rp-mode'),null,{timeout:20000});
  await page.waitForFunction(()=>{
   const c=document.getElementById('reportContent');return c&&c.textContent.length>500;
  },null,{timeout:20000});
  await page.waitForTimeout(1500);

  /* ---- 1. 塊が2つに分かれている ---- */
  const keys=await page.evaluate(()=>((WL.reportBlocks&&WL.reportBlocks.keys&&WL.reportBlocks.keys())||[]));
  rec('塊が2つに分かれている（異常位置判定 / ピッチ判定）',
      keys.indexOf('異常位置判定')>=0&&keys.indexOf('ピッチ判定')>=0,
      JSON.stringify(keys.filter(k=>/判定/.test(k))));

  /* ---- 2・3. 紙に2つの節として出る ---- */
  const heads=await page.evaluate(()=>{
   const blocks=[...document.querySelectorAll('#reportContent [data-rp-block]')];
   const of=k=>blocks.find(el=>el.dataset.rpBlock===k)||null;
   const pick=el=>{
    if(!el)return null;
    const sec=el.querySelector('.rp-section');
    return {題:(sec&&sec.querySelector('h3')||{}).textContent||'',
            節の数:el.querySelectorAll('.rp-section').length,
            中身:(el.textContent||'').replace(/\s+/g,' ').slice(0,50)};
   };
   return {幅:pick(of('異常位置判定')),ピッチ:pick(of('ピッチ判定')),
           全文:(document.getElementById('reportContent').textContent||'')};
  });
  rec('幅方向の塊が紙に出る',!!heads.幅,JSON.stringify(heads.幅));
  rec('題は「異常位置判定」（（参考）を付けない）',
      !!heads.幅&&heads.幅.題.trim()==='異常位置判定'&&!/異常位置判定（参考）/.test(heads.全文),
      heads.幅&&heads.幅.題);
  rec('ピッチが独立した塊として紙に出る',
      !!heads.ピッチ&&heads.ピッチ.題.trim()==='ピッチ判定',JSON.stringify(heads.ピッチ));
  rec('幅方向の塊にピッチを混ぜない（節を2つ入れない）',
      !!heads.幅&&heads.幅.節の数===1&&!/ピッチ判定/.test(heads.幅.中身),
      JSON.stringify(heads.幅));

  /* ---- 4. 文字が他の帳票項目と同じ大きさ ---- */
  const fs=await page.evaluate(()=>{
   const px=el=>el?parseFloat(getComputedStyle(el).fontSize):0;
   const q=s=>document.querySelector('#reportContent '+s);
   return {本文:px(q('.rp-field')),ラベル:px(q('.rp-field-label')),
           欄:px(q('.rp-defect-fact b')),欄ラベル:px(q('.rp-defect-fact span')),
           ピッチ答:px(q('.rp-defect-roll-answer')),
           ピッチ表:px(q('.rp-defect-roll-table td')),
           条:px(q('.rp-defect-lane-label')),目盛:px(q('.rp-defect-tick-label'))};
  });
  /* **「同じくらい」ではなく同じ**で見る（§9.289）。0.5px違うだけでも
     同じ紙の中に読める大きさが2通りできる——許容を広く取ると、8pxのままの
     実装が「同じくらい」で通ってしまう（実際に通った）。 */
  rec('欄の文字が他の帳票項目と同じ大きさ',
      fs.欄>0&&fs.欄===fs.本文&&fs.欄ラベル===fs.ラベル,JSON.stringify(fs));
  rec('ピッチの答え・表も本文並み（7.5px以下にしない）',
      fs.ピッチ答===fs.本文&&fs.ピッチ表>=fs.ラベル,JSON.stringify(fs));
  /* 条番号の札は**条が広いときだけ**出る（40条の見本には無い）。器の中へ
     1つ置いて、本物のカスケードで解かれた大きさを測る——材料が無いので
     自分で置く（§9.291 ①）。置いたものは必ず片付ける。 */
  const laneFs=await page.evaluate(()=>{
   const strip=document.querySelector('#reportContent .rp-defect-strip');
   if(!strip)return 0;
   const el=document.createElement('span');
   el.className='rp-defect-lane-label';el.textContent='1';
   strip.appendChild(el);
   const px=parseFloat(getComputedStyle(el).fontSize);
   el.remove();
   return px;
  });
  rec('図の中の文字も読める大きさ（条番号・目盛）',
      laneFs>=7.5&&fs.目盛>=7.5,JSON.stringify({条:laneFs,目盛:fs.目盛}));

  /* ---- 5. 図が全幅（欄は下） ---- */
  const wide=await page.evaluate(()=>{
   const blk=[...document.querySelectorAll('#reportContent [data-rp-block]')]
     .find(el=>el.dataset.rpBlock==='異常位置判定');
   if(!blk)return null;
   const body=blk.querySelector('.rp-defect-body');
   const fig=blk.querySelector('.rp-defect-figure');
   const facts=blk.querySelector('.rp-defect-facts');
   const r=el=>el?el.getBoundingClientRect():null;
   const rb=r(body),rf=r(fig),rt=r(facts);
   return {器:rb&&Math.round(rb.width),図:rf&&Math.round(rf.width),欄:rt&&Math.round(rt.width),
           欄は下:!!(rf&&rt&&rt.top>=rf.bottom-1)};
  });
  rec('図は節の幅いっぱい（右に欄を立てない）',
      !!wide&&wide.図>=wide.器-2,JSON.stringify(wide));
  rec('欄は図の下へ流す（横に並べない）',!!wide&&wide.欄は下===true,JSON.stringify(wide));

  /* ---- 6. 見切れない ---- */
  const cut=await page.evaluate(()=>{
   const out=[];
   ['異常位置判定','ピッチ判定'].forEach(k=>{
    const blk=[...document.querySelectorAll('#reportContent [data-rp-block]')]
      .find(el=>el.dataset.rpBlock===k);
    if(!blk)return;
    /* **器と中身の実寸で見る**（§9.289）。`overflow:hidden`なので、
       はみ出していても見た目は静かに切れるだけ。 */
    out.push({塊:k,器:Math.round(blk.clientHeight),中身:Math.round(blk.scrollHeight),
              横器:Math.round(blk.clientWidth),横中身:Math.round(blk.scrollWidth)});
   });
   return out;
  });
  const over=cut.filter(x=>x.中身>x.器+1||x.横中身>x.横器+1);
  rec('どちらの塊も器からはみ出さない（見切れない）',over.length===0,JSON.stringify(cut));

  /* 表も横に切れないこと（ロール名が長いと固定割りでないと潰れる）。 */
  const table=await page.evaluate(()=>{
   const t=document.querySelector('#reportContent .rp-defect-roll-table');
   if(!t)return null;
   const cells=[...t.querySelectorAll('td')];
   return {割り:getComputedStyle(t).tableLayout,
           列:t.querySelectorAll('colgroup col').length,
           切れ:cells.filter(c=>c.scrollWidth>c.clientWidth+1).length};
  });
  rec('候補の表は固定割りで、セルが横に切れない',
      !!table&&table.割り==='fixed'&&table.列===5&&table.切れ===0,JSON.stringify(table));

  /* ---- 7. 旧「長手:なし」を引き継ぐ（§9.319-C／§9.132） ----
     §9.305 ②-2の印を読む人はもう居ない。**わざわざ「出さない」を選んだ紙が、
     版を上げただけで黙って1枚増える**のを防ぐ。ここは「印が在ること」では
     なく**紙にピッチの塊が出ないこと**で見る（§9.289）。 */
  const T='report:'+EQ;
  const reopen=async()=>{
   await page.evaluate(eq=>WL.reportSample.open({equipment:eq,returnTo:'layout'}),EQ);
   await page.waitForFunction(()=>{
    const c=document.getElementById('reportContent');return c&&c.textContent.length>500;
   },null,{timeout:20000});
   await page.waitForTimeout(1200);
   return page.evaluate(()=>[...document.querySelectorAll('#reportContent [data-rp-block]')]
     .map(e=>e.dataset.rpBlock));
  };
  await page.evaluate(async t=>{
   await WL.columnLayout.save(t,{formats:{'異常位置判定':
     {kind:'',pattern:'長手:なし',decimals:null,thousands:false,prefix:'',suffix:''}}});
  },T);
  const old=await reopen();
  rec('旧「長手:なし」の紙では、ピッチ判定を出さない',
      old.indexOf('ピッチ判定')<0&&old.indexOf('異常位置判定')>=0,
      JSON.stringify(old.filter(k=>/判定/.test(k))));

  /* 「出す」を押したら旧い印は捨てる——捨てないと押しても戻る（§4）。 */
  await page.evaluate(async eq=>{await WL.reportLayout.setShown(eq,'ピッチ判定',true)},EQ);
  const back=await reopen();
  const tok=await page.evaluate(t=>{
   const f=WL.columnLayout.format(t,'異常位置判定');return (f&&f.pattern)||'';
  },T);
  rec('「出す」を押せば出る（旧い印に押し戻されない）',
      back.indexOf('ピッチ判定')>=0,JSON.stringify(back.filter(k=>/判定/.test(k))));
  rec('押した時点で旧い印そのものを捨てる',!/長手:/.test(tok),JSON.stringify(tok));
  /* 後片付け（§9.121）。この設備の配置は他の網も見る。 */
  await page.evaluate(async eq=>{await WL.reportLayout.reset(eq)},EQ);

 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }

 await b.close();
 /* 後片付け（§9.121）。ロールマスタは実行をまたいで残る。 */
 for(const id of made){try{await post('/api/roll-master/delete',{user_id:'test',id})}catch(e){}}
 try{
  const r=await fetch(B+'/api/roll-master');const j=await r.json();
  for(const x of (j.items||[]).filter(y=>String(y.name||'').startsWith(TAG))){
   try{await post('/api/roll-master/delete',{user_id:'test',id:x.id})}catch(e){}
  }
 }catch(e){}
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
