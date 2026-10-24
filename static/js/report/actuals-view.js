/* actuals-view.js: 実績データリスト（§9.241 ③、利用者の指示）
   ============================================================
   「メインメニューに『実績』のデータをリストとして表示する機能を実装して
    ください。設備単位で切り替えて対象期間のデータを一覧で確認できる機能が
    欲しいです。データ一覧の完了とは別扱いでデータを閲覧するのみで編集は
    しないので、閲覧権限で扱えるものとする。データ一覧の完了の方は、表示
    データ数は少ないが、今回実装したい実績データリストは作業時に記録した
    全データを扱える機能です。ここから、実装済みの帳票や、操業データ表の
    出力も出せるようにしてください。」

   データ一覧（`records-store.js`）との違いを最初に書いておく:
    ・**読む先が違う。** データ一覧は端末内(IndexedDB)＋共有DBの突合で、
      「保存を押していない途中経過」まで出す。実績は**共有された記録だけ**
      （`GET /api/measurement/actuals`）——編集しないので混ぜない。混ぜると
      途中経過が実績として紙に出る。
    ・**編集しない。** 開く・再開する・消すが無いので、**閲覧権限のまま
      使える**（サーバー側もGETだけ）。
    ・**絞り込みが違う。** 状態ではなく**設備＋期間**で絞る。データ一覧の
      「完了」は少数だが、こちらは作業のたびに記録された全部を扱う。

   **現場日と直はサーバーが答える**（§9.163・§9.195）。時刻→直の判定は
   `schedule_calc.resolve_shift_info()` の1箇所しか無いので、画面へ写さない。
   ============================================================ */
(function(){
 'use strict';
 window.WL=window.WL||{};
 const $id=id=>document.getElementById(id);

 /* 期間の既定は「今日を含む7日」。**全期間を既定にしない**——実績は増える
    一方なので、開いた瞬間に何千件も運ぶことになる（狭めるのは利用者の
    操作だが、広げるのは1回押せば済む）。 */
 const AC_DEFAULT_DAYS=7;
 const AC_TARGET='actuals:list';
 /* この端末の覚え（設備・期間の幅・基準）。**読み方の好みなのでPCごと**
    （§9.199の`childBadge`と同じ）。期間の「日付そのもの」は覚えない
    ——次に開いたときには古い日付になっているので、幅だけを覚える。 */
 const AC_PREF_KEY='ActualsViewPrefV1';

 const acState={equipment:'',from:'',to:'',basis:'work',days:AC_DEFAULT_DAYS,
                items:[],total:0,truncated:false,limit:0,loading:false,error:'',showEmpty:false,emptyKeys:[],keys:[],autoW:new Map(),
                lotFields:[],opKeys:[],opDefs:[],equipments:[],selected:new Set(),
                /* 記録した値の候補（§9.288 ⑧）。**サーバーが答える**——
                   帳票の候補と同じ1箇所（`report_block_repo.field_catalog()`）。 */
                fieldCatalog:[],fieldNote:'',
                /* 一覧の見せ方（§9.553）。'line'＝1行（表示列の設定）／'stack'＝2段組（操業データ表と
                   同じ配置の盤）。**読み方の好みなのでPCごと**に覚える。 */
                view:'line',stackFor:'',
                /* 並べ替え（§9.630 ①「作業開始終了を…表示しソートしてリストにする」）。既定は作業開始の古い順（作業した順に読める）。
                   見出しを押すとその列・もう一度で逆。**読み方の好みなのでPCごと**に覚える */
                sort:{k:'作業開始',dir:1},
                query:'',gen:0};

 function loadPref(){
  /* **既定はこの端末の使用設備**（§9.248 ⑥、利用者の指示「実施した設備ごとに
     見せる範囲を変えたい…他の設備の情報が表示されていたら混乱してしまい
     データも混ざってしまう」）。以前の既定は`''`＝すべての設備だったので、
     何も選ばずに開くと**他の設備の実績が混ざって並んでいた**。
     **覚えがあればそちらが勝つ**——「すべての設備」を明示的に選んだ人の
     見え方を勝手に戻さない（§9.132の作法）。使用設備が未登録の端末では
     今までどおりすべてを出す（絞る材料が無い）。 */
  try{
   const eq=(typeof currentConfiguredEquipment==='function')
     ?String(currentConfiguredEquipment()||'').trim():'';
   if(eq)acState.equipment=eq;
   const v=JSON.parse(localStorage.getItem(AC_PREF_KEY)||'{}')||{};
   /* `equipment`は**キーがあれば**そのまま採る（空文字＝「すべての設備」を
      選んだという意思表示なので、真偽値で見ると拾えない）。 */
   if(Object.prototype.hasOwnProperty.call(v,'equipment'))
    acState.equipment=String(v.equipment||'');
   if(v.basis==='cal')acState.basis='cal';
   if(v.view==='stack')acState.view='stack';
   if(v.sort&&typeof v.sort.k==='string'&&v.sort.k)acState.sort={k:v.sort.k,dir:v.sort.dir===-1?-1:1};
   const d=Number(v.days);
   if(Number.isFinite(d)&&d>0&&d<=3660)acState.days=d;
  }catch(e){WL.quiet.note('端末の覚えが読めない（既定で続ける）',e)}
 }
 function savePref(){
  try{localStorage.setItem(AC_PREF_KEY,JSON.stringify(
   {equipment:acState.equipment,basis:acState.basis,days:acState.days,view:acState.view,sort:acState.sort}))}catch(e){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',e)}
 }
 /* **`new Date('2026-08-18')`で組み立てないこと**（§9.195）——UTCの0時として
    読まれ、地方時へ直すと1日ずれる端末がある。地方時の年月日から文字列を作る。 */
 function ymd(d){
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
 }
 function shiftDays(base,n){
  const d=new Date(base.getFullYear(),base.getMonth(),base.getDate()+n);
  return ymd(d);
 }
 function applyDays(days){
  const now=new Date();
  acState.days=days;
  acState.to=ymd(now);
  acState.from=days>=3650?'':shiftDays(now,-(days-1));
 }

 /* ---------- 列 ----------
    **鍵は日本語の項目名**（§9.162）。英字キーにすると計算式が`[lotNo]`に
    なって書いた本人以外に読めない。 */
 const AC_COLUMNS=[
  {k:'#',virtual:true,def:1,track:'56px',cls:'ac-idx'},
  {k:'現場日',def:1,get:x=>x.workDate||'',
   note:'勤務区分マスタの日付補正が効いた日付です（暦とずれることがあります）。'},
  {k:'直',def:1,get:x=>x.shift||''},
  {k:'ロット番号',def:1,get:x=>x.lotNo||'',covers:['basic.lotNo']},
  {k:'検査番号',def:1,get:x=>x.inspectionNo||'',covers:['basic.inspectionNo']},
  {k:'鋳造番号',get:x=>x.castingNo||'',covers:['basic.castingNo']},
  {k:'状態',def:1,get:x=>x.status||'',covers:['calc.status']},
  /* 作業開始・作業終了（§9.630 ①・§9.631 ②）。測定画面で押して記録した時刻、無ければその記録が当たった作業スケジュールの行の実績
     （開始・終了の印・手で入れた時刻・取り込んだ時刻＝ダッシュボードのガントと同じ答え。サーバーが補う）。**値が無い期間でも外さない**
     （`keep`。利用者の指示「測定データの登録がなくても、作業開始時刻と作業終了時刻の欄は列に出せるように」）。
     候補の「作業開始時刻」等は同じ値なので並べない（covers） */
  {k:'作業開始',def:1,keep:1,use:'input',group:'作業の時刻',get:x=>localStamp(x.workStart),covers:['workTime.startAt','calc.workStart'],
   note:'測定画面の「作業開始」で記録した時刻です。無ければ、作業スケジュールの行の実績（開始の印・手で入れた時刻・取り込んだ時刻）で補います（出どころは「時刻の出どころ」）。'},
  {k:'作業終了',def:1,keep:1,use:'input',group:'作業の時刻',get:x=>localStamp(x.workEnd),covers:['workTime.endAt','calc.workEnd'],
   note:'測定画面の「作業終了」で記録した時刻です。無ければ、作業スケジュールの行の実績（終了の印・手で入れた時刻・取り込んだ時刻）で補います。'},
  {k:'実働(分)',def:1,use:'input',group:'作業の時刻',cls:'ac-num',get:x=>(x.durationMin==null?'':x.durationMin),covers:['calc.workDuration']},
  {k:'時刻の出どころ',def:1,use:'input',group:'作業の時刻',get:x=>x.timeFrom||'',
   note:'作業開始・作業終了をどこから取ったかです。「測定画面」＝測定画面で押した時刻。それ以外は作業スケジュールの行の実績（開始判定・手入力・実績データ（取り込み）など）。'},
  {k:'使用設備',get:x=>x.equipment||'',covers:['calc.equipment']},
  {k:'更新者',def:1,get:x=>x.updatedBy||''},
  {k:'更新端末',get:x=>x.updatedPc||''},
  {k:'登録者',get:x=>x.createdBy||''},
  {k:'登録端末',get:x=>x.createdPc||''},
  {k:'更新日時',get:x=>localStamp(x.updatedAt)||x.updatedAtDb||'',covers:['updatedAt','calc.updatedAt']},
  {k:'日付(太陽暦)',get:x=>x.calDate||''},
  {k:'日付の出どころ',get:x=>({start:'作業開始',end:'作業終了',updated:'更新時刻'}[x.workDateFrom]||''),
   note:'現場日をどの時刻から決めたかです。同じ日付でも当たる見込みが違います。'},
  {k:'記録ID',get:x=>x.id||''},
  /* 帳票は行を押して選び、上の「選んだ行の帳票」で刷る・行を2回押すとその1件の帳票（§9.630 の採点: 125px の列に 40px のボタンが
     行の数だけ並び、入力した項目を右へ押した）。列は「表示列」で出せる */
  {k:'操作',virtual:true,track:'var(--w-xs)',cls:'ac-act'},
 ];
 /* 値を持たない列（§9.105。**「出す/出さない」には従う**）。形は
    データ一覧の`RECORD_VIRTUAL`と同じ**辞書**——列の設定パネルが
    `panelSrc.virtual()[k].label` で引く。 */
 const AC_VIRTUAL={
  '#':{label:'#（行番号）',note:'絞り込んだあとの並びで数えた番号と、帳票をまとめて刷るための選択です。'},
  '操作':{label:'操作',note:'この記録の測定帳票を開くボタン。出さなくても、行を2回押すと帳票が開きます（まとめて刷るのは上の「選んだ行の帳票」）。'},
 };
 const AC_VIRTUAL_KEYS=new Set(Object.keys(AC_VIRTUAL));

 /* ISO(UTC)→地方時。**生のまま出さないこと**（§9.162）——保存値は末尾Zなので
    時差のぶんずれる。 */
 function localStamp(iso){
  if(!iso)return '';
  const d=new Date(iso);
  if(Number.isNaN(d.getTime()))return String(iso);
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
 }

 /* ---------- 記録した値ぜんぶを列にする（§9.288 ⑧、利用者の指示） ----------
    「実績データについては、一覧としてのリストは記録したすべてを対象に出力
     可能にしたいです。表示列についても対応できるように、実績として記録した
     すべてを一覧に出せるように、さらに表示列の機能で扱えるようにしてください。」

    以前は**仕掛の23件（`lotFields`）と操業データの項目名**だけだった。
    いまは**帳票と同じ候補**（`report_block_repo.field_catalog()`）をサーバーが
    返し、そこから列を作る——準備で決めた値・母材・揃い・品質等級・品質情報・
    仕掛の生の200列・作業時間・計算した値まで、記録に残っているものは全部
    選べる。**候補の一覧を画面へ写さない**（§9.163。操業データ項目を足せば
    帳票にも一覧にも同時に増える）。

    **値はサーバーが道で引く**（`actuals.field_values()`）——記録の中の置き場
    （母材は`mother.*`、生の列は`source.*`…）を知っているのはあちらだけで、
    ここへ写すと道を1本足したときに2箇所直すことになる（§9.285 ②と同じ）。
    **頼むのはいま出す列の道だけ**（§9.94）——1件で数百項目あるので、
    全部返すと一覧1回で数MBになる。 */
 function catalogColumns(){
  const out=[];
  (acState.fieldCatalog||[]).forEach(g=>{
   (g.items||[]).forEach(it=>{
    const label=String(it.label||'').trim();
    const path=String(it.path||'').trim();
    if(!label||!path)return;
    if(AC_COVERED.has(path))return;      /* 固定の列が同じ値を出している（同じ情報を2か所に出さない） */
    out.push({k:label,path,origin:'rec',group:g.group||'',use:g.use||'joined',
              /* **どの群の項目かを説明に出す**（§6。同じ「板厚」でも
                 準備で決めた値と仕掛の生の列では出どころが違う）。 */
              note:(g.group?g.group+'：':'')+(it.note||g.note||''),
              /* **サーバーが引いた値だけを見る**——道の読み方（`source.`は
                 `.`で割らない等・§9.285 ④）を画面へ写さない。頼んでいない
                 道は`undefined`なので空欄になる。 */
              get:x=>((x&&x.fields)?(x.fields[path]??''):'')});
   });
  });
  /* 記録に値があるのに操業データ項目マスタに無い項目（名前を変えた・消した項目）も入力した項目の列（§9.630 ①「列は入力項目すべて」・
     値が入っている項目は伏せない＝§9.392）。値は抜粋の`opData`にあるので道を頼まない */
  const have=new Set(out.map(c=>c.k)),defs=new Set((acState.opDefs||[]).map(d=>String(d&&d.name||'').trim()));
  [...new Set((acState.items||[]).flatMap(x=>Object.keys(x.opData||{})))].forEach(n=>{
   if(!n||have.has(n)||defs.has(n))return;have.add(n);   /* マスタにある名前は候補が答える（記録に残らない欄はそこで外してある） */
   out.push({k:n,origin:'rec',group:'操業データ（記録にある項目）',use:'input',
             note:'操業データ項目マスタに無い（名前を変えた・消した）項目の、記録に残っている値です。',
             get:x=>((x&&x.opData)?(x.opData[n]??''):'')});
  });
  return out;
 }
 const AC_COVERED=new Set(AC_COLUMNS.flatMap(c=>c.covers||[]));
 /* 列の使い方の順（§9.630 ①、利用者の指示「アプリ側で使用し入力したデータを優先的に表示し、列へ結合して追加しただけで
    直接的に使用されていないデータは列右側へ」）。固定の列・入力した項目（左）→ それから作った値 → 結合で写しただけ（右）。
    群の使い方はサーバーが答える（`actuals.group_use()`の1箇所）。 */
 const USE_RANK={app:0,input:1,calc:2,joined:3};
 /* いま読んだ記録で値のある列（入力した項目の中は値のある列を先に・値の無い列はその後ろ。帯が数で言う）。読み直すたびに1回だけ数える */
 let filledMemo={items:null,set:new Set()};
 function filledKeys(){
  /* 控えは読んだ記録の並びそのもので見る（世代と件数で見ると、値を頼み直した2回目の読み込みで前の空の答えを使った・2回目の採点） */
  if(filledMemo.items===acState.items)return filledMemo.set;
  const set=new Set(),cols=allColumns().filter(c=>!c.virtual);
  acState.items.forEach((x,i)=>{const v=rowView(x,i);cols.forEach(c=>{if(!set.has(c.k)&&v[c.k]!==''&&v[c.k]!=null)set.add(c.k)})});
  filledMemo={items:acState.items,set};
  return set;
 }
 /* 数の列（値のある行が全部数）。右寄せにする（ほかの表と同じ） */
 function numericKeys(){
  if(numMemo.items===acState.items)return numMemo.set;
  const ok=new Map();
  acState.items.forEach((x,i)=>{const v=rowView(x,i);Object.keys(v).forEach(k=>{const t=v[k];if(t===''||t==null||ok.get(k)===false)return;ok.set(k,typeof t==='number'||/^-?[\d,]+(\.\d+)?$/.test(String(t).trim()))})});
  numMemo={items:acState.items,set:new Set([...ok].filter(([,v])=>v).map(([k])=>k))};
  return numMemo.set;
 }
 let numMemo={items:null,set:new Set()};
 /* 列名 → 使い方（1回の描画で1回だけ作る。列ごとに候補を作り直さない） */
 const useMap=()=>new Map(allColumns().map(c=>[c.k,c.use||'app']));
 /* 並べる順: 使い方の順 → 同じ使い方の中は保存した並び（無ければ候補の順）。固定の列の`#`は先頭、`操作`は入力の後ろ */
 function orderKeys(keys){
  const saved=(WL.columnLayout.get(AC_TARGET)||{}).order||[],at=new Map(saved.map((k,i)=>[k,i])),nat=new Map(keys.map((k,i)=>[k,i]));
  const use=useMap(),filled=filledKeys();
  /* 値の無い列（記録の基本・入れた項目）は入れた項目の後ろ（帯が「この期間は値なし」と言う）。作った値・写した値はその右 */
  const rank=k=>{if(k==='#')return -1;if(k==='操作')return -0.5;const u=use.get(k)||'app',r=USE_RANK[u]??0;return (u==='input'||u==='app')&&!filled.has(k)?USE_RANK.input+0.5:r};
  return keys.slice().sort((a,b)=>rank(a)-rank(b)||(at.has(a)&&at.has(b)?at.get(a)-at.get(b):at.has(a)?-1:at.has(b)?1:nat.get(a)-nat.get(b)));
 }
 /* 道 → 列名。**引くのは1箇所**（設定パネルの説明も一覧のセルもここを見る）。 */
 function pathOf(k){const c=columnOf(k);return (c&&c.path)||''}
 /* サーバーへ頼む道。**いま出す列＋保存済みの並びに載っている列**——
    出す列だけだと、1列出すたびに往復が要る（§9.94の「要る列だけ頼む」は
    「次に要る列も含めて1回で」の意味）。**上限はサーバー側が400で切る。** */
 function wantedPaths(){
  const seen=new Set(),out=[];
  const add=k=>{const p=pathOf(k);if(p&&!seen.has(p)){seen.add(p);out.push(p)}};
  try{visibleColumnKeys().forEach(add)}catch(e){WL.quiet.note('出す列を数えられない（残りの道で候補を作る）',e)}
  const layout=WL.columnLayout.get(AC_TARGET)||{};
  (layout.order||[]).forEach(add);
  return out;
 }
 /* **同じ名前を2つ並べない**（§9.113）。**入口で1回だけ落とす**——
    固定の列（ロット番号・検査番号…）と候補の項目（`basic.lotNo`…）は
    同じ呼び名になりうる。落とさないと`rowView()`が**後から来たほうで
    上書き**し、値の入っている列が空になる（実際に踏んだ：一覧の行は
    出ているのにロット番号が空欄）。**最初に出てきた位置を残す。** */
 function allColumns(){
  const seen=new Set(),out=[];
  AC_COLUMNS.concat(catalogColumns()).forEach(c=>{
   if(!c||!c.k||seen.has(c.k))return;seen.add(c.k);out.push(c);
  });
  return out;
 }
 function columnOf(k){return allColumns().find(c=>c.k===k)||null}
 /* **同じ名前を2つ並べない**（§9.113）——仕掛の呼び名と操業データの項目名が
    ぶつかりうるので、入口で1回だけ落とす。最初に出てきた位置を残す。 */
 function allColumnKeys(){
  const seen=new Set(),out=[];
  allColumns().forEach(c=>{if(seen.has(c.k))return;seen.add(c.k);out.push(c.k)});
  const layout=WL.columnLayout.get(AC_TARGET)||{};
  (layout.order||[]).forEach(k=>{if(!seen.has(k)){seen.add(k);out.push(k)}});
  Object.keys(layout.formulas||{}).forEach(k=>{if(!seen.has(k)){seen.add(k);out.push(k)}});
  return out;
 }
 /* **既定で出す列の判定は1箇所**（§9.162／§9.164）。一覧・設定パネル・
    見出しからの初回保存が同じ答えを見る。 */
 function initialHidden(keys,layout){
  const l=layout||WL.columnLayout.get(AC_TARGET)||{};
  if((l.order||[]).length)return null;      /* 一度でも保存していれば保存値が正 */
  /* 既定で出すのは固定の列（def）と、測定画面で入れた項目ぜんぶ（§9.630 ①「列は入力項目すべて」）。
     作った値・結合で写しただけの値は右に並べて、出すかは表示列で選ぶ */
  const def=new Set(AC_COLUMNS.filter(c=>c.def).map(c=>c.k)),use=useMap();
  return (keys||allColumnKeys()).filter(k=>!def.has(k)&&use.get(k)!=='input');
 }
 function visibleColumnKeys(){
  const keys=orderKeys(allColumnKeys()),seed=initialHidden(keys);
  if(seed){const off=new Set(seed);return keys.filter(k=>!off.has(k))}
  return keys.filter(k=>WL.columnLayout.shows(AC_TARGET,k));
 }
 /* 列の幅（§9.631 ①）: 手で決めた幅 → 中身から数えた幅（`autoW`・描くたびに数える）。**どの行も同じ px の並び**にする
    ——前は`minmax(…,1fr)`で、1行ずつの格子が見える幅の中で伸び縮みし、上限（下限の1.6倍）で長い値が「…」で切れていた */
 function trackOf(k){
  const w=WL.columnLayout.width(AC_TARGET,k);
  if(w)return `${w}px`;
  const c=columnOf(k);
  if(k==='#'||k==='操作')return (c&&c.track)||'var(--w-xs)';
  return `${acState.autoW.get(k)||96}px`;
 }
 /* 中身から列の幅を数える（描かずに数える・一覧と同じ道具`WL.list.estimateColumnWidth`の1箇所・§9.94／§9.594）。
    見出しは必ず入る（並べ替えの印 ⇅ の席を足す）・値は上位1割を外した長さ・上限 320px（はみ出す少数は … と title） */
 const SORT_MARK_EM=1.6;
 function measureWidths(list,keys,texts){
  const cs=getComputedStyle(list),fs=parseFloat(cs.fontSize)||14;
  const probe=document.createElement('span');probe.className='ac-cell';probe.style.cssText='position:absolute;visibility:hidden';
  list.appendChild(probe);const padX=parseFloat(getComputedStyle(probe).paddingLeft)||8;probe.remove();
  const est=(WL.list&&WL.list.estimateColumnWidth)||null;
  acState.autoW=new Map(keys.filter(k=>k!=='#'&&k!=='操作').map(k=>[k,est?est(labelOf(k),texts.map(t=>t[k]),fs,padX,SORT_MARK_EM,list):120]));
 }
 function labelOf(k){return WL.columnLayout.label(AC_TARGET,k)||k}

 /* 1行＝{列名:生の値}。計算式が`[ロット番号]`のように**見出しの言葉**で
    書けるのはこの形のため（§9.162）。 */
 function rowView(x,index){
  const row={};
  allColumns().forEach(c=>{
   if(c.k==='#'){row['#']=index+1;return}
   if(c.virtual)return;
   try{row[c.k]=c.get?c.get(x):''}catch(e){row[c.k]=''}
  });
  return row;
 }
 /* 1セル。**戻りは`{text,color}`**（`WL.cellFormat.cell`の契約）——読み替えが
    当たると色が付く。読み替え→書式→生の値の順は`cellFormat`が持つので、
    ここで組み立て直さない。**整形に失敗したら生の値を出す**（空欄にしない）。 */
 function cellText(k,raw,row){
  try{
   /* 表示の値で見る読み替え（§9.474）にも効くよう、列の見え方を渡す（§9.479・`viewOf`の1本）。 */
   const r=WL.cellFormat.cell({raw,format:WL.columnLayout.format(AC_TARGET,k),
     rule:WL.columnLayout.rule(AC_TARGET,k),row,column:k,view:WL.cellFormat.viewOf(AC_TARGET)});
   return {text:(r&&r.text)!=null?String(r.text):(raw==null?'':String(raw)),
           color:(r&&r.color)||''};
  }catch(e){return {text:raw==null?'':String(raw),color:''}}
 }

 /* ---------- 画面 ---------- */
 function exitActualsView(){
  if(!document.body.classList.contains('ac-mode'))return;
  document.body.classList.remove('ac-mode');
  const p=$id('actualsPanel');if(p)p.hidden=true;
 }
 WL.registerView({key:'actuals',bodyClass:'ac-mode',nav:'openActuals',
   toolbar:'#acHead',header:['測定実績','共有された測定記録を設備と期間で読みます（閲覧のみ）'],exit:exitActualsView});

 const RANGE_PRESETS=[{d:1,label:'今日'},{d:7,label:'7日'},{d:31,label:'31日'},
                      {d:92,label:'3か月'},{d:3650,label:'全期間'}];

 function ensurePanel(){
  let panel=$id('actualsPanel');if(panel)return panel;
  panel=document.createElement('section');
  panel.className='ac-panel';panel.id='actualsPanel';panel.hidden=true;
  panel.replaceChildren(WL.template('actuals-panel'));
  const grid=$id('grid');grid?.parentNode?.insertBefore(panel,grid);
  bindHead();
  return panel;
 }

 function bindHead(){
  $id('acEquipment').onchange=e=>{acState.equipment=e.target.value;savePref();load(true)};
  $id('acBasis').onchange=e=>{acState.basis=e.target.value==='cal'?'cal':'work';savePref();load(true)};
  $id('acFrom').onchange=e=>{acState.from=e.target.value;acState.days=0;load(true)};
  $id('acTo').onchange=e=>{acState.to=e.target.value;acState.days=0;load(true)};
  $id('acSearch').oninput=e=>{acState.query=e.target.value;renderList()};
  $id('acReload').onclick=()=>load(true);
  $id('acColumns').onclick=()=>acState.view==='stack'?openStackBoard():openColumnPanel();
  $id('acView').querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{
   acState.view=b.dataset.view==='stack'?'stack':'line';savePref();syncView();renderList();
  });
  syncView();
  $id('acSheet').onclick=openSheet;
  $id('acReport').onclick=printSelectedReports;
  const box=$id('acPresets');
  box.innerHTML=RANGE_PRESETS.map(p=>
   `<button type="button" class="ac-chip" data-days="${p.d}">${esc(p.label)}</button>`).join('');
  box.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>{
   applyDays(Number(b.dataset.days));savePref();syncHead();load(true);
  });
 }
 function syncHead(){
  const eq=$id('acEquipment');
  if(eq){
   const names=acState.equipments.map(x=>x.name);
   /* **候補に無い今の設備を捨てないこと**（§9.204と同じ罠）——実績が
      1件も無い設備を選んでいると、黙って別の設備の実績が出る。 */
   if(acState.equipment&&!names.includes(acState.equipment))names.unshift(acState.equipment);
   eq.innerHTML=`<option value="">すべての設備</option>`
    +names.map(n=>{
      const hit=acState.equipments.find(x=>x.name===n);
      return `<option value="${esc(n)}"${acState.equipment===n?' selected':''}>${esc(n)}${hit?`（${hit.count}件）`:'（実績なし）'}</option>`;
     }).join('');
  }
  const f=$id('acFrom'),t=$id('acTo');
  if(f)f.value=acState.from||'';
  if(t)t.value=acState.to||'';
  const b=$id('acBasis');if(b)b.value=acState.basis;
  document.querySelectorAll('#acPresets [data-days]').forEach(x=>
   x.classList.toggle('is-on',Number(x.dataset.days)===acState.days));
  const btn=$id('acColumns');
  /* **閲覧モードでは列の設定を出さない**（列レイアウトマスタの保存は
     edit/scheduleにしか開いていない・§9.162）。押せるのに保存できない
     ボタンを残さない（§CLAUDE 4）。 */
  if(btn)btn.hidden=!columnsEditable();
 }
 function columnsEditable(){
  const m=(window.accessMode&&window.accessMode.mode)||'edit';
  return m!=='view';
 }

 /* ---------- 読み込み ---------- */
 async function loadEquipments(){
  try{
   const r=await api('/api/measurement/actuals/equipments');
   acState.equipments=(r&&r.items)||[];
  }catch(e){acState.equipments=[]}
 }
 /* この設備の操業データ項目（列の並びと呼び名の出どころ）。
    **失敗しても一覧は出す**——項目マスタが読めないだけで実績が見えなく
    なるのは行き過ぎ（fail-open）。 */
 async function loadOpDefs(){
  acState.opDefs=[];
  try{
   const q=acState.equipment?('?equipment='+encodeURIComponent(acState.equipment)):'';
   const r=await api('/api/operation-form'+q);
   acState.opDefs=(r&&r.items)||[];
  }catch(e){WL.quiet.note('操業データ項目を取れない（項目の呼び名が出ないだけ）',e)}
 }
 function rebuildOpKeys(){
  /* **並びは項目マスタの順**（現場が決めた順）。マスタに無い鍵（項目名を
     変えた後の古い記録）も落とさず後ろへ足す——落とすと記録があるのに
     列に出せない。 */
  const out=[],seen=new Set();
  (acState.opDefs||[]).forEach(d=>{
   const n=String(d&&d.name||'').trim();
   if(!n||seen.has(n))return;seen.add(n);out.push(n);
  });
  (acState.items||[]).forEach(x=>Object.keys(x.opData||{}).forEach(n=>{
   if(!n||seen.has(n))return;seen.add(n);out.push(n);
  }));
  acState.opKeys=out;
 }
 async function load(force){
  const gen=++acState.gen;
  acState.loading=true;acState.error='';
  renderList();
  const q=new URLSearchParams();
  if(acState.equipment)q.set('equipment',acState.equipment);
  if(acState.from)q.set('from',acState.from);
  if(acState.to)q.set('to',acState.to);
  q.set('basis',acState.basis);
  try{
   /* **いま出す列の道だけ頼む**（§9.94／§9.288 ⑧）。**保存済みの並びに
      載っている列も入れる**——次に出す列を先に持っておかないと、列を
      1つ出すたびに往復が要る。候補が未着（初回）のときは何も頼まない。 */
   const want=wantedPaths();
   if(want.length)q.set('fields',JSON.stringify(want));
   const [r]=await Promise.all([api('/api/measurement/actuals?'+q.toString()),
                                force?loadOpDefs():Promise.resolve()]);
   /* **いつの分かで捨てる**（§9.200）——設備を続けて切り替えると、前の
      設備の応答が後から届いて画面に出る。 */
   if(gen!==acState.gen)return;
   acState.items=(r&&r.items)||[];
   acState.stackFor='';
   acState.total=(r&&r.total)||0;
   acState.truncated=!!(r&&r.truncated);
   acState.limit=(r&&r.limit)||0;
   acState.lotFields=(r&&r.lotFields)||[];
   /* 候補（§9.288 ⑧）。**落とした群の理由もそのまま持つ**（§4）。 */
   const cat=(r&&r.fieldCatalog)||[];
   const had=(acState.fieldCatalog||[]).length;
   acState.fieldCatalog=cat;
   acState.fieldNote=(r&&r.fieldNote)||'';
   rebuildOpKeys();
   /* **候補が初めて届いたら、その道ぶんを取り直す**——1回目は「どの列が
      あるか」を知らないので値を頼めない。**列が増えたときだけ**取り直す
      （毎回だと往復が倍になる）。 */
   if(!had&&cat.length&&wantedPaths().length){
    acState.loading=false;
    return load(false);
   }
   /* 消えた行のidを選んだまま持たない（§9.170）。 */
   const live=new Set(acState.items.map(x=>x.id));
   [...acState.selected].forEach(id=>{if(!live.has(id))acState.selected.delete(id)});
  }catch(e){
   if(gen!==acState.gen)return;
   acState.items=[];acState.total=0;acState.error=e&&e.message||String(e);
  }finally{
   if(gen===acState.gen){acState.loading=false;renderList()}
  }
 }

 function filtered(){
  const q=String(acState.query||'').trim().normalize('NFKC').toLowerCase();
  const hit=!q?acState.items:acState.items.filter(x=>[x.lotNo,x.inspectionNo,x.castingNo,x.equipment,x.status]
   .map(v=>String(v||'').normalize('NFKC').toLowerCase()).join(' ').includes(q));
  return sortItems(hit);
 }
 /* 並べ替え（§9.630 ①）。値はセルと同じ（作り方の式を通した生の値・`rawOf`）。空欄はどちらの向きでも最後。
    数どうしは数で、ほかは字で（日時は「YYYY-MM-DD HH:MM」なので字の順＝時刻の順） */
 function sortItems(items){
  const {k,dir}=acState.sort||{};
  if(!k||!columnOf(k)&&!WL.columnLayout.formula(AC_TARGET,k))return items;
  const val=x=>{const v=WL.cellFormat.rawOf(AC_TARGET,rowView(x,0),k);return v==null?'':v};
  const keyed=items.map((x,i)=>({x,i,v:val(x)}));
  const num=v=>(typeof v==='number'?v:(String(v).trim()!==''&&Number.isFinite(+v)?+v:null));
  keyed.sort((a,b)=>{
   const ea=a.v==='',eb=b.v==='';
   if(ea||eb)return ea&&eb?a.i-b.i:ea?1:-1;
   const na=num(a.v),nb=num(b.v);
   const c=na!=null&&nb!=null?na-nb:String(a.v).localeCompare(String(b.v),'ja',{numeric:true});
   return (c||a.i-b.i)*(c?dir:1);
  });
  return keyed.map(o=>o.x);
 }
 function setSort(k){
  if(!k||k==='#'||k==='操作')return;
  acState.sort=acState.sort&&acState.sort.k===k?{k,dir:-acState.sort.dir}:{k,dir:1};
  savePref();renderList();
 }

 /* ---------- 描画 ---------- */
 function noteHtml(){
  const parts=[];
  if(acState.error)parts.push(`<b class="ac-bad">読み込めませんでした</b><span>${esc(acState.error)}</span>`);
  if(acState.truncated)parts.push(`<b class="ac-bad">${acState.total}件のうち${acState.limit}件だけ出しています</b>`
    +`<span>期間を狭めるか、設備を選んでください（黙って切らないためにお知らせしています）。</span>`);
  const unread=acState.items.filter(x=>!x.readable).length;
  if(unread)parts.push(`<b>中身を読めなかった記録 ${unread}件</b>`
    +`<span>ロット番号や状態は出ますが、操業データと作業時間は空欄になります。</span>`);
  if(!parts.length)return '';
  return parts.map(p=>`<span class="ac-note-line">${p}</span>`).join('');
 }
 function renderList(){
  const list=$id('acList');if(!list)return;
  const note=$id('acNote');
  if(note){const h=noteHtml();note.hidden=!h;note.innerHTML=h}
  syncSelectionUi();
  if(acState.loading){list.innerHTML='<div class="ac-empty">読み込んでいます…</div>';return}
  list.classList.toggle('is-stack',acState.view==='stack');
  if(acState.view==='stack'){renderStack(list);return}
  const items=filtered(),so=acState.sort||{},hu=useMap(),hf=filledKeys();
  const keep=new Set(AC_COLUMNS.filter(c=>c.keep).map(c=>c.k));
  const grp=k=>{const u=k==='#'||k==='操作'?'app':(hu.get(k)||'app');return (u==='input'||u==='app')&&k!=='#'&&k!=='操作'&&!keep.has(k)&&!hf.has(k)?'empty':u};
  /* この期間に値の無い列は既定で表から外す（§9.630 の 6 回目の採点）。出す・外すは列の案内の右の1か所（paintGuide）。作業開始・終了は外さない（keep） */
  const all=visibleColumnKeys(),empties=all.filter(k=>grp(k)==='empty');
  const keys=acState.showEmpty?all:all.filter(k=>grp(k)!=='empty');
  acState.emptyKeys=empties;acState.keys=keys;
  /* セルの字を1回だけ作る（幅を数えるのと描くのが同じ字を見る） */
  const nums=numericKeys();
  const cells=items.map((x,i)=>{const view=rowView(x,i),t={},o={};
   keys.forEach(k=>{if(k==='#'||k==='操作')return;const raw=WL.cellFormat.rawOf(AC_TARGET,view,k),out=cellText(k,raw,view);t[k]=out.text;o[k]={raw,out}});
   return {x,i,t,o};});
  measureWidths(list,keys,cells.slice(0,AC_WIDTH_SAMPLE).map(c=>c.t));
  list.style.setProperty('--ac-cols',keys.map(trackOf).join(' '));
  /* 横に送っても留める列は持たない（§9.631 ①、利用者の指示「変に固定せず素直な挙動に」）。行の箱は列の合計の幅（CSS の`width:max-content`）
     なので、送った先でも縞・罫線・選んだ印が途切れない */
  const head=`<div class="ac-row head">`
   +keys.map(k=>{
    const can=k!=='#'&&k!=='操作',on=can&&so.k===k,mark=on?(so.dir===1?'▲ 古い順':'▼ 新しい順'):can?'⇅':'';
    const tip=can?`${labelOf(k)}（押すと${on&&so.dir===1?'新しい順・大きい順':'古い順・小さい順'}に並べます）`:labelOf(k);
    /* 数の列は見出しも右寄せ。印 ⇅ はどの列も名前の右（§9.631 の採点: 数の列だけ左に付けると、隣の列の印に見えた） */
    const num=nums.has(k),mk=mark?`<i class="ac-sortmark${on?'':' is-idle'}" aria-hidden="true">${mark}</i>`:'';
    return `<span data-col="${esc(k)}" class="ac-h-${grp(k)}${on?' is-sorted':''}${num?' ac-h-num':''}${bandEdge(keys,grp,k)}"${can?' data-sort role="button" tabindex="0"':''}${on?` aria-sort="${so.dir===1?'ascending':'descending'}"`:''} title="${esc(tip)}">${esc(labelOf(k))+mk}</span>`;
   }).join('')
   +`</div>`;
  if(!items.length){
   const why=acState.error?'読み込みに失敗しました。上の「再読込」で試せます。'
    :(acState.query?'絞り込み条件に一致する実績がありません。'
      :'この設備・期間には記録された実績がありません。期間を広げるか、設備を「すべての設備」にしてみてください。');
   list.innerHTML=head+`<div class="ac-empty">${esc(why)}</div>`;
   paintGuide(list,keys,grp);
   return;
  }
  const frag=document.createDocumentFragment();
  list.innerHTML=head;
  cells.forEach(({x,i,o})=>{
   const row=document.createElement('div');
   row.className='ac-row'+(acState.selected.has(x.id)?' is-picked':'');
   row.dataset.id=x.id;
   row.innerHTML=keys.map(k=>{
    const c=columnOf(k),edge=bandEdge(keys,grp,k);
    if(k==='#')return `<span class="ac-idx${edge}">${pickHtml(x,i)}</span>`;
    if(k==='操作')return `<span class="ac-act${edge}"><button type="button" class="ac-row-btn" data-report="${esc(x.id)}" title="この記録の測定帳票を開きます">帳票</button></span>`;
    /* 値は作り方の式を通す（§9.489。計算列も元データの列も`rawOf()`の1本）。切れた値には生の値の`title`（§9.94）。
       色は読み替えが指定したときだけ（クラス`cell-<色>`）。揃えは揃えの道具の1箇所（手で決めた揃えが先。数の列は「数」で渡す） */
    const {raw,out}=o[k];
    const cls=['ac-cell',(c&&c.cls)||'',
      (WL.columnAlign&&WL.columnAlign.cellClass)?WL.columnAlign.cellClass(AC_TARGET,k,(WL.columnLayout.format(AC_TARGET,k)||{}).kind||(nums.has(k)?'number':'')):'',
      out.color?'cell-'+out.color:''].filter(Boolean).join(' ');
    /* ロット番号の席に乗せたときだけ「帳票 ↗」（行を2回押す道を形でも見せる・§9.630 の 6 回目の採点） */
    const rep=k==='ロット番号'?`<button type="button" class="ac-rowrep" data-report="${esc(x.id)}" tabindex="-1" title="この記録の測定帳票を開きます">帳票 ↗</button>`:'';
    return `<span class="${esc(cls)}${edge}" data-col="${esc(k)}"`
     +` title="${esc(raw==null?'':String(raw))}">${rep?`<span class="ac-ct">${esc(out.text)}</span>${rep}`:esc(out.text)}</span>`;
   }).join('');
   frag.append(row);
  });
  list.append(frag);
  wireRows(list);
  bindHeadTools(list);
  bindSortHeads(list);
  paintGuide(list,keys,grp);
 }
 /* 幅を数える行の数（先頭から。全件を数えると数千件で描くのが遅くなる・§9.94） */
 const AC_WIDTH_SAMPLE=200;
 /* 列の種類（§9.631 ②、利用者の指示「列の種類ごとわかりやすく表示する方法も検討してください」）。使い方（記録の基本・測定画面で入れた項目・
    作った値・写した値）と、その中の出どころ（作業の時刻・準備で決めた値・操業データ・仕掛（ロットの情報）…）。群の名前は候補の群（サーバーが答える）の1つ */
 const GROUP_WORD={app:'記録の基本',input:'測定画面で入れた項目',empty:'値なし',calc:'記録から作った値',joined:'仕掛から写した値'};
 function groupName(k,w){
  if(w==='app'||w==='empty')return GROUP_WORD[w];
  const g=String((columnOf(k)||{}).group||'').replace(/（.*$/,'');
  return g||GROUP_WORD[w];
 }
 function groupRuns(keys,grp){
  const runs=[];
  keys.forEach((k,i)=>{
   const w=grp(k),name=groupName(k,w),last=runs[runs.length-1];
   if(last&&last.w===w&&last.name===name)last.n++;else runs.push({w,name,n:1,at:i});
  });
  return runs;
 }
 /* 群の切れ目（群の最初の列に左の線）。見出しと値が同じ縦線を持つ */
 function bandEdge(keys,grp,k){
  const i=keys.indexOf(k);if(i<=0)return '';
  const p=keys[i-1];
  return grp(p)!==grp(k)||groupName(p,grp(p))!==groupName(k,grp(k))?' ac-gstart':'';
 }
 /* ---------- 列の案内（§9.631、E の手順の3回目で V11・85点） ----------
    一覧の上の1本の図: 群の区画（名前と列の数・種類の色の上線）と、いま見えている範囲の帯。押す・掴んで動かすと、その位置へ横に送る。
    右に「値なし N列 出す ▸」「伏せている N列 表示列 ▸」。前は帯の名前（群の左端だけ＝送ると消えた）・右上の数の字・「横にあと n列」が別々に言っていた。
    区画の幅＝名前が入る最小の幅＋残りを実際の列の幅に比例（列の数に比例させると範囲の帯が実寸とずれ、実寸に比例させると狭い群の名前が潰れた・2回目の採点） */
 function paintGuide(list,keys,grp){
  let box=$id('acGuide');
  if(!box){
   box=document.createElement('div');box.id='acGuide';box.className='ac-map';
   list.parentNode.insertBefore(box,list);
   list.addEventListener('scroll',()=>markGuide(list),{passive:true});
   /* 器の幅が変わったら区画を配り直す（窓の大きさ・左メニューの開け閉め。`resize`は窓しか見ない） */
   new ResizeObserver(()=>{const t=box.querySelector('.ac-map-track');if(t&&box.isConnected){fitSegs(list,t);markGuide(list)}}).observe(list);
  }
  const ne=(acState.emptyKeys||[]).length,hidden=allColumnKeys().length-visibleColumnKeys().length;
  box.innerHTML=`<span class="ac-map-h">列の案内</span><div class="ac-map-track" title="押す・掴んで動かすと、その位置へ横に送ります">`
   +`<span class="ac-map-row">`+groupRuns(keys,grp).map(r=>`<span class="ac-map-seg is-${r.w}" data-at="${r.at}" data-n="${r.n}" title="${esc(r.name)}　${r.n}列"><b>${esc(r.name)}</b><small>${r.n}列</small></span>`).join('')
   +`</span><span class="ac-map-strip"><i class="ac-map-win" aria-hidden="true"></i></span></div>`
   +(ne?`<button type="button" class="ac-map-x" data-fold aria-pressed="${acState.showEmpty}" title="${esc(acState.emptyKeys.join('・'))}"><b>値なし</b><small>${ne}列</small> ${acState.showEmpty?'外す ◂':'出す ▸'}</button>`:'')
   +(hidden?`<button type="button" class="ac-map-x" data-cols title="伏せている列は「表示列」で出せます"><b>伏せている</b><small>${hidden}列</small> 表示列 ▸</button>`:'');
  const fb=box.querySelector('[data-fold]');if(fb)fb.onclick=()=>{acState.showEmpty=!acState.showEmpty;renderList()};
  const cb=box.querySelector('[data-cols]');
  /* 閲覧モードでは表示列を変えられない（押せるのに何も起きない物を残さない・§CLAUDE 4） */
  if(cb){if(columnsEditable())cb.onclick=()=>openColumnPanel();else{cb.disabled=true;cb.lastChild.textContent=''}}
  const track=box.querySelector('.ac-map-track');
  fitSegs(list,track);
  const go=e=>{const r=track.getBoundingClientRect(),x=guideToPx(list,(e.clientX-r.left)/r.width);list.scrollLeft=Math.max(0,x-list.clientWidth/2)};
  /* 掴んでいるあいだは列の左端で止める送り（scroll-snap）を外す（止まる所へ飛んで指から離れる） */
  track.onpointerdown=e=>{
   e.preventDefault();list.classList.add('is-dragging');go(e);
   const mv=ev=>go(ev),up=()=>{window.removeEventListener('pointermove',mv);window.removeEventListener('pointerup',up);list.classList.remove('is-dragging')};
   window.addEventListener('pointermove',mv);window.addEventListener('pointerup',up);
  };
  markGuide(list);
 }
 /* 群の列の実寸（px）。区画と範囲の帯の両方がここを読む */
 function groupPx(list,sg){
  const hs=list.querySelectorAll('.ac-row.head>span'),at=+sg.dataset.at,n=+sg.dataset.n,h0=hs[at],h1=hs[at+n-1];
  return h0&&h1?{a:h0.offsetLeft,b:h1.offsetLeft+h1.offsetWidth}:{a:0,b:0};
 }
 function fitSegs(list,track){
  const segs=[...track.querySelectorAll('.ac-map-seg')];
  segs.forEach(sg=>{sg.style.flex='0 0 auto'});
  const base=segs.map(sg=>sg.scrollWidth+2),px=segs.map(sg=>{const g=groupPx(list,sg);return g.b-g.a});
  const room=Math.max(0,track.clientWidth-base.reduce((a,b)=>a+b,0)),tot=px.reduce((a,b)=>a+b,0)||1;
  segs.forEach((sg,i)=>{sg.style.flex=`0 0 ${Math.floor(base[i]+room*px[i]/tot)}px`});
 }
 /* 群ごとに 実寸の範囲 [a,b]（px）↔ 図の上の範囲 [A,B]（0〜1）。区画の幅は実寸に比例しないので、群ごとに写す */
 function guideRanges(list){
  const box=$id('acGuide'),tr=box&&box.querySelector('.ac-map-track'),tw=tr?tr.clientWidth||1:1;
  return (box?[...box.querySelectorAll('.ac-map-seg')]:[]).map(sg=>({sg,...groupPx(list,sg),A:sg.offsetLeft/tw,B:(sg.offsetLeft+sg.offsetWidth)/tw}));
 }
 function pxToGuide(R,x){const g=R.find(r=>x<=r.b)||R[R.length-1];if(!g)return 0;const f=g.b>g.a?(x-g.a)/(g.b-g.a):0;return g.A+(g.B-g.A)*Math.max(0,Math.min(1,f))}
 function guideToPx(list,m){const R=guideRanges(list),g=R.find(r=>m<=r.B)||R[R.length-1];if(!g)return 0;const f=g.B>g.A?(m-g.A)/(g.B-g.A):0;return g.a+(g.b-g.a)*Math.max(0,Math.min(1,f))}
 /* いま見えている範囲の帯・範囲に入る群の名前を太字・右に列が続くときは一覧の右端に影（横に送るたびに塗り直す） */
 function markGuide(list){
  const box=$id('acGuide');if(!box)return;
  const x0=list.scrollLeft,x1=x0+list.clientWidth,R=guideRanges(list),win=box.querySelector('.ac-map-win');
  if(win&&R.length){const A=pxToGuide(R,x0),B=pxToGuide(R,Math.min(x1,R[R.length-1].b));win.style.left=`${A*100}%`;win.style.width=`${Math.max(0.02,B-A)*100}%`}
  R.forEach(r=>r.sg.classList.toggle('is-in',r.b>x0+1&&r.a<x1-1));
  let e=$id('acEdge');
  if(!e){e=document.createElement('div');e.id='acEdge';e.className='ac-edge';e.setAttribute('aria-hidden','true');list.parentNode.appendChild(e)}
  const more=list.scrollWidth-x1>1;
  e.hidden=!more;
  if(more){
   /* 影は行のある高さだけ（表の下の空いた所まで伸ばさない・3回目の採点） */
   const last=list.querySelector('.ac-row:last-child'),h=last?Math.min(list.clientHeight,last.getBoundingClientRect().bottom-list.getBoundingClientRect().top-list.clientTop):list.clientHeight;
   e.style.top=`${list.offsetTop+list.clientTop}px`;e.style.height=`${Math.max(0,h)}px`;e.style.left=`${list.offsetLeft+list.clientLeft+list.clientWidth-e.offsetWidth}px`;
  }
 }
 /* 見出しを押して並べ替える（閲覧モードでも。列幅の取っ手を掴んだときは並べ替えない） */
 function bindSortHeads(list){
  list.querySelectorAll('.ac-row.head>span[data-sort]').forEach(cell=>{
   cell.addEventListener('click',e=>{if(e.target.closest('.ac-grip'))return;setSort(cell.dataset.col)});
   cell.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSort(cell.dataset.col)}});
  });
 }
 /* 選ぶ印と帳票のボタン（1行・2段組の両方で同じ配線）。 */
 function wireRows(list){
  /* 行を押すと選ぶ（もう一度で外す）・2回押すとその1件の帳票（§9.630 の採点: 帳票のボタンの列をやめた） */
  list.querySelectorAll('.ac-row[data-id]').forEach(row=>{
   row.addEventListener('click',e=>{
    if(e.target.closest('input,button,a,.ac-grip'))return;
    const cb=row.querySelector('[data-pick]');if(cb)cb.click();     // 印と同じ道（2回押すと選んで外れる＝選びは変わらない）
   });
   row.addEventListener('dblclick',e=>{if(e.target.closest('input,button,a'))return;openReport(row.dataset.id)});
   row.title='押すと選ぶ・2回押すとこの記録の測定帳票を開きます';
  });
  list.querySelectorAll('[data-pick]').forEach(cb=>cb.onclick=e=>{
   e.stopPropagation();
   const id=cb.dataset.pick;
   if(cb.checked)acState.selected.add(id);else acState.selected.delete(id);
   cb.closest('.ac-row,.rcl-rec')?.classList.toggle('is-picked',cb.checked);
   syncSelectionUi();
  });
  list.querySelectorAll('[data-report]').forEach(b=>b.onclick=e=>{
   e.stopPropagation();openReport(b.dataset.report);
  });
 }
 const pickHtml=(x,i)=>`<label class="ac-pick" title="帳票をまとめて刷る行を選びます"><input type="checkbox" data-pick="${esc(x.id)}"${acState.selected.has(x.id)?' checked':''}><b>${i+1}</b></label>`;
 /* ---------- 2段組（§9.553） ----------
    操業データ表の紙と**同じ配置の答え**（`WL.opSheet.listHtml`）を画面に出す。材料（設備・項目）は
    読み込むたびに揃え直す（`prepare`）——前の設備の配置で今の設備の実績を並べない。 */
 function renderStack(list){
  if(!WL.opSheet||typeof WL.opSheet.listHtml!=='function'){
   list.innerHTML='<div class="ac-empty">段組を出せません（操業データ表の画面が読み込まれていません）。「1行」に戻してください。</div>';return;
  }
  const items=filtered();
  if(!items.length){
   list.innerHTML=`<div class="ac-empty">${esc(acState.query?'絞り込み条件に一致する実績がありません。'
     :'この設備・期間には記録された実績がありません。期間を広げるか、設備を「すべての設備」にしてみてください。')}</div>`;
   return;
  }
  const want=acState.equipment+'|'+acState.gen;
  if(acState.stackFor!==want){
   list.innerHTML='<div class="ac-empty">段組の配置を読んでいます…</div>';
   WL.opSheet.prepare({equipment:acState.equipment,items:acState.items,opDefs:acState.opDefs,lotFields:acState.lotFields})
    .then(()=>{acState.stackFor=want;renderList()})
    .catch(e=>{list.innerHTML=`<div class="ac-empty">段組の配置を読めませんでした: ${esc(e&&e.message||String(e))}</div>`});
   return;
  }
  list.innerHTML=WL.opSheet.listHtml({items,
   lead:pickHtml,leadHead:'#',tailHead:'',
   tail:x=>`<button type="button" class="ac-row-btn" data-report="${esc(x.id)}" title="この記録の測定帳票を開きます">帳票</button>`,
   rowCls:x=>acState.selected.has(x.id)?'is-picked':'',
   rowAttrs:x=>` data-id="${esc(x.id)}"`});
  wireRows(list);
 }
 /* 見せ方の札と、表示列のボタンの名前（2段組のときは配置の盤を開く）。 */
 function syncView(){
  document.querySelectorAll('#acView [data-view]').forEach(b=>{
   const on=b.dataset.view===acState.view;b.classList.toggle('is-on',on);b.setAttribute('aria-checked',String(on));
  });
  const w=$id('acColumnsWord');if(w)w.textContent=acState.view==='stack'?'段組の配置':'表示列';
  const btn=$id('acColumns');
  if(btn)btn.title=acState.view==='stack'?'段組で使うデータ・段・位置・幅を盤の上で決めます（操業データ表の紙と同じ配置）'
                                         :'この一覧に出す列・並び・幅・書式を決めます';
 }
 function openStackBoard(){
  if(!WL.opSheet||typeof WL.opSheet.open!=='function'){
   showToast&&showToast('配置の盤を開けません','操業データ表の画面が読み込まれていません。',5000);return;
  }
  WL.opSheet.open({equipment:acState.equipment,items:filtered(),basis:acState.basis,
                   from:acState.from,to:acState.to,opDefs:acState.opDefs,lotFields:acState.lotFields,
                   board:true,onClose:()=>{acState.stackFor='';renderList()}});
 }
 function syncSelectionUi(){
  const n=acState.selected.size;
  const c=$id('acReportCount');if(c)c.textContent=String(n);
  const b=$id('acReport');if(b){b.disabled=!n;b.hidden=!n}
  /* 選ぶまでは入口を短い字と ⓘ で言う（押せないボタンを入口に見せない・2回目の採点。文で書くと帯が3段に折れた・7回目の採点） */
  const bar=$id('acHead');let h=bar&&bar.querySelector('.ac-rephint');
  if(bar&&!h){
   h=document.createElement('span');h.className='ac-rephint';
   h.innerHTML='2回押すと帳票 <button type="button" class="wl-tip-i" data-tip="行を2回押す（または行に乗せて出る「帳票 ↗」）と、その1件の測定帳票を開きます。行を押して選ぶと、選んだ記録をまとめて刷れます。" aria-label="帳票の開き方">i</button>';
   bar.insertBefore(h,b||null);WL.popMenu.tips(h);
  }
  if(h)h.hidden=!!n||acState.view==='stack';
 }
 /* 見出しの取っ手と右クリックは**既存の道具をそのまま呼ぶ**（§9.164。
    書き写すと、直したときに片方だけ直った状態になる）。 */
 function bindHeadTools(list){
  if(!columnsEditable())return;
  const keys=visibleColumnKeys();
  list.querySelectorAll('.ac-row.head>span[data-col]').forEach(cell=>{
   const key=cell.dataset.col;
   if(typeof WL.columnWidthGrip==='function'){
    const grip=document.createElement('i');
    grip.className='ac-grip';cell.appendChild(grip);
    /* **今そこに在る見出しから測る**（§9.211 ①）——一覧は`innerHTML`ごと
       作り直されるので、綴じ込んだ`cell`はすぐ孤児になる。孤児を測ると
       幅0になり、掴んでも動かない。 */
    const liveCell=()=>document.querySelector(
      `#acList .ac-row.head>span[data-col="${CSS.escape(key)}"]`)||cell;
    WL.columnWidthGrip(grip,{
     locked:WL.columnLayout.locked(AC_TARGET,key),
     startWidth:()=>liveCell().getBoundingClientRect().width,
     /* 引いている最中は`hold()`（§9.212 ③。保存済みにも下書きにも触らない）
        で当て、トラックの並びだけ入れ替える。 */
     preview:w=>{
      const cur=WL.columnLayout.get(AC_TARGET);
      WL.columnLayout.hold(AC_TARGET,{widths:{...(cur.widths||{}),[key]:w}});
      const l=$id('acList');
      if(l)l.style.setProperty('--ac-cols',acState.keys.map(trackOf).join(' '));   // いま描いている列の並び（値の無い列を外した後）
     },
     commit:w=>{
      const widths={...(WL.columnLayout.get(AC_TARGET).widths||{}),[key]:w};
      saveColumns({widths}).catch(WL.quiet('列幅を保存できない（画面の幅はそのまま）')).finally(()=>WL.columnLayout.release(AC_TARGET));
     },
     reset:()=>{
      const widths={...(WL.columnLayout.get(AC_TARGET).widths||{})};delete widths[key];
      WL.columnLayout.hold(AC_TARGET,{widths});
      saveColumns({widths}).catch(WL.quiet('列幅を保存できない（画面の幅はそのまま）')).finally(()=>{WL.columnLayout.release(AC_TARGET);renderList()});
     },
    });
   }
   cell.oncontextmenu=ev=>{
    if(typeof WL.openColumnHeaderMenu!=='function')return;
    ev.preventDefault();
    WL.openColumnHeaderMenu(ev,key,AC_TARGET,keys,columnMenuSource());
   };
  });
 }
 function headCellWidth(k){
  const cell=document.querySelector(`#acList .ac-row.head>span[data-col="${CSS.escape(k)}"]`);
  return cell?Math.round(cell.getBoundingClientRect().width):120;
 }
 function columnMenuSource(){
  return {
   keys:()=>allColumnKeys(),
   label:k=>labelOf(k),
   currentWidthOf:headCellWidth,
   hiddenOf:()=>{
    const keys=allColumnKeys(),seed=initialHidden(keys);
    return seed||keys.filter(k=>!WL.columnLayout.shows(AC_TARGET,k));
   },
   refresh:()=>renderList(),
   openPanel:()=>openColumnPanel(),
   persist:patch=>saveColumns(patch),
  };
 }
 /* **既定で出す列を、初めて保存する瞬間に書き下ろす**（§9.164）。
    忘れると幅を1回引いただけで候補が全部並ぶ。 */
 async function saveColumns(patch){
  const keys=allColumnKeys(),seed=initialHidden(keys);
  const body=Object.assign({},patch);
  if(seed&&body.hidden===undefined)body.hidden=seed;
  if(body.order===undefined)body.order=keys;
  try{await WL.columnLayout.patch(AC_TARGET,body)}
  catch(e){showToast&&showToast('列の設定を保存できませんでした',e.message,6000);throw e}
  renderList();
 }
 function openColumnPanel(){
  if(!columnsEditable()){
   showToast&&showToast('列の設定は閲覧モードでは変えられません',
     '編集できる端末で設定すると、この端末にも同じ並びで出ます。',5200);
   return;
  }
  if(!WL.listColumns||typeof WL.listColumns.open!=='function'){
   console.error('列の設定パネル(WL.listColumns.open)がありません');
   return;
  }
  /* 差し替え口の形は既定の口と同じ（**関数で答える**）。データ一覧の
     `WL.records.recordColumnPanelSource()`と同じ作法で、パネル自体には手を入れない
     （§9.120。同じパネルを使い回す）。 */
  WL.listColumns.open({
   key:'actuals',eyebrow:'測定実績',
   title:()=>`表示列の設定（測定実績${acState.equipment?'：'+acState.equipment:''}）`,
   lead:'左で<b>出す列と並び</b>を決め、右で<b>選んだ1列の見え方</b>を整えます。'
       +'設備や期間を変えても同じ設定が使われます（<b>保存するまでは元に戻せます</b>）。'
       /* **出せないものは名前で言う**（§4／§9.288 ⑧）——統計と子ロットは
          測定値から**その場で計算する**値なので一覧では扱わない。黙って
          候補から落とすと「探しても無い」になり、打つ手を持てない。 */
       +(acState.fieldNote?'<br>'+acState.fieldNote:''),
   target:()=>AC_TARGET,
   savedToast:'測定実績の表示列を保存しました',
   savedNote:'次に開いたときも同じ形で出ます',
   keys:()=>allColumnKeys(),
   healed:()=>null,
   initialHidden:(keys,l)=>initialHidden(keys,l),
   rows:()=>filtered().slice(0,40).map((x,i)=>rowView(x,i)),
   valueOf:(row,k)=>(row?row[k]:undefined),
   /* この一覧のデータの列か（§9.489）。式を持っても計算列ではない（元の値を式で作り直す列）。 */
   isData:k=>!!columnOf(k),
   virtual:()=>AC_VIRTUAL,
   joined:()=>new Set(),
   joinFrom:()=>'',
   origins:()=>['source','calc'],
   originOf:k=>(AC_VIRTUAL_KEYS.has(k)?'calc':'source'),
   noteOf:k=>{const c=columnOf(k);return (c&&c.note)||''},
   currentWidthOf:headCellWidth,
   features:{formula:true,preset:true,width:true,format:true,rule:true,sort:false},
   afterApply:()=>renderList(),
   save:null,
  });
 }

 /* ---------- 出力 ---------- */
 function openReport(id){
  if(typeof window.openReportForRecord!=='function'){
   showToast&&showToast('帳票を開けません','帳票の画面が読み込まれていません。',5000);return;
  }
  window.openReportForRecord(id,{returnTo:'actuals'});
 }
 function printSelectedReports(){
  const ids=[...acState.selected];
  if(!ids.length)return;
  if(!WL.report||typeof WL.report.bulkPrint!=='function'){
   showToast&&showToast('帳票をまとめて刷れません','帳票の画面が読み込まれていません。',5000);return;
  }
  WL.report.bulkPrint(ids).catch(e=>
   showToast&&showToast('帳票を刷れませんでした',e&&e.message||String(e),6000));
 }
 function openSheet(){
  if(!WL.opSheet||typeof WL.opSheet.open!=='function'){
   showToast&&showToast('操業データ表を開けません','操業データ表の画面が読み込まれていません。',5000);return;
  }
  WL.opSheet.open({equipment:acState.equipment,items:filtered(),basis:acState.basis,
                   from:acState.from,to:acState.to,opDefs:acState.opDefs,
                   lotFields:acState.lotFields});
 }

 /* ---------- 入口 ---------- */
 async function openActuals(){
  WL.enterView('actuals');
  const panel=ensurePanel();
  panel.hidden=false;
  WL.syncViewToolbar('actuals');
  if(!acState.from&&!acState.to)applyDays(acState.days||AC_DEFAULT_DAYS);
  syncHead();
  renderList();
  /* 配置設定は**描く前に読む**（読めなくても既定の並びで一覧は出る）。 */
  await Promise.all([WL.columnLayout.load(AC_TARGET).catch(WL.quiet('列の設定を取れない（既定の並びで出す）')),
                     (WL.displayRules&&WL.displayRules.load)?WL.displayRules.load().catch(WL.quiet('表示ルールを取れない（読み替え無しで出す）')):Promise.resolve(),
                     loadEquipments()]);
  syncHead();
  await load(true);
 }
 loadPref();
 WL.onReady(()=>{
  const btn=$id('openActuals');
  if(btn)btn.onclick=()=>openActuals().catch(e=>
    showToast&&showToast('測定実績を開けませんでした',e&&e.message||String(e),6000));
 });
 WL.actuals={open:openActuals,state:acState,columns:allColumns,columnKeys:allColumnKeys,
             labelOf,rowView,cellText,target:AC_TARGET,localStamp,visibleColumnKeys,setSort};
})();
