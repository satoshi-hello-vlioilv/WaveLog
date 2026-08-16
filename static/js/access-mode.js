"use strict";
/* access-mode.js: 編集可能モード/閲覧モード/スケジュールモードの表示・切替・入口ガード。

複数の設備でこのアプリをローカル運用しており、通常は測定データの書き込みが
1台に閉じている想定(config/local.jsonのrecords_backup_export_pathで、その
1台がBox等へ複製した測定データを他端末が閲覧するだけ、という運用)。

サーバー側(backend/access_mode.py)がログインID+PC名でアクセス権限マスタを
照合し、起動時の初期モードと書込系APIの可否を判定・強制する。ここでは
その状態を取得してUIへ反映し、新規測定の開始・再開など「書込みへ進む入口」
をフロント側でも先回りしてブロックする(サーバー側の403だけに頼ると、
モーダルを開いてから入力後に弾かれるなど手戻りが大きいため)。

スケジュールモード(docs/SCHEDULE_MODE_DESIGN.md §3.1)は閲覧モードの上位互換
ではなく、測定データ・マスタへの書込は閲覧モードと同じく禁止。作業予定という
別ドメインの書込だけが開く。フロント側の入口ガードは「edit以外なら止める」で
統一し、view/scheduleのどちらでも新規測定の開始・再開・データ書込を塞ぐ。

view・schedule端末はどちらもこの端末で測定データを書き込まない前提のため、
データ一覧はこの端末のIndexedDBではなく閲覧用バックアップ
(records_backup_export_path、Box等)から読む。report-dashboard.jsの
openReportView()がwindow.loadViewModeRecordsを呼ぶ(コア/拡張ファイル側の
1箇所を直接編集する形で連携。詳細はreport-dashboard.js側のコメント参照)。 */
(function(){
 if(typeof $!=='function')return;

 const MODE_LABELS={edit:'編集モード',view:'閲覧モード',schedule:'スケジュールモード'};
 const MODE_DESC={edit:'測定データ・マスタを書き込めます',view:'すべて読み取り専用です',schedule:'作業予定を書き込めます(測定データ・マスタは読み取り専用)'};

 let accessMode={mode:'edit',canEdit:true,canSchedule:false,canFieldReorder:false,fieldReorderEquipment:'',loginId:'',pcName:''};
 window.accessMode=accessMode;

 /* 現場段取り対象設備の書式(空/'*'/カンマ区切り)を解く。
    **backend/repositories/master_repo.py の field_reorder_equipment_* と
    同じ規則**にすること。画面が「並べ替え可」と出したのにAPIが403を返す、
    という食い違いはここがずれると必ず起きる。 */
 const EQUIPMENT_ALL='*';
 function fieldReorderTargets(stored){
  const s=String(stored||'').trim();
  if(!s)return [];
  if(s===EQUIPMENT_ALL)return [EQUIPMENT_ALL];
  return s.replace(/、/g,',').split(',').map(x=>x.trim()).filter(Boolean);
 }
 function fieldReorderAllowsAll(stored){return fieldReorderTargets(stored)[0]===EQUIPMENT_ALL}
 function fieldReorderAllows(stored,equipment){
  const list=fieldReorderTargets(stored);
  if(!list.length)return false;
  if(list[0]===EQUIPMENT_ALL)return true;
  const t=String(equipment||'').trim().toUpperCase();
  return !!t&&list.some(x=>x.trim().toUpperCase()===t);
 }
 function fieldReorderLabel(stored){
  const list=fieldReorderTargets(stored);
  if(!list.length)return '';
  return list[0]===EQUIPMENT_ALL?'すべての設備':list.join(' / ');
 }
 window.WL=window.WL||{};
 Object.assign(window.WL,{fieldReorderAllows,fieldReorderAllowsAll,fieldReorderLabel});

 async function refreshAccessMode(){
  try{
   const r=await api('/api/access-mode');
   accessMode.mode=r.mode||'edit';accessMode.canEdit=!!r.canEdit;accessMode.canSchedule=!!r.canSchedule;
   accessMode.canFieldReorder=!!r.canFieldReorder;accessMode.fieldReorderEquipment=r.fieldReorderEquipment||'';
   accessMode.loginId=r.loginId||'';accessMode.pcName=r.pcName||'';
  }catch(e){
   // 判定できない場合は既存動作(編集可能)を維持する(安全側・互換ポリシー)。
   accessMode.mode='edit';accessMode.canEdit=true;accessMode.canSchedule=false;accessMode.canFieldReorder=false;accessMode.fieldReorderEquipment='';
  }
  applyAccessModeUI();
  return accessMode;
 }
 window.refreshAccessMode=refreshAccessMode;

 function allowedModes(){
  // edit → view → schedule の順で提示する。バッジのクリック先(ポップオーバー)
  // に並べる順序でもある。
  const modes=[];
  if(accessMode.canEdit)modes.push('edit');
  modes.push('view');
  if(accessMode.canSchedule)modes.push('schedule');
  return modes;
 }

 function applyAccessModeUI(){
  const mode=accessMode.mode;
  document.body.classList.toggle('view-mode',mode==='view');
  document.body.classList.toggle('schedule-mode',mode==='schedule');
  const badge=$('#accessModeBadge');
  if(badge){
   badge.hidden=false;
   badge.classList.toggle('is-view',mode==='view');
   badge.classList.toggle('is-schedule',mode==='schedule');
   const canSwitch=allowedModes().length>1;
   badge.disabled=!canSwitch;
   badge.title=`${MODE_LABELS[mode]||mode}です(${accessMode.loginId||'?'}@${accessMode.pcName||'?'})。${canSwitch?'クリックでモードを切り替えられます。':'この端末には他のモードへ切り替える権限がありません。'}`;
   const label=$('#accessModeLabel');if(label)label.textContent=MODE_LABELS[mode]||mode;
   // モードは状態そのものが意味を持つので、色でも区別する(§9.48)
   const chip=$('#accessModeBadge');
   if(chip){chip.classList.toggle('is-view',mode==='view');chip.classList.toggle('is-schedule',mode==='schedule')}
  }
  // 現場段取り(§3.1.1): editモードでcanFieldReorderが真の端末にだけ表示する
  // 小さなバッジ。モードそのものを増やしたわけではないことを示す表示上の工夫。
  const fieldBadge=$('#fieldReorderBadge');
  if(fieldBadge){
   fieldBadge.hidden=!(mode==='edit'&&accessMode.canFieldReorder);
   // §9.44: 「並べ替え可」は対象設備が決まっていて初めて実際に使える権限。
   // 対象設備が未設定/この端末の使用設備と違う場合に「可」とだけ出すと、
   // 動かした瞬間に403で弾かれて食い違う。バッジ自体で状態を言い分ける。
   const stored=accessMode.fieldReorderEquipment;
   const label=fieldReorderLabel(stored);
   const own=typeof currentConfiguredEquipment==='function'?currentConfiguredEquipment():'';
   // 使用設備が未設定のうちは、対象設備が入っていれば「可」と出す(照合できないため)。
   const usable=!!label&&(!own||fieldReorderAllows(stored,own));
   fieldBadge.classList.toggle('is-warn',!usable);
   const val=fieldBadge.querySelector('.hd-chip-val');
   if(val)val.textContent=usable?'並べ替え可':'設定要';
   else fieldBadge.textContent=usable?'並べ替え可':'設定要';
   fieldBadge.title=usable
    ?`現場段取り: ${label} の未着手の予定を並べ替えられます`
    :(label?`現場段取りの対象設備は「${label}」です(この端末の使用設備: ${own||'未設定'})`
            :'現場段取りの対象設備が未設定です。マスタ管理 > アクセス権限マスタで設定してください');
  }
 }

 function closeAccessModeMenu(){
  const existing=document.querySelector('.access-mode-menu');
  if(existing)existing.remove();
  document.removeEventListener('click',onOutsideMenuClick,true);
 }
 function onOutsideMenuClick(e){
  const menu=document.querySelector('.access-mode-menu');
  if(menu&&!menu.contains(e.target)&&!e.target.closest('#accessModeBadge'))closeAccessModeMenu();
 }

 async function switchAccessMode(nextMode){
  if(nextMode===accessMode.mode)return;
  if(accessMode.mode==='edit'&&!confirm(`${MODE_LABELS[nextMode]||nextMode}へ切り替えますか？新しい測定の開始・登録内容の編集ができなくなります。`))return;
  try{
   const r=await api('/api/access-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:nextMode})});
   accessMode.mode=r.mode;
   applyAccessModeUI();
   showToast&&showToast(`${MODE_LABELS[accessMode.mode]||accessMode.mode}に切り替えました`,'',3200);
   if($('#recordModal')&&!$('#recordModal').hidden)openRecords(null);
   await refreshOpenViewsForMode();
  }catch(e){showToast&&showToast('切り替えに失敗しました',e.message,5000)}
 }
 /* モードで見た目・権限が変わる画面を開いたままモードを切り替えた場合、
    その場で開き直して即座に反映する。以前はモードバッジと入口ガードだけを
    更新していたため、例えば作業スケジュール画面を開いたままスケジュール
    モードへ切り替えても、その画面はeditモードで組み立てたまま
    (scState.fullControl=false、追加・削除・分割表示なし)で据え置かれ、
    一度別の画面へ移動して戻らないと反映されなかった。 */
 async function refreshOpenViewsForMode(){
  try{
   if(document.body.classList.contains('sc-mode')&&typeof window.openScheduleView==='function')await window.openScheduleView();
   // マスタ管理(ARCHITECTURE.md「マスタ管理の画面形態」でメイン画面統合型に変更)もモードで出せるタブが変わる。
   else if(document.body.classList.contains('mm-mode')&&typeof window.openMasterMaint==='function')window.openMasterMaint();
  }catch(e){console.warn('モード切替後の画面更新に失敗しました',e)}
 }

 /* モードバッジはクリックで巡回ではなく、権限のあるモードを並べた小さな
    ポップオーバーから選ばせる(3値になった時点で「クリックでトグル」は
    意味が取れなくなるため、§3.5)。 */
 function openAccessModeMenu(anchor){
  closeAccessModeMenu();
  const modes=allowedModes();
  if(modes.length<=1)return;
  const menu=document.createElement('div');
  menu.className='access-mode-menu';
  modes.forEach(m=>{
   const btn=document.createElement('button');
   btn.type='button';
   if(m===accessMode.mode)btn.classList.add('is-current');
   btn.innerHTML=`<span>${esc(MODE_LABELS[m]||m)}</span><small>${esc(MODE_DESC[m]||'')}</small>`;
   btn.addEventListener('click',()=>{closeAccessModeMenu();switchAccessMode(m)});
   menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  const rect=anchor.getBoundingClientRect();
  menu.style.top=`${rect.bottom+6}px`;
  menu.style.left=`${Math.max(8,rect.right-menu.offsetWidth)}px`;
  requestAnimationFrame(()=>document.addEventListener('click',onOutsideMenuClick,true));
 }
 document.addEventListener('click',e=>{const t=e.target.closest('#accessModeBadge');if(!t||t.disabled)return;openAccessModeMenu(t)});

 /* ---------- 新規測定の開始・再開をブロックする ----------
    openMeasurement()は仕掛一覧からの新規開始と既存下書きの再開の両方を
    兼ねる単一入口のため、ここを止めればほぼすべての編集経路を塞げる。
    データ一覧からの「続きから再開」(resumeRecordFromList)だけは別経路
    のため個別にブロックする。measurement/mastersへの書込はeditモードだけ
    許可されるため、判定は「editでなければ止める」に統一する(view/schedule
    のどちらでも同じく書込不可。§3.5、実装時の主要な事故ポイント)。 */
 if(typeof openMeasurement==='function'){
  const baseOpenMeasurement=openMeasurement;
  openMeasurement=async function(row){
   if(accessMode.mode!=='edit'){showToast&&showToast(`${MODE_LABELS[accessMode.mode]||accessMode.mode}です`,'新しい測定を開始・再開するには編集モードへ切り替えてください。',5000);return}
   return baseOpenMeasurement(row);
  };
 }
 if(typeof resumeRecordFromList==='function'){
  const baseResumeRecordFromList=resumeRecordFromList;
  resumeRecordFromList=function(x){
   return async()=>{
    if(accessMode.mode!=='edit'){showToast&&showToast(`${MODE_LABELS[accessMode.mode]||accessMode.mode}です`,'編集を再開するには編集モードへ切り替えてください。',5000);return}
    return baseResumeRecordFromList(x)();
   };
  };
 }

 /* ---------- edit以外のデータ一覧: 閲覧用バックアップから読む ----------
    recordListState/openRecords/renderRecordListRowsはrecords-store.jsの
    トップレベル変数・関数(IIFE無し)のため、ここから直接参照できる。 */
 async function loadViewModeRecords(){
  const r=await api('/api/measurement/backup/list-view');
  if(!r.configured){
   // 呼び出し側が「未設定」と「読めなかった」を言い分けられるように印を付ける
   // (文言での判定は文言を直すたびに壊れる)。
   const err=Error('閲覧用データの出力先（マスタ管理 > パス設定の records_backup_export_path）が未設定です。');
   err.code='unconfigured';
   throw err;
  }
  return (r.items||[]).map(it=>{
   try{const rec=ensureMeasureShape(JSON.parse(it.payload));rec.id=it.id;return rec}
   catch(e){return null}
  }).filter(Boolean);
 }
 window.loadViewModeRecords=loadViewModeRecords;

 /* ---------- 「データが無い」と「このモードでは見せられない」を言い分ける ----------
    §9.107。edit以外のモードでは、この端末のIndexedDBにある編集中データを
    開かない(書き込まない端末なので、共有された閲覧用データだけを見る)。
    ところが一覧は0件のとき「表示できるデータがありません」とだけ出していた
    ため、**手元にデータがあるのに消えたように見えた**(スケジュールモードで
    実機から報告)。事実は「無い」ではなく「このモードでは開けない」なので、
    端末内の件数を数えて、そう書く。 */
 async function localRecordCounts(){
  try{
   const all=await reliableAll();
   let editing=0,done=0;
   // 状態の分け方は一覧の絞り込み(recordMatchesStatusFilter)と同じ
   // ——「完了」だけが完了で、測定値NG等は編集中の側に入る。
   all.forEach(x=>{if(String(x.status||'')==='完了')done++;else editing++});
   return {editing,done,total:all.length};
  }catch(e){console.warn('端末内データの件数を数えられませんでした',e);return {editing:0,done:0,total:0}}
 }
 const modeName=()=>MODE_LABELS[accessMode.mode]||accessMode.mode;
 function localCountText(c){
  const parts=[];
  if(c.editing)parts.push(`編集中 ${c.editing}件`);
  if(c.done)parts.push(`完了 ${c.done}件`);
  return parts.join('・');
 }
 /* 切り替えの導線。**編集権限が無い端末ではボタンを出さない**——押しても
    変わらないボタンほど分かりにくいものはないので、代わりに「誰の権限が
    足りないか」を書く(アクセス権限マスタはログインID+PC名で引く)。 */
 function switchHintHtml(){
  return accessMode.canEdit
   ? '<button type="button" class="record-mode-switch">編集モードへ切り替えて表示する</button>'
   : `<p class="record-mode-denied">この端末（${esc(accessMode.loginId||'?')} @ ${esc(accessMode.pcName||'?')}）には編集権限がありません。表示するにはマスタ管理 &gt; アクセス権限マスタで編集可否を許可してください。</p>`;
 }
 function viewModeNoticeHtml(counts){
  const has=localCountText(counts);
  return `<div class="record-mode-notice"><div class="rmn-head"><span class="rmn-mode">${esc(modeName())}</span>`
   +`<b>この一覧に出るのは「共有された閲覧用データ」だけです</b></div>`
   +`<p class="rmn-body">${esc(modeName())}は測定データを読み取り専用で扱うため、<b>この端末に保存された編集中データはここに出ません。</b>`
   +(has?`（この端末には ${esc(has)} が保存されています。<b>データが無いのではなく、このモードでは開けません。</b>）`:'')
   +`</p><div class="rmn-actions">${switchHintHtml()}</div></div>`;
 }
 /* 0件のときの本文。理由は3つあり、どれなのかで打つ手が違う。
      unconfigured … 共有の置き場が未設定(設定の話)
      error        … 置き場はあるが読めなかった(接続・共有の話)
      ''           … 読めたが該当が無い(本当に0件か、権限の話) */
 function viewModeEmptyHtml(counts,reason,message){
  const has=localCountText(counts);
  const why=reason==='unconfigured'
   ?`<p class="record-empty-why">共有された閲覧用データの置き場が未設定のため、${esc(modeName())}で読めるものがありません。（${esc(message||'')}）</p>`
   :reason==='error'
   ?`<p class="record-empty-why">共有された閲覧用データを読めませんでした。（${esc(message||'')}）</p>`
   :`<p class="record-empty-why">共有された閲覧用データには、この条件に合うものがありませんでした。</p>`;
  const head=has
   ?'<b>この端末のデータは、このモードでは表示できません。</b>'
   :'<b>表示できるデータがありません。</b>';
  const mine=has
   ?`<p class="record-empty-why">この端末に保存されている ${esc(has)} は、${esc(modeName())}の権限では開けません（上の案内を参照）。<b>データが無いのではなく、権限の範囲外です。</b></p>`
   :'';
  // 切り替えボタンは上の帯が1つだけ持つ。同じボタンを2つ出さない。
  return `<div class="record-empty">${head}${why}${mine}</div>`;
 }
 /* ボタンは一覧を描き直すたびに作り直される(絞り込み・並べ替えのたび)ので、
    その都度つなぐのではなく委譲で1本だけ持つ。 */
 document.addEventListener('click',e=>{
  const btn=e.target.closest('.record-mode-switch');
  if(!btn)return;
  e.preventDefault();e.stopPropagation();
  switchAccessMode('edit');
 });

 async function openRecordsViewMode(status){
  if(status==='編集中')recordListState.statuses={editing:true,done:false};
  else if(status==='履歴')recordListState.statuses={editing:false,done:true};
  else if(!recordListState.statuses)recordListState.statuses={editing:true,done:false};
  recordListState.query='';recordListState.sort='updated-desc';
  recordListState.sourceNote=`共有された閲覧用データ（${modeName()}は読み取り専用）`;
  /* 表示列の設定（§9.162）はこちらの経路でも効かせる。読めなくても
     既定の15列で一覧は出す。 */
  await Promise.all([
   WL.columnLayout.load(WL.recordColumns.target).catch(()=>{}),
   WL.displayRules.load().catch(()=>{}),
  ]);
  updateRecordListTitle();syncStatusFilterButtons();$('#recordModal').hidden=false;
  const list=$('#recordList');if(list)list.innerHTML='<div class="record-empty">閲覧データを読み込んでいます…</div>';
  const counts=await localRecordCounts();
  recordListState.notice=viewModeNoticeHtml(counts);
  let reason='',message='';
  try{
   recordListState.items=await loadViewModeRecords();
  }catch(e){
   recordListState.items=[];
   reason=e&&e.code==='unconfigured'?'unconfigured':'error';
   message=e&&e.message||String(e);
  }
  recordListState.emptyHtml=viewModeEmptyHtml(counts,reason,message);
  const search=$('#recordSearch'),sort=$('#recordSort'),clear=$('#clearRecordSearch');
  if(search){search.value='';search.oninput=()=>{recordListState.query=search.value;renderRecordListRows()}}
  if(sort){sort.value='updated-desc';sort.onchange=()=>{recordListState.sort=sort.value;renderRecordListRows()}}
  if(clear)clear.onclick=()=>{recordListState.query='';if(search)search.value='';renderRecordListRows()};
  WL.recordColumns.bind();
  renderRecordListRows();
  requestAnimationFrame(()=>search?.focus());
 }
 if(typeof openRecords==='function'){
  const baseOpenRecords=openRecords;
  openRecords=async function(status){
   if(accessMode.mode!=='edit')return openRecordsViewMode(status);
   return baseOpenRecords(status);
  };
 }

 /* 起動オーバーレイの「権限を確認」はここで済む(モードでヘッダーの
    バッジが増減するため、確定してから本体を見せる)。refreshAccessMode は
    失敗時も既定値で解決するが、念のため finally で必ず進める。 */
 queueMicrotask(()=>{refreshAccessMode().finally(()=>WL.boot.step('permission'))});
})();
