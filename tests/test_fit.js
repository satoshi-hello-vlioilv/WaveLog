/* test_fit.js: 中身が器から溢れていないかを、表示サイズ3段階で実測する。
   ------------------------------------------------------------
   §9.73。余白(gap/padding)を役割へ揃える作業は、値をそろえると同時に
   **画面に収まるかどうか**を動かす。実際、タブの高さを表示サイズへ追随
   させただけで測定画面の左ペインが特大で3px溢れた(VER1.85.0)。
   「揃っているか」の網(test_scale.js)とは別に、「収まっているか」の網が要る。

   見るのは2つだけ:
     ・スクロールできない器から中身がはみ出していないか
       (overflow:hidden なら切れて読めない / visible なら隣へかぶる)
     ・ページ全体に横スクロールが出ていないか

   スクロールできる器(overflow:auto/scroll)は、はみ出して当たり前なので数えない。
   表示サイズは sm〜lg の3段階すべてで見る——既定(md)だけ合わせても、
   現場で「大」にした瞬間に崩れるのでは意味がない。
   (段は§9.132で5→3へ減らした。倍率の幅が広いほど「ある段でだけ溢れる」
   箇所が増えるため、幅そのものを.92〜1.10へ狭めてある。) */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';
const SIZES=['sm','md','lg'];
/* 溢れは字形の丸めでも出るので、これを超えたものだけ数える。
   **1px を超えたら不具合として数える。** 以前は2pxで、`.lot-dsp-link`が
   罫線(上下1pxずつ)を引かずに`--row-ctl-h`を行の高さにしていたため
   **ちょうど+2px**溢れ、当時の5段階すべてで158件見切れていたのにこの網を
   素通りした(§9.112)。字形の丸めで出るのは1pxまで。 */
const SLACK=1;

/* 例外。**理由が書けるものだけ**載せる。 */
const EXCEPT=[
 ['qa-graph-stage','グラフの描画面。SVGが器より大きいときは中でスクロールさせる設計'],
 ['rp-page','A4帳票。用紙サイズ固定で、表示は倍率で合わせる'],
 ['df-page','同上（異常位置判定書）'],
];

run('test_fit: 中身が器から溢れていないかを、表示サイズ3段階で実測する。', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 try{
  /* 待ちは「時間」ではなく「条件」で置く(§9.102)。以前は固定待ちの合計が
     58秒あり、この網が持っている3つの判定より待ち時間の方がずっと長かった。
       ・paint(): 描画が1巡するまで(requestAnimationFrame 2回)。
         表示サイズの切替は`data-ui-size`の付け替え＝CSS変数の再計算だけで、
         **寸法を動かすtransitionは1つも無い**(動くのはtransform/opacity/色と、
         進捗バー2本のwidthだけ)。だから寸法を測る前に要るのは
         「レイアウトが確定したか」であって、時間ではない。
       ・idle(): 取得が止まって quiet ミリ秒 静かなら次へ。画面の切替は
         その画面ぶんのデータを取り終わるまで待つ必要があるが、それが
         何ミリ秒かは画面によって違う(固定待ちは速い画面で無駄に待ち、
         遅い画面では足りない)。一覧は描き終えたあと requestIdleCallback で
         追加の問い合わせを出すので「0件になった瞬間」では早すぎる。
         ハートビート(15秒ごと)は画面と無関係なので数から外す。
       どちらも土台（tests/lib/harness.js → wait.js）の同じ道具を使う。 */
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await idle();

  const probe=(slack)=>page.evaluate(sl=>{
   const out=[];
   /* 先祖にスクロールできる器があれば、はみ出した分は手が届く(切れて
      読めないわけではない)。「どこにもスクロールが無いのに溢れている」
      ものだけを不具合として数える。 */
   const scrollable=(el,axis)=>{
    for(let p=el.parentElement;p;p=p.parentElement){
     const cs=getComputedStyle(p);
     if(/auto|scroll/.test(axis==='x'?cs.overflowX:cs.overflowY))return true;
    }
    return false;
   };
   document.querySelectorAll('*').forEach(el=>{
    /* <option> は選択肢の実体で、描画はブラウザ任せ(幅の比較に意味がない)。 */
    if(el.tagName==='OPTION'||el.tagName==='OPTGROUP')return;
    const r=el.getBoundingClientRect();
    if(r.width<2||r.height<2)return;
    const s=getComputedStyle(el);
    if(s.visibility==='hidden')return;
    /* **自分自身が overflow:hidden なら、先祖のスクロールは言い訳にならない**
       (§9.112)。器ごと動かせても、その器の中で切り落とされた分は出てこない。
       以前は先祖に `#grid`(overflow:auto)がいるだけで中身を全部見逃しており、
       `.lot-dsp-link` が当時の5段階すべてで158件見切れていたのに0件と報告した。 */
    const clipsY=s.overflowY==='hidden'||s.overflowY==='clip';
    const clipsX=s.overflowX==='hidden'||s.overflowX==='clip';
    const scrollY=/auto|scroll/.test(s.overflowY)||(!clipsY&&scrollable(el,'y'));
    const scrollX=/auto|scroll/.test(s.overflowX)||(!clipsX&&scrollable(el,'x'));
    /* 「…」で切り詰める指定がある欄は、はみ出して切れるのが設計どおり
       (画面名・使用設備名など、長い文字列を1行に収める箇所)。 */
    const ellipsis=s.textOverflow==='ellipsis';
    const overY=el.scrollHeight-el.clientHeight, overX=el.scrollWidth-el.clientWidth;
    const bad=[];
    if(!scrollY&&overY>sl)bad.push('縦+'+overY);
    if(!scrollX&&!ellipsis&&overX>sl)bad.push('横+'+overX);
    if(!bad.length)return;
    const cls=(typeof el.className==='string'?el.className:'').split(/\s+/).filter(Boolean).slice(0,2).join('.');
    out.push({name:el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(cls?'.'+cls:''),
              why:bad.join(' '),over:Math.max(overY,overX)});
   });
   return {items:out,
           pageX:document.documentElement.scrollWidth-document.documentElement.clientWidth};
  },slack);

  const findings=[];let pageX=0;
  const visit=async(name,fn)=>{
   await fn(); await idle();
   for(const size of SIZES){
    await page.evaluate(s=>{document.documentElement.dataset.uiSize=s},size);
    await paint();
    const r=await probe(SLACK);
    r.items.forEach(i=>findings.push({...i,screen:name,size}));
    pageX=Math.max(pageX,r.pageX);
   }
   await page.evaluate(()=>{document.documentElement.dataset.uiSize='md'});
   await paint();
  };

  await visit('仕掛一覧',()=>page.click('aside [data-db-key="SIKALOTNOW"]'));
  /* **既定で隠れているものも開いて測る(§9.80)。** ここが管理漏れだった——
     フィルタの詳細ビルダー(#filterBody)も登録フィルタ一覧も既定はhiddenで、
     「見えているものだけ」を測っていたため、表示サイズを上げたときに
     ラベル行から文字が溢れているのを検出できなかった。
     開かないと分からない場所こそ、人の目も届きにくい。 */
  await visit('フィルタ詳細',async()=>{
   await page.evaluate(()=>document.querySelector('#filterToggle')?.click());
  });
  /* §9.287。旧「よく使う条件」の行は廃した（登録した条件を分解して並べ直した
     だけのもので、プリセットの札と二重になっていた）。代わりに、いま効いて
     いる条件を出すポップオーバーを見る——中身が長いのはこちらなので、
     溢れを見張る値打ちがある。 */
  await visit('効いている条件のポップオーバー',async()=>{
   await page.evaluate(()=>{const b=document.querySelector('#filterCondBtn');if(b&&!b.disabled)b.click()});
   await page.waitForSelector('#filterCondMenu',{timeout:3000}).catch(()=>{});
  });
  await visit('プリセットのポップオーバー',async()=>{
   await page.evaluate(()=>document.querySelector('#filterPresetBtn')?.click());
   await page.waitForSelector('#filterPresetMenu',{timeout:3000}).catch(()=>{});
  });
  await visit('登録フィルタ一覧',async()=>{
   await page.evaluate(()=>document.querySelector('#openFilterPresets')?.click());
   await page.waitForSelector('#filterPresetModal:not([hidden])',{timeout:10000}).catch(()=>{});
  });
  await visit('確認ダイアログ',async()=>{
   await page.evaluate(()=>{typeof confirmModal==='function'&&confirmModal(
     '長めの確認文をここに入れて、枠から溢れないかを見る。'
     +'この条件は鍵付きの必須条件です。外すと一時的に条件が緩和されます。')});
   await page.waitForSelector('#appConfirmCancel',{state:'visible',timeout:10000}).catch(()=>{});
  });
  await page.evaluate(()=>{
   document.getElementById('appConfirmCancel')?.click();
   const m=document.getElementById('filterPresetModal');if(m)m.hidden=true;
   document.querySelector('#filterToggle')?.click();
  });
  await paint();
  await visit('品質データ',()=>page.click('aside [data-db-key="SIKALOTDEF"]'));
  await visit('品質データ_グラフ',async()=>{
   await page.click('[data-qa-tab="graph"]');await idle();
   await page.evaluate(()=>document.querySelectorAll('.qa-acc:not(.open) .qa-acc-head').forEach(x=>x.click()));
  });
  await page.click('[data-qa-tab="raw"]');await idle();
  /* データ一覧（§9.222 ①）。**巡回の穴だった**——操作列の器が
     `minmax(232px,0)`のリテラル固定で、中身（文字・余白）は`--ui-scale`で
     伸びるため、表示サイズを上げるほど足りなくなり特大でボタンが
     「続きか…」「帳…」と切れていた。ここに入っていれば出す前に分かった
     （CLAUDE.md §9.127「規格へ寄せるのと巡回に加えるのは2つで一組」）。 */
  await visit('測定データ一覧',async()=>{
   await page.evaluate(()=>document.querySelector('[data-open-records]')?.click());
   await page.waitForSelector('#recordList',{timeout:15000}).catch(()=>{});
   await idle();
  });
  /* `#recordModal`は`<section class="rec-panel" hidden>`で、閉じるのは
     `hidden`の付け外し（専用の×は無い）。 */
  await page.evaluate(()=>{const m=document.getElementById('recordModal');if(m)m.hidden=true});
  await paint();
  await visit('作業スケジュール',()=>page.click('#openSchedule'));
  await visit('ダッシュボード',()=>page.click('#openDashboard'));
  await visit('測定実績カレンダー',()=>page.click('#openCalendar'));
  await visit('マスタ管理',()=>page.click('#openMasterMaint'));
  /* 測定画面。左ペインが一番きつい(VER1.85.0で3px溢れを踏んだ場所)。 */
  await page.click('aside [data-db-key="SIKALOTNOW"]');
  await page.waitForSelector('.measurement-action-button',{timeout:20000}).catch(()=>{});
  await idle();
  const opened=await page.evaluate(()=>{
   const b=document.querySelector('.measurement-action-button');if(b){b.click();return true}return false;
  });
  if(opened){
   await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:20000}).catch(()=>{});
   /* 測定画面は開いたあともマスタを何本か引く。静けさの窓を広めに取る。 */
   await idle(700,10000);
   await visit('測定画面',async()=>{});
  }
  rec('測定画面を開けた',opened);

  const excepted=f=>EXCEPT.some(([k])=>f.name.includes(k));
  const real=findings.filter(f=>!excepted(f));
  const byKey={};
  real.forEach(f=>{const k=`${f.screen}/${f.size}: ${f.name} ${f.why}`;byKey[k]=(byKey[k]||0)+1});
  const keys=Object.keys(byKey);
  rec('スクロールできない器から中身が溢れていない',keys.length===0,
   keys.length?keys.slice(0,8).join(' / '):`${SIZES.length}段階 × 9画面 で溢れ0`);
  rec('ページ全体に横スクロールが出ていない',pageX<=SLACK,`最大 +${pageX}px`);

  /* 置いた実績は自分で消す（§9.351・§9.362）。残った実績は計画外実績として
     予定表に現れ、無関係な網を落とす。 */
  try{await require('./lib/harness.js').clearRecords()}catch(e){console.log('!! 実績の後片付けに失敗: '+(e&&e.message||e))}
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }
}, {viewport:{width:1600,height:1000}});
