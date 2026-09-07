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
 /* **見出しは1行に収める**（§9.234 ③）ので、本文は短く・数字は`title`へ。
    「出どころ・単位」（§CLAUDE 6）は`title`で残す。 */
 el.textContent='保存容量ひっ迫';
 el.title=`端末内の保存容量が残り少なくなっています（使用 ${(used/1048576).toFixed(1)}MB / 目安 ${(cap/1073741824).toFixed(1)}GB）`;
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
 return [...merged.values()].map(WL.measureView.ensureMeasureShape);
}
async function reliableGet(id){
 try{const x=await idbGet(id);if(x)return WL.measureView.ensureMeasureShape(x)}catch(e){console.warn('IndexedDB get failed, mirror used',e)}
 const x=mirrorRead()[id];return x?WL.measureView.ensureMeasureShape(x):null;
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
 catch(e){WL.quiet.note('保存できなくても削除自体は続ける',e)}
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
/* ---------- 「選べる候補」だけを当てる（§9.229 ④、利用者の指示
      「操業データの選択肢の部分のマスタを変えても、連動してくれていません」）
   ----------
   控え（`m.snapshot.context`）には**性質の違う2種類**が同居している:
     ・その時の**ロットの事実**（公差・品質情報・取引先・コース）
       …測ったときの値なので**凍らせるのが正しい**
     ・**マスタの設定**（オペレータ・機器・内径・スプール・バリ揃え・
       コイル止め・最大条数・設備区分）…**今のマスタが正しい**
   以前は再開時に控えを丸ごと当てていたので、記録を1件作ったあとは
   **選択肢マスタを何度直しても、その記録では永久に古い候補のまま**だった
   （実機で「マスタは変わっているのに連動しない」と報告）。ここを分けて、
   再開のときは候補だけ取り直す。**取れなければ控えのまま**——オフラインでも
   開けることが最優先（控えを持っている理由そのもの）。 */
function applyContextChoices(x){
 const m=S.measure;if(!m||!x)return;
 /* **選択肢を並べる前に使用回数を渡す**(§9.133)。順序が逆だと、最初の
    1回だけマスタ順のまま出て、次に開いたときから並びが変わる。 */
 WL.choiceUsage.set(x.choice_usage);
 /* **記録済みの値は候補から落とさない**。`optionFill`は候補に無い現在値を
    黙って捨てるので（§9.204）、取り直した候補にその人・その機器がもう
    居ないと、**記録が空になる**。足してから渡す（内径と同じ扱い）。 */
 const keep=(list,cur)=>{
  const out=[...(list||[])];
  const v=String(cur==null?'':cur).trim();
  if(v&&!WL.optionBlank(v)&&!out.includes(v))out.push(v);
  return out;
 };
 /* **いま画面に入っている値を落とさない**（§9.286 ⑤、利用者の指示）。
    `applyInitials()`（マスタの`[初期値]`）は**組み込みの欄では画面へ入れる
    だけで`settings`へ書かない**約束（§9.229 ③。保存は`WL.measureView.collect()`が`#<キー>`
    から拾う）なので、`settings`だけを見て候補を作り直すと**入れたばかりの
    初期値が消える**——これが「マスタで初期値を決めても効かない」の正体で、
    `-`を値として持っていたことと合わせて2つで一組の原因だった。
    記録された値があればそちらが勝つ（順番が決まっている・§9.204と同じ）。 */
 const now=id=>{const el=document.getElementById(id);return el?String(el.value||''):''};
 const cur=(id,v)=>{const s=String(v==null?'':v).trim();return WL.optionBlank(s)?now(id):s};
 const fill=(id,list,v)=>{const c=cur(id,v);optionFill(id,keep(list,c),c)};
 fill('operator',x.operators,m.settings.operator);
 fill('inspector',x.inspectors||x.operators,m.settings.inspector);
 fill('thicknessGauge',x.thickness_gauges,m.settings.thicknessGauge);
 fill('widthGauge',x.width_gauges,m.settings.widthGauge);
 /* 内径は**仕掛由来のプリセット**(§9.204)が入りうる。 */
 fill('innerDiameter',x.inner_diameters,m.settings.innerDiameter);
 fill('spool',x.spools,m.settings.spool);
 if(WL.innerDiameter)WL.innerDiameter.refresh();
 /* バリ揃え・コイル止めはマスタ化前まで画面へ直接書かれていた選択肢なので、
    マスタが空(未作成・全件無効化)でも選べる値が消えないよう既定を持つ。
    先頭の'-'は付けない——「指定なし」が既にその意味の選択肢のため。 */
 WL.optionList('burr',x.burr_types?.length?x.burr_types:['上バリ揃え','下バリ揃え','指定なし'],m.settings.burr);
 WL.optionList('coilStop',x.coil_stops?.length?x.coil_stops:['内巻両面テープ','指定なし'],m.settings.coilStop);
 /* この設備で割れる最大条数(設備マスタ)。横割数の入力上限と条割の上限確認に
    使う。取得できない場合は触らない(既定=構造上の上限40で動く)。 */
 if(Number.isFinite(Number(x.max_strips))&&Number(x.max_strips)>=1){
  m.settings.maxStrips=Math.min(40,Math.round(Number(x.max_strips)));
  if(typeof WL.measureView.applyMaxStripsToInputs==='function')WL.measureView.applyMaxStripsToInputs();
 }
 /* 設備の区分(コイル／板)。板丈の公差は板の設備でだけ意味を持つ(§9.157)。
    **未設定('')はそのまま持つ**——「板」と決め付けると、コイルの設備で
    出どころの分からない公差が並ぶ。 */
 if(typeof x.equipment_kind==='string')m.settings.equipmentKind=x.equipment_kind;
 /* **打った値を印へ届ける**——`.value`への代入では`change`が飛ばないので、
    選ばせ方を被せている欄はボタンの選択状態が古いまま残る（§9.223 ③）。 */
 if(window.WL&&WL.opData&&WL.opData.syncWidgets)WL.opData.syncWidgets();
}
/* 控えのうち**マスタの設定**にあたるもの。取り直したらここだけ差し替える。 */
const CONTEXT_CHOICE_KEYS=['choice_usage','operators','inspectors','packers',
  'thickness_gauges','width_gauges','inner_diameters','spools','burr_types',
  'coil_stops','max_strips','equipment_kind'];
/* 参照データの不足を**画面に出るところで1箇所**が覚える（§9.317）。
   記録（`S.measure`）へは入れない——`WL.measureView.collect()`が保存するので、その場限りの
   事情がロットの記録として残ってしまう。 */
function noteContextProblem(msg){
 S.measureContextError=String(msg||'');
 if(typeof WL.measureView.paintQualityInfo==='function')WL.measureView.paintQualityInfo();
}
function applyContextSnapshot(x){
 const m=S.measure;if(!m||!x)return;
 applyContextChoices(x);
 if(x.quality?.length){m.qualityInfo=qualityText(x.quality)}
 $('#qualityInfo').value=m.qualityInfo||'異常情報なし';
 /* **品質だけ読めなかった場合をここで受ける**（§9.317）。サーバーは
    測定を止めないために0件で返し、理由を`diagnostics.quality_error`へ
    残す。黙って「異常情報なし」にすると画面が嘘をつく。 */
 const qe=x.diagnostics&&x.diagnostics.quality_error;
 noteContextProblem(qe?`品質情報を読み込めませんでした（測定は続けられます）: ${qe}`:'');
 $('#masterDiagnostic').textContent=JSON.stringify(x.diagnostics||{},null,2);
}
/* 控えで開いたあと、**候補だけ**を今のマスタで取り直す（§9.229 ④）。
   **失敗は黙って捨てる**（控えのままで開けている）。**開いている記録が
   入れ替わっていたら当てない**——往復のあいだに別の記録へ移れる。 */
async function refreshContextChoices(){
 const m=S.measure;if(!m||!m.basic)return;
 const id=m.id;
 const u=new URLSearchParams({lot:m.basic.lotNo,
   equipment:currentConfiguredEquipment()||m.basic.equipment});
 try{
  const x=await api('/api/measurement/context?'+u);
  if(!S.measure||S.measure.id!==id)return;
  S.measure.snapshot=S.measure.snapshot||{};
  const snap=S.measure.snapshot.context;
  if(snap)CONTEXT_CHOICE_KEYS.forEach(k=>{if(k in x)snap[k]=x[k]});
  applyContextChoices(x);
 }catch(e){WL.quiet.note('候補を取り直せない（控えの候補で続ける）',e)}
}
/* 仕掛・品質・マスタの参照データを取得し、スナップショットとして保存データへ
   同梱する(再開時はスナップショットを優先し、オフラインでも復元できる)。 */
async function loadMeasurementContext(force=false){
 updateWaiting('仕掛・品質・マスタを取得中','公差、品質等級、取引先、コース、マスタ候補を読み込んでいます');
 const m=S.measure;if(!m)return;
 if(m.snapshot?.context&&!force){
  applyContextSnapshot(m.snapshot.context);setState('保存済み参照データを復元');
  /* **候補だけは今のマスタで上書きする**（§9.229 ④）。画面は待たせない。 */
  refreshContextChoices();
  return m.snapshot.context;
 }
 const u=new URLSearchParams({lot:m.basic.lotNo,equipment:currentConfiguredEquipment()||m.basic.equipment});
 try{
  setState('仕掛・品質・マスタ読込中');const x=await api('/api/measurement/context?'+u);
  m.snapshot=m.snapshot||{};m.snapshot.context=structuredClone(x);m.snapshot.source=structuredClone(m.source||{});m.snapshot.basic=structuredClone(m.basic||{});
  m.snapshot.loadedAt=new Date().toISOString();m.snapshot.schema='v32-full';
  applyContextSnapshot(x);setState(`初期参照データを格納済み / 品質情報 ${x.quality?.length||0}件`);return x;
 }catch(e){
  /* **参照データが読めなくても測定は始められる**（§9.317、利用者の指示
     「いずれにしても編集モードでの測定作業に影響がないようにしてほしい」）。
     以前はここで投げており、`openMeasurementCore()`の続き——**記録の初回
     保存（`reliablePut`）と共有への登録**——が丸ごと走らなかった。
     つまり共有が一瞬読めないだけで、測定そのものが始められなかった。
     **黙って続けない**（§4）——理由を画面に残し、1度だけ知らせる。 */
  setState('参照データ読込エラー');$('#masterDiagnostic').textContent=e.stack||e.message;
  noteContextProblem(`参照データを読み込めませんでした（測定は続けられます。公差・品質情報・選択肢が出ないことがあります）: ${e&&e.message||e}`);
  showToast('参照データを読み込めませんでした','測定は続けられます。公差・品質情報・選択肢が出ないことがあります。',9000);
  return null;
 }
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
 /* 「誰が・どの端末で入力を始めたか」を**列としても**渡す(§9.180)。
    ペイロードの中にも入っているが、一覧(backup/summary)はペイロードを
    開かないので、列に無いと他のPCのデータで空欄になる。
    **更新側は送らない**——保存したのはこの端末なので、サーバーが自分の
    ホスト名で埋めるほうが確か(画面が嘘を送れないようにする)。 */
 const x={id:m.id,equipment,lotNo:m.basic.lotNo,inspectionNo:m.basic.inspectionNo,castingNo:m.basic.castingNo,status:m.status,codec:'json-full-v32',payload:encodePayload(m),
          created_by:m.createdBy||'',created_pc:m.createdPc||'',created_at:m.createdAt||'',
          /* **レコード自身の更新時刻をそのまま渡す**(§9.208 ⑤)。共有側の
             [更新日時]はサーバーが押す現地時刻なので、画面の`updatedAt`
             (UTCのISO)とは物差しが違い、そのまま比べると「新しい版あり」が
             嘘になる。同じ物差しの列を1本持たせて、そちらで比べる。 */
          updated_at_iso:m.updatedAt||'',
          user_id:(typeof currentUserId==='function'&&currentUserId())||''};
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
  /* 15分ごとの自動同期（1319行）からも来る。列幅を掴んでいる最中に一覧を
     作り直すと取っ手ごと入れ替わるので待たせる（§9.211 ①）。 */
  if($('#recordModal')&&!$('#recordModal').hidden){
   if(silent)WL.columnResize.defer('records:sync',()=>{refreshRecordList().catch(WL.quiet('データ一覧を描き直せない（次に開いたときに追いつく）'))});
   else await refreshRecordList();
  }
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
/* **公差外のまま完了したことは記録に残す**（§9.319）。画面で確認しただけでは
   後から読めない——帳票にもデータ一覧にも「ふつうの完了」としか出なくなる。
   中身は`WL.measureReview.outOfTolerance()`の1箇所から作る（§9.163。③確認の
   カードと同じ数を出す。ここで数え直すと、画面と記録が食い違いうる）。
   **直したら消す**——外れていた記録が残り続けると、直した完了まで疑わせる。 */
function noteCompletedWithNg(m){
 if(!m)return;
 let ng=null;
 try{ng=window.WL&&WL.measureReview&&WL.measureReview.outOfTolerance()}catch(e){WL.quiet.note('公差外を数えられない（件数を出さないだけ）',e)}
 m.settings=m.settings||{};
 if(!ng||!ng.total){delete m.settings.completedWithNg;return}
 m.settings.completedWithNg={at:new Date().toISOString(),total:ng.total,
   items:ng.items.map(x=>({name:x.name,count:x.hits.length}))};
}
/* 保存/完了登録。**完了で止めるのはオペレータ/検査員の未選択だけ**（§9.319）。
   公差外は完了前の確認（measure-progress.js）で1回聞いてから通す。 */
async function persistAndTransition(status){
 if(await WL.measureHooks.through('persistAndTransition',status)===false)return;  // 完了前の確認（関門・§9.352）
 WL.measureView.updateValidationVisuals();
 /* **止めるのは「誰が測ったか」だけ**（§9.319、利用者の指示「測定値のエラーで
    NGがあっても測定は完了できるようにしてください」）。
    以前は公差外があると完了そのものを断っていたが、**公差外は測った事実**で
    あって入力の誤りとは限らない——外れたまま完了して次の工程へ渡す判断は
    現場のものなので、アプリが握ってはいけない（§4の「できないと書く」は
    **本当にできないとき**の話で、ここは「してよいか」の判断）。
    **止める代わりに、黙って通さない**——完了前の確認（measure-progress.js の
    ラッパー）が件数と項目を出して1回だけ聞き、通したら`completedWithNg`として
    記録に残す。オペレータ/検査員は**どの製品でも必須**なので今までどおり止める
    （誰が測ったか分からない記録は、あとから意味を持てない）。
    測定項目の未入力も止めない——必要な項目は製品の材質・用途・規格で変わる。 */
 if(status==='完了'){
  const result=WL.measureView.updateValidationVisuals();
  const identity=result.missing.filter(x=>x.el&&(x.el.id==='operator'||x.el.id==='inspector'));
  if(identity.length){WL.measureView.showValidationMessage({missing:identity,ng:[]});return}
 }
 showSaveOverlay(status==='完了'?'完了登録しています':'一時保存しています','入力内容と初期参照データを端末へ保存中');
 try{
  const m=WL.measureView.collect();m.status=status;m.updatedAt=new Date().toISOString();m.snapshot=m.snapshot||{};
  m.snapshot.source=structuredClone(m.source||{});m.snapshot.basic=structuredClone(m.basic||{});m.snapshot.savedAt=m.updatedAt;m.snapshot.schema='v32-full';
  if(status==='完了')noteCompletedWithNg(m);
  const result=await reliablePut(m);
  const accessOK=await backupAndTrackSync(m);
  if(!accessOK)console.warn('Access backup failed',m.syncState?.lastError);
  measureDirty=false;
  cancelAutoSave();
  await refreshDraftCount();refreshSyncStatusUI();$('#measureModal').hidden=true;hideSaveOverlay();
  /* **公差外のまま完了したなら、そう言う**（§9.319・§3）。「完了登録しました」
     だけだと、外れていた事実が押した瞬間に画面から消える。 */
  const withNg=(m.settings&&m.settings.completedWithNg)||null;
  showToast(status==='完了'?(withNg?`完了登録しました（公差外・基準外 ${withNg.total}件を含みます）`:'完了登録しました'):'一時保存しました',
            `${m.basic.lotNo||''} / IndexedDB ${result.idbOK?'OK':'代替保存'} / バックアップ ${accessOK?'OK':'未送信（後で自動的に再送します）'}`,6500);
  await openRecords(status==='完了'?'履歴':'編集中');
 }catch(e){hideSaveOverlay();setState('保存エラー');await alertModal('保存できませんでした: '+e.message)}
}
/* 端末内への保存。条数ロック→回収→IndexedDB保存→件数バッジ更新。
   IndexedDB単独ではなくreliablePutを使う(IndexedDB障害時もlocalStorage
   ミラーへ確実に残すため。以前はここだけidbPutを直接呼んでおり、私用
   端末のプライベートブラウジング等でIndexedDBが使えない場合にNG登録
   ("測定値NG")が無警告で失われ得た)。 */
/* 保存のあとに足す（作業時間の比較カード等）は `afterSave` へ登録（§9.352）。 */
async function saveLocal(status='編集中'){const r=await saveLocalCore(status);WL.measureHooks.run('afterSave',status,r);return r}
async function saveLocalCore(status='編集中'){
 WL.measureView.lockCounts();
 const m=WL.measureView.collect();m.status=status;m.updatedAt=new Date().toISOString();
 await reliablePut(m);measureDirty=false;
 /* **①に入った／②はこれから**を分けて書く(§9.202)。以前は
    「端末保存済み」だけで、DBへ送れているかは画面に出ていなかった。 */
 setState(status==='完了'?'完了・端末に保存（DBへ送信中）':'端末に保存（DBへ送信中）');
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
  }catch(e){WL.quiet.note('syncStateへ記録済み。ここで画面を止めない',e)}
  finally{sharing.delete(m.id);
   if(typeof refreshSyncStatusUI==='function')refreshSyncStatusUI();
   /* 送信が終わったら、開いている測定の状態欄も言い直す(§9.202)。
      **「送信中」のまま残さないこと**——終わったのか失敗したのかが
      分からないと、利用者は保存できたのかを確かめる手立てを失う。 */
   try{
    const modal=$('#measureModal');
    if(modal&&!modal.hidden&&S.measure&&S.measure.id===m.id&&!measureDirty){
     const ok=(m.syncState&&m.syncState.status)==='synced';
     const done=S.measure.status==='完了'?'完了・':'';
     setState(ok?`${done}端末＋DBに保存`:`${done}端末に保存（DBへ未送信・あとで自動再送）`);
    }
   }catch(e){WL.quiet.note('状態欄の言い直しに失敗しても保存そのものは済んでいる',e)}}
 })();
}
window.shareRecord=shareRecord;
async function registerNg(){
 try{
  const m=await saveLocal('測定値NG');m.settings.ngCount=(m.settings.ngCount||0)+1;await reliablePut(m);setState(`NGロット ${m.settings.ngCount}回目を保存`);
 }catch(e){await alertModal('NG登録を保存できませんでした: '+e.message)}
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
/* 再開のあとに足す（分割データの補完等）は `afterResumeStoredMeasure`。核が途中で
   例外を投げても走る（被せの finally と同じ）。 */
async function resumeStoredMeasure(saved,row=null){try{return await resumeStoredMeasureCore(saved,row)}finally{await WL.measureHooks.runAsync('afterResumeStoredMeasure')}}
async function resumeStoredMeasureCore(saved,row=null){S.current=row||saved.source||saved.snapshot?.source||null;S.measure=WL.measureView.ensureMeasureShape(saved);WL.measureView.renderMeasurement();$('#recordModal').hidden=true;$('#measureModal').hidden=false;requestAnimationFrame(()=>$('#deviceInput').focus());await loadMeasurementContext(false);requestAnimationFrame(()=>$('#deviceInput').focus())}
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
 const m=WL.measureView.blankMeasure(row);m.id=lotKey(row)||crypto.randomUUID();S.measure=WL.measureView.ensureMeasureShape(m);WL.measureView.renderMeasurement();$('#measureModal').hidden=false;requestAnimationFrame(()=>$('#deviceInput').focus());await loadMeasurementContext(true);
 const first=WL.measureView.collect();await reliablePut(first);
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
/* 開く前の関門（編集モードか・子ロットなら親へ読み替える）は `gate('openMeasurement')`、
   開いたあとに足すのは `afterOpenMeasurement`（途中で例外でも走る）。§9.352 */
async function openMeasurement(row){
 const gated=await WL.measureHooks.through('openMeasurement',row);
 if(gated===false)return;
 try{return await openMeasurementGated(gated[0])}
 finally{await WL.measureHooks.runAsync('afterOpenMeasurement')}
}
async function openMeasurementGated(row){
 if(!requireEquipmentBeforeMeasurement(row))return;
 const lot=pick(row,'lotNo')||'選択ロット';
 showWaiting('測定画面を準備しています',`ロット ${lot} の保存データを確認中`,'端末内の編集中データを確認しています',1);
 await nextPaint();
 let result;
 try{result=await openMeasurementCore(row)}finally{hideSaveOverlay();if(typeof WL.measureView.refreshScheduleInfo==='function')WL.measureView.refreshScheduleInfo()}
 if(S.measure){S.measure.settings=S.measure.settings||{};S.measure.settings.registeredEquipment=currentConfiguredEquipment();S.measure.registeredEquipment=currentConfiguredEquipment();updateCourseGuard()}
 return result;
}
// v32 final navigation controller
function bindV32Navigation(){
 const open=async status=>{try{await openRecords(status)}catch(e){console.error(e);await alertModal('保存データ一覧を開けません: '+e.message)}};
 [['homeDrafts','編集中']].forEach(([id,status])=>{const b=$('#'+id);if(b){b.onclick=null;b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();open(status)})}})
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
 const button=event.target.closest('[data-open-records],#homeDrafts');
 if(!button)return;
 event.preventDefault();event.stopImmediatePropagation();
 const status=button.dataset.openRecords||'編集中';
 openRecordsSafe(status);
},true);
$('#saveDraft').onclick=()=>persistAndTransition('編集中');
$('#complete').onclick=()=>persistAndTransition('完了');
/* ---------- DBへは裏で書く（§9.320-G、利用者の指示） ----------
   「DBへの保存は変更があるたびごとに裏でやっているはずなので特に意識する
    必要もないと思いますが、DBに保存していることがわかるように右上の
    バッジをうまく使って表示をしてほしいです」

   **その前提は事実ではなかった**——測定値は「保存して一覧へ」か「測定を
   完了」を押すまでDBへ入らず、15分ごとのタイマーは**保存済みで送信に
   失敗した分の再送**だけだった。ボタン（旧`#backupNow`）を消すだけでは、
   測定を続けながらDBへ入れる唯一の手立てが消え、バッジは最後まで
   「未保存」と言い続けることになる（画面が嘘をつく・§CLAUDE 6）。
   利用者の指示で**前提のほうを本当にした**。

   **測定中の転送に触らないこと**（§9.122）——ここでするのは値を書くことと
   バッジの文字だけで、`renderMeasureGrid()`も`#deviceInput`も触らない。
   **`WL.measureView.lockCounts()`は呼ばない**——`saveLocal()`は条数・丈数を固定するので、
   裏で走らせると**打ち始めた瞬間に条数を変えられなくなる**（利用者が
   保存を押した意思とは別のことをすることになる）。
   **落ち着いてから1回**（打つたびに往復すると共有越しで数秒かかる・§9.273）。 */
const AUTO_SAVE_IDLE_MS=1500;
let autoSaveTimer=null,autoSaveRunning=false,autoSaveAgain=false;
function cancelAutoSave(){if(autoSaveTimer){clearTimeout(autoSaveTimer);autoSaveTimer=null}}
function scheduleAutoSave(){
 if(!S.measure)return;
 /* 画面を閉じたあとは書かない（閉じる側が完全な保存を済ませている）。 */
 if($('#measureModal')?.hidden)return;
 cancelAutoSave();
 autoSaveTimer=setTimeout(()=>{autoSaveTimer=null;runAutoSave()},AUTO_SAVE_IDLE_MS);
}
async function runAutoSave(){
 if(!S.measure||!measureDirty)return;
 if($('#measureModal')?.hidden)return;
 if(autoSaveRunning){autoSaveAgain=true;return}
 autoSaveRunning=true;
 const id=S.measure.id;
 try{
  do{
   autoSaveAgain=false;
   /* **触った回数を控えてから写す**（§9.320-G の追補、§9.312と同じ数え方）
      ——旗だけで見ると、往復から戻った側が「往復のあいだに打たれた1文字」の
      旗まで下ろし、**まだ書けていないのに「DBへ保存済み」と出る**
      （画面が嘘をつく・§CLAUDE 6）。**値そのものは落ちない**——写しは
      測定値の配列を実体で共有し、`backupAndTrackSync()`の`finally`が
      もう一度書くため（実測。`base.js`の`measureEditSeq`の注記）。 */
   const seq=measureEditSeq;
   const m=WL.measureView.collect();
   /* **状態は変えない**——完了済みのデータを開いて直しているときに
      「編集中」へ落とすと、一覧の分類が押した覚えなく変わる。 */
   m.status=S.measure.status||'編集中';m.updatedAt=new Date().toISOString();
   setState('DBへ保存しています…');
   await reliablePut(m);
   /* **開いている記録が変わったら止める**（§9.229 ④と同じ罠）——往復の
      あいだに別のロットへ移っていたら、そのロットの状態を上書きしない。 */
   if(!S.measure||S.measure.id!==id)return;
   /* 往復のあいだに打たれていたら**旗は下ろさない**。打った側が
      `markDirty()`で次の保存を必ず予約しているので、そちらが書く。 */
   if(measureEditSeq===seq)measureDirty=false;
   const ok=await backupAndTrackSync(m);
   if(!S.measure||S.measure.id!==id)return;
   refreshSyncStatusUI();
   /* **どこまで入ったかを書く**（§9.202の3か所のうち①②）。失敗も
      黙らない——「後で再送します」まで書けば、打つ手が無いことも読める。
      **触られていたら「保存済み」と言わない**——`markDirty()`が出した
      「未保存（画面の中だけ）」を、まだ書けていない値の上から塗り替えない。 */
   if(measureEditSeq===seq)
    setState(ok?'DBへ保存済み':'この端末に保存済み（DBへは後で自動的に再送します）');
  }while(autoSaveAgain);
 }catch(e){
  /* **画面の値は消えない**ことを書く（§4）。次の入力でまた試す。 */
  if(S.measure&&S.measure.id===id)setState('保存できませんでした（画面の値は残っています）');
  console.warn('auto save failed',e);
 }finally{autoSaveRunning=false}
}
window.WL=window.WL||{};
window.WL.autoSave={schedule:scheduleAutoSave,cancel:cancelAutoSave,now:runAutoSave,
  idleMs:()=>AUTO_SAVE_IDLE_MS};
$('#discard').onclick=async()=>{if(await confirmModal('端末内の測定データを削除しますか？')){cancelAutoSave();measureDirty=false;await reliableDelete(S.measure.id);await refreshDraftCount();$('#measureModal').hidden=true;WL.refreshScheduleIfOpen?.()}};
/* NGの記録は**③の確認カードから呼ぶ**（§9.242 ⑥）。操作レールのボタンは
   外したので、ここで配線する相手はもう居ない。**素の`window.*`を増やさず**
   名前空間で公開する（呼び出し側で、どのファイルの機能かが読める）。 */
window.WL=window.WL||{};
WL.measureNg={register:registerNg};
{const btn=$('#recordSyncNowBtn');if(btn)btn.onclick=()=>syncPendingRecords({silent:false})}
/* 測定画面はスケジュール画面の上に重なって開く。閉じたときに下の
   スケジュールを描き直さないと、作業を始めた/終えた結果が反映されないまま
   前の並びが残る(キャッシュを捨てるだけでは、既に描かれている行は変わらない)。 */
async function closeMeasureModal(){
 /* **閉じる前に書き切る**（§9.320-G）。裏の保存は入力が落ち着いてから
    1回なので、直後に閉じると最後のぶんがまだ書けていない。
    **書けたなら聞かない**——保存する手立てがあるのに「破棄しますか」と
    聞くのは、押した人に要らない判断をさせること（§5は確認を増やせという
    意味ではない）。書けなかったときだけ、破棄かどうかを聞く。 */
 if(measureDirty){cancelAutoSave();try{await runAutoSave()}catch(e){WL.quiet.note('自動保存に失敗（このあと破棄してよいかを聞く）',e)}}
 if(measureDirty&&!(await confirmModal('DBへ保存できていない変更があります。破棄して閉じますか？')))return;
 cancelAutoSave();
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
/* ---------- 実施した設備で見せる範囲を絞る（§9.248 ⑥、利用者の指示） ----------
   「データ一覧や実績データ、作業スケジュール表については、実施した設備ごとに
    見せる範囲を変えたいです。設備設定を変えても他の設備の情報が表示されて
    いたら混乱してしまいデータも混ざってしまうと問題になるため修正を
    お願いします。」

   データ一覧は**端末内＋共有DBの全件**を出していた（`mergedRecords()`に
   設備の条件が1つも無かった）。共有DBは全設備ぶんが入るので、設備Aの端末で
   開いても設備Bの測定が並ぶ。

   **既定はこの端末の使用設備だけ**。ただし:
    ・使用設備が未登録の端末では**絞れない**ので、絞らずにそう書く（§4）
    ・設備の記録が無い古いデータは**どの設備のものとも言えない**ので隠さない
      （隠すと「消えた」と読まれる。§9.107「0件は無いとは限らない」）
    ・**切り替えは同じ場所に置き、隠している件数を文字で出す**（§3・§8）
   置き場は**この端末**（読み方の好みなのでPCごと・§9.199）。 */
const RECORD_SCOPE_KEY='MeasurementRecordScopeV1';
function recordScope(){
 try{return localStorage.getItem(RECORD_SCOPE_KEY)==='all'?'all':'mine'}catch(e){return 'mine'}
}
function setRecordScope(v){
 try{localStorage.setItem(RECORD_SCOPE_KEY,v==='all'?'all':'mine')}catch(e){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',e)}
}
/* その記録が「どの設備で実施されたか」。**測ったPCの登録設備**が正で、
   仕掛の設計設備ではない（§9.91の`[設備]`列と同じ考え方）。
   分からないときは空文字＝**どの設備のものとも言えない**。 */
function recordEquipmentOf(x){
 return String(x.registeredEquipment||x.settings?.registeredEquipment
               ||x.remoteEquipment||x.basic?.equipment||'').normalize('NFKC').trim();
}
/* いま絞り込みに使う設備。未登録なら空＝絞らない。 */
function recordScopeEquipment(){
 if(recordScope()==='all')return '';
 return String(currentConfiguredEquipment()||'').normalize('NFKC').trim();
}
function recordMatchesScope(x){
 const eq=recordScopeEquipment();
 if(!eq)return true;
 const own=recordEquipmentOf(x);
 /* **設備の分からない記録は隠さない**——古い版で保存されたものは
    設備を持たないことがあり、隠すと戻す手立てが画面から消える。 */
 return !own||own===eq;
}
/* 編集モードの経路(openRecords)へ戻ったときに、閲覧モードで入れた説明が
   残っていると嘘になる。開き直すたびに必ず消す。 */
function clearRecordListNotice(){recordListState.notice='';recordListState.emptyHtml='';recordListState.sourceNote=''}
function recordMatchesStatusFilter(x){const done=x.status==='完了';return done?!!recordListState.statuses?.done:!!recordListState.statuses?.editing}
function recordSearchText(x){return [x.basic?.lotNo,x.basic?.inspectionNo,x.basic?.castingNo,x.basic?.equipment,x.settings?.registeredEquipment,x.registeredEquipment,x.status].map(v=>String(v||'').normalize('NFKC').toLowerCase()).join(' ')}
/* 状態と検索の絞り込み。**設備の絞り込みとは別に呼べること**——切替ボタンが
   「他N件」を数えるとき、この2つは効かせたまま数えないと、**押しても増えない
   件数**を出してしまう（状態や検索で既に落ちている行まで「伏せている」と
   書くことになる。§CLAUDE 8「同じ数字が食い違わない」）。 */
function recordMatchesView(x){
 return recordMatchesStatusFilter(x)
   &&recordSearchText(x).includes(recordListState.query.normalize('NFKC').toLowerCase());
}
function sortedFilteredRecords(){let items=recordListState.items.filter(x=>recordMatchesScope(x)&&recordMatchesView(x));items=[...items];if(recordListState.sort==='updated-asc')items.sort((a,b)=>String(a.updatedAt||'').localeCompare(String(b.updatedAt||'')));else if(recordListState.sort==='lot-asc')items.sort((a,b)=>String(a.basic?.lotNo||'').localeCompare(String(b.basic?.lotNo||''),'ja'));else items.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));return items}
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
/* ---------- 「新しい版あり」は同じ物差しで比べる（§9.208 ⑤） ----------
   自分の端末で保存しただけのデータに印が付く、と報告された。原因は
   **比べていた2つの時刻の物差しが違ったこと**。
     ・画面(IndexedDB)の`updatedAt` … `toISOString()`＝**UTC**の
       `2026-08-19T05:12:33.123Z`
     ・共有(records.sqlite3)の[更新日時] … サーバーの`Now()`＝**現地時刻**の
       `2026-08-19 14:12:33.123456`
   これを文字列で比べると、10桁目が`' '`(0x20)と`'T'`(0x54)なので、ふつうは
   常に「共有のほうが古い」＝**本物の別PC更新を見落とし**、現地の日付が
   UTCの日付を追い越す時間帯（JSTなら0〜9時）は**常に「共有のほうが新しい」**
   ＝身に覚えのない印、という**両方向に壊れた**状態だった。

   直し方は**同じ物差しの列を1本足す**こと（[更新時刻ISO]＝レコード自身の
   `updatedAt`）。古い行にはその列が無いので、そのときだけ現地時刻を
   **日付として**読み、往復のぶん（`REMOTE_NEWER_SLACK_MS`）は同じ版として
   扱う——サーバーが押す時刻は画面が`updatedAt`を決めてから数百ms後になる。 */
const REMOTE_NEWER_SLACK_MS=5000;
/* 共有側の現地時刻文字列（`2026-08-19 14:12:33.123456`）をミリ秒にする。
   **サーバーはこの端末で動いている**ので、地方時として読んでよい。 */
function localStampMs(v){
 const t=String(v||'').trim();
 if(!t)return NaN;
 const m=t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/);
 if(!m)return NaN;
 const ms=Number(String(m[7]||'0').slice(0,3).padEnd(3,'0'));
 return new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0),ms).getTime();
}
function remoteIsNewer(row,mine){
 const mineIso=String(mine&&mine.updatedAt||'');
 const remoteIso=String(row&&row.record_updated_at||'');
 /* 同じ物差しがそろっているときは、それだけで決める（文字列比較でよい
    ——どちらもUTCのISOで桁がそろっている）。 */
 if(remoteIso&&mineIso)return remoteIso>mineIso;
 const remoteMs=localStampMs(row&&row.updated_at),mineMs=Date.parse(mineIso);
 /* どちらかが読めなければ**印を付けない**——「分からない」を「新しい」と
    同じに扱うと、また身に覚えのない印が出る。 */
 if(!Number.isFinite(remoteMs)||!Number.isFinite(mineMs))return false;
 return remoteMs>mineMs+REMOTE_NEWER_SLACK_MS;
}
WL.recordVersion={remoteIsNewer,localStampMs};
async function mergedRecords(){
 const local=(await reliableAll()).map(WL.measureView.ensureMeasureShape);
 let remote=[];
 try{
  const r=await api('/api/measurement/backup/summary');
  remote=(r&&r.items)||[];
 }catch(e){WL.quiet.note('共有が読めなくても端末内のぶんは出す',e)}
 if(!remote.length)return local;
 const byId=new Map(local.map(x=>[x.id,x]));
 for(const row of remote){
  const mine=byId.get(row.id);
  if(mine){
   // 共有側のほうが新しければ、一覧では共有側の更新日時と状態で見せる
   // (中身は開くときに取り込む)。
   if(remoteIsNewer(row,mine)){
    mine.remoteNewer=true;mine.remoteUpdatedAt=row.record_updated_at||row.updated_at;
    mine.remoteEquipment=row.equipment||'';
    mine.remoteUpdatedBy=row.updated_by||'';mine.remoteUpdatedPc=row.updated_pc||'';
   }
   /* 「誰が・どの端末で」(§9.180)は**共有側の列から補う**。端末内のレコードが
      古い版で作られていて`createdBy`を持たないことがあり、そのときは共有の
      行が唯一の手掛かりになる。**上書きはしない**——レコード自身が持つ値の
      ほうが「始めた端末」として確か。 */
   mine.sharedCreatedBy=row.created_by||'';mine.sharedCreatedPc=row.created_pc||'';
   mine.sharedUpdatedBy=row.updated_by||'';mine.sharedUpdatedPc=row.updated_pc||'';
   mine.sharedCreatedAt=row.created_at||'';
   continue;
  }
  byId.set(row.id,WL.measureView.ensureMeasureShape({
   /* 更新時刻は**レコード自身の物差し**を優先する（§9.208 ⑤）。無い古い行は
      サーバーの現地時刻しか無いので、そのまま出す（`recordLocalStamp`は
      どちらも読める）。 */
   id:row.id,status:row.status||'編集中',updatedAt:row.record_updated_at||row.updated_at||'',
   basic:{lotNo:row.lotNo||'',inspectionNo:row.inspectionNo||'',castingNo:row.castingNo||''},
   registeredEquipment:row.equipment||'',
   remoteOnly:true,remoteCodec:row.codec||'',
   /* 他のPCのぶんは、見出しだけで「誰が・どの端末で」が読めるようにする
      (§9.180)。中身(ペイロード)は開くときに1件だけ取る決まりなので、
      ここでは列の値をそのまま持たせる。 */
   createdBy:row.created_by||'',createdPc:row.created_pc||'',createdAt:row.created_at||'',
   sharedCreatedBy:row.created_by||'',sharedCreatedPc:row.created_pc||'',
   sharedUpdatedBy:row.updated_by||'',sharedUpdatedPc:row.updated_pc||'',
   sharedCreatedAt:row.created_at||'',
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
 const m=WL.measureView.ensureMeasureShape(decodePayload(item.payload));
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
 const gated=await WL.measureHooks.through('openRecords',status);  // 閲覧モードは関門が別の一覧を開く（§9.352）
 if(gated===false)return;
 status=gated[0];
 clearRecordListNotice();
 if(status==='編集中')recordListState.statuses={editing:true,done:false};
 else if(status==='履歴')recordListState.statuses={editing:false,done:true};
 else if(!recordListState.statuses)recordListState.statuses={editing:true,done:false};
 /* 列の設定（§9.162）と読み替えルールを先に読む。**描いてから読むと、
    一度既定の15列で出てから組み替わる**（ちらつくうえ、設定が効いて
    いないように見える）。読めなくても既定の形で一覧は出す。 */
 await Promise.all([
  WL.columnLayout.load(RECORD_LIST_TARGET).catch(WL.quiet('列の設定を取れない（既定の並びで出す）')),
  WL.displayRules.load().catch(WL.quiet('表示ルールを取れない（読み替え無しで出す）')),
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
 if(await WL.measureHooks.through('resumeRecordFromList',x)===false)return;  // 関門（編集モードか）§9.352
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
  S.measure=WL.measureView.ensureMeasureShape(x);S.current=x.source||x.snapshot?.source||null;WL.measureView.renderMeasurement();
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
/* ---------- 「⋯」の中の削除(§9.221 ⑤、利用者の指示) ----------
   「『帳票』と『削除』が近く、かなり危ないです。削除ボタンは完了品からは
    消して、編集中のものは削除に行くまでにプルダウン的な2クリック必要な
    安全設計されたボタンに変更してください」。

   以前は`[続きから再開][帳票][削除]`が**隣り合って常時出ていた**。
   帳票は日に何度も押すもの、削除は取り消せないものなので、
   **危ない操作を主要動線に置かない**（§5）に反していた。

   いまは操作列は`[開く][帳票][⋯]`で、削除は`⋯`の中の1段目——**2クリック
   必要**になる。**押せるのに何も起きないボタンは残さない**（§4）ので、
   消せない行では削除を`disabled`にし、**理由を文字で**添える
   （スケジュールの行メニューと同じ作法・§9.207）。 */
let recordRowMenuEl=null;
function closeRecordRowMenu(){
 if(!recordRowMenuEl)return;
 const owner=recordRowMenuEl._owner;
 if(owner)owner.setAttribute('aria-expanded','false');
 recordRowMenuEl.remove();recordRowMenuEl=null;
 document.removeEventListener('mousedown',onRecordRowMenuAway,true);
 document.removeEventListener('keydown',onRecordRowMenuKey,true);
}
function onRecordRowMenuAway(e){
 if(!recordRowMenuEl)return;
 if(recordRowMenuEl.contains(e.target))return;
 /* **持ち主の`⋯`の上では閉じない。** ここで閉じると、直後の`click`が
    そのまま開き直すので`openRecordRowMenu()`の「同じボタンなら閉じる」
    分岐へ一度も入らない——押した本人には「もう一度押しても閉じない」と
    見える（閉じる手立てがEscと他所クリックだけになる）。 */
 if(recordRowMenuEl._owner&&recordRowMenuEl._owner.contains(e.target))return;
 closeRecordRowMenu();
}
function onRecordRowMenuKey(e){if(e.key==='Escape'&&!e.isComposing){e.stopPropagation();closeRecordRowMenu()}}
/* 削除できない理由。**判定は1箇所**——ボタンの出し分けと、押したときの
   断りが別々だと片方だけ直った状態が作れる。 */
function recordDeleteBlockReason(x){
 if((window.accessMode?.mode||'edit')!=='edit')return '閲覧モードでは端末内のデータを消せません。';
 if(x.remoteOnly)return '別のPCで保存された内容です。この端末には実体が無いので、消す場合はそのPCから操作してください。';
 if(x.status==='完了')return '完了したデータはこの一覧からは消せません。測り直すときは「内容を開く」から再開してください。';
 return '';
}
function openRecordRowMenu(btn,x){
 if(recordRowMenuEl&&recordRowMenuEl._owner===btn){closeRecordRowMenu();return}
 closeRecordRowMenu();
 const why=recordDeleteBlockReason(x);
 const el=document.createElement('div');
 el.className='rec-row-menu';el.setAttribute('role','menu');
 /* 削除が押せないときは器そのものへ焦点を移す（理由を読ませたい）。
    **`tabindex`が無いと`focus()`は何もしない**ので、器にも受け口を置く。 */
 el.tabIndex=-1;
 el.innerHTML=`<div class="rrm-head">${esc(x.basic?.lotNo||x.id)}</div>
  <button type="button" class="rrm-item is-danger" role="menuitem"${why?' disabled':''}>端末内のデータを削除
   ${why?`<small class="rrm-why">${esc(why)}</small>`:'<small class="rrm-why">取り消せません。次の画面でもう一度確かめます。</small>'}</button>`;
 document.body.append(el);
 /* **開いた器を必ず控える。** ここを書き忘れると`recordRowMenuEl`はnullの
    ままなので、`closeRecordRowMenu()`は先頭の`if(!recordRowMenuEl)return`で
    引き返し、外クリック・Esc・自ボタンの**どれでも閉じられない**——
    しかも押すたびにDOMへ積み上がる（実機で「どうやっても消えない」と
    報告された。実測: `⋯`を2回押すと`.rec-row-menu`が2枚）。
    **`tests/test_recdel.js`は素通りしていた**——開いたことしか見ておらず、
    2回目を開く前に自分で`remove()`していたため。開いた控えと画面の器が
    同じものかは、**閉じる操作で確かめること**。 */
 recordRowMenuEl=el;
 el._owner=btn;btn.setAttribute('aria-expanded','true');
 const r=btn.getBoundingClientRect();
 /* 画面の外へ出さない。**器の外(body直下)へ`fixed`で出す**（§9.201。
    一覧は`overflow:auto`なので、中に置くと切り落とされる）。 */
 const w=el.offsetWidth,h=el.offsetHeight;
 el.style.left=Math.max(8,Math.min(window.innerWidth-w-8,r.right-w))+'px';
 el.style.top=(r.bottom+h+8>window.innerHeight?Math.max(8,r.top-h-4):r.bottom+4)+'px';
 const del=el.querySelector('.rrm-item');
 if(!why)del.onclick=async ev=>{
  ev.stopPropagation();closeRecordRowMenu();
  const proceed=recordHasAnyInput(x)?await confirmDeleteRecord(x):true;
  if(proceed){await reliableDelete(x.id);await refreshDraftCount();await refreshRecordList()}
 };
 setTimeout(()=>{
  document.addEventListener('mousedown',onRecordRowMenuAway,true);
  document.addEventListener('keydown',onRecordRowMenuKey,true);
 },0);
 (why?el:del).focus?.();
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
 /* 「どのPC・どのIDが編集したデータか」(§9.180)。**入力を始めた人・端末と、
    最後に保存した人・端末を別の列にする**——測定は別のPCで続きを開ける
    (§9.91)ので、1つにまとめると誰の作業か分からなくなる。
    出どころは分類「計算・操作」（元データの項目ではなく、この画面が
    記録している値）。 */
 {k:'入力開始者',track:'minmax(84px,.8fr)',cls:'secondary',origin:'calc',
  get:x=>x.createdBy||x.sharedCreatedBy||'',
  note:'この測定データを最初に作った利用者ID。別のPCで続きを開いても変わりません。'},
 {k:'入力開始端末',track:'minmax(96px,.9fr)',cls:'secondary',origin:'calc',
  get:x=>x.createdPc||x.sharedCreatedPc||'',
  note:'この測定データを最初に作った端末（PC）名。'},
 {k:'入力開始日時',track:'minmax(160px,0)',tag:'time',origin:'calc',
  get:x=>recordLocalStamp(x.createdAt||x.sharedCreatedAt),fmt:RECORD_DT_FORMAT,
  note:'この測定データを最初に作った日時。'},
 {k:'最終更新者',track:'minmax(84px,.8fr)',cls:'secondary',origin:'calc',
  get:x=>x.sharedUpdatedBy||'',
  note:'共有DBへ最後に保存した利用者ID（共有された記録から読みます）。'},
 {k:'最終更新端末',track:'minmax(96px,.9fr)',cls:'secondary',origin:'calc',
  get:x=>x.sharedUpdatedPc||'',
  note:'共有DBへ最後に保存した端末（PC）名。'},
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
 /* **通した完了は、あとからも読めること**（§9.319-A）。押した瞬間のトーストは
    消えるので、記録へ残した印をここへ出す——読める場所が無い印は、残して
    いないのと同じ（§4）。**既定では出さない**（`def`を付けない）——いま見て
    いる一覧を勝手に1列増やさない（§9.132）。 */
 {k:'完了時の公差外',track:'minmax(140px,1fr)',origin:'calc',
  get:x=>{const w=x.settings?.completedWithNg;
   return w&&w.total?`${w.total}件（${(w.items||[]).map(i=>i.name).filter(Boolean).join('、')}）`:''},
  note:'公差・基準の外に出ている値があることを確認したうえで完了した記録です。'
       +'直してから完了し直すと消えます。'},
 {k:'同期',origin:'calc',get:x=>(x.syncState?.status==='synced'?'送信済み':'未送信'),
  note:'バックアップDB（db/records.sqlite3）へ送れているかです。'},
 {k:'データID',track:'minmax(150px,0)',get:x=>x.id,
  note:'この測定データの内部の識別子です。'},
];
const RECORD_COL_BY_KEY=new Map(RECORD_COLUMNS.map(c=>[c.k,c]));
/* 値を持たない列。仕掛一覧の`#`・ボタン列と同じ扱い。 */
const RECORD_VIRTUAL={
 '#':{label:'#（行番号）',head:'#',note:'絞り込んだあとの並びで数えた番号です。'},
 [RECORD_COL_ACTIONS]:{label:'操作',note:'開く・帳票・「⋯」（削除はこの中）のボタン。消すと、この一覧からは削除できなくなります（開くのは行のダブルクリックでできます）。'},
};
/* **操作列だけは下限を持つ**（§9.222 ①）。データのセルは切れても`title`から
   読めるが、**切れたボタンは押す前に何のボタンか分からない**——実機では
   「続きか…」「帳…」と3つとも省略記号になっていた。文字を短く
   （`再開`／`開く`／`帳票`／`⋯`）したうえで、幅を手で狭めてもここより下は
   受け付けない（列幅が40〜900へ丸められるのと同じ考え方）。 */
/* **pxで書かないこと**——表示サイズ(sm/md/lg)で文字だけが1.1倍になり、
   特大でだけ切れる（§9.127）。`--rec-actions-min`は`#recordList`の文字
   サイズを基準にした`em`（40-records.css）なので、3段とも同じ余り方をする。
   実測の自然幅は sm147 / md156 / lg168px、下限は 161 / 175 / 193px。 */
const RECORD_ACTIONS_MIN='var(--rec-actions-min)';
const RECORD_VIRTUAL_TRACK={'#':'minmax(44px,0)',
  [RECORD_COL_ACTIONS]:'minmax('+RECORD_ACTIONS_MIN+',0)'};
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
/* 見出しからの保存（列幅・右クリックメニュー）。**触った項目だけを送る**
   （§9.212 ②③）ので、渡していない設定は消えない。材料は**保存済み**から
   取ること——`get()`は列の設定パネルの未保存の下書きを含む。
   `hidden`は`recordInitialHidden()`を通す——並びを初めて保存する瞬間に
   種まきしないと、次の描画から候補44列が全部並ぶ。 */
async function recordPersistColumns(patch){
 const cur=WL.columnLayout.saved(RECORD_LIST_TARGET);
 const keys=recordAllColumnKeys();
 const known=(cur.order||[]).filter(k=>keys.includes(k));
 await WL.columnLayout.patch(RECORD_LIST_TARGET,{
  order:[...known,...keys.filter(k=>!known.includes(k))],
  hidden:recordInitialHidden(keys,cur),...patch});
}
function recordColumnLabel(k){
 const n=(WL.columnLayout.get(RECORD_LIST_TARGET).names||{})[k];
 if(n)return n;
 if(RECORD_VIRTUAL[k])return RECORD_VIRTUAL[k].head||RECORD_VIRTUAL[k].label;
 return k;
}
/* CSSグリッドのトラック。引いている最中だけ、掴んだ列を実寸へ差し替える。 */
function recordTracksCss(keys,liveKey,liveWidth){
 return keys.map(k=>(k===liveKey?recordTrackFloor(k,liveWidth+'px'):recordColumnTrack(k))).join(' ');
}
/* 操作列は`minmax(下限, 指定)`にする。**素の`Npx`へ戻さないこと**——
   保存済みの幅（利用者が見出しを引いた結果）はそのまま効くので、下限を
   持たせないと切れたボタンが復活する。 */
function recordTrackFloor(k,track){
 if(k!==RECORD_COL_ACTIONS)return track;
 return 'minmax('+RECORD_ACTIONS_MIN+','+track+')';
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
 if(w)return recordTrackFloor(k,w+'px');
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
 /* **描き直す前に行メニューを閉じる**（§9.222 ①）。一覧は15分ごとの
    自動同期でも作り直されるので、開いたままだと控えの`_owner`が
    **切り離された古いボタン**を指す——外クリックとEscは効くが、
    「同じボタンなら閉じる」分岐は当たらないので、押すと閉じて即開き直す
    ちらつきになる。 */
 closeRecordRowMenu();
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
    /* 見出しの揃えは`WL.columnAlign`の1箇所が答える（§9.239 ④）。
       既定は中央で、値の揃えとは別に持つ。 */
    return `<span class="${WL.columnAlign.headClass(RECORD_LIST_TARGET,k)}" data-col="${esc(k)}" title="${esc(tip)}">${esc(t)}`
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
  WL.measureView.ensureMeasureShape(x);
  const same=currentLot&&normalizedLot(x.basic?.lotNo)===currentLot;
  const row=document.createElement('article');
  const resume=resumeRecordFromList(x),isDone=x.status==='完了',isNg=x.status==='測定値NG';
  const view=recordRowView(x,index);
  const syncSt=x.syncState?.status||'pending';
  const syncBadge=syncSt==='synced'?'':`<span class="record-sync-badge record-sync-${syncSt}" title="${syncSt==='failed'?'バックアップDBへの送信に失敗しました: '+esc(x.syncState?.lastError||''):'バックアップDBへまだ送信していません'}">未同期</span>`;
  /* 他のPCで保存されたもの(§9.91)。開くとこの端末へ取り込む。 */
  /* 「新しい版あり」は**誰がどこで保存したか**まで言う（§9.208 ⑤）。
     「新しい版がある」とだけ書かれていたため、自分で保存しただけのときも
     何が起きたのか読み取れなかった（判定そのものの不具合と合わせて、
     「自分のデータなのに印が付く」という報告になった）。 */
  const remoteWho=[x.remoteUpdatedBy,x.remoteUpdatedPc].filter(Boolean).join(' @ ');
  const remoteBadge=x.remoteOnly?`<span class="record-remote-badge" title="別のPC(${esc(x.registeredEquipment||'設備不明')})で保存された内容です。開くとこの端末へ取り込みます。">別のPC</span>`
    :x.remoteNewer?`<span class="record-remote-badge is-newer" title="共有DBに、この端末より新しい版があります${remoteWho?'（'+esc(remoteWho)+'）':''}。最終保存 ${esc(recordLocalStamp(x.remoteUpdatedAt)||x.remoteUpdatedAt||'')}。開くとそちらの内容を取り込みます。">新しい版あり</span>`:'';
  row.className='record-list-row'+(same?' is-same-lot':'');
  row.tabIndex=0;
  /* 列幅を決め打ちする以上、**入り切らない値には生の値のtitleを必ず付ける**
     （§9.94の一覧と同じ約束）。付けないと、切れた値はどこからも読めない。 */
  row.innerHTML=keys.map(k=>{
   /* **どのセルにも`data-col`を付ける**（§9.104）。以前は操作・状態・
      ロット番号の3つだけ付いておらず、列を鍵にする仕組み（一時的な色・
      揃え）がその3列だけ効かなかった——見出しは塗られるのに本文が
      塗られない、という気づきにくい食い違いになる。 */
   if(k===RECORD_COL_ACTIONS)
    return `<div class="record-list-actions" data-col="${esc(k)}"><button class="resume" type="button" title="${isDone?'このロットの内容を測定画面で開きます':'測定画面を開いて続きから再開します'}（行のダブルクリックでも開けます）">${isDone?'開く':'再開'}</button><button class="report" type="button" title="このロットの帳票プレビューを開きます">帳票</button><button class="rec-more" type="button" aria-haspopup="menu" aria-expanded="false" title="その他の操作（削除はこの中）">⋯</button></div>`;
   const c=RECORD_COL_BY_KEY.get(k);
   const fx=calc.get(k);
   const raw=fx?fx.run(view):(k==='#'?view['#']:(c?c.get(x):''));
   const out=recordCellText(k,raw,view);
   const noSetting=!WL.columnLayout.format(RECORD_LIST_TARGET,k)&&!WL.columnLayout.rule(RECORD_LIST_TARGET,k);
   const text=(noSetting&&c&&c.short)?c.short(x):out.text;
   const shown=String(text??'').trim()||'-';
   const cls=['record-list-cell',c&&c.cls,WL.columnAlign.cellClass(RECORD_LIST_TARGET,k),
              out.color?'cell-'+out.color:''].filter(Boolean).join(' ');
   if(c&&c.cell==='status')
    return `<div class="${cls}" data-col="${esc(k)}"><span class="rp-status-badge${statusClass(x.status)?' '+statusClass(x.status):''}" title="${isNg?'NG回数 '+(x.settings?.ngCount||0)+'回':esc(statusLabel(x.status))}">${esc(shown)}</span>${syncBadge}${remoteBadge}</div>`;
   if(c&&c.cell==='lot')
    return `<div class="${cls}" data-col="${esc(k)}"><button type="button" class="lot-dsp-link grid-lot-link" title="${esc(shown)} ／ クリックでLotDspをこのロット番号で開きます">${esc(shown)}</button></div>`;
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
  if(recLotBtn)recLotBtn.onclick=e=>{e.preventDefault();e.stopPropagation();openLotDsp(x.basic?.lotNo,x.basic?.castingNo,WL.lotDspTab.get())};
  // ダブルクリックは編集再開ではなく帳票プレビューへの遷移とする(編集は「続きから再開/内容を開く」ボタンから明示的に行う)。
  row.ondblclick=e=>{if(!e.target.closest('.rec-more')&&!e.target.closest('.resume')&&!e.target.closest('.report')&&!e.target.closest('.grid-lot-link')&&typeof openReportForRecord==='function')openReportForRecord(x.id)};
  row.setAttribute('role','button');
  row.setAttribute('aria-label',(isDone?'内容を開く':'続きから再開')+' '+(x.basic?.lotNo||x.id));  /* 読み上げは長い呼び名のまま（画面の文字数の制約が無い） */
  row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){if(e.key===' ')e.preventDefault();resume()}};
  const moreBtn=row.querySelector('.rec-more');
  if(moreBtn)moreBtn.onclick=e=>{e.stopPropagation();openRecordRowMenu(moreBtn,x)};
  list.append(row);
 });
 const result=$('#recordSearchResult');
 if(result)result.textContent=`${items.length} / ${recordListState.items.length}件を表示`;
 renderRecordScopeBtn();
}
/* 設備の絞り込みの入口（§9.248 ⑥）。**入口は1つ**——ツールバーの中に置き、
   いま何で絞っているか・隠している件数を**ボタン自身が名乗る**（§3・§9.199
   「畳んだ先の設定はボタンに書く」）。黙って絞ると「データが消えた」と読まれる。 */
function renderRecordScopeBtn(){
 const bar=$('#recordSearchBar');if(!bar)return;
 let btn=$('#recordScopeBtn');
 if(!btn){
  btn=document.createElement('button');
  btn.type='button';btn.id='recordScopeBtn';btn.className='record-scope-btn';
  const anchor=$('#recordColumnsBtn');
  if(anchor)bar.insertBefore(btn,anchor);else bar.appendChild(btn);
  btn.onclick=()=>{setRecordScope(recordScope()==='all'?'mine':'all');renderRecordListRows()};
 }
 const eq=String(currentConfiguredEquipment()||'').trim();
 /* **数える相手は「設備の絞り込みだけを外した一覧」**（状態と検索は効かせた
    まま）——押したときに実際に増える行の数と一致させる。 */
 const all=recordListState.items.filter(recordMatchesView);
 if(!eq){
  /* **絞れないことを書く**（§4）——使用設備が未登録の端末では、どれが
     「この設備のもの」なのか決めようがない。押しても何も起きないボタンを
     残さない。 */
  btn.disabled=true;btn.classList.remove('is-on');
  btn.innerHTML='<b>すべての設備</b>';
  btn.title='この端末に使用設備が登録されていないため、設備では絞れません。ヘッダーの「使用設備」から登録できます。';
  return;
 }
 btn.disabled=false;
 const mine=recordScope()!=='all';
 /* **隠している件数を数える**——0件のときも出す（「絞っているのに全部
    出ている」ことが分かる）。 */
 const off=all.filter(x=>{const o=recordEquipmentOf(x);return o&&o!==eq.normalize('NFKC')}).length;
 const unknown=all.filter(x=>!recordEquipmentOf(x)).length;
 btn.classList.toggle('is-on',mine);
 btn.innerHTML=mine?`<b>${esc(eq)}</b>のみ${off?`<i>他${off}件</i>`:''}`
                   :`<b>すべての設備</b>${off?`<i>他${off}件</i>`:''}`;
 btn.title=mine
  ?`この端末の使用設備「${eq}」で測ったデータだけを出しています`
   +(off?`（他の設備の${off}件は伏せています）`:'（他の設備のデータはありません）')
   +(unknown?`。設備の記録が無い${unknown}件は伏せずに出しています。`:'。')
   +'押すとすべての設備を出します。'
  :`すべての設備のデータを出しています。押すと「${eq}」だけに絞ります。`;
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
  /* **いま隠している列も口が答える**（§9.216 ①、§9.197と同じ罠）。
     データ一覧は「一度も保存していないうちは既定の15列」（§9.162）なので、
     保存値の`hidden`は**空**——既定として畳んでいるだけで、隠す指定は
     持っていない。口が答えないと`headMenuSource()`は保存値をそのまま
     使い、右クリックの「この列を隠す」を1回押しただけで
     **既定で畳んでいた29列がまとめて出てしまう**（押した列は消えるのに
     見覚えの無い列が並ぶ、という分かりにくい壊れ方になる）。
     `persist`（`recordPersistColumns`）は種まきしてから`patch`を当てるが、
     メニュー側が`hidden`を**上書きで渡す**ので種まきは効かない。 */
  hiddenOf:()=>recordInitialHidden(recordAllColumnKeys()),
 };
}
function bindRecordHeadTools(list,keys){
 if(!recordColumnsEditable())return;
 if(typeof WL.columnWidthGrip!=='function'||typeof WL.openColumnHeaderMenu!=='function'){
  console.error('データ一覧の見出し操作: WL.columnWidthGrip / WL.openColumnHeaderMenu が見つかりません');return;
 }
 list.querySelectorAll('.record-list-head [data-col]').forEach(el=>{
  const k=el.dataset.col;
  /* **今そこに在る見出しから測る**（§9.211 ①）。一覧は`innerHTML`ごと
     作り直されるので、綴じ込んだ`el`は簡単に孤児になる——孤児を測ると
     幅0になり、掴んでも動かない。 */
  const liveHead=()=>list.querySelector(`.record-list-head [data-col="${CSS.escape(k)}"]`)||el;
  WL.columnWidthGrip(el.querySelector('.col-resize'),{
   locked:WL.columnLayout.locked(RECORD_LIST_TARGET,k),
   startWidth:()=>liveHead().getBoundingClientRect().width,
   /* 引いている最中は**保存せずに見せるだけ**（掴んだ列だけ実寸へ差し替える）。
      同じ値をキャッシュへも当てておく（`stage`＝保存しない。§9.211 ①）
      ——引いている最中に一覧が組み直されると、当てていない側は保存済みの
      幅で描くので**掴んだ幅がその場で戻る**。「今動かしている列幅が正」
      （利用者の指示）にするには、見た目と控えの両方へ入れる。 */
   preview:w=>{
    list.style.setProperty('--rec-cols',recordTracksCss(keys,k,w));
    const cur=WL.columnLayout.get(RECORD_LIST_TARGET);
    /* 掴んでいる最中は`hold()`（§9.212 ③）。保存済みにも下書きにも触らない。 */
    WL.columnLayout.hold(RECORD_LIST_TARGET,{widths:{...(cur.widths||{}),[k]:w}});
   },
   /* **保存の約束は返すこと**（§9.211 ①）。返さないと取っ手側の
      `.catch()`が空振りし、保存に失敗しても画面は成功したように見える
      （しかも未処理のrejectionになる）。描き直しは待たない——`save()`は
      キャッシュを先に差し替えるので、その場で新しい幅が出る。 */
   commit:w=>{
    const cur=WL.columnLayout.get(RECORD_LIST_TARGET);
    const p=recordPersistColumns({widths:{...(cur.widths||{}),[k]:w}})
     .finally(()=>WL.columnLayout.release(RECORD_LIST_TARGET));
    renderRecordListRows();
    return p.catch(e=>{showToast&&showToast('列幅を保存できませんでした',e.message||String(e),5000)});
   },
   reset:()=>{
    const widths={...(WL.columnLayout.get(RECORD_LIST_TARGET).widths||{})};delete widths[k];
    /* **固定も一緒に解く**（§9.119）。幅を持たない「固定」は動かしようが
       無いので、残すと「固定と出ているのに何も効いていない」列になる。 */
    const locks=(WL.columnLayout.get(RECORD_LIST_TARGET).locks||[]).filter(x=>x!==k);
    const p=recordPersistColumns({widths,locks})
     .finally(()=>WL.columnLayout.release(RECORD_LIST_TARGET));
    renderRecordListRows();
    return p.catch(e=>{showToast&&showToast('列幅を保存できませんでした',e.message||String(e),5000)});
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
  /* 並べ替えの決まり(§9.187)は出さない——データ一覧は見出しで並べ替えを
     持たないので、設定できるのに効かない欄になる。 */
  features:{formula:true,preset:true,width:true,format:true,rule:true,sort:false},
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
/* ---------- 使用設備の設定（§9.257 ②、利用者の指示） ----------
   「アプリ使用設備の設定のモーダルが使いづらいのでわかりやすく使いやすく
    再構築してください。」

   直す前の窓は、決めることが2つ（この端末で使う設備／LotDspで開くタブ）
   なのに見出しでそう言わず、**同じ設備名を3箇所**に出していた:
     ・選択欄そのもの（`LS4`）
     ・`#equipmentMasterHelp` … 「設備マスタから選択: LS4」
     ・`#equipmentSettingStatus` … 「現在の設定: LS4」
   同じ値が枠付きで3つ並ぶと、読む側は「違うものかもしれない」と見比べる
   ことになる（§CLAUDE 画面基準 8／§9.129）。しかも下の2つは読み取り専用の
   値に入力欄風の枠が付いており（基準10）、「＋ 設備マスタへ新規登録」を
   選ぶと欄が生えて窓の高さが動いた（§9.227 ②「選んでも1pxも動かない」）。
   さらに「設定を保存」の隣にある②は**選んだ瞬間に効く**ので、ボタンが
   何を保存するのか嘘をついていた（§CLAUDE 2）。

   組み直しの方針:
    1. **決める順に番号を振って節に分ける**（§14）——①使う設備 ②開くタブ。
       面積は頻度×重要度で配る（基準1）ので①が主役、②は小さく。
    2. **いまの値は1箇所だけ**——①の見出しの右のチップ。助けの行は
       「値」ではなく**次にすること**を言う（基準2）。
    3. **効くタイミングを書く**（§CLAUDE 6）——①は保存ボタン、②は
       「選ぶとすぐ反映」。ボタンの字も`使用設備を保存`と名乗る。
    4. **何に効くのかを書く**（基準6）——測定の開始・記録の絞り込み・
       ロール／帳票の当たり先まで、この設備で決まる。
    5. **選んでも高さが動かない**（§9.227 ②）——新規登録の欄は
       `visibility`で伏せ、場所は常に空けておく。
    6. 決めるボタンは**本文の外**（`footer`）——本文だけがスクロールするので、
       中身が増えてもボタンに手が届く（§9.255 ④／§9.222 ⑤）。

   **中身を作るのはこの1箇所**（§9.163）。以前は`templates/index.html`と
   `ensureEquipmentSettingsModal()`が**別々の作り**を持っており、後者は
   `<select>`ではなく`<input>`・`#newEquipmentEntry`も無い形だったので、
   そちらが動いた瞬間に`fillEquipmentSelect()`が落ちた（一度も動いて
   いなかったので誰も気づけない）。 */
const LOTDSP_TABS=[0,1,2,3,4,5,6,7];
function equipmentSettingsHtml(){
 return `<div class="settings-dialog eqset" role="dialog" aria-modal="true" aria-labelledby="eqsetTitle">
  <header>
   <div><h2 id="eqsetTitle">使用設備の設定</h2>
    <small>この端末で使う設備と、ロット№の開き方</small></div>
   <button id="closeAppSettings" type="button" aria-label="閉じる">×</button>
  </header>
  <div class="settings-body">
   <section class="eqset-sec" aria-labelledby="eqsetH1">
    <h3 id="eqsetH1"><span class="eqset-no">①</span>この端末で使う設備
     <b class="eqset-now" id="equipmentSettingStatus">未登録</b></h3>
    <p class="eqset-lead">この設備で<b>測定を開始</b>し、データ一覧・実績データも<b>この設備のぶんだけ</b>出します。仕掛データの「設計_設備ｺｰｽ」に入っていないロットは、測定画面の上で知らせます。</p>
    <div class="eqset-pick">
     <label class="eqset-field"><span>設備名</span>
      <select id="configuredEquipment"><option value="">設備マスタを読み込んでいます</option></select></label>
     <div class="eqset-new" id="newEquipmentEntry">
      <label class="eqset-field"><span>新しく登録する設備名</span>
       <input autocomplete="off" id="newEquipmentName" placeholder="例: LS4" type="text"/></label>
     </div>
    </div>
    <p class="eqset-help" id="equipmentMasterHelp">設備マスタを読み込んでいます。</p>
   </section>
   <section class="eqset-sec eqset-sec-minor" aria-labelledby="eqsetH2">
    <h3 id="eqsetH2"><span class="eqset-no">②</span>ロット№を押したときに開くタブ
     <b class="eqset-now is-instant">選ぶとすぐ反映</b></h3>
    <label class="eqset-field"><span>LotDspのタブ</span>
     <select id="lotDspTabSetting">${LOTDSP_TABS.map(n=>`<option value="${n}">Tab ${n}</option>`).join('')}</select></label>
    <p class="eqset-help">一覧や測定画面のロット№を押すと、LotDspをこのタブで開きます。<b>下の「保存」は要りません</b>（この端末だけの設定です）。</p>
   </section>
  </div>
  <footer class="settings-actions">
   <span class="eqset-foot" id="eqsetFoot"></span>
   <button id="cancelAppSettings" type="button">やめる</button>
   <button id="saveAppSettings" type="button">使用設備を保存</button>
  </footer>
 </div>`;
}
function ensureEquipmentSettingsModal(){
 let modal=$('#appSettingsModal');
 if(!modal){
  modal=document.createElement('div');
  modal.className='record-modal';modal.hidden=true;modal.id='appSettingsModal';
  document.body.append(modal);
 }
 /* **同じ形なら組み直さない**——開くたびに作り替えると、選んでいた値も
    フォーカスも消える。欠けている部品があるときだけ作る。 */
 if(!($('#configuredEquipment')&&$('#equipmentSettingStatus')&&$('#saveAppSettings')
      &&$('#lotDspTabSetting')&&$('#newEquipmentEntry')&&$('#equipmentMasterHelp'))){
  modal.innerHTML=equipmentSettingsHtml();
  /* **欄を作った側が配線する**（§9.257 ②）——`base.js`は読み込み時に
     1度だけ探す作りだと、あとから組み立てるこの欄に間に合わない。 */
  if(WL.lotDspTab&&typeof WL.lotDspTab.bind==='function')WL.lotDspTab.bind($('#lotDspTabSetting'));
  else console.error('LotDspのタブ: WL.lotDspTab が見つかりません');
  /* **背景クリックでは閉じない**（§9.221 ①）。押したことは器を弾ませて返す。 */
  if(WL.modal&&typeof WL.modal.keepOpen==='function')WL.modal.keepOpen(modal);
  else console.error('使用設備の設定: WL.modal が見つかりません');
 }
 return modal;
}
function bindAppSettingsControls(){
 /* 入口（ヘッダーのチップ・バナー・警告帯）は`openEquipmentSettingsFinal()`が
    受け持つ。ここは器を用意してバッジを塗るだけ——**閉じる・保存の配線は
    開くときに1箇所で当てる**（`openEquipmentSettingsFinal()`）。
    以前はここにも`#saveAppSettings.onclick`があり、**`<select>`ではなく
    `<input>`から値を読む**古い作りのまま残っていた（開いた側が必ず上書き
    するので一度も動かず、消しても画面は1つも変わらない）。`#openAppSettings`
    という入口も、そのボタンが画面から無くなったあとも配線だけ残っていた。 */
 ensureEquipmentSettingsModal();
 updateRegisteredEquipmentBadge();
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
/* **書き込みは`WL.equipment.set()`を通す**（§9.285 ①）——`localStorage`へ
   直に書くと、フィルタの`{使用設備}`も一覧の絞り込みも「変わったこと」を
   知る手立てが無い（実機で「切り替えた瞬間に反映されない」と報告された）。 */
async function registerAndSelectEquipment(name){const result=await api('/api/equipment-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withUserId({name,reuseExisting:true}))});WL.equipment.set(result.name);await loadEquipmentMaster(true);return result}
/* 候補を並べる。**「＋ 設備マスタへ新規登録」を選んでも窓の高さは動かない**
   （§9.227 ②）——`hidden`で行ごと消すと、選んだ拍子に下のボタンが上下して
   狙いが外れる。場所は常に空けておき、伏せるのは中身だけ（CSSが
   `visibility`で受ける）。 */
const EQ_NEW='__new__';
/* 使える機能で候補を絞る（§9.302）。**判定はサーバーの`features`**を見るだけ
   （綴りも規則も`master_repo.equipment_allows()`が持つ・§9.163）。
   **いま選んでいる設備は落とさない**——落とすと、外した設備を選んでいた端末で
   選択欄が空になり、直す手立てまで画面から消える（§9.15と同じ作法）。
   **`features`が届かない古い応答では絞らない**（fail-open）。 */
function equipmentUsableFor(item,feature){
 const f=item&&item.features;
 return !f||typeof f!=='object'||f[feature]!==false;
}
function equipmentNamesFor(feature,keep=''){
 const kp=String(keep||'').trim();
 return equipmentMasterState.items
  .filter(x=>equipmentUsableFor(x,feature)||(kp&&normalizeCourseText(x.name)===normalizeCourseText(kp)))
  .map(x=>x.name);
}
function equipmentHiddenCount(feature,keep=''){
 return equipmentMasterState.items.length-equipmentNamesFor(feature,keep).length;
}
function fillEquipmentSelect(selected='',suggested=''){
 const select=$('#configuredEquipment');if(!select)return;
 const names=equipmentNamesFor('measure',selected||currentConfiguredEquipment()),
       preset=suggested&&names.find(x=>normalizeCourseText(x)===normalizeCourseText(suggested)),
       current=selected&&names.find(x=>normalizeCourseText(x)===normalizeCourseText(selected));
 select.innerHTML='<option value="">選んでください</option>'
   +names.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')
   +`<option value="${EQ_NEW}">＋ 設備マスタへ新規登録</option>`;
 const unmatchedSuggestion=suggested&&!preset?suggested:'',
       unmatchedCurrent=selected&&!current?selected:'';
 select.value=preset||current||((unmatchedSuggestion||unmatchedCurrent)?EQ_NEW:'');
 const newName=$('#newEquipmentName');
 if(newName)newName.value=unmatchedSuggestion||unmatchedCurrent||'';
 syncNewEquipmentSlot();
 select.onchange=()=>{
  if(select.value!==EQ_NEW&&newName)newName.value='';
  syncNewEquipmentSlot();updateEquipmentMasterHelp();
  /* 新規登録を選んだら**打つ場所へ連れて行く**（§CLAUDE 画面基準 2）。
     **焦点を当てるのはここだけ**——`syncNewEquipmentSlot()`は開いた直後にも
     走るので、あちらで当てると窓を開いた瞬間の焦点を横取りする。 */
  if(select.value===EQ_NEW&&newName)requestAnimationFrame(()=>{try{newName.focus()}catch(e){WL.quiet.note('焦点を当てられない（値も操作も残る）',e)}});
  /* いま選んでいるものを見出しのチップへ返す（§CLAUDE 2「いま選んでいる
     ものは名乗る」）。**値を出す場所はここ1箇所**にする。 */
  paintEquipmentNow(select.value===EQ_NEW?(newName&&newName.value)||'':select.value,'pick');
 };
 if(newName)newName.oninput=()=>{
  if(select.value===EQ_NEW)paintEquipmentNow(newName.value,'pick');
 };
}
/* **場所は空けたまま中身だけ伏せる**（§9.227 ②）。`hidden`属性は
   `[hidden]{display:none}`がutilityレイヤで当たるので使わない。 */
function syncNewEquipmentSlot(){
 const select=$('#configuredEquipment'),slot=$('#newEquipmentEntry');
 if(!select||!slot)return;
 const on=select.value===EQ_NEW;
 slot.classList.toggle('is-on',on);
 const input=$('#newEquipmentName');
 if(input)input.disabled=!on;      /* 伏せた欄へタブで入らない */
}
/* ---------- いまの設備は「1箇所」だけに出す（§9.257 ②） ----------
   直す前は選択欄・助けの行・状態の帯の**3箇所**に同じ名前が出ていた。
   出すのは①の見出しのチップだけにして、助けの行は**次にすること**を言う。
   `kind`: `saved`＝保存済み／`pick`＝選んだが未保存／`none`＝未登録。 */
function paintEquipmentNow(name,kind){
 const el=$('#equipmentSettingStatus');if(!el)return;
 const now=String(name||'').trim();
 const saved=currentConfiguredEquipment();
 const state=!now?'none':(kind==='saved'||now===saved?'saved':'pick');
 el.className='eqset-now'+(state==='none'?' is-none':(state==='pick'?' is-pick':''));
 el.textContent=state==='none'?'未登録'
   :(state==='pick'?`${now}（保存前）`:`${now}`);
 /* **色だけで伝えない**（§CLAUDE 3）。読み上げにも同じ文が届く。 */
 el.title=state==='none'?'この端末の使用設備はまだ登録されていません'
   :(state==='pick'?`「${now}」を選んでいます。まだ保存していません`
                   :`この端末の使用設備は「${now}」です`);
}
/* 助けの行は**次にすること**を1つだけ言う（§CLAUDE 画面基準 2）。
   **いまの値をここへ書かないこと**——見出しのチップが既に言っている。 */
function updateEquipmentMasterHelp(){
 const select=$('#configuredEquipment'),help=$('#equipmentMasterHelp');
 if(!select||!help)return;
 /* **数えるのは候補に出ている件数**（§9.302）——「登録済み 8件」と言いながら
    一覧に3件しか無いと、残りを探すことになる。伏せた件数は別に言う（§4）。 */
 const keep=select.value===EQ_NEW?'':(select.value||currentConfiguredEquipment());
 const n=equipmentNamesFor('measure',keep).length,
       off=equipmentHiddenCount('measure',keep);
 const offNote=off?`　<span class="eqset-note">測定で使わない設定の設備 ${off}件は出していません（設備マスタ＞使える機能）。</span>`:'';
 const set=(cls,html)=>{help.className='eqset-help'+(cls?' '+cls:'');help.innerHTML=html};
 if(!n){
  set('is-warn',(equipmentMasterState.items.length
     ?`登録済みの設備はありますが、<b>測定で使える設備が1件もありません</b>（${off}件とも「使える機能」から測定を外しています）。`
      +'設備マスタ＞設備で戻すか、「＋ 設備マスタへ新規登録」で新しく登録してください。'
     :'設備マスタに<b>まだ1件も登録がありません</b>。'
      +'「＋ 設備マスタへ新規登録」を選んで、この端末で使う設備名を入れてください。'));
  return;
 }
 if(select.value===EQ_NEW){
  set('is-warn','入れた名前を<b>設備マスタへ登録</b>してから、この端末の使用設備にします'
    +'（次からは上の一覧に出ます）。');
  return;
 }
 if(!select.value){
  set('is-warn',`登録済みの設備 <b>${n}件</b> から選んでください。`
    +'無ければ「＋ 設備マスタへ新規登録」です。'+offNote);
  return;
 }
 set('',`あとは下の<b>「使用設備を保存」</b>を押すだけです（登録済み ${n}件）。`+offNote);
}
/* 窓を開く。**なぜ開いたか（`reason`）で足の一言が変わる**——測定を
   開こうとして止められたのか、自分で開いたのかで、次にすることが違う
   （§CLAUDE 画面基準 2「次にすることを常に1つだけ指す」）。 */
async function openEquipmentSettingsFinal(reason='manual',suggested=''){
 const modal=ensureEquipmentSettingsModal();
 ['recordModal','measureModal','splitModal'].forEach(id=>{
  const el=$('#'+id);if(el&&!el.hidden)el.hidden=true;
 });
 hideSaveOverlay();
 modal.hidden=false;
 const foot=$('#eqsetFoot'),help=$('#equipmentMasterHelp');
 const say=(msg,cls)=>{if(!foot)return;foot.className='eqset-foot'+(cls?' '+cls:'');foot.textContent=msg||''};
 try{await loadEquipmentMaster(true)}
 catch(error){
  /* **読めなかったことを「無い」と言わない**（§CLAUDE 3／§9.211 ②）。 */
  if(help){help.className='eqset-help is-warn';
           help.textContent='設備マスタを読めませんでした: '+error.message}
  say('設備マスタを読めていないので保存できません。','is-warn');
  const sv=$('#saveAppSettings');if(sv)sv.disabled=true;
  return false;
 }
 const sv=$('#saveAppSettings');if(sv)sv.disabled=false;
 const suggestion=suggested||((reason==='suggestion'||reason==='required')
   ?residualEquipmentSuggestion():'');
 fillEquipmentSelect(currentConfiguredEquipment(),suggestion);
 updateEquipmentMasterHelp();
 const sel=$('#configuredEquipment');
 paintEquipmentNow(currentConfiguredEquipment(),'saved');
 if(suggestion&&sel&&sel.value)paintEquipmentNow(
   sel.value===EQ_NEW?suggestion:sel.value,'pick');
 /* **なぜここに居るのかを足に書く**（§CLAUDE 6）。開いた理由は3通りしか
    無いので、文言もここ1箇所で決める。 */
 say(reason==='required'
     ? '測定を始めるには、この端末の使用設備が要ります。'
     : (suggestion
        ? `残コースから「${suggestion}」を候補に入れました。違うときは選び直してください。`
        : (currentConfiguredEquipment() ? '' : 'まだ登録されていません。')),
     reason==='required'||!currentConfiguredEquipment()?'is-warn':'');
 const close=()=>{modal.hidden=true};
 $('#closeAppSettings').onclick=close;
 $('#cancelAppSettings').onclick=close;
 $('#saveAppSettings').onclick=async()=>{
  const select=$('#configuredEquipment');
  let name=select.value;
  if(name===EQ_NEW)name=($('#newEquipmentName').value||'').trim();
  if(!name){
   /* **押せるのに何も起きない、にしない**（§CLAUDE 4）——直す場所へ連れて行く。 */
   say('設備を選んでください。','is-warn');
   updateEquipmentMasterHelp();
   (select.value===EQ_NEW?$('#newEquipmentName'):select).focus();
   return;
  }
  try{
   const result=await registerAndSelectEquipment(name);
   paintEquipmentNow(name,'saved');
   say(result.message||'保存しました。','is-ok');
   /* 画面の描き直しは`WL.equipment.onChange`が受け持つ（§9.285 ①）——
      ここで呼び直すと、同じことを2箇所でやることになる（§CLAUDE 8）。 */
   const row=pendingMeasurementRow;pendingMeasurementRow=null;
   setTimeout(close,450);
   if(row){
    await nextPaint();
    openMeasurement(row).catch(error=>showToast('測定画面を開けません',error.message,8000));
   }
  }catch(error){say(error.message,'is-warn')}
 };
 /* **開いた直後の焦点は「いま打つべき欄」へ**——候補に無い設備が入って
    いれば新規登録の欄が開いているので、そちらを当てる（§9.221 ④と同じ
    「最初のフォーカスは打てる欄へ」）。 */
 requestAnimationFrame(()=>{
  try{
   const s2=$('#configuredEquipment');
   ((s2&&s2.value===EQ_NEW)?$('#newEquipmentName'):s2).focus();
  }catch(e){WL.quiet.note('焦点を当てられない（値も操作も残る）',e)}
 });
 return true;
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
  /* ここは**同期で真偽を返す**関門（呼ぶ側が`if(!...)return`で使う）。
     お知らせは見せるだけなので待たない。 */
  alertModal(`このロットの設計設備「${rowEquipment}」は、登録済みの使用設備「${equipment}」と一致しません。\n測定を開始・再開できません。設備が正しいか確認してください。`);
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
document.addEventListener('keydown',event=>{if(WL.modal.escCloses(event)&&!$('#appSettingsModal')?.hidden){$('#appSettingsModal').hidden=true}},true);
document.addEventListener('keydown',event=>{if(WL.modal.escCloses(event)&&!$('#changelogModal')?.hidden){$('#changelogModal').hidden=true}},true);
/* ---------- 使用設備が変わったら、この端末の見え方も変わる（§9.285 ①） ----------
   ヘッダーの印・案内の帯・コース警告・データ一覧の「この設備のみ」は、
   どれも**使用設備の名前を読んで描いている**。以前は設定窓の保存処理が
   その場で呼び直していたが、設備を書き換える経路が増えるたびに
   「呼び忘れた画面だけが古いまま」を作れる（実際にフィルタがそうなった）。
   **知らせを受ける側がここで名乗る。** */
WL.equipment.onChange(()=>{
 updateEquipmentEntryPoints();
 updateCourseGuard();
 /* データ一覧を開いていれば、絞っている範囲もその設備の話になる（§9.248 ⑥）。
    **開いていなければ触らない**——次に開くときに読み直される。 */
 const modal=$('#recordModal');
 if(modal&&!modal.hidden&&typeof renderRecordListRows==='function')renderRecordListRows();
});
queueMicrotask(()=>{ensureEquipmentSettingsModal();updateEquipmentEntryPoints()});
// 前回サーバーへ届かなかったバックアップ削除を片付ける(§9.52)。残したままだと
// 作業スケジュールに実体の無い「作業中」が出続ける。
queueMicrotask(()=>{flushPendingBackupDeletes().catch(e=>console.warn('バックアップ削除の再試行に失敗',e))});
queueMicrotask(async()=>{try{await loadEquipmentMaster();updateEquipmentEntryPoints()}catch(error){console.warn('equipment master init failed',error)}});
queueMicrotask(()=>{updateRegisteredEquipmentBadge();const start=$('#stampWorkStart'),end=$('#stampWorkEnd');if(start)start.onclick=()=>WL.measureView.stampWorkTimeLocked('start');if(end)end.onclick=()=>WL.measureView.stampWorkTimeLocked('end')});
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
WL.list.init().catch(error=>{
 console.error('初期化エラー',error);
 const grid=$('#grid');if(grid)grid.innerHTML=`<div class="load-error"><b>画面を初期化できませんでした</b><span>${esc(error?.message||String(error))}</span></div>`;
/* 起動オーバーレイの「一覧を読み込み」はここで済む。**失敗しても進める**
   (エラー表示ごと見せる必要がある。覆ったままにしない)。 */
}).finally(()=>WL.boot.step('list'));
