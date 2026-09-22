/* pop-menu.js: 浮きメニューの「器のふるまい」を1箇所に持つ（§9.448）
   ============================================================
   押すと浮いて出る面は6つある——列見出し・予定の行（と入れ子）・
   測定データ一覧・モード/同期・フィルタの組み合わせ・同期の状態。
   **見た目の器は`.wl-menu`の1つ**（`20-shell.css`）で、ここが持つのは
   その器のふるまい:

     ・置き場所を決める（画面の外へ出さない）
     ・外を押したら閉じる／Escで閉じる（開いた本人へ焦点を返す）
     ・**矢印キーで項目を移れる**（↑↓・Home/End）
     ・支援技術へ「メニューです」と名乗る（`role=menu` / `role=menuitem`）

   以前はこの配線が**3箇所に書き写されて**いた（schedule-view.js /
   records-store.js / access-mode.js）。写しがあると、矢印キーのような
   横断の改良が3箇所の問題になる——実際、`role`を名乗っていたのは
   測定データ一覧の1面だけ、矢印キーで移れる面は**0**だった。

   **中身は呼ぶ側のまま。** ここは項目のHTMLを作らない——面ごとに
   持ちものが違う（鍵盤の札・できない理由・色見本・入れ子）ので、
   組み立てまで取り上げると分岐が戻ってくる（§CLAUDE「その場しのぎの
   分岐を足さない」）。受け取るのは**組み上がった器**だけ。

   使い方:
     const el=document.createElement('div');
     el.className='wl-menu col-head-menu'; el.innerHTML=…;
     document.body.append(el);
     WL.popMenu.open(el,{at:{x:ev.clientX,y:ev.clientY},owner:btn,
                         onClose:()=>{menuEl=null}});
   ============================================================ */
(function(){
 'use strict';
 window.WL=window.WL||{};

 /* 画面の縁からこれだけは離す。**器の外（body直下）へ`fixed`で出す**
    （§9.201。一覧は`overflow:auto`なので中に置くと切り落とされる）。 */
 const EDGE=6;
 /* いま開いている面。**入れ子は「家族」として1つに数える**——子の中を
    押しても親を閉じない（§9.398）。 */
 let open=null;   // {el,owner,onClose,family:Set}

 const items=el=>[...el.querySelectorAll('button:not([disabled])')];

 /* 支援技術への名乗り。**開いた器そのものに付ける**——祖先に付けると
    見本を並べた盤で取り違える（§9.436と同じ理由）。 */
 function nameIt(el){
  if(!el.getAttribute('role'))el.setAttribute('role','menu');
  el.querySelectorAll('button').forEach(b=>{
   if(!b.getAttribute('role'))b.setAttribute('role','menuitem');
  });
  /* 器そのものにも焦点を置けるようにする（**`tabindex`が無いと
     `focus()`は何もしない**）。押せる項目が1つも無いとき——できない理由
     だけを読ませたいとき——に要る。 */
  if(el.tabIndex==null||el.tabIndex>=0)el.tabIndex=-1;
 }

 /* 画面の中へ収める。`at`＝その点から出す（右クリック）、
    `anchor`＝その要素の下に出す（ボタン）。入らなければ上へ返す。 */
 function place(el,{at,anchor}={}){
  const w=el.offsetWidth,h=el.offsetHeight;
  const maxL=innerWidth-w-EDGE, maxT=innerHeight-h-EDGE;
  let left,top;
  if(anchor){
   const r=anchor.getBoundingClientRect();
   left=r.right-w;
   top=(r.bottom+h+8>innerHeight)?r.top-h-4:r.bottom+4;
  }else{
   left=(at&&at.x)||0; top=(at&&at.y)||0;
  }
  el.style.left=`${Math.max(EDGE,Math.min(left,maxL))}px`;
  el.style.top=`${Math.max(EDGE,Math.min(top,maxT))}px`;
 }

 function away(ev){
  if(!open)return;
  if([...open.family].some(n=>n&&n.contains(ev.target)))return;
  if(open.owner&&open.owner.contains&&open.owner.contains(ev.target))return;
  close();
 }
 function onKey(ev){
  if(!open)return;
  if(ev.key==='Escape'){ev.preventDefault();close(true);return}
  if(ev.key!=='ArrowDown'&&ev.key!=='ArrowUp'&&ev.key!=='Home'&&ev.key!=='End')return;
  /* **家族のうち、いま焦点がある器**で動かす（入れ子を開いていたら子）。 */
  const host=[...open.family].find(n=>n&&n.contains(document.activeElement))||open.el;
  const list=items(host);
  if(!list.length)return;
  ev.preventDefault();
  const i=list.indexOf(document.activeElement);
  const next=ev.key==='Home'?0
            :ev.key==='End'?list.length-1
            :ev.key==='ArrowDown'?(i<0?0:(i+1)%list.length)
            :(i<0?list.length-1:(i-1+list.length)%list.length);
  list[next].focus();
 }

 function close(toOwner){
  if(!open)return;
  const o=open; open=null;
  document.removeEventListener('mousedown',away,true);
  document.removeEventListener('keydown',onKey,true);
  try{o.onClose&&o.onClose()}catch(e){console.warn('メニューを閉じる処理で失敗しました',e)}
  /* Escで閉じたときだけ**開いた本人へ焦点を返す**（外を押したときは、
     押した先へ焦点が移っているので奪わない）。 */
  if(toOwner&&o.owner&&o.owner.focus)o.owner.focus();
 }

 WL.popMenu={
  /* 開いた器を受け取り、置き場所・名乗り・閉じ方を引き受ける。
     `family`は入れ子の器を足すための入れ物（`adopt()`で増やす）。 */
  open(el,opt){
   const o=opt||{};
   if(open&&open.el!==el)close();
   nameIt(el);
   place(el,o);
   open={el,owner:o.owner||null,onClose:o.onClose||null,family:new Set([el])};
   /* **次の巡回で配線する**——いま起きているクリックでそのまま閉じない
      （`mousedown`を捕まえる側で開いている面がある）。 */
   setTimeout(()=>{
    if(!open||open.el!==el)return;
    document.addEventListener('mousedown',away,true);
    document.addEventListener('keydown',onKey,true);
   },0);
   return el;
  },
  /* 入れ子の器を家族へ足す（子の中を押しても親を閉じない・§9.398）。 */
  adopt(el){
   if(!open||!el)return el;
   nameIt(el);
   open.family.add(el);
   return el;
  },
  forget(el){if(open&&el)open.family.delete(el)},
  /* いま開いているのがこの器か（呼ぶ側の「2度押しで閉じる」に使う）。 */
  isOpen:el=>!!open&&(el?open.family.has(el):true),
  place,
  close(){close()},
 };
})();
