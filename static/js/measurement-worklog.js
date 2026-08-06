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
  function instructionInfo(){
    var type=currentType();var got=rawInstruction(type);if(!got)return null;
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
    toleranceDetail=function(kind,index){
      var type=currentType();
      if(isInstructionType(type)){
        var info=instructionInfo();
        if(!info||!Number.isFinite(info.value))return null;
        return {range:[0,info.value],source:'instruction',fallback:false,plus:info.value,minus:0,plusKey:info.key,minusKey:'',base:0,single:true,instructionType:type,unit:info.unit,raw:info.raw};
      }
      return baseDetail(kind,index);
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
 function afterWorkChange(){refreshWorkTime();markDirty();if(typeof updateValidationVisuals==='function')updateValidationVisuals()}
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
 }
 updateWorkTimePanel=function(){if(!S.measure)return;syncField('workStartAt');syncField('workEndAt');bindWorkTime();refreshWorkTime()};
})();
