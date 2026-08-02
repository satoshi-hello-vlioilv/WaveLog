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
  }
  // 現場段取り(§3.1.1): editモードでcanFieldReorderが真の端末にだけ表示する
  // 小さなバッジ。モードそのものを増やしたわけではないことを示す表示上の工夫。
  const fieldBadge=$('#fieldReorderBadge');
  if(fieldBadge)fieldBadge.hidden=!(mode==='edit'&&accessMode.canFieldReorder);
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
  }catch(e){showToast&&showToast('切り替えに失敗しました',e.message,5000)}
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
  if(!r.configured)throw Error('閲覧用のバックアップ出力先が設定されていません。管理者にconfig/local.jsonのrecords_backup_export_pathの設定を確認してください。');
  return (r.items||[]).map(it=>{
   try{const rec=ensureMeasureShape(JSON.parse(it.payload));rec.id=it.id;return rec}
   catch(e){return null}
  }).filter(Boolean);
 }
 window.loadViewModeRecords=loadViewModeRecords;

 async function openRecordsViewMode(status){
  if(status==='編集中')recordListState.statuses={editing:true,done:false};
  else if(status==='履歴')recordListState.statuses={editing:false,done:true};
  else if(!recordListState.statuses)recordListState.statuses={editing:true,done:false};
  recordListState.query='';recordListState.sort='updated-desc';
  updateRecordListTitle();syncStatusFilterButtons();$('#recordModal').hidden=false;
  const list=$('#recordList');if(list)list.innerHTML='<div class="record-empty">閲覧データを読み込んでいます…</div>';
  try{
   recordListState.items=await loadViewModeRecords();
  }catch(e){
   if(list)list.innerHTML=`<div class="record-empty">${esc(e.message)}</div>`;
   recordListState.items=[];
   return;
  }
  const search=$('#recordSearch'),sort=$('#recordSort'),clear=$('#clearRecordSearch');
  if(search){search.value='';search.oninput=()=>{recordListState.query=search.value;renderRecordListRows()}}
  if(sort){sort.value='updated-desc';sort.onchange=()=>{recordListState.sort=sort.value;renderRecordListRows()}}
  if(clear)clear.onclick=()=>{recordListState.query='';if(search)search.value='';renderRecordListRows()};
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

 queueMicrotask(refreshAccessMode);
})();
