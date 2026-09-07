/* test_oppad.js: 角丸ベースの意匠・設定窓の揺れ・空き（ダミー）の群（§9.227）
   ============================================================
   利用者の指示:
     ①「実際の適用されるデザインがやりすぎで、画像のようにシンプルな感じが
        良いです」「角丸をベースデザインにしてほしい…『角』と『丸』は使わない
        方向でよいです。形というところの変更は角丸をベースにしたバリエーション
        を希望しています」「角丸をベースデザインというのは、『選ばせ方』
        すべてのUIのデザインについての話にも適用したい」
       「選ぶたびに左側のイメージが変わるが、見切れているし、そのサイズの
        変化に合わせて右側の選択パネルの並びや位置が変化するのはやめてほしい」
     ②「マスタでまとまりをダミーで作って何も枠もない空間をつくれるように
        してください。(区切りの良い並びに整列させるためのダミーカード)」

   ここで固定すること:
    - **選ばせ方を変えても右のパネルが1pxも動かない**（実測で30px動いていた）
    - **左の見本が器からはみ出さない**（実測で455px切れていた）
    - 選ばせ方の面は**どれも角丸**（ピル＝高さの半分以上の丸みが無い）
    - 形の軸は`控えめ/標準/大きめ`で、**廃止した`角`/`丸`は寄せる**
    - 空きの群は測定画面で**枠も見出しも文字も持たず**、幅ぶんのマスを取る
    - 空きの群の行は**「記録した値」の分母に入らない**
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
/* 待ちは「時間」でなく「条件」で置く（§9.324 R5、tests/lib/wait.js）。 */
const W=require('./lib/wait');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B='http://127.0.0.1:5029';
const TAG='pad-'+Date.now().toString(36);
const post=(p,x)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(x)});
const get=p=>fetch(B+p).then(r=>r.json());
const EQ='テスト設備A';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1920,height:1080}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 page.on('dialog',d=>d.accept());
 /* 大きい選び物は浮き出しの中（§9.299）。**一度開けば描き直しても開いたまま**
    なので、窓を開くたびに1回でよい（`opState.pop`が覚えている）。 */
 /* **浮き出しは他の欄を覆う**（`position:fixed`）。実機では外側を1回押せば
    畳まれるが、`page.click()`は押す前に当たり判定をするので、開いたまま
    別の列を押すと「覆われている」で必ず失敗する。**塊を移る前に畳む**。 */
 const closePop=async()=>{
  await page.evaluate(()=>{
   const b=document.querySelector('#opItemModal [data-op-pop][aria-expanded="true"]');
   if(b)b.click();
  });
  await page.waitForFunction(()=>!document.querySelector(
    '#opItemModal [data-op-pop-panel]:not([hidden])'),null,{timeout:8000});
 };
 const openPop=async k=>{
  await page.evaluate(key=>{
   const b=document.querySelector(`#opItemModal [data-op-pop="${key}"]`);
   if(!b)throw Error('浮き出しの入口が無い: '+key);
   if(b.getAttribute('aria-expanded')!=='true')b.click();
  },k);
  await page.waitForSelector(`#opItemModal [data-op-pop-panel="${k}"]:not([hidden])`,{timeout:8000});
 };
 const madeIds=[],madeChoiceIds=[];let renamed=null,renamedCoil=null,layoutBackup=null;
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:30000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintNav [data-master="opItem"]',{timeout:20000});
  await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'tests');
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('.op-board',{timeout:20000});
  await page.waitForTimeout(900);

  /* ==========================================================
     1) 設定窓: 選ばせ方を変えても右が動かない／見本が見切れない
     ========================================================== */
  await page.evaluate(()=>{
   const t=[...document.querySelectorAll('.op-tile')].find(e=>/選択/.test(e.textContent))
     ||document.querySelector('.op-tile');
   if(t)t.click();
  });
  await page.waitForFunction(()=>{
   const m=document.getElementById('opItemModal');return !!m&&!m.hidden;
  },null,{timeout:10000});
  await page.waitForTimeout(500);
  await page.waitForSelector('#opModalForm .op-form-sec[data-op-sec="look"]',{timeout:8000});
  await openPop('widget');
  await page.waitForTimeout(600);
  const kinds=await page.$$eval('[data-op-widget]',es=>es.map(e=>e.dataset.opWidget));
  rec('前提: 選ばせ方が2つ以上ある（切り替えて比べられる）',kinds.length>=5,String(kinds.length));
  /* **測るのは「動かないこと」なので、素通りしないよう先に前提を固定する**
     ——選ばせ方が1つしか無い／窓が開いていなければ、当然どこも動かない。 */
  /* **丸めの検査は選ばせ方ごとに行う**——最後に選んだ1つだけを見ると、
     その形にチップが無ければ**何も測らずに通る**（ピルへ戻す欠陥を注入して
     実際に素通りした）。 */
  const pills=()=>page.evaluate(()=>{
   const out=[];
   document.querySelectorAll('.op-prev-field .opf-widget, .op-prev-field .opf-widget *')
    .forEach(el=>{
     const r=el.getBoundingClientRect();
     if(r.width<6||r.height<6)return;
     const cls=String(el.className||'');
     /* 丸めきり（ピル）＝角丸が高さの半分以上。**帯とつまみと丸ぽちは除く**
        ——形そのものが意味を持つ部品。 */
     if(/opf-(switch-track|switch-knob|meter-bar|meter-fill|dot)/.test(cls))return;
     const rad=parseFloat(getComputedStyle(el).borderTopLeftRadius)||0;
     if(rad>=r.height/2-0.5)out.push((cls||el.tagName)+'='+Math.round(rad)+'/'+Math.round(r.height));
    });
   return out;
  });
  /* **測る前にスクロールを戻す**（§9.288 ③）——`page.click()`は押す札を
     画面へ入れるためにスクロールするので、盤の下のほうの札を押した回だけ
     全部の行が同じだけ上へずれる（実測129px）。それは「揺れ」ではないので、
     器の中の座標で見る。**戻さずに見ると、札を1つ足しただけでこの網が
     落ちる**（実際に落ちた）。 */
  const geo=()=>page.evaluate(()=>{
   const sc=document.querySelector('.op-modal-form,.mm-tabpanel.is-fill,.op-form-scroll')
     ||[...document.querySelectorAll('#opItemModal *')].find(e=>e.scrollHeight>e.clientHeight+8);
   if(sc)sc.scrollTop=0;
   const lab=s=>[...document.querySelectorAll('.op-form-label')].find(e=>e.textContent.trim()===s);
   const y=s=>{const l=lab(s);return l?Math.round(l.getBoundingClientRect().y):-1};
   const g=document.querySelector('.op-widget-grid');
   const first=document.querySelector('.op-widget-tile');
   const pane=document.querySelector('.op-modal-preview');
   const card=document.querySelector('.op-prev-card');
   return {色:y('色'),形:y('形'),大きさ:y('大きさ'),見せ方:y('見せ方'),
     列:g?getComputedStyle(g).gridTemplateColumns.split(' ').length:0,
     タイルx:first?Math.round(first.getBoundingClientRect().x):0,
     はみ出し:(card&&pane)?Math.round(card.getBoundingClientRect().width-pane.clientWidth):0};
  });
  const seen=[];const pillHits=[];let measured=0;
  for(const k of kinds){
   await page.click(`[data-op-widget="${k}"]`).catch(()=>{});
   await page.waitForTimeout(320);
   seen.push({k,...(await geo())});
   const n=await page.evaluate(()=>document.querySelectorAll(
     '.op-prev-field .opf-widget, .op-prev-field .opf-widget *').length);
   measured+=n;
   (await pills()).forEach(x=>pillHits.push(k+':'+x));
  }
  const uniq=f=>[...new Set(seen.map(x=>x[f]))];
  rec('選ばせ方を変えても「色」の行が動かない',uniq('色').length===1,
      JSON.stringify(uniq('色')));
  rec('選ばせ方を変えても「形」「大きさ」「見せ方」の行が動かない',
      uniq('形').length===1&&uniq('大きさ').length===1&&uniq('見せ方').length===1,
      JSON.stringify({形:uniq('形'),大きさ:uniq('大きさ'),見せ方:uniq('見せ方')}));
  rec('選ばせ方のタイルの並び（列数と左端）が変わらない',
      uniq('列').length===1&&uniq('タイルx').length===1,
      JSON.stringify({列:uniq('列'),x:uniq('タイルx')}));
  rec('左の見本が器からはみ出さない',
      seen.every(x=>x.はみ出し<=0),
      JSON.stringify(seen.map(x=>`${x.k}:${x.はみ出し}`).slice(0,4)));

  /* ---- 角丸ベース: どの選ばせ方にもピルが無い ----
     **「何も測っていないのに通る」を塞ぐ**（§CLAUDE「素通り」）ので、
     測った部品の総数を先に固定する。 */
  rec('前提: 選ばせ方ごとに見本の部品を測れている',measured>=kinds.length,
      `${measured}個 / ${kinds.length}形`);
  rec('どの選ばせ方の面にもピル（丸めきり）が無い＝角丸ベース',pillHits.length===0,
      JSON.stringify(pillHits.slice(0,4)));
  const shapes=await page.$$eval('[data-op-look="shape"]',es=>es.map(e=>e.dataset.opVal));
  rec('形の軸は角丸のバリエーション（角・丸は無い）',
      shapes.length===3&&!shapes.includes('角')&&!shapes.includes('丸')
      &&shapes.includes('標準'),JSON.stringify(shapes));
  /* ==========================================================
     1b) 選ばせ方の実物は「見本と同じ」で、選んだ札がはっきり分かる
         （§9.229 ②、利用者の指示「汎用設定の特にタブは…変わっている感じが
          わかりません。白背景に白配色で、淵だけ色付きではわかりにくいです。
          標準的な、選ばせ方のサンプルと同じデザインにしてください。
          他の選ばせ方もサンプルの形に合わせてください」）

     **色そのものを固定しない**（トークンを1つ替えるたびに落ちる）。
     見るのは「選んだ札と選んでいない札の差」——面があるか、浮いているか、
     どちらの文字が濃いか。実機の壊れ方はここに全部出ていた。
     ========================================================== */
  const lookOf=async k=>{
   /* **見本を押すと浮き出しは畳まれる**（外側を押したのと同じ・§9.299）。
      次の形を選ぶ前に開き直す——`.catch()`で握り潰すと、押せていないのに
      前の形のまま測り続けて「タブなのにラジオの数字」が出る（実際に出た）。 */
   await openPop('widget');
   await page.click(`[data-op-widget="${k}"]`);
   await page.waitForTimeout(320);
   /* **「—」を選んだままにしない**——選ばれているのが空欄の札だと、
      文字が短すぎて差が出ているかどうかを測れない。 */
   await page.evaluate(()=>{
    const bs=[...document.querySelectorAll('.op-prev-field [data-opv]')]
      .filter(b=>b.dataset.opv!=='');
    if(bs[0])bs[0].click();
   });
   await page.waitForTimeout(250);
   return page.evaluate(()=>{
    /* 明るさ（相対輝度の近似）。**透明は`null`＝面が無い**。 */
    const lum=c=>{
     const m=String(c||'').match(/[\d.]+/g)||[];
     if(m.length<3)return null;
     if(m.length>3&&Number(m[3])===0)return null;
     return .2126*Number(m[0])+.7152*Number(m[1])+.0722*Number(m[2]);
    };
    const on=document.querySelector('.op-prev-field [data-opv].is-on');
    const off=[...document.querySelectorAll('.op-prev-field [data-opv]')]
      .find(b=>!b.classList.contains('is-on'));
    if(!on||!off)return null;
    const a=getComputedStyle(on),b=getComputedStyle(off);
    return {面:a.backgroundColor,面の明るさ:lum(a.backgroundColor),影:a.boxShadow,
            文字:lum(a.color),未選択の文字:lum(b.color)};
   });
  };
  const L={};
  for(const k of ['ラジオ','セグメント','タブ'])L[k]=await lookOf(k);
  rec('前提: ラジオ・セグメント・タブの選んだ札と選んでいない札を測れている',
      Object.keys(L).length===3
      &&Object.values(L).every(v=>v&&v.文字!=null&&v.未選択の文字!=null),
      JSON.stringify(L));
  rec('タブの選んだ札は面を持つ（下線だけにしない）',
      !!L['タブ']&&L['タブ'].面の明るさ!=null,JSON.stringify(L['タブ']));
  /* **選んだ札は「面」か「濃い文字」のどちらかで先に立つ**（§9.229 ②⑥）。
     面を持たない形（ラジオ・直す前のタブ）では、選んでいない札のほうが
     濃いと色を足しても差にならない——これが「変わっている感じが
     わかりません」の正体だった（未選択が`--ink-2`＝本文とほぼ同じ濃さで、
     選んだ札のtealより暗かった）。面を持つ形（いまのタブ・セグメント）は
     面が語るので、文字の濃淡は問わない。 */
  const dim=Object.entries(L).filter(([,v])=>{
   if(!v)return true;
   if(v.面の明るさ!=null)return false;         // 面で示している
   return !(v.未選択の文字>v.文字+8);           // 面が無いなら文字で示す
  });
  rec('選んだ札は面か濃い文字で先に立つ（選んでいない札に負けない）',
      dim.length===0,JSON.stringify(dim));
  /* **見本の絵と実物を食い違わせない**（設定画面で確かめる意味が無くなる）。 */
  const demo=await page.evaluate(()=>{
   const t=[...document.querySelectorAll('.op-widget-tile')]
     .find(e=>e.dataset.opWidget==='タブ');
   const on=t&&t.querySelector('.opd-tabs .opd-on');
   if(!on)return null;
   const cs=getComputedStyle(on);
   return {面:cs.backgroundColor,下線:cs.borderBottomColor};
  });
  rec('見本の絵も実物と同じ（タブの絵にも面がある）',
      !!demo&&!/rgba\(0, 0, 0, 0\)|transparent/.test(demo.面),JSON.stringify(demo));

  /* ---- 高さは器の変数がそろえる（§9.229 ⑥、利用者の指示
         「汎用UIの高さは揃えたいです。見た目がそろわないです」） ----
     素の`<select>`（プルダウン）を物差しにして、どの選ばせ方も同じ背丈で
     あることを見る。**器の外寸で測る**——中の札だけ合っていても、器が
     `padding`と`border`を持てばそのぶん背が高くなる（セグメントが6px、
     タブが1px高かった）。カードは説明を載せる札なので**わざと1.5倍**、
     メモ・スライダー・メーターは形が違うので対象から外す。 */
  const HEIGHT_KINDS=['プルダウン','ラジオ','セグメント','タブ','ボタン群',
                      '一覧','トグル','段階','入切'];
  const hs={};
  for(const k of kinds){
   if(HEIGHT_KINDS.indexOf(k)<0)continue;
   await openPop('widget');                 /* 見本を押すと畳まれる（§9.299） */
   await page.click(`[data-op-widget="${k}"]`);
   await page.waitForTimeout(300);
   hs[k]=await page.evaluate(()=>{
    const host=document.querySelector('.op-prev-field .opf');
    if(!host)return null;
    const el=host.querySelector('.opf-shape')||host.querySelector('.opf-pick-btn')
      ||host.querySelector('.opf-switch-btn')||host.querySelector('select')
      ||host.querySelector('input');
    if(!el)return null;
    const r=el.getBoundingClientRect();
    return r.height>0?Math.round(r.height):null;
   });
  }
  const hv=Object.values(hs).filter(v=>v);
  rec('前提: 選ばせ方ごとに部品の高さを測れている',
      hv.length>=6,JSON.stringify(hs));
  rec('どの選ばせ方も同じ高さ（器の変数がそろえる）',
      hv.length>0&&Math.max(...hv)-Math.min(...hv)<=2,JSON.stringify(hs));
  /* **セグメントの選んだ札は設定色で塗る**（利用者の指示「選んだ部分が白なので
     わかりにくく、設定色との連携もない」）。白のままだと地（`--surface-2`）と
     ほとんど同じで差にならない。 */
  await page.click('[data-op-widget="セグメント"]').catch(()=>{});
  await page.waitForTimeout(300);
  const segFill=async color=>{
   await page.evaluate(c=>{
    const b=document.querySelector(`[data-op-look="color"][data-op-val="${c}"]`);
    if(b)b.click();
   },color);
   await page.waitForTimeout(320);
   return page.evaluate(async()=>{
    const bs=[...document.querySelectorAll('.op-prev-field [data-opv]')]
      .filter(b=>b.dataset.opv!=='');
    if(bs[0])bs[0].click();
    /* **押した直後に色を読まないこと。** 面には`background-color .15s`の
       遷移が掛かっているので、`getComputedStyle`は**遷移の途中の値**を返す
       ——押した瞬間は「まだ透明」、前に選ばれていた札は「まだ塗られている」
       と読め、塗りが効いていないように見える（実際にこれで空振りした）。 */
    await new Promise(r=>setTimeout(r,300));
    const on=document.querySelector('.op-prev-field .opf-seg-btn.is-on');
    const shape=document.querySelector('.op-prev-field .opf-seg .opf-shape');
    if(!on)return null;
    return {面:getComputedStyle(on).backgroundColor,v:on.dataset.opv,
            器の面:shape?getComputedStyle(shape).backgroundColor:''};
   });
  };
  const colors=await page.$$eval('[data-op-look="color"]',es=>es.map(e=>e.dataset.opVal));
  rec('前提: 色の軸が2つ以上ある（連携を比べられる）',colors.length>=2,JSON.stringify(colors));
  /* **既定と「主色」を比べないこと**——主色は既定と同じtealなので、
     連携していてもしていなくても同じ色になり、何も確かめないまま通る。
     はっきり違う色（赤／青）と比べる。 */
  const other=colors.find(c=>c==='赤')||colors.find(c=>c==='青')
    ||colors[colors.length-1];
  rec('前提: 既定とはっきり違う色を選べる',!!other&&other!==colors[0],String(other));
  const segA=await segFill(colors[0]),segB=await segFill(other);
  /* **選んだ札は設定色で塗る**（利用者の指示「選んだ部分が白なのでわかり
     にくく、設定色との連携もない」）。**色を変えたら塗りも変わること**を
     見る——固定色（白でもtealでも）なら必ず落ちる。 */
  rec('セグメントの選んだ札の塗りが設定色に連動する',
      !!segA&&!!segB&&segA.面!==segB.面,JSON.stringify([colors[0],segA,other,segB]));
  rec('セグメントの選んだ札は器の地と同じ色にしない',
      !!segA&&segA.面!==segA.器の面&&!/rgb\(255, 255, 255\)/.test(segA.面),
      JSON.stringify(segA));

  await page.evaluate(()=>{const c=document.getElementById('opModalClose');if(c)c.click()});
  await page.waitForTimeout(300);

  /* ==========================================================
     1c) 組み込みの欄も普通の項目として設定できる（§9.229 ③、利用者の指示
         「コイル止めに関して、名前も設定項目も変えられません。汎用設計に
          しているつもりなので、一旦外すなどもできるようにしてほしいです」）
     ========================================================== */
  const openedCoil=await page.evaluate(()=>{
   const t=[...document.querySelectorAll('.op-tile')].find(e=>/コイル止め/.test(e.textContent));
   if(!t)return false;t.click();return true;
  });
  rec('前提: 盤にコイル止め（組み込みの欄）が居る',openedCoil===true);
  if(openedCoil){
   await page.waitForFunction(()=>{
    const m=document.getElementById('opItemModal');return !!m&&!m.hidden;
   },null,{timeout:10000});
   await page.waitForSelector('#opModalForm .op-form-sec[data-op-sec="data"]',{timeout:8000});
   await page.waitForTimeout(500);
   const ids=await page.$$eval('#opModalForm [id^="opd"]',es=>es.map(e=>e.id));
   /* **判定は族（family）**。`[型]`で見ていたため、`文字`型の組み込み選択欄
      （コイル止め）は選択肢の欄が丸ごと出ていなかった。 */
   rec('組み込みの欄でも「選択肢のまとまり」を選べる（型ではなく族で見る）',
       ids.includes('opdChoice'),JSON.stringify(ids));
   rec('組み込みの欄でも初期値・手打ちを決められる',
       ids.includes('opdInitial')&&ids.includes('opdFreeText'),JSON.stringify(ids));
   /* **行き止まりにしない**（§4）。「消せません」だけだと外し方が読めない。 */
   rec('「消せません」で終わらせず、外し方へ連れて行く',ids.includes('opdStepOut'));
   await page.click('#opdStepOut');
   await page.waitForTimeout(400);
   const jumped=await page.evaluate(()=>({
     ある:!!document.getElementById('opdEnabled'),
     いま:document.activeElement&&document.activeElement.id}));
   rec('外し方のボタンは①の「測定画面に出す」へ連れて行く',
       jumped.ある===true&&jumped.いま==='opdEnabled',JSON.stringify(jumped));
   await page.waitForSelector('#opModalForm .op-form-sec[data-op-sec="look"]',{timeout:8000});
   await openPop('widget');
   await page.waitForTimeout(500);
   const blanks=(await page.$$('[data-op-blank]')).length;
   rec('組み込みの選択欄でも「空欄の札」を決められる',blanks===2,String(blanks));
   /* ---- 窓から名前を変えて保存したら、本当に保存されること ----
      **APIを直接叩くだけの網では捕まらない**（§9.228 ①のときがそうだった）
      ——サーバーは最初から受け付けており、**画面が`x.name`へ戻して送って
      いた**のが実機の「名前も変えられません」の正体。窓を通すこと。 */
   const coilBefore=((await get('/api/operation-item-master')).items||[])
     .find(i=>i.builtin==='coilStop');
   if(coilBefore){
    renamedCoil=coilBefore;
    await page.waitForSelector('#opModalForm .op-form-sec[data-op-sec="data"]',{timeout:8000});
    await page.waitForTimeout(400);
    await page.fill('#opdName',TAG+'-止め');
    await W.opSave(page);
    const saved=((await get('/api/operation-item-master')).items||[])
      .find(i=>i.builtin==='coilStop');
    rec('組み込みの欄の名前を窓から変えると保存される',
        !!saved&&saved.name===TAG+'-止め',JSON.stringify(saved&&saved.name));
    /* ---- 役割の一覧にも「いまの名前」が出る（§9.229 ⑥、利用者の指摘
           「文字の更新という部分ではプルダウンのリストに載っていないというか、
            古いままの名称でリンクされています」） ----
       **役割の名前は項目名とは別の語彙**（値を何として読むか）なので変えない。
       代わりに、いま担っている欄の名前を必ず並べて出す——`opRoleHolder`は
       自分を除いて探すので、**自分の役割の行だけ添え書きが付かず**、
       役割の名前（`コイル止め`）だけが残っていた。 */
    await page.evaluate(()=>{
     const t=[...document.querySelectorAll('.op-tile')]
       .find(e=>e.dataset.opId&&/-止め/.test(e.textContent));
     if(t)t.click();
    });
    await page.waitForFunction(()=>{
     const m=document.getElementById('opItemModal');return !!m&&!m.hidden;
    },null,{timeout:10000}).catch(()=>{});
    await page.waitForSelector('#opModalForm .op-form-sec[data-op-sec="data"]',{timeout:8000});
    await page.waitForTimeout(500);
    const roleTxt=await page.evaluate(()=>{
     const sel=document.getElementById('opdRole');
     if(!sel)return null;
     const o=sel.options[sel.selectedIndex];
     return o?o.textContent.trim():null;
    });
    rec('役割の一覧に「いまの項目名が担当」と出る（古い名前で終わらせない）',
        !!roleTxt&&roleTxt.indexOf(TAG+'-止め')>=0,JSON.stringify(roleTxt));
    await page.evaluate(()=>{const c=document.getElementById('opModalClose');if(c)c.click()});
    await page.waitForTimeout(300);
    await post('/api/operation-item-master/update',
      {...coilBefore,id:coilBefore.id,name:coilBefore.name,user_id:'tests'});
    renamedCoil=null;
    await page.evaluate(()=>{if(window.loadOpItemMaint)loadOpItemMaint(true)}).catch(()=>{});
    await page.waitForTimeout(700);
   }
   await page.evaluate(()=>{const c=document.getElementById('opModalClose');if(c)c.click()});
   await page.waitForTimeout(300);
  }

  /* ==========================================================
     2) 空き（ダミー）は**カード1枚**（§9.228 ②、利用者の指示
        「ダミーのカードだけ追加したいがダミー群ごとしか追加できないのも
         修正してほしい」「実際の画面にも『空き』という形でしっかり表示
         されている…実装したかったダミーで余白を作りたかった意味と全く違う」）
     ========================================================== */
  const before=await page.$$eval('.op-tile',es=>es.length);
  await page.click('#opAddPad');
  await page.waitForFunction(n=>document.querySelectorAll('.op-tile').length>n,
    before,{timeout:15000});
  await page.waitForTimeout(500);
  const tile=await page.evaluate(()=>{
   const t=document.querySelector('.op-tile.is-pad');
   if(!t)return null;
   const band=t.closest('.op-board-grid')
     ?[...document.querySelectorAll('.op-band')].map(b=>b.dataset.opBand):[];
   return {文字:t.textContent.replace(/\s+/g,''),
           群の帯:band.length,
           掴める:t.getAttribute('draggable')==='true'};
  });
  rec('「空きカードを追加」でカードが1枚増える（群は作らない）',
      !!tile,JSON.stringify(tile));
  /* **群ごと作らないこと**——利用者の指示。既存の群の中へ入る。 */
  rec('空きは既存の群の中に入る（新しい群を作らない）',
      !!tile&&tile.群の帯>0,JSON.stringify(tile));
  rec('空きのカードは掴んで動かせる',!!tile&&tile.掴める===true,JSON.stringify(tile));

  /* 名前を聞かない＝プロンプトを出さない（決めることを増やさない）。 */
  const srv=await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
  const pads=(srv.items||[]).filter(i=>i.dummy);
  rec('空きの印がサーバーに残る',pads.length>0,JSON.stringify(pads.map(i=>i.name)));
  rec('空きの行は有効なまま（無効にすると測定画面に届かない）',
      pads.every(i=>i.enabled!==false),JSON.stringify(pads.map(i=>i.enabled)));
  pads.forEach(i=>madeIds.push(i.id));

  /* ---- 右クリックメニュー（§9.228 ⑤） ---- */
  await page.click('.op-tile.is-pad',{button:'right'});
  await page.waitForSelector('.op-menu',{timeout:8000});
  const menu=await page.evaluate(()=>{
   const m=document.querySelector('.op-menu');
   return {幅:m.querySelectorAll('[data-opm-span]').length,
           削除:m.querySelectorAll('[data-opm-del]').length,
           項目へ:m.querySelectorAll('[data-opm-pad="0"]').length,
           /* **絞る**のが要件（利用者の指示）。ボタンを増やしすぎない。 */
           総数:m.querySelectorAll('button').length};
  });
  rec('右クリックで幅と削除のメニューが出る',
      menu.幅>=4&&menu.削除===1&&menu.項目へ===1,JSON.stringify(menu));
  rec('メニューは「よく使うものに絞る」（多すぎない）',menu.総数<=12,String(menu.総数));
  /* **閉じられること**を見る（§9.222 ①。開いたことだけ見る網は素通りする）。 */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  rec('メニューはEscで閉じる',
      await page.evaluate(()=>!document.querySelector('.op-menu')));
  await page.click('.op-tile.is-pad',{button:'right'});
  await page.waitForSelector('.op-menu',{timeout:8000});
  await page.mouse.click(5,5);
  await page.waitForTimeout(300);
  rec('メニューは外側クリックで閉じる',
      await page.evaluate(()=>!document.querySelector('.op-menu')));

  /* ==========================================================
     2c) 盤の掴み方（§9.230、利用者の指示）
       ①「マウスオーバーの位置がまずどの群の上にいるか、対象となる群に
          挿入位置を表示させてください」
       ②「右クリックで幅変更のボタンが…1/12(1マス)がない」
       ③「空きのカードを追加しても、ダブルクリックで編集がでない」
       ④「郡単位で移動できるようにしたいです」
     ========================================================== */
  /* ---- ② 1マス幅 ---- */
  await page.click('.op-tile.is-pad',{button:'right'});
  await page.waitForSelector('.op-menu',{timeout:8000});
  const spans=await page.$$eval('.op-menu [data-opm-span]',es=>es.map(e=>e.dataset.opmSpan));
  rec('右クリックの幅に1マス（1/12）がある',spans.includes('1'),JSON.stringify(spans));
  rec('幅の刻みは増やしても多すぎない',
      (await page.$$eval('.op-menu button',es=>es.length))<=14,'');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  /* ---- ③ 空きのカードも設定窓が開く ---- */
  await page.click('.op-tile.is-pad');
  await page.waitForFunction(()=>{
   const m=document.getElementById('opItemModal');return !!m&&!m.hidden;
  },null,{timeout:8000}).catch(()=>{});
  const padModal=await page.evaluate(()=>{
   const m=document.getElementById('opItemModal');
   if(!m||m.hidden)return null;
   return {tabs:[...document.querySelectorAll('#opModalForm .op-form-sec')]
             .map(t=>(t.querySelector('.op-form-sec-head')||t).textContent.replace(/\s+/g,'')),
           幅:!!document.querySelector('#opModalForm [data-op-span]'),
           削除:!!document.getElementById('opdDelete'),
           戻す:!!document.getElementById('opdPadOff')};
  });
  rec('空きのカードもクリックで設定窓が開く',!!padModal,JSON.stringify(padModal));
  rec('空きの窓で幅・削除・ふつうの項目へ戻すができる',
      !!padModal&&padModal.幅&&padModal.削除&&padModal.戻す,JSON.stringify(padModal));
  /* **決めることが無い列は出さない**（§4）——空きは名前も型も選ばせ方も持たない。 */
  rec('空きの窓に「何を記録するか」「どう見せるか」は出さない',
      !!padModal&&!padModal.tabs.some(t=>/記録|見せ/.test(t)),
      JSON.stringify(padModal&&padModal.tabs));
  await page.evaluate(()=>{const c=document.getElementById('opModalClose');if(c)c.click()});
  await page.waitForTimeout(300);

  /* ---- ① 挿入位置は「カーソルの真下の物」で決める ----
     群は横にも並べられる（§9.226 ③）ので、段だけで探すと同じ段に居る
     **隣の群の札**の境目が選ばれてしまう。真下に物があるときはその物で
     決める、が新しい規則。**ここで見るのは「真下の札の境目に付くこと」**
     ——左半分なら手前、右半分なら次。 */
  const dropInfo=await page.evaluate(()=>{
   const grid=document.querySelector('#masterMaintList .op-board-grid');
   if(!(window.WL&&WL.opBoard))return null;
   const tiles=[...grid.children].filter(el=>el.classList.contains('op-tile'));
   if(tiles.length<2)return null;
   const out=[];
   tiles.slice(0,4).forEach(t=>{
    const r=t.getBoundingClientRect();
    const left=WL.opBoard.dropAt(grid,{clientX:r.left+3,clientY:r.top+r.height/2});
    const right=WL.opBoard.dropAt(grid,{clientX:r.right-3,clientY:r.top+r.height/2});
    out.push({id:t.dataset.opId,
              左:left===t,
              右:(right===t.nextElementSibling)||(right===null&&!t.nextElementSibling),
              群:WL.opBoard.groupAt(grid,left)});
   });
   return out;
  });
  rec('前提: 盤の札で挿入位置を測れている',
      Array.isArray(dropInfo)&&dropInfo.length>=2,JSON.stringify(dropInfo));
  /* **真下の札の境目に付く**（左半分＝その札の手前／右半分＝次の札の手前）。 */
  rec('挿入位置はカーソルの真下の札の境目に付く',
      Array.isArray(dropInfo)&&dropInfo.length>0&&dropInfo.every(x=>x.左&&x.右),
      JSON.stringify(dropInfo));
  /* **落とし先の群を塗る**（線だけだと帯の上下どちらか読めない）。 */
  const painted=await page.evaluate(()=>{
   const grid=document.querySelector('#masterMaintList .op-board-grid');
   const bands=[...grid.children].filter(el=>el.dataset.opBand!==undefined);
   const bd=bands[1]||bands[0];
   let el=bd.nextElementSibling;
   if(!el)return null;
   const r=el.getBoundingClientRect();
   WL.opBoard.mark(grid,WL.opBoard.dropAt(grid,{clientX:r.left+r.width/2,clientY:r.top+r.height/2}));
   const on=[...document.querySelectorAll('.is-drop-group')];
   const out={n:on.length,帯:on.some(e=>e.dataset.opBand===bd.dataset.opBand),
              吹き出し:(document.querySelector('.op-drop-tag')||{}).textContent||''};
   WL.opBoard.clearMark();
   out.消えた=document.querySelectorAll('.is-drop-group').length===0;
   return out;
  });
  rec('落とし先の群を塗って見せる（帯も含めて）',
      !!painted&&painted.n>0&&painted.帯===true,JSON.stringify(painted));
  rec('どの群へ入るかを文字でも出す',
      !!painted&&/へ$/.test(String(painted.吹き出し).trim()),JSON.stringify(painted&&painted.吹き出し));
  rec('掴むのをやめたら塗りも消える',!!painted&&painted.消えた===true,JSON.stringify(painted));

  /* ---- ④ 群ごと移動 ----
     **元の並びをAPIで控えてから動かす**（§9.121）。`opSaveLayout()`は
     画面のDOM順をそのままマスタへ書くので、動かしたあと画面越しに戻すと
     **保存の往復と描き直しが噛み合わずに中途半端な並びが残る**
     ——実際に「誰が測るか」「測定表の形」が消えて`その他`になり、
     関係の無い`test_msteps`・`test_opui`が落ちた。控えは行の並びごと持ち、
     後片付けは必ずAPIで戻す。 */
  {
   const cur=await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
   layoutBackup=(cur.items||[]).map(i=>({id:i.id,group:i.group||'その他',
     place:i.place||'準備',span:Number(i.span)||4,required:!!i.required,
     enabled:i.enabled!==false,fold:!!i.fold,showWhen:i.showWhen||[]}));
  }
  const before4=await page.evaluate(()=>{
   const grid=document.querySelector('#masterMaintList .op-board-grid');
   return [...grid.children].filter(el=>el.dataset.opBand!==undefined)
     .map(el=>el.dataset.opBand);
  });
  /* 動かす前に前の「保存しました」を消す——残っていると待たずに通る。 */
  await page.evaluate(()=>{const e=document.getElementById('opLayoutState');if(e)e.textContent=''});
  const moved=await page.evaluate(names=>{
   const grid=document.querySelector('#masterMaintList .op-board-grid');
   const place=grid.dataset.opPlace;
   /* 2つ目の群を先頭へ動かす。 */
   return WL.opBoard.moveGroup(place,names[1],names[0]);
  },before4);
  await W.until(page,()=>/保存しました|できませんでした/.test((document.getElementById('opLayoutState')||{}).textContent||''));
  const after4=await page.evaluate(()=>{
   const grid=document.querySelector('#masterMaintList .op-board-grid');
   return {帯:[...grid.children].filter(el=>el.dataset.opBand!==undefined)
             .map(el=>el.dataset.opBand),
           /* **塊で動くこと**——帯の直後はその群の札でなければならない。 */
           塊:(()=>{
            const kids=[...grid.children];
            const i=kids.findIndex(el=>el.dataset.opBand!==undefined);
            const next=kids[i+1];
            return !!next&&next.dataset.opBand===undefined;
           })()};
  });
  rec('前提: 群を2つ以上持つ盤で動かせた',before4.length>=2&&moved===true,
      JSON.stringify({before4,moved}));
  rec('帯を掴むと群ごと動く（並びが入れ替わる）',
      after4.帯[0]===before4[1]&&after4.帯[1]===before4[0],
      JSON.stringify({前:before4.slice(0,3),後:after4.帯.slice(0,3)}));
  rec('群ごと動いても帯の下に札が付いてくる',after4.塊===true,JSON.stringify(after4));
  /* 後始末は`finally`がAPIで戻す（画面越しに戻さない）。 */

  /* ==========================================================
     N) 値が「この画面の外から」入る欄を配色で見分けられる（§9.234 ⑦、
        利用者の指示「操業データ項目の項目カード自体に自動に入力される
        ものについては配色してほしいです」）
     ========================================================== */
  /* **色は「変えたら変わること」で見る**——16進を期待値に直書きすると、
     トークンを直した瞬間に落ちる網になる。読むのは`requestAnimationFrame`
     2回のあと（面には遷移が掛かる箇所があり、押した直後は途中の値が返る）。 */
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const autoTiles=await page.evaluate(()=>{
   const bg=el=>el?getComputedStyle(el).backgroundColor:'';
   const one=sel=>document.querySelector(sel);
   const plain=[...document.querySelectorAll('.op-tile:not([data-op-auto]):not(.is-pad):not(.is-off)')][0];
   const c=one('.op-tile[data-op-auto="computed"]'),p=one('.op-tile[data-op-auto="preset"]');
   const chipOf=el=>{const b=el&&el.querySelector('.op-chip-auto');return b?b.textContent.trim():''};
   const leg=one('.op-auto-legend');
   return{自動:!!c,仕掛:!!p,素:!!plain,
     色:{自動:bg(c),仕掛:bg(p),素:bg(plain)},
     文字:{自動:chipOf(c),仕掛:chipOf(p)},
     凡例:leg?leg.textContent.replace(/\s+/g,' ').trim():''};
  });
  /* **前提を先に固定する**——0枚なら以降は何も確かめていない。 */
  rec('前提: 盤に「自動」と「仕掛から」のカードがある（§9.234 ⑦）',
      autoTiles.自動&&autoTiles.仕掛&&autoTiles.素,JSON.stringify({...autoTiles.色}));
  /* **3値を突き合わせる**——片方だけ塗る欠陥は2値の網では素通りする。 */
  rec('自動で入る欄はカードの地が変わる',
      autoTiles.色.自動&&autoTiles.色.自動!==autoTiles.色.素,JSON.stringify(autoTiles.色));
  rec('仕掛から入る欄も地が変わり、自動とも別の段',
      autoTiles.色.仕掛&&autoTiles.色.仕掛!==autoTiles.色.素
      &&autoTiles.色.仕掛!==autoTiles.色.自動,JSON.stringify(autoTiles.色));
  /* **色だけで伝えない**（§CLAUDE 3）。 */
  rec('色だけで伝えない（カードに分類の文字が出る）',
      /自動/.test(autoTiles.文字.自動)&&/仕掛/.test(autoTiles.文字.仕掛),
      JSON.stringify(autoTiles.文字));
  rec('盤の頭に分類名と件数が文字で出る（§9.105）',
      /自動\s*\d+件/.test(autoTiles.凡例)&&/仕掛から\s*\d+件/.test(autoTiles.凡例),
      autoTiles.凡例.slice(0,120));
  /* **境目を固定する**——マスタで決めた`[初期値]`は「設定」であって「連携」
     ではない。これを見ないと「全部塗る」実装が通る。 */
  {
   const r=await (await post('/api/operation-item-master',
     {equipment:EQ,group:TAG,name:TAG+' 初期値だけ',type:'文字',initial:'あ',user_id:'tests'})).json();
   if(r&&r.id)madeIds.push(r.id);
   await page.click('#masterMaintNav [data-master="opItem"]');
   await page.waitForSelector('.op-board',{timeout:20000});
   await page.waitForTimeout(900);
   const marked=await page.evaluate(n=>{
    const t=[...document.querySelectorAll('.op-tile')].find(e=>e.textContent.indexOf(n)>=0);
    return t?{見つかった:true,印:t.getAttribute('data-op-auto')||'',
      初期:!!t.querySelector('.op-chip-initial')}:{見つかった:false};
   },TAG+' 初期値だけ');
   rec('前提: 初期値だけの項目が盤に出ている',marked.見つかった===true,JSON.stringify(marked));
   rec('マスタで決めた初期値は配色しない（§9.234 ⑦）',
       marked.印===''&&marked.初期===true,JSON.stringify(marked));
  }

  /* ==========================================================
     見本は「いま触っている1つ」だけを実物どおりに（§9.276 ⑥、利用者の指示）
     ----------------------------------------------------------
     「単位の表示位置が追従していない…内部で表示するとき、単位が重複表示
      される。対象外で同一グループの時は単位の表示位置やUI配置がでたらめ。
      UIのサイズがバラバラで再現されていない。…変更中の対象項目だけの
      再現で十分なので再現度をしっかり上げてほしいです」

     §9.250 ⑤で隣の欄も並べていたが、あれはマスタの行から**自前で組み立てて**
     いたので本物と揃わなかった。**やめて1つに絞り**、その1つを測定画面と
     同じ口（`WL.opData.buildPreviewField`）で作る。
     **「隣が無い」だけを見る網にしないこと**——本体を描かない実装でも通る。
     ========================================================== */
  await page.waitForSelector('.op-board',{timeout:20000});
  await page.evaluate(()=>{const t=document.querySelector('.op-tile');if(t)t.click()});
  await page.waitForFunction(()=>{const m=document.getElementById('opItemModal');return !!m&&!m.hidden},
    null,{timeout:10000});
  await page.waitForTimeout(600);
  const only=await page.evaluate(()=>{
   const host=document.getElementById('opPrevField');
   const f=host&&host.querySelector('.opf');
   return {本体:!!f,
     印:f?f.classList.contains('opf-host'):null,
     欄:!!(host&&host.querySelector('input,select,output')),
     /* **記録の対象にしない**（`values()`は画面全体から`[data-op]`を拾う）。 */
     記録に混ざらない:!(host&&host.querySelector('[data-op]')),
     隣:document.querySelectorAll('#opModalPreview [data-op-ghost]').length};
  });
  rec('見本は本物の欄を1つ描く（測定画面と同じ印が付く）',
      only.本体&&only.印===true&&only.欄===true,JSON.stringify(only));
  rec('見本の欄は記録の対象にしない（開いているロットへ混ざらない）',
      only.記録に混ざらない===true,JSON.stringify(only));
  rec('隣の欄は並べない（本物と揃わない絵で幅を判断させない）',
      only.隣===0,JSON.stringify(only));
  /* 編集中の欄は**押したときだけ**ダミーが入る（黙って入れると
     「記録される値」が嘘になる）。 */
  const fill=await page.evaluate(async()=>{
   const raf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const btn=document.getElementById('opPrevFill');
   if(!btn)return {none:true};
   const ctl=document.querySelector('#opPrevField input,#opPrevField select,#opPrevField output');
   const before=ctl?String(ctl.value||''):'';
   btn.click();await raf();
   const after=ctl?String(ctl.value||''):'';
   return {before,after,line:document.getElementById('opPrevValue').textContent.trim()};
  });
  rec('編集中の欄は「見本の値を入れる」を押したときだけ入る',
      fill.none===true||(fill.before===''&&fill.after!==''&&fill.line.indexOf(fill.after)>=0),
      JSON.stringify(fill));
  /* **後始末**——窓を閉じる（この先の確認は盤と測定画面を見る）。 */
  await page.evaluate(()=>{const c=document.getElementById('opModalClose')
    ||document.querySelector('#opItemModal .mm-close');if(c)c.click()});
  await page.waitForTimeout(300);

  /* ---- 測定画面: 「空き」の文字がどこにも出ない ---- */
  await page.evaluate(()=>{const m=document.getElementById('masterMaintModal');if(m)m.hidden=true});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r){r.querySelector('.sc-row-start').click();return true}return false;
  });
  if(!started)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
  await page.waitForTimeout(1500);
  const pad=await page.evaluate(()=>{
   const el=document.querySelector('.selectors>[data-oppad="1"]');
   /* **「空き」という文字が測定画面に出ていないこと**（利用者の指摘）。 */
   const hits=[...document.querySelectorAll('.selectors>*')]
     .filter(e=>/空き/.test(e.textContent||''))
     .map(e=>({cls:e.className,t:(e.textContent||'').trim().slice(0,20)}));
   if(!el)return {あり:false,空きの文字:hits};
   const cs=getComputedStyle(el),r=el.getBoundingClientRect();
   return {あり:true,空きの文字:hits,文字:el.textContent.trim(),
     枠:cs.borderTopWidth,地:cs.backgroundColor,
     幅:Math.round(r.width),列:el.style.gridColumn};
  });
  rec('測定画面に空きのマスが置かれる',pad.あり===true,JSON.stringify(pad).slice(0,180));
  rec('測定画面に「空き」の文字はどこにも出ない',
      (pad.空きの文字||[]).length===0,JSON.stringify(pad.空きの文字));
  rec('空きは枠も文字も持たない',
      pad.あり&&pad.文字===''&&(pad.枠==='0px'||pad.枠===''),JSON.stringify(pad).slice(0,140));
  rec('空きは地を塗らない（透明）',
      pad.あり&&/rgba\(0, 0, 0, 0\)|transparent/.test(String(pad.地)),String(pad.地));
  rec('空きは幅ぶんのマスを取る',pad.あり&&pad.幅>40,String(pad.幅));
  const cnt=await page.evaluate(()=>{
   const f=(window.WL&&WL.opData&&WL.opData.filled)?WL.opData.filled():null;
   const defs=(window.WL&&WL.opData&&WL.opData.defs)?WL.opData.defs():[];
   return {f,dummy:defs.filter(d=>d.dummy).length,自由:defs.filter(d=>!d.builtin).length};
  });
  rec('前提: 空きの行は測定画面まで届いている',cnt.dummy>0,JSON.stringify(cnt));
  rec('空きの行は「記録した値」の分母に入らない',
      !!cnt.f&&cnt.f.total===cnt.自由-cnt.dummy,JSON.stringify(cnt));

  /* ==========================================================
     2b) 記録を開き直しても、選択肢マスタの変更が候補に届く
         （§9.229 ④、利用者の指示「操業データの選択肢の部分のマスタを
          変えても、連動してくれていません」）
     ========================================================== */
  const coilOpts=()=>page.evaluate(()=>{
   const el=document.getElementById('coilStop');
   return el?[...el.options].map(o=>o.text):null;
  });
  const before3=await coilOpts();
  rec('前提: コイル止めの候補が並んでいる',
      Array.isArray(before3)&&before3.length>0&&!before3.includes(TAG+'止め'),
      JSON.stringify(before3));
  /* **控えを持っていること**が前提——控えが無ければ毎回取り直すので、
     この網は何も確かめないまま通る（§CLAUDE「素通り」）。 */
  rec('前提: この記録は参照データの控えを持っている',
      await page.evaluate(()=>!!(S.measure&&S.measure.snapshot&&S.measure.snapshot.context)));
  const addRes=await post('/api/operation-choice-master',
    {name:'コイル止め',value:TAG+'止め',user_id:'tests'});
  const addJson=await addRes.json().catch(()=>({}));
  if(addJson&&addJson.id)madeChoiceIds.push(addJson.id);
  rec('前提: 選択肢マスタへ値を足せた',!!(addJson&&addJson.id),JSON.stringify(addJson));
  /* 再開の道（`force=false`）を通す——ここが控えを使う唯一の入口。 */
  await page.evaluate(()=>WL.records.loadMeasurementContext(false));
  await page.waitForFunction(t=>{
   const el=document.getElementById('coilStop');
   return !!el&&[...el.options].some(o=>o.text===t);
  },TAG+'止め',{timeout:8000}).catch(()=>{});
  const after3=await coilOpts();
  rec('開き直しても選択肢マスタの変更が候補に届く',
      (after3||[]).includes(TAG+'止め'),JSON.stringify(after3));
  /* **記録済みの値を落とさないこと**——取り直した候補にもう居ない値でも、
     記録には残っているので候補へ足す（§9.204の「黙って捨てる」を持ち込まない）。 */
  const keptOk=await page.evaluate(()=>{
   const el=document.getElementById('operator');
   if(!el)return null;
   S.measure.settings.operator='ZZ居ない人';
   WL.records.loadMeasurementContext(false);
   return true;
  });
  if(keptOk){
   await page.waitForTimeout(1200);
   const kept=await page.evaluate(()=>{
    const el=document.getElementById('operator');
    return el?{並び:[...el.options].map(o=>o.text).includes('ZZ居ない人'),値:el.value}:null;
   });
   rec('候補から消えた値でも、記録済みなら残る',
       !!kept&&kept.並び===true,JSON.stringify(kept));
  }

  /* ==========================================================
     3) 組み込みの欄も名前はマスタが決める（§9.228 ①）
     ========================================================== */
  const before2=await page.evaluate(()=>{
   const l=document.querySelector('.selectors>[data-f="coilStop"]');
   return l?l.textContent.trim().slice(0,20):'(無い)';
  });
  const coil=(srv.items||[]).find(x=>x.builtin==='coilStop');
  rec('前提: コイル止めは組み込みの欄として居る',!!coil,JSON.stringify(coil&&coil.name));
  if(coil){
   await post('/api/operation-item-master/update',
     {...coil,id:coil.id,name:TAG+'止め',user_id:'tests'});
   renamed=coil;
   /* 名前はマスタから読み直して**割り付けを通したとき**に効く（実際の
      画面では測定を開き直したときに通る道）。 */
   await page.evaluate(async()=>{
    WL.opData.forget();
    await WL.opData.load(true);
    WL.opData.layout();
   });
   await page.waitForTimeout(900);
   const after=await page.evaluate(()=>{
    const l=document.querySelector('.selectors>[data-f="coilStop"]');
    return l?{文字:l.textContent.trim(),欄:!!l.querySelector('select')}:null;
   });
   rec('組み込みの欄も名前を変えると測定画面に効く',
       !!after&&after.文字.indexOf(TAG+'止め')===0,
       JSON.stringify({前:before2,後:after&&after.文字.slice(0,24)}));
   /* **入力欄を消さないこと**——`textContent`ごと差し替えると`<select>`が消える。 */
   rec('名前を書き換えても入力欄は残る',!!after&&after.欄===true,JSON.stringify(after));
  }

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  /* **後始末**（§9.121）。db/master.sqlite3は実行をまたいで生き延びる。
     **改名した組み込みの欄も必ず戻す**——戻さないと次の実行が引き継ぐ。 */
  try{
   if(renamed)await post('/api/operation-item-master/update',
     {...renamed,id:renamed.id,name:renamed.name,user_id:'tests'});
   if(renamedCoil)await post('/api/operation-item-master/update',
     {...renamedCoil,id:renamedCoil.id,name:renamedCoil.name,user_id:'tests'});
  }catch(e){}
  try{
   const r=await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
   for(const it of (r.items||[]).filter(i=>i.dummy||madeIds.indexOf(i.id)>=0)){
    await post('/api/operation-item-master/delete',{id:it.id,user_id:'tests'});
   }
  }catch(e){}
  /* **並びと群を元へ戻す**（§9.121。`db/master.sqlite3`は実行をまたいで
     生き延びるので、崩したまま終わると次の実行が引き継ぐ）。空きの行は
     上で消しているので、いま在る行だけへ当てる。 */
  try{
   if(layoutBackup&&layoutBackup.length){
    const now=await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
    const alive=new Set((now.items||[]).map(i=>String(i.id)));
    const rows=layoutBackup.filter(r=>alive.has(String(r.id)));
    if(rows.length)await post('/api/operation-item-master/layout',
      {items:rows,user_id:'tests'});
   }
  }catch(e){}
  try{
   for(const id of madeChoiceIds){
    await post('/api/operation-choice-master/delete',{id,user_id:'tests'});
   }
  }catch(e){}

  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
