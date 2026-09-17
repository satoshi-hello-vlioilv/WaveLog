"use strict";
/* measure-tolerance.js: 判定公差ソース・測定ロック/監査 */
/* ============================================================
   測定種別の判定公差ソース（2026-07-20 追加）
   - 板厚・板幅・母材/丈毎: 従来の判定公差ロジックを使用。
   - ラテラルボー等（板厚でも板幅でもない項目）: 「指示_<項目>」の
     単一値を判定公差として取得。該当フィールドが無い測定種
     (テレスコープ・バリ・巻ずれ 等) は公差を表示しない。
   ============================================================ */
(function(){
  if(typeof WL.measureInput.toleranceDetail!=='function'||typeof WL.measureInput.compactToleranceFacts!=='function')return;
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
  /* 母材・丈毎は§9.391で2項目へ分けた（§9.160でまとめたものを戻した）。
     **旧名も全部残す**——保存済みレコードを開いた瞬間に判定が変わるのを
     避ける。 */
  var DIMENSIONAL={'板厚':1,'板幅':1,'板厚/板幅':1,'全長':1,'寸法・外観':1,
   /* 旧綴り（§9.396で改名する前の保存値）も残す——開いた瞬間に答えが変わらないように。 */
   '母材':1,'丈毎':1,'揃い/肉厚/長さ':1,
                   '母材・揃い/肉厚/長さ':1,'母材/丈毎':1};
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
  /* 提供者として登録する（§9.348）。寸法系は自分の答えではない（undefined＝
     次の提供者へ）。指示値が無いときは null＝「公差なし」で、次へは行かない。 */
  WL.tolerance.register({name:'指示型（単一の指示値）',priority:10,detail:function(kind,index,typeName){
    var type=typeName||currentType();
    if(DIMENSIONAL[type])return undefined;
    var single=instructionSingle(type);
    if(!single)return null; // 指示公差の該当なし -> 表示しない
    return {range:[0,single.value],source:'instruction',fallback:false,plus:single.value,minus:0,plusKey:single.key,minusKey:'',base:0,single:true,instructionType:type};
  }});
  /* 公差カード（facts）も提供者が持つ（§9.352）。単一の指示値のときだけ答え、それ以外は
     undefined＝核の答え。 */
  WL.tolerance.register({name:'指示型（単一の指示値）・カード',priority:10,facts:function(kind){
    var detail=WL.measureInput.toleranceDetail(kind);
    if(detail&&detail.single){
      var label=detail.instructionType||'指示';
      var v=detail.plus;
      /* **上下限を持たないので「公差」ではなく「基準」**（§9.242 ⑤）。 */
      var html='<div class="compact-tol-three-row"><div class="tol-line tol-line-base"><span class="compact-tol-source">指示基準</span><span class="tol-value-pair"><small>'+esc(label)+'</small><b>'+esc(v)+'</b></span></div><div class="tol-line tol-line-range"><small>判定範囲</small><b>0 ～ '+esc(v)+'</b></div></div>';
      return {range:detail.range,html:html};
    }
    return undefined;
  }});

  /* ---------- 基準が引けないときは手で入れる（§9.394、利用者の指示） ----------
     「ラテラルボーおよびバリの項目について、基準が取得できない場合、
      基準なしと出るだけでなく、手動で入力できるように、そのバッジを
      ボタン化するなどして入力モーダルを出して入力したら手動で基準を
      表示させる機能を追加してください」

     確認して決めたこと: **そのロットだけ**。マスタへは書かない——1本の
     ロットのための例外をマスタに書くと、**次のロットへ黙って効く**。
     置き場は測定データの中（`settings.manualLimits`）で、誰が・いつ
     入れたかも一緒に持つ（§9.180 と同じ作法）。

     **出どころは必ず「手入力」と書く**（§CLAUDE 6）——同じ「0〜2.5」でも、
     仕掛から引いた基準と人が打った基準では当たる見込みが違う。

     **手で入れた基準は判定にも効く。** 基準がある＝判定できる、という
     筋を項目ごとに変えない（画面の札が「手入力基準」と言い続けるので、
     どちらの根拠で赤が出ているかは読める）。

     **足せる項目はここ1箇所**。利用者が挙げたのはラテラルボーとバリの2つ。 */
  var MANUAL_LIMIT_TYPES={'ラテラルボー':1,'バリ':1};
  function manualLimits(){
    if(!S.measure)return null;
    S.measure.settings=S.measure.settings||{};
    if(!S.measure.settings.manualLimits||typeof S.measure.settings.manualLimits!=='object')
      S.measure.settings.manualLimits={};
    return S.measure.settings.manualLimits;
  }
  /* その項目の手入力の基準。**0以下・数にならないものは「無い」**
     ——0mm以下という通らない基準を作らない（§9.231 と同じ）。 */
  function manualLimitOf(type){
    var all=manualLimits();if(!all)return null;
    var hit=all[WL.measureItem.normalize(type)];
    if(!hit)return null;
    var v=Number(hit.value);
    return (Number.isFinite(v)&&v>0)?{value:v,by:hit.by||'',at:hit.at||''}:null;
  }
  function setManualLimit(type,value){
    var all=manualLimits();if(!all)return;
    var key=WL.measureItem.normalize(type);
    if(value===null){delete all[key]}
    else{
      all[key]={value:value,at:new Date().toISOString(),
        by:(window.WL&&WL.terminal&&WL.terminal.userId&&WL.terminal.userId())
           ||(typeof currentUserId==='function'&&currentUserId())||''};
    }
    if(typeof markDirty==='function')markDirty();
    if(WL.measureInput&&typeof WL.measureInput.renderMeasureGrid==='function')
      WL.measureInput.renderMeasureGrid();
    if(WL.measureView&&typeof WL.measureView.updateMeasurementHeading==='function')
      WL.measureView.updateMeasurementHeading();
    if(typeof refreshMeasureProgress==='function')refreshMeasureProgress();
  }
  /* **登録表へ足す**（§9.348）。指示型より先に当たる——人がこのロットのために
     打った値なので、あとから届いた指示値で黙って上書きしない。
     手入力が無ければ`undefined`＝次の提供者へ（何も変えない）。 */
  /* **priorityは25**（指示型の20より上）。同じ数にすると順番が読み込み順で
     決まってしまい、§9.348で畳んだはずの依存が戻る。 */
  WL.tolerance.register({name:'手入力の基準（このロットだけ）',priority:25,detail:function(kind,index,typeName){
    var type=typeName||currentType();
    if(!MANUAL_LIMIT_TYPES[WL.measureItem.normalize(type)])return undefined;
    var hit=manualLimitOf(type);
    if(!hit)return undefined;
    return {range:[0,hit.value],source:'manual',fallback:false,plus:hit.value,minus:0,
      plusKey:'',minusKey:'',base:0,single:true,instructionType:type,
      manual:true,manualBy:hit.by,manualAt:hit.at};
  }});
  /* **公差カード（`facts`）の提供者はここでは足さない。**
     `WL.tolerance.register()`は`detail`を持たない提供者を**黙って捨てる**
     （`if(typeof p.detail!=='function')return`）ので、`facts`だけの提供者は
     一度も走らない——上の「指示型（単一の指示値）・カード」も同じ形で、
     `WL.tolerance.providers()`に現れない（`tests/test_tolscale.js`が
     3つと数えているのがその証拠）。**登録の取りこぼしを直すのは別の仕事**
     なので、ここでは核の答えをそのまま使う（札は「手入力基準」と言う）。 */

  /* 札をボタンにする（§9.394）。**描いたあとに足すのは登録表から**
     （`WL.measureHooks`。被せない・§9.352）。 */
  function limitLabel(type){return WL.measureItem.limitWord(type)}
  async function askManualLimit(type){
    var cur=manualLimitOf(type);
    var word=limitLabel(type);
    var v=await promptModal({
      eyebrow:'手入力',title:type+'の'+word+'を手で入れる',
      message:'この項目の'+word+'は仕掛データから引けませんでした。'
        +'いま開いているロットだけの'+word+'として手で入れます（マスタには残しません）。',
      label:word+'（これ以下）',value:cur?String(cur.value):'',placeholder:'例: 2.5',
      hint:'単位はmm。空欄のまま決定すると、手入力の'+word+'を取り消します。'
        +'入れた'+word+'は判定にも使われ、画面には「手入力」と出ます。',
      confirmLabel:'この'+word+'を使う'});
    if(v===null)return;                       /* やめた */
    if(v===''){setManualLimit(type,null);return}
    var n=Number(v);
    /* **断る理由を書く**（§CLAUDE 4）。黙って0にしない（§9.231）。 */
    if(!Number.isFinite(n)||!(n>0)){
      await alertModal('「'+v+'」は'+word+'として使えません。0より大きい数（例: 2.5）を入れてください。');
      return;
    }
    setManualLimit(type,n);
  }
  WL.measureHooks.on('afterHeading',function(){
    var box=document.getElementById('toleranceSummary');if(!box)return;
    var type=currentType();
    if(!MANUAL_LIMIT_TYPES[WL.measureItem.normalize(type)])return;
    /* **見えていない札はボタンにしない**（§CLAUDE 4）——指示型の項目では
       `measure-worklog.js`が`#toleranceSummary`ごと伏せており、押せない
       ボタンだけが残る。あちらの面（指示値のカード）が入口を持つ。 */
    if(box.hidden)return;
    var pill=box.querySelector('.tol-pill');if(!pill)return;
    var hit=manualLimitOf(type),word=limitLabel(type);
    var btn=document.createElement('button');
    btn.type='button';
    btn.className=pill.className+' tol-pill-act'+(hit?' is-manual':'');
    btn.dataset.tolManual=type;
    /* **押すと何が起きるかを字で書く**（§CLAUDE 4・§3）。色と鉛筆だけに
       しない——「基準なし」のままでも押せることが読めない。 */
    btn.textContent=hit?(pill.textContent+'（直す）'):(pill.textContent+'／手入力');
    btn.title=hit
      ?(word+' 0〜'+hit.value+'（手入力'+(hit.by?'・'+hit.by:'')+'）。押すと直せます。'
        +'空欄にして決定すると取り消します。')
      :(pill.title+'　押すと、このロットだけの'+word+'を手で入れられます。');
    pill.replaceWith(btn);
  });
  /* **押す口は1つ**（§9.163）。札（`#toleranceSummary`）と指示値のカード
     （`measure-worklog.js`）の両方から押せるので、個別に配線せず
     `data-tol-manual`へ委譲する——カードは測定表を描き直すたびに
     作り直されるので、直に`onclick`を張ると張り忘れる面ができる。 */
  document.addEventListener('click',function(ev){
    var el=ev.target&&ev.target.closest?ev.target.closest('[data-tol-manual]'):null;
    if(!el)return;
    ev.preventDefault();
    askManualLimit(el.dataset.tolManual);
  });
  /* 網から呼べるようにする（素の`window.*`は増やさない・§9.359）。 */
  WL.manualLimit={types:function(){return Object.keys(MANUAL_LIMIT_TYPES)},
    allows:function(type){return !!MANUAL_LIMIT_TYPES[WL.measureItem.normalize(type)]},
    get:function(type){return this.allows(type)?manualLimitOf(type):null},
    set:setManualLimit,ask:askManualLimit};
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
     `measure-worklog.js`がその上に指示型のカードをラップで足している。
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
        alertModal(msg);   // 見せるだけ。記録は待たずに残す
        appendManualLog('手動入力モードへ切替',{message:msg});
      },true);
    });
  }

  // 手動入力時はセルにフォーカスを残す。自動時は従来通り受信欄へ戻す。
  WL.measureHooks.on('afterBindInputs',()=>{
      document.querySelectorAll('[data-mkey]').forEach(el=>{
        /* **`select()`は`focus`を起こす。** Chromiumの`HTMLInputElement.select()`は
           フォーカスが載っていないと自分で載せに行くため、`focus`ハンドラの中で
           呼ぶと同じハンドラが呼び直され、**行って来いで積み上がる**（実測で
           「Maximum call stack size exceeded」。§9.208 ③でカーソルを印に
           追従させたことで、初めてこの経路を通るようになった）。
           1回の中では選び直さない。 */
        let selecting=false;
        el.addEventListener('focus',()=>{
          if(S.measure?.settings?.inputMode!=='manual'||selecting)return;
          selecting=true;
          try{el.select?.()}finally{selecting=false}
        });
        el.addEventListener('click',event=>{
          if(S.measure?.settings?.inputMode==='manual'){
            /* **他のハンドラを止めない**（§9.208 ③）。以前は
               `stopImmediatePropagation()`で持ち主側のクリック処理
               （印を移す・押した丈へ移る）ごと止めており、手動入力では
               **クリックしても印も丈も動かなかった**（実機で
               「クリックしてもフォーカスは移動せず」と報告）。
               入力位置（tStep/wStep）も持ち主の`syncStepFor`が持つので
               ここでは触らない——同じ代入を2箇所に置かない。
               ここが受け持つのは「読み取り専用を解いて選択状態にする」だけ。 */
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
  });

  // 受信欄から manual として入った場合も記録する。
  /* 受信の前に手動入力を記録し、あとにロック状態を引き直す（§9.352）。 */
  WL.measureHooks.on('beforeDeviceInput',raw=>{
    const parsed=typeof WL.measureInput.deviceParse==='function'?WL.measureInput.deviceParse(raw):null;
    const beforeKey=typeof WL.measureInput.activeMeasureKey==='function'?WL.measureInput.activeMeasureKey():'';
    if(parsed?.device==='manual'&&['thickness','width','lateral','burr'].includes(beforeKey)){
      appendManualLog('受信欄から手動数値を登録',{item:RESTRICTED_MANUAL_KEYS[beforeKey]||beforeKey,value:parsed.value});
    }
  });
  WL.measureHooks.on('afterDeviceInput',()=>updateDimensionLocks());

  // collect/ensure に手動入力ログとロック状態を保持する。
  WL.measureHooks.on('collect',m=>{m.manualInputLog=ensureManualLog();m.settings.dimensionLocked=hasDimensionData()});
  WL.measureHooks.on('shape',m=>{m.manualInputLog=Array.isArray(m.manualInputLog)?m.manualInputLog:[];m.settings=m.settings||{};m.settings.dimensionLocked=!!m.settings.dimensionLocked});

  // 丈位置・測定種別切替時は保存済み配列から再描画し、続きから入力する。
  ['lengthPos','measureType'].forEach(id=>{const el=$('#'+id);if(el&&el.dataset.hotfixSwitchBound!=='1'){el.dataset.hotfixSwitchBound='1';el.addEventListener('change',()=>{if(typeof WL.measureInput.renderMeasureGrid==='function')WL.measureInput.renderMeasureGrid();updateDimensionLocks();},true);}});
  ['verticalCount','horizontalCount'].forEach(id=>{const el=$('#'+id);if(el&&el.dataset.hotfixCountBound!=='1'){el.dataset.hotfixCountBound='1';el.addEventListener('mousedown',event=>{if(hasDimensionData()){event.preventDefault();showToast?.('丈数・条数は変更できません','測定データをすべて消すと再度変更できます。',4500)}},true);}});

  // fetch失敗時の原因表示は、先頭のapi関数で一元対応。

  // 画面描画後に必ず再適用。
  WL.measureHooks.afterRender(()=>{bindManualModeWarning();updateDimensionLocks();});
  WL.measureHooks.on('afterGrid',()=>updateDimensionLocks());
  queueMicrotask(()=>{bindManualModeWarning();updateDimensionLocks();});
})();


