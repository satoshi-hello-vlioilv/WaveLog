"use strict";
/* measurement-tolerance.js: 判定公差ソース・測定ロック/監査 */
/* ============================================================
   測定種別の判定公差ソース（2026-07-20 追加）
   - 板厚・板幅・母材・揃い/肉厚/長さ: 従来の判定公差ロジックを使用。
   - ラテラルボー等（板厚でも板幅でもない項目）: 「指示_<項目>」の
     単一値を判定公差として取得。該当フィールドが無い測定種
     (テレスコープ・バリ・巻ずれ 等) は公差を表示しない。
   ============================================================ */
(function(){
  if(typeof toleranceDetail!=='function'||typeof compactToleranceFacts!=='function')return;
  // 測定種 -> 参照する「指示_*」フィールド候補（半角/全角の別名を許容）
  var INSTRUCTION_FIELDS={
    'ラテラルボー':['指示_ﾗﾃﾗﾙﾎﾞｰ','指示_ラテラルボー'],
    '直角度':['指示_直角度'],
    '中歪':['指示_中歪_高さ','指示_中歪'],
    '耳歪':['指示_耳歪_高さ','指示_耳歪'],
    'そり巾':['指示_そり巾_方向高さ','指示_そり巾'],
    'そり丈':['指示_そり丈_方向高さ','指示_そり丈']
  };
  /* 板厚・板幅は別々の入力内容(§9.138)。どちらも寸法系なので、判定公差は
     従来どおり製造/オーダー公差から引く（旧名も残す——保存済みレコードを
     `ensureMeasureShape`を通さずに読む帳票側から渡ってくることがある）。 */
  var DIMENSIONAL={'板厚':1,'板幅':1,'板厚/板幅':1,'母材':1,'揃い/肉厚/長さ':1};
  function norm(s){return (typeof normalizedFieldName==='function')?normalizedFieldName(s):String(s||'').normalize('NFKC').replace(/[\s　]+/g,'').toLowerCase();}
  function currentType(){return ($('#measureType')&&$('#measureType').value)||(S.measure&&S.measure.settings&&S.measure.settings.measureType)||'';}
  function instructionSingle(type){
    var cands=INSTRUCTION_FIELDS[type];
    if(!cands)return null;
    var src=(S.measure&&(S.measure.source||(S.measure.snapshot&&S.measure.snapshot.source)))||{};
    for(var i=0;i<cands.length;i++){
      var wn=norm(cands[i]);
      for(var k in src){
        if(norm(k)===wn){
          var num=Number(src[k]);
          if(Number.isFinite(num))return{value:num,key:k};
        }
      }
    }
    return null;
  }
  var baseDetail=toleranceDetail;
  /* 第3引数 typeName は画面の選択の代わり（§9.125）。**受け取って渡す**
     ——ここで捨てると、外側のラッパーが渡してきた項目名が根へ届かない。 */
  toleranceDetail=function(kind,index,typeName){
    var type=typeName||currentType();
    if(DIMENSIONAL[type])return baseDetail(kind,index,typeName);
    var single=instructionSingle(type);
    if(!single)return null; // 指示公差の該当なし -> 表示しない
    return {range:[0,single.value],source:'instruction',fallback:false,plus:single.value,minus:0,plusKey:single.key,minusKey:'',base:0,single:true,instructionType:type};
  };
  var baseFacts=compactToleranceFacts;
  compactToleranceFacts=function(kind){
    var detail=toleranceDetail(kind);
    if(detail&&detail.single){
      var label=detail.instructionType||'指示';
      var v=detail.plus;
      var html='<div class="compact-tol-three-row"><div class="tol-line tol-line-base"><span class="compact-tol-source">指示公差</span><span class="tol-value-pair"><small>'+esc(label)+'</small><b>'+esc(v)+'</b></span></div><div class="tol-line tol-line-range"><small>判定範囲</small><b>0 ～ '+esc(v)+'</b></div></div>';
      return {range:detail.range,html:html};
    }
    return baseFacts(kind);
  };
})();


/* ============================================================
 Current hotfix 2026-07-20: tolerance visual, manual audit,
 length/strip lock, and safer work-list fetch diagnostics.
 ============================================================ */
(function(){
  if(typeof $!=='function')return;
  const RESTRICTED_MANUAL_KEYS={thickness:'板厚',width:'板幅',lateral:'ラテラルボー',burr:'バリ'};
  const LOCKED_MEASUREMENT_KEYS=['thickness','width','lateral','burr','telescope','offset'];
  const pad2=n=>String(n).padStart(2,'0');
  function nowText(){const d=new Date();return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate())+' '+pad2(d.getHours())+':'+pad2(d.getMinutes())+':'+pad2(d.getSeconds())}
  function ensureManualLog(){if(!S.measure)return [];S.measure.manualInputLog=Array.isArray(S.measure.manualInputLog)?S.measure.manualInputLog:[];return S.measure.manualInputLog}
  function appendManualLog(reason,detail={}){
    if(!S.measure)return;
    const entry={at:new Date().toISOString(),timeText:nowText(),reason,operator:$('#operator')?.value||'',lengthPos:$('#lengthPos')?.value||'',measureType:$('#measureType')?.value||'',inputMode:S.measure.settings?.inputMode||'',...detail};
    ensureManualLog().push(entry);
    S.measure.settings=S.measure.settings||{};
    S.measure.settings.manualInputDetected=true;
    if(typeof markDirty==='function')markDirty();
  }
  function hasDimensionData(){
    if(!S.measure?.measurements)return false;
    return LOCKED_MEASUREMENT_KEYS.some(k=>(S.measure.measurements[k]||[]).some(row=>(row||[]).some(v=>String(v??'').trim()!=='')));
  }
  function updateDimensionLocks(){
    const locked=hasDimensionData();
    ['verticalCount','horizontalCount'].forEach(id=>{const el=$('#'+id);if(!el)return;el.disabled=locked;el.classList.toggle('dimension-locked',locked);el.title=locked?'丈数・条数に関係する測定データがあるため変更できません。対象データをすべて消すと変更できます。':''});
    const openSplit=$('#openSplit');if(openSplit){openSplit.disabled=locked;openSplit.title=locked?'測定データ入力後は条割を変更できません。対象データをすべて消すと変更できます。':''}
    return locked;
  }
  /* 公差の図示(compactToleranceScale)はここには**無い**。
     ------------------------------------------------------------
     以前はこのファイルにも「直前の1点だけを出す中間段階の見た目」の実装が
     あったが、`filters.js`(このファイルより後に読み込まれる)が同じ関数を
     **退避せずに丸ごと置き換える**ため、**一度も実行されない死んだコード**
     だった。3ファイルが同じ名前を定義していて、勝つのは読み込み順で最後の
     もの——読む側は`index.html`の並びを知らないと追えない。
     実際に画面へ出ているのは`filters.js`の数直線(`.accurate-numberline`)で、
     `measurement-worklog.js`がその上に指示型のカードをラップで足している。
     消しても画面の出力は1文字も変わらないことを実測で確かめてある
     (§9.96)。同じ名前の定義を増やさないよう`tests/test_patchlint.py`で見張る。 */

  // 手動入力モード切替時の警告と記録。
  function bindManualModeWarning(){
    document.querySelectorAll('[data-mode]').forEach(btn=>{
      if(btn.dataset.hotfixManualBound==='1')return;
      btn.dataset.hotfixManualBound='1';
      btn.addEventListener('click',event=>{
        if(btn.dataset.mode!=='manual'||!S.measure)return;
        const msg='手動入力は例外操作です。板厚・板幅・ラテラルボー・バリは自動転送が基本のため、手動入力に切り替えた事実を記録します。';
        alert(msg);
        appendManualLog('手動入力モードへ切替',{message:msg});
      },true);
    });
  }

  // 手動入力時はセルにフォーカスを残す。自動時は従来通り受信欄へ戻す。
  const baseBindMeasureInputs=typeof bindMeasureInputs==='function'?bindMeasureInputs:null;
  if(baseBindMeasureInputs){
    bindMeasureInputs=function(){
      baseBindMeasureInputs();
      document.querySelectorAll('[data-mkey]').forEach(el=>{
        el.addEventListener('focus',()=>{if(S.measure?.settings?.inputMode==='manual')el.select?.();});
        el.addEventListener('click',event=>{
          if(S.measure?.settings?.inputMode==='manual'){
            event.stopImmediatePropagation();
            if(el.dataset.mkey==='thickness')S.measure.settings.tStep=+el.dataset.j;else S.measure.settings.wStep=+el.dataset.j;
            el.readOnly=false;el.tabIndex=0;el.focus();setTimeout(()=>el.select?.(),0);
          }
        },true);
        el.addEventListener('input',()=>{
          if(S.measure?.settings?.inputMode==='manual'&&RESTRICTED_MANUAL_KEYS[el.dataset.mkey]){
            appendManualLog('手動入力値を記録',{item:RESTRICTED_MANUAL_KEYS[el.dataset.mkey],row:Number(el.dataset.i)+1,column:Number(el.dataset.j)+1,value:el.value});
          }
          updateDimensionLocks();
        },true);
      });
      updateDimensionLocks();
      bindManualModeWarning();
    };
  }

  // 受信欄から manual として入った場合も記録する。
  if(typeof processDeviceInput==='function'){
    const baseProcessDeviceInput=processDeviceInput;
    processDeviceInput=function(raw){
      const parsed=typeof deviceParse==='function'?deviceParse(raw):null;
      const beforeKey=typeof activeMeasureKey==='function'?activeMeasureKey():'';
      if(parsed?.device==='manual'&&['thickness','width','lateral','burr'].includes(beforeKey)){
        appendManualLog('受信欄から手動数値を登録',{item:RESTRICTED_MANUAL_KEYS[beforeKey]||beforeKey,value:parsed.value});
      }
      const result=baseProcessDeviceInput(raw);
      updateDimensionLocks();
      return result;
    };
  }

  // collect/ensure に手動入力ログとロック状態を保持する。
  if(typeof collect==='function'){
    const baseCollect=collect;
    collect=function(){const m=baseCollect();m.manualInputLog=ensureManualLog();m.settings.dimensionLocked=hasDimensionData();return m;};
  }
  if(typeof ensureMeasureShape==='function'){
    const baseEnsure=ensureMeasureShape;
    ensureMeasureShape=function(m){m=baseEnsure(m);if(m){m.manualInputLog=Array.isArray(m.manualInputLog)?m.manualInputLog:[];m.settings=m.settings||{};m.settings.dimensionLocked=!!m.settings.dimensionLocked;}return m;};
  }

  // 丈位置・測定種別切替時は保存済み配列から再描画し、続きから入力する。
  ['lengthPos','measureType'].forEach(id=>{const el=$('#'+id);if(el&&el.dataset.hotfixSwitchBound!=='1'){el.dataset.hotfixSwitchBound='1';el.addEventListener('change',()=>{if(typeof renderMeasureGrid==='function')renderMeasureGrid();updateDimensionLocks();},true);}});
  ['verticalCount','horizontalCount'].forEach(id=>{const el=$('#'+id);if(el&&el.dataset.hotfixCountBound!=='1'){el.dataset.hotfixCountBound='1';el.addEventListener('mousedown',event=>{if(hasDimensionData()){event.preventDefault();showToast?.('丈数・条数は変更できません','測定データをすべて消すと再度変更できます。',4500)}},true);}});

  // fetch失敗時の原因表示は、先頭のapi関数で一元対応。

  // 画面描画後に必ず再適用。
  if(typeof renderMeasurement==='function'){
    const baseRenderMeasurement=renderMeasurement;
    renderMeasurement=function(){baseRenderMeasurement();bindManualModeWarning();updateDimensionLocks();};
  }
  if(typeof renderMeasureGrid==='function'){
    const baseRenderMeasureGrid=renderMeasureGrid;
    renderMeasureGrid=function(){baseRenderMeasureGrid();updateDimensionLocks();};
  }
  queueMicrotask(()=>{bindManualModeWarning();updateDimensionLocks();});
})();


