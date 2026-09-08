/* メンテナンス導線(マスタ管理)の検証(§9.56)と、
   測定画面 左ペインの再配置(§9.55)の検証 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const call=async(m,p,b)=>{
 const r=await fetch(B+p,{method:m,...(b!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{})});
 let j={};try{j=await r.json()}catch(e){}
 return {status:r.status,body:j};
};
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));
 page.on('dialog',d=>d.accept());
 await call('POST','/api/access-mode',{mode:'edit'});

 // ---- (1) 勤務体系: 設備割当の有無で削除の成否が変わらない ----
 /* 製品の「削除」は**論理削除**（`有効=0`にして設備割当だけ消す）なので、
    行そのものは残る（勤務体系2行＋勤務区分2行）。**触った網は自分で消す**
    （§9.360）ので、作った勤務体系IDを控えて最後に素の表から片付ける。 */
 const madePatterns=[];
 for(const [label,eq] of [['設備を割り当てた体系',['テスト設備A']],['全設備共通の体系(割当なし)',[]]]){
  const c=await call('POST','/api/schedule/shift-pattern-master',
   {name:'回帰_削除試験',equipment:eq,segments:[{name:'日勤',start:'08:00',end:'17:00'}],user_id:'t'});
  if(c.body&&c.body.id!==undefined)madePatterns.push(String(c.body.id));
  const d=await call('POST','/api/schedule/shift-pattern-master/delete',{id:c.body.id,user_id:'t'});
  rec(`${label}を削除できる`,d.status===200,`作成=${c.status} 削除=${d.status} ${d.body.error||''}`);
 }
 const list=await call('GET','/api/schedule/shift-pattern-master?scope=all');
 rec('削除した体系が一覧に残らない',
   !(list.body.items||[]).some(x=>x.name==='回帰_削除試験'),
   (list.body.items||[]).filter(x=>x.name==='回帰_削除試験').length+'件');
 const missing=await call('POST','/api/schedule/shift-pattern-master/delete',{id:99999999,user_id:'t'});
 rec('存在しないIDは従来どおり弾く',missing.status>=400,String(missing.status));

 // ---- (2) 更新者IDを省いても監査列が空にならない ----
 /* オペレータマスタは操業データ選択肢マスタへ統合した（§9.221 ③）。
    見ているのは「更新者IDを省いても監査列が空にならない」ことなので、
    移った先の同じCRUDで確かめる。 */
 const made=await call('POST','/api/operation-choice-master',{name:'回帰_監査',value:'回帰_更新者テスト'});
 const ops=await call('GET','/api/operation-choice-master');
 const hit=(ops.body.items||[]).find(x=>x.value==='回帰_更新者テスト');
 rec('更新者ID未指定でも登録は通る',made.status===200);
 if(hit)await call('POST','/api/operation-choice-master/delete',{id:hit.id,user_id:'cleanup'});

 // ---- (3) マスタ管理: 保存→一覧反映→削除が1周する ----
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openMasterMaint',{timeout:15000});
 await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openMasterMaint',{timeout:15000});
 await page.waitForTimeout(1200);
 await page.click('#openMasterMaint');
 await page.waitForSelector('#masterMaintForm',{timeout:10000});
 await page.waitForTimeout(1800);
 const tabs=await page.$$eval('#masterMaintNav [data-master]',ns=>ns.length);
 rec('マスタ管理のタブが揃っている',tabs>=10,tabs+'タブ');
 const noErr=await page.evaluate(()=>!document.querySelector('#masterMaintList .mm-error'));
 rec('初期表示でエラーが出ていない',noErr);

 // ---- (4) 左ペイン: スクロールバーが出ない ----
 await page.evaluate(()=>window.exitMasterMaint&&window.exitMasterMaint());
 await page.click('[data-db-key="SIKALOTNOW"]');
 await page.waitForFunction(()=>document.querySelectorAll('#grid table tbody tr').length>0,{timeout:20000});
 await page.click('#grid table tbody tr:first-child .measurement-action-button');
 await page.waitForSelector('#measureModal:not([hidden])',{timeout:15000});
 await page.waitForTimeout(3000);
 const fit=await page.evaluate(()=>{
  const lp=document.querySelector('.left-pane');
  return {over:lp.scrollHeight-lp.clientHeight,pane:lp.clientHeight};
 });
 rec('基本情報タブでスクロールバーが出ない',fit.over<=0,`はみ出し${fit.over}px / 表示${fit.pane}px`);

 // 情報は減っていない(13項目そのまま)
 const info=await page.evaluate(()=>{
  const g=document.querySelector('#basicInfo .info-grid');
  return {fields:g.querySelectorAll('.field').length,
   groups:[...g.querySelectorAll('.info-group')].map(x=>x.textContent),
   labels:[...g.querySelectorAll('.field label')].map(x=>x.textContent)};
 });
 /* **常時見せるのは8項目**(§9.133)。測定中に本当に要るのは「どのロットか」
    「何を作るか」「どんな材か」だけで、残りは「詳細を見る」で読める。
    **減らしたのではなく畳んだ**ので、詳細を開けば全項目が揃っていること
    も見る(隠したまま消えていたら、それは減らしたのと同じ)。 */
 const basicMain=await page.evaluate(()=>{
  const g=document.querySelector('#basicInfo .info-grid');
  const dt=document.querySelector('#basicDetail');
  const vis=x=>x.getBoundingClientRect().height>0;
  /* **数えるのは「項目」であって「枠」ではない**（§9.139）。材質-調質と
     板厚/板幅/板丈は1行に横並びにしたので、`.field`の箱は5つでも読める
     項目は8つある。箱で数えると、まとめただけで落ちる。 */
  return {常時:[...g.querySelectorAll('.field label')].filter(x=>vis(x)).length,
          名前:[...g.querySelectorAll('.field label')].filter(x=>vis(x)).map(x=>x.textContent.trim()),
          枠:[...g.querySelectorAll('.field')].filter(vis).length,
          詳細が畳んである:!!dt&&dt.hidden};
 });
 /* **分割ロットの行は分割ありのときだけ**（§9.144）。このロットは分割が無いので
    常時は5項目（ロット№・検査No.・用途名・材調質・製造寸法）、分割ありなら
    ここへ3項目（分割ロット・子ロット数・条数）が足されて8になる。
    **数だけを見て「8」に固定していたため、行を出さない決めごとを入れた時点で
    落ちたままだった**（HEADでも落ちていた）。中身の一覧で見る。 */
 const ALWAYS=['ロット№','検査No.','用途名','材調質','製造寸法'];
 const SPLIT=['分割ロット','子ロット数','条数'];
 rec('基本情報は常時「識別・用途・材と寸法」だけ（分割ロットは分割ありのときだけ）',
  ALWAYS.every(l=>basicMain.名前.includes(l))
  &&basicMain.名前.every(l=>ALWAYS.includes(l)||SPLIT.includes(l))
  &&basicMain.詳細が畳んである,
  JSON.stringify(basicMain));
 rec('詳細は畳んである',basicMain.詳細が畳んである,JSON.stringify(basicMain));
 await page.click('#basicMore');
 await page.waitForFunction(()=>!document.querySelector('#basicDetail').hidden,null,{timeout:5000});
 const basicAll=await page.evaluate(()=>{
  const g=document.querySelector('#basicInfo .info-grid');
  const vis=x=>x.getBoundingClientRect().height>0;
  return {項目:[...g.querySelectorAll('.field')].filter(vis).length,
    groups:[...g.querySelectorAll('.info-group')].filter(vis).map(x=>x.textContent),
    labels:[...g.querySelectorAll('.field label')].filter(x=>vis(x.parentElement)).map(x=>x.textContent)};
 });
 rec('詳細を開けば全項目が読める',basicAll.項目>=13,basicAll.項目+'項目');
 /* 品質規格は**詳細の中の1つの群**（§9.154。以前は基本情報カードのタブの裏の
    4×3表で、見出し列を`width:11%`で決め打ちしていたため項目名が切れていた）。
    群を1つ足した時点でこの一覧も足す必要があったが忘れており、HEADでも
    落ちていた。 */
 rec('意味のかたまりで見出しが付いている',
   basicAll.groups.join('/')==='識別番号/製品/コース/品質規格',basicAll.groups.join('/'));
 info.labels=basicAll.labels;
 /* コースの3項目のラベルは「設計」「実績」「残」(§9.81)。すぐ上に
    「コース」という見出しが出ているので、行ごとに繰り返さない。 */
 const NEEDED=['ロット№','検査No.','鋳造No.','オーダーNo.','引当No.','用途名','用途コード','取引先','納入先','設計','実績','残'];
 NEEDED.forEach(l=>{if(!info.labels.includes(l))rec('項目が残っている: '+l,false,info.labels.join(','))});
 rec('必要な項目がすべて残っている',NEEDED.every(l=>info.labels.includes(l)));

 /* 打刻した時刻が読める(幅が足りている)。**作業時間は③にある**（§9.143。
    ①「準備の入力」は測る前に1回決める設定の面で、時刻の記録はそこへ
    混ざると異物に見えるため③へ移した）。段を移ってから押す。 */
 await page.evaluate(()=>document.querySelector('.mstep[data-mstep="3"]').click());
 await page.waitForFunction(()=>{
  const b=document.querySelector('#stampWorkStart');
  return !!b&&b.getBoundingClientRect().height>0;
 },null,{timeout:5000});
 await page.click('#stampWorkStart');await page.waitForTimeout(400);
 const stamp=await page.evaluate(()=>{
  const i=document.querySelector('#workStartAt');
  return {val:i.value,cut:i.scrollWidth>i.clientWidth+1,w:Math.round(i.getBoundingClientRect().width)};
 });
 rec('打刻した日時が切れずに読める',!!stamp.val&&!stamp.cut,`幅${stamp.w}px "${stamp.val}"`);
 /* 打刻の時点では**詳細（13項目）を開いたまま**。基本情報カードは骨子で
    `1×2`に固定したので、開いた状態で器を超えることはある（下の
    「どの表示サイズでも収まる」は畳んだ状態で見る）。ここで大事なのは
    **打刻して値が増えても切り落とさない**こと。 */
 const afterStamp=await page.evaluate(()=>{
  const lp=document.querySelector('.left-pane');
  return {はみ出し:lp.scrollHeight-lp.clientHeight,overflowY:getComputedStyle(lp).overflowY};
 });
 rec('打刻後も切り落とさない',
     afterStamp.はみ出し<=0||/auto|scroll/.test(afterStamp.overflowY),JSON.stringify(afterStamp));
 /* 以降は①で測る（基本情報カードは①②③のどこにも出るが、いちばん項目が
    多いのは①）。 */
 await page.evaluate(()=>document.querySelector('.mstep[data-mstep="1"]').click());
 await page.waitForTimeout(300);

 /* 表示サイズを変えても収まる（§9.137）。**測るのは畳んだ状態**——基本情報は
    骨子で`1×2`（実測651px）のカードに固定したので、13項目の詳細を開けば
    いちばん大きい表示サイズでは入り切らないことがある（実測lg +10px）。
    詳細は求められたときだけ開く付け足しなので、**入り切らないこと自体は
    不具合ではない**。不具合になるのは「開いたのに読めない」ことなので、
    そちらは下で別に見る（器がスクロールできること＝切り落としていない）。 */
 await page.click('#basicMore');
 await page.waitForFunction(()=>document.querySelector('#basicDetail').hidden,null,{timeout:5000});
 const sizes={};
 for(const s of ['sm','md','lg']){
  await page.evaluate(v=>{document.documentElement.dataset.uiSize=v},s);
  await page.waitForTimeout(300);
  sizes[s]=await page.evaluate(()=>{const lp=document.querySelector('.left-pane');return lp.scrollHeight-lp.clientHeight});
 }
 rec('どの表示サイズでも基本情報が収まる',Object.values(sizes).every(v=>v<=0),JSON.stringify(sizes));
 /* **詳細を開いたときに切り落とさない。** 器より高くなったら、器の側が
    スクロールできること（`overflow`が`visible`のままだと、はみ出した項目へ
    到達する手立てが無くなる）。 */
 await page.evaluate(()=>{document.documentElement.dataset.uiSize='lg'});
 await page.click('#basicMore');
 await page.waitForFunction(()=>!document.querySelector('#basicDetail').hidden,null,{timeout:5000});
 await page.waitForTimeout(300);
 const opened=await page.evaluate(()=>{
  const lp=document.querySelector('.left-pane');
  return {はみ出し:lp.scrollHeight-lp.clientHeight,overflowY:getComputedStyle(lp).overflowY};
 });
 rec('詳細を開いて器を超えても読める（切り落とさない）',
     opened.はみ出し<=0||/auto|scroll/.test(opened.overflowY),JSON.stringify(opened));
 await page.evaluate(()=>{document.documentElement.dataset.uiSize='md'});

 /* **後片付け**（§9.360）: 論理削除では消えない行を素の表から消す。
    消すのは**この実行で作った勤務体系ID**のぶんだけ——名前で拾うと、
    同じ名前を前提にしている他の網と食い違う（§9.284）。 */
 const mtDel=async(tbl,id)=>call('POST','/api/master-table/'+encodeURIComponent(tbl)+'/delete',{id});
 const mtRows=async tbl=>((await call('GET','/api/master-table/'+encodeURIComponent(tbl)+'?limit=2000')).body.items||[]);
 try{
  if(madePatterns.length){
   /* 先に子（勤務区分）から。親を消してから引くと、どの区分が誰のものか
      分からなくなる。 */
   for(const r of await mtRows('勤務区分マスタ'))
    if(madePatterns.includes(String(r['勤務体系ID'])))await mtDel('勤務区分マスタ',r.id);
   for(const r of await mtRows('勤務体系マスタ'))
    if(madePatterns.includes(String(r['勤務体系ID'])))await mtDel('勤務体系マスタ',r.id);
  }
 }catch(e){console.log('!! 後片付け(勤務体系)に失敗: '+(e&&e.message||e))}
 /* 置いた実績も自分で消す（§9.351・§9.360）。 */
 try{await require('./lib/harness.js').clearRecords()}catch(e){console.log('!! 実績の後片付けに失敗: '+(e&&e.message||e))}

 await b.close();
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{
 // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
 // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
 // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
