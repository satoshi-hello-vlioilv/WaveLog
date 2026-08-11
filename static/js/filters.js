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
  const USAGE_STORE='MeasurementFilterCondUsageV2';
  const QUICK_OPEN_STORE='MeasurementFilterQuickOpenV1';
  const OPS=[
    ['contains','含む'],['not_contains','含まない'],['eq','＝ 一致'],['neq','≠ 不一致'],
    ['starts','前方一致'],['ends','後方一致'],['gt','> より大きい'],['gte','>= 以上'],['lt','< より小さい'],['lte','<= 以下'],['empty','空欄'],['not_empty','空欄以外']
  ];
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
  const activeFilterStateCache={};
  function saveActiveFilterState(){
    if(activeFilterContextKey==null)return;
    activeFilterStateCache[activeFilterContextKey]=S.genericFilters.filter(f=>!isLockedFilter(f)).map(f=>({...f}));
  }
  function restoreActiveFilterState(key){
    return (activeFilterStateCache[key]||[]).map(f=>({...f}));
  }

  function readLocalPresets(){try{return JSON.parse(localStorage.getItem(FILTER_STORE)||'[]')}catch(_){return []}}
  function writeLocalPresets(){try{localStorage.setItem(FILTER_STORE,JSON.stringify((S.filterPresets||[]).slice(0,120)))}catch(_){}}
  // よく使う条件の開閉状態(既定=閉じる)。端末ごとに覚える。
  let quickOpen=(()=>{try{return localStorage.getItem(QUICK_OPEN_STORE)==='1'}catch(_){return false}})();
  function writeQuickOpen(){try{localStorage.setItem(QUICK_OPEN_STORE,quickOpen?'1':'0')}catch(_){}}
  function readUsage(){try{return JSON.parse(localStorage.getItem(USAGE_STORE)||'{}')}catch(_){return {}}}
  function writeUsage(){try{localStorage.setItem(USAGE_STORE,JSON.stringify(S.filterCondUsage||{}))}catch(_){}}
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
    const all=S.filterCondUsage||{};
    const bucket=all[usageScopeKey()];
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
    // どのDB/テーブルで使った条件かを必ず添えて記録する(V2、上記コメント参照)。
    const scope=usageScopeKey();if(!S.db||!S.table)return;
    const all=S.filterCondUsage||(S.filterCondUsage={});
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
      const r=await api('/api/filter-presets?'+q);
      const fromMaster=(r.items||[]).map(x=>({id:x.id,name:x.name,db:x.db,table:x.table,mode:x.mode||'',filters:Array.isArray(x.filters)?x.filters:[],uses:x.uses||0,lastUsed:x.last_used,updatedAt:x.updated_at,master:true}));
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
    const payload={name:presetName(f),db:S.db,table:S.table,mode:presetMode(),filters:[f]};
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
                    mode:presetMode(),filters:[f],updatedAt:new Date().toISOString(),master:false};
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
      const payload={name:presetName(f),db:S.db,table:S.table,mode:presetMode(),filters:[f]};
      try{
        await api('/api/filter-presets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withUserId(payload))});
        saved++;
      }catch(e){
        const preset={id:crypto.randomUUID(),name:payload.name,db:S.db,table:S.table,mode:presetMode(),filters:[f],updatedAt:new Date().toISOString(),master:false};
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
      try{await api('/api/filter-presets/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withUserId({id:preset.id}))});await loadMasterPresets({inline:false})}
      catch(e){showToast?.('マスタから削除できませんでした',e.message,6500)}
      finally{setPanelLoading(listEl,false)}
    }else{
      S.filterPresets=(S.filterPresets||[]).filter(x=>x!==preset);writeLocalPresets();
    }
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
  const DEFAULT_STORE='MeasurementDefaultFilterPresetsV1';
  function readDefaultPresetMap(){try{return JSON.parse(localStorage.getItem(DEFAULT_STORE)||'{}')}catch(_){return {}}}
  function writeDefaultPresetMap(map){try{localStorage.setItem(DEFAULT_STORE,JSON.stringify(map))}catch(_){}}
  // 既定・鍵の記憶もモードごと(上と同じ理由)。
  function defaultMapKey(db,table){return `${db||''}::${table||''}::${presetMode()}`}
  function defaultPresetIdsFor(db,table){return (readDefaultPresetMap()[defaultMapKey(db,table)]||[]).map(String)}
  function isDefaultPreset(preset,db,table){return defaultPresetIdsFor(db,table).includes(String(preset.id))}
  function setDefaultPreset(preset,db,table,on){
    const map=readDefaultPresetMap(),key=defaultMapKey(db,table),ids=new Set((map[key]||[]).map(String)),pid=String(preset.id);
    if(on)ids.add(pid);else ids.delete(pid);
    map[key]=[...ids];writeDefaultPresetMap(map);
  }
  function toggleDefaultPreset(preset,db,table){setDefaultPreset(preset,db,table,!isDefaultPreset(preset,db,table))}

  /* ---- 鍵付きデフォルトフィルタ（テーブルごとに複数選択可） ----
     デフォルトフィルタのうち、鍵を付けたものは「一覧を開くたびに必ず
     自動適用され、外そうとすると確認が必要な必須条件」になる(旧・固定
     設備フィルタと同じ挙動)。鍵はデフォルトが前提のため、鍵を付けると
     デフォルトも自動でONにし、デフォルトを外すと鍵も一緒に外れる。 */
  const LOCKED_DEFAULT_STORE='MeasurementLockedDefaultFilterPresetsV1';
  function readLockedPresetMap(){try{return JSON.parse(localStorage.getItem(LOCKED_DEFAULT_STORE)||'{}')}catch(_){return {}}}
  function writeLockedPresetMap(map){try{localStorage.setItem(LOCKED_DEFAULT_STORE,JSON.stringify(map))}catch(_){}}
  function lockedPresetIdsFor(db,table){return (readLockedPresetMap()[defaultMapKey(db,table)]||[]).map(String)}
  function isLockedDefaultPreset(preset,db,table){return lockedPresetIdsFor(db,table).includes(String(preset.id))}
  function setLockedDefaultPreset(preset,db,table,on){
    const map=readLockedPresetMap(),key=defaultMapKey(db,table),ids=new Set((map[key]||[]).map(String)),pid=String(preset.id);
    if(on)ids.add(pid);else ids.delete(pid);
    map[key]=[...ids];writeLockedPresetMap(map);
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

  /* ---- 登録フィルタ一覧モーダル ---- */
  function ensureFilterPresetModal(){
    let modal=$('#filterPresetModal');if(modal)return modal;
    modal=document.createElement('div');modal.className='record-modal';modal.id='filterPresetModal';modal.hidden=true;
    modal.innerHTML=`
      <div class="filter-preset-dialog">
        <header><div><small>SAVED FILTERS (MASTER)</small><h2>登録フィルタ一覧</h2></div><button id="closeFilterPresets" type="button">×</button></header>
        <div class="filter-preset-body">
          <div class="filter-preset-toolbar"><span id="filterPresetSummary"></span><button id="reloadFilterPresets" type="button">再読込</button></div>
          <div class="filter-preset-list" id="filterPresetList"></div>
        </div>
      </div>`;
    document.body.append(modal);
    $('#closeFilterPresets').onclick=()=>{modal.hidden=true};
    $('#reloadFilterPresets').onclick=async()=>{const list=$('#filterPresetList');setPanelLoading(list,true,'マスタから再読込しています...');await loadMasterPresets({inline:false});setPanelLoading(list,false);renderFilterPresetList();renderGenericFilterBar()};
    modal.addEventListener('click',e=>{if(e.target===modal)modal.hidden=true});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!modal.hidden){modal.hidden=true}},true);
    return modal;
  }
  async function openFilterPresetModal(){
    ensureFilterPresetModal();$('#filterPresetModal').hidden=false;
    requestAnimationFrame(()=>$('#closeFilterPresets')?.focus());
    const list=$('#filterPresetList');list.innerHTML='';setPanelLoading(list,true,'登録フィルタを読み込んでいます...');
    await loadMasterPresets({inline:false});setPanelLoading(list,false);renderFilterPresetList();renderGenericFilterBar();
  }
  function renderFilterPresetList(){
    const list=$('#filterPresetList');if(!list)return;
    const forThis=currentTablePresets();
    const summary=$('#filterPresetSummary');
    if(summary)summary.textContent=`保存先: ${S.filterPresetSource==='master'?'master.sqlite3':'この端末（マスタ未接続）'}　このテーブルの登録フィルタ ${forThis.length}件（${S.db||'-'} / ${S.table||'-'}）`;
    const ordered=forThis;
    const loading=list.querySelector(':scope > .panel-loading');
    list.querySelectorAll(':scope > .filter-preset-item, :scope > .record-empty').forEach(x=>x.remove());
    if(!ordered.length){const e=document.createElement('div');e.className='record-empty';e.textContent='登録済みフィルタはありません。「マスタへ保存」で登録できます。';list.appendChild(e);return}
    ordered.forEach(p=>{
      const item=document.createElement('div');item.className='filter-preset-item';
      const conds=(p.filters||[]).map(f=>`<span class="fp-cond">${esc(f.column)} <b>${esc(opShort(f.op))}</b>${noValueOp(f.op)?'':' '+esc(f.value)}</span>`).join('');
      const applicable=forThis.includes(p);
      const locked=isLockedDefaultPreset(p,S.db,S.table);
      const defaultToggle=applicable?`<label class="fp-default" title="この一覧を開いたときに自動で適用します（複数選択可）"><input type="checkbox" class="fp-default-check"${isDefaultPreset(p,S.db,S.table)?' checked':''}> デフォルト</label>`:'';
      const lockToggle=applicable?`<button type="button" class="fp-lock-btn${locked?' locked':''}" aria-pressed="${locked}" title="${locked?'鍵付き必須条件: 一覧を開くたびに自動適用され、外す際は確認が必要です。もう一度押すと鍵だけ外せます（デフォルト適用は維持）。':'鍵を付けると、デフォルト適用した上で外す際に確認が必要な必須条件になります。'}">${locked?'🔒':'🔓'}</button>`:'';
      item.innerHTML=`<div class="fp-name" title="${esc(p.name)}">${esc(p.name)}${p.uses?`<small>使用 ${p.uses}回</small>`:''}</div><div class="fp-target">${esc((p.db||'全DB')+' / '+(p.table||'全テーブル'))}</div><div class="fp-conds">${conds||'<span class="fp-cond">条件なし</span>'}</div><div class="fp-actions">${defaultToggle}${lockToggle}<button class="apply" type="button">適用</button><button class="danger" type="button">削除</button></div>`;
      item.querySelector('.apply').onclick=()=>{applyPreset(p);$('#filterPresetModal').hidden=true};
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

  // /api/table へフィルタ条件を送信する。
  if(typeof load==='function'){
    load=async function(force){
      /* **問い合わせの組み立てはWL.listQuery()に一本化してある。** この
         ファイルはload()を丸ごと置き換えるため、ここで独自に組み立てると
         list-view.js側だけ直した変更が実際には効かない(品質データ結合と
         キャッシュで2度起きた)。ここが足すのは絞り込み条件だけ。 */
      const q=WL.listQuery();
      // 変数(例: {使用設備})はここで今の値へ展開する。保存されている条件は
      // 変数のままなので、端末や設備が変わってもそのまま使い回せる。
      if(S.genericFilters?.length)q.set('filters',JSON.stringify(expandFilterList(S.genericFilters)));
      await fetchTableData(String(q),force);
      renderGrid();renderGenericFilterBar();
    };
  }
  if(typeof renderTabs==='function'){
    const baseRenderTabs=renderTabs;renderTabs=function(){baseRenderTabs();ensureGenericFilterBar();renderGenericFilterBar();};
  }
  const baseRenderGrid=typeof renderGrid==='function'?renderGrid:null;
  if(baseRenderGrid){renderGrid=function(){baseRenderGrid();renderGenericFilterBar();updateFilterSuggestions();};}

  /* ---- 公差数直線: 縦軸を左へ寄せ、測定済みの全値をスウォームプロット(蜂群図)
     で表示する。直前の値だけドット＋条番号/数値のフルラベルで大きく強調し、
     それ以外は小さな点(ツールチップに条番号/数値)としてトラック脇に並べ、
     値が近いものは重ならないよう左右にずらす。

     値→縦位置の写像はWL.toleranceScaleView(measurement-input.js)が持つ。
     ここで独自に計算すると、確定前の先読みリング(updateNumberlinePending)と
     別の式になり、リングと確定後の点が別の高さに出る。 ---- */
  const numberlineLastSeen={};
  if(typeof compactToleranceScale==='function'){
    compactToleranceScale=function(kind,values,count){
      const facts=compactToleranceFacts(kind),range=facts.range;if(!range)return facts.html;
      /* 基準値は公差カードと同じ出所(compactToleranceData)から取る。分割ロットは
         条ごとに基準値が変わるため、カードと数直線が別の値を指さないようにする。 */
      const card=typeof compactToleranceData==='function'?compactToleranceData(kind):null;
      const view=WL.toleranceScaleView({range,base:card&&card.base},values,count);
      if(!view)return facts.html;
      const {low,high,base,pct,clamp}=view;
      const upper=pct(high),lower=pct(low),basePos=pct(base);
      /* 片側公差(＋のみ／－のみ)では基準値が上限か下限と重なる。目盛りを
         2枚重ねると数字が読めなくなるので、その時は限界値のラベルへ
         「(基準)」を添えて1枚にまとめる。 */
      const span=Math.max(high-low,.000001),atHigh=Math.abs(base-high)<span*.02,atLow=Math.abs(base-low)<span*.02;
      /* 基準値との差。公差幅に対して差が小さいと点の高さの違いが数pxに
         なり「動いていない」ように見えるため、数値でも読めるようにする
         (ツールチップと、下端の現在値キャプション)。 */
      const dev=n=>{const d=n-base;return (d>0?'+':d<0?'':'')+formatTol(kind,d)};
      const last=(function(){for(let i=Math.min(values.length,count)-1;i>=0;i--){const raw=String(values[i]??'').trim(),n=Number(raw);if(raw!==''&&Number.isFinite(n))return{raw,n,index:i}}return null})();
      const dots=[];
      for(let i=0;i<Math.min(values.length,count);i++){
        if(last&&i===last.index)continue;
        const raw=String(values[i]??'').trim();if(raw==='')continue;
        const n=Number(raw);if(!Number.isFinite(n))continue;
        const p=clamp(n),ng=n<low||n>high;
        dots.push(`<i class="numberline-swarm-dot ${ng?'ng':'ok'}" style="top:${p}%" data-pos="${p}" data-idx="${i}" data-raw="${esc(raw)}" data-dev="${esc(dev(n))}" title="条${i+1}: ${esc(raw)}（基準比 ${esc(dev(n))}）"></i>`);
      }
      /* 確定した最新値(.numberline-measure)は数直線全体の再描画のたびに
         作り直されるため、単純にCSSアニメーションを付けると無関係な
         キー入力のたびにも再生されてしまう。実際に「今まさに確定した」
         回だけ着地アニメーションが鳴るよう、kindごとに直前の確定値を
         記憶して差分がある時だけクラスを付与する。 */
      const mark=last?(()=>{
        const p=clamp(last.n),ng=last.n<low||last.n>high;
        const seenKey=`${last.index}:${last.raw}`,isNew=numberlineLastSeen[kind]!==seenKey;
        numberlineLastSeen[kind]=seenKey;
        /* 点は軸の上、ラベルは右端へ寄せ、間を引出線でつなぐ。以前はラベルが
           点の真横に居座り、近い値の点(数px差)をまとめて覆い隠していた。 */
        return `<div class="numberline-measure ${ng?'ng':'ok'}${isNew?' just-landed':''}" style="top:${p}%" data-idx="${last.index}" data-raw="${esc(last.raw)}" data-dev="${esc(dev(last.n))}" title="条${last.index+1}: ${esc(last.raw)}（基準比 ${esc(dev(last.n))}）"><span class="nl-dot"></span><span class="nl-leader"></span><b><span>条${last.index+1}</span>${esc(last.raw)}</b></div>`;
      })():'';
      const tick=(cls,label,value)=>`<div class="numberline-tick ${cls}"><b><span>${label}</span>${esc(formatTol(kind,value))}</b></div>`;
      return facts.html+`<div class="accurate-numberline" data-swarm="1" style="--upper:${upper}%;--lower:${lower}%;--base:${basePos}%">
        <div class="numberline-band high"></div><div class="numberline-band ok"></div><div class="numberline-band low"></div>
        <div class="numberline-track"></div>
        ${tick('upper',atHigh?'上限(基準)':'上限',high)}
        ${atHigh||atLow?'':tick('base','基準',base)}
        ${tick('lower',atLow?'下限(基準)':'下限',low)}
        ${dots.join('')}
        ${mark}
        <div class="numberline-pending" id="numberlinePending" hidden></div>
        <div class="numberline-current-note" hidden></div>
      </div>`;
    };
  }

  /* スウォームプロットの重なり回避: top%(値)が近い点をクラスタ化し、
     クラスタ内で左右に等間隔ジグザグ配置する。実測ピクセル寸法を使うため
     DOM挿入後に実行する必要があり、renderMeasureGridVertical完了後に呼ぶ。 */
  /* スウォームの重なり回避。判定のしきい値は**点の直径以上**にする。以前は
     6pxで束ねていたが点は8px角だったため、7pxだけ離れた2点は「別クラスタ」
     と判定されて左右にずらされず、ほぼ重なったまま描かれていた。公差幅に
     対して測定値の散らばりが小さいと(例: 公差4mmに対し0.1mm刻み)これが常に
     起き、点が増えても1点しか見えず「値を変えても動かない」ように見えた。 */
  const SWARM_DOT=8,SWARM_STEP=9,SWARM_GAP=2;
  function layoutSwarmDots(){
    document.querySelectorAll?.('.accurate-numberline[data-swarm="1"]').forEach(box=>{
      const dots=[...box.querySelectorAll('.numberline-swarm-dot')];
      if(!dots.length)return;
      const h=box.clientHeight||190,w=box.clientWidth||200;
      const trackLeft=parseFloat(getComputedStyle(box).getPropertyValue('--nl-track'))||70;
      // 右端は直前値ラベルの領域。そこへ食い込むと点がラベルに隠れる。
      const maxSpread=Math.max(0,w-trackLeft-58);
      const columns=Math.max(1,Math.floor(maxSpread/SWARM_STEP)+1);
      const items=dots.map(el=>({el,y:(parseFloat(el.dataset.pos)||50)/100*h})).sort((a,b)=>a.y-b.y);
      const clusters=[];let cur=[];
      items.forEach(it=>{
        if(cur.length&&it.y-cur[cur.length-1].y>SWARM_DOT+SWARM_GAP){clusters.push(cur);cur=[]}
        cur.push(it);
      });
      if(cur.length)clusters.push(cur);
      clusters.forEach(cluster=>{
        // 束ねる判定は高さ順だが、並べるのは条の順。値の大小で左右が決まると
        // 入力した順に点が飛び、どれが何条目か追えない。
        [...cluster].sort((a,b)=>(+a.el.dataset.idx||0)-(+b.el.dataset.idx||0)).forEach((it,i)=>{
          // 列を使い切ったら先頭へ折り返す(残りを全部右端に積むと潰れるため)。
          const offset=(i%columns)*SWARM_STEP;
          it.el.style.left=`calc(var(--nl-track) + ${SWARM_STEP+offset}px)`;
        });
      });
    });
  }
  /* 入力位置(クリックしたセル)の条を数直線側でも強調する。どの点が今の条か
     分からないと、値を入れ直したときにどれが動いたのか追えない。再描画では
     なくクラスの付け替えだけで済ませる(入力のたびに走るため)。 */
  function markCurrentNumberlineDot(){
    const idx=Number(S?.measure?.settings?.wStep)||0;
    document.querySelectorAll?.('.accurate-numberline').forEach(box=>{
      let hit=null;
      box.querySelectorAll('.numberline-swarm-dot,.numberline-measure').forEach(el=>{
        const on=Number(el.dataset.idx)===idx;
        el.classList.toggle('is-current',on);
        if(on)hit=el;
      });
      const note=box.querySelector('.numberline-current-note');
      if(!note)return;
      if(hit){note.hidden=false;note.innerHTML=`<b>条${idx+1}</b> ${esc(hit.dataset.raw||'')} <small>基準比 ${esc(hit.dataset.dev||'')}</small>`}
      else{note.hidden=false;note.innerHTML=`<b>条${idx+1}</b> <small>未測定</small>`}
    });
  }
  if(typeof renderMeasureGridVertical==='function'){
    const baseRenderForSwarm=renderMeasureGridVertical;
    renderMeasureGridVertical=function(){baseRenderForSwarm();layoutSwarmDots();markCurrentNumberlineDot()};
  }
  if(typeof focusCurrent==='function'){
    /* lot-split.jsのfocusCurrentラッパーが公差側のinnerHTMLを丸ごと描き直す
       (条ごとに公差が変わる分割ロット対応)。その後に並べ直さないと、
       重なり回避で入れたleftが毎回消えて点が一直線に重なる。 */
    const baseFocusForSwarm=focusCurrent;
    focusCurrent=function(){baseFocusForSwarm();layoutSwarmDots();markCurrentNumberlineDot()};
  }

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


