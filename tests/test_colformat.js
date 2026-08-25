/* test_colformat.js: 列ごとの書式(§9.88 段3)
   ============================================================
   数値の小数桁・3桁区切り・単位、日付時刻のパターン。整形は画面側で
   行う(並べ替えや絞り込みは生の値で効かせたいので、サーバーへ持ち込まない)。

   ここで固定するのは、崩れると業務が止まる次の点。
    1. **整形できない値は生の値のまま出す**。空欄にしない
       ——現場で「データが消えた」と判断されるのが最悪の結果。
    2. 空欄は空欄のまま(単位や0.00だけが並ぶ列にしない)
    3. 実データの形が揺れても日付として読める
       ('2026-08-11 09:30:00' / '2026/8/11' / '20260811' / '09:30')
    4. 日付の部分を持たない値に yyyy を要求されたら、生の値へ倒す
    5. 保存した書式が一覧のセルに効き、開き直しても残る
    6. 書式を変えても表示名・幅は消えない(保存は全置換なので、
       触っていない設定も一緒に送らないと黙って消える)
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
let b=null,target='';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const clear=()=>target?post('/api/column-layout-master',{target,clear:true,order:[],widths:{},hidden:[],names:{},formats:{},user_id:'test'}):null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:950}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,90))});
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'load'});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(()=>document.querySelectorAll('#grid table thead th').length>3,{timeout:25000});
  await page.waitForTimeout(1200);
  target=await page.evaluate(()=>listLayoutTarget());

  /* ---- 1) 整形そのもの(値を入れて結果を見るだけ) ---- */
  const f=(spec,raw)=>page.evaluate(a=>WL.cellFormat.value(a.spec,a.raw),{spec,raw});
  const num=(o)=>({kind:'number',pattern:'',decimals:null,thousands:false,prefix:'',suffix:'',...o});
  const dt=(p)=>({kind:'datetime',pattern:p,decimals:null,thousands:false,prefix:'',suffix:''});

  rec('小数桁で丸める',await f(num({decimals:2}),'1.2')==='1.20',await f(num({decimals:2}),'1.2'));
  rec('小数桁0は整数へ',await f(num({decimals:0}),'1.6')==='2',await f(num({decimals:0}),'1.6'));
  rec('3桁ごとに区切る',await f(num({thousands:true}),'1234567')==='1,234,567');
  rec('区切りは小数側へ入れない',await f(num({thousands:true,decimals:2}),'1234.5')==='1,234.50',
   await f(num({thousands:true,decimals:2}),'1234.5'));
  rec('マイナスでも区切りが崩れない',await f(num({thousands:true}),'-1234567')==='-1,234,567',
   await f(num({thousands:true}),'-1234567'));
  rec('単位を前後に添える',await f(num({decimals:2,suffix:'mm'}),'1.2')==='1.20mm',
   await f(num({decimals:2,suffix:'mm'}),'1.2'));

  /* **要点**: 数値でない値へ数値の書式を当てても、値は消えない */
  rec('数値でない値は生のまま出る',await f(num({decimals:2,suffix:'mm'}),'A5052')==='A5052',
   await f(num({decimals:2,suffix:'mm'}),'A5052'));
  rec('空欄は空欄のまま(単位だけにしない)',await f(num({decimals:2,suffix:'mm'}),'')==='',
   JSON.stringify(await f(num({decimals:2,suffix:'mm'}),'')));
  rec('nullも空欄のまま',await f(num({decimals:2}),null)==='');

  /* ---- 2) 日付時刻: 実データの形が揺れても読める ---- */
  const P='yyyy/MM/dd HH:mm';
  rec('ISO風を読める',await f(dt(P),'2026-08-11 09:30:00')==='2026/08/11 09:30',
   await f(dt(P),'2026-08-11 09:30:00'));
  rec('スラッシュ区切り・1桁も読める',await f(dt(P),'2026/8/11 9:05')==='2026/08/11 09:05',
   await f(dt(P),'2026/8/11 9:05'));
  rec('8桁の数字を日付として読める',await f(dt('yyyy/MM/dd'),'20260811')==='2026/08/11',
   await f(dt('yyyy/MM/dd'),'20260811'));
  rec('日付だけの値は時刻を0として扱う',await f(dt(P),'2026-08-11')==='2026/08/11 00:00',
   await f(dt(P),'2026-08-11'));
  rec('時刻だけの値も読める',await f(dt('HH:mm'),'9:30')==='09:30',await f(dt('HH:mm'),'9:30'));
  rec('曜日を出せる',await f(dt('M月d日(ddd)'),'2026-08-11')==='8月11日(火)',
   await f(dt('M月d日(ddd)'),'2026-08-11'));
  rec('パターンの区切り文字はそのまま出る',await f(dt('yyyy年MM月dd日'),'2026-08-11')==='2026年08月11日',
   await f(dt('yyyy年MM月dd日'),'2026-08-11'));

  /* **要点**: 足りない部分を求められたら整形せず生の値。時刻だけの値に
     年を要求して 1970 や 今日 を出すと、読んだ人が誤って判断する。 */
  rec('日付を持たない値にyyyyを求めたら生のまま',await f(dt(P),'09:30')==='09:30',
   await f(dt(P),'09:30'));
  rec('日付として読めない値は生のまま',await f(dt(P),'A5052')==='A5052');
  rec('ありえない月日は日付にしない',await f(dt('yyyy/MM/dd'),'20261399')==='20261399',
   await f(dt('yyyy/MM/dd'),'20261399'));

  /* ---- 3) 実際の一覧のセルに効く ---- */
  const cols=await page.evaluate(()=>[...document.querySelectorAll('#grid th[data-sort-col]')].map(t=>t.dataset.sortCol));
  const textCol=cols.find(c=>c==='製造材質')||cols[1];
  const numCol=cols.find(c=>c==='オーダー番号')||cols[2];
  /* 列は`data-col`で引く(§9.104)。**位置で数えないこと**——本文は
     「列の窓」の中しか作らないので、先頭からの位置とデータ列の位置は
     一致しない(窓の外は colspan の空セル1つに畳まれている)。
     窓の外にある列は、見出しを画面へ入れてから読む。 */
  const cellIn=async(col,pick)=>{
   await page.evaluate(c=>{
    document.querySelector(`#grid th[data-sort-col="${CSS.escape(c)}"]`)
      ?.scrollIntoView({block:'nearest',inline:'nearest'});
   },col);
   await page.waitForFunction(c=>!!document.querySelector(
     `#grid tbody tr td[data-col="${CSS.escape(c)}"]`),col,{timeout:10000});
   return page.evaluate(([c,what])=>{
    const td=document.querySelector(`#grid tbody tr td[data-col="${CSS.escape(c)}"]`);
    return what==='align'?getComputedStyle(td).textAlign
         : what==='title'?td.title : td.textContent.trim();
   },[col,pick]);
  };
  const cellOf=col=>cellIn(col,'text');
  const rawOf=col=>page.evaluate(c=>String(S.rows[0][c]??''),col);

  const rawText=await rawOf(textCol),rawNum=await rawOf(numCol);
  await page.evaluate(async a=>{
   await WL.columnLayout.save(listLayoutTarget(),{order:[],widths:{[a.textCol]:150},hidden:[],
    names:{[a.textCol]:'材質(表示名)'},
    formats:{[a.textCol]:{kind:'text',prefix:'<',suffix:'>'},
             [a.numCol]:{kind:'number',decimals:2,suffix:'mm'}}});
   renderGrid();
  },{textCol,numCol});
  await page.waitForTimeout(250);
  rec('書式が一覧のセルに効く',await cellOf(textCol)===`<${rawText}>`,
   `${rawText} -> ${await cellOf(textCol)}`);
  rec('整形できない列は一覧でも生のまま',await cellOf(numCol)===rawNum,
   `${rawNum} -> ${await cellOf(numCol)}`);
  /* 数値の書式を当てた列は列ごと右づめ(桁を縦に揃えて読むため)。値ごとに
     決めると、数値として読めない値が1つ混ざった列で揃い方が乱れる。 */
  const align=async col=>({
   th:await page.evaluate(c=>getComputedStyle(
     document.querySelector(`#grid th[data-sort-col="${CSS.escape(c)}"]`)).textAlign,col),
   td:await cellIn(col,'align'),
  });
  const alignNum=await align(numCol),alignText=await align(textCol);
  /* ---- 揃え(§9.239 ④、利用者の指示) ----
     「数値は右詰め、文字列は左詰めなど自動で書式に合わせた設定になりますが、
      手動での任意変更もできるように」「カラムの文字列はデータとは別で
      中央位置をデフォルトにして、データの位置に追従するか、別で設定するかを
      選べるように」

     **見出しの既定は中央**（データの揃えとは別）。以前はセルと同じ
     `.col-num`が見出しにも付いており、見出しは常にデータへ追従していた
     ——利用者の言う「データとは別で」が表現できていなかった。 */
  rec('数値の列のセルは自動で右づめ',alignNum.td==='right',JSON.stringify(alignNum));
  rec('見出しの既定は中央（データとは別）',alignNum.th==='center'&&alignText.th==='center',
      JSON.stringify({num:alignNum.th,text:alignText.th}));
  rec('数値以外の列は右づめにしない',alignText.td!=='right',JSON.stringify(alignText));
  /* **手で決めた揃えは書式に勝つ**（「任意変更」の意味）。数値の列を左へ、
     文字の列を中央へ寄せて、両方が効くことを見る——数値の列だけを見ると、
     自動判定を潰しても通る。 */
  await page.evaluate(async a=>{
   await WL.columnLayout.patch(listLayoutTarget(),
    {aligns:{[a.numCol]:{data:'left',head:''},[a.textCol]:{data:'center',head:'follow'}}});
   renderGrid();
  },{textCol,numCol});
  await page.waitForTimeout(250);
  const manNum=await align(numCol),manText=await align(textCol);
  rec('手で決めた揃えは書式より強い（数値の列を左へ）',manNum.td==='left',JSON.stringify(manNum));
  rec('見出しは「データに追従」を選べる',manText.th==='center'&&manText.td==='center',
      JSON.stringify(manText));
  rec('見出しを追従にしていない列は中央のまま',manNum.th==='center',JSON.stringify(manNum));
  /* **開き直しても残る**（保存の往復。§9.212 ②で `aligns` を
     `fields`／`keep`／`extra` の3箇所へ足し忘れると、ここで落ちる）。 */
  {
   const saved=await (await fetch(B+'/api/column-layout-master?target='
     +encodeURIComponent(await page.evaluate(()=>listLayoutTarget())))).json();
   const a=(saved.aligns||{})[numCol]||{};
   rec('揃えがマスタへ往復する',a.data==='left',JSON.stringify(saved.aligns||{}));
  }
  /* 元へ戻して、以降の検査に影響させない。 */
  await page.evaluate(async()=>{await WL.columnLayout.patch(listLayoutTarget(),{aligns:{}});renderGrid()});
  await page.waitForTimeout(200);
  rec('整形した値はツールチップで元の値が分かる',
   await cellIn(textCol,'title')===rawText);

  /* ---- 4) 開き直しても残る / 他の設定を巻き添えにしない ---- */
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(()=>document.querySelectorAll('#grid table thead th').length>3,{timeout:25000});
  await page.waitForTimeout(1200);
  rec('開き直しても書式が残る',await cellOf(textCol)===`<${rawText}>`,await cellOf(textCol));
  const kept=await page.evaluate(c=>({
   name:WL.columnLayout.label(listLayoutTarget(),c),
   width:WL.columnLayout.width(listLayoutTarget(),c),
   fmt:WL.columnLayout.format(listLayoutTarget(),c),
  }),textCol);
  rec('表示名も幅も一緒に残る',kept.name==='材質(表示名)'&&kept.width===150,JSON.stringify(kept));

  /* **要点**: 保存は全置換。見出しをD&Dしただけで書式や表示名が消えると、
     利用者は「勝手に戻った」としか見えない(原因にたどり着けない)。 */
  await page.evaluate(()=>{
   const t=listLayoutTarget(),l=WL.columnLayout.get(t);
   return WL.columnLayout.save(t,{order:[...l.order].reverse(),widths:l.widths,hidden:l.hidden,
                                  names:l.names,formats:l.formats});
  });
  const after=await (await fetch(B+'/api/column-layout-master?target='+encodeURIComponent(target))).json();
  rec('並べ替えても書式が消えない',!!(after.formats||{})[textCol],JSON.stringify(after.formats||{}));
  rec('並べ替えても表示名が消えない',(after.names||{})[textCol]==='材質(表示名)');

  /* ---- 5) 設定パネルの右ペイン ---- */
  await page.evaluate(()=>WL.listColumns.open());
  await page.waitForTimeout(400);
  /* **パネルが画面の中に開くこと。** 位置と大きさは共通のフローティング
     ウィンドウ(WL.makeFloatingWindow)が与える。公開漏れで呼べていないと、
     幅も高さも与えられず**プレビューの列数だけ横に伸びて画面外に開く**
     (実際に起きた。見えないので操作もできない)。 */
  const rect=await page.evaluate(()=>{
   const r=document.getElementById('listColumnPanel').getBoundingClientRect();
   return {w:Math.round(r.width),h:Math.round(r.height),
           left:Math.round(r.left),top:Math.round(r.top),vw:innerWidth,vh:innerHeight};
  });
  rec('列の設定パネルは画面の中に開く',
   rect.left>=0&&rect.top>=0&&rect.left+rect.w<=rect.vw+1&&rect.top+rect.h<=rect.vh+1,
   JSON.stringify(rect));
  rec('プレビューの列数でパネルが横に伸びない',rect.w<=rect.vw,`${rect.w}px / 画面${rect.vw}px`);
  await page.evaluate(c=>{
   const el=[...document.querySelectorAll('#lcList .lc-item')].find(x=>x.dataset.key===c);
   el&&el.click();
  },textCol);
  await page.waitForTimeout(200);
  const pane=await page.evaluate(()=>({
   kinds:document.querySelectorAll('#lcDetail input[name="lcKind"]').length,
   picked:document.querySelector('#lcDetail input[name="lcKind"]:checked')?.value,
   sample:document.getElementById('lcSample')?.textContent.trim()||'',
  }));
  rec('右ペインで書式の種別を選べる',pane.kinds===4,`${pane.kinds}種`);
  rec('保存済みの種別が選ばれている',pane.picked==='text',pane.picked);
  rec('例として「生の値 → 見え方」が出る',
   pane.sample.includes(rawText)&&pane.sample.includes(`<${rawText}>`),pane.sample);

  // 数値へ切り替えると、その種別の項目だけが開く
  await page.evaluate(()=>{
   const el=[...document.querySelectorAll('#lcDetail input[name="lcKind"]')].find(x=>x.value==='number');
   el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForTimeout(200);
  const numPane=await page.evaluate(()=>({
   dec:!!document.getElementById('lcDecimals'),
   thou:!!document.getElementById('lcThousands'),
   pattern:!!document.getElementById('lcPattern'),
  }));
  rec('数値を選ぶと小数桁と桁区切りが開く',numPane.dec&&numPane.thou,JSON.stringify(numPane));
  rec('数値のときは日付のパターン欄を出さない',!numPane.pattern);
  await page.evaluate(()=>{
   const el=[...document.querySelectorAll('#lcDetail input[name="lcKind"]')].find(x=>x.value==='datetime');
   el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForTimeout(200);
  const dtPane=await page.evaluate(()=>({
   preset:document.querySelectorAll('#lcPreset option').length,
   pattern:document.getElementById('lcPattern')?.value||'',
  }));
  rec('日付を選ぶとよく使う形から選べる',dtPane.preset>=5,`${dtPane.preset}件`);
  rec('日付を選ぶとパターンが既定で入る',/y/.test(dtPane.pattern),dtPane.pattern);

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));

  console.log('\n=== SUMMARY ===');
  const bad=R.filter(r=>!r.ok);console.log(`${R.length-bad.length}/${R.length} passed`);
  bad.forEach(x=>console.log(' -',x.n,x.d||''));
  await b.close();b=null;
  await clear();
  process.exit(bad.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  if(b)await b.close().catch(()=>{});
  await clear()?.catch(()=>{});
  process.exit(2);
 }
})();
