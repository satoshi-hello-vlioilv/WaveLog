"use strict";
/* records-store.js: 端末内保存(IndexedDB+localStorageミラー)・保存/完了遷移・
   編集中/完了データ一覧・参照データ(コンテキスト)取得・使用設備/設備マスタ設定。 */
const DB='MeasurementLocal',STORE='lots';function idb(){return new Promise((ok,no)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}async function idbGet(id){const d=await idb();return new Promise((o,n)=>{const r=d.transaction(STORE).objectStore(STORE).get(id);r.onsuccess=()=>o(r.result);r.onerror=()=>n(r.error)})}async function idbPut(v){const d=await idb();return new Promise((o,n)=>{const r=d.transaction(STORE,'readwrite').objectStore(STORE).put(v);r.onsuccess=()=>o();r.onerror=()=>n(r.error)})}async function idbDelete(id){const d=await idb();return new Promise((o,n)=>{const r=d.transaction(STORE,'readwrite').objectStore(STORE).delete(id);r.onsuccess=()=>o();r.onerror=()=>n(r.error)})}
async function showQuota(){if(navigator.storage?.estimate){const q=await navigator.storage.estimate();$('#quota').textContent=`IndexedDB使用 ${(q.usage/1048576).toFixed(1)}MB / 上限目安 ${(q.quota/1073741824).toFixed(1)}GB`}}
async function idbAll(){const d=await idb();return new Promise((o,n)=>{const r=d.transaction(STORE).objectStore(STORE).getAll();r.onsuccess=()=>o(r.result||[]);r.onerror=()=>n(r.error)})}
/* IndexedDB障害時もlocalStorageミラーで読み書きを継続する二重化層。 */
const MIRROR_KEY='MeasurementLocalMirrorV31';
function mirrorRead(){try{return JSON.parse(localStorage.getItem(MIRROR_KEY)||'{}')}catch(e){console.warn('mirror read failed',e);return {}}}
function mirrorWrite(record){const all=mirrorRead();all[record.id]=record;localStorage.setItem(MIRROR_KEY,JSON.stringify(all))}
function mirrorDelete(id){const all=mirrorRead();delete all[id];localStorage.setItem(MIRROR_KEY,JSON.stringify(all))}
async function reliableAll(){
 const merged=new Map(Object.entries(mirrorRead()));
 try{(await idbAll()).forEach(x=>merged.set(x.id,x))}catch(e){console.warn('IndexedDB list failed, mirror used',e)}
 return [...merged.values()].map(ensureMeasureShape);
}
async function reliableGet(id){
 try{const x=await idbGet(id);if(x)return ensureMeasureShape(x)}catch(e){console.warn('IndexedDB get failed, mirror used',e)}
 const x=mirrorRead()[id];return x?ensureMeasureShape(x):null;
}
async function reliablePut(record){
 let idbOK=false,mirrorOK=false;
 try{await idbPut(record);idbOK=true}catch(e){console.error('IndexedDB save failed',e)}
 try{mirrorWrite(record);mirrorOK=true}catch(e){console.error('mirror save failed',e)}
 if(!idbOK&&!mirrorOK)throw Error('端末内保存に失敗しました。ブラウザーの保存領域を確認してください。');
 return{idbOK,mirrorOK};
}
async function reliableDelete(id){try{await idbDelete(id)}catch(e){console.warn(e)}try{mirrorDelete(id)}catch(e){console.warn(e)}}
function applyContextSnapshot(x){
 const m=S.measure;if(!m||!x)return;
 optionFill('operator',x.operators,m.settings.operator);optionFill('inspector',x.inspectors||x.operators,m.settings.inspector);
 optionFill('thicknessGauge',x.thickness_gauges,m.settings.thicknessGauge);optionFill('widthGauge',x.width_gauges,m.settings.widthGauge);
 optionFill('innerDiameter',x.inner_diameters,m.settings.innerDiameter);optionFill('spool',x.spools,m.settings.spool);
 if(x.quality?.length){m.qualityInfo=qualityText(x.quality)}
 $('#qualityInfo').value=m.qualityInfo||'異常情報なし';if($('#motherQualityInfo'))$('#motherQualityInfo').value=$('#qualityInfo').value;
 $('#masterDiagnostic').textContent=JSON.stringify(x.diagnostics||{},null,2);
}
/* 仕掛・品質・マスタの参照データを取得し、スナップショットとして保存データへ
   同梱する(再開時はスナップショットを優先し、オフラインでも復元できる)。 */
async function loadMeasurementContext(force=false){
 updateWaiting('仕掛・品質・マスタを取得中','公差、品質等級、取引先、コース、マスタ候補を読み込んでいます');
 const m=S.measure;if(!m)return;
 if(m.snapshot?.context&&!force){applyContextSnapshot(m.snapshot.context);setState('保存済み参照データを復元');return m.snapshot.context}
 const u=new URLSearchParams({lot:m.basic.lotNo,equipment:currentConfiguredEquipment()||m.basic.equipment});
 try{
  setState('仕掛・品質・マスタ読込中');const x=await api('/api/measurement/context?'+u);
  m.snapshot=m.snapshot||{};m.snapshot.context=structuredClone(x);m.snapshot.source=structuredClone(m.source||{});m.snapshot.basic=structuredClone(m.basic||{});
  m.snapshot.loadedAt=new Date().toISOString();m.snapshot.schema='v32-full';
  applyContextSnapshot(x);setState(`初期参照データを格納済み / 品質情報 ${x.quality?.length||0}件`);return x;
 }catch(e){setState('参照データ読込エラー');$('#masterDiagnostic').textContent=e.stack||e.message;throw e}
}
function encodePayload(m){return JSON.stringify(m)}
function showSaveOverlay(title,detail){$('#saveOverlayTitle').textContent=title;$('#saveOverlayDetail').textContent=detail;$('#saveOverlay').hidden=false}
function hideSaveOverlay(){$('#saveOverlay').hidden=true;setWaitingStep(0)}
/* ステップ表示(1/2・2/2)。以前は「N/3」という文言を進捗テキストへ埋め込む
   だけだったため、各ステップの間に描画を挟む猶予(nextPaint)が無い呼び出し
   ではステップ2の表示が一瞬も画面に出ないまま次のステップへ上書きされ、
   実質「1番目と3番目しか見えない」状態になっていた。ステップ数は実際に
   目視できる2段階に整理し、進捗テキストとは独立したドット表示で示す
   (呼び出し側がstepを渡さない単発処理では非表示のまま)。 */
function setWaitingStep(step){
 const wrap=$('#waitingSteps');if(!wrap)return;
 if(!step){wrap.hidden=true;return}
 wrap.hidden=false;
 wrap.querySelectorAll('.waiting-step').forEach(el=>{const n=+el.dataset.step;el.classList.toggle('done',n<step);el.classList.toggle('active',n===step)});
}
async function backupRecord(m){
 // [設備]列には、ロットの設計設備(m.basic.equipment)ではなく、この端末に
 // 登録されている実際の使用設備(registeredEquipment)を記録する。
 // どの設備設定で測定・登録されたデータかを後から区別できるようにするため。
 const equipment=m.registeredEquipment||m.settings?.registeredEquipment||currentConfiguredEquipment()||m.basic.equipment;
 const x={id:m.id,equipment,lotNo:m.basic.lotNo,inspectionNo:m.basic.inspectionNo,castingNo:m.basic.castingNo,status:m.status,codec:'json-full-v32',payload:encodePayload(m)};
 return api('/api/measurement/backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(x)});
}
/* ---------- Access同期の未完了キューと再送 ----------
   backupRecord()の失敗はこれまでトースト(数秒で消える)にしか出ておらず、
   syncStateがどこにも保存されていなかったため、次に開いたときには成否が
   分からず、再送する手段も無かった(工場の共有フォルダが不安定だと、端末内
   には有るのにAccess側には無いデータが静かに溜まる)。
   backupRecord成功時はsyncState.status='synced'、失敗時は'failed'として
   端末へ保存し、データ一覧・サイドバーで未同期件数を可視化したうえで、
   まとめて再送できるようにする。 */
function markSyncResult(m,ok,error){
 const prevAttempts=m.syncState?.attempts||0;
 m.syncState={status:ok?'synced':'failed',lastAttempt:new Date().toISOString(),lastError:ok?'':String(error?.message||error||''),attempts:prevAttempts+1};
 return m.syncState;
}
/* backupRecordを呼び、結果をsyncStateへ反映して端末へ保存し直す
   (呼び出し元が既にreliablePut済みのmを渡す想定。ここでの再保存は
   syncStateだけが変わった差分を確実に永続化するため)。 */
async function backupAndTrackSync(m){
 try{await backupRecord(m);markSyncResult(m,true)}
 catch(e){markSyncResult(m,false,e)}
 finally{try{await reliablePut(m)}catch(e){console.warn('syncState保存失敗',e)}}
 return m.syncState.status==='synced';
}
/* 未同期(pending/failed)のレコードだけを対象に、順に再送する。
   1件ごとに端末へ保存するため、途中で中断しても進んだ分は残る。
   進捗はトーストではなく待機オーバーレイで示す(件数が多いと数秒かかり得るため)。 */
let syncingPending=false;
async function syncPendingRecords({silent}={}){
 if(syncingPending)return{total:0,ok:0,skipped:true};
 syncingPending=true;
 try{
  const all=await reliableAll();
  const targets=all.filter(x=>x.syncState?.status!=='synced');
  if(!targets.length){
   if(!silent)showToast('未同期のデータはありません','',3000);
   return{total:0,ok:0};
  }
  if(!silent)showSaveOverlay('Accessへ再送しています',`未同期 ${targets.length}件`);
  let ok=0;
  for(let i=0;i<targets.length;i++){
   if(!silent)updateWaiting(`${i+1}/${targets.length}件目: ${targets[i].basic?.lotNo||targets[i].id}`,'Accessへ送信しています');
   if(await backupAndTrackSync(targets[i]))ok++;
  }
  if(!silent)hideSaveOverlay();
  await refreshDraftCount();
  if(typeof refreshSyncStatusUI==='function')refreshSyncStatusUI();
  if($('#recordModal')&&!$('#recordModal').hidden)await refreshRecordList();
  if(!silent)showToast(ok===targets.length?'すべて同期しました':'一部同期できませんでした',`${ok}/${targets.length}件`,6000);
  return{total:targets.length,ok};
 }finally{syncingPending=false}
}
/* 未同期件数の表示。サイドバーのデータ一覧バッジへ警告ドットを出し、
   データ一覧のツールバーに件数と「今すぐ再送」ボタンを表示する。 */
async function refreshSyncStatusUI(){
 let pendingCount=0;
 try{const all=await reliableAll();pendingCount=all.filter(x=>x.syncState?.status!=='synced').length}catch(e){return}
 const badge=$('#homeDraftSyncWarn');
 if(badge){badge.hidden=pendingCount===0;badge.title=pendingCount?`Accessへ未同期のデータが${pendingCount}件あります`:''}
 const bar=$('#recordSyncBar'),count=$('#recordSyncCount');
 if(bar){bar.hidden=pendingCount===0}
 if(count)count.textContent=String(pendingCount);
}
window.syncPendingRecords=syncPendingRecords;
window.refreshSyncStatusUI=refreshSyncStatusUI;
// Explicit, staged waiting feedback for the two perceived slow routes.
function showWaiting(title,detail,progress,step){showSaveOverlay(title,detail);const p=$('#waitingProgress');if(p)p.textContent=progress||'処理を開始しています';setWaitingStep(step||0)}
function updateWaiting(detail,progress,step){if(detail)$('#saveOverlayDetail').textContent=detail;const p=$('#waitingProgress');if(p&&progress)p.textContent=progress;if(step)setWaitingStep(step)}
/* 保存/完了登録。完了時は必須項目・公差NGの検証を通過した場合のみ登録する。 */
async function persistAndTransition(status){
 updateValidationVisuals();
 /* 完了の可否は2段構え。ここで止めるのは「製品に依らず必ず不正なもの」だけ:
      - 公差外(ng): 値が範囲外。測り直すかNGとして記録する必要がある
      - オペレータ/検査員の未選択: どの製品でも必須
    測定項目の未入力は、必要な項目が製品の材質・用途・規格で変わるため
    ここでは止めず、measure-progress.js が全項目・全丈位置をまとめて提示して
    確認する(意図的に測らない項目があるため、一律のブロックは作業を止める)。 */
 if(status==='完了'){
  const result=updateValidationVisuals();
  if(result.ng.length){showValidationMessage(result);return}
  const identity=result.missing.filter(x=>x.el&&(x.el.id==='operator'||x.el.id==='inspector'));
  if(identity.length){showValidationMessage({missing:identity,ng:[]});return}
 }
 showSaveOverlay(status==='完了'?'完了登録しています':'一時保存しています','入力内容と初期参照データを端末へ保存中');
 try{
  const m=collect();m.status=status;m.updatedAt=new Date().toISOString();m.snapshot=m.snapshot||{};
  m.snapshot.source=structuredClone(m.source||{});m.snapshot.basic=structuredClone(m.basic||{});m.snapshot.savedAt=m.updatedAt;m.snapshot.schema='v32-full';
  const result=await reliablePut(m);
  const accessOK=await backupAndTrackSync(m);
  if(!accessOK)console.warn('Access backup failed',m.syncState?.lastError);
  measureDirty=false;
  await refreshDraftCount();refreshSyncStatusUI();$('#measureModal').hidden=true;hideSaveOverlay();
  showToast(status==='完了'?'完了登録しました':'一時保存しました',`${m.basic.lotNo||''} / IndexedDB ${result.idbOK?'OK':'代替保存'} / Access ${accessOK?'OK':'未完了（後で自動的に再送します）'}`,6500);
  await openRecords(status==='完了'?'履歴':'編集中');
 }catch(e){hideSaveOverlay();setState('保存エラー');alert('保存できませんでした: '+e.message)}
}
/* 端末内への保存。条数ロック→回収→IndexedDB保存→件数バッジ更新。 */
async function saveLocal(status='編集中'){
 lockCounts();
 const m=collect();m.status=status;await idbPut(m);measureDirty=false;
 setState(status==='完了'?'完了・端末保存済み':'端末保存済み');
 await refreshDraftCount();
 return m;
}
async function registerNg(){const m=await saveLocal('測定値NG');m.settings.ngCount=(m.settings.ngCount||0)+1;await idbPut(m);setState(`NGロット ${m.settings.ngCount}回目を保存`)}
async function refreshDraftCount(){try{const all=await reliableAll();$('#homeDraftCount').textContent=all.filter(x=>x.status!=='完了').length}catch(e){$('#homeDraftCount').textContent='!'}refreshSyncStatusUI()}
async function findDraftForRow(row){
 const all=await reliableAll(),targetLot=normalizedLot(pick(row,'lotNo')),targetInspection=normalizedLot(pick(row,'inspectionNo')),targetCasting=normalizedLot(pick(row,'castingNo'));
 const drafts=all.filter(x=>x.status!=='完了'&&normalizedLot(x.basic?.lotNo)===targetLot).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
 return drafts.find(x=>targetInspection&&normalizedLot(x.basic?.inspectionNo)===targetInspection)||drafts.find(x=>targetCasting&&normalizedLot(x.basic?.castingNo)===targetCasting)||drafts[0]||null;
}
async function resumeStoredMeasure(saved,row=null){S.current=row||saved.source||saved.snapshot?.source||null;S.measure=ensureMeasureShape(saved);renderMeasurement();$('#recordModal').hidden=true;$('#measureModal').hidden=false;requestAnimationFrame(()=>$('#deviceInput').focus());await loadMeasurementContext(false);requestAnimationFrame(()=>$('#deviceInput').focus())}
/* 測定画面を開く本処理: 同一ロットの編集中データがあれば直接再開、なければ
   新規作成して参照データ取得→初回保存まで行う。端末内検索(高速・ローカル)
   →仕掛等の参照データ取得(Access経由・低速)という実際の所要時間の境目に
   合わせて、ここで待機表示をステップ2へ切り替える(呼び出し元のopenMeasurement
   がステップ1を出している)。 */
async function openMeasurementCore(row){
 if(!row)throw Error('対象データがありません');S.current=row;const found=await findDraftForRow(row);
 const lot=pick(row,'lotNo')||'選択ロット';
 updateWaiting(`ロット ${lot} の仕掛情報を取得中`,'仕掛・公差・品質等級・品質情報を読み込んでいます',2);
 await nextPaint();
 if(found){await resumeStoredMeasure(found,row);showToast('編集中データを直接再開しました',`${found.basic?.lotNo||pick(row,'lotNo')} / ${found.updatedAt?new Date(found.updatedAt).toLocaleString('ja-JP'):''}`);return}
 const m=blankMeasure(row);m.id=lotKey(row)||crypto.randomUUID();S.measure=ensureMeasureShape(m);renderMeasurement();$('#measureModal').hidden=false;requestAnimationFrame(()=>$('#deviceInput').focus());await loadMeasurementContext(true);await reliablePut(collect());await refreshDraftCount();requestAnimationFrame(()=>$('#deviceInput').focus())
}
/* 測定画面を開く入口: 使用設備の登録/一致チェック→待機表示→本処理→
   登録設備の記録。待機表示は実際に目視できる2段階(端末内検索→参照データ
   取得)に整理し、それぞれの表示に確実に1フレーム以上の猶予(nextPaint)を
   与える。以前は3段階だったが、間に描画の猶予が無い箇所があり中間の
   ステップが画面に一切表示されないまま次のステップへ上書きされていた。 */
async function openMeasurement(row){
 if(!requireEquipmentBeforeMeasurement(row))return;
 const lot=pick(row,'lotNo')||'選択ロット';
 showWaiting('測定画面を準備しています',`ロット ${lot} の保存データを確認中`,'端末内の編集中データを確認しています',1);
 await nextPaint();
 let result;
 try{result=await openMeasurementCore(row)}finally{hideSaveOverlay()}
 if(S.measure){S.measure.settings=S.measure.settings||{};S.measure.settings.registeredEquipment=currentConfiguredEquipment();S.measure.registeredEquipment=currentConfiguredEquipment();updateCourseGuard()}
 return result;
}
// v32 final navigation controller
function bindV32Navigation(){
 const open=async status=>{try{await openRecords(status)}catch(e){console.error(e);alert('保存データ一覧を開けません: '+e.message)}};
 [['homeDrafts','編集中'],['openDrafts','編集中']].forEach(([id,status])=>{const b=$('#'+id);if(b){b.onclick=null;b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();open(status)})}})
}
/* 一覧を開く(読み込み中表示→エラー時は再試行ボタン)。
   実績カレンダー表示中にデータ一覧を開くと、カレンダーパネル(cal-mode)が
   隠れないまま半透明の#recordModalが重なって表示が被る不具合があったため、
   帳票/ダッシュボード表示への遷移と同様にカレンダー表示を必ず抜ける。 */
async function openRecordsSafe(status='編集中'){
 window.exitCalendarView?.();
 showWaiting(status==='履歴'?'完了データを取得しています':'編集中データを取得しています','この端末の保存領域を確認中','IndexedDBと代替保存領域を照合しています');
 try{
 const modal=$('#recordModal'),title=$('#recordTitle'),list=$('#recordList');
 title.textContent=status==='履歴'?'完了データ一覧':'編集中データ一覧';
 list.innerHTML='<div class="record-loading">保存データを読み込んでいます...</div>';
 modal.hidden=false;
 try{await openRecords(status)}catch(error){
  console.error('record list error',error);
  list.innerHTML=`<div class="record-empty"><b>保存データを表示できませんでした。</b><div class="save-result">${esc(error?.message||String(error))}</div><button id="retryRecordList" type="button">再読込</button></div>`;
  $('#retryRecordList').onclick=()=>openRecordsSafe(status);
 }
 }finally{hideSaveOverlay()}
}
// Capture phase keeps the navigation working even if another handler fails or is overwritten.
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-open-records],#homeDrafts,#openDrafts');
 if(!button)return;
 event.preventDefault();event.stopImmediatePropagation();
 const status=button.dataset.openRecords||'編集中';
 openRecordsSafe(status);
},true);
$('#saveDraft').onclick=()=>persistAndTransition('編集中');
$('#complete').onclick=()=>persistAndTransition('完了');
$('#backupNow').onclick=async()=>{
 showSaveOverlay('Accessへバックアップ','完全スナップショットを送信中');
 try{
  const m=collect();await reliablePut(m);
  const ok=await backupAndTrackSync(m);
  refreshSyncStatusUI();hideSaveOverlay();
  if(ok)showToast('Accessバックアップ完了',m.basic.lotNo||'');
  else showToast('Accessバックアップ失敗',`${m.basic.lotNo||''} / ${m.syncState?.lastError||''}（未同期として記録し、後で再送できます）`,7000);
 }catch(e){hideSaveOverlay();alert('バックアップ失敗: '+e.message)}
};
$('#discard').onclick=async()=>{if(confirm('端末内の測定データを削除しますか？')){await reliableDelete(S.measure.id);await refreshDraftCount();$('#measureModal').hidden=true}};
$('#ngLot').onclick=registerNg;
{const btn=$('#recordSyncNowBtn');if(btn)btn.onclick=()=>syncPendingRecords({silent:false})}
function closeMeasureModal(){if(measureDirty&&!confirm('保存されていない変更があります。破棄して閉じますか？'))return;$('#measureModal').hidden=true}
$('#closeModal').onclick=closeMeasureModal;$('.shade').onclick=closeMeasureModal;
/* 編集中データ一覧と完了データ一覧は1つの統合リストとして表示する。
   statuses.editing/doneはそれぞれ独立したトグルで、両方ONにすると
   編集中＋完了を同時に確認できる。既定は編集中のみON。 */
let recordListState={statuses:{editing:true,done:false},items:[],query:'',sort:'updated-desc'};
function recordMatchesStatusFilter(x){const done=x.status==='完了';return done?!!recordListState.statuses?.done:!!recordListState.statuses?.editing}
function recordSearchText(x){return [x.basic?.lotNo,x.basic?.inspectionNo,x.basic?.castingNo,x.basic?.equipment,x.settings?.registeredEquipment,x.registeredEquipment,x.status].map(v=>String(v||'').normalize('NFKC').toLowerCase()).join(' ')}
function sortedFilteredRecords(){let items=recordListState.items.filter(x=>recordMatchesStatusFilter(x)&&recordSearchText(x).includes(recordListState.query.normalize('NFKC').toLowerCase()));items=[...items];if(recordListState.sort==='updated-asc')items.sort((a,b)=>String(a.updatedAt||'').localeCompare(String(b.updatedAt||'')));else if(recordListState.sort==='lot-asc')items.sort((a,b)=>String(a.basic?.lotNo||'').localeCompare(String(b.basic?.lotNo||''),'ja'));else items.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));return items}
/* statusは呼び出し元からの既定プリセット('編集中'/'履歴')。省略時、あるいは
   トグル操作後の再読込時は直前のトグル状態(recordListState.statuses)を
   維持する。 */
function updateRecordListTitle(){
 const st=recordListState.statuses||{},title=$('#recordTitle');if(!title)return;
 title.textContent=st.editing&&st.done?'データ一覧（編集中＋完了）':st.done?'完了データ一覧':'編集中データ一覧';
}
function syncStatusFilterButtons(){
 const st=recordListState.statuses||{};
 document.querySelectorAll('.status-filter-btn').forEach(b=>b.classList.toggle('active',!!st[b.dataset.statusFilter]));
}
async function refreshRecordList(){
 recordListState.items=(await reliableAll()).map(ensureMeasureShape);
 renderRecordListRows();
}
async function openRecords(status){
 if(status==='編集中')recordListState.statuses={editing:true,done:false};
 else if(status==='履歴')recordListState.statuses={editing:false,done:true};
 else if(!recordListState.statuses)recordListState.statuses={editing:true,done:false};
 recordListState.items=(await reliableAll()).map(ensureMeasureShape);recordListState.query='';recordListState.sort='updated-desc';
 updateRecordListTitle();syncStatusFilterButtons();$('#recordModal').hidden=false;refreshSyncStatusUI();
 const search=$('#recordSearch'),sort=$('#recordSort'),clear=$('#clearRecordSearch');if(search){search.value='';search.oninput=()=>{recordListState.query=search.value;renderRecordListRows()}}if(sort){sort.value='updated-desc';sort.onchange=()=>{recordListState.sort=sort.value;renderRecordListRows()}}if(clear)clear.onclick=()=>{recordListState.query='';if(search)search.value='';renderRecordListRows()};renderRecordListRows();requestAnimationFrame(()=>search?.focus())
}
document.querySelectorAll('.status-filter-btn').forEach(b=>b.onclick=()=>{
 const key=b.dataset.statusFilter;recordListState.statuses[key]=!recordListState.statuses[key];
 syncStatusFilterButtons();updateRecordListTitle();renderRecordListRows();
});
/* 完了済みデータは一度完了させた記録のため、そのまま無条件に編集状態へ
   戻すと誤って内容を変更してしまう事故につながる。再編集しようとした
   場合は先に警告を出し、ユーザーが承認して初めて状態を「編集中」へ
   戻して保存し、以降の編集を受け付けるようにする(ロック解除の一手間)。 */
async function unlockCompletedForEdit(x){
 if(!confirm(`このデータ(${x.basic?.lotNo||x.id})はすでに完了しています。\n再編集すると「編集中」の状態に戻り、内容を変更できるようになります。\nよろしいですか？`))return false;
 x.status='編集中';x.updatedAt=new Date().toISOString();
 await reliablePut(x);
 return true;
}
// データ一覧からの再開もAccess経由の参照データ取得(loadMeasurementContext)を
// 伴うため、以前は待機表示が一切出ないまま無音で待たされていた。他の
// 測定画面オープン経路と同様に待機表示を出す(こちらは検索を伴わない
// 単発の読込のためステップ表示は使わない)。
function resumeRecordFromList(x){return async()=>{
 try{
  if(!requireEquipmentBeforeMeasurement(x.source||x.snapshot?.source||null))return;
  if(x.status==='完了'&&!await unlockCompletedForEdit(x))return;
  showWaiting('編集画面を準備しています',`ロット ${x.basic?.lotNo||x.id} の内容を復元中`,'保存済みの参照データを読み込んでいます');
  await nextPaint();
  S.measure=ensureMeasureShape(x);S.current=x.source||x.snapshot?.source||null;renderMeasurement();
  const recordModal=$('#recordModal'),measureModal=$('#measureModal');if(recordModal)recordModal.hidden=true;if(measureModal)measureModal.hidden=false;
  await loadMeasurementContext(false);updateCourseGuard();
  showToast('編集中データを再開しました',String(x.basic?.lotNo||x.id));
 }catch(error){console.error('resume failed',error);showToast('再開できませんでした',error?.message||String(error),8000)}
 finally{hideSaveOverlay()}
}}
/* 「何も入力がないデータ」かどうか: 測定値・丈別データ・母材入力・作業時間の
   いずれにも実データが無ければ、削除しても失うものが無い空レコードとみなす
   (仕掛を開いただけで自動保存された未入力レコードなど)。 */
function recordHasAnyInput(x){
 const meas=x.measurements||{};
 if(Object.values(meas).some(grid=>Array.isArray(grid)&&grid.some(row=>Array.isArray(row)&&row.some(v=>String(v??'').trim()!==''))))return true;
 if((x.product?.rows||[]).some(r=>r&&Object.values(r).some(v=>String(v??'').trim()!=='')))return true;
 if(Object.values(x.mother||{}).some(v=>String(v??'').trim()!==''))return true;
 if(x.workTime?.startAt||x.workTime?.endAt)return true;
 return false;
}
/* 削除確認モーダル: 何も入力がないデータ以外は、汎用confirm()ではなく
   専用モーダルでロット情報を示した上でしっかり警告する。 */
function ensureDeleteRecordModal(){
 let modal=$('#deleteRecordModal');if(modal)return modal;
 modal=document.createElement('div');modal.className='record-modal';modal.id='deleteRecordModal';modal.hidden=true;
 modal.innerHTML=`<div class="settings-dialog delete-confirm-dialog" role="dialog" aria-modal="true"><header><div><small>DELETE CONFIRMATION</small><h2>端末内データを削除しますか？</h2></div><button id="closeDeleteRecordModal" type="button" aria-label="閉じる">×</button></header><div class="settings-body"><div class="delete-confirm-summary" id="deleteRecordSummary"></div><p class="delete-confirm-warning">入力済みの測定データも含め、この端末内のデータを完全に削除します。この操作は取り消せません。</p><div class="settings-actions"><button id="cancelDeleteRecord" type="button">キャンセル</button><button id="confirmDeleteRecord" type="button" class="danger">削除する</button></div></div></div>`;
 document.body.append(modal);
 modal.addEventListener('click',e=>{if(e.target===modal)modal.hidden=true});
 $('#closeDeleteRecordModal').onclick=()=>modal.hidden=true;
 return modal;
}
function confirmDeleteRecord(x){
 return new Promise(resolve=>{
  const modal=ensureDeleteRecordModal();
  $('#deleteRecordSummary').innerHTML=`<div class="delete-confirm-row"><span>ロット番号</span><b>${esc(x.basic?.lotNo||x.id)}</b></div><div class="delete-confirm-row"><span>状態</span><b>${esc(x.status||'編集中')}</b></div><div class="delete-confirm-row"><span>検査番号</span><b>${esc(x.basic?.inspectionNo||'-')}</b></div><div class="delete-confirm-row"><span>更新日時</span><b>${esc(x.updatedAt?new Date(x.updatedAt).toLocaleString('ja-JP'):'-')}</b></div>`;
  modal.hidden=false;
  const cancel=$('#cancelDeleteRecord'),confirmBtn=$('#confirmDeleteRecord');
  const close=result=>{modal.hidden=true;resolve(result)};
  cancel.onclick=()=>close(false);
  confirmBtn.onclick=()=>close(true);
 });
}
/* 分割(条割変更)が実際に行われたかどうか: splitGroupsが2ロット以上に
   分かれている場合のみ「分割あり」とする(単一ロットのデフォルト値は分割なし扱い)。 */
function recordSplitLabel(x){return Array.isArray(x.settings?.splitGroups)&&x.settings.splitGroups.length>1?'あり':'-'}
function renderRecordListRows(){const list=$('#recordList'),items=sortedFilteredRecords(),currentLot=normalizedLot(S.current?pick(S.current,'lotNo'):'');if(!list)return;list.innerHTML='<div class="record-list-head"><span>状態</span><span>ロット番号</span><span>検査番号</span><span>製造材質</span><span>製造板厚</span><span>用途名</span><span>コース</span><span>オペレータ</span><span>検査員</span><span>作業人数</span><span>分割</span><span>作業開始時刻</span><span>更新日時</span><span>実作業時間</span><span>操作</span></div>';if(!items.length)list.insertAdjacentHTML('beforeend','<div class="record-empty">検索条件に一致するデータはありません。</div>');items.forEach(x=>{ensureMeasureShape(x);const same=currentLot&&normalizedLot(x.basic?.lotNo)===currentLot,row=document.createElement('article'),resume=resumeRecordFromList(x),course=x.basic?.residualCourse||x.basic?.course||x.basic?.designCourse||'-',crew=x.settings?.crewSize&&x.settings.crewSize!=='-'?x.settings.crewSize+'名':'-',isDone=x.status==='完了',syncSt=x.syncState?.status||'pending',syncBadge=syncSt==='synced'?'':`<span class="record-sync-badge record-sync-${syncSt}" title="${syncSt==='failed'?'Accessへの送信に失敗しました: '+esc(x.syncState?.lastError||''):'Accessへまだ送信していません'}">未同期</span>`;row.className='record-list-row'+(same?' is-same-lot':'');row.tabIndex=0;row.innerHTML=`<div class="record-list-cell"><span class="rp-status-badge${isDone?' done':''}">${isDone?'完了':'編集中'}</span>${syncBadge}</div><div class="record-list-cell primary"><button type="button" class="lot-dsp-link grid-lot-link" title="クリックでLotDspをこのロット番号で開きます">${esc(x.basic?.lotNo||x.id)}</button></div><div class="record-list-cell">${esc(x.basic?.inspectionNo||'-')}</div><div class="record-list-cell">${esc(x.basic?.mfgMaterial||'-')}</div><div class="record-list-cell secondary">${esc(fmtDim(x.basic?.mfgThickness,3)||'-')}</div><div class="record-list-cell secondary">${esc(x.basic?.purposeName||'-')}</div><div class="record-list-cell secondary">${esc(course)}</div><div class="record-list-cell secondary">${esc(x.settings?.operator||'-')}</div><div class="record-list-cell secondary">${esc(x.settings?.inspector||'-')}</div><div class="record-list-cell secondary">${esc(crew)}</div><div class="record-list-cell secondary">${esc(recordSplitLabel(x))}</div><div class="record-list-cell"><time>${esc(x.workTime?.startAt?formatWorkTime(x.workTime.startAt):'-')}</time></div><div class="record-list-cell"><time>${esc(x.updatedAt?new Date(x.updatedAt).toLocaleString('ja-JP'):'-')}</time></div><div class="record-list-cell record-duration">${esc(formatDuration(durationMs(x)))}</div><div class="record-list-actions"><button class="resume" type="button">${isDone?'内容を開く':'続きから再開'}</button><button class="report" type="button" title="このロットの帳票プレビューを開きます">帳票</button><button class="danger" type="button">削除</button></div>`;row.querySelector('.resume').onclick=e=>{e.stopPropagation();resume()};row.querySelector('.report').onclick=e=>{e.stopPropagation();if(typeof openReportForRecord==='function')openReportForRecord(x.id)};const recLotBtn=row.querySelector('.grid-lot-link');if(recLotBtn)recLotBtn.onclick=e=>{e.preventDefault();e.stopPropagation();openLotDsp(x.basic?.lotNo,x.basic?.castingNo,localStorage.getItem('LotDspLastTabV1')||'1')};
// ダブルクリックは編集再開ではなく帳票プレビューへの遷移とする(編集は「続きから再開/内容を開く」ボタンから明示的に行う)。
row.ondblclick=e=>{if(!e.target.closest('.danger')&&!e.target.closest('.resume')&&!e.target.closest('.report')&&!e.target.closest('.grid-lot-link')&&typeof openReportForRecord==='function')openReportForRecord(x.id)};
row.onkeydown=e=>{if(e.key==='Enter')resume()};
row.querySelector('.danger').onclick=async e=>{e.stopPropagation();const proceed=recordHasAnyInput(x)?await confirmDeleteRecord(x):true;if(proceed){await reliableDelete(x.id);await refreshDraftCount();await refreshRecordList()}};
list.append(row)});const result=$('#recordSearchResult');if(result)result.textContent=`${items.length} / ${recordListState.items.length}件を表示`}
/* ---- 使用設備の登録・設備マスタ ---- */
let pendingMeasurementRow=null;
function updateRegisteredEquipmentBadge(){const badge=$('#registeredEquipmentBadge'),equipment=currentConfiguredEquipment();if(!badge)return;const label=badge.querySelector('.equip-badge-text')||badge;label.textContent=equipment?`使用設備: ${equipment}`:'使用設備: 未登録';badge.classList.toggle('unregistered',!equipment);badge.title=equipment?'クリックして使用設備を変更できます':'測定開始前に使用設備の登録が必要です';badge.onclick=openAppSettings}
function closeAppSettings(){$('#appSettingsModal').hidden=true}
function bindAppSettingsControls(){
 const openButton=$('#openAppSettings'),closeButton=$('#closeAppSettings'),cancelButton=$('#cancelAppSettings'),saveButton=$('#saveAppSettings');
 if(openButton)openButton.onclick=openAppSettings;
 if(closeButton)closeButton.onclick=closeAppSettings;
 if(cancelButton)cancelButton.onclick=closeAppSettings;
 updateRegisteredEquipmentBadge();
 const save=$('#saveAppSettings');if(save)save.onclick=async()=>{
  const input=$('#configuredEquipment'),status=$('#equipmentSettingStatus');if(!input||!status)return;const value=input.value.trim();
  if(!value){status.textContent='設備名を入力してください。';status.className='setting-status warn';return}
  localStorage.setItem(APP_EQUIPMENT_KEY,value);status.textContent=`登録しました: ${value}`;status.className='setting-status ok';updateRegisteredEquipmentBadge();updateCourseGuard();
  const row=pendingMeasurementRow;pendingMeasurementRow=null;setTimeout(closeAppSettings,250);if(row){await nextPaint();openMeasurement(row).catch(error=>alert('測定画面を開けません: '+error.message))}
 };
}
/* Equipment settings final controller: repairs missing DOM, closes lower layers, and owns all entry points. */
function ensureEquipmentSettingsModal(){
 let modal=$('#appSettingsModal');
 if(modal&&$('#configuredEquipment')&&$('#equipmentSettingStatus')&&$('#saveAppSettings'))return modal;
 modal?.remove();
 const wrapper=document.createElement('div');wrapper.className='record-modal';wrapper.hidden=true;wrapper.id='appSettingsModal';wrapper.innerHTML=`<div class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="equipmentSettingsTitle"><header><div><small>APPLICATION SETTINGS</small><h2 id="equipmentSettingsTitle">使用設備の設定</h2></div><button id="closeAppSettings" type="button" aria-label="閉じる">×</button></header><div class="settings-body"><p>この端末で測定する設備を登録します。登録設備は、仕掛データの設計コースとの照合と保存データの識別に使用します。</p><label>使用設備名<input autocomplete="off" id="configuredEquipment" placeholder="例: LS4" type="text"/></label><div class="setting-status warn" id="equipmentSettingStatus">使用設備は未登録です</div><div class="settings-actions"><button id="cancelAppSettings" type="button">キャンセル</button><button id="saveAppSettings" type="button">この設備を登録</button></div></div></div>`;
 document.body.append(wrapper);return wrapper;
}
function updateEquipmentEntryPoints(){
 const equipment=currentConfiguredEquipment(),configured=!!equipment,banner=$('#equipmentSetupBanner');
 const header=$('.equipment-header-button'),headerName=$('#headerEquipmentName');if(header){header.classList.toggle('is-unset',!configured)}if(headerName)headerName.textContent=equipment||'未設定';
 if(banner){banner.classList.toggle('configured',configured);const title=$('#equipmentSetupTitle'),help=$('#equipmentSetupHelp'),button=banner.querySelector('button');if(title)title.textContent=configured?`使用設備: ${equipment}`:'最初に使用設備を設定してください';if(help)help.textContent=configured?'この端末の登録設備です。変更する場合は右のボタンを押してください。':'測定を開始する前に、この端末で使用する設備を登録します。';if(button)button.textContent=configured?'使用設備を変更':'使用設備を設定'}
 updateRegisteredEquipmentBadge();
 {const configured=!!currentConfiguredEquipment(),banner=$('#equipmentSetupBanner');if(banner)banner.classList.toggle('configured',configured)}
}
/* Equipment master final workflow. */
let equipmentMasterState={items:[],loaded:false,created:false};
function residualEquipmentSuggestion(){const raw=residualCourseValue();return String(raw||'').trim().split(/[\\s　]+/).filter(Boolean)[0]||''}
/* 起動直後のqueueMicrotask初回読込と、マスタ管理を開いた際のloadMaint()側
   からの読込が同時に走ると、後から解決した方が先に解決した方の結果を
   上書きしてしまう競合状態になり得た(タイミング次第で「開いた直後は
   空/未反映、何か別の操作で再読込されて初めて表示される」ように見える
   不具合の原因になり得る)。同一の取得処理が進行中なら新たなリクエストを
   発行せず、進行中のPromiseへ相乗りさせる。 */
let equipmentMasterLoading=null;
async function loadEquipmentMaster(force=false){
 if(equipmentMasterState.loaded&&!force)return equipmentMasterState;
 if(equipmentMasterLoading)return equipmentMasterLoading;
 equipmentMasterLoading=(async()=>{
  try{
   const result=await api('/api/equipment-master');
   equipmentMasterState={items:result.items||[],loaded:true,created:!!result.created};
   const list=$('#equipmentMasterOptions');if(list)list.innerHTML=equipmentMasterState.items.map(x=>`<option value="${esc(x.name)}"></option>`).join('');
   return equipmentMasterState;
  }finally{equipmentMasterLoading=null}
 })();
 return equipmentMasterLoading;
}
function findMasterEquipment(name){const n=normalizeCourseText(name);return equipmentMasterState.items.find(x=>normalizeCourseText(x.name)===n)||null}
async function registerAndSelectEquipment(name){const result=await api('/api/equipment-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withUserId({name}))});localStorage.setItem(APP_EQUIPMENT_KEY,result.name);await loadEquipmentMaster(true);return result}
function fillEquipmentSelect(selected='',suggested=''){
 const select=$('#configuredEquipment');if(!select)return;const names=equipmentMasterState.items.map(x=>x.name),preset=suggested&&names.find(x=>normalizeCourseText(x)===normalizeCourseText(suggested)),current=selected&&names.find(x=>normalizeCourseText(x)===normalizeCourseText(selected));
 select.innerHTML='<option value="">設備マスタから選択</option>'+names.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')+'<option value="__new__">＋ 設備マスタへ新規登録</option>';const unmatchedSuggestion=suggested&&!preset?suggested:'',unmatchedCurrent=selected&&!current?selected:'';select.value=preset||current||((unmatchedSuggestion||unmatchedCurrent)?'__new__':'');$('#newEquipmentEntry').hidden=select.value!=='__new__';const newName=$('#newEquipmentName');if(newName)newName.value=unmatchedSuggestion||unmatchedCurrent||'';select.onchange=()=>{$('#newEquipmentEntry').hidden=select.value!=='__new__';if(select.value!=='__new__'&&newName)newName.value='';updateEquipmentMasterHelp()};
}
function updateEquipmentMasterHelp(){const select=$('#configuredEquipment'),help=$('#equipmentMasterHelp');if(!select||!help)return;if(!equipmentMasterState.items.length){help.className='equipment-master-help warn';help.textContent='設備マスタに登録がありません。「設備マスタへ新規登録」から最初の設備を登録してください。';return}if(select.value==='__new__'){help.className='equipment-master-help warn';help.textContent='入力した設備をmaster.sqlite3の設備マスタへ登録し、次回から一覧に表示します。';return}if(select.value){help.className='equipment-master-help ok';help.textContent=`設備マスタから選択: ${select.value}`;return}help.className='equipment-master-help';help.textContent=`設備マスタから選択してください。登録済み ${equipmentMasterState.items.length}件`}
async function openEquipmentSettingsFinal(reason='manual',suggested=''){
 const modal=ensureEquipmentSettingsModal();['recordModal','measureModal','splitModal'].forEach(id=>{const el=$('#'+id);if(el&&!el.hidden)el.hidden=true});hideSaveOverlay();const status=$('#equipmentSettingStatus');modal.hidden=false;
 try{await loadEquipmentMaster(true)}catch(error){status.textContent=error.message;status.className='setting-status warn';return false}
 const suggestion=suggested||((reason==='suggestion'||reason==='required')?residualEquipmentSuggestion():'');fillEquipmentSelect(currentConfiguredEquipment(),suggestion);updateEquipmentMasterHelp();status.textContent=suggestion?`残コースから候補設備「${suggestion}」をプリセットしました。`:currentConfiguredEquipment()?`現在の設定: ${currentConfiguredEquipment()}`:'設備マスタから使用設備を選択してください。';status.className='setting-status '+(suggestion||!currentConfiguredEquipment()?'warn':'ok');
 const close=()=>modal.hidden=true;$('#closeAppSettings').onclick=close;$('#cancelAppSettings').onclick=close;
 $('#saveAppSettings').onclick=async()=>{const select=$('#configuredEquipment');let name=select.value;if(name==='__new__')name=$('#newEquipmentName').value.trim();if(!name){status.textContent='設備を選択してください。';status.className='setting-status warn';select.focus();return}try{const result=await registerAndSelectEquipment(name);status.textContent=result.message;status.className='setting-status ok';updateEquipmentEntryPoints();updateCourseGuard();const row=pendingMeasurementRow;pendingMeasurementRow=null;setTimeout(close,450);if(row){await nextPaint();openMeasurement(row).catch(error=>showToast('測定画面を開けません',error.message,8000))}}catch(error){status.textContent=error.message;status.className='setting-status warn'}};requestAnimationFrame(()=>$('#configuredEquipment').focus());return true;
}
function openAppSettings(){return openEquipmentSettingsFinal('manual')}
/* 使用設備が未登録なら従来通り登録を促す。登録済みでも、対象データの
   BOX設計_設備名が登録設備と一致しない場合は、開く/再開するどちらの
   経路でも必須条件としてブロックする(仕掛一覧の行クリック・編集中/完了
   一覧からの「続きから再開」の両方がrequireEquipmentBeforeMeasurement
   を経由するため、ここ一箇所の修正で両経路をカバーできる)。
   行データが無い/BOX設計_設備名が空の場合は判定不能のためブロックしない。 */
function requireEquipmentBeforeMeasurement(row){
 const equipment=currentConfiguredEquipment();
 if(!equipment){pendingMeasurementRow=row||null;openEquipmentSettingsFinal('required');return false}
 const rowEquipment=row?pick(row,'equipment'):'';
 if(rowEquipment&&!equipmentIsInDesignCourse(equipment,rowEquipment)){
  alert(`このロットの設計設備「${rowEquipment}」は、登録済みの使用設備「${equipment}」と一致しません。\n測定を開始・再開できません。設備が正しいか確認してください。`);
  return false;
 }
 return true;
}
function updateCourseGuard(){
 if(!S.measure)return;const equipment=currentConfiguredEquipment(),course=designCourseValue(),residual=residualCourseValue(),suggestion=residualEquipmentSuggestion(),warning=$('#courseWarning');if(!warning)return;
 let message='',show=false;if(!equipment){message='使用設備が未設定です。設備マスタから登録してください。';show=true}else if(!course){message=`設計コースが取得できないため、設備「${equipment}」の対象判定ができません。`;show=true}else if(!equipmentIsInDesignCourse(equipment,course)){message=`設定設備「${equipment}」は設計コース「${course}」に含まれていません。`;show=true}
 warning.hidden=!show;if(!show){warning.innerHTML='';return}
 warning.innerHTML=`<span class="course-warning-main">${esc(message)}</span><span class="course-warning-actions">${suggestion?`<span class="course-suggestion">候補: ${esc(suggestion)}</span>`:''}<button type="button" id="changeEquipmentFromWarning">${suggestion?'候補の設備へ変更':'設備登録を変更'}</button></span>`;
 const button=$('#changeEquipmentFromWarning');if(button)button.onclick=()=>openEquipmentSettingsFinal('suggestion',suggestion);
}
document.addEventListener('click',event=>{const trigger=event.target.closest('[data-open-equipment-settings],#registeredEquipmentBadge');if(!trigger)return;event.preventDefault();event.stopImmediatePropagation();openEquipmentSettingsFinal('manual')},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#appSettingsModal')?.hidden){$('#appSettingsModal').hidden=true}},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#changelogModal')?.hidden){$('#changelogModal').hidden=true}},true);
queueMicrotask(()=>{ensureEquipmentSettingsModal();updateEquipmentEntryPoints()});
queueMicrotask(async()=>{try{await loadEquipmentMaster();updateEquipmentEntryPoints()}catch(error){console.warn('equipment master init failed',error)}});
queueMicrotask(()=>{updateRegisteredEquipmentBadge();const start=$('#stampWorkStart'),end=$('#stampWorkEnd');if(start)start.onclick=()=>stampWorkTimeLocked('start');if(end)end.onclick=()=>stampWorkTimeLocked('end')});
queueMicrotask(()=>{updateEquipmentEntryPoints();const badge=$('#registeredEquipmentBadge');if(badge){badge.setAttribute('role','button');badge.tabIndex=0;badge.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openEquipmentSettingsFinal('manual')}}}});
/* 編集中/完了データ一覧をモーダルからメイン画面切替表示へ変更(帳票・
   ダッシュボードと同じIA)。既存のopenRecords/closeRecords等の表示
   切替コードは触らず、#recordModalの位置とスタイルだけ変え、
   hidden属性の変化をMutationObserverで見てbody.rec-modeへ反映する。
   これにより一覧側のロジックを一切変更せずに済む。 */
(function(){
 const panel=document.getElementById('recordModal');
 const grid=document.getElementById('grid');
 if(!panel||!grid?.parentNode)return;
 grid.parentNode.insertBefore(panel,grid);
 const sync=()=>{
  const showing=!panel.hidden;
  document.body.classList.toggle('rec-mode',showing);
  if(showing){
   document.getElementById('reportPanel')?.setAttribute('hidden','');
   document.body.classList.remove('rp-mode');
   document.getElementById('dashboardPanel')?.setAttribute('hidden','');
   document.body.classList.remove('db-mode');
   /* 他のトップレベル表示先と同じく、サイドバーで現在地が分かるようにする。 */
   if(typeof setActiveNav==='function')setActiveNav('homeDrafts');
  }
 };
 new MutationObserver(sync).observe(panel,{attributes:true,attributeFilter:['hidden']});
 sync();
 const baseSelectDb=typeof selectDb==='function'?selectDb:null;
 if(baseSelectDb)selectDb=async function(k,b){panel.hidden=true;return baseSelectDb(k,b)};
})();
/* ---- 未同期データの自動再送 ----
   工場の共有フォルダは瞬断し得るため、失敗を放置せず自動で回収する。
   起動直後・オンライン復帰時・15分間隔の3経路で試みる。いずれも
   silent:trueで動くため、対象が無い/失敗してもトーストは出さず
   (バッジ・データ一覧側の表示のみ更新)、作業の邪魔をしない。 */
queueMicrotask(()=>{refreshSyncStatusUI();syncPendingRecords({silent:true})});
window.addEventListener('online',()=>syncPendingRecords({silent:true}));
setInterval(()=>syncPendingRecords({silent:true}),15*60*1000);
/* ---- アプリ起動 ---- */
bindAppSettingsControls();
init().catch(error=>{
 console.error('初期化エラー',error);
 const grid=$('#grid');if(grid)grid.innerHTML=`<div class="load-error"><b>画面を初期化できませんでした</b><span>${esc(error?.message||String(error))}</span></div>`;
});
