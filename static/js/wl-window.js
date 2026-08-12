"use strict";
/* wl-window.js: 浮いたウィンドウ（移動・8方向リサイズ・位置の記憶）
   ============================================================
   もともと schedule-view.js の中にあった（§9.16で新設、§9.17で8方向へ）。
   **スケジュールの状態を一切見ない部品**で、列の設定パネル
   (list-columns.js)からも使われているため独立させた
   (docs/REFACTORING_PLAN.md フェーズD)。

   なぜ「浮いた」窓なのか。既存の .record-modal は全画面シェード＋中央
   ダイアログで、シェードが背景を覆うためウィンドウの外側＝タイムラインへ
   ドラッグ&ドロップできないという不具合があった（実際に報告された）。
   ここでは全画面シェードを持たず、ヘッダーのドラッグで移動・端のドラッグで
   リサイズできる形にし、背景は常に操作可能なままにする。位置と大きさは
   localStorage へ保存して次回も再現する。

   **CSSのクラス名は `sc-float-*` のまま**にしてある。スケジュール専用では
   ないので名前としては合っていないが、付け替えると 70-schedule.css・
   テンプレート・4箇所の窓・テストを同時に触ることになり、見た目の回帰を
   持ち込む費用のほうが高い。名前より、どこから使われるかを
   `WL.makeFloatingWindow` の1つに集めることを優先する。

   **読み込み順**: この部品を使う list-columns.js より先に読むこと
   (templates/index.html の FILES)。以前は schedule-view.js の中にあり、
   list-columns.js のほうが先に読まれていた——呼ぶのが画面を開いた時点
   なので動いてはいたが、読み込み順への依存が見えない状態だった。
   ============================================================ */
(function(){
 const makeFloatingWindow=(el,opts)=>{
  const o=Object.assign({storageKey:'',defaultWidth:520,defaultHeight:480,defaultTop:86,defaultRight:24,minWidth:300,minHeight:220},opts||{});
  const header=el.querySelector('.sc-float-header');
  const resizeHandle=el.querySelector('.sc-float-resize');
  let rect={width:o.defaultWidth,height:o.defaultHeight,top:o.defaultTop,left:null};
  try{
   const saved=o.storageKey&&JSON.parse(localStorage.getItem(o.storageKey)||'null');
   if(saved&&typeof saved==='object')rect=Object.assign(rect,saved);
  }catch(e){/* 保存値が壊れていても既定値で開始する */}
  function clampToViewport(){
   // ウィンドウ全体(右下角の抽出ハンドル・閉じるボタン含む)が画面外へ
   // 出てしまうと、以後リサイズも移動もできなくなり実質操作不能になる。
   // 固定マージンではなく実際の幅・高さを差し引いて上限を決める。
   rect.width=Math.min(rect.width,Math.max(o.minWidth,window.innerWidth-20));
   rect.height=Math.min(rect.height,Math.max(o.minHeight,window.innerHeight-20));
   const maxLeft=Math.max(0,window.innerWidth-rect.width);
   const maxTop=Math.max(0,window.innerHeight-rect.height);
   if(rect.left!=null)rect.left=Math.min(Math.max(0,rect.left),maxLeft);
   rect.top=Math.min(Math.max(0,rect.top),maxTop);
  }
  function applyRect(){
   clampToViewport();
   el.style.width=rect.width+'px';
   el.style.height=rect.height+'px';
   el.style.top=rect.top+'px';
   if(rect.left==null){el.style.left='';el.style.right=o.defaultRight+'px'}
   else{el.style.left=rect.left+'px';el.style.right=''}
  }
  function save(){try{if(o.storageKey)localStorage.setItem(o.storageKey,JSON.stringify(rect))}catch(e){/* 保存できなくても表示自体は継続する */}}
  function dragToMove(startEvent){
   if(startEvent.target.closest('button'))return;
   startEvent.preventDefault();
   const startX=startEvent.clientX,startY=startEvent.clientY;
   const startBox=el.getBoundingClientRect();
   const startLeft=startBox.left,startTop=startBox.top;
   function onMove(ev){rect.left=startLeft+(ev.clientX-startX);rect.top=startTop+(ev.clientY-startY);applyRect()}
   function onUp(){document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);save()}
   document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
  }
  /* **端ならどこを掴んでもリサイズできる**(§9.90)。以前は右下角の
     つまみ1つだけで、左や上へ広げたいときは一度動かしてから角を引く、と
     いう2手順が要った。四辺+四隅の8方向を用意し、上・左へ伸ばすときは
     反対側の辺を固定する(left/topも一緒に動かす)。 */
  const DIRS=['n','s','e','w','ne','nw','se','sw'];
  function dragToResize(startEvent,dir){
   startEvent.preventDefault();startEvent.stopPropagation();
   const startX=startEvent.clientX,startY=startEvent.clientY;
   const box=el.getBoundingClientRect();
   const startW=box.width,startH=box.height,startL=box.left,startT=box.top;
   function onMove(ev){
    const dx=ev.clientX-startX,dy=ev.clientY-startY;
    if(dir.includes('e'))rect.width=Math.max(o.minWidth,startW+dx);
    if(dir.includes('s'))rect.height=Math.max(o.minHeight,startH+dy);
    if(dir.includes('w')){
     rect.width=Math.max(o.minWidth,startW-dx);
     rect.left=startL+(startW-rect.width);   // 右端を固定したまま左へ伸ばす
    }
    if(dir.includes('n')){
     rect.height=Math.max(o.minHeight,startH-dy);
     rect.top=startT+(startH-rect.height);   // 下端を固定したまま上へ伸ばす
    }
    if(rect.left==null&&dir.includes('w'))rect.left=startL;
    applyRect();
   }
   function onUp(){document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);save()}
   document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
  }
  /* つまみはJSで足す。**HTML側に8個書かせない**——浮きウィンドウは
     4箇所で作られており、書き漏らすとその窓だけ端を掴めなくなる。 */
  DIRS.forEach(d=>{
   const g=document.createElement('div');
   g.className='sc-float-grip sc-float-grip-'+d;
   g.dataset.dir=d;
   g.title='ドラッグで大きさを変えられます';
   g.addEventListener('mousedown',e=>dragToResize(e,d));
   el.appendChild(g);
  });
  if(header)header.addEventListener('mousedown',dragToMove);
  // 既存の右下つまみ(見た目の目印)も引き続き効かせる。
  if(resizeHandle)resizeHandle.addEventListener('mousedown',e=>dragToResize(e,'se'));
  window.addEventListener('resize',()=>applyRect());
  applyRect();
 };

 /* 使う側はここだけを見る。**公開しないと黙って素通しになる**——
    list-columns.js は `typeof WL.makeFloatingWindow==='function'` で
    存在を確かめてから呼ぶ作りなので、公開漏れに気づけず、位置も大きさも
    与えられないパネルが画面外に開いていた（実際に起きた）。 */
 window.WL=window.WL||{};
 WL.makeFloatingWindow=makeFloatingWindow;
})();
