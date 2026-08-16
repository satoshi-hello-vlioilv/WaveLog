"use strict";
/* measurement-input.js: 測定値の入力系 — 測定器受信(deviceInput)・手入力・
   入力位置管理(focusCurrent)・測定グリッド描画・公差計算(toleranceDetail)。 */
function nums(a){return a.flat().map(Number).filter(Number.isFinite).filter(x=>x!==0)}function stat(a){const n=nums(a);if(!n.length)return['','','','',0];const av=n.reduce((x,y)=>x+y,0)/n.length,sd=Math.sqrt(n.reduce((x,y)=>x+(y-av)**2,0)/n.length);return[Math.min(...n),av,Math.max(...n),sd*3,n.length]}
function renderStats(){const types=[['板厚','thickness',3],['板幅','width',2],['バリ','burr',3],['ラテラルボー','lateral',1],['巻きずれ','offset',1],['テレスコープ','telescope',1]];$('#stats').innerHTML=types.map(([l,k,d])=>{const s=stat(S.measure.measurements[k]);return `<tr><th>${l}</th>${s.slice(0,4).map(v=>`<td>${v===''?'':Number(v).toFixed(d)}</td>`).join('')}<td>${s[4]}</td></tr>`}).join('')}
function deviceParse(raw){const manual=S.measure?.settings?.inputMode==='manual',v=(manual?String(raw||''):toHalfWidth(String(raw||''))).trim().toUpperCase();if(v==='#DELETEMODE#'||v==='DELETE')return{device:'delete',value:null};if(v.includes('+#L')){const num=Number(v.split('+#L')[1]);return{device:'tape',value:Number.isFinite(num)?num:null}}if(!v.includes('+'))return Number.isFinite(Number(v))?{device:'manual',value:Number(v)}:{device:'invalid',value:null};const [code,data]=v.split('+');let device='invalid';if(code.startsWith('DT1')){const kind=code.slice(-2,-1);device=kind==='0'?'micrometer':kind==='1'?'caliper':kind==='2'?'depth':'invalid'}const num=Number(String(data).replace(/M$/,''));return{device,value:Number.isFinite(num)?num:null}}
function activeMeasureKey(){return WL.measureItem.KEYS[$('#measureType').value]||'width'}
/* 公差NGの先読み警告: 受信欄(#deviceInput)へ転送中の生データを、確定(Tab/Enter)
   前の時点でその都度deviceParseし、どの項目(kind)へ入るかを判定できれば
   数直線(#numberlinePending)へ即座にプレビュー表示する。実際に書き込みは
   せず読み取りのみのため、転送中はvalueへ一切手を入れないという既存の
   制約(processDeviceInputCore側の注記参照)には影響しない。 */
function numberlinePendingKind(raw){
 const type=$('#measureType')?.value,p=deviceParse(raw);
 if(!p||p.device==='invalid'||p.device==='delete'||p.value===null)return null;
 if(type==='板厚')return['micrometer','manual'].includes(p.device)?'thickness':null;
 if(type==='板幅')return['caliper','tape','manual'].includes(p.device)?'width':null;
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
 /* 図と**同じ写像**で置く（§9.151／§9.152）。軸は描画時に決まっており、
    測定器から1文字届くたびに40条ぶんの公差を引き直すのは重いので、
    **軸は図が持っている値を読む**（`data-mode`/`data-edge`）。
    引くのは**いま入れている条の公差1件だけ**。 */
 const chart=document.querySelector('.accurate-numberline');
 const mode=chart&&chart.dataset.mode,edge=Number(chart&&chart.dataset.edge);
 const j=Number(kind==='thickness'?S.measure.settings?.tStep:S.measure.settings?.wStep)||0;
 const t=normalizeTolerance(typeof toleranceDetail==='function'?toleranceDetail(kind,j):null);
 if(!t||!Number.isFinite(edge)||edge<=0){marker.hidden=true;return}
 const v=deviceParse(raw).value,ng=v<t.lo||v>t.hi;
 /* 縦位置は「いま入れている条の行」で、CSSが`--tc-cur`から決めるので、
    ここで動かすのは**左右だけ**。 */
 const r=mode==='rel'?t.rel(v)/edge:(v-t.base)/edge;
 const x=50+Math.max(-1,Math.min(1,r))*50;
 marker.hidden=false;marker.className='numberline-pending'+(ng?' ng':' ok');
 marker.style.left=x+'%';marker.style.top='';
}
/* 次に入力する場所は**1箇所だけ**光らせる（§9.138）。以前は板厚と板幅が
   1つの項目に同居しており、測定器の種別でどちらへ入るかが決まるため次入力
   セルを2箇所同時に光らせていた。項目を分けたので、いま選んでいる項目の
   次の枠だけを指せばよい（「次にすることを常に1つだけ指す」）。 */
function focusCurrent(){
 document.querySelectorAll('[data-mkey]').forEach(x=>x.classList.remove('current'));
 const m=S.measure.settings,key=activeMeasureKey(),li=lengthIndex();
 /* 板厚は**丈ごとに3点**（エッジOS・中央CL・エッジDS）なので、進む先を持つのは
    条ごとの`wStep`ではなく`tStep`。 */
 const step=key==='thickness'?(m.tStep||0):(m.wStep||0);
 const el=document.querySelector(`[data-mkey="${key}"][data-i="${li}"][data-j="${step}"]`);
 if(el){el.classList.add('current');el.scrollIntoView({block:'nearest',inline:'nearest'})}
 const slot=key==='thickness'?(WL.measureItem.slotLabels('thickness')[step]||String(step+1)):`条 ${step+1}`;
 $('#stepStatus').textContent=`入力位置 丈 ${li+1} / ${slot}`;
}
function advanceWidth(){const m=S.measure.settings,max=Math.max(1,+$('#horizontalCount').value||1),seq=widthSequence(max,$('#widthOrder').value,$('#widthDirection').value),pos=seq.indexOf(m.wStep||0);m.wStep=seq[(pos+1)%seq.length]}
/* 「次の枠へ／前の枠へ」。条ごとの項目は条入力順(`widthSequence`)に従うが、
   板厚は3点の巡回なので順序の設定を持たない。**進む道具は1つ**にして、
   どちらの項目かはここで1回だけ見る（キー操作・転送・Enterが同じ物を呼ぶ）。 */
function advanceSlot(){
 const m=S.measure.settings;
 if(activeMeasureKey()==='thickness')m.tStep=((m.tStep||0)+1)%3;else advanceWidth();
}
function retreatSlot(){
 const m=S.measure.settings;
 if(activeMeasureKey()==='thickness'){m.tStep=((m.tStep||0)+2)%3;return}
 const seq=widthSequence(Math.max(1,+$('#horizontalCount').value||1),$('#widthOrder').value,$('#widthDirection').value),pos=seq.indexOf(m.wStep||0);
 m.wStep=seq[(pos-1+seq.length)%seq.length];
}
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
 const p=deviceParse(raw),m=S.measure,st=m.settings,type=$('#measureType').value,li=lengthIndex();$('#deviceInput').classList.remove('device-ok','device-error');if(p.device==='invalid'||p.value===null&&p.device!=='delete'){setState('入力形式エラー');$('#deviceInput').classList.add('device-error');$('#deviceInput').value='';refocusDeviceInput();return}if(p.device==='delete'){const key=activeMeasureKey(),j=key==='thickness'?(st.tStep||0):(st.wStep||0);if(m.measurements[key])m.measurements[key][li][j]='';renderMeasureGrid();markDirty();refocusDeviceInput();return}
 /* 板厚と板幅は別々の入力内容(§9.138)。使う測定器も枠の数も違うので、
    受け取れる機種もここで項目ごとに分かれる（バリ＝マイクロメータ、
    テレスコープ＝デプスゲージ と同じ形）。 */
 if(type==='板厚'){
  if(!['micrometer','manual'].includes(p.device))return inputError('板厚はマイクロメータを使用してください');
  const j=st.tStep||0;m.measurements.thickness[li][j]=p.value.toFixed(3);st.tStep=(j+1)%3;st.pendingDevice='micrometer'
 }else if(type==='板幅'){
  if(!['caliper','tape','manual'].includes(p.device))return inputError('板幅はノギスまたはコンベックスを使用してください');
  const j=st.wStep||0;m.measurements.width[li][j]=p.value.toFixed(p.device==='caliper'?2:1);st.pendingDevice='width';advanceWidth()
 }else if(type==='バリ'){
  if(!['micrometer','manual'].includes(p.device))return inputError('バリはマイクロメータを使用してください');const j=st.wStep||0;if(st.burrFirst===null||st.burrFirst===undefined){st.burrFirst=p.value;setState(`STEP 2/2 バリ高さを測定してください。基準 ${p.value}`)}else{const diff=p.value-st.burrFirst;if(diff<0)return inputError('測定値がマイナスになります。DELETEして再測定してください');m.measurements.burr[li][j]=Math.abs(diff).toFixed(3);st.burrFirst=null;advanceWidth();setState('STEP 1/2 バリ測定対象の板厚を測定してください')}
 }else if(type==='テレスコープ'){
  if(!['depth','manual'].includes(p.device))return inputError('テレスコープはデプスゲージを使用してください');m.measurements.telescope[li][st.wStep||0]=p.value.toFixed(2);advanceWidth()
 }else{const key=activeMeasureKey();m.measurements[key][li][st.wStep||0]=type==='ラテラルボー'?(Math.ceil(p.value*2)/2).toFixed(1):p.value.toFixed(1);advanceWidth()}
 /* 自動で記録する時刻（§9.143）。**転送は「転送」として数える**——
    手入力と混ぜると「転送を受け始めた時刻」が作れない。 */
 WL.workStamp.note('transfer');
 $('#deviceInput').classList.add('device-ok');$('#deviceInput').value='';renderMeasureGrid();renderStats();markDirty();focusCurrent();refocusDeviceInput()
}
/* 受信処理の入口。板幅のノギス系値は小数1桁へ丸めてから本処理へ渡し、
   処理後は診断用に直前受信の生データと結果を#deviceLastReceivedへ記録する。 */
function processDeviceInput(raw){
 const pad2=n=>String(n).padStart(2,'0'),d=new Date(),ts=`${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
 const type=$('#measureType')?.value,parsed=deviceParse(raw);
 let result;
 if(type==='板幅'&&parsed.value!==null&&Number.isFinite(parsed.value)&&['caliper','tape','manual'].includes(parsed.device)){
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
 else if(e.key==='ArrowDown'||(e.key==='Enter'&&!e.target.value)){e.preventDefault();advanceSlot();focusCurrent()}
 /* 受信欄から手を離さずに項目・丈位置を巡回する(§9.124)。割り当ての定義は
    `WL.measureNav.handleKey`の1箇所で、セル側からも同じものを呼ぶ。 */
 else if(WL.measureNav&&WL.measureNav.handleKey(e,!e.target.value)){/* 済 */}
 else if(e.key==='ArrowUp'){e.preventDefault();retreatSlot();focusCurrent()}
};
$('#lengthPos').onchange=()=>{renderMeasureGrid();$('#deviceInput').focus()};
$('#widthOrder').onchange=focusCurrent;$('#widthDirection').onchange=focusCurrent;
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-mode]').forEach(x=>x.classList.remove('active'));b.classList.add('active');S.measure.settings.inputMode=b.dataset.mode;$('#deviceInput').readOnly=false;applyInputProtection();$('#deviceInput').focus();updateReceiveState(true);setState(b.dataset.mode==='auto'?'自動転送: Tabで受信':'手動入力: Enterで確定')});
/* 測定値セルの生成。板厚=3桁/板幅=1桁へ表示時に整形する。 */
function makeMeasureInput(key,i,j,value){value=fixedMeasurementValue(key,value);const mode=key==='flatness'?'text':'decimal';
 /* 読み上げ名も枠の呼び名から作る。板厚は「1条」ではなく「OS/CL/DS」。 */
 const aria=key==='thickness'?(WL.measureItem.slotLabels('thickness')[j]||String(j+1)):`${j+1}条`;
 return `<input data-mkey="${key}" data-i="${i}" data-j="${j}" value="${esc(value)}" inputmode="${mode}" aria-label="${esc(aria)}">`}
function bindMeasureInputs(){
 const m=S.measure;
 const syncStepFor=x=>{if(x.dataset.mkey==='thickness')m.settings.tStep=+x.dataset.j;else m.settings.wStep=+x.dataset.j};
 document.querySelectorAll('[data-mkey]').forEach(x=>{judgeInput(x,x.dataset.mkey,Number(x.value),+x.dataset.j);x.onclick=()=>{syncStepFor(x);focusCurrent();if(S.measure.settings.inputMode!=='manual')$('#deviceInput').focus()};
  // 手動モードでは、クリックだけでなくTabキー等の操作で実際に
  // フォーカスが移動した場合も、強調表示(.current)をそのセルへ
  // 追従させる(自動モードは受信欄にフォーカスを固定するため対象外)。
  x.addEventListener('focus',()=>{if(S.measure.settings.inputMode!=='manual')return;syncStepFor(x);focusCurrent()});
  x.oninput=()=>{m.measurements[x.dataset.mkey][+x.dataset.i][+x.dataset.j]=x.value;judgeInput(x,x.dataset.mkey,Number(x.value),+x.dataset.j);renderStats();WL.workStamp.note('manual');markDirty()};x.onkeydown=e=>{if(WL.measureNav&&WL.measureNav.handleKey(e,!x.value))return;if(S.measure.settings.inputMode!=='manual'){e.preventDefault();return}if(e.key==='Delete'){x.value='';x.oninput()}if(e.key==='Enter'){e.preventDefault();advanceSlot();focusCurrent()}}})

 document.querySelectorAll('[data-mkey="thickness"],[data-mkey="width"]').forEach(el=>{
  const previousBlur=el.onblur;
  el.onblur=event=>{if(previousBlur)previousBlur.call(el,event);const formatted=fixedMeasurementValue(el.dataset.mkey,el.value);if(el.value!==formatted){el.value=formatted;S.measure.measurements[el.dataset.mkey][+el.dataset.i][+el.dataset.j]=formatted;judgeInput(el,el.dataset.mkey,Number(formatted),+el.dataset.j);renderStats();markDirty()}}
 });
}
function toleranceInfoFor(key,index,value){
 if(key==='flatness'){const v=String(value||'').trim();return v===''?{tol:null,state:'wait',pos:50}:{tol:null,state:v==='〇'?'ok':'ng',pos:50}}
 const tol=toleranceFor(key==='thickness'?'thickness':'width',index),num=Number(value);if(!tol||!Number.isFinite(num))return{tol,state:'wait',pos:50};const low=tol[0],high=tol[1],span=Math.max(Math.abs(high-low),.000001),viewLow=low-span*.25,viewHigh=high+span*.25,pos=Math.max(0,Math.min(100,(viewHigh-num)/(viewHigh-viewLow)*100));return{tol,state:num<low||num>high?'ng':'ok',pos}}
/* 印は**公差外だけ**（§9.137の②の約束「セル背景で公差内の位置を示す案は
   却下。公差外の赤だけ」）。全セルに「OK」を添えると、24条×5丈で120個の
   OKが並んで**読むべき赤が埋もれる**うえ、印は入力欄の上に重なるので
   （`.judge-pill`は`position:absolute`）**値そのものが隠れて`998.20`が`9`に
   見えていた**（実測）。印が出るセルだけ右余白を空ける。 */
function makeMeasureInputV29(key,i,j,value,active=true){
 const ng=active&&value!==''&&toleranceInfoFor(key,j,value).state==='ng';
 const pill=ng?'<span class="judge-pill ng">NG</span>':'';
 return `<div class="strip-input-wrap${ng?' has-judge':''}">${makeMeasureInput(key,i,j,value)}${pill}</div>`;
}
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
/* typeName は「いま画面で選ばれている入力内容」の代わりに使う省略可能な引数。
   完了前の確認は**描かれていない項目の公差外まで数える**必要があり、画面の
   選択に引きずられると1項目ぶんしか見られない(§9.125)。省略時は今までどおり。 */
function toleranceDetail(kind,index=0,typeName){
 const type=typeName||$('#measureType')?.value||S.measure?.settings?.measureType||'',isDimensional=WL.measureItem.isDimensional(type),b=S.measure.basic,base=Number(kind==='thickness'?b.mfgThickness:b.mfgWidth);
 let requested=configuredToleranceSource();if(!isDimensional)requested='instruction';let data=requested==='instruction'?applyInstructionToleranceForOtherTargets(kind):toleranceDataForSource(kind,requested),source=requested,fallback=false;
 if(!data&&requested!=='manufacturing'){source='manufacturing';fallback=true;data=toleranceDataForSource(kind,'manufacturing')}
 return data&&Number.isFinite(base)?{range:[base-data.minus,base+data.plus],source,fallback,...data}:null;
}
function toleranceFor(kind,index=0){return toleranceDetail(kind,index)?.range||null}
function compactMeasureStatus(done,total){return done===total?'測定完了':done?`測定中 ${done}/${total}`:'測定待ち'}
/* 条の入力欄を、**使う条数ぶんだけ**組み立てる(§9.124)。
   以前は「2列 × 20行 = 40条」を必ず描き、条数を超えた行を灰色で残していた。
   1条のロットでも39行の空欄が並び、②測定を全幅にした途端それが画面の
   大半を占めた。**使わない行は描かない**——探す対象が減る。
   20条を超えるときだけ2列にする(縦に41行並べると画面から溢れる)。
   **2箇所で同じループを書かない**(どの項目も同じものが要る)。 */
/* ---------- ②の測定表は「丈位置×条」の1つの表（§9.136） ----------
   以前は「いま選んでいる丈位置の条を縦に並べた帯」＋「他の丈位置を見る
   ための丈位置くらべ」の**2枚**だった。同じ値が2箇所にあり（§9.129に反する）、
   丈を切り替えると帯のほうは中身が入れ替わるのに、くらべのほうは列の色だけが
   動く——**同じものを見ているのに動き方が違う**ので、どちらを見ているのかを
   その都度組み立て直す必要があった。
   **横＝丈位置、縦＝条**の1つの表にすれば、切り替えは「どの列がアクティブか」
   だけになり、**表そのものは動かない**。丈は最大10列（縦割9＋尾）なので
   横は足りる。条は**1列で40行まで**——2段に折らない。
   列見出しが丈位置の選択を兼ねる（`#lengthPos`の一覧は②から降ろした）。
   **`#lengthPos`自体は残す**——丈位置を持っているのはこの`select`で、
   `PageUp/PageDown`・完了前の確認の「直す」・帳票まで全部がこれを見る。
   見えている一覧を消すことと、状態の置き場を消すことは別（§9.124の
   `#measureType`とチップの関係と同じ）。 */
/* 丈位置の数。`updateLengthOptions`と同じく「縦割数+1」（1(頭)…N(頭) と N(尾)）。 */
function lengthSlotCount(){
 return Math.min(LENGTH_SLOTS,Math.max(1,Math.min(9,+$('#verticalCount').value||1))+1);
}
/* 行の呼び名と枠の数は`WL.measureItem`が答える（§9.138）。板厚は条ではなく
   丈ごとに3点（エッジOS・中央CL・エッジDS）なので、行が3つになる。 */
/* 表の大きさは**条数と丈数から2段で決める**（§9.146）。
   「40条が全部入る小ささ」を8条のロットにも当てると、器の中に空きが残る
   うえ、1行19pxの帯を狙って押すことになる（実機で「余白の問題と使いにくさ」
   として報告された）。**25条までは通常の見やすい大きさ**、26条以上で
   今までの詰まった見た目。
   列も同じ。丈数は設計上9まであるが**実際は3、まれに4**——丈3以下は
   `lengthSlotCount()`が4を返すので、**4列がきれいに収まる幅**を主に置き、
   5列以上のときだけ詰める。 */
const MX_ROOMY_ROWS=25,MX_WIDE_SLOTS=4;
function measureMatrixHtml(key,count,type){
 const m=S.measure,lp=$('#lengthPos'),slots=lengthSlotCount(),cur=lengthIndex();
 const labels=WL.measureItem.slotLabels(key,count),head=WL.measureItem.slotHead(key);
 const label=li=>(lp&&lp.options[li]&&lp.options[li].value)||('丈'+(li+1));
 const rows=(m.measurements&&m.measurements[key])||[];
 /* 子ロットの印は**専用の1列**にまとめる（§9.146）。ロット№は条で決まり、
    **丈位置が変わっても同じ**なので、丈の数だけ同じバッジを並べる意味が
    無い——入力欄の中に置いていたときは、そのぶん数値の場所が狭くなり、
    丈を全部出すと画面も圧迫していた。板厚は行が条ではなく
    エッジOS/中央CL/エッジDSの3点なので、この列は付けない。 */
 const badges=key==='thickness'?[]:WL.split.lotColumn(count);
 const hasLot=badges.some(Boolean);
 let thead='';
 for(let li=0;li<slots;li++)
  thead+=`<th scope="col" class="${li===cur?'is-current':''}">`
   +`<button type="button" data-mx-len="${li}" title="この丈位置を測る">${esc(label(li))}</button></th>`;
 let body='';
 for(let j=0;j<count;j++){
  body+=`<tr><th scope="row">${esc(labels[j]??String(j+1))}</th>`;
  if(hasLot){
   const b=badges[j];
   body+=`<td class="mx-lot">`+(b?`<span class="strip-lot-badge" style="background-color:${esc(b.color)}" title="${esc(b.lot)}">${esc(b.suffix)}</span>`:'')+'</td>';
  }
  for(let li=0;li<slots;li++){
   /* 判定の印（OK/NG）は**いま測っている列だけ**。全列に出すと最大400個
      並んで、印そのものが背景になる。公差外の色は`judgeInput`が全列の
      入力欄へ付けるので、**外れていることはどの列でも分かる**。 */
   body+=`<td class="${li===cur?'is-current':''}">`
    +makeMeasureInputV29(key,li,j,(rows[li]||[])[j]||'',li===cur)+'</td>';
  }
  body+='</tr>';
 }
 /* 表の幅の上限は**列数から**決まる（CSSの`--mx-cols`）。丈位置の数は
    ロットで変わるので、決め打ちにできない。ロット列のぶんは`mx-has-lot`。 */
 const cls='measure-matrix '+(count<=MX_ROOMY_ROWS?'mx-roomy':'mx-dense')
  +(slots<=MX_WIDE_SLOTS?' mx-wide':'')+(hasLot?' mx-has-lot':'');
 return '<div class="mx-scroll"><table class="'+cls+'" style="--mx-cols:'+slots+'">'
  +`<thead><tr><th scope="col" class="mx-corner">${esc(head)}</th>`
  +(hasLot?'<th scope="col" class="mx-lot-head">ロット</th>':'')
  +`${thead}</tr></thead>`
  +`<tbody>${body}</tbody></table></div>`;
}
/* 条が40に達したら公差の基準は畳む（§9.146、利用者の指示「40以上の時は
   公差情報は折りたたみ」）。**畳んだままでも開けること**が条件なので、
   ボタンごと消さずに見出しボタンへ変える。40未満では畳む必要が無いので
   ボタンを出さない（押せるのに意味の無いものを置かない）。 */
function applyToleranceFold(count){
 const box=document.querySelector('.tol-block'),btn=$('#tolFold');
 if(!box||!btn)return;
 const foldable=count>=40;
 if(box.classList.contains('tol-foldable')!==foldable){
  box.classList.toggle('tol-foldable',foldable);
  if(foldable)box.classList.remove('tol-open');
 }
 if(btn.hidden!==!foldable)btn.hidden=!foldable;
 btn.setAttribute('aria-expanded',String(!foldable||box.classList.contains('tol-open')));
}
document.addEventListener('click',e=>{
 const btn=e.target.closest&&e.target.closest('#tolFold');
 if(!btn)return;
 const box=btn.closest('.tol-block');if(!box)return;
 const open=!box.classList.contains('tol-open');
 box.classList.toggle('tol-open',open);
 btn.setAttribute('aria-expanded',String(open));
});
/* 見出しを押したらその丈位置へ移る。**割り当ては1箇所**（丈位置を動かす
   道具は`#lengthPos`のchangeだけ。ここで直接描き直さない）。
   セルを押したときも同じ——**押した列がいま測る列になる**。押した先が
   別の列なのに前の列のまま値が入ると、入れた本人にも気づけない。 */
function gotoLengthSlot(li){
 const lp=$('#lengthPos');
 if(!lp||!lp.options[li]||lp.selectedIndex===li)return false;
 lp.selectedIndex=li;lp.dispatchEvent(new Event('change',{bubbles:true}));
 return true;
}
document.addEventListener('click',e=>{
 const btn=e.target.closest&&e.target.closest('[data-mx-len]');
 if(btn){e.preventDefault();gotoLengthSlot(Number(btn.dataset.mxLen));return}
 const cell=e.target.closest&&e.target.closest('#measurementGrid input[data-mkey]');
 if(cell)gotoLengthSlot(Number(cell.dataset.i));
});
/* 測定表の組み立ては**1本だけ**（§9.138）。以前は「板厚/板幅」だけが専用の
   2枚組ワークスペースを持っており、同じ`stripColumnsHtml`/`lengthCompareHtml`を
   もう一度並べていた。板厚を独立した入力内容にしたことで、板厚も他の項目と
   同じ「公差の数直線＋枠の一覧＋丈位置くらべ」で書けるようになった
   ——違いは**枠の数と呼び名だけ**で、それは`WL.measureItem`が答える。 */
function renderMeasureGridVertical(){
 const type=$('#measureType').value,key=activeMeasureKey(),m=S.measure,li=lengthIndex(),count=Math.max(1,Math.min(40,+$('#horizontalCount').value||1));
 const actualKey=key==='mother'?'width':key;
 const slots=WL.measureItem.slotCount(actualKey,count);
 const values=m.measurements[actualKey][li],done=values.slice(0,slots).filter(v=>v!=='').length;
 const bulkBtn=type==='フラットネス'?'<span class="flat-pick-group"><span class="flat-pick-label">現在の条へ入力</span><button type="button" class="flat-pick" data-sym="〇">〇</button><button type="button" class="flat-pick" data-sym="△">△</button><button type="button" class="flat-pick" data-sym="×">×</button></span><button type="button" id="flatAllOk">全条 〇</button>':'';
 const tol=WL.measureTolerance.parts(actualKey,values,slots);
 let h=`<section class="measure-grid-block compact-other"><div class="measure-grid-block-title"><span>${esc(type)}</span><div class="measure-status-group"><span class="measure-status">${compactMeasureStatus(done,slots)}</span>${bulkBtn}</div></div><div class="matrix-body${tol.graph?'':' no-graph'}"><aside class="compact-tolerance-side">${tol.graph}</aside>`;
 h+=measureMatrixHtml(actualKey,slots,type);
 h+='</div></section>';
 if(type==='フラットネス')h+=`<section class="measure-grid-block flatness-note-block"><div class="measure-grid-block-title"><span>備考</span></div><div class="flatness-entry"><label>対象条<select id="coilNo"></select></label><label>備考<textarea id="coilComment"></textarea></label></div></section>`;
 $('#measurementGrid').innerHTML=h;
 WL.measureTolerance.paintFacts(tol.facts);
 applyToleranceFold(slots);
 alignToleranceChart();
 syncNumberlineControls();
 bindMeasureInputs();applyInputProtection();focusCurrent();updateMeasurementHeading();/* 寸法系（板厚・板幅）は横長の公差バーを出さない。数直線の隣の公差カード
   （`.compact-tolerance-side`）が基準値・公差±・判定範囲を既に持っており、
   **同じ数字を画面に2つ出さない**（§9.129。項目を分ける前の板厚/板幅と
   同じ扱いを、分けた後の両方へそのまま引き継ぐ）。 */
const summary=$('#toleranceSummary');if(summary)summary.hidden=WL.measureItem.isDimensional(type);
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
   advanceWidth();renderMeasureGrid();WL.workStamp.note('manual');markDirty();focusFlatnessCurrentCell();
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
/* ---- 値→横位置の写像は1本だけ（§9.151／軸の切り替えは§9.152） -------------
   図と、確定前の先読みリングが**別の式を持たない**ようにする（以前は両者が
   それぞれ計算しており、リングと確定後の点が別の位置に出た）。

   **基準はどの条も重ねて中心へ置く**。異幅分割では条ごとに幅も公差も違うので、
   幅そのものを横軸に取ると**他の子ロットの点が端に張り付いて赤くなる**
   （§9.150で実測。幅300±1の条と幅500+3/-1の条を同じ軸に置くと、選んでいない
   側の4点が全部端で赤になった。表のセルは条ごとの公差で正しく合格判定して
   いたので、**図だけが嘘をついていた**）。**幅そのものは軸から消える**
   ——利用者の判断で、幅狭の条が潰れるくらいなら見えなくてよい（幅は測定表と
   ロット列が持っている）。

   横の目盛りは**2通りあり、切り替えられる**（§9.152、利用者の指示）。
   どちらも**基準は必ず中心**・**軸の端は固定**（データで動かない）。
   - `abs`（既定）＝**基準からの差を実寸(mm)で見る**。条ごとに公差が違えば
     **帯の縁がずれて段差になる**ので、「この子ロットは公差が広い／狭い」が
     図そのものから読める。
   - `rel`＝**その条自身の公差で割る**。−1＝下限／＋1＝上限が全条でそろうので、
     余裕の**割合**だけを比べたいときはこちら。公差の広い狭いは消える。
   軸の端は「**公差の何倍まで見せるか**」(`span`)で決める。mmを直に持たせない
   のは、板厚(±0.02)と板幅(±1)で桁が3つ違うため——**項目ごとの設定が要らない
   形**にしてある。端を越えた点は端で止め、**何件あるかを文字で言う**
   （色や形だけで伝えない。§9.129の3番）。

   条ごとの公差は**セルのNG判定と同じ`toleranceDetail(kind,j)`から取る**。
   ここだけ別の出どころにすると、図と表で判定が食い違う。 */
const NL_MODE_KEY='WaveLogNumberlineMode',NL_SPAN_KEY='WaveLogNumberlineSpan';
const NL_MODES=[['abs','実寸(mm)'],['rel','公差比']];
const NL_SPANS=[1.2,1.5,2,3,5,10],NL_SPAN_DEFAULT=2;
function nlStore(k,v){
 try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,String(v))}
 catch(e){}
 return null;
}
function numberlineMode(){return nlStore(NL_MODE_KEY)==='rel'?'rel':'abs'}
function numberlineSpan(){
 const v=Number(nlStore(NL_SPAN_KEY));
 return NL_SPANS.includes(v)?v:NL_SPAN_DEFAULT;
}
function normalizeTolerance(d){
 if(!d||!d.range)return null;
 const lo=Number(d.range[0]),hi=Number(d.range[1]);
 if(!Number.isFinite(lo)||!Number.isFinite(hi)||hi<=lo)return null;
 /* base は「無ければ null」で来ることがある。Number(null) は 0 なので
    空扱いを先に落とす（基準0として通ってしまう）。 */
 const num=v=>(v===null||v===undefined||v==='')?NaN:Number(v);
 const declared=num(d.base),minus=num(d.minus);
 const base=Number.isFinite(declared)?declared
  :(Number.isFinite(minus)?lo+minus:(lo+hi)/2);
 if(!Number.isFinite(base))return null;
 /* 片側公差（プラスかマイナスが0）では片方の単位が0になる。反対側の単位で
    代用して写像を連続させる（0で割らない）。 */
 const up=(hi-base)||(base-lo)||1,dn=(base-lo)||(hi-base)||1;
 return{lo,hi,base,up,dn,
   rel:v=>{const x=Number(v);return x>=base?(x-base)/up:-(base-x)/dn}};
}
/* 軸の端の数字。板厚(±0.02)と板幅(±1)を同じ書式で出せるよう、桁は大きさから
   決める。**「0」ではなく「基準」と書く**——0mmは「差が無い」の意味で、
   測定値そのものと読み違えられる。 */
function nlEdgeLabel(v){
 const a=Math.abs(Number(v))||0,d=a<0.1?3:(a<10?2:1);
 return(v<0?'−':'+')+a.toFixed(d);
}
function toleranceAxisView(kind,values,count,opt){
 const o=opt||{};
 const mode=o.mode==='rel'||o.mode==='abs'?o.mode:numberlineMode();
 const span=NL_SPANS.includes(Number(o.span))?Number(o.span):numberlineSpan();
 const n=Math.max(1,Number(count)||1),per=[];
 for(let j=0;j<n;j++)per.push(normalizeTolerance(
   (typeof toleranceDetail==='function')?toleranceDetail(kind,j):null));
 const got=per.filter(Boolean),any=got[0];
 if(!any)return null;
 const at=j=>per[j]||any;
 /* 軸の端が表す量。**一番広い片側公差**から決めるので、条ごとに公差が違っても
    軸は1本のまま動かない——選んだ条で軸が動くと、条どうしの位置を比べられない
    （§9.150で実際にそうなっていた）。 */
 const half=Math.max(...got.map(t=>Math.max(t.up,t.dn)));
 const edge=mode==='abs'?half*span:span;
 /* −1〜+1（±1が軸の端）。はみ出しはここでは切らない——数えるのに要る。 */
 const norm=(v,j)=>{const t=at(j),x=Number(v);
   return mode==='abs'?(x-t.base)/edge:t.rel(x)/edge};
 const pos=r=>50+Math.max(-1,Math.min(1,Number(r)))*50;
 const x=(v,j)=>pos(norm(v,j));
 const band=j=>{const t=at(j);return{low:x(t.lo,j),high:x(t.hi,j)}};
 /* 軸からはみ出した点の件数。**描けないことを黙らない**（§9.129）。 */
 let out=0;
 for(let j=0;j<n;j++){
  const raw=String((values||[])[j]??'').trim(),v=Number(raw);
  if(raw!==''&&Number.isFinite(v)&&Math.abs(norm(v,j))>1)out++;
 }
 /* 下限・上限の線を1本で引けるのは、**全条の公差が同じとき**（`rel`は割った
    後なので常に同じ）。違うのに1本引くと、その線はどの条の限界でもない嘘に
    なる——そのときは**条ごとの帯の縁**が限界を示す（それが「段差」）。 */
 const uniform=got.length===n&&got.every(t=>t.lo===any.lo&&t.hi===any.hi&&t.base===any.base);
 const lines={base:50};
 if(mode==='rel'||uniform){lines.low=x(any.lo,0);lines.high=x(any.hi,0)}
 /* 目盛りの札は**軸が何を意味するか**だけを言う。`abs`は端の実寸（＝軸の
    出どころと単位。§9.129の6番）、`rel`は下限・上限の位置。 */
 const ticks=[];
 if(mode==='abs'){
  ticks.push({x:0,label:nlEdgeLabel(-edge),cls:'tc-end tc-end-low'});
  ticks.push({x:50,label:'基準',cls:'tc-base'});
  ticks.push({x:100,label:nlEdgeLabel(edge),cls:'tc-end tc-end-high'});
 }else{
  /* 基準の札は**画面の距離で決める**（§9.150）。器の12%（≒25px）離れて
     いなければ「下限基準」と重なって読めない。線は常に引く。 */
  const gap=Math.min(Math.abs(50-lines.low),Math.abs(lines.high-50));
  ticks.push({x:lines.low,label:'下限',cls:'tc-low'});
  if(gap>=12)ticks.push({x:50,label:'基準',cls:'tc-base'});
  ticks.push({x:lines.high,label:'上限',cls:'tc-high'});
 }
 return{per,at,norm,x,band,lines,ticks,mode,span,edge,half,uniform,out};
}
/* ---- 板幅測定値の視覚表示（§9.150。骨子§9.137「公差と測定値の縦グラフ」）----
   **縦＝条（右の測定表の行と1対1）／横＝測定値**。
   以前はスウォーム（蜂群図）で、縦＝値・横は重なり避けだけだった。横位置に
   意味が無いので**どの点が何条かは`title`でしか分からず**（マウスを当てないと
   読めない＝現場では読めない）、40条では点の雲になっていた。
   縦を条に取ると、
   - 右の表の行と**同じ高さで並ぶ**ので、外れている条が目を横に振るだけで分かる
   - 条の並びは材料の幅方向（OS→DS）なので、**片側だけ太いといった傾きが
     図として見える**——板幅測定で見たいのはまさにそれ
   - 1条1行なので**重なり避けの小細工が要らない**（横位置が値そのもの）
   **数字はここに出さない**——公差の値は測定カード上の帯（§9.146）、測定値は
   右の表にある。図が答えるのは「公差のどのへんか」だけ（§9.129）。
   行の高さは**実際の表を測って**合わせる（`alignToleranceChart`）。トークンから
   計算すると罫線と表示サイズのぶんでずれる（§9.95の行高と同じ罠）。 */
function compactToleranceScale(kind,values,count){
 const facts=compactToleranceFacts(kind);
 if(!facts.range)return facts.html;
 const view=toleranceAxisView(kind,values,count);
 if(!view)return facts.html;
 const cur=Number(kind==='thickness'?S.measure?.settings?.tStep:S.measure?.settings?.wStep)||0;
 const labels=WL.measureItem.slotLabels(kind,count);
 /* 子ロットの色帯（§9.151、利用者の指示）。どの条がどの子ロットかを図だけで
    追えるようにする。色は測定表のロット列・条割の帯と同じ配色。板厚は行が
    条ではなくエッジOS/中央CL/エッジDSの3点なので付けない。 */
 const lots=kind==='thickness'?[]:WL.split.lotColumn(count);
 let rows='';
 for(let j=0;j<count;j++){
  const t=view.at(j),b=view.band(j),lot=lots[j];
  const raw=String((values||[])[j]??'').trim(),n=Number(raw);
  const has=raw!==''&&Number.isFinite(n),ng=has&&(n<t.lo||n>t.hi);
  const r=has?view.norm(n,j):0,out=has&&Math.abs(r)>1;
  const name=labels[j]??String(j+1);
  rows+=`<div class="tc-row${j===cur?' is-current':''}" data-tc-row="${j}"`
   +` style="--r-low:${b.low}%;--r-high:${b.high}%">`
   +(lot?`<i class="tc-lot" style="background-color:${esc(lot.color)}" title="${esc(lot.lot)}"></i>`:'')
   /* はみ出した点は端で止め、**形を変えて**「まだ先がある」と示す。件数は
      `data-out`から帯の文字が言う（形だけ・色だけで伝えない）。 */
   +(has?`<i class="tc-dot ${ng?'ng':'ok'}${out?(r<0?' out out-low':' out out-high'):''}"`
        +` style="left:${view.x(n,j)}%"`
        +` title="${esc(name)}: ${esc(raw)}${lot?' / '+esc(lot.lot):''}${out?' / 軸の外':''}"></i>`:'')
   +'</div>';
 }
 const lineOf=(k,extra)=>view.lines[k]===undefined?''
   :`<i class="tc-line tc-line-${k}"${extra||''}></i>`;
 return facts.html
  +`<div class="accurate-numberline nl-${view.mode}" data-mode="${view.mode}"`
  +` data-edge="${view.edge}" data-span="${view.span}" data-out="${view.out}"`
  +` style="--nl-low:${view.lines.low??50}%;--nl-high:${view.lines.high??50}%;`
  +`--nl-base:${view.lines.base}%;--tc-cur:${cur}">`
  +`<div class="tc-head">`
  +view.ticks.map(t=>`<b class="tc-tick ${t.cls}">${esc(t.label)}</b>`).join('')
  +`</div>`
  /* **基準の線は常に引く**（細いので重ならない）。札だけ畳むことはある——
     製造公差は`+3/-1`のように非対称が普通で、基準が下限寄りにあるのは
     むしろ既定。線まで消すと「狙う値がどこか」が図から失われる。 */
  +`<div class="tc-body">`
  +lineOf('low')+lineOf('base')+lineOf('high')
  +rows
  +`<div class="numberline-pending" id="numberlinePending" hidden></div>`
  +`</div></div>`;
}
/* 図の行を**実際の表に合わせる**。測るのは見出し1行と本文1行だけ（40行を
   測らない）——どの行も同じ高さなので、頭の高さと1行の高さが分かれば足りる。 */
function alignToleranceChart(){
 const chart=document.querySelector('.accurate-numberline');
 const tbl=document.querySelector('#measurementGrid .measure-matrix');
 if(!chart||!tbl)return;
 const head=tbl.querySelector('thead tr'),row=tbl.querySelector('tbody tr');
 if(!head||!row)return;
 const hh=head.getBoundingClientRect().height,rh=row.getBoundingClientRect().height;
 if(hh>0)chart.style.setProperty('--tc-head',(Math.round(hh*100)/100)+'px');
 if(rh>0)chart.style.setProperty('--tc-row',(Math.round(rh*100)/100)+'px');
}
/* 公差の「図」と「値」は**別の問いに答えるので、別の場所へ置く**（§9.140、
   骨子§9.137）。図＝いま公差のどのへんか（測定カードの左・選択中の丈位置
   だけ）、値＝規格はいくつか（基本情報カード）。同じ数字を2箇所に出さない
   （§9.129）。

   組み立ては`compactToleranceScale`の**1本のまま**で、**出来上がりを2つに
   配る**。引数で切り替える形にしないのは、この関数を3つのファイルが順に
   包んでおり（`measurement-worklog.js`＝指示公差／`filters.js`＝スウォーム
   数直線。§9.125の`toleranceDetail`と同じ形）、**1枚でも引数を落とすと
   根まで届かず黙って効かなくなる**ため。出来上がりのHTMLから図の要素を
   取り出す形なら、どの包みが勝っていても同じように分けられる。 */
const TOLERANCE_GRAPH_SELECTOR='.accurate-numberline,.compact-tol-scale';
window.WL=window.WL||{};
WL.measureTolerance={
 /* 図が作られない項目がある——公差そのものが無いもの（ラテラルボー等）と、
    指示公差（`measurement-worklog.js`が専用カードへ置き換える）。そのときは
    **左の列ごと畳んで表へ渡す**（`no-graph`）。空の器を210px残すのは
    「意味のない余白」で、しかも**理由は基本情報カードの公差欄に既に
    書いてある**（「公差情報なし」／指示値のカード）——同じことを2箇所に
    書かない（§9.129）。 */
 parts(kind,values,count){
  const box=document.createElement('div');
  box.innerHTML=(typeof compactToleranceScale==='function')?compactToleranceScale(kind,values,count):'';
  const graph=box.querySelector(TOLERANCE_GRAPH_SELECTOR);
  if(graph)graph.remove();
  return{facts:box.innerHTML.trim(),graph:graph?graph.outerHTML:''};
 },
 /* 値の置き場は基本情報カードの中。**同じ値なら触らない**——`hidden`は値が
    同じでも変更記録が積まれ、見張りと合わさると回り続ける（§9.131）。 */
 paintFacts(html){
  const host=typeof $==='function'?$('#toleranceFacts'):null;
  if(!host)return;
  if(host.innerHTML!==html)host.innerHTML=html||'';
  const empty=!html;
  if(host.hidden!==empty)host.hidden=empty;
 },
 /* 描き直しの入口。表そのものは触らないので、入力欄のフォーカスも
    スクロール位置も動かない（条ごとに公差が変わる分割ロット用）。 */
 repaint(kind,values,count){
  const parts=this.parts(kind,values,count);
  const body=document.querySelector('.matrix-body'),side=body&&body.querySelector('.compact-tolerance-side');
  if(side)side.innerHTML=parts.graph;
  if(body)body.classList.toggle('no-graph',!parts.graph);
  this.paintFacts(parts.facts);
  alignToleranceChart();
  syncNumberlineControls();
  return parts;
 },
 /* 軸を切り替えたときの描き直し口。**いま描かれている項目・条・値**を
    自分で拾うので、呼ぶ側は何も知らなくてよい（同じ拾い方が`lot-split.js`
    にもあったが、あちらは条ごとの公差追従用で入口が違う）。 */
 refresh(){
  /* **`window.S`で見ないこと**——`S`は`base.js`の`const`で、宣言だけの
     グローバル束縛は`window`の属性にならない。`window.S`は常にundefinedで、
     ここで黙って引き返していた（軸を切り替えても何も起きなかった）。 */
  if(typeof S==='undefined'||!S?.measure||typeof WL.measureItem?.kindOf!=='function')return;
  const type=document.getElementById('measureType')?.value;
  if(!type)return;
  const key=WL.measureItem.kindOf(type);
  const li=typeof lengthIndex==='function'?lengthIndex():0;
  const count=Math.max(1,Math.min(40,+(document.getElementById('horizontalCount')?.value)||1));
  const values=S.measure?.measurements?.[key]?.[li]||[];
  this.repaint(key,values,WL.measureItem.slotCount(key,count));
 },
};
/* 軸の切り替え（§9.152）。**選んだ結果は端末に覚える**——見え方の好みなので
   レコードへは書かない（他のPCで開いたときに勝手に変わらない）。
   軸からはみ出した点は**件数を文字で言い、直し方（表示幅）を同じ行に置く**。 */
function syncNumberlineControls(){
 const mode=document.getElementById('numberlineMode'),span=document.getElementById('numberlineSpan');
 if(span&&!span.options.length)
  span.innerHTML=NL_SPANS.map(v=>`<option value="${v}">公差×${v}</option>`).join('');
 if(mode&&!mode.options.length)
  mode.innerHTML=NL_MODES.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
 if(mode)mode.value=numberlineMode();
 if(span)span.value=String(numberlineSpan());
 const note=document.getElementById('numberlineOutside');
 if(note){
  const chart=document.querySelector('.accurate-numberline');
  const out=Number(chart&&chart.dataset.out)||0;
  note.textContent=out?`軸の外 ${out}件（表示幅を広げると見えます）`:'';
  if(note.hidden!==!out)note.hidden=!out;
 }
}
WL.numberline={
 MODES:NL_MODES,SPANS:NL_SPANS,
 mode:numberlineMode,span:numberlineSpan,
 set(k,v){
  nlStore(k==='mode'?NL_MODE_KEY:NL_SPAN_KEY,v);
  WL.measureTolerance.refresh();
  syncNumberlineControls();
 },
};
WL.onReady(()=>{
 syncNumberlineControls();
 const mode=document.getElementById('numberlineMode'),span=document.getElementById('numberlineSpan');
 if(mode)mode.onchange=()=>WL.numberline.set('mode',mode.value);
 if(span)span.onchange=()=>WL.numberline.set('span',span.value);
});
function renderMeasureGrid(){renderMeasureGridVertical();requestAnimationFrame(updateValidationVisuals)}
Object.assign(window.WL,{toleranceAxisView});
