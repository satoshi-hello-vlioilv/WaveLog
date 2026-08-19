"use strict";
/* measurement-view.js: 測定画面の構成 — データ形状(ensureMeasureShape/collect)、
   画面全体の描画(renderMeasurement)、左右パネル、入力検証、作業時間、公差表示の見出し。 */
/* 入力内容の素性を決めるのは**ここ1箇所**（§9.138）。以前は
   `type==='板厚/板幅'`という文字列比較が6ファイル・十数箇所に散っており、
   項目を「板厚」「板幅」の2つへ分けるだけで**片方だけ直った状態**が簡単に
   できてしまう（公差の出どころ・幅分割公差・自動転送の固定・帳票の節・
   入力欄の数——どれか1つ落とすと、そこだけ黙って別の項目の公差で判定する）。
   §9.125で`toleranceDetail`の第3引数を3ファイルへ通し忘れて偽の公差外を
   出したのと同じ壊れ方なので、判定は関数にして散らさない。 */
WL.measureItem={
 /* 保存済みレコードが持つ旧名。選択肢から消えた値をそのまま`select.value`へ
    入れると**空文字になる**（＝どの項目でもない状態で開く）ので、読み込む
    時点で今の名前へ寄せる。板幅が条ごと・板厚が丈ごとなので、旧名は
    「条ごと」側＝板幅として開く。 */
 LEGACY:'板厚/板幅',
 /* 「母材」と「揃い/肉厚/長さ」は**1つの項目**（§9.160、利用者の指示）。
    どちらも測定器を使わない手入力で、どちらもロットを開いた最初に入れる。
    保存済みレコードは旧名を持つので、読み込む時点でこの名前へ寄せる
    （選択肢に無い値を`select.value`へ入れると空文字＝どの項目でもない
    状態で開く。`LEGACY`と同じ扱い）。 */
 MATERIAL:'母材・揃い/肉厚/長さ',
 LEGACY_MATERIAL:['母材','揃い/肉厚/長さ'],
 /* 旧名（母材／板厚/板幅）も残す——保存済みレコードを開いた瞬間に
    `activeMeasureKey()`の答えが変わらないようにするため。 */
 KEYS:{'母材・揃い/肉厚/長さ':'mother',母材:'mother',板厚:'thickness',板幅:'width',
  ラテラルボー:'lateral',バリ:'burr',
  テレスコープ:'telescope',巻ずれ:'offset',フラットネス:'flatness','板厚/板幅':'width'},
 normalize(type){const t=String(type??'');
  if(t===this.LEGACY)return '板幅';
  return this.LEGACY_MATERIAL.indexOf(t)>=0?this.MATERIAL:t;},
 /* 手入力の面（母材＋丈）か。 */
 isMaterial(type){return this.normalize(type??this.current())===this.MATERIAL},
 /* 板厚・板幅か（＝製造/オーダー公差を選べる寸法系か）。 */
 isDimensional(type){const t=String(type??'');return t==='板厚'||t==='板幅'||t===this.LEGACY},
 current(){return (typeof $==='function'&&$('#measureType')?.value)||S.measure?.settings?.measureType||''},
 /* 公差・基準値をどちらの寸法で引くか。 */
 kindOf(type){return this.normalize(type??this.current())==='板厚'?'thickness':'width'},
 /* 1丈位置あたりの枠の数と呼び名。**板厚だけは条ごとではなく丈ごとに3点**
    （エッジOS・中央CL・エッジDS）で、条数が40でも枠は3つしかない。 */
 slotCount(key,count){return key==='thickness'?3:count},
 slotLabels(key,count){return key==='thickness'?['OS','CL','DS']
  :Array.from({length:count},(_,j)=>String(j+1))},
 slotHead(key){return key==='thickness'?'位置':'条'},
};
// 横割数(条数)・縦割数(丈割数)の初期値は仕掛データ側の「BOX設計_横割数」
// 「BOX設計_縦割数」から読む。値が無い/数値でない/範囲外の場合のみ、従来
// 通り1を初期値とする(安全側。#horizontalCountは1〜40、#verticalCountは
// 1〜9が入力欄の許容範囲)。
function defaultHorizontalCount(row){
 const n=Number(pick(row,'boxHorizontalCount'));
 return Number.isFinite(n)&&n>=1&&n<=40?Math.round(n):1;
}
function defaultVerticalCount(row){
 const n=Number(pick(row,'boxVerticalCount'));
 return Number.isFinite(n)&&n>=1&&n<=9?Math.round(n):1;
}
/* 新しい測定データ。**作った時点で「誰が・どの端末で入力を始めたか」を
   持たせる**(§9.180)。あとから足せない情報で、別のPCで続きを開いても
   (§9.91)この3つは書き換えない——「始めた人」が最後に保存した端末で
   塗り潰されると、責任の所在が変わってしまう。
   端末名は`/api/access-mode`が返す値。**取れないこともある**ので、そのときは
   空のまま保存し、サーバー側(`/api/measurement/backup`)が自分のホスト名で
   埋める(分かる範囲で埋めるのが監査列の作法)。 */
function measureStarter(){
 const t=(window.WL&&WL.terminal)||null;
 return {createdAt:new Date().toISOString(),
         createdBy:t?t.userId():((typeof currentUserId==='function'&&currentUserId())||''),
         createdPc:t?t.pcName():''};
}
function blankMeasure(row){return{id:crypto.randomUUID(),status:'編集中',updatedAt:new Date().toISOString(),...measureStarter(),source:row,basic:Object.fromEntries(Object.keys(aliases).map(k=>[k,pick(row,k)])),settings:{operator:'-',inspector:'-',lengthPos:'1(頭)',measureType:WL.measureItem.MATERIAL,verticalCount:defaultVerticalCount(row),horizontalCount:defaultHorizontalCount(row),unwind:'上出し',innerDiameter:'-',spool:'-',thicknessGauge:'-',widthGauge:'-',widthOrder:'通常',widthDirection:'昇順',inputMode:'auto',tStep:0,wStep:0,burrFirst:null,ngCount:0,burr:'指定なし',coilStop:'指定なし',crewSize:'-'},mother:{},qualityInfo:'異常情報なし',measurements:{thickness:Array.from({length:LENGTH_SLOTS},()=>Array(3).fill('')),width:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),lateral:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),burr:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),telescope:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),offset:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),flatness:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill('')),comments:Array.from({length:LENGTH_SLOTS},()=>Array(40).fill(''))}}}
/* 保存データ/新規データを最新スキーマへ整形する。旧実装は多層ラップ
   (基本形状→製品丈→登録設備→作業時間)だったものを一本化した。 */
function ensureMeasureShape(m){
 if(!m)return m;
 {
m.basic=m.basic||{};m.settings={operator:'-',inspector:'-',lengthPos:'1(頭)',measureType:WL.measureItem.MATERIAL,verticalCount:1,horizontalCount:1,unwind:'上出し',innerDiameter:'-',spool:'-',thicknessGauge:'-',widthGauge:'-',widthOrder:'通常',widthDirection:'昇順',inputMode:'auto',tStep:0,wStep:0,burrFirst:null,ngCount:0,burr:'指定なし',coilStop:'指定なし',...(m.settings||{})};
/* コイル止めは以前「内巻両面テープ」チェックボックス1個(真偽値innerTape)
   だった。マスタ化して選択欄になったので、過去のデータは真偽値から
   名称へ読み替える(旧レコードを開いたときに「指定なし」へ化けないように)。
   innerTape自体は残さない——両方あると、どちらが正か分からなくなる。 */
/* 入力内容の「板厚/板幅」は板厚(丈ごと3点)と板幅(条ごと)へ分けた(§9.138)。
   旧レコードを開いたときに選択肢の無い値が入って**どの項目でもない状態**に
   ならないよう、読み込む時点で今の名前へ寄せる(coilStopと同じ方針)。 */
m.settings.measureType=WL.measureItem.normalize(m.settings.measureType);
if(m.settings.innerTape!==undefined){
 if(!(m.settings||{}).coilStop||m.settings.coilStop==='指定なし')
  m.settings.coilStop=m.settings.innerTape?'内巻両面テープ':'指定なし';
 delete m.settings.innerTape;
}
m.mother=m.mother||{};m.qualityInfo=m.qualityInfo||'異常情報なし';m.measurements=m.measurements||{};const shape=(name,width)=>{const src=Array.isArray(m.measurements[name])?m.measurements[name]:[];m.measurements[name]=Array.from({length:LENGTH_SLOTS},(_,i)=>Array.from({length:width},(_,j)=>src[i]?.[j]??''))};shape('thickness',3);['width','lateral','burr','telescope','offset','flatness','comments'].forEach(k=>shape(k,40));
 }
 {
 if(!m.product||!Array.isArray(m.product.rows)){
  const legacy=m.product&&typeof m.product==='object'?m.product:null;
  m.product={rows:Array.from({length:LENGTH_SLOTS},blankProductRow)};
  if(legacy&&(legacy.productLength||legacy.wallThickness||legacy.alignmentCode)){
   Object.assign(m.product.rows[0],{productLength:legacy.productLength||'',wallThickness:legacy.wallThickness||'',alignmentCode:legacy.alignmentCode||'',edgeShape:legacy.edgeShape||'',occurrencePosition:legacy.occurrencePosition||'',regularity:legacy.regularity||'',direction:legacy.direction||'',pitch:legacy.pitch||'',alignmentValue:legacy.alignmentValue||''});
  }
 }else if(m.product.rows.length<LENGTH_SLOTS){
  while(m.product.rows.length<LENGTH_SLOTS)m.product.rows.push(blankProductRow());
 }
 }
 m.settings.registeredEquipment=m.settings.registeredEquipment||m.registeredEquipment||m.snapshot?.registeredEquipment||'';
 m.workTime={startAt:'',endAt:'',...(m.workTime||{})};
 /* Accessへのバックアップ同期状態。status: 'synced'(直近の送信に成功)/
    'pending'(まだ送信していない、または未送信のまま作成された旧データ)/
    'failed'(直近の送信が失敗)。records-store.js の markSyncResult が
    backupRecord() の成否に応じて更新する。旧データ(このフィールドが無い)は
    実際に送信できたか判定できないため安全側でpendingとし、再送の対象にする
    (backupRecordはDELETE+INSERTのため再送しても重複しない)。 */
 m.syncState={status:'pending',lastAttempt:'',lastError:'',attempts:0,...(m.syncState||{})};
 return m;
}
/* 画面の入力値をS.measureへ回収する。設定→母材→製品丈→登録設備→作業時間の順。 */
function collect(){
 // verticalCount/horizontalCountはdefaultVerticalCount/defaultHorizontalCountが
 // 数値で設定する項目のため、DOM値(常に文字列)を読み戻す際も数値へ揃える
 // (揃えないと、後続のリロード等を経ない一度目の保存でだけ文字列型のまま
 // 保存され、===比較箇所で不整合を起こし得る)。
 const m=S.measure;m.updatedAt=new Date().toISOString();['operator','inspector','lengthPos','measureType','verticalCount','horizontalCount','unwind','innerDiameter','spool','thicknessGauge','widthGauge','widthOrder','widthDirection','crewSize','burr','coilStop'].forEach(k=>{const el=$('#'+k);if(!el)return;m.settings[k]=(k==='verticalCount'||k==='horizontalCount')?(Number(el.value)||1):el.value});m.qualityInfo=$('#qualityInfo').value;document.querySelectorAll('[data-mother]').forEach(x=>m.mother[x.dataset.mother]=x.value);saveFlatComment();
 m.product=m.product&&Array.isArray(m.product.rows)?m.product:{rows:Array.from({length:LENGTH_SLOTS},blankProductRow)};
 document.querySelectorAll('#productRowsBody tr').forEach(tr=>{
  const i=+tr.dataset.row,row=m.product.rows[i]=m.product.rows[i]||blankProductRow();
  tr.querySelectorAll('[data-product-field]').forEach(el=>row[el.dataset.productField]=el.value);
 });
 {const equipment=currentConfiguredEquipment();m.settings=m.settings||{};m.settings.registeredEquipment=equipment;m.registeredEquipment=equipment;m.snapshot=m.snapshot||{};m.snapshot.registeredEquipment=equipment}
 m.workTime=m.workTime||{};m.workTime.startAt=$('#workStartAt')?.dataset.iso||m.workTime.startAt||'';m.workTime.endAt=$('#workEndAt')?.dataset.iso||m.workTime.endAt||'';
 return m;
}
/* ---------- 母材の計算全長（参考）（§9.160、利用者の指示） ----------
   元データがそろっているときだけ出す。**測定値ではない**ので、値と一緒に
   出どころ（BOX実績の板厚・板幅・良品重量と比重）を必ず添える——同じ
   「全長」でも、手計算・カード指示・この参考値は当たる見込みが違う。

   良品重量(kg) ÷ 比重(g/cm³) が体積(cm³)、断面積は 板厚×板幅(mm²)＝t·w/100(cm²)。
   長さ(cm)=100000·kg/(比重·t·w) なので **長さ(m)=1000·kg/(比重·t·w)**。
   例) 0.5mm × 1250mm × 比重2.70 × 3,200kg → 1000×3200/(2.7×0.5×1250)=1896.3m

   **良品重量が0のときは計算しない**（利用者の指示）。0除算になる板厚・板幅・
   比重も同じ扱いで、そろっていなければ**欄ごと出さない**（§CLAUDE.md
   「できないことは、できないと書く」の裏返しで、そもそも欄を置かない）。
   値は`sourceField()`で生の行から引く——`basic`は`aliases`に載せた列しか
   持たず、ここで要る4つはそのうち板幅しか無い。 */
const MOTHER_CALC_FIELDS={thickness:['BOX実績_板厚'],width:['BOX実績_板幅'],
 density:['比重'],weight:['BOX実績_良品重量']};
function motherCalcLength(){
 /* 空欄を0と読まない（`Number('')`は0。屑幅で同じ罠を踏んでいる）。 */
 const num=names=>{const raw=String(sourceField(names)||'').trim();
  if(raw==='')return NaN;const n=Number(raw);return Number.isFinite(n)?n:NaN};
 const thickness=num(MOTHER_CALC_FIELDS.thickness),width=num(MOTHER_CALC_FIELDS.width);
 const density=num(MOTHER_CALC_FIELDS.density),weight=num(MOTHER_CALC_FIELDS.weight);
 if(![thickness,width,density,weight].every(Number.isFinite))return null;
 if(!(weight>0))return null;
 if(!(thickness>0&&width>0&&density>0))return null;
 return{thickness,width,density,weight,meters:1000*weight/(density*thickness*width)};
}
function updateMotherCalcLength(){
 const box=$('#motherCalcLengthField'),out=$('#motherCalcLength'),basis=$('#motherCalcBasis');
 if(!box||!out||!basis)return;
 const r=S.measure?motherCalcLength():null;
 const hide=!r;
 /* **同じ値なら触らない**（§9.131。`hidden`は同値の代入でも変更記録が積まれる）。 */
 if(box.hidden!==hide)box.hidden=hide;
 if(basis.hidden!==hide)basis.hidden=hide;
 if(!r){out.textContent='－';basis.textContent='';return}
 out.textContent=fmtDim(r.meters,1)+' m';
 basis.textContent=`BOX実績 板厚 ${fmtDim(r.thickness,3)}mm × 板幅 ${fmtDim(r.width,1)}mm`
  +` × 比重 ${fmtDim(r.density,2)} ／ 良品重量 ${r.weight.toLocaleString('ja-JP')}kg`;
}
/* 公開は名前空間へ（素の`window.*`を増やさない。`test_globallint`）。 */
window.WL.motherCalc={length:motherCalcLength,refresh:updateMotherCalcLength};
function activateWorkspace(name){document.querySelectorAll('[data-worktab]').forEach(b=>b.classList.toggle('active',b.dataset.worktab===name));document.querySelectorAll('[data-workpanel]').forEach(p=>p.hidden=p.dataset.workpanel!==name)}
/* 丈位置・条数のセレクト内容とフラットネス備考の入出力。 */
function updateLengthOptions(count){const el=$('#lengthPos');if(!el)return;const current=el.value||S.measure?.settings?.lengthPos||'1(頭)',n=Math.max(1,Math.min(9,+count||1)),values=[];for(let i=1;i<=n;i++)values.push(`${i}(頭)`);values.push(`${n}(尾)`);el.innerHTML=[...new Set(values)].map(v=>`<option>${v}</option>`).join('');el.value=[...el.options].some(o=>o.value===current)?current:values[0]}
/* 横割数(条数)の入力上限を、この設備の最大条数(設備マスタ)へ合わせる。
   設備ごとに割れる条数が違うため、40固定だと他設備で入れられてしまう。
   マスタが未設定/未取得のときは構造上の上限(40)のまま。 */
function currentMaxStrips(){
 const n=Number(S.measure?.settings?.maxStrips);
 return Number.isFinite(n)&&n>=1?Math.min(40,Math.round(n)):40;
}
function applyMaxStripsToInputs(){
 const max=currentMaxStrips(),el=$('#horizontalCount');
 if(!el)return;
 el.max=String(max);
 el.title=`この設備で割れる最大条数は${max}条です（マスタ管理 > 設備の「最大条数」）。`;
 if(Number(el.value)>max){el.value=String(max);if(typeof markDirty==='function')markDirty()}
}
function updateCoilOptions(count){const el=$('#coilNo');if(!el)return;const n=Math.max(1,Math.min(currentMaxStrips(),+count||1)),current=+el.value||1;el.innerHTML=Array.from({length:n},(_,i)=>`<option value="${i+1}">${i+1}条</option>`).join('');el.value=Math.min(current,n);loadFlatComment()}
/* v35: フラットネスは入力内容(measureType)の一項目として、巻ずれ・テレスコープと
   同じ条グリッドで判定記号(〇/△/×)を入力する形に変更。備考のみ対象条を選んで
   入力するミニパネルとして残す（#coilNo/#coilCommentはフラットネス選択時のみ
   動的に生成されるため、両関数とも要素が無ければ何もしない）。 */
function saveFlatComment(){if(!S.measure||!$('#coilNo'))return;const i=(+$('#coilNo').value||1)-1,j=lengthIndex();S.measure.measurements.comments[j][i]=String($('#coilComment').value||'').replace(/[;|]/g,'')}
function loadFlatComment(){if(!S.measure||!$('#coilNo'))return;const i=(+$('#coilNo').value||1)-1,j=lengthIndex();$('#coilComment').value=S.measure.measurements.comments[j][i]||''}
function rightLayoutFor(type){
 return WL.measureItem.isMaterial(type)?'material':'measure';
}
function applyRightLayout(){
 if(!S.measure)return;
 const type=$('#measureType').value, layout=rightLayoutFor(type), pane=$('.right-pane');
 pane.classList.remove('layout-material','layout-measure');
 pane.classList.add('layout-'+layout); activateWorkspace(layout);
 if(layout==='measure'){renderMeasureGrid();updateMeasurementHeading()}
 if(layout==='material'){renderProductPanel();updateMotherCalcLength()}
}
/* v33: 「揃い/肉厚/長さ」は縦割数で分割した丈(1〜N)ごとに複数行で保持する。
   丈は旧VBA帳票の「丈」テーブル（長さ/肉厚/揃い/外観/備考）と同じ、
   丈=最終的に分割された各ピースを指す1..N連番（頭/尾のサンプリング位置とは無関係）。
   v34では丈番号タブ+縦並びフォームにしていたが、§9.131で**全丈を1つの表**へ
   戻した（②の作業面は実測1059×920pxあり、9丈×9項目は横スクロールなしで
   収まる）。読み書きするDOMは`#productRowsBody`の1本だけで、
   `collect()`・`activeRequiredControls()`も同じものを見る。 */
function blankProductRow(){return{productLength:'',wallThickness:'',alignmentCode:'',edgeShape:'',occurrencePosition:'',regularity:'',direction:'',pitch:'',alignmentValue:'',note:''}}
/* ---------- 揃いの記録(§9.203、利用者の指示) ----------
   「揃いコードで打ち込むところを、選ばせて記録する形に変更したい」
   「コードを作らず廃止、エッジ形状・発生位置・規則性・方向・ピッチ・値の
     6種類で管理する形に」「方向は前側/後側ではなくOS/DS」
   「エッジ形状に『揃い綺麗』という評価を追加」

   **4桁のコードは廃止した。** 桁の意味を覚えていないと読めない値だったので、
   名前をそのまま記録する（帳票にもDBにも意味のある文字が残る）。
   **判定の起点はエッジ形状**——「揃い綺麗」ならそこで終わり、それ以外を
   選んだときだけ内訳（発生位置・規則性・方向・ピッチ・値）を書く。
   異常が無いのに5欄を埋めさせない（§4/§2）。

   **旧データは消さない。** 4桁コードで保存されたレコードは`alignmentCode`を
   持ったままで、判定はそちらから作り、画面にも「旧 1234」と出す
   （コードを廃止したからといって、記録されたものが読めなくなってはいけない）。 */
const PRODUCT_EDGE_OK='揃い綺麗';
const PRODUCT_CHOICES=[
 {k:'edgeShape',          label:'エッジ形状',opts:[PRODUCT_EDGE_OK,'のこぎり状','テレスコ状']},
 {k:'occurrencePosition', label:'発生位置',  opts:['2/3以上発生','1/3〜2/3発生','1/3未満発生']},
 {k:'regularity',         label:'規則性',    opts:['不規則','規則的']},
 {k:'direction',          label:'方向',      opts:['OS','DS']},
];
/* エッジ形状が「揃い綺麗」のときは書かない欄。**空にして押せなくする**
   （押せるのに意味が無い欄を残さない）。 */
const PRODUCT_DETAIL_KEYS=['occurrencePosition','regularity','direction','pitch','alignmentValue'];
function judgeProductRow(r){
 if(!r)return '';
 const edge=String(r.edgeShape||'').trim();
 if(edge)return edge===PRODUCT_EDGE_OK?'OK':'NG';
 /* 選び直していない旧データは、当時のコードで判定する。 */
 return judgeAlignmentCode(r.alignmentCode);
}
/* 選択欄。**選択肢に無い値が入っていたら、その値を選択肢に足す**(§9.160)
   ——`select.value`へ無い値を入れると空文字になり、保存済みの記録が
   黙って消える。 */
function productSelectHtml(def,value){
 const v=String(value||'');
 const known=def.opts.includes(v);
 const opts=[`<option value=""></option>`]
  .concat(def.opts.map(o=>`<option value="${esc(o)}"${v===o?' selected':''}>${esc(o)}</option>`))
  .concat(!v||known?[]:[`<option value="${esc(v)}" selected>${esc(v)}（旧データ）</option>`]);
 return `<select data-product-field="${def.k}" aria-label="${esc(def.label)}">${opts.join('')}</select>`;
}
function productRowCount(){return Math.max(1,Math.min(9,+$('#verticalCount')?.value||1))}
/* 1丈を「入力済み」とみなす項目。**判定の起点(エッジ形状)を含める**
   ——揃いコードを廃止したので、旧`alignmentCode`だけを見ると
   新しく入力した行が1件も数えられない。 */
const PRODUCT_FILLED_KEYS=['productLength','wallThickness','edgeShape','alignmentCode'];
function judgeAlignmentCode(code){code=String(code||'').trim();if(!code)return '';return code==='0000'?'OK':'NG'}
function updateProductStatus(){
 const m=S.measure;if(!m?.product?.rows)return;
 const n=productRowCount(),filled=m.product.rows.slice(0,n).filter(r=>PRODUCT_FILLED_KEYS.some(k=>String(r?.[k]||'').trim()!=='')).length;
 if($('#productMeasureStatus'))$('#productMeasureStatus').textContent=filled?`入力済み ${filled}/${n}丈`:'入力待ち';
}
/* 丈は**全部を1つの表で**出す（§9.131）。以前は丈番号タブで1丈ずつ切り替え、
   同じ内容の隠しテーブルを裏で同期させていた。理由は「横スクロールを避ける」
   だったが、実測すると②の作業面は1059×920pxあり、**9丈×9項目は横スクロール
   なしで収まる**（切り替えた側の空きは542px）。タブで隠す必要が無いなら
   隠さない——切り替えの手間も、2つのDOMを同期させる仕掛けも消える。
   `collect()`・`activeRequiredControls()`が読むのは元から`#productRowsBody`
   なので、**読み書きの経路は1本のまま**になる。 */
function renderProductPanel(){
 const m=S.measure;const body=$('#productRowsBody'),tabs=$('#productLengthTabs'),fields=$('#productLengthFields');
 if(!body||!m)return;
 if(!m.product||!Array.isArray(m.product.rows))m.product={rows:Array.from({length:LENGTH_SLOTS},blankProductRow)};
 const n=productRowCount();
 /* 1丈ずつの器は使わない。**残骸を残さない**（空のタブ列が細い帯として残る）。 */
 if(tabs){tabs.innerHTML='';tabs.hidden=true}
 if(fields){fields.innerHTML='';fields.hidden=true}
 body.innerHTML=Array.from({length:n},(_,i)=>{
  const r=m.product.rows[i]||(m.product.rows[i]=blankProductRow());
  const ok=String(r.edgeShape||'')===PRODUCT_EDGE_OK;
  const field=(key,type)=>`<input data-product-field="${key}" value="${esc(r[key]||'')}" type="${type||'text'}"`
   +(type==='number'?' inputmode="decimal" step="any"':'')+'>';
  const sel=k=>productSelectHtml(PRODUCT_CHOICES.find(d=>d.k===k),r[k]);
  const judge=judgeProductRow(r);
  const oldCode=String(r.alignmentCode||'').trim();
  /* **内訳は異常のときだけ、行の下へ横いっぱいで出す**(§9.203)。
     5欄を横に並べると1列120px×5が要り、器(実測841px)に入らない
     ——詰めると「1/3〜2/3発生」が見切れる。異常が無い行では場所も取らない
     ので、面積は「頻度×重要度」どおりに配れる(§1)。 */
  const detail=ok||!String(r.edgeShape||'')
   ?''
   :`<tr class="prt-detail" data-row="${i}"><td colspan="6"><div class="prt-detail-in">`
     +`<span class="prt-detail-lead">丈${i+1}の内訳</span>`
     +PRODUCT_CHOICES.filter(d=>d.k!=='edgeShape')
       .map(d=>`<label class="prt-df"><span>${esc(d.label)}</span>${sel(d.k)}</label>`).join('')
     +`<label class="prt-df"><span>ピッチ</span>${field('pitch','number')}</label>`
     +`<label class="prt-df"><span>値</span>${field('alignmentValue','number')}</label>`
     +`</div></td></tr>`;
  return `<tr data-row="${i}"><th>${i+1}</th><td>${field('productLength','number')}</td><td>${field('wallThickness','number')}</td>`
   +`<td><span class="product-judge${judge==='OK'?' ok':judge==='NG'?' ng':''}" data-product-judge="${i}">${esc(judge)}</span>`
   +(oldCode?`<small class="prt-old" title="4桁の揃いコードで記録された旧データです。エッジ形状を選び直すと、そちらが判定に使われます">旧 ${esc(oldCode)}</small>`:'')+`</td>`
   +`<td>${sel('edgeShape')}</td><td>${field('note')}</td></tr>`+detail;
 }).join('');
 body.querySelectorAll('[data-product-field]').forEach(el=>{
  const apply=()=>{
   const tr=el.closest('tr'),i=+tr.dataset.row,key=el.dataset.productField;
   const row=m.product.rows[i]=m.product.rows[i]||blankProductRow();
   const prevEdge=String(row.edgeShape||'');
   row[key]=el.value;
   if(key==='edgeShape'){
    const isOk=el.value===PRODUCT_EDGE_OK;
    /* 「揃い綺麗」を選んだら内訳は要らない。**残った値を消してから**
       描き直す（残すと、画面には出ていない値が保存され続ける）。 */
    if(isOk)PRODUCT_DETAIL_KEYS.forEach(k=>{row[k]=''});
    /* 描き直すのは**内訳の段が出入りするときだけ**。のこぎり状⇄テレスコ状の
       付け替えでは描き直さない——選んだ欄からフォーカスが外れる。 */
    const had=!!prevEdge&&prevEdge!==PRODUCT_EDGE_OK;
    const has=!!el.value&&!isOk;
    if(had!==has){renderProductPanel();markDirty();return}
   }
   const j=judgeProductRow(row),badge=tr.querySelector('[data-product-judge]');
   if(badge){badge.textContent=j;badge.className='product-judge'+(j==='OK'?' ok':j==='NG'?' ng':'')}
   markDirty();updateProductStatus();
  };
  /* selectは`input`も飛ぶが、**`change`も受ける**——古いブラウザ差を
     気にせず1本にまとめる（同じ値なら2度目は何も変わらない）。 */
  el.oninput=apply;
  if(el.tagName==='SELECT')el.onchange=apply;
 });
 upgradeManualInputTypes();updateProductStatus();
 loadFlatComment(); applyInputProtection();
}
if($('#productAllOk'))$('#productAllOk').onclick=()=>{
 const n=productRowCount();
 /* 「異常なし」＝エッジ形状が「揃い綺麗」。内訳は空にする(§9.203)。
    旧コードも消す——選び直したのに「旧 0000」が残ると、どちらが効いて
    いるのか分からない。 */
 for(let i=0;i<n;i++){const row=S.measure.product.rows[i]=S.measure.product.rows[i]||blankProductRow();
  Object.assign(row,{alignmentCode:'',edgeShape:PRODUCT_EDGE_OK,occurrencePosition:'',regularity:'',direction:'',pitch:'',alignmentValue:''})}
 renderProductPanel();markDirty();
};
$('#verticalCount')?.addEventListener('change',()=>{if(WL.measureItem.isMaterial($('#measureType').value))renderProductPanel()});
/* 測定種ごとに運用が固定されているため、入力モードの切替UI自体を出さない。
   - 板厚・板幅・バリ: 測定器からの自動転送のみ。
   - ラテラルボー・テレスコープ・巻ずれ・フラットネス: 実運用は手動入力のみ
     (対応する自動転送デバイスがないため)。伝送状態欄(受信欄・検知回数等)
     も自動転送を前提にした表示のため、手動固定の測定種では丸ごと隠す。 */
/* 設定系入力の変更はすべて未保存フラグを立てる(個別のonchangeを持つ要素は
   この後の個別割当が優先される。この行は必ず個別割当より先に実行すること)。 */
document.querySelectorAll('.selectors input,.selectors select,.material-grid input').forEach(x=>x.onchange=markDirty);
const AUTO_ONLY_MEASURE_TYPES={'板厚':1,'板幅':1,'バリ':1};
const MANUAL_ONLY_MEASURE_TYPES={'ラテラルボー':1,'テレスコープ':1,'巻ずれ':1,'フラットネス':1};
function syncInputModeLock(){
 if(!S.measure)return;
 const type=$('#measureType')?.value,tabs=$('.mode-tabs'),statusBox=$('#inputStatusBox');
 const forceAuto=!!AUTO_ONLY_MEASURE_TYPES[type],forceManual=!!MANUAL_ONLY_MEASURE_TYPES[type];
 if(tabs)tabs.hidden=forceAuto||forceManual;
 if(statusBox)statusBox.hidden=forceManual;
 const desiredMode=forceAuto?'auto':forceManual?'manual':null;
 if(desiredMode&&S.measure.settings.inputMode!==desiredMode){
  S.measure.settings.inputMode=desiredMode;
  document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x.dataset.mode===desiredMode));
  applyInputProtection();
  updateReceiveState(document.activeElement===$('#deviceInput'));
 }
}
$('#measureType').onchange=()=>{S.measure.settings.wStep=0;S.measure.settings.tStep=0;S.measure.settings.burrFirst=null;S.measure.settings.measureType=$('#measureType').value;applyRightLayout();syncInputModeLock();$('#deviceInput').focus();markDirty()};
/* 測定画面全体の再描画。旧実装は9層のラップ(モード表示→製品丈→検証→
   基本情報→公差セレクタ→コース→作業時間→タブ初期化)だったものを、
   実行順を保ったまま一本の関数へ整理した。 */
function renderMeasurement(){
 hydrateBusinessFields();
 measureDirty=false;const m=S.measure,b=m.basic;updateLengthOptions(m.settings.verticalCount||1);updateCoilOptions(m.settings.horizontalCount||1);$('#modalEquipment').textContent=b.equipment;/* 基本情報の並び(§9.55)。13項目を「主識別 → 識別番号 → 製品 → コース」の
    4かたまりへ束ね、参照用の項目はラベルと値を1行に収める。以前は全項目が
    ラベル上・値下の同じ見た目で、短い値(コース等)まで全幅を1行使っていたため
    縦に収まらず常時スクロールしていた。 */
 /* **常に見せるのは8項目だけ**(§9.133)。測定中に本当に要るのは
    「どのロットか(ロット№・検査No.)」「何を作るか(用途名)」
    「どんな材か(製造の材質・調質・板厚・板幅・板丈)」で、残りの
    識別番号・取引先・オーダー寸法・コースは**普段は見ない**。
    以前は13項目＋寸法表＋コースを常時出しており、段を切り替えるたびに
    同じ情報が別の大きさ・別の場所に現れて散らかって見えていた。
    **消すのではなく畳む**——「詳細」で今までどおり全部読める。 */
 const idFields=[['鋳造No.','castingNo'],['オーダーNo.','orderNo'],['引当No.','allocationNo']];
 const productFields=[['用途コード','purposeCode'],['取引先','customer'],['納入先','delivery']];
 /* 識別番号・製品は**1行に1項目**（§9.159、利用者の指摘「納入先・送り先などが
    表示しきれていない」）。2列に割ると値へ渡せる幅が94pxしか無く、実データの
    取引先・納入先（半角カナの会社名）はほぼ必ず省略記号で切れていた。
    値が短い品質規格（「2C」「3」）は2列のままでよい——**列数は中身の長さで
    決める**（§9.130）。1項目ぶん行が増えるが、詳細は畳んである面なので
    高さより「読み切れること」を採る。 */
 const cell=([l,k])=>`<div class="field full"><label>${l}</label><output title="${esc(b[k])}">${esc(b[k])||'—'}</output></div>`;
 const val=(l,v)=>`<div class="field"><label>${l}</label><output title="${esc(v)}">${esc(v)||'—'}</output></div>`;
 /* **欠けた値を区切り記号で埋めない**（§9.154）。`5052-`や`3.000××2500.8`は
    「そういう値」と見分けが付かない。欠けている側は**位置が分かる形で`?`**に
    する（寸法は板厚×板幅×板丈と位置に意味があるため、詰めると別の寸法に
    読める）。全部空なら組ごと`—`（`inline()`が空文字を`—`にする）。 */
 const joinDash=parts=>{
  const v=parts.map(x=>String(x??'').trim());
  return v.some(Boolean)?v.map(x=>x||'?').join('-'):'';
 };
 const joinDim=specs=>{
  const v=specs.map(([x,d])=>fmtDim(x,d));
  return v.some(Boolean)?v.map(x=>x||'?').join('×'):'';
 };
 /* 常時出す8項目も**カテゴリでまとめ、関係の近いものは横に並べる**
    （§9.137の骨子。利用者の指示「材質-調質、寸法は横並び」）。材質と調質は
    1つの材の呼び名、板厚・板幅・板丈は1つの寸法なので、**1行で1つの事実**
    として読めるようにする。縦に5行並べると、5つの別々の事実に見える。 */
 const inline=pairs=>'<div class="field full info-inline">'
   +pairs.map(([l,v])=>`<span class="ii"><label>${l}</label><output title="${esc(v)}">${esc(v)||'—'}</output></span>`).join('')
   +'</div>';
 /* 常時出す8項目は**3行**に詰める（§9.139、利用者の指示）。
      1行目＝管理番号（ロット№・検査No.）／2行目＝用途名／3行目＝材と寸法。
    見出しを行ごとに足すと行数が倍になって密度が下がるので、**ラベルが
    そのまま見出し**として働く並びにする。ロット№は`LotDsp`を開く
    ボタンだが、**器は番号の桁数ぶん**——全幅に伸ばすと、押せる面積が
    番号の何倍にもなって「番号」より「ボタン」に見える（§9.130）。 */
 let h='<div class="info-grid">'
  +'<div class="field full info-inline info-lot"><span class="ii"><label>ロット№</label>'
  +`<button type="button" class="lot-dsp-link" title="クリックでLotDspをこのロット番号で開きます">${esc(b.lotNo)||'—'}</button></span>`
  +`<span class="ii"><label>検査No.</label><output title="${esc(b.inspectionNo)}">${esc(b.inspectionNo)||'—'}</output></span></div>`
  +inline([['用途名',b.purposeName]])
  /* 材と寸法は**現場の呼び方どおり1組ずつ**にまとめる（§9.154、利用者の指示）。
     「5052-O」「3.000×1250.4×2500.8」は現場で口に出す形そのもので、
     材質/調質/板厚/板幅/板丈と5つのラベルに割ると、読む側が頭の中で
     つなぎ直すことになる。ラベルが5つ→2つになるぶん、1行に余裕も出る。 */
  +inline([['材調質',joinDash([b.mfgMaterial,b.mfgTemper])],
    ['製造寸法',joinDim([[b.mfgThickness,3],[b.mfgWidth,1],[b.mfgLength,1]])]])
  /* 骨子（§9.137）の①基本情報は「識別・製品・材・**分割ロット**・公差の値」。
     子ロットは`lot-split.js`が非同期で取りに行くので、器だけ先に置いて
     `refreshSplitStatusPanel()`が埋める。**分割が無いときは行ごと出さない**
     ——「分割無し」は条の設計カードが言っており、同じことを2箇所に
     書かない（§9.129）。 */
  +'<div class="field full info-inline info-split" id="basicSplit" hidden></div>'
  /* **詳細は畳んだまま**（§9.139、利用者の指示「基本情報は常時8項目」）。
     カードが実測380px空いていたので§9.135の「タブの裏を出して埋める」で
     開いてみたが、**開くと15px溢れる**（`test_maint`が検出）。8項目に絞る
     という決めごとと、この器の高さは両立しており、埋めるために増やすのは
     順序が逆——空きは条の設計カード側で使う。 */
  +'<button type="button" class="info-more" id="basicMore" aria-expanded="false" aria-controls="basicDetail">詳細を見る</button>'
  +'<div class="info-detail" id="basicDetail" hidden>'
  +'<div class="info-group">識別番号</div>'+idFields.map(cell).join('')
  +'<div class="info-group">製品</div>'+productFields.map(cell).join('')
  +'<div class="info-group info-group-course">コース</div>';h+=`<div class="dimension"><b></b><b>材質</b><b>調質</b><b>板厚</b><b>板幅</b><b>板丈</b><b>オーダー</b><span>${esc(b.orderMaterial)}</span><span>${esc(b.orderTemper)}</span><span>${esc(fmtDim(b.orderThickness,3))}</span><span>${esc(fmtDim(b.orderWidth,1))}</span><span>${esc(fmtDim(b.orderLength,1))}</span><b>製造</b><span>${esc(b.mfgMaterial)}</span><span>${esc(b.mfgTemper)}</span><span>${esc(fmtDim(b.mfgThickness,3))}</span><span>${esc(fmtDim(b.mfgWidth,1))}</span><span>${esc(fmtDim(b.mfgLength,1))}</span></div>`
  /* 品質規格は**詳細の中の1つの群**（§9.154、利用者の指示）。以前は基本情報
     カードのタブの裏に4×3の表で置いていたが、①「基本情報」カードの中に
     「基本情報」タブがあるのは冗長で、②見出し列を`width:11%`で決め打ちして
     いたため「ラテラルボー」「アルマイト」「表面処理」が省略記号で切れていた。
     **他の詳細項目と同じラベル＋値の並び**にすれば、ラベルは中身なりの幅を
     取るので切れず、タブも要らない。 */
  +'<div class="info-group">品質規格</div>'
  +'<div class="quality-grade-fields" id="qualityGradeFields"></div>'
  +'</div></div>';$('#basicInfo').innerHTML=h;
 {const mb=$('#basicMore'),dt=$('#basicDetail');
  if(mb&&dt)mb.onclick=()=>{const open=dt.hidden;dt.hidden=!open;
   mb.setAttribute('aria-expanded',open?'true':'false');
   mb.textContent=open?'詳細を閉じる':'詳細を見る';};}Object.entries(m.settings).forEach(([k,v])=>{const el=$('#'+k);if(el){if(el.type==='checkbox')el.checked=v;else el.value=v}});$('#qualityInfo').value=m.qualityInfo;paintQualityInfo();document.querySelectorAll('[data-mother]').forEach(x=>x.value=m.mother[x.dataset.mother]||'');$('#motherOriginalWidth').textContent=fmtDim(b.originalWidth,1)||'－';updateMotherCalcLength();renderMeasureGrid();renderStats();setState('IndexedDB読込済み')
 {const mode=S.measure.settings.inputMode||'auto';document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x.dataset.mode===mode))}
 activateWorkspace(rightLayoutFor($('#measureType').value));
 applyInputProtection();
 updateReceiveState(document.activeElement===$('#deviceInput'));
 renderProductPanel();
 applyRightLayout();
 requestAnimationFrame(updateValidationVisuals);
 upgradeManualInputTypes();
 renderQualityGradePanel();
 bindInfoTabs();
 renderDataManagementPanel();
 renderResidualCourseEverywhere();
 renderCourseHierarchy();
 renderScheduleInfo();
 configureToleranceSelector();
 /* 既定のサブタブは**品質規格**。以前は`'worktime'`を指していたが、作業時間は
    ①の「準備の入力」へ移してサブタブから外れており、**どのタブにも当たらない
    値だったため`[data-leftpanel]`が全部隠れていた**（①の品質カードが空のまま
    出ていた原因。カードの器だけが残るので、レイアウトの不具合に見える）。 */
 /* 品質規格・品質情報は基本情報カードへ移した（§9.145）ので、ここが見るのは
    測定データ分析とデバッグ面だけ。**gradeという面はもう無い。** */
 document.querySelectorAll('[data-leftpanel]').forEach(x=>x.hidden=true);
 updateWorkTimePanel();
 updateMeasurementHeading();
 /* マスタの差異の見張りを始める（§9.139）。開いているあいだだけ回り、
    閉じていれば`check()`が自分で降りる。 */
 try{WL.masterDiff.start()}catch(e){}
}
// Unified required/valid/NG visual language.
function hasValue(el){return String(el?.value??'').trim()!==''&&String(el?.value??'').trim()!=='-'}
function setVisualState(el,state){
 if(!el)return;el.classList.remove('validation-required','validation-valid','validation-ng');
 el.classList.add(state==='ng'?'validation-ng':state==='valid'?'validation-valid':'validation-required');
 el.setAttribute('aria-invalid',state==='valid'?'false':'true');
}
function activeRequiredControls(){
 const controls=[];
 ['operator','inspector'].forEach(id=>controls.push({el:$('#'+id),label:id==='operator'?'オペレータ':'検査員'}));
 const type=$('#measureType')?.value;
 /* 母材と丈は**同じ面にある**ので、必須も一緒に見る（§9.160。以前は
    項目が2つに割れており、片方を開かないともう片方の未入力に気づけなかった）。 */
 if(WL.measureItem.isMaterial(type)){
  document.querySelectorAll('[data-mother]').forEach((el,i)=>controls.push({el,label:['手計算','全長','MINカード指示','MAXカード指示','前オフ実績','後オフ実績','前オフカード指示','後オフカード指示'][i]||'母材'}));
  const fieldLabels={productLength:'長さ',wallThickness:'肉厚',edgeShape:'揃い(エッジ形状)'};
  /* **行番号で数えない**(§9.203)——内訳の段(`.prt-detail`)が挟まるので、
     `forEach`の添字は丈の番号と一致しない。`data-row`で引く。 */
  document.querySelectorAll('#productRowsBody tr').forEach(tr=>{
   const no=(+tr.dataset.row||0)+1;
   tr.querySelectorAll('[data-product-field]').forEach(el=>{const label=fieldLabels[el.dataset.productField];if(label)controls.push({el,label:`${label}(丈${no})`})});
  });
 }else{
  document.querySelectorAll('#measurementGrid input[data-mkey]').forEach(el=>{if(!el.closest('.inactive'))controls.push({el,label:`測定値 ${Number(el.dataset.j)+1}`})});
 }
 return controls.filter(x=>x.el);
}
function updateValidationVisuals(){
 const required=activeRequiredControls(),requiredSet=new Set(required.map(x=>x.el));
 document.querySelectorAll('.validation-required,.validation-valid,.validation-ng').forEach(el=>{if(!requiredSet.has(el))el.classList.remove('validation-required','validation-valid','validation-ng')});
 required.forEach(({el})=>{
  if(el.classList.contains('ng'))setVisualState(el,'ng');
  else setVisualState(el,hasValue(el)?'valid':'required');
 });
 const missing=required.filter(({el})=>!hasValue(el)),ng=required.filter(({el})=>el.classList.contains('ng'));
 const button=$('#complete');if(button){button.classList.toggle('validation-blocked',missing.length>0||ng.length>0);button.title=missing.length?`未入力 ${missing.length}件`:ng.length?`公差外 ${ng.length}件`:'完了できます'}
 return{missing,ng};
}
function showValidationMessage(result){
 document.querySelectorAll('.validation-message').forEach(x=>x.remove());
 const target=$('.center-pane'),message=document.createElement('div');message.className='validation-message';
 const missingNames=[...new Set(result.missing.map(x=>x.label))];
 message.textContent=result.ng.length?`完了できません。未入力 ${result.missing.length}件、公差外 ${result.ng.length}件を確認してください。`:`完了できません。未入力項目を確認してください: ${missingNames.slice(0,6).join('、')}${missingNames.length>6?' ほか':''}`;
 target.prepend(message);result.missing[0]?.el?.focus();
}
function judgeInput(el,key,value,index){
 el.classList.remove('ng','complete');
 if(key==='flatness'){
  if(String(el.value||'').trim()!=='')el.classList.add('complete');
  return;
 }
 const raw=String(el.value??'').trim(),tol=toleranceFor(key==='thickness'?'thickness':'width',index),num=Number(raw);
 if(raw!==''&&Number.isFinite(num)){el.classList.add('complete');if(tol&&(num<tol[0]||num>tol[1]))el.classList.add('ng')}
}
document.addEventListener('input',event=>{if(event.target.matches('input,select,textarea'))updateValidationVisuals()},true);
document.addEventListener('change',event=>{if(event.target.matches('input,select,textarea'))updateValidationVisuals()},true);
// Information architecture: basic / quality grade / data management.
const qualityGradeFields=[
 ['生地外観',['生地外観','品質等級_生地外観','QCD1','RQCD1']],['フラットネス',['フラットネス等級','品質等級_フラットネス','QCD2','RQCD2']],
 ['付着油',['付着油','品質等級_付着油','QCD3','RQCD3']],['切断面',['切断面','品質等級_切断面','QCD4','RQCD4']],
 ['板厚公差',['板厚公差等級','品質等級_板厚公差','QCD5','RQCD5']],['幅丈公差',['幅丈公差','巾丈公差','品質等級_幅丈公差','QCD6','RQCD6']],
 ['ラテラルボー',['ラテラルボー等級','品質等級_ラテラルボー','QCD7','RQCD7']],['直角度',['直角度','品質等級_直角度','QCD8','RQCD8']],
 ['方向性',['方向性','品質等級_方向性','QCD9','RQCD9']],['強度',['強度','品質等級_強度','QCD10','RQCD10']],
 ['アルマイト',['アルマイト','品質等級_アルマイト','QCD11','RQCD11']],['表面処理',['表面処理','品質等級_表面処理','QCD15','RQCD15']]
];
function hydrateBusinessFields(){
 if(!S.measure)return;const b=S.measure.basic||(S.measure.basic={}),r=S.measure.source||S.measure.snapshot?.source||{};
 const extra={
  customer:['取引先','取引先名','得意先','得意先名','TOKUNA','TOKU_NA'],delivery:['納入先','納入先名','受渡先','NONNA','NON_NA'],
  course:['実績コース','実績設備コース','実績設備ｺｰｽ','設計コース','残仕掛設備コース','残仕掛設備ｺｰｽ','JBSMC','SBSMC','ZANMC'],
  orderNo:['オーダー番号','ｵｰﾀﾞｰ番号','受注番号','JUON','JUNO'],orderMaterial:['オーダー材質','ｵｰﾀﾞｰ材質','JUA'],orderTemper:['オーダー調質','ｵｰﾀﾞｰ調質','JUB'],
  orderThickness:['オーダー板厚','ｵｰﾀﾞｰ板厚','JUX'],orderWidth:['オーダー板幅','ｵｰﾀﾞｰ板幅','JUY'],orderLength:['オーダー板丈','ｵｰﾀﾞｰ板丈','JUZ']
 };
 Object.entries(extra).forEach(([k,names])=>{if(!b[k]){for(const n of names){if(r[n]!==undefined&&r[n]!==null&&String(r[n]).trim()!==''){b[k]=String(r[n]);break}}}})
 {const r=S.measure.source||S.measure.snapshot?.source||{};if(r['実績_設備ｺｰｽ']!==undefined&&r['実績_設備ｺｰｽ']!==null)S.measure.basic.course=String(r['実績_設備ｺｰｽ'])}
}
// Exact source fields requested by the operation database.
const QUALITY_GRADE_SOURCE={
 '生地外観':['品質ｸﾞﾚｰﾄﾞ_生地外観'],'フラットネス':['品質ｸﾞﾚｰﾄﾞ_ﾌﾗｯﾄﾈｽ','品質ｸﾞﾚｰﾄﾞ_フラットネス'],
 '付着油':['品質ｸﾞﾚｰﾄﾞ_付着油'],'切断面':['品質ｸﾞﾚｰﾄﾞ_切断面'],'板厚公差':['品質ｸﾞﾚｰﾄﾞ_板厚公差'],
 '幅丈公差':['品質ｸﾞﾚｰﾄﾞ_幅丈公差','品質ｸﾞﾚｰﾄﾞ_巾丈公差'],'ラテラルボー':['品質ｸﾞﾚｰﾄﾞ_ﾗﾃﾗﾙﾎﾞｰ','品質ｸﾞﾚｰﾄﾞ_ラテラルボー'],
 '直角度':['品質ｸﾞﾚｰﾄﾞ_直角度'],'方向性':['品質ｸﾞﾚｰﾄﾞ_方向性'],'強度':['品質ｸﾞﾚｰﾄﾞ_強度'],
 'アルマイト':['品質ｸﾞﾚｰﾄﾞ_ｱﾙﾏｲﾄ','品質ｸﾞﾚｰﾄﾞ_アルマイト'],'表面処理':['品質ｸﾞﾚｰﾄﾞ_表面処理']
};
/* 品質規格は**基本情報の詳細の中の1つの群**（§9.154、利用者の指示）。
   §9.133では4×3の表でタブの裏に置いていたが、
   - 「基本情報」カードの中に「基本情報」タブがあるのが冗長
   - 見出し列を`width:11%`で決め打ちしていたため「ラテラルボー」
     「アルマイト」「表面処理」が省略記号で切れていた（実機で報告）
   の2つがあった。**他の詳細項目と同じ「ラベル＋値」の行**にすれば、
   ラベルは中身なりの幅を取るので切れず、タブも要らない。
   **重要度は低い**（測定中に見る値ではない）ので詳細の中＝畳んだ側に置く
   ——場所を取らせない代わりに、1回の操作で必ず出せる。 */
function renderQualityGradePanel(){
 const host=$('#qualityGradeFields');
 const m=S.measure;m.qualityGrades=m.qualityGrades||{};
 Object.entries(QUALITY_GRADE_SOURCE).forEach(([label,names])=>m.qualityGrades[label]=sourceValue(names));
 if(!host)return;
 host.innerHTML=Object.keys(QUALITY_GRADE_SOURCE).map(label=>{
  const v=m.qualityGrades[label]||'';
  return `<div class="field"><label>${esc(label)}</label>`
   +`<output title="${esc(v)}">${esc(v)||'—'}</output></div>`;
 }).join('');
}
function renderDataManagementPanel(){
 const panel=$('#dataManagementPanel');if(!panel)return;hydrateBusinessFields();const b=S.measure.basic;
 const rows=[['取引先',b.customer],['納入先',b.delivery],['実績コース',b.course],['オーダー番号',b.orderNo],['オーダー材質',b.orderMaterial],['オーダー調質',b.orderTemper],['オーダー板厚',b.orderThickness],['オーダー板幅',b.orderWidth],['オーダー板丈',b.orderLength]];
 panel.innerHTML=`<div class="data-management-grid">${rows.map(([l,v])=>`<b>${esc(l)}</b><span title="${esc(v||'')}">${esc(v||'未設定')}</span>`).join('')}</div>`;
 {const panel=$('#dataManagementPanel'),r=S.measure?.source||S.measure?.snapshot?.source||{};
 if(!panel)return;const grid=panel.querySelector('.data-management-grid');if(!grid)return;
 const residual=Object.entries(r).find(([k])=>normalizedFieldName(k)===normalizedFieldName('残仕掛設備ｺｰｽ'))?.[1]??'';
 const children=[...grid.children],actualIndex=children.findIndex(x=>x.tagName==='B'&&x.textContent==='実績コース'),ref=actualIndex>=0?children[actualIndex+1]:null;
 const label=document.createElement('b');label.textContent='残コース';const value=document.createElement('span');value.textContent=String(residual||'未設定');value.title=String(residual||'');
 if(ref){ref.after(label,value)}else grid.append(label,value);
 }
}
/* 基本情報カードのタブ（§9.145）。品質規格は「測る前に1回だけ確かめる」もので、
   マスを1つ使うほどではないが1回の操作で必ず出せる場所に置く。
   **`onclick`を毎回張り直す**（`renderMeasurement`のたびに呼ばれる）。 */
/* 基本情報カードのタブ（基本情報／品質規格）は廃止した（§9.154、利用者の
   指示）。「基本情報」カードの中に「基本情報」タブがあるのは冗長で、
   品質規格は詳細の中の1つの群になった。**空の`bindBasicTabs()`を残さない**
   ——「まだタブがある」と読ませる。 */
/* ③の「記録した値」（§9.146、骨子§9.137の記録の壁4枚のうちの1枚）。
   **数字の要約は測定データ分析が持っている**ので、ここが受け持つのは
   「数値以外に何を残すか」——誰が測ったか・測定表の形・使う機材・
   その他の設定・母材の実測。同じ数字を2箇所に出さない（§9.129）。
   ①準備で決めた値をそのまま並べるので、完了前に**①へ戻らずに確かめられる**。 */
const RECORD_GROUPS=[
 ['誰が測ったか',[['operator','オペレータ'],['inspector','検査員'],['crewSize','人数']]],
 ['測定表の形',[['verticalCount','丈数'],['horizontalCount','条数']]],
 ['使う機材',[['innerDiameter','内径'],['spool','スプール'],['thicknessGauge','板厚計'],['widthGauge','板幅計']]],
 ['その他の設定',[['unwind','巻出方向'],['widthOrder','条入力順'],['widthDirection','方向'],['burr','バリ揃え'],['coilStop','コイル止め']]],
];
/* 母材の項目名は**画面のラベルから取る**（マスタでも定数でもない）。
   ここで別の名前を持つと、②で見た欄名と③の一覧で言葉が変わる。 */
function motherRecordRows(){
 const rows=[];
 [['motherOriginalWidth','元幅（実績）'],['motherScrapWidth','屑幅（両耳合計）']].forEach(([id,label])=>{
  const el=$('#'+id);if(el)rows.push([label,el.textContent]);
 });
 document.querySelectorAll('[data-mother]').forEach(el=>{
  const lab=el.closest('label');
  const name=lab?[...lab.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(''):'';
  rows.push([name||el.dataset.mother,el.value]);
 });
 return rows;
}
function renderRecordedValues(){
 const host=$('#recordedList');
 if(!host||!S.measure)return;
 const st=S.measure.settings||{};
 const shown=v=>{const s=String(v??'').trim();return s===''||s==='-'||s==='－'?'':s};
 const line=(l,v)=>`<div><dt>${esc(l)}</dt><dd>${esc(shown(v)||'—')}</dd></div>`;
 let h=RECORD_GROUPS.map(([title,items])=>
  `<div class="rv-group"><b>${esc(title)}</b><dl>`
  +items.map(([k,label])=>line(label,st[k])).join('')+'</dl></div>').join('');
 const mother=motherRecordRows().filter(([,v])=>shown(v));
 h+='<div class="rv-group"><b>母材</b>'
  +(mother.length?`<dl>${mother.map(([l,v])=>line(l,v)).join('')}</dl>`
   :'<p class="rv-empty">まだ入力がありません。</p>')+'</div>';
 if(host.innerHTML!==h)host.innerHTML=h;
}
/* 品質情報の見出しに**件数を文字で**添える（§9.144）。状態を色だけで伝えない。
   本文は`qualityText()`が`(1) …`の塊を空行で連ねたもので、件数はその印の数。
   **値は`.value`への代入で入るのでDOMは変わらない**（§9.130と同じ）——
   代入した側が呼ぶ。**呼ぶのは2箇所**（開いたとき／共有DBから読んだとき）。 */
function paintQualityInfo(){
 const box=document.querySelector('.quality-info-block'),badge=$('#qualityInfoBadge'),ta=$('#qualityInfo');
 if(!box||!badge||!ta)return;
 const n=(String(ta.value||'').match(/^\(\d+\)/gm)||[]).length;
 badge.textContent=n?`異常 ${n}件`:'異常なし';
 badge.classList.toggle('qi-some',!!n);
 badge.classList.toggle('qi-none',!n);
 box.classList.toggle('qi-has',!!n);
}
function bindInfoTabs(){document.querySelectorAll('[data-infotab]').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('[data-infotab]').forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll('[data-infopanel]').forEach(p=>p.hidden=p.dataset.infopanel!==btn.dataset.infotab)})}
function upgradeManualInputTypes(){
 document.querySelectorAll('input[data-mother],input[data-product-field]').forEach(el=>{
  if(el.type==='number'){
   el.step='any';
   el.inputMode='decimal';
   el.classList.add('numeric-input');
   el.classList.remove('text-input');
  }else{
   el.classList.add('text-input');
   el.classList.remove('numeric-input');
  }
 });
}
function renderResidualCourseEverywhere(){
 if(!S.measure)return;const residual=sourceField(['残仕掛設備ｺｰｽ','残仕掛設備コース']);S.measure.basic.residualCourse=residual;
 const basic=$('#basicDetail')||$('#basicInfo .info-grid');if(basic){basic.querySelectorAll('.residual-course-field').forEach(x=>x.remove());const course=[...basic.querySelectorAll('.field')].find(x=>x.querySelector('label')?.textContent==='実績');const item=document.createElement('div');item.className='field residual-course-field';item.innerHTML=`<label>残</label><output title="${esc(residual)}">${esc(residual||'未設定')}</output>`;if(course)course.after(item);else basic.append(item)}
 const grid=$('#dataManagementPanel .data-management-grid');if(grid){[...grid.querySelectorAll('[data-residual-course]')].forEach(x=>x.remove());const children=[...grid.children],courseIndex=children.findIndex(x=>x.tagName==='B'&&x.textContent==='実績コース'),courseValue=courseIndex>=0?children[courseIndex+1]:null,label=document.createElement('b'),value=document.createElement('span');label.textContent='残コース';value.textContent=residual||'未設定';value.title=residual;label.dataset.residualCourse='1';value.dataset.residualCourse='1';if(courseValue)courseValue.after(label,value);else grid.append(label,value)}
}
/* 公差の内訳(基準値・±・計算式)を見出し領域へ表示する。 */
function updateMeasurementHeading(){
 /* カードの名前は骨子どおり「測定」。**項目名は表の見出しが言っている**ので
    ここでは繰り返さない（§9.129。以前は上が「板幅測定」下が「板幅」だった）。 */
 const type=$('#measureType').value;$('#measurePanelTitle').textContent='測定';
 if(type==='フラットネス'){$('#toleranceSummary').innerHTML='<div class="tol-status no-data"><b>判定基準</b><span>〇＝OK　△・×＝NG　条ごとに記号を入力してください。</span></div>';return}
 const kind=WL.measureItem.kindOf(type),detail=toleranceDetail(kind),base=Number(kind==='thickness'?S.measure.basic.mfgThickness:S.measure.basic.mfgWidth);
 if(!detail){$('#toleranceSummary').innerHTML='<div class="tol-status no-data"><b>公差情報なし</b><span>選択した公差区分に使用可能なプラス・マイナス値がありません。</span></div>';return}
 const labels={manufacturing:'製造公差',order:'オーダー公差',instruction:'指示公差'},sourceLabel=labels[detail.source],requestedLabel=labels[configuredToleranceSource()],fallback=detail.fallback?`${requestedLabel}が不足しているため製造公差を使用`:'';
 $('#toleranceSummary').innerHTML=`<div class="tol-source-row"><span class="tolerance-source-badge ${detail.source==='order'?'order':''}">${sourceLabel}</span>${fallback?`<span class="tol-fallback">${esc(fallback)}</span>`:''}</div><div class="tol-facts"><div><small>基準値</small><b>${base}</b></div><div><small>公差 ＋</small><b>+${detail.plus}</b><em>${esc(detail.plusKey)}</em></div><div><small>公差 －</small><b>-${detail.minus}</b><em>${esc(detail.minusKey)}</em></div><div class="tol-result"><small>判定範囲</small><b>${detail.range[0]} ～ ${detail.range[1]}</b></div></div><div class="tol-formula">計算: ${base} - ${detail.minus} = ${detail.range[0]} ／ ${base} + ${detail.plus} = ${detail.range[1]}</div>`;
}
// Design, actual and residual courses are rendered as one ordered information group.
function renderCourseHierarchy(){
 if(!S.measure)return;const design=designCourseValue(),actual=actualCourseValue(),residual=residualCourseValue();S.measure.basic.designCourse=design;S.measure.basic.course=actual;S.measure.basic.residualCourse=residual;
 const basic=$('#basicDetail')||$('#basicInfo .info-grid');if(basic){[...basic.querySelectorAll('.course-stack-field,.residual-course-field')].forEach(x=>x.remove());const old=[...basic.querySelectorAll('.field')].find(x=>x.querySelector('label')?.textContent==='実績コース');if(old)old.remove();
  /* コースは「設計→実績→残」の順に意味がつながる1かたまり(§9.55)。
     コース見出しの直後へこの順で並べる。**3項目とも縦に1行ずつ**で、
     横幅はエリアいっぱい(全幅・折り返し)——実機のコースは
     「3文字+空白」×25程度まで伸びるので、2列の半分では平均的な長さすら
     入らない。幅の確保はCSS(.course-stack-field)側で行うため、ここでは
     長さを測って出し分けることはしない(短いときだけ2列へ戻ると、行の位置が
     ロットごとに動いて読み取りにくかった)。 */
  const anchor=basic.querySelector('.info-group-course')||[...basic.querySelectorAll('.field')].find(x=>x.querySelector('label')?.textContent==='納入先');
  /* ラベルは「設計」「実績」「残」だけにする。**すぐ上に「コース」という
     見出しが出ている**ので、各行に「コース」を繰り返すのは冗長で、その
     ぶん値へ渡せる横幅が減っていた(実機のコースは長い)。
     短くすると3つとも同じ文字数になり、値の開始位置も自然に揃う
     (以前は「設計コース」5文字と「残コース」4文字で14pxずれていた)。 */
  [['設計',design],['実績',actual],['残',residual]].forEach(([label,value])=>{const item=document.createElement('div');item.className='field course-stack-field';item.innerHTML=`<label>${label}</label><output title="${esc(value)}">${esc(value||'未設定')}</output>`;if(anchor){const prior=[...basic.querySelectorAll('.course-stack-field')].at(-1);(prior||anchor).after(item)}else basic.append(item)})
 }
 const grid=$('#dataManagementPanel .data-management-grid');if(grid){const pairs=[];for(let i=0;i<grid.children.length;i+=2)pairs.push([grid.children[i]?.textContent,grid.children[i+1]?.textContent]);const keep=pairs.filter(([label])=>!['設計コース','実績コース','残コース'].includes(label));const insertAt=Math.max(0,keep.findIndex(([label])=>label==='オーダー番号'));keep.splice(insertAt,0,['設計コース',design||'未設定'],['実績コース',actual||'未設定'],['残コース',residual||'未設定']);grid.innerHTML=keep.map(([label,value])=>`<b>${esc(label||'')}</b><span title="${esc(value||'')}">${esc(value||'未設定')}</span>`).join('')}
 updateCourseGuard();
}
/* ---------- 作業スケジュールとの連携(読み取りのみ、docs/SCHEDULE_MODE_DESIGN.md §9.7) ----------
   測定画面を開いたロットが作業予定に含まれていれば、基本情報タブへ
   「予定 2番目 / 予定開始 11:44 / 見積 2時間32分」の1行を出す。書き込みは
   行わない(進捗は§7.4の実績突合で自動反映される)。取得はopenMeasurement()の
   finally(CLAUDE.mdの既知の落とし穴どおり)で1回だけ行い、結果はモジュール内
   変数へキャッシュする(renderMeasurement()のたびに毎回問い合わせない)。 */
let scheduleInfoCache=null;
function scheduleMinutesLabel(min){
 if(min===null||min===undefined)return '-';
 const v=Math.round(min);
 if(v<60)return `${v}分`;
 return `${Math.floor(v/60)}時間${v%60?(v%60)+'分':''}`;
}
function renderScheduleInfo(){
 const basic=$('#basicDetail')||$('#basicInfo .info-grid');if(!basic)return;
 basic.querySelectorAll('.schedule-info-field').forEach(x=>x.remove());
 const lotNo=S.measure?.basic?.lotNo;
 if(!lotNo||!scheduleInfoCache||normalizedLot(scheduleInfoCache.lotNo)!==normalizedLot(lotNo))return;
 const anchor=[...basic.querySelectorAll('.field')].find(x=>x.querySelector('label')?.textContent==='ロット№');
 const item=document.createElement('div');
 item.className='field full schedule-info-field';
 item.innerHTML=`<label>作業予定</label><output>予定 ${scheduleInfoCache.position}番目 / 予定開始 ${esc(scheduleInfoCache.startText)} / 見積 ${esc(scheduleInfoCache.minutesText)}</output>`;
 if(anchor)anchor.after(item);else basic.prepend(item);
}
async function refreshScheduleInfo(){
 scheduleInfoCache=null;
 const lotNo=S.measure?.basic?.lotNo,equipment=typeof currentConfiguredEquipment==='function'?currentConfiguredEquipment():'';
 if(lotNo&&equipment){
  try{
   const r=await api('/api/schedule/plan?equipment='+encodeURIComponent(equipment));
   if(r&&r.configured&&Array.isArray(r.entries)){
    const active=r.entries.filter(e=>e.state!=='完了'&&e.state!=='取消');
    const idx=active.findIndex(e=>normalizedLot(e.lotNo)===normalizedLot(lotNo));
    if(idx>=0){
     const entry=active[idx];
     scheduleInfoCache={lotNo,position:idx+1,
      startText:entry.plannedStart?new Date(entry.plannedStart).toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'未定',
      minutesText:scheduleMinutesLabel(entry.estimate?.minutes)};
    }
   }
  }catch(e){/* 補助表示のためベストエフォート。未設定・取得失敗時は単に出さない */}
 }
 renderScheduleInfo();
}
function configureToleranceSelector(){const el=$('#toleranceSource');if(!el||!S.measure)return;const type=$('#measureType').value,isDimensional=WL.measureItem.isDimensional(type),order=el.querySelector('option[value="order"]'),availability=orderToleranceAvailability();order.disabled=!availability.available;order.textContent=availability.available?'オーダー公差':'オーダー公差（データなし）';order.classList.toggle('order-tolerance-unavailable',!availability.available);if(!availability.available&&S.measure.settings.toleranceSource==='order')S.measure.settings.toleranceSource='manufacturing';el.value=S.measure.settings.toleranceSource||'manufacturing';el.disabled=!isDimensional;el.title=isDimensional?(availability.available?'製造公差またはオーダー公差を選択できます':'オーダー公差がないため製造公差のみ使用できます'):'板厚・板幅以外は指示公差を自動適用します';
 /* **選べるときだけ出す**（§9.143、利用者の指示）。通常は製造公差のままで
    触ることがなく、選択肢が1つしか無い状態で常設すると「選ぶもの」に
    見えてしまう（機能としては残す必要があるので、消すのではなく隠す）。
    出す段は②③だけ——そちらはCSSが持つ。 */
 /* **選べるときも、開くまでは出さない**（§9.159、利用者の指示「測定公差
    切り替えプルダウンは折りたたんで通常非表示に」）。既定は製造公差のままで
    ほぼ触らないのに、測定中いちばん見る帯に選択欄が常設されていた。
    いま効いている公差は**ヘッダーの文脈バー**が「判定公差 製造公差」と
    常に言っているので、ここに要るのは「変えたいときの入口」だけ。
    **消さずに畳む**——切り替え自体は業務で必要な操作なので、
    1回押せば必ず出せる場所に残す。 */
 {const box=el.closest('.tolerance-source-control'),pick=$('#toleranceSourcePick'),fold=$('#tolSourceFold');
  if(box){const usable=isDimensional&&availability.available;if(box.hidden!==!usable)box.hidden=!usable;
   if(!usable&&pick&&!pick.hidden){pick.hidden=true;fold?.setAttribute('aria-expanded','false')}}}el.onchange=()=>{if(el.value==='order'&&!availability.available)return;S.measure.settings.toleranceSource=el.value;renderMeasureGrid();updateMeasurementHeading();markDirty()}}
/* 作業時間パネル。開始→終了の順序を強制するロック付き打刻。 */
function formatWorkTime(value){if(!value)return '';const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function stampWorkTimeLocked(kind){if(!S.measure)return;S.measure.workTime=S.measure.workTime||{};const now=new Date();if(kind==='start'){if(S.measure.workTime.endAt){showToast('開始時刻は変更できません','終了時刻の記録後は開始時刻を変更できません。');return}S.measure.workTime.startAt=now.toISOString()}else{if(!S.measure.workTime.startAt){showToast('開始時刻が未記録です','先に開始時刻を記録してください。');return}if(now<new Date(S.measure.workTime.startAt)){showToast('終了時刻を記録できません','終了時刻は開始時刻より後である必要があります。');return}S.measure.workTime.endAt=now.toISOString()}updateWorkTimePanel();markDirty();updateValidationVisuals()}
function updateWorkTimePanel(){if(!S.measure)return;S.measure.workTime=S.measure.workTime||{startAt:'',endAt:''};const start=$('#workStartAt'),end=$('#workEndAt');if(!start||!end)return;start.dataset.iso=S.measure.workTime.startAt||'';end.dataset.iso=S.measure.workTime.endAt||'';start.value=formatWorkTime(start.dataset.iso);end.value=formatWorkTime(end.dataset.iso);$('#stampWorkStart').disabled=!!S.measure.workTime.startAt;$('#stampWorkEnd').disabled=!S.measure.workTime.startAt||!!S.measure.workTime.endAt;[[ $('#workStartCard'),start.dataset.iso],[ $('#workEndCard'),end.dataset.iso]].forEach(([card,value])=>{card?.classList.toggle('validation-required',!value);card?.classList.toggle('validation-valid',!!value)});$('#workDuration').textContent=S.measure.workTime.endAt?`実作業時間 ${formatDuration(durationMs(S.measure))}`:S.measure.workTime.startAt?'作業中':'未計測';$('#stampWorkStart').onclick=()=>stampWorkTimeLocked('start');$('#stampWorkEnd').onclick=()=>stampWorkTimeLocked('end')}
document.querySelectorAll('[data-worktab]').forEach(b=>b.onclick=()=>activateWorkspace(b.dataset.worktab));
bindTabs('left','left');
/* ---------- マスタの差異はバッジで知らせる（§9.139） ----------
   利用者の指示「マスタ再読込ボタンは、バックグラウンドで差異が見られた
   場合にのみ、各入力内容ごとにバッジで出す」。常設のボタンは**押す理由が
   分からない**（押しても何も変わらないことがほとんどで、変わったときだけ
   意味がある）。裏で選択肢を突き合わせ、**変わった欄にだけ**印を出す。
   印を押すとその場で取り込む。**取りに行けなかったときは黙る**——
   知らせようがないので、出せない印を出さない。 */
WL.masterDiff=(function(){
 /* 見る欄と、応答のどのキーが対応するか。ここ1箇所（散らすと片方だけ
    見張っている状態が簡単にできる）。 */
 const FIELDS=[['operator','operators'],['inspector','inspectors'],
   ['thicknessGauge','thickness_gauges'],['widthGauge','width_gauges'],
   ['innerDiameter','inner_diameters'],['spool','spools']];
 const CHECK_MS=120000;
 let timer=null;
 const listOf=id=>[...($('#'+id)?.options||[])].map(o=>o.value).filter(v=>v!=='-');
 function mark(id,on){
  const box=document.querySelector(`.selectors [data-f="${id}"]`);
  if(!box)return;
  box.classList.toggle('has-master-diff',!!on);
  let b=box.querySelector('.master-diff-badge');
  if(on&&!b){
   b=document.createElement('button');
   b.type='button';b.className='master-diff-badge';b.textContent='更新あり';
   b.title='マスタの選択肢が変わりました。押すと取り込みます。';
   b.onclick=async e=>{e.preventDefault();await loadMeasurementContext(true);check()};
   box.append(b);
  }else if(!on&&b)b.remove();
 }
 async function check(){
  const m=S.measure;if(!m||document.querySelector('#measureModal')?.hidden)return;
  let x=null;
  try{
   const u=new URLSearchParams({lot:m.basic.lotNo,equipment:currentConfiguredEquipment()||m.basic.equipment});
   x=await api('/api/measurement/context?'+u);
  }catch(e){return}   /* 取りに行けなかった＝差異は分からない。黙る。 */
  if(!x)return;
  FIELDS.forEach(([id,key])=>{
   const fresh=[...new Set((key==='inspectors'?(x.inspectors||x.operators):x[key])||[])].map(String);
   if(!fresh.length)return;   /* 空の応答で「全部消えた」と誤解しない。 */
   const now=listOf(id);
   mark(id,fresh.length!==now.length||fresh.some(v=>!now.includes(v)));
  });
 }
 function start(){stop();timer=setInterval(()=>{check().catch(()=>{})},CHECK_MS)}
 function stop(){if(timer){clearInterval(timer);timer=null}
  FIELDS.forEach(([id])=>mark(id,false))}
 return{check,start,stop};
})();
$('#verticalCount').addEventListener('change',()=>{updateLengthOptions($('#verticalCount').value);renderMeasureGrid()});
$('#horizontalCount').addEventListener('change',()=>{
 /* 設備ごとの最大条数を超えた入力はその場で戻す。max属性だけだとスピナーは
    止まるが、手打ち・貼り付けは通ってしまう。 */
 const el=$('#horizontalCount'),max=currentMaxStrips();
 if(Number(el.value)>max){
  el.value=String(max);
  showToast?.('条数を上限に合わせました',`この設備で割れるのは最大${max}条です。`,4000);
 }
 updateCoilOptions(el.value);renderMeasureGrid();
});
function lockCounts(){const has=Object.values(S.measure.measurements).some(a=>a.flat().some(v=>v!==''));$('#verticalCount').disabled=has;$('#horizontalCount').disabled=has}
