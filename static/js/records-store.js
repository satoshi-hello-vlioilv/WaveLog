"use strict";
/* records-store.js: 端末内保存(IndexedDB+localStorageミラー)・保存/完了遷移・
   編集中/完了データ一覧・参照データ(コンテキスト)取得・使用設備/設備マスタ設定。 */
const DB='MeasurementLocal',STORE='lots';function idb(){return new Promise((ok,no)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}async function idbGet(id){const d=await idb();return new Promise((o,n)=>{const r=d.transaction(STORE).objectStore(STORE).get(id);r.onsuccess=()=>o(r.result);r.onerror=()=>n(r.error)})}async function idbPut(v){const d=await idb();return new Promise((o,n)=>{const r=d.transaction(STORE,'readwrite').objectStore(STORE).put(v);r.onsuccess=()=>o();r.onerror=()=>n(r.error)})}async function idbDelete(id){const d=await idb();return new Promise((o,n)=>{const r=d.transaction(STORE,'readwrite').objectStore(STORE).delete(id);r.onsuccess=()=>o();r.onerror=()=>n(r.error)})}
/* 端末内の保存容量（§9.129）。**普段は出さない。**「0.0MB / 上限目安 0.8GB」は
   測定中ずっと出ていても打つ手が無く、主要動線の面積を取るだけだった。
   保存できなくなる恐れが出たとき——半分を超えたとき——だけ言う
   （「できないことは、できないと書く」のは、実際にできなくなる側の話）。 */
const QUOTA_WARN_RATIO=0.5;
async function showQuota(){
 const el=$('#quota');if(!el)return;
 if(!navigator.storage?.estimate){el.hidden=true;el.textContent='';return}
 const q=await navigator.storage.estimate();
 const used=q.usage||0,cap=q.quota||0;
 if(!cap||used/cap<QUOTA_WARN_RATIO){el.hidden=true;el.textContent='';return}
 el.hidden=false;
 el.textContent=`端末内の保存容量が残り少なくなっています（使用 ${(used/1048576).toFixed(1)}MB / 目安 ${(cap/1073741824).toFixed(1)}GB）`;
}
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
/* 端末内データの削除。**バックアップ(records.sqlite3)からも必ず消す**。
   以前は端末内(IndexedDB+ミラー)だけを消していたため、バックアップに行が
   残り続けた。作業スケジュールの実績突合はバックアップを見るので、
   「データ一覧には何も無いのに、スケジュールには作業中(開始だけで終了が
   無い)が並ぶ」という食い違いが起きていた(§9.52)。
   サーバーへ届かなかった分は端末に控えて次回まとめて消す(削除は端末側で
   既に済んでおり、ここで失敗を握りつぶすと残骸が永久に残るため)。 */
const PENDING_BACKUP_DELETE_KEY='WaveLogPendingBackupDeleteV1';
function pendingBackupDeletes(){
 try{const v=JSON.parse(localStorage.getItem(PENDING_BACKUP_DELETE_KEY)||'[]');return Array.isArray(v)?v:[]}
 catch(e){return []}
}
function setPendingBackupDeletes(ids){
 try{localStorage.setItem(PENDING_BACKUP_DELETE_KEY,JSON.stringify([...new Set(ids)].slice(0,500)))}
 catch(e){/* 保存できなくても削除自体は続ける */}
}
async function deleteBackupRows(ids){
 const list=[...new Set((ids||[]).filter(Boolean))];
 if(!list.length)return true;
 try{
  await api('/api/measurement/backup/delete',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({ids:list})});
  return true;
 }catch(e){
  /* 再試行して意味があるのは通信・サーバー側の一時的な失敗だけ。
     権限不足(403。バックアップの削除はeditモード限定)や不正な要求(4xx)は
     何度試しても結果が変わらないため、積み直すと控えが永久に消えず、
     起動のたびに失敗する呼び出しを繰り返すことになる。 */
  const permanent=e&&e.status>=400&&e.status<500;
  if(permanent){
   console.warn('バックアップを削除できません(再試行しても変わらないため控えません)',e.status,e.message);
   return false;
  }
  console.warn('バックアップの削除に失敗(次回まとめて再試行します)',e);
  setPendingBackupDeletes([...pendingBackupDeletes(),...list]);
  return false;
 }
}
/* 前回消せなかったバックアップ行を消す。起動時と、データ一覧を開いたときに走る。 */
async function flushPendingBackupDeletes(){
 const ids=pendingBackupDeletes();
 if(!ids.length)return;
 setPendingBackupDeletes([]);          // 失敗したらdeleteBackupRowsが積み直す
 await deleteBackupRows(ids);
}
window.flushPendingBackupDeletes=flushPendingBackupDeletes;
async function reliableDelete(id){
 try{await idbDelete(id)}catch(e){console.warn(e)}
 try{mirrorDelete(id)}catch(e){console.warn(e)}
 await deleteBackupRows([id]);
 // 実績が消えたのでスケジュールの予定キャッシュも捨てる(次に開いたときに
 // 作業中の表示が残らないようにする)。
 if(typeof window.invalidateSchedulePlanCache==='function')window.invalidateSchedulePlanCache();
}
function applyContextSnapshot(x){
 const m=S.measure;if(!m||!x)return;
 /* **選択肢を並べる前に使用回数を渡す**(§9.133)。順序が逆だと、最初の
    1回だけマスタ順のまま出て、次に開いたときから並びが変わる。 */
 WL.choiceUsage.set(x.choice_usage);
 optionFill('operator',x.operators,m.settings.operator);optionFill('inspector',x.inspectors||x.operators,m.settings.inspector);
 optionFill('thicknessGauge',x.thickness_gauges,m.settings.thicknessGauge);optionFill('widthGauge',x.width_gauges,m.settings.widthGauge);
 optionFill('innerDiameter',x.inner_diameters,m.settings.innerDiameter);optionFill('spool',x.spools,m.settings.spool);
 /* バリ揃え・コイル止めはマスタ化前まで画面へ直接書かれていた選択肢なので、
    マスタが空(未作成・全件無効化)でも選べる値が消えないよう既定を持つ。
    先頭の'-'は付けない——「指定なし」が既にその意味の選択肢のため。 */
 WL.optionList('burr',x.burr_types?.length?x.burr_types:['上バリ揃え','下バリ揃え','指定なし'],m.settings.burr);
 WL.optionList('coilStop',x.coil_stops?.length?x.coil_stops:['内巻両面テープ','指定なし'],m.settings.coilStop);
 /* この設備で割れる最大条数(設備マスタ)。横割数の入力上限と条割の上限確認に
    使う。取得できない場合は触らない(既定=構造上の上限40で動く)。 */
 if(Number.isFinite(Number(x.max_strips))&&Number(x.max_strips)>=1){
  m.settings.maxStrips=Math.min(40,Math.round(Number(x.max_strips)));
  if(typeof applyMaxStripsToInputs==='function')applyMaxStripsToInputs();
 }
 /* 設備の区分(コイル／板)。板丈の公差は板の設備でだけ意味を持つ(§9.157)。
    **未設定('')はそのまま持つ**——「板」と決め付けると、コイルの設備で
    出どころの分からない公差が並ぶ。 */
 if(typeof x.equipment_kind==='string')m.settings.equipmentKind=x.equipment_kind;
 if(x.quality?.length){m.qualityInfo=qualityText(x.quality)}
 $('#qualityInfo').value=m.qualityInfo||'異常情報なし';paintQualityInfo();
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
/* 共有DBから受け取った1件を元の形へ戻す(§9.91)。encodePayloadと対で、
   codec='json-full-v32'のときだけ使える。 */
function decodePayload(text){return JSON.parse(text)}
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
 try{
  await backupRecord(m);markSyncResult(m,true);
  /* 作業スケジュールの実績突合はサーバーのバックアップを見る(§9.52)。保存で
     その中身が変わったので、スケジュール側の予定キャッシュを捨てて次に開いた
     ときに取り直させる。捨てないと「作業を始めた/終えたのにスケジュールが
     前のまま」になる。削除(reliableDelete)は以前から捨てており、
     **保存側だけ抜けていた**。 */
  if(typeof window.invalidateSchedulePlanCache==='function')
   window.invalidateSchedulePlanCache(m.registeredEquipment||m.settings?.registeredEquipment||undefined);
 }
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
  if(!silent)showSaveOverlay('バックアップDBへ送信しています',`未同期 ${targets.length}件`);
  let ok=0;
  for(let i=0;i<targets.length;i++){
   if(!silent)updateWaiting(`${i+1}/${targets.length}件目: ${targets[i].basic?.lotNo||targets[i].id}`,'バックアップDBへ送信しています');
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
async function refreshSyncStatusUI(preloaded){
 // preloaded: 呼び出し元が既に全件を読んでいるときは渡してもらう。
 // refreshDraftCount()は保存・削除・同期のたびに走る経路で、そこから
 // 無条件に呼ばれるため、渡さないと同じ全件読みが毎回2回走る。
 let pendingCount=0;
 try{
  const all=Array.isArray(preloaded)?preloaded:await reliableAll();
  pendingCount=all.filter(x=>x.syncState?.status!=='synced').length;
 }catch(e){return}
 const badge=$('#homeDraftSyncWarn');
 if(badge){badge.hidden=pendingCount===0;badge.title=pendingCount?`バックアップDBへ未送信のデータが${pendingCount}件あります`:''}
 const bar=$('#recordSyncBar'),count=$('#recordSyncCount');
 if(bar){bar.hidden=pendingCount===0}
 if(count)count.textContent=String(pendingCount);
}
window.syncPendingRecords=syncPendingRecords;
window.refreshSyncStatusUI=refreshSyncStatusUI;
// Explicit, staged waiting feedback for the two perceived slow routes.
function showWaiting(title,detail,progress,step){showSaveOverlay(title,detail);const p=$('#waitingProgress');if(p)p.textContent=progress||'処理を開始しています';setWaitingStep(step||0)}
function updateWaiting(detail,progress,step){if(detail)$('#saveOverlayDetail').textContent=detail;const p=$('#waitingProgress');if(p&&progress)p.textContent=progress;if(step)setWaitingStep(step)}
/* ---------- 時間のかかる読み込みへ共通でWAITING表示を出すラッパー ----------
   マスタ管理・作業スケジュール・カレンダー・分析は、ネットワーク共有上の
   Access/SQLiteを読むため数秒かかることがある。無反応に見えて二度押しされる
   のを防ぐため、読み込み中はこのラッパーでオーバーレイを出す。

   守っている約束:
   - **速い処理ではそもそも出さない**。delayMs(既定350ms)を超えたときだけ
     表示する。ローカルのマスタは大半が一瞬で返るため、毎回スピナーが
     瞬いてかえって不安にさせるのを避ける。
   - **二重に出さない**。既に外側の処理が表示中なら内側は何もしない
     (表示の主導権は外側が持ち、内側が勝手に閉じない)。list-view.jsの
     load()のように直接showWaiting()する既存経路とも、タイマー発火時に
     オーバーレイの状態を見直すことで衝突しない。
   - **必ず閉じる**。fnが例外を投げてもfinallyで片付ける。
   fnには進捗更新用の関数を渡す: fn(report) → report({detail,progress,step})。 */
let waitingBusy=false;
async function withWaiting(opts,fn){
 const o=typeof opts==='string'?{title:opts}:(opts||{});
 const overlay=$('#saveOverlay');
 const owned=!!overlay&&!waitingBusy&&overlay.hidden;
 let timer=null,shown=false;
 if(owned){
  waitingBusy=true;
  timer=setTimeout(()=>{
   // 待っている間に他の処理がオーバーレイを出していたら譲る(閉じもしない)
   if(!overlay.hidden)return;
   shown=true;
   showWaiting(o.title||'読み込んでいます',o.detail||'',o.progress||'サーバーからデータを取得しています',o.step||0);
  },o.delayMs===undefined?350:o.delayMs);
 }
 const report=u=>{if(shown&&u)updateWaiting(u.detail,u.progress,u.step)};
 try{return await fn(report)}
 finally{
  if(timer)clearTimeout(timer);
  if(owned){waitingBusy=false;if(shown)hideSaveOverlay()}
 }
}
window.withWaiting=withWaiting;
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
  showToast(status==='完了'?'完了登録しました':'一時保存しました',`${m.basic.lotNo||''} / IndexedDB ${result.idbOK?'OK':'代替保存'} / バックアップ ${accessOK?'OK':'未送信（後で自動的に再送します）'}`,6500);
  await openRecords(status==='完了'?'履歴':'編集中');
 }catch(e){hideSaveOverlay();setState('保存エラー');alert('保存できませんでした: '+e.message)}
}
/* 端末内への保存。条数ロック→回収→IndexedDB保存→件数バッジ更新。
   IndexedDB単独ではなくreliablePutを使う(IndexedDB障害時もlocalStorage
   ミラーへ確実に残すため。以前はここだけidbPutを直接呼んでおり、私用
   端末のプライベートブラウジング等でIndexedDBが使えない場合にNG登録
   ("測定値NG")が無警告で失われ得た)。 */
async function saveLocal(status='編集中'){
 lockCounts();
 const m=collect();m.status=status;m.updatedAt=new Date().toISOString();
 await reliablePut(m);measureDirty=false;
 setState(status==='完了'?'完了・端末保存済み':'端末保存済み');
 /* **途中経過も共有DBへ送る(§9.91)。** 以前はここが端末内だけで終わって
    おり、別のPCからは同じロットの続きがまったく見えなかった(子ロット
    データもレコードの中(settings.splitSourcesCache)なので同じ)。
    画面は待たせない——送信の成否は syncState に残り、失敗しても
    既存の再送(syncPendingRecords)が拾う。 */
 shareRecord(m);
 await refreshDraftCount();
 return m;
}
/* 端末内保存のあとに共有DBへ送る(待たない)。同じレコードを続けて保存した
   ときに送信が重ならないよう、IDごとに1本だけ走らせる。 */
const sharing=new Map();
function shareRecord(m){
 if(!m||!m.id)return;
 if(sharing.get(m.id)){sharing.set(m.id,'again');return}
 sharing.set(m.id,'running');
 (async()=>{
  try{
   do{
    sharing.set(m.id,'running');
    await backupAndTrackSync(m);
   }while(sharing.get(m.id)==='again');
  }catch(e){/* syncStateへ記録済み。ここで画面を止めない */}
  finally{sharing.delete(m.id);
   if(typeof refreshSyncStatusUI==='function')refreshSyncStatusUI();}
 })();
}
window.shareRecord=shareRecord;
async function registerNg(){
 try{
  const m=await saveLocal('測定値NG');m.settings.ngCount=(m.settings.ngCount||0)+1;await reliablePut(m);setState(`NGロット ${m.settings.ngCount}回目を保存`);
 }catch(e){alert('NG登録を保存できませんでした: '+e.message)}
}
async function refreshDraftCount(){
 // 全件読みは1回だけにして、未同期件数の表示へも同じ配列を渡す。
 let all=null;
 try{all=await reliableAll();$('#homeDraftCount').textContent=all.filter(x=>x.status!=='完了').length}
 catch(e){$('#homeDraftCount').textContent='!'}
 refreshSyncStatusUI(all);
}
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
 if(found){await resumeStoredMeasure(found,row);showToast(found.status==='測定値NG'?'NG登録データを直接再開しました':'編集中データを直接再開しました',`${found.basic?.lotNo||pick(row,'lotNo')} / ${found.updatedAt?new Date(found.updatedAt).toLocaleString('ja-JP'):''}`);return}
 const m=blankMeasure(row);m.id=lotKey(row)||crypto.randomUUID();S.measure=ensureMeasureShape(m);renderMeasurement();$('#measureModal').hidden=false;requestAnimationFrame(()=>$('#deviceInput').focus());await loadMeasurementContext(true);
 const first=collect();await reliablePut(first);
 // 作った時点で共有DBにも置く(§9.91)。ここで置いておかないと、測定を
 // 始めた事実そのものが他のPCから見えない。
 shareRecord(first);
 await refreshDraftCount();requestAnimationFrame(()=>$('#deviceInput').focus())
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
 try{result=await openMeasurementCore(row)}finally{hideSaveOverlay();if(typeof refreshScheduleInfo==='function')refreshScheduleInfo()}
 if(S.measure){S.measure.settings=S.measure.settings||{};S.measure.settings.registeredEquipment=currentConfiguredEquipment();S.measure.registeredEquipment=currentConfiguredEquipment();updateCourseGuard()}
 return result;
}
// v32 final navigation controller
function bindV32Navigation(){
 const open=async status=>{try{await openRecords(status)}catch(e){console.error(e);alert('保存データ一覧を開けません: '+e.message)}};
 [['homeDrafts','編集中'],['openDrafts','編集中']].forEach(([id,status])=>{const b=$('#'+id);if(b){b.onclick=null;b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();open(status)})}})
}
/* データ一覧(#recordModal)。半透明のモーダルなので、他の画面を閉じずに
   開くと下の画面が透けて重なる(実績カレンダー表示中に開いて実際に起きた)。
   閉じ方をここで登録し、他画面へ移るときはenterView()が呼んでくれる。 */
WL.registerView({key:'records',nav:'homeDrafts',bodyClass:'rec-mode',toolbar:'#recordSearchBar',
 exit:()=>{closeRecordColumnPanel();
           document.getElementById('recordModal')?.setAttribute('hidden','')}});
/* 一覧を開く(読み込み中表示→エラー時は再試行ボタン)。 */
async function openRecordsSafe(status='編集中'){
 WL.enterView('records');
 showWaiting(status==='履歴'?'完了データを取得しています':'編集中データを取得しています','この端末の保存領域を確認中','IndexedDBと代替保存領域を照合しています');
 // 一覧を開くのは「端末内に何があるか」を確かめる操作。ここでも未処理の
 // バックアップ削除を片付けて、一覧とバックアップの食い違いを縮める(§9.52)。
 flushPendingBackupDeletes().catch(e=>console.warn('バックアップ削除の再試行に失敗',e));
 try{
 const modal=$('#recordModal'),list=$('#recordList');
 // 画面名はヘッダー(#fileName)が持つ。パネル側に同じ文字を出すと二重になる。
 setHeaderContext(status==='履歴'?'完了データ一覧':'編集中データ一覧','この端末に保存された測定データ');
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
 showSaveOverlay('バックアップDBへ送信','完全スナップショットを送信中');
 try{
  const m=collect();await reliablePut(m);
  const ok=await backupAndTrackSync(m);
  refreshSyncStatusUI();hideSaveOverlay();
  if(ok)showToast('バックアップ完了',m.basic.lotNo||'');
  else showToast('バックアップ失敗',`${m.basic.lotNo||''} / ${m.syncState?.lastError||''}（未同期として記録し、後で再送できます）`,7000);
 }catch(e){hideSaveOverlay();alert('バックアップ失敗: '+e.message)}
};
$('#discard').onclick=async()=>{if(await confirmModal('端末内の測定データを削除しますか？')){await reliableDelete(S.measure.id);await refreshDraftCount();$('#measureModal').hidden=true;WL.refreshScheduleIfOpen?.()}};
$('#ngLot').onclick=registerNg;
{const btn=$('#recordSyncNowBtn');if(btn)btn.onclick=()=>syncPendingRecords({silent:false})}
/* 測定画面はスケジュール画面の上に重なって開く。閉じたときに下の
   スケジュールを描き直さないと、作業を始めた/終えた結果が反映されないまま
   前の並びが残る(キャッシュを捨てるだけでは、既に描かれている行は変わらない)。 */
async function closeMeasureModal(){
 if(measureDirty&&!(await confirmModal('保存されていない変更があります。破棄して閉じますか？')))return;
 $('#measureModal').hidden=true;
 WL.refreshScheduleIfOpen?.();
}
$('#closeModal').onclick=closeMeasureModal;$('.shade').onclick=closeMeasureModal;
/* 編集中データ一覧と完了データ一覧は1つの統合リストとして表示する。
   statuses.editing/doneはそれぞれ独立したトグルで、両方ONにすると
   編集中＋完了を同時に確認できる。既定は編集中のみON。 */
/* notice/emptyHtml/sourceNote は**この一覧を開いた側が入れる説明文**(§9.107)。
   編集モード以外でここを開くと、読めるのは共有された閲覧用データだけで、
   この端末のIndexedDBにある編集中データは開けない。そのとき
   「表示できるデータがありません」とだけ出すと**データが無い**と誤読される
   (スケジュールモードで「データがあるのに見えない」と実機から報告された)。
   一覧の描画はここが1箇所で持ち続け、**理由の文言は開いた側(access-mode.js)
   から受け取る**——モードの判定・権限の有無はあちらが持っているため。 */
let recordListState={statuses:{editing:true,done:false},items:[],query:'',sort:'updated-desc',
 notice:'',emptyHtml:'',sourceNote:''};
/* 編集モードの経路(openRecords)へ戻ったときに、閲覧モードで入れた説明が
   残っていると嘘になる。開き直すたびに必ず消す。 */
function clearRecordListNotice(){recordListState.notice='';recordListState.emptyHtml='';recordListState.sourceNote=''}
function recordMatchesStatusFilter(x){const done=x.status==='完了';return done?!!recordListState.statuses?.done:!!recordListState.statuses?.editing}
function recordSearchText(x){return [x.basic?.lotNo,x.basic?.inspectionNo,x.basic?.castingNo,x.basic?.equipment,x.settings?.registeredEquipment,x.registeredEquipment,x.status].map(v=>String(v||'').normalize('NFKC').toLowerCase()).join(' ')}
function sortedFilteredRecords(){let items=recordListState.items.filter(x=>recordMatchesStatusFilter(x)&&recordSearchText(x).includes(recordListState.query.normalize('NFKC').toLowerCase()));items=[...items];if(recordListState.sort==='updated-asc')items.sort((a,b)=>String(a.updatedAt||'').localeCompare(String(b.updatedAt||'')));else if(recordListState.sort==='lot-asc')items.sort((a,b)=>String(a.basic?.lotNo||'').localeCompare(String(b.basic?.lotNo||''),'ja'));else items.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));return items}
/* statusは呼び出し元からの既定プリセット('編集中'/'履歴')。省略時、あるいは
   トグル操作後の再読込時は直前のトグル状態(recordListState.statuses)を
   維持する。 */
function updateRecordListTitle(){
 // 見出しはヘッダーだけが持つ(パネル側の見出しは廃止)。絞り込みの切替に
 // 追随させたいのはこのヘッダー表示のほう。
 if(!document.body.classList.contains('rec-mode'))return;
 const st=recordListState.statuses||{};
 // 副題は「どこのデータを見ているか」。閲覧用バックアップを見ている間も
 // 「この端末に保存された測定データ」と出すと、見えない理由が分からなくなる。
 setHeaderContext(st.editing&&st.done?'データ一覧（編集中＋完了）':st.done?'完了データ一覧':'編集中データ一覧',
  recordListState.sourceNote||'この端末に保存された測定データ');
}
function syncStatusFilterButtons(){
 const st=recordListState.statuses||{};
 document.querySelectorAll('.status-filter-btn').forEach(b=>b.classList.toggle('active',!!st[b.dataset.statusFilter]));
}
/* ---------- 端末内＋共有DB のマージ(§9.91) ----------
   データ一覧は長らく端末内(IndexedDB+localStorageミラー)だけを読んでいた。
   そのため**別のPCで測っている途中のロットが一覧に出ず**、続きを引き継げ
   なかった。共有DB(records.sqlite3)の見出しだけを重ねて出し、中身は
   開くときに1件だけ取りに行く(全件のペイロードを毎回運ばないため)。

   同じIDが両方にあるときは**更新日時の新しいほうを採る**。共有側だけに
   あるものは`remoteOnly`の印を付け、一覧では「別のPC」として見せる。
   **共有側が読めなくても一覧は端末内のぶんで必ず出す**(fail-open)。 */
async function mergedRecords(){
 const local=(await reliableAll()).map(ensureMeasureShape);
 let remote=[];
 try{
  const r=await api('/api/measurement/backup/summary');
  remote=(r&&r.items)||[];
 }catch(e){/* 共有が読めなくても端末内のぶんは出す */}
 if(!remote.length)return local;
 const byId=new Map(local.map(x=>[x.id,x]));
 const newer=(a,b)=>String(a||'')>String(b||'');
 for(const row of remote){
  const mine=byId.get(row.id);
  if(mine){
   // 共有側のほうが新しければ、一覧では共有側の更新日時と状態で見せる
   // (中身は開くときに取り込む)。
   if(newer(row.updated_at,mine.updatedAt)){
    mine.remoteNewer=true;mine.remoteUpdatedAt=row.updated_at;
    mine.remoteEquipment=row.equipment||'';
   }
   continue;
  }
  byId.set(row.id,ensureMeasureShape({
   id:row.id,status:row.status||'編集中',updatedAt:row.updated_at||'',
   basic:{lotNo:row.lotNo||'',inspectionNo:row.inspectionNo||'',castingNo:row.castingNo||''},
   registeredEquipment:row.equipment||'',
   remoteOnly:true,remoteCodec:row.codec||'',
   syncState:{status:'synced'},
  }));
 }
 return [...byId.values()];
}
/* 共有DBにしか無い1件を、この端末へ取り込む。取り込んでから開く
   (取り込まないと編集の保存先が無い)。 */
async function importRemoteRecord(id){
 const r=await api('/api/measurement/backup/get?id='+encodeURIComponent(id));
 const item=r&&r.item;
 if(!item)throw Error('共有データに見つかりませんでした。');
 if(item.codec!=='json-full-v32')
  throw Error(`この形式(${item.codec||'不明'})は取り込めません。`);
 const m=ensureMeasureShape(decodePayload(item.payload));
 m.id=item.id;
 await reliablePut(m);
 return m;
}
window.importRemoteRecord=importRemoteRecord;
async function refreshRecordList(){
 recordListState.items=await mergedRecords();
 renderRecordListRows();
}
async function openRecords(status){
 clearRecordListNotice();
 if(status==='編集中')recordListState.statuses={editing:true,done:false};
 else if(status==='履歴')recordListState.statuses={editing:false,done:true};
 else if(!recordListState.statuses)recordListState.statuses={editing:true,done:false};
 /* 列の設定（§9.162）と読み替えルールを先に読む。**描いてから読むと、
    一度既定の15列で出てから組み替わる**（ちらつくうえ、設定が効いて
    いないように見える）。読めなくても既定の形で一覧は出す。 */
 await Promise.all([
  WL.columnLayout.load(RECORD_LIST_TARGET).catch(()=>{}),
  WL.displayRules.load().catch(()=>{}),
 ]);
 const allRecords=await mergedRecords();
 recordListState.items=allRecords;recordListState.query='';recordListState.sort='updated-desc';
 // 未同期件数の表示にも今読んだ配列を渡す(渡さないと全件読みがもう1回走る)
 updateRecordListTitle();syncStatusFilterButtons();$('#recordModal').hidden=false;refreshSyncStatusUI(allRecords);
 setHeaderContext('データ一覧','この端末と共有DBの測定データ');
 const search=$('#recordSearch'),sort=$('#recordSort'),clear=$('#clearRecordSearch');if(search){search.value='';search.oninput=()=>{recordListState.query=search.value;renderRecordListRows()}}if(sort){sort.value='updated-desc';sort.onchange=()=>{recordListState.sort=sort.value;renderRecordListRows()}}if(clear)clear.onclick=()=>{recordListState.query='';if(search)search.value='';renderRecordListRows()};
 bindRecordColumnsBtn();
 renderRecordListRows();requestAnimationFrame(()=>search?.focus())
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
 if(!(await confirmModal(`このデータ(${x.basic?.lotNo||x.id})はすでに完了しています。\n再編集すると「編集中」の状態に戻り、内容を変更できるようになります。\nよろしいですか？`)))return false;
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
  /* 他のPCで保存された続き(§9.91)。**開く前にこの端末へ取り込む**
     ——取り込まないと編集した内容の保存先が無い。共有側のほうが新しい
     場合も同じで、古い手元の内容で上書きしてしまわないよう取り直す。 */
  if(x.remoteOnly||x.remoteNewer){
   showWaiting('別のPCで保存された内容を取り込んでいます',
     `ロット ${x.basic?.lotNo||x.id}`,'共有データベースから取得しています');
   await nextPaint();
   try{
    x=await importRemoteRecord(x.id);
    showToast('別のPCの続きを取り込みました',String(x.basic?.lotNo||x.id),4000);
   }catch(e){
    hideSaveOverlay();
    showToast('取り込めませんでした',e?.message||String(e),8000);return;
   }
  }
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
/* 削除確認: 何も入力がないデータ以外は、汎用confirm()ではなく共通確認モーダル
   (confirmModal)でロット情報を示した上でしっかり警告する。 */
function confirmDeleteRecord(x){
 const summary=`<div class="delete-confirm-summary"><div class="delete-confirm-row"><span>ロット番号</span><b>${esc(x.basic?.lotNo||x.id)}</b></div><div class="delete-confirm-row"><span>状態</span><b>${esc(x.status||'編集中')}</b></div><div class="delete-confirm-row"><span>検査番号</span><b>${esc(x.basic?.inspectionNo||'-')}</b></div><div class="delete-confirm-row"><span>更新日時</span><b>${esc(x.updatedAt?new Date(x.updatedAt).toLocaleString('ja-JP'):'-')}</b></div></div><p class="delete-confirm-warning">入力済みの測定データも含め、この端末内のデータを完全に削除します。この操作は取り消せません。</p>`;
 return confirmModal({eyebrow:'DELETE CONFIRMATION',title:'端末内データを削除しますか？',bodyHtml:summary,confirmLabel:'削除する',danger:true});
}
/* 分割(条割変更)が実際に行われたかどうか: splitGroupsが2ロット以上に
   分かれている場合のみ「分割あり」とする(単一ロットのデフォルト値は分割なし扱い)。 */
function recordSplitLabel(x){return Array.isArray(x.settings?.splitGroups)&&x.settings.splitGroups.length>1?'あり':'-'}

/* ============================================================
   データ一覧の列（§9.162）
   ------------------------------------------------------------
   **列の設定は仕掛一覧・タイムラインの内容欄と同じパネルで触る**
   （§9.120の差し替え口）。設定画面を新しく作らない——覚えることが2倍に
   なり、片方にしか無い機能ができる。並び・出す/出さない・幅・表示名・
   書式・読み替え・計算式は、すべて**列レイアウトマスタ**（対象
   `records:list`）に乗る。

   列の鍵は**画面に出ている日本語の項目名**にする（仕掛一覧と同じ作法）。
   英字のキーにすると、計算式が`[lotNo]`のようになって書いた本人以外に
   読めない。**同じ名前を2つ作らないこと**（§9.113。列は名前で引く）。

   既定で出す15列と並びは**今までと同じ**。残り28列は候補として並ぶだけ
   なので、設定を保存していない端末の見え方は1つも変わらない。
   ============================================================ */
const RECORD_LIST_TARGET='records:list';
const RECORD_COL_ACTIONS='__actions__';
/* 日付時刻は**その端末の時計の値**を`yyyy-MM-dd HH:mm:ss`にしてから渡す。
   保存値はISO（末尾Z＝協定世界時）なので、生のまま書式へ渡すと時差のぶん
   ずれた時刻が出る。ここで地方時へ寄せておけば、書式・読み替えのどちらも
   画面に出ている時刻そのものを見られる。 */
function recordLocalStamp(v){
 if(!v)return '';
 const d=new Date(v);
 if(Number.isNaN(d.getTime()))return String(v);
 const p=n=>String(n).padStart(2,'0');
 return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} `
      +`${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const RECORD_DT_FORMAT={kind:'datetime',pattern:'yyyy/MM/dd HH:mm:ss'};
/* 1行＝1列。
     k     …列の名前（＝鍵）           def  …既定で出すか
     track …自動のときの幅（CSSの1マス） get  …生の値（書式・読み替えはこれに当たる）
     fmt   …既定の書式（利用者が指定したらそちらが勝つ）
     cell  …生の値だけでは足りない列の描き方   note …出どころ・作り方の一言 */
const RECORD_COLUMNS=[
 {k:'状態',k2:'status',def:1,track:'minmax(168px,.5fr)',cell:'status',
  get:x=>statusLabel(x.status),short:x=>statusShortLabel(x.status),
  note:'未同期・別のPCの印もこの列に出ます（この列を消すと印も出ません）。'},
 {k:'ロット番号',def:1,track:'minmax(104px,1fr)',cell:'lot',cls:'primary',
  get:x=>x.basic?.lotNo||x.id,note:'押すとLotDspをこのロット番号で開きます。'},
 {k:'検査番号',def:1,track:'minmax(78px,.7fr)',get:x=>x.basic?.inspectionNo},
 {k:'製造材質',def:1,track:'minmax(72px,.7fr)',get:x=>x.basic?.mfgMaterial},
 {k:'製造板厚',def:1,track:'minmax(68px,.6fr)',cls:'secondary',
  get:x=>x.basic?.mfgThickness,fmt:{kind:'number',decimals:3}},
 {k:'用途名',def:1,track:'minmax(84px,1fr)',cls:'secondary',get:x=>x.basic?.purposeName},
 {k:'コース',def:1,track:'minmax(84px,.9fr)',cls:'secondary',origin:'calc',
  get:x=>x.basic?.residualCourse||x.basic?.course||x.basic?.designCourse,
  note:'残仕掛→実績→設計の順に、値のあるものを出します（3つとも別の列として選べます）。'},
 {k:'オペレータ',def:1,track:'minmax(78px,.8fr)',cls:'secondary',get:x=>x.settings?.operator},
 {k:'検査員',def:1,track:'minmax(70px,.7fr)',cls:'secondary',get:x=>x.settings?.inspector},
 {k:'作業人数',def:1,track:'minmax(68px,.4fr)',cls:'secondary',
  get:x=>{const v=x.settings?.crewSize;return v&&v!=='-'?v:''},fmt:{kind:'text',suffix:'名'}},
 {k:'分割',def:1,track:'minmax(58px,.4fr)',cls:'secondary',origin:'calc',
  get:x=>recordSplitLabel(x)==='あり'?'あり':'',note:'子ロットが2つ以上あるとき「あり」。'},
 {k:'作業開始時刻',def:1,track:'minmax(160px,0)',tag:'time',
  get:x=>recordLocalStamp(x.workTime?.startAt),fmt:RECORD_DT_FORMAT},
 {k:'更新日時',def:1,track:'minmax(160px,0)',tag:'time',
  get:x=>recordLocalStamp(x.updatedAt),fmt:RECORD_DT_FORMAT},
 {k:'実作業時間',def:1,track:'minmax(84px,.5fr)',cls:'record-duration',origin:'calc',
  get:x=>{const ms=durationMs(x);return ms==null?'':formatDuration(ms)},
  note:'作業開始時刻と終了時刻の差。どちらかが未記録なら空欄です。'},
 /* ---- ここから下は既定で出さない候補 ---- */
 {k:'作業終了時刻',track:'minmax(160px,0)',tag:'time',
  get:x=>recordLocalStamp(x.workTime?.endAt),fmt:RECORD_DT_FORMAT},
 {k:'鋳造番号',get:x=>x.basic?.castingNo},
 {k:'引当番号',get:x=>x.basic?.allocationNo},
 {k:'オーダー番号',get:x=>x.basic?.orderNo},
 {k:'オーダー材質',get:x=>x.basic?.orderMaterial},
 {k:'オーダー調質',get:x=>x.basic?.orderTemper},
 {k:'オーダー板厚',get:x=>x.basic?.orderThickness},
 {k:'オーダー板幅',get:x=>x.basic?.orderWidth},
 {k:'オーダー板丈',get:x=>x.basic?.orderLength},
 {k:'製造調質',get:x=>x.basic?.mfgTemper},
 {k:'製造板幅',get:x=>x.basic?.mfgWidth},
 {k:'製造板丈',get:x=>x.basic?.mfgLength},
 {k:'用途コード',get:x=>x.basic?.purposeCode},
 {k:'取引先',track:'minmax(96px,1fr)',get:x=>x.basic?.customer},
 {k:'納入先',track:'minmax(96px,1fr)',get:x=>x.basic?.delivery},
 {k:'設計_設備ｺｰｽ',get:x=>x.basic?.designCourse},
 {k:'実績_設備ｺｰｽ',get:x=>x.basic?.course},
 {k:'残仕掛設備ｺｰｽ',get:x=>x.basic?.residualCourse},
 {k:'BOX設計_設備名',get:x=>x.basic?.equipment},
 {k:'BOX実績_板幅',get:x=>x.basic?.originalWidth},
 {k:'BOX設計_横割数',get:x=>x.basic?.boxHorizontalCount},
 {k:'BOX設計_縦割数',get:x=>x.basic?.boxVerticalCount},
 {k:'使用設備',track:'minmax(96px,.8fr)',
  get:x=>x.registeredEquipment||x.settings?.registeredEquipment||'',
  note:'測定したPCに登録されている設備名です（仕掛データの設備ではありません）。'},
 {k:'入力内容',track:'minmax(120px,.8fr)',get:x=>x.settings?.measureType},
 {k:'条数（設定）',get:x=>x.settings?.horizontalCount,
  note:'測定画面の①準備で決めた条数です。'},
 {k:'NG回数',get:x=>{const n=Number(x.settings?.ngCount||0);return n>0?String(n):''},
  fmt:{kind:'text',suffix:'回'}},
 {k:'同期',origin:'calc',get:x=>(x.syncState?.status==='synced'?'送信済み':'未送信'),
  note:'バックアップDB（db/records.sqlite3）へ送れているかです。'},
 {k:'データID',track:'minmax(150px,0)',get:x=>x.id,
  note:'この測定データの内部の識別子です。'},
];
const RECORD_COL_BY_KEY=new Map(RECORD_COLUMNS.map(c=>[c.k,c]));
/* 値を持たない列。仕掛一覧の`#`・ボタン列と同じ扱い。 */
const RECORD_VIRTUAL={
 '#':{label:'#（行番号）',head:'#',note:'絞り込んだあとの並びで数えた番号です。'},
 [RECORD_COL_ACTIONS]:{label:'操作',note:'開く・帳票・削除のボタン。消すと、この一覧からは削除できなくなります（開くのは行のダブルクリックでできます）。'},
};
const RECORD_VIRTUAL_TRACK={'#':'minmax(44px,0)',[RECORD_COL_ACTIONS]:'minmax(232px,0)'};
/* 既定の並びと、既定で出す列。**今までの15列がそのまま既定**。 */
const RECORD_DEFAULT_ORDER=['#',...RECORD_COLUMNS.map(c=>c.k),RECORD_COL_ACTIONS];
const RECORD_DEFAULT_VISIBLE=new Set([...RECORD_COLUMNS.filter(c=>c.def).map(c=>c.k),
                                      RECORD_COL_ACTIONS]);

/* 候補の全列。**同じ名前を2つ並べない**（§9.113）ので、ここで1回だけ落とす。 */
function recordAllColumnKeys(){
 const l=WL.columnLayout.get(RECORD_LIST_TARGET),seen=new Set(),out=[];
 const known=k=>RECORD_COL_BY_KEY.has(k)||!!RECORD_VIRTUAL[k]||!!(l.formulas||{})[k];
 const push=k=>{if(k&&!seen.has(k)){seen.add(k);out.push(k)}};
 (l.order||[]).forEach(k=>{if(known(k))push(k)});
 RECORD_DEFAULT_ORDER.forEach(push);
 Object.keys(l.formulas||{}).forEach(push);
 return out;
}
/* **一度も保存していない端末の「隠す列」**。列レイアウトマスタのhiddenは
   空なので、そのまま使うと候補44列が全部出る。判定は
   ①一覧（recordVisibleColumnKeys）②設定パネル（initialHidden）
   ③見出しから初めて保存する瞬間（recordPersistColumns）の3箇所が見るので、
   **1つの関数が答える**——別々に書くと、幅を1回引いただけで見覚えの無い
   29列が並ぶ、という形でずれが出る。 */
function recordInitialHidden(keys,l){
 const v=l||WL.columnLayout.get(RECORD_LIST_TARGET);
 return (v.order||[]).length?(v.hidden||[])
        :(keys||recordAllColumnKeys()).filter(k=>!RECORD_DEFAULT_VISIBLE.has(k));
}
/* いま出す列。**一度も保存していない端末は既定の15列**。 */
function recordVisibleColumnKeys(){
 const l=WL.columnLayout.get(RECORD_LIST_TARGET),keys=recordAllColumnKeys();
 const hide=new Set(recordInitialHidden(keys,l));
 return keys.filter(k=>!hide.has(k));
}
/* いま画面に出ている見出しの幅。設定パネル（幅を「手で決める/固定」へ
   切り替えるときの初期値）と右クリックメニュー（いまの幅で固定する）の
   両方が同じものを見る。 */
function recordHeadCellWidth(k){
 const el=document.querySelector(`#recordList .record-list-head [data-col="${CSS.escape(k)}"]`);
 return el?el.getBoundingClientRect().width:0;
}
/* 見出しからの保存（列幅・右クリックメニュー）。
   **保存は全置換なので、渡す設定を1つでも書き漏らさない**（§9.113）。
   `hidden`は`recordInitialHidden()`を通す——並びを初めて保存する瞬間に
   種まきしないと、次の描画から候補44列が全部並ぶ。 */
async function recordPersistColumns(patch){
 const cur=WL.columnLayout.get(RECORD_LIST_TARGET);
 const keys=recordAllColumnKeys();
 const known=(cur.order||[]).filter(k=>keys.includes(k));
 await WL.columnLayout.save(RECORD_LIST_TARGET,{
  order:[...known,...keys.filter(k=>!known.includes(k))],
  widths:cur.widths,hidden:recordInitialHidden(keys,cur),names:cur.names,
  formats:cur.formats,rules:cur.rules,formulas:cur.formulas,locks:cur.locks,...patch});
}
function recordColumnLabel(k){
 const n=(WL.columnLayout.get(RECORD_LIST_TARGET).names||{})[k];
 if(n)return n;
 if(RECORD_VIRTUAL[k])return RECORD_VIRTUAL[k].head||RECORD_VIRTUAL[k].label;
 return k;
}
/* CSSグリッドのトラック。引いている最中だけ、掴んだ列を実寸へ差し替える。 */
function recordTracksCss(keys,liveKey,liveWidth){
 return keys.map(k=>(k===liveKey?liveWidth+'px':recordColumnTrack(k))).join(' ');
}
/* 右クリックメニューに出す呼び名。見出しは狭いので`#`のような短い字を
   使うが、メニューでは「#（行番号）」のように何の列かが分かる側を出す。 */
function recordColumnFullLabel(k){
 const n=(WL.columnLayout.get(RECORD_LIST_TARGET).names||{})[k];
 if(n)return n;
 return RECORD_VIRTUAL[k]?RECORD_VIRTUAL[k].label:k;
}
function recordColumnTrack(k){
 const w=WL.columnLayout.width(RECORD_LIST_TARGET,k);
 if(w)return w+'px';
 const c=RECORD_COL_BY_KEY.get(k);
 return (c&&c.track)||RECORD_VIRTUAL_TRACK[k]||'minmax(96px,.7fr)';
}
/* 1件を「列名→生の値」の平らな形にする。計算式もこの形の上で動くので、
   式は`[製造板厚] * 2`のように**画面に出ている項目名**で書ける。 */
function recordRowView(x,index){
 const v={};
 RECORD_COLUMNS.forEach(c=>{v[c.k]=c.get(x)});
 if(index!=null)v['#']=String(index+1);
 return v;
}
/* 1セルの文字。**読み替え→書式→生の値**の順は一覧と同じ関数が持つ。
   利用者が書式を指定していないときだけ、列が持つ既定の書式を使う。 */
function recordCellText(k,raw,view){
 const fmt=WL.columnLayout.format(RECORD_LIST_TARGET,k);
 const rule=WL.columnLayout.rule(RECORD_LIST_TARGET,k);
 const c=RECORD_COL_BY_KEY.get(k);
 return WL.cellFormat.cell({raw,format:fmt||(c&&c.fmt)||null,rule,row:view,column:k});
}

function renderRecordListRows(){
 const list=$('#recordList'),items=sortedFilteredRecords();
 if(!list)return;
 const currentLot=normalizedLot(S.current?pick(S.current,'lotNo'):'');
 const keys=recordVisibleColumnKeys();
 const layout=WL.columnLayout.get(RECORD_LIST_TARGET);
 /* 幅は**JSがCSS変数へ入れる**。列の数と幅は設定で変わるので、
    CSSに書いておける形ではない。 */
 list.style.setProperty('--rec-cols',recordTracksCss(keys));
 /* 見出しは**掴める**（右端を引いて幅）・**右クリックできる**（列の出し入れ）。
    仕掛一覧と同じ道具をそのまま使う（§9.164）。閲覧モードは列レイアウト
    マスタへ保存できないので、取っ手ごと出さない——押せるのに何も起きない
    ものを残さない（§9.120）。 */
 const editable=recordColumnsEditable();
 const head=`<div class="record-list-head">`
  +keys.map(k=>{
    const t=recordColumnLabel(k);
    const tip=editable
     ?`${t}｜幅: ${WL.columnWidthModeLabel[WL.columnLayout.widthMode(RECORD_LIST_TARGET,k)]||''}`
      +`（右端をドラッグで変更／ダブルクリックで自動へ）｜右クリックで列の出し入れ`
     :t;
    return `<span data-col="${esc(k)}" title="${esc(tip)}">${esc(t)}`
      +(editable?'<i class="col-resize" title="ドラッグで列幅を調整（ダブルクリックで自動へ戻す）" aria-hidden="true"></i>':'')
      +'</span>';
   }).join('')
  +`</div>`;
 list.innerHTML=(recordListState.notice||'')+head;
 bindRecordHeadTools(list,keys);
 if(!items.length){
  const q=recordListState.query;
  /* 0件の理由は「絞り込みに当たらない」「そもそも読めていない」で別物
     （§9.107）。開いた側が渡した文言をそのまま出す。 */
  list.insertAdjacentHTML('beforeend',q
   ?`<div class="record-empty"><b>「${esc(q)}」に一致するデータはありません。</b><button id="recordEmptyClearSearch" type="button">検索条件を解除</button></div>`
   :(recordListState.emptyHtml||'<div class="record-empty">表示できるデータがありません。</div>'));
  const clearBtn=$('#recordEmptyClearSearch');
  if(clearBtn)clearBtn.onclick=()=>{recordListState.query='';const search=$('#recordSearch');if(search)search.value='';renderRecordListRows()};
  const empty=$('#recordSearchResult');if(empty)empty.textContent=`0 / ${recordListState.items.length}件を表示`;
  return;
 }
 /* 計算式で作った列（§9.111 ⑦）。**式が通ったものだけ**当てる。 */
 const calc=new Map();
 keys.forEach(k=>{const src=(layout.formulas||{})[k];
  if(src&&src.trim()&&WL.formula?.check(src).ok)calc.set(k,WL.formula.compile(src))});

 items.forEach((x,index)=>{
  ensureMeasureShape(x);
  const same=currentLot&&normalizedLot(x.basic?.lotNo)===currentLot;
  const row=document.createElement('article');
  const resume=resumeRecordFromList(x),isDone=x.status==='完了',isNg=x.status==='測定値NG';
  const view=recordRowView(x,index);
  const syncSt=x.syncState?.status||'pending';
  const syncBadge=syncSt==='synced'?'':`<span class="record-sync-badge record-sync-${syncSt}" title="${syncSt==='failed'?'バックアップDBへの送信に失敗しました: '+esc(x.syncState?.lastError||''):'バックアップDBへまだ送信していません'}">未同期</span>`;
  /* 他のPCで保存されたもの(§9.91)。開くとこの端末へ取り込む。 */
  const remoteBadge=x.remoteOnly?`<span class="record-remote-badge" title="別のPC(${esc(x.registeredEquipment||'設備不明')})で保存された内容です。開くとこの端末へ取り込みます。">別のPC</span>`
    :x.remoteNewer?`<span class="record-remote-badge is-newer" title="別のPCでこの端末より新しく保存されています(${esc(x.remoteUpdatedAt||'')})。開くとそちらの内容を取り込みます。">新しい版あり</span>`:'';
  row.className='record-list-row'+(same?' is-same-lot':'');
  row.tabIndex=0;
  /* 列幅を決め打ちする以上、**入り切らない値には生の値のtitleを必ず付ける**
     （§9.94の一覧と同じ約束）。付けないと、切れた値はどこからも読めない。 */
  row.innerHTML=keys.map(k=>{
   if(k===RECORD_COL_ACTIONS)
    return `<div class="record-list-actions"><button class="resume" type="button">${isDone?'内容を開く':'続きから再開'}</button><button class="report" type="button" title="このロットの帳票プレビューを開きます">帳票</button><button class="danger" type="button">削除</button></div>`;
   const c=RECORD_COL_BY_KEY.get(k);
   const fx=calc.get(k);
   const raw=fx?fx.run(view):(k==='#'?view['#']:(c?c.get(x):''));
   const out=recordCellText(k,raw,view);
   const noSetting=!WL.columnLayout.format(RECORD_LIST_TARGET,k)&&!WL.columnLayout.rule(RECORD_LIST_TARGET,k);
   const text=(noSetting&&c&&c.short)?c.short(x):out.text;
   const shown=String(text??'').trim()||'-';
   const cls=['record-list-cell',c&&c.cls,out.color?'cell-'+out.color:''].filter(Boolean).join(' ');
   if(c&&c.cell==='status')
    return `<div class="${cls}"><span class="rp-status-badge${statusClass(x.status)?' '+statusClass(x.status):''}" title="${isNg?'NG回数 '+(x.settings?.ngCount||0)+'回':esc(statusLabel(x.status))}">${esc(shown)}</span>${syncBadge}${remoteBadge}</div>`;
   if(c&&c.cell==='lot')
    return `<div class="${cls}"><button type="button" class="lot-dsp-link grid-lot-link" title="${esc(shown)} ／ クリックでLotDspをこのロット番号で開きます">${esc(shown)}</button></div>`;
   const inner=(c&&c.tag==='time')?`<time>${esc(shown)}</time>`:esc(shown);
   return `<div class="${cls}" data-col="${esc(k)}" title="${esc(shown)}">${inner}</div>`;
  }).join('');
  /* **操作の列は消せる**ので、ボタンが在るときだけ配線する（§9.105と同じ
     約束で、消しても行のダブルクリック・Enterでは開ける）。 */
  const resumeBtn=row.querySelector('.resume');
  if(resumeBtn)resumeBtn.onclick=e=>{e.stopPropagation();resume()};
  const reportBtn=row.querySelector('.report');
  if(reportBtn)reportBtn.onclick=e=>{e.stopPropagation();if(typeof openReportForRecord==='function')openReportForRecord(x.id)};
  const recLotBtn=row.querySelector('.grid-lot-link');
  if(recLotBtn)recLotBtn.onclick=e=>{e.preventDefault();e.stopPropagation();openLotDsp(x.basic?.lotNo,x.basic?.castingNo,localStorage.getItem('LotDspLastTabV1')||'1')};
  // ダブルクリックは編集再開ではなく帳票プレビューへの遷移とする(編集は「続きから再開/内容を開く」ボタンから明示的に行う)。
  row.ondblclick=e=>{if(!e.target.closest('.danger')&&!e.target.closest('.resume')&&!e.target.closest('.report')&&!e.target.closest('.grid-lot-link')&&typeof openReportForRecord==='function')openReportForRecord(x.id)};
  row.setAttribute('role','button');
  row.setAttribute('aria-label',(isDone?'内容を開く':'続きから再開')+' '+(x.basic?.lotNo||x.id));
  row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){if(e.key===' ')e.preventDefault();resume()}};
  const delBtn=row.querySelector('.danger');
  if(delBtn)delBtn.onclick=async e=>{e.stopPropagation();
   /* 他のPCにしか無いものは、この画面からは消さない(§9.91)。手元に中身が
      無いまま消すと、まだ測っている端末の作業を巻き添えにする。 */
   if(x.remoteOnly){showToast('この端末には無いデータです','別のPCで保存された内容です。消す場合はそのPCから操作してください。',6000);return}
   const proceed=recordHasAnyInput(x)?await confirmDeleteRecord(x):true;
   if(proceed){await reliableDelete(x.id);await refreshDraftCount();await refreshRecordList()}};
  list.append(row);
 });
 const result=$('#recordSearchResult');
 if(result)result.textContent=`${items.length} / ${recordListState.items.length}件を表示`;
}

/* 列の設定を触れるか。**判定は1箇所**——ボタン・取っ手・右クリックの
   3つが別々に判定すると、どれかだけ残って「押せるのに保存できない」に
   なる（§9.162で入れた約束をそのまま使う）。 */
function recordColumnsEditable(){return (window.accessMode?.mode||'edit')!=='view'}
/* ---------- 見出しの操作（列幅・右クリックメニュー。§9.164） ----------
   仕掛一覧と**同じ関数**を呼ぶ（`WL.columnWidthGrip`／`WL.openColumnHeaderMenu`）。
   この一覧に固有なのは「幅の当て方」だけ——表はcolgroupの`<col>`だが、
   ここはCSSグリッドなので`--rec-cols`を組み直す。 */
function recordHeadMenuSource(){
 return {
  keys:recordAllColumnKeys,
  label:recordColumnFullLabel,
  currentWidthOf:recordHeadCellWidth,
  refresh:renderRecordListRows,
  openPanel:openRecordColumnPanel,
  /* 保存はこちらが持つ（初回の隠す列の種まきがあるため）。 */
  persist:recordPersistColumns,
 };
}
function bindRecordHeadTools(list,keys){
 if(!recordColumnsEditable())return;
 if(typeof WL.columnWidthGrip!=='function'||typeof WL.openColumnHeaderMenu!=='function'){
  console.error('データ一覧の見出し操作: WL.columnWidthGrip / WL.openColumnHeaderMenu が見つかりません');return;
 }
 list.querySelectorAll('.record-list-head [data-col]').forEach(el=>{
  const k=el.dataset.col;
  WL.columnWidthGrip(el.querySelector('.col-resize'),{
   locked:WL.columnLayout.locked(RECORD_LIST_TARGET,k),
   startWidth:()=>el.getBoundingClientRect().width,
   // 引いている最中は**保存せずに見せるだけ**（掴んだ列だけ実寸へ差し替える）
   preview:w=>list.style.setProperty('--rec-cols',recordTracksCss(keys,k,w)),
   commit:w=>{
    const cur=WL.columnLayout.get(RECORD_LIST_TARGET);
    recordPersistColumns({widths:{...(cur.widths||{}),[k]:w}});
    renderRecordListRows();
   },
   reset:()=>{
    const widths={...(WL.columnLayout.get(RECORD_LIST_TARGET).widths||{})};delete widths[k];
    /* **固定も一緒に解く**（§9.119）。幅を持たない「固定」は動かしようが
       無いので、残すと「固定と出ているのに何も効いていない」列になる。 */
    const locks=(WL.columnLayout.get(RECORD_LIST_TARGET).locks||[]).filter(x=>x!==k);
    recordPersistColumns({widths,locks});
    renderRecordListRows();
   },
  });
  el.addEventListener('contextmenu',e=>{
   e.preventDefault();e.stopPropagation();
   WL.openColumnHeaderMenu(e,k,RECORD_LIST_TARGET,null,recordHeadMenuSource());
  });
 });
}

/* ---------- 列の設定を開く（§9.162。仕掛一覧と同じパネル） ---------- */
function recordColumnPanelSource(){
 return {
  key:'records',
  eyebrow:'データ一覧',
  title:()=>'表示列の設定（データ一覧）',
  lead:'左で<b>出す列と並び</b>を決め、右で<b>選んだ1列の見え方</b>を整えます。'
      +'触った結果はすぐ一覧に出ます（<b>保存するまでは元に戻せます</b>）。',
  target:()=>RECORD_LIST_TARGET,
  savedToast:'データ一覧の表示列を保存しました',
  savedNote:'次に開いたときも同じ形で出ます',
  keys:()=>recordAllColumnKeys(),
  /* 番号・ボタンの列を本来の位置へ戻す仕掛け（§9.110）は要らない
     ——この一覧の並びは最初から番号・ボタンを含めて1本で持っている。 */
  healed:()=>null,
  /* **一度も保存していないうちは既定の15列だけをチェック済みにする**。
     列レイアウトマスタのhiddenは空なので、そのまま使うと候補43列が
     全部チェック済みになり、保存した瞬間に見覚えの無い列が並ぶ。 */
  initialHidden:(keys,l)=>recordInitialHidden(keys,l),
  rows:()=>sortedFilteredRecords().slice(0,40).map((x,i)=>recordRowView(x,i)),
  valueOf:(row,k)=>row?row[k]:undefined,
  virtual:()=>RECORD_VIRTUAL,
  joined:()=>new Set(),
  joinFrom:()=>'',
  /* 出どころは2つで足りる。この一覧の行は測定データそのものなので、
     持っている値は全部「元データ」で、状態から作る分割・実作業時間
     だけが「計算・操作」。**結合は無い**ので分類ごと出さない（§9.105）。 */
  origins:()=>['source','calc'],
  originOf:k=>(RECORD_COL_BY_KEY.get(k)||{}).origin||'source',
  noteOf:k=>(RECORD_COL_BY_KEY.get(k)||{}).note||'',
  currentWidthOf:recordHeadCellWidth,
  features:{formula:true,preset:true,width:true,format:true,rule:true},
  afterApply:()=>{if(!$('#recordModal')?.hidden)renderRecordListRows()},
  save:null,
 };
}
/* **閲覧モードでは出さない**（§9.120「使えない機能はボタンごと消す」）。
   列レイアウトマスタの保存は edit / schedule にしか開いていないので、
   閲覧モードで開くと「保存」だけが403で弾かれる——押せるのに何も
   起きないボタンは、無い機能より質が悪い。 */
function bindRecordColumnsBtn(){
 const btn=$('#recordColumnsBtn');if(!btn)return;
 btn.hidden=!recordColumnsEditable();
 btn.onclick=()=>openRecordColumnPanel();
}
function openRecordColumnPanel(){
 if(typeof WL.listColumns?.open!=='function'){
  console.error('データ一覧の表示列: WL.listColumns が見つかりません');return;
 }
 WL.listColumns.open(recordColumnPanelSource());
}
/* この一覧を閉じるときはパネルも閉じる。**開いていなければ触らない**
   ——他の画面で同じパネルを開いている最中に閉じてしまわないため。 */
function closeRecordColumnPanel(){
 const p=document.getElementById('listColumnPanel');
 if(p&&!p.hidden&&typeof WL.listColumns?.close==='function')WL.listColumns.close();
}
window.WL=window.WL||{};
WL.recordColumns={open:openRecordColumnPanel,close:closeRecordColumnPanel,bind:bindRecordColumnsBtn,
                  target:RECORD_LIST_TARGET,keys:recordAllColumnKeys,
                  visible:recordVisibleColumnKeys};

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
 const wrapper=document.createElement('div');wrapper.className='record-modal';wrapper.hidden=true;wrapper.id='appSettingsModal';wrapper.innerHTML=`<div class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="equipmentSettingsTitle"><header><div><h2 id="equipmentSettingsTitle">使用設備の設定</h2></div><button id="closeAppSettings" type="button" aria-label="閉じる">×</button></header><div class="settings-body"><p>この端末で測定する設備を登録します。登録設備は、仕掛データの設計コースとの照合と保存データの識別に使用します。</p><label>使用設備名<input autocomplete="off" id="configuredEquipment" placeholder="例: LS4" type="text"/></label><div class="setting-status warn" id="equipmentSettingStatus">使用設備は未登録です</div><div class="settings-actions"><button id="cancelAppSettings" type="button">キャンセル</button><button id="saveAppSettings" type="button">この設備を登録</button></div></div></div>`;
 document.body.append(wrapper);return wrapper;
}
function updateEquipmentEntryPoints(){
 const equipment=currentConfiguredEquipment(),configured=!!equipment,banner=$('#equipmentSetupBanner');
 const header=$('.hd-chip-equip'),headerName=$('#headerEquipmentName');if(header){header.classList.toggle('is-unset',!configured)}if(headerName)headerName.textContent=equipment||'未設定';
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
/* reuseExisting:trueを明示し、過去に削除された同名設備があっても常に復元する
   (従来どおりの挙動)。この入口は使用設備を選ぶだけの軽い操作のため、
   「新しい設備として登録」の選択肢はマスタ管理画面(設備タブ)側のみで扱う。 */
async function registerAndSelectEquipment(name){const result=await api('/api/equipment-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withUserId({name,reuseExisting:true}))});localStorage.setItem(APP_EQUIPMENT_KEY,result.name);await loadEquipmentMaster(true);return result}
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
// 前回サーバーへ届かなかったバックアップ削除を片付ける(§9.52)。残したままだと
// 作業スケジュールに実体の無い「作業中」が出続ける。
queueMicrotask(()=>{flushPendingBackupDeletes().catch(e=>console.warn('バックアップ削除の再試行に失敗',e))});
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
 /* サイドバーの「編集中データ」はopenRecordsSafeを通らずopenRecordsを直接
    呼ぶ経路があるため、退出処理はこの表示検知にも要る。WL.enterView('records')
    はデータ一覧自身のexit(=#recordModalを隠す)は呼ばないので、ここから
    呼んでも再入しない。 */
 const sync=()=>{
  const showing=!panel.hidden;
  document.body.classList.toggle('rec-mode',showing);
  if(showing)WL.enterView('records');
 };
 new MutationObserver(sync).observe(panel,{attributes:true,attributeFilter:['hidden']});
 sync();
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
/* 起動オーバーレイの「一覧を読み込み」はここで済む。**失敗しても進める**
   (エラー表示ごと見せる必要がある。覆ったままにしない)。 */
}).finally(()=>WL.boot.step('list'));
