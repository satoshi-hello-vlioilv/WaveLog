"use strict";
/* measure-steps.js —— 測定画面を「準備 → 測定 → 確認」の3段に分ける（§9.123）
   ============================================================
   1枚に全部を出す作りをやめる。実測では 1920×1080 に**入力欄28・ボタン32・
   タブ13個**が同時に見えており、しかも面積の配分が作業の実態と逆だった：
   1回決めるだけの「選択項目」が画面の1/3を占め、作業時間の9割を使う測定は
   1/3しかなかった。**面積は「頻度 × 重要度」で配る。**

   この段（第1段）で入れるのは器だけで、中身は今のペインをそのまま使う：
     ① 準備   … 基本情報（左）＋ 選択項目（中）
     ② 測定   … 測定パネル（右）を**画面いっぱい**に
     ③ 確認   … 作業時間・測定データ分析（左の下段）

   **順番は強制しない**（利用者の指示）。段は関門ではなくタブで、いつでも
   行き来できる。ただし**進めない理由があるときは書く**——押せるのに何も
   起きないのがいちばん悪い。

   ---- 触ってはいけないもの（§9.122）----
   **受信欄(#inputStatusBox / #deviceInput)を作り直さない・動かさない。**
   段の切り替えはCSSの表示/非表示だけで行い、DOMの親を変えない。ここを
   作り直すと、実機でしか出ない不具合（多条の連続入力が崩れる／IMEの
   セッションが残って転送文字列が二重になる）が戻る。
   代わりに、②へ入ったときだけ**受信欄へフォーカスを戻す**（隠れている
   あいだフォーカスは外れるため。作り直しとは別物）。 */
(function(){
 const STEP_KEYS=['1','2','3'];
 let current='1';

 const shell=()=>document.querySelector('.measure-shell');
 const measuring=()=>typeof S!=='undefined'&&!!S.measure;

 /* ---------- 文脈バー ----------
    段を移動しても**1pxも動かない**ことに価値がある。動くと目が追ってしまう。
    進捗と保存状態はヘッダーに常時出ているので**ここには重ねない**
    （同じものが2箇所にあるのは、それ自体が認知コスト）。 */
 function fillContext(){
  if(!measuring())return;
  const m=S.measure,b=m.basic||{},st=m.settings||{};
  const put=(id,v,title)=>{
   const el=document.getElementById(id);if(!el)return;
   const text=String(v==null?'':v).trim();
   el.textContent=text||'—';
   el.title=title||text||'';
  };
  put('mctxLot',b.lotNo);
  const product=[b.mfgMaterial,b.mfgTemper,b.purposeName].map(x=>String(x||'').trim())
    .filter(Boolean).join(' / ');
  put('mctxProduct',product);
  /* 測定表の形＝縦割数（丈位置の数を決める）× 横割数（条数を決める）。
     **ここが決まらないと測定表そのものが作れない**ので、文脈に置く。 */
  const v=Math.max(1,Math.min(9,Number(st.verticalCount)||1));
  const h=Math.max(1,Math.min(40,Number(st.horizontalCount)||1));
  put('mctxShape',`${h}条 × ${v}丈`,`横割数 ${h} / 縦割数 ${v}`);
  /* 公差は「どちらを見ているか」が値そのものより効く（§CLAUDE.md 出どころを出す）。 */
  const src=st.toleranceSource==='order'?'オーダー公差':'製造公差';
  const has=typeof compactToleranceData==='function'&&!!compactToleranceData('width');
  put('mctxTolerance',has?src:src+'（未設定）',
      has?'':'このロットには使えるプラス・マイナス値がありません');
 }

 /* ---------- 段の状態 ----------
    **色だけで伝えない。** 必ず文字（済／未／件数）を出す。 */
 function stepStates(){
  const m=measuring()?S.measure:null;
  const started=!!(m&&m.workTime&&m.workTime.startAt);
  const ended=!!(m&&m.workTime&&m.workTime.endAt);
  let prog=null;
  try{if(typeof measureProgress==='function')prog=measureProgress()}catch(e){}
  const rest=prog?prog.unmeasured.length:null;
  return {
   '1':started?'開始 済':'開始 未',
   '2':prog?`${prog.doneCount}/${prog.activeCount} 項目`:'—',
   '3':ended?'終了 済':(rest===null?'—':(rest?`残り ${rest}項目`:'確認できます')),
  };
 }

 /* 進めない理由。**言えることがあるときだけ出す**（常設の注意書きは読まれない）。 */
 function noteFor(step){
  if(!measuring())return '';
  if(step==='2'){
   const type=document.querySelector('#measureType')?.value||'';
   if(type==='母材')return '母材は手動入力の項目です。測定器から受けるには入力内容を切り替えてください。';
  }
  if(step==='3'){
   let prog=null;try{if(typeof measureProgress==='function')prog=measureProgress()}catch(e){}
   if(prog&&prog.unmeasured.length)
    return `未測定が ${prog.unmeasured.length}項目あります（${prog.unmeasured.map(x=>x.name).slice(0,3).join('・')}${prog.unmeasured.length>3?' ほか':''}）。`;
  }
  return '';
 }

 function paint(){
  const el=shell();if(!el)return;
  const states=stepStates();
  STEP_KEYS.forEach(k=>{
   const btn=document.querySelector(`.mstep[data-mstep="${k}"]`);
   if(btn){
    btn.classList.toggle('is-current',k===current);
    if(k===current)btn.setAttribute('aria-current','step');else btn.removeAttribute('aria-current');
   }
   const st=document.getElementById('mstepState'+k);
   if(st)st.textContent=states[k]||'';
  });
  const note=document.getElementById('mstepNote');
  if(note){const t=noteFor(current);note.textContent=t;note.hidden=!t}
  fillContext();
 }

 /* ---------- 段の切り替え ----------
    **CSSのクラスだけで見せ分ける。** ペインを別の器へ移し替えない
    （移すと受信欄の親が変わり、フォーカスが落ちる）。 */
 function go(step){
  step=String(step);
  if(STEP_KEYS.indexOf(step)<0)return;
  const el=shell();if(!el)return;
  current=step;
  STEP_KEYS.forEach(k=>el.classList.toggle('mstep-'+k,k===step));
  paint();
  /* ②へ入ったら、転送を受けられる状態へ戻す。**受信欄は作り直していない**
     ので、フォーカスを戻すだけでよい（§9.122）。手動入力モードは
     セル側にフォーカスを残す仕様なので触らない。 */
  if(step==='2'&&measuring()&&S.measure.settings?.inputMode!=='manual'){
   const inp=document.getElementById('deviceInput');
   /* 寸法ゼロ（測定器を使わない項目）のときは載らない。載せようとしない。 */
   if(inp&&inp.getBoundingClientRect().height>0)inp.focus();
  }
 }

 function bind(){
  document.querySelectorAll('.mstep[data-mstep]').forEach(b=>{
   b.onclick=()=>go(b.dataset.mstep);
  });
 }

 /* 測定画面を開いたら①から始める。**次にすることが1つに決まる。** */
 function reset(){current='1';const el=shell();if(el)el.classList.remove('mstep-2','mstep-3');go('1')}

 WL.measureSteps={go,current:()=>current,refresh:paint,reset};

 /* ---------- 受信欄から手を離さずに巡回する（§9.124） ----------
    利用者はマウス＆キーボードで作業する。だが**空いているキーは3組しかない**
    ——`Tab`は測定器の確定、`Enter`は手動確定、`↑↓`は条の移動、
    `Delete/BS`は削除モードで埋まっており、`Ctrl`系はブラウザの既定
    ショートカット（タブ切替など）に取られるため`measurement-input.js`が
    捨てている。残っていたのが `→ ←` `PageUp/PageDown` `F2`。

    **段の移動はキーボード化しない。** ①→②、②→③は作業中に各1回しか
    起きないので、数少ない空き席を割く価値がない。 */
 const sel=id=>document.getElementById(id);
 /* 項目や丈位置を変えると測定表が描き直され、**その拍子に受信欄から
    フォーカスが外れる**（実測: 1回目の → は効くが、2回目以降が死ぬ）。
    こちらから変えたのだから、こちらで戻す。**受信欄は作り直していない**
    ので、戻すだけでよい（§9.122）。描き直しの後に回すため次のタスクで実行。 */
 /* 項目を移ったあと、**入力できる場所へフォーカスを置き直す**。
    どこへ置くかは項目で変わる（`measurement-view.js`の
    `AUTO_ONLY_MEASURE_TYPES` / `MANUAL_ONLY_MEASURE_TYPES`）:
      板厚/板幅・バリ            … 測定器からの転送 → **受信欄**
      ラテラルボー・テレスコープ・巻ずれ・フラットネス … 手動入力 → **セル**
      母材・揃い/肉厚/長さ        … 手動入力（別のパネル）→ 触らない
    **描き直しが終わってから置く。** 実測すると、項目を変えた直後の受信欄は
    高さ0で、寸法ゼロの要素はフォーカスを保持できないためブラウザが body へ
    落とす。そのタイミングで`focus()`を呼んでも効かない（呼んだ直後も body の
    ままだった）。`requestAnimationFrame`2回でレイアウトの確定を待つ。 */
 function restoreEntryFocus(){
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
   if(!measuring())return;
   const box=document.getElementById('inputStatusBox');
   const inp=document.getElementById('deviceInput');
   /* 受信の帯が出ている＝転送で入れる項目。**帯の有無で見る**——受信欄
      そのものは転送専用で1×1に潰してあり、高さでは判断できない。 */
   if(box&&inp&&box.offsetParent!==null&&S.measure.settings?.inputMode!=='manual'){
    if(document.activeElement!==inp)inp.focus();
    return;
   }
   /* 手動入力の項目は、いま入れるセル（`.current`）へ。ここが空だと
      「移ったのにどこへ打てばいいか分からない」状態になる。 */
   /* **readOnlyは属性ではなくプロパティで見る**——`applyInputProtection()`は
      `el.readOnly=...`を代入するだけで属性を付け外ししないため、
      `:not([readonly])`では実態と食い違う。 */
   const cell=[...document.querySelectorAll('#measurementGrid input.current')]
     .find(x=>!x.readOnly&&!x.disabled);
   if(cell&&document.activeElement!==cell)cell.focus();
  }));
 }

 function cycleSelect(id,dir){
  const el=sel(id);
  if(!el||!el.options||!el.options.length)return false;
  const n=el.options.length;
  el.selectedIndex=(el.selectedIndex+dir+n)%n;
  el.dispatchEvent(new Event('change',{bubbles:true}));
  restoreEntryFocus();
  return true;
 }
 /* 未測定の項目のうち、いまの**次**のものへ移る（一巡したら先頭へ）。
    いまの項目の中の次の空欄は転送のたびに自動で進むので、ここが担うのは
    **項目をまたぐ移動**だけ。 */
 function nextUnmeasured(){
  const el=sel('measureType');
  if(!el)return false;
  let prog=null;
  try{if(typeof measureProgress==='function')prog=measureProgress()}catch(e){}
  if(!prog)return false;
  const names=[...el.options].map(o=>o.value);
  const rest=new Set(prog.unmeasured.map(x=>x.name));
  const from=el.selectedIndex;
  for(let k=1;k<=names.length;k++){
   const i=(from+k)%names.length;
   if(rest.has(names[i])){
    el.selectedIndex=i;el.dispatchEvent(new Event('change',{bubbles:true}));
    restoreEntryFocus();
    return true;
   }
  }
  return false;   // 全部済んでいる: 何も動かさない（黙って別の場所へ飛ばさない）
 }
 /* **キーの割り当ては1箇所だけ。** 受信欄とセルの両方から呼ぶので、
    ここに書いて両方が使う（2箇所に書くと、片方だけ直した状態になる）。
    `empty`＝いま打っている欄が空か。空でなければ ← → は文字の中を動かす
    （手入力中のカーソル移動を奪わない）。
    扱ったら true を返す——呼び出し側はそれを見て既定の処理を止める。 */
 function handleKey(e,empty){
  if(!e||e.ctrlKey||e.altKey||e.metaKey)return false;
  const k=e.key;
  if(k==='F2'){e.preventDefault();nextUnmeasured();return true}
  if(k==='PageDown'){e.preventDefault();cycleSelect('lengthPos',1);return true}
  if(k==='PageUp'){e.preventDefault();cycleSelect('lengthPos',-1);return true}
  if((k==='ArrowRight'||k==='ArrowLeft')&&empty){
   e.preventDefault();cycleSelect('measureType',k==='ArrowRight'?1:-1);return true;
  }
  return false;
 }
 WL.measureNav={
  nextItem:()=>cycleSelect('measureType',1),
  prevItem:()=>cycleSelect('measureType',-1),
  nextLength:()=>cycleSelect('lengthPos',1),
  prevLength:()=>cycleSelect('lengthPos',-1),
  nextUnmeasured,handleKey,
 };

 /* ---------- いつ描き直すか ----------
    **文脈バーは「常に正しい」ことが値打ち**なので、中身が変わる経路を
    ぜんぶ拾う。1つでも漏らすと、古い値を見せたまま平然と並ぶ——
    空欄より悪い（利用者は正しいものとして読む）。 */

 /* ① 進捗が動いたとき。**ヘッダーの進捗表示が書き換わったのを見る**。
    `window.refreshMeasureProgress` をラップする手もあるが、そちらは
    グローバル関数の差し替えを1件増やす（§9.96の見張りが数えている）。
    出力そのものを見れば、呼び出し口を知らなくても取りこぼさない。
    paintが書くのは段の状態と文脈バーで、この器の外なので回り続けない。
    **コメントに閉じ記号を含む書き方をしないこと**——ここで一度、
    ワイルドカード付きの例示がコメントを途中で閉じ、ファイル全体が
    構文エラーになった（CSSで既知の罠と同じものをJSでやった）。 */
 function watchProgress(){
  const head=document.getElementById('headProgress');
  if(!head)return;
  new MutationObserver(()=>{try{paint()}catch(e){}})
   .observe(head,{childList:true,subtree:true,characterData:true});
 }

 /* ② 測定画面が開いた／閉じたとき。**開いたら①から始める**——次にすることが
    1つに決まる。開閉の検知は`#measureModal`のhidden属性を見る（開く関数を
    掴まえに行くより、状態そのものを見るほうが取りこぼさない）。 */
 function watchModal(){
  const modal=document.getElementById('measureModal');
  if(!modal)return;
  let open=!modal.hidden;
  new MutationObserver(()=>{
   const now=!modal.hidden;
   if(now===open)return;
   open=now;
   if(open)reset();
  }).observe(modal,{attributes:true,attributeFilter:['hidden']});
 }

 /* ③ 入力内容・条数を変えたとき。測定表の形と「進めない理由」が変わる。
    **addEventListenerで足す**（既存のonchangeを潰さない）。 */
 function watchInputs(){
  ['#measureType','#horizontalCount','#verticalCount','#toleranceSource'].forEach(sel=>{
   const el=document.querySelector(sel);
   if(el)el.addEventListener('change',()=>{try{paint()}catch(e){}});
  });
 }

 WL.onReady(()=>{
  bind();watchModal();watchInputs();watchProgress();
  const el=shell();if(el&&!el.classList.contains('mstep-1'))el.classList.add('mstep-1');
  paint();
 });
})();
