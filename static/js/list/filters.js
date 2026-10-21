"use strict";
/* ============================================================
   filters.js: 一覧の絞り込み（§9.614 でゼロから作り直した）

   利用者の指示「フィルタのボタン幅が無駄に大きく、表示のみになって使えないボタンがある。登録したフィルタの
   再編集もできないため、使えない。EXCELのような重複のない項目からチェックするだけで使えるフィルタも欲しい。
   登録内容からのプリセットへの組み立てもわかりづらいので完全にゼロからフィルタ機能をデザインも機能も作り直して」。
   形は5案×3回の採点で O（80点）——帯は「フィルタ 名前 ▾｜変更あり｜上書き保存｜別名で保存｜戻す」、
   2段目（件数の段）に効いている条件の札、変えた条件は札そのものが「足した／変えた／外した」と言う。

   **持ち方は1つ**: 効いている条件（`S.genericFilters`＝{column,op,value,locked?}）と、名前を付けた
   **保存したフィルタ**（名前＋条件の並び・`フィルタプリセットマスタ`の1行）。前の「登録した条件 → 組み合わせ」
   の2層は持たない（前の組み合わせはサーバーが条件へ展開して返す）。
     ・条件を作る道は**列の値の一覧**（見出しの ▼／札を押す／＋ 条件）の1つ。Excel と同じく値にチェックし、
       値ではなく条件（含む・以上…）でも絞れる。
     ・保存したフィルタは**いつでも直せる**（名前・条件・見える人・いつも適用）。
     ・選んだ保存したフィルタから変えたら「変更あり」→ 上書き保存／別名で保存／戻す。
   引き継いだ約束（中身は前のまま）: 当てている条件は端末に覚える（§9.175）、いつも適用（§9.190）、
   自分だけ／みんな（§9.172）、場面ごとの置き場と「仕掛一覧と同じ」（§9.80・§9.184・§9.612）、
   変数 {使用設備}（§9.74）、書き出し・取り込み（§9.171）。
   ============================================================ */
(function(){
  if(typeof $!=='function')return;
  window.WL=window.WL||{};
  const FILTER_STORE='MeasurementGenericFilterPresetsV1';   // マスタへ書けなかった保存の控え（この端末だけ）
  /* ---------- 比べ方の語彙（サーバーの`_build_filter_where`と同じ）。記号を見せない（採点の指摘・⊃）。 ---------- */
  const OPS=[
    ['contains','含む'],['not_contains','含まない'],['eq','＝ 一致'],['neq','≠ 不一致'],
    ['starts','前方一致'],['ends','後方一致'],['gt','> より大きい'],['gte','>= 以上'],['lt','< より小さい'],['lte','<= 以下'],['empty','空欄'],['not_empty','空欄以外']
  ];
  const SET_OPS=['in','not_in'];   // 値の一覧で選ぶ（どれかと同じ／どれか以外）
  const BLANK='（空欄）';
  function opLabel(op){return op==='in'?'どれかと同じ':op==='not_in'?'どれか以外':(OPS.find(x=>x[0]===op)?.[1]||op)}
  function noValueOp(op){return ['empty','not_empty'].includes(op)}
  WL.filterOps={OPS,opLabel,noValueOp};   // 色付けの条件も同じ比べ方（list-marks.js）
  const isSet=f=>!!f&&SET_OPS.includes(f.op);
  const setVals=f=>(Array.isArray(f&&f.value)?f.value:[]).map(String);

  /* ---------- 利用者（§9.172）。IDは後から届くので**呼ぶたびに引く**。 ---------- */
  function filterUserId(){return typeof currentUserId==='function'?currentUserId():''}
  function filterUserLabel(){return filterUserId()||'（利用者IDが分かりません）'}
  S.genericFilters=Array.isArray(S.genericFilters)?S.genericFilters:[];
  S.filterPresets=readLocalPresets();
  S.filterPresetSource='local';

  /* ---------- 変数（§9.74）。保存は変数のまま、**送る直前に**今の値へ ---------- */
  const FILTER_VARS=[
    {token:'{使用設備}',label:'使用設備',hint:'この端末に登録している使用設備の名前に置き換わります',
     resolve:()=>(typeof currentConfiguredEquipment==='function'?currentConfiguredEquipment():'')||''},
  ];
  function filterVarFor(value){
    const vs=Array.isArray(value)?value.map(String):[String(value??'')];
    return FILTER_VARS.find(x=>vs.some(v=>v.includes(x.token)))||null;
  }
  /* 未設定なら空にする（トークンのまま送ると「{使用設備}」という字で探して0件になり、未設定と見分けられない）。 */
  function expandFilterVars(value){
    let out=String(value??'');
    FILTER_VARS.forEach(v=>{if(out.includes(v.token))out=out.split(v.token).join(v.resolve())});
    return out;
  }
  function expandFilterList(list){
    return (list||[]).map(f=>{
      if(!filterVarFor(f.value))return {column:f.column,op:f.op,value:f.value};
      return {column:f.column,op:f.op,value:Array.isArray(f.value)?f.value.map(expandFilterVars):expandFilterVars(f.value)};
    });
  }
  WL.expandFilterVars=expandFilterVars;

  /* ---------- 条件の鍵と言い方 ---------- */
  function filterKey(f){
    const v=isSet(f)?JSON.stringify(setVals(f).slice().sort()):String(f.value??'');
    return [f.column,f.op,v].join('\u001f');
  }
  const layoutTarget=()=>(WL.list&&typeof WL.list.listLayoutTarget==='function')?WL.list.listLayoutTarget():'';
  function colLabel(c){const t=layoutTarget();return t&&WL.columnLayout?WL.columnLayout.label(t,c)||c:c}
  const valWord=v=>v===''?BLANK:v;
  /* 値の言い方（札・一覧の要約・0件の案内が同じ字を読む）。**記号ではなく字で**言う。 */
  function condValueText(f,{max=3}={}){
    if(isSet(f)){
      const vs=setVals(f).map(valWord);
      const shown=vs.slice(0,max).join('・')+(vs.length>max?` ほか${vs.length-max}`:'');
      return f.op==='in'?shown:`${shown} 以外`;
    }
    const v=String(f.value??''),now=filterVarFor(v)?expandFilterVars(v):null;
    const val=now===null?v:`${v}（=${now||'未設定'}）`;
    return {contains:`「${val}」を含む`,not_contains:`「${val}」を含まない`,eq:`「${val}」と一致`,neq:`「${val}」以外`,
            starts:`「${val}」で始まる`,ends:`「${val}」で終わる`,gt:`${val} より大きい`,gte:`${val} 以上`,
            lt:`${val} より小さい`,lte:`${val} 以下`,empty:'空欄',not_empty:'空欄以外'}[f.op]||`${opLabel(f.op)} ${val}`;
  }
  function condLabel(f){return `${colLabel(f.column)}: ${condValueText(f)}`}
  const isLockedFilter=f=>!!f&&!!f.locked;

  /* ============================================================
     場面と覚え（§9.80・§9.175・§9.184・§9.612）——前の作りのまま
     ============================================================ */
  const LINK_KEY='wl.filterLink.v1';
  const linkScope=()=>`${S.db||''}\u001f${S.table||''}`;
  function linkStore(){try{const x=JSON.parse(localStorage.getItem(LINK_KEY)||'{}');return x&&typeof x==='object'?x:{}}
    catch(e){WL.quiet.note('条件のつなぎを読めない（つながないで続ける）',e);return {}}}
  function filterLinked(){return (linkStore()[filterUserId()]||{})[linkScope()]===true}
  function setFilterLinked(on){
    const all=linkStore(),u=all[filterUserId()]=all[filterUserId()]||{};
    if(on)u[linkScope()]=true;else delete u[linkScope()];
    try{localStorage.setItem(LINK_KEY,JSON.stringify(all))}catch(e){WL.quiet.note('条件のつなぎを書けない（この画面のあいだだけ効く）',e)}
    syncFilterContext();renderBar();S.page=1;WL.list.load();
  }
  const inScheduleList=()=>document.body.classList.contains('sc-mode');
  /* 置き場の答えは1箇所（スケジュールの中の一覧で、つないでいないときだけ別の置き場）。 */
  function presetMode(){return inScheduleList()&&!filterLinked()?'schedule':''}
  const SCENE_LABEL={'schedule':'スケジュール作成中の仕掛一覧','':'「元データ」の一覧'};
  function sceneLabel(){return SCENE_LABEL[presetMode()]||'この一覧'}
  function mapKeyOf(db,table,mode){return `${db||''}::${table||''}::${mode||''}`}
  function defaultMapKey(db,table){return mapKeyOf(db,table,presetMode())}

  /* ---- 当てている条件は**端末に覚える**（利用者ごと×一覧ごと・§9.175）。いつも適用の条件は覚えない（毎回導く）。 ---- */
  const ACTIVE_STORE='MeasurementFilterActiveV1',ACTIVE_MAX_CONTEXTS=80;
  let activeAll=(()=>{try{const m=JSON.parse(localStorage.getItem(ACTIVE_STORE)||'{}');return (m&&typeof m==='object')?m:{}}catch(_){return {}}})();
  function activeBucket(who){
    const uid=who==null?filterUserId():who;
    if(!activeAll[uid]||typeof activeAll[uid]!=='object')activeAll[uid]={};
    return activeAll[uid];
  }
  function writeActiveAll(){try{localStorage.setItem(ACTIVE_STORE,JSON.stringify(activeAll))}catch(_){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',_)}}
  let activeFilterContextKey=null,activeFilterUid=null,defaultsAppliedFor=null;
  function saveActiveFilterState(who){
    if(activeFilterContextKey==null)return;
    const keep=S.genericFilters.filter(f=>!isLockedFilter(f)).map(f=>({...f}));
    const bucket=activeBucket(who);
    if(keep.length)bucket[activeFilterContextKey]=keep;else delete bucket[activeFilterContextKey];
    const keys=Object.keys(bucket);
    if(keys.length>ACTIVE_MAX_CONTEXTS)keys.slice(0,keys.length-ACTIVE_MAX_CONTEXTS).forEach(k=>{if(k!==activeFilterContextKey)delete bucket[k]});
    writeActiveAll();
  }
  function restoreActiveFilterState(key){return (activeBucket()[key]||[]).map(f=>({...f}))}
  /* 一覧を引く前に必ずここを通る（`listHooks.onQuery`）。覚えの入れ替えと、いつも適用の当て直し（§9.184）。 */
  function syncFilterContext(){
    if(!S.db||!S.table)return false;
    const key=defaultMapKey(S.db,S.table),uid=filterUserId();
    if(key!==activeFilterContextKey||uid!==activeFilterUid){
      if(activeFilterContextKey!=null)saveActiveFilterState(activeFilterUid);
      S.genericFilters=restoreActiveFilterState(key);
      activeFilterContextKey=key;activeFilterUid=uid;defaultsAppliedFor=null;
    }
    if(defaultsAppliedFor===key)return false;
    if(!presetsReady(S.db,S.table)){ensurePresetsFor(S.db,S.table).then(()=>{reapplyDefaultFilters()});return false}
    const added=applyDefaultFiltersFor(S.db,S.table);
    defaultsAppliedFor=key;
    return added>0;
  }
  function reapplyDefaultFilters(){
    if(!syncFilterContext())return false;
    renderBar();if(typeof WL.list.load==='function')WL.list.load();
    return true;
  }

  /* ============================================================
     保存したフィルタ（マスタ）
     ============================================================ */
  function readLocalPresets(){try{return JSON.parse(localStorage.getItem(FILTER_STORE)||'[]')}catch(_){return []}}
  function writeLocalPresets(){try{localStorage.setItem(FILTER_STORE,JSON.stringify((S.filterPresets||[]).slice(0,120)))}catch(_){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',_)}}
  const jpost=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withUserId(body))});
  let presetsLoadedFor=null,presetsLoading=null;
  const presetsKeyFor=(db,table)=>`${mapKeyOf(db,table,presetMode())}\u001f${filterUserId()}`;
  const presetsReady=(db,table)=>presetsLoadedFor===presetsKeyFor(db,table);
  async function ensurePresetsFor(db,table){
    const key=presetsKeyFor(db,table);
    if(presetsLoadedFor===key)return;
    if(presetsLoading&&presetsLoading.key===key)return presetsLoading.p;
    const p=loadMasterPresets({db,table}).catch(WL.quiet('読めなければ次の機会に取り直す'))
      .finally(()=>{if(presetsLoading&&presetsLoading.key===key)presetsLoading=null});
    presetsLoading={key,p};
    return p;
  }
  async function loadMasterPresets(opts={}){
    const db=opts.db!=null?opts.db:S.db,table=opts.table!=null?opts.table:S.table;
    try{
      const q=new URLSearchParams();if(db)q.set('db',db);if(table)q.set('table',table);
      q.set('mode',presetMode());q.set('user',filterUserId());
      const r=await api('/api/filter-presets?'+q);
      /* 前の組み合わせ（メンバーの行）はサーバーが条件へ展開して返す（§9.614）。画面は「名前＋条件」だけを読む。 */
      const fromMaster=(r.items||[]).map(x=>({id:x.id,name:x.name,db:x.db,table:x.table,mode:x.mode||'',
        filters:Array.isArray(x.filters)?x.filters:[],uses:x.uses||0,updatedAt:x.updated_at,master:true,
        owner:x.owner||'',mine:!!x.mine,shared:!!x.shared,isDefault:!!x.isDefault,isLocked:!!x.isLocked}))
        .filter(x=>x.filters.length);
      await migrateLegacyMarks(fromMaster,!!r.hasPersonalMarks);
      absorbServerMarks(fromMaster,db,table,presetMode());
      /* マスタへ書けなかった控えは捨てない（「保存したのに出ない」にしない）。 */
      const localOnly=(S.filterPresets||[]).filter(pz=>!pz.master);
      S.filterPresets=[...localOnly,...fromMaster];
      presetsLoadedFor=presetsKeyFor(db,table);
      S.filterPresetSource='master';writeLocalPresets();return true;
    }catch(e){
      S.filterPresets=readLocalPresets();S.filterPresetSource='local';console.warn('フィルタマスタ読込失敗、ローカルを使用',e);return false;
    }
  }
  /* いまの一覧の保存したフィルタ（db・table・場面が完全に一致するもの）。 */
  function currentPresets(){
    return (S.filterPresets||[]).filter(p=>p.db===S.db&&p.table===S.table&&(p.mode||'')===presetMode()&&(p.filters||[]).length);
  }
  const presetById=id=>id==null?null:currentPresets().find(p=>String(p.id)===String(id))||null;

  /* ---------- 印（いつも適用＝既定＋鍵の2つへそろえて書く・§9.172・§9.190） ---------- */
  const DEFAULT_STORE='MeasurementDefaultFilterPresetsV1';
  const LOCKED_DEFAULT_STORE='MeasurementLockedDefaultFilterPresetsV1';
  const MARK_MIRROR='MeasurementFilterMarksV2';
  const MARK_MIGRATED='MeasurementFilterMarksMigratedV1';
  let markMaps=null,markMapsUid=null;
  function readMarkMirror(){
    try{const all=JSON.parse(localStorage.getItem(MARK_MIRROR)||'{}');const mine=all[filterUserId()];
        if(mine&&typeof mine==='object')return {def:mine.def||{},lock:mine.lock||{}}}
    catch(_){WL.quiet.note('端末の覚えが読めない（既定で続ける）',_)}
    return null;
  }
  function writeMarkMirror(){
    try{const all=JSON.parse(localStorage.getItem(MARK_MIRROR)||'{}');all[filterUserId()]={def:markMaps.def,lock:markMaps.lock};
        localStorage.setItem(MARK_MIRROR,JSON.stringify(all))}
    catch(_){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',_)}
  }
  function legacyMarkMaps(){
    const read=k=>{try{const m=JSON.parse(localStorage.getItem(k)||'{}');return (m&&typeof m==='object')?m:{}}catch(_){return {}}};
    return {def:read(DEFAULT_STORE),lock:read(LOCKED_DEFAULT_STORE)};
  }
  /* 利用者IDが変わったら読み直す（§9.190。空のIDの写しを本人の置き場へ書き戻さない）。 */
  function ensureMarkMaps(){
    const uid=filterUserId();
    if(markMaps&&markMapsUid===uid)return markMaps;
    markMaps=readMarkMirror()||legacyMarkMaps();markMapsUid=uid;
    return markMaps;
  }
  const idsAt=(map,key)=>(map[key]||[]).map(String);
  function alwaysOnIdsFor(db,table){
    const m=ensureMarkMaps(),key=defaultMapKey(db,table);
    return [...new Set([...idsAt(m.def,key),...idsAt(m.lock,key)])];
  }
  function isAlwaysOnPreset(p,db=S.db,table=S.table){return !!p&&alwaysOnIdsFor(db,table).includes(String(p.id))}
  function pushMark(presetId,db,table,mode){
    if(presetId==null)return Promise.resolve(true);
    const key=mapKeyOf(db,table,mode),m=ensureMarkMaps(),has=map=>idsAt(map,key).includes(String(presetId));
    return jpost('/api/filter-presets/marks',{user:filterUserId(),id:presetId,isDefault:has(m.def),isLocked:has(m.lock)})
      .then(()=>true).catch(e=>{
        /* 黙って画面だけ変えない（§9.190）。 */
        console.warn('フィルタの印を保存できませんでした',e);
        showToast?.('「いつも適用」を保存できませんでした',`${e.message||'マスタへ届きませんでした'}\n付け外しは前のままに戻しました。`,8000);
        return false;
      });
  }
  /* 印を付け外しする唯一の入口。保存できなければ元へ戻す。 */
  async function setAlwaysOnPreset(p,on){
    const m=ensureMarkMaps(),key=defaultMapKey(S.db,S.table),was=isAlwaysOnPreset(p);
    const put=v=>['def','lock'].forEach(k=>{const s=new Set(idsAt(m[k],key));v?s.add(String(p.id)):s.delete(String(p.id));m[k][key]=[...s]});
    put(on);writeMarkMirror();p.isDefault=p.isLocked=on;
    const ok=await pushMark(p.id,S.db,S.table,presetMode());
    if(!ok&&was!==on){put(was);writeMarkMirror();p.isDefault=p.isLocked=was}
    return ok;
  }
  function absorbServerMarks(items,db,table,mode){
    const maps=ensureMarkMaps(),key=mapKeyOf(db,table,mode);
    const def=new Set(idsAt(maps.def,key)),lock=new Set(idsAt(maps.lock,key));
    (items||[]).forEach(x=>{const id=String(x.id);x.isDefault?def.add(id):def.delete(id);x.isLocked?lock.add(id):lock.delete(id)});
    maps.def[key]=[...def];maps.lock[key]=[...lock];writeMarkMirror();
  }
  /* 端末ごとの古い印（V1）を一度だけその人の印としてマスタへ移す（§9.172）。 */
  async function migrateLegacyMarks(items,serverHasMarks){
    let done={};
    try{done=JSON.parse(localStorage.getItem(MARK_MIGRATED)||'{}')}catch(_){WL.quiet.note('端末の覚えが読めない（既定で続ける）',_)}
    const uid=filterUserId();
    if(done[uid]||serverHasMarks)return false;
    const legacy=legacyMarkMaps(),ids=new Map();
    const collect=(maps,field)=>Object.values(maps||{}).forEach(list=>(list||[]).forEach(id=>{
      const k=String(id);const cur=ids.get(k)||{isDefault:false,isLocked:false};cur[field]=true;ids.set(k,cur)}));
    collect(legacy.def,'isDefault');collect(legacy.lock,'isLocked');
    if(ids.size){
      try{
        await jpost('/api/filter-presets/marks',{user:uid,items:[...ids].map(([id,m])=>({id,isDefault:m.isDefault,isLocked:m.isLocked}))});
        (items||[]).forEach(x=>{const m=ids.get(String(x.id));if(m){x.isDefault=m.isDefault;x.isLocked=m.isLocked}});
      }catch(_){return false}
    }
    done[uid]=new Date().toISOString();
    try{localStorage.setItem(MARK_MIGRATED,JSON.stringify(done))}catch(_){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',_)}
    return ids.size>0;
  }
  /* いつも適用の条件を**固定**で重ねる（手で足した条件は残す・§9.184）。戻り値は足した数。 */
  function applyDefaultFiltersFor(db,table){
    const ids=new Set(alwaysOnIdsFor(db,table));if(!ids.size)return 0;
    const matches=(S.filterPresets||[]).filter(p=>ids.has(String(p.id)));
    if(!matches.length)return 0;
    let added=0;
    matches.forEach(p=>(p.filters||[]).forEach(f=>{
      const k=filterKey(f),i=S.genericFilters.findIndex(x=>filterKey(x)===k);
      if(i<0){S.genericFilters.push({...f,locked:true});added++}
      else if(!S.genericFilters[i].locked)S.genericFilters[i]={...S.genericFilters[i],locked:true};
    }));
    S.page=1;
    if(added)showToast?.('いつも適用する条件を入れました',matches.map(p=>p.name).join(' / ')+`（${sceneLabel()}）`,3200);
    return added;
  }
  /* 鍵付きの条件を外すときは確かめる（外しても開き直すと戻る）。 */
  async function confirmRemoveLocked(list){
    if(!list.length)return true;
    return confirmModal({title:'いつも適用の条件を外しますか',confirmLabel:'外す',
      message:`${list.map(condLabel).join('、')} は「いつも適用」の条件です。いま外すと、この一覧を開き直すまで条件が緩みます。`});
  }

  /* ============================================================
     いま選んでいる保存したフィルタと、そこからの差分
     ============================================================ */
  const SEL_STORE='wl.filterSaved.v1';      // {利用者:{一覧の鍵: 保存したフィルタのID}}
  const SEL_STORE_V2='MeasurementFilterPresetV2';   // 前の版（'p:ID'／'c:ID'）。読み替えて1度だけ移す
  let selAll=(()=>{
    let m={};try{m=JSON.parse(localStorage.getItem(SEL_STORE)||'{}')}catch(_){m={}}
    if(!m||typeof m!=='object')m={};
    if(!Object.keys(m).length){
      try{const old=JSON.parse(localStorage.getItem(SEL_STORE_V2)||'{}');
          Object.entries(old||{}).forEach(([u,b])=>{m[u]={};Object.entries(b||{}).forEach(([k,v])=>{const id=String(v||'').replace(/^[pc]:/,'');if(id)m[u][k]=id})})}
      catch(_){WL.quiet.note('前の版の選択を読めない（選ばない状態で続ける）',_)}
    }
    return m;
  })();
  function writeSel(){try{localStorage.setItem(SEL_STORE,JSON.stringify(selAll))}catch(_){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',_)}}
  function selectedPreset(){
    const b=selAll[filterUserId()]||{};
    return presetById(b[defaultMapKey(S.db,S.table)]);
  }
  function setSelected(p){
    const u=filterUserId(),b=selAll[u]=selAll[u]||{},k=defaultMapKey(S.db,S.table);
    if(p)b[k]=String(p.id);else delete b[k];
    writeSel();
  }
  /* 差分（札の「足した／変えた／外した」と「変更あり」が同じ答えを読む）。いつも適用の条件は比べない。 */
  function diffState(){
    const sel=selectedPreset();
    const cur=S.genericFilters.filter(f=>!isLockedFilter(f)||(sel&&(sel.filters||[]).some(x=>filterKey(x)===filterKey(f))&&isAlwaysOnPreset(sel)));
    if(!sel)return {sel:null,added:new Set(),changed:new Set(),removed:[],dirty:false,cur};
    const base=sel.filters||[],baseKeys=new Set(base.map(filterKey)),curKeys=new Set(cur.map(filterKey));
    const added=new Set(),changed=new Set();
    const removed=base.filter(f=>!curKeys.has(filterKey(f)));
    cur.forEach(f=>{
      const k=filterKey(f);if(baseKeys.has(k))return;
      const i=removed.findIndex(r=>r.column===f.column);
      if(i>=0){changed.add(k);removed.splice(i,1)}else added.add(k);
    });
    return {sel,added,changed,removed,dirty:!!(added.size||changed.size||removed.length),cur};
  }

  /* ============================================================
     操作
     ============================================================ */
  function afterChange(){S.page=1;renderBar();WL.list.load()}
  /* 保存したフィルタへ切り替える（前に選んでいた保存の条件を外し、選んだ保存の条件を入れる・手で足した条件といつも適用は残す）。 */
  function selectSaved(p){
    const prev=selectedPreset();
    if(prev){
      const keys=new Set((prev.filters||[]).map(filterKey));
      S.genericFilters=S.genericFilters.filter(f=>isLockedFilter(f)||!keys.has(filterKey(f)));
    }
    if(p){
      const have=new Set(S.genericFilters.map(filterKey));
      (p.filters||[]).forEach(f=>{if(!have.has(filterKey(f))){S.genericFilters.push(structuredClone(f));have.add(filterKey(f))}});
      if(p.master&&p.id!=null)jpost('/api/filter-presets/use',{id:p.id}).catch(WL.quiet('使用回数を送れない（並びが変わらないだけ）'));
    }
    setSelected(p);afterChange();
  }
  /* 「すべて（条件なし）」——鍵の無い条件を全部外し、選択も外す。 */
  function selectNone(){
    S.genericFilters=S.genericFilters.filter(isLockedFilter);
    setSelected(null);afterChange();
  }
  /* 保存する条件（いつも適用で入った固定の条件は、その保存自身の物でなければ入れない）。 */
  function conditionsToSave(sel){
    const own=new Set(((sel&&sel.filters)||[]).map(filterKey));
    return S.genericFilters.filter(f=>!isLockedFilter(f)||own.has(filterKey(f))).map(({locked:_l,...f})=>f);
  }
  async function overwriteSaved(){
    const d=diffState();if(!d.sel)return;
    const filters=conditionsToSave(d.sel);
    if(!filters.length){showToast?.('条件が1つもありません','すべて外した保存したフィルタは、✎ 直す から削除できます。',6000);return}
    if(!d.sel.master){d.sel.filters=filters;writeLocalPresets();renderBar();return}
    try{
      await jpost('/api/filter-presets/update',{id:d.sel.id,filters,user:filterUserId()});
      d.sel.filters=filters;
      showToast?.('上書き保存しました',`「${d.sel.name}」＝ ${filters.map(condLabel).join(' ／ ')}`,4200);
      await loadMasterPresets();renderBar();
    }catch(e){showToast?.('上書き保存できませんでした',e.message,7000)}
  }
  /* 名前を付けて保存（同じ名前は黙って上書きしない＝サーバーが409で断る・§9.614）。 */
  async function saveAsNew(){
    const sel=selectedPreset(),filters=conditionsToSave(sel);
    if(!filters.length){showToast?.('保存する条件がありません','列の見出しの ▼ や「＋ 条件」で条件を入れてから保存します。',5000);return}
    let seed=sel?`${sel.name}（2）`:filters.slice(0,2).map(condLabel).join(' ／ ').slice(0,40),err='';
    for(;;){
      const name=await promptModal({title:'名前を付けて保存',confirmLabel:'保存する',label:'保存したフィルタの名前',
        value:seed,placeholder:'例: A5052系の残',
        hint:(err?`${err}\n`:'')+`条件: ${filters.map(condLabel).join(' ／ ')}（${sceneLabel()}・自分だけに見えます。✎ 直す でみんなに見せられます）`});
      if(!name)return;
      try{
        const r=await jpost('/api/filter-presets',{name,db:S.db,table:S.table,mode:presetMode(),filters,user:filterUserId(),onExists:'error'});
        await loadMasterPresets();
        setSelected(presetById(r.id)||null);renderBar();
        showToast?.('保存しました',`「${name}」（${filters.length}条件）`,3600);
        return;
      }catch(e){
        if(e&&e.status===409){seed=name;err=`「${name}」はもうあります。別の名前にするか、その保存を選んでから「上書き保存」します。`;continue}
        /* マスタへ書けないときは、この端末だけの控えとして残す（前の作りと同じ）。 */
        const p={id:crypto.randomUUID(),name,db:S.db,table:S.table,mode:presetMode(),filters,master:false,owner:filterUserId(),mine:true};
        S.filterPresets=[p,...(S.filterPresets||[])].slice(0,120);writeLocalPresets();setSelected(p);renderBar();
        showToast?.('マスタへ保存できませんでした',`${e.message}（この端末にだけ控えました）`,7000);
        return;
      }
    }
  }
  /* 戻す——選んでいる保存の条件そのものへ戻す（足した条件を外し、外した条件を戻す）。 */
  function revertToSaved(){
    const d=diffState();if(!d.sel)return;
    S.genericFilters=S.genericFilters.filter(isLockedFilter);
    const have=new Set(S.genericFilters.map(filterKey));
    (d.sel.filters||[]).forEach(f=>{if(!have.has(filterKey(f)))S.genericFilters.push(structuredClone(f))});
    afterChange();
  }
  async function removeCond(key){
    const f=S.genericFilters.find(x=>filterKey(x)===key);if(!f)return;
    if(isLockedFilter(f)&&!(await confirmRemoveLocked([f])))return;
    S.genericFilters=S.genericFilters.filter(x=>x!==f);afterChange();
  }
  function restoreCond(f){if(!S.genericFilters.some(x=>filterKey(x)===filterKey(f))){S.genericFilters.push(structuredClone(f));afterChange()}}
  /* 1つの列の条件を入れ替える（値の一覧の「絞り込む」）。いつも適用の条件は残す。 */
  function setColumnConds(column,conds){
    S.genericFilters=S.genericFilters.filter(f=>f.column!==column||isLockedFilter(f)).concat(conds);
    afterChange();
  }
  /* すべて外す（鍵付きは確かめる）。選んでいる保存も外す——外したあと「外した」の札が全部並ぶと読めない。 */
  async function dropAllFilters(){
    const locked=S.genericFilters.filter(isLockedFilter);
    if(locked.length&&!(await confirmRemoveLocked(locked))){
      S.genericFilters=locked;
    }else S.genericFilters=[];
    setSelected(null);
  }
  /* 表示の設定の読み込み（list-tools.js）から当てる口。**鍵付きの条件は残す**（前は丸ごと置き換えて外れていた）。 */
  function replaceFilters(list){
    const locked=S.genericFilters.filter(isLockedFilter),have=new Set(locked.map(filterKey));
    S.genericFilters=locked.concat((list||[]).filter(f=>f&&f.column&&!have.has(filterKey(f))).map(({locked:_l,...f})=>f));
    setSelected(null);renderBar();
  }

  /* ============================================================
     帯（1段目: 保存したフィルタと変えたことの扱い／2段目: 効いている条件の札）
     ============================================================ */
  function ensureGenericFilterBar(){
    let bar=$('#genericFilterBar');if(bar)return bar;
    bar=document.createElement('section');bar.id='genericFilterBar';bar.className='generic-filter-bar';
    const grid=$('#grid');grid?.parentNode?.insertBefore(bar,grid);
    /* 骨組みは index.html の`<template id="tpl-filter-bar">`（§9.522）。 */
    bar.append(WL.template('filter-bar'));
    $('#filterSavedBtn').onclick=e=>openSavedMenu(e.currentTarget);
    $('#filterAddCond').onclick=e=>openColumnPicker(e.currentTarget);
    return bar;
  }
  const tag=(t,cls)=>`<span class="flt-tag${cls?' '+cls:''}">${esc(t)}</span>`;
  const presetTags=p=>(isAlwaysOnPreset(p)?tag('いつも適用','is-always'):'')+(!p.owner&&p.master?tag('みんな','is-shared'):'')+(!p.master?tag('この端末だけ','is-local'):'');
  function renderBar(){
    const btn=$('#filterSavedBtn');if(!btn)return;
    const d=diffState(),n=currentPresets().length;
    $('#filterSavedName').textContent=d.sel?d.sel.name:'なし';
    /* スケジュールの仕掛一覧で「仕掛一覧と同じ」につないでいるときは、帯で言う（面を開かないと分からない、にしない）。 */
    $('#filterSavedTags').innerHTML=(d.sel?presetTags(d.sel):'')+(inScheduleList()&&filterLinked()?tag('仕掛一覧と同じ','is-link'):'');
    btn.classList.toggle('is-on',!!d.sel);
    btn.title=d.sel?`保存したフィルタ「${d.sel.name}」を当てています。押すとほかの保存へ切り替え・直す・書き出しができます`
      :n?`保存したフィルタ（${n}件）から選びます。押すと一覧が開きます`:'保存したフィルタはまだありません。条件を入れて「名前を付けて保存」で作ります';
    /* 変えたことの扱い（次にすることは塗りの1つ）。選んでいない＋条件あり＝名前を付けて保存の1つだけ。 */
    chipsHost();
    const box=$('#filterChange'),own=conditionsToSave(d.sel);if(!box)return;
    box.innerHTML=d.dirty
      ?`<span class="flt-chg-word">変更あり</span><span class="flt-split"><button type="button" class="flt-btn is-primary" data-fc="overwrite" title="「${esc(d.sel.name)}」をいまの条件で書き換えます">上書き保存</button>`
       +`<button type="button" class="flt-btn is-primary flt-split-more" data-fc="more" aria-haspopup="menu" aria-label="ほかの扱い（別名で保存・保存の条件へ戻す）" title="別名で保存・保存の条件へ戻す">▾</button></span>`
      :(!d.sel&&own.length?'<button type="button" class="flt-btn" data-fc="saveas" title="いまの条件に名前を付けて保存します（あとで ✎ 直す で直せます）">＋ 名前を付けて保存</button>':'');
    box.hidden=!box.innerHTML;
    renderChips(d);
  }
  /* 2段目＝いま効いている物（件数の右）。条件の札（今の条件の順・外した条件は最後に「外した」）→ すべて外す → 保存との違いの扱い。
     器は**作り直さない**（帯の席が動かない・中の札だけ描き直す）。 */
  function chipsHost(){
    const count=$('#count');if(!count)return null;
    let h=$('#filterChips');
    if(!h){
      h=document.createElement('span');h.id='filterChips';h.className='flt-chips';h.setAttribute('role','group');h.setAttribute('aria-label','効いている条件');
      h.innerHTML='<span class="flt-chip-list"></span>'
        +'<button type="button" class="flt-btn is-ghost" id="clearGenericFilters" title="条件を全部外します（いつも適用の条件は確かめてから）" hidden>すべて外す</button>'
        +'<span class="flt-change" id="filterChange" role="group" aria-label="保存したフィルタから変えたこと" hidden></span>';
      h.addEventListener('click',onChipClick);
    }
    if(h.previousElementSibling!==count)count.after(h);
    return h;
  }
  function renderChips(d){
    const h=chipsHost();if(!h)return;
    const chip=(f,kind)=>{
      const k=filterKey(f),lock=isLockedFilter(f);
      const mark=kind==='added'?'<em class="flt-mark">足した</em>':kind==='changed'?'<em class="flt-mark">変えた</em>':kind==='removed'?'<em class="flt-mark">↺ 外した</em>':'';
      const why=kind==='removed'?`「${d.sel.name}」にある条件を外しています。押すと戻します`
        :kind?`「${d.sel.name}」から${kind==='added'?'足した':'変えた'}条件です。押すと値を選び直せます`:'押すと値を選び直せます';
      return `<span class="flt-chip${kind?' is-'+kind:''}${lock?' is-locked':''}" data-key="${esc(k)}"${kind==='removed'?` data-restore="${esc(k)}"`:''}>`
        +`<button type="button" class="flt-chip-main" data-col="${esc(f.column)}" title="${esc(why)}">${mark}<span class="flt-chip-k">${esc(colLabel(f.column))}</span>`
        +`<span class="flt-chip-v">${esc(condValueText(f,{max:isSet(f)&&setVals(f).join('').length>12?1:3}))}</span>${lock?tag('いつも適用','is-always'):''}</button>`
        +(kind==='removed'?'':`<button type="button" class="flt-chip-x" data-x="${esc(k)}" aria-label="${esc(condLabel(f))} を外す" title="この条件を外す">×</button>`)
        +'</span>';
    };
    const list=S.genericFilters.map(f=>{const k=filterKey(f);return chip(f,d.added.has(k)?'added':d.changed.has(k)?'changed':'')})
      .concat(d.removed.map(f=>chip(f,'removed')));
    h.querySelector('.flt-chip-list').innerHTML=list.join('');
    h.classList.toggle('has-chips',list.length>0);
    $('#clearGenericFilters').hidden=!S.genericFilters.length;
  }
  function onChipClick(e){
    const fc=e.target.closest('[data-fc]');
    if(fc){({overwrite:overwriteSaved,saveas:saveAsNew,revert:revertToSaved,more:()=>openChangeMenu(fc)})[fc.dataset.fc]?.();return}
    const x=e.target.closest('[data-x]');if(x){removeCond(x.dataset.x);return}
    const r=e.target.closest('[data-restore]');
    if(r){const d=diffState(),f=d.removed.find(z=>filterKey(z)===r.dataset.restore);if(f)restoreCond(f);return}
    const m=e.target.closest('.flt-chip-main');if(m){openColumnPop(m.dataset.col,m);return}
    if(e.target.closest('#clearGenericFilters'))WL.list.clearNarrowing();
  }

  /* 「上書き保存 ▾」の ▾: 別名で保存・保存の条件へ戻す（帯の2段目を1行に保つ・§9.614 の採点）。 */
  function openChangeMenu(anchor){
    const d=diffState();if(!d.sel)return;
    const m=document.createElement('div');m.className='wl-menu flt-change-menu';m.setAttribute('role','menu');
    m.innerHTML=`<button type="button" role="menuitem" data-c="saveas">別名で保存<small>「${esc(d.sel.name)}」は残し、いまの条件を新しい名前で</small></button>`
      +`<button type="button" role="menuitem" data-c="revert">保存の条件へ戻す<small>足した・変えた条件を外し、外した条件を戻す</small></button>`;
    document.body.append(m);
    m.addEventListener('click',e=>{const b=e.target.closest('[data-c]');if(!b)return;WL.popMenu.close();(b.dataset.c==='saveas'?saveAsNew:revertToSaved)()});
    WL.popMenu.open(m,{anchor,owner:anchor,onClose:()=>m.remove()});
  }
  /* ============================================================
     面: 保存したフィルタの一覧（「フィルタ ▾」）
     ============================================================ */
  let savedMenu=null;
  function openSavedMenu(anchor){
    if(savedMenu){WL.popMenu.close();return}
    const d=diffState(),list=currentPresets();
    const m=document.createElement('div');m.className='wl-menu flt-saved-menu';m.id='filterSavedMenu';m.setAttribute('role','menu');m.setAttribute('aria-label','保存したフィルタ');
    const row=p=>{
      const on=d.sel&&String(d.sel.id)===String(p.id);
      return `<div class="flt-saved-row${on?' is-on':''}" role="none">`
        +`<button type="button" role="menuitemradio" aria-checked="${on}" class="flt-saved-pick" data-pick="${esc(String(p.id))}">`
        +`<i class="flt-dot" aria-hidden="true"></i><span class="flt-saved-name"><b>${esc(p.name)}</b>${presetTags(p)}${on&&d.dirty?tag('変更あり','is-dirty'):''}</span>`
        +`<small class="flt-saved-sum">${esc((p.filters||[]).map(condLabel).join(' ／ '))}</small>`
        +`<span class="flt-saved-n" data-count="${esc(String(p.id))}"></span></button>`
        +`<button type="button" class="flt-btn flt-edit" data-edit="${esc(String(p.id))}" title="名前・条件・見える人・いつも適用を直す">✎ 直す</button></div>`;
    };
    m.innerHTML=`<p class="flt-menu-head" title="押すと、その条件に入れ替わります。件数は保存した条件だけで絞ったときの行の数です。">保存したフィルタ${list.length?`<small>${filterUserId()?`${esc(filterUserId())} さんの保存とみんなの保存`:'利用者IDが分からないので、みんなの保存だけ'}・件数＝その条件だけで絞った行の数</small>`:''}</p>`
      +`<div class="flt-saved-row${d.sel?'':' is-on'}" role="none"><button type="button" role="menuitemradio" aria-checked="${!d.sel}" class="flt-saved-pick" data-pick="">`
      +`<i class="flt-dot" aria-hidden="true"></i><span class="flt-saved-name"><b>なし</b></span><small class="flt-saved-sum">保存した条件を外す（いつも適用の条件は残ります）</small><span class="flt-saved-n"></span></button></div>`
      +(list.length?list.map(row).join(''):'<p class="flt-menu-empty">保存したフィルタはまだありません。</p>')
      +(inScheduleList()?`<div class="flt-menu-scene"><span>置き場</span><span class="mm-seg" role="radiogroup" aria-label="条件の置き場">`
        +`<button type="button" role="radio" aria-checked="${!filterLinked()}" class="${filterLinked()?'':'is-on'}" data-link="0">スケジュール用</button>`
        +`<button type="button" role="radio" aria-checked="${filterLinked()}" class="${filterLinked()?'is-on':''}" data-link="1">仕掛一覧と同じ</button></span>`
        +'<small>「仕掛一覧と同じ」にすると、元データの仕掛一覧の保存・条件をそのまま使います</small></div>':'')
      +`<div class="flt-menu-foot">${conditionsToSave(d.sel).length?`<button type="button" class="flt-btn" data-saveas="1" title="いまの条件（${esc(conditionsToSave(d.sel).map(condLabel).join(' ／ '))}）に名前を付けて保存します">＋ いまの条件を名前を付けて保存</button>`:'<span>条件を入れると、ここから名前を付けて保存できます</span>'}`
      +'<button type="button" class="flt-btn is-ghost" data-io="1">書き出す・取り込む…</button></div>';
    document.body.append(m);savedMenu=m;anchor.setAttribute('aria-expanded','true');
    m.addEventListener('click',e=>{
      const pick=e.target.closest('[data-pick]'),edit=e.target.closest('[data-edit]'),link=e.target.closest('[data-link]'),io=e.target.closest('[data-io]');
      if(e.target.closest('[data-saveas]')){WL.popMenu.close();saveAsNew();return}
      if(edit){const p=presetById(edit.dataset.edit);WL.popMenu.close();if(p)openEditDialog(p);return}
      if(link){WL.popMenu.close();setFilterLinked(link.dataset.link==='1');return}
      if(io){WL.popMenu.close();openIo();return}
      if(pick){WL.popMenu.close();const p=presetById(pick.dataset.pick);if(p)selectSaved(p);else selectNone()}
    });
    WL.popMenu.open(m,{anchor,owner:anchor,align:'start',onClose:()=>{m.remove();savedMenu=null;anchor.setAttribute('aria-expanded','false')}});
    fillSavedCounts(m,list);
  }
  /* 件数は開いてから裏で数える（1件ずつ・待たせない）。 */
  function fillSavedCounts(m,list){
    list.forEach(p=>countFor(p.filters||[]).then(n=>{const el=m.querySelector(`[data-count="${CSS.escape(String(p.id))}"]`);if(el&&n!=null)el.textContent=`${n.toLocaleString()}件`})
      .catch(WL.quiet('件数を数えられない（件数を出さないだけ）')));
  }
  async function countFor(filters){
    const base=WL.listQuery?WL.listQuery():new URLSearchParams();
    const q=new URLSearchParams({db:S.db,table:S.table,page:'1',page_size:'1',search:''});
    ['join','join_quality'].forEach(k=>{if(base.get(k))q.set(k,base.get(k))});
    if(filters.length)q.set('filters',JSON.stringify(expandFilterList(filters)));
    const r=await api('/api/table?'+q);
    return typeof r.count==='number'?r.count:null;
  }

  /* ============================================================
     面: 列の値の一覧（Excel 型）——見出しの ▼／札を押す／＋ 条件 の行き先は全部ここ
     ============================================================ */
  let colPop=null;
  /* 値の一覧（サーバーが数える・ほかの絞り込みに当たる件数）。この列の条件は外して数える（選んでいない値の数も見える）。 */
  async function fetchValues(column,{q='',others=null}={}){
    const base=WL.listQuery?WL.listQuery():new URLSearchParams();
    const p=new URLSearchParams({db:S.db,table:S.table,column,search:others?'':(base.get('search')||'')});
    if(q)p.set('q',q);
    const fs=others!=null?others:(()=>{try{return JSON.parse(base.get('filters')||'[]')}catch(_){return []}})().filter(f=>f.column!==column);
    if(fs.length)p.set('filters',JSON.stringify(fs));
    return api('/api/table/slicer?'+p);
  }
  function openColumnPop(column,anchor,{onPick=null,init=null}={}){
    WL.popMenu.close();
    const mine=init||S.genericFilters.filter(f=>f.column===column&&!isLockedFilter(f));
    const lockedHere=S.genericFilters.filter(f=>f.column===column&&isLockedFilter(f));
    const setCond=mine.find(isSet),opCond=mine.find(f=>!isSet(f));
    const st={column,values:[],truncated:false,loading:true,err:'',q:'',
      /* 選び方: 値の集合を「選んだ値（in）」か「外した値（not_in）」で持つ。何も無ければ全部選んでいる。 */
      mode:setCond?setCond.op:'not_in',set:new Set(setCond?setVals(setCond):[]),
      op:opCond?opCond.op:'contains',val:opCond?String(opCond.value??''):'',condOpen:!!opCond};
    const m=document.createElement('div');m.className='wl-menu flt-col-pop';m.id='filterColPop';m.setAttribute('role','dialog');
    m.setAttribute('aria-label',`${colLabel(column)} で絞り込む`);
    document.body.append(m);colPop={m,st};
    const checked=v=>st.mode==='in'?st.set.has(v):!st.set.has(v);
    const shown=()=>st.values.filter(x=>!st.q||valWord(x.value).toLowerCase().includes(st.q.toLowerCase()));
    const paint=()=>{
      const vs=shown(),max=Math.max(1,...st.values.map(x=>x.count||0));
      const nOn=st.values.filter(x=>checked(x.value)).length;
      const allOn=vs.length&&vs.every(x=>checked(x.value)),someOn=vs.some(x=>checked(x.value));
      m.innerHTML=`<div class="flt-cp-head"><b>${esc(colLabel(column))}</b><small>${st.loading?'値を数えています…':`${st.values.length}${st.truncated?'+':''} 個のうち ${nOn} 個を選択`}</small></div>`
        +`<div class="flt-cp-sort"><button type="button" class="flt-btn" data-sort="asc">↑ 小さい順</button><button type="button" class="flt-btn" data-sort="desc">↓ 大きい順</button></div>`
        +`<label class="flt-cp-find"><input type="search" placeholder="値を探す" value="${esc(st.q)}" aria-label="値を探す"></label>`
        +(st.err?`<p class="flt-cp-err">${esc(st.err)}</p>`:'')
        +`<div class="flt-cp-list" role="group" aria-label="値">`
        +(vs.length?`<label class="flt-cp-item is-all"><input type="checkbox" data-all ${allOn?'checked':''}><span>すべて選ぶ</span><span class="flt-cp-n">${vs.reduce((a,x)=>a+(x.count||0),0).toLocaleString()}件</span></label>`:'')
        +vs.map(x=>`<label class="flt-cp-item"><input type="checkbox" data-v="${esc(x.value)}" ${checked(x.value)?'checked':''}>`
          +`<span class="flt-cp-v">${esc(valWord(x.value))}</span><button type="button" class="flt-cp-only" data-only="${esc(x.value)}" title="「${esc(valWord(x.value))}」だけを選ぶ（ほかは外す）">だけ</button>`
          +`<span class="flt-cp-n"><i class="flt-cp-bar" style="width:${Math.max(4,Math.round((x.count||0)/max*48))}px"></i>${(x.count||0).toLocaleString()}</span></label>`).join('')
        +(!st.loading&&!vs.length?'<p class="flt-cp-none">当たる値がありません</p>':'')
        +(st.truncated?'<p class="flt-cp-more">値が多いので先頭だけ出しています。探す欄に打つと、その字を含む値を数え直します。</p>':'')
        +'</div>'
        +`<details class="flt-cp-cond"${st.condOpen?' open':''}><summary>値ではなく条件で絞る（含む・以上 など）</summary>`
        +`<div class="flt-cp-cond-row"><select aria-label="比べ方">${OPS.map(([v,l])=>`<option value="${v}"${v===st.op?' selected':''}>${esc(l)}</option>`).join('')}</select>`
        +`<input type="text" aria-label="値" value="${esc(st.val)}" ${noValueOp(st.op)?'disabled placeholder="（値は要りません）"':'placeholder="値"'}>`
        +FILTER_VARS.map(v=>`<button type="button" class="flt-btn flt-var" data-var="${esc(v.token)}" title="${esc(`${v.hint}（いまは「${v.resolve()||'未設定'}」）`)}">{${esc(v.label)}}</button>`).join('')+'</div></details>'
        +(lockedHere.length?`<p class="flt-cp-lock">いつも適用の条件（${esc(lockedHere.map(f=>condValueText(f)).join('・'))}）はそのまま残ります</p>`:'')
        +`<div class="flt-cp-foot">${mine.length?'<button type="button" class="flt-btn is-ghost" data-act="clear">この列の条件を外す</button>':''}<span></span>`
        +`<button type="button" class="flt-btn" data-act="cancel">キャンセル</button><button type="button" class="flt-btn is-primary" data-act="ok"${same()?' disabled title="まだ何も変えていません"':''}>${onPick?'決める':'絞り込む'}</button></div>`;
      /* 一部だけ選んでいるときの「すべて選ぶ」は中間の印（Excel と同じ・選んだか外したかを色でなく形で言う）。 */
      const allBox=m.querySelector('[data-all]');if(allBox)allBox.indeterminate=!allOn&&someOn;
      const find=m.querySelector('.flt-cp-find input');
      if(find)WL.base.onTyped(find,()=>{st.q=find.value;if(st.truncated)load();else paintKeep(find)});
      WL.popMenu.place(m,{anchor,align:'start'});
    };
    const paintKeep=inp=>{const pos=inp.selectionStart;paint();const n=m.querySelector('.flt-cp-find input');if(n){n.focus();n.setSelectionRange(pos,pos)}};
    const load=async()=>{
      st.loading=true;paint();
      try{const r=await fetchValues(column,{q:st.truncated?st.q:''});st.values=r.values||[];st.truncated=!!r.truncated;st.err=''}
      catch(e){st.err=`値を読めませんでした: ${e.message}`;st.values=[]}
      st.loading=false;
      const inp=m.querySelector('.flt-cp-find input');if(inp&&document.activeElement===inp)paintKeep(inp);else paint();
    };
    /* チェックの付け外しは**した操作のまま**持つ（§9.614）: 全部選んだ所から外した＝「除く（not_in）」、
       すべて選ぶ を外してから選んだ＝「選ぶ（in）」。数の少ないほうへ持ち替えると、2つ選んだのに「残りの1つ以外」と
       言い換わり、あとで増えた値の扱いも変わる（選んでいない値が入る）。 */
    const toggle=(v,on)=>{if(st.mode==='in'){on?st.set.add(v):st.set.delete(v)}else{on?st.set.delete(v):st.set.add(v)}};
    const result=()=>{
      const out=[];
      if(st.mode==='in'||st.set.size)out.push({column,op:st.mode,value:[...st.set]});
      if(st.condOpen&&(noValueOp(st.op)||String(st.val).trim()))out.push({column,op:st.op,value:noValueOp(st.op)?'':String(st.val).trim()});
      return out;
    };
    /* 開いたときと同じ結果なら「絞り込む」は押せない形（押しても何も起きない物を置かない）。 */
    const keyOf=list=>JSON.stringify(list.filter(f=>!(f.op==='not_in'&&!setVals(f).length)).map(f=>[f.op,isSet(f)?[...setVals(f)].sort():f.value]));
    const first=keyOf(mine.map(f=>({column,op:f.op,value:f.value})));
    function same(){return !onPick&&keyOf(result())===first}
    m.addEventListener('change',e=>{
      const t=e.target;
      if(t.matches('[data-all]')){if(st.q)shown().forEach(x=>toggle(x.value,t.checked));else{st.mode=t.checked?'not_in':'in';st.set=new Set()}paint();return}
      if(t.matches('[data-v]')){toggle(t.dataset.v,t.checked);paint();return}
      if(t.matches('.flt-cp-cond-row select')){st.op=t.value;st.condOpen=true;paint();return}
    });
    /* 打っている途中は描き直さない（焦点と字を保つ）。押せるかだけ塗り直す。 */
    const paintOk=()=>{const ok=m.querySelector('[data-act="ok"]');if(!ok)return;ok.disabled=same();ok.title=ok.disabled?'まだ何も変えていません':''};
    m.addEventListener('input',e=>{if(e.target.matches('.flt-cp-cond-row input')){st.val=e.target.value;st.condOpen=true;paintOk()}});
    m.addEventListener('toggle',e=>{if(e.target.matches('.flt-cp-cond'))st.condOpen=e.target.open},true);
    m.addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b)return;
      if(b.dataset.var){st.val=(st.val||'')+b.dataset.var;st.condOpen=true;paint();return}
      if(b.dataset.only!=null){e.preventDefault();st.mode='in';st.set=new Set([b.dataset.only]);paint();return}
      if(b.dataset.sort){WL.popMenu.close();WL.listSort.set([{column,dir:b.dataset.sort}]);S.page=1;WL.list.load();return}
      const act=b.dataset.act;if(!act)return;
      if(act==='cancel'){WL.popMenu.close();return}
      if(act==='clear'){WL.popMenu.close();if(onPick)onPick([]);else setColumnConds(column,[]);return}
      if(act==='ok'){
        /* 入れた値が全部選んだままで、条件も無ければ＝この列で絞らない。 */
        const out=result().filter(f=>!(f.op==='not_in'&&!setVals(f).length));
        WL.popMenu.close();
        if(onPick)onPick(out);else setColumnConds(column,out);
      }
    });
    m.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('input[type=text],input[type=search]')){e.preventDefault();m.querySelector('[data-act="ok"]').click()}});
    paint();
    WL.popMenu.open(m,{anchor,owner:anchor,align:'start',onClose:()=>{m.remove();if(colPop&&colPop.m===m)colPop=null}});
    load();
  }
  /* 「＋ 条件」: 列を選ぶ（探せる）→ その列の値の一覧。 */
  function openColumnPicker(anchor){
    WL.popMenu.close();
    const cols=(S.columns||[]).filter(c=>c&&!String(c).startsWith('__'));
    const m=document.createElement('div');m.className='wl-menu flt-col-pick';m.setAttribute('aria-label','絞り込む列を選ぶ');
    const paint=q=>{
      const hits=cols.filter(c=>!q||colLabel(c).toLowerCase().includes(q.toLowerCase())||String(c).toLowerCase().includes(q.toLowerCase()));
      m.querySelector('.flt-pick-list').innerHTML=hits.slice(0,80).map(c=>`<button type="button" data-col="${esc(c)}">${esc(colLabel(c))}${colLabel(c)!==c?`<small>${esc(c)}</small>`:''}</button>`).join('')
        +(hits.length>80?`<p class="flt-cp-more">ほか${hits.length-80}列。探す欄で絞ってください。</p>`:'')+(hits.length?'':'<p class="flt-cp-none">当たる列がありません</p>');
    };
    m.innerHTML='<p class="flt-menu-head">絞り込む列<small>選ぶと、その列の値の一覧が開きます</small></p><label class="flt-cp-find"><input type="search" placeholder="列名を探す" aria-label="列名を探す"></label><div class="flt-pick-list"></div>';
    document.body.append(m);paint('');
    const inp=m.querySelector('input');WL.base.onTyped(inp,()=>paint(inp.value));
    m.addEventListener('click',e=>{const b=e.target.closest('[data-col]');if(b){const c=b.dataset.col;WL.popMenu.close();setTimeout(()=>openColumnPop(c,anchor),0)}});
    WL.popMenu.open(m,{anchor,owner:anchor,align:'start',onClose:()=>m.remove()});
    requestAnimationFrame(()=>inp.focus());
  }
  /* 見出しの ▼（list-view.js が描く`.col-funnel`）。並び替え（見出しのクリック）へ渡さない。 */
  document.addEventListener('click',e=>{
    const f=e.target.closest&&e.target.closest('.col-funnel');if(!f)return;
    e.preventDefault();e.stopPropagation();openColumnPop(f.dataset.funnel,f);
  },true);

  /* ============================================================
     窓: 保存したフィルタを直す（名前・条件・見える人・いつも適用）
     ============================================================ */
  const HOW_OPTIONS=[['in','値を選ぶ'],['not_in','値以外'],...OPS];
  async function openEditDialog(p){
    const st={name:p.name,conds:structuredClone(p.filters||[]),shared:!p.owner,always:isAlwaysOnPreset(p),err:'',del:false};
    const cols=[...new Set([...(S.columns||[]).filter(c=>!String(c).startsWith('__')),...st.conds.map(f=>f.column)])];
    let counter=0;
    const body=()=>`<div class="flt-ed" data-fb-ed="1">`
      +(st.err?`<p class="flt-ed-err">${esc(st.err)}</p>`:'')
      +`<span class="flt-ed-k">名前</span><input type="text" class="flt-ed-name" value="${esc(st.name)}" maxlength="100" aria-label="名前">`
      +`<span class="flt-ed-k flt-ed-top">条件<small>すべてを満たす</small></span><div class="flt-ed-conds">`
      +st.conds.map((f,i)=>`<div class="flt-ed-row" data-i="${i}">`
        +`<select class="flt-ed-col" aria-label="列">${cols.map(c=>`<option value="${esc(c)}"${c===f.column?' selected':''}>${esc(colLabel(c))}</option>`).join('')}</select>`
        +`<select class="flt-ed-how" aria-label="比べ方">${HOW_OPTIONS.map(([v,l])=>`<option value="${v}"${v===f.op?' selected':''}>${esc(l)}</option>`).join('')}</select>`
        +`<span class="flt-ed-val">${isSet(f)
            ?setVals(f).map(v=>`<span class="flt-chip is-mini"><span class="flt-chip-v">${esc(valWord(v))}</span><button type="button" class="flt-chip-x" data-unv="${esc(v)}" aria-label="${esc(valWord(v))} を外す">×</button></span>`).join('')
              +'<button type="button" class="flt-btn" data-pickv="1" title="件数つきの値の一覧から選びます">＋ 値</button>'
            :noValueOp(f.op)?'<span class="flt-ed-none">（値は要りません）</span>':`<input type="text" class="flt-ed-v" value="${esc(String(f.value??''))}" aria-label="値">`}</span>`
        +`<button type="button" class="flt-chip-x flt-ed-x" data-rm="1" aria-label="この条件を外す" title="この条件を外す">×</button></div>`).join('')
      +'<button type="button" class="flt-btn is-ghost flt-ed-add" data-addc="1">＋ 条件を足す</button></div>'
      +`<span class="flt-ed-k">見える人</span><span class="mm-seg" role="radiogroup" aria-label="見える人">`
        +`<button type="button" role="radio" aria-checked="${!st.shared}" class="${st.shared?'':'is-on'}" data-share="0">自分だけ</button>`
        +`<button type="button" role="radio" aria-checked="${st.shared}" class="${st.shared?'is-on':''}" data-share="1">みんな</button></span>`
      +`<span class="flt-ed-k">いつも適用</span><label class="flt-ed-always"><input type="checkbox" ${st.always?'checked':''}> この一覧を開くたびに当てる（帯の札から外すときは確かめます）</label>`
      +`<p class="flt-ed-count" aria-live="polite">この条件でいまの一覧を絞ると <b data-ed-count>…</b></p>`
      +`<div class="flt-ed-danger">${st.del?'<span>本当に削除しますか（元に戻せません）</span><button type="button" class="flt-btn is-danger" data-del="2">削除する</button><button type="button" class="flt-btn is-ghost" data-del="0">やめる</button>'
        :'<button type="button" class="flt-btn is-danger-ghost" data-del="1">このフィルタを削除</button>'}</div>`
      +'</div>';
    const host=()=>document.querySelector('#appConfirmBody [data-fb-ed]');
    /* 打っている途中の値を写す（描き直しても消えない）。 */
    const read=()=>{
      const h=host();if(!h)return;
      st.name=(h.querySelector('.flt-ed-name')||{}).value??st.name;
      h.querySelectorAll('.flt-ed-row').forEach(r=>{const f=st.conds[+r.dataset.i];const v=r.querySelector('.flt-ed-v');if(f&&v)f.value=v.value});
      const a=h.querySelector('.flt-ed-always input');if(a)st.always=a.checked;
    };
    const paint=()=>{const h=host();if(!h)return;h.outerHTML=body();wire();recount()};
    let countTimer=null;
    const recount=()=>{clearTimeout(countTimer);countTimer=setTimeout(()=>{
      const valid=cleaned();countFor(valid).then(n=>{const el=document.querySelector('#appConfirmBody [data-ed-count]');if(el)el.textContent=n==null?'—':`${n.toLocaleString()}件`})
        .catch(()=>{const el=document.querySelector('#appConfirmBody [data-ed-count]');if(el)el.textContent='数えられません'})},250)};
    const cleaned=()=>st.conds.filter(f=>f.column&&(isSet(f)?(f.op==='in'||setVals(f).length):(noValueOp(f.op)||String(f.value??'').trim())))
      .map(f=>({column:f.column,op:f.op,value:isSet(f)?setVals(f):noValueOp(f.op)?'':String(f.value??'').trim()}));
    let deleted=false;
    const wire=()=>{
      const h=host();if(!h)return;
      h.addEventListener('change',e=>{
        const r=e.target.closest('.flt-ed-row');read();
        if(r&&e.target.matches('.flt-ed-col')){const f=st.conds[+r.dataset.i];f.column=e.target.value;if(isSet(f))f.value=[];paint();return}
        if(r&&e.target.matches('.flt-ed-how')){const f=st.conds[+r.dataset.i],was=isSet(f);f.op=e.target.value;if(isSet(f)!==was)f.value=isSet(f)?[]:'';paint();return}
      });
      h.addEventListener('input',e=>{if(e.target.matches('.flt-ed-v')){read();recount()}});
      h.addEventListener('click',async e=>{
        const b=e.target.closest('button');if(!b)return;read();
        const r=b.closest('.flt-ed-row'),f=r?st.conds[+r.dataset.i]:null;
        if(b.dataset.unv!=null&&f){f.value=setVals(f).filter(v=>v!==b.dataset.unv);paint();return}
        if(b.dataset.rm&&r){st.conds.splice(+r.dataset.i,1);paint();return}
        if(b.dataset.addc){st.conds.push({column:cols[0]||'',op:'in',value:[],_n:++counter});paint();return}
        if(b.dataset.share!=null){st.shared=b.dataset.share==='1';paint();return}
        if(b.dataset.pickv&&f){
          /* 値は帯と同じ「件数つきの値の一覧」で選ぶ（窓の上に浮く面・窓は開かない）。ほかの絞り込みは当てずに数える。 */
          openColumnPop(f.column,b,{init:[{column:f.column,op:'in',value:setVals(f)}],onPick:out=>{
            const s=out.find(isSet);f.op=s?s.op:'in';f.value=s?setVals(s):[];paint()}});
          colPop&&colPop.m.classList.add('is-over-modal');
          return;
        }
        if(b.dataset.del==='1'){st.del=true;paint();return}
        if(b.dataset.del==='0'){st.del=false;paint();return}
        if(b.dataset.del==='2'){deleted=true;$('#appConfirmCancel').click()}
      });
    };
    for(;;){
      const done=confirmModal({title:`保存したフィルタ「${p.name}」を直す`,
        bodyHtml:body(),confirmLabel:'保存する',kind:'input',wide:true,focus:'.flt-ed-name'});
      wire();recount();
      const ok=await done;read();
      if(deleted){await deletePreset(p);return}
      if(!ok)return;
      const filters=cleaned();
      if(!st.name.trim()){st.err='名前を入れてください。';continue}
      if(!filters.length){st.err='条件が1つもありません。条件を足すか、「このフィルタを削除」で消してください。';continue}
      /* 選んでいる保存を直したら、当てている条件もそろえる（直す前の条件を外して直した条件を入れる）。 */
      const sel=selectedPreset(),wasSel=sel&&String(sel.id)===String(p.id),oldKeys=new Set((p.filters||[]).map(filterKey));
      try{
        if(p.master){
          await jpost('/api/filter-presets/update',{id:p.id,name:st.name.trim(),filters,user:filterUserId()});
          if(st.shared!==!p.owner)await jpost('/api/filter-presets/owner',{id:p.id,user:filterUserId(),shared:st.shared});
        }else{p.name=st.name.trim();p.filters=filters;writeLocalPresets()}
        if(st.always!==isAlwaysOnPreset(p))await setAlwaysOnPreset(p,st.always);
        if(p.master)await loadMasterPresets();
        if(wasSel){
          S.genericFilters=S.genericFilters.filter(f=>!oldKeys.has(filterKey(f)));
          const have=new Set(S.genericFilters.map(filterKey));
          filters.forEach(f=>{if(!have.has(filterKey(f)))S.genericFilters.push(structuredClone(f))});
        }
        if(st.always)applyDefaultFiltersFor(S.db,S.table);
        showToast?.('保存したフィルタを直しました',`「${st.name.trim()}」＝ ${filters.map(condLabel).join(' ／ ')}`,4200);
        afterChange();
        return;
      }catch(e){st.err=e&&e.status===409?`「${st.name.trim()}」はもうあります。別の名前にしてください。`:`保存できませんでした: ${e.message}`}
    }
  }
  async function deletePreset(p){
    try{
      if(p.master&&p.id!=null)await jpost('/api/filter-presets/delete',{id:p.id,user:filterUserId()});
      else{S.filterPresets=(S.filterPresets||[]).filter(x=>x!==p);writeLocalPresets()}
      if(isAlwaysOnPreset(p))await setAlwaysOnPreset(p,false);
      const sel=selectedPreset();if(sel&&String(sel.id)===String(p.id))setSelected(null);
      if(p.master)await loadMasterPresets();
      showToast?.('保存したフィルタを削除しました',p.name,3600);
    }catch(e){showToast?.('削除できませんでした',e.message,6500)}
    renderBar();
  }

  /* ============================================================
     窓: 書き出す・取り込む（§9.171）。持ち出すのはフィルタだけ・印は名前で運ぶ
     ============================================================ */
  const IO_FORMAT='wavelog-filter-presets',IO_VERSION=2;
  const ioGroupKey=g=>`${g.db||''}\u001f${g.table||''}\u001f${g.mode||''}`;
  const ioGroupLabel=g=>`${g.db||'(DB未指定)'} / ${g.table||'(テーブル未指定)'}`;
  const ioModeLabel=mode=>mode==='schedule'?'スケジュールモード':'編集・閲覧モード';
  async function ioFetchAll(){
    const out=[];
    for(const mode of ['','schedule']){
      const q=new URLSearchParams({mode,user:filterUserId()});
      const r=await api('/api/filter-presets?'+q);
      (r.items||[]).forEach(x=>{if((x.filters||[]).length)out.push({id:x.id,name:x.name,db:x.db||'',table:x.table||'',mode:x.mode||'',
        filters:x.filters,master:true,owner:x.owner||'',isDefault:!!x.isDefault,isLocked:!!x.isLocked})});
    }
    (S.filterPresets||[]).filter(x=>!x.master).forEach(x=>out.push({...x}));
    return out;
  }
  function ioGroupsOf(list){
    const m=new Map();
    (list||[]).forEach(p=>{const g0={db:p.db||'',table:p.table||'',mode:p.mode||''},k=ioGroupKey(g0);let g=m.get(k);if(!g){g={...g0,key:k,presets:[]};m.set(k,g)}g.presets.push(p)});
    return [...m.values()].sort((a,b)=>(a.db+a.table+a.mode).localeCompare(b.db+b.table+b.mode,'ja'));
  }
  function ioFileName(){const d=new Date(),pad=n=>String(n).padStart(2,'0');return `wavelog-filters-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}.json`}
  function ioParse(text){
    let data;
    try{data=JSON.parse(text)}catch(e){throw new Error('JSONとして読めませんでした。書き出したファイルをそのまま選んでください。')}
    if(!data||data.format!==IO_FORMAT)throw new Error('WaveLogのフィルタ書き出しファイルではありません（別のファイルを選んでいませんか）。');
    const groups=(data.groups||[]).map(g=>({db:String(g&&g.db||''),table:String(g&&g.table||''),mode:(g&&g.mode)==='schedule'?'schedule':'',
      presets:((g&&g.presets)||[]).filter(x=>x&&String(x.name||'').trim()&&Array.isArray(x.filters)&&x.filters.length)
        .map(x=>({name:String(x.name).trim(),filters:x.filters,shared:!!x.shared,isDefault:!!(x.isDefault||x.isLocked||x.always)}))}))
      .filter(g=>g.presets.length);
    groups.forEach(g=>{g.key=ioGroupKey(g)});
    if(!groups.length)throw new Error('取り込める保存したフィルタが1件もありませんでした。');
    return {exportedAt:String(data.exportedAt||''),groups};
  }
  async function openIo(){
    let all=[],dbKeys=null;
    try{all=await ioFetchAll()}catch(e){alertModal({title:'保存したフィルタを読めませんでした',message:e.message});return}
    /* 取り込むとき、**この端末に無いデータの一覧**を言う（取り込んでも出てこない条件を黙って足さない）。
       読めなければ判定をやめる——「無い」と言い切るより言わないほうがよい。 */
    try{const c=await api('/api/catalog');dbKeys=new Set((c.databases||[]).map(x=>x.key))}catch(_){dbKeys=null}
    const here=ioGroupsOf(all),cur=ioGroupKey({db:S.db||'',table:S.table||'',mode:presetMode()});
    const st={kind:'export',chosen:new Set(here.filter(g=>g.key===cur).map(g=>g.key)),parsed:null,file:'',err:'',overwrite:true,withMarks:true};
    const alwaysIn=g=>{const m=ensureMarkMaps(),k=mapKeyOf(g.db,g.table,g.mode);
      return g.presets.filter(p=>p.isDefault||p.isLocked||idsAt(m.def,k).includes(String(p.id))).length};
    const groupRow=(g,count,extra)=>`<li${g.key===cur?' class="is-current"':''}><label><input type="checkbox" data-io-group="${esc(g.key)}"${st.chosen.has(g.key)?' checked':''}>`
      +`<b>${esc(ioGroupLabel(g))}</b><small>${esc(ioModeLabel(g.mode))}</small>${g.key===cur?'<em class="fp-io-now">いま開いている一覧</em>':''}${extra||''}</label><span class="fp-io-count">${esc(count)}</span></li>`;
    /* 決めるボタンの字・押せるか（件数で言う）。 */
    const plan=()=>{
      const groups=st.kind==='export'?here:(st.parsed?st.parsed.groups:[]);
      const n=groups.filter(g=>st.chosen.has(g.key)).reduce((a,g)=>a+g.presets.length,0);
      const verb=st.kind==='export'?'書き出す':'取り込む';
      return {n,label:n?`${n}件を${verb}`:verb,
        note:st.kind==='import'&&!st.parsed?'ファイルを選ぶと中身を確かめられます':n?`${st.chosen.size}つの一覧・${n}件を${st.kind==='export'?'書き出します':'取り込みます'}`:`${verb}一覧を選んでください`};
    };
    const html=()=>{
      const total=here.reduce((a,g)=>a+g.presets.length,0),pl=plan();
      return `<div class="fp-io" data-fb-io="1"><div class="fp-io-top"><div class="mm-seg" role="radiogroup" aria-label="することを選ぶ">`
      +`<button type="button" role="radio" aria-checked="${st.kind==='export'}" class="${st.kind==='export'?'is-on':''}" data-kind="export">書き出す</button>`
      +`<button type="button" role="radio" aria-checked="${st.kind==='import'}" class="${st.kind==='import'?'is-on':''}" data-kind="import">取り込む</button></div>`
      +`<span class="fp-io-note" aria-live="polite">${esc(pl.note)}</span></div><div class="fp-io-body">`
      +(st.kind==='export'
        ?`<div class="fp-io-quick"><span>どれを出しますか</span><button type="button" data-io-quick="current">いま開いている一覧だけ</button>`
         +`<button type="button" data-io-quick="all">すべての一覧（${here.length}つ・${total}件）</button><button type="button" data-io-quick="none">選択を全部外す</button></div>`
         +`<ul class="fp-io-groups">${here.map(g=>{const a=alwaysIn(g);return groupRow(g,`${g.presets.length}件${a?`・いつも適用${a}`:''}`)}).join('')||'<li class="fp-io-none">保存したフィルタがまだありません。</li>'}</ul>`
         +`<p class="fp-io-hint"><b>出るもの</b>: 名前・条件・対象の一覧・自分だけ／みんな・${esc(filterUserLabel())}の「いつも適用」（名前で運びます）。<br><b>出ないもの</b>: 使用回数・最終使用日時（端末ごとの記録）・持ち主のID（取り込んだ人のものになります）。</p>`
         +`<p class="fp-io-file-note">ファイル名 <code>${esc(ioFileName())}</code></p>`
        :`<div class="fp-io-pick"><label class="fp-io-filebtn"><input type="file" accept=".json,application/json" data-io-file="1"><span>ファイルを選ぶ…</span></label><span class="fp-io-filename">${st.file?esc(st.file):'まだ選んでいません'}</span></div>`
         +(st.err?`<p class="fp-io-error">${esc(st.err)}</p>`:'')
         +(st.parsed?`<p class="fp-io-read">読み込んだ内容: <b>${st.parsed.groups.reduce((a,g)=>a+g.presets.length,0)}件</b>／${st.parsed.groups.length}つの一覧${st.parsed.exportedAt?`（書き出し ${esc(st.parsed.exportedAt.slice(0,16).replace('T',' '))}）`:''}</p>`
           +`<ul class="fp-io-groups">${st.parsed.groups.map(g=>{const names=new Set(all.filter(p=>ioGroupKey(p)===g.key).map(p=>p.name));const dup=g.presets.filter(p=>names.has(p.name)).length;
            const unknown=dbKeys&&g.db&&!dbKeys.has(g.db);
            return groupRow(g,`新しく入る${g.presets.length-dup}件${dup?`・同じ名前が${dup}件`:''}`,unknown?'<em class="fp-io-warn">この端末には無いデータです（取り込んでも一覧には出ません）</em>':'')}).join('')}</ul>`
           +`<div class="fp-io-opts"><div class="fp-io-opt"><span class="fp-io-opt-label">同じ名前があったら</span><label><input type="radio" name="fpIoDup" value="overwrite"${st.overwrite?' checked':''}> 上書きする（条件を新しいほうへ）</label><label><input type="radio" name="fpIoDup" value="keep"${st.overwrite?'':' checked'}> そのままにする（いまの条件を残す）</label></div>`
           +`<div class="fp-io-opt"><label><input type="checkbox" data-io-marks="1"${st.withMarks?' checked':''}> 「いつも適用」も取り込む</label><small>${esc(filterUserLabel())}だけに付きます。外すと条件だけが入ります。</small></div></div>`
          :'<p class="fp-io-hint">別のPCで「書き出す」から作ったJSONを選んでください。名前・条件・対象の一覧と「いつも適用」が入っています。</p>'))
      +'</div></div>';
    };
    const host=()=>document.querySelector('#appConfirmBody [data-fb-io]');
    const paintFoot=()=>{const ok=$('#appConfirmOk'),pl=plan();if(ok){ok.textContent=pl.label;ok.disabled=!pl.n}};
    const repaint=()=>{const h=host();if(h){h.outerHTML=html();wire()}paintFoot()};
    const wire=()=>{
      const h=host();if(!h)return;
      h.addEventListener('click',e=>{
        const k=e.target.closest('[data-kind]');
        if(k){st.kind=k.dataset.kind;st.chosen=new Set(st.kind==='export'?here.filter(g=>g.key===cur).map(g=>g.key):(st.parsed?st.parsed.groups.map(g=>g.key):[]));repaint();return}
        const q=e.target.closest('[data-io-quick]');
        if(q){const w=q.dataset.ioQuick;st.chosen=new Set(w==='all'?here.map(g=>g.key):w==='current'?here.filter(g=>g.key===cur).map(g=>g.key):[]);repaint()}
      });
      h.addEventListener('change',async e=>{
        const t=e.target;
        if(t.dataset.ioGroup){t.checked?st.chosen.add(t.dataset.ioGroup):st.chosen.delete(t.dataset.ioGroup);repaint();return}
        if(t.name==='fpIoDup'){st.overwrite=t.value==='overwrite';return}
        if(t.dataset.ioMarks){st.withMarks=t.checked;return}
        /* 既定は全部入れる——書き出したファイルを選んだ人は、その中身を入れたいから選んでいる。 */
        if(t.dataset.ioFile){const f=t.files&&t.files[0];if(!f)return;st.file=f.name;st.err='';st.parsed=null;st.chosen=new Set();
          try{st.parsed=ioParse(await f.text());st.chosen=new Set(st.parsed.groups.map(g=>g.key))}catch(x){st.err=x.message}repaint()}
      });
    };
    const done=confirmModal({title:'保存したフィルタを書き出す・取り込む',bodyHtml:html(),confirmLabel:plan().label,kind:'input',wide:true});
    wire();paintFoot();
    if(!(await done))return;
    if(st.kind==='export')ioExport(here.filter(g=>st.chosen.has(g.key)));
    else if(st.parsed)await ioImport(st,all);
  }
  /* 書き出す（選んだ一覧ごと・印は名前で運ぶ）。 */
  function ioExport(groups){
    if(!groups.length)return;
    const payload={format:IO_FORMAT,version:IO_VERSION,app:'WaveLog',exportedAt:new Date().toISOString(),
      groups:groups.map(g=>({db:g.db,table:g.table,mode:g.mode,presets:g.presets.map(p=>{
        const m=ensureMarkMaps(),k=mapKeyOf(g.db,g.table,g.mode),on=p.isDefault||p.isLocked||idsAt(m.def,k).includes(String(p.id))||idsAt(m.lock,k).includes(String(p.id));
        return {name:p.name,filters:p.filters||[],shared:!p.owner,isDefault:on,isLocked:on}})}))};
    WL.base.saveBlob(new Blob([JSON.stringify(payload,null,1)],{type:'application/json'}),ioFileName());
    showToast?.('保存したフィルタを書き出しました',`${groups.length}つの一覧・${groups.reduce((a,g)=>a+g.presets.length,0)}件（${ioFileName()}）`,4200);
  }
  /* 取り込む（同じ名前は上書きか残すかを選ぶ・印も名前で当て直す）。 */
  async function ioImport(st,all){
    let added=0,updated=0,skipped=0,failed=0;
    for(const g of st.parsed.groups.filter(x=>st.chosen.has(x.key))){
      const byName=new Map(all.filter(p=>ioGroupKey(p)===g.key).map(p=>[p.name,p])),marks=[];
      for(const p of g.presets){
        const dup=byName.get(p.name);
        if(dup&&!st.overwrite){skipped++;continue}
        try{
          const r=await jpost('/api/filter-presets',{name:p.name,db:g.db,table:g.table,mode:g.mode,filters:p.filters,user:filterUserId(),shared:!!p.shared});
          r&&r.registered?added++:updated++;
          if(st.withMarks&&r&&r.id!=null)marks.push({id:r.id,isDefault:p.isDefault,isLocked:p.isDefault});
        }catch(_){failed++}
      }
      if(marks.length){
        const m=ensureMarkMaps(),k=mapKeyOf(g.db,g.table,g.mode);
        ['def','lock'].forEach(x=>{const s=new Set(idsAt(m[x],k));marks.forEach(it=>it.isDefault?s.add(String(it.id)):s.delete(String(it.id)));m[x][k]=[...s]});
        writeMarkMirror();
        await jpost('/api/filter-presets/marks',{user:filterUserId(),items:marks}).catch(WL.quiet('取り込んだ印をマスタへ残せない（端末の控えには入っている）'));
      }
    }
    await loadMasterPresets();renderBar();
    const parts=[added&&`新規${added}件`,updated&&`上書き${updated}件`,skipped&&`そのまま${skipped}件`,failed&&`失敗${failed}件`].filter(Boolean);
    showToast?.(failed?'一部を取り込めませんでした':'保存したフィルタを取り込みました',parts.join(' / ')||'変更はありません',failed?7000:4200);
  }

  /* ============================================================
     一覧とのつなぎ（登録口だけ・被せない §9.352）
     ============================================================ */
  WL.listHooks.onQuery(q=>{
    syncFilterContext();
    if(S.genericFilters.length)q.set('filters',JSON.stringify(expandFilterList(S.genericFilters)));
    saveActiveFilterState();
  });
  WL.listHooks.onAfter(()=>renderBar());
  /* 効いている条件を名乗る（0件の案内・すべて外す が同じ並びを読む・§9.453・§9.612）。 */
  WL.listHooks.onNarrow(()=>{
    const items=S.genericFilters.map(f=>({source:'条件',text:condLabel(f),locked:isLockedFilter(f),kind:'cond'}));
    return items.length?{items,clear:()=>dropAllFilters()}:null;
  });
  /* 使用設備が変わったら、変数を使っている条件で引き直す（§9.285 ①）。 */
  WL.equipment.onChange(now=>{
    const uses=S.genericFilters.filter(f=>filterVarFor(f.value));
    renderBar();
    if(!uses.length||!S.db||!S.table)return;
    S.page=1;if(typeof WL.list.load==='function')WL.list.load();
    showToast?.('使用設備を切り替えました',`変数を使っている絞り込み ${uses.length}件 を「${now||'未登録'}」で当て直しました。`,5000);
  });
  WL.listHooks.onTabs(()=>{ensureGenericFilterBar();renderBar()});
  WL.listHooks.onGrid(()=>renderBar());
  /* 表を選ぶ前に、その一覧の覚え・保存したフィルタ・いつも適用をそろえる（1回目の問い合わせから効く・§9.184）。 */
  WL.listHooks.onBeforeSelectTable(async t=>{
    if(activeFilterContextKey!=null)saveActiveFilterState(activeFilterUid);
    const key=defaultMapKey(S.db,t);
    S.genericFilters=restoreActiveFilterState(key);
    activeFilterContextKey=key;activeFilterUid=filterUserId();defaultsAppliedFor=null;
    await ensurePresetsFor(S.db,t);
    applyDefaultFiltersFor(S.db,t);
    if(presetsReady(S.db,t))defaultsAppliedFor=key;
  });
  /* ほかの部品から呼ぶ口（列の右クリック・表示の設定の読み込み・網）。 */
  WL.filters={
    openColumn:(col,anchor)=>openColumnPop(col,anchor),
    canFilter:col=>!!col&&!String(col).startsWith('__')&&(S.columns||[]).includes(col),
    filteredColumns:()=>new Set(S.genericFilters.map(f=>f.column)),
    replace:replaceFilters,
    state:()=>{const d=diffState();return {mode:presetMode(),selected:d.sel?{id:d.sel.id,name:d.sel.name}:null,dirty:d.dirty,
      added:[...d.added],changed:[...d.changed],removed:d.removed.map(filterKey),conds:S.genericFilters.map(f=>({...f,key:filterKey(f)}))}},
    reload:()=>loadMasterPresets(),
  };
  queueMicrotask(async()=>{
    ensureGenericFilterBar();renderBar();
    try{if(S.db&&S.table)await ensurePresetsFor(S.db,S.table);renderBar();reapplyDefaultFilters()}
    catch(_){WL.quiet.note('保存したフィルタを取れない（この一覧では絞り込みが空のまま）',_)}
  });
})();
