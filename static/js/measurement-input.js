"use strict";
/* measurement-input.js: 測定値の入力系 — 測定器受信(deviceInput)・手入力・
   入力位置管理(focusCurrent)・測定グリッド描画・公差計算(toleranceDetail)。 */
function nums(a){return a.flat().map(Number).filter(Number.isFinite).filter(x=>x!==0)}function stat(a){const n=nums(a);if(!n.length)return['','','','',0];const av=n.reduce((x,y)=>x+y,0)/n.length,sd=Math.sqrt(n.reduce((x,y)=>x+(y-av)**2,0)/n.length);return[Math.min(...n),av,Math.max(...n),sd*3,n.length]}
/* ---------- ③測定データ分析（§9.214、利用者の指示） ----------
   「今カード内に出ている表は解体。中身のデータは表示は必要なものに絞り、
    表示内容や削ったそのエリアも使って、**ロット単位で、板厚のMIN,MAX、
    板幅のMIN,MAX**を表示できるようにしてください。」

   以前は6項目×MIN/AVE/MAX/3σ/N数の30マスの表だった。**このロットが
   どの範囲に収まったか**を読むのに5つの数字は要らない——AVEと3σは
   合否にも次の行動にも効かない（読む人は毎回MINとMAXだけを拾っていた）。
   主役を板厚・板幅のMIN/MAXにし、残りは「値のある項目だけ」1行ずつ。

   **公差の合否はここで言わない**（§CLAUDE 8「同じ情報を2箇所に出さない」）
   ——公差外の件数は③の確認表が数えており、効いている公差はすぐ上の
   `#toleranceList3`が出している。ここが言うのは**測った値の範囲**だけ。

   **N数は必ず添える**（§CLAUDE 6「出どころ・単位・根拠を画面に出す」）
   ——1点しか測っていないMIN/MAXと、80点のMIN/MAXでは当たる見込みが違う。 */
const AN_MAIN=[['板厚','thickness',3],['板幅','width',2]];
/* そのほかの測定項目（§9.216 ⑥、利用者の指示「他の測定項目もカードに
   収まる範囲で出してください。重要度は低めなので折りたたみOK」）。
   **測っていない項目も行として出す**——出さないと「測っていない」のか
   「そもそも項目が無い」のかが読めない（§CLAUDE 4）。
   場所を食わないよう畳んでおき、**畳んだままでも中身が読めるように
   要約へ件数と名前を出す**（§9.125と同じ約束）。 */
const AN_SUB=[['バリ','burr',3],['ラテラルボー','lateral',1],
              ['巻きずれ','offset',1],['テレスコープ','telescope',1],
              ['フラットネス','flatness',1]];
function anRange(a){
 const n=nums(a);if(!n.length)return null;
 return{min:Math.min(...n),max:Math.max(...n),n:n.length};
}
const anNum=(v,d)=>Number(v).toFixed(d);
/* 子ロットごとの板幅（§9.214）。**条は子ロットに属する**ので、分割ありの
   ロットでは「どの子ロットがどの範囲だったか」が出せる。
   **板厚は出せない**——測るのは丈位置ごとに3点で、条には紐づかない。
   出せないものを黙って空欄にせず、そう書く（§CLAUDE 4）。 */
function anLotWidths(){
 const m=S.measure;if(!m)return[];
 const seq=Array.isArray(m.splitSequence)?m.splitSequence:[];
 if(!seq.filter(Boolean).length)return[];
 const rows=m.measurements&&m.measurements.width;
 if(!Array.isArray(rows))return[];
 const bag=new Map();
 for(const line of rows){
  if(!Array.isArray(line))continue;
  line.forEach((v,j)=>{
   const lot=seq[j];if(!lot)return;
   const num=Number(v);
   if(!Number.isFinite(num)||num===0)return;
   const g=bag.get(lot)||[];g.push(num);bag.set(lot,g);
  });
 }
 /* 並びは**条の順**（図と同じ順で読める）。 */
 const seen=[];
 seq.forEach(l=>{if(l&&bag.has(l)&&!seen.includes(l))seen.push(l)});
 return seen.map(lot=>{
  const n=bag.get(lot);
  return{lot,min:Math.min(...n),max:Math.max(...n),n:n.length};
 });
}
function renderStats(){
 const host=$('#stats');if(!host)return;
 const main=AN_MAIN.map(([label,key,dec])=>{
  const r=anRange(S.measure?.measurements?.[key]);
  return `<div class="an-card${r?'':' is-empty'}">`
   +`<div class="an-card-head"><b>${label}</b>`
   +`<small>${r?`${r.n}点`:'まだ測っていません'}</small></div>`
   +(r?`<div class="an-pair">`
      +`<span class="an-slot"><i>MIN</i><b>${anNum(r.min,dec)}</b><em>mm</em></span>`
      +`<span class="an-slot"><i>MAX</i><b>${anNum(r.max,dec)}</b><em>mm</em></span>`
      +`</div>`
      +`<div class="an-span">幅 ${anNum(r.max-r.min,dec)} mm</div>`
     :`<div class="an-none">—</div>`)
   +`</div>`;
 }).join('');
 const subRows=AN_SUB.map(([label,key,dec])=>({label,r:anRange(S.measure?.measurements?.[key]),dec}));
 const measured=subRows.filter(x=>x.r);
 const sub=subRows.map(({label,r,dec})=>
   `<li${r?'':' class="is-empty"'}><span class="an-name">${label}</span>`
   +`<span class="an-val">${r?`${anNum(r.min,dec)} 〜 ${anNum(r.max,dec)}`:'まだ測っていません'}</span>`
   +`<span class="an-n">${r?`${r.n}点`:'—'}</span></li>`).join('');
 const lots=anLotWidths();
 const lotHtml=lots.length>1
  ? `<div class="an-lots"><div class="an-sub-head">子ロットごとの板幅`
    +`<small>板厚は丈位置ごとに3点で測るため、子ロット別には出せません</small></div>`
    +`<ul class="an-lot-list">${lots.map(x=>
       `<li><span class="an-name">${esc(x.lot)}</span>`
       +`<span class="an-val">${anNum(x.min,2)} 〜 ${anNum(x.max,2)}</span>`
       +`<span class="an-n">${x.n}点</span></li>`).join('')}</ul></div>`
  : '';
 /* **畳んでも中身が読める**（§9.125）。要約に「何項目測ったか」と名前を
    並べるので、開かなくても当たりは付く。重要度は板厚・板幅より低いので
    既定は畳んだまま（§9.216 ⑥、利用者の指示）。 */
 const subSummary=measured.length
   ? `測った ${measured.length} / ${subRows.length} 項目（${measured.map(x=>x.label).join('・')}）`
   : `${subRows.length}項目ともまだ測っていません`;
 host.innerHTML=`<div class="an-main">${main}</div>`
  +`<details class="an-sub" id="anSubFold">`
  +`<summary class="an-sub-head">そのほかの測定項目<small>${esc(subSummary)}</small></summary>`
  +`<ul class="an-sub-list">${sub}</ul></details>`
  +lotHtml;
}
function deviceParse(raw){const manual=S.measure?.settings?.inputMode==='manual',v=(manual?String(raw||''):toHalfWidth(String(raw||''))).trim().toUpperCase();if(v==='#DELETEMODE#'||v==='DELETE')return{device:'delete',value:null};if(v.includes('+#L')){const num=Number(v.split('+#L')[1]);return{device:'tape',value:Number.isFinite(num)?num:null}}if(!v.includes('+'))return Number.isFinite(Number(v))?{device:'manual',value:Number(v)}:{device:'invalid',value:null};const [code,data]=v.split('+');let device='invalid';if(code.startsWith('DT1')){const kind=code.slice(-2,-1);device=kind==='0'?'micrometer':kind==='1'?'caliper':kind==='2'?'depth':'invalid'}const num=Number(String(data).replace(/M$/,''));return{device,value:Number.isFinite(num)?num:null}}
function activeMeasureKey(){return WL.measureItem.KEYS[$('#measureType').value]||'width'}
/* ---------- バリは「2回測って差を採る」（§9.242 ③、利用者の指示） ----------
   「1回目のデータを受け付けたことを表示し、2回目入力時にはそのデータの
    計算式も合わせて見える形に表示してください。ただし、表示領域は今の1行の
    範囲内で納めるようにしてください」

   **今までは何も見えていなかった。** 案内は`setState()`＝保存状態のバッジ
   （`#localState`）へ書いていたが、同じ転送処理の末尾で`markDirty()`が
   `未保存（画面の中だけ）`を上書きするため、**1文字も表示されないまま消えて
   いた**（しかも書けていたとしても保存状態を潰していた・§9.212 ④）。

   置き場は**測定の見出しの1行**（`#measureHeadBadges`）——打ち込む欄のすぐ上で、
   行を増やさない（§9.234 ③の「見出しは1行」を崩さない）。出るのはバリの
   ときだけ。3つの状態しか持たない:

     ① 板厚              … 1回目（バリ込みでない板厚）待ち
     ① 2.000 → ② 高さ    … 1回目を受け付けた（受け付けた値をそのまま出す）
     2.150 − 2.000 = 0.150 ▸ ①  … 2回目で確定。**計算式のまま**出す

   **式の控えは記録へ入れない**（`burrEcho`はこのファイルの変数）——差の値は
   既に`measurements.burr`にあり、途中式は「いま何をしたか」を示す画面の
   道具でしかない。**開いている記録が変わったら捨てる**（idで見分ける）。 */
const BURR_DIGITS=3;
const burrNum=v=>{const n=Number(v);return Number.isFinite(n)?n.toFixed(BURR_DIGITS):String(v??'')};
let burrEcho=null;
function burrEchoNow(){
 const m=S.measure;
 return (m&&burrEcho&&burrEcho.id===m.id)?burrEcho:null;
}
/* 1回目を受け取ったら控えは捨てる（前の条の式が残っていると、いま受け付けた
   値の話なのか前の話なのかが読めなくなる）。 */
function burrRemember(rec){burrEcho=rec}
function burrFirstValue(){
 const v=S.measure&&S.measure.settings?S.measure.settings.burrFirst:null;
 return (v===null||v===undefined||v==='')?null:Number(v);
}
function burrStepHtml(){
 if(!S.measure)return '';
 const first=burrFirstValue();
 if(first!==null&&Number.isFinite(first)){
  const tip=`① 板厚 ${burrNum(first)} を受け付けました。`
    +`次は ② バリ込みの高さを測ってください（② − ① がバリの高さとして入ります）。`
    +`測り直すときは測定器の DELETE を送ると ① からやり直せます。`;
  return `<span class="burr-step burr-step--second" title="${esc(tip)}">`
   +`<i class="burr-no">①</i><b class="burr-val">${esc(burrNum(first))}</b>`
   +`<em class="burr-op" aria-hidden="true">▸</em>`
   +`<i class="burr-no burr-no--next">②</i><span class="burr-word">高さ</span></span>`;
 }
 const echo=burrEchoNow();
 if(echo){
  const tip=`${echo.where}: ② ${burrNum(echo.top)} − ① ${burrNum(echo.base)}`
    +` = ${burrNum(echo.diff)}（この差をバリとして記録しました）。次は ① 板厚からです。`;
  return `<span class="burr-step burr-step--done" title="${esc(tip)}">`
   +`<b class="burr-val">${esc(burrNum(echo.top))}</b>`
   +`<em class="burr-op" aria-hidden="true">−</em>`
   +`<b class="burr-val">${esc(burrNum(echo.base))}</b>`
   +`<em class="burr-op" aria-hidden="true">=</em>`
   +`<b class="burr-val burr-val--diff">${esc(burrNum(echo.diff))}</b>`
   +`<em class="burr-op" aria-hidden="true">▸</em><i class="burr-no">①</i></span>`;
 }
 const tip='① バリの無いところの板厚を測ってください。'
   +'続けて ② バリ込みの高さを測ると、その差がバリの高さとして入ります。';
 return `<span class="burr-step burr-step--first" title="${esc(tip)}">`
  +`<i class="burr-no burr-no--next">①</i><span class="burr-word">板厚</span></span>`;
}
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
/* カーソルの移動は**入れ子では行わない**（§9.208 ③）。`el.focus()`は
   `focus`イベントを起こし、そのハンドラ（`bindMeasureInputs`の追従処理と、
   `measurement-tolerance.js`が足す選択処理）が**また`focusCurrent()`を
   呼ぶ**ので、素直に書くと行って来いで積み上がる（実測で
   「Maximum call stack size exceeded」）。1回の移動の中では動かさない。 */
let caretMoving=false;
function moveCaretTo(el){
 if(!el||caretMoving)return;
 if(S.measure?.settings?.inputMode!=='manual')return;   /* 自動転送は§9.122で受信欄に固定 */
 if(document.activeElement===el||el.disabled)return;
 caretMoving=true;
 try{el.focus({preventScroll:true})}catch(e){try{el.focus()}catch(_){}}
 finally{caretMoving=false}
}
function focusCurrent(){
 document.querySelectorAll('[data-mkey]').forEach(x=>x.classList.remove('current'));
 const m=S.measure.settings,key=activeMeasureKey(),li=lengthIndex();
 /* 板厚は**丈ごとに3点**（エッジOS・中央CL・エッジDS）なので、進む先を持つのは
    条ごとの`wStep`ではなく`tStep`。 */
 const step=key==='thickness'?(m.tStep||0):(m.wStep||0);
 const el=document.querySelector(`[data-mkey="${key}"][data-i="${li}"][data-j="${step}"]`);
 if(el){el.classList.add('current');el.scrollIntoView({block:'nearest',inline:'nearest'});
  /* ---------- 印とカーソルを一致させる（§9.208 ③、利用者の指摘） ----------
     手動入力では「クリックしても・入れても**フォーカスが動かない**」
     ——印(`.current`)だけが進み、打った文字は前の枠に入り続けていた。
     印を動かす道具はここ1本なので、**手動のときだけ**ここで
     カーソルも連れて行く。
     **自動転送のときは絶対に触らない**（§9.122）——受信欄から
     フォーカスが外れた瞬間に転送を1件も受けなくなる。 */
  moveCaretTo(el);
 }
 const slot=key==='thickness'?(WL.measureItem.slotLabels('thickness')[step]||String(step+1)):`条 ${step+1}`;
 /* **短く言い、名前は`title`へ**（§9.234 ③。見出しは1行に収める）。
    「入力位置」の4文字は、この欄が入力位置を指していることを毎回言い直して
    いるだけで、値（丈と条）を読めば分かる。 */
 const at=$('#stepStatus');
 at.textContent=`丈${li+1}・${slot.replace(/\s+/g,'')}`;
 at.title='いま入力する位置（丈・条）';
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
 const p=deviceParse(raw),m=S.measure,st=m.settings,type=$('#measureType').value,li=lengthIndex();$('#deviceInput').classList.remove('device-ok','device-error');if(p.device==='invalid'||p.value===null&&p.device!=='delete'){setState('入力形式エラー');$('#deviceInput').classList.add('device-error');$('#deviceInput').value='';refocusDeviceInput();return}if(p.device==='delete'){const key=activeMeasureKey(),j=key==='thickness'?(st.tStep||0):(st.wStep||0);if(m.measurements[key])m.measurements[key][li][j]='';
  /* **バリはDELETEで①からやり直せる**（§9.242 ③）。差がマイナスのときの
     案内が「DELETEして再測定してください」と言っているのに、1回目の控え
     （`burrFirst`）が残ったままでは②のまま——**言ったとおりにならない**
     （押せるのに何も起きないのと同じ・§4）。 */
  if(key==='burr'){st.burrFirst=null;burrRemember(null)}
  renderMeasureGrid();markDirty();refocusDeviceInput();return}
 /* 板厚と板幅は別々の入力内容(§9.138)。使う測定器も枠の数も違うので、
    受け取れる機種もここで項目ごとに分かれる（バリ＝マイクロメータ、
    テレスコープ＝デプスゲージ と同じ形）。 */
 if(type==='板厚'){
  if(!['micrometer','manual'].includes(p.device))return inputError('板厚はマイクロメータを使用してください');
  const j=st.tStep||0;m.measurements.thickness[li][j]=p.value.toFixed(3);st.tStep=(j+1)%3;st.pendingDevice='micrometer'
 }else if(type==='板幅'){
  if(!['caliper','tape','manual'].includes(p.device))return inputError('板幅はノギスまたはコンベックスを使用してください');
  /* **板幅は測定器によらず小数2桁**（§9.242 ②、利用者の指示）。以前は
     ノギスだけ2桁・コンベックスは1桁だったが、入口の`processDeviceInput()`が
     どちらも1桁へ丸めてから渡していたため、**ノギスの2桁目は必ず0**だった
     （設定としては2桁なのに一度も効いていない）。桁数は`measurementDigits()`
     の1箇所が答える。 */
  const j=st.wStep||0;m.measurements.width[li][j]=fixedMeasurementValue('width',p.value);st.pendingDevice='width';advanceWidth()
 }else if(type==='バリ'){
  /* 段の案内は**見出しのバッジ**が出す（§9.242 ③）。`setState()`へ書いて
     いた頃は、この関数の末尾の`markDirty()`が保存状態で上書きするため
     **一度も表示されなかった**（しかも保存状態を潰していた・§9.212 ④）。 */
  if(!['micrometer','manual'].includes(p.device))return inputError('バリはマイクロメータを使用してください');
  const j=st.wStep||0;
  if(st.burrFirst===null||st.burrFirst===undefined){
   st.burrFirst=p.value;burrRemember(null);
  }else{
   const diff=p.value-st.burrFirst;
   if(diff<0)return inputError('測定値がマイナスになります。DELETEして再測定してください');
   m.measurements.burr[li][j]=Math.abs(diff).toFixed(BURR_DIGITS);
   /* **計算式は「どの枠の話か」まで控える**（§6）——条が進んだあとに式だけ
      残ると、いま光っている枠の値と読み違える。 */
   burrRemember({id:m.id,base:st.burrFirst,top:p.value,diff:Math.abs(diff),
     where:`${$('#lengthPos')?.value||''} ${j+1}条`.trim()});
   st.burrFirst=null;advanceWidth();
  }
 }else if(type==='テレスコープ'){
  if(!['depth','manual'].includes(p.device))return inputError('テレスコープはデプスゲージを使用してください');m.measurements.telescope[li][st.wStep||0]=p.value.toFixed(2);advanceWidth()
 }else{const key=activeMeasureKey();m.measurements[key][li][st.wStep||0]=type==='ラテラルボー'?(Math.ceil(p.value*2)/2).toFixed(1):p.value.toFixed(1);advanceWidth()}
 /* 自動で記録する時刻（§9.143）。**転送は「転送」として数える**——
    手入力と混ぜると「転送を受け始めた時刻」が作れない。 */
 WL.workStamp.note('transfer');
 $('#deviceInput').classList.add('device-ok');$('#deviceInput').value='';renderMeasureGrid();renderStats();markDirty();focusCurrent();refocusDeviceInput()
}
/* 受信処理の入口。板幅のノギス系値は`measurementDigits('width')`の桁へ
   丸めてから本処理へ渡し（§9.242 ②）、処理後は診断用に直前受信の生データと
   結果を#deviceLastReceivedへ記録する。 */
function processDeviceInput(raw){
 const pad2=n=>String(n).padStart(2,'0'),d=new Date(),ts=`${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
 const type=$('#measureType')?.value,parsed=deviceParse(raw);
 let result;
 if(type==='板幅'&&parsed.value!==null&&Number.isFinite(parsed.value)&&['caliper','tape','manual'].includes(parsed.device)){
  /* 丸めるのは**`measurementDigits('width')`の桁**（§9.242 ②）。ここに
     桁数を直に書くと、`base.js`の桁数を上げてもこちらが先に落として
     しまう（実際に2桁の設定が1桁で潰されていた）。 */
  const normalized={...parsed,value:Number(parsed.value.toFixed(measurementDigits('width')))};const original=deviceParse;deviceParse=()=>normalized;
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
function updateReceiveState(focused=document.activeElement===$('#deviceInput')){if(!S.measure)return;const manual=S.measure.settings.inputMode==='manual',box=$('#inputStatusBox'),inp=$('#deviceInput');box.classList.remove('receiving','manual-state','not-ready-state');inp.classList.remove('manual-receive','locked-receive');if(manual){box.classList.add('manual-state');inp.classList.add('manual-receive');$('#inputReady').textContent='手動入力モード';$('#inputModeHelp').textContent='直接入力・Enterで確定';$('#receiveLock').textContent='手入力許可';inp.placeholder='必要に応じて数値を入力'}else if(focused){box.classList.add('receiving');$('#inputReady').textContent='伝送入力受付中';$('#inputModeHelp').textContent='転送待ち・Tabで確定';$('#receiveLock').textContent='転送専用';inp.placeholder='測定器データ受信専用'}else{box.classList.add('not-ready-state');inp.classList.add('locked-receive');$('#inputReady').textContent='伝送入力停止中';$('#inputModeHelp').textContent='クリックで受付再開';$('#receiveLock').textContent='受付停止';inp.placeholder='クリックして伝送受付を再開'}
 /* バッジは**2文字**（§9.209 ③）。詳しい状態（受付中／停止中）は同じ帯の
    `title`で読める——見出しの1行に置くので、ここは「いまどちらのやり方で
    入れているか」だけを言う。 */
 const label=$('.auto-mode-label');
 if(label)label.textContent=manual?'手動':'自動';
 /* **なぜそのやり方なのか**まで`title`に入れる（§6）。項目によっては
    こちらでは選べない（測定器が無い／転送しか使わない）ので、
    「切り替えたいのに切り替えられない」の理由がここで読める。 */
 const forced=box.dataset.forced||'';
 const why=forced==='manual'?' ／ この項目は測定器から転送できないので手入力です'
  :forced==='auto'?' ／ この項目は測定器からの転送だけで入れます':'';
 box.title=`${manual?'手動入力':'自動転送'}: ${$('#inputReady').textContent} ／ ${$('#inputModeHelp').textContent}${why}`;}$('#deviceInput').onfocus=()=>updateReceiveState(true);$('#deviceInput').onblur=()=>updateReceiveState(false);
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
 /* 入力内容・丈位置を移るキー(`→ ←` / `PageUp/PageDown` / `F2`)は持たない
    (§9.160)。転送を受けている最中に測定表が描き直されるとフォーカスが
    受信欄から外れ、そのあいだの転送が行き場を失うため。**自動入力が優先。** */
 else if(e.key==='ArrowUp'){e.preventDefault();retreatSlot();focusCurrent()}
};
/* 丈位置を変えたら描き直す。**受信欄へ戻すのは自動転送のときだけ**
   （§9.208 ③）——手動入力で戻すと、せっかく移した印の枠から
   カーソルだけが受信欄へ飛ぶ。 */
$('#lengthPos').onchange=()=>{renderMeasureGrid();
 if(S.measure?.settings?.inputMode!=='manual')$('#deviceInput').focus()};
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
 document.querySelectorAll('[data-mkey]').forEach(x=>{
  /* マイナス禁止・「.5」の省略打ち・全角は`WL.numericInput`が引き受ける
     （§9.208 ③）。**フラットネスだけは対象外**——〇/△/×と自由記述の欄で、
     数字しか通さないと記号が消える。
     **`oninput`を割り当てる前に付けること**——`input`は登録順に走るので、
     後から付けると配列へ生の値（`-`つき）が入ってしまう。 */
  if(x.dataset.mkey!=='flatness')WL.numericInput.attach(x);
  judgeInput(x,x.dataset.mkey,Number(x.value),+x.dataset.j);x.onclick=()=>{
   /* **押した枠がいま測る枠**（§9.208 ③）。丈も一緒に合わせてから印を移す
      ——先に印だけ動かすと、直後の描き直しで一度別の丈へ跳ねて見える。
      丈が変われば`#lengthPos`のchangeが描き直し、その中で`focusCurrent()`が
      走るので、ここでは変わらなかったときだけ自分で印を移す。 */
   syncStepFor(x);
   if(!gotoLengthSlot(+x.dataset.i))focusCurrent();
   if(S.measure.settings.inputMode!=='manual')$('#deviceInput').focus();
  };
  // 手動モードでは、クリックだけでなくTabキー等の操作で実際に
  // フォーカスが移動した場合も、強調表示(.current)をそのセルへ
  // 追従させる(自動モードは受信欄にフォーカスを固定するため対象外)。
  x.addEventListener('focus',()=>{
   if(S.measure.settings.inputMode!=='manual')return;
   /* **こちらが動かしたぶんは追いかけない**（§9.208 ③の再入防止と対）。
      `focusCurrent()`→`moveCaretTo()`→`focus`とここへ戻ってくるため、
      追いかけると同じ枠のために表を組み直すことになる。 */
   if(caretMoving)return;
   syncStepFor(x);
   /* **丈も合わせる**（§9.221 ⑧）。以前は条(`wStep`)だけを合わせていたので、
      隣の丈の枠へ入ると印は元の丈に残り、`moveCaretTo()`がカーソルを
      そちらへ引き戻していた（打った文字が別の丈へ入る）。 */
   if(!gotoLengthSlot(+x.dataset.i))focusCurrent();
  });
  x.oninput=()=>{m.measurements[x.dataset.mkey][+x.dataset.i][+x.dataset.j]=x.value;judgeInput(x,x.dataset.mkey,Number(x.value),+x.dataset.j);renderStats();WL.workStamp.note('manual');markDirty()};x.onkeydown=e=>{if(S.measure.settings.inputMode!=='manual'){e.preventDefault();return}if(e.key==='Delete'){x.value='';x.oninput()}if(e.key==='Enter'){e.preventDefault();advanceSlot();focusCurrent()}}})

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

 const mother=WL.measureItem.isMaterial($('#measureType')?.value);
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
/* 寸法3つの実カラム名。板厚=X／板幅=Y／板丈=Z は仕掛データ全体の約束
   （`JUX/JUY/JUZ`・`LTX/LTY/LTZ` と同じ並び）。板丈は§9.157で足した。
   **全角/半角のゆれがあるので候補を並べる**——`exactFieldNumber`が
   実在するものを選ぶ（当たらなければ「公差なし」で、黙って0にはしない）。 */
const TOL_DIMENSIONS={
 thickness:{label:'板厚',jp:'板厚',ax:'X',digits:3,baseKey:'mfgThickness'},
 width:    {label:'板幅',jp:'板幅',ax:'Y',digits:1,baseKey:'mfgWidth'},
 length:   {label:'板丈',jp:'板丈',ax:'Z',digits:1,baseKey:'mfgLength'},
};
function toleranceDataForSource(kind,source){
 const d=TOL_DIMENSIONS[kind];if(!d)return null;
 const dimension=d.jp,ax=d.ax,fields={
  manufacturing:{plus:[`${dimension}公差_製造_ﾌﾟﾗｽ`,`${dimension}公差_製造_プラス`,`KOSA${ax}SMP`],
                 minus:[`${dimension}公差_製造_ﾏｲﾅｽ`,`${dimension}公差_製造_マイナス`,`KOSA${ax}SMM`]},
  order:{plus:[`${dimension}公差_ｵｰﾀﾞｰ_ﾌﾟﾗｽ`,`${dimension}公差_オーダー_プラス`,`KOSA${ax}SOP`],
         minus:[`${dimension}公差_ｵｰﾀﾞｰ_ﾏｲﾅｽ`,`${dimension}公差_オーダー_マイナス`,`KOSA${ax}SOM`]}};
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
 const type=typeName||$('#measureType')?.value||S.measure?.settings?.measureType||'',isDimensional=WL.measureItem.isDimensional(type),b=S.measure.basic,
   base=Number(b[(TOL_DIMENSIONS[kind]||TOL_DIMENSIONS.width).baseKey]);
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
   完了前の確認の「直す」・帳票まで全部がこれを見る。
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
/* 公差の内訳（基準・公差±・判定範囲）の3行帯は**廃止した**（§9.234 ③）。
   §9.146で「40条以上のときは畳む」ボタンを付けていたが、そもそも同じ内容を
   `#toleranceSummary`のピル1つ（＋`title`）が言えるので、見出しに280pxの帯を
   置く理由が無い——1行に収める指示（利用者）とも両立しない。
   畳むボタン（`#tolFold`）と`.tol-foldable`／`.tol-open`もまとめて撤去した。 */
/* 判定公差の切り替え欄は**押したときだけ出す**（§9.159）。既定で畳んで
   おくのは、製造公差のまま測るのがほとんどで、常設すると測定中いちばん
   見る帯に「選ぶもの」が居座るため。いま効いている公差はヘッダーの文脈
   バーが常に出しているので、ここは入口だけでよい。 */
document.addEventListener('click',e=>{
 const btn=e.target.closest&&e.target.closest('#tolSourceFold');
 if(!btn)return;
 const pick=document.getElementById('toleranceSourcePick');if(!pick)return;
 const open=pick.hidden;
 pick.hidden=!open;
 btn.setAttribute('aria-expanded',String(open));
 if(open)document.getElementById('toleranceSource')?.focus();
});
/* ---------- 図の見せ方は「アイコン1つ＋浮き窓」（§9.210 ①、利用者の指示） --
   §9.208 ④で畳んだが、**畳んだ先が同じ帯の中**だったため、開くとその場で
   2つのプルダウンが生えて行が1本増えていた（実機で見出しが3行）。設定を
   確かめるたびに測定表が縮むのでは、畳んだ意味が半分しかない。
   中身は**器の外の浮き窓**（`body`直下・`position:fixed`）へ出す
   ——`overflow`を持つ先祖に切られない（§9.201）。開いているあいだも
   測定表の面積を1pxも取らない。
   窓の中は**選ぶ前に見える**形にする（§9.200）: 横軸は2枚のカードで
   「どう変わるか」を小さな図と1行の説明つきで並べ、表示幅は候補を全部
   出して押すだけにする。 */
const NL_PANEL_ID='numberlinePanel';
const NL_MODE_HELP={
 abs:'各条の基準を中心に重ねて、基準からの差を mm で見ます。公差の広い条ほど帯が広く出ます。',
 rel:'その条自身の公差で割ります。下限・上限が全条でそろうので、外れ方の大小をくらべやすくなります。',
};
/* カードの中の小さな図。**2枚が同じ絵にならないこと**が値打ちなので、
   実寸＝帯の幅がばらばら／公差比＝帯の幅がそろう、を描き分ける。 */
function nlModeArt(mode){
 const bars=mode==='rel'?[[18,64],[18,64],[18,64]]:[[10,80],[26,48],[18,64]];
 return '<svg class="nl-art" viewBox="0 0 100 40" aria-hidden="true">'
  +'<line x1="50" y1="2" x2="50" y2="38" class="nl-art-center"/>'
  +bars.map(([x,w],i)=>`<rect class="nl-art-band" x="${x}" y="${5+i*11}" width="${w}" height="7" rx="2"/>`).join('')
  +'</svg>';
}
function ensureNumberlinePanel(){
 let el=document.getElementById(NL_PANEL_ID);
 if(el)return el;
 el=document.createElement('div');
 el.className='sc-float-win nl-win';el.id=NL_PANEL_ID;el.hidden=true;
 el.innerHTML=`
  <div class="sc-float-header"><div><h2>図の見せ方</h2>
    <small>公差の図（数直線）の描き方。測定した値そのものは変わりません</small></div>
   <button type="button" id="nlPanelClose" title="閉じる">×</button></div>
  <div class="sc-float-body nl-body">
   <section class="nl-sec">
    <b class="nl-sec-head">横軸の取り方</b>
    <div class="nl-choices" id="nlModeChoices"></div>
   </section>
   <section class="nl-sec">
    <b class="nl-sec-head">表示幅（軸の端をどこまで広げるか）</b>
    <div class="nl-spans" id="nlSpanChoices"></div>
    <p class="nl-note">大きくするほど公差から外れた値まで図に入りますが、そのぶん公差帯は細くなります。</p>
   </section>
   <p class="nl-state" id="nlState"></p>
  </div>
  <div class="sc-float-resize" title="ドラッグで大きさを変えられます"></div>`;
 document.body.appendChild(el);
 el.querySelector('#nlPanelClose').onclick=()=>closeNumberlinePanel();
 el.addEventListener('keydown',e=>{if(WL.modal.escCloses(e)){e.stopPropagation();closeNumberlinePanel()}});
 /* **押した先は1つ**（`WL.numberline.set`）。覚えるのも描き直すのも
    あちらが持っているので、ここは押されたことを伝えるだけ。 */
 el.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('[data-nl-mode],[data-nl-span]');
  if(!b)return;
  if(b.dataset.nlMode)WL.numberline.set('mode',b.dataset.nlMode);
  else WL.numberline.set('span',b.dataset.nlSpan);
 });
 if(typeof WL.makeFloatingWindow==='function')
  WL.makeFloatingWindow(el,{storageKey:'measureNumberlinePanelRectV1',
    defaultWidth:430,defaultHeight:490,defaultTop:96,minWidth:320,minHeight:300});
 else console.error('図の見せ方: WL.makeFloatingWindow が見つかりません');
 return el;
}
function openNumberlinePanel(){
 const el=ensureNumberlinePanel();
 el.hidden=false;
 document.getElementById('numberlineFold')?.setAttribute('aria-expanded','true');
 syncNumberlineControls();
}
function closeNumberlinePanel(){
 const el=document.getElementById(NL_PANEL_ID);
 if(el)el.hidden=true;
 document.getElementById('numberlineFold')?.setAttribute('aria-expanded','false');
}
document.addEventListener('click',e=>{
 const btn=e.target.closest&&e.target.closest('#numberlineFold');
 if(!btn)return;
 const el=document.getElementById(NL_PANEL_ID);
 if(el&&!el.hidden)closeNumberlinePanel();else openNumberlinePanel();
});
/* 軸からはみ出した点の案内から、その場で開けるようにする（§2「次にする
   ことを1つだけ指す」）。畳んだ先に打つ手があることを文で言い、押せば開く。 */
document.addEventListener('click',e=>{
 const note=e.target.closest&&e.target.closest('#numberlineOutside');
 if(!note)return;
 openNumberlinePanel();
});
/* 測定を閉じたら窓も閉じる——画面に残っても当てる先が無い。**閉じる経路は
   4箇所ある**（×・地・保存して閉じる・破棄）ので、経路ごとに書き足さず
   「閉じたことを見る」。読むだけなので、`hidden`を書いて回る形にはしない
   （同じ値でも変更記録が積まれる。§9.131）。 */
WL.onReady(()=>{
 const modal=document.getElementById('measureModal');
 if(!modal)return;
 new MutationObserver(()=>{if(modal.hidden)closeNumberlinePanel()})
   .observe(modal,{attributes:true,attributeFilter:['hidden']});
});
WL.numberlinePanel={open:openNumberlinePanel,close:closeNumberlinePanel};
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
/* 丈の見出しを押したときは、その丈の**先頭の枠**から始める（§9.208 ③、
   利用者の指示「丈クリックを行った場合、一番近い隣の条の入力にフォーカスを
   移動させてください」）。並びは条入力順の設定に従う（奇数条優先なら
   その並びの先頭）。**セルを押したときは動かさない**——押した枠そのものが
   行き先なので、そこで先頭へ戻すと押した意味が消える。 */
function startSlotOfLength(){
 const st=S.measure&&S.measure.settings;if(!st)return;
 if(activeMeasureKey()==='thickness'){st.tStep=0;return}
 const seq=widthSequence(Math.max(1,+$('#horizontalCount').value||1),
                         $('#widthOrder').value,$('#widthDirection').value);
 st.wStep=seq[0]||0;
}
document.addEventListener('click',e=>{
 const btn=e.target.closest&&e.target.closest('[data-mx-len]');
 if(btn){
  e.preventDefault();
  startSlotOfLength();
  /* 同じ丈を押したときは描き直しが起きないので、自分で印とカーソルを移す。 */
  if(!gotoLengthSlot(Number(btn.dataset.mxLen)))focusCurrent();
  return;
 }
 /* セルを押したときの丈の移動は**持ち主（`bindMeasureInputs`のonclick）が
    持つ**（§9.208 ③）。ここにも書くと、印を移す順番が2通りできる。 */
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
 /* ---------- フラットネスの一括入力（§9.233 ④、利用者の指示） ----------
    「右側のフラットネス入力欄の上部の表示やボタン類が2行になってしまって
      おり、1行に収まるようにボタンや表示のコンパクト化アイコン化を検討し、
      他の入力項目と同じように1行で表示してください」
    ——見出しの塊は`.mhead-line`が2つで、フラットネスだけ**約200px多い**ため
    1680px以下（表示サイズ「大」では1920pxでも）で2行になっていた。
    **文字で説明していた「現在の条へ入力」は`title`／`aria-label`へ移す**
    ——記号3つは打ち込む値そのものなので、押す前に何が入るかは読める。
    「全条 〇」は同じ群の中へ入れて`|`で区切る（器と隙間をひとつ減らす）。 */
 const bulkBtn=type==='フラットネス'
   ?'<span class="flat-pick-group" role="group" aria-label="現在の条へ記号を入力"'
     +' title="押した記号を、いま選んでいる条へ入れます（〇=OK／△×=NG）">'
     +'<button type="button" class="flat-pick" data-sym="〇" title="いまの条を〇（OK）にします">〇</button>'
     +'<button type="button" class="flat-pick" data-sym="△" title="いまの条を△（NG）にします">△</button>'
     +'<button type="button" class="flat-pick" data-sym="×" title="いまの条を×（NG）にします">×</button>'
     +'<b class="flat-pick-sep" aria-hidden="true"></b>'
     +'<button type="button" id="flatAllOk" class="flat-pick flat-pick-all"'
     +' title="この丈のすべての条を〇（OK）にします">全〇</button>'
     +'</span>'
   :'';
 const tol=WL.measureTolerance.parts(actualKey,values,slots);
 /* ---------- 見出しは「測定」の1行へ集約する（§9.209 ③④、利用者の指示） ----------
    以前は表の上にもう1本、項目名と「測定待ち」だけの帯（26px）があった。
    「測定」と書いてある行と**同じことを2箇所**に出していたうえ、多条の
    ロットでは行が1本足りないだけで条が2つ隠れる。バッジにして1行へ寄せる。 */
 const head=$('#measureHeadBadges');
 /* 進捗は**いま選んでいる丈だけ**の数（②のチップは全丈の合算なので別の数）。
    1行に収めるために縮み代を持つので、**全文は`title`で読めるようにする**。 */
 /* バリの2段（§9.242 ③）は**この1行の中**に置く。項目名・進捗と同じ器なので
    行は増えない。出るのはバリのときだけ。 */
 const burrBadge=type==='バリ'?burrStepHtml():'';
 if(head)head.innerHTML=`<b class="mhead-item">${esc(type)}</b>`
   +`<span class="mhead-status" title="${esc(`この丈の進み: ${compactMeasureStatus(done,slots)}`)}">`
   +`${esc(compactMeasureStatus(done,slots))}</span>`+burrBadge+bulkBtn;
 let h=`<section class="measure-grid-block compact-other"><div class="matrix-body${tol.graph?'':' no-graph'}"><aside class="compact-tolerance-side">${tol.graph}</aside>`;
 h+=measureMatrixHtml(actualKey,slots,type);
 h+='</div></section>';
 if(type==='フラットネス')h+=`<section class="measure-grid-block flatness-note-block"><div class="measure-grid-block-title"><span>備考</span></div><div class="flatness-entry"><label>対象条<select id="coilNo"></select></label><label>備考<textarea id="coilComment"></textarea></label></div></section>`;
 $('#measurementGrid').innerHTML=h;
 /* 公差を言う場所は**1つだけ**（§9.129／§9.209 ②）。
      板厚・板幅（寸法系）… 図があるなら数直線の隣の公差カード、
                            図が無いなら（＝公差が無い）ここのピル
      それ以外            … `#toleranceSummary`のピル（`updateMeasurementHeading`）
    3つとも「公差なし」を出せるので、**どれか1つに絞ってから描く**。 */
 /* **図が無い項目では「図の見せ方」を出さない**（§4／§9.234 ③）。
    公差の無い項目（ラテラルボー・フラットネス等）では数直線そのものが
    作られないので、押しても当てる先が無い。1行の場所も26px空く。 */
 {const nlBtn=document.getElementById('numberlineFold'),want=!tol.graph;
  if(nlBtn&&nlBtn.hidden!==want){nlBtn.hidden=want;
   if(want&&WL.numberlinePanel)WL.numberlinePanel.close()}}
 alignToleranceChart();
 syncNumberlineControls();
 bindMeasureInputs();applyInputProtection();focusCurrent();updateMeasurementHeading();
 /* 器に入るかは**描き終えてから**しか分からない（§9.209 ③⑤）。 */
 requestAnimationFrame(()=>{try{fitMeasureMatrix()}catch(e){}});/* 寸法系（板厚・板幅）は横長の公差バーを出さない。数直線の隣の公差カード
   （`.compact-tolerance-side`）が基準値・公差±・判定範囲を既に持っており、
   **同じ数字を画面に2つ出さない**（§9.129。項目を分ける前の板厚/板幅と
   同じ扱いを、分けた後の両方へそのまま引き継ぐ）。 */
/* **公差はピル1つが言う**（§9.234 ③）。以前は寸法系のときだけ隠して
   内訳の3行帯（`#toleranceFacts`）へ渡していたが、その帯が見出しを2行に
   していた。数直線（図）は「どのへんか」、ピル（値）は「範囲はいくつか」で
   **別の問いに答える**ので、両方あってよい（§9.140）。内訳（基準値・
   公差±・出どころの列名）はピルの`title`が持つ。 */
const summary=$('#toleranceSummary');if(summary&&summary.hidden)summary.hidden=false;
 if(type==='フラットネス'){
  updateCoilOptions($('#horizontalCount').value);
  $('#coilNo').onchange=()=>{saveFlatComment();loadFlatComment()};
  $('#coilComment').onchange=()=>{saveFlatComment();markDirty()};
  $('#flatAllOk').onclick=()=>{const j=lengthIndex(),n=Math.max(1,+$('#horizontalCount').value||1);for(let c=0;c<n;c++)m.measurements.flatness[j][c]='〇';renderMeasureGrid();markDirty()};
  loadFlatComment();
  bindFlatnessInputs();
 }
}
/* ---------- 表は器に入るぶんだけ縮める（§9.209 ③⑤、利用者の指示） ----------
   「25条程度から怪しいので、**高さが足りないでスクロールが出る場合に限り**、
    出ないように縦方向のテキストボックスの高さを条数で割り戻して入りきるように」
   「丈表示エリアが不足する場合も同様に横方向の表示範囲内にフィットさせる。
    丈5以上の場合はあきらめて、スクロールを使用する」

   **25条まで（`mx-roomy`）は足りないときだけ縮める。** 入っているのに
   縮めると、8条のロットで1行が19pxになって狙って押せなくなる
   （§9.146で一度そうなっている）。
   **26条から（`mx-dense`）は余っていても割り当てる**（§9.210 ②、利用者の
   指示「広がった領域に対して条数で割った高さ寸法をUIの高さ寸法に使用する」）。
   **下限を割ったら諦めてスクロールへ倒す**——読めない大きさまで縮めるのは
   スクロールより悪い。
   **測ってから決める。** 行の外寸は罫線・余白・表示サイズで変わるので、
   「トークンから計算」ではなく**実際に描いた表を測って差分を引く**
   （§9.95の行の高さと同じ作法）。1回で足りなければもう1回だけ詰める
   ——回し続けると描き直しのたびに揺れる。 */
const MX_MIN_ROWH=15,MX_MIN_COLW=44,MX_FIT_MAX_SLOTS=5,MX_FIT_PASSES=3;
/* 26条以上のときの1行の上限。**器いっぱいに配る**のが狙いだが、上限が
   無いと丈1本のロットで行だけが間延びする（表は縦に条を並べるものなので、
   1行が操作系の器（`--ctl-h`）より高くなる理由が無い）。 */
const MX_MAX_ROWH=36;
function fitMeasureMatrix(){
 const table=document.querySelector('#measurementGrid .measure-matrix');
 const body=document.querySelector('#measurementGrid .matrix-body');
 if(!table||!body)return;
 table.style.removeProperty('--mx-rowh');
 table.style.removeProperty('--mx-colw');
 table.classList.remove('mx-fitted');
 const rows=(table.tBodies[0]&&table.tBodies[0].rows.length)||0;
 const slots=Number(table.style.getPropertyValue('--mx-cols'))||0;
 if(!rows)return;
 /* ---- 縦: 空いている高さを条数で割る（§9.210 ②、利用者の指示） ----
    以前は「溢れたぶん÷条数」を1pxずつ余分に引きながら最大3回まわして
    いた。25条までは`mx-roomy`が30px固定で入るのに、**26条で`mx-dense`へ
    切り替わった瞬間**に器いっぱいへ引き伸ばす作りへ変わり、入力欄だけが
    自分の高さ（`--row-inner-h`）へ落ちて**一気に小さく**見えていた。
    やることは1つ——**いま余っている（足りない）高さを条数で割って、
    1行の外寸をその場で決める**。26条以上（`mx-dense`）は余っていても
    割り当てる（縦を使い切る）。25条までは今までどおり**足りないときだけ**
    縮める（入っているのに縮めると8条のロットで1行19pxになる。§9.146）。
    **測ってから決める**——罫線・余白・表示サイズで外寸は変わるので、
    トークンから計算しない（§9.95の行の高さと同じ作法）。 */
 const dense=table.classList.contains('mx-dense');
 /* 26条以上は**測る前に固定高さへ寄せる**。`mx-dense`の素の姿は
    `height:100%`＝器いっぱいへ引き伸ばす作りで、そのままだと「溢れも
    余りも0」と出てしまい1度も割り当てが走らない（そして入力欄だけが
    自分の高さへ落ちる＝これが「一気に小さく」の正体）。上限から始めて
    下へ寄せる。 */
 if(dense){
  table.classList.add('mx-fitted');
  table.style.setProperty('--mx-rowh',MX_MAX_ROWH+'px');
 }
 /* **合わせ込むのは「こちらが決める値」（`--mx-rowh`）で、測った行の外寸
    ではない。** 行の外寸は罫線1pxぶん必ず`--mx-rowh`より大きいので、
    測った外寸から引いて代入すると1px手前で足踏みして収束しない
    （40条で10px溢れたまま止まっていた）。測るのは溢れ、直すのは変数。 */
 const rowhNow=()=>{
  const v=parseFloat(getComputedStyle(table).getPropertyValue('--mx-rowh'));
  return Number.isFinite(v)&&v>0?v
    :table.tBodies[0].rows[0].getBoundingClientRect().height;
 };
 /* **器の内側の余白まで数える。** `clientHeight`は余白を含む（＝中身に
    使えるのはそれより余白ぶん少ない）ので、表の高さと直に引き比べると
    **余白ぶんだけ足りないまま「入った」と読む**（実測4px。40条で
    スクロールが残っていた）。表以外が溢れている場合もあるので、
    実際の溢れ（`scrollHeight`）と大きいほうを採る。 */
 const bcs=getComputedStyle(body);
 const bodyPad=(parseFloat(bcs.paddingTop)||0)+(parseFloat(bcs.paddingBottom)||0);
 const overNow=()=>{
  const byTable=table.getBoundingClientRect().height+bodyPad-body.clientHeight;
  const byBox=body.scrollHeight-body.clientHeight;
  /* 足りない＝プラス、余り＝マイナス。`scrollHeight`は器より小さくならない
     ので、**余っているかどうかは表の側でしか分からない**。 */
  if(byTable>0)return Math.max(byTable,byBox);
  return byBox>0?byBox:byTable;
 };
 let rowh=rowhNow();
 for(let pass=0;pass<MX_FIT_PASSES;pass++){
  const over=overNow();
  if(over<=0&&!dense)break;                 /* 25条までは足りているなら触らない */
  if(Math.abs(over)<1)break;                /* ぴったり */
  const next=Math.max(MX_MIN_ROWH,Math.min(MX_MAX_ROWH,
    Math.floor((rowh-over/rows)*100)/100));
  if(Math.abs(next-rowh)<0.05)break;
  rowh=next;
  table.style.setProperty('--mx-rowh',rowh+'px');
  table.classList.add('mx-fitted');
  /* 下限・上限で止まったらそれ以上は動かない（諦めてスクロールへ倒す）。 */
  if(rowh<=MX_MIN_ROWH||rowh>=MX_MAX_ROWH)break;
 }
 /* ---- 横: 丈が入りきるように1列を縮める（丈5以上は諦めてスクロール） ---- */
 const room=table.parentElement?table.parentElement.clientWidth:0;
 if(slots&&slots<=MX_FIT_MAX_SLOTS&&room>0){
  for(let pass=0;pass<MX_FIT_PASSES;pass++){
   const over=Math.ceil(table.getBoundingClientRect().width-room);
   if(over<=0)break;
   const head=table.tHead&&table.tHead.rows[0];
   const cell=head&&head.cells[head.cells.length-1];
   const cur=cell?cell.getBoundingClientRect().width:0;
   const next=Math.floor(cur-over/slots)-1;
   if(!(next>=MX_MIN_COLW)||!(next<cur))break;
   table.style.setProperty('--mx-colw',next+'px');
   table.classList.add('mx-fitted');
  }
 }
}
WL.measureFit={matrix:fitMeasureMatrix};
function focusFlatnessCurrentCell(){const m=S.measure,el=document.querySelector(`input[data-mkey="flatness"][data-i="${lengthIndex()}"][data-j="${m.settings.wStep||0}"]`);if(el)el.focus()}
function bindFlatnessInputs(){
 const m=S.measure;
 /* フラットネスは記号(〇/△/×)または自由記述のため、他項目のような
    測定器転送(deviceInput)経由の数値受信とは切り離し、セルへ直接
    入力できるようにする。 */
 document.querySelectorAll('input[data-mkey="flatness"]').forEach(x=>{
  /* **押した枠へ移る処理は`bindMeasureInputs`が持つ**（§9.221 ⑧、利用者の
     指摘「フラットネスについて丈を跨いでの直接条指定ができません。他の項目は
     直接丈を跨いだ条指定ができるので同じように」）。以前はここで`onclick`を
     上書きし、**条(`wStep`)だけ**を合わせて丈(`gotoLengthSlot`)を落として
     いたため、別の丈の枠を押しても印はそこへ来なかった。
     **同じことを2箇所に持たない**——上書きを外して1本へ戻す。 */
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
/* 出どころの呼び名。**指示値は上下限を持たない**ので「指示基準」と呼ぶ
   （§9.242 ⑤、利用者の指示）。製造・オーダーは板厚・板幅の上下限なので公差。 */
const TOL_SOURCE_LABELS={manufacturing:'製造公差',order:'オーダー公差',instruction:'指示基準'};
function compactToleranceData(kind){
 const detail=toleranceDetail(kind),
   base=Number(S.measure.basic[(TOL_DIMENSIONS[kind]||TOL_DIMENSIONS.width).baseKey]),
   labels=TOL_SOURCE_LABELS;
 if(!detail)return null;
 return{source:labels[detail.source]||'公差',base:fixedToleranceValue(kind,base),plus:fixedToleranceValue(kind,detail.plus),minus:fixedToleranceValue(kind,detail.minus),low:fixedToleranceValue(kind,detail.range[0]),high:fixedToleranceValue(kind,detail.range[1]),range:detail.range};
}
function compactToleranceFacts(kind){
 const data=compactToleranceData(kind);
 /* **公差が無いことはバッジ1つで言う**（§9.209 ②、利用者の指示）。
    3行のカード（実測34px＋余白）を1行の帯に置いていたので、そのぶん条が
    2本隠れていた。理由は`title`で読める。 */
 /* **言葉は項目で変える**（§9.242 ⑤）。上下限を持つ板厚・板幅だけが公差で、
    それ以外は「基準」。判定は`WL.measureItem`の1箇所。 */
 const word=WL.measureItem.limitWord();
 if(!data)return{html:`<span class="tol-pill is-none" title="${esc(word==='公差'
   ?'選択した公差区分に使用可能なプラス・マイナス値がありません。判定は行いません。'
   :'この項目には判定に使える基準が登録されていません。判定は行いません。')}">${esc(word)}なし</span>`,range:null};
 /* 中央の値は**基準値**（狙う寸法）。§9.242 ⑤で「基準」を「上下限を持たない
    項目の判定のよりどころ」に使うようにしたので、**同じ2文字で2つの意味を
    持たせない**——ここは`基準値`と言い切る（`title`でも既にそう書いていた）。 */
 return{range:data.range,html:`<div class="compact-tol-three-row"><div class="tol-line tol-line-base"><span class="compact-tol-source">${esc(data.source)}</span><span class="tol-value-pair"><small>基準値</small><b>${esc(data.base)}</b></span></div><div class="tol-line tol-line-plusminus"><span class="tol-value-pair"><small>公差＋</small><b>+${esc(data.plus)}</b></span><span class="tol-value-pair"><small>公差－</small><b>-${esc(data.minus)}</b></span></div><div class="tol-line tol-line-range"><small>判定範囲</small><b>${esc(data.low)} ～ ${esc(data.high)}</b></div></div>`};
}
/* ---------- ③の公差一覧（§9.157、利用者の指摘） ----------
   「3枚目は、公差指示がラテラルボーしか出ていませんが、板厚、板幅、板丈の
   公差があります。設備マスタでコイルの場合は板丈はありませんが、板の設備の
   場合は板丈があります。」

   ②は**いま測っている1項目**の公差でよい（判定しているのがそれだから）が、
   ③は確認の面なので**効いている公差を全部並べる**。
   - 寸法は板厚・板幅・板丈の3つ。**板丈は板の設備だけ**——コイルは巻いた
     ままなので丈が決まらない。区分は設備マスタから来る
     （`settings.equipmentKind`）。**未設定を「板」と決め付けない**。
   - 指示型（ラテラルボー等）は`WL.instruction`が持つ項目を、**値がある
     ものだけ**並べる。
   - **公差が無い項目は「合格」に混ぜず、項目名で「登録なし」と書く**
     （§9.125と同じ約束）。 */
function toleranceListRows(){
 if(typeof S==='undefined'||!S?.measure)return[];
 const b=S.measure.basic||{},kind=String(S.measure.settings?.equipmentKind||'');
 const rows=[];
 const dims=['thickness','width'].concat(kind==='板'?['length']:[]);
 dims.forEach(k=>{
  const d=TOL_DIMENSIONS[k],base=Number(b[d.baseKey]);
  /* **`toleranceDetail`は通さない。** あれは「いま測っている項目の判定」を
     答える関数で、`measurement-tolerance.js`のラッパーが
     `DIMENSIONAL={'板厚','板幅',…}`に無い項目名で**nullを返す**
     ——板丈は測る項目ではないので、そこで必ず落ちる（実際に「登録なし」に
     なった）。ここが欲しいのは**データに在る公差**なので、出どころから
     直に引く。条ごとに公差が違う分割ロットの差は条の設計カードが持つ。 */
  const detail=(()=>{
   const want=configuredToleranceSource();
   let data=toleranceDataForSource(k,want),src=want,fallback=false;
   if(!data&&want!=='manufacturing'){src='manufacturing';fallback=true;data=toleranceDataForSource(k,'manufacturing')}
   return data&&Number.isFinite(base)
     ?{range:[base-data.minus,base+data.plus],source:src,fallback,...data}:null;
  })();
  rows.push({key:k,name:d.label,kind:'dimension',
   source:detail?(TOL_SOURCE_LABELS[detail.source]||'公差'):'',
   fallback:!!(detail&&detail.fallback),
   base:Number.isFinite(base)?fixedToleranceValue(k,base):'',
   plus:detail?fixedToleranceValue(k,detail.plus):'',
   minus:detail?fixedToleranceValue(k,detail.minus):'',
   range:detail?`${fixedToleranceValue(k,detail.range[0])} ～ ${fixedToleranceValue(k,detail.range[1])}`:'',
   missing:!detail});
 });
 const types=(WL.instruction&&typeof WL.instruction.types==='function')?WL.instruction.types():[];
 types.forEach(t=>{
  const info=WL.instruction.info(t);
  if(!info)return;                       /* 値の無い指示は行ごと出さない */
  rows.push({key:'i:'+t,name:t,kind:'instruction',source:'指示基準',fallback:false,
   base:'',plus:'',minus:'',
   range:Number.isFinite(info.value)?`0 ～ ${info.value}`:String(info.raw||''),
   note:info.unit?`${info.unit}単位`:'単位指定なし',missing:false});
 });
 return rows;
}
/* 板丈を出さない理由は**文で言う**（黙って行が無いと、公差が無いのか
   出していないのかが分からない）。 */
function toleranceListNote(){
 const kind=String(S.measure?.settings?.equipmentKind||'');
 if(kind==='板')return '';
 if(kind==='コイル')return '板丈はコイルの設備には無いため出していません。';
 return '板丈は設備の区分が未設定のため出していません（マスタ管理 > 設備の「区分」で コイル／板 を設定してください）。';
}
/* 公差の±。**同じ値なら1つにまとめる**（§9.166、利用者の指摘「効いている
   公差の部分が余裕がなくきつい」）。実データは左右対称のことが多く、
   `+0.130` `-0.130` と2つの欄に分けると**同じ数字を2度読ませたうえで
   桁が縦にそろわない**。左右で違うときだけ2つ出す。 */
function tolPlusMinusText(r){
 if(!r.plus&&!r.minus)return '';
 if(r.plus&&r.minus&&r.plus===r.minus)return `±${r.plus}`;
 return `${r.plus?'+'+r.plus:'+—'} ${r.minus?'−'+r.minus:'−—'}`;
}
/* ③の公差は**1項目1枚**で縦に積む（§9.166）。以前は6列の表で、実測430pxの
   カードに「項目・出どころ・基準・公差＋・公差−・判定範囲」を詰めていたため
   `3.000 +0.130 -0.130 2.870 〜 3.130`が隙間なく並び、どこまでが1つの数字か
   読み取れなかった。**縦は余っている**（表の下に空白があった）ので、
   読む順に2行へ分ける:
     1行目 … 項目名 と **判定範囲**（確認の面でいちばん読みに来る値）
     2行目 … その根拠（基準・公差・出どころ）を小さく淡く
   共通の文字は見出しごと落とす——表全体が「効いている公差」なので、
   列見出しの「公差＋／公差−」も、出どころの「〜公差」も繰り返さない。 */
function toleranceListHtml(){
 const rows=toleranceListRows(),note=toleranceListNote();
 if(!rows.length)return '';
 const body=rows.map(r=>{
  const pm=tolPlusMinusText(r);
  /* 根拠の行。**出どころが差し替わったことは書く**——設定した公差が
     データに無くて製造公差へ落ちたときに黙っていると、別の公差で
     判定していることに気づけない。 */
  const basis=r.missing
   ?`${r.kind==='dimension'?'公差':'基準'}がマスタに登録されていません`
   :[r.base?`基準値 ${r.base}`:'',pm,
     r.source+(r.fallback?'（指定の公差が無いため）':''),r.note||'']
     .filter(Boolean).join(' ／ ');
  return `<li class="tol-card${r.missing?' is-missing':''}" data-tol="${esc(r.key)}">`
   +`<span class="tol-card-name">${esc(r.name)}</span>`
   +`<span class="tol-card-range" data-tol-range>${
      r.missing?'<span class="tol-list-missing">登録なし</span>':esc(r.range||'—')}</span>`
   +`<span class="tol-card-basis">${esc(basis)}</span></li>`;
 }).join('');
 /* 見出しは**両方の言葉**を出す（§9.242 ⑤）。この一覧は板厚・板幅（公差）と
    ラテラルボー等（基準）を同じ表に並べるので、片方の言葉だけでは
    もう片方が「無い」ように読める。 */
 return '<div class="tol-list-head">効いている公差・基準</div>'
  +`<ul class="tol-cards">${body}</ul>`
  +(note?`<p class="tol-list-note">${esc(note)}</p>`:'');
}
window.WL=window.WL||{};
WL.toleranceList={rows:toleranceListRows,html:toleranceListHtml,note:toleranceListNote,
 paint(){
  const host=document.getElementById('toleranceList3');if(!host)return;
  const html=toleranceListHtml();
  if(host.innerHTML!==html)host.innerHTML=html;
  const empty=!html;
  if(host.hidden!==empty)host.hidden=empty;
 }};

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
 /* 描き直しの入口。表そのものは触らないので、入力欄のフォーカスも
    スクロール位置も動かない（条ごとに公差が変わる分割ロット用）。 */
 repaint(kind,values,count){
  const parts=this.parts(kind,values,count);
  const body=document.querySelector('.matrix-body'),side=body&&body.querySelector('.compact-tolerance-side');
  if(side)side.innerHTML=parts.graph;
  if(body)body.classList.toggle('no-graph',!parts.graph);
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
 const chart=document.querySelector('.accurate-numberline');
 const out=Number(chart&&chart.dataset.out)||0;
 const note=document.getElementById('numberlineOutside');
 if(note){
  /* 畳んである先に打つ手がある（§9.208 ④）。**どこを触れば見えるのか**まで
     書く——「表示幅を広げる」とだけ書いても、その欄が画面に無い。 */
  /* **案内は`title`だけが持つ**（§9.234 ③）。同じ文が本文と`title`に
     二重に入っており、本文側だけで約205px使っていた（§CLAUDE 8）。 */
  note.textContent=out?`軸の外 ${out}件`:'';
  note.title=out?'押すと「図の見せ方」が開きます。表示幅を広げると軸の外の点も図に入ります。':'';
  if(note.hidden!==!out)note.hidden=!out;
 }
 /* 窓を開いていないうちは何も作らない（§9.182「見えないものは作らない」）。 */
 const el=document.getElementById(NL_PANEL_ID);
 if(!el||el.hidden)return;
 const mode=numberlineMode(),span=numberlineSpan();
 const modeBox=el.querySelector('#nlModeChoices');
 if(modeBox)modeBox.innerHTML=NL_MODES.map(([v,l])=>
  `<button type="button" class="nl-choice${v===mode?' is-on':''}" data-nl-mode="${v}"`
  +` aria-pressed="${v===mode}">${nlModeArt(v)}<b>${esc(l)}</b>`
  +`<small>${esc(NL_MODE_HELP[v]||'')}</small></button>`).join('');
 const spanBox=el.querySelector('#nlSpanChoices');
 if(spanBox)spanBox.innerHTML=NL_SPANS.map(v=>
  `<button type="button" class="nl-span${v===span?' is-on':''}" data-nl-span="${v}"`
  +` aria-pressed="${v===span}">公差×${v}</button>`).join('');
 const state=el.querySelector('#nlState');
 if(state){
  /* **状態は必ず文字で**（§3）。0件のときも「無い」と言い切る——
     空欄だと、数えられなかったのか本当に0なのかが分からない。 */
  state.textContent=chart
   ?(out?`いま軸の外に出ている点が ${out} 件あります。表示幅を広げると図に入ります。`
        :'いま軸の外に出ている点はありません。')
   :`この項目では${WL.measureItem.limitWord()}の図を描いていないので、ここの設定は効きません。`;
  state.classList.toggle('is-warn',!!out);
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
WL.onReady(()=>{syncNumberlineControls()});
function renderMeasureGrid(){renderMeasureGridVertical();requestAnimationFrame(updateValidationVisuals)}
Object.assign(window.WL,{toleranceAxisView});
