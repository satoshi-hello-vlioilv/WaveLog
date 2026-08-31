/* test_filterio.js: 登録フィルタの持ち出し・取り込み（§9.171）
   ============================================================
   利用者の指示は「全てまたは各一覧単位でフィルタ機能の部分だけ、
   エクスポートインポートできる機能」。

   ここで固定すること:
    1. **一覧ごとに選べる。** 既定は「いま開いている一覧」だけ。全部出したい
       ときはひと押しで全部にできる（Hick: 既定は狭く、広げるのは1操作）。
    2. **今の一覧以外も出せる。** 一覧のモーダルが読むのは今の一覧ぶんだけ
       なので、書き出しは全モードぶん数え直す。
    3. **印は名前で運ぶ。** プリセットIDはマスタの連番で、別のPCへ持って
       行くと必ず食い違う（IDで運ぶと別の条件に鍵が付く）。
    4. **統計は運ばない。** 使用回数・最終使用日時は端末ごとの記録。
    5. **取り込む前に中身が分かる。** 何件・どの一覧・新規か同名か。
       この端末に無いデータの一覧はそう書く（入れても出てこないので）。
    6. **同名の扱いを選べる。** 「そのままにする」を選んだら上書きしない。
    7. **壊れたファイルは断る。** 何を選べばよいかまで書く。

   後片付けは finally で必ず行う（このテストが作った登録だけを消す。
   名前に実行ごとの印を入れて、他のテストの登録を巻き込まない）。
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const TAG='io'+Date.now().toString(36);          // 実行ごとに一意
/* 登録フィルタは**人のもの**になった(§9.172)ので、画面と同じ利用者IDで作る
   ——サーバー側の user_id だけで作ると「別の人の登録」になり、画面には出ない。 */
const USER='u-'+TAG;
const DB='SIKALOTNOW',TBL='仕掛';
const OTHER_DB='SIKALOTDEF',OTHER_TBL='品質';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 const post=(p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-filterio'},a.b))});
  let j={};try{j=await r.json()}catch(e){}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 const listPresets=mode=>page.evaluate(async a=>{
  const r=await fetch('/api/filter-presets?mode='+encodeURIComponent(a.m)+'&user='+encodeURIComponent(a.u));
  return (await r.json()).items||[];
 },{m:mode||'',u:USER});
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const openIo=async kind=>{
  await page.click(kind==='export'?'#exportFilterPresets':'#importFilterPresets');
  await page.waitForSelector('#filterIoRun',{timeout:10000});
  await settle();
 };
 const fs=require('fs'),os=require('os'),path=require('path');
 const tmp=path.join(os.tmpdir(),`filterio-${TAG}.json`);
 const bad=path.join(os.tmpdir(),`filterio-bad-${TAG}.json`);

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await post('/api/access-mode',{mode:'edit'});
  await page.evaluate(u=>localStorage.setItem('AccessMeasurementUserId',u),USER);
  /* この一覧に2件、別の一覧に1件。**別の一覧のぶんも書き出せる**ことが要点。 */
  await post('/api/filter-presets',{name:`${TAG}-A`,db:DB,table:TBL,mode:'',user:USER,
    filters:[{column:'ロットNo',op:'starts',value:'L00'}]});
  await post('/api/filter-presets',{name:`${TAG}-B`,db:DB,table:TBL,mode:'',user:USER,
    filters:[{column:'BOX実績_板厚',op:'gte',value:'1.0'}]});
  await post('/api/filter-presets',{name:`${TAG}-C`,db:OTHER_DB,table:OTHER_TBL,mode:'',user:USER,
    filters:[{column:'不良名',op:'not_empty',value:''}]});

  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('aside [data-db-key="SIKALOTNOW"]',{timeout:20000});
  await page.waitForSelector('#grid tbody tr',{timeout:30000});
  await page.waitForTimeout(800);
  /* 「デフォルト」「鍵」を1件に付けておく（印が名前で運ばれるかを見るため）。
     印は**その人のもの**になったので、画面と同じAPIで付ける(§9.172)。 */
  const targetId=(await listPresets('')).find(x=>x.name===`${TAG}-A`)?.id;
  await post('/api/filter-presets/marks',{user:USER,id:targetId,isDefault:true,isLocked:true});
  await page.evaluate(()=>document.getElementById('reloadFilterPresets')?.click());

  /* §9.286 ①: たまにしか使わない入口は`⋯`の浮きメニューへ畳んだ。**消していない**ので、開いてから押す。 */
  await page.click('#filterMoreBtn');
  await page.click('#openFilterPresets');
  await page.waitForSelector('#filterPresetModal:not([hidden])',{timeout:10000});
  await page.waitForTimeout(900);

  /* ---- 1) 書き出し: 既定は「いま開いている一覧」だけ ---- */
  await openIo('export');
  const ex0=await page.evaluate(()=>{
   const boxes=[...document.querySelectorAll('#filterIoPanel [data-io-group]')];
   return {groups:boxes.length,checked:boxes.filter(x=>x.checked).length,
           run:document.getElementById('filterIoRun').textContent,
           note:document.querySelector('#filterIoPanel .fp-io-note').textContent,
           current:document.querySelectorAll('#filterIoPanel .fp-io-now').length,
           hint:document.querySelector('#filterIoPanel .fp-io-hint').textContent.replace(/\s+/g,' ')};
  });
  rec('書き出しは一覧ごとに選べる（今の一覧が既定）',
      ex0.groups>=2&&ex0.checked===1&&ex0.current===1,
      `一覧${ex0.groups} / 既定で選択${ex0.checked}`);
  rec('何件出るのかをボタンと見出しに書く',
      /\d+件を書き出す/.test(ex0.run)&&/件を書き出します/.test(ex0.note),`${ex0.run} ｜ ${ex0.note}`);
  /* **出るもの・出ないものを画面に書く**（統計を運んでも意味が無いこと、
     印が端末の設定であることを、開いた人が推測せずに読めるように）。 */
  rec('出るもの・出ないものを画面に書く',
      /出るもの/.test(ex0.hint)&&/出ないもの/.test(ex0.hint)&&/使用回数/.test(ex0.hint),
      ex0.hint.slice(0,80));

  /* ---- 2) 「すべての一覧」で全部 ---- */
  await page.click('#filterIoPanel [data-io-quick="all"]');
  await settle();
  const exAll=await page.evaluate(()=>{
   const boxes=[...document.querySelectorAll('#filterIoPanel [data-io-group]')];
   return {checked:boxes.filter(x=>x.checked).length,all:boxes.length};
  });
  rec('「すべての一覧」ひと押しで全部選べる',exAll.checked===exAll.all&&exAll.all>=2,
      `${exAll.checked}/${exAll.all}`);

  /* ---- 3) 書き出したJSONの形 ---- */
  await page.evaluate(()=>{
   /* ダウンロードは実ファイルにせず、blobのURLだけ捕まえて中身を読む。 */
   const orig=HTMLAnchorElement.prototype.click;
   HTMLAnchorElement.prototype.click=function(){
    if(this.download){window.__dlHref=this.href;window.__dlName=this.download;return}
    return orig.apply(this,arguments);
   };
  });
  await page.click('#filterIoRun');
  await page.waitForFunction(()=>!!window.__dlHref,null,{timeout:8000});
  const dumped=await page.evaluate(async()=>({
   name:window.__dlName,text:await (await fetch(window.__dlHref)).text()}));
  let doc={};try{doc=JSON.parse(dumped.text)}catch(e){}
  const grp=(doc.groups||[]).find(g=>g.db===DB&&g.table===TBL);
  const mine=((grp||{}).presets||[]).filter(p=>p.name.startsWith(TAG));
  rec('ファイル名に日付が入る',/^wavelog-filters-\d{8}\.json$/.test(dumped.name||''),dumped.name);
  rec('書き出したJSONは形式と版を名乗る',
      doc.format==='wavelog-filter-presets'&&doc.version===1&&Array.isArray(doc.groups),
      `${doc.format} v${doc.version} / ${(doc.groups||[]).length}群`);
  rec('別の一覧のぶんも一緒に出せる',
      (doc.groups||[]).some(g=>g.db===OTHER_DB&&g.table===OTHER_TBL),
      (doc.groups||[]).map(g=>g.db+'/'+g.table).join('、'));
  const marked=mine.find(p=>p.name===`${TAG}-A`);
  rec('「デフォルト」「鍵」の印は名前に付いて出る',
      !!marked&&marked.isDefault===true&&marked.isLocked===true,JSON.stringify(marked||{}).slice(0,90));
  /* **統計は運ばない。** 出ていたら、別のPCで意味の無い数字が並ぶ。 */
  rec('使用回数・IDは書き出さない',
      mine.length>=2&&mine.every(p=>p.uses===undefined&&p.id===undefined&&p.lastUsed===undefined),
      JSON.stringify(Object.keys(mine[0]||{})));
  fs.writeFileSync(tmp,dumped.text);

  /* ---- 4) 取り込み: 中身を先に見せる ---- */
  /* 取り込み側で「同名」と「新規」を作り分ける: -A は残し、-B を消しておく。 */
  const before=await listPresets('');
  const bId=before.find(x=>x.name===`${TAG}-B`)?.id;
  await post('/api/filter-presets/delete',{id:bId});
  await page.evaluate(()=>document.getElementById('reloadFilterPresets').click());
  await page.waitForTimeout(900);
  await openIo('import');
  await page.setInputFiles('#filterIoFile',tmp);
  await page.waitForSelector('#filterIoPanel .fp-io-groups',{timeout:8000});
  await settle();
  const im=await page.evaluate(()=>({
   read:(document.querySelector('#filterIoPanel .fp-io-read')||{}).textContent||'',
   counts:[...document.querySelectorAll('#filterIoPanel .fp-io-count')].map(x=>x.textContent),
   checked:[...document.querySelectorAll('#filterIoPanel [data-io-group]')].filter(x=>x.checked).length,
   run:document.getElementById('filterIoRun').textContent,
   marks:!!document.getElementById('fpIoMarks'),
   dup:document.querySelectorAll('#filterIoPanel [name="fpIoDup"]').length}));
  rec('取り込む前に件数と一覧の数が読める',/\d+件/.test(im.read)&&/つの一覧/.test(im.read),im.read.trim());
  rec('新規と同名を数えて見せる',
      im.counts.some(t=>/新しく入る\d+件/.test(t))&&im.counts.some(t=>/同じ名前が\d+件/.test(t)),
      im.counts.join(' ｜ '));
  rec('既定は全部取り込む（選んだファイルなので）',im.checked>=2&&/取り込む/.test(im.run),
      `${im.checked}群 / ${im.run}`);
  rec('同名の扱いと印の扱いを選べる',im.dup===2&&im.marks);

  /* ---- 5) 「そのままにする」を選ぶと同名は上書きしない ---- */
  await post('/api/filter-presets',{name:`${TAG}-A`,db:DB,table:TBL,mode:'',user:USER,
    filters:[{column:'書き換えた印',op:'eq',value:'KEEP'}]});
  await page.evaluate(()=>{
   const keep=[...document.querySelectorAll('#filterIoPanel [name="fpIoDup"]')]
     .find(x=>x.value==='keep');
   keep.checked=true;keep.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.click('#filterIoRun');
  await page.waitForSelector('#filterIoPanel',{state:'hidden',timeout:15000});
  await page.waitForTimeout(1200);
  const after=await listPresets('');
  const a=after.find(x=>x.name===`${TAG}-A`);
  rec('「そのままにする」なら同名を上書きしない',
      !!a&&(a.filters||[])[0]?.column==='書き換えた印',JSON.stringify(a&&a.filters));
  /* 取り込んだ登録は**取り込んだ人のもの**になる（持ち主のIDは運ばない）。 */
  rec('取り込んだ登録は取り込んだ人のものになる',
      after.filter(x=>x.name.startsWith(TAG)).every(x=>x.owner===USER),
      after.filter(x=>x.name.startsWith(TAG)).map(x=>`${x.name}=${x.owner||'みんな'}`).join('、'));
  rec('無かったぶんは新しく入る',after.some(x=>x.name===`${TAG}-B`),
      after.filter(x=>x.name.startsWith(TAG)).map(x=>x.name).join('、'));

  /* ---- 6) 印も取り込まれる（この端末の置き場へ） ---- */
  /* 印は**マスタ側**にその人のものとして残っていること(§9.172)。端末の控えだけ
     だと、取り込んだ人が別のPCへ移った瞬間に印だけ消える。 */
  const reread=await listPresets('');
  const ra=reread.find(x=>x.name===`${TAG}-A`);
  rec('「デフォルト」「鍵」の印も名前で当て直される（マスタに残る）',
      !!ra&&ra.isDefault===true&&ra.isLocked===true,
      JSON.stringify(ra&&{d:ra.isDefault,l:ra.isLocked}));

  /* ---- 7) 壊れたファイルは断る ---- */
  fs.writeFileSync(bad,'{"format":"something-else","groups":[]}');
  await openIo('import');
  await page.setInputFiles('#filterIoFile',bad);
  await page.waitForSelector('#filterIoPanel .fp-io-error',{timeout:8000});
  const err=await page.evaluate(()=>({
   msg:document.querySelector('#filterIoPanel .fp-io-error').textContent,
   run:document.getElementById('filterIoRun').disabled}));
  rec('別のファイルを選んだら理由を書いて断る',
      /WaveLog/.test(err.msg)&&err.run===true,err.msg.slice(0,70));

  rec('コンソールに例外を出さない',errs.length===0,errs.slice(0,2).join(' / '));
 }catch(e){rec('FATAL',false,e.message)}
 finally{
  /* このテストが作った登録だけを消す。名前の印で引き当てる。 */
  try{
   for(const mode of ['','schedule']){
    const items=await listPresets(mode);
    // 取り込みで作られたぶんも同じ印で拾える（名前の先頭がTAG）。
    for(const x of items)if(String(x.name||'').startsWith(TAG))
      await post('/api/filter-presets/delete',{id:x.id});
   }
  }catch(e){}
  try{require('fs').unlinkSync(tmp)}catch(e){}
  try{require('fs').unlinkSync(bad)}catch(e){}
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
