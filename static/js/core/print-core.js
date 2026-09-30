"use strict";
/* print-core.js: 紙まわりの共通核（§9.332、REVIEW 3-6）
   ============================================================
   印刷の入口は3つある——作業予定表（`schedule-print.js`）・操業データ表
   （`opsheet-print.js`）・測定帳票（`report-dashboard.js`）。**紙の性格は
   それぞれ違ってよい**（一覧を詰める紙／1ロット1枚の塊の配置）が、

     ・用紙の大きさと向きの表
     ・刷れる範囲（四辺8mmを引いた寸法）
     ・`@page`の中身と、その差し替え
     ・pxからmmへの換算
     ・**下限のある比例配分**（列幅を紙へ収める）
     ・紙を`body`へ出して`window.print()`する段取り

   は**同じもの**だった。それが3つに散っていたので、§9.252では
   「`opsheet-print.js`も同じ形へ揃えてある。**片方だけ直さないこと**」と
   注意書きを足すしかなかった——**注意書きは仕組みではない。**
   実際、下限つき比例配分の丸めは片方だけ§9.295の直し（0.1mmずつ散らして
   引く）が入っており、もう片方は**いちばん広い列から一度に引く**古い形の
   まま残っていた（その列が切れる、と§9.295が名指しで禁じた形）。

   ------------------------------------------------------------
   約束
   ------------------------------------------------------------
    * **用紙の表はここ1つ**（`WL.paper.KINDS`／`ORIENTS`）。用紙を足すのは
      ここへ1行で、どの紙にも同時に効く。
    * **`@page`は用紙の名前でなく実寸mmで頼む**（§9.252）——CSSの`B4`は
      ISO B4(250×353mm)で、日本の印刷機のB4＝JIS B4(257×364mm)とは別物。
      名前で頼むと**刷ったときだけ紙が小さくなる**（プレビューでは見えない）。
    * **既定の向きは呼ぶ側が決める**（`sizes({orientFirst})`）——作業予定表は
      A4縦・操業データ表はA4横が既定で、**並びの先頭が既定**という約束を
      どちらも持っている。ここで順番を決め打ちにすると片方の既定が変わる。
    * **`<style>`のidは呼ぶ側が持つ**——同じ紙に2つの`@page`が並ぶと
      どちらが勝つか読めない（§9.243 ①で実際に踏んだ）。画面ごとに1枚。
   ============================================================ */
(function(){
 const WL=window.WL||(window.WL={});

 /* ---------- 用紙 ----------
    w/h は**縦のときの寸法**。横は入れ替えるだけなので2通り持たない。 */
 const KINDS=[
  {key:'a4',label:'A4',w:210,h:297,note:'ふだんの帳票'},
  {key:'b4',label:'B4',w:257,h:364,note:'A4では狭いが、A3ほどは要らないとき'},
  {key:'a3',label:'A3',w:297,h:420,note:'列がとても多い設備向け'},
 ];
 const ORIENTS=[
  {key:'portrait', label:'縦',note:'1枚に載る行数が増えます'},
  {key:'landscape',label:'横',note:'列が多いときはこちら'},
 ];
 const MARGIN_MM=8;          // 四辺。どの用紙でも同じ
 const MM_PER_PX=25.4/96;    // 96dpi換算

 /* 掛け合わせは**ここで1回だけ**作る。`data-paper`・保存値・呼び出し側は
    今までどおりこの綴り（`a4-portrait`）を見る。
    `orientFirst`は**並びの先頭＝既定**を決めるためだけのもの。 */
 /* 向きの並び。**先頭がその画面の既定**なので、札を並べる側もここから引く
    ——`ORIENTS`をそのまま並べると、既定が横の紙で札だけ縦が先に出る。 */
 function orients(opt){
  const first=String(opt&&opt.orientFirst||'')||ORIENTS[0].key;
  return ORIENTS.slice().sort((a,b)=>(a.key===first?0:1)-(b.key===first?0:1));
 }
 function sizes(opt){
  const ors=orients(opt);
  return KINDS.reduce((out,k)=>out.concat(ors.map(o=>({
    key:k.key+'-'+o.key,label:k.label+' '+o.label,kind:k.key,orient:o.key,
    note:k.note,
    w:o.key==='landscape'?k.h:k.w,h:o.key==='landscape'?k.w:k.h}))),[]);
 }
 /* 知らない綴りは**その一覧の先頭**（＝その画面の既定）へ落とす。 */
 function sizeOf(key,list){
  const all=list||sizes();
  return all.find(p=>p.key===key)||all[0];
 }
 function usableMm(key,list){
  const p=sizeOf(key,list);
  return {w:p.w-MARGIN_MM*2,h:p.h-MARGIN_MM*2};
 }
 /* 片方だけ選び直したときの鍵（§9.252）。**もう片方の今の値を残す**
    ——残さないと、向きを変えるたびに大きさが既定へ戻る。
    知らない綴りも今の値を残す（§9.204。古い設定で既定へ飛ばさない）。 */
 function keyWith(cur,part,list){
  const all=list||sizes();
  const now=sizeOf(cur,all);
  const kind=KINDS.some(k=>k.key===part)?part:now.kind;
  const orient=ORIENTS.some(o=>o.key===part)?part:now.orient;
  return sizeOf(kind+'-'+orient,all).key;
 }
 /* `@page`の中身は**1箇所が作る**（刷る側と網が同じ答えを見る）。 */
 function pageRule(key,list,marginCss){
  const p=sizeOf(key,list);
  return `@page{size:${p.w}mm ${p.h}mm;margin:${marginCss==null?0:marginCss}}`;
 }
 /* 刷る直前だけ`@page`を差し替える（§9.235）。**クラスでは切り替えられない**
    ので専用の`<style>`を`<head>`の末尾へ挿す——app.css側の既定`@page`より
    後に読まれるのでこちらが勝つ。**idは画面ごとに1つ**（引数で受ける）。 */
 function applyPageStyle(styleId,key,list,marginCss){
  let el=document.getElementById(styleId);
  if(!el){el=document.createElement('style');el.id=styleId;document.head.appendChild(el)}
  el.textContent=pageRule(key,list,marginCss);
  return el;
 }

 /* ---------- 下限のある比例配分（§9.237 ⑤・§9.295） ----------
    「狭い列は最低◯mm」と「合計は用紙に収める」を**同時に**満たす。
    `Math.max(min, natural*scale)`と1回で済ませると、床に当たった列のぶんだけ
    合計が膨らみ、**16列A4縦で3.8mmはみ出す**（右余白が8mm→4.2mmへ痩せる。
    表の中しか見ていない「溢れ」判定では捕まらない）。床に着いた列を固定して、
    残りを残りの予算で配り直す——を落ち着くまで繰り返す。
    列が多すぎて「全部が下限」でも入らないときは**下限のほうを下げる**
    （紙からはみ出させない、が最後まで優先）。 */
 function shareMm(natural,usableW,opt){
  const n=natural.length;
  if(!n)return [];
  const minMm=(opt&&opt.min!=null)?opt.min:6;
  const step=(opt&&opt.step)||0.1;
  const floor=Math.min(minMm,usableW/n);
  const out=natural.slice();
  const fixed=new Array(n).fill(false);
  for(let pass=0;pass<=n;pass++){
   let used=0,freeNat=0;const free=[];
   for(let i=0;i<n;i++){
    if(fixed[i]){used+=out[i];continue}
    free.push(i);freeNat+=natural[i];
   }
   if(!free.length)break;
   const k=freeNat>0?Math.min(1,(usableW-used)/freeNat):1;
   let hit=false;
   free.forEach(i=>{
    const v=natural[i]*k;
    if(v<floor){out[i]=floor;fixed[i]=true;hit=true}else out[i]=v;
   });
   if(!hit)break;
  }
  return trimRound(out,usableW,floor,step);
 }
 /* 丸めた誤差で合計が予算を超えることがある。**広い列から順に1刻みずつ
    散らして引く**（狭い列から引くと下限を割る）。
    **1本にまとめて引かないこと**（§9.295）——文字に合わせた幅は遊びが
    0.3mmしか無いので、いちばん広い列だけから16列ぶんの端数（最大0.8mm）を
    引くと**その列が必ず切れる**（実測で1セル）。散らせば1列あたり0.1mmで
    済み、遊びの中に収まる。 */
 function trimRound(values,usableW,floorMm,step){
  const n=values.length;
  const s=step||0.1;
  const inv=1/s;
  const floor=floorMm!=null?floorMm:Math.min(6,usableW/(n||1));
  const mm=values.map(v=>Math.round(v*inv)/inv);
  let over=Math.round((mm.reduce((a,v)=>a+v,0)-usableW)*inv)/inv;
  const order=mm.map((v,i)=>i).sort((a,b)=>mm[b]-mm[a]);
  let guard=n*40;
  while(over>s/100&&guard-->0){
   let moved=false;
   for(const i of order){
    if(over<=s/100)break;
    if(mm[i]-s<floor-s/100)continue;
    mm[i]=Math.round((mm[i]-s)*inv)/inv;
    over=Math.round((over-s)*inv)/inv;
    moved=true;
   }
   if(!moved){
    /* **下限に阻まれて引けなくなっても、紙からはみ出させない**（§9.237
       「列が多すぎて全部が下限でも入らないときは下限のほうを下げる」）。
       刻みを粗くすると端数が下限へ張り付いた列に吸われて残ることがあり、
       残したままだと**表が紙より広い**（実測で8px＝約2.1mm）。
       ここでも**広い列から1刻みずつ散らして**引く（§9.295）。 */
    for(const i of order){
     if(over<=s/100)break;
     if(mm[i]<=s)continue;
     mm[i]=Math.round((mm[i]-s)*inv)/inv;
     over=Math.round((over-s)*inv)/inv;
     moved=true;
    }
   }
   if(!moved)break;
  }
  return mm;
 }

 /* ---------- 紙を出して刷る ----------
    画面の中へ紙を組み立て、`body`へ印刷用の印を付けて`window.print()`。
    **描き終えてから開く**（同期的に呼ぶと白紙になる）ので
    `requestAnimationFrame`を2回待つ。**後片付けは`afterprint`の1箇所**
    ——中身も題も印も、刷り終わったら必ず元へ戻す。 */
 function printOnPage(o){
  const area=o.area;
  area.innerHTML=o.html;
  /* 用紙を選べない紙（判定書のように1種類しか無いもの）は`paper`を渡さない
     ——渡さないときは`@page`に触らず、CSS側の既定のままにする。**触って
     しまうと、CSSの既定と`<style>`の2つが同じ紙を取り合う**（§9.243 ①）。 */
  if(o.paper)applyPageStyle(o.styleId,o.paper,o.paperSizes,o.margin);
  runPrint(o,()=>{area.innerHTML=''});
 }
 /* 刷る段取り（印・題・後片付け・2回待って開く）は**ここ1箇所**。紙を組み立てる印刷
    （`printOnPage`）も画面をそのまま刷る印刷（`printScreen`）も同じ段取りを通る。
    `dryRun`は刷る直前の姿だけ作って開かない（網が紙の姿を測る）。戻り値は後片付け。 */
 function runPrint(o,undo){
  document.body.classList.add(o.printClass);
  const prev=document.title;
  document.title=o.title;
  const cleanup=()=>{
   document.body.classList.remove(o.printClass);
   document.title=prev;
   if(undo)undo();
   window.removeEventListener('afterprint',cleanup);
  };
  window.addEventListener('afterprint',cleanup);
  if(!o.dryRun)requestAnimationFrame(()=>requestAnimationFrame(()=>window.print()));
  return cleanup;
 }

 /* ---------- 画面をそのまま1枚へ（§9.525、利用者の指示） ----------
    「刃組ガイダンスの表示画面を左のメニューを除いた見た目そのままを印刷できる機能を
      実装してください。A4横のレイアウトが良いです。」

    紙を組み立て直さず、**いま見えている器（`root`）をそのまま**刷る。器は画面の幅のまま
    組んだ形を保ち（刷るときの紙の幅で組み直すと並びが変わる）、**縦横の比を保って1枚へ
    縮める**（`zoom`＝刷れる範囲÷器の大きさ・大きくはしない）。左メニューなど器の外は
    CSS（`body.screen-print`）が伏せる。
    **WebGLの図は刷ると白くなる**（描いた絵を持ち続けない作り）ので、刷る直前に
    `o.beforeSnap()`で描き直させ、その場で絵にして差し替える。後片付けで元へ戻す。 */
 function printScreen(o){
  const root=o.root;
  if(!root)return null;
  const list=sizes({orientFirst:'landscape'});
  const key=o.paper||'a4-landscape';
  const use=usableMm(key,list);
  const r=root.getBoundingClientRect();
  const w=Math.max(1,Math.ceil(r.width)),h=Math.max(1,Math.ceil(r.height));
  const fit=Math.min(1,(use.w/MM_PER_PX)/w,(use.h/MM_PER_PX)/h);
  root.style.setProperty('--print-w',w+'px');
  root.style.setProperty('--print-h',h+'px');
  root.style.setProperty('--print-zoom',String(Math.floor(fit*1000)/1000));
  const styleEl=applyPageStyle(o.styleId||'screenPrintPage',key,list,MARGIN_MM+'mm');
  if(typeof o.beforeSnap==='function'){
   try{o.beforeSnap()}catch(e){WL.quiet&&WL.quiet.note('描き直せない（いまの絵のまま刷る）',e)}
  }
  const snaps=[...root.querySelectorAll('canvas')].filter(c=>c.width&&c.height&&c.getClientRects().length).map(c=>{
   const img=document.createElement('img');
   img.className='print-snap';
   try{img.src=c.toDataURL('image/png')}catch(e){WL.quiet&&WL.quiet.note('図を絵にできない（刷ると白くなることがある）',e);return null}
   const cr=c.getBoundingClientRect();
   img.style.width=cr.width+'px';img.style.height=cr.height+'px';
   c.classList.add('print-hide');c.after(img);
   return {c,img};
  }).filter(Boolean);
  return runPrint(Object.assign({printClass:'screen-print'},o),()=>{
   snaps.forEach(x=>{x.img.remove();x.c.classList.remove('print-hide')});
   ['--print-w','--print-h','--print-zoom'].forEach(k=>root.style.removeProperty(k));
   styleEl.remove();   // 他の画面の印刷へ、この紙の向きを残さない
  });
 }

 WL.paper={KINDS,ORIENTS,MARGIN_MM,MM_PER_PX,
           orients,sizes,sizeOf,usableMm,keyWith,pageRule,applyPageStyle,
           shareMm,trimRound};
 WL.printCore={printOnPage,printScreen};
})();
