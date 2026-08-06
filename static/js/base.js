"use strict";
/* base.js: 共有基盤 — グローバル状態(S)・API呼び出し・共通ユーティリティ・
   フィールド別名(aliases)・端末設定(使用設備/ユーザーID)。
   読込順の先頭に置き、画面固有の処理はここへ置かない。 */
const LENGTH_SLOTS=12;const $=s=>document.querySelector(s),S={db:null,table:null,catalog:[],tables:[],columns:[],rows:[],page:1,count:0,current:null,measure:null,selectedRows:new Set()};
/* エラー時、応答JSONの残りのフィールド(code等)をErrorオブジェクトへ
   そのまま乗せる(呼び出し側がe.messageだけでなくe.codeでも分岐できるように
   するため)。既存の呼び出し元はe.messageしか見ていないため、これを追加
   しても挙動は変わらない。 */
const api=async(u,o)=>{let r;try{r=await fetch(u,{cache:'no-store',...(o||{})})}catch(error){throw Error('サーバーへ接続できません。Flaskアプリが起動中か、ポート5029で開いているか確認してください。詳細: '+(error?.message||String(error)))}const text=await r.text();let j={};try{j=text?JSON.parse(text):{}}catch(_){j={error:text}}if(!r.ok){const err=Error(j.error||('HTTP '+r.status));Object.assign(err,j);err.status=r.status;throw err}return j},esc=v=>{const d=document.createElement('div');d.textContent=v??'';return d.innerHTML};
const aliases={lotNo:['ロット番号','ﾛｯﾄ番号','LTNO'],inspectionNo:['検査番号','KNNO'],orderNo:['オーダー番号','JUON','JUNO'],castingNo:['鋳造番号','CYNO'],allocationNo:['引当番号','HKNO'],orderMaterial:['オーダー材質','JUA'],orderTemper:['オーダー調質','JUB'],orderThickness:['オーダー板厚','JUX'],orderWidth:['オーダー板幅','JUY'],orderLength:['オーダー板丈','JUZ'],mfgMaterial:['製造材質','LTA'],mfgTemper:['製造調質','LTB'],mfgThickness:['製造板厚','LTX'],mfgWidth:['製造板幅','LTY'],mfgLength:['製造板丈','LTZ'],purposeCode:['用途コード','用途ｺｰﾄﾞ','YOTOC'],purposeName:['用途名','YOTON'],customer:['取引先','TOKUNA'],delivery:['納入先','NONNA'],designCourse:['設計_設備ｺｰｽ','設計_設備コース'],course:['実績_設備ｺｰｽ','実績_設備コース','実績コース'],residualCourse:['残仕掛設備ｺｰｽ','残仕掛設備コース','ZANMC'],equipment:['BOX設計_設備名','設備'],originalWidth:['BOX実績_板幅'],boxHorizontalCount:['BOX設計_横割数'],boxVerticalCount:['BOX設計_縦割数']};
function pick(row,key){for(const n of aliases[key]||[])if(row[n]!==undefined&&row[n]!==null)return String(row[n]);return ''}
function lotKey(r){return [pick(r,'equipment'),pick(r,'lotNo'),pick(r,'inspectionNo'),pick(r,'castingNo')].join('|')}
/* 基本情報タブの寸法表示整形。板厚=小数2桁 / 板幅・板丈=小数1桁。数値でない・空欄はそのまま。 */
function fmtDim(value,digits){const raw=String(value??'').trim();if(raw==='')return '';const n=Number(raw);return Number.isFinite(n)?n.toFixed(digits):raw}
/* ロット№クリックでLotDsp検索サイトをロット番号指定で開く。
   linkkeyは「7文字固定幅のロット番号 + 半角スペース3つ + 7文字固定幅の
   鋳造番号」という構成(実機のURLから確認)。
   別オリジンのためフォームへの直接書き込みはできないが、この形式で
   URLを開けば相手側アプリがlinkkeyを読み取って検索まで行う。念のため
   ロット番号はクリップボードにもコピーしておく(自動遷移が効かない
   場合の手動貼り付け用フォールバック)。 */
const LOT_DSP_BASE='http://nlmfangyweb1a/LotDspWeb/#/lotdsp';
function lotDspField(v){return String(v||'').slice(0,7).padEnd(7,' ')}
function lotDspLinkKey(lotNo,castingNo){return lotDspField(lotNo)+'   '+lotDspField(castingNo)}
function buildLotDspUrl(lotNo,castingNo,tab){return `${LOT_DSP_BASE}?linkkey=${encodeURIComponent(lotDspLinkKey(lotNo,castingNo))}&tab=${encodeURIComponent(tab)}`}
function copyText(text){
 if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(text).catch(()=>copyTextFallback(text));
 copyTextFallback(text);return Promise.resolve();
}
function copyTextFallback(text){
 const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.focus();ta.select();
 try{document.execCommand('copy')}catch(_){}
 document.body.removeChild(ta);
}
function openLotDsp(lotNo,castingNo,tab){
 if(!lotNo){showToast('ロット番号が未設定です','LotDspへは移動できません');return}
 window.open(buildLotDspUrl(lotNo,castingNo,tab),'_blank','noopener');
 copyText(lotNo);
}
document.addEventListener('click',e=>{
 const link=e.target.closest('.lot-dsp-link');if(!link)return;
 openLotDsp(S.measure?.basic?.lotNo,S.measure?.basic?.castingNo,localStorage.getItem('LotDspLastTabV1')||'1');
});
/* 段階的開示(.disclosure)の共通トグル。品質データ分析(qa-acc)で確立した
   見た目を条割パネル・母材パネル等でも同じ言語で使うための汎用部品
   (app.cssの.disclosure系クラス参照)。動的に再描画される領域(条割の
   履歴セクション等)にも効くよう、常時デリゲートで拾う。 */
document.addEventListener('click',e=>{
 const head=e.target.closest('.disclosure-head');if(!head)return;
 head.closest('.disclosure')?.classList.toggle('open');
});
/* タブ番号は測定画面には出さず、アプリ設定(使用設備の設定)モーダルの
   内部設定として切り替える。ロット№欄の見た目・サイズは常に元のまま。
   既定値はTab1(実機URLの例に合わせる)。 */
(function(){
 const sel=document.getElementById('lotDspTabSetting');if(!sel)return;
 sel.value=localStorage.getItem('LotDspLastTabV1')||'1';
 sel.onchange=()=>localStorage.setItem('LotDspLastTabV1',sel.value);
})();
function setState(x){$('#localState').textContent=x}
/* 保存されていない変更があるかどうかを追跡する。×ボタン/背景クリックで
   閉じようとした際、破棄してよいか確認するために使う。renderMeasurement()
   でデータを新規に読み込んだ時と、保存が成功した時にリセットする。 */
let measureDirty=false;
function markDirty(){measureDirty=true;setState('未保存')}
/* サイドバーの選択状態。トップレベルの行き先(データ一覧・仕掛・品質データ・
   マスタ一覧・ダッシュボード・実績カレンダー)は排他で、常にどれか1つだけが
   選択中になる。以前は行き先ごとに自分の.activeを付け外ししていたため、
   データ一覧だけ選択状態にならず「今どこにいるか」が分からなかった。
   keyはボタンのid、またはDB一覧ボタンのdata-db-key。 */
function setActiveNav(key){
 document.querySelectorAll('aside .nav-item').forEach(b=>
  b.classList.toggle('active',!!key&&(b.id===key||b.dataset.dbKey===key)));
}
function bindTabs(group,panel){document.querySelectorAll(`[data-${group}tab]`).forEach(btn=>btn.onclick=()=>{document.querySelectorAll(`[data-${group}tab]`).forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll(`[data-${group}panel]`).forEach(x=>x.hidden=x.dataset[group+'panel']!==btn.dataset[group+'tab'])})}
function optionFill(id,items,current='-'){const el=$('#'+id);if(!el)return;const vals=['-',...new Set(items||[])];el.innerHTML=vals.map(v=>`<option>${esc(v)}</option>`).join('');if(vals.includes(current))el.value=current}
function qualityText(items){if(!items?.length)return '異常情報なし';return items.slice(0,4).map((q,i)=>`(${i+1}) ${q['発生設備']||''} ${q['登録日時']||''} ${q['異常内容']||''}\nコメント：${q['コメント']||''}\n最終処置：${q['最終処置']||''}\n保留設定日：${q['保留設定日']||''}　保留解除日：${q['保留解除']||''}`).join('\n\n')}
function widthSequence(max,order,dir){let a=Array.from({length:max},(_,i)=>i);if(order==='奇数条優先')a=[...a.filter(i=>i%2===0),...a.filter(i=>i%2===1)];if(order==='偶数条優先')a=[...a.filter(i=>i%2===1),...a.filter(i=>i%2===0)];if(dir==='降順')a=a.reverse();return a}
function lengthIndex(){const el=$('#lengthPos');if(!el)return 0;const opts=[...el.options],idx=opts.findIndex(o=>o.value===el.value);return Math.max(0,Math.min(LENGTH_SLOTS-1,idx>=0?idx:0))}
/* 自動転送中に、日本語IME等の影響で数字・記号が全角へ変換され、Tabまでの
   間に解析不能な文字列になる不具合への対策。全角英数記号(U+FF01-FF5E)と
   全角スペースを半角へ強制変換する。自動転送(auto)時のみ適用し、
   手動入力(manual)時は自由に入力できるよう変換しない。 */
function toHalfWidth(str){return String(str??'').replace(/[！-～]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0xFEE0)).replace(/　/g,' ')}
function normalizedLot(value){return String(value||'').normalize('NFKC').replace(/[\s　_-]/g,'').toUpperCase()}
/* 画面右下に一時通知(トースト)を表示する。 */
function showToast(title, detail='', duration=3400){
 const area=$('#toastArea'); if(!area)return;
 const item=document.createElement('div'); item.className='toast';
 item.innerHTML=`<b>${esc(title)}</b>${detail?`<small>${esc(detail)}</small>`:''}`;
 area.append(item); setTimeout(()=>{item.classList.add('out');setTimeout(()=>item.remove(),220)},duration);
}
/* 共通の確認モーダル。ブラウザ標準のconfirm()はアプリの見た目に合わせられず
   タブ全体をブロックするため、破棄確認・削除確認等はこちらへ統一する
   (以前はlot-split.js/filters.js/records-store.jsが個別にconfirm()を
   呼んでいた。records-store.jsの削除確認だけは専用モーダルを持っていたが、
   それも含めてこの共通モーダルへ一本化する)。
   opts.message: 通常のテキスト確認(改行はそのまま表示)。
   opts.bodyHtml: 任意のHTML本文(ロット情報の要約表示等)。指定時はmessageより優先。
   opts.danger: trueで確定ボタンを危険色にする。文字列を渡した場合はmessage扱い。 */
function ensureConfirmModal(){
 let modal=$('#appConfirmModal');if(modal)return modal;
 modal=document.createElement('div');modal.className='record-modal';modal.id='appConfirmModal';modal.hidden=true;
 modal.innerHTML=`<div class="settings-dialog confirm-modal-dialog" role="dialog" aria-modal="true"><header><div><small id="appConfirmEyebrow">CONFIRMATION</small><h2 id="appConfirmTitle">確認</h2></div><button id="closeAppConfirm" type="button" aria-label="閉じる">×</button></header><div class="settings-body"><div id="appConfirmBody"></div><div class="settings-actions"><button id="appConfirmCancel" type="button">キャンセル</button><button id="appConfirmOk" type="button">OK</button></div></div></div>`;
 document.body.append(modal);
 return modal;
}
function confirmModal(opts){
 const o=typeof opts==='string'?{message:opts}:(opts||{});
 return new Promise(resolve=>{
  const modal=ensureConfirmModal();
  $('#appConfirmEyebrow').textContent=o.eyebrow||'CONFIRMATION';
  $('#appConfirmTitle').textContent=o.title||'確認';
  $('#appConfirmBody').innerHTML=o.bodyHtml!==undefined?o.bodyHtml:`<p class="confirm-modal-message">${esc(o.message||'')}</p>`;
  const cancel=$('#appConfirmCancel'),ok=$('#appConfirmOk'),close=$('#closeAppConfirm');
  cancel.textContent=o.cancelLabel||'キャンセル';ok.textContent=o.confirmLabel||'OK';ok.className=o.danger?'danger':'';
  modal.hidden=false;
  const finish=result=>{modal.hidden=true;resolve(result)};
  cancel.onclick=()=>finish(false);ok.onclick=()=>finish(true);close.onclick=()=>finish(false);
  modal.onclick=e=>{if(e.target===modal)finish(false)};
  requestAnimationFrame(()=>cancel.focus());
 });
}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#appConfirmModal')?.hidden){$('#appConfirmCancel')?.click()}},true);
function sourceValue(names){const r=S.measure?.source||S.measure?.snapshot?.source||{};for(const n of names){if(r[n]!==undefined&&r[n]!==null&&String(r[n]).trim()!=='')return String(r[n])}return ''}
// Database field normalization supports half-width/full-width variants such as ﾌﾟﾗｽ / プラス.
function normalizedFieldName(name){return String(name||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase()}
/* 複数の候補ソース(S.current/S.measure.source/スナップショット等)を横断して
   フィールド値を探す。全角半角ゆれはnormalizedFieldNameで吸収する。 */
function sourceField(names){
 const sources=[S.current,S.measure?.source,S.measure?.snapshot?.source,S.measure?.snapshot?.basic,S.measure?.basic].filter(x=>x&&typeof x==='object');
 for(const wanted of names){const wn=normalizedFieldName(wanted);for(const source of sources){for(const [key,value] of Object.entries(source)){if(normalizedFieldName(key)===wn&&value!==undefined&&value!==null&&String(value).trim()!=='')return String(value)}}}
 return '';
}
// Waiting feedback on the initial navigation. Yield one frame so acknowledgement appears immediately.
function nextPaint(){return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))}
function databaseLabel(key){return key==='SIKALOTNOW'?'仕掛一覧':key==='SIKALOTDEF'?'品質データ':key==='MASTER'?'マスタ':'データ'}
// Application equipment setting and design-course guard.
const APP_EQUIPMENT_KEY='AccessMeasurementConfiguredEquipment';
function currentConfiguredEquipment(){return String(localStorage.getItem(APP_EQUIPMENT_KEY)||'').trim()}
/* 更新対象者（ユーザーID）の管理。マスタ更新時にサーバーへ送信し記録する。 */
const USER_ID_KEY='AccessMeasurementUserId';
function currentUserId(){return String(localStorage.getItem(USER_ID_KEY)||'').trim()}
function setUserId(id){id=String(id||'').trim().slice(0,50);if(id)localStorage.setItem(USER_ID_KEY,id);return id}
/* ユーザーIDはこの端末を動かしているWindowsのログインIDを自動取得して
   使う(入力を求めない)。起動直後に一度だけ/api/whoamiへ問い合わせて
   キャッシュする。取得できるまでの短い間にマスタ更新が走った場合は、
   記録が空欄のまま残る(手入力プロンプトへは戻さない)。 */
async function fetchWhoami(){try{const r=await api('/api/whoami');return String(r.username||'').trim()}catch(_){return ''}}
queueMicrotask(async()=>{if(!currentUserId()){const name=await fetchWhoami();if(name)setUserId(name)}});
function ensureUserId(){return currentUserId()}
function withUserId(body){return Object.assign({},body||{},{user_id:ensureUserId()})}
function designCourseValue(){return sourceField(['設計_設備ｺｰｽ','設計_設備コース'])}
function actualCourseValue(){return sourceField(['実績_設備ｺｰｽ','実績_設備コース'])}
function residualCourseValue(){return sourceField(['残仕掛設備ｺｰｽ','残仕掛設備コース'])}
function normalizeCourseText(v){return String(v||'').normalize('NFKC').toUpperCase().replace(/[\s　]+/g,'')}
function equipmentIsInDesignCourse(equipment,course){const e=normalizeCourseText(equipment),c=normalizeCourseText(course);return !!e&&!!c&&c.includes(e)}
document.title='測定伝送システム';
/* ---------- ヘッダーの「今どこを見ているか」(§9.60) ----------
   以前はlist-view.jsのapplyTableData()だけが#fileNameへDBのファイル名を
   書いており、他の画面(データ一覧・スケジュール・ダッシュボード・カレンダー・
   マスタ管理)へ移っても消さなかった。そのため「データ一覧を見ているのに
   ヘッダーはSIKALOTNOW.sqlite3」という、直前に見たDBの名残がずっと残る
   状態になっていた。

   画面の名前(何を見ているか)を主、データの出どころ(どのファイル/どの範囲か)
   を副として出す。副が無い画面もあるので、その場合は主だけを出す。
   **画面を開く関数は必ずこれを呼ぶこと**(呼ばないと前の画面の名残が残る)。 */
function setHeaderContext(title,source){
 const t=document.querySelector('#fileName');if(t)t.textContent=title||'測定伝送システム';
 const s=document.querySelector('#headerContextSource');
 if(s){s.textContent=source||'';s.hidden=!source}
 // 画面が変わったら鮮度表示(一覧専用)は持ち越さない
 if(typeof window.updateListFreshness==='function'&&!source)window.updateListFreshness(null);
}
window.setHeaderContext=setHeaderContext;
/* ---------- 画面(ビュー)の登録簿 ----------
   トップレベルの画面(データ一覧・仕掛/品質・スケジュール・ダッシュボード・
   実績カレンダー・マスタ管理・帳票)は排他で、常にどれか1つだけが開いている。

   以前は各openXxxが「他の画面を全部閉じる」コードを自前で持っていた
   (6画面 × 約10行)。画面を1つ足すたびに既存の全ファイルへ退出処理を足す
   掛け算構造で、**§9.60(ヘッダー表示の取り残し)はこの構造の取りこぼし**。
   実際、統一する直前の時点で次の不揃いが残っていた:
     - #measureModal を閉じるのは6画面中3画面だけ
     - ナビの選択解除が #nav だけで #analysisNav / #planNav を取りこぼす画面が4つ
     - #qualityAnalysisPanel を隠すのは実績カレンダーだけ
   各画面は「自分の閉じ方と見出し」だけを登録し、切替の手順はenterView()に
   一本化する。これで退出処理の抜けが構造的に起きなくなる。 */
const VIEW_REGISTRY=new Map();
function registerView(def){VIEW_REGISTRY.set(def.key,def);return def}
window.registerView=registerView;
/* 新しい画面へ入る。key以外の登録済み画面を全て閉じ、ナビの選択状態・
   ヘッダー表示・bodyクラスを新しい画面のものへ揃える。
   **画面を開く関数は、自分の描画を始める前にこれを1回呼ぶこと。**
   opts.header で見出しを差し替えられる(同じ画面で見出しが変わる場合)。 */
function enterView(key,opts){
 VIEW_REGISTRY.forEach((v,k)=>{
  if(k===key)return;
  // 1つの画面の終了処理が例外を投げても、残りの画面は必ず閉じる
  // (閉じ残しは画面の重なりとして必ず表に出るため、握り潰さず警告は出す)。
  try{v.exit?.()}catch(e){console.warn('画面の終了処理で例外',k,e)}
 });
 // 画面をまたいで残ると重なるオーバーレイ。閉じるのは全画面共通。
 document.getElementById('measureModal')?.setAttribute('hidden','');
 // ナビの選択は排他。どのナビ群に置かれたボタンでも一度全部外す。
 document.querySelectorAll('aside .nav-item,#nav button.db,#analysisNav button.db,#planNav button.db')
  .forEach(b=>b.classList.remove('active'));
 const def=VIEW_REGISTRY.get(key);
 if(!def)return null;
 if(def.bodyClass)document.body.classList.add(def.bodyClass);
 if(def.nav)document.getElementById(def.nav)?.classList.add('active');
 const h=opts?.header||def.header;
 if(h)setHeaderContext(h[0],h[1]);
 return def;
}
window.enterView=enterView;
/* 画面の切替としての`selectDb()`と、ある画面が自分の中身を組み立てるために
   一覧を読み直すだけの`selectDb()`を区別する。後者(スケジュールの分割表示)で
   画面の切替を起こすと、組み立て中のスケジュール画面自身が畳まれてしまう。
   「scheduleモードかつ設備選択済みなら閉じない」という**状態**による代用は
   避けること——それだと利用者がサイドバーの「仕掛(現在)」を押して一覧へ
   移ったつもりでも、スケジュールパネルと幅調整の分割バーが残る
   (実際に報告された不具合。schedule-view.jsのコメント参照)。判定は
   あくまで「呼び出し元が内部かどうか」で行う。 */
let internalDbSwitchDepth=0;
async function withInternalDbSwitch(fn){
 internalDbSwitchDepth++;
 try{return await fn()}finally{internalDbSwitchDepth--}
}
function isInternalDbSwitch(){return internalDbSwitchDepth>0}
window.withInternalDbSwitch=withInternalDbSwitch;
window.isInternalDbSwitch=isInternalDbSwitch;
/* レコードのstatus文字列からバッジ用のCSSクラス/表示ラベルを求める共通関数。
   以前はcalendar-view.js/report-dashboard.jsに同一内容が重複定義され、
   records-store.jsは一覧行のレンダリングで同じ判定をインラインで
   再実装していた(コア5ファイル内での同名関数の再定義を避ける方針のため一本化)。 */
function statusClass(s){return s==='完了'?'done':s==='測定値NG'?'ng':''}
function statusLabel(s){return s||'編集中'}
/* 一覧グリッドのように表示幅が狭い場所向けの短縮ラベル(NG登録のみ「NG」と省略)。 */
function statusShortLabel(s){return s==='測定値NG'?'NG':statusLabel(s)}
function durationMs(record){const a=record?.workTime?.startAt,b=record?.workTime?.endAt;if(!a||!b)return null;const ms=new Date(b)-new Date(a);return Number.isFinite(ms)&&ms>=0?ms:null}
function formatDuration(ms){if(ms===null||ms===undefined)return '-';const sec=Math.floor(ms/1000),h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return `${h}時間 ${m}分 ${s}秒`}
/* Measurement precision and zero-order-tolerance correction. */
function measurementDigits(key){return key==='thickness'?3:key==='width'?1:null}
function fixedMeasurementValue(key,value){const raw=String(value??'').trim(),digits=measurementDigits(key);if(raw===''||digits===null)return raw;const n=Number(raw);return Number.isFinite(n)?n.toFixed(digits):raw}
function fixedToleranceValue(kind,value){const n=Number(value);if(!Number.isFinite(n))return '-';return n.toFixed(kind==='thickness'?3:1)}
/* Final title guard for delayed initialization and browser history restoration. */
function enforceApplicationTitle(){if(document.title!=='測定伝送システム')document.title='測定伝送システム'}
enforceApplicationTitle();window.addEventListener('pageshow',enforceApplicationTitle);document.addEventListener('visibilitychange',()=>{if(!document.hidden)enforceApplicationTitle()});
/* ウォッチドッグ用ハートビート。読み込みのたびに固有IDを発行し、開いている
   間は定期的にバックエンドへ生存信号を送る。タブを閉じる・別ページへ
   移動する際はpagehideで即座に終了通知(close)を送り、そのタブが無くなった
   ことを明示的に伝える。ブラウザを閉じ忘れた場合はサーバー側のウォッチ
   ドッグがFlaskプロセスを自動終了し、プロセスの残存(ゾンビ化)を防ぐ
   (サーバー側: backend/config.py EMPTY_GRACE_SEC)。単なる通信瞬断
   (Wi-Fi切断等)ではタブは消えたことにならないため誤って終了しない
   (サーバー側: HEARTBEAT_STALE_SEC)。応答は見ないため失敗しても無視する
   (サーバー再起動中の一時断等)。
   IDは毎回の読み込みで新規発行し、sessionStorageへは保存しない。
   sessionStorageはタブの複製・「閉じたタブを開き直す」操作で新しいタブへ
   コピーされてしまうため、それで保存していると2つのタブが同じIDを共有
   してしまい、片方だけを閉じても(もう一方が生きているにも関わらず)
   サーバー側がそのIDを「消えた」と扱ってしまう恐れがある。IDの安定性は
   リロードをまたいで保つ必要が無い(サーバー側は「1件でも生きているIDが
   あるか」しか見ておらず、リロードのpagehideで一瞬0件になっても直後の
   新しいIDのハートビートでEMPTY_GRACE_SEC以内に復帰する)ため、
   セッションをまたいだ永続化自体が不要だった。 */
const WATCHDOG_TAB_ID=(crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`);
/* ハートビートは「こちらが生きている」ことを伝えるだけでなく、その応答から
   「サーバーが生きているか」も分かる。応答が続けて途絶えたら画面最上部へ
   明示する。サーバーが終了していても画面は普通に見えてしまい、操作して
   初めてエラーになる状態を避けるため(仕様書2.9)。
   1回の失敗では出さない(サーバー再起動中の一時断や瞬断で出さないため)。 */
const HEARTBEAT_INTERVAL_MS=15000, HEARTBEAT_FAIL_LIMIT=2;
let heartbeatFailures=0;
function setConnectionLost(lost){
 const bar=document.getElementById('connectionLost');
 if(bar)bar.hidden=!lost;
 document.body.classList.toggle('connection-lost',lost);
}
async function sendHeartbeat(){
 try{
  const res=await fetch(`/api/heartbeat?tab=${encodeURIComponent(WATCHDOG_TAB_ID)}`,{method:'POST',cache:'no-store',keepalive:true});
  if(!res.ok)throw Error('HTTP '+res.status);
  heartbeatFailures=0;setConnectionLost(false);
 }catch(e){
  heartbeatFailures++;
  if(heartbeatFailures>=HEARTBEAT_FAIL_LIMIT)setConnectionLost(true);
 }
}
sendHeartbeat();setInterval(sendHeartbeat,HEARTBEAT_INTERVAL_MS);
document.addEventListener('DOMContentLoaded',()=>{
 const btn=document.getElementById('connectionLostReload');
 if(btn)btn.onclick=()=>location.reload();
});
/* pagehideが本来カバーする範囲(bfcache入りも含む)の方が広いはずだが、
   実機でタブを閉じてもサーバーが終了しない事例があったため、念のため
   unloadでも同じ終了通知を送る(ブラウザ実装差の保険。同じtab idへの
   重複DELETE相当の呼び出しになるだけで、副作用は無い)。 */
function notifyTabClosed(){try{navigator.sendBeacon(`/api/heartbeat/close?tab=${encodeURIComponent(WATCHDOG_TAB_ID)}`)}catch(e){}}
window.addEventListener('pagehide',notifyTabClosed);
window.addEventListener('unload',notifyTabClosed);

/* 左ナビ(aside)の幅をドラッグでリサイズできるようにする。#navResizeHandle
   を<aside>の直後(<main>の前)へ挿入するだけで、.layoutのgrid-template-
   columnsが3列(--nav-w 4px 1fr)構成のため、既存のDOM構造(aside/main)を
   壊さずに挟み込める。幅はlocalStorageへ保存し次回も再現する。 */
(function(){
 const aside=document.querySelector('.layout>aside');
 if(!aside||!aside.parentNode)return;
 let navWidth=(()=>{try{const v=+localStorage.getItem('navWidthV1');return v>0?v:242}catch(e){return 242}})();
 function apply(){document.documentElement.style.setProperty('--nav-w',navWidth+'px')}
 apply();
 /* 畳む/開く(§9.58)。畳んだときは**アイコンだけの細い帯**にする。
    完全に隠すと戻す手段を別に置く必要があり、どこへ戻るかも分からなく
    なるため、行き先(アイコン)は常に見えている形を選ぶ。
    幅は畳んだ状態と開いた状態で別々に覚える(開き直したとき、利用者が
    自分で決めた幅へ戻る)。 */
 const NAV_COLLAPSED_KEY='navCollapsedV1';
 const NAV_RAIL_W=54;
 let collapsed=(()=>{try{return localStorage.getItem(NAV_COLLAPSED_KEY)==='1'}catch(e){return false}})();
 function applyCollapsed(){
  document.body.classList.toggle('nav-collapsed',collapsed);
  document.documentElement.style.setProperty('--nav-w',(collapsed?NAV_RAIL_W:navWidth)+'px');
  if(toggle){
   toggle.setAttribute('aria-expanded',String(!collapsed));
   toggle.title=collapsed?'メニューを開く':'メニューを畳む';
  }
  /* 畳んでいる間はラベルが出ないので、行き先はツールチップで示す。
     元のtitle(説明文)を持つ項目は説明も残す。
     退避済みかの判定は`undefined`で見ること。**元のtitleが空の項目は
     `!b.dataset.navTitle`が真になり**、2回目以降(下のMutationObserver等)で
     退避値を「適用済みのラベル」で上書きしてしまい、開いても戻らなくなる。 */
  document.querySelectorAll('aside .nav-item').forEach(b=>{
   const label=(b.querySelector('span')||{}).textContent.trim()||'';
   if(collapsed){
    if(b.dataset.navTitle===undefined)b.dataset.navTitle=b.title||'';
    const orig=b.dataset.navTitle;
    b.title=label?(orig?label+'：'+orig:label):orig;
   }
   else if(b.dataset.navTitle!==undefined)b.title=b.dataset.navTitle;
  });
 }
 const toggle=document.createElement('button');
 toggle.type='button';toggle.id='navCollapseToggle';toggle.className='nav-collapse-toggle';
 toggle.innerHTML='<span aria-hidden="true"></span>';
 const brand=aside.querySelector('.brand');
 if(brand)brand.appendChild(toggle);else aside.prepend(toggle);
 toggle.addEventListener('click',()=>{
  collapsed=!collapsed;
  try{localStorage.setItem(NAV_COLLAPSED_KEY,collapsed?'1':'0')}catch(e){/* 保存できなくても切替は効く */}
  applyCollapsed();
 });
 applyCollapsed();
 /* カレンダー・ダッシュボード・DB一覧のナビ項目は、base.jsより後に読まれる
    ファイルが動的に足す。畳んだ状態で足されるとツールチップが付かないため、
    追加を監視して付け直す。監視するのはchildListだけなので、applyCollapsed
    自身のtitle書き換え(属性変更)では再帰しない。 */
 new MutationObserver(ms=>{
  if(ms.some(m=>[...m.addedNodes].some(n=>n.nodeType===1&&
     (n.classList?.contains('nav-item')||n.querySelector?.('.nav-item')))))applyCollapsed();
 }).observe(aside,{childList:true,subtree:true});

 const handle=document.createElement('div');
 handle.id='navResizeHandle';handle.title='ドラッグでメニュー幅を変更';
 aside.insertAdjacentElement('afterend',handle);
 handle.addEventListener('mousedown',e=>{
  if(collapsed)return;          // 畳んでいる間は幅を変えない(開いてから変える)
  e.preventDefault();
  const startX=e.clientX,startW=navWidth;
  handle.classList.add('dragging');
  function onMove(ev){
   navWidth=Math.min(Math.max(180,startW+(ev.clientX-startX)),480);
   applyCollapsed();
  }
  function onUp(){
   document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);
   handle.classList.remove('dragging');
   try{localStorage.setItem('navWidthV1',String(navWidth))}catch(err){/* 保存できなくても表示自体は継続する */}
  }
  document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
 });
})();

/* ---------- 表示サイズ(5段階、アプリ全体) ----------
   文字サイズ・コントロールの高さ・一覧の行の高さは、すべてapp.cssの
   :rootトークンが--ui-scaleを掛けた値で決まる(docs/ARCHITECTURE.md
   「コントロールサイズの統一」)。ここではその倍率を選ぶ段階を
   html[data-ui-size]へ流し込むだけで、個別の画面には一切手を入れない。
   以前は作業スケジュール画面だけに「高密度」トグルがあり、他の画面の
   文字サイズは調整できなかった(画面ごとにサイズ感がばらつく原因)。
   base.jsは読み込み順の先頭(=他のJSが画面を組み立てる前)に走るため、
   ここでhtmlへ属性を付けておけば、後から描かれる画面も最初から正しい
   サイズで組み上がる。 */
const UI_SIZE_KEY='MeasurementUiSizeV1';
const UI_SIZES=[
 {key:'xs',label:'極小',hint:'一度に見える情報量を最優先'},
 {key:'sm',label:'小',hint:'情報量を少し優先'},
 {key:'md',label:'中',hint:'標準'},
 {key:'lg',label:'大',hint:'読みやすさを少し優先'},
 {key:'xl',label:'特大',hint:'読みやすさを最優先'},
];
function currentUiSize(){
 try{const v=localStorage.getItem(UI_SIZE_KEY);if(UI_SIZES.some(s=>s.key===v))return v}catch(e){}
 return 'md';
}
function applyUiSize(key){
 const size=UI_SIZES.some(s=>s.key===key)?key:'md';
 document.documentElement.dataset.uiSize=size;
 try{localStorage.setItem(UI_SIZE_KEY,size)}catch(e){/* 保存できなくても表示自体は継続する */}
 const label=document.getElementById('uiSizeLabel');
 if(label)label.textContent=(UI_SIZES.find(s=>s.key===size)||{}).label||'中';
 document.querySelectorAll('#uiSizeMenu [data-ui-size-option]').forEach(b=>{
  b.classList.toggle('is-current',b.dataset.uiSizeOption===size);
 });
}
applyUiSize(currentUiSize());
window.applyUiSize=applyUiSize;

/* 表示サイズの選択ポップオーバー。モードバッジ(.access-mode-menu)と同じ
   「小さなボタン→権限/選択肢を並べたポップオーバー」の言語で揃える
   (アプリ内で同じ役割のUIは同じ見た目・同じ操作にする)。 */
(function(){
 function closeMenu(){
  document.getElementById('uiSizeMenu')?.remove();
  document.removeEventListener('click',onOutside,true);
 }
 function onOutside(e){
  const menu=document.getElementById('uiSizeMenu');
  if(menu&&!menu.contains(e.target)&&!e.target.closest('#uiSizeBadge'))closeMenu();
 }
 function openMenu(anchor){
  closeMenu();
  const menu=document.createElement('div');
  menu.className='access-mode-menu ui-size-menu';menu.id='uiSizeMenu';
  const cur=(typeof currentUiSize==='function')?currentUiSize():'md';
  UI_SIZES.forEach(s=>{
   const btn=document.createElement('button');
   btn.type='button';btn.dataset.uiSizeOption=s.key;
   if(s.key===cur)btn.classList.add('is-current');
   btn.innerHTML=`<span><i class="ui-size-swatch" data-swatch="${s.key}" aria-hidden="true">Ａ</i>${s.label}</span><small>${s.hint}</small>`;
   btn.addEventListener('click',()=>{applyUiSize(s.key);closeMenu()});
   menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  const rect=anchor.getBoundingClientRect();
  menu.style.top=`${rect.bottom+6}px`;
  menu.style.left=`${Math.max(8,rect.right-menu.offsetWidth)}px`;
  requestAnimationFrame(()=>document.addEventListener('click',onOutside,true));
 }
 document.addEventListener('click',e=>{
  const t=e.target.closest('#uiSizeBadge');if(!t)return;
  if(document.getElementById('uiSizeMenu')){closeMenu();return}
  openMenu(t);
 });
 // ラベルの初期表示(applyUiSizeはDOM構築前に走るため、ここで一度描き直す)。
 if(typeof applyUiSize==='function'&&typeof currentUiSize==='function')applyUiSize(currentUiSize());
})();
