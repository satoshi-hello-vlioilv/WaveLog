"use strict";
/* access-mode.js: 編集可能モード/閲覧モードの表示・切替・入口ガード。

複数の設備でこのアプリをローカル運用しており、通常は測定データの書き込みが
1台に閉じている想定(config/local.jsonのrecords_backup_export_pathで、その
1台がBox等へ複製した測定データを他端末が閲覧するだけ、という運用)。

サーバー側(backend/access_mode.py)がログインID+PC名でアクセス権限マスタを
照合し、起動時の初期モードと書込系APIの可否を判定・強制する。ここでは
その状態を取得してUIへ反映し、新規測定の開始・再開など「書込みへ進む入口」
をフロント側でも先回りしてブロックする(サーバー側の403だけに頼ると、
モーダルを開いてから入力後に弾かれるなど手戻りが大きいため)。

閲覧モードのデータ一覧は、この端末のIndexedDBではなく閲覧用バックアップ
(records_backup_export_path、Box等)から読む。report-dashboard.jsの
openReportView()がwindow.loadViewModeRecordsを呼ぶ(コア/拡張ファイル側の
1箇所を直接編集する形で連携。詳細はreport-dashboard.js側のコメント参照)。 */
(function(){
 if(typeof $!=='function')return;

 let accessMode={mode:'edit',canEdit:true,loginId:'',pcName:''};
 window.accessMode=accessMode;

 async function refreshAccessMode(){
  try{
   const r=await api('/api/access-mode');
   accessMode.mode=r.mode||'edit';accessMode.canEdit=!!r.canEdit;accessMode.loginId=r.loginId||'';accessMode.pcName=r.pcName||'';
  }catch(e){
   // 判定できない場合は既存動作(編集可能)を維持する(安全側・互換ポリシー)。
   accessMode.mode='edit';accessMode.canEdit=true;
  }
  applyAccessModeUI();
  return accessMode;
 }
 window.refreshAccessMode=refreshAccessMode;

 function applyAccessModeUI(){
  const isView=accessMode.mode==='view';
  document.body.classList.toggle('view-mode',isView);
  const badge=$('#accessModeBadge');
  if(badge){
   badge.hidden=false;
   badge.classList.toggle('is-view',isView);
   badge.disabled=isView&&!accessMode.canEdit;
   badge.title=isView
    ?(accessMode.canEdit?`閲覧モードです(${accessMode.loginId||'?'}@${accessMode.pcName||'?'})。クリックで編集モードへ切り替えられます。`:`閲覧モードです(${accessMode.loginId||'?'}@${accessMode.pcName||'?'})。この端末には編集権限がありません。`)
    :`編集モードです(${accessMode.loginId||'?'}@${accessMode.pcName||'?'})。クリックで閲覧モードへ切り替えられます。`;
   const label=$('#accessModeLabel');if(label)label.textContent=isView?'閲覧モード':'編集モード';
  }
 }

 async function toggleAccessMode(){
  if(accessMode.mode==='edit'){
   if(!confirm('閲覧モードへ切り替えますか？新しい測定の開始・登録内容の編集ができなくなります。'))return;
  }else if(!accessMode.canEdit){
   showToast&&showToast('編集モードへ切り替えられません','この端末はアクセス権限マスタで閲覧のみに設定されています。',5000);
   return;
  }
  const nextMode=accessMode.mode==='edit'?'view':'edit';
  try{
   const r=await api('/api/access-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:nextMode})});
   accessMode.mode=r.mode;
   applyAccessModeUI();
   showToast&&showToast(accessMode.mode==='view'?'閲覧モードに切り替えました':'編集モードに切り替えました','',3200);
   if($('#recordModal')&&!$('#recordModal').hidden)openRecords(null);
  }catch(e){showToast&&showToast('切り替えに失敗しました',e.message,5000)}
 }
 document.addEventListener('click',e=>{const t=e.target.closest('#accessModeBadge');if(!t||t.disabled)return;toggleAccessMode()});

 /* ---------- 新規測定の開始・再開をブロックする ----------
    openMeasurement()は仕掛一覧からの新規開始と既存下書きの再開の両方を
    兼ねる単一入口のため、ここを止めればほぼすべての編集経路を塞げる。
    データ一覧からの「続きから再開」(resumeRecordFromList)だけは別経路
    のため個別にブロックする。 */
 if(typeof openMeasurement==='function'){
  const baseOpenMeasurement=openMeasurement;
  openMeasurement=async function(row){
   if(accessMode.mode==='view'){showToast&&showToast('閲覧モードです','新しい測定を開始・再開するには編集モードへ切り替えてください。',5000);return}
   return baseOpenMeasurement(row);
  };
 }
 if(typeof resumeRecordFromList==='function'){
  const baseResumeRecordFromList=resumeRecordFromList;
  resumeRecordFromList=function(x){
   return async()=>{
    if(accessMode.mode==='view'){showToast&&showToast('閲覧モードです','編集を再開するには編集モードへ切り替えてください。',5000);return}
    return baseResumeRecordFromList(x)();
   };
  };
 }

 /* ---------- 閲覧モードのデータ一覧: 閲覧用バックアップから読む ----------
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
   if(accessMode.mode==='view')return openRecordsViewMode(status);
   return baseOpenRecords(status);
  };
 }

 queueMicrotask(refreshAccessMode);
})();
