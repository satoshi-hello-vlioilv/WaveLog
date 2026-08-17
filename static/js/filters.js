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
  const QUICK_OPEN_STORE='MeasurementFilterQuickOpenV1';
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
  function activeBucket(){
    const uid=filterUserId();
    if(!activeAll[uid]||typeof activeAll[uid]!=='object')activeAll[uid]={};
    return activeAll[uid];
  }
  function writeActiveAll(){try{localStorage.setItem(ACTIVE_STORE,JSON.stringify(activeAll))}catch(_){}}
  function saveActiveFilterState(){
    if(activeFilterContextKey==null)return;
    const keep=S.genericFilters.filter(f=>!isLockedFilter(f)).map(f=>({...f}));
    const bucket=activeBucket();
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
  /* いま覚えている一覧の数。登録一覧モーダルの見出しで「どこに何が残って
     いるか」を文字で出すために使う(隠したまま効かせない)。 */
  function activeFilterMemoryCount(){return Object.keys(activeBucket()).length}
  function forgetActiveFilterMemory(){
    activeAll[filterUserId()]={};writeActiveAll();
  }

  function readLocalPresets(){try{return JSON.parse(localStorage.getItem(FILTER_STORE)||'[]')}catch(_){return []}}
  function writeLocalPresets(){try{localStorage.setItem(FILTER_STORE,JSON.stringify((S.filterPresets||[]).slice(0,120)))}catch(_){}}
  // よく使う条件の開閉状態(既定=閉じる)。端末ごとに覚える。
  let quickOpen=(()=>{try{return localStorage.getItem(QUICK_OPEN_STORE)==='1'}catch(_){return false}})();
  function writeQuickOpen(){try{localStorage.setItem(QUICK_OPEN_STORE,quickOpen?'1':'0')}catch(_){}}
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
      }catch(_){}
    }
    return all;
  }
  function writeUsage(){try{localStorage.setItem(USAGE_STORE,JSON.stringify(S.filterCondUsage||{}))}catch(_){}}
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
  function presetMode(){return (window.accessMode&&window.accessMode.mode)==='schedule'?'schedule':''}
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
      if(!box){box=document.createElement('div');box.className='panel-loading';box.innerHTML='<div class="pl-box"><span class="mini-spinner"></span><span class="pl-text"></span></div>';container.appendChild(box)}
      box.querySelector('.pl-text').textContent=text||'読み込んでいます...';box.hidden=false;
    }else if(box){box.hidden=true}
  }
  const canWait=()=>typeof showWaiting==='function'&&typeof hideSaveOverlay==='function';

  /* ---- マスタ連携（読込・保存・削除・使用回数） ---- */
  async function loadMasterPresets(opts={}){
    if(opts.inline!==false)setInlineLoading(true,'マスタからフィルタを読込中');
    try{
      const q=new URLSearchParams();if(S.db)q.set('db',S.db);if(S.table)q.set('table',S.table);
      q.set('mode',presetMode());
      /* **誰が見ているか**をサーバーへ渡す(§9.172)。返るのは「みんなのもの」と
         「自分のもの」だけで、印(デフォルト・鍵)もその人のぶんが載って来る。 */
      q.set('user',filterUserId());
      const r=await api('/api/filter-presets?'+q);
      const fromMaster=(r.items||[]).map(x=>({id:x.id,name:x.name,db:x.db,table:x.table,mode:x.mode||'',filters:Array.isArray(x.filters)?x.filters:[],uses:x.uses||0,lastUsed:x.last_used,updatedAt:x.updated_at,master:true,
        owner:x.owner||'',mine:!!x.mine,shared:!!x.shared,isDefault:!!x.isDefault,isLocked:!!x.isLocked}));
      /* 端末ごとの古い印を、一度だけこの人の印へ移す。**移してから写す**
         ——先に写すと、移行で付いた印がその場では反映されない。 */
      await migrateLegacyMarks(fromMaster,!!r.hasPersonalMarks);
      absorbServerMarks(fromMaster,S.db,S.table,presetMode());
      /* マスタへ書けなかったぶん(この端末だけの控え)は**捨てない**。
         以前はマスタの内容で丸ごと置き換えていたため、保存に失敗して
         ローカルへ退避した直後の再読込でそれごと消え、「登録したのに
         一覧に出ない」という見え方になっていた。 */
      const localOnly=(S.filterPresets||[]).filter(pz=>!pz.master);
      S.filterPresets=[...localOnly,...fromMaster];
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

  async function saveCurrentFiltersToMaster(){
    const savable=S.genericFilters.filter(f=>!isLockedFilter(f));
    if(!savable.length){showToast?.('保存する条件がありません','条件を追加してから保存してください（使用設備の必須条件は保存対象外です）。',4200);return}
    if(savable.length>1&&!(await confirmModal(`現在アクティブな${savable.length}件の条件を、それぞれ個別の登録フィルタとして保存します。よろしいですか？`)))return;
    if(canWait())showWaiting('フィルタをマスタへ保存しています','master.sqlite3 のフィルタプリセットマスタへ書き込み中','条件を1件ずつ登録しています');
    let saved=0,skipped=0,failed=0;
    for(const f of savable){
      const dup=(S.filterPresets||[]).some(p=>(p.filters||[]).length===1&&filterKey(p.filters[0])===filterKey(f)&&p.db===S.db&&p.table===S.table);
      if(dup){skipped++;continue}
      const payload={name:presetName(f),db:S.db,table:S.table,mode:presetMode(),filters:[f],user:filterUserId()};
      try{
        await api('/api/filter-presets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withUserId(payload))});
        saved++;
      }catch(e){
        const preset={id:crypto.randomUUID(),name:payload.name,db:S.db,table:S.table,mode:presetMode(),filters:[f],updatedAt:new Date().toISOString(),master:false,owner:filterUserId(),mine:true};
        S.filterPresets=[preset,...(S.filterPresets||[])].slice(0,120);writeLocalPresets();S.filterPresetSource='local';
        failed++;
      }
    }
    try{await loadMasterPresets({inline:false})}catch(_){}
    if(canWait())hideSaveOverlay();
    const parts=[];if(saved)parts.push(`新規${saved}件`);if(skipped)parts.push(`登録済み${skipped}件`);if(failed)parts.push(`この端末のみ${failed}件`);
    showToast?.('条件をマスタへ登録しました',parts.join(' / ')||'変更はありません',4200);
    renderGenericFilterBar();renderFilterPresetList();
  }
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
        bodyHtml:`<p class="confirm-modal-message">この登録フィルタが<b>ほかの人の登録フィルタ一覧にも出る</b>ようになります。</p>
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
      api('/api/filter-presets/use',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:preset.id,user_id:currentUserId()})}).catch(()=>{});
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
  let markMaps=null;                                  // {def:{},lock:{}}
  function readMarkMirror(){
    try{const all=JSON.parse(localStorage.getItem(MARK_MIRROR)||'{}');
        const mine=all[filterUserId()];
        if(mine&&typeof mine==='object')return {def:mine.def||{},lock:mine.lock||{}};
    }catch(_){}
    return null;
  }
  function writeMarkMirror(){
    try{
      const all=JSON.parse(localStorage.getItem(MARK_MIRROR)||'{}');
      all[filterUserId()]={def:markMaps.def,lock:markMaps.lock};
      localStorage.setItem(MARK_MIRROR,JSON.stringify(all));
    }catch(_){}
  }
  /* 端末に残っている**旧V1（端末ごとの印）**。移行の材料としてだけ読む。 */
  function legacyMarkMaps(){
    const read=k=>{try{const m=JSON.parse(localStorage.getItem(k)||'{}');return (m&&typeof m==='object')?m:{}}catch(_){return {}}};
    return {def:read(DEFAULT_STORE),lock:read(LOCKED_DEFAULT_STORE)};
  }
  function ensureMarkMaps(){
    if(markMaps)return markMaps;
    markMaps=readMarkMirror()||legacyMarkMaps();
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
  function setDefaultPreset(preset,db,table,on){
    const map=readDefaultPresetMap(),key=defaultMapKey(db,table),ids=new Set((map[key]||[]).map(String)),pid=String(preset.id);
    if(on)ids.add(pid);else ids.delete(pid);
    map[key]=[...ids];writeDefaultPresetMap(map);
    preset.isDefault=on;
    pushMark(preset.id,db,table,presetMode());
  }
  function toggleDefaultPreset(preset,db,table){setDefaultPreset(preset,db,table,!isDefaultPreset(preset,db,table))}

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
    if(presetId==null)return;
    const key=mapKeyOf(db,table,mode);
    const has=(m,k)=>((m[key]||[]).map(String)).includes(String(presetId));
    api('/api/filter-presets/marks',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(withUserId({user:filterUserId(),id:presetId,
        isDefault:has(readDefaultPresetMap()),isLocked:has(readLockedPresetMap())}))})
      .catch(()=>{/* 届かなければ端末の控えのまま。次の操作で送り直す */});
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
    try{done=JSON.parse(localStorage.getItem(MARK_MIGRATED)||'{}')}catch(_){}
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
    try{localStorage.setItem(MARK_MIGRATED,JSON.stringify(done))}catch(_){}
    return ids.size>0;
  }
  function lockedPresetIdsFor(db,table){return (readLockedPresetMap()[defaultMapKey(db,table)]||[]).map(String)}
  function isLockedDefaultPreset(preset,db,table){return lockedPresetIdsFor(db,table).includes(String(preset.id))}
  function setLockedDefaultPreset(preset,db,table,on){
    const map=readLockedPresetMap(),key=defaultMapKey(db,table),ids=new Set((map[key]||[]).map(String)),pid=String(preset.id);
    if(on)ids.add(pid);else ids.delete(pid);
    map[key]=[...ids];writeLockedPresetMap(map);
    preset.isLocked=on;
    pushMark(preset.id,db,table,presetMode());
  }
  function applyDefaultFiltersFor(db,table){
    const ids=defaultPresetIdsFor(db,table);if(!ids.length)return;
    const idSet=new Set(ids),lockedIds=new Set(lockedPresetIdsFor(db,table));
    const matches=(S.filterPresets||[]).filter(p=>idSet.has(String(p.id)));
    if(!matches.length)return;
    // 鍵付きプリセットを先に処理し、複数プリセットに同一条件がまたがる
    // 場合も鍵の状態が優先されるようにする。
    const ordered=[...matches].sort((a,b)=>Number(lockedIds.has(String(b.id)))-Number(lockedIds.has(String(a.id))));
    /* 呼び出し元(selectTable)がここより前にrestoreActiveFilterState()で
       復元済みの、このテーブル向けの非鍵付き(手動追加)条件へ重ね合わせる。
       以前はS.genericFiltersを丸ごと置き換えており、デフォルトフィルタが
       設定されたテーブルでは、タブを切り替えて戻るたびに手動で追加した
       検索条件が無警告で消えていた。 */
    const seen=new Set(S.genericFilters.map(filterKey));
    ordered.forEach(p=>{
      const locked=lockedIds.has(String(p.id));
      (p.filters||[]).forEach(f=>{
        const k=filterKey(f);
        if(!seen.has(k)){
          seen.add(k);S.genericFilters.push(locked?{...f,locked:true}:{...f});
        }else if(locked){
          const idx=S.genericFilters.findIndex(x=>filterKey(x)===k);
          if(idx>=0&&!S.genericFilters[idx].locked)S.genericFilters[idx]={...S.genericFilters[idx],locked:true};
        }
      });
    });
    S.page=1;
    showToast?.('デフォルトフィルタを適用しました',matches.map(p=>p.name).join(' / '),3200);
  }

  /* あるプリセットの条件が、対象のプリセット自身を除いても他のデフォルト
     (または鍵付き)プリセットから引き続き必要とされているか。デフォルト
     /鍵の解除時、他プリセットが同じ条件を必要としていれば残す。 */
  function presetFilterRequiredElsewhere(preset,key,{lockedOnly=false}={}){
    const ids=(lockedOnly?lockedPresetIdsFor(S.db,S.table):defaultPresetIdsFor(S.db,S.table))
      .filter(id=>String(id)!==String(preset.id));
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
    const isDefault=isDefaultPreset(preset,S.db,S.table);
    const locked=isLockedDefaultPreset(preset,S.db,S.table);
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
    S.page=1;renderGenericFilterBar();load();
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
    S.page=1;renderGenericFilterBar();load();
  }

  /* ---- 汎用フィルタ バー本体 ---- */
  function ensureGenericFilterBar(){
    let bar=$('#genericFilterBar');if(bar)return bar;
    bar=document.createElement('section');bar.id='genericFilterBar';bar.className='generic-filter-bar';
    const grid=$('#grid');grid?.parentNode?.insertBefore(bar,grid);
    bar.innerHTML=`
      <div class="filter-search-row">
        <b>フィルタ</b>
        <span class="filter-count" id="filterCount">0件</span>
        <div class="filter-token-input" id="filterTokenInput">
          <input class="filter-token-search" id="filterTokenSearch" autocomplete="off" placeholder="検索して条件を追加（列名・値・保存フィルタ）">
        </div>
        <div class="filter-suggest" id="filterSuggest" hidden></div>
        <span class="filter-inline-loading" id="filterInlineLoading" hidden><span class="mini-spinner"></span><span id="filterInlineLoadingText">読込中</span></span>
        <div class="filter-search-row-actions">
          <button id="filterQuickToggle" type="button" aria-expanded="false" aria-controls="filterQuickRow" hidden>よく使う条件</button>
          <button id="filterToggle" type="button">条件を作る</button>
          <button id="openFilterPresets" type="button">登録一覧</button>
          <button id="clearGenericFilters" type="button">全解除</button>
        </div>
      </div>
      <div class="filter-quick-row" id="filterQuickRow" hidden></div>
      <div class="filter-body" id="filterBody" hidden>
        <div class="filter-builder">
          <label>カラム<select id="filterColumn"></select></label>
          <label>比較<select id="filterOp"></select></label>
          <label>検査値<input id="filterValue" list="filterSuggestList" placeholder="値を入力/候補から選択"><datalist id="filterSuggestList"></datalist></label>
          <div class="filter-vars" id="filterVarChips" role="group" aria-label="変数を挿入"></div>
          <div class="filter-builder-actions">
           <button id="addGenericFilter" type="button" title="この条件を今の一覧へ追加します（保存はしません）">適用</button>
           <button id="registerGenericFilter" type="button" title="この条件を登録フィルタとして保存します（一覧へは適用しません）">登録</button>
          </div>
        </div>
        <p class="filter-builder-note" id="filterBuilderNote">「適用」は今だけ効かせる／「登録」は次回も使えるように保存する。両方押せます。</p>
      </div>`;
    // 詳細ビルダー（段階的開示）
    $('#filterToggle').onclick=()=>{const body=$('#filterBody');body.hidden=!body.hidden;$('#filterToggle').textContent=body.hidden?'条件を作る':'閉じる'};
    // よく使う条件は既定で折りたたむ(段階的開示)。以前は該当条件があれば
    // 常時1行を占有しており、狭い分割表示では一覧の縦幅を圧迫していた。
    $('#filterQuickToggle').onclick=()=>{quickOpen=!quickOpen;writeQuickOpen();renderQuickFilters()};
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
    $('#openFilterPresets').onclick=openFilterPresetModal;
    $('#clearGenericFilters').onclick=async()=>{
      const lockedList=S.genericFilters.filter(isLockedFilter);
      if(lockedList.length){
        if(await confirmRemoveAllLocked(lockedList))S.genericFilters=[];
        else S.genericFilters=S.genericFilters.filter(isLockedFilter);
      }else{
        S.genericFilters=[];
      }
      S.page=1;renderGenericFilterBar();load();
    };
    bindTokenSearch();
    return bar;
  }
  function updateFilterColumns(){
    ensureGenericFilterBar();const select=$('#filterColumn');if(!select)return;const current=select.value;
    select.innerHTML=(S.columns||[]).map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if((S.columns||[]).includes(current))select.value=current;
    updateFilterSuggestions();
  }
  function updateFilterSuggestions(){
    const col=$('#filterColumn')?.value,list=$('#filterSuggestList');if(!col||!list)return;
    const vals=[...new Set((S.rows||[]).map(r=>String(r[col]??'').trim()).filter(Boolean))].slice(0,80);
    list.innerHTML=vals.map(v=>`<option value="${esc(v)}"></option>`).join('');
  }
  function addGenericFilter(f){
    const key=filterKey(f);if(!S.genericFilters.some(x=>filterKey(x)===key))S.genericFilters.push(f);
    bumpCondUsage(f);S.page=1;renderGenericFilterBar();load();
  }

  /* アクティブ条件トークンを検索窓の中に描画（近接・同一面） */
  function renderActiveTokens(){
    const box=$('#filterTokenInput');if(!box)return;const input=$('#filterTokenSearch');
    box.querySelectorAll('.filter-tag').forEach(x=>x.remove());
    S.genericFilters.forEach((f,i)=>{
      const locked=isLockedFilter(f);
      const tag=document.createElement('span');tag.className='filter-tag'+(locked?' filter-tag-locked':'');
      tag.title=locked?`必須条件: ${lockedFilterDescription(f)}（一覧を開くたびに既定で適用されます）`:`${f.column} ${opLabel(f.op)}${noValueOp(f.op)?'':' '+f.value}`;
      /* 条件ごとに「登録済みかどうか」を出し、その場で登録できるようにする
         (§9.80)。候補やよく使う条件から足した条件も、作り直さずに次回へ
         残せる。★=登録済み / ☆=未登録。以前はバーの「マスタへ保存」で
         アクティブな条件を全部まとめて個別登録する作りで、何が登録された
         のか・何が既に登録済みなのかが分からなかった。 */
      const known=!!registeredPreset(f);
      const star=locked?'':`<u data-filter-save="${i}" tabindex="0" role="button" `
        +`class="${known?'is-saved':''}" `
        +`aria-label="${known?'登録済みの条件です':'この条件を登録する'}" `
        +`title="${known?'登録済み（登録一覧にあります）':'クリックで登録フィルタとして保存します'}">${known?'★':'☆'}</u>`;
      tag.innerHTML=`${locked?'<span class="filter-tag-lock-icon" aria-hidden="true">🔒</span>':''}<span>${esc(f.column)}</span><b>${esc(opShort(f.op))}</b>${noValueOp(f.op)?'':`<em>${esc(f.value)}</em>`}${star}<i data-filter-index="${i}" tabindex="0" role="button" aria-label="この条件を解除" title="解除">×</i>`;
      const removeThis=async e=>{
        e.stopPropagation();
        if(locked&&!(await confirmRemoveLockedFilter(f)))return;
        S.genericFilters.splice(i,1);S.page=1;renderGenericFilterBar();load();
      };
      const removeIcon=tag.querySelector('i');
      removeIcon.onclick=removeThis;
      removeIcon.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();removeThis(e)}};
      const saveIcon=tag.querySelector('u[data-filter-save]');
      if(saveIcon){
        const doSave=async e=>{e.stopPropagation();if(registeredPreset(f))return;await saveOneToMaster(f)};
        saveIcon.onclick=doSave;
        saveIcon.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();doSave(e)}};
      }
      box.insertBefore(tag,input);
    });
    const count=$('#filterCount');if(count)count.textContent=`${S.genericFilters.length}件`;
  }
  /* クイックフィルタ: 詳細ビルダーを開かなくても、よく使う条件をワンクリックで
     追加できるチップを検索バー直下へ常時表示する(既存のfrequentConditions()
     ―保存フィルタ利用回数×2+個別条件の適用履歴―をそのまま流用)。
     アクティブな条件は既にfrequentConditions()側で除外されるため、
     追加すると自動的にチップから消える。 */
  function renderQuickFilters(){
    const row=$('#filterQuickRow'),toggle=$('#filterQuickToggle');if(!row)return;
    const top=frequentConditions().slice(0,6);
    if(!top.length){
      row.hidden=true;row.innerHTML='';
      if(toggle)toggle.hidden=true;
      return;
    }
    if(toggle){
      toggle.hidden=false;
      toggle.textContent=`よく使う条件 ${top.length}`;
      toggle.classList.toggle('active',quickOpen);
      toggle.setAttribute('aria-expanded',quickOpen?'true':'false');
    }
    if(!quickOpen){row.hidden=true;row.innerHTML='';return}
    row.hidden=false;
    row.innerHTML=`<span class="filter-quick-label">よく使う条件</span>`+top.map(f=>
      `<button type="button" class="suggest-chip quick"><span>${esc(f.column)}</span><b>${esc(opShort(f.op))}</b>${noValueOp(f.op)?'':`<em>${esc(f.value)}</em>`}</button>`
    ).join('');
    [...row.querySelectorAll('.suggest-chip')].forEach((btn,i)=>btn.onclick=()=>addGenericFilter(top[i]));
  }
  function renderGenericFilterBar(){
    ensureGenericFilterBar();updateFilterColumns();renderActiveTokens();renderQuickFilters();
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
    currentTablePresets().forEach(p=>(p.filters||[]).forEach(f=>{const k=filterKey(f);const e=map.get(k)||{f,count:0,at:0};e.count+=Math.max(1,p.uses||1);map.set(k,e)}));
    Object.values(scopedUsage()).forEach(u=>{if(!u.f)return;const k=filterKey(u.f);const e=map.get(k)||{f:u.f,count:0,at:0};e.count+=(u.count||0)*2;e.at=Math.max(e.at,u.at||0);map.set(k,e)});
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
  function bindTokenSearch(){
    const input=$('#filterTokenSearch'),box=$('#filterTokenInput'),suggest=$('#filterSuggest');if(!input)return;
    input.addEventListener('focus',()=>{box.classList.add('focus-within');renderSuggest()});
    input.addEventListener('input',()=>renderSuggest());
    input.addEventListener('keydown',async e=>{
      if(e.key==='ArrowDown'){e.preventDefault();moveSuggest(1)}
      else if(e.key==='ArrowUp'){e.preventDefault();moveSuggest(-1)}
      else if(e.key==='Enter'){e.preventDefault();(suggestFlat[suggestIndex]||suggestFlat[0])?.click()}
      else if(e.key==='Escape'){suggest.hidden=true}
      else if(e.key==='Backspace'&&!input.value&&S.genericFilters.length){
        const last=S.genericFilters[S.genericFilters.length-1];
        if(isLockedFilter(last)&&!(await confirmRemoveLockedFilter(last)))return;
        S.genericFilters.pop();S.page=1;renderGenericFilterBar();load();
      }
    });
    const row=input.closest('.filter-search-row')||box;document.addEventListener('click',e=>{if(!row.contains(e.target)){box.classList.remove('focus-within');if(suggest)suggest.hidden=true}});
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
    panel.innerHTML='<div class="fp-io-loading"><span class="mini-spinner"></span>この端末の登録フィルタを数えています…</div>';
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
              body:JSON.stringify(withUserId({user:filterUserId(),items:marks}))})}catch(_){}
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
        <header><div><small>SAVED FILTERS (MASTER)</small><h2>登録フィルタ一覧</h2></div><button id="closeFilterPresets" type="button">×</button></header>
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
    modal.addEventListener('click',e=>{if(e.target===modal){modal.hidden=true;ioClose()}});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!modal.hidden){modal.hidden=true;ioClose()}},true);
    return modal;
  }
  async function openFilterPresetModal(){
    ensureFilterPresetModal();$('#filterPresetModal').hidden=false;ioClose();
    requestAnimationFrame(()=>$('#closeFilterPresets')?.focus());
    const list=$('#filterPresetList');list.innerHTML='';setPanelLoading(list,true,'登録フィルタを読み込んでいます...');
    await loadMasterPresets({inline:false});setPanelLoading(list,false);renderFilterPresetList();renderGenericFilterBar();
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
        +`（${S.db||'-'} / ${S.table||'-'}）`
        +`　保存先: ${S.filterPresetSource==='master'?'master.sqlite3':'この端末（マスタ未接続）'}`));
      /* **適用中の条件を覚えていることを書く**(§9.175)。黙って復元すると
         「勝手に絞り込まれている」と読まれる。忘れさせる手立ても同じ場所に
         置く——復元が邪魔なときに、条件を1つずつ外して回らずに済む。 */
      const memo=activeFilterMemoryCount();
      const note=document.createElement('span');
      note.className='fp-memo';
      note.textContent=memo?`　適用中の条件は ${memo}件の一覧ぶん、この端末に覚えています`
                           :'　適用中の条件は、この端末に覚えます（次に開いたときも当たります）';
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
    const ordered=forThis;
    const loading=list.querySelector(':scope > .panel-loading');
    list.querySelectorAll(':scope > .filter-preset-item, :scope > .record-empty').forEach(x=>x.remove());
    if(!ordered.length){const e=document.createElement('div');e.className='record-empty';e.textContent='登録済みフィルタはありません。「マスタへ保存」で登録できます。';list.appendChild(e);return}
    ordered.forEach(p=>{
      const item=document.createElement('div');item.className='filter-preset-item';
      const conds=(p.filters||[]).map(f=>`<span class="fp-cond">${esc(f.column)} <b>${esc(opShort(f.op))}</b>${noValueOp(f.op)?'':' '+esc(f.value)}</span>`).join('');
      const applicable=forThis.includes(p);
      const locked=isLockedDefaultPreset(p,S.db,S.table);
      /* **色だけで持ち主を伝えない**(§9.172)。「自分だけ」「みんな」という
         言葉をそのまま出し、押せば入れ替わることをtitleで言う。 */
      const ownLabel=p.owner?'自分だけ':'みんな';
      const ownBtn=`<button type="button" class="fp-own${p.owner?' is-mine':''}" `
        +`title="${p.owner?'あなただけに見えている登録です。押すと、みんなで使えるようになります。':'みんなに見えている登録です。押すと、自分だけのものになります（ほかの人の一覧から消えます）。'}">`
        +`${ownLabel}</button>`;
      const defaultToggle=applicable?`<label class="fp-default" title="この一覧を開いたときに自動で適用します（この印は${esc(filterUserLabel())}だけのもので、ほかの人には付きません）"><input type="checkbox" class="fp-default-check"${isDefaultPreset(p,S.db,S.table)?' checked':''}> デフォルト</label>`:'';
      const lockToggle=applicable?`<button type="button" class="fp-lock-btn${locked?' locked':''}" aria-pressed="${locked}" title="${locked?'鍵付き必須条件: 一覧を開くたびに自動適用され、外す際は確認が必要です。もう一度押すと鍵だけ外せます（デフォルト適用は維持）。':'鍵を付けると、デフォルト適用した上で外す際に確認が必要な必須条件になります。'}">${locked?'🔒':'🔓'}</button>`:'';
      item.innerHTML=`<div class="fp-name" title="${esc(p.name)}">${esc(p.name)}${p.uses?`<small>使用 ${p.uses}回</small>`:''}</div><div class="fp-own-cell">${ownBtn}</div><div class="fp-target">${esc((p.db||'全DB')+' / '+(p.table||'全テーブル'))}</div><div class="fp-conds">${conds||'<span class="fp-cond">条件なし</span>'}</div><div class="fp-actions">${defaultToggle}${lockToggle}<button class="apply" type="button">適用</button><button class="danger" type="button">削除</button></div>`;
      item.querySelector('.apply').onclick=()=>{applyPreset(p);$('#filterPresetModal').hidden=true};
      item.querySelector('.fp-own').onclick=()=>togglePresetOwner(p);
      item.querySelector('.danger').onclick=()=>deletePreset(p);
      item.querySelector('.fp-default-check')?.addEventListener('change',async e=>{
        // 鍵付きのままデフォルトを外すと固定フィルタの意味が失われるため、
        // 鍵が付いている場合は確認の上でデフォルトと鍵を同時に外す。
        if(!e.target.checked&&isLockedDefaultPreset(p,S.db,S.table)){
          if(!(await confirmModal(`このフィルタ「${p.name}」は鍵付きの必須条件です。デフォルトを外すと鍵も一緒に解除されます。\n本当によろしいですか？`))){e.target.checked=true;return}
          setLockedDefaultPreset(p,S.db,S.table,false);
        }
        toggleDefaultPreset(p,S.db,S.table);
        syncActiveFiltersForPreset(p);
        renderFilterPresetList();
      });
      item.querySelector('.fp-lock-btn')?.addEventListener('click',()=>{
        const nowLocked=!isLockedDefaultPreset(p,S.db,S.table);
        setLockedDefaultPreset(p,S.db,S.table,nowLocked);
        if(nowLocked&&!isDefaultPreset(p,S.db,S.table))setDefaultPreset(p,S.db,S.table,true);
        syncActiveFiltersForPreset(p);
        renderFilterPresetList();
      });
      if(loading)list.insertBefore(item,loading);else list.appendChild(item);
    });
  }

  /* /api/table へ絞り込み条件を送る。
     **load()を丸ごと置き換えない**(§9.93)。以前はここで全置換しており、
     元の定義をgrepで辿っても最終的な実装に行き着かなかった。実際、
     品質データ結合・キャッシュ・読み込み時間の計測の3回、「list-view.js側
     だけ直して効いていない」が起きている。このファイルが足すのは
     **絞り込み条件と、絞り込みバーの描き直し**の2つだけなので、
     その2つをフックとして登録する。 */
  WL.listHooks.onQuery(q=>{
    // 変数(例: {使用設備})はここで今の値へ展開する。保存されている条件は
    // 変数のままなので、端末や設備が変わってもそのまま使い回せる。
    if(S.genericFilters?.length)q.set('filters',JSON.stringify(expandFilterList(S.genericFilters)));
  });
  WL.listHooks.onAfter(()=>renderGenericFilterBar());
  if(typeof renderTabs==='function'){
    const baseRenderTabs=renderTabs;renderTabs=function(){baseRenderTabs();ensureGenericFilterBar();renderGenericFilterBar();};
  }
  const baseRenderGrid=typeof renderGrid==='function'?renderGrid:null;
  if(baseRenderGrid){renderGrid=function(){baseRenderGrid();renderGenericFilterBar();updateFilterSuggestions();};}

  /* ---- 公差の図は`measurement-input.js`が持つ（§9.150） ----
     以前はここでスウォーム（蜂群図）版の`compactToleranceScale`へ**丸ごと
     差し替え**ていた。図を「縦＝条・横＝測定値」へ作り替えるにあたり、
     この差し替えは外した。**一覧の絞り込みのファイルが測定画面の図を
     持っていたこと自体が誤り**で、`measurement-input.js`の定義は一度も
     実行されない死んだコードになっていた（CLAUDE.md「同じ関数を2ファイル
     以上が全置換すると、先に読まれた側は死んだコードになる」）。 */

  // 一覧を開くたび（テーブル切替時）にデフォルトフィルタを自動適用する。
  // 使用設備必須条件が欲しい場合も、登録フィルタに鍵を付けて保存すれば
  // 他の鍵付きデフォルトフィルタと同じくここで自動適用される(ハード
  // コーディングされた専用注入は行わない)。
  if(typeof selectTable==='function'){
    const selectTableDefaultFilterBase=selectTable;
    selectTable=async function(t){
      // 切替先に応じてS.genericFiltersを個別コンテキストへ入れ替える。
      // (1)直前のコンテキストの状態を保存 (2)切替先の保存済み状態を復元
      // (3)デフォルト/鍵付き条件をそのコンテキスト向けに再適用。
      saveActiveFilterState();
      const key=defaultMapKey(S.db,t);
      S.genericFilters=restoreActiveFilterState(key);
      applyDefaultFiltersFor(S.db,t);
      activeFilterContextKey=key;
      return selectTableDefaultFilterBase(t);
    };
  }

  // 起動時: バー生成 → マスタからサジェスト材料を先読み（ローディング表示つき）。
  queueMicrotask(async()=>{ensureGenericFilterBar();renderGenericFilterBar();try{await loadMasterPresets();renderGenericFilterBar()}catch(_){}});
})();


