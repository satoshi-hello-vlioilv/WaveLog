"use strict";
/* lot-split.js: 条割(分割)ロットの公差を条ごとに正しく判定へ反映する。
   ------------------------------------------------------------
   背景: 条割変更(#openSplit)は既に存在し、どの条がどの子ロットに
   属するかを並び替えで指定できる。しかし旧実装は splitGroups/
   toleranceTags を保存するだけで、実際の判定(toleranceDetail)は
   常に「現在開いている親ロット1つ分」の製造板厚・製造板幅と、その
   親ロット自身の公差プラス/マイナスのみを使っていた。分割後は
   子ロットごとに目標幅・公差が異なりうるため、これは判定として
   誤りうる。

   参考にした旧VBA(添付 [A1]グローバル接続INPUT / [A2]測定ロジック)
   の考え方:
   - 親ロットの KOCARD1〜KOCARD10 から子ロット番号を復元する(KCDNO)。
   - 子ロット番号ごとに仕掛(SIKALOTNOW)へ再検索をかけ、その子ロット
     自身の製造板厚・製造板幅・オーダー/製造の公差プラスマイナスを
     取得する(GetKLTArr)。
   - 条位置ごとにどの子ロットに属するかを管理し(Lb(k).Tag)、判定時は
     その子ロット自身の値で範囲(上限/下限)を計算する(SetTolerance)。

   本ファイルはこの考え方をWaveLogのデータ構造に合わせて実装する。
   子ロットの実データが取得できない場合は、安全側として従来通り
   親ロット1つの公差にフォールバックする(誤ったOK/NG判定を出さない
   ことを優先し、機能が使えないだけの状態に留める)。
   ============================================================ */
(function(){
  if(typeof toleranceDetail!=='function'||typeof $!=='function'||typeof api!=='function')return;

  function norm(s){return typeof normalizedFieldName==='function'?normalizedFieldName(s):String(s||'')}
  function numberFromRow(row,names){
    if(!row)return null;
    for(const want of names){
      const wn=norm(want);
      for(const k in row){
        if(norm(k)===wn){
          const num=Number(row[k]);
          if(Number.isFinite(num))return{value:num,key:k};
        }
      }
    }
    return null;
  }
  function baseFromRow(row,kind){
    const names=kind==='thickness'?['製造板厚','LTX']:['製造板幅','LTY'];
    const f=numberFromRow(row,names);return f?f.value:NaN;
  }
  function toleranceFromRow(row,kind,source){
    const isT=kind==='thickness',dimension=isT?'板厚':'板幅';
    const fields=source==='order'
      ?{plus:[`${dimension}公差_ｵｰﾀﾞｰ_ﾌﾟﾗｽ`,`${dimension}公差_オーダー_プラス`,isT?'KOSAXSOP':'KOSAYSOP'],minus:[`${dimension}公差_ｵｰﾀﾞｰ_ﾏｲﾅｽ`,`${dimension}公差_オーダー_マイナス`,isT?'KOSAXSOM':'KOSAYSOM']}
      :{plus:[`${dimension}公差_製造_ﾌﾟﾗｽ`,`${dimension}公差_製造_プラス`,isT?'KOSAXSMP':'KOSAYSMP'],minus:[`${dimension}公差_製造_ﾏｲﾅｽ`,`${dimension}公差_製造_マイナス`,isT?'KOSAXSMM':'KOSAYSMM']};
    const p=numberFromRow(row,fields.plus),m=numberFromRow(row,fields.minus);
    return p&&m?{plus:p.value,minus:m.value,plusKey:p.key,minusKey:m.key}:null;
  }

  // 親ロット自身(=分割していない/自分の持ち分)のtolデータは、既存のcore.js
  // toleranceDataForSource()をそのまま使う(重複ロジックを避ける)。
  function selfSource(){
    const b=S.measure.basic;
    return{
      lot:String(b.lotNo||'当ロット'),self:true,missing:false,
      base:{thickness:Number(b.mfgThickness),width:Number(b.mfgWidth)},
      tolData:{
        thickness:{manufacturing:typeof toleranceDataForSource==='function'?toleranceDataForSource('thickness','manufacturing'):null,order:typeof toleranceDataForSource==='function'?toleranceDataForSource('thickness','order'):null},
        width:{manufacturing:typeof toleranceDataForSource==='function'?toleranceDataForSource('width','manufacturing'):null,order:typeof toleranceDataForSource==='function'?toleranceDataForSource('width','order'):null}
      }
    };
  }

  /* 分割(子ロット)関連の実カラム名は「親子管理_子カード<N>」「コンマ5本分割_
     切断巾<N>」であることが実データで確認された(旧VBA変数名KOCARD/K05JO等は
     内部エイリアスであり、Accessの生カラム名ではなかった)。全角/半角ゆれや
     旧エイリアスも候補として保持し、複数パターンを試す。 */
  const CHILD_CARD_PREFIXES=['親子管理_子カード','親子管理_子ｶｰﾄﾞ','KOCARD'];
  const CHILD_CUTWIDTH_PREFIXES=['コンマ5本分割_切断巾','ｺﾝﾏ5本分割_切断巾','K05W'];
  const CHILD_COUNT_PREFIXES=['YK','K05JO'];
  function fieldByCandidates(r,names){
    for(const n of names){
      const v=r?.[n];
      if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;
    }
    return undefined;
  }
  function childCardValue(r,i){return fieldByCandidates(r,CHILD_CARD_PREFIXES.map(p=>p+i))}
  function childCutWidthValue(r,i){return fieldByCandidates(r,CHILD_CUTWIDTH_PREFIXES.map(p=>p+i))}
  function childCountFieldValue(r,i){return fieldByCandidates(r,CHILD_COUNT_PREFIXES.map(p=>p+i))}
  // 親子管理_子カード1〜10から子ロット番号を復元する(旧VBA KCDNO相当)。
  // 1〜9: ロット番号の先頭6桁+1桁、10〜99: 先頭5桁+2桁で末尾を置換。
  // row/lotNoを省略すると現在開いている測定(S.measure)を対象にする。
  function childLotNumbersFromCard(row,lotNo){
    const r=row||S.measure?.source||{};
    lotNo=lotNo!==undefined?lotNo:String(S.measure?.basic?.lotNo||'');
    if(!lotNo)return [];
    const out=[];
    for(let i=1;i<=10;i++){
      const raw=childCardValue(r,i);
      if(raw===undefined)break;
      const n=Number(raw);
      if(!Number.isFinite(n)||n<=0)break;
      if(n>=1&&n<=9)out.push({lot:lotNo.slice(0,6)+String(n),index:i});
      else if(n>=10&&n<=99)out.push({lot:lotNo.slice(0,5)+String(n).padStart(2,'0'),index:i});
      else break;
    }
    return out;
  }
  // 同一行に子ロット番号が直接入っているケース(LTNO1..8)。
  function directChildLotNumbers(){
    const r=S.measure?.source||{},out=[];
    for(let i=1;i<=8;i++){
      const lot=r['LTNO'+i]||r['分割ロット'+i];
      if(lot)out.push({lot:String(lot),index:i});
    }
    return out;
  }
  // 条数は本来コンマ5本分割_切断巾側から特定できる想定だが、実データでの
  // フィールド確証が取れるまでの安全側フォールバックとして、専用の条数系
  // 候補が無ければ「切断巾に値がある行を1条」として数える。
  function childCount(i){
    const r=S.measure?.source||{};
    const v=childCountFieldValue(r,i);
    if(v!==undefined){const n=Number(v);if(Number.isFinite(n)&&n>0)return n}
    const w=childCutWidthValue(r,i);
    if(w!==undefined&&Number(w)!==0)return 1;
    return 0;
  }
  // 仕掛データ一覧(グリッド)側で「分割あり/なし」を判定するための、行(生データ)
  // 単位のチェック。親子管理_子カード・コンマ5本分割_切断巾のいずれかに
  // 意味のある値(0以外)があれば分割ありとみなす。
  function rowHasSplitData(row){
    if(!row)return false;
    for(let i=1;i<=10;i++){
      const v=childCardValue(row,i);
      if(v!==undefined&&Number(v)!==0)return true;
    }
    for(let i=1;i<=10;i++){
      const v=childCutWidthValue(row,i);
      if(v!==undefined&&Number(v)!==0)return true;
    }
    return false;
  }
  window.rowHasSplitData=rowHasSplitData;

  /* 分割には「全く同一幅で分割するパターン」と「幅の異なるロットへ分割
     するパターン」の両方があるため、行の生データだけで分かる範囲で
     ロット数・同一幅/異幅を判定する(子ロットの再検索なしで済む軽量版)。
     コンマ5本分割_切断巾*が2件以上あれば、その値同士を比較して判定する。
     判定材料が無ければwidthPattern='unknown'とする。 */
  function analyzeRowSplit(row){
    if(!row||!rowHasSplitData(row))return{hasSplit:false,lotCount:1,widthPattern:'none'};
    let cardCount=0;
    for(let i=1;i<=10;i++){const v=childCardValue(row,i);if(v!==undefined&&Number(v)!==0)cardCount++}
    const cutWidths=[];
    for(let i=1;i<=10;i++){const w=childCutWidthValue(row,i);if(w!==undefined&&Number(w)!==0)cutWidths.push(Number(w))}
    const lotCount=Math.max(cardCount,cutWidths.length)+1; // +1: 自分(親)の持ち分
    let widthPattern='unknown';
    if(cutWidths.length>=2)widthPattern=cutWidths.every(w=>Math.abs(w-cutWidths[0])<0.05)?'same':'different';
    return{hasSplit:true,lotCount,widthPattern};
  }
  window.analyzeRowSplit=analyzeRowSplit;
  function widthPatternLabel(p){return p==='same'?'同一幅分割':p==='different'?'異幅分割':'幅パターン不明'}
  // applySplit後の確定データ(子ロット自身から取得した実際の幅)を使った、
  // より正確な同一幅/異幅・ロット数の要約。
  function summarizeAppliedGroups(groups){
    const widths=groups.map(g=>g.base?.width).filter(w=>Number.isFinite(w));
    let pattern='幅情報なし';
    if(widths.length>=2)pattern=widths.every(w=>Math.abs(w-widths[0])<0.05)?'同一幅分割':'異幅分割';
    else if(widths.length===1)pattern='単一幅';
    return `${groups.length}ロットに分割（${pattern}）`;
  }

  /* 仕掛一覧(SIKALOTNOW)の列表示マスタで「親子管理_子カード*」「コンマ5本
     分割_切断巾*」等が非表示設定にされていると、通常の一覧取得(/api/table)
     ではこれらの列がレスポンスから丸ごと除外され、分割の判定材料が
     一切手に入らなくなる(表示設定はあくまで一覧の見た目の話であり、
     内部計算がそれに引きずられるべきではない)。このため分割機能が使う
     問い合わせは全て include_hidden=1 を付け、非表示設定に関係なく
     生データを取得する。 */
  async function resolveSikaTable(){
    if(S.measure?.settings?.sourceTable)return S.measure.settings.sourceTable;
    const info=await api('/api/tables?db=SIKALOTNOW');
    return info.tables?.[0]||null;
  }
  async function resolveSikaColumns(table){
    const d=await api('/api/table?'+new URLSearchParams({db:'SIKALOTNOW',table,page:1,page_size:1,include_hidden:1}));
    return d.columns||[];
  }
  function findColumn(columns,candidates){
    for(const c of candidates)if(columns.includes(c))return c;
    for(const c of candidates){const wn=norm(c);const hit=columns.find(x=>norm(x)===wn);if(hit)return hit}
    return null;
  }
  // 子ロット自身のレコードをSIKALOTNOWへ再検索する(旧VBA GetKLTArr相当)。
  async function fetchChildLotRow(lotNo){
    try{
      const table=await resolveSikaTable();if(!table)return null;
      const columns=await resolveSikaColumns(table);if(!columns.length)return null;
      const lotCol=findColumn(columns,aliases.lotNo);if(!lotCol)return null;
      const filters=[{column:lotCol,op:'eq',value:lotNo}];
      const equipCol=findColumn(columns,aliases.equipment),equipment=typeof currentConfiguredEquipment==='function'?currentConfiguredEquipment():'';
      if(equipCol&&equipment)filters.push({column:equipCol,op:'contains',value:equipment});
      const params=new URLSearchParams({db:'SIKALOTNOW',table,page:1,page_size:5,include_hidden:1,filters:JSON.stringify(filters)});
      const d=await api('/api/table?'+params);
      return d.rows?.[0]||null;
    }catch(e){console.warn('子ロット再検索に失敗しました: '+lotNo,e);return null}
  }
  // 現在開いているロット自身の完全な生データ(非表示列を含む)を取得し、
  // S.measure.sourceへマージする。一覧取得時点では列表示マスタにより
  // 分割関連の列が欠落している可能性があるため、測定画面を開いた際に
  // 一度だけ取り直して補う。
  async function refreshSelfSourceFull(){
    if(!S.measure)return;
    const lotNo=S.measure.basic?.lotNo;if(!lotNo)return;
    try{
      const row=await fetchChildLotRow(lotNo);
      if(row)S.measure.source={...(S.measure.source||{}),...row};
    }catch(e){console.warn('自ロットの完全データ取得に失敗しました',e)}
  }

  /* 仕掛一覧から「子ロット」の行を直接クリックした場合、そのロット単独の
     データは分割後の一部でしかなく不完全なことがある(旧システムにも、
     子ロットを開いたら親ロットのデータへ読み替える仕組みがあったとの
     ことなので、同様の考え方をデータエラー回避用として実装する)。
     子ロット番号は親ロット番号の先頭5〜6桁を共有し末尾1〜2桁だけが
     異なる構成のため、同じ先頭5桁を持つ候補行の中から、親子管理_子カード
     が実際にこのロット番号を指しているものを探して親ロットとする。
     行が自分自身の子カードを持つ(=既に親ロット)場合は探さない。 */
  async function findParentLotFor(row){
    if(!row||rowHasSplitData(row))return null;
    const lotNo=String(pick(row,'lotNo')||'');
    if(lotNo.length<6)return null;
    try{
      const table=await resolveSikaTable();if(!table)return null;
      const columns=await resolveSikaColumns(table);if(!columns.length)return null;
      const lotCol=findColumn(columns,aliases.lotNo);if(!lotCol)return null;
      const filters=[{column:lotCol,op:'starts',value:lotNo.slice(0,5)}];
      const equipCol=findColumn(columns,aliases.equipment),equipment=typeof currentConfiguredEquipment==='function'?currentConfiguredEquipment():'';
      if(equipCol&&equipment)filters.push({column:equipCol,op:'contains',value:equipment});
      const params=new URLSearchParams({db:'SIKALOTNOW',table,page:1,page_size:50,include_hidden:1,filters:JSON.stringify(filters)});
      const d=await api('/api/table?'+params);
      for(const cand of (d.rows||[])){
        const candLotNo=String(pick(cand,'lotNo')||'');
        if(!candLotNo||candLotNo===lotNo)continue;
        const kids=childLotNumbersFromCard(cand,candLotNo);
        if(kids.some(k=>k.lot===lotNo))return cand;
      }
    }catch(e){console.warn('親ロットの検索に失敗しました: '+lotNo,e)}
    return null;
  }
  // 子ロットと判定された場合、確認の上で親ロットの行に差し替える。
  async function resolveToParentIfChild(row){
    if(!row||S.db!=='SIKALOTNOW')return row;
    const parent=await findParentLotFor(row);
    if(!parent)return row;
    const childLotNo=pick(row,'lotNo'),parentLotNo=pick(parent,'lotNo');
    const useParent=confirm(`このロット(${childLotNo})は分割後の子ロットです。\n親ロット(${parentLotNo})のデータを開きますか？\n\n「キャンセル」を選ぶと、このまま子ロットのデータで開きます(データが不完全な場合があります)。`);
    if(!useParent)return row;
    if(typeof showToast==='function')showToast('親ロットのデータを開きます',`${childLotNo} → ${parentLotNo}`,4200);
    return parent;
  }

  function buildCandidateList(){
    const totalCount=Math.max(1,+($('#horizontalCount')?.value)||+S.measure.settings.horizontalCount||1);
    const direct=directChildLotNumbers(),carded=childLotNumbersFromCard();
    const picks=direct.length?direct:carded;
    const seen=new Set(),children=[];
    picks.forEach(({lot,index})=>{if(!lot||seen.has(lot))return;seen.add(lot);const count=childCount(index);if(count>0)children.push({lot:String(lot),count})});
    const childTotal=children.reduce((a,x)=>a+x.count,0);
    return{selfCount:Math.max(0,totalCount-childTotal),children};
  }

  function describeTol(entry){
    if(entry.missing)return '子ロット情報を取得できませんでした';
    const w=entry.tolData?.width?.manufacturing||entry.tolData?.width?.order;
    if(!w||!Number.isFinite(entry.base?.width))return '公差情報なし';
    return `幅${entry.base.width} (+${w.plus}/-${w.minus})`;
  }

  async function buildSplitSources(){
    const cand=buildCandidateList(),out=[];
    const self=selfSource();
    self.count=cand.selfCount||Math.max(1,+($('#horizontalCount')?.value)||1);
    self.width=Number.isFinite(self.base.width)?self.base.width:'';
    self.tol=describeTol(self);
    out.push(self);
    for(const c of cand.children){
      const row=await fetchChildLotRow(c.lot);
      if(!row){out.push({lot:c.lot,count:c.count,width:'',tol:'子ロット情報を取得できませんでした',missing:true});continue}
      const entry={lot:c.lot,count:c.count,missing:false,
        base:{thickness:baseFromRow(row,'thickness'),width:baseFromRow(row,'width')},
        tolData:{thickness:{manufacturing:toleranceFromRow(row,'thickness','manufacturing'),order:toleranceFromRow(row,'thickness','order')},
             width:{manufacturing:toleranceFromRow(row,'width','manufacturing'),order:toleranceFromRow(row,'width','order')}}};
      entry.width=Number.isFinite(entry.base.width)?entry.base.width:'';
      entry.tol=describeTol(entry);
      out.push(entry);
    }
    return out;
  }

  // splitSourceRows()を、非同期取得済みキャッシュを返す同期関数に置き換える。
  // renderSplit/applySplit(core.js)は元のままこの関数を同期呼び出しし続ける。
  let splitSourcesCache=null;
  splitSourceRows=function(){
    if(splitSourcesCache)return splitSourcesCache;
    return [{lot:S.measure?.basic?.lotNo||'当ロット',count:Math.max(1,+($('#horizontalCount')?.value)||1),width:S.measure?.basic?.mfgWidth||'',tol:'取得中…'}];
  };

  const baseOpenSplit=typeof openSplit==='function'?openSplit:null;
  openSplit=async function(){
    if(!S.measure)return;
    splitSourcesCache=null;
    $('#splitModal').hidden=false;
    const box=$('#splitSources');if(box)box.innerHTML='<div class="split-row-loading">子ロット情報を取得しています…</div>';
    try{
      splitSourcesCache=await buildSplitSources();
    }catch(e){
      splitSourcesCache=[{lot:S.measure?.basic?.lotNo||'当ロット',count:Math.max(1,+($('#horizontalCount')?.value)||1),width:S.measure?.basic?.mfgWidth||'',tol:'取得エラー'}];
      console.warn('分割候補の取得に失敗しました',e);
    }
    if(typeof renderSplit==='function')renderSplit();
  };

  const baseApplySplit=typeof applySplit==='function'?applySplit:null;
  applySplit=function(){
    const sources=splitSourceRows(),seq=S.measure.settings.splitSequence||[],total=sources.reduce((a,x)=>a+x.count,0);
    if(seq.length!==total){alert('全条分を登録してください。');return}
    const map=Object.fromEntries(sources.map(x=>[x.lot,x])),groups=[];
    seq.forEach(lot=>{const last=groups.at(-1);if(last&&last.lot===lot)last.count++;else groups.push({lot,count:1,source:map[lot]})});
    if(groups.length>8){alert('システム上8を超える分割は設定できません。');return}
    const splitGroups=groups.map(g=>({lot:g.lot,count:g.count,base:g.source?.base||null,tol:g.source?.tolData||null,missing:!!g.source?.missing}));
    const positionGroup=[];splitGroups.forEach((g,gi)=>{for(let k=0;k<g.count;k++)positionGroup.push(gi)});
    S.measure.settings.splitGroups=splitGroups;
    S.measure.settings.splitPositionGroup=positionGroup;
    $('#horizontalCount').value=total;
    if(typeof updateCoilOptions==='function')updateCoilOptions(total);
    $('#splitModal').hidden=true;
    if(typeof markDirty==='function')markDirty();
    if(typeof setState==='function')setState('条割を変更しました');
    if(typeof renderMeasureGrid==='function')renderMeasureGrid();
    if(typeof updateMeasurementHeading==='function')updateMeasurementHeading();
    refreshSplitStatusPanel();
  };
  const applyBtn=$('#applySplit');if(applyBtn)applyBtn.onclick=applySplit;
  const openBtn=$('#openSplit');if(openBtn)openBtn.onclick=openSplit;

  /* 左パネル「幅分割情報」タブ(#splitGrid)は、テンプレート上は固定文字列
     「分割無し」のままで、従来は条割変更モーダルを開いて実行するまで
     一切更新されなかった(=分割データがあるロットを開いた直後は、実際は
     分割データを持っているのに「分割無し」と表示され続けていた)。
     測定画面を開いた/再開した時点で、生データ(親子管理_子カード等)から
     分割データの有無を判定し、未設定でも「分割データあり」と分かるように
     する。applySplit実行後もここで最新の設定内容へ更新する。 */
  function refreshSplitStatusPanel(){
    const el=$('#splitGrid');if(!el)return;
    const groups=S.measure?.settings?.splitGroups;
    if(Array.isArray(groups)&&groups.length){
      const summary=summarizeAppliedGroups(groups);
      const list=groups.map((g,i)=>`${i+1}. ${esc(g.lot)} / ${g.count}条${Number.isFinite(g.base?.width)?` / 幅${g.base.width}`:''}${g.missing?'（子ロット情報取得失敗）':''}`).join('<br>');
      el.innerHTML=`<b class="split-status-summary">${esc(summary)}</b><br>${list}`;
      return;
    }
    const info=analyzeRowSplit(S.measure?.source);
    if(info.hasSplit){
      el.innerHTML=`<span class="split-status-pending">⚠ このロットには分割データがあります（推定${info.lotCount}ロット・${esc(widthPatternLabel(info.widthPattern))}）。「条割変更」から設定してください。</span>`;
      return;
    }
    el.textContent='分割無し';
  }
  if(typeof renderMeasurement==='function'){
    const baseRenderMeasurementSplitStatus=renderMeasurement;
    renderMeasurement=function(){baseRenderMeasurementSplitStatus();refreshSplitStatusPanel()};
  }

  // ---- 判定への配線 ----
  function groupForIndex(index){
    const groups=S.measure?.settings?.splitGroups,posMap=S.measure?.settings?.splitPositionGroup;
    if(!Array.isArray(groups)||groups.length<2||!Array.isArray(posMap))return null;
    const gi=posMap[index];
    return Number.isInteger(gi)?groups[gi]:null;
  }
  function groupRangeFor(kind,index){
    const type=$('#measureType')?.value||S.measure?.settings?.measureType||'';
    if(type!=='板厚/板幅')return null; // 分割は板厚/板幅の条位置に対してのみ意味を持つ
    const g=groupForIndex(index);
    if(!g||g.missing||!g.base||!g.tol)return null;
    const base=g.base[kind];
    if(!Number.isFinite(base))return null;
    let requested=typeof configuredToleranceSource==='function'?configuredToleranceSource():'manufacturing',source=requested,fallback=false;
    let data=g.tol[kind]?.[requested];
    if(!data&&requested!=='manufacturing'){source='manufacturing';fallback=true;data=g.tol[kind]?.manufacturing}
    if(!data)return null;
    return{range:[base-data.minus,base+data.plus],source,fallback,plus:data.plus,minus:data.minus,plusKey:data.plusKey,minusKey:data.minusKey,base,splitLot:g.lot};
  }
  const baseToleranceDetail=toleranceDetail;
  toleranceDetail=function(kind,index=0){
    const split=groupRangeFor(kind,index);
    if(split)return split;
    return baseToleranceDetail(kind,index);
  };

  // compactToleranceData(表示用の公差テキスト生成)は従来 index を常に0扱いで
  // 呼ばれており、条ごとに公差が変わる分割ロットでは「今フォーカスしている
  // 条」ではなく常に1条目の公差を表示してしまっていた。index省略時は現在の
  // 入力位置(wStep/tStep)を既定値として使うようにし、基準値(base)も
  // toleranceDetailが返す値(分割時はその子ロット自身の値)を優先する。
  if(typeof compactToleranceData==='function'){
    compactToleranceData=function(kind,index){
      const idx=index??((S.measure?.settings?.[kind==='thickness'?'tStep':'wStep'])||0);
      const detail=toleranceDetail(kind,idx);
      if(!detail)return null;
      const base=Number.isFinite(detail.base)?detail.base:Number(kind==='thickness'?S.measure.basic.mfgThickness:S.measure.basic.mfgWidth);
      const labels={manufacturing:'製造公差',order:'オーダー公差',instruction:'指示公差'};
      return{source:labels[detail.source]||'公差',base:fixedToleranceValue(kind,base),plus:fixedToleranceValue(kind,detail.plus),minus:fixedToleranceValue(kind,detail.minus),low:fixedToleranceValue(kind,detail.range[0]),high:fixedToleranceValue(kind,detail.range[1]),range:detail.range,splitLot:detail.splitLot||''};
    };
  }

  // 使用設備・仕掛データを開いた時点のテーブル/列名を、子ロット再検索に
  // そのまま使えるよう記録しておく(仕掛一覧から開いた場合のみ意味を持つ)。
  // また、開こうとした行が子ロットと判定された場合は、確認の上で親ロットの
  // データに読み替える(データエラー回避)。
  // baseOpenMeasurement/baseResumeStoredMeasureは内部でマスタ関連の問い合わせ
  // (loadMeasurementContext等)を行い、それが失敗すると例外を投げたまま
  // 呼び出し元まで伝播する(この端末がAccessに未接続の場合など)。分割情報の
  // 補完・再描画は測定画面自体が開いた後であれば意味があるため、finally で
  // 必ず実行し、後続のマスタ読込失敗に巻き込まれて実行されなくなることを防ぐ。
  // (例外そのものは従来通り再送出されるため、呼び出し元の挙動は変えない)
  if(typeof openMeasurement==='function'){
    const baseOpenMeasurement=openMeasurement;
    openMeasurement=async function(row){
      row=await resolveToParentIfChild(row);
      try{
        return await baseOpenMeasurement(row);
      }finally{
        if(S.measure&&S.db==='SIKALOTNOW'){
          S.measure.settings=S.measure.settings||{};S.measure.settings.sourceTable=S.table;S.measure.settings.sourceColumns=(S.columns||[]).slice();
          await refreshSelfSourceFull();
          refreshSplitStatusPanel();
        }
      }
    };
  }
  // 編集中/完了一覧からの「続きから再開」経路でも、分割関連の完全データを
  // 補ってから幅分割情報を再描画する(現在のS.dbが仕掛一覧とは限らないため
  // ここではS.db判定をしない)。
  if(typeof resumeStoredMeasure==='function'){
    const baseResumeStoredMeasure=resumeStoredMeasure;
    resumeStoredMeasure=async function(saved,row=null){
      try{
        return await baseResumeStoredMeasure(saved,row);
      }finally{
        await refreshSelfSourceFull();
        refreshSplitStatusPanel();
      }
    };
  }

  // ---- 条ごとの公差一覧をパネルへ表示(現在フォーカス中の条をハイライト) ----
  function splitLegendHtml(){
    const groups=S.measure?.settings?.splitGroups;
    if(!Array.isArray(groups)||groups.length<2)return '';
    const wStep=S.measure?.settings?.wStep||0;
    let start=1;
    const rows=groups.map((g,gi)=>{
      const end=start+g.count-1,range=`${start}〜${end}条`,startIdx=start-1;start=end+1;
      const isCurrent=wStep>=startIdx&&wStep<startIdx+g.count;
      const w=g.tol?.width?.manufacturing||g.tol?.width?.order,t=g.tol?.thickness?.manufacturing||g.tol?.thickness?.order;
      const wText=g.missing?'取得失敗':(w&&Number.isFinite(g.base?.width)?`${g.base.width} (+${w.plus}/-${w.minus})`:'—');
      const tText=g.missing?'—':(t&&Number.isFinite(g.base?.thickness)?`${g.base.thickness} (+${t.plus}/-${t.minus})`:'—');
      const cls=[g.missing?'split-legend-missing':'',isCurrent?'split-legend-current':''].filter(Boolean).join(' ');
      return `<tr${cls?` class="${cls}"`:''}><td>${isCurrent?'▶ ':''}${esc(range)}</td><td>${esc(g.lot)}</td><td>${esc(wText)}</td><td>${esc(tText)}</td></tr>`;
    });
    return `<div class="split-tolerance-legend"><b>条ごとの公差 — ${esc(summarizeAppliedGroups(groups))} — ▶は現在の入力位置</b><table><thead><tr><th>条範囲</th><th>ロット№</th><th>板幅 目標(公差)</th><th>板厚 目標(公差)</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }
  if(typeof updateMeasurementHeading==='function'){
    const baseHeading=updateMeasurementHeading;
    updateMeasurementHeading=function(){
      baseHeading();
      const el=$('#toleranceSummary');if(!el)return;
      const type=$('#measureType')?.value;
      el.querySelectorAll('.split-tolerance-legend').forEach(x=>x.remove());
      if(type==='板厚/板幅'){const html=splitLegendHtml();if(html)el.insertAdjacentHTML('beforeend',html)}
    };
  }

  // ---- 条(条位置)ごとに公差が異なりうるため、フォーカス移動時に
  //      公差表示(数値・図示)を追従させる ----
  // focusCurrent()は入力位置切替の全経路(セルクリック・矢印キー・自動転送後の
  // advanceWidth等)で必ず呼ばれるため、ここに軽量な再描画をフックする。
  // measurementGrid全体の再描画はしない(入力欄のフォーカス/スクロール位置を
  // 保つため、公差表示部分のみDOMを直接更新する)。
  function refreshFocusedToleranceDisplay(){
    const type=$('#measureType')?.value;
    if(type!=='板厚/板幅')return;
    if(typeof updateMeasurementHeading==='function')updateMeasurementHeading();
    const tSide=document.querySelector('.compact-thickness-body .compact-tolerance-side');
    if(tSide&&typeof compactToleranceFacts==='function')tSide.innerHTML=compactToleranceFacts('thickness').html;
    const wSide=document.querySelector('.compact-width-body .compact-tolerance-side');
    if(wSide&&typeof compactToleranceScale==='function'){
      const li=typeof lengthIndex==='function'?lengthIndex():0,count=Math.max(1,Math.min(40,+($('#horizontalCount')?.value)||1));
      const width=S.measure?.measurements?.width?.[li]||[];
      wSide.innerHTML=compactToleranceScale('width',width,count);
    }
  }
  if(typeof focusCurrent==='function'){
    const baseFocusCurrent=focusCurrent;
    focusCurrent=function(){baseFocusCurrent();refreshFocusedToleranceDisplay()};
  }
})();
