/* test_opwidget.js: トグルの作り直しと、足した2つの選ばせ方（§9.247 ①）
   ============================================================
   利用者の指示:
     「操業データ項目のUIの見た目が、セグメントとトグルが似ています。
      差別化したいのですが可能でしょうか。セグメントのデザインと詰め込み
      具合は気に入っているので、デザイン変えるとしたらトグルの方です。
      別のUIも増やしてほしいのでバリエーションを追加してほしいです。
      フローティングメニューみたいなものや、クリックで選択肢が変化する
      タイプのUIなど、角丸デザインを細部まで踏襲してください。
      （カード、一覧、プルダウンなど少し踏襲されていない感じを受けます。）」

   §9.220 ①で`ラジオ`と`タブ`について書いたのとまったく同じ話が、
   `セグメント`と`トグル`で起きていた——どちらも「地色の帯＋2pxの隙間＋
   浮いた札をベタ塗り」で、違いは札が等幅か中身なりかだけ。名前が2つあって
   見た目が同じなら、選ばせる手間だけが残る。

   ここで固定すること。**どれも直す前なら落ちる**ことを確かめてある。
    1. セグメントは**触っていない**（地色の帯・隙間・ベタ塗り＋白文字）
       ——利用者が気に入っている側を勝手に変えない
    2. トグルはセグメントと**3つ以上違う**（隙間／塗り方／文字色）
    3. トグルの器は**中身なりの幅**（器いっぱいに伸びない）
    4. メニューは**押した欄のすぐ横**に開き、選ぶと閉じて値が入る
    5. メニューと一覧は**別の顔**（同じ▾の1行にしない）
    6. 切替は押すたびに次へ進み、**一巡する**。いま何番目・次を文字で出す
    7. 意匠の「形」（角丸）が**素のプルダウンと浮き窓まで**届く
    8. カードは説明が無いとき**背の高い空箱にならない**

   **見本の絵ではなく本物の部品を見る**——`WL.opData.previewWidget()`は
   測定画面と同じ`buildWidget()`（§9.218 ①）なので、ここを通せば実物の
   見え方を測ったことになる。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let b=null;

(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1280,height:900}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,160)));
 page.on('dialog',d=>d.accept());
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  /* **時間でなく条件で待つ**（§9.102）——部品を作る口が生えたら先へ進む。 */
  await page.waitForFunction(()=>!document.getElementById('appBoot')
    &&!!(window.WL&&WL.opData&&WL.opData.previewWidget),null,{timeout:30000});

  /* 本物の部品を1つ作る道具。器（`.opf opf-host`）と`<select>`は測定画面と
     同じ形で置く——印が違うと当たるCSSが変わる（§9.233 ③）。 */
  await page.evaluate(()=>{
   const bed=document.createElement('div');
   bed.id='wbed';
   bed.style.cssText='position:fixed;left:20px;top:200px;width:420px;z-index:99999;'
    +'background:var(--surface);padding:12px;border:1px solid #ccc';
   document.body.appendChild(bed);
   window.__mk=(kind,opt)=>{
    const o=opt||{};
    const label=document.createElement('label');
    label.className='opf opf-host';label.dataset.opfill='1';
    label.innerHTML='<span class="opf-name">'+kind+'</span>';
    const sel=document.createElement('select');
    const vals=o.values||['有','無'];
    sel.innerHTML='<option value="">-</option>'
      +vals.map(v=>'<option value="'+v+'">'+v+'</option>').join('');
    label.appendChild(sel);
    document.getElementById('wbed').appendChild(label);
    const def={name:kind,preview:true,
      look:{color:'既定',shape:o.shape||'標準',size:'中'},
      layout:'自動',choiceNotes:o.notes||{}};
    WL.opData.previewWidget(def,label,kind);
    WL.opData.presentation(label,def);
    if(o.value!=null){sel.value=o.value;sel.dispatchEvent(new Event('change',{bubbles:true}))}
    return label;
   };
   window.__clear=()=>{document.getElementById('wbed').innerHTML=''};
  });

  /* ==========================================================
     1) セグメントは触っていない / 2) トグルは別物
     ---------------------------------------------------------
     **合図を数える**——地色の帯があるか・隙間があるか・選んだ札の塗りと
     文字色。「クラス名が違う」を見る網は、CSSが同じでも通る。
     ========================================================== */
  const pair=await page.evaluate(()=>{
   window.__clear();
   const look=kind=>{
    const host=window.__mk(kind,{value:'有'});
    const shape=host.querySelector('.opf-shape');
    const on=host.querySelector('.is-on');
    const cs=getComputedStyle(shape),oc=on?getComputedStyle(on):null;
    return {器の地:cs.backgroundColor,器の余白:cs.paddingTop,
      器の幅:Math.round(shape.getBoundingClientRect().width),
      親の幅:Math.round(host.querySelector('.opf-widget').getBoundingClientRect().width),
      札の塗り:oc?oc.backgroundColor:'',札の文字:oc?oc.color:'',
      札の幅:on?Math.round(on.getBoundingClientRect().width):0};
   };
   return {seg:look('セグメント'),tog:look('トグル')};
  });
  /* 白かどうかは端末のテーマで変わりうるので、**「白い文字か」ではなく
     「セグメントとトグルで違うか」**を見る（片方を勝手に変えない、が要件）。 */
  const diff=['器の地','器の余白','札の塗り','札の文字']
    .filter(k=>pair.seg[k]!==pair.tog[k]);
  rec('前提: セグメントとトグルの両方を測れている',
      pair.seg.札の幅>0&&pair.tog.札の幅>0,JSON.stringify(pair));
  rec('セグメントは地色の帯＋内側の隙間を持つ（触っていない）',
      pair.seg.器の余白!=='0px'&&pair.seg.器の地!=='rgba(0, 0, 0, 0)',
      JSON.stringify({地:pair.seg.器の地,余白:pair.seg.器の余白}));
  rec('セグメントの選んだ札はベタ塗り＋白文字（触っていない）',
      pair.seg.札の文字==='rgb(255, 255, 255)',
      JSON.stringify({塗:pair.seg.札の塗り,字:pair.seg.札の文字}));
  rec('トグルはセグメントと3つ以上違う（隙間・塗り・文字色）',
      diff.length>=3,JSON.stringify({違い:diff,seg:pair.seg,tog:pair.tog}));
  rec('トグルの選んだ札は白文字でない（ベタ塗りではない＝染め）',
      pair.tog.札の文字!=='rgb(255, 255, 255)',pair.tog.札の文字);
  /* **中身なりの幅**（§9.220 ①でトグルに与えた性格）。器いっぱいに
     伸びると、選んだ側の右に白い空きがぶら下がる。 */
  rec('トグルの器は中身なりの幅（器いっぱいに伸びない）',
      pair.tog.器の幅<pair.tog.親の幅-8,
      JSON.stringify({器:pair.tog.器の幅,親:pair.tog.親の幅}));
  /* セグメントは今までどおり器いっぱいを等分する（もう片側）。 */
  rec('セグメントは今までどおり器いっぱいを等分する',
      pair.seg.器の幅>=pair.seg.親の幅-2,
      JSON.stringify({器:pair.seg.器の幅,親:pair.seg.親の幅}));

  /* ==========================================================
     4) メニューは押した欄のすぐ横に開く / 5) 一覧とは別の顔
     ========================================================== */
  await page.evaluate(()=>{window.__clear();
    window.__mk('メニュー',{values:['上巻','下巻','指定なし'],
      notes:{'上巻':'コイルの外側から巻き出す'}});});
  await page.click('.opf-menu-btn');
  await page.waitForSelector('#opfMenu:not([hidden])',{timeout:5000});
  const menu=await page.evaluate(()=>{
   const btn=document.querySelector('.opf-menu-btn').getBoundingClientRect();
   const pop=document.getElementById('opfMenu').getBoundingClientRect();
   return {欄の下:Math.round(pop.top-btn.bottom),左そろえ:Math.round(pop.left-btn.left),
     画面内:pop.right<=innerWidth+1&&pop.bottom<=innerHeight+1&&pop.left>=-1&&pop.top>=-1,
     件数:document.querySelectorAll('#opfMenu .opf-menu-item').length,
     説明:document.querySelectorAll('#opfMenu .opf-menu-text small').length,
     開いた印:document.querySelector('.opf-menu-btn').getAttribute('aria-expanded')};
  });
  rec('メニューは押した欄のすぐ下に開く（画面のまん中ではない）',
      menu.欄の下>=0&&menu.欄の下<=12&&Math.abs(menu.左そろえ)<=2,
      JSON.stringify(menu));
  rec('メニューは画面の外へはみ出さない',menu.画面内,JSON.stringify(menu));
  rec('メニューは説明つきで選べる',menu.件数===4&&menu.説明>=1,JSON.stringify(menu));
  rec('開いていることを▾の向き（aria-expanded）で言う',
      menu.開いた印==='true',String(menu.開いた印));
  await page.click('#opfMenu .opf-menu-item:nth-child(2)');
  const picked=await page.evaluate(()=>({
    値:document.querySelector('#wbed select').value,
    閉じた:document.getElementById('opfMenu').hidden,
    表示:(document.querySelector('.opf-pick-now')||{}).textContent,
    印:document.querySelector('.opf-menu-btn').getAttribute('aria-expanded')}));
  rec('選ぶと値が入り、メニューは閉じる',
      picked.値==='上巻'&&picked.閉じた===true&&picked.表示==='上巻'&&picked.印==='false',
      JSON.stringify(picked));
  /* Escでも閉じられること（押せるのにキーボードで抜けられない窓を作らない）。 */
  await page.click('.opf-menu-btn');
  await page.waitForSelector('#opfMenu:not([hidden])',{timeout:5000});
  await page.keyboard.press('Escape');
  const esc=await page.evaluate(()=>document.getElementById('opfMenu').hidden);
  rec('Escでメニューが閉じる',esc===true,String(esc));
  /* **一覧とメニューは別の顔**（§9.247 ①）——同じ「▾つきの1行」だと、
     名前が2つあって見た目が同じ（＝今回の指摘そのもの）になる。 */
  const faces=await page.evaluate(()=>{
   window.__clear();
   window.__mk('メニュー',{values:['甲','乙']});
   window.__mk('一覧',{values:['甲','乙']});
   const m=document.querySelector('.opf-menu-caret');
   const l=document.querySelector('.opf-pick-caret');
   const cs=e=>e?getComputedStyle(e):null;
   const a=cs(m),c=cs(l);
   return {メニューの印:(m||{}).textContent,一覧の印:(l||{}).textContent,
     メニューの仕切り:a?a.borderLeftWidth:'',一覧の仕切り:c?c.borderLeftWidth:'',
     メニューの地:a?a.backgroundColor:'',一覧の地:c?c.backgroundColor:''};
  });
  rec('一覧とメニューは合図が違う（印そのものが違う）',
      !!faces.メニューの印&&!!faces.一覧の印&&faces.メニューの印!==faces.一覧の印,
      JSON.stringify(faces));
  rec('一覧の合図は器から仕切って置く（窓が開くと読める）',
      parseFloat(faces.一覧の仕切り||0)>0&&parseFloat(faces.メニューの仕切り||0)===0,
      JSON.stringify({一覧:faces.一覧の仕切り,メニュー:faces.メニューの仕切り}));

  /* ==========================================================
     6) 切替は押すたびに次へ進み、一巡する
     ========================================================== */
  await page.evaluate(()=>{window.__clear();
    window.__mk('切替',{values:['甲','乙','丙']});});
  const cyc=[];
  /* **押してから捕る**（先に捕ると、最後に1回余分に押した状態で次の
     確かめへ入ることになる——矢印キーの起点がずれて何も確かめられない）。 */
  for(let i=0;i<5;i++){
   if(i)await page.click('.opf-cycle-btn');
   cyc.push(await page.evaluate(()=>({
     値:document.querySelector('#wbed select').value,
     出ている:(document.querySelector('.opf-cycle-now')||{}).textContent,
     位置:(document.querySelector('.opf-cycle-pos')||{}).textContent,
     次:(document.querySelector('.opf-cycle-next')||{}).textContent})));
  }
  rec('切替は押すたびに次の選択肢へ進む',
      cyc[0].値===''&&cyc[1].値==='甲'&&cyc[2].値==='乙'&&cyc[3].値==='丙',
      JSON.stringify(cyc.map(c=>c.値)));
  /* **一巡すること**——最後で止まると、行き過ぎたときに戻れない。 */
  rec('切替は最後まで行くと先頭へ戻る（一巡する）',
      cyc[4].値===cyc[0].値,JSON.stringify([cyc[3].値,cyc[4].値]));
  rec('いま何番目かを文字で出す（数えさせない）',
      /^\d+\/4$/.test(cyc[1].位置||''),JSON.stringify(cyc.map(c=>c.位置)));
  rec('次に何になるかを文字で出す（押した先を推測させない）',
      /乙/.test(cyc[1].次||''),JSON.stringify(cyc.map(c=>c.次)));
  /* 戻れること（矢印キー）。押せるのにキーボードで辿れない部品を作らない。 */
  await page.evaluate(()=>document.querySelector('.opf-cycle-btn').focus());
  await page.keyboard.press('ArrowLeft');
  const back=await page.evaluate(()=>document.querySelector('#wbed select').value);
  rec('切替は矢印キーで戻れる',back===cyc[3].値,`${cyc[4].値} → ${back}`);

  /* ==========================================================
     7) 意匠の「形」（角丸）が素のプルダウンと浮き窓まで届く
     ---------------------------------------------------------
     **直す前は、器を被せる形だけが効いてプルダウンと浮き窓は8pxのまま**
     だった（利用者「カード、一覧、プルダウンなど少し踏襲されていない」）。
     ========================================================== */
  const radius=await page.evaluate(()=>{
   window.__clear();
   const rad=el=>el?parseFloat(getComputedStyle(el).borderTopLeftRadius)||0:-1;
   const pick=(kind,sel,shape)=>{
    const host=window.__mk(kind,{values:['甲','乙'],shape});
    return rad(sel?host.querySelector(sel):host.querySelector('select'));
   };
   return {プルダウン:{標準:pick('プルダウン',null,'標準'),
                     大きめ:pick('プルダウン',null,'大きめ')},
     カード:{標準:pick('カード','.opf-card-btn','標準'),
             大きめ:pick('カード','.opf-card-btn','大きめ')},
     一覧:{標準:pick('一覧','.opf-pick-btn','標準'),
           大きめ:pick('一覧','.opf-pick-btn','大きめ')}};
  });
  rec('形（角丸）は素のプルダウンにも効く',
      radius.プルダウン.大きめ>radius.プルダウン.標準,JSON.stringify(radius.プルダウン));
  rec('形（角丸）はカード・一覧にも効く（今までどおり）',
      radius.カード.大きめ>radius.カード.標準&&radius.一覧.大きめ>radius.一覧.標準,
      JSON.stringify(radius));
  /* 浮き窓は`body`直下なので`--opf-*`が継承されない——開くときに写している
     こと（`carryLook`）を、**実際に開いて**確かめる。 */
  await page.evaluate(()=>{window.__clear();
    window.__mk('一覧',{values:['甲','乙'],shape:'大きめ'});});
  await page.click('.opf-pick-btn');
  await page.waitForSelector('#opfPicker:not([hidden])',{timeout:5000});
  const popRad=await page.evaluate(()=>{
   const it=document.querySelector('#opfPicker .opf-picker-item');
   return {項目:it?parseFloat(getComputedStyle(it).borderTopLeftRadius)||0:-1,
     写し:(document.getElementById('opfPicker').style.getPropertyValue('--opf-radius')||'').trim()};
  });
  rec('一覧の浮き窓も欄と同じ角丸で開く（意匠を持ち出す）',
      popRad.項目>=10&&!!popRad.写し,JSON.stringify(popRad));
  /* **開いた窓は閉じてから次へ**——開けっ放しだと、あとの確かめが
     「別の器か」を見るときに引っかかる（この網が実際に引っかかった）。 */
  await page.click('#opfPickerClose');
  /* **`waitForSelector`の既定は「見えるまで」**——`[hidden]`の要素は
     いつまでも見えないので、閉じたことは`waitForFunction`で見る
     （この網が実際に5秒待って落ちた）。 */
  await page.waitForFunction(()=>document.getElementById('opfPicker').hidden,
    null,{timeout:5000});

  /* ==========================================================
     8) カードは説明が無いとき背の高い空箱にならない
     ---------------------------------------------------------
     カードは「選ぶのに説明が要る」ための形（§9.223 ③）。説明が無いのに
     1.5倍の高さを取ると、**文字が上に張り付いた空箱**が並ぶ。
     ========================================================== */
  const cards=await page.evaluate(()=>{
   window.__clear();
   const h=(notes)=>{
    const host=window.__mk('カード',{values:['甲','乙'],notes});
    const btn=host.querySelector('.opf-card-btn');
    return {高さ:Math.round(btn.getBoundingClientRect().height),
      印:host.querySelector('.opf-cards').classList.contains('is-plain')};
   };
   return {説明なし:h({}),説明あり:h({'甲':'説明の文'})};
  });
  rec('説明の無いカードには印が付く（`:has()`に頼らない）',
      cards.説明なし.印===true&&cards.説明あり.印===false,JSON.stringify(cards));
  rec('説明の無いカードは背が高くならない',
      cards.説明なし.高さ<cards.説明あり.高さ,JSON.stringify(cards));

  /* ==========================================================
     9) 足した2つ（§9.248 ①、利用者の指示）
     ---------------------------------------------------------
       「フローティングモーダルやポップオーバーメニューやスピナーなど
        違うタイプのものを増やしたい。」

     **ポップオーバーメニューは`メニュー`が既にそれ**（§9.247 ①）なので
     足していない——同じものに2つ目の名前を与えると、選ぶ盤が「同じ物の
     別名」で埋まる。ここで固定するのは、足した2つが**既にあるものと
     別の顔**であること。
     ========================================================== */
  await page.evaluate(()=>{window.__clear();
    window.__mk('パネル',{values:['上巻','下巻','指定なし','特殊'],
      notes:{'上巻':'コイルの外側から巻き出す'}});});
  const panelFace=await page.evaluate(()=>{
   const p=document.querySelector('.opf-panel-mark');
   const cs=p?getComputedStyle(p):null;
   return {印:(p||{}).textContent,仕切り:cs?cs.borderLeftWidth:''};
  });
  /* **`一覧`と同じ顔にしない**——どちらも窓が開くので、合図が同じだと
     名前が2つあって見た目が同じ（§9.247 ①で指摘された形）になる。 */
  rec('パネルの合図は一覧（☰）と違う',
      panelFace.印&&panelFace.印!=='☰'&&parseFloat(panelFace.仕切り||0)>0,
      JSON.stringify(panelFace));
  await page.click('.opf-panel-btn');
  await page.waitForSelector('#opfPanel:not([hidden])',{timeout:5000});
  const panelWin=await page.evaluate(()=>{
   const g=document.getElementById('opfPanelGrid');
   const it=g.querySelector('.opf-panel-item');
   return {札:g.querySelectorAll('.opf-panel-item').length,
     説明:g.querySelectorAll('.opf-panel-item small').length,
     列:getComputedStyle(g).gridTemplateColumns.split(' ').length,
     札の高さ:it?Math.round(it.getBoundingClientRect().height):0,
     /* `一覧`の窓（1行ずつの表）と**別の器**であること。 */
     一覧の窓:!!document.querySelector('#opfPicker:not([hidden])')};
  });
  /* **「大きな札を並べる」形であること**——1列に細い行が並ぶだけなら
     `一覧`と変わらない（名前だけ増えて選ぶ意味が無い）。 */
  rec('パネルは大きな札を2列以上に並べる',
      panelWin.列>=2&&panelWin.札===5&&panelWin.札の高さ>=40,
      JSON.stringify(panelWin));
  rec('パネルは説明つきで選べる',panelWin.説明>=1,JSON.stringify(panelWin));
  rec('パネルは一覧の窓を開かない（別の器）',!panelWin.一覧の窓);
  await page.click('#opfPanel .opf-panel-item:nth-child(2)');
  const panelPicked=await page.evaluate(()=>({
    値:document.querySelector('#wbed select').value,
    閉:document.getElementById('opfPanel').hidden,
    表示:(document.querySelector('.opf-pick-now')||{}).textContent}));
  rec('パネルで選ぶと値が入り、窓は閉じる',
      panelPicked.値==='上巻'&&panelPicked.閉===true&&panelPicked.表示==='上巻',
      JSON.stringify(panelPicked));

  /* 数の道具は6つとも**「そのまま打つ」の1枠に収まる**（§9.250 ⑧、
     利用者の指示「範囲に収めること、入力データは隠さないこと」）。
     以前ここは「スピナーだけがステッパーより背が低いこと」を固定して
     いたが、**それは他の5つが1行ぶん背が高いことを追認する網**だった。
     いまは全部が同じ枠なので、**新しい約束へ書き直す**（§9.200）。

     測るのは3つ:
       ① 「そのまま打つ」と高さが同じ（行を増やさない）
       ② 器（マス）より広くならない
       ③ 値の文字が道具の下に潜らない（欄の中身の右端 < 帯の左端）
     絵が違うことだけを見る網は、1行増える実装でも通る。 */
  const numFit=await page.evaluate(async()=>{
   const raf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   window.__clear();
   const CELL=94;
   const bed=document.getElementById('wbed');
   /* **器を実際に7マス入る広さにしてから測る**——狭いままだと
      `minmax(0,94px)`のトラックが余りを分け合って56pxに縮み、
      「マスの幅を超えない」を一度も確かめないまま通る（§9.211 ①と同じ罠）。 */
   bed.style.width=(CELL*7+40)+'px';
   bed.style.display='grid';
   bed.style.gridTemplateColumns='repeat(7,minmax(0,'+CELL+'px))';
   const mk=kind=>{
    const label=document.createElement('label');
    label.className='opf opf-host';label.dataset.opfill='1';
    label.innerHTML='<span class="opf-name">'+kind+'</span>';
    const inp=document.createElement('input');
    inp.type='text';inp.className='numeric-input';inp.min=0;inp.max=10;inp.value='5';
    label.appendChild(inp);
    bed.appendChild(label);
    const def={name:kind,preview:true,look:{color:'既定',shape:'標準',size:'中'},
      type:'整数',step:1,min:0,max:10,decimals:0,unit:'mm'};
    WL.opData.previewWidget(def,label,kind);
    WL.opData.presentation(label,def);
    return label;
   };
   const kinds=['ステッパー','スピナー','スライダー','キーパッド','早見ボタン','メーター'];
   const plain=mk('そのまま打つ');
   const labs=kinds.map(mk);
   await raf();await raf();
   const base=Math.round(plain.getBoundingClientRect().height);
   return {base,rows:labs.map((lab,i)=>{
    const r=lab.getBoundingClientRect();
    const inp=lab.querySelector('input'),ir=inp.getBoundingClientRect();
    const cs=getComputedStyle(inp);
    const right=ir.right-parseFloat(cs.paddingRight)-parseFloat(cs.borderRightWidth);
    const strip=lab.querySelector('.opf-num-strip');
    const sr=strip?strip.getBoundingClientRect():null;
    const box=lab.querySelector('.opf-num');
    return {kind:kinds[i],over:Math.round(r.height-base),
      cellOver:Math.round(r.width-CELL),
      すき間:sr?Math.round(sr.left-right):null,
      行に乗る:box?Math.round(box.getBoundingClientRect().top-ir.top):null};
   })};
  });
  rec('数の道具はどれも行を増やさない（「そのまま打つ」と同じ高さ）',
      numFit.rows.every(r=>r.over===0),
      JSON.stringify(numFit.rows.map(r=>r.kind+':'+r.over)));
  rec('数の道具はどれもマスの幅を超えない',
      numFit.rows.every(r=>r.cellOver<=0),
      JSON.stringify(numFit.rows.map(r=>r.kind+':'+r.cellOver)));
  rec('道具は欄の行にちょうど重なる',
      numFit.rows.every(r=>r.行に乗る===null||Math.abs(r.行に乗る)<=1),
      JSON.stringify(numFit.rows.map(r=>r.kind+':'+r.行に乗る)));
  rec('値の文字は道具の下に潜らない（帯のぶん場所が空く）',
      numFit.rows.every(r=>r.すき間===null||r.すき間>=0),
      JSON.stringify(numFit.rows.map(r=>r.kind+':'+r.すき間)));
  /* 帯に入りきらない3つ（目盛・テンキー・早見）は**押すと浮く**
     （複合コントロール）。**開いて・効いて・閉じる**まで見る
     ——「ボタンが在る」ことだけを見る網は、押しても何も起きない実装でも通る。 */
  const pops=await page.evaluate(async()=>{
   const raf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const out={};
   const labs=[...document.querySelectorAll('#wbed label')];
   for(const kind of ['スライダー','キーパッド','早見ボタン']){
    const lab=labs.find(l=>l.querySelector('.opf-name')?.textContent===kind);
    const btn=lab&&lab.querySelector('.opf-num-open');
    if(!btn){out[kind]={btn:false};continue}
    btn.click();await raf();
    const pop=document.getElementById('opfNumPop');
    const pr=pop.getBoundingClientRect();
    const inp=lab.querySelector('input');
    const before=inp.value;
    if(kind==='キーパッド'){
     pop.querySelector('[data-opk="clear"]').click();
     pop.querySelector('[data-opk="7"]').click();
    }else if(kind==='早見ボタン'){
     const bs=[...pop.querySelectorAll('[data-opv]')];
     if(bs[3])bs[3].click();
    }else{
     const rg=pop.querySelector('.opf-range-in');
     rg.value='8';rg.dispatchEvent(new Event('input',{bubbles:true}));
    }
    const after=inp.value;
    document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
    await raf();
    out[kind]={btn:true,開いた:pr.width>0,
      画面の中:pr.left>=0&&pr.top>=0&&pr.right<=innerWidth&&pr.bottom<=innerHeight,
      効いた:after!==before&&after!=='',値:after,
      閉じた:document.getElementById('opfNumPop').hidden};
   }
   /* **後片付け**（§9.121）——器の形を変えたまま次の確認へ渡すと、
      関係の無いところで落ちる。 */
   const bed=document.getElementById('wbed');
   bed.style.display='';bed.style.gridTemplateColumns='';bed.style.width='420px';
   return out;
  });
  rec('入りきらない道具は押すと浮く（目盛・テンキー・早見）',
      ['スライダー','キーパッド','早見ボタン'].every(k=>pops[k]&&pops[k].btn&&pops[k].開いた),
      JSON.stringify(pops));
  rec('浮いた窓は画面の中に収まり、押すと値が入る',
      ['スライダー','キーパッド','早見ボタン'].every(k=>pops[k].画面の中&&pops[k].効いた),
      JSON.stringify(pops));
  rec('外を押すと閉じる（開いた器を控えている・§9.222 ①）',
      ['スライダー','キーパッド','早見ボタン'].every(k=>pops[k].閉じた),
      JSON.stringify(pops));

  /* ==========================================================
     10) 選ばせ方の盤はまとまりで束ねる（§9.248 ①）
     ---------------------------------------------------------
     **まとまりはサーバーが持つ**（`WIDGET_GROUPS`）。ここでは画面が
     それをそのまま使っていることと、**空の群を出さない**ことを見る。
     ========================================================== */
  const groups=await page.evaluate(async()=>{
   const r=await fetch('/api/operation-item-master').then(x=>x.json());
   const gs=r.widgetGroups||[];
   return {群:gs.map(g=>g.label),
     一言:gs.every(g=>!!g.note),
     数値の群:gs.filter(g=>(g.items||[]).includes('スピナー')).map(g=>g.label),
     選択の群:gs.filter(g=>(g.items||[]).includes('パネル')).map(g=>g.label)};
  });
  rec('選ばせ方のまとまりをサーバーが答える（見出しと一言つき）',
      groups.群.length>=5&&groups.一言,JSON.stringify(groups.群));
  rec('スピナーは「数を入れる」、パネルは「開いて選ぶ」',
      groups.数値の群.length===1&&groups.選択の群.length===1
      &&groups.数値の群[0]!==groups.選択の群[0],
      JSON.stringify({数値:groups.数値の群,選択:groups.選択の群}));

  /* ==========================================================
     9) 「よく使う順」は**器を被せた形でも数える**（§9.248 ⑤）
     ----------------------------------------------------------
     利用者の指示は「プルダウンリストなど、**新しい表示領域を作って表示する
     タイプ**のUIについては…選択肢の使用回数に応じて並び順を変える」。
     ところが器を被せた形（一覧・メニュー・パネル・ボタン群）は、札を押しても
     値を持つのは`<select>`のままで、飛ぶ`change`は`setValue()`が作った
     **合成イベント（`isTrusted`が偽）**。「本物のイベントだけ数える」に
     すると、**いちばん効かせたい形が1回も数えられない**。
     逆に`change`を全部数えると、記録の復元・プリセット・`syncWidgets()`の
     当て直しまで数に入り、開き直すたびに前回の値が先頭へ固定される。

     ここで見ること:
      a) 器の札を押したら1回数える（合成イベントでも数える）
      b) 画面側が値を入れ直しただけでは数えない（人が選んでいない）
      c) 素のプルダウンで選んでも数える（`isTrusted`の道）
     **片方だけを見ないこと**——どちらか一方の網は、もう片方が壊れていても通る。
     ========================================================== */
  const NAME='wtest-choice';
  /* 口は塞いで**呼ばれた回数と中身だけ**を見る（マスタを汚さない）。 */
  const hits=[];
  await page.route('**/api/operation-choice-master/used',route=>{
   let body={};try{body=JSON.parse(route.request().postData()||'{}')}catch(e){}
   hits.push(body);
   route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
  });
  /* 測定画面と同じ形で置く——**`preview`ではない**（見本で押した回数まで
     数えると、現場で1度も選んでいない値が上へ来る）。 */
  await page.evaluate(name=>{
   window.__clear();
   window.__mkLive=(kind,choice)=>{
    const label=document.createElement('label');
    label.className='opf opf-host';label.dataset.opfill='1';
    label.innerHTML='<span class="opf-name">'+kind+'</span>';
    const sel=document.createElement('select');
    sel.innerHTML='<option value="">-</option><option value="あ">あ</option>'
      +'<option value="い">い</option>';
    label.appendChild(sel);
    document.getElementById('wbed').appendChild(label);
    const def={name:kind,choice:choice,look:{color:'既定',shape:'標準',size:'中'},layout:'自動'};
    WL.opData.previewWidget(def,label,kind);
    WL.opData.presentation(label,def);
    return label;
   };
  },NAME);
  const wired=await page.evaluate(()=>{
   /* 数える配線は`layout()`が1度だけ張る。測定画面を開かずに確かめたいので
      直接呼ぶ（**`layout()`は何度呼んでも1度しか張らない**）。 */
   try{WL.opData.layout()}catch(e){}
   return true;
  });
  rec('前提: 数える配線を張れた',wired);

  /* a) 器を被せた形（ボタン群）で札を押す＝合成イベント。 */
  hits.length=0;
  await page.evaluate(n=>{const h=window.__mkLive('ボタン群',n);
    h.querySelector('[data-opv="い"]').click()},NAME);
  await page.waitForTimeout(400);
  rec('器の札を押すと数える（合成イベントでも数える）',
      hits.length===1&&hits[0].name===NAME&&hits[0].value==='い',
      JSON.stringify(hits));

  /* b) 画面側が入れ直しただけ（記録の復元・プリセット・当て直し）は数えない。 */
  hits.length=0;
  await page.evaluate(()=>{
   const sel=[...document.querySelectorAll('#wbed select')].pop();
   sel.value='あ';
   sel.dispatchEvent(new Event('input',{bubbles:true}));
   sel.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForTimeout(400);
  rec('画面が値を入れ直しただけでは数えない',hits.length===0,JSON.stringify(hits));

  /* c) 素のプルダウンで人が選ぶ道（本物のイベント）。 */
  hits.length=0;
  await page.evaluate(n=>{window.__mkLive('プルダウン',n)},NAME);
  const sels=await page.$$('#wbed select');
  await sels[sels.length-1].selectOption('あ');
  await page.waitForTimeout(400);
  rec('素のプルダウンで選んでも数える',
      hits.length===1&&hits[0].value==='あ',JSON.stringify(hits));
  await page.unroute('**/api/operation-choice-master/used');

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));

  console.log('\n=== SUMMARY ===');
  const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
  ng.forEach(x=>console.log(' -',x.n,x.d||''));
  process.exitCode=ng.length?1:0;
 }catch(e){
  console.error('FATAL',e);
  process.exitCode=1;
 }finally{
  /* **落ちても必ず閉じる**（残ったChromiumが後続を巻き添えにする）。 */
  if(b)await b.close().catch(()=>{});
 }
})();
