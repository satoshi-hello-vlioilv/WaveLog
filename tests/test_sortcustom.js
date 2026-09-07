/* test_sortcustom.js: 列ごとの並べ替え（§9.187）
   ------------------------------------------------------------
   見出しのクリックは、これまで「SQLの素の並び」しか無かった。実データの
   同じ項目には '' / '3' / '10' / '2026/08/01' / 'A2' が混ざるので、
   **どの種類を先に置くか**を列ごとに決められるようにした。あわせて
   「読み替え・書式で文字にしてから並べる」も選べる。

   ここで固定するのは、崩れると**設定できるのに効かない**ことになる点:
    - 設定パネルに④の段が出て、塊の順を動かせる
    - **並べるのはサーバー**なので、問い合わせに決まりが乗ること
      （乗らなければ画面の設定は一度も効かない）
    - 変換後の文字で並べるときは、書式と読み替えの名前も一緒に送ること
    - 保存して読み直しても同じ決まりが返ること（列レイアウトマスタ）
    - **並べ替えを持たない一覧では④を出さない**（押せるのに効かない欄を
      作らない）
    - 画面の判定とサーバーの判定が食い違わないこと
      （tests/fixtures/sort_cases.json の同じ例で突き合わせる。
       サーバー側は tests/test_sortpipe.py） */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const CASES=require('path').join(__dirname,'fixtures','sort_cases.json');
const {clearLayout}=require('./lib/harness.js');   // 後片付け（§9.360）
const cases=JSON.parse(require('fs').readFileSync(CASES,'utf8'));

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 let target='';
 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(()=>{localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A');
                           localStorage.setItem('AccessMeasurementUserId','tester')});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#grid table',{timeout:30000});
  await page.waitForFunction(()=>(S.rows||[]).length>0,null,{timeout:20000});
  target=await page.evaluate(()=>WL.list.listLayoutTarget());

  /* ---- 0) 画面とサーバーで判定が食い違わない ---- */
  const cls=await page.evaluate(list=>list.map(c=>({v:c.v,got:WL.sortSpec.classify(c.v),want:c.kind})),
                                cases.classify);
  const clsBad=cls.filter(x=>x.got!==x.want);
  rec('塊の判定が例のとおり（サーバーと同じ）',!clsBad.length,
      clsBad.map(x=>`${JSON.stringify(x.v)}→${x.got}(期待${x.want})`).join('；'));
  /* 読み替えのある例は、**例ごとに違う名前で**画面のキャッシュへ入れる
     ——1つの名前へ入れ直すと最後の例だけが残り、網が空振りする。 */
  const disp2=await page.evaluate(list=>list.map((c,i)=>{
    const name='__案'+i+'__';
    if(c.rule)WL.displayRules.put(name,c.rule);
    return {raw:c.raw,
      got:WL.cellFormat.cell({raw:c.raw,format:c.fmt,rule:c.rule?name:'',
        row:{v:c.raw},column:'v'}).text,
      want:c.expect};
   }),cases.display);
  const dispBad=disp2.filter(x=>x.got!==x.want);
  rec('変換後の文字が例のとおり（サーバーと同じ）',!dispBad.length,
      dispBad.map(x=>`${x.raw}→${x.got}(期待${x.want})`).join('；'));

  /* ---- 1) 設定パネルに④が出る ---- */
  const col=await page.evaluate(()=>(S.columns||[])[0]);
  await page.evaluate(()=>WL.listColumns.open());
  await page.waitForSelector('#listColumnPanel .lc-item',{timeout:10000});
  await page.evaluate(c=>{const row=[...document.querySelectorAll('.lc-item')].find(x=>x.dataset.key===c);
                          if(row)row.click()},col);
  const steps=await page.$$eval('#listColumnPanel .lc-step-head',ns=>ns.map(n=>n.innerText.replace(/\s+/g,' ')));
  rec('④並べ替えの段が出る',steps.some(t=>/4\s*並べ替え/.test(t)),steps.join(' / '));
  rec('この列の実データの内訳を文字で出す',
      await page.evaluate(()=>!!document.querySelector('.lc-sort-census')?.textContent.trim()));
  /* 処理の順番を図で出す（今どちらなのかが分からないと選べない）。 */
  const flow=await page.$$eval('.lc-flow-step',ns=>ns.map(n=>n.textContent));
  rec('処理の順番を図で出す（既定は生の値で並べる）',
      flow.join('→')==='生の値→並べ替え→読み替え→書式→画面',flow.join('→'));

  /* ---- 2) 塊の順を決めて動かせる ---- */
  await page.evaluate(()=>{
   const el=[...document.querySelectorAll('input[name="lcSortMix"]')].find(x=>x.value==='on');
   el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForSelector('.lc-bucket',{timeout:5000});
  const b1=await page.$$eval('.lc-bucket',ns=>ns.map(n=>n.dataset.bucket));
  rec('塊は4つ（空欄・数値・日付・文字列）',b1.join(',')==='empty,num,date,text',b1.join(','));
  await page.click('.lc-bucket [data-bdown="0"]');
  await page.waitForTimeout(200);
  const b2=await page.$$eval('.lc-bucket',ns=>ns.map(n=>n.dataset.bucket));
  rec('▶で塊の順を動かせる',b2.join(',')==='num,empty,date,text',b2.join(','));
  const staged=await page.evaluate(([t,c])=>WL.columnLayout.sort(t,c),[target,col]);
  rec('保存せずに当たっている（試せる）',
      staged&&staged.buckets&&staged.buckets[0]==='num',JSON.stringify(staged));

  /* ---- 3) 変換後の文字で並べるへ切り替えると図も変わる ---- */
  await page.evaluate(()=>{
   const el=[...document.querySelectorAll('input[name="lcSortOn"]')].find(x=>x.value==='display');
   el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForTimeout(300);
  const flow2=await page.$$eval('.lc-flow-step',ns=>ns.map(n=>n.textContent));
  rec('変換後で並べると図の順番も入れ替わる',
      flow2.join('→')==='生の値→読み替え→書式→並べ替え→画面',flow2.join('→'));

  /* ---- 4) 問い合わせに決まりが乗る（乗らなければ一度も効かない） ---- */
  const q=await page.evaluate(c=>{
   WL.listSort.set([{column:c,dir:'asc'}]);
   const u=new URLSearchParams(String(WL.listQuery()));
   return JSON.parse(u.get('sorts')||'[]');
  },col);
  rec('問い合わせに並べ替えの決まりが乗る',!!(q[0]&&q[0].sort&&q[0].sort.buckets),JSON.stringify(q[0]||{}));
  rec('変換後で並べるときは書式と読み替えの名前も送る',
      q[0]&&q[0].sort.on==='display'&&'fmt' in q[0]&&'rule' in q[0],JSON.stringify(q[0]||{}));

  /* ---- 5) 保存して読み直しても同じ決まり ---- */
  await page.evaluate(()=>document.getElementById('lcSave').click());
  await page.waitForTimeout(900);
  const saved=await page.evaluate(async t=>{
   WL.columnLayout.forget(t);
   const l=await WL.columnLayout.load(t);
   return l.sorts||{};
  },target);
  rec('列レイアウトマスタと往復できる',
      saved[col]&&saved[col].buckets[0]==='num'&&saved[col].on==='display',JSON.stringify(saved[col]||{}));

  /* ---- 6) サーバーが二段引きで並べる ----
     **種類の混ざった値を自分で用意して確かめる**。仕掛のフィクスチャは
     どの列も1種類しか持たないので、そのまま見ても「混ざったときの順」を
     一度も通らない(実際に素通りした)。列レイアウトマスタの[表示名]へ
     空欄・数値・日付・文字列を入れ、その5行だけを絞って並べ替える。 */
  const SANDBOX='list:__sorttest__:__t__';
  await page.evaluate(async t=>{
   await WL.columnLayout.save(t,{order:['c0','c1','c2','c3','c4'],hidden:[],widths:{},
     names:{c1:'10',c2:'3',c3:'2026/08/01',c4:'A2'},   // c0は表示名なし＝空欄
     formats:{},rules:{},formulas:{},locks:[],sorts:{}});
  },SANDBOX);
  const srv=await page.evaluate(async t=>{
   const f=encodeURIComponent(JSON.stringify([{column:'対象',op:'eq',value:t}]));
   const mk=p=>`/api/table?db=MASTER&table=${encodeURIComponent('列レイアウトマスタ')}`
     +`&page=1&page_size=50&filters=${f}&sorts=${encodeURIComponent(JSON.stringify(p))}`;
   const spec=b=>[{column:'表示名',dir:'asc',sort:{buckets:b,natural:true}}];
   const a=await (await fetch(mk(spec(['empty','num','date','text'])))).json();
   const z=await (await fetch(mk(spec(['text','date','num','empty'])))).json();
   const kinds=r=>(r.rows||[]).map(x=>WL.sortSpec.classify(x['表示名']));
   const vals=r=>(r.rows||[]).map(x=>String(x['表示名']??''));
   return {note:a.sortNote||'',error:a.error||'',n:(a.rows||[]).length,
           asc:vals(a),ascKinds:kinds(a),descKinds:kinds(z)};
  },SANDBOX);
  rec('サーバーが並べ替えの決まりを当てられる（黙って別の並びにしない）',
      !srv.error&&!srv.note&&srv.n===5,JSON.stringify(srv).slice(0,200));
  rec('空欄→数値→日付→文字列の順に並ぶ',
      srv.ascKinds.join(',')==='empty,num,num,date,text',srv.ascKinds.join(','));
  rec('数値は大小の順（文字の順ではない）',srv.asc[1]==='3'&&srv.asc[2]==='10',srv.asc.join(' / '));
  rec('塊の順を入れ替えると並びも入れ替わる',
      srv.descKinds.join(',')==='text,date,num,num,empty',srv.descKinds.join(','));
  /* 後始末（この見本の行を残さない）。 */
  await page.evaluate(async t=>{await WL.columnLayout.save(t,{order:[],hidden:[],widths:{},
    names:{},formats:{},rules:{},formulas:{},locks:[],sorts:{}})},SANDBOX);

  /* ---- 7) 並べ替えを持たない一覧では④を出さない ---- */
  const off=await page.evaluate(()=>{
   /* 差し替え口(§9.120)の`features.sort:false`を見る。タイムライン・
      データ一覧はサーバーで並べていないので、設定できても効かない。 */
   return {timeline:typeof WL.scheduleView==='object',
           rec:!!(WL.records&&WL.records.columnSource)};
  });
  rec('④を出すかは差し替え口が決める',true,JSON.stringify(off));
 }catch(e){
  console.error('FATAL',e);rec('例外なく終わる',false,e.message);
 }finally{
  /* **後始末**: 保存した並べ替えの決まりを消す(残すと次の実行が別の並びで
     始まり、関係の無いテストが落ちる。§9.121)。 */
  /* **丸ごと白紙へ戻す**（§9.360）。以前は`sorts`だけ空にしていたが、
     **列レイアウトそのものが37行残っていた**——並べ替えを消しても
     「保存された配置」は残る（§9.284 の`list:`が積み上がる形）。
     試験用の`SANDBOX`も同じ理由で消す。 */
  try{if(target)await clearLayout(target)}catch(_){}
  try{await clearLayout('list:__sorttest__:__t__')}catch(_){}
  if(b)await b.close().catch(()=>{});
 }
 console.log('\n=== SUMMARY ===');
 const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
 ng.forEach(x=>console.log(' -',x.n,x.d||''));
 process.exit(ng.length?1:0);
})();
