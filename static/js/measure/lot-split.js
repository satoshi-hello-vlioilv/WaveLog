"use strict";
/* lot-split.js: 条割(ロット分割)機能の所有ファイル。
   ------------------------------------------------------------
   このファイルが持つもの:
   - 分割データ(親子管理_子カード・コンマ5本分割_切断巾)の検出と子ロット再検索
   - 条の設計カード(#splitCard)の描画・操作・確定(renderSplit/openSplit/applySplit)
   - 幅分割情報パネル(#splitGrid)と幅分割タブバッジの表示
   - 条ごとの公差判定への配線(toleranceDetailの分割対応ラップ)
   - 子ロット行を直接開いた場合の親ロット読替(データエラー回避)
   - 元幅（実績）と条幅合計から求める両耳合計屑幅の表示

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
  if(typeof WL.measureInput.toleranceDetail!=='function'||typeof $!=='function'||typeof api!=='function')return;

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

  /* 分割(子ロット)関連の実カラム名は「親子管理_子カード<N>」「コンマ5本分割_
     切断巾<N>」であることが実データで確認された(旧VBA変数名KOCARD/K05JO等は
     内部エイリアスであり、Accessの生カラム名ではなかった)。全角/半角ゆれや
     旧エイリアスも候補として保持し、複数パターンを試す。 */
  /* 上限。**分割数(条数)とロット数は別物**なので値も別に持つ。
     ・条数   … 各子ロットの条数の合計。**設備ごとの上限**(設備マスタの
                「最大条数」)。現在の主対象LS4が40条で、これが測定データの
                構造上の上限(STRIP_LIMIT)でもある。他の設備はこれより小さい。
     ・ロット数 … 親ロットを分けた子ロットの数。1つの子ロットを何条にも
                  割れるので条数以下になる。作業として成立する上限は9ロット。
     以前は「8を超える分割は設定できません」という1つの上限しか持たず、しかも
     数えていたのは条の連続区間の数だった。 */
  const STRIP_LIMIT=40;              // 測定データ(40列)と条ストリップ(20行×2列)の構造上の上限
  const MAX_CHILD_LOTS=9;
  const CHILD_SLOTS=10;              // 子カード/切断巾の枠数(データ側の器。ロット数の上限とは別)
  /* この設備で割れる最大条数。/api/measurement/context が設備マスタから返した値を
     records-store.js が S.measure.settings.maxStrips へ入れる。取れないうちは
     構造上の上限で動かす(狭める方向の設定なので、未取得のあいだ緩いほうへ
     倒しても取り違えた条数を保存することはない——保存時に再確認する)。 */
  function maxStripsForEquipment(){
    const n=Number(S.measure?.settings?.maxStrips);
    return Number.isFinite(n)&&n>=1?Math.min(n,STRIP_LIMIT):STRIP_LIMIT;
  }
  window.WL=window.WL||{};
  window.WL.maxStripsForEquipment=maxStripsForEquipment;
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
  // 「ｺﾝﾏ5本ｶｰﾄﾞ区分」が3の行は、親側の分割データ(親子管理_子カード等)が
  // 無く一見「分割なし」に見えても、実際には分割済みの子ロット(子カード)
  // 自身であることを示す。仕掛一覧で気づけるよう、この行に限って親ロットの
  // 逆引き検索(findParentLotFor)を行う。
  const CHILD_CARD_CLASSIFICATION_PREFIXES=['ｺﾝﾏ5本ｶｰﾄﾞ区分','コンマ5本カード区分'];
  function isChildCardClassifiedRow(row){
    const v=fieldByCandidates(row,CHILD_CARD_CLASSIFICATION_PREFIXES);
    return v!==undefined&&Number(v)===3;
  }
  window.isChildCardClassifiedRow=isChildCardClassifiedRow;
  // 親子管理_子カード1〜10から子ロット番号を復元する(旧VBA KCDNO相当)。
  // 1〜9: ロット番号の先頭6桁+1桁、10〜99: 先頭5桁+2桁で末尾を置換。
  // row/lotNoを省略すると現在開いている測定(S.measure)を対象にする。
  function childLotNumbersFromCard(row,lotNo){
    const r=row||S.measure?.source||{};
    lotNo=lotNo!==undefined?lotNo:String(S.measure?.basic?.lotNo||'');
    if(!lotNo)return [];
    const out=[];
    for(let i=1;i<=CHILD_SLOTS;i++){
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
  // 同一行に子ロット番号が直接入っているケース(LTNO1..9)。
  // 走査するのはロットの上限(MAX_CHILD_LOTS)まで。以前は8で打ち切っており、
  // 9ロットに分けた品の9つ目を取りこぼしていた。
  // rowを省略すると現在開いている測定(S.measure.source)を対象にする(既存呼び出し
  // 互換)。仕掛一覧のグリッド行など、測定を開く前の生データにも使えるようにする。
  function directChildLotNumbers(row){
    const r=row||S.measure?.source||{},out=[];
    for(let i=1;i<=MAX_CHILD_LOTS;i++){
      const lot=r['LTNO'+i]||r['分割ロット'+i];
      if(lot)out.push({lot:String(lot),index:i});
    }
    return out;
  }
  // 条数は本来コンマ5本分割_切断巾側から特定できる想定だが、実データでの
  // フィールド確証が取れるまでの安全側フォールバックとして、専用の条数系
  // 候補が無ければ「切断巾に値がある行を1条」として数える。
  // rowを省略すると現在開いている測定(S.measure.source)を対象にする(既存呼び出し互換)。
  function childCount(i,row){
    const r=row||S.measure?.source||{};
    const v=childCountFieldValue(r,i);
    if(v!==undefined){const n=Number(v);if(Number.isFinite(n)&&n>0)return n}
    const w=childCutWidthValue(r,i);
    if(w!==undefined&&Number(w)!==0)return 1;
    return 0;
  }
  // 行(生データ)から期待される子ロット番号の一覧を求める(重複除去済み、
  // 条数0の枠は除く)。buildCandidateList()と同じ優先順位(直接ロット番号
  // →子カード復元)だが、S.measureに依存せず任意の行に対して使える。
  function expectedChildLotsForRow(row,lotNo){
    const direct=directChildLotNumbers(row);
    const picks=direct.length?direct:childLotNumbersFromCard(row,lotNo);
    const seen=new Set(),out=[];
    picks.forEach(({lot,index})=>{
      if(!lot||seen.has(lot))return;
      seen.add(lot);
      if(childCount(index,row)>0)out.push(lot);
    });
    return out;
  }
  // 仕掛データ一覧(グリッド)側で「分割あり/なし」を判定するための、行(生データ)
  // 単位のチェック。親子管理_子カード・コンマ5本分割_切断巾のいずれかに
  // 意味のある値(0以外)があれば分割ありとみなす。
  function rowHasSplitData(row){
    if(!row)return false;
    for(let i=1;i<=CHILD_SLOTS;i++){
      const v=childCardValue(row,i);
      if(v!==undefined&&Number(v)!==0)return true;
    }
    for(let i=1;i<=CHILD_SLOTS;i++){
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
    if(!row||!rowHasSplitData(row))return{hasSplit:false,lotCount:1,stripCount:1,widthPattern:'none'};
    /* **ロット数と分割数(条数)は別物**。データ上の持ち方が違う。
       ・ロット数 = 子ロットの数。親子管理_子カード / コンマ5本分割_切断巾 の
                    「枠」が1枠=1子ロット(枠は10まで、作業として成立するのは9)。
                    切断巾N はその子ロットの製品幅。
       ・条数     = 各子ロットが持つ条数(YK・K05JO、無ければ横割数)の**合計**。
                    1つの子ロットを何条にも割れるので、枠の数とは一致しない。
       以前はこの2つを Math.max(子カード数, 切断巾の件数) でひとまとめにして
       「Nロット」と呼んでいたため、条数がロット数として表示されていた。 */
    let cardCount=0;
    for(let i=1;i<=CHILD_SLOTS;i++){const v=childCardValue(row,i);if(v!==undefined&&Number(v)!==0)cardCount++}
    const cutWidths=[],slots=[];
    for(let i=1;i<=CHILD_SLOTS;i++){
      const w=childCutWidthValue(row,i);
      if(w!==undefined&&Number(w)!==0){cutWidths.push(Number(w));slots.push(i)}
    }
    // 子ロット番号として実際に復元できた数を優先する(子カードの枠が埋まって
    // いても同じ番号を指していれば1ロット)。復元できなければ枠の数で代用する。
    const lots=expectedChildLotsForRow(row,typeof pick==='function'?String(pick(row,'lotNo')||''):'');
    const lotCount=Math.max(lots.length||cardCount||cutWidths.length,1);
    // 条数は枠ごとの条数の合計。枠に条数が入っていなければ1条として数える
    // (childCountの安全側フォールバックと同じ)。
    const usedSlots=slots.length?slots:Array.from({length:Math.max(cardCount,1)},(_,i)=>i+1);
    const stripCount=Math.max(usedSlots.reduce((a,i)=>a+(childCount(i,row)||0),0),lotCount,1);
    let widthPattern='unknown';
    if(cutWidths.length>=2)widthPattern=cutWidths.every(w=>Math.abs(w-cutWidths[0])<0.05)?'same':'different';
    return{hasSplit:true,lotCount,stripCount,widthPattern};
  }
  window.analyzeRowSplit=analyzeRowSplit;
  function widthPatternLabel(p){return p==='same'?'同一幅分割':p==='different'?'異幅分割':'幅パターン不明'}
  // applySplit後の確定データ(子ロット自身から取得した実際の幅)を使った、
  // より正確な同一幅/異幅・ロット数の要約。
  function summarizeAppliedGroups(groups){
    /* groupsは「同じ子ロットが連続した区間」の配列であって、子ロットの配列では
       ない。同じ子ロットを離れた位置へ置く並べ方(例 A B A)では区間が3つに
       割れるため、区間数を数えると実際の分割数より多く見える。ロットとしての
       分割数は**異なる子ロットの数**なので、そちらで数える。 */
    const lots=[...new Set(groups.map(g=>g.lot).filter(Boolean))];
    const widths=lots.map(lot=>groups.find(g=>g.lot===lot)?.base?.width).filter(w=>Number.isFinite(w));
    const strips=groups.reduce((a,g)=>a+(Number(g.count)||0),0);
    let pattern='幅情報なし';
    if(widths.length>=2)pattern=widths.every(w=>Math.abs(w-widths[0])<0.05)?'同一幅分割':'異幅分割';
    else if(widths.length===1)pattern='単一幅';
    // ロット数と条数の両方を出す。1つの子ロットを何条にも割れるので、
    // どちらか一方だけでは「何がいくつなのか」が伝わらない。
    return `${lots.length||groups.length}ロット / ${strips}条に分割（${pattern}）`;
  }

  /* 分割の判定材料(「親子管理_子カード*」「コンマ5本分割_切断巾*」)は
     **画面に出ているかどうかと無関係に**要る。以前はサーバーが「表示マスタ」
     で列を落としており、非表示にされた途端に分割が一切判定できなくなった
     ため、内部の問い合わせだけ`include_hidden=1`で逃がしていた。
     表示マスタは廃止し(§9.165)、**どの列を出すかは画面側だけが決める**
     ようになったので、この逃げ道は要らない。 */
  /* ---------- 問い合わせのキャッシュ(docs/ARCHITECTURE.md「共有ファイルを
     読む処理は回数が効く」) ----------
     一覧を1ページ描くたびに、子カード判定された行の**1行ごと**に
     findParentLotFor()が走る(list-view.jsのcheckParentLookupRows)。中身は
       (1) テーブル名を引く      /api/tables
       (2) 列名を引く            /api/table?page_size=1
       (3) 先頭5桁で親を探す     /api/table?page_size=50
     の3往復で、これが行数ぶん線形に増えていた(実測: 20行→60往復)。
     200行ページに子カードが80行あれば240往復になり、共有越し(1回150ms)なら
     それだけで30秒を超える。

     (1)(2)は**実行中に変わらない**ので保持する。(3)は先頭5桁+設備が同じなら
     まったく同じ問い合わせになるため、キーで束ねて1回にする(同じ親を持つ
     子ロットが並ぶのが普通なので、実データほどよく効く)。
     (3)は生データのキャッシュなので、一覧の再読込(invalidateTableCache)に
     合わせて捨て、TTLも一覧と揃える。 */
  const SPLIT_QUERY_TTL_MS=180000;   // 3分(仕掛一覧のキャッシュと同じ)
  let sikaTablePromise=null;
  const sikaColumnsCache=new Map();   // テーブル名ごとに持つ(測定中はsourceTableが優先されるため)
  const prefixSearchCache=new Map();
  const prefixLightCache=new Map();   // 一覧の追い判定用(必要な列だけ、下記)
  function invalidateSplitQueryCache(){
    sikaTablePromise=null;sikaColumnsCache.clear();prefixSearchCache.clear();prefixLightCache.clear();
  }
  window.invalidateSplitQueryCache=invalidateSplitQueryCache;
  /* 条割の再検索先＝作業対象の一覧。データソースマスタの役割が決めるので、
     'SIKALOTNOW'というキーの綴りに依存させない(§9.87)。 */
  function workDb(){return WL.dataSource.workKey()||''}
  async function resolveSikaTable(){
    if(S.measure?.settings?.sourceTable)return S.measure.settings.sourceTable;
    if(!workDb())return null;
    if(!sikaTablePromise){
      sikaTablePromise=api('/api/tables?db='+encodeURIComponent(workDb()))
        .then(info=>info.tables?.[0]||null)
        .catch(e=>{sikaTablePromise=null;throw e});
    }
    return sikaTablePromise;
  }
  async function resolveSikaColumns(table){
    // テーブルが違えば列も違う。resolveSikaTable()は測定中だけ
    // S.measure.settings.sourceTableを返すので、同じセッション内でも
    // 引数が変わり得る。キーはテーブル名にする。
    if(!sikaColumnsCache.has(table)){
      sikaColumnsCache.set(table,
        api('/api/table?'+new URLSearchParams({db:workDb(),table,page:1,page_size:1}))
          .then(d=>d.columns||[])
          .catch(e=>{sikaColumnsCache.delete(table);throw e}));
    }
    return sikaColumnsCache.get(table);
  }
  /* 先頭5桁+設備での仕掛検索。findParentLotFor/findMissingChildLotsが同じ
     問い合わせを何度も投げるため、キーで1回に束ねる(進行中の呼び出しにも
     相乗りできるようPromiseのまま持つ)。 */
  async function searchByLotPrefix(table,columns,prefix){
    const lotCol=findColumn(columns,aliases.lotNo);if(!lotCol)return [];
    const equipCol=findColumn(columns,aliases.equipment);
    const equipment=typeof currentConfiguredEquipment==='function'?currentConfiguredEquipment():'';
    const key=`${table}|${prefix}|${equipCol&&equipment?equipment:''}`;
    const hit=prefixSearchCache.get(key);
    if(hit&&Date.now()-hit.at<SPLIT_QUERY_TTL_MS)return hit.promise;
    const filters=[{column:lotCol,op:'starts',value:prefix}];
    if(equipCol&&equipment)filters.push({column:equipCol,op:'contains',value:equipment});
    const params=new URLSearchParams({db:workDb(),table,page:1,page_size:50,filters:JSON.stringify(filters)});
    const promise=api('/api/table?'+params).then(d=>d.rows||[])
      .catch(e=>{prefixSearchCache.delete(key);throw e});
    prefixSearchCache.set(key,{at:Date.now(),promise});
    return promise;
  }
  /* ---------- 一覧の追い判定用の「軽い」先頭検索(§9.94) ----------
     上のsearchByLotPrefixは**行の中身をそのまま使う**(測定を開くときに
     親ロットの板厚・公差まで要る)ため、非表示列も含めた全列を運ぶ。
     ところが一覧の追い判定に要るのは
       ・候補のロット番号     … その子ロットが仕掛に居るか
       ・候補の親子管理_子カード … その候補がこの行の親か
     の2種類だけ。実データは200列を超えるので、1回の問い合わせが450KB、
     1ページぶんで30MBになり、**受け取ったJSONを解くたびに画面が数百ms
     止まっていた**(実機で「一覧に切り替えると固まる」と報告された)。
     必要な列だけを頼み(columns=)、さらに**先頭をまとめて1回で引く**
     (starts_any)。 */
  const LIGHT_CHUNK=25;             // 1回の問い合わせにまとめる先頭の数
  const LIGHT_PAGE_SIZE=500;        // サーバー側の上限と同じ
  function lightColumns(columns){
    const lotCol=findColumn(columns,aliases.lotNo);
    const want=lotCol?[lotCol]:[];
    // 親判定に使う子カード列(実カラム名のゆれは候補名で拾う)
    for(let i=1;i<=CHILD_SLOTS;i++)
      for(const p of CHILD_CARD_PREFIXES){const n=p+i;if(columns.includes(n))want.push(n)}
    return want;
  }
  function lightKey(table,prefix,equipment){return `${table}|${prefix}|${equipment||''}`}
  /* 1ページぶんの先頭をまとめて引いておく。**取れなくても何も壊れない**
     ——個別の検索がそのまま動く(取りこぼした先頭だけ1件ずつ引く)。 */
  async function prefetchLotPrefixes(prefixes){
    const table=await resolveSikaTable();if(!table)return;
    const columns=await resolveSikaColumns(table);if(!columns.length)return;
    const lotCol=findColumn(columns,aliases.lotNo);if(!lotCol)return;
    const equipCol=findColumn(columns,aliases.equipment);
    const equipment=typeof currentConfiguredEquipment==='function'?currentConfiguredEquipment():'';
    const eq=equipCol&&equipment?equipment:'';
    const want=[...new Set(prefixes)].filter(p=>{
      const hit=prefixLightCache.get(lightKey(table,p,eq));
      return !(hit&&Date.now()-hit.at<SPLIT_QUERY_TTL_MS);
    });
    if(!want.length)return;
    const cols2=lightColumns(columns);
    for(let i=0;i<want.length;i+=LIGHT_CHUNK){
      const chunk=want.slice(i,i+LIGHT_CHUNK);
      const filters=[{column:lotCol,op:'starts_any',value:chunk.join(',')}];
      if(eq)filters.push({column:equipCol,op:'contains',value:eq});
      const params=new URLSearchParams({db:workDb(),table,page:1,page_size:LIGHT_PAGE_SIZE,
        columns:cols2.join(','),filters:JSON.stringify(filters)});
      let rows=null;
      try{rows=(await api('/api/table?'+params)).rows||[]}catch(e){continue}
      // 上限に達していたら取りこぼしがあり得る。**この塊は覚えない**
      // (個別の検索がそのまま引き直す。半端な結果を正として残さない)。
      if(rows.length>=LIGHT_PAGE_SIZE)continue;
      const byPrefix=new Map(chunk.map(p=>[p,[]]));
      rows.forEach(r=>{
        const lot=String(r[lotCol]||'');
        const list=byPrefix.get(lot.slice(0,5));
        if(list)list.push(r);
      });
      byPrefix.forEach((list,p)=>
        prefixLightCache.set(lightKey(table,p,eq),{at:Date.now(),promise:Promise.resolve(list)}));
    }
  }
  window.prefetchLotPrefixes=prefetchLotPrefixes;
  /* まとめ引きが効いていればその場で返る。効いていなければ1件だけ引く。 */
  async function searchByLotPrefixLight(table,columns,prefix){
    const lotCol=findColumn(columns,aliases.lotNo);if(!lotCol)return [];
    const equipCol=findColumn(columns,aliases.equipment);
    const equipment=typeof currentConfiguredEquipment==='function'?currentConfiguredEquipment():'';
    const eq=equipCol&&equipment?equipment:'';
    const key=lightKey(table,prefix,eq);
    const hit=prefixLightCache.get(key);
    if(hit&&Date.now()-hit.at<SPLIT_QUERY_TTL_MS)return hit.promise;
    const filters=[{column:lotCol,op:'starts',value:prefix}];
    if(eq)filters.push({column:equipCol,op:'contains',value:eq});
    const params=new URLSearchParams({db:workDb(),table,page:1,page_size:50,columns:lightColumns(columns).join(','),filters:JSON.stringify(filters)});
    const promise=api('/api/table?'+params).then(d=>d.rows||[])
      .catch(e=>{prefixLightCache.delete(key);throw e});
    prefixLightCache.set(key,{at:Date.now(),promise});
    return promise;
  }
  function findColumn(columns,candidates){
    for(const c of candidates)if(columns.includes(c))return c;
    for(const c of candidates){const wn=norm(c);const hit=columns.find(x=>norm(x)===wn);if(hit)return hit}
    return null;
  }
  /* 子ロット自身のレコードをSIKALOTNOWへ再検索する(旧VBA GetKLTArr相当)。
     子ロットは親と先頭5桁を共有するため、まず**まとめて引いた結果**
     (searchByLotPrefix、キャッシュ付き)から探す。条割プレビューは子ロットの
     数だけこれを順番に呼ぶので、素直に1ロット1問い合わせにすると
     10分割なら10往復を直列で待つことになる(共有越しなら1.5秒級)。
     prefixの結果が上限(50件)に達していて見つからなかったときだけ、
     取りこぼしの可能性があるので従来どおり個別に引く。 */
  const PREFIX_PAGE_SIZE=50;
  async function fetchChildLotRow(lotNo){
    try{
      const table=await resolveSikaTable();if(!table)return null;
      const columns=await resolveSikaColumns(table);if(!columns.length)return null;
      const lotCol=findColumn(columns,aliases.lotNo);if(!lotCol)return null;
      const key=String(lotNo||'');
      if(key.length>=5){
        const rows=await searchByLotPrefix(table,columns,key.slice(0,5));
        const hit=rows.find(r=>String(pick(r,'lotNo')||'')===key);
        if(hit)return hit;
        if(rows.length<PREFIX_PAGE_SIZE)return null;   // 取りこぼしではなく本当に無い
      }
      const filters=[{column:lotCol,op:'eq',value:lotNo}];
      const equipCol=findColumn(columns,aliases.equipment),equipment=typeof currentConfiguredEquipment==='function'?currentConfiguredEquipment():'';
      if(equipCol&&equipment)filters.push({column:equipCol,op:'contains',value:equipment});
      const params=new URLSearchParams({db:workDb(),table,page:1,page_size:5,filters:JSON.stringify(filters)});
      const d=await api('/api/table?'+params);
      return d.rows?.[0]||null;
    }catch(e){console.warn('子ロット再検索に失敗しました: '+lotNo,e);return null}
  }
  // 現在開いているロット自身の完全な生データ(非表示列を含む)を取得し、
  // S.measure.sourceへマージする。一覧取得時点では列表示マスタにより
  // 分割関連の列が欠落している可能性があるため、測定画面を開いた際に
  // 一度だけ取り直して補う。分割関連列に限らず、元幅（実績）等の他の
  // 基本情報項目(aliases/pick)も同じ列表示マスタの影響を受けうるため、
  // マージ後の完全なsourceから基本情報(S.measure.basic)も再計算し直す
  // (値が取得できた項目のみ上書きし、既存値を空欄で潰さない)。
  async function refreshSelfSourceFull(){
    if(!S.measure)return;
    const lotNo=S.measure.basic?.lotNo;if(!lotNo)return;
    try{
      const row=await fetchChildLotRow(lotNo);
      if(row){
        S.measure.source={...(S.measure.source||{}),...row};
        if(typeof aliases==='object'&&typeof pick==='function'){
          Object.keys(aliases).forEach(k=>{
            const v=pick(S.measure.source,k);
            if(v!=='')S.measure.basic[k]=v;
          });
        }
        // 横割数(条数)・縦割数(丈割数)の初期値(BOX設計_横割数/BOX設計_縦割数)
        // も列表示設定で一覧側から欠落し得るため、完全な生データから改めて
        // 反映し直す。ただし測定データが既に入力されている場合
        // (dimensionLocked)は、オペレータの入力・保存済み設定を上書きしない。
        if(!S.measure.settings.dimensionLocked){
          const hn=Number(pick(S.measure.source,'boxHorizontalCount'));
          if(Number.isFinite(hn)&&hn>=1&&hn<=40){
            const rounded=Math.round(hn);
            if(S.measure.settings.horizontalCount!==rounded){
              S.measure.settings.horizontalCount=rounded;
              if($('#horizontalCount'))$('#horizontalCount').value=rounded;
              if(typeof updateCoilOptions==='function')updateCoilOptions(rounded);
            }
          }
          const vn=Number(pick(S.measure.source,'boxVerticalCount'));
          if(Number.isFinite(vn)&&vn>=1&&vn<=9){
            const rounded=Math.round(vn);
            if(S.measure.settings.verticalCount!==rounded){
              S.measure.settings.verticalCount=rounded;
              if($('#verticalCount'))$('#verticalCount').value=rounded;
              if(typeof updateLengthOptions==='function')updateLengthOptions(rounded);
            }
          }
        }
        /* **後から届いた列で、等級とその基準を出し直す**(§9.204)。
           一覧の行は列が欠けていることがあり、`品質ｸﾞﾚｰﾄﾞ_切断面`が
           ここで初めて現れる場合がある。出し直さないと、基準の帯は
           「基準を出せません」のまま残り、丈の判定も止まったままになる
           （`renderQualityGradePanel`が`m.qualityGrades`の唯一の書き手）。
           **内径のプリセット**も同じで、`ｺｲﾙ_内径目標`がここで現れうる。 */
        if(typeof renderQualityGradePanel==='function')renderQualityGradePanel();
        if(typeof renderProductPanel==='function'
           &&WL.measureItem.isMaterial($('#measureType')?.value))renderProductPanel();
        /* 当て方は1箇所（measure-view.js）が持つ。ここは呼ぶだけ。 */
        if(WL.innerDiameter)WL.innerDiameter.apply(S.measure.source);
      }
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
  /* light=true は**一覧の印を付けるため**の呼び出し(§9.94)。返す行は
     ロット番号と子カードだけの軽い行なので、**測定を開く側では使わない**
     ——あちらは親ロットの板厚・公差まで要る。 */
  async function findParentLotFor(row,{light=false}={}){
    if(!row||rowHasSplitData(row))return null;
    const lotNo=String(pick(row,'lotNo')||'');
    if(lotNo.length<6)return null;
    try{
      const table=await resolveSikaTable();if(!table)return null;
      const columns=await resolveSikaColumns(table);if(!columns.length)return null;
      const rows=await (light?searchByLotPrefixLight:searchByLotPrefix)(table,columns,lotNo.slice(0,5));
      for(const cand of rows){
        const candLotNo=String(pick(cand,'lotNo')||'');
        if(!candLotNo||candLotNo===lotNo)continue;
        const kids=childLotNumbersFromCard(cand,candLotNo);
        if(kids.some(k=>k.lot===lotNo))return cand;
      }
    }catch(e){console.warn('親ロットの検索に失敗しました: '+lotNo,e)}
    return null;
  }
  window.findParentLotFor=findParentLotFor;
  // 子ロットと判定された場合、確認の上で親ロットの行に差し替える。
  async function resolveToParentIfChild(row){
    if(!row||!WL.dataSource.isWork(S.db))return row;
    const parent=await findParentLotFor(row);
    if(!parent)return row;
    const childLotNo=pick(row,'lotNo'),parentLotNo=pick(parent,'lotNo');
    const useParent=await confirmModal(`このロット(${childLotNo})は分割後の子ロットです。\n親ロット(${parentLotNo})のデータを開きますか？\n\n「キャンセル」を選ぶと、このまま子ロットのデータで開きます(データが不完全な場合があります)。`);
    if(!useParent)return row;
    if(typeof showToast==='function')showToast('親ロットのデータを開きます',`${childLotNo} → ${parentLotNo}`,4200);
    return parent;
  }

  /* 親ロットの分割データ(親子管理_子カード等)は仕掛にあっても、実際の子ロットが
     仕掛(SIKALOTNOW)から見つからないことがある。子ロットは既に作業済みで仕掛から
     外れている可能性が高く、そのまま気づかずに測定を始めると、判定に使う目標幅・
     公差が一部欠けたまま進めてしまう事故につながる。
     子ロット番号は親ロットと同じ先頭5桁を共有するため、子ロットごとに個別問い合わせ
     せず、先頭5桁が一致する仕掛データを1回の問い合わせでまとめて取得し、期待される
     子ロット番号がその中に存在するかを確認する(findParentLotForと同じ問い合わせ
     パターンを流用)。分割データが無い行はfalseを返さずnull(対象外)とする。 */
  async function findMissingChildLots(row,{light=false}={}){
    if(!row||!rowHasSplitData(row))return null;
    const lotNo=String(pick(row,'lotNo')||'');
    if(lotNo.length<5)return null;
    const expected=expectedChildLotsForRow(row,lotNo);
    if(!expected.length)return null;
    try{
      const table=await resolveSikaTable();if(!table)return null;
      const columns=await resolveSikaColumns(table);if(!columns.length)return null;
      // 要るのは「そのロット番号が仕掛に居るか」だけなので、一覧からの
      // 呼び出しは軽い方(ロット番号だけ)で足りる(§9.94)。
      const rows=await (light?searchByLotPrefixLight:searchByLotPrefix)(table,columns,lotNo.slice(0,5));
      const present=new Set(rows.map(r=>String(pick(r,'lotNo')||'')));
      const missing=expected.filter(lot=>!present.has(lot));
      return{expected,missing};
    }catch(e){console.warn('子ロット存在確認に失敗しました: '+lotNo,e);return null}
  }
  window.findMissingChildLots=findMissingChildLots;

  /* ---------- 予定投入時の子ロット取得(§9.83) ----------
     作業スケジュールへ分割ありの親ロットを入れるとき、その場で子ロットの
     仕掛データも引いて一緒に登録する。子ロットは親と先頭5桁を共有するので
     **1回の問い合わせでまとめて**引く(findMissingChildLots と同じ形)。
     子ロットごとに引くと、9分割なら9往復。共有越し(1回150ms)では
     「予定へ追加」を押してから1秒以上待たされることになる。

     仕掛に見つからない子ロット(作業済みで仕掛から外れている等)も
     **落とさずに返す**。missing:true を付けて、そのまま予定へ載せる。
     黙って消すと「9分割のはずが7件しか出ない」という気づけない欠落になる。

     新しい公開はWL名前空間へ入れる(CLAUDE.mdの約束)。既存のwindow.*は
     動いている契約なのでそのまま。 */
  async function childRowsForRow(row){
    if(!row||!rowHasSplitData(row))return [];
    const lotNo=String(pick(row,'lotNo')||'');
    const expected=expectedChildLotsForRow(row,lotNo);
    if(!expected.length)return [];
    let found=new Map();
    try{
      const table=await resolveSikaTable();
      const columns=table?await resolveSikaColumns(table):[];
      if(table&&columns.length&&lotNo.length>=5){
        const rows=await searchByLotPrefix(table,columns,lotNo.slice(0,5));
        rows.forEach(r=>found.set(String(pick(r,'lotNo')||''),r));
      }
    }catch(e){
      // 引けなくても予定への投入自体は止めない(番号だけで載せる)。
      console.warn('子ロットの取得に失敗しました: '+lotNo,e);
    }
    return expected.map((lot,i)=>{
      const child=found.get(lot)||null;
      const width=child?baseFromRow(child,'width'):NaN;
      const tol=child?toleranceFromRow(child,'width','manufacturing')||toleranceFromRow(child,'width','order'):null;
      return {lot,row:child,missing:!child,
              width:Number.isFinite(width)?width:null,
              strips:child?childOwnCount(child,childCount(i+1,row)||1):(childCount(i+1,row)||1),
              tol:tol?{plus:tol.plus,minus:tol.minus}:null};
    });
  }
  window.WL=window.WL||{};
  window.WL.split=Object.assign(window.WL.split||{},{
    hasSplit:rowHasSplitData,
    childLots:expectedChildLotsForRow,
    childRowsForRow,
  });

  // 割った後の材料はすべて子ロットになり、開いている親ロット自身の「持ち分」
  // という概念は存在しない。条割の組み合わせは検出できた子ロットのみで構成する。
  function buildCandidateList(){
    const direct=directChildLotNumbers(),carded=childLotNumbersFromCard();
    const picks=direct.length?direct:carded;
    const seen=new Set(),children=[];
    picks.forEach(({lot,index})=>{if(!lot||seen.has(lot))return;seen.add(lot);const count=childCount(index);if(count>0)children.push({lot:String(lot),count})});
    return children;
  }

  function describeTol(entry){
    if(entry.missing)return '子ロット情報を取得できませんでした';
    const w=entry.tolData?.width?.manufacturing||entry.tolData?.width?.order;
    if(!w||!Number.isFinite(entry.base?.width))return '公差情報なし';
    return `幅${entry.base.width} (+${w.plus}/-${w.minus})`;
  }

  // 子ロットの条数(この子ロットが実際に何条分を占めるか)は、親ロット側の
  // 子カード配列から推測した値(childCount、YK*系フィールドが無ければ
  // 「切断巾があれば1条」という未確証のフォールバック)ではなく、子ロット
  // 自身の仕掛データにある「BOX設計_横割数」を優先する。親側からの推測に
  // 頼っていたため、実際の子ロット自身の条数と食い違い、条割変更で
  // 横割数と子ロット条数合計が一致しなくなることがあった。
  function childOwnCount(row,fallback){
    const n=Number(pick(row,'boxHorizontalCount'));
    return Number.isFinite(n)&&n>=1&&n<=40?Math.round(n):fallback;
  }
  async function buildSplitSources(){
    const children=buildCandidateList(),out=[];
    for(const c of children){
      const row=await fetchChildLotRow(c.lot);
      if(!row){out.push({lot:c.lot,count:c.count,width:'',tol:'子ロット情報を取得できませんでした',missing:true});continue}
      const entry={lot:c.lot,count:childOwnCount(row,c.count),missing:false,
        base:{thickness:baseFromRow(row,'thickness'),width:baseFromRow(row,'width')},
        tolData:{thickness:{manufacturing:toleranceFromRow(row,'thickness','manufacturing'),order:toleranceFromRow(row,'thickness','order')},
             width:{manufacturing:toleranceFromRow(row,'width','manufacturing'),order:toleranceFromRow(row,'width','order')}}};
      entry.width=Number.isFinite(entry.base.width)?entry.base.width:'';
      entry.tol=describeTol(entry);
      out.push(entry);
    }
    return out;
  }

  /* splitSourceRows(): 非同期取得済みキャッシュを返す同期関数。renderSplit/
     applySplitはこの関数を同期呼び出しする。幅分割情報パネル(#splitGrid)側でも
     同じキャッシュを使い、条割変更モーダルを開く前から候補データを能動的に
     表示できるようにする(ensureSplitCandidatesLoaded)。
     ロットが変わったらキャッシュを破棄するため、取得時のロット№をキーとして保持する。 */
  let splitSourcesCache=null,splitSourcesCacheKey=null,splitSourcesLoading=null;
  function currentSplitCacheKey(){return S.measure?.basic?.lotNo||''}
  /* 子ロット候補が取れないときは**確定済みの割当から作り直す**（§9.156、
     利用者の指摘）。実機で「子ロットの取得: 取得OK→取得失敗」となったロットは
     `splitGroups`に3ロット/9条が確定しているのに候補が空で、条の並びが
     **「条割の対象となる子ロットがありません」のまま**＝1条ずつのD&Dが
     まったくできなかった（まとめ帯だけが出ており、あれは掴めない）。
     確定済みの割当はロット・条数・幅・公差を持っているので、**候補が無くても
     並べ替えの材料としては足りる**。取り直せたら候補側が勝つ。 */
  function splitSourceRows(){
    if(splitSourcesCache&&splitSourcesCacheKey===currentSplitCacheKey())return splitSourcesCache;
    return rowsFromAppliedGroups();
  }
  /* ---------- 分割の無いロットでも図を出す（§9.209 ②、利用者の指示） ----------
     「分割なしでも、取得済みのロットのデータで図を表現してほしいです。
      屑幅の片寄や条割数の視覚化、異常発生時の条番号特定など様々な機能を
      使う必要があります。」

     材料は**親ロット自身**——条数は横割数、幅は製造板幅。
     **並べ替えはできない**（同じロットの条しか無いので、動かしても意味が
     変わらない）。使えるのは「何条あるか」「どの条か」「屑がどちらへ
     どれだけ寄っているか」で、それは分割の有無に関わらず要る。 */
  function selfSplitRows(){
    const m=S.measure;if(!m)return [];
    const lot=String(m.basic?.lotNo||'').trim();
    const count=Math.max(1,Math.min(40,+($('#horizontalCount')?.value)||1));
    const w=m.basic?.mfgWidth;
    const width=(w===undefined||w===null||w==='')?'':String(w);
    return [{lot:lot||'（このロット）',count,width,tol:'',
             base:{width:w},tolObj:null,missing:false,self:true}];
  }
  /* 図だけを出す（編集面は出さない）。**器は`renderSplit()`と同じ関数**を
     通す——別の組み立てを作ると、分割ありと無しで図の形が変わる。 */
  function renderSelfSplitVisual(){
    const box=document.querySelector('#splitCard .split-visual');
    /* **できないことは書かない**（§4）。並べ替えられないので、案内も
       「1つ戻す／初めから」も出さない。 */
    /* **案内は器に入るぶんだけ出し、全文は`title`で読ませる**（§9.234 ①）。
       この行はボタンと場所を分け合うので、文が長いと折り返して行が増える。 */
    const hint=$('#splitVisualHint'),selfHint='帯の幅は母材幅の比率。条を押すと番号と幅を確かめられます。両端の OS＝オペレータ側／DS＝駆動側。';
    if(hint){hint.textContent=selfHint;hint.title=selfHint}
    ['#undoSplit','#resetSplit'].forEach(sel=>{const el=$(sel);if(el&&el.hidden!==true)el.hidden=true});
    const rows=selfSplitRows();
    const total=rows.reduce((a,x)=>a+x.count,0);
    if(!rows.length||!total){if(box)box.hidden=true;return}
    if(box)box.hidden=false;
    const strip=$('#splitVisualStrip');
    if(strip)strip.classList.add('split-visual-self');
    const seq=Array.from({length:total},()=>rows[0].lot);
    renderSplitVisual(rows,seq,splitLotColorMap(rows));
  }
  function rowsFromAppliedGroups(){
    const groups=S.measure?.settings?.splitGroups;
    if(!Array.isArray(groups)||!groups.length)return [];
    return groups.map(g=>({
      lot:String(g.lot||''),count:Math.max(1,Number(g.count)||1),
      width:g.base&&g.base.width!==undefined&&g.base.width!==null?String(g.base.width):'',
      tol:splitTolText(g),base:g.base||{},tolObj:g.tol||null,
      missing:!!g.missing,fromApplied:true,
    }));
  }
  /* 帯の`title`に出す公差の文。確定済みの割当が持つ公差から組む
     （候補側の`tol`と同じ書式にする——同じ場所に出るので形が違うと別物に見える）。 */
  function splitTolText(g){
    const t=g&&g.tol&&g.tol.width&&(g.tol.width.manufacturing||g.tol.width.order);
    if(!t)return '';
    const p=t.plus,m=t.minus;
    if(p===undefined&&m===undefined)return '';
    return (p!==undefined?`+${p}`:'')+(m!==undefined?`/-${m}`:'');
  }
  window.splitSourceRows=splitSourceRows;
  /* 再編集などで測定を開き直すたびに、子ロットの詳細をAccessへ毎回
     問い合わせ直すと表示が遅い。1度計算できた候補(子ロットの生データ
     込み)はレコード自身(S.measure.settings.splitSourcesCache)へ保存
     対象として保持し、次回以降はそれをそのまま使って再計算・再問い合わせ
     を省略する(force指定時のみ強制的に取得し直す)。 */
  async function ensureSplitCandidatesLoaded(force){
    const key=currentSplitCacheKey();
    if(!force&&splitSourcesCache&&splitSourcesCacheKey===key)return splitSourcesCache;
    if(!force){
      const saved=S.measure?.settings?.splitSourcesCache;
      if(Array.isArray(saved)&&saved.length){
        splitSourcesCache=saved;splitSourcesCacheKey=key;
        refreshSplitStatusPanel();
        applySplitLive();
        return splitSourcesCache;
      }
    }
    if(splitSourcesLoading)return splitSourcesLoading;
    splitSourcesLoading=(async()=>{
      try{
        const sources=await buildSplitSources();
        splitSourcesCache=sources;splitSourcesCacheKey=key;
        if(S.measure){
          S.measure.settings.splitSourcesCache=sources;
          // 取得時刻を残す。この記録を後で再開したときに「いつ時点のデータか」を
          // 示し、バックグラウンドの更新確認が直後の二重取得を避ける判断にも使う。
          S.measure.settings.splitSourcesSavedAt=nowIso();
          if(typeof markDirty==='function')markDirty();
        }
      }catch(e){
        console.warn('分割候補の取得に失敗しました',e);
        splitSourcesCache=[];splitSourcesCacheKey=key;
      }finally{
        splitSourcesLoading=null;
        refreshSplitStatusPanel();
        /* **材料がそろった時点で当てる**（§9.149）。ここが唯一の「開いた直後」の
           入口——`openSplit()`はモーダル廃止で呼び出し元が無くなっている。
           当てないと「表は1条なのに図は2条」を抱えたまま測ることになる。 */
        applySplitLive();
      }
      return splitSourcesCache;
    })();
    return splitSourcesLoading;
  }
  window.ensureSplitCandidatesLoaded=ensureSplitCandidatesLoaded;

  /* 条割の並べ替え(母材幅比率の視覚配置版): 母材幅をほぼ100%として、各条を
     実際の条幅比率(子ロットの製造板幅)で並べた帯を主操作面にする。
     子ロット候補の並び順で最初から敷き詰めた状態を初期値とし(実務上その
     ままのケースが大半)、操作は「違っている部分だけ直す」ことに絞る。
     ------------------------------------------------------------
     データモデル:
     - splitSequence: 条数分の固定長配列。各要素はロット名(子ロット条数
       合計と横割数が一致しない場合のみ一部nullが残りうる)。
     - splitConfirmed: splitSequenceと同じ長さの真偽値配列。オペレータが
       実際にその条を確認/操作したかどうかを表す。初期配置は全てfalse
       (=自動配置のまま未確認)とし、視覚図で見た目を弱めて区別する。
       未確認の条が残ったまま条割を実行しようとした場合は確認ダイアログで
       一度立ち止まらせる(自動配置を無条件に信用してしまう事故の防止)。

     操作(単一ジェスチャーのドラッグ並べ替え):
     - 条ブロックをつかんで動かす → その場で追従し、ドロップ予定位置に
       ゴースト(同じ色・同じ幅の枠)を差し込んで表示する。離すとその位置へ
       挿入され、他の条は自動的に詰まる。移動した条は確認済みになる。
       「範囲選択→別ドラッグで移動」という2段階操作は認知負荷が高く、
       特に条数が少なく1条あたりの帯が広い場合に選択判定がうまく機能
       しなかったため廃止し、つかんだら即座に追従する直接操作の1段階に
       統一した(2条をA→B/B→Aに入れ替えるような単純な操作も、対象の
       ブロックを直接つかんで反対側へ運ぶだけで完結する)。
     - 条をタップ(ほぼ動かさないクリック) → 確認済み/未確認のトグル。
       移動量が小さい間はドラッグ扱いにしないため、タップと誤操作なく
       区別できる。
     - 子ロット候補カードをクリック → 視覚図内の該当する条を一時的に
       光らせて位置を確認できる(値は変えない、位置特定専用)。 */
  let activeLot=null;
  let splitUndoStack=[];
  let splitVisualLayout=null; // 直近描画時の幅レイアウト(ポインタ位置→条番号の逆算に使う)

  function ensureSequenceLength(total){
    const m=S.measure.settings;
    let seq=Array.isArray(m.splitSequence)?m.splitSequence.slice(0,total):[];
    while(seq.length<total)seq.push(null);
    m.splitSequence=seq;
    return seq;
  }
  function ensureConfirmedLength(total){
    const m=S.measure.settings;
    let arr=Array.isArray(m.splitConfirmed)?m.splitConfirmed.slice(0,total):[];
    while(arr.length<total)arr.push(false);
    m.splitConfirmed=arr;
    return arr;
  }
  function countAssigned(seq,lot){return seq.filter(x=>x===lot).length}
  function defaultFillSequence(sources,total){
    const seq=Array(total).fill(null);
    let idx=0;
    sources.forEach(s=>{for(let k=0;k<s.count&&idx<total;k++)seq[idx++]=s.lot});
    return seq;
  }
  // モーダルを開いた直後などsplitSequenceが空の場合のみ、候補の並び順で
  // 先頭から敷き詰めた初期配置を生成する(既に操作中の内容があれば保持)。
  function seedSplitDefaults(sources,total){
    const m=S.measure.settings,seq=ensureSequenceLength(total);
    /* **確定済みの割当が図と食い違ったら、割当のほうへ合わせる**（§9.156）。
       候補が取れず`splitGroups`から材料を作った場合、並びの控え
       (`splitSequence`)は前のロットのものが残っていることがあり、9条の器に
       2条ぶんしか名前が入らず**7条が「未割当」**になっていた（実測）。
       図が測定表と違うものを指すくらいなら、割当から引き直す。 */
    const applied=appliedSequence(total);
    if(applied&&(seq.length!==total||!seq.some(Boolean)
        ||seq.filter(Boolean).length!==applied.filter(Boolean).length)){
      m.splitSequence=applied;
      m.splitConfirmed=Array(total).fill(true);
      return{seq:m.splitSequence,confirmed:m.splitConfirmed};
    }
    if(total>0&&!seq.some(Boolean)){
      m.splitSequence=defaultFillSequence(sources,total);
      m.splitConfirmed=Array(total).fill(false);
    }else{
      ensureConfirmedLength(total);
    }
    return{seq:m.splitSequence,confirmed:m.splitConfirmed};
  }
  /* 確定済みの割当（`splitGroups`＋`splitPositionGroup`）を「条ごとのロット」
     の並びへ開く。どちらかが欠けていれば null（推測で埋めない）。 */
  function appliedSequence(total){
    const st=S.measure?.settings,groups=st?.splitGroups,pos=st?.splitPositionGroup;
    if(!Array.isArray(groups)||!groups.length||!Array.isArray(pos)||!pos.length)return null;
    const out=[];
    for(let i=0;i<total;i++){
      const g=groups[pos[i]];
      out.push(g?String(g.lot||''):'');
    }
    return out.some(Boolean)?out:null;
  }
  function pushUndoSnapshot(seq,confirmed){
    splitUndoStack.push({seq:seq.slice(),confirmed:confirmed.slice()});
    if(splitUndoStack.length>20)splitUndoStack.shift();
  }
  // 選択範囲(start〜end、両端含む)をドロップ位置(dropIndex、移動前の配列
  // 基準の挿入先インデックス)へ移動する。他の条は自動的に詰まる。
  // 移動した条は確認済み(true)になる。
  function moveRange(seq,confirmed,start,end,dropIndex){
    const len=end-start+1,seqBlock=seq.slice(start,end+1);
    seq.splice(start,len);
    confirmed.splice(start,len);
    let insertAt=dropIndex>start?dropIndex-len:dropIndex;
    insertAt=Math.max(0,Math.min(insertAt,seq.length));
    seq.splice(insertAt,0,...seqBlock);
    confirmed.splice(insertAt,0,...seqBlock.map(()=>true));
    return insertAt;
  }

  /* ---------- 子ロットの色（§9.159） ----------
     **色はロット番号だけで決める**（並び順で決めない）。以前は
     `sources`／`groups`の**添字**で配っていたため、条を1つ並べ替えただけで
     ロットと色の対応が入れ替わり、**図・測定表のバッジ・幅分割の丸が
     いっせいに別の色になった**（実機で報告。「入れ替えた瞬間色味が変わる」）。
     色は「どのロットか」を指す印なので、並びで変わってはいけない。
     ロット番号を**辞書順**に並べて配る——基本情報の「分割ロット」も同じ順で
     並ぶので、色の並びと文字の並びが一致する。

     配色は**彩度を一段落とした8色**。原色（#dc2626・#2563eb 等）を並べると
     図そのものが騒がしくなり、**公差外の赤・ドラッグ中の印といった
     「意味のある強い色」が埋もれる**（異常位置判定の図は先にこの配色へ
     移してあった。§9.101）。2つの画面で同じロットが違う色になっていた
     状態も、ここで1つに揃う。 */
  const LOT_COLORS=['#5b8f88','#b98d5f','#6d92b8','#8b81bb','#7ba061','#ab7086','#6e828c','#9c8460'];
  const LOT_COLOR_NEUTRAL='#8a9a97';
  function lotColorMap(lots){
    const uniq=[...new Set((lots||[]).map(x=>String(x||'')).filter(Boolean))].sort(),map={};
    uniq.forEach((lot,i)=>{map[lot]=LOT_COLORS[i%LOT_COLORS.length]});
    return map;
  }
  window.WL=window.WL||{};
  window.WL.lotColors={palette:LOT_COLORS,neutral:LOT_COLOR_NEUTRAL,map:lotColorMap};
  function splitLotColorMap(sources){return lotColorMap((sources||[]).map(s=>s.lot))}
  /* 図中のラベル（§9.213、利用者の指示「条幅が広い場合は、ロット番号全てを
     表示、幅が狭いものは下2桁表示としてください。幅が狭いものかつ異幅切断の
     場合は下3桁表示」）。
     **入るなら全部出す**のが原則で、入らないときだけ末尾へ落とす——
     図の中だけ下3桁固定だったため、余裕のある広い条でも番号を突き合わせる
     ことになっていた。桁数は**異幅切断なら3桁・等幅なら2桁**（異幅は
     ロットの種類が増えるので2桁だとぶつかりやすい）。
     詳細行・候補カード・ツールチップは今までどおりロット番号全体。 */
  function lotSuffix3(lot){const s=String(lot||'');return s.length>3?s.slice(-3):s}
  function lotSuffixN(lot,n){const s=String(lot||'');return s.length>n?s.slice(-n):s}

  // ポインタ位置(clientX)→条番号(0始まり)。直近描画時の幅レイアウト
  // (splitVisualLayout)を使うため、同一ロットが連続する範囲を1つの帯に
  // まとめて描画していても(条ごとにDOM要素を持たなくても)正確に条を
  // 特定できる。
  function indexAtClientX(clientX){
    const strip=$('#splitVisualStrip');
    if(!strip||!splitVisualLayout)return -1;
    const rect=strip.getBoundingClientRect();
    if(!rect.width)return -1;
    const frac=Math.min(1,Math.max(0,(clientX-rect.left)/rect.width));
    const target=frac*splitVisualLayout.totalUnits,{cum,total}=splitVisualLayout;
    for(let i=0;i<total;i++){if(target<cum[i+1])return i}
    return total-1;
  }
  // 移動(挿入)先の位置(0〜total、totalは末尾への追加を意味する)。セルの
  // 中間点より左なら「そのセルの手前」、右なら「そのセルの後ろ(=次の
  // セルの手前)」を返す。indexAtClientXはセル自体の特定用(0〜total-1)
  // なので、末尾ちょうどへの挿入を表現できない。ドロップ位置の判定には
  // 必ずこちらを使う。
  function dropTargetIndex(clientX){
    const strip=$('#splitVisualStrip');
    if(!strip||!splitVisualLayout)return -1;
    const rect=strip.getBoundingClientRect();
    if(!rect.width)return -1;
    const frac=Math.min(1,Math.max(0,(clientX-rect.left)/rect.width));
    const target=frac*splitVisualLayout.totalUnits,{cum,total}=splitVisualLayout;
    for(let i=0;i<total;i++){if(target<(cum[i]+cum[i+1])/2)return i}
    return total;
  }
  function computeVisualLayout(seq,sources){
    const widthMap=Object.fromEntries(sources.map(s=>[s.lot,Number(s.width)||0]));
    const units=seq.map(lot=>{const w=lot?widthMap[lot]:0;return w>0?w:1}),cum=[0];
    units.forEach(u=>cum.push(cum[cum.length-1]+u));
    return{cum,totalUnits:cum[cum.length-1]||1,total:seq.length};
  }

  /* 条の並び視覚図(#splitVisualStrip)。母材幅をほぼ100%として、各条を
     実際の条幅比率(子ロットの製造板幅)で並べた帯として描画する。同じ
     ロットが連続していても1条=1マスとして個別に描画し(最大40条規模でも
     見やすい)、条ごとに独立してドラッグ操作できるようにする。ラベルは
     ロット番号下3桁と板幅のみとし、狭いマスでも読める簡潔さを優先する
     (ロット番号全体・公差は詳細行とツールチップで確認する)。 */
  /* 選んだ条の説明は**操作の案内と同じ1行を使う**（§9.159）。以前は図の下に
     独立した行を持ち、`hidden`で畳んでいたため**条を押すたびに行が1本増え、
     図の高さが24px縮んでいた**（実測 201px→177px。「クリックしたら条の図形の
     サイズが変わる」）。器を1つにすれば、中身が入れ替わるだけで高さは動かない。
     案内（何ができるか）は選ぶ前に読むもの、説明（何を選んだか）は選んだ後に
     読むものなので、同じ場所で入れ替わるのは読み順とも合う。 */
  function setVisualDetail(text){
    const el=$('#splitVisualDetail'),hint=$('#splitVisualHint');
    if(!el)return;
    const t=String(text||'');
    if(el.textContent!==t){el.textContent=t;el.title=t}
    if(el.hidden!==!t)el.hidden=!t;
    if(hint&&hint.hidden!==!!t)hint.hidden=!!t;
  }
  /* いま選んでいる条（0始まり、-1＝選んでいない）。**押しただけでは並びを
     変えない**ので、押した結果を画面へ返すにはこれが要る（§9.159、利用者の
     指摘「クリックしてもどれをクリックしたかわからない」）。並べ替えたら
     動いた先へ付いていく（`moveRange`が入った位置を返す）。 */
  let selectedStrip=-1;
  function selectStrip(i){selectedStrip=Number.isInteger(i)?i:-1}
  /* ---------- 異常位置判定との連携（§9.226 ②、利用者の指示） ----------
     「条の設計（幅の割り付け）と異常位置判定をより連携させたい。欠陥判定
      したら、条の設計にも表示したい(ONOFF可能)。判定した場合はバッジを
      表示して、欠陥が入っていることを表示する。バッジのダブルクリックから
      異常位置判定モーダルに移行できる。」

     **どの条に掛かるかは`WL.defect.markers()`の1箇所が答える**（§9.160と
     同じ約束）。ここで条を数え直すと、屑幅の片寄せ・基準幅の取り方という
     前提が2つに分かれる。
     出す/出さないは**この端末の覚え**（読み方の好みなのでPCごとに違って
     よい。§9.199の`childBadge`と同じ考え方）。 */
  const DEFECT_SHOW_KEY='SplitDefectShowV1';
  function defectShown(){
    try{return localStorage.getItem(DEFECT_SHOW_KEY)!=='0'}catch(e){return true}
  }
  function setDefectShown(on){
    try{localStorage.setItem(DEFECT_SHOW_KEY,on?'1':'0')}catch(e){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',e)}
  }
  function defectInfo(){
    if(!(window.WL&&WL.defect&&WL.defect.markers))return null;
    try{return WL.defect.markers()}catch(e){return null}
  }
  /* 図に印を出すぶん（切のときは出さない）。**帯の文字は別**——切にしていても
     「判定はある」ことは言う（黙って隠すと、設定したこと自体を忘れる・§9.125）。 */
  function defectMarkers(){return defectShown()?defectInfo():null}
  function renderDefectChip(dm){
    const chip=$('#splitDefectChip'),tg=$('#splitDefectToggle');
    const info=dm||defectInfo();
    const has=!!(info&&info.lanes);
    if(tg){
      tg.hidden=!has;
      const on=defectShown();
      tg.setAttribute('aria-pressed',on?'true':'false');
      tg.textContent=on?'異常の印: 出す':'異常の印: 出さない';
      tg.title=on?'条の設計に異常位置判定の該当条を出しています。押すと隠します'
                 :'いまは出していません。押すと該当条に印が出ます';
    }
    if(!chip)return;
    chip.hidden=!has;
    if(!has)return;
    const n=info.lanes.length;
    /* **同じ数字を2箇所に出さない**（§CLAUDE 8）ので、ここは「何条か」と
       「帳票に載るか」だけ。距離や基準は判定の窓が持つ。 */
    const state=info.saved?(info.stale?'保存後に変更あり':'保存済み'):'未保存';
    chip.innerHTML=`<b>異常 ${n?`${n}条`:'該当なし'}</b><small>${esc(state)}</small>`;
    /* **何か所ぶんかも言う**（§9.323 ②）——2か所が同じ条に掛かると`1条`と
       しか出ないので、条の数だけでは箇所の数が読めない。**1か所のときは
       言わない**（今までどおりの文のまま・§9.132）。 */
    const sp=Number(info.spotCount)||1;
    chip.title=(n?`異常位置判定で${n}条に掛かっています`:'判定はありますが、製品の条には掛かっていません')
      +`（${info.memo||'内容の記載なし'}）`
      +(sp>1?`／混入位置は${sp}か所`:'')
      +`／${info.saved?(info.stale?'保存後に入力が変わっています。帳票には保存時の内容が出ます':'帳票にも出ます')
                     :'未保存なので帳票には出ません'}`
      +'／押すと異常位置判定を開きます';
    chip.classList.toggle('is-hit',n>0);
    chip.classList.toggle('is-stale',!!info.stale);
  }
  function renderSplitVisual(sources,seq,colorMap){
    const strip=$('#splitVisualStrip');
    const total=seq.length;
    if(!strip)return;
    if(!total){
      strip.innerHTML='<div class="split-visual-empty">条割の対象となる子ロットがありません。</div>';
      selectStrip(-1);setVisualDetail('');
      splitVisualLayout=null;
      renderScrapAndRuler(null);
      return;
    }
    if(selectedStrip>=total||(selectedStrip>=0&&!seq[selectedStrip]))selectStrip(-1);
    const layout=computeVisualLayout(seq,sources);
    splitVisualLayout=layout;
    const widthMap=Object.fromEntries(sources.map(s=>[s.lot,s.width])),tolMap=Object.fromEntries(sources.map(s=>[s.lot,s.tol]));
    /* **異幅切断か**（§9.213）。狭い条で出す桁数を決める材料——異幅は
       ロットの種類が増えるので、下2桁だと違うロットが同じに見える。
       幅の分からない条は数に入れない（空欄を1種類として数えると、
       等幅のロットまで異幅扱いになる）。 */
    const dm=defectMarkers();
    const hit=new Set((dm&&dm.lanes)||[]);
    const mixedWidths=new Set(seq.filter(Boolean)
      .map(l=>widthMap[l]).filter(w=>w!==''&&w!==undefined&&w!==null)
      .map(w=>String(w))).size>1;
    let html='<div class="split-visual-track">';
    for(let i=0;i<total;i++){
      const lot=seq[i];
      const left=layout.cum[i]/layout.totalUnits*100,width=(layout.cum[i+1]-layout.cum[i])/layout.totalUnits*100;
      const bg=lot?(colorMap[lot]||LOT_COLOR_NEUTRAL):'transparent';
      const fullLabel=lot?esc(lot):'未割当';
      const hasWidth=lot&&widthMap[lot]!==''&&widthMap[lot]!==undefined;
      const widthText=hasWidth?esc(String(widthMap[lot])):'';
      const tolText=lot?esc(tolMap[lot]||''):'';
      /* ラベルは**必ず作って、あとで幅ごとにまとめて決める**
         （§9.210 ④、`fitStripLabels`）。以前はここで「帯が全体の4%より
         広いか」だけを見ていたため、**同じ幅の条でも%の丸めで出たり
         出なかったり**した。判定に使う鍵は条幅そのもの——同じ幅なら
         必ず同じ見せ方になる。 */
      const wkey=hasWidth?'w'+String(widthMap[lot]):'u'+(layout.cum[i+1]-layout.cum[i]);
      /* **両方の書き方を置いて、あとで幅ごとにまとめて選ぶ**（§9.213）。
         片方だけ描いて後から差し替えると、差し替えるたびに測り直しが要る
         （`fitStripLabels`が1回で決められない）。 */
      const cellLabel=lot?`<span class="split-visual-block-label">`
        +`<b class="svb-lot">${esc(lot)}</b>`
        +`<b class="svb-lot-short">${esc(lotSuffixN(lot,mixedWidths?3:2))}</b>`
        +`${hasWidth?`<small>${widthText}</small>`:''}</span>`:'';
      /* 欠陥の掛かる条（§9.226 ②）。**色だけで伝えない**ので、印の文字と
         `title`の理由を必ず添える（§3）。ダブルクリックで判定の窓へ。 */
      const bad=hit.has(i);
      /* **両方の書き方を置いて、あとでまとめて選ぶ**（§9.213のラベルと同じ）。
         狭い条では`異常`が入らず`異`だけが残って読めなくなっていた
         （§9.234 ①、利用者の報告「異常位置の図の表示のラベルが別の表示と
         重なる」）。`fitStripLabels()`が「異常 → ! → 出さない」を決める。 */
      const flag=bad?`<b class="svb-defect" data-defect-flag="1"`
        +` title="異常位置判定でこの条に掛かっています${dm.memo?`（${esc(dm.memo)}）`:''}`
        +`／ダブルクリックで異常位置判定を開きます">`
        +`<span class="svb-defect-full">異常</span><span class="svb-defect-mark">!</span></b>`:'';
      html+=`<div class="split-visual-block${lot?'':' empty'}${i===selectedStrip?' is-selected':''}${bad?' is-defect':''}" data-start="${i}" data-end="${i}" data-lot="${lot?esc(lot):''}"${lot?` data-wkey="${esc(wkey)}"`:''} style="left:${left}%;width:${width}%;--split-block-bg:${bg}" title="${fullLabel} ／ ${i+1}条目${hasWidth?` ／ 幅${widthText}`:''}${tolText?` ／ ${tolText}`:''}${bad?' ／ 異常位置判定に該当':''}">${cellLabel}${flag}</div>`;
    }
    html+='<div class="split-visual-ghost" id="splitVisualGhost" hidden></div></div>';
    strip.innerHTML=html;
    /* 選んでいる条の説明は**描き直しても残す**（§9.159）。ここで空へ戻すと、
       並べ替えの直後に選択の印だけが残って説明が消える（何を選んでいるのかが
       印だけになる＝色でしか伝えていない状態）。 */
    setVisualDetail(describeStrip(seq,sources,selectedStrip));
    renderDefectChip(dm);
    ensureDefectChipWiring();
    ensureSplitVisualWiring();
    renderScrapAndRuler(layout);
    /* 屑の帯を置くと条の束の幅が変わる（`flexGrow`）ので、**最後に**測る。 */
    requestAnimationFrame(()=>{try{fitStripLabels(strip)}catch(e){WL.quiet.note('条の札の測り直しに失敗（前の段のまま出る）',e)}});
  }
  /* ---------- 同じ幅の条は同じ見せ方（§9.210 ④、利用者の指示） ----------
     「同じ幅にもかかわらず、表示があるものとないものが混在するときがある」。
     %の丸めで1pxだけ違う帯が生まれるため、しきい値をまたぐ条だけラベルが
     消えていた——**同じものが同じに見えないと、違いがあるのかと数え直す**。
     鍵は**条幅そのもの**（`data-wkey`）で、同じ幅の条は必ず同じ段になる。
     異幅分割では幅ごとに段が変わってよい（利用者の指示「異幅分割に限り
     ロット単位で許可」）——入らない幅の条に押し込むと、どのみち見切れて
     読めない。**群の中では「いちばん狭い条」で決める**（%の丸めで1px違う
     ため。広いほうで決めると、狭い1本だけが見切れる）。

     段は4つ（§9.213、利用者の指示「条幅が広い場合は、ロット番号全てを
     表示、幅が狭いものは下2桁表示。幅が狭いものかつ異幅切断の場合は
     下3桁表示」）:
       full  … ロット番号（全部）＋幅
       long  … ロット番号（全部）だけ
       short … 末尾だけ（異幅切断=3桁／等幅=2桁。描くときに決めてある）
       none  … 出さない
     **入るなら全部出す**のが原則。以前は図の中だけ下3桁固定で、余裕の
     ある広い条でも番号を突き合わせることになっていた。 */
  function fitStripLabels(strip){
    if(!strip)return;
    /* まだ画面に出ていない（幅0）ときは触らない——0で測ると全部「出さない」
       になり、開いた瞬間にラベルの無い図が出る。 */
    if(strip.getBoundingClientRect().width<1)return;
    const blocks=[...strip.querySelectorAll('.split-visual-block[data-wkey]')];
    if(!blocks.length)return;
    let pad=0;
    const groups=new Map();
    /* **測る前に前回の段を外す**（§9.213）。付いたまま測ると、前回
       `label-short`だった条では`.svb-lot`が`display:none`のままで幅0になり、
       **一度短くなった条は二度と長くならない**（広げても戻らない）。 */
    for(const el of blocks)el.classList.remove('label-long','label-short','label-none');
    for(const el of blocks){
      const label=el.querySelector('.split-visual-block-label');
      if(!label)continue;
      if(!pad){
        const cs=getComputedStyle(label);
        pad=(parseFloat(cs.paddingLeft)||0)+(parseFloat(cs.paddingRight)||0);
      }
      /* **段を決める前に測るので、どちらの書き方も画面に出しておく**
         （`is-measuring`。片方を`display:none`にしたまま測ると0になり、
         いつまでも短いほうが選ばれない）。 */
      label.classList.add('is-measuring');
      const lotFull=label.querySelector('.svb-lot');
      const lotShort=label.querySelector('.svb-lot-short');
      const small=label.querySelector('small');
      const key=el.dataset.wkey;
      const g=groups.get(key)||{els:[],room:Infinity,short:0,long:0,full:0};
      g.els.push(el);
      g.room=Math.min(g.room,el.getBoundingClientRect().width);
      /* ラベルは縦積みなので、要る幅は**子のうち広いほう**。 */
      const fw=lotFull?lotFull.getBoundingClientRect().width:0;
      const sh=lotShort?lotShort.getBoundingClientRect().width:0;
      const sw=small?small.getBoundingClientRect().width:0;
      g.short=Math.max(g.short,sh);
      g.long=Math.max(g.long,fw);
      g.full=Math.max(g.full,Math.max(fw,sw));
      groups.set(key,g);
      label.classList.remove('is-measuring');
    }
    for(const g of groups.values()){
      const level=g.room>=g.full+pad?'full'
                 :g.room>=g.long+pad?'long'
                 :g.room>=g.short+pad?'short':'none';
      for(const el of g.els){
        el.classList.toggle('label-long',level==='long');
        el.classList.toggle('label-short',level==='short');
        el.classList.toggle('label-none',level==='none');
      }
    }
    fitDefectFlags(strip);
  }
  /* 異常の印も「異常 → ! → 出さない」の3段（§9.234 ①）。**いちばん狭い
     該当条で決める**——広いほうで決めると狭い1本だけが切れる（§9.210 ④と
     同じ理由）。**該当条は幅がまちまちでも同じ見せ方**にする：出たり出な
     かったりが図の中で混ざると、何か違いがあるのかと読み手が数え直す。
     出さない段でも、条の赤い縁と帯のチップ（異常 N条）が「異常がある」ことを
     文字で言っているので、読む手立ては残る（§3）。 */
  function fitDefectFlags(strip){
    const flags=[...strip.querySelectorAll('.split-visual-block .svb-defect')]
      .filter(f=>f.closest('.split-visual-block'));
    if(!flags.length)return;
    /* **測るのは印そのもの**（中の文字ではない）。`.svb-defect`は
       `max-width:100%`＋`overflow:hidden`なので、中の`<span>`を`display:block`
       にして測ると**親の幅に切り詰められた値**が返る（実測22pxのはずが10.7px
       で、いつまでも「入る」と判定されていた）。測るあいだだけ`max-width`を
       外し、段ごとに器の外寸を測る。 */
    let room=Infinity,full=0,mark=0;
    for(const f of flags){
      f.closest('.split-visual-block').classList.remove('defect-mark','defect-none');
      f.classList.add('is-measuring');
    }
    for(const f of flags){
      room=Math.min(room,f.closest('.split-visual-block').getBoundingClientRect().width);
      full=Math.max(full,f.getBoundingClientRect().width);
    }
    for(const f of flags)f.classList.add('measure-mark');
    for(const f of flags)mark=Math.max(mark,f.getBoundingClientRect().width);
    for(const f of flags)f.classList.remove('is-measuring','measure-mark');
    if(!Number.isFinite(room)||room<1)return;   /* 幅0のときは触らない */
    const level=room>=full?'full':room>=mark?'mark':'none';
    for(const f of flags){
      const blk=f.closest('.split-visual-block');
      blk.classList.toggle('defect-mark',level==='mark');
      blk.classList.toggle('defect-none',level==='none');
    }
  }
  /* 選んだ条の1行。ロット番号・幅・公差は帯の`title`と同じ材料だが、
     **マウスを載せなくても読める場所**が要る（触った結果を画面に返す）。 */
  function describeStrip(seq,sources,idx){
    if(!Array.isArray(seq)||idx<0||idx>=seq.length)return '';
    const lot=seq[idx];if(!lot)return '';
    const src=(sources||[]).find(s=>s.lot===lot);
    const w=src&&src.width!==''&&src.width!==undefined?src.width:'—';
    return `${idx+1}条目 ／ ${lot} ／ 幅${w} ／ ${(src&&src.tol)||'公差情報なし'}`;
  }
  // 屑幅(両耳合計)を条ストリップの両端へ「動かせない帯」として描画する
  // (#splitVisualScrapOs/Ds、条とは違いドラッグ操作の対象外)。
  // **割り付けは均等とは限らない**(§9.160)——片側へ寄せたときは
  // 図もそのとおりに出す。センターライン(薄い点線)は**母材全幅(元幅)の
  // 中央**なので位置は変わらないが、片寄せすると条の束の中央とはずれる
  // （ずれていることが見えるのがこの図の値打ち）。目盛りも元幅(実績)が
  // 判明していれば±1000/1250/1500mmを母材幅の範囲で重ねて表示する。
  function renderScrapAndRuler(layout){
    const scrapOs=$('#splitVisualScrapOs'),scrapDs=$('#splitVisualScrapDs'),strip=$('#splitVisualStrip'),ruler=$('#splitVisualRuler');
    if(!scrapOs||!scrapDs||!strip||!ruler)return;
    const info=layout?scrapWidthInfo():null;
    const stripUnits=layout?layout.totalUnits:0;
    if(info&&Number.isFinite(info.scrap)&&info.scrap>0&&stripUnits>0){
      strip.style.flexGrow=stripUnits;
      // 幅が0の側は帯ごと出さない——`min-width`が効いて「26pxの屑」が
      // 残り、寄せ切ったのに寄っていないように見える。
      const side=(el,mm,name)=>{
        const on=mm>0.0001,text=esc(fmtDim(mm,1));
        if(el.hidden!==!on)el.hidden=!on;
        el.style.flexGrow=on?mm:'';
        /* **文字の幅で帯の幅が決まらないようにする**（§9.221 ⑥③）。
           `flex-basis:auto`のままだと「屑 12.5」の文字幅が下限になり、
           mmの比で割り付けたはずの帯が実際より太く出て、そのぶん条の束が
           痩せる（利用者の報告「図が崩れる」の実体）。 */
        el.style.flexBasis='0';
        el.innerHTML=on?`<span class="split-visual-scrap-label"><i>屑</i><b>${text}</b></span>`:'';
        el.title=on?`屑幅(${name}側) ${text} ／ 両耳合計 ${esc(fmtDim(info.scrap,1))}${info.biased?'（片寄せ）':'（均等）'}`:'';
        el.classList.toggle('is-biased',on&&info.biased);
      };
      side(scrapOs,info.os,'OS');
      side(scrapDs,info.ds,'DS');
      placeScrapGrips(info);
      /* **描いてから測る**（§9.173）。`flex-grow`を書き換えた直後の
         `clientWidth`は**組み直す前の幅**なので、そのまま測ると前回の
         幅で段を決めることになる（実測: 6pxの帯なのに文字が入ると判定）。 */
      requestAnimationFrame(()=>fitScrapLabels());
    }else{
      placeScrapGrips(null);
      scrapOs.hidden=true;scrapDs.hidden=true;scrapOs.innerHTML='';scrapDs.innerHTML='';
      scrapOs.style.flexGrow='';scrapDs.style.flexGrow='';strip.style.flexGrow='';
      scrapOs.style.flexBasis='';scrapDs.style.flexBasis='';
      scrapOs.classList.remove('is-biased');scrapDs.classList.remove('is-biased');
    }
    renderScrapAllocEditor();
    if(!layout){ruler.innerHTML='';return}
    let html='<div class="split-visual-centerline" title="センターライン"></div>';
    if(info&&info.scrap>=0&&Number.isFinite(info.original)&&info.original>0){
      const half=info.original/2;
      /* 目盛りの数字は`translateX(-50%)`で線の真上に置くので、**端に近い
         目盛りは器の外へ半分はみ出す**——そこにはOS／DSの文字があり、
         重なって両方読めなくなる（§9.221 ⑥③、利用者の報告「左右OS,DS辺りに
         ある文字列が渋滞して重なり合い」）。器の縁から6%より内に入らない
         目盛りは、数字を**内側へ寄せて**置く。 */
      const EDGE_PCT=6;
      [1000,1250,1500].forEach(d=>{
        if(d>half)return;
        const pct=d/info.original*100;
        [50-pct,50+pct].forEach(at=>{
          const side=at<EDGE_PCT?' is-edge-left':(at>100-EDGE_PCT?' is-edge-right':'');
          html+=`<div class="split-visual-tick${side}" style="left:${at.toFixed(3)}%"><span class="split-visual-tick-label">${d}</span></div>`;
        });
      });
    }
    ruler.innerHTML=html;
    /* 目盛りの数字の置き場（`.split-visual-tick-label{top:-15px}`）は、
       **数字があるときだけ空ける**（§9.234 ①）。母材幅が2000mm未満の
       ロットでは±1000mmの目盛りが図の外になるので数字は1つも出ないのに、
       図の上に16pxの余白を常に取っており、カードが縦に溢れる原因の1つに
       なっていた。センターラインの`top:-5px`ぶんは常に空けておく。 */
    const row=document.querySelector('#splitCard .split-visual-row');
    if(row){
      const hasTicks=html.indexOf('split-visual-tick-label')>=0;
      if(row.classList.contains('has-tick-labels')!==hasTicks)
        row.classList.toggle('has-tick-labels',hasTicks);
    }
  }
  /* ---------- 屑の帯の文字は入るぶんだけ(§9.221 ⑥③) ----------
     帯の幅はmmの比で決まる（上）ので、狭い側では「屑 12.5」が入らない。
     入らないまま`nowrap`で置くと**隣のOS／DSや条の帯の上へはみ出す**。
     段は「屑＋数字」→「数字だけ」→「出さない」の3つで、**幅ごとに
     まとめて決めない**（左右で屑幅が違うのが普通なので、片側だけ短くて
     よい）。値は状態帯と`title`にあるので、消しても読む手立ては残る
     ——`fitStripLabels()`（§9.210 ④）と同じ考え方。 */
  function fitScrapLabels(){
    ['#splitVisualScrapOs','#splitVisualScrapDs'].forEach(sel=>{
      const el=$(sel);if(!el||el.hidden)return;
      const label=el.querySelector('.split-visual-scrap-label');if(!label)return;
      const room=el.clientWidth;
      if(!room)return;                       /* 幅0のときは触らない（0で測ると全部消える） */
      label.classList.remove('is-short','is-gone');
      if(label.scrollWidth<=room)return;
      label.classList.add('is-short');
      if(label.scrollWidth<=room)return;
      label.classList.add('is-gone');
    });
  }
  // ドラッグ中、ドロップ予定位置に「入る予定の条」と同じ色・同じ幅の
  // ゴーストを差し込んで表示する(どこに入るかを視覚的に明示する)。
  function showGhost(dragBlock,dropIndex){
    const ghost=$('#splitVisualGhost');
    if(!ghost||!splitVisualLayout)return;
    const{cum,totalUnits}=splitVisualLayout;
    const widthUnits=cum[dragBlock.end+1]-cum[dragBlock.start];
    ghost.hidden=false;
    ghost.style.left=(cum[dropIndex]/totalUnits*100)+'%';
    ghost.style.width=(widthUnits/totalUnits*100)+'%';
    ghost.style.setProperty('--split-block-bg',dragBlock.color||LOT_COLOR_NEUTRAL);
    ghost.innerHTML=`<span class="split-visual-block-label"><b>${esc(lotSuffix3(dragBlock.lot||''))}</b></span>`;
  }
  function hideGhost(){const ghost=$('#splitVisualGhost');if(ghost)ghost.hidden=true}
  function flashLotInVisual(lot){
    const strip=$('#splitVisualStrip');if(!strip)return;
    strip.querySelectorAll('.split-visual-block').forEach(el=>{
      if(el.dataset.lot===lot){el.classList.add('flash');setTimeout(()=>el.classList.remove('flash'),900)}
    });
  }

  // 条を1つ(1条)ずつ直接つかんで運ぶ、単一ジェスチャーのドラッグ並べ替え。
  // 同じロットが連続していても隣接条どうしをまとめて動かすことはせず、
  // 常に1条単位で並べ替える(複雑な入れ替えも1条ずつの操作で組み立てる)。
  // 「範囲選択→別ドラッグで移動」の2段階方式は、条数が少なく1条あたりの
  // 帯が広い場合にセル境界をまたぐ判定が働かず選択自体が成立しないことが
  // あり、認知負荷も高かったため廃止した。掴んだ位置からのポインタ移動が
  // 閾値を超えるまでは「タップ」として扱い(詳細表示のみ・並びは変えない)、
  // 超えたら「ドラッグ」として即座に追従・ゴースト表示を開始する。
  const DRAG_START_THRESHOLD=6;
  let splitVisualWired=false;
  function ensureSplitVisualWiring(){
    const strip=$('#splitVisualStrip');
    if(!strip||splitVisualWired)return;
    splitVisualWired=true;
    let downX=0,downY=0,dragging=false,dragBlock=null;
    function context(){
      /* 分割の無いロットは**親ロット自身**が材料（§9.209 ②）。ここで
         落とすと、条を押しても説明が出ない（`splitSourceRows()`は空）。 */
      const self=strip.classList.contains('split-visual-self');
      const sources=self?selfSplitRows():splitSourceRows();
      const total=sources.reduce((a,x)=>a+x.count,0);
      if(self)return{sources,total,seq:Array.from({length:total},()=>sources[0].lot),confirmed:[]};
      return{sources,total,seq:ensureSequenceLength(total),confirmed:ensureConfirmedLength(total)};
    }
    function updateDetailFor(idx){
      const{seq,sources}=context();
      setVisualDetail(describeStrip(seq,sources,idx));
    }
    function beginDragging(){
      dragging=true;
      strip.classList.add('split-visual-dragging');
      const el=strip.querySelector(`.split-visual-block[data-start="${dragBlock.start}"][data-end="${dragBlock.end}"]`);
      if(el)el.classList.add('lifted');
    }
    function handleMove(e){
      if(!dragging){
        if(Math.hypot(e.clientX-downX,e.clientY-downY)<DRAG_START_THRESHOLD)return;
        beginDragging();
      }
      const drop=dropTargetIndex(e.clientX);if(drop<0)return;
      const{total}=context();
      dragBlock.dropTarget=Math.max(0,Math.min(drop-dragBlock.grabOffset,total));
      showGhost(dragBlock,dragBlock.dropTarget);
    }
    function handleUp(e){
      document.removeEventListener('pointermove',handleMove);
      document.removeEventListener('pointerup',handleUp);
      document.removeEventListener('pointercancel',handleUp);
      strip.classList.remove('split-visual-dragging');
      hideGhost();
      if(!dragging){
        /* ほぼ動かさないタップは**選ぶだけ**——並びは一切変えない。
           同じ条をもう一度押したら選択を外す（§9.159）。選んだ結果は
           帯の印と説明の行に出す（`renderSplitVisual`が`is-selected`を付ける）。 */
        selectStrip(selectedStrip===dragBlock.start?-1:dragBlock.start);
        renderSplit();
      }else{
        const drop=dropTargetIndex(e.clientX);
        const{seq,confirmed,total}=context();
        const dropStart=drop<0?dragBlock.dropTarget:Math.max(0,Math.min(drop-dragBlock.grabOffset,total));
        pushUndoSnapshot(seq,confirmed);
        /* 選んでいた条は**動いた先へ付いていく**（§9.159）。掴んだ条そのもの
           なら入った位置、別の条なら「1本抜けて1本入った」ぶんだけ番号がずれる。
           選択を黙って外すと、押して確かめた直後に印だけ消えて壊れて見える。 */
        const from=dragBlock.start;
        const insertAt=moveRange(seq,confirmed,from,dragBlock.end,dropStart);
        if(selectedStrip===from)selectStrip(insertAt);
        else if(selectedStrip>=0){
          let s=selectedStrip>from?selectedStrip-1:selectedStrip;
          if(s>=insertAt)s+=1;
          selectStrip(s);
        }
        renderSplit();
        if(typeof markDirty==='function')markDirty();
        /* 離した時点で当てる（§9.149）。移動の途中では当てない——1条動かす
           たびに測定表を作り直すと、掴んでいる手の下で表が跳ねる。 */
        applySplitLive();
      }
      dragging=false;dragBlock=null;
    }
    strip.addEventListener('pointerdown',e=>{
      const idx=indexAtClientX(e.clientX);if(idx<0)return;
      /* 分割の無いロットの図は**選ぶだけ**（§9.209 ②）。同じロットの条しか
         無いので、並べ替えても意味が変わらない——掴めるのに何も起きない
         ものを残さない（§4）。屑幅のつまみは器の側なので効いたまま。 */
      if(strip.classList.contains('split-visual-self')){
        selectStrip(idx);
        strip.querySelectorAll('.split-visual-block').forEach((el,i)=>
          el.classList.toggle('is-selected',i===idx));
        updateDetailFor(idx);
        return;
      }
      const{seq,sources}=context();
      if(seq[idx]==null)return;
      e.preventDefault();
      const colorMap=splitLotColorMap(sources);
      dragBlock={start:idx,end:idx,grabOffset:0,lot:seq[idx],color:colorMap[seq[idx]],dropTarget:idx};
      downX=e.clientX;downY=e.clientY;dragging=false;
      updateDetailFor(idx);
      document.addEventListener('pointermove',handleMove);
      document.addEventListener('pointerup',handleUp);
      document.addEventListener('pointercancel',handleUp);
    });
    /* 異常の印はダブルクリックで判定の窓へ（§9.226 ②、利用者の指示）。
       **単クリックは今までどおり条を選ぶ**——印を押した拍子に選択が
       変わらないよう、ダブルクリックだけを別の意味にする。 */
    strip.addEventListener('dblclick',e=>{
      if(!e.target.closest('[data-defect-flag]'))return;
      e.preventDefault();e.stopPropagation();
      if(window.WL&&WL.defect&&WL.defect.open)WL.defect.open();
    });
  }

  /* 帯のチップとON/OFF（§9.226 ②）。**器は作り直されないので1度だけ配線する**。 */
  let defectChipWired=false;
  function ensureDefectChipWiring(){
    if(defectChipWired)return;
    const chip=$('#splitDefectChip'),tg=$('#splitDefectToggle');
    if(!chip&&!tg)return;
    defectChipWired=true;
    if(chip)chip.onclick=()=>{if(window.WL&&WL.defect&&WL.defect.open)WL.defect.open()};
    if(tg)tg.onclick=()=>{setDefectShown(!defectShown());redrawFigure()};
  }
  /* 図を描き直す（§9.226 ②）。**入口は2つ**（分割あり／分割なし）なので、
     どちらかを選ぶ判断はここ1箇所に置く——呼ぶ側に持たせると、片方だけ
     直った状態が作れる。 */
  function redrawFigure(){
    const self=$('#splitVisualStrip')&&$('#splitVisualStrip').classList.contains('split-visual-self');
    try{
      if(self)renderSelfSplitVisual();
      else if(typeof renderSplit==='function')renderSplit();
      else renderDefectChip(null);
    }catch(e){renderDefectChip(null)}
  }

  /* 子ロット候補カード(#splitSources)。凡例として現在の割当条数・幅・
     公差を表示する。クリックすると視覚図内の該当する条を一時的に光らせ、
     40条規模でも該当ロットの位置をすぐ見つけられるようにする(位置特定用、
     値は変更しない)。 */
  function renderSplitCandidates(sources,seq,colorMap){
    const box=$('#splitSources');if(!box)return;
    if(!sources.length){box.innerHTML='<div class="split-candidates-empty">条割の対象となる子ロットがありません。</div>';return}
    box.innerHTML=sources.map(s=>{
      const n=countAssigned(seq,s.lot),active=activeLot===s.lot;
      return `<div class="split-candidate${active?' active':''}" data-lot="${esc(s.lot)}" role="button" tabindex="0">
        <span class="split-candidate-swatch" style="background:${colorMap[s.lot]||LOT_COLOR_NEUTRAL}"></span>
        <span class="split-candidate-body">
          <span class="split-candidate-head"><b>${esc(s.lot)}</b><em>${n}条</em></span>
          <span class="split-candidate-meta">${s.width!==''&&s.width!==undefined?`幅${esc(String(s.width))} ／ `:''}${esc(s.missing?'子ロット情報取得失敗':(s.tol||'—'))}</span>
        </span>
      </div>`;
    }).join('');
    box.querySelectorAll('.split-candidate').forEach(card=>{
      const lot=card.dataset.lot;
      const locate=()=>{activeLot=activeLot===lot?null:lot;renderSplit();if(activeLot)flashLotInVisual(lot)};
      card.addEventListener('click',locate);
      card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();locate()}});
    });
  }

  /* 条割結果プレビュー(#splitResult)。視覚図/候補カードと同じ色を左端に
     アクセントとして付け、色の対応関係が一目でわかるようにする。 */
  function splitGrouped(seq,sources){
    const map=Object.fromEntries(sources.map(x=>[x.lot,x])),groups=[];
    seq.forEach(lot=>{
      if(!lot){groups.push(null);return}
      const last=groups.at(-1);
      if(last&&last.lot===lot)last.count++;
      else groups.push({lot,count:1,width:map[lot]?.width||'',tol:map[lot]?.tol||''});
    });
    return groups.filter(Boolean);
  }
  function renderSplitResult(seq,sources,colorMap){
    const box=$('#splitResult');if(!box)return;
    const groups=splitGrouped(seq,sources);
    if(!groups.length){box.innerHTML='<div class="split-result-empty">視覚図で条を確認・並べ替えると、ここに結果が表示されます。</div>';return}
    box.innerHTML=groups.map((g,gi)=>`<div class="split-result-row" style="border-left-color:${colorMap[g.lot]||LOT_COLOR_NEUTRAL}"><b class="split-result-index">${gi+1}</b><span class="split-result-lot">${esc(g.lot)}</span><span class="split-result-count">${g.count}条</span><span class="split-result-width">${esc(g.width||'—')}</span></div>`).join('');
  }

  /* 条割変更モーダルの描画。母材幅比率の視覚図(上)・子ロット候補(左)・
     条割結果プレビュー(右)を splitSourceRows()/splitSequence/splitConfirmed
     から構成する。初回描画時のみ、候補の並び順で先頭から敷き詰めた状態を
     初期値として自動生成する(seedSplitDefaults)。 */
  function renderSplit(){
    /* 分割ありの図は掴んで並べ替えられる。**印を外す**——分割無しの図
       （§9.209 ②）で付けた「並べ替えできない」の印が残ると、掴めるのに
       掴めない見た目になる。 */
    const strip0=$('#splitVisualStrip');
    if(strip0)strip0.classList.remove('split-visual-self');
    const hint0=$('#splitVisualHint'),dragHint='帯の幅は母材幅の比率。条をつかんで並べ替えられます。両端の OS＝オペレータ側／DS＝駆動側。';
    if(hint0){hint0.textContent=dragHint;hint0.title=dragHint}
    ['#undoSplit','#resetSplit'].forEach(sel=>{const el=$(sel);if(el&&el.hidden!==false)el.hidden=false});
    const sources=splitSourceRows(),total=sources.reduce((a,x)=>a+x.count,0);
    const{seq}=seedSplitDefaults(sources,total);
    const colorMap=splitLotColorMap(sources);
    renderSplitCandidates(sources,seq,colorMap);
    renderSplitVisual(sources,seq,colorMap);
    renderSplitResult(seq,sources,colorMap);
    $('#splitTotal').textContent=total;
    $('#splitLotCount').textContent=new Set(sources.map(x=>x.lot)).size;
    /* 「条割を実行」ボタンは廃止（§9.145／§9.149、リアルタイム反映へ）。 */
    const undoBtn=$('#undoSplit');if(undoBtn)undoBtn.disabled=splitUndoStack.length===0;
    refreshSplitStatusPanel();
  }
  window.renderSplit=renderSplit;

  /* 条の設計は**カードの中に常時ある**（§9.144、利用者の指示）。専用モーダルは
     廃止したので、ここでするのは「子ロット候補を取りに行って描く」だけ。
     開く／閉じるという状態が無くなったぶん、押してから見るまでの間も無い。 */
  async function openSplit(){
    if(!S.measure)return;
    activeLot=null;splitUndoStack=[];
    if(!splitSourcesCache||splitSourcesCacheKey!==currentSplitCacheKey()){
      const box=$('#splitSources');if(box)box.innerHTML='<div class="split-row-loading">子ロット情報を取得しています…</div>';
    }
    await ensureSplitCandidatesLoaded();
    renderSplit();
    /* 開いた時点の既定の並びも**そのまま当てる**（§9.149）。当てないと
       「表は1条なのに図は2条」という食い違いを抱えたまま測ることになる。
       既に確定済みなら同じ内容で当て直すだけなので副作用は無い。 */
    applySplitLive();
  }
  window.openSplit=openSplit;

  /* ---- 条割は「触ったその場で効く」（§9.149、利用者の指示） ----
     「条割を実行」ボタンは廃止した。押す前と後で画面が変わらないので、
     **実行し忘れたまま測り始める**という事故が起きない。
     ただし**当てられないときに黙って諦めない**——理由を状態行に出す。
     以前はalertで止めていたが、**ドラッグのたびにダイアログ**では使えない。 */
  let splitLiveReason='';
  /* 条数を減らすと、その先に入っている測定値が表から見えなくなる（値そのものは
     40条ぶんの配列に残るが、画面から消えるのは同じこと）。**消えるものが
     あるときは当てずに言う。** */
  function measuredBeyond(count){
    const m=S.measure&&S.measure.measurements;if(!m)return false;
    return ['width','lateral','burr','telescope','offset','flatness'].some(k=>
      (m[k]||[]).some(row=>(row||[]).slice(count).some(v=>String(v??'').trim()!=='')));
  }
  /* 当てられない理由。空文字なら当てられる。 */
  function splitLiveBlockReason(){
    const sources=splitSourceRows();
    if(!sources.length)return 'このロットには条割の対象となる子ロットが見つかりません。';
    const total=sources.reduce((a,x)=>a+x.count,0),seq=ensureSequenceLength(total);
    if(!total||seq.some(x=>x==null))return '全条ぶんの並びが決まっていないため、まだ反映していません。';
    const lotCount=new Set(seq.filter(Boolean)).size;
    const maxStrips=maxStripsForEquipment();
    if(total>maxStrips)return `この設備で割れるのは最大${maxStrips}条までです（現在 ${total}条）。設備ごとの上限はマスタ管理 > 設備の「最大条数」で変更できます。`;
    if(lotCount>MAX_CHILD_LOTS)return `1つの親ロットを分ける子ロットは最大${MAX_CHILD_LOTS}ロットまでです（現在 ${lotCount}ロット）。`;
    if(measuredBeyond(total))return `条数を ${total} にすると、その先に入っている測定値が表から見えなくなるため反映していません。先に不要な測定値を消してください。`;
    return '';
  }
  /* 触ったあとの入口。**当てられたらtrue**。
     `applySplit()`は`refreshSplitStatusPanel()`を呼び、そこから`renderSplit()`へ
     戻る経路があるので、**1周に限る旗**を持つ（§9.144の`inSplitRefresh`と同じ罠）。 */
  let inSplitLive=false;
  function applySplitLive(){
    if(inSplitLive)return false;
    inSplitLive=true;
    try{
      const why=splitLiveBlockReason();
      if(why!==splitLiveReason){splitLiveReason=why;refreshSplitStatusPanel()}
      if(why)return false;
      applySplit();
      return true;
    }finally{inSplitLive=false}
  }
  function applySplit(){
    const sources=splitSourceRows();
    if(!sources.length)return;
    const total=sources.reduce((a,x)=>a+x.count,0),seq=ensureSequenceLength(total);
    if(seq.some(x=>x==null))return;
    const map=Object.fromEntries(sources.map(x=>[x.lot,x])),groups=[];
    seq.forEach(lot=>{const last=groups.at(-1);if(last&&last.lot===lot)last.count++;else groups.push({lot,count:1,source:map[lot]})});
    /* 上限は**条数とロット数を別々に**見る。以前は区間(連続したかたまり)の数を
       1つの上限だけで見ており、同じ2つの子ロットを交互に置いた並べ方が
       9区間になっただけで拒否されていた(ロットは2つ・条も9で、どちらの上限にも
       掛かっていない)。 */
    const lotCount=new Set(groups.map(g=>g.lot).filter(Boolean)).size;
    if(total>maxStripsForEquipment()||lotCount>MAX_CHILD_LOTS)return;
    const splitGroups=groups.map(g=>({lot:g.lot,count:g.count,base:g.source?.base||null,tol:g.source?.tolData||null,missing:!!g.source?.missing}));
    const positionGroup=[];splitGroups.forEach((g,gi)=>{for(let k=0;k<g.count;k++)positionGroup.push(gi)});
    /* **同じ内容なら何もしない**（§9.149）。リアルタイム反映は開いた時点でも
       走るので、素通しにすると**測定画面を開いただけで「未保存」になり**、
       状態行にも「条割を変更しました」が出続ける。 */
    const sig=x=>JSON.stringify((x||[]).map(g=>[g.lot,g.count]));
    const changed=sig(S.measure.settings.splitGroups)!==sig(splitGroups)
      ||String($('#horizontalCount').value)!==String(total);
    S.measure.settings.splitGroups=splitGroups;
    S.measure.settings.splitPositionGroup=positionGroup;
    $('#horizontalCount').value=total;
    if(typeof updateCoilOptions==='function')updateCoilOptions(total);
    if(!changed){
      if(typeof WL.measureInput.renderMeasureGrid==='function')WL.measureInput.renderMeasureGrid();
      refreshSplitStatusPanel();
      return;
    }
    if(typeof markDirty==='function')markDirty();
    if(typeof setState==='function')setState('条割を変更しました');
    if(typeof WL.measureInput.renderMeasureGrid==='function')WL.measureInput.renderMeasureGrid();
    if(typeof updateMeasurementHeading==='function')updateMeasurementHeading();
    refreshSplitStatusPanel();
    /* 条割「適用」直後だけの一撃アニメーション。refreshSplitStatusPanel()は
       測定画面を開いた/再開しただけの同期でも呼ばれるため、アニメーション
       クラスはこの関数(実際に適用ボタンが押された瞬間)側で明示的に付与する。
       同じクラス名の連続適用でも確実に再生されるよう、一度剥がしてreflowを
       挟んでから付け直す(CSSアニメーションはクラスの値が変化した時にしか
       再生されないため)。 */
    const badge=$('#splitTabBadge');
    if(badge){badge.classList.remove('split-tab-badge-pop');void badge.offsetWidth;badge.classList.add('split-tab-badge-pop')}
    const statusEl=document.querySelector('.split-panel-status-applied');
    if(statusEl){statusEl.classList.remove('just-applied');void statusEl.offsetWidth;statusEl.classList.add('just-applied')}
  }
  window.applySplit=applySplit;
  /* 新しい公開は名前空間へ（素の`window.*`は増やさない。`test_globallint`）。 */
  window.WL.split=Object.assign(window.WL.split||{},{applyLive:applySplitLive,
    /* 異常位置判定を保存・取り消したら図の印を描き直す（§9.226 ②）。
       **描き直しの入口はこの1本**——判定の側から`renderSplit()`を直接
       呼ぶと、分割なしのロットで別の組み立てを呼ぶことになる。 */
    redrawFigure});
  /* 条の設計カードのボタン結線(このファイルがカードの所有者。§9.144)。
     **並びを変える操作はすべて`applySplitLive()`で締める**——1つでも
     漏らすと、その操作だけ「効いていない」ように見える。 */
  const undoBtn=$('#undoSplit');if(undoBtn)undoBtn.onclick=()=>{
    const snap=splitUndoStack.pop();if(!snap)return;
    S.measure.settings.splitSequence=snap.seq;
    S.measure.settings.splitConfirmed=snap.confirmed;
    renderSplit();
    applySplitLive();
  };
  const resetBtn=$('#resetSplit');if(resetBtn)resetBtn.onclick=()=>{
    const sources=splitSourceRows(),total=sources.reduce((a,x)=>a+x.count,0);
    pushUndoSnapshot(ensureSequenceLength(total),ensureConfirmedLength(total));
    S.measure.settings.splitSequence=defaultFillSequence(sources,total);
    S.measure.settings.splitConfirmed=Array(total).fill(false);
    activeLot=null;
    renderSplit();
    applySplitLive();
  };

  /* 元幅（実績、BOX実績_板幅）から条幅合計を差し引くと、スリット時に両耳から
     削り取られる屑幅の合計(片耳ごとの内訳ではなく両耳分を合算した値)が求まる。
     条幅合計は次の優先順で決める:
     1. 条割変更で確定済み(splitGroups)なら、各子ロット自身の製造板幅×条数の合計。
     2. 未確定でも分割データを検出し子ロット候補(splitSourcesCache)を取得済みなら、
        その子ロット自身の製造板幅×条数の合計(#horizontalCountはまだ分割後の
        正しい条数を反映していないことが多く、確定前にこれを使うと横割数不足で
        屑幅が大きくずれるため使わない)。
     3. 分割データが無い場合のみ、現在のロットの製造板幅×横割数とする。
     母材パネルと幅分割情報パネルの両方に同じ計算結果を表示する。 */
  function slitWidthTotal(){
    const groups=S.measure?.settings?.splitGroups;
    if(Array.isArray(groups)&&groups.length){
      let total=0;
      for(const g of groups){
        if(g.missing||!Number.isFinite(g.base?.width))return null;
        total+=g.base.width*g.count;
      }
      return total;
    }
    if(splitSourcesCache&&splitSourcesCacheKey===currentSplitCacheKey()&&splitSourcesCache.length){
      let total=0;
      for(const s of splitSourcesCache){
        if(s.missing||!Number.isFinite(s.base?.width))return null;
        total+=s.base.width*s.count;
      }
      return total;
    }
    const rawWidth=S.measure?.basic?.mfgWidth;
    if(rawWidth===undefined||rawWidth===null||String(rawWidth).trim()==='')return null;
    const width=Number(rawWidth);
    const count=Math.max(1,+($('#horizontalCount')?.value)||+S.measure?.settings?.horizontalCount||1);
    return Number.isFinite(width)?width*count:null;
  }
  /* 屑幅を片側へ寄せた設定(§9.160、利用者の指示「通常は均等だが片寄せする
     形で修正入力できるように」)。持つのは**OS側の屑幅(mm)そのもの**で、
     空欄なら均等。差分ではなく実寸で持つのは、画面に出る帯の数字と保存値が
     同じものになるため(差分だと「10と入れたのに帯は25」になる)。
     条割を変えると両耳合計が動くので、読むたびに0〜合計へ丸める。 */
  const SCRAP_EVEN_EPS=0.05;   // これ未満の差は「均等」と読む(丸めの往復で片寄せ扱いにしない)
  function scrapOsSetting(){
    const raw=S.measure?.settings?.scrapOsWidth;
    if(raw===undefined||raw===null||String(raw).trim()==='')return NaN;
    const n=Number(raw);
    return Number.isFinite(n)?n:NaN;
  }
  function scrapWidthInfo(){
    // Number('')は0になってしまう(JSの仕様)ため、元幅（実績）が未取得/空欄の
    // 場合を「0扱い」にせず、計算不可として扱う(架空の巨大な屑幅を出さない)。
    const rawOriginal=S.measure?.basic?.originalWidth;
    if(rawOriginal===undefined||rawOriginal===null||String(rawOriginal).trim()==='')return null;
    const original=Number(rawOriginal);
    const slit=slitWidthTotal();
    if(!Number.isFinite(original)||!Number.isFinite(slit))return null;
    const scrap=original-slit,even=scrap/2,set=scrapOsSetting();
    const manual=Number.isFinite(set)&&scrap>0;
    const os=manual?Math.min(Math.max(set,0),scrap):even;
    return{original,slit,scrap,even,os,ds:scrap-os,manual,
           clamped:manual&&Math.abs(os-set)>0.0001,
           biased:manual&&Math.abs(os-even)>=SCRAP_EVEN_EPS};
  }
  /* ---------- 屑幅がマイナスになる条数は受け付けない（§9.210 ⑤、利用者の指示） --
     「横割り数を変更して条数を増やしていくことができますが、屑幅マイナスに
     なる場合、物理的に不可能なので、母材幅が修正されない限り条数変更を
     それ以上受け付けないようにしてください」。
     答えるのは**1箇所**。返すのは`{original,width,max}`で、
     **判断できないときは`null`**——元幅（実績）が取れない端末・ロットで
     操作ごと塞ぐと、直す手立ても無いまま条数を触れなくなる（§CLAUDE
     「読めなければ黙って判定をやめる」）。
     子ロットで条幅が決まっているロットは**対象外**（条数を変えても条幅
     合計が動かないので、止める理由が無い）。 */
  const STRIP_LIMIT_EPS=0.0001;
  function stripCountLimit(){
    const rawOriginal=S.measure?.basic?.originalWidth;
    if(rawOriginal===undefined||rawOriginal===null||String(rawOriginal).trim()==='')return null;
    const original=Number(rawOriginal);
    if(!Number.isFinite(original)||original<=0)return null;
    const groups=S.measure?.settings?.splitGroups;
    if(Array.isArray(groups)&&groups.length)return null;
    if(splitSourcesCache&&splitSourcesCacheKey===currentSplitCacheKey()&&splitSourcesCache.length)return null;
    const rawWidth=S.measure?.basic?.mfgWidth;
    if(rawWidth===undefined||rawWidth===null||String(rawWidth).trim()==='')return null;
    const width=Number(rawWidth);
    if(!Number.isFinite(width)||width<=0)return null;
    return{original,width,max:Math.max(1,Math.floor((original+STRIP_LIMIT_EPS)/width))};
  }
  /* 屑幅の割り付けを知っているのはこのファイルだけ。異常位置判定
     (defect-locator.js)は**同じ答えを使う**——片寄せしているのに
     「屑は左右均等」で計算すると、条の番号が半分ぶんずれる。 */
  window.WL.split=Object.assign(window.WL.split||{},
    {scrapInfo:scrapWidthInfo,stripCountLimit});
  function updateScrapWidthDisplay(){
    renderScrapAllocEditor();
    /* 自動で入る値（§9.234 ②）。条数・製品幅合計を欄として置けるように
       なったので、条の設計が動いたらその場で引き直す——`updateScrapWidth
       Display()`は条数・条幅・片寄せのどれが変わっても通る1本。 */
    if(window.WL&&WL.opData&&WL.opData.paintAuto)WL.opData.paintAuto();
    const el=$('#motherScrapWidth');if(!el)return;
    const info=scrapWidthInfo();
    if(!info){el.textContent='－';el.classList.remove('scrap-width-warn');return}
    el.textContent=fmtDim(info.scrap,1);
    el.title=info&&info.scrap>0
      ? `OS側 ${fmtDim(info.os,1)} ／ DS側 ${fmtDim(info.ds,1)}（図で条の束の縁をドラッグ、または「屑幅の割り付け」で直せます）`
      : '元幅（実績）から条幅合計を差し引いた両耳分の合計です';
    el.classList.toggle('scrap-width-warn',info.scrap<0);
  }

  /* ---- 屑幅の割り付け（§9.160、利用者の指示） -------------------------
     通常は両耳へ均等だが、**片側へ少し寄せることがある**。均等を既定に
     したまま、寄せたぶんを数値で直せるようにする。
     **屑幅が求まらないロットでは行ごと出さない**——押せるのに何も起きない
     欄を残さない（同じ理由で図の屑帯も出ない）。器は`#splitCard .split-visual`
     の中なので、分割の無いロットでは親ごと畳まれる。 */
  function renderScrapAllocEditor(){
    const box=$('#splitScrapAlloc');if(!box)return;
    const info=scrapWidthInfo();
    const show=!!(info&&Number.isFinite(info.scrap)&&info.scrap>0);
    if(box.hidden!==!show)box.hidden=!show;
    if(!show)return;
    const osIn=$('#scrapAllocOs'),ds=$('#scrapAllocDs'),
          state=$('#scrapAllocState'),evenBtn=$('#scrapAllocEven'),note=$('#scrapAllocNote');
    /* 両耳合計は状態帯（`scrapWidthLineHtml`）が出しているのでここには出さない
       （§9.129 同じ数字を2箇所に出さない）。 */
    if(ds)ds.textContent=fmtDim(info.ds,1);
    /* **打っている最中の欄は書き換えない**——1文字入れるたびに値を入れ直すと
       カーソルが末尾へ飛ぶ（§9.117で読み替えルールの入力欄が踏んだ罠）。 */
    if(osIn){
      osIn.max=String(Math.round(info.scrap*10)/10);
      const v=fmtDim(info.os,1);
      if(document.activeElement!==osIn&&osIn.value!==v)osIn.value=v;
    }
    if(state){
      const gap=Math.abs(info.os-info.even);
      /* 主語は**屑**（見出しが「屑幅の割り付け」）。多く残っている側を言う
         ——条の束はその反対側へ寄る。 */
      /* **短く言い、全文は`title`へ**（§9.234 ①）。1行に収めるための短縮で、
         どちらへ何mm寄っているかという情報は落としていない。 */
      state.textContent=info.biased
        ? `片寄せ ${info.os>info.even?'OS':'DS'} +${fmtDim(gap,1)}`
        : '均等';
      state.classList.toggle('is-biased',info.biased);
      state.title=info.biased
        ? `屑を ${info.os>info.even?'OS':'DS'}側へ ${fmtDim(gap,1)}mm 多く寄せています（均等なら両側 ${fmtDim(info.even,1)}mm ずつ）`
        : '両耳へ同じだけ付きます';
    }
    if(evenBtn)evenBtn.disabled=!info.manual;
    /* **直し方は常に書く**（§9.167）。ドラッグできることは図を見ただけでは
       分からないので、数値欄の隣で1度だけ言う。範囲外を丸めたときだけは
       そちらを優先する（そのときは「なぜこの値なのか」の方が先に要る）。 */
    /* **図が無いロットで「図でドラッグ」と書かない**——屑幅の行は分割の
       無いロットでも出るが（§9.160。器は図の外）、条の帯は分割ありの
       ロットでしか組み立てられない。無い物を指す案内は、探させるだけ。 */
    /* **案内は1行に収め、全文は`title`で読ませる**（§9.234 ①）。以前は
       `flex:1 1 100%`で専用の1行を食っており、カードの下端で見切れていた
       （実機で報告）。同じ内容はつまみの`title`にも書いてある。 */
    if(note){
      const clamped=`OS側は0〜${fmtDim(info.scrap,1)}mm（両耳合計）の範囲です。${fmtDim(info.os,1)}mm として扱っています。`;
      const guide='図の縁をドラッグでも直せます（ダブルクリックで均等）';
      if(info.clamped){note.textContent=clamped;note.title=clamped}
      else if(splitVisualLayout){note.textContent=guide;
        note.title='上の図で条の束の縁をドラッグしても屑幅の片寄せを直せます。ダブルクリックで均等へ戻ります'}
      else{note.textContent='';note.removeAttribute('title')}
      /* 警告のときだけ1行を取る（案内は器に入るぶんだけ）。 */
      note.classList.toggle('is-warn',!!info.clamped);
    }
  }
  /* ---- 屑幅の片寄せを図の上で直す（§9.167、利用者の指示「マウス操作で
     直接屑幅を調節して修正することもできるように」） ----------------------
     数値欄（`#scrapAllocOs`）だけだと、**どちらへどれだけ寄るのか**を頭の中で
     図へ翻訳しないと決められない。条束の左右の境目をそのまま掴めるようにする。

     つまみは**作り直さない**——帯の中身は0.1mm動くたびに`innerHTML`ごと
     組み直しているので、つまみをそこへ入れると掴んだ拍子に消える
     （測定の受信欄と同じ罠。§9.122）。器の子として1度だけ置き、位置だけを
     毎回書き換える。位置は**条束の実寸から取る**——屑の帯には`min-width`が
     効いており、mmの比で置くと細い側で境目とずれる。 */
  function placeScrapGrips(info){
    const os=$('#splitScrapGripOs'),ds=$('#splitScrapGripDs'),
          host=$('#splitVisualMeasure'),strip=$('#splitVisualStrip');
    if(!os||!ds||!host||!strip)return;
    const show=!!(info&&info.scrap>0);
    if(os.hidden!==!show)os.hidden=!show;
    if(ds.hidden!==!show)ds.hidden=!show;
    if(!show)return;
    ensureScrapGripWiring();
    const hr=host.getBoundingClientRect(),sr=strip.getBoundingClientRect();
    if(!(hr.width>0))return;                     /* 畳まれている間は測れない */
    os.style.left=(sr.left-hr.left)+'px';
    ds.style.left=(sr.right-hr.left)+'px';
    const tip=info.biased
      ? `いま ${info.os>info.even?'OS':'DS'}側へ +${fmtDim(Math.abs(info.os-info.even),1)}mm 寄せています。`
      : 'いまは両耳へ均等です。';
    const help=`${tip}ドラッグで条の束を左右へ動かせます（ダブルクリックで均等へ戻す）。`;
    os.title=help;ds.title=help;
  }
  /* 1回だけ配線する。**動かしている間の追従は`document`で受ける**——
     0.1mmごとに帯を描き直すので、つまみ自身に載せると要素の作り直しで
     追従が切れる（列幅の取っ手と同じ作り）。 */
  let scrapGripWired=false;
  function ensureScrapGripWiring(){
    if(scrapGripWired)return;
    const host=$('#splitVisualMeasure');if(!host)return;
    scrapGripWired=true;
    host.addEventListener('pointerdown',e=>{
      const grip=e.target.closest?.('[data-scrap-grip]');if(!grip)return;
      const info=scrapWidthInfo();
      if(!S.measure||!info||!(info.scrap>0))return;
      e.preventDefault();e.stopPropagation();     /* 条の並べ替えへ渡さない */
      const strip=$('#splitVisualStrip');
      const sr=strip?strip.getBoundingClientRect():null;
      /* mm/px は**条束の実寸**から取る（掴んでいるのは条束の縁なので、
         指の動きと縁の動きが1対1になる）。条幅合計が0の異常時は諦める。 */
      if(!sr||!(sr.width>0)||!(info.slit>0))return;
      const mmPerPx=info.slit/sr.width,startX=e.clientX,startOs=info.os;
      host.classList.add('is-scrap-dragging');
      const move=ev=>{
        const os=Math.min(Math.max(startOs+(ev.clientX-startX)*mmPerPx,0),info.scrap);
        S.measure.settings.scrapOsWidth=Math.round(os*10)/10;
        repaintScrap();
      };
      const up=()=>{
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        document.removeEventListener('pointercancel',up);
        host.classList.remove('is-scrap-dragging');
        if(typeof markDirty==='function')markDirty();
      };
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',up);
      document.addEventListener('pointercancel',up);
    });
    /* ダブルクリックで均等へ戻す（「均等へ」ボタンと同じ結果を、掴んだ
       場所のまま出せるようにする）。 */
    host.addEventListener('dblclick',e=>{
      if(!e.target.closest?.('[data-scrap-grip]'))return;
      e.preventDefault();e.stopPropagation();
      if(!S.measure)return;
      S.measure.settings.scrapOsWidth='';
      const el=$('#scrapAllocOs');if(el)el.value='';
      if(typeof markDirty==='function')markDirty();
      repaintScrap();
    });
  }
  /* 値を書き換えたら、図・母材パネル・この行を**まとめて描き直す**。
     `renderSplit()`は条の帯ごと組み立て直すので呼ばない（打っている最中に
     帯が作り直されると、掴んでいる条の参照が切れる）。 */
  function repaintScrap(){
    renderScrapAndRuler(splitVisualLayout);
    updateScrapWidthDisplay();
  }
  {
    const osIn=$('#scrapAllocOs'),evenBtn=$('#scrapAllocEven');
    if(osIn)osIn.addEventListener('input',()=>{
      if(!S.measure)return;
      const raw=String(osIn.value||'').trim();
      /* 空欄・数値でない入力は「均等」へ戻す（勝手な数字を作らない）。 */
      S.measure.settings.scrapOsWidth=(raw===''||!Number.isFinite(Number(raw)))?'':Number(raw);
      if(typeof markDirty==='function')markDirty();
      repaintScrap();
    });
    if(evenBtn)evenBtn.addEventListener('click',()=>{
      if(!S.measure)return;
      S.measure.settings.scrapOsWidth='';
      if(typeof markDirty==='function')markDirty();
      const el=$('#scrapAllocOs');if(el)el.value='';
      repaintScrap();
    });
  }
  function scrapWidthLineHtml(){
    const info=scrapWidthInfo();
    if(!info)return '';
    const cls=info.scrap<0?'split-scrap-line split-scrap-warn':'split-scrap-line';
    /* **数値は1つも減らさない。単位語だけを`title`へ回す**（§9.234 ①）。
       「元幅(実績)」「条幅合計」「屑幅(両耳合計)」の3語だけで実測66px使い、
       状態帯が2行になっていた。式の形（a － b ＝ c）が読めれば、どれが
       何かは並びで分かる。 */
    return `<div class="${cls}" title="元幅(実績) ${esc(fmtDim(info.original,1))}mm から 条幅合計 ${esc(fmtDim(info.slit,1))}mm を引いた残りが 屑幅(両耳合計) ${esc(fmtDim(info.scrap,1))}mm です">`
      +`元幅 ${esc(fmtDim(info.original,1))} － 条幅 ${esc(fmtDim(info.slit,1))} ＝ <b>屑 ${esc(fmtDim(info.scrap,1))}</b></div>`;
  }

  /* ======================================================================
     子ロットデータの保存・更新検知・復元（分割あり品の途中再開対応）

     子ロットの基準値・公差は、一度取得したらレコード自身
     (settings.splitSourcesCache)へ保存して途中から再開できるようにしている
     (ensureSplitCandidatesLoaded)。ただし工場側の別システムが仕掛データを
     後から書き換えることがあり、測定途中で保存済みの内容と実データが食い違う
     ことがある。そのため測定画面を開いている間はバックグラウンドで再取得して
     差異を検出し、更新するかどうかをオペレータへ提案する。

     適用・拒否のどちらを選んでも取得したデータは捨てずに残す
     (settings.splitSourcesHistory / splitSourcesRejected)。これにより後から
     元の内容へ戻したり、一度断った更新を改めて適用したりできる。

     【適用・復元を許可する条件】
     差異が出ている項目に対して測定データが1つも入力されていないこと。
     入力済みの測定値はその時点の基準値・公差で判定・表示されているため、
     後から基準値だけ差し替えると判定結果と入力値の整合が取れなくなる。
     条割が未確定(splitGroups未設定)のうちは子ロットデータがまだ判定に
     使われていないため、この制限はかけない。
     ====================================================================== */
  const SPLIT_UPDATE_CHECK_INTERVAL_MS=10*60*1000;  // 常駐の自動確認間隔
  const SPLIT_UPDATE_FRESH_MS=60*1000;              // 取得直後の二重確認を避ける猶予
  const SPLIT_HISTORY_LIMIT=10;
  // 条位置(条index)を持つ測定種。分割の公差は条位置ごとに変わるため、
  // 「その子ロットの条が測定済みか」はこれらを対象に判定する。板厚は条位置では
  // なく3点固定なので別扱い(hasThicknessMeasurement)。
  const POSITIONAL_MEASURE_KINDS=['width','lateral','burr','telescope','offset','flatness'];
  const THICKNESS_DIFF_KEYS=new Set(['thickness','ttolM','ttolO']);
  let visibleRejectedIndex=null;   // 「差異を表示」で展開中の未適用スナップショット
  let splitUpdateChecking=false;

  function nowIso(){return new Date().toISOString()}
  function fmtStamp(iso){
    if(!iso)return '取得時刻不明';
    const d=new Date(iso);
    if(!Number.isFinite(d.getTime()))return '取得時刻不明';
    const p=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function numKey(v){return Number.isFinite(v)?String(Math.round(v*1000)/1000):''}
  function tolOf(s,kind,src){return s?.tolData?.[kind]?.[src]||null}
  function tolKey(t){return t?`${t.plus}|${t.minus}`:''}
  function tolText(t){return t?`+${t.plus}/-${t.minus}`:'—'}

  /* 差異を取る項目。cmpは比較用の正規化値、textは画面表示用の文字列。
     判定に効く値(基準値・公差)と、条割の構成に効く値(条数・取得可否)を含める。 */
  const SPLIT_DIFF_FIELDS=[
    {key:'missing',label:'子ロットの取得',cmp:s=>s.missing?'NG':'OK',text:s=>s.missing?'取得失敗':'取得OK'},
    {key:'count',label:'条数',cmp:s=>String(s.count??''),text:s=>s.count==null?'—':`${s.count}条`},
    {key:'width',label:'製造板幅',cmp:s=>numKey(s.base?.width),text:s=>Number.isFinite(s.base?.width)?fmtDim(s.base.width,1):'—'},
    {key:'thickness',label:'製造板厚',cmp:s=>numKey(s.base?.thickness),text:s=>Number.isFinite(s.base?.thickness)?fmtDim(s.base.thickness,3):'—'},
    {key:'wtolM',label:'板幅公差(製造)',cmp:s=>tolKey(tolOf(s,'width','manufacturing')),text:s=>tolText(tolOf(s,'width','manufacturing'))},
    {key:'wtolO',label:'板幅公差(オーダー)',cmp:s=>tolKey(tolOf(s,'width','order')),text:s=>tolText(tolOf(s,'width','order'))},
    {key:'ttolM',label:'板厚公差(製造)',cmp:s=>tolKey(tolOf(s,'thickness','manufacturing')),text:s=>tolText(tolOf(s,'thickness','manufacturing'))},
    {key:'ttolO',label:'板厚公差(オーダー)',cmp:s=>tolKey(tolOf(s,'thickness','order')),text:s=>tolText(tolOf(s,'thickness','order'))},
  ];
  /* 保存済み(prev)と最新(next)の子ロットデータを突き合わせて差異一覧を返す。
     kindは'changed'(値の変化)/'added'(子ロットが増えた)/'removed'(無くなった)。 */
  function diffSplitSources(prev,next){
    const prevMap=new Map((prev||[]).map(s=>[String(s.lot),s]));
    const nextMap=new Map((next||[]).map(s=>[String(s.lot),s]));
    const lots=[...new Set([...prevMap.keys(),...nextMap.keys()])];
    const out=[];
    for(const lot of lots){
      const a=prevMap.get(lot),b=nextMap.get(lot);
      if(!a){out.push({lot,field:'子ロット',before:'（無し）',after:'追加されています',kind:'added'});continue}
      if(!b){out.push({lot,field:'子ロット',before:'あり',after:'見つかりません',kind:'removed'});continue}
      for(const f of SPLIT_DIFF_FIELDS){
        if(f.cmp(a)!==f.cmp(b))out.push({lot,field:f.label,before:f.text(a),after:f.text(b),kind:'changed',fieldKey:f.key});
      }
    }
    return out;
  }
  window.diffSplitSources=diffSplitSources;

  // 条割確定済みの割当から、指定ロットが占める条index一覧を返す。
  function positionsForLot(lot){
    const groups=S.measure?.settings?.splitGroups,posMap=S.measure?.settings?.splitPositionGroup;
    if(!Array.isArray(groups)||!Array.isArray(posMap))return [];
    const out=[];
    posMap.forEach((gi,idx)=>{if(groups[gi]&&String(groups[gi].lot)===String(lot))out.push(idx)});
    return out;
  }
  function allPositions(){
    const n=Math.max(1,+($('#horizontalCount')?.value)||+S.measure?.settings?.horizontalCount||1);
    return Array.from({length:n},(_,i)=>i);
  }
  function hasPositionalMeasurement(positions){
    const m=S.measure?.measurements;
    if(!m||!positions.length)return false;
    for(const kind of POSITIONAL_MEASURE_KINDS){
      const slots=m[kind];
      if(!Array.isArray(slots))continue;
      for(const row of slots){
        if(!Array.isArray(row))continue;
        for(const i of positions){
          const v=row[i];
          if(v!==undefined&&v!==null&&String(v).trim()!=='')return true;
        }
      }
    }
    return false;
  }
  function hasThicknessMeasurement(){
    const slots=S.measure?.measurements?.thickness;
    if(!Array.isArray(slots))return false;
    return slots.some(row=>Array.isArray(row)&&row.some(v=>v!==undefined&&v!==null&&String(v).trim()!==''));
  }
  /* 差異のある項目に測定データが入力済みで、差し替えを許可できない子ロットを返す。
     条数の変化・子ロットの増減は条割の割当そのものが変わるため、影響範囲を
     その子ロットの条だけに限定できない(全条＋板厚を確認する)。 */
  function splitUpdateBlockers(diffs){
    const groups=S.measure?.settings?.splitGroups;
    if(!Array.isArray(groups)||!groups.length)return [];   // 未確定なら判定に未使用
    const byLot=new Map();
    (diffs||[]).forEach(d=>{const k=String(d.lot);if(!byLot.has(k))byLot.set(k,[]);byLot.get(k).push(d)});
    const out=[];
    for(const [lot,list] of byLot){
      const structural=list.some(d=>d.kind!=='changed'||d.fieldKey==='count');
      const touchesThickness=list.some(d=>THICKNESS_DIFF_KEYS.has(d.fieldKey));
      const scope=structural?allPositions():positionsForLot(lot);
      const reasons=[];
      if(hasPositionalMeasurement(scope))reasons.push('条位置の測定データが入力済み');
      if((structural||touchesThickness)&&hasThicknessMeasurement())reasons.push('板厚の測定データが入力済み');
      if(reasons.length)out.push({lot,reasons});
    }
    return out;
  }
  window.splitUpdateBlockers=splitUpdateBlockers;

  /* 条割確定済み(splitGroups)の各グループは、確定時点の基準値・公差をコピーして
     保持しており判定はそちらを見る。データを差し替えたら、条の割当(count/並び)は
     保ったまま基準値・公差だけを新しい内容へ同期する。条数が変わった/ロットが
     増減した場合は割当自体が成立しないため、再設定が必要な旨を返す。 */
  function syncSplitGroupsFromSources(){
    const st=S.measure?.settings,groups=st?.splitGroups;
    if(!Array.isArray(groups)||!groups.length){if(st)st.splitNeedsReconfigure=false;return ''}
    const map=new Map((st.splitSourcesCache||[]).map(s=>[String(s.lot),s]));
    let needsReconfigure=false;
    groups.forEach(g=>{
      const s=map.get(String(g.lot));
      if(!s){needsReconfigure=true;g.missing=true;return}
      g.base=s.base||null;g.tol=s.tolData||null;g.missing=!!s.missing;
      if(Number(s.count)!==Number(g.count))needsReconfigure=true;
    });
    const total=(st.splitSourcesCache||[]).reduce((a,x)=>a+(Number(x.count)||0),0);
    const assigned=groups.reduce((a,g)=>a+(Number(g.count)||0),0);
    if(total!==assigned)needsReconfigure=true;
    st.splitNeedsReconfigure=needsReconfigure;
    return needsReconfigure?'条数の構成が変わっています。「条割変更」で再設定してください。':'';
  }
  function rerenderAfterSplitDataChange(){
    if(typeof WL.measureInput.renderMeasureGrid==='function')WL.measureInput.renderMeasureGrid();
    if(typeof updateMeasurementHeading==='function')updateMeasurementHeading();
    refreshSplitStatusPanel();
  }
  function blockerMessage(blockers,verb){
    return `次の子ロットは、差異のある項目に測定データが入力済みのため${verb}できません:\n`
      +blockers.map(b=>`・${b.lot}（${b.reasons.join('・')}）`).join('\n')
      +'\n\n該当する測定データを削除してから実行してください。';
  }
  /* 子ロットデータの差し替え本体(更新適用・復元・未適用分の後追い適用で共有)。
     差し替え前の内容は必ず履歴へ積むため、何度でも元へ戻せる。 */
  async function adoptSplitSources(sources,at,{confirmText,successText,verb='適用'}={}){
    const st=S.measure?.settings;
    if(!st||!Array.isArray(sources)||!sources.length)return false;
    const diffs=diffSplitSources(st.splitSourcesCache,sources);
    if(!diffs.length){if(typeof showToast==='function')showToast('現在のデータと同じ内容です','差し替えは行いませんでした');return false}
    const blockers=splitUpdateBlockers(diffs);
    if(blockers.length){await alertModal(blockerMessage(blockers,verb));return false}
    if(confirmText&&!(await confirmModal(confirmText)))return false;
    const history=Array.isArray(st.splitSourcesHistory)?st.splitSourcesHistory:[];
    history.push({at:st.splitSourcesSavedAt||null,sources:st.splitSourcesCache||[],note:'差し替え前'});
    st.splitSourcesHistory=history.slice(-SPLIT_HISTORY_LIMIT);
    st.splitSourcesCache=sources;
    st.splitSourcesSavedAt=at||nowIso();
    splitSourcesCache=sources;splitSourcesCacheKey=currentSplitCacheKey();
    const note=syncSplitGroupsFromSources();
    if(typeof markDirty==='function')markDirty();
    rerenderAfterSplitDataChange();
    if(typeof showToast==='function')showToast(successText||'子ロットデータを差し替えました',note||`差異${diffs.length}件を反映しました`,5200);
    return true;
  }

  /* バックグラウンドでの更新確認。表示は止めず、差異があればpendingとして
     記録してパネルとトーストで知らせる(勝手に差し替えない)。 */
  async function checkSplitSourcesUpdate({manual=false}={}){
    const st=S.measure?.settings;
    if(!st)return null;
    if(!analyzeRowSplit(S.measure?.source).hasSplit)return null;
    const active=st.splitSourcesCache;
    if(!Array.isArray(active)||!active.length)return null;  // 初回取得前は比較対象が無い
    if(splitUpdateChecking||splitSourcesLoading)return null;
    if(!manual&&st.splitSourcesSavedAt){
      const age=Date.now()-new Date(st.splitSourcesSavedAt).getTime();
      if(Number.isFinite(age)&&age<SPLIT_UPDATE_FRESH_MS)return null;  // 取得直後は確認しない
    }
    const keyAtStart=currentSplitCacheKey();
    splitUpdateChecking=true;
    if(manual)refreshSplitStatusPanel();
    try{
      const fresh=await buildSplitSources();
      if(currentSplitCacheKey()!==keyAtStart)return null;  // 待機中にロットが切り替わった
      if(!Array.isArray(fresh)||!fresh.length)return null;
      st.splitSourcesCheckedAt=nowIso();
      const diffs=diffSplitSources(active,fresh);
      if(!diffs.length){
        st.splitSourcesPending=null;
        if(manual&&typeof showToast==='function')showToast('子ロットデータの更新はありません','保存済みの内容と一致しています');
        return{diffs:[]};
      }
      st.splitSourcesPending={at:st.splitSourcesCheckedAt,sources:fresh,diffs};
      if(typeof markDirty==='function')markDirty();
      if(typeof showToast==='function')showToast('子ロットデータに更新があります',`差異${diffs.length}件 — 「幅分割情報」タブで確認してください`,7000);
      return st.splitSourcesPending;
    }catch(e){
      console.warn('子ロットデータの更新確認に失敗しました',e);
      return null;
    }finally{
      splitUpdateChecking=false;
      refreshSplitStatusPanel();
    }
  }
  window.checkSplitSourcesUpdate=checkSplitSourcesUpdate;

  async function applySplitSourcesUpdate(){
    const st=S.measure?.settings,pending=st?.splitSourcesPending;
    if(!pending)return;
    if(await adoptSplitSources(pending.sources,pending.at,{successText:'子ロットデータを更新しました',verb:'適用'})){
      st.splitSourcesPending=null;
      if(typeof setState==='function')setState('子ロットデータを更新しました');
      refreshSplitStatusPanel();
    }
  }
  window.applySplitSourcesUpdate=applySplitSourcesUpdate;

  /* 「今回は適用しない」。取得済みデータは捨てずに未適用として残し、
     後から差異の確認・適用ができるようにする。 */
  function rejectSplitSourcesUpdate(){
    const st=S.measure?.settings,pending=st?.splitSourcesPending;
    if(!pending)return;
    const rejected=Array.isArray(st.splitSourcesRejected)?st.splitSourcesRejected:[];
    rejected.push({at:pending.at,sources:pending.sources,diffs:pending.diffs});
    st.splitSourcesRejected=rejected.slice(-SPLIT_HISTORY_LIMIT);
    st.splitSourcesPending=null;
    if(typeof markDirty==='function')markDirty();
    if(typeof showToast==='function')showToast('今回は更新を適用しませんでした','取得した内容は履歴に残しています（後から適用・比較できます）',5600);
    refreshSplitStatusPanel();
  }
  window.rejectSplitSourcesUpdate=rejectSplitSourcesUpdate;

  // 履歴から元の内容へ戻す。
  async function revertSplitSources(index){
    const st=S.measure?.settings;
    const history=Array.isArray(st?.splitSourcesHistory)?st.splitSourcesHistory:[];
    const target=history[index];
    if(!target||!Array.isArray(target.sources)||!target.sources.length)return;
    // adopt内で現在の内容が履歴へ積まれるため、先に対象を履歴から外す。
    history.splice(index,1);
    const ok=await adoptSplitSources(target.sources,target.at,{
      confirmText:`子ロットデータを ${fmtStamp(target.at)} 時点の内容へ戻します。よろしいですか？`,
      successText:'子ロットデータを元に戻しました',verb:'復元'});
    if(!ok)history.splice(index,0,target);   // 失敗時は履歴を元の並びへ復旧
    else if(typeof setState==='function')setState('子ロットデータを元に戻しました');
    refreshSplitStatusPanel();
  }
  window.revertSplitSources=revertSplitSources;

  // 一度断った更新を後から適用する。
  async function applyRejectedSplitSources(index){
    const st=S.measure?.settings;
    const rejected=Array.isArray(st?.splitSourcesRejected)?st.splitSourcesRejected:[];
    const target=rejected[index];
    if(!target)return;
    if(await adoptSplitSources(target.sources,target.at,{
      confirmText:`${fmtStamp(target.at)} に取得した内容を適用します。よろしいですか？`,
      successText:'子ロットデータを更新しました',verb:'適用'})){
      rejected.splice(index,1);
      visibleRejectedIndex=null;
      refreshSplitStatusPanel();
    }
  }

  // ---- 差異・履歴の表示 ----
  function diffTableHtml(diffs,beforeLabel,afterLabel){
    const rows=(diffs||[]).map(d=>`<tr class="split-diff-${esc(d.kind)}"><td>${esc(d.lot)}</td><td>${esc(d.field)}</td><td>${esc(d.before)}</td><td>${esc(d.after)}</td></tr>`).join('');
    return `<table class="split-diff-table"><thead><tr><th>ロット№</th><th>項目</th><th>${esc(beforeLabel)}</th><th>${esc(afterLabel)}</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  function splitPendingSectionHtml(){
    const pending=S.measure?.settings?.splitSourcesPending;
    if(!pending||!Array.isArray(pending.diffs)||!pending.diffs.length)return '';
    /* **最新データから消えただけのときは差異表を出さない**（§9.155、利用者の
       指示）。元データが無いので**適用しようが無く**、表と「更新を適用」を
       出しても押せる先が無い（§9.129の4番）。伝えるべきは「最新のデータに
       もう無い＝作業済みかもしれない」という1つの事実だけ。
       **消せること**は残す——押しても何も起きない帯が消えずに残るほうが困る。 */
    const gone=pending.diffs.every(d=>d.kind==='removed');
    if(gone){
      const lots=[...new Set(pending.diffs.map(d=>String(d.lot)))].join('・');
      return `<div class="split-update-panel split-update-gone">
        <div class="split-update-head">子ロット ${esc(lots)} が最新の子ロットデータにありません（${esc(fmtStamp(pending.at))} 確認）。作業済みの可能性があります。</div>
        <div class="split-update-actions">
          <button type="button" id="splitUpdateReject" class="split-update-secondary">確認した</button>
        </div></div>`;
    }
    const blockers=splitUpdateBlockers(pending.diffs);
    const blocked=blockers.length>0;
    return `<div class="split-update-panel">
      <div class="split-update-head">⚠ 子ロットデータに更新があります（${esc(fmtStamp(pending.at))} 確認・差異${pending.diffs.length}件）</div>
      <div class="split-diff-scroll">${diffTableHtml(pending.diffs,'保存済み','最新')}</div>
      ${blocked?`<div class="split-update-blocked">差異のある項目に測定データが入力済みのため適用できません：${esc(blockers.map(b=>`${b.lot}（${b.reasons.join('・')}）`).join(' / '))}</div>`:''}
      <div class="split-update-actions">
        <button type="button" id="splitUpdateApply"${blocked?' disabled':''}>更新を適用</button>
        <button type="button" id="splitUpdateReject" class="split-update-secondary">今回は適用しない</button>
      </div></div>`;
  }
  function splitHistorySectionHtml(){
    const st=S.measure?.settings;
    if(!st)return '';
    const history=Array.isArray(st.splitSourcesHistory)?st.splitSourcesHistory:[];
    const rejected=Array.isArray(st.splitSourcesRejected)?st.splitSourcesRejected:[];
    const items=[`<li class="split-history-current"><b>現在使用中</b> — ${esc(fmtStamp(st.splitSourcesSavedAt))} 取得${st.splitSourcesCheckedAt?` ／ 最終確認 ${esc(fmtStamp(st.splitSourcesCheckedAt))}`:''}</li>`];
    history.slice().reverse().forEach((h,i)=>{
      const idx=history.length-1-i;
      items.push(`<li>${esc(fmtStamp(h.at))} 取得 <button type="button" class="split-history-btn" data-revert="${idx}">この内容に戻す</button></li>`);
    });
    rejected.slice().reverse().forEach((r,i)=>{
      const idx=rejected.length-1-i;
      const open=visibleRejectedIndex===idx;
      items.push(`<li class="split-history-rejected">${esc(fmtStamp(r.at))} 未適用（差異${r.diffs?.length||0}件）
        <button type="button" class="split-history-btn" data-showrejected="${idx}">${open?'差異を隠す':'差異を表示'}</button>
        <button type="button" class="split-history-btn" data-applyrejected="${idx}">この内容を適用</button>
        ${open?diffTableHtml(r.diffs,'現在','この時点'):''}</li>`);
    });
    if(items.length===1&&!st.splitSourcesSavedAt)return '';
    /* **既定は畳む**（§9.144）。条の設計カードは編集面が主役で、履歴は
       「更新が来たか」を確かめたいときだけ開くもの。開いたまま置くと
       実測110pxを取り、編集面がカードから溢れる。 */
    return `<div class="disclosure split-history">
      <button type="button" class="disclosure-head"><span class="disclosure-num">履</span><span class="disclosure-title">子ロットデータの履歴</span><span class="disclosure-sum">${items.length}件</span><span class="disclosure-chev"></span></button>
      <div class="disclosure-body">
       <ul>${items.join('')}</ul>
       <button type="button" class="split-recheck-btn" id="splitRecheckBtn"${splitUpdateChecking?' disabled':''}>${splitUpdateChecking?'確認中…':'今すぐ更新を確認'}</button>
      </div></div>`;
  }
  /* 子ロットデータの更新・履歴は**「条の設計 — 子ロットの内訳」カード**に出す
     （§9.153、利用者の指示）。以前は条の設計（幅の割り付け）カードの`#splitGrid`に
     混ぜていたが、あそこは`display:flex;flex-wrap:wrap`の**1行のメタ情報帯**
     （状態・不一致・屑幅を横に並べる場所）で、差異表を持つブロックを入れると
     帯が壊れる。更新されるのは子ロット候補と条割プレビューの**材料そのもの**
     なので、その2列の上に置くのが読み順とも合う。 */
  function refreshSplitDataSections(){
    const el=$('#splitDataSections');if(!el)return;
    const html=splitPendingSectionHtml()+splitHistorySectionHtml();
    if(el.innerHTML!==html)el.innerHTML=html;
    /* **同じ値なら触らない**（§9.131。`hidden`は値が同じでも変更記録が積まれ、
       見張りと合わさると回り続ける）。 */
    const empty=!html;
    if(el.hidden!==empty)el.hidden=empty;
    if(html)wireSplitDataSections(el);
    syncSplitDetailFold();
  }
  function wireSplitDataSections(el){
    el.querySelector('#splitUpdateApply')?.addEventListener('click',()=>applySplitSourcesUpdate());
    el.querySelector('#splitUpdateReject')?.addEventListener('click',()=>rejectSplitSourcesUpdate());
    el.querySelector('#splitRecheckBtn')?.addEventListener('click',()=>checkSplitSourcesUpdate({manual:true}));
    el.querySelectorAll('[data-revert]').forEach(b=>b.addEventListener('click',()=>revertSplitSources(+b.dataset.revert)));
    el.querySelectorAll('[data-applyrejected]').forEach(b=>b.addEventListener('click',()=>applyRejectedSplitSources(+b.dataset.applyrejected)));
    el.querySelectorAll('[data-showrejected]').forEach(b=>b.addEventListener('click',()=>{
      const i=+b.dataset.showrejected;
      visibleRejectedIndex=visibleRejectedIndex===i?null:i;
      refreshSplitStatusPanel();
    }));
  }
  // 測定画面を開いている間、一定間隔でバックグラウンド確認する。
  setInterval(()=>{
    if(!S.measure)return;
    if($('#measureModal')?.hidden!==false)return;
    checkSplitSourcesUpdate();
  },SPLIT_UPDATE_CHECK_INTERVAL_MS);
  // 開いた直後は表示を優先し、少し遅らせて1回目の確認を走らせる。
  function scheduleSplitUpdateCheck(delayMs=8000){
    setTimeout(()=>{
      if(!S.measure)return;
      if($('#measureModal')?.hidden!==false)return;
      checkSplitSourcesUpdate();
    },delayMs);
  }

  /* 「幅分割情報」サブタブ(data-lefttab="split")に、未設定/設定済みが一目で
     わかるバッジを付ける(視覚導線)。 */
  function updateSplitTabBadge(state){
    const badge=$('#splitTabBadge');if(!badge)return;
    if(state==='applied'){badge.hidden=false;badge.textContent='設定済み';badge.className='split-tab-badge split-tab-badge-applied'}
    else if(state==='pending'){badge.hidden=false;badge.textContent='未設定';badge.className='split-tab-badge split-tab-badge-pending'}
    else{badge.hidden=true}
  }
  /* 「条割変更を開く」ボタンは廃止（§9.144。編集面はカードの中に常時ある）、
     子ロットデータの更新・履歴は内訳カードへ移した（§9.153）ので、状態の帯
     （`#splitGrid`）に配線するものはもう無い。**空の`wireSplitPanelButtons()`を
     残さない**——「まだ何か繋がっている」と読ませる。 */
  // 未設定(候補のみ判明している)状態: 条割変更が実際に読み出すのと同じ子ロット
  // 候補データをここでも先読みして表示し、この画面から直接「条割変更」へ
  // 遷移できるボタンを置く(操作導線)。
  /* 条の設計カードは**編集面を常時持つ**（§9.144）ので、この帯は「いまどう
     なっているか」の**1行**だけにする。子ロットの一覧・幅・公差は編集面の
     「子ロット候補」が持っており、同じ表を上にもう1枚置くと**同じ情報が
     2箇所**に出る（§9.129）。開くボタンも要らない（もう開いている）。 */
  function renderPendingCandidatesPanel(el,sources,info){
    if(!sources.length){
      el.innerHTML=`<div class="split-panel-status split-panel-status-pending">⚠ このロットには分割データがあります（推定 ${info.lotCount}ロット / ${info.stripCount}条・${esc(widthPatternLabel(info.widthPattern))}）が、子ロットの詳細を取得できませんでした。</div>`;
      return;
    }
    const totalCount=sources.reduce((a,x)=>a+x.count,0),horiz=Math.max(1,+($('#horizontalCount')?.value)||1);
    const mismatch=totalCount!==horiz;
    el.innerHTML=`
      <div class="split-panel-status split-panel-status-pending" title="子ロットの割り当てはまだ確定していません。下の図で条をつかんで並べ替えると、そのまま測定表に反映されます">未設定 ／ 子ロット ${new Set(sources.map(x=>x.lot)).size}・全 ${totalCount}条</div>
      ${mismatch?`<div class="split-mismatch-badge">子ロット条数合計(${totalCount})が横割数(${horiz})と一致しません。</div>`:''}
      ${scrapWidthLineHtml()}`;
  }
  // 設定済み(applySplit確定済み)状態の表示。
  /* ロット単位の「まとめ帯」(`splitBandHtml`)は**関数ごと廃止**（§9.156、
     利用者の指示「条のまとめ表示は不要なので、図は1つに統合して、
     並べ替えができるものをください」）。掴めない帯と掴める帯
     （`.split-visual-block`）が同じ見た目で2つ並び、**動くほうと動かない
     ほうの区別が付かなかった**。呼び出しだけ外して定義を残すと、次に読む人が
     「まだ使っている」と読むので消す。 */

  function renderAppliedGroupsPanel(el,groups){
    const summary=summarizeAppliedGroups(groups);
    /* ロット№の頭に色の丸を置く。入力欄のバッジ(.strip-lot-badge)・条割の
       視覚図と同じ色なので、表・入力欄・帯グラフが同じ色で結び付く。 */
    const{map:lotColors,lots}=appliedLotColorMap(groups);
    const dot=lot=>lots.length>1&&lotColors[lot]
      ? `<i class="split-lot-dot" style="background-color:${esc(lotColors[lot])}"></i>`:'';
    const needsReconfigure=S.measure?.settings?.splitNeedsReconfigure;
    /* 設定済みの姿は**帯1本と1行**で足りる（§9.144）。ロット№・条数・幅の
       表は編集面の「子ロット候補」「条割プレビュー」が持っている。 */
    /* **まとめ帯（`splitBandHtml`）は廃止**（§9.156、利用者の指示「条のまとめ
       表示は不要、図は1つに統合して並べ替えができるものを」）。ロット単位の
       帯は掴めないので、掴める1条ずつの帯（`.split-visual`）とまったく同じ
       見た目のものが2つ並び、**動くほうと動かないほうの区別が付かなかった**。
       ロット・条数・幅は1条ずつの帯とその`title`が持っている。 */
    el.innerHTML=`
      <div class="split-panel-status split-panel-status-applied">✓ ${esc(summary)}</div>
      ${needsReconfigure?'<div class="split-mismatch-badge">子ロットデータの更新で条数の構成が変わりました。下で並びを決め直してください。</div>':''}
      ${scrapWidthLineHtml()}`;
  }

  /* 左パネル「幅分割情報」タブ(#splitGrid)は、テンプレート上は固定文字列
     「分割無し」のままで、従来は条割変更モーダルを開いて実行するまで
     一切更新されなかった(=分割データがあるロットを開いた直後は、実際は
     分割データを持っているのに「分割無し」と表示され続けていた)。
     測定画面を開いた/再開した時点で、生データ(親子管理_子カード等)から
     分割データの有無を判定し、未設定でも子ロット候補を能動的に取得して
     表示する(条割変更モーダルを手動で開くまで待たない)。applySplit実行後
     もここで最新の設定内容へ更新する。 */
  /* 骨子（§9.137）の①基本情報は「分割ロット」を持つ。子ロットは非同期で
     取りに行くので、`measure-view.js`は器だけ置き、埋めるのはここ
     （分割の状態を知っているのはこのファイルだけ）。**分割が無いときは
     行ごと出さない**——「分割無し」は条の設計カードが言っており、同じ
     ことを2箇所に書かない（§9.129）。 */
  function refreshBasicSplitRow(){
    const el=$('#basicSplit');if(!el)return;
    const groups=S.measure?.settings?.splitGroups;
    let lots=[],strips=0;
    if(Array.isArray(groups)&&groups.length){
      lots=groups.map(g=>String(g.lot||'')).filter(Boolean);
      strips=groups.reduce((a,g)=>a+(Number(g.count)||0),0);
    }else{
      const rows=splitSourceRows();
      lots=rows.map(s=>String(s.lot||'')).filter(Boolean);
      strips=rows.reduce((a,s)=>a+(Number(s.count)||0),0);
    }
    /* **重複を落とし、ロット番号の順に並べる**（§9.159、利用者の指摘）。
       材料の`splitGroups`は「連続した区間」なので、条を並べ替えて同じロットが
       離れて置かれると`A・B・A`のように**同じ番号が2度出ていた**
       （実機で「N526C52・N526C53・N526C51・N526C53」）。ここが答えるのは
       「このロットは何と何に分かれるか」であって並び順ではない——並び順は
       条の設計の図が持つ。子ロットの色も同じ順で配る（`lotColorMap`）ので、
       色の並びと文字の並びが一致する。 */
    lots=[...new Set(lots)].sort();
    if(lots.length<2){el.hidden=true;el.innerHTML='';return;}
    const list=lots.join('・');
    el.innerHTML=`<span class="ii"><label>分割ロット</label>`
      +`<output title="${esc(list)}">${esc(list)}</output></span>`
      +`<span class="ii"><label>子ロット数</label><output>${lots.length}</output></span>`
      +(strips?`<span class="ii"><label>条数</label><output>${strips}</output></span>`:'');
    el.hidden=false;
  }

  /* 条の設計カードの中の編集面（§9.144）。**分割の材料が無いロットでは
     出さない**——並べ替える条が無いのに図と空の一覧を置くと、その器ぶん
     「まだ何かある」と読ませてしまう。
     **器は`#splitCard`の中の折りたたみ**（§9.215で移設。元は§9.154の`#splitDetailCard`）。§9.145で条の設計を2枚へ割ったとき
     `.split-layout`は内訳カードへ移ったが、ここは`#splitCard .split-layout`を
     探したままだった。**常にnullなので、この関数は一度も効いていない**
     （例外も出ないので、分割無しのロットで空の一覧が出続けることに誰も
     気づけない）。あわせて**条の並びの図と操作**も同じ条件で畳む
     ——並べ替える条が無いのに掴める帯を出しても何も起きない。 */
  function showSplitEditor(on){
    ['#splitCard .split-layout','#splitCard .split-visual'].forEach(sel=>{
      const el=document.querySelector(sel);
      if(el&&el.hidden!==!on)el.hidden=!on;
    });
    syncSplitDetailFold();
  }
  /* ---------- 「子ロットの内訳」は中身があるときだけ(§9.221 ⑥①) ----------
     利用者の指示「子ロットデータがない時に『子ロットの内訳』の文字列の表示は
     不要」。分割の無いロットでは畳んだ見出しだけが残り、開いても中は空だった
     ——**開いても何も無い折りたたみは、探させるだけで何も答えない**。
     出すかどうかは「編集面が出ているか」「更新・履歴があるか」の和で、
     **判定は1箇所**（showSplitEditor・refreshSplitDataSectionsの両方から来る）。 */
  function syncSplitDetailFold(){
    const fold=$('#splitDetailFold');if(!fold)return;
    const layout=document.querySelector('#splitCard .split-layout');
    const data=$('#splitDataSections');
    const has=!!((layout&&layout.hidden!==true)||(data&&data.hidden!==true&&data.innerHTML.trim()!==''));
    if(fold.hidden!==!has)fold.hidden=!has;
    if(!has){if(fold.open){fold.open=false;placeSplitDetailBody()}return}
    /* **畳んだままでも中身の量は読める**（§9.125と同じ約束）。開かないと
       何件あるのか分からない見出しは、開かせるためだけの一手になる。 */
    const sum=$('#splitDetailSummary');
    if(sum){
      const rows=splitSourceRows();
      const lots=new Set(rows.map(x=>x.lot)).size;
      const strips=rows.reduce((a,x)=>a+x.count,0);
      const text=rows.length?`${lots}ロット ／ ${strips}条`:'';
      if(sum.textContent!==text)sum.textContent=text;
    }
  }
  /* ---------- 開いた内訳はカードの外へ出す(§9.221 ⑥②) ----------
     利用者の指摘「子ロットデータがあるとき、展開してもカード内の描画となり
     レイヤーが下に隠れる」。カードは`overflow:auto`・本文グリッドは
     `overflow:hidden`なので、**カードの中で開くかぎり必ず切り落とされる**
     （カードの高さはマスで決まっている・§9.148）。器の外へ`position:fixed`で
     出す——`--z-popover`なので隣のカードの下にも回らない。
     **`.measure-body`の先祖にtransformが無い**ことが前提（あると`fixed`の
     基準がその要素になり、また切られる）。 */
  function placeSplitDetailBody(){
    const fold=$('#splitDetailFold');if(!fold)return;
    const body=fold.querySelector('.split-detail-body');if(!body)return;
    if(!fold.open||fold.hidden){body.removeAttribute('style');return}
    const card=$('#splitCard');const sum=fold.querySelector('.split-detail-summary');
    const base=(sum||card||fold).getBoundingClientRect();
    const cardBox=(card||fold).getBoundingClientRect();
    const gap=6;
    const left=Math.round(cardBox.left);
    const width=Math.round(cardBox.width);
    /* 下に入らなければ上へ出す。**画面の外へは出さない**。 */
    const below=window.innerHeight-base.bottom-gap*2;
    const above=base.top-gap*2;
    const useAbove=below<220&&above>below;
    const max=Math.max(160,Math.round((useAbove?above:below)));
    body.style.left=left+'px';
    body.style.width=width+'px';
    body.style.maxHeight=max+'px';
    if(useAbove){body.style.top='auto';body.style.bottom=Math.round(window.innerHeight-base.top+gap)+'px'}
    else{body.style.bottom='auto';body.style.top=Math.round(base.bottom+gap)+'px'}
  }
  window.addEventListener('resize',()=>placeSplitDetailBody());
  WL.onReady(()=>{
    const fold=$('#splitDetailFold');
    if(fold)fold.addEventListener('toggle',()=>placeSplitDetailBody());
    syncSplitDetailFold();
  });
  /* `renderSplit()`は最後にこの関数を呼ぶので、ここから`renderSplit()`を
     呼ぶと往復する。**旗で1周に限る。** */
  let inSplitRefresh=false;
  /* リアルタイム反映が止まっている理由を、状態行の隣へ**文字で**出す
     （§9.149）。色や無反応で伝えない——「並べ替えても表が変わらない」は
     壊れて見える。 */
  function paintLiveReason(el){
    if(!el||!splitLiveReason)return;
    el.insertAdjacentHTML('beforeend',
      `<div class="split-mismatch-badge split-live-reason">${esc(splitLiveReason)}</div>`);
  }
  function refreshSplitStatusPanel(){
    refreshBasicSplitRow();
    /* 更新・履歴は内訳カード側（§9.153）。**状態の帯より前に置く**——
       `#splitGrid`が無い経路（読み込み中など）でも必ず描き直されるように。 */
    refreshSplitDataSections();
    const el=$('#splitGrid');if(!el)return;
    const rendering=inSplitRefresh;
    inSplitRefresh=true;
    try{
      const groups=S.measure?.settings?.splitGroups;
      if(Array.isArray(groups)&&groups.length){
        renderAppliedGroupsPanel(el,groups);
        paintLiveReason(el);
        updateSplitTabBadge('applied');
        showSplitEditor(true);
        if(!rendering)renderSplit();
        updateScrapWidthDisplay();
        return;
      }
      const info=analyzeRowSplit(S.measure?.source);
      if(!info.hasSplit){
        /* **図は出す**（§9.209 ②）。編集面（子ロット候補・条割プレビュー）は
           並べ替える条が無いので出さない。 */
        const n=Math.max(1,Math.min(40,+($('#horizontalCount')?.value)||1));
        /* **図の使い方はここに書かない**（§9.234 ①）。同じことを
           `#splitVisualHint`（図のすぐ下）が言っており、状態帯がそのぶん
           2行になって、カードが縦に溢れていた（§CLAUDE 8）。ここは
           「いまどういう状態か」だけにして、全文は`title`へ回す。 */
        el.innerHTML='<div class="split-panel-status split-panel-status-none"'
          +` title="このロットには分割データがありません。条は横割数のぶんだけあります（図で番号と屑幅の寄りを確かめられます）">`
          +`分割無し ／ ${n}条（横割数）</div>`
          +scrapWidthLineHtml();
        updateSplitTabBadge('none');
        document.querySelectorAll('#splitCard .split-layout')
          .forEach(x=>{if(x.hidden!==true)x.hidden=true});
        renderSelfSplitVisual();
        syncSplitDetailFold();
        updateScrapWidthDisplay();
        return;
      }
      updateSplitTabBadge('pending');
      const key=currentSplitCacheKey();
      if(splitSourcesCache&&splitSourcesCacheKey===key){
        renderPendingCandidatesPanel(el,splitSourcesCache,info);
        paintLiveReason(el);
        showSplitEditor(true);
        if(!rendering)renderSplit();
      }else{
        el.innerHTML=`<div class="split-panel-status split-panel-status-pending">⚠ このロットには分割データがあります（推定 ${info.lotCount}ロット / ${info.stripCount}条・${esc(widthPatternLabel(info.widthPattern))}）。子ロット情報を取得しています…</div>`;
        showSplitEditor(false);
        ensureSplitCandidatesLoaded();
      }
      updateScrapWidthDisplay();
    }finally{inSplitRefresh=rendering}
  }
  window.refreshSplitStatusPanel=refreshSplitStatusPanel;
  WL.measureHooks.afterRender(()=>refreshSplitStatusPanel());
  $('#horizontalCount')?.addEventListener('change',()=>refreshSplitStatusPanel());

  /* ---- 条の入力欄へロット番号のバッジを付ける ----
     分割ありのロットでは、同じ40行のストリップに複数の子ロットが混ざる。
     どの行がどのロットかは幅分割情報パネルの「1〜2条」のような範囲表記でしか
     分からず、入力しながら目で追うには一度パネルへ視線を移す必要があった。
     入力欄の左端に子ロット番号の下3桁を出し、色は条割の視覚図と同じ配色に
     して、帯グラフと入力欄が同じ色で結び付くようにする。
     **分割ありのときだけ**付ける(単一ロットで全行に同じバッジが並んでも
     情報が増えないため)。 */
  /* 確定済みの条割から「子ロット→色」を作る。groupsは連続した区間の配列なので
     同じロットが複数回現れる(A B A)。**色はロット番号だけで決める**（§9.159）
     ——ここが「groupsに出てくる順」で配っていたため、並べ替えると測定表の
     バッジと幅分割の丸の色が入れ替わっていた。
     幅分割情報パネルの表・入力欄のバッジ・条割の視覚図がすべてこれを使う。 */
  function appliedLotColorMap(groups){
    const lots=[...new Set((groups||[]).map(g=>g.lot).filter(Boolean))];
    return{map:lotColorMap(lots),lots};
  }
  function stripLotBadgeFor(index){
    const st=S.measure?.settings,groups=st?.splitGroups,posMap=st?.splitPositionGroup;
    if(!Array.isArray(groups)||!Array.isArray(posMap))return null;
    const{map,lots}=appliedLotColorMap(groups);
    if(lots.length<2)return null;                       // 分割ありと言えるのは2ロット以上
    const gi=posMap[index];
    if(!Number.isInteger(gi))return null;
    const lot=groups[gi]?.lot;
    if(!lot)return null;
    return{lot,color:map[lot]};
  }
  /* 子ロットの印は**測定表の専用列**が出す（§9.146）。以前は入力欄の中へ
     差し込んでおり、丈位置の数だけ同じバッジが並んで数値の場所を削っていた
     ——**ロット№は条で決まり、丈では変わらない**ので1列で足りる。
     表を組むのは`measureMatrixHtml`（measure-input.js）なので、条→印の
     対応だけをここから渡す。 */
  window.WL.split=Object.assign(window.WL.split||{},{
    lotColumn(count){
      const out=[];
      for(let j=0;j<count;j++){
        const b=stripLotBadgeFor(j);
        out.push(b?{lot:b.lot,color:b.color,suffix:lotSuffix3(b.lot)}:null);
      }
      return out;
    },
  });

  // ---- 判定への配線 ----
  function groupForIndex(index){
    const groups=S.measure?.settings?.splitGroups,posMap=S.measure?.settings?.splitPositionGroup;
    if(!Array.isArray(groups)||groups.length<2||!Array.isArray(posMap))return null;
    const gi=posMap[index];
    return Number.isInteger(gi)?groups[gi]:null;
  }
  function groupRangeFor(kind,index,typeName){
    const type=typeName||$('#measureType')?.value||S.measure?.settings?.measureType||'';
    if(!WL.measureItem.isDimensional(type))return null; // 分割は板厚・板幅の条位置に対してのみ意味を持つ
    const g=groupForIndex(index);
    if(!g||g.missing||!g.base||!g.tol)return null;
    const base=g.base[kind];
    if(!Number.isFinite(base))return null;
    let requested=typeof WL.measureInput.configuredToleranceSource==='function'?WL.measureInput.configuredToleranceSource():'manufacturing',source=requested,fallback=false;
    let data=g.tol[kind]?.[requested];
    if(!data&&requested!=='manufacturing'){source='manufacturing';fallback=true;data=g.tol[kind]?.manufacturing}
    if(!data)return null;
    return{range:[base-data.minus,base+data.plus],source,fallback,plus:data.plus,minus:data.minus,plusKey:data.plusKey,minusKey:data.minusKey,base,splitLot:g.lot};
  }
  /* 提供者として登録する（§9.348）。分割の条に当たらなければ自分の答えでは
     ない（undefined＝次の提供者へ）。以前はここが`WL.measureInput.toleranceDetail`を包み、
     引数を1つ落として「完了前の確認が全項目に今の項目の公差を当てる」事故が
     起きた——登録表では引数を resolve が運ぶので、その形は作れない。 */
  WL.tolerance.register({name:'分割ロット（条ごと）',priority:30,
    detail:(kind,index,typeName)=>groupRangeFor(kind,index,typeName)||undefined});

  // WL.measureInput.compactToleranceData(表示用の公差テキスト生成)は従来 index を常に0扱いで
  // 呼ばれており、条ごとに公差が変わる分割ロットでは「今フォーカスしている
  // 条」ではなく常に1条目の公差を表示してしまっていた。index省略時は現在の
  // 入力位置(wStep/tStep)を既定値として使うようにし、基準値(base)も
  // toleranceDetailが返す値(分割時はその子ロット自身の値)を優先する。
  // index 省略時に今の入力位置を使う・基準値は提供者の値を優先する、は核（measure-input.js の
  // WL.measureInput.compactToleranceData）が持つようになった（§9.352）。ここで差し替えない。

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
  /* 開く前: 子ロットなら親へ読み替え、子ロットが仕掛に無ければ確認して断れる（関門）。
     開いたあと: 分割データの補完と再描画（例外でも走る）。§9.352 */
  WL.measureHooks.gate('openMeasurement',async row=>{
    row=await resolveToParentIfChild(row);
    if(row&&WL.dataSource.isWork(S.db)){
      const missingInfo=await findMissingChildLots(row);
      if(missingInfo&&missingInfo.missing.length){
        const proceed=await confirmModal(`このロットは分割データがありますが、次の子ロットが仕掛データに見つかりません:\n${missingInfo.missing.join('、')}\n\n子ロットが仕掛から外れている場合、既に作業済みである可能性が高く、このまま測定を始めると目標幅・公差の一部が欠けたまま判定されます。\n\nこのまま測定を開始しますか？`);
        if(!proceed)return false;
      }
    }
    return [row];
  },{priority:20});
  WL.measureHooks.on('afterOpenMeasurement',async()=>{
    if(S.measure&&WL.dataSource.isWork(S.db)){
      S.measure.settings=S.measure.settings||{};S.measure.settings.sourceTable=S.table;S.measure.settings.sourceColumns=(S.columns||[]).slice();
      await refreshSelfSourceFull();
      refreshSplitStatusPanel();
      scheduleSplitUpdateCheck();
    }
  });
  // 編集中/完了一覧からの「続きから再開」経路でも、分割関連の完全データを
  // 補ってから幅分割情報を再描画する(現在のS.dbが仕掛一覧とは限らないため
  // ここではS.db判定をしない)。
  WL.measureHooks.on('afterResumeStoredMeasure',async()=>{
    await refreshSelfSourceFull();
    refreshSplitStatusPanel();
    // 途中から再開した場合、保存済みの子ロットデータは取得時点のもの。
    // 実データが更新されていないかバックグラウンドで確認する。
    scheduleSplitUpdateCheck();
  });

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
  /* 条ごとの公差の一覧は**子ロットの内訳の中**（§9.234 ③）。以前は測定の
     見出しの`#toleranceSummary`へ差し込んでいたが、あちらは寸法系のとき
     常に`hidden`だったので**一度も見えていなかった**（差し込む条件も
     寸法系のときだけなので、どの場面でも出ない死んだ処理だった）。
     条に属する情報なので、条の設計カードの内訳が正しい置き場——畳んで
     あるので見出しの1行を1pxも取らない。 */
  WL.measureHooks.afterHeading(()=>{
    const slot=$('#splitTolLegendSlot');if(!slot)return;
    const type=$('#measureType')?.value;
    const html=WL.measureItem.isDimensional(type)?splitLegendHtml():'';
    if(slot.innerHTML!==html)slot.innerHTML=html;
  });

  // ---- 条(条位置)ごとに公差が異なりうるため、フォーカス移動時に
  //      公差表示(数値・図示)を追従させる ----
  // focusCurrent()は入力位置切替の全経路(セルクリック・矢印キー・自動転送後の
  // advanceWidth等)で必ず呼ばれるため、ここに軽量な再描画をフックする。
  // measurementGrid全体の再描画はしない(入力欄のフォーカス/スクロール位置を
  // 保つため、公差表示部分のみDOMを直接更新する)。
  function refreshFocusedToleranceDisplay(){
    const type=$('#measureType')?.value;
    if(!WL.measureItem.isDimensional(type))return;
    if(typeof updateMeasurementHeading==='function')updateMeasurementHeading();
    /* 板厚・板幅を別々の入力内容にしたので、描かれている数直線は
       **いま選んでいる項目のもの1つだけ**（§9.138）。枠の数も項目で
       違うため`slotCount`から取る（板厚は条数ではなく3）。 */
    /* 器は`.matrix-body`（§9.139で1つの表になったときの左側）。以前は
       `.compact-width-body`——**板厚/板幅だけが持っていた2枚組の器**——を
       探しており、§9.138でその器ごと無くなった後は**一度も当たっていな
       かった**（例外も出ないので、条を移っても公差が追従しないことに
       誰も気づけない）。 */
    if(WL.measureTolerance){
      const key=WL.measureItem.kindOf(type);
      const li=typeof lengthIndex==='function'?lengthIndex():0,count=Math.max(1,Math.min(40,+($('#horizontalCount')?.value)||1));
      const values=S.measure?.measurements?.[key]?.[li]||[];
      WL.measureTolerance.repaint(key,values,WL.measureItem.slotCount(key,count));
    }
  }
  WL.measureHooks.on('afterFocus',()=>refreshFocusedToleranceDisplay());
})();
