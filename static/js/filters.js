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
  const USAGE_STORE='MeasurementFilterCondUsageV1';
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
     使用設備一致は、この一覧を開いた端末の設定に応じて値が変わる特殊な
     必須条件のため、専用の仕組み(f.locked==='equipment')のまま維持する。 */
  const EQUIPMENT_FILTER_COLUMN='BOX設計_設備名';
  function isLockedFilter(f){return !!f&&!!f.locked}
  function isLockedEquipmentFilter(f){return !!f&&f.locked==='equipment'}
  function lockedFilterDescription(f){return isLockedEquipmentFilter(f)?`使用設備「${f.value}」と一致するロットのみ表示`:condLabel(f)}
  function confirmRemoveLockedFilter(f){
    const target=f||S.genericFilters.find(isLockedFilter);
    if(!target)return true;
    return confirm(`この条件(${lockedFilterDescription(target)})は鍵付きの必須条件です。外すと一時的に条件が緩和されます（この一覧を開き直すと自動的に元へ戻ります）。\n本当に解除しますか？`);
  }
  function confirmRemoveAllLocked(lockedList){
    if(lockedList.length<=1)return confirmRemoveLockedFilter(lockedList[0]);
    const desc=lockedList.map(lockedFilterDescription).join('、');
    return confirm(`鍵付きの必須条件が${lockedList.length}件あります(${desc})。全解除すると一時的にこれらの条件も外れます（この一覧を開き直すと自動的に元へ戻ります）。\n本当に解除しますか？`);
  }
  /* forceInject=trueは「仕掛一覧へ新たに入った(selectTable)」時だけに使う。
     load()側はforceInjectしない(=既にある条件の値を最新の使用設備へ
     追従させるだけ)。そうしないと、ユーザーが確認の上で条件を外しても、
     直後のload()で即座に復活してしまい「一時的に外す」ことができなく
     なるため。 */
  function ensureEquipmentFilterFor(db,{forceInject=false}={}){
    if(db!=='SIKALOTNOW')return;
    const equipment=typeof currentConfiguredEquipment==='function'?currentConfiguredEquipment():'';
    if(!equipment)return;
    const already=S.genericFilters.find(isLockedEquipmentFilter);
    if(already){already.value=equipment;return}
    if(forceInject)S.genericFilters.unshift({column:EQUIPMENT_FILTER_COLUMN,op:'contains',value:equipment,locked:'equipment'});
  }

  function readLocalPresets(){try{return JSON.parse(localStorage.getItem(FILTER_STORE)||'[]')}catch(_){return []}}
  function writeLocalPresets(){try{localStorage.setItem(FILTER_STORE,JSON.stringify((S.filterPresets||[]).slice(0,120)))}catch(_){}}
  function readUsage(){try{return JSON.parse(localStorage.getItem(USAGE_STORE)||'{}')}catch(_){return {}}}
  function writeUsage(){try{localStorage.setItem(USAGE_STORE,JSON.stringify(S.filterCondUsage||{}))}catch(_){}}
  function opLabel(op){return OPS.find(x=>x[0]===op)?.[1]||op}
  function opShort(op){return (OPS.find(x=>x[0]===op)?.[1]||op).split(' ')[0]}
  function noValueOp(op){return ['empty','not_empty'].includes(op)}
  function filterKey(f){return [f.column,f.op,f.value].join('\u001f')}
  function formatTol(kind,v){return typeof fixedToleranceValue==='function'?fixedToleranceValue(kind,v):(Number.isFinite(Number(v))?String(v):'-')}
  function currentTablePresets(){return (S.filterPresets||[]).filter(p=>(!p.db||p.db===S.db)&&(!p.table||p.table===S.table))}
  function condLabel(f){return `${f.column} ${opShort(f.op)}${noValueOp(f.op)?'':' '+f.value}`}
  function bumpCondUsage(f){const k=filterKey(f);const u=S.filterCondUsage[k]||{count:0};u.count=(u.count||0)+1;u.at=Date.now();u.f={column:f.column,op:f.op,value:f.value};S.filterCondUsage[k]=u;writeUsage()}

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
      const r=await api('/api/filter-presets');
      S.filterPresets=(r.items||[]).map(x=>({id:x.id,name:x.name,db:x.db,table:x.table,filters:Array.isArray(x.filters)?x.filters:[],uses:x.uses||0,lastUsed:x.last_used,updatedAt:x.updated_at,master:true}));
      S.filterPresetSource='master';writeLocalPresets();return true;
    }catch(e){
      S.filterPresets=readLocalPresets();S.filterPresetSource='local';console.warn('フィルタマスタ読込失敗、ローカルを使用',e);return false;
    }finally{setInlineLoading(false)}
  }
  /* マスタへの保存は「今アクティブな条件の組み合わせ」を1件のプリセット
     として束ねるのではなく、条件1つずつを個別のプリセットとして登録する。
     組み合わせ単位だと再利用時に不要な条件までまとめて適用されてしまい
     使い勝手が悪いため、単一条件ずつ再利用できるようにする。 */
  async function saveCurrentFiltersToMaster(){
    const savable=S.genericFilters.filter(f=>!isLockedFilter(f));
    if(!savable.length){showToast?.('保存する条件がありません','条件を追加してから保存してください（使用設備の必須条件は保存対象外です）。',4200);return}
    if(savable.length>1&&!confirm(`現在アクティブな${savable.length}件の条件を、それぞれ個別の登録フィルタとして保存します。よろしいですか？`))return;
    if(canWait())showWaiting('フィルタをマスタへ保存しています','マスタ.accdb のフィルタプリセットマスタへ書き込み中','条件を1件ずつ登録しています');
    let saved=0,skipped=0,failed=0;
    for(const f of savable){
      const dup=(S.filterPresets||[]).some(p=>(p.filters||[]).length===1&&filterKey(p.filters[0])===filterKey(f)&&(!p.db||p.db===S.db)&&(!p.table||p.table===S.table));
      if(dup){skipped++;continue}
      const payload={name:condLabel(f).slice(0,60),db:S.db,table:S.table,filters:[f]};
      try{
        await api('/api/filter-presets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withUserId(payload))});
        saved++;
      }catch(e){
        const preset={id:crypto.randomUUID(),name:payload.name,db:S.db,table:S.table,filters:[f],updatedAt:new Date().toISOString(),master:false};
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
    if(!confirm(`登録フィルタ「${preset.name}」を削除しますか？`))return;
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
  function defaultMapKey(db,table){return `${db||''}::${table||''}`}
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
    const merged=[],seen=new Set();
    ordered.forEach(p=>{
      const locked=lockedIds.has(String(p.id));
      (p.filters||[]).forEach(f=>{
        const k=filterKey(f);
        if(!seen.has(k)){seen.add(k);merged.push(locked?{...f,locked:true}:{...f})}
      });
    });
    S.genericFilters=merged;S.page=1;
    showToast?.('デフォルトフィルタを適用しました',matches.map(p=>p.name).join(' / '),3200);
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
          <button id="filterToggle" type="button">詳細</button>
          <button id="saveFilterPreset" type="button">マスタへ保存</button>
          <button id="openFilterPresets" type="button">登録一覧</button>
          <button id="clearGenericFilters" type="button">全解除</button>
        </div>
      </div>
      <div class="filter-body" id="filterBody" hidden>
        <div class="filter-builder">
          <label>カラム<select id="filterColumn"></select></label>
          <label>比較<select id="filterOp"></select></label>
          <label>検査値<input id="filterValue" list="filterSuggestList" placeholder="値を入力/候補から選択"><datalist id="filterSuggestList"></datalist></label>
          <button id="addGenericFilter" type="button">追加</button>
        </div>
      </div>`;
    // 詳細ビルダー（段階的開示）
    $('#filterToggle').onclick=()=>{const body=$('#filterBody');body.hidden=!body.hidden;$('#filterToggle').textContent=body.hidden?'詳細':'閉じる'};
    $('#filterOp').innerHTML=OPS.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
    $('#filterColumn').onchange=updateFilterSuggestions;
    $('#filterOp').onchange=()=>{$('#filterValue').disabled=noValueOp($('#filterOp').value)};
    $('#addGenericFilter').onclick=()=>{const f={column:$('#filterColumn').value,op:$('#filterOp').value,value:$('#filterValue').value.trim()};if(!f.column)return;if(!noValueOp(f.op)&&!f.value){$('#filterValue').focus();return}addGenericFilter(f);$('#filterValue').value=''};
    $('#saveFilterPreset').onclick=saveCurrentFiltersToMaster;
    $('#openFilterPresets').onclick=openFilterPresetModal;
    $('#clearGenericFilters').onclick=()=>{
      const lockedList=S.genericFilters.filter(isLockedFilter);
      if(lockedList.length){
        if(confirmRemoveAllLocked(lockedList))S.genericFilters=[];
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
      tag.innerHTML=`${locked?'<span class="filter-tag-lock-icon" aria-hidden="true">🔒</span>':''}<span>${esc(f.column)}</span><b>${esc(opShort(f.op))}</b>${noValueOp(f.op)?'':`<em>${esc(f.value)}</em>`}<i data-filter-index="${i}" title="解除">×</i>`;
      tag.querySelector('i').onclick=e=>{
        e.stopPropagation();
        if(locked&&!confirmRemoveLockedFilter(f))return;
        S.genericFilters.splice(i,1);S.page=1;renderGenericFilterBar();load();
      };
      box.insertBefore(tag,input);
    });
    const count=$('#filterCount');if(count)count.textContent=`${S.genericFilters.length}件`;
  }
  function renderGenericFilterBar(){
    ensureGenericFilterBar();updateFilterColumns();renderActiveTokens();
  }

  /* ---- サジェスト（再認・チャンク化・頻度順） ---- */
  function frequentConditions(){
    // 保存フィルタの条件＋利用履歴を統合し、頻度×新しさで並べる。
    const map=new Map();
    currentTablePresets().forEach(p=>(p.filters||[]).forEach(f=>{const k=filterKey(f);const e=map.get(k)||{f,count:0,at:0};e.count+=Math.max(1,p.uses||1);map.set(k,e)}));
    Object.values(S.filterCondUsage||{}).forEach(u=>{if(!u.f)return;const k=filterKey(u.f);const e=map.get(k)||{f:u.f,count:0,at:0};e.count+=(u.count||0)*2;e.at=Math.max(e.at,u.at||0);map.set(k,e)});
    const active=new Set(S.genericFilters.map(filterKey));
    return [...map.values()].filter(e=>!active.has(filterKey(e.f))).sort((a,b)=>b.count-a.count||b.at-a.at).map(e=>e.f);
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
    if(!groups.length){box.innerHTML=`<div class="filter-suggest-empty">${q?`「${esc(q)}」に一致する候補はありません。詳細から条件を作成できます。`:'保存フィルタや利用履歴がここに提案されます。'}</div>`;box.hidden=false;return}
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
    box.hidden=false;
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
    input.addEventListener('keydown',e=>{
      if(e.key==='ArrowDown'){e.preventDefault();moveSuggest(1)}
      else if(e.key==='ArrowUp'){e.preventDefault();moveSuggest(-1)}
      else if(e.key==='Enter'){e.preventDefault();(suggestFlat[suggestIndex]||suggestFlat[0])?.click()}
      else if(e.key==='Escape'){suggest.hidden=true}
      else if(e.key==='Backspace'&&!input.value&&S.genericFilters.length){
        const last=S.genericFilters[S.genericFilters.length-1];
        if(isLockedFilter(last)&&!confirmRemoveLockedFilter(last))return;
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
    return modal;
  }
  async function openFilterPresetModal(){
    ensureFilterPresetModal();$('#filterPresetModal').hidden=false;
    const list=$('#filterPresetList');list.innerHTML='';setPanelLoading(list,true,'登録フィルタを読み込んでいます...');
    await loadMasterPresets({inline:false});setPanelLoading(list,false);renderFilterPresetList();renderGenericFilterBar();
  }
  function renderFilterPresetList(){
    const list=$('#filterPresetList');if(!list)return;
    const all=S.filterPresets||[],forThis=currentTablePresets();
    const summary=$('#filterPresetSummary');
    if(summary)summary.textContent=`保存先: ${S.filterPresetSource==='master'?'マスタ.accdb':'この端末（マスタ未接続）'}　全 ${all.length}件（現在の一覧向け ${forThis.length}件）`;
    const ordered=[...forThis,...all.filter(p=>!forThis.includes(p))];
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
      item.querySelector('.fp-default-check')?.addEventListener('change',e=>{
        // 鍵付きのままデフォルトを外すと固定フィルタの意味が失われるため、
        // 鍵が付いている場合は確認の上でデフォルトと鍵を同時に外す。
        if(!e.target.checked&&isLockedDefaultPreset(p,S.db,S.table)){
          if(!confirm(`このフィルタ「${p.name}」は鍵付きの必須条件です。デフォルトを外すと鍵も一緒に解除されます。\n本当によろしいですか？`)){e.target.checked=true;return}
          setLockedDefaultPreset(p,S.db,S.table,false);
        }
        toggleDefaultPreset(p,S.db,S.table);
        renderFilterPresetList();
      });
      item.querySelector('.fp-lock-btn')?.addEventListener('click',()=>{
        const nowLocked=!isLockedDefaultPreset(p,S.db,S.table);
        setLockedDefaultPreset(p,S.db,S.table,nowLocked);
        if(nowLocked&&!isDefaultPreset(p,S.db,S.table))setDefaultPreset(p,S.db,S.table,true);
        renderFilterPresetList();
      });
      if(loading)list.insertBefore(item,loading);else list.appendChild(item);
    });
  }

  // /api/table へフィルタ条件を送信する。
  if(typeof load==='function'){
    load=async function(){
      ensureEquipmentFilterFor(S.db);
      const q=new URLSearchParams({db:S.db,table:S.table,page:S.page,page_size:$('#pageSize').value,search:$('#search').value});
      if(S.genericFilters?.length)q.set('filters',JSON.stringify(S.genericFilters));
      if(S.sortColumn){q.set('sort',S.sortColumn);q.set('sort_dir',S.sortDir||'asc')}
      const d=await api('/api/table?'+q);Object.assign(S,{columns:d.columns,rows:d.rows,count:d.count});
      const info=S.catalog.find(x=>x.key===S.db)||{};$('#fileName').textContent=info.file_name||'';renderGrid();renderGenericFilterBar();
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
     値が近いものは重ならないよう左右にずらす。 ---- */
  if(typeof compactToleranceScale==='function'){
    compactToleranceScale=function(kind,values,count){
      const facts=compactToleranceFacts(kind),range=facts.range;if(!range)return facts.html;
      const low=Number(range[0]),high=Number(range[1]),span=Math.max(high-low,.000001);
      const viewLow=low-span*.25,viewHigh=high+span*.25;
      const pct=v=>Math.max(0,Math.min(100,(viewHigh-v)/(viewHigh-viewLow)*100));
      const upper=pct(high),lower=pct(low),center=pct((low+high)/2);
      const last=(function(){for(let i=Math.min(values.length,count)-1;i>=0;i--){const raw=String(values[i]??'').trim(),n=Number(raw);if(raw!==''&&Number.isFinite(n))return{raw,n,index:i}}return null})();
      const dots=[];
      for(let i=0;i<Math.min(values.length,count);i++){
        if(last&&i===last.index)continue;
        const raw=String(values[i]??'').trim();if(raw==='')continue;
        const n=Number(raw);if(!Number.isFinite(n))continue;
        const p=Math.max(5,Math.min(95,pct(n))),ng=n<low||n>high;
        dots.push(`<i class="numberline-swarm-dot ${ng?'ng':'ok'}" style="top:${p}%" data-pos="${p}" title="条${i+1}: ${esc(raw)}"></i>`);
      }
      const mark=last?(()=>{const p=Math.max(5,Math.min(95,pct(last.n))),ng=last.n<low||last.n>high;return `<div class="numberline-measure ${ng?'ng':'ok'}" style="top:${p}%"><span class="nl-dot"></span><b><span>条${last.index+1}</span>${esc(last.raw)}</b></div>`})():'';
      return facts.html+`<div class="accurate-numberline" data-swarm="1" style="--upper:${upper}%;--lower:${lower}%;--center:${center}%">
        <div class="numberline-band high"></div><div class="numberline-band ok"></div><div class="numberline-band low"></div>
        <div class="numberline-track"></div>
        <div class="numberline-tick upper"><b><span>上限</span>${esc(formatTol(kind,high))}</b></div>
        <div class="numberline-tick center"><b><span>中央</span>${esc(formatTol(kind,(low+high)/2))}</b></div>
        <div class="numberline-tick lower"><b><span>下限</span>${esc(formatTol(kind,low))}</b></div>
        ${dots.join('')}
        ${mark}
      </div>`;
    };
  }

  /* スウォームプロットの重なり回避: top%(値)が近い点をクラスタ化し、
     クラスタ内で左右に等間隔ジグザグ配置する。実測ピクセル寸法を使うため
     DOM挿入後に実行する必要があり、renderMeasureGridVertical完了後に呼ぶ。 */
  function layoutSwarmDots(){
    document.querySelectorAll?.('.accurate-numberline[data-swarm="1"]').forEach(box=>{
      const dots=[...box.querySelectorAll('.numberline-swarm-dot')];
      if(dots.length<2)return;
      const h=box.clientHeight||190,w=box.clientWidth||200,step=7;
      const trackLeft=parseFloat(getComputedStyle(box).getPropertyValue('--nl-track'))||70;
      const maxSpread=Math.max(0,w-trackLeft-14);
      const items=dots.map(el=>({el,y:(parseFloat(el.dataset.pos)||50)/100*h})).sort((a,b)=>a.y-b.y);
      const clusters=[];let cur=[];
      items.forEach(it=>{
        if(cur.length&&it.y-cur[cur.length-1].y>6){clusters.push(cur);cur=[]}
        cur.push(it);
      });
      if(cur.length)clusters.push(cur);
      clusters.forEach(cluster=>{
        const n=cluster.length;
        cluster.forEach((it,i)=>{
          const offset=Math.max(0,Math.min(maxSpread,i*step));
          it.el.style.left=`calc(var(--nl-track) + ${offset}px)`;
        });
      });
    });
  }
  if(typeof renderMeasureGridVertical==='function'){
    const baseRenderForSwarm=renderMeasureGridVertical;
    renderMeasureGridVertical=function(){baseRenderForSwarm();layoutSwarmDots()};
  }

  // 一覧を開くたび（テーブル切替時）にデフォルトフィルタを自動適用する。
  // 仕掛一覧(SIKALOTNOW)では、デフォルトフィルタの後に使用設備の必須条件を
  // 注入する(デフォルトフィルタが全置換しても、必ずこの条件が残るように)。
  if(typeof selectTable==='function'){
    const selectTableDefaultFilterBase=selectTable;
    selectTable=async function(t){applyDefaultFiltersFor(S.db,t);ensureEquipmentFilterFor(S.db,{forceInject:true});return selectTableDefaultFilterBase(t)};
  }

  // 起動時: バー生成 → マスタからサジェスト材料を先読み（ローディング表示つき）。
  queueMicrotask(async()=>{ensureGenericFilterBar();renderGenericFilterBar();try{await loadMasterPresets();renderGenericFilterBar()}catch(_){}});
})();


