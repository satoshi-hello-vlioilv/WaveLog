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
  /* 公差は「どちらを見ているか」が値そのものより効く（§CLAUDE.md 出どころを出す）。
     **どの項目に効くのかも書く**（§9.242 ⑤）——上下限を持つのは板厚・板幅
     だけなので、バリやテレスコープを測っている人が「この公差で判定されて
     いる」と読まないようにする（あちらは片側の基準）。 */
  const src=st.toleranceSource==='order'?'オーダー公差':'製造公差';
  const has=typeof WL.measureInput.compactToleranceData==='function'&&!!WL.measureInput.compactToleranceData('width');
  const scope='上下限のある板厚・板幅に効きます（ラテラルボー・バリ・テレスコープ・'
    +'巻ずれ・フラットネスは片側の「基準」で判定します）';
  put('mctxTolerance',has?src:src+'（未設定）',
      has?scope:'このロットには使えるプラス・マイナス値がありません。'+scope);
 }

 /* ---------- 段の状態 ----------
    **色だけで伝えない。** 必ず文字（済／未／件数）を出す。 */
 /* `prog`は呼ぶ側が1回だけ引いて渡す（`paint()`が段3の`title`にも同じ
    一覧を使う。2度引くと片方だけ直した状態が作れる）。省略時は自分で引く。 */
 function stepStates(prog){
  const m=measuring()?S.measure:null;
  const started=!!(m&&m.workTime&&m.workTime.startAt);
  const ended=!!(m&&m.workTime&&m.workTime.endAt);
  if(prog===undefined){prog=null;
   try{if(typeof measureProgress==='function')prog=measureProgress()}catch(e){WL.quiet.note('進捗を数えられない（数字を出さないだけ）',e)}}
  const rest=prog?prog.unmeasured.length:null;
  return {
   '1':started?'開始 済':'開始 未',
   '2':prog?`${prog.doneCount}/${prog.activeCount} 項目`:'—',
   /* **残件数を先に言う**（§9.234 ④）。以前は`終了 済`が勝っていたため、
      作業終了を打刻したあとに未測定が残っている場面を言えるのは帯の
      「未測定 N項目」だけだった。帯を廃止したのでここが引き受ける。 */
   '3':rest?`残り ${rest}項目`:(ended?'終了 済':(rest===null?'—':'確認できます')),
  };
 }

 /* ---------- 帯の「未測定 N項目」は廃止した（§9.234 ④、利用者の指示
       「確認して完了のタブの横に出るオレンジ系の文字の情報が冗長で、
        出たときにロット情報が見切れる」） ----------
    出していたのは`未測定 ${n}項目`の1本だけで、その`n`は隣の段3の状態
    （`残り ${n}項目`）と**同じ`measureProgress().unmeasured.length`**だった
    ——同じ数字を10px離して2度出していた（§CLAUDE 8／§9.129）。しかも器は
    `padding:0 16px`込みで1366px以下では32px＝**1文字も出ていなかった**
    （広い窓では冗長・狭い窓では読めない）。
    **どの項目かは③の確認表が1行ずつ出している**ので情報は失われない。
    加えて段3のボタンの`title`にも名前を入れる（幅を1pxも使わない）。
    **跡地へ新しい常設の一言を置かないこと**——母材の案内をここへ出して
    同じ見切れを起こした前科がある（§9.233 ③）。 */

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
    }catch(e){WL.quiet.note('端末の覚えが読めない（既定で続ける）',e)}
   });
  });
 }

 /* ---------- ③確認の完了前確認表（§9.125） ----------
    以前は未測定も公差外も、**完了を押した後**の確認ダイアログでしか
    分からなかった。押す前に見えれば直しに戻れる。
    完了ボタンは操作レールに常時出ているので**ここには置かない**。 */
 let fixMap={};
 /* 作業時刻は**地方時の分まで**（§9.242 ①）。以前は保存値（ISO・UTC・
    ミリ秒つき）の`T`を空白へ置き換えるだけで、`2026-08-26 04:59:31.307Z`と
    そのまま出していた——**時差のぶんずれた時刻**を、欄には出ていない
    精度で見せていたことになる。書式は`formatWorkTime()`の1箇所へ寄せる。 */
 const wtText=v=>(typeof formatWorkTime==='function'?formatWorkTime(v):String(v||''))
   ||String(v||'').replace('T',' ');
 /* 丈位置の呼び名は`#lengthPos`の選択肢が正（「1(頭)」「1(尾)」）。
    番号だけ出すと画面のどことも一致しない。 */
 const lengthLabel=li=>{
  const el=document.getElementById('lengthPos');
  return (el&&el.options[li]&&el.options[li].value)||`丈${li+1}`;
 };
 function finishRows(){
  if(!measuring())return null;
  const m=S.measure,rows=[];
  let p=null;try{if(typeof measureProgress==='function')p=measureProgress()}catch(e){WL.quiet.note('進捗を数えられない（数字を出さないだけ）',e)}
  if(p){
   const rest=p.unmeasured;
   rows.push({key:'measure',name:'測定',state:rest.length?'todo':'done',
    value:`${p.doneCount}/${p.activeCount} 項目`,
    detail:rest.length
     ?'未測定: '+rest.map(x=>`${x.name}（${x.state==='todo'?'未入力':x.filled+'/'+x.total}）`).join('・')
     :'対象の項目はすべて入力済みです。',
    fix:rest.length?{label:'測定へ',type:rest[0].name}:null});
  }
  let ng=null;try{ng=WL.measureReview&&WL.measureReview.outOfTolerance()}catch(e){WL.quiet.note('公差外を数えられない（件数を出さないだけ）',e)}
  if(ng){
   /* **公差と基準は言い分ける**（§9.242 ⑤、利用者の指示）。この行は板厚・
      板幅（上下限＝公差）とラテラルボー等（片側＝基準）を同じ表に並べる
      ので、**名前は両方の言葉を持つ**——片方だけだと、もう片方は数えて
      いないように読める。項目ごとの言葉は`WL.measureItem`の1箇所が答える。 */
   const wordOf=n=>WL.measureItem.limitWord(n);
   /* **判定できなかった件数を隠さない。** 引けない項目を「合格」と同じに
      見せると、確認したつもりで何も確認していないことになる。
      **理由も言葉ごとに分ける**——直す先（公差マスタ／指示値）が違う。 */
   const bag={};
   ng.unjudged.forEach(n=>{const w=wordOf(n);(bag[w]=bag[w]||[]).push(n)});
   const un=Object.keys(bag).map(w=>
     ` ${w}が登録されていないため判定していない項目: ${bag[w].join('・')}。`).join('');
   /* **どの丈位置かまで言う。** 件数だけでは、いま出ていない丈のものを
      探しに行けない（そもそもこの集計は出ていない丈のためにある）。 */
   const where=x=>{
    const ls=[...new Set(x.hits.map(h=>lengthLabel(h.length)))];
    return ls.length?`（${ls.join('・')}）`:'';
   };
   rows.push({key:'ng',name:'公差外・基準外',state:ng.total?'bad':'done',
    value:ng.total?`${ng.total}件`:'なし',
    detail:(ng.total?ng.items.map(x=>`${x.name} ${wordOf(x.name)}外 ${x.hits.length}件${where(x)}`).join('・')
                    :'公差・基準の外に出ている測定値はありません。')+un,
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
/* ---------- 公差外・基準外はカードで気づく（§9.242 ⑥、利用者の指示） ----------
    「完了前の確認のカードで公差外、基準外などが発生したときにカード自体を
     背景色または縁の色などを変えて視覚的に気付くようにしてください。
     今のままか強調か、色なども含めて変更できるように設計してください」

    **色は`WL.columnTint.PALETTE`の7色から選ぶ**（§9.198／§9.239 ⑤-3）——
    16進を選ばせない。色の言葉（灰・青緑・青・緑・橙・赤・紫）を2つ持たない。
    **置き場はこの端末**（§9.199の親ロットの印と同じ。強調の強さは読み方の
    好みで、共有マスタへ入れると全員が同じ強さに縛られる）。
    **色だけで伝えない**（§3）——強調しているのは行の「公差外・基準外 N件」
    という文字が既に言っている事実で、色はその増幅にすぎない。 */
 const ALERT_KEY='WaveLogFinishAlertV1';
 const ALERT_MODES=[['both','縁と面'],['frame','縁だけ'],['fill','面だけ'],
                    ['off','強調しない（今までどおり）']];
 /* **既定は強調する**（利用者が求めたのがこれ）。「今のまま」は選べる側。 */
 const ALERT_DEFAULT={mode:'both',color:'red'};
 const tintPalette=()=>(window.WL&&WL.columnTint&&WL.columnTint.PALETTE)||{};
 function alertPref(){
  let v=null;
  try{v=JSON.parse(localStorage.getItem(ALERT_KEY)||'null')}catch(e){WL.quiet.note('端末の覚えが読めない（既定で続ける）',e)}
  const p=(v&&typeof v==='object')?v:{};
  const modes=ALERT_MODES.map(x=>x[0]);
  return {mode:modes.includes(p.mode)?p.mode:ALERT_DEFAULT.mode,
          color:tintPalette()[p.color]?p.color:ALERT_DEFAULT.color};
 }
 function setAlertPref(patch){
  const next=Object.assign(alertPref(),patch||{});
  try{localStorage.setItem(ALERT_KEY,JSON.stringify(next))}catch(e){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',e)}
  paintFinish();
 }
 /* 強調を当てるのは**カードそのもの**（利用者の指示「カード自体を」）。
    値は`--fc-alert-*`で渡す（インラインの`background`を直に書くと、
    どのレイヤからも打ち消せなくなる。§9.221 ⑨の`--rp-fit`と同じ約束）。 */
 function applyAlert(box,bad){
  const p=alertPref(),tone=tintPalette()[p.color]||{};
  const on=!!bad&&p.mode!=='off';
  box.classList.toggle('fc-alert',on);
  if(on){
   box.dataset.fcAlert=p.mode;
   box.style.setProperty('--fc-alert-bg',tone.bg||'var(--danger-bg)');
   box.style.setProperty('--fc-alert-ink',tone.ink||'var(--danger)');
   box.style.setProperty('--fc-alert-line',tone.line||'var(--danger-border)');
   box.title='公差外・基準外があるため強調しています（強調のしかたは見出しの「強調」から変えられます）';
  }else{
   delete box.dataset.fcAlert;
   ['--fc-alert-bg','--fc-alert-ink','--fc-alert-line'].forEach(k=>box.style.removeProperty(k));
   box.removeAttribute('title');
  }
 }
 /* ---------- 強調の設定は小さな浮き窓（§9.201） ----------
    **器の外（`body`直下）へ`position:fixed`で出す**——カードは
    `overflow:auto`なので、中で開くと必ず切り落とされる。
    **開いた器は必ず控える**（§9.222 ①。控え忘れると、閉じる3つの経路
    （×・外クリック・Esc）が全部先頭で引き返して二度と閉じられない）。 */
 let alertPop=null;
 function closeAlertPop(){
  if(!alertPop)return;
  alertPop.remove();alertPop=null;
  document.removeEventListener('mousedown',onAlertOutside,true);
  document.removeEventListener('keydown',onAlertKey,true);
  const btn=document.getElementById('fcAlertConf');
  if(btn)btn.setAttribute('aria-expanded','false');
 }
 function onAlertOutside(e){
  if(!alertPop)return;
  if(alertPop.contains(e.target))return;
  if(e.target.closest&&e.target.closest('#fcAlertConf'))return;
  closeAlertPop();
 }
 function onAlertKey(e){
  /* Escは**変換中を除く**（§9.221 ①。日本語入力では変換の取り消しに使う）。 */
  if(e.key!=='Escape'||e.isComposing||e.keyCode===229)return;
  closeAlertPop();
 }
 function openAlertPop(btn){
  closeAlertPop();
  const p=alertPref(),pal=tintPalette();
  const pop=document.createElement('div');
  pop.className='fc-alert-pop';pop.id='fcAlertPop';
  pop.setAttribute('role','dialog');
  pop.setAttribute('aria-label','公差外・基準外のときの強調');
  pop.innerHTML=`<div class="fc-alert-pop-head"><b>公差外・基準外のときの強調</b>`
   +`<button type="button" class="fc-alert-close" aria-label="閉じる" title="閉じる">×</button></div>`
   +`<div class="fc-alert-row"><small>強調のしかた</small>`
   +`<div class="fc-alert-modes">`+ALERT_MODES.map(([k,label])=>
      `<button type="button" class="fc-alert-mode${p.mode===k?' is-on':''}" data-fc-mode="${esc(k)}">${esc(label)}</button>`).join('')
   +`</div></div>`
   +`<div class="fc-alert-row"><small>色</small><div class="fc-alert-colors">`
   +Object.keys(pal).map(k=>
      `<button type="button" class="fc-alert-color${p.color===k?' is-on':''}" data-fc-color="${esc(k)}"`
      +` style="--sw-bg:${pal[k].bg};--sw-line:${pal[k].line};--sw-ink:${pal[k].ink}"`
      +` title="${esc(pal[k].label+'（'+pal[k].note+'）')}">${esc(pal[k].label)}</button>`).join('')
   +`</div></div>`
   /* **色の数を文に書かないこと**——表は`WL.columnTint.PALETTE`の1箇所で、
      §9.286 ⑥で7色から14色へ増えたときにこの文だけが古いまま残っていた。 */
   +`<p class="fc-alert-note">この端末だけの設定です。色は行の色・列の色と同じ表から選びます。</p>`;
  document.body.appendChild(pop);
  alertPop=pop;
  const r=btn.getBoundingClientRect(),pr=pop.getBoundingClientRect();
  /* **画面の外へ出さない。** 右端・下端で折り返す。 */
  const left=Math.max(8,Math.min(window.innerWidth-pr.width-8,r.left));
  const top=Math.min(window.innerHeight-pr.height-8,r.bottom+6);
  pop.style.left=left+'px';pop.style.top=Math.max(8,top)+'px';
  btn.setAttribute('aria-expanded','true');
  pop.querySelector('.fc-alert-close').onclick=closeAlertPop;
  pop.querySelectorAll('[data-fc-mode]').forEach(b=>b.onclick=()=>{
   setAlertPref({mode:b.dataset.fcMode});
   pop.querySelectorAll('[data-fc-mode]').forEach(x=>x.classList.toggle('is-on',x===b));
  });
  pop.querySelectorAll('[data-fc-color]').forEach(b=>b.onclick=()=>{
   setAlertPref({color:b.dataset.fcColor});
   pop.querySelectorAll('[data-fc-color]').forEach(x=>x.classList.toggle('is-on',x===b));
  });
  document.addEventListener('mousedown',onAlertOutside,true);
  document.addEventListener('keydown',onAlertKey,true);
 }

 /* ---------- 「NGが発生した」は確認カードの中（§9.242 ⑥、利用者の指示） ----------
    「NG回数として記録というボタンがありますが、この発生したとのみボタンを
     カード内に表示、今のメニュー位置のボタンは削除。15分に1回以上は
     押せないように制限し、作業導線に組み込む形に変更してください」

    NGに気づくのは**この行**（公差外・基準外）なので、押す場所もここにある。
    操作レールのボタンは`templates/index.html`から外した——**入口を2つに
    しない**（片方だけに制限が掛かる形を作らない）。
    **控えはレコードの中**（`settings.ngLastAt`）——このロットの制限なので、
    別のPCで続きを開いても引き継がれる（端末に持つと、端末を替えれば
    すぐ押せてしまう）。 */
 const NG_GUARD_MS=15*60*1000;
 function ngGuard(){
  const m=measuring()?S.measure:null;
  const st=(m&&m.settings)||{};
  const count=Number(st.ngCount||0)||0;
  const last=st.ngLastAt?new Date(st.ngLastAt).getTime():0;
  const leftMs=(Number.isFinite(last)&&last>0)?(last+NG_GUARD_MS-Date.now()):0;
  return {count,leftMin:leftMs>0?Math.ceil(leftMs/60000):0};
 }
 async function registerNgOnce(){
  const g=ngGuard();
  if(g.leftMin>0)return;
  if(!(window.WL&&WL.measureNg&&WL.measureNg.register)){
   console.error('NGの記録: WL.measureNg が見つかりません（records-store.jsの公開漏れ）');
   return;
  }
  /* **取り消せない操作なので1回だけ確認する**（§5）。件数も出す——
     何回目になるのかが分からないまま押させない。 */
  const ok=await confirmModal(`このロットでNGが発生したことを記録します（${g.count+1}回目）。\n記録すると状態は「測定値NG」になり、次に押せるのは15分後です。`);
  if(!ok)return;
  await WL.measureNg.register();
  const m=measuring()?S.measure:null;
  if(m&&m.settings)m.settings.ngLastAt=new Date().toISOString();
  paintFinish();
 }
 /* 待ち時間は放っておくと**古いまま**なので、押せない間だけ数え直す。
    **押せるようになったら止める**（測定中に無駄な描き直しを続けない）。 */
 let ngTimer=null;
 function syncNgTimer(){
  /* **ボタンを出していないときは数え直さない**（§9.246 ③）。出ていない
     待ち時間のために30秒ごとに描き直すと、③に居るあいだ理由の無い
     組み直しが続く。 */
  const shown=!!(document.getElementById('fcNgBtn'));
  const need=current==='3'&&shown&&ngGuard().leftMin>0;
  if(need&&!ngTimer)ngTimer=setInterval(()=>{if(current==='3')paintFinish();else syncNgTimer()},30000);
  if(!need&&ngTimer){clearInterval(ngTimer);ngTimer=null}
 }
 /* ---------- 出すのは「公差外・基準外が出ているとき」だけ（§9.246 ③） ----------
    利用者の指示:
      「完了前の確認のカードの表示で、公差外・基準外が出ていない場合、
       『NGが発生した』ボタンは非表示にして使えないようにしてください」

    §CLAUDE 4「押せるのに何も起きないボタンを残さない」の素直な適用
    ——気づく場所（この行）に何も出ていないのに「NGが発生した」だけが
    押せる状態は、押す理由の無いボタンを主要動線に置いていることになる。

    **記録した事実は隠さない**（§3）——既にこのロットでNGを記録していれば
    「記録 N回」の文字は残す。消すと、記録があること自体に気づけなくなる。
    **出さない理由も`title`に書く**（§4／§6）。 */
 function ngButtonHtml(row){
  const g=ngGuard();
  if(!row||row.state!=='bad'){
   if(!g.count)return '';
   return `<div class="fc-actions">`
    +`<small class="fc-ng-note" title="${esc('このロットでNGを '+g.count+'回 記録しています。'
      +'いまは公差外・基準外が1件も出ていないので、「NGが発生した」は出していません。')}">`
    +esc(`記録 ${g.count}回`)+`</small></div>`;
  }
  const label=g.leftMin>0?`NGが発生した（あと${g.leftMin}分）`:'NGが発生した';
  const tip=g.leftMin>0
   ?`直前の記録から15分たっていません（あと約${g.leftMin}分）。同じ不具合を続けて数えないための制限です。`
   :'このロットでNGが発生したことを記録します。押すと状態が「測定値NG」になり、NG回数が1つ増えます。';
  /* 添え書きは**短く**（§9.234 ①）。この行はカード3枚のうちの1枚ぶんしか幅が
     無いので、文にすると必ず折り返す——数だけを出し、全文は`title`が持つ。 */
  const note=`記録 ${g.count}回`;
  const noteTip=(g.count?`このロットでNGを ${g.count}回 記録しています。`
                        :'このロットではまだNGを記録していません。')
   +(g.leftMin>0?`直前の記録から15分たっていないため、いまは押せません（あと約${g.leftMin}分）。`
                :'');
  return `<div class="fc-actions">`
   +`<button type="button" class="fc-ng"${g.leftMin>0?' disabled':''} id="fcNgBtn"`
   +` title="${esc(tip)}">${esc(label)}</button>`
   +`<small class="fc-ng-note" title="${esc(noteTip)}">${esc(note)}</small></div>`;
 }

 function paintFinish(){
  const box=document.getElementById('finishCheck');if(!box)return;
  const rows=current==='3'?finishRows():null;
  if(!rows){box.innerHTML='';fixMap={};applyAlert(box,false);closeAlertPop();syncNgTimer();return}
  fixMap={};rows.forEach(r=>{if(r.fix)fixMap[r.key]=r.fix});
  const rest=rows.filter(r=>r.state==='todo'||r.state==='bad').length;
  const bad=rows.some(r=>r.state==='bad');
  box.innerHTML=`<div class="fc-head"><h3 class="card-title">完了前の確認</h3>`
   +`<span class="fc-verdict fc-verdict--${rest?'rest':'ready'}">`
   +esc(rest?`あと ${rest}件`:'このまま完了できます')+`</span>`
   +`<button type="button" class="fc-alert-conf" id="fcAlertConf" aria-expanded="false"`
   +` title="公差外・基準外が出たときの強調のしかた（縁・面・色）を変えます">強調</button></div>`
   +`<ul class="fc-list">`+rows.map(r=>
     `<li class="fc-row fc-row--${r.state}" data-fc="${esc(r.key)}">`
     +`<span class="fc-name">${esc(r.name)}</span>`
     +`<span class="fc-value">${esc(r.value)}</span>`
     +(r.fix?`<button type="button" class="fc-fix" data-fc-fix="${esc(r.key)}">${esc(r.fix.label)}</button>`:'<span></span>')
     +`<span class="fc-detail">${esc(r.detail)}</span>`
     +(r.key==='ng'?ngButtonHtml(r):'')+`</li>`).join('')
   +`</ul><p class="fc-note">確認できたら、左の「測定を完了」を押してください。</p>`;
  applyAlert(box,bad);
  const conf=document.getElementById('fcAlertConf');
  if(conf)conf.onclick=()=>{if(alertPop)closeAlertPop();else openAlertPop(conf)};
  const ng=document.getElementById('fcNgBtn');
  if(ng)ng.onclick=()=>{registerNgOnce()};
  /* 描き直したら浮き窓は畳む——控えの持ち主が切り離された古いボタンに
     なると、押して閉じて即開き直すちらつきになる（§9.222 ①）。 */
  if(alertPop)closeAlertPop();
  syncNgTimer();
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
  /* 品質規格・品質情報は基本情報カードへ移した（§9.145）ので、③で開けるのは
     測定データ分析だけ。**gradeという面はもう無い。** */
  document.querySelectorAll('.measure-shell [data-leftpanel="analysis"]')
   .forEach(p=>setHidden(p,false));
 }

 /* 「いつもと同じ設定」の畳み込みは**操業データが持つ**（§9.216 ②）。
    以前はここに`USUAL_IDS=['unwind','widthOrder',...]`と**項目名を直に
    並べて**おり、群も畳む対象も設備で変えられなかった。いまは
    `操業データ項目マスタ`の`[群折りたたみ]`が決め、`measure-opdata.js`の
    `layout()`が見出しごと作る（畳んだままでも値は読める＝要約に現在値、
    という約束はそのまま持っている）。**同じ処理を2箇所に持たない。** */
 function paint(){
  const el=shell();if(!el)return;
  try{openInfoWall();openRecordWall()}catch(e){WL.quiet.note('畳んだ壁を開けられない（畳んだまま出る）',e)}
  /* 未測定の一覧は**同じ材料を1回だけ**引いて、状態の文字（`stepStates`）と
     段3の`title`の両方へ渡す（2度計算すると片方だけ直した状態が作れる）。 */
  let prog=null;
  try{if(measuring()&&typeof measureProgress==='function')prog=measureProgress()}catch(e){WL.quiet.note('進捗を数えられない（数字を出さないだけ）',e)}
  const states=stepStates(prog);
  const rest=prog?prog.unmeasured:null;
  STEP_KEYS.forEach(k=>{
   const btn=document.querySelector(`.mstep[data-mstep="${k}"]`);
   if(btn){
    btn.classList.toggle('is-current',k===current);
    if(k===current)btn.setAttribute('aria-current','step');else btn.removeAttribute('aria-current');
   }
   const st=document.getElementById('mstepState'+k);
   if(st)st.textContent=states[k]||'';
   /* 未測定の**項目名**は幅を1pxも使わずに読めるようにする（§9.234 ④）。
      件数は状態の文字（`残り N項目`）が出しているので、ここは名前だけ。 */
   if(btn&&k==='3'){
    const names=(rest&&rest.length)?'未測定: '+rest.map(x=>x.name).join('・'):'';
    if(names)btn.title=names;else btn.removeAttribute('title');
   }
  });
  fillContext();
  paintMaterialNote();
  try{fitLengthList()}catch(e){WL.quiet.note('丈の一覧の高さを合わせられない（既定の高さで出る）',e)}
  try{fitControlWidths()}catch(e){WL.quiet.note('欄の幅を測り直せない（前の幅のまま出る）',e)}
  /* 測定表が器へ入るかは段の切り替えでも変わる（§9.209 ③⑤）。 */
  requestAnimationFrame(()=>{try{WL.measureFit&&WL.measureFit.matrix()}catch(e){WL.quiet.note('測定表の割り付けを測り直せない（前の寸法のまま出る）',e)}});
  try{paintFinish()}catch(e){WL.quiet.note('確認の段を塗り直せない（次の描き直しで追いつく）',e)}
 }

 /* 母材の手入力の案内（§9.233 ③）。**文言はここ1箇所**——帯から母材の
    カードへ移しただけで、同じことを2通りに書かない。 */
 const MATERIAL_NOTE={text:'母材・丈は手入力です',
   title:'母材と丈（揃い/肉厚/長さ）は手入力の項目です。測定器から受けるには入力内容を切り替えてください。'};
 function paintMaterialNote(){
  const el=document.getElementById('materialManualNote');
  if(!el)return;
  const type=document.querySelector('#measureType')?.value||'';
  const on=!!(measuring()&&WL.measureItem.isMaterial(type));
  el.hidden=!on;
  if(!on)return;
  el.textContent=MATERIAL_NOTE.text;
  el.title=MATERIAL_NOTE.title;
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
  }else if(el.type==='number'||el.classList.contains('numeric-input')){
   /* 数値欄は`type=text`で持つことがある（§9.208 ③。`.5`の省略打ちを
      受けるため）。**印で見分ける**——`type`だけを見ると自由記述と同じ
      「日本語8文字」で見積もり、1桁の欄まで太る。 */
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
  /* プルダウンの矢印・一覧のスクロールバーのぶん。
     日時欄は**カレンダーの絵の幅も要る**（§9.157）——`2px`しか足して
     いなかったため11emへ丸められ、実機で**秒が切れて読めなかった**
     （`step="1"`なので秒まで出る。「作業時刻の表示が入りきれていません」）。
     文字の幅は表示している書式によっても変わる（`2026/08/14 15:04:05`と
     `08/14/2026, 15:04:05`）ので、絵のぶんは多めに見る。 */
  const extra=el.tagName==='SELECT'?(el.size>1?20:26)
    :(el.type==='datetime-local'?28:2);
  return w+pad+extra;
 }
 /* 群＝「縦に並べて読むひとかたまり」。①準備の見出し（誰が測るか／測定表の
    形／使う機材／その他）と、パネルごとの入力欄がそれにあたる。 */
 const W_GROUPS=[
  ['who',   ['inspector','crewSize']],
  ['shape', ['verticalCount','horizontalCount']],
  ['gear',  ['innerDiameter','spool','thicknessGauge','widthGauge']],
  /* 条入力順・方向は②の入力内容カードへ移した（§9.216 ③）ので、
     「いつもと同じ設定」とは並ばない——別の群として測る。 */
  ['usual', ['unwind','burr','coilStop']],
  ['strip', ['widthOrder','widthDirection']],
  /* オペレータと丈位置は**別の群**。どちらも`size`付きの一覧だが、
     一緒に並ぶことが無い（オペレータは①、丈位置は②）ので、そろえる意味が
     無い。まとめると人名の長さ（実データで171人）が丈位置にも効いてしまい、
     「1(頭)」しか入らない欄が154pxになる。 */
  ['op',    ['operator']],
  ['len',   ['lengthPos']],
  ['tol',   ['toleranceSource']],
  /* 図の横軸・表示幅の欄は**無くなった**（§9.210 ①）。浮き窓の中の
     ボタンになったので、器の幅を測って合わせる相手が居ない。 */
  ['time',  ['workStartAt','workEndAt']],
 ];
 /* 測り直すのは**選択肢か文字サイズが変わったときだけ**。オペレータは
    実データで171件あり、毎回測ると入力のたびに171回の計測が走る。
    署名は群ごとに持つ（1つでも変わったら群ごと測り直す）。 */
 const fitSig=new WeakMap();
 const groupSig={};
 /* **マスタが幅を決めている欄は測らない**（§9.218 ②）。器いっぱいに使うと
    決めた欄へ`max-width`を入れると、器より狭いまま余白が残る——利用者の
    指摘（「余白は無いようにUI幅で稼いでほしい」）と正面からぶつかる。
    判定は`data-opfill`の1箇所で、`measure-opdata.js`が割り付けるときに付ける。 */
 const opFilled=el=>!!(el&&el.closest&&el.closest('[data-opfill]'));
 function fitEls(key,els){
  els=(els||[]).filter(x=>x&&!x.disabled&&!opFilled(x));
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
 function fitGroup(key,ids){fitEls(key,ids.map(sel))}
 /* 操業データの自由項目は**マスタが決めるので名前を書けない**（§9.216 ②）。
    群（`data-opgroup`）でまとめて、群の中は最大へそろえる（§9.131）。
    **測らないと`alignColumnWidths()`が列の最大へ引き上げる**——CSSの
    受け皿(`--w-md`=154px)しか持たない欄が同じ列に並ぶと、1〜2桁の数値まで
    154pxになる（実測でそうなった）。 */
 function fitOpFields(){
  const map=new Map();
  document.querySelectorAll('.selectors>label[data-opfield]').forEach(l=>{
   const el=l.querySelector('select,input');
   if(!el)return;
   const k='op:'+(l.dataset.opplace||'')+':'+(l.dataset.opgroup||'');
   if(!map.has(k))map.set(k,[]);
   map.get(k).push(el);
  });
  map.forEach((els,k)=>fitEls(k,els));
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
    if(opFilled(el))return;              /* 器いっぱいに使う欄（§9.218 ②） */
    const b=el.getBoundingClientRect();
    if(b.width<8)return;
    const cs=getComputedStyle(el);
    const fs=parseFloat(cs.fontSize)||14;
    const em=cs.maxWidth==='none'?Infinity:parseFloat(cs.maxWidth)/fs;
    /* **そろえるのは「同じ群の同じ列」**（§9.216 ②で§9.142を絞った）。
       以前はカードの中の列だけを見ていたが、操業データのカードが横3マスに
       広がって1トラック200pxになると、**オペレータ（171人＝11em）と同じ列に
       いるだけで1〜2桁の縦割数まで154pxになる**（実測。以前は器が124pxしか
       無く、トラックが上限を兼ねて偶然収まっていた）。
       群は意味のまとまりであると同時に、**マスタが決める並びでは行の
       まとまりでもある**ので、群の中でそろえれば左端も右端もそろう。 */
    const g=el.closest('[data-opgroup]');
    const key=(g?g.dataset.opgroup:'')+'|'+Math.round(b.left);
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
  fitOpFields();
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
 const READ_TEXT=[['qualityInfo',20]];
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
 /* 判定公差は**いま判定している場所の隣**に置く（§9.146）。②は測定カードの
    中（表の上）、③は測定データ分析カードの中。①には出さない（通常は製造公差
    のままで触らないので、準備の主要導線に置くほどのものではない）。
    ②と③は同時に出ないので器を2つ用意し、**中身の1つを行き来させる**
    ——同じidを2つ置けないため。**動かしてよいのはこの塊だけ**で、受信欄
    (`#deviceInput`)は絶対に動かさない（§9.122）。 */
 function placeToleranceBlock(step){
  const box=document.querySelector('.tol-block');
  const host=document.getElementById(step==='3'?'tolSlot3':'tolSlot2');
  if(box&&host&&box.parentElement!==host)host.appendChild(box);
 }
 function go(step){
  step=String(step);
  if(STEP_KEYS.indexOf(step)<0)return;
  const el=shell();if(!el)return;
  current=step;
  STEP_KEYS.forEach(k=>el.classList.toggle('mstep-'+k,k===step));
  placeToleranceBlock(step);
  /* ③の「記録した値」は**入るたびに作り直す**——①で設定を直してから戻って
     くることがあるので、開いた時点の値でなければ確認の意味が無い。 */
  if(step==='3'&&measuring())renderRecordedValues();
  /* ③は確認の面なので**効いている公差を全部並べる**（§9.157）。②は
     いま測っている1項目だけでよい（判定しているのがそれだから）。 */
  if(measuring()&&WL.toleranceList)WL.toleranceList.paint();
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
   requestAnimationFrame(()=>{try{fitControlWidths()}catch(e){WL.quiet.note('欄の幅を測り直せない（前の幅のまま出る）',e)}
     try{WL.measureFit&&WL.measureFit.matrix()}catch(e){WL.quiet.note('測定表の割り付けを測り直せない（前の寸法のまま出る）',e)}});
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
  new MutationObserver(()=>{try{openInfoWall()}catch(e){WL.quiet.note('畳んだ壁を開けられない（畳んだまま出る）',e)}})
   .observe(pane,{attributes:true,attributeFilter:['hidden'],subtree:true});
 }

 function watchWorkTabs(){
  document.querySelectorAll('[data-worktab]').forEach(b=>{
   b.addEventListener('click',()=>{
    requestAnimationFrame(()=>{try{fitControlWidths()}catch(e){WL.quiet.note('欄の幅を測り直せない（前の幅のまま出る）',e)}});
   });
  });
 }

 /* 測定画面を開いたら①から始める。**次にすることが1つに決まる。** */
 function reset(){
  current='1';
  const el=shell();if(el)el.classList.remove('mstep-2','mstep-3');
  go('1');
 }

 /* 幅の測り直しは**外からも呼べるようにする**（§9.216 ②）。操業データの
    割り付け（`WL.opData.layout()`）が入力欄を作り替えたあと、群を畳んだ
    あとに測り直す必要がある——素の`fitControlWidths()`はこのIIFEの中の
    関数なので、外から呼ぶと`ReferenceError`になって**黙って測られない**
    （try/catchで握り潰されるので気づけない。§CLAUDE「公開漏れは黙って
    素通しになる」）。 */
 WL.measureSteps={go,current:()=>current,refresh:paint,reset,
                  /* 入力内容を切り替えたときも書き直す（§9.233 ③）
                     ——段は変わらないので`paint()`は走らない。 */
                  materialNote:paintMaterialNote,
                  fitWidths:()=>{try{fitControlWidths()}catch(e){console.warn('幅の測り直しに失敗',e)}}};

 /* ---------- 入力内容・丈位置のキーボード操作は持たない（§9.160） ----------
    以前は `→ ←`（項目）・`PageUp/PageDown`（丈位置）・`F2`（次の未測定へ）を
    受信欄とセルの両方で受けていた（§9.124）。**実機では効かなかった**——
    測定器からの転送は極めて短い間隔でキーを送り続けるため、こちらが
    項目や丈位置を変えると測定表が描き直され、その拍子に受信欄からフォーカスが
    外れる。戻すのは`requestAnimationFrame`2回ぶん後になるので、そのあいだに
    届いた転送は行き場を失う。**自動入力が優先**で、キーボードで無理に
    巡回させる必要も無いので、案内（`.mnav-hint`）ごと削除した。
    **戻さないこと**——戻すなら「転送中はキーを受けない」という条件を先に
    決める必要がある（項目の切り替えと転送は同じ欄で起きる）。
    `sel`だけは`fitGroup`/`fitTextBox`が使うので残す。 */
 const sel=id=>document.getElementById(id);
 /* ③の確認表の「直す」だけが使う。**連れて行った先で打てること**が要件で、
    キーボードでの巡回（§9.124で入れ、§9.160で撤回）とは別の話——項目と丈位置を
    こちらから変えた直後は測定表が描き直され、その拍子にフォーカスが落ちる。
    どこへ置くかは項目の性質で変わる: 転送の項目（板厚・板幅・バリ）は受信欄、
    手動の項目はセル、手入力の面（母材・丈）は触らない。
    **描き直しが終わってから置く**——項目を変えた直後の受信欄は高さ0で、
    寸法ゼロの要素はフォーカスを保持できないので、その瞬間の`focus()`は効かない
    （`requestAnimationFrame`2回でレイアウトの確定を待つ）。
    `readOnly`は**属性でなくプロパティ**なので`:not([readonly])`は当たらない。 */
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
   const cell=[...document.querySelectorAll('#measurementGrid input.current')]
     .find(x=>!x.readOnly&&!x.disabled);
   if(cell&&document.activeElement!==cell)cell.focus();
  }));
 }

 /* ---------- いつ描き直すか ----------
    **文脈バーは「常に正しい」ことが値打ち**なので、中身が変わる経路を
    ぜんぶ拾う。1つでも漏らすと、古い値を見せたまま平然と並ぶ——
    空欄より悪い（利用者は正しいものとして読む）。 */

 /* ① 進捗が動いたとき。**項目の一覧が書き換わったのを見る**（§9.147で
    ヘッダーの進捗バーを廃止したので、見る先を`#measureTypeChips`へ移した。
    どちらも`refreshMeasureProgress()`が書き換える同じ出力）。
    `window.refreshMeasureProgress` をラップする手もあるが、そちらは
    グローバル関数の差し替えを1件増やす（§9.96の見張りが数えている）。
    出力そのものを見れば、呼び出し口を知らなくても取りこぼさない。
    paintが書くのは段の状態と文脈バーで、この器の外なので回り続けない。
    **コメントに閉じ記号を含む書き方をしないこと**——ここで一度、
    ワイルドカード付きの例示がコメントを途中で閉じ、ファイル全体が
    構文エラーになった（CSSで既知の罠と同じものをJSでやった）。 */
 function watchProgress(){
  const head=document.getElementById('measureTypeChips');
  if(!head){console.error('measure-steps: #measureTypeChips が無い（進捗の追随が止まる）');return}
  new MutationObserver(()=>{try{paint()}catch(e){WL.quiet.note('段の見出しを塗り直せない（次の描き直しで追いつく）',e)}})
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
   if(el)el.addEventListener('change',()=>{try{paint()}catch(e){WL.quiet.note('段の見出しを塗り直せない（次の描き直しで追いつく）',e)}});
  });
 }

 WL.onReady(()=>{
  bind();bindChoiceUsage();watchModal();watchInputs();watchProgress();watchWorkTabs();
  watchUiSize();watchInfoWall();
  const el=shell();if(el&&!el.classList.contains('mstep-1'))el.classList.add('mstep-1');
  paint();
 });
})();
