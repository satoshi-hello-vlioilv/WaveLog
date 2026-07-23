"use strict";
/* measurement-worklog.js: 指示値表示・作業時間UI・マスタ管理モーダル */
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
  if(hint)hint.textContent=invalid?'終了時刻は開始時刻より後にしてください。時刻は直接編集・再調整できます。':'開始・終了の両方を設定すると完了登録できます。時刻は直接編集・再調整できます。';
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

 /* ---------- マスタ管理モーダル（刷新版: 大画面・高密度・検索・IDリネーム更新） ---------- */
 const MASTER_DEFS=[
  {key:'operator',label:'オペレータ',icon:'人',endpoint:'/api/operator-master',hasDelete:true,
   fields:[{k:'name',label:'氏名',required:true,key:true},{k:'yomi',label:'ヨミガナ'},{k:'equipment',label:'作業可能設備',type:'equipment-multi'}],
   cols:[{k:'name',label:'氏名',grow:2},{k:'yomi',label:'ヨミガナ',grow:1},{k:'equipmentText',label:'作業可能設備',grow:3}]},
  {key:'device',label:'機器',icon:'器',endpoint:'/api/device-master',hasDelete:true,
   fields:[{k:'kind',label:'測定区分',type:'select',options:['板厚','板幅','その他',''],key:true},{k:'name',label:'機器名',required:true,key:true},{k:'note',label:'備考'}],
   cols:[{k:'kind',label:'測定区分',grow:1},{k:'name',label:'機器名',grow:2},{k:'note',label:'備考',grow:3}]},
  {key:'spool',label:'スプール種別',icon:'巻',endpoint:'/api/spool-master',hasDelete:true,
   fields:[{k:'name',label:'種別名',required:true,key:true},{k:'note',label:'備考'}],
   cols:[{k:'name',label:'種別名',grow:2},{k:'note',label:'備考',grow:3}]},
  {key:'inner',label:'内径種別',icon:'径',endpoint:'/api/inner-master',hasDelete:true,
   fields:[{k:'name',label:'内径種別',required:true,key:true},{k:'note',label:'備考'}],
   cols:[{k:'name',label:'内径種別',grow:2},{k:'note',label:'備考',grow:3}]},
  {key:'equipment',label:'設備',icon:'設',endpoint:'/api/equipment-master',hasDelete:true,
   fields:[{k:'name',label:'設備名',required:true,key:true}],
   cols:[{k:'name',label:'設備名',grow:2}]},
  {key:'columnDisplay',label:'列表示',icon:'列',special:'column-display'},
  {key:'importBackup',label:'データ引継ぎ',icon:'継',special:'import-backup'},
 ];
 let maintState={defKey:'operator',items:[],editing:null,query:''};
 function currentDef(){return MASTER_DEFS.find(d=>d.key===maintState.defKey)||MASTER_DEFS[0]}

 function ensureMaintModal(){
  let modal=$('#masterMaintModal');if(modal)return modal;
  modal=document.createElement('div');modal.className='record-modal mm-modal';modal.id='masterMaintModal';modal.hidden=true;
  modal.innerHTML=`<div class="mm-dialog">
   <header class="mm-head">
    <div class="mm-head-title"><h2>マスタ管理</h2><span class="mm-sub">登録内容の追加・編集・無効化。更新はすべて更新者IDとともに記録されます。</span></div>
    <label class="mm-head-user">更新者ID<input id="masterUserId" type="text" autocomplete="off" placeholder="社員番号など"></label>
    <button id="closeMasterMaint" class="mm-close" type="button" aria-label="閉じる">×</button>
   </header>
   <div class="mm-body">
    <nav class="mm-nav" id="masterMaintNav" aria-label="マスタ種別"></nav>
    <section class="mm-main">
     <div class="mm-toolbar">
      <div class="mm-toolbar-left"><b id="masterMaintTitle">オペレータ</b><span class="mm-count" id="masterMaintCount"></span></div>
      <div class="mm-toolbar-right">
       <div class="mm-search"><span class="mm-search-icon" aria-hidden="true">🔍</span><input id="masterMaintSearch" type="search" placeholder="一覧を絞り込み（名称・更新者など）" autocomplete="off"></div>
       <button id="reloadMasterMaint" type="button" class="mm-btn-ghost">再読込</button>
      </div>
     </div>
     <form class="mm-form" id="masterMaintForm"></form>
     <div class="mm-list-wrap"><div class="mm-list" id="masterMaintList"></div></div>
    </section>
   </div>
  </div>`;
  document.body.append(modal);
  $('#closeMasterMaint').onclick=()=>{modal.hidden=true};
  modal.addEventListener('click',ev=>{if(ev.target===modal)modal.hidden=true});
  const uid=$('#masterUserId');if(uid){uid.value=currentUserId();uid.onchange=()=>setUserId(uid.value)}
  $('#reloadMasterMaint').onclick=()=>loadMaint(true);
  const search=$('#masterMaintSearch');if(search){search.oninput=()=>{maintState.query=search.value;renderMaintList()}}
  const nav=$('#masterMaintNav');
  nav.innerHTML=MASTER_DEFS.map(d=>`<button type="button" data-master="${d.key}"><span class="mm-nav-ico" aria-hidden="true">${esc(d.icon)}</span><span class="mm-nav-label">${esc(d.label)}</span></button>`).join('');
  nav.querySelectorAll('[data-master]').forEach(b=>b.onclick=()=>{maintState.defKey=b.dataset.master;maintState.editing=null;maintState.query='';const se=$('#masterMaintSearch');if(se)se.value='';syncNav();loadMaint(true)});
  return modal;
 }
 function syncNav(){document.querySelectorAll('#masterMaintNav [data-master]').forEach(b=>b.classList.toggle('active',b.dataset.master===maintState.defKey))}
 function requireMaintUser(){const el=$('#masterUserId');const id=String(el?el.value:'').trim();if(!id){showToast('更新者IDを入力してください','マスタ更新には更新者IDが必要です。',4200);el&&el.focus();return null}setUserId(id);return id}

 function renderMaintForm(){
  const def=currentDef(),form=$('#masterMaintForm');if(!form)return;const editing=maintState.editing;
  const controls=def.fields.map(f=>{
   const val=editing?String(editing[f.k]??''):'';
   if(f.type==='equipment-multi'){
    const selected=new Set((editing&&Array.isArray(editing[f.k])?editing[f.k]:[]).map(String));
    const opts=equipmentMasterState.items||[];
    const chips=opts.length?opts.map(eq=>{
     const checked=selected.has(eq.name);
     return `<label class="mm-eq-chip${checked?' checked':''}"><input type="checkbox" data-equipment-field="${f.k}" value="${esc(eq.name)}"${checked?' checked':''}><span>${esc(eq.name)}</span></label>`;
    }).join(''):'<span class="mm-empty-inline">設備マスタが未登録です。先に「設備」タブで登録してください。</span>';
    const actions=opts.length?`<div class="mm-eq-actions"><button type="button" class="mm-btn-ghost sm" data-equipment-all="${f.k}">すべて選択</button><button type="button" class="mm-btn-ghost sm" data-equipment-none="${f.k}">選択解除</button></div>`:'';
    return `<div class="mm-field mm-field-wide"><span>${esc(f.label)}</span>
     <div class="mm-eq-picker" data-equipment-picker="${f.k}">
      <div class="mm-eq-picker-head"><span class="mm-eq-count" data-equipment-count="${f.k}">${selected.size}件選択中 / 全${opts.length}件</span>${actions}</div>
      <div class="mm-eq-grid">${chips}</div>
     </div>
     <small class="mm-field-hint">未選択の場合は制限なし（全設備で表示対象）として扱われます。</small></div>`;
   }
   if(f.type==='select'){
    const opts=(f.options||[]).map(o=>`<option value="${esc(o)}"${o===val?' selected':''}>${esc(o||'（指定なし）')}</option>`).join('');
    return `<label class="mm-field"><span>${esc(f.label)}${f.required?'<i>*</i>':''}${f.key?'<em class="mm-keytag">キー</em>':''}</span><select data-field="${f.k}">${opts}</select></label>`;
   }
   return `<label class="mm-field"><span>${esc(f.label)}${f.required?'<i>*</i>':''}${f.key?'<em class="mm-keytag">キー</em>':''}</span><input data-field="${f.k}" type="text" value="${esc(val)}" autocomplete="off"></label>`;
  }).join('');
  const chip=editing?`<span class="mm-mode-chip editing">編集中 <b>${esc(editing[def.cols[0].k]||'')}</b><small>ID:${esc(editing.id)}</small></span>`:`<span class="mm-mode-chip new">新規登録</span>`;
  form.innerHTML=`<div class="mm-form-head">${chip}${editing?'<button type="button" id="masterMaintNew" class="mm-btn-ghost sm">＋ 新規入力に切替</button>':''}</div>
   <div class="mm-form-fields">${controls}</div>
   <div class="mm-form-tail"><button type="submit" class="mm-btn-primary">${editing?'更新を保存':'追加登録'}</button><span class="mm-form-hint">${editing?'キー項目（名称・区分など）も変更できます。保存すると同じIDのまま更新（リネーム）されます。同名が既にある場合は更新できません。':'必須(*)を入力して追加登録します。'}</span></div>`;
  form.onsubmit=ev=>{ev.preventDefault();submitMaint()};
  const nb=$('#masterMaintNew');if(nb)nb.onclick=()=>{maintState.editing=null;renderMaintForm()};
  bindEquipmentPickers(form);
 }
 // 作業可能設備ピッカー(チップ状の複数選択)。すべて選択/選択解除ボタンと
 // 選択件数表示をチェック状態と常に同期させる。
 function bindEquipmentPickers(form){
  form.querySelectorAll('[data-equipment-picker]').forEach(picker=>{
   const fk=picker.dataset.equipmentPicker;
   const boxes=()=>[...picker.querySelectorAll(`[data-equipment-field="${fk}"]`)];
   const countEl=picker.querySelector(`[data-equipment-count="${fk}"]`);
   const refresh=()=>{if(countEl){const all=boxes();countEl.textContent=`${all.filter(b=>b.checked).length}件選択中 / 全${all.length}件`}};
   boxes().forEach(b=>b.addEventListener('change',()=>{b.closest('.mm-eq-chip')?.classList.toggle('checked',b.checked);refresh()}));
   const allBtn=picker.querySelector(`[data-equipment-all="${fk}"]`);
   const noneBtn=picker.querySelector(`[data-equipment-none="${fk}"]`);
   if(allBtn)allBtn.onclick=()=>{boxes().forEach(b=>{b.checked=true;b.closest('.mm-eq-chip')?.classList.add('checked')});refresh()};
   if(noneBtn)noneBtn.onclick=()=>{boxes().forEach(b=>{b.checked=false;b.closest('.mm-eq-chip')?.classList.remove('checked')});refresh()};
  });
 }

 function setMaintLoading(show,text){
  const dialog=$('#masterMaintModal .mm-dialog');if(!dialog)return;
  let box=dialog.querySelector(':scope > .mm-loading');
  if(show){
   if(!box){box=document.createElement('div');box.className='mm-loading';box.innerHTML='<div class="mm-loading-box"><span class="mini-spinner"></span><b></b></div>';dialog.appendChild(box)}
   box.querySelector('b').textContent=text||'処理しています…';box.hidden=false;
  }else if(box){box.hidden=true}
 }
 async function submitMaint(){
  const def=currentDef(),uid=requireMaintUser();if(uid===null)return;const editing=maintState.editing;
  const body={user_id:uid};let ok=true;
  if(editing)body.id=editing.id;
  def.fields.forEach(f=>{
   if(f.type==='equipment-multi'){body[f.k]=[...document.querySelectorAll(`#masterMaintForm [data-equipment-field="${f.k}"]:checked`)].map(el=>el.value);return}
   const el=$(`#masterMaintForm [data-field="${f.k}"]`);const v=String(el?el.value:'').trim();if(f.required&&!v)ok=false;body[f.k]=v;
  });
  if(!ok){showToast('入力を確認してください','必須項目が未入力です。',4000);return}
  const endpoint=editing?def.endpoint+'/update':def.endpoint;
  try{
   setMaintLoading(true,editing?`${def.label}を更新しています…`:`${def.label}を登録しています…`);
   const r=await api(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   maintState.editing=null;await loadMaint(true);
   showToast&&showToast(def.label+(editing?'を更新しました':'を登録しました'),(r&&r.message)||'',3600);
  }catch(e){showToast&&showToast(editing?'更新できませんでした':'登録できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }
 async function deleteMaint(item){
  const def=currentDef();if(!def.hasDelete)return;const uid=requireMaintUser();if(uid===null)return;
  const nm=item[def.cols[0].k]||item.name||'';
  if(!confirm(`${def.label}「${nm}」を無効化（削除）しますか？`))return;
  try{
   setMaintLoading(true,`${def.label}を無効化しています…`);
   await api(def.endpoint+'/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,user_id:uid})});
   if(maintState.editing&&maintState.editing.id===item.id)maintState.editing=null;
   await loadMaint(true);showToast&&showToast(def.label+'を無効化しました',nm,3600);
  }catch(e){showToast&&showToast('削除できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }

 function fmtDT(v){if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?'-':d.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
 function maintGridTemplate(def){const data=def.cols.map(c=>`minmax(120px,${c.grow||1}fr)`).join(' ');return `${data} 120px 150px 132px`}
 function filteredMaintItems(def){
  const q=String(maintState.query||'').trim().normalize('NFKC').toLowerCase();
  let items=maintState.items||[];
  if(q)items=items.filter(it=>{const hay=[...def.cols.map(c=>it[c.k]),it.updated_by].map(v=>String(v??'').normalize('NFKC').toLowerCase()).join(' ');return hay.includes(q)});
  return items;
 }
 function renderMaintList(){
  const def=currentDef(),list=$('#masterMaintList');if(!list)return;
  const all=maintState.items||[],items=filteredMaintItems(def),tmpl=maintGridTemplate(def);
  const cnt=$('#masterMaintCount');if(cnt)cnt.textContent=maintState.query?`${items.length} / 有効 ${all.length}件`:`有効 ${all.length}件`;
  const headCols=def.cols.map(c=>`<span>${esc(c.label)}</span>`).join('');
  list.innerHTML=`<div class="mm-row head" style="grid-template-columns:${tmpl}">${headCols}<span>更新者</span><span>更新日時</span><span class="mm-act">操作</span></div>`;
  if(!items.length){list.insertAdjacentHTML('beforeend',`<div class="mm-empty">${all.length&&maintState.query?'絞り込み条件に一致するデータがありません。':'有効なデータがありません。上のフォームから追加してください。'}</div>`);return}
  const frag=document.createDocumentFragment();
  items.forEach(it=>{
   const row=document.createElement('div');row.className='mm-row'+(maintState.editing&&maintState.editing.id===it.id?' editing':'');row.style.gridTemplateColumns=tmpl;row.tabIndex=0;row.title='クリックで編集フォームに読み込みます';
   const cells=def.cols.map(c=>`<span title="${esc(it[c.k]??'')}">${esc(it[c.k]??'')||'<em class="mm-blank">—</em>'}</span>`).join('');
   row.innerHTML=`${cells}<span class="mm-user" title="${esc(it.updated_by||'')}">${esc(it.updated_by||'-')}</span><span class="mm-date">${esc(fmtDT(it.updated_at))}</span><span class="mm-act"><button type="button" class="mm-edit">編集</button>${def.hasDelete?'<button type="button" class="mm-del">削除</button>':''}</span>`;
   const edit=()=>{maintState.editing=Object.assign({},it);renderMaintForm();const f=$('#masterMaintForm');if(f)f.scrollIntoView({block:'nearest'})};
   row.querySelector('.mm-edit').onclick=e=>{e.stopPropagation();edit()};
   const del=row.querySelector('.mm-del');if(del)del.onclick=e=>{e.stopPropagation();deleteMaint(it)};
   row.onclick=()=>edit();row.onkeydown=e=>{if(e.key==='Enter')edit()};
   frag.append(row);
  });
  list.append(frag);
 }
 function setMaintSearchVisible(show){
  const search=document.querySelector('#masterMaintModal .mm-search');if(search)search.style.display=show?'':'none';
  const cnt=$('#masterMaintCount');if(cnt)cnt.style.display=show?'':'none';
 }
 async function loadMaint(force){
  const def=currentDef();const title=$('#masterMaintTitle');if(title)title.textContent=def.label+'マスタ';
  if(def.special==='column-display'){setMaintSearchVisible(false);return loadColumnDisplayMaint(force)}
  if(def.special==='import-backup'){setMaintSearchVisible(false);return loadImportBackupMaint(force)}
  setMaintSearchVisible(true);
  const list=$('#masterMaintList');if(list&&force)list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  const multiField=def.fields.find(f=>f.type==='equipment-multi');
  // force未指定(キャッシュ利用)のままだと、設備マスタタブで新規登録・削除した
  // 直後でもオペレータタブの選択肢が古いままになる。loadMaint()のforceを
  // そのまま伝播し、タブを開き直すたびに最新の設備マスタを反映する。
  if(multiField&&typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){/* 設備マスタが読めなくてもオペレータ一覧の表示は継続する */}}
  renderMaintForm();
  try{
   const r=await api(def.endpoint);let items=(r&&r.items)||[];
   if(multiField)items=items.map(it=>({...it,[multiField.k+'Text']:(Array.isArray(it[multiField.k])&&it[multiField.k].length)?it[multiField.k].join('、'):'（制限なし・全設備）'}));
   maintState.items=items;
   renderMaintList();
  }catch(e){if(list)list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }

 /* ---------- 列表示マスタ（仕掛一覧・品質データの列表示/非表示を管理） ---------- */
 let columnDisplayState={dbs:[],dbKey:'',columns:[],hidden:[],loading:false};
 async function ensureColumnDisplayDbs(){
  if(columnDisplayState.dbs.length)return columnDisplayState.dbs;
  try{
   const r=await api('/api/catalog');
   columnDisplayState.dbs=(r&&r.databases||[]).filter(d=>d.role==='readonly');
  }catch(e){columnDisplayState.dbs=[]}
  if(!columnDisplayState.dbKey&&columnDisplayState.dbs.length)columnDisplayState.dbKey=columnDisplayState.dbs[0].key;
  return columnDisplayState.dbs;
 }
 async function loadColumnDisplayMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');
  if(!form||!list)return;
  await ensureColumnDisplayDbs();
  if(!columnDisplayState.dbKey){form.innerHTML='';list.innerHTML='<div class="mm-empty">対象となる一覧データベースがありません。</div>';return}
  if(force||list.dataset.cdLoaded!==columnDisplayState.dbKey){
   list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
   renderColumnDisplayForm();
   try{
    const r=await api('/api/column-display-master?db='+encodeURIComponent(columnDisplayState.dbKey));
    columnDisplayState.columns=(r&&r.columns)||[];columnDisplayState.hidden=(r&&r.hidden)||[];
    list.dataset.cdLoaded=columnDisplayState.dbKey;
    renderColumnDisplayList();
   }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
  }else{
   renderColumnDisplayForm();renderColumnDisplayList();
  }
 }
 function renderColumnDisplayForm(){
  const form=$('#masterMaintForm');if(!form)return;
  const tabs=columnDisplayState.dbs.map(d=>`<button type="button" class="mm-cd-tab${d.key===columnDisplayState.dbKey?' active':''}" data-cd-db="${esc(d.key)}">${esc(d.label)}</button>`).join('');
  form.innerHTML=`<div class="mm-form-head"><span class="mm-mode-chip new">列表示設定</span></div>
   <div class="mm-cd-toolbar">
    <div class="mm-cd-dbtabs">${tabs}</div>
    <div class="mm-cd-actions">
     <button type="button" id="mmCdShowAll" class="mm-btn-ghost sm">すべて表示</button>
     <button type="button" id="mmCdHideAll" class="mm-btn-ghost sm">すべて非表示</button>
     <button type="button" id="mmCdSave" class="mm-btn-primary">この画面の表示設定を保存</button>
    </div>
   </div>
   <p class="mm-form-hint">チェックを外した列は、対応する一覧画面（仕掛一覧・品質データ）から非表示になります。未設定の列は既定で表示されます。</p>`;
  form.onsubmit=ev=>ev.preventDefault();
  form.querySelectorAll('[data-cd-db]').forEach(b=>b.onclick=()=>{columnDisplayState.dbKey=b.dataset.cdDb;loadColumnDisplayMaint(true)});
  const showAll=$('#mmCdShowAll'),hideAll=$('#mmCdHideAll'),save=$('#mmCdSave');
  if(showAll)showAll.onclick=()=>document.querySelectorAll('#masterMaintList [data-cd-col]').forEach(b=>b.checked=true);
  if(hideAll)hideAll.onclick=()=>document.querySelectorAll('#masterMaintList [data-cd-col]').forEach(b=>b.checked=false);
  if(save)save.onclick=()=>saveColumnDisplayMaint();
 }
 function renderColumnDisplayList(){
  const list=$('#masterMaintList');if(!list)return;
  const hiddenSet=new Set(columnDisplayState.hidden);
  const columns=columnDisplayState.columns;
  if(!columns.length){list.innerHTML='<div class="mm-empty">対象テーブルの列が取得できませんでした。</div>';return}
  const boxes=columns.map(col=>`<label class="mm-checkbox mm-cd-checkbox"><input type="checkbox" data-cd-col="${esc(col)}"${hiddenSet.has(col)?'':' checked'}><span>${esc(col)}</span></label>`).join('');
  list.innerHTML=`<div class="mm-cd-grid">${boxes}</div>`;
 }
 async function saveColumnDisplayMaint(){
  const uid=requireMaintUser();if(uid===null)return;
  const hidden=[...document.querySelectorAll('#masterMaintList [data-cd-col]')].filter(b=>!b.checked).map(b=>b.dataset.cdCol);
  try{
   setMaintLoading(true,'表示設定を保存しています…');
   await api('/api/column-display-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({db:columnDisplayState.dbKey,hidden,user_id:uid})});
   columnDisplayState.hidden=hidden;
   showToast&&showToast('表示設定を保存しました',`非表示 ${hidden.length}列`,3600);
  }catch(e){showToast&&showToast('保存できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }
 /* ---------- データ引継ぎ（PC引継ぎ等で測定データ.accdbからIndexedDBへ取り込む） ----------
    通常はIndexedDB→測定データ.accdbの一方通行だが、PC更新等でIndexedDBが
    空の端末に対しては逆方向の取り込みが必要になる。対象のペイロードは
    codec='json-full-v32'（現行の完全JSONスナップショット）のみをサポートし、
    それ以外(旧形式等)は安全側に倒して「非対応」として選択不可にする。
    既存IDと衝突する場合は上書きになるため、選択状態を可視化した上で
    確認ダイアログを挟んでから実行する。 ---------- */
 let importBackupState={items:[],loaded:false,localIds:new Set()};
 async function loadImportBackupMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&importBackupState.loaded){renderImportBackupForm();renderImportBackupList();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">測定データ.accdbを読み込んでいます…</div>';
  try{
   const [backupResult,localItems]=await Promise.all([api('/api/measurement/backup/list'),reliableAll().catch(()=>[])]);
   importBackupState.items=(backupResult&&backupResult.items)||[];
   importBackupState.localIds=new Set(localItems.map(x=>x.id));
   importBackupState.loaded=true;
   renderImportBackupForm();renderImportBackupList();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 function renderImportBackupForm(){
  const form=$('#masterMaintForm');if(!form)return;
  const items=importBackupState.items,supported=items.filter(x=>x.codec==='json-full-v32');
  form.innerHTML=`<div class="mm-form-head"><span class="mm-mode-chip editing">PC引継ぎ専用</span></div>
   <div class="mm-import-warning">
    <b>注意: この操作はこの端末のIndexedDB（編集中/完了データ）を書き換えます。</b>
    <span>測定データ.accdb（Web測定バックアップ）の内容を、この端末のローカルデータへ取り込みます。同じIDの既存データは上書きされ、元に戻せません。PC更新・端末交換時の引継ぎなど、特別な場合以外は実行しないでください。</span>
   </div>
   <div class="mm-cd-toolbar">
    <span class="mm-form-hint">測定データ.accdb: ${esc(String(items.length))}件（うち取込可能 ${esc(String(supported.length))}件）</span>
    <div class="mm-cd-actions">
     <button type="button" id="mmImpReload" class="mm-btn-ghost sm">再読込</button>
     <button type="button" id="mmImpSelectAll" class="mm-btn-ghost sm">取込可能をすべて選択</button>
     <button type="button" id="mmImpSelectNone" class="mm-btn-ghost sm">選択解除</button>
     <button type="button" id="mmImpRun" class="mm-btn-danger">選択した項目をインポート</button>
    </div>
   </div>`;
  form.onsubmit=ev=>ev.preventDefault();
  const reload=$('#mmImpReload'),selAll=$('#mmImpSelectAll'),selNone=$('#mmImpSelectNone'),run=$('#mmImpRun');
  if(reload)reload.onclick=()=>loadImportBackupMaint(true);
  if(selAll)selAll.onclick=()=>document.querySelectorAll('#masterMaintList [data-imp-id]:not(:disabled)').forEach(b=>b.checked=true);
  if(selNone)selNone.onclick=()=>document.querySelectorAll('#masterMaintList [data-imp-id]').forEach(b=>b.checked=false);
  if(run)run.onclick=()=>runImportBackup();
 }
 function renderImportBackupList(){
  const list=$('#masterMaintList');if(!list)return;
  const items=importBackupState.items;
  if(!items.length){list.innerHTML='<div class="mm-empty">測定データ.accdbに取込可能なバックアップがありません。</div>';return}
  const tmpl='40px minmax(90px,1fr) minmax(70px,.7fr) minmax(60px,.6fr) minmax(70px,.7fr) minmax(90px,.8fr) minmax(90px,.9fr) 90px';
  const head=`<div class="mm-row head" style="grid-template-columns:${tmpl}"><span></span><span>ロット番号</span><span>検査番号</span><span>状態</span><span>設備</span><span>更新日時</span><span>形式</span><span>取込先</span></div>`;
  const rows=items.map(it=>{
   const supported=it.codec==='json-full-v32';
   const conflict=importBackupState.localIds.has(it.id);
   const targetLabel=supported?(conflict?'<span class="mm-imp-badge overwrite">上書き</span>':'<span class="mm-imp-badge new">新規</span>'):'<span class="mm-imp-badge unsupported">非対応</span>';
   return `<div class="mm-row" style="grid-template-columns:${tmpl}">`+
    `<span><input type="checkbox" data-imp-id="${esc(it.id)}"${supported?'':' disabled'}></span>`+
    `<span title="${esc(it.lotNo)}">${esc(it.lotNo)||'<em class="mm-blank">—</em>'}</span>`+
    `<span>${esc(it.inspectionNo)||'<em class="mm-blank">—</em>'}</span>`+
    `<span>${esc(it.status)||'<em class="mm-blank">—</em>'}</span>`+
    `<span title="${esc(it.equipment)}">${esc(it.equipment)||'<em class="mm-blank">—</em>'}</span>`+
    `<span class="mm-date">${esc(fmtDT(it.updated_at))}</span>`+
    `<span>${esc(it.codec)||'<em class="mm-blank">—</em>'}</span>`+
    `<span>${targetLabel}</span></div>`;
  }).join('');
  list.innerHTML=head+rows;
 }
 async function runImportBackup(){
  const uid=requireMaintUser();if(uid===null)return;
  const checked=[...document.querySelectorAll('#masterMaintList [data-imp-id]:checked')].map(b=>b.dataset.impId);
  if(!checked.length){showToast&&showToast('取込対象が選択されていません','取込可能な項目にチェックを付けてください。',4000);return}
  const targets=importBackupState.items.filter(it=>checked.includes(it.id));
  const overwriteCount=targets.filter(it=>importBackupState.localIds.has(it.id)).length;
  const warn=`選択した${targets.length}件をこの端末のIndexedDBへインポートします。`+
   (overwriteCount?`\nうち${overwriteCount}件は既存データを上書きし、元に戻せません。`:'\n既存データとの重複はありません。')+
   '\n\n本当に実行しますか？（PC引継ぎ等の特別な場合以外は「キャンセル」してください）';
  if(!confirm(warn))return;
  let okCount=0,ngCount=0;const errors=[];
  try{
   setMaintLoading(true,`インポートしています… (0/${targets.length})`);
   for(let i=0;i<targets.length;i++){
    const it=targets[i];
    setMaintLoading(true,`インポートしています… (${i+1}/${targets.length})`);
    try{
     const record=ensureMeasureShape(JSON.parse(it.payload));
     record.id=it.id;
     await reliablePut(record);okCount++;
    }catch(e){ngCount++;errors.push(`${it.lotNo||it.id}: ${e.message}`)}
   }
  }finally{setMaintLoading(false)}
  await refreshDraftCount();importBackupState.loaded=false;await loadImportBackupMaint(true);
  showToast&&showToast('インポートが完了しました',`成功 ${okCount}件 / 失敗 ${ngCount}件`+(errors.length?`\n${errors.slice(0,3).join('\n')}`:''),8000);
 }
 function openMasterMaint(){const modal=ensureMaintModal();const uid=$('#masterUserId');if(uid)uid.value=currentUserId();maintState.editing=null;maintState.query='';const se=$('#masterMaintSearch');if(se)se.value='';syncNav();modal.hidden=false;loadMaint(true);requestAnimationFrame(()=>{const u=$('#masterUserId');if(u&&!u.value)u.focus()})}

 function bindMasterMaint(){const b=$('#openMasterMaint');if(b)b.onclick=e=>{e.preventDefault();openMasterMaint()}}
 document.addEventListener('click',e=>{const t=e.target.closest('#openMasterMaint');if(!t)return;e.preventDefault();e.stopImmediatePropagation();openMasterMaint()},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#masterMaintModal')?.hidden){$('#masterMaintModal').hidden=true}},true);
 queueMicrotask(()=>{bindMasterMaint()});
})();



