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
  {key:'accessPermission',label:'アクセス権限',icon:'権',endpoint:'/api/access-permission-master',hasDelete:true,
   fields:[{k:'loginId',label:'ログインID',key:true},{k:'pcName',label:'PC名',key:true},
           {k:'canEdit',label:'編集可否',type:'select',options:['編集可','閲覧のみ']},
           {k:'canSchedule',label:'スケジュール可否',type:'select',options:['不可','可']},
           {k:'canFieldReorder',label:'現場段取り可否',type:'select',options:['不可','可']},
           {k:'fieldReorderEquipment',label:'現場段取り対象設備',type:'equipment-select'}],
   cols:[{k:'loginId',label:'ログインID',grow:2},{k:'pcName',label:'PC名',grow:2},{k:'canEdit',label:'編集可否',grow:1},{k:'canSchedule',label:'スケジュール',grow:1},{k:'canFieldReorder',label:'現場段取り',grow:1},{k:'fieldReorderEquipment',label:'対象設備',grow:1}],
   hint:'ログインID・PC名はどちらか一方だけの登録もできます(汎用的な運用のため)。片方だけ登録した場合、もう一方は「問わない」という意味になります(例: ログインIDだけ登録すると、そのユーザーはどの端末からでもこの権限になります)。両方登録した組み合わせが最優先で一致し、次に片方だけの登録、両方空欄の登録(全端末共通の既定)の順に判定します。登録の無い組み合わせは既定で編集可能・スケジュール不可・現場段取り不可として扱われます。特定の端末を閲覧専用にしたい場合はその端末を「閲覧のみ」で、作業スケジュールを操作させたい場合は「スケジュール可否」を「可」で登録してください。「現場段取り可否」は編集モードの端末に限り、対象設備の並べ替えだけを追加で許可します。'},
  {key:'loadFactor',label:'換算係数',icon:'率',special:'load-factor',endpoint:'/api/schedule/load-factors'},
  {key:'stopReason',label:'設備停止',icon:'停',endpoint:'/api/schedule/stop-reason-master',hasDelete:true,
   fields:[{k:'equipment',label:'設備名',type:'equipment-select',required:true,key:true},
           {k:'category',label:'分類',type:'select',options:['保全','段取り','待ち','突発','']},
           {k:'name',label:'名称',required:true,key:true},{k:'standardMinutes',label:'標準所要分',required:true}],
   cols:[{k:'equipment',label:'設備名',grow:1},{k:'category',label:'分類',grow:1},{k:'name',label:'名称',grow:2},{k:'standardMinutes',label:'標準所要分',grow:1}],
   hint:'作業スケジュール(docs/SCHEDULE_MODE_DESIGN.md §5.3)の設備停止予定で選べる名称と、その設備での標準所要分(分)です。同じ名称でも設備が異なれば別行として個別の時間を登録できます。「突発停止」は現場からの連絡を受けた計画担当が投入する運用のため、名称に登録しておくだけで自動では動きません。'},
  {key:'shiftMaster',label:'勤務形態',icon:'勤',endpoint:'/api/schedule/shift-master',hasDelete:true,
   fields:[{k:'equipment',label:'設備名(空欄=全設備既定)',type:'equipment-select',key:true},
           {k:'name',label:'名称',required:true,key:true},
           {k:'start',label:'開始時刻(HH:MM)',required:true},
           {k:'end',label:'終了時刻(HH:MM)',required:true}],
   cols:[{k:'equipment',label:'設備名',grow:1},{k:'name',label:'名称',grow:1},{k:'start',label:'開始',grow:1},{k:'end',label:'終了',grow:1}],
   hint:'作業スケジュール(docs/SCHEDULE_MODE_DESIGN.md §5.5)のタイムラインに出す「勤務」列の元データです。予定の時刻(時分)がこの範囲に入る行の名称を表示します。終了時刻を開始時刻以下にすると日をまたぐ勤務として扱います(例: 23:00〜07:00)。設備名を空欄にすると全設備の既定になり、特定の設備の設定があればそちらを優先します。設定例: 日勤=8:15〜17:05／1直=7:00〜15:00／2直=15:00〜23:00／3直=23:00〜07:00／4直=11:00〜19:10／5直=21:20〜05:45。'},
  {key:'columnDisplay',label:'列表示',icon:'列',special:'column-display'},
  {key:'importBackup',label:'データ引継ぎ',icon:'継',special:'import-backup'},
  {key:'pathConfig',label:'パス設定',icon:'路',special:'path-config',endpoint:'/api/path-config-master'},
  // 旧「マスタ一覧」(サイドバーのMASTERナビ→汎用グリッド)をここへ統合した
  // (ARCHITECTURE.md「マスタ管理の画面形態」)。上のタブが扱わないテーブル(表示マスタ・スケジュール列表示マスタ
  // 等)も含め、master.sqlite3の中身をそのまま確認するための読み取り専用タブ。
  {key:'rawTable',label:'テーブル生データ',icon:'表',special:'raw-table',readOnly:true},
 ];
 let maintState={defKey:'operator',items:[],editing:null,query:''};
 function currentDef(){return MASTER_DEFS.find(d=>d.key===maintState.defKey)||MASTER_DEFS[0]}
 // scheduleモードは作業予定(schedule Blueprint)以外のマスタへ書込できない
 // (backend/access_mode.pyの_WRITE_ALLOWED_MODES)。マスタ管理モーダル自体は
 // 開けるようにしつつ(設備停止マスタはscheduleモードでのみ書込可能なため)、
 // タブは自分のBlueprintで書けるものだけに絞る。
 function maintDefVisible(def){
  const mode=(window.accessMode&&window.accessMode.mode)||'edit';
  if(mode!=='schedule')return true;
  // 読み取り専用のタブ(テーブル生データ)は書込権限と無関係なのでどのモードでも
  // 出す。旧「マスタ一覧」ナビが全モードで見られた挙動を統合後も保つため(ARCHITECTURE.md「マスタ管理の画面形態」)。
  if(def.readOnly)return true;
  return !!(def.endpoint&&def.endpoint.indexOf('/api/schedule/')===0);
 }
 function firstVisibleDefKey(){const d=MASTER_DEFS.find(maintDefVisible);return d?d.key:MASTER_DEFS[0].key}
 function renderMaintNav(){
  const nav=$('#masterMaintNav');if(!nav)return;
  nav.innerHTML=MASTER_DEFS.filter(maintDefVisible).map(d=>`<button type="button" data-master="${d.key}"><span class="mm-nav-ico" aria-hidden="true">${esc(d.icon)}</span><span class="mm-nav-label">${esc(d.label)}</span></button>`).join('');
  nav.querySelectorAll('[data-master]').forEach(b=>b.onclick=()=>{maintState.defKey=b.dataset.master;maintState.editing=null;maintState.query='';const se=$('#masterMaintSearch');if(se)se.value='';syncNav();loadMaint(true)});
  syncNav();
 }

 /* ---------- 画面の形態(ARCHITECTURE.md「マスタ管理の画面形態」改訂) ----------
    以前は全画面シェード付きのモーダル(.record-modal.mm-modal)だったが、
    「モーダルにした意味が無い使い方(常時開きっぱなしで一覧を見る画面)」
    という指摘のため、帳票(rp-mode)・実績カレンダー(cal-mode)・作業スケジュール
    (sc-mode)と同じメイン画面統合型(body.mm-mode + #masterMaintPanel)へ
    作り直した。内側の構造(.mm-dialog以下)とid(#masterMaintNav/
    #masterMaintForm/#masterMaintList等)は一切変えていないため、列表示・
    データ引継ぎ・換算係数・パス設定といった特殊タブの描画コードは
    そのまま動く(.mm-panel .mm-dialogのCSSで寸法だけ上書きする)。 */
 function ensureMaintPanel(){
  let panel=$('#masterMaintPanel');if(panel)return panel;
  panel=document.createElement('section');panel.className='mm-panel';panel.id='masterMaintPanel';panel.hidden=true;
  panel.innerHTML=`<div class="mm-dialog">
   <header class="mm-head">
    <div class="mm-head-title"><h2>マスタ管理</h2><span class="mm-sub">登録内容の追加・編集・無効化。更新はすべて更新者IDとともに記録されます。</span></div>
    <label class="mm-head-user">更新者ID<input id="masterUserId" type="text" autocomplete="off" placeholder="社員番号など"></label>
    <button id="closeMasterMaint" class="mm-close" type="button" aria-label="マスタ管理を閉じる" title="マスタ管理を閉じる">×</button>
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
  const grid=$('#grid');grid?.parentNode?.insertBefore(panel,grid);
  $('#closeMasterMaint').onclick=()=>exitMasterMaint();
  const uid=$('#masterUserId');if(uid){uid.value=currentUserId();uid.onchange=()=>setUserId(uid.value)}
  $('#reloadMasterMaint').onclick=()=>loadMaint(true);
  const search=$('#masterMaintSearch');if(search){search.oninput=()=>{maintState.query=search.value;renderMaintList()}}
  renderMaintNav();
  return panel;
 }
 function exitMasterMaint(){
  if(!document.body.classList.contains('mm-mode'))return;
  document.body.classList.remove('mm-mode');
  const panel=$('#masterMaintPanel');if(panel)panel.hidden=true;
  closeMaintEditor();
  document.getElementById('openMasterMaint')?.classList.remove('active');
 }
 window.exitMasterMaint=exitMasterMaint;
 function syncNav(){document.querySelectorAll('#masterMaintNav [data-master]').forEach(b=>b.classList.toggle('active',b.dataset.master===maintState.defKey))}
 function requireMaintUser(){const el=$('#masterUserId');const id=String(el?el.value:'').trim();if(!id){showToast('更新者IDを入力してください','マスタ更新には更新者IDが必要です。',4200);el&&el.focus();return null}setUserId(id);return id}

 /* ---------- モーダル化の基準(ARCHITECTURE.md「マスタ管理の画面形態」) ----------
    「モーダルにする意味」をここ1箇所で定義する。
      ・一覧・検索・軽い追加は常にメイン画面(統合パネル)側で完結させる。
        画面を覆う理由が無く、覆うと背後の一覧と見比べられなくなるため。
      ・入力項目が多い/専用コントロールを伴う編集だけをモーダルにする。
        上部インラインフォームのままだと縦幅を大きく取って一覧の表示領域を
        圧迫し、フォームと一覧のどちらも中途半端に見える状態になるため
        (実際に報告された指摘)。編集の間は一覧を操作させない方が安全でもある。
    判定は「入力項目がEDITOR_MODAL_MIN_FIELDS以上」「専用コントロール
    (設備の複数選択タグ入力)を含む」「defで明示(editorModal:true)」のいずれか。
    現状: オペレータ(タグ入力)・アクセス権限(6項目)・設備停止(4項目)・
    勤務形態(4項目)がモーダル、機器/スプール/内径/設備はインラインのまま。 */
 const EDITOR_MODAL_MIN_FIELDS=4;
 const RICH_FIELD_TYPES=['equipment-multi'];
 function defUsesEditorModal(def){
  if(!def||!Array.isArray(def.fields)||!def.fields.length)return false;
  if(def.editorModal===true)return true;
  if(def.fields.some(f=>RICH_FIELD_TYPES.includes(f.type)))return true;
  return def.fields.length>=EDITOR_MODAL_MIN_FIELDS;
 }
 function buildFieldControls(def,editing){
  return def.fields.map(f=>{
   const val=editing?String(editing[f.k]??''):'';
   if(f.type==='equipment-select'){
    const opts=equipmentMasterState.items||[];
    if(!opts.length){
     return `<div class="mm-field"><span>${esc(f.label)}</span><span class="mm-empty-inline">設備マスタが未登録です。先に「設備」タブで登録してください。</span></div>`;
    }
    const optHtml=opts.map(eq=>`<option value="${esc(eq.name)}"${eq.name===val?' selected':''}>${esc(eq.name)}</option>`).join('');
    return `<label class="mm-field"><span>${esc(f.label)}${f.required?'<i>*</i>':''}${f.key?'<em class="mm-keytag">キー</em>':''}</span><select data-field="${f.k}"><option value="">選択...</option>${optHtml}</select></label>`;
   }
   if(f.type==='equipment-multi'){
    const selected=new Set((editing&&Array.isArray(editing[f.k])?editing[f.k]:[]).map(String));
    const opts=equipmentMasterState.items||[];
    if(!opts.length){
     return `<div class="mm-field"><span>${esc(f.label)}</span><span class="mm-empty-inline">設備マスタが未登録です。先に「設備」タブで登録してください。</span></div>`;
    }
    const hiddenBoxes=opts.map(eq=>`<input type="checkbox" data-equipment-field="${f.k}" value="${esc(eq.name)}"${selected.has(eq.name)?' checked':''} hidden>`).join('');
    const tags=opts.filter(eq=>selected.has(eq.name)).map(eq=>`<span class="mm-tag">${esc(eq.name)}<button type="button" class="mm-tag-remove" aria-label="${esc(eq.name)}を削除">×</button></span>`).join('');
    return `<div class="mm-field mm-tagfield" data-tagfield="${f.k}"><span>${esc(f.label)}</span>
     <div class="mm-tagfield-inner">
      <div class="mm-tag-box" data-equipment-box="${f.k}" tabindex="-1">${tags}<input type="text" class="mm-tag-search" data-equipment-search="${f.k}" placeholder="設備名で検索・追加" autocomplete="off">${hiddenBoxes}</div>
      <div class="mm-tag-suggest" data-equipment-suggest="${f.k}" hidden></div>
     </div>
     <small class="mm-field-hint">クリックで追加・×で削除。未選択なら制限なし（全設備で表示対象）。</small></div>`;
   }
   if(f.type==='select'){
    const opts=(f.options||[]).map(o=>`<option value="${esc(o)}"${o===val?' selected':''}>${esc(o||'（指定なし）')}</option>`).join('');
    return `<label class="mm-field"><span>${esc(f.label)}${f.required?'<i>*</i>':''}${f.key?'<em class="mm-keytag">キー</em>':''}</span><select data-field="${f.k}">${opts}</select></label>`;
   }
   return `<label class="mm-field"><span>${esc(f.label)}${f.required?'<i>*</i>':''}${f.key?'<em class="mm-keytag">キー</em>':''}</span><input data-field="${f.k}" type="text" value="${esc(val)}" autocomplete="off"></label>`;
  }).join('');
 }
 function renderMaintForm(){
  const def=currentDef(),form=$('#masterMaintForm');if(!form)return;const editing=maintState.editing;
  // 入力項目が多いマスタは、上部に常設のフォームを置かず(一覧の表示領域を
  // 空けるため)、編集専用モーダルへ入口だけを出す(ARCHITECTURE.md「マスタ管理の画面形態」)。
  if(defUsesEditorModal(def)){
   form.classList.add('mm-form-compact');
   form.innerHTML=`<div class="mm-form-head">
     <span class="mm-mode-chip new">新規登録</span>
     <button type="button" id="masterMaintAdd" class="mm-btn-primary sm">＋ ${esc(def.label)}を追加</button>
     <span class="mm-form-hint">一覧の行をクリック（またはダブルクリック・「編集」ボタン）で編集ウィンドウを開きます。</span>
    </div>
    ${def.hint?`<p class="mm-def-hint">${esc(def.hint)}</p>`:''}`;
   form.onsubmit=ev=>ev.preventDefault();
   const ab=$('#masterMaintAdd');if(ab)ab.onclick=()=>openMaintEditor(null);
   return;
  }
  form.classList.remove('mm-form-compact');
  const controls=buildFieldControls(def,editing);
  const chip=editing?`<span class="mm-mode-chip editing">編集中 <b>${esc(editing[def.cols[0].k]||'')}</b><small>ID:${esc(editing.id)}</small></span>`:`<span class="mm-mode-chip new">新規登録</span>`;
  form.innerHTML=`<div class="mm-form-head">${chip}${editing?'<button type="button" id="masterMaintNew" class="mm-btn-ghost sm">＋ 新規入力に切替</button>':''}</div>
   ${def.hint?`<p class="mm-def-hint">${esc(def.hint)}</p>`:''}
   <div class="mm-form-fields">${controls}</div>
   <div class="mm-form-tail"><button type="submit" class="mm-btn-primary">${editing?'更新を保存':'追加登録'}</button><span class="mm-form-hint">${editing?'キー項目（名称・区分など）も変更できます。保存すると同じIDのまま更新（リネーム）されます。同名が既にある場合は更新できません。':'必須(*)を入力して追加登録します。'}</span></div>`;
  form.onsubmit=ev=>{ev.preventDefault();submitMaint()};
  const nb=$('#masterMaintNew');if(nb)nb.onclick=()=>{maintState.editing=null;renderMaintForm()};
  bindEquipmentPickers(form);
 }

 /* ---------- 汎用の編集専用モーダル(ARCHITECTURE.md「マスタ管理の画面形態」新設) ----------
    どのマスタでも同じ枠を使う。中身(入力欄)はbuildFieldControls()が
    MASTER_DEFSのfields定義から組み立てるため、マスタを増やしても
    このモーダル自体には手を入れなくてよい。 */
 function ensureMaintEditor(){
  let modal=$('#maintEditorModal');if(modal)return modal;
  modal=document.createElement('div');modal.className='record-modal mm-editor-modal';modal.id='maintEditorModal';modal.hidden=true;
  modal.innerHTML=`<div class="mm-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="maintEditorTitle">
    <header class="mm-editor-head">
     <div><small id="maintEditorEyebrow">MASTER</small><h2 id="maintEditorTitle">編集</h2></div>
     <button type="button" id="maintEditorClose" class="mm-close" aria-label="閉じる">×</button>
    </header>
    <form class="mm-editor-body" id="maintEditorForm"></form>
    <!-- 下段は<footer>ではなく<div>にすること。メイン画面統合型ビューの
         共通ルール(body.mm-mode footer{display:none!important}等)は要素
         セレクタのfooterを対象にしているため、<footer>で組むとこのモーダルの
         保存・キャンセルボタンごと消える(実装時に踏んだ不具合)。 -->
    <div class="mm-editor-foot">
     <span class="mm-form-hint" id="maintEditorHint"></span>
     <div class="mm-editor-actions">
      <button type="button" id="maintEditorCancel" class="mm-btn-ghost">キャンセル</button>
      <button type="button" id="maintEditorSave" class="mm-btn-primary">保存</button>
     </div>
    </div>
   </div>`;
  document.body.append(modal);
  $('#maintEditorClose').onclick=()=>closeMaintEditor();
  $('#maintEditorCancel').onclick=()=>closeMaintEditor();
  $('#maintEditorSave').onclick=()=>submitMaint('#maintEditorForm');
  modal.addEventListener('click',ev=>{if(ev.target===modal)closeMaintEditor()});
  return modal;
 }
 function openMaintEditor(item){
  const def=currentDef();if(!defUsesEditorModal(def))return;
  const modal=ensureMaintEditor();
  maintState.editing=item?Object.assign({},item):null;
  const editing=maintState.editing;
  $('#maintEditorEyebrow').textContent=def.label+'マスタ';
  $('#maintEditorTitle').textContent=editing?`${String(editing[def.cols[0].k]??'')||'(名称なし)'} を編集`:`${def.label}を新規登録`;
  $('#maintEditorHint').textContent=editing
   ?'キー項目（名称・区分など）も変更できます。保存すると同じIDのまま更新されます。'
   :'必須(*)を入力して登録します。';
  $('#maintEditorSave').textContent=editing?'更新を保存':'追加登録';
  const form=$('#maintEditorForm');
  form.innerHTML=`${def.hint?`<p class="mm-def-hint">${esc(def.hint)}</p>`:''}
   <div class="mm-form-fields">${buildFieldControls(def,editing)}</div>`;
  form.onsubmit=ev=>{ev.preventDefault();submitMaint('#maintEditorForm')};
  bindEquipmentPickers(form);
  modal.hidden=false;
  requestAnimationFrame(()=>{const first=form.querySelector('[data-field],[data-equipment-search]');if(first)first.focus()});
 }
 function closeMaintEditor(){
  const modal=$('#maintEditorModal');if(!modal||modal.hidden)return;
  modal.hidden=true;maintState.editing=null;renderMaintList();
 }
 // 作業可能設備タグ入力: フォーカスで登録済み設備をサジェスト、クリックで
 // 連続追加できるようにする（認識優先＝再入力不要、逐次追加を高速化）。
 // 送信時の互換性のため、選択状態は非表示チェックボックス(data-equipment-field)
 // で保持し、submitMaint()側の読み取りロジックは変更しない。
 function bindEquipmentPickers(form){
  form.querySelectorAll('[data-tagfield]').forEach(field=>{
   const fk=field.dataset.tagfield;
   const box=field.querySelector(`[data-equipment-box="${fk}"]`);
   const search=field.querySelector(`[data-equipment-search="${fk}"]`);
   const suggest=field.querySelector(`[data-equipment-suggest="${fk}"]`);
   if(!box||!search||!suggest)return;
   const opts=equipmentMasterState.items||[];
   const checkbox=name=>[...box.querySelectorAll(`[data-equipment-field="${fk}"]`)].find(b=>b.value===name);
   const selectedNames=()=>opts.filter(eq=>{const cb=checkbox(eq.name);return cb&&cb.checked}).map(eq=>eq.name);
   const setChecked=(name,val)=>{const cb=checkbox(name);if(cb)cb.checked=val};
   function renderTags(){
    box.querySelectorAll('.mm-tag').forEach(t=>t.remove());
    selectedNames().forEach(name=>{
     const tag=document.createElement('span');tag.className='mm-tag';
     tag.innerHTML=`${esc(name)}<button type="button" class="mm-tag-remove" aria-label="${esc(name)}を削除">×</button>`;
     tag.querySelector('.mm-tag-remove').onclick=ev=>{ev.stopPropagation();setChecked(name,false);renderTags();renderSuggest();search.focus()};
     box.insertBefore(tag,search);
    });
   }
   function renderSuggest(){
    const q=String(search.value||'').normalize('NFKC').toLowerCase().trim();
    const selected=new Set(selectedNames());
    const items=opts.filter(eq=>!selected.has(eq.name)&&(!q||eq.name.normalize('NFKC').toLowerCase().includes(q)));
    if(!items.length){suggest.innerHTML=`<div class="mm-tag-suggest-empty">${selected.size>=opts.length?'すべて選択済みです':'該当する設備がありません'}</div>`;return}
    suggest.innerHTML=items.map(eq=>`<button type="button" class="mm-tag-suggest-item" data-pick="${esc(eq.name)}">${esc(eq.name)}</button>`).join('');
    suggest.querySelectorAll('[data-pick]').forEach(btn=>{btn.onclick=ev=>{ev.stopPropagation();setChecked(btn.dataset.pick,true);search.value='';renderTags();renderSuggest();search.focus()}});
   }
   search.addEventListener('focus',()=>{renderSuggest();suggest.hidden=false});
   search.addEventListener('input',()=>{renderSuggest();suggest.hidden=false});
   search.addEventListener('keydown',ev=>{
    if(ev.key==='Backspace'&&!search.value){const names=selectedNames();if(names.length){setChecked(names[names.length-1],false);renderTags();renderSuggest()}}
    else if(ev.key==='Escape'){suggest.hidden=true;search.blur()}
    else if(ev.key==='Enter'){
     // このinputはフォーム内にあるため、既定動作のままだとEnterで
     // フォーム送信(登録・更新)が誤爆する。先頭の候補を追加する操作として扱う。
     ev.preventDefault();
     const first=suggest.querySelector('[data-pick]');
     if(first){setChecked(first.dataset.pick,true);search.value='';renderTags();renderSuggest()}
    }
   });
   search.addEventListener('blur',()=>{setTimeout(()=>{if(document.activeElement!==search)suggest.hidden=true},150)});
   box.addEventListener('mousedown',ev=>{if(ev.target===box){ev.preventDefault();search.focus()}});
   renderTags();
  });
 }

 function setMaintLoading(show,text){
  const dialog=$('#masterMaintPanel .mm-dialog');if(!dialog)return;
  let box=dialog.querySelector(':scope > .mm-loading');
  if(show){
   if(!box){box=document.createElement('div');box.className='mm-loading';box.innerHTML='<div class="mm-loading-box"><span class="mini-spinner"></span><b></b></div>';dialog.appendChild(box)}
   box.querySelector('b').textContent=text||'処理しています…';box.hidden=false;
  }else if(box){box.hidden=true}
 }
 /* 設備マスタの新規登録専用: 過去に削除(無効化)された同名設備があると
    サーバーはinactive_equipment_name_conflictで409を返す(選択の余地がある
    ため)。既存の確認モーダル(2択)をそのまま2段階連ねて選ばせ、共通
    コンポーネント自体には手を入れない。どちらもキャンセルした場合はnullを
    返し、呼び出し側(submitMaint)は何も表示せず処理を終える。 */
 async function registerEquipmentWithChoice(body){
  try{
   return await api('/api/equipment-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  }catch(e){
   if(e.code!=='inactive_equipment_name_conflict')throw e;
   const restore=await confirmModal({
    eyebrow:'設備マスタ',title:'過去に削除された設備名です',
    message:`「${body.name}」は過去に削除(無効化)された設備と同じ名前です。\n\n同じ設備として復元しますか？\n(これまでのスケジュール等の履歴はそのまま引き継がれます)`,
    confirmLabel:'同じ設備として復元',cancelLabel:'別の選択肢を見る'
   });
   if(restore)return api('/api/equipment-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,reuseExisting:true})});
   const asNew=await confirmModal({
    eyebrow:'設備マスタ',title:'別の新しい設備として登録しますか？',
    message:`「${body.name}」を、過去の設備とは別の新しい設備として登録します。\n\n過去の履歴は「${body.name}(旧…)」という名前へ切り離され、以後は新しい「${body.name}」の履歴として記録されます。`,
    confirmLabel:'新しい設備として登録'
   });
   if(!asNew)return null;
   return api('/api/equipment-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,reuseExisting:false})});
  }
 }
 /* rootSel: 入力欄を読む対象。インラインフォーム(#masterMaintForm)と
    編集モーダル(#maintEditorForm)のどちらからでも同じ処理で保存する。 */
 async function submitMaint(rootSel){
  const root=rootSel||'#masterMaintForm';
  const def=currentDef(),uid=requireMaintUser();if(uid===null)return;const editing=maintState.editing;
  const body={user_id:uid};let ok=true;
  if(editing)body.id=editing.id;
  def.fields.forEach(f=>{
   if(f.type==='equipment-multi'){body[f.k]=[...document.querySelectorAll(`${root} [data-equipment-field="${f.k}"]:checked`)].map(el=>el.value);return}
   const el=$(`${root} [data-field="${f.k}"]`);const v=String(el?el.value:'').trim();if(f.required&&!v)ok=false;body[f.k]=v;
  });
  if(!ok){showToast('入力を確認してください','必須項目が未入力です。',4000);return}
  const endpoint=editing?def.endpoint+'/update':def.endpoint;
  try{
   setMaintLoading(true,editing?`${def.label}を更新しています…`:`${def.label}を登録しています…`);
   const r=(def.key==='equipment'&&!editing)?await registerEquipmentWithChoice(body):await api(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(r===null)return; // 設備の新規/復元どちらもキャンセルされた
   // 編集モーダルから保存した場合は閉じてから一覧を更新する(closeMaintEditor
   // 自身もrenderMaintListを呼ぶが、直後のloadMaintで最新データに置き換わる)。
   const modal=$('#maintEditorModal');
   if(modal&&!modal.hidden){modal.hidden=true}
   maintState.editing=null;await loadMaint(true);
   showToast&&showToast(def.label+(editing?'を更新しました':'を登録しました'),(r&&r.message)||'',3600);
  }catch(e){showToast&&showToast(editing?'更新できませんでした':'登録できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }
 /* 設備マスタの削除確認: docs/SCHEDULE_MODE_DESIGN.md §5.0.1のとおり、まず
    拒否して関連スケジュールデータの内訳を提示し、利用者が再確認のうえ
    明示的に選んだ場合のみforce:trueで再送する(削除してもスケジュール側の
    データ自体は一切書き換えない・履歴として残る)。 */
 function scheduleReferenceLabels(){
  return {pendingPlans:'未着手の作業予定',inProgressPlans:'着手中の作業予定',completedPlans:'完了済みの作業予定',
          calendarRows:'稼働カレンダー',stopReasonRows:'設備停止マスタ',loadFactorOverrideRows:'換算係数の手動上書き',
          fieldReorderTerminals:'現場段取り対象に設定中の端末'};
 }
 async function deleteEquipmentWithReferenceCheck(item,uid){
  try{
   setMaintLoading(true,'設備マスタを無効化しています…');
   await api('/api/equipment-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,user_id:uid})});
   return true;
  }catch(e){
   if(e.code!=='schedule_references_exist')throw e;
   setMaintLoading(false);
   const labels=scheduleReferenceLabels();
   const rows=Object.entries(e.references||{}).filter(([,v])=>v>0)
    .map(([k,v])=>`<tr class="${k==='inProgressPlans'?'eq-ref-warn':''}"><td>${esc(labels[k]||k)}</td><td>${v}件</td></tr>`).join('');
   const proceed=await confirmModal({
    eyebrow:'設備マスタ',title:'関連するスケジュールデータがあります',danger:true,
    bodyHtml:`<p class="confirm-modal-message">「${esc(item.name||'')}」には以下のスケジュールデータが関連しています。削除すると、これらは履歴として残りますが、今後この設備は仕掛一覧・スケジュール画面・現場段取りの選択肢から外れます。よろしいですか?</p>
     <table class="eq-ref-table"><tbody>${rows}</tbody></table>`,
    confirmLabel:'削除する',cancelLabel:'キャンセル'
   });
   if(!proceed)return false;
   setMaintLoading(true,'設備マスタを無効化しています…');
   await api('/api/equipment-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,user_id:uid,force:true})});
   return true;
  }finally{
   setMaintLoading(false);
  }
 }
 async function deleteMaint(item){
  const def=currentDef();if(!def.hasDelete)return;const uid=requireMaintUser();if(uid===null)return;
  const nm=item[def.cols[0].k]||item.name||'';
  if(def.key==='equipment'){
   try{
    const proceeded=await deleteEquipmentWithReferenceCheck(item,uid);
    if(!proceeded)return;
    if(maintState.editing&&maintState.editing.id===item.id)maintState.editing=null;
    await loadMaint(true);showToast&&showToast(def.label+'を無効化しました',nm,3600);
   }catch(e){showToast&&showToast('削除できませんでした',e.message,6500)}
   return;
  }
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
   const row=document.createElement('div');row.className='mm-row'+(maintState.editing&&maintState.editing.id===it.id?' editing':'');row.style.gridTemplateColumns=tmpl;row.tabIndex=0;row.setAttribute('role','button');row.title='クリックで編集フォームに読み込みます';
   const cells=def.cols.map(c=>`<span title="${esc(it[c.k]??'')}">${esc(it[c.k]??'')||'<em class="mm-blank">—</em>'}</span>`).join('');
   row.innerHTML=`${cells}<span class="mm-user" title="${esc(it.updated_by||'')}">${esc(it.updated_by||'-')}</span><span class="mm-date">${esc(fmtDT(it.updated_at))}</span><span class="mm-act"><button type="button" class="mm-edit">編集</button>${def.hasDelete?'<button type="button" class="mm-del">削除</button>':''}</span>`;
   // 入力項目が多いマスタは編集専用モーダル、少ないマスタは従来どおり
   // 上部のインラインフォームへ読み込む(ARCHITECTURE.md「マスタ管理の画面形態」、defUsesEditorModal)。
   const edit=()=>{
    if(defUsesEditorModal(def)){openMaintEditor(it);return}
    maintState.editing=Object.assign({},it);renderMaintForm();
    const f=$('#masterMaintForm');if(f)f.scrollIntoView({block:'nearest'});
   };
   row.querySelector('.mm-edit').onclick=e=>{e.stopPropagation();edit()};
   const del=row.querySelector('.mm-del');if(del)del.onclick=e=>{e.stopPropagation();deleteMaint(it)};
   row.onclick=()=>edit();row.ondblclick=()=>edit();
   row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){if(e.key===' ')e.preventDefault();edit()}};
   frag.append(row);
  });
  list.append(frag);
 }
 function setMaintSearchVisible(show){
  const search=document.querySelector('#masterMaintPanel .mm-search');if(search)search.style.display=show?'':'none';
  const cnt=$('#masterMaintCount');if(cnt)cnt.style.display=show?'':'none';
 }
 async function loadMaint(force){
  const def=currentDef();const title=$('#masterMaintTitle');if(title)title.textContent=def.label+'マスタ';
  if(def.special==='column-display'){setMaintSearchVisible(false);return loadColumnDisplayMaint(force)}
  if(def.special==='import-backup'){setMaintSearchVisible(false);return loadImportBackupMaint(force)}
  if(def.special==='load-factor'){setMaintSearchVisible(false);return loadLoadFactorMaint(force)}
  if(def.special==='path-config'){setMaintSearchVisible(false);return loadPathConfigMaint(force)}
  if(def.special==='raw-table'){setMaintSearchVisible(false);return loadRawTableMaint(force)}
  setMaintSearchVisible(true);
  const list=$('#masterMaintList');if(list&&force)list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  const multiField=def.fields.find(f=>f.type==='equipment-multi');
  const needsEquipmentMaster=multiField||def.fields.some(f=>f.type==='equipment-select');
  // force未指定(キャッシュ利用)のままだと、設備マスタタブで新規登録・削除した
  // 直後でもオペレータ/設備停止タブの選択肢が古いままになる。loadMaint()の
  // forceをそのまま伝播し、タブを開き直すたびに最新の設備マスタを反映する。
  if(needsEquipmentMaster&&typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){/* 設備マスタが読めなくても一覧の表示は継続する */}}
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
 /* ---------- 換算係数モデル(docs/SCHEDULE_MODE_DESIGN.md §6・§9.8) ----------
    因子×水準の一覧(自動算出値・N数・上書き値)は「自動算出＋上書き」の2層
    構造で汎用CRUDのフォームに載らないため、列表示マスタと同じ特別扱いにする。 */
 let loadFactorState={equipment:'',configured:true,model:null,accuracy:null};
 function loadFactorBasisLabel(b){return {equipment:'自設備の実績',pooled:'全設備プール(自設備は実績不足)',default:'算出不可(実績なし)'}[b]||b||'-'}
 function fmtLfMinutes(min){if(min===null||min===undefined)return '-';const v=Math.round(min);if(v<60)return `${v}分`;return `${Math.floor(v/60)}時間${v%60?(v%60)+'分':''}`}
 async function loadLoadFactorMaint(force){
  const list=$('#masterMaintList');if(!list)return;
  if(typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){/* 設備マスタが読めなくても画面表示は継続する */}}
  const opts=equipmentMasterState.items||[];
  if(!loadFactorState.equipment&&opts.length)loadFactorState.equipment=opts[0].name;
  renderLoadFactorForm();
  if(!loadFactorState.equipment){list.innerHTML='<div class="mm-empty">設備マスタが未登録です。先に「設備」タブで登録してください。</div>';return}
  list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const [lf,acc]=await Promise.all([
    api('/api/schedule/load-factors?equipment='+encodeURIComponent(loadFactorState.equipment)),
    api('/api/schedule/accuracy?equipment='+encodeURIComponent(loadFactorState.equipment)).catch(()=>null),
   ]);
   loadFactorState.configured=!!(lf&&lf.configured);
   loadFactorState.model=loadFactorState.configured?lf.model:null;
   loadFactorState.accuracy=acc;
   renderLoadFactorList();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 function renderLoadFactorForm(){
  const form=$('#masterMaintForm');if(!form)return;
  const opts=equipmentMasterState.items||[];
  const optHtml=opts.map(eq=>`<option value="${esc(eq.name)}"${eq.name===loadFactorState.equipment?' selected':''}>${esc(eq.name)}</option>`).join('');
  form.innerHTML=`<div class="mm-form-head"><span class="mm-mode-chip new">換算係数モデル</span></div>
   <div class="mm-cd-toolbar">
    <div class="mm-cd-dbtabs"><select id="mmLfEquipment">${optHtml||'<option value="">設備マスタが未登録です</option>'}</select></div>
    <div class="mm-cd-actions"><button type="button" id="mmLfRecalc" class="mm-btn-ghost sm">再計算</button></div>
   </div>
   <p class="mm-form-hint">因子ごとの自動算出係数(§6)と手動上書きです。係数を入力して保存すると上書きが有効になり、空欄で保存すると解除されます。「BASE」行は基準時間T0(1件あたりの基準所要分)自体を分単位で上書きします。</p>`;
  form.onsubmit=ev=>ev.preventDefault();
  const sel=$('#mmLfEquipment');
  if(sel)sel.onchange=()=>{loadFactorState.equipment=sel.value;loadLoadFactorMaint(false)};
  const recalc=$('#mmLfRecalc');
  if(recalc)recalc.onclick=async()=>{
   const uid=requireMaintUser();if(uid===null)return;
   try{
    setMaintLoading(true,'再計算しています…');
    await api('/api/schedule/load-factors/recalc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({equipment:loadFactorState.equipment,user_id:uid})});
    await loadLoadFactorMaint(true);
    showToast&&showToast('再計算しました','',3200);
   }catch(e){showToast&&showToast('再計算できませんでした',e.message,6500)}
   finally{setMaintLoading(false)}
  };
 }
 function renderLoadFactorList(){
  const list=$('#masterMaintList');if(!list)return;
  if(!loadFactorState.configured){list.innerHTML='<div class="mm-empty">スケジュール機能が設定されていません(config/local.jsonのschedule_share_path未設定)。</div>';return}
  const model=loadFactorState.model;
  if(!model){list.innerHTML='<div class="mm-empty">この設備の完了実績がまだ無く、係数を算出できません。</div>';return}
  const acc=loadFactorState.accuracy;
  const baseOv=(model.overrides||[]).find(o=>o.factor==='BASE');
  const summary=`<div class="lf-summary">
   <div><small>基準</small><b>${esc(loadFactorBasisLabel(model.basis))}</b></div>
   <div><small>基準時間T0</small><b>${fmtLfMinutes(model.T0)}</b>${baseOv?`<span class="lf-override-note">→ 上書き適用中: ${fmtLfMinutes(baseOv.coefficient)}</span>`:''}</div>
   <div><small>実績件数</small><b>${model.n}件${model.excluded?`(外れ値${model.excluded}件除外)`:''}</b></div>
   <div><small>ばらつき(σ)</small><b>${model.sigmaLog!=null?model.sigmaLog:'-'}</b></div>
   ${acc&&acc.n?`<div><small>精度: 中央値バイアス</small><b>${acc.medianLogBias>0?'+':''}${acc.medianLogBias}</b></div>
   <div><small>精度: MAPE相当</small><b>${Math.round((acc.mape||0)*100)}%(n=${acc.n})</b></div>`:''}
  </div>`;
  const overrideMap={};
  (model.overrides||[]).forEach(o=>{overrideMap[o.factor+' '+(o.level||'')]=o});
  const baseOverride=overrideMap['BASE '];
  const baseRow=`<div class="lf-row lf-row-base">
   <span class="lf-row-key">BASE</span><span class="lf-row-level">基準時間T0</span>
   <span class="lf-row-value">${fmtLfMinutes(model.T0)}</span><span class="lf-row-n">n=${model.n}</span>
   <span class="lf-row-override"><input type="number" step="0.1" min="0" placeholder="分で上書き" data-lf-factor="BASE" data-lf-level="" value="${baseOverride?baseOverride.coefficient:''}"></span>
   <span class="lf-row-actions"><button type="button" class="mm-btn-ghost sm" data-lf-save="BASE|">保存</button>${baseOverride?'<button type="button" class="mm-btn-ghost sm" data-lf-clear="BASE|">解除</button>':''}</span>
  </div>`;
  const factorRows=(model.factors||[]).map(f=>{
   const ov=overrideMap[f.key+' '+f.level];
   return `<div class="lf-row">
    <span class="lf-row-key">${esc(f.key)}</span><span class="lf-row-level">${esc(f.level)}</span>
    <span class="lf-row-value">×${f.value}</span><span class="lf-row-n">n=${f.n}</span>
    <span class="lf-row-override"><input type="number" step="0.01" min="0" placeholder="係数で上書き" data-lf-factor="${esc(f.key)}" data-lf-level="${esc(f.level)}" value="${ov?ov.coefficient:''}"></span>
    <span class="lf-row-actions"><button type="button" class="mm-btn-ghost sm" data-lf-save="${esc(f.key)}|${esc(f.level)}">保存</button>${ov?`<button type="button" class="mm-btn-ghost sm" data-lf-clear="${esc(f.key)}|${esc(f.level)}">解除</button>`:''}</span>
   </div>`;
  }).join('');
  list.innerHTML=`${summary}
   <div class="lf-table">
    <div class="lf-row lf-row-head"><span>因子</span><span>水準</span><span>係数</span><span>N</span><span>手動上書き</span><span></span></div>
    ${baseRow}
    ${factorRows||'<div class="mm-empty">この設備には因子(水準)がありません。</div>'}
   </div>`;
  list.querySelectorAll('[data-lf-save]').forEach(btn=>btn.onclick=()=>saveLoadFactorOverride(btn.dataset.lfSave,false));
  list.querySelectorAll('[data-lf-clear]').forEach(btn=>btn.onclick=()=>saveLoadFactorOverride(btn.dataset.lfClear,true));
 }
 async function saveLoadFactorOverride(key,clear){
  const uid=requireMaintUser();if(uid===null)return;
  const [factor,level]=key.split('|');
  let coefficient=null;
  if(!clear){
   const input=document.querySelector(`[data-lf-factor="${CSS.escape(factor)}"][data-lf-level="${CSS.escape(level)}"]`);
   const raw=input?String(input.value).trim():'';
   if(!raw){showToast&&showToast('係数(またはBASEは分)を入力してください','',3200);return}
   coefficient=Number(raw);
   if(!Number.isFinite(coefficient)){showToast&&showToast('数値を入力してください','',3200);return}
  }
  try{
   setMaintLoading(true,clear?'解除しています…':'保存しています…');
   await api('/api/schedule/load-factors/override',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({equipment:loadFactorState.equipment,factor,level,coefficient,user_id:uid})});
   await loadLoadFactorMaint(true);
   showToast&&showToast(clear?'上書きを解除しました':'上書きを保存しました','',3200);
  }catch(e){showToast&&showToast('保存できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }
 /* ---------- データ引継ぎ（PC引継ぎ等でrecords.sqlite3からIndexedDBへ取り込む） ----------
    通常はIndexedDB→records.sqlite3の一方通行だが、PC更新等でIndexedDBが
    空の端末に対しては逆方向の取り込みが必要になる。対象のペイロードは
    codec='json-full-v32'（現行の完全JSONスナップショット）のみをサポートし、
    それ以外(旧形式等)は安全側に倒して「非対応」として選択不可にする。
    既存IDと衝突する場合は上書きになるため、選択状態を可視化した上で
    確認ダイアログを挟んでから実行する。 ---------- */
 let importBackupState={items:[],loaded:false,localIds:new Set()};
 async function loadImportBackupMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&importBackupState.loaded){renderImportBackupForm();renderImportBackupList();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">records.sqlite3を読み込んでいます…</div>';
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
    <span>records.sqlite3（Web測定バックアップ）の内容を、この端末のローカルデータへ取り込みます。同じIDの既存データは上書きされ、元に戻せません。PC更新・端末交換時の引継ぎなど、特別な場合以外は実行しないでください。</span>
   </div>
   <div class="mm-cd-toolbar">
    <span class="mm-form-hint">records.sqlite3: ${esc(String(items.length))}件（うち取込可能 ${esc(String(supported.length))}件）</span>
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
  if(!items.length){list.innerHTML='<div class="mm-empty">records.sqlite3に取込可能なバックアップがありません。</div>';return}
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
 /* ---------- パス設定（仕掛/品質データの読み込み先・共有パス・各種間隔。旧config/local.json） ----------
    複数の値を持つ一覧ではなく1組の設定値のため、列表示マスタと同じ「特別扱い」
    にする。sikalot_source/sikalotnow_path/sikalotdef_path/records_backup_export_path/
    schedule_share_pathはサーバー起動時に1回だけ接続先へ反映されるため、保存後も
    このプロセスでは反映されない(再起動が必要)。一覧欄には「保存値」と「現在
    有効な値(このプロセス)」を並べて表示し、反映済みかを確認できるようにする。 ---------- */
 let pathConfigState={values:{},defaults:{},active:{},loaded:false};
 const PATH_CONFIG_RESTART_FIELDS=[
  ['sikalot_source','仕掛/品質データの取得元'],
  ['sikalotnow_path','仕掛(SIKALOTNOW)の読み込み先'],
  ['sikalotdef_path','品質データ(SIKALOTDEF)の読み込み先'],
  ['records_backup_export_path','測定データバックアップの複製先'],
  ['schedule_share_path','スケジュール共有パス(schedule.sqlite3)'],
 ];
 async function loadPathConfigMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&pathConfigState.loaded){renderPathConfigForm();renderPathConfigList();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const r=await api('/api/path-config-master');
   pathConfigState.values=r.values||{};pathConfigState.defaults=r.defaults||{};pathConfigState.active=r.active||{};
   pathConfigState.loaded=true;
   renderPathConfigForm();renderPathConfigList();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 function renderPathConfigForm(){
  const form=$('#masterMaintForm');if(!form)return;
  const v=pathConfigState.values||{};
  const sourceOpts=[['','（既定）network'],['network','network'],['local','local']]
   .map(([val,label])=>`<option value="${esc(val)}"${(v.sikalot_source||'')===val?' selected':''}>${esc(label)}</option>`).join('');
  const textField=(key,label)=>`<label class="mm-field mm-field-wide"><span>${esc(label)}</span><input data-pc-field="${key}" type="text" value="${esc(v[key]||'')}" placeholder="未設定（既定値を使用）" autocomplete="off"></label>`;
  const numField=(key,label)=>`<label class="mm-field"><span>${esc(label)}</span><input data-pc-field="${key}" type="number" value="${esc(v[key]||'')}" placeholder="${esc(pathConfigState.defaults[key]||'')}" autocomplete="off"></label>`;
  form.innerHTML=`<div class="mm-form-head"><span class="mm-mode-chip new">パス設定</span></div>
   <p class="mm-def-hint">仕掛/品質データの読み込み先・共有パスなど、端末ごとに変わり得る設定です。空欄で保存すると既定値に戻ります。<b>取得元・読み込み先・複製先・共有パスの変更はサーバー再起動後に反映されます</b>（下の一覧で保存値と現在有効な値を見比べられます）。抽出間隔・ロック関連は再起動不要で次回から反映されます。</p>
   <div class="mm-form-fields">
    <label class="mm-field"><span>仕掛/品質データの取得元</span><select data-pc-field="sikalot_source">${sourceOpts}</select></label>
    ${textField('sikalotnow_path','仕掛(SIKALOTNOW)の読み込み先（個別上書き）')}
    ${textField('sikalotdef_path','品質データ(SIKALOTDEF)の読み込み先（個別上書き）')}
    ${textField('records_backup_export_path','測定データバックアップの閲覧用複製先')}
    ${textField('schedule_share_path','スケジュール機能の共有データ置き場（schedule.sqlite3）')}
    ${numField('rne_extract_interval_sec','RNE抽出間隔（秒・60以上）')}
    ${numField('schedule_lock_ttl_sec','スケジュール書込ロックの有効期限（秒）')}
    ${numField('schedule_lock_verify_delay_ms','ロック確認までの待機時間（ミリ秒）')}
   </div>
   <div class="mm-form-tail"><button type="submit" class="mm-btn-primary">パス設定を保存</button><span class="mm-form-hint">更新者IDは画面右上の入力欄を使用します。</span></div>`;
  form.onsubmit=ev=>{ev.preventDefault();savePathConfigMaint()};
 }
 function renderPathConfigList(){
  const list=$('#masterMaintList');if(!list)return;
  const v=pathConfigState.values||{},a=pathConfigState.active||{};
  const activeText={
   sikalot_source:a.sikalot_source||'',
   sikalotnow_path:`${a.sikalotnow_path||''}${a.sikalotnow_engine?`（${a.sikalotnow_engine}）`:''}`,
   sikalotdef_path:`${a.sikalotdef_path||''}${a.sikalotdef_engine?`（${a.sikalotdef_engine}）`:''}`,
   records_backup_export_path:a.records_backup_export_path||'（未設定・複製しない）',
   schedule_share_path:a.schedule_share_path||'（未設定・機能無効）',
  };
  const savedText={
   sikalot_source:v.sikalot_source||'（既定）network',
   sikalotnow_path:v.sikalotnow_path||'（既定値を使用）',
   sikalotdef_path:v.sikalotdef_path||'（既定値を使用）',
   records_backup_export_path:v.records_backup_export_path||'（未設定・複製しない）',
   schedule_share_path:v.schedule_share_path||'（未設定・機能無効）',
  };
  const tmpl='minmax(150px,1fr) minmax(200px,1.6fr) minmax(200px,1.6fr)';
  const head=`<div class="mm-row head" style="grid-template-columns:${tmpl}"><span>設定項目</span><span>保存値（次回起動から反映）</span><span>現在有効な値（このプロセス）</span></div>`;
  const rows=PATH_CONFIG_RESTART_FIELDS.map(([key,label])=>`<div class="mm-row" style="grid-template-columns:${tmpl}"><span>${esc(label)}</span><span title="${esc(savedText[key])}">${esc(savedText[key])}</span><span title="${esc(activeText[key])}">${esc(activeText[key])}</span></div>`).join('');
  list.innerHTML=head+rows+`<p class="mm-def-hint" style="margin-top:10px">RNE抽出間隔: 保存値 ${esc(v.rne_extract_interval_sec||pathConfigState.defaults.rne_extract_interval_sec||'')}秒 / スケジュールロック有効期限: ${esc(v.schedule_lock_ttl_sec||pathConfigState.defaults.schedule_lock_ttl_sec||'')}秒 / ロック確認待機: ${esc(v.schedule_lock_verify_delay_ms||pathConfigState.defaults.schedule_lock_verify_delay_ms||'')}ミリ秒（いずれも再起動不要で次回から反映）</p>`;
 }
 async function savePathConfigMaint(){
  const uid=requireMaintUser();if(uid===null)return;
  const body={user_id:uid};
  document.querySelectorAll('#masterMaintForm [data-pc-field]').forEach(el=>{body[el.dataset.pcField]=el.value});
  try{
   setMaintLoading(true,'パス設定を保存しています…');
   const r=await api('/api/path-config-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   pathConfigState.loaded=false;await loadPathConfigMaint(true);
   showToast&&showToast('パス設定を保存しました',(r&&r.message)||'',5200);
  }catch(e){showToast&&showToast('保存できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }

 /* ---------- テーブル生データ(旧「マスタ一覧」、ARCHITECTURE.md「マスタ管理の画面形態」で統合) ----------
    master.sqlite3のテーブルをそのまま読み取り専用で表示する。上のタブが
    面倒を見ていないテーブル(表示マスタ・スケジュール列表示マスタ・
    パス設定マスタの実体など)も確認できる、最後の手段としての生データ閲覧。
    編集は各専用タブから行う前提のため、ここでは書込導線を一切出さない。 */
 let rawTableState={tables:[],table:'',columns:[],rows:[],loaded:false};
 async function loadRawTableMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.classList.remove('mm-form-compact');
  if(force||!rawTableState.loaded){
   form.innerHTML='<div class="mm-form-head"><span class="mm-mode-chip new">読み込み中</span></div>';
   list.innerHTML='<div class="mm-empty">テーブル一覧を取得しています…</div>';
   try{
    const r=await api('/api/tables?db=MASTER');
    rawTableState.tables=r.tables||[];rawTableState.loaded=true;
    if(!rawTableState.tables.includes(rawTableState.table))rawTableState.table=rawTableState.tables[0]||'';
   }catch(e){
    form.innerHTML='';
    list.innerHTML=`<div class="mm-empty error">テーブル一覧を取得できませんでした: ${esc(e.message)}</div>`;
    return;
   }
  }
  renderRawTableForm();
  await loadRawTableRows();
 }
 function renderRawTableForm(){
  const form=$('#masterMaintForm');if(!form)return;
  if(!rawTableState.tables.length){form.innerHTML='<div class="mm-form-head"><span class="mm-mode-chip new">テーブルがありません</span></div>';return}
  const opts=rawTableState.tables.map(t=>`<option value="${esc(t)}"${t===rawTableState.table?' selected':''}>${esc(t)}</option>`).join('');
  form.innerHTML=`<div class="mm-form-head">
    <label class="mm-field mm-field-inline"><span>テーブル</span><select id="rawTableSelect">${opts}</select></label>
    <button type="button" id="rawTableReload" class="mm-btn-ghost sm">再読込</button>
    <span class="mm-form-hint">読み取り専用です。編集は左の各マスタタブから行ってください。</span>
   </div>
   <p class="mm-def-hint">マスタDB(master.sqlite3)のテーブルをそのまま表示します。専用タブが用意されていないテーブルの中身を確認したいときに使います。先頭200件まで表示します。</p>`;
  form.onsubmit=ev=>ev.preventDefault();
  const sel=$('#rawTableSelect');if(sel)sel.onchange=()=>{rawTableState.table=sel.value;loadRawTableRows()};
  const rb=$('#rawTableReload');if(rb)rb.onclick=()=>loadRawTableRows();
 }
 async function loadRawTableRows(){
  const list=$('#masterMaintList');if(!list)return;
  if(!rawTableState.table){list.innerHTML='<div class="mm-empty">テーブルを選択してください。</div>';return}
  list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const q=new URLSearchParams({db:'MASTER',table:rawTableState.table,page:1,page_size:200,include_hidden:1});
   const d=await api('/api/table?'+q);
   rawTableState.columns=d.columns||[];rawTableState.rows=d.rows||[];
   renderRawTableList(d.count);
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 function renderRawTableList(count){
  const list=$('#masterMaintList');if(!list)return;
  const cols=rawTableState.columns,rows=rawTableState.rows;
  if(!cols.length){list.innerHTML='<div class="mm-empty">列がありません。</div>';return}
  const head=cols.map(c=>`<th>${esc(c)}</th>`).join('');
  const body=rows.map(r=>`<tr>${cols.map(c=>{const v=r[c];return `<td title="${esc(v??'')}">${esc(v??'')||'<em class="mm-blank">—</em>'}</td>`}).join('')}</tr>`).join('');
  list.innerHTML=`<div class="mm-raw-meta">${esc(rawTableState.table)} — ${rows.length}件を表示${(count!=null&&count>rows.length)?` (全${count}件)`:''}</div>
   <div class="mm-raw-scroll"><table class="mm-raw-table"><thead><tr>${head}</tr></thead><tbody>${body||`<tr><td colspan="${cols.length}">データがありません。</td></tr>`}</tbody></table></div>`;
 }

 function openMasterMaint(){
  // 他のメイン画面統合ビューを閉じる(schedule-view.jsのopenScheduleView等と
  // 同じ「個別に他ビューを閉じる」方式に合わせる)。
  window.exitScheduleView?.();
  window.exitCalendarView?.();
  document.body.classList.remove('qa-mode','qa-view-raw');
  document.getElementById('reportPanel')?.setAttribute('hidden','');document.body.classList.remove('rp-mode');
  document.getElementById('dashboardPanel')?.setAttribute('hidden','');document.body.classList.remove('db-mode');
  document.getElementById('recordModal')?.setAttribute('hidden','');
  document.getElementById('measureModal')?.setAttribute('hidden','');
  document.querySelectorAll('#nav button.db,#analysisNav button.db,#planNav button.db').forEach(b=>b.classList.remove('active'));

  const panel=ensureMaintPanel();
  document.body.classList.add('mm-mode');
  document.getElementById('openMasterMaint')?.classList.add('active');
  renderMaintNav();
  const uid=$('#masterUserId');if(uid)uid.value=currentUserId();
  if(!maintDefVisible(currentDef()))maintState.defKey=firstVisibleDefKey();
  maintState.editing=null;maintState.query='';
  const se=$('#masterMaintSearch');if(se)se.value='';
  syncNav();panel.hidden=false;loadMaint(true);
  requestAnimationFrame(()=>{const u=$('#masterUserId');if(u&&!u.value){u.focus();return}const s=$('#masterMaintSearch');if(s)s.focus()});
 }
 window.openMasterMaint=openMasterMaint;

 // #openMasterMaintのクリックはここ(document委譲・capture)一箇所のみで処理する。
 // 以前はbindMasterMaint()でボタン自身にもonclickを付けていたが、この
 // capture段リスナーがstopImmediatePropagation()で先に処理を完結させるため
 // ボタン側のonclickは常に発火しない到達不能コードだった(削除済み)。
 document.addEventListener('click',e=>{const t=e.target.closest('#openMasterMaint');if(!t)return;e.preventDefault();e.stopImmediatePropagation();openMasterMaint()},true);
 /* マスタ管理以外のサイドバー項目を押したらマスタ管理画面から出る。
    メイン画面統合型のビュー(帳票・スケジュール等)はそれぞれが「開くときに
    他を閉じる」方式だが、それらはmeasurement-worklog.jsより後に読み込まれる
    ため、こちらから相手の関数をラップできない(読み込み順序、
    docs/ARCHITECTURE.md)。サイドバーのクリックはすべてこの1箇所で拾えるので、
    入口側で閉じる方式にして相互参照を増やさない。 */
 document.addEventListener('click',e=>{
  if(!document.body.classList.contains('mm-mode'))return;
  const btn=e.target.closest('.layout>aside button');
  if(!btn||btn.closest('#openMasterMaint'))return;
  exitMasterMaint();
 },true);
 // 一覧(DB)切替でも閉じる(report-dashboard.jsのexitReportViewと同じ考え方)。
 if(typeof selectDb==='function'){const base=selectDb;selectDb=async function(k,b){exitMasterMaint();return base(k,b)}}
 document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  // 編集モーダルが開いていればそちらだけ閉じる(画面自体は開いたまま)。
  if($('#maintEditorModal')&&!$('#maintEditorModal').hidden){closeMaintEditor();return}
 },true);
})();



