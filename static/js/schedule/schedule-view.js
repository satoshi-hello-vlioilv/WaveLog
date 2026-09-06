"use strict";
/* schedule-view.js: 作業スケジュール画面(順次作業表示、docs/decisions/ の §9)。

既存のcal-mode/rp-mode/db-modeと同じ「メイン画面の表示切り替え」方式で、
#grid の兄弟要素としてパネルを差し込みbody.sc-modeで他要素を隠す
(report-dashboard.js/calendar-view.jsと同じ実装パターン)。

モード別の差分(§9.6):
  edit     自端末の使用設備で固定表示(設備セレクタ無し)。現場段取り可否が
           真の端末だけドラッグ並べ替え可(§9.4.1の簡易表示、追加パネル等は出さない)
  view     全設備選択可(▾)。読み取り専用
  schedule 全設備選択可(▾)。追加・並べ替え・設備停止投入が可能

時刻展開・実績突合はbackend/schedule_calc.py(GET /api/schedule/plan)が
行う。ここは表示に徹する(CLAUDE.mdの「関数の定義は1箇所」、§7.1)。

── このファイルを分割しない理由(docs/REFACTORING_PLAN.md フェーズ3.2) ──
2,600行あるが、実測の結果**分割しない**と決めた。4分割案(core/board/
timeline/split)で測ると、トップレベル定義185個のうち63個(34%)がファイルを
またぐ共有インターフェースになり、しかも依存が双方向になる(core↔split、
core↔timeline、board↔timeline)。`scState`だけで193箇所から参照される。
「1つの大きなファイル」を「読み込み順に依存する63個の暗黙の契約を持つ
4ファイル」に置き換えることになり、フェーズ2で解消したばかりの問題を
作り直してしまう。measure-worklog.jsの分割(相互参照ゼロ)とは事情が違う。
代わりに下の節目次で辿れるようにする(app.cssと同じ扱い)。

── 節目次 ──
   37 読込結果のキャッシュ(§9.42)      973 予定一覧の取得・描画
  108 パネルDOM                       1324 見積の内訳(§6.8/§9.3)
  206 分割表示(§9.10)                 1343 固定開始日時(§5.1/§7.3)
  373 .sc-sideの折りたたみ(§9.13)     1369 日時ロック(§9.38)
  394 汎用フローティング窓(§9.16)     1384 高密度リスト表示(§9.3)
  455 仕掛一覧のポップアップ(§9.14)   1457 実施中/予定/実績のグルーピング(§9.34)
  519 ドロップ受入(§9.10)             1478 区分と並び順(§9.39)
  577 ビュー排他制御                   1530 まとめ方(§9.40)
  642 全体/個別の表示切替(§9.9)       1785 書込キュー(§9.11)
  730 ロック表示(§9.3)                2007 ドラッグ並べ替え(§7.5/§9.4)
  749 編集セッション(§9.11)           2096 追加パネル(§9.3)
  872 全体俯瞰ボード(§9.9)            2162 設備停止のポップアップ(§9.13)
                                      2208 列表示マスタ(§9.18)
                                      2307 内容欄の項目マスタ
                                      2493 予定から測定を開始(§9.35)
                                      2643 ナビ
*/
(function(){
 if(typeof $!=='function')return;

 // historyHours(§9.34「表示範囲」): 完了した予定・計画外実績を、今から
 // 何時間前までさかのぼって表示するか。既定8時間。同じ値をサーバーへも
 // 送り、計画外実績(§9.33)の合成範囲と画面の表示範囲を必ず一致させる
 // (画面だけで絞ると「サーバーが返したのに出ない」行が生まれて紛らわしい)。
 const SC_HISTORY_CHOICES=[2,4,8,24,72];
 const SC_HISTORY_KEY='ScheduleHistoryHoursV1';
 function loadHistoryHours(){
  try{
   const v=Number(localStorage.getItem(SC_HISTORY_KEY));
   if(SC_HISTORY_CHOICES.includes(v))return v;
  }catch(e){WL.quiet.note('保存値が壊れていても既定で続行する',e)}
  return 8;
 }
 let scState={equipment:'',entries:[],anchor:null,anchorRounded:null,warnings:[],configured:true,
              editable:false,pickerEnabled:false,stopReasons:[],dragId:null,insertBefore:'',
              editingComment:null,   // 申し送りをその場で書いている行のID(§9.191)
              focusComment:null,     // 落として入れた枠。描き終わりで開く
              /* まとめて外す(§9.170)。選んだ予定のid(文字列)と、掴んでいる
                 最中の「まとめて運んでいる一式」。単発の並べ替えと混ざらない
                 よう、複数を掴んでいる間は dragIds に入れて dragId と
                 見分ける(dragIdだけを見ている既存の経路を壊さない)。 */
              picked:new Set(),dragIds:null,
              boardMode:'single',boardWindowHours:24,overview:[],overviewSort:'order',
              sessionHeld:false,sessionHolder:null,sessionError:null,
              /* 在席（誰が編集権を持っているか。§9.211 ②）。
                 `sessions`は**配列＝読めた／`null`＝読めなかった**で、
                 「読めなかった」を「誰も居ない」と同じに扱わないこと。 */
              sessions:null,me:null,sessionsConfigured:true,
              canStartWork:false,historyHours:loadHistoryHours(),groupMode:'none',
              /* クエリ結合(§9.193)で足された列の名前。予定がまだ無い設備でも
                 内容欄の候補に出せるよう、行ではなくここに持つ。 */
              joinColumns:[]};
 /* ---------- 読込結果のキャッシュ(§9.42) ----------
    共有スケジュールDBと実績バックアップはネットワーク共有上にあり、開くたびに
    読み直すと待たされる。**一度読んだら保持し、画面を開き直しただけでは
    読み直さない**。読み直すのは次の3つだけ:
      - 予定を変える操作をしたとき(追加・削除・並べ替え・ロック・作業開始)
      - ヘッダーの「再計算」を押したとき
      - 設備を切り替えて、その設備をまだ一度も読んでいないとき
    いつ時点の状態かはヘッダーに出す(古い情報を黙って見せないため)。 */
 const scPlanCache=new Map();   // 設備名 -> {entries,anchor,warnings,loadFactor,fetchedAt}
 let scOverviewCache=null;      // {rows,fetchedAt}
 /* ---------- 取得中の応答は「いつの分か」で捨てる(§9.200) ----------
    予定を変えるとキャッシュは捨てるが、**そのとき既に飛んでいるGETは
    止められない**。返ってきたのは変更前の内容なので、素直にキャッシュへ
    入れると「画面では動いたのに、画面を切り替えて戻ると元へ戻る」
    （実機で報告）。世代を1つ持ち、**取りに行った時点と戻ってきた時点で
    世代が違えば捨てる**。件数や設備名で見分けようとしないこと——
    並べ替えは件数が変わらないので見分けられない。 */
 let scPlanGen=0;
 const planGen=()=>scPlanGen;
 function invalidatePlanCache(equipment){
  scPlanGen++;
  if(equipment)scPlanCache.delete(equipment);else scPlanCache.clear();
  scOverviewCache=null;  // 俯瞰ボードの残作業量も変わる
  // 作業可否(§9.51)の判定材料も一緒に捨てる。予定を取り直すのに残コースが
  // 古いままだと、フラグだけ前回の状態で残る。
  if(typeof invalidateWorkable==='function')invalidateWorkable();
 }
 window.invalidateSchedulePlanCache=invalidatePlanCache;
 /* 測定画面(スケジュールの上に重なる)を閉じたときに呼ばれる。作業の開始・
    保存・完了はサーバーのバックアップを変えるが、既に描かれている行はそれを
    知らない。スケジュールを開いたままなら描き直して即時に反映させる。
    開いていなければ何もしない(次に開くときキャッシュ破棄済みなので取り直す)。 */
 WL.refreshScheduleIfOpen=function(){
  if(!document.body.classList.contains('sc-mode'))return;
  /* 測定を閉じた拍子の描き直し。列幅を掴んでいる最中なら待たせる
     （§9.211 ①。掴んだまま別の窓を閉じることは実際に起きる）。 */
  WL.columnResize.defer('schedule:refreshIfOpen',()=>{
   if(scState.boardMode==='board')loadOverviewBoard();
   else if(scState.equipment)refreshAll(true);
  });
 };
 function fmtFetchedAt(ts){
  if(!ts)return '';
  const min=Math.floor((Date.now()-ts)/60000);
  const hm=new Date(ts).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
  return min<1?`${hm} 時点(たった今)`:`${hm} 時点(${min}分前)`;
 }
 /* ---------- 読み込みの内訳(§9.198) ----------
    「読み込みが遅い」は**どこが遅いのかで打つ手がまるで違う**（共有の
    取り込みならネットワーク、実績の突合なら測定データの量、結合なら
    クエリ結合マスタ）。サーバーが返した内訳をそのまま出し、**遅いときだけ
    見えるところへ出す**——速いときに毎回ミリ秒を並べても読まれない。 */
 let scLastTimings=null;
 const SC_SLOW_MS=WL.slowLoadMs;   // 「遅い」の答えは base.js の1箇所（§9.340）
 const SC_TIMING_LABEL={snapshot:'共有の取り込み',rows:'予定の読み出し',
   actual:'実績の突合',expand:'時刻の展開',join:'クエリ結合',total:'合計'};
 function timingLines(t){
  if(!t)return [];
  const out=[];
  ['snapshot','rows','actual','expand','join'].forEach(k=>{
   if(t[k]==null)return;
   out.push(`　${SC_TIMING_LABEL[k]}: ${Math.round(t[k])}ms`);
  });
  if(t.total!=null)out.unshift(`読み込み ${(t.total/1000).toFixed(1)}秒`
    +(t.rowCount!=null?`（${t.rowCount}件）`:''));
  return out;
 }
 /* 内訳から「次にすること」を1つだけ言う(§2)。数字だけ出しても打つ手が
    分からないので、いちばん重い工程に応じて助言を変える。 */
 function timingAdvice(t){
  if(!t||t.total==null)return '';
  const cand=[['snapshot','共有フォルダからの取り込みに時間がかかっています。マスタ管理 > 共通設定の「共有の見張り」の間隔を延ばすと、取り込む回数を減らせます。'],
              ['actual','測定データが多く、実績の突合に時間がかかっています。「表示」→「さかのぼり」を短くすると軽くなります。'],
              ['join','クエリ結合の相手を引くのに時間がかかっています。マスタ管理 > クエリ結合で、要らない結合を無効にできます。'],
              ['expand','予定の件数が多く、時刻の展開に時間がかかっています。完了した予定を整理すると軽くなります。']];
  let worst=null;
  cand.forEach(([k,msg])=>{const v=t[k];if(v!=null&&(!worst||v>worst[0]))worst=[v,msg]});
  return worst&&worst[0]>=SC_SLOW_MS*0.4?worst[1]:'';
 }
 /* ---------- 表示範囲の起点(§9.198、利用者の指示) ----------
    「過去の長さを指定できるが、現在か過去か書いていないので分かりにくい」。
    選択肢を「いまから過去◯時間」と言い切り、**実際の起点の日時**を横に出す
    ——時間数だけでは、いま何時なのかを頭の中で引き算しないと分からない。
    **未来の予定は範囲に関わらず全部出る**ことも書く（範囲を短くすると
    先の予定まで消えると誤解されるため）。 */
 function updateHistoryFromUi(){
  const el=$('#scHistoryFrom'),wrap=$('#scHistoryRange');
  if(!el)return;
  if(!wrap||wrap.hidden){el.hidden=true;return}
  const from=new Date(historyCutoff());
  el.hidden=false;
  el.textContent=`＝ ${fmtDateTime(from.toISOString())} 以降`;
  el.title=`済んだ行（完了・取消・計画外の実績）は、この日時より後のものだけを出しています`
   +`（いまから過去${scState.historyHours}時間）。\nこれからの予定は、さかのぼりに関わらずすべて出ます。`;
 }
 /* ---------- 再計算の基準時刻(§9.198、利用者の指示) ----------
    「現在時刻を5分刻みに変換して、計算の開始時刻の見栄えを良くしてほしい」。
    丸めるのはサーバー(schedule_calc)で、こちらは**丸めたことを書く**役。
    黙って5分ずれた時刻を出すと「時計と合っていない」と読まれる。 */
 function updateRefreshHint(){
  const btn=$('#scRefresh');if(!btn)return;
  const lines=['いまの時刻を基準に、予定の開始・終了を計算し直します。',
               '作業できるかどうかの判定材料（仕掛データ）も取り直します。'];
  const a=scState.anchorRounded;
  if(a&&a.to){
   lines.push(`基準時刻: ${fmtDateTime(a.to)}`
    +`（現在時刻 ${fmtDateTime(a.from)} を${a.unitMinutes}分刻みへ切り上げ）`);
  }else if(scState.anchor){
   lines.push(`基準時刻: ${fmtDateTime(scState.anchor)}`);
  }
  btn.title=lines.join('\n');
 }
 /* ---------- 「いつのデータか」に答えるチップは1つ ----------
    （§9.300 ①、利用者の指示「一番上の表示も含めて冗長な重複した表示内容や
    やたら長い説明のコメントがそのままボタンになっているものなど見直し、
    主要機能を1行にまとめてください」）

    以前は**同じ問いに2つのチップ**が並んでいた——`#scFreshness`
    「21:36 時点(たった今)」（この画面が読み込んだ時刻）と、`#scSyncChip`
    「共有: 1秒前に取込 ・ 書込役: このPC」（サーバーが共有を写した時刻と
    書く役）。実測で操作列1424pxのうち**353px＝25%**をこの2つが占めており、
    しかも読む側からは「どちらを見ればよいのか」が分からない
    （§CLAUDE 8「同じ情報を2箇所に出さない」——似た数字が並ぶと、読む側は
    違うものかもしれないと数え直すことになる）。

    いまは**チップは1つ**（`#scSyncChip`）。文字に出すのは
    **この画面が読んだ時刻**だけで、共有の取り込み・書込役・改訂番号は
    **押すと開く浮きメニュー**が持つ——§9.292 ③でメニュー側は既に全部
    答えていたので、足りなかったのは「畳むこと」だけだった。
    **打つ手はメニューの足元に2つ**（「読み直す」＝この画面／
    「いま取り込む」＝共有）。読む場所と打つ手を同じところに置く（§4）。

    **異常だけは文字にも出す**（§3。色だけで伝えない）。 */
 let scFetchedAt=null;
 function updateFreshnessUi(ts){scFetchedAt=ts||null;renderSyncChip()}
 /* 画面の外から内訳を見る口（DOMを掘らずに確かめられるようにしておく）。 */
 WL.scheduleLoadTimings=()=>(scLastTimings?Object.assign({},scLastTimings):null);
 /* ---------- 共有の見張り(§9.188) ----------
    共有(Box等)のschedule.sqlite3は他の端末も書く。サーバーは改訂番号だけを
    見て**変わったときだけ**手元へ写す(backend/schedule_watch.py)ので、
    画面はその状態を出し、変わったことに気づいたら読み直す。

    **勝手に読み直さない場面がある**——掴んで動かしている最中・選んでいる
    最中・書込を待っている最中に行が入れ替わると、何をしていたか分からなく
    なる。そのときは帯で知らせて、押されたら読み直す。 */
 let scSyncTimer=null,scSyncSeen=null,scSyncState=null,scOwnerState=null,scOwnerTick=0;
 function syncChipText(st){
  if(!st||!st.configured)return '';
  if(!st.enabled)return '共有: 読むたび取込';
  /* **短く言う**(§9.199)。「〜に取り込み」はチップの役目そのものなので
     文字にしなくても読める。詳しい説明は`title`が持っている。 */
  const age=st.snapshotAgeSec;
  const when=age==null?'まだ取込なし'
            :age<60?`${Math.round(age)}秒前に取込`
            :`${Math.round(age/60)}分前に取込`;
  return `共有: ${when}`;
 }
 /* 書き込み役(§9.192)。**入れている現場でだけ出す**——使っていない現場に
    「持ち主」という覚える言葉を増やさない。色だけで伝えないので、
    このPCなのか他のPCなのかを必ず文字で書く。 */
 function ownerChipText(o){
  if(!o||!o.enabled||!o.configured)return '';
  if(o.isOwner)return '書込役: このPC';
  if(o.ownerPc)return `書込役: ${o.ownerPc}`;
  return '書込役: 探しています';
 }
 function ownerChipTitle(o){
  if(!o||!o.enabled||!o.configured)return [];
  const lines=['共有ファイルへ実際に書くのは1台だけです（他のPCはその1台へ書き込みを頼みます）。'];
  if(o.isOwner)lines.push(`このPCが書込役です（受け口 ${(o.myUrls||[]).join(' / ')}）。`);
  else if(o.ownerPc)lines.push(`書込役は ${o.ownerPc}${o.ownerLogin?`（${o.ownerLogin}）`:''} です`
                               +`${o.ownerUrl?` / ${o.ownerUrl}`:''}。`);
  else lines.push('書込役がまだ決まっていません（決まるまでは各PCが自分で書きます）。');
  if(o.ownerAliveSec!=null)lines.push(`最後の生存確認: ${Math.round(o.ownerAliveSec)}秒前（期限 ${o.ttlSec}秒）`);
  if(o.relays)lines.push(`頼んだ回数: ${o.relays}回${o.relayFail?` / 届かなかった: ${o.relayFail}回`:''}`);
  if(o.lastError)lines.push(`最後のエラー: ${o.lastError}（届かないあいだは自分で書きます）`);
  return lines;
 }
 /* ---------- 同期のタイミング(§9.292 ③、利用者の指示「定期的にスケジュールの
    同期をしないといけないのでスケジュールデータの同期タイミングについて
    わかるようにしてください」) ----------
    仕組みは§9.188で既にあり、`/api/schedule/sync-status`が全部答えている
    ——足りなかったのは**届く範囲**だった。チップに出ていたのは「12秒前に
    取込」の1つだけで、**次はいつなのか・見張りは動いているのか・間隔は
    いくつか**は`title`の中にしか無かった（触る画面では読めない・§4）。

    出し方は**一覧の鮮度チップと同じ言語**にそろえる（§9.286 ④「押すと
    再読込のメニューが開く」）——同じ「いつのデータか」を、画面ごとに違う
    出し方にしない。押すと開くのは浮きメニューで、そこに
    「見張り・間隔・次の確認・最後の取込・最後の確認・改訂番号・書込役」を
    **時刻と経過の両方**で並べ、いちばん下に「いま取り込む」を置く。

    **秒読みはしない**——巡回は10秒ごとなので1秒刻みの数字は必ずずれる。
    「およそ◯秒後」と幅で言う（§3。嘘の精度を出さない）。 */
 const clockOf=age=>{
  if(age==null)return '';
  const d=new Date(Date.now()-age*1000);
  const two=n=>String(n).padStart(2,'0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
 };
 const agoOf=age=>{
  if(age==null)return '—';
  const s=Math.round(age);
  if(s<60)return `${s}秒前`;
  if(s<3600)return `${Math.round(s/60)}分前`;
  return `${Math.round(s/3600)}時間前`;
 };
 /* 次に確かめるまで。**見張りが動いているときだけ答える**——止まっている
    のに「30秒後」と書くと、待てば来ると読まれる（来ない）。 */
 function nextCheckText(st){
  if(!st||!st.configured)return '';
  if(!st.enabled)return '見張りを使わない設定です（読むたびに共有を見にいきます）';
  if(!st.running)return '見張りがまだ動いていません（次の書き込み・再読込のときに取り込みます）';
  if(st.pausedForSec)return `取り込んだ直後の休み中です（およそ ${Math.round(st.pausedForSec)}秒後 に再開）`;
  const left=Math.max(0,Math.round((st.intervalSec||0)-(st.verifiedAgeSec||0)));
  return left<=1?'まもなく確かめます':`およそ ${left}秒後`;
 }
 /* この画面が読み込んだ時刻。**共有の取り込みとは別のこと**——サーバーが
    共有を写した時刻と、この画面がサーバーから受け取った時刻は違う（写した
    あとに画面を開いていなければ、画面のほうが古い）。打つ手も別で、
    こちらは「読み直す」・あちらは「いま取り込む」。 */
 function screenReadRows(){
  const t=scLastTimings;
  const rows=[syncMenuRow('この画面の読込',
    scFetchedAt?fmtFetchedAt(scFetchedAt):'まだ読み込んでいません',
    t&&t.total!=null
      ?`読み込み ${(t.total/1000).toFixed(1)}秒`+(t.rowCount!=null?`（${t.rowCount}件）`:'')
      :'「読み直す」で最新を取り直します')];
  /* **遅かったときだけ内訳を出す**（§9.198。速いときに毎回ミリ秒を
     並べても読まれない）。打つ手は`timingAdvice()`の1箇所が言う。 */
  if(t&&t.total!=null&&t.total>=SC_SLOW_MS){
   const adv=timingAdvice(t);
   rows.push(syncMenuRow('読み込みの内訳',
     timingLines(t).slice(1).map(x=>x.trim()).join(' / ')||'—',adv||''));
  }
  return rows;
 }
 function syncMenuRow(label,value,note){
  return `<div class="sc-sync-row"><span class="sc-sync-k">${esc(label)}</span>`
   +`<span class="sc-sync-v">${esc(value)}</span>`
   +(note?`<small class="sc-sync-n">${esc(note)}</small>`:'')+`</div>`;
 }
 function syncMenuHtml(st,own){
  if(!st||!st.configured)
   return `<div class="sc-sync-body">${screenReadRows().join('')}${syncMenuRow(
     '共有スケジュール','置き場が未設定です',
     'マスタ管理 > 共通設定 の「置き場」で決めます')}</div>`;
  const rows=[
   ...screenReadRows(),
   syncMenuRow('見張り',
     !st.enabled?'使わない設定':(st.running?'動いています':'止まっています'),
     st.enabled?`${st.intervalSec}秒ごとに共有の改訂番号を確かめ、変わっていたら取り込みます`
               :'読むたびに共有を見にいきます（そのぶん共有を掴む時間が増えます）'),
   syncMenuRow('次の確認',nextCheckText(st)||'—',
     st.enabled?`取り込んだ直後は${st.pauseSec}秒休みます（更新が続くときに共有を掴み続けないため）`:''),
   syncMenuRow('最後に取り込んだ',
     st.snapshotAgeSec==null?'まだありません':`${clockOf(st.snapshotAgeSec)}（${agoOf(st.snapshotAgeSec)}）`,
     'いま画面に出ているのは、この時点の共有の中身です'),
   syncMenuRow('最後に確かめた',
     st.verifiedAgeSec==null?'まだありません':`${clockOf(st.verifiedAgeSec)}（${agoOf(st.verifiedAgeSec)}）`,
     '確かめただけで変わっていなければ取り込みません'),
   syncMenuRow('共有が最後に変わった',
     st.lastChangeAgeSec==null?'この画面を開いてからはありません':`${clockOf(st.lastChangeAgeSec)}（${agoOf(st.lastChangeAgeSec)}）`),
   syncMenuRow('改訂番号',st.revision==null?'—':String(st.revision),
     `確かめた ${st.checks||0}回 / 取り込んだ ${st.fetches||0}回`),
  ];
  if(own&&own.enabled&&own.configured){
   rows.push(syncMenuRow('書込役',ownerChipText(own).replace('書込役: ',''),
     ownerChipTitle(own)[1]||''));
   /* **中継を休んでいることを言う**（§9.301 ①）——休んでいるあいだは自分で
      書いているので、「書込役が居るのに自分で書いている」理由が読めないと、
      利用者からは「書き込みに失敗している」ようにしか見えない（§4）。 */
   if(Number(own.relayDownSec)>0)
    rows.push(syncMenuRow('いまの書き込み','このPCが自分で書いています',
      `書込役へ届かなかったので、あと約${Math.round(own.relayDownSec)}秒は`
      +`直接書きます${own.relayDownWhy?`（${own.relayDownWhy}）`:''}`));
   if(own.takenFrom&&own.takenFrom.pc)
    rows.push(syncMenuRow('引き取り',`${own.takenFrom.pc} から引き取りました`,
      `${own.takenFrom.by_pc||''}が実行`));
   rows.push(ownerActionHtml(own));
  }
  if(st.lastError)rows.push(syncMenuRow('最後のエラー',st.lastError,
    '取り込めていないあいだは、前に取り込んだ内容が出ています'));
  return `<div class="sc-sync-body">${rows.join('')}</div>`;
 }
 /* 書込役が応答しないときの切り分けと引き取り（§9.301 ①、利用者の指示
    「書き込み役が自分ではない場合に、書き込み失敗するような場合、相手のPCが
    落ちている可能性があります…PC落ちか、スリープ中？サーバー落ちを判断して
    書き込み権限を執行する機能などを実装しておく必要もありそうです」）。

    **判定と文言はサーバーの`probe_owner()`の1箇所**（§9.163）——画面は
    返ってきた`label`/`note`をそのまま出す。ここで言い直すと、切り分けを
    1つ足したときに直す場所が2つになる。 */
 let scOwnerProbe=null;
 function ownerActionHtml(own){
  if(!own||!own.enabled||!own.configured)return '';
  if(own.isOwner)
   return `<div class="sc-owner-act"><small>このPCが書込役です。他のPCの書き込みを受けています。</small></div>`;
  const p=scOwnerProbe;
  return `<div class="sc-owner-act">`
   +`<button type="button" id="scOwnerProbeBtn">書込役を調べる</button>`
   +(p?`<div class="sc-owner-probe${p.canTake?' is-warn':''}">`
        +`<b>${esc(p.label||'')}</b><small>${esc(p.note||'')}</small>`
        +(p.canTake?`<button type="button" id="scOwnerTakeBtn">このPCが引き取る</button>`:'')
        +`</div>`:'')
   +`</div>`;
 }
 /* 開いたメニューの中の配線。**10秒ごとの塗り直しのあとにも通す**
    （§9.222 ①と同じ理由——中身を差し替えると配線が切れ、押しても何も
    起きないボタンになる）。 */
 function wireSyncMenu(menu){
  const probe=menu.querySelector('#scOwnerProbeBtn');
  if(probe)probe.onclick=async()=>{
   probe.disabled=true;probe.textContent='調べています…';
   try{
    /* **読むだけのPOST**（§9.273）。`quiet`を付けないと「保存しています…」の
       帯が出て、確かめただけなのに書き込んだように読める（§3）。
       サーバー側も`_READ_ONLY_POST_ENDPOINTS`に入れてある（§9.301 ①）。 */
    const r=await api('/api/schedule/owner-probe',{method:'POST',quiet:true,
      headers:{'Content-Type':'application/json'},body:'{}'});
    scOwnerProbe=r.probe||null;
   }catch(e){
    scOwnerProbe={label:'調べられませんでした',note:String(e&&e.message||e),canTake:false};
   }
   renderSyncChip();
  };
  const take=menu.querySelector('#scOwnerTakeBtn');
  if(take)take.onclick=async()=>{
   const p=scOwnerProbe||{};
   /* **危ない操作は確認する**（§CLAUDE 5）。誰から引き取るのか・なぜ
      引き取れるのかを書く（§6。理由の分からない入れ替わりを作らない）。 */
   const ok=await confirmModal({title:'書込役をこのPCが引き取りますか？',
     eyebrow:'OWNER',confirmLabel:'引き取る',cancelLabel:'やめる',danger:true,
     bodyHtml:`<p class="confirm-modal-message">${esc(p.label||'')}</p>`
      +`<ul class="confirm-modal-list"><li>${esc(p.note||'')}</li>`
      +`<li>引き取ると、このPCが共有スケジュールへ書く役になります（他のPCは`
      +`このPCへ書き込みを頼みます）</li>`
      +`<li>元の書込役が戻ってきたら、そのPCは書き込みを頼む側になります</li></ul>`});
   if(!ok)return;
   take.disabled=true;take.textContent='引き取っています…';
   try{
    await api('/api/schedule/owner-take',{method:'POST',
      headers:{'Content-Type':'application/json'},body:'{}'});
    scOwnerProbe=null;
    showToast&&showToast('書込役を引き取りました','このPCが共有スケジュールへ書きます',4000);
   }catch(e){
    showToast&&showToast('引き取れませんでした',String(e&&e.message||e),6000);
   }
   try{scOwnerState=await api('/api/schedule/owner-status')}catch(e){WL.quiet.note('書込役の状態を取れない（前の状態のまま続ける）',e)}
   renderSyncChip();
  };
 }
 function closeSyncMenu(){
  /* **調べた結果は開いているあいだだけ**——次に開いたときに古い判定が
     出ていると、そのつもりで引き取ってしまう。 */
  scOwnerProbe=null;
  document.getElementById('scSyncMenu')?.remove();
  $('#scSyncChip')?.setAttribute('aria-expanded','false');
  document.removeEventListener('click',onSyncMenuOutside,true);
 }
 function onSyncMenuOutside(e){
  const menu=document.getElementById('scSyncMenu');
  if(!menu)return;
  /* **上に開いた確認は「外」ではない**（§9.301 ①）——「引き取る」は確認を
     挟むので（§CLAUDE 5）、確認のボタンを押した瞬間に後ろのメニューが
     畳まれると、答えたあとに戻る場所が消える（実際にそうなった）。
     §9.221 ①「モーダルは背景クリックで閉じない」と同じ考え方。 */
  if(e.target.closest('.record-modal'))return;
  if(!menu.contains(e.target)&&!e.target.closest('#scSyncChip'))closeSyncMenu();
 }
 function openSyncMenu(anchor){
  closeSyncMenu();
  const menu=document.createElement('div');
  menu.className='access-mode-menu sc-sync-menu';menu.id='scSyncMenu';
  /* **打つ手は読む場所と同じところに置く**（§9.300 ①）。読み直す先が
     2つある（この画面／共有）ので、ボタンも2つ並べて**どちらが何を
     やり直すのかを書く**。 */
  menu.innerHTML=syncMenuHtml(scSyncState,scOwnerState)
   +`<button type="button" id="scSyncReloadBtn"><span>読み直す</span>`
   +`<small>この画面の予定・実績を取り直します</small></button>`
   +`<button type="button" id="scSyncNowBtn"><span>いま取り込む</span>`
   +`<small>共有を見にいって、変わっていれば取り込みます</small></button>`;
  /* **器の外へ出す**（§9.201）——上部の道具列は`overflow`を持つので、
     中に置くと下半分が切られる。 */
  document.body.append(menu);
  const r=anchor.getBoundingClientRect();
  menu.style.top=`${r.bottom+6}px`;
  menu.style.left=`${Math.max(8,Math.min(window.innerWidth-menu.offsetWidth-8,r.left))}px`;
  menu.querySelector('#scSyncNowBtn').onclick=()=>{closeSyncMenu();syncNow()};
  menu.querySelector('#scSyncReloadBtn').onclick=()=>{closeSyncMenu();refreshCurrentMode(true)};
  wireSyncMenu(menu);
  anchor.setAttribute('aria-expanded','true');
  requestAnimationFrame(()=>document.addEventListener('click',onSyncMenuOutside,true));
 }
 function renderSyncChip(){
  const el=$('#scSyncChip');if(!el)return;
  const st=scSyncState,own=scOwnerState;
  const t=scLastTimings;
  const slow=!!(t&&t.total!=null&&t.total>=SC_SLOW_MS);
  const err=!!((st&&st.lastError)||(own&&own.lastError&&own.relayFail));
  /* **文字に出すのは「いつのデータか」1つ**（§9.300 ①）。共有の取り込みと
     書込役はメニューが持つ。**まだ読み込んでいないうちだけ**共有の状態を
     代わりに出す（何も言わないチップにしない）。 */
  const parts=[];
  const when=fmtFetchedAt(scFetchedAt);
  if(when)parts.push(when);
  else{const s0=syncChipText(st);if(s0)parts.push(s0)}
  if(slow)parts.push(`読み込み ${(t.total/1000).toFixed(1)}秒`);
  if(err)parts.push('同期エラー');
  el.hidden=!parts.length;
  if(el.hidden){closeSyncMenu();return}
  el.innerHTML=`<i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>`
   +`<span class="sc-sync-txt">${esc(parts.join(' ・ '))}</span>`
   +`<span class="hd-caret" aria-hidden="true">▾</span>`;
  el.classList.toggle('is-slow',slow);
  el.title=['この時点で読み込んだ内容です。',
            ...(t?timingLines(t):[]),
            st&&st.configured?`共有は${st.intervalSec}秒ごとに確かめ、変わっていたら取り込みます。`:'',
            st&&st.configured?`最後の取込: ${st.snapshotAgeSec==null?'まだありません':agoOf(st.snapshotAgeSec)}`:'',
            st&&st.lastError?`最後のエラー: ${st.lastError}`:'',
            ...ownerChipTitle(own),
            '押すと同期の状態が開きます（そこから読み直し・取り込みができます）。'].filter(Boolean).join('\n');
  el.classList.toggle('is-error',!!((st&&st.lastError)||(scOwnerState&&scOwnerState.lastError&&scOwnerState.relayFail)));
  el.setAttribute('aria-expanded',document.getElementById('scSyncMenu')?'true':'false');
  el.onclick=()=>{document.getElementById('scSyncMenu')?closeSyncMenu():openSyncMenu(el)};
  /* 開いたままなら中身も書き直す（10秒ごとの巡回で数字が古くならないように）。 */
  const open=document.getElementById('scSyncMenu');
  if(open){
   const body=open.querySelector('.sc-sync-body');
   /* **塗り直したら配線し直す**（§9.222 ①）——`outerHTML`で差し替えると、
      中のボタンのハンドラは一緒に捨てられる（押しても何も起きない・§4）。 */
   if(body){body.outerHTML=syncMenuHtml(scSyncState,scOwnerState);wireSyncMenu(open)}
  }
 }
 /* いま読み直してよいか。**途中の操作を壊さない**ことだけを見る。 */
 function canAutoReload(){
  /* **列幅を引いている最中・離した直後は読み直さない**(§9.197)。ここで表を
     組み直すと、掴んでいた見出しが入れ替わって手が空を切る（実機で「うまく
     掴めない・自由に動かせない」と報告された）。判定は`WL.columnResize`の
     1箇所が持つ——同じ判定を画面ごとに書くと、片方だけ直った状態になる。 */
  if(window.WL&&WL.columnResize&&WL.columnResize.busy())return false;
  return !scState.dragId&&!scState.dragIds&&!scWriteQueue.length&&!scQueueRunning
         &&!scState.editingComment
         &&!(scState.picked&&scState.picked.size)
         &&!document.querySelector('.sc-float-win:not([hidden])')
         &&!listModalOpen;
 }
 function renderSyncBanner(changed){
  const box=$('#scSyncBanner');if(!box)return;
  if(!changed){box.hidden=true;box.innerHTML='';return}
  box.hidden=false;
  box.innerHTML=`<span><b>他のPCが予定を変えました。</b>いま出ているのは変更前の内容です。</span>
   <button type="button" id="scSyncReload">読み直す</button>`;
  const btn=$('#scSyncReload');
  if(btn)btn.onclick=()=>{renderSyncBanner(false);refreshCurrentMode(true)};
 }
 async function refreshSyncBadge(){
  try{
   const st=await api('/api/schedule/sync-status');
   scSyncState=st;
   /* 書き込み役は**別の問い合わせ**（取り込みの状態とは別の話なので混ぜない）。
      **入れていない現場では聞き続けない**——10秒ごとに聞く必要があるのは
      「持ち主が入れ替わったか」を追うときだけで、offのままの現場では
      5分に1回で足りる（設定を入れたら次の回で気づく）。 */
   if(!scOwnerState||scOwnerState.enabled||scOwnerTick<=0){
    try{scOwnerState=await api('/api/schedule/owner-status')}catch(e){WL.quiet.note('書込役の状態を取れない（前の状態のまま続ける）',e)}
    scOwnerTick=(scOwnerState&&scOwnerState.enabled)?0:30;
   }else scOwnerTick--;
   /* 「いまから過去◯時間」の起点は時計とともに動く(§9.198)。10秒ごとの
      この巡回で書き直す——止まった時刻を出しておくと、そのうち嘘になる。 */
   updateHistoryFromUi();
   renderSyncChip();
   if(!st.configured||st.revision==null)return;
   /* **基準は読み直すたびに置き直す**——自分の書込でも改訂番号は上がる
      ので、直前の値と比べるだけでは自分の変更で読み直してしまう。 */
   if(scSyncSeen===null){scSyncSeen=st.revision;return}
   if(st.revision===scSyncSeen)return;
   if(canAutoReload()){
    scSyncSeen=null;renderSyncBanner(false);
    await refreshCurrentMode(true);
    showToast&&showToast('他のPCの変更を取り込みました','共有スケジュールが更新されていました',3000);
   }else{
    renderSyncBanner(true);
   }
  }catch(e){WL.quiet.note('見張りの表示はベストエフォート',e)}
 }
 async function syncNow(){
  try{
   const st=await api('/api/schedule/sync-now',{quiet:true,method:'POST',
     headers:{'Content-Type':'application/json'},body:'{}'});
   scSyncState=st;renderSyncChip();
   if(st.result==='fetched'){scSyncSeen=null;renderSyncBanner(false);await refreshCurrentMode(true)}
   else showToast&&showToast('共有に変更はありませんでした',
     st.result==='paused'?'取り込んだ直後の休み中です':'いま出ているのが最新です',2600);
  }catch(e){showToast&&showToast('取り込めませんでした',e.message,5000)}
 }
 let scLockTimer=null,scWhoTimer=null;
 /* 空いた設備を取り直している最中か（§9.211 ②）。二重に取りに行かせない。 */
 let scReclaiming=false;
 // ---------- 編集セッション(§9.11新設)・書込キュー ----------
 let scSessionTimer=null,scSessionHeldFor=null,scTempIdSeq=0;
 let scWriteQueue=[],scQueueRunning=false,scQueueFlushTimer=null;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));

 /* **書式は1回だけ作る**（§9.224 ①）。`toLocaleString(…,{…})`は呼ぶたびに
    `Intl.DateTimeFormat`を組み立てるので、200行の表を描き直すたびに数百回
    作り直すことになる（実測でここだけ2.6秒）。同じ書式を使い回す。 */
 let scDateFmt=null;
 function fmtDateTime(iso){
  if(!iso)return '-';
  const d=new Date(iso);
  if(Number.isNaN(d.getTime()))return '-';
  if(!scDateFmt)scDateFmt=new Intl.DateTimeFormat('ja-JP',
    {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  return scDateFmt.format(d);
 }
 /* 「いつ始まるか」は所要時間とは別の軸（待ち時間ではなく到達点）なので
    `〜後`は残すが、**分と時間の書き分けは`WL.duration`に合わせる**
    （§9.341）。1日を超えるぶんだけはここが持つ——`4320分後`は読めない。 */
 function fmtRelative(minutes){
  if(minutes===null||minutes===undefined)return '';
  const m=Math.round(minutes);
  if(m<=0)return '今';
  if(m<1440)return `${WL.duration.text(m)}後`;
  const days=Math.floor(m/1440),rem=m%1440;
  return `${days}日${rem?Math.floor(rem/60)+'時間':''}後`;
 }
 /* 所要時間の書き方は`WL.duration`の1箇所(§9.341)。ここには置かない——
    以前はこの2つが`2時間30分`と`2:30`を別々に決めており、同じ表の中で
    「残 2時間30分」と実績列の「2:30」が並んでいた。密な列は
    `WL.duration.compact()`を使う(「分」の書き方では単位を落とさない)。 */
 function fmtLocalInput(iso){
  if(!iso)return '';
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
 }

 /* ---------- パネルDOM ---------- */
 function ensurePanel(){
  let panel=$('#schedulePanel');if(panel)return panel;
  panel=document.createElement('section');panel.className='sc-panel';panel.id='schedulePanel';panel.hidden=true;
  panel.innerHTML=`
   <div class="sc-head" id="scHead">
    <div class="sc-head-left">
     <div class="sc-mode-toggle" id="scModeToggle" hidden>
      <button type="button" class="sc-mode-toggle-btn" id="scModeBoard" data-mode="board"><i class="fa-solid fa-table-cells" aria-hidden="true"></i> 全体</button>
      <button type="button" class="sc-mode-toggle-btn" id="scModeSingle" data-mode="single"><i class="fa-solid fa-list" aria-hidden="true"></i> 個別</button>
     </div>
     <select class="sc-equipment-select" id="scEquipmentSelect" hidden></select>
     <span class="sc-equipment-fixed" id="scEquipmentFixed" hidden></span>
     <span class="sc-lock-badge" id="scLockBadge" hidden></span>
     <!-- 編集権の在席表示(#scWho)は**ここには置かない**(§9.211 ③)。
          置き場はヘッダーのタイトル帯(.hd-context / templates/index.html)
          ——利用者の指示は「作業スケジュールのタイトル帯の空白エリアを
          利用してください」で、操作列(#scHead)は別の指示「上部メニューバーは
          1行で収まるように」(§9.199)が掛かっている場所。実測で操作列の
          余りは**92pxしか無く**、150pxのチップを置いたため
          **書込中の印(#scLockBadge)が出た瞬間だけ2行へ折り返し**、
          表全体が38px跳ねていた（掴もうとした行が逃げる）。
          ※この文はテンプレートリテラルの中なので**バッククォートを
            書かないこと**——そこで文字列が閉じ、以降がJSとして解釈されて
            画面が組み上がらなくなる（実際にやった）。 -->
    </div>
    <!-- ---------- 操作の並び(§9.199、利用者の指示「上部メニューバーは
         1行で収まるように」) ----------
         §9.198で11個のボタンを4つの塊に束ねたが、**塊にしても総量は
         減らないので3行に折り返していた**（実測: 見出し行のほかに
         834px+334px / 275px+127px の2行）。折り返した操作列は「同じ
         位置に同じものがある」という前提を壊し、本文の高さも毎回変わる。
         そこで**面積を頻度×重要度で配り直す**(§1):
          - 見え方の設定7つ（まとめ・さかのぼり・表示列・行の見せ方・
            配置）は**1回決めたら当分変えない**ので、入口を1つにして
            浮きパネル(#scViewPop)へ畳む。**いまの設定はボタンに書く**
            ので、開かなくても読める(§「思い出させない」)。
          - 押す頻度の高い「足す」「刷る」「再計算」はバーに残す。
            狭い画面では文字だけを畳んでアイコンにする(@container)。
          - 状態(いつ読んだ・共有をいつ取り込んだ)は短く言い直す。
         並びは作業の順そのもの: いま何時点か → 足す → 見え方 → 出す。 -->
    <div class="sc-head-right">
     <div class="sc-board-window" id="scBoardWindow" hidden>
      <button type="button" class="sc-board-window-btn" data-hours="24">24時間</button>
      <button type="button" class="sc-board-window-btn" data-hours="48">48時間</button>
     </div>
     <div class="sc-tools" data-tools="state" id="scToolsState">
      <!-- 「いま見ているのはいつのデータか」に答えるチップ(§9.300 ①)。
           §9.188の共有の見張りと§9.42の読込時点は**同じ問いの2つの答え**
           だったので1つに畳んだ。文字は読込時点だけで、共有の取り込み・
           書込役・改訂番号・打つ手（読み直す／いま取り込む）は押すと開く
           浮きメニューが持つ。 -->
      <button type="button" class="sc-sync-chip" id="scSyncChip" hidden aria-expanded="false"></button>
      <!-- 現場段取りの注記は**直せることがあるときだけ**(§9.300 ①)。
           一致しているときの「並べ替えのみ可能」はヘッダーのバッジ
           (#fieldReorderBadge)がまったく同じことを言っており、読む側は
           同じ文を2度読むことになっていた(§CLAUDE 8)。対象設備が違う／
           未設定のときだけ、その設備名と直す場所を書く(§4)。 -->
      <span class="sc-field-reorder-note" id="scFieldReorderNote" hidden></span>
     </div>
     <div class="sc-tools" data-tools="add" id="scToolsAdd">
      <span class="sc-tools-label" title="予定へ足す（共有スケジュールに書き込みます）">追加</span>
      <button type="button" class="sc-split-toggle sc-ico-btn" id="scListModalBtn" hidden title="仕掛一覧をポップアップで表示してドラッグで追加します"><i class="fa-solid fa-table-list" aria-hidden="true"></i><span>仕掛一覧</span></button>
      <button type="button" class="sc-split-toggle sc-ico-btn" id="scStopModalBtn" hidden title="設備停止をポップアップから追加します"><i class="fa-solid fa-ban" aria-hidden="true"></i><span>設備停止</span></button>
      <button type="button" class="sc-split-toggle sc-ico-btn" id="scCommentBtn" draggable="true" hidden title="申し送り（コメント）を予定の列へ挟みます。時間は取りません。&#10;・掴んで予定の間へ落とすと、空の枠だけが入ります（あとでダブルクリックして書けます）&#10;・押すとその場で書いて入れられます"><i class="fa-solid fa-comment-dots" aria-hidden="true"></i><span>コメント</span></button>
      <!-- 空の日付・直の枠(§9.238 ②、利用者の指示「予定を少し飛ばして設定
           する場合に、何も予定がない領域にセットできる、空の日付や直の枠を
           登録できるようにしたい」)。コメントと同じく掴んでも押しても入る。 -->
      <button type="button" class="sc-split-toggle sc-ico-btn" id="scFrameBtn" draggable="true" hidden title="空の日付・直の枠を挟みます。ここから先の予定を、その日・その直の頭から並べ直します。&#10;・日にちや直を飛ばして、先の予定を先に決められます&#10;・手前に予定を足していくと、空いた時間へ自然に入っていきます&#10;・掴んで予定の間へ落とすと、その位置に入ります"><i class="fa-solid fa-calendar-plus" aria-hidden="true"></i><span>枠</span></button>
     </div>
     <!-- 見え方の入口は1つ(§9.199)。**いまの設定を文字で連れて出す**
          ——畳んだ先の値が読めないと、開くまで思い出せない。 -->
     <div class="sc-tools" data-tools="view" id="scToolsView">
      <!-- **よく使うものは畳まない**（§9.207、利用者の指示「よく使う表示列の
           カスタム機能だけはメニュー部分に出してほしい」）。§9.199で見え方を
           1枚のパネルへ集めたが、表示列だけは触る回数が桁違いに多く、
           「開く→探す→押す」の3手が毎回かかっていた。 -->
      <button type="button" class="sc-split-toggle sc-ico-btn" id="scContentModalBtn" hidden
        title="この表に出す列・並び・幅・書式を設定します（設備ごとに保存）"><i class="fa-solid fa-table-columns" aria-hidden="true"></i><span>表示列</span></button>
      <button type="button" class="sc-split-toggle sc-view-menu-btn" id="scViewMenuBtn" hidden
        aria-expanded="false" title="この画面の見え方（まとめ・さかのぼり・行の色・配置）をまとめて設定します。予定そのものは変わりません">
       <i class="fa-solid fa-sliders" aria-hidden="true"></i><span class="sc-vm-txt">表示</span><b class="sc-vm-state" id="scViewState"></b><span class="hd-caret">▾</span>
      </button>
      <!-- 広く使う（§9.292 ⑦、利用者の指示「スケジュール作成時に、とにかく
           仕掛のデータを多く表示したいです。その時上部のメニューのほぼ
           すべてを畳んで最大限広いスペースで仕掛の一覧表を表示できるような
           機能を実装してください」）。**戻る道は必ず1つ見えている**
           （§4）——広いあいだは画面の右上に「元に戻す」の札を出す。 -->
      <button type="button" class="sc-split-toggle sc-ico-btn" id="scWideBtn" hidden
        aria-pressed="false"
        title="上の帯（画面名・状態・操作列）を畳んで、一覧をいちばん広く使います。&#10;・戻すときは右上の札を押すか Esc&#10;・この端末に覚えます"><i class="fa-solid fa-up-right-and-down-left-from-center" aria-hidden="true"></i><span>広く</span></button>
     </div>
     <div class="sc-tools" data-tools="act" id="scToolsAct">
      <button type="button" class="sc-split-toggle sc-ico-btn" id="scPrintBtn" title="いま表示している予定を、現場へ配る形（用紙サイズ・向きは選べます）で印刷します"><i class="fa-solid fa-print" aria-hidden="true"></i><span>印刷</span></button>
      <button type="button" class="sc-refresh sc-ico-btn" id="scRefresh" title="予定の時刻を計算し直します"><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i><span>再計算</span></button>
     </div>
    </div>
   </div>
   <div class="sc-session-banner" id="scSessionBanner" hidden></div>
   <!-- 他のPCが共有を書き換えたときの案内(§9.188)。**触っている最中は
        勝手に読み直さない**——並べ替えの途中で行が入れ替わると、掴んで
        いたものが分からなくなる。 -->
   <div class="sc-sync-banner" id="scSyncBanner" hidden></div>
   <div class="sc-warnings" id="scWarnings" hidden></div>
   <!-- 時刻が決まっていない予定の案内(§9.185)。**残っているときだけ出す**。
        「未定」という言葉は行の中にも出るが、行は下へ流れるので、
        何件あるのか・次に何をすればよいのかは上でまとめて言う。 -->
   <div class="sc-undecided" id="scUndecided" hidden></div>
   <!-- まとめて外す(§9.170)。仕掛一覧の選択件数バー(plan-select-bar)と
        同じ形・同じ言葉にしてある。**0件のときは出さない**——常時
        「0件選択中」と出ているのは読まれない飾りにしかならない。 -->
   <div class="sc-pick-bar" id="scPickBar" hidden></div>
   <div class="sc-board" id="scBoard" hidden></div>
   <div class="sc-body" id="scSingleBody">
    <div class="sc-timeline" id="scTimeline"></div>
    <!-- 広く使っているあいだの戻り道（§9.292 ⑦）。**常に見えている1つ**
         （§4。畳んだ先から戻れない状態を作らない）。
         **この器（sc-body）の中へ置く**——位置の基準になる position:relative
         を持っているのはここで、sc-panel へ relative を足すと sc-view-pop
         など既に浮いているものの基準まで動く。
         **このテンプレートリテラルの中にバッククォートを書かないこと**
         （§9.211 ③。そこで文字列が閉じて画面が組み上がらない）。 -->
    <button type="button" class="sc-wide-exit" id="scWideExit" hidden
      title="上の帯（画面名・状態・操作列）を戻します。Escでも戻せます">
     <i class="fa-solid fa-down-left-and-up-right-to-center" aria-hidden="true"></i><span>元の表示に戻す（Esc）</span></button>
    <!-- 予定から外す受け皿(§9.116)。**掴んでいる間だけ出す**——常設すると
         「消す場所」が画面に居座り、押し間違いの的になる。掴んで初めて
         現れるので、外す意思があるときにしか目に入らない。
         **幅いっぱいにしない**(§9.238 ①、利用者の指示)——下端を横断すると
         「行を末尾へ運ぶ」動線をそのまま覆い、並べ替えのつもりが外す確認に
         なる。右下の小さな札にして、説明はtitle属性へ落とす(§9.234 ①)。
         **この覆いの中にバッククォートを書かないこと**——テンプレート
         リテラルの中なので、そこで文字列が閉じて画面が組み上がらなくなる。 -->
    <div class="sc-drop-remove" id="scDropRemove" hidden aria-hidden="true"
         title="ここへ落とすと予定から外します。確認してから外すので、間違えても止められます。&#10;外した予定は仕掛一覧へ戻るので、また入れ直せます。">
     <span class="sc-drop-remove-icon" aria-hidden="true">🗑</span>
     <span class="sc-drop-remove-text">予定から外す</span>
    </div>
    <!-- ---------- 「表示」パネル(§9.199) ----------
         見え方の設定を**1箇所へ集める**。以前は「まとめ」「さかのぼり」が
         バーの素の選択欄、「表示列」がモーダル、「行の見せ方」「配置」が
         別々の浮きパネルで、同じ「この画面の見え方」の話が4通りの形で
         散っていた（探す前に、どの形で出るのかを思い出す必要があった）。
         上2つ（まとめ・さかのぼり）は畳まずに置く——押す頻度が高く、
         行き先が1手で見えるほうが速い。下3つは**アコーディオン**で、
         開くのは常に1つ（開いた中身が長いので、2つ開くと迷子になる）。
         **誰に効くかを各段に書く**（全員／設備ごと／この端末だけ）。
         **この画面の中に置く**——スケジュールの見え方の話なので、
         アプリ全体の設定へ混ぜない(§9.179)。 -->
    <div class="sc-view-pop" id="scViewPop" hidden>
     <div class="sc-view-pop-head">
      <b>表示</b><small>この画面の見え方だけを変えます。予定そのものは変わりません</small>
     </div>
     <label class="sc-view-row" id="scGroupRange" hidden>
      <span class="sc-view-row-name">まとめ<small>日付は現場歴（勤務の日付補正を当てた現場の1日）と太陽暦から選べます</small></span>
      <select id="scGroupSelect">${SC_GROUP_MODES.map(m=>`<option value="${m.key}">${m.label}</option>`).join('')}</select>
     </label>
     <label class="sc-view-row" id="scHistoryRange" hidden>
      <span class="sc-view-row-name">さかのぼり<small>済んだ行（完了・取消）を何時間ぶん残すか。これからの予定は全部出ます</small></span>
      <span class="sc-view-row-ctl">
       <select id="scHistorySelect">${SC_HISTORY_CHOICES.map(h=>`<option value="${h}">いまから過去${h}時間</option>`).join('')}</select>
       <span class="sc-history-from" id="scHistoryFrom" hidden></span>
      </span>
     </label>
     <div class="sc-view-acc" id="scViewAccRowStyle" hidden>
      <button type="button" class="sc-view-sec" id="scRowStyleBtn" aria-expanded="false">
       <i>🎨</i><span>行の色とアイコン<small>区分・設備停止の分類ごと（全員に効きます）</small></span><em class="sc-view-chev">▾</em>
      </button>
      <div class="sc-layout-pop sc-rowstyle-pop" id="scRowStylePop" hidden></div>
     </div>
     <div class="sc-view-acc" id="scViewAccLayout" hidden>
      <button type="button" class="sc-view-sec" id="scLayoutBtn" aria-expanded="false">
       <i>🖥</i><span>この端末の見え方<small>開いたときの表示・仕掛一覧の位置・案内・親ロットの印（この端末だけ）</small></span><em class="sc-view-chev">▾</em>
      </button>
      <div class="sc-layout-pop" id="scLayoutPop" hidden></div>
     </div>
    </div>
    <button type="button" class="sc-side-tab" id="scSideToggle" hidden title="設備停止・案内パネルの表示/非表示">◀</button>
    <div class="sc-side" id="scSide" hidden>
     <div class="sc-side-section" id="scSplitHint">
      <p class="sc-drop-hint">左の仕掛一覧からロットをドラッグ、またはチェックボックスで複数選択してこのパネルへドロップすると、この設備の予定へ追加されます。</p>
     </div>
     <div class="sc-side-section">
      <button type="button" class="sc-side-section-toggle" id="scStopSectionToggle">
       <span class="sc-side-title">設備停止を追加</span><span class="sc-collapse-chevron">▾</span>
      </button>
      <div class="sc-stop-groups" id="scStopButtons" hidden><div class="sc-empty-note">設備停止マスタが未登録です</div></div>
     </div>
    </div>
   </div>`;
  const grid=$('#grid');
  if(grid&&grid.parentNode)grid.parentNode.insertBefore(panel,grid);else document.body.appendChild(panel);
  $('#scRefresh').onclick=()=>refreshCurrentMode();
  const grp=$('#scGroupSelect');
  scState.groupMode=loadGroupMode();
  grp.value=scState.groupMode;
  grp.onchange=()=>{
   scState.groupMode=grp.value;
   try{localStorage.setItem(SC_GROUP_KEY,scState.groupMode)}catch(err){WL.quiet.note('保存できなくても表示は変わる',err)}
   updateViewMenuUi();          // 畳んでいる入口の文字も一緒に直す(§9.199)
   renderTimeline();
  };
  const hist=$('#scHistorySelect');
  hist.value=String(scState.historyHours);
  hist.onchange=()=>{
   scState.historyHours=Number(hist.value)||8;
   try{localStorage.setItem(SC_HISTORY_KEY,String(scState.historyHours))}catch(e){WL.quiet.note('保存できなくても表示は変わる',e)}
   updateHistoryFromUi();
   updateViewMenuUi();
   if(scState.equipment)loadPlan(true);
  };
  $('#scEquipmentSelect').onchange=e=>{scState.equipment=e.target.value;switchToSingle()};
  /* 印刷(§9.115)。紙の割り付けは schedule-print.js が持つ。
     **無ければ黙って消さない**——「あれば使う」で書くと、読み込み順を
     間違えた日に機能だけが静かに欠ける(§9.105と同じ罠)。 */
  const printBtn=$('#scPrintBtn');
  if(printBtn)printBtn.onclick=()=>{
   if(typeof WL.schedulePrint?.open==='function')WL.schedulePrint.open();
   else console.error('作業スケジュールの印刷: WL.schedulePrint が見つかりません');
  };
  $('#scViewMenuBtn').onclick=e=>{e.stopPropagation();toggleViewPop()};
  /* 一覧を広く使う（§9.292 ⑦）。**入口と戻り道は同じことをする**
     （判定は`setWide()`の1箇所）。 */
  const wideBtn=$('#scWideBtn');
  if(wideBtn)wideBtn.onclick=()=>setWide(!scLayout.wide);
  const wideExit=$('#scWideExit');
  if(wideExit)wideExit.onclick=()=>setWide(false);
  /* **Escで戻す**（§4。畳んだ先から戻れない状態を作らない）。
     浮き窓・モーダルが開いているときは**そちらが先**——ここで戻すと、
     窓を閉じたつもりが帯まで戻る。 */
  document.addEventListener('keydown',e=>{
   if(e.key!=='Escape'||!scLayout.wide)return;
   if(e.isComposing||e.keyCode===229)return;      // 変換中は取らない（§9.221 ①）
   if(document.querySelector('.modal:not([hidden]),.sc-float-win:not([hidden]),'
     +'#listColumnPanel:not([hidden]),#schedulePrintPreview:not([hidden])'))return;
   setWide(false);
  });
  $('#scLayoutBtn').onclick=e=>{e.stopPropagation();toggleLayoutPop()};
  $('#scRowStyleBtn').onclick=e=>{e.stopPropagation();toggleRowStylePop()};
  /* 外を押したら畳む。**パネルの中を押しても閉じない**——ラジオを続けて
     触れるようにするため。中の段(行の色・この端末の見え方)は「表示」
     パネルの子なので、閉じ判定は**外側の1つだけ**でよい(§9.199)。
     以前2つのポップオーバーを別々に見ていたのは兄弟だったからで、
     入れ子にした今もそのまま残すと、中を押した瞬間に片方が畳まれる。 */
  document.addEventListener('mousedown',e=>{
   const pop=$('#scViewPop');
   if(!pop||pop.hidden)return;
   /* **アイコンを選ぶ盤は「中」として扱う**(§9.201)。盤は`overflow`に
      切られないよう`body`直下へ出してあるが、利用者から見れば
      パネルの続きなので、押した瞬間にパネルごと畳んではいけない
      （実際にそうなり、アイコンが一度も選べなかった）。 */
   if(e.target.closest('#scViewPop')||e.target.closest('#scViewMenuBtn')
      ||e.target.closest('#scIconPick'))return;
   closeViewPop();
  },true);
  $('#scModeBoard').onclick=()=>switchToBoard();
  $('#scModeSingle').onclick=()=>switchToSingle();
  $('#scListModalBtn').onclick=()=>listModalOpen?closeListModal():openListModal();
  $('#scStopModalBtn').onclick=()=>stopModalOpen?closeStopModal():openStopModal();
  /* コメントは**掴んで落とす**こともできる(§9.191、利用者の指示
     「D&Dでコメント枠だけ追加」)。落とすと空の枠が入り、中身は行を
     ダブルクリックして書く。押した場合は今までどおりその場で書いて入れる。 */
  const cmt=$('#scCommentBtn');
  cmt.onclick=()=>addComment();
  cmt.addEventListener('dragstart',e=>{
   /* 掴んでいる印は**このファイルの中だけ**で持つ（受け皿も同じファイル）。
      素の`window.*`を増やさない——`__scDragRows`は list-view.js から渡す
      ための既存の契約で、こちらは外へ出す必要が無い（CLAUDE.md）。 */
   scState.dragComment=true;
   e.dataTransfer.effectAllowed='copy';
   try{e.dataTransfer.setData('text/plain','コメント')}catch(err){WL.quiet.note('setData制限は無視',err)}
   cmt.classList.add('is-row-dragging');
  });
  cmt.addEventListener('dragend',()=>{cmt.classList.remove('is-row-dragging');scState.dragComment=false});
  /* 日付・直の枠(§9.238 ②)。コメントと同じ作法——押すとその場で聞いて
     末尾（または固定した位置）へ、掴んで落とすと**落とした位置**へ入る。
     **中身の無い枠は作らない**——日付の入っていない枠は何もしない行に
     なるので、落とした位置を覚えたうえで先に日付を聞く(§4)。 */
  const frm=$('#scFrameBtn');
  frm.onclick=()=>openFramePicker(null);
  frm.addEventListener('dragstart',e=>{
   scState.dragFrame=true;
   e.dataTransfer.effectAllowed='copy';
   try{e.dataTransfer.setData('text/plain','枠')}catch(err){WL.quiet.note('setData制限は無視',err)}
   frm.classList.add('is-row-dragging');
  });
  frm.addEventListener('dragend',()=>{frm.classList.remove('is-row-dragging');scState.dragFrame=false});
  /* 内容欄の設定は**仕掛一覧と同じパネル**で開く(§9.120)。専用モーダルの
     実装は当面残す（他から呼ばれていないかを通しで確かめるまでの保険）。 */
  /* 列の設定は別の窓(浮きウィンドウ)で開くので、**「表示」パネルは畳む**
     (§9.199)。開いたまま残すと、窓の下に設定パネルが覗いたままになる。 */
  $('#scContentModalBtn').onclick=()=>{closeViewPop();openContentPanel()};   /* バー直下(§9.207) */
  $('#scSideToggle').onclick=()=>toggleSideCollapsed();
  $('#scStopSectionToggle').onclick=()=>{
   const box=$('#scStopButtons');if(!box)return;
   box.hidden=!box.hidden;
   $('#scStopSectionToggle').classList.toggle('open',!box.hidden);
  };
  panel.querySelectorAll('.sc-board-window-btn').forEach(btn=>{
   btn.onclick=()=>{
    scState.boardWindowHours=+btn.dataset.hours;
    panel.querySelectorAll('.sc-board-window-btn').forEach(b=>b.classList.toggle('active',b===btn));
    renderOverviewBoard();
   };
  });
  wireDropTarget(panel);
  wireRemoveZone();          // 予定から外す受け皿(§9.116)
  return panel;
 }

 /* ---------- 分割表示(§9.10): 仕掛一覧(#grid)をスケジュールパネルの隣へ ----------
    list-view.jsが持つ仕掛一覧の描画(検索・並替・絞り込み・複数選択・分割
    検出)をそのまま流用し、比較用の一覧を新しく作り直さない(CLAUDE.mdの
    「関数の定義は1箇所」)。#grid・#genericFilterBarはDOM上の位置を一時的に
    .sc-split-wrapへ移すだけで、要素自体・IDは変えないため他モードの
    display:none切替やid参照には影響しない。元の位置はコメントノード
    (splitAnchor)で覚えておき、分割解除時に戻す。 */
 // #grid・#genericFilterBarは常に同じDOMノードを「今どこに表示するか」だけ
 // 動かす(list-view.jsの検索・並替・ドラッグ機能を再実装しない、CLAUDE.mdの
 // 「関数の定義は1箇所」)。行き先は分割表示(splitWrap)とポップアップ表示
 // (#scListModal)の2種類あるため、元の位置をコメントノード(gridAnchor)で
 // 覚えておく共通処理をmoveGridTo/returnGridHomeへ切り出した。
 let gridAnchor=null,gridHost=null;
 function ensureGridAnchor(){
  if(gridAnchor)return gridAnchor;
  const grid=document.getElementById('grid');
  if(!grid||!grid.parentNode)return null;
  gridAnchor=document.createComment('sc-grid-anchor');
  grid.parentNode.insertBefore(gridAnchor,grid);
  return gridAnchor;
 }
 // 一覧に属する3点(絞り込みバー・ツールバー・表本体)は必ずこの順で一緒に動かす。
 // #listToolbarはlist-view.jsが#gridの直前へ差し込むため、移動時に置いていくと
 // 元の画面に取り残されて「一覧が無いのにツールバーだけ残る」ことになる。
 function moveGridTo(host){
  if(!ensureGridAnchor()||!host)return;
  const grid=document.getElementById('grid'),filterBar=document.getElementById('genericFilterBar'),toolbar=document.getElementById('listToolbar');
  if(filterBar)host.appendChild(filterBar);
  if(toolbar)host.appendChild(toolbar);
  if(grid)host.appendChild(grid);
  gridHost=host;
 }
 function returnGridHome(){
  if(!gridHost||!gridAnchor)return;
  const grid=document.getElementById('grid'),filterBar=document.getElementById('genericFilterBar'),toolbar=document.getElementById('listToolbar');
  const main=gridAnchor.parentNode;
  if(filterBar)main.insertBefore(filterBar,gridAnchor);
  if(toolbar)main.insertBefore(toolbar,gridAnchor);
  if(grid)main.insertBefore(grid,gridAnchor);
  gridHost=null;
 }

 // リサイズ可能な分割バー(§9.12改訂・§9.17新設)。以前は境界から離れた
 // ヘッダーの「◫ 仕掛一覧」ボタンで表示/非表示するだけだったが、「ボタン式で
 // 直感的でない」「作業スケジュール欄を広く取りたい」という指摘のため、
 // 境界線そのものをドラッグでリサイズでき、中央のボタンでワンクリック
 // 折りたたみもできる分割バー(.sc-split-divider)へ作り直した。仕掛一覧の
 // 幅・折りたたみ状態はlocalStorageへ保存する。既定幅は380px(スケジュール
 // パネル側=1frが残り全部を取るため、パネルの方が確実に広くなる)。
 let splitListWidth=(()=>{try{const v=+localStorage.getItem('scSplitListWidthV1');return v>0?v:380}catch(e){return 380}})();
 let splitListCollapsed=(()=>{try{return localStorage.getItem('scSplitListCollapsedV1')==='1'}catch(e){return false}})();
 let splitWrap=null;
 // §9.22: 品質データ結合(join_quality=1)はlist-view.jsのload()がscheduleモード
 // かどうかで自動的に付け外しする。showSplitList()は元々S.db!=='SIKALOTNOW'の
 // 時しか再取得しなかったため、既にSIKALOTNOWを開いた状態(例:編集モードで
 // 見ていた後にscheduleモードへ切替、あるいは他設備のタイムラインから
 // 戻ってきた場合)でスケジュール分割表示に入ると、join_quality無しで取得済み
 // の古いデータのまま据え置かれ、品質列が出ないままになる不具合があった。
 // この分割表示に入った直後の1回だけload()を強制し、以降(同じ分割表示を
 // 保ったままの再描画)は無駄な再取得をしない。
 let scSplitJoinApplied=false;
 /* ---------- 開いたときの表示を決める(§9.179) ----------
    要望は2つ。**仕掛一覧を左右どちらに置くか**と、**開いたときに分割で
    出すか・スケジュールだけで出すか**。どちらも「毎回同じ操作をやり直して
    いる」ことの裏返しなので、覚えさせる。
    既定は`last`(前回のまま)——今までの挙動で、わざわざ選んでいない人の
    見え方を変えないため。 */
 const SC_LAYOUT_KEY='scLayoutPrefsV1';
 const SC_OPEN_MODES=[
  ['last','前回のまま','畳んだ／開いたを覚えて、そのまま開きます（既定）'],
  ['split','分割で開く','仕掛一覧とスケジュールを並べて開きます'],
  ['schedule','スケジュールだけで開く','仕掛一覧は畳んで開きます。表の行間をクリックすると、その位置へ予定を入れられます'],
 ];
 /* 挿入位置の**吹き出しの案内**を出すかどうか(§9.197、利用者の指示
    「慣れたら不要な感じがした。ONOFFできるようにしたい」)。既定は出す
    ——初めて開いた人には「行間を押せば入れられる」ことが読めない。
    切っても**挿入位置の線は残す**（どこへ入るかが分からなくなるのは
    案内が多いことより悪い）。 */
 /* 親ロットの行に付ける印(§9.199、利用者の指摘「数字がついているので、
    この付け方だと『子』の方が意味的に適切です」)。**2通りから選べる**:
     - `count`（既定）… 「子3」= 畳んである子ロットの件数。数字が何の数か
       が名前と合う。件数は開かなくても分かるので、既定はこちら。
     - `parent`      … 「親」だけ。数字を出さないぶん狭く、行の題名が長い
       現場ではこちらが読みやすい。
    §9.198で入れた「親3」は**数字の意味と名前が食い違っていた**（3件の親、
    と読める）。どちらか一方へ寄せるのではなく、選べるようにしてある。 */
 const SC_CHILD_BADGES=[
  ['count','件数を出す（例: 子3）','畳んである子ロットが何件あるかが、開かなくても分かります（既定）'],
  ['parent','「親」だけ（数字なし）','この行が親ロットであることだけを示します。そのぶん狭くて済みます'],
 ];
 let scLayout=(()=>{
  try{
   const v=JSON.parse(localStorage.getItem(SC_LAYOUT_KEY)||'{}');
   return {swap:!!(v&&v.swap),open:(v&&SC_OPEN_MODES.some(m=>m[0]===v.open))?v.open:'last',
           tip:!(v&&v.tip===false),
           childBadge:(v&&SC_CHILD_BADGES.some(m=>m[0]===v.childBadge))?v.childBadge:'count',
           /* §9.235 ②、利用者の指示「子ロットのバッジの位置は、一番左固定
              ではなく、どの列にも付けられるように…デフォルトはロット番号」。
              **空欄＝自動**（`childBadgeTargetKey()`がロット番号→内容欄の
              先頭→先頭列の順に落とす）。保存値は文字列のキーのみ有効にする
              ——型が違う値が紛れ込んでも自動へ倒す。 */
           childBadgeCol:(v&&typeof v.childBadgeCol==='string')?v.childBadgeCol:'',
           /* 上の帯を畳んで一覧を広く使う（§9.292 ⑦）。**既定はoff**
              ——わざわざ選んでいない人の見え方を変えない。 */
           wide:!!(v&&v.wide)};
  }catch(e){return {swap:false,open:'last',tip:true,childBadge:'count',childBadgeCol:'',wide:false}}
 })();
 function saveScLayout(){
  try{localStorage.setItem(SC_LAYOUT_KEY,JSON.stringify(scLayout))}catch(e){WL.quiet.note('保存できなくても表示は続く',e)}
 }
 /* ---------- 一覧を広く使う（§9.292 ⑦、利用者の指示） ----------
    「スケジュール作成時に、とにかく仕掛のデータを多く表示したいです。
     その時上部のメニューのほぼすべてを畳んで最大限広いスペースで仕掛の
     一覧表を表示できるような機能を実装してください」

    畳むのは**上の帯**（アプリのヘッダー＝画面名・状態・全体操作・操作列と、
    スケジュールの道具列）で、実測でその2つが縦に約110px使っている。
    左メニューは**触らない**——あちらは既に自分の畳みを持っており（§9.58）、
    同じことをする入口を2つ置かない（§9.207）。

    **戻る道は必ず1つ見えている**（§4）——広いあいだは器の右上に
    「元に戻す」の札を出し、Escでも戻せる。**畳んだ先の状態はボタンに
    出す**（`aria-pressed`＋札）ので、どちらの状態かは画面から読める（§3）。

    印は`body.sc-wide`の1つ（§9.288 ⑥と同じ作法）——CSSはここを見る規則を
    1本持つだけで、画面ごとの書き分けを増やさない。 */
 function applyWide(){
  const on=!!scLayout.wide&&document.body.classList.contains('sc-mode');
  document.body.classList.toggle('sc-wide',on);
  const btn=$('#scWideBtn');
  if(btn){
   btn.setAttribute('aria-pressed',String(on));
   const t=btn.querySelector('span');if(t)t.textContent=on?'元に戻す':'広く';
  }
  const pill=$('#scWideExit');
  if(pill)pill.hidden=!on;
 }
 function setWide(on){
  scLayout.wide=!!on;saveScLayout();applyWide();
  /* 器の高さが変わるので、下の余白を測り直す（§9.292 ②）。 */
  fitTailSpace();
 }
 /* 「分割で開く」/「スケジュールだけで開く」を今の画面へ当てる。畳んだ状態は
    今までどおり端末に覚える(`last`で開いたときに戻せるように)。 */
 function applyOpenMode(collapsed){
  splitListCollapsed=!!collapsed;
  try{localStorage.setItem('scSplitListCollapsedV1',splitListCollapsed?'1':'0')}catch(e){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',e)}
  updateSplitCollapseUi();
  updateInsertHintUi();
  if(!splitListCollapsed)showSplitList().catch(WL.quiet('仕掛一覧を出せない（畳んだままになる）'));
 }
 function applySplitSide(){
  if(!splitWrap)return;
  splitWrap.classList.toggle('sc-swap',!!scLayout.swap);
  /* 取っ手の矢印も向きが変わる。**同じ場所で両方直す**——片方だけ直すと
     「押した向きと動く向きが違う」状態が残る。 */
  updateSplitCollapseUi();
 }
 /* 「スケジュールだけ」で見ている状態。**仕掛一覧が見えていないとき**は
    ドラッグで入れる手立てが無いので、行間をクリックして入れられるように
    する(下の insert ghost)。 */
 function scheduleOnlyView(){
  return !!scState.fullControl&&scState.boardMode==='single'&&!!scState.equipment
         &&!listModalOpen&&(splitListCollapsed||!document.body.classList.contains('sc-split'));
 }
 function renderLayoutPop(){
  const pop=$('#scLayoutPop');if(!pop)return;
  pop.innerHTML=`
   <div class="sc-layout-sec">
    <b>開いたときの表示</b>
    ${SC_OPEN_MODES.map(([v,label,note])=>`<label><input type="radio" name="scOpenMode" value="${v}"${scLayout.open===v?' checked':''}><span><b>${esc(label)}</b><small>${esc(note)}</small></span></label>`).join('')}
   </div>
   <div class="sc-layout-sec">
    <b>仕掛一覧の位置</b>
    <label><input type="radio" name="scSide" value="left"${scLayout.swap?'':' checked'}><span><b>左</b><small>スケジュールは右（既定）</small></span></label>
    <label><input type="radio" name="scSide" value="right"${scLayout.swap?' checked':''}><span><b>右</b><small>スケジュールは左</small></span></label>
   </div>
   <div class="sc-layout-sec">
    <b>行間に出す「ここへ入れる」の案内</b>
    <label><input type="radio" name="scInsertTip" value="on"${scLayout.tip?' checked':''}><span><b>吹き出しで説明する</b><small>何ができるかを毎回書きます（既定）</small></span></label>
    <label><input type="radio" name="scInsertTip" value="off"${scLayout.tip?'':' checked'}><span><b>線だけにする</b><small>入る位置の線は出ます。慣れたらこちらが静かです</small></span></label>
   </div>
   <div class="sc-layout-sec">
    <b>親ロットの印</b>
    ${SC_CHILD_BADGES.map(([v,label,note])=>`<label><input type="radio" name="scChildBadge" value="${v}"${scLayout.childBadge===v?' checked':''}><span><b>${esc(label)}</b><small>${esc(note)}</small></span></label>`).join('')}
    <label class="sc-layout-badgecol"><span><b>付ける列</b><small>既定はロット番号です。選んだ列を隠すと自動で戻ります</small></span>
     <select id="scChildBadgeCol">${childBadgeColOptions()}</select></label>
   </div>
   <p class="sc-layout-note">この設定はこの端末に覚えます（設備ごとではありません）。</p>`;
  pop.querySelectorAll('input[name=scOpenMode]').forEach(r=>{
   /* **選んだ瞬間にその形へする**(§9.179改訂。利用者の指摘「切り替えた直後に
      スケジュール表だけになりません」)。「開いたときの表示」という名前でも、
      押した結果が今の画面に出ないのでは、効いているのか確かめられない。
      `last`(前回のまま)だけは今の形を変えない——何に変えるかが決まらない。 */
   r.onchange=()=>{
    scLayout.open=r.value;saveScLayout();
    if(r.value==='split'||r.value==='schedule')applyOpenMode(r.value==='schedule');
    renderLayoutPop();
   };
  });
  pop.querySelectorAll('input[name=scSide]').forEach(r=>{
   r.onchange=()=>{
    scLayout.swap=(r.value==='right');saveScLayout();applySplitSide();renderLayoutPop();
   };
  });
  pop.querySelectorAll('input[name=scInsertTip]').forEach(r=>{
   r.onchange=()=>{
    scLayout.tip=(r.value==='on');saveScLayout();
    insertGhostLabel();          // いま出ている案内へその場で当てる
    renderLayoutPop();
   };
  });
  /* 親ロットの印(§9.199)。**選んだ瞬間に表へ当てる**——設定を触った結果が
     その場で見えないと、効いているのか確かめられない(§9.179と同じ作法)。
     バッジは行を組み立てたあとに差し込んでいるので、表ごと描き直す。 */
  pop.querySelectorAll('input[name=scChildBadge]').forEach(r=>{
   r.onchange=()=>{
    scLayout.childBadge=r.value;saveScLayout();
    renderTimeline();
    renderLayoutPop();
   };
  });
  /* バッジを付ける列(§9.235 ②)。**選んだ瞬間に表へ当てる**（同じ作法）。 */
  const badgeCol=pop.querySelector('#scChildBadgeCol');
  if(badgeCol)badgeCol.onchange=()=>{
   scLayout.childBadgeCol=badgeCol.value;saveScLayout();
   renderTimeline();
   renderLayoutPop();
  };
 }
 /* バッジを付ける列の選択肢(§9.235 ②)。**いま画面に出ている列だけ**
    （隠している列を選ばせても、次に開くまでどこにも見えない）。 */
 function childBadgeColOptions(){
  const keys=timelineColumnKeys().filter(k=>k!=='__actions__');
  const cur=scLayout.childBadgeCol;
  const opts=keys.map(k=>`<option value="${esc(k)}"${cur===k?' selected':''}>${esc(scColLabel(k))}</option>`);
  return `<option value=""${cur?'':' selected'}>自動（既定＝ロット番号）</option>`+opts.join('');
 }
 /* ---------- 行の見せ方のパネル(§9.198) ----------
    **その場で当てて、その場で保存する**（#scLayoutPopと同じ作法）。
    保存を別ボタンにすると「効いているのに保存されていない」状態が作れる。
    設定は**全員に効く**ので、そのことをパネルに書く。 */
 function rowStyleTargets(){
  const out=[{key:'cat:planned',label:'予定',hint:'これから流す作業'},
             {key:'cat:doing',label:'作業中',hint:'いま動いている作業'},
             {key:'cat:done',label:'完了',hint:'終わった作業'},
             {key:'cat:cancel',label:'取消',hint:'取り消した予定'},
             {key:'cat:stop',label:'設備停止',hint:'作業以外で設備が塞がる行'},
             {key:'cat:comment',label:'コメント',hint:'時間を取らない申し送り'},
             /* 空の日付・直の枠(§9.238 ②)。時間は取らないが、ここから先の
                起点を動かす行なので、コメントとは別に色を選べるようにする。 */
             {key:'cat:frame',label:'枠',hint:'ここから先を、その日・その直から並べ直す行'}];
  /* 分類ごとの上書き。**登録されている分類だけ**を出す（架空の分類を
     並べない）。分類の指定は区分の指定より優先することを見出しに書く。 */
  (stopCategories||[]).forEach(name=>{
   out.push({key:'stopcat:'+name,label:name,hint:'設備停止の分類',group:'stop'});
  });
  return out;
 }
 /* いま効いているアイコン。**既定は「なし」**(§9.201、利用者の指示)。
    行が無い＝設定していない＝なし。`showIcon:false`もなし。空文字も
    なし（古い保存値がここへ来る）。 */
 function iconValueOf(cur){
  if(!cur||cur.showIcon===false)return 'none';
  return String(cur.icon||'')||'none';
 }
 function iconGlyphHtml(v){
  return rowIconHtml(v)||'<span class="sc-icon-word">—</span>';
 }
 function rowStyleSampleHtml(t){
  const cur=(scRowStyles&&scRowStyles.get(t.key))||null;
  const catKey=t.key.startsWith('cat:')?t.key.slice(4):'stop';
  const color=cur?String(cur.colorKey||''):'';
  return `<span class="sc-row-cat sc-cat-${esc(catKey)}${color?' sc-rs-'+esc(color):''}">`
   +`${rowIconHtml(iconValueOf(cur))}${esc(t.label)}</span>`;
 }
 /* ---------- アイコンを選ぶ盤(§9.201、利用者の指示) ----------
    以前は行の中に`position:absolute`で開いていたため、**浮きパネル
    (`.sc-view-pop`)の`overflow:auto`に切られて下半分が見えなかった**
    （実機で報告）。絶対配置は`overflow`を持つ先祖で必ず切られるので、
    **器の外(`body`直下)へ`position:fixed`で置く**——これがこの作り直しの
    肝で、行の中へ戻さないこと。
    種類も増やした（同梱の線画47＋絵文字18＋文字記号8）ので、
    **名前で絞り込める**ことと**種類ごとに見出しを立てる**ことをセットに
    してある。数が増えるほど、並べただけの一覧は「探す」作業になる。
    盤は**1つだけ**作って使い回す（行ごとに持つと、行の数だけDOMが増え、
    どれが開いているのか分からなくなる）。 */
 let scIconPickTarget=null;
 function ensureIconPicker(){
  let el=$('#scIconPick');
  if(el)return el;
  el=document.createElement('div');
  el.id='scIconPick';el.className='sc-icon-modal';el.hidden=true;
  el.innerHTML=`
   <div class="sc-icon-win" role="dialog" aria-modal="true" aria-labelledby="scIconPickTitle">
    <div class="sc-icon-win-head">
     <b id="scIconPickTitle">アイコンを選ぶ</b>
     <span class="sc-icon-win-for" id="scIconPickFor"></span>
     <button type="button" class="sc-icon-win-close" id="scIconPickClose" title="閉じる（Esc）">✕</button>
    </div>
    <div class="sc-icon-win-tools">
     <input type="search" id="scIconPickQ" placeholder="名前で探す（例: 停止・時計・工具・待ち）" autocomplete="off">
     <small id="scIconPickCount"></small>
    </div>
    <div class="sc-icon-body" id="scIconPickBody"></div>
    <p class="sc-icon-win-foot">選んだ瞬間に保存され、下の表にもすぐ当たります。色は行ごとのプルダウンで選びます。</p>
   </div>`;
  document.body.appendChild(el);
  /* 背景を押しても閉じない（§9.221 ①。閉じ方はどのモーダルでも×／Esc）。 */
  WL.modal.keepOpen(el);
  el.querySelector('#scIconPickClose').onclick=()=>closeIconPicker();
  /* **入力中に盤ごと作り直さない**(§9.117)——入力欄を作り替えると
     1文字ごとにカーソルが飛ぶ。描き直すのは一覧だけ。 */
  el.querySelector('#scIconPickQ').addEventListener('input',()=>renderIconPickBody());
  el.addEventListener('keydown',e=>{if(WL.modal.escCloses(e)){e.stopPropagation();closeIconPicker()}});
  return el;
 }
 function openIconPicker(t){
  if(!t)return;
  const el=ensureIconPicker();
  const cur=(scRowStyles&&scRowStyles.get(t.key))||null;
  scIconPickTarget={key:t.key,current:iconValueOf(cur)};
  el.querySelector('#scIconPickFor').textContent=`${t.label}（${t.hint}）`;
  const q=el.querySelector('#scIconPickQ');q.value='';
  el.hidden=false;
  renderIconPickBody();
  q.focus();
 }
 function closeIconPicker(){
  const el=$('#scIconPick');if(!el||el.hidden)return;
  el.hidden=true;scIconPickTarget=null;
 }
 /* 一覧だけを描き直す。**当たった件数を必ず出す**——0件のときに
    黙って空にすると、壊れているのか当たらないのかが分からない。 */
 function renderIconPickBody(){
  const el=$('#scIconPick');if(!el||!scIconPickTarget)return;
  const q=String(el.querySelector('#scIconPickQ').value||'').trim().toLowerCase();
  /* 種類の見出しでも当たる（「時間」で時間の群がまとめて出る）。 */
  const title=k=>(SC_ICON_GROUPS.find(g=>g[0]===k)||['',''])[1];
  const hit=i=>!q||(i.label+' '+(i.kw||'')+' '+i.v+' '+title(i.kind)).toLowerCase().includes(q);
  const cur=scIconPickTarget.current;
  let n=0;
  const html=SC_ICON_GROUPS.map(([kind,title])=>{
   const items=SC_ROW_ICONS.filter(i=>i.kind===kind&&hit(i));
   if(!items.length)return '';
   n+=items.length;
   return `<div class="sc-icon-grp">${esc(title)}<small>${items.length}</small></div>`
    +`<div class="sc-icon-grid">`+items.map(i=>
      `<button type="button" class="sc-icon-cell${cur===i.v?' is-on':''}" data-icon-pick="${esc(i.v)}"`
      +` aria-pressed="${cur===i.v?'true':'false'}" title="${esc(i.label)}">`
      +`<span class="sc-icon-glyph">${iconGlyphHtml(i.v)}</span><small>${esc(i.label)}</small></button>`).join('')
    +`</div>`;
  }).join('');
  el.querySelector('#scIconPickBody').innerHTML=html
   ||`<p class="sc-icon-empty">「${esc(q)}」に当たるアイコンがありません。<br>
       停止・注意・時計・工具・人・矢印・運搬…といった言い方でも探せます。</p>`;
  el.querySelector('#scIconPickCount').textContent=q?`${n}件`:`ぜんぶで${SC_ROW_ICONS.length}件`;
  el.querySelectorAll('[data-icon-pick]').forEach(b=>{
   b.onclick=()=>{
    const key=scIconPickTarget&&scIconPickTarget.key;
    if(!key)return;
    closeIconPicker();
    saveRowStyle(key,{icon:b.dataset.iconPick});
   };
  });
 }
 /* 題名の見せ方の3つ（§9.295、利用者の指示「色やバッジみたいなデザインを
    付けたい／左寄せにしたり文字の位置を変更できるように」）。
    **作業以外の区分にだけ出す**——作業の行には束ねた題名のマスが無いので、
    出しておいて何も起きないのは押せないボタンと同じ（§4）。
    **語彙はサーバーから**（`scRowTitleVocab`）。届いていなければ何も出さない
    （綴りを画面で推測しない・§9.163）。 */
 function titleRowHtml(t,cur){
  if(!rowTitleSettable(t.key))return '';
  const v=scRowTitleVocab;
  if(!(v.looks||[]).length)return '';
  const seg=(name,list,now,label,hint)=>`<div class="sc-rs-tl-row">
    <span class="sc-rs-tl-k" title="${esc(hint)}">${esc(label)}</span>
    <span class="sc-rs-tl-v">${list.map(x=>
     `<label class="sc-rs-tl-btn${now===x.key?' is-on':''}" title="${esc(x.label)}${x.note?'：'+esc(x.note):''}">
       <input type="radio" name="${esc(name)}-${esc(t.key)}" value="${esc(x.key)}"
         data-rs-title="${esc(name)}"${now===x.key?' checked':''}>
       <span>${esc(x.label)}</span></label>`).join('')}</span></div>`;
  const look=cur?String(cur.titleLook||''):'',
        place=cur?String(cur.titlePlace||''):'',
        align=cur?String(cur.titleAlign||''):'';
  return `<div class="sc-rs-title">
   ${seg('titleLook',v.looks,look,'見せ方','名前を文字だけで出すか、札や帯にするか')}
   ${seg('titlePlace',v.places,place,'位置','内容の列だけを束ねるか、行いっぱいに使うか')}
   ${seg('titleAlign',v.aligns,align,'揃え','束ねたマスの中で、名前をどこへ寄せるか')}
   ${(v.times||[]).length?seg('titleTime',v.times,cur?String(cur.titleTime||''):'',
      '時間','所要時間を（ ）で名前の横に添えるか（既定は出す）'):''}
  </div>`;
 }
 function renderRowStylePop(){
  const pop=$('#scRowStylePop');if(!pop)return;
  const rows=rowStyleTargets();
  const cell=t=>{
   const cur=(scRowStyles&&scRowStyles.get(t.key))||null;
   const color=cur?String(cur.colorKey||''):'';
   const icon=iconValueOf(cur);
   /* **色はプルダウン**(§9.201、利用者の指示「8色くらいなら横並びに
      しなくてプルダウンでよい」)。8個のボタンを横に並べると1行が
      横長になり、右の見本と「戻す」が押し出されていた。閉じた状態の
      選択欄そのものをその色で塗るので、開かなくても今の色が分かる。 */
   return `<div class="sc-rs-row" data-rs="${esc(t.key)}">
    <div class="sc-rs-name"><b>${esc(t.label)}</b><small>${esc(t.hint)}</small></div>
    <select class="sc-rs-colorsel${color?' sc-rs-'+esc(color):''}" data-rs-color
      aria-label="${esc(t.label)}の色" title="行の地と区分の面に付く色です">${SC_ROW_PALETTE.map(p=>
      `<option value="${esc(p.key)}"${color===p.key?' selected':''}>${esc(p.label)}（${esc(p.note)}）</option>`).join('')}</select>
    <button type="button" class="sc-rs-iconbtn" data-rs-iconbtn
      title="アイコンを選びます（絵を見たまま探せます）">
     <span class="sc-rs-iconview">${iconGlyphHtml(icon)}</span>
     <span class="sc-rs-iconname">${esc(iconLabelOf(icon))}</span><em>▾</em>
    </button>
    <div class="sc-rs-sample">${rowStyleSampleHtml(t)}</div>
    <button type="button" class="sc-rs-reset" data-rs-reset${cur?'':' disabled'}
      title="${cur?'この区分の設定を消して、元の色（アイコンなし）へ戻します':'この区分はまだ設定していません（いまが元のままです）'}">⟲ 戻す</button>
    ${titleRowHtml(t,cur)}
   </div>`;
  };
  const cats=rows.filter(r=>!r.group).map(cell).join('');
  const stops=rows.filter(r=>r.group==='stop').map(cell).join('');
  /* 色の意味は**1行だけ先に書く**(§9.200)。行ごとの`title`に隠すと、
     8つの色が何を表すのかを覚えていないと選べない。 */
  const legend=SC_ROW_PALETTE.filter(p=>p.key)
    .map(p=>`<span class="sc-rs-leg sc-rs-${p.key}"><i></i>${esc(p.label)}=${esc(p.note)}</span>`).join('');
  /* **段の見出しと同じ字を中でもう一度出さない**(§8)。ここに要るのは
     「何が起きるか」だけ。 */
  pop.innerHTML=`
   <div class="sc-rs-head">
    <small>変えるのは<b>色と印だけ</b>です。区分の名前は必ず出るので、色が見分けにくい環境でも読めます。
     選んだ瞬間に下の表へ当たり、そのまま保存されます。<b>印は既定では付きません</b>——付けたい区分にだけ選んでください。</small></div>
   <div class="sc-rs-legend"><b>色の目安</b>${legend}</div>
   <div class="sc-rs-cols"><span>区分</span><span>色</span><span>アイコン</span><span>この行の見え方</span><span></span></div>
   <div class="sc-rs-sec"><div class="sc-rs-sec-head">区分ごと<small>すべての行に効きます</small></div>${cats}</div>
   ${stops?`<div class="sc-rs-sec"><div class="sc-rs-sec-head">設備停止の分類ごと<small>同じ行に両方あるときは、こちらが勝ちます</small></div>${stops}</div>`
          :'<p class="sc-layout-note">設備停止の分類はまだ登録されていません（マスタ管理 &gt; 設備停止分類）。登録するとここに並びます。</p>'}
   <p class="sc-layout-note">この設定は<b>全設備・全員に共通</b>です（行表示マスタ）。「⟲ 戻す」で、その区分だけ元の見た目へ戻せます。</p>`;
  pop.querySelectorAll('[data-rs-color]').forEach(sel=>{
   sel.onchange=()=>saveRowStyle(sel.closest('.sc-rs-row').dataset.rs,{colorKey:sel.value});
  });
  pop.querySelectorAll('[data-rs-iconbtn]').forEach(btn=>{
   btn.onclick=e=>{
    e.stopPropagation();
    const key=btn.closest('.sc-rs-row').dataset.rs;
    openIconPicker(rows.find(x=>x.key===key));
   };
  });
  pop.querySelectorAll('[data-rs-reset]').forEach(b=>{
   b.onclick=()=>resetRowStyle(b.closest('.sc-rs-row').dataset.rs);
  });
  /* 題名の3つ（§9.295）。**選んだ瞬間に下の表へ当たり、そのまま保存される**
     ——色・アイコンと同じ作法（覚えることを増やさない）。 */
  pop.querySelectorAll('[data-rs-title]').forEach(inp=>{
   inp.onclick=()=>saveRowStyle(inp.closest('.sc-rs-row').dataset.rs,
     {[inp.dataset.rsTitle]:inp.value});
  });
 }
 /* 1件だけ書く。**失敗したら画面に出す**——黙って握り潰すと「効かない」に
    しか見えない（§9.190で実際にそうなった）。 */
 async function saveRowStyle(key,patch){
  const cur=(scRowStyles&&scRowStyles.get(key))||{};
  const next={key,
   colorKey:patch.colorKey!==undefined?patch.colorKey:String(cur.colorKey||''),
   icon:patch.icon!==undefined?patch.icon:String(cur.icon||''),
   /* **触っていない設定も必ず運ぶ**（§9.212 ②／§9.113）——1つ書き漏らすと
      その設定だけが黙って消える（同じ形で4度踏んでいる）。 */
   titleLook:patch.titleLook!==undefined?patch.titleLook:String(cur.titleLook||''),
   titlePlace:patch.titlePlace!==undefined?patch.titlePlace:String(cur.titlePlace||''),
   titleAlign:patch.titleAlign!==undefined?patch.titleAlign:String(cur.titleAlign||''),
   titleTime:patch.titleTime!==undefined?patch.titleTime:String(cur.titleTime||''),
  };
  next.showIcon=next.icon!=='none';
  /* 利用者IDは送らない——サーバーが端末のログインIDで埋める
     (`request_user_id`)。画面が空文字を送るとそちらが優先されて
     「誰が変えたか」が残らない。 */
  const body={key:next.key,colorKey:next.colorKey,icon:next.icon==='none'?'':next.icon,
              showIcon:next.showIcon,titleLook:next.titleLook,
              titlePlace:next.titlePlace,titleAlign:next.titleAlign,
              titleTime:next.titleTime};
  if(cur.id)body.id=cur.id;
  try{
   await api('/api/schedule/row-style-master'+(cur.id?'/update':''),
     {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   await loadRowStyles(true);
   renderRowStylePop();renderTimeline();
  }catch(e){showToast&&showToast('行の見せ方を保存できませんでした',e.message,5000)}
 }
 async function resetRowStyle(key){
  const cur=(scRowStyles&&scRowStyles.get(key))||null;
  if(!cur||!cur.id)return;
  try{
   await api('/api/schedule/row-style-master/delete',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({id:cur.id})});
   await loadRowStyles(true);
   renderRowStylePop();renderTimeline();
  }catch(e){showToast&&showToast('既定へ戻せませんでした',e.message,5000)}
 }
 function toggleRowStylePop(){
  const pop=$('#scRowStylePop'),btn=$('#scRowStyleBtn');
  if(!pop)return;
  const open=pop.hidden;
  pop.hidden=!open;
  if(btn)btn.classList.toggle('active',open);
  if(open){
   closeLayoutPop();
   /* 分類の一覧が未読なら読む（押した時点で出す。押しても空、にしない）。 */
   Promise.all([loadRowStyles(true),loadStopCategories()]).then(()=>renderRowStylePop());
   renderRowStylePop();
  }
 }
 function closeRowStylePop(){
  /* 盤は`body`直下に居るので、パネルを畳んでも自動では消えない
     （§9.201。行の中に置かないのが肝なので、閉じる側で面倒を見る）。 */
  closeIconPicker();
  const pop=$('#scRowStylePop');if(pop&&!pop.hidden)pop.hidden=true;
  const btn=$('#scRowStyleBtn');
  if(btn){btn.classList.remove('active');btn.setAttribute('aria-expanded','false')}
 }
 function toggleLayoutPop(){
  const pop=$('#scLayoutPop'),btn=$('#scLayoutBtn');
  if(!pop)return;
  const open=pop.hidden;
  pop.hidden=!open;
  if(btn){btn.classList.toggle('active',open);btn.setAttribute('aria-expanded',open?'true':'false')}
  /* **開くのは常に1つ**(§9.199)。以前は「行の見せ方」だけが相手を畳んで
     おり、逆順に押すと2枚重なって出ていた（浮きパネル同士だったので
     重なりが見えていなかっただけ）。 */
  if(open){closeRowStylePop();renderLayoutPop()}
 }
 function closeLayoutPop(){
  const pop=$('#scLayoutPop');if(pop&&!pop.hidden)pop.hidden=true;
  const btn=$('#scLayoutBtn');
  if(btn){btn.classList.remove('active');btn.setAttribute('aria-expanded','false')}
 }
 /* ---------- 「表示」パネル(§9.199) ----------
    見え方の設定の入口。**中身が1つも無いときはボタンごと消す**(§4)
    ——全体俯瞰では、まとめも列も配置も効かない。 */
 function toggleViewPop(){
  const pop=$('#scViewPop'),btn=$('#scViewMenuBtn');
  if(!pop)return;
  const open=pop.hidden;
  pop.hidden=!open;
  if(btn){btn.classList.toggle('active',open);btn.setAttribute('aria-expanded',open?'true':'false')}
  if(open)updateViewMenuUi();
 }
 function closeViewPop(){
  const pop=$('#scViewPop');if(pop&&!pop.hidden)pop.hidden=true;
  const btn=$('#scViewMenuBtn');
  if(btn){btn.classList.remove('active');btn.setAttribute('aria-expanded','false')}
  /* 中の段も畳む——次に開いたとき、前に開いていた段がそのまま出ると
     「どこを見ていたか」より「なぜこれが開いているのか」が先に来る。 */
  closeRowStylePop();closeLayoutPop();
 }
 /* 入口のボタンに**いまの設定を書く**。畳んだ先の値が読めないと、
    開くまで思い出せない（§「思い出させない」）。長い名前は要約して出し、
    正確な名前はパネルの中と`title`に残す。 */
 function updateViewMenuUi(){
  const btn=$('#scViewMenuBtn');if(!btn)return;
  const secs=[$('#scGroupRange'),$('#scHistoryRange'),
              $('#scViewAccRowStyle'),$('#scViewAccLayout')];
  const any=secs.some(el=>el&&!el.hidden);
  btn.hidden=!any;
  if(!any){closeViewPop();updateToolGroups();return}
  const bits=[];
  const grpWrap=$('#scGroupRange');
  if(grpWrap&&!grpWrap.hidden){
   const m=SC_GROUP_MODES.find(x=>x.key===(scState.groupMode||'none'));
   if(m)bits.push(m.short||m.label);
  }
  const histWrap=$('#scHistoryRange');
  if(histWrap&&!histWrap.hidden)bits.push(`過去${scState.historyHours}時間`);
  const state=$('#scViewState');
  if(state){state.textContent=bits.join('・');state.hidden=!bits.length}
  updateToolGroups();
 }

 function ensureSplitDivider(){
  let divider=splitWrap.querySelector('.sc-split-divider');
  if(divider)return divider;
  divider=document.createElement('div');divider.className='sc-split-divider';
  divider.innerHTML='<button type="button" class="sc-split-collapse-btn" title="仕掛一覧の表示/非表示"></button>';
  splitWrap.appendChild(divider);
  divider.querySelector('.sc-split-collapse-btn').onclick=e=>{e.stopPropagation();toggleSplitListCollapsed()};
  divider.addEventListener('mousedown',e=>{
   if(e.target.closest('button')||splitListCollapsed)return;
   e.preventDefault();
   const startX=e.clientX,startW=splitListWidth;
   divider.classList.add('dragging');
   /* **左右を入れ替えたら、掴んだ向きも入れ替わる**(§9.179)。仕掛一覧が右に
      あるとき、境界を右へ引けば一覧は**狭くなる**——`--sc-list-w`は「一覧の
      幅」であって「左からの位置」ではないので、符号を反転させないと
      手の動きと逆に伸び縮みする(実機で報告された)。 */
   const dir=scLayout.swap?-1:1;
   function onMove(ev){
    splitListWidth=Math.min(Math.max(240,startW+dir*(ev.clientX-startX)),Math.round(window.innerWidth*0.7));
    applySplitListWidth();
   }
   function onUp(){
    document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);
    divider.classList.remove('dragging');
    try{localStorage.setItem('scSplitListWidthV1',String(splitListWidth))}catch(err){WL.quiet.note('保存できなくても表示自体は継続する',err)}
   }
   document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
  });
  return divider;
 }
 function applySplitListWidth(){
  if(splitWrap)splitWrap.style.setProperty('--sc-list-w',splitListWidth+'px');
 }
 function updateSplitCollapseUi(){
  if(!splitWrap)return;
  splitWrap.classList.toggle('sc-list-collapsed',splitListCollapsed);
  const btn=splitWrap.querySelector('.sc-split-collapse-btn');
  if(btn){
   // 畳んでいる間は縦書きラベルで「何が畳まれているか」を示す(§9.62)。
   // 矢印だけだと、戻したとき何が出てくるのか分からない。
   /* **矢印は畳む向きを指す**。左右を入れ替えたら向きも入れ替わる(§9.179)
      ——一覧が右にあるのに「◀」では、押した先が読めない。 */
   const open=scLayout.swap?'◀':'▶',shut=scLayout.swap?'▶':'◀';
   btn.innerHTML=splitListCollapsed
    ?`<span aria-hidden="true">${open}</span><span class="sc-split-collapse-label">仕掛一覧</span>`
    :`<span aria-hidden="true">${shut}</span>`;
   btn.title=splitListCollapsed?'仕掛一覧を開きます':'仕掛一覧を畳んで作業スケジュールを広げます';
   btn.setAttribute('aria-expanded',String(!splitListCollapsed));
   btn.setAttribute('aria-label',splitListCollapsed?'仕掛一覧を開く':'仕掛一覧を畳む');
  }
 }
 function toggleSplitListCollapsed(){
  splitListCollapsed=!splitListCollapsed;
  try{localStorage.setItem('scSplitListCollapsedV1',splitListCollapsed?'1':'0')}catch(e){WL.quiet.note('保存できなくても表示自体は継続する',e)}
  updateSplitCollapseUi();
  /* 畳んでいるあいだは中身を読んでいない(§9.182)。開いた時点で読む
     ——押してから「空の一覧」が出るのでは、壊れて見える。 */
  if(!splitListCollapsed)showSplitList().catch(WL.quiet('仕掛一覧を出せない（畳んだままになる）'));
  /* 一覧を畳んだ／開いた時点で「行間クリックで入れられる」かどうかが
     変わる(§9.179)。案内を出し直さないと、押せるのに何も書いていない／
     書いてあるのに押せない状態になる。 */
  updateInsertHintUi();
 }
 function ensureSplitWrap(){
  if(splitWrap)return splitWrap;
  const panel=document.getElementById('schedulePanel');
  if(!ensureGridAnchor()||!panel)return null;
  splitWrap=document.createElement('div');splitWrap.className='sc-split-wrap';
  gridAnchor.parentNode.insertBefore(splitWrap,gridAnchor);
  moveGridTo(splitWrap);
  splitWrap.appendChild(panel);
  ensureSplitDivider();
  applySplitListWidth();
  applySplitSide();
  updateSplitCollapseUi();
  return splitWrap;
 }
 function teardownSplitWrap(){
  if(!splitWrap)return;
  const panel=document.getElementById('schedulePanel');
  const main=gridAnchor.parentNode;
  returnGridHome();
  if(panel)main.insertBefore(panel,gridAnchor);
  splitWrap.remove();
  splitWrap=null;
 }
 // scheduleモードで1設備のタイムラインを見ている間、仕掛一覧を隣に出す
 // (全体俯瞰ボード・editモード等では対象設備が定まらない/追加できないため
 // 意味が無い)。表示自体の有無ではなく分割バーの折りたたみ(上記
 // splitListCollapsed)で利用者が幅を調整する方針にしたため、ここは常に
 // 分割レイアウトを組み立てる(ポップアップ表示中は先に畳む)。
 async function showSplitList(){
  if(!scState.fullControl||scState.boardMode!=='single'||!scState.equipment)return;
  if(listModalOpen)closeListModal();
  ensureSplitWrap();
  document.body.classList.add('sc-split');
  /* ---------- 畳んでいるなら中身を読まない(§9.182) ----------
     「スケジュールだけ」で見ているとき、仕掛一覧は幅0で**画面に無い**。
     それでも2000行×200列を組み立てており、メインスレッドを数百ms塞いで
     いた(実測791ms)——見えないものを作るために、見えているものの操作が
     止まっていた。開いた時点(toggleSplitListCollapsed)で読む。
     **器(分割バー)は先に作る**——取っ手が無いと開く手立てが消える。 */
  if(splitListCollapsed){updateSplitCollapseUi();return}
  const workKey=workDbKey();
  if(typeof S!=='undefined'&&typeof selectDb==='function'&&workKey){
   const navBtn=document.querySelector(`aside [data-db-key="${CSS.escape(workKey)}"]`);
   // 分割表示を組み立てるための内部呼び出し。画面の切替ではないので、
   // ここでスケジュール画面が畳まれないようwithInternalDbSwitchで囲う。
   await WL.withInternalDbSwitch(async()=>{
    try{
     if(S.db!==workKey)await selectDb(workKey,navBtn);
     else if(!scSplitJoinApplied&&typeof load==='function')await load();
    }catch(e){WL.quiet.note('一覧が読めなくてもスケジュール自体の表示は継続する',e)}
   });
   scSplitJoinApplied=true;
  }
 }
 function hideSplitList(){
  document.body.classList.remove('sc-split');
  teardownSplitWrap();
  scSplitJoinApplied=false;
 }
 function updateSplitToggleUi(){
  const applicable=scState.fullControl&&scState.boardMode==='single';
  const modalBtn=$('#scListModalBtn');
  if(modalBtn){modalBtn.hidden=!applicable;modalBtn.classList.toggle('active',listModalOpen)}
  /* **列の設定は編集モードでも開ける**(§9.176)。並び・幅・出す出さないは
     列レイアウトマスタが持ち、モードに関係なく効く——ここを予定を動かせる
     権限(fullControl)で塞いでいたため、測定する端末では列を1本も動かせ
     なかった(見出しのD&Dだけは効いていたので、なお分かりにくい)。
     **足せる項目だけがscheduleモード限定**で、その旨はパネルが文字で言う。 */
  /* **表示列だけはメニューバーに出す**(§9.207、利用者の指示)。§9.199で
     見え方を1枚のパネルへ集めたが、これは触る回数が桁違いに多く、
     「開く→探す→押す」の3手が毎回かかっていた。**入口は1つのまま
     場所だけ動かす**——idを変えずに置き場所を変える。 */
  const contentBtn=$('#scContentModalBtn');
  const colApplicable=scState.boardMode==='single'&&!!scState.equipment;
  if(contentBtn){contentBtn.hidden=!colApplicable;contentBtn.classList.toggle('active',contentPanelOpen())}
  /* 表示の設定(§9.179)は分割表示が意味を持つ場面だけ。 */
  const layoutBtn=$('#scLayoutBtn');
  if(layoutBtn){layoutBtn.hidden=!applicable;if(layoutBtn.hidden)closeLayoutPop()}
  const accLay=$('#scViewAccLayout');if(accLay)accLay.hidden=!applicable;
  /* 行の見せ方(§9.198)は**列の設定と同じ場面**で出す（見え方の設定なので
     予定を動かせる権限は要らない。保存できるかはサーバーが判定し、
     できなければその場で理由を出す）。 */
  const rsBtn=$('#scRowStyleBtn');
  if(rsBtn){rsBtn.hidden=!colApplicable;if(rsBtn.hidden)closeRowStylePop()}
  const accRs=$('#scViewAccRowStyle');if(accRs)accRs.hidden=!colApplicable;
  /* 一覧を広く使う（§9.292 ⑦）は**個別のスケジュール画面のときだけ**
     ——全体俯瞰では畳む相手（道具列）がそもそも小さい。 */
  const wideBtn=$('#scWideBtn');
  if(wideBtn)wideBtn.hidden=!(scState.boardMode==='single'&&!!scState.equipment);
  applyWide();
  updateViewMenuUi();
 }
 /* 中身が1つも出ていない塊は、見出しごと消す(§9.198)。「表示」とだけ書かれた
    空の枠が残ると、何かが壊れているように見える。 */
 function updateToolGroups(){
  document.querySelectorAll('#scHead .sc-tools').forEach(g=>{
   const any=[...g.children].some(el=>!el.classList.contains('sc-tools-label')&&!el.hidden);
   g.hidden=!any;
  });
 }

 /* ---------- .sc-side(案内文+設備停止)の折りたたみ(§9.13改訂) ----------
    「常時表示だとスケジュールの視野を圧迫する」との指摘のため、.sc-side
    全体を折りたたみ可能にし、既定を折りたたみにした。境界に常時見える
    細いタブ(#scSideToggle)を置き、ヘッダーの離れたボタンより発見しやすい
    位置で開閉できるようにする(§9.13で追加した内側の#scStopSectionToggleは
    「設備停止を追加」節だけの開閉として維持し、こちらは.sc-side自体の
    開閉というもう1段上の階層)。 */
 let scSideCollapsed=(()=>{try{return (localStorage.getItem('scSideCollapsedV1')??'1')==='1'}catch(e){return true}})();
 function updateSideUi(){
  const applicable=scState.fullControl&&scState.boardMode==='single';
  const tab=$('#scSideToggle'),side=$('#scSide');
  if(tab)tab.hidden=!applicable;
  if(side)side.hidden=!applicable||scSideCollapsed;
  if(tab){tab.textContent=scSideCollapsed?'◀':'▶';tab.title=scSideCollapsed?'案内・設備停止パネルを表示':'案内・設備停止パネルを隠す'}
 }
 function toggleSideCollapsed(){
  scSideCollapsed=!scSideCollapsed;
  try{localStorage.setItem('scSideCollapsedV1',scSideCollapsed?'1':'0')}catch(e){WL.quiet.note('保存できなくても表示自体は継続する',e)}
  updateSideUi();
 }

 /* 汎用フローティングウィンドウは static/js/core/wl-window.js が持つ(§9.17)。
    ここに置いていたが、スケジュールの状態を一切見ない部品で、
    list-columns.js からも使われている。呼ぶときは WL.makeFloatingWindow。 */

 /* ---------- 仕掛一覧のポップアップ表示(§9.14新設) ----------
    折りたたみ・画面が狭い時でも、分割表示へ切り替えずに一覧からドラッグで
    追加できるようにする代替の入口。#grid自体は同時に1箇所にしか置けない
    ため、開くときは分割表示を畳む。 */
 let listModalOpen=false;
 function ensureListModal(){
  let modal=document.getElementById('scListModal');
  if(modal)return modal;
  modal=document.createElement('div');modal.className='sc-float-win';modal.id='scListModal';modal.hidden=true;
  modal.innerHTML=`
   <div class="sc-float-header"><div><h2>仕掛一覧(ドラッグでスケジュールへ追加)</h2></div><button type="button" id="scListModalClose" title="閉じる">×</button></div>
   <div class="sc-float-body" id="scListModalBody"></div>
   <!-- 下端の細い帯。一覧(#grid)の横スクロールバーとリサイズのつまみが
        同じ位置に重なると、角をドラッグしてもスクロールバーを掴んでしまい
        大きさを変えられない(行数が多いほど確実に重なる)。つまみ用の行を
        確保するために必ず置くこと。 -->
   <div class="sc-float-foot sc-list-foot"><span>行をドラッグ、または複数選択してタイムラインへドロップすると予定に追加されます</span></div>
   <div class="sc-float-resize" title="ドラッグで大きさを変えられます"></div>`;
  document.body.appendChild(modal);
  // 閉じたら分割表示が適用条件を満たしていればそちらへ戻す(該当しなければ
  // showSplitList()内部で無視される)。exitScheduleView/全体ボード切替からの
  // closeListModal()はこのクリックハンドラを経由しないため、無関係な場面で
  // 分割表示を再構築してしまうことはない。
  modal.querySelector('#scListModalClose').onclick=()=>{closeListModal();showSplitList()};
  WL.makeFloatingWindow(modal,{storageKey:'scListModalRectV2',defaultWidth:760,defaultHeight:600,defaultTop:80,minWidth:360,minHeight:320});
  return modal;
 }
 async function openListModal(){
  const modal=ensureListModal();
  if(splitWrap)hideSplitList();
  moveGridTo(modal.querySelector('#scListModalBody'));
  modal.hidden=false;listModalOpen=true;
  // body.sc-mode #grid{display:none}(通常モード、@layer mode)を、分割表示の
  // body.sc-mode.sc-split #gridと同じ考え方で上書きする(§9.14)。
  document.body.classList.add('sc-list-modal-open');
  updateSplitToggleUi();
  const workKey2=workDbKey();
  if(typeof S!=='undefined'&&typeof selectDb==='function'&&workKey2&&S.db!==workKey2){
   const navBtn=document.querySelector(`aside [data-db-key="${CSS.escape(workKey2)}"]`);
   /* 分割表示と同じく、モーダルの中身を用意するための内部呼び出し。
      旧実装ではここだけ内部フラグで囲われておらず、S.dbが作業対象以外の
      ときにモーダルを開くと、selectDbのラッパーがexitScheduleView()を呼んで
      背後のスケジュール画面ごと畳んでいた(exitScheduleViewはcloseListModal()
      も呼ぶため、開いたモーダルもその場で閉じる)。通常はS.dbが既に
      作業対象なので表に出ていなかった。 */
   await WL.withInternalDbSwitch(async()=>{
    try{await selectDb(workKey2,navBtn)}catch(e){WL.quiet.note('ベストエフォート',e)}
   });
  }
 }
 function closeListModal(){
  const modal=document.getElementById('scListModal');
  if(!modal||modal.hidden)return;
  /* 差し込む位置の固定も外す(§9.179)。閉じたのに位置が残っていると、
     次の追加が思い出しもしない場所へ入る。 */
  clearInsertPin();
  modal.hidden=true;listModalOpen=false;
  document.body.classList.remove('sc-list-modal-open');
  returnGridHome();
  updateSplitToggleUi();
 }

 /* 仕掛一覧の表示密度は、作業スケジュール画面だけの「高密度」トグルから
    アプリ全体の表示サイズ(base.jsのapplyUiSize、html[data-ui-size])へ
    統合した。行の高さ・余白・文字サイズはapp.cssの --row-h ・--row-pad-y ・
    --row-pad-x ・--fs 系トークンが --ui-scale を掛けて決めるため、この画面
    固有の切替は不要になった。 */

 /* ---------- ドロップ受入(§9.10): 仕掛一覧の行をタイムラインへドラッグ ----------
    list-view.js側がwindow.__scDragRowsへドラッグ中の行(複数選択時はその
    全体)を置く単純なハンドオフ。パネル全体を受け皿にし、タイムライン・
    側パネルどちらへ落としても同じ追加処理を呼ぶ(的を小さくしない)。 */
 function wireDropTarget(panel){
  if(panel.dataset.dropWired)return;
  panel.dataset.dropWired='1';
  panel.classList.add('sc-drop-target');
  const dropApplicable=()=>scState.fullControl&&scState.boardMode==='single'&&!!scState.equipment&&!sessionBlocked();
  panel.addEventListener('dragover',e=>{
   if((!window.__scDragRows&&!window.__scDragStopReason&&!scState.dragComment&&!scState.dragFrame)||!dropApplicable())return;
   e.preventDefault();
   e.dataTransfer.dropEffect='copy';
   panel.classList.add('sc-drop-active');
   /* **落とした位置へ差し込める**(§9.179改訂。利用者の指示「ドラッグアンド
      ドロップの際も一番最後でなく、指定位置に差し込むこともできるように」)。
      指の位置に隙間を出しておけば、どこへ入るかを落とす前に確かめられる。
      設備停止のドラッグも同じ扱いにする(位置を選べない理由が無い)。 */
   if(WL.scheduleInsert&&WL.scheduleInsert.allowed())WL.scheduleInsert.showAt(e.clientY);
  });
  panel.addEventListener('dragleave',e=>{
   if(e.target!==panel)return;
   panel.classList.remove('sc-drop-active');
   hideInsertGhost();      // 固定していれば残る(§9.179)
  });
  panel.addEventListener('drop',e=>{
   // 設備停止ボタン(§9.13)からのドラッグ&ドロップ。位置に関わらず末尾へ追加する
   // (クリック追加と同じ挙動、タイムライン上の特定位置への挿入は行わない)。
   if(window.__scDragStopReason){
    e.preventDefault();
    panel.classList.remove('sc-drop-active');
    const reason=window.__scDragStopReason;window.__scDragStopReason=null;
    /* 落とした位置へ入れる(§9.179改訂)。位置が決まらなければ末尾。 */
    if(WL.scheduleInsert)scState.insertBefore=WL.scheduleInsert.takeDropTarget();
    if(dropApplicable())addStopReasonToSchedule(reason.id,reason.name);
    else clearInsertPin();
    return;
   }
   /* コメントの枠だけを落とす(§9.191)。**中身は空のまま入れる**——
      落とした位置に枠が見えてから書けるほうが、先に文章を考えるより早い。 */
   if(scState.dragComment){
    e.preventDefault();
    panel.classList.remove('sc-drop-active');
    scState.dragComment=false;
    if(WL.scheduleInsert)scState.insertBefore=WL.scheduleInsert.takeDropTarget();
    if(dropApplicable())addCommentAt('',{focus:true});
    else clearInsertPin();
    return;
   }
   /* 日付・直の枠(§9.238 ②)。**落とした位置を先に控えてから聞く**——
      日付を選んでいる間に位置を忘れると、せっかく狙って落とした意味が無い。 */
   if(scState.dragFrame){
    e.preventDefault();
    panel.classList.remove('sc-drop-active');
    scState.dragFrame=false;
    const at=WL.scheduleInsert?WL.scheduleInsert.takeDropTarget():'';
    if(dropApplicable())openFramePicker(null,{before:at});
    else clearInsertPin();
    return;
   }
   if(!window.__scDragRows)return;
   e.preventDefault();
   panel.classList.remove('sc-drop-active');
   const rows=window.__scDragRows;window.__scDragRows=null;
   if(WL.scheduleInsert)scState.insertBefore=WL.scheduleInsert.takeDropTarget();
   if(!rows||!rows.length||!scState.equipment){clearInsertPin();return}
   if(rows.length===1)addRowToSchedule(rows[0],scState.equipment);
   else addRowsToSchedule(rows,scState.equipment);
  });
 }
 // list-view.jsの選択件数バー(plan-select-bar)から、ドラッグ無しでも同じ
 // 一括追加を呼べるようにする入口(タッチ操作・支援技術向け、§9.10)。
 window.scCurrentDropTarget=function(){
  return (scState.fullControl&&scState.boardMode==='single'&&scState.equipment)?scState.equipment:'';
 };

 window.scAddSelectedRows=function(rows){
  if(!rows||!rows.length||!scState.equipment)return;
  if(rows.length===1)addRowToSchedule(rows[0],scState.equipment);
  else addRowsToSchedule(rows,scState.equipment);
 };
 // 既にスケジュールへ投入済みのロットを仕掛一覧から消す(§9.15新設、
 // list-view.js renderGrid()から参照)。今開いている設備のscState.entries
 // (種別='作業'のみ、設備停止にロット番号は無い)に含まれるロット番号を
 // 返す。楽観的追加(__pending)の間もすぐ一覧から消えてほしいため、ここは
 // pendingかどうかを区別しない。
 window.scScheduledLotSet=function(){
  if(!scState.fullControl||scState.boardMode!=='single'||!scState.equipment)return null;
  const set=new Set();
  scState.entries.forEach(e=>{if(e.kind==='作業'&&e.lotNo)set.add(String(e.lotNo))});
  return set;
 };

 /* ---------- ビュー排他制御 ---------- */
 function exitScheduleView(){
  if(!document.body.classList.contains('sc-mode'))return;
  document.body.classList.remove('sc-mode');
  document.getElementById('schedulePanel')?.setAttribute('hidden','');
  document.getElementById('openSchedule')?.classList.remove('active');
  closeListModal();closeStopModal();closeColumnModal();closeContentPanel();
  hideSplitList();
  stopLockPolling();
  stopSessionHeartbeat();
  stopWorkableWatch();   // 画面を出たら可否の裏取りも止める(§9.51)
  if(scSessionHeldFor){releaseSessionFire(scSessionHeldFor);scSessionHeldFor=null}
  scState.sessionHeld=false;scState.sessionHolder=null;scState.sessionError=null;
  /* 在席の控えも捨てる（§9.211 ②）。残すと、次に開いたとき古い顔ぶれが
     一瞬出る（「読めなかった」と「誰も居ない」を区別する`null`へ戻す）。 */
  scState.sessions=null;
  scLastBlocked=false;   // 次に開いたときは「書ける」から数え直す
  /* 在席チップはヘッダー(タイトル帯)に居るので、**画面を出たら自分で消す**
     (§9.211 ③)。パネルの中に居た頃はパネルごと隠れていたが、今は残る
     ——一覧を見ているのに「編集中 自分」が出ていたら、何の話か分からない。 */
  const who=document.getElementById('scWho');
  if(who){who.hidden=true;who.innerHTML='';who.className='sc-who';who.title=''}
  /* 広く使う印は**この画面のもの**（§9.292 ⑦）——外へ持ち出すと、
     他の画面でヘッダーが消えたまま戻せなくなる。設定（`scLayout.wide`）は
     残すので、次にスケジュールを開けばまた広いまま。 */
  document.body.classList.remove('sc-wide');
  const pill=document.getElementById('scWideExit');
  if(pill)pill.hidden=true;
 }
 window.exitScheduleView=exitScheduleView;

 /* 操作列(#scHead)はヘッダーの#headerViewBarへ移す。画面名はヘッダーが持ち、
    パネルは本文だけを持つ(WL.enterViewのmountViewToolbar参照)。 */
 /* `ownPrint`＝この画面は自分の印刷（#scPrintBtn）を持つので、ヘッダーの
    汎用の「画面を印刷」は出さない（§9.300 ①）。 */
 WL.registerView({key:'schedule',bodyClass:'sc-mode',nav:'openSchedule',toolbar:'#scHead',ownPrint:true,
  header:['作業スケジュール','設備ごとの作業予定と実績'],exit:exitScheduleView});

 async function openScheduleView(){
  WL.enterView('schedule');
  const panel=ensurePanel();panel.hidden=false;
  WL.syncViewToolbar('schedule');   // 操作列(#scHead)はパネル生成後にヘッダーへ載せる

  const am=window.accessMode||{mode:'edit',canFieldReorder:false,fieldReorderEquipment:''};
  // fullControl: 追加・削除・設備停止投入まで可能なのはscheduleモードだけ
  // (§3.1.1のとおり、現場段取りは並べ替え1操作のみに限定する)。
  scState.fullControl=(am.mode==='schedule');
  // §9.44: 並べ替えの可否は**サーバーと同じ条件**で判定する。以前は
  // canFieldReorderだけを見ていたため、現場段取り可の端末なら
  // 「現場段取り対象設備」が未設定でも/別設備でも行がドラッグでき、
  // 動かした瞬間に403で弾かれていた(画面は「並べ替え可」と表示したまま)。
  // 対象設備は1端末につき1設備で、空欄は「未設定」であって全設備許可ではない
  // (§3.1.1・§3.2)。ここを緩めるとAPI側の縛りと食い違うので合わせるだけにする。
  scState.fieldReorderGranted=(am.mode==='edit'&&!!am.canFieldReorder);
  scState.fieldReorderTarget=String(am.fieldReorderEquipment||'').trim();
  scState.fieldReorderOnly=false;   // 対象設備が決まってから改めて立てる
  scState.editable=scState.fullControl;
  scState.pickerEnabled=(am.mode!=='edit');
  // §9.35: 予定から測定を開始できるのは、実際に測定する端末(編集モード)だけ。
  // scheduleモードは計画専用の端末、viewモードは閲覧専用のため出さない。
  scState.canStartWork=(am.mode==='edit');
  // §9.61: 履歴(実績)の削除は、測定する端末(edit)と計画盤を整える端末
  // (schedule)の両方に許す。サーバー側の許可(access_mode.pyの
  // _ENDPOINT_EXTRA_MODES['measurement.backup_delete'])と必ず揃えること。
  // 閲覧モードには出さない。
  scState.canDeleteHistory=(am.mode==='edit'||am.mode==='schedule');
  if(am.mode==='edit'){
   const eq=currentConfiguredEquipment();
   if(!eq){renderUnconfigured();return}
   scState.equipment=eq;
  }
  applyFieldReorderPermission();
  // schedule/viewモードでは、設備を1つ選ぶ前に「全設備の中でどこが空いて
  // いるか」を見せる俯瞰ボードを既定表示にする(§9.9)。editモードは自設備
  // 固定のため俯瞰ボードの意味が無く、常に個別タイムラインのみ。
  scState.boardMode=scState.pickerEnabled?'board':'single';
  /* **開いたときの表示**をここで当てる(§9.179)。`last`(既定)は今までどおり
     前回の折りたたみ状態のまま——わざわざ選んでいない人の見え方を変えない。 */
  if(scLayout.open==='split')splitListCollapsed=false;
  else if(scLayout.open==='schedule')splitListCollapsed=true;
  await renderEquipmentControl(am);
  applyBoardModeUi();
  if(scState.boardMode==='board')await loadOverviewBoard();
  else if(scState.equipment)await refreshAll();
  else renderTimelineMessage('設備を選択してください。');
  startLockPolling();
 }
 window.openScheduleView=openScheduleView;

 /* ---------- 全体/個別の表示切替(§9.9) ---------- */
 function applyBoardModeUi(){
  const inBoard=scState.boardMode==='board';
  const toggle=$('#scModeToggle');if(toggle)toggle.hidden=!scState.pickerEnabled;
  $('#scModeBoard').classList.toggle('active',inBoard);
  $('#scModeSingle').classList.toggle('active',!inBoard);
  $('#scBoard').hidden=!inBoard;
  $('#scSingleBody').hidden=inBoard;
  $('#scBoardWindow').hidden=!inBoard;
  const histWrap=$('#scHistoryRange');if(histWrap)histWrap.hidden=inBoard;
  updateHistoryFromUi();
  const grpWrap=$('#scGroupRange');if(grpWrap)grpWrap.hidden=inBoard;
  updateViewMenuUi();
  if(scState.pickerEnabled)$('#scEquipmentSelect').hidden=inBoard;
  updateSideUi();
  const stopBtn=$('#scStopModalBtn');if(stopBtn)stopBtn.hidden=!scState.fullControl||inBoard;
  const cmtBtn=$('#scCommentBtn');if(cmtBtn)cmtBtn.hidden=!scState.fullControl||inBoard;
  const frmBtn=$('#scFrameBtn');if(frmBtn)frmBtn.hidden=!scState.fullControl||inBoard;
  if(inBoard)closeRowStylePop();
  document.querySelectorAll('.sc-board-window-btn').forEach(btn=>btn.classList.toggle('active',+btn.dataset.hours===scState.boardWindowHours));
  updateSplitToggleUi();
  // 全体俯瞰ボードや対象設備が無い状態では分割表示(§9.10)の意味が無いため
  // 畳む(仕掛一覧を隣に出したまま設備を切り替えても違和感が無いよう、
  // 個別タイムライン表示中はshowSplitList側で改めて出す)。
  if(inBoard){hideSplitList();closeListModal();closeStopModal();closeColumnModal();closeContentPanel();closeViewPop();hideInsertGhost()}
  syncSession();
 }
 async function switchToBoard(){
  if(!scState.pickerEnabled)return;
  scState.boardMode='board';
  /* 俯瞰へ移るとタイムラインを描き直さないので、**選択バーを自分で畳む**
     (§9.170)。残すと、行が1つも見えていないのに「N件を選択中」だけが
     居座る。 */
  renderPickBar(null);
  applyBoardModeUi();
  await loadOverviewBoard();
 }
 /* 現場段取り(並べ替え)の可否を、今表示している設備に対して判定し直す。
    サーバー(routes/schedule.py plan_reorder)と同じく
    「現場段取り可 かつ 現場段取り対象設備 == この設備」でのみ許可する。
    権限はあるのに対象設備が違う/未設定のときは、黙って無効にせず理由を出す
    (マスタ管理で直せる内容なので、何を直せばよいか分かる文言にする)。 */
 function applyFieldReorderPermission(){
  // 対象設備は複数指定・「すべての設備」('*')も書ける。判定はaccess-mode.jsの
  // 共通関数へ寄せる(サーバー側のfield_reorder_equipment_allowsと同じ規則)。
  const matched=scState.fieldReorderGranted
   &&(WL.fieldReorderAllows?.(scState.fieldReorderTarget,scState.equipment)??false);
  scState.fieldReorderOnly=matched;
  scState.editable=scState.fullControl||matched;
  const note=$('#scFieldReorderNote');
  if(!note)return;
  if(matched){
   /* **一致しているときは出さない**(§9.300 ①)。ヘッダーのバッジ
      (#fieldReorderBadge)が「現場段取り 並べ替え可」と同じことを言って
      いるので、ここに出すと同じ文が2つ並ぶ(§CLAUDE 8)。 */
   note.hidden=true;note.classList.remove('is-warn');note.textContent='';
  }else if(scState.fieldReorderGranted){
   note.hidden=false;note.classList.add('is-warn');
   const label=WL.fieldReorderLabel?.(scState.fieldReorderTarget)||'';
   note.textContent=label
    ?`現場段取りの対象設備は「${label}」です`
    :'現場段取りの対象設備が未設定です';
   note.title='マスタ管理 > アクセス権限マスタの「現場段取り対象設備」に'
    +'この設備名を登録すると、並べ替えができるようになります。';
  }else{
   note.hidden=true;note.classList.remove('is-warn');
  }
 }
 async function switchToSingle(){
  scState.boardMode='single';
  applyFieldReorderPermission();
  applyBoardModeUi();
  if(scState.equipment)await refreshAll();
  else renderTimelineMessage('設備を選択してください。');
 }
 // 「再計算」は必ず取り直す(利用者が明示的に最新を求めた操作なので、
 // ここでキャッシュを返すと押しても何も起きないように見える)。
 async function refreshCurrentMode(force=true){
  /* **「再計算」は情報源ごと取り直す**(§9.200)。作業可否(§9.51)の判定材料は
     「一度『可』になったら取り直さない」(§9.67)し、見張り
     (`scheduleWorkableWatch`)も「まだ可でない行があるとき」しか動かないので、
     全部が可になっていると**押しても材料は前のまま**だった。押した人が
     期待しているのは「いま分かることを全部見直す」こと。
     **待たせない**——予定は先に描き、材料の取り直しは裏で走らせる
     （自動の見張りは今までどおり材料を捨てない。押していないのに毎回
     仕掛を読み直すと重い）。 */
  if(force&&typeof invalidateWorkable==='function')invalidateWorkable();
  const r=await (scState.boardMode==='board'?loadOverviewBoard(force):refreshAll(force));
  if(force&&scState.boardMode!=='board'&&scState.equipment
     &&typeof refreshWorkableInBackground==='function')
   refreshWorkableInBackground(true,true);
  return r;
 }

 function renderUnconfigured(){
  $('#scTimeline').innerHTML='<div class="sc-empty-note">使用設備が未登録です。まず使用設備を設定してください。</div>';
  $('#scEquipmentFixed').hidden=true;$('#scEquipmentSelect').hidden=true;
 }

 async function renderEquipmentControl(am){
  const sel=$('#scEquipmentSelect'),fixed=$('#scEquipmentFixed');
  if(scState.pickerEnabled){
   fixed.hidden=true;sel.hidden=false;
   if(typeof loadEquipmentMaster==='function')await loadEquipmentMaster();
   const all=(typeof equipmentMasterState!=='undefined'?equipmentMasterState.items:[])||[];
   /* 使える機能で絞る（§9.302）。**いま開いている設備は落とさない**——
      落とすと、その設備の予定を開いたまま設備名が選択欄から消え、
      別の設備へ移る以外の道が無くなる（§9.15と同じ作法）。
      **絞ったことは`title`で言う**（§4。器は狭いので本文には出せない）。 */
   const cur=String(scState.equipment||'');
   const items=(typeof equipmentUsableFor==='function')
    ?all.filter(x=>equipmentUsableFor(x,'schedule')||x.name===cur):all;
   const off=all.length-items.length;
   sel.innerHTML='<option value="">設備を選択...</option>'+items.map(x=>`<option value="${esc(x.name)}">${esc(x.name)}</option>`).join('');
   sel.value=cur||'';
   sel.title=off?`作業予定で使う設備 ${items.length}件。作業予定で使わない設定の設備 ${off}件は出していません（マスタ管理＞設備＞使える機能）。`
    :'この予定表で開く設備を選びます。';
  }else{
   sel.hidden=true;fixed.hidden=false;
   fixed.textContent=`設備: ${scState.equipment}(使用設備)`;
  }
 }

 /* ---------- ロック表示(§9.3、数秒間隔でポーリング) ---------- */
 async function refreshLockBadge(){
  try{
   const r=await api('/api/schedule/lock-status');
   const badge=$('#scLockBadge');if(!badge)return;
   if(r.configured&&r.locked){
    /* **「編集中」とは言わない**（§9.211 ②）。これは1回の書込を掴んで
       いるほんの一瞬のロックで、編集権（在席表示`#scWho`）とは別のもの。
       同じ言葉だと、どちらの話なのか読む側が判別できない。 */
    badge.hidden=false;badge.textContent=`書込中: ${r.holderLogin||'?'}@${r.holderPc||'?'}`;
    badge.title='いま共有スケジュールへ書き込んでいる端末です（1回の書込ぶんの短いロック）。編集権とは別のものです。';
   }else{
    badge.hidden=true;
   }
  }catch(e){WL.quiet.note('ロック表示はベストエフォート',e)}
 }
 function startLockPolling(){
  stopLockPolling();
  refreshLockBadge();
  scLockTimer=setInterval(refreshLockBadge,5000);
  /* 共有の見張りの様子も見に行く(§9.188)。**ロックとは別の間隔**にして
     ある——ロックは「いま誰かが書いている」の表示で数秒ごとに要るが、
     こちらはサーバー側が間隔を持っているので、そこまで細かく見なくてよい。 */
  refreshSyncBadge();
  scSyncTimer=setInterval(refreshSyncBadge,10000);
  /* 在席（誰が編集権を持っているか）も同じ周期で取り直す（§9.211 ②）。
     **TTLは90秒**なので10秒で十分間に合う。読むだけなので共有への負荷も
     小さい（小さなJSONを1枚読む）。 */
  refreshSessionsWho();
  scWhoTimer=setInterval(refreshSessionsWho,10000);
 }
 function stopLockPolling(){
  if(scLockTimer){clearInterval(scLockTimer);scLockTimer=null}
  if(scSyncTimer){clearInterval(scSyncTimer);scSyncTimer=null}
  if(scWhoTimer){clearInterval(scWhoTimer);scWhoTimer=null}
 }

 /* ---------- 編集セッション(§9.11新設) ----------
    「設備単位で同時に1人しか編集作業に入れない」ための助言的ロック
    (backend/schedule_sync.pyのacquire_session系)。1設備のタイムラインを
    開いている間だけ保持し、25秒おきに延長(サーバー側TTLは90秒、数回分の
    取りこぼしを許容する余裕を持たせてある)。他端末が保持中の場合は
    バナーを出し、追加・削除・並べ替え・設備停止投入を止める(下記
    sessionBlocked()、実際の書込APIもrequire_session()で二重に弾く)。 */
 function sessionApplicable(){
  /* **編集権を持つのは「書ける端末」全部**（§9.211 ②、利用者の指示
     「スケジュール編集者が1名になるまでは後から入った人は編集権を持たず、
     READONLY」）。以前は`fullControl`＝scheduleモードだけで、現場段取り
     （editモードで並べ替えだけできる端末）はセッションの外に居た
     ——2台のedit端末が同じ設備を同時に並べ替えられ、在席にも出なかった。
     `scState.editable`は「scheduleモード」または「現場段取りの対象設備が
     一致するeditモード」のときだけ真なので、書けない端末は掴まない。 */
  return !!scState.editable&&scState.boardMode==='single'&&!!scState.equipment;
 }
 // 「他端末がこの設備を編集中」と確定できた場合(423+sessionLockedBy)だけ
 // 操作を止める。ネットワーク不調・タイムアウト等、確定できないエラーでは
 // 操作を止めない(fail-open)。schedule_share_pathは工場ネットワーク共有上に
 // あり、CLAUDE.mdに記録の通り遅延・一時的な接続不調が実際に起きる環境の
 // ため、「原因不明のエラー=安全側でブロック」にすると、ネットワークが
 // 少し不安定なだけで無言のまま追加・削除・並べ替え・ドラッグが一切効かなく
 // なるという、この機能が解決したかった「遅い」より遥かに悪い状態になって
 // しまう(実際に報告された不具合。#scSessionBannerも表示されないまま
 // 固まって見える点が特に悪い)。データ本体の整合性はwith_write()側の
 // ロック+改訂番号チェックが最終防御として引き続き機能するため、この
 // セッション機構が失敗してもデータが壊れることはない。
 /* **編集セッションは「名乗る役」で、操作は止めない**（§9.291 ③、利用者との
    確認「書き込みの主導権は最初のユーザーにして、依頼を受けて編集権を持つ
    ものが代理で書き込む形という意味では READONLY である必要はない」）。

    データの整合を守っているのはREADONLYではない——
      ①共有ファイルを触るのは持ち主1台（§9.192の代理書き込み）
      ②書くときは必ずロック→取り直し→適用→改訂番号（§4.2）
      ③並べ替えは「送ったIDの集合が今の未着手予定と完全一致」しないと断る
    の3枚。READONLYが防いでいたのは**人の意図の衝突**だけで、そのうち本当に
    残るのは「同じ顔ぶれのまま2人が同時に並べ替える」1件——そこは
    `baseOrderedIds`（§9.291 ③）が受け、**黙って上書きせず読み直す**。

    厳密に「1設備1人」で運用したい現場のために、共通設定の
    `schedule_session_block`='on' で今までどおり止められる（**既定はoff**）。
    値はサーバーが答える（`/api/schedule/session/acquire`の`blocking`）
    ——画面に既定を書き写すと、設定を変えたときに片方だけ古くなる。 */
 function sessionBlocking(){return scState.sessionBlocking===true}
 function sessionBlocked(){
  return sessionBlocking()&&sessionApplicable()&&!scState.sessionHeld&&!!scState.sessionHolder;
 }
 async function acquireSessionOnce(){
  const eq=scState.equipment;
  try{
   const r=await api('/api/schedule/session/acquire',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({equipment:eq})});
   if(scState.equipment!==eq)return; // 応答が届く前に設備が切り替わっていたら結果を捨てる
   /* **止めるかどうかはサーバーが答える**（§9.291 ③）。既定を画面へ写さない。 */
   scState.sessionBlocking=(r&&r.blocking===true);
   scState.sessionHeld=true;scState.sessionHolder=null;scState.sessionError=null;
  }catch(e){
   if(scState.equipment!==eq)return;
   scState.sessionHeld=false;
   if(e.blocking!==undefined)scState.sessionBlocking=(e.blocking===true);
   if(e.sessionLockedBy&&(e.sessionLockedBy.loginId||e.sessionLockedBy.pcName)){
    // 明確に他端末が保持中と判定できた場合だけブロック対象にする。
    scState.sessionHolder=e.sessionLockedBy;scState.sessionError=null;
   }else{
    // 原因不明(ネットワーク不調・タイムアウト・設定未完了等)。ブロックは
    // しないが、状況が分かるよう控えめな警告だけは出す(renderSessionBanner)。
    scState.sessionHolder=null;scState.sessionError=e.message||String(e);
   }
  }
  renderSessionBanner();
  /* 取得の結果はすぐ在席表示へ映す（§9.211 ②）。**奪われた側もここで
     気づく**——ハートビートが423になった時点で読み取り専用へ落ちる。 */
  refreshSessionsWho();
 }
 function startSessionHeartbeat(){
  stopSessionHeartbeat();
  scSessionHeldFor=scState.equipment;
  acquireSessionOnce();
  scSessionTimer=setInterval(acquireSessionOnce,25000);
 }
 function stopSessionHeartbeat(){
  if(scSessionTimer){clearInterval(scSessionTimer);scSessionTimer=null}
 }
 function releaseSessionFire(equipment){
  // タブを閉じる際にも呼ばれるため、確実性を優先してsendBeacon(base.jsの
  // notifyTabClosedと同じ考え方)を使い、非対応環境ではfetchへフォールバック
  // する。応答は待たない(ベストエフォート)。
  if(!equipment)return;
  try{
   const ok=navigator.sendBeacon&&navigator.sendBeacon('/api/schedule/session/release',
    new Blob([JSON.stringify({equipment})],{type:'application/json'}));
   if(ok)return;
  }catch(e){WL.quiet.note('フォールバックへ',e)}
  try{
   api('/api/schedule/session/release',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({equipment})}).catch(WL.quiet('編集権を手放せない（期限で自然に解ける）'));
  }catch(e){WL.quiet.note('ベストエフォート',e)}
 }
 async function syncSession(){
  if(scSessionHeldFor&&scSessionHeldFor!==scState.equipment){
   stopSessionHeartbeat();
   releaseSessionFire(scSessionHeldFor);
   scSessionHeldFor=null;
  }
  if(!sessionApplicable()){
   stopSessionHeartbeat();
   /* **握ったままにしない**（§9.211 ②）。以前は「設備が変わったとき」しか
      解放しておらず、全体俯瞰へ切り替えた／設備の選択を空へ戻したときは
      **サーバーのセッションがTTL（90秒）ぶん残っていた**。在席表示を出す
      と「居ないのに居ることになっている」がそのまま画面に出るので、
      ここで必ず返す。 */
   if(scSessionHeldFor){releaseSessionFire(scSessionHeldFor);scSessionHeldFor=null}
   if(scState.sessionHeld||scState.sessionHolder||scState.sessionError){
    scState.sessionHeld=false;scState.sessionHolder=null;scState.sessionError=null;
   }
   renderSessionBanner();
   return;
  }
  if(scSessionTimer)return; // 既にこの設備でハートビート中
  startSessionHeartbeat();
 }
 /* 編集権が入れ替わったら**表そのものを描き直す**（§9.211 ②）。
    READONLYの見せ方は帯とチップだけでは足りない——行の`draggable`・外す/固定の
    ボタンは`renderTimeline()`が`sessionBlocked()`を見て決めているので、
    描き直さないと**掴めるのに落とすと弾かれる行**が残る（§4「できないことは
    できないと書く」の裏返しで、押せるのに何も起きないのと同じ）。
    **変わった瞬間だけ**描き直す（毎回描くと10秒ごとに表がちらつく）。
    列幅を掴んでいる最中は`WL.columnResize.defer`が離すまで待つ（§9.209 ①）。 */
 /* 初期値は`false`（＝書ける）。`null`にすると、開いた直後の1回目で
    「null→false」を変化とみなして無駄に1回描き直す。最初から他端末が
    持っている場合は「false→true」で正しく拾える。 */
 let scLastBlocked=false,scWhoRendering=false;
 function syncBlockedView(){
  const now=sessionApplicable()?sessionBlocked():false;
  if(scLastBlocked===now)return;
  scLastBlocked=now;
  /* `sc-session-locked`の付け外しは`applyWriteControlsEnabled()`が持ち主
     （このすぐ下で必ず通る）。ここで一緒に触ると判定が2箇所になる。 */
  if(!scState.equipment||!(scState.entries||[]).length)return;
  const redraw=()=>{try{renderTimeline()}catch(e){console.warn('編集権の切り替えで描き直せませんでした',e)}};
  if(WL.columnResize&&WL.columnResize.defer)WL.columnResize.defer('schedule:sessionBlocked',redraw);
  else redraw();
 }
 function renderSessionBanner(){
  if(!scWhoRendering){scWhoRendering=true;try{syncBlockedView()}finally{scWhoRendering=false}}
  renderSessionWho();
  const box=$('#scSessionBanner');if(!box)return;
  if(!sessionApplicable()||scState.sessionHeld){
   box.hidden=true;box.innerHTML='';box.className='sc-session-banner';
   applyWriteControlsEnabled(true);
   return;
  }
  if(scState.sessionHolder){
   /* **止めない設定なら帯を出さない**（§9.291 ③）——誰が主担当かは
      タイトル帯の在席表示(`#scWho`)が1箇所で言う（§CLAUDE 8「同じ情報を
      2箇所に出さない」）。操作できるのに読み取り専用の帯が出ていると、
      「保存できませんでした」と同じで**嘘の合図**になる。 */
   if(!sessionBlocking()){
    box.hidden=true;box.innerHTML='';box.className='sc-session-banner';
    applyWriteControlsEnabled(true);
    return;
   }
   /* 他端末が保持中と確定できた場合だけ操作を止める(sessionBlocked()と同じ判定)。
      **誰が編集中かはここには書かない**——タイトル帯の在席表示(`#scWho`)が
      1箇所で言う（§CLAUDE 8「同じ情報を2箇所に出さない」）。ここに残すのは
      「いま何ができないか」だけ。 */
   box.hidden=false;box.className='sc-session-banner sc-session-banner-blocked';
   box.innerHTML='<span>読み取り専用です。追加・削除・並べ替え・設備停止・申し送りは操作できません'
     +'（表示・印刷・列の設定はできます）。編集権は上の帯で確かめられます。</span>';
   applyWriteControlsEnabled(false);
   return;
  }
  if(scState.sessionError){
   // 原因不明のエラー。操作は止めない(fail-open)が、編集セッションが
   // 正しく機能していない可能性を控えめに伝える(閉じるだけで消せる)。
   box.hidden=false;box.className='sc-session-banner sc-session-banner-warn';
   box.innerHTML=`<span>編集セッションの取得に失敗しました(${esc(scState.sessionError)})。他端末との同時編集チェックが一時的に効かない可能性がありますが、操作は継続できます。</span><button type="button" id="scSessionRetry">再試行</button><button type="button" id="scSessionDismiss" title="閉じる">×</button>`;
   $('#scSessionRetry').onclick=()=>acquireSessionOnce();
   $('#scSessionDismiss').onclick=()=>{box.hidden=true};
   applyWriteControlsEnabled(true);
   return;
  }
  box.hidden=true;box.innerHTML='';box.className='sc-session-banner';
  applyWriteControlsEnabled(true);
 }
 function applyWriteControlsEnabled(enabled){
  const panel=document.getElementById('schedulePanel');
  if(panel)panel.classList.toggle('sc-session-locked',!enabled);
 }

 /* ================================================================
    編集権の在席表示（§9.211 ②、利用者の指示）
    ----------------------------------------------------------------
    「READONLYで読み取り、だれが入っているか表示（作業スケジュールの
     タイトル帯の空白エリアを利用してください）、かつ強制的に編集権を
     奪うように切り替える機能も実装してください」

    - **編集権を持てるのは設備ごとに1人**（元からの仕組み。TTL90秒・
      25秒ごとに延長）。後から入った人はREADONLYになる。
    - **誰が入っているかは常に文字で出す**（§3 状態は色だけで伝えない）。
      設備をまたいだ在席も`title`で読める——他の設備を触ろうとして
      「なぜ入れないのか」を探させない。
    - **抜けているのに残っている**ときのために奪える（§4「できないことは
      できないと書く」の裏返し。待つしか手立てが無いと現場が止まる）。
      危ない操作なので**確認を必ず出し**、相手の名前を確認文へ書く。
    ================================================================ */
 async function refreshSessionsWho(){
  const eq=scState.equipment;
  try{
   const r=await api('/api/schedule/sessions');
   if(scState.equipment!==eq)return; // 応答が届く前に設備が切り替わっていたら捨てる
   scState.sessions=r.sessions||[];
   scState.me=r.me||null;
   scState.sessionsConfigured=r.configured!==false;
   /* **止めるかどうかもここで受け取る**（§9.291 ③）。ハートビートは25秒
      ごとなので、それだけに任せると設定を変えても最大25秒は古い見せ方の
      まま。10秒ごとのこの巡回で拾う。 */
   if(r.blocking!==undefined)scState.sessionBlocking=(r.blocking===true);
  }catch(e){
   if(scState.equipment!==eq)return;
   /* 読めなかったことと「誰も居ない」は違う（§CLAUDE）。控えは触らず、
      在席表示は「確かめられません」に落とす。 */
   scState.sessions=null;
  }
  /* **在席一覧は「奪われた」ことに気づく一番早い手立て**（§9.211 ②）。
     ハートビートは25秒ごとなので、それだけに任せると奪われてから最大
     25秒は編集できるように見えたまま書きに行って弾かれる。10秒ごとの
     この巡回で持ち主が自分でなくなっていたら、その場で読み取り専用へ
     落とす（逆に自分に戻っていたら編集中へ戻す）。
     **読めなかったとき（null）は何も変えない**——「確かめられなかった」
     を「奪われた」と読み替えると、共有が一瞬不調なだけで編集が止まる
     （fail-openの方針。sessionBlocked()の但し書きと同じ理由）。 */
  if(Array.isArray(scState.sessions)&&sessionApplicable()&&eq){
   const cur=scState.sessions.find(x=>x.equipment===eq)||null;
   if(cur&&!cur.mine){
    scState.sessionHeld=false;
    scState.sessionHolder={loginId:cur.holderLogin||'',pcName:cur.holderPc||''};
    scState.sessionError=null;
   }else if(cur&&cur.mine){
    scState.sessionHeld=true;scState.sessionHolder=null;scState.sessionError=null;
   }else if(scState.sessionHolder||scState.sessionHeld){
    /* **誰も持っていない設備を「読み取り専用」のままにしない**（§9.211 ②、
       利用者の指示「抜けているのに残っていて編集権が映らないのも困る」）。
       ここへ来るのは、相手が抜けた／TTLが切れた／自分の延長が落ちた場合。
       どちらに転んでも**いま信じている状態は嘘**なので捨て、その場で
       取りに行く——ハートビート（25秒）を待つと、空いているのに最大25秒
       READONLYのままになる（まさに利用者が困ると言った状態）。
       **取りに行くのは1本だけ**（scReclaimingで押さえる）。
       `acquireSessionOnce()`は最後にここを呼ぶが、取れていれば
       `cur.mine`が真になるので回り続けない。 */
    scState.sessionHeld=false;scState.sessionHolder=null;scState.sessionError=null;
    if(!scReclaiming){
     scReclaiming=true;
     Promise.resolve()
      .then(()=>acquireSessionOnce())
      .catch(WL.quiet('編集権を取り直せない（次の巡回で取り直す）'))
      .then(()=>{scReclaiming=false});
    }
   }
   renderSessionBanner(); // 帯と在席チップの両方を描き直す
   return;
  }
  renderSessionWho();
 }
 function whoLabel(x){
  const id=(x&&(x.holderLogin||x.loginId))||'';
  const pc=(x&&(x.holderPc||x.pcName))||'';
  return `${id||'?'}@${pc||'?'}`;
 }
 function meLabel(){
  const m=scState.me;
  return m?`${m.loginId||'?'}@${m.pcName||'?'}`:'この端末';
 }
 /* いま自分がこの設備の編集権を持っているか。**在席一覧を正とする**
    ——ハートビートの成否(`scState.sessionHeld`)は自分の見立てで、
    奪われた直後は次のハートビートまで古いままになる。 */
 function mySessionEntry(){
  const list=scState.sessions;
  if(!Array.isArray(list))return null;
  return list.find(x=>x.equipment===scState.equipment)||null;
 }
 function renderSessionWho(){
  const box=$('#scWho');if(!box)return;
  const list=scState.sessions;
  const others=Array.isArray(list)?list.filter(x=>x.equipment!==scState.equipment):[];
  const otherText=others.length
   ?others.map(x=>`${x.equipment}: ${whoLabel(x)}${x.mine?'（自分）':''}`).join(' ／ ')
   :'';
  if(!sessionApplicable()){
   /* 全体俯瞰・編集モードでは自分の編集権は関係ないが、**誰が入って
      いるかは知りたい**（入れない理由を探させない）。件数だけ出す。 */
   if(!Array.isArray(list)||!list.length){box.hidden=true;box.innerHTML='';return}
   box.hidden=false;box.className='sc-who sc-who-info';
   box.innerHTML=`<b class="sc-who-state">編集中の設備 ${list.length}件</b>`;
   box.title=list.map(x=>`${x.equipment}: ${whoLabel(x)}${x.mine?'（自分）':''}`).join('\n');
   return;
  }
  box.hidden=false;
  const blocked=sessionBlocked();
  const mine=mySessionEntry();
  const tip=t=>{box.title=t+(otherText?`\n他の設備: ${otherText}`:'')};
  if(blocked){
   const h=scState.sessionHolder||{};
   box.className='sc-who sc-who-blocked';
   box.innerHTML=`<b class="sc-who-state">読み取り専用</b>`
    +`<span class="sc-who-holder">${esc(whoLabel(h))} が編集中</span>`
    +`<button type="button" class="sc-who-take" id="scWhoTake"`
    +` title="相手の編集権を取り上げて、この端末で編集できるようにします。相手は次の確認（25秒以内）で読み取り専用になります">編集権を奪う</button>`;
   const btn=$('#scWhoTake');if(btn)btn.onclick=()=>takeOverSession();
   tip(`${scState.equipment} は ${whoLabel(h)} が編集中です。この端末（${meLabel()}）は読み取り専用です。`);
   return;
  }
  /* **止めない設定で、ほかの端末が主担当のとき**（§9.291 ③）。
     操作はできるので「読み取り専用」とは言わない——言うと嘘の合図になる。
     出すのは「誰と一緒に触っているか」と、**同時に並べ替えたときどうなるか**
     （後から保存したほうが残る＝§9.291 ③の唯一の衝突）。 */
  if(scState.sessionHolder&&!scState.sessionHeld){
   const h=scState.sessionHolder||{};
   box.className='sc-who sc-who-info';
   box.innerHTML=`<b class="sc-who-state">主担当</b>`
    +`<span class="sc-who-holder">${esc(whoLabel(h))}（この端末も操作できます）</span>`;
   tip(`${scState.equipment} は ${whoLabel(h)} が主担当ですが、この端末（${meLabel()}）でも`
     +'追加・並べ替え・作業開始ができます。\n'
     +'同じ顔ぶれのまま2人が並べ替えたときは、後から保存したほうの並びが残ります'
     +'（先に変わっていたら、上書きせずに読み直します）。');
   return;
  }
  if(scState.sessionHeld||(mine&&mine.mine)){
   box.className='sc-who sc-who-mine';
   box.innerHTML=`<b class="sc-who-state">編集中</b><span class="sc-who-holder">自分（${esc(meLabel())}）</span>`;
   tip(`${scState.equipment} はこの端末が編集しています。`
     +(sessionBlocking()?'ほかの端末は読み取り専用になります。'
       :'ほかの端末も操作できます（主担当としてこの端末が名乗っています）。'));
   return;
  }
  if(list===null){
   /* **読めなかったことを「誰も居ない」と言わない**（§CLAUDE）。 */
   box.className='sc-who sc-who-unknown';
   box.innerHTML=`<b class="sc-who-state">編集権を確かめられません</b>`;
   tip('共有フォルダの在席ファイルを読めませんでした。操作は続けられますが、同時編集の見張りは効いていない可能性があります。');
   return;
  }
  box.className='sc-who sc-who-wait';
  box.innerHTML=`<b class="sc-who-state">編集権を確認中</b>`;
  tip(`${scState.equipment} の編集権を取りに行っています。`);
 }
 /* **奪うのは危ない操作**なので、相手の名前を出して1回だけ確認する（§5）。
    奪われた側は次のハートビート（25秒以内）で読み取り専用へ落ち、書込APIも
    `require_session()`で弾くので、気づかないまま書き続けることは無い。 */
 async function takeOverSession(){
  const eq=scState.equipment;if(!eq)return;
  const h=scState.sessionHolder||{};
  const ok=await confirmModal({
   message:`${eq} の編集権を ${whoLabel(h)} から取り上げますか？\n\n`
     +`・相手の画面は次の確認（25秒以内）で読み取り専用になります\n`
     +`・相手が編集の途中なら、その作業は続けられなくなります\n`
     +`・相手が本当に抜けているかを確かめてから実行してください`,
   danger:true,title:'編集権を奪う',confirmLabel:'編集権を奪う'});
  if(!ok)return;
  try{
   const r=await api('/api/schedule/session/take-over',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({equipment:eq})});
   if(scState.equipment!==eq)return;
   scState.sessionHeld=true;scState.sessionHolder=null;scState.sessionError=null;
   showToast&&showToast('編集権を引き継ぎました',
     r.takenFrom?`${whoLabel({holderLogin:r.takenFrom.login,holderPc:r.takenFrom.pc})} から引き継ぎました`
                :'この端末で編集できます',4000);
   /* 奪ったらすぐ延長を始める（TTLは90秒）。在席表示も取り直す。 */
   startSessionHeartbeat();
   await refreshSessionsWho();
  }catch(e){
   /* 同じ瞬間にもう1台が奪っていた等。**黙って「取れた」ことにしない。** */
   showToast&&showToast('編集権を奪えませんでした',e.message||String(e),6000);
   await refreshSessionsWho();
  }
  renderSessionBanner();
 }
 // タブを閉じる時に保持中のセッションを解放する(base.jsのnotifyTabClosedと
 // 同じ二重登録方針。pagehideが本来カバーする範囲の方が広いが、ブラウザ
 // 実装差の保険としてunloadでも同じ通知を送る)。
 function releaseSessionOnUnload(){if(scSessionHeldFor)releaseSessionFire(scSessionHeldFor)}
 window.addEventListener('pagehide',releaseSessionOnUnload);
 window.addEventListener('unload',releaseSessionOnUnload);

 /* ---------- 全体俯瞰ボード(§9.9) ----------
    設備ごとに1行、右側へ「残作業量」を色分けした帯(次24/48時間の
    ミニタイムライン)を並べる。時刻計算はGET /api/schedule/overview
    (backend/schedule_calc.expand_plan()を設備分ループしたもの)に
    一本化し、ここでは色分け・幅計算などの表示ロジックのみを行う
    (CLAUDE.mdの「関数の定義は1箇所」、§7.1と同じ方針)。 */
 function loadLevelClass(pendingMinutes){
  if(!pendingMinutes)return 'sc-lv-0';
  if(pendingMinutes<=120)return 'sc-lv-1';
  if(pendingMinutes<=360)return 'sc-lv-2';
  return 'sc-lv-3';
 }
 // 共有スケジュールDBはネットワーク共有上にあり、設備数だけ予定を展開する
 // ため数秒かかることがある。パネル内の「読み込んでいます…」だけだと画面
 // 全体では無反応に見えるので、WAITING表示も併せて出す(withWaitingは
 // 速いときには出ないため、ローカル検証時の操作感は変わらない)。
 async function loadOverviewBoard(force){
  if(!force&&scOverviewCache)return loadOverviewBoardInner(false);
  if(typeof withWaiting!=='function')return loadOverviewBoardInner(force);
  return withWaiting({title:'全設備の空き状況を読み込んでいます',detail:'共有スケジュールDBを参照しています',
   progress:'設備ごとの予定を展開して集計しています'},()=>loadOverviewBoardInner(force));
 }
 async function loadOverviewBoardInner(force){
  const board=$('#scBoard');if(!board)return;
  if(!force&&scOverviewCache){
   scState.overview=scOverviewCache.rows;
   renderOverviewBoard();updateFreshnessUi(scOverviewCache.fetchedAt);
   return;
  }
  board.innerHTML='<div class="sc-empty-note">読み込んでいます…</div>';
  try{
   const r=await api('/api/schedule/overview');
   if(!r.configured){
    board.innerHTML='<div class="sc-empty-note">スケジュール機能が設定されていません(config/local.jsonのschedule_share_path未設定)。</div>';
    return;
   }
   scState.overview=r.equipment||[];
   scOverviewCache={rows:scState.overview,fetchedAt:Date.now()};
   renderOverviewBoard();updateFreshnessUi(scOverviewCache.fetchedAt);
  }catch(e){
   board.innerHTML=`<div class="sc-empty-note">俯瞰ボードを取得できませんでした: ${esc(e.message)}</div>`;
  }
 }
 function overviewRows(){
  const rows=scState.overview.slice();
  if(scState.overviewSort==='busy')rows.sort((a,b)=>(b.pendingMinutes||0)-(a.pendingMinutes||0));
  return rows;
 }
 /* 時間の書き方を変えたら、**いま出ている表も書き直す**（§9.341）。
    次の描画まで待たせると、選んだのに変わらない＝設定が壊れているのと
    見分けが付かない。盤と一覧は出ている側だけを描き直す（隠れている側は
    次に開くとき新しい書き方で組み上がる）。 */
 document.addEventListener('wl:duration-style',()=>{
  const panel=$('#schedulePanel');if(!panel||panel.hidden)return;
  const board=$('#scOverviewBoard');
  try{if(board&&!board.hidden)renderOverviewBoard()}
  catch(e){WL.quiet.note('盤を描き直せなかった（次に開くときに直る）',e)}
  try{if($('#scTimeline'))renderTimeline()}
  catch(e){WL.quiet.note('一覧を描き直せなかった（次に開くときに直る）',e)}
 });

 function renderOverviewBoard(){
  const board=$('#scBoard');if(!board)return;
  if(!scState.overview.length){board.innerHTML='<div class="sc-empty-note">設備マスタが未登録です。</div>';return}
  const windowHours=scState.boardWindowHours;
  const windowMs=windowHours*3600000;
  const now=Date.now();
  const ticks=[];
  for(let h=0;h<=windowHours;h+=(windowHours>24?12:6))ticks.push(h);
  const axis=`<div class="sc-board-axis"><span class="sc-board-axis-label">設備</span><span class="sc-board-axis-track">${
    ticks.map(h=>`<span class="sc-board-axis-tick" style="left:${(h/windowHours*100).toFixed(2)}%">${h===0?'今':h+'h'}</span>`).join('')
   }</span></div>`;
  const rows=overviewRows().map(row=>{
   const lv=loadLevelClass(row.pendingMinutes);
   const swatchText=row.pendingMinutes?`残 ${WL.duration.text(row.pendingMinutes)}・${row.pendingCount}件`:'空き';
   const activeChip=row.active?'<span class="sc-board-active-chip">稼働中</span>':'';
   const overdueChip=row.maxOverdueMinutes>0?`<span class="sc-board-overdue-chip">遅延 ${WL.duration.text(row.maxOverdueMinutes)}</span>`:'';
   const blocks=row.blocks.map(b=>{
    const start=new Date(b.plannedStart).getTime(),end=new Date(b.plannedEnd).getTime();
    const left=Math.max(0,(start-now)/windowMs*100);
    const right=Math.min(100,(end-now)/windowMs*100);
    if(right<=0||left>=100)return '';
    const width=Math.max(right-left,0.6);
    const cls=b.kind==='設備停止'?'sc-board-block-stop':(b.state==='着手'?'sc-board-block-active':'sc-board-block-planned');
    const title=`${esc(b.kind)} ${esc(b.lotNo||b.title||'')} ${fmtDateTime(b.plannedStart)}〜${fmtDateTime(b.plannedEnd)}`;
    return `<span class="sc-board-block ${cls}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" title="${title}"></span>`;
   }).join('');
   return `<div class="sc-board-row" data-equipment="${esc(row.equipment)}" tabindex="0">
    <span class="sc-board-name">${esc(row.equipment)}</span>
    <span class="sc-board-swatch ${lv}">${esc(swatchText)}</span>
    <span class="sc-board-track">${blocks}</span>
    <span class="sc-board-flags">${activeChip}${overdueChip}</span>
    <span class="sc-board-chevron">›</span>
   </div>`;
  }).join('');
  board.innerHTML=`
   <div class="sc-board-toolbar">
    <div class="sc-board-sort">
     <button type="button" class="sc-board-sort-btn${scState.overviewSort==='order'?' active':''}" data-sort="order">表示順</button>
     <button type="button" class="sc-board-sort-btn${scState.overviewSort==='busy'?' active':''}" data-sort="busy">混雑順</button>
    </div>
   </div>
   ${axis}
   <div class="sc-board-rows">${rows}</div>`;
  board.querySelectorAll('.sc-board-sort-btn').forEach(btn=>{
   btn.onclick=()=>{scState.overviewSort=btn.dataset.sort;renderOverviewBoard()};
  });
  board.querySelectorAll('.sc-board-row').forEach(row=>{
   /* **触れた時点で、その設備の予定を取り始める**(§9.182)。押すまでの
      200〜500msがそのまま準備に使える。取ったものはキャッシュへ入れるだけで
      画面は触らない(見ている俯瞰ボードが勝手に変わらない)。 */
   row.addEventListener('mouseenter',()=>warmPlan(row.dataset.equipment),{once:true});
   const go=()=>{scState.equipment=row.dataset.equipment;$('#scEquipmentSelect').value=scState.equipment;switchToSingle()};
   row.onclick=go;
   row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}};
  });
 }

 /* ---------- 予定一覧の取得・描画 ---------- */
/* ---------- 作業可否フラグ(§9.51) ----------
    予定に並んでいても、そのロットがまだこの設備まで流れて来ていないことが
    ある(前工程が終わっていない)。現場の判断基準そのままに、仕掛データの
    **「残仕掛設備ｺｰｽ」がこの設備名で始まっているか**を作業可否とする。

    判定材料の持ち方(§9.67で全面的に見直し)。

    以前は「スナップショットは古くなるから使わない。毎回、現在の仕掛データを
    引いて判定する」という作りだった。これは正しくないうえに遅い:
      - 仕掛一覧から投入したロットは、**投入したその行に残仕掛設備ｺｰｽが
        載っている**。それを使えば往復ゼロで即座に判定できるのに、わざわざ
        仕掛を500件ずつ何ページも辿り直していた(実測10往復・3秒超)。
      - 1件追加するたびに索引を作り直していたため、既に判定済みの行まで
        巻き込んで「?」へ戻り、しばらくしてまた変わる、というちらつきが出た。

    **工程は前へしか進まない**という性質を使うと整理できる:
      - 投入時点で「可」(残仕掛設備ｺｰｽがこの設備で始まる)だったロットは、
        その後この設備から出ていくことはあっても、「まだ来ていない」状態へ
        戻ることはない。**可はそのまま信用してよい**。
      - 逆に「不可」「?」は、工程が進んで到着した可能性があるので取り直す。

    そこで:
      1. 予定投入時に残仕掛設備ｺｰｽをdetailへ保存する(buildScheduleDetailが
         既にaliasキーで保存している)。フラグはまずこれで即座に作る。
      2. 取り直しの対象は**可になっていない行だけ**。全件を引き直さない。
      3. 取り直した値は索引(scWorkable.map)へ**併合**する(作り直さない)。
         作り直すと、前回判定できていた行が一時的に「?」へ戻る。
      4. 対象が少なければロット単位の絞り込み問い合わせだけで済ませる
         (ページ送りより往復が少ないため)。 */
 const WORKABLE_TTL_MS=180000;   // 3分(仕掛一覧のキャッシュ§9.46と同じ考え方)
 let scWorkable={at:0,map:null};
 /* 判定材料の「取り直しが要る」印を付けるだけで、**分かっている値は捨てない**
    (§9.67)。以前はmapごと捨てていたため、予定を1件足すたびに全行が「?」へ
    戻り、仕掛を辿り終えるまで戻らなかった(ちらつきの実体)。
    取り直しの対象はどのみち「可になっていない行」だけなので、既に判定済みの
    値を残しておいても古い判定が居座ることはない。 */
 function invalidateWorkable(){scWorkable={...scWorkable,at:0}}
 /* 仕掛一覧から「ロット番号 -> 残仕掛設備ｺｰｽ」を作る。要る列は
    `columns=`で名指しする(§9.94。実データは200列を超える)。 */
 /* 判定材料の集め方(§9.57)。
    以前は仕掛を`page_size=5000`で1回読んで索引にしていたが、サーバー側は
    `page_size`を**500件で頭打ち**にしている(backend/routes/tables.py)。
    仕掛が500件を超える現場では601件目以降が索引に入らず、そこにある予定は
    全部「?」=作業開始不可になっていた(「仕掛データに作業ロットが
    見つからない」として報告された不具合)。

    直し方は「全件を索引にする」ではなく「**予定に載っているロットだけ**を
    確実に埋める」。必要なロット番号は作業予定から分かっているので、
    仕掛を500件ずつ辿り、必要な分が揃った時点で打ち切る。全件を読み切る
    必要はなく、往復数は「必要なロットが見つかるまで」で済む。
    それでも見つからないものは、最後に個別問い合わせで確定させる
    (仕掛に無いことが確定すれば「?」ではなく「不可」にできる)。 */
 const WORKABLE_PAGE_SIZE=500;    // サーバー側の上限(これ以上を要求しても切り詰められる)
 const WORKABLE_MAX_PAGES=40;     // 20000件ぶん。際限なく辿らないための歯止め
 const WORKABLE_FILL_LIMIT=60;    // 個別に補う上限(往復が増えるため)
 /* この件数までなら、ページ送りせずロット単位の絞り込みだけで済ませる。
    1件追加した直後のような「取り直したいのは1〜数件」の場面で、仕掛を
    何ページも辿り直さないための分岐(往復数を必要な分だけに保つ)。 */
 const WORKABLE_DIRECT_MAX=8;
 function entryLotKey(e){return normalizeLotKey(e.lotNo||contentValueOf(e.detail,'lotNo'))}
 /* 予定投入時に保存した残仕掛設備ｺｰｽ(§9.67)。仕掛一覧から投入した行には
    必ず入っている(buildScheduleDetailがalias名・生カラム名の両方で保存)。 */
 function storedCourseOf(e){
  const v=contentValueOf(e&&e.detail,'residualCourse');
  return v===undefined||v===null?'':String(v);
 }
 /* 取り直しが要るロット番号 = 予定の作業行のうち、今「可」になっていないもの。
    可は工程が戻らない限り覆らないので取り直さない(§9.67)。 */
 /* 予定に載っている作業ロットの全体(明示的な再計算で使う)。 */
 function allPlannedWorkLots(){
  const out=new Set();
  (scState.entries||[]).forEach(e=>{
   if(e.kind!=='作業')return;
   const lot=entryLotKey(e);if(lot)out.add(lot);
  });
  return out;
 }
 function lotsNeedingLookup(){
  const out=new Set();
  (scState.entries||[]).forEach(e=>{
   if(e.kind!=='作業')return;
   const lot=entryLotKey(e);
   if(!lot)return;
   if(workableOf(e).state!=='ok')out.add(lot);
  });
  return out;
 }
 /* opts.ignoreTtl   : 鮮度に関わらず取り直す
    opts.revalidateAll: 「可」も含めて全予定を検証し直す。
       利用者が明示的に「再計算」を押したときだけ立てる。工程は前へしか
       進まないので普段は可を再確認しないが、**利用者が最新を求めた操作**
       では情報源そのものを取り直すのが筋(§9.67)。 */
 /* 作業対象の一覧(仕掛)のキー。データソースマスタで役割が「作業」のものを
    使う。**キーの綴りに依存させない**(§9.87)。作業可否の判定材料を引く先と、
    スケジュール画面の中に出す仕掛一覧(分割表示・ポップアップ)の両方が使う。
    役割が決まっていなければ空文字を返すので、呼び出し側は必ず確認すること。 */
 function workDbKey(){return (window.WL&&WL.dataSource&&WL.dataSource.workKey())||''}
 async function loadWorkableIndex(opts){
  const o=(opts===true?{ignoreTtl:true}:(opts||{}));
  const force=!!o.ignoreTtl;
  if(!force&&scWorkable.map&&Date.now()-scWorkable.at<WORKABLE_TTL_MS)return scWorkable.map;
  if(o.revalidateAll){
   // 全件検証: 覚えている値を捨ててから、予定の全作業ロットを対象にする
   scWorkable={...scWorkable,map:new Map()};
  }
  // 索引は**作り直さず併合する**。作り直すと、前回判定できていた行が
  // 一時的に「?」へ戻り、しばらくしてまた変わる、というちらつきになる。
  const map=scWorkable.map instanceof Map?scWorkable.map:new Map();
  let cols=scWorkable.cols||null,table=scWorkable.table||null;
  let pages=0,scanned=0,total=scWorkable.total||0;
  const needed=o.revalidateAll?allPlannedWorkLots():lotsNeedingLookup();
  // 全部「可」で確定しているなら、取り直す理由が無い(往復ゼロ)。
  if(!needed.size){scWorkable={...scWorkable,at:Date.now(),map,cols,table,pages:0,scanned:0,total};return map}
  // 取り直したいのが数件だけなら、ページ送りせずロット単位で引く。
  if(needed.size<=WORKABLE_DIRECT_MAX&&table&&cols&&cols.lotCol&&cols.resCol){
   scWorkable={...scWorkable,at:Date.now(),map,cols,table};
   await fillMissingLots([...needed]);
   return scWorkable.map;
  }
  try{
   // 役割が「作業」のデータソースが無ければ判定材料が引けない。勝手に
   // 「可」にはせず「?」のまま返す(確認できないものを作業させないため)。
   if(!workDbKey()){
    console.warn('作業可否: 役割が「作業」のデータソースが登録されていません');
    scWorkable={at:Date.now(),map,table,cols,pages,scanned,total};
    return map;
   }
   const t=await api('/api/tables?db='+encodeURIComponent(workDbKey()));
   table=(t.tables||[])[0];
   if(table){
    for(let page=1;page<=WORKABLE_MAX_PAGES;page++){
     const q=new URLSearchParams({db:workDbKey(),table,page,page_size:WORKABLE_PAGE_SIZE,
       search:''});
     const d=await api('/api/table?'+q);
     pages=page;total=Number(d.count||0);
     if(!cols){
      cols={lotCol:(aliases.lotNo||[]).find(n=>(d.columns||[]).includes(n)),
            resCol:(aliases.residualCourse||[]).find(n=>(d.columns||[]).includes(n))};
     }
     const rows=d.rows||[];scanned+=rows.length;
     if(!cols.lotCol||!cols.resCol)break;    // 列が無ければ辿っても意味が無い
     rows.forEach(r=>{
      const lot=normalizeLotKey(r[cols.lotCol]);
      if(!lot)return;
      const course=String(r[cols.resCol]??'');
      map.set(lot,course);
      if(needed.has(lot))rememberCourseOnEntries(lot,course);
      needed.delete(lot);
     });
     // 必要な分が揃った / 最後のページまで来た なら打ち切る
     if(!needed.size||rows.length<WORKABLE_PAGE_SIZE||scanned>=total)break;
    }
   }
  }catch(e){
   // 仕掛が読めないときは判定材料が無い。mapを空で持ち、UIは「不明」を出す
   // (この場合に既定で「可」にすると、確認できないものを作業させてしまう)。
   console.warn('作業可否の判定に使う仕掛一覧を取得できません',e);
  }
  scWorkable={at:Date.now(),map,table,cols,pages,scanned,total};
  if(needed.size)await fillMissingLots([...needed]);
  return scWorkable.map;
 }
 /* 索引で分かった値を、その予定行のdetailへも書き戻す(§9.67)。
    同じセッション内で描き直すたびに索引を引き直さずに済み、
    次にこの設備を開いたときも保存済みの値から即座に判定できる。
    共有DBへは書かない(1件ごとに取得→適用→反映のサイクルが要るため)。 */
 function rememberCourseOnEntries(lot,course){
  (scState.entries||[]).forEach(e=>{
   if(e.kind!=='作業'||entryLotKey(e)!==lot)return;
   if(!e.detail||typeof e.detail!=='object')e.detail={};
   e.detail.residualCourse=course;
  });
 }
 /* 辿っても見つからなかったロットを個別に引いて確定させる。
    全件を引き直すのではなく、判定が要る行だけに絞る。 */
 async function fillMissingLots(missing){
  const {map,table,cols}=scWorkable;
  if(!table||!cols||!cols.lotCol||!cols.resCol||!missing.length)return;
  const targets=missing.slice(0,WORKABLE_FILL_LIMIT);
  let idx=0;
  await Promise.all(Array.from({length:Math.min(3,targets.length)},async()=>{
   while(idx<targets.length){
    const lot=targets[idx++];
    try{
     const q=new URLSearchParams({db:workDbKey(),table,page:1,page_size:1,
      filters:JSON.stringify([{column:cols.lotCol,op:'eq',value:lot}])});
     const d=await api('/api/table?'+q);
     const row=(d.rows||[])[0];
     // 見つからなければ「仕掛に無い」ことが確定するので、空文字で入れて
     // 「?」ではなく「不可」として扱えるようにする。
     const course=row?String(row[cols.resCol]??''):'';
     map.set(lot,course);
     rememberCourseOnEntries(lot,course);
    }catch(e){WL.quiet.note('引けなければ「?」のまま(勝手に可にしない)',e)}
   }
  }));
  if(missing.length>targets.length){
   console.warn(`作業可否: 判定できなかったロットが${missing.length-targets.length}件あります`);
  }
 }
 function normalizeLotKey(v){return String(v??'').trim().toUpperCase()}
 /* 残仕掛設備ｺｰｽがこの設備名で始まっていれば作業可能。
    戻り値: {state:'ok'|'ng'|'unknown', course:'...'} */
 function workableOf(e){
  const eq=String(scState.equipment||'').trim();
  if(e.kind!=='作業')return {state:'na',course:''};
  if(!eq)return {state:'unknown',course:''};
  const lot=entryLotKey(e);
  const map=scWorkable.map;
  // 取り直した値(索引)があればそちらを優先し、無ければ投入時の保存値を使う。
  // 保存値があるおかげで、仕掛一覧から投入した予定は**往復ゼロで即座に**
  // 判定できる(§9.67)。索引しか見ていなかった頃は、ここが必ず「?」で
  // 始まり、仕掛を何ページも辿り終わるまで変わらなかった。
  let course=null;
  if(lot&&map&&map.has(lot))course=String(map.get(lot)||'');
  else{const stored=storedCourseOf(e);if(stored!=='')course=stored}
  if(course===null)return {state:'unknown',course:''};
  const norm=v=>String(v||'').trim().toUpperCase();
  return {state:norm(course).startsWith(norm(eq))?'ok':'ng',course};
 }
 const WORKABLE_LABEL={
  ok:{text:'可',cls:'is-ok',title:'残仕掛設備ｺｰｽがこの設備で始まっています。作業できます。'},
  ng:{text:'不可',cls:'is-ng',title:'このロットはまだこの設備に仕掛かっていません(残仕掛設備ｺｰｽが別の設備です)。'},
  unknown:{text:'?',cls:'is-unknown',title:'仕掛データに該当ロットが見つからないため、作業できるか確認できません。'},
  na:{text:'—',cls:'is-na',title:'作業以外の予定です。'},
 };

/* 開始ボタンは**作る場所が2つある**（§9.302 の追補）——表を描くとき
    （`renderEntryRow`）と、作業可否があとから「可」に変わってボタンを足すとき
    （`applyWorkableFlags`）。可否は仕掛データを読まないと分からず、共有越しでは
    時間がかかるので**待たずに先に予定を描く**作りだから、この2つは必ず両方使われる。
    **だから文字・説明・「押せるか」は1箇所が答える**（§9.163）——片方だけ直すと
    **仕掛データが最初の描画に間に合ったかどうかで見た目が変わる**。実機では
    `開始`と`▶ 開始`が同じ表に並んでいた（押したときの動きは同じなので、
    合図が嘘をついている状態・§3）。しかも`applyWorkableFlags`は
    「ボタンが無ければ作る」だけなので、一度描かれた行は**そのまま固定**され、
    読み直すまで直らない。 */
 const SC_START_BTN={text:'開始',title:'この予定の測定画面を開いて作業を開始します'};
 function canStartEntry(e,workable){
  return !!(scState.canStartWork&&e&&e.kind==='作業'&&e.state==='予定'
            &&!e.__pending&&!e.unplanned
            &&(workable||workableOf(e)).state==='ok');
 }
 /* **HTMLも1箇所**。DOMで組み立てる側（`applyWorkableFlags`）も
    `insertAdjacentHTML`でこれを通す——クラス名を2箇所に書くと、CSSを直したときに
    片方だけ当たらない状態が作れる。 */
 function startBtnHtml(){
  return `<button type="button" class="sc-row-btn sc-row-start" title="${esc(SC_START_BTN.title)}">${esc(SC_START_BTN.text)}</button>`;
 }
/* 可否の反映は**画面を作り直さない**。renderTimeline()を呼ぶと行が総入れ替えに
    なり、ドラッグ中・詳細を開いている最中・スクロール位置がすべて飛ぶ。
    既にある行の可否セルと開始ボタンだけを差し替える。 */
 function applyWorkableFlags(){
  document.querySelectorAll('.sc-row-line').forEach(row=>{
   const e=row.__scEntry;if(!e)return;
   const w=workableOf(e);
   const label=WORKABLE_LABEL[w.state]||WORKABLE_LABEL.unknown;
   const cell=row.querySelector('.sc-row-workable');
   if(cell){
    cell.textContent=label.text;
    cell.className='sc-row-workable '+label.cls;
    cell.title=w.course?`${label.title}\n残仕掛設備ｺｰｽ: ${w.course}`:label.title;
   }
   row.classList.toggle('sc-row-not-workable',w.state==='ng');
   // 可否が変わったら開始ボタンの有無も合わせる(可になったらすぐ着手できる)
   const canStart=canStartEntry(e,w);
   const actions=row.querySelector('.sc-row-actions');
   const existing=row.querySelector('.sc-row-start');
   if(canStart&&!existing&&actions){
    /* **表を描くときと同じHTMLを差し込む**（先頭＝`renderEntryRow`と同じ位置）。
       ここで自前に組み立てると、文字も並びも2通りになる。 */
    actions.insertAdjacentHTML('afterbegin',startBtnHtml());
    const btn=actions.querySelector('.sc-row-start');
    if(btn)btn.onclick=ev=>{ev.stopPropagation();startWorkFromEntry(e)};
   }else if(!canStart&&existing){
    existing.remove();
   }
  });
 }
 /* 可でない行は、工程が進めば可へ変わる。利用者に「再読込」を押させずに
    自動で追いつくよう、可でない予定が残っている間だけ裏で取り直す。
    全部可になったら見張る理由が無いので止める(無駄な問い合わせを残さない)。 */
 const WORKABLE_WATCH_MS=120000;   // 2分
 let workableTimer=null;
 function stopWorkableWatch(){if(workableTimer){clearTimeout(workableTimer);workableTimer=null}}
 function scheduleWorkableWatch(){
  stopWorkableWatch();
  const entries=scState.entries||[];
  const pending=entries.some(e=>e.kind==='作業'&&e.state==='予定'&&workableOf(e).state!=='ok');
  if(!pending)return;
  workableTimer=setTimeout(()=>{refreshWorkableInBackground(true,false)},WORKABLE_WATCH_MS);
 }
 async function refreshWorkableInBackground(force,revalidateAll){
  try{
   await loadWorkableIndex({ignoreTtl:!!force,revalidateAll:!!revalidateAll});
   applyWorkableFlags();
   scheduleWorkableWatch();
  }catch(err){console.warn('作業可否の更新に失敗しました',err)}
 }
 /* 仕掛一覧を取り直した直後など、外から可否を更新したいときの入口。 */
 window.refreshScheduleWorkable=refreshWorkableInBackground;
 /* 可否がなぜその値なのかを確認するための状態。全部「?」のときに
    「仕掛が読めていない」のか「該当ロットが無い」のかを切り分ける。 */
 window.scheduleWorkableState=()=>({
  watching:workableTimer!==null,
  indexSize:scWorkable.map?scWorkable.map.size:0,
  fetchedAt:scWorkable.at||null,
  equipment:scState.equipment||'',
  pages:scWorkable.pages||0,        // 仕掛を何ページ辿ったか
  scanned:scWorkable.scanned||0,    // 読んだ行数
  total:scWorkable.total||0,        // 仕掛の総件数
 });

 /* 先読み(§9.182)。**キャッシュへ入れるだけ**で画面は触らない。既に持って
    いれば何もしない。失敗は黙って捨てる(開いたときに普通に取り直す)。 */
 const warmingPlans=new Set();
 function warmPlan(eq){
  eq=String(eq||'').trim();
  if(!eq||scPlanCache.has(eq)||warmingPlans.has(eq))return;
  warmingPlans.add(eq);
  const hours=scState.historyHours,gen=planGen();
  api('/api/schedule/plan?equipment='+encodeURIComponent(eq)+'&history_hours='+encodeURIComponent(hours))
   .then(r=>{
    // 先読みのあいだに予定を変えていたら捨てる(§9.200)
    if(gen!==planGen())return;
    if(r&&r.configured&&!scPlanCache.has(eq))
     scPlanCache.set(eq,{entries:r.entries||[],anchor:r.anchor,warnings:r.warnings||[],
       loadFactor:r.loadFactor,historyHours:hours,fetchedAt:Date.now(),timings:r.timings});
   })
   .catch(WL.quiet('予定を先読みできない（開いたときに取りに行く）'))
   .finally(()=>warmingPlans.delete(eq));
  /* 列の見せ方も一緒に(設備ごとに違う)。描画の直前に必要になるもの。 */
  WL.columnLayout.load('timeline:'+eq).catch(WL.quiet('列の設定を取れない（既定の並びで出す）'));
 }
 async function refreshAll(force){
  /* ---------- 覆いは「予定が出るまで」だけ(§9.182) ----------
     以前は仕掛一覧を組み終わるまで覆いを出しており、**予定はもう描けている
     のに待たされている**ように見えていた(実測で予定まで1.1秒・一覧まで1.6秒。
     しかも一覧の組み立てはメインスレッドを塞ぐので、そのあいだ予定が
     1度も描かれない)。予定を描いて**1度描画させてから**一覧へ移る。
     キャッシュから出せるならWAITING表示ごと省く(一瞬で出るのにスピナーが
     瞬くと、かえって「また読み込んでいる」ように見えるため)。 */
  const cached=scPlanCache.get(scState.equipment);
  const quick=!force&&cached&&cached.historyHours===scState.historyHours;
  if(quick||typeof withWaiting!=='function')await refreshAllInner(()=>{},force);
  else await withWaiting({title:'作業スケジュールを読み込んでいます',
   detail:scState.equipment?('設備: '+scState.equipment):'共有スケジュールDBを参照しています',
   progress:'表示設定と予定を取得しています',step:1},report=>refreshAllInner(report,force));
  /* 仕掛一覧は**覆いを外してから**組む。ここは待つ(呼び出し側が「開き終えた」
     と扱える必要がある)が、予定は既に画面へ出ている。 */
  await showSplitList();
 }
 /* 1度描かせる。**await するだけでは描かれない**——直後に重い処理が続くと
    ブラウザは描画の隙を得られない(仕掛一覧の組み立てがそれ)。 */
 const paintOnce=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 async function refreshAllInner(report,force){
  /* ---------- 独立した取得は同時に始める(§9.182) ----------
     以前は「列表示 → 内容表示 → 列レイアウト → 読み替え → 予定 →
     停止理由 → 仕掛一覧」を**1本ずつ待って**いた。往復の短い手元でも
     設備を選んでから表が出るまで1.1秒かかり、共有越しでは往復の数ぶん
     そのまま伸びる（現場で「読み込みが遅い」と報告された）。
     **順番の約束は守れる**——描画のときにマスタが揃っていればよいので、
     予定の取得はマスタと同時に走らせ、描画の直前で待ち合わせる。
     取得だけ先に始めるのが要点で、`planFetch()`が取得、`planApply()`が
     描画を持つ（1つの関数で両方やると、この待ち合わせが書けない）。 */
  const plan=planFetch(force);
  const jobs=[];
  // 列表示マスタ(§9.18)・内容表示マスタは renderTimeline() が「内容」欄の
  // 組み立てに使うため、**描画より先に**揃える必要がある(後から取得すると
  // 初回描画が未設定のまま出て、直後に列が変わるちらつきが起きる)。
  /* ---------- 「どの項目を出すか」はモードによらず読む（§9.246 ②） ----------
     利用者の報告:
       「編集モードから作業スケジュール表をみると表示列の項目数が明らかに
        少ないです。スケジュールモードに切り替えてからすぐに編集モードに
        切り替えると表示列数がスケジュールモードと同じになります」

     以前はここが`if(scState.fullControl)`（＝scheduleモードだけ）で
     **内容表示マスタを一度も読んでいなかった**ので、編集モードでは
     `scContentPrefs.items`がnullのまま＝`chosenContentKeys()`が既定の
     4項目へ落ちていた。`scContentPrefs`はモジュール変数なので、モードを
     一往復すると値が残り、`chosenContentKeys()`はモードを見ない
     ——**「切り替えると直る」の正体がこれ**（同じ画面が2通りの姿を持って
     いた）。**見えるものはモードで変えない。変えるのは書けるかどうかだけ。**

     **仕掛一覧の表示列（スケジュール列マスタ）はここに混ぜない**——読む側
     （`list-view.js`の`canPlan`）がscheduleモードでしか使わないので、
     編集モードで読んでも1つも効かないうえ、`loadScheduleColumnPrefs()`は
     末尾で`refreshScheduledLotFilter()`＝仕掛一覧の組み直しを呼ぶ
     （§9.224 ①。見えないもののために見えているものを止めない）。 */
  jobs.push(loadScheduleContentPrefs());
  if(scState.fullControl)jobs.push(loadScheduleColumnPrefs());
  /* 内容の列の見せ方(並び・幅・表示名・書式・読み替え)も同じ理由で先に。
     読めなくても既定で出る(fail-open)。 */
  jobs.push(WL.columnLayout.load(timelineTarget()));
  jobs.push(WL.displayRules.load());
  /* 停止理由・分類は**描画に要らない**ので待ち合わせに混ぜるだけ
     (別パネルの中身なので、遅れてもタイムラインは出る)。 */
  if(scState.fullControl)jobs.push(loadStopCategories());
 /* 行の見せ方(§9.198)は**描画に要る**（区分のセルと行の地の色）ので、
    ここで待ち合わせる。読めなくても既定で出る(fail-open)。
    設備停止の一覧も**モードによらず読む**——分類ごとの色を当てるのに
    「この停止はどの分類か」が要る。モードで読み分けると、同じ予定が
    端末によって違う色になる（色が意味を失う）。 */
 jobs.push(loadRowStyles(),loadStopReasons());
  await Promise.all(jobs.map(x=>Promise.resolve(x).catch(WL.quiet('取れない設定がある（取れたものだけで描く）'))));
  await planApply(plan);
  // 作業可否(§9.51)の判定材料は**待たない**。仕掛一覧の取得は共有越しだと
  // 時間がかかることがあり、待つとその間ずっと予定が出ない。先に予定を描き、
  // 可否は取れ次第そのセルだけ差し替える(操作は一切止めない)。
  // 利用者が押した「再計算」(force)では、可も含めて情報源を取り直す。
  // 画面を開いた・設備を切り替えただけのときは可でない行だけを追いかける。
  refreshWorkableInBackground(force,force);
  report({progress:'仕掛一覧を並べて表示しています',step:2});
  /* **ここで一度描かせる**(§9.182)。この直後に仕掛一覧の組み立て(2000行×
     200列)が入り、メインスレッドを数百ms塞ぐ。描かせずに進むと、予定が
     出るのが一覧と同時になり「読み込みが遅い」ことになる。 */
  await paintOnce();
 }
 function applyPlanResult(r,fetchedAt){
  /* 読み直したので、共有の見張りの基準を置き直す(§9.188)。 */
  scSyncSeen=null;renderSyncBanner(false);
  /* 読み込みの内訳(§9.198)。サーバーが測った値をそのまま持つ。 */
  scLastTimings=r.timings?Object.assign({},r.timings):null;
  scState.entries=r.entries||[];scState.anchor=r.anchor;scState.warnings=r.warnings||[];
  scState.anchorRounded=r.anchorRounded||null;
  scState.planFetchedAt=fetchedAt;
  renderWarnings();renderTimeline();updateFreshnessUi(fetchedAt);
  updateHistoryFromUi();updateRefreshHint();
  scheduleWorkableWatch();   // 可でない行が残っていれば裏で追いかける(§9.51)
  /* 結合の値は**描き終えてから・手が空いてから**当てる(§9.94と同じ作法)。
     予定が出るまでの時間に相手のDBの往復を挟まない。 */
  (window.requestIdleCallback||(f=>setTimeout(f,300)))(()=>{scJoinRefresh()});
 }
 /* ---------- 予定は「取得」と「描画」を分ける(§9.182) ----------
    取得だけ先に始めておいて、表示設定が揃ったところで描く。1つの関数で
    両方やると、他の取得と同時に走らせる書き方ができない。 */
 function planFetch(force){
  const eq=scState.equipment;
  if(!eq)return null;
  const cached=scPlanCache.get(eq);
  // 表示範囲が変わったときは取り直す(サーバー側の合成範囲も変わるため)
  if(!force&&cached&&cached.historyHours===scState.historyHours)
   return {eq,cached};
  /* **既に行が出ているときは「読み込んでいます」で消さない**(§9.182)。
     消してから入れ直すと、開き直すたびに表が空白へ落ちる(前の内容を
     見ながら待てるほうが速く感じる)。 */
  const timeline=$('#scTimeline');
  if(timeline&&!timeline.querySelector('.sc-row-line'))
   timeline.innerHTML='<div class="sc-empty-note">読み込んでいます…</div>';
  return {eq,gen:planGen(),
          promise:api('/api/schedule/plan?equipment='+encodeURIComponent(eq)
    +'&history_hours='+encodeURIComponent(scState.historyHours))};
 }
 async function planApply(req){
  if(!req)return;
  const timeline=$('#scTimeline');
  if(req.cached){applyPlanResult(req.cached,req.cached.fetchedAt);return}
  try{
   const r=await req.promise;
   // 応答が届く前に設備が変わっていたら捨てる(古い予定を新しい設備へ描かない)
   if(scState.equipment!==req.eq)return;
   /* 取りに行ったあとに予定を変えていたら捨てる(§9.200)。ここで入れると、
      変更前の内容がキャッシュに残り、画面を切り替えて戻ったときに
      **並べ替えが無かったことになる**（実機で報告）。書込のあとには
      必ず取り直し(force)が走るので、捨てても取りこぼさない。 */
   if(req.gen!==undefined&&req.gen!==planGen())return;
   if(!r.configured){
    if(timeline)timeline.innerHTML='<div class="sc-empty-note">スケジュール機能が設定されていません(config/local.jsonのschedule_share_path未設定)。</div>';
    return;
   }
   const fetchedAt=Date.now();
   scPlanCache.set(req.eq,{entries:r.entries||[],anchor:r.anchor,warnings:r.warnings||[],
    loadFactor:r.loadFactor,historyHours:scState.historyHours,fetchedAt,timings:r.timings,
    anchorRounded:r.anchorRounded});
   applyPlanResult(r,fetchedAt);
  }catch(e){
   if(scState.equipment!==req.eq)return;
   if(timeline)timeline.innerHTML=`<div class="sc-empty-note">予定を取得できませんでした: ${esc(e.message)}</div>`;
  }
 }
 async function loadPlan(force){
  await planApply(planFetch(force));
 }

 function renderWarnings(){
  const box=$('#scWarnings');
  if(!scState.warnings.length){box.hidden=true;box.innerHTML='';return}
  box.hidden=false;
  box.innerHTML=scState.warnings.map(w=>`<div class="sc-warning"><b>注意</b> ${esc(w)}</div>`).join('');
 }

 function renderTimelineMessage(msg){
  $('#scTimeline').innerHTML=`<div class="sc-empty-note">${esc(msg)}</div>`;
 }

 /* ---------- 見積の内訳(§6.8・§9.3、換算係数モデルの根拠を開示) ---------- */
 function estimateSourceLabel(src){
  return {model:'モデル',override:'手動上書き','stop-reason-master':'設備停止マスタ',remaining:'残り時間',
          'equipment-standard':'設備の標準時間',default:'暫定既定値'}[src]||src||'';
 }
 /* 見積が**実績から出たものではない**ときの説明(§9.114)。数字だけを出すと
    「実績に基づく予測」と読まれてしまうので、何を根拠にしたのかを添える。
    設備の標準時間と暫定既定値は**打つ手が違う**(前者は登録済みの値なので
    直せば効く／後者は設備マスタが未設定)ため、言い分ける。 */
 function estimateNoteOf(src){
  if(src==='equipment-standard')
   return '設備マスタの「1ロットあたり標準時間」です。実績がまだ無いための暫定値で、'
        +'実績がたまると自動で実績由来の見積へ切り替わります。';
  if(src==='default')
   return '実績が無く、設備マスタに標準時間も登録されていないための暫定既定値です。'
        +'マスタ管理 > 設備 で「1ロットあたり標準時間」を登録すると、そちらが使われます。';
  return '';
 }
 function factorSourceLabel(src){
  return {auto:'自動',override:'上書き',unknown:'未知'}[src]||src||'';
 }
 function estimateBreakdownHtml(e){
  const est=e.estimate;
  /* 因子が無い＝実績から出していない見積(§9.114)。**それでも内訳は出す**
     ——「何分か」だけ出して根拠を出さないと、実績に基づく予測と区別が
     付かない。出どころと、どうすれば良くなるかを1行で書く。 */
  if(est&&(!est.factors||!est.factors.length)){
   const note=estimateNoteOf(est.source);
   if(!note)return '';
   return `<div class="sc-detail-block"><div class="sc-detail-heading">見積の根拠</div>`
    +`<div class="sc-estimate-row sc-estimate-base">${esc(WL.duration.text(est.minutes))}`
    +`（${esc(estimateSourceLabel(est.source))}）</div>`
    +`<div class="sc-estimate-row sc-estimate-note">${esc(note)}</div></div>`;
  }
  if(!est||!est.factors||!est.factors.length)return '';
  const baseLine=est.base?`<div class="sc-estimate-row sc-estimate-base">基準時間 T0=${WL.duration.text(est.base.T0)}(実績${est.base.n}件)</div>`:'';
  const rangeLine=(est.low!=null&&est.high!=null)?`<div class="sc-estimate-row sc-estimate-range">予測区間 ${WL.duration.text(est.low)} 〜 ${WL.duration.text(est.high)}</div>`:'';
  const rows=est.factors.map(f=>
   `<div class="sc-estimate-factor sc-ef-source-${esc(f.source)}"><span class="sc-ef-key">${esc(f.key)}</span><span class="sc-ef-level">${esc(f.level)}</span>`+
   `<span class="sc-ef-value">×${f.value}</span><span class="sc-ef-n">n=${f.n}</span><span class="sc-ef-source">${factorSourceLabel(f.source)}</span></div>`
  ).join('');
  return `<div class="sc-detail-block"><div class="sc-detail-heading">見積の内訳</div>${baseLine}${rangeLine}${rows}</div>`;
 }

 /* ---------- 固定開始日時(§5.1・§7.3、フェーズ6) ---------- */
 /* ---------- 誰が・どの端末で(§9.180) ----------
    利用者の指示は「どのPC、どのIDから編集をされたデータなのか」。列としても
    出せる（既定は非表示）が、**詳細には必ず出す**——普段は場所を取らせず、
    追いたいときは1クリックで辿れる形にする。
    **登録と更新を並べて書く**。入れた人と最後に動かした人は違うことがあり、
    片方だけだと「誰の予定か」を読み違える。
    古い予定は端末名を持たない（列を後から足した）ので、そのことも書く。 */
 function auditHtml(e){
  const dash=v=>{const t=String(v==null?'':v).trim();return t||'-'};
  const when=v=>{const t=String(v||'').trim();return t?fmtDateTime(t):'-'};
  const row=(label,id,pc,at)=>`<div class="sc-audit-row"><span class="sc-audit-label">${label}</span>`
   +`<b>${esc(dash(id))}</b><span class="sc-audit-at">@ ${esc(dash(pc))}</span>`
   +`<span class="sc-audit-when">${esc(when(at))}</span></div>`;
  const noPc=!String(e.createdPc||'').trim()&&!String(e.updatedPc||'').trim();
  return `<div class="sc-detail-block"><div class="sc-detail-heading">誰が・どの端末で</div>`
   +row('予定へ入れた',e.createdBy,e.createdPc,e.createdAt)
   +row('最後に動かした',e.updatedBy,e.updatedPc,e.updatedAt)
   +(noPc?'<div class="sc-audit-note">端末名は記録されていません（この予定を入れたときのアプリは端末名を残していませんでした）。</div>':'')
   +`</div>`;
 }
 function fixedStartHtml(e){
  if(e.__pending)return ''; // サーバー未反映(§9.11の楽観的追加)の間はまだ予定IDが無く更新できない
  /* 空の日付・直の枠(§9.238 ②)は**固定開始日時を使わない**。あちらは
     「この予定自身をその時刻へ釘で留める」意味で、枠の「ここから先は
     この日・この直から」とは別物なので、置いても効かない欄になる（§4）。
     枠の行き先は`frameDetailHtml()`が出す。 */
  if(e.kind==='枠')return '';
  if(scState.fullControl&&e.state==='予定'){
   return `<div class="sc-detail-block"><div class="sc-detail-heading">固定開始日時</div>
    <div class="sc-fixed-start">
     <input type="datetime-local" class="sc-fixed-start-input" data-id="${e.id}" value="${fmtLocalInput(e.fixedStart)}">
     ${e.fixedStart?`<button type="button" class="sc-fixed-start-clear" data-id="${e.id}" title="固定開始日時を解除">解除</button>`:''}
    </div></div>`;
  }
  if(e.fixedStart)return `<div class="sc-detail-block"><div class="sc-detail-heading">固定開始日時</div><div class="sc-fixed-start-readonly">${fmtDateTime(e.fixedStart)}</div></div>`;
  return '';
 }
 function updateFixedStart(id,localValue){
  /* **読み取り専用のときは書かない**（§9.211 ②）。CSSで押せなくしていた
     だけだったので、詳細パネルの日時欄からは素通りしていた。 */
  if(sessionBlocked()){showToast&&showToast('変更できません',sessionHolderMessage(),4000);return}
  // §9.22: 他の書込と同様、書込キュー経由の一方通行にする(直接await→
  // loadPlan()だと、この操作だけ編集中に表示が一瞬消える対象として残って
  // しまうため)。楽観的にローカルへ反映し、失敗した時だけ元へ戻す。
  const iso=localValue?new Date(localValue).toISOString():null;
  const entry=scState.entries.find(e=>e.id===id);
  if(!entry)return;
  const previous=entry.fixedStart;
  entry.fixedStart=iso;renderTimeline();
  queuePlanOp({op:'update',id,fixedStart:iso,
   onFailure:()=>{entry.fixedStart=previous;if(scState.equipment)renderTimeline()}});
 }

 /* 枠の内訳(§9.238 ②)。**行の題名は1行に収める**ので、細かいことは
    ここで言う——どこから始めようとしているのか、いま何分空けているのか、
    もう埋まったのか。**同じ数字を2箇所に出さない**(§8)ため、題名は
    「空き ◯時間」だけ、内訳はここだけ。 */
 function frameDetailHtml(e){
  if(e.kind!=='枠')return '';
  const f=e.frame||{};
  const d=String(f.date||(e.detail&&e.detail.frameDate)||'');
  const sh=String(f.shift||(e.detail&&e.detail.frameShift)||'');
  const note=String(f.note||(e.detail&&e.detail.frameNote)||'');
  const rows=[
   ['行き先',d?`${frameDateLabel(d)}${sh?' '+sh:'（その日の頭から）'}`:'（日付が未設定）'],
   /* **展開後の時刻を出す**——`f.target`は稼働カレンダーへ合わせる前の値なので、
      休みの日を指すと繰り上がった実際の開始とずれる（行は繰り上がった時刻で
      並んでいるのに、詳細だけ別の時刻を出すことになる）。合わせる前の値が
      違うときだけ、そのことを添える。 */
   ['実際の開始',e.plannedStart?fmtDateTime(e.plannedStart)
     +((f.target&&String(f.target).slice(0,16)!==String(e.plannedStart).slice(0,16))
       ?`（${fmtDateTime(f.target)}は稼働時間外なので繰り上げました）`:'')
     :'—'],
   ['いまの空き',f.reached?'0分（もう埋まりました）'
     :(Number.isFinite(Number(f.gapMinutes))?WL.duration.text(Number(f.gapMinutes)):'—')],
   note?['メモ',note]:null,
   f.warning?['注意',f.warning]:null,
  ].filter(Boolean);
  return `<div class="sc-detail-block"><div class="sc-detail-heading">日付・直の枠</div>
   <div class="sc-detail-list">${rows.map(([k,v])=>
     `<div class="sc-detail-item"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
   <p class="sc-detail-note">この枠は時間を使いません。手前に予定を足していくと空きへ入っていき、
    追い越したら枠は何もしなくなります。</p></div>`;
 }

 /* ---------- 日時ロック(§9.38) ----------
    日付を決めて置きたいロットは「鍵をかけて」その日時へ釘付けにする。
    ロックの実体は既存の固定開始日時(fixedStart)そのもので、新しい列も
    保存先も増やしていない。ロックしていない行は従来どおり、現在時刻を
    起点に前から順に詰めて並ぶため、時間が経つほど自動的に後ろへずれる。 */
 function toggleEntryLock(e){
  if(e.fixedStart){updateFixedStart(e.id,'');return}
  // 今この行が置かれている予定日時でそのまま固定する。使う側の頭の中では
  // 「今この位置でいい、これ以上ずらしたくない」なので、日時入力を出して
  // 打ち直させない(細かく変えたい場合は詳細パネルの日時欄で調整できる)。
  const base=e.plannedStart||e.fixedStart;
  if(!base){alert('この予定はまだ予定日時が決まっていないため固定できません。');return}
  updateFixedStart(e.id,fmtLocalInput(base));
 }

 /* ---------- 高密度リスト表示(§9.3改訂) ----------
    「リスト形式並みの高密度、1ロット1行、20行程度見えるように」という
    要望に合わせ、従来の縦長カード(.sc-card)から表形式の1行(.sc-row-line)へ
    作り直した。列の意味はヘッダー行(ROW_HEAD_HTML)で1回だけ説明し、
    各行では値だけを詰めて出す。固定開始・見積の内訳は情報量が多く常時
    出すと行が伸びるため、1つの「▾ 詳細」トグルへ統合して折りたたむ
    (既定は閉、開くとその行の下に内訳ブロックが伸びる)。 */
 function fmtHM(iso){
  if(!iso)return '';
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
  const pad=n=>String(n).padStart(2,'0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
 }
 // 年月日カラム(§9.20新設)。時刻とは別枠で常時表示する(以前は時刻セルの
 // title(ツールチップ)にしか出ておらず、一覧性が悪いという指摘のため)。
 const WEEKDAY_JA=['日','月','火','水','木','金','土'];
 function fmtDateShort(iso){
  if(!iso)return '';
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
  const pad=n=>String(n).padStart(2,'0');
  return `${pad(d.getMonth()+1)}/${pad(d.getDate())}`;
 }
 function fmtDateTitle(iso){
  if(!iso)return '';
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())}(${WEEKDAY_JA[d.getDay()]})`;
 }
 /* 現場歴の日付(§9.195)。サーバーが `workDate`(YYYY-MM-DD)で答える。
    日を跨ぐ勤務の「跨いだ後」は勤務形態マスタの日付補正だけ日付をずらして
    あるので、3直のような勤務でも1回ぶんが同じ日付にまとまる。
    **文字列のまま組み立てること**——`new Date('2026-08-18')`はUTCの0時として
    読まれるため、地方時へ直すと日付が1日ずれる端末がある。 */
 function workDateParts(ymd){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd||''));
  return m?{y:+m[1],m:+m[2],d:+m[3]}:null;
 }
 function fmtWorkDateShort(ymd){
  const p=workDateParts(ymd);if(!p)return '';
  const pad=n=>String(n).padStart(2,'0');
  return `${pad(p.m)}/${pad(p.d)}`;
 }
 function fmtWorkDateTitle(ymd){
  const p=workDateParts(ymd);if(!p)return '';
  const pad=n=>String(n).padStart(2,'0');
  return `${p.y}/${pad(p.m)}/${pad(p.d)}(${WEEKDAY_JA[new Date(p.y,p.m-1,p.d).getDay()]})`;
 }
 function fmtTimeRange(startIso,endIso){
  if(!startIso)return '-';
  const startText=fmtHM(startIso);
  if(!endIso)return startText+'〜';
  const sameDay=new Date(startIso).toDateString()===new Date(endIso).toDateString();
  return `${startText}〜${fmtHM(endIso)}${sameDay?'':'(翌)'}`;
 }
 function stateRowClass(state){
  if(state==='完了')return 'sc-row-done';
  if(state==='着手')return 'sc-row-active';
  if(state==='取消')return 'sc-row-cancel';
  return 'sc-row-planned';
 }
 /* 「内容」欄の組み立て。設備ごとの「スケジュール内容表示マスタ」
    (scContentPrefs、/api/schedule-content-master)で選んだ項目を、選んだ順に
    並べて1行の要約にする。値はe.detail(buildScheduleDetailが生カラム名でも
    alias名でも引けるようスナップショット済み)から取る。
    未設定の設備は、ロット番号・用途名・製造材質・調質の既定組み立てへ
    フォールバックする(どの設備・どの仕掛データ構成でも成立する既定値)。
    以前は仕掛一覧の表示列マスタを流用していたため、一覧に出したい列数
    (10列など)がそのまま内容欄の要素数になってしまい実用にならなかった。 */
 /* ---------- 内容を項目ごとの独立した列へ(§9.88 段6) ----------
    以前は選んだ項目を「 / 」で繋いだ1つの文字列だった。1セルに複数の値が
    入ると、桁が揃わず目で追えないうえ、項目ごとの幅も書式も指定できない。
    **1セル1値**にすると、一覧とまったく同じ仕組み(列レイアウトマスタ)が
    そのまま効く——タイムライン専用の設定画面を作らずに済む。
    対象は`timeline:<設備名>`。どの項目を出すかは従来どおり
    スケジュール内容表示マスタが決める(責務を混ぜない)。 */
 const TIMELINE_DEFAULT_KEYS=['lotNo','purposeName','mfgMaterial','mfgTemper'];
 function timelineTarget(){return scState.equipment?`timeline:${scState.equipment}`:''}
 /* この設備で内容欄に出す項目(スケジュール内容表示マスタ)。**並び・表示は
    ここでは決めない**——決めるのは列レイアウトマスタで、下の
    timelineColumnKeys()が固定列と一緒に1本の並びとして解く。 */
 function chosenContentKeys(){
  const items=(scContentPrefs.equipment===scState.equipment)?scContentPrefs.items:null;
  return (items&&items.length)?items.slice():TIMELINE_DEFAULT_KEYS.slice();
 }

 /* ---------- タイムラインの列も一覧とまったく同じ仕組みに乗せる(§9.176) ----------
    以前は内容欄(項目ごとの列)だけが列レイアウトマスタに乗っており、
    **区分・作業・日付・時刻・勤務・残り・見積・実績・備考・操作の10列は
    CSSに直書きの固定列**だった。そのため
      ・掴んでも動かない列がある（どれが動くのか画面から分からない）
      ・右クリックのメニューがそもそも無い
      ・「表示列」から消せない列がある
    という状態で、「同じ仕組みを流用した」と言いながら**流用できていたのは
    一部だけ**だった。ここで**全列を1本の並び**にする。

    キーは`__cat__`のような二重アンダースコアで、内容欄の項目(`lotNo`等)と
    ぶつからない。**取っ手(1列目)だけは並びに入れない**——掴む場所と
    まとめて選ぶチェックの置き場で、値の列ではない(一覧の行番号と同じ扱い)。
    並べ替えの手立てを画面から消さないためでもある。 */
 const SC_COL_DEFS=[
  {key:'__cat__',label:'区分',w:74,note:'完了／作業中／予定／取消／設備停止'},
  {key:'__workable__',label:'作業',w:44,note:'この設備で今すぐ着手できるか（残仕掛設備ｺｰｽ）'},
  /* 日付は**2つある**(§9.197、利用者の指示)。
       日付(現場歴) … 勤務の日付補正を当てた現場の1日。日を跨ぐ勤務(3直の
                      23:00〜翌7:00)が同じ日にまとまる。まとめ・紙の
                      「日ごと」はこちらで数える。
       日付(太陽暦) … 時計どおりの暦の日付。
     **どちらかに寄せない**——現場の帳簿は現場歴で、外へ出す日付は暦なので、
     両方要る場面が実際にある。既定は今までどおり現場歴の1列だけ出し、
     暦は選べば出る（列を1本増やすと全員の画面が狭くなる。§14）。 */
  {key:'__date__',label:'日付(現場歴)',w:50,
   note:'勤務の日付補正を当てた現場の日付。日を跨ぐ勤務は同じ日にまとまる'},
  {key:'__caldate__',label:'日付(太陽暦)',w:50,
   note:'時計どおりの暦の日付（現場歴とずれることがある）',off:true},
  {key:'__time__',label:'時刻',w:112,note:'開始〜終了'},
  {key:'__shift__',label:'勤務',w:58,note:'勤務形態マスタの名称'},
  {key:'__rel__',label:'残り',w:88,note:'開始までの目安時間'},
  {key:'__est__',label:'見積',w:62,note:'見積時間（~付きは実績以外が出どころ）'},
  {key:'__actual__',label:'実績',w:88,note:'経過／実作業時間と予実差'},
  {key:'__flags__',label:'備考',w:112,note:'計画外・固定・遅れなどの印'},
  /* 「誰が・どの端末で予定へ入れたか」(§9.180)。**既定では出さない**
     ——毎回見るものではないので場所を取らせない(§14「面積は頻度×重要度」)。
     行の詳細(▾)には常に出るので、隠していても辿れる。 */
  {key:'__by__',label:'登録者',w:96,note:'この予定を入れた利用者ID',off:true},
  {key:'__pc__',label:'登録端末',w:112,note:'この予定を入れた端末(PC)名',off:true},
  {key:'__upby__',label:'更新者',w:96,note:'最後に動かした利用者ID',off:true},
  {key:'__uppc__',label:'更新端末',w:112,note:'最後に動かした端末(PC)名',off:true},
  {key:'__actions__',label:'操作',w:148,note:'開始・固定・帳票・削除のボタン'},
 ];
 const SC_COL_MAP=new Map(SC_COL_DEFS.map(d=>[d.key,d]));
 const SC_COL_BEFORE=['__cat__','__workable__','__date__','__caldate__','__time__','__shift__','__rel__'];
 const SC_COL_AFTER=['__est__','__actual__','__flags__','__by__','__pc__','__upby__','__uppc__','__actions__'];
 const scIsFixedCol=k=>SC_COL_MAP.has(k);
 /* **一度も保存していないうちは出さない列**(§9.180)。列レイアウトマスタの
    hiddenは空なので、そのまま使うと足した列がいきなり全員の画面に並ぶ
    ——データ一覧の`recordInitialHidden()`(§9.162)と同じ考え方で、
    「保存済みの並びがあるか」で既定と保存値を分ける。 */
 const SC_COL_OFF_BY_DEFAULT=SC_COL_DEFS.filter(d=>d.off).map(d=>d.key);
 function timelineHiddenSet(){
  const t=timelineTarget();
  const cur=t?WL.columnLayout.get(t):null;
  const hidden=new Set(cur?cur.hidden||[]:[]);
  /* **一度も保存していないうちは既定で畳む**（データ一覧の
     `recordInitialHidden()`と同じ考え方。§9.162）。並びには全列が入るので、
     「並びにこの列が載っているか」では既定かどうかを見分けられない
     ——`timelineOrderedKeys()`が知らない列を必ず後ろへ足すため。
     **並びを初めて保存する瞬間に、この既定を`hidden`へ書き下ろす**
     (`persistTimelineColumns`)——書き下ろさないと、次の描画から
     「選んだ覚えの無い列」が並ぶ(§9.173で帳票が踏んだ罠と同じ)。 */
  if(!(cur&&(cur.order||[]).length))SC_COL_OFF_BY_DEFAULT.forEach(k=>hidden.add(k));
  return hidden;
 }
 /* 見出しの言葉。**表示名 → 決まった名前 → 項目の日本語名 → キー**の順。
    生のキー(mfgTemper)をそのまま出さない。 */
 function scColLabel(k){
  const t=timelineTarget();
  const named=t?WL.columnLayout.label(t,k):k;
  if(named&&named!==k)return named;
  const d=SC_COL_MAP.get(k);
  return d?d.label:contentItemLabel(k);
 }
 /* 選べる列すべて（隠しているものも含む）。設定パネル・右クリックメニューが
    使う。既定は「予定そのもの → 内容 → 実績・操作」の作業順(§14)。 */
 function timelineAllColumnKeys(){
  const base=[...SC_COL_BEFORE,...chosenContentKeys(),...SC_COL_AFTER];
  const seen=new Set(base);
  /* 計算式で作った列も**同じ並びの一部**（§9.207）。末尾へ足す
     ——並びを保存すれば好きな位置へ動かせる。 */
  return [...base,...timelineFormulaKeys().filter(k=>!seen.has(k))];
 }
 /* ---------- 計算式で作る列（§9.207、利用者の指示「計算式などを組むために
    空の列(名前は必須)を追加できるようにしたい。データは条件式などを組んで
    引っ張ってくる使い方」） ----------
    **一覧とまったく同じ仕組み**（`WL.formula`＝列レイアウトマスタの`[計算式]`）に
    乗せる。式の書き方もヘルプも1つ（§9.111。`eval`は使わない）。
    材料は**画面に出ている列と同じ**なので、`[ロット番号]`のように**見出しの
    言葉で書ける**——`__date__`のような内側のキーを覚えさせない。
    **表示だけの列**で、並べ替え・絞り込みの対象にはしない。 */
 /* **式が空の列も数える**（一覧の`listColumnKeys()`と同じ作法）。作った
    直後は式が空なので、ここで落とすと**足した列がその場で消える**。
    **式が空でも読み替えを付けていれば列は残る**（§9.234 ⑥）——「他の列だけを
    見るルール」で中身を作る列がそれ。式も読み替えも空なら保存で消える。 */
 function timelineFormulaKeys(){
  const t=timelineTarget();if(!t)return [];
  return Object.keys(WL.columnLayout.get(t).formulas||{});
 }
 const timelineIsFormulaKey=k=>timelineFormulaKeys().includes(k);
 /* 式を**列ごとに1回だけ解く**（行ごとに解き直すと行数×列数ぶん効く）。
    行を描くのは`renderEntryRow`＝別の関数なので、**式が変わったときだけ
    解き直す控え**として持つ（引数で配って回すと、渡し忘れた経路だけが
    黙って空になる）。壊れた式はその列を落とさず空にする——直せる場所へ
    辿れるように残す。 */
 let scFormulaMemo={sig:'',fns:new Map()};
 function timelineFormulaFns(){
  const t=timelineTarget();
  const f=t?(WL.columnLayout.get(t).formulas||{}):{};
  const sig=t+'|'+JSON.stringify(f);
  if(scFormulaMemo.sig===sig)return scFormulaMemo.fns;
  const out=new Map();
  Object.keys(f).forEach(k=>{
   if(!String(f[k]||'').trim())return;
   try{out.set(k,WL.formula.compile(f[k]))}
   catch(e){out.set(k,{run:()=>'',columns:[]})}
  });
  scFormulaMemo={sig,fns:out};
  return out;
 }
 /* 式の中の`[名前]`を解く。**見出しの言葉→表示名→キー**の順に当てる
    （画面に出ている言葉で書けることが値打ち）。 */
 function timelineKeyByName(name){
  const want=String(name||'').trim();
  if(!want)return '';
  const all=timelineAllColumnKeys();
  if(all.includes(want))return want;
  return all.find(k=>scColLabel(k)===want)||'';
 }
 /* 式に渡す1行。**要る列だけ**作る（全列だと行数×列数の取り出しになる）。 */
 function timelineFormulaRow(e,cols){
  const row={};
  (cols||[]).forEach(name=>{
   const k=timelineKeyByName(name);
   if(!k)return;
   row[name]=scIsFixedCol(k)?scFixedCellText(e,k):entryValueOf(e,k);
  });
  return row;
 }
 function timelineFormulaText(e,fn){
  const v=fn?fn.run(timelineFormulaRow(e,fn.columns)):null;
  return v===null||v===undefined?'':String(v);
 }
 /* ---------- 読み替えが見る1行（§9.234 ⑥、利用者の報告） ----------
    「スケジュールのルール作成で、**他の列のみで構成されたルールを適用した
     場合、表示が何も出ません**」

    読み替え（表示ルール）の条件は`self`（この列）と`column`（他の列）の
    2種類を取れるが、スケジュール表が渡していた行は`entryRow(e)`＝仕掛の
    スナップショット（`detail`）＋クエリ結合（`joined`）だけで、**画面に
    出ている列（区分・日付・時刻・見積・他の計算列・内容項目の見出しの
    言葉）が1つも入っていなかった**。ルール編集画面が候補に出す名前も
    仕掛一覧の生カラム名なので、そこから選んだ「他の列」は**構造的に
    当たらない**——だから「他の列のみ」で中身を作ろうとすると空になる。

    **土台の`entryRow(e)`は必ず残す**（保存済みのルールは仕掛のキーで
    書かれている。上書きすると今まで当たっていたルールが黙って別の値を
    見る）。その上に、**いま効いているルールが実際に参照している列だけ**を
    足す——行ごとに全列ぶん作ると、200行の設備で目に見えて遅くなる
    （§9.224で踏んだ罠）。
    キーは**キーそのものと見出しの言葉の両方**（利用者は画面に出ている
    言葉で書く。式（§9.207の`timelineKeyByName`）と同じ約束）。 */
 let scRuleColMemo={sig:'',cols:[]};
 function timelineRuleColumns(){
  const t=timelineTarget();
  const keys=timelineColumnKeys();
  const rules={};
  keys.forEach(k=>{const n=t?WL.columnLayout.rule(t,k):'';if(n)rules[k]=n});
  const rev=(WL.displayRules&&WL.displayRules.rev)?WL.displayRules.rev():0;
  const sig=t+'|'+JSON.stringify(rules)+'|'+rev;
  if(scRuleColMemo.sig===sig)return scRuleColMemo.cols;
  const want=new Set();
  Object.values(rules).forEach(name=>{
   let used=[];
   try{used=(WL.displayRules&&WL.displayRules.columnsUsed)?WL.displayRules.columnsUsed(name):[]}catch(err){used=[]}
   used.forEach(c=>want.add(String(c)));
  });
  scRuleColMemo={sig,cols:[...want]};
  return scRuleColMemo.cols;
 }
 function timelineRuleRow(e){
  const base=entryRow(e);
  const cols=timelineRuleColumns();
  if(!cols.length)return base;
  const row=Object.assign({},base);
  const fx=timelineFormulaFns();
  cols.forEach(name=>{
   const k=timelineKeyByName(name);
   if(!k)return;
   const v=scIsFixedCol(k)?scFixedCellText(e,k)
     :(fx.has(k)?timelineFormulaText(e,fx.get(k)):entryValueOf(e,k));
   /* **土台のキーは上書きしない**（既存のルールの当たり方を変えない）。 */
   if(!(name in base))row[name]=v;
   if(!(k in base))row[k]=v;
  });
  return row;
 }
 /* 覚えている並びを当てた全列（隠しているものも残す）。保存するのは
    **この並び**——見えている分だけ保存すると、隠した列の位置が失われる。 */
 function timelineOrderedKeys(){
  const all=timelineAllColumnKeys();
  const t=timelineTarget();
  const order=t?(WL.columnLayout.get(t).order||[]):[];
  const known=order.filter(k=>all.includes(k));
  return [...known,...all.filter(k=>!known.includes(k))];
 }
 /* **保存する並びは、いま出せない列を落とさない**（§9.248 ③、利用者の報告
    「一覧表関係の表示列が一部表示されなかったり消えていることがあります」）。

    上の`timelineOrderedKeys()`は**描くため**の並びなので、いま出せる列
    （`timelineAllColumnKeys()`）だけに絞るのが正しい——知らないキーを返すと
    セルの無い空の列ができる。ところが`persistTimelineColumns()`がその
    絞ったほうを**そのまま保存**していたため、`chosenContentKeys()`が
    まだ既定の4項目しか返していない瞬間（スケジュール内容表示マスタが
    届く前）に幅を1回引くだけで、**選んであった内容欄の列が保存済みの並びから
    丸ごと消えていた**。次に出てきたときは「知らない列」として末尾へ回る。
    保存用は**保存済みの並び ∪ いま出せる列**にする（一覧の`fullOrder()`と
    同じ作法・§9.216 ②）。 */
 function timelineOrderForSave(){
  const t=timelineTarget();
  const stored=t?(WL.columnLayout.saved(t).order||[]):[];
  const kept=stored.filter((k,i)=>stored.indexOf(k)===i);
  return [...kept,...timelineAllColumnKeys().filter(k=>!kept.includes(k))];
 }
 /* いま出す列。並びと表示/非表示は列レイアウトマスタが決める。 */
 function timelineColumnKeys(){
  const hide=timelineHiddenSet();
  return timelineOrderedKeys().filter(k=>!hide.has(k));
 }
 /* 出している内容欄の項目だけ（セルの組み立てが使う）。 */
 /* 内容欄の項目だけ。**計算で作る列は含めない**（§9.207）——内容欄は
    スケジュール内容表示マスタが持つ項目で、式で作る列は別の出どころ。 */
 function timelineContentKeys(){
  const calc=new Set(timelineFormulaKeys());
  return timelineColumnKeys().filter(k=>!scIsFixedCol(k)&&!calc.has(k));
 }
 /* 1行ぶんのセル。作業以外(設備停止)は最初の列へ名称を出し、残りは空にする
    ——列の数を行ごとに変えると桁が合わなくなる。 */
 function timelineContentCells(e){
  const keys=timelineContentKeys();
  const t=timelineTarget();
  if(e.kind!=='作業'){
   const title=nonWorkTitleText(e,'（ダブルクリックで書けます）');
   return keys.map((k,i)=>({key:k,text:i===0?title:'',raw:i===0?title:'',color:''}));
  }
  /* 読み替えが見る行は`timelineRuleRow()`の1箇所が作る（§9.234 ⑥）。
     **1行につき1回**——列ごとに作ると行数×列数になる。 */
  const row=timelineRuleRow(e);
  return keys.map(k=>{
   const raw=entryValueOf(e,k);
   const out=WL.cellFormat.cell({raw,format:t?WL.columnLayout.format(t,k):null,
                                 rule:t?WL.columnLayout.rule(t,k):'',
                                 row,column:k});
   return {key:k,text:out.text,raw:String(raw==null?'':raw),color:out.color};
  });
 }
 /* ---------- セル1つの値は1箇所で決める（帳票印刷の刷新、利用者の指示） ----------
    「画面の見た目を活かしたレイアウトにしてほしい。列の情報や並びもそのまま、
     『内容』で表示内容をまとめずに、画面印刷に近い形で、列の成型した内容が
     生きるように」

    固定列（区分・日付・時刻…）は`scFixedCellText()`が既に1箇所（設定パネルの
    見本とも共有・§9.176）。**計算式・内容の項目はここが1箇所**——行の描画
    （`renderEntryRow`のcellHtml）と印刷（`printRowCells`）の両方がここを
    通ることで、同じ列は同じ値を見る（§9.163「判定を画面にも書かない」と
    同じ理由。書き写すと片方だけ直った状態が作れる）。**HTMLは組み立てない**
    ——呼び出し側がそれぞれの見せ方（タグ付きspan／プレーンテキスト）へ包む。 */
 function dynamicCellValue(e,k,ctx){
  if(ctx.formulaFns.has(k)||timelineIsFormulaKey(k)){
   const raw=ctx.formulaFns.has(k)?timelineFormulaText(e,ctx.formulaFns.get(k)):'';
   const out=WL.cellFormat.cell({raw,format:ctx.calcTarget?WL.columnLayout.format(ctx.calcTarget,k):null,
                                 rule:ctx.calcTarget?WL.columnLayout.rule(ctx.calcTarget,k):'',
                                 row:ctx.ruleRow,column:k});
   return {text:out.text,raw:String(raw==null?'':raw),color:out.color,kind:'calc'};
  }
  const c=ctx.contentMap.get(k);
  return c?{text:c.text,raw:c.raw,color:c.color,kind:'content'}:{text:'',raw:'',color:'',kind:''};
 }
 /* 1行ぶんの`dynamicCellValue`が要る材料をまとめて作る（式の控え・読み替えが
    見る行は1行につき1回。§9.234 ⑥と同じ理由）。 */
 function rowDynamicCtx(e){
  return {contentMap:new Map(timelineContentCells(e).map(c=>[c.key,c])),
          formulaFns:timelineFormulaFns(),ruleRow:timelineRuleRow(e),calcTarget:timelineTarget()};
 }
 /* ---------- 印刷向けの1行ぶんのセル文字列（帳票印刷の刷新、利用者の指示） ----------
    紙は**画面と同じ列（並び・表示/非表示・書式・読み替え・計算式）**を使う
    ——紙のためだけの列選択・「内容」へのまとめ直しはやめた（§9.235）。
    `__actions__`（開始・固定・帳票などのボタン）は紙に意味を持たないので
    渡さない。返す値は`printRowCells`を呼ぶ側（`schedule-print.js`）が
    自由に幅・見出しを決められるよう、プレーンテキストにしてある。 */
 function printRowCells(e){
  const keys=timelineColumnKeys().filter(k=>k!=='__actions__');
  const ctx=rowDynamicCtx(e);
  /* 固定列は`entryCellInfo()`を1行につき1回だけ解く（§9.198「同じ材料なら
     作り直さない」）。`scFixedCellText()`を列ごとに呼ぶと、1行の中で
     可否・区分・見積を何度も引き直すことになる。 */
  let info=null;
  try{info=entryCellInfo(e)}catch(_){info=null}
  const out=keys.map(k=>{
   if(SC_FIXED_TEXT[k]){
    const v=info?String(SC_FIXED_TEXT[k](info)||''):'';
    /* 紙でもバッジで見せる列は**状態の名前**を添える（§9.237）。
       無い列は空文字＝ただの文字として刷る。 */
    const tone=(info&&SC_FIXED_TONE[k])?String(SC_FIXED_TONE[k](info)||''):'';
    /* 印（計画外・固定・遅れ…）は**1つずつ**渡す——紙は画面と同じチップで
       並べるので、連結した1本の文字列では分けられない。 */
    const chips=(k==='__flags__'&&info)?(info.flagList||[]).map(f=>({...f})):null;
    /* **その列が固定列かどうかを紙へ渡す**（§9.294 ①）——紙は「内容の列を
       束ねて題名を置く」ので、どれが内容の列かを知る必要がある。
       **紙の側で綴りから当てないこと**（§9.163。列を1つ足すたびに
       両方直すことになる）。 */
    return {key:k,label:scColLabel(k),text:v,raw:v,color:'',tone,chips,fixed:true};
   }
   const dyn=dynamicCellValue(e,k,ctx);
   return {key:k,label:scColLabel(k),text:dyn.text,raw:dyn.raw||dyn.text,color:dyn.color,tone:'',chips:null,fixed:false};
  });
  /* 作業以外は**題名だけ**（§9.294 ①）。束ねるのは紙の側（実際に刷る列は
     「見える範囲だけ」で削られうるので、画面の並びで決めた束がそのまま
     使えるとは限らない）。ここでするのは**値を落とすこと**だけ。 */
  if(e.kind!=='作業'){
   out.forEach(c=>{
    if(c.fixed){
     if(NON_WORK_BLANK_FIXED.has(c.key)){c.text='';c.raw='';c.tone='';c.chips=null}
     return;
    }
    c.text='';c.raw='';c.color='';c.tone='';c.chips=null;
   });
  }
  return out;
 }
 /* 印刷が並べる列（`__actions__`を除いた、いま画面に出ている並び）。 */
 function printColumnKeys(){return timelineColumnKeys().filter(k=>k!=='__actions__')}
 /* 列の効いている幅(px)。**画面の`applyTimelineContentColumns()`と同じ式**
    ——書き写すと、画面で手で広げた列が紙では既定幅のままになる食い違いが
    起きる。固定列は既定幅、内容の項目は`110`を下限にする(§9.209 ①のeff()
    と同じ数)。 */
 /* ---------- 「画面でいま何px出ているか」を先に見る（§9.237） ----------
    利用者の指摘「列幅も設定したものを活かして…印刷側できちんと反映され
    ない」の**もう1つの原因**。保存値だけを見ると、
     ①幅を指定していない内容の列は`minmax(110px,1fr)`で**残りを分け合って
       伸びている**のに、紙では常に110px相当（29mm）へ痩せる
     ②表示サイズ(`--ui-scale`)が掛かった幅も見えない
    ので、画面で「折り返さない幅」に整えたつもりでも紙では折り返す。
    実際に描かれている見出しのセルを測るのが唯一の正しい答え。

    **表示サイズは割り戻す**——紙は`--ui-scale`へ追随させない約束
    （CLAUDE.md「例外はA4帳票だけ」）。倍率を掛けたまま渡すと、特大の端末で
    刷っただけで紙の列が1.1倍になり、収まっていた紙が収まらなくなる。
    測れないとき（描かれていない・成り代わり中の他設備・幅0）は
    **今までどおり保存値→既定**へ落ちる。 */
 function uiScaleNow(){
  try{const v=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
      return (v&&v>0)?v:1}catch(_){return 1}
 }
 function measuredColumnWidthPx(k){
  try{
   const tl=document.getElementById('scTimeline');
   if(!tl||tl.dataset.equipment!==String(scState.equipment||''))return 0;
   const head=tl.querySelector('.sc-row-head');
   if(!head)return 0;
   const cell=head.querySelector(`[data-col="${CSS.escape(k)}"]`);
   if(!cell)return 0;
   const w=cell.getBoundingClientRect().width;
   if(!w)return 0;
   return Math.round(w/uiScaleNow());
  }catch(_){return 0}
 }
 function columnEffWidthPx(k){
  const m=measuredColumnWidthPx(k);
  if(m)return m;
  const t=timelineTarget();
  const w=t?WL.columnLayout.width(t,k):null;
  if(w)return w;
  const d=SC_COL_MAP.get(k);
  return d?d.w:110;
 }
 /* ---------- 印刷の「見える範囲の列」（§9.236、利用者の指示「見える範囲の
    列か、全ての列かを選べるようにして」） ----------
    `#scTimeline`は横スクロールする器（`.sc-timeline{overflow-x:auto}`）
    なので、いま画面をスクロールせずに見えている列だけを先頭から数える。
    **`#scTimeline`の横幅は設備によらない**（ブラウザ窓の大きさで決まる）
    ので、成り代わり中（`withEquipment`）の他設備でもそのまま使える——
    毎回この関数を呼び直すだけで、設備ごとに測り直す必要が無い。
    測れなければ（要素が無い等）**全部の列**を返す（安全側＝§9.235以前と
    同じ挙動）。 */
 function visibleColumnKeys(){
  const keys=printColumnKeys();
  let limit=0;
  try{
   const tl=document.getElementById('scTimeline');
   /* **同じ物差しで比べる**（§9.237）。`columnEffWidthPx()`は表示サイズを
      割り戻した「等倍の幅」を返すので、器の幅も割り戻してから比べる
      ——混ぜると、特大の端末では入る列を少なく数えてしまう。
      取っ手の列（1列目）は並びに入らないが場所は取るので、その幅も引く。 */
   if(tl){
    const head=tl.querySelector('.sc-row-head');
    const handle=head&&head.firstElementChild?head.firstElementChild.getBoundingClientRect().width:0;
    limit=Math.max(0,(tl.clientWidth-handle)/uiScaleNow());
   }
  }catch(_){limit=0}
  if(!limit)return keys.slice();
  let sum=0;const out=[];
  for(const k of keys){
   const w=columnEffWidthPx(k);
   if(out.length&&sum+w>limit)break;
   sum+=w;out.push(k);
  }
  return out.length?out:keys.slice(0,1);
 }
 /* ---------- 作業以外の行は「題名だけ」にする（§9.294 ①、利用者の指示
    「作業スケジュール表の設備停止名はカラムに関係なく表示できるように
     してほしいです。一番左に配置した基準のカラムに所属させた形で文字が
     見切れたりしてしまう」「設備停止を入れた行は、ロットの情報と全く
     関係ないので、設備停止名以外表示させたくない」） ----------
    以前は題名を**内容欄の先頭の1列へ押し込んで**いた（`timelineContentCells`が
    `i===0`にだけ入れる）。列の幅はロット番号に合わせてあるので、
    「定期点検（ロール交換）」のような名前は必ず切れる——しかも紙では
    `overflow:hidden`で黙って切り落とされる。

    いまは**内容の列をひとかたまりに束ねて**そこへ題名を置く。束ねるのは
    「固定列でない列の、先頭からの連続した並び」——固定列（区分・日付・
    時刻・見積…）は**停止そのものの事実**なので残す（消すと、いつ何分
    止まるのかが読めなくなる）。

    束の外に散っている内容・計算の列は**空にする**（§9.294 ①の後段）。
    計算式と表示ルールは行の材料が無くても走る（§9.234 ⑥「素の値が空でも
    ルールは走らせる」）ので、**条件が空の既定行を持つルールはロットと
    無関係な文字を停止の行にも書き込む**。ここで落とさないと、束ねただけ
    では消えない。**作業可否も落とす**——あれはロットが仕掛かっているかの
    話で、停止には意味が無い（`—`の札が出るだけ）。 */
 /* 束ねる範囲。**「行いっぱい」も選べる**（§9.295、利用者の指示「左寄せに
    したり文字の位置を変更できるように」）——内容の列は行のまん中から
    始まるので、名前を行の頭から出したい現場がある。**操作の列は残す**
    （外す・詳細への入口が消える）。 */
 function nonWorkSpanOf(keys,place){
  if(String(place||'')==='全幅'){
   const last=keys.reduce((n,k,i)=>k==='__actions__'?n:i+1,0);
   if(last>0){
    const run=new Set(keys.slice(0,last));
    return {key:keys[0],span:last,inRun:k=>run.has(k)};
   }
  }
  const at=keys.findIndex(k=>!scIsFixedCol(k));
  if(at<0)return {key:'',span:0,inRun:()=>false};
  let span=1;
  while(at+span<keys.length&&!scIsFixedCol(keys[at+span]))span++;
  const run=new Set(keys.slice(at,at+span));
  return {key:keys[at],span,inRun:k=>run.has(k)};
 }
 /* 作業以外の行で**空にする固定列**。ここに挙げたものだけ落とす
    （残りは停止そのものの事実なので残す）。 */
 const NON_WORK_BLANK_FIXED=new Set(['__workable__']);
 /* ---------- 作業以外の行の題名は1箇所で作る(§9.238 ②) ----------
    以前は「コメントか、そうでなければ設備停止」という2択を3箇所へ書き写して
    いた。3つ目(枠)が増えた時点で、書き写した数だけ直す場所ができる
    （CLAUDE.md「関数の定義は1箇所」）。空のコメントに何と出すかだけが
    呼び出しごとに違うので、そこだけ引数で受ける。 */
 function nonWorkTitleText(e,emptyComment){
  if(e.kind==='枠')return frameText(e);
  const t=String(e.title||'').trim();
  if(t)return t;
  return e.kind==='コメント'?String(emptyComment||'（コメント）'):'設備停止';
 }
 /* 枠の題名。**日付と直から組み立て直す**——保存されている[予定名称]は
    明細JSONを開かない場所(帳票・監査ログ)のための控えで、画面はいつでも
    今の設定から作る。**何が起きているかも一緒に書く**(§6・§3)——
    「もう埋まった」のか「まだN時間空けている」のかで、次にすることが違う。 */
 /* 材料は`frameParts()`の1箇所（§9.300 ②）。**画面は箱として2段に組み、
    紙と`title`と監査は1行に繋ぐ**——同じ文字を2通りに組み立てると、
    箱に出ている言葉と紙に刷られる言葉が食い違う（§9.163）。 */
 function frameParts(e){
  const f=(e&&e.frame)||{};
  const d=String(f.date||(e&&e.detail&&e.detail.frameDate)||'').trim();
  const sh=String(f.shift||(e&&e.detail&&e.detail.frameShift)||'').trim();
  return {dated:!!d,kind:SC_CATEGORIES.frame.label,
          head:d?`${frameDateLabel(d)}${sh?' '+sh:''} から`:'（日付が未設定）',
          state:frameStateText(e),
          note:String(f.note||(e&&e.detail&&e.detail.frameNote)||'').trim()};
 }
 /* **区分の名前を頭に付ける**（§3、§9.300 ②）——行いっぱいにすると区分の列が
    出なくなるので、この1行が「何の行か」を自分で名乗る必要がある。
    画面の箱は`kind`と`head`を別の段に置くので、二重にはならない。 */
 function frameText(e){
  const p=frameParts(e);
  return [`${p.kind} ${p.head}`,p.state,p.note].filter(Boolean).join(' ／ ');
 }
 /* 箱の中身（§9.300 ②）。**見出しは`.sc-nw-face`を兼ねる**——題名の
    見せ方（バッジ）を選んだときに、枠だけ設定が効かない状態にしない（§4）。 */
 function frameBoxHtml(e,look){
  const p=frameParts(e);
  const sub=[p.state,p.note].filter(Boolean).join(' ／ ');
  /* 3段（区分／行き先／状態）。**区分の名前は必ず文字で出す**（§3）
     ——行いっぱいにすると区分の列が出なくなるため。呼び名とアイコンは
     `categoryOf()`と`rowStyleOf()`の答えをそのまま使う（§9.163）。 */
  return `<span class="sc-frame-kind">${rowStyleOf(e).html}${esc(p.kind)}</span>`
   +`<b class="sc-frame-head${look?' sc-nw-face':''}">${esc(p.head)}</b>`
   +(sub?`<span class="sc-frame-sub">${esc(sub)}</span>`:'');
 }
 function frameStateText(e){
  const f=e.frame;
  if(!f)return '';
  if(f.reached)return 'ここまで埋まりました';
  const g=Number(f.gapMinutes);
  return Number.isFinite(g)&&g>0?`空き ${WL.duration.text(g)}`:'';
 }
 const FRAME_WD=['日','月','火','水','木','金','土'];
 function frameDateLabel(iso){
  /* **`new Date('2026-08-18')`で組み立てないこと**(§9.195)——UTCの0時として
     読まれ、地方時で1日ずれる端末がある。 */
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||''));
  if(!m)return String(iso||'');
  const d=new Date(+m[1],+m[2]-1,+m[3]);
  if(Number.isNaN(d.getTime()))return String(iso);
  return `${+m[2]}/${+m[3]}（${FRAME_WD[d.getDay()]}）`;
 }
 function entryContentText(e){
  if(e.kind!=='作業')return nonWorkTitleText(e,'（コメント）');

  const items=(scContentPrefs.equipment===scState.equipment)?scContentPrefs.items:null;
  if(items&&items.length){
   const parts=items.map(k=>entryValueOf(e,k)).filter(v=>v!==undefined);
   if(parts.length)return parts.map(v=>String(v).trim()).join(' / ');
  }
  /* 既定の組み立て。**値の取り出しはcontentValueOf経由**にする(§9.69)。
     直接e.detail.purposeNameを見ていたため、生カラム名「用途名」でしか
     持っていない予定では空欄になっていた(選択時の経路はcontentValueOfを
     使っており、既定だけが取りこぼす食い違い)。
     欠けている項目は詰めて繋ぐ。テンプレート文字列で空文字を挟むと
     「L0001  A5052」のように**二重空白**が残る(実際にそう出ていた)。 */
  const temper=contentValueOf(e.detail,'mfgTemper');
  const material=contentValueOf(e.detail,'mfgMaterial');
  return [e.lotNo||'-',
          contentValueOf(e.detail,'purposeName'),
          material?`${material}${temper?'-'+temper:''}`:(temper||'')]
   .map(v=>String(v??'').trim()).filter(Boolean).join(' ');
 }
 /* 見出し。内容の欄は項目ごとに分かれるので、**見出しも項目名で出す**
    (「内容」という名前のままでは何が入っているのか分からない)。表示名は
    列レイアウトマスタが持つので、一覧と同じ言葉で出せる。 */
 function rowHeadHtml(){
  const t=timelineTarget();
  const cells=timelineColumnKeys().map(k=>{
   const label=scColLabel(k);
   const d=SC_COL_MAP.get(k);
   /* 操作の列は右端に貼り付く(sticky)。**並びの中では普通の列**なので、
      掴んで動かせるし隠せる——貼り付き方だけが違う。 */
   /* 見出しの揃えは`WL.columnAlign`の1箇所が答える（§9.239 ④）。
      既定は中央で、値の揃えとは別に持つ。 */
   const cls='sc-row-title-head'+(k==='__actions__'?' sc-actions-head':'')
     +' '+WL.columnAlign.headClass(t,k);
   const what=d?d.note:`内容欄の項目（${k}）`;
   return `<span class="${cls}" data-col="${esc(k)}"`
    +(scIsFixedCol(k)?'':` data-content-col="${esc(k)}"`)
    +` draggable="true"`
    +` title="${esc(label)}｜${esc(what)}\nドラッグで並べ替え／右端の取っ手で幅／右クリックで表示・幅のメニュー">${esc(label)}`
    +`<i class="col-resize" title="ドラッグで列幅を調整（ダブルクリックで既定へ）" aria-hidden="true"></i></span>`;
  }).join('');
  /* 1列目は取っ手（掴む場所＋まとめて選ぶチェック）。**並びには入れない**
     ——動かす手立てそのものなので、隠せると戻せなくなる。 */
  return `<div class="sc-row-head">
  ${canPickEntries()?'<span class="sc-row-pick-head"><input type="checkbox" id="scPickAll" title="まとめて動かせる／外せる予定をすべて選ぶ・解除します"></span>':'<span></span>'}${cells}
 </div>`;
 }

 /* ---------- 実施中/予定/実績のグルーピング(§9.34) ----------
    以前は予定・実施中・完了が1本の並びに混ざっており、「今どれをやって
    いるのか」「さっき何が終わったのか」を目で追う必要があった。状態で
    3つに切り分け、それぞれ見出しを付ける。
      実施中: 着手(計画済み・計画外の両方)。今この設備を塞いでいるもの
      予定  : 未着手。時刻順にそのまま
      実績  : 完了・取消。表示範囲(historyHours)内のものだけ
    完了/取消はplannedStart/Endを持たない(終端状態は展開対象外)ため、
    表示範囲の判定にはactual.endAtを使う。actualも無い取消は、履歴の
    末尾に残す(消してしまうと「取り消したはずの予定が見当たらない」と
    なるため)。 */
 function historyCutoff(){
  return Date.now()-(scState.historyHours||8)*3600000;
 }
 function withinHistory(e){
  const at=e.actual&&(e.actual.endAt||e.actual.startAt);
  if(!at)return true;
  const t=new Date(at).getTime();
  return Number.isNaN(t)?true:t>=historyCutoff();
 }

 /* ---------- 区分(カテゴリ)と並び順(§9.39) ----------
    完了済み・作業中・作業予定の3区分。以前はセクション見出しで分けて
    いたが、行の中の「区分」列で持つ形にした(見出し方式だと、日付や勤務で
    まとめ直したいときに区分の見出しと二重になってしまう)。

    並び順は**時刻の一本道**にする。3区分はそれぞれ代表時刻を持ち、
      完了 : 実績の終了時刻(過去)
      作業中: 実績の開始時刻(過去に始まり、予定終了は常に現在時刻=§9.37)
      予定 : 予定開始時刻(未来)
    なので、単純に時刻順へ並べるだけで「完了 → 作業中 → 予定」になる。
    区分ごとに並びを組み立てる必要は無い。 */
 /* **区分そのものは印を持たない**(§9.201、利用者の指示「既定はすべて
    アイコンなし」)。印を付けたい区分は行表示マスタで選ぶ。 */
 const SC_CATEGORIES={
  done:{key:'done',label:'完了'},
  doing:{key:'doing',label:'作業中'},
  planned:{key:'planned',label:'予定'},
  cancel:{key:'cancel',label:'取消'},
  stop:{key:'stop',label:'設備停止'},
  /* 申し送り(§9.189)。**時間を持たない**ので、設備停止とは別の区分にする
     ——同じ「作業以外」でも、片方は時間を取り、片方は取らない。 */
  comment:{key:'comment',label:'コメント'},
  /* 空の日付・直の枠(§9.238 ②)。**時間は使わないが起点を動かす**ので、
     コメントとも設備停止とも違う3つ目の「作業以外」。 */
  frame:{key:'frame',label:'枠'},
 };
 function categoryOf(e){
  if(e.state==='取消')return SC_CATEGORIES.cancel;
  if(e.kind==='コメント')return SC_CATEGORIES.comment;
  if(e.kind==='枠')return SC_CATEGORIES.frame;
  if(e.state==='完了')return SC_CATEGORIES.done;
  if(e.state==='着手')return SC_CATEGORIES.doing;
  if(e.kind==='設備停止')return SC_CATEGORIES.stop;
  return SC_CATEGORIES.planned;
 }
 /* ---------- 行の見せ方(§9.198、利用者の指示) ----------
    「設備停止の行の配色変更やアイコン有り無し（絵文字だけでなく
    FontAwesomeのような記号も）ができるように、行の表示のカスタム機能を」。

    決めごと:
     ・**全設備共通で持つ**（行表示マスタ）。区分の色は設備をまたいで意味を
       持つ言語で、同じ「設備停止」が設備ごとに別の色だと色が何も語らなく
       なる（設備停止分類マスタが全設備共通なのと同じ理由）。
     ・**色は選ばせるが、色そのものは選ばせない**。自由な16進を許すと、
       淡すぎて文字が読めない・画面ごとに違う赤が増える、が必ず起きる。
       意味の付いた8色（トークン）から選ぶ。
     ・**色だけで伝えない**（§3）。区分名の文字は必ず出したままで、色と
       アイコンは補助。
     ・**絵文字以外も選べる**。外部のアイコンフォントは取りに行けない
       （このアプリは社内で閉じて動く）ので、同じ見え方の**線画アイコンを
       同梱**する。1つ12〜14pxで読めるよう、線幅2の単純な形にしてある。
     ・**効く順は「分類の指定 → 区分の指定 → 既定」**。判定はここ1箇所。 */
 /* 行の色（§9.198）。**色の表は`WL.columnTint.PALETTE`の1箇所**
    （§9.239 ⑤-3／§9.286 ⑥）——ここへ写すと、色を1つ足すたびに2箇所直す
    ことになり、片方だけ増えた状態が作れる。先頭の「既定」だけがこの画面の
    もの（区分ごとの元の色へ戻す、という行の見せ方だけの選択肢）。 */
 const SC_ROW_PALETTE=[{key:'',label:'既定',note:'区分ごとの元の色'}].concat(
  ((window.WL&&WL.columnTint&&WL.columnTint.keys())||[]).map(k=>({
   key:k,label:WL.columnTint.label(k),note:WL.columnTint.note(k)})));
 /* 同梱の線画アイコン(24×24、線幅2)。**外部から取りに行かない**——
    社内で閉じて動くアプリなので、CDNのアイコンフォントは読めない。 */
 const SC_ICON_SVG={
  /* --- 作業・段取り --- */
  gear:'<circle cx="12" cy="12" r="3.2"/><path d="M12 2.4v2.6M12 19v2.6M2.4 12h2.6M19 12h2.6M5.2 5.2l1.9 1.9M16.9 16.9l1.9 1.9M18.8 5.2l-1.9 1.9M7.1 16.9l-1.9 1.9"/>',
  wrench:'<path d="M17.9 6.1a4.2 4.2 0 01-5.4 5.4L5 19l-2-2 7.5-7.5a4.2 4.2 0 015.4-5.4l-2.4 2.4 2 2 2.4-2.4z"/>',
  hammer:'<path d="M12.6 7.4 4 16v4h4l8.6-8.6"/><path d="M13.2 2.8 21.2 10.8l-2.8 2.8-8-8z"/>',
  sliders:'<path d="M4 7h9M18.5 7H20M4 17h5M14.5 17H20"/><circle cx="15.5" cy="7" r="2.5"/><circle cx="11.5" cy="17" r="2.5"/>',
  swap:'<path d="M4 8.5h13l-3.4-3.4M20 15.5H7l3.4 3.4"/>',
  redo:'<path d="M20.5 12a8.5 8.5 0 11-2.5-6M20.5 3.2V9h-5.8"/>',
  play:'<path d="M8 5.2 19 12 8 18.8V5.2z"/>',
  pause:'<path d="M9 5v14M15 5v14"/>',
  square:'<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  power:'<path d="M12 3v8"/><path d="M6.6 6.6a7.6 7.6 0 1010.8 0"/>',
  /* --- 状態・注意 --- */
  check:'<path d="M4.5 12.6l5 5L20 6.6"/>',
  checks:'<path d="M2.5 12.6l4 4L14 9"/><path d="M10.5 15.4l1.5 1.6L21.5 7.6"/>',
  checkc:'<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.8 2.8 5.4-5.4"/>',
  xc:'<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  ban:'<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  warn:'<path d="M12 4 2.6 20h18.8L12 4z"/><path d="M12 10v4.5M12 17.4v.1"/>',
  bolt:'<path d="M13.2 2 4.5 13.6h5.6L8.8 22l9-11.8h-5.6L13.2 2z"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/>',
  question:'<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 114.2 2.1c-.9.8-1.8 1.3-1.8 2.5M12 17.4v.1"/>',
  bang:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.4v.1"/>',
  lock:'<rect x="5" y="10.4" width="14" height="9.6" rx="1.5"/><path d="M8.4 10.4V8a3.6 3.6 0 017.2 0v2.4"/>',
  eye:'<path d="M2.6 12S6.1 6 12 6s9.4 6 9.4 6-3.5 6-9.4 6-9.4-6-9.4-6z"/><circle cx="12" cy="12" r="2.6"/>',
  /* --- 時間 --- */
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.2 1.9"/>',
  hourglass:'<path d="M7 3h10M7 21h10M8 3v3.4c0 2 4 3.9 4 5.6 0-1.7 4-3.6 4-5.6V3M8 21v-3.4c0-2 4-3.9 4-5.6 0 1.7 4 3.6 4 5.6V21"/>',
  calendar:'<rect x="3.4" y="5" width="17.2" height="15" rx="1.6"/><path d="M3.4 9.6h17.2M8 3v4M16 3v4"/>',
  timer:'<circle cx="12" cy="13.6" r="7.4"/><path d="M12 10v3.8l2.5 1.5M9.6 2.6h4.8"/>',
  moon:'<path d="M20.2 14.6A8.6 8.6 0 019.4 3.8a8.6 8.6 0 1010.8 10.8z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"/>',
  /* --- 設備・もの --- */
  truck:'<path d="M3 7h11v9H3zM14 10.5h3.6L21 13.6V16h-7z"/><circle cx="7.2" cy="18" r="1.8"/><circle cx="17.2" cy="18" r="1.8"/>',
  box:'<path d="M3 8l9-4 9 4-9 4-9-4zM3 8v8l9 4 9-4V8"/>',
  coil:'<ellipse cx="12" cy="6.4" rx="7.6" ry="3"/><path d="M4.4 6.4v11.2c0 1.7 3.4 3 7.6 3s7.6-1.3 7.6-3V6.4"/>',
  scissors:'<circle cx="6.4" cy="17.8" r="2.4"/><circle cx="6.4" cy="6.2" r="2.4"/><path d="M8.6 7.4 20 18M8.6 16.6 20 6"/>',
  ruler:'<rect x="2.6" y="8" width="18.8" height="8" rx="1.2"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>',
  gauge:'<path d="M4 17.5a8 8 0 1116 0"/><path d="M12 17.5l4.2-4.8"/>',
  brush:'<path d="M9 15.2 5 19.2 6 22l3-1 4-4M12.4 12.4l5.8-5.8a2.9 2.9 0 014.1 4.1l-5.8 5.8z"/>',
  drop:'<path d="M12 3.4S5.4 11 5.4 14.8a6.6 6.6 0 1013.2 0C18.6 11 12 3.4 12 3.4z"/>',
  plug:'<path d="M9 3v5M15 3v5M6.4 8h11.2v3a5.6 5.6 0 01-11.2 0V8zM12 16.6V21"/>',
  thermo:'<path d="M14 14.2V5a2 2 0 10-4 0v9.2a4 4 0 104 0z"/>',
  /* --- 人・連絡 --- */
  person:'<circle cx="12" cy="8" r="3.2"/><path d="M5 20.5a7 7 0 0114 0"/>',
  users:'<circle cx="9.2" cy="8" r="3.2"/><path d="M2.8 20a6.4 6.4 0 0112.8 0"/><path d="M16.2 5.2a3.2 3.2 0 010 5.7M17.4 14.4A6.4 6.4 0 0121.2 20"/>',
  chat:'<path d="M4 5h16v11H9.5L4.5 20V5z"/>',
  note:'<path d="M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7"/>',
  clipboard:'<rect x="5" y="4.6" width="14" height="16" rx="1.6"/><path d="M9 4.6V3.2h6v1.4M9 10.4h6M9 14.4h6"/>',
  phone:'<path d="M6 3.6h4l1.5 4-2.2 1.6a12 12 0 005.5 5.5l1.6-2.2 4 1.5v4a2 2 0 01-2.2 2C10.6 19.3 4.7 13.4 4 5.8A2 2 0 016 3.6z"/>',
  bell:'<path d="M6.4 17V11a5.6 5.6 0 1111.2 0v6M4.4 17h15.2M10 20.4h4"/>',
  mail:'<rect x="3" y="5.4" width="18" height="13.2" rx="1.6"/><path d="M3.6 6.6 12 13l8.4-6.4"/>',
  cup:'<path d="M4 8h12v5.5a6 6 0 01-12 0zM16 9.2h2a2.6 2.6 0 010 5.2h-2M3.5 21h13"/>',
  /* --- 目印・記号 --- */
  star:'<path d="M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  heart:'<path d="M12 20.2S4.4 15.3 4.4 10.4A4.4 4.4 0 0112 7.5a4.4 4.4 0 017.6 2.9c0 4.9-7.6 9.8-7.6 9.8z"/>',
  pin:'<path d="M12 21.2S19 14.7 19 10a7 7 0 10-14 0c0 4.7 7 11.2 7 11.2z"/><circle cx="12" cy="10" r="2.4"/>',
  tag:'<path d="M3.4 11.6V3.4H11.6l9 9-8.2 8.2-9-9z"/><circle cx="7.4" cy="7.4" r="1.4"/>',
  bookmark:'<path d="M6.4 3.4h11.2v17.2L12 16.4l-5.6 4.2V3.4z"/>',
  flag:'<path d="M5.5 21V3.5M5.5 4.5h11l-2 3 2 3h-11"/>',
  dot:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  triangle:'<path d="M12 4.4 21 19.6H3L12 4.4z"/>',
  diamond:'<path d="M12 3l9 9-9 9-9-9 9-9z"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  minus:'<path d="M5 12h14"/>',
  up:'<path d="M12 19.5V5M6 11l6-6 6 6"/>',
  down:'<path d="M12 4.5V19M6 13l6 6 6-6"/>',
  right:'<path d="M4.5 12h15M13 5.5l6.5 6.5-6.5 6.5"/>',
 };
 /* 選べるアイコン(§9.198 → §9.200 → §9.201で作り直し)。
    利用者の指示は「アイコンや絵文字の閲覧性が悪い」「いろんな種類が欲しい」
    「既定はすべてアイコンなしに」。
     ・**既定は「なし」**——以前は区分ごとに元の絵(✓ ▶ ○ ✕ ⛔ 💬)を持って
       いて、「既定」と「なし」という**同じ見え方になり得る2択**を選ばせて
       いた。既定を無くしたので選択肢は1本になる。
     ・**種類は多くてよいが、探せることが条件**。選ぶ盤に絞り込みを付けて
       あるので、`label`のほかに読み・言い換え(`kw`)を持たせる。
     ・`kind`は選ぶ盤の見出し分けに使う。**名前に「(絵文字)」と書かない**
       ——器の幅を食って見切れる（実機で「工具(絵文…」と切れて出た）。 */
 const SC_ROW_ICONS=[
  {v:'none',label:'なし',kind:'none',kw:'無し ない 消す 既定'},
  /* 作業・段取り */
  {v:'svg:gear',label:'歯車',kind:'work',kw:'設定 整備 メンテ'},
  {v:'svg:wrench',label:'工具',kind:'work',kw:'スパナ 保全 修理'},
  {v:'svg:hammer',label:'ハンマー',kind:'work',kw:'修理 工事'},
  {v:'svg:sliders',label:'調整',kind:'work',kw:'段取り 設定 つまみ'},
  {v:'svg:swap',label:'入れ替え',kind:'work',kw:'段取り 交換 切替'},
  {v:'svg:redo',label:'やり直し',kind:'work',kw:'再 リトライ 手直し'},
  {v:'svg:play',label:'開始',kind:'work',kw:'再生 着手 スタート'},
  {v:'svg:pause',label:'一時停止',kind:'work',kw:'中断 待ち'},
  {v:'svg:square',label:'停止',kind:'work',kw:'終了 ストップ'},
  {v:'svg:power',label:'電源',kind:'work',kw:'起動 停止'},
  /* 状態・注意 */
  {v:'svg:check',label:'チェック',kind:'state',kw:'完了 済 レ点'},
  {v:'svg:checks',label:'二重チェック',kind:'state',kw:'完了 確認済'},
  {v:'svg:checkc',label:'完了(丸)',kind:'state',kw:'済 OK 合格'},
  {v:'svg:xc',label:'不可(丸)',kind:'state',kw:'中止 取消 NG'},
  {v:'svg:ban',label:'禁止',kind:'state',kw:'停止 だめ'},
  {v:'svg:warn',label:'注意',kind:'state',kw:'警告 三角 危険'},
  {v:'svg:bolt',label:'突発',kind:'state',kw:'稲妻 緊急 トラブル'},
  {v:'svg:info',label:'情報',kind:'state',kw:'案内 インフォ'},
  {v:'svg:question',label:'疑問',kind:'state',kw:'確認 はてな 不明'},
  {v:'svg:bang',label:'重要',kind:'state',kw:'注意 ビックリ 至急'},
  {v:'svg:lock',label:'固定',kind:'state',kw:'鍵 ロック 動かさない'},
  {v:'svg:eye',label:'見張り',kind:'state',kw:'監視 確認 目'},
  /* 時間 */
  {v:'svg:clock',label:'時計',kind:'time',kw:'時間 時刻'},
  {v:'svg:hourglass',label:'砂時計',kind:'time',kw:'待ち 経過'},
  {v:'svg:calendar',label:'予定表',kind:'time',kw:'カレンダー 日付'},
  {v:'svg:timer',label:'タイマー',kind:'time',kw:'計測 所要'},
  {v:'svg:moon',label:'夜',kind:'time',kw:'夜勤 三直 月'},
  {v:'svg:sun',label:'昼',kind:'time',kw:'日勤 一直 太陽'},
  /* 設備・もの */
  {v:'svg:truck',label:'運搬',kind:'thing',kw:'搬入 搬出 トラック'},
  {v:'svg:box',label:'箱',kind:'thing',kw:'材料 製品 梱包'},
  {v:'svg:coil',label:'コイル',kind:'thing',kw:'巻 母材 ロール コイル'},
  {v:'svg:scissors',label:'切断',kind:'thing',kw:'スリット はさみ 切る'},
  {v:'svg:ruler',label:'寸法',kind:'thing',kw:'測定 定規 計測'},
  {v:'svg:gauge',label:'計器',kind:'thing',kw:'負荷 メーター 速度'},
  {v:'svg:brush',label:'清掃',kind:'thing',kw:'掃除 片付け'},
  {v:'svg:drop',label:'油・水',kind:'thing',kw:'給油 クーラント しずく'},
  {v:'svg:plug',label:'電源プラグ',kind:'thing',kw:'停電 電気'},
  {v:'svg:thermo',label:'温度',kind:'thing',kw:'温度計 熱'},
  /* 人・連絡 */
  {v:'svg:person',label:'人',kind:'people',kw:'担当 作業者'},
  {v:'svg:users',label:'応援',kind:'people',kw:'複数人 班 チーム'},
  {v:'svg:chat',label:'申し送り',kind:'people',kw:'コメント 連絡 吹き出し'},
  {v:'svg:note',label:'メモ',kind:'people',kw:'書類 記録'},
  {v:'svg:clipboard',label:'指示書',kind:'people',kw:'カード 帳票 チェック表'},
  {v:'svg:phone',label:'電話',kind:'people',kw:'連絡 問合せ'},
  {v:'svg:bell',label:'呼び出し',kind:'people',kw:'通知 ベル 注意喚起'},
  {v:'svg:mail',label:'メール',kind:'people',kw:'連絡 送信'},
  {v:'svg:cup',label:'休憩',kind:'people',kw:'休み 昼休み コーヒー'},
  /* 目印・記号 */
  {v:'svg:star',label:'星',kind:'mark',kw:'重要 お気に入り'},
  {v:'svg:heart',label:'ハート',kind:'mark',kw:'目印 好み'},
  {v:'svg:pin',label:'ピン',kind:'mark',kw:'場所 目印'},
  {v:'svg:tag',label:'タグ',kind:'mark',kw:'分類 ラベル'},
  {v:'svg:bookmark',label:'しおり',kind:'mark',kw:'目印 ブックマーク'},
  {v:'svg:flag',label:'旗',kind:'mark',kw:'目印 開始 節目'},
  {v:'svg:dot',label:'二重丸',kind:'mark',kw:'印 丸 ターゲット'},
  {v:'svg:triangle',label:'三角',kind:'mark',kw:'印 注意'},
  {v:'svg:diamond',label:'ひし形',kind:'mark',kw:'印 節目'},
  {v:'svg:plus',label:'追加',kind:'mark',kw:'足す プラス'},
  {v:'svg:minus',label:'除外',kind:'mark',kw:'引く マイナス'},
  {v:'svg:up',label:'上向き矢印',kind:'mark',kw:'優先 上げる'},
  {v:'svg:down',label:'下向き矢印',kind:'mark',kw:'後回し 下げる'},
  {v:'svg:right',label:'右向き矢印',kind:'mark',kw:'次へ 進む'},
  {v:'✓',label:'レ点(文字)',kind:'mark',kw:'チェック 完了'},
  {v:'▶',label:'三角(文字)',kind:'mark',kw:'再生 開始'},
  {v:'○',label:'丸(文字)',kind:'mark',kw:'予定 まる'},
  {v:'✕',label:'バツ(文字)',kind:'mark',kw:'取消 ばつ'},
  {v:'★',label:'星(文字)',kind:'mark',kw:'重要 ほし'},
  {v:'●',label:'黒丸(文字)',kind:'mark',kw:'印 まる'},
  {v:'■',label:'黒四角(文字)',kind:'mark',kw:'印 しかく'},
  {v:'‼',label:'二重ビックリ',kind:'mark',kw:'至急 重要'},
  /* 絵文字（色つき） */
  {v:'⛔',label:'禁止',kind:'emoji',kw:'停止 だめ'},
  {v:'🔧',label:'工具',kind:'emoji',kw:'保全 修理 スパナ'},
  {v:'🔄',label:'段取り',kind:'emoji',kw:'切替 交換'},
  {v:'⏳',label:'待ち',kind:'emoji',kw:'砂時計 保留'},
  {v:'⚡',label:'突発',kind:'emoji',kw:'緊急 トラブル'},
  {v:'💬',label:'コメント',kind:'emoji',kw:'申し送り 連絡'},
  {v:'🚚',label:'運搬',kind:'emoji',kw:'搬入 搬出'},
  {v:'🧹',label:'清掃',kind:'emoji',kw:'掃除 片付け'},
  {v:'☕',label:'休憩',kind:'emoji',kw:'休み コーヒー'},
  {v:'🛠',label:'整備',kind:'emoji',kw:'保全 メンテ'},
  {v:'📦',label:'材料',kind:'emoji',kw:'箱 製品'},
  {v:'🚧',label:'工事',kind:'emoji',kw:'規制 立入禁止'},
  {v:'🔥',label:'至急',kind:'emoji',kw:'緊急 火'},
  {v:'📌',label:'目印',kind:'emoji',kw:'ピン 固定'},
  {v:'✅',label:'済',kind:'emoji',kw:'完了 チェック'},
  {v:'❗',label:'重要',kind:'emoji',kw:'注意 至急'},
  {v:'🕒',label:'時間',kind:'emoji',kw:'時計 所要'},
  {v:'⭐',label:'星',kind:'emoji',kw:'重要 印'},
 ];
 const SC_ICON_GROUPS=[
  ['none','印を出さない'],['work','作業・段取り'],['state','状態・注意'],
  ['time','時間'],['thing','設備・もの'],['people','人・連絡'],
  ['mark','目印・記号'],['emoji','絵文字（色つき）'],
 ];
 /* いま選ばれているものの呼び名。**保存値が一覧に無くても諦めない**
    ——古い設定や手で入れた文字が入っていることがあるので、その字を出す。 */
 function iconLabelOf(v){
  const key=String(v||'')||'none';
  const hit=SC_ROW_ICONS.find(i=>i.v===key);
  if(hit)return hit.label;
  return key;
 }
 function rowIconHtml(spec){
  const v=String(spec||'');
  if(!v||v==='none')return '';
  if(v.startsWith('svg:')){
   const d=SC_ICON_SVG[v.slice(4)];
   if(!d)return '';
   return `<svg class="sc-ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  }
  return `<i>${esc(v)}</i>`;
 }
 /* 保存済みの設定。**行が無い＝既定**（空文字を保存すると「空という設定」に
    なり、既定を変えても追随しなくなる。§9.99と同じ約束）。 */
 let scRowStyles=null,scRowStylesAt=0;
 /* 題名の見せ方の語彙（§9.295）。**サーバーが答える**ので画面へ綴りを
    書き写さない（§9.163）。届くまでは空＝選ばせない（推測で並べない）。 */
 let scRowTitleVocab={looks:[],places:[],aligns:[],times:[]};
 async function loadRowStyles(force){
  if(!force&&scRowStyles)return scRowStyles;
  try{
   const r=await api('/api/schedule/row-style-master');
   const m=new Map();
   (r.items||[]).forEach(x=>{if(x&&x.key)m.set(String(x.key),x)});
   scRowStyles=m;scRowStylesAt=Date.now();
   scRowTitleVocab={looks:r.titleLooks||[],places:r.titlePlaces||[],
                    aligns:r.titleAligns||[],times:r.titleTimes||[]};
  }catch(_){if(!scRowStyles)scRowStyles=new Map()}
  return scRowStyles;
 }
 /* この行が属する設備停止の分類。**分からなければ空**（推測しない）。 */
 function stopCategoryOfEntry(e){
  if(!e||e.kind!=='設備停止')return '';
  const name=String(e.title||'').trim();
  if(!name)return '';
  const hit=(scState.stopReasons||[]).find(r=>String(r.name||'').trim()===name);
  return hit?String(hit.category||'').trim():'';
 }
 /* 効いている見せ方。**分類の指定 → 区分の指定 → 既定**の順。 */
 function rowStyleOf(e){
  const cat=categoryOf(e);
  const m=scRowStyles;
  const sc=stopCategoryOfEntry(e);
  const hit=(m&&sc&&m.get('stopcat:'+sc))||(m&&m.get('cat:'+cat.key))||null;
  /* **既定はアイコンなし**(§9.201)。以前は区分・分類ごとに元の絵を
     当てていたが、利用者の指示で「既定はすべてアイコンなし」にした
     ——付けたい行にだけ付けるほうが、印としての意味が強くなる。 */
  /* 題名の見せ方（§9.295、利用者の指示「設備停止の部分に色やバッジみたいな
     デザインを付けたい／左寄せにしたり文字の位置を変更できるように」）。
     **効く順は色と同じ**（分類 → 区分 → 既定）で、判定をここ以外に置かない
     ——画面と紙で違う答えが出る（§9.163）。 */
  return {colorKey:hit?String(hit.colorKey||''):'',
          titleLook:hit?String(hit.titleLook||''):'',
          titlePlace:rowTitlePlaceOf(e,hit),
          titleAlign:hit?String(hit.titleAlign||''):'',
          titleTime:hit?String(hit.titleTime||''):'',
          icon:iconValueOf(hit),html:rowIconHtml(iconValueOf(hit))};
 }
 /* 効いている「題名の位置」。**枠の既定は行いっぱい**（§9.300 ②、利用者の
    指示「日付、直の枠については、3ロット分くらいの大きめの枠だけのものを
    作って箱として使う感じのものに変更してほしいです。…上位階層に日付・直と
    いう箱を1つ作っておくようなイメージです」）。

    §9.294 ①で「日付・時刻・区分・見積は残す」と決めたのは**設備停止**の話で、
    理由は「いつ何分止まるのかが列から読めなくなる」ことだった。
    **枠では同じ列が別のことを言っている**——実測（行き先が8/29の枠）で
    日付列は`09/04`（＝起点がいま居る日）、時刻は`04:11〜04:11`、見積は`0分`、
    実績は`-`で、**1つの行に違う日付が2つ**並んでいた。どれも
    「空のスケジュールらしきもの」にしか見えない（利用者の言葉そのもの）。
    行いっぱいにすれば、枠自身の事実（行き先の日・直と状態）だけが残る。

    **判定はここ1箇所**（§9.163）——`rowStyleOf()`が効いている値を返すので、
    画面（`nonWorkSpanOf`）も紙（`contentRunOf`）も同じ答えを見る。
    **マスタで明示していればそちらが勝つ**（§9.132。わざわざ選んだ人の
    見え方を変えない）。 */
 function rowTitlePlaceOf(e,hit){
  const v=hit?String(hit.titlePlace||''):'';
  if(v)return v;
  return (e&&e.kind==='枠')?'全幅':'';
 }
 /* 題名の見せ方が効くのは**作業以外の行だけ**（§9.295）。作業の行には
    束ねた題名のマスが無いので、盤では欄ごと出さずに理由を書く（§4）。 */
 const ROW_TITLE_KEYS=new Set(['cat:stop','cat:comment','cat:frame']);
 function rowTitleSettable(key){
  const k=String(key||'');
  return ROW_TITLE_KEYS.has(k)||k.indexOf('stopcat:')===0;
 }
 /* 題名の横の（所要時間）（§9.295 ④、利用者の指示「設備停止名の横に()書きで
    時間を表示するように。デフォルト表示ONでOFFにもできるように」）。
    **既定は出す**（空欄＝出す）。時間が分からない行では何も出さない
    ——「（-）」と書くと、0分の停止があるように読める（§9.114）。
    書き方は`fmtMinutes`（「45分」「2時間30分」）——見出しが単位を言わない
    場所なので、`fmtCompact`の`0:45`ではなくこちら（§9.3改訂の使い分け）。 */
 function nonWorkTimeText(e){
  if(!e||e.kind==='作業')return '';
  if(String(rowStyleOf(e).titleTime||'')==='なし')return '';
  const m=e.estimate&&e.estimate.minutes;
  if(m===null||m===undefined||!Number.isFinite(Number(m))||Number(m)<=0)return '';
  return `（${WL.duration.text(Number(m))}）`;
 }
 function rowStyleClass(e){
  const c=rowStyleOf(e).colorKey;
  return c?(' sc-rs-'+c):'';
 }
 /* 行の代表時刻。並び替え・日付/勤務のまとめ・表示範囲の判定すべてが
    これを使う(判定ごとに別の時刻を見ると、まとめた見出しと行の日付が
    食い違う)。 */
 function rowTimeOf(e){
  const iso=(e.state==='完了'||e.state==='取消')
   ?((e.actual&&(e.actual.startAt||e.actual.endAt))||null)
   :(e.plannedStart||null);
  if(!iso)return null;
  const t=new Date(iso).getTime();
  return Number.isNaN(t)?null:t;
 }
 /* 分割ありの親ロットにぶら下がる子ロット(§9.83)。時間を持たない明細行
    なので、タイムラインの並びからは外して親の下へ畳む。ここで混ぜると
    並べ替えの対象にも数えられてしまう(サーバーは親だけを受け付ける)。 */
 function childEntriesByParent(){
  const map=new Map();
  scState.entries.forEach(e=>{
   if(e.parentId==null)return;
   if(!map.has(e.parentId))map.set(e.parentId,[]);
   map.get(e.parentId).push(e);
  });
  return map;
 }
 function visibleEntries(){
  const list=scState.entries.filter(e=>{
   if(e.parentId!=null)return false;
   if(e.state==='完了'||e.state==='取消')return withinHistory(e);
   return true;
  });
  // 時刻の無い行(展開しきれなかった予定など)は末尾へ寄せて順序を保つ
  const rows=list.map((e,i)=>({e,i,t:rowTimeOf(e)}));
  /* **位置を指定して入れた行は、その位置のまま出す**(§9.196、利用者の指摘
     「位置を指定しても一旦一番下に挿入データの処理中の表示が出てしまう」)。
     楽観的追加の行はまだ予定時刻を持たないので、時刻順に並べると必ず末尾へ
     落ちる——これが「一番下に出る」の理由。**入れる相手(before)の時刻を
     借りて**その手前に置く（同着は配列の並びで解け、insertEntriesAtが
     相手の直前へ入れてある）。
     **借りるのは行き先を指定したときだけ。** 位置を指定していない追加は
     今までどおり末尾（相手が無いので、隣の行から借りると配列の並びが
     時刻順とは限らない場面——計画外実績が後ろに付く等——で見当違いの
     位置へ飛ぶ。実際に test_wkfast がそれを捕まえた）。 */
  const byId=new Map(rows.map(r=>[String(r.e.id),r]));
  rows.forEach(r=>{
   if(r.t!==null||!r.e.__pending||!r.e.__beforeId)return;
   const ref=byId.get(String(r.e.__beforeId));
   if(ref&&ref.t!==null)r.t=ref.t;
  });
  /* まとめ(日付・勤務)も同じ束へ入るように、借りた時刻を行にも残す。
     残さないと、反映中の行だけ「日付未定」の箱が1つできる。 */
  rows.forEach(r=>{if(r.e.__pending&&r.t!==null)r.e.__nearT=r.t;else if('__nearT' in r.e)delete r.e.__nearT});
  return rows
   .sort((a,b)=>{
    if(a.t===null&&b.t===null)return a.i-b.i;
    if(a.t===null)return 1;
    if(b.t===null)return -1;
    return a.t===b.t?a.i-b.i:a.t-b.t;
   })
   .map(x=>x.e);
 }

 /* ---------- まとめ方(§9.40) ----------
    **日付は「現場歴」と「太陽暦」の2通り**(§9.198、利用者の指示)。列と同じで
    （§9.197の`__date__`/`__caldate__`）、既定は現場歴のまま——3直のように
    日を跨ぐ勤務が2日に割れないのが現場歴の値打ちで、既定を変えると
    わざわざ選んでいない人の見え方が変わる。
    **どちらでまとめているのかを名前に書く**こと。以前は「日付ごと」としか
    書いておらず、出ている日付が現場歴なのか暦なのか画面から分からなかった
    （同じ「8/18」でも意味が違うので、推測させてはいけない）。 */
 /* `short`は畳んだ入口(#scViewMenuBtn)へ出す要約(§9.199)。**基準(現場歴/
    太陽暦)は落とさない**——そこが分からないのが§9.198で直した問題そのもの。 */
 const SC_GROUP_MODES=[
  {key:'none',label:'まとめない',short:'まとめなし'},
  {key:'date',label:'日付ごと（現場歴）',short:'日付(現場歴)',basis:'work'},
  {key:'caldate',label:'日付ごと（太陽暦）',short:'日付(太陽暦)',basis:'cal'},
  {key:'shift',label:'勤務ごと',short:'勤務'},
  {key:'dateshift',label:'日付＋勤務ごと（現場歴）',short:'日付+勤務(現場歴)',basis:'work'},
  {key:'caldateshift',label:'日付＋勤務ごと（太陽暦）',short:'日付+勤務(太陽暦)',basis:'cal'},
  {key:'category',label:'区分ごと',short:'区分'},
 ];
 const SC_BASIS_LABEL={work:'現場歴',cal:'太陽暦'};
 /* いまのまとめ方が日付のどちらを見ているか（'work'/'cal'/''）。 */
 function groupBasis(){
  return (SC_GROUP_MODES.find(m=>m.key===(scState.groupMode||'none'))||{}).basis||'';
 }
 const SC_GROUP_KEY='ScheduleGroupModeV1';
 function loadGroupMode(){
  try{
   const v=localStorage.getItem(SC_GROUP_KEY);
   if(SC_GROUP_MODES.some(m=>m.key===v))return v;
  }catch(err){WL.quiet.note('保存値が壊れていても既定で続行する',err)}
  return 'none';
 }
 function dateBucketLabel(e){
  /* **現場歴の日付でまとめる**(§9.195)。暦の日付でまとめると、3直のように
     日を跨ぐ勤務が「8/18 3直」と「8/19 3直」の2つに割れる（同じ1回の勤務
     なのに）。行に出ている日付と同じものを使うので、見出しと行が食い違わない。 */
  const w=fmtWorkDateTitle(e&&e.workDate);
  if(w)return w;
  /* 反映中の行は隣から借りた時刻でまとめる(§9.196)。借りないと「追加中」の
     行だけ「日付未定」の箱が1つでき、入れた位置から離れて見える。 */
  const t=rowTimeOf(e);
  const use=t===null?((e&&e.__nearT)||null):t;
  return use===null?'日付未定':fmtDateTitle(new Date(use).toISOString());
 }
 /* 暦の日付でまとめる箱(§9.198)。現場歴と違い、**日を跨ぐ勤務は2日に割れる**
    ——それがこちらを選ぶ理由（外へ出す資料は暦のままであってほしい）。 */
 function calDateBucketLabel(e){
  const t=rowTimeOf(e);
  const use=t===null?((e&&e.__nearT)||null):t;
  return use===null?'日付未定':fmtDateTitle(new Date(use).toISOString());
 }
 function groupBucketOf(e){
  if(scState.groupMode==='date'||scState.groupMode==='caldate'){
   const v=scState.groupMode==='caldate'?calDateBucketLabel(e):dateBucketLabel(e);
   return {key:v,label:v};
  }
  if(scState.groupMode==='shift'){
   const v=e.shift||'';
   return {key:v||'-',label:v||'勤務未設定'};
  }
  if(scState.groupMode==='dateshift'||scState.groupMode==='caldateshift'){
   // 日付が変わっても勤務名が同じ(1直→1直)場合に同じまとまりへ吸われないよう、
   // キーは日付と勤務の組で作る。3直のような日跨ぎ勤務でも、行の代表時刻の
   // 日付でまとまるため見出しと行の日付が食い違わない。
   const d=scState.groupMode==='caldateshift'?calDateBucketLabel(e):dateBucketLabel(e);
   const v=e.shift||'勤務未設定';
   return {key:d+'\u0001'+v,label:`${d} ${v}`};
  }
  if(scState.groupMode==='category'){
   const c=categoryOf(e);
   return {key:c.key,label:c.label};
  }
  return null;
 }
 function groupHeadHtml(label,count){
  /* **どちらの日付でまとめた見出しなのかを書く**(§9.198)。同じ「8/18」でも
     現場歴と太陽暦では入る行が違うので、見出しだけを見て判断できるように
     する（設定は画面の上にあるが、行を追っている目は下にある）。 */
  const b=SC_BASIS_LABEL[groupBasis()]||'';
  return `<div class="sc-group-head"><span class="sc-group-label">${esc(label)}</span>`
   +(b?`<span class="sc-group-basis" title="この日付は${esc(b)}で数えています（まとめ方で切り替えられます）">${esc(b)}</span>`:'')
   +`<span class="sc-group-count">${count}件</span></div>`;
 }

/* 内容の列数はマスタ次第で変わるので、**グリッドの定義も一緒に作り直す**。
   CSSは`--sc-content-cols`を差し込むだけにしてあり、他の11列は固定のまま。
   幅の指定が無い項目は`minmax(...,1fr)`で残りを分け合う(1つも無いと
   タイムラインが右端まで伸びない)。 */
 function applyTimelineContentColumns(timeline){
  const t=timelineTarget();
  const keys=timelineColumnKeys();
  const defW=k=>{const d=SC_COL_MAP.get(k);return d?d.w:110};
  const track=k=>{
   const w=t?WL.columnLayout.width(t,k):null;
   if(w)return `${w}px`;
   /* 幅の指定が無い列は既定の幅。内容欄だけは残りを分け合って伸びる
      （1つも伸びる列が無いとタイムラインが右端まで届かない）。 */
   return scIsFixedCol(k)?`calc(${defW(k)}px * var(--ui-scale))`
                         :'minmax(calc(110px * var(--ui-scale)),1fr)';
  };
  const cols=keys.map(track);
  /* ---------- 余りは「空の1本」が受ける（§9.209 ①、利用者の指摘） ----------
     以前は「伸びる列が1つも無いときは最後の列を`minmax(w,1fr)`にする」と
     していた。表が右端で切れないようにするための細工だったが、**その列だけ
     幅を狭められなくなる**——器の余りを引き受けてしまうので、掴んで細くしても
     その場で戻る（「列幅の合計が表示エリアより狭いと、それ以上狭められない」）。
     余りは**セルを持たない1本**に受けさせる。列そのものは増えないので、
     見出しとセルが同じ定義を共有している土台は崩れない。 */
  cols.push('1fr');
  timeline.style.setProperty('--sc-cols',cols.join(' ')||'1fr');
  /* **いまどの設備を描いてあるかを刻む**（§9.237）。`columnEffWidthPx()`は
     「画面で実際に何px出ているか」を測って紙へ渡すが、`withEquipment()`で
     他設備へ成り代わっている最中に測ると**目の前の設備の幅を別の設備の紙へ
     当てて**しまう。刻んでおけば、その場合は測らずに保存値へ落とせる。 */
  timeline.dataset.equipment=String(scState.equipment||'');
  /* 1列目(ハンドル)は、まとめて動かせる／外せる場面だけチェックを抱える
     ぶん広げる(§9.170)。**列を1本足さない**——`grid-template-columns`を
     2通り書くと、見出しと行で片方だけ直した状態が作れてしまう(この表は
     見出しとセルが同じ定義を共有しているのが土台)。 */
  const pickable=canPickEntries();
  timeline.classList.toggle('sc-pickable',pickable);
  /* 最小幅は**いま効いている幅の合計**（§9.209 ①）。既定幅の合計で
     決めていたため、列を細くしても行の下限が下がらず、**余ったぶんが
     列へ配り直されて狭めた幅が戻っていた**。利用者が決めた幅があれば
     そちらで数える。 */
  const eff=k=>{const w=t?WL.columnLayout.width(t,k):null;return w||defW(k)};
  const min=keys.reduce((a,k)=>a+eff(k)+4,0)+(pickable?38:18);
  timeline.style.setProperty('--sc-row-min',`calc(${Math.max(360,min)}px * var(--ui-scale))`);
 }

 /* ---------- 見出しの操作は一覧とまったく同じ道具を使う(§9.176) ----------
    掴んで並べ替え／右端の取っ手で幅／右クリックでメニュー。**書き写さない**
    こと(§9.164)——同じ処理を一覧ごとに持つと、直したときに片方だけ直った
    状態になる。違うのは「引いている最中の見せ方」だけで、この表はCSS
    グリッドなので`--sc-cols`を組み直す。
    保存先は`timeline:<設備名>`で、仕掛一覧・データ一覧と同じ列レイアウト
    マスタ。**保存は全置換**なので、触っていない設定(表示名・書式・読み替え)も
    一緒に送ること(§9.113)。
    **並べ替えの対象は「隠している列も含めた全列の並び」**——見えている
    列だけで並びを作ると、隠した列の位置が保存のたびに失われる(§9.110で
    仕掛一覧が踏んだのと同じ罠)。
    **並び替えはできても並べ替え(ソート)は持たない**——スケジュールの行の
    並びは時刻の一本道(§9.39)で、利用者が並べ替えると予定の意味が変わる。 */
 /* ---------- 見出しの複数選択(§9.177) ----------
    列を1本ずつ動かすのは、5本まとめて右へ寄せたいときに5回同じ操作を
    することになる。**選んでからまとめて動かせる**ようにする(仕掛一覧の
    まとめてD&D・§9.170と同じ考え方)。**選び方は文字で書く**——Ctrlや
    Shiftを押しながら、と知っていないと使えない機能は無いのと同じなので、
    見出しの帯に案内を出す。 */
 const scColPicked=new Set();
 let scColAnchor='';
 function timelineDragKeys(key){
  if(scColPicked.size>=2&&scColPicked.has(key))
   return timelineOrderedKeys().filter(k=>scColPicked.has(k));
  return [key];
 }
 function scColPickHint(){
  const el=document.getElementById('scColPickHint');
  if(!el)return;
  const n=scColPicked.size;
  el.hidden=!n;
  if(n)el.textContent=`${n}列を選択中（そのままドラッグでまとめて移動／Escで解除）`;
 }
 function clearColPick(){
  if(!scColPicked.size)return;
  scColPicked.clear();scColAnchor='';
  document.querySelectorAll('.sc-row-head [data-col].is-picked')
          .forEach(x=>x.classList.remove('is-picked'));
  scColPickHint();
 }
 function toggleColPick(key,ev){
  const order=timelineColumnKeys();
  if(ev.shiftKey&&scColAnchor&&order.includes(scColAnchor)){
   const a=order.indexOf(scColAnchor),b=order.indexOf(key);
   if(a>=0&&b>=0)order.slice(Math.min(a,b),Math.max(a,b)+1).forEach(k=>scColPicked.add(k));
  }else if(scColPicked.has(key)){scColPicked.delete(key)}
  else{scColPicked.add(key);scColAnchor=key}
  document.querySelectorAll('.sc-row-head [data-col]').forEach(x=>{
   x.classList.toggle('is-picked',scColPicked.has(x.dataset.col));
  });
  scColPickHint();
 }
 /* ---------- 行の右クリック（§9.207、利用者の指示「右クリックメニューに
    操作と同等の機能を実装し…充実させてください」） ----------
    操作の列は**普通の列**になった（右端へ貼り付けるのをやめた）ので、
    その列を隠している人にも同じ道が要る。**並べるのは「いまできること」
    だけ**（§4。押せるのに何も起きない項目を残さない）。**危ない操作は
    下へ離す**（§5。「完了」の隣に「削除」を置かない）。
    見た目は見出しの右クリックと同じ`.col-head-menu`を使い回す
    ——2つの流儀を覚えさせない。 */
 let scRowMenuEl=null;
 function closeRowMenu(){if(scRowMenuEl){scRowMenuEl.remove();scRowMenuEl=null}}
 function openRowMenu(ev,title,note,items){
  closeRowMenu();
  const list=items.filter(Boolean);
  if(!list.length)return;
  const m=document.createElement('div');
  m.className='col-head-menu sc-row-menu';
  scRowMenuEl=m;
  m.innerHTML=`<div class="chm-head" title="${esc(title)}">${esc(title)}</div>`
   +(note?`<div class="chm-label">${esc(note)}</div>`:'')
   /* **できない項目も並べて理由を書く**（§4／§9.220 2①）。メニューから
      消すと「そもそも無い機能」と読まれ、いま何が邪魔しているのかが
      分からない。理由は`note`に入れ、`title`だけでなく本文にも出す
      ——ツールチップは触らないと読めない。 */
   +list.map((it,i)=>it.sep?'<div class="chm-sep"></div>'
     :`<button type="button" data-i="${i}"${it.disabled?' disabled':''}`
      +`${it.danger?' class="chm-danger"':''}`
      +`${it.note?` title="${esc(it.note)}"`:''}>${esc(it.label)}`
      +`${it.disabled&&it.note?`<small class="chm-why">${esc(it.note)}</small>`:''}</button>`).join('');
  document.body.append(m);
  const w=m.offsetWidth,h=m.offsetHeight;
  m.style.left=`${Math.max(6,Math.min(ev.clientX,innerWidth-w-6))}px`;
  m.style.top=`${Math.max(6,Math.min(ev.clientY,innerHeight-h-6))}px`;
  m.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>{
   const it=list[Number(b.dataset.i)];
   if(it&&it.disabled)return;
   closeRowMenu();
   if(it&&it.run)it.run();
  });
 }
 document.addEventListener('mousedown',ev=>{
  if(scRowMenuEl&&!ev.target.closest('.sc-row-menu'))closeRowMenu();
 },true);
 document.addEventListener('keydown',ev=>{if(ev.key==='Escape')closeRowMenu()},true);
 /* **どの行のメニューかを頭に出す**——右クリックは行の上で開くが、開いた
    メニューは行を覆うので、押す時点で対象が見えなくなる。 */
 function scRowMenuTitle(e){
  if(e.kind==='作業')return String(e.lotNo||e.title||'予定').trim()||'予定';
  return nonWorkTitleText(e,'申し送り');
 }
 function scRowMenuNote(e){
  return [e.kind==='作業'?'':e.kind,e.state,e.unplanned?'計画外':''].filter(Boolean).join(' / ');
 }
 function timelineHeadMenuSource(timeline){
  return {
   keys:()=>timelineOrderedKeys(),
   label:k=>scColLabel(k),
   currentWidthOf:k=>{
    const el=timeline&&timeline.querySelector(`.sc-row-head [data-col="${CSS.escape(k)}"]`);
    return el?Math.round(el.getBoundingClientRect().width):0;
   },
   refresh:()=>renderTimeline(),
   openPanel:()=>openContentPanel(),
   /* **既定で畳んでいる列も「隠している」に数える**(§9.197)。保存値の
      hiddenだけを見ると、右クリックで1列隠した拍子に監査4列と
      日付(太陽暦)が一緒に出てしまう。 */
   hiddenOf:()=>timelineHiddenSet(),
  };
 }
 /* **触った項目だけを送る**(§9.212 ②③)。渡さない設定はサーバー側で
    そのまま残るので、幅を引いただけで計算式や並べ替えが消えることはない。
    **触った時点で既定を書き下ろす**(§9.173と同じ約束)——保存する並びには
    既定で出さない列も入るので、そのとき`hidden`を保存値のままにすると
    「畳んでいたはずの列」が出てしまう（実際にそうなった）。いま画面に
    出ていない列をそのまま`hidden`として書く。 */
 async function persistTimelineColumns(target,patch){
  try{
   await WL.columnLayout.patch(target,{order:timelineOrderForSave(),
                                       hidden:[...timelineHiddenSet()],...patch});
  }catch(e){showToast&&showToast('列の設定を保存できませんでした',e.message,5000)}
 }
 function bindTimelineHeadTools(timeline){
  const target=timelineTarget();
  if(!target)return;
  const heads=[...timeline.querySelectorAll('.sc-row-head [data-col]')];
  if(!heads.length)return;
  /* **消えた列のキーを持ち続けないこと**——隠した列を選んだまま残すと、
     件数だけが合わない(§9.170の行の選択と同じ約束)。 */
  const alive=new Set(heads.map(h=>h.dataset.col));
  [...scColPicked].forEach(k=>{if(!alive.has(k))scColPicked.delete(k)});
  scColPickHint();
  /* ---------- 控えは束縛しない（§9.211 ①、利用者の指摘） ----------
     以前はここで`const layout=WL.columnLayout.get(target)`と**束縛**し、
     preview/commit/reset がその写しを綴じ込みで使っていた。`save()`は
     キャッシュを**新しいオブジェクトへ差し替える**（§9.113）ので、
     1回保存した時点でこの写しは**キャッシュから外れた孤児**になる。
     すると2回目以降のドラッグは:
       - preview が孤児の`widths`を書き換える → 描画側
         （`applyTimelineContentColumns`）が読むのはキャッシュなので
         **掴んだ列が動かない**
       - そのうえ`applyTimelineContentColumns()`が保存済みの幅で
         組み直すので、**掴んでいない列が「戻される」ように動く**
     という、実機で報告されたとおりの壊れ方になる。
     **毎回`live()`で取り直す。** 束縛を復活させないこと。 */
  const live=()=>WL.columnLayout.get(target);
  /* 掴んでいる列。**複数選んでいればまとめて動かす**(§9.177) */
  let dragKeys=null;
  const clearMarks=()=>heads.forEach(x=>x.classList.remove('col-drop-before','col-drop-after'));
  heads.forEach(h=>{
   const key=h.dataset.col;
   h.classList.toggle('is-picked',scColPicked.has(key));
   h.addEventListener('dragstart',e=>{
    dragKeys=timelineDragKeys(key);
    dragKeys.forEach(k=>{
     const el=timeline.querySelector(`.sc-row-head [data-col="${CSS.escape(k)}"]`);
     if(el)el.classList.add('col-dragging');
    });
    try{e.dataTransfer.setData('text/plain',dragKeys.join('\n'));e.dataTransfer.effectAllowed='move'}catch(_){WL.quiet.note('掴んだ印を渡せない（押す道は残る）',_)}
   });
   h.addEventListener('dragend',()=>{
    dragKeys=null;
    heads.forEach(x=>x.classList.remove('col-dragging'));
    clearMarks();
   });
   h.addEventListener('dragover',e=>{
    if(!dragKeys||dragKeys.includes(key))return;
    e.preventDefault();e.stopPropagation();
    const r=h.getBoundingClientRect(),after=(e.clientX-r.left)>r.width/2;
    h.classList.toggle('col-drop-after',after);
    h.classList.toggle('col-drop-before',!after);
   });
   h.addEventListener('dragleave',()=>h.classList.remove('col-drop-before','col-drop-after'));
   h.addEventListener('drop',e=>{
    if(!dragKeys||dragKeys.includes(key))return;
    e.preventDefault();e.stopPropagation();
    const r=h.getBoundingClientRect(),after=(e.clientX-r.left)>r.width/2;
    const moving=dragKeys.slice();
    const order=timelineOrderedKeys().filter(k=>!moving.includes(k));
    const at=order.indexOf(key);if(at<0)return;
    order.splice(after?at+1:at,0,...moving);
    /* **畳んでいる列は書き換える前に控える**(§9.197)。並びを先に書き換えて
       しまうと、そのあとでは「一度も保存していない端末」の既定
       （監査4列・日付(太陽暦)を畳む）が分からなくなる。 */
    const hidden=[...timelineHiddenSet()];
    /* 保存を待たずに画面へ当てる（§9.90 stage）。**キャッシュそのものへ
       当てること**——孤児の写しへ書くと、直後の`renderTimeline()`は
       古い並びで描き、保存が届いてから飛ぶ。 */
    WL.columnLayout.hold(target,{order});
    persistTimelineColumns(target,{order,hidden})
     .finally(()=>WL.columnLayout.release(target));
    renderTimeline();
   });
   /* 右クリックのメニュー(隠す・幅・隠した列を戻す・設定を開く)。
      **一覧と同じ関数**を呼ぶ(§9.164)。 */
   h.addEventListener('contextmenu',e=>{
    e.preventDefault();
    WL.openColumnHeaderMenu(e,key,target,null,timelineHeadMenuSource(timeline));
   });
   /* Ctrl/⌘・Shiftを押しながらで複数選択。**素のクリックは解除**——
      選んだつもりのない選択が残り続けるほうが厄介。 */
   h.addEventListener('click',e=>{
    if(e.target.classList.contains('col-resize'))return;
    if(e.ctrlKey||e.metaKey||e.shiftKey){e.preventDefault();toggleColPick(key,e)}
    else clearColPick();
   });
   const grip=h.querySelector('.col-resize');
   if(!grip)return;
   WL.columnWidthGrip(grip,{
    locked:WL.columnLayout.locked(target,key),
    /* **今そこに在る見出しから測る**。表が組み直されると`h`は外れた要素に
       なり、幅が0になる（幅が下限へ飛ぶ原因）。キーで引き直す。 */
    startWidth:()=>{
     const live=timeline.querySelector(`.sc-row-head [data-col="${CSS.escape(key)}"]`)||h;
     return live.getBoundingClientRect().width;
    },
    /* **引いている幅がそのまま「今の幅」**（利用者の指示「今動かしている
       列幅が正」）。キャッシュへ当ててから描くので、引いている最中に
       表が組み直されても幅は戻らない。保存はしない（`stage`）。 */
    preview:w=>{const cur=live();
                WL.columnLayout.hold(target,{widths:{...(cur.widths||{}),[key]:w}});
                applyTimelineContentColumns(timeline)},
    commit:w=>{const cur=live();
               persistTimelineColumns(target,{widths:{...(cur.widths||{}),[key]:w}})
                .finally(()=>WL.columnLayout.release(target))},
    reset:()=>{const cur=live();
               const widths={...(cur.widths||{})};delete widths[key];
               WL.columnLayout.hold(target,{widths});
               applyTimelineContentColumns(timeline);
               persistTimelineColumns(target,{widths,locks:(cur.locks||[]).filter(k=>k!==key)})
                .finally(()=>WL.columnLayout.release(target))},
   });
  });
 }

 /* ---------- カーソル位置へ予定を入れる(§9.179) ----------
    仕掛一覧を畳んで「スケジュールだけ」で見ているときは、ドラッグで入れる
    相手が画面に無い。**行と行のあいだにカーソルを置くと隙間が開き**、そこを
    押せば入れる相手を選べる、という形にする。
      クリック        … 仕掛一覧のモーダル（ロットを選ぶ）
      ダブルクリック  … 設備停止のモーダル
    **隙間には何ができるかを書く**——「押せるが何が起きるか分からない」
    空白を作らない。入れる位置は`scState.insertBefore`が覚え、追加のときに
    `position:'before:<予定ID>'`としてサーバーへ渡す(§9.179。画面で足して
    から並べ替えAPIを叩くと、2往復のあいだに別のPCの変更が挟まる)。 */
 let insertGhostEl=null;
 /* 位置を決めて相手を選んでいる最中は**隙間を固定する**(§9.179改訂。利用者の
    指示「ゴーストは消さずに差し込まれる位置を仕掛表が開いている間表示して
    どこに差し込まれるかわかるように」)。固定していないと、モーダルへ手を
    伸ばした時点でカーソルが表から外れ、どこへ入るのか分からなくなる。 */
 let insertPinned=false;
 let insertClickTimer=null;
 function ensureInsertGhost(){
  if(insertGhostEl)return insertGhostEl;
  const g=document.createElement('div');
  g.className='sc-insert-ghost';g.id='scInsertGhost';
  /* **行の流れへ挟まない**(§9.196、利用者の指摘)。以前は隙間そのものを
     行として差し込んでいたため、カーソルを動かすたびに下の行が1行ぶん
     上下し、鍵の印・詳細・削除のボタンを押そうとすると逃げていった。
     今は器の座標に**浮かせて**置き、下の行は動かさない——「どこへ入るか」
     は境目の帯で示し、何ができるかは説明の吹き出しで言う。 */
  g.innerHTML='<span class="sc-insert-line"></span><span class="sc-insert-tip"></span>';
  /* **クリックとダブルクリックを分ける**(利用者の指摘「クリックでもダブル
     クリックでも仕掛表が開きました」)。clickは2回目でも飛ぶので、少し待って
     からdblclickが来ていなければ単クリックとして扱う。
       クリック       … 設備停止（メンテナンスを差し込む）
       ダブルクリック … 仕掛一覧（ロットを差し込む） */
  g.addEventListener('click',e=>{
   e.preventDefault();e.stopPropagation();
   if(insertClickTimer)return;
   insertClickTimer=setTimeout(()=>{insertClickTimer=null;openInsertPicker('stop')},260);
  });
  g.addEventListener('dblclick',e=>{
   e.preventDefault();e.stopPropagation();
   if(insertClickTimer){clearTimeout(insertClickTimer);insertClickTimer=null}
   openInsertPicker('lot');
  });
  insertGhostEl=g;
  return g;
 }
 /* 隙間の文字。**今できることを書き換える**——位置を決めたあとは「ここへ
    入ります」と言い、次にする操作(一覧の行をダブルクリック／ドロップ)を指す。 */
 function insertGhostLabel(){
  renderStopWhere();      // 設備停止の帯にも同じ位置を出す(§9.181)
  const g=insertGhostEl;if(!g)return;
  const tip=g.querySelector('.sc-insert-tip');if(!tip)return;
  /* **どこへ入るのかを、固定する前から言う**——固定後しか出さないと、
     押す前に確かめられない。固定前は帯の位置(dataset)が正。 */
  const refId=insertPinned?scState.insertBefore:((g.dataset.beforeId)||'');
  const where=refId
   ?`${pickedLotOf(pickableEntry(refId))||'この行'}の前`:'いちばん後ろ';
  /* 案内を切っているときは**線だけ**にする(§9.197)。ただし位置を固定した
     あとは出す——「やめる」がここにしか無く、押した結果を確かめる先も
     ここだけなので、切ってよい案内とは別のもの。 */
  const quiet=!scLayout.tip&&!insertPinned;
  g.classList.toggle('is-quiet',quiet);
  tip.hidden=quiet;
  if(quiet){tip.innerHTML='';return}
  tip.innerHTML=insertPinned
   ?`<span class="sc-insert-mark">▼</span>`
    +`<span class="sc-insert-text">ここへ入ります（${esc(where)}）`
    +`<small>仕掛一覧の行を<b>ダブルクリック</b>、またはこの位置へ<b>ドロップ</b></small></span>`
    +`<button type="button" class="sc-insert-cancel" title="この位置を解除します">やめる</button>`
   :`<span class="sc-insert-mark">＋</span>`
    +`<span class="sc-insert-text">ここへ入れる（${esc(where)}）`
    +'<small><b>クリック</b>: 設備停止／<b>ダブルクリック</b>: 仕掛から選ぶ</small></span>';
  const cancel=tip.querySelector('.sc-insert-cancel');
  if(cancel)cancel.onclick=e=>{e.stopPropagation();clearInsertPin()};
 }
 function hideInsertGhost(force){
  if(insertPinned&&!force)return;
  if(insertGhostEl&&insertGhostEl.parentNode)insertGhostEl.remove();
 }
 /* 位置の固定をやめる。**モーダルを閉じたら必ず通る**——固定したままにすると、
    次に普通に追加したものが思い出しもしない位置へ入る。 */
 function clearInsertPin(){
  if(!insertPinned&&!scState.insertBefore)return;
  insertPinned=false;scState.insertBefore='';
  renderStopWhere();
  if(insertGhostEl)insertGhostEl.classList.remove('is-pinned');
  hideInsertGhost(true);
 }
 /* 入れる位置の目安。**動かせる予定(未着手)の行だけ**が相手——着手・完了の
    あいだに入れても並びは変わらないので、そこには隙間を出さない。
    ゴースト自身は数に入れない(入れると自分の位置で自分の位置が決まる)。 */
 /* ---------- 当たり判定は「境目のそば」だけ(§9.199、利用者の指摘) ----------
    以前は行のどこにカーソルがあっても**いちばん近い境目**の帯を出していた
    ため、行の真ん中を指しても帯と吹き出しが出て、**行そのものを掴んで
    並べ替えられなかった**（吹き出しは押せる＝下の行のドラッグを食う）。
    帯を出すのは境目から上下`insertEdgeBand()`pxまでで、それ以外は行のもの
    ——**行の中央は掴む場所**として空けておく。
    幅は行の高さから作る（行間を詰めても、表示サイズを上げても比が保たれる。
    直値のpxは表示サイズに追随しない・§9.127）。 */
 function insertEdgeBand(h){
  return Math.max(6,Math.min(10,Math.round((h||0)/4)));
 }
 function insertSlotAt(clientY,edgeOnly){
  const tl=$('#scTimeline');if(!tl)return null;
  const rows=[...tl.querySelectorAll('.sc-row-line')].filter(r=>reorderableEntry(r.dataset.id));
  if(!rows.length)return null;
  /* 一覧の下の余白(§9.292 ②)は**まるごと「いちばん後ろ」の的**。
     最後の行の下端より下（＝余白の中）はここで答える——行と行のあいだの
     判定（§9.199の±8px）はそのままなので、行の中央は掴めるまま。 */
  const lastRow=rows[rows.length-1];
  const tail=tailSpaceRect();
  if(tail&&clientY>=tail.top&&clientY<=tail.bottom)
   return {beforeId:'',row:lastRow,after:true};
  if(edgeOnly){
   /* 行の上端＝その行の前の境目。連続する行では下の行の上端が兼ねるので、
      これで内側の境目は全部見られる。最後の1本だけ下端で見る。 */
   for(const r of rows){
    const b=r.getBoundingClientRect();
    if(Math.abs(clientY-b.top)<=insertEdgeBand(b.height))return {beforeId:String(r.dataset.id),row:r};
   }
   const lb=lastRow.getBoundingClientRect();
   if(Math.abs(clientY-lb.bottom)<=insertEdgeBand(lb.height))
    return {beforeId:'',row:lastRow,after:true};
   return null;
  }
  /* 掴んで運んでいる最中は**いちばん近い境目**へ寄せる(今までどおり)。
     落とす先を探しているので、境目を狙わせるのは酷。 */
  for(const r of rows){
   const b=r.getBoundingClientRect();
   if(clientY<b.top+b.height/2)return {beforeId:String(r.dataset.id),row:r};
  }
  return {beforeId:'',row:rows[rows.length-1],after:true};
 }
 /* 下の余白の矩形（無ければnull）。**高さ0のときは的にしない**
    ——`fitTailSpace()`が0にするのは行が1つも無いときなので、
    そこを「いちばん後ろ」と答えても入れる相手が居ない。 */
 function tailSpaceRect(){
  const sp=document.getElementById('scTailSpace');
  if(!sp)return null;
  const r=sp.getBoundingClientRect();
  return r.height>1?r:null;
 }
 /* 境目の座標(器の中のy)。**器はスクロールするので scrollTop を足す**
    ——足さないと、少しスクロールしただけで帯が別の行の境目に出る。 */
 function insertTopFor(row,after){
  const tl=$('#scTimeline');if(!tl)return 0;
  const b=row.getBoundingClientRect(),t=tl.getBoundingClientRect();
  return Math.max(0,(after?b.bottom:b.top)-t.top+tl.scrollTop);
 }
 /* 説明の吹き出しが**操作の列にかからない**ようにする(§9.196、利用者の指示)。
    操作列の左端までを上限の幅にして、はみ出すぶんは畳む。列を隠している
    ときは上限を置かない（かぶる相手が無い）。 */
 function insertTipLimit(){
  const tl=$('#scTimeline');if(!tl)return '';
  const cell=tl.querySelector('.sc-row-line [data-col="__actions__"]')
           ||tl.querySelector('.sc-row-head [data-col="__actions__"]');
  if(!cell)return '';
  const r=cell.getBoundingClientRect(),t=tl.getBoundingClientRect();
  const w=Math.round(r.left-t.left+tl.scrollLeft-16);
  return w>120?w+'px':'';
 }
 /* **浮かせて置く**(§9.196)。行の流れへ挟むと、カーソルを動かすたびに
    下の行が上下してボタンが押せない（利用者の指摘）。境目に帯を出すだけに
    して、表そのものは1pxも動かさない。 */
 function placeInsertGhost(slot){
  const tl=$('#scTimeline');if(!tl)return;
  const g=ensureInsertGhost();
  g.dataset.beforeId=slot.beforeId;
  if(g.parentNode!==tl)tl.appendChild(g);
  g.style.top=insertTopFor(slot.row,!!slot.after)+'px';
  const lim=insertTipLimit();
  if(lim)g.style.setProperty('--sc-tip-max',lim);else g.style.removeProperty('--sc-tip-max');
  insertGhostLabel();
 }
 /* 描き直しで隙間ごと消えるので、固定しているときは同じ位置へ戻す。 */
 function restoreInsertGhost(){
  if(!insertPinned)return;
  const tl=$('#scTimeline');if(!tl)return;
  const id=scState.insertBefore;
  const rows=[...tl.querySelectorAll('.sc-row-line')].filter(r=>reorderableEntry(r.dataset.id));
  if(!rows.length){clearInsertPin();return}
  const ref=id?rows.find(r=>String(r.dataset.id)===String(id)):null;
  const g=ensureInsertGhost();
  g.classList.add('is-pinned');
  placeInsertGhost(ref?{beforeId:String(ref.dataset.id),row:ref}
                      :{beforeId:'',row:rows[rows.length-1],after:true});
 }
 function updateInsertHintUi(){
  const on=scheduleOnlyView();
  const tl=$('#scTimeline');
  if(tl)tl.classList.toggle('sc-insertable',on);
  if(!on&&!insertPinned)hideInsertGhost(true);
  const hint=$('#scSplitHint');
  if(hint)hint.innerHTML=on
   ?'<p class="sc-drop-hint">仕掛一覧を畳んでいます。<b>行と行の境目にカーソルを置くと帯が出て</b>、'
    +'<b>クリックで設備停止</b>／<b>ダブルクリックで仕掛から選んで</b>、その位置へ入れられます。'
    +'<b>行の中央は掴む場所</b>なので、予定はそのままドラッグで並べ替えられます。'
    +'左端の帯を押すと仕掛一覧が戻り、今までどおりドラッグでも追加できます。</p>'
   :'<p class="sc-drop-hint">左の仕掛一覧からロットをドラッグ、またはチェックボックスで複数選択してこのパネルへドロップすると、この設備の予定へ追加されます。'
    +'<b>落とした位置へ差し込めます</b>（行と行のあいだに隙間が出ます）。</p>';
 }
 /* 差し込み位置を出してよい場面。**ドラッグ中は仕掛一覧を出していても出す**
    ——「一番最後でなく指定位置に差し込みたい」(利用者の指示)ため。 */
 function insertGhostAllowed(){
  return !!scState.fullControl&&scState.boardMode==='single'&&!!scState.equipment&&!sessionBlocked();
 }
 function bindInsertGhost(timeline){
  if(timeline.dataset.insertWired)return;
  timeline.dataset.insertWired='1';
  timeline.addEventListener('mousemove',e=>{
   if(insertPinned)return;      // 位置を決めたあとは動かさない
   if(!scheduleOnlyView()||sessionBlocked()||scState.dragId){hideInsertGhost();return}
   /* 帯・吹き出しの上に来たら動かさない（別の境目へ飛ぶと掴めない）。 */
   if(e.target.closest&&e.target.closest('#scInsertGhost'))return;
   /* **操作の列ではマウスオーバーに反応しない**(§9.196、利用者の指示)。
      鍵の印・詳細・削除を押そうとしているときに帯や吹き出しが出ると、
      押す先が隠れる。 */
   if(e.target.closest&&e.target.closest('[data-col="__actions__"]')){hideInsertGhost();return}
   /* **見出しの上でも出さない**(§9.197)。帯は重なり順が上(--z-popover)なので、
      先頭の行の境目に出ると**固定された見出しの取っ手を覆う**——列幅を
      掴もうとした手が帯に当たる（「うまく掴めない」の一因）。
      列幅を引いている最中も同じ理由で出さない。 */
   if(e.target.closest&&e.target.closest('.sc-row-head')){hideInsertGhost();return}
   if(document.body.classList.contains('col-resizing')){hideInsertGhost();return}
   /* **境目のそばだけ**(§9.199)。行の中央は掴む場所として空ける。 */
   const slot=insertSlotAt(e.clientY,true);
   if(!slot){hideInsertGhost();return}
   placeInsertGhost(slot);
  });
  timeline.addEventListener('mouseleave',()=>hideInsertGhost());
 }
 /* 入れる相手を選ぶ。**位置を覚えてからモーダルを開く**——開いている
    あいだにカーソルは動くので、押した時点の位置で固定する(§9.179)。 */
 function openInsertPicker(kind){
  const g=insertGhostEl;
  scState.insertBefore=(g&&g.dataset.beforeId)||'';
  insertPinned=true;
  if(g)g.classList.add('is-pinned');
  insertGhostLabel();
  const where=scState.insertBefore
   ?`${pickedLotOf(pickableEntry(scState.insertBefore))||'選んだ行'}の前`:'いちばん後ろ';
  if(kind==='stop'){
   openStopModal();
   showToast&&showToast('設備停止を選んでください',`${where}へ入れます`,3600);
   return;
  }
  openListModal();
  showToast&&showToast('入れるロットを選んでください',
   `${where}へ入れます。行を<b>ダブルクリック</b>、ドラッグ、または複数選択して「予定へ追加」を押してください`,5000);
 }
 /* 入れる位置。**固定している間は覚えたまま**にして、続けて何件でも同じ位置へ
    入れられるようにする(先に入れたものから順に並ぶ)。固定していない場面
    (ふつうの追加)では1回使ったら忘れる——覚えたままにすると、次の追加が
    思い出しもしない位置へ入る。 */
 function takeInsertBefore(){
  const v=scState.insertBefore||'';
  if(!insertPinned)scState.insertBefore='';
  return v;
 }
 /* 仕掛一覧の行から「この位置へ入れる」(§9.179改訂)。位置を決めて開いた
    ときだけ効き、それ以外は今までどおり測定画面が開く——**文脈で意味が
    変わる操作は、その文脈が画面に出ているときだけ**にする。 */
 window.WL=window.WL||{};
 WL.scheduleInsert={
  pending:()=>!!insertPinned&&insertGhostAllowed(),
  insertRow:row=>{
   if(!insertPinned)return false;
   addRowToSchedule(row,scState.equipment);
   return true;
  },
  /* 落とした位置へ差し込む(ドラッグ中の受け皿から呼ぶ)。 */
  allowed:()=>insertGhostAllowed(),
  showAt:clientY=>{
   if(!insertGhostAllowed())return;
   const slot=insertSlotAt(clientY);
   if(!slot)return;
   insertPinned=false;                 // ドラッグ中は指に追従させる
   placeInsertGhost(slot);
  },
  takeDropTarget:()=>{
   const g=insertGhostEl;
   const before=(g&&g.parentNode&&g.dataset.beforeId)||'';
   if(!insertPinned)hideInsertGhost(true);
   return before;
  },
 };

 function renderTimeline(){
  const timeline=$('#scTimeline');
  const list=visibleEntries();
  if(!list.length){
   timeline.innerHTML=scState.entries.length
    ?`<div class="sc-empty-note">これからの予定はありません。済んだ行は「さかのぼり」で決めた過去${scState.historyHours}時間ぶんだけ出しています——もっと前まで見るには「表示」→「さかのぼり」を長くしてください。</div>`
    :'<div class="sc-empty-note">この設備の予定はまだありません。</div>';
   renderPickBar(timeline);
   renderUndecided();
   refreshScheduledLotFilter();
   return;
  }
  timeline.innerHTML='';
  // まとめない場合も含め、行は必ず.sc-groupコンテナへ入れる。並べ替え
  // (wireDrag/moveCard/commitDragOrder)はDOMの兄弟関係だけで動くため、
  // まとめた見出しを素の兄弟に挟むと行が見出しを跨いで動いてしまう。
  const buckets=[];
  list.forEach(e=>{
   const b=groupBucketOf(e);
   const key=b?b.key:'__all__';
   let last=buckets[buckets.length-1];
   if(!last||last.key!==key){last={key,label:b?b.label:'',rows:[]};buckets.push(last)}
   last.rows.push(e);
  });
  /* 列見出しは**タイムライン全体で1枚**(§9.84)。以前はまとめの箱ごとに
     入れていたため、日付＋勤務でまとめると18回も繰り返され、
     「まとめ見出し28px + 列見出し21px + 空き12px」が行と行の間に挟まって
     間隔がばらついて見えていた(行どうしは35px)。列の意味は1回説明すれば
     足りる(このファイル冒頭の高密度リストの説明どおり)。sticky なので
     スクロールしても上に残る。 */
  timeline.insertAdjacentHTML('beforeend',
   '<div class="sc-col-pick-hint" id="scColPickHint" hidden></div>'+rowHeadHtml());
  applyTimelineContentColumns(timeline);
  bindTimelineHeadTools(timeline);
  bindInsertGhost(timeline);
  updateInsertHintUi();
  const kids=childEntriesByParent();
  buckets.forEach(bucket=>{
   const box=document.createElement('div');
   box.className='sc-group';box.dataset.group=bucket.key;
   if(bucket.label)box.insertAdjacentHTML('beforeend',groupHeadHtml(bucket.label,bucket.rows.length));
   let lastEnd=null;
   bucket.rows.forEach(e=>{
    renderEntryRow(box,e,true,()=>lastEnd,v=>{lastEnd=v});
    renderChildRows(box,e,kids.get(e.id)||[]);
   });
   timeline.append(box);
  });
  appendTailSpace(timeline);
  renderPickBar(timeline);
  restoreInsertGhost();
  renderUndecided();
  openPendingCommentEdit();
  refreshScheduledLotFilter();
 }
 /* ---------- 一覧の下の余白(§9.292 ②、利用者の指示「スケジュールの下側に
    余白を常に設けておき、スクロールで最後のスケジュールも上方向に押し上げ
    られるようにして、スケジュール作成時に任意のところに追加しやすいように
    してください」) ----------
    以前は最後の行が器の下端に貼り付いており、**末尾へ入れる境目が画面の
    いちばん下**にあった——そこは`#scDropRemove`（予定から外す受け皿・§9.116）
    が出る帯でもあるので、いちばん使う「最後に足す」がいちばん狙いにくかった。

    **空けた場所には役目を持たせる**（§CLAUDE 画面基準 12。意味のない余白を
    作らない）——この帯は「ここへ落とすと、いちばん後ろに入る」の的で、
    そう書いてある（§3・§4）。的として働かせているのは`insertSlotAt()`の
    1箇所で、**行と行のあいだの当たり判定（§9.199の±8px）は広げない**
    ——広げると行の中央が掴めなくなる。

    高さは**測って決める**（§9.130）。狙いは「最後の行の上端が器の上端まで
    上がれる」ことなので、要るのは`器の高さ −（最後の行の上端から中身の
    下端まで）`。**器の高さより大きくしない**（それ以上あっても押し上がる
    量は増えず、空白だけが増える）。 */
 const TAIL_MIN_ROWS=2;         // 予定が少なくても、いつもこれだけは空ける
 function appendTailSpace(timeline){
  const box=document.createElement('div');
  box.className='sc-tail-space';box.id='scTailSpace';
  /* **何のための場所かを書く**（§4）。入れられない場面（閲覧・編集モードの
     一覧・読み取り専用）では的にならないので、案内も出さない。 */
  if(insertGhostAllowed())
   box.innerHTML='<span>この下は予定の終わりです。ここへ落とす（クリックする）と、'
    +'<b>いちばん後ろ</b>へ入ります。</span>';
  timeline.append(box);
  fitTailSpace();
  watchTailSpace();
 }
 /* 器の大きさが変わったら測り直す（窓の大きさ・仕掛一覧の開閉・表示サイズ）。
    **`renderTimeline()`だけに任せない**——どれも表を組み直さずに器の高さだけを
    変えるので、そのままだと余白が前の高さのまま残る。 */
 let tailRO=null;
 function watchTailSpace(){
  const tl=$('#scTimeline');
  if(!tl||tailRO||typeof ResizeObserver!=='function')return;
  tailRO=new ResizeObserver(()=>fitTailSpace());
  tailRO.observe(tl);
 }
 function fitTailSpace(){
  const tl=$('#scTimeline');if(!tl)return;
  const sp=tl.querySelector('.sc-tail-space');if(!sp)return;
  const rows=[...tl.querySelectorAll('.sc-row-line')];
  if(!rows.length){sp.style.height='0px';return}
  /* **測る前に必ず0へ戻す**（前回入れた高さが混ざると、描くたびに伸びる）。 */
  sp.style.height='0px';
  const last=rows[rows.length-1];
  const rowH=last.getBoundingClientRect().height||0;
  const min=Math.round(rowH*TAIL_MIN_ROWS);
  /* **収まっている一覧は帯だけ**——押し上げる必要が無いのに1画面ぶんの
     空白を置くと、2件しかない設備で画面のほとんどが空になる
     （§CLAUDE 画面基準 12「意味のない余白を作らない」）。
     溢れている一覧だけ、最後の行が上端まで上がるぶんへ伸ばす。 */
  if(tl.scrollHeight<=tl.clientHeight){sp.style.height=min+'px';return}
  const tail=Math.max(0,tl.scrollHeight-last.offsetTop);  // 最後の行の上端〜中身の下端
  const need=tl.clientHeight-tail;
  sp.style.height=Math.round(Math.max(min,Math.min(need,tl.clientHeight)))+'px';
 }
 /* 落として入れた枠を、描き終わったところで開く(§9.191)。**1回で消す**
    ——残すと、次に描き直すたびに勝手に編集へ入る。 */
 function openPendingCommentEdit(){
  const id=scState.focusComment;
  if(!id)return;
  const entry=(scState.entries||[]).find(x=>String(x.id)===String(id));
  if(!entry)return;                       // まだ反映前。次の描画で開く
  scState.focusComment=null;
  requestAnimationFrame(()=>startCommentEdit(id));
 }

 /* ---------- 「時刻未定」が残っているときの案内(§9.185) ----------
    時刻が決まらない理由は3つあり、**打つ手が違う**ので分けて言う。
      ① サーバーへ反映中(__pending) …… 待てば決まる。何もしなくてよい。
      ② 稼働カレンダーに置けない  …… カレンダー/勤務形態を直す必要がある
         （サーバーが理由をwarningsで返しているので、そちらを読ませる）。
      ③ 画面の計算が追いついていない …… 「再計算」で直る。
    以前は行に「未定」と出るだけで、**何件あるのか・押す手立てがあるのか**が
    どこにも書かれていなかった。行は下へ流れるので、上でまとめて言う。
    ボタンはヘッダーの「再計算」と同じ処理を呼ぶ（同じことをする道を2つ
    作らない）。 */
 function undecidedEntries(){
  return (scState.entries||[]).filter(e=>
   e.parentId==null&&!e.unplanned&&e.state==='予定'&&!e.plannedStart);
 }
 function renderUndecided(){
  const box=$('#scUndecided');if(!box)return;
  const all=undecidedEntries();
  if(!all.length){box.hidden=true;box.innerHTML='';return}
  const pending=all.filter(e=>e.__pending);
  const stuck=all.filter(e=>!e.__pending);
  /* 反映を待っているだけのものは案内しない（待てば決まる）。 */
  if(!stuck.length){box.hidden=true;box.innerHTML='';return}
  const calendar=(scState.warnings||[]).some(w=>String(w).includes('稼働カレンダー'));
  const names=stuck.map(e=>e.lotNo||contentValueOf(e.detail,'lotNo')||('予定'+e.id)).filter(Boolean);
  const shown=names.slice(0,5).join('・')+(names.length>5?` ほか${names.length-5}件`:'');
  const why=calendar
   ?'稼働カレンダー上に置き場所が見つかりませんでした。稼働カレンダー・勤務形態マスタを確認してください（画面の上に出ている注意書きに理由が出ています）。'
   :'追加・並べ替えの直後は、画面側の時刻が計算されないことがあります。「再計算」で計算し直せます。';
  box.hidden=false;
  box.innerHTML=`<div class="sc-undecided-main">
    <b>${stuck.length}件の予定が「時刻未定」です</b>
    <span class="sc-undecided-who" title="${esc(names.join('・'))}">${esc(shown)}</span>
    ${calendar?'':'<button type="button" class="sc-undecided-fix" id="scUndecidedFix">再計算する</button>'}
   </div>
   <small>${esc(why)}${pending.length?`（ほかに${pending.length}件がサーバーへ反映中です）`:''}</small>`;
  const fix=$('#scUndecidedFix');
  if(fix)fix.onclick=()=>refreshCurrentMode(true);
 }

 /* ---------- 子ロットのまとまり(§9.83) ----------
    親のすぐ下へ、既定は畳んだ状態で置く。**.sc-row-line にはしない**
    ——並べ替え(commitDragOrder/moveCard)はその class でDOMを走査するので、
    子を同じ class にすると並べ替えの対象に混ざり、サーバーが受け付ける
    「親だけ」の一覧と食い違って並べ替えが丸ごと通らなくなる。
    開閉は設備ごとに覚える(畳んだつもりが開き直る、の逆も煩わしい)。 */
 const CHILD_OPEN_KEY='scChildOpenV1';
 function childOpenSet(){
  try{return new Set(JSON.parse(localStorage.getItem(CHILD_OPEN_KEY)||'[]'))}
  catch(e){return new Set()}
 }
 function setChildOpen(id,open){
  const s=childOpenSet();
  open?s.add(String(id)):s.delete(String(id));
  try{localStorage.setItem(CHILD_OPEN_KEY,JSON.stringify([...s].slice(-200)))}catch(e){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',e)}
 }
 function childSummary(e){
  const d=e.detail||{};
  const bits=[];
  if(d.__childWidth!=null)bits.push(`幅${d.__childWidth}`);
  if(d.__childStrips)bits.push(`${d.__childStrips}条`);
  if(d.__childTol&&d.__childTol.plus!=null)bits.push(`+${d.__childTol.plus}/-${d.__childTol.minus}`);
  if(d.__childMissing)bits.push('仕掛に無し');
  return bits.join(' / ');
 }
 /* ---------- 子ロットの折りたたみバッジはどの列へ付けるか(§9.235 ②) ----------
    利用者の指示「子ロットのバッジの位置は、一番左固定ではなく、バッジの
    位置はどの列にも付けられるように位置を決められるようにしてください
    デフォルトはロット番号につけてください」。

    以前は`row.querySelector('.sc-row-title')`で**DOM順で最初に見つかった
    内容セル**を掴んでいた。内容の項目を並べ替えてロット番号が先頭で
    なくなっても、バッジは変わらず「たまたま先頭にある列」に付き続け、
    選んでいるつもりの無い「一番左固定」になっていた。
    **`__actions__`は候補にしない**——ボタンの並びなので、畳むつまみを
    差し込む場所として意味を持たない。 */
 function childBadgeTargetKey(){
  const keys=timelineColumnKeys().filter(k=>k!=='__actions__');
  const want=scLayout.childBadgeCol;
  if(want&&keys.includes(want))return want;
  /* **既定はロット番号**。選んでいない・選んだ列を隠したときにここへ
     落ちる（キーを保存し直す必要が無い＝空欄のままロット番号が既定）。 */
  if(keys.includes('lotNo'))return 'lotNo';
  /* それも無ければ、以前と同じ「内容欄の先頭」まで後方互換で落とす。 */
  const content=timelineContentKeys();
  const hit=content.find(k=>keys.includes(k));
  if(hit)return hit;
  return keys[0]||'';
 }
 function renderChildRows(box,parent,children){
  if(!children.length)return;
  const open=childOpenSet().has(String(parent.id));
  const wrap=document.createElement('div');
  wrap.className='sc-child-box';
  wrap.dataset.parent=parent.id;
  wrap.hidden=!open;
  /* **ロット番号は親の真下**(§9.197、利用者の指示)。以前は子ロットだけ
     3列の別のグリッドで組んでおり、同じ「ロット番号」が親では中ほど・子では
     左端に出ていた——展開するたびに桁が飛ぶので、読む側は同じ列だと思えない。
     いまは**親と同じ列定義**(`--sc-cols`)を共有し、ロット番号の列へ入れる。
     内訳(幅・条数・公差)はその右の列から端までを1つの枠として使う。 */
  const keys=timelineColumnKeys();
  const lotKey=keys.includes('lotNo')?'lotNo':(keys.find(k=>!scIsFixedCol(k))||keys[0]||'');
  const at=keys.indexOf(lotKey);
  children.forEach(c=>{
   const line=document.createElement('div');
   line.className='sc-child-line'+(c.detail&&c.detail.__childMissing?' is-missing':'');
   line.dataset.id=c.id;
   const summary=childSummary(c);
   const lotCell=`<span class="sc-child-lot" data-col="${esc(lotKey)}" title="${esc(c.lotNo||'')}">${esc(c.lotNo||'')}</span>`;
   const infoCell=n=>`<span class="sc-child-info" style="grid-column:span ${n}" title="${esc(summary)}">${esc(summary)}</span>`;
   let cells='';
   if(at<0){
    // ロット番号の列を1つも出していないとき。内訳だけを全幅で出す。
    cells=keys.length?infoCell(keys.length):'';
   }else{
    keys.forEach((k,i)=>{
     if(i<at)cells+=`<span data-col="${esc(k)}"></span>`;
     else if(i===at)cells+=lotCell;
     else if(i===at+1)cells+=infoCell(keys.length-i);
    });
    // ロット番号が最後の列なら、内訳はその手前へ回す(器が無いと消える)。
    if(at===keys.length-1&&at>0)
     cells=keys.slice(0,at).map((k,i)=>i?'':infoCell(at)).join('')+lotCell;
   }
   line.innerHTML=`<span class="sc-child-mark">└</span>`+cells;
   wrap.append(line);
  });
  box.append(wrap);
  /* 親行へ開閉のつまみを差し込む。**内容の欄(.sc-row-title)の中へ**入れる。
     - 素の兄弟として足すと1列ぶんずれて全部の行の桁が合わなくなる
       (行はグリッドで列が決まっている)。
     - 印の欄(.sc-row-flags)は幅が固定でoverflow:hiddenなので、入れても
       切られて**見えない**(実際に最初そうなった。幅は0でないので
       「出ている」と誤判定しやすい)。
     内容の欄は伸縮する唯一の列なので、つまみを縮まない要素として置き、
     文字側だけ省略記号で詰める。ロット番号のすぐ隣に出るので、
     「この行は畳んだ中身を持つ」ことが読み取りやすい。
     行のHTMLを組み立て直さずに済むよう描画後に足す(renderEntryRowは
     他の呼び出し元とも共有しているため)。 */
  const row=box.querySelector(`.sc-row-line[data-id="${CSS.escape(String(parent.id))}"]`);
  if(!row)return;
  row.classList.add('sc-row-has-children');
  /* つまみは**設定した列のセル**へ入れる(§9.235 ②)。素の兄弟として足すと
     1列ぶんずれるので、必ずどれかのセルの中に入れること。 */
  const badgeKey=childBadgeTargetKey();
  const title=(badgeKey&&row.querySelector(`[data-col="${CSS.escape(badgeKey)}"]`))
    ||row.querySelector('.sc-row-title')||row.querySelector('[data-col]');
  if(!title)return;
  /* **印はロット番号のお尻**(§9.198、利用者の指示)。以前は「▸子ロット3」を
     ロット番号の**手前**に置いていたため、①番号より先に修飾語を読まされ
     ②その分だけ番号が右へずれ ③6文字ぶんの幅を毎行占めていた。
     読む順は「どのロットか → それは親か」なので、番号を先に出して
     **お尻にバッジ**を付ける。
     **数字を出すなら名前は「子」**(§9.199、利用者の指摘)——「親3」は
     「3件の親」と読める。件数は畳んである子ロットの数なので、数字を
     添える形は`子3`、数字を出さない形は`親`。どちらにするかは
     この端末の設定(`scLayout.childBadge`)で選ぶ。
     開閉は色だけで伝えない——`▾`/`▸`の向きと`aria-expanded`を必ず添える。 */
  const btn=document.createElement('button');
  btn.type='button';
  btn.className='sc-child-toggle'+(open?' is-open':'');
  const paint=o=>{
   const count=scLayout.childBadge!=='parent';
   btn.classList.toggle('is-open',o);
   btn.classList.toggle('is-count',count);
   btn.setAttribute('aria-expanded',o?'true':'false');
   btn.title=`分割後の子ロット${children.length}件を${o?'隠す':'表示する'}`
    +(count?'':`\n（この端末の設定で件数を出していません。「表示」→「この端末の見え方」で変えられます）`);
   btn.innerHTML=count?`子<b>${children.length}</b><i>${o?'▾':'▸'}</i>`
                      :`親<i>${o?'▾':'▸'}</i>`;
  };
  paint(open);
  btn.onclick=ev=>{
   ev.stopPropagation();
   const nowOpen=wrap.hidden;
   wrap.hidden=!nowOpen;
   paint(nowOpen);
   setChildOpen(parent.id,nowOpen);
  };
  /* **中身は保ったまま包む**（`textContent`だけを写すと消える）——
     `__cat__`のような列は文字の前に印(アイコン)のHTMLを持つので、
     バッジの列をどれにでも選べるようにした以上、消してよいのは
     `.sc-row-title`（プレーンテキストの列）だけとは限らない。 */
  const text=document.createElement('span');
  text.className='sc-row-title-text';
  while(title.firstChild)text.appendChild(title.firstChild);
  title.classList.add('has-children');
  title.append(text,btn);
 }

 /* ---------- 行のセルの値は1箇所で作る(§9.176) ----------
    見出しの並び順でセルを組み立てるようになったので、**どのキーが何の値か**
    を1つの関数が答える形にする。設定パネルの見本(「この列の見え方（実データ）」)
    も同じ関数を通す——見本を別に作ると、画面には出ているのに設定画面では
    「値のある行がありません」と出る(実際にそうなった)。 */
 function entryCellInfo(e){
  const cat=categoryOf(e);
  const locked=!!e.fixedStart;
  const workable=workableOf(e);
  const wk=WORKABLE_LABEL[workable.state]||WORKABLE_LABEL.unknown;
  const wkTitle=workable.course?`${wk.title}\n残仕掛設備ｺｰｽ: ${workable.course}`:wk.title;
   // 完了・取消は予定時刻を持たない(展開対象外)ので、実績の開始/終了を出す。
  // 以前は一律「-」で、実績セクションだけ時刻が全く読めなかった。
  const useActual=(e.state==='完了')&&e.actual&&e.actual.startAt;
  const showStart=useActual?e.actual.startAt:e.plannedStart;
  const showEnd=useActual?e.actual.endAt:e.plannedEnd;
  /* 日付は**現場歴**(§9.195)。日を跨ぐ勤務の「跨いだ後」は前の日として
     数えるので、暦の日付とずれることがある。**ずれていることは必ず書く**
     ——同じ数字でも出どころが違う（黙ってずらすと時計と食い違って見える）。 */
  const workShort=fmtWorkDateShort(e.workDate);
  const shifted=!!(workShort&&e.shiftDayOffset);
  const dateText=workShort||(showStart?fmtDateShort(showStart):'-');
  const dateTitle=(workShort?fmtWorkDateTitle(e.workDate):(showStart?fmtDateTitle(showStart):''))
   +(shifted?`\n現場歴の日付です（勤務「${e.shift||''}」の日付補正 ${e.shiftDayOffset}日）。`
             +`実際の時計は ${fmtDateTitle(showStart)} ${fmtHM(showStart)}。`
            :(workShort?'':'\n勤務が決まらないため、暦の日付を出しています。'));
  /* 暦の日付(§9.197)。**現場歴とは別の列**にして、ずれているときは
     お互いの値を書き添える——同じ「日付」でも数え方が違うので、
     どちらを見ているのかが分からないと突き合わせられない。 */
  const calDateText=showStart?fmtDateShort(showStart):'-';
  const calDateTitle=(showStart?`${fmtDateTitle(showStart)} ${fmtHM(showStart)}（時計どおりの暦の日付）`:'')
   +(shifted?`\n現場歴では ${fmtWorkDateTitle(e.workDate)}（日付補正 ${e.shiftDayOffset}日）。`:'');
  // 作業中(§9.37)はまだ終わっていない。予定終了は常に現在時刻なので、
  // 終了時刻を数字で出すと「もう終わったように」見える。「継続中」と出す。
  let timeText,timeTitle;
  if(e.ongoing){
   timeText=`${fmtHM(showStart)}〜継続中`;
   timeTitle=`実績開始 ${fmtDateTime(showStart)} / 未完了のため予定終了は現在時刻`;
  }else{
   timeText=showStart?fmtTimeRange(showStart,showEnd):(e.state==='完了'||e.state==='取消'?'-':'未定');
   timeTitle=showStart?`${useActual?'実績 ':''}${fmtDateTime(showStart)} 〜 ${fmtDateTime(showEnd)}`:'';
  }
  const shiftText=e.shift||'-';
  const relText=e.ongoing
   ?'作業中'
   :(e.startsInMinutes!=null?(fmtRelative(e.startsInMinutes)||'今'):'-');
  const estText=e.estimate?WL.duration.compact(e.estimate.minutes):'-';
  /* 見積が実績由来かどうかを行の中で見分けられるようにする(§9.114)。
     **「実績」「設備の標準時間」「暫定」の3つを言い分ける**——どれも
     同じ数字に見えるが、当たるかどうかの見込みがまるで違う。 */
  const estSrc=(e.estimate&&e.estimate.source)||'';
  const estProvisional=estSrc==='equipment-standard'||estSrc==='default';
  const estNote=estimateNoteOf(estSrc);
  let actualText='-';
  if(e.actual){
   if(e.state==='着手')actualText=WL.duration.compact(e.actual.elapsedMinutes)+' 経過';
   else if(e.state==='完了'){
    const v=e.actual.varianceMinutes;
    actualText=WL.duration.compact(e.actual.minutes)+(v!=null?`(${v>=0?'+':''}${Math.round(v)})`:'');
   }
  }
  /* ---------- 行の印は「並び」で持ち、HTMLはそこから作る（§9.237） ----------
     以前はここでHTMLの文字列を直に組み立てており、印刷側は
     `SC_FIXED_TEXT['__flags__']`がタグを正規表現で剥がしてプレーンテキストへ
     戻していた。**紙にも画面と同じチップで出す**ようになったので、
     「どの印が立っているか」を1箇所で持ち、画面のHTMLも紙のチップも
     **同じ並びから作る**（書き写すと片方だけ直った状態が作れる）。
     **`固定`と同じことを2つ出さない**（§8／§9.220 2③）。`locked`は
     `!!e.fixedStart`そのものなので、以前は🔒固定と📌が必ず並んで出て
     いた。絵文字を文字へ直したら**同じ言葉が2つ**並び、112pxの列から
     溢れた（`test_fit`が検出）。片方だけ残す。 */
  const flagList=[
   e.unplanned?{cls:'unplanned',text:'計画外',title:'予定に無い実績です(仕掛一覧から直接開始した作業など)'}:null,
   locked?{cls:'locked',text:'固定',title:`固定開始 ${fmtDateTime(e.fixedStart)}`}:null,
   e.__pending?{cls:'pending',text:'追加中',title:'サーバーへ反映中です'}:null,
   e.overdueMinutes>0?{cls:'overdue',text:`+${Math.round(e.overdueMinutes)}分`,
                       title:`${Math.round(e.overdueMinutes)}分押しています`}:null,
   e.spansNonWorking?{cls:'spans',text:'夜間',title:'夜間・休日を跨ぎます'}:null,
  ].filter(Boolean);
  const flags=flagList.map(f=>
   `<span class="sc-flag sc-flag-${f.cls}" title="${esc(f.title)}">${esc(f.text)}</span>`).join('');
  /* 「誰が・どの端末で」(§9.180)。**空欄のときは`-`にする**——列に何も
     出ないと「読めていない」のか「記録が無い」のか区別が付かない。
     古い予定は端末名を持たない(列を後から足したため)ので、実際に空になる。 */
  const dash=v=>{const t=String(v==null?'':v).trim();return t||'-'};
  const createdBy=dash(e.createdBy),createdPc=dash(e.createdPc);
  const updatedBy=dash(e.updatedBy),updatedPc=dash(e.updatedPc);
  return {cat,locked,workable,wk,wkTitle,dateText,dateTitle,dateShifted:shifted,
          calDateText,calDateTitle,timeText,timeTitle,shiftText,
          relText,estText,estSrc,estProvisional,estNote,actualText,flags,flagList,
          createdBy,createdPc,updatedBy,updatedPc,
          createdAt:e.createdAt||'',updatedAt:e.updatedAt||''};
 }
 /* キー → 見せる文字。**行の組み立てと設定パネルの見本が同じ表を見る**。 */
 const SC_FIXED_TEXT={
  '__cat__':i=>i.cat.label,
  '__workable__':i=>i.wk.text,
  '__date__':i=>i.dateText,
  '__caldate__':i=>i.calDateText,
  '__time__':i=>i.timeText,
  '__shift__':i=>i.shiftText,
  '__rel__':i=>i.relText,
  '__est__':i=>(i.estProvisional?'~':'')+i.estText,
  '__actual__':i=>i.actualText,
  '__flags__':i=>(i.flagList||[]).map(f=>f.text).join(' '),
  '__by__':i=>i.createdBy,
  '__pc__':i=>i.createdPc,
  '__upby__':i=>i.updatedBy,
  '__uppc__':i=>i.updatedPc,
  '__actions__':()=>'（開始・固定・帳票などのボタン）',
 };
 /* ---------- 「この列はいまどの状態か」を1箇所が答える（§9.237） ----------
    紙にも画面と同じ**バッジ**（可/不可・区分・印）で出すために、
    印刷側が状態を知る必要がある。**状態そのものはここで決めない**
    ——`WORKABLE_LABEL`（可否）・`categoryOf()`（区分）・`estProvisional`
    （見積の出どころ）という既にある1箇所の答えを、紙が読める呼び名へ
    写すだけ。ここで判定をやり直すと、画面と紙で状態が食い違う
    （§9.163「判定を画面にも書かない」と同じ理由）。
    返すのは**紙の意匠に依らない語彙**で、`schedule-print.js`が自分の
    クラス名へ翻訳する。 */
 const SC_FIXED_TONE={
  '__cat__':i=>'cat-'+String(i.cat&&i.cat.key||''),
  '__workable__':i=>'wk-'+String(i.wk&&i.wk.cls||'').replace(/^is-/,''),
  '__est__':i=>i.estProvisional?'est-provisional':'',
 };
 function scFixedCellText(entry,k){
  const f=SC_FIXED_TEXT[k];
  if(!f||!entry)return '';
  try{return f(entryCellInfo(entry))}catch(_){return ''}
 }

 function renderEntryRow(timeline,e,showGaps,getLastEnd,setLastEnd){
  {
   const lastEnd=getLastEnd();
   if(showGaps&&e.plannedStart&&lastEnd){
    const gapMin=(new Date(e.plannedStart)-new Date(lastEnd))/60000;
    if(gapMin>1){
     const isFixedGap=e.fixedStart&&Math.abs(new Date(e.fixedStart)-new Date(e.plannedStart))<60000;
     const div=document.createElement('div');
     div.className='sc-gap-divider';
     div.textContent=`── ${WL.duration.text(gapMin)}の空き・${fmtDateTime(lastEnd)}〜${fmtDateTime(e.plannedStart)}${isFixedGap?'・固定開始時刻待ち':''} ──`;
     timeline.append(div);
    }
   }
   if(e.plannedEnd)setLastEnd(e.plannedEnd);

   const info=entryCellInfo(e);
   const {cat,locked,dateText,dateTitle,dateShifted,timeText,timeTitle,shiftText,relText,
          estText,estSrc,estProvisional,estNote,actualText,flags,workable,wk,wkTitle}=info;
   const row=document.createElement('div');
   row.className='sc-row-line '+stateRowClass(e.state)
    +(e.__pending?' sc-row-pending':'')+(locked?' sc-row-locked':'')+(e.ongoing?' sc-row-ongoing':'')
    /* 行の地の色(§9.198)。区分のセルだけでなく行全体に淡く敷く——設備停止の
       ように「作業ではない行」を、行を追う目のまま見分けられるようにする。 */
    +rowStyleClass(e)
    /* 題名を札／帯にしたときは**行の地を塗らない**（§9.295）——同じ色が
       行の地と札の両方に出ると、どちらが印なのか読めなくなる（§3・§8）。
       印は行に付けて、地を消すのはCSSが受ける。 */
    /* 枠は**箱**（§9.300 ②）。3ロットぶんの高さは`.sc-row-frame-box`が持つ。
       `sc-row-nw-face`も一緒に付ける——色を持つのは箱のほうなので、行の地まで
       塗ると同じ色が2箇所に出る（§9.295「札／帯にしたら行の地は塗らない」）。 */
    +(e.kind==='枠'?' sc-row-frame-box sc-row-nw-face':'')
    +(e.kind!=='作業'&&e.kind!=='枠'&&rowStyleOf(e).titleLook?' sc-row-nw-face':'');
   row.dataset.id=e.id;
   row.__scEntry=e;   // 作業可否だけ後から差し替えるときの参照(§9.51)
   // ロック(§9.38)された行はその日時に釘付けなので、並べ替えても時刻が
   // 変わらない。動かせるのに何も起きない状態は紛らわしいためドラッグ対象
   // から外す(解除すれば通常のロットと同じように流れる)。
   const canDrag=scState.editable&&e.reorderable&&!e.__pending&&!locked&&!sessionBlocked();
   row.draggable=canDrag;
   if(canDrag)row.tabIndex=0;

   const lotText=entryContentText(e);      // ツールチップ・帳票用の1行要約
   const contentCells=timelineContentCells(e);
   const formulaFns=timelineFormulaFns();      /* 計算で作る列(§9.207)。控えつき */
   /* 読み替えが見る行と対象は**1行につき1回**作る（§9.234 ⑥）。 */
   const ruleRow=timelineRuleRow(e),calcTarget=timelineTarget();
   /* **「誰が・どの端末で」は常に詳細へ入れる**(§9.180)。これにより
      すべての行に詳細(▾)が付く——監査の情報は行を選ばず必要になる。 */
   const detailHtml=frameDetailHtml(e)+fixedStartHtml(e)+estimateBreakdownHtml(e)+auditHtml(e);
   const canDelete=scState.fullControl&&e.state==='予定'&&!e.__pending&&!e.unplanned;
   // §9.35: 編集モード(=実際に測定する端末)なら、予定から直接測定画面を開ける。
   // 開始時刻を打刻すると実績突合(§7.4)でこの行が「実施中」へ移る。
   // §9.51: 作業可否フラグが立っている(残仕掛設備ｺｰｽがこの設備で始まる)
   // 予定だけ開始できる。まだこの設備に来ていないロットを開始させない。
   const canStart=canStartEntry(e,workable);
   // §9.38: 日時で固定する(ロック)。予定を動かせるモードでのみ操作できる。
   /* 枠(§9.238 ②)は固定開始日時を使わないので、鍵の入口も出さない（§4）。 */
   const canLock=scState.fullControl&&e.state==='予定'&&!e.__pending&&!e.unplanned&&e.kind!=='枠';
   // §9.43: 実績のある行(作業中・完了)は帳票を開ける。実績突合で紐づいた
   // 測定データの記録ID(actualRecordId)をそのまま帳票へ渡す。
   const recordId=e.actualRecordId||'';
   const canReport=!!recordId&&(e.state==='着手'||e.state==='完了')&&typeof window.openReportForRecord==='function';
   // 作業中の行はダブルクリックで測定を再開できる(openMeasurementが端末内の
   // 編集中データを見つけて続きから開く)。編集モードの端末だけ。
   const canResume=scState.canStartWork&&e.kind==='作業'&&e.state==='着手';
   // §9.61: 履歴(作業中・完了)の削除。実績はバックアップ(records.sqlite3)の
   // 行から合成されるため、端末内のデータ一覧に無くてもここに残り続ける
   // (別PCで測定した/端末側だけ消えた場合)。実データを消す操作なので
   // 予定の削除とは別のボタンにし、警告を必ず挟む。
   const canDeleteHistory=scState.canDeleteHistory&&!!recordId&&(e.state==='着手'||e.state==='完了');

   /* セルは**見出しと同じ並び**から組み立てる(§9.176)。以前はHTMLへ
      直書きした固定の順番だったため、見出しだけを動かしても中身は動かず
      「列が固定されている」状態だった。**キーで引く**——位置で数えると
      隠した列があるだけでずれる(§9.104と同じ約束)。 */
   const contentMap=new Map(contentCells.map(c=>[c.key,c]));
   const cellOf={
    /* 区分のセル。**色とアイコンは行表示マスタが決める**(§9.198)が、
       区分名の文字は必ず出す（色だけで伝えない）。 */
    '__cat__':`<span class="sc-row-cat sc-cat-${cat.key}${rowStyleClass(e)}" data-col="__cat__" title="${esc(e.kind)}・${esc(e.state)}">${rowStyleOf(e).html}${esc(cat.label)}</span>`,
    '__workable__':`<span class="sc-row-workable ${wk.cls}" data-col="__workable__" title="${esc(wkTitle)}">${esc(wk.text)}</span>`,
    '__date__':`<span class="sc-row-date${dateShifted?' is-shifted':''}" data-col="__date__" title="${esc(dateTitle)}">${esc(dateText)}</span>`,
    '__caldate__':`<span class="sc-row-date" data-col="__caldate__" title="${esc(info.calDateTitle)}">${esc(info.calDateText)}</span>`,
    '__time__':`<span class="sc-row-time" data-col="__time__" title="${esc(timeTitle)}">${esc(timeText)}</span>`,
    '__shift__':`<span class="sc-row-shift" data-col="__shift__" title="勤務形態マスタで設定した名称です">${esc(shiftText)}</span>`,
    '__rel__':`<span class="sc-row-rel" data-col="__rel__">${esc(relText)}</span>`,
    '__est__':`<span class="sc-row-est${estProvisional?' sc-est-default':''}${estSrc==='equipment-standard'?' sc-est-standard':''}" data-col="__est__" title="${esc(estNote)}">${estProvisional?'~':''}${esc(estText)}</span>`,
    '__actual__':`<span class="sc-row-actual" data-col="__actual__">${esc(actualText)}</span>`,
    '__flags__':`<span class="sc-row-flags" data-col="__flags__">${flags}</span>`,
    '__actions__':`<span class="sc-row-actions" data-col="__actions__">
     ${canStart?startBtnHtml():''}
     ${canLock?`<button type="button" class="sc-row-btn sc-row-lock${locked?' active':''}" title="${locked?'固定を解除して通常の並びへ戻します':'今の予定日時でこの行を固定します(以降ずれません)'}">${locked?'解除':'固定'}</button>`:''}
     ${canResume?`<button type="button" class="sc-row-btn sc-row-resume" title="測定画面を開いて続きから再開します(行のダブルクリックでも開けます)">再開</button>`:''}
     ${canReport?`<button type="button" class="sc-row-btn sc-row-report" title="このロットの帳票を表示します">帳票</button>`:''}
     ${detailHtml?`<button type="button" class="sc-row-btn sc-row-detail-toggle" title="詳細を表示">▾</button>`:''}
     ${canDelete?`<button type="button" class="sc-row-btn sc-row-delete" title="この予定を削除します">外す</button>`:''}
     ${canDeleteHistory?`<button type="button" class="sc-row-btn sc-row-btn-danger sc-row-delete-history" title="このロットの測定データ（実績）を削除します。取り消せません">削除</button>`:''}
    </span>`,
   };
   /* 作業以外の行（設備停止・コメント・枠）は**題名だけ**（§9.294 ①）。
      内容の列を束ねてそこへ置き、束の外の内容・計算の列と作業可否は空に
      する。**`cellOf`より先に見る**——`cellOf`が持つ固定列（作業可否）も
      落とす必要があるため。 */
   const nwStyle=e.kind!=='作業'?rowStyleOf(e):null;
   const nwSpan=e.kind!=='作業'?nonWorkSpanOf(timelineColumnKeys(),nwStyle&&nwStyle.titlePlace):null;
   const nwTitle=nwSpan?nonWorkTitleText(e,'（ダブルクリックで書けます）'):'';
   const cellHtml=k=>{
    if(nwSpan){
     if(k===nwSpan.key){
      /* **`grid-column:span N`で束ねる**——器は`--sc-cols`のグリッドなので、
         続く列のセルを出さなければ後ろの固定列はそのまま次のトラックへ
         流れる（列がずれない）。
         見せ方・揃えは**属性で渡す**（§9.295）——CSSが受けるので、選択肢を
         1つ足しても画面のJSは触らない。色は行に付く`sc-rs-*`の
         `--rs-fg`/`--rs-bg`/`--rs-line`をそのまま読む（色表を2つ持たない）。 */
      const look=String((nwStyle&&nwStyle.titleLook)||'');
      const align=String((nwStyle&&nwStyle.titleAlign)||'');
      /* （所要時間）は**題名の一部ではない**（§9.295 ④）——`title`属性と
         監査に残る名前は名前のまま。添えるのは見せるときだけ。 */
      const nwTime=nonWorkTimeText(e);
      const body=esc(nwTitle)+(nwTime?`<span class="sc-nw-time">${esc(nwTime)}</span>`:'');
      /* 日付・直の枠は**箱**（§9.300 ②）。区分・行き先・状態を3段に組む
         ——1行に`／`で繋いだ文字列は「空のスケジュールらしきもの」にしか
         見えなかった。**文字の材料は`frameParts()`の1箇所**なので、
         紙・`title`・監査に出る1行と食い違わない。 */
      const inner=e.kind==='枠'?frameBoxHtml(e,look)
                 :(look?`<b class="sc-nw-face">${body}</b>`:body);
      return `<span class="sc-row-title sc-row-nonwork${e.kind==='枠'?' sc-frame-box':''}" data-col="${esc(k)}"`
       +(look?` data-nw-look="${esc(look)}"`:'')+(align?` data-nw-align="${esc(align)}"`:'')
       +(nwSpan.span>1?` style="grid-column:span ${nwSpan.span}"`:'')
       +` title="${esc(nwTitle)}${esc(nwTime)}">${inner}</span>`;
     }
     if(nwSpan.inRun(k))return '';
     if(!scIsFixedCol(k)||NON_WORK_BLANK_FIXED.has(k))
      return `<span data-col="${esc(k)}"></span>`;
    }
    if(cellOf[k]!==undefined)return cellOf[k];
    /* 文字だけの固定列(登録者・登録端末など。§9.180)は**同じ表から引く**
       ——ここに書き写すと、設定パネルの見本と行の中身が食い違う。 */
    if(SC_FIXED_TEXT[k]){
     const v=SC_FIXED_TEXT[k](info);
     return `<span class="sc-row-audit" data-col="${esc(k)}" title="${esc(v)}">${esc(v)}</span>`;
    }
    /* 計算で作る列（§9.207）。**設備停止・コメントの行でも同じ式を当てる**
       ——行ごとに材料が無ければ式の中で空になるだけで、列がずれない。
       **一覧と同じ`WL.cellFormat.cell()`を通す**（§9.234 ⑥）——以前は式の
       結果を素で埋めていたので、計算列にだけ読み替えも書式も色も乗らず、
       「他の列のみのルール」を当てても何も出なかった。一覧側
       （`list-view.js`の`rawVal=calc?calc.run(r):r[c]`）と同じ形＝
       **式の結果が「生の値」で、その上に読み替え→書式**（矛盾しない答えは
       この1本だけ。列ごとに「ルール優先／式優先」を選ばせない）。
       式が空の列（＝読み替えだけで中身を作る列）もここで受ける。 */
    /* 計算式・内容の項目は`dynamicCellValue()`の1箇所で決める
       （§9.235。印刷向けの`printRowCells()`も同じ関数を通す）。 */
    const dyn=dynamicCellValue(e,k,{formulaFns,ruleRow,calcTarget,contentMap});
    if(dyn.kind==='calc')
     /* **元の値（式の結果）は`title`に残す**——読み替えで置き換わったことが
        読める（§9.94「切れたセルには生の値の`title`」と同じ約束）。 */
     return `<span class="sc-row-title sc-row-calc${dyn.color?' cell-'+dyn.color:''}" data-col="${esc(k)}" title="${esc(dyn.raw||dyn.text)}">${esc(dyn.text)}</span>`;
    if(dyn.kind==='content')
     return `<span class="sc-row-title${dyn.color?' cell-'+dyn.color:''}" data-col="${esc(k)}" data-content-col="${esc(k)}" title="${esc(dyn.raw||dyn.text)}">${esc(dyn.text)}</span>`;
    return `<span data-col="${esc(k)}"></span>`;
   };
   row.innerHTML=`
    <span class="sc-row-handle" title="${canDrag?'ドラッグまたはAlt+↑/↓で並べ替え':(locked?'日時を固定中(ロック)':'')}">${pickBoxHtml(e)}${canDrag?'⠿':(locked?'🔒':'')}</span>`
    +timelineColumnKeys().map(cellHtml).join('');
   /* 揃え(§9.239 ④)。**セルを組み立てる文字列へ混ぜない**——`cellOf`は
      15通りの分岐があり、1つ書き漏らすとその列だけ揃わない。
      組み上がってから`data-col`で引いて1度だけ当てる（判定は
      `WL.columnAlign`の1箇所）。 */
   WL.columnAlign.applyCells(row,timelineTarget());
   /* 題名の揃え（§9.295）は**列の揃えより後に当てる**——`applyCells`は
      `@layer utility`の`.al-*`を貼るので（§9.239 ④）、素のCSSで
      `text-align`を書いても必ず負ける（実測: 紙は中央なのに画面だけ左）。
      **同じ語彙（`.al-*`）で上書きする**——詳細度を数える勝負にしない。 */
   if(nwSpan){
    const cell=row.querySelector('.sc-row-nonwork');
    if(cell){
     const a=cell.getAttribute('data-nw-align')||'';
     cell.classList.remove('al-l','al-c','al-r');
     cell.classList.add(a==='中央'?'al-c':(a==='右'?'al-r':'al-l'));
    }
   }
   row.classList.toggle('sc-row-not-workable',workable.state==='ng');
   if(canDrag)wireDrag(row);
   /* 選ばれている行は面でも分かるようにするが、**色だけで伝えない**
      ——件数とロット番号は選択バーが文字で出す(§9.170)。 */
   const pick=row.querySelector('.sc-pick-check');
   if(pick){
    row.classList.toggle('is-picked',scState.picked.has(String(e.id)));
    /* **clickで受ける**——changeはclickの後に飛ぶため、行のクリックで
       作り直す作りだと反映されない(列の設定パネルで踏んだ罠と同じ)。 */
    pick.addEventListener('click',ev=>{
     ev.stopPropagation();
     setPicked(e.id,ev.target.checked);
    });
   }
   const del=row.querySelector('.sc-row-delete');
   if(del)del.onclick=ev=>{ev.stopPropagation();deleteEntry(e.id)};
   const start=row.querySelector('.sc-row-start');
   if(start)start.onclick=ev=>{ev.stopPropagation();startWorkFromEntry(e)};
   const lock=row.querySelector('.sc-row-lock');
   if(lock)lock.onclick=ev=>{ev.stopPropagation();toggleEntryLock(e)};
   const resume=row.querySelector('.sc-row-resume');
   if(resume)resume.onclick=ev=>{ev.stopPropagation();startWorkFromEntry(e)};
   const report=row.querySelector('.sc-row-report');
   if(report)report.onclick=ev=>{ev.stopPropagation();openEntryReport(e)};
   const delHist=row.querySelector('.sc-row-delete-history');
   if(delHist)delHist.onclick=ev=>{ev.stopPropagation();deleteHistoryEntry(e)};
   /* 詳細の器は**この時点ではまだ無い**（行を差し込んだあとに作る）ので、
      メニューは押されたときに読み直す。 */
   let detailEl=null;
   /* 右クリック（§9.207）。**操作の列を隠していても同じことができる**。 */
   row.addEventListener('contextmenu',ev=>{
    if(ev.target.closest('.sc-row-head'))return;
    ev.preventDefault();ev.stopPropagation();
    const picked=scState.picked.has(String(e.id));
    const canPick=!!removableEntry(e)||!!canDrag;
    openRowMenu(ev,scRowMenuTitle(e),scRowMenuNote(e),[
     canStart&&{label:'作業を開始する',note:'この予定の測定画面を開きます',
                run:()=>startWorkFromEntry(e)},
     canResume&&{label:'測定を再開する',note:'続きから開きます',
                 run:()=>startWorkFromEntry(e)},
     canReport&&{label:'帳票を開く',run:()=>openEntryReport(e)},
     canLock&&{label:locked?'日時の固定を解除する':'いまの日時で固定する',
               note:locked?'通常の並びへ戻します':'以降ずれなくなります',
               run:()=>toggleEntryLock(e)},
     detailHtml&&{label:'詳細（固定開始・見積の内訳）',
                  run:()=>{if(detailEl){detailEl.hidden=!detailEl.hidden;
                    const t=row.querySelector('.sc-row-detail-toggle');
                    if(t){t.textContent=detailEl.hidden?'▾':'▴';
                          t.classList.toggle('active',!detailEl.hidden)}}}},
     commentEditable(e)&&{label:'申し送りを書き直す',run:()=>startCommentEdit(e.id)},
     /* §9.220 2①。**できないときも並べて理由を書く**（§4）——メニューから
        消すと「直せる場所が無い」のか「この行は直せない」のかが読めない。 */
     e.kind==='設備停止'&&e.state==='予定'&&{label:'停止の内容を変える',
       note:stopEditable(e)?'名称・所要分・備考を直します':stopEditBlockReason(e),
       disabled:!stopEditable(e),run:()=>editStopEntry(e.id)},
     /* 日付・直の枠(§9.238 ②)。**できないときも並べて理由を書く**（§4）。 */
     e.kind==='枠'&&e.state==='予定'&&{label:'枠の日付・直を変える',
       note:frameEditable(e)?'ここから先を、どの日・どの直から並べるか'
         :(e.__pending?'サーバーへ反映中です':sessionHolderMessage()),
       disabled:!frameEditable(e),run:()=>openFramePicker(e.id)},
     canPick&&{label:picked?'選択を外す':'この行を選ぶ',
               note:'選んだ行はまとめて動かす・まとめて外せます',
               run:()=>setPicked(e.id,!picked)},
     {sep:true},
     {label:'表示列の設定を開く…',run:()=>openContentPanel()},
     (canDelete||canDeleteHistory)&&{sep:true},
     canDelete&&{label:'予定から外す',danger:true,run:()=>deleteEntry(e.id)},
     canDeleteHistory&&{label:'実績（測定データ）を削除',danger:true,
                        note:'取り消せません',run:()=>deleteHistoryEntry(e)},
    ]);
   });
   if(canResume){
    row.classList.add('sc-row-resumable');
    row.title='ダブルクリックで測定を再開します';
    row.ondblclick=ev=>{
     if(ev.target.closest('button'))return;  // 行内ボタンの二度押しを再開と誤認しない
     ev.preventDefault();startWorkFromEntry(e);
    };
   }else if(canReport){
    // 完了行はダブルクリックで帳票(データ一覧の行と同じ操作感、
    // records-store.jsのrow.ondblclickに合わせる)。
    row.title='ダブルクリックで帳票を表示します';
    row.ondblclick=ev=>{
     if(ev.target.closest('button'))return;
     ev.preventDefault();openEntryReport(e);
    };
   }else if(stopEditable(e)){
    /* 設備停止は**ダブルクリックで直せる**（§9.220 2①、利用者の指示
       「右クリックやダブルクリックで編集・変更できるようにしたい」）。
       着手・完了の行はここへ来ない（`canResume`／`canReport`が先に取る）
       ので、割り当てはぶつからない。 */
    row.classList.add('sc-row-stop-edit');
    row.title='ダブルクリックで名称・所要分を直せます';
    row.ondblclick=ev=>{
     if(ev.target.closest('button'))return;
     ev.preventDefault();editStopEntry(e.id);
    };
   }else if(commentEditable(e)){
    /* 申し送りは**その場で書く**(§9.191、利用者の指示「配置された
       コメント欄をダブルクリックなどで編集モードに移行し入力する」)。
       作業・完了の行とはkind・stateで排他なので、ダブルクリックの
       割り当てはぶつからない。 */
    row.classList.add('sc-row-comment-edit');
    row.title='ダブルクリックで書き直せます';
    row.ondblclick=ev=>{
     if(ev.target.closest('button'))return;
     ev.preventDefault();startCommentEdit(e.id);
    };
   }else if(frameEditable(e)){
    /* 日付・直の枠(§9.238 ②)も**ダブルクリックで直す**——設備停止・
       申し送りと同じ作法（入口を種別ごとに変えない）。kindで排他なので
       割り当てはぶつからない。 */
    row.classList.add('sc-row-frame-edit');
    row.title='ダブルクリックで日付・直を変えられます';
    row.ondblclick=ev=>{
     if(ev.target.closest('button'))return;
     ev.preventDefault();openFramePicker(e.id);
    };
   }else if(e.kind==='コメント'||e.kind==='枠'){
    /* **できないことは、できないと書く**(CLAUDE.md §4)。 */
    row.title=e.__pending?'サーバーへ反映中です。反映されたら直せます'
      :(sessionBlocked()?sessionHolderMessage():'この行は直せません');
   }
   timeline.append(row);

   /* 詳細(固定開始・見積の内訳)を開く相手は**操作の列の中のボタン**。
      §9.176で操作の列も隠せるようになったので、**隠していたら詳細ごと
      置かない**——ボタンが無いのに詳細だけDOMへ積むと、開く手立てが無い
      死んだ要素が行の数だけ増える(以前はここで`toggle.onclick`が
      nullへの代入になって、行を1つ描くたびに例外が出ていた)。 */
   /* 詳細（固定開始・見積の内訳）は**操作の列を隠していても開ける**
      （§9.207）。以前はボタンが無ければ器ごと作らなかったので、列を隠すと
      詳細へ辿り着く道が消えていた。いまは行の右クリックから開けるので、
      **中身があるかぎり器は作る**。 */
   if(detailHtml){
    detailEl=document.createElement('div');
    detailEl.className='sc-row-detail';
    detailEl.hidden=true;
    detailEl.innerHTML=detailHtml;
    timeline.append(detailEl);
    const toggle=row.querySelector('.sc-row-detail-toggle');
    if(toggle)toggle.onclick=ev=>{
     ev.stopPropagation();
     detailEl.hidden=!detailEl.hidden;
     toggle.textContent=detailEl.hidden?'▾':'▴';
     toggle.classList.toggle('active',!detailEl.hidden);
    };
    const fsInput=detailEl.querySelector('.sc-fixed-start-input');
    if(fsInput)fsInput.onchange=()=>updateFixedStart(e.id,fsInput.value);
    const fsClear=detailEl.querySelector('.sc-fixed-start-clear');
    if(fsClear)fsClear.onclick=ev=>{ev.stopPropagation();updateFixedStart(e.id,'')};
   }
  }
 }
 // scState.entriesが変わるたびに、既にスケジュール投入済みのロットが仕掛
 // 一覧から消える(§9.15)よう#gridを再描画する。SIKALOTNOWを見ていない
 // 時は無駄なので、S.dbで確認してから呼ぶ。
 /* **1フレームに1回へまとめる**（§9.224 ①）。`renderTimeline()`の最後で
    呼ぶので、まとめて投入すると**入れた件数ぶん**呼ばれる——仕掛一覧は
    実データで158行×214列あり、1回の描き直しに約300msかかるため、158件を
    投入すると102回×300ms＝**約31秒、画面が固まったまま**になっていた
    （実測。押してから40秒なにも反応しない）。描き直しは何度やっても同じ
    結果なので、**最後の1回だけ**で足りる。
    **止めないこと**——止めると§9.15の「投入済みのロットが仕掛一覧から
    消える」が効かなくなる。列幅を掴んでいる最中に待たせるのは今までどおり
    （§9.211 ①）。 */
 let lotFilterQueued=false;
 function refreshScheduledLotFilter(){
  if(!(typeof renderGrid==='function'&&typeof S!=='undefined'&&WL.dataSource.isWork(S.db)))return;
  if(lotFilterQueued)return;
  lotFilterQueued=true;
  requestAnimationFrame(()=>{
   lotFilterQueued=false;
   WL.columnResize.defer('grid:scheduledLot',()=>renderGrid());
  });
 }

 /* ---------- 書込キュー(§9.11新設): 画面描画を先行させ、実際のAPI呼び出しは
    バックグラウンドで直列に処理する ----------
    共有スケジュールDBは§4.2の取得→適用→反映サイクルを1リクエストごとに
    踏むため並列化はできない(既存の一括追加が直列awaitだった理由と同じ)。
    以前はその直列awaitを画面のクリック/ドロップ操作自身がブロックして
    いたため、20件を超える一括追加で体感速度が悪化していた。ここでは
    「画面へは即座に反映し、実際の書込はキューに積んで後追いで処理する」
    方式に変え、ユーザー操作をAPI応答待ちで止めない。編集セッション
    (§9.11のsyncSession)が同一設備の同時編集を防いでいるため、キューが
    捌き切る前に他端末の変更と衝突する心配もない。失敗したオペレーションは
    数回リトライしてから諦める。諦めた操作だけonFailureでロールバックする
    (§9.22改訂、下記)。
    以前はキューが空になるたびloadPlan()でサーバー側の最終状態に描き直して
    いたが、これが「書込完了→再読込→再描画」という一往復を挟むため、
    ロック保持中(1人だけが編集している最中)でも表示が一瞬消える体感になって
    いた(読み込み中プレースホルダを一旦挟むため)。編集セッションは設備単位で
    同時に1人しか入れない設計(schedule_sync.pyのacquire_session)のため、
    自分が保持している間は他端末とのデータ競合が起きようがない。そこで
    書込を一方通行にし、セッション対象(sessionApplicable())の間は自動再読込
    をしない。読み込みは編集モードに入るタイミング(openScheduleView/
    refreshAll等の既存呼び出し)や、他端末編集中の閲覧時(sessionApplicable()
    がfalseの場面)にのみ行う。この間、削除・並べ替え直後に他の予定の見積/
    残り時間等サーバー側の再計算値が古いままになるのは許容する
    (次に編集モードへ入った時点で正規化される)。 */
 /* 操作を「記述(op)」として積む(§9.45)。runの閉包で積む従来の形も残すが、
    opで積んだ分は runWriteQueue が**まとめて1リクエスト**へ束ねられる。
    共有DBの書込は1回ごとにロック取得→検証待ち→取得→反映のサイクルを丸ごと
    踏むため(§4.2)、件数ぶん固定費が積み上がっていた(実測1件約1.5秒)。
    desc: {op:'add'|'update'|'delete'|'reorder', ...payload, onSuccess, onFailure} */
 function queuePlanOp(desc){
  const {onSuccess,onFailure,...op}=desc;
  queueScheduleWrite(
   // まとめられなかった場合(scheduleモード以外・単発)はこの経路で個別に投げる。
   async()=>{
    const path={add:'/api/schedule/plan/add',update:'/api/schedule/plan/update',
                delete:'/api/schedule/plan/delete',reorder:'/api/schedule/plan/reorder'}[op.op];
    const {op:_omit,...body}=op;
    const r=await api(path,{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify(withUserId(body))});
    if(onSuccess)onSuccess(r);
    return r;
   },
   onFailure,op,onSuccess);
 }
 function queueScheduleWrite(run,onFailure,op,onSuccess){
  // 予定を変える操作をした時点でキャッシュ(§9.42)は古い。次にこの画面を
  // 開いたときは必ず取り直す。画面上の表示は楽観的更新(§9.11)で既に
  // 反映されているので、ここで読み直しはしない(操作直後に画面を止めない
  // 一方通行の書込、§9.22)。
  invalidatePlanCache(scState.equipment);
  scWriteQueue.push({run,onFailure,attempts:0,op,onSuccess});
  if(scQueueFlushTimer||scQueueRunning)return;
  scQueueFlushTimer=setTimeout(()=>{scQueueFlushTimer=null;runWriteQueue()},150);
 }
 /* 時刻が動く操作。**「追加」だけではない**——外す・並べ替える・固定を
    切り替えるのも、その後ろの予定の時刻を動かす。 */
 /* 時刻が動く操作。**「追加」だけではない**——外す・並べ替える・固定を
    切り替えるのも、その後ろの予定の時刻を動かす。
    **申し送りの本文だけの更新は動かさない**(§9.191)ので数えない
    ——数えると、1文字直すたびに全部を取り直して画面が作り直される。 */
 const SC_TIME_SHIFT_OPS=new Set(['add','delete','reorder','update']);
 const opShiftsTime=op=>!!op&&SC_TIME_SHIFT_OPS.has(op.op)
   &&!(op.op==='update'&&Object.prototype.hasOwnProperty.call(op,'title')
       &&!('fixedStart' in op)&&!('estimateMinutes' in op)&&!('state' in op));
 async function runWriteQueue(){
  if(scQueueRunning)return;
  scQueueRunning=true;
  const failures=[];
  let timeShifted=false;
  try{
   while(scWriteQueue.length){
    // 先頭から「まとめられる操作(op付き)」が続く限り束ねて1リクエストにする。
    // まとめ書込はscheduleモード限定(サーバー側の制限。§9.45のコメント参照)。
    if(scWriteQueue[0].op&&scState.fullControl&&scWriteQueue.length>1){
     const batch=[];
     while(batch.length<scWriteQueue.length&&scWriteQueue[batch.length].op&&batch.length<100)batch.push(scWriteQueue[batch.length]);
     if(batch.length>1){
      let handled=false;
      try{
       const r=await api('/api/schedule/plan/batch',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(withUserId({ops:batch.map(b=>b.op)}))});
       const results=r.results||[];
       batch.forEach((b,i)=>{
        const one=results[i];
        if(one&&one.ok!==false){if(b.onSuccess)b.onSuccess(one)}
        else{
         const err=Error((one&&one.error)||'反映できませんでした');
         err.__reported=!!b.onFailure;failures.push(err);
         if(b.onFailure){try{b.onFailure(err)}catch(_e){WL.quiet.note('ロールバック失敗は無視',_e)}}
        }
       });
       if(batch.some(b=>opShiftsTime(b.op)))timeShifted=true;
       scWriteQueue.splice(0,batch.length);
       handled=true;
      }catch(e){
       // まとめて失敗(権限不足・他端末編集中・通信不良)。4xxはリトライしても
       // 同じなので、その場で全件諦める。5xx等は個別処理へ落として従来の
       // リトライに任せる(まとめ経路だけで握りつぶさない)。
       const permanent=e&&typeof e.status==='number'&&e.status>=400&&e.status<500&&e.status!==409&&e.status!==423;
       if(permanent){
        batch.forEach(b=>{
         const err=Error(e.message);err.status=e.status;err.__reported=!!b.onFailure;
         failures.push(err);
         if(b.onFailure){try{b.onFailure(err)}catch(_e){WL.quiet.note('同上',_e)}}
        });
        scWriteQueue.splice(0,batch.length);
        handled=true;
       }
      }
      if(handled)continue;
     }
    }
    const op=scWriteQueue[0];
    try{
     await op.run();
     if(opShiftsTime(op.op))timeShifted=true;
     scWriteQueue.shift();
    }catch(e){
     op.attempts++;
     /* **423は「編集権を失った」ことの知らせ**（§9.211 ②）。以前はここで
        状態を更新しておらず、次のハートビート（最大25秒後）まで画面は
        「自分が編集中」のままだった——奪われたことに気づかないまま操作を
        続け、そのたびに黙って戻される。届いた時点で読み取り専用へ落とす。 */
     if(e&&e.status===423&&e.sessionLockedBy
        &&(e.sessionLockedBy.loginId||e.sessionLockedBy.pcName)&&sessionApplicable()){
      scState.sessionHeld=false;scState.sessionHolder=e.sessionLockedBy;scState.sessionError=null;
      renderSessionBanner();
     }
     // 権限不足・入力不正(4xx)は何度やっても同じ結果になる。リトライすると
     // 同じ失敗メッセージが回数ぶん出てしまうため、即座に諦める。
     // 再試行に意味があるのは共有ファイルのロック待ち・一時的な通信不良
     // (423/409/503やネットワーク例外)だけ。
     const permanent=e&&typeof e.status==='number'&&e.status>=400&&e.status<500&&e.status!==409&&e.status!==423;
     if(permanent||op.attempts>=3){
      scWriteQueue.shift();failures.push(e);
      // onFailureを持つ操作は、そちらで利用者へ知らせる責任を持つ。
      if(op.onFailure){
       try{e.__reported=true;op.onFailure(e)}catch(err){WL.quiet.note('ロールバック自体の失敗はここでは無視(諦めたことは既にfailuresへ記録済み)',err)}
      }
     }
     else await sleep(700*op.attempts);
    }
   }
  }finally{
   scQueueRunning=false;
   // onFailureで個別に知らせた分は、ここで重ねて出さない(同じ内容の通知が
    // 二重に並ぶ)。まとめ通知は「個別の知らせ先を持たない操作」が失敗した
    // ときだけ出す。
   const unreported=failures.filter(f=>!f.__reported);
   if(unreported.length){
    const msg=unreported.length===1?unreported[0].message:`${unreported.length}件の変更を反映できませんでした`;
    showToast&&showToast('一部の変更を反映できませんでした',msg,7000);
   }
   /* ---------- 書込のあとは時刻を取り直す(§9.185) ----------
      予定を1本足す・外す・並べ替えると、**その後ろの予定の時刻が全部
      動く**。楽観的更新で作った行は`plannedStart`を持たないので、取り
      直さないと足した行は「未定」のまま、後続は古い時刻のまま残る
      （実機で「追加しても時間が計算されない」と報告された）。
      覆いは出さない（既に行は出ているので、静かに差し替わるだけ）。
      **他端末が編集中(閲覧)のときも同じ**なので条件を分けない。 */
   /* **必ず取り直す**(§9.200)。以前は`loadPlan()`(キャッシュ可)だったため、
      書込中に飛んでいた別のGETがキャッシュへ入っていると、変更前の内容を
      そのまま画面へ戻していた。 */
   if(scState.equipment&&(timeShifted||!sessionApplicable()))await loadPlan(true);
  }
 }
 // 楽観的追加(makeOptimisticEntry)で割り当てた仮ID(tmp-N)を、書込キューでの
 // サーバー反映後に本来のIDへ差し替える。削除・並べ替えボタンは__pending中は
 // 無効化してあるため、この差し替えが完了するまでは対象にならない
 // (§9.22、上のrunWriteQueueコメント参照)。
 function resolveOptimisticEntry(entry,result){
  entry.id=result.id;entry.__pending=false;
  delete entry.__beforeId;delete entry.__nearT;
  if(scState.equipment)renderTimeline();
 }
 // 追加が最終的に失敗した(リトライを使い切った)場合、楽観的に足しておいた
 // 仮エントリを取り消す。
 function discardOptimisticEntry(entry){
  const idx=scState.entries.indexOf(entry);
  if(idx!==-1){scState.entries.splice(idx,1);if(scState.equipment)renderTimeline()}
 }
 function makeOptimisticEntry(kind,fields){
  return Object.assign({
   id:'tmp-'+(++scTempIdSeq),kind,state:'予定',reorderable:true,
   plannedStart:null,plannedEnd:null,startsInMinutes:null,
   estimate:null,actual:null,overdueMinutes:0,spansNonWorking:false,fixedStart:null,
   lotNo:'',title:'',detail:{},__pending:true,
  },fields);
 }

 async function deleteEntry(id){
  /* **読み取り専用のときは消さない**（§9.211 ②）。右クリックメニュー・
     🗑ボタン・選択バーの3経路から来るので、入口ではなくここで1回だけ断る。 */
  if(sessionBlocked()){showToast&&showToast('削除できません',sessionHolderMessage(),4000);return}
  if(typeof confirmModal==='function'){
   const ok=await confirmModal({message:'この予定を削除します。よろしいですか？'});
   if(!ok)return;
  }
  const idx=scState.entries.findIndex(e=>e.id===id);
  if(idx===-1)return;
  const [removed]=scState.entries.splice(idx,1);
  renderTimeline();
  queuePlanOp({op:'delete',id,
   onFailure:()=>{
    // リトライを使い切って諦めた時だけロールバックする(§9.22)。以前は
    // 失敗するたびに毎回ロールバックしていたため、1回目失敗→ロールバック→
    // 2回目成功、という順で実際にはサーバー側は削除済みなのに画面へ復活
    // したまま二度と消えない不整合が起こり得た。
    if(scState.entries.every(x=>x.id!==removed.id)){scState.entries.splice(Math.min(idx,scState.entries.length),0,removed);renderTimeline()}
   }});
 }

 /* 履歴(作業中・完了)の削除(§9.61)。
    予定の削除(deleteEntry)と違い、**測定データそのもの**を消す操作なので
    別扱いにしてある。消す先が2つあることに注意:
      1. この端末の中(IndexedDB+ミラー) … 端末で測定したデータならここにある
      2. バックアップ(records.sqlite3)  … スケジュールが実績突合に使うのはこちら
    スケジュールに居座るのに「データ一覧には無い」行は、1が無くて2だけが
    残っている状態(別PCで測定した/端末側だけ消えた)。どちらの場合も消える
    ように、端末内にあればreliableDelete(1と2の両方を消す)、無ければ
    バックアップだけを直接消す。 */
 async function deleteHistoryEntry(e){
  const recordId=e.actualRecordId||'';
  if(!recordId)return;
  const lot=e.lotNo||contentValueOf(e.detail,'lotNo')||recordId;
  const stateLabel=e.state==='着手'?'作業中':'完了';
  const ok=await confirmModal({
   eyebrow:'DELETE MEASUREMENT RECORD',
   title:'この実績を削除します',
   danger:true,confirmLabel:'削除する',
   bodyHtml:`<p class="confirm-modal-message">ロット <b>${esc(lot)}</b> の実績（${esc(stateLabel)}）を削除します。</p>
    <ul class="confirm-modal-points">
     <li>削除するのは<b>測定データそのもの</b>です。作業スケジュールの行だけを消すのではありません。</li>
     <li>この端末に残っている場合はデータ一覧からも消え、バックアップ（db/records.sqlite3）からも消えます。</li>
     <li><b>元に戻せません。</b></li>
    </ul>`});
  if(!ok)return;
  await withWaiting({title:'実績を削除しています',detail:`ロット ${lot}`,
    progress:'端末内データとバックアップから削除しています'},async()=>{
   let removed=false;
   // 端末内にあるか(あれば端末＋バックアップの両方を消すreliableDeleteを使う)
   try{
    if(typeof reliableGet==='function'&&await reliableGet(recordId)){
     await reliableDelete(recordId);removed=true;
     if(typeof refreshDraftCount==='function')await refreshDraftCount();
    }
   }catch(err){console.warn('端末内データの削除に失敗',err)}
   if(!removed){
    // 端末には無い(別PCで測定した等)。バックアップ行だけを消す。
    await api('/api/measurement/backup/delete',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[recordId]})});
   }
   invalidatePlanCache();
   await loadPlan(true);
  });
  showToast('実績を削除しました',`ロット ${lot}`,4000);
 }

 /* ---------- ドラッグ並べ替え(§7.5・§9.4) + Alt+↑/↓ ---------- */
 /* ---------- 予定から外す受け皿(§9.116) ----------
    行を掴んで下端の帯へ落とすと、その予定を外す。**掴んでいる間だけ出す**
    ——常設すると「消す場所」が画面に居座り、並べ替えのたびに押し間違いの的に
    なる。外せない行(実施中・完了・計画外・現場段取り権限)では**そもそも出さない**
    ——出しておいて落としたら断る、では掴んだ手間が無駄になる。
    消す確認は deleteEntry() が持っているものをそのまま通す(確認の文言と
    取り消しの作法を2つに増やさない)。 */
 function removableEntry(id){
  const e=(scState.entries||[]).find(x=>String(x.id)===String(id));
  if(!e)return null;
  /* **読み取り専用のときは外せない**（§9.211 ②）。以前はここにセッションの
     判定が無く、行の外にある選択バー（`#scPickBar`）から素通りしていた
     ——押すと画面から一度消えてから423で戻る（しかも末尾へ）。 */
  if(sessionBlocked())return null;
  return (scState.fullControl&&e.state==='予定'&&!e.__pending&&!e.unplanned)?e:null;
 }
 /* ---------- まとめて予定から外す(§9.170) ----------
    仕掛一覧は「チェックで複数選ぶ → まとめて投入」ができる(§9.5)。
    **戻す側にも同じ操作を置く**——入れるのは一度に何件でもできるのに、
    外すのは1件ずつ、では釣り合わない。見た目・言葉・置き場所は仕掛一覧の
    選択(plan-select-bar)へ揃える(同じ操作は同じ形で出す)。
    **選べるのは removableEntry() が通す行だけ**——出しておいて落としたら
    断る、では選んだ手間が無駄になる(§9.116と同じ理由)。
    確認は**1回だけ**まとめて出す。1件ずつ確認を出すと、20件外すのに20回
    押すことになり、読まずに押す癖が付く(危ない操作ほど1回で言い切る)。 */
 function canPickEntries(){return !!scState.fullControl&&scState.boardMode==='single'}
 /* 並べ替えられる行(§9.177)。行そのものが掴めるかどうかと同じ条件
    ——日時を固定した行は動かしても時刻が変わらないので対象外(§9.38)。 */
 function reorderableEntry(id){
  const e=(scState.entries||[]).find(x=>String(x.id)===String(id));
  if(!e)return null;
  return (scState.editable&&e.reorderable&&!e.__pending&&!e.fixedStart&&!sessionBlocked())?e:null;
 }
 /* まとめて動かせる／外せる行。**どちらか一方でもできれば選べる**
    ——「外せるが動かせない(固定した予定)」「動かせるが外せない」の
    どちらも選択の対象にする。できないほうはボタン側が件数で断る。 */
 function pickableEntry(id){return removableEntry(id)||reorderableEntry(id)}
 function pickBoxHtml(e){
  if(!canPickEntries()||!pickableEntry(e.id))return '';
  const can=[removableEntry(e.id)?'外す':'',reorderableEntry(e.id)?'並べ替える':'']
            .filter(Boolean).join('・');
  return `<input type="checkbox" class="sc-pick-check"`
   +`${scState.picked.has(String(e.id))?' checked':''}`
   +` title="この予定を選ぶ（選んだぶんをまとめて${esc(can)}ことができます）">`;
 }
 /* 今この画面に出ている「まとめて扱える予定」。選択の対象も全選択の分母もこれ。 */
 function pickableEntries(){
  return canPickEntries()?visibleEntries().filter(e=>pickableEntry(e.id)):[];
 }
 function setPicked(id,on){
  const key=String(id);
  if(on)scState.picked.add(key);else scState.picked.delete(key);
  const row=$(`.sc-row-line[data-id="${CSS.escape(key)}"]`);
  if(row)row.classList.toggle('is-picked',on);
  renderPickBar($('#scTimeline'));
 }
 /* 掴んでいる一式。掴んだ行が選ばれていて、他にも選ばれていれば選択全体。 */
 function multiDragIds(id){
  const key=String(id);
  if(!scState.picked.has(key)||scState.picked.size<2)return null;
  const ids=[...scState.picked].filter(x=>pickableEntry(x));
  return ids.length>1?ids:null;
 }
 /* 掴んでいるもののうち、実際に外せるものだけ。受け皿の出し分けに使う。 */
 function draggingRemovableIds(id){
  const many=multiDragIds(id);
  if(many)return many;
  return removableEntry(id)?[String(id)]:[];
 }
 function markDragging(ids,on){
  ids.forEach(id=>{
   const row=$(`.sc-row-line[data-id="${CSS.escape(String(id))}"]`);
   if(row)row.classList.toggle('sc-dragging',on);
  });
 }
 function pickedLotOf(e){
  return e?(e.lotNo||contentValueOf(e.detail,'lotNo')||'(ロット番号なし)'):'';
 }
 function renderPickBar(timeline){
  const bar=$('#scPickBar');
  const all=$('#scPickAll');
  if(!canPickEntries()){
   scState.picked.clear();
   if(bar){bar.hidden=true;bar.innerHTML=''}
   return;
  }
  /* **消えた行のidを持ち続けない**——予定を外した後・設備を切り替えた後も
     残っていると、件数だけが合わない状態になる。描くたびに今ある行へ絞る。 */
  scState.picked=new Set([...scState.picked].filter(id=>pickableEntry(id)));
  const pool=pickableEntries();
  if(all){
   const n=pool.filter(e=>scState.picked.has(String(e.id))).length;
   all.checked=pool.length>0&&n===pool.length;
   all.indeterminate=n>0&&n<pool.length;
   all.disabled=!pool.length;
   all.title=pool.length
    ?`まとめて動かせる／外せる予定${pool.length}件をすべて選ぶ・解除します（実施中・完了・計画外は選べません）`
    :'この画面にまとめて扱える予定（未着手）はありません';
   all.onclick=ev=>{
    const on=ev.target.checked;
    pool.forEach(e=>{on?scState.picked.add(String(e.id)):scState.picked.delete(String(e.id))});
    if(timeline)timeline.querySelectorAll('.sc-row-line').forEach(r=>{
     const box=r.querySelector('.sc-pick-check');
     if(!box)return;
     box.checked=scState.picked.has(String(r.dataset.id));
     r.classList.toggle('is-picked',box.checked);
    });
    renderPickBar(timeline);
   };
  }
  if(!bar)return;
  const ids=[...scState.picked];
  if(!ids.length){bar.hidden=true;bar.innerHTML='';return}
  const lots=ids.map(id=>pickedLotOf(pickableEntry(id))).filter(Boolean);
  const head=lots.slice(0,4).join('・');
  /* **できることは件数で言う**(§9.177)。選んだ中に「外せない(固定した予定)」
     が混ざることがあるので、ボタンの数字は**実際に外せる件数**にする
     ——押してから断るのでは選んだ手間が無駄になる(§9.116と同じ)。 */
  const canRemove=ids.filter(id=>removableEntry(id));
  const canMove=ids.filter(id=>reorderableEntry(id));
  bar.hidden=false;
  bar.innerHTML=`<span class="sc-pick-count">${ids.length}件を選択中</span>`
   +`<span class="sc-pick-lots" title="${esc(lots.join('・'))}">${esc(head)}${lots.length>4?`　ほか${lots.length-4}件`:''}</span>`
   +(canRemove.length?`<button type="button" class="sc-pick-remove" id="scPickRemove">選んだ${canRemove.length}件を予定から外す</button>`:'')
   +`<button type="button" class="sc-pick-clear" id="scPickClear">選択解除</button>`
   +`<span class="sc-pick-hint">`
   +(canMove.length>1?`選んだ行のどれかを掴むと${canMove.length}件まとめて並べ替えられます。`:'')
   +(canRemove.length?'下の受け皿へ落とすとまとめて外せます。':'')
   +(canRemove.length<ids.length?`<b>${ids.length-canRemove.length}件は外せません</b>（日時を固定した予定）。`:'')
   +`</span>`;
  if($('#scPickRemove'))$('#scPickRemove').onclick=()=>removeEntries(canRemove);
  $('#scPickClear').onclick=()=>{scState.picked.clear();renderTimeline()};
 }
 /* 外す本体。1件なら今までどおり deleteEntry() を通す(確認の文言と
    取り消しの作法を2つに増やさない)。複数のときだけ、まとめた確認を出す。 */
 async function removeEntries(ids){
  const targets=[...new Set((ids||[]).map(String))].map(id=>removableEntry(id)).filter(Boolean);
  if(!targets.length)return;
  if(targets.length===1){
   scState.picked.delete(String(targets[0].id));
   return deleteEntry(targets[0].id);
  }
  const lots=targets.map(pickedLotOf);
  const shown=lots.slice(0,12),rest=lots.length-shown.length;
  const ok=await confirmModal({
   eyebrow:'REMOVE FROM SCHEDULE',
   title:`${targets.length}件の予定をまとめて外します`,
   danger:true,confirmLabel:`${targets.length}件を外す`,
   bodyHtml:`<p class="confirm-modal-message">${esc(scState.equipment)} の予定から <b>${targets.length}件</b> を外します。</p>
    <ul class="confirm-modal-points">
     <li>${esc(shown.join('・'))}${rest>0?`　ほか${rest}件`:''}</li>
     <li>外したロットは<b>仕掛一覧へ戻ります</b>。同じようにまた入れられます。</li>
     <li>消えるのは<b>予定の行だけ</b>です。測定データはそのまま残ります。</li>
    </ul>`});
  if(!ok)return;
  targets.forEach(e=>{
   const idx=scState.entries.findIndex(x=>x.id===e.id);
   if(idx===-1)return;
   scState.entries.splice(idx,1);
   scState.picked.delete(String(e.id));
   /* 失敗の戻し方は deleteEntry() と同じ——**諦めたときだけ**戻す(§9.22)。
      毎回戻すと、1回目失敗→戻す→2回目成功、でサーバーには無いのに画面に
      居座る行ができる。 */
   queuePlanOp({op:'delete',id:e.id,
    onFailure:()=>{
     if(scState.entries.every(x=>x.id!==e.id)){scState.entries.push(e);renderTimeline()}
    }});
  });
  renderTimeline();
  showToast&&showToast(`${targets.length}件を予定から外しました`,
   `${scState.equipment}／仕掛一覧へ戻ります`,3800);
 }

 function showRemoveZone(id){
  const z=$('#scDropRemove');if(!z)return;
  const ids=draggingRemovableIds(id);
  if(!ids.length){z.hidden=true;return}
  /* **何件外すのかを札に書く**(§9.170)。まとめて掴んでいるときに
     「予定から外す」とだけ出ていると、1件だけ外れると読める。
     札は小さいので(§9.238 ①)**1行に収める**——説明は`title`が持つ。 */
  const t=z.querySelector('.sc-drop-remove-text');
  if(t)t.textContent=ids.length>1?`選んだ${ids.length}件を外す`:'予定から外す';
  z.title=(ids.length>1?`ここへ落とすと、選んだ${ids.length}件をまとめて予定から外します。`
                       :'ここへ落とすと、この予定を外します。')
   +'\n確認してから外すので、間違えても止められます。'
   +'\n外した予定は仕掛一覧へ戻るので、また入れ直せます。';
  z.hidden=false;z.classList.remove('is-over');
 }
 function hideRemoveZone(){
  const z=$('#scDropRemove');if(!z)return;
  z.hidden=true;z.classList.remove('is-over');
 }
 function wireRemoveZone(){
  const z=$('#scDropRemove');if(!z||z.dataset.wired)return;
  z.dataset.wired='1';
  z.addEventListener('dragover',e=>{
   if(!scState.dragId||!draggingRemovableIds(scState.dragId).length)return;
   e.preventDefault();e.dataTransfer.dropEffect='move';
   z.classList.add('is-over');
  });
  z.addEventListener('dragleave',e=>{if(e.target===z)z.classList.remove('is-over')});
  z.addEventListener('drop',e=>{
   /* **idは持ち主の型で渡す。** 掴んだidは dataset 由来の**文字列**だが、
      deleteEntry() は `e.id===id` で探すので、文字列のまま渡すと
      見つからず**確認だけ出て何も消えない**（実際にそうなっていた）。
      引き当てた行の id をそのまま渡す。 */
   const ids=draggingRemovableIds(scState.dragId);
   if(!ids.length)return;
   e.preventDefault();e.stopPropagation();
   /* このあと起きる`dragend`が並べ替えとして確定しないよう、先に
      「始末が付いた」印を立てる(§9.201)。外すのが目的なので、途中で
      通り過ぎた位置を保存する意味が無い。 */
   scState.dragSettled=true;
   /* **並べ替えとして確定させない。** 帯へ来るまでに行のdragoverでDOMが
      動いているが、commitDragOrder()は呼ばない(外すのが目的なので、
      途中で通り過ぎた位置を保存する意味が無い)。deleteEntry()が
      renderTimeline()を呼ぶので、見た目は状態から作り直される。 */
   hideRemoveZone();
   removeEntries(ids);
  });
 }

 function wireDrag(card){
  // idは文字列のまま扱う。計画外実績(§9.33)の合成idは'actual:<記録ID>'で
  // 数値化するとNaNになり、比較もMap引きも静かに壊れる。
  card.addEventListener('dragstart',e=>{
   scState.dragId=card.dataset.id;card.classList.add('sc-dragging');e.dataTransfer.effectAllowed='move';
   /* **掴んだ時点の並びを控える**(§9.201)。確定は`dragend`で行うので、
      「動いたのか」をここと比べて決める。 */
   scState.dragOrder0=timelineRowIds();scState.dragSettled=false;
   /* 選んだ行を掴んだら**選択全体を運ぶ**(§9.170)。仕掛一覧の一括投入と
      同じ作法。掴んだ行が選ばれていなければ今までどおり1件だけ。 */
   scState.dragIds=multiDragIds(card.dataset.id);
   if(scState.dragIds)markDragging(scState.dragIds,true);
   showRemoveZone(card.dataset.id);
  });
  card.addEventListener('dragend',()=>{
   card.classList.remove('sc-dragging');
   if(scState.dragIds)markDragging(scState.dragIds,false);
   scState.dragId=null;scState.dragIds=null;hideRemoveZone();
   /* **確定は`drop`ではなく`dragend`**(§9.201)。`drop`は「直前の`dragover`が
      `preventDefault()`を呼んだ場所」でしか起きない。行のdragoverは
      **掴んでいる行自身の上では何もしない**（自分の前後へ挿しても
      位置は変わらないため）ので、DOMを動かした結果**掴んだ行がカーソルの
      下へ来た状態で離す**と、dropが一度も起きない。すると並びは画面上
      だけ変わってサーバーへは何も送られず、画面を切り替えて戻ると
      元の順に戻る（実機で「並べ替えても保存されない」と報告された）。
      子ロットの箱・行間の余白・タイムラインの地の上で離した場合も同じ。
      `dragend`は掴んだ元の要素で**必ず**起きるので、ここを確定の場にする。 */
   finishDragOrder();
  });
  card.addEventListener('dragover',e=>{
   /* **選んだぶんをまとめて並べ替える**(§9.177)。以前は複数掴んでいる間は
      並べ替えを止めていた——動かせるのが掴んだ1行だけで、通り過ぎた位置に
      1行だけ置き去りになるからだった。掴んでいる行を**まとめて**同じ位置へ
      挿し込めば、置き去りは起きない。並べ替えられない行(固定した予定)は
      運ばない(落としても位置が変わらないので、動いて見えるほうが嘘になる)。 */
   if(scState.dragId==null)return;
   const ids=(scState.dragIds&&scState.dragIds.length>1?scState.dragIds:[scState.dragId])
             .filter(id=>reorderableEntry(id)).map(String);
   if(!ids.length||ids.includes(String(card.dataset.id)))return;
   e.preventDefault();
   const rect=card.getBoundingClientRect();
   const before=(e.clientY-rect.top)<rect.height/2;
   /* DOM順のまま運ぶ(選んだ順ではない)。並べ替えは見えている順が正。 */
   const els=[...document.querySelectorAll('#scTimeline .sc-row-line')]
             .filter(r=>ids.includes(String(r.dataset.id)));
   if(!els.length)return;
   const parent=card.parentNode;
   const anchor=before?card:card.nextSibling;
   /* 子ロットの箱は行のすぐ下にぶら下がっている。**一緒に運ばないと
      親から離れる**(親子の対応が読めなくなる)。 */
   els.forEach(el=>{
    const kid=el.nextElementSibling&&el.nextElementSibling.classList.contains('sc-child-box')
              ?el.nextElementSibling:null;
    parent.insertBefore(el,anchor);
    if(kid)parent.insertBefore(kid,el.nextSibling);
   });
  });
  card.addEventListener('drop',e=>{e.preventDefault();finishDragOrder()});
  card.addEventListener('keydown',e=>{
   if(!e.altKey)return;
   if(e.key==='ArrowUp'){e.preventDefault();moveCard(card,-1)}
   else if(e.key==='ArrowDown'){e.preventDefault();moveCard(card,1)}
  });
 }
 // 高密度リスト化(§9.3改訂)により、行(.sc-row-line)の直後には折りたたみ
 // 済みの詳細パネル(.sc-row-detail)が兄弟要素として挟まることがあるため、
 // 単純なprevious/nextElementSiblingでは隣の「行」に届かないことがある。
 // 詳細パネル・非稼働帯の区切り(.sc-gap-divider)を読み飛ばして次の行を探す。
 function adjacentRow(el,dir){
  let s=dir<0?el.previousElementSibling:el.nextElementSibling;
  while(s&&!s.classList.contains('sc-row-line'))s=dir<0?s.previousElementSibling:s.nextElementSibling;
  return s;
 }
 function moveCard(card,dir){
  const sibling=adjacentRow(card,dir);
  if(!sibling)return;
  if(dir<0)card.parentNode.insertBefore(card,sibling);
  else card.parentNode.insertBefore(sibling,card);
  card.focus();
  commitDragOrder();
 }
 /* いまタイムラインに出ている行のid（DOM順）。掴む前と離した後を
    突き合わせるためだけに使う。 */
 function timelineRowIds(){
  const tl=$('#scTimeline');if(!tl)return [];
  return [...tl.querySelectorAll('.sc-row-line')].map(r=>String(r.dataset.id));
 }
 /* 掴んだ手を離したときの後始末(§9.201)。**確定は1回だけ**（`drop`が
    起きた場合は`dragend`が続けて来る）。**動いていなければ何も送らない**
    ——ただ掴んで離しただけで書込が飛ぶと、共有スケジュールへ意味の無い
    改訂が積まれる。 */
 function finishDragOrder(){
  if(scState.dragSettled)return;
  scState.dragSettled=true;
  const before=scState.dragOrder0||[];
  const now=timelineRowIds();
  scState.dragOrder0=null;
  if(!before.length)return;
  if(before.length===now.length&&before.every((v,i)=>v===now[i]))return;
  commitDragOrder();
 }
 function commitDragOrder(){
  // ドラッグは既にDOM上の並びを直接動かしている(wireDrag/moveCard)ため、
  // 画面上は既に確定した見た目になっている。scState.entries自体もこの
  // DOM順に合わせて並べ直しておくことで、キュー処理中に追加・削除の
  // 再描画が挟まってもドラッグ結果が消えない(§9.11)。実際のAPI呼び出しは
  // バックグラウンドの書込キューへ積み、画面をブロックしない。
  /* **表示順と予定順は同じではない。** タイムラインは時刻順に並べる
     (§9.39)ため、ロック(§9.38)された予定が固定日時どおりの位置へ割り込む。
     画面の並びをそのまま送ると、その割り込み位置が予定順として保存されて
     しまい、ロックを外した瞬間に意図しない順序になる。
     そこで「ロック行は予定順の位置に据え置き、動かせる行(=ロックしていない
     予定)だけを画面の並びで差し替える」形で新しい予定順を組み立てる。
     plan_reorderは並べ替え対象の全件と過不足なく一致するIDを要求するため
     (部分並べ替えは受け付けない)、ロック行も必ず含める。 */
  const previousEntries=scState.entries.slice();
  const byId=new Map(scState.entries.map(e=>[String(e.id),e]));
  const planOrder=scState.entries.filter(e=>e.reorderable);
  const domIds=[...$('#scTimeline').querySelectorAll('.sc-row-line')].map(c=>c.dataset.id);
  const movableDom=domIds.map(id=>byId.get(id)).filter(e=>e&&e.reorderable&&!e.fixedStart);
  const movablePlan=planOrder.filter(e=>!e.fixedStart);
  if(movableDom.length!==movablePlan.length){
   /* 想定外(描画と状態がずれている)。順序を壊すより何もしない方が安全。
      **黙って戻さないこと**(§9.200)——以前はconsoleへ書くだけで、画面では
      「動かしたのに元へ戻った」としか見えなかった。何が起きたのかと、
      打つ手（読み直す）を文字で出す。 */
   console.warn('並べ替え対象の件数が画面と一致しないため、並べ替えを中止しました',
    movableDom.length,movablePlan.length);
   renderTimeline();
   showToast&&showToast('並べ替えを中止しました',
    `画面の行(${movableDom.length}件)と予定(${movablePlan.length}件)が食い違っています。`
    +'「再計算」で読み直してからやり直してください。',7000);
   return;
  }
  let mi=0;
  const nextPlan=planOrder.map(e=>e.fixedStart?e:movableDom[mi++]);
  const ids=nextPlan.map(e=>e.id);
  // 画面をブロックしないよう、ローカルの並びも先に更新しておく(§9.11)。
  // 並べ替え対象の位置(スロット)はそのままに、中身だけ新しい順序へ差し替える。
  const rest=scState.entries.filter(e=>!e.reorderable);
  const slots=scState.entries.map(e=>e.reorderable);
  let ri=0,pi=0;
  scState.entries=slots.map(isPlan=>isPlan?nextPlan[pi++]:rest[ri++]);
  const equipment=scState.equipment;
  // 失敗したときに元へ戻せるよう、書き換える前の並びを控えておく。
  const previousOrder=previousEntries;
  /* **掴む前に見ていた並び**も送る（§9.291 ③）。編集セッションで操作を
     止めるのをやめたので、同じ顔ぶれのまま2人が並べ替えると後から保存した
     ほうで丸ごと上書きされる——それだけは行ごとの書き込みでは受けられない。
     サーバーが今の並びと突き合わせて、違えば409（`reorderStale`）で断る。
     **顔ぶれが違うとき**（他の端末が足した/消した）は今までどおり先に
     「一致しません」で断られる。 */
  const baseIds=planOrder.map(e=>e.id);
  queuePlanOp({op:'reorder',equipment,orderedIds:ids,baseOrderedIds:baseIds,
   onFailure:e=>{
    // 通知は諦めた時に1回だけ(runWriteQueueのリトライ中に出すと同じ文言が
    // 回数ぶん並ぶ)。サーバーが受け付けなかった並びを画面に残さないよう、
    // 元の順序へ戻してから知らせる。
    if(scState.equipment===equipment){scState.entries=previousOrder;renderTimeline()}
    if(e&&e.code==='reorderStale'){
     /* **黙って上書きしない**（§9.291 ③）。読み直して、誰が動かしたかを言う。 */
     const who=[e.byLogin,e.byPc].filter(Boolean).join('／');
     showToast&&showToast('ほかの端末が先に並べ替えました',
       (who?who+'が':'')+'並び順を変えたので、最新を読み直しました。'
       +'もう一度並べ替えてください。',8000);
     if(scState.equipment===equipment)loadPlan(true).catch(WL.quiet('予定を読み直せない（次の巡回で追いつく）'));
     return;
    }
    showToast&&showToast('並べ替えできませんでした',(e&&e.message)||'',7000);
   }});
 }

 /* ---------- 設備停止を入れる(scheduleモードのみ、§9.3 / §9.181) ----------
    利用者の指摘は「設備停止モーダルが使いにくい・見栄えも改善して」「スケジュール
    作成時の設備停止入力の部分からも設備停止の登録ができるように（メンテナンス
    しながら登録しやすい形）」。

    直したのは次の点。
     ① **どこへ入るのかを先に書く**。以前は設備名も入る位置も画面に無く、
        押してから結果を見て確かめるしかなかった。
     ② **分類は分類マスタの名前で出す**。以前は固定の5つ（保全/段取り/待ち/
        突発/その他）しか知らず、マスタへ登録した分類は**黙って「その他」へ
        落ちていた**（登録した名前が画面から消える）。
     ③ **押せるのに何も起きないボタンを置かない**（§4）。突発停止は
        「追加できないもの」として理由を**文字で**分けて出す（以前は無効な
        ボタンとツールチップだけで、なぜ押せないのか読めなかった）。
     ④ **絞り込みを付ける**。数が増えると目で探すことになる。
        **入力中に一覧だけを描き直す**（入力欄を作り直すとカーソルが飛ぶ。§9.117）
     ⑤ **その場で登録できる**。メンテナンス中に「この停止理由がまだ無い」と
        気づく場面が本番なので、マスタ管理へ行き直させない。
    置き場は`#scStopButtons`の1つで、モーダルと側パネルはこれを**移し替えて**
    使う（描画とイベント配線を2つ持たない。§9.13の作法をそのまま踏む）。 */
 async function loadStopReasons(){
  try{
   const r=await api('/api/schedule/stop-reason-master?equipment='+encodeURIComponent(scState.equipment));
   scState.stopReasons=(r.items||[]);
   renderStopButtons();
  }catch(e){WL.quiet.note('追加パネルは補助機能のためベストエフォート',e)}
 }
 /* 分類の名前は**分類マスタが持つ**。読めなくても止めない（固定の並びで出す）。 */
 let stopCategories=null;
 async function loadStopCategories(){
  if(stopCategories)return stopCategories;
  try{
   const r=await api('/api/schedule/stop-category-master');
   stopCategories=(r.items||[]).map(x=>String(x.name||'').trim()).filter(Boolean);
  }catch(e){stopCategories=[]}
  return stopCategories;
 }
 // アイコンは分かっている分類だけ。知らない分類は既定の印で出す(名前は出す)。
 /* 分類の見出しに絵文字を出さない（§9.220 2③、利用者の指示「停止項目など
    スケジュールの表記はデフォルトは絵文字などのアイコン不使用にしてくだ
    さい」）。以前は分類ごとに🔧🔄⏳⚡📋を固定で出していた。**分類名と件数は
    もともと文字で出ている**ので、絵を消しても読めなくならない（§3の
    「色だけで伝えない」を、絵にも当てはめる）。
    行に印を出したい現場は**行表示マスタ**で選べる（§9.201。既定はなし）
    ——入口を2つにしないため、ここへ設定を足し戻さないこと。 */
 const STOP_CATEGORY_BASE=['保全','段取り','待ち','突発'];
 /* 追加できない停止理由。**判定は1箇所**にして、一覧とドラッグの両方が見る。 */
 const STOP_LOCKED={'突発停止':'発生したら計画担当へ連絡してください（予定として入れるものではありません）'};
 const stopLockedReason=name=>STOP_LOCKED[String(name||'').trim()]||'';
 let stopFilter='';
 /* 分類の並び: 分類マスタ → 昔からの固定分類 → 実データにあるだけの分類 →
    分類なし。**どこにも属さない分類を消さない**のが目的。 */
 function stopCategoryOrder(){
  const seen=new Set(),out=[];
  const push=c=>{const k=String(c||'').trim();if(k&&!seen.has(k)){seen.add(k);out.push(k)}};
  (stopCategories||[]).forEach(push);
  STOP_CATEGORY_BASE.forEach(push);
  (scState.stopReasons||[]).forEach(s=>push(s.category));
  out.push('');   // 分類なしは最後
  return out;
 }
 /* 器は1度だけ作る。**絞り込みの入力欄を作り直さない**——1文字ごとに
    カーソルが飛ぶ(§9.117で読み替えルールの編集が踏んだ罠と同じ)。 */
 function ensureStopUi(box){
  if(box.dataset.stopUi)return;
  box.dataset.stopUi='1';
  box.innerHTML=`
   <div class="sc-stop-head">
    <div class="sc-stop-where" id="scStopWhere"></div>
    <input type="search" class="sc-stop-search" id="scStopSearch" autocomplete="off"
     placeholder="名称・分類で絞り込み">
   </div>
   <div class="sc-stop-list" id="scStopList"></div>
   <div class="sc-stop-new">
    <button type="button" class="sc-stop-new-toggle" id="scStopNewToggle"
     title="この設備の設備停止マスタへ、新しい停止理由を登録します">＋ 停止理由を登録</button>
    <div class="sc-stop-new-form" id="scStopNewForm" hidden>
     <label><span>名称</span><input type="text" id="scStopNewName" maxlength="60" placeholder="例: 定期メンテナンス"></label>
     <label><span>分類</span><select id="scStopNewCat"></select></label>
     <label><span>標準所要分</span><input type="text" id="scStopNewMin" inputmode="numeric" autocomplete="off" placeholder="任意"></label>
     <p class="sc-stop-new-note" id="scStopNewNote"></p>
     <div class="sc-stop-new-actions">
      <button type="button" class="sc-stop-new-cancel" id="scStopNewCancel">やめる</button>
      <button type="button" class="sc-stop-new-save" id="scStopNewSave">登録して使う</button>
     </div>
    </div>
   </div>`;
  const search=box.querySelector('#scStopSearch');
  search.addEventListener('input',()=>{stopFilter=search.value.trim();renderStopList()});
  box.querySelector('#scStopNewToggle').onclick=()=>toggleStopNewForm();
  box.querySelector('#scStopNewCancel').onclick=()=>toggleStopNewForm(false);
  box.querySelector('#scStopNewSave').onclick=()=>saveNewStopReason();
  box.querySelector('#scStopNewName').addEventListener('keydown',e=>{
   if(e.key==='Enter'){e.preventDefault();saveNewStopReason()}
  });
 }
 function toggleStopNewForm(force){
  const form=document.getElementById('scStopNewForm');
  const btn=document.getElementById('scStopNewToggle');
  if(!form)return;
  const open=force===undefined?form.hidden:!!force;
  form.hidden=!open;
  if(btn)btn.classList.toggle('active',open);
  if(open){
   renderStopNewCats();
   const note=document.getElementById('scStopNewNote');
   if(note)note.textContent=`登録先: ${scState.equipment||'(設備未選択)'} の設備停止マスタ`
    +'／マスタ管理からも直せます';
   document.getElementById('scStopNewName')?.focus();
  }
 }
 function renderStopNewCats(){
  const sel=document.getElementById('scStopNewCat');if(!sel)return;
  const cur=sel.value;
  const cats=stopCategoryOrder().filter(c=>c);
  sel.innerHTML=cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')
   +'<option value="">（分類なし）</option>';
  if([...sel.options].some(o=>o.value===cur))sel.value=cur;
 }
 async function saveNewStopReason(){
  const name=(document.getElementById('scStopNewName')?.value||'').trim();
  const cat=document.getElementById('scStopNewCat')?.value||'';
  const minRaw=(document.getElementById('scStopNewMin')?.value||'').trim();
  const note=document.getElementById('scStopNewNote');
  if(!name){if(note)note.textContent='名称を入れてください（これが予定に出る言葉になります）';return}
  if(!scState.equipment){if(note)note.textContent='設備を先に選んでください';return}
  const btn=document.getElementById('scStopNewSave');
  if(btn){btn.disabled=true;btn.textContent='登録中…'}
  try{
   await api('/api/schedule/stop-reason-master',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({equipment:scState.equipment,category:cat,name,
      standardMinutes:minRaw===''?null:Number(minRaw)}))});
   await loadStopReasons();
   toggleStopNewForm(false);
   const hit=(scState.stopReasons||[]).find(x=>String(x.name||'').trim()===name);
   showToast&&showToast('停止理由を登録しました',
    `${scState.equipment} で使えます${hit?'（そのまま押すと予定へ入ります）':''}`,3600);
   /* 登録した直後は**それが目に入る**ようにする。探し直させない。 */
   if(hit){
    stopFilter='';const search=document.getElementById('scStopSearch');
    if(search)search.value='';
    renderStopList();
    const el=document.querySelector(`.sc-stop-button[data-id="${hit.id}"]`);
    if(el){el.classList.add('is-new');el.scrollIntoView({block:'nearest'})}
   }
   const nm=document.getElementById('scStopNewName');if(nm)nm.value='';
   const mn=document.getElementById('scStopNewMin');if(mn)mn.value='';
   /* 登録の窓を閉じるとフォーカスが行き場を失う（§9.220 2②）。 */
   keepStopTyping();
  }catch(e){
   if(note)note.textContent='登録できませんでした: '+e.message;
  }finally{if(btn){btn.disabled=false;btn.textContent='登録して使う'}}
 }
 /* どこへ入るのかを**先に書く**(①)。差し込む位置を決めているときはその行も。 */
 function renderStopWhere(){
  const el=document.getElementById('scStopWhere');if(!el)return;
  const eq=scState.equipment||'(設備未選択)';
  const before=scState.insertBefore
   ?(pickedLotOf(pickableEntry(scState.insertBefore))||'選んだ行'):'';
  /* 1行で「どこへ」を言い切る。**折り返して3行になると読み飛ばされる**
     （実測で「設備名／の予定へ／いちばん後ろへ」と3段に割れていた）。 */
  el.innerHTML=`<span class="sc-stop-where-line"><b>${esc(eq)}</b> の予定 →`
   +`<span class="sc-stop-where-at">${before?esc(before)+' の前':'いちばん後ろ'}</span>へ入れます</span>`
   +'<small>押すとすぐ入ります。ドラッグすると入れる位置を選べます。</small>';
 }
 function renderStopButtons(){
  const box=$('#scStopButtons');if(!box)return;
  ensureStopUi(box);
  renderStopWhere();
  renderStopList();
  if(!document.getElementById('scStopNewForm')?.hidden)renderStopNewCats();
 }
 function stopMatches(s){
  if(!stopFilter)return true;
  const q=stopFilter.normalize('NFKC').toLowerCase();
  return `${s.name||''} ${s.category||''}`.normalize('NFKC').toLowerCase().includes(q);
 }
 function renderStopList(){
  const list=document.getElementById('scStopList');if(!list)return;
  /* 作り直すと、押したボタン（＝いまフォーカスがある要素）ごと消える。
     消えたあとに`<body>`へ落ちるとIMEが切れるので、打つ場所へ返す
     （§9.220 2②）。**外にフォーカスがあるときは触らない**。 */
  const hadFocus=list.contains(document.activeElement);
  const all=scState.stopReasons||[];
  if(!all.length){
   list.innerHTML='<div class="sc-empty-note">この設備の設備停止マスタはまだ空です。'
    +'下の「＋ 停止理由を登録」から作れます。</div>';
   if(hadFocus)keepStopTyping();
   return;
  }
  const hits=all.filter(stopMatches);
  if(!hits.length){
   list.innerHTML=`<div class="sc-empty-note">「${esc(stopFilter)}」に当てはまる停止理由はありません（${all.length}件のうち0件）。</div>`;
   if(hadFocus)keepStopTyping();
   return;
  }
  const usable=hits.filter(s=>!stopLockedReason(s.name));
  const locked=hits.filter(s=>stopLockedReason(s.name));
  const groups=new Map();
  usable.forEach(s=>{
   const cat=String(s.category||'').trim();
   if(!groups.has(cat))groups.set(cat,[]);
   groups.get(cat).push(s);
  });
  const label=c=>c||'分類なし';
  list.innerHTML=stopCategoryOrder().filter(c=>groups.has(c)).map(cat=>{
   const items=groups.get(cat).map(s=>
    `<button type="button" class="sc-stop-button" data-id="${s.id}" draggable="true"
      title="押すと予定へ入ります／ドラッグで入れる位置を選べます">`
    +`<b>${esc(s.name)}</b>`
    +`<small>${s.standardMinutes?esc(WL.duration.text(s.standardMinutes)):'見積は自動'}</small></button>`).join('');
   return `<div class="sc-stop-group">
    <div class="sc-stop-group-title">${esc(label(cat))}
     <span class="sc-stop-group-count">${groups.get(cat).length}件</span></div>
    <div class="sc-stop-buttons">${items}</div>
   </div>`;
  }).join('')
  /* ③ 追加できないものは**別に出して理由を書く**。押せるのに何も起きない
     ボタンを残さない（無効なボタンとツールチップでは理由が読めない）。 */
  +(locked.length?`<div class="sc-stop-locked">
    <div class="sc-stop-locked-title">予定には入れられません</div>
    ${locked.map(s=>`<div class="sc-stop-locked-row"><b>${esc(s.name)}</b>`
      +`<span>${esc(stopLockedReason(s.name))}</span></div>`).join('')}
   </div>`:'')
  +(hits.length<all.length?`<div class="sc-stop-more">絞り込み中: ${hits.length} / ${all.length}件</div>`:'');
  list.querySelectorAll('.sc-stop-button').forEach(btn=>{
   const reasonId=+btn.dataset.id;
   const reason=(scState.stopReasons||[]).find(s=>s.id===reasonId);
   const label2=(reason&&reason.name)||btn.textContent.trim();
   // ドラッグ&ドロップでの追加(§9.13): list-view.jsの仕掛行と同じ
   // window.__scDragRows方式のハンドオフを、設備停止ボタン専用にもう1系統
   // 用意する(wireDropTarget側で判別)。落とした位置へ入る(§9.179)。
   btn.addEventListener('dragstart',e=>{
    window.__scDragStopReason={id:reasonId,name:label2};
    e.dataTransfer.effectAllowed='copy';
    try{e.dataTransfer.setData('text/plain',label2)}catch(err){WL.quiet.note('一部ブラウザでのsetData制限は無視する',err)}
    btn.classList.add('is-row-dragging');
   });
   btn.addEventListener('dragend',()=>{btn.classList.remove('is-row-dragging');window.__scDragStopReason=null});
   btn.onclick=()=>addStopReasonToSchedule(reasonId,label2);
  });
  if(hadFocus)keepStopTyping();
 }
 /* ---------- 日本語入力（IME）を落とさない（§9.220 2②、利用者の報告） ----------
    「停止項目入れ次を入れようとすると文字変換がローマ字入力に変わって
     しまう」

    起きていること: 絞り込み欄で日本語を打つ → 候補のボタンを押す →
    **フォーカスがボタンへ移る**（Chromeはボタンでもフォーカスを取る）→
    文字を打つ場所が無くなるのでIMEが切られる。さらに`renderStopList()`が
    一覧を作り直すので、押したボタンごと消えて`document.activeElement`は
    `<body>`になる。この状態から欄をクリックし直しても、Windowsの既定
    （ウィンドウごとに入力モードを持つ）では**かな入力へは戻らず半角英数の
    まま**なので、次の1文字目からローマ字になる。

    直し方は「文字を打つ場所を絶やさない」こと——押した操作の中で
    絞り込み欄へフォーカスを返す。`mousedown`で`preventDefault()`して
    フォーカスを移さない手もあるが、**この一覧はドラッグで入れる位置も
    選べる**（§9.13）ので使えない: Chromeは`mousedown`の既定動作を止めると
    HTML5のドラッグを開始しない。

    **既に別の入力欄に居るときは奪わない**（打っている最中を邪魔しない）。
    `type=number`の欄も置かない——Chromeはあの型でIMEを切るので、そこを
    通っただけで同じことが起きる（`scStopNewMin`を文字の欄へ直してある。
    §9.208 ③と同じ判断）。 */
 function keepStopTyping(){
  const s=document.getElementById('scStopSearch');
  if(!s||!s.offsetParent)return;
  const a=document.activeElement;
  if(a===s)return;
  if(a&&a!==document.body&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.isContentEditable))return;
  try{s.focus({preventScroll:true})}catch(err){s.focus()}
 }
 function addStopReasonToSchedule(reasonId,label){
  if(!scState.equipment)return;
  if(sessionBlocked()){
   showToast&&showToast('追加できません',sessionHolderMessage(),4000);
   return;
  }
  const target=scState.equipment;
  const before=takeInsertBefore();
  const entry=makeOptimisticEntry('設備停止',{title:label});
  insertEntriesAt(before,[entry]);
  renderTimeline();
  queuePlanOp({op:'add',equipment:target,kind:'設備停止',
   position:before?`before:${before}`:'end',stopReasonId:reasonId,
   onSuccess:r=>resolveOptimisticEntry(entry,r),onFailure:()=>discardOptimisticEntry(entry)});
  showToast&&showToast('設備停止を追加しました',`${target}の予定に追加しました(${label})`,3200);
  /* **打つ場所を絶やさない**（§9.220 2②）。ここを外すと、次の絞り込みが
     半角英数から始まる。 */
  keepStopTyping();
 }

 /* ---------- 入れた設備停止を直す（§9.220 2①、利用者の指示） ----------
    「停止項目入れると変更できないので、右クリックやダブルクリックで
     編集・変更できるようにしたい」

    以前は**入れたら最後**で、名前を間違えても所要分がずれても、いったん
    外して入れ直すしかなかった（外す→探す→入れる→位置を直す、の4手）。

    決めごと:
     ・直せるのは**名称・所要分・備考**の3つ。区分（設備停止であること）と
       設備は動かさない——動かせるようにすると「別の行を作る」のと同じに
       なり、どちらの操作なのか決められない。
     ・**入口はコメントと同じ2つ**（ダブルクリック／右クリック）。同じ
       「予定の列に挟んだ行」なので、直し方が2通りあるのはおかしい。
     ・**いま効いている見積とその出どころを必ず出す**（§9.114）——同じ
       「60分」でも、設備停止マスタの標準所要分と手で入れた値では
       打つ手が違う。空欄は「未設定」であって0分ではない。
     ・**名称を空にできない**（何の停止か分からない行が残る）。サーバー側
       (`plan_update`)でも断る——画面だけで守ると、別の入口から空が入る。 */
 function stopEditable(e){
  return !!e&&e.kind==='設備停止'&&e.state==='予定'&&!e.__pending
    &&scState.fullControl&&!sessionBlocked();
 }
 /* **直せない理由を1箇所で答える**（§4）。メニューの断り書きと、押した
    ときのトーストが同じ言葉になるようにする——2箇所で書くと食い違う。 */
 function stopEditBlockReason(e){
  if(!e||e.kind!=='設備停止')return 'これは設備停止の行ではありません';
  if(e.__pending)return 'サーバーへ反映中です。反映されたら直せます';
  if(e.state!=='予定')return '着手・完了した行の内容は変えられません（実績と食い違うため）';
  if(!scState.fullControl)return 'この画面では直せません（スケジュールモードで開くと直せます）';
  if(sessionBlocked())return sessionHolderMessage();
  return '';
 }
 function stopReasonNames(){
  return [...new Set((scState.stopReasons||[])
    .map(s=>String(s.name||'').trim()).filter(Boolean))];
 }
 async function editStopEntry(id){
  const e=(scState.entries||[]).find(x=>String(x.id)===String(id));
  if(!e)return;
  if(!stopEditable(e)){
   showToast&&showToast('この行は直せません',stopEditBlockReason(e),4500);
   return;
  }
  const before={title:String(e.title||''),
                minutes:(e.estimateMinutes==null||e.estimateMinutes===''
                         ?'':String(e.estimateMinutes)),
                remark:String(e.remark||'')};
  const est=e.estimate||{};
  const nowText=Number.isFinite(Number(est.minutes))
    ?`${WL.duration.text(Number(est.minutes))}（${esc(estimateSourceLabel(est.source))}）`
    :'決まっていません';
  const ok=await confirmModal({
   eyebrow:'STOP',title:'設備停止の内容を変える',
   bodyHtml:`<div class="sc-stop-edit">
     <label class="sc-stop-edit-row"><span>名称</span>
      <input type="text" id="scStopEditName" maxlength="60" list="scStopEditNames"
        value="${esc(before.title)}" autocomplete="off"></label>
     <datalist id="scStopEditNames">${stopReasonNames()
        .map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
     <label class="sc-stop-edit-row"><span>所要分</span>
      <input type="text" id="scStopEditMin" inputmode="numeric" autocomplete="off"
        value="${esc(before.minutes)}" placeholder="空欄＝自動で見積る"></label>
     <p class="confirm-modal-note">いま効いている見積: <b>${nowText}</b>。
      空欄にすると設備停止マスタの標準所要分から自動で見積ります
      （<b>0分は「0分の停止」</b>として扱われます）。</p>
     <label class="sc-stop-edit-row"><span>備考</span>
      <input type="text" id="scStopEditRemark" maxlength="200"
        value="${esc(before.remark)}" autocomplete="off"></label>
     <p class="confirm-modal-note">直せるのはこの3つです。設備と区分は変えられません
      ——別の設備・別の区分にしたいときは、いったん外して入れ直してください。</p>
    </div>`,
   confirmLabel:'変える',cancelLabel:'やめる'});
  const name=String(($('#scStopEditName')||{}).value||'').trim().slice(0,60);
  const minRaw=String(($('#scStopEditMin')||{}).value||'').trim();
  const remark=String(($('#scStopEditRemark')||{}).value||'').trim().slice(0,200);
  if(!ok)return;
  if(!name){showToast&&showToast('名称が空です','何の停止かが分からない行になります',3600);return}
  const minutes=minRaw===''?null:Number(minRaw);
  if(minRaw!==''&&(!Number.isFinite(minutes)||minutes<0)){
   showToast&&showToast('所要分が数字ではありません','空欄にすると自動で見積ります',3600);return;
  }
  if(name===before.title&&minRaw===before.minutes&&remark===before.remark)return;
  /* **書き始めたあとに読み取り専用になることがある**（別の端末が編集権を
     奪ったとき。§9.211 ②）。送る直前にもう一度見る。 */
  if(sessionBlocked()){showToast&&showToast('保存できません',sessionHolderMessage(),5000);return}
  const undo={title:e.title,estimateMinutes:e.estimateMinutes,remark:e.remark};
  e.title=name;e.estimateMinutes=minutes;e.remark=remark;
  renderTimeline();
  queuePlanOp({op:'update',id:e.id,title:name,estimateMinutes:minutes,remark:remark,
   /* **所要分を変えるとその後ろの時刻が全部動く**（§9.185）。取り直しは
      書込キューが持っている——`opShiftsTime`は「titleだけの更新」以外を
      時刻が動く操作と数えるので、`estimateMinutes`を載せたこの操作は
      そのまま`loadPlan(true)`まで行く。**ここで自分でも呼ばないこと**
      （同じ問い合わせが2本飛ぶ）。 */
   onFailure:()=>{Object.assign(e,undo);renderTimeline();
    showToast&&showToast('設備停止を変えられませんでした','元の内容へ戻しました',6000)}});
 }

 /* ---------- 申し送り（コメント）を挟む(§9.189、利用者の指示) ----------
    「コメントもできるものを設備停止のように追加できるように」。設備停止と
    同じく予定の列へ挟むが、**時間は取らない**——申し送りを1行入れるたびに
    後ろの予定が押されるのでは、書く気が失せる。
    差し込む位置は設備停止と同じ決まり（カーソルの位置。§9.179）。 */
 async function addComment(){
  if(!scState.equipment)return;
  if(sessionBlocked()){
   showToast&&showToast('追加できません',sessionHolderMessage(),4000);return;
  }
  /* 入る場所は**画面が指している位置**(§9.179)。`insertPinned`は
     「固定しているか」の真偽で、位置そのものは`scState.insertBefore`。 */
  const before=scState.insertBefore||'';
  const whereRow=before?(scState.entries||[]).find(e=>String(e.id)===String(before)):null;
  const where=whereRow
   ?`「${esc(whereRow.lotNo||whereRow.title||'この予定')}」の前へ入ります。`
   :'いちばん後ろへ入ります（行の間をクリックして位置を決められます）。';
  const ok=await confirmModal({
   eyebrow:'COMMENT',title:'申し送りを入れる',
   bodyHtml:`<p class="confirm-modal-message">予定の列にコメントを1行挟みます。<b>時間は取りません</b>（後ろの予定の時刻は動きません）。</p>
    <label class="sc-comment-field"><span>内容</span>
     <textarea id="scCommentText" rows="3" maxlength="200" placeholder="例）このロットから新しい刃に交換すること"></textarea></label>
    <p class="confirm-modal-note">${esc(where)}</p>`,
   confirmLabel:'入れる',cancelLabel:'やめる'});
  const box=document.getElementById('scCommentText');
  const text=String(box&&box.value||'').trim().slice(0,200);
  if(!ok)return;
  if(!text){showToast&&showToast('コメントが空です','内容を入れてから押してください',3000);return}
  addCommentAt(text);
 }
 /* ---------- 申し送りをその場で書く(§9.191) ----------
    利用者の指示「配置されたコメント欄をダブルクリックなどで編集モードに
    移行し入力する」。**行を作り直さない**のが要点で、この画面は
    10秒ごとの見張り(§9.188)・書込キューの後始末・並べ替えのたびに
    `renderTimeline()`で行ごと作り直す。入力欄をそこへ置くと、打っている
    最中に消える（受信欄と同じ罠。§9.122）。
      ・編集中は`scState.editingComment`を立て、勝手な読み直しを止める
      ・確定したらセルの文字だけ差し替える（`applyWorkableFlags`と同じ手）
      ・失敗したら元の文字へ戻す（楽観的更新は`updateFixedStart`が手本） */
 function commentEditable(e){
  return !!e&&e.kind==='コメント'&&e.state==='予定'&&!e.__pending
    &&scState.fullControl&&!sessionBlocked();
 }
 function commentRowOf(id){
  return [...document.querySelectorAll('.sc-row-line')]
   .find(r=>String(r.dataset.id)===String(id))||null;
 }
 function startCommentEdit(id){
  const entry=(scState.entries||[]).find(x=>String(x.id)===String(id));
  const row=commentRowOf(id);
  if(!entry||!row||!commentEditable(entry))return;
  const cell=row.querySelector('.sc-row-title')||row.querySelector('[data-col]');
  if(!cell||cell.querySelector('textarea'))return;
  scState.editingComment=String(id);
  const before=entry.title||'';
  const box=document.createElement('textarea');
  box.className='sc-comment-edit';box.rows=1;box.maxLength=200;box.value=before;
  box.title='Enterで確定／Escでやめる';
  cell.textContent='';cell.appendChild(box);
  box.focus();box.setSelectionRange(box.value.length,box.value.length);
  const finish=save=>{
   if(scState.editingComment!==String(id))return;
   scState.editingComment=null;
   const next=String(box.value||'').trim().slice(0,200);
   /* **書き始めたあとに読み取り専用になることがある**（別の端末が編集権を
      奪ったとき。§9.211 ②）。確定の直前にもう一度見て、書かずに戻す。 */
   if(save&&sessionBlocked()){
    paintCommentCell(entry,before);
    showToast&&showToast('保存できません',sessionHolderMessage(),5000);
    return;
   }
   if(!save||next===before){paintCommentCell(entry,before);return}
   entry.title=next;paintCommentCell(entry,next);
   queuePlanOp({op:'update',id:entry.id,title:next,
    onFailure:()=>{entry.title=before;paintCommentCell(entry,before);
     showToast&&showToast('コメントを保存できませんでした','元の内容へ戻しました',6000)}});
  };
  box.addEventListener('keydown',ev=>{
   /* 1行の申し送りなのでEnterで確定。改行を入れたいときはShift+Enter。 */
   if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();finish(true)}
   else if(ev.key==='Escape'){ev.preventDefault();finish(false)}
  });
  box.addEventListener('blur',()=>finish(true));
 }
 /* セルの文字だけ書き換える。**行を作り直さない**（作り直すと、選択・
    掴んでいる状態・開いている詳細まで巻き添えになる）。 */
 function paintCommentCell(entry,text){
  const row=commentRowOf(entry.id);if(!row)return;
  const cell=row.querySelector('.sc-row-title')||row.querySelector('[data-col]');
  if(!cell)return;
  const shown=String(text||'').trim()||'（ダブルクリックで書けます）';
  cell.textContent=shown;
  cell.title=String(text||'')||'まだ何も書かれていません';
  cell.classList.toggle('is-empty',!String(text||'').trim());
 }

 /* 本文と位置を受けて入れる本体。**D&Dは空のまま入れる**(§9.191)ので、
    ここは空文字も通す（サーバー側も空を受ける。書くのは後）。 */
 function addCommentAt(text,opts={}){
  if(!scState.equipment)return;
  const target=scState.equipment;
  const at=takeInsertBefore();
  const entry=makeOptimisticEntry('コメント',{title:String(text||'')});
  insertEntriesAt(at,[entry]);
  renderTimeline();
  queuePlanOp({op:'add',equipment:target,kind:'コメント',title:String(text||''),
   position:at?`before:${at}`:'end',
   onSuccess:r=>{
    resolveOptimisticEntry(entry,r);
    /* 落として入れた空の枠は、**そのまま書ける状態にする**——枠だけ置いて
       「次にどうするか」を探させない。**印を立てて描き終わりで開く**
       ——追加のあとは時刻の取り直し(§9.185)で行が作り直されるので、
       ここで直接開くと入力欄ごと消える。 */
    if(opts.focus)scState.focusComment=String(entry.id);
   },
   onFailure:()=>discardOptimisticEntry(entry)});
  showToast&&showToast(text?'申し送りを入れました':'コメントの枠を入れました',
    text?String(text).slice(0,40):'枠をダブルクリックすると書けます',3200);
 }

 /* ================= 空の日付・直の枠(§9.238 ②) =================
    利用者の指示:
     「予定を少し飛ばして設定する場合に、何も予定がない領域にセットできる、
      空の日付や直の枠を登録できるようにしたいです。これを作ると、日にちや
      直をいくつか飛ばして、先のスケジュールを先に決めることができるように
      なるので、そういった都合よく使える枠を実装してください。スケジュールが
      押し出してくる際は連動してロットが自然にその設定枠に入るようにします」

    決めごと（サーバー側は backend/repositories/schedule_repo.py の
    normalize_frame / backend/schedule_calc.py の frame_target）:
     ・枠が持つのは **日付と直の名称** だけ。実時刻は展開のたびに勤務形態
       マスタから引き直す（直の時間帯を直したら枠も追随する）。
     ・**枠自身は時間を使わない**（見積0分）。効くのは「ここから先は
       その日・その直の頭から」——後続の起点を**前へ進めるだけ**。
     ・起点が既に枠を過ぎていたら何もしない＝**手前へ予定を足していくと、
       空けておいた時間へ自然に埋まっていく**（利用者の言う「押し出して
       くる際は連動してロットが自然にその設定枠に入る」）。
     ・**中身の無い枠は作らない**（§4）。コメント(§9.191)は「枠を置いてから
       書く」でよいが、日付の無い枠は何も起こさない行なので、落とした位置を
       控えたうえで**先に日付を聞く**。 */
 /* 直の候補は設備ごと。**画面に書き写さない**——勤務形態マスタが持っている
    ものを引く（§9.163。写すと増やしたときに2箇所直すことになる）。
    取得は`WL.ttlCache`（CLAUDE.md「新しいキャッシュはWL.ttlCache」）。 */
 const frameShiftCache=WL.ttlCache(5*60*1000,12);
 async function frameShiftChoices(equipment){
  const eq=String(equipment||'');
  if(!eq)return [];
  return frameShiftCache.fetch(eq,async()=>{
   const r=await api(`/api/schedule/shift-pattern-master?equipment=${encodeURIComponent(eq)}`);
   const out=[],seen=new Set();
   (r.items||[]).forEach(p=>(p.segments||[]).forEach(sg=>{
    const name=String(sg.name||'').trim();
    if(!name||seen.has(name))return;
    seen.add(name);out.push({name,start:String(sg.start||''),end:String(sg.end||'')});
   }));
   return out;
  });
 }
 /* 枠を直せるか。設備停止・コメントと同じ条件（§9.211 ②の読み取り専用も見る）。 */
 function frameEditable(e){
  return !!e&&e.kind==='枠'&&e.state==='予定'&&!e.__pending
    &&scState.fullControl&&!sessionBlocked();
 }
 /* 既定の日付。**今日ではなく「いま並んでいる予定の最後の日の次の日」**
    ——枠は「先を決める」ための道具なので、今日を出されても必ず打ち直す
    ことになる。予定が1本も無ければ今日。 */
 function frameDefaultDate(){
  let last='';
  (scState.entries||[]).forEach(e=>{
   const d=String(e.workDate||'').trim();
   if(d&&d>last)last=d;
  });
  const base=last?new Date(`${last}T00:00:00`):new Date();
  if(Number.isNaN(base.getTime()))return frameIso(new Date());
  if(last)base.setDate(base.getDate()+1);
  return frameIso(base);
 }
 const frameIso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

 /* 日付・直を聞く窓。**入れるときも直すときも同じ窓**（入口を2つにしない・
    §9.207）。`id`がnullなら新しく入れる、あれば直す。 */
 async function openFramePicker(id,opts={}){
  if(!scState.equipment){showToast&&showToast('設備を選んでください','',3000);return}
  const entry=id==null?null:(scState.entries||[]).find(x=>String(x.id)===String(id));
  if(id!=null&&!entry)return;
  if(entry&&!frameEditable(entry)){
   showToast&&showToast('この枠は直せません',
     entry.__pending?'サーバーへ反映中です。反映されたら直せます'
       :(sessionBlocked()?sessionHolderMessage():'この行は直せません'),4500);
   return;
  }
  if(!entry&&sessionBlocked()){
   showToast&&showToast('枠を入れられません',sessionHolderMessage(),5000);return;
  }
  /* 直の一覧は**開く前に取る**（§9.182「開く前に用意する」）。読めなくても
     窓は開く——日付だけの枠は作れるので、機能ごと閉ざさない。 */
  let shifts=[];let shiftErr='';
  try{shifts=await frameShiftChoices(scState.equipment)||[]}
  catch(err){shifts=[];shiftErr=err&&err.message||'読めませんでした'}
  const cur=entry?(entry.frame||entry.detail||{}):{};
  const curDate=String(cur.date||cur.frameDate||'')||frameDefaultDate();
  const curShift=String(cur.shift||cur.frameShift||'');
  const curNote=String(cur.note||cur.frameNote||'');
  const shiftBtns=[{name:'',start:'',end:''}].concat(shifts).map(sh=>{
   const on=String(sh.name||'')===curShift;
   const label=sh.name||'その日の頭から';
   const sub=sh.name?`${sh.start||'?'}〜${sh.end||'?'}`:'稼働の始まりに合わせます';
   return `<label class="sc-frame-shift${on?' is-on':''}">
     <input type="radio" name="scFrameShift" value="${esc(sh.name||'')}"${on?' checked':''}>
     <span><b>${esc(label)}</b><small>${esc(sub)}</small></span></label>`;
  }).join('');
  const asked=confirmModal({
   eyebrow:'FRAME',title:entry?'枠の日付・直を変える':'空の日付・直の枠を入れる',
   bodyHtml:`<div class="sc-frame-edit">
     <label class="sc-frame-row"><span>日付</span>
      <input type="date" id="scFrameDate" value="${esc(curDate)}"></label>
     <div class="sc-frame-row sc-frame-row-shifts"><span>直</span>
      <div class="sc-frame-shifts">${shiftBtns}</div></div>
     ${shiftErr?`<p class="confirm-modal-note">直の一覧を読めませんでした（${esc(shiftErr)}）。日付だけの枠として入れられます。</p>`
       :(shifts.length?'':'<p class="confirm-modal-note">この設備には勤務区分が登録されていません。日付だけの枠として入れられます。</p>')}
     <label class="sc-frame-row"><span>メモ</span>
      <input type="text" id="scFrameNote" maxlength="120" value="${esc(curNote)}"
        placeholder="何のために空けるか（任意）" autocomplete="off"></label>
     <p class="confirm-modal-note"><b>この枠は時間を使いません。</b>
      ここから下の予定を、選んだ日・直の頭から並べ直すだけです。
      手前に予定を足していくと、空けておいた時間へ自然に入っていき、
      追い越したら枠は何もしなくなります。</p>
    </div>`,
   confirmLabel:entry?'変える':'入れる',cancelLabel:'やめる'});
  /* **選んだ札の面を追随させる**（§9.229 ②「選んだ札のほうが濃い」）。
     窓は`confirmModal`が組み立てるので、**待つ前に**配線する
     ——`await`のあとでは、もう選び終わっている。 */
  requestAnimationFrame(()=>{
   const labels=[...document.querySelectorAll('.sc-frame-shift')];
   labels.forEach(l=>{
    const inp=l.querySelector('input');
    if(inp)inp.onclick=()=>labels.forEach(x=>x.classList.toggle('is-on',
      !!x.querySelector('input')&&x.querySelector('input').checked));
   });
  });
  const ok=await asked;
  const date=String(($('#scFrameDate')||{}).value||'').trim();
  const shift=String((document.querySelector('input[name="scFrameShift"]:checked')||{}).value||'').trim();
  const note=String(($('#scFrameNote')||{}).value||'').trim().slice(0,120);
  if(!ok){if(!entry)clearInsertPin();return}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
   showToast&&showToast('日付を入れてください','枠は「いつから」を決める行なので、日付が要ります',4000);
   if(!entry)clearInsertPin();
   return;
  }
  /* **送る直前にもう一度見る**（別の端末が編集権を奪っていることがある。§9.211 ②）。 */
  if(sessionBlocked()){showToast&&showToast('保存できません',sessionHolderMessage(),5000);return}
  const frame={frameDate:date,frameShift:shift,frameNote:note};
  if(entry)updateFrameEntry(entry,frame);
  else addFrameAt(frame,opts);
 }
 /* 入れる本体。位置は落とした場所（無ければ固定した位置／末尾）。 */
 function addFrameAt(frame,opts={}){
  const target=scState.equipment;
  const at=opts.before!==undefined?opts.before:takeInsertBefore();
  const entry=makeOptimisticEntry('枠',{
   title:`${frame.frameDate}${frame.frameShift?' '+frame.frameShift:''}`,
   detail:{...frame},
   /* 反映されるまでは「まだ分かりません」と出す——0分の空きと言い切らない
      （§6。ここで`reached:true`を作ると「もう埋まった」と嘘になる）。 */
   frame:{date:frame.frameDate,shift:frame.frameShift,note:frame.frameNote,
          target:null,gapMinutes:null,reached:false,warning:''}});
  insertEntriesAt(at,[entry]);
  renderTimeline();
  queuePlanOp({op:'add',equipment:target,kind:'枠',detail:{...frame},
   position:at?`before:${at}`:'end',
   onSuccess:r=>resolveOptimisticEntry(entry,r),
   onFailure:()=>discardOptimisticEntry(entry)});
  showToast&&showToast('日付・直の枠を入れました',
   `${frameDateLabel(frame.frameDate)}${frame.frameShift?' '+frame.frameShift:''} から並べ直します`,3600);
 }
 /* 直す本体。**画面を先に書き換えてから送る**（失敗したら戻す）。 */
 function updateFrameEntry(entry,frame){
  const before={detail:entry.detail,frame:entry.frame,title:entry.title};
  entry.detail={...(entry.detail||{}),...frame};
  entry.frame={...(entry.frame||{}),date:frame.frameDate,shift:frame.frameShift,
               note:frame.frameNote,gapMinutes:null,reached:false};
  renderTimeline();
  queuePlanOp({op:'update',id:entry.id,frame:{...frame},
   /* **時刻が動く操作**なので、書込キューが`loadPlan(true)`まで面倒を見る
      （§9.185。ここで自分でも呼ぶと同じ問い合わせが2本飛ぶ）。 */
   onFailure:()=>{Object.assign(entry,before);renderTimeline();
    showToast&&showToast('枠を変えられませんでした','元の内容へ戻しました',6000)}});
 }

 /* ---------- 設備停止のポップアップ表示(§9.13新設) ----------
    常時表示だと視野(タイムラインの縦幅)を圧迫するという指摘のため、
    .sc-side内は折りたたみ既定(上のensurePanelでhidden属性を付与済み)にし、
    ヘッダーの「⛔ 設備停止」ボタンから素早く開けるフローティングモーダルを
    追加の入口として用意する。#scStopButtons自体を場所だけ動かす(仕掛一覧の
    ポップアップ、moveGridTo/returnGridHomeと同じ考え方。renderStopButtons()の
    描画・イベント配線を2重に持たない)。 */
 let stopModalOpen=false,stopAnchor=null;
 function ensureStopAnchor(){
  if(stopAnchor)return stopAnchor;
  const box=document.getElementById('scStopButtons');
  if(!box||!box.parentNode)return null;
  stopAnchor=document.createComment('sc-stop-anchor');
  box.parentNode.insertBefore(stopAnchor,box);
  return stopAnchor;
 }
 function ensureStopModal(){
  let modal=document.getElementById('scStopModal');
  if(modal)return modal;
  modal=document.createElement('div');modal.className='sc-float-win';modal.id='scStopModal';modal.hidden=true;
  modal.innerHTML=`
   <div class="sc-float-header"><div><h2>設備停止を追加</h2></div><button type="button" id="scStopModalClose" title="閉じる">×</button></div>
   <div class="sc-float-body" id="scStopModalBody"></div>
   <div class="sc-float-resize" title="ドラッグでサイズ変更"></div>`;
  document.body.appendChild(modal);
  modal.querySelector('#scStopModalClose').onclick=()=>closeStopModal();
  /* 既定を変えたら**保存キーも変える**——古い値を覚えている端末に新しい
     既定が届かない(§9.105と同じ約束)。絞り込みと登録の欄が増えたぶん広げる。 */
  WL.makeFloatingWindow(modal,{storageKey:'scStopModalRectV2',defaultWidth:460,defaultHeight:560,defaultTop:80,minWidth:320,minHeight:320});
  return modal;
 }
 function openStopModal(){
  if(!ensureStopAnchor())return;
  const modal=ensureStopModal();
  const box=document.getElementById('scStopButtons');
  if(box){box.hidden=false;modal.querySelector('#scStopModalBody').appendChild(box)}
  modal.hidden=false;stopModalOpen=true;
  $('#scStopModalBtn')?.classList.add('active');
 }
 function closeStopModal(){
  const modal=document.getElementById('scStopModal');
  if(!modal||modal.hidden)return;
  clearInsertPin();      // 差し込む位置の固定も外す(§9.179)
  const box=document.getElementById('scStopButtons');
  if(box&&stopAnchor)stopAnchor.parentNode.insertBefore(box,stopAnchor);
  modal.hidden=true;stopModalOpen=false;
  $('#scStopModalBtn')?.classList.remove('active');
 }

 /* ---------- 設備ごとのスケジュール列表示マスタ(§9.18新設) ----------
    分割/ポップアップ表示の仕掛一覧に出す列を設備ごとに選べるようにする
    (backend/repositories/master_repo.pyのSCHEDULE_COLUMN_TABLE)。1件も
    選ばれていない設備は「未設定=全列表示」(他マスタと同じ互換ポリシー)。
    list-view.js renderGrid()はwindow.scColumnAllowlist()を呼んでフィルタ
    する(関数の定義は1箇所、列フィルタ自体の実装はlist-view.js側のみ)。 */
 let scColumnPrefs={equipment:'',columns:null};
 async function loadScheduleColumnPrefs(){
  if(!scState.equipment){scColumnPrefs={equipment:'',columns:null};return}
  const eq=scState.equipment;
  try{
   const r=await api('/api/schedule-column-master?equipment='+encodeURIComponent(eq));
   if(scState.equipment!==eq)return; // 応答が届く前に設備が切り替わっていたら結果を捨てる
   scColumnPrefs={equipment:eq,columns:(r.columns&&r.columns.length)?r.columns:null};
  }catch(e){
   if(scState.equipment!==eq)return;
   scColumnPrefs={equipment:eq,columns:null}; // 取得に失敗しても全列表示にフォールバックする(fail-open)
  }
  refreshScheduledLotFilter();
 }
 window.scColumnAllowlist=function(){
  if(!scState.fullControl||!scState.equipment||scColumnPrefs.equipment!==scState.equipment)return null;
  return scColumnPrefs.columns;
 };

 /* 仕掛一覧の表示列を選ぶウィンドウ。ボタンは一覧側のツールバー
    (list-view.jsの#listColumnBtn)にあり、ここは実装だけを持つ
    (操作対象=仕掛一覧の近くにボタンを置くため。以前はスケジュール
    ヘッダーにあり、何に効く設定なのか分かりにくかった)。 */
 let columnModalOpen=false;
 function ensureColumnModal(){
  let modal=document.getElementById('scColumnModal');
  if(modal)return modal;
  modal=document.createElement('div');modal.className='sc-float-win';modal.id='scColumnModal';modal.hidden=true;
  modal.innerHTML=`
   <div class="sc-float-header"><div><h2>仕掛一覧に表示する列</h2></div><button type="button" id="scColumnModalClose" title="閉じる">×</button></div>
   <div class="sc-float-body" id="scColumnModalBody"></div>
   <div class="sc-float-foot" id="scColumnModalFoot"></div>
   <div class="sc-float-resize" title="ドラッグで大きさを変えられます"></div>`;
  document.body.appendChild(modal);
  modal.querySelector('#scColumnModalClose').onclick=()=>closeColumnModal();
  WL.makeFloatingWindow(modal,{storageKey:'scColumnModalRectV2',defaultWidth:360,defaultHeight:500,defaultTop:80,minWidth:300,minHeight:300});
  return modal;
 }
 function renderColumnModalBody(){
  const body=document.getElementById('scColumnModalBody');if(!body)return;
  if(!scState.equipment){body.innerHTML='<div class="sc-empty-note">設備を選択してください。</div>';return}
  const allCols=(typeof S!=='undefined'?S.columns:null)||[];
  if(!allCols.length){body.innerHTML='<div class="sc-empty-note">仕掛一覧を先に開いてください(列名の取得が必要です)。</div>';return}
  const selected=(scColumnPrefs.equipment===scState.equipment&&scColumnPrefs.columns)?new Set(scColumnPrefs.columns):null;
  body.innerHTML=`<p class="sc-drop-hint">${esc(scState.equipment)}の仕掛一覧に出す列を選びます(設備ごとに保存)。1つも選ばなければ全列を表示します。タイムラインの「内容」欄はこことは別に、ヘッダーの「内容の項目」で選びます。</p>
   <div class="sc-column-list">${allCols.map(c=>`<label class="sc-column-item"><input type="checkbox" value="${esc(c)}"${(!selected||selected.has(c))?' checked':''}> ${esc(c)}</label>`).join('')}</div>`;
  // 保存はスクロール領域の外(固定フッター)へ置く。
  const foot=document.getElementById('scColumnModalFoot');
  if(foot){
   foot.innerHTML=`<span class="sc-column-count" id="scColumnCount"></span>
    <div class="sc-content-foot-actions">
     <button type="button" id="scColumnSelectAll">全選択</button>
     <button type="button" id="scColumnClearAll">選択解除</button>
     <button type="button" id="scColumnSave" class="sc-column-save">保存</button>
    </div>`;
   const count=()=>{const el=document.getElementById('scColumnCount');if(el)el.textContent=`${body.querySelectorAll('.sc-column-item input:checked').length} / ${allCols.length} 列を表示`};
   foot.querySelector('#scColumnSelectAll').onclick=()=>{body.querySelectorAll('.sc-column-item input').forEach(i=>{i.checked=true});count()};
   foot.querySelector('#scColumnClearAll').onclick=()=>{body.querySelectorAll('.sc-column-item input').forEach(i=>{i.checked=false});count()};
   foot.querySelector('#scColumnSave').onclick=saveColumnSelection;
   body.querySelectorAll('.sc-column-item input').forEach(i=>i.onchange=count);
   count();
  }
 }
 async function saveColumnSelection(){
  const body=document.getElementById('scColumnModalBody');if(!body||!scState.equipment)return;
  const allCols=(typeof S!=='undefined'?S.columns:null)||[];
  const checked=[...body.querySelectorAll('.sc-column-item input:checked')].map(i=>i.value);
  // 全列にチェックが入ったままなら「未設定(全列表示)」として保存する
  // (空配列。1件も無ければ全列表示という他マスタと同じ互換ポリシーに合わせる)。
  const toSave=checked.length>=allCols.length?[]:checked;
  const eq=scState.equipment;
  try{
   await api('/api/schedule-column-master',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({equipment:eq,columns:toSave}))});
   scColumnPrefs={equipment:eq,columns:toSave.length?toSave:null};
   showToast&&showToast('表示列を保存しました',`${eq}の仕掛一覧に反映します`,3200);
   refreshScheduledLotFilter();
  }catch(e){showToast&&showToast('保存に失敗しました',e.message,5000)}
 }
 function openColumnModal(){
  ensureColumnModal();
  renderColumnModalBody();
  document.getElementById('scColumnModal').hidden=false;columnModalOpen=true;
 }
 function closeColumnModal(){
  const modal=document.getElementById('scColumnModal');
  if(!modal||modal.hidden)return;
  modal.hidden=true;columnModalOpen=false;
 }
 // 一覧側ツールバー(list-view.js)からの入口。
 window.openListColumnPicker=()=>{columnModalOpen?closeColumnModal():openColumnModal()};
 window.scColumnPickerAvailable=()=>scState.fullControl&&scState.boardMode==='single'&&!!scState.equipment;

 /* ---------- 設備ごとの「内容」欄の項目(スケジュール内容表示マスタ) ----------
    タイムライン各行の「内容」に何をどの順で出すかを選ぶ。仕掛一覧の表示列
    (上のスケジュール列表示マスタ)とは目的も選ぶ数も違うため別マスタにした
    (backend/repositories/master_repo.pyのSCHEDULE_CONTENT_TABLE)。
    選んだ順序がそのまま表示順になるので、追加順を保った配列で扱う。 */
 let scContentPrefs={equipment:'',items:null};
 async function loadScheduleContentPrefs(){
  if(!scState.equipment){scContentPrefs={equipment:'',items:null};return}
  const eq=scState.equipment;
  try{
   const r=await api('/api/schedule-content-master?equipment='+encodeURIComponent(eq));
   if(scState.equipment!==eq)return; // 応答が届く前に設備が切り替わっていたら結果を捨てる
   scContentPrefs={equipment:eq,items:(r.items&&r.items.length)?r.items:null};
  }catch(e){
   if(scState.equipment!==eq)return;
   scContentPrefs={equipment:eq,items:null}; // 取得に失敗しても既定の組み立てへフォールバック(fail-open)
  }
 }
 /* 未設定のときに「内容」欄を組み立てている既定の項目(entryContentTextの
    フォールバックと同じ並び)。指定が無い設備でもピッカーを開いた時点で
    “今表示されているもの”が選択済みで見えるようにするための初期値。 */
 const DEFAULT_CONTENT_ITEMS=['lotNo','purposeName','mfgMaterial','mfgTemper'];
 // 生カラム名(用途名など)はそのまま、alias名(purposeNameなど)は日本語の
 // 代表名で見せる(利用者にとってはaliasの英字名に馴染みが無いため)。
 function contentItemLabel(k){
  const names=(typeof aliases!=='undefined'&&aliases[k])||null;
  return names&&names.length?names[0]:k;
 }
 function sameItems(a,b){return a.length===b.length&&a.every((x,i)=>x===b[i])}
 /* 予定に保存されている仕掛データのスナップショット(detail)は、投入した時期に
    よってキーの流儀が違う。古い予定はalias名だけ(purposeName等)、新しい予定は
    alias名と生カラム名(用途名等)の両方を持つ。利用者がどちらの名前で選んでも
    値が引けるよう、aliases表(base.js)で相互に読み替える。
    これが無いと、古い予定しか無い設備では「項目を変えても内容欄が全く変わらない」
    (該当キーが1つも引けず既定の組み立てへフォールバックし続ける)という
    見え方になる。実際に報告された不具合。 */
 function contentValueOf(detail,key){
  if(!detail)return undefined;
  const ok=v=>v!==undefined&&v!==null&&String(v).trim()!=='';
  if(ok(detail[key]))return detail[key];
  if(typeof aliases==='undefined')return undefined;
  const names=aliases[key];
  if(names){                       // keyがalias名 -> 生カラム名を順に試す
   for(const n of names)if(ok(detail[n]))return detail[n];
   return undefined;
  }
  for(const ak of Object.keys(aliases)){   // keyが生カラム名 -> alias名を試す
   if(aliases[ak].includes(key)&&ok(detail[ak]))return detail[ak];
  }
  return undefined;
 }
 /* ---------- クエリ結合の値をスケジュール表でも使う(§9.193) ----------
    予定の行が持っているのは**投入した時点の仕掛データ(detail)**で、品質の
    ように後から確定する値は入っていない。同じ結合の定義(マスタ管理 >
    クエリ結合)を予定の行にも当て、足された列を内容欄で選べるようにする。
    **一覧と同じ定義・同じエンジン**を通すので、一覧に出る列とスケジュール表
    に出る列が食い違わない。 */
 function entryValueOf(e,key){
  const j=e&&e.joined;
  if(j){
   const v=j[key];
   if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;
  }
  return contentValueOf(e&&e.detail,key);
 }
 /* 書式・読み替えが条件で見る「行」。**結合の値が上**——同じ名前の列が
    detail にもある（結合が効いている状態で投入した予定）ときは、凍った
    写しではなく今の値を使う。 */
 function entryRow(e){
  if(!e)return {};
  return e.joined?Object.assign({},e.detail||{},e.joined):(e.detail||{});
 }
 let scJoinKeys=null,scJoinKeysAt=0,scJoinSig='',scJoinSeq=0;
 const SC_JOIN_KEYS_TTL=60000;
 /* 突合に要る列名は**サーバーが答える**。予定1行は200列のスナップショットを
    持っているので、全部送ると50行で数MBの往復になる。 */
 async function scJoinKeyColumns(){
  const db=WL.dataSource.workKey();if(!db)return null;
  if(scJoinKeys&&scJoinKeys.db===db&&Date.now()-scJoinKeysAt<SC_JOIN_KEYS_TTL)return scJoinKeys;
  try{
   /* **既定の品質データ結合はここでは当てない**(`builtin=0`)。あれは
      仕掛一覧のための古い決め打ちで、スケジュール表まで自動で広げると
      **誰も頼んでいないのに内容欄の候補が増え**、予定を読むたびに相手の
      DBへの往復が1本増える。品質をスケジュール表に出したい人は、
      マスタ管理 > クエリ結合に1件登録する（それがこの機能の趣旨）。 */
   const r=await api('/api/query-join/keys?db='+encodeURIComponent(db)+'&builtin=0');
   scJoinKeys={db,keys:r.keys||[],joins:r.joins||[]};
  }catch(_){scJoinKeys={db,keys:[],joins:[]}}
  scJoinKeysAt=Date.now();
  return scJoinKeys;
 }
 /* 画面の外から中身を確かめる口(§9.51の`scheduleWorkableState`と同じ扱い)。
    **読むだけ**——結合が当たっているか、どの列が足されたかを、DOMを掘らずに
    見られるようにしておく（当たっていないときの切り分けに要る）。 */
 WL.scheduleJoinState=()=>({
  columns:[...(scState.joinColumns||[])],
  joins:((scJoinKeys&&scJoinKeys.joins)||[]).map(j=>j.name),
  resolved:(scState.entries||[]).filter(e=>e.joined&&Object.keys(e.joined).length).length,
 });
 async function scJoinRefresh(){
  const meta=await scJoinKeyColumns();
  if(!meta||!meta.keys.length){scState.joinColumns=[];return}
  const targets=scState.entries.filter(e=>e.kind==='作業');
  if(!targets.length){scState.joinColumns=[];return}
  const eq=scState.equipment;
  /* **行そのものではなくidで覚える。** 往復のあいだに予定を読み直すと
     `scState.entries`が別のオブジェクトへ差し替わり、掴んでおいた参照へ
     書き込んでも画面には出ない（描いているのは新しいほうなので、値が
     入っているのに空欄のまま、という見え方になる）。 */
  const ids=targets.map(e=>String(e.id));
  const rows=targets.map(e=>{
   const o={};
   meta.keys.forEach(k=>{const v=contentValueOf(e.detail,k);if(v!==undefined&&v!==null&&String(v)!=='')o[k]=v});
   return o;
  });
  /* **同じ鍵なら引き直さない。** 描き直しのたびに相手のDBを引くと、
     並べ替え1回で往復が積み上がる。 */
  const sig=meta.db+'|'+JSON.stringify(rows);
  if(sig===scJoinSig)return;
  scJoinSig=sig;
  const seq=++scJoinSeq;
  const joinStarted=Date.now();
  try{
   const r=await api('/api/query-join/resolve',{quiet:true,method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({db:meta.db,rows,builtin:false})});
   if(seq!==scJoinSeq||scState.equipment!==eq)return;
   /* 結合は予定を描いたあとに走るので**合計には足さない**（読み込みの
      体感には乗らない）。それでも遅ければ内訳で分かるようにしておく。 */
   if(scLastTimings){scLastTimings.join=Date.now()-joinStarted;updateFreshnessUi(scState.planFetchedAt)}
   scState.joinColumns=r.columns||[];
   const byId=new Map((scState.entries||[]).map(e=>[String(e.id),e]));
   (r.values||[]).forEach((v,i)=>{const e=byId.get(ids[i]);if(e)e.joined=v});
   /* 結合は予定を描いたあと**数百ms〜数秒遅れて**着弾する。列幅を掴んで
      いる最中に来ると表ごと入れ替わるので待たせる（§9.211 ①）。 */
   if(scState.joinColumns.length)WL.columnResize.defer('timeline:join',()=>renderTimeline());
  }catch(_){
   // 次の読み直しでやり直せるように、控えを捨てる（黙って諦めない）。
   if(seq===scJoinSeq)scJoinSig='';
  }
 }
 /* 候補の正規化。「用途名」と「purposeName」のように同じ意味の項目が2つ並ぶと
    どちらを選ぶべきか分からず、しかも片方は古い予定で引けない。alias表に
    載っている項目はalias名へ寄せて1つにまとめる(表示は日本語名)。 */
 function canonicalContentKey(k){
  if(typeof aliases==='undefined')return k;
  if(aliases[k])return k;
  for(const ak of Object.keys(aliases))if(aliases[ak].includes(k))return ak;
  return k;
 }

 // 選択候補: 今表示している仕掛一覧の全列 + 既に予定へ入っている行が持つ
 // detailのキー(過去に別の列構成で投入した予定も編集できるようにするため)。
 function contentCandidateKeys(){
  // 今表示している仕掛一覧の全列 + 既に予定へ入っている行が持つdetailのキー
  // (過去に別の列構成で投入した予定も編集できるように)+ 既定の項目
  // (予定がまだ1件も無い設備でも既定を選べるように)。
  const raw=[...(typeof S!=='undefined'&&Array.isArray(S.columns)?S.columns:[])];
  scState.entries.forEach(e=>{if(e.detail)raw.push(...Object.keys(e.detail))});
  /* 結合で足される列(§9.193)。**予定がまだ1件も無い設備でも選べる**ように
     サーバーが返した名前をそのまま足す（行から拾うだけだと、当たっている
     行が1つも無い設備では候補に出てこない）。 */
  raw.push(...(scState.joinColumns||[]));
  scState.entries.forEach(e=>{if(e.joined)raw.push(...Object.keys(e.joined))});
  raw.push(...DEFAULT_CONTENT_ITEMS);
  const seen=new Set(),out=[];
  raw.forEach(k=>{const c=canonicalContentKey(k);if(!seen.has(c)){seen.add(c);out.push(c)}});
  return out;
 }
 /* 内容の項目まわりの道具はここまで。**モーダルのUIだけを消し**、
    値の取り出し・項目名・候補の作り方は残す——タイムラインの見出しと
    セルがこれらを使っている(まとめて消して、行が1つも出なくなった)。 */
 /* 内容欄の設定は仕掛一覧と同じパネルで開く(§9.120)。**専用モーダルは
    消した**——設定画面が2つ残ると、どちらが正か分からなくなり、片方に
    しか無い機能ができる(§9.96「一度も動かない実装を作らない」)。 */
 const contentPanelOpen=()=>{
  const p=document.getElementById('listColumnPanel');
  return !!p&&!p.hidden;
 };

 /* ---------- 内容欄の設定を、仕掛一覧と同じパネルで開く(§9.120) ----------
    以前は専用の小さなモーダルで「どの項目を出すか」だけを選べた。だが
    内容欄も**列レイアウトマスタに乗った列**（§9.88 段6）なので、並び・幅・
    表示名・書式・読み替えは仕掛一覧とまったく同じ仕組みで効く。設定画面を
    2つ持つ理由が無い——覚えることが2倍になり、片方にしか無い機能ができる。

    **保存先だけが2つに分かれる。** 「どの項目を出すか」はスケジュール内容
    表示マスタ、それ以外は列レイアウトマスタ。**振り分けはこの1箇所**で行い、
    パネルには知らせない（画面を割る理由にはしない）。 */
 /* 内容欄の項目を足せる場面か（§9.246 ②）。**scheduleモードだけではない**
    ——保存の口（`POST /api/schedule-content-master`）は`masters`Blueprintに
    在り、`_WRITE_ALLOWED_MODES['masters']={'edit'}`＋
    `_ENDPOINT_EXTRA_MODES['masters.schedule_content_master_save']={'schedule'}`
    なので、**塞がっているのは閲覧モードだけ**。判定はここ1箇所で、
    候補の一覧と案内の文言が同じものを見る（2箇所に置くと、片方だけ直した
    「候補は並ぶのに保存で断られる」状態が作れる）。 */
 const canPickContentItems=()=>(((window.accessMode&&accessMode.mode)||'edit')!=='view');

 function contentPanelSource(){
  const eq=scState.equipment;
  return {
   key:'timeline',
   eyebrow:'作業スケジュール',
   /* **どの表の設定かを名前に出す**(§9.176)。同じ見た目のパネルを仕掛一覧・
      データ一覧・スケジュール表で使い回すので、設備名まで書かないと
      「いま何を触っているか」が分からない。 */
   title:()=>`表示列の設定（作業スケジュール表：${eq}）`,
   lead:'左で<b>出す列と並び</b>を決め、右で<b>選んだ1列の見え方</b>を整えます。'
       +'区分・日付・操作などの列もここで消せます（<b>1列目の取っ手</b>は掴む場所なので残ります）。'
       +'<b>計算式の列</b>を足せます（名前を付けて式を書くと、その式の結果が並びます）。'
       +'触った結果はすぐスケジュール表に出ます（<b>保存するまでは元に戻せます</b>）。'
       +(canPickContentItems()?'':'<br><b>閲覧モードでは内容欄に新しい項目を足せません</b>'
         +'（保存できるのは編集モードとスケジュールモードです。並び・幅・出す出さないの'
         +'見え方はここで変えられますが、保存はできません）。'),
   target:()=>timelineTarget(),
   noTargetToast:'設備を先に選んでください',
   noTargetNote:'内容欄の設定は設備ごとに保存します',
   savedToast:'内容欄の設定を保存しました',
   savedNote:'この設備のタイムラインで次も同じ形で出ます',
   /* 候補は**今出している項目＋選べる項目すべて**。出していないものも
      並べる（消すと、足せることに気づけない）。 */
   keys:()=>{
    /* 固定列(区分〜操作)も**同じ並びの一部**(§9.176)。以前はここが内容欄の
       項目しか返さなかったので、設定画面から固定列を消すことも動かすことも
       できなかった。 */
    const chosen=timelineOrderedKeys();
    /* **足せるかどうかは「書けるモードか」で決める**（§9.246 ②）。
       以前は`scState.fullControl`（＝scheduleモードだけ）で塞いでいたが、
       スケジュール内容表示マスタの保存は`masters`Blueprint＝**editモード**に
       載っており、`masters.schedule_content_master_save`でscheduleへも
       開けてある（`backend/access_mode.py`）。塞がっているのは閲覧モード
       だけなので、**サーバーが通す操作を画面が断っていた**（§4の逆側）。 */
    const all=canPickContentItems()?contentCandidateKeys():[];
    const seen=new Set(),out=[];
    [...chosen,...all].forEach(k=>{if(k&&!seen.has(k)){seen.add(k);out.push(k)}});
    return out;
   },
   /* 内容欄には番号・ボタンの列が無いので、直し方(§9.110)も要らない。 */
   healed:()=>null,
   /* **「出す項目」はスケジュール内容表示マスタが持つ**ので、いま出して
      いないものを「出さない」として開く。列レイアウトマスタのhiddenを
      そのまま使うと（あちらは空なので）候補が全部チェック済みになり、
      保存した瞬間に**選んだ覚えの無い項目まで内容欄へ並ぶ**。 */
   /* **いま出していない列＝チェックを外して開く**、それだけ（§9.207）。
      以前はここに「固定列は既定で出す（監査4列を除く）」という条件が
      重ねてあり、**利用者が固定列を消しても次に開くとチェックが戻って
      いた**（保存し直すと出てくる。実機で「非表示にしても表示に切り替わって
      しまう列がいくつかある」と報告された。日付・時刻・残り…＝
      `SC_COL_OFF_BY_DEFAULT`に載っていない固定列が全部これ）。
      既定かどうかは`timelineColumnKeys()`（＝`timelineHiddenSet()`）が
      既に見ている——**同じ判定を2箇所に置かない**（片方だけが古くなる）。 */
   initialHidden:keys=>{
    const chosen=new Set(timelineColumnKeys());
    return keys.filter(k=>!chosen.has(k));
   },
   /* 見本は**予定が持つ仕掛データのスナップショット**。1件では
      「たまたま」と区別が付かないので、中身のある予定を集める。 */
   /* 見本の行は**予定そのもの**。以前は`e.detail`(仕掛データのスナップ
      ショット)だけを渡していたので、区分・日付・操作のような予定側の列は
      すべて「値のある行がありません」と出ていた(画面には出ているのに)。 */
   rows:()=>(scState.entries||[])
     .filter(e=>e.kind==='作業'&&e.detail&&Object.keys(e.detail).length).slice(0,40),
   /* **値の取り出しはcontentValueOf経由**(§9.69)。投入した時期によって
      alias名だけの予定と生カラム名を持つ予定が混ざるので、直接引くと
      古い予定で1件も出ない。 */
   /* 式へ渡す1行（§9.207）。予定の行は`{列名:値}`ではないので、
      **見出しの言葉で書けるように**ここで組み立て直す。 */
   formulaRowOf:(row,cols)=>timelineFormulaRow(row,cols),
   /* 読み替えが見る1行（§9.234 ⑥）。**表と設定パネルと「試してみる」が
      同じ行を見る**ことが要件（§9.176「見本も同じ関数を通す」）——別の行で
      評価すると、画面では当たるのに実表示は空、という食い違いが起きる。 */
   ruleRowOf:row=>timelineRuleRow(row),
   valueOf:(row,k)=>{
    /* 計算で作る列は**式を当てた結果**を見せる（§9.207）。生の値は無いので、
       ここを素通しにすると設定画面だけ「値のある行がありません」と出る
       （§9.176で内容欄が踏んだのと同じ罠）。 */
    const fx=timelineFormulaFns();
    if(fx.has(k))return timelineFormulaText(row,fx.get(k));
    return scIsFixedCol(k)?scFixedCellText(row,k):entryValueOf(row,k);
   },
   /* **項目名は日本語で出す。** 内容欄のキーは`lotNo`/`purposeName`という
      alias名なので、そのまま並べると選んだ本人以外には何の項目か分からない
      （タイムラインの見出しが日本語なのに、設定画面だけ生のキーという
      ちぐはぐな状態になる）。表示名を付けていればそちらが勝つ。 */
   labelOf:k=>scColLabel(k),
   /* 固定列は**予定そのものが持つ値**で、仕掛データの列ではない。
      分類と一言の説明を添える(§9.105。出どころを言う)。 */
   originOf:k=>(scIsFixedCol(k)||timelineIsFormulaKey(k))?'calc'
     :((scState.joinColumns||[]).includes(k)?'join':'source'),
   noteOf:k=>{
    if(timelineIsFormulaKey(k))return '式で作る列（表示だけ。並べ替え・絞り込みの対象にはなりません）';
    const d=SC_COL_MAP.get(k);return d?d.note:'';
   },
   currentWidthOf:k=>{
    const el=document.querySelector(`.sc-row-head [data-col="${CSS.escape(k)}"]`);
    return el?Math.round(el.getBoundingClientRect().width):0;
   },
   virtual:()=>({}),
   /* 結合で足された列(§9.193)。**サーバーが返した名前をそのまま使う**
      ——列名から見分ける手がかりは無い（§9.105と同じ約束）。 */
   joined:()=>new Set(scState.joinColumns||[]),
   joinFrom:()=>((scJoinKeys&&scJoinKeys.joins||[]).map(j=>j.name).filter(Boolean).join('・')
                 ||'クエリ結合'),
   /* 計算式は持たない（内容欄の値は予定のスナップショットで、一覧の行を
      前提にした式とは土俵が違う）。プリセットと入出力は使える。 */
   /* 内容欄の項目はすべて元データ由来なので、分類は1つで足りる。 */
   /* 分類は**使うものだけ**(§9.120)。結合が1件も無い設備では「結合0」を
      並べても覚える手間が増えるだけなので出さない。 */
   origins:()=>((scState.joinColumns||[]).length?['source','join','calc']:['source','calc']),
   /* 並べ替えは持たない(§9.176。行の並びは時刻の一本道)ので、
      並べ替えの決まり(§9.187)の欄も出さない。 */
   /* 計算式の列を足せる（§9.207、利用者の指示）。**並べ替えは持たない**
      （§9.176。行の並びは時刻の一本道）。 */
   features:{formula:true,preset:true,width:true,format:true,rule:true,sort:false},
   afterApply:()=>{if(scState.entries&&scState.entries.length)renderTimeline()},
   save:async(target,body)=>{
    /* ① 出す項目＝チェックの入っている列を、**並びの順**で内容表示マスタへ。
       既定と同じ並びなら「未設定」で保存する（既定側を後から変えたときに
       追随しなくなるため。従来の作法をそのまま引き継ぐ）。 */
    const hide=new Set(body.hidden||[]);
    /* **内容表示マスタへ書くのは内容欄の項目だけ**(§9.176)。固定列の
       キー(`__cat__`等)まで混ぜると、内容欄に「区分」が現れる。 */
    /* **計算で作った列を内容表示マスタへ混ぜない**（§9.207）。混ぜると
       「内容欄の項目」として扱われ、式を消した瞬間に空の列が残る。 */
    const isCalc=k=>Object.prototype.hasOwnProperty.call(body.formulas||{},k);
    const items=(body.order||[]).filter(k=>!hide.has(k)&&!scIsFixedCol(k)&&!isCalc(k));
    const toSave=sameItems(items,DEFAULT_CONTENT_ITEMS)?[]:[...items];
    await api('/api/schedule-content-master',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify(withUserId({equipment:eq,items:toSave}))});
    scContentPrefs={equipment:eq,items:toSave.length?toSave:null};
    // ② 残り(並び・幅・表示名・書式・読み替え)は列レイアウトマスタへ。
    await WL.columnLayout.save(target,body);
   },
  };
 }
 function openContentPanel(){
  if(typeof WL.listColumns?.open!=='function'){
   console.error('内容欄の設定: WL.listColumns が見つかりません');return;
  }
  WL.listColumns.open(contentPanelSource());
 }

 /* 画面を離れるときに閉じる。**開いていなければ触らない**——他の画面で
    同じパネルを開いている最中に閉じてしまわないよう、対象が内容欄のとき
    だけ閉じる。 */
 function closeContentPanel(){
  if(!contentPanelOpen())return;
  if(typeof WL.listColumns?.close==='function')WL.listColumns.close();
  updateSplitToggleUi();
 }

 /* ---------- 予定から測定を開始する(§9.35) ----------
    予定行のdetailは、投入時点の仕掛データをそのままスナップショットした
    もの(buildScheduleDetail、alias名と生カラム名の両方を持つ)なので、
    仕掛一覧の行と同じようにopenMeasurement()へ渡せる。
    ここで新しい測定画面の入口を作らないこと(測定画面の準備・端末内
    データの再開・使用設備の照合はすべてopenMeasurement()が持っている。
    別経路を足すと設備照合を通らない開き方ができてしまう)。 */
 function entryMeasurementRow(e){
  const row=Object.assign({},e.detail||{});
  // 測定画面側(blankMeasure/requireEquipmentBeforeMeasurement等)は値を必ず
  // pick(row,key)で取り出す。pick()はaliases[key]に並ぶ**生カラム名**しか
  // 見ない(alias名そのもの、例えばrow.lotNoは探さない)ため、alias名だけを
  // 持つdetail(投入時期によってはこの流儀)をそのまま渡すと1項目も引けず
  // 「ロット番号が記録されていない」になる。ここで生カラム名の側へ必ず
  // 書き戻してから渡す。
  const put=(key,val)=>{
   if(val===undefined||val===null||String(val).trim()==='')return;
   (aliases[key]||[]).forEach(n=>{
    if(row[n]===undefined||row[n]===null||row[n]==='')row[n]=val;
   });
  };
  Object.keys(aliases).forEach(k=>put(k,contentValueOf(e.detail,k)));
  // detailが古くて欠けている場合に備え、予定行が持つ3項目で補う。
  put('lotNo',e.lotNo);put('castingNo',e.castingNo);put('inspectionNo',e.inspectionNo);
  return row;
 }
 /* 帳票を開く(§9.43)。帳票ビューはrecord id(測定データの記録ID)で引くので、
    実績突合で紐づいたactualRecordIdをそのまま渡す。帳票側の「戻る」は
    データ一覧へ戻る既定の動きのままにしておく(スケジュールへ戻す独自の
    導線を足すと、report-dashboard.js側のrpReturnToの状態管理が二重になる)。 */
 async function openEntryReport(e){
  const id=e.actualRecordId;
  if(!id||typeof window.openReportForRecord!=='function'){
   alert('この行には帳票を開ける測定データが紐づいていません。');
   return;
  }
  try{
   await window.openReportForRecord(id);
  }catch(err){
   alert('帳票を開けません: '+(err&&err.message?err.message:err));
  }
 }
 async function startWorkFromEntry(e){
  if(typeof openMeasurement!=='function'){alert('測定画面を開けません。');return}
  /* §9.51: まだこの設備に仕掛かっていないロットは開始させない。ボタン自体
     出していないが、ダブルクリック等の別経路からも来るので二重に確かめる
     (「予定」から始めるときだけ。着手済みの再開は対象外)。 */
  if(e.state==='予定'){
   const w=workableOf(e);
   if(w.state!=='ok'){
    alert(w.state==='ng'
     ?`このロットはまだ${scState.equipment}に仕掛かっていないため作業を開始できません。\n残仕掛設備ｺｰｽ: ${w.course||'(不明)'}`
     :'仕掛データに該当ロットが見つからないため、作業できるか確認できません。仕掛一覧を再読込してからお試しください。');
    return;
   }
  }
  const row=entryMeasurementRow(e);
  if(!(typeof pick==='function'?pick(row,'lotNo'):row.lotNo)){
   alert('この予定にはロット番号が記録されていないため、測定画面を開けません。');
   return;
  }
  try{
   await openMeasurement(row);
   // 開始時刻を打刻すればこの予定は「作業中」へ移る。次にスケジュールを
   // 開いたときに必ず取り直せるよう、キャッシュを捨てておく(§9.42)。
   invalidatePlanCache(scState.equipment);
  }catch(err){
   alert('測定画面を開けません: '+(err&&err.message?err.message:err));
  }
 }

 function buildScheduleDetail(row){
  // §6の換算係数モデルはalias化された既知フィールド(mfgMaterial等)を前提に
  // しているため、従来どおりそちらも残す。あわせて§9.18改訂で「内容」欄を
  // 汎用化するため、スケジュール列表示マスタが選ぶ生カラム名でも値を
  // 引けるよう、S.columns(今表示中の仕掛一覧の全列)もそのまま(生カラム名を
  // キーに)スナップショットへ含める。どの設備・どの仕掛データ構成でも
  // 対応できるようにするための汎用化(alias一覧に無い列も選べる)。
  const detail={};
  Object.keys(aliases).forEach(k=>{const v=pick(row,k);if(v!==undefined&&v!==null&&v!=='')detail[k]=v});
  if(typeof S!=='undefined'&&Array.isArray(S.columns)){
   S.columns.forEach(c=>{
    const v=row[c];
    if(v!==undefined&&v!==null&&v!=='')detail[c]=v;
   });
  }
  return detail;
 }
 function sessionHolderMessage(){
  const h=scState.sessionHolder;
  return h?`${scState.equipment}は${h.loginId||'?'}@${h.pcName||'?'}が編集中です`:`${scState.equipment}は他端末が編集中です`;
 }
 function planAddPayload(target,row,children,before){
  /* 位置は`before`が決める(§9.179)。**同じ書込サイクルで入れる**ので、
     追加と並べ替えの2往復にならない。指定が無ければ今までどおり末尾。 */
  const p=withUserId({equipment:target,kind:'作業',position:before?`before:${before}`:'end',
   lotNo:pick(row,'lotNo')||'',inspectionNo:pick(row,'inspectionNo')||'',castingNo:pick(row,'castingNo')||'',detail:buildScheduleDetail(row)});
  if(children&&children.length)p.children=children;
  return p;
 }
 /* 楽観描画の行を、入れる位置へ置く(§9.179)。**末尾へ足すと、サーバーから
    返ってきた瞬間に行が飛ぶ**ように見える(入れたつもりの位置と違う)。 */
 function insertEntriesAt(before,list){
  if(!before){scState.entries.push(...list);return}
  const at=scState.entries.findIndex(e=>String(e.id)===String(before));
  if(at<0){scState.entries.push(...list);return}
  /* 行き先を覚えさせる(§9.196)。まだ予定時刻を持たないので、並べるときに
     この相手の時刻を借りる——覚えないと「追加中」だけ末尾へ落ちる。 */
  list.forEach(e=>{e.__beforeId=String(before)});
  scState.entries.splice(at,0,...list);
 }
 /* ---------- 分割ありの親ロット(§9.83) ----------
    予定へ入れた「そのタイミングで」子ロットの仕掛データを引き、親に
    ぶら下げて一緒に登録する。あとから引き直すのではなく投入時に固める
    のは、予定は「その時点の見え方を固定したスナップショット」だから
    (buildScheduleDetailと同じ考え方)。子ロットは仕掛から外れることが
    あるので、後で引くと消えていることがある。 */
 async function childPayloadFor(row){
  const api=window.WL&&window.WL.split;
  if(!api||!api.hasSplit(row))return [];
  let kids=[];
  try{kids=await api.childRowsForRow(row)}
  catch(e){console.warn('子ロットを取得できませんでした',e);return []}
  return kids.map(k=>({
   lotNo:k.lot,
   inspectionNo:k.row?(pick(k.row,'inspectionNo')||''):'',
   castingNo:k.row?(pick(k.row,'castingNo')||''):'',
   // 子ロット自身の仕掛行があればそれを、無ければ分かっている範囲だけを
   // スナップショットする。__で始まるキーは仕掛の実カラム名と衝突しない。
   detail:Object.assign(k.row?buildScheduleDetail(k.row):{lotNo:k.lot},
                        {__childLot:true,__childWidth:k.width,__childStrips:k.strips,
                         __childTol:k.tol,__childMissing:!!k.missing}),
  }));
 }
 // 子ロットの仮表示。親の直後に並べる(サーバーの並びと同じ)。
 function makeOptimisticChildren(parentEntry,children){
  return (children||[]).map(c=>makeOptimisticEntry('作業',{
   lotNo:c.lotNo,title:c.lotNo,detail:c.detail,
   parentId:parentEntry.id,reorderable:false,
  }));
 }
 async function addRowToSchedule(row,equipment){
  const target=equipment||scState.equipment;
  if(!target){showToast&&showToast('設備を選択してください','',3200);return}
  const children=await childPayloadFor(row);
  const before=(target===scState.equipment)?takeInsertBefore():'';
  if(target!==scState.equipment){
   // 今開いていない設備への追加(§9.5): 楽観描画の対象タイムラインが無い
   // ため従来どおり即時反映する。
   try{
    await api('/api/schedule/plan/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(planAddPayload(target,row,children))});
    showToast&&showToast('予定へ追加しました',childAddedNote(target,children),3200);
   }catch(e){showToast&&showToast('追加に失敗しました',e.message,5000)}
   return;
  }
  if(sessionBlocked()){showToast&&showToast('追加できません',sessionHolderMessage(),4000);return}
  const entry=makeOptimisticEntry('作業',{lotNo:pick(row,'lotNo')||'',detail:buildScheduleDetail(row)});
  const kidEntries=makeOptimisticChildren(entry,children);
  insertEntriesAt(before,[entry,...kidEntries]);
  renderTimeline();
  queuePlanOp({op:'add',...planAddPayload(target,row,children,before),
   onSuccess:r=>{kidEntries.forEach(k=>{k.parentId=r.id});resolveOptimisticEntry(entry,r)},
   onFailure:()=>{kidEntries.forEach(discardOptimisticEntry);discardOptimisticEntry(entry)}});
  if(children.length)showToast&&showToast('予定へ追加しました',childAddedNote(target,children),3600);
 }
 function childAddedNote(target,children){
  if(!children||!children.length)return `${target}の予定に追加しました`;
  const missing=children.filter(c=>c.detail&&c.detail.__childMissing).length;
  return `${target}の予定に追加しました（子ロット${children.length}件を含む`
   +(missing?`／うち${missing}件は仕掛に見つかりません`:'')+'）';
 }
 window.scheduleAddFromRow=function(row){addRowToSchedule(row,pick(row,'equipment')||'')};

 // 一括追加(§9.5・§9.11改訂): 開いている設備への一括追加は、画面へは全件を
 // 即座に反映し、実際のAPI呼び出しはバックグラウンドの書込キューへ積んで
 // 順次処理する(体感速度のため。共有DBの取得→適用→反映サイクル自体は
 // 直列のまま変わらない)。開いていない設備への一括追加は、失敗集計を
 // その場で示すため引き続き直列awaitする。
 async function addRowsToSchedule(rows,equipment){
  const target=equipment||scState.equipment;
  if(!target){showToast&&showToast('設備を選択してください','',3200);return}
  // 分割ありの行だけ子ロットを引く(§9.83)。先頭5桁が同じ親が並んでいても
  // searchByLotPrefix側でキャッシュが効くので、往復は実質1ロット1回以下。
  const childrenOf=new Map();
  let childTotal=0;
  for(const row of rows){
   const kids=await childPayloadFor(row);
   if(kids.length){childrenOf.set(row,kids);childTotal+=kids.length}
  }
  const withKids=n=>childTotal?`${n}（子ロット${childTotal}件を含む）`:n;
  if(target!==scState.equipment){
   let okCount=0;const failedLots=[];
   for(const row of rows){
    try{
     await api('/api/schedule/plan/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(planAddPayload(target,row,childrenOf.get(row)))});
     okCount++;
    }catch(e){failedLots.push(pick(row,'lotNo')||'?')}
   }
   if(failedLots.length)showToast&&showToast(`${okCount}/${rows.length}件を追加しました`,`失敗したロット: ${failedLots.join('・')}`,7000);
   else showToast&&showToast('一括追加しました',withKids(`${target}の予定へ${okCount}件追加しました`),3800);
   window.clearListSelection?.();
   return;
  }
  if(sessionBlocked()){showToast&&showToast('追加できません',sessionHolderMessage(),4000);return}
  /* まとめて入れるときも**選んだ順のまま**その位置へ並ぶ。同じ行の前へ
     次々入れると逆順になるので、1件入れるごとに「次はその行の前」へ
     ずらす……のではなく、**先頭の位置を固定したまま後ろへ足す**
     (追加は書込キューで直列なので、順番はこの並びのまま保たれる)。 */
  const before=takeInsertBefore();
  const added=[];
  rows.forEach(row=>{
   const entry=makeOptimisticEntry('作業',{lotNo:pick(row,'lotNo')||'',detail:buildScheduleDetail(row)});
   const kids=childrenOf.get(row)||[];
   const kidEntries=makeOptimisticChildren(entry,kids);
   added.push(entry,...kidEntries);
   queuePlanOp({op:'add',...planAddPayload(target,row,kids,before),
    onSuccess:r=>{kidEntries.forEach(k=>{k.parentId=r.id});resolveOptimisticEntry(entry,r)},
    onFailure:()=>{kidEntries.forEach(discardOptimisticEntry);discardOptimisticEntry(entry)}});
  });
  insertEntriesAt(before,added);
  renderTimeline();
  showToast&&showToast(`${rows.length}件をキューへ追加しました`,withKids(`${target}の予定へ反映中です…`),3200);
  window.clearListSelection?.();
 }

 /* ---------- 印刷への受け渡し(§9.115) ----------
    紙の割り付けは schedule-print.js が持つ。ここが渡すのは**いま画面に
    出ている状態そのもの**で、印刷のために取り直さない——取り直すと画面と
    紙で件数が食い違い、どちらが正か分からなくなる(現場は紙を見て動くので、
    画面と違う紙が出るのが一番困る)。

    別ファイルから触れるのはこの4つだけにしておく。scStateやentryContentText
    をそのまま公開すると、印刷側から画面の状態を書き換えられてしまう。 */
 WL.scheduleView={
  equipment:()=>scState.equipment||'',
  /* いま描いているタイムラインの列レイアウトの対象（§9.239 ④）。
     紙が「手で決めた揃え」を引くのに使う——**判定は`WL.columnAlign`の
     1箇所**で、紙は対象を聞くだけ（紙側で列名から推測しない）。
     成り代わり中（`withEquipment`）もその設備の対象を返す。 */
  layoutTarget:()=>timelineTarget(),
  /* 写しを渡す(印刷側が並べ替えても画面の並びを壊さない)。 */
  entries:()=>(scState.entries||[]).slice(),
  /* 内容欄の文字は**画面と同じ組み立て**を通す。設備ごとに選んだ項目・
     読み替え・書式がそのまま紙にも乗る(紙だけ別の組み立てにしない)。 */
  contentTextOf:e=>entryContentText(e),
  /* 紙が「内容」を**項目ごとの列**へ割りたいときに使う(§9.118)。
     画面のタイムラインが出している項目を、キー・見出し・整えた値の形で
     そのまま渡す。**紙だけ別の組み立てにしない**——読み替えも書式も
     画面と同じものが乗っていないと、紙と画面で違う値が出る。 */
  contentKeys:()=>timelineContentKeys(),
  contentLabelOf:k=>{
   const t=timelineTarget();
   const named=t?WL.columnLayout.label(t,k):k;
   return (named&&named!==k)?named:contentItemLabel(k);
  },
  /* 1行ぶんまとめて返す([{key,text,raw,color}])。項目ごとに呼ぶ形にすると
     行×項目の回数だけ組み立て直すことになる。 */
  contentCellsOf:e=>timelineContentCells(e),
  /* ---------- 印刷を「画面の見た目」へそろえる（§9.235、利用者の指示） ----------
     「画面の見た目を活かしたレイアウトにしてほしい。列の情報や並びもそのまま、
      『内容』で表示内容をまとめずに、画面印刷に近い形で」

     紙が使うのは**画面と同じ列**（並び・表示/非表示・書式・読み替え・計算式）
     で、紙のためだけの列選択は持たない（§9.235で`print:<設備>`の列選択を
     廃止）。ここは印刷側(`schedule-print.js`)へ「いま画面に出ている列と
     その1行ぶんの値」を渡す口。 */
  printColumnKeys:()=>printColumnKeys(),
  columnLabelOf:k=>scColLabel(k),
  printRowCells:e=>printRowCells(e),
  /* 作業以外の行の題名（§9.294 ①）。紙は内容の列を束ねてここへ置く。
     **紙が組み立て直さない**——題名は`nonWorkTitleText()`の1箇所（§9.238 ②）。 */
  nonWorkTitle:e=>(e&&e.kind!=='作業')?nonWorkTitleText(e,'（コメント）'):'',
  /* 題名の横の（所要時間）（§9.295 ④）。**出すかどうかの判定も含めてここ**
     ——紙で判定をやり直すと、画面と刷り上がりが食い違う（§9.163）。 */
  nonWorkTime:e=>nonWorkTimeText(e),
  /* 行の見せ方を取り直して描き直す（§9.295）。**同じ1本を通す**——
     別のPCが色を変えたときも、盤で選んだときも、ここを通って画面が揃う。 */
  reloadRowStyles:async()=>{await loadRowStyles(true);renderRowStylePop();renderTimeline()},

  columnEffWidthPx:k=>columnEffWidthPx(k),
  /* 「見える範囲の列」（§9.236）——画面をスクロールせずに見えている列だけ。 */
  visibleColumnKeys:()=>visibleColumnKeys(),
  /* 子ロット(§9.83)。紙は`entries()`に混ざっている子（`parentId`付き）を
     自分で拾わず、ここから引く——判定を2箇所に持たない。 */
  childrenOf:parentId=>childEntriesByParent().get(parentId)||[],
  childSummaryOf:c=>childSummary(c),
  /* 子ロットの折りたたみバッジをどの列へ付けるか(§9.235)。画面と紙の
     どちらも**同じ判定**（`childBadgeTargetKey()`）を通す。 */
  childBadgeColKey:()=>childBadgeTargetKey(),
  /* ---------- 他の設備ぶんを一時的に成り代わって解く（§9.235、「すべての
     設備を続けて印刷する」） ----------
     列の並び・書式・読み替え・計算式・内容欄の項目は`scState.equipment`
     （`timelineTarget()`）と`scContentPrefs`の2箇所で判定しているので、
     この端末が開いている設備以外を印刷するときは**その設備の値へ差し替えて
     から呼び、終わったら必ず戻す**。**取得（`await`）は差し替えるより前**に
     済ませること——差し替えたあとに`await`を挟むと、そのあいだに別の
     コードが差し替え中の状態を覗いてしまう（1本のタブなので、同期の
     あいだだけ差し替えれば他のコードが割り込む隙が無い）。 */
  withEquipment:async(equipment,entries,fn)=>{
   let items=null;
   try{
    const r=await api('/api/schedule-content-master?equipment='+encodeURIComponent(equipment));
    items=(r.items&&r.items.length)?r.items:null;
   }catch(e){items=null}
   const prevEq=scState.equipment,prevEntries=scState.entries,prevPrefs=scContentPrefs;
   scState.equipment=equipment;scState.entries=entries||[];
   scContentPrefs={equipment,items};
   try{return fn()}
   finally{scState.equipment=prevEq;scState.entries=prevEntries;scContentPrefs=prevPrefs}
  },
  equipmentNames:()=>{
   const items=(typeof equipmentMasterState!=='undefined'?equipmentMasterState.items:[])||[];
   const names=items.map(x=>String(x.name||'').trim()).filter(Boolean);
   return names.length?names:(scState.equipment?[scState.equipment]:[]);
  },
  /* 画面の「まとめ」(§9.189)。紙にも同じまとまりで見出しを入れるため、
     **判定は画面の1箇所(groupBucketOf)を通す**——紙だけ別に組み立てると、
     画面と紙でまとまりが食い違う。 */
  groupMode:()=>scState.groupMode||'none',
  groupModeLabel:()=>(SC_GROUP_MODES.find(m=>m.key===(scState.groupMode||'none'))||{}).label||'',
  /* まとめている日付が現場歴か暦か('work'/'cal'/'')。**紙も同じものを見る**
     (§9.198)——画面が暦でまとめているのに紙が現場歴で切ると、日ごとに配る
     紙の件数が画面と合わなくなる(§9.115と同じ理由)。 */
  groupBasis:()=>groupBasis(),
  /* まとめの見出しに添える「現場歴／太陽暦」の呼び名（§9.237）。
     **画面(`groupHeadHtml`)と同じ表を見る**——紙へ書き写すと、
     呼び名を変えたときに片方だけ古いままになる。 */
  groupBasisLabel:()=>SC_BASIS_LABEL[groupBasis()]||'',
  /* 行の見せ方(§9.198)。**判定の1箇所へ外から聞ける**ようにしておく
     ——DOMを掘って色を読むと、行が1件も無い区分を確かめられない。 */
  rowStyleOf:e=>rowStyleOf(e||{}),
  updateToolGroups:()=>updateToolGroups(),
  /* 「表示」パネル(§9.199)。設定はここへ畳んだので、**外から開ける口**を
     置く（畳んだ中の欄を触りたい側が、入口の名前を知らずに済む）。 */
  openViewPop:()=>{const pop=$('#scViewPop');if(pop&&pop.hidden)toggleViewPop();return !!(pop&&!pop.hidden)},
  closeViewPop:()=>closeViewPop(),
  /* いま一覧で選んでいる予定のid（§9.170／§9.177の`#scPickBar`）。
     印刷範囲(§9.292 ①)が「選んだ予定だけ」を数えるのに使う。
     **`scState.picked`を外へ出さない**——選べる行の条件（まとめて動かせる／
     外せる＝未着手の親だけ）はこのファイルの1箇所が持っている。
     渡すのは写しで、書き換えられても画面の選択は動かない。 */
  pickedIds:()=>[...(scState.picked||[])].map(String),
  /* 親ロットの印('count'=子N / 'parent'=親)。 */
  childBadgeMode:()=>scLayout.childBadge||'count',
  /* まとまり1つ。`tone`は**画面の帯と同じ色分け**（§9.237）——画面は
     `.sc-group[data-group="running|planned|history"]`にだけ面の色を持つ
     （`data-group`はまとまりのキーそのものなので、日付・勤務でまとめて
     いるときは色が付かない＝素の帯）。紙もそこへ揃えるので、
     **区分でまとめているときだけ**キーを渡す。 */
  groupOf:e=>{const b=groupBucketOf(e);
   if(!b)return null;
   return {key:String(b.key),label:b.label,
           tone:scState.groupMode==='category'?String(b.key):''};},
  categoryLabelOf:e=>categoryOf(e).label,
  /* 取り直す・描き直す。**渡すのは操作だけで、状態は渡さない**
     ——scStateを外へ出すと、他のファイルから画面の状態を書き換えられて
     しまう。「いまの内容で描き直す」「最新を取り直す」だけを開ける。 */
  refresh:force=>refreshCurrentMode(!!force),
  render:()=>{if(scState.equipment)renderTimeline()},
  /* 編集権(§9.211 ②)。**在席を取り直す**操作と、**いま書けるか**の答え。
     どちらも判定はこのファイルの1箇所(refreshSessionsWho/sessionBlocked)で、
     外へ出すのは「聞く」だけ——scState.sessionHeldを直接触らせると、
     画面の見せ方と実際の権利が食い違う。 */
  refreshSession:()=>refreshSessionsWho(),
  sessionBlocked:()=>sessionBlocked(),
  /* いま勝手に読み直してよいか(§9.188)。**触っている最中は読み直さない**。 */
  canAutoReload,
  /* 他の設備ぶんは画面が持っていないので取りに行く。**表示範囲は画面と
     同じ値**を使う(紙だけ違う範囲で出すと突き合わせられない)。 */
  fetchEntries:async name=>{
   const r=await api('/api/schedule/plan?equipment='+encodeURIComponent(name)
    +'&history_hours='+encodeURIComponent(scState.historyHours));
   return r.entries||[];
  },
 };

 /* ---------- ナビ ----------
    「作業スケジュール」は全モードで常時表示するため(§9.1)、動的注入
    (calendar-view.js/report-dashboard.jsの分析系ボタンと同じ方式)ではなく
    templates/index.htmlに静的に置いたボタンへ直接配線する。 */
 const navBtn=document.getElementById('openSchedule');
 if(navBtn)navBtn.onclick=()=>openScheduleView().catch(e=>console.error(e));

 /* ---------- 開く前に用意しておく(§9.182) ----------
    利用者の指示は「ローカルデータやバックグラウンド処理を有効に活かして、
    ユーザーに読み込み待ちを意識させないようにデータの準備を行い、
    間に合わない状況になった場合にのみWAITING表示を出すように」。

    やることは2つ。
     ① **手が空いてから**(requestIdleCallback)先に取っておく。起動直後は
        一覧や測定画面の取得で忙しいので、そこへ割り込まない。
     ② **ボタンに触れた時点**でも取り始める（hover/focus）。押すまでの
        200〜500msがそのまま準備に使える。
    取ったものは**既存のキャッシュへ入れるだけ**で画面は触らない——先読みが
    画面を書き換えると、見ている画面が勝手に変わる。
    重い`/api/schedule/overview`(設備ごとに予定を展開する)は**スケジュール
    モードのときだけ**。測定端末では自分の設備の予定だけを取る(1件)。
    失敗は黙って捨てる（先読みが失敗しても、開いたときに普通に取り直す）。 */
 let prefetchStarted=false;
 async function prefetchSchedule(){
  if(prefetchStarted)return;
  prefetchStarted=true;
  const am=window.accessMode||{};
  const jobs=[];
  try{
   if(am.mode==='schedule')jobs.push(api('/api/schedule/overview').then(r=>{
    if(r&&r.configured&&!scOverviewCache)scOverviewCache={rows:r.equipment||[],fetchedAt:Date.now()};
   }));
   const eq=(am.mode==='edit'&&typeof currentConfiguredEquipment==='function')
    ?currentConfiguredEquipment():'';
   if(eq){
    jobs.push(WL.columnLayout.load('timeline:'+eq));
    const gen=planGen();
    jobs.push(api('/api/schedule/plan?equipment='+encodeURIComponent(eq)
      +'&history_hours='+encodeURIComponent(scState.historyHours)).then(r=>{
     if(gen!==planGen())return;      // 先読み中に予定を変えていたら捨てる(§9.200)
     if(r&&r.configured&&!scPlanCache.has(eq))
      scPlanCache.set(eq,{entries:r.entries||[],anchor:r.anchor,warnings:r.warnings||[],
        loadFactor:r.loadFactor,historyHours:scState.historyHours,fetchedAt:Date.now()});
    }));
   }
   jobs.push(WL.displayRules.load());
   await Promise.all(jobs.map(x=>Promise.resolve(x).catch(WL.quiet('取れない設定がある（取れたものだけで描く）'))));
  }catch(e){WL.quiet.note('先読みは失敗しても構わない',e)}
 }
 if(navBtn){
  const warm=()=>prefetchSchedule();
  navBtn.addEventListener('mouseenter',warm,{once:true});
  navBtn.addEventListener('focus',warm,{once:true});
 }
 WL.onReady(()=>{
  const idle=window.requestIdleCallback||(f=>setTimeout(f,1800));
  idle(()=>prefetchSchedule(),{timeout:5000});
 });
})();
