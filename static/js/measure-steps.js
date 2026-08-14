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

 /* ---------- ①準備「その他の設定」（§9.125） ----------
    18個の選択項目のうち、**毎回決めるもの**は誰が測るか・測定表の形・
    使う機材で、残る5つは前の設定のままで済むことが多い（CSSに以前から
    「条入力順・方向はプリセット値のままで問題ないことが多い」と書いてある）。
    だから畳む。**ただし畳んだままでも値は読めること**——隠したものが何かを
    書かずに隠すと、設定がそこにあること自体が忘れられる。
    既定と違うものには印を付ける（「触っていない」ことも情報）。 */
 const USUAL=[
  {id:'unwind',       label:'巻出方向',  def:()=>'上出し'},
  {id:'widthOrder',   label:'条入力順',  def:()=>'通常'},
  {id:'widthDirection',label:'方向',     def:()=>'昇順'},
  {id:'burr',         label:'バリ揃え',  def:()=>'指定なし'},
  /* コイル止めの既定はロット由来（`measurement-view.js`が`innerTape`から入れる）。
     定数で持つと、内巻両面テープのロットで常に「既定と違う」と出てしまう。 */
  {id:'coilStop',     label:'コイル止め',def:()=>(S.measure?.settings?.innerTape?'内巻両面テープ':'指定なし')},
 ];
 function paintUsual(){
  const state=document.getElementById('prepMoreState'),list=document.getElementById('prepMoreList');
  if(!state||!list)return;
  const parts=[];let changed=0;
  USUAL.forEach(u=>{
   const el=document.getElementById(u.id);if(!el)return;
   const v=String(el.value||'').trim(),d=String(u.def()||'').trim();
   const diff=!!v&&v!==d;if(diff)changed++;
   const text=`${esc(u.label)} ${esc(v||'—')}`;
   parts.push(diff?`<b>${text}</b>`:text);
  });
  list.innerHTML=parts.join(' / ');
  state.textContent=changed?`${changed}件が既定と違います`:'すべて既定のまま';
  state.classList.toggle('is-changed',changed>0);
 }
 function bindPrepMore(){
  const btn=document.getElementById('prepMore');
  const box=document.querySelector('.measure-shell .selectors');
  if(btn&&box)btn.onclick=()=>{
   const open=box.classList.toggle('prep-open');
   btn.setAttribute('aria-expanded',open?'true':'false');
  };
  USUAL.forEach(u=>{
   const el=document.getElementById(u.id);
   if(el)el.addEventListener('change',()=>{try{paintUsual()}catch(e){}});
  });
 }

 /* ---------- ③確認の完了前確認表（§9.125） ----------
    以前は未測定も公差外も、**完了を押した後**の確認ダイアログでしか
    分からなかった。押す前に見えれば直しに戻れる。
    完了ボタンは操作レールに常時出ているので**ここには置かない**。 */
 let fixMap={};
 const wtText=v=>String(v||'').replace('T',' ');
 /* 丈位置の呼び名は`#lengthPos`の選択肢が正（「1(頭)」「1(尾)」）。
    番号だけ出すと画面のどことも一致しない。 */
 const lengthLabel=li=>{
  const el=document.getElementById('lengthPos');
  return (el&&el.options[li]&&el.options[li].value)||`丈${li+1}`;
 };
 function finishRows(){
  if(!measuring())return null;
  const m=S.measure,rows=[];
  let p=null;try{if(typeof measureProgress==='function')p=measureProgress()}catch(e){}
  if(p){
   const rest=p.unmeasured;
   rows.push({key:'measure',name:'測定',state:rest.length?'todo':'done',
    value:`${p.doneCount}/${p.activeCount} 項目`,
    detail:rest.length
     ?'未測定: '+rest.map(x=>`${x.name}（${x.state==='todo'?'未入力':x.filled+'/'+x.total}）`).join('・')
     :'対象の項目はすべて入力済みです。',
    fix:rest.length?{label:'測定へ',type:rest[0].name}:null});
  }
  let ng=null;try{ng=WL.measureReview&&WL.measureReview.outOfTolerance()}catch(e){}
  if(ng){
   /* **判定できなかった件数を隠さない。** 公差が引けない項目を「合格」と
      同じに見せると、確認したつもりで何も確認していないことになる。 */
   const un=ng.unjudged.length
     ?` 公差が登録されていないため判定していない項目: ${ng.unjudged.join('・')}。`:'';
   /* **どの丈位置かまで言う。** 件数だけでは、いま出ていない丈のものを
      探しに行けない（そもそもこの集計は出ていない丈のためにある）。 */
   const where=x=>{
    const ls=[...new Set(x.hits.map(h=>lengthLabel(h.length)))];
    return ls.length?`（${ls.join('・')}）`:'';
   };
   rows.push({key:'ng',name:'公差外',state:ng.total?'bad':'done',
    value:ng.total?`${ng.total}件`:'なし',
    detail:(ng.total?ng.items.map(x=>`${x.name} ${x.hits.length}件${where(x)}`).join('・')
                    :'公差の外に出ている測定値はありません。')+un,
    fix:ng.total?{label:'見に行く',type:ng.items[0].name,length:ng.items[0].hits[0].length}:null});
  }
  const wt=m.workTime||{},both=!!(wt.startAt&&wt.endAt);
  rows.push({key:'worktime',name:'作業時間',state:both?'done':'todo',
   value:both?'記録済み':(wt.startAt?'終了が未記録':(wt.endAt?'開始が未記録':'未記録')),
   detail:both?`${wtText(wt.startAt)} → ${wtText(wt.endAt)}`
              :'開始・終了の両方を記録してください（右の欄で直接編集もできます）。',
   fix:both?null:{label:'記録する',focus:wt.startAt?'#workEndAt':'#workStartAt'}});
  if(p){
   const skipped=p.items.filter(x=>x.excluded).map(x=>x.name);
   if(skipped.length)rows.push({key:'skip',name:'対象外',state:'info',
    value:`${skipped.length}項目`,
    detail:skipped.join('・')+'（意図して外した項目です。完了の確認からも外れます）',fix:null});
  }
  return rows;
 }
 function paintFinish(){
  const box=document.getElementById('finishCheck');if(!box)return;
  const rows=current==='3'?finishRows():null;
  if(!rows){box.innerHTML='';fixMap={};return}
  fixMap={};rows.forEach(r=>{if(r.fix)fixMap[r.key]=r.fix});
  const rest=rows.filter(r=>r.state==='todo'||r.state==='bad').length;
  box.innerHTML=`<div class="fc-head"><h3>完了前の確認</h3>`
   +`<span class="fc-verdict fc-verdict--${rest?'rest':'ready'}">`
   +esc(rest?`あと ${rest}件`:'このまま完了できます')+`</span></div>`
   +`<ul class="fc-list">`+rows.map(r=>
     `<li class="fc-row fc-row--${r.state}">`
     +`<span class="fc-name">${esc(r.name)}</span>`
     +`<span class="fc-value">${esc(r.value)}</span>`
     +(r.fix?`<button type="button" class="fc-fix" data-fc-fix="${esc(r.key)}">${esc(r.fix.label)}</button>`:'<span></span>')
     +`<span class="fc-detail">${esc(r.detail)}</span></li>`).join('')
   +`</ul><p class="fc-note">確認できたら、左の「測定を完了」を押してください。</p>`;
 }
 /* 「直す」は**直せる場所まで連れて行く**。番号を言うだけでは探させることになる。 */
 document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('[data-fc-fix]');if(!b)return;
  const fix=fixMap[b.dataset.fcFix];if(!fix)return;
  if(fix.focus){
   const el=document.querySelector(fix.focus);
   if(el){el.focus();el.scrollIntoView({block:'center'})}
   return;
  }
  go('2');
  const sel=document.getElementById('measureType');
  if(sel&&fix.type){sel.value=fix.type;sel.dispatchEvent(new Event('change',{bubbles:true}))}
  const lp=document.getElementById('lengthPos');
  if(lp&&typeof fix.length==='number'&&lp.options[fix.length]){
   lp.selectedIndex=fix.length;lp.dispatchEvent(new Event('change',{bubbles:true}));
  }
  restoreEntryFocus();
 });

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
  try{fitLengthList()}catch(e){}
  try{fitControlWidths()}catch(e){}
  try{paintUsual()}catch(e){}
  try{paintFinish()}catch(e){}
 }

 /* リストボックスの高さは**`size`（行数）で決める**。CSSのpx指定では
    中身に合わせられず、**行の途中で切れる**（実測: 168pxにしたら最後の
    名前が半分で切れた）。表示サイズを変えると1行の高さも変わるので、
    pxで合わせ込むと必ずどこかでずれる。
    丈位置は選択肢の数ぶんまで縮める（2つのロットで5行ぶんの空白が付いて
    いた）。**オペレータは縮めない**——検証データで171人おり、行数を減らす
    ほど探すのが大変になる。①の穴は`size="7"`どおりの高さにするだけで
    54px減る（273pxという半端なpx指定が元凶だった。§9.126）。 */
 function fitList(id,max,min){
  const el=sel(id);
  if(!el||!el.options)return;
  const n=Math.max(min,Math.min(max,el.options.length));
  if(el.size!==n)el.size=n;
 }
 function fitLengthList(){fitList('lengthPos',7,2)}

 /* ---------- 入れ物は中身の長さから決める（§9.130） ----------
    グリッドの1マスへ自動で伸びるのを放置すると、「-」しか入っていない
    プルダウンが239px、1桁しか入らない欄が239px、日時の欄が494pxになる
    （実測）。**選択肢の長さはマスタ由来で事前に分からない**ので、
    CSSで決め打ちにすると実データで切れる。実際の選択肢を測って決める。
    桁数や書式が決まっているもの（数値・日時）はCSSの`max-width`で足りる。 */
 let widthCanvas=null;
 function textWidth(el,text){
  widthCanvas=widthCanvas||document.createElement('canvas');
  const ctx=widthCanvas.getContext('2d'),cs=getComputedStyle(el);
  ctx.font=`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return ctx.measureText(text).width;
 }
 /* 測り直すのは**選択肢か文字サイズが変わったときだけ**。オペレータは
    実データで171件あり、毎回測ると入力のたびに171回の計測が走る。 */
 const fitSig=new WeakMap();
 function fitSelectWidth(id,extra){
  const el=sel(id);
  if(!el||!el.options||!el.options.length)return;
  const cs=getComputedStyle(el);
  const sig=el.options.length+'|'+el.options[0].text+'|'
    +el.options[el.options.length-1].text+'|'+cs.fontSize;
  if(fitSig.get(el)===sig)return;
  fitSig.set(el,sig);
  let w=0;
  for(const o of el.options)w=Math.max(w,textWidth(el,o.text));
  const pad=parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight)+2;
  el.style.maxWidth=Math.ceil(w+pad+extra)+'px';
 }
 /* 一覧(size付き)は矢印が無い代わりに縦スクロールバーが出る。 */
 const FIT_LISTS=['operator','lengthPos'];
 const FIT_MENUS=['inspector','crewSize','innerDiameter','spool',
   'thicknessGauge','widthGauge','unwind','widthOrder','widthDirection',
   'burr','coilStop','toleranceSource'];
 function fitControlWidths(){
  FIT_LISTS.forEach(id=>fitSelectWidth(id,20));
  FIT_MENUS.forEach(id=>fitSelectWidth(id,28));
  READ_TEXT.forEach(([id,max])=>fitTextBox(id,max));
 }

 /* 読み取り専用の表示欄も**中身から**決める。品質情報は「異常情報なし」の
    6文字しか無くても器は1401×280pxあった（実測）。ただし品質情報は
    実データでは何行にもなるので、**行数の上限**を持たせて器の中で送る。
    1行の長さは`READ_TEXT_EM`（全角40文字ぶん）まで——これ以上長い行は
    目で追えなくなるので、幅を伸ばさず折り返す。
    **値は`.value`への代入で入るので変化を検知できない**（DOMは変わらない）。
    段の描き直しと、**出る瞬間（作業タブの切り替え）**の両方で測り直す。 */
 const READ_TEXT=[['motherQualityInfo',16],['qualityInfo',20]];
 const READ_TEXT_EM=40;
 function fitTextBox(id,maxRows){
  const el=sel(id);
  if(!el||el.tagName!=='TEXTAREA')return;
  const cs=getComputedStyle(el);
  const text=el.value||'';
  const sig='t|'+text.length+'|'+text.slice(0,60)+'|'+cs.fontSize;
  if(fitSig.get(el)===sig)return;
  fitSig.set(el,sig);
  const fs=parseFloat(cs.fontSize)||14;
  const frame=parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight)
    +parseFloat(cs.borderLeftWidth)+parseFloat(cs.borderRightWidth);
  const lines=text.split('\n');
  let longest=0;
  for(const ln of lines)longest=Math.max(longest,textWidth(el,ln));
  /* 縦スクロールバーのぶんを見込む（出ないときは余白になるだけ）。 */
  const inner=Math.min(longest,fs*READ_TEXT_EM);
  el.style.maxWidth=Math.ceil(inner+frame+18)+'px';
  let rows=0;
  for(const ln of lines){
   const w=textWidth(el,ln);
   rows+=inner>0?Math.max(1,Math.ceil(w/inner)):1;
  }
  el.rows=Math.max(2,Math.min(maxRows,rows));
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

 /* 品質情報の本文は`.value`への代入で入るので、**paintが先に走ることが
    ある**（読み込みの順は場面によって違う）。器が出る瞬間にもう一度
    測り直せば、どちらの順でも正しい大きさになる。**onclickを奪わない**
    ようaddEventListenerで足し、切り替え後の値で測るため1フレーム待つ。 */
 function watchWorkTabs(){
  document.querySelectorAll('[data-worktab]').forEach(b=>{
   b.addEventListener('click',()=>{
    requestAnimationFrame(()=>{try{fitControlWidths()}catch(e){}});
   });
  });
 }

 /* 測定画面を開いたら①から始める。**次にすることが1つに決まる。** */
 function reset(){
  current='1';
  const el=shell();if(el)el.classList.remove('mstep-2','mstep-3');
  /* その他の設定は**開くたびに畳み直す**（前のロットで開いたまま閉じたら、
     次のロットでも開いていた、という持ち越しを作らない）。 */
  const box=document.querySelector('.measure-shell .selectors');
  if(box)box.classList.remove('prep-open');
  const btn=document.getElementById('prepMore');
  if(btn)btn.setAttribute('aria-expanded','false');
  go('1');
 }

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
  bind();bindPrepMore();watchModal();watchInputs();watchProgress();watchWorkTabs();
  const el=shell();if(el&&!el.classList.contains('mstep-1'))el.classList.add('mstep-1');
  paint();
 });
})();
