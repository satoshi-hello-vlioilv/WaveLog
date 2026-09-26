"use strict";
/* filters.js: 汎用フィルタ(検索バー・保存/デフォルトプリセット) */
/* ============================================================
   Hotfix 2026-07-20 D: 汎用フィルタ（コンパクト＋サジェスト＋ローディング）と公差数直線
   --------------------------------------------------------------
   設計指針（認知心理学 / 情報アーキテクチャ）:
   - 再認 > 想起 (Nielsen): 条件を打ち込むのではなく、保存済み/よく使う
     フィルタをチップとして提示し「選ぶ」操作へ置き換える。
   - チャンク化 / グルーピング (Miller, Gestalt近接): 候補を
     「保存フィルタ」「よく使う条件」「候補の値」に分節化して認知負荷を下げる。
   - 段階的開示: 主導線は1つの検索窓。詳細ビルダーは折りたたみ既定。
   - 選択過多の回避 (Hick): 各グループの提示数を制限し、頻度×新しさで並べる。
   - トークン入力: アクティブ条件と入力欄を同一面に置き、次々に追加/削除できる。
   - フィードバック: マスタ読み書きは待ちが出るためローディングを明示する。
   ============================================================ */
(function(){
  if(typeof $!=='function')return;
  const FILTER_STORE='MeasurementGenericFilterPresetsV1';
  /* 条件の利用履歴(「よく使う条件」の元データ)。V1は列名+演算子+値だけを
     キーにした単一のフラットなマップで、どのDB/テーブルで使った条件かを
     まったく持っていなかった。そのため仕掛一覧で使った条件がマスタ一覧や
     品質データの「よく使う条件」にもそのまま提案され、その表に存在しない
     列の条件ばかりが並ぶ状態だった(実際に報告された指摘)。V2では
     「DB名+テーブル名」ごとのバケットに分けて記録する。V1のデータは
     どのテーブルのものか復元しようが無いため引き継がない(利用回数の
     統計のみで、失われても数回の操作で貯まり直す性質のデータ)。 */
  /* 利用履歴は**人ごと**に分ける(§9.172)。V2は「DB+テーブル+モード」ごとの
     バケットだけで、同じPCを2人で使うと相手が打った条件が自分の「よく使う」に
     並んでいた。V3は一番外側へ利用者IDのバケットを足す。V2ぶんは**今の利用者の
     ものとして引き継ぐ**——その端末を主に使っている人のものである可能性が高く、
     捨てると貯まり直すまで提案が空になる。 */
  const USAGE_STORE='MeasurementFilterCondUsageV3';
  const USAGE_STORE_V2='MeasurementFilterCondUsageV2';
  /* ---------- その場フィルタ(§9.238 ⑤、利用者の指示) ----------
     「フィルタ枠はあるが、基本的に登録して使う形になっている。このフィルタの
     下に折りたたんだもう1つのフィルタを実装して、カラムを選択しておき、条件を
     選択、入力欄に入れると、設定したカラムの選択した条件でフィルタが掛かる
     ようにしてください」。

     決めごと:
      ・**登録もトークン化もしない**。打った瞬間に効き、消せば消える。
        `S.genericFilters`へは入れない——入れると覚え(§9.175)へ焼き付き、
        次に開いたときに身に覚えのない条件が復活する。問い合わせを組み立てる
        瞬間(`listHooks.onQuery`)に足すだけ。
      ・**「カラムと条件」は覚え、「値」は覚えない**。利用者の言う
        「カラムを選択しておき」＝**支度は続く**が、絞り込みそのものは
        毎回その場で打つもの。覚えは**利用者ごと×一覧ごと**(§9.172)。
      ・**効いていることを必ず文字で出す**(§3・§9.175)。畳んでいるときは
        入口のボタンが条件を名乗る——見えない場所で効く絞り込みを作らない。
      ・**入力中に行を作り直さない**(§9.117)。この一覧は読み込みのたびに
        `renderGenericFilterBar()`を通るので、素直に組み直すと1文字ごとに
        カーソルが飛ぶ。器は1度だけ作り、中身は差分だけ書き換える。 */
  const ADHOC_STORE='MeasurementFilterAdhocV1';
  const ADHOC_OPEN_STORE='MeasurementFilterAdhocOpenV1';
  const ADHOC_MAX_CONTEXTS=80;
  const ADHOC_DEBOUNCE_MS=280;
  const OPS=[
    ['contains','含む'],['not_contains','含まない'],['eq','＝ 一致'],['neq','≠ 不一致'],
    ['starts','前方一致'],['ends','後方一致'],['gt','> より大きい'],['gte','>= 以上'],['lt','< より小さい'],['lte','<= 以下'],['empty','空欄'],['not_empty','空欄以外']
  ];
  /* ---------- 「誰の設定か」(§9.172) ----------
     利用者IDはbase.jsが起動直後に/api/whoamiから取って端末へ覚える(入力は
     求めない)。**取れないことがある**ので、そのときは空のまま扱い、画面に
     「この端末の共通」と書く——他人の設定と混ざるかもしれないことを黙って
     隠さない。IDは後から届くので、**呼ぶたびに読む**(起動時に1回だけ束縛
     すると、空のまま固定される)。 */
  function filterUserId(){return typeof currentUserId==='function'?currentUserId():''}
  function filterUserLabel(){return filterUserId()||'（利用者IDが分かりません）'}
  S.genericFilters=Array.isArray(S.genericFilters)?S.genericFilters:[];
  S.filterPresets=readLocalPresets();
  S.filterPresetSource='local';
  S.filterCondUsage=readUsage();

  /* ---- 鍵付き必須条件（汎用） ----
     以前は「使用設備一致」専用の固定フィルタとして実装していたが、任意の
     デフォルトフィルタ(登録フィルタ一覧のプリセット)に鍵マークを付けられる
     よう汎用化した。鍵を付けたプリセットは、デフォルトフィルタとして
     一覧を開くたびに自動適用され(=固定フィルタと同じ挙動)、外そうとすると
     確認を挟む。確認の上で外した場合はそのセッション中だけ一時的に外れ、
     一覧を開き直すと自動的に元へ戻る。
     条件の説明表示・確認メッセージは、どの条件が鍵付きでも同じ汎用ロジック
     (condLabel)で組み立てる(以前あった使用設備専用の文言分岐は削除)。
     旧来の「BOX設計_設備名＝使用設備」を無条件で自動注入する専用コード
     (ensureEquipmentFilterFor)は汎用化により完全に不要となったため削除した。
     使用設備必須条件が欲しい場合は、登録フィルタ一覧から通常のプリセットと
     して保存し鍵を付ければ、他の鍵付き条件と同じ扱いで自動適用される。 */
  function isLockedFilter(f){return !!f&&!!f.locked}
  function lockedFilterDescription(f){return condLabel(f)}
  async function confirmRemoveLockedFilter(f){
    const target=f||S.genericFilters.find(isLockedFilter);
    if(!target)return true;
    return await confirmModal(`この条件(${lockedFilterDescription(target)})は鍵付きの必須条件です。外すと一時的に条件が緩和されます(この一覧を開き直すと自動的に元へ戻ります)。\n本当に解除しますか？`);
  }
  async function confirmRemoveAllLocked(lockedList){
    if(lockedList.length<=1)return await confirmRemoveLockedFilter(lockedList[0]);
    const desc=lockedList.map(lockedFilterDescription).join('、');
    return await confirmModal(`鍵付きの必須条件が${lockedList.length}件あります(${desc})。全解除すると一時的にこれらの条件も外れます(この一覧を開き直すと自動的に元へ戻ります)。\n本当に解除しますか？`);
  }

  /* ---- アクティブなフィルタ設定状態(S.genericFilters)を、ファイル(DB)＆
     テーブルごとに個別管理する ----
     従来はS.genericFiltersがどのDB/テーブルにも属さない単一の共有配列で、
     デフォルトフィルタが設定されていないテーブルへ切り替えると何も
     リセットされず、直前のテーブル(存在しない列の条件や鍵付き条件を
     含む)がそのまま残り続けていた。切替の都度、直前のコンテキストの
     状態を保存し、切替先のコンテキスト専用の状態を復元する。鍵付き
     必須条件は毎回applyDefaultFiltersForから新しく導出し直されるものなので、
     保存対象からは除く。 */
  let activeFilterContextKey=null;
  /* ---- 適用中の条件は**端末に覚える**(§9.175) ----
     以前はこの控えがメモリ(オブジェクト)だけだったため、**アプリを開き直すと
     適用していた条件が丸ごと外れていた**(実機で報告)。一覧を切り替えたときは
     戻るのに再起動では戻らない、という食い違いは「効いているのかどうか」を
     利用者に確かめさせることになる。
     **利用者ごとの入れ物に分ける**——同じPCを別の人が使うと相手の絞り込みが
     当たってしまう(§9.172でデフォルト・鍵の印を個人単位へ移したのと同じ理由)。
     利用者IDは`/api/whoami`から**後から届く**ので、**読み書きのたびに引く**
     こと(起動時に1回だけ束縛すると、空のIDのまま固定される)。
     鍵付きの必須条件は`applyDefaultFiltersFor`が毎回導出し直すので覚えない。 */
  const ACTIVE_STORE='MeasurementFilterActiveV1';
  const ACTIVE_MAX_CONTEXTS=80;
  let activeAll=(()=>{try{const m=JSON.parse(localStorage.getItem(ACTIVE_STORE)||'{}');
                           return (m&&typeof m==='object')?m:{}}catch(_){return {}}})();
  function activeBucket(who){
    const uid=who==null?filterUserId():who;
    if(!activeAll[uid]||typeof activeAll[uid]!=='object')activeAll[uid]={};
    return activeAll[uid];
  }
  function writeActiveAll(){try{localStorage.setItem(ACTIVE_STORE,JSON.stringify(activeAll))}catch(_){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',_)}}
  /* whoは**書き込む先の利用者**。利用者IDは後から届くので(§9.172)、
     起動直後に空のIDで覚えたぶんを、IDが届いた時点でその人の側へ
     置き換える。そのとき「元の持ち主」へ書き戻すために引数で受ける。 */
  function saveActiveFilterState(who){
    if(activeFilterContextKey==null)return;
    const keep=S.genericFilters.filter(f=>!isLockedFilter(f)).map(f=>({...f}));
    const bucket=activeBucket(who);
    /* 0件は**行ごと消す**——空配列を残すと、覚えている一覧の数だけが増えていく。 */
    if(keep.length)bucket[activeFilterContextKey]=keep;else delete bucket[activeFilterContextKey];
    const keys=Object.keys(bucket);
    if(keys.length>ACTIVE_MAX_CONTEXTS)keys.slice(0,keys.length-ACTIVE_MAX_CONTEXTS).forEach(k=>{
      if(k!==activeFilterContextKey)delete bucket[k];
    });
    writeActiveAll();
  }
  function restoreActiveFilterState(key){
    return (activeBucket()[key]||[]).map(f=>({...f}));
  }
  /* ---------- 覚えの入れ替えと既定の当て直し(§9.184) ----------
     以前この2つは`selectTable`の中だけで行っており、**次の3つで空振り**して
     いた。どれも「一覧を開き直したのに鍵付きの条件が外れている」という
     同じ見え方になる。
      ① 起動直後——登録フィルタ(と印)がまだ届いておらず、当てる相手が
         1件も無い。以前は空振りしたまま二度と当て直さなかった。
      ② 利用者IDが後から届く——空のIDで覚えを読んでしまい、その人の
         覚えが出てこない。
      ③ スケジュール画面との行き来——テーブルは変わらないので`selectTable`が
         呼ばれず、場面(§9.184)が変わったことに誰も気づかない。
     **一覧を引く前には必ずここを通る**（listHooks.onQuery）ので、鍵の
     付け替えも既定の当て直しもこの1箇所で済ませる。 */
  let activeFilterUid=null;          // いまの覚えを読んだときの利用者ID
  let defaultsAppliedFor=null;       // 既定を当て終えたコンテキストの鍵
  function syncFilterContext(){
    if(!S.db||!S.table)return false;
    const key=defaultMapKey(S.db,S.table),uid=filterUserId();
    if(key!==activeFilterContextKey||uid!==activeFilterUid){
      /* 保存先は**入れ替える前の持ち主**。IDが空→本人へ切り替わる瞬間に
         現在の持ち主で書くと、空のIDの覚えが消える。 */
      if(activeFilterContextKey!=null)saveActiveFilterState(activeFilterUid);
      S.genericFilters=restoreActiveFilterState(key);
      activeFilterContextKey=key;activeFilterUid=uid;
      defaultsAppliedFor=null;
    }
    if(defaultsAppliedFor===key)return false;
    /* **届いていなければ取りに行く。** ここは同期なので待てないが、
       取れた時点で当て直す(§9.184)。以前は「1件も無いなら諦める」だけで、
       起動直後・利用者IDが後から届いた場合に二度と当たらなかった
       ——実機で「再起動すると鍵付きのフィルタが外れている」となっていた
       のがこれ。**利用者IDは鍵に入っている**ので、空のIDで読んだ結果を
       その人のものだと思い込むこともない。 */
    if(!presetsReady(S.db,S.table)){
      ensurePresetsFor(S.db,S.table).then(()=>{reapplyDefaultFilters()});
      return false;
    }
    const added=applyDefaultFiltersFor(S.db,S.table);
    defaultsAppliedFor=key;
    return added>0;
  }
  /* ---------- その一覧の登録フィルタを、当てる前に取る(§9.184) ----------
     以前は起動時に1回だけ`loadMasterPresets()`を呼んでいたが、そのときには
     まだDBもテーブルも決まっていないため、**その一覧の登録フィルタは
     1件も入っていなかった**。それでも動いていたのは端末に残っていた控え
     (localStorage)を読んでいたからで、控えが無い端末・別のPC・利用者IDが
     後から届いた場合は、既定・鍵の自動適用が相手不在で空振りしていた
     （実機で「再起動するとフィルタが外れる」と報告された形）。
     **印はマスタにその人のものとして入っている**(§9.172)ので、開く一覧が
     決まった時点で取りに行く。1度取ったら覚えて、同じ一覧では取り直さない。 */
  let presetsLoadedFor=null,presetsLoading=null;
  function presetsKeyFor(db,table){
    return `${mapKeyOf(db,table,presetMode())}\u001f${filterUserId()}`;
  }
  function presetsReady(db,table){return presetsLoadedFor===presetsKeyFor(db,table)}
  async function ensurePresetsFor(db,table){
    const key=presetsKeyFor(db,table);
    if(presetsLoadedFor===key)return;
    /* 同じ一覧を同時に2回取りに行かない(一覧を引くたびに呼ばれる)。 */
    if(presetsLoading&&presetsLoading.key===key)return presetsLoading.p;
    const p=loadMasterPresets({inline:false,db,table})
      .catch(WL.quiet('読めなければ次の機会に取り直す'))
      .finally(()=>{if(presetsLoading&&presetsLoading.key===key)presetsLoading=null});
    presetsLoading={key,p};
    return p;
  }
  /* 登録フィルタが届いた直後の当て直し。**変わったときだけ引き直す**。 */
  function reapplyDefaultFilters(){
    if(!syncFilterContext())return false;
    renderGenericFilterBar();
    if(typeof WL.list.load==='function')WL.list.load();
    return true;
  }
  /* いま覚えている一覧の数。登録一覧モーダルの見出しで「どこに何が残って
     いるか」を文字で出すために使う(隠したまま効かせない)。 */
  function activeFilterMemoryCount(){return Object.keys(activeBucket()).length}
  function forgetActiveFilterMemory(){
    activeAll[filterUserId()]={};writeActiveAll();
  }

  function readLocalPresets(){try{return JSON.parse(localStorage.getItem(FILTER_STORE)||'[]')}catch(_){return []}}
  function writeLocalPresets(){try{localStorage.setItem(FILTER_STORE,JSON.stringify((S.filterPresets||[]).slice(0,120)))}catch(_){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',_)}}
  function readUsage(){
    let all={};
    try{all=JSON.parse(localStorage.getItem(USAGE_STORE)||'{}')}catch(_){all={}}
    if(!all||typeof all!=='object')all={};
    /* V2からの引き継ぎは**一度だけ**。既にV3にその人のバケットがあれば触らない
       (引き継いだあとに自分で消した履歴が、次の起動で戻ってきてしまう)。 */
    const uid=filterUserId();
    if(!all[uid]){
      try{
        const old=JSON.parse(localStorage.getItem(USAGE_STORE_V2)||'{}');
        if(old&&typeof old==='object'&&Object.keys(old).length)all[uid]=old;
      }catch(_){WL.quiet.note('端末の覚えが読めない（既定で続ける）',_)}
    }
    return all;
  }
  function writeUsage(){try{localStorage.setItem(USAGE_STORE,JSON.stringify(S.filterCondUsage||{}))}catch(_){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',_)}}
  /* その人のバケット。**無ければ作る**(呼び出し側で毎回undefinedを気にしない)。 */
  function userUsageBucket(){
    const all=S.filterCondUsage||(S.filterCondUsage={});
    const uid=filterUserId();
    if(!all[uid]||typeof all[uid]!=='object')all[uid]={};
    return all[uid];
  }
  /* 利用履歴・アクティブ条件のスコープキー。プリセット(currentTablePresets)が
     以前からdb+tableの完全一致で管理されているのに合わせる。 */
  /* ---------- 登録フィルタの置き場をモードで分ける(§9.80) ----------
     同じ仕掛一覧でも、スケジュールモードは品質データを結合するので列構成が
     変わる。条件を共有すると「その表に無い列の条件」が並ぶことになるため、
     **スケジュールモードだけ別の置き場**にする(編集と閲覧は同じ列構成を
     同じように見るので分けない。3つに割ると、どこで作ったかを覚えて
     いなければ探せなくなる)。 */
  /* **アクセスモードではなく「どこで開いた一覧か」で分ける**(§9.184)。
     以前は`accessMode.mode==='schedule'`で決めていたため、スケジュール
     モードの端末では「元データ」から開いた仕掛一覧まで同じ置き場を使い、
     ①スケジュール作成中の条件が普通の一覧にも当たり ②モードが変わると
     どちらの置き場も入れ替わる、という2つの困りごとになっていた。
     列構成が変わるのは**スケジュール画面の中の仕掛一覧**（品質データを
     結合する）なので、判定もそこに合わせる。 */
  function presetMode(){return document.body.classList.contains('sc-mode')?'schedule':''}
  const SCENE_LABEL={'schedule':'スケジュール作成中の仕掛一覧','':'「元データ」の一覧'};
  function sceneLabel(){return SCENE_LABEL[presetMode()]||'この一覧'}
  function usageScopeKey(){return `${S.db||''}\u001f${S.table||''}\u001f${presetMode()}`}
  function scopedUsage(){
    const bucket=userUsageBucket()[usageScopeKey()];
    return (bucket&&typeof bucket==='object')?bucket:{};
  }
  /* ---------- 条件値の変数(§9.74) ----------
     フィルタを「この端末の使用設備で絞る」形で保存できるようにする。値へ
     直接設備名を書くと、その端末でしか使えない条件になり、設備を変えるたびに
     作り直すことになる。変数のまま保存し、**問い合わせを組み立てる瞬間に
     展開する**ので、同じ条件を全端末で共有でき、使用設備を変えれば自動的に
     追随する(保存時に展開してしまうとこの利点が消えるので、展開は必ず
     送信直前に行うこと)。 */
  const FILTER_VARS=[
    {token:'{使用設備}',label:'使用設備',
     hint:'この端末に登録している使用設備の名前に置き換わります',
     resolve:()=>(typeof currentConfiguredEquipment==='function'?currentConfiguredEquipment():'')||''},
  ];
  function filterVarFor(value){
    const v=String(value??'');
    return FILTER_VARS.find(x=>v.includes(x.token))||null;
  }
  /* 変数を今の値へ置き換える。未設定(使用設備が未登録)ならトークンをそのまま
     残さず空文字にする——残すと「{使用設備}」という文字列で検索してしまい、
     0件なのか未設定なのか区別できなくなる。 */
  function expandFilterVars(value){
    let out=String(value??'');
    FILTER_VARS.forEach(v=>{if(out.includes(v.token))out=out.split(v.token).join(v.resolve())});
    return out;
  }
  function expandFilterList(list){
    return (list||[]).map(f=>filterVarFor(f.value)?{...f,value:expandFilterVars(f.value)}:f);
  }
  window.WL=window.WL||{};
  WL.expandFilterVars=expandFilterVars;

  function opLabel(op){return OPS.find(x=>x[0]===op)?.[1]||op}
  function opShort(op){return (OPS.find(x=>x[0]===op)?.[1]||op).split(' ')[0]}
  function noValueOp(op){return ['empty','not_empty'].includes(op)}
  function filterKey(f){return [f.column,f.op,f.value].join('\u001f')}
  function formatTol(kind,v){return typeof fixedToleranceValue==='function'?fixedToleranceValue(kind,v):(Number.isFinite(Number(v))?String(v):'-')}
  /* db/tableが完全一致するプリセットのみを対象とする(厳密一致)。以前は
     対象DB/対象テーブルが空欄のプリセットを「どのテーブルにも適用される
     もの」として扱っていたが、保存時は必ずS.db/S.tableを記録するため
     本来空欄は発生しない想定。ファイル/テーブルごとに完全に個別管理する
     ため、空欄=汎用というフォールバックは廃止する。 */
  function currentTablePresets(){return (S.filterPresets||[]).filter(p=>p.db===S.db&&p.table===S.table)}
  function condLabel(f){
    if(noValueOp(f.op))return `${f.column} ${opShort(f.op)}`;
    // 変数を使っている条件は、変数名と「今の値」を併記する(どちらか片方だと
    // 何で絞られているのか・なぜ0件なのかが分からない)。
    const v=filterVarFor(f.value);
    if(v){
      const now=expandFilterVars(f.value);
      return `${f.column} ${opShort(f.op)} ${f.value}${now?`（=${now}）`:'（未設定）'}`;
    }
    return `${f.column} ${opShort(f.op)} ${f.value}`;
  }
  function bumpCondUsage(f){
    // どのDB/テーブルで使った条件かを必ず添えて記録する(V3、上記コメント参照)。
    const scope=usageScopeKey();if(!S.db||!S.table)return;
    const all=userUsageBucket();
    const bucket=(all[scope]&&typeof all[scope]==='object')?all[scope]:(all[scope]={});
    const k=filterKey(f);const u=bucket[k]||{count:0};
    u.count=(u.count||0)+1;u.at=Date.now();u.f={column:f.column,op:f.op,value:f.value};
    bucket[k]=u;writeUsage();
  }

  /* ---- ローディング表示 ---- */
  function setInlineLoading(show,text){
    const el=$('#filterInlineLoading');if(!el)return;
    const t=$('#filterInlineLoadingText');if(t&&text)t.textContent=text;
    el.hidden=!show;
  }
  function setPanelLoading(container,show,text){
    if(!container)return;let box=container.querySelector(':scope > .panel-loading');
    if(show){
      if(!box){box=document.createElement('div');box.className='panel-loading';box.innerHTML='<div class="pl-box">'+WL.loader.html(16)+'<span class="pl-text"></span></div>';container.appendChild(box)}
      box.querySelector('.pl-text').textContent=text||'読み込んでいます...';box.hidden=false;
    }else if(box){box.hidden=true}
  }
  const canWait=()=>typeof WL.records.showWaiting==='function'&&typeof WL.records.hideSaveOverlay==='function';

  /* ---- マスタ連携（読込・保存・削除・使用回数） ---- */
  /* opts.db/opts.table を渡せる(§9.184)。**テーブルが決まる前に呼ぶ経路がある**
     ——一覧を開くときは、S.tableへ入る前に「その一覧の登録フィルタ」が要る
     (印を当てる相手が無いと、既定・鍵の自動適用がそのまま空振りする)。 */
  async function loadMasterPresets(opts={}){
    if(opts.inline!==false)setInlineLoading(true,'マスタからフィルタを読込中');
    try{
      const db=opts.db!=null?opts.db:S.db,table=opts.table!=null?opts.table:S.table;
      const q=new URLSearchParams();if(db)q.set('db',db);if(table)q.set('table',table);
      q.set('mode',presetMode());
      /* **誰が見ているか**をサーバーへ渡す(§9.172)。返るのは「みんなのもの」と
         「自分のもの」だけで、印(デフォルト・鍵)もその人のぶんが載って来る。 */
      q.set('user',filterUserId());
      const r=await api('/api/filter-presets?'+q);
      /* **サーバーが返す持ちものは1つも落とさないこと**（§9.286 ①）——
         `group`を写し忘れていたため、付け替えは保存されているのに画面では
         いつまでも「分類なし」だった（保存の口を見る網では捕まらない）。 */
      const fromMaster=(r.items||[]).map(x=>({id:x.id,name:x.name,db:x.db,table:x.table,mode:x.mode||'',filters:Array.isArray(x.filters)?x.filters:[],uses:x.uses||0,lastUsed:x.last_used,updatedAt:x.updated_at,master:true,
        group:x.group||'',
        /* メンバー(§9.288 ②)。**1件以上＝組み合わせ（プリセット）の行**。
           写し忘れると、組み合わせが「条件0件の登録」として並ぶ。 */
        members:Array.isArray(x.members)?x.members.slice():[],
        owner:x.owner||'',mine:!!x.mine,shared:!!x.shared,isDefault:!!x.isDefault,isLocked:!!x.isLocked}));
      /* 端末ごとの古い印を、一度だけこの人の印へ移す。**移してから写す**
         ——先に写すと、移行で付いた印がその場では反映されない。 */
      await migrateLegacyMarks(fromMaster,!!r.hasPersonalMarks);
      absorbServerMarks(fromMaster,db,table,presetMode());
      /* マスタへ書けなかったぶん(この端末だけの控え)は**捨てない**。
         以前はマスタの内容で丸ごと置き換えていたため、保存に失敗して
         ローカルへ退避した直後の再読込でそれごと消え、「登録したのに
         一覧に出ない」という見え方になっていた。 */
      const localOnly=(S.filterPresets||[]).filter(pz=>!pz.master);
      S.filterPresets=[...localOnly,...fromMaster];
      /* **どの一覧の・誰のぶんを読んだか**を覚える(§9.184)。利用者IDは
         後から届くので、IDが変わったら読み直す必要がある——ここを
         「読んだかどうか」だけで覚えると、空のIDで読んだ結果を
         その人のものだと思い込み、印(デフォルト・鍵)が永久に付かない。 */
      presetsLoadedFor=`${mapKeyOf(db,table,presetMode())}\u001f${filterUserId()}`;
      S.filterPresetSource='master';writeLocalPresets();return true;
    }catch(e){
      S.filterPresets=readLocalPresets();S.filterPresetSource='local';console.warn('フィルタマスタ読込失敗、ローカルを使用',e);return false;
    }finally{setInlineLoading(false)}
  }
  /* マスタへの保存は「今アクティブな条件の組み合わせ」を1件のプリセット
     として束ねるのではなく、条件1つずつを個別のプリセットとして登録する。
     組み合わせ単位だと再利用時に不要な条件までまとめて適用されてしまい
     使い勝手が悪いため、単一条件ずつ再利用できるようにする。 */
  /* 登録名は**変数をトークンのまま**入れる(§9.80)。condLabel は
     「{使用設備}（=LS4）」のように今の値を併記するため、そのまま名前に
     すると設備を変えるたびに別名で登録され、同じ条件が増えていく。 */
  function presetName(f){
    if(noValueOp(f.op))return `${f.column} ${opShort(f.op)}`.slice(0,60);
    return `${f.column} ${opShort(f.op)} ${f.value}`.slice(0,60);
  }
  /* この条件が「すでに登録されている単独の条件」か。タグの★/☆に使う。 */
  function registeredPreset(f){
    const k=filterKey(f);
    return (S.filterPresets||[]).find(pz=>(pz.filters||[]).length===1
      &&filterKey(pz.filters[0])===k&&pz.db===S.db&&pz.table===S.table)||null;
  }
  /* 条件1件をマスタへ登録する。**適用とは切り離す**——「今だけ効かせたい」と
     「次回も使いたい」は別の意図なので、片方だけ選べる必要がある(§9.80)。 */
  async function saveOneToMaster(f,{silent=false}={}){
    if(registeredPreset(f)){
      if(!silent)showToast?.('すでに登録済みです',presetName(f),3000);
      return 'dup';
    }
    /* 登録は**自分のもの**として作る(§9.172)。みんなで使いたいときは登録一覧で
       「みんな」へ切り替える——保存の瞬間に共有かどうかを決めさせると、
       条件を1つ足すたびに関係のない判断が挟まる。 */
    const payload={name:presetName(f),db:S.db,table:S.table,mode:presetMode(),filters:[f],user:filterUserId()};
    try{
      await api('/api/filter-presets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withUserId(payload))});
      await loadMasterPresets({inline:false});
      if(!silent)showToast?.('条件を登録しました',
        presetMode()==='schedule'?`${presetName(f)}（スケジュールモード用）`:presetName(f),3600);
      renderGenericFilterBar();renderFilterPresetList();
      return 'saved';
    }catch(e){
      /* マスタへ書けないときはこの端末だけの控えとして残す。以前は残した
         直後の再読込で消えていた(loadMasterPresetsが丸ごと置き換えていた)。 */
      const preset={id:crypto.randomUUID(),name:payload.name,db:S.db,table:S.table,
                    mode:presetMode(),filters:[f],updatedAt:new Date().toISOString(),master:false,
                    owner:filterUserId(),mine:true};
      S.filterPresets=[preset,...(S.filterPresets||[])].slice(0,120);writeLocalPresets();
      showToast?.('マスタへ登録できませんでした',`${e.message}（この端末にだけ控えました）`,7000);
      renderGenericFilterBar();renderFilterPresetList();
      return 'local';
    }
  }

  /* `saveCurrentFiltersToMaster()`は§9.80でバーの入口（「マスタへ保存」）を
     外して以来どこからも呼ばれていなかったので、§9.286 ①の整理で消した。
     いまの登録の道は**条件の札の☆**（1件ずつ・登録済みかが読める）と、
     ビルダーの「登録」の2つ。**まとめて登録の入口を戻さないこと**——
     何が登録されたのか・何が既に登録済みなのかが読めなくなる（§9.80）。 */
  async function deletePreset(preset){
    if(!(await confirmModal(`登録フィルタ「${preset.name}」を削除しますか？`)))return;
    const listEl=$('#filterPresetList');
    if(preset.master&&preset.id!=null){
      setPanelLoading(listEl,true,'マスタから削除しています...');
      try{await api('/api/filter-presets/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withUserId({id:preset.id,user:filterUserId()}))});await loadMasterPresets({inline:false})}
      catch(e){showToast?.('マスタから削除できませんでした',e.message,6500)}
      finally{setPanelLoading(listEl,false)}
    }else{
      S.filterPresets=(S.filterPresets||[]).filter(x=>x!==preset);writeLocalPresets();
    }
    renderGenericFilterBar();renderFilterPresetList();
  }
  /* 「自分だけ」と「みんな」を行き来する(§9.172)。**どちらへ動かすのかを
     文で確かめる**——「みんな」へ出すのは他の人の画面に増えること、
     「自分だけ」へ戻すのは他の人の画面から消えることで、どちらも自分以外に
     影響が出る操作なので、押した先を書いてから実行する。 */
  async function togglePresetOwner(preset){
    if(!preset||preset.id==null)return;
    if(!preset.master){
      showToast?.('この端末だけの控えです','マスタへ届いてから共有できます（「再読込」で送り直せます）。',5200);
      return;
    }
    const toShared=!!preset.owner;   // 今が自分のもの → みんなへ
    const ok=await confirmModal(toShared
      ?{eyebrow:'SHARE FILTER',title:`「${preset.name}」をみんなで使えるようにします`,
        confirmLabel:'みんなで使う',
        bodyHtml:`<p class="confirm-modal-message">この登録フィルタが<b>ほかの人の「登録した条件とプリセット」にも出る</b>ようになります。</p>
         <ul class="confirm-modal-points">
          <li>条件そのものが共有されます。「デフォルト」「鍵」の印は<b>人ごと</b>なので、ほかの人へは付きません。</li>
          <li>みんなのものになったフィルタは、<b>ほかの人も消せます</b>。</li>
         </ul>`}
      :{eyebrow:'MAKE PRIVATE',title:`「${preset.name}」を自分だけのものにします`,
        confirmLabel:'自分だけにする',
        bodyHtml:`<p class="confirm-modal-message">この登録フィルタが<b>ほかの人の一覧から消えます</b>（${esc(filterUserLabel())} だけに見えます）。</p>
         <ul class="confirm-modal-points">
          <li>ほかの人がこれをデフォルトに使っていた場合、その人の一覧では当たらなくなります。</li>
         </ul>`});
    if(!ok)return;
    const listEl=$('#filterPresetList');
    setPanelLoading(listEl,true,'持ち主を変えています...');
    try{
      await api('/api/filter-presets/owner',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(withUserId({id:preset.id,user:filterUserId(),shared:toShared}))});
      await loadMasterPresets({inline:false});
      showToast?.(toShared?'みんなで使えるようにしました':'自分だけのものにしました',preset.name,3600);
    }catch(e){showToast?.('持ち主を変えられませんでした',e.message,6500)}
    finally{setPanelLoading(listEl,false)}
    renderGenericFilterBar();renderFilterPresetList();
  }
  function markPresetUsed(preset){
    if(!preset)return;preset.uses=(preset.uses||0)+1;
    if(preset.master&&preset.id!=null){
      // 使用回数はサジェスト順位の材料。ブロックせず裏で加算する。
      api('/api/filter-presets/use',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:preset.id,user_id:currentUserId()})}).catch(WL.quiet('登録フィルタの利用回数を送れない（候補の並びが変わらないだけ）'));
    }
  }

  /* ---- デフォルトフィルタ（テーブルごとに複数選択可） ----
     一覧を開くたび（selectTable時）に、登録済みプリセットのうち
     デフォルト指定されたものを自動適用する。 */
  /* ---------- 印（デフォルト・鍵）の置き場(§9.172) ----------
     以前はこの2つを端末のlocalStorageに置いていた。そのため
       (1) 同じPCを別の人が使うと、**相手が付けた既定が自分の一覧に当たる**
       (2) 自分が別のPCへ移ると、**付けた覚えの印が消えている**
     という形で出ていた。印は「人の好み」なので**人に付ける**。

     置き場はマスタ(フィルタ個人設定マスタ)だが、**画面の中の形は変えない**
     ——`db::table::mode` → プリセットIDの配列、という今までの形のまま持ち、
     読み書きの出どころだけ差し替える(判定・適用・解除の処理が全部この形に
     乗っているので、形ごと変えると影響範囲がフィルタ全体になる)。
     localStorageは**マスタへ届かないときの控え**として残す(利用者ごとの鍵で
     分ける。共有DBが不調でも、その端末で続きが使える)。 */
  const DEFAULT_STORE='MeasurementDefaultFilterPresetsV1';
  const MARK_MIRROR='MeasurementFilterMarksV2';       // 利用者ID -> {def:{},lock:{}}
  const MARK_MIGRATED='MeasurementFilterMarksMigratedV1';
  let markMaps=null,markMapsUid=null;                 // {def:{},lock:{}} と、その持ち主
  function readMarkMirror(){
    try{const all=JSON.parse(localStorage.getItem(MARK_MIRROR)||'{}');
        const mine=all[filterUserId()];
        if(mine&&typeof mine==='object')return {def:mine.def||{},lock:mine.lock||{}};
    }catch(_){WL.quiet.note('端末の覚えが読めない（既定で続ける）',_)}
    return null;
  }
  function writeMarkMirror(){
    try{
      const all=JSON.parse(localStorage.getItem(MARK_MIRROR)||'{}');
      all[filterUserId()]={def:markMaps.def,lock:markMaps.lock};
      localStorage.setItem(MARK_MIRROR,JSON.stringify(all));
    }catch(_){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',_)}
  }
  /* 端末に残っている**旧V1（端末ごとの印）**。移行の材料としてだけ読む。 */
  function legacyMarkMaps(){
    const read=k=>{try{const m=JSON.parse(localStorage.getItem(k)||'{}');return (m&&typeof m==='object')?m:{}}catch(_){return {}}};
    return {def:read(DEFAULT_STORE),lock:read(LOCKED_DEFAULT_STORE)};
  }
  function ensureMarkMaps(){
    const uid=filterUserId();
    if(markMaps&&markMapsUid===uid)return markMaps;
    /* **利用者IDが変わったら読み直す**(§9.190)。利用者IDは`/api/whoami`から
       **後から届く**(§9.184)ので、空のうちに作った写しを持ち続けると
       (a)その人の控えはそのセッション中**一度も読まれず**、
       (b)`writeMarkMirror()`が空の写しを本人の置き場へ書き戻して**印を消す**。
       他は全部「呼ぶたびにIDを引く」約束なのに、ここだけ1回で固定していた。 */
    markMaps=readMarkMirror()||legacyMarkMaps();
    markMapsUid=uid;
    return markMaps;
  }
  function readDefaultPresetMap(){return ensureMarkMaps().def}
  function writeDefaultPresetMap(map){ensureMarkMaps().def=map;writeMarkMirror()}
  // 既定・鍵の記憶もモードごと(上と同じ理由)。
  /* 置き場のキー。**モードを外から渡せる形にしておく**(§9.171)——書き出し・
     取り込みは「今開いているモード」以外の一覧の印も扱うので、presetMode()を
     固定で埋め込んでいると自分のモードぶんしか読めない。 */
  function mapKeyOf(db,table,mode){return `${db||''}::${table||''}::${mode||''}`}
  function defaultMapKey(db,table){return mapKeyOf(db,table,presetMode())}
  function defaultPresetIdsFor(db,table){return (readDefaultPresetMap()[defaultMapKey(db,table)]||[]).map(String)}
  function isDefaultPreset(preset,db,table){return defaultPresetIdsFor(db,table).includes(String(preset.id))}
  function setDefaultPreset(preset,db,table,on,opts={}){
    const map=readDefaultPresetMap(),key=defaultMapKey(db,table),ids=new Set((map[key]||[]).map(String)),pid=String(preset.id);
    if(on)ids.add(pid);else ids.delete(pid);
    map[key]=[...ids];writeDefaultPresetMap(map);
    preset.isDefault=on;
    /* 印は2つそろえて1回で送る(§9.190)ので、既定では送らない。 */
    if(opts.push!==false)return pushMark(preset.id,db,table,presetMode());
    return Promise.resolve(true);
  }

  /* ---- 鍵付きデフォルトフィルタ（テーブルごとに複数選択可） ----
     デフォルトフィルタのうち、鍵を付けたものは「一覧を開くたびに必ず
     自動適用され、外そうとすると確認が必要な必須条件」になる(旧・固定
     設備フィルタと同じ挙動)。鍵はデフォルトが前提のため、鍵を付けると
     デフォルトも自動でONにし、デフォルトを外すと鍵も一緒に外れる。 */
  const LOCKED_DEFAULT_STORE='MeasurementLockedDefaultFilterPresetsV1';
  function readLockedPresetMap(){return ensureMarkMaps().lock}
  function writeLockedPresetMap(map){ensureMarkMaps().lock=map;writeMarkMirror()}
  /* 1件ぶんの印をマスタへ残す。**画面は待たせない**——印は付けた瞬間に効いて
     ほしいもので、共有DBの往復を待たせる性質のものではない。届かなければ
     端末の控えだけが残る(次に届いたときに送り直される)。 */
  function pushMark(presetId,db,table,mode){
    if(presetId==null)return Promise.resolve(true);
    const key=mapKeyOf(db,table,mode);
    const has=(m,k)=>((m[key]||[]).map(String)).includes(String(presetId));
    return api('/api/filter-presets/marks',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(withUserId({user:filterUserId(),id:presetId,
        isDefault:has(readDefaultPresetMap()),isLocked:has(readLockedPresetMap())}))})
      .then(()=>true)
      .catch(e=>{
        /* **黙って画面だけ変えない**(§9.190)。以前はここで握り潰していたため、
           scheduleモードでは書込ガードに弾かれて(403)いたことに誰も気づけず、
           印は端末の控えにだけ残った。次に登録フィルタを読み直した時点で
           サーバーの答え(印なし)で上書きされ、**「鍵をかけたのに画面を
           切り替えると外れる」**という形で出ていた（実機で報告）。 */
        console.warn('フィルタの印を保存できませんでした',e);
        showToast&&showToast('「いつも適用」を保存できませんでした',
          `${e.message||'マスタへ届きませんでした'}\nこの端末では効いていますが、開き直すと外れます。`,8000);
        return false;
      });
  }
  /* サーバーが返した印を、画面が使う形（キー→ID配列）へ写す。**返ってきた
     ぶんだけ触る**——他のテーブルの印を、今の問い合わせに載っていないという
     理由で消してはいけない。 */
  function absorbServerMarks(items,db,table,mode){
    const maps=ensureMarkMaps(),key=mapKeyOf(db,table,mode);
    const def=new Set((maps.def[key]||[]).map(String)),lock=new Set((maps.lock[key]||[]).map(String));
    (items||[]).forEach(x=>{
      const id=String(x.id);
      x.isDefault?def.add(id):def.delete(id);
      x.isLocked?lock.add(id):lock.delete(id);
    });
    maps.def[key]=[...def];maps.lock[key]=[...lock];
    writeMarkMirror();
  }
  /* 端末ごとの印（V1）を、**一度だけ**その人の印としてマスタへ移す(§9.172)。
     その人の印がマスタに1件も無いときだけ行う——既に自分で付け直した人の
     設定を、端末に残っていた古い印で上書きしない。移行したことは端末に
     覚えておく(0件へ戻したあと、もう一度移行が走らないように)。 */
  async function migrateLegacyMarks(items,serverHasMarks){
    let done={};
    try{done=JSON.parse(localStorage.getItem(MARK_MIGRATED)||'{}')}catch(_){WL.quiet.note('端末の覚えが読めない（既定で続ける）',_)}
    const uid=filterUserId();
    if(done[uid]||serverHasMarks)return false;
    /* **端末に残っている印を全部まとめて1回で移す。** 今開いている一覧ぶんだけを
       見ると、起動直後(まだテーブルを選ぶ前)に空振りしたまま「移行済み」に
       なってしまい、以降どの一覧の印も移らない（実際にそうなった）。
       旧V1のマップは値がプリセットIDそのものなので、一覧の中身は要らない。 */
    const legacy=legacyMarkMaps();
    const ids=new Map();   // id -> {isDefault,isLocked}
    const collect=(maps,field)=>Object.values(maps||{}).forEach(list=>(list||[]).forEach(id=>{
      const k=String(id);const cur=ids.get(k)||{isDefault:false,isLocked:false};
      cur[field]=true;ids.set(k,cur);
    }));
    collect(legacy.def,'isDefault');collect(legacy.lock,'isLocked');
    if(ids.size){
      try{
        await api('/api/filter-presets/marks',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify(withUserId({user:uid,
            items:[...ids].map(([id,m])=>({id,isDefault:m.isDefault,isLocked:m.isLocked}))}))});
        /* 今回の応答にも当てておく——移行した直後の画面が「印なし」で
           描かれると、付け直したのかと思わせる。 */
        (items||[]).forEach(x=>{
          const m=ids.get(String(x.id));
          if(m){x.isDefault=m.isDefault;x.isLocked=m.isLocked}
        });
      }catch(_){return false}
    }
    done[uid]=new Date().toISOString();
    try{localStorage.setItem(MARK_MIGRATED,JSON.stringify(done))}catch(_){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',_)}
    return ids.size>0;
  }
  function lockedPresetIdsFor(db,table){return (readLockedPresetMap()[defaultMapKey(db,table)]||[]).map(String)}
  function isLockedDefaultPreset(preset,db,table){return lockedPresetIdsFor(db,table).includes(String(preset.id))}
  function setLockedDefaultPreset(preset,db,table,on){
    const map=readLockedPresetMap(),key=defaultMapKey(db,table),ids=new Set((map[key]||[]).map(String)),pid=String(preset.id);
    if(on)ids.add(pid);else ids.delete(pid);
    map[key]=[...ids];writeLockedPresetMap(map);
    preset.isLocked=on;
  }

  /* ---------- 「いつも適用（固定）」は1つの概念(§9.190) ----------
     利用者の言葉:「フィルタの鍵は、他の一覧で使えないという意味ではなく、
     **適用したフィルタから外せなくなる**という意味のフィルタロック。つまり
     鍵マークはデフォルトにすると同義。混同するならデフォルトのチェック
     だけでよい」。

     **2つに分けていたこと自体が間違い**だった。「デフォルト（自動で入る）」と
     「鍵（外せない）」を別の印にすると、片方だけ付いた状態が作れてしまい、
     利用者は2つの言葉を覚えることになる。画面の操作は**チェック1つ**に統合し、
     マスタ側は今までどおり2つの印へ**そろえて**書く（形を変えないので、
     古い設定や他の端末とそのまま行き来できる）。

     **どちらか一方でも付いていれば「いつも適用」**として読む——以前の
     設定（デフォルトだけ付けた登録）が、更新した瞬間に効かなくなるのを
     避けるため。 */
  function alwaysOnIdsFor(db,table){
    return [...new Set([...defaultPresetIdsFor(db,table),...lockedPresetIdsFor(db,table)])];
  }
  function isAlwaysOnPreset(preset,db,table){
    return alwaysOnIdsFor(db,table).includes(String(preset.id));
  }
  /* 印を付け外しする唯一の入口。**保存できなければ元へ戻す**——押した通りに
     なったように見せて、開き直すと外れているのが一番困る(§9.190)。 */
  async function setAlwaysOnPreset(preset,db,table,on){
    const was=isAlwaysOnPreset(preset,db,table);
    setDefaultPreset(preset,db,table,on,{push:false});
    setLockedDefaultPreset(preset,db,table,on);
    const ok=await pushMark(preset.id,db,table,presetMode());
    if(!ok&&was!==on){
      setDefaultPreset(preset,db,table,was,{push:false});
      setLockedDefaultPreset(preset,db,table,was);
    }
    return ok;
  }
  /* 戻り値は**足した条件の数**。0のときは知らせない(一覧を引くたびに
     「適用しました」と言われると読まれなくなる)。 */
  function applyDefaultFiltersFor(db,table){
    const ids=alwaysOnIdsFor(db,table);if(!ids.length)return 0;
    const idSet=new Set(ids);
    const matches=(S.filterPresets||[]).filter(p=>idSet.has(String(p.id)));
    if(!matches.length)return 0;
    let added=0;
    /* **「いつも適用」は必ず固定**(§9.190)。自動で入るのに手で外せると、
       次に開いたときにまた入る——外れているのか効いているのかが分からない。 */
    const ordered=matches;
    /* 呼び出し元(selectTable)がここより前にrestoreActiveFilterState()で
       復元済みの、このテーブル向けの非鍵付き(手動追加)条件へ重ね合わせる。
       以前はS.genericFiltersを丸ごと置き換えており、デフォルトフィルタが
       設定されたテーブルでは、タブを切り替えて戻るたびに手動で追加した
       検索条件が無警告で消えていた。 */
    const seen=new Set(S.genericFilters.map(filterKey));
    ordered.forEach(p=>{
      const locked=true;
      (p.filters||[]).forEach(f=>{
        const k=filterKey(f);
        if(!seen.has(k)){
          seen.add(k);S.genericFilters.push(locked?{...f,locked:true}:{...f});added++;
        }else if(locked){
          const idx=S.genericFilters.findIndex(x=>filterKey(x)===k);
          if(idx>=0&&!S.genericFilters[idx].locked)S.genericFilters[idx]={...S.genericFilters[idx],locked:true};
        }
      });
    });
    S.page=1;
    if(added)showToast?.('いつも適用する条件を入れました',
      matches.map(p=>p.name).join(' / ')+`（${sceneLabel()}）`,3200);
    return added;
  }

  /* あるプリセットの条件が、対象のプリセット自身を除いても他のデフォルト
     (または鍵付き)プリセットから引き続き必要とされているか。デフォルト
     /鍵の解除時、他プリセットが同じ条件を必要としていれば残す。 */
  function presetFilterRequiredElsewhere(preset,key,{lockedOnly=false}={}){
    /* 印は1つになった(§9.190)ので、lockedOnlyでも同じ集合を見る。 */
    const ids=alwaysOnIdsFor(S.db,S.table).filter(id=>String(id)!==String(preset.id));
    if(!ids.length)return false;
    const idSet=new Set(ids);
    return (S.filterPresets||[]).some(p=>idSet.has(String(p.id))&&(p.filters||[]).some(f=>filterKey(f)===key));
  }
  /* 登録フィルタ一覧のデフォルト/鍵チェックを変更した直後、現在表示中の
     フィルタバー(S.genericFilters)へ即座に反映する。デフォルトONなら
     そのプリセットの条件を追加(手動で一度外していても復活させる)、OFF
     なら他のデフォルトプリセットが同じ条件を必要としない限り取り除く。
     画面切替(selectTable)を待たずに反映することで、フィルタ設定画面から
     やり直した内容がその場のフィルタバーに即再適用されるようにする。 */
  function syncActiveFiltersForPreset(preset){
    const isDefault=isAlwaysOnPreset(preset,S.db,S.table);
    const locked=isDefault;   // いつも適用＝固定(§9.190)
    (preset.filters||[]).forEach(f=>{
      const key=filterKey(f),idx=S.genericFilters.findIndex(x=>filterKey(x)===key);
      if(isDefault){
        if(idx>=0){
          if(locked&&!S.genericFilters[idx].locked)S.genericFilters[idx]={...S.genericFilters[idx],locked:true};
          else if(!locked&&S.genericFilters[idx].locked&&!presetFilterRequiredElsewhere(preset,key,{lockedOnly:true})){
            const{locked:_,...rest}=S.genericFilters[idx];S.genericFilters[idx]=rest;
          }
        }else{
          S.genericFilters.push(locked?{...f,locked:true}:{...f});
        }
      }else if(idx>=0&&!presetFilterRequiredElsewhere(preset,key)){
        S.genericFilters.splice(idx,1);
      }
    });
    S.page=1;renderGenericFilterBar();WL.list.load();
  }

  /* 保存フィルタは条件単位で登録されるため、適用は常にマージ(現在の条件へ
     追加)とする。置換にすると、他の条件や使用設備の必須条件まで消えて
     しまい、条件単位で運用する意味が薄れるため。 */
  function applyPreset(preset,{merge=true}={}){
    markPresetUsed(preset);
    const incoming=structuredClone(preset.filters||[]);
    const seen=new Set(S.genericFilters.map(filterKey));
    incoming.forEach(f=>{if(!seen.has(filterKey(f))){S.genericFilters.push(f);seen.add(filterKey(f))}});
    S.genericFilters.forEach(bumpCondUsage);
    S.page=1;renderGenericFilterBar();WL.list.load();
  }

  /* ================= プリセット（§9.287、利用者の指示） =================
     「プリセットフィルタは登録一覧から作るが、登録した条件の組み合わせで
      名前を付けて管理したいです」
     「プリセットフィルタは1つのボタンでポップオーバーメニューで切り替え」
     「組み合わせて使わず切り替えて使うので、ボタン1つにして、切り替えられる
      のが理想です」
     「プリセットフィルタと今までのフィルタ登録条件は重複させず、どちらかを
      使うようにしたいです（プリセットがそもそも登録フィルタの組み合わせのため）」

     §9.286 ① では登録条件を札で横に並べ、群を「表示を絞る器」にしていた。
     そのため**同じ条件が2つの言語で同時に画面へ出て**いた——濃い札
     「残仕掛設備ｺｰｽ 前方一致」と、そのすぐ右のトークン「ロット番号
     startswith L0001」が同じ1件（実機で確認）。§CLAUDE 画面基準 8 の
     「同じ情報を2箇所に出さない」に真正面から反する。

     いまは**2層**で持つ:
       ・**登録した条件** … `フィルタプリセットマスタ`の1行。組み合わせの部品。
                            置き場は登録一覧（バーには出さない）。
       ・**プリセット**   … その組み合わせに名前を付けたもの。実体は同じ行の
                            `[グループ]`列（**新しいマスタを作らない**）。
     **組み合わせに入れていない条件は「条件1件のプリセット」として同じ列に
     並べる**——そうしないと、組み合わせを作るまでボタンが空という崖ができる
     （プリセットは「1件以上の条件の集まり」で、1件はその特別な場合）。

     **当てるのではなく切り替える**（利用者の指示）。選ぶと、前に選んでいた
     プリセットの条件が外れ、選んだプリセットの条件が入る。**手で足した条件と
     「いつも適用」は残す**——スポットで打った条件がプリセットの切り替えで
     消えるのは、いちばん驚く壊れ方。

     置き場は**この端末×利用者×一覧**（読み方の好みなので端末ごとに違って
     よい・§9.199）。**鍵はV2**——V1は「どの群を表示するか」であって
     「どのプリセットを当てるか」ではない。同じ鍵で読むと、前の版で群を
     選んでいた端末が**一覧を開いた瞬間にその群の条件で絞られる**（§9.204）。 */
  const PRESET_STORE='MeasurementFilterPresetV2';
  const PRESET_NONE='';           // 「なし」＝プリセットの条件を入れない
  let presetSelAll=(()=>{try{const m=JSON.parse(localStorage.getItem(PRESET_STORE)||'{}');
                             return (m&&typeof m==='object')?m:{}}catch(_){return {}}})();
  function writePresetSel(){try{localStorage.setItem(PRESET_STORE,JSON.stringify(presetSelAll))}catch(_){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',_)}}
  /* **利用者IDは呼ぶたびに引く**（`/api/whoami`から後から届く・§9.184）。 */
  function presetSelBucket(who){
    const k=(who===undefined?filterUserId():who)||'';
    if(!presetSelAll[k]||typeof presetSelAll[k]!=='object')presetSelAll[k]={};
    return presetSelAll[k];
  }
  /* 登録した条件の呼び名。**`presetName()`と混ぜないこと**——あちらは
     「1件の条件」から名前を作る関数（`f.column`/`f.op`/`f.value`を読む）で、
     登録フィルタそのものを渡すと`op`が無く`opShort(undefined)`で落ちる
     （実際に踏んだ。一覧が丸ごと出なくなる）。 */
  function presetTitle(p){
    const n=String((p&&p.name)||'').trim();
    return n||((p&&p.filters)||[]).map(condLabel).join(' / ')||'（名前なし）';
  }
  /* ---------- 「組み合わせ」は行そのもの（§9.288 ②、利用者の指示） ----------
     「フィルタプリセットについては登録したデータを使いまわせるような形が
      良いです。今だとグループのどこかに属するような使い方ですが、やりたいのは
      フィルタ登録したデータを何回でも使えるという組み合わせのプリセット登録
      です。」

     §9.286 ①／§9.287 の`[グループ]`は**名札**だった——1つの条件は1つの群に
     しか属せないので、「この条件を3つのプリセットで使う」が書けない。
     いまは**組み合わせのほうが1行**（`[メンバーJSON]`に条件のIDを並べる）で、
     同じ条件のIDは何本の組み合わせにも現れてよい＝**使い回せる**。
     旧`[グループ]`は列を足した1回だけ組み合わせの行へ移してある（サーバー）。 */
  function presetMembersOf(p){return Array.isArray(p&&p.members)?p.members:[]}
  function isComboPreset(p){return presetMembersOf(p).length>0}
  function condPresets(){return currentTablePresets().filter(p=>!isComboPreset(p))}
  function comboPresets(){return currentTablePresets().filter(isComboPreset)}
  /* 組み合わせの中身。**消えた条件は数えて返す**（§4）——黙って抜けると、
     「入れたはずの条件が効かない」としか見えない。 */
  function comboParts(combo){
    const byId=new Map(condPresets().map(p=>[String(p.id),p]));
    const found=[],missing=[];
    presetMembersOf(combo).forEach(id=>{
      const p=byId.get(String(id));
      if(p)found.push(p);else missing.push(id);
    });
    return {found,missing};
  }
  /* この条件を使っている組み合わせ。**使い回しが目に見えること**がこの改良の
     値打ちなので、一覧の行にも必ず出す（§3）。 */
  function combosUsing(p){
    const id=String(p&&p.id);
    return comboPresets().filter(c=>presetMembersOf(c).some(m=>String(m)===id));
  }
  /* ---------- 切り替えの候補（プリセット）を1箇所で作る ----------
     組み合わせが先、登録した条件が後（分けたものが埋もれない）。
     **登録した条件は「入っていないもの」に絞らない**——使い回せるように
     なった以上、どの条件も単独で当てられるのが筋（§9.287で「1件はその
     特別な場合」と決めたことの続き）。**鍵は種別の印を付けた文字列**
     ——組み合わせの行と条件の行でIDがぶつからない。 */
  function presetEntries(){
    const combos=comboPresets().map(c=>{
      const part=comboParts(c);
      return {key:'c:'+c.id,name:presetTitle(c),kind:'combo',combo:c,
              presets:part.found,missing:part.missing.length};
    });
    const ones=condPresets().map(p=>({
      key:'p:'+p.id,name:presetTitle(p),kind:'single',combo:null,presets:[p],missing:0,
    }));
    /* 条件は登録の並びのまま畳む。**同じ条件を2度入れない**——同じ条件を
       持つ登録が1つの組み合わせに2つあると、トークンが二重になる。 */
    return [...combos,...ones].map(e=>{
      const seen=new Set(),conds=[];
      e.presets.forEach(p=>(p.filters||[]).forEach(f=>{
        const k=filterKey(f);if(seen.has(k))return;seen.add(k);conds.push(f);
      }));
      return Object.assign(e,{conds});
    });
  }
  function presetEntryOf(key){return key?(presetEntries().find(e=>e.key===key)||null):null}
  /* いま選んでいるプリセット。**消えた候補を覚えたままにしない**——組み合わせを
     消したり付け替えたりすると、「1件も無いプリセット」が選ばれたままになり、
     ボタンが名乗る名前と実際に効いている条件が食い違う（§9.204）。 */
  function selectedPresetKey(){
    const v=presetSelBucket()[defaultMapKey(S.db,S.table)];
    if(!v)return PRESET_NONE;
    return presetEntryOf(v)?v:PRESET_NONE;
  }
  function setSelectedPresetKey(key){
    const b=presetSelBucket(),k=defaultMapKey(S.db,S.table);
    if(!key)delete b[k];else b[k]=key;
    writePresetSel();
  }
  /* 外す側。**「いつも適用」の条件と、他の登録が要る条件は外さない**
     （§9.190。外しても次に開いた瞬間に戻ってくるので、押しても効かない
     ボタンに見える）。外せなかった件数を返す——**黙って残さない**（§4）。 */
  function removePresetFilters(p){
    let kept=0;
    (p.filters||[]).forEach(f=>{
      const key=filterKey(f);
      const i=S.genericFilters.findIndex(x=>filterKey(x)===key);
      if(i<0)return;
      if(isLockedFilter(S.genericFilters[i])||presetFilterRequiredElsewhere(p,key)){kept++;return}
      S.genericFilters.splice(i,1);
    });
    return kept;
  }
  /* ---------- 切り替え（この改良の主動線） ----------
     **前のプリセットの条件を外してから、選んだプリセットの条件を入れる。**
     外す対象を「前に選んでいたもの」に限るのが要——`S.genericFilters`を
     丸ごと空にすると、**その場で打った条件も一緒に消える**。 */
  function switchPreset(key,{reload=true}={}){
    const prev=presetEntryOf(selectedPresetKey());
    let kept=0;
    if(prev)prev.presets.forEach(p=>{kept+=removePresetFilters(p)});
    const next=presetEntryOf(key);
    if(next){
      const seen=new Set(S.genericFilters.map(filterKey));
      next.presets.forEach(p=>{
        markPresetUsed(p);
        structuredClone(p.filters||[]).forEach(f=>{
          if(!seen.has(filterKey(f))){S.genericFilters.push(f);seen.add(filterKey(f))}
        });
      });
      S.genericFilters.forEach(bumpCondUsage);
    }
    setSelectedPresetKey(next?next.key:PRESET_NONE);
    S.page=1;renderGenericFilterBar();
    if(reload)WL.list.load();
    /* **外せなかったことを黙らない**（§4）——「切り替えたのに前の条件が
       残っている」ようにしか見えない。 */
    if(kept&&typeof showToast==='function')
      showToast('外せない条件が残りました',
        `${kept}件は「いつも適用（固定）」なので、切り替えても入ったままです。`,6000);
  }
  /* ボタンが名乗る中身。**「選んでいる」と「効いている」を分けて言う**
     （§3）——条件はトークンから手で外せるので、選んだままずれうる。 */
  function presetButtonState(){
    const entries=presetEntries();
    const cur=presetEntryOf(selectedPresetKey());
    if(!cur)return {name:'なし',note:'',off:0,total:0,empty:!entries.length};
    const now=new Set(S.genericFilters.map(filterKey));
    const off=cur.conds.filter(f=>!now.has(filterKey(f))).length;
    return {name:cur.name,note:off?`${off}件外しています`:'',off,total:cur.conds.length,empty:false};
  }
  /* プリセットの1ボタン。**主動線はここだけ**——札を横に並べる行は廃した
     （利用者の指示「1つのボタンでポップオーバーメニューで切り替え」）。 */
  function renderPresetButton(){
    const btn=$('#filterPresetBtn');if(!btn)return;
    const name=$('#filterPresetName'),note=$('#filterPresetNote');
    const st=presetButtonState();
    if(name)name.textContent=st.name;
    if(note){note.textContent=st.note;note.hidden=!st.note}
    btn.classList.toggle('is-on',st.total>0&&!st.off);
    btn.classList.toggle('is-partial',st.total>0&&st.off>0);
    /* 当てていないとき（名前が「なし」）は**役の名前も要る**——狭い器で名前だけにすると
       「なし▾」が何の札か読めない（§9.468）。 */
    btn.classList.toggle('is-none',!st.total);
    btn.title=st.empty
      ? 'プリセット（登録した条件の組み合わせ）はまだありません。\n条件を登録して、「登録した条件とプリセット」で組み合わせに名前を付けると、ここで切り替えられます。'
      : st.total
        ? `プリセット「${st.name}」（条件${st.total}件${st.off?`／うち${st.off}件は外しています`:''}）\n押すと別のプリセットへ切り替えます。`
        : 'プリセットを当てていません。押すと切り替えられます。';
  }
  /* 切り替えの浮きメニュー。**器の外（body直下）へ`position:fixed`で出す**
     ——`#genericFilterBar`は`overflow`を持ちうるので、中に置くと切られる
     （§9.201）。**開いた器は必ず控える**（§9.222 ①）。 */
  let presetMenuEl=null;
  function closePresetMenu(){
    presetMenuEl?.remove();presetMenuEl=null;
    $('#filterPresetBtn')?.setAttribute('aria-expanded','false');
    document.removeEventListener('click',onPresetOutside,true);
    document.removeEventListener('keydown',onPresetEsc,true);
  }
  function onPresetOutside(e){
    if(presetMenuEl&&!presetMenuEl.contains(e.target)&&!e.target.closest('#filterPresetBtn'))closePresetMenu();
  }
  function onPresetEsc(e){if(WL.modal.escCloses(e))closePresetMenu()}
  function presetPickHtml(key,label,sub,on){
    return `<button type="button" role="menuitemradio" class="fb-preset-pick${on?' is-current':''}" `
      +`aria-checked="${on?'true':'false'}" data-preset-key="${esc(key)}">`
      +'<i class="fb-preset-mark" aria-hidden="true"></i>'
      +`<span class="fb-preset-label">${esc(label)}</span>`
      +`<small class="fb-preset-sub">${esc(sub)}</small></button>`;
  }
  function openPresetMenu(anchor){
    if(presetMenuEl){closePresetMenu();return}
    const entries=presetEntries();
    const cur=selectedPresetKey();
    const menu=document.createElement('div');
    menu.className='wl-menu access-mode-menu fb-preset-menu';menu.id='filterPresetMenu';
    menu.setAttribute('role','menu');
    const combos=entries.filter(e=>e.kind==='combo');
    const ones=entries.filter(e=>e.kind==='single');
    /* **消えた条件は数えて言う**（§9.288 ②・§4）——黙って抜けると、
       「入れたはずの条件が効かない」としか見えない。 */
    const sub=e=>`${e.conds.length}条件`
      +(e.missing?`（${e.missing}件は消えた条件）`:'')
      +' ／ '+e.conds.map(condLabel).join(' ・ ');
    let body='<p class="fb-preset-head">プリセット<small>登録した条件の組み合わせ。'
      +'押すと切り替わります（足すのではなく入れ替え）</small></p>'
      +presetPickHtml(PRESET_NONE,'なし','プリセットの条件を入れません',!cur);
    if(combos.length)
      body+='<p class="fb-preset-sec">組み合わせ</p>'
        +combos.map(e=>presetPickHtml(e.key,e.name,sub(e),e.key===cur)).join('');
    if(ones.length)
      /* **「まだ組み合わせに入れていない」ではない**（§9.288 ②）——条件は
         何本の組み合わせにも入れられるようになったので、入っていても
         そのまま1件で当てられる。 */
      body+='<p class="fb-preset-sec">登録した条件（1件ずつ当てる）</p>'
        +ones.map(e=>presetPickHtml(e.key,e.name,sub(e),e.key===cur)).join('');
    if(!entries.length)
      body+='<p class="fb-preset-empty">登録した条件がまだありません。'
        +'条件を作って「登録」すると、ここに並びます。</p>';
    body+='<div class="fb-preset-foot">'
      +'<button type="button" id="fbPresetManage">登録した条件とプリセットを開く</button>'
      +'<small>「いつも適用（固定）」の条件は、切り替えても入ったままです。</small></div>';
    menu.innerHTML=body;
    document.body.append(menu);
    presetMenuEl=menu;
    const r=anchor.getBoundingClientRect();
    menu.style.top=`${r.bottom+6}px`;
    menu.style.left=`${Math.max(8,Math.min(r.left,innerWidth-menu.offsetWidth-8))}px`;
    menu.querySelectorAll('[data-preset-key]').forEach(b=>b.onclick=()=>{
      const k=b.dataset.presetKey;closePresetMenu();switchPreset(k);
    });
    menu.querySelector('#fbPresetManage').onclick=()=>{closePresetMenu();openFilterPresetModal()};
    anchor.setAttribute('aria-expanded','true');
    requestAnimationFrame(()=>{
      document.addEventListener('click',onPresetOutside,true);
      document.addEventListener('keydown',onPresetEsc,true);
    });
  }
  /* 組み合わせの名前を聞く。**窓そのものは`promptModal`の1箇所**（§9.342）。 */
  function askGroupName(seed){
    return promptModal({title:'組み合わせに名前を付ける',confirmLabel:'決める',
      label:'プリセットの名前',placeholder:'例: 今日の担当',value:seed||'',
      hint:'同じ名前を付けた条件がひとまとまりのプリセットになり、'
        +'絞り込みバーの「プリセット」から切り替えられます。'});
  }
  /* ---- 汎用フィルタ バー本体 ---- */
  function ensureGenericFilterBar(){
    let bar=$('#genericFilterBar');if(bar)return bar;
    bar=document.createElement('section');bar.id='genericFilterBar';bar.className='generic-filter-bar';
    const grid=$('#grid');grid?.parentNode?.insertBefore(bar,grid);
    /* ---------- 1行に収める（§9.286 ①、利用者の指示） ----------
       「フィルタ機能がモリモリでゴチャついてきたので、コンパクトかつ分かり
        やすくタブ、アコーディオン、ポップオーバーメニューなど駆使して
        わかりやすく使いやすいメニューに再構成してください。最終的に
        プリセット登録したフィルタの切り替えだけで使えるようにしつつ、
        その場フィルタでスポットのフィルタを組み合わせて使う形が運用の形」

       **主動線は「群を選ぶ → 札を押す」の2手**（§CLAUDE 画面基準 1・2）。
       以前は入口が5つ横に並び、開くと4段（実測208px）になっていた。
       たまにしか使わないもの（条件を足す・作る・登録した条件とプリセット・全部外す）は
       「条件」の面へ畳む——**消さずに畳む**（§9.234 ①）。§9.286〜§9.468 の「⋯」は
       §9.505 で「条件」の面へまとめた（⋯は中身を言わない）。
       左から「文字で探す → 組み合わせ → 条件 → 1列だけ」で、
       読む順と決める順を合わせる（§CLAUDE 画面基準 14）。

       **このコメントをテンプレートリテラルの中へ入れないこと**（§9.211 ③）
       ——バッククォートでその場で文字列が閉じ、以降がJSとして解釈されて
       画面が組み上がらない。 */
    bar.innerHTML=`
      <div class="filter-search-row">
        <!-- ---------- 並びは「絞り込む（広い→狭い）」→ 右端に「見せ方」（§9.505、利用者の指示） ----------
             「一覧類の上部メニューの文字がサイズ感がバラバラ…探させない考えさせない先を読むUIUX」。
             文字で探す（行の全文）→ 組み合わせ → 条件 → 1列だけその場で、の順。
             **一覧を検索はヘッダーから移した**——絞り込みの仲間なのに帯から離れていたうえ、
             一覧の無い画面（実績など）にも出て、打っても何も起きなかった（§CLAUDE 画面基準 4）。
             帯と一緒に分割表示・ポップアップへ運ばれるので、作業スケジュールの仕掛一覧でも探せる。 -->
        <label class="lt-search" title="この一覧の行を、どの列の字でも探します（打つとすぐ絞り込みます）">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
          <input id="search" type="search" autocomplete="off" placeholder="一覧を検索" aria-label="一覧を検索">
        </label>
        <button id="filterPresetBtn" class="fb-preset-btn" type="button"
                aria-haspopup="true" aria-expanded="false">
          <span class="fb-preset-key">プリセット</span><b id="filterPresetName">なし</b><em id="filterPresetNote" hidden></em><i class="hd-caret" aria-hidden="true">▾</i>
        </button>
        <!-- **数えているのは条件の数**（§9.505）——「0件」だと2段目の「全 2,003件」（行の数）と
             同じ単位に読める。名前「条件」＋数の札にした。0でも押せる（足す・作るの入口もこの面）。 -->
        <button id="filterCondBtn" class="fb-cond-btn" type="button" aria-haspopup="true" aria-expanded="false"
                aria-controls="filterCondMenu">
          <svg class="fb-cond-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M1.6 2.6h12.8L9.4 8.2v4.3l-2.8 1.6V8.2z"/></svg>
          <span class="fb-cond-key">条件</span><b id="filterCount" class="fb-cond-n">0</b><i class="hd-caret" aria-hidden="true">▾</i>
        </button>
        <!-- 名前は**することを動詞で**言う（§9.505。旧「その場フィルタ」は中身を言わない）。 -->
        <button id="filterAdhocToggle" class="filter-adhoc-toggle" type="button" aria-expanded="false" aria-controls="filterAdhocRow">列で絞り込む</button>
        <div class="filter-token-input" id="filterTokenInput" hidden>
          <span class="filter-token-key" aria-hidden="true">＋条件</span>
          <input class="filter-token-search" id="filterTokenSearch" autocomplete="off" placeholder="列名・値を打つと候補が出ます" aria-label="条件を検索して足す">
        </div>
        <div class="filter-suggest" id="filterSuggest" hidden></div>
        <span class="filter-inline-loading" id="filterInlineLoading" hidden>${WL.loader.html(13)}<span id="filterInlineLoadingText">読込中</span></span>
        <div class="filter-search-row-actions">
          <!-- 「表示列」「表の見せ方」の席（§9.468・§9.505）。ボタンは一覧の帯（list-view.js）が作ってここへ移す。 -->
          <span class="fb-slot" id="filterBarSlot"></span>
        </div>
        <!-- ---------- 「条件」の面＝効いている条件（状態）＋足す・作る・外す（操作）（§9.505） ----------
             以前は状態をこの面、操作を「⋯」の面に分けていた。「⋯」は中身を言わず、しかも中身の4つは
             **全部が条件の操作**で、「全解除」（⋯）と「全部外す」（この面）が**同じ働きに2つの名前**
             だった。1つの面にまとめ、名前も1つにした。
             **要素はここに置いたまま**にして、開閉は hidden の入切だけ——開くたびに作り直すと、
             ここで1度だけ張った配線（足す・作る・開く・外す）が効かなくなる（§9.222 ①）。 -->
        <div class="wl-menu access-mode-menu fb-cond-menu" id="filterCondMenu" hidden role="menu" aria-label="条件">
          <div class="fb-cond-list" id="filterCondList"></div>
          <div class="fb-cond-acts" role="group" aria-label="条件の操作">
            <button id="filterAddCond" type="button" role="menuitem"
                    aria-expanded="false" aria-controls="filterTokenInput">条件を検索して足す<small>列名・値を打つと候補が出ます</small></button>
            <button id="filterToggle" type="button" role="menuitem"><span class="fb-act-name">条件を作る・登録する</span><small>列・比べ方・値を選んで、いまだけ当てるか登録します</small></button>
            <button id="openFilterPresets" type="button" role="menuitem">登録した条件とプリセット<small>条件の追加・削除と、組み合わせ（プリセット）作り</small></button>
            <button id="clearGenericFilters" class="fb-cond-clear" type="button" role="menuitem">条件を全部外す<small>「固定」の条件は外れません（「登録した条件とプリセット」で外せます）</small></button>
          </div>
        </div>
      </div>
      <!-- その場フィルタ(§9.238 ⑤、利用者の指示)。**登録しない絞り込み**。
           カラムと条件は覚え(利用者ごと×一覧ごと)、値だけがその場のもの。
           器は**1度だけ**作る——読み込みのたびに組み直すと、打っている
           最中にカーソルが飛ぶ(§9.117)。

           ---------- 1行に収める(§9.239 ①、利用者の指示) ----------
           以前は「見出しの段＋操作の段＋状態の行＋注記の行」で実測4段に
           なっており、開くだけで一覧が4行ぶん短くなっていた。畳んだものを
           開いたときに本文がそれだけ痩せるのでは、開くこと自体をためらう。
           削ったのは**同じことを2度言っている文だけ**(§CLAUDE 8):
             ・器の名前「その場フィルタ」…すぐ上の入口ボタンが名乗っている
             ・欄ごとの見出し「カラム/条件/入力」…並びが「列→条件→値」の
               1文になっているので、先頭の選択欄が「列を選ぶ」と名乗れば足りる
             ・注記の1行…**titleへ落とす**(§9.234 ①)。消さずに残す。
           状態(#filterAdhocState)だけは行の中へ移して**必ず文字で出す**
           (§3)——効いているかどうかは色ではなく言葉で分かる必要がある。 -->
      <div class="filter-adhoc-row" id="filterAdhocRow" hidden
           title="登録はしません。打っているあいだだけ効き、一覧を切り替えると入力は消えます（列と比べ方は覚えています）。">
        <select id="filterAdhocColumn" class="filter-adhoc-col"
                title="この一覧の列から選びます。選んだ列は次に開いたときも覚えています"></select>
        <select id="filterAdhocOp" class="filter-adhoc-op" title="選んだ列をどう比べるか"></select>
        <input id="filterAdhocValue" class="filter-adhoc-value" list="filterAdhocList"
               autocomplete="off" type="search"
               title="打つとその場で絞り込みます。Enterですぐ、Escで解除">
        <datalist id="filterAdhocList"></datalist>
        <button id="filterAdhocKeep" type="button">条件に残す</button>
        <button id="filterAdhocClear" type="button" title="入力を消して、この絞り込みを解除します">解除</button>
        <span class="filter-adhoc-state" id="filterAdhocState"></span>
        <!-- **閉じる道はその場に**（§9.468、利用者の指摘「一度表示したフィルタ機能も閉じ方が
             わかりにくかった」）。閉じても効いている絞り込みは残る（入口の札が名乗る）。 -->
        <button id="filterAdhocClose" class="fb-close" type="button" aria-label="その場フィルタを閉じる"
                title="閉じます（Esc）。効いている絞り込みはそのまま残ります">✕</button>
      </div>
      <div class="filter-body" id="filterBody" hidden>
        <div class="filter-body-head"><b>条件を作る</b>
          <button id="filterBodyClose" class="fb-close" type="button" aria-label="条件を作るを閉じる"
                  title="閉じます（Esc）">✕ 閉じる</button></div>
        <div class="filter-builder">
          <label>列<select id="filterColumn"></select></label>
          <label>比べ方<select id="filterOp"></select></label>
          <label>値<input id="filterValue" list="filterSuggestList" placeholder="値を入力/候補から選択"><datalist id="filterSuggestList"></datalist></label>
          <div class="filter-vars" id="filterVarChips" role="group" aria-label="変数を挿入"></div>
          <div class="filter-builder-actions">
           <button id="addGenericFilter" type="button" title="この条件を今の一覧へ追加します（保存はしません）">適用</button>
           <button id="registerGenericFilter" type="button" title="この条件を登録フィルタとして保存します（一覧へは適用しません）">登録</button>
          </div>
        </div>
        <p class="filter-builder-note" id="filterBuilderNote">「適用」は今だけ効かせる／「登録」は次回も使えるように保存する。両方押せます。</p>
      </div>`;
    // 詳細ビルダー（段階的開示）
    /* 条件を作る／その場フィルタは**同時に1つだけ**開く（§9.468）——2つ重ねて開くと、
       一覧が2つぶん痩せ、どちらを閉じればよいかも分からなくなる。閉じる道は3つ:
       見出しの ✕・Esc・入口をもう一度押す。 */
    $('#filterToggle').onclick=()=>setBodyOpen($('#filterBody').hidden);
    $('#filterBodyClose').onclick=()=>{setBodyOpen(false);$('#filterCondBtn')?.focus()};
    $('#filterAdhocClose').onclick=()=>setAdhocOpen(false);
    /* **Escはバーぜんたいで受ける**——入口のボタンに焦点が残っていても閉じられるように
       （列を選ぶ前は値の欄が押せず、焦点が窓の中へ入らない）。値の入った欄のEscは先に
       「解除」が受けて止まる。条件の検索欄と⋯のメニューは自分のEscを持つので任せる。
       **1回のEscで閉じるのは1枚だけ**（§9.471）——上に浮いた面（`WL.popMenu`）が先に
       受けて`preventDefault`した押下は、ここでもう1枚閉じない（条件のポップオーバーを
       閉じたつもりが、下の窓まで畳まれて一覧が伸びていた）。 */
    bar.addEventListener('keydown',e=>{
      if(e.key!=='Escape'||e.defaultPrevented||e.target.closest('#filterTokenInput,#filterCondMenu,#filterSuggest'))return;
      if(!$('#filterBody').hidden){e.preventDefault();setBodyOpen(false);$('#filterCondBtn')?.focus()}
      else if(adhocOpen){e.preventDefault();setAdhocOpen(false)}
    });
    // よく使う条件は既定で折りたたむ(段階的開示)。以前は該当条件があれば
    // 常時1行を占有しており、狭い分割表示では一覧の縦幅を圧迫していた。
    /* その場フィルタ(§9.238 ⑤)。**配線はここで1度だけ**——描き直しのたびに
       付け替えると、打っている最中に欄ごと作り替えることになる(§9.117)。 */
    $('#filterAdhocToggle').onclick=()=>setAdhocOpen(!adhocOpen);
    $('#filterAdhocOp').innerHTML=OPS.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
    $('#filterAdhocColumn').onchange=()=>{
      adhoc.column=$('#filterAdhocColumn').value;
      saveAdhocSetup(adhocScope,adhocUid);
      updateAdhocSuggestions();renderAdhocRow();
      /* 列を変えたら、いま入っている値でそのまま効かせ直す（打ち直させない）。 */
      applyAdhoc(true);
    };
    $('#filterAdhocOp').onchange=()=>{
      adhoc.op=$('#filterAdhocOp').value;
      saveAdhocSetup(adhocScope,adhocUid);
      renderAdhocRow();applyAdhoc(true);
    };
    {
      const box=$('#filterAdhocValue');
      box.addEventListener('input',()=>{
        adhoc.value=box.value;
        /* 状態の文字だけ書き換える。**欄そのものは触らない**。 */
        renderAdhocRow();applyAdhoc(false);
      });
      box.addEventListener('keydown',e=>{
        if(e.key==='Enter'){e.preventDefault();adhoc.value=box.value;renderAdhocRow();applyAdhoc(true)}
        else if(e.key==='Escape'&&String(box.value||'')){e.preventDefault();e.stopPropagation();clearAdhoc()}
      });
      /* 値の候補は**開いたときに作る**（列ごとに違うので、行を描くたびに
         全行を舐めると重い）。 */
      box.addEventListener('focus',updateAdhocSuggestions);
    }
    $('#filterAdhocKeep').onclick=()=>keepAdhoc();
    $('#filterAdhocClear').onclick=()=>clearAdhoc();
    $('#filterOp').innerHTML=OPS.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
    $('#filterColumn').onchange=updateFilterSuggestions;
    $('#filterOp').onchange=()=>{$('#filterValue').disabled=noValueOp($('#filterOp').value)};
    /* 変数の挿入チップ。手で「{使用設備}」と打たせない(綴りを間違えると
       ただの文字列として検索され、0件の理由が分からなくなる)。 */
    {
      const wrap=$('#filterVarChips');
      if(wrap)wrap.innerHTML=FILTER_VARS.map(v=>{
        const now=v.resolve();
        return `<button type="button" class="filter-var-chip" data-var="${esc(v.token)}" `
          +`title="${esc(v.hint)}${now?`（今: ${now}）`:'（使用設備が未登録です）'}">`
          +`${esc(v.label)}</button>`;
      }).join('');
      wrap?.querySelectorAll('[data-var]').forEach(b=>b.onclick=()=>{
        const input=$('#filterValue');if(!input||input.disabled)return;
        input.value=b.dataset.var;input.focus();
      });
    }
    /* 「適用」と「登録」で入力を消さない。片方を押したあとにもう片方も
       押せるようにするため(用途が違うだけで、対象は同じ1条件)。
       今どちらを済ませたかは下の1行で示す。 */
    const builderFilter=()=>{
      const f={column:$('#filterColumn').value,op:$('#filterOp').value,value:$('#filterValue').value.trim()};
      if(!f.column)return null;
      if(!noValueOp(f.op)&&!f.value){$('#filterValue').focus();return null}
      return f;
    };
    const note=(text)=>{const el=$('#filterBuilderNote');if(el)el.textContent=text};
    const NOTE_DEFAULT='「適用」は今だけ効かせる／「登録」は次回も使えるように保存する。両方押せます。';
    $('#addGenericFilter').onclick=()=>{
      const f=builderFilter();if(!f)return;
      addGenericFilter(f);note(`適用しました: ${condLabel(f)}　続けて「登録」も押せます`);
    };
    $('#registerGenericFilter').onclick=async()=>{
      const f=builderFilter();if(!f)return;
      const r=await saveOneToMaster(f);
      note(r==='saved'?`登録しました: ${presetName(f)}　続けて「適用」も押せます`
          :r==='dup'?`すでに登録済みです: ${presetName(f)}`
          :`この端末にだけ控えました: ${presetName(f)}`);
    };
    ['#filterColumn','#filterOp','#filterValue'].forEach(sel=>{
      const el=$(sel);if(el)el.addEventListener('input',()=>note(NOTE_DEFAULT));
    });
    /* 群を選ぶ／たまにしか使わない入口を畳む（§9.286 ①）。 */
    $('#filterPresetBtn').onclick=e=>openPresetMenu(e.currentTarget);
    $('#filterCondBtn').onclick=()=>toggleCondMenu();
    /* 面の**操作**（足す・作る・開く・外す）は押したら畳む——開いたままだと、次に何を
       するかを選ぶ前に一覧が変わって場所を見失う。**条件の行**の ×・☆ では畳まない
       （続けて外したり登録したりできるように）。 */
    $('#filterCondMenu').addEventListener('click',e=>{
      if(e.target.closest('.fb-cond-acts button'))closeCondMenu();
    });
    $('#openFilterPresets').onclick=openFilterPresetModal;
    $('#clearGenericFilters').onclick=clearAllFilters;
    bindTokenSearch();
    return bar;
  }
  /* 全解除。**入口は2つ（`⋯`の「全解除」と、条件のポップオーバーの
     「全部外す」）だが、処理は1箇所**（§9.163）——2つ持つと片方だけ
     「いつも適用」の確認を落とした状態が作れる。
     **`clearGenericFilters`という名前にしないこと**——同じ綴りのidを持つ
     ボタンがあり、ブラウザは`window.<id>`でその要素を公開するので、
     関数のつもりで呼ぶと**要素を呼び出してTypeError**になる（実際に踏んだ）。 */
  /* 外すだけ（読み直さない）。0件の案内（§9.453）は検索欄と一緒に外してから
     1回だけ読み直すので、外す処理と読み直しを分けて持つ。**いつも適用の確認は
     ここで必ず通る**——入口がいくつ増えても確認を落とした道は作れない。 */
  async function dropAllFilters({adhoc:withAdhoc=false}={}){
    const lockedList=S.genericFilters.filter(isLockedFilter);
    if(lockedList.length){
      if(await confirmRemoveAllLocked(lockedList))S.genericFilters=[];
      else S.genericFilters=S.genericFilters.filter(isLockedFilter);
    }else{
      S.genericFilters=[];
    }
    if(withAdhoc)resetAdhoc();
    S.page=1;renderGenericFilterBar();
  }
  async function clearAllFilters(){await dropAllFilters();WL.list.load()}
  function updateFilterColumns(){
    ensureGenericFilterBar();const select=$('#filterColumn');if(!select)return;const current=select.value;
    /* **表示名を付けた列は両方の名前で出す**（§9.464）。値は元の列名のまま（絞り込みは
       サーバーが生の列名で行う）——元の名前しか出さないと、見出しで見ている名前で探せない。 */
    const t=typeof WL.list.listLayoutTarget==='function'?WL.list.listLayoutTarget():'';
    const nm=c=>{const n=t?WL.columnLayout.label(t,c):c;return n&&n!==c?`${n}（${c}）`:c};
    select.innerHTML=(S.columns||[]).map(c=>`<option value="${esc(c)}">${esc(nm(c))}</option>`).join('');
    if((S.columns||[]).includes(current))select.value=current;
    updateFilterSuggestions();
  }
  function updateFilterSuggestions(){
    const col=$('#filterColumn')?.value,list=$('#filterSuggestList');if(!col||!list)return;
    const vals=[...new Set((S.rows||[]).map(r=>String(r[col]??'').trim()).filter(Boolean))].slice(0,80);
    list.innerHTML=vals.map(v=>`<option value="${esc(v)}"></option>`).join('');
  }
  /* その場フィルタの値候補。既存の`updateFilterSuggestions`と同じ作り方だが、
     見る列が違うので別に持つ（1つにまとめると、どちらの列を見るかを引数で
     分けることになり呼び出し側が増える）。 */
  function updateAdhocSuggestions(){
    const list=$('#filterAdhocList');if(!list)return;
    if(!adhoc.column||noValueOp(adhoc.op)){list.innerHTML='';return}
    const vals=[...new Set((S.rows||[]).map(r=>String(r[adhoc.column]??'').trim()).filter(Boolean))].slice(0,80);
    list.innerHTML=vals.map(v=>`<option value="${esc(v)}"></option>`).join('');
  }
  function addGenericFilter(f){
    const key=filterKey(f);if(!S.genericFilters.some(x=>filterKey(x)===key))S.genericFilters.push(f);
    bumpCondUsage(f);S.page=1;renderGenericFilterBar();WL.list.load();
  }

  /* ================= 効いている条件（§9.287、利用者の指示） =================
     「バッジとして追加されるボタンに表示されているフィルタの条件式は、
      ボタンの部分には基本的に長すぎて記述しきれないので最初から記載せず
      シンプルにアイコンだけにしてください。その代わり、ポップオーバーで
      しっかり条件式の中身を確認できるようにしてください」

     以前は条件1件につき1つの札（`.filter-tag`）を横に並べ、その中へ
     「列名・演算子・値・展開値・★・×」を全部詰めていた。実データの列名は
     `残仕掛設備ｺｰｽ`のように長く、値も`{使用設備}（=LS4）`と2段になるため、
     **札は必ず器からあふれるか切り詰められる**——読めない字を並べるくらい
     なら最初から並べない。

     いまは**件数の1バッジ**だけを出し、中身はポップオーバーが持つ。
     §CLAUDE 8 の「同じ情報を2箇所に出さない」もこれで片付く——以前は
     件数（`1件`）と札が並んで**同じことを2通りで**言っていた。

     **0件でもバッジは消さない**（§9.227 ②）——出入りするとバーの幅が動き、
     隣のボタンが逃げる。押せないことと理由は`title`が言う（§4）。 */
  function condRows(){
    /* **その場フィルタも1件として数える**（§9.238 ⑤）。効いているのに
       数えないと「絞り込んでいないのに件数が合わない」としか見えない。 */
    const rows=S.genericFilters.map((f,i)=>({kind:'cond',f,i,locked:isLockedFilter(f)}));
    if(adhocActive())rows.push({kind:'adhoc',label:adhocLabel()});
    return rows;
  }
  /* 変数はいまの値も併記する（§9.285 ①／§CLAUDE 3）——`{使用設備}`とだけ
     出ていると、設備を切り替えたときに**画面のどこを見ても効いている値が
     読めない**。**未設定は「未設定」と書く**（空にすると0件の理由が読めない）。 */
  function condVarNote(f){
    if(!filterVarFor(f.value))return '';
    const va=expandFilterVars(f.value);
    return `（=${va||'未設定'}）`;
  }
  function condFullText(f){
    return `${f.column} ${opLabel(f.op)}${noValueOp(f.op)?'':' '+f.value+condVarNote(f)}`;
  }
  function renderActiveTokens(){
    const btn=$('#filterCondBtn'),count=$('#filterCount');if(!btn)return;
    const rows=condRows();
    const n=rows.length;
    if(count)count.textContent=String(n);
    btn.classList.toggle('is-on',n>0);
    /* 狭い器では「条件」の字を畳む（§9.505）ので、読み上げの名前はここで持つ。 */
    btn.setAttribute('aria-label',`条件 ${n}つ`);
    /* **0でも押せる**（§9.505）——条件を足す・作る入口もこの面にある。 */
    btn.title=n
      ? '効いている条件 '+n+'つ\n'
        +rows.map(r=>r.kind==='adhoc'?`列で絞り込み: ${r.label}`:condFullText(r.f)).join('\n')
        +'\n押すと中身を確かめたり、外したり、条件を足したりできます。'
      : '効いている条件はありません。押すと、条件を足す・作る入口が開きます。';
    renderCondMenu();
  }
  /* 条件の面の中身（効いている条件の行と、全部外すの可否）。**開いているときだけ描く**——
     閉じているあいだの変化は、開くときにもう一度描けば足りる。 */
  function renderCondMenu(){
    const menu=$('#filterCondMenu'),list=$('#filterCondList');if(!menu||!list||menu.hidden)return;
    const rows=condRows();
    const line=r=>{
      if(r.kind==='adhoc')
        return '<div class="fb-cond-row is-adhoc">'
          +'<span class="fb-cond-badge" title="登録していない、いまだけの絞り込み（「列で絞り込む」）">一時</span>'
          +`<span class="fb-cond-text">${esc(r.label)}</span>`
          +'<button type="button" class="fb-cond-x" data-adhoc-clear title="列で絞り込みの入力を消して外します">×</button></div>';
      const known=!!registeredPreset(r.f);
      return `<div class="fb-cond-row${r.locked?' is-locked':''}">`
        +(r.locked?'<span class="fb-cond-badge is-lock" title="いつも適用（固定）。一覧を開くたびに入ります">\u{1F512} 固定</span>':'')
        +`<span class="fb-cond-text">${esc(r.f.column)} <b>${esc(opLabel(r.f.op))}</b>`
        +(noValueOp(r.f.op)?'':` <em>${esc(r.f.value)}</em>`)
        +(condVarNote(r.f)?`<u class="fb-cond-var">${esc(condVarNote(r.f))}</u>`:'')
        +'</span>'
        +(r.locked?'':`<button type="button" class="fb-cond-save${known?' is-saved':''}" data-cond-save="${r.i}" `
          +`title="${known?'登録済み（「登録した条件とプリセット」にあります）':'この条件を登録します。登録すると組み合わせ（プリセット）に入れられます'}">${known?'★':'☆'}</button>`)
        +`<button type="button" class="fb-cond-x" data-cond-x="${r.i}" title="この条件を外します">×</button></div>`;
    };
    list.innerHTML='<p class="fb-cond-head">効いている条件'
      +(rows.length?`<small>${rows.length}つ。この一覧に当てている絞り込みです</small>`
        :'<small>まだありません。下のどれかで足せます</small>')+'</p>'
      +rows.map(line).join('');
    list.querySelectorAll('[data-cond-x]').forEach(b=>b.onclick=async()=>{
      const i=+b.dataset.condX,f=S.genericFilters[i];
      if(!f)return;
      if(isLockedFilter(f)&&!(await confirmRemoveLockedFilter(f)))return;
      S.genericFilters.splice(i,1);S.page=1;renderGenericFilterBar();WL.list.load();
    });
    list.querySelectorAll('[data-cond-save]').forEach(b=>b.onclick=async()=>{
      const f=S.genericFilters[+b.dataset.condSave];
      if(!f||registeredPreset(f))return;
      await saveOneToMaster(f);renderGenericFilterBar();
    });
    list.querySelector('[data-adhoc-clear]')?.addEventListener('click',()=>clearAdhoc());
    /* **押しても何も起きない物を残さない**（§CLAUDE 画面基準 4）。外すのは登録・適用した条件
       （列で絞り込みは自分の × で外す）。 */
    const clear=$('#clearGenericFilters');if(clear)clear.disabled=!S.genericFilters.length;
  }
  /* 面は**バーの中に常設**（`position:fixed`・§9.201）。開閉は hidden の入切だけ。 */
  function closeCondMenu(){
    const m=$('#filterCondMenu');if(!m||m.hidden)return;
    m.hidden=true;
    $('#filterCondBtn')?.setAttribute('aria-expanded','false');
    document.removeEventListener('click',onCondOutside,true);
    document.removeEventListener('keydown',onCondEsc,true);
  }
  function onCondOutside(e){
    const m=$('#filterCondMenu');
    if(m&&!m.hidden&&!m.contains(e.target)&&!e.target.closest('#filterCondBtn'))closeCondMenu();
  }
  /* 閉じたEscは**受けたと名乗る**（`preventDefault`・§9.471）——バーのEscが同じ押下で
     下の窓までもう1枚閉じないように（1回のEscで閉じるのは1枚）。 */
  function onCondEsc(e){if(WL.modal.escCloses(e)){e.preventDefault();closeCondMenu()}}
  function toggleCondMenu(){
    const m=$('#filterCondMenu'),btn=$('#filterCondBtn');if(!m||!btn)return;
    if(!m.hidden){closeCondMenu();return}
    m.hidden=false;renderCondMenu();
    /* **開いてから測る**——`hidden`のあいだは幅が0で、画面の端に寄せられない。 */
    const r=btn.getBoundingClientRect();
    m.style.top=`${Math.round(r.bottom+6)}px`;
    m.style.left=`${Math.round(Math.max(8,Math.min(r.left,innerWidth-m.offsetWidth-8)))}px`;
    btn.setAttribute('aria-expanded','true');
    requestAnimationFrame(()=>{
      document.addEventListener('click',onCondOutside,true);
      document.addEventListener('keydown',onCondEsc,true);
    });
  }
  /* ================= その場フィルタ(§9.238 ⑤) =================
     支度(カラム・条件)＋その場の値。**登録しない・覚えない**——効くのは
     いま開いている一覧の、いまの入力だけ。 */
  let adhocAll=(()=>{try{const m=JSON.parse(localStorage.getItem(ADHOC_STORE)||'{}');
                          return (m&&typeof m==='object')?m:{}}catch(_){return {}}})();
  let adhocOpen=(()=>{try{return localStorage.getItem(ADHOC_OPEN_STORE)==='1'}catch(_){return false}})();
  function writeAdhocOpen(){try{localStorage.setItem(ADHOC_OPEN_STORE,adhocOpen?'1':'0')}catch(_){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',_)}}
  function adhocBucket(who){
    const uid=who==null?filterUserId():who;
    if(!adhocAll[uid]||typeof adhocAll[uid]!=='object')adhocAll[uid]={};
    return adhocAll[uid];
  }
  function writeAdhocAll(){try{localStorage.setItem(ADHOC_STORE,JSON.stringify(adhocAll))}catch(_){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',_)}}
  /* いまの支度と値。**値はここにしか無い**（保存へ回らない）。 */
  let adhoc={column:'',op:'contains',value:''};
  let adhocScope=null,adhocUid=null,adhocTimer=null,adhocColsSig='';
  /* 支度の保存。**空の支度は行ごと消す**（覚えている一覧の数だけが増えない
     ようにする。§9.175の空配列と同じ理由）。 */
  function saveAdhocSetup(scope,who){
    if(scope==null)return;
    const bucket=adhocBucket(who);
    if(adhoc.column)bucket[scope]={column:adhoc.column,op:adhoc.op};
    else delete bucket[scope];
    const keys=Object.keys(bucket);
    if(keys.length>ADHOC_MAX_CONTEXTS)keys.slice(0,keys.length-ADHOC_MAX_CONTEXTS).forEach(k=>{
      if(k!==scope)delete bucket[k];
    });
    writeAdhocAll();
  }
  /* 一覧（と利用者）が変わったら支度を入れ替え、**値は捨てる**。
     残すと、別の一覧を開いた瞬間に身に覚えのない絞り込みが効く。 */
  function syncAdhocContext(){
    const scope=usageScopeKey(),uid=filterUserId();
    if(scope===adhocScope&&uid===adhocUid)return false;
    if(adhocScope!=null)saveAdhocSetup(adhocScope,adhocUid);
    const saved=adhocBucket(uid)[scope];
    adhoc={column:String(saved&&saved.column||''),
           op:OPS.some(o=>o[0]===(saved&&saved.op))?saved.op:'contains',
           value:''};
    adhocScope=scope;adhocUid=uid;adhocColsSig='';
    const box=$('#filterAdhocValue');if(box)box.value='';
    return true;
  }
  /* いまの一覧にその列があるか。**無ければ効かせない**——サーバーは知らない
     列の条件を落とすので、当たらない理由が画面から読めなくなる。 */
  function adhocColumnOk(){
    const cols=S.columns||[];
    return !!adhoc.column&&(!cols.length||cols.includes(adhoc.column));
  }
  function adhocActive(){
    if(!adhocColumnOk())return false;
    return noValueOp(adhoc.op)?true:!!String(adhoc.value||'').trim();
  }
  /* 問い合わせへ足す条件（0件か1件）。**`S.genericFilters`とは別に持つ**。 */
  function adhocFilters(){
    if(!adhocActive())return [];
    return [{column:adhoc.column,op:adhoc.op,value:noValueOp(adhoc.op)?'':String(adhoc.value||'').trim()}];
  }
  function adhocLabel(){
    if(!adhoc.column)return '';
    return condLabel({column:adhoc.column,op:adhoc.op,value:String(adhoc.value||'').trim()});
  }
  /* 打った内容を効かせる。**待ってからまとめて1回**——1文字ごとに問い合わせ
     ると、打っている最中ずっと一覧が組み直される。Enterはすぐ効かせる。 */
  function applyAdhoc(now){
    if(adhocTimer){clearTimeout(adhocTimer);adhocTimer=null}
    const run=()=>{adhocTimer=null;S.page=1;WL.list.load();};
    if(now)run();else adhocTimer=setTimeout(run,ADHOC_DEBOUNCE_MS);
  }
  function resetAdhoc(){
    adhoc.value='';
    const box=$('#filterAdhocValue');if(box)box.value='';
    renderAdhocRow();
  }
  function clearAdhoc(){resetAdhoc();applyAdhoc(true)}
  /* いまの条件を**登録側のトークンへ移す**。「その場」で当たりを付けてから
     残したくなることがあるので、作り直させない（同じ条件を2回打たせない）。 */
  function keepAdhoc(){
    const list=adhocFilters();if(!list.length)return;
    adhoc.value='';
    const box=$('#filterAdhocValue');if(box)box.value='';
    /* addGenericFilter が load() まで呼ぶので、ここでは applyAdhoc しない
       （同じ問い合わせを2回投げることになる）。 */
    addGenericFilter(list[0]);
  }
  /* 開く・閉じるの答えは2つの関数だけ（§9.468）。片方を開くともう片方を閉じる。 */
  function setAdhocOpen(v){
    adhocOpen=!!v;writeAdhocOpen();
    if(adhocOpen)setBodyOpen(false);
    renderAdhocRow();
    /* 開いたら**押せる最初の欄**へ焦点を置く（列を選ぶ前は値の欄が押せない）。 */
    if(adhocOpen)requestAnimationFrame(()=>{
      const first=[...document.querySelectorAll('#filterAdhocRow select,#filterAdhocRow input')]
        .find(el=>!el.disabled);
      (($('#filterAdhocValue')&&!$('#filterAdhocValue').disabled)?$('#filterAdhocValue'):first)?.focus();
    });
    else $('#filterAdhocToggle')?.focus();
  }
  function setBodyOpen(v){
    const body=$('#filterBody');if(!body)return;
    body.hidden=!v;
    const t=$('#filterToggle .fb-act-name');if(t)t.textContent=v?'「条件を作る」の欄を閉じる':'条件を作る・登録する';
    if(v&&adhocOpen){adhocOpen=false;writeAdhocOpen();renderAdhocRow()}
    if(v)requestAnimationFrame(()=>$('#filterColumn')?.focus());
  }
  function renderAdhocRow(){
    const row=$('#filterAdhocRow'),toggle=$('#filterAdhocToggle');
    if(!row)return;
    syncAdhocContext();
    const colSel=$('#filterAdhocColumn');
    if(colSel){
      /* **同じ顔ぶれなら触らない**——選択欄を組み直すと、開いている候補も
         フォーカスも落ちる（§9.117と同じ理由）。 */
      const cols=S.columns||[];
      const sig=cols.join('');
      if(sig!==adhocColsSig){
        adhocColsSig=sig;
        const missing=adhoc.column&&cols.length&&!cols.includes(adhoc.column);
        /* **先頭の選択肢が欄の名前を兼ねる**（§9.239 ①）。見出しの段を
           畳んだので、何を選ぶ欄なのかはここが言う。 */
        colSel.innerHTML='<option value="">列を選ぶ…</option>'
          +(missing?`<option value="${esc(adhoc.column)}">${esc(adhoc.column)}（この一覧にありません）</option>`:'')
          +cols.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
      }
      if(colSel.value!==adhoc.column)colSel.value=adhoc.column;
    }
    const opSel=$('#filterAdhocOp');
    if(opSel&&opSel.value!==adhoc.op)opSel.value=adhoc.op;
    const box=$('#filterAdhocValue');
    if(box){
      const noVal=noValueOp(adhoc.op);
      box.disabled=noVal||!adhoc.column;
      box.placeholder=!adhoc.column?'先に列を選んでください'
        :noVal?'この条件では値は要りません'
        :'打つとその場で絞り込みます（Enterですぐ）';
      /* 打っている最中は値へ触らない（カーソルが飛ぶ）。 */
      if(document.activeElement!==box&&box.value!==adhoc.value)box.value=adhoc.value;
    }
    const keep=$('#filterAdhocKeep'),clear=$('#filterAdhocClear');
    const on=adhocActive();
    if(keep){
      keep.disabled=!on;
      keep.title=on?`「${adhocLabel()}」を上の条件へ移します（そのあと登録もできます）`
                   :'効いている条件があるときだけ移せます';
    }
    if(clear)clear.disabled=!on&&!String(adhoc.value||'').trim();
    const state=$('#filterAdhocState');
    if(state){
      if(!adhoc.column){state.className='filter-adhoc-state';state.textContent='列と比べ方を選ぶと使えます';}
      else if(!adhocColumnOk()){
        state.className='filter-adhoc-state is-warn';
        state.textContent=`この一覧に「${adhoc.column}」の列がありません`;
      }else if(on){
        state.className='filter-adhoc-state is-on';
        state.textContent=`効いています: ${adhocLabel()}`;
      }else{
        state.className='filter-adhoc-state';
        state.textContent='まだ効いていません（入力欄に打つと効きます）';
      }
      state.title=state.textContent;
    }
    row.hidden=!adhocOpen;
    if(toggle){
      /* **畳んでいても効いていることを名乗る**(§9.175)。見えない場所で
         絞り込みが効いているのは「勝手に絞られている」としか読めない。 */
      toggle.textContent=on?`列で絞り込み中: ${adhocLabel()}`:'列で絞り込む';
      toggle.classList.toggle('active',adhocOpen||on);
      toggle.classList.toggle('is-on',on);
      toggle.setAttribute('aria-expanded',adhocOpen?'true':'false');
      toggle.title=on?`いま「${adhocLabel()}」で絞り込んでいます。押すと開いて直せます`
        :'列と比べ方を決めておき、値を打つとその場で絞り込みます（登録はしません）';
    }
  }

  function renderGenericFilterBar(){
    ensureGenericFilterBar();updateFilterColumns();renderPresetButton();
    renderActiveTokens();renderAdhocRow();
    /* 条件が変わる経路は多い(追加・削除・全解除・登録フィルタの適用・
       設定画面からのやり直し)。**全部がここを通る**ので、覚えるのも1箇所で
       済ませる——経路ごとに書くと必ずどれかを書き忘れる。 */
    saveActiveFilterState();
  }

  /* ---- サジェスト（再認・チャンク化・頻度順） ---- */
  function frequentConditions(){
    // 保存フィルタの条件＋利用履歴を統合し、頻度×新しさで並べる。
    // どちらも「今見ているDB+テーブル」のものだけを対象にする
    // (プリセットはcurrentTablePresets、利用履歴はscopedUsage)。
    const map=new Map();
    /* **登録済みの条件は「よく使う条件」に出さない**（§9.287、§CLAUDE 8）。
       候補の窓は上段が「よく使うフィルタ（マスタ）＝登録した条件」なので、
       登録の中身をここでも1件ずつ並べると**同じものが上下に二重に出る**。
       利用者の報告「昔のデザインと新しいデザインが混在して重複状態」の
       もう半分がこれだった（バーの2行目に出ていた旧「よく使う条件」は、
       登録した条件を分解して並べ直しただけのものだった）。
       ここに残すのは**登録していない、履歴だけの条件**——上段には出ないので
       ここでしか拾えない。 */
    const registered=new Set();
    currentTablePresets().forEach(p=>(p.filters||[]).forEach(f=>registered.add(filterKey(f))));
    Object.values(scopedUsage()).forEach(u=>{if(!u.f)return;const k=filterKey(u.f);if(registered.has(k))return;const e=map.get(k)||{f:u.f,count:0,at:0};e.count+=(u.count||0)*2;e.at=Math.max(e.at,u.at||0);map.set(k,e)});
    const active=new Set(S.genericFilters.map(filterKey));
    // 同じテーブルでも列構成は変わり得る(表示マスタでの非表示指定、
    // スケジュールモードの品質データ結合で増える列など)。今の一覧に無い列の
    // 条件は選んでも意味が無いため提案から外す。S.columnsがまだ空(初回描画前)
    // の場合だけは絞り込まない(何も出せなくなるのを避ける)。
    const cols=S.columns&&S.columns.length?new Set(S.columns):null;
    return [...map.values()]
      .filter(e=>!active.has(filterKey(e.f)))
      .filter(e=>!cols||cols.has(e.f.column))
      .sort((a,b)=>b.count-a.count||b.at-a.at).map(e=>e.f);
  }
  function valueSuggestions(q){
    // 入力語に一致するカラム/値を、現在の一覧データから提案（列 含む 語 / 列 = 値）。
    if(!q)return [];const nq=q.normalize('NFKC').toLowerCase();const out=[];const seen=new Set();
    (S.columns||[]).forEach(col=>{
      // 列名が一致 → 「列 含む 語」を提案（値は空でも空欄以外の意図に近い）
      if(String(col).normalize('NFKC').toLowerCase().includes(nq)){const f={column:col,op:'contains',value:q};const k=filterKey(f);if(!seen.has(k)){seen.add(k);out.push({f,tag:'列名一致'})}}
    });
    (S.columns||[]).forEach(col=>{
      const vals=[...new Set((S.rows||[]).map(r=>String(r[col]??'').trim()).filter(Boolean))];
      const hit=vals.find(v=>v.normalize('NFKC').toLowerCase().includes(nq));
      if(hit){const f={column:col,op:'eq',value:hit};const k=filterKey(f);if(!seen.has(k)){seen.add(k);out.push({f,tag:'値一致'})}}
    });
    return out.slice(0,8);
  }
  let suggestFlat=[],suggestIndex=-1;
  /* ---------- サジェストの位置合わせ(§9.81) ----------
     以前は器(.generic-filter-bar)の中に position:absolute で置いていたが、
     器は角丸のために overflow:hidden を持つため、**開いても丸ごと切られて
     いた**(実測で51pxのうち見えているのは0px)。利用者からは「開いたのに
     文字の頭だけ見えて下が切れている」状態に見える。
     モードバッジ・表示サイズ・再読込と同じく position:fixed の
     ポップオーバーにして、どの器の中にあっても切られないようにする
     (分割表示やフローティングウィンドウの中でも同じ問題が起きる)。 */
  function placeSuggest(){
    const box=$('#filterSuggest'),anchor=$('#filterTokenInput');
    if(!box||!anchor||box.hidden)return;
    const r=anchor.getBoundingClientRect();
    box.style.left=`${Math.round(r.left)}px`;
    box.style.top=`${Math.round(r.bottom+4)}px`;
    box.style.width=`${Math.round(r.width)}px`;
    /* 下に入り切らないときは、入る高さまで縮める(画面外へ伸ばさない)。 */
    box.style.maxHeight=`${Math.max(120,Math.round(window.innerHeight-r.bottom-16))}px`;
  }
  function showSuggest(){const box=$('#filterSuggest');if(!box)return;box.hidden=false;placeSuggest()}
  window.addEventListener('resize',placeSuggest);
  window.addEventListener('scroll',placeSuggest,true);

  function renderSuggest(){
    const box=$('#filterSuggest'),input=$('#filterTokenSearch');if(!box||!input)return;
    const q=input.value.trim(),nq=q.normalize('NFKC').toLowerCase();suggestFlat=[];suggestIndex=-1;
    const groups=[];
    // 1) 保存フィルタ（マスタ）— 再認しやすい単位。適用でまとめて追加。
    let presets=currentTablePresets();
    if(nq)presets=presets.filter(p=>p.name.normalize('NFKC').toLowerCase().includes(nq)||(p.filters||[]).some(f=>condLabel(f).normalize('NFKC').toLowerCase().includes(nq)));
    presets=[...presets].sort((a,b)=>(b.uses||0)-(a.uses||0)||String(b.lastUsed||b.updatedAt||'').localeCompare(String(a.lastUsed||a.updatedAt||''))).slice(0,8);
    if(presets.length){
      groups.push({icon:'★',title:`よく使うフィルタ（マスタ）${S.filterPresetSource==='master'?'':'※端末保存'}`,chips:presets.map(p=>({cls:'preset',main:p.name,sub:`${(p.filters||[]).length}条件${p.uses?' · '+p.uses+'回':''}`,onpick:()=>{applyPreset(p,{merge:true});afterPick()}}))});
    }
    // 2) よく使う条件 — 単一条件を追加。
    let conds=frequentConditions();
    if(nq)conds=conds.filter(f=>condLabel(f).normalize('NFKC').toLowerCase().includes(nq));
    conds=conds.slice(0,8);
    if(conds.length){
      groups.push({icon:'⟳',title:'よく使う条件',chips:conds.map(f=>({cls:'',col:f.column,op:opShort(f.op),val:noValueOp(f.op)?'':f.value,onpick:()=>{addGenericFilter(f);afterPick()}}))});
    }
    // 3) 候補の値 — 入力語からデータに基づく候補を生成。
    const vsug=valueSuggestions(q);
    if(vsug.length){
      groups.push({icon:'🔎',title:'候補の値（この一覧のデータから）',chips:vsug.map(v=>({cls:'op-select',col:v.f.column,op:opShort(v.f.op),val:noValueOp(v.f.op)?'':v.f.value,sub:v.tag,onpick:()=>{addGenericFilter(v.f);afterPick()}}))});
    }
    if(!groups.length){box.innerHTML=`<div class="filter-suggest-empty">${q?`「${esc(q)}」に一致する候補はありません。詳細から条件を作成できます。`:'保存フィルタや利用履歴がここに提案されます。'}</div>`;showSuggest();return}
    box.innerHTML=groups.map(g=>`
      <div class="filter-suggest-group">
        <div class="filter-suggest-head"><span class="fs-icon">${g.icon}</span>${esc(g.title)}</div>
        <div class="filter-suggest-items"></div>
      </div>`).join('');
    const groupEls=box.querySelectorAll('.filter-suggest-group');
    groups.forEach((g,gi)=>{
      const wrap=groupEls[gi].querySelector('.filter-suggest-items');
      g.chips.forEach(c=>{
        const chip=document.createElement('button');chip.type='button';chip.className='suggest-chip '+(c.cls||'');
        chip.innerHTML=c.main?`<span>${esc(c.main)}</span>${c.sub?`<small>${esc(c.sub)}</small>`:''}`:`<span>${esc(c.col)}</span><b>${esc(c.op)}</b>${c.val?`<em>${esc(c.val)}</em>`:''}${c.sub?`<small>${esc(c.sub)}</small>`:''}`;
        chip.onclick=c.onpick;wrap.appendChild(chip);suggestFlat.push(chip);
      });
    });
    showSuggest();
  }
  function afterPick(){const input=$('#filterTokenSearch');if(input){input.value='';input.focus()}renderSuggest()}
  function moveSuggest(dir){
    if(!suggestFlat.length)return;suggestIndex=(suggestIndex+dir+suggestFlat.length)%suggestFlat.length;
    suggestFlat.forEach((c,i)=>c.classList.toggle('active',i===suggestIndex));
    suggestFlat[suggestIndex]?.scrollIntoView({block:'nearest'});
  }
  /* 条件を足す入口は**ボタン**（§9.345）。以前は常時開いた1071pxの入力欄で、
     ヘッダーの「一覧を検索」（行の全文検索）と**同じ顔なのに意味が違う**
     ものが同じ画面に2つ並んでいた。押したときだけ欄を出す。 */
  function openCondSearch(){
    const btn=$('#filterAddCond'),box=$('#filterTokenInput'),input=$('#filterTokenSearch');
    if(!btn||!box||!input)return;
    btn.setAttribute('aria-expanded','true');
    box.hidden=false;input.focus();
  }
  function closeCondSearch(){
    const btn=$('#filterAddCond'),box=$('#filterTokenInput'),input=$('#filterTokenSearch');
    if(!btn||!box||!input)return;
    input.value='';box.hidden=true;box.classList.remove('focus-within');
    btn.setAttribute('aria-expanded','false');
    const suggest=$('#filterSuggest');if(suggest)suggest.hidden=true;
  }
  function bindTokenSearch(){
    const input=$('#filterTokenSearch'),box=$('#filterTokenInput');if(!input)return;
    $('#filterAddCond')?.addEventListener('click',openCondSearch);
    input.addEventListener('focus',()=>{box.classList.add('focus-within');renderSuggest()});
    input.addEventListener('input',()=>renderSuggest());
    input.addEventListener('keydown',async e=>{
      if(e.key==='ArrowDown'){e.preventDefault();moveSuggest(1)}
      else if(e.key==='ArrowUp'){e.preventDefault();moveSuggest(-1)}
      else if(e.key==='Enter'){e.preventDefault();(suggestFlat[suggestIndex]||suggestFlat[0])?.click()}
      else if(e.key==='Escape'){closeCondSearch()}
      else if(e.key==='Backspace'&&!input.value&&S.genericFilters.length){
        const last=S.genericFilters[S.genericFilters.length-1];
        if(isLockedFilter(last)&&!(await confirmRemoveLockedFilter(last)))return;
        S.genericFilters.pop();S.page=1;renderGenericFilterBar();WL.list.load();
      }
    });
    /* 外を押したら畳む。**打ちかけの字も捨てる**——条件はまだ1つも足って
       いないので、残しておく値打ちが無い（残すと、次に開いたとき前の字が
       出ていて「何か効いている」と読める）。 */
    const row=input.closest('.filter-search-row')||box;
    document.addEventListener('click',e=>{if(!row.contains(e.target))closeCondSearch()});
  }

  /* ==========================================================
     登録フィルタの持ち出し・取り込み(§9.171)
     ----------------------------------------------------------
     利用者の指示は「全てまたは各一覧単位でフィルタ機能の部分だけ、
     エクスポートインポートできる機能」。**持ち出すのはフィルタだけ**で、
     一覧の列・書式などは持ち出さない(列レイアウトマスタの領分)。

     持ち出すもの / 持ち出さないものは**画面に書く**——同じ「フィルタ」でも、
     条件そのもの(誰が見ても同じ)と、この端末で付けた「デフォルト」「鍵」の印
     (端末ごとの設定)と、使用回数(統計)は性質が違う。前二つは運べば役に立ち、
     統計は運んでも意味が無い。

     印は**名前で運ぶ**。プリセットIDはマスタの連番なので、別のPCへ持って
     行くと必ず食い違う(IDで運ぶと、まったく別の条件に鍵が付く)。
     ========================================================== */
  const IO_FORMAT='wavelog-filter-presets';
  const IO_VERSION=1;
  function ioGroupKey(g){return `${g.db||''}\u001f${g.table||''}\u001f${g.mode||''}`}
  function ioGroupLabel(g){
    return `${g.db||'(DB未指定)'} / ${g.table||'(テーブル未指定)'}`;
  }
  function ioModeLabel(mode){return mode==='schedule'?'スケジュールモード':'編集・閲覧モード'}
  /* この端末にある登録フィルタを**全モードぶん**集める。一覧のモーダルが
     読むのは今の一覧ぶんだけ(S.filterPresets)なので、そのまま使うと
     「すべて」が今の一覧だけになる。 */
  async function ioFetchAll(){
    const out=[];
    for(const mode of ['','schedule']){
      const q=new URLSearchParams();q.set('mode',mode);q.set('user',filterUserId());
      const r=await api('/api/filter-presets?'+q);
      (r.items||[]).forEach(x=>out.push({id:x.id,name:x.name,db:x.db||'',table:x.table||'',
        mode:x.mode||'',filters:Array.isArray(x.filters)?x.filters:[],uses:x.uses||0,master:true,
        owner:x.owner||'',isDefault:!!x.isDefault,isLocked:!!x.isLocked}));
    }
    /* マスタへ書けずこの端末だけに控えたぶんも持ち出せるようにする——
       書けなかったからこそ、他のPCへ運ぶ手立てが要る。 */
    (S.filterPresets||[]).filter(x=>!x.master).forEach(x=>out.push({...x,master:false}));
    return out;
  }
  function ioGroupsOf(list){
    const m=new Map();
    (list||[]).forEach(p=>{
      const g0={db:p.db||'',table:p.table||'',mode:p.mode||''};
      const k=ioGroupKey(g0);
      let g=m.get(k);
      if(!g){g={...g0,key:k,presets:[]};m.set(k,g)}
      g.presets.push(p);
    });
    return [...m.values()].sort((a,b)=>(a.db+a.table+a.mode).localeCompare(b.db+b.table+b.mode,'ja'));
  }
  /* この端末で付いている印(デフォルト・鍵)を、そのグループの中で名前へ直す。 */
  function ioMarksOf(g){
    /* 印は**サーバーが返したその人のぶん**を先に見る(§9.172)。画面の中の
       マップは今開いている一覧ぶんしか埋まっていないので、それだけを見ると
       他の一覧の印が落ちる。 */
    const key=mapKeyOf(g.db,g.table,g.mode);
    const ds=new Set((readDefaultPresetMap()[key]||[]).map(String));
    const ls=new Set((readLockedPresetMap()[key]||[]).map(String));
    const def=new Set(),lock=new Set();
    g.presets.forEach(p=>{
      if(p.isDefault||ds.has(String(p.id)))def.add(p.name);
      if(p.isLocked||ls.has(String(p.id)))lock.add(p.name);
    });
    return {def,lock};
  }
  function ioFileName(){
    const d=new Date(),pad=n=>String(n).padStart(2,'0');
    return `wavelog-filters-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}.json`;
  }
  function ioDownload(name,text){
    const blob=new Blob([text],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=name;
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
  }
  function ioParse(text){
    let data;
    try{data=JSON.parse(text)}
    catch(e){throw new Error('JSONとして読めませんでした。書き出したファイルをそのまま選んでください。')}
    if(!data||data.format!==IO_FORMAT)
      throw new Error('WaveLogのフィルタ書き出しファイルではありません（別のファイルを選んでいませんか）。');
    const groups=(data.groups||[]).map(g=>({
      db:String(g&&g.db||''),table:String(g&&g.table||''),
      mode:(g&&g.mode)==='schedule'?'schedule':'',
      presets:((g&&g.presets)||[])
        .filter(x=>x&&String(x.name||'').trim()&&Array.isArray(x.filters)&&x.filters.length)
        .map(x=>({name:String(x.name).trim(),filters:x.filters,
                  shared:!!x.shared,
                  isDefault:!!x.isDefault,isLocked:!!x.isLocked}))
    })).filter(g=>g.presets.length);
    groups.forEach(g=>{g.key=ioGroupKey(g)});
    if(!groups.length)throw new Error('取り込める条件が1件もありませんでした。');
    return {exportedAt:String(data.exportedAt||''),groups};
  }

  /* ---- 持ち出し・取り込みのパネル ----
     モーダルを増やさない。**同じ画面の中で開く**——登録フィルタの一覧が
     見えたまま「どれが出て行くのか」を確かめられるのが大事なので、
     一覧の上へ差し込む形にしてある。 */
  let ioState=null;
  function ioClose(){
    ioState=null;
    const panel=$('#filterIoPanel');
    if(panel){panel.hidden=true;panel.innerHTML=''}
  }
  async function openIoPanel(kind){
    const panel=$('#filterIoPanel');if(!panel)return;
    panel.hidden=false;
    panel.innerHTML='<div class="fp-io-loading">'+WL.loader.html(14)+'この端末の登録フィルタを数えています…</div>';
    let all=[],dbKeys=null;
    try{all=await ioFetchAll()}
    catch(e){panel.innerHTML=`<div class="fp-io-error">登録フィルタを読めませんでした: ${esc(e.message)}</div>`;return}
    /* 取り込み側だけ、**この端末に無いデータの一覧**を言えるようにする
       (取り込んでも一生出てこない条件を黙って足さないため)。読めなければ
       黙って判定をやめる——「無い」と言い切るより何も言わないほうがまし。 */
    if(kind==='import'){
      try{const c=await api('/api/catalog');dbKeys=new Set((c.databases||[]).map(x=>x.key))}
      catch(_){dbKeys=null}
    }
    const here=ioGroupsOf(all);
    const cur=ioGroupKey({db:S.db||'',table:S.table||'',mode:presetMode()});
    ioState={kind,here,all,dbKeys,
             chosen:new Set(kind==='export'?here.filter(g=>g.key===cur).map(g=>g.key):[]),
             file:null,parsed:null,overwrite:true,withMarks:true,busy:false,status:''};
    renderIoPanel();
  }
  function ioCountText(g){
    const m=ioMarksOf(g);
    const bits=[`${g.presets.length}件`];
    if(m.def.size)bits.push(`デフォルト${m.def.size}`);
    if(m.lock.size)bits.push(`鍵${m.lock.size}`);
    return bits.join('・');
  }
  function renderIoPanel(){
    const panel=$('#filterIoPanel');if(!panel||!ioState)return;
    const st=ioState;
    const isExport=st.kind==='export';
    const cur=ioGroupKey({db:S.db||'',table:S.table||'',mode:presetMode()});
    let body='';
    if(isExport){
      const total=st.here.reduce((n,g)=>n+g.presets.length,0);
      const chosenCount=st.here.filter(g=>st.chosen.has(g.key)).reduce((n,g)=>n+g.presets.length,0);
      body=`
      <div class="fp-io-quick">
        <span>どれを出しますか</span>
        <button type="button" data-io-quick="current">いま開いている一覧だけ</button>
        <button type="button" data-io-quick="all">すべての一覧（${st.here.length}つ・${total}件）</button>
        <button type="button" data-io-quick="none">選択を全部外す</button>
      </div>
      <ul class="fp-io-groups">${st.here.map(g=>`
        <li${g.key===cur?' class="is-current"':''}>
         <label><input type="checkbox" data-io-group="${esc(g.key)}"${st.chosen.has(g.key)?' checked':''}>
          <b>${esc(ioGroupLabel(g))}</b>
          <small>${esc(ioModeLabel(g.mode))}</small>
          ${g.key===cur?'<em class="fp-io-now">いま開いている一覧</em>':''}</label>
         <span class="fp-io-count">${esc(ioCountText(g))}</span>
        </li>`).join('')||'<li class="fp-io-none">登録フィルタがまだありません。</li>'}</ul>
      <p class="fp-io-hint">
       <b>出るもの</b>: 条件・名前・対象の一覧／「自分だけ・みんな」の別／${esc(filterUserLabel())}が付けた「デフォルト」「鍵」の印（名前で運びます）。<br>
       <b>出ないもの</b>: 使用回数・最終使用日時（端末ごとの記録なので、運んでも意味がありません）／持ち主のID（取り込んだ人のものになります）。</p>
      <p class="fp-io-file-note">ファイル名 <code>${esc(ioFileName())}</code>（ブラウザのダウンロード先へ保存されます）</p>`;
      st.canRun=chosenCount>0;
      st.runLabel=chosenCount?`${chosenCount}件を書き出す`:'書き出す';
      st.note=chosenCount?`${st.chosen.size}つの一覧・${chosenCount}件を書き出します`:'書き出す一覧を選んでください';
    }else{
      const parsed=st.parsed;
      let list='';
      if(parsed){
        list=`<ul class="fp-io-groups">${parsed.groups.map(g=>{
          const here=st.all.filter(p=>p.db===g.db&&p.table===g.table&&(p.mode||'')===g.mode);
          const names=new Set(here.map(p=>p.name));
          const dup=g.presets.filter(p=>names.has(p.name)).length;
          const fresh=g.presets.length-dup;
          const unknown=st.dbKeys&&g.db&&!st.dbKeys.has(g.db);
          return `<li${g.key===cur?' class="is-current"':''}>
           <label><input type="checkbox" data-io-group="${esc(g.key)}"${st.chosen.has(g.key)?' checked':''}>
            <b>${esc(ioGroupLabel(g))}</b>
            <small>${esc(ioModeLabel(g.mode))}</small>
            ${g.key===cur?'<em class="fp-io-now">いま開いている一覧</em>':''}
            ${unknown?'<em class="fp-io-warn">この端末には無いデータです（取り込んでも一覧には出ません）</em>':''}</label>
           <span class="fp-io-count">新しく入る${fresh}件${dup?`・同じ名前が${dup}件`:''}</span>
          </li>`}).join('')}</ul>`;
      }
      body=`
      <div class="fp-io-pick">
        <label class="fp-io-filebtn">
         <input type="file" id="filterIoFile" accept=".json,application/json">
         <span>ファイルを選ぶ…</span>
        </label>
        <span class="fp-io-filename">${st.file?esc(st.file):'まだ選んでいません'}</span>
      </div>
      ${st.parseError?`<p class="fp-io-error">${esc(st.parseError)}</p>`:''}
      ${parsed?`<p class="fp-io-read">読み込んだ内容: <b>${parsed.groups.reduce((n,g)=>n+g.presets.length,0)}件</b>／${parsed.groups.length}つの一覧${parsed.exportedAt?`（書き出し ${esc(parsed.exportedAt.slice(0,16).replace('T',' '))}）`:''}</p>`:''}
      ${list}
      ${parsed?`
      <div class="fp-io-opts">
        <div class="fp-io-opt">
         <span class="fp-io-opt-label">同じ名前があったら</span>
         <label><input type="radio" name="fpIoDup" value="overwrite"${st.overwrite?' checked':''}> 上書きする（条件を新しいほうへ）</label>
         <label><input type="radio" name="fpIoDup" value="keep"${st.overwrite?'':' checked'}> そのままにする（既にある条件を残す）</label>
        </div>
        <div class="fp-io-opt">
         <label><input type="checkbox" id="fpIoMarks"${st.withMarks?' checked':''}> 「デフォルト」「鍵」の印も取り込む</label>
         <small>印は${esc(filterUserLabel())}だけのものになります。外すと条件だけが入ります。</small>
        </div>
      </div>`:'<p class="fp-io-hint">別のPCで「書き出す」から作ったJSONを選んでください。条件・名前・対象と、「デフォルト」「鍵」の印が入っています。</p>'}`;
      const chosenCount=parsed?parsed.groups.filter(g=>st.chosen.has(g.key)).reduce((n,g)=>n+g.presets.length,0):0;
      st.canRun=chosenCount>0;
      st.runLabel=chosenCount?`${chosenCount}件を取り込む`:'取り込む';
      st.note=parsed?(chosenCount?`${st.chosen.size}つの一覧・${chosenCount}件を取り込みます`:'取り込む一覧を選んでください'):'ファイルを選ぶと中身を確かめられます';
    }
    panel.innerHTML=`
     <div class="fp-io-head">
      <b>${isExport?'フィルタを書き出す':'フィルタを取り込む'}</b>
      <span class="fp-io-note">${esc(st.note||'')}</span>
      <button type="button" id="filterIoClose" title="閉じる">×</button>
     </div>
     <div class="fp-io-body">${body}</div>
     <div class="fp-io-foot">
      <span class="fp-io-status">${esc(st.status||'')}</span>
      <button type="button" id="filterIoCancel">キャンセル</button>
      <button type="button" id="filterIoRun" class="fp-io-run"${st.canRun&&!st.busy?'':' disabled'}>${esc(st.runLabel)}</button>
     </div>`;
    $('#filterIoClose').onclick=ioClose;
    $('#filterIoCancel').onclick=ioClose;
    $('#filterIoRun').onclick=()=>{isExport?runExport():runImport()};
    panel.querySelectorAll('[data-io-group]').forEach(box=>{
      box.addEventListener('change',()=>{
        const k=box.dataset.ioGroup;
        if(box.checked)st.chosen.add(k);else st.chosen.delete(k);
        renderIoPanel();
      });
    });
    panel.querySelectorAll('[data-io-quick]').forEach(btn=>{
      btn.onclick=()=>{
        const w=btn.dataset.ioQuick;
        st.chosen=new Set(w==='all'?st.here.map(g=>g.key):w==='current'?st.here.filter(g=>g.key===cur).map(g=>g.key):[]);
        renderIoPanel();
      };
    });
    const file=$('#filterIoFile');
    if(file)file.onchange=async()=>{
      const f=file.files&&file.files[0];if(!f)return;
      st.file=f.name;st.parseError='';st.parsed=null;st.chosen=new Set();
      try{
        st.parsed=ioParse(await f.text());
        /* **既定は全部入れる**——書き出したファイルを選んだ人は、その中身を
           入れたいから選んでいる。要らないものだけ外せばよい。 */
        st.chosen=new Set(st.parsed.groups.map(g=>g.key));
      }catch(e){st.parseError=e.message}
      renderIoPanel();
    };
    panel.querySelectorAll('[name="fpIoDup"]').forEach(r=>{
      r.onchange=()=>{st.overwrite=$('[name="fpIoDup"]:checked')?.value==='overwrite'};
    });
    const marks=$('#fpIoMarks');
    if(marks)marks.onchange=()=>{st.withMarks=marks.checked};
  }
  function runExport(){
    const st=ioState;if(!st)return;
    const groups=st.here.filter(g=>st.chosen.has(g.key));
    if(!groups.length)return;
    const payload={format:IO_FORMAT,version:IO_VERSION,app:'WaveLog',
      exportedAt:new Date().toISOString(),
      groups:groups.map(g=>{
        const m=ioMarksOf(g);
        return {db:g.db,table:g.table,mode:g.mode,
          presets:g.presets.map(p=>({name:p.name,filters:p.filters||[],
            /* 「自分だけ／みんな」も運ぶ(§9.172)。**持ち主のIDは運ばない**
               ——別のPCでは別の人が取り込むので、IDを持って行くと
               「他人のもの」として誰にも見えない登録が増える。 */
            shared:!p.owner,
            isDefault:m.def.has(p.name),isLocked:m.lock.has(p.name)}))};
      })};
    ioDownload(ioFileName(),JSON.stringify(payload,null,1));
    const n=groups.reduce((a,g)=>a+g.presets.length,0);
    showToast?.('フィルタを書き出しました',`${groups.length}つの一覧・${n}件（${ioFileName()}）`,4200);
    ioClose();
  }
  async function runImport(){
    const st=ioState;if(!st||!st.parsed||st.busy)return;
    st.busy=true;st.status='取り込んでいます…';renderIoPanel();
    let added=0,updated=0,skipped=0,failed=0;
    try{
      for(const g of st.parsed.groups.filter(x=>st.chosen.has(x.key))){
        const here=st.all.filter(p=>p.db===g.db&&p.table===g.table&&(p.mode||'')===g.mode);
        const byName=new Map(here.map(p=>[p.name,p]));
        const idOf=new Map();
        for(const p of g.presets){
          const dup=byName.get(p.name);
          if(dup&&!st.overwrite){skipped++;if(dup.id!=null)idOf.set(p.name,dup.id);continue}
          try{
            const r=await api('/api/filter-presets',{method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify(withUserId({name:p.name,db:g.db,table:g.table,mode:g.mode,filters:p.filters,
                user:filterUserId(),shared:!!p.shared}))});
            if(r&&r.id!=null)idOf.set(p.name,r.id);
            if(r&&r.registered)added++;else updated++;
          }catch(e){failed++}
        }
        /* 印は**取り込んだ名前のぶんだけ**書き換える。触っていない登録の
           デフォルト・鍵を巻き添えにしない。 */
        if(st.withMarks&&idOf.size){
          const key=mapKeyOf(g.db,g.table,g.mode);
          const dmap=readDefaultPresetMap(),lmap=readLockedPresetMap();
          const dset=new Set((dmap[key]||[]).map(String)),lset=new Set((lmap[key]||[]).map(String));
          const marks=[];
          g.presets.forEach(p=>{
            const id=idOf.get(p.name);if(id==null)return;
            p.isDefault?dset.add(String(id)):dset.delete(String(id));
            p.isLocked?lset.add(String(id)):lset.delete(String(id));
            marks.push({id,isDefault:!!p.isDefault,isLocked:!!p.isLocked});
          });
          dmap[key]=[...dset];lmap[key]=[...lset];
          writeDefaultPresetMap(dmap);writeLockedPresetMap(lmap);
          /* 印は**この人のもの**としてマスタにも残す(§9.172)。端末の控えだけに
             すると、取り込んだ人が別のPCへ移った瞬間に印だけ消える。 */
          if(marks.length){
            try{await api('/api/filter-presets/marks',{method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify(withUserId({user:filterUserId(),items:marks}))})}catch(_){WL.quiet.note('取り込んだ印をマスタへ残せない（端末の控えには入っている）',_)}
          }
        }
      }
    }finally{
      st.busy=false;
    }
    await loadMasterPresets({inline:false});
    ioClose();
    renderFilterPresetList();renderGenericFilterBar();
    const parts=[];
    if(added)parts.push(`新規${added}件`);
    if(updated)parts.push(`上書き${updated}件`);
    if(skipped)parts.push(`そのまま${skipped}件`);
    if(failed)parts.push(`失敗${failed}件`);
    showToast?.(failed?'一部を取り込めませんでした':'フィルタを取り込みました',
      parts.join(' / ')||'変更はありません',failed?7000:4200);
  }

  /* ---- 登録フィルタ一覧モーダル ---- */
  function ensureFilterPresetModal(){
    let modal=$('#filterPresetModal');if(modal)return modal;
    modal=document.createElement('div');modal.className='record-modal';modal.id='filterPresetModal';modal.hidden=true;
    modal.innerHTML=`
      <div class="filter-preset-dialog">
        <header><div><small>SAVED FILTERS (MASTER)</small><h2>登録した条件とプリセット</h2></div><button id="closeFilterPresets" type="button">×</button></header>
        <div class="filter-preset-body">
          <div class="filter-preset-toolbar"><span id="filterPresetSummary"></span>
           <span class="filter-preset-tools">
            <button id="exportFilterPresets" type="button" title="登録フィルタを、一覧ごとに選んでJSONファイルへ書き出します（別のPCへ運べます）">書き出す</button>
            <button id="importFilterPresets" type="button" title="書き出したJSONファイルから登録フィルタを取り込みます">取り込む</button>
            <button id="reloadFilterPresets" type="button">再読込</button>
           </span></div>
          <div class="fp-io" id="filterIoPanel" hidden></div>
          <div class="filter-preset-list" id="filterPresetList"></div>
        </div>
      </div>`;
    document.body.append(modal);
    /* 閉じるときは持ち出し・取り込みのパネルも畳む。開いたままにすると、
       次に開いたとき**前回数えた件数**がそのまま出る(古い数字を黙って
       見せない)。 */
    $('#closeFilterPresets').onclick=()=>{modal.hidden=true;ioClose()};
    $('#exportFilterPresets').onclick=()=>openIoPanel('export');
    $('#importFilterPresets').onclick=()=>openIoPanel('import');
    $('#reloadFilterPresets').onclick=async()=>{const list=$('#filterPresetList');setPanelLoading(list,true,'マスタから再読込しています...');await loadMasterPresets({inline:false});setPanelLoading(list,false);renderFilterPresetList();renderGenericFilterBar()};
    WL.modal.keepOpen(modal);
    document.addEventListener('keydown',event=>{if(WL.modal.escCloses(event)&&!modal.hidden){modal.hidden=true;ioClose()}},true);
    return modal;
  }
  /* ---------- もう一方の場面にある登録(§9.184) ----------
     置き場を場面で分けた以上、**片方にしか無い登録は「消えた」ように見える**。
     数えて文字で出し、こちらへも使えるようにする手立てを同じ場所に置く
     （黙って両方へ出すと、列構成の違う条件が並ぶ。§9.80の理由は生きている）。 */
  let otherScene={count:0,items:[]};
  const otherMode=()=>presetMode()==='schedule'?'':'schedule';
  const SCENE_OF={'':SCENE_LABEL[''],'schedule':SCENE_LABEL['schedule']};
  async function countOtherScene(){
    otherScene={count:0,items:[]};
    if(!S.db||!S.table)return;
    try{
      const q=new URLSearchParams({db:S.db,table:S.table,mode:otherMode(),user:filterUserId()});
      const r=await api('/api/filter-presets?'+q);
      otherScene={count:(r.items||[]).length,items:r.items||[]};
    }catch(_){WL.quiet.note('数えられなければ黙る(あるとも無いとも言わない)',_)}
  }
  /* こちらの場面へも同じ条件を登録する。**印(デフォルト・鍵)も一緒に運ぶ**
     ——鍵を付けた意図がいちばん大事なので、条件だけ移して印が消えると
     「移したのに効かない」ことになる。 */
  async function copyOtherScene(){
    const items=otherScene.items||[];
    if(!items.length)return;
    if(!(await confirmModal(`「${SCENE_OF[otherMode()]}」にある ${items.length}件を、`
      +`この場面（${sceneLabel()}）でも使えるようにします。\n`
      +`条件と「デフォルト」「鍵」の印を写します（元の登録はそのまま残ります）。`)))return;
    let ok=0,ng=0,markNg=0;
    for(const it of items){
      try{
        const r=await api('/api/filter-presets',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify(withUserId({name:it.name,db:S.db,table:S.table,mode:presetMode(),
            filters:it.filters||[],owner:it.owner||'',shared:!it.owner,user:filterUserId()}))});
        ok++;
        /* **印も一緒に運ぶ**(§9.190)。「いつも適用（固定）」は1つの印なので、
           どちらかが付いていれば両方を立てて写す。**失敗を握り潰さない**
           ——写したのに効かない状態が一番分かりにくい。 */
        if(r&&r.id!=null&&(it.isDefault||it.isLocked)){
          try{
            await api('/api/filter-presets/marks',{method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify(withUserId({user:filterUserId(),id:r.id,
                isDefault:true,isLocked:true}))});
          }catch(_){markNg++}
        }
      }catch(_){ng++}
    }
    presetsLoadedFor=null;defaultsAppliedFor=null;
    await loadMasterPresets({inline:false});
    await countOtherScene();
    renderFilterPresetList();
    reapplyDefaultFilters();
    showToast&&showToast('この場面でも使えるようにしました',
      `${ok}件を写しました${ng?`（${ng}件は失敗）`:''}`
      +(markNg?`\n${markNg}件は「いつも適用」の印を保存できませんでした`:''),
      markNg?8000:4000);
  }
  async function openFilterPresetModal(){
    ensureFilterPresetModal();$('#filterPresetModal').hidden=false;ioClose();
    requestAnimationFrame(()=>$('#closeFilterPresets')?.focus());
    const list=$('#filterPresetList');list.innerHTML='';setPanelLoading(list,true,'登録フィルタを読み込んでいます...');
    await loadMasterPresets({inline:false});
    await countOtherScene();
    setPanelLoading(list,false);renderFilterPresetList();renderGenericFilterBar();
  }
  /* ---------- 選んで組み合わせを作る（§9.287-D、利用者の指示） ----------
     「プリセットフィルタは登録一覧から作るが、登録した条件の組み合わせで
      名前を付けて管理したいです」「登録一覧からプリセット作るときのUIも
      直感的に使えるものを」

     決め方は**2手**——①条件を選ぶ ②名前を付ける。一覧は組み合わせごとの
     節に分かれているので、いまどれがどの組み合わせに入っているかは
     **見れば分かる**（§CLAUDE 画面基準 2）。
     **行ごとの選択欄は廃した**——同じことをする入口を2つ置かない（§9.207）。
     あれが一覧でいちばん幅を食い、名前と「分類なし」を見切れさせていた。 */
  let fpPicked=new Set();
  function fpPickedList(){
    const byId=new Map(currentTablePresets().map(p=>[String(p.id),p]));
    return [...fpPicked].map(id=>byId.get(id)).filter(Boolean);
  }
  /* ---------- 組み合わせを作る・直す（§9.288 ②、利用者の指示） ----------
     「登録したデータを使いまわせるような形が良いです…フィルタ登録した
      データを何回でも使えるという組み合わせのプリセット登録です」

     口は`POST /api/filter-presets/combo`の1本（新規＝name+members／
     変更＝id+name?+members?）。**描き直しは最後に1回**——1件ずつ描き直すと
     選択が消え、進んだのか失敗したのかも読めない。
     **入れられなかった件数と理由は必ず言う**（§4）。 */
  async function saveCombo(body,okMsg){
    try{
      const r=await api('/api/filter-presets/combo',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(withUserId(Object.assign({user:filterUserId(),
          db:S.db,table:S.table,mode:presetMode()},body)))});
      const d=(r&&r.dropped)||{};
      const lost=(d.missing||0)+(d.other||0)+(d.combo||0);
      fpPicked.clear();
      /* **読み直す**——メンバーの並びはサーバーが正（落とした件があるので、
         画面で組み立て直すと画面とマスタが食い違う）。 */
      presetsLoadedFor=null;
      await loadMasterPresets({inline:false});
      renderFilterPresetList();renderGenericFilterBar();
      if(lost&&typeof showToast==='function')
        showToast('入れられなかった条件があります',
          [d.missing?`${d.missing}件は消えた条件`:'',
           d.other?`${d.other}件は他の人のもの`:'',
           d.combo?`${d.combo}件は組み合わせ（入れ子にはできません）`:''
          ].filter(Boolean).join('／'),7000);
      else if(okMsg&&typeof showToast==='function')showToast(okMsg.t,okMsg.d,3000);
      return r;
    }catch(e){
      /* **失敗を黙らない**（§9.212 ④）——次の読み直しで元へ戻るだけなので、
         黙ると「勝手に戻った」としか見えない。 */
      showToast&&showToast('組み合わせを保存できませんでした',e?.message||String(e),7000);
      renderFilterPresetList();
      return null;
    }
  }
  const comboIds=c=>presetMembersOf(c).map(Number);
  async function createCombo(list){
    const name=await askGroupName();
    if(!name)return;
    await saveCombo({name,members:list.map(p=>p.id)},
      {t:'組み合わせを作りました',d:`${name}（条件${list.length}件）`});
  }
  async function addToCombo(combo,list){
    const now=comboIds(combo);
    const add=list.map(p=>Number(p.id)).filter(id=>now.indexOf(id)<0);
    /* **もう入っているものを黙って握り潰さない**（§4）——「足したのに
       件数が増えない」としか見えない。 */
    if(!add.length){
      showToast&&showToast('もう入っています',
        `選んだ ${list.length}件はすべて「${presetTitle(combo)}」に入っています。`,4500);
      return;
    }
    await saveCombo({id:combo.id,members:now.concat(add)},
      {t:'組み合わせへ足しました',d:`${presetTitle(combo)} ← ${add.length}件`});
  }
  async function removeFromCombo(combo,p){
    const now=comboIds(combo).filter(id=>String(id)!==String(p.id));
    /* **0件の組み合わせは作らない**（中身の無い登録＝押しても何も起きない
       プリセット・§4）。消すかどうかは聞いてから。 */
    if(!now.length){
      if(!(await confirmModal(`「${presetTitle(p)}」を外すと、組み合わせ「${presetTitle(combo)}」は条件が0件になります。\n`
        +`組み合わせごと削除しますか？（条件そのものは消えません）`)))return;
      await deletePreset(combo);return;
    }
    await saveCombo({id:combo.id,members:now},
      {t:'組み合わせから外しました',d:`${presetTitle(combo)} → ${presetTitle(p)}`});
  }
  async function renameCombo(combo){
    const was=presetTitle(combo);
    const name=await askGroupName(was);
    if(!name||name===was)return;
    await saveCombo({id:combo.id,name},{t:'名前を変えました',d:`${was} → ${name}`});
  }

  /* 節の見出し（＝1つのプリセット）。名前を変える・解くをここに置く
     ——組み合わせそのものへの操作なので、行ではなく節が持つ。 */
  function fpSectionHtml(title,note,kind,key){
    return `<div class="fp-sec" data-sec-kind="${esc(kind)}" data-sec-key="${esc(key||'')}">`
      +`<span class="fp-sec-name">${esc(title)}</span>`
      +`<small class="fp-sec-note">${esc(note)}</small>`
      +(kind==='combo'
        ?'<span class="fp-sec-acts">'
          +'<button type="button" data-sec-rename title="この組み合わせの名前を変えます（中の条件はそのまま）">名前を変える</button>'
          +'<button type="button" data-sec-unbind title="この組み合わせを解きます（条件そのものは消えません）">解く</button>'
          +'</span>'
        :'')
      +'</div>';
  }
  function renderFilterPresetList(){
    const list=$('#filterPresetList');if(!list)return;
    const forThis=currentTablePresets();
    const summary=$('#filterPresetSummary');
    /* **誰の設定を見ているのかを必ず出す**(§9.172)。個人単位にした以上、
       「自分の登録が何件で、みんなのが何件か」が読めないと、消えたのか
       他人のだったのかが分からなくなる。利用者IDが取れない端末では、
       その旨をそのまま書く（他人と混ざり得ることを隠さない）。 */
    const mineCount=forThis.filter(x=>x.owner).length;
    if(summary){
      summary.textContent='';
      const uid=filterUserId();
      const who=document.createElement('b');
      who.className='fp-who';
      who.textContent=uid?`${uid} さんの設定`:'この端末の共通の設定（利用者IDが分かりません）';
      summary.append(who,document.createTextNode(
        `　自分だけ ${mineCount}件 / みんな ${forThis.length-mineCount}件`
        /* **どの場面の設定かを書く**(§9.184)。同じ仕掛一覧でも、
           スケジュール作成中と「元データ」で置き場が別なので、
           書かないと「登録したのに出てこない」と読まれる。 */
        +`（${S.db||'-'} / ${S.table||'-'} ／ ${sceneLabel()}）`
        +`　保存先: ${S.filterPresetSource==='master'?'master.sqlite3':'この端末（マスタ未接続）'}`));
      /* **適用中の条件を覚えていることを書く**(§9.175)。黙って復元すると
         「勝手に絞り込まれている」と読まれる。忘れさせる手立ても同じ場所に
         置く——復元が邪魔なときに、条件を1つずつ外して回らずに済む。 */
      const memo=activeFilterMemoryCount();
      const note=document.createElement('span');
      note.className='fp-memo';
      note.textContent=memo?`　覚えた絞り込み ${memo}件`
                           :'　絞り込みはこの端末に覚えます';
      summary.append(note);
      if(memo){
        const btn=document.createElement('button');
        btn.type='button';btn.className='fp-memo-clear';btn.textContent='覚えを消す';
        btn.title='この端末に覚えている「適用中の条件」をすべて忘れます（登録フィルタは消えません）';
        btn.onclick=async()=>{
          if(!(await confirmModal(`この端末に覚えている「適用中の条件」${memo}件ぶんを忘れますか？\n登録フィルタそのものは消えません。今開いている一覧の条件はそのままです。`)))return;
          forgetActiveFilterMemory();renderFilterPresetList();
          showToast&&showToast('覚えを消しました','次に一覧を開いたときは条件なしで始まります',3000);
        };
        summary.append(btn);
      }
    }
    /* **消えた行を選んだままにしない**（§9.204）。 */
    const alive=new Set(forThis.map(p=>String(p.id)));
    [...fpPicked].forEach(id=>{if(!alive.has(id))fpPicked.delete(id)});
    const loading=list.querySelector(':scope > .panel-loading');
    list.querySelectorAll(':scope > .filter-preset-item, :scope > .record-empty,'
      +' :scope > .fp-other-scene, :scope > .fp-sec, :scope > .fp-bulk').forEach(x=>x.remove());
    const put=el=>{if(loading)list.insertBefore(el,loading);else list.appendChild(el)};
    const html=s=>{const d=document.createElement('div');d.innerHTML=s;return d.firstElementChild};
    if(otherScene.count){
      /* **どちらの場面の話かを書く。** 「登録が消えた」と読まれないように、
         件数・場面の名前・打つ手を1つの帯にまとめる。 */
      const note=document.createElement('div');
      note.className='fp-other-scene';
      note.innerHTML=`<span><b>${SCENE_OF[otherMode()]}</b>には ${otherScene.count}件の登録があります。`
        +`この場面（${esc(sceneLabel())}）とは別に保存しています。</span>`
        +`<button type="button" class="fp-other-copy">こちらでも使えるようにする</button>`;
      note.querySelector('.fp-other-copy').onclick=copyOtherScene;
      list.appendChild(note);
    }
    if(!forThis.length){
      const e=document.createElement('div');e.className='record-empty';
      /* **窓の題（「登録した条件とプリセット」）と同じ言葉で言うこと**——ここだけ
         「登録条件」と呼ぶと、探しものの名前が画面の中で2通りになる。 */
      e.textContent='この場面の登録した条件はありません。'
        +'帯の「条件」→「条件を作る・登録する」で条件を作って「登録」すると、ここに並びます。';
      put(e);return;
    }
    /* ---- 選択の帯。**0件でも出す**（§9.227 ②。出入りすると下の一覧が跳ねる） ---- */
    const picked=fpPickedList();
    const combos=comboPresets();
    const conds=condPresets();
    const bulk=html('<div class="fp-bulk"></div>');
    if(!picked.length){
      bulk.classList.add('is-idle');
      bulk.innerHTML='<span class="fp-bulk-hint">条件の左のチェックを入れると、'
        +'<b>組み合わせ（プリセット）</b>を作れます。'
        /* **使い回せることを最初に書く**（§9.288 ②。これがこの改良の
           値打ちで、書かないと「1つの群に入れる」と読まれる）。 */
        +'同じ条件は<b>何本の組み合わせにも</b>入れられます。'
        +'作った組み合わせは、絞り込みバーの「プリセット」から切り替えられます。</span>';
    }else{
      bulk.innerHTML=`<span class="fp-bulk-count"><b>${picked.length}件</b>選択中</span>`
        +'<button type="button" id="fpBulkNew" title="選んだ条件で新しい組み合わせ（プリセット）を作ります">新しい組み合わせを作る</button>'
        +(combos.length
          ?'<label class="fp-bulk-to"><span>いまある組み合わせへ足す</span>'
           +'<select id="fpBulkAdd"><option value="">— 選んでください —</option>'
           +combos.map(c=>`<option value="${esc(String(c.id))}">${esc(presetTitle(c))}</option>`).join('')
           +'</select></label>'
          :'')
        +'<button type="button" id="fpBulkNone" title="選択を解除します">選択をやめる</button>';
    }
    put(bulk);
    if(picked.length){
      bulk.querySelector('#fpBulkNew').onclick=()=>createCombo(picked);
      const addSel=bulk.querySelector('#fpBulkAdd');
      if(addSel)addSel.onchange=async e=>{
        const c=combos.find(x=>String(x.id)===e.target.value);
        e.target.value='';
        if(c)await addToCombo(c,picked);
      };
      bulk.querySelector('#fpBulkNone').onclick=()=>{fpPicked.clear();renderFilterPresetList()};
    }
    /* ---- ① 組み合わせ（プリセット） ---- */
    put(html(fpSectionHtml('組み合わせ（プリセット）',
      combos.length
        ?`${combos.length}件。絞り込みバーの「プリセット」から切り替えます`
        :'まだありません。下の条件を選んで「新しい組み合わせを作る」で作れます')));
    combos.forEach(c=>put(fpComboEl(c)));
    /* ---- ② 登録した条件 ---- */
    put(html(fpSectionHtml('登録した条件',
      `${conds.length}件。1件だけでもプリセットとして切り替えられます`
      +'（同じ条件を何本の組み合わせにも入れられます）')));
    conds.forEach(p=>put(fpItemEl(p,forThis)));
  }
  /* 1行＝1つの組み合わせ（§9.288 ②）。**中身は札で見せ、札の`×`で外す**
     ——「どの条件で出来ているか」が読めないと、切り替えたときに何が起きるのか
     推測することになる（§2）。列は登録した条件の行と**同じグリッド**を使う
     ので、左端がそろう（§CLAUDE 画面基準 9）。 */
  function fpComboEl(c){
    const item=document.createElement('div');
    item.className='filter-preset-item fp-combo';
    const part=comboParts(c);
    const chips=part.found.map(p=>`<span class="fp-mem">${esc(presetTitle(p))}`
      +`<button type="button" class="fp-mem-x" data-mem="${esc(String(p.id))}"`
      +' title="この条件を組み合わせから外します（条件そのものは消えません）">×</button></span>').join('')
      +(part.missing.length
        ?`<span class="fp-mem is-missing" title="登録が消えています。組み合わせから外してください">消えた条件 ${part.missing.length}件</span>`
        :'');
    const ownLabel=c.owner?'自分だけ':'みんな';
    const ownBtn=`<button type="button" class="fp-own${c.owner?' is-mine':''}" `
      +`title="${c.owner?'あなただけに見えている組み合わせです。押すと、みんなで使えるようになります。':'みんなに見えている組み合わせです。押すと、自分だけのものになります。'}">`
      +`${ownLabel}</button>`;
    item.innerHTML='<span class="fp-pick fp-pick-none" aria-hidden="true"></span>'
      +`<div class="fp-name"><b class="fp-combo-mark">組み合わせ</b>${esc(presetTitle(c))}`
      +`<small>条件 ${part.found.length}件</small></div>`
      +`<div class="fp-own-cell">${ownBtn}</div>`
      +`<div class="fp-conds fp-mems">${chips||'<span class="fp-cond">条件なし</span>'}</div>`
      +'<div class="fp-actions">'
      +'<button class="apply" type="button" title="この組み合わせへ切り替えます（前のプリセットの条件は外れます）">切り替える</button>'
      +'<button class="fp-rename" type="button" title="この組み合わせの名前を変えます（中の条件はそのまま）">名前</button>'
      +'<button class="danger" type="button" title="組み合わせだけを消します（中の条件は残ります）">削除</button>'
      +'</div>';
    item.querySelector('.apply').onclick=()=>{
      switchPreset('c:'+c.id);
      const m=$('#filterPresetModal');if(m)m.hidden=true;
    };
    item.querySelector('.fp-rename').onclick=()=>renameCombo(c);
    item.querySelector('.fp-own').onclick=()=>togglePresetOwner(c);
    item.querySelector('.danger').onclick=()=>deletePreset(c);
    item.querySelectorAll('[data-mem]').forEach(b=>{
      const m=part.found.find(x=>String(x.id)===b.dataset.mem);
      if(m)b.onclick=()=>removeFromCombo(c,m);
    });
    return item;
  }
  /* 1行＝1つの登録した条件
     報告「文字の見切れが無いように」）——1行に押し込む理由が無く、切ると
     「残仕掛設備ｺｰｽ 前方…」で何の条件か読めなくなる。
     **DB/表の列は廃した**——この一覧はいま開いている一覧のぶんだけなので、
     全部の行に同じ文字が並んでいた（§CLAUDE 8）。上の帯が1度だけ言う。 */
  function fpItemEl(p,forThis){
    const item=document.createElement('div');item.className='filter-preset-item';
    const conds=(p.filters||[]).map(f=>`<span class="fp-cond">${esc(f.column)} <b>${esc(opShort(f.op))}</b>${noValueOp(f.op)?'':' '+esc(f.value)}</span>`).join('');
    const applicable=forThis.includes(p);
    const always=isAlwaysOnPreset(p,S.db,S.table);
    /* **色だけで持ち主を伝えない**(§9.172)。「自分だけ」「みんな」という
       言葉をそのまま出し、押せば入れ替わることをtitleで言う。 */
    const ownLabel=p.owner?'自分だけ':'みんな';
    const ownBtn=`<button type="button" class="fp-own${p.owner?' is-mine':''}" `
      +`title="${p.owner?'あなただけに見えている登録です。押すと、みんなで使えるようになります。':'みんなに見えている登録です。押すと、自分だけのものになります（ほかの人の一覧から消えます）。'}">`
      +`${ownLabel}</button>`;
    /* **印は1つ**(§9.190)。「デフォルト」と「鍵」を分けていたのをやめ、
       「いつも適用（固定）」だけにした。言葉は利用者の言い方に合わせる。 */
    const defaultToggle=applicable?`<label class="fp-always${always?' is-on':''}" title="この一覧を開くたびに必ず入ります。手で外そうとすると確認し、再読み込み・再起動のあとも入ったままになります。この印は${esc(filterUserLabel())}だけのもので、ほかの人には付きません。"><input type="checkbox" class="fp-default-check"${always?' checked':''}> いつも適用<b>（固定）</b></label>`:'';
    const on=fpPicked.has(String(p.id));
    /* **使い回しが目に見えること**（§9.288 ②）——「この条件はどの組み合わせで
       使われているか」が読めないと、消したときに何が壊れるのか分からない。 */
    const used=combosUsing(p);
    const usedHtml=used.length
      ?`<small class="fp-used" title="${esc(used.map(presetTitle).join(' / '))}">`
       +`使用中 ${used.map(c=>esc(presetTitle(c))).join('・')}</small>`
      :'<small class="fp-used is-none" title="どの組み合わせにも入っていません（1件だけでも切り替えられます）">どの組み合わせにも未使用</small>';
    item.innerHTML=`<label class="fp-pick" title="組み合わせ（プリセット）を作るときに選びます"><input type="checkbox" class="fp-pick-check"${on?' checked':''}></label>`
      +`<div class="fp-name">${esc(presetTitle(p))}${p.uses?`<small>使用 ${p.uses}回</small>`:''}${usedHtml}</div>`
      +`<div class="fp-own-cell">${ownBtn}</div>`
      +`<div class="fp-conds">${conds||'<span class="fp-cond">条件なし</span>'}</div>`
      +`<div class="fp-actions">${defaultToggle}<button class="apply" type="button" title="この条件だけを今の一覧へ足します">適用</button><button class="danger" type="button">削除</button></div>`;
    item.classList.toggle('is-picked',on);
    item.querySelector('.fp-pick-check').onchange=e=>{
      const id=String(p.id);
      if(e.target.checked)fpPicked.add(id);else fpPicked.delete(id);
      renderFilterPresetList();
    };
    item.querySelector('.apply').onclick=()=>{applyPreset(p);$('#filterPresetModal').hidden=true};
    item.querySelector('.fp-own').onclick=()=>togglePresetOwner(p);
    item.querySelector('.danger').onclick=()=>deletePreset(p);
    item.querySelector('.fp-default-check')?.addEventListener('change',async e=>{
      const on2=!!e.target.checked;
      /* 外すときは確認する——「いつも適用」は外れないことに値打ちがあるので、
         うっかり外れないようにする（§9.190）。 */
      if(!on2&&!(await confirmModal(
        `「${presetTitle(p)}」の「いつも適用（固定）」を外します。\n`
        +`この一覧を開いても自動では入らなくなります。よろしいですか？`))){
        e.target.checked=true;return;
      }
      await setAlwaysOnPreset(p,S.db,S.table,on2);
      syncActiveFiltersForPreset(p);
      renderFilterPresetList();
    });
    return item;
  }

  /* /api/table へ絞り込み条件を送る。
     **load()を丸ごと置き換えない**(§9.93)。以前はここで全置換しており、
     元の定義をgrepで辿っても最終的な実装に行き着かなかった。実際、
     品質データ結合・キャッシュ・読み込み時間の計測の3回、「list-view.js側
     だけ直して効いていない」が起きている。このファイルが足すのは
     **絞り込み条件と、絞り込みバーの描き直し**の2つだけなので、
     その2つをフックとして登録する。 */
  WL.listHooks.onQuery(q=>{
    /* **引く前に場面と覚えを合わせる**(§9.184)。ここを通らない一覧の
       取得は無いので、鍵の付け替え・既定の当て直しはこの1箇所で足りる。 */
    syncFilterContext();
    // 変数(例: {使用設備})はここで今の値へ展開する。保存されている条件は
    // 変数のままなので、端末や設備が変わってもそのまま使い回せる。
    /* その場フィルタ(§9.238 ⑤)は**ここでだけ足す**——`S.genericFilters`へ
       入れると覚え(§9.175)へ焼き付き、次に開いたときに身に覚えのない条件が
       復活する。効いていることは絞り込みバーが文字で言う。 */
    syncAdhocContext();
    const list=S.genericFilters.concat(adhocFilters());
    if(list.length)q.set('filters',JSON.stringify(expandFilterList(list)));
  });
  WL.listHooks.onAfter(()=>renderGenericFilterBar());
  /* 0件の案内へ「いま効いている条件」を名乗る（§9.453）。出どころは2つ——登録・適用した
     フィルタ（`S.genericFilters`）と、その場フィルタ。いつも適用は印を付ける
     （外しても開き直すと戻るので、案内が別に断る）。 */
  WL.listHooks.onNarrow(()=>{
    const items=S.genericFilters.map(f=>({source:'条件',text:condLabel(f),locked:isLockedFilter(f)}))
      .concat(adhocFilters().map(f=>({source:'列で絞り込み',text:condLabel(f)})));
    return items.length?{items,clear:()=>dropAllFilters({adhoc:true})}:null;
  });
  /* ---------- 使用設備が変わったら、変数の条件は別の条件（§9.285 ①） ----------
     利用者の報告「フィルタの変数『使用設備』が、使用設備を切り替えても
     その切り替えた瞬間に反映されない」。

     展開は送信直前（上の`onQuery`）なので**値は最初から正しかった**——
     足りなかったのは「もう一度引く人」。いま出ている行は前の設備で絞った
     ものだし、絞り込みバーの「（=◯◯）」も前の設備を名乗っている。

     **変数を使っていないときは読み直さない**——関係の無い一覧まで
     読み直すと、重い一覧では設備を選び直しただけで数秒止まる。
     **黙って入れ替えない**（§3）——件数が変わる理由を文字で言う。 */
  WL.equipment.onChange(now=>{
    const list=S.genericFilters.concat(adhocFilters());
    const uses=list.filter(f=>filterVarFor(f.value));
    renderGenericFilterBar();
    if(!uses.length||!S.db||!S.table)return;
    S.page=1;
    if(typeof WL.list.load==='function')WL.list.load();
    if(typeof showToast==='function')showToast('使用設備を切り替えました',
      `変数を使っている絞り込み ${uses.length}件 を「${now||'未登録'}」で当て直しました。`,5000);
  });
  /* 札と表を描いたあとに足す（§9.352。被せない） */
  WL.listHooks.onTabs(()=>{ensureGenericFilterBar();renderGenericFilterBar();});
  WL.listHooks.onGrid(()=>{renderGenericFilterBar();updateFilterSuggestions();});

  /* ---- 公差の図は`measure-input.js`が持つ（§9.150） ----
     以前はここでスウォーム（蜂群図）版の`compactToleranceScale`へ**丸ごと
     差し替え**ていた。図を「縦＝条・横＝測定値」へ作り替えるにあたり、
     この差し替えは外した。**一覧の絞り込みのファイルが測定画面の図を
     持っていたこと自体が誤り**で、`measure-input.js`の定義は一度も
     実行されない死んだコードになっていた（CLAUDE.md「同じ関数を2ファイル
     以上が全置換すると、先に読まれた側は死んだコードになる」）。 */

  // 一覧を開くたび（テーブル切替時）にデフォルトフィルタを自動適用する。
  // 使用設備必須条件が欲しい場合も、登録フィルタに鍵を付けて保存すれば
  // 他の鍵付きデフォルトフィルタと同じくここで自動適用される(ハード
  // コーディングされた専用注入は行わない)。
  /* 表を選ぶ前に足す（被せない・§9.352）。 */
  WL.listHooks.onBeforeSelectTable(async t=>{
      /* 切替先に応じてS.genericFiltersを個別コンテキストへ入れ替える。
         (1)直前の状態を保存 (2)切替先の覚えを復元 (3)既定/鍵を当てる。
         **中身はsyncFilterContext()の1箇所**(§9.184)——以前はここに同じ
         処理が書かれていたため、起動直後・利用者ID到着・場面の変更では
         誰も当て直さなかった。 */
      if(activeFilterContextKey!=null)saveActiveFilterState(activeFilterUid);
      const key=defaultMapKey(S.db,t);
      S.genericFilters=restoreActiveFilterState(key);
      activeFilterContextKey=key;activeFilterUid=filterUserId();
      defaultsAppliedFor=null;
      /* **当てる前に取る。** ここで待つのは1往復だけで、そのかわり
         1回目の問い合わせから既定・鍵の条件が効く(取ってから当て直すと、
         一覧を2回引くことになる)。 */
      await ensurePresetsFor(S.db,t);
      applyDefaultFiltersFor(S.db,t);
      if(presetsReady(S.db,t))defaultsAppliedFor=key;
  });

  // 起動時: バー生成 → マスタからサジェスト材料を先読み（ローディング表示つき）。
  queueMicrotask(async()=>{
    ensureGenericFilterBar();renderGenericFilterBar();
    try{
      /* テーブルが決まっていればその一覧ぶんを、決まっていなければ
         (起動直後)取らない——空のdb/tableで問い合わせても1件も返らない。
         決まった時点で`selectTable`が`ensurePresetsFor`で取る。 */
      if(S.db&&S.table)await ensurePresetsFor(S.db,S.table);
      renderGenericFilterBar();
      /* **届いてから当て直す**(§9.184)。起動直後は一覧の取得のほうが
         先に走るため、この当て直しが無いと鍵付き・デフォルトの条件が
         「再起動すると外れている」状態になる（実機で報告された）。 */
      reapplyDefaultFilters();
    }catch(_){WL.quiet.note('登録フィルタを取れない（この一覧では絞り込みが空のまま）',_)}
  });
})();


