/* 条割のリアルタイム反映（§9.149）
   ============================================================
   「条割を実行」ボタンは廃止した。**触ったその場で測定表へ効く**ことと、
   **当てられないときは理由を文字で出す**ことを固定する。

   ここで見るのは3つ。
   - 開いた直後: 材料がそろった時点で当たっている（表の条数・ロット列が図と一致）
   - 並べ替え: 帯をドラッグして離した時点で、測定表のロット列が入れ替わる
   - 初めから: 既定の並びへ戻り、それも当たる

   **ダイアログが出ないこと**も見る——以前はalertで止めており、ドラッグの
   たびにダイアログが出る作りでは使えない。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B='http://127.0.0.1:5029',EQ='テスト設備A',LOT='L9000';
const setMode=m=>fetch(B+'/api/access-mode',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})});
let b=null;
const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
const snap=page=>page.evaluate(()=>({
 条数:document.getElementById('horizontalCount').value,
 groups:(S.measure.settings.splitGroups||[]).map(g=>g.lot+'×'+g.count),
 行:document.querySelectorAll('.measure-matrix tbody tr').length,
 ロット列:[...document.querySelectorAll('.measure-matrix td.mx-lot .strip-lot-badge')].map(e=>e.textContent),
 /* 帯に**いま出ている**ロットの文字（§9.213）。ラベルは「全部／末尾だけ」の
    2通りをDOMへ置いて幅ごとに選ぶので、`textContent`をそのまま読むと
    両方つながって出る。**見えているほうだけ**を読む。 */
 帯:[...document.querySelectorAll('#splitVisualStrip .split-visual-block')].map(e=>{
   const l=e.querySelector('.split-visual-block-label');
   if(!l)return '';
   const vis=[...l.querySelectorAll('.svb-lot,.svb-lot-short')]
     .find(x=>getComputedStyle(x).display!=='none');
   return vis?vis.textContent.trim():'';
 }),
 実行ボタン:!!document.getElementById('applySplit'),
 /* 「どのロットが何色か」（§9.159）。**並びではなくロット番号で引く**
    ——並び順で覚えると、並べ替えたときに何と比べているのか分からなくなる。 */
 色:Object.fromEntries([...document.querySelectorAll('#splitVisualStrip .split-visual-block')]
   .filter(e=>e.dataset.lot).map(e=>[e.dataset.lot,getComputedStyle(e).backgroundColor])),
 バッジ色:Object.fromEntries([...document.querySelectorAll('.measure-matrix td.mx-lot .strip-lot-badge')]
   .map(e=>[e.title||e.textContent.trim(),getComputedStyle(e).backgroundColor])),
 図の高さ:Math.round(document.getElementById('splitVisualStrip').getBoundingClientRect().height),
}));
const settle=async page=>{
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await page.waitForTimeout(250);
};
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1920,height:1080}});
 const dialogs=[],errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 page.on('dialog',d=>{dialogs.push(d.message().slice(0,80));d.accept()});
 try{
  await setMode('edit');
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  const opened=await page.evaluate(async lot=>{
   const r=await fetch('/api/table?'+new URLSearchParams({db:'SIKALOTNOW',table:'仕掛',page:1,page_size:5,
     include_hidden:1,filters:JSON.stringify([{column:'ロット番号',op:'eq',value:lot}])}));
   const row=((await r.json()).rows||[])[0];
   if(!row)return 'ロットが見つからない';
   await openMeasurement(row);return 'ok';
  },LOT).catch(e=>'例外: '+e.message);
  rec('分割ありロットを開ける',opened==='ok',String(opened));
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
  /* 子ロット候補がそろうまで待つ（条件待ち。固定待ちにしない） */
  await page.waitForFunction(
    ()=>document.querySelectorAll('#splitVisualStrip .split-visual-block').length>0,
    null,{timeout:20000}).catch(()=>{});
  await page.click('.mstep[data-mstep="2"]');
  await page.evaluate(()=>{const mt=document.getElementById('measureType');mt.value='板幅';
    mt.dispatchEvent(new Event('change',{bubbles:true}))});
  await settle(page);

  const a=await snap(page);
  rec('「条割を実行」ボタンは無い',a.実行ボタン===false,JSON.stringify(a));
  rec('開いた時点で条割が当たっている',
      a.groups.length===2&&a.条数==='2'&&a.行===2,JSON.stringify(a));
  /* 帯は幅次第で「ロット番号全部」か「末尾だけ」になる（§9.213）ので、
     **末尾で突き合わせる**——並びが同じかどうかを見たいのであって、
     何桁出ているかを見たいわけではない。 */
  const sameOrder=(lots,band)=>lots.length===band.length&&lots.length>0
    &&lots.every((v,i)=>String(band[i]).endsWith(String(v)));
  rec('測定表のロット列が帯と同じ並び',
      a.ロット列.length===2&&sameOrder(a.ロット列,a.帯),JSON.stringify(a));

  /* 帯の1条目をつかんで右端へ運ぶ（実機と同じポインタ操作） */
  const boxes=await page.$$('#splitVisualStrip .split-visual-block');
  if(boxes.length>=2){
   const p=await boxes[0].boundingBox(),q=await boxes[boxes.length-1].boundingBox();
   await page.mouse.move(p.x+p.width/2,p.y+p.height/2);
   await page.mouse.down();
   await page.mouse.move(p.x+p.width/2+20,p.y+p.height/2,{steps:3});
   await page.mouse.move(q.x+q.width-4,q.y+q.height/2,{steps:8});
   await page.mouse.up();
   await settle(page);
  }
  const c=await snap(page);
  rec('並べ替えたら測定表がその場で入れ替わる',
      c.ロット列.join()!==a.ロット列.join()&&sameOrder(c.ロット列,c.帯),
      JSON.stringify({前:a.ロット列,後:c.ロット列,帯:c.帯}));
  rec('並べ替えでも条数は変わらない',c.条数===a.条数&&c.行===a.行,JSON.stringify(c));
  /* ---- 色はロット番号だけで決まる（§9.159、利用者の指摘「D&Dで入れ替えた
     瞬間色味が変わる」） ----
     以前は`sources`/`groups`の**添字**で配っていたため、1条動かすだけで
     図・測定表のバッジ・幅分割の丸がいっせいに別の色になった。 */
  rec('並べ替えても子ロットの色が変わらない',
   Object.keys(a.色).length>=2&&Object.keys(a.色).every(l=>a.色[l]===c.色[l]),
   JSON.stringify({前:a.色,後:c.色}));
  rec('測定表のバッジの色も変わらない',
   Object.keys(a.バッジ色).length>=2&&Object.keys(a.バッジ色).every(l=>a.バッジ色[l]===c.バッジ色[l]),
   JSON.stringify({前:a.バッジ色,後:c.バッジ色}));
  /* **配り方そのものも見る。** 検証用ロットは子ロットが2件しか無く、しかも
     図の材料は候補の控え（元の順のまま）から来るので、**添字で配る実装へ
     戻しても図の色は動かない**ことがある（実際に注入して確かめた——落ちたのは
     バッジ側だけだった）。素通りしないよう、配る関数を直に呼んで順番に
     依らないことを確かめる。 */
  rec('色はロット番号だけで決まる（並べる順に依らない）',
   await page.evaluate(()=>{
    const x=WL.lotColors.map(['C52','C53','C51']),y=WL.lotColors.map(['C51','C53','C52','C53']);
    return ['C51','C52','C53'].every(k=>x[k]&&x[k]===y[k])&&new Set(Object.values(x)).size===3;
   }),
   JSON.stringify(await page.evaluate(()=>WL.lotColors.map(['C52','C53','C51']))));

  await page.click('#resetSplit').catch(()=>{});
  await settle(page);
  const d=await snap(page);
  rec('「初めから」で既定の並びへ戻り、それも当たる',
      d.ロット列.join()===a.ロット列.join()&&sameOrder(d.ロット列,d.帯),
      JSON.stringify({戻り:d.ロット列,帯:d.帯}));


  /* ---- 条の設計カードの姿（§9.157、利用者の指示「2枚目の条の設計も
     表示を最適化して」「スクロールレス設計で」） ----
     見るのは**実際の寸法**。DOMの数だけを見る網は、器が中身より大きくても
     素通りする（§9.126で実際に素通りした）。 */
  await page.evaluate(()=>WL.measureSteps.go('2'));
  await settle(page);
  const card=await page.evaluate(()=>{
   const c=document.getElementById('splitCard');
   const cs=getComputedStyle(c),r=c.getBoundingClientRect();
   /* **器そのものを測らないこと**——`.split-visual`は`flex:1`で必ず器の底まで
      伸びるので、直下の子の下端を見ると「余り0」と出て素通りする（この網を
      書いたときに実際に素通りした）。**いちばん下に見えている中身**
      （操作ボタンの行）で測る。 */
    const last=Math.max(...[...c.querySelectorAll('*')]
      .filter(e=>{const b=e.getBoundingClientRect();
        return b.height>0&&b.width>0&&e.children.length===0})
      .map(e=>e.getBoundingClientRect().bottom).concat([r.top]));
   const heads=[...c.querySelectorAll('h2,h3,.split-visual-head,.card-title')]
     .filter(e=>e.getBoundingClientRect().height>0);
   const strip=document.getElementById('splitVisualStrip').getBoundingClientRect();
   return{
    ころがし:Math.max(0,c.scrollHeight-c.clientHeight),
    余り:Math.round(r.bottom-parseFloat(cs.paddingBottom||0)-parseFloat(cs.borderBottomWidth||0)-last),
    見出し:heads.map(e=>e.textContent.trim().slice(0,20)),
    帯の高さ:Math.round(strip.height),
    条数の表示:[...c.querySelectorAll('*')].filter(e=>e.children.length===0
      &&/(^|[^0-9])9\s*条/.test(e.textContent||'')).map(e=>e.textContent.trim().slice(0,30)),
    説明欄:(()=>{const d=document.getElementById('splitVisualDetail');
      return{隠れ:!!d.hidden,高:Math.round(d.getBoundingClientRect().height)}})(),
   };
  });
  rec('条の設計カードはスクロールしない',card.ころがし===0,JSON.stringify(card));
  /* 余りは「置くべきものを別の場所へ隠している」ことの現れ（§9.131）。
     ここには畳んでいるものが無いので、**図が使い切る**のが正しい。 */
  rec('カードの下に余りを残さない',card.余り<=8,'余り='+card.余り+'px');
  /* 図は1つしかないので**カードの題がそのまま図の題**。中に群の見出しを
     置くと、同じことを2回言うことになる（§CLAUDE.md 同じ情報を2箇所に
     出さない）。 */
  rec('カードの中の見出しは題の1つだけ',card.見出し.length===1,JSON.stringify(card.見出し));
  /* 条数は`#splitGrid`の状態行が言う。隣にもう1つ「9条」のチップを
     置かないこと。 */
  rec('条数を2箇所に書かない',card.条数の表示.length<=1,JSON.stringify(card.条数の表示));
  /* 掴んだ条の説明は**中身が無いときは畳む**（空のまま場所を取っていた）。 */
  rec('説明欄は掴む前は畳んでいる',card.説明欄.隠れ&&card.説明欄.高===0,JSON.stringify(card.説明欄));
  /* 掴む的は大きいほどよい。以前は88px固定で、下に45pxの空きが残っていた。 */
  rec('帯はカードの高さを使い切る（88px固定に戻っていない）',card.帯の高さ>100,
      card.帯の高さ+'px');

  /* ---- 押した結果を返す（§9.159、利用者の指摘「クリックしたら図形の
     サイズが変わる」「どれをクリックしたか分からない」） ----
     **実際にポインタで押す。** 関数を直に呼ぶと、閾値でタップとドラッグを
     分けている作りそのものを確かめられない。 */
  const before=await snap(page);
  const tap=async i=>{
   const bs=await page.$$('#splitVisualStrip .split-visual-block');
   const r=await bs[i].boundingBox();
   await page.mouse.move(r.x+r.width/2,r.y+r.height/2);
   await page.mouse.down();await page.mouse.up();
   await settle(page);
  };
  await tap(0);
  const tapped=await page.evaluate(()=>{
   const bs=[...document.querySelectorAll('#splitVisualStrip .split-visual-block')];
   const d=document.getElementById('splitVisualDetail'),h=document.getElementById('splitVisualHint');
   const sel=bs.filter(e=>e.classList.contains('is-selected'));
   return{選ばれた数:sel.length,先頭が選ばれた:bs[0]?.classList.contains('is-selected')||false,
     印:sel[0]?getComputedStyle(sel[0]).boxShadow.includes('inset'):false,
     外枠:sel[0]?getComputedStyle(sel[0]).outlineWidth:'',
     説明:(d.textContent||'').trim(),説明が出ている:!d.hidden,案内が引っ込んだ:!!h.hidden,
     図の高さ:Math.round(document.getElementById('splitVisualStrip').getBoundingClientRect().height)};
  });
  rec('押しても図の高さが変わらない',tapped.図の高さ===before.図の高さ,
   `${before.図の高さ}px → ${tapped.図の高さ}px`);
  rec('押した条に印が付く（1つだけ）',tapped.選ばれた数===1&&tapped.先頭が選ばれた,
   JSON.stringify(tapped));
  /* 印は**内側**に描く。`outline`だと隣の帯（絶対配置）が上に来て片側が消える。 */
  rec('印は内側に描く（外枠で隣にかぶせない）',tapped.印&&(tapped.外枠==='0px'||tapped.外枠===''),
   JSON.stringify({印:tapped.印,外枠:tapped.外枠}));
  rec('押した条の説明が案内と入れ替わって出る',
   tapped.説明が出ている&&tapped.案内が引っ込んだ&&/条目/.test(tapped.説明),tapped.説明);
  await tap(0);
  const untapped=await page.evaluate(()=>({
   選ばれた数:document.querySelectorAll('#splitVisualStrip .split-visual-block.is-selected').length,
   案内が戻った:!document.getElementById('splitVisualHint').hidden,
   図の高さ:Math.round(document.getElementById('splitVisualStrip').getBoundingClientRect().height)}));
  rec('もう一度押すと選択が外れ、高さも戻らない（変わらない）',
   untapped.選ばれた数===0&&untapped.案内が戻った&&untapped.図の高さ===before.図の高さ,
   JSON.stringify(untapped));
  /* ---- 図の両端は「軸の名前」（§9.159、利用者の指摘「OS,DSが屑条みたいな
     バッジでわかりにくい」）。塗りを持つと隣の屑帯と同じ種類に見える。 ---- */
  const ends=await page.evaluate(()=>[...document.querySelectorAll('.split-visual-end')].map(e=>{
   const s=getComputedStyle(e);
   return{t:e.textContent.trim(),bg:s.backgroundColor,radius:s.borderTopLeftRadius,title:e.title};
  }));
  rec('OS/DSは塗りのバッジではない（面と角丸を持たない）',
   ends.length===2&&ends.every(e=>/rgba\(0, 0, 0, 0\)|transparent/.test(e.bg)&&parseFloat(e.radius)===0),
   JSON.stringify(ends));
  rec('OS/DSの読み方が図の案内に文字で書いてある',
   await page.evaluate(()=>/OS/.test(document.getElementById('splitVisualHint').textContent||'')
     &&/DS/.test(document.getElementById('splitVisualHint').textContent||'')
     &&/オペレータ|駆動/.test(document.getElementById('splitVisualHint').textContent||'')),
   await page.evaluate(()=>(document.getElementById('splitVisualHint').textContent||'').trim()));

  /* ---- 屑幅の割り付け（§9.160、利用者の指示「屑幅を片側に少し寄せたりする
     ので、通常は均等だが片寄せする形で修正入力できるように」） ----
     **検証用フィクスチャには寸法の列が無い**（`make_split_fixture.py`が、
     列を足すと既存2000行がNULL＝0になって公差が壊れるため意図的に足していない）。
     入れずに「出ない」を見ても壊れていても同じ結果になるので、**材料ごと
     注ぎ込んで**確かめる。元幅1030 − 条幅合計(500+480)=980 → 屑幅50。 */
  const feedScrap=()=>page.evaluate(()=>{
   S.measure.basic.originalWidth='1030';
   (S.measure.settings.splitGroups||[]).forEach((g,i)=>{
     g.base={...(g.base||{}),width:i===0?500:480};g.missing=false});
   (S.measure.settings.splitSourcesCache||[]).forEach((x,i)=>{
     x.base={...(x.base||{}),width:i===0?500:480};x.missing=false;x.width=i===0?500:480});
   refreshSplitStatusPanel();
  });
  const scrap=()=>page.evaluate(()=>{
   const el=id=>document.getElementById(id);
   const band=s=>{const e=document.querySelector(s);
     return{隠れ:!!e.hidden,文:(e.textContent||'').replace(/\s+/g,''),
            幅:Math.round(e.getBoundingClientRect().width)}};
   return{行が出ている:!el('splitScrapAlloc').hidden,
     状態:(el('scrapAllocState').textContent||'').trim(),
     OS:el('scrapAllocOs').value,DS:(el('scrapAllocDs').textContent||'').trim(),
     均等ボタン:!el('scrapAllocEven').disabled,
     保存値:S.measure.settings.scrapOsWidth,
     注意:(el('scrapAllocNote').textContent||'').trim(),
     帯:{os:band('#splitVisualScrapOs'),ds:band('#splitVisualScrapDs')}};
  });
  const typeOs=async v=>{
   await page.evaluate(x=>{const el=document.getElementById('scrapAllocOs');
     el.value=x;el.dispatchEvent(new Event('input',{bubbles:true}))},v);
   await settle(page);
  };
  await feedScrap();await settle(page);
  const s0=await scrap();
  rec('屑幅が求まると割り付けの行が出て、既定は均等',
      s0.行が出ている&&s0.状態==='均等'&&s0.OS==='25.0'&&s0.DS==='25.0'
      &&s0.均等ボタン===false,JSON.stringify(s0));
  await typeOs('10');
  const s1=await scrap();
  /* 欄の値は**打ち終わっていれば整形して返す**（打っている最中は触らない
     ——1文字ごとにカーソルが末尾へ飛ぶため）。ここは`input`を投げているだけで
     フォーカスは載っていないので、整形後の「10.0」が入る。 */
  rec('OS側を入れるとDS側が残りになり、片寄せと分かる文字が出る',
      Number(s1.OS)===10&&s1.DS==='40.0'&&/片寄せ/.test(s1.状態)&&/DS/.test(s1.状態),
      JSON.stringify(s1));
  rec('片寄せは図の屑帯にもそのまま出る（OSが細くDSが太い）',
      /屑10\.0/.test(s1.帯.os.文)&&/屑40\.0/.test(s1.帯.ds.文)
      &&s1.帯.os.幅<s1.帯.ds.幅,JSON.stringify(s1.帯));
  rec('片寄せの値はレコードに残る（保存の対象）',Number(s1.保存値)===10,String(s1.保存値));
  /* **両耳合計を超える値は入れられない。** 黙って丸めず、丸めたことを言う。 */
  await typeOs('999');
  const s2=await scrap();
  rec('両耳合計を超える値は丸めて、丸めたことを言う',
      s2.DS==='0.0'&&s2.注意!=='',JSON.stringify({DS:s2.DS,注意:s2.注意}));
  /* 異常位置判定は**同じ割り付けを使う**——ここで「左右均等」と決め打ちに
     すると、片寄せしたロットで条の番号が寄せたぶんずれる。 */
  await typeOs('10');
  const defect=await page.evaluate(()=>{
   const info=WL.split.scrapInfo();
   return{os:info.os,ds:info.ds,片寄せ:info.biased};
  });
  rec('屑幅の割り付けは1箇所（WL.split.scrapInfo）が答える',
      defect.os===10&&defect.ds===40&&defect.片寄せ===true,JSON.stringify(defect));
  await page.evaluate(()=>document.getElementById('scrapAllocEven').click());
  await settle(page);
  const s3=await scrap();
  rec('「均等に戻す」で均等へ戻り、設定も消える',
      s3.状態==='均等'&&s3.OS==='25.0'&&s3.DS==='25.0'&&s3.保存値===''
      &&s3.均等ボタン===false,JSON.stringify(s3));

  /* ---- 図の上で直す（§9.167、利用者の指示「マウス操作で直接屑幅を調節して
     修正することもできるように」） ----
     数値欄だけだと「どちらへどれだけ寄るのか」を頭の中で図へ翻訳しないと
     決められない。条の束の縁をそのまま掴めること・引いた結果が数値欄と
     保存値へ入ること・ダブルクリックで均等へ戻ることを固定する。 */
  await feedScrap();await settle(page);
  const gripEl=await page.$('#splitScrapGripOs');
  const gb=gripEl?await gripEl.boundingBox():null;
  rec('条の束の縁につまみが出る',!!gb&&gb.width>0&&gb.height>0,JSON.stringify(gb));
  if(gb){
   /* **つまみは条の束の縁にある**（屑の帯と束の境目）。ずれていると、
      掴んだつもりで別のものを掴む。 */
   const sb=await (await page.$('#splitVisualStrip')).boundingBox();
   rec('つまみの位置が条の束の左端に合っている',Math.abs((gb.x+gb.width/2)-sb.x)<=2,
       JSON.stringify({grip:Math.round(gb.x+gb.width/2),strip:Math.round(sb.x)}));
   const cx=gb.x+gb.width/2,cy=gb.y+gb.height/2;
   await page.mouse.move(cx,cy);await page.mouse.down();
   await page.mouse.move(cx+8,cy,{steps:6});await page.mouse.up();
   await settle(page);
   const d=await scrap();
   rec('つまみを右へ引くとOS側が広がる',Number(d.保存値)>25,JSON.stringify({保存値:d.保存値,OS:d.OS}));
   rec('引いた結果は数値欄にもそのまま出る',Number(d.OS)===Number(d.保存値),
       JSON.stringify({OS:d.OS,保存値:d.保存値}));
   rec('引いた結果は片寄せとして状態に出る',/片寄せ/.test(d.状態),d.状態);
   /* ダブルクリックで均等へ。掴んだ場所のまま戻せること（「均等に戻す」
      ボタンまで視線を動かさなくてよい）。 */
   const g2=await (await page.$('#splitScrapGripOs')).boundingBox();
   await page.mouse.dblclick(g2.x+g2.width/2,g2.y+g2.height/2);
   await settle(page);
   const d2=await scrap();
   rec('つまみのダブルクリックで均等へ戻る',d2.状態==='均等'&&d2.保存値==='',
       JSON.stringify({状態:d2.状態,保存値:d2.保存値}));
  }

  /* ==================================================================
     §9.209 ② 分割の無いロットでも条の図を出す（利用者の指示）
     ------------------------------------------------------------------
     「分割なしでも、取得済みのロットのデータで図を表現してほしいです。
      屑幅の片寄や条割数の視覚化、異常発生時の条番号特定など様々な機能を
      使う必要があります。」
     材料は親ロット自身（条数＝横割数）。**並べ替えはできない**ので、
     掴める見た目・案内・「1つ戻す」は出さない（§4）。
     ================================================================== */

  /* ================= 帯のロット番号は幅で桁数が変わる（§9.213） =========
     利用者の指示「条幅が広い場合は、ロット番号全てを表示、幅が狭いものは
     下2桁表示。幅が狭いものかつ異幅切断の場合は下3桁表示」。
     ここは**異幅切断**のロット（切断巾 500/480）で条は2本しかない＝広いので、
     見えるのは**ロット番号全部**。**用意されている末尾は3桁**であることも
     見る（異幅なら3桁・等幅なら2桁。狭くなったときにどちらが出るかは
     用意した文字で決まる）。**狭いほうの見え方は分割なしのロットで見る**
     ——ここは条数が子ロットで決まっており、横割数を触っても条は増えない
     （実際に30を入れても2本のままだった）。 */
  const labelState=()=>page.evaluate(()=>{
   const blocks=[...document.querySelectorAll('#splitVisualStrip .split-visual-block[data-lot]')]
     .filter(e=>e.dataset.lot);
   /* 異幅かどうかは**画面が持っている条幅の鍵**（`data-wkey`）で数える
      ——テストで決め打ちにすると、フィクスチャを直したとき嘘の期待値が残る。 */
   const widths=new Set(blocks.map(e=>e.dataset.wkey||'').filter(Boolean));
   return {mixed:widths.size>1,
     items:blocks.map(e=>{
      const l=e.querySelector('.split-visual-block-label');
      const vis=l?[...l.querySelectorAll('.svb-lot,.svb-lot-short')]
        .find(x=>getComputedStyle(x).display!=='none'):null;
      const sh=l?l.querySelector('.svb-lot-short'):null;
      return {lot:e.dataset.lot,w:Math.round(e.getBoundingClientRect().width),
              text:vis?vis.textContent.trim():'',
              short:sh?sh.textContent.trim():'',
              none:!!(l&&getComputedStyle(l).display==='none')};
     })};
  });
  const wideLbl=await labelState();
  rec('異幅切断のロットで確かめている（3桁の道を通る）',wideLbl.mixed===true,
      JSON.stringify(wideLbl.items.map(x=>x.w)));
  rec('条幅が広いときはロット番号を全部出す',
      wideLbl.items.length>0&&wideLbl.items.every(x=>x.text===x.lot),
      JSON.stringify(wideLbl.items.map(x=>[x.w,x.text])));
  rec('異幅切断では末尾を3桁で用意する',
      wideLbl.items.length>0&&wideLbl.items.every(x=>x.short.length===3&&x.lot.endsWith(x.short)),
      JSON.stringify(wideLbl.items.map(x=>[x.lot,x.short])));

  const plain=await page.evaluate(async()=>{
   const r=await fetch('/api/table?'+new URLSearchParams({db:'SIKALOTNOW',table:'仕掛',page:1,page_size:50}));
   const rows=(await r.json()).rows||[];
   /* 分割データを持たない行を選ぶ（`WL.split.hasSplit`が判定の1箇所）。 */
   const row=rows.find(x=>!WL.split.hasSplit(x));
   if(!row)return{無い:true};
   await openMeasurement(row);
   await new Promise(r2=>setTimeout(r2,1200));
   const h=document.getElementById('horizontalCount');
   h.value='6';h.dispatchEvent(new Event('change',{bubbles:true}));
   await new Promise(r2=>setTimeout(r2,900));
   const strip=document.getElementById('splitVisualStrip');
   const box=document.querySelector('#splitCard .split-visual');
   return{
    図が出る:!!box&&!box.hidden&&box.getBoundingClientRect().height>0,
    条の数:strip?strip.querySelectorAll('.split-visual-block').length:0,
    印:!!strip&&strip.classList.contains('split-visual-self'),
    状態:(document.querySelector('#splitGrid .split-panel-status')||{}).textContent||'',
    案内:(document.getElementById('splitVisualHint')||{}).textContent||'',
    戻すボタン:!document.getElementById('undoSplit')?.hidden,
    /* 子ロットの内訳は**条の設計カードの中の折りたたみ**へ移した（§9.215）。 */
    子ロット面:!document.querySelector('#splitCard .split-layout')?.hidden,
   };
  });
  rec('分割なしでも条の図が出る（§9.209 ②）',
      plain.無い?false:(plain.図が出る===true&&plain.条の数===6),JSON.stringify(plain));
  rec('条数は横割数と一致する',plain.条の数===6,String(plain.条の数));
  rec('分割なしであることと条数を文字でも言う',/分割無し/.test(plain.状態||'')&&/6/.test(plain.状態||''),
      plain.状態);
  rec('並べ替えられないので案内も「1つ戻す」も出さない（§4）',
      plain.印===true&&plain.戻すボタン===false&&!/並べ替え/.test(plain.案内||''),
      JSON.stringify({印:plain.印,戻す:plain.戻すボタン,案内:(plain.案内||'').slice(0,40)}));
  rec('子ロットの編集面は出さない（並べ替える条が無い）',plain.子ロット面===false,
      String(plain.子ロット面));
  /* ---- 狭い条は末尾だけ。等幅なので**2桁**（§9.213、利用者の指示） ----
     分割なしのロットは条幅が1種類（＝等幅）なので、ここが2桁の道。
     条数を増やして実際に狭くしてから見る。 */
  const thin=await page.evaluate(async()=>{
   const h=document.getElementById('horizontalCount');
   if(!h)return{無い:true};
   h.value='24';h.dispatchEvent(new Event('change',{bubbles:true}));
   await new Promise(r=>setTimeout(r,1100));
   const blocks=[...document.querySelectorAll('#splitVisualStrip .split-visual-block[data-lot]')]
     .filter(e=>e.dataset.lot);
   const widths=new Set(blocks.map(e=>e.dataset.wkey||'').filter(Boolean));
   return {mixed:widths.size>1,条数:blocks.length,
     items:blocks.map(e=>{
      const l=e.querySelector('.split-visual-block-label');
      const vis=l?[...l.querySelectorAll('.svb-lot,.svb-lot-short')]
        .find(x=>getComputedStyle(x).display!=='none'):null;
      const sh=l?l.querySelector('.svb-lot-short'):null;
      return {lot:e.dataset.lot,w:Math.round(e.getBoundingClientRect().width),
              text:vis?vis.textContent.trim():'',short:sh?sh.textContent.trim():''};
     })};
  });
  rec('等幅の道で確かめている（2桁の道を通る）',thin.mixed===false&&thin.条数===24,
      JSON.stringify({mixed:thin.mixed,条数:thin.条数}));
  rec('等幅なら末尾は2桁で用意する',
      !!thin.items&&thin.items.length>0
      &&thin.items.every(x=>x.short.length===2&&x.lot.endsWith(x.short)),
      JSON.stringify((thin.items||[]).slice(0,3).map(x=>[x.lot,x.short])));
  /* **実際に狭くなっていること**まで見る（広いままだと「全部出す」で
     通ってしまい、短縮の道を一度も通らない）。 */
  const thinShown=(thin.items||[]).filter(x=>x.text);
  rec('狭い条では末尾だけを出す',
      thinShown.length>0&&thinShown.every(x=>x.text===x.short&&x.text!==x.lot),
      JSON.stringify(thinShown.slice(0,3).map(x=>[x.w,x.text,x.lot])));
  /* 条を押すと、どの条かが文字で出る（異常位置の特定に使う）。 */
  const picked=await page.evaluate(async()=>{
   const bs=[...document.querySelectorAll('#splitVisualStrip .split-visual-block')];
   if(bs.length<3)return{少ない:true};
   const r=bs[2].getBoundingClientRect();
   bs[2].dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));
   await new Promise(x=>setTimeout(x,250));
   return{選んだ:document.querySelectorAll('#splitVisualStrip .split-visual-block.is-selected').length,
          説明:(document.getElementById('splitVisualDetail')||{}).textContent||''};
  });
  rec('条を押すとどの条かが文字で出る（異常位置の特定）',
      picked.選んだ===1&&/3/.test(picked.説明||''),JSON.stringify(picked));

  /* ==================================================================
     §9.229 ⑤ 異常のチップとボタンが見切れない（利用者の指摘）
     ------------------------------------------------------------------
     「条の設計の異常関係の表示に見切れがあります。」
     案内の文が長いと、flexの既定（`flex-shrink:1`）でチップとボタンまで
     一緒に縮み、`異常 1条／未保存`や`異常の印: 出す`が空白で折り返して
     器から溢れていた。**縮む役は案内だけが持つ。**

     **判定を注ぎ込んでから測ること**——チップは判定があるときだけ出るので、
     入れずに測ると`hidden`のまま「見切れていない」で素通りする。
     **窓を狭めてから測ること**——広い窓では縮む必要が無いので、直す前でも
     通る（実機の器は940px、ここは1920px）。
     ================================================================== */
  const defectFit=await page.evaluate(async()=>{
   /* **測るのは「縮んだときに折り返さないこと」**なので、出る条件
      （判定があること・分割があること）はここでは作らない——実際に出ている
      状態と同じ中身を入れて、**器を狭くしてから**測る。文字は
      `renderDefectChip()`が出すものと同じ形（`異常 N条` ＋ 状態）。 */
   const chip=document.getElementById('splitDefectChip');
   const mark=document.getElementById('splitDefectToggle');
   const undo=document.getElementById('undoSplit');
   const reset=document.getElementById('resetSplit');
   if(chip){chip.hidden=false;chip.innerHTML='<b>異常 1条</b><small>未保存</small>';
            chip.classList.add('is-hit')}
   if(mark){mark.hidden=false;mark.textContent='異常の印: 出す'}
   if(undo)undo.hidden=false;
   if(reset)reset.hidden=false;
   /* **器を狭くする。** 広いままだと縮める必要が無いので、直す前でも通る
      （実機の器は940px、ここは1920px）。窓ごと狭めると測定画面の割り付けが
      変わって図が消えるので、この帯だけを狭める。 */
   const row=document.querySelector('.split-visual-actions');
   const pick=el=>{
    /* **`offsetParent`で見えているかを判定しないこと**——測定画面は
       `position:fixed`の器なので、中の要素は常に`null`になる。 */
    if(!el)return null;
    const r=el.getBoundingClientRect();
    if(r.width<1)return null;
    const cs=getComputedStyle(el);
    const n=v=>parseFloat(v)||0;
    /* **1行ぶんの高さは「文字＋上下の余白＋罫線」で作る**（§9.90）。
       `line-height`だけと比べると、余白を持つボタンが全部2行扱いになる。 */
    const one=Math.max(n(cs.minHeight),
      n(cs.lineHeight)+n(cs.paddingTop)+n(cs.paddingBottom)
      +n(cs.borderTopWidth)+n(cs.borderBottomWidth));
    return {text:(el.textContent||'').trim().slice(0,24),
            over:Math.round(el.scrollWidth-el.clientWidth),
            w:Math.round(r.width),
            h:Math.round(r.height),line:Math.round(one)};
   };
   /* **広いときの高さを先に測って物差しにする**（§9.229 ⑤）。トークンから
      1行ぶんを組み立てると、余白の出どころ（器か中身か）で食い違って
      「全部2行」と読み違える。**同じ要素の広いときと狭いときを比べる**のが
      いちばん確か——折り返せば必ず背が伸びる。 */
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const wide={chip:pick(chip),mark:pick(mark),undo:pick(undo),reset:pick(reset)};
   /* **狭さは決め打ちにしない。** 4つが自然に必要とする幅を測って、
      そこから確実に足りない幅まで詰める——「700px」のような決め打ちだと、
      案内（`min-width:0`で0まで縮む）が縮み代を全部吸ってしまい、
      **直す前でも縮まないので素通りする**（実際に素通りした）。 */
   const need=['chip','mark','undo','reset']
     .reduce((n,k)=>n+((wide[k]&&wide[k].w)||0),0);
   if(row)row.style.maxWidth=Math.max(160,need-80)+'px';
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const out={row:row?Math.round(row.getBoundingClientRect().width):0,need,wide,
     chip:pick(chip),mark:pick(mark),undo:pick(undo),reset:pick(reset)};
   if(row)row.style.maxWidth='';
   if(chip){chip.hidden=true;chip.classList.remove('is-hit')}
   if(mark)mark.hidden=true;
   if(undo)undo.hidden=true;
   if(reset)reset.hidden=true;
   return out;
  });
  const KEYS=['chip','mark','undo','reset'];
  rec('前提: 異常のチップとボタンを広いときと狭いときの両方で測れている',
      defectFit.row>0&&defectFit.row<defectFit.need
      &&KEYS.every(k=>defectFit[k]&&defectFit.wide[k]
        &&defectFit[k].h>0&&defectFit.wide[k].h>0),JSON.stringify(defectFit));
  const over=KEYS.filter(k=>defectFit[k]&&defectFit[k].over>1);
  rec('異常のチップとボタンが器から溢れない（見切れない）',over.length===0,
      JSON.stringify(over.map(k=>[k,defectFit[k]])));
  /* **狭くしても背が伸びない**——溢れていなくても、折り返して2行になった
     ぶんだけ器の高さを食い、押す前に何のボタンか読めなくなる。 */
  const tall=KEYS.filter(k=>defectFit[k]&&defectFit.wide[k]
    &&defectFit[k].h>defectFit.wide[k].h+2);
  rec('狭くしても異常のチップとボタンが折り返さない',tall.length===0,
      JSON.stringify(tall.map(k=>[k,defectFit.wide[k].h,defectFit[k].h])));

  /* ==================================================================
     §9.210 ⑤ 屑幅がマイナスになる条数は受け付けない（利用者の指示）
     ------------------------------------------------------------------
     「屑幅マイナスになる場合、物理的に不可能なので、母材幅が修正されない
      限り条数変更をそれ以上受け付けないようにしてください。」
     ================================================================== */
  /* **材料ごと注ぎ込む。** 検証用フィクスチャの仕掛は元幅（実績）も
     製造板幅も空で、そのままでは`stripCountLimit()`が`null`（＝判断できない
     ので素通し）を返す。空のまま「0件」を見ても、壊れていても同じ結果に
     なるので何も確かめていない（§9.125の公差と同じ罠）。 */
  const lim=await page.evaluate(async()=>{
   S.measure.basic.originalWidth='1250';
   S.measure.basic.mfgWidth='100';
   const h=document.getElementById('horizontalCount');
   h.value='6';h.dispatchEvent(new Event('change',{bubbles:true}));
   await new Promise(r=>setTimeout(r,350));
   const l=WL.split.stripCountLimit&&WL.split.stripCountLimit();
   return l?{max:l.max,元幅:l.original,板幅:l.width}:null;
  });
  rec('最大条数を答えるのは1箇所（WL.split.stripCountLimit）',
      !!lim&&lim.max>=1&&lim.max*lim.板幅<=lim.元幅+0.001,JSON.stringify(lim));
  if(lim){
   const over=await page.evaluate(async m=>{
    const h=document.getElementById('horizontalCount');
    h.value=String(m+3);h.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,400));
    const info=WL.split.scrapInfo();
    return{値:Number(h.value),屑:info?Math.round(info.scrap*100)/100:null,
      案内:[...document.querySelectorAll('#toastArea .toast b')].map(x=>x.textContent).join(' / ')};
   },lim.max);
   rec('屑幅がマイナスになる条数は受け付けない（§9.210 ⑤）',
       over.値===lim.max&&over.屑!==null&&over.屑>=-0.001,JSON.stringify(over));
   rec('断った理由と打つ手を文字で出す',/条を割れません/.test(over.案内),over.案内);
   const okv=await page.evaluate(async m=>{
    const h=document.getElementById('horizontalCount');
    h.value=String(Math.max(1,m-1));h.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,350));
    return Number(h.value);
   },lim.max);
   rec('入る条数まではそのまま通す',okv===Math.max(1,lim.max-1),String(okv));
  }

  /* ==================================================================
     §9.210 ④ 同じ幅の条は同じ見せ方（利用者の指示）
     ------------------------------------------------------------------
     「多条割の場合、図の中に文字は入るかどうかきわどい時に、同じ幅にも
      かかわらず、表示があるものとないものが混在するときがあります。」
     以前は「帯が全体の4%より広いか」だけを見ていたため、%の丸めで
     しきい値をまたぐ条だけラベルが消えていた。判定の鍵は**条幅**。
     **等幅で条数を増やしながら見る**——1つの条数だけ見ても、たまたま
     全部出る／全部消える状態しか通らず、直す前でも素通りする。
     条数は§9.210 ⑤の上限まで（超えると受け付けないのが正しい振る舞い）。 */
  /* **条数ごとに母材幅も合わせる。** 元幅を固定したまま条数を変えても、
     1条の幅（mm）が変わらない以上**画面上の1条の幅も変わらない**
     （実測でどの条数でも18px。屑の帯が伸び縮みするだけ）。それでは
     境目を一度も通らない。実機で見たいのは「母材をほぼ使い切って条を
     細かく割る」ときの見え方なので、元幅＝条幅×条数＋わずかな屑にする。 */
  const SW=32;
  const counts=[3,6,10,16,24,32,40];
  rec('確かめられる条数が複数ある（1つだけでは何も見ていない）',counts.length>=3,
      JSON.stringify({試す:counts}));
  const seenLevels=new Set(),levelTrace=[];
  for(const n of counts){
   const lab=await page.evaluate(async([v,w])=>{
    S.measure.basic.mfgWidth=String(w);
    S.measure.basic.originalWidth=String(v*w+20);
    const h=document.getElementById('horizontalCount');
    h.value=String(v);h.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,320));
    const bs=[...document.querySelectorAll('#splitVisualStrip .split-visual-block[data-wkey]')];
    const g={};
    bs.forEach(b=>{
     const lv=b.classList.contains('label-none')?'none'
       :b.classList.contains('label-short')?'short':'full';
     (g[b.dataset.wkey]=g[b.dataset.wkey]||new Set()).add(lv);
    });
    return{条:bs.length,幅の種類:Object.keys(g).length,
      幅:bs[0]?Math.round(bs[0].getBoundingClientRect().width):0,
      ばらつき:Object.entries(g).filter(([,v])=>v.size>1).map(([k,v])=>k+':'+[...v].join('/')),
      段:Object.fromEntries(Object.entries(g).map(([k,v])=>[k,[...v][0]]))};
   },[n,SW]);
   Object.values(lab.段).forEach(v=>seenLevels.add(v));
   levelTrace.push(n+'条:'+Object.values(lab.段).join(',')+'(幅'+lab.幅+'px)');
   rec(`${n}条: 同じ幅の条はラベルの出し方も同じ（§9.210 ④）`,
       lab.条===n&&lab.ばらつき.length===0,JSON.stringify(lab));
  }
  /* **境目をまたいでいること**を確かめる。全部「出す」のままなら、
     ばらつきが無いのは当たり前で、何も見ていないのと同じ。 */
  rec('条数を増やす途中でラベルの段が実際に変わる（境目を通っている）',
      seenLevels.size>=2,levelTrace.join(' / '));
  /* 実際に**見切れていないこと**まで見る（クラスの一致だけでは、全部
     「出す」にしておいても通ってしまう）。 */
  const clip=await page.evaluate(()=>{
   const bad=[];
   document.querySelectorAll('#splitVisualStrip .split-visual-block[data-wkey]').forEach(b=>{
    const l=b.querySelector('.split-visual-block-label');
    if(!l||getComputedStyle(l).display==='none')return;
    if(l.getBoundingClientRect().width>b.getBoundingClientRect().width+1)
     bad.push(b.dataset.wkey+':'+Math.round(l.getBoundingClientRect().width)
       +'>'+Math.round(b.getBoundingClientRect().width));
   });
   return bad;
  });
  rec('出したラベルは条の幅に収まっている（見切れさせない）',clip.length===0,clip.join(' / '));

  /* ==========================================================
     §9.221 ⑥ 条の設計カードの3件
     ----------------------------------------------------------
     利用者の指摘:
      ①「子ロットデータがない時に『子ロットの内訳』の文字列の表示は不要」
      ②「子ロットデータがあるとき、展開してもカード内の描画となり
        レイヤーが下に隠れる」
      ③「子ロットデータがあるとき、図が崩れる。左右OS,DS辺りにある
        文字列が渋滞して重なり合い表示がきちんと読めない」
     ========================================================== */
  /* ① **子ロットが無いときは見出しごと出さない**。ここはまだ分割なしの
     ロットを開いたままなので、そのまま見る（開き直すと前提が変わる）。 */
  const foldOff=await page.evaluate(()=>{
   const f=document.getElementById('splitDetailFold');
   const layout=document.querySelector('#splitCard .split-layout');
   return {ある:!!f,出ている:!!f&&f.hidden!==true,
     編集面:!!layout&&layout.hidden!==true};
  });
  rec('子ロットが無いときは「子ロットの内訳」を出さない（§9.221 ⑥①）',
      foldOff.ある===true&&foldOff.出ている===false,JSON.stringify(foldOff));

  /* ③ 屑の帯・目盛りは**いま開いている分割なしのロット**で見る
     （横割数6で耳が6pxまで痩せている＝いちばん厳しい形）。分割ありへ
     開き直してから測ると、そのロットは耳が出ないので「前提が揃って
     いない」で何も確かめられない。 */
  /* ③ 屑の帯は**mmの比だけ**で幅が決まる（中の文字で太らない）。
     **確かめるときは実際に屑を出すこと**——出ていなければ何も見ていない。 */
  const scrapGeom=await page.evaluate(()=>{
   const os=document.getElementById('splitVisualScrapOs');
   const ds=document.getElementById('splitVisualScrapDs');
   const strip=document.getElementById('splitVisualStrip');
   if(!os||os.hidden||!strip)return {出ていない:true};
   const cs=getComputedStyle(os);
   const r=os.getBoundingClientRect(),s=strip.getBoundingClientRect();
   const label=os.querySelector('.split-visual-scrap-label');
   const end=document.querySelector('.split-visual-end.os');
   const er=end&&end.getBoundingClientRect();
   return {基:cs.flexBasis,伸び:cs.flexGrow,最小幅:cs.minWidth,
     帯:Math.round(r.width),条の束:Math.round(s.width),
     文字がはみ出していない:!label||label.getBoundingClientRect().right<=r.right+1,
     OSと重なっていない:!er||er.right<=r.left+1};
  });
  if(scrapGeom.出ていない){
   rec('屑の帯はmmの比だけで幅が決まる（中の文字で太らない）',false,
       '前提が揃っていない（屑が出ていない）');
  }else{
   rec('屑の帯はmmの比だけで幅が決まる（中の文字で太らない）',
       scrapGeom.基==='0px'&&Number(scrapGeom.伸び)>0&&scrapGeom.最小幅==='0px',JSON.stringify(scrapGeom));
   rec('屑の文字がOS/DSの文字と重ならない',
       scrapGeom.文字がはみ出していない&&scrapGeom.OSと重なっていない,JSON.stringify(scrapGeom));
  }
  /* 目盛りの数字が器から半分はみ出していない（OS/DSと重なる原因）。 */
  const ticks=await page.evaluate(()=>{
   const box=document.getElementById('splitVisualMeasure');
   if(!box)return {none:true};
   const br=box.getBoundingClientRect();
   const bad=[];
   document.querySelectorAll('#splitVisualRuler .split-visual-tick-label').forEach(l=>{
    const r=l.getBoundingClientRect();
    if(r.left<br.left-1||r.right>br.right+1)bad.push(l.textContent+':'+Math.round(r.left-br.left));
   });
   return {数:document.querySelectorAll('#splitVisualRuler .split-visual-tick-label').length,はみ出し:bad};
  });
  rec('目盛りの数字が図の外へはみ出さない',
      !ticks.none&&ticks.はみ出し.length===0,JSON.stringify(ticks));

  /* ② は**分割ありのロットで見る**。直前の §9.210 ④／§9.209 ② が
     分割なしのロットへ切り替えているので、開き直してから測る
     （開き直さないと「子ロットが無い」状態を見て落ちる）。 */
  const reopened=await page.evaluate(async lot=>{
   const r=await fetch('/api/table?'+new URLSearchParams({db:'SIKALOTNOW',table:'仕掛',page:1,page_size:5,
     filters:JSON.stringify([{column:'ロット番号',op:'eq',value:lot}])}));
   const row=((await r.json()).rows||[])[0];
   if(!row)return 'ロットが見つからない';
   await openMeasurement(row);return 'ok';
  },LOT).catch(e=>'例外: '+e.message);
  rec('分割ありロットを開き直せる',reopened==='ok',String(reopened));
  await page.waitForFunction(
    ()=>{const f=document.getElementById('splitDetailFold');return !!f&&f.hidden!==true},
    null,{timeout:20000}).catch(()=>{});
  await settle(page);

  const fold=await page.evaluate(()=>{
   const f=document.getElementById('splitDetailFold');
   const layout=document.querySelector('#splitCard .split-layout');
   return {ある:!!f,出ている:!!f&&f.hidden!==true,
     編集面:!!layout&&layout.hidden!==true,
     件数:(document.getElementById('splitDetailSummary')||{}).textContent||''};
  });
  rec('子ロットがあるときは内訳の見出しが出て、件数も畳んだまま読める',
      fold.出ている===true&&/ロット/.test(fold.件数),JSON.stringify(fold));
  /* **開いた内訳はカードの外へ出る**（`position:fixed`）。カードの中で開くと
     `overflow`に切られて下に隠れる。 */
  const foldOpened=await page.evaluate(async()=>{
   const f=document.getElementById('splitDetailFold');
   if(!f)return {none:true};
   f.open=true;
   f.dispatchEvent(new Event('toggle'));
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const body=f.querySelector('.split-detail-body');
   const card=document.getElementById('splitCard');
   const cs=getComputedStyle(body);
   const br=body.getBoundingClientRect(),cr=card.getBoundingClientRect();
   return {position:cs.position,z:cs.zIndex,
     /* カードの下端より下へはみ出していても切られない＝外に出ている。 */
     幅:Math.round(br.width),カード幅:Math.round(cr.width),
     見えている:br.height>10};
  });
  rec('開いた内訳はカードの外（fixed）へ出て切られない',
      !foldOpened.none&&foldOpened.position==='fixed'&&foldOpened.見えている===true,JSON.stringify(foldOpened));
  rec('内訳の重なり順はカードより上',
      !foldOpened.none&&Number(foldOpened.z)>=1000,String(foldOpened.z));
  await page.evaluate(()=>{const f=document.getElementById('splitDetailFold');
    if(f){f.open=false;f.dispatchEvent(new Event('toggle'))}});

  /* ==========================================================
     異常の印と図のラベルが重ならない（§9.233 ①、利用者の指摘）
     「異常位置判定を行うと、異常位置の図の表示のラベルと、『異常の印・出す』
      のバッジが別の表示と重なってしまいきれいに収まっていません」

     原因は2つ。①`.split-visual-block.is-defect`が「印」を条の帯に**重ねて**
     いた ②縦のflexで`.split-visual-actions`が既定の`flex-shrink:1`のまま
     だったので、器が足りないと**箱だけが縮んで中身が下の行へ描かれた**
     （`overflow`が無いので隣の上に乗る）。
     **数や有無を見る網では捕まらない**——どちらも要素は在る。器と中身の
     実寸（`scrollHeight`と`clientHeight`）と、印と条の番号の矩形で見る。
     ========================================================== */
  const cramped=await page.evaluate(()=>{
   /* 器を実機より低くして、縮み代が無い状態を作る（広い窓では出ない）。 */
   const card=document.getElementById('splitCard');
   if(card){card.style.height='190px';card.style.maxHeight='190px'}
   /* 異常の印を実際に付ける（印の付いていない条だけを見ると素通りする）。 */
   const b0=document.querySelector('.split-visual-block');
   if(b0){
    b0.classList.add('is-defect');
    if(!b0.querySelector('.svb-defect')){
     const em=document.createElement('em');
     em.className='svb-defect';em.textContent='異常';
     b0.appendChild(em);
    }
   }
   const c=document.getElementById('splitDefectChip'),t=document.getElementById('splitDefectToggle');
   if(c){c.hidden=false;c.innerHTML='<b>異常 1条</b><small>保存済み</small>';c.classList.add('is-hit')}
   if(t){t.hidden=false;t.textContent='異常の印: 出す'}
   return true;
  });
  await page.waitForTimeout(400);
  const fit=await page.evaluate(()=>{
   const box=el=>el?{sh:el.scrollHeight,ch:el.clientHeight}:null;
   const rr=el=>el?(x=>({l:Math.round(x.left),r:Math.round(x.right),
     t:Math.round(x.top),b:Math.round(x.bottom)}))(el.getBoundingClientRect()):null;
   const act=document.querySelector('.split-visual-actions');
   const blk=document.querySelector('.split-visual-block.is-defect');
   const mark=blk&&blk.querySelector('.svb-defect');
   const lab=blk&&blk.querySelector('.svb-label,.svb-no,b,span');
   const over=(a,c)=>(!a||!c)?null:
     Math.round(Math.min(a.r,c.r)-Math.max(a.l,c.l))>0
     &&Math.round(Math.min(a.b,c.b)-Math.max(a.t,c.t))>0;
   return {操作:box(act),操作の矩形:rr(act),
     印:rr(mark),ラベル:rr(lab),
     印の高さ:mark?Math.round(mark.getBoundingClientRect().height):null,
     重なり:over(rr(mark),rr(lab))};
  });
  rec('異常の印を出しても操作の行が縮まない（§9.233 ①）',
      !!(fit.操作&&fit.操作.sh<=fit.操作.ch+1),JSON.stringify(fit.操作));
  rec('前提: 異常の印が実寸を持って出ている',
      !!(fit.印&&fit.印の高さ>0),JSON.stringify(fit.印));
  rec('異常の印が条のラベルに重ならない（§9.233 ①）',
      fit.重なり===false||fit.ラベル===null,JSON.stringify({印:fit.印,ラベル:fit.ラベル}));

  /* **ダイアログで止めない。** 以前はalertだったので、ドラッグのたびに
     手が止まった。理由は状態行の文字で伝える。 */
  rec('操作の途中でダイアログを出さない',dialogs.length===0,dialogs.join(' / '));
  rec('コンソールに例外を出さない',errs.length===0,errs.join(' / '));
 }catch(e){rec('FATAL',false,e.message)}
 finally{if(b)await b.close()}
 const ng=R.filter(x=>!x.ok).length;
 console.log(`\n${R.length-ng} PASS / ${ng} FAIL`);
 process.exit(ng?1:0);
})();
