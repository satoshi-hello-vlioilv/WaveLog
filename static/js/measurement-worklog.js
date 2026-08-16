"use strict";
/* measurement-worklog.js: 指示値表示・作業時間UI
   マスタ管理画面は static/js/master-maint.js へ分離した(ファイルの92%が
   マスタ管理で、名前と中身が乖離していたため。docs/REFACTORING_PLAN.md
   フェーズ3.1)。 */
/* ============================================================
   Hotfix 2026-07-21: ラテラルボー等の「指示値」表示（②）
   --------------------------------------------------------------
   - 指示_ﾗﾃﾗﾙﾎﾞｰ 等は "2.0/2M" のような文字列で格納される。
     数値部(2.0)と評価単位部(2M / 1M)を分離して表示する。
   - 板厚・板幅以外（ラテラルボー等）の測定種では、数値上下限用の
     公差カード（上部カード）は内容がふさわしくないため表示しない。
     代わりに測定データ側へ「指示値 ＋ 評価単位」カードを表示する。
   - #toleranceSummary（上部の要約）も指示型では抑止する。
   ============================================================ */
(function(){
  if(typeof $!=='function')return;
  // 測定種 -> 参照する「指示_*」フィールド候補（半角/全角の別名を許容）
  var INSTRUCTION_FIELDS={
    'ラテラルボー':['指示_ﾗﾃﾗﾙﾎﾞｰ','指示_ラテラルボー'],
    '直角度':['指示_直角度'],
    '中歪':['指示_中歪_高さ','指示_中歪'],
    '耳歪':['指示_耳歪_高さ','指示_耳歪'],
    'そり巾':['指示_そり巾_方向高さ','指示_そり巾'],
    'そり丈':['指示_そり丈_方向高さ','指示_そり丈']
  };
  function norm(s){return (typeof normalizedFieldName==='function')?normalizedFieldName(s):String(s||'').normalize('NFKC').replace(/[\s\u3000]+/g,'').toLowerCase();}
  function currentType(){return ($('#measureType')&&$('#measureType').value)||(S.measure&&S.measure.settings&&S.measure.settings.measureType)||'';}
  function isInstructionType(type){return !!INSTRUCTION_FIELDS[type];}
  // 仕掛データから指示値の生文字列を取得
  function rawInstruction(type){
    var cands=INSTRUCTION_FIELDS[type];if(!cands)return null;
    var src=(S.measure&&(S.measure.source||(S.measure.snapshot&&S.measure.snapshot.source)))||{};
    for(var i=0;i<cands.length;i++){var wn=norm(cands[i]);for(var k in src){if(norm(k)===wn){var raw=String(src[k]==null?'':src[k]).trim();if(raw!=='')return{raw:raw,key:k};}}}
    return null;
  }
  // "2.0/2M" -> {value:2.0, unit:'2M', raw:'2.0/2M'}
  function parseInstruction(raw){
    if(raw==null)return null;var s=String(raw).normalize('NFKC').trim();if(s==='')return null;
    var value=NaN,unit='';var parts=s.split('/');
    var nm=String(parts[0]).match(/-?\d+(?:\.\d+)?/);if(nm)value=Number(nm[0]);
    if(parts.length>1){var u=String(parts[1]).trim();var um=u.match(/(\d+)\s*[mMｍＭ]/);unit=um?um[1]+'M':u;}
    return{value:value,unit:unit,raw:s};
  }
  function instructionInfo(typeName){
    var type=typeName||currentType();var got=rawInstruction(type);if(!got)return null;
    var parsed=parseInstruction(got.raw);if(!parsed)return null;parsed.key=got.key;parsed.type=type;return parsed;
  }
  // 指示値カード（測定データ側に表示）
  function instructionCardHtml(){
    var info=instructionInfo();
    if(!info)return '<div class="instruction-tol-card no-data"><span>指示値なし</span></div>';
    var valText=Number.isFinite(info.value)?String(info.value):esc(info.raw);
    var unitText=info.unit?info.unit+'単位':'単位指定なし';
    return '<div class="instruction-tol-card">'
      +'<div class="instruction-tol-head"><span class="compact-tol-source">指示公差</span><span class="instruction-tol-type">'+esc(info.type)+'</span></div>'
      +'<div class="instruction-tol-main"><span class="instruction-tol-value">'+esc(valText)+'</span><span class="instruction-tol-unit">'+esc(unitText)+'</span></div>'
      +'<div class="instruction-tol-raw">指示値: '+esc(info.raw)+'</div>'
      +'</div>';
  }

  // toleranceDetail: 指示型は文字列の数値部を判定範囲[0,value]として返す（判定・図示に利用）。
  if(typeof toleranceDetail==='function'){
    var baseDetail=toleranceDetail;
    /* 第3引数 typeName は「いま画面で選ばれている入力内容」の代わり（§9.125）。
       **ラッパーが引数を捨てると、根の関数がいくら受け取れても届かない**
       ——完了前の確認は描かれていない項目の公差外まで数えるので、ここで
       落とすと全項目に「いま選ばれている項目の公差」を当ててしまう
       （実際にそうなり、公差の無いラテラルボーが板幅の公差で判定された）。 */
    toleranceDetail=function(kind,index,typeName){
      var type=typeName||currentType();
      if(isInstructionType(type)){
        var info=instructionInfo(type);
        if(!info||!Number.isFinite(info.value))return null;
        return {range:[0,info.value],source:'instruction',fallback:false,plus:info.value,minus:0,plusKey:info.key,minusKey:'',base:0,single:true,instructionType:type,unit:info.unit,raw:info.raw};
      }
      return baseDetail(kind,index,typeName);
    };
  }

  // 公差カード/スケールは指示型では専用カードへ置換（数値上下限バー・数直線は出さない）。
  if(typeof compactToleranceFacts==='function'){
    var baseFacts=compactToleranceFacts;
    compactToleranceFacts=function(kind){
      var type=currentType();
      if(isInstructionType(type)){var info=instructionInfo();return {range:(info&&Number.isFinite(info.value))?[0,info.value]:null,html:instructionCardHtml()};}
      return baseFacts(kind);
    };
  }
  if(typeof compactToleranceScale==='function'){
    var baseScale=compactToleranceScale;
    compactToleranceScale=function(kind,values,count){
      var type=currentType();
      if(isInstructionType(type))return instructionCardHtml();
      return baseScale(kind,values,count);
    };
  }

  // 上部の要約(#toleranceSummary)は指示型では抑止（内容がふさわしくないため）。
  function suppressSummaryForInstruction(){var type=currentType();if(isInstructionType(type)){var s=$('#toleranceSummary');if(s)s.hidden=true;}}
  if(typeof renderMeasureGridVertical==='function'){
    var baseRMGV=renderMeasureGridVertical;
    renderMeasureGridVertical=function(){baseRMGV();suppressSummaryForInstruction();};
  }
  if(typeof updateMeasurementHeading==='function'){
    var baseUMH=updateMeasurementHeading;
    updateMeasurementHeading=function(){baseUMH();suppressSummaryForInstruction();};
  }
  /* ③の公差一覧が指示型の項目も並べられるように口を出す（§9.157）。
     **項目名の一覧もここが答える**——`INSTRUCTION_FIELDS`はこのファイルの
     ものなので、呼ぶ側に写しを作らせない（2箇所になると片方だけ増える）。
     **このIIFEの中に置くこと**——下の作業時間のIIFEへ書くと
     `instructionInfo`が見えず、`ReferenceError`になる（実際になった）。 */
  window.WL=window.WL||{};
  window.WL.instruction={info:instructionInfo,
    types:function(){return Object.keys(INSTRUCTION_FIELDS)}};
})();

/* ============================================================
 2026-07-21: 作業時間の再編集UI / マスタ管理モーダル（最終版）
 ============================================================ */
(function(){
 if(typeof $!=='function')return;
 /* ---------- 作業時間: 直接編集・再調整対応 ---------- */
 const pad2=n=>String(n).padStart(2,'0');
 function isoToLocalInput(iso){if(!iso)return '';const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`}
 function localInputToIso(v){if(!v)return '';const d=new Date(v);if(Number.isNaN(d.getTime()))return '';return d.toISOString()}
 function wt(){S.measure.workTime=S.measure.workTime||{startAt:'',endAt:''};return S.measure.workTime}
 function syncField(id){const el=$('#'+id);if(!el||!S.measure)return;const w=wt();const iso=id==='workStartAt'?w.startAt:w.endAt;el.dataset.iso=iso||'';el.value=isoToLocalInput(iso)}
 function orderInvalid(){const w=wt();return !!(w.startAt&&w.endAt&&(new Date(w.endAt)-new Date(w.startAt)<0))}
 function refreshWorkTime(){
  if(!S.measure)return;const w=wt();
  const hasStart=!!w.startAt,hasEnd=!!w.endAt,invalid=orderInvalid();
  const startCard=$('#workStartCard'),endCard=$('#workEndCard'),endInput=$('#workEndAt');
  if(startCard){startCard.classList.toggle('validation-valid',hasStart);startCard.classList.toggle('validation-required',!hasStart)}
  if(endCard){endCard.classList.toggle('validation-ng',invalid);endCard.classList.toggle('validation-valid',hasEnd&&!invalid);endCard.classList.toggle('validation-required',!hasEnd)}
  if(endInput)endInput.classList.toggle('ng',invalid);
  const dur=$('#workDuration'),hint=$('#workTimeHint');
  if(dur){
   if(invalid)dur.textContent='終了が開始より前です';
   else if(hasStart&&hasEnd)dur.textContent=`実作業時間 ${formatDuration(durationMs(S.measure))}`;
   else if(hasStart)dur.textContent='作業中';
   else dur.textContent='未計測';
  }
  /* 案内文は左ペインの縦を常時2行占めていた(§9.55)。誤りのときだけ理由を
     しっかり出し、通常時は1行に収める(詳しい説明はtitleへ逃がす)。 */
  if(hint){
   hint.textContent=invalid?'終了時刻は開始時刻より後にしてください。':'開始・終了の両方を記録してください（直接編集も可）。';
   hint.title='未記録のまま完了しようとすると確認が出ます。時刻の欄は直接編集して再調整もできます。';
   hint.classList.toggle('is-invalid',!!invalid);
  }
 }
 /* ---------- 自動で記録する時刻（§9.143、利用者の指示） ----------
    開始・終了は実績として提出するものなので**手で入れる**が、
    「何時に始めて何時に終えたか」は測定の操作そのものが知っている。
    残すのは3つだけ:
      入力を始めた    … このロットで最初に値が入った時刻
      転送を受け始めた… 測定器からの転送を最初に受けた時刻
      最後に入力した  … 直近で値が入った時刻
    **勝手に開始・終了へ書き込まない**——操作ログと実績は別物で、
    段取りや中断を含む実作業時間は人しか決められない。押したときだけ
    入れる（`workFillFromAuto`）。 */
 function autoStamps(){const w=wt();w.auto=w.auto||{firstInputAt:'',firstTransferAt:'',lastInputAt:''};return w.auto}
 function noteInput(kind){
  if(!S.measure)return;
  const a=autoStamps(),iso=new Date().toISOString();
  if(!a.firstInputAt)a.firstInputAt=iso;
  if(kind==='transfer'&&!a.firstTransferAt)a.firstTransferAt=iso;
  a.lastInputAt=iso;
  refreshAutoStamps();
 }
 /* 参考値は**時刻だけ**でよい（同じ日の作業なので日付は開始・終了が持つ）。
    ただし日をまたいだときに嘘にならないよう、開始と日が違えば日付も出す。 */
 function stampText(iso){
  if(!iso)return '—';
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return '—';
  const today=new Date();
  const sameDay=d.toDateString()===today.toDateString();
  return sameDay?`${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
                :`${d.getMonth()+1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
 }
 function refreshAutoStamps(){
  if(!S.measure)return;
  const a=autoStamps();
  const put=(id,iso)=>{const el=$('#'+id);if(!el)return;
   const t=stampText(iso);if(el.textContent!==t)el.textContent=t;
   el.title=iso?new Date(iso).toLocaleString('ja-JP'):'まだ記録がありません';};
  put('waFirstInput',a.firstInputAt);
  put('waFirstTransfer',a.firstTransferAt);
  put('waLastInput',a.lastInputAt);
  /* **できないことは、できないと書く**（押せるのに何も起きないボタンを
     残さない）。理由は文で出す——灰色になっているだけでは分からない。 */
  const btn=$('#workFillFromAuto'),hint=$('#workAutoHint');
  const ready=!!(a.firstInputAt&&a.lastInputAt);
  if(btn)btn.disabled=!ready;
  if(hint)hint.textContent=ready
   ?'開始←入力を始めた時刻／終了←最後に入力した時刻。入れたあとで直せます。'
   :'まだ測定値が1つも入っていないため、参考値はありません。';
 }
 function fillFromAuto(){
  if(!S.measure)return;
  const a=autoStamps(),w=wt();
  if(!a.firstInputAt||!a.lastInputAt)return;
  w.startAt=a.firstInputAt;w.endAt=a.lastInputAt;
  syncField('workStartAt');syncField('workEndAt');
  afterWorkChange();
  showToast&&showToast('参考値を入れました',`${stampText(a.firstInputAt)} 〜 ${stampText(a.lastInputAt)}`);
 }
 window.WL=window.WL||{};
 WL.workStamp={note:noteInput,refresh:refreshAutoStamps};
 /* 母材・製品の欄は`collect()`が保存時にまとめて読む作りで、1つずつの
    書き込み点が無い。**持ち主のコードへ手を入れずに**捕まえるため、
    ここで委譲で受ける（捕捉フェーズ。他のハンドラを奪わない）。 */
 document.addEventListener('input',e=>{
  const t=e.target;
  if(!S.measure||!t||typeof t.matches!=='function')return;
  if(t.matches('[data-mother],[data-product-field]'))noteInput('manual');
 },true);
 function afterWorkChange(){refreshWorkTime();refreshAutoStamps();markDirty();if(typeof updateValidationVisuals==='function')updateValidationVisuals()}
 function commitField(id){const el=$('#'+id);if(!el||!S.measure)return;const iso=localInputToIso(el.value);el.dataset.iso=iso;const w=wt();if(id==='workStartAt')w.startAt=iso;else w.endAt=iso;afterWorkChange()}
 function stampNow(id){if(!S.measure)return;const w=wt(),iso=new Date().toISOString();if(id==='workStartAt')w.startAt=iso;else w.endAt=iso;syncField(id);afterWorkChange();showToast&&showToast(id==='workStartAt'?'開始時刻を記録しました':'終了時刻を記録しました',formatWorkTime(iso))}
 function clearField(id){if(!S.measure)return;const w=wt();if(id==='workStartAt')w.startAt='';else w.endAt='';syncField(id);afterWorkChange()}
 function bindWorkTime(){
  const s=$('#workStartAt'),e=$('#workEndAt');
  if(s){s.readOnly=false;s.disabled=false;s.onchange=()=>commitField('workStartAt');s.oninput=()=>commitField('workStartAt')}
  if(e){e.readOnly=false;e.disabled=false;e.onchange=()=>commitField('workEndAt');e.oninput=()=>commitField('workEndAt')}
  const sb=$('#stampWorkStart'),eb=$('#stampWorkEnd'),sc=$('#clearWorkStart'),ec=$('#clearWorkEnd');
  if(sb){sb.disabled=false;sb.onclick=()=>stampNow('workStartAt')}
  if(eb){eb.disabled=false;eb.onclick=()=>stampNow('workEndAt')}
  if(sc)sc.onclick=()=>clearField('workStartAt');
  if(ec)ec.onclick=()=>clearField('workEndAt');
  const fb=$('#workFillFromAuto');
  if(fb)fb.onclick=()=>fillFromAuto();
 }
 updateWorkTimePanel=function(){if(!S.measure)return;syncField('workStartAt');syncField('workEndAt');bindWorkTime();refreshWorkTime();refreshAutoStamps()};
})();

/* ============================================================
   作業時間の過去実績比較(旧 worktime-benchmark.js を統合、
   docs/REFACTORING_PLAN.md フェーズ3.3)
   ------------------------------------------------------------
   window.*公開ゼロ・他ファイルからの参照ゼロの自己完結IIFEで、独立
   ファイルである利益が無かった。**読み込み位置は変えていない**:
   このIIFEは冒頭でidbAll(records-store.js)の存在を確認して早期returnし、
   saveLocal(records-store.js)/renderMeasurement(measurement-view.js)/
   markDirty(base.js)をラップするため、それら全ての後に読まれる必要がある。
   計画当初の統合先だったmeasurement-view.jsはrecords-store.jsより先に
   読まれるので、そちらへ移すとガードに掛かって**機能が丸ごと黙って死ぬ**。
   このファイルは元のworktime-benchmark.jsの直前に読まれるため、末尾へ
   置けば実行順は元のままになる。
   ------------------------------------------------------------
   作業時間を過去実績と比較する。
   ------------------------------------------------------------
   明細(用途名・製造材質・製造調質・実績板厚・実績板幅・丈割数・条割数)と
   アプリ登録設備が一致する完了データを端末内IndexedDBから集計し、過去の
   平均作業時間・N数・バラつき(標準偏差)を、測定メイン画面の「作業時間」
   タブに表示する。今回(このロット)の作業時間(または作業中の場合は経過
   時間)との差分も併せて表示する。

   実績板厚・実績板幅は、実測した板厚・板幅の平均値(実績カレンダー機能と
   同じ考え方)を使う。グルーピングの揺れを抑えるため、板厚は小数2桁、
   板幅は小数1桁に丸めて比較する。
   ============================================================ */
(function(){
  if(typeof $!=='function'||typeof idbAll!=='function'||typeof durationMs!=='function')return;

  function avgMeasured(grid,rowLimit,colLimit){
    let sum=0,n=0;const rows=Math.min((grid||[]).length,Math.max(1,rowLimit||0));
    for(let i=0;i<rows;i++){
      const row=grid[i]||[];const cols=Math.min(row.length,Math.max(1,colLimit||0));
      for(let j=0;j<cols;j++){
        const raw=row[j];if(raw===''||raw==null)continue;
        const v=Number(raw);if(Number.isFinite(v)){sum+=v;n++}
      }
    }
    return n>0?sum/n:null;
  }

  function profileOf(x){
    const b=x.basic||{},s=x.settings||{};
    const vc=Math.max(1,+s.verticalCount||1),hc=Math.max(1,+s.horizontalCount||1);
    const avgThk=avgMeasured(x.measurements?.thickness,vc,3),avgWid=avgMeasured(x.measurements?.width,vc,hc);
    if(avgThk==null||avgWid==null)return null;
    return{
      purposeName:b.purposeName||'',mfgMaterial:b.mfgMaterial||'',mfgTemper:b.mfgTemper||'',
      thickness:Math.round(avgThk*100)/100,width:Math.round(avgWid*10)/10,
      verticalCount:vc,horizontalCount:hc,equipment:s.registeredEquipment||''
    };
  }
  function profileKey(p){return p?[p.purposeName,p.mfgMaterial,p.mfgTemper,p.thickness,p.width,p.verticalCount,p.horizontalCount,p.equipment].join('|'):''}

  function stdDev(values,mean){
    if(values.length<2)return 0;
    const variance=values.reduce((a,v)=>a+(v-mean)**2,0)/values.length;
    return Math.sqrt(variance);
  }

  async function benchmarkFor(record){
    const profile=profileOf(record);
    if(!profile)return{profile:null};
    if(!profile.equipment)return{profile,noEquipment:true};
    const key=profileKey(profile);
    const all=await idbAll();
    const matches=all.filter(x=>{
      if(x.id===record.id)return false;
      if(x.status!=='完了')return false;
      const p=profileOf(x);
      return p&&profileKey(p)===key;
    });
    const durations=matches.map(x=>durationMs(x)).filter(ms=>ms!=null&&ms>0).map(ms=>ms/60000);
    const result={profile,n:durations.length};
    if(durations.length){
      const avg=durations.reduce((a,v)=>a+v,0)/durations.length;
      result.avgMin=avg;result.sdMin=stdDev(durations,avg);
    }
    const w=record.workTime||{};
    if(w.startAt&&w.endAt){
      result.currentMin=durationMs(record)/60000;result.currentLive=false;
    }else if(w.startAt){
      result.currentMin=(Date.now()-new Date(w.startAt).getTime())/60000;result.currentLive=true;
    }
    if(result.currentMin!=null&&Number.isFinite(result.avgMin))result.diffMin=result.currentMin-result.avgMin;
    return result;
  }

  function fmtMin(min){
    if(min==null||!Number.isFinite(min))return '-';
    const sign=min<0?'-':'',abs=Math.abs(min),h=Math.floor(abs/60),m=Math.round(abs%60);
    return sign+(h>0?`${h}時間${m}分`:`${m}分`);
  }

  function ensureCard(){
    let card=$('#worktimeBenchmark');
    if(card)return card;
    card=document.createElement('div');card.id='worktimeBenchmark';card.className='worktime-benchmark';
    const hint=$('#workTimeHint');
    if(hint&&hint.parentNode)hint.insertAdjacentElement('afterend',card);
    else document.querySelector('.work-time-panel')?.appendChild(card);
    return card;
  }

  function renderBenchmarkCard(result){
    const card=ensureCard();
    card.hidden=false;
    /* **その時点で自明な「できない理由」は出さない**（§9.127）。板厚・板幅を
       まだ測っていないのは①準備では必ずそうで、毎回・全ロットで同じ文が
       出る＝読まれない。しかも常設のぶん高さを取り、表示サイズ特大では
       左ペインが溢れる原因になっていた（実測15px）。設備が未登録のような
       **直せる不備**は今までどおり書く。 */
    if(!result||!result.profile){
      card.innerHTML='';card.hidden=true;
      return;
    }
    if(result.noEquipment){
      card.innerHTML='<div class="wtb-empty">使用設備が未登録のため、過去実績とは比較できません。</div>';
      return;
    }
    if(!result.n){
      card.innerHTML='<div class="wtb-empty">同条件(用途名・製造材質・調質・実績板厚幅・丈割数・条割数・使用設備)の完了実績はまだありません。今回が最初の記録になります。</div>';
      return;
    }
    const hasCurrent=result.currentMin!=null;
    const diffCell=hasCurrent&&Number.isFinite(result.diffMin)
      ?`<div class="wtb-cell ${result.diffMin>0?'wtb-slower':'wtb-faster'}"><small>平均比</small><b>${result.diffMin>0?'+':''}${esc(fmtMin(result.diffMin))}</b></div>`
      :'';
    card.innerHTML=`
      <div class="wtb-title">過去実績との比較<small>(同条件 N=${result.n}件)</small></div>
      <div class="wtb-grid">
        <div class="wtb-cell"><small>過去平均</small><b>${esc(fmtMin(result.avgMin))}</b></div>
        <div class="wtb-cell"><small>バラつき(σ)</small><b>±${esc(fmtMin(result.sdMin))}</b></div>
        <div class="wtb-cell"><small>${result.currentLive?'経過(作業中)':'今回'}</small><b>${hasCurrent?esc(fmtMin(result.currentMin)):'未計測'}</b></div>
        ${diffCell}
      </div>`;
  }

  let refreshing=false,pending=false;
  async function refreshBenchmark(){
    if(!S.measure)return;
    if(refreshing){pending=true;return}
    refreshing=true;
    try{
      const result=await benchmarkFor(S.measure);
      if(S.measure)renderBenchmarkCard(result);
    }catch(e){console.warn('作業時間比較の取得に失敗しました',e)}
    finally{
      refreshing=false;
      if(pending){pending=false;refreshBenchmark()}
    }
  }

  let liveTimer=null;
  function ensureLiveTimer(){
    clearInterval(liveTimer);liveTimer=null;
    const w=S.measure?.workTime||{};
    if(w.startAt&&!w.endAt)liveTimer=setInterval(refreshBenchmark,30000);
  }

  let debounceTimer=null;
  function scheduleRefresh(){clearTimeout(debounceTimer);debounceTimer=setTimeout(()=>{refreshBenchmark();ensureLiveTimer()},700)}

  if(typeof renderMeasurement==='function'){
    const baseRender=renderMeasurement;
    renderMeasurement=function(){baseRender();refreshBenchmark();ensureLiveTimer()};
  }
  if(typeof markDirty==='function'){
    const baseMarkDirty=markDirty;
    markDirty=function(){baseMarkDirty();scheduleRefresh()};
  }
  if(typeof saveLocal==='function'){
    const baseSaveLocal=saveLocal;
    saveLocal=async function(status){const r=await baseSaveLocal(status);refreshBenchmark();return r};
  }
})();
