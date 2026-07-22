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

  // KOCARD1〜10から子ロット番号を復元する(旧VBA KCDNO相当)。
  // 1〜9: ロット番号の先頭6桁+1桁、10〜99: 先頭5桁+2桁で末尾を置換。
  function childLotNumbersFromCard(){
    const r=S.measure?.source||{},lotNo=String(S.measure?.basic?.lotNo||'');
    if(!lotNo)return [];
    const out=[];
    for(let i=1;i<=10;i++){
      const raw=r['KOCARD'+i];
      if(raw===undefined||raw===null||String(raw).trim()==='')break;
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
  function childCount(i){
    const r=S.measure?.source||{},v=r['YK'+i]??r['K05JO'+i],n=Number(v);
    return Number.isFinite(n)&&n>0?n:0;
  }

  async function resolveSikaTable(){
    if(S.measure?.settings?.sourceTable)return S.measure.settings.sourceTable;
    const info=await api('/api/tables?db=SIKALOTNOW');
    return info.tables?.[0]||null;
  }
  async function resolveSikaColumns(table){
    if(S.measure?.settings?.sourceColumns?.length)return S.measure.settings.sourceColumns;
    const d=await api('/api/table?'+new URLSearchParams({db:'SIKALOTNOW',table,page:1,page_size:1}));
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
      const params=new URLSearchParams({db:'SIKALOTNOW',table,page:1,page_size:5,filters:JSON.stringify(filters)});
      const d=await api('/api/table?'+params);
      return d.rows?.[0]||null;
    }catch(e){console.warn('子ロット再検索に失敗しました: '+lotNo,e);return null}
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
  };
  const applyBtn=$('#applySplit');if(applyBtn)applyBtn.onclick=applySplit;
  const openBtn=$('#openSplit');if(openBtn)openBtn.onclick=openSplit;

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
  if(typeof openMeasurement==='function'){
    const baseOpenMeasurement=openMeasurement;
    openMeasurement=async function(row){
      const result=await baseOpenMeasurement(row);
      if(S.measure&&S.db==='SIKALOTNOW'){S.measure.settings=S.measure.settings||{};S.measure.settings.sourceTable=S.table;S.measure.settings.sourceColumns=(S.columns||[]).slice()}
      return result;
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
    return `<div class="split-tolerance-legend"><b>条ごとの公差(分割あり) — ▶は現在の入力位置</b><table><thead><tr><th>条範囲</th><th>ロット№</th><th>板幅 目標(公差)</th><th>板厚 目標(公差)</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
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
