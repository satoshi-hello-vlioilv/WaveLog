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
 帯:[...document.querySelectorAll('#splitVisualStrip .split-visual-block')].map(e=>e.textContent.trim().slice(0,3)),
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
  rec('測定表のロット列が帯と同じ並び',
      a.ロット列.length===2&&a.ロット列.join()===a.帯.join(),JSON.stringify(a));

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
      c.ロット列.join()!==a.ロット列.join()&&c.ロット列.join()===c.帯.join(),
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
      d.ロット列.join()===a.ロット列.join()&&d.ロット列.join()===d.帯.join(),
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
