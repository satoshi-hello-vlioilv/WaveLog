/* test_filtergroup.js: プリセット（登録した条件の組み合わせ）の切り替え（§9.287）

   ============================================================
   利用者の指示
   ------------------------------------------------------------
   「フィルタが昔のデザインのものと新しいデザインのものが混在して重複状態です。
    フィルタのプリセット群 / 一括切替 / 再構成を実施した経緯での残骸と思います」
   「プリセットフィルタは登録一覧から作るが、登録した条件の組み合わせで名前を
    付けて管理したいです」
   「プリセットフィルタは1つのボタンでポップオーバーメニューで切り替え」
   「組み合わせて使わず切り替えて使うので、ボタン1つにして、切り替えられる
    のが理想です」
   「プリセットフィルタと今までのフィルタ登録条件は重複させず、どちらかを
    使うようにしたいです（プリセットがそもそも登録フィルタの組み合わせのため）」
   「バッジとして追加されるボタンに表示されているフィルタの条件式は、ボタンの
    部分には基本的に長すぎて記述しきれないので最初から記載せずシンプルに
    アイコンだけにしてください。その代わり、ポップオーバーでしっかり条件式の
    中身を確認できるようにしてください」
   「登録フィルタの一覧からプリセット作るときのUIも直感的に使えるものを
    お願いします。登録フィルタ一覧の現在の状態のような文字の見切れなど
    無いようにお願いします」

   §9.286 ① の形（群のボタン＋登録条件の札を横に並べる帯）は**廃した**。
   同じ条件が「濃い札」と「トークン」の2つの言語で同時に画面へ出ており、
   §CLAUDE 画面基準 8「同じ情報を2箇所に出さない」に反していた（実機で確認）。

   ここで固定すること
   ------------------------------------------------------------
    1. バーは1行で、**札の行も旧「よく使う条件」の行も無い**
    2. プリセットは**1ボタン＋ポップオーバー**。中身は「なし／組み合わせ／
       まだ組み合わせに入れていない条件」
    3. 選ぶと**切り替わる**（前のプリセットの条件が外れ、選んだものが入る）
    4. **手で足した条件は切り替えても残る**（スポットの条件を巻き添えにしない）
    5. 効いている条件は**アイコン＋件数の1バッジ**。条件式はバッジに書かず、
       ポップオーバーで全部読める
    6. 登録一覧で**選んで組み合わせを作れる**／名前を変える／解く
    7. 登録一覧に**文字の見切れが無い**

   **「札が並ぶ」「ボタンがある」だけを見ないこと**——押しても何も起きない
   実装でも通る。件数（`#filterCount`）と一覧の件数（`S.count`）まで見る。
   後片付けは finally で必ず行う（§9.121。名前に実行ごとの印を入れる）。
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const TAG='fg'+Date.now().toString(36);
const USER='u-'+TAG;
const DB='SIKALOTNOW',TBL='仕掛';
const GA=TAG+'組';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 page.on('pageerror',e=>{errs.push(e.message.slice(0,200));console.log('[pageerror]',e.message.slice(0,200),'\n',String(e.stack||'').slice(0,900))});
 page.on('console',m=>{if(m.type()==='error')console.log('[console]',m.text().slice(0,200))});
 const settle=ms=>page.waitForTimeout(ms);
 const post=(p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-filtergroup'},a.b))});
  let j={};try{j=await r.json()}catch(e){}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 const listPresets=()=>page.evaluate(async u=>{
  const r=await fetch('/api/filter-presets?user='+encodeURIComponent(u));
  return (await r.json()).items||[];
 },USER);
 /* 一覧の状態。**件数と一覧の件数の両方**を見る（ボタンの字が変わっただけ
    では絞り込めていない）。**DOMの行数で数えないこと**（§9.286 ③）——
    1000件の既定では仮想行が効くので、同じ絞り込みでも数が揺れる。 */
 const state=()=>page.evaluate(()=>({
  count:(document.querySelector('#filterCount')?.textContent||'').trim(),
  preset:(document.querySelector('#filterPresetName')?.textContent||'').trim(),
  note:(document.querySelector('#filterPresetNote')?.textContent||'').trim(),
  rows:(typeof S!=='undefined'&&Number.isFinite(S.count))?S.count
       :document.querySelectorAll('#grid table tbody tr').length,
  conds:(typeof S!=='undefined'?(S.genericFilters||[]):[]).map(f=>`${f.column}|${f.op}|${f.value}`),
 }));
 const openPresetMenu=async()=>{
  await page.evaluate(()=>{
   if(document.querySelector('#filterPresetMenu'))return;
   document.querySelector('#filterPresetBtn').click();
  });
  await page.waitForSelector('#filterPresetMenu',{timeout:5000});
 };
 const pickPreset=async label=>{
  await openPresetMenu();
  const hit=await page.evaluate(x=>{
   const b=[...document.querySelectorAll('#filterPresetMenu [data-preset-key]')]
     .find(e=>(e.querySelector('.fb-preset-label')?.textContent||'').trim()===x);
   if(!b)return false;
   b.click();return true;
  },label);
  if(!hit)throw new Error('プリセットが見つかりません: '+label);
  await settle(1300);
 };
 let made=[];

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(u=>localStorage.setItem('AccessMeasurementUserId',u),USER);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await post('/api/access-mode',{mode:'edit'});
  await page.click('aside [data-db-key="SIKALOTNOW"]',{timeout:20000});
  await page.waitForSelector('#grid tbody tr',{timeout:30000});
  await settle(900);

  /* ---- 用意: 実際に絞れる列と値（§9.238 ⑤の教訓） ---- */
  const col=await page.evaluate(()=>{
   const names=(typeof S!=='undefined'&&S.columns)||[];
   const best=names.map(c=>({c,n:new Set((S.rows||[]).map(r=>String(r[c]??''))).size}))
     .filter(x=>x.n>3).sort((a,b)=>b.n-a.n)[0];
   return best?best.c:names[0];
  });
  const vals=await page.evaluate(c=>[...new Set((S.rows||[]).map(r=>String(r[c]??'').trim()).filter(Boolean))].slice(0,3),col);
  rec('検証の前提: 絞れる列と値がある',!!col&&vals.length>=2,`${col} / ${vals.join(',')}`);
  const mk=async(name,value,group)=>{
   const r=await post('/api/filter-presets',{name,db:DB,table:TBL,mode:'',user:USER,
     group:group||'',filters:[{column:col,op:'contains',value}]});
   made.push(name);return r;
  };
  await mk(TAG+'-A',vals[0],GA);
  await mk(TAG+'-B',vals[1],GA);
  await mk(TAG+'-C',vals[0],'');
  await page.evaluate(()=>window.location.reload());
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('aside [data-db-key="SIKALOTNOW"]',{timeout:20000});
  await page.waitForSelector('#filterPresetBtn',{timeout:20000});
  await settle(900);

  /* ==========================================================
     1) バーは1行。**札の行も旧「よく使う条件」の行も無い**
        （利用者の報告「昔のデザインと新しいデザインが混在して重複状態」）
     ========================================================== */
  const shape=await page.evaluate(()=>{
   const bar=document.querySelector('#genericFilterBar');
   return {
    presetBtn:!!document.querySelector('#filterPresetBtn'),
    condBtn:!!document.querySelector('#filterCondBtn'),
    chips:!!document.querySelector('#filterPresetChips'),
    quick:!!document.querySelector('#filterQuickRow'),
    quickToggle:!!document.querySelector('#filterQuickToggle'),
    tags:document.querySelectorAll('.filter-tag').length,
    rows:[...bar.children].filter(x=>!x.hidden&&x.offsetHeight>0).length,
    more:!!document.querySelector('#filterMoreBtn'),
    adhoc:!!document.querySelector('#filterAdhocToggle'),
   };
  });
  rec('プリセットは1ボタン（ポップオーバーで切り替え）',shape.presetBtn,JSON.stringify(shape));
  rec('登録条件の札を横に並べる行は無い（重複の元）',!shape.chips,JSON.stringify(shape));
  rec('旧「よく使う条件」の行と入口は無い',!shape.quick&&!shape.quickToggle,JSON.stringify(shape));
  rec('条件ごとのトークンは出さない（バッジ1つに畳んだ）',shape.tags===0,`tags=${shape.tags}`);
  rec('バーは1行（その場フィルタは畳んだまま）',shape.rows===1,`rows=${shape.rows}`);
  rec('たまにしか使わない入口は消していない（⋯／その場フィルタ）',
      shape.more&&shape.adhoc,JSON.stringify(shape));

  /* ==========================================================
     2) ポップオーバーの中身——「なし」「組み合わせ」「単独の条件」
     ========================================================== */
  await openPresetMenu();
  const menu=await page.evaluate(()=>{
   const m=document.querySelector('#filterPresetMenu');
   return {
    items:[...m.querySelectorAll('[data-preset-key]')].map(x=>({
      label:(x.querySelector('.fb-preset-label')?.textContent||'').trim(),
      sub:(x.querySelector('.fb-preset-sub')?.textContent||'').trim(),
      on:x.classList.contains('is-current'),
      role:x.getAttribute('role'),
    })),
    secs:[...m.querySelectorAll('.fb-preset-sec')].map(x=>x.textContent.trim()),
    manage:!!m.querySelector('#fbPresetManage'),
   };
  });
  rec('「なし」が先頭にあり、既定で選ばれている',
      menu.items[0]?.label==='なし'&&menu.items[0]?.on,JSON.stringify(menu.items[0]));
  rec('切り替えなので選べるのは1つ（ラジオ）',
      menu.items.every(x=>x.role==='menuitemradio'),JSON.stringify(menu.items.map(x=>x.role)));
  rec('組み合わせが1件の候補として並ぶ',
      menu.items.some(x=>x.label===GA),JSON.stringify(menu.items.map(x=>x.label)));
  rec('組み合わせの中身（条件数と条件式）を名乗る',
      /2条件/.test(menu.items.find(x=>x.label===GA)?.sub||''),
      menu.items.find(x=>x.label===GA)?.sub);
  rec('まだ組み合わせに入れていない条件も切り替えられる',
      menu.items.some(x=>x.label===TAG+'-C'),JSON.stringify(menu.items.map(x=>x.label)));
  rec('節で分けてある（組み合わせ／まだ入れていない条件）',
      menu.secs.length>=2,JSON.stringify(menu.secs));
  rec('登録一覧への入口が同じ場所にある',menu.manage,String(menu.manage));
  await page.keyboard.press('Escape');
  await settle(200);

  /* ==========================================================
     3) 選ぶと**切り替わる**（件数と一覧が実際に動く）
     ========================================================== */
  const before=await state();
  await pickPreset(GA);
  const onCombo=await state();
  rec('プリセットを選ぶとボタンが名乗る',onCombo.preset===GA,
      `${before.preset} → ${onCombo.preset}`);
  rec('選んだ組み合わせの条件が2件とも入る',onCombo.conds.length===2,
      JSON.stringify(onCombo.conds));
  rec('件数のバッジが動く',onCombo.count==='2件',`${before.count} → ${onCombo.count}`);
  rec('一覧が実際に絞られる',onCombo.rows!==before.rows,
      `${before.rows}件 → ${onCombo.rows}件`);

  /* **切り替え**——前のプリセットの条件は外れる（足し算にしない）。 */
  await pickPreset(TAG+'-C');
  const onSingle=await state();
  rec('別のプリセットへ切り替えると前の条件は外れる（足さない）',
      onSingle.conds.length===1,JSON.stringify(onSingle.conds));
  rec('切り替え後のボタンは新しい名前を名乗る',onSingle.preset===TAG+'-C',onSingle.preset);

  /* 「なし」へ戻す。 */
  await pickPreset('なし');
  const off=await state();
  rec('「なし」を選ぶとプリセットの条件が全部外れる',off.conds.length===0,
      JSON.stringify(off.conds));

  /* ==========================================================
     4) 手で足した条件は切り替えても残る
        （スポットで打った条件が巻き添えで消えるのが、いちばん驚く壊れ方）
     ========================================================== */
  await page.evaluate(a=>{
   S.genericFilters.push({column:a.col,op:'contains',value:a.v});
   S.page=1;
  },{col,v:vals[2]||vals[0]});
  await page.evaluate(()=>load());
  await settle(1200);
  await pickPreset(GA);
  const mixed=await state();
  rec('手で足した条件は切り替えても残る',mixed.conds.length===3,JSON.stringify(mixed.conds));
  await pickPreset('なし');
  const kept=await state();
  rec('「なし」にしても手で足した条件は残る',kept.conds.length===1,JSON.stringify(kept.conds));

  /* ==========================================================
     5) 効いている条件のバッジ——**条件式はバッジに書かない**
        （利用者の指示「長すぎて記述しきれないのでアイコンだけに」）
     ========================================================== */
  const badge=await page.evaluate(()=>{
   const b=document.querySelector('#filterCondBtn');
   return {text:(b.textContent||'').trim(),icon:!!b.querySelector('svg'),
           title:b.title||'',disabled:b.disabled};
  });
  rec('バッジはアイコンと件数だけ（条件式を書かない）',
      badge.icon&&/^\s*\d+件\s*▾?\s*$/.test(badge.text.replace(/\s+/g,'')),
      JSON.stringify(badge.text));
  rec('中身はtitleからも読める（見えない場所に隠さない）',
      badge.title.includes(col),badge.title.slice(0,80));
  await page.click('#filterCondBtn');
  await page.waitForSelector('#filterCondMenu',{timeout:5000});
  const pop=await page.evaluate(()=>{
   const m=document.querySelector('#filterCondMenu');
   const rows=[...m.querySelectorAll('.fb-cond-row')];
   return {n:rows.length,
     texts:rows.map(x=>(x.querySelector('.fb-cond-text')?.textContent||'').trim()),
     x:rows.every(x=>!!x.querySelector('.fb-cond-x')),
     clear:!!m.querySelector('#fbCondClear'),
     /* **切らずに全部読めること**（器からはみ出していない）。 */
     cut:rows.map(x=>{const t=x.querySelector('.fb-cond-text');
       return t?Math.round(t.scrollWidth-t.clientWidth):0}),
   };
  });
  rec('ポップオーバーに条件が並ぶ',pop.n===1,`${pop.n}件`);
  rec('条件式が全部読める（列名と値）',
      pop.texts.some(t=>t.includes(col)),JSON.stringify(pop.texts));
  rec('条件式が切れていない',pop.cut.every(c=>c<=1),JSON.stringify(pop.cut));
  rec('1件ずつ外せる／全部外せる',pop.x&&pop.clear,JSON.stringify(pop));
  /* **「全部外す」を実際に押すこと**——ボタンが在ることだけを見る網では、
     押しても何も起きない実装を素通しする。実際に`clearGenericFilters()`という
     名前で呼んでおり、**同じ綴りのidを持つボタンが`window`に出ているため
     要素を呼び出してTypeError**になっていた（この網を書いて初めて出た）。 */
  await pickPreset(GA);
  await page.click('#filterCondBtn');
  await page.waitForSelector('#filterCondMenu',{timeout:5000});
  await page.click('#fbCondClear');
  await settle(1500);
  const allOff=await state();
  rec('「全部外す」で条件が全部外れる',allOff.conds.length===0,JSON.stringify(allOff));
  rec('「全部外す」で画面のエラーが出ない',errs.length===0,errs.slice(0,2).join(' / '));

  /* 1件ずつ外す道も見る。 */
  await page.evaluate(a=>{
   S.genericFilters=[{column:a.col,op:'contains',value:a.v}];S.page=1;
  },{col,v:vals[0]});
  await page.evaluate(()=>load());
  await settle(1200);
  await page.click('#filterCondBtn');
  await page.waitForSelector('#filterCondMenu',{timeout:5000});
  await page.evaluate(()=>document.querySelector('#filterCondMenu [data-cond-x]').click());
  await settle(1200);
  const cleared=await state();
  rec('ポップオーバーから1件ずつ外すと実際に効かなくなる',cleared.conds.length===0,
      JSON.stringify(cleared));
  const empty=await page.evaluate(()=>{
   const b=document.querySelector('#filterCondBtn');
   return {text:(b.textContent||'').trim(),disabled:b.disabled,title:b.title};
  });
  rec('0件でもバッジは消えない（幅が動かない）／押せない理由を書く',
      /0件/.test(empty.text)&&empty.disabled&&empty.title.length>4,JSON.stringify(empty));

  /* ==========================================================
     6) 登録一覧で「組み合わせ」を作る／名前を変える／解く
     ========================================================== */
  await page.evaluate(()=>{document.querySelector('#filterMoreBtn').click()});
  await settle(200);
  await page.evaluate(()=>document.querySelector('#openFilterPresets').click());
  await page.waitForSelector('#filterPresetModal:not([hidden])',{timeout:8000});
  await settle(700);
  const list=await page.evaluate(()=>({
   secs:[...document.querySelectorAll('#filterPresetList .fp-sec')].map(x=>({
     name:(x.querySelector('.fp-sec-name')?.textContent||'').trim(),
     kind:x.dataset.secKind,
     acts:[...x.querySelectorAll('.fp-sec-acts button')].map(b=>b.textContent.trim()),
   })),
   picks:document.querySelectorAll('#filterPresetList .fp-pick-check').length,
   bulk:(document.querySelector('.fp-bulk')?.textContent||'').trim(),
   /* **見切れが無いこと**（利用者の指示）——名前は折り返してよい。 */
   cutNames:[...document.querySelectorAll('#filterPresetList .fp-name')]
     .map(x=>Math.round(x.scrollWidth-x.clientWidth)),
   groupSelects:document.querySelectorAll('#filterPresetList .fp-group').length,
  }));
  rec('一覧は組み合わせごとの節に分かれている',
      list.secs.some(s=>s.name===GA&&s.kind==='combo'),JSON.stringify(list.secs));
  rec('まだ組み合わせに入れていない条件の節がある',
      list.secs.some(s=>s.kind==='none'),JSON.stringify(list.secs.map(s=>s.kind)));
  rec('節から名前を変える／解くができる',
      (list.secs.find(s=>s.name===GA)?.acts||[]).length===2,
      JSON.stringify(list.secs.find(s=>s.name===GA)?.acts));
  rec('行ごとの群の選択欄は廃した（入口を2つ持たない）',list.groupSelects===0,
      `${list.groupSelects}件`);
  rec('条件を選ぶチェックがある',list.picks>=3,`${list.picks}件`);
  rec('選ぶ前は「何ができるか」を書く（帯は消さない）',
      list.bulk.includes('組み合わせ'),list.bulk.slice(0,50));
  rec('名前が見切れていない（折り返す）',list.cutNames.every(c=>c<=1),
      JSON.stringify(list.cutNames));

  /* 2件選んで新しい組み合わせにする。**名前を聞く窓**を通す。 */
  await page.evaluate(t=>{
   [...document.querySelectorAll('#filterPresetList .filter-preset-item')]
    .filter(x=>(x.querySelector('.fp-name')?.textContent||'').includes(t+'-C'))
    .forEach(x=>{const c=x.querySelector('.fp-pick-check');c.checked=true;
      c.dispatchEvent(new Event('change',{bubbles:true}))});
  },TAG);
  await settle(400);
  const picked=await page.evaluate(()=>(document.querySelector('.fp-bulk')?.textContent||'').trim());
  rec('選ぶと件数と次にすることが出る',/1件/.test(picked)&&/組み合わせへ入れる/.test(picked),
      picked.slice(0,60));
  const NEW=TAG+'新組';
  await page.evaluate(()=>{
   const sel=document.querySelector('#fpBulkGroup');
   sel.value='＋new';sel.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForSelector('#fbGroupNameInput',{timeout:5000});
  await page.fill('#fbGroupNameInput',NEW);
  /* 確認窓の「決める」は`#appConfirmOk`（`confirmModal()`が使い回す1枚）。
     **テキストで探さないこと**——札の字は呼ぶ側が決めるので、文言を直した
     瞬間に網だけが古い約束のまま残る。 */
  await page.click('#appConfirmOk');
  await settle(2000);
  const after=await listPresets();
  const inNew=after.filter(p=>String(p.group||'').trim()===NEW);
  rec('選んだ条件から名前付きの組み合わせができる（サーバーに残る）',
      inNew.length===1&&inNew[0].name===TAG+'-C',
      JSON.stringify(after.map(p=>({n:p.name,g:p.group}))));
  const menu2=await page.evaluate(()=>{
   document.querySelector('#closeFilterPresets')?.click();
   document.querySelector('#filterPresetBtn').click();
   const m=document.querySelector('#filterPresetMenu');
   const out=[...m.querySelectorAll('.fb-preset-label')].map(x=>x.textContent.trim());
   document.querySelector('#filterPresetBtn').click();
   return out;
  });
  rec('作った組み合わせがそのままバーの候補に並ぶ',menu2.includes(NEW),JSON.stringify(menu2));

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,2).join(' / '));
 }catch(e){
  console.log('FATAL: '+(e&&e.stack||e));
  R.push({n:'FATAL',ok:false});
 }finally{
  /* 後片付け（§9.121）。**名前で引いて消す**——実行ごとの印が入っている。 */
  try{
   const all=await listPresets().catch(()=>[]);
   for(const p of all)if(String(p.name||'').startsWith(TAG))
     await post('/api/filter-presets/delete',{id:p.id,user:USER});
  }catch(e){}
  try{await post('/api/access-mode',{mode:'edit'})}catch(e){}
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok).length;
 console.log(`\n${R.length-ng}/${R.length} PASS`);
 process.exit(ng?1:0);
})();
