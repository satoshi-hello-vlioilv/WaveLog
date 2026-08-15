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

 /* **選ばれた値の使用回数を数える**(§9.133)。オペレータは実データで171人
    おり、五十音順のままでは「いつもの人」を毎回探すことになる。設備ごとに
    数えて、次に開いたときは使った回数の多い順に並べる。
    数えるのは**人と機材**だけ——巻出方向のような2択は並べ替えても意味が
    無く、むしろ順番が動くと選び間違える。 */
 const COUNTED=['operator','inspector','thicknessGauge','widthGauge','innerDiameter','spool'];
 function bindChoiceUsage(){
  COUNTED.forEach(id=>{
   const el=document.getElementById(id);
   if(!el)return;
   el.addEventListener('change',()=>{
    try{
     const eq=(S.measure&&S.measure.equipment)||localStorage.getItem('AccessMeasurementConfiguredEquipment')||'';
     WL.choiceUsage.bump(eq,id,String(el.value||'').trim());
    }catch(e){}
   });
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

 /* ---------- 情報の壁を開く（§9.131） ----------
    基本情報・品質等級・幅分割情報・作業時間・測定データ分析は、タブ／
    サブタブで**1枚ずつしか出せなかった**。畳んでいた理由は場所が無いこと
    だったが、実測すると場所は余っていた（①で253px、③で619px）。
    タブを外して全部出す——どの段でどれを見せるかはCSSが決めるので、
    ここは**hidden属性を外すだけ**。
    `[hidden]{display:none}`はutilityレイヤ（最後）にあり、CSSからは
    打ち消せない（§9.59「hidden属性は必ず効かせる」）ので、属性側で開ける。
    デバッグ面だけは常に閉じたまま（普段見るものではない）。 */
 /* **同じ値なら触らない。** `el.hidden=true`は属性が既にあっても
    `setAttribute`を通るので、DOM仕様では**値が同じでも変更記録が積まれる**。
    見張り（watchInfoWall）と組み合わせると記録→再実行→記録…がマイクロ
    タスクで回り続け、**イベントループが返ってこなくなる**——実際にこれで
    起動オーバーレイが外れず、画面が出ないまま固まった。 */
 const setHidden=(el,v)=>{if(el.hidden!==v)el.hidden=v};
 function openInfoWall(){
  document.querySelectorAll('.measure-shell [data-infopanel]').forEach(p=>setHidden(p,false));
  /* **`[data-leftpanel]`は触らない**（§9.133）。品質規格と測定データ分析は
     タブの裏へ戻したので、ここで全部開くと**2枚が同じ場所に重なる**
     （③で実測: 品質規格 y=398-518 と 分析 y=398-638 が同時に出ていた）。
     どちらを出すかはタブ（`bindTabs`）が決める。 */
 }
 /* ③の記録の壁だけは**タブの裏を出す**（§9.137）。品質規格と測定データ分析は
    ①②ではタブで切り替えるが、③では別々のカードとして同時に並べる
    （骨子の`1×2`×4枚）。**`[hidden]`はutilityレイヤなのでCSSからは
    打ち消せない**ので属性側で開ける。①②で重ならないのは、あちらは
    `display:none`をCSSが与えているから。 */
 function openRecordWall(){
  if(current!=='3')return;
  document.querySelectorAll('.measure-shell [data-leftpanel="grade"],.measure-shell [data-leftpanel="analysis"]')
   .forEach(p=>setHidden(p,false));
 }

 /* 「いつもと同じ設定」の畳み込み（§9.140、§9.125へ戻す）。骨子の①
    「準備の入力」は`1×2`しかなく、5カテゴリ＋作業時間を全部開くと実測
    113px溢れて**作業時間が切れる**。畳むかわりに、**畳んだままでも値は
    読める**ようにする——見出しに現在値を並べる（隠したものが何かを書かずに
    隠すと、設定の存在ごと忘れられる）。
    **既定値との差を件数で言うことはしない**——コイル止めの既定はロット由来
    （`innerTape`）で定数では持てず（§9.125）、思い込みの既定で「N件違う」と
    出すほうが値そのものを並べるより不正確になる。 */
 const USUAL_IDS=['unwind','widthOrder','widthDirection','burr','coilStop'];
 function usualSummary(){
  return USUAL_IDS.map(id=>{
   const el=sel(id);if(!el)return '';
   const v=(el.selectedOptions&&el.selectedOptions[0]?el.selectedOptions[0].text:el.value)||'';
   return String(v).trim();
  }).filter(v=>v&&v!=='-').join('・');
 }
 function refreshUsualFold(){
  const btn=document.getElementById('usualFold'),sum=document.getElementById('usualSum');
  const box=document.querySelector('.selectors');
  if(!btn||!box)return;
  const open=btn.getAttribute('aria-expanded')==='true';
  /* **同じ値なら触らない**（§9.131。値が同じでも変更記録が積まれ、見張りと
     合わさると回り続ける）。 */
  if(box.classList.contains('usual-off')===open)box.classList.toggle('usual-off',!open);
  if(sum){const t=usualSummary();if(sum.textContent!==t)sum.textContent=t;}
 }
 function bindUsualFold(){
  const btn=document.getElementById('usualFold');
  if(!btn||btn.dataset.bound)return;
  btn.dataset.bound='1';
  btn.addEventListener('click',()=>{
   btn.setAttribute('aria-expanded',btn.getAttribute('aria-expanded')==='true'?'false':'true');
   refreshUsualFold();
   try{fitControlWidths()}catch(e){}
  });
  /* 値が変わったら要約も変える。**`.value`への代入ではDOMが変わらない**ので
     （§9.130）、段の描き直し側でも呼ぶ。 */
  USUAL_IDS.forEach(id=>{const el=sel(id);if(el)el.addEventListener('change',refreshUsualFold)});
 }
 function paint(){
  const el=shell();if(!el)return;
  try{openInfoWall();openRecordWall();bindUsualFold();refreshUsualFold()}catch(e){}
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
 /* ---------- 幅は規格へ丸め、群の中でそろえる（§9.131） ----------
    §9.130で中身から決めるようにしたが、**中身に忠実な幅をそのまま使うと
    1画面に何種類もの幅が生まれる**（実測: ①準備で19種類）。隣どうしの
    右端がばらばらだと、そろっていないという印象はむしろ強くなる。
    直したのは2点:
      ① 測った幅を`--w-*`の**直近上位へ丸める**（幅の種類が5段に収まる）
      ② **同じ群の中は群の最大へそろえる**——縦に並ぶものの幅が同じで
         あることが「整列して見える」条件そのもの。
    単位はem（文字で決まるものなので）。表示サイズは文字側が持つため、
    **特大にしても溢れない**（§9.130で12px溢れた事故の根も断てる）。 */
 const W_EM=[4.5,7,11,15,22,32];
 const snapEm=(need,fs)=>{
  const em=need/(fs||14);
  for(const s of W_EM)if(em<=s+0.01)return s;
  return W_EM[W_EM.length-1];
 };
 /* 中身から必要な幅（px）を出す。**空欄を0文字と数えない**（§9.130）——
    これから入る値が収まる大きさが要る。 */
 function needWidth(el){
  const cs=getComputedStyle(el);
  let w=0;
  if(el.tagName==='SELECT'){
   for(const o of el.options)w=Math.max(w,textWidth(el,o.text));
  }else if(el.type==='number'){
   const digits=String(el.max||'').length||4;
   w=textWidth(el,'0'.repeat(Math.max(digits,3))+'.00');
  }else if(el.type==='datetime-local'){
   w=textWidth(el,'2026/08/14 15:04:05');
  }else{
   w=Math.max(textWidth(el,el.value||''),textWidth(el,el.placeholder||''),
              textWidth(el,'あ'.repeat(8)));
  }
  const pad=parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight)
    +parseFloat(cs.borderLeftWidth)+parseFloat(cs.borderRightWidth);
  /* プルダウンの矢印・一覧のスクロールバーのぶん。 */
  const extra=el.tagName==='SELECT'?(el.size>1?20:26):2;
  return w+pad+extra;
 }
 /* 群＝「縦に並べて読むひとかたまり」。①準備の見出し（誰が測るか／測定表の
    形／使う機材／その他）と、パネルごとの入力欄がそれにあたる。 */
 const W_GROUPS=[
  ['who',   ['inspector','crewSize']],
  ['shape', ['verticalCount','horizontalCount']],
  ['gear',  ['innerDiameter','spool','thicknessGauge','widthGauge']],
  ['usual', ['unwind','widthOrder','widthDirection','burr','coilStop']],
  /* オペレータと丈位置は**別の群**。どちらも`size`付きの一覧だが、
     一緒に並ぶことが無い（オペレータは①、丈位置は②）ので、そろえる意味が
     無い。まとめると人名の長さ（実データで171人）が丈位置にも効いてしまい、
     「1(頭)」しか入らない欄が154pxになる。 */
  ['op',    ['operator']],
  ['len',   ['lengthPos']],
  ['tol',   ['toleranceSource']],
  ['time',  ['workStartAt','workEndAt']],
 ];
 /* 測り直すのは**選択肢か文字サイズが変わったときだけ**。オペレータは
    実データで171件あり、毎回測ると入力のたびに171回の計測が走る。
    署名は群ごとに持つ（1つでも変わったら群ごと測り直す）。 */
 const fitSig=new WeakMap();
 const groupSig={};
 function fitGroup(key,ids){
  const els=ids.map(sel).filter(x=>x&&!x.disabled);
  if(!els.length)return;
  const sig=els.map(el=>(el.options?el.options.length+':'+(el.options[0]||{}).text
     +':'+(el.options[el.options.length-1]||{}).text:el.type+':'+el.max)
     +':'+getComputedStyle(el).fontSize).join('|');
  if(groupSig[key]===sig)return;
  groupSig[key]=sig;
  let em=0;
  for(const el of els)em=Math.max(em,snapEm(needWidth(el),parseFloat(getComputedStyle(el).fontSize)));
  for(const el of els)el.style.maxWidth=em+'em';
 }
 /* ---------- 幅は「同じ列に並ぶもの」でそろえる（§9.142） ----------
    §9.131で群（誰が測るか／使う機材…）の中をそろえたが、**群は意味の
    まとまりであって、目に見える列ではない**。実測すると①準備の3列に
    124px（選択肢）と63px（1〜2桁の数値）が縦に重なっており、右端が61px
    ずれていた——**中身に忠実であるほど、列の右端はばらばらになる**。
    中身から決めることと整列は、「同じ列は同じ幅」まで上げて初めて両立する。
    そろえ先は列の最大の段。**器（トラック）が上限を兼ねる**ので
    （どの部品も`width:100%`）、段を上げても器より広くはならない。
    ボタンは対象外——文字の長さで決まるのが正しく、そろえると「クリア」が
    「現在」ぶんの空白を抱えることになる。 */
 const ALIGN_CARDS='.measure-shell .left-pane,.measure-shell .center-pane,'
   +'.measure-shell .quality-pane,.measure-shell .right-pane,.measure-shell .split-pane';
 /* 幅を持たない（`width:100%`が効かない）種類は、そろえても位置が動かない
    どころか、`max-width`を上げると器いっぱいに伸びてしまう。 */
 const NO_WIDTH=/^(checkbox|radio|button|submit|reset|hidden|range|color|image|file)$/;
 function alignColumnWidths(){
  document.querySelectorAll(ALIGN_CARDS).forEach(card=>{
   const cols=new Map();
   card.querySelectorAll('select,input,textarea').forEach(el=>{
    /* 受信欄は触らない（§9.122）。表の中のセルは行が幅を持つ。
       1pxに切り詰めてある状態の部品も対象外。 */
    if(el.id==='deviceInput'||el.closest('table'))return;
    if(el.tagName==='INPUT'&&NO_WIDTH.test(el.type))return;
    if(el.offsetParent===null)return;
    const b=el.getBoundingClientRect();
    if(b.width<8)return;
    const cs=getComputedStyle(el);
    const fs=parseFloat(cs.fontSize)||14;
    const em=cs.maxWidth==='none'?Infinity:parseFloat(cs.maxWidth)/fs;
    const key=Math.round(b.left);
    const col=cols.get(key)||{em:0,els:[]};
    col.em=Math.max(col.em,em);col.els.push(el);
    cols.set(key,col);
   });
   cols.forEach(col=>{
    if(col.els.length<2)return;
    const v=col.em===Infinity?'none':(Math.round(col.em*100)/100)+'em';
    for(const el of col.els)if(el.style.maxWidth!==v)el.style.maxWidth=v;
   });
  });
 }
 function fitControlWidths(){
  W_GROUPS.forEach(([k,ids])=>fitGroup(k,ids));
  READ_TEXT.forEach(([id,max])=>fitTextBox(id,max));
  alignColumnWidths();
 }

 /* 読み取り専用の表示欄は**幅を器から、高さ（行数）を中身から**決める
    （§9.142）。§9.130では幅も中身から決めていたが、855pxのカードの中で
    本文だけが210pxになり、真上に置いた品質規格の表と右端が645pxずれて
    いた——**器の中で1つだけ幅が違うものは、それだけで「そろっていない」**。
    §9.130が直したかったのは「6文字に1401×280px」という**高さも含めた**
    無駄で、器をカードの幅に、高さを中身に決めればその趣旨は満たせる
    （骨子でカードの大きさが決まったので、器そのものが暴れなくなった）。
    **値は`.value`への代入で入るので変化を検知できない**（DOMは変わらない）。
    段の描き直しと、**出る瞬間（作業タブの切り替え）**の両方で測り直す。
    器の幅も署名に入れる——カードの幅が変われば折り返す行数が変わる。 */
 const READ_TEXT=[['motherQualityInfo',16],['qualityInfo',20]];
 function fitTextBox(id,maxRows){
  const el=sel(id);
  if(!el||el.tagName!=='TEXTAREA')return;
  if(el.style.maxWidth)el.style.maxWidth='';
  const cs=getComputedStyle(el);
  const text=el.value||'';
  const frame=parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight);
  /* 縦スクロールバーのぶん(18px)を引いてから数える。 */
  const inner=el.clientWidth-frame-18;
  const sig='t|'+text.length+'|'+text.slice(0,60)+'|'+cs.fontSize+'|'+Math.round(inner);
  if(fitSig.get(el)===sig)return;
  fitSig.set(el,sig);
  const lines=text.split('\n');
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

 /* **表示サイズを変えたら測り直す**（§9.130）。幅は「そのときの文字サイズで
    測った結果」なので、特大にすると文字だけが1.4倍になり、**選択肢が器から
    溢れる**（実測: オペレータの一覧が横に12px。`test_fit`が捕まえた）。
    表示サイズは`html[data-ui-size]`で伝わる（`base.js`）。 */
 function watchUiSize(){
  new MutationObserver(()=>{
   requestAnimationFrame(()=>{try{fitControlWidths()}catch(e){}});
  }).observe(document.documentElement,{attributes:true,attributeFilter:['data-ui-size']});
 }

 /* 品質情報の本文は`.value`への代入で入るので、**paintが先に走ることが
    ある**（読み込みの順は場面によって違う）。器が出る瞬間にもう一度
    測り直せば、どちらの順でも正しい大きさになる。**onclickを奪わない**
    ようaddEventListenerで足し、切り替え後の値で測るため1フレーム待つ。 */
 /* 情報の壁は**閉じられたら開き直す**。`renderMeasurement()`が開くたびに
    `[data-leftpanel]`を1枚だけ残して畳むため（作業時間タブの初期化）、
    段の描き直しの前に閉じられていることがある。同じ値の代入では変化
    記録が出ないので、この見張りは回り続けない。 */
 function watchInfoWall(){
  const pane=document.querySelector('.measure-shell .left-pane');
  if(!pane)return;
  new MutationObserver(()=>{try{openInfoWall()}catch(e){}})
   .observe(pane,{attributes:true,attributeFilter:['hidden'],subtree:true});
 }

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
      板厚・板幅・バリ            … 測定器からの転送 → **受信欄**
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
  bind();bindChoiceUsage();watchModal();watchInputs();watchProgress();watchWorkTabs();
  watchUiSize();watchInfoWall();
  const el=shell();if(el&&!el.classList.contains('mstep-1'))el.classList.add('mstep-1');
  paint();
 });
})();
