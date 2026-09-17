/* measure-view.js: 測定画面の構成 — データ形状(ensureMeasureShape/collect)、
   画面全体の描画(renderMeasurement)、左右パネル、入力検証、作業時間、公差表示の見出し。
   **このファイルは閉じている**（§9.359・REVIEW 3-17）——外へ出す面は末尾の
   `WL.measureView`。 */
(function(){
"use strict";
/* 入力内容の素性を決めるのは**ここ1箇所**（§9.138）。以前は
   `type==='板厚/板幅'`という文字列比較が6ファイル・十数箇所に散っており、
   項目を「板厚」「板幅」の2つへ分けるだけで**片方だけ直った状態**が簡単に
   できてしまう（公差の出どころ・幅分割公差・自動転送の固定・帳票の節・
   入力欄の数——どれか1つ落とすと、そこだけ黙って別の項目の公差で判定する）。
   §9.125で`WL.measureInput.toleranceDetail`の第3引数を3ファイルへ通し忘れて偽の公差外を
   出したのと同じ壊れ方なので、判定は関数にして散らさない。 */
WL.measureItem={
 /* 保存済みレコードが持つ旧名。選択肢から消えた値をそのまま`select.value`へ
    入れると**空文字になる**（＝どの項目でもない状態で開く）ので、読み込む
    時点で今の名前へ寄せる。板幅が条ごと・板厚が丈ごとなので、旧名は
    「条ごと」側＝板幅として開く。 */
 LEGACY:'板厚/板幅',
 /* **「母材」と「丈毎」は別々の項目**（§9.391、利用者の指示「母材と丈毎を
    入力内容の項目が一緒になっていますが、ボタンを分けて1枚のカードに
    配置するように変更してください」）。§9.160で1つにまとめていたが、
    2枚のカードが縦に積まれるため**どちらも半分の高さしか使えず**、
    丈が多いロットでは丈ごとの表が先に潰れていた。項目を分ければ、
    選んだ側が**面いっぱいの1枚**になる（§CLAUDE 1「面積は頻度×重要度」）。

    保存済みレコードは旧名を持つので、読み込む時点で今の名前へ寄せる
    （選択肢に無い値を`select.value`へ入れると空文字＝どの項目でもない
    状態で開く。`LEGACY`と同じ扱い）。**まとめていた頃の`母材/丈毎`は
    「母材」へ寄せる**——先に入れる側なので、開いた人が次にすることが
    変わらない。 */
 MATERIAL:'母材',
 PIECE:'丈毎',
 /* **入力内容の顔ぶれは、ここ1箇所**（並びは画面の`#measureType`と同じ）。
    以前はマスタ側（「開く条件」の札）が`#measureType`のDOMを読んでいたが、
    設備ごとに項目を伏せられるようになると（§9.392）、**伏せた項目を
    条件に選べなくなる**——マスタは全部の語彙を見て決めるものなので、
    画面に出ている顔ぶれとは別に持つ。 */
 ALL:['母材','丈毎','板厚','板幅','ラテラルボー','バリ','テレスコープ','巻ずれ','フラットネス'],
 LEGACY_MATERIAL:['母材/丈毎','母材・揃い/肉厚/長さ'],
 LEGACY_PIECE:['揃い/肉厚/長さ'],
 /* 旧名（母材/丈毎／板厚/板幅）も残す——保存済みレコードを開いた瞬間に
    `WL.measureInput.activeMeasureKey()`の答えが変わらないようにするため。 */
 KEYS:{母材:'mother',丈毎:'piece','母材/丈毎':'mother','母材・揃い/肉厚/長さ':'mother',
  '揃い/肉厚/長さ':'piece',板厚:'thickness',板幅:'width',
  ラテラルボー:'lateral',バリ:'burr',
  テレスコープ:'telescope',巻ずれ:'offset',フラットネス:'flatness','板厚/板幅':'width'},
 normalize(type){const t=String(type??'');
  if(t===this.LEGACY)return '板幅';
  if(this.LEGACY_MATERIAL.indexOf(t)>=0)return this.MATERIAL;
  return this.LEGACY_PIECE.indexOf(t)>=0?this.PIECE:t;},
 /* 母材の面（ロットに1つ）か。 */
 isMother(type){return this.normalize(type??this.current())===this.MATERIAL},
 /* 丈毎の面（縦割りした丈 1〜N）か。 */
 isPiece(type){return this.normalize(type??this.current())===this.PIECE},
 /* 手入力の面（母材・丈毎のどちらか）か。**測定器から受けない面**を
    ひとまとめに聞きたいところだけが使う（入力欄の保護・案内の札）。 */
 isMaterial(type){const t=type??this.current();return this.isMother(t)||this.isPiece(t)},
 /* 板厚・板幅か（＝製造/オーダー公差を選べる寸法系か）。 */
 isDimensional(type){const t=String(type??'');return t==='板厚'||t==='板幅'||t===this.LEGACY},
 /* ---------- 「公差」と「基準」を言い分ける（§9.242 ⑤、利用者の指示） ----------
    「板厚、板幅は公差ですが、ラテラルボーやバリ、テレスコープ、巻ズレ、
     フラットネスなどは公差ではなく『基準』なので名称を変更し違和感の
     ないようにしてください。公差は上下限があります」

    **公差＝上下限を持つもの**。板厚・板幅は基準値の上下へ±で振れてよい
    範囲があるが、ラテラルボー・バリ・テレスコープ・巻ずれ・フラットネスは
    「これ以下」という片側の目標しか無い——同じ言葉で呼ぶと、上限しか無い
    項目に下限があるかのように読める。
    **判定は`isDimensional()`の1箇所に乗せる**（項目名の一覧をもう1つ
    作らない。§9.138で文字列比較を散らして壊した形をくり返さない）。 */
 limitWord(type){return this.isDimensional(type??this.current())?'公差':'基準'},
 /* 判定の材料（`WL.measureInput.toleranceDetail()`の戻り）から決める版。片側だけの指示値
    （`single`）は項目名に関わらず基準。**materialは判定そのものが無い**ので
    呼ばれない。 */
 limitWordOf(detail,type){return (detail&&detail.single)?'基準':this.limitWord(type)},
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
/* ---------- 内径の初期値は仕掛から(§9.204、利用者の指示) ----------
   「準備」の内径に、仕掛データの「ｺｲﾙ_内径目標」を読み、**0より大きい
   数値が入っていればプリセットとして読み込む**。
    ・**空欄・0・数字でないものは使わない**（`Number('')`は0。屑幅・母材の
      計算全長で同じ罠を踏んでいる）。
    ・**新規に開いたときだけ**効かせる（`blankMeasure`）。保存済みレコードは
      `settings`を持つので、開き直しても選び直した値が上書きされない。
    ・**マスタに無くても選べるようにする**——内径種別マスタが空の現場が
      あり、`optionFill`は候補に無い現在値を黙って捨てる。候補へ足すのは
      `applyContextSnapshot`側（records-store.js）。 */
const INNER_DIAMETER_SOURCE=['ｺｲﾙ_内径目標','コイル_内径目標'];
/* 使える形かを見るのは1箇所。**空欄・0以下・数字でないものは使わない**。 */
function innerDiameterOf(raw){
 const t=String(raw||'').trim();
 if(!t)return '';
 const n=Number(t);
 if(!Number.isFinite(n)||!(n>0))return '';
 /* 選択肢は文字列で照合するので、末尾の0は落とす（'508.0'は'508'）。 */
 return String(n);
}
/* 行を渡せばその行だけ、渡さなければ**開いている測定の文脈すべて**
   （`S.current`・`source`・スナップショット）から探す。後者が要るのは、
   仕掛の完全な行が後から`S.measure.source`へマージされるため
   （`refreshSelfSourceFull`。一覧の行には列が無いことがある）。 */
function innerDiameterPreset(row){
 return innerDiameterOf(row&&typeof row==='object'
   ?WL.base.fieldFromRows([row],INNER_DIAMETER_SOURCE)
   :WL.base.sourceField(INNER_DIAMETER_SOURCE));
}
function defaultInnerDiameter(row){return innerDiameterPreset(row)||'-'}
/* 出どころを画面に書く(§6)。**同じ数字でも、目標値と選んだ値は別物**。 */
function updateInnerDiameterHint(){
 const el=$('#innerDiameter'),note=$('#innerDiameterFrom');
 if(!note)return;
 const preset=innerDiameterPreset();
 const cur=String(el?.value||'').trim();
 /* ---------- 添え書きの置き場（§9.233 ⑤、利用者の指示） ----------
    「こういった自動の連携内容の補助的な説明文字のONOFFができるように、
     もっとコンパクトにかつ位置も選べるようにしてほしいです」
    置き場は操業データ項目マスタの1列（欄の下／名前の横／出さない）。
    **答えるのはマスタを読んでいる`WL.opData`**——ここに判定を書くと、
    出どころのある項目が増えるたびに同じ判定が増える。
    **読めないうちは既定（欄の下）**＝今までの見え方。 */
 const at=(window.WL&&WL.opData&&WL.opData.sourceNotePlace)
   ?WL.opData.sourceNotePlace('innerDiameter'):'欄の下';
 const show=!!preset&&cur===preset&&at!=='出さない';
 if(note.hidden!==!show)note.hidden=!show;
 note.dataset.at=at;
 /* 器を置き直す。「名前の横」は`.opf-name`の中（`renameBuiltinLabel()`が
    組み込みの欄にも作る）、「欄の下」は`<label>`の末尾＝**器を被せた欄
    では器の下**（§9.233 ④と同じ基準）。 */
 const host=el&&el.closest('label');
 const nameBox=host&&host.querySelector(':scope>.opf-name');
 if(host&&show){
  const want=(at==='名前の横'&&nameBox)?nameBox:host;
  if(note.parentElement!==want)want.appendChild(note);
 }
 /* **印は移した側が付ける**（`:has()`に頼らない）。名前の器を横並びに
    するのは添え書きを入れたときだけ——素の名前は今までどおり折り返せる。 */
 if(nameBox)nameBox.classList.toggle('is-with-note',!!(show&&at==='名前の横'));
 /* **文は器（列1つぶん）に収まる長さにする**（§9.208 ①）。以前は
    「仕掛の「ｺｲﾙ_内径目標」508 から」と書いており、①準備の1列（実測124px）に
    対して143px——`<small>`が器より広くなると、`<label>`のフレックス行が
    その幅で組まれ、**内径の選択欄だけ19px広くなって隣のスプールへ7px
    重なっていた**（実機で「サイズがバラバラ・意図せず重なる」と報告）。
    出どころそのものは落とさず`title`へ回す（§6は「出どころを画面に出す」で
    あって、列の名前を全部書き写すことではない）。 */
 /* **コンパクトに**（§9.233 ⑤、利用者の指摘「不自然な改行なども入り込み
    表示のバランスを崩します」）。以前は`仕掛から 508`で、折り返しを許して
    いたため1列（実測124px）で2行になり、その行ぶん欄が下へずれていた。
    折り返さず、入らなければ省略記号——出どころそのものは`title`が持つ。 */
 note.textContent=show?`仕掛 ${preset}`:'';
 note.title=show?`仕掛データの「ｺｲﾙ_内径目標」${preset} を初期値として選んであります（選び直せます）。`:'';
}
/* 目標値を選択欄へ当てる。**まだ選び直していないときだけ**（'-'のまま）で、
   **選択肢に無ければ足してから**選ぶ（内径種別マスタが空の現場がある）。
   定義は1箇所——後追いで完全な仕掛行が届いたとき(lot-split.js)も、
   ここを通す。 */
function applyInnerDiameterPreset(row){
 if(!S.measure)return '';
 const preset=innerDiameterPreset(row||S.measure.source);
 if(!preset){updateInnerDiameterHint();return ''}
 if(String(S.measure.settings.innerDiameter||'-')!=='-'){updateInnerDiameterHint();return ''}
 S.measure.settings.innerDiameter=preset;
 const el=$('#innerDiameter');
 if(el){
  if(![...el.options].some(o=>o.value===preset))el.add(new Option(preset,preset));
  el.value=preset;
  /* 未選択の合図(SOFT_CHOICE)を消す。`el.value=`ではchangeが飛ばない。 */
  if(typeof updateSoftChoiceVisuals==='function')updateSoftChoiceVisuals();
 }
 updateInnerDiameterHint();
 return preset;
}
window.WL.innerDiameter={preset:innerDiameterPreset,apply:applyInnerDiameterPreset,refresh:updateInnerDiameterHint};
function blankMeasure(row){return{id:crypto.randomUUID(),status:'編集中',updatedAt:new Date().toISOString(),...measureStarter(),source:row,basic:Object.fromEntries(Object.keys(WL.base.aliases).map(k=>[k,pick(row,k)])),settings:{operator:'',inspector:'',lengthPos:'1(頭)',measureType:WL.measureItem.MATERIAL,verticalCount:defaultVerticalCount(row),horizontalCount:defaultHorizontalCount(row),unwind:'上出し',innerDiameter:defaultInnerDiameter(row),spool:'',thicknessGauge:'',widthGauge:'',widthOrder:'通常',widthDirection:'昇順',inputMode:'auto',tStep:0,wStep:0,burrFirst:null,ngCount:0,burr:'指定なし',coilStop:'指定なし',crewSize:''},mother:{},qualityInfo:'異常情報なし',measurements:{thickness:Array.from({length:WL.base.LENGTH_SLOTS},()=>Array(3).fill('')),width:Array.from({length:WL.base.LENGTH_SLOTS},()=>Array(40).fill('')),lateral:Array.from({length:WL.base.LENGTH_SLOTS},()=>Array(40).fill('')),burr:Array.from({length:WL.base.LENGTH_SLOTS},()=>Array(40).fill('')),telescope:Array.from({length:WL.base.LENGTH_SLOTS},()=>Array(40).fill('')),offset:Array.from({length:WL.base.LENGTH_SLOTS},()=>Array(40).fill('')),flatness:Array.from({length:WL.base.LENGTH_SLOTS},()=>Array(40).fill('')),comments:Array.from({length:WL.base.LENGTH_SLOTS},()=>Array(40).fill(''))}}}
/* 保存データ/新規データを最新スキーマへ整形する。旧実装は多層ラップ
   (基本形状→製品丈→登録設備→作業時間)だったものを一本化した。 */
function ensureMeasureShape(m){
 if(!m)return m;
 {
m.basic=m.basic||{};m.settings={operator:'',inspector:'',lengthPos:'1(頭)',measureType:WL.measureItem.MATERIAL,verticalCount:1,horizontalCount:1,unwind:'上出し',innerDiameter:'',spool:'',thicknessGauge:'',widthGauge:'',widthOrder:'通常',widthDirection:'昇順',inputMode:'auto',tStep:0,wStep:0,burrFirst:null,ngCount:0,burr:'指定なし',coilStop:'指定なし',...(m.settings||{})};
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
m.mother=m.mother||{};m.qualityInfo=m.qualityInfo||'異常情報なし';m.measurements=m.measurements||{};const shape=(name,width)=>{const src=Array.isArray(m.measurements[name])?m.measurements[name]:[];m.measurements[name]=Array.from({length:WL.base.LENGTH_SLOTS},(_,i)=>Array.from({length:width},(_,j)=>src[i]?.[j]??''))};shape('thickness',3);['width','lateral','burr','telescope','offset','flatness','comments'].forEach(k=>shape(k,40));
 }
 {
 if(!m.product||!Array.isArray(m.product.rows)){
  const legacy=m.product&&typeof m.product==='object'?m.product:null;
  m.product={rows:Array.from({length:WL.base.LENGTH_SLOTS},blankProductRow)};
  if(legacy&&(legacy.productLength||legacy.wallThickness||legacy.alignmentCode)){
   Object.assign(m.product.rows[0],{productLength:legacy.productLength||'',wallThickness:legacy.wallThickness||'',alignmentCode:legacy.alignmentCode||'',edgeShape:legacy.edgeShape||'',occurrencePosition:legacy.occurrencePosition||'',regularity:legacy.regularity||'',direction:legacy.direction||'',pitch:legacy.pitch||'',alignmentValue:legacy.alignmentValue||''});
  }
 }else if(m.product.rows.length<WL.base.LENGTH_SLOTS){
  while(m.product.rows.length<WL.base.LENGTH_SLOTS)m.product.rows.push(blankProductRow());
 }
 }
 m.settings.registeredEquipment=m.settings.registeredEquipment||m.registeredEquipment||m.snapshot?.registeredEquipment||'';
 m.workTime={startAt:'',endAt:'',...(m.workTime||{})};
 /* Accessへのバックアップ同期状態。status: 'synced'(直近の送信に成功)/
    'pending'(まだ送信していない、または未送信のまま作成された旧データ)/
    'failed'(直近の送信が失敗)。records-store.js の markSyncResult が
    WL.records.backupRecord() の成否に応じて更新する。旧データ(このフィールドが無い)は
    実際に送信できたか判定できないため安全側でpendingとし、再送の対象にする
    (backupRecordはDELETE+INSERTのため再送しても重複しない)。 */
 m.syncState={status:'pending',lastAttempt:'',lastError:'',attempts:0,...(m.syncState||{})};
 WL.measureHooks.run('shape',m);  // 拡張ファイルが持ち物を足す（§9.352）
 return m;
}
/* 画面の入力値をS.measureへ回収する。設定→母材→製品丈→登録設備→作業時間の順。 */
function collect(){
 // verticalCount/horizontalCountはdefaultVerticalCount/defaultHorizontalCountが
 // 数値で設定する項目のため、DOM値(常に文字列)を読み戻す際も数値へ揃える
 // (揃えないと、後続のリロード等を経ない一度目の保存でだけ文字列型のまま
 // 保存され、===比較箇所で不整合を起こし得る)。
 const m=S.measure;m.updatedAt=new Date().toISOString();['operator','inspector','lengthPos','measureType','verticalCount','horizontalCount','unwind','innerDiameter','spool','thicknessGauge','widthGauge','widthOrder','widthDirection','crewSize','burr','coilStop'].forEach(k=>{const el=$('#'+k);if(!el)return;m.settings[k]=(k==='verticalCount'||k==='horizontalCount')?(Number(el.value)||1):el.value});m.qualityInfo=$('#qualityInfo').value;document.querySelectorAll('[data-mother]').forEach(x=>m.mother[x.dataset.mother]=x.value);saveFlatComment();
 m.product=m.product&&Array.isArray(m.product.rows)?m.product:{rows:Array.from({length:WL.base.LENGTH_SLOTS},blankProductRow)};
 document.querySelectorAll('#productRowsBody tr').forEach(tr=>{
  const i=+tr.dataset.row,row=m.product.rows[i]=m.product.rows[i]||blankProductRow();
  tr.querySelectorAll('[data-product-field]').forEach(el=>row[el.dataset.productField]=el.value);
 });
 {const equipment=currentConfiguredEquipment();m.settings=m.settings||{};m.settings.registeredEquipment=equipment;m.registeredEquipment=equipment;m.snapshot=m.snapshot||{};m.snapshot.registeredEquipment=equipment}
 m.workTime=m.workTime||{};m.workTime.startAt=$('#workStartAt')?.dataset.iso||m.workTime.startAt||'';m.workTime.endAt=$('#workEndAt')?.dataset.iso||m.workTime.endAt||'';
 /* 操業データ（§9.215）。**項目は設備ごとのマスタが決める**ので、ここで
    項目名を並べない。打った時点でも`settings.opData`へ入れているが、
    取りこぼし防止にここでも回収する。 */
 if(window.WL&&WL.opData)WL.opData.collect();
 WL.measureHooks.run('collect',m);  // 拡張ファイルが回収した値へ足す（§9.352）
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
   値は`WL.base.sourceField()`で生の行から引く——`basic`は`WL.base.aliases`に載せた列しか
   持たず、ここで要る4つはそのうち板幅しか無い。 */
const MOTHER_CALC_FIELDS={thickness:['BOX実績_板厚'],width:['BOX実績_板幅'],
 density:['比重'],weight:['BOX実績_良品重量']};
function motherCalcLength(){
 /* 空欄を0と読まない（`Number('')`は0。屑幅で同じ罠を踏んでいる）。 */
 const num=names=>{const raw=String(WL.base.sourceField(names)||'').trim();
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
/* 面の呼び名 → 器（`data-workpanel`）。**母材と丈毎は同じ器を使う**
   （§9.391）——中で出す`.mat-block`が違うだけで、器を2つに割ると
   `.measure-shell.mstep-2`の割り付けも2箇所に増える。 */
const WORKPANEL_OF={mother:'material',piece:'material'};
function activateWorkspace(name){const panel=WORKPANEL_OF[name]||name;document.querySelectorAll('[data-worktab]').forEach(b=>b.classList.toggle('active',b.dataset.worktab===name||b.dataset.worktab===panel));document.querySelectorAll('[data-workpanel]').forEach(p=>p.hidden=p.dataset.workpanel!==panel)}
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
/* ---------- 母材の欄は打った時点でレコードへ入れる（§9.208 ②） ----------
   母材8欄は`collect()`＝**保存のときだけ**回収する作りだった。入力内容の
   「入力数」は`m.mother`から数える（`measure-progress.js`）ので、
   **8欄を全部埋めてもチップは 0/9 のまま**になっていた（実機で報告）。
   丈ごとの欄は打った時点で`m.product.rows`へ入るので、母材だけが
   揃っていなかった。**書き込みのキーは`collect()`と同じ**（`dataset.mother`）
   ——2通りの書き方を作ると、片方だけ直した状態ができる。 */
function bindMotherInputs(){
 if(typeof refreshMeasureProgress!=='function')
  console.error('母材の進捗更新: refreshMeasureProgress が見つかりません（measure-progress.js の読み込み順）');
 document.querySelectorAll('[data-mother]').forEach(el=>{
  if(el.dataset.motherBound)return;
  el.dataset.motherBound='1';
  const apply=()=>{
   if(!S.measure)return;
   S.measure.mother=S.measure.mother||{};
   S.measure.mother[el.dataset.mother]=el.value;
   updateMotherCalcLength();
   if(typeof refreshMeasureProgress==='function')refreshMeasureProgress();
   markDirty();
  };
  el.addEventListener('input',apply);
  el.addEventListener('change',apply);
 });
}
window.WL.motherInputs={bind:bindMotherInputs};
function rightLayoutFor(type){
 /* **母材と丈毎は別の面**（§9.391）——選んだ側だけを1枚のカードで出す。 */
 if(WL.measureItem.isMother(type))return 'mother';
 if(WL.measureItem.isPiece(type))return 'piece';
 return 'measure';
}
/* ---------- 設備で使わない入力内容を伏せる（§9.392、利用者の指示） ----------
   「測定画面の入力内容を、設備ごとに使う使わないと切り替えられるように」

   **伏せるかどうかの答えは`WL.measureReview.hiddenItems()`の1箇所**
   （設備マスタの設定 ＋ その記録に値が入っているか）。ここは並べるだけ。

   **選んでいた項目が伏せられたら、残っている先頭へ移す**——`select.value`へ
   候補に無い値を入れると空文字になり、**どの項目でもない状態**で開く
   （§9.204。`optionFill()`が候補に無い現在値を黙って捨てるのと同じ罠）。 */
function applyMeasureItemOptions(){
 const el=$('#measureType');if(!el)return;
 const all=WL.measureItem.ALL||[];
 const hidden=(WL.measureReview&&typeof WL.measureReview.hiddenItems==='function')
   ?WL.measureReview.hiddenItems():new Set();
 const show=all.filter(n=>!hidden.has(n));
 if(!show.length)return;   /* 全部伏せる設定は作れない（サーバーが断る）が、念のため */
 const now=WL.measureItem.normalize(el.value||S.measure?.settings?.measureType||'');
 const want=show.indexOf(now)>=0?now:show[0];
 /* **同じ顔ぶれなら作り直さない**——選択肢を毎回組み直すと、開いている
    リストのスクロール位置が先頭へ戻る。 */
 const cur=[...el.options].map(o=>o.text.trim()).join('/');
 if(cur!==show.join('/')){
  el.innerHTML=show.map(n=>`<option>${esc(n)}</option>`).join('');
  /* 器の高さは**選択肢の数ぶん**（§9.125）——7行固定だと空白が並ぶ。 */
  el.size=show.length;
 }
 if(el.value!==want){
  el.value=want;
  if(S.measure)S.measure.settings.measureType=want;
  el.dispatchEvent(new Event('change',{bubbles:true}));
 }else if(S.measure&&S.measure.settings.measureType!==want){
  S.measure.settings.measureType=want;
 }
}
function applyRightLayout(){
 if(!S.measure)return;
 const type=$('#measureType').value, layout=rightLayoutFor(type), pane=$('.right-pane');
 pane.classList.remove('layout-mother','layout-piece','layout-measure');
 pane.classList.add('layout-'+layout); activateWorkspace(layout);
 if(layout==='measure'){WL.measureInput.renderMeasureGrid();updateMeasurementHeading()}
 if(layout==='mother'){updateMotherCalcLength();bindMotherInputs()}
 if(layout==='piece')renderProductPanel();
 /* 手入力の案内は**入れる場所のすぐ上**（§9.233 ③）。段は変わらないので
    `WL.measureSteps.refresh()`は走らない——ここから書き直す。 */
 if(window.WL&&WL.measureSteps&&WL.measureSteps.materialNote)WL.measureSteps.materialNote();
}
/* v33: 「揃い/肉厚/長さ」は縦割数で分割した丈(1〜N)ごとに複数行で保持する。
   丈は旧VBA帳票の「丈」テーブル（長さ/肉厚/揃い/外観/備考）と同じ、
   丈=最終的に分割された各ピースを指す1..N連番（頭/尾のサンプリング位置とは無関係）。
   v34では丈番号タブ+縦並びフォームにしていたが、§9.131で**全丈を1つの表**へ
   戻した（②の作業面は実測1059×920pxあり、9丈×9項目は横スクロールなしで
   収まる）。読み書きするDOMは`#productRowsBody`の1本だけで、
   `collect()`・`activeRequiredControls()`も同じものを見る。 */
/* 丈1本の器。**外観（〇/△/×）と巻ズレ（OS/DS）は§9.393で足した**
   （利用者の指示「丈毎の項目に、外観を追加し…巻ズレの項目を追加し、
   OSDSを分けて入力できるように」）。巻ズレは条ごとの入力内容『巻ずれ』とは
   別物——あちらは条ごと・測定器から受ける値で、こちらは**丈ごとの手入力**。 */
function blankProductRow(){return{productLength:'',wallThickness:'',alignmentCode:'',edgeShape:'',appearance:'',offsetOs:'',offsetDs:'',occurrencePosition:'',regularity:'',direction:'',pitch:'',alignmentValue:'',note:''}}
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
/* 丈別データの欄と、丸めの決まりの鍵の対応（§9.305 ①）。
   **綴りは`base.js`の`MEASURE_ROUND`と合わせる**——ここに無い欄は丸めない
   （対応表に足すことが「その欄も丸められるようにする」ことになる）。 */
const PRODUCT_ROUND_KEYS={alignmentValue:'alignValue',pitch:'pitch'};
/* ---------- 切断面等級から出す基準(§9.204、利用者の指示) ----------
   「品質規格の『切断面』の項目の数値を見て、基準を出してください。
     丈毎に判定することになります。
      4級のとき、のこぎり状＝2mm以下、テレスコープ状＝3mm以下
      3級のとき、のこぎり状＝2mm以下、テレスコープ状＝5mm以下
     ただし、客先の個別要求がない時。（将来的には…対応予定）
     今は注意書きを付けてすべてにこの(切断面等級とエッジ形状のみ)条件で
     基準を表示＆判定させる。」

   **等級の実値は数字1桁の文字列**（実データ3件はいずれも `'3'`。生地外観の
   ように `'3C'` と英字が付く項目もあるので、数字だけを取り出す）。
   出どころは`S.measure.qualityGrades['切断面']`＝仕掛の`品質ｸﾞﾚｰﾄﾞ_切断面`
   （`QUALITY_GRADE_SOURCE`）。**以前ここにあった`qualityGradeFields`は
   誰にも読まれていない死んだ配列で、§9.359 でファイルを閉じたときに
   それが証明できたので消した**（グローバルのあいだは「外の誰かが読んで
   いるかもしれない」と言い切れず、コメントで断るしかなかった）。
   **基準が引けないときは判定しない**——3級・4級以外や空欄で「OK」と言うのは
   根拠が無く、「NG」と言い切るのも嘘になる（§「推測させない」）。 */
const CUT_FACE_LIMITS={
 '3':{'のこぎり状':2,'テレスコープ状':5},
 '4':{'のこぎり状':2,'テレスコープ状':3},
};
/* 旧名を今の名前へ寄せる（§9.160と同じ作法）。§9.203では「テレスコ状」で
   出していたので、保存済みの値がここを通って基準に当たる。 */
const PRODUCT_EDGE_ALIAS={'テレスコ状':'テレスコープ状'};
function normalizeEdgeShape(v){const t=String(v||'').trim();return PRODUCT_EDGE_ALIAS[t]||t}
/* **等級は「その紙のレコード」から引く**（§9.205）。`S.measure`は**いま開いて
   いる測定**なので、帳票から呼ぶと別のロットの等級で判定してしまう
   （一括印刷は複数ロットを続けて流し込むので、途中から全部同じ等級になる。
   §9.174の`rpActiveTarget`と同じ壊れ方）。既定は今までどおり`S.measure`で、
   帳票は`x.qualityGrades`を渡す。 */
function cutFaceGrade(grades){
 const src=grades||(S.measure&&S.measure.qualityGrades)||null;
 const raw=String((src&&src['切断面'])||'').trim();
 if(!raw)return '';
 const hit=raw.normalize('NFKC').match(/\d+/);
 return hit?hit[0]:'';
}
function cutFaceLimits(grades){return CUT_FACE_LIMITS[cutFaceGrade(grades)]||null}
/* この形状の上限(mm)。**引けなければ null**（0を返さないこと——0mm以下という
   通らない基準になる）。 */
function edgeLimitOf(shape,grades){
 const table=cutFaceLimits(grades);if(!table)return null;
 const v=table[normalizeEdgeShape(shape)];
 return Number.isFinite(v)?v:null;
}
const PRODUCT_CHOICES=[
 {k:'edgeShape',          label:'エッジ形状',opts:[PRODUCT_EDGE_OK,'のこぎり状','テレスコープ状']},
 /* 外観（§9.393）。**記号はフラットネスと同じ3つ**（`〇`＝U+3007）——同じ
    意味の記号を画面ごとに変えない（§CLAUDE 3。読む側が別物だと思う）。 */
 {k:'appearance',         label:'外観',      opts:['〇','△','×']},
 {k:'occurrencePosition', label:'発生位置',  opts:['2/3以上発生','1/3〜2/3発生','1/3未満発生']},
 {k:'regularity',         label:'規則性',    opts:['不規則','規則的']},
 {k:'direction',          label:'方向',      opts:['OS','DS']},
];
/* エッジ形状が「揃い綺麗」のときは書かない欄。**段ごと出さない**
   （押せるのに意味が無い欄を残さない。§9.203で`disabled`にする案から
   「そもそも出さない」へ変えたので、無効化のコードは残っていない）。 */
const PRODUCT_DETAIL_KEYS=['occurrencePosition','regularity','direction','pitch','alignmentValue'];
/* 丈1本の判定(§9.204)。戻り値は 'OK'/'NG'/'値待ち'/'基準なし'/''。
    ・エッジ形状が未選択 … 旧4桁コードがあればそれで判定（§9.203）
    ・揃い綺麗          … OK（値は要らない）
    ・形状あり＋基準あり … **値(mm)を基準と比べる**。値が無ければ「値待ち」
    ・基準が引けない    … 「基準なし」。**OK/NGを推測で出さない** */
function judgeProductRow(r,grades){
 if(!r)return '';
 const edge=normalizeEdgeShape(r.edgeShape);
 if(!edge)return judgeAlignmentCode(r.alignmentCode);
 if(edge===PRODUCT_EDGE_OK)return 'OK';
 const limit=edgeLimitOf(edge,grades);
 if(limit===null)return '基準なし';
 /* **空欄を0と読まない**（`Number('')`は0。屑幅・母材で同じ罠）。 */
 const raw=String(r.alignmentValue||'').trim();
 if(raw==='')return '値待ち';
 const n=Number(raw);
 if(!Number.isFinite(n))return '値待ち';
 return n<=limit?'OK':'NG';
}
/* バッジの見た目。**色だけで伝えない**ので、文字はそのまま出す（§3）。 */
/* 判定の理由。**「なぜそうなったか」を書く**——OK/NGの2文字だけでは、
   基準を覚えていない人には確かめようがない。 */
function judgeReasonOf(r,j,grades){
 const edge=normalizeEdgeShape(r&&r.edgeShape);
 if(j==='OK'&&edge===PRODUCT_EDGE_OK)return '「揃い綺麗」＝異常なしのためOKです';
 const limit=edgeLimitOf(edge,grades);
 const raw=String((r&&r.alignmentValue)||'').trim();
 if(j==='基準なし')return `切断面等級から${edge||'この形状'}の基準を出せません（3級・4級のみ対応）。合否は判定していません`;
 if(j==='値待ち')return `${edge}の基準は ${limit!==null?limit.toFixed(1)+'mm以下':'—'} です。値(mm)を入れると判定します`;
 /* **旧4桁コードで判定した行**はエッジ形状も基準も持たない（§9.203）。
    `limit`がnullのまま`toFixed`を呼ぶと落ちるので、必ず先に分ける。 */
 if(limit===null){
  const code=String((r&&r.alignmentCode)||'').trim();
  return j?`4桁の揃いコード（${code||'—'}）で判定しています。エッジ形状を選び直すと、切断面等級の基準で判定します`
          :'エッジ形状を選ぶと判定します';
 }
 if(j==='OK')return `${edge} ${raw}mm ≦ 基準 ${limit.toFixed(1)}mm のためOKです`;
 if(j==='NG')return `${edge} ${raw}mm が基準 ${limit.toFixed(1)}mm を超えています`;
 return 'エッジ形状を選ぶと判定します';
}
function productJudgeClass(j){
 return j==='OK'?' ok':j==='NG'?' ng':(j==='値待ち'||j==='基準なし')?' pend':'';
}
/* 基準の帯。**出どころ（切断面等級）と、見ていないもの（客先の個別要求）を
   必ず書く**（§6）。等級が読めないときは「出せない」と書いて判定もしない。 */
function cutFaceNoteHtml(grades){
 const grade=cutFaceGrade(grades),table=cutFaceLimits(grades);
 if(!table){
  const shown=grade?`「${esc(grade)}」`:'空欄';
  return `<b>基準を出せません</b>：品質規格の<b>切断面</b>が${shown}で、3級・4級のどちらにも当てはまりません。`
   +`エッジ形状と内訳は今までどおり記録できますが、<b>合否は判定しません</b>。`;
 }
 const cells=Object.entries(table)
   .map(([k,v])=>`<span class="prt-lim"><i>${esc(k)}</i><b>${v.toFixed(1)}mm以下</b></span>`).join('');
 return `<span class="prt-lim-head">切断面 <b>${esc(grade)}級</b>の基準</span>${cells}`
   +`<small>各丈の<b>値(mm)</b>をこの基準と比べて判定します。`
   +`<b>客先の個別要求は反映していません</b>——切断面等級とエッジ形状だけで判定しています。</small>`;
}
function renderCutFaceNote(){
 const el=$('#productRowsNote');if(!el)return;
 el.innerHTML=cutFaceNoteHtml();
 el.classList.toggle('is-none',!cutFaceLimits());
}
/* ---------- 揃いの内訳(§9.205、利用者の指示「内訳と合否両方(デフォルト)と
   内訳のみ、合否のみを切り替えほしい」) ----------
   画面は形状を主役の列に、残りを下段の内訳行へ分けているが、**紙は1セル**
   しか無いので「ラベル 値」の並びで組む。組み立ては**ここ1箇所**で、
   画面のタイトル（`title`）と紙が同じ文言になるようにする。
   **空欄は出さない**——選ばれていない欄まで「—」で並べると、異常が無い丈
   ほど行が高くなる（紙は高さも有限）。**ピッチと値は単位を付ける**
   （同じ数字でも意味が違う。§6）。 */
const PRODUCT_BREAK_EXTRA={pitch:{label:'ピッチ',unit:'mm'},alignmentValue:{label:'値',unit:'mm'}};
function productBreakdownOf(r){
 if(!r)return [];
 const out=[],edge=String(r.edgeShape||'').trim();
 if(edge)out.push({k:'edgeShape',label:'エッジ形状',text:normalizeEdgeShape(edge)});
 if(edge&&normalizeEdgeShape(edge)!==PRODUCT_EDGE_OK){
  PRODUCT_DETAIL_KEYS.forEach(k=>{
   const v=String(r[k]||'').trim();if(!v)return;
   const ex=PRODUCT_BREAK_EXTRA[k]||{};
   const label=ex.label||(PRODUCT_CHOICES.find(d=>d.k===k)||{}).label||k;
   out.push({k,label,text:v+(ex.unit||'')});
  });
 }
 /* **旧データも読めること**（§9.203）。4桁コードしか無い行はそのコードが
    唯一の内訳なので、内訳を出すと決めた以上ここでも出す。 */
 const code=String(r.alignmentCode||'').trim();
 if(code&&!edge)out.push({k:'alignmentCode',label:'旧コード',text:code});
 return out;
}
/* 紙に載せる基準の一文。**画面の帯（`cutFaceNoteHtml`）と同じ材料**から
   作るが、紙は幅が有限なので1行に畳む。**出どころと、見ていないものを
   落とさないこと**——紙は手元に残り、あとから根拠を確かめる相手が居る。 */
function cutFacePaperNote(grades){
 const grade=cutFaceGrade(grades),table=cutFaceLimits(grades);
 if(!table)return grade
   ? `品質規格の切断面が「${grade}」で、3級・4級のどちらにも当てはまらないため、合否は判定していません。`
   : '品質規格の切断面が空欄のため、合否は判定していません。';
 return `合否は切断面 ${grade}級の基準（`
   +Object.entries(table).map(([k,v])=>`${k} ${v.toFixed(1)}mm以下`).join('・')
   +`）で各丈の値(mm)を判定。客先の個別要求は反映していません。`;
}
/* 公開は名前空間経由（素の`window.X`を増やさない）。`judgeProductRow`等は
   帳票が素の名前で呼んでいる既存の契約なのでそのまま残す。 */
window.WL.product={breakdown:productBreakdownOf,paperNote:cutFacePaperNote,
 judge:judgeProductRow,reason:judgeReasonOf,EDGE_OK:PRODUCT_EDGE_OK};
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
const PRODUCT_FILLED_KEYS=['productLength','wallThickness','edgeShape','alignmentCode','appearance','offsetOs','offsetDs'];
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
/* 畳んだ丈（§9.206）。**レコードには持たせない**——見せ方の好みであって
   測定した内容ではない（保存すると他のPCで開いたときに畳まれる）。 */
const prtFolded=new Set();let prtFoldedFor='';
function renderProductPanel(){
 const m=S.measure;const body=$('#productRowsBody'),tabs=$('#productLengthTabs'),fields=$('#productLengthFields');
 if(!body||!m)return;
 /* 別のロットを開いたら畳みは持ち越さない（丈の番号は使い回されるので、
    前のロットで畳んだ丈が新しいロットで畳まれて見える）。 */
 if(prtFoldedFor!==(m.id||'')){prtFolded.clear();prtFoldedFor=m.id||''}
 if(!m.product||!Array.isArray(m.product.rows))m.product={rows:Array.from({length:WL.base.LENGTH_SLOTS},blankProductRow)};
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
  const limit=edgeLimitOf(r.edgeShape);
  const over=limit!==null&&String(r.alignmentValue||'').trim()!==''
    &&Number.isFinite(Number(r.alignmentValue))&&Number(r.alignmentValue)>limit;
  const oldCode=String(r.alignmentCode||'').trim();
  /* **内訳は異常のときだけ、行の下へ横いっぱいで出す**(§9.203)。
     5欄を横に並べると1列120px×5が要り、器(実測841px)に入らない
     ——詰めると「1/3〜2/3発生」が見切れる。異常が無い行では場所も取らない
     ので、面積は「頻度×重要度」どおりに配れる(§1)。 */
  /* **手で畳める**（§9.206、利用者の指示「拡張入力欄も手動では折りたためる
     ようにしてください」）。書き終えた丈まで5欄を開いたままだと、丈が多い
     ロットで表が縦に伸びて全体を見渡せない。
     **畳んでも値は読めること**（§9.125）——畳んだ側には要約を出す。隠した
     ものが何かを書かずに隠すと、書いたこと自体を忘れる。 */
  const folded=prtFolded.has(i);
  const sum=productBreakdownOf(r).filter(b=>b.k!=='edgeShape')
    .map(b=>`<span class="prt-sum-item"><i>${esc(b.label)}</i>${esc(b.text)}</span>`).join('');
  const detail=ok||!String(r.edgeShape||'')
   ?''
   :`<tr class="prt-detail${folded?' is-folded':''}" data-row="${i}"><td colspan="9"><div class="prt-detail-in">`
     +`<button type="button" class="prt-fold" data-prt-fold="${i}" aria-expanded="${folded?'false':'true'}"`
     +` title="${folded?'内訳の入力欄を開きます':'内訳の入力欄を畳みます（記録は残ります）'}">`
     +`<span class="prt-detail-lead">丈${i+1}の内訳</span><span class="prt-chev" aria-hidden="true"></span></button>`
     +(folded
       ?`<span class="prt-sum">${sum||'<i class="prt-sum-none">まだ書いていません</i>'}</span>`
       /* **内訳に出すのは`PRODUCT_DETAIL_KEYS`の欄だけ**（§9.393）——
          「エッジ形状以外」で選ぶと、主役の列へ欄を1つ足すたびに
          内訳へも勝手に現れる（外観を足した時にそうなった）。 */
       :PRODUCT_CHOICES.filter(d=>PRODUCT_DETAIL_KEYS.indexOf(d.k)>=0)
         .map(d=>`<label class="prt-df"><span>${esc(d.label)}</span>${sel(d.k)}</label>`).join('')
        +`<label class="prt-df"><span>ピッチ(mm)</span>${field('pitch','number')}</label>`
        +`<label class="prt-df prt-df-val${over?' is-over':''}"><span>値(mm)</span>${field('alignmentValue','number')}`
        +(limit!==null?`<em class="prt-lim-inline">≤ ${limit.toFixed(1)}</em>`:'<em class="prt-lim-inline is-none">基準なし</em>')
        +`</label>`)
     +`</div></td></tr>`;
  return `<tr data-row="${i}"><th>${i+1}</th><td>${field('productLength','number')}</td><td>${field('wallThickness','number')}</td>`
   +`<td><span class="product-judge${productJudgeClass(judge)}" data-product-judge="${i}"`
   +` title="${esc(judgeReasonOf(r,judge))}">${esc(judge)}</span>`
   +(oldCode?`<small class="prt-old" title="4桁の揃いコードで記録された旧データです。エッジ形状を選び直すと、そちらが判定に使われます">旧 ${esc(oldCode)}</small>`:'')+`</td>`
   /* 外観・巻ズレOS/DS（§9.393）。**判定には効かない**——揃いの合否は
      エッジ形状と値(mm)から出す（§9.204）ので、ここで色を付けない。 */
   +`<td>${sel('appearance')}</td><td>${field('offsetOs','number')}</td><td>${field('offsetDs','number')}</td>`
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
   /* 値(mm)は判定に効く(§9.204)。**同じ行の判定とその理由を必ず言い直す**。 */
   const j=judgeProductRow(row);
   const badge=document.querySelector(`#productRowsBody tr[data-row="${i}"] [data-product-judge]`);
   if(badge){badge.textContent=j;badge.className='product-judge'+productJudgeClass(j);
             badge.title=judgeReasonOf(row,j)}
   if(key==='alignmentValue'){
    const limit=edgeLimitOf(row.edgeShape),n=Number(String(el.value||'').trim());
    const over=limit!==null&&String(el.value||'').trim()!==''&&Number.isFinite(n)&&n>limit;
    const box=el.closest('.prt-df');if(box)box.classList.toggle('is-over',over);
   }
   markDirty();updateProductStatus();
   /* 入力内容の「入力数」もその場で言い直す（§9.208 ②）。ここを呼ばないと
      丈を埋めてもチップの数字が動かない。 */
   if(typeof refreshMeasureProgress==='function')refreshMeasureProgress();
  };
  /* selectは`input`も飛ぶが、**`change`も受ける**——古いブラウザ差を
     気にせず1本にまとめる（同じ値なら2度目は何も変わらない）。 */
  el.oninput=apply;
  if(el.tagName==='SELECT')el.onchange=apply;
  /* 打ち終わったら**丸める**（§9.305 ①、利用者の指示「④揃いの項目のうち、
     値の入力値」）。決まりは測定項目マスタが持ち、当てるのは
     `WL.measureRound`の1箇所（§9.163）。**打っている最中は当てない**
     ——`0.2`を打つ途中の`0.`で丸めると、次の文字が入る前に値が飛ぶ。
     鍵は測定表の項目名とそろえてある（`alignValue`／`pitch`）。 */
  if(PRODUCT_ROUND_KEYS[el.dataset.productField])el.onblur=()=>{
   const key=PRODUCT_ROUND_KEYS[el.dataset.productField];
   const v=WL.measureRound.apply(key,el.value);
   if(String(v)===String(el.value))return;
   el.value=v;apply();
  };
 });
 body.querySelectorAll('[data-prt-fold]').forEach(btn=>btn.onclick=()=>{
  const i=+btn.dataset.prtFold;
  if(prtFolded.has(i))prtFolded.delete(i);else prtFolded.add(i);
  renderProductPanel();
 });
 renderCutFaceNote();
 upgradeManualInputTypes();updateProductStatus();
 loadFlatComment(); WL.measureInput.applyInputProtection();
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
$('#verticalCount')?.addEventListener('change',()=>{if(WL.measureItem.isPiece($('#measureType').value))renderProductPanel()});
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
 /* ---------- 帯は**どちらのやり方でも同じ場所に出す**（§9.210 ③、利用者の指示） --
    以前は手入力だけの項目（ラテラルボー等）で帯ごと隠しており、項目を
    切り替えると「自動」のバッジが**消えて右のバッジが左へ詰まって**いた。
    同じカテゴリの情報は同じ位置に出す——動くだけで探し直しになる。
    **`display`/`visibility`は触らない**（§9.122。`#deviceInput`はこの中に
    あり、寸法ゼロだとフォーカスを保持できない）。手入力の項目では
    `inputMode==='manual'`が立つので、フォーカスを奪う見張りは動かない。 */
 if(statusBox){
  if(statusBox.hidden)statusBox.hidden=false;
  statusBox.dataset.forced=forceManual?'manual':forceAuto?'auto':'';
 }
 const desiredMode=forceAuto?'auto':forceManual?'manual':null;
 if(desiredMode&&S.measure.settings.inputMode!==desiredMode){
  S.measure.settings.inputMode=desiredMode;
  document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x.dataset.mode===desiredMode));
  WL.measureInput.applyInputProtection();
 }
 /* **必ず描き直す。** 上の`if`は「モードが変わったとき」しか通らないので、
    そこだけに任せると手入力の項目どうしを行き来したときに帯が前の項目の
    ままになる（「自動」と出たまま手入力、が実際に作れる）。 */
 WL.measureInput.updateReceiveState(document.activeElement===$('#deviceInput'));
}
$('#measureType').onchange=()=>{S.measure.settings.wStep=0;S.measure.settings.tStep=0;S.measure.settings.burrFirst=null;S.measure.settings.measureType=$('#measureType').value;applyRightLayout();syncInputModeLock();$('#deviceInput').focus();markDirty()};
/* 測定画面全体の再描画。旧実装は9層のラップ(モード表示→製品丈→検証→
   基本情報→公差セレクタ→コース→作業時間→タブ初期化)だったものを、
   実行順を保ったまま一本の関数へ整理した。 */
/* ---------- 「描いたあとに足す」は登録で（§9.348・REVIEW 3-16） ----------
   `renderMeasurement`／`updateMeasurementHeading`は4つ＋2つのファイルが
   「退避して被せて」いた。`WL.listHooks`（§9.93）と同じ形にする——足したい側は
   登録するだけで、順番は登録順（＝読み込み順、今までと同じ）。1つが転んでも
   残りは走る（fail-open）。核は`…Core`で、早期 return でもフックは走る。 */
/* 登録表の実体は土台（base.js の `WL.measureHooks`。§9.352）。ここは核が呼ぶ口だけ。 */
function runMeasureHooks(kind,...args){WL.measureHooks.run(kind,...args)}
function renderMeasurement(){renderMeasurementCore();runMeasureHooks('afterRender')}
function updateMeasurementHeading(){updateMeasurementHeadingCore();runMeasureHooks('afterHeading')}
function renderMeasurementCore(){
 hydrateBusinessFields();
 WL.base.measureDirty=false;const m=S.measure,b=m.basic;updateLengthOptions(m.settings.verticalCount||1);updateCoilOptions(m.settings.horizontalCount||1);$('#modalEquipment').textContent=b.equipment;/* 基本情報の並び(§9.55)。13項目を「主識別 → 識別番号 → 製品 → コース」の
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
   mb.textContent=open?'詳細を閉じる':'詳細を見る';};}Object.entries(m.settings).forEach(([k,v])=>{const el=$('#'+k);if(el){if(el.type==='checkbox')el.checked=v;else el.value=v}});$('#qualityInfo').value=m.qualityInfo;paintQualityInfo();document.querySelectorAll('[data-mother]').forEach(x=>x.value=m.mother[x.dataset.mother]||'');$('#motherOriginalWidth').textContent=fmtDim(b.originalWidth,1)||'－';updateMotherCalcLength();WL.measureInput.renderMeasureGrid();WL.measureInput.renderStats();
 /* 操業データの入力欄は**設備ごと**なので、開いた時点で用意して値を戻す
    （§9.215）。読めなくても測定は開ける（fail-open）。 */
 if(window.WL&&WL.opData)WL.opData.refresh().catch(WL.quiet('操業データ項目を取れない（測定は開ける・fail-open）'));
 setState('IndexedDB読込済み')
 {const mode=S.measure.settings.inputMode||'auto';document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x.dataset.mode===mode))}
 activateWorkspace(rightLayoutFor($('#measureType').value));
 WL.measureInput.applyInputProtection();
 WL.measureInput.updateReceiveState(document.activeElement===$('#deviceInput'));
 renderProductPanel();
 applyRightLayout();
 requestAnimationFrame(updateValidationVisuals);
 upgradeManualInputTypes();
 bindMotherInputs();
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
 try{WL.masterDiff.start()}catch(e){WL.quiet.note('マスタの新旧を見張れない（測定は続けられる）',e)}
}
// Unified required/valid/NG visual language.
function hasValue(el){return String(el?.value??'').trim()!==''&&String(el?.value??'').trim()!=='-'}
function setVisualState(el,state){
 if(!el)return;el.classList.remove('validation-required','validation-valid','validation-ng');
 el.classList.add(state==='ng'?'validation-ng':state==='valid'?'validation-valid':'validation-required');
 el.setAttribute('aria-invalid',state==='valid'?'false':'true');
}
/* 丸ごと持ち替えられる（§9.352 の `own`）。閉じたので外から関数を
   差し替えることはできない——**持ち替えの口は登録表の1箇所**にする。 */
function activeRequiredControls(){
 const own=WL.measureHooks.owner('activeRequiredControls');
 if(own)return own();
 return activeRequiredControlsCore();
}
function activeRequiredControlsCore(){
 const controls=[];
 /* **必須はマスタが決める**（§9.216 ②、利用者の指示「一部の必須入力事項も
    マスタで設定可能とし」）。以前はここに`['operator','inspector']`と直に
    書いており、設備ごとに変えられなかった。
    **答えが得られないときは元の2つへ倒す**——読めなかったことを「必須は
    無い」と同じに扱うと、完了前の確認が黙って緩くなる（§9.190の
    「印の保存が失敗したら画面に出す」と同じ考え方で、静かに緩めない）。 */
 const fromMaster=(window.WL&&WL.opData&&WL.opData.requiredControls)?WL.opData.requiredControls():null;
 if(fromMaster&&fromMaster.length!==undefined&&fromMaster!==null&&WL.opData.defs().length){
  fromMaster.forEach(x=>controls.push(x));
 }else{
  ['operator','inspector'].forEach(id=>controls.push({el:$('#'+id),label:id==='operator'?'オペレータ':'検査員'}));
 }
 const type=$('#measureType')?.value;
 /* **見ているのは「いま出している面」だけ**（§9.391）。母材と丈毎は別の
    項目になったので、丈毎を開いていないのに丈の欄を必須に数えると、
    画面に出ていない欄で赤が出る（全項目の取りこぼしは`measure-progress.js`の
    完了前の確認が別に見ている）。 */
 if(WL.measureItem.isMother(type)){
  /* **ラベルは画面から読む**（§9.232）。以前はDOMの順番で決め打ちの配列を
     引いていたので、マスタで名前を変えても並べ替えても古い呼び名が出た
     ——母材の欄は操業データの項目になり、**順番も名前も現場が決める**。
     名前は`motherFieldLabel()`の1箇所が答える（同じ欄を2通りに呼ばない）。 */
  document.querySelectorAll('[data-mother]').forEach(el=>
   controls.push({el,label:motherFieldLabel(el)}));
 }else if(WL.measureItem.isPiece(type)){
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
/* 検証の印を描いたあとに足す（進捗の引き直し）は `afterValidation`（§9.352）。 */
function updateValidationVisuals(){const r=updateValidationVisualsCore();WL.measureHooks.run('afterValidation',r);return r}
function updateValidationVisualsCore(){
 const required=activeRequiredControls(),requiredSet=new Set(required.map(x=>x.el));
 document.querySelectorAll('.validation-required,.validation-valid,.validation-ng').forEach(el=>{if(!requiredSet.has(el))el.classList.remove('validation-required','validation-valid','validation-ng')});
 required.forEach(({el})=>{
  if(el.classList.contains('ng'))setVisualState(el,'ng');
  else setVisualState(el,hasValue(el)?'valid':'required');
 });
 const missing=required.filter(({el})=>!hasValue(el)),ng=required.filter(({el})=>el.classList.contains('ng'));
 /* **合図は残すが、文言は事実に合わせる**（§9.319・§CLAUDE 6）。公差外では
    もう完了を止めないので、「完了できません」と読める書き方をしない。
    印（`validation-blocked`）は「押す前に見てほしいものがある」の意味で残す。 */
 const button=$('#complete');
 if(button){
  button.classList.toggle('validation-blocked',missing.length>0||ng.length>0);
  button.title=missing.length?`未入力 ${missing.length}件`
   :ng.length?`公差外・基準外 ${ng.length}件（確認のうえ完了できます）`:'完了できます';
 }
 return{missing,ng};
}
function showValidationMessage(result){
 document.querySelectorAll('.validation-message').forEach(x=>x.remove());
 const target=$('.center-pane'),message=document.createElement('div');message.className='validation-message';
 const missingNames=[...new Set(result.missing.map(x=>x.label))];
 /* ここへ来るのは**オペレータ/検査員が未選択のときだけ**（§9.319）。
    公差外は止めないので、件数を併記して「完了できません」と言わない
    ——止めていない理由を止めた理由として書くと、直す先を取り違える。 */
 message.textContent=`完了できません。未入力項目を確認してください: ${missingNames.slice(0,6).join('、')}${missingNames.length>6?' ほか':''}`;
 target.prepend(message);result.missing[0]?.el?.focus();
}
function judgeInput(el,key,value,index){
 el.classList.remove('ng','complete');
 if(key==='flatness'){
  if(String(el.value||'').trim()!=='')el.classList.add('complete');
  return;
 }
 const raw=String(el.value??'').trim(),tol=WL.measureInput.toleranceFor(key==='thickness'?'thickness':'width',index),num=Number(raw);
 if(raw!==''&&Number.isFinite(num)){el.classList.add('complete');if(tol&&(num<tol[0]||num>tol[1]))el.classList.add('ng')}
}
document.addEventListener('input',event=>{if(event.target.matches('input,select,textarea'))updateValidationVisuals()},true);
document.addEventListener('change',event=>{if(event.target.matches('input,select,textarea'))updateValidationVisuals()},true);
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
 Object.entries(QUALITY_GRADE_SOURCE).forEach(([label,names])=>m.qualityGrades[label]=WL.base.sourceValue(names));
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
/* ---------- ③「記録した値」はマスタが決める（§9.242 ④、利用者の指示） ----------
   ここに在った`RECORD_GROUPS`（項目名を4群ぶん直に並べた表）は**廃止した**
   ——群の名前も並びも現場では変えられず、母材だけ画面のラベルから拾うという
   別の道も持っていた（同じことを2通りで書いていた）。
   中身を答えるのは`WL.opData.recordRows()`の1箇所で、群・並び・呼び名・単位は
   **操業データ項目マスタの行がそのまま**使われる。**ここへ項目名の写しを
   戻さないこと**——戻すと、マスタで項目を足しても③だけ古いままになる。 */
/* 母材の項目名は**画面のラベルから取る**（マスタでも定数でもない）。
   ここで別の名前を持つと、②で見た欄名と③の一覧で言葉が変わる。
   画面のラベルは`renameBuiltinLabel()`がマスタの項目名で書き換えるので
   （§9.228 ①・§9.232）、ここを通せば改名にそのまま追随する。 */
function motherFieldLabel(el){
 const lab=el&&el.closest('label');
 if(!lab)return (el&&(el.dataset.mother||el.id))||'母材';
 /* 名前を持つのは`<span class="opf-name">`（§9.233 ⑤で組み込みの欄も
    包むようにした）。**割り付けを通る前の欄は素のテキスト節点のまま**
    なので両方から読む——片方だけを見ると、開いた直後だけ英字の鍵
    （`fullLength`等）が名前として出る。
    印（必須）と添え書き（`.prep-from`）は要素なので数に入らない。 */
 const box=lab.querySelector(':scope>.opf-name')||lab;
 const name=[...box.childNodes].filter(n=>n.nodeType===3)
   .map(n=>n.textContent.trim()).join('').trim();
 return name||(el&&(el.dataset.mother||el.id))||'母材';
}
/* `motherRecordRows()`は**廃止した**（§9.242 ④）。母材の欄も操業データの
   項目なので、③のカードは`WL.opData.recordRows()`が一本で組み立てる
   ——同じ欄を2通りに読む道を残さない。 */
/* **画面にいま入っている値を出す**（§9.206、実機で報告「準備の入力など、
   選択状態にしたら、記録した値に入ってほしいところ何も表示されません」）。
   `settings`が書かれるのは`collect()`＝**保存のときだけ**なので、そこだけを
   見ると①で選んだオペレータ・検査員・人数・内径・スプール・測定器が③では
   「—」のまま出る。**既定から動かしていない項目（巻出方向・条入力順…）は
   `blankMeasure`が既定値を入れているので出てしまう**ため、「一部の欄だけ
   反映されない」という分かりにくい壊れ方になっていた。
   鍵は`collect()`と同じで**設定キー＝入力欄のid**。**欄が無ければ`settings`**
   ——保存済みの控えを開いた直後や、閲覧側から呼ばれたときに落とさないため。 */
/* ---------- ③「記録した値」の見え方はこの端末が決める（§9.246 ④） ----------
   利用者の指示:
     「完了前の記録した値のカード表示の部分で、文字サイズと間隔の問題で
      文字が見切れてしまうので、文字サイズと列の間隔も調整できるように
      してください」

   実機では値が「999.0 …」「－（選…」「アルミ…」と切れていた。器の幅は
   ③の右ペインぶんしか無く、そこへ**2段組**で押し込んでいるので、
   1つの値に配れる幅が半分になる——**中身を削らずに直すには器の使い方の
   ほうを変えるしかない**（§9.126「中身を減らしたら器も減らす」の裏側）。

   3つの軸だけ持つ:
     文字   … 小(--fs-sm) / 中(--fs) / 大(--fs-title)  ※トークンから選ぶ（§CLAUDE 7）
     列     … 1列 / 2列（既定・今までどおり） / 3列
     間隔   … 詰める / 標準（既定） / 広め
   **既定は今までの見え方**（わざわざ選んでいない人の画面を変えない・§9.132）。
   **置き場はこの端末**（読み方の好みなので、共有マスタへ入れると全員が
   同じ大きさに縛られる。§9.199の親ロットの印と同じ）。

   **切れている件数は文字で出す**（§3／§CLAUDE 2「次にすることを1つだけ指す」）
   ——切れていることに気づかないまま読み違えるのがいちばん悪い。
   出すだけでなく、**その場で直せる手立て**（1列にする）を同じ場所に置く。 */
const RV_KEY='WaveLogRecordedViewV1';
const RV_AXES=[
 {key:'fs',   label:'文字',  def:'md',
  opts:[['sm','小'],['md','中'],['lg','大']]},
 {key:'cols', label:'列',    def:'2',
  opts:[['1','1列'],['2','2列'],['3','3列']]},
 {key:'gap',  label:'間隔',  def:'md',
  opts:[['sm','詰める'],['md','標準'],['lg','広め']]},
];
function rvPref(){
 let v=null;
 try{v=JSON.parse(localStorage.getItem(RV_KEY)||'null')}catch(e){WL.quiet.note('端末の覚えが読めない（既定で続ける）',e)}
 const p=(v&&typeof v==='object')?v:{};
 const out={};
 RV_AXES.forEach(a=>{
  const ok=a.opts.some(o=>o[0]===p[a.key]);
  out[a.key]=ok?p[a.key]:a.def;
 });
 return out;
}
function setRvPref(patch){
 const next=Object.assign(rvPref(),patch||{});
 try{localStorage.setItem(RV_KEY,JSON.stringify(next))}catch(e){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',e)}
 applyRvPref();
 renderRecordedValues();
}
/* 当てるのは**印だけ**——実際の値（文字サイズ・列数・間隔）はCSSが
   トークンから決める（§CLAUDE 7「リテラルを新しく足さない」）。 */
function applyRvPref(){
 const pane=$('#recordedPane');if(!pane)return;
 const p=rvPref();
 RV_AXES.forEach(a=>{pane.dataset['rv'+a.key.charAt(0).toUpperCase()+a.key.slice(1)]=p[a.key]});
}
let rvPop=null;
function closeRvPop(){
 if(!rvPop)return;
 rvPop.remove();rvPop=null;
 document.removeEventListener('mousedown',onRvOutside,true);
 document.removeEventListener('keydown',onRvKey,true);
 const b=$('#rvConf');if(b)b.setAttribute('aria-expanded','false');
}
function onRvOutside(e){
 if(!rvPop)return;
 if(rvPop.contains(e.target)||e.target.closest?.('#rvConf'))return;
 closeRvPop();
}
function onRvKey(e){
 /* **変換中のEscは取り消し**（§9.221 ①）。 */
 if(e.key==='Escape'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();closeRvPop()}
}
function openRvPop(anchor){
 closeRvPop();
 const p=rvPref();
 rvPop=document.createElement('div');
 rvPop.className='rv-conf-pop';rvPop.id='rvConfPop';
 rvPop.innerHTML='<b>記録した値の見え方</b>'
  +RV_AXES.map(a=>`<div class="rv-conf-row"><span>${esc(a.label)}</span><div>`
    +a.opts.map(o=>`<button type="button" data-rv-axis="${esc(a.key)}" data-rv-val="${esc(o[0])}"`
      +`${p[a.key]===o[0]?' class="is-on"':''}>${esc(o[1])}</button>`).join('')
    +'</div></div>').join('')
  +'<small>この端末だけで覚えます。値が切れるときは列を減らすか文字を小さくしてください。</small>';
 document.body.appendChild(rvPop);
 const r=anchor.getBoundingClientRect();
 rvPop.style.top=Math.round(r.bottom+6)+'px';
 rvPop.style.left=Math.round(Math.max(8,Math.min(r.left,innerWidth-rvPop.offsetWidth-8)))+'px';
 rvPop.querySelectorAll('[data-rv-axis]').forEach(b=>b.onclick=()=>{
  setRvPref({[b.dataset.rvAxis]:b.dataset.rvVal});
  rvPop&&rvPop.querySelectorAll(`[data-rv-axis="${CSS.escape(b.dataset.rvAxis)}"]`)
    .forEach(x=>x.classList.toggle('is-on',x===b));
 });
 anchor.setAttribute('aria-expanded','true');
 document.addEventListener('mousedown',onRvOutside,true);
 document.addEventListener('keydown',onRvKey,true);
}
/* 切れている件数を**実測**して出す（§9.130「網は画面の実寸と中身の実寸を
   突き合わせる」）。DOMの数や有無を見る網では、器が狭くても要素は同じ数
   なので素通りする。**描いたあとに測る**（`requestAnimationFrame`）。 */
function paintRvClip(){
 const chip=$('#rvClip');const host=$('#recordedList');
 if(!chip||!host)return;
 let n=0;
 host.querySelectorAll('dt,dd').forEach(el=>{if(el.scrollWidth>el.clientWidth+1)n++});
 chip.hidden=!n;
 if(!n)return;
 chip.textContent=`切れ ${n}件`;
 chip.title=`${n}個の文字が幅に入りきらず「…」で切れています。`
  +'「見え方」で列を減らすか文字を小さくすると全部出ます（全文はマウスを載せると出ます）。';
}
function renderRecordedValues(){
 const host=$('#recordedList');
 if(!host||!S.measure)return;
 const shown=v=>{const s=String(v??'').trim();return s===''||s==='-'||s==='－'?'':s};
 /* ラベルは狭いと省略記号になる（値を守るため。§9.206）ので、**元の言葉を
    `title`に残す**——省略した文字が読めなくなるのは切り詰めと同じ。 */
 const line=r=>{
  const v=shown(r.value);
  const unit=v&&r.unit?` ${r.unit}`:'';
  const tip=[r.name,v?v+unit:'（未入力）',r.auto?'自動で入る値':''].filter(Boolean).join(' ／ ');
  return `<div><dt title="${esc(r.name)}">${esc(r.name)}</dt>`
   +`<dd class="${r.auto?'rv-auto':''}" title="${esc(tip)}">${esc(v?v+unit:'—')}</dd></div>`;
 };
 /* **マスタが読めていないうちは何も出さない**（§4）。空の群だけを並べると
    「項目が無い設備」と見分けが付かない。 */
 let rows=[];
 if(window.WL&&WL.opData&&WL.opData.recordRows){
  try{rows=WL.opData.recordRows()||[]}catch(e){console.warn('記録した値を組み立てられませんでした',e)}
 }else console.error('記録した値: WL.opData.recordRows が見つかりません（measure-opdata.jsの公開漏れ）');
 let h='';
 if(!rows.length){
  h='<p class="rv-empty">操業データ項目マスタで「③の記録した値に出す」を選んだ項目がここに並びます。</p>';
 }else{
  /* 群は**マスタの並びのまま**——出てきた順に束ねる（並べ替えない）。 */
  const order=[],bag=new Map();
  rows.forEach(r=>{
   if(!bag.has(r.group)){bag.set(r.group,[]);order.push(r.group)}
   bag.get(r.group).push(r);
  });
  h=order.map(g=>{
   const list=bag.get(g);
   const filled=list.filter(r=>shown(r.value)).length;
   /* **件数を文字で出す**（§3）——値が「—」ばかりの群を、読む前に見分けられる。
      **何の数かは`title`が言う**（`3/9`だけでは進捗とも読める）。 */
   return `<div class="rv-group"><b>${esc(g)}`
    +`<small title="${esc(`値が入っている項目 ${filled} / ${list.length}`)}">`
    +`${filled}/${list.length}</small></b>`
    +`<dl>${list.map(line).join('')}</dl></div>`;
  }).join('');
 }
 if(host.innerHTML!==h)host.innerHTML=h;
 applyRvPref();
 /* **描いたあとに測る**——直後の`scrollWidth`は組み直す前の値。 */
 requestAnimationFrame(()=>requestAnimationFrame(paintRvClip));
}
/* 「見え方」の入口は**カードの見出しの中**（§CLAUDE 2「探させない」）。
   配線は1度だけ——描き直しでボタンは作り直されない（`index.html`が持つ）。 */
WL.onReady(()=>{
 const b=document.getElementById('rvConf');
 if(b)b.onclick=()=>{if(rvPop)closeRvPop();else openRvPop(b)};
 applyRvPref();
});
/* 品質情報の見出しに**件数を文字で**添える（§9.144）。状態を色だけで伝えない。
   本文は`WL.base.qualityText()`が`(1) …`の塊を空行で連ねたもので、件数はその印の数。
   **値は`.value`への代入で入るのでDOMは変わらない**（§9.130と同じ）——
   代入した側が呼ぶ。**呼ぶのは2箇所**（開いたとき／共有DBから読んだとき）。 */
function paintQualityInfo(){
 const box=document.querySelector('.quality-info-block'),badge=$('#qualityInfoBadge'),ta=$('#qualityInfo');
 if(!box||!badge||!ta)return;
 /* **読めなかったときは「異常なし」と言わない**（§9.317、§CLAUDE 6）。
    共有の品質データが開けないだけなのに「異常なし」と出すと、画面が嘘を
    つく。理由と**測定は続けられること**を注記で書く（§4）。
    **本文（textarea）へは書かない**——`collect()`がその中身をそのまま
    記録へ入れるので、エラー文が品質情報として保存され帳票にも刷られる。 */
 const note=$('#qualityInfoNote'),why=String(S.measureContextError||'');
 if(note){note.hidden=!why;note.textContent=why}
 if(why){
  badge.textContent='読めません';
  badge.classList.remove('qi-some','qi-none');badge.classList.add('qi-warn');
  box.classList.remove('qi-has');
  return;
 }
 badge.classList.remove('qi-warn');
 const n=(String(ta.value||'').match(/^\(\d+\)/gm)||[]).length;
 badge.textContent=n?`異常 ${n}件`:'異常なし';
 badge.classList.toggle('qi-some',!!n);
 badge.classList.toggle('qi-none',!n);
 box.classList.toggle('qi-has',!!n);
}
function bindInfoTabs(){document.querySelectorAll('[data-infotab]').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('[data-infotab]').forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll('[data-infopanel]').forEach(p=>p.hidden=p.dataset.infopanel!==btn.dataset.infotab)})}
function upgradeManualInputTypes(){
 document.querySelectorAll('input[data-mother],input[data-product-field]').forEach(el=>{
  /* 数値欄は`WL.numericInput`が引き受ける（§9.208 ③）——マイナス禁止・
     「.5」の省略打ち・全角の3つを1箇所で。`type=number`から`text`へ
     変わるので、判定は**属性ではなく印**（`numeric-input`）で行う。 */
  if(el.type==='number'||el.classList.contains('numeric-input')){
   WL.numericInput.attach(el);
   el.classList.remove('text-input');
  }else{
   el.classList.add('text-input');
   el.classList.remove('numeric-input');
  }
 });
}
function renderResidualCourseEverywhere(){
 if(!S.measure)return;const residual=WL.base.sourceField(['残仕掛設備ｺｰｽ','残仕掛設備コース']);S.measure.basic.residualCourse=residual;
 const basic=$('#basicDetail')||$('#basicInfo .info-grid');if(basic){basic.querySelectorAll('.residual-course-field').forEach(x=>x.remove());const course=[...basic.querySelectorAll('.field')].find(x=>x.querySelector('label')?.textContent==='実績');const item=document.createElement('div');item.className='field residual-course-field';item.innerHTML=`<label>残</label><output title="${esc(residual)}">${esc(residual||'未設定')}</output>`;if(course)course.after(item);else basic.append(item)}
 const grid=$('#dataManagementPanel .data-management-grid');if(grid){[...grid.querySelectorAll('[data-residual-course]')].forEach(x=>x.remove());const children=[...grid.children],courseIndex=children.findIndex(x=>x.tagName==='B'&&x.textContent==='実績コース'),courseValue=courseIndex>=0?children[courseIndex+1]:null,label=document.createElement('b'),value=document.createElement('span');label.textContent='残コース';value.textContent=residual||'未設定';value.title=residual;label.dataset.residualCourse='1';value.dataset.residualCourse='1';if(courseValue)courseValue.after(label,value);else grid.append(label,value)}
}
/* 公差の内訳(基準値・±・計算式)を見出し領域へ表示する。 */
function updateMeasurementHeadingCore(){
 /* カードの名前は骨子どおり「測定」。**項目名は表の見出しが言っている**ので
    ここでは繰り返さない（§9.129。以前は上が「板幅測定」下が「板幅」だった）。 */
 /* ---------- 公差もバッジ1つで言う（§9.209 ②、利用者の指示） ----------
    「公差情報なしも貴重な場所を使っているので、バッジ化してください」。
    以前は枠付きの帯（実測40px）で、しかも中身は`#toleranceFacts`
    （判定公差の基準）と**同じ数字**だった（§9.129 同じ情報を2箇所に
    出さない）。1行のピルにして、内訳は`title`で読めるようにする。 */
 const type=$('#measureType').value;$('#measurePanelTitle').textContent='測定';
 const box=$('#toleranceSummary');if(!box)return;
 const pill=(cls,text,tip)=>{box.innerHTML=`<span class="tol-pill ${cls}" title="${esc(tip||text)}">${esc(text)}</span>`};
 /* **短く言う**（§9.233 ④）。見出しは1行に収める約束で、フラットネスだけ
    一括入力のボタンが増えるぶん、ここは詰める（意味は変えない）。 */
 /* **短く言い、意味は`title`へ**（§9.234 ③。見出しは1行に収める）。
    記号のボタン（`.flat-pick-group`）がすぐ隣に並ぶので、ここに要るのは
    「〇が合格」という約束だけ。 */
 if(type==='フラットネス')return pill('is-mark','〇=OK','条ごとに記号を入力してください。〇がOK、△と×はどちらもNGです。');
 const kind=WL.measureItem.kindOf(type),detail=WL.measureInput.toleranceDetail(kind),base=Number(kind==='thickness'?S.measure.basic.mfgThickness:S.measure.basic.mfgWidth);
 /* **上下限を持つものだけが「公差」**（§9.242 ⑤、利用者の指示）。片側の
    目標しか無い項目（ラテラルボー・バリ・テレスコープ・巻ずれ）で「公差」と
    書くと、下限もあるかのように読める。言葉は`WL.measureItem`の1箇所。 */
 const word=WL.measureItem.limitWordOf(detail,type);
 if(!detail)return pill('is-none',`${word}なし`,
   word==='公差'
    ?'選択した公差区分に使用可能なプラス・マイナス値がありません。判定は行いません。'
    :'この項目には判定に使える基準が登録されていません。判定は行いません。');
 const labels={manufacturing:'製造公差',order:'オーダー公差',instruction:'指示基準'},sourceLabel=labels[detail.source],requestedLabel=labels[WL.measureInput.configuredToleranceSource()],fallback=detail.fallback?`${requestedLabel}が不足しているため製造公差を使用`:'';
 /* 片側だけの基準は「0〜上限」なので、±の内訳を出しても読む値が無い。 */
 /* **桁は測定値と同じにそろえる**（§9.320-B、利用者の報告「板厚製造公差の
    表示が桁数溢れしている」）。生の`range`は`1.475`が
    `1.4749999999999999`のように出る——二進では表せない値の引き算なので
    必ず起きる。桁を答えるのは`fixedToleranceValue()`の1箇所で、
    **判定は生の範囲のまま**（画面だけを丸める・§9.242 ②）。 */
 const lo=fixedToleranceValue(kind,detail.range[0]),hi=fixedToleranceValue(kind,detail.range[1]);
 if(detail.single)return pill('',`${sourceLabel} ${lo}〜${hi}`,
   `基準 ${lo}〜${hi}`
   +(detail.plusKey?`（${detail.plusKey}）`:'')
   +'　※上下限のある公差ではなく、これ以下という基準です');
 pill(detail.source==='order'?'is-order':'',
      `${sourceLabel} ${lo}〜${hi}`,
      `基準値 ${fixedToleranceValue(kind,base)} ／ 公差 +${fixedToleranceValue(kind,detail.plus)}（${detail.plusKey}） -${fixedToleranceValue(kind,detail.minus)}（${detail.minusKey}）`
      +` ／ 判定範囲 ${lo}〜${hi}`+(fallback?` ／ ${fallback}`:''));
 if(fallback)box.insertAdjacentHTML('beforeend',`<span class="tol-pill is-fallback" title="${esc(fallback)}">代替</span>`);
}
// Design, actual and residual courses are rendered as one ordered information group.
function renderCourseHierarchy(){
 if(!S.measure)return;const design=WL.base.designCourseValue(),actual=WL.base.actualCourseValue(),residual=WL.base.residualCourseValue();S.measure.basic.designCourse=design;S.measure.basic.course=actual;S.measure.basic.residualCourse=residual;
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
 WL.records.updateCourseGuard();
}
/* ---------- 作業スケジュールとの連携(読み取りのみ、docs/decisions/9.7.md) ----------
   測定画面を開いたロットが作業予定に含まれていれば、基本情報タブへ
   「予定 2番目 / 予定開始 11:44 / 見積 2時間32分」の1行を出す。書き込みは
   行わない(進捗は§7.4の実績突合で自動反映される)。取得はopenMeasurement()の
   finally(CLAUDE.mdの既知の落とし穴どおり)で1回だけ行い、結果はモジュール内
   変数へキャッシュする(renderMeasurement()のたびに毎回問い合わせない)。 */
let scheduleInfoCache=null;
/* 所要時間の書き方は`WL.duration`の1箇所（§9.341）。 */
function renderScheduleInfo(){
 const basic=$('#basicDetail')||$('#basicInfo .info-grid');if(!basic)return;
 basic.querySelectorAll('.schedule-info-field').forEach(x=>x.remove());
 const lotNo=S.measure?.basic?.lotNo;
 if(!lotNo||!scheduleInfoCache||WL.base.normalizedLot(scheduleInfoCache.lotNo)!==WL.base.normalizedLot(lotNo))return;
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
    const idx=active.findIndex(e=>WL.base.normalizedLot(e.lotNo)===WL.base.normalizedLot(lotNo));
    if(idx>=0){
     const entry=active[idx];
     scheduleInfoCache={lotNo,position:idx+1,
      startText:entry.plannedStart?new Date(entry.plannedStart).toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'未定',
      minutesText:WL.duration.text(entry.estimate?.minutes)};
    }
   }
  }catch(e){WL.quiet.note('補助表示のためベストエフォート。未設定・取得失敗時は単に出さない',e)}
 }
 renderScheduleInfo();
}
function configureToleranceSelector(){const el=$('#toleranceSource');if(!el||!S.measure)return;const type=$('#measureType').value,isDimensional=WL.measureItem.isDimensional(type),order=el.querySelector('option[value="order"]'),availability=WL.measureInput.orderToleranceAvailability();order.disabled=!availability.available;order.textContent=availability.available?'オーダー公差':'オーダー公差（データなし）';order.classList.toggle('order-tolerance-unavailable',!availability.available);if(!availability.available&&S.measure.settings.toleranceSource==='order')S.measure.settings.toleranceSource='manufacturing';el.value=S.measure.settings.toleranceSource||'manufacturing';el.disabled=!isDimensional;el.title=isDimensional?(availability.available?'製造公差またはオーダー公差を選択できます':'オーダー公差がないため製造公差のみ使用できます'):'板厚・板幅以外は指示公差を自動適用します';
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
   if(!usable&&pick&&!pick.hidden){pick.hidden=true;fold?.setAttribute('aria-expanded','false')}}}el.onchange=()=>{if(el.value==='order'&&!availability.available)return;S.measure.settings.toleranceSource=el.value;WL.measureInput.renderMeasureGrid();updateMeasurementHeading();markDirty()}}
/* 作業時間パネル。開始→終了の順序を強制するロック付き打刻。 */
/* 作業時刻は**分まで**（§9.242 ①、利用者の指示「秒数は不要です」）。
   欄が分刻みになった以上、帳票・トーストだけ秒を出すと**同じ時刻が場所に
   よって違う長さで出る**（読む側は「別の値かもしれない」と数え直す）。 */
function formatWorkTime(value){if(!value)return '';const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
function stampWorkTimeLocked(kind){if(!S.measure)return;S.measure.workTime=S.measure.workTime||{};const now=new Date();if(kind==='start'){if(S.measure.workTime.endAt){showToast('開始時刻は変更できません','終了時刻の記録後は開始時刻を変更できません。');return}S.measure.workTime.startAt=now.toISOString()}else{if(!S.measure.workTime.startAt){showToast('開始時刻が未記録です','先に開始時刻を記録してください。');return}if(now<new Date(S.measure.workTime.startAt)){showToast('終了時刻を記録できません','終了時刻は開始時刻より後である必要があります。');return}S.measure.workTime.endAt=now.toISOString()}updateWorkTimePanel();markDirty();updateValidationVisuals()}
function updateWorkTimePanel(){const own=WL.measureHooks.owner('workTimePanel');if(own)return own();if(!S.measure)return;S.measure.workTime=S.measure.workTime||{startAt:'',endAt:''};const start=$('#workStartAt'),end=$('#workEndAt');if(!start||!end)return;start.dataset.iso=S.measure.workTime.startAt||'';end.dataset.iso=S.measure.workTime.endAt||'';start.value=formatWorkTime(start.dataset.iso);end.value=formatWorkTime(end.dataset.iso);$('#stampWorkStart').disabled=!!S.measure.workTime.startAt;$('#stampWorkEnd').disabled=!S.measure.workTime.startAt||!!S.measure.workTime.endAt;[[ $('#workStartCard'),start.dataset.iso],[ $('#workEndCard'),end.dataset.iso]].forEach(([card,value])=>{card?.classList.toggle('validation-required',!value);card?.classList.toggle('validation-valid',!!value)});$('#workDuration').textContent=S.measure.workTime.endAt?`実作業時間 ${WL.base.formatDuration(WL.base.durationMs(S.measure))}`:S.measure.workTime.startAt?'作業中':'未計測';$('#stampWorkStart').onclick=()=>stampWorkTimeLocked('start');$('#stampWorkEnd').onclick=()=>stampWorkTimeLocked('end');
 /* 自動で入る値（§9.234 ②）。開始・終了・実働時間を欄として置けるように
    なったので、打刻したらその場で引き直す（読み直すまで古いままにしない）。 */
 if(window.WL&&WL.opData&&WL.opData.paintAuto)WL.opData.paintAuto();}
document.querySelectorAll('[data-worktab]').forEach(b=>b.onclick=()=>activateWorkspace(b.dataset.worktab));
WL.base.bindTabs('left','left');
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
 /* 「選ばない」の札は候補ではない（§9.286 ⑤。値は空文字になった）。
    **`'-'`も落とす**——古い記録・古い保存値がまだ持っている。 */
 const listOf=id=>[...($('#'+id)?.options||[])].map(o=>o.value).filter(v=>!WL.optionBlank(v));
 function mark(id,on){
  const box=document.querySelector(`.selectors [data-f="${id}"]`);
  if(!box)return;
  box.classList.toggle('has-master-diff',!!on);
  let b=box.querySelector('.master-diff-badge');
  if(on&&!b){
   b=document.createElement('button');
   b.type='button';b.className='master-diff-badge';b.textContent='更新あり';
   b.title='マスタの選択肢が変わりました。押すと取り込みます。';
   b.onclick=async e=>{e.preventDefault();await WL.records.loadMeasurementContext(true);check()};
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
 function start(){stop();timer=setInterval(()=>{check().catch(WL.quiet('マスタの新旧を確かめられない（次の巡回で確かめ直す）'))},CHECK_MS)}
 function stop(){if(timer){clearInterval(timer);timer=null}
  FIELDS.forEach(([id])=>mark(id,false))}
 return{check,start,stop};
})();
$('#verticalCount').addEventListener('change',()=>{updateLengthOptions($('#verticalCount').value);WL.measureInput.renderMeasureGrid()});
$('#horizontalCount').addEventListener('change',()=>{
 /* 設備ごとの最大条数を超えた入力はその場で戻す。max属性だけだとスピナーは
    止まるが、手打ち・貼り付けは通ってしまう。 */
 const el=$('#horizontalCount'),max=currentMaxStrips();
 if(Number(el.value)>max){
  el.value=String(max);
  showToast?.('条数を上限に合わせました',`この設備で割れるのは最大${max}条です。`,4000);
 }
 /* ---------- 屑幅がマイナスになる条数は物理的に無理（§9.210 ⑤、利用者の指示） --
    母材（元幅・実績）より条幅の合計が広くなる割り方は存在しない。**戻すだけ
    にしない**——何がぶつかっているのか（元幅／製造板幅）と、増やしたければ
    どこを直すのかまで書く（§6）。判断できないロットでは`null`が返るので
    素通しする（§CLAUDE「読めなければ黙って判定をやめる」）。 */
 const lim=WL.split?.stripCountLimit?.();
 if(lim&&Number(el.value)>lim.max){
  el.value=String(lim.max);
  showToast?.('これ以上は条を割れません',
    `元幅（実績）${lim.original}mm ÷ 製造板幅 ${lim.width}mm ＝ 最大 ${lim.max}条です。`
    +'これ以上増やすと屑幅がマイナスになります。増やすなら母材（元幅）を直してください。',7000);
 }
 updateCoilOptions(el.value);WL.measureInput.renderMeasureGrid();
});
function lockCounts(){const has=Object.values(S.measure.measurements).some(a=>a.flat().some(v=>v!==''));$('#verticalCount').disabled=has;$('#horizontalCount').disabled=has}

/* ============================================================
   外へ出す面（§9.359・REVIEW 3-17）。**ここに載せた名前だけ**が外から
   呼べる。載せ忘れは `no-undef` が教える——**ただし `typeof x` は教えない**
   （§9.355）。外から使う側は `typeof WL.measureView.x==='function'`。
   ============================================================ */
WL.measureView={
 ensureMeasureShape,blankMeasure,blankProductRow,collect,
 renderMeasurement,renderProductPanel,renderQualityGradePanel,renderRecordedValues,
 applyMeasureItemOptions,
 renderCourseHierarchy,renderResidualCourseEverywhere,paintQualityInfo,
 refreshScheduleInfo,applyRightLayout,
 updateValidationVisuals,showValidationMessage,activeRequiredControls,
 judgeInput,judgeProductRow,
 updateCoilOptions,updateLengthOptions,updateMeasurementHeading,
 applyMaxStripsToInputs,syncInputModeLock,configureToleranceSelector,
 lockCounts,motherFieldLabel,PRODUCT_FILLED_KEYS,
 formatWorkTime,stampWorkTimeLocked,
 loadFlatComment,saveFlatComment,
};
})();
