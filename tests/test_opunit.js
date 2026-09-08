/* test_opunit.js: 自動で入る値の見せ方・単位の置き場・出どころの添え書き（§9.233）
   ================================================================
   利用者の指示（2①②③④⑤）:
     ①「自動で入る値についても、選んで設定できるようにしてください」
     ②「自動で入る値の場合、単位設定や外観変更などしても変更が効かないものが
        多いです。不具合修正してください」
     ③「追加したばかりの『母材』のところだけ、単位を内部に入れ込んで設定した
        ときにデータ入力を右寄せにすると単位と被ってしまいます」
     ④「単位を設定するときに位置を選べますが、選択したUIによっては、単位の
        位置のずれや単位が出ないということがあるので、間違いなくUIの位置に
        対して指定した位置に出ているか確認して修正してください」
     ⑤「こういった自動の連携内容の補助的な説明文字のONOFFができるように、
        もっとコンパクトにかつ位置も選べるようにしてほしいです」

   ここで固定すること:
    - 自動で入る値（`<output>`）にも選ばせ方が3つある（プルダウン／文字だけ／強調）
    - 単位・寄せ・意匠が`<output>`にも効く（以前は`valueEl()`が拾わず全部落ちていた）
    - 母材の欄で「内部の単位 × 右寄せ」でも値が単位に重ならない
    - **どの入力方法でも**、指定した位置に単位が出る（器を被せた欄では
      「見えている操作面」が基準。以前は外下が器の**上**へ出ていた）
    - 手打ちを許したプルダウンは内部に重ねられない（`<select>`が裏方になる）
    - 出どころの添え書きは1行・置き場3通り・選び直したら消える

   **数や有無だけを見ないこと**——「単位の要素がある」だけでは、器の上に
   出ていても通る。**実寸で位置を突き合わせる**。
   ================================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const W=require('./lib/wait');   // 待ちは条件で置き、成立しなければ記録に残す（§9.360）
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const post=(p,x)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(x)}).then(async r=>({st:r.status,body:await r.json().catch(()=>({}))}));
const get=p=>fetch(B+p).then(r=>r.json());

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1680,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('dialog',d=>d.accept());
 /* 触った行は**丸ごと控えて丸ごと戻す**（§9.121）——`item_upsert`は全列を
    書くので、1項目だけ送り返すと他の設定が消える。 */
 const backup=[];
 const saveItem=x=>post('/api/operation-item-master/update',{user_id:'tests',
   id:x.id,equipment:x.equipment||'*',group:x.group,name:x.name,type:x.type||'',
   place:x.place,span:x.span,required:!!x.required,enabled:x.enabled!==false,
   widget:x.widget,unit:x.unit||'',note:x.note||'',initial:x.initial||'',
   layout:x.layout||'自動',groupSpan:x.groupSpan||0,dummy:!!x.dummy,noBlank:!!x.noBlank,
   role:x.role||'',look:x.look||null,unitPlace:x.unitPlace,align:x.align,
   valueFormat:x.valueFormat,digits:x.digits,choice:x.choice||'',freeText:!!x.freeText,
   /* **畳みと開く条件も必ず送る**（§9.121／§9.212 ②）——`item_upsert`は
      全列を書くので、送らないと`[群折りたたみ]`が0で上書きされ、**次の
      実行の`test_msteps`が「その他の設定を畳めない」で落ちる**（実際に
      落とした。群の畳みは「1つでも畳むと言えば畳む」なので、1行消しただけで
      群ごと開く）。 */
   fold:!!x.fold,showWhen:x.showWhen||[],
   minFrom:x.minFrom||'',maxFrom:x.maxFrom||'',sourceNote:x.sourceNote||''});
 try{
  await post('/api/access-mode',{mode:'edit'});

  /* ==========================================================
     1) サーバー: 語彙（**画面へ書き写さない**・§9.163）
     ========================================================== */
  const list=await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
  rec('自動で入る値にも選ばせ方がある（①）',
      JSON.stringify((list.widgetFamilies||{}).output||[])==='["プルダウン","文字だけ","強調"]',
      JSON.stringify((list.widgetFamilies||{}).output));
  rec('添え書きの置き場をサーバーが答える（⑤）',
      JSON.stringify(list.sourceNotePlaces||[])==='["欄の下","名前の横","出さない"]',
      JSON.stringify(list.sourceNotePlaces));
  rec('添え書きを持つ項目もサーバーが答える（⑤）',
      (list.sourceNoteKeys||[]).includes('innerDiameter'),
      JSON.stringify(list.sourceNoteKeys));
  /* ---- 単位を重ねられるか（§9.255 ③、利用者の指示） ----
     「プルダウンやメニュー、一覧、パネル…選択後にテキストボックスにデータが
      入るときに単位が内部にも収まるようにすることで、見せ方で内部も選べる
      ようにして反映できるように」
     **規則はサーバーの`unit_in_ok()`が1箇所で持つ**（画面は一覧を引くだけ）。
     以前は「プルダウン＋自動で入る値の3つ」だけを許し、手打ちのプルダウンを
     断っていた——あれは**単位を1pxの裏方の`<select>`の隣へ置いていた**ための
     不具合で、規則の話ではなかった。置き場を器の中へ直したので、
     **重ねる面が1つある形はすべて重ねられる**。 */
  rec('重ねられないのは「面が1つに決まらない」形だけ（③）',
      JSON.stringify(list.unitInBlocked||[])
      ==='["ラジオ","セグメント","タブ","ボタン群","カード","トグル","段階","メモ"]',
      JSON.stringify(list.unitInBlocked));
  rec('メニュー・一覧・パネル・切替・入切も内部に重ねられる（③）',
      ['メニュー','一覧','パネル','切替','入切']
        .every(w=>!(list.unitInBlocked||[]).includes(w)),
      JSON.stringify(list.unitInBlocked));
  rec('数を入れる形・自動で入る値も内部に重ねられる（②③）',
      ['ステッパー','スピナー','スライダー','キーパッド','早見ボタン','メーター',
       '1行','定型文','文字だけ','強調']
        .every(w=>!(list.unitInBlocked||[]).includes(w)),
      JSON.stringify(list.unitInBlocked));
  /* 手打ちは**面を減らさない**（コンボの入力欄がその面）ので、いまは断らない。
     規則から導いた一覧なので、将来「手打ちにすると面が消える」形が出たら
     ここが勝手に埋まる（§9.163）。 */
  rec('手打ちを許しても重ねられる（③）',
      JSON.stringify(list.unitInFreeTextBlocked||[])==='[]',
      JSON.stringify(list.unitInFreeTextBlocked));

  const items=list.items||[];
  const byKey=k=>items.find(x=>x.builtin===k&&(x.equipment==='*'||x.equipment===EQ));
  const inner=byKey('innerDiameter'),width=byKey('motherOriginalWidth'),
        manual=byKey('motherManual'),coil=byKey('coilStop');
  rec('前提: 触る4つの行がある',!!(inner&&width&&manual&&coil),
      JSON.stringify({inner:!!inner,width:!!width,manual:!!manual,coil:!!coil}));
  if(!(inner&&width&&manual&&coil))throw Error('前提の行が無い');
  /* 控えは**保存値**で持つ（`unitPlace`は「効いている値」なので、
     落ちた状態のまま書き戻すと元の設定が消える）。 */
  [inner,width,manual,coil].forEach(x=>backup.push(
    {...x,unitPlace:x.unitPlaceSaved||x.unitPlace}));

  /* ==========================================================
     2) サーバー: 添え書きの置き場が往復する（⑤）
     ========================================================== */
  await saveItem({...inner,sourceNote:'名前の横'});
  let now=(await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ)))
    .items.find(x=>x.id===inner.id);
  rec('添え書きの置き場が保存できる（⑤）',now&&now.sourceNote==='名前の横',
      now&&now.sourceNote);
  /* **送らなければ今の値を保つ**（§9.212 ②「送った項目だけ書く」）。 */
  await post('/api/operation-item-master/update',
    {user_id:'tests',id:inner.id,name:inner.name,equipment:inner.equipment,
     group:inner.group,type:inner.type||''});
  now=(await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ)))
    .items.find(x=>x.id===inner.id);
  rec('置き場を送らない保存で消えない（⑤・§9.212 ②）',
      now&&now.sourceNote==='名前の横',now&&now.sourceNote);
  /* **知らない値は既定へ**（保存済みの行が「知らない値」になって消えない）。 */
  await saveItem({...inner,sourceNote:'よそ'});
  now=(await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ)))
    .items.find(x=>x.id===inner.id);
  rec('知らない置き場は既定（欄の下）へ落とす（⑤）',
      now&&now.sourceNote==='欄の下',now&&now.sourceNote);

  /* 手打ちを許したプルダウン＋内部は**そのまま効く**（§9.255 ③）。 */
  await saveItem({...coil,widget:'プルダウン',freeText:true,unit:'mm',unitPlace:'内部'});
  now=(await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ)))
    .items.find(x=>x.id===coil.id);
  rec('手打ち＋内部がそのまま効く（③）',now&&now.unitPlace==='内部',
      JSON.stringify(now&&{効:now.unitPlace,保存:now.unitPlaceSaved}));
  /* 面が1つに決まらない形＋内部 → サーバーが外下左へ落とす（④）。
     **保存値は残す**（形を戻したら復活する）。 */
  await saveItem({...coil,widget:'セグメント',freeText:false,unit:'mm',unitPlace:'内部'});
  now=(await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ)))
    .items.find(x=>x.id===coil.id);
  rec('セグメント＋内部は外下左へ落ちる（④）',
      now&&now.unitPlace==='外下左'&&now.unitPlaceSaved==='内部',
      JSON.stringify(now&&{効:now.unitPlace,保存:now.unitPlaceSaved}));
  await saveItem({...coil,widget:'プルダウン',freeText:false,unit:'mm',unitPlace:'内部'});
  now=(await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ)))
    .items.find(x=>x.id===coil.id);
  rec('形を戻すと内部が復活する（④）',now&&now.unitPlace==='内部',
      now&&now.unitPlace);

  /* ==========================================================
     3) 測定画面
     ========================================================== */
  const openMeasure=async()=>{
   await page.goto(B+'/',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('#openSchedule',{timeout:25000});
   await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForSelector('#openSchedule',{timeout:25000});
   await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
   await page.click('#openSchedule');
   await page.waitForSelector('.sc-row-line',{timeout:25000});
   const ok=await page.evaluate(()=>{
    const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
    if(r){r.querySelector('.sc-row-start').click();return true}return false;
   });
   if(!ok)throw Error('開始できる行が無い');
   await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
   await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
   await page.waitForTimeout(700);
  };
  await openMeasure();

  /* いま効いている定義を直に差し替えて割り付け直す。**サーバーの規則を
     迂回してよいのは「置き方」を確かめる場面だけ**——規則そのものは上の
     2)で当てている（判定を2つ持たない・§9.163）。 */
  const setDef=(k,p)=>page.evaluate(([k,p])=>{
   const d=WL.opData.defs().find(x=>x.builtin===k);
   if(!d)return false;
   Object.assign(d,p);
   if(p.widget!==undefined)d.widgetLive=p.widget;
   WL.opData.layout();
   return true;
  },[k,p]);
  /* 見えている操作面（器があれば器）を基準に、単位がどこに在るかを読む。 */
  const where=sel=>page.evaluate(s=>{
   const host=document.querySelector(s);
   if(!host)return null;
   const num=el=>{const x=el.getBoundingClientRect();
     return {l:Math.round(x.left),r:Math.round(x.right),t:Math.round(x.top),
             b:Math.round(x.bottom),w:Math.round(x.width),h:Math.round(x.height)}};
   const ctl=host.querySelector(':scope>select,:scope>input:not([type=hidden]),:scope>output');
   const box=host.querySelector(':scope>.opf-widget:not(.opf-plain)');
   /* **器の中も探す**（§9.255 ③）——器を被せた形の`内部`は、いまの値の
      直後（器の中）へ入る。直下だけを見ると「なし」と読み違える。 */
   const uin=host.querySelector('.opf-unit-in');
   const ul=host.querySelector(':scope>.opf-unit-line');
   const shown=box||ctl;
   let at='なし';
   if(uin)at='内部';
   else if(ul&&shown){
    const a=ul.getBoundingClientRect(),c=shown.getBoundingClientRect();
    if(!a.height&&!c.height)at='測れず';
    else at=(a.bottom<=c.top+2?'上':(a.top>=c.bottom-2?'下':'重'))+(ul.dataset.at||'');
   }
   const cs=ctl?getComputedStyle(ctl):null;
   /* 値の右端＝欄の右端 − 右余白 − 罫線。ここが単位の左端より右なら重なる。 */
   const right=ctl?Math.round(ctl.getBoundingClientRect().right
     -parseFloat(cs.paddingRight)-parseFloat(cs.borderRightWidth)):null;
   return {位置:at,欄:ctl?num(ctl):null,器:box?num(box):null,
     単位:(uin||ul)?num(uin||ul):null,値の右端:right,
     寄せ:cs?cs.textAlign:null,並び:cs?cs.justifyContent:null,
     枠:cs?cs.borderTopColor:null,文字:cs?cs.fontSize:null,高さ:cs?cs.height:null,
     見出し:cs?null:null,
     opout:host.dataset.opout||'',opunit:host.dataset.opunit||'',
     意匠:[...host.classList].filter(c=>/^opf-[crz]-/.test(c)).join(' ')};
  },sel);

  /* ---------- ④ 入力方法 × 単位の位置 ---------- */
  await page.evaluate(()=>WL.measureSteps.go(1));
  await page.waitForTimeout(500);
  const want={'外上左':'上左','外上中央':'上中央','外上右':'上右',
              '内部':'内部','外下左':'下左','外下中央':'下中央','外下右':'下右',
              '出さない':'なし'};
  /* 器を被せない（プルダウン）・被せる（セグメント／ボタン群／一覧）を混ぜる
     ——以前は器が後から末尾へ足されるせいで、**外下が器の上へ**出ていた。 */
  for(const w of ['プルダウン','セグメント','ボタン群','一覧']){
   const bad=[];
   for(const pl of Object.keys(want)){
    await setDef('coilStop',{unit:'mm',unitPlace:pl,widget:w,freeText:false});
    await page.waitForTimeout(160);
    const r=await where('[data-f="coilStop"]');
    if(!r||r.位置!==want[pl])bad.push(pl+'→'+(r?r.位置:'?'));
   }
   rec('「'+w+'」でも単位が指定どおりの位置に出る（④）',bad.length===0,bad.join(' '));
  }

  /* ---------- ③ 内部＝「値の出る面の中」（§9.255 ③、利用者の指示） ----------
     「UIのテキストボックスの内部に入れられない(「内部」を選べない)ものがあり…
      選択後にテキストボックスにデータが入るときに単位が内部にも収まるように」

     **「`.opf-unit-in`が在る」だけを見る網では捕まらない**——直す前も
     要素そのものは在って、**器の14px上**に出ていた（実測）。値を出す面の
     矩形と突き合わせ、**中に入っていること**と**いまの値に重なっていないこと**
     まで見る。 */
  const faceProbe=sel=>page.evaluate(s=>{
   const host=document.querySelector(s);if(!host)return null;
   const R=el=>{if(!el)return null;const x=el.getBoundingClientRect();
     return {l:Math.round(x.left),r:Math.round(x.right),t:Math.round(x.top),
             b:Math.round(x.bottom),w:Math.round(x.width),h:Math.round(x.height)}};
   /* いま見えている「値の面」。器を被せた形は器の中のボタン／入力欄。 */
   const face=host.querySelector(':scope>.opf-widget:not(.opf-plain)>button,'
     +':scope>.opf-widget .opf-combo-in')
     ||host.querySelector(':scope>select,:scope>input:not([type=hidden]),:scope>output');
   const now=host.querySelector('.opf-pick-now,.opf-cycle-now,.opf-switch-text');
   const uin=host.querySelector('.opf-unit-in');
   const f=face&&face.getBoundingClientRect(),u=uin&&uin.getBoundingClientRect();
   const n=now&&now.getBoundingClientRect();
   return {面:R(face),単位:R(uin),いまの値:R(now),
     見える:!!(u&&u.width>0&&u.height>0),
     中:!!(u&&f&&u.left>=f.left-1&&u.right<=f.right+1&&u.top>=f.top-1&&u.bottom<=f.bottom+1),
     値に重ならない:!n||!u||u.left>=n.right-1};
  },sel);
  for(const w of ['メニュー','一覧','パネル','切替','入切']){
   await setDef('coilStop',{unit:'mm',unitPlace:'内部',widget:w,freeText:false});
   await page.waitForTimeout(200);
   const r=await faceProbe('[data-f="coilStop"]');
   rec('「'+w+'」で単位が値の面の中に収まる（③）',
       !!(r&&r.見える&&r.中&&r.値に重ならない),JSON.stringify(r));
  }
  /* 手打ちのプルダウン（コンボ）は**打ち込む欄のすぐ隣**（▾の手前）。 */
  await setDef('coilStop',{unit:'mm',unitPlace:'内部',widget:'プルダウン',freeText:true});
  await page.waitForTimeout(240);
  const cb=await page.evaluate(()=>{
   const host=document.querySelector('[data-f="coilStop"]');
   const box=host&&host.querySelector(':scope>.opf-combo');
   const inp=host&&host.querySelector('.opf-combo-in');
   const uin=host&&host.querySelector('.opf-unit-in');
   if(!box||!inp||!uin)return null;
   const b=box.getBoundingClientRect(),i=inp.getBoundingClientRect(),
         u=uin.getBoundingClientRect();
   return {器の中:u.left>=b.left-1&&u.right<=b.right+1,
           欄の右:u.left>=i.right-1,幅:Math.round(u.width)};
  });
  rec('手打ちのプルダウンでも単位が器の中に収まる（③）',
      !!(cb&&cb.器の中&&cb.欄の右&&cb.幅>0),JSON.stringify(cb));
  await setDef('coilStop',{unit:'mm',unitPlace:'外下左',widget:'プルダウン',freeText:false});

  /* ---------- 内部の単位 × 数の道具（§9.257 ①、利用者の報告） ----------
     「操業データ項目の…『見せ方』で単位を表示する機能がありますが、単位の
      表示位置を内部設定にした場合、微妙に単位が被っている」

     欄の右端の帯（スピナー等）の幅は`--opf-num-w`が持つが、以前これは
     `em`で渡っていた。カスタムプロパティの`em`は**使った場所の文字サイズ**で
     解けるので、1つの変数が読む場所ごとに違う数になっていた——単位は
     `--fs-badge`（10px）で解くため、帯（器の14px）より手前で場所取りを
     やめて帯の下へ潜っていた（実測: ステッパー −6.6px／スライダー −0.6px／
     スピナー +0.2px＝見た目には接する）。

     **「帯が在る」「単位が在る」だけを見る網では捕まらない**（直す前も
     両方在った）。矩形で突き合わせ、しかも**道具ごとに空きが同じ**ことまで
     見る——1つの変数が1つの数なら、幅の違う帯でも空きは同じになる。
     道具ごとに違えば、どこかがまた`em`で解けている。 */
  const numProbe=nm=>page.evaluate(n=>{
   const el=document.querySelector('[data-op="'+n.replace(/"/g,'\\"')+'"]');
   const host=el&&el.closest('label');
   if(!host)return null;
   const strip=host.querySelector('.opf-num-strip'),unit=host.querySelector('.opf-unit-in');
   const cs=getComputedStyle(el),e=el.getBoundingClientRect();
   const s=strip&&strip.getBoundingClientRect(),u=unit&&unit.getBoundingClientRect();
   return {帯:!!strip,単位:!!(u&&u.width>0),
     空き:(s&&u)?Math.round((s.left-u.right)*10)/10:null,
     値の右端:Math.round(e.right-parseFloat(cs.paddingRight)-parseFloat(cs.borderRightWidth)),
     単位の左端:u?Math.round(u.left):null,帯の幅:s?Math.round(s.width*10)/10:null};
  },nm);
  const NUMNAME='スリット 刃径';        /* 種は`operation_repo._SEED_ITEMS`（正の数） */
  const setNum=p=>page.evaluate(([n,p])=>{
   const d=WL.opData.defs().find(x=>x.name===n);
   if(!d)return false;
   Object.assign(d,p);
   if(p.widget!==undefined)d.widgetLive=p.widget;
   WL.opData.layout();return true;
  },[NUMNAME,p]);
  rec('前提: 数の欄がある（'+NUMNAME+'）',await setNum({unit:'MPa',unitPlace:'内部'}));
  const gaps={};
  for(const w of ['スピナー','ステッパー','スライダー','キーパッド']){
   await setNum({unit:'MPa',unitPlace:'内部',widget:w,min:0,max:10,step:0.1});
   await page.waitForTimeout(180);
   const r=await numProbe(NUMNAME);
   gaps[w]=r&&r.空き;
   rec('「'+w+'」で単位が帯に被らない（§9.257 ①）',
       !!(r&&r.帯&&r.単位&&r.空き>0),JSON.stringify(r));
   rec('「'+w+'」で値の字も帯・単位に潜らない（§9.250 ⑨）',
       !!(r&&r.値の右端<=r.単位の左端),JSON.stringify(r));
  }
  {const v=Object.values(gaps);
   rec('道具が変わっても空きは同じ＝1つの変数が1つの数（§9.257 ①）',
       v.length===4&&v.every(x=>x!==null&&Math.abs(x-v[0])<0.6),JSON.stringify(gaps));}
  /* 意匠の「大きさ」を変えても崩れない——欄の文字だけが変わる形なので、
     ここが`em`だと今度は**値のほう**が帯の下へ潜る。 */
  for(const z of ['小','大']){
   await setNum({unit:'MPa',unitPlace:'内部',widget:'スピナー',min:0,max:10,step:0.1,
                 look:{color:'既定',shape:'標準',size:z}});
   await page.waitForTimeout(180);
   const r=await numProbe(NUMNAME);
   rec('大きさ「'+z+'」でも被らない（§9.257 ①）',
       !!(r&&r.空き>0&&r.値の右端<=r.単位の左端),JSON.stringify(r));
  }
  await setNum({unit:'mm',unitPlace:'外下左',widget:'プルダウン',
                look:{color:'既定',shape:'標準',size:'中'}});

  /* ---------- ③ 母材: 内部の単位 × 右寄せ ---------- */
  await page.evaluate(()=>WL.measureSteps.go(2));
  await page.waitForTimeout(600);
  await setDef('motherManual',{unit:'mm',unitPlace:'内部',align:'右'});
  await page.waitForTimeout(250);
  await page.evaluate(()=>{const i=document.getElementById('motherManual');if(i)i.value='1234.5'});
  const m=await where('[data-f="motherManual"]');
  rec('前提: 母材の欄に内部の単位が出ている（③）',
      !!(m&&m.位置==='内部'&&m.単位&&m.単位.w>0),JSON.stringify(m&&{位:m.位置,単:m.単位}));
  rec('母材で右寄せにしても値が単位に重ならない（③）',
      !!(m&&m.単位&&m.値の右端!=null&&m.単位.l>=m.値の右端),
      JSON.stringify(m&&{値の右端:m.値の右端,単位の左端:m.単位&&m.単位.l,寄せ:m.寄せ}));
  rec('単位と値は同じ段に出る（③）',
      !!(m&&m.単位&&m.欄&&Math.abs((m.単位.t+m.単位.h/2)-(m.欄.t+m.欄.h/2))<=3),
      JSON.stringify(m&&{欄:m.欄,単位:m.単位}));

  /* ---------- ①② 自動で入る値 ---------- */
  const base=await where('[data-f="motherOriginalWidth"]');
  rec('前提: 元幅（実績）は自動で入る値（`<output>`）',
      !!(base&&base.欄&&base.欄.h>0),JSON.stringify(base&&base.欄));
  await setDef('motherOriginalWidth',{unit:'mm',unitPlace:'内部',align:'右',
    widget:'強調',look:{color:'赤',shape:'大きめ',size:'大'}});
  await page.waitForTimeout(250);
  const strong=await where('[data-f="motherOriginalWidth"]');
  rec('自動で入る値にも単位が出る（②）',
      !!(strong&&strong.位置==='内部'&&strong.単位&&strong.単位.w>0),
      JSON.stringify(strong&&{位:strong.位置,単:strong.単位}));
  rec('自動で入る値の寄せが効く（②）',strong&&strong.並び==='flex-end',
      strong&&strong.並び);
  rec('自動で入る値に意匠（色・形・大きさ）が効く（②）',
      !!(strong&&strong.意匠.includes('opf-c-red')&&strong.意匠.includes('opf-z-lg')
         &&base&&parseFloat(strong.文字)>parseFloat(base.文字)),
      JSON.stringify({意匠:strong&&strong.意匠,前:base&&base.文字,後:strong&&strong.文字}));
  rec('自動で入る値でも値が単位に重ならない（②）',
      !!(strong&&strong.単位&&strong.値の右端!=null&&strong.単位.l>=strong.値の右端),
      JSON.stringify(strong&&{値の右端:strong.値の右端,単位の左端:strong.単位&&strong.単位.l}));
  await setDef('motherOriginalWidth',{unit:'mm',unitPlace:'外下右',align:'中央',
    widget:'文字だけ',look:{}});
  await page.waitForTimeout(250);
  const bare=await where('[data-f="motherOriginalWidth"]');
  rec('選ばせ方「文字だけ」で枠が消える（①）',
      !!(bare&&bare.opout==='文字だけ'&&/rgba\(0, 0, 0, 0\)|transparent/.test(bare.枠)),
      JSON.stringify(bare&&{opout:bare.opout,枠:bare.枠}));
  rec('「文字だけ」でも単位は指定どおり外下右（①②）',
      bare&&bare.位置==='下右',bare&&bare.位置);

  /* ---------- ⑤ 出どころの添え書き ---------- */
  await page.evaluate(()=>WL.measureSteps.go(1));
  await page.waitForTimeout(500);
  const preset=await page.evaluate(()=>{
   /* 仕掛から目標値が来た状態を作る（検証用フィクスチャにこの列は無い）。 */
   S.measure.source=S.measure.source||{};
   S.measure.source['ｺｲﾙ_内径目標']='508';
   S.measure.settings.innerDiameter='-';
   return WL.innerDiameter.apply(S.measure.source);
  });
  rec('前提: 仕掛からの初期値が当たっている（⑤）',preset==='508',String(preset));
  const note=()=>page.evaluate(()=>{
   const n=document.getElementById('innerDiameterFrom');
   const host=document.querySelector('[data-f="innerDiameter"]');
   const nb=host&&host.querySelector(':scope>.opf-name');
   const other=document.querySelector('[data-f="spool"]');
   const cs=n?getComputedStyle(n):null;
   const h=n&&!n.hidden?n.getBoundingClientRect().height:0;
   return {隠:n?n.hidden:null,文:(n&&n.textContent)||'',
     親:n&&n.parentElement?(n.parentElement.className||n.parentElement.tagName):'',
     折返:cs?cs.whiteSpace:null,
     行数:h?+(h/parseFloat(cs.lineHeight)).toFixed(2):0,
     欄の高さ:host?Math.round(host.getBoundingClientRect().height):null,
     隣の高さ:other?Math.round(other.getBoundingClientRect().height):null,
     ヒント:!!(n&&n.title)};
  });
  const seen={};
  for(const at of ['欄の下','名前の横','出さない']){
   await setDef('innerDiameter',{sourceNote:at,widget:'プルダウン'});
   await page.waitForTimeout(220);
   seen[at]=await note();
  }
  rec('「欄の下」は欄の下に1行で出る（⑤）',
      !!(seen['欄の下'].隠===false&&seen['欄の下'].行数<=1.05
         &&seen['欄の下'].折返==='nowrap'),JSON.stringify(seen['欄の下']));
  rec('コンパクトになった（「仕掛 508」）（⑤）',
      seen['欄の下'].文==='仕掛 508',seen['欄の下'].文);
  rec('「名前の横」は名前の器の中へ入り、行を増やさない（⑤）',
      !!(seen['名前の横'].隠===false
         &&/opf-name/.test(seen['名前の横'].親)
         &&seen['名前の横'].欄の高さ===seen['名前の横'].隣の高さ),
      JSON.stringify(seen['名前の横']));
  rec('「欄の下」は1行ぶん背が高くなる（置き場が実際に効いている）（⑤）',
      seen['欄の下'].欄の高さ>seen['名前の横'].欄の高さ,
      JSON.stringify({下:seen['欄の下'].欄の高さ,横:seen['名前の横'].欄の高さ}));
  rec('「出さない」で消える（出どころはツールチップに残る）（⑤）',
      seen['出さない'].隠===true&&seen['出さない'].欄の高さ===seen['名前の横'].欄の高さ,
      JSON.stringify(seen['出さない']));
  /* **選び直したら消える**——「仕掛から来た値」でなくなるので（§9.204）。 */
  await setDef('innerDiameter',{sourceNote:'欄の下',widget:'プルダウン'});
  await page.evaluate(()=>{
   const el=document.getElementById('innerDiameter');
   if(![...el.options].some(o=>o.value==='400'))el.add(new Option('400','400'));
   el.value='400';WL.innerDiameter.refresh();
  });
  await page.waitForTimeout(200);
  rec('選び直すと添え書きは消える（⑤）',(await note()).隠===true);

  /* ==========================================================
     ⑥ 設定窓の見本（§9.276 ⑥、利用者の指示）
     ----------------------------------------------------------
     「単位の表示位置が追従していないことと、変更対象の単位をプレビューする
      ときの内部で表示するとき、単位が重複表示される」

     原因は、見本の`<label>`を設定窓が**自前で組み立てて**いたこと——
     `placeholder`に`0 mm`を入れていたので、「内部」にすると欄の中に
     `mm`が2つ見えた（実物の`fieldEl()`は`placeholder`を持たない）。
     いまは`WL.opData.buildPreviewField()`の1本を通す。
     **「単位の要素が1つ」だけを見ないこと**——`placeholder`は要素ではないので
     素通りする。**欄に見えている字**まで見る。
     ========================================================== */
  await page.evaluate(()=>{const b=document.getElementById('openMasterMaint');if(b)b.click()});
  await page.waitForSelector('#masterMaintNav',{timeout:20000});
  await page.evaluate(()=>document.querySelector('#masterMaintNav [data-master="opItem"]')?.click());
  await page.waitForSelector('.op-tile',{timeout:20000});
  const openTile=await page.evaluate(n=>{
   const t=[...document.querySelectorAll('.op-tile')].find(x=>(x.textContent||'').indexOf(n)>=0);
   if(!t)return false;t.click();return true;
  },NUMNAME);
  rec('前提: 見本の窓を「'+NUMNAME+'」で開ける（⑥）',openTile);
  await page.waitForFunction(()=>{const m=document.getElementById('opItemModal');return !!m&&!m.hidden},
    null,{timeout:10000});
  await page.waitForSelector('#opPrevField .opf',{timeout:10000});
  const prev=()=>page.evaluate(()=>{
   const host=document.getElementById('opPrevField');
   const f=host&&host.querySelector('.opf');
   if(!f)return null;
   const ctl=f.querySelector(':scope>select,:scope>input,:scope>output');
   const ins=f.querySelector('.opf-unit-in'),line=f.querySelector('.opf-unit-line');
   const r=e=>{const b=e.getBoundingClientRect();
     return {l:Math.round(b.left),t:Math.round(b.top),w:Math.round(b.width),h:Math.round(b.height)}};
   return {印:f.classList.contains('opf-host'),
     位置:f.dataset.opunit||'',
     単位の数:f.querySelectorAll('.opf-unit').length,
     内部:!!ins,下:!!(line&&!f.dataset.opunitTop),
     /* **欄に見えている字**——`placeholder`で単位を二重に出していないか。 */
     欄の字:ctl?String(ctl.placeholder||''):'',
     欄:ctl?r(ctl):null,単位:(ins||line)?r(ins||line):null};
  });
  /* 置き場の盤は`[data-op-unitplace]`（§9.221 ⑦の9マス）。**綴りで押す**
     ——文字で探すと、マスの見出しが記号のものを取りこぼす。 */
  const setUnit=at=>page.evaluate(a=>{
   const el=document.querySelector(`#opItemModal [data-op-unitplace="${a}"]`);
   if(el&&!el.disabled){el.click();return true}
   return false;
  },at);
  await page.waitForSelector('#opModalForm .op-form-sec[data-op-sec="look"]',{timeout:8000});
  await page.waitForTimeout(400);
  const pv={};
  for(const at of ['内部','外下左','外上左']){
   const ok=await setUnit(at);
   if(!ok){rec('前提: 単位の置き場「'+at+'」を選べる（⑥）',false);continue}
   /* **時間でなく状態で待つ**（§9.102・§9.356）。450ms の固定待ちでは通しの
      ときだけ間に合わず、**前の置き場のまま測って**落ちていた（実測: 「内部」を
      押したのに `位置:"外下左"` のまま）。見本の `data-opunit` が押した先に
      なるまで待つ——押した結果そのものを見るので、速い機械では待たない。 */
   /* **待ちは条件で置き、成立しなければ記録に残す**（§9.102・§9.360）。
      §9.360で一時的に「戻ったら押し直す」を入れていたが、**戻る側を
      §9.361で直した**ので要らなくなった（凌ぎは原因を直したら外す）。 */
   await W.until(page,a=>{
    const f=document.getElementById('opPrevField')?.querySelector('.opf');
    return !!f&&(f.dataset.opunit||'')===a;
   },at,{ms:8000,what:'見本の単位の置き場が「'+at+'」になる'});
   pv[at]=await prev();
  }
  rec('見本の単位は1つだけ（「内部」で二重に出さない）（⑥）',
      !!(pv['内部']&&pv['内部'].単位の数===1&&pv['内部'].内部===true),
      JSON.stringify(pv['内部']));
  rec('見本の欄が単位を`placeholder`でもう一度出さない（⑥）',
      !!(pv['内部']&&pv['内部'].欄の字.indexOf('mm')<0&&pv['内部'].欄の字.indexOf('MPa')<0),
      JSON.stringify(pv['内部']&&pv['内部'].欄の字));
  /* ---- 遅れて届いた再読み込みで、選んだ設定を捨てない（§9.361） ----
     利用者の指摘:「黙って戻るのは問題だし、戻ること自体望んでいないはず」。
     `opState.items`を丸ごと入れ替えるため、**開いている窓の未保存の変更が
     消えて**いた（画面上は「変えた約1秒後に元へ戻る」）。**再読み込みを
     実際に起こして**確かめる——待つのではなくレースそのものを作るので、
     速い機械でも遅い機械でも同じことを見る。 */
  await setUnit('内部');
  await W.until(page,()=>{
   const f=document.getElementById('opPrevField')?.querySelector('.opf');
   return !!f&&(f.dataset.opunit||'')==='内部';
  },null,{ms:8000,what:'見本の単位の置き場が「内部」になる'});
  const beforeReload=await page.evaluate(()=>document.getElementById('opPrevField')
    ?.querySelector('.opf')?.dataset.opunit||'');
  await page.evaluate(()=>WL.mm.special['op-item'].load(true));
  const afterReload=await page.evaluate(()=>document.getElementById('opPrevField')
    ?.querySelector('.opf')?.dataset.opunit||'');
  rec('遅れて届いた再読み込みで、選んだ単位の置き場が戻らない（§9.361）',
      beforeReload==='内部'&&afterReload==='内部',
      `再読み込み前=${beforeReload} / 後=${afterReload}`);

  rec('見本の単位は置き場に追従する（内部→外下→外上で実際に動く）（⑥）',
      !!(pv['内部']&&pv['外下左']&&pv['外上左']
         &&pv['外下左'].単位.t>pv['外下左'].欄.t
         &&pv['外上左'].単位.t<pv['外上左'].欄.t),
      JSON.stringify({内:pv['内部']&&pv['内部'].単位,下:pv['外下左']&&pv['外下左'].単位,
                      上:pv['外上左']&&pv['外上左'].単位}));
  rec('見本の欄には測定画面と同じ印（`opf-host`）が付く（⑥）',
      !!(pv['外下左']&&pv['外下左'].印===true),JSON.stringify(pv['外下左']));

  console.log('\n合計 '+R.filter(r=>r.ok).length+'/'+R.length+' PASS'
    +'  (FAIL: '+R.filter(r=>!r.ok).length+')');
  process.exitCode=R.some(r=>!r.ok)?1:0;
 }catch(e){
  console.log('FATAL: '+(e&&e.message));process.exitCode=1;
 }finally{
  for(const x of backup){try{await saveItem(x)}catch(e){}}
  /* 置いた実績は自分で消す（§9.351・§9.362）。残った実績は計画外実績として
     予定表に現れ、無関係な網を落とす。 */
  try{await require('./lib/harness.js').clearRecords()}catch(e){console.log('!! 実績の後片付けに失敗: '+(e&&e.message||e))}
  if(b)await b.close();
 }
})();
