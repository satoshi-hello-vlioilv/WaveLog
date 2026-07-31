"use strict";
/* measurement-input.js: 測定値の入力系 — 測定器受信(deviceInput)・手入力・
   入力位置管理(focusCurrent)・測定グリッド描画・公差計算(toleranceDetail)。 */
function nums(a){return a.flat().map(Number).filter(Number.isFinite).filter(x=>x!==0)}function stat(a){const n=nums(a);if(!n.length)return['','','','',0];const av=n.reduce((x,y)=>x+y,0)/n.length,sd=Math.sqrt(n.reduce((x,y)=>x+(y-av)**2,0)/n.length);return[Math.min(...n),av,Math.max(...n),sd*3,n.length]}
function renderStats(){const types=[['板厚','thickness',3],['板幅','width',2],['バリ','burr',3],['ラテラルボー','lateral',1],['巻きずれ','offset',1],['テレスコープ','telescope',1]];$('#stats').innerHTML=types.map(([l,k,d])=>{const s=stat(S.measure.measurements[k]);return `<tr><th>${l}</th>${s.slice(0,4).map(v=>`<td>${v===''?'':Number(v).toFixed(d)}</td>`).join('')}<td>${s[4]}</td></tr>`}).join('')}
function deviceParse(raw){const manual=S.measure?.settings?.inputMode==='manual',v=(manual?String(raw||''):toHalfWidth(String(raw||''))).trim().toUpperCase();if(v==='#DELETEMODE#'||v==='DELETE')return{device:'delete',value:null};if(v.includes('+#L')){const num=Number(v.split('+#L')[1]);return{device:'tape',value:Number.isFinite(num)?num:null}}if(!v.includes('+'))return Number.isFinite(Number(v))?{device:'manual',value:Number(v)}:{device:'invalid',value:null};const [code,data]=v.split('+');let device='invalid';if(code.startsWith('DT1')){const kind=code.slice(-2,-1);device=kind==='0'?'micrometer':kind==='1'?'caliper':kind==='2'?'depth':'invalid'}const num=Number(String(data).replace(/M$/,''));return{device,value:Number.isFinite(num)?num:null}}
function activeMeasureKey(){return({母材:'mother', '板厚/板幅':'width',ラテラルボー:'lateral',バリ:'burr',テレスコープ:'telescope',巻ずれ:'offset',フラットネス:'flatness'})[$('#measureType').value]||'width'}
/* 公差NGの先読み警告: 受信欄(#deviceInput)へ転送中の生データを、確定(Tab/Enter)
   前の時点でその都度deviceParseし、どの項目(kind)へ入るかを判定できれば
   数直線(#numberlinePending)へ即座にプレビュー表示する。実際に書き込みは
   せず読み取りのみのため、転送中はvalueへ一切手を入れないという既存の
   制約(processDeviceInputCore側の注記参照)には影響しない。 */
function numberlinePendingKind(raw){
 const type=$('#measureType')?.value,p=deviceParse(raw);
 if(!p||p.device==='invalid'||p.device==='delete'||p.value===null)return null;
 if(type==='板厚/板幅')return['caliper','tape','manual'].includes(p.device)?'width':null;
 if(type==='バリ')return['micrometer','manual'].includes(p.device)?'burr':null;
 if(type==='テレスコープ')return['depth','manual'].includes(p.device)?'telescope':null;
 const key=activeMeasureKey();
 return(key==='mother'||key==='flatness')?null:key;
}
function updateNumberlinePending(raw){
 const marker=$('#numberlinePending');if(!marker)return;
 if(!S.measure||S.measure.settings?.inputMode==='manual'||!raw){marker.hidden=true;return}
 const kind=numberlinePendingKind(raw);
 if(!kind){marker.hidden=true;return}
 const facts=typeof compactToleranceFacts==='function'?compactToleranceFacts(kind):null,range=facts&&facts.range;
 if(!range){marker.hidden=true;return}
 const v=deviceParse(raw).value,low=range[0],high=range[1],span=Math.max(high-low,.000001),viewLow=low-span*.25,viewHigh=high+span*.25;
 const pos=Math.max(3,Math.min(97,(viewHigh-v)/(viewHigh-viewLow)*100)),ng=v<low||v>high;
 marker.hidden=false;marker.className='numberline-pending'+(ng?' ng':' ok');marker.style.top=pos+'%';
}
/* 板厚/板幅は測定器の種別(マイクロメータ/ノギス等)でデータが自動的に
   板厚・板幅へ振り分けられるため、どちらを先に測っても問題ない設計。
   このため次の入力先を1箇所だけに絞らず、板厚・板幅それぞれの次入力
   セルを同時に(合計2箇所)強調表示する。それ以外の測定種は従来通り
   1箇所のみ強調する。 */
function focusCurrent(){
 document.querySelectorAll('[data-mkey]').forEach(x=>x.classList.remove('current'));
 const m=S.measure.settings,key=activeMeasureKey();
 if(key==='width'){
  const tEl=document.querySelector(`[data-mkey="thickness"][data-j="${m.tStep||0}"]`);
  const wEl=document.querySelector(`[data-mkey="width"][data-i="${lengthIndex()}"][data-j="${m.wStep||0}"]`);
  if(tEl)tEl.classList.add('current');
  if(wEl)wEl.classList.add('current');
  (m.pendingDevice==='micrometer'?tEl:wEl)?.scrollIntoView({block:'nearest',inline:'nearest'});
  $('#stepStatus').textContent=`入力位置 板厚 ${(m.tStep||0)+1} ／ 板幅 丈 ${lengthIndex()+1} 条 ${(m.wStep||0)+1}`;
  return;
 }
 const el=document.querySelector(`[data-mkey="${key}"][data-i="${lengthIndex()}"][data-j="${m.wStep||0}"]`);
 if(el){el.classList.add('current');el.scrollIntoView({block:'nearest',inline:'nearest'})}
 $('#stepStatus').textContent=`入力位置 丈 ${lengthIndex()+1} / 条 ${(m.wStep||0)+1}`;
}
function advanceWidth(){const m=S.measure.settings,max=Math.max(1,+$('#horizontalCount').value||1),seq=widthSequence(max,$('#widthOrder').value,$('#widthDirection').value),pos=seq.indexOf(m.wStep||0);m.wStep=seq[(pos+1)%seq.length]}
/* 自動転送モードでは、DOM再描画(renderMeasureGrid)の前後で万一
   フォーカスがずれても必ず受信欄へ戻す。手動入力モードでは
   セル側にフォーカスを残す仕様のため対象外。 */
/* 実際にフォーカスが外れている時だけ.focus()を呼ぶ。多条(セル数が多く
   scrollIntoViewを伴う再描画)の連続入力中は通常フォーカスは外れて
   いないため、ここで無条件にfocus()すると再描画のタイミングと重なり、
   次の転送データの受信に影響することがあった(1.5.0で多条の連続入力が
   崩れた不具合の原因)。既にフォーカスがある場合は何もしない。 */
/* value=''でのクリアは、IME変換セッションが内部的に残ったまま(compositionend
   が発火しないまま)になることがあり、次の転送データがその残存セッションへ
   連結されて文字列が二重化する不具合が実機で確認された(例:
   "DT10011＋００００００２６．１５MDT10011＋００００００２６．１５")。
   compositionstart/endだけを監視して開いたままかどうかを判定し、開いている
   場合だけblur→focusでIME変換セッションを明示的に終了させる。通常の
   ASCII転送や、正しくcompositionendまで完了した場合は一切何もしないため、
   1.5.0で起きた「無条件focus()が多条の連続入力を崩す」問題は再発しない。 */
let deviceCompositionOpen=false;
function refocusDeviceInput(){
 if(S.measure?.settings?.inputMode==='manual')return;
 const el=$('#deviceInput');
 if(deviceCompositionOpen){el.blur();deviceCompositionOpen=false}
 if(document.activeElement!==el)el.focus();
}
/* 受信データ1件分の本処理。measureTypeごとの振り分け・値の確定・再描画。 */
function processDeviceInputCore(raw){
 const p=deviceParse(raw),m=S.measure,st=m.settings,type=$('#measureType').value,li=lengthIndex();$('#deviceInput').classList.remove('device-ok','device-error');if(p.device==='invalid'||p.value===null&&p.device!=='delete'){setState('入力形式エラー');$('#deviceInput').classList.add('device-error');$('#deviceInput').value='';refocusDeviceInput();return}if(p.device==='delete'){const key=activeMeasureKey();if(key==='width'&&st.pendingDevice==='micrometer')m.measurements.thickness[li][st.tStep||0]='';else m.measurements[key][li][st.wStep||0]='';renderMeasureGrid();markDirty();refocusDeviceInput();return}
 if(type==='板厚/板幅'){
  if(p.device==='micrometer'){const j=st.tStep||0;m.measurements.thickness[li][j]=p.value.toFixed(3);st.tStep=(j+1)%3;st.pendingDevice='micrometer'}
  else if(['caliper','tape','manual'].includes(p.device)){const j=st.wStep||0;m.measurements.width[li][j]=p.value.toFixed(p.device==='caliper'?2:1);st.pendingDevice='width';advanceWidth()}
  else return inputError('板厚はマイクロメータ、板幅はノギスまたはコンベックスを使用してください')
 }else if(type==='バリ'){
  if(!['micrometer','manual'].includes(p.device))return inputError('バリはマイクロメータを使用してください');const j=st.wStep||0;if(st.burrFirst===null||st.burrFirst===undefined){st.burrFirst=p.value;setState(`STEP 2/2 バリ高さを測定してください。基準 ${p.value}`)}else{const diff=p.value-st.burrFirst;if(diff<0)return inputError('測定値がマイナスになります。DELETEして再測定してください');m.measurements.burr[li][j]=Math.abs(diff).toFixed(3);st.burrFirst=null;advanceWidth();setState('STEP 1/2 バリ測定対象の板厚を測定してください')}
 }else if(type==='テレスコープ'){
  if(!['depth','manual'].includes(p.device))return inputError('テレスコープはデプスゲージを使用してください');m.measurements.telescope[li][st.wStep||0]=p.value.toFixed(2);advanceWidth()
 }else{const key=activeMeasureKey();m.measurements[key][li][st.wStep||0]=type==='ラテラルボー'?(Math.ceil(p.value*2)/2).toFixed(1):p.value.toFixed(1);advanceWidth()}
 $('#deviceInput').classList.add('device-ok');$('#deviceInput').value='';renderMeasureGrid();renderStats();markDirty();focusCurrent();refocusDeviceInput()
}
/* 受信処理の入口。板厚/板幅のノギス系値は小数1桁へ丸めてから本処理へ渡し、
   処理後は診断用に直前受信の生データと結果を#deviceLastReceivedへ記録する。 */
function processDeviceInput(raw){
 const pad2=n=>String(n).padStart(2,'0'),d=new Date(),ts=`${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
 const type=$('#measureType')?.value,parsed=deviceParse(raw);
 let result;
 if(type==='板厚/板幅'&&parsed.value!==null&&Number.isFinite(parsed.value)&&['caliper','tape','manual'].includes(parsed.device)){
  const normalized={...parsed,value:Number(parsed.value.toFixed(1))};const original=deviceParse;deviceParse=()=>normalized;
  try{result=processDeviceInputCore(raw)}finally{deviceParse=original}
 }else result=processDeviceInputCore(raw);
 const el=$('#deviceInput'),out=$('#deviceLastReceived');
 if(out){const ok=el?.classList.contains('device-ok'),ng=el?.classList.contains('device-error');const label=ok?'OK':ng?'NG':'-';out.textContent=`直前受信 ${ts} [${label}]: ${raw||'(空)'}`;out.classList.toggle('ng',!!ng)}
 return result;
}
function inputError(msg){setState(msg);const el=$('#deviceInput');el.classList.add('device-error');el.value='';refocusDeviceInput()}
/* VER1.9.0で「常に受信中の見た目」に固定したところ、実際にはDOMフォーカスが
   当たっておらず自動入力が機能しないのに画面上は正常に見える不具合が
   発生した(クリックすると初めて動く=フォーカスが本当の原因)。表示は
   実際のフォーカス状態を正直に反映する元の仕様へ戻し、代わりに下の
   ウォッチドッグでフォーカス消失を安全に自動回復させる。 */
function updateReceiveState(focused=document.activeElement===$('#deviceInput')){if(!S.measure)return;const manual=S.measure.settings.inputMode==='manual',box=$('#inputStatusBox'),inp=$('#deviceInput');box.classList.remove('receiving','manual-state','not-ready-state');inp.classList.remove('manual-receive','locked-receive');if(manual){box.classList.add('manual-state');inp.classList.add('manual-receive');$('#inputReady').textContent='手動入力モード';$('#inputModeHelp').textContent='直接入力・Enterで確定';$('#receiveLock').textContent='手入力許可';inp.placeholder='必要に応じて数値を入力'}else if(focused){box.classList.add('receiving');$('#inputReady').textContent='伝送入力受付中';$('#inputModeHelp').textContent='転送待ち・Tabで確定';$('#receiveLock').textContent='転送専用';inp.placeholder='測定器データ受信専用'}else{box.classList.add('not-ready-state');inp.classList.add('locked-receive');$('#inputReady').textContent='伝送入力停止中';$('#inputModeHelp').textContent='クリックで受付再開';$('#receiveLock').textContent='受付停止';inp.placeholder='クリックして伝送受付を再開'}}$('#deviceInput').onfocus=()=>updateReceiveState(true);$('#deviceInput').onblur=()=>updateReceiveState(false);
/* フォーカス消失の自動回復ウォッチドッグ。手動入力欄の操作中(select/input/
   textarea/ボタン等、何らかのフォーム要素にフォーカスがある場合)は絶対に
   奪わない。document.activeElementが何もフォーカスしていない状態(body、
   またはbodyの直接の非フォーム要素)に落ちている時だけ、自動転送専用の
   受信欄へフォーカスを戻す。多条の連続入力中に不要な奪取をしないよう、
   既にdeviceInputにフォーカスがある場合は何もしない。 */
setInterval(()=>{
 if(!S.measure||S.measure.settings.inputMode==='manual')return;
 const modal=$('#measureModal');if(!modal||modal.hidden)return;
 const box=$('#inputStatusBox');if(!box||box.hidden)return;
 const el=$('#deviceInput');if(!el||document.activeElement===el)return;
 const active=document.activeElement;
 const isFormControl=active&&active!==document.body&&/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(active.tagName||'');
 if(isFormControl)return;
 el.focus();
},600);
/* 受信欄は自動モードでは視覚的に隠しているため、万一フォーカスが外れても
   ユーザーが直接クリックし直す手段がなくなる。「自動モード」バッジ側を
   クリックしたら受信欄へフォーカスを戻す安全弁を用意しておく。 */
$('#inputStatusBox').addEventListener('click',e=>{if(e.target.closest('#deviceInput'))return;if(S.measure?.settings?.inputMode!=='manual')$('#deviceInput').focus()});
/* 転送中にリアルタイムでvalueを書き換えると、測定器側ソフトが行う
   「全選択してから打ち直す」といった自前のバッファ管理と衝突し、
   文字列が置き換わらず連結・重複してしまう不具合が確認されたため、
   受信中はvalueへ一切手を入れない。半角変換はTab確定時に
   deviceParse側で1回だけ行う。 */
let deviceAutoCommitTimer=null,deviceKeyDetectCount=0;
/* IME変換セッションの開閉だけを監視(valueには一切触れない)。
   refocusDeviceInput()が、compositionendが来ないまま次の転送を
   迎えそうな場合にだけblur→focusで強制終了させるために使う。 */
$('#deviceInput').addEventListener('compositionstart',()=>{deviceCompositionOpen=true});
$('#deviceInput').addEventListener('compositionend',()=>{deviceCompositionOpen=false});
/* IME変換中はキー1つ1つがinsertCompositionTextとして届くため、
   これを入り口でブロックすると全角記号だけでなく通常の数字まで
   一切valueに入らなくなり、転送データそのものが受信できなくなる
   (受信欄は空のままTabだけが来て、上書きが起きない不具合)。
   このためbeforeinputでの遮断はやめ、全角/半角の統一はこれまで
   通りTab確定時にdeviceParse側で1回だけ行う方式に一本化する。 */
/* IME変換が起きている端末では、確定用のTabキー自体がIMEに横取りされ
   keydownまでイベントが届かないことがあり、Tab検知に頼るだけでは
   確定できないケースがある。そのため自動転送モードでは、入力が
   一定時間(既定220ms)止まったら「送信完了」とみなし、Tab検知を
   待たずに自動で確定処理へ回すフォールバックを備える(Tabが正しく
   届いた場合はrequestAnimationFrameの方が先に処理するため、通常時の
   挙動はTab確定のまま変わらない)。 */
$('#deviceInput').oninput=()=>{
 if(S.measure?.settings?.inputMode==='manual')return;
 clearTimeout(deviceAutoCommitTimer);
 const inp=$('#deviceInput');
 updateNumberlinePending(inp.value);
 deviceAutoCommitTimer=setTimeout(()=>{if(inp&&inp.value.trim())processDeviceInput(inp.value)},220);
};
$('#deviceInput').onkeydown=e=>{
 /* 測定器からの転送はキー入力を極めて短い間隔で連続送信するため、
    途中で偶然Ctrl/Alt等の修飾キーが混じるとブラウザの検索(Ctrl+F)等の
    既定ショートカットが割り込み、フォーカスが奪われて最後のTabまで
    受信できなくなることがある。受信欄では修飾キー付きの入力を
    すべて無効化し、ブラウザ側へ渡さないようにする。 */
 if(e.ctrlKey||e.metaKey||e.altKey){e.preventDefault();return}
 const auto=S.measure?.settings?.inputMode!=='manual',accept=(auto&&e.key==='Tab')||(!auto&&e.key==='Enter');
 if(accept){
  e.preventDefault();clearTimeout(deviceAutoCommitTimer);const target=e.target;
  /* Tab/Enterのkeydownを実際に検知できたことが目視で分かるよう、
     内容が空でも枠を一瞬光らせ、検知回数カウンタを進める
     (検知そのものが働いているかを現場で確認するための表示)。 */
  target.classList.add('device-detect');setTimeout(()=>target.classList.remove('device-detect'),250);
  deviceKeyDetectCount++;const counter=$('#deviceKeyCount');if(counter)counter.textContent=`検知 ${deviceKeyDetectCount}回`;
  requestAnimationFrame(()=>{if(target.value.trim())processDeviceInput(target.value)})
 }
 else if((e.key==='Delete'||e.key==='Backspace')&&!e.target.value){e.preventDefault();processDeviceInput('#DeleteMode#')}
 else if(e.key==='ArrowDown'||(e.key==='Enter'&&!e.target.value)){e.preventDefault();advanceWidth();focusCurrent()}
 else if(e.key==='ArrowUp'){e.preventDefault();const seq=widthSequence(Math.max(1,+$('#horizontalCount').value||1),$('#widthOrder').value,$('#widthDirection').value),pos=seq.indexOf(S.measure.settings.wStep||0);S.measure.settings.wStep=seq[(pos-1+seq.length)%seq.length];focusCurrent()}
};
$('#lengthPos').onchange=()=>{renderMeasureGrid();$('#deviceInput').focus()};
$('#widthOrder').onchange=focusCurrent;$('#widthDirection').onchange=focusCurrent;
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-mode]').forEach(x=>x.classList.remove('active'));b.classList.add('active');S.measure.settings.inputMode=b.dataset.mode;$('#deviceInput').readOnly=false;applyInputProtection();$('#deviceInput').focus();updateReceiveState(true);setState(b.dataset.mode==='auto'?'自動転送: Tabで受信':'手動入力: Enterで確定')});
/* 測定値セルの生成。板厚=3桁/板幅=1桁へ表示時に整形する。 */
function makeMeasureInput(key,i,j,value){value=fixedMeasurementValue(key,value);const mode=key==='flatness'?'text':'decimal';return `<input data-mkey="${key}" data-i="${i}" data-j="${j}" value="${esc(value)}" inputmode="${mode}" aria-label="${j+1}条">`}
function bindMeasureInputs(){
 const m=S.measure;
 const syncStepFor=x=>{if(x.dataset.mkey==='thickness')m.settings.tStep=+x.dataset.j;else m.settings.wStep=+x.dataset.j};
 document.querySelectorAll('[data-mkey]').forEach(x=>{judgeInput(x,x.dataset.mkey,Number(x.value),+x.dataset.j);x.onclick=()=>{syncStepFor(x);focusCurrent();if(S.measure.settings.inputMode!=='manual')$('#deviceInput').focus()};
  // 手動モードでは、クリックだけでなくTabキー等の操作で実際に
  // フォーカスが移動した場合も、強調表示(.current)をそのセルへ
  // 追従させる(自動モードは受信欄にフォーカスを固定するため対象外)。
  x.addEventListener('focus',()=>{if(S.measure.settings.inputMode!=='manual')return;syncStepFor(x);focusCurrent()});
  x.oninput=()=>{m.measurements[x.dataset.mkey][+x.dataset.i][+x.dataset.j]=x.value;judgeInput(x,x.dataset.mkey,Number(x.value),+x.dataset.j);renderStats();markDirty()};x.onkeydown=e=>{if(S.measure.settings.inputMode!=='manual'){e.preventDefault();return}if(e.key==='Delete'){x.value='';x.oninput()}if(e.key==='Enter'){e.preventDefault();advanceWidth();focusCurrent()}}})

 document.querySelectorAll('[data-mkey="thickness"],[data-mkey="width"]').forEach(el=>{
  const previousBlur=el.onblur;
  el.onblur=event=>{if(previousBlur)previousBlur.call(el,event);const formatted=fixedMeasurementValue(el.dataset.mkey,el.value);if(el.value!==formatted){el.value=formatted;S.measure.measurements[el.dataset.mkey][+el.dataset.i][+el.dataset.j]=formatted;judgeInput(el,el.dataset.mkey,Number(formatted),+el.dataset.j);renderStats();markDirty()}}
 });
}
function toleranceInfoFor(key,index,value){
 if(key==='flatness'){const v=String(value||'').trim();return v===''?{tol:null,state:'wait',pos:50}:{tol:null,state:v==='〇'?'ok':'ng',pos:50}}
 const tol=toleranceFor(key==='thickness'?'thickness':'width',index),num=Number(value);if(!tol||!Number.isFinite(num))return{tol,state:'wait',pos:50};const low=tol[0],high=tol[1],span=Math.max(Math.abs(high-low),.000001),viewLow=low-span*.25,viewHigh=high+span*.25,pos=Math.max(0,Math.min(100,(viewHigh-num)/(viewHigh-viewLow)*100));return{tol,state:num<low||num>high?'ng':'ok',pos}}
function makeMeasureInputV29(key,i,j,value,active=true){const info=toleranceInfoFor(key,j,value),pill=active&&value!==''?`<span class="judge-pill ${info.state}">${info.state==='ok'?'OK':'NG'}</span>`:'';return `<div class="strip-input-wrap">${makeMeasureInput(key,i,j,value)}${pill}</div>`}
/* 入力欄の保護。自動転送中はセルを読み取り専用にする(母材・フラットネスは常時手入力可)。 */
function applyInputProtection(){
 if(!S.measure)return;const manual=S.measure.settings.inputMode==='manual';document.querySelectorAll('[data-mkey]').forEach(el=>{el.readOnly=!manual;el.classList.toggle('auto-locked',!manual);el.tabIndex=manual?0:-1;el.title=manual?'手入力可能':'自動転送中。クリックは入力位置の選択のみです。'});document.querySelectorAll('[data-mother]').forEach(el=>{el.readOnly=!manual;el.tabIndex=manual?0:-1})

 const mother=$('#measureType')?.value==='母材';
 if(mother)document.querySelectorAll('[data-mother]').forEach(el=>{el.readOnly=false;el.disabled=false;el.tabIndex=0;el.classList.remove('auto-locked');el.title='母材は手動入力できます'});
 /* フラットネスは測定器転送の対象外(〇/△/×または自由記述)のため、
    転送モードに関わらず常にセルへ直接入力できるようにする。 */
 if($('#measureType')?.value==='フラットネス')document.querySelectorAll('input[data-mkey="flatness"]').forEach(el=>{el.readOnly=false;el.tabIndex=0;el.classList.remove('auto-locked');el.title='記号(〇/△/×)または自由記述を入力できます'});
}
/* ---- 公差の解決 ----
   判定公差はセレクタ(製造/オーダー)と測定種(板厚板幅以外は指示公差)から決まる。
   フィールド名の全角半角ゆれはnormalizedFieldNameベースの照合で吸収する。 */
function configuredToleranceSource(){return S.measure?.settings?.toleranceSource||'manufacturing'}
function toleranceFieldValue(names){const r=S.measure?.source||S.measure?.snapshot?.source||{};for(const n of names){const v=r[n];if(v!==undefined&&v!==null&&String(v).trim()!==''){const num=Number(v);if(Number.isFinite(num))return num}}return NaN}
function fieldNumberByRule({prefixes=[],contains=[],sign}){
 const r=S.measure?.source||S.measure?.snapshot?.source||{},signWord=sign==='plus'?'プラス':'マイナス';
 for(const [key,value] of Object.entries(r)){
  const n=normalizedFieldName(key);
  if(prefixes.length&&!prefixes.some(x=>n.includes(normalizedFieldName(x))))continue;
  if(contains.length&&!contains.every(x=>n.includes(normalizedFieldName(x))))continue;
  if(!n.includes(signWord))continue;
  const num=Number(value);if(Number.isFinite(num))return{value:num,key};
 }
 return null;
}
function exactFieldNumber(names){const r=S.measure?.source||S.measure?.snapshot?.source||{};for(const requested of names){const rn=normalizedFieldName(requested);for(const [key,value] of Object.entries(r)){if(normalizedFieldName(key)===rn){const num=Number(value);if(Number.isFinite(num))return{value:num,key}}}}return null}
function instructedTolerance(kind,sign){
 const dimension=kind==='thickness'?'板厚':'板幅';
 return fieldNumberByRule({prefixes:['指示_'],contains:[dimension],sign})||fieldNumberByRule({prefixes:['指示_'],contains:[kind==='thickness'?'厚':'幅'],sign});
}
// Order tolerance can only be selected when all required order values exist.
function orderToleranceAvailability(){const t=toleranceDataForSource('thickness','order'),w=toleranceDataForSource('width','order');return{available:!!(t||w),thickness:!!t,width:!!w}}
function toleranceDataForSource(kind,source){
 const isT=kind==='thickness',dimension=isT?'板厚':'板幅',fields={manufacturing:{plus:[`${dimension}公差_製造_ﾌﾟﾗｽ`,`${dimension}公差_製造_プラス`,isT?'KOSAXSMP':'KOSAYSMP'],minus:[`${dimension}公差_製造_ﾏｲﾅｽ`,`${dimension}公差_製造_マイナス`,isT?'KOSAXSMM':'KOSAYSMM']},order:{plus:[`${dimension}公差_ｵｰﾀﾞｰ_ﾌﾟﾗｽ`,`${dimension}公差_オーダー_プラス`,isT?'KOSAXSOP':'KOSAYSOP'],minus:[`${dimension}公差_ｵｰﾀﾞｰ_ﾏｲﾅｽ`,`${dimension}公差_オーダー_マイナス`,isT?'KOSAXSOM':'KOSAYSOM']}};
 const p=exactFieldNumber(fields[source].plus),m=exactFieldNumber(fields[source].minus);
 const data=p&&m?{plus:p.value,minus:m.value,plusKey:p.key,minusKey:m.key}:null;
 if(source==='order'&&data&&(Number(data.plus)===0||Number(data.minus)===0))return null;
 return data;
}
function applyInstructionToleranceForOtherTargets(kind){const p=instructedTolerance(kind,'plus'),m=instructedTolerance(kind,'minus');return p&&m?{plus:p.value,minus:m.value,plusKey:p.key,minusKey:m.key}:null}
function toleranceDetail(kind,index=0){
 const type=$('#measureType')?.value||S.measure?.settings?.measureType||'',isDimensional=type==='板厚/板幅',b=S.measure.basic,base=Number(kind==='thickness'?b.mfgThickness:b.mfgWidth);
 let requested=configuredToleranceSource();if(!isDimensional)requested='instruction';let data=requested==='instruction'?applyInstructionToleranceForOtherTargets(kind):toleranceDataForSource(kind,requested),source=requested,fallback=false;
 if(!data&&requested!=='manufacturing'){source='manufacturing';fallback=true;data=toleranceDataForSource(kind,'manufacturing')}
 return data&&Number.isFinite(base)?{range:[base-data.minus,base+data.plus],source,fallback,...data}:null;
}
function toleranceFor(kind,index=0){return toleranceDetail(kind,index)?.range||null}
function compactMeasureStatus(done,total){return done===total?'測定完了':done?`測定中 ${done}/${total}`:'測定待ち'}
function renderMeasureGridVertical(){
 const type=$('#measureType').value,key=activeMeasureKey(),m=S.measure,li=lengthIndex(),count=Math.max(1,Math.min(40,+$('#horizontalCount').value||1));
 if(type!=='板厚/板幅'){
  const actualKey=key==='mother'?'width':key,values=m.measurements[actualKey][li],done=values.slice(0,count).filter(v=>v!=='').length;
  const bulkBtn=type==='フラットネス'?'<span class="flat-pick-group"><span class="flat-pick-label">現在の条へ入力</span><button type="button" class="flat-pick" data-sym="〇">〇</button><button type="button" class="flat-pick" data-sym="△">△</button><button type="button" class="flat-pick" data-sym="×">×</button></span><button type="button" id="flatAllOk">全条 〇</button>':'';
  let h=`<section class="measure-grid-block compact-other"><div class="measure-grid-block-title"><span>${esc(type)}</span><div class="measure-status-group"><span class="measure-status">${compactMeasureStatus(done,count)}</span>${bulkBtn}</div></div><div class="compact-width-body"><aside class="compact-tolerance-side">${compactToleranceScale(actualKey,values,count)}</aside><div class="strip-layout compact-strip-layout">`;
  for(let col=0;col<2;col++){h+='<div class="strip-column"><div class="strip-head"><span>条</span><span>測定値・判定</span></div>';for(let row=0;row<20;row++){const j=col*20+row,active=j<count;h+=`<div class="strip-row ${active?'':'inactive'}"><label>${j+1}</label>${makeMeasureInputV29(actualKey,li,j,active?values[j]:'',active)}</div>`}h+='</div>'}h+='</div></div></section>';
  if(type==='フラットネス')h+=`<section class="measure-grid-block flatness-note-block"><div class="measure-grid-block-title"><span>備考</span></div><div class="flatness-entry"><label>対象条<select id="coilNo"></select></label><label>備考<textarea id="coilComment"></textarea></label></div></section>`;
  $('#measurementGrid').innerHTML=h;
 }else{
  const thickness=m.measurements.thickness[li],width=m.measurements.width[li],tDone=thickness.filter(v=>v!=='').length,wDone=width.slice(0,count).filter(v=>v!=='').length;
  let h=`<div class="compact-dimension-workspace"><section class="measure-grid-block compact-thickness"><div class="measure-grid-block-title"><span>板厚</span><span class="measure-status">${compactMeasureStatus(tDone,3)}</span></div><div class="compact-thickness-body"><aside class="compact-tolerance-side thickness-side">${compactToleranceFacts('thickness').html}</aside><div class="thickness-vertical"><b>位置</b><b>OS</b><b>CL</b><b>DS</b><span>丈 ${li+1}</span>${thickness.map((v,j)=>makeMeasureInput('thickness',li,j,v)).join('')}</div></div></section>`;
  h+=`<section class="measure-grid-block compact-width"><div class="measure-grid-block-title"><span>板幅</span><span class="measure-status">${compactMeasureStatus(wDone,count)}</span></div><div class="compact-width-body"><aside class="compact-tolerance-side">${compactToleranceScale('width',width,count)}</aside><div class="strip-layout compact-strip-layout">`;
  for(let col=0;col<2;col++){h+='<div class="strip-column"><div class="strip-head"><span>条</span><span>測定値・判定</span></div>';for(let row=0;row<20;row++){const j=col*20+row,active=j<count;h+=`<div class="strip-row ${active?'':'inactive'}"><label>${j+1}</label>${makeMeasureInputV29('width',li,j,active?width[j]:'',active)}</div>`}h+='</div>'}h+='</div></div></section></div>';$('#measurementGrid').innerHTML=h;
 }
 bindMeasureInputs();applyInputProtection();focusCurrent();updateMeasurementHeading();const summary=$('#toleranceSummary');if(summary)summary.hidden=type==='板厚/板幅';
 if(type==='フラットネス'){
  updateCoilOptions($('#horizontalCount').value);
  $('#coilNo').onchange=()=>{saveFlatComment();loadFlatComment()};
  $('#coilComment').onchange=()=>{saveFlatComment();markDirty()};
  $('#flatAllOk').onclick=()=>{const j=lengthIndex(),n=Math.max(1,+$('#horizontalCount').value||1);for(let c=0;c<n;c++)m.measurements.flatness[j][c]='〇';renderMeasureGrid();markDirty()};
  loadFlatComment();
  bindFlatnessInputs();
 }
}
function focusFlatnessCurrentCell(){const m=S.measure,el=document.querySelector(`input[data-mkey="flatness"][data-i="${lengthIndex()}"][data-j="${m.settings.wStep||0}"]`);if(el)el.focus()}
function bindFlatnessInputs(){
 const m=S.measure;
 /* フラットネスは記号(〇/△/×)または自由記述のため、他項目のような
    測定器転送(deviceInput)経由の数値受信とは切り離し、セルへ直接
    入力できるようにする。 */
 document.querySelectorAll('input[data-mkey="flatness"]').forEach(x=>{
  x.onclick=()=>{m.settings.wStep=+x.dataset.j;focusCurrent()};
  x.onkeydown=e=>{
   if(e.key==='Delete'){x.value='';x.oninput();m.settings.wStep=+x.dataset.j;renderMeasureGrid();focusFlatnessCurrentCell();return}
   if(e.key==='Enter'){e.preventDefault();advanceWidth();renderMeasureGrid();focusFlatnessCurrentCell()}
  };
 });
 document.querySelectorAll('.flat-pick').forEach(btn=>{
  btn.onclick=()=>{
   const j=lengthIndex(),c=m.settings.wStep||0;
   m.measurements.flatness[j][c]=btn.dataset.sym;
   advanceWidth();renderMeasureGrid();markDirty();focusFlatnessCurrentCell();
  };
 });
}
/* Horizontal tolerance summary: preserve hierarchy while avoiding vertical clipping. */
function compactToleranceData(kind){
 const detail=toleranceDetail(kind),base=Number(kind==='thickness'?S.measure.basic.mfgThickness:S.measure.basic.mfgWidth),labels={manufacturing:'製造公差',order:'オーダー公差',instruction:'指示公差'};
 if(!detail)return null;
 return{source:labels[detail.source]||'公差',base:fixedToleranceValue(kind,base),plus:fixedToleranceValue(kind,detail.plus),minus:fixedToleranceValue(kind,detail.minus),low:fixedToleranceValue(kind,detail.range[0]),high:fixedToleranceValue(kind,detail.range[1]),range:detail.range};
}
function compactToleranceFacts(kind){
 const data=compactToleranceData(kind);
 if(!data)return{html:'<div class="compact-tol-three-row no-data"><b>公差情報なし</b><span>判定条件を取得できません</span></div>',range:null};
 return{range:data.range,html:`<div class="compact-tol-three-row"><div class="tol-line tol-line-base"><span class="compact-tol-source">${esc(data.source)}</span><span class="tol-value-pair"><small>基準</small><b>${esc(data.base)}</b></span></div><div class="tol-line tol-line-plusminus"><span class="tol-value-pair"><small>公差＋</small><b>+${esc(data.plus)}</b></span><span class="tol-value-pair"><small>公差－</small><b>-${esc(data.minus)}</b></span></div><div class="tol-line tol-line-range"><small>判定範囲</small><b>${esc(data.low)} ～ ${esc(data.high)}</b></div></div>`};
}
function compactToleranceScale(kind,values,count){
 const facts=compactToleranceFacts(kind),range=facts.range;
 if(!range)return facts.html;
 const valid=values.slice(0,count).map(v=>String(v).trim()).filter(Boolean).map(Number).filter(Number.isFinite),low=range[0],high=range[1],span=Math.max(high-low,.000001),viewLow=low-span*.3,viewHigh=high+span*.3;
 const marks=valid.slice(-20).map(v=>{const pos=Math.max(3,Math.min(97,(viewHigh-v)/(viewHigh-viewLow)*100)),ng=v<low||v>high;return `<i class="compact-value-mark ${ng?'ng':'ok'}" style="top:${pos}%" title="${esc(fixedToleranceValue(kind,v))}"></i>`}).join('');
 return `${facts.html}<div class="compact-tol-scale"><span class="compact-scale-label upper">上限 <b>${esc(fixedToleranceValue(kind,high))}</b></span><span class="compact-scale-safe">公差内</span>${marks}<span class="compact-scale-label lower">下限 <b>${esc(fixedToleranceValue(kind,low))}</b></span></div>`;
}
function renderMeasureGrid(){renderMeasureGridVertical();requestAnimationFrame(updateValidationVisuals)}
