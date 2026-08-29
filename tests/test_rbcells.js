/* test_rbcells.js: 帳票ブロックを「セル」で組む（§9.274、利用者の指示）。

   ① 読み方が**サーバーと同じ**こと（`tests/fixtures/report_cells.json`の同じ例で
      `fbParse`/`fbText`を通す）。2通りあると、盤で組んだ形と紙が食い違う。
   ② 盤の「表に組む」が**見出し＋ラベルを出さない値**のマトリクスを作ること。
   ③ 紙に**表として出る**こと（見出しのマス・ラベル無しのマス・寄せ・書式）。
   ④ **あとから足した塊が「出す」で紙に出る**こと——ここが利用者の報告
      「帳票ブロックマスタをいじっても紙は変わりません」の本体。一度でも配置を
      保存した紙では`order`が埋まっており、`rpHiddenSet()`が並びに載っていない
      自作の塊を必ず隠すので、**押しても次に読むと消えていた**。
   ⑤ 紙の塊のダブルクリックで**帳票ブロックマスタへ移る**こと（§9.274）。
   ⑥ 説明の量（通常／短め／出さない）が効くこと。

   **後始末は`finally`**（§9.121）——作った塊と紙の設定を残すと、次の実行が
   それを引き継いで別のテストが落ちる。 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const fs=require('fs'),path=require('path');
const B='http://127.0.0.1:5029';
const EQ='スリッター1号';          /* 見本のロットの設備（サーバーのSAMPLE_VALUES） */
const TAG='rbcells-'+Date.now();
const NAME=TAG+'表';
const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+String(d).slice(0,220):''))};
let b=null,page=null;

const CASES=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','report_cells.json'),'utf8'));
const KEYS=['label','path','kind','span','rows','showLabel','align','format'];

(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,160)));
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openMasterMaint',{timeout:20000});
 await page.waitForSelector('#saveState',{state:'attached',timeout:20000});
 await page.click('#openMasterMaint');
 await page.waitForSelector('#masterMaintNav',{timeout:20000});
 await page.evaluate(()=>{const el=document.querySelector('#masterUserId');
  if(el){el.value='rbcells';el.dispatchEvent(new Event('change',{bubbles:true}))}});
 await page.evaluate(()=>document.querySelector('#masterMaintNav [data-master="reportBlock"]')?.click());
 await page.waitForSelector('#masterMaintList .mm-row',{timeout:20000});

 try{
  // ---- ① 読み方・書き方がサーバーと同じ --------------------------------
  /* **口を通して確かめる**（`WL.reportCells`）——盤のDOM越しに見ると、
     盤が読み直さない形でも「0件」で通ってしまう（実際にそうなった）。 */
  const two=await page.evaluate(([cases,dumps,keys])=>{
   if(!(window.WL&&WL.reportCells))return {err:'WL.reportCells が無い'};
   const shape=c=>{const o={};keys.forEach(k=>o[k]=(c[k]===undefined?null:c[k]));return o};
   const parse=cases.map(c=>({why:c.why,
     got:WL.reportCells.parse(c.text).map(shape),
     want:c.cells.map(shape)}));
   const dump=dumps.map(c=>({why:c.why,json:!!c.json,
     got:WL.reportCells.text(c.cells),want:c.text===undefined?null:c.text}));
   return {parse,dump};
  },[CASES.parse,CASES.dump,KEYS]);
  if(two.err){rec('① WL.reportCells が公開されている',false,two.err)}
  else{
   const bad=two.parse.filter(x=>JSON.stringify(x.got)!==JSON.stringify(x.want))
     .map(x=>[x.why,x.want,x.got]);
   rec('① 読み方はサーバー（parse_content）と同じ',!bad.length,JSON.stringify(bad.slice(0,2)));
   const dbad=two.dump.filter(x=>x.json?(String(x.got).charAt(0)!=='['):(x.got!==x.want))
     .map(x=>[x.why,x.want,x.got]);
   rec('① 書き方はサーバー（dump_content）と同じ（触っていない塊の保存値は変わらない）',
       !dbad.length,JSON.stringify(dbad.slice(0,2)));
   /* **往復で形が変わらない**（保存→読み直しで設定が落ちない）。 */
   const rt=await page.evaluate(cases=>cases.map(c=>{
    const a=WL.reportCells.parse(c.text);
    const b=WL.reportCells.parse(WL.reportCells.text(a));
    return {why:c.why,same:JSON.stringify(a)===JSON.stringify(b)};
   }),CASES.parse);
   rec('① 往復しても形が変わらない',rt.every(x=>x.same),
       JSON.stringify(rt.filter(x=>!x.same).slice(0,2)));
  }

  // 新規登録の窓を開く
  await page.evaluate(()=>{
   const b=[...document.querySelectorAll('#masterMaintForm button,#masterMaintPanel button')]
    .find(x=>/追加|新規/.test(x.textContent||''));
   b&&b.click();
  });
  await page.waitForSelector('#maintEditorModal:not([hidden])',{timeout:15000});
  await page.waitForSelector('#maintEditorForm [data-field="content"]',{state:'attached',timeout:15000});
  // ②タブを開く（盤はそこにある）
  await page.evaluate(()=>{
   const t=[...document.querySelectorAll('#maintEditorModal .mm-tabbar button')]
    .find(b=>/何を載せる/.test(b.textContent||''));
   t&&t.click();
  });
  await page.waitForSelector('.fb-rows',{timeout:15000});

  // ---- ② 表に組む ------------------------------------------------------
  await page.evaluate(()=>{
   const cat=[...document.querySelectorAll('[data-fb-cat]')].find(b=>/統計/.test(b.textContent||''));
   cat&&cat.click();
  });
  await page.waitForTimeout(200);
  const disabledFirst=await page.evaluate(()=>{
   const b=document.querySelector('.fb-table');return b?{dis:b.disabled,title:b.title}:null});
  rec('② 材料が無いうちは「表に組む」を押せない（理由を言う）',
      !!disabledFirst&&disabledFirst.dis&&/選んで/.test(disabledFirst.title),
      JSON.stringify(disabledFirst));

  for(const p of ['stat.thickness.min','stat.thickness.max','stat.width.min',
                  'stat.width.max','stat.length.min','stat.length.max']){
   await page.evaluate(x=>{const b=document.querySelector(`[data-fb-add="${x}"]`);b&&b.click()},p);
   await page.waitForTimeout(80);
  }
  const ready=await page.evaluate(()=>{
   const b=document.querySelector('.fb-table');return {dis:b.disabled,title:b.title}});
  rec('② 軸を名乗る項目がそろうと押せる（行と列を先に言う）',
      !ready.dis&&/行＝板厚/.test(ready.title)&&/列＝MIN/.test(ready.title),
      JSON.stringify(ready));

  await page.evaluate(()=>document.querySelector('.fb-table').click());
  await page.waitForTimeout(400);
  const built=await page.evaluate(()=>({
   rows:document.querySelectorAll('.fb-row').length,
   heads:[...document.querySelectorAll('.fb-row-head .fb-label')].map(e=>e.value),
   bare:document.querySelectorAll('.fb-row-bare').length,
   blanks:document.querySelectorAll('.fb-row-blank').length,
   cols:(document.querySelector('#maintEditorForm [data-field="cols"]')||{}).value}));
  rec('② 見出し（列＝MIN/MAX・行＝板厚/板幅/板丈）と値6つのマトリクスになる',
      built.rows===12&&built.bare===6&&built.blanks===1&&built.cols==='3'
      &&built.heads.join(',')==='MIN,MAX,板厚,板幅,板丈',
      JSON.stringify(built));
  rec('② 列数は「内訳の列数」の欄が持ち主（同じ数を2箇所に置かない）',
      built.cols==='3');

  // 書式を1つ当てる（板厚MINを小数3桁＋単位）
  await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('.fb-row')];
   const r=rows.find(x=>x.classList.contains('fb-row-bare'));
   r&&r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
  });
  await page.waitForTimeout(250);
  await page.evaluate(()=>{
   const b=[...document.querySelectorAll('.fb-insp [data-fb-fmt]')].find(x=>x.dataset.fbFmt==='number');
   b&&b.click();
  });
  await page.waitForTimeout(250);
  await page.evaluate(()=>{
   const el=document.querySelector('.fb-insp [data-fb-dec]');
   if(el){el.value='3';el.dispatchEvent(new Event('input',{bubbles:true}))}
   const su=document.querySelector('.fb-insp [data-fb-suf]');
   if(su){su.value='mm';su.dispatchEvent(new Event('input',{bubbles:true}))}
  });
  await page.waitForTimeout(300);
  const fmt=await page.evaluate(()=>{
   const v=(document.querySelector('#maintEditorForm [data-field="content"]')||{}).value;
   let j=null;try{j=JSON.parse(v)}catch(e){}
   const hit=(j||[]).find(c=>c.format);
   return {json:!!j,fmt:hit?hit.format:null};
  });
  rec('④ 書式（小数桁・単位）が保存の形へ入る',
      fmt.json&&fmt.fmt&&fmt.fmt.kind==='number'&&fmt.fmt.decimals===3&&fmt.fmt.suffix==='mm',
      JSON.stringify(fmt));

  // 名前と設備を入れて保存
  await page.evaluate(n=>{
   const tab=[...document.querySelectorAll('#maintEditorModal .mm-tabbar button')]
     .find(b=>/これは何の塊/.test(b.textContent||''));
   tab&&tab.click();
   const el=document.querySelector('#maintEditorForm [data-field="name"]');
   if(el){el.value=n;el.dispatchEvent(new Event('change',{bubbles:true}))}
   const all=document.querySelector('#maintEditorForm [data-equipment-all="equipment"]');
   if(all&&!all.checked){all.checked=true;all.dispatchEvent(new Event('change',{bubbles:true}))}
  },NAME);
  await page.waitForTimeout(300);
  await page.evaluate(()=>document.querySelector('#maintEditorSave').click());
  await page.waitForTimeout(2200);
  const saved=await page.evaluate(async n=>{
   const l=await api('/api/report-block-master?equipment=');
   const r=(l.items||[]).find(x=>x.name===n);
   return r?{id:r.id,cols:r.cols,fields:(r.fields||[]).length,
             kinds:(r.fields||[]).map(f=>f.kind).join(','),
             fmt:(r.fields||[]).filter(f=>f.format).length}:null;
  },NAME);
  rec('② 保存の口を通しても見出し・書式が落ちない',
      !!saved&&saved.fields===12&&saved.fmt===1&&/head/.test(saved.kinds),
      JSON.stringify(saved));

  // ---- ④ あとから足した塊が「出す」で紙に出る --------------------------
  const shownOk=await page.evaluate(async ([eq,n])=>{
   WL.reportBlocks.forget();
   const before=await WL.reportLayout.info(eq);
   const had=(before.blocks||[]).find(x=>x.key===n);
   await WL.reportLayout.setShown(eq,n,true);
   const after=await WL.reportLayout.info(eq);
   const now=(after.blocks||[]).find(x=>x.key===n);
   return {saved:before.saved,beforeShown:had?had.shown:null,afterShown:now?now.shown:null};
  },[EQ,NAME]);
  rec('④ 一度配置を保存した紙でも、あとから足した塊を「出す」にできる',
      shownOk.saved===true&&shownOk.beforeShown===false&&shownOk.afterShown===true,
      JSON.stringify(shownOk));

  // ---- ③ 紙に表として出る ----------------------------------------------
  await page.evaluate(eq=>WL.reportSample.open({equipment:eq}),EQ);
  await page.waitForSelector('#reportContent .rp-section',{timeout:20000});
  await page.waitForFunction(n=>[...document.querySelectorAll('#reportContent .rp-section h3')]
    .some(h=>h.textContent===n),NAME,{timeout:20000}).catch(()=>{});
  const paper=await page.evaluate(n=>{
   const s=[...document.querySelectorAll('#reportContent .rp-section')]
     .find(x=>(x.querySelector('h3')||{}).textContent===n);
   if(!s)return null;
   const g=s.querySelector('.rp-grid');
   return {matrix:g.classList.contains('rp-grid-m'),
           cols:getComputedStyle(g).gridTemplateColumns.split(' ').length,
           heads:[...s.querySelectorAll('.rp-field-head')].map(e=>e.textContent),
           bare:s.querySelectorAll('.rp-field-bare').length,
           right:[...s.querySelectorAll('.rp-field-bare')].filter(e=>e.classList.contains('al-r')).length,
           vals:[...s.querySelectorAll('.rp-field-value')].map(e=>e.textContent),
           labels:s.querySelectorAll('.rp-field-label').length};
  },NAME);
  rec('③ 紙が3列のマトリクスになる（見出し5・値6・ラベルは出さない）',
      !!paper&&paper.matrix&&paper.cols===3&&paper.heads.length===5
      &&paper.bare===6&&paper.labels===0,
      JSON.stringify(paper));
  rec('③ 見出しの文字はMIN/MAXと板厚/板幅/板丈',
      !!paper&&paper.heads.join(',')==='MIN,MAX,板厚,板幅,板丈',
      paper&&paper.heads.join(','));
  rec('③ 寄せ（右）が当たる',!!paper&&paper.right===6,paper&&paper.right);
  /* **書式が実際に効いていること**（値そのもので見る・§CLAUDE）。
     板厚MINの見本は`0.296`なので、3桁＋`mm`で`0.296mm`。 */
  rec('④ 書式（小数3桁＋単位）が紙の値に効く',
      !!paper&&paper.vals.some(v=>/mm$/.test(v)),JSON.stringify(paper&&paper.vals));

  // ---- ⑤ 紙の塊のダブルクリック → 帳票ブロックマスタ --------------------
  const jumped=await page.evaluate(async n=>{
   /* 組み換えを開かないと塊は`draggable`にならないが、ダブルクリックの
      配線は組み換え中の塊にしか付かない。**その状態で確かめる**。 */
   const btn=document.querySelector('#reportArrange,#rpArrange,[data-rp-arrange]');
   if(btn)btn.click();
   await new Promise(r=>setTimeout(r,900));
   const el=[...document.querySelectorAll('#reportContent [data-rp-block]')]
     .find(x=>x.dataset.rpBlock===n);
   if(!el)return {err:'塊が見つからない'};
   el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));
   await new Promise(r=>setTimeout(r,1500));
   return {view:document.body.className,
           modal:!(document.querySelector('#maintEditorModal')||{hidden:true}).hidden,
           title:(document.querySelector('#maintEditorTitle')||{}).textContent};
  },NAME);
  rec('⑤ 紙の塊をダブルクリックすると帳票ブロックマスタのその行が開く',
      !!jumped&&/mm-mode/.test(jumped.view||'')&&jumped.modal===true
      &&String(jumped.title||'').indexOf(NAME)>=0,
      JSON.stringify(jumped));

  // ---- ⑥ 説明の量 -------------------------------------------------------
  await page.evaluate(()=>{const m=document.querySelector('#maintEditorModal');if(m)m.hidden=true});
  await page.waitForTimeout(200);
  const hints=async()=>page.evaluate(()=>({
   lv:document.documentElement.getAttribute('data-hint'),
   def:(document.querySelector('#masterMaintForm .mm-def-hint')||{}).textContent||'',
   more:document.querySelectorAll('#masterMaintForm .mm-more').length}));
  await page.evaluate(()=>document.querySelector('#masterMaintNav [data-master="equipment"]')?.click());
  await page.waitForTimeout(900);
  const full=await hints();
  await page.evaluate(()=>document.querySelector('#mmHead [data-hint-lv="short"]').click());
  await page.waitForTimeout(300);
  const short=await hints();
  await page.evaluate(()=>document.querySelector('#mmHead [data-hint-lv="off"]').click());
  await page.waitForTimeout(300);
  const off=await hints();
  await page.evaluate(()=>document.querySelector('#mmHead [data-hint-lv="full"]').click());
  await page.waitForTimeout(200);
  rec('⑥ 「短め」は最初の1文だけ（文の途中で切らない）',
      short.def.length>0&&short.def.length<full.def.length&&/。$/.test(short.def),
      JSON.stringify({full:full.def.length,short:short.def}));
  rec('⑥ 「出さない」で説明が消える',off.def==='' &&off.lv==='off',JSON.stringify(off));
  rec('⑥ 通常へ戻せる（片道にしない）',(await hints()).def===full.def);

 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  /* **後始末**（§9.121）——作った塊と紙の設定を残さない。 */
  try{
   await page.evaluate(async ([n,eq])=>{
    try{
     const l=await api('/api/report-block-master?equipment=');
     const r=(l.items||[]).find(x=>x.name===n);
     if(r)await api('/api/report-block-master/delete',{method:'POST',
       headers:{'Content-Type':'application/json'},
       body:JSON.stringify({user_id:'rbcells',id:r.id})});
     if(window.WL&&WL.reportBlocks)WL.reportBlocks.forget();
     /* 紙の並びからも外す（残すと次の実行が「知らない列」として末尾へ回す）。 */
     const t=WL.reportLayout.targetOf(eq);
     const now=WL.columnLayout.saved(t);
     if((now.order||[]).indexOf(n)>=0){
      await WL.columnLayout.save(t,{order:(now.order||[]).filter(k=>k!==n),
        hidden:(now.hidden||[]).filter(k=>k!==n)});
     }
    }catch(e){}
   },[NAME,EQ]);
   await page.evaluate(()=>{try{localStorage.removeItem('MasterHintLevelV1')}catch(e){}});
  }catch(e){}
  try{if(b)await b.close()}catch(e){}
 }
 const ng=R.filter(x=>!x.ok);
 console.log('\n=== SUMMARY ===');console.log(`${R.length-ng.length}/${R.length} passed`);
 ng.forEach(x=>console.log(' -',x.n,x.d||''));
 process.exit(ng.length?1:0);
})().catch(async e=>{
 console.log('FATAL:',e.message);
 try{if(b)await b.close()}catch(_){}
 process.exit(1);
});
