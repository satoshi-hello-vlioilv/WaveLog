"use strict";
/* master-maint.js: マスタ管理画面(統合パネル・編集モーダル・特殊タブ)
   ============================================================
   measurement-worklog.js から分離した(docs/REFACTORING_PLAN.md フェーズ3.1)。
   分離前は同ファイルの92%(1,700行超)がマスタ管理で、「マスタ管理を直すのに
   measurement-worklog を開く」状態が誤読・誤編集の温床になっていた。
   関数はそのまま移しており、改名・再分割はしていない(移動と分割を同時に
   やると差分レビューが不能になるため)。

   読み込み順は templates/index.html を参照。base.js の WL.registerView() を
   使うので base.js より後、access-mode.js より前に置くこと。
   ============================================================ */
(function(){
 /* ---------- マスタ管理モーダル（刷新版: 大画面・高密度・検索・IDリネーム更新） ---------- */
 const MASTER_DEFS=[
  /* ---------- オペレータ・機器・スプール種別・内径種別・バリ揃え・
     コイル止めは「選択肢の値」へ移した（§9.221 ③、利用者の指示） ----------
     「オペレータ、機器、スプール種別、内径種別、バリ揃え、コイル止めに
      ついても汎用化した操業データ項目マスタに移行させてください」

     6つとも中身は「名前の一覧」で、違いはオペレータが持っていた
     ヨミガナと作業可能設備だけだった。その2つは選択肢の側の`[よみ]`／
     `[対象設備]`にしたので、**まとまり名が違うだけの同じもの**になる。
     タブを6つ並べる理由が無くなったので畳んだ——探す場所が1つになる。 */
  /* 設備はインラインのまま(§9.114)。項目が4つになってモーダルの基準に
     かかるが、**どれも短い1行**なのでフォームは縦に伸びず、モーダルにする
     理由(一覧を圧迫する)が当てはまらない。設備の登録は他マスタの下ごしらえ
     として一番よく使うので、1画面で完結するほうが速い。 */
  /* ---------- 操業データ（§9.215、利用者の指示） ----------
     「項目自体をマスタ化し他の設備でも使えるように設備ごとに持たせ、変更
      できるようにする、設定値も必要に応じてマスタ化して関連付け。各項目ごと、
      入力方式や入力上限値、入力データの型を選べるようにする」。
     項目と選択肢を**別のマスタ**にしてあるのは、同じ選択肢（リング色など）を
     複数の項目が参照するため。結び付けは**名前**で行う（IDだと別PCで連番が
     食い違う。§9.171）。 */
  /* **並べたときにどう見えるかを出す**（§9.216 ④）。行を1つずつ編集する
     一覧では、カードに収まるかどうかも群のまとまりも分からない。
     `special`の画面で測定画面と同じ6列のグリッドを出し、掴んで動かす。
     `fields`/`cols`は残す——編集モーダルの部品としてではなく、
     `tests/test_crudroutes.py`が4本のCRUDを見張る材料になっている。 */
  {group:'measure',key:'opItem',label:'操業データ項目',icon:'操',endpoint:'/api/operation-item-master',
   hasDelete:true,special:'op-item',titleText:'操業データ — 測定画面に出す入力欄と並び',
   fields:[{k:'equipment',label:'対象設備',type:'equipment-multi-text',required:true,key:true,
            tagHint:'この項目をどの設備の測定画面へ出すかです。複数選べます。「すべての設備」を選ぶと、これから増える設備でも自動的に出ます。'},
           {k:'group',label:'群',hint:'測定画面でひとまとまりに並べる見出しです（例: 巻取り／スリット）。空欄なら「その他」。'},
           {k:'name',label:'項目名',required:true,key:true,
            hint:'測定画面に出る名前で、記録の鍵にもなります。**変えると、それまでの記録は前の名前のまま残ります。**'},
           {k:'type',label:'型',type:'select',options:['整数','正の整数','数値','正の数','選択','文字'],
            hint:'整数=小数点なし／正の◯=マイナス不可／選択=下の「選択肢」から選ぶ／文字=自由記述。'},
           {k:'decimals',label:'小数桁',type:'number',min:0,max:4,
            hint:'小数点以下の桁数（型が「数値」「正の数」のときだけ効きます）。空欄なら1桁。'},
           {k:'min',label:'最小値',type:'number',hint:'これより小さい値は入力時に戻します。空欄なら下限なし。'},
           {k:'max',label:'最大値',type:'number',hint:'これより大きい値は入力時に戻します。空欄なら上限なし。'},
           {k:'choice',label:'選択肢',type:'master-combo',source:{endpoint:'/api/operation-choice-master',valueKey:'name'},
            hint:'型が「選択」のとき、操業データ選択肢マスタのどのまとまりから選ばせるかです。名前で結び付けます。'},
           {k:'unit',label:'単位',hint:'欄の右へ小さく添えます（mm など）。'},
           {k:'widget',label:'選ばせ方',type:'select',options:['プルダウン','ラジオ','タブ','一覧'],
            hint:'型が「選択」のときの見せ方です。プルダウン=畳んで1行／ラジオ=全部見えたまま／タブ=横に連なる帯／一覧=押すと浮き窓で説明つき。'},
           {k:'order',label:'表示順',type:'number',min:0,step:10,
            hint:'小さいほど上に出ます。空欄で保存すると今の並びのままです。'}],
   cols:[{k:'equipment',label:'対象設備',grow:2,format:'equipmentTarget'},{k:'group',label:'群',grow:1},
         {k:'name',label:'項目名',grow:2},{k:'type',label:'型',grow:1},
         {k:'choice',label:'選択肢',grow:1},{k:'order',label:'表示順',grow:1}],
   hint:'測定画面①準備の「操業データ」に出る入力欄です。1行＝1つの欄で、設備ごとに変えられます（「すべての設備」を選べば設備が増えても登録し直す必要はありません）。**値そのものは測定データの中に入る**ので、このマスタには記録は残りません。項目名を変えると、それまでに記録した値は前の名前のまま残ります（消えはしませんが、新しい名前の欄は空で始まります）。'},
  /* ③確認の「記録した値」のカードの並べ方（§9.243、利用者の指示「現在
     操業データ項目マスタで設定している内容を候補に出して視覚的に配置して
     設定できるようなマスタを別で追加立ち上げして簡単にD&Dで配置修正
     再設定、編集できるようにしてほしいです」）。
     **操業データ項目とは別の画面**にしてある——あちらは「何を記録するか」、
     ここは「どう並べるか」。1枚に混ぜると盤の1枚のカードが2つの並びを
     同時に表すことになる。書くのは`[記録表示]`／`[記録群]`／`[記録順]`の
     3列だけで、汎用CRUDは持たない（`endpoint`はGETの読み口）。 */
  /* ---------- 入力値の丸め（§9.305 ①、利用者の指示） ----------
     「0.5単位切り上げなど、入力値の切り上げ機能を実装してください。
      導入したい項目は ①ラテラルボー ②テレスコープ ③巻ズレ ④揃いの値。
      可能であれば他の入力項目についても、汎用的に設定できるように」

     **1行＝1つの入力の決まり**（刻みと向きだけ）。**行を消せば丸めない**。
     選べる入力も向きも**サーバーが答える**（`targets`／`modes`）ので、
     画面には綴りを書き写さない（§9.163）。 */
  {group:'measure',key:'measureItem',label:'入力値の丸め',icon:'丸',
   endpoint:'/api/measure-item-master',hasDelete:true,editorModal:true,
   titleText:'入力値の丸め — どの入力を、いくつ刻みで',
   fields:[{k:'key',label:'どの入力',type:'choice-card',source:{key:'targets'},
            required:true,key:true,fieldGroup:'① どの入力を丸めるか',
            hint:'**1つの入力につき決まりは1つ**です（同じ入力をもう一度登録すると上書きになります）。'},
           {k:'unit',label:'刻み',type:'number',unit:'mm',step:0.1,min:0,required:true,
            fieldGroup:'② いくつ刻みで・どちら向きに',
            hint:'**0.5**なら 0.5・1.0・1.5… の段へそろえます。**打ち終わって欄を離れたとき**に効きます（打っている最中は変わりません）。',
            more:'測定器から転送された値にも同じ決まりが効きます（板厚・板幅を選んだ場合）。'},
           {k:'mode',label:'向き',type:'choice-card',source:{key:'modes'},
            fieldGroup:'② いくつ刻みで・どちら向きに',
            hint:'**切り上げ**が既定です。'},
           {k:'note',label:'メモ',fieldGroup:'③ 覚え書き',
            hint:'なぜこの刻みなのかを書いておくと、あとで見直すときに助かります。'}],
   cols:[{k:'label',label:'どの入力',grow:2},{k:'unit',label:'刻み',grow:1,format:'roundUnit'},
         {k:'mode',label:'向き',grow:1},{k:'note',label:'メモ',grow:2}],
   hint:'測定画面で**打ち終わった値**を、決めた刻みの段へそろえます（例: 0.5刻みで切り上げ→`1.2`は`1.5`）。'
     +'**登録した入力だけ**が対象で、行を消せば今までどおり打った値がそのまま残ります。'
     +'ラテラルボー・テレスコープ・巻ずれ・揃いの値には、はじめから0.5刻みの切り上げが入っています。',
   hintMore:'<p>効くのは<b>欄を離れたとき</b>だけです。打っている最中に丸めると、`0.2`を打つ途中の`0.`で値が飛んでしまうためです。</p>'
     +'<p>板厚・板幅を選んだ場合は<b>測定器から転送された値にも</b>効きます——手入力と転送で違う値になるほうが分かりにくいためです。</p>'
     +'<p>保存済みの記録は書き換えません。開き直しても、記録された値はそのまま出ます。</p>'},
  {group:'measure',key:'recordLayout',label:'記録した値の配置',icon:'記',
   special:'record-layout',endpoint:'/api/operation-item-master',
   titleText:'記録した値 — ③確認のカードの並べ方',
   /* 汎用の一覧・編集モーダルは通らない（`special`で分岐する）。`cols`が
      空だと`def.cols[0].k`を読む箇所が投げうるので1つだけ置いておく。 */
   fields:[],cols:[{k:'name',label:'項目名'}],
   hint:'測定画面③確認の「記録した値」のカードに、どの項目をどの順で出すかです。候補は**操業データ項目マスタ**の項目で、ここで並べても項目そのもの（型・選択肢・単位）は変わりません。**並びは設備によらず共通**です。'},
  /* **名前は1行に収まる長さにする**（§9.218 ③、利用者の指摘「『操業データ
     選択肢』が文字数の関係でこれだけ折り返しが発生して見栄えが悪い」）。
     左の一覧は幅が決まっているので、8文字だとここだけ2行になっていた。
     何のマスタかは**アイコン（択）・すぐ上の「操業データ項目」・題と説明**が
     言うので、名前は短くてよい。 */
  /* **まとまり名で階層にする**（§9.221 ②、利用者の指示「まとまり名毎に
     まとめて管理したいです。まとまり名毎にさらに子マスタを持つような感じに
     してマスタに階層構造を持たせたいです」）。左＝まとまり／右＝その中の値。
     `fields`/`cols`は残す——編集モーダルの部品としてではなく、
     `tests/test_crudroutes.py`が4本のCRUDを見張る材料になっている
     （操業データ項目マスタと同じ扱い）。 */
  {group:'measure',key:'opChoice',label:'選択肢の値',icon:'択',endpoint:'/api/operation-choice-master',hasDelete:true,
   special:'op-choice',
   titleText:'操業データの選択肢 — まとまりと値',
   /* **編集は汎用モーダル1枚**（§9.222 ⑥、利用者の指示「オペレータマスタなど
      移行したものも同じ汎用モーダルから登録したいので、選択肢欄など必要な
      項目はすべて共通化」）。よみ・出る設備・出すの3つを足したことで、
      オペレータマスタが持っていた項目がすべてここで揃う——**設備は
      `equipment-multi-text`なので、汎用のタグ入力（設備マスタからサジェスト）が
      そのまま効く**（§9.164。同じ道具を書き写さない）。 */
   fields:[{k:'name',label:'まとまり名',required:true,key:true,
            hint:'まとまりの名前です。操業データ項目マスタの「選択肢」からこの名前で参照します（例: リング色）。'},
           {k:'value',label:'値',required:true,key:true,hint:'実際に選ばせる1つの値です（例: 茶）。'},
           {k:'note',label:'説明',
            hint:'選ばせ方を「一覧」にしたときに、値の下へ小さく出ます。**選択肢が多いときに何を選べばよいか**を書きます（例: 大径リング用）。空欄なら値だけが出ます。'},
           {k:'reading',label:'よみ',
            hint:'探すための読みです（例: サトウ）。まとまりの絞り込みで使います。'},
           {k:'equipment',label:'出る設備',type:'equipment-multi-text',
            tagHint:'この値を出す設備です。**空欄＝すべての設備**（オペレータの「割当が無ければ制限なし」と同じ）。「すべての設備」を選ぶと、これから増える設備でも出ます。'},
           {k:'enabledText',label:'出す',type:'select',options:['出す','出さない'],
            hint:'「出さない」にすると選択肢に出なくなります。**記録は消えません**（過去のデータはそのまま読めます）。'},
           {k:'order',label:'表示順',type:'number',min:0,step:10,
            hint:'小さいほど先に出ます。空欄で保存すると今の並びのままです。'}],
   cols:[{k:'name',label:'まとまり名',grow:2},{k:'value',label:'値',grow:1},
         {k:'note',label:'説明',grow:2},{k:'order',label:'表示順',grow:1},
         /* **どの項目が使っているか**(§9.216 ④)。使い道の見えない選択肢は
            消してよいのか判断できず、消すと項目側は黙って空の欄になる。 */
         {k:'usedBy',label:'使っている項目',grow:3}],
   hint:'操業データの「選択」型の項目で選ばせる値です。1行＝1つの値で、同じまとまり名の行がまとまって1つの選択肢になります。**同じまとまりを複数の項目が参照できます**（大径リング色と小径リング色はどちらも「リング色」を見ています）。ここで値を足すと、参照しているすべての項目の選択肢に増えます。**値を足すだけなら「操業データ項目」の設定の窓からもできます**（項目を作る手を止めなくて済みます）。'},
  /* ---------- ロールマスタ（§9.239 ⑥、利用者の指示） ----------
     「ロールマスタは『設備／入出位置／接触面／ロール径MAX／ロール径MIN／
      ロール面長／材質／硬度／本数／ロール名／ロール使用条件／駆動方式／
      基準番号／備考』という種類だけカラムを持つものとする。設備のカラムは
      マスタに親子関係を持たせ、設備単位でロールマスタを持つ形とする」

     **設備を親、ロールを子として束ねて出す**（`groupBy:'equipment'`）。
     マスタを2つに割らずに階層を作れるので、所属を変えるのは`[対象設備]`を
     1つ直すだけで済む（割ると、移すために消して作り直すことになる）。
     欄は14あるので`fieldGroup`で4つの塊に分ける（§9.222 ⑦
     「決めることが10を超える窓は塊に分ける」）。
     **先頭は1行に続けて書くこと**——`tests/test_crudroutes.py`の正規表現は
     空白・改行を許さないので、ここで改行すると4本のCRUDの検査から
     静かに外れる。 */
  {group:'equip',key:'roll',label:'ロール',icon:'ロ',endpoint:'/api/roll-master',hasDelete:true,
   titleText:'ロール — 設備ごとのロールの諸元（異常位置判定のピッチ照合に使います）',
   /* Excelの持ち出し・取り込み（§9.240、利用者の指示）。**印を1つ付けるだけ**で
      帯が出る差し替え口にしてある——他のマスタが要るときも、ここに
      `excelIo:true` を足せば同じ帯が乗る（画面のコードを増やさない）。 */
   excelIo:true,
   /* **まとめて消せる**（§9.251、利用者の指示「ロールマスタの全削除機能
      （ロールマスタの完全入替機能）を実装してください」）。`excelIo`と同じく
      **印1つ**で、範囲（すべて／設備を1つ）と件数の確認は画面の共通の流れが
      持つ。**取り消せない操作なので主要動線から離す**（§CLAUDE 5）——
      帯のいちばん右へ寄せてある。 */
   bulkDelete:true,
   /* **設備が親・ロールが子**（§9.239 ⑥ 訂正、利用者の指示「厳密に設備を
      割ってから、個別にロール管理したい。1ロール1設備が正しい」）。
      束ねる鍵は`equipment`で、1行は必ず1つの設備に属する。 */
   groupBy:'equipment',
   fields:[{k:'equipment',label:'設備',type:'equipment-select',required:true,key:true,fieldGroup:'① どの設備のどこのロールか',
            hint:'**このロールが付いている設備を1つだけ**選びます。ロールは設備ごとに実物が違うので、同じ呼び名でも設備が違えば別のロールとして登録してください（複数の設備をまとめて指定することはできません）。'},
           {k:'name',label:'ロール名',required:true,key:true,fieldGroup:'① どの設備のどこのロールか',
            hint:'現場での呼び名です。**同じ名前でも、接触面・ロール径・備考のどれかが違えば別のロールとして登録できます。** 6つとも同じロールは2つ置けません（どちらの径で判定するか決まりません）。**別の設備でも**同じ名前を使えます。'},
           {k:'entryPos',label:'入出位置',type:'master-suggest',source:{key:'entryPositions'},fieldGroup:'① どの設備のどこのロールか',
            hint:'ラインのどこにあるかです（入側／出側／中間 など）。**一覧に無い呼び名も打てます。** 取り込みの突き合わせには使いません（設備＋ロール名＋接触面で見ます）。'},
           {k:'contactFace',label:'接触面',type:'master-suggest',source:{key:'contactFaces'},key:true,fieldGroup:'① どの設備のどこのロールか',
            hint:'材料のどの面に当たるかです（上／下／**上下**）。欠陥が出た面で候補を絞れます。**1本を見分ける6つのうちの1つ**なので、同じ名前でも接触面が違えば別のロールとして残ります。**一覧に無い呼び名も打てます。**'},
           {k:'diaMax',label:'ロール径MAX',type:'number',min:0,step:0.1,unit:'mm',required:true,key:true,fieldGroup:'② 寸法',
            hint:'**判定の主役**です。欠陥のピッチ＝この径の周長（π×径）と比べます。**1本を見分ける6つのうちの1つ**——同じ設備・同じ名前・同じ接触面でも、径が違えば別のロールとして登録できます。'},
           {k:'diaMin',label:'ロール径MIN',type:'number',min:0,step:0.1,unit:'mm',key:true,fieldGroup:'② 寸法',
            hint:'摩耗後の下限です。入れると周長が「幅」になり、その範囲で判定します。**空欄ならMAXの1点で判定します**（0を入れないでください）。MAXと対で**1つの諸元**なので、こちらも1本を見分ける6つに入ります。'},
           {k:'faceLen',label:'ロール面長',type:'number',min:0,step:1,unit:'mm',fieldGroup:'② 寸法',
            hint:'胴の長さです。判定には使いませんが、板幅と突き合わせるときの目安になります。'},
           {k:'count',label:'本数',type:'number',min:0,step:1,unit:'本',fieldGroup:'② 寸法',
            hint:'同じ諸元のロールが何本あるかです。'},
           {k:'material',label:'材質',fieldGroup:'③ 仕様',hint:'ゴム・鋼・ウレタンなど。'},
           {k:'hardness',label:'硬度',fieldGroup:'③ 仕様',hint:'例: Hs70。単位ごと入れてかまいません。'},
           {k:'driveKind',label:'駆動方式',type:'master-suggest',source:{key:'driveKinds'},fieldGroup:'③ 仕様',
            hint:'駆動／従動／フリー など。'},
           {k:'useCond',label:'ロール使用条件',fieldGroup:'③ 仕様',
            hint:'どんなときに使うロールかです（例: 薄板のみ）。'},
           {k:'refNo',label:'基準番号',fieldGroup:'④ 管理',hint:'図面番号・管理番号など。'},
           {k:'note',label:'備考',size:'lg',key:true,fieldGroup:'④ 管理',
            hint:'**1本を見分ける6つのうちの1つ**です（利用者の指示）。他の4つが同じでも、備考が違えば別のロールとして残ります。**Excelでここを書き直すと「直す」ではなく「増える」ので**、直したいときは取り込み方を「入れ替える」にするか、この画面で直してください。'},
           {k:'order',label:'表示順',type:'number',min:0,step:10,fieldGroup:'④ 管理',
            hint:'小さいほど先に出ます。空欄で保存すると今の並びのままです。'},
           {k:'enabledText',label:'有効',type:'select',options:['有効','無効'],fieldGroup:'④ 管理',
            hint:'「無効」にすると判定の候補から外れます。**行は消えません。**'}],
   cols:[{k:'name',label:'ロール名',grow:2},{k:'entryPos',label:'入出位置',grow:1},
         {k:'contactFace',label:'接触面',grow:1},{k:'diaMax',label:'径MAX',grow:1},
         {k:'diaMin',label:'径MIN',grow:1},{k:'faceLen',label:'面長',grow:1},
         {k:'count',label:'本数',grow:1},{k:'material',label:'材質',grow:1},
         {k:'refNo',label:'基準番号',grow:1}],
   hint:'設備ごとのロールの諸元です。**1つのロールは1つの設備に属します**——同じ呼び名でも設備が違えば別のロールとして、それぞれ登録してください。**1本を見分けるのは「設備名＋ロール名＋接触面＋ロール径MAX＋ロール径MIN＋備考」の6つ**です（その欄には「キー」と付けてあります）。6つとも同じロールは2つ置けませんが、**どれか1つでも違えば別のロールとして並べられます**。**Excelの取り込みも同じ6つで突き合わせます**——だから**径や備考をExcelで書き直すと、その行は「直す」ではなく「増える」**ことに注意してください（直すつもりのときは取り込み方を「入れ替える」にするか、この画面で直します。下見の「追加 / 上書き」の件数で押す前に分かります）。**測定画面の「異常位置判定」→「② 長手方向（ロールを特定）」**で、欠陥のピッチ（繰り返しの間隔）から該当しそうなロールを探すのに使います。判定に効くのは**ロール径MAX**（周長＝π×径）で、**ロール径MIN**も入っていれば摩耗の範囲として幅を持たせて判定します。一覧は設備ごとにまとまって出ます。'},
  /* ---------- 帳票レイアウト（§9.254 ③、利用者の指示） ----------
     「帳票の表示画面からいける、レイアウト調整画面ですが、これは実質、
      帳票レイアウトマスタなので、マスタとしても配置し、この帳票レイアウト
      マスタと帳票ブロックマスタを配線しリンクさせて…機能が重複する部分は
      統合して帳票マスタとして親子関係のある高性能マスタとして」

     **親＝設備1つぶんの紙**（列レイアウトマスタの`report:<設備>`。§9.174）／
     **子＝その紙に載る塊**（帳票ブロックマスタの行＋コードが持つ既定の塊）。
     すぐ下の「帳票ブロック」と対で読む並びにしてある（親→子）。

     **組み換えの画面を写さない**（§9.163）。紙の上でどこへ置けるか・
     何マスに収まるかは`WL.reportLayout`の1本が答え、細かい置き場所は
     「紙で組み換える」で**同じ組み換え画面**へ連れて行く（入口を2つに
     しない・§9.207）。ここが受け持つのは、組み換え画面と重複していた
     **出す/出さない・幅・高さ・紙の割り**——一覧で見比べながら直せる形。 */
  {group:'report',key:'reportLayout',label:'帳票レイアウト',icon:'配',
   special:'report-layout',endpoint:'/api/column-layout-master',
   titleText:'帳票レイアウト — 設備ごとの紙（親）と、そこに載る塊（子）',
   /* 汎用の一覧・編集モーダルは通らない（`special`で分岐する）。`cols`が
      空だと`def.cols[0].k`を読む箇所が投げうるので1つだけ置いておく。 */
   fields:[],cols:[{k:'equipment',label:'設備'}],
   hint:'設備ごとの帳票の紙です。**1行＝1つの設備の紙**で、その紙に載る塊（子）を右に並べます。塊そのもの（名前・種別・載せる項目）は下の**帳票ブロック**が持ち、ここが決めるのは**その設備の紙でどう出るか**——出す/出さない・幅・高さ・紙の割り（列×段）です。細かい置き場所は「紙で組み換える」から、**見本のロットで実際の紙を見ながら**動かせます（その設備で測ったロットがこの端末に無くても直せます）。'},
  /* 帳票ブロックマスタ（§9.217、利用者の指示「内部データについても各項目
     ごと設計できるように、編集追加などできるように」）。中身の作り方が
     仕事になっている塊（測定表・条の図・異常位置判定）はコードの側のままで、
     **「ラベルと値の出どころを並べただけの塊」だけ**を現場が足せる。 */
  {group:'report',key:'reportBlock',label:'帳票ブロック',icon:'票',
   endpoint:'/api/report-block-master',hasDelete:true,
   titleText:'帳票ブロック — 紙に載せる塊',titleKey:'name',
   asideHtml:()=>rbAsideHtml(),bindAside:form=>rbBindAside(form),
   groupsAsTabs:true,
   /* **見本のロットで刷り上がりを見る**（§9.253、利用者の指示）。
      印1つで帯にボタンが出る差し替え口（`excelIo`・`bulkDelete`と同じ）。 */
   sampleReport:true,
   /* **親（紙）へ渡る**（§9.254 ③）。ここが決めるのは塊そのもの（名前・
      種別・載せる項目・既定の幅と高さ）で、**設備ごとの紙でどう出るか**は
      帳票レイアウトが持つ。行き来の口を出しておかないと、どちらで直すのか
      を毎回思い出すことになる（§2）。 */
   linkTo:{key:'reportLayout',label:'紙での見え方（帳票レイアウト）',
           title:'この塊が設備ごとの紙でどう出るか（出す/出さない・幅・高さ・置き場所）は帳票レイアウトで決めます'},
   hintShort:'①から④の順に決めます。**右の見本が刷り上がりです**——'
    +'**紙の中の塊は四方どこでも掴んで大きさを変えられます**（幅・高さの札でも決められます）。'
    +'**既定の塊は消せません**（紙へ出したくないときは④を「出さない」に）。',
   /* ---------- 決めることを4つに束ねる（§9.249 ③、利用者の指示） ----------
      「モーダルを大きくしてください。大きくしたモーダルに合うようにバランス
       よく再構築して、もっとわかりやすく視覚化した形で表示を工夫し設定し
       やすいものを作成してください。文字が多いわりにわかりにくく、情報の
       階層化、チャンク化も駆使し」

      以前は**11の欄が平らに並び**、どれも長い説明文を抱えていた。
      決めることは実際には4段階で、しかも**紙のどこにどう出るか**は
      文字では伝わらない（「6マス」が紙の何割かを頭の中で割り算していた）。

       ① これは何の塊か   … 設備・名前・種別
       ② 何を載せるか     … 中身（種別で変わる）
       ③ 紙のどこへ出すか … 幅・高さ・列数・繰り返し
       ④ 出す・並び       … 有効・表示順

      ①→④は**実際に決める順番**なので、視覚導線と作業導線が一致する
      （§CLAUDE 14）。幅と高さは**紙のマス目そのもの**を押して決め、
      右の見本が刷り上がりの位置と大きさを常に映す。 */
   fields:[{k:'equipment',label:'対象設備',type:'equipment-multi-text',required:true,key:true,
            fieldGroup:'① これは何の塊か',
            tagHint:'この塊をどの設備の帳票へ出せるようにするかです。「すべての設備」を選ぶと、これから増える設備でも使えます。'},
           {k:'name',label:'ブロック名',required:true,key:true,size:'lg',
            fieldGroup:'① これは何の塊か',
            hint:'帳票の見出しになります。',
            more:'幅・高さ・並びの設定の鍵にもなります。同じ設備に同じ名前を2つ置かないでください（どちらの設定か決まりません）。'},
           /* 塊の種別（§9.234 ⑤）。**選ぶ前に違いが読める形にする**——
              名前だけのプルダウンでは「エリア」が何なのか開くまで分からない。 */
           {k:'kindText',label:'種別',type:'choice-card',
            fieldGroup:'① これは何の塊か',
            cards:[{v:'項目の並び',icon:'≣',label:'項目の並び',note:'ラベルと値を並べて刷る'},
                   {v:'エリア（枠と文字）',icon:'▢',label:'エリア',note:'値は出さず、場所だけ空ける'}],
            hint:'「エリア」は**高さを③で決めてください**（「中身なり」だと1行に潰れます）。',
            more:'エリアはラベル貼付・手書き・確認印のように、値を出さず場所を空けるだけの塊です。'},
           /* §9.226 ④。**選んで組み立てる**（手で道を書かせない）。 */
           {k:'content',label:'載せる項目',type:'field-builder',when:{kindText:'項目の並び'},
            fieldGroup:'② 何を載せるか',
            hint:'左の候補を押すと右へ増え、**左上から順に紙へ並びます**。',
            more:'掴んで並べ替え、名前はその場で直せます。候補には操業データ項目マスタで足した項目もそのまま出ます。空のままなら、画面がもともと持っている中身で出ます。'},
           {k:'text',label:'エリアに置く文字',type:'textarea',rows:3,when:{kindText:'エリア（枠と文字）'},
            fieldGroup:'② 何を載せるか',
            hint:'改行できます。**値は入りません。**',
            more:'測定データを出したいときは種別を「項目の並び」にしてください。空のままなら枠だけの塊になります。'},
           /* 幅・高さは**紙のマス目を押して決める**（§9.249 ③）。 */
           /* 大きさは**既定**（§9.278、利用者の指示「サイズ調整は帳票に組むときが
              主なので、帳票ブロック作成時にはデフォルト設定位の意味として、
              実際にはレイアウト時に個別にサイズを持つのが好ましい。設備ごとに
              決めるべきもの」）。**欄の名前で言い切る**——`hint`に書くだけだと、
              説明を「短め」「出さない」にしている端末では読めない（§9.274）。 */
           {k:'span',label:'幅（既定）',type:'span-grid',options:['3','4','6','8','12'],max:12,
            fieldGroup:'③ 紙のどこへ出すか',
            hint:'紙は12マスのグリッドです。**実際の幅は設備ごとの紙で決めます。**',
            more:'ここは「まだその設備の紙で決めていないとき」に使われる値です。設備ごとの紙（帳票レイアウトマスタ、または帳票画面の「配置を組み換え」）で変えると、そちらが優先されます。'},
           {k:'rows',label:'高さ（既定）',type:'rows-pick',options:['','2','3','4','5','6','8','12'],
            fieldGroup:'③ 紙のどこへ出すか',
            hint:'1行＝24px。**「中身なり」は描いてから測ります。実際の高さは設備ごとの紙で決めます。**',
            more:'ここは「まだその設備の紙で決めていないとき」に使われる値です。行数を決めると下の段へ跨いで置けます。エリアは中身なりだと1行に潰れるので行数を決めてください。'},
           /* 内訳の列数（§9.255 ②／§9.277）。**紙が受ける12まで並べる**
              ——「表に組む」は「行の軸の数＋列の組み合わせ」を書き込むので、
              選択肢に無い数だと`<select>`の値が空になり、**組んだ表が
              既定の2列で刷られる**（実際にそうなった。7列で踏んだ）。 */
           {k:'cols',label:'内訳の列数',type:'select',
            options:['','1','2','3','4','5','6','7','8','9','10','11','12'],
            when:{kindText:'項目の並び'},
            fieldGroup:'③ 紙のどこへ出すか',
            hint:'空欄なら**中身の数から決まります**。',
            more:'節の中で「ラベル＝値」を何列に並べるかです。並べ方が「幅なり」「高さなり」のときは使いません（カードの大きさで決まります）。「表に組む」を押すと、組んだ表に合う数がここへ入ります。'},
           /* 繰り返し（§9.247 ②）。**分割の無いロットでは1回だけ**出る。 */
           {k:'repeatText',label:'繰り返し',type:'choice-card',
            when:{kindText:'項目の並び'},
            fieldGroup:'③ 紙のどこへ出すか',
            cards:[{v:'このロット全体（1回だけ）',icon:'１',label:'1回だけ',note:'このロット全体で1つ'},
                   {v:'分割後の子ロットごと',icon:'⋮',label:'子ロットごと',note:'異幅分割の子ロットの数だけ出す'}],
            hint:'**幅分割していないロットでは1回だけ**です。',
            more:'「子ロットごと」にすると、異幅分割で子ロット番号が複数あるロットで、この塊が子ロットの数だけ出ます。見出しに子ロット番号と条の範囲が付き、載せた「測定した値の統計」はその子ロットの条だけから数え直されます。板厚・板丈・肉厚は丈ごとに測るので子ロットに割り当てられず「—」になります。'},
           /* 繰り返しの向き（§9.277、利用者の指示「子ロット分縦に積む形が
              今までなので縦に積むが標準で横に積むか」）。**繰り返す塊の
              ときだけ出す**（§4。効かない設定を並べない）。 */
           {k:'repeatDirText',label:'繰り返しの向き',type:'choice-card',
            when:{repeatText:'分割後の子ロットごと'},
            fieldGroup:'③ 紙のどこへ出すか',
            cards:[{v:'縦に積む（既定）',icon:'↓',label:'縦に積む',note:'今までどおり上から順に'},
                   {v:'横に並べる',icon:'→',label:'横に並べる',note:'子ロットを左から右へ'}],
            hint:'**表に「対象」の軸を置いたときは使いません**（1つの表にまとまるため）。',
            more:'子ロットごとに描いた塊を、上から順に積むか、左から右へ並べるかです。横に並べると1件あたりの幅が狭くなるので、項目の少ない塊向きです。②で「表に組む」の軸に「対象」を行として入れた場合は、子ロットが1つの表の行になるのでこの設定は効きません。'},
           {k:'enabledText',label:'紙に出す',type:'choice-card',
            fieldGroup:'④ 出す・並び',
            cards:[{v:'有効',icon:'✓',label:'出す',note:'配置に置けば紙へ出る'},
                   {v:'無効',icon:'—',label:'出さない',note:'設定は残る。いつでも戻せる'}],
            hint:'**既定の塊を紙から外す手立てはこれだけです。**',
            more:'既定の塊は消せません。「出さない」にしても設定は残るので、いつでも戻せます。'},
           {k:'order',label:'表示順',type:'number',min:0,step:10,
            fieldGroup:'④ 出す・並び',
            hint:'小さいほど先に出ます。空欄で保存すると今の並びのままです。'},
           /* **組み込みの印は見せるが触らせない**（§9.219 ②）。 */
           {k:'builtin',label:'既定の塊',readonly:true,size:'md',
            fieldGroup:'④ 出す・並び',
            hint:'空欄＝**自分で作った塊**です。',
            more:'値が入っているものはアプリがもともと持っている塊で、名前・幅・高さ・並び・出す/出さない・対象設備を変えられます。この印は付け替えられません。'}],
   cols:[{k:'equipment',label:'対象設備',grow:2,format:'equipmentTarget'},
         {k:'name',label:'ブロック名',grow:2},{k:'kindText',label:'種別',grow:1},
         {k:'repeatText',label:'繰り返し',grow:1},
         {k:'builtin',label:'既定',grow:1},
         {k:'enabledText',label:'有効',grow:1},{k:'content',label:'内容',grow:4},
         {k:'span',label:'幅',grow:1},{k:'rows',label:'高さ',grow:1},{k:'order',label:'表示順',grow:1}],
   hint:'帳票の紙に載せる塊の一覧です。**アプリがもともと持っている塊もここに載っています**（「既定」に値が入っている行）。既定の塊は**名前・幅・高さ・並び・出す/出さない・対象設備**を変えられ、`基本情報`／`コース情報`／`測定条件`／`作業班構成`／`作業時間`／`登録状態`の6つは**中身**も変えられます。測定表・条の図・異常位置判定のように組み立て方そのものが仕事になっている塊は中身を変えられません。既定の塊は**消せません**——紙へ出したくないときは「紙に出す」を「出さない」にします。作った塊は帳票画面の「配置を組み換え」の「出していない塊」から紙へ落としてください。'},
  /* 設備は**表を主役にしてモーダルで直す**（§9.250 ⑦、利用者の指示
     「設備マスタは文字が多くUIの幅も無駄に長いのでもっとコンパクトにする
      ために、表をメインに、修正は他と同じようにモーダルで行うように」）。
     以前はインラインのフォームを常設しており、**5欄それぞれに長い説明が
     ぶら下がって上半分を占めていた**（一覧に残るのは数行）。ほかのマスタと
     同じ作法（`editorModal:true`）に揃え、説明は1行へ詰めて続きは
     見出しの`?`（`more`）から読む（§9.234 ①）。
     欄は**中身の長さから**決める（§CLAUDE 11）——設備名は名前1つ、
     残りは数値なので、規格幅の`sm`/`xs`に収まる。 */
  {group:'equip',key:'equipment',label:'設備',icon:'設',endpoint:'/api/equipment-master',hasDelete:true,
   editorModal:true,titleText:'設備 — この工場のライン',
   hintShort:'1行＝1つの設備です。**行を押すと編集の窓が開きます。**',
   fields:[{k:'name',label:'設備名',required:true,key:true,size:'md',
            fieldGroup:'① どの設備か',
            more:'この名前で作業予定・ロール・停止・権限などが結び付きます。変えると、その名前を指していた設定も一緒に付け替わります。'},
           {k:'kind',label:'区分',type:'select',options:['','コイル','板'],
            fieldGroup:'① どの設備か',
            hint:'扱う材料の形。**空欄でも登録できます。**',
            more:'コイル／板。既に登録してある設備は未設定のままでも今までどおり動きます。'},
           {k:'maxStrips',label:'最大条数',type:'number',min:1,max:40,unit:'条',
            fieldGroup:'② 数の決まり',
            hint:'空欄なら**40条**（構造上の上限）。',
            more:'幅分割（条割）で割れる条数の上限です。設備によって割れる本数が違うため設備ごとに登録します。子ロットの数（最大9ロット）とは別の値です。'},
           {k:'standardMinutes',label:'標準時間',type:'number',min:1,max:1440,step:1,unit:'分',
            fieldGroup:'② 数の決まり',
            hint:'空欄なら**120分**（暫定の既定）。',
            more:'実績がまだ1件も無い設備の作業スケジュールで、1ロットあたりの見積として使う分数です。実績がたまると実績から算出した見積（換算係数）が優先されるので、最初の保険として登録します。'},
           /* §9.231 ①。**空欄＝未設定**（0は「上限0」になってしまうので受けない）。 */
           {k:'maxLineSpeed',label:'最大ライン速度',type:'number',min:1,max:100000,step:1,unit:'m/min',
            fieldGroup:'② 数の決まり',
            hint:'空欄なら**上限なし**。',
            more:'このラインで出せる速度の上限です。操業データ項目の「数の決まり」からこの値を上限として参照できます（マスタを直せば入力欄の上限も変わります）。'},
           /* §9.302（利用者の指示「設備マスタの有効・無効機能を実装してください。
              有効無効の範囲については機能別に分けて変更できるようにしたい」）。
              **札は「使う機能」・保存値は「使わない機能」**——裏返しなのは
              「空欄＝すべて使える」を既定にするため（あとで機能を1つ足したときに、
              触っていない設備が黙って無効にならない・§9.132）。語彙は
              サーバー（`equipmentFeatures`）が答える（§9.163）。 */
           {k:'disabledFeatures',label:'使える機能',type:'check-set',
            source:{key:'equipmentFeatures'},fieldGroup:'③ 使える機能',
            hint:'外した機能では、この設備が**選択肢に出なくなります**。既に記録したデータは消えません。',
            more:'ラインを止めた・別の工程へ移した設備を、記録を消さずに選択肢から下げるための設定です。外しても設備マスタの行は残り、過去の測定データ・作業予定・実績データはそのまま読めます。**記録のある設備は帳票の候補に残ります**——履歴なので、外した瞬間にその設備の紙が開けなくなるのは行き過ぎです。ロールマスタ・設備停止・勤務形態など、設備マスタの側から設備を選ぶ欄も絞りません（無効にした設備の設定を直せなくなるため）。'}],
   cols:[{k:'name',label:'設備名',grow:2},{k:'kind',label:'区分',grow:1,format:'equipmentKind'},
         {k:'maxStrips',label:'最大条数',grow:1,format:'maxStrips'},
         {k:'standardMinutes',label:'標準時間',grow:1,format:'standardMinutes'},
         {k:'maxLineSpeed',label:'最大速度',grow:1,format:'maxLineSpeed'},
         {k:'disabledFeatures',label:'使える機能',grow:2,format:'equipmentFeatures'}],
   hint:'この工場のラインの一覧です。1行＝1つの設備で、**行を押すと編集の窓が開きます**。「区分」は扱う材料の形（コイル／板）、「最大条数」は幅分割で割れる条数の上限（空欄＝40条）、「標準時間」は実績が無いときの見積（空欄＝120分）、「最大ライン速度」は操業データの入力上限として参照できます（空欄＝上限なし）。「使える機能」を外すと、その機能の設備の選択肢に出なくなります（記録は消えません）。'},
  /* 接続状況（§9.272）。**汎用CRUDは持たない**（`special`で分岐する）。
     一般ユーザーでも開ける——見るだけならどの区分でもできる。 */
  {group:'system',key:'presence',label:'接続状況',icon:'席',
   special:'presence',endpoint:'/api/presence',
   titleText:'接続状況 — 誰がいまこのシステムを使っているか',
   cols:[{k:'login',label:'ログインID'}],
   /* **強調は`**`で書く**（§9.276 ④）——`hintHtml()`はエスケープしてから
      `**`だけを`<b>`へ変えるので、生のタグを書くと**画面に`<b>`という字が
      出る**（マスタへ入れた文字列のHTMLがそのまま効かないようにするための
      順番なので、この順番は変えない・§9.222 ⑧）。 */
   hint:'この共有のマスタへ繋いでいる端末の一覧です。**区分が開発者・メンテナンス者の端末だけが切断できます**（メンテナンス者は開発者を切断できません）。区分はアクセス権限マスタで決めます。切断された端末は**書き込みだけが止まり**、開いている画面はそのまま残ります（別のPCの操作を横から消さないため）。一定時間で自動的に戻ります。'},
  {group:'system',key:'accessPermission',label:'アクセス権限',icon:'権',endpoint:'/api/access-permission-master',hasDelete:true,
   fields:[{k:'loginId',label:'ログインID',key:true},{k:'pcName',label:'PC名',key:true},
           /* **区分が先**（§9.272）。上位概念なので、細かい可否より前に決める。 */
           {k:'role',label:'権限区分',type:'select',options:['一般ユーザー','メンテナンス者','開発者'],
            more:'アプリそのものをどこまで管理できるかです。下の3つ（何を触れるか）とは別の軸で、掛け合わせません。'
                 +'**開発者**＝制限なし。**メンテナンス者**＝接続状況を見て切断できる（ただし開発者は切断できません）。'
                 +'**一般ユーザー**＝接続状況を見るだけ。登録の無い端末は一般ユーザーです。'},
           {k:'canEdit',label:'編集可否',type:'select',options:['編集可','閲覧のみ']},
           {k:'canSchedule',label:'スケジュール可否',type:'select',options:['不可','可']},
           {k:'canFieldReorder',label:'現場段取り可否',type:'select',options:['不可','可']},
           {k:'fieldReorderEquipment',label:'現場段取り対象設備',type:'equipment-multi-text'}],
   cols:[{k:'loginId',label:'ログインID',grow:2},{k:'pcName',label:'PC名',grow:2},{k:'role',label:'権限区分',grow:1},{k:'canEdit',label:'編集可否',grow:1},{k:'canSchedule',label:'スケジュール',grow:1},{k:'canFieldReorder',label:'現場段取り',grow:1},{k:'fieldReorderEquipment',label:'対象設備',grow:2,format:'equipmentTarget'}],
   /* ---------- 長い説明は畳んで階層にする（§9.276 ④、利用者の指示） ----------
      「説明文長すぎてわかりにくくて読みにくいので、タブやアコーディオンなど
       使ってわかりやすく階層化しながらコンパクトに表示・説明する方法も」

      以前は**900字ちかい1段落**で、しかも生の`<b>`が字のまま出ていた。
      画面に常時出すのは**1文だけ**にし、残りは「何を知りたいか」で3つに
      割って畳む——読む側は当たりを付けて1つだけ開ける。
      **説明の量（§9.276 ②）はリード文にだけ掛かる**——畳んである節は
      押したときだけ開くので、短くする理由が無い（§9.234 ①の`?`と同じ）。 */
   hint:'どの端末で・誰が・何をできるかを決めます。**登録の無い端末は「編集可能・一般ユーザー」**として扱われます。',
   /* 窓では**いま決めることの一言**だけ（§CLAUDE 8）。詳しい話は各欄の`?`が持つ。 */
   hintShort:'この端末（ログインID・PC名）に何を許すかを決めます。**空欄は「問わない」**という意味です。',
   hintMore:[
    {t:'権限区分（アプリをどこまで管理できるか）',
     b:'**区分は上位の軸**で、下の3つ「何を触れるか」とは掛け合わせません'
       +'（閲覧のみの端末でも、開発者なら接続状況の管理はできます）。\n'
       +'**開発者**＝制限なし。\n'
       +'**メンテナンス者**＝接続状況を見て切断できる（開発者は切断できません）。\n'
       +'**一般ユーザー**＝接続状況を見るだけ。\n'
       +'**登録の無い端末は一般ユーザー**です——管理の権限を配らないため。'
       +'誰も切断できない状態になったら、この画面で開発者を1つ登録してください。'
       +'接続状況は「マスタ管理 > 接続状況」で見られます。'},
    {t:'ログインID・PC名の照合（どの行が効くか）',
     b:'どちらか一方だけの登録もできます。片方だけ登録すると、もう一方は**「問わない」**という意味になります'
       +'（例: ログインIDだけ登録すると、その人はどの端末からでもこの権限になります）。\n'
       +'効く順は **両方一致 → 片方だけの登録 → 両方空欄（全端末共通の既定）**。\n'
       +'どれにも当たらない組み合わせは、既定で**編集可能・スケジュール不可・現場段取り不可**です。'},
    {t:'何を触れるか（編集／スケジュール／現場段取り）',
     b:'**閲覧専用**にしたい端末は「編集可否」を『閲覧のみ』で登録します。\n'
       +'**作業スケジュールを操作**させたい端末は「スケジュール可否」を『可』に。\n'
       +'**現場段取り**は編集モードの端末に限り、対象設備の**並べ替えだけ**を追加で許可します。'
       +'対象設備は複数選べ、「すべての設備」を選ぶと全設備が対象になります'
       +'（開発・保守用。設備が増えても権限行を足さずに済みます）。'}]},
  {group:'schedule',key:'loadFactor',label:'換算係数',icon:'率',special:'load-factor',endpoint:'/api/schedule/load-factors'},
  {group:'schedule',key:'stopCategory',label:'設備停止分類',icon:'類',endpoint:'/api/schedule/stop-category-master',hasDelete:true,
   fields:[{k:'name',label:'分類名',required:true,key:true}],
   cols:[{k:'name',label:'分類名',grow:2}],
   hint:'設備停止マスタの「分類」の選択肢です。分類は設備をまたいだ集計・色分けに使うため、設備ごとではなく全設備共通で持ちます。設備停止マスタで未登録の分類を入力して保存すると、ここへも自動で登録されます(先にこの画面で作っておく必要はありません)。使用中の分類を削除しようとすると、何件で使われているかを確認したうえで消します。'},
  {group:'schedule',key:'stopReason',label:'設備停止',icon:'停',endpoint:'/api/schedule/stop-reason-master',hasDelete:true,
   fields:[{k:'equipment',label:'対象設備',type:'equipment-multi-text',required:true,key:true,
            tagHint:'この停止内容をどの設備で選べるようにするかです。複数選べます。「すべての設備」を選ぶと、これから増える設備でも自動的に選べます。'},
           {k:'category',label:'分類',type:'master-combo',source:{endpoint:'/api/schedule/stop-category-master',valueKey:'name'},
            hint:'設備停止分類マスタから選びます。無い分類は「＋ 新しく追加…」で入力すると、保存時に分類マスタへも登録されます。'},
           {k:'name',label:'名称',required:true,key:true},
           {k:'standardMinutes',label:'標準所要分',required:true,type:'number',unit:'分',step:5,min:0,
            hint:'この停止に通常かかる時間です。対象設備で時間が違う場合は、設備ごとに分けて登録してください。＋−ボタンで5分ずつ増減できます。'}],
   cols:[{k:'equipment',label:'対象設備',grow:2,format:'equipmentTarget'},{k:'category',label:'分類',grow:1},{k:'name',label:'名称',grow:2},{k:'standardMinutes',label:'標準所要分',grow:1}],
   hint:'作業スケジュール(docs/SCHEDULE_MODE_DESIGN.md §5.3)の設備停止予定で選べる名称と、標準所要分(分)です。1件の停止内容を複数の設備へまとめて登録できます。「すべての設備」を選べば、設備が増えても登録し直す必要がありません。標準所要分が設備ごとに違う場合は、設備を分けて別々に登録してください(同じ名称で対象設備が重なる登録はできません。どちらの時間が効くのか決まらなくなるためです)。「突発停止」は現場からの連絡を受けた計画担当が投入する運用のため、名称に登録しておくだけで自動では動きません。'},
  {group:'schedule',key:'shiftMaster',label:'勤務形態',icon:'勤',special:'shift-pattern',endpoint:'/api/schedule/shift-pattern-master'},
  /* 測定データの置き場(§9.202、利用者の指示)。**3段あることを図で示す**
     ——「入力したのに完了に出ない」「DBへ同期が何をするのか分からない」
     「バックアップの設定画面が無い」は、どれも置き場の関係が画面に
     書かれていないことが元だった。設定もここへ集める（共通設定から移動。
     同じ設定を2画面に置かない＝§9.168と同じ作法）。 */
  {group:'data',key:'measStorage',label:'測定データの保存',icon:'測',special:'meas-storage',
   titleText:'測定データの保存 — どこに何が入るか'},
  {group:'data',key:'importBackup',label:'データ引継ぎ',icon:'継',special:'import-backup'},
  /* データ接続(§9.168)。**1行＝1つのデータソース**で、「これは何か／どこから
     読むか／この設定で何ができるか」を1枚のカードにまとめる。読み込み先の
     個別上書きは以前パス設定タブにあったが、同じ「どこを読むか」の設定が
     2画面に分かれていたため、**データソース側へ寄せた**（保存先は今までどおり
     パス設定マスタなので、検証用の差し替えはそのまま効く）。 */
  {group:'data',key:'dataSource',label:'データ接続',icon:'源',special:'data-source',
   titleText:'データ接続 — このアプリが読むデータ',
   endpoint:'/api/data-source-master',hasDelete:true},
  /* クエリ結合(§9.193)。**データ接続に登録済みのものだけを組み合わせる**
     （利用者の指示）。データ接続のすぐ下に置くのは、「読む」→「つなぐ」が
     そのまま作業の順番だから（視覚導線と作業導線を一致させる）。 */
  {group:'data',key:'queryJoin',label:'クエリ結合',icon:'結',endpoint:'/api/query-join-master',hasDelete:true,
   special:'query-join',titleText:'クエリ結合 — 読んだデータ同士をつなぐ'},
  {group:'data',key:'pathConfig',label:'共通設定',icon:'共',special:'path-config',
   titleText:'共通設定 — 置き場・読み込み先・間隔',endpoint:'/api/path-config-master'},
  /* 不要ファイルの掃除（§9.249 ①、利用者の指示「溜まってくると問題なので、
     不要なキャッシュファイルや不要なバックアップファイルを削除する機能を
     実装してください。いらないものや世代の古いものは定期的に削除するような
     機能も欲しいです」）。**判定はサーバーの1箇所**（`backend/file_cleanup.py`）
     が持ち、画面は返ってきた種別をそのまま出す（§9.163）。 */
  {group:'system',key:'cleanup',label:'不要ファイル掃除',icon:'掃',special:'cleanup',
   titleText:'不要ファイルの掃除 — 作り直せるものだけを片付ける'},
  // 旧「マスタ一覧」(サイドバーのMASTERナビ→汎用グリッド)をここへ統合した
  // (ARCHITECTURE.md「マスタ管理の画面形態」)。上のタブが扱わないテーブル(スケジュール列表示マスタ
  // 等)も含め、master.sqlite3の中身をそのまま確認するための読み取り専用タブ。
  {group:'system',key:'rawTable',label:'テーブル生データ',icon:'表',special:'raw-table',readOnly:true},
 ];
 /* 既定のタブは**実在するキー**にすること（§9.221 ③でオペレータのタブを
    撤去した）。`currentDef()`は見つからなければ先頭へ落とすので中身は出るが、
    `syncNav()`は`defKey`と突き合わせるので**どのタブも選ばれていない**
    見た目になる——「今どこにいるか」を画面が言わなくなる。 */
 let maintState={defKey:MASTER_DEFS[0].key,items:[],editing:null,query:'',meta:{}};
 /* ---------- 専用タブを持たないマスタ（§9.249 ②） ----------
    タブの一覧は**固定のMASTER_DEFSと、サーバーが答える表から作った分**の
    2本立て。**どちらも同じ`def`の形**にしてあるので、一覧・編集モーダル・
    削除・検索の道具は1つも書き足していない（§9.164「同じ道具を使い回す」）。
    ここから先は`allDefs()`を見ること——`MASTER_DEFS`を直に見ると、
    足したタブがそこだけ見えない状態が作れる。 */
 let rawDefs=[];
 function allDefs(){return rawDefs.length?MASTER_DEFS.concat(rawDefs):MASTER_DEFS}
 function currentDef(){return allDefs().find(d=>d.key===maintState.defKey)||MASTER_DEFS[0]}
 // scheduleモードは作業予定(schedule Blueprint)以外のマスタへ書込できない
 // (backend/access_mode.pyの_WRITE_ALLOWED_MODES)。マスタ管理モーダル自体は
 // 開けるようにしつつ(設備停止マスタはscheduleモードでのみ書込可能なため)、
 // タブは自分のBlueprintで書けるものだけに絞る。
 function maintDefVisible(def){
  const mode=(window.accessMode&&window.accessMode.mode)||'edit';
  if(mode!=='schedule')return true;
  // 読み取り専用のタブ(テーブル生データ)は書込権限と無関係なのでどのモードでも
  // 出す。旧「マスタ一覧」ナビが全モードで見られた挙動を統合後も保つため(ARCHITECTURE.md「マスタ管理の画面形態」)。
  if(def.readOnly)return true;
  return !!(def.endpoint&&def.endpoint.indexOf('/api/schedule/')===0);
 }
 function firstVisibleDefKey(){const d=allDefs().find(maintDefVisible);return d?d.key:MASTER_DEFS[0].key}
 /* マスタ種別のグループ(情報アーキテクチャ): 13種を平坦に並べると
    「どれが何の設定か」を毎回読んで探すことになるため、利用者の頭の中の
    分類(誰が・何を使うか / 作業スケジュールの設定 / システム寄りの設定)で
    3つに束ねる。1グループ5件前後=一度に見渡せる粒度(Miller)。 */
 const MASTER_GROUPS=[
  /* 群は**その画面で何をするか**で分ける（§9.264、利用者の指示「類似項目や
     関連項目を集めまとめながら順番を整えて」）。以前の3群は名前と中身が
     食い違っていた——「設備・人」に**人のマスタが1つも無く**（オペレータは
     選択肢の値へ統合済み・§9.221 ②）、設備と無関係な帳票が2つ入っていた。
     「表示・システム」には**表示マスタが1つも無い**（列レイアウト・表示ルール・
     行表示は一覧画面から編集する）。群を増やしたのはそのため——並べ替えだけでは
     名前の嘘は直らない。 */
  /* `items`は**群の中の並び**。決める順に並べる（§CLAUDE 画面基準 14）——
     配列に書いた順のままだと、マスタを1つ足すたびに並びが崩れる（利用者の
     指摘「並びが不規則」）。**ここに載っていないマスタは末尾**へ回るので、
     足し忘れても消えない。載せ忘れは`tests/test_master.js`が数える。 */
  {key:'measure',label:'測定と記録',hint:'測定画面に出す入力欄と、記録した値の見せ方',
   items:['opItem','opChoice','measureItem','recordLayout']},
  {key:'report',label:'帳票',hint:'紙に刷る内容と、その割り付け',
   items:['reportLayout','reportBlock']},
  {key:'equip',label:'設備',hint:'設備そのものと、設備に付くもの',
   items:['equipment','roll']},
  {key:'schedule',label:'作業スケジュール',hint:'計画の時間計算に使う設定',
   items:['shiftMaster','loadFactor','stopCategory','stopReason']},
  {key:'data',label:'データと接続',hint:'どこから読み、どこへ置くか',
   items:['dataSource','queryJoin','measStorage','importBackup','pathConfig']},
  {key:'system',label:'管理',hint:'権限・後片付け・生データ',
   items:['presence','accessPermission','cleanup','rawTable']},
  /* 専用タブを持たないマスタ（§9.249 ②、利用者の指示「テーブル生データ内で
     閲覧可能なマスタかつ、テーブル生データマスタの配置された階層にないものは、
     この階層に配置し、編集可能な形に実装してください」）。
     **中身はサーバーが答える**（`/api/master-table/catalog`）ので、ここには
     表の名前を書き写さない（§9.163。マスタを1つ足すたびに2箇所直すことになる）。
     最後に置くのは**頻度が低いから**（面積は頻度×重要度・§CLAUDE 1）。 */
  {key:'internal',label:'内部データ',hint:'専用のタブを持たないマスタ（そのまま行を編集します）'},
  {key:'retired',label:'移行済み',hint:'アプリはもう読みません。移行前の中身を見返すためだけに残しています'},
 ];
 /* ---------- 群ごとに畳める（§9.250 ②、利用者の指示） ----------
    「マスタのカテゴリ単位で折りたためるようにしてください。さらに内部データに
     属するマスタと移行済みのマスタについては折りたたんだ状態をデフォルトに」

    37タブになった時点で左の一覧は**器の倍の高さ**（実測1635px / 806px）に
    なっていた。探すたびに転がすことになるので、群ごとに畳めるようにする。
    **既定で畳むのは`internal`と`retired`の2つだけ**——どちらも「ふだんは
    触らない」群で、開いている人はそのまま開いたままになる（§CLAUDE 1）。
    覚えは**この端末**（読み方の好みなので、共有マスタへ入れて全員を縛らない）。
    **畳んでも件数は文字で出す**（§CLAUDE 3。何を畳んでいるのか分からないと
    「消えた」と読まれる）。 */
 /* ---------- 一覧の器の幅は「実測して決める」（§9.250 ⑨、利用者の報告） ----------
    「『記録した値の配置』が1行に収まっておらず、・・・で省略されています」

    §9.250 ①では器の式を「文字ぶん(em)＋固定ぶん(px)」に分けた。**足りない
    ものが1つあった**——**スクロールバー**。タブが増えて一覧が縦に溢れると
    バーが出て、その幅（端末とブラウザで違う）ぶん文字の場所が減る。
    固定ぶんに数を足して追いかけると、次に何かが増えたときにまたずれる。

    **測ってから決める**（§9.130と同じ作法）。切れている量（`scrollWidth`
    −`clientWidth`）はブラウザが正確に知っているので、それを足すだけでよい
    ——バーの幅も文字の太さも表示サイズも、測れば全部込みになる。
    **既定へ戻してから測る**ので、狭くもなる（増やす一方にしない）。
    **見張りと組み合わせるので、同じ値なら書かないこと**（§9.131）。 */
 let mmNavFitting=false,mmNavRO=null;
 let mmNavFitPending=false,mmNavSizeMO=null;
 function fitMaintNav(){
  const nav=$('#masterMaintNav');
  if(!nav)return;
  /* **測っている最中に頼まれたら、あとでもう一度測る**（§9.264）。
     以前は`return`で捨てていたため、**群を開いた直後の測り直しが黙って
     落ちて**、長い名前が切れたままになっていた（`列レイアウト個人設定`が
     10px切れる。畳んだ群の中は行を作らないので、開くまで測れない）。 */
  if(mmNavFitting){mmNavFitPending=true;return}
  const body=nav.closest('.mm-body');
  if(!body)return;
  mmNavFitting=true;
  requestAnimationFrame(()=>{
   try{
    /* 既定の幅へ戻して測る（前回広げたぶんを持ち越さない）。 */
    body.style.removeProperty('--mm-nav-w');
    const base=nav.getBoundingClientRect().width;
    if(!(base>0))return;
    let need=0;
    nav.querySelectorAll('button[data-master]').forEach(b=>{
     const l=b.querySelector('.mm-nav-label');
     if(!l)return;
     const over=l.scrollWidth-l.clientWidth;
     if(over>need)need=over;
    });
    /* 束の見出し（件数つき）も切らさない。 */
    nav.querySelectorAll('.mm-nav-group-name').forEach(l=>{
     const over=l.scrollWidth-l.clientWidth;
     if(over>need)need=over;
    });
    if(need>0)body.style.setProperty('--mm-nav-w',Math.ceil(base+need+1)+'px');
   }finally{
    /* **見張りが自分の書き換えで回らないように**、1フレーム置いて解く。 */
    requestAnimationFrame(()=>{
     mmNavFitting=false;
     if(mmNavFitPending){mmNavFitPending=false;fitMaintNav()}
    });
   }
  });
  /* **表示サイズを変えたら測り直す**（§9.264。§9.130と同じ理由）——幅は
     「そのときの文字サイズで測った結果」なので、文字だけが1.1倍になると
     器はそのままで名前が切れる（実測: 中で10px切れていた）。器の幅は
     変わらないので`ResizeObserver`では気づけない。 */
  if(!mmNavSizeMO&&typeof MutationObserver==='function'){
   mmNavSizeMO=new MutationObserver(()=>fitMaintNav());
   mmNavSizeMO.observe(document.documentElement,{attributes:true,attributeFilter:['data-ui-size']});
  }
  if(!mmNavRO&&typeof ResizeObserver==='function'){
   /* 表示サイズを変えた・窓の幅が変わった、で測り直す（`--ui-scale`は
      文字だけを伸ばすので、同じ器でも切れ方が変わる・§9.130）。 */
   mmNavRO=new ResizeObserver(()=>{if(!mmNavFitting)fitMaintNav()});
   mmNavRO.observe(nav);
  }
 }
 const MM_NAVFOLD_KEY='MasterNavFoldV1';
 const MM_NAVFOLD_DEFAULT=['internal','retired'];
 function mmNavFolded(){
  try{
   const raw=localStorage.getItem(MM_NAVFOLD_KEY);
   if(raw===null)return new Set(MM_NAVFOLD_DEFAULT);
   const v=JSON.parse(raw);
   return new Set(Array.isArray(v)?v:[]);
  }catch(e){return new Set(MM_NAVFOLD_DEFAULT)}
 }
 function mmSetNavFolded(set){
  try{localStorage.setItem(MM_NAVFOLD_KEY,JSON.stringify([...set]))}catch(e){}
 }
 function renderMaintNav(){
  const nav=$('#masterMaintNav');if(!nav)return;
  const visible=allDefs().filter(maintDefVisible);
  const folded=mmNavFolded();
  /* **いま開いているタブの群は必ず開く**（§CLAUDE 4）。畳んだ群の中の
     タブを選んだままにすると、「今どこにいるか」が画面から消える。 */
  const cur=visible.find(d=>d.key===maintState.defKey);
  if(cur)folded.delete(cur.group||'system');
  const html=MASTER_GROUPS.map(g=>{
   const defs=visible.filter(d=>(d.group||'system')===g.key);
   if(!defs.length)return '';
   /* 群の中は`items`の順（決める順）。**載っていないものは末尾**——
      足し忘れても消えないようにする（並びが決まらないだけ）。 */
   if(g.items&&g.items.length){
    const rank=k=>{const i=g.items.indexOf(k);return i<0?g.items.length:i};
    defs.sort((a,b)=>rank(a.key)-rank(b.key));
   }
   const off=folded.has(g.key);
   /* **見出しは`<button>`にしない**——`10-roles.css`の`.mm-nav button`が
      「行き先の的」の寸法（`--ctl-h`・`--fs`）を配るので、見出しまで
      行き先と同じ大きさになる（実測: 文字が14pxになり「作業スケジュール」が
      入らなくなった）。役割が違うものへ同じ役割の寸法を配らない。 */
   return `<div class="mm-nav-group${off?' is-folded':''}" data-nav-group="${esc(g.key)}">`
    +`<div class="mm-nav-group-label" data-nav-fold="${esc(g.key)}" role="button" tabindex="0"`
    +` aria-expanded="${off?'false':'true'}" title="${esc(g.hint)}｜押すと${off?'開きます':'畳みます'}">`
    +`<span class="mm-nav-caret" aria-hidden="true">${off?'▸':'▾'}</span>`
    +`<span class="mm-nav-group-name">${esc(g.label)}</span>`
    +`<span class="mm-nav-count">${defs.length}</span></div>`
    +(off?'':defs.map(d=>`<button type="button" data-master="${d.key}" title="${esc(d.label)}"><span class="mm-nav-ico" aria-hidden="true">${esc(d.icon)}</span><span class="mm-nav-label">${esc(d.label)}</span></button>`).join(''))
    +'</div>';
  }).join('');
  nav.innerHTML=html;
  fitMaintNav();
  nav.querySelectorAll('[data-nav-fold]').forEach(b=>{
   const toggle=()=>{
    const k=b.dataset.navFold,now=mmNavFolded();
    if(now.has(k))now.delete(k);else now.add(k);
    mmSetNavFolded(now);renderMaintNav();
   };
   b.onclick=toggle;
   b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle()}};
  });
  nav.querySelectorAll('[data-master]').forEach(b=>b.onclick=()=>{maintState.defKey=b.dataset.master;maintState.editing=null;maintState.query='';const se=$('#masterMaintSearch');if(se)se.value='';syncNav();loadMaint(true)});
  syncNav();
 }

 /* ---------- 画面の形態(ARCHITECTURE.md「マスタ管理の画面形態」改訂) ----------
    以前は全画面シェード付きのモーダル(.record-modal.mm-modal)だったが、
    「モーダルにした意味が無い使い方(常時開きっぱなしで一覧を見る画面)」
    という指摘のため、帳票(rp-mode)・実績カレンダー(cal-mode)・作業スケジュール
    (sc-mode)と同じメイン画面統合型(body.mm-mode + #masterMaintPanel)へ
    作り直した。内側の構造(.mm-dialog以下)とid(#masterMaintNav/
    #masterMaintForm/#masterMaintList等)は一切変えていないため、
    データ引継ぎ・換算係数・パス設定といった特殊タブの描画コードは
    そのまま動く(.mm-panel .mm-dialogのCSSで寸法だけ上書きする)。 */
 function ensureMaintPanel(){
  let panel=$('#masterMaintPanel');if(panel)return panel;
  panel=document.createElement('section');panel.className='mm-panel';panel.id='masterMaintPanel';panel.hidden=true;
  /* 見出しの帯は持たない。画面名と説明はヘッダー(#fileName)が、更新者IDは
     ヘッダーの操作列(#headerViewBar)が受け持つ。「×」も置かない——他の画面に
     無く、左のメニューから移れば閉じるため、この画面だけ閉じ方が違っていた。 */
  panel.innerHTML=`<div class="mm-dialog">
   <div class="mm-head" id="mmHead">
    <!-- 上部の操作は3つだけ（§9.266、利用者の指示「アイコンなども活用し…
         1行に収める」）。**アイコンだけにしない**——何の欄かはツールチップでは
         読めない（§4）ので、更新者IDは印と短い名前、絞り込みは虫めがねと
         短い誘い文句、再読込は印とaria-labelにする。
         **この中にバッククォートを書かないこと**（§9.211 ③。テンプレート
         リテラルがそこで閉じ、以降がJSとして解釈されて画面が組み上がらない）。 -->
    <button type="button" id="masterUserId" class="mm-head-user"
     title="この端末のログインIDです。マスタを更新した人として記録します（書き換えられません）。押すと「接続状況」を開きます">
     <span class="mm-head-ico" aria-hidden="true">👤</span>
     <b id="masterUserName">—</b></button>
    <div class="mm-search"><span class="mm-search-icon" aria-hidden="true">🔍</span><input id="masterMaintSearch" type="search" placeholder="絞り込み" autocomplete="off"></div>
    ${hintBadgeHtml()}
    <button id="reloadMasterMaint" type="button" class="mm-btn-ghost mm-head-icobtn"
     title="マスタを読み直します" aria-label="再読込"><span aria-hidden="true">↻</span></button>
   </div>
   <div class="mm-body">
    <nav class="mm-nav" id="masterMaintNav" aria-label="マスタ種別"></nav>
    <section class="mm-main">
     <!-- 見出しだけを残す。絞り込みと再読込は**操作**なのでヘッダーの
          操作列(#mmHead → #headerViewBar)が持つ(§9.100)。ここに残すと、
          この画面だけ操作の置き場が2段になる。 -->
     <div class="mm-toolbar">
      <div class="mm-toolbar-left"><b id="masterMaintTitle">オペレータ</b><span class="mm-count" id="masterMaintCount"></span></div>
      <!-- 束ねた見出しの開閉（§9.241 ①）。**群を持つマスタのときだけ**中身が
           入る（renderMaintList が出し入れする。押せるのに何も起きない
           ボタンを置かない・§CLAUDE 4）。 -->
      <div class="mm-fold" id="masterMaintFold" hidden></div>
     </div>
     <form class="mm-form" id="masterMaintForm"></form>
     <div class="mm-list-wrap"><div class="mm-list" id="masterMaintList"></div></div>
    </section>
   </div>
  </div>`;
  const grid=$('#grid');grid?.parentNode?.insertBefore(panel,grid);
  /* ---------- 更新者IDは名乗るだけ（§9.276 ③、利用者の指示） ----------
     「ユーザーIDを表示する上部のメニュー部分は、IDを書き換えられないように
      してください。また、ボタン化して接続状況確認と配線してください」

     ここは**この端末のログインID**（`/api/whoami`＝`current_login_id()`）で、
     アクセス権限マスタの照合・監査列・フィルタの持ち主が見ている値。
     打ち込めると**他人の名前で更新できてしまい、記録の意味が無くなる**。
     押したときの行き先は「接続状況」——いま誰がどの端末で繋いでいるかを
     見る画面で、自分の名乗りを確かめる場所でもある（§9.272）。 */
  paintMaintUser();
  /* 説明の量（§9.274・§9.276 ②）。**選んだらその場で描き直す**——次に開くまで
     変わらないと、押しても何も起きないように見える（§4）。描き直しは
     `refreshMaintScreen()`の1箇所（専用の画面を潰さない）。
     **「出さない」だけはCSSでも効かせる**（`html[data-hint]`）——描き直しの
     効かない場面でも消えるようにするため。 */
  document.documentElement.setAttribute('data-hint',hintLevel());
  const hb=$('#mmHintBadge');
  if(hb)hb.onclick=()=>{if(mmHintMenu)closeHintMenu();else openHintMenu(hb)};
  $('#reloadMasterMaint').onclick=()=>loadMaint(true);
  const search=$('#masterMaintSearch');if(search){search.oninput=()=>{maintState.query=search.value;renderMaintList()}}
  renderMaintNav();
  return panel;
 }
 function exitMasterMaint(){
  if(!document.body.classList.contains('mm-mode'))return;
  /* **開いた浮きメニューは器と一緒に畳む**（§9.222 ①）——残すと、画面を
     出たあとも説明の量のメニューだけが宙に浮く。 */
  closeHintMenu();
  document.body.classList.remove('mm-mode');
  const panel=$('#masterMaintPanel');if(panel)panel.hidden=true;
  closeMaintEditor();
  document.getElementById('openMasterMaint')?.classList.remove('active');
 }
 window.exitMasterMaint=exitMasterMaint;
 /* 更新者IDの入力はヘッダーの#headerViewBarへ移す(WL.enterViewの
    mountViewToolbar参照)。副題は保存先のファイル名ではなく、この画面で
    何ができるかを書く(ファイル名は開発者向けの情報で、現場では読めても
    意味が無い)。 */
 WL.registerView({key:'master',bodyClass:'mm-mode',nav:'openMasterMaint',toolbar:'#mmHead',
  /* 操作は3つだけなので、ヘッダーの1行目へ相乗りする（§9.266）。 */
  compactToolbar:true,
  header:['マスタ管理','登録内容の追加・編集・無効化（更新者IDとともに記録）'],exit:exitMasterMaint});
 function syncNav(){document.querySelectorAll('#masterMaintNav [data-master]').forEach(b=>b.classList.toggle('active',b.dataset.master===maintState.defKey))}
 /* いまの更新者IDをボタンへ書く。**IDは`/api/whoami`から後から届く**
    （§9.184と同じ罠）ので、届いていなければその場で取りに行く。 */
 function paintMaintUser(){
  const b=$('#masterUserId'),n=$('#masterUserName');
  if(!b||!n)return;
  const id=currentUserId();
  n.textContent=id||'IDが取れていません';
  b.classList.toggle('is-unknown',!id);
  b.onclick=()=>openMasterMaint('presence');
  if(!id&&typeof fetchWhoami==='function'){
   fetchWhoami().then(v=>{if(v){setUserId(v);paintMaintUser()}}).catch(()=>{});
  }
 }
 /* **打ち込ませない**（§9.276 ③）。取れていないときは、無言で断らずに
    どこを見ればよいかまで言う（§4）——押せば接続状況へ行ける。 */
 function requireMaintUser(){
  const id=currentUserId();
  if(!id){
   showToast('更新者IDが分かりません',
     'この端末のログインIDを読み取れませんでした。マスタの更新は「誰が直したか」を記録するので、'
     +'IDが取れないうちは保存できません。上の👤を押すと接続状況を確認できます。',6000);
   paintMaintUser();
   return null;
  }
  return id;
 }

 /* ---------- モーダル化の基準(ARCHITECTURE.md「マスタ管理の画面形態」) ----------
    「モーダルにする意味」をここ1箇所で定義する。
      ・一覧・検索・軽い追加は常にメイン画面(統合パネル)側で完結させる。
        画面を覆う理由が無く、覆うと背後の一覧と見比べられなくなるため。
      ・入力項目が多い/専用コントロールを伴う編集だけをモーダルにする。
        上部インラインフォームのままだと縦幅を大きく取って一覧の表示領域を
        圧迫し、フォームと一覧のどちらも中途半端に見える状態になるため
        (実際に報告された指摘)。編集の間は一覧を操作させない方が安全でもある。
    判定は「入力項目がEDITOR_MODAL_MIN_FIELDS以上」「専用コントロール
    (設備の複数選択タグ入力)を含む」「defで明示(editorModal:true)」のいずれか。
    現状: オペレータ(タグ入力)・アクセス権限(6項目)・設備停止(4項目)・
    勤務形態(4項目)がモーダル、機器/スプール/内径/設備はインラインのまま。

    **項目数はあくまで「フォームが縦に伸びるか」の目安**であって、目的
    そのものではない(§9.114)。短い1行の項目が4つ並ぶだけならフォームは
    伸びないので、モーダルにする理由が無い。`editorModal:false`で外せる
    ようにしてあるが、**理由の書けるものだけ**にすること
    ——外すたびに「どの画面がどちらなのか」が覚えられなくなる。
    しきい値そのものを動かさないこと: 5へ上げると設備停止(4項目)・
    勤務形態(4項目)が黙ってインラインへ戻り、頼まれていない画面が変わる。 */
 const EDITOR_MODAL_MIN_FIELDS=4;
 const RICH_FIELD_TYPES=['equipment-multi','equipment-multi-text'];
 function defUsesEditorModal(def){
  if(!def||!Array.isArray(def.fields)||!def.fields.length)return false;
  if(def.editorModal===false)return false;   // 明示で外す(理由はdef側に書く)
  if(def.editorModal===true)return true;
  if(def.fields.some(f=>RICH_FIELD_TYPES.includes(f.type)))return true;
  return def.fields.length>=EDITOR_MODAL_MIN_FIELDS;
 }

 /* ================= 入力支援(docs/SCHEDULE_MODE_DESIGN.md §9.49) =================
    マスタの入力は「マウスだけで最後まで終えられる」ことを基本にする。現場の
    端末はキーボードが使いにくい場所にあることがあり、また手入力は表記ゆれ
    (全角/半角・余分な空白)をそのままマスタへ持ち込む原因になるため。
      - number : 上下ボタン付き。右づめ・3桁区切りで表示し、単位を添える
      - date   : ブラウザ標準のカレンダー入力(type=date)
      - master-combo: 別マスタの登録値から選ぶ。未登録の値も入力でき、
                      保存時にその別マスタへ連動登録される(§5.3.1)
      - path   : サーバー側のフォルダ参照ダイアログ + ドラッグ&ドロップ
    いずれも最終的な値は data-field を持つ input/select が保持するので、
    submitMaint() 側の読み取りは変えない。 */
 const numFmt=new Intl.NumberFormat('ja-JP',{maximumFractionDigits:6});
 // 表示用に3桁区切りへ。編集中は素の数値に戻す(区切りが入ったままだと打ち直せない)。
 function numDisplay(v){
  const s=String(v??'').trim();if(!s)return '';
  const n=Number(s.replace(/,/g,''));
  return Number.isFinite(n)?numFmt.format(n):s;
 }
 function numRaw(v){
  const s=String(v??'').replace(/,/g,'').trim();
  return s;
 }
 // extraAttrは呼び出し側が別の収集属性を足すため(パス設定タブはdata-pc-fieldで集める)
 function numFieldHtml(f,val,extraAttr){
  const step=f.step==null?1:f.step;
  const attrs=[`data-step="${esc(String(step))}"`];
  if(f.min!=null)attrs.push(`data-min="${esc(String(f.min))}"`);
  if(f.max!=null)attrs.push(`data-max="${esc(String(f.max))}"`);
  if(extraAttr)attrs.push(extraAttr);
  return `<span class="mm-num" data-num-wrap>
    <button type="button" class="mm-num-btn" data-num-step="-1" tabindex="-1" aria-label="${esc(f.label)}を減らす">−</button>
    <input data-field="${f.k}" class="mm-num-input" type="text" inputmode="decimal" autocomplete="off"
           value="${esc(numDisplay(val))}" ${attrs.join(' ')}>
    <button type="button" class="mm-num-btn" data-num-step="1" tabindex="-1" aria-label="${esc(f.label)}を増やす">＋</button>
    ${f.unit?`<span class="mm-num-unit">${esc(f.unit)}</span>`:''}
   </span>`;
 }
 /* 説明文の`**強調**`（§9.222 ⑧）。マスタの`hint`は最初から`**…**`で
    書いてあるのに、そのまま`esc()`して出していたので**画面に`**`が並んで
    いた**（実機のスクリーンショットで「**空欄＝すべての設備**」と読める）。
    **エスケープしてから印を`<b>`へ変える**——順番が逆だと、マスタへ入れた
    文字列の中のHTMLがそのまま効く。 */
 /* ---------- 説明の量は選べる（§9.274、利用者の指示） ----------
    「帳票ブロックマスタに説明書きみたいなものが出ているものがありますが、
     ON/OFF、ONも短め、通常など調整できるようにしてほしいです。文章が
     長すぎて影響が出ているものがあるので調整したいです」

    3段（`full`＝通常／`short`＝短め／`off`＝出さない）。**置き場はこの端末**
    （読み方の好みなのでPCごとに違ってよい・§9.199／§9.242 ⑥）。
    **既定は今までどおり`full`**——わざわざ選んでいない人の見え方を変えない。

    **`?`（くわしい説明）は消さない**——押したときだけ開く、場所を取らない
    入口なので、消すと「短め」にした人が全文へ辿り着けなくなる（§9.234 ①
    「消した説明は落とし先を用意する」）。だから`off`でも`?`は残す。

    **通すのは`hintHtml()`の1箇所**（§9.163）——説明を出す場所は十数箇所
    あるので、そこへ足すと**足し忘れた欄だけが長いまま残る**。 */
 const HINT_LEVEL_KEY='MasterHintLevelV1';
 const HINT_LEVELS=[
  {v:'full',label:'通常',note:'説明を全部出す'},
  {v:'short',label:'短め',note:'最初の1文だけ'},
  {v:'off',label:'出さない',note:'「?」からは読める'}];
 function hintLevel(){
  try{
   const v=localStorage.getItem(HINT_LEVEL_KEY);
   return HINT_LEVELS.some(x=>x.v===v)?v:'full';
  }catch(e){return 'full'}
 }
 function setHintLevel(v){
  try{localStorage.setItem(HINT_LEVEL_KEY,HINT_LEVELS.some(x=>x.v===v)?v:'full')}catch(e){}
  document.documentElement.setAttribute('data-hint',hintLevel());
 }
 /* 短めは**最初の1文だけ**（`。`まで）。**文の途中で切らない**——途中で
    切ると意味が反転しうる（「〜しないでください」の前半だけが残る）。
    `。`が無ければ丸ごと残す（短い注記はそのままでよい）。 */
 function hintShorten(t){
  const s=String(t||'');
  const i=s.indexOf('。');
  return (i>=0&&i+1<s.length)?s.slice(0,i+1):s;
 }
 /* 印の解き方は`WL.markup()`の1箇所（§9.286 ⑦）——エスケープしてから
    `**強調**`とバッククォート囲みを戻す。ここが持つのは**量の段**だけ。 */
 function hintHtml(t){
  const lv=hintLevel();
  if(lv==='off')return '';
  return WL.markup(lv==='short'?hintShorten(String(t||'')):String(t||''));
 }
 /* ---------- 帯ではなくポップオーバー（§9.276 ②、利用者の指示） ----------
    「このボタンは3つもエリアを使っているがそんなに頻繁に使うものでもないので、
     隣の文字サイズ切り替えUIのように、ポップオーバーメニューなど場所を
     使わない方法で切り替えできるようにしてください」

    **隣の`#uiSizeBadge`と同じ言語で揃える**（小さなボタン→選択肢を並べた
    浮きメニュー）——同じ役割のUIが画面ごとに違う形だと、押す前にどちらの
    形か思い出すことになる。**いまどれかはボタンに文字で出す**（§CLAUDE 3。
    畳んだだけで現在値が読めなくなるのでは、隠した意味が無い）。 */
 function hintBadgeHtml(){
  const cur=HINT_LEVELS.find(x=>x.v===hintLevel())||HINT_LEVELS[0];
  return `<button type="button" id="mmHintBadge" class="mm-btn-ghost mm-head-icobtn mm-hintbadge"`
   +` aria-haspopup="true" aria-expanded="false"`
   +` title="欄の下に出る説明文の量を選びます（いまは「${esc(cur.label)}」）。`
   +`「くわしい説明」（?）はどの段でも読めます">`
   +`<span class="mm-hint-ico" aria-hidden="true">💬</span><b id="mmHintLabel">${esc(cur.label)}</b></button>`;
 }
 /* 浮きメニュー。**器は`body`直下**（`#mmHead`は`overflow`を持つ器の中に
    あるので、中で開くと切られる・§9.201）。**開いた器は必ず控える**
    （§9.222 ①——控えないと外クリックもEscも閉じられず、押すたびに積み上がる）。 */
 let mmHintMenu=null;
 function closeHintMenu(){
  if(mmHintMenu){mmHintMenu.remove();mmHintMenu=null}
  document.removeEventListener('click',onHintOutside,true);
  document.removeEventListener('keydown',onHintKey,true);
  const b=$('#mmHintBadge');if(b)b.setAttribute('aria-expanded','false');
 }
 function onHintOutside(e){
  if(mmHintMenu&&!mmHintMenu.contains(e.target)&&!e.target.closest('#mmHintBadge'))closeHintMenu();
 }
 function onHintKey(e){if(escClosesModal(e))closeHintMenu()}
 function openHintMenu(anchor){
  closeHintMenu();
  const cur=hintLevel();
  const m=document.createElement('div');
  m.className='access-mode-menu mm-hint-menu';m.id='mmHintMenu';
  m.innerHTML=HINT_LEVELS.map(x=>`<button type="button" data-hint-lv="${esc(x.v)}"`
    +` class="${x.v===cur?'is-current':''}"><span>${esc(x.label)}</span>`
    +`<small>${esc(x.note||'')}</small></button>`).join('');
  document.body.appendChild(m);
  mmHintMenu=m;
  m.querySelectorAll('[data-hint-lv]').forEach(b=>b.onclick=()=>{
   setHintLevel(b.dataset.hintLv);
   const lab=$('#mmHintLabel');
   const cur2=HINT_LEVELS.find(x=>x.v===hintLevel())||HINT_LEVELS[0];
   if(lab)lab.textContent=cur2.label;
   const badge=$('#mmHintBadge');
   if(badge)badge.title=`欄の下に出る説明文の量を選びます（いまは「${cur2.label}」）。`
     +`「くわしい説明」（?）はどの段でも読めます`;
   closeHintMenu();
   refreshMaintScreen();
  });
  const r=anchor.getBoundingClientRect();
  m.style.top=`${r.bottom+6}px`;
  m.style.left=`${Math.max(8,Math.min(r.left,window.innerWidth-m.offsetWidth-8))}px`;
  anchor.setAttribute('aria-expanded','true');
  requestAnimationFrame(()=>{
   document.addEventListener('click',onHintOutside,true);
   document.addEventListener('keydown',onHintKey,true);
  });
 }
 /* ---------- いま出ている画面を描き直す（§9.276 ②、利用者の報告） ----------
    「マスタを確認しているときに説明文の長さを切り替えると、マスタ表示内容が
     消えます。再読み込みすると表示されますが」

    原因は`renderMaintList()`が**汎用の一覧**（`def.cols`から見出しを組む）を
    無条件に書いていたこと——専用の画面（`special:*`）は`#masterMaintList`へ
    自前の中身を描いているので、そこへ汎用の空表を書き込むと**丸ごと消える**。
    **描き直しの入口は1つ**（§9.163）——専用の画面は`loadMaintInner()`が
    既に唯一の受け口なので、そこへ戻す（2つ目の対応表を作らない）。 */
 function refreshMaintScreen(){
  const def=currentDef();
  if(def&&def.special){loadMaintInner(false).catch(()=>{});return}
  try{renderMaintForm()}catch(e){}
  try{renderMaintList()}catch(e){}
 }
 /* ---------- 説明を階層にする（§9.276 ④、利用者の指示） ----------
    「説明文長すぎてわかりにくくて読みにくいので、タブやアコーディオンなど
     使ってわかりやすく階層化しながらコンパクトに表示・説明する方法も」

    常時出すのは**リード文（`hint`）だけ**で、詳しい話は`hintMore`の節へ畳む
    （`<details>`——欄の`?`と同じ言語・§9.250 ④）。**節は既定で閉じる**
    ——開いておくと畳んだ意味が無い。
    **`hintHtml()`を通す**（§9.163）ので、説明の量（通常／短め／出さない）が
    リード文へそのまま効き、`**強調**`も同じ書き方でよい。
    **「出さない」でも節は残す**——押したときだけ開く入口なので、消すと
    短くした人が全文へ辿り着けなくなる（§9.234 ①・`?`と同じ約束）。 */
 function hintSectionsHtml(def){
  const secs=(def&&def.hintMore)||[];
  if(!secs.length)return '';
  return `<div class="mm-hint-more">`+secs.map(x=>
    `<details class="mm-hint-sec"><summary>${esc(x.t)}</summary>`
    +`<div>${String(x.b||'').split('\n').map(line=>
        `<p>${esc(line).replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')}</p>`).join('')}</div></details>`
   ).join('')+`</div>`;
 }
 /* 一覧の上に出す説明。**通すのはここ1箇所**——`hint`だけを書いている
    4箇所が同じ形になるので、`hintMore`を足したマスタは自動で階層になる。
    **編集窓では節を出さない**（§CLAUDE 8「窓の説明は一覧の説明と同じに
    しない」）——窓に要るのは「いま決めることの一言」で、マスタ全体の
    説明は一覧の側が持つ。窓の中の細かい話は各欄の`?`が言う。 */
 function defHintHtml(def,text){
  const modal=text!==undefined;
  const t=modal?text:(def&&def.hint);
  const lead=t?`<p class="mm-def-hint">${hintHtml(t)}</p>`:'';
  return modal?lead:(lead+hintSectionsHtml(def));
 }
 /* **消した説明は`title`へ落とす**（§9.234 ①）。欄の説明を短くすると
    読めるようになるが、消してしまうと調べようが無くなる。`more`を持つ欄は
    見出しにマウスを当てれば全文が読める（§CLAUDE 8）。 */
 function fieldLabelHtml(f){
  const t=f.more?` title="${esc(f.label+'｜'+String(f.more).replace(/\*\*/g,''))}"`:'';
  /* ---------- 続きは畳んで置く（§9.250 ④、利用者の指示） ----------
     「タブとアコーディオンによる情報の階層化、チャンク化を取り入れて」

     以前は`?`が**マウスを乗せたときだけ**出る`title`で、触る画面では
     一度も読めなかった（説明があること自体は見えているので、
     「押しても何も起きない」に見える・§4）。押すと開く形にする。
     `title`は残す——読み方が2つあって困るものではない。 */
  return `<span${t}>${esc(f.label)}${f.required?'<i>*</i>':''}${f.key?'<em class="mm-keytag">キー</em>':''}`
   +(f.more?`<button type="button" class="mm-more" aria-expanded="false"`
     +` aria-label="${esc(f.label)}のくわしい説明" data-more="${esc(String(f.more))}">?</button>`:'')
   +`</span>`;
 }
 /* 押したら欄の下へ開く。**器へ足すのは押したときだけ**——最初から置くと、
    畳んでいても`.mm-field`の子が1つ増えて並びの計算が変わる。
    **`<label>`の中なので`preventDefault()`が要る**（押すと欄へフォーカスが
    飛んで、開いた瞬間に入力欄が選ばれる）。 */
 function bindMoreToggles(form){
  form.querySelectorAll('.mm-more').forEach(b=>{
   if(b.dataset.moreWired)return;
   b.dataset.moreWired='1';
   b.onclick=e=>{
    e.preventDefault();e.stopPropagation();
    const fld=b.closest('.mm-field');if(!fld)return;
    let body=fld.querySelector(':scope>.mm-more-body');
    if(!body){
     body=document.createElement('small');
     body.className='mm-more-body';
     body.innerHTML=hintHtml(String(b.dataset.more||''));
     fld.appendChild(body);
    }
    const on=b.getAttribute('aria-expanded')!=='true';
    b.setAttribute('aria-expanded',on?'true':'false');
    b.classList.toggle('is-on',on);
    body.hidden=!on;
   };
  });
 }
 /* master-combo の選択肢は別マスタから取る。同じマスタを何度も引かないよう
    タブを開いている間だけ持つ(登録すると連動して増えるので、保存後の
    loadMaint()で作り直す)。 */
 const comboCache=new Map();
 function invalidateComboCache(){comboCache.clear()}
 async function comboOptions(source){
  if(!source||!source.endpoint)return [];
  if(comboCache.has(source.endpoint))return comboCache.get(source.endpoint);
  try{
   const r=await api(source.endpoint);
   /* **同じ名前を2つ並べない。** 選択肢マスタのように1行＝1値のマスタでは
      同じ名前が値の数だけ返るので、そのまま並べると候補が重複する。 */
   const list=[...new Set((r.items||[]).map(x=>String(x[source.valueKey||'name']??'').trim()).filter(Boolean))];
   comboCache.set(source.endpoint,list);return list;
  }catch(e){comboCache.set(source.endpoint,[]);return []}
 }
 /* 「すべての設備」を表す保存値。backend/repositories/master_repo.py の
    FIELD_REORDER_ALL と必ず同じにすること(判定はサーバー側と画面側の
    両方にあり、片方だけ変えると権限の見え方と実際が食い違う)。 */
 const EQUIPMENT_ALL='*';
 /* ---------- データソースの「この設定でできること」(§9.163) ----------
    データソースは1行足せば一覧には出るが、**測定・予定投入・品質結合は
    行に要る列が無いと画面が黙って出さない**（必須列を決め打ちしない方針の
    裏返し）。登録した本人からは「登録したのにボタンが出ない」としか
    見えないので、**できること／できない理由**をここで言い切る。
    判定はサーバー(backend/source_capability.py)の1箇所が持ち、画面は
    受け取った結果を並べるだけ——判定を画面にも書くと、2つの答えが出る。 */
 const CAPABILITY_ORDER=['list','measure','plan','quality','schedule'];
 const CAPABILITY_LABEL={list:'一覧として見る',measure:'測定を開く',
                         plan:'スケジュールへ投入',quality:'品質として結合',
                         schedule:'予定の本体にする'};
 const CAPABILITY_SHORT={list:'一覧',measure:'測定',plan:'予定',quality:'結合',schedule:'予定本体'};
 /* 一覧の表示用テキスト。保存値そのままだと '*' が生で見えて意味が伝わらない。 */
 function cellText(col,value){
  const v=String(value??'');
  if(col.format==='maxStrips')return v.trim()===''?'40（既定）':v;
  /* 1ロットあたり標準時間(§9.114)。**未設定を「0分」に見せない**——
     空欄は「登録していない＝全体の暫定既定値を使う」であって0分ではない。 */
  if(col.format==='standardMinutes')return v.trim()===''?'120分（既定）':`${v}分`;
  /* §9.231 ①。**未設定は「未設定」と書く**——0や既定値を出すと、
     参照している項目に上限が掛かっているように読める（§4）。 */
  if(col.format==='maxLineSpeed')return v.trim()===''?'未設定':`${v} m/min`;
  // 区分(§9.85)。空欄は「まだ決めていない」であって「無い」ではないので、
  // 「—」ではなくそう書く(既存の設備は空のまま動く)。
  if(col.format==='equipmentKind')return v.trim()===''?'未設定':v;
  /* 入力値の丸めの刻み（§9.305 ①）。**空欄は「丸めない」と書き切る**
     ——空のままだと「まだ決めていない」と読めるが、この行の意味は
     「刻みが無い＝この入力は丸めない」（§4）。単位も必ず添える（§6）。 */
  if(col.format==='roundUnit')return v.trim()===''?'丸めない':`${v} mm 刻み`;
  /* 使える機能（§9.302）。**残る側を並べる**——保存値は「使わない機能」だが、
     一覧で知りたいのは「どこに出るか」。全部使えるのがふつうなので、そこは
     1語で済ませて（「すべて」）、外してある行だけが目に留まるようにする。
     **0個は「なし」と書き切る**（空欄にすると「まだ決めていない」と読める・§4）。 */
  if(col.format==='equipmentFeatures'){
   const all=(maintState.meta&&Array.isArray(maintState.meta.equipmentFeatures))?maintState.meta.equipmentFeatures:[];
   if(!all.length)return '';
   const off=new Set(Array.isArray(col.row&&col.row.disabledFeatures)?col.row.disabledFeatures
    :String(v).split(',').map(t=>t.trim()).filter(Boolean));
   const on=all.filter(o=>!off.has(o.key));
   return !on.length?'なし（どこにも出ません）':on.length===all.length?'すべて':on.map(o=>o.label).join(' / ');
  }
  /* 設定した場所に実物があるか。設定と実態のずれは、値だけ眺めていても
     気づけない(「登録したのに動かない」の大半がこれ)。 */
  if(col.format==='rneState'){
   if(!v.trim())return '（抽出しない）';
   return v+(col.row&&col.row.rneExists===false?'  ⚠ 未配置':'  ✓');
  }
  if(col.format==='fileState'){
   if(!v.trim())return '';
   return v+(col.row&&col.row.outputExists===false?'  （未作成）':'');
  }
  if(col.format==='equipmentTarget'){
   if(!v.trim())return '';
   return v.trim()===EQUIPMENT_ALL?'すべての設備':v.replace(/、/g,',').split(',').map(s=>s.trim()).filter(Boolean).join(' / ');
  }
  return v;
 }
 /* 入力欄をグループへ束ねる(§9.79)。fieldGroup を持つ欄が現れたら、その
    直前に見出しを1枚挟む。項目が9個並ぶと「どれとどれが関係するのか」を
    毎回読み解くことになるため、3〜4個ずつのまとまりにして、まとまりの
    名前で意味を渡す(チャンク化)。fieldGroup を持たないマスタは従来どおり
    平坦に並ぶ。 */
 function groupFieldControls(def,html){
  const groups=(def.fields||[]).map(f=>f.fieldGroup||'');
  if(!groups.some(Boolean))return html.join('');
  /* ---------- 段（タブ）に分ける（§9.250 ④、利用者の指示） ----------
     「スクロールレス設計をベースにSPAで構成することを軸にしたいので
      基本的に**情報量が多くなった時には**、タブとアコーディオンによる
      情報の階層化、チャンク化を取り入れてください」

     縦に積むと窓に入らない（帳票ブロックは1700×1000の窓で実測**227px**
     はみ出していた）。束はもともと「決める順番」で切ってあるので、
     **束ごとに段へ分ければ1段ぶんの高さで済む**。

     **段の見出しにいまの値を出す**（§2「思い出させない」）——開かないと
     何を決めたか分からない段は、結局全部開いて回ることになる。
     **見本（`asideHtml`）は段の外**に置くので、どの段を見ていても
     刷り上がりが見える（§CLAUDE 14「視覚導線と作業導線を一致させる」）。 */
  if(!def.groupsAsTabs){
   let prev=null;const out=[];
   groups.forEach((g,i)=>{
    if(g&&g!==prev)out.push(`<h4 class="mm-fieldgroup">${esc(g)}</h4>`);
    prev=g||prev;out.push(html[i]);
   });
   return out.join('');
  }
  const order=[],bucket=new Map();
  let prev='';
  groups.forEach((g,i)=>{
   const k=g||prev||'';
   if(!bucket.has(k)){bucket.set(k,[]);order.push(k)}
   bucket.get(k).push(i);
   prev=k;
  });
  const tabs=order.map((g,i)=>
   `<button type="button" class="mm-tab" role="tab" id="mmTab${i}" data-mmtab="${i}"`
   +` aria-selected="${i?'false':'true'}" aria-controls="mmPanel${i}" tabindex="${i?-1:0}">`
   +`<span class="mm-fieldgroup">${esc(g)}</span>`
   +`<small class="mm-tab-sum" data-mmtab-sum="${i}"></small></button>`).join('');
  /* **盤を持つ段は器いっぱいに伸ばす**（§9.254 ①）。パネルは欄を規格幅で
     並べる折り返す横並びなので、既定では中身なりの高さで止まる（それが
     正しい——欄が縦に伸びても嬉しくない）。組み立ての盤（`field-builder`）
     だけは「余った高さがそのまま作業面」なので、その段にだけ印を付ける。
     **`:has()`に頼らない**（§9.218 ②——当たらなかったときに誰も気づけない）。 */
  const panels=order.map((g,i)=>{
   const idx=bucket.get(g);
   const fill=idx.some(j=>((def.fields||[])[j]||{}).type==='field-builder');
   return `<section class="mm-tabpanel${fill?' is-fill':''}" role="tabpanel" id="mmPanel${i}"`
    +` aria-labelledby="mmTab${i}" data-mmtab="${i}"${i?' hidden':''}>`
    +`${idx.map(j=>html[j]).join('')}</section>`;
  }).join('');
  return `<div class="mm-tabbar" role="tablist">${tabs}</div>`
   +`<div class="mm-tabbody">${panels}</div>`;
 }
 /* 段の見出しに出す一言。**欄の値そのものから作る**——束ごとに文言を
    書き分けると、欄を1つ足したときに書き足す場所が増える。
    空の欄は言わない（「未設定・未設定・未設定」は何も語らない）。 */
 function mmTabSummaryText(panel){
  const parts=[];
  panel.querySelectorAll('.mm-field').forEach(fld=>{
   /* 設定ページの欄は`data-pc-field`（§9.261で段に分けた）。**両方見る**
      ——片方だけだと、そのページの段だけ一言が空になる。 */
   const el=fld.querySelector('[data-field],[data-pc-field]');
   if(!el)return;
   /* **触れない欄は数えない**（§CLAUDE 8）——組み込みの印のような
      読み取り専用の値を並べても、決めたことは1つも増えない。 */
   if(fld.classList.contains('mm-field-ro')||el.hasAttribute('readonly'))return;
   let v=String(el.value||'').trim();
   /* 行数は**空も`0`も「中身なり」**（§9.250 ④）。「何も決めていない」と
      「既定のまま」は別のことなので、空欄として落とさず言う。 */
   if(fld.classList.contains('mm-rowsfield')&&(v===''||v==='0')){parts.push('中身なり');return}
   if(!v)return;
   /* 見て選ぶ欄・幅・高さは**押した札の言葉**で言う（保存値の綴りは長い）。 */
   const card=fld.querySelector(`[data-card="${CSS.escape(el.dataset.field)}"].is-on`);
   if(card)v=(card.querySelector('.mm-card-txt>b')||card).textContent.trim()||v;
   else if(fld.classList.contains('mm-spanfield'))v=v+'マス';
   else if(fld.classList.contains('mm-rowsfield'))v=v+'行';
   else if(fld.dataset.fb)v=String(v).split(/[\n,、]/).filter(Boolean).length+'項目';
   if(v.length>14)v=v.slice(0,13)+'…';
   parts.push(v);
  });
  return parts.slice(0,3).join('・')+(parts.length>3?' ほか':'');
 }
 /* ---------- 設定ページの段（タブ）と畳み（アコーディオン）（§9.261） ----------
    利用者の指示「認知心理学に基づきSPAをベースにわかりやすく使いやすいように
    タブとアコーディオンを主構成にして再構成」。

    **編集窓の段と同じ受け皿を使う**（`.mm-tabbar`/`.mm-tabpanel`）——CSSも
    キーボード操作も`bindMaintTabs`もそのまま効く。ここで別の作りを持つと、
    段の見た目と動きが画面ごとに違うことになる（§9.163と同じ理由）。

    畳みは素の`<details>`。**畳んだままでも「いま何が効いているか」は
    見出しに出す**（§3。隠したものを何も書かずに隠すと、設定の存在ごと
    忘れられる・§9.125）。 */
 function pageTabsHtml(items){
  const tabs=items.map((x,i)=>
   `<button type="button" class="mm-tab" role="tab" id="mmTab${i}" data-mmtab="${i}"`
   +` aria-selected="${i?'false':'true'}" aria-controls="mmPanel${i}" tabindex="${i?-1:0}">`
   +`<span class="mm-fieldgroup">${esc(x.name)}</span>`
   +`<small class="mm-tab-sum" data-mmtab-sum="${i}"></small></button>`).join('');
  const panels=items.map((x,i)=>
   `<section class="mm-tabpanel is-page" role="tabpanel" id="mmPanel${i}"`
   +` aria-labelledby="mmTab${i}" data-mmtab="${i}"${i?' hidden':''}>${x.body}</section>`).join('');
  return `<div class="mm-tabbar is-page" role="tablist">${tabs}</div>`
   +`<div class="mm-tabbody is-page">${panels}</div>`;
 }
 /* 畳み。`open`を渡したときだけ開いた状態で出す（既定は畳む）。 */
 function pageFoldHtml(title,now,body,open){
  return `<details class="pc-acc"${open?' open':''}>`
   +`<summary><b>${esc(title)}</b>${now?`<span class="pc-acc-now">${esc(now)}</span>`:''}</summary>`
   +`<div class="pc-acc-body">${body}</div></details>`;
 }
 function bindMaintTabs(form){
  const bar=form.querySelector('.mm-tabbar');
  if(!bar)return;
  const tabs=[...bar.querySelectorAll('[data-mmtab]')];
  const panels=[...form.querySelectorAll('.mm-tabpanel')];
  const show=i=>{
   tabs.forEach((t,j)=>{
    const on=j===i;
    t.setAttribute('aria-selected',on?'true':'false');
    t.tabIndex=on?0:-1;
    t.classList.toggle('is-on',on);
   });
   panels.forEach((p,j)=>{if(p.hidden!==(j!==i))p.hidden=j!==i});
  };
  const paint=()=>panels.forEach((p,i)=>{
   const el=bar.querySelector(`[data-mmtab-sum="${i}"]`);
   if(el)el.textContent=mmTabSummaryText(p);
  });
  if(form.dataset.mmTabsWired!=='1'){
   form.dataset.mmTabsWired='1';
   /* **値が変わったら見出しの一言を描き直す**（忘れると、直したのに
      畳んだ段だけ古い値を名乗る）。 */
   form.addEventListener('change',()=>paint());
   form.addEventListener('input',()=>paint());
  }
  tabs.forEach((t,i)=>{
   t.onclick=()=>show(i);
   t.onkeydown=e=>{
    if(['ArrowRight','ArrowLeft'].indexOf(e.key)<0)return;
    e.preventDefault();
    const nx=(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    show(nx);tabs[nx].focus();
   };
  });
  show(0);
  paint();
  form.__mmShowTab=show;
 }
 /* 入っていない必須の欄がある段を開く（§4）。**開かずに断らないこと**
    ——畳んだ段の中の欄を「入れてください」と言われても、どこにあるのか
    分からない。 */
 function mmRevealField(form,el){
  if(!form||!el||typeof form.__mmShowTab!=='function')return;
  const panel=el.closest('.mm-tabpanel');
  if(!panel)return;
  const i=[...form.querySelectorAll('.mm-tabpanel')].indexOf(panel);
  if(i>=0)form.__mmShowTab(i);
 }
 /* ---------- モーダルの中の欄は「中身の長さ」で決める(§9.221 ④) ----------
    利用者の指摘「モーダル内のUIサイズの設計がモーダル横幅いっぱいまで
    伸びているケースが多いです。規格化してきれいに整列、不用意な余白も
    ないように注意しながら設計してほしいです」。

    以前は編集モーダルが**1行1欄・幅100%**で、表示順（2桁）の欄にも
    600px前後を与えていた（§CLAUDE 11「1桁しか入らない欄に250pxを与えない」）。
    大きさは**`--w-*`の6段から選ぶ**——中身なりの実測をそのまま使うと
    1画面に何種類もの幅が生まれて並ばない（§9.131）。

    段は**型から自動で決まる**（数値=xs／日付=sm／選択=md／自由記述=md）ので、
    マスタを増やしても書き足す必要は無い。合わないものだけ`size:`で名指しする。 */
 /* 12マス中の幅を「読める言葉」にする（§9.249 ③）。6を1/2と読み替えるのは
    人の側の仕事にしない。割り切れないものは「◯マス」のまま言う。 */
 function mmFracText(n,max){
  const m=max||12;
  const map={1:'1/12',2:'1/6',3:'1/4',4:'1/3',6:'1/2',8:'2/3',9:'3/4',12:'全幅'};
  return map[n]||`${n}マス`;
 }
 const MM_SIZE_BY_TYPE={number:'xs',time:'xs',date:'sm',select:'md',
   'master-combo':'md','master-suggest':'md','equipment-select':'md',
   textarea:'full',path:'full','equipment-multi':'full','equipment-multi-text':'full',
   /* 見て選ぶ欄は横いっぱい（札が折り返さないように・§9.249 ③）。 */
   'choice-card':'full','span-grid':'full','rows-pick':'full'};
 function mmFieldSize(f){
  if(f.size)return f.size;
  const t=String(f.type||'text');
  if(MM_SIZE_BY_TYPE[t])return MM_SIZE_BY_TYPE[t];
  /* 自由記述は**役割**から見当を付ける。長い文が入るものだけ広くする。 */
  if(/備考|説明|メモ|内容|コメント|理由|条件|式/.test(String(f.label||'')))return 'lg';
  return 'md';
 }
 /* 先頭の`class="mm-field…"`へ段の印を差し込む。**器そのものは各分岐が
    組み立てる**ので、後から印だけを足す（分岐ごとに書くと足し忘れる）。 */
 function mmSized(html,f){
  return String(html).replace('class="mm-field','class="mm-field mm-w-'+mmFieldSize(f)+' ');
 }
 function buildFieldControls(def,editing){
  return groupFieldControls(def,def.fields.map(f=>mmWhen(mmSized(buildOneFieldControl(f,editing),f),f)));
 }
 /* ---------- 「別の欄で選んだときだけ出す」（§9.234 ⑤） ----------
    帳票ブロックの種別（項目の並び／エリア）のように、**選んだ種別で
    決めることが変わる**設定がある。押せるのに何も起きない欄を残さない（§4）。
    **作り直さないこと**——`hidden`の付け外しだけにする（値もフォーカスも
    失わない。§9.117の「入力中に描き直さない」と同じ理由）。
    印は器へ付ける（`data-when="鍵=値"`）。 */
 function mmWhen(html,f){
  if(!f||!f.when)return html;
  const k=Object.keys(f.when)[0];
  if(!k)return html;
  const v=String(f.when[k]);
  return String(html).replace(/^(\s*<(?:div|label)\b)/,
    (m,head)=>`${head} data-when="${esc(k)}=${esc(v)}"`);
 }
 /* 指し先の欄の値で出し入れする。**値は消さない**（戻せば元の値が残る）。 */
 function bindWhenFields(form){
  const boxes=[...form.querySelectorAll('[data-when]')];
  if(!boxes.length)return;
  const apply=()=>boxes.forEach(box=>{
   const raw=String(box.dataset.when||''),i=raw.indexOf('=');
   if(i<0)return;
   const key=raw.slice(0,i),want=raw.slice(i+1);
   const src=form.querySelector(`[data-field="${CSS.escape(key)}"]`);
   const on=!src||String(src.value||'')===want;
   if(box.hidden!==!on)box.hidden=!on;
  });
  boxes.forEach(box=>{
   const raw=String(box.dataset.when||''),i=raw.indexOf('=');
   if(i<0)return;
   const src=form.querySelector(`[data-field="${CSS.escape(raw.slice(0,i))}"]`);
   if(src&&!src.dataset.whenWired){src.dataset.whenWired='1';src.addEventListener('change',apply)}
  });
  apply();
 }
 function buildOneFieldControl(f,editing){
  return (function(){
   const val=editing?String(editing[f.k]??''):'';
   if(f.type==='equipment-select'){
    const opts=equipmentMasterState.items||[];
    /* **いま入っている設備が候補に無くても捨てないこと**（§9.204と同じ罠）。
       設備マスタからその設備が消えても、行そのものは残っている——候補に
       足さずに描くと`<select>`は「選択...」に落ち、**開いて保存し直した
       だけで設備が空になる**（保存側は空を断るので、その行は編集も
       できなくなる）。足したうえで**無いことを文字で言う**（§4）。 */
    const missing=!!val&&!opts.some(eq=>eq.name===val);
    if(!opts.length&&!missing){
     return `<div class="mm-field"><span>${esc(f.label)}</span><span class="mm-empty-inline">設備マスタが未登録です。先に「設備」タブで登録してください。</span></div>`;
    }
    const optHtml=(missing?`<option value="${esc(val)}" selected>${esc(val)}（設備マスタにありません）</option>`:'')
      +opts.map(eq=>`<option value="${esc(eq.name)}"${eq.name===val?' selected':''}>${esc(eq.name)}</option>`).join('');
    return `<label class="mm-field"><span>${esc(f.label)}${f.required?'<i>*</i>':''}${f.key?'<em class="mm-keytag">キー</em>':''}</span><select data-field="${f.k}">${missing?'':'<option value="">選択...</option>'}${optHtml}</select>${missing?`<small class="mm-field-hint">この設備は設備マスタにありません（消されたか、名前が変わっています）。**そのままにすれば今の設備名を保ちます**。登録済みの設備へ付け替えることもできます。</small>`:(f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:'')}</label>`;
   }
   /* 対象設備を複数選べる欄。作業可能設備(equipment-multi)と同じタグUIだが、
      保存先が配列ではなくカンマ区切りの1列で、さらに「すべての設備」という
      ワイルドカード('*')を持つ。開発・保守用に全設備の権限を1行で渡せる
      ようにするため(設備を増やすたびに権限行を足さなくてよい)。 */
   if(f.type==='equipment-multi-text'){
    const raw=String(editing?(editing[f.k]??''):'').trim();
    const isAll=raw===EQUIPMENT_ALL;
    const selected=new Set(isAll?[]:raw.replace(/、/g,',').split(',').map(s=>s.trim()).filter(Boolean));
    const opts=equipmentMasterState.items||[];
    const hiddenBoxes=opts.map(eq=>`<input type="checkbox" data-equipment-field="${f.k}" value="${esc(eq.name)}"${selected.has(eq.name)?' checked':''} hidden>`).join('');
    // マスタから消えた設備名も選択として残す(黙って権限が消えないように)。
    const strays=[...selected].filter(n=>!opts.some(eq=>eq.name===n));
    const strayBoxes=strays.map(n=>`<input type="checkbox" data-equipment-field="${f.k}" value="${esc(n)}" checked hidden>`).join('');
    // 補足文はマスタごとに意味が違う(権限の対象か/停止内容の対象か)ので
    // def側からf.tagHintで渡す。未指定はアクセス権限マスタの従来文言。
    const tagHint=f.tagHint||'複数選べます。「すべての設備」は開発・保守用の全設備権限です（設備を増やしても権限行を足さずに済みます）。未選択は「未設定」＝権限なしです。';
    return `<div class="mm-field mm-tagfield" data-tagfield="${f.k}" data-tagfield-all="1"><span>${esc(f.label)}${f.required?'<i>*</i>':''}${f.key?'<em class="mm-keytag">キー</em>':''}</span>
     <div class="mm-tagfield-inner">
      <label class="mm-tag-all"><input type="checkbox" data-equipment-all="${f.k}"${isAll?' checked':''}>すべての設備</label>
      <div class="mm-tag-box" data-equipment-box="${f.k}" tabindex="-1">${strayBoxes}<input type="text" class="mm-tag-search" data-equipment-search="${f.k}" placeholder="設備名で検索・追加" autocomplete="off">${hiddenBoxes}</div>
      <div class="mm-tag-suggest" data-equipment-suggest="${f.k}" hidden></div>
     </div>
     <small class="mm-field-hint">${hintHtml(tagHint)}</small></div>`;
   }
   if(f.type==='equipment-multi'){
    const selected=new Set((editing&&Array.isArray(editing[f.k])?editing[f.k]:[]).map(String));
    const opts=equipmentMasterState.items||[];
    if(!opts.length){
     return `<div class="mm-field"><span>${esc(f.label)}</span><span class="mm-empty-inline">設備マスタが未登録です。先に「設備」タブで登録してください。</span></div>`;
    }
    const hiddenBoxes=opts.map(eq=>`<input type="checkbox" data-equipment-field="${f.k}" value="${esc(eq.name)}"${selected.has(eq.name)?' checked':''} hidden>`).join('');
    const tags=opts.filter(eq=>selected.has(eq.name)).map(eq=>`<span class="mm-tag">${esc(eq.name)}<button type="button" class="mm-tag-remove" aria-label="${esc(eq.name)}を削除">×</button></span>`).join('');
    return `<div class="mm-field mm-tagfield" data-tagfield="${f.k}"><span>${esc(f.label)}</span>
     <div class="mm-tagfield-inner">
      <div class="mm-tag-box" data-equipment-box="${f.k}" tabindex="-1">${tags}<input type="text" class="mm-tag-search" data-equipment-search="${f.k}" placeholder="設備名で検索・追加" autocomplete="off">${hiddenBoxes}</div>
      <div class="mm-tag-suggest" data-equipment-suggest="${f.k}" hidden></div>
     </div>
     <small class="mm-field-hint">クリックで追加・×で削除。未選択なら制限なし（全設備で表示対象）。</small></div>`;
   }
   if(f.type==='select'){
    const opts=(f.options||[]).map(o=>`<option value="${esc(o)}"${o===val?' selected':''}>${esc(o||'（指定なし）')}</option>`).join('');
    /* **説明を書いたら出す**（§9.222 ⑧）。ここだけ`f.hint`を捨てていたので、
       マスタ定義に書いた注意書きが選択欄でだけ黙って消えていた。 */
    return `<label class="mm-field">${fieldLabelHtml(f)}<select data-field="${f.k}">${opts}</select>`
      +(f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:'')+`</label>`;
   }
   /* 別マスタ連動の選択欄(§5.3.1)。選ぶだけで済むのが基本で、無い値は
      「＋ 新しく追加」から入力する。保存時に相手のマスタへも登録される。 */
   if(f.type==='master-combo'){
    return `<div class="mm-field mm-combo" data-combo="${f.k}" data-combo-endpoint="${esc(f.source&&f.source.endpoint||'')}" data-combo-valuekey="${esc(f.source&&f.source.valueKey||'name')}">
      ${fieldLabelHtml(f)}
      <div class="mm-combo-inner">
       <select data-combo-select="${f.k}"><option value="">読み込んでいます…</option></select>
       <input data-field="${f.k}" type="hidden" value="${esc(val)}">
       <input class="mm-combo-new" data-combo-new="${f.k}" type="text" placeholder="新しい${esc(f.label)}を入力" autocomplete="off" hidden>
      </div>
      <small class="mm-field-hint">${hintHtml(f.hint||'一覧から選ぶだけで入力できます。無いものは「＋ 新しく追加」を選ぶとこの場で登録できます。')}</small></div>`;
   }
   /* 候補を出すだけの自由記述（§9.239 ⑥）。**選択肢で塞がない**——
      現場の呼び名は事前に数え切れないので、一覧に無い値も打てるようにする。
      候補の出どころは**サーバーの戻り**（`maintState.meta[source.key]`）で、
      画面には綴りを書き写さない（§9.163）。 */
   if(f.type==='master-suggest'){
    const key=(f.source&&f.source.key)||'';
    const opts=(maintState.meta&&Array.isArray(maintState.meta[key]))?maintState.meta[key]:[];
    const lid=`mmSuggest_${f.k}`;
    return `<label class="mm-field">${fieldLabelHtml(f)}
      <input data-field="${f.k}" type="text" list="${lid}" autocomplete="off" value="${esc(val)}">
      <datalist id="${lid}">${opts.map(o=>`<option value="${esc(o)}"></option>`).join('')}</datalist>
      ${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</label>`;
   }
   if(f.type==='number'){
    return `<label class="mm-field mm-field-num">${fieldLabelHtml(f)}${numFieldHtml(f,val)}${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</label>`;
   }
   /* ---------- 選んで組み立てる（§9.226 ④、利用者の指示） ----------
      「帳票ブロックを新規登録が難しすぎて作成できない。入力データ(汎用入力
       データも含む)の中から選んで組み合わせたり配置する方式で、直感的に
       組み合わせてデータブロックを作ることができるようにしてほしい」

      保存の形は今までどおり`ラベル=出どころ`の並び（`[内容]`）で、
      **書く手段を変えただけ**——保存の形まで変えると、既に登録してある
      塊が読めなくなる（§9.171の「印は名前で運ぶ」と同じ考え方）。
      左が候補（出どころごとにまとまっている）、右が載せる項目。押すと
      移り、掴んで並べ替えられる。ラベルはその場で直せる。
      **候補はサーバーが答える**（`catalog`）ので、操業データの項目を足せば
      そのままここに増える（§9.163「判定を画面に書かない」）。 */
   /* ---------- 選ばせる欄を「見て選ぶ」形にする（§9.249 ③） ----------
      利用者の指摘「文字が多いわりにわかりにくく」。選択肢の意味が
      **選ぶ前に読めない**のが原因で、プルダウンは名前しか出せない。
      札に**絵・名前・一言**を並べれば、開かなくても違いが分かる（§CLAUDE 2）。
      値を持つのは今までどおり隠し欄なので、`submitMaint`は型を知らなくてよい。 */
   if(f.type==='choice-card'){
    /* **選択欄と同じ既定にする**（§9.249 ③）——`<select>`は先頭の選択肢が
       最初から選ばれている。札にした途端に「どれも選ばれていない」状態が
       生まれると、②の欄が`data-when`で消えて**決めることが1つ消える**
       （新規登録で実際にそうなった）。 */
    /* **語彙をサーバーから取れるようにする**（§9.305 ①）——`source.key`を
       書いたときは`maintState.meta[key]`（`{key,label,note}`の並び）を札に
       する。画面へ綴りを書き写さないための口で、静的な`cards`は今までどおり。 */
    const srcKey=(f.source&&f.source.key)||'';
    const list=srcKey
      ?((maintState.meta&&Array.isArray(maintState.meta[srcKey])?maintState.meta[srcKey]:[])
         .map(o=>({v:o.key,label:o.label||o.key,note:o.note||''})))
      :(f.cards||[]);
    const cur=String(val||'')||String((list[0]||{}).v||'');
    const cards=list.map(c=>{
     const on=cur===String(c.v);
     return `<button type="button" class="mm-card-opt${on?' is-on':''}" data-card="${f.k}" data-card-v="${esc(c.v)}"`
      +` aria-pressed="${on?'true':'false'}" title="${esc(c.note||c.label)}">`
      +`<span class="mm-card-ico" aria-hidden="true">${esc(c.icon||'')}</span>`
      +`<span class="mm-card-txt"><b>${esc(c.label)}</b>`
      +`${c.note?`<small>${esc(c.note)}</small>`:''}</span></button>`;
    }).join('');
    return `<div class="mm-field mm-field-area mm-cards">${fieldLabelHtml(f)}
      <div class="mm-card-row">${cards}</div>
      <input type="hidden" data-field="${f.k}" value="${esc(cur)}">
      ${list.length?'':'<small class="mm-field-hint">選べる候補をこの端末では読めませんでした。</small>'}
      ${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</div>`;
   }
   /* ---------- いくつでも入切できる札（§9.302） ----------
      利用者の指示「有効無効の範囲については機能別に分けて変更できるように」。
      `choice-card`は1つしか選べないので、**入切を並べる型**を1つ足す。
      **語彙はサーバーの戻り**（`maintState.meta[f.source.key]`）から取る
      ——画面へ綴りを書き写すと、機能を1つ足したときに直す場所が2つになる
      （§9.163。`master-suggest`と同じ作法）。

      **画面は「使う機能」を出し、保存値は「使わない機能」**（§9.302）。
      裏返しなのは保存の側に理由があって——空欄＝すべて使える、にしないと
      **あとで機能を足したときに既存の設備で黙って無効になる**。裏返す場所は
      この型の描画と入切の2箇所だけで、規則（空欄の意味・知らない綴りの扱い）は
      サーバーが持つ。 */
   if(f.type==='check-set'){
    const key=(f.source&&f.source.key)||'';
    const opts=(maintState.meta&&Array.isArray(maintState.meta[key]))?maintState.meta[key]:[];
    const off=new Set(String(Array.isArray(val)?val.join(','):(val||'')).split(',').filter(Boolean));
    const cards=opts.map(o=>{
     const on=!off.has(o.key);
     return `<button type="button" class="mm-card-opt${on?' is-on':''}" data-checkset="${f.k}"`
      +` data-checkset-v="${esc(o.key)}" aria-pressed="${on?'true':'false'}"`
      +` title="${esc(o.note||o.label)}">`
      +`<span class="mm-card-ico" aria-hidden="true">${on?'✓':'—'}</span>`
      +`<span class="mm-card-txt"><b>${esc(o.label)}</b>`
      +`${o.note?`<small>${esc(o.note)}</small>`:''}</span></button>`;
    }).join('');
    return `<div class="mm-field mm-field-area mm-cards" data-checkset-box="${f.k}">${fieldLabelHtml(f)}
      <div class="mm-card-row">${cards}</div>
      <input type="hidden" data-field="${f.k}" value="${esc([...off].join(','))}">
      <small class="mm-field-hint" data-checkset-note="${f.k}"></small>
      ${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</div>`;
   }
   /* 紙の12マスをそのまま出して、**押した幅がそのまま見える**ようにする。
      「6＝1/2」を頭の中で割り算させない（§CLAUDE 6）。 */
   if(f.type==='span-grid'){
    const max=f.max||12,cur=Math.max(1,Math.min(max,Number(val)||max));
    const allow=(f.options||[]).map(Number).filter(n=>n>0);
    const cells=[];
    for(let i=1;i<=max;i++){
     const pick=allow.length?allow.find(n=>n>=i)||allow[allow.length-1]:i;
     cells.push(`<button type="button" class="mm-span-cell${i<=cur?' is-on':''}"`
      +` data-span="${f.k}" data-span-v="${pick}" title="${pick}マス（12マス中）にします">${i}</button>`);
    }
    return `<div class="mm-field mm-field-area mm-spanfield">${fieldLabelHtml(f)}
      <div class="mm-span-grid" role="group" aria-label="幅（12マス中）">${cells.join('')}</div>
      <div class="mm-span-read"><b data-span-read="${f.k}">${cur}</b> / ${max} マス
       <em data-span-frac="${f.k}">${esc(mmFracText(cur,max))}</em></div>
      <input type="hidden" data-field="${f.k}" value="${esc(val)}">
      ${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</div>`;
   }
   /* 高さ。**「中身なり」を1つ目の札にする**——既定がどれかを最初に見せる。 */
   if(f.type==='rows-pick'){
    const opts=f.options||[''];
    const cur=String(val||'');
    return `<div class="mm-field mm-field-area mm-rowsfield">${fieldLabelHtml(f)}
      <div class="mm-rows-pick" role="group" aria-label="高さ（行数）">${opts.map(o=>{
       const on=String(o)===cur;
       const label=o===''?'中身なり':o+'行';
       return `<button type="button" class="mm-rows-opt${on?' is-on':''}" data-rows="${f.k}" data-rows-v="${esc(o)}"`
        +` aria-pressed="${on?'true':'false'}" title="${o===''?'描いてから測って、中身の高さに合わせます':o+'行ぶん（1行＝24px）の高さで固定します'}">`
        +`<i aria-hidden="true" style="--mm-rows:${o===''?1:Number(o)}"></i><span>${esc(label)}</span></button>`;
      }).join('')}</div>
      <input type="hidden" data-field="${f.k}" value="${esc(val)}">
      ${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</div>`;
   }
   if(f.type==='field-builder'){
    return `<div class="mm-field mm-field-area fb" data-fb="${f.k}">${fieldLabelHtml(f)}
      <div class="fb-body">
       <div class="fb-pick">
        <div class="fb-pick-head"><b>選べる項目</b>
         <input type="search" class="fb-search" placeholder="項目名で絞る" autocomplete="off"></div>
        <div class="fb-cats" role="tablist"></div>
        <div class="fb-list"></div>
       </div>
       <div class="fb-chosen">
        <div class="fb-chosen-head"><b>紙での並び</b><span class="fb-count"></span>
         <span class="fb-cols" role="group" aria-label="列数"></span>
         <button type="button" class="fb-head ghost" title="値を持たず文字だけを出すマスを1つ足します（表の軸の見出しに使います）">見出し</button>
         <button type="button" class="fb-blank ghost" title="何も出さずに場所だけ取るマスを1つ足します（区切りの良い並びに整えるため）">空きマス</button>
         <button type="button" class="fb-table ghost" title="選んだ項目を、行と列の軸で表に組み直します">表に組む</button>
         <!-- ラベルと値の並べ方をまとめて変える（§9.292 ⑤）。**設定は
              マス側の1つだけ**で、これは「全部のマスへ同じ値を書く」操作
              （「既定の中身を写す」と同じ立ち位置。設定を2つ持たない）。 -->
         <button type="button" class="fb-stack ghost"
           title="ラベルを出しているマスを、まとめて「上下（ラベルの下に値）」／「横（ラベル：値）」へ切り替えます">ラベルを上下に</button>
         <button type="button" class="fb-seed ghost" hidden>既定の中身を写す</button>
         <button type="button" class="fb-clear ghost">全部外す</button></div>
        <!-- 軸の置き場（§9.277）。**組める材料があるときだけ中身が入る**
             （押せるのに何も起きない帯を置かない・§4）。 -->
        <div class="fb-axes" hidden></div>
        <p class="fb-hint">下の枠が<b>紙のこの塊そのもの</b>です。掴んで動かすと並びが変わり、
         各マスの<b>数字</b>で横に使うマス数を決められます。<b>マスを押すと</b>下で
         種別・寄せ・書式を決められます。</p>
        <div class="fb-rows"></div>
        <div class="fb-insp" hidden></div>
       </div>
      </div>
      <input type="hidden" data-field="${f.k}" value="${esc(val)}">
      <small class="mm-field-hint">${hintHtml(f.hint||'')}</small></div>`;
   }
   /* 複数行の入力欄（§9.217）。1行1件を書かせる設定（帳票ブロックの内容）で
      使う——1行の欄に押し込むと、何件書いたのかが読めない。 */
   if(f.type==='textarea'){
    return `<label class="mm-field mm-field-area">${fieldLabelHtml(f)}`
     +`<textarea data-field="${f.k}" rows="${f.rows||6}" spellcheck="false"`
     +` placeholder="${esc(f.placeholder||'')}">${esc(val)}</textarea>`
     +`${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</label>`;
   }
   if(f.type==='date'){
    return `<label class="mm-field">${fieldLabelHtml(f)}<span class="mm-date"><input data-field="${f.k}" type="date" value="${esc(val)}"><button type="button" class="mm-date-today" data-date-today="${f.k}">今日</button></span>${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</label>`;
   }
   if(f.type==='time'){
    return `<label class="mm-field">${fieldLabelHtml(f)}<input data-field="${f.k}" type="time" step="60" value="${esc(val)}">${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</label>`;
   }
   if(f.type==='path'){
    return `<div class="mm-field mm-field-path">${fieldLabelHtml(f)}
      <span class="mm-path" data-path-drop="${f.k}">
       <input data-field="${f.k}" type="text" value="${esc(val)}" autocomplete="off" spellcheck="false" placeholder="${esc(f.placeholder||'')}">
       <button type="button" class="mm-path-browse" data-path-browse="${f.k}" data-path-mode="${esc(f.pathMode||'file')}">参照…</button>
      </span>
      <small class="mm-field-hint">${hintHtml(f.hint||'「参照…」で選ぶか、エクスプローラーからここへドラッグ&ドロップできます。')}</small></div>`;
   }
   /* 見せるが触らせない欄（§9.219 ②）。付け替えられない値（帳票ブロックの
      組み込みキー）は、隠すと「なぜ中身を変えられないのか」が読めなくなる
      ——出しておいて、変えられないことを`readonly`で示す（`disabled`に
      しないのは、そのまま保存へ戻すため）。 */
   if(f.type==='readonly'||f.readonly){
    return `<label class="mm-field mm-field-ro">${fieldLabelHtml(f)}`
     +`<input data-field="${f.k}" type="text" value="${esc(val)}" readonly tabindex="-1">`
     +`${f.hint?`<small class="mm-field-hint">${hintHtml(f.hint)}</small>`:''}</label>`;
   }
   return `<label class="mm-field">${fieldLabelHtml(f)}<input data-field="${f.k}" type="text" value="${esc(val)}" autocomplete="off"></label>`;
  })();
 }

 /* ---------- Excelの持ち出し・取り込み（§9.240、利用者の指示） ----------
    「ロールマスタについて EXCELでのインポート＆エクスポート機能を実装して
     ください。」

    作法は §9.171（フィルタ）・§9.178（列設定）に合わせる:
     ・**モーダルを増やさない。** 一覧の上の帯に置く——何が出て行くのかを
       実物の一覧を見たまま確かめられるのが値打ち。
     ・**運ぶもの・運ばないものを画面に書く。** IDは運ばない（端末ごとの
       連番なので、別のPCで取り込むと無関係な行を書き換える）。
     ・**保存する前に下見できる**（§9.193）。何件が追加で何件が上書きか、
       どの行がなぜ飛ばされるかを、書き込む前に出す。
     ・**飛ばした件数と理由を必ず文字で言う**（§CLAUDE 4）。 */
 /* ---------- 見本のロットで帳票を見る（§9.253、利用者の指示） ----------
    「今の状態だと、登録済みのデータから、帳票の表示を行うパターンで実データ
     での確認が必要です。クリックのステップ数が多いのと、実データがないと
     確認できない点が問題です。全入力可能データのダミーデータを1データ、
     内部に持っておくこととそのデータを活用し帳票のプレビューを帳票ブロック
     マスタから確認用に実際のデータを配置した形かつ、現在のレイアウトでの
     データを見られる、試し印刷もできるようにしてください」

    **1押しで刷り上がりまで行く**（§2「探させない」）——それまでは
    「データ一覧を開く→ロットを探す→行を開く→帳票」の4段で、しかも
    実データが1件も無い端末では**確かめる手立てが無かった**。
    見本のロットはサーバーが1件だけ作る（§9.163。値は設定画面の
    「見本の値」と同じ`SAMPLE_VALUES`が持つので、欄で確かめた文字が
    そのまま紙に出る）。

    印は`sampleReport:true`の1つ（`excelIo`・`bulkDelete`と同じ差し替え口）。 */
 function sampleReportHtml(def){
  if(!def.sampleReport)return '';
  return `<span class="mm-sample-tools">
    <button type="button" id="mmSampleView" class="mm-btn-ghost sm"
      title="見本のロット1件で、いまの配置のまま帳票のプレビューを開きます（実データは要りません。保存もされません）">見本で帳票を見る</button>
    <button type="button" id="mmSamplePrint" class="mm-btn-ghost sm"
      title="見本のロットで、いまの配置のまま試しに1枚刷ります">試し印刷</button>
   </span>`;
 }
/* ---------- 親子のマスタを行き来する（§9.254 ③、利用者の指示
    「帳票レイアウトマスタと帳票ブロックマスタを配線しリンクさせて」） ----------
    **印1つの差し替え口**（`excelIo`・`bulkDelete`・`sampleReport`と同じ作法）。
    `linkTo:{key,label,title}`を足すと、一覧の帯に相手のタブへ渡るボタンが出る。
    **入口を2つにしない**——渡す先は左のナビと同じボタンを押すだけなので、
    タブの選び方が2通りにならない。 */
 function linkMasterHtml(def){
  const l=def&&def.linkTo;if(!l)return '';
  return `<button type="button" id="mmLinkMaster" class="mm-btn-ghost sm"
    title="${esc(l.title||'')}">${esc(l.label)}</button>`;
 }
 function bindLinkMaster(def){
  const b=$('#mmLinkMaster'),l=def&&def.linkTo;if(!b||!l)return;
  b.onclick=()=>{
   const nav=document.querySelector(`#masterMaintNav [data-master="${CSS.escape(l.key)}"]`);
   if(nav)nav.click();
   else showToast&&showToast('移れませんでした',`「${l.label}」のタブが見つかりません。`,5000);
  };
 }
 function bindSampleReport(def){
  if(!def.sampleReport)return;
  const go=async print=>{
   if(!(window.WL&&WL.reportSample&&typeof WL.reportSample.open==='function')){
    /* **公開漏れは黙って素通しにしない**（§CLAUDE）——「あれば使う」で
       書くと、名前を変えた日に押しても何も起きない欄になる。 */
    console.error('WL.reportSample.open が見つかりません');
    showToast&&showToast('帳票を開けません','帳票の画面が読み込まれていません。',6000);return;
   }
   await WL.reportSample.open({returnTo:'blocks',print:!!print});
  };
  const v=$('#mmSampleView');if(v)v.onclick=()=>go(false);
  const pr=$('#mmSamplePrint');if(pr)pr.onclick=()=>go(true);
 }

 /* ---------- まとめて消す（§9.251、利用者の指示「ロールマスタの全削除機能
    （ロールマスタの完全入替機能）を実装してください」） ----------
    **印を1つ付けるだけ**の差し替え口（`excelIo`と同じ作法）。
    `bulkDelete:true` を足すと、`<endpoint>/delete-all` を叩く帯が出る。
    **範囲の選択肢はサーバーが数える**（下見の`byEquipment`）——画面が
    一覧から数え直すと、消す範囲と選択肢が別々の数え方になる（§9.163）。 */
 function bulkDeleteHtml(def){
  if(!def.bulkDelete)return '';
  return `<button type="button" id="mmBulkDel" class="mm-btn-danger sm mm-bulk-del"
    title="登録されているロールをまとめて消します。押すと、範囲（すべて／設備を1つ）と件数を確かめてから消します">全部消す…</button>`;
 }
 function bindBulkDelete(def){
  const b=$('#mmBulkDel');if(!b||!def.bulkDelete)return;
  b.onclick=()=>bulkDeleteFlow(def);
 }
 async function bulkDeleteFlow(def){
  const uid=requireMaintUser();if(uid===null)return;
  let plan;
  try{
   /* **まず下見**（`apply`を付けない＝1件も消えない）。ここで初めて
      「どの設備に何件あるか」がサーバーの数え方で分かる。 */
   plan=await api(def.endpoint+'/delete-all',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({scope:'all',user_id:uid})});
  }catch(e){showToast&&showToast('件数を数えられませんでした',e.message,7000);return}
  if(!plan.total){
   showToast&&showToast('消すものがありません',`${def.label}は0件です。`,3600);return;
  }
  const by=plan.byEquipment||[];
  const rows=by.map((x,i)=>`<label class="mm-bulk-pick"><input type="radio" name="mmBulkScope"
     value="eq:${i}"><span>${esc(x.equipment||'設備の入っていない行')}</span><em>${x.count}件</em></label>`).join('');
  /* **既定を持たせない**——「消す」に既定の範囲があると、押し間違いが
     そのまま全消しになる。選ぶまでボタンは押せず、その理由をその場に書く
     （§CLAUDE 4）。 */
  const body=`<p class="confirm-modal-message">${esc(def.label)}を<b>まとめて消します</b>。取り消せません。
    <b>どの範囲を消すか</b>を選んでください。</p>
   <div class="mm-bulk-scopes">
    ${rows}
    <label class="mm-bulk-pick is-all"><input type="radio" name="mmBulkScope" value="all">
     <span>すべての設備</span><em>${plan.total}件</em></label>
   </div>
   <p class="confirm-modal-message mm-bulk-tip">元へ戻すには、消す前に「書き出す」でExcelへ残してください
    （そのファイルを「取り込む」で戻せます）。</p>`;
  const p=confirmModal({title:`${def.label}をまとめて削除します`,eyebrow:'DELETE ALL',
                        bodyHtml:body,confirmLabel:'削除する',danger:true});
  /* 確認モーダルは**画面で1枚を使い回す**（`ensureConfirmModal`）ので、
     ここで足した見張りと`disabled`は**必ず自分で外す**——外さないと、
     次にどこかが確認を出したときに前の流れの見張りが一緒に動く。 */
  const ok=$('#appConfirmOk'),box=$('#appConfirmBody');
  let pick=null,onPick=null,note=null;
  if(ok&&box){
   ok.disabled=true;
   note=document.createElement('p');
   note.className='confirm-modal-message mm-bulk-need';
   note.textContent='範囲を選ぶと「削除する」を押せます。';
   box.append(note);
   onPick=ev=>{
    const el=ev.target;if(!el||el.name!=='mmBulkScope')return;
    pick=el.value;ok.disabled=false;if(note)note.remove();
   };
   box.addEventListener('change',onPick);
  }
  let go=false;
  try{go=await p}
  finally{
   if(ok)ok.disabled=false;
   if(box&&onPick)box.removeEventListener('change',onPick);
  }
  if(!go||!pick)return;
  const scope=pick==='all'?'all':'equipment';
  const eq=pick==='all'?undefined:(by[Number(pick.slice(3))]||{}).equipment;
  try{
   setMaintLoading(true,'削除しています…');
   const body2={scope,user_id:uid,apply:true};
   if(scope==='equipment')body2.equipment=eq||'';
   const r=await api(def.endpoint+'/delete-all',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify(body2)});
   await loadMaintInner(true);
   showToast&&showToast('削除しました',(r&&r.message)||'',4200);
  }catch(e){showToast&&showToast('削除できませんでした',e.message,7000)}
  finally{setMaintLoading(false)}
 }

 /* **取り込み方は3つ**（§9.251、利用者の指示「ロールマスタの全削除機能
    （ロールマスタの完全入替機能）を実装してください」）。綴りはサーバーの
    `roll_repo.REPLACE_MODES`と1対1で、**何が消えるかを画面は決めない**
    ——決めるのは`import_rows()`の1箇所（§9.163）。ここが持つのは
    「どう名乗るか」だけ。 */
 const XIO_MODES=[
  {v:'',    label:'足す・上書きする',
   note:'ファイルに在る行だけを足す・上書きします。<i>ファイルに無いロールはそのまま残ります（今までどおり）。'
       +'突き合わせは<b>設備名・ロール名・接触面・ロール径MAX・ロール径MIN・備考</b>なので、'
       +'この6つのどれかを書き直した行は「上書き」ではなく<b>追加</b>になります。</i>'},
  {v:'file',label:'ファイルの設備を入れ替える',
   note:'<b>ファイルに出てくる設備</b>のロールを、ファイルの内容そのものにします。<i>その設備の、ファイルに無いロールは削除されます。他の設備は触りません。</i>'},
  {v:'all', label:'すべての設備を入れ替える',
   note:'<b>すべての設備</b>のロールを、ファイルの内容そのものにします。<i>ファイルに1行も出てこない設備のロールも削除されます。</i>'}];
 const xioMode=()=>String($('#mmXioMode')?.value||'');
 function xioModeNote(){
  const m=XIO_MODES.find(x=>x.v===xioMode())||XIO_MODES[0],box=$('#mmXioNote');
  if(box)box.innerHTML=m.note;
 }
 function excelIoHtml(def){
  if(!def.excelIo)return '';
  return `<div class="mm-xio" id="mmXio">
    <div class="mm-xio-head">
     <b>Excel</b>
     <button type="button" id="mmXioOut" class="mm-btn-ghost sm"
       title="いまの一覧をそのままExcelファイル（.xlsx）で保存します。無効にした行も出ます">書き出す</button>
     <label class="mm-xio-mode" for="mmXioMode">取り込み方
      <select id="mmXioMode">${XIO_MODES.map(m=>
        `<option value="${esc(m.v)}">${esc(m.label)}</option>`).join('')}</select></label>
     <button type="button" id="mmXioPick" class="mm-btn-ghost sm"
       title="Excelファイル（.xlsx）を選ぶと、取り込む前に「何件追加・何件上書き・何件削除」を出します">取り込む…</button>
     <input type="file" id="mmXioFile" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
     <span class="mm-xio-note">突き合わせは<b>設備名＋ロール名＋接触面</b>。同じ組み合わせがあれば上書き、無ければ追加します。
      <i>IDは運びません（別のPCでも同じファイルが使えます）。</i>
      <span id="mmXioNote"></span></span>
    </div>
    <div class="mm-xio-result" id="mmXioResult" hidden></div>
   </div>`;
 }
 let xioPending=null;          // 下見が通ったファイル（適用ボタンが使う）
 function bindExcelIo(def){
  if(!def.excelIo)return;
  const say=(html,cls)=>{
   const box=$('#mmXioResult');if(!box)return;
   box.hidden=!html;box.className='mm-xio-result'+(cls?' '+cls:'');box.innerHTML=html||'';
  };
  xioModeNote();
  const mode=$('#mmXioMode');
  if(mode)mode.onchange=()=>{
   xioModeNote();
   /* **取り込み方を変えたら下見をやり直す**（§CLAUDE 2「次にすることを
      常に1つだけ指す」）——古い下見を残すと、「削除0件」と書いてある画面の
      ボタンを押した瞬間に削除が走る。選び直したその場で数え直す。 */
   if(xioPending)xioPreview(def,say,xioPending.b64,xioPending.uid,xioPending.name);
   else say('');
  };
  const out=$('#mmXioOut');
  if(out)out.onclick=()=>{
   /* サーバーが組み立てた .xlsx をそのまま落とす（`logs.py`のログ保存と
      同じ作法）。**画面側で組み立てない**——列の並びと見出しは
      `roll_repo.IO_COLUMNS` の1箇所が持つ（書き写すと取り込みと食い違う）。 */
   say('書き出しています…');
   location.href=def.endpoint+'/export';
   setTimeout(()=>say('書き出しました（ブラウザの保存先を確認してください）。','is-ok'),900);
  };
  const pick=$('#mmXioPick'),file=$('#mmXioFile');
  if(pick&&file)pick.onclick=()=>{file.value='';file.click()};
  if(file)file.onchange=async()=>{
   const f=file.files&&file.files[0];if(!f)return;
   const uid=requireMaintUser();if(uid===null)return;
   say('読んでいます…');
   let b64;
   try{
    b64=await new Promise((ok,ng)=>{
     const r=new FileReader();
     r.onload=()=>ok(String(r.result||'').split(',')[1]||'');
     r.onerror=()=>ng(new Error('ファイルを読めませんでした'));
     r.readAsDataURL(f);
    });
   }catch(e){say(esc(e.message),'is-bad');return}
   xioPending={b64,uid,name:f.name};
   await xioPreview(def,say,b64,uid,f.name);
  };
 }
 /* 入れ替えは取り消せないので、**消える件数と設備を名乗って1回だけ確かめる**
    （§CLAUDE 5。`dropRetiredTable()`と同じ作法）。 */
 async function xioConfirmReplace(r){
  const by={};
  (r.remove||[]).forEach(x=>{const k=x.equipment||'（設備なし）';by[k]=(by[k]||0)+1});
  const list=Object.keys(by).map(k=>`<li><b>${esc(k)}</b><em>${by[k]}件${
    r.removeMore?'以上':''}</em></li>`).join('');
  const body=`<p class="confirm-modal-message">ファイルに出てこないロール
    <b>${r.removeCount}件</b>を<b>削除します</b>。取り消せません。</p>
   <ul class="cl-confirm">${list}</ul>
   <p class="confirm-modal-message">同時に 追加${r.add||0}件・上書き${r.update||0}件 を行います。
    元へ戻すには、いまのマスタを先に「書き出す」でExcelへ残してください。</p>`;
  if(typeof confirmModal!=='function')
   return window.confirm(`ファイルに出てこないロール ${r.removeCount}件を削除します。よろしいですか？`);
  return await confirmModal({title:'ロールを入れ替えます',eyebrow:'REPLACE',
                             bodyHtml:body,confirmLabel:'入れ替える',danger:true});
 }
 /* **下見と適用は同じ1本を通る**（§9.240 の`RollIndex`と同じ理由）——
    取り込み方・ファイル・利用者が同じなら、見せた内容と起きることが必ず
    一致する。取り込み方を選び直したときもここへ戻ってくる。 */
 async function xioPreview(def,say,b64,uid,name){
  const replace=xioMode();
  say('読んでいます…');
  try{
   const r=await api(def.endpoint+'/import',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({fileBase64:b64,user_id:uid,replace})});
   xioPending={b64,uid,name};
   const nothing=!(r.add+r.update+(r.removeCount||0));
   say(xioPreviewHtml(r,name),(nothing||r.blocked)?'is-bad':'');
   const go=$('#mmXioApply');
   if(go)go.onclick=async()=>{
    if(!xioPending)return;
    /* **消える行があるときだけ、もう一度だけ確かめる**（§CLAUDE 5）。
       件数が0のときは今までどおり1押しで通す——確認を毎回出すと読まずに
       押す癖が付く（§9.170）。 */
    if(r.removeCount&&!(await xioConfirmReplace(r)))return;
    go.disabled=true;say('取り込んでいます…');
    try{
     const done=await api(def.endpoint+'/import',{method:'POST',
       headers:{'Content-Type':'application/json'},
       body:JSON.stringify({fileBase64:xioPending.b64,user_id:xioPending.uid,
                            replace,apply:true})});
     xioPending=null;
     say(xioPreviewHtml(done,name),'is-ok');
     await loadMaintInner(true);
    }catch(e){say('取り込めませんでした: '+esc(e.message),'is-bad')}
   };
  }catch(e){xioPending=null;say('取り込めませんでした: '+esc(e.message),'is-bad')}
 }
 /* 下見・結果の見せ方。**件数は必ず文字で**、飛ばした行は**理由つきで
    全部**出す（§CLAUDE 4。「N件飛ばしました」だけでは直せない）。 */
 function xioPreviewHtml(r,fileName){
  const skipped=r.skipped||[];
  const rows=skipped.map(x=>`<li><b>${esc(String(x.row||'-'))}行目</b>${
    x.name?` <span>${esc(x.name)}</span>`:''} — ${esc(x.why||'')}</li>`).join('');
  const done=!r.dryRun;
  /* **消える行は件数だけで済ませない**（§CLAUDE 4／§3）——取り消せない
     ので、どのロールが消えるのかを名前で出す。全部は並べないが、
     **並べなかった件数は必ず言う**。 */
  const rm=r.remove||[],rmN=r.removeCount||0;
  /* **見分けが付く形で出す**（§9.257 ③）——1本を見分けるのは6つなので、
     設備と名前だけでは「消える3件」が同じ行に見える（同じ名前で接触面・
     径・備考だけが違う行が並ぶのが、この鍵を広げた理由そのもの）。 */
  const rmTag=x=>[x.contactFace,
                  (x.diaMax!=null||x.diaMin!=null)
                    ?'φ'+[x.diaMax,x.diaMin].filter(v=>v!=null).join('〜'):'',
                  x.note].filter(Boolean).join(' ／ ');
  const rmRows=rm.map(x=>{const t=rmTag(x);
    return `<li><b>${esc(x.equipment||'（設備なし）')}</b> <span>${esc(x.name||'')}</span>${
      t?` — ${esc(t)}`:''}</li>`}).join('')
   +(r.removeMore?`<li>ほか ${r.removeMore}件</li>`:'');
  const kept=r.keptNoEquipment||0;
  const canGo=!r.blocked&&(r.add||r.update||rmN);
  return `<div class="mm-xio-sum">
    <b>${esc(fileName||'')}</b>
    <span>シート「${esc(r.sheet||'')}」／データ ${r.total||0}行</span>
    <span class="mm-xio-num">追加 <b>${r.add||0}</b></span>
    <span class="mm-xio-num">上書き <b>${r.update||0}</b></span>
    ${r.replace?`<span class="mm-xio-num${rmN?' is-warn':''}">削除 <b>${done?(r.removed||0):rmN}</b></span>`:''}
    ${skipped.length?`<span class="mm-xio-num is-bad">取り込めない <b>${skipped.length}</b></span>`:''}
   </div>
   ${kept?`<p class="mm-xio-kept">設備の入っていない行 ${kept}件は残します（Excelでは設備名が空のまま表せないため）。消すときは「全部消す…」から。</p>`:''}
   ${done?`<p class="mm-xio-done">${esc(r.message||'取り込みました。')}</p>`
     :(r.blocked
       ?`<p class="mm-xio-done is-bad">${hintHtml(r.blocked)}</p>`
       :(canGo
        ?`<div class="mm-xio-go"><button type="button" id="mmXioApply" class="mm-btn-${rmN?'danger':'primary'} sm">${
            rmN?`この内容で入れ替える（${rmN}件削除）`:'この内容で取り込む'}</button>
          <span>まだ書き込んでいません。押すまでマスタは変わりません。</span></div>`
        :`<p class="mm-xio-done">取り込める行がありません。下の理由を直してから、もう一度選んでください。</p>`))}
   ${(!done&&rmN)?`<details class="mm-xio-skip is-warn" open><summary>消えるロール ${rmN}件（ファイルに出てこない行）</summary><ul>${rmRows}</ul></details>`:''}
   ${skipped.length?`<details class="mm-xio-skip" open><summary>取り込めない行 ${skipped.length}件（この行だけ飛ばします）</summary><ul>${rows}</ul></details>`:''}`;
 }
 function renderMaintForm(){
  const def=currentDef(),form=$('#masterMaintForm');if(!form)return;const editing=maintState.editing;
  // 入力項目が多いマスタは、上部に常設のフォームを置かず(一覧の表示領域を
  // 空けるため)、編集専用モーダルへ入口だけを出す(ARCHITECTURE.md「マスタ管理の画面形態」)。
  /* **読み取り専用のマスタは追加の入口ごと出さない**（§CLAUDE 4。
     押せるのに何も起きないボタンを残さない）。理由は`hint`が書く。 */
  if(def.readOnly&&!def.special){
   form.classList.add('mm-form-compact');
   /* **移行済みの表は丸ごと消せる**（§9.250 ③、利用者の指示「移行済みの
      マスタについては不要なはずなので削除できるようにしてください」）。
      **危ない操作なので主要動線に置かない**（§CLAUDE 5）——器の右端へ寄せ、
      押すと**表の名前と件数を名乗る確認**を1回だけ出す。消せるのは
      サーバーが`RETIRED`と名指ししている表だけ（判定は1箇所・§9.163）。 */
   const drop=def.rawKind==='retired'&&def.rawTable
    ?`<button type="button" id="mmDropTable" class="mm-btn-danger sm"
        title="この表をマスタDBから丸ごと消します（取り消せません）">この表を削除</button>`:'';
   form.innerHTML=`<div class="mm-form-head"><span class="mm-mode-chip">読み取り専用</span>
     <span class="mm-form-hint">この表は見るだけです。追加・編集はできません。</span>${drop}</div>
    ${defHintHtml(def)}`;
   form.onsubmit=ev=>ev.preventDefault();
   const db=$('#mmDropTable');
   if(db)db.onclick=()=>dropRetiredTable(def);
   return;
  }
  if(defUsesEditorModal(def)){
   form.classList.add('mm-form-compact');
   form.innerHTML=`<div class="mm-form-head">
     <span class="mm-mode-chip new">新規登録</span>
     <button type="button" id="masterMaintAdd" class="mm-btn-primary sm">＋ ${esc(def.label)}を追加</button>
     <span class="mm-form-hint">一覧の行をクリック（またはダブルクリック・「編集」ボタン）で編集ウィンドウを開きます。</span>
     ${sampleReportHtml(def)}
     ${linkMasterHtml(def)}
     ${bulkDeleteHtml(def)}
    </div>
    ${defHintHtml(def)}
    ${excelIoHtml(def)}`;
   form.onsubmit=ev=>ev.preventDefault();
   const ab=$('#masterMaintAdd');if(ab)ab.onclick=()=>openMaintEditor(null);
   bindExcelIo(def);bindBulkDelete(def);bindSampleReport(def);bindLinkMaster(def);
   return;
  }
  form.classList.remove('mm-form-compact');
  const controls=buildFieldControls(def,editing);
  const chip=editing?`<span class="mm-mode-chip editing">編集中 <b>${esc(editing[def.cols[0].k]||'')}</b><small>ID:${esc(editing.id)}</small></span>`:`<span class="mm-mode-chip new">新規登録</span>`;
  form.innerHTML=`<div class="mm-form-head">${chip}${editing?'<button type="button" id="masterMaintNew" class="mm-btn-ghost sm">＋ 新規入力に切替</button>':''}${sampleReportHtml(def)}${linkMasterHtml(def)}${bulkDeleteHtml(def)}</div>
   ${defHintHtml(def)}
   <div class="mm-form-fields">${controls}${
    typeof def.extraHtml==='function'?def.extraHtml(editing):''}</div>
   <div class="mm-form-tail"><button type="submit" class="mm-btn-primary">${editing?'更新を保存':'追加登録'}</button><span class="mm-form-hint">${editing?'キー項目（名称・区分など）も変更できます。保存すると同じIDのまま更新（リネーム）されます。同名が既にある場合は更新できません。':'必須(*)を入力して追加登録します。'}</span></div>
   ${excelIoHtml(def)}`;
  form.onsubmit=ev=>{ev.preventDefault();submitMaint()};
  const nb=$('#masterMaintNew');if(nb)nb.onclick=()=>{maintState.editing=null;renderMaintForm()};
  bindEquipmentPickers(form);bindInputHelpers(form);bindMaintTabs(form);bindMoreToggles(form);
  bindExcelIo(def);bindBulkDelete(def);bindSampleReport(def);bindLinkMaster(def);
 }

 /* ---------- 汎用の編集専用モーダル(ARCHITECTURE.md「マスタ管理の画面形態」新設) ----------
    どのマスタでも同じ枠を使う。中身(入力欄)はbuildFieldControls()が
    MASTER_DEFSのfields定義から組み立てるため、マスタを増やしても
    このモーダル自体には手を入れなくてよい。 */
 function ensureMaintEditor(){
  let modal=$('#maintEditorModal');if(modal)return modal;
  modal=document.createElement('div');modal.className='record-modal mm-editor-modal';modal.id='maintEditorModal';modal.hidden=true;
  modal.innerHTML=`<div class="mm-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="maintEditorTitle">
    <header class="mm-editor-head">
     <div><small id="maintEditorEyebrow">MASTER</small><h2 id="maintEditorTitle">編集</h2></div>
     <button type="button" id="maintEditorClose" class="mm-close" aria-label="閉じる">×</button>
    </header>
    <form class="mm-editor-body" id="maintEditorForm"></form>
    <!-- 下段は<footer>ではなく<div>にすること。メイン画面統合型ビューの
         共通ルール(body.mm-mode footer{display:none}等、@layer mode)は要素
         セレクタのfooterを対象にしているため、<footer>で組むとこのモーダルの
         保存・キャンセルボタンごと消える(実装時に踏んだ不具合)。 -->
    <div class="mm-editor-foot">
     <span class="mm-form-hint" id="maintEditorHint"></span>
     <div class="mm-editor-actions">
      <button type="button" id="maintEditorCancel" class="mm-btn-ghost">キャンセル</button>
      <button type="button" id="maintEditorSave" class="mm-btn-primary">保存</button>
     </div>
    </div>
   </div>`;
  document.body.append(modal);
  $('#maintEditorClose').onclick=()=>closeMaintEditor();
  $('#maintEditorCancel').onclick=()=>closeMaintEditor();
  $('#maintEditorSave').onclick=()=>submitMaint('#maintEditorForm');
  WL.modal.keepOpen(modal);
  /* **閉じ方は×／キャンセル／Escの3つ**（§9.221 ①）。背景クリックを
     止めたぶん、Escが無いモーダルは「どれが閉じてどれが閉じないか」を
     覚えることになる——規則が禁じた状態を以前より強い形で作ってしまう。
     変換中のEscは`escCloses()`が除く。 */
  document.addEventListener('keydown',e=>{
   if(WL.modal.escCloses(e)&&!modal.hidden){e.stopPropagation();closeMaintEditor()}
  },true);
  return modal;
 }
 function openMaintEditor(item){
  const def=currentDef();if(!defUsesEditorModal(def))return;
  const modal=ensureMaintEditor();
  /* 組み立ての盤を持つ窓は広く取る（§9.226 ④）。**印を付け外しすること**
     ——付けっぱなしにすると、次に開いた別のマスタの窓まで広いまま
     （`mm-form-page`と同じ作法・§9.222 ⑤）。 */
  const dlg=modal.querySelector('.mm-editor-dialog');
  if(dlg)dlg.classList.toggle('is-builder',def.fields.some(f=>f.type==='field-builder'));
  maintState.editing=item?Object.assign({},item):null;
  const editing=maintState.editing;
  $('#maintEditorEyebrow').textContent=def.label+'マスタ';
  /* 窓の題は**その行を名指しできる欄**から作る（§9.254 ③）。既定は一覧の
     先頭列だが、帳票ブロックのように先頭が「対象設備」のマスタだと
     「* を編集」としか出ず、どの塊を開いたのか分からない（親のマスタから
     直接この窓へ渡れるようにしたぶん、名前が出ないと迷子になる）。 */
  const titleKey=def.titleKey||def.cols[0].k;
  $('#maintEditorTitle').textContent=editing?`${String(editing[titleKey]??'')||'(名称なし)'} を編集`:`${def.label}を新規登録`;
  $('#maintEditorHint').textContent=editing
   ?'キー項目（名称・区分など）も変更できます。保存すると同じIDのまま更新されます。'
   :'必須(*)を入力して登録します。';
  $('#maintEditorSave').textContent=editing?'更新を保存':'追加登録';
  modal.querySelector('.mm-editor-dialog')?.classList.remove('is-wide','is-tall');
  $('#maintEditorSave').onclick=()=>submitMaint('#maintEditorForm');
  const form=$('#maintEditorForm');
  /* **決めることの隣に、刷り上がりを置く**（§9.249 ③）。`asideHtml`を持つ
     マスタだけ2段組みになる（持たないマスタは今までどおり1段）。 */
  /* **窓の説明は一覧の説明と同じにしない**（§CLAUDE 8）。一覧の`hint`は
     「このマスタは何か」を書くので長い。窓では**いま決めることの一言**だけを
     出し、詳しくは各欄の説明が言う（`hintShort`を持たないマスタは今までどおり）。 */
  const modalHint=def.hintShort||def.hint;
  form.innerHTML=`${defHintHtml(def,modalHint)}
   <div class="mm-form-fields">${buildFieldControls(def,editing)}${
    typeof def.extraHtml==='function'?def.extraHtml(editing):''}</div>
   ${typeof def.asideHtml==='function'?def.asideHtml(editing):''}`;
  form.onsubmit=ev=>{ev.preventDefault();submitMaint('#maintEditorForm')};
  bindEquipmentPickers(form);bindInputHelpers(form);bindMaintTabs(form);bindMoreToggles(form);
  if(typeof def.bindAside==='function')def.bindAside(form);
  modal.hidden=false;
  /* **最初のフォーカスに「候補が出る欄」を選ばない**（§9.221 ④）。タグ入力は
     フォーカスした時点で候補の一覧を開くので、窓を開けた瞬間にその一覧が
     **他の欄の上へかぶさる**——欄を横に並べるようにしたぶん、下ではなく
     隣の欄を覆う（実測: 設備停止の「標準所要分」の＋が候補に覆われて
     押せず、`tests/test_stopcat.js`が30秒待って落ちた）。
     打ち込む欄が1つも無いときだけタグ入力へ落とす。
     `type=hidden`は除く——選択肢の組み合わせ欄が値を持つための隠し欄で、
     フォーカスは載らない（載らないまま「当てた」ことにすると、次の欄へ
     進めない）。 */
  requestAnimationFrame(()=>{
   const first=form.querySelector('[data-field]:not([type=hidden])')
             ||form.querySelector('[data-equipment-search]');
   if(first)first.focus();
  });
 }
 function closeMaintEditor(){
  const modal=$('#maintEditorModal');if(!modal||modal.hidden)return;
  modal.hidden=true;maintState.editing=null;
  /* 描き直す先はタブごとに違う。**汎用の一覧を呼ぶと専用タブの中身が
     消える**ので、いまのタブに合わせる。 */
  if(currentDef().special==='data-source'){dsState.editing=null;renderDataSourceList();return}
  if(currentDef().special==='query-join'){qjState.editing=null;renderQueryJoinList();return}
  /* **閉じたら描き直すだけ**（§9.222 ⑥）。以前ここには「op-item なら項目を
     1つ足す／op-choice ならまとまりを作る」という分岐があった。専用画面には
     編集モーダルが無かったので到達しない死んだ分岐だったが、選択肢の値を
     汎用モーダルへ寄せた時点で**閉じるたびに新しいまとまりが増える**ように
     なる。追加は追加のボタンからだけ始める。 */
  if(currentDef().special==='op-item'){renderOpItem();return}
  if(currentDef().special==='record-layout'){renderRecordLayout();return}
  if(currentDef().special==='report-layout'){renderReportLayout();return}
  if(currentDef().special==='op-choice'){renderOpChoice();return}
  renderMaintList();
 }
 /* 入力支援の配線(§9.49)。buildFieldControls()が出した各型を動かす。
    どの型も「data-field を持つ要素の value が最終的な値」という約束を守るので、
    submitMaint()側は型を知らなくてよい。 */
 /* 見て選ぶ欄の配線（§9.249 ③）。**値は隠し欄が持つ**ので、
    押したら`change`を飛ばす——`data-when`の出し入れも紙の見本も、
    値が変わったことを`change`で知る（§9.218 ②と同じ作法）。 */
 function mmSetHidden(form,key,value){
  const el=form.querySelector(`[data-field="${CSS.escape(key)}"]`);
  if(!el)return;
  el.value=String(value);
  el.dispatchEvent(new Event('change',{bubbles:true}));
 }
 function bindChoiceCards(form){
  form.querySelectorAll('[data-card]').forEach(b=>{
   if(b.dataset.cardWired)return;
   b.dataset.cardWired='1';
   b.onclick=()=>{
    const k=b.dataset.card,v=b.dataset.cardV;
    form.querySelectorAll(`[data-card="${CSS.escape(k)}"]`).forEach(x=>{
     const on=x===b;x.classList.toggle('is-on',on);x.setAttribute('aria-pressed',on?'true':'false');
    });
    mmSetHidden(form,k,v);
   };
  });
 }
 /* 入切の札（§9.302）。**いま何が起きるかを文字で書く**（§4）——0個に
    したら「どの機能でも使いません」と言い切る（黙って一覧から消えると、
    設定したことと画面で起きたことが結び付かない）。 */
 function bindCheckSets(form){
  form.querySelectorAll('[data-checkset-box]').forEach(box=>{
   const k=box.dataset.checksetBox;
   const paint=()=>{
    const btns=[...box.querySelectorAll('[data-checkset]')];
    const off=btns.filter(b=>b.getAttribute('aria-pressed')!=='true');
    mmSetHidden(form,k,off.map(b=>b.dataset.checksetV).join(','));
    const note=box.querySelector(`[data-checkset-note="${CSS.escape(k)}"]`);
    if(note){
     const on=btns.length-off.length;
     /* **呼び名は札から読む**（§9.163）——文言へ書き写すと、機能を1つ
        足したり呼び名を変えたときに、ここだけ古いことを言い続ける。 */
     const names=a=>a.map(b=>b.querySelector('b')?.textContent||'').filter(Boolean).join('・');
     note.textContent=!btns.length?''
      :on===btns.length?'すべての機能で使えます（既定）。'
      :on===0?`どの機能でも使いません。設備マスタには残りますが、${names(btns)}のどこにも出ません。`
      :`${names(off)}では使いません。`;
     note.classList.toggle('is-warn',on===0);
    }
   };
   box.querySelectorAll('[data-checkset]').forEach(b=>{
    if(b.dataset.checksetWired)return;
    b.dataset.checksetWired='1';
    b.onclick=()=>{
     const on=b.getAttribute('aria-pressed')!=='true';
     b.setAttribute('aria-pressed',on?'true':'false');
     b.classList.toggle('is-on',on);
     const ico=b.querySelector('.mm-card-ico');if(ico)ico.textContent=on?'✓':'—';
     paint();
    };
   });
   paint();
  });
 }
 function bindSpanGrids(form){
  form.querySelectorAll('.mm-spanfield').forEach(box=>{
   if(box.dataset.spanWired)return;
   box.dataset.spanWired='1';
   const cells=[...box.querySelectorAll('[data-span]')];
   if(!cells.length)return;
   const key=cells[0].dataset.span;
   const paint=v=>{
    const n=Number(v)||0;
    cells.forEach((c,i)=>c.classList.toggle('is-on',i+1<=n));
    const read=box.querySelector(`[data-span-read="${CSS.escape(key)}"]`);
    if(read)read.textContent=String(n);
    const frac=box.querySelector(`[data-span-frac="${CSS.escape(key)}"]`);
    if(frac)frac.textContent=mmFracText(n,cells.length);
   };
   cells.forEach(c=>c.onclick=()=>{paint(c.dataset.spanV);mmSetHidden(form,key,c.dataset.spanV)});
   const hidden=form.querySelector(`[data-field="${CSS.escape(key)}"]`);
   if(hidden)hidden.addEventListener('change',()=>paint(hidden.value));
  });
 }
 function bindRowsPicks(form){
  form.querySelectorAll('.mm-rowsfield').forEach(box=>{
   const opts=[...box.querySelectorAll('[data-rows]')];
   if(!opts.length)return;
   const key=opts[0].dataset.rows;
   /* 押した印を値から塗り直す。**隠し欄の`change`でも塗ること**——
      紙の見本を掴んで高さを変えたときに札が追随しないと、押した札と
      実際の値が食い違う（`bindSpanGrids`は最初からそうしている）。 */
   const paint=v=>{
    /* **`0`は「中身なり」**（§9.250 ④）。保存済みの塊が`0`を持っているので、
       素で比べると**どの札も押されていない**状態になる。 */
    const cur=(String(v||'')==='0')?'':String(v||'');
    opts.forEach(x=>{
     const on=String(x.dataset.rowsV||'')===cur;
     x.classList.toggle('is-on',on);x.setAttribute('aria-pressed',on?'true':'false');
    });
   };
   opts.forEach(b=>{
    if(b.dataset.rowsWired)return;
    b.dataset.rowsWired='1';
    b.onclick=()=>{paint(b.dataset.rowsV);mmSetHidden(form,key,b.dataset.rowsV)};
   });
   const hidden=form.querySelector(`[data-field="${CSS.escape(key)}"]`);
   if(hidden&&!hidden.dataset.rowsSync){
    hidden.dataset.rowsSync='1';
    hidden.addEventListener('change',()=>paint(hidden.value));
   }
  });
 }
 function bindInputHelpers(form){
  bindChoiceCards(form);bindCheckSets(form);bindSpanGrids(form);bindRowsPicks(form);
  bindNumberFields(form);
  bindDateFields(form);
  bindComboFields(form);
  bindPathFields(form);
  bindFieldBuilders(form);
  bindWhenFields(form);
 }
 /* ---------- 選んで組み立てる（§9.226 ④、利用者の指示） ----------
    保存の形は`ラベル=出どころ`の並びのままで、**書く手段だけ**を変える。
    候補（`catalog`）はサーバーが答えたものをそのまま並べる——操業データの
    項目もここに入るので、現場が項目を足せば候補に増える。

    **右（載せる項目）が正**。押す・掴む・ラベルを直す、どの操作のあとも
    `syncFieldBuilder()`が隠し欄（`data-field`）へ書き戻す——書き戻しを
    1箇所にしておかないと、「並べ替えただけでは保存されない」のような
    片方だけ効く状態が作れる（§9.201と同じ形）。 */
 const fbCatalog={groups:[],loadedFor:null,loading:null};

 /* ================================================================
    帳票ブロックの「刷り上がりの見本」（§9.249 ③、利用者の指示）
    ----------------------------------------------------------------
    「もっとわかりやすく視覚化した形で表示を工夫し設定しやすいものを」

    幅「6マス」が紙の何割かは、**紙を見なければ分からない**。決めることの
    すぐ隣に紙の見本を置き、押した幅・高さ・列数・載せた項目がその場で
    形になるようにする。

    **見本は形だけ**——値は実際のロットで入る。そう書いておかないと、
    「見本に値が出ていない＝壊れている」と読まれる（§CLAUDE 6）。
    **紙の割り付けは`report-dashboard.js`が持つ**ので、ここでは寸法を
    決め打ちにせず、12マスという約束だけを借りる（幅の数字は同じ`span`）。
    ================================================================ */
 const RB_PAGE_ROWS=12;   // 紙の縦のマス数（report-dashboard.js の既定と同じ）
 function rbAsideHtml(){
  return `<aside class="rb-aside" aria-label="刷り上がりの見本">
    <div class="rb-aside-head">
     <b>刷り上がりの見本</b>
     <span class="rb-aside-tools">
      <button type="button" class="rb-tgl is-on" id="rbToggleOthers" aria-pressed="false"
        title="この設備のほかの塊も薄く重ねて、紙全体でどう見えるかを出します">紙全体で見る</button>
      <button type="button" class="rb-tgl is-on" id="rbToggleDummy" aria-pressed="true"
        title="値の場所にありそうなダミーを入れます。桁と文字数が実物に近いので、幅が足りるかを確かめられます">見本の値</button>
     </span>
    </div>
    <!-- **中身の見本**（§9.278、利用者の指示「帳票ブロックでの中身の作り込みが
         重要なのでダミーデータで中身の表示プレビューができるように」）。
         紙の中の場所（下の枠）は**大きさの既定**を決めるためのもので、実際の
         大きさは設備ごとの紙で決める。ここで確かめたいのは**中身の形**。 -->
    <div class="rb-preview" id="rbPreview" aria-label="中身の見本（見本のロット1件で描いています）">
     <div class="rb-preview-head">
      <b>中身の見本</b>
      <small id="rbPreviewNote">見本のロット1件で描いています（保存されません）</small>
     </div>
     <div class="rb-sec" id="rbSection"></div>
    </div>
    <div class="rb-paper" id="rbPaper" role="img" aria-label="紙の中のこの塊の位置と大きさ">
     <div class="rb-paper-grid" id="rbPaperGrid"></div>
     <div class="rb-paper-others" id="rbPaperOthers" hidden></div>
     <div class="rb-paper-block" id="rbPaperBlock"><b id="rbPaperName">この塊</b></div>
    </div>
    <p class="rb-spill" id="rbSpill" hidden></p>
    <!-- **どの紙に効くのかを画面に出す**（§9.274／§CLAUDE 6）。ここで決めるのは
         「既定」で、設備ごとの紙が上書きしている——それが読めないと、幅を変えても
         紙が変わらない理由が分からない（利用者の報告の半分がこれ）。 -->
    <p class="rb-where" id="rbWhere"></p>
    <p class="rb-aside-note" id="rbNote">${hintHtml('ここで決めるのは**大きさの既定**です。実際の大きさと置き場所は**設備ごとの紙**（帳票画面の「配置を組み換え」）で決めます。')}</p>
    <dl class="rb-facts">
     <dt>幅</dt><dd id="rbFactSpan">—</dd>
     <dt>高さ</dt><dd id="rbFactRows">—</dd>
     <dt>内訳</dt><dd id="rbFactCols">—</dd>
     <dt>繰り返し</dt><dd id="rbFactRepeat">—</dd>
    </dl>
   </aside>`;
 }
 /* ---------- ダミーの値（§9.250 ⑤、利用者の指示） ----------
    「データダミーをつかって、帳票の表示が最終的にどうなるか…すぐに確認
     できる導線を準備してください」

    **見本の値はサーバーが答える**（`field_catalog()`の`sample`）——道を
    1本足したときに見本も一緒に足すことになる（§9.163）。画面が道の綴りから
    推測すると、道が増えるたびに2箇所直すことになる。
    **知らない道でも空にしない**（空だと「見本が壊れている」と読まれる）。 */
 const rbSample=new Map();
 function rbNoteSamples(groups){
  (groups||[]).forEach(g=>(g.items||[]).forEach(it=>{
   if(it&&it.path)rbSample.set(String(it.path),String(it.sample==null?'':it.sample));
  }));
 }
 function rbSampleOf(path){
  const v=rbSample.get(String(path||''));
  return (v===undefined||v==='')?'（値）':v;
 }
 /* 行数の生の値。**空と`0`はどちらも「中身なり」**（§9.250 ④）。
    判定を1箇所に置く——散らすと、見本と札と一言で別々の答えが出る。 */
 function rbRowsRaw(form){
  const el=form&&form.querySelector('[data-field="rows"]');
  const v=String(el?(el.value||''):'').trim();
  return (v===''||v==='0')?'':v;
 }
 /* 見本を描き直す。**読むのは隠し欄の値だけ**——押した札の見た目ではなく
    保存される値を映す（見た目だけを写すと、保存と食い違う見本ができる）。 */
 function rbPaintPreview(form){
  const v=k=>{const el=form.querySelector(`[data-field="${CSS.escape(k)}"]`);return el?String(el.value||''):''};
  const grid=form.querySelector('#rbPaperGrid'),block=form.querySelector('#rbPaperBlock');
  if(!grid||!block)return;
  const span=Math.max(1,Math.min(12,Number(v('span'))||12));
  /* **`0`も「中身なり」**（§9.250 ④）。保存済みの塊は行数を`0`で持っている
     ものがあり、`rowsRaw?…`だけで見ると**文字の`'0'`は真**なので
     `Math.max(1,0)`＝1行として描いていた（「中身なり」の塊が紙の見本では
     1行に潰れていた）。空と0は同じ意味なので1箇所で揃える。 */
  const rowsRaw=rbRowsRaw(form);
  const rows=rowsRaw?Math.max(1,Math.min(RB_PAGE_ROWS,Number(rowsRaw))):3;
  const area=v('kindText')==='エリア（枠と文字）';
  if(!grid.childElementCount){
   grid.innerHTML=Array.from({length:12*RB_PAGE_ROWS},()=>'<i></i>').join('');
  }
  block.style.setProperty('--rb-span',String(span));
  block.style.setProperty('--rb-rows',String(rows));
  block.classList.toggle('is-auto',!rowsRaw);
  block.classList.toggle('is-area',area);
  const nm=form.querySelector('#rbPaperName');
  if(nm)nm.textContent=v('name')||'（名前を入れてください）';
  const setText=(id,text)=>{const el=form.querySelector(id);if(el)el.textContent=text};
  setText('#rbFactSpan',`${span} / 12 マス（${mmFracText(span,12)}）`);
  setText('#rbFactRows',rowsRaw?`${rowsRaw}行（固定）`:'中身なり（描いてから測ります）');
  /* **空欄でも「いま何列で出るか」を言う**（§CLAUDE 6）。`reportSection`の
     既定は2列なので、「中身の数から決まります」だけだと何列になるか読めない。 */
  const colsRaw=v('cols');
  /* 頭打ちは**欄の選択肢と同じ12**（§9.289）——ここが4のままだったのは、
     CSSに`.rp-grid-1`と`.rp-grid-4`しか無かった頃の名残り。 */
  const colsEff=Math.max(1,Math.min(12,Number(colsRaw)||2));
  setText('#rbFactCols',area?'—（エリアは値を出しません）'
    :(colsRaw?`${colsRaw}列`:`未指定（いまは${colsEff}列）`));
  setText('#rbFactRepeat',area?'—':(v('repeatText')==='分割後の子ロットごと'?'子ロットの数だけ':'1回だけ'));
  /* 節そのもの（§9.278、利用者の指示「帳票ブロックでの中身の作り込みが重要
     なのでダミーデータで中身の表示プレビューができるように」）。
     **紙を組むのは`report-dashboard.js`の1本**（§9.163）——ここに2つ目の
     組み立てを持つと、盤で確かめた形と刷り上がりが食い違う。実際そうなって
     いて、この見本は**子ロットの繰り返しも「全体」の行も統計の値も出せず**、
     大きさを見る以外の役に立っていなかった（利用者の報告）。
     材料は**見本のロット1件**（`sample_record`。§9.253と同じもの）。 */
  const sec=form.querySelector('#rbSection');
  if(!sec)return;
  const nameNow=v('name')||'（名前）';
  if(area){
   sec.className='rb-sec is-area';
   sec.innerHTML=(window.WL&&WL.reportStat&&WL.reportStat.areaHtml)
     ? WL.reportStat.areaHtml(v('text')||nameNow)
     : `<div class="rb-sec-head">${esc(nameNow)}</div>`;
   return;
  }
  const rowsData=fbParse(v('content'));
  sec.className='rb-sec';
  if(!rowsData.length){
   sec.innerHTML='<p class="rb-sec-empty">載せる項目がありません。'
    +'<b>画面がもともと持っている中身</b>のまま刷られます。</p>';
   return;
  }
  if(!(window.WL&&WL.reportStat&&WL.reportStat.sectionHtml)){
   /* **無ければ黙らない**（§CLAUDE「公開漏れは黙って素通しになる」）。 */
   console.error('WL.reportStat.sectionHtml が無いので中身の見本を描けません');
   sec.innerHTML='<p class="rb-sec-empty">中身の見本を描けませんでした。</p>';
   return;
  }
  /* **見本のロットは設備ごと**（§9.174。配置も統計もその設備のもの）。
     取りに行っているあいだは前の絵を残す——空にすると、欄を1文字直すたびに
     見本が消えて点滅する。 */
  const rec=rbSampleRecord(form,()=>rbPaintPreview(form));
  const blank={basic:{},settings:{},measurements:{},product:{rows:[]}};
  const src=rbState.dummy?(rec||blank):blank;
  const repeat=(v('repeatText')==='分割後の子ロットごと')?'子ロット':'';
  const dir=(v('repeatDirText')==='横に並べる')?'横':'';
  try{
   /* **紙と同じ幅で描いてから縮める**（§9.278）——器なりに描くと、器が
      紙の塊より狭いぶんだけ列が痩せ、**紙では折り返さないロット番号が
      見本だけ2行になる**（再現度がこの見本の値打ちなので、そこがずれると
      見る意味が無い）。幅は紙の実寸から出す（A4 210mm − 余白8mm×2 を
      96dpi換算＝`RB_PAPER_W`）ので、幅の札を押すとその場で変わる。 */
   sec.innerHTML='<div class="rb-sec-fit">'
    +WL.reportStat.sectionHtml(src,nameNow,rowsData,Number(v('cols'))||0,repeat,dir)
    +'</div>';
   rbFitPreview(sec,span);
  }catch(e){
   console.error('中身の見本を描けませんでした',e);
   sec.innerHTML='<p class="rb-sec-empty">中身の見本を描けませんでした。</p>';
  }
  const note=form.querySelector('#rbPreviewNote');
  if(note)note.textContent=rbState.dummy
    ?(rec?'見本のロット1件で描いています（保存されません）':'見本のロットを取り込んでいます…')
    :'値を入れずに枠だけ出しています（「見本の値」で入ります）';
 }
 /* 紙の塊の実寸（§9.278）。A4の210mmから四辺8mmの余白を引いた194mmを
    96dpi換算した値——紙を組む側（`.rp-page`）と同じ約束なので、ここで
    別の数を持たない。 */
 const RB_PAPER_W=Math.round(194/25.4*96);
 function rbFitPreview(sec,span){
  const fit=sec.querySelector('.rb-sec-fit');
  if(!fit)return;
  const w=Math.max(120,Math.round(RB_PAPER_W*Math.max(1,Math.min(12,span))/12));
  fit.style.setProperty('--rb-prev-w',w+'px');
  /* **測るのは描いたあと**（§9.221 ⑥）——`clientWidth`は組み直す前の幅を返す。
     入るときは少し大きく見せる（紙の文字は9px前後で、そのままでは読めない）。 */
  requestAnimationFrame(()=>{
   const host=sec.clientWidth-8;
   if(!host||!w)return;
   const k=Math.max(.5,Math.min(1.6,host/w));
   fit.style.setProperty('--rb-prev-scale',String(k));
   /* 縮めたぶん器の高さも詰める（`transform`は場所を取り続ける）。 */
   const inner=fit.firstElementChild;
   fit.style.height=inner?Math.ceil(inner.getBoundingClientRect().height)+'px':'';
  });
 }
 /* 見本のロット（§9.253）。**設備ごとに1回だけ取り、写しを持つ**——
    欄を1文字直すたびに往復すると、打っている最中に見本が止まる。
    **取れたら描き直す**（`again`）。**保存はしない**（画面のメモリだけ）。 */
 const rbSampleRec=new Map();
 function rbSampleRecord(form,again){
  const eq=rbPaperEq(form);
  if(rbSampleRec.has(eq))return rbSampleRec.get(eq);
  rbSampleRec.set(eq,null);
  api('/api/report-block-master/sample-record?equipment='+encodeURIComponent(eq))
   .then(r=>{rbSampleRec.set(eq,(r&&r.record)||null);if(again)again()})
   .catch(()=>{rbSampleRec.set(eq,null)});
  return null;

 }
 /* ---------- 紙全体で見る（§9.250 ⑤、利用者の指示） ----------
    「データダミーをつかって、帳票の表示が最終的にどうなるか…すぐに確認
     できる導線を準備してください」

    この塊だけを見ても、**紙のどこが空いているか・何ページ目に来るか**は
    分からない。同じ設備の塊を**表示順に流し込んで**紙を組み、
    **いま編集している塊はその流れの中で強調する**——除いて重ねると、
    自分の塊が実際に来る場所とは違う絵になる（見本の値打ちが消える）。

    **掴めることは変えない**（§4）——`#rbPaperBlock`（8方向のつまみを持つ）
    を、流れの中の自分の席へ**測って重ねる**。席の位置はブラウザの自動配置が
    決めるので、こちらで組み直さない（同じ並べ方を2つ持たない）。

    **紙からはみ出したものは「次の紙へ」と数える**（§CLAUDE 4・6）
    ——`.rb-paper`は`overflow:hidden`なので、黙って切ると「無い」と読まれる。 */
 /* いま編集している塊が「どの紙」に置かれるか。**対象設備の先頭**——
    紙は設備1つぶん（`report:<設備>`・§9.174）なので、複数設備を対象にした
    塊は代表の1枚で見せ、そのことを画面に書く。 */
 function rbPaperEq(form){
  const el=form.querySelector('[data-equipment-all="equipment"]');
  if(el&&el.checked)return '';                 /* すべての設備＝共通の紙で見る */
  const on=[...form.querySelectorAll('[data-equipment-field="equipment"]:checked')];
  return on.length?String(on[0].value||''):'';
 }
 /* 本物の紙を読む（§9.274）。**「紙全体で見る」は本物の紙で組む**
    ——以前はマスタの行だけを表示順に流していたので、**出していない塊まで
    並び、設備ごとに変えた幅も効かず**、刷り上がりとは別物だった
    （利用者の報告「紙レイアウトのところで見えているデータは変わりません」）。
    読めなければ今までどおりマスタの行で組む（fail-open）。 */
 async function rbLoadPaper(form){
  if(!(window.WL&&WL.reportLayout&&WL.reportLayout.info))return null;
  const eq=rbPaperEq(form);
  if(rbState.paperFor===eq&&rbState.paper)return rbState.paper;
  try{
   const info=await WL.reportLayout.info(eq);
   rbState.paper=info;rbState.paperFor=eq;
   return info;
  }catch(e){rbState.paper=null;rbState.paperFor=null;return null}
 }
 /* 塊が「いまその紙に置かれているか」を文字で出す（§CLAUDE 3・§2）。
    **置かれていなければ、置く場所まで言う**——ここで幅を決めても紙に出ない、
    という食い違いがいちばん分かりにくい。 */
 function rbPaintWhere(form){
  const el=form.querySelector('#rbWhere');if(!el)return;
  const v=k=>{const x=form.querySelector(`[data-field="${CSS.escape(k)}"]`);return x?String(x.value||''):''};
  const me=String(v('name')||(maintState.editing&&maintState.editing.name)||'').trim();
  const info=rbState.paper;
  const eqName=rbState.paperFor?`「${rbState.paperFor}」`:'共通（設備の分からないロット）';
  if(!info){
   el.innerHTML=`<b>紙での見え方</b>この塊の<b>幅と高さはここが既定</b>で、`
    +`<b>実際の大きさは設備ごとの紙</b>が持ちます`
    +`（帳票レイアウトマスタ、または帳票画面の「配置を組み換え」で決めます）。`;
   return;
  }
  const hit=(info.blocks||[]).find(x=>x.key===me);
  if(!hit){
   el.innerHTML=`<b>紙での見え方</b>${esc(eqName)}の紙には<b>まだ置かれていません</b>。`
    +`保存したあと、<b>帳票レイアウト</b>（またはこの塊のある帳票の「配置を組み換え」）で`
    +`「出す」にすると紙に出ます。`;
   return;
  }
  el.innerHTML=`<b>紙での見え方</b>${esc(eqName)}の紙に`
   +(hit.shown?`<b>出しています</b>`:`<b>置いてありますが出していません</b>`)
   +`（幅 ${hit.span}/${info.grid} マス・高さ ${hit.rows?hit.rows+'段':'中身なり'}）。`
   +(hit.span!==hit.defSpan||hit.rows!==hit.defRows
     ?`<i>この紙では既定（幅 ${hit.defSpan}・高さ ${hit.defRows||'中身なり'}）と違う値が効いています。</i>`
     :`<i>いまは下の既定がそのまま効いています。</i>`);
 }
 /* ---------- 紙全体で見る（§9.250 ⑤、利用者の指示） ----------
    「データダミーをつかって、帳票の表示が最終的にどうなるか…すぐに確認
     できる導線を準備してください」

    この塊だけを見ても、**紙のどこが空いているか・何ページ目に来るか**は
    分からない。同じ設備の塊を**表示順に流し込んで**紙を組み、
    **いま編集している塊はその流れの中で強調する**——除いて重ねると、
    自分の塊が実際に来る場所とは違う絵になる（見本の値打ちが消える）。

    **掴めることは変えない**（§4）——`#rbPaperBlock`（8方向のつまみを持つ）
    を、流れの中の自分の席へ**測って重ねる**。席の位置はブラウザの自動配置が
    決めるので、こちらで組み直さない（同じ並べ方を2つ持たない）。

    **紙からはみ出したものは「次の紙へ」と数える**（§CLAUDE 4・6）
    ——`.rb-paper`は`overflow:hidden`なので、黙って切ると「無い」と読まれる。 */
 function rbPaintOthers(form){
  const layer=form.querySelector('#rbPaperOthers');
  const block=form.querySelector('#rbPaperBlock');
  const note=form.querySelector('#rbSpill');
  if(!layer||!block)return;
  if(!rbState.others){
   layer.hidden=true;layer.innerHTML='';
   block.classList.remove('is-placed');
   block.style.left=block.style.top=block.style.width=block.style.height='';
   if(note){note.hidden=true;note.textContent=''}
   return;
  }
  const v=k=>{const el=form.querySelector(`[data-field="${CSS.escape(k)}"]`);return el?String(el.value||''):''};
  const me=String(v('name')||maintState.editing&&maintState.editing.name||'');
  const eq=v('equipment');
  const eqFirst=eq.split(/[,、]/)[0].trim();
  const meSpan=Math.max(1,Math.min(12,Number(v('span'))||12));
  const meRows=(()=>{const r=rbRowsRaw(form);return r?Math.max(1,Math.min(RB_PAGE_ROWS,Number(r))):3})();
  let list=null;
  const info=rbState.paper;
  /* **本物の紙で組むのは、この塊がその紙に置かれているときだけ**（§9.274）。
     まだ置かれていない塊（＝新規作成中や、紙へ出していない塊）は**紙の上に
     席が無い**ので、本物の流れへ混ぜると必ず末尾＝次の紙へ回る位置になり、
     8方向のつまみが紙の外へ出て掴めなくなる（§9.250 ④の機能がそこだけ
     失われる）。置かれていないことは`#rbWhere`が文字で言う（§CLAUDE 4）ので、
     見本は今までどおり表示順の流れで「だいたいこの大きさ」を見せる。 */
  const onPaper=!!(info&&Array.isArray(info.blocks)
    &&info.blocks.some(x=>x.key===me&&x.shown));
  if(onPaper){
   /* **本物の紙**（`report:<設備>`）。出している塊だけを、効いている幅と
      高さで並べる。マス数は紙の割り（12/24/…）なので、見本の12マスへ
      **比で直す**（見本は12マス固定・§9.249 ③）。 */
   const toSpan=n=>Math.max(1,Math.min(12,Math.round(Number(n||1)*12/(info.grid||12))));
   const toRows=n=>Math.max(1,Math.min(RB_PAGE_ROWS,
     Math.round(Number(n||0)*RB_PAGE_ROWS/(info.pageRows||RB_PAGE_ROWS))))||2;
   /* **編集している塊は流れの中の自分の席に置く**——末尾へ足すと、紙が
      埋まっている設備では必ず最後（＝次の紙へ回る側）に見えて、
      「自分の塊が実際に来る場所」という見本の値打ちが消える。
      幅と高さだけは**いま欄に入っている値**で描く（触った結果が出る）。 */
   let placed=false;
   list=info.blocks.filter(x=>x.shown).map(x=>{
    if(x.key===me){placed=true;return {name:me,span:meSpan,rows:meRows,me:true}}
    return {name:String(x.label||x.key||''),span:toSpan(x.span),
            rows:x.rows?toRows(x.rows):2,me:false};
   });
   /* `onPaper`で絞ってあるので必ず席がある。念のため（設定が入れ替わる
      隙で消えていたら）末尾へ置く。 */
   if(!placed)list.push({name:me||'この塊',span:meSpan,rows:meRows,me:true});
  }else{
   /* 読めなかったとき、またはまだ紙に置いていない塊（fail-open）。
      マスタの行を表示順に流す。 */
   const fits=x=>{
    if(String(x.enabledText||'')==='無効')return false;
    const t=String(x.equipment||'').trim();
    if(!eq||eq==='*'||t==='*'||!t)return true;
    return t.split(/[,、]/).map(y=>y.trim()).includes(eqFirst);
   };
   list=(rbState.blocks||[]).filter(x=>String(x.name||'')!==me).filter(fits)
     .map(x=>({name:String(x.name||''),order:Number(x.order)||0,
       span:Math.max(1,Math.min(12,Number(x.span)||12)),
       rows:Math.max(1,Math.min(RB_PAGE_ROWS,Number(x.rows)||2)),me:false}));
   list.push({name:me||'この塊',order:Number(v('order'))||0,span:meSpan,rows:meRows,me:true});
   list.sort((a,b)=>(a.order-b.order)||a.name.localeCompare(b.name,'ja'));
  }
  layer.hidden=false;
  layer.innerHTML=list.map(x=>
   `<i style="--rb-span:${x.span};--rb-rows:${x.rows}"${x.me?' data-me="1" class="is-me"':''}`
   +` title="${esc(x.name)}"><b>${esc(x.name)}</b></i>`).join('');
  /* 席へ重ねるのは**描いたあと**（自動配置の結果を測る）。 */
  requestAnimationFrame(()=>{
   const slot=layer.querySelector('[data-me]');
   const paper=form.querySelector('#rbPaper');
   if(!slot||!paper)return;
   const pr=paper.getBoundingClientRect(),sr=slot.getBoundingClientRect();
   if(!(sr.height>0))return;
   block.classList.add('is-placed');
   block.style.left=Math.round(sr.left-pr.left)+'px';
   block.style.top=Math.round(sr.top-pr.top)+'px';
   block.style.width=Math.round(sr.width)+'px';
   block.style.height=Math.round(sr.height)+'px';
   /* 紙に載りきらなかった塊を数える。**「無い」ではなく「次の紙へ」**。 */
   if(note){
    const lr=layer.getBoundingClientRect();
    const over=[...layer.children].filter(el=>el.getBoundingClientRect().bottom>lr.bottom+1);
    note.hidden=!over.length;
    note.textContent=over.length?`この紙に載りきらないもの ${over.length}件（次の紙へ回ります）`:'';
   }
  });
 }
 /* ---------- 紙の見本を掴んで大きさを変える（§9.250 ④、利用者の指示） ----------
    「幅と高さの指定をさせる部分だが、刷り上がりの見本という視覚表示があるので
     これを**四方のどこからでもドラッグアンドドロップで大きさの変更**が
     できるようにするだけで大きさの指定を直感的に行うことができるように
     なります」

    つまみは**8方向**（四辺＋四隅）。**JSが差し込む**——HTMLへ8個書かせると、
    書き漏らした窓だけ端を掴めなくなる（`WL.makeFloatingWindow`と同じ作法）。
    **マスに吸い付かせる**（1マス＝紙の1/12）——中途半端な幅は保存できない
    ので、掴んでいる最中だけ滑らかに動いても意味が無い。
    **値は隠し欄へ書く**（`mmSetHidden`）ので、札の押した印も紙の見本も
    ③の欄も同じ`change`で追随する（見た目だけ変えると保存と食い違う）。 */
 const RB_GRIPS=['n','e','s','w','ne','nw','se','sw'];
 function rbBindPaperDrag(form){
  const block=form.querySelector('#rbPaperBlock'),grid=form.querySelector('#rbPaperGrid');
  if(!block||!grid||block.dataset.rbDrag)return;
  block.dataset.rbDrag='1';
  block.insertAdjacentHTML('beforeend',RB_GRIPS.map(h=>
   `<i class="rb-grip rb-grip-${h}" data-rb-grip="${h}" role="slider" tabindex="0"`
   +` aria-label="大きさを変える（${h.length>1?'角':'辺'}）"></i>`).join(''));
  block.querySelectorAll('[data-rb-grip]').forEach(g=>{
   g.onpointerdown=ev=>{
    ev.preventDefault();ev.stopPropagation();
    const dir=g.dataset.rbGrip;
    const gr=grid.getBoundingClientRect();
    const cw=gr.width/12,ch=gr.height/RB_PAGE_ROWS;
    if(!(cw>0&&ch>0))return;
    const spanEl=form.querySelector('[data-field="span"]');
    const span0=Math.max(1,Math.min(12,Number(spanEl&&spanEl.value)||12));
    const rowsRaw0=rbRowsRaw(form);
    const rows0=rowsRaw0?Math.max(1,Math.min(RB_PAGE_ROWS,Number(rowsRaw0))):3;
    /* **選べる幅・高さへ吸い付かせる**（§9.250 ④）。紙の幅は5段
       （1/4・1/3・1/2・2/3・全幅）しか無く、サーバーの`normalize_span()`が
       いちばん近い段へ丸める——掴んで5マスにできてしまうと、**見本は5マス
       なのに保存は4マス**になり、見本が嘘をつく（§CLAUDE 6）。
       **選べる値は札から読む**（`data-span-v`／`data-rows-v`）ので、
       マスタ側で段を増減しても付いてくる（一覧を書き写さない）。 */
    const allowOf=(sel,attr)=>{
     const vs=[...form.querySelectorAll(sel)].map(x=>Number(x.dataset[attr]))
       .filter(n=>Number.isFinite(n)&&n>0);
     return [...new Set(vs)].sort((a,b)=>a-b);
    };
    const spanAllow=allowOf('.mm-span-grid [data-span-v]','spanV');
    const rowsAllow=allowOf('.mm-rows-pick [data-rows-v]','rowsV');
    const snap=(n,list)=>{
     if(!list.length)return n;
     return list.reduce((best,x)=>Math.abs(x-n)<Math.abs(best-n)?x:best,list[0]);
    };
    const x0=ev.clientX,y0=ev.clientY;
    let lastSpan=span0,lastRows=rows0;
    g.setPointerCapture&&g.setPointerCapture(ev.pointerId);
    block.classList.add('is-grabbing');
    const move=m=>{
     if(dir.indexOf('e')>=0||dir.indexOf('w')>=0){
      const d=Math.round((m.clientX-x0)/cw)*(dir.indexOf('w')>=0?-1:1);
      const v=snap(Math.max(1,Math.min(12,span0+d)),spanAllow);
      if(v!==lastSpan){lastSpan=v;mmSetHidden(form,'span',String(v))}
     }
     if(dir.indexOf('s')>=0||dir.indexOf('n')>=0){
      const d=Math.round((m.clientY-y0)/ch)*(dir.indexOf('n')>=0?-1:1);
      const v=snap(Math.max(1,Math.min(RB_PAGE_ROWS,rows0+d)),rowsAllow);
      if(v!==lastRows){lastRows=v;mmSetHidden(form,'rows',String(v))}
     }
    };
    const up=()=>{
     block.classList.remove('is-grabbing');
     document.removeEventListener('pointermove',move,true);
     document.removeEventListener('pointerup',up,true);
    };
    document.addEventListener('pointermove',move,true);
    document.addEventListener('pointerup',up,true);
   };
   /* **キーボードでも変えられること**（掴めるのに辿れない部品を作らない）。 */
   /* **キーボードでも変えられること**（掴めるのに辿れない部品を作らない）。
      1回で**選べる段を1つ**進む——ドラッグと同じ値しか作らない。 */
   g.onkeydown=e=>{
    const dir=g.dataset.rbGrip;
    const wide=dir.indexOf('e')>=0||dir.indexOf('w')>=0;
    const tall=dir.indexOf('s')>=0||dir.indexOf('n')>=0;
    let d=0;
    if(e.key==='ArrowRight'||e.key==='ArrowUp')d=1;
    else if(e.key==='ArrowLeft'||e.key==='ArrowDown')d=-1;
    else return;
    e.preventDefault();
    const stepIn=(sel,attr,cur)=>{
     const vs=[...new Set([...form.querySelectorAll(sel)].map(x=>Number(x.dataset[attr]))
       .filter(n=>Number.isFinite(n)&&n>0))].sort((a,b)=>a-b);
     if(!vs.length)return cur+d;
     let i=vs.indexOf(cur);
     if(i<0)i=vs.reduce((bi,x,k)=>Math.abs(x-cur)<Math.abs(vs[bi]-cur)?k:bi,0);
     return vs[Math.max(0,Math.min(vs.length-1,i+d))];
    };
    if(wide){
     const el=form.querySelector('[data-field="span"]');
     mmSetHidden(form,'span',String(stepIn('.mm-span-grid [data-span-v]','spanV',
       Math.max(1,Math.min(12,Number(el&&el.value)||12)))));
    }
    if(tall){
     const raw=rbRowsRaw(form);
     mmSetHidden(form,'rows',String(stepIn('.mm-rows-pick [data-rows-v]','rowsV',raw?Number(raw):3)));
    }
   };
  });
 }
 /* 配線。**打っている最中も追う**（`input`）——名前を打つたびに紙の見本の
    題が変わるので、どの塊を触っているのかを見失わない。 */
 const rbState={dummy:true,others:false,blocks:[]};
 function rbBindAside(form){
  const paint=()=>{rbPaintPreview(form);rbPaintOthers(form);rbPaintWhere(form)};
  rbBindPaperDrag(form);
  const tglDummy=form.querySelector('#rbToggleDummy');
  if(tglDummy&&!tglDummy.dataset.wired){
   tglDummy.dataset.wired='1';
   tglDummy.onclick=e=>{
    e.preventDefault();
    rbState.dummy=!rbState.dummy;
    tglDummy.classList.toggle('is-on',rbState.dummy);
    tglDummy.setAttribute('aria-pressed',rbState.dummy?'true':'false');
    paint();
   };
  }
  const tglOthers=form.querySelector('#rbToggleOthers');
  if(tglOthers&&!tglOthers.dataset.wired){
   tglOthers.dataset.wired='1';
   tglOthers.onclick=async e=>{
    e.preventDefault();
    rbState.others=!rbState.others;
    tglOthers.classList.toggle('is-on',rbState.others);
    tglOthers.setAttribute('aria-pressed',rbState.others?'true':'false');
    /* **重ねるものは開いたときに取る**（窓を開くたびに引くと、紙全体を
       見ない人まで往復が1本増える）。**本物の紙が読めればそちら**
       （§9.274）——マスタの行だけで組むと、出していない塊まで並び、
       設備ごとに変えた幅も効かない絵になる。 */
    if(rbState.others){
     await rbLoadPaper(form);
     /* **マスタの行も必ず持っておく**——まだ紙に置いていない塊は本物の紙で
        組めないので、そのときはこちらを流す（`rbPaintOthers`の後半）。
        `rbState.paper`が読めたかどうかで取り分けると、**新規作成中だけ
        顔ぶれが1件になる**（実際に踏んだ）。写しは保存・削除のたびに
        `forgetReportCaches()`が捨てるので、古い顔ぶれは残らない。 */
     if(!rbState.blocks.length){
      try{const r=await api('/api/report-block-master');rbState.blocks=r.items||[]}
      catch(_){rbState.blocks=[]}
     }
    }
    paint();
   };
  }
  /* 見本の値は候補と一緒に届く（§9.250 ⑤）。**届いたら塗り直すこと**
     ——投げっぱなしにすると、②のタブを開くまで値の場所が「（値）」のまま
     残る（§9.234 ⑧と同じ罠）。**失敗しても黙って進む**（値が「（値）」に
     なるだけで、設定そのものは触れる）。 */
  fbLoadCatalog().then(()=>paint()).catch(()=>{});
  /* **この塊がどの紙に置かれているか**は開いた時点で読む（§9.274）——
     読めなくても窓は使える（fail-open）。 */
  rbLoadPaper(form).then(()=>paint()).catch(()=>{});
  if(form.dataset.rbWired==='1'){paint();return}
  form.dataset.rbWired='1';
  form.addEventListener('change',paint);
  form.addEventListener('input',paint);
  requestAnimationFrame(paint);
 }

 /* ---------- 帳票まわりの写しを捨てる（§9.274、利用者の報告） ----------
    「帳票ブロックマスタをいじっても、帳票の紙レイアウトのところで見えている
     データ、プレビューのデータは変わりません」

    写しは3つある——紙の側（`WL.reportBlocks`）・候補の一覧（`fbCatalog`）・
    「紙全体で見る」の顔ぶれ（`rbState.blocks`）。**捨てるのは1箇所**
    （§9.163）——**別々に捨てると必ず捨て漏れる**（実際、候補の一覧と
    紙全体で見るは一度も捨てていなかったので、操業データの項目を足しても
    候補に出ず、塊を足しても紙の見本に出なかった）。 */
 function forgetReportCaches(){
  if(window.WL&&WL.reportBlocks&&typeof WL.reportBlocks.forget==='function')WL.reportBlocks.forget();
  fbCatalog.groups=[];fbCatalog.loadedFor=null;fbCatalog.loading=null;fbCatalog.vocab=null;
  rbState.blocks=[];rbState.paper=null;rbState.paperFor=null;
 }
 async function fbLoadCatalog(){
  const eq=String(maintState.equipment||'');
  if(fbCatalog.loadedFor===eq)return fbCatalog.groups;
  if(fbCatalog.loading)return fbCatalog.loading;
  fbCatalog.loading=(async()=>{
   try{
    const r=await api('/api/report-block-master'+(eq?'?equipment='+encodeURIComponent(eq):''));
    fbCatalog.groups=Array.isArray(r.catalog)?r.catalog:[];
    /* **語彙はサーバーが答える**（§9.163）——種別・寄せ・書式の呼び名を
       画面へ写すと、選べる書式を1つ足すたびに2箇所直すことになる。 */
    fbCatalog.vocab={cellKinds:r.cellKinds||null,aligns:r.aligns||null,
                     formatKinds:r.formatKinds||null,datePatterns:r.datePatterns||null,
                     /* 表に組むときの軸と列数の上限（§9.277）。 */
                     pivotAxes:Array.isArray(r.pivotAxes)?r.pivotAxes:null,
                     axisLot:r.axisLot||null,colsMax:r.contentColsMax||null,
                     /* 既定の中身を写すための並び（§9.285 ②）。**塊ごと**に
                        「保存形の文字列」と「列数」が入る。 */
                     defaultCells:(r.defaultCells&&typeof r.defaultCells==='object')
                       ?r.defaultCells:null};
    /* 見本の値は**候補と一緒に届く**（§9.250 ⑤）。別の口で取りに行くと、
       候補にあるのに見本の値だけ無い道が作れる。 */
    rbNoteSamples(fbCatalog.groups);
   }catch(e){fbCatalog.groups=[]}
   fbCatalog.loadedFor=eq;fbCatalog.loading=null;
   return fbCatalog.groups;
  })();
  return fbCatalog.loading;
 }
 /* `[内容]`の文字列 ⇄ 行の配列。**読み方はサーバー（`parse_content`）と
    同じ約束**——`=`が無い行はラベルと道が同じ。 */
 /* ---------- マトリクス配置（§9.245、利用者の指示） ----------
    「ブロックごとにデータの配置をどのようなマトリクスに並べるか視覚的に
     調整できる機能が欲しいです」

    **保存の形は`ラベル=出どころ`のまま**（§9.226 ⑥）で、後ろに`|`で
    **横に使うマス数**を足す。`|`の無い行は今までどおり1マス——既に登録して
    ある塊はそのまま読める。空きマスは**道もラベルも持たない行**（`|1`）。
    区切りに`,`と`、`を使っているので、マス数の区切りは`|`にしてある。
    **読み方はサーバー（`parse_content`）と同じにすること**——2通りあると、
    設定画面で組んだ形と紙が食い違う。 */
 const FB_SPAN_MAX=12;
 /* 内訳の列数（§9.255 ②／§9.277）。**サーバーが受ける上限に合わせる**
    ——ここだけ小さいと、盤で選べない列数を紙が受け入れることになる。
    §9.277で12まで（紙の`reportSection`が受ける数）——ピボットに組むと
    「1＋項目×集計」で簡単に6を超えるので、6のままだと**組んだ表が保存で
    黙って丸められて**いた。**上限そのものはサーバーが答える**
    （`fbVocab().colsMax`）ので、ここは届く前の受け皿。
    縦のマス数は器の高さで決まるので、選ばせるのは4段まで（それ以上は
    塊の高さのほうを③で決める話になる・§CLAUDE 11）。 */
 const FB_COLS_MAX=12,FB_COL_CHOICES=[1,2,3,4,5,6,7,8,9,10,11,12],FB_ROWS_MAX=4;
 function fbSpan(v,max){
  const n=Math.floor(Number(v));
  return Number.isFinite(n)?Math.max(1,Math.min(max||FB_SPAN_MAX,n)):1;
 }
 /* ---------- 縦のマス数（§9.255 ②、利用者の指示） ----------
    「『紙での並び』の部分は単純に何列何行だけでなく、データ内もグリッドに
     対応する形で細かく調整できるようにしてください」

    後置きを`<横>`から`<横>x<縦>`へ広げた。**`x`が無ければ縦1**なので、
    既に登録してある塊（`|2`だけ）はそのまま読める。読み方はサーバーの
    `parse_content`と**同じ約束**にすること（2通りあると、設定画面で組んだ
    形と紙が食い違う・§9.245）。 */
 /* ---------- 1つのマス（セル）が持つもの（§9.274、利用者の指示） ----------
    「縦にも項目を並べて、横も共通軸で並べたりすることでマトリクスも整形
     できるようにしたいです」「配置したデータの書式変更もできるように」

    種別は3つ（値／見出し／空き）。**見出し＝値を持たず文字だけ出すマス**で、
    これが無いと共通の軸を持つ表が組めない。共通の軸で並べたときはラベルが
    見出しと二重になるので、**ラベルを出さない**も要る。

    **読み方はサーバー（`report_block_repo.parse_content`／`dump_content`）と
    同じ約束にすること**——2通りあると、盤で組んだ形と紙が食い違う（§9.245）。
    突き合わせは`tests/fixtures/report_cells.json`で両方を同じ例に通す。 */
 const FB_KIND_VALUE='value',FB_KIND_HEAD='head',FB_KIND_BLANK='blank';
 /* 語彙（呼び名・選べる書式）は**サーバーが答える**（§9.163）。届く前でも
    盤は開けるので、綴りだけをここに持ち、**呼び名は持たない**。 */
 /* ---------- マスの高さは実測して決める（§9.303 ②） ----------
    利用者の報告「表を組み、多段になってくると、調整用のブロックが重なったり
    して乱れる」。盤のマスの下段（出どころ＋横N・縦M のつまみ）は列数が増える
    と折り返すが、**グリッドの行高はその折り返しを見込まない**——
    `grid-auto-rows:minmax(3.4em,auto)`の`auto`（max-content）は
    **「折り返さない前提」**で高さを見積もるので、実際に列幅へ置いて折り返した
    ぶんは行に入らず、**中身がマスの枠から溢れて下のマスへ重なる**
    （実測: 中身83px／マスの内寸75px）。1マスぶんに要る高さを測って
    `--fb-cell-h`へ入れる。

    **測る前に前の値を外すこと**（§9.210 ④・§9.217の罠）——付いたまま測ると、
    一度伸びた高さが二度と縮まない。
    **器の高さ（stretchされた箱）ではなく中身を測ること**——マスはトラックの
    高さまで引き伸ばされるので、`clientHeight`から測ると「いま与えられている
    高さ」を測り直すだけになり、縮む方向へ動かない。 */
 function fbFitCellHeight(wrap){
  if(!wrap||!wrap.classList.contains('is-matrix'))return;
  wrap.style.removeProperty('--fb-cell-h');
  const rows=[...wrap.querySelectorAll('.fb-row')];
  if(!rows.length)return;
  const gapY=parseFloat(getComputedStyle(wrap).rowGap)||0;
  let need=0;
  rows.forEach(el=>{
   /* 縦Nマスの札は N 行ぶん＋そのあいだの隙間を使うので、1マスぶんへ均す。 */
   const tall=Math.max(1,Number((/span\s+(\d+)/.exec(el.style.gridRow||'')||[])[1])||1);
   const inner=[...el.children].reduce((h,c)=>{
    const cm=getComputedStyle(c);
    return h+c.getBoundingClientRect().height
           +(parseFloat(cm.marginTop)||0)+(parseFloat(cm.marginBottom)||0);
   },0);
   const cs=getComputedStyle(el);
   const box=inner+(parseFloat(cs.paddingTop)||0)+(parseFloat(cs.paddingBottom)||0)
             +(parseFloat(cs.borderTopWidth)||0)+(parseFloat(cs.borderBottomWidth)||0);
   const one=(box-(tall-1)*gapY)/tall;
   if(one>need)need=one;
  });
  /* 端数の切り上げぶんだけ余分に取る（0.5pxの差でも溢れると重なって見える）。 */
  if(need>0)wrap.style.setProperty('--fb-cell-h',(Math.ceil(need)+1)+'px');
 }
 /* 窓の大きさが変わると列幅＝折り返しの回数が変わるので測り直す（§9.130）。
    **見張りは1つだけ**——描き直すたびに付けると器の数だけ積み上がる。 */
 function fbWatchCellHeight(wrap){
  if(!wrap||wrap.__fbRo||typeof ResizeObserver!=='function')return;
  let busy=false;
  wrap.__fbRo=new ResizeObserver(()=>{
   if(busy)return;                       /* 自分が高さを変えたぶんで回らない */
   busy=true;
   requestAnimationFrame(()=>{try{fbFitCellHeight(wrap)}finally{busy=false}});
  });
  try{wrap.__fbRo.observe(wrap)}catch(e){}
 }
 function fbCell(o){
  const x=o||{};
  let kind=String(x.kind||'').trim();
  if(kind!==FB_KIND_HEAD&&kind!==FB_KIND_BLANK)kind=x.blank?FB_KIND_BLANK:FB_KIND_VALUE;
  let label=String(x.label==null?'':x.label).trim();
  let path=String(x.path==null?'':x.path).trim();
  if(kind===FB_KIND_HEAD)path='';
  else if(kind===FB_KIND_BLANK){label='';path=''}
  else if(!path){kind=FB_KIND_BLANK;label=''}
  return {label,path,blank:kind===FB_KIND_BLANK,
          span:fbSpan(x.span),rows:fbSpan(x.rows,FB_SPAN_MAX),kind,
          showLabel:kind===FB_KIND_VALUE?(x.showLabel!==false):false,
          /* ラベルを**値の上**へ置く（§9.292 ⑤、利用者の指示「上下にラベルと
             内容が組み合わさるパターンでレイアウトできるように」）。
             ラベルを出さないマス・見出し・空きでは意味を持たないので落とす
             ——**サーバーと同じ落とし方**にすること（片方だけが持つと、
             盤の見本と紙が食い違う）。 */
          stack:kind===FB_KIND_VALUE&&x.showLabel!==false&&!!x.stack,
          align:fbAlign(x.align),format:fbFormat(x.format),
          /* **対象（子ロット）の軸のマス**（§9.277）。印の付いた並びだけを
             紙が**1つの表の中で**子ロットの数だけ複製する——子ロットの数は
             レコードごとに違うので、設計のときは1つぶんの型だけを置く。 */
          lot:!!x.lot};
 }
 const FB_ALIGNS=['','left','center','right'];
 const fbAlign=v=>FB_ALIGNS.indexOf(String(v||''))>=0?String(v||''):'';
 const FB_DECIMAL_MAX=6;
 /* 書式の綴りは`WL.cellFormat`（`base.js`）と同じ——値を整えるのはあの1箇所で、
    ここが持つのは「何を保存するか」だけ（2つ目の整形器を作らない）。 */
 function fbFormat(spec){
  if(!spec||typeof spec!=='object')return null;
  const kind=String(spec.kind||'').trim();
  if(['number','datetime','text'].indexOf(kind)<0)return null;
  const pre=String(spec.prefix||'').slice(0,16),suf=String(spec.suffix||'').slice(0,16);
  let out;
  if(kind==='number'){
   let dec=spec.decimals;
   if(dec===''||dec==null||!Number.isFinite(Number(dec)))dec=null;
   else dec=Math.max(0,Math.min(FB_DECIMAL_MAX,Math.floor(Number(dec))));
   out={kind:'number',decimals:dec,thousands:!!spec.thousands};
  }else if(kind==='datetime'){
   out={kind:'datetime',pattern:String(spec.pattern||'').slice(0,40)||'yyyy/MM/dd'};
  }else out={kind:'text'};
  if(pre)out.prefix=pre;
  if(suf)out.suffix=suf;
  /* **既定だけの指定は持たない**——「そのまま」と同じ意味の指定を保存すると、
     何も変えていない塊まで保存のたびに形が変わる。 */
  if(kind==='text'&&!pre&&!suf)return null;
  return out;
 }
 /* 行の形（`ラベル=道|横x縦`）では書けないマスか。 */
 const fbRich=c=>c.kind===FB_KIND_HEAD||(c.kind===FB_KIND_VALUE&&!c.showLabel)
   ||!!c.align||!!c.format||!!c.lot||!!c.stack;
 function fbParse(text){
  const s=String(text==null?'':text).trim();
  /* **JSONは`[`で始まるかどうかだけで見分ける**（サーバーと同じ約束）。
     壊れたJSONは行の形として読み直す——黙って空にしない。 */
  if(s.charAt(0)==='['){
   let data=null;
   try{data=JSON.parse(s)}catch(e){data=null}
   if(Array.isArray(data))return data.filter(x=>x&&typeof x==='object').map(fbCell);
  }
  return String(text||'').replace(/、/g,',').replace(/\r/g,'\n').replace(/,/g,'\n')
   .split('\n').map(x=>x.trim()).filter(Boolean).map(line=>{
    let s=line,span=1,rows=1;
    const b=s.indexOf('|');
    if(b>=0){
     const tail=s.slice(b+1).trim().toLowerCase();
     const x=tail.indexOf('x');
     span=fbSpan((x>=0?tail.slice(0,x):tail).trim()||1);
     rows=x>=0?fbSpan(tail.slice(x+1).trim()||1):1;
     s=s.slice(0,b).trim();
    }
    const i=s.indexOf('=');
    const label=i>=0?s.slice(0,i).trim():s;
    const path=i>=0?s.slice(i+1).trim():s;
    /* 空きマスは落とさない——場所を取ることが役目なので、消すと詰まる。 */
    if(!path)return fbCell({kind:FB_KIND_BLANK,span,rows});
    return fbCell({label:label||path,path,span,rows});
   });
 }
 function fbText(rows){
  /* **1マスの項目は今までどおりの1行で書く**（`|1`を足さない）——書き足すと、
     何も変えていない塊まで保存のたびに形が変わる。
     縦も1なら`x`を足さない（同じ理由）。
     **新しい持ちもの（見出し・ラベルを出さない・寄せ・書式）を1つでも
     使っているときだけJSONへ切り替える**（§9.274）——こうすると、触って
     いない塊の保存値は1バイトも変わらない。 */
  const cells=(rows||[]).map(fbCell);
  if(!cells.length)return '';
  if(cells.some(fbRich)){
   return JSON.stringify(cells.map(c=>({label:c.label,path:c.path,span:c.span,rows:c.rows,
     kind:c.kind,showLabel:c.showLabel,stack:c.stack,align:c.align,format:c.format,lot:c.lot})));
  }
  return cells.map(r=>{
   const sp=fbSpan(r.span),tall=fbSpan(r.rows);
   const size=(tall>1?sp+'x'+tall:(sp>1?String(sp):''));
   if(r.blank)return '|'+(size||'1');
   return `${r.label||r.path}=${r.path}`+(size?'|'+size:'');
  }).join('\n');
 }
 /* 効いている書式を**文字で出す**（§9.285 ③／§CLAUDE 3）。1マスずつ押して
    確かめないと、どのマスに書式が付いているのか分からない——「設定したのに
    効いていない」と読まれる原因になる。 */
 function fbFmtLabel(f){
  if(!f||!f.kind)return '';
  const bits=[];
  if(f.kind==='number'){
   bits.push(f.decimals==null?'数値':`小数${f.decimals}桁`);
   if(f.thousands)bits.push('3桁区切り');
  }else if(f.kind==='datetime')bits.push(f.pattern||'yyyy/MM/dd');
  else bits.push('文字');
  if(f.prefix)bits.push(`前「${f.prefix}」`);
  if(f.suffix)bits.push(`後「${f.suffix}」`);
  return bits.join('・');
 }
 /* いま候補に在る道（§9.285 ④）。**候補に無い道も書ける**（サーバーは
    選択肢で塞いでいない）ので、これは**間違いの合図ではなく事実の合図**
    ——項目名が変わった・元データからその列が消えた塊は紙で空欄になるので、
    盤の時点でそう分かるようにする（§4「できないことは、できないと書く」）。
    **候補が届いていないうちは何も言わない**（読めなかったことを
    「無い」と言わない・§CLAUDE 3）。 */
 function fbKnownPaths(){
  const set=new Set();
  (fbCatalog.groups||[]).forEach(g=>(g.items||[]).forEach(i=>{if(i&&i.path)set.add(i.path)}));
  return set;
 }
 /* 種別・寄せ・書式の呼び名。**サーバーが答える**（§9.163）が、届く前でも
    盤は開けるので**綴りだけの受け皿**を持つ（呼び名は綴りそのもの）。
    受け皿を「日本語の写し」にしないこと——写した瞬間に2箇所になる。 */
 function fbVocab(){
  const v=fbCatalog.vocab||{};
  return {
   cellKinds:v.cellKinds||[{v:FB_KIND_VALUE,label:'value'},{v:FB_KIND_HEAD,label:'head'},
                           {v:FB_KIND_BLANK,label:'blank'}],
   aligns:v.aligns||FB_ALIGNS.map(x=>({v:x,label:x||'auto'})),
   formatKinds:v.formatKinds||[{v:'',label:'-'},{v:'number',label:'number'},
                               {v:'datetime',label:'datetime'},{v:'text',label:'text'}],
   datePatterns:v.datePatterns||['yyyy/MM/dd','yyyy/MM/dd HH:mm','HH:mm'],
   /* 表に組むときの軸（§9.277）。**既定の置き方はこの並びが決める**——
      1つ目を行、残りを列。届く前でも盤は開けるので受け皿を持つ。 */
   pivotAxes:v.pivotAxes||['対象','項目','集計'],
   axisLot:v.axisLot||'対象',
   /* 節の中の列数の上限。**紙が受ける数と同じ**（サーバーが答える）。 */
   colsMax:Number(v.colsMax)||FB_COLS_MAX,
   /* 既定の中身を写せる塊（§9.285 ②）。届く前は空——写す口を出さない
      （押せるのに何も起きないボタンを作らない・§4）。 */
   defaultCells:v.defaultCells||{}};
 }
 /* ---------- 表は「ピボット」で組む（§9.277、利用者の指示） ----------
    「EXCELのピボットテーブルのように自由に組めるように、表にしたときには
     選んだ項目の中に必要な共通軸を抽出してそれを置く場所を自動もしくは
     その後ユーザーに修正させる形で作成することで最終形の表の形をしっかり
     固定できるはずです。軸の位置と数がわかれば表の形状がわからずに最終形の
     出力に困らないのでそのように対応してください」

    §9.274では候補が`row`/`col`という**置き場つきの名前**を名乗っており、
    「板厚は行・MINは列」という**決め打ちの1通り**しか作れなかった。
    行と列を入れ替えることも、3つ目の軸（対象＝子ロット）を足すこともできない。

    いまは候補が`axes`（**名前と値だけ**）を名乗り、**置き場は盤が決める**。
      ・軸を抽出する            … `fbAxes(rows)`
      ・置き場の既定を決める    … サーバーの並び順の1つ目を行・残りを列
      ・利用者が直せる          … 軸ごとの「行／列」の切り替え
      ・いまの形を文字で出す    … 「行＝対象／列＝項目・集計（7列×3段）」

    **対象（子ロット）は行だけ**——子ロットの数はレコードごとに違うので、
    設計のときに置けるのは**1つぶんの型**（`lot:true`のマス）だけで、数は
    紙が決める。行なら型は**連続したひとかたまり**になるので複製できるが、
    列だと1行ごとに飛び飛びになる。**できないことは画面に書く**（§4）。 */
 /* 軸を置く箱は2つ（§9.278、利用者の指示「軸単位のドラッグアンドドロップ」）。
    **「使わない」の箱は作らない**——軸を外すと、その軸の値どうしが同じマスへ
    重なって**どの値を出すのか決まらない**（EXCELは足し合わせられるが、
    ここの値はMIN/MAXなので足せない）。置く先は行か列の2つだけ。 */
 const FB_AXIS_ROW='行',FB_AXIS_COL='列',FB_AXIS_SIDES=[FB_AXIS_ROW,FB_AXIS_COL];
 /* 候補が名乗る軸。**綴りはサーバーが持つ**ので、ここでは引くだけ。 */
 function fbAxesOf(path){
  for(const g of (fbCatalog.groups||[]))
   for(const it of (g.items||[]))
    if(it.path===path&&it.axes&&typeof it.axes==='object')return it.axes;
  return null;
 }
 function fbAxisVal(a,n){return (a&&a[n]!=null)?a[n]:''}
 /* いま選んでいる値のマスから軸を抜き出す。→ {live,known,bad,axes}
    **サーバーの並び順で返す**（既定の置き場がその順で決まる）。 */
 function fbAxes(rows){
  const live=(rows||[]).filter(r=>r.kind===FB_KIND_VALUE&&r.path);
  const known=[],bad=[];
  live.forEach(r=>{
   const a=fbAxesOf(r.path);
   /* **組んだ表の足場は軸を名乗らなくてよい**（§9.277）——「対象」の行の
      見出し（子ロット番号）は盤が作ったマスで、利用者が選んだ項目ではない。
      ここで`bad`へ入れると、**一度組んだ表は二度と組み直せなくなる**
      （軸の帯が消え、「表に組む」も理由の分からない断り書きで固まる）。 */
   if(!a&&r.lot)return;
   if(!a)bad.push(r);else known.push({r,a});
  });
  const order=fbVocab().pivotAxes;
  const names=[];
  known.forEach(k=>Object.keys(k.a).forEach(n=>{if(names.indexOf(n)<0)names.push(n)}));
  names.sort((x,y)=>{
   const i=order.indexOf(x),j=order.indexOf(y);
   return (i<0?99:i)-(j<0?99:j);
  });
  const axes=names.map(n=>{
   const values=[];
   known.forEach(k=>{const v=k.a[n];if(v!=null&&values.indexOf(v)<0)values.push(v)});
   return {name:n,values};
  });
  return {live,known,bad,axes};
 }
 /* 対象（子ロット）の軸は**繰り返しの設定から生える**——候補の項目ではなく
    「この塊を子ロットごとに描くか」という塊の設定なので、そちらを見る。 */
 function fbLotAxisOn(box){
  const form=box.closest('form')||document;
  const el=form.querySelector('[data-field="repeatText"],[data-field="repeat"]');
  return /子ロット/.test(String((el&&el.value)||''));
 }
 /* 「全体」（総計）を出せる軸（§9.278、利用者の指示「集計(小計や総計)のONOFF」）。
    **足し合わせに意味のある軸だけ**——`対象`は子ロットを束ねたものが
    ロット全体なので総計が定義できるが、`項目`（板厚と板幅）や`集計`
    （MINとMAX）は**足しても意味のある数にならない**。無い集計の欄を並べて
    「押しても変わらない」を作らず、**出せない理由をその場に書く**（§4）。 */
 function fbAxisTotalable(a){return !!(a&&a.lot)}
 const FB_LOT_WHOLE='全体';
 function fbGrandOn(state,a){
  if(!fbAxisTotalable(a))return false;
  const g=(state&&state.grand)||{};
  /* **既定は出す**——今までの表には「全体」の行があるので、既定を変えると
     設定を触っていない現場の紙から行が1本消える。 */
  return g[a.name]===undefined?true:!!g[a.name];
 }
 /* 軸の値（メンバー）。対象の軸は「全体」＋**子ロット1つぶんの型**。
    数は紙が決めるので、盤に置くのは型1つだけ（§9.277）。 */
 function fbAxisMembers(a){
  if(!a)return [];
  if(a.lot){
   const m=[];
   if(a.grand)m.push({value:FB_LOT_WHOLE,whole:true});
   m.push({value:null,lot:true});
   return m;
  }
  return (a.values||[]).map(v=>({value:v}));
 }
 function fbAxisSize(a){return Math.max(1,fbAxisMembers(a).length)}
 /* 置き場。**掴んで置いた順を覚え**、触っていない軸はサーバーの並びの既定
    （1つ目を行・残りを列）へ落ちる。**対象は行だけ**（型が連続したかたまりに
    なる置き方でしか複製できない）。 */
 function fbPlacement(box,state){
  const ax=fbAxes(state.rows).axes;
  const lot=fbVocab().axisLot;
  const list=fbLotAxisOn(box)
    ? [{name:lot,values:null,lot:true}].concat(ax.filter(a=>a.name!==lot))
    : ax.filter(a=>a.name!==lot);
  const by=new Map(list.map(a=>[a.name,a]));
  const put=(state&&state.axes)||{};
  const seen=new Set(),ordered={};
  FB_AXIS_SIDES.forEach(at=>{
   ordered[at]=[];
   (put[at]||[]).forEach(n=>{if(by.has(n)&&!seen.has(n)){seen.add(n);ordered[at].push(n)}});
  });
  list.forEach((a,i)=>{
   if(seen.has(a.name))return;
   seen.add(a.name);
   ordered[a.lot?FB_AXIS_ROW:(i===0?FB_AXIS_ROW:FB_AXIS_COL)].push(a.name);
  });
  /* **対象は必ず行のいちばん外側**（§9.278）。列に置けないだけでなく、
     行の内側にも置けない——紙は`lot:true`の**ひとかたまり**を子ロットの数だけ
     複製するので、内側にすると「全体」の行と子ロットの行が交互になり、
     かたまりが途切れて**行がばらける**（実際に「行＝集計・対象」で踏んだ）。 */
  if(by.has(lot)){
   FB_AXIS_SIDES.forEach(at=>{ordered[at]=ordered[at].filter(n=>n!==lot)});
   ordered[FB_AXIS_ROW]=[lot].concat(ordered[FB_AXIS_ROW]);
  }
  const mk=(n,at)=>{
   const a=by.get(n);
   const o={name:n,values:a.values,lot:!!a.lot,at,fixed:!!a.lot,
            totalable:fbAxisTotalable(a)};
   o.grand=fbGrandOn(state,o);
   return o;
  };
  return [].concat(ordered[FB_AXIS_ROW].map(n=>mk(n,FB_AXIS_ROW)),
                   ordered[FB_AXIS_COL].map(n=>mk(n,FB_AXIS_COL)));
 }
 /* いま組める表。**組めないなら理由を返す**（§4）。 */
 function fbTablePlan(box,state){
  const found=fbAxes(state.rows);
  if(!found.live.length)return {err:'先に候補から項目を選んでください。'};
  if(found.bad.length)return {err:'「'+esc(found.bad[0].label||found.bad[0].path)
    +'」は軸を名乗らない項目です'
    +'（表に組めるのは「測定した値の統計」のように<b>項目＋集計</b>で決まる項目だけです）。'};
  const place=fbPlacement(box,state);
  const rowAx=place.filter(a=>a.at===FB_AXIS_ROW);
  const colAx=place.filter(a=>a.at===FB_AXIS_COL);
  if(!rowAx.length)return {place,err:'<b>行</b>に置く軸がありません（どれか1つを「行」へ移してください）。'};
  if(!colAx.length)return {place,err:'<b>列</b>に置く軸がありません（どれか1つを「列」へ移してください）。'};
  const colN=colAx.reduce((n,a)=>n*fbAxisSize(a),1);
  const cols=rowAx.length+colN;
  const max=fbVocab().colsMax;
  if(cols>max)return {place,err:'この置き方だと<b>'+cols+'列</b>になり、1つの塊に入る'
    +max+'列を超えます（軸をどれか「行」へ移してください）。'};
  return {place,rowAx,colAx,cols,colN,
    heads:colAx.length,
    bodyRows:rowAx.reduce((n,a)=>n*fbAxisSize(a),1)};
 }
 /* 組み合わせを作る（先の軸が外側）。 */
 function fbCombos(axes){
  let out=[[]];
  (axes||[]).forEach(a=>{
   const ms=fbAxisMembers(a),next=[];
   out.forEach(pre=>ms.forEach(m=>next.push(
     pre.concat([{axis:a,value:m.value,lot:!!m.lot,whole:!!m.whole}]))));
   out=next;
  });
  return out;
 }
 function fbMakeTable(box,state,sync){
  const plan=fbTablePlan(box,state);
  const say=t=>{const el=box.querySelector('.fb-hint');if(el)el.innerHTML=t};
  if(plan.err){say(plan.err);return}
  const rowAx=plan.rowAx,colAx=plan.colAx;
  const known=fbAxes(state.rows).known;
  /* 軸の値の組み合わせ → 元の項目。**選んでいない組み合わせは空きマス**
     （詰めると軸がずれる）。 */
  const keyAx=rowAx.concat(colAx).filter(x=>!x.lot);
  const at=new Map();
  known.forEach(k=>at.set(keyAx.map(x=>fbAxisVal(k.a,x.name)).join(String.fromCharCode(31)),k.r));
  const lotName=fbVocab().axisLot;
  const out=[];
  /* ---- 見出しの段（列の軸のぶん）---- */
  colAx.forEach((a,li)=>{
   /* 左上の角。**行の軸のぶんの幅**をまとめて空ける。 */
   if(li===0)out.push(fbCell({kind:FB_KIND_BLANK,span:rowAx.length,rows:colAx.length}));
   const inner=colAx.slice(li+1).reduce((n,x)=>n*fbAxisSize(x),1);
   const outer=colAx.slice(0,li).reduce((n,x)=>n*fbAxisSize(x),1);
   for(let k=0;k<outer;k++)
    fbAxisMembers(a).forEach(m=>out.push(fbCell({kind:FB_KIND_HEAD,label:m.value,span:inner})));
  });
  /* ---- 本体 ---- */
  const rowCombos=fbCombos(rowAx);
  const colCombos=fbCombos(colAx);
  /* **外側のラベルは繰り返さない**（§9.278、利用者の指示「縦軸、横軸それぞれ
     項目が２つ以上あるときはその並びによってEXCELのピボットのように階層構造で
     ラベル付け」）。EXCELの既定と同じで、同じ値が続くところは空きマスにする
     ——毎行くり返したい人のために切り替えも置く。 */
  const flat=!!(state&&state.repeatLabel);
  let prev=null;
  rowCombos.forEach(rc=>{
   const isLot=rc.some(x=>x.lot);
   rc.forEach((x,i)=>{
    /* 同じ値が続いているか（自分より外側もすべて同じときだけ「続き」）。 */
    const same=!flat&&prev&&prev.slice(0,i+1).every((p,j)=>
      p.axis.name===rc[j].axis.name&&p.value===rc[j].value&&p.lot===rc[j].lot);
    if(same){
     out.push(fbCell({kind:FB_KIND_BLANK,lot:isLot}));
    }else if(x.lot){
     /* 対象の行の見出しは**子ロット番号**（`lot.no`）。値のマスなので、
        紙がその回の子ロットで埋める。**かたまりの1行目は必ずここを通る**
        （対象は行のいちばん外側なので、直前の組み合わせとは必ず違う）ので、
        子ロットごとの複製でも番号が消えない。 */
     out.push(fbCell({label:lotName,path:'lot.no',showLabel:false,align:'left',lot:true}));
    }else out.push(fbCell({kind:FB_KIND_HEAD,label:x.value,align:'left',lot:isLot}));
    /* **対象の行に居るマスは、見出しも含めて全部に印を付ける**（§9.277）
       ——紙は「印の付いた**ひとかたまり**」を子ロットの数だけ複製するので、
       途中に印の無いマスが挟まると、そのマスだけが先頭へ抜け出して
       行がばらける（行の軸を2本にした瞬間に起きる）。 */
   });
   prev=rc;
   colCombos.forEach(cc=>{
    const pick=rc.concat(cc);
    const key=keyAx.map(x=>{
     const hit=pick.find(y=>y.axis.name===x.name);
     return hit?(hit.value||''):'';
    }).join(String.fromCharCode(31));
    /* **鍵に対象は入らない**（`keyAx`が除いてある）——全体の行も子ロットの
       行も、引く道は同じ`stat.*`で、違うのは紙が渡す文脈だけ。 */
    const src=at.get(key);
    out.push(src?fbCell(Object.assign({},src,{showLabel:false,align:'right',lot:isLot}))
                :fbCell({kind:FB_KIND_BLANK,lot:isLot}));
   });
  });
  state.rows=out;state.sel=null;
  /* 列数は「内訳の列数」の欄が持ち主（§CLAUDE 8）——ここは書き換えるだけ。 */
  const ci=(box.closest('form')||document).querySelector('[data-field="cols"]');
  const want=String(Math.min(fbVocab().colsMax,plan.cols));
  if(ci){
   /* **選択肢に無い数を黙って捨てない**（§9.277）——`<select>`は知らない値を
      代入すると空になり、`cols=0`＝既定の2列で刷られる（実際に7列で踏んだ）。
      無ければ候補へ足してから入れる（§9.204と同じ罠）。 */
   if(ci.tagName==='SELECT'&&![...ci.options].some(o=>o.value===want)){
    const o=document.createElement('option');o.value=want;o.textContent=want;ci.appendChild(o);
   }
   ci.value=want;
   ci.dispatchEvent(new Event('change',{bubbles:true}));
  }
  sync();
  say(fbPlanText(plan)+'で組みました。<b>このあと手で直せます。</b>');
 }
 /* いまの表の形を文字で出す（§9.277）。**軸の位置と数が読めれば最終形が
    決まる**——「押せるから、まだ組めていない」と読まれないための1行でもある。 */
 function fbPlanText(plan){
  const nm=a=>esc(a.name)+(a.lot?(a.grand?'（全体＋子ロットぶん）':'（子ロットぶん）'):'');
  return '<b>行＝'+plan.rowAx.map(nm).join('・')
    +'／列＝'+plan.colAx.map(nm).join('・')+'</b>'
    +'（'+plan.cols+'列 × 見出し'+plan.heads+'段＋本体'+plan.bodyRows+'段）';
 }
 /* **読み書きの約束を名前で出す**（§9.274）。サーバー（`parse_content`／
    `dump_content`）と1対1で、`tests/test_rbcells.js`が同じ例で突き合わせる
    ——公開していないと、網は盤のDOM越しにしか見られず、**盤が読み直さない
    形でも通ってしまう**（実際にそうなった）。`window.*`ではなく`WL.*`へ出す
    （§CLAUDE「新しく公開するものは名前空間へ」）。 */
 window.WL=window.WL||{};
 WL.reportCells={parse:t=>fbParse(t),text:c=>fbText(c),cell:o=>fbCell(o)};
 function bindFieldBuilders(form){
  form.querySelectorAll('[data-fb]').forEach(box=>{
   if(box.dataset.fbWired)return;
   box.dataset.fbWired='1';
   const hidden=box.querySelector('input[data-field]');
   /* `place`＝軸の置き場（§9.277）。**触った軸だけ覚える**——触っていない
      軸は既定（サーバーの並び順の1つ目を行・残りを列）のままにする。
      **保存の対象ではない**（組んだ結果はマスの並びが持っている）。 */
   const state={rows:fbParse(hidden?hidden.value:''),cat:'',q:'',sel:null,place:{}};
   /* **隠し欄へ書いたら`change`を飛ばす**（§9.218 ②「`.value`への代入では
      `change`が飛ばない」）。飛ばさないと、同じフォームの中で値を見ている
      もの——刷り上がりの見本（§9.249 ③）・`data-when`の出し入れ——が
      **一度も気づけない**（見本が「載せる項目がありません」のままだった）。 */
   const push=()=>{
    if(!hidden)return;
    hidden.value=fbText(state.rows);
    hidden.dispatchEvent(new Event('change',{bubbles:true}));
   };
   const sync=()=>{
    /* **マスの形を1つにそろえる**（§9.274）——候補から足したときは
       `{label,path}`しか無いので、種別も寄せも書式も持たない。ここで
       通しておかないと「表に組む」が値のマスを1つも見つけられない
       （実際に踏んだ）。 */
    state.rows=(state.rows||[]).map(fbCell);
    push();
    /* **選んでいたマスが消えたら選択も外す**——残すと、別のマスの設定を
       触っているように見える（§CLAUDE 3）。 */
    if(state.sel!=null&&(state.sel<0||state.sel>=state.rows.length))state.sel=null;
    drawCols();drawChosen();drawList();drawInsp();drawTableBtn();
    if(typeof drawSeedRef.fn==='function')drawSeedRef.fn();
    if(typeof drawStackRef.fn==='function')drawStackRef.fn();
   };
   /* `drawSeed`は下で定義するので、呼ぶ側は入れ物越しに見る（巻き上げの
      効かない`const`を上から参照しない）。 */
   const drawSeedRef={fn:null};
   /* ラベルと値の並べ方のボタンも同じ作法（§9.292 ⑤）。 */
   const drawStackRef={fn:null};
   /* 列数は**「内訳の列数」の欄が持つ**（§CLAUDE 8。同じ数を2箇所に置くと
      片方だけ直した状態が作れる）。空欄＝2列は`reportSection`の既定と同じ。 */
   const colsInput=()=>form.querySelector('[data-field="cols"]');
   const colCount=()=>{
    const el=colsInput();
    const n=Math.floor(Number(el&&el.value));
    return Number.isFinite(n)&&n>=1?Math.min(FB_COLS_MAX,n):2;
   };
   const drawCols=()=>{
    const host=box.querySelector('.fb-cols');if(!host)return;
    const cur=colCount();
    host.innerHTML=`<i>列数</i>`+FB_COL_CHOICES.map(n=>
      `<button type="button" data-fb-cols="${n}" class="${n===cur?'is-on':''}"`
      +` aria-pressed="${n===cur?'true':'false'}">${n}</button>`).join('');
    host.querySelectorAll('[data-fb-cols]').forEach(b=>b.onclick=()=>{
     const el=colsInput();
     if(!el)return;
     el.value=b.dataset.fbCols;
     el.dispatchEvent(new Event('change',{bubbles:true}));
     drawCols();drawChosen();
    });
   };
   const drawChosen=()=>{
    const wrap=box.querySelector('.fb-rows');if(!wrap)return;
    const cnt=box.querySelector('.fb-count');
    const n=colCount();
    const shown=state.rows.filter(r=>!r.blank).length;
    if(cnt)cnt.textContent=state.rows.length
      ?`${shown}件${state.rows.length>shown?`・空き${state.rows.length-shown}`:''}`
      :'まだありません';
    /* **紙と同じマトリクスで出す**（§9.245）——縦1列の一覧では、何列に
       なるのか・どこで折り返すのかが読めない。 */
    wrap.style.setProperty('--fb-cols',n);
    wrap.classList.toggle('is-matrix',true);
    /* 1行ごとに数え直さない（候補は200列を超えうる）。 */
    const known=fbKnownPaths();
    wrap.innerHTML=state.rows.length?state.rows.map((r,i)=>{
      const sp=Math.min(n,fbSpan(r.span,n));
      const tall=fbSpan(r.rows,FB_ROWS_MAX);
      /* **横と縦は別の群にして、どちらか分かる形にする**（§9.255 ②）——
         数字だけを並べると「4」が4列なのか4段なのか読めない。 */
      const spans=[];
      for(let v=1;v<=n;v++)spans.push(
       `<button type="button" class="fb-span${v===sp?' is-on':''}" data-fb-span="${i}:${v}"`
       +` title="横に${v}マス使います">${v}</button>`);
      const talls=[];
      for(let v=1;v<=FB_ROWS_MAX;v++)talls.push(
       `<button type="button" class="fb-span${v===tall?' is-on':''}" data-fb-rows="${i}:${v}"`
       +` title="縦に${v}マス使います">${v}</button>`);
      const size=`<span class="fb-size">`
       +`<i class="fb-size-tag" title="横に使うマス数">横</i>`
       +`<span class="fb-spans">${spans.join('')}</span>`
       +`<i class="fb-size-tag" title="縦に使うマス数">縦</i>`
       +`<span class="fb-spans">${talls.join('')}</span></span>`;
      const st=` style="grid-column:span ${sp}${tall>1?`;grid-row:span ${tall}`:''}"`;
      /* **1マスの中は2段**（§CLAUDE 11）——名前・出どころ・マス数・×を横1列に
         並べると、3列のときに名前の欄が1文字ぶんまで潰れる（実機の見え方で
         確認）。上段＝掴む所と名前、下段＝出どころとマス数。 */
      /* **選んでいるマスは印を付ける**（§CLAUDE 3）——下の設定欄がどのマスの
         話なのかが読めないと、隣のマスを直してしまう。 */
      const on=(state.sel===i)?' is-sel':'';
      if(r.blank)return `<div class="fb-row fb-row-blank${on}" draggable="true" data-fb-i="${i}"${st}>`
       +`<div class="fb-row-top"><span class="fb-grip" aria-hidden="true">⠿</span>`
       +`<b class="fb-blank-name">空きマス</b>`
       +`<button type="button" class="fb-del" title="この空きマスを外します">×</button></div>`
       +`<div class="fb-row-bot">${size}</div></div>`;
      /* 見出しのマス（§9.274）。**値の道を持たない**ので、下の段は
         「見出し」であることとマス数だけ。 */
      if(r.kind===FB_KIND_HEAD)
       return `<div class="fb-row fb-row-head${on}" draggable="true" data-fb-i="${i}"${st}>`
       +`<div class="fb-row-top"><span class="fb-grip" aria-hidden="true">⠿</span>`
       +`<input type="text" class="fb-label" value="${esc(r.label)}" aria-label="見出しの文字"`
       +` placeholder="見出しの文字">`
       +`<button type="button" class="fb-del" title="この見出しを外します">×</button></div>`
       +`<div class="fb-row-bot"><i class="fb-kindtag">見出し</i>${size}</div></div>`;
      const fmt=fbFmtLabel(r.format);
      /* **候補に無い道は印を出す**（§9.285 ④）——元データからその列が
         無くなれば紙は空欄になる。候補が1件も届いていないうちは言わない。 */
      const unknown=known.size&&r.path&&!known.has(r.path);
      return `<div class="fb-row${on}${r.showLabel===false?' fb-row-bare':''}" draggable="true" data-fb-i="${i}"${st}>`
      +`<div class="fb-row-top"><span class="fb-grip" aria-hidden="true">⠿</span>`
      +`<input type="text" class="fb-label" value="${esc(r.label)}" aria-label="紙に出す名前"`
      +`${r.showLabel===false?' title="ラベルは紙に出しません（表の軸と二重にならないように）"':''}>`
      +`<button type="button" class="fb-del" title="この項目を外します">×</button></div>`
      +`<div class="fb-row-bot">`
      +`<code class="fb-path" title="${esc(r.path)}">${esc(r.path)}</code>`
      +(fmt?`<i class="fb-fmttag" title="この欄に効いている書式です（マスを押すと変えられます）">${esc(fmt)}</i>`:'')
      +(unknown?`<i class="fb-warn" title="いまの候補にこの道がありません。項目名が変わったか、元データからその列が無くなった可能性があります。紙では空欄になります。">候補に無い</i>`:'')
      +size+`</div></div>`;
     }).join('')
      :`<p class="fb-empty">左の候補を押すと、ここへ増えます。<b>左上から順に紙へ並びます。</b></p>`;
    /* **押しただけなら選ぶ**（掴んで動かしたときは並べ替え・§9.90と同じ分け方）。
       つまみ・名前欄・×は自分の仕事があるので、そこを押したときは選ばない。 */
    wrap.querySelectorAll('.fb-row').forEach(row=>{
     row.addEventListener('mousedown',e=>{
      if(e.target.closest('button,input,code'))return;
      state.sel=Number(row.dataset.fbI);drawChosen();drawInsp();
     });
    });
    wrap.querySelectorAll('[data-fb-span]').forEach(b=>b.onclick=()=>{
     const [i,v]=b.dataset.fbSpan.split(':').map(Number);
     state.rows[i].span=v;sync();
    });
    wrap.querySelectorAll('[data-fb-rows]').forEach(b=>b.onclick=()=>{
     const [i,v]=b.dataset.fbRows.split(':').map(Number);
     state.rows[i].rows=v;sync();
    });
    wrap.querySelectorAll('.fb-del').forEach(b=>b.onclick=()=>{
     state.rows.splice(Number(b.closest('.fb-row').dataset.fbI),1);sync();
    });
    wrap.querySelectorAll('.fb-label').forEach(inp=>{
     /* **打っている最中に作り直さない**（§9.117）——カーソルが飛ぶ。
        値だけを控えておき、書き戻しは隠し欄へ直接行う。 */
     inp.oninput=()=>{
      state.rows[Number(inp.closest('.fb-row').dataset.fbI)].label=inp.value;
      push();
     };
    });
    let from=-1;
    wrap.querySelectorAll('.fb-row').forEach(row=>{
     row.addEventListener('dragstart',e=>{
      from=Number(row.dataset.fbI);row.classList.add('is-drag');
      try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain','')}catch(_){}
     });
     row.addEventListener('dragend',()=>row.classList.remove('is-drag'));
     row.addEventListener('dragover',e=>{e.preventDefault()});
     row.addEventListener('drop',e=>{
      e.preventDefault();
      const to=Number(row.dataset.fbI);
      if(from<0||from===to)return;
      const m=state.rows.splice(from,1)[0];
      state.rows.splice(to,0,m);from=-1;sync();
     });
    });
    /* **マスの高さは実測して入れる**（§9.303 ②）——列数と折り返しで
       変わるので、描き直すたびに測る。 */
    fbFitCellHeight(wrap);fbWatchCellHeight(wrap);
   };
   const drawList=()=>{
    const cats=box.querySelector('.fb-cats'),list=box.querySelector('.fb-list');
    if(!cats||!list)return;
    const groups=fbCatalog.groups||[];
    if(!groups.length){
     cats.innerHTML='';
     list.innerHTML='<p class="fb-empty">候補を読み込めませんでした。<b>出どころを直接書くこともできます</b>（例: <code>basic.lotNo</code>）。</p>';
     return;
    }
    if(!state.cat||!groups.some(g=>g.group===state.cat))state.cat=groups[0].group;
    cats.innerHTML=groups.map(g=>
      `<button type="button" class="fb-cat${g.group===state.cat?' is-on':''}" data-fb-cat="${esc(g.group)}"`
      +` title="${esc(g.note||'')}">${esc(g.group)}<i>${g.items.length}</i></button>`).join('');
    cats.querySelectorAll('[data-fb-cat]').forEach(b=>b.onclick=()=>{state.cat=b.dataset.fbCat;drawList()});
    const g=groups.find(x=>x.group===state.cat)||{items:[]};
    const q=String(state.q||'').trim().toLowerCase();
    const used=new Set(state.rows.map(r=>r.path));
    const hit=g.items.filter(it=>!q||(it.label+' '+it.path).toLowerCase().indexOf(q)>=0);
    list.innerHTML=(g.note?`<p class="fb-note">${esc(g.note)}</p>`:'')
     +(hit.length?hit.map(it=>
      `<button type="button" class="fb-item${used.has(it.path)?' is-used':''}"`
      +` data-fb-add="${esc(it.path)}" data-fb-label="${esc(it.label)}"`
      +` title="${esc(it.path)}">${esc(it.label)}`
      +`${used.has(it.path)?'<i class="fb-used">載せています</i>':''}`
      +`${it.note?`<small>${esc(it.note)}</small>`:''}</button>`).join('')
      :`<p class="fb-empty">「${esc(state.q)}」に当たる項目はありません。</p>`);
    list.querySelectorAll('[data-fb-add]').forEach(b=>b.onclick=()=>{
     const path=b.dataset.fbAdd;
     /* **同じ項目を2つ載せない**（同じ値が2箇所に並ぶ・§CLAUDE 8）。
        既に載せているものを押したら、外す（押した結果が必ず変わる）。 */
     const at=state.rows.findIndex(r=>r.path===path);
     if(at>=0)state.rows.splice(at,1);
     else state.rows.push({label:b.dataset.fbLabel||path,path});
     sync();
    });
   };
   /* ---------- 選んだマスの設定（§9.274） ----------
      種別・ラベルを出すか・寄せ・書式。**横/縦のマス数はここに出さない**
      ——盤のマスが既に持っており、同じ数を2箇所に置くと片方だけ直した状態が
      作れる（§CLAUDE 8）。
      **選んでも盤が動かない**（§9.227 ②）ように、器は常に置いて中身だけ
      入れ替える（選んでいないときは「マスを押してください」）。 */
   const drawInsp=()=>{
    const host=box.querySelector('.fb-insp');if(!host)return;
    host.hidden=false;
    const i=state.sel,r=(i!=null&&i>=0)?state.rows[i]:null;
    if(!r){
     host.innerHTML='<p class="fb-insp-empty">上のマスを押すと、'
      +'<b>種別・ラベル・寄せ・書式</b>をここで決められます。</p>';
     return;
    }
    const kinds=fbVocab().cellKinds;
    const aligns=fbVocab().aligns;
    const fmts=fbVocab().formatKinds;
    const f=r.format||{};
    const seg=(name,cur,list,attr)=>`<span class="fb-seg" role="group" aria-label="${esc(name)}">`
     +list.map(o=>`<button type="button" class="${String(o.v)===String(cur)?'is-on':''}"`
       +` ${attr}="${esc(String(o.v))}" aria-pressed="${String(o.v)===String(cur)?'true':'false'}">`
       +`${esc(o.label)}</button>`).join('')+'</span>';
    const who=r.kind===FB_KIND_BLANK?'空きマス'
      :(r.kind===FB_KIND_HEAD?`見出し「${r.label||'（文字なし）'}」`:(r.label||r.path));
    host.innerHTML=`<div class="fb-insp-head"><b>選んだマス</b>`
     +`<span class="fb-insp-who" title="${esc(r.path||'')}">${esc(who)}</span>`
     +`<span class="fb-insp-at">${i+1} / ${state.rows.length} マス目</span></div>`
     +`<div class="fb-insp-body">`
     +`<label class="fb-insp-row"><span>種別</span>${seg('種別',r.kind,kinds,'data-fb-kind')}</label>`
     +(r.kind===FB_KIND_VALUE
       ?`<label class="fb-insp-row"><span>ラベル</span>`
        +`<span class="fb-seg" role="group" aria-label="ラベル">`
        +`<button type="button" class="${r.showLabel!==false?'is-on':''}" data-fb-lab="1"`
        +` aria-pressed="${r.showLabel!==false?'true':'false'}">出す</button>`
        +`<button type="button" class="${r.showLabel===false?'is-on':''}" data-fb-lab="0"`
        +` aria-pressed="${r.showLabel===false?'true':'false'}">出さない</button></span>`
        +`<i class="fb-insp-note">表の軸で並べたときは、見出しと二重になるので「出さない」。</i></label>`
        /* ラベルと値の並べ方（§9.292 ⑤、利用者の指示「上下にラベルと内容が
           組み合わさるパターンでレイアウトできるように」）。
           **ラベルを出さないマスでは欄ごと出さない**——並べる相手が無いのに
           選ばせると、押しても何も起きない設定になる（§4）。 */
        +(r.showLabel!==false
          ?`<label class="fb-insp-row"><span>並べ方</span>`
           +`<span class="fb-seg" role="group" aria-label="ラベルと値の並べ方">`
           +`<button type="button" class="${r.stack?'':'is-on'}" data-fb-stack="0"`
           +` aria-pressed="${r.stack?'false':'true'}">横（ラベル：値）</button>`
           +`<button type="button" class="${r.stack?'is-on':''}" data-fb-stack="1"`
           +` aria-pressed="${r.stack?'true':'false'}">上下（ラベルの下に値）</button></span>`
           +`<i class="fb-insp-note">上下にすると、狭いマスでも値の幅を目いっぱい使えます。</i></label>`
          :'')
       :'')
     +`<label class="fb-insp-row"><span>寄せ</span>${seg('寄せ',r.align||'',aligns,'data-fb-align')}</label>`
     +(r.kind===FB_KIND_VALUE
       ?`<label class="fb-insp-row"><span>書式</span>${seg('書式',(f.kind||''),fmts,'data-fb-fmt')}</label>`
        +(f.kind==='number'
          ?`<label class="fb-insp-row"><span>小数の桁</span>`
           +`<input type="number" class="fb-fnum" data-fb-dec min="0" max="${FB_DECIMAL_MAX}"`
           +` value="${f.decimals==null?'':esc(String(f.decimals))}" placeholder="そのまま">`
           +`<label class="fb-insp-chk"><input type="checkbox" data-fb-th`
           +`${f.thousands?' checked':''}> 3桁区切り</label></label>`
          :'')
        +(f.kind==='datetime'
          ?`<label class="fb-insp-row"><span>日付の書式</span>`
           +`<input type="text" class="fb-ftext" data-fb-pat value="${esc(f.pattern||'')}"`
           +` list="fbDatePatterns" placeholder="yyyy/MM/dd">`
           +`<datalist id="fbDatePatterns">`
           +fbVocab().datePatterns.map(x=>`<option value="${esc(x)}">`).join('')+`</datalist>`
           +`<i class="fb-insp-note">yyyy 年／MM 月／dd 日／HH 時／mm 分。'文字'で囲むとそのまま出ます。</i></label>`
          :'')
        +(f.kind
          ?`<label class="fb-insp-row"><span>前後の文字</span>`
           +`<input type="text" class="fb-ftext" data-fb-pre value="${esc(f.prefix||'')}" placeholder="前" maxlength="16">`
           +`<input type="text" class="fb-ftext" data-fb-suf value="${esc(f.suffix||'')}" placeholder="後（単位など）" maxlength="16">`
           +`</label>`
          :'')
       :'')
     +`</div>`;
    const patch=o=>{Object.assign(state.rows[i],fbCell({...state.rows[i],...o}));sync();drawInsp()};
    host.querySelectorAll('[data-fb-kind]').forEach(b=>b.onclick=e=>{
     e.preventDefault();patch({kind:b.dataset.fbKind});
    });
    host.querySelectorAll('[data-fb-lab]').forEach(b=>b.onclick=e=>{
     e.preventDefault();patch({showLabel:b.dataset.fbLab==='1'});
    });
    host.querySelectorAll('[data-fb-stack]').forEach(b=>b.onclick=e=>{
     e.preventDefault();patch({stack:b.dataset.fbStack==='1'});
    });
    host.querySelectorAll('[data-fb-align]').forEach(b=>b.onclick=e=>{
     e.preventDefault();patch({align:b.dataset.fbAlign});
    });
    host.querySelectorAll('[data-fb-fmt]').forEach(b=>b.onclick=e=>{
     e.preventDefault();
     const k=b.dataset.fbFmt;
     patch({format:k?{...(state.rows[i].format||{}),kind:k}:null});
    });
    /* **打っている最中に組み直さない**（§9.117）——カーソルが飛ぶ。
       値だけ控えて隠し欄へ書き、器はそのままにする。 */
    const live=(sel,fn)=>{const el=host.querySelector(sel);if(!el)return;
     el.oninput=()=>{const c=state.rows[i];c.format=fbFormat(fn({...(c.format||{})},el));push();drawChosen()}};
    live('[data-fb-dec]',(f,el)=>({...f,decimals:el.value===''?null:Number(el.value)}));
    live('[data-fb-pat]',(f,el)=>({...f,pattern:el.value}));
    live('[data-fb-pre]',(f,el)=>({...f,prefix:el.value}));
    live('[data-fb-suf]',(f,el)=>({...f,suffix:el.value}));
    const th=host.querySelector('[data-fb-th]');
    if(th)th.onchange=()=>patch({format:{...(state.rows[i].format||{}),thousands:th.checked}});
   };
   const blank=box.querySelector('.fb-blank');
   if(blank)blank.onclick=()=>{state.rows.push(fbCell({kind:FB_KIND_BLANK}));state.sel=state.rows.length-1;sync()};
   const headBtn=box.querySelector('.fb-head');
   if(headBtn)headBtn.onclick=()=>{
    state.rows.push(fbCell({kind:FB_KIND_HEAD,label:''}));state.sel=state.rows.length-1;sync();
    /* 足したら**そこへ書ける状態にする**（§2「次にすることを1つだけ指す」）。 */
    const inp=box.querySelector(`.fb-row[data-fb-i="${state.sel}"] .fb-label`);
    if(inp)try{inp.focus()}catch(_){}
   };
   const tableBtn=box.querySelector('.fb-table');
   if(tableBtn)tableBtn.onclick=()=>fbMakeTable(box,state,sync);
   /* ---------- 軸の置き場を見せる（§9.277、利用者の指示） ----------
      「軸の位置と数がわかれば表の形状がわからずに最終形の出力に困らない」

      **押せるのに何も起きないボタンを残さない**（§4）ので、組める材料が
      揃っていないときは押せなくして理由を出す。そのうえで、
      **いまどの軸をどこへ置くのか**を帯に出す——出さないと「押せるから
      まだ組めていない」と読まれる（利用者の報告「何回でも『表に組む』
      ボタンを押せるので表に組める状態」がそれ）。 */
   const LOT_ONLY_ROW='対象（子ロット）は「行のいちばん外側」に固定です。'
     +'子ロットの数はロットごとに違うので、置けるのは1行ぶんの型だけ——'
     +'内側や列にすると型が飛び飛びになり、子ロットぶんに複製できません。';
   const drawTableBtn=()=>{
    const bar=box.querySelector('.fb-axes');
    const plan=fbTablePlan(box,state);
    if(tableBtn){
     /* **組めないなら押せなくして理由を出す**（§4）——置き方が決まって
        いないのに押せると、押しても何も起きないボタンになる。直し方は
        帯の箱なので、**帯は出したまま**にする。 */
     tableBtn.disabled=!!plan.err;
     tableBtn.title=plan.err
       ? String(plan.err).replace(/<[^>]*>/g,'')
       : String(fbPlanText(plan)).replace(/<[^>]*>/g,'')+' で組み直します';
    }
    if(!bar)return;
    const place=plan.place||[];
    if(!place.length){bar.hidden=true;bar.innerHTML='';return}
    bar.hidden=false;
    /* 軸の札。**掴んで動かせるが、押しても動く**（§9.247 ①と同じ作法）
       ——掴めない環境（触る画面・キーボード）で置き場を変える道を残す。 */
    const chip=a=>{
     const other=a.at===FB_AXIS_ROW?FB_AXIS_COL:FB_AXIS_ROW;
     return '<span class="fb-axis'+(a.fixed?' is-fixed':'')+'"'
      +(a.fixed?'':' draggable="true"')+' data-fb-axis="'+esc(a.name)+'"'
      +' data-fb-at="'+esc(a.at)+'">'
      +'<i class="fb-axis-grip" aria-hidden="true">⠿</i>'
      +'<b>'+esc(a.name)+'</b>'
      +'<small>'+(a.lot?(a.grand?'全体＋子ロットぶん':'子ロットぶん')
                      :esc((a.values||[]).join('・')))+'</small>'
      +'<button type="button" class="fb-axis-move" data-fb-move="'+esc(a.name)+'"'
      +' data-fb-to="'+esc(other)+'"'
      +(a.fixed?' disabled title="'+esc(LOT_ONLY_ROW)+'"'
               :' title="'+esc(other+'へ移す')+'"')
      +'>'+esc(other)+'へ</button></span>';
    };
    const boxes=FB_AXIS_SIDES.map(at=>{
     const mine=place.filter(a=>a.at===at);
     return '<div class="fb-axbox'+(mine.length?'':' is-empty')+'" data-fb-box="'+esc(at)+'">'
      +'<b class="fb-axbox-cap">'+esc(at)+'</b>'
      +'<span class="fb-axbox-list">'
      +(mine.length?mine.map(chip).join('')
        :'<em class="fb-axbox-none">ここへ軸を落とすと'+esc(at)+'になります</em>')
      +'</span></div>';
    }).join('');
    /* 総計（§9.278）。**出せる軸にだけ欄を出し、出せない軸は理由を書く**
       ——押しても数が変わらない欄を並べない（§4）。 */
    const tot=place.filter(a=>a.totalable);
    const opt='<div class="fb-axes-opt">'
     +(tot.length
       ?tot.map(a=>'<label class="fb-axes-chk"><input type="checkbox" data-fb-grand="'
         +esc(a.name)+'"'+(a.grand?' checked':'')+'> <span>「'+esc(FB_LOT_WHOLE)
         +'」の'+esc(a.at)+'を出す（総計）</span></label>').join('')
       :'<span class="fb-axes-note" title="いまの軸（項目・集計）はMINとMAXのように'
         +'足し合わせても意味のある数にならないので、小計・総計を出せません。'
         +'子ロットごとに繰り返す塊にすると「対象」の軸が生え、その総計＝'
         +'ロット全体を出せます。">小計・総計は出せません（理由）</span>')
     +'<label class="fb-axes-chk"><input type="checkbox" data-fb-replab'
     +(state.repeatLabel?' checked':'')+'> <span>ラベルを毎行くり返す</span></label>'
     +'</div>';
    bar.innerHTML='<i class="fb-axes-cap">軸の置き場</i>'
     +'<div class="fb-axboxes">'+boxes+'</div>'+opt
     +'<span class="fb-axes-now">'+(plan.err
        ? '<em class="fb-axes-bad">'+plan.err+'</em>'
        : 'この形で組みます: '+fbPlanText(plan))+'</span>';
    const moveTo=(name,at,before)=>{
     /* いまの並びを取り出してから動かす（**触っていない軸も並びへ焼き付ける**
        ——焼かないと、1つ動かした拍子に他の軸が既定へ戻る）。 */
     const cur={};FB_AXIS_SIDES.forEach(s=>cur[s]=place.filter(a=>a.at===s).map(a=>a.name));
     FB_AXIS_SIDES.forEach(s=>cur[s]=cur[s].filter(n=>n!==name));
     const list=cur[at];
     const i=before?list.indexOf(before):-1;
     if(i<0)list.push(name);else list.splice(i,0,name);
     state.axes=cur;
     drawTableBtn();
    };
    bar.querySelectorAll('[data-fb-move]').forEach(b=>b.onclick=e=>{
     e.preventDefault();e.stopPropagation();
     if(b.disabled)return;
     moveTo(b.dataset.fbMove,b.dataset.fbTo,null);
    });
    /* ---- 掴んで動かす（§9.278）---- */
    bar.querySelectorAll('.fb-axis[draggable="true"]').forEach(el=>{
     el.ondragstart=ev=>{
      state.axisDrag=el.dataset.fbAxis;
      try{ev.dataTransfer.setData('text/plain',el.dataset.fbAxis);
          ev.dataTransfer.effectAllowed='move'}catch(_e){}
      el.classList.add('is-dragging');
     };
     el.ondragend=()=>{state.axisDrag=null;el.classList.remove('is-dragging')};
    });
    bar.querySelectorAll('[data-fb-box]').forEach(bx=>{
     const at=bx.dataset.fbBox;
     bx.ondragover=ev=>{
      const n=state.axisDrag;if(!n)return;
      /* **対象は行だけ**——落とせない箱では受け付けず、そのことを見せる。 */
      const a=place.find(x=>x.name===n);
      if(a&&a.fixed&&at!==FB_AXIS_ROW){bx.classList.add('is-deny');return}
      ev.preventDefault();bx.classList.add('is-over');
     };
     bx.ondragleave=()=>bx.classList.remove('is-over','is-deny');
     bx.ondrop=ev=>{
      ev.preventDefault();bx.classList.remove('is-over','is-deny');
      const n=state.axisDrag;if(!n)return;
      const a=place.find(x=>x.name===n);
      if(a&&a.fixed&&at!==FB_AXIS_ROW)return;
      /* 落とした位置＝カーソルの右にある札の**手前**（§9.199と同じ数え方）。 */
      let before=null;
      [...bx.querySelectorAll('.fb-axis')].forEach(el=>{
       if(before||el.dataset.fbAxis===n)return;
       const r=el.getBoundingClientRect();
       if(ev.clientX<r.left+r.width/2)before=el.dataset.fbAxis;
      });
      moveTo(n,at,before);
     };
    });
    bar.querySelectorAll('[data-fb-grand]').forEach(c=>c.onchange=()=>{
     state.grand=Object.assign({},state.grand||{},{[c.dataset.fbGrand]:c.checked});
     drawTableBtn();
    });
    const rl=bar.querySelector('[data-fb-replab]');
    if(rl)rl.onchange=()=>{state.repeatLabel=rl.checked;drawTableBtn()};
   };
   /* 「内訳の列数」を欄から直したときも枠を組み直す（同じ数の2つの入口が
      食い違わないように）。 */
   const ci=colsInput();
   if(ci&&!ci.dataset.fbWired){ci.dataset.fbWired='1';ci.addEventListener('change',()=>{drawCols();drawChosen()})}
   /* 繰り返しを切り替えたら軸の帯を描き直す（§9.277）——「対象（子ロット）」の
      軸は**候補の項目ではなく塊の設定から生える**ので、切り替えたときに
      描き直さないと**軸がいつまでも現れない**（利用者から見れば「子ロット
      ごとにしたのに表に組めない」）。欄は別の段（③）にあり、その段を触っても
      ②の盤は組み直されないので、`change`を1つ拾う。 */
   const rpf=(box.closest('form')||document)
     .querySelector('[data-field="repeatText"],[data-field="repeat"]');
   if(rpf&&!rpf.dataset.fbWired){rpf.dataset.fbWired='1';
    rpf.addEventListener('change',()=>drawTableBtn())}
   const search=box.querySelector('.fb-search');
   if(search)search.oninput=()=>{state.q=search.value;drawList()};
   const clr=box.querySelector('.fb-clear');
   if(clr)clr.onclick=()=>{state.rows=[];sync()};
   /* ---------- ラベルと値をまとめて上下／横へ（§9.292 ⑤、利用者の指示） ----------
      「帳票ブロックマスタを組み立てていくと、ラベルと内容が横並びになった
       状態でレイアウトされますが、上下のパターンも欲しいです」

      **設定はマスの`stack`1つだけ**で、これはそこへ同じ値を書く操作
      （「既定の中身を写す」と同じ立ち位置。設定を2つ持たない・§9.207）。
      **ラベルを出していないマスは触らない**——並べる相手が無い。
      **いまどちらかをボタンが名乗る**（§CLAUDE 2・§3）。
      **触れるマスが1つも無ければ押せなくして理由を書く**（§4）。 */
   const stackBtn=box.querySelector('.fb-stack');
   const stackable=()=>state.rows.filter(r=>r.kind===FB_KIND_VALUE&&r.showLabel!==false);
   const drawStackBtn=drawStackRef.fn=()=>{
    if(!stackBtn)return;
    const t=stackable();
    const on=t.length>0&&t.every(r=>r.stack);
    stackBtn.disabled=!t.length;
    stackBtn.textContent=on?'ラベルを横に':'ラベルを上下に';
    stackBtn.title=!t.length
      ?'ラベルを出しているマスがありません（見出し・空き・「ラベル出さない」のマスには並べ方がありません）。'
      :(on?`いま ${t.length}マスが「上下」です。押すと「横（ラベル：値）」へ戻します。`
          :`ラベルを出している ${t.length}マスを、まとめて「上下（ラベルの下に値）」にします。`);
   };
   if(stackBtn)stackBtn.onclick=()=>{
    const t=stackable();if(!t.length)return;
    const on=t.every(r=>r.stack);
    state.rows=state.rows.map(r=>fbCell({...r,stack:(r.kind===FB_KIND_VALUE&&r.showLabel!==false)?!on:false}));
    sync();
   };
   /* ---------- 既定の中身を写す（§9.285 ②、利用者の指示） ----------
      「汎用化できていない部分を汎用表現を追加し編集可能範囲に取り込む」

      `寸法（オーダー／製造）`のようにコードが表を組み立てている塊は、
      `[内容]`が空のあいだは今までどおりコードの中身で刷られる（§9.278）。
      そこを触りたいとき、**白紙から組み直させると、いま見えている形が
      押した瞬間に消えたように見える**（§9.259の「共通を写してから個人へ」と
      同じ理由）。ここが**いま紙に出ているのと同じ並び**を入れる。

      **並びも列数もサーバーが答える**（§9.163）ので、画面は入れるだけ。
      **写せない塊ではボタンごと出さない**（§4）。 */
   const seed=box.querySelector('.fb-seed');
   const seedOf=()=>{
    const key=String((maintState.editing||{}).builtin||'').trim();
    return key?(fbVocab().defaultCells||{})[key]||null:null;
   };
   const drawSeed=drawSeedRef.fn=()=>{
    if(!seed)return;
    const d=seedOf();
    seed.hidden=!d;
    if(!d)return;
    /* **何が起きるかをボタンが名乗る**（§CLAUDE 2）——「写す」だけでは
       いまの並びが消えるのかどうかが読めない。 */
    /* **短く**（§9.234 ①）——帯は列数の札と並ぶので、長い文言を入れると
       器が足りずに縦書きへ折り返す（実機のキャプチャで確認）。全文は`title`。 */
    seed.textContent=state.rows.length?'既定へ戻す':'既定を写す';
    seed.title=state.rows.length
      ?'いま並べているマスを捨てて、画面がもともと持っている中身と同じ並びに戻します。'
      :'画面がもともと持っている中身と同じ並びを入れます。ここから1マスずつ直せます。';
   };
   if(seed)seed.onclick=()=>{
    const d=seedOf();if(!d)return;
    if(state.rows.length&&!confirm('いま並べているマスを捨てて、既定の中身に戻します。よろしいですか。'))return;
    state.rows=fbParse(d.content||'');
    /* **列数も一緒に入れる**——並びだけ写すと、既定は6列なのに欄が2列の
       ままで、写した瞬間に別の絵になる（§9.280と同じ食い違い）。 */
    const ci=colsInput();
    if(ci&&d.cols){ci.value=String(d.cols);ci.dispatchEvent(new Event('change',{bubbles:true}))}
    sync();
   };
   drawCols();drawChosen();drawList();drawInsp();drawTableBtn();drawSeed();
   /* 語彙（種別・寄せ・書式の呼び名）は候補と一緒に届く（§9.163）。
      **届いたら描き直すこと**——投げっぱなしにすると、設定欄が綴りのまま
      出たきり日本語にならない（§9.234 ⑧と同じ罠）。 */
   fbLoadCatalog().then(()=>{drawList();drawInsp();drawTableBtn();drawSeed()});
  });
 }
 /* --- 数値: 上下ボタン・3桁区切り・右づめ --- */
 function bindNumberFields(form){
  form.querySelectorAll('[data-num-wrap]').forEach(wrap=>{
   const input=wrap.querySelector('.mm-num-input');if(!input)return;
   const step=Number(input.dataset.step||1)||1;
   const min=input.dataset.min===undefined?null:Number(input.dataset.min);
   const max=input.dataset.max===undefined?null:Number(input.dataset.max);
   const clamp=n=>{
    if(min!=null&&n<min)n=min;
    if(max!=null&&n>max)n=max;
    return n;
   };
   // 桁区切りが入ったままだと打ち直せないので、編集中は素の数値に戻す。
   input.addEventListener('focus',()=>{input.value=numRaw(input.value);input.select()});
   input.addEventListener('blur',()=>{
    const raw=numRaw(input.value);
    if(raw===''){input.value='';return}
    const n=Number(raw);
    input.value=Number.isFinite(n)?numDisplay(clamp(n)):raw;
   });
   const bump=dir=>{
    const raw=numRaw(input.value);
    // 空欄から「＋」を1回押したら1目盛(step)になるのが素直。0を起点にする。
    const base=raw===''?0:Number(raw);
    const n=clamp((Number.isFinite(base)?base:0)+dir*step);
    // 小数のstepで 0.30000000000000004 のような値にしない
    const fixed=Number(n.toFixed(6));
    input.value=document.activeElement===input?String(fixed):numDisplay(fixed);
    input.dispatchEvent(new Event('input',{bubbles:true}));
   };
   wrap.querySelectorAll('[data-num-step]').forEach(btn=>{
    const dir=Number(btn.dataset.numStep)||1;
    // 押しっぱなしで連続増減(マウスだけで大きく動かせるように)
    let timer=null,repeat=null;
    const stop=()=>{clearTimeout(timer);clearInterval(repeat);timer=repeat=null};
    btn.addEventListener('pointerdown',ev=>{
     ev.preventDefault();bump(dir);
     timer=setTimeout(()=>{repeat=setInterval(()=>bump(dir),60)},400);
    });
    ['pointerup','pointerleave','pointercancel'].forEach(e=>btn.addEventListener(e,stop));
   });
   // 上下キーでも同じ操作(キーボード派の手も止めない)
   input.addEventListener('keydown',ev=>{
    if(ev.key==='ArrowUp'){ev.preventDefault();bump(1)}
    else if(ev.key==='ArrowDown'){ev.preventDefault();bump(-1)}
   });
  });
 }
 /* --- 日付: カレンダー入力 + 「今日」 --- */
 function bindDateFields(form){
  form.querySelectorAll('[data-date-today]').forEach(btn=>{
   btn.onclick=()=>{
    const input=form.querySelector(`[data-field="${btn.dataset.dateToday}"]`);
    if(!input)return;
    const d=new Date();
    input.value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    input.dispatchEvent(new Event('change',{bubbles:true}));
   };
  });
 }
 /* --- 別マスタ連動の選択欄 --- */
 const COMBO_NEW='__new__';
 function bindComboFields(form){
  form.querySelectorAll('[data-combo]').forEach(async field=>{
   const fk=field.dataset.combo;
   const sel=field.querySelector(`[data-combo-select="${fk}"]`);
   const hidden=field.querySelector(`[data-field="${fk}"]`);
   const newInput=field.querySelector(`[data-combo-new="${fk}"]`);
   if(!sel||!hidden)return;
   const current=String(hidden.value||'').trim();
   const names=await comboOptions({endpoint:field.dataset.comboEndpoint,valueKey:field.dataset.comboValuekey});
   // 既存データの値がマスタから消えていても選択肢に残す(選び直しを強要しない)
   const list=names.slice();
   if(current&&!list.includes(current))list.push(current);
   sel.innerHTML=`<option value="">（指定なし）</option>`
    +list.map(n=>`<option value="${esc(n)}"${n===current?' selected':''}>${esc(n)}</option>`).join('')
    +`<option value="${COMBO_NEW}">＋ 新しく追加…</option>`;
   const sync=()=>{
    if(sel.value===COMBO_NEW){
     newInput.hidden=false;hidden.value=String(newInput.value||'').trim();
    }else{
     newInput.hidden=true;newInput.value='';hidden.value=sel.value;
    }
   };
   sel.onchange=()=>{sync();if(sel.value===COMBO_NEW)newInput.focus()};
   newInput.oninput=()=>{hidden.value=String(newInput.value||'').trim()};
   sync();
  });
 }
 /* --- パス: サーバー側フォルダ参照 + ドラッグ&ドロップ --- */
 function bindPathFields(form){
  form.querySelectorAll('[data-path-browse]').forEach(btn=>{
   btn.onclick=async()=>{
    const input=form.querySelector(`[data-field="${btn.dataset.pathBrowse}"]`);
    if(!input)return;
    const picked=await openPathPicker({mode:btn.dataset.pathMode||'file',start:input.value});
    if(picked!=null){input.value=picked;input.dispatchEvent(new Event('change',{bubbles:true}))}
   };
  });
  form.querySelectorAll('[data-path-drop]').forEach(zone=>{
   const input=zone.querySelector('[data-field]');if(!input)return;
   const over=on=>zone.classList.toggle('is-dragover',on);
   zone.addEventListener('dragover',ev=>{ev.preventDefault();over(true)});
   zone.addEventListener('dragleave',()=>over(false));
   zone.addEventListener('drop',ev=>{
    ev.preventDefault();over(false);
    const path=pathFromDrop(ev.dataTransfer);
    if(path){input.value=path;input.dispatchEvent(new Event('change',{bubbles:true}));return}
    // ブラウザはセキュリティ上ファイルの完全パスを渡さないことがある。
    // 名前しか取れなかったときは黙って捨てず、参照ダイアログへ誘導する。
    const name=ev.dataTransfer.files&&ev.dataTransfer.files[0]&&ev.dataTransfer.files[0].name;
    showToast('パスを取得できませんでした',
      name?`「${name}」の完全なパスはブラウザからは読み取れませんでした。「参照…」から選んでください。`
          :'「参照…」ボタンから選んでください。',6000);
   });
  });
 }
 /* エクスプローラーからのドロップは text/uri-list か text/plain に
    file:///C:/... 形式で入ってくることが多い。files[0].pathはElectron等
    でしか使えないため、テキスト側を先に見る。 */
 function pathFromDrop(dt){
  if(!dt)return '';
  for(const type of ['text/uri-list','text/plain']){
   const raw=String(dt.getData(type)||'').split(/[\r\n]+/).find(s=>s&&!s.startsWith('#'));
   if(!raw)continue;
   if(/^file:\/\//i.test(raw)){
    try{
     let p=decodeURIComponent(raw.replace(/^file:\/\//i,''));
     // file://server/share/... はUNCなので先頭の\\を復元する
     if(/^\/[A-Za-z]:/.test(p))p=p.slice(1);
     else if(!/^\//.test(p))p='\\\\'+p;
     return p.replace(/\//g,'\\');
    }catch(e){/* 壊れたURIは無視 */}
   }
   if(/^[A-Za-z]:\\|^\\\\/.test(raw))return raw;
  }
  const f=dt.files&&dt.files[0];
  return (f&&f.path)?f.path:'';
 }

 /* ---------- パス参照ダイアログ(§9.49) ----------
    ブラウザのファイル選択はセキュリティ上、完全なパスを返さない(名前だけ)。
    このアプリはその端末自身で動くローカルサーバーなので、**サーバー側の
    ディレクトリ一覧**(/api/browse-path)を辿る形にすれば実際のパスが得られる。
    共有(UNC)も同じ経路で辿れるため、\\server\share\... もマウスだけで選べる。 */
 let pathPickerResolve=null;
 function ensurePathPicker(){
  let modal=$('#pathPickerModal');
  if(modal)return modal;
  modal=document.createElement('div');
  modal.className='record-modal';modal.id='pathPickerModal';modal.hidden=true;
  modal.innerHTML=`<div class="settings-dialog pathpick-dialog" role="dialog" aria-modal="true" aria-labelledby="pathPickerTitle">
    <header><div><h2 id="pathPickerTitle">場所を選択</h2></div>
     <button id="pathPickerClose" type="button" aria-label="閉じる">×</button></header>
    <div class="settings-body pathpick-body">
     <div class="pathpick-bar">
      <button type="button" id="pathPickerUp" class="mm-btn-ghost sm" title="1つ上の階層へ">↑ 上へ</button>
      <input id="pathPickerPath" type="text" spellcheck="false" autocomplete="off" aria-label="現在の場所">
      <button type="button" id="pathPickerGo" class="mm-btn-ghost sm">移動</button>
     </div>
     <div class="pathpick-places" id="pathPickerPlaces"></div>
     <div class="pathpick-list" id="pathPickerList"></div>
     <div class="pathpick-status" id="pathPickerStatus"></div>
     <div class="settings-actions">
      <button type="button" id="pathPickerCancel" class="mm-btn-ghost">キャンセル</button>
      <button type="button" id="pathPickerPick" class="mm-btn-primary">この場所を選択</button>
     </div>
    </div></div>`;
  document.body.append(modal);
  const close=v=>{modal.hidden=true;if(pathPickerResolve){pathPickerResolve(v);pathPickerResolve=null}};
  $('#pathPickerClose').onclick=()=>close(null);
  $('#pathPickerCancel').onclick=()=>close(null);
  $('#pathPickerPick').onclick=()=>close(String($('#pathPickerPath').value||''));
  WL.modal.keepOpen(modal);
  /* Escでも閉じる（§9.221 ①）。**選ばなかった**ことにするので`null`。 */
  document.addEventListener('keydown',e=>{
   if(WL.modal.escCloses(e)&&!modal.hidden){e.stopPropagation();close(null)}
  },true);
  return modal;
 }
 async function openPathPicker(opts){
  const modal=ensurePathPicker();
  const mode=opts&&opts.mode||'file';
  $('#pathPickerTitle').textContent=mode==='dir'?'フォルダを選択':'ファイルを選択';
  $('#pathPickerPick').textContent=mode==='dir'?'このフォルダを選択':'この場所を選択';
  modal.hidden=false;
  await browsePath(String(opts&&opts.start||''),mode);
  return new Promise(resolve=>{pathPickerResolve=resolve});
 }
 async function browsePath(path,mode){
  const list=$('#pathPickerList'),status=$('#pathPickerStatus');
  if(!list)return;
  list.innerHTML='<div class="pathpick-loading">読み込んでいます…</div>';
  let r;
  try{r=await api('/api/browse-path?path='+encodeURIComponent(path||''))}
  catch(e){list.innerHTML=`<div class="pathpick-error">${esc(e.message)}</div>`;return}
  $('#pathPickerPath').value=r.path||'';
  $('#pathPickerPlaces').innerHTML=(r.places||[]).map(p=>
    `<button type="button" class="pathpick-place" data-go="${esc(p.path)}" title="${esc(p.path)}">${esc(p.label)}</button>`).join('');
  const rows=(r.entries||[]).filter(e=>mode==='dir'?e.isDir:true);
  list.innerHTML=rows.length
   ? rows.map(e=>`<button type="button" class="pathpick-row${e.isDir?' is-dir':''}" data-name="${esc(e.name)}" data-dir="${e.isDir?1:0}" data-path="${esc(e.path)}">
        <span class="pathpick-icon">${e.isDir?'📁':'📄'}</span><span class="pathpick-name">${esc(e.name)}</span>
        <span class="pathpick-size">${e.isDir?'':esc(e.sizeText||'')}</span></button>`).join('')
   : '<div class="pathpick-empty">表示できる項目がありません。</div>';
  status.textContent=r.error?r.error:`${rows.length}件`;
  status.className='pathpick-status'+(r.error?' is-warn':'');
  $('#pathPickerUp').onclick=()=>browsePath(r.parent||'',mode);
  $('#pathPickerGo').onclick=()=>browsePath($('#pathPickerPath').value,mode);
  $('#pathPickerPath').onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();browsePath($('#pathPickerPath').value,mode)}};
  $('#pathPickerPlaces').querySelectorAll('[data-go]').forEach(b=>{b.onclick=()=>browsePath(b.dataset.go,mode)});
  list.querySelectorAll('.pathpick-row').forEach(b=>{
   // フォルダはクリックで潜る。ファイルはクリックで「その場所」として確定する。
   b.onclick=()=>{
    if(b.dataset.dir==='1')browsePath(b.dataset.path,mode);
    else $('#pathPickerPath').value=b.dataset.path;
   };
   b.ondblclick=()=>{if(b.dataset.dir!=='1'){$('#pathPickerPath').value=b.dataset.path;$('#pathPickerPick').click()}};
  });
 }

 // 作業可能設備タグ入力: フォーカスで登録済み設備をサジェスト、クリックで
 // 連続追加できるようにする（認識優先＝再入力不要、逐次追加を高速化）。
 // 送信時の互換性のため、選択状態は非表示チェックボックス(data-equipment-field)
 // で保持し、submitMaint()側の読み取りロジックは変更しない。
 function bindEquipmentPickers(form){
  form.querySelectorAll('[data-tagfield]').forEach(field=>{
   const fk=field.dataset.tagfield;
   const box=field.querySelector(`[data-equipment-box="${fk}"]`);
   const search=field.querySelector(`[data-equipment-search="${fk}"]`);
   const suggest=field.querySelector(`[data-equipment-suggest="${fk}"]`);
   if(!box||!search||!suggest)return;
   const opts=equipmentMasterState.items||[];
   const checkbox=name=>[...box.querySelectorAll(`[data-equipment-field="${fk}"]`)].find(b=>b.value===name);
   const selectedNames=()=>opts.filter(eq=>{const cb=checkbox(eq.name);return cb&&cb.checked}).map(eq=>eq.name);
   const setChecked=(name,val)=>{const cb=checkbox(name);if(cb)cb.checked=val};
   function renderTags(){
    box.querySelectorAll('.mm-tag').forEach(t=>t.remove());
    selectedNames().forEach(name=>{
     const tag=document.createElement('span');tag.className='mm-tag';
     tag.innerHTML=`${esc(name)}<button type="button" class="mm-tag-remove" aria-label="${esc(name)}を削除">×</button>`;
     tag.querySelector('.mm-tag-remove').onclick=ev=>{ev.stopPropagation();setChecked(name,false);renderTags();renderSuggest();search.focus()};
     box.insertBefore(tag,search);
    });
   }
   function renderSuggest(){
    const q=String(search.value||'').normalize('NFKC').toLowerCase().trim();
    const selected=new Set(selectedNames());
    const items=opts.filter(eq=>!selected.has(eq.name)&&(!q||eq.name.normalize('NFKC').toLowerCase().includes(q)));
    if(!items.length){suggest.innerHTML=`<div class="mm-tag-suggest-empty">${selected.size>=opts.length?'すべて選択済みです':'該当する設備がありません'}</div>`;return}
    suggest.innerHTML=items.map(eq=>`<button type="button" class="mm-tag-suggest-item" data-pick="${esc(eq.name)}">${esc(eq.name)}</button>`).join('');
    suggest.querySelectorAll('[data-pick]').forEach(btn=>{btn.onclick=ev=>{ev.stopPropagation();setChecked(btn.dataset.pick,true);search.value='';renderTags();renderSuggest();search.focus()}});
   }
   search.addEventListener('focus',()=>{renderSuggest();suggest.hidden=false});
   search.addEventListener('input',()=>{renderSuggest();suggest.hidden=false});
   search.addEventListener('keydown',ev=>{
    if(ev.key==='Backspace'&&!search.value){const names=selectedNames();if(names.length){setChecked(names[names.length-1],false);renderTags();renderSuggest()}}
    else if(ev.key==='Escape'){suggest.hidden=true;search.blur()}
    else if(ev.key==='Enter'){
     // このinputはフォーム内にあるため、既定動作のままだとEnterで
     // フォーム送信(登録・更新)が誤爆する。先頭の候補を追加する操作として扱う。
     ev.preventDefault();
     const first=suggest.querySelector('[data-pick]');
     if(first){setChecked(first.dataset.pick,true);search.value='';renderTags();renderSuggest()}
    }
   });
   search.addEventListener('blur',()=>{setTimeout(()=>{if(document.activeElement!==search)suggest.hidden=true},150)});
   box.addEventListener('mousedown',ev=>{if(ev.target===box){ev.preventDefault();search.focus()}});
   /* 「すべての設備」を選んでいるあいだは個別選択を触らせない。両方が
      効いているように見えると、どちらが保存されるのか分からなくなる。 */
   const all=field.querySelector(`[data-equipment-all="${fk}"]`);
   if(all){
    const syncAll=()=>{
     box.classList.toggle('is-disabled',all.checked);
     search.disabled=all.checked;
     if(all.checked)suggest.hidden=true;
    };
    all.addEventListener('change',syncAll);
    syncAll();
   }
   renderTags();
  });
 }

 function setMaintLoading(show,text){
  const dialog=$('#masterMaintPanel .mm-dialog');if(!dialog)return;
  let box=dialog.querySelector(':scope > .mm-loading');
  if(show){
   if(!box){box=document.createElement('div');box.className='mm-loading';box.innerHTML='<div class="mm-loading-box"><span class="mini-spinner"></span><b></b></div>';dialog.appendChild(box)}
   box.querySelector('b').textContent=text||'処理しています…';box.hidden=false;
  }else if(box){box.hidden=true}
 }
 /* 設備マスタの新規登録専用: 過去に削除(無効化)された同名設備があると
    サーバーはinactive_equipment_name_conflictで409を返す(選択の余地がある
    ため)。既存の確認モーダル(2択)をそのまま2段階連ねて選ばせ、共通
    コンポーネント自体には手を入れない。どちらもキャンセルした場合はnullを
    返し、呼び出し側(submitMaint)は何も表示せず処理を終える。 */
 async function registerEquipmentWithChoice(body){
  try{
   return await api('/api/equipment-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  }catch(e){
   if(e.code!=='inactive_equipment_name_conflict')throw e;
   const restore=await confirmModal({
    eyebrow:'設備マスタ',title:'過去に削除された設備名です',
    message:`「${body.name}」は過去に削除(無効化)された設備と同じ名前です。\n\n同じ設備として復元しますか？\n(これまでのスケジュール等の履歴はそのまま引き継がれます)`,
    confirmLabel:'同じ設備として復元',cancelLabel:'別の選択肢を見る'
   });
   if(restore)return api('/api/equipment-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,reuseExisting:true})});
   const asNew=await confirmModal({
    eyebrow:'設備マスタ',title:'別の新しい設備として登録しますか？',
    message:`「${body.name}」を、過去の設備とは別の新しい設備として登録します。\n\n過去の履歴は「${body.name}(旧…)」という名前へ切り離され、以後は新しい「${body.name}」の履歴として記録されます。`,
    confirmLabel:'新しい設備として登録'
   });
   if(!asNew)return null;
   return api('/api/equipment-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,reuseExisting:false})});
  }
 }
 /* rootSel: 入力欄を読む対象。インラインフォーム(#masterMaintForm)と
    編集モーダル(#maintEditorForm)のどちらからでも同じ処理で保存する。 */
 async function submitMaint(rootSel){
  const root=rootSel||'#masterMaintForm';
  const def=currentDef(),uid=requireMaintUser();if(uid===null)return;const editing=maintState.editing;
  const body={user_id:uid};let ok=true,firstMissing=null;
  if(editing)body.id=editing.id;
  def.fields.forEach(f=>{
   if(f.type==='equipment-multi'){body[f.k]=[...document.querySelectorAll(`${root} [data-equipment-field="${f.k}"]:checked`)].map(el=>el.value);return}
   if(f.type==='equipment-multi-text'){
    const all=document.querySelector(`${root} [data-equipment-all="${f.k}"]`);
    body[f.k]=all&&all.checked?EQUIPMENT_ALL
     :[...document.querySelectorAll(`${root} [data-equipment-field="${f.k}"]:checked`)].map(el=>el.value).join(',');
    // 必須のタグ欄(設備停止マスタの対象設備)は未選択で送らせない。素の入力欄と
    // 違い、空でも「未設定」として通ってしまうため、ここで同じ扱いに揃える。
    if(f.required&&!body[f.k]){ok=false;
     if(!firstMissing)firstMissing=document.querySelector(`${root} [data-equipment-all="${f.k}"]`);}
    return;
   }
   const el=$(`${root} [data-field="${f.k}"]`);
   // 数値欄は表示用の3桁区切りが入っているので、送る前に外す(§9.49)
   const v=f.type==='number'?numRaw(el?el.value:''):String(el?el.value:'').trim();
   if(f.required&&!v){ok=false;if(!firstMissing)firstMissing=el}
   body[f.k]=v;
  });
  if(!ok){
   /* **入っていない欄の段を開いてから断る**（§9.250 ④・§4）——段（タブ）に
      分けたので、畳んだ先の欄を「入れてください」と言われても、どこにあるのか
      分からない。開いてから知らせる。 */
   const form=document.querySelector(root);
   if(form&&firstMissing){
    mmRevealField(form,firstMissing);
    if(firstMissing.focus){try{firstMissing.focus()}catch(e){}}
   }
   showToast('入力を確認してください','必須項目が未入力です。',4000);return;
  }
  const endpoint=editing?def.endpoint+'/update':def.endpoint;
  try{
   setMaintLoading(true,editing?`${def.label}を更新しています…`:`${def.label}を登録しています…`);
   const r=(def.key==='equipment'&&!editing)?await registerEquipmentWithChoice(body):await api(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(r===null)return; // 設備の新規/復元どちらもキャンセルされた
   // 編集モーダルから保存した場合は閉じてから一覧を更新する(closeMaintEditor
   // 自身もrenderMaintListを呼ぶが、直後のloadMaintで最新データに置き換わる)。
   const modal=$('#maintEditorModal');
   if(modal&&!modal.hidden){modal.hidden=true}
   // 連動登録(§5.3.1)で相手のマスタが増えている可能性があるため、
   // 選択肢のキャッシュは毎回捨てる(次に開いたとき新しい分類が出る)。
   invalidateComboCache();
   /* 画面が覚えている写しも捨てる（§9.216／§9.217）——マスタで足した直後に
      その画面を開くのがふつうの順番なので、写しを持ったままだと
      「登録したのに出てこない」になる。**「あれば使う」で呼ぶこと**
      （読み込み順に依存させない）。 */
   if(def.key==='reportBlock')forgetReportCaches();
   if((def.key==='opItem'||def.key==='opChoice')&&window.WL&&WL.opData)WL.opData.forget();
   /* ロールを足した直後に異常位置判定を開くのがふつうの順番なので、
      控えを持ったままだと「登録したのに候補に出ない」になる（§9.241 ④）。 */
   if(def.key==='roll'&&window.WL&&WL.defect&&WL.defect.forgetRolls)WL.defect.forgetRolls();
   /* 生の表を触ったら件数の写しを捨てる（§9.249 ②）。持ったままだと
      「足したのに件数が増えない」になる。 */
   if(def.rawTable)mtState.loaded=false;
   /* **保存した行の群は開く**（§9.241 ①）——畳んだ設備へ足したとき、
      保存できたのに一覧に出ないのは「消えた」と読まれる。 */
   if(def.groupBy)mmOpenGroupOf(def,body[def.groupBy]);
   maintState.editing=null;await loadMaint(true);
   showToast&&showToast(def.label+(editing?'を更新しました':'を登録しました'),(r&&r.message)||'',3600);
  }catch(e){showToast&&showToast(editing?'更新できませんでした':'登録できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }
 /* 設備マスタの削除確認: docs/SCHEDULE_MODE_DESIGN.md §5.0.1のとおり、まず
    拒否して関連スケジュールデータの内訳を提示し、利用者が再確認のうえ
    明示的に選んだ場合のみforce:trueで再送する(削除してもスケジュール側の
    データ自体は一切書き換えない・履歴として残る)。 */
 function scheduleReferenceLabels(){
  return {pendingPlans:'未着手の作業予定',inProgressPlans:'着手中の作業予定',completedPlans:'完了済みの作業予定',
          calendarRows:'稼働カレンダー',stopReasonRows:'設備停止マスタ',loadFactorOverrideRows:'換算係数の手動上書き',
          fieldReorderTerminals:'現場段取り対象に設定中の端末'};
 }
 async function deleteEquipmentWithReferenceCheck(item,uid){
  try{
   setMaintLoading(true,'設備マスタを無効化しています…');
   await api('/api/equipment-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,user_id:uid})});
   return true;
  }catch(e){
   if(e.code!=='schedule_references_exist')throw e;
   setMaintLoading(false);
   const labels=scheduleReferenceLabels();
   const rows=Object.entries(e.references||{}).filter(([,v])=>v>0)
    .map(([k,v])=>`<tr class="${k==='inProgressPlans'?'eq-ref-warn':''}"><td>${esc(labels[k]||k)}</td><td>${v}件</td></tr>`).join('');
   const proceed=await confirmModal({
    eyebrow:'設備マスタ',title:'関連するスケジュールデータがあります',danger:true,
    bodyHtml:`<p class="confirm-modal-message">「${esc(item.name||'')}」には以下のスケジュールデータが関連しています。削除すると、これらは履歴として残りますが、今後この設備は仕掛一覧・スケジュール画面・現場段取りの選択肢から外れます。よろしいですか?</p>
     <table class="eq-ref-table"><tbody>${rows}</tbody></table>`,
    confirmLabel:'削除する',cancelLabel:'キャンセル'
   });
   if(!proceed)return false;
   setMaintLoading(true,'設備マスタを無効化しています…');
   await api('/api/equipment-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,user_id:uid,force:true})});
   return true;
  }finally{
   setMaintLoading(false);
  }
 }
 async function deleteMaint(item){
  const def=currentDef();if(!def.hasDelete)return;const uid=requireMaintUser();if(uid===null)return;
  const nm=item[def.cols[0].k]||item.name||'';
  if(def.key==='equipment'){
   try{
    const proceeded=await deleteEquipmentWithReferenceCheck(item,uid);
    if(!proceeded)return;
    if(maintState.editing&&maintState.editing.id===item.id)maintState.editing=null;
    await loadMaint(true);showToast&&showToast(def.label+'を無効化しました',nm,3600);
   }catch(e){showToast&&showToast('削除できませんでした',e.message,6500)}
   return;
  }
  /* **言い回しはdefが決める**（§9.249 ②）。有効フラグを持つマスタの削除は
     「無効化」だが、生の表は**本当に行が消える**——同じ文言で言うと嘘になる。 */
  const word=def.deleteWord||'無効化（削除）';
  if(!confirm(`${def.label}「${nm}」を${word}しますか？`))return;
  try{
   setMaintLoading(true,`${def.label}を${def.deleteWord||'無効化'}しています…`);
   await api(def.endpoint+'/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,user_id:uid})});
   /* **消したら写しも捨てる**（§9.274）——持ったままだと「消したのに紙に
      残っている」になる（足したときと同じ理由。§9.217）。 */
   if(def.key==='reportBlock')forgetReportCaches();
   if(maintState.editing&&maintState.editing.id===item.id)maintState.editing=null;
   await loadMaint(true);showToast&&showToast(def.label+'を'+(def.deleteWord||'無効化')+'しました',nm,3600);
  }catch(e){showToast&&showToast('削除できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }

 function fmtDT(v){if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?'-':d.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
 /* 横スクロールを出さないための列幅設計。
    - データ列は minmax(0,fr) で「入るだけ縮む」ようにする(以前は最小120pxが
      効いて、6列のアクセス権限マスタでは常に1100px超を要求し横スクロールが出た)。
    - 更新者・更新日時は監査用の副次情報。列数の多いマスタでは列として持たず、
      行のツールチップ(title)へ退避して主情報の幅を確保する。 */
 const MAINT_AUDIT_MAX_COLS=3;
 function maintShowsAudit(def){return (def.cols||[]).length<=MAINT_AUDIT_MAX_COLS}
 /* ================================================================
    一覧の並べ替えと列幅（§9.250 ⑥、利用者の指示）
    ----------------------------------------------------------------
    「マスタのデータが並べてある、よく使われている表は並び替え、列幅調整
      できるようにしてください。」

    ・**覚えるのはこの端末**（`MasterListViewV1`）。読み方の好みなので、
      共有マスタへ入れて全員を縛らない（§9.199の`childBadge`と同じ）。
    ・**列幅の掴み方は書き写さない**——`WL.columnWidthGrip`をそのまま呼ぶ
      （§9.164。仕掛一覧・データ一覧・実績と同じ手つきになる）。
    ・**触ったことは画面に出し、戻す手立てを同じ場所に置く**（§9.175）。
    ================================================================ */
 const MM_VIEW_KEY='MasterListViewV1';
 let mmViewPref=null;
 function mmView(){
  if(mmViewPref)return mmViewPref;
  try{mmViewPref=JSON.parse(localStorage.getItem(MM_VIEW_KEY)||'{}')||{}}catch(e){mmViewPref={}}
  return mmViewPref;
 }
 function mmViewOf(def){const v=mmView()[def.key];return v&&typeof v==='object'?v:{}}
 function mmViewSet(def,patch){
  const all=mmView();
  const cur=Object.assign({},all[def.key]||{},patch);
  if(!cur.sort&&!(cur.widths&&Object.keys(cur.widths).length))delete all[def.key];
  else all[def.key]=cur;
  try{localStorage.setItem(MM_VIEW_KEY,JSON.stringify(all))}catch(e){}
 }
 function mmViewTouched(def){
  const v=mmViewOf(def);
  return !!(v.sort||(v.widths&&Object.keys(v.widths).length));
 }
 /* 幅は**指定があるものだけ**px で固定し、残りは今までどおり割合で分ける
    （§9.119と同じ考え方。全部を px にすると器の広さに追随しなくなる）。 */
 function maintGridTemplate(def){
  const w=mmViewOf(def).widths||{};
  const data=def.cols.map(c=>w[c.k]?`${Math.round(w[c.k])}px`:`minmax(0,${c.grow||1}fr)`).join(' ');
  return maintShowsAudit(def)?`${data} 96px 128px 108px`:`${data} 108px`;
 }
 /* 並べ替えの物差し。**空欄は必ず最後**（向きを変えても最後）——空欄が
    先頭に集まると、探している行が画面の外へ押し出される（§9.187の
    「向きは塊の中の値だけを反転する」と同じ考え方を、小さく持つ）。
    数字は数として、それ以外は日本語の並びで比べる。 */
 function mmSortValue(it,col){
  const raw=it[col.k];
  const t=String(raw??'').trim();
  if(!t)return {empty:true,n:0,s:''};
  const n=Number(t.replace(/,/g,''));
  return {empty:false,n:Number.isFinite(n)?n:null,s:t.normalize('NFKC')};
 }
 function mmSortItems(def,items){
  const sort=mmViewOf(def).sort;
  if(!sort)return items;
  const col=(def.cols||[]).find(c=>c.k===sort.k);
  if(!col)return items;
  const dir=sort.dir==='desc'?-1:1;
  /* **安定に並べる**（同点は元の順のまま）。`Array.prototype.sort`は
     仕様上安定だが、比較が0を返さないと崩れるので明示的に添え字で解く。 */
  return items.map((it,i)=>({it,i})).sort((a,b)=>{
   const x=mmSortValue(a.it,col),y=mmSortValue(b.it,col);
   if(x.empty!==y.empty)return x.empty?1:-1;      // 空欄は向きによらず最後
   if(!x.empty){
    if(x.n!==null&&y.n!==null&&x.n!==y.n)return (x.n-y.n)*dir;
    if(x.s!==y.s)return x.s.localeCompare(y.s,'ja')*dir;
   }
   return a.i-b.i;
  }).map(x=>x.it);
 }
 function filteredMaintItems(def){
  const q=String(maintState.query||'').trim().normalize('NFKC').toLowerCase();
  let items=maintState.items||[];
  if(q)items=items.filter(it=>{const hay=[...def.cols.map(c=>it[c.k]),it.updated_by].map(v=>String(v??'').normalize('NFKC').toLowerCase()).join(' ');return hay.includes(q)});
  return mmSortItems(def,items);
 }
 /* ---------- 束ねた見出しの開閉（§9.241 ①、利用者の指示「ロールマスタに
    ついて、設備名毎に折りたためるようにしてください」） ----------
    ロールは設備ごとに何十本もあり、`groupBy`で束ねてはいたが**全部が出たまま**
    だったので、目的の設備へ着くまで他の設備を通り過ぎることになっていた。

    ・**畳んだ群の行は作らない**（§9.104）。`display:none`で隠すだけでは
      レイアウトから外れないので、行が増えるほど描き直しが重くなる。
    ・**覚えるのはこの端末**（読み方の好みなのでPCごとに違ってよい。§9.199の
      `childBadge`と同じ）。**触った群だけ**を覚え、触っていない群は既定
      （開く）に追随する——既定を変えないので、今までの見え方は変わらない。
    ・**絞り込み中は畳まない**——畳んだ群の中に当たりがあると、見出しの件数
      だけが出て行が1つも出ない（探しているのに出ない、が起きる）。
      そのことは画面に書く（§CLAUDE 2）。
    ・**登録・更新した行の群は開く**（§CLAUDE「思い出させない」）——畳んだ
      設備へ足したとき、保存できたのに一覧に出ないのは「消えた」と読まれる。 */
 const MM_FOLD_KEY='MasterListFoldV1';
 let mmFoldPref=new Map();
 try{mmFoldPref=new Map(Object.entries(JSON.parse(localStorage.getItem(MM_FOLD_KEY)||'{}')))}catch(e){}
 const mmFoldKey=(def,g)=>`${def.key}::${g}`;
 function mmFoldRemember(){try{localStorage.setItem(MM_FOLD_KEY,JSON.stringify(Object.fromEntries(mmFoldPref)))}catch(e){}}
 function mmIsFolded(def,g){return mmFoldPref.get(mmFoldKey(def,g))===true}
 function mmSetFolded(def,g,on){
  /* **開いた群は覚えない**（鍵ごと消す）——既定が「開く」なので、
     覚えると既定を変えたときに追随しなくなる。 */
  if(on)mmFoldPref.set(mmFoldKey(def,g),true);else mmFoldPref.delete(mmFoldKey(def,g));
  mmFoldRemember();
 }
 /* 束ねの見出し。**空を「すべての設備」と読み替えないこと**（§9.239 ⑥ 訂正）
    ——1行＝1設備になったので「すべて」という状態は無く、空は**設備が
    決まっていない直すべき行**。「すべての設備」と出すと、壊れている行が
    正常に見えて誰も直さない（§CLAUDE 4）。 */
 function maintGroupLabel(v){
  const t=String(v??'').trim();
  return t&&t!=='*'?t:'設備が未設定（この行を開いて設備を選んでください）';
 }
 /* 保存した行の群を開く。**畳みの鍵は見出しの文字**なので、生の値ではなく
    `maintGroupLabel()`を通してから消す（通さないと、設備が未設定の行を
    足したときに畳んだままになる）。 */
 function mmOpenGroupOf(def,rawValue){
  if(!def||!def.groupBy)return;
  mmSetFolded(def,maintGroupLabel(rawValue),false);
 }
 function maintGroupHeadEl(def,info){
  const h=document.createElement('div');
  h.className='mm-group-head'+(info.folded?' is-folded':'');
  h.setAttribute('role','button');h.tabIndex=0;
  h.setAttribute('aria-expanded',info.folded?'false':'true');
  h.dataset.mmGroup=info.label;
  /* **状態は色だけで伝えない**（§CLAUDE 3）——印(▸/▾)と一緒に、件数と
     「畳んでいます」を必ず文字で出す。 */
  h.innerHTML=`<i class="mm-group-mark" aria-hidden="true">${info.folded?'▸':'▾'}</i>`
   +`<b>${esc(info.label)}</b><span>${info.count}件</span>`
   +(info.folded?'<span class="mm-group-folded">畳んでいます（押すと開きます）</span>':'');
  h.title=info.folded
   ?`${info.label} の${def.label} ${info.count}件を畳んでいます。押すと開きます。`
   :`${info.label} に登録されている${def.label}です（${info.count}件）。押すと畳みます。`;
  const toggle=()=>{
   mmSetFolded(def,info.label,!info.folded);
   renderMaintList();
   /* 押した見出しを画面の中へ戻す。**上の群を畳むと下が巻き上がる**ので、
      戻さないと押した場所が視界から消える（何が起きたのか読めない）。
      見出しは作り直されているので、**同じ文字の見出しを引き直す**
      （属性セレクタは設備名に引用符が入ると壊れる）。 */
   const back=[...document.querySelectorAll('#masterMaintList .mm-group-head')]
    .find(el=>el.dataset.mmGroup===info.label);
   if(back)back.scrollIntoView({block:'nearest'});
  };
  h.onclick=toggle;
  h.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle()}};
  return h;
 }
 /* 一覧の上の「すべて開く／すべて畳む」。**群を持たないマスタでは帯ごと
    出さない**（押せるのに何も起きないボタンを置かない・§CLAUDE 4）。 */
 function renderMaintFoldTools(def,groups,searching){
  const box=$('#masterMaintFold');if(!box)return;
  if(!def.groupBy||!groups.length){box.hidden=true;box.innerHTML='';return}
  box.hidden=false;
  const open=groups.filter(g=>!g.folded).length;
  const allOpen=open===groups.length;
  box.innerHTML=`<b class="mm-fold-state">${groups.length}${esc(def.groupWord||'設備')}`
    +` <span>${searching?'絞り込み中は全部開きます':`開 ${open} / 畳 ${groups.length-open}`}</span></b>`
   +`<button type="button" class="mm-btn-ghost sm" data-mm-fold="open"${allOpen?' disabled':''}`
   +` title="${allOpen?'すべて開いています':'畳んでいる'+esc(def.groupWord||'設備')+'をすべて開きます'}">すべて開く</button>`
   +`<button type="button" class="mm-btn-ghost sm" data-mm-fold="close"${(searching||!open)?' disabled':''}`
   +` title="${searching?'絞り込み中は畳みません（当たった行が出なくなるため）'
      :(open?'見出しだけを残して行を畳みます':'すべて畳んでいます')}">すべて畳む</button>`;
  box.querySelectorAll('[data-mm-fold]').forEach(b=>b.onclick=()=>{
   const close=b.dataset.mmFold==='close';
   groups.forEach(g=>mmSetFolded(def,g.label,close));
   renderMaintList();
  });
 }
 function renderMaintList(){
  const def=currentDef(),list=$('#masterMaintList');if(!list)return;
  const all=maintState.items||[],items=filteredMaintItems(def),tmpl=maintGridTemplate(def);
  const cnt=$('#masterMaintCount');
  if(cnt){
   /* **覚えていることは画面に書き、忘れさせる手立ても同じ場所に置く**
      （§9.175・§9.250 ⑥）。黙って並べ替えたままだと「順番がおかしい」と
      読まれる。件数の隣に、いま効いている並びと戻すボタンを出す。 */
   const v=mmViewOf(def),sc=(def.cols||[]).find(c=>v.sort&&c.k===v.sort.k);
   const wn=Object.keys(v.widths||{}).length;
   const marks=[];
   if(sc)marks.push(`並び: ${esc(sc.label)} ${v.sort.dir==='desc'?'降順':'昇順'}`);
   if(wn)marks.push(`幅: ${wn}列`);
   cnt.innerHTML=(maintState.query?`${items.length} / 有効 ${all.length}件`:`有効 ${all.length}件`)
    +(marks.length?`<span class="mm-viewmark">${marks.map(esc).join('・')}`
      +`<button type="button" id="mmViewReset" title="この表の並びと列幅を既定へ戻します">✕</button></span>`:'');
   const rb=$('#mmViewReset');
   if(rb)rb.onclick=()=>{mmViewSet(def,{sort:null,widths:{}});renderMaintList()};
  }
  const showAudit=maintShowsAudit(def);
  /* 見出しは**押すと並べ替え・右端を引くと幅**（§9.250 ⑥）。
     いまの向きは矢印と`aria-sort`の両方で言う（色だけで伝えない・§CLAUDE 3）。 */
  const sort=mmViewOf(def).sort||null;
  const headCols=def.cols.map(c=>{
   const on=sort&&sort.k===c.k;
   const mark=on?(sort.dir==='desc'?'▼':'▲'):'';
   return `<span class="mm-th" data-col="${esc(c.k)}" role="button" tabindex="0"`
    +` aria-sort="${on?(sort.dir==='desc'?'descending':'ascending'):'none'}"`
    +` title="${esc(c.label)}｜押すと並べ替え（もう一度で逆順・3回目で元の並び）／右端を引くと幅が変わります">`
    +`<b>${esc(c.label)}</b>${mark?`<i class="mm-th-mark" aria-hidden="true">${mark}</i>`:''}`
    +`<i class="mm-th-grip" aria-hidden="true"></i></span>`;
  }).join('');
  list.innerHTML=`<div class="mm-row head" style="grid-template-columns:${tmpl}">${headCols}${showAudit?'<span>更新者</span><span>更新日時</span>':''}<span class="mm-act">操作</span></div>`;
  bindMaintHeadTools(def,list);
  if(!items.length){
   /* 行が無いときは開閉の帯も出さない（畳む対象が無いのにボタンだけ残ると、
      押せるのに何も起きない・§CLAUDE 4）。 */
   renderMaintFoldTools(def,[],false);
   list.insertAdjacentHTML('beforeend',`<div class="mm-empty">${all.length&&maintState.query?'絞り込み条件に一致するデータがありません。':'有効なデータがありません。上のフォームから追加してください。'}</div>`);return}
  const frag=document.createDocumentFragment();
  /* ---------- 親子で束ねる(§9.239 ⑥、利用者の指示) ----------
     「設備のカラムはマスタに親子関係を持たせ、設備単位でロールマスタを
      持つ形とする」。**マスタを2つに割らない**——所属を変えるのは
     `[対象設備]`を1つ直すだけで済む（割ると、移すために消して作り直す
     ことになる）。見出しには**件数を文字で**添える（§3）。
     `groupBy`を持たないマスタは今までどおり平らに並ぶ。 */
  const gkey=def.groupBy||'';
  let lastGroup=null,foldedNow=false;
  /* 群ごとの件数と畳み。**出てくる順のまま**並べる（並べ替えるとサーバーが
     返した順＝表示順の設定が効かなくなる）。**絞り込み中は畳まない**
     （§9.241 ①）——当たった行が出ないと、探しているのに無いと読まれる。 */
  const searching=!!String(maintState.query||'').trim();
  const groups=[],gidx={};
  if(gkey)items.forEach(it=>{
   const g=maintGroupLabel(it[gkey]);
   if(gidx[g]===undefined){gidx[g]=groups.length;groups.push({label:g,count:0,folded:false})}
   groups[gidx[g]].count++;
  });
  groups.forEach(g=>{g.folded=!searching&&mmIsFolded(def,g.label)});
  renderMaintFoldTools(def,groups,searching);
  items.forEach(it=>{
   if(gkey){
    const g=maintGroupLabel(it[gkey]);
    if(g!==lastGroup){
     lastGroup=g;
     const info=groups[gidx[g]];
     foldedNow=info.folded;
     frag.append(maintGroupHeadEl(def,info));
    }
    /* 畳んだ群の行は**作らない**（§9.104。隠すだけでは組み直しが重い）。 */
    if(foldedNow)return;
   }
   const row=document.createElement('div');row.className='mm-row'+(maintState.editing&&maintState.editing.id===it.id?' editing':'');row.style.gridTemplateColumns=tmpl;row.tabIndex=0;row.setAttribute('role','button');
   // 列として出さない監査情報(更新者・更新日時)は行のツールチップで補う。
   const audit=`更新者: ${it.updated_by||'-'} / 更新日時: ${fmtDT(it.updated_at)}`;
   row.title=showAudit?'クリックで編集フォームに読み込みます':`クリックで編集\n${audit}`;
   const cells=def.cols.map(c=>{const v=cellText({...c,row:it},it[c.k]);
    return `<span title="${esc(v)}">${esc(v)||'<em class="mm-blank">—</em>'}</span>`}).join('');
   const acts=def.readOnly?'<em class="mm-blank">—</em>'
     :`<button type="button" class="mm-edit" title="この行の内容を編集します">編集</button>${def.hasDelete?'<button type="button" class="mm-del" title="この行を削除します（確認画面が出ます）">削除</button>':''}`;
   row.innerHTML=`${cells}${showAudit?`<span class="mm-user" title="${esc(it.updated_by||'')}">${esc(it.updated_by||'-')}</span><span class="mm-date">${esc(fmtDT(it.updated_at))}</span>`:''}<span class="mm-act">${acts}</span>`;
   // 入力項目が多いマスタは編集専用モーダル、少ないマスタは従来どおり
   // 上部のインラインフォームへ読み込む(ARCHITECTURE.md「マスタ管理の画面形態」、defUsesEditorModal)。
   const edit=()=>{
    if(defUsesEditorModal(def)){openMaintEditor(it);return}
    maintState.editing=Object.assign({},it);renderMaintForm();
    const f=$('#masterMaintForm');if(f)f.scrollIntoView({block:'nearest'});
   };
   const eb=row.querySelector('.mm-edit');if(eb)eb.onclick=e=>{e.stopPropagation();edit()};
   const del=row.querySelector('.mm-del');if(del)del.onclick=e=>{e.stopPropagation();deleteMaint(it)};
   if(!def.readOnly){
    row.onclick=()=>edit();row.ondblclick=()=>edit();
    row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){if(e.key===' ')e.preventDefault();edit()}};
   }
   frag.append(row);
  });
  list.append(frag);
 }
 /* 見出しの配線（§9.250 ⑥）。**掴む道具は書き写さない**——列幅は
    `WL.columnWidthGrip`（§9.164）が「掴む→追う→離す→保存」を持っている。 */
 function bindMaintHeadTools(def,list){
  list.querySelectorAll('.mm-row.head>.mm-th').forEach(cell=>{
   const key=cell.dataset.col;
   const sortNow=()=>{
    const cur=mmViewOf(def).sort;
    /* 3回で一周する（昇順→降順→元の並び）。**戻す道を同じ場所に置く**
       ——別に「戻す」を作ると、押した本人が探すことになる（§CLAUDE 4）。 */
    const next=!cur||cur.k!==key?{k:key,dir:'asc'}
      :cur.dir==='asc'?{k:key,dir:'desc'}:null;
    mmViewSet(def,{sort:next});
    renderMaintList();
   };
   cell.addEventListener('click',e=>{
    if(e.target.closest('.mm-th-grip'))return;     // 取っ手は並べ替えに渡さない
    sortNow();
   });
   cell.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();sortNow()}
   });
   const grip=cell.querySelector('.mm-th-grip');
   if(!grip||typeof WL.columnWidthGrip!=='function')return;
   /* **今そこに在る見出しから測る**（§9.211 ①）——一覧は`innerHTML`ごと
      作り直されるので、綴じ込んだ`cell`はすぐ孤児になる。孤児は幅0で、
      掴んでも動かない。 */
   const liveCell=()=>document.querySelector(
     `#masterMaintList .mm-row.head>.mm-th[data-col="${CSS.escape(key)}"]`)||cell;
   WL.columnWidthGrip(grip,{
    startWidth:()=>liveCell().getBoundingClientRect().width,
    /* 引いている最中は**トラックだけ**入れ替える（行を作り直さない）。 */
    preview:w=>{
     const widths=Object.assign({},mmViewOf(def).widths||{},{[key]:w});
     const tmpl=(()=>{
      const data=def.cols.map(c=>widths[c.k]?`${Math.round(widths[c.k])}px`:`minmax(0,${c.grow||1}fr)`).join(' ');
      return maintShowsAudit(def)?`${data} 96px 128px 108px`:`${data} 108px`;
     })();
     document.querySelectorAll('#masterMaintList .mm-row').forEach(r=>r.style.gridTemplateColumns=tmpl);
    },
    commit:w=>{
     mmViewSet(def,{widths:Object.assign({},mmViewOf(def).widths||{},{[key]:w})});
     renderMaintList();
    },
   });
  });
 }
 function setMaintSearchVisible(show){
  const search=document.querySelector('#masterMaintPanel .mm-search');if(search)search.style.display=show?'':'none';
  const cnt=$('#masterMaintCount');if(cnt)cnt.style.display=show?'':'none';
 }
 // マスタは共有DBを読む種類があり数秒かかることがある。無反応に見えて
 // タブを連打されないよう、読み込みはWAITING表示で包む(records-store.jsの
 // withWaiting。速いときは出ないので通常の操作感は変わらない)。
 async function loadMaint(force){
  const def=currentDef();
  if(typeof withWaiting!=='function')return loadMaintInner(force);
  return withWaiting({title:def.label+'マスタを読み込んでいます',detail:'マスタDB: '+(def.endpoint||'-'),
   progress:'登録済みの内容を取得しています'},()=>loadMaintInner(force));
 }
 async function loadMaintInner(force){
  const def=currentDef();const title=$('#masterMaintTitle');
  /* 見出しは**その画面の呼び名**。「〜マスタ」を機械的に足すと
     「データ接続マスタ」のような読みにくい名前ができる。 */
  if(title)title.textContent=def.titleText||(def.label+'マスタ');
  // 設定ページ形式(パス設定・§9.68)はフォーム自体がスクロール領域になる。
  // タブを移ったら必ず外す(付いたままだと他のマスタで上部フォームが
  // 伸び縮みして一覧の高さが安定しない)。
  $('#masterMaintForm')?.classList.remove('mm-form-page');
  /* **器の高さを渡す印も必ず外す**（§9.222 ⑤。`mm-form-page`と同じ作法）。
     外し忘れると、他のマスタの一覧がスクロールしない枠になって行が切れる。 */
  const mList=$('#masterMaintList');
  if(mList){mList.classList.remove('is-fill');mList.parentElement?.classList.remove('is-fill')}
  if(def.special==='meas-storage'){setMaintSearchVisible(false);return loadMeasStorageMaint(force)}
  if(def.special==='import-backup'){setMaintSearchVisible(false);return loadImportBackupMaint(force)}
  if(def.special==='load-factor'){setMaintSearchVisible(false);return loadLoadFactorMaint(force)}
  if(def.special==='data-source'){setMaintSearchVisible(false);return loadDataSourceMaint(force)}
  if(def.special==='query-join'){setMaintSearchVisible(false);return loadQueryJoinMaint(force)}
  if(def.special==='path-config'){setMaintSearchVisible(false);return loadPathConfigMaint(force)}
  if(def.special==='shift-pattern'){setMaintSearchVisible(false);return loadShiftPatternMaint(force)}
  if(def.special==='op-item'){setMaintSearchVisible(false);return loadOpItemMaint(force)}
  if(def.special==='record-layout'){setMaintSearchVisible(false);return loadRecordLayoutMaint(force)}
  if(def.special==='report-layout'){setMaintSearchVisible(false);return loadReportLayoutMaint(force)}
  if(def.special==='op-choice'){setMaintSearchVisible(false);return loadOpChoiceMaint(force)}
  if(def.special==='cleanup'){setMaintSearchVisible(false);return loadCleanupMaint(force)}
  if(def.special==='raw-table'){setMaintSearchVisible(false);return loadRawTableMaint(force)}
  if(def.special==='presence'){setMaintSearchVisible(false);return loadPresenceMaint(force)}
  setMaintSearchVisible(true);
  const list=$('#masterMaintList');if(list&&force)list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  // 一覧に「作業可能設備」を文章で出すのは配列で持つequipment-multiだけ
  // (equipment-multi-textは保存値が文字列で、列側はformat:'equipmentTarget'が
  //  そのまま整形する。両方を拾うと使われない`〜Text`が生えるだけになる)。
  const multiField=def.fields.find(f=>f.type==='equipment-multi');
  const needsEquipmentMaster=multiField||def.fields.some(f=>f.type==='equipment-select'||f.type==='equipment-multi-text');
  // force未指定(キャッシュ利用)のままだと、設備マスタタブで新規登録・削除した
  // 直後でもオペレータ/設備停止タブの選択肢が古いままになる。loadMaint()の
  // forceをそのまま伝播し、タブを開き直すたびに最新の設備マスタを反映する。
  if(needsEquipmentMaster&&typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){/* 設備マスタが読めなくても一覧の表示は継続する */}}
  renderMaintForm();
  try{
   const r=await api(def.endpoint);let items=(r&&r.items)||[];
   if(multiField)items=items.map(it=>({...it,[multiField.k+'Text']:(Array.isArray(it[multiField.k])&&it[multiField.k].length)?it[multiField.k].join('、'):'（制限なし・全設備）'}));
   maintState.items=items;
   /* **語彙はサーバーだけが持つ**（§9.163）。GETの戻りの`items`以外の
      キー（ロールマスタの入出位置・接触面・駆動方式など）はここで控え、
      `master-suggest`の欄が候補として出す。画面へ写さないための1行。 */
   maintState.meta=r||{};
   renderMaintList();
  }catch(e){if(list)list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }

 /* ---------- 換算係数モデル(docs/SCHEDULE_MODE_DESIGN.md §6・§9.8) ----------
    因子×水準の一覧(自動算出値・N数・上書き値)は「自動算出＋上書き」の2層
    構造で汎用CRUDのフォームに載らないため、専用の描画を持つ特別扱いにする。 */
 let loadFactorState={equipment:'',configured:true,model:null,accuracy:null};
 function loadFactorBasisLabel(b){return {equipment:'自設備の実績',pooled:'全設備プール(自設備は実績不足)',default:'算出不可(実績なし)'}[b]||b||'-'}
 function fmtLfMinutes(min){if(min===null||min===undefined)return '-';const v=Math.round(min);if(v<60)return `${v}分`;return `${Math.floor(v/60)}時間${v%60?(v%60)+'分':''}`}
 async function loadLoadFactorMaint(force){
  const list=$('#masterMaintList');if(!list)return;
  if(typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){/* 設備マスタが読めなくても画面表示は継続する */}}
  const opts=equipmentMasterState.items||[];
  if(!loadFactorState.equipment&&opts.length)loadFactorState.equipment=opts[0].name;
  renderLoadFactorForm();
  if(!loadFactorState.equipment){list.innerHTML='<div class="mm-empty">設備マスタが未登録です。先に「設備」タブで登録してください。</div>';return}
  list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const [lf,acc]=await Promise.all([
    api('/api/schedule/load-factors?equipment='+encodeURIComponent(loadFactorState.equipment)),
    api('/api/schedule/accuracy?equipment='+encodeURIComponent(loadFactorState.equipment)).catch(()=>null),
   ]);
   loadFactorState.configured=!!(lf&&lf.configured);
   loadFactorState.model=loadFactorState.configured?lf.model:null;
   loadFactorState.accuracy=acc;
   renderLoadFactorList();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 function renderLoadFactorForm(){
  const form=$('#masterMaintForm');if(!form)return;
  const opts=equipmentMasterState.items||[];
  const optHtml=opts.map(eq=>`<option value="${esc(eq.name)}"${eq.name===loadFactorState.equipment?' selected':''}>${esc(eq.name)}</option>`).join('');
  form.innerHTML=`<div class="mm-form-head"><span class="mm-mode-chip new">換算係数モデル</span></div>
   <div class="mm-cd-toolbar">
    <div class="mm-cd-dbtabs"><select id="mmLfEquipment">${optHtml||'<option value="">設備マスタが未登録です</option>'}</select></div>
    <div class="mm-cd-actions"><button type="button" id="mmLfRecalc" class="mm-btn-ghost sm">再計算</button></div>
   </div>
   <p class="mm-form-hint">因子ごとの自動算出係数(§6)と手動上書きです。係数を入力して保存すると上書きが有効になり、空欄で保存すると解除されます。「BASE」行は基準時間T0(1件あたりの基準所要分)自体を分単位で上書きします。</p>`;
  form.onsubmit=ev=>ev.preventDefault();
  const sel=$('#mmLfEquipment');
  if(sel)sel.onchange=()=>{loadFactorState.equipment=sel.value;loadLoadFactorMaint(false)};
  const recalc=$('#mmLfRecalc');
  if(recalc)recalc.onclick=async()=>{
   const uid=requireMaintUser();if(uid===null)return;
   try{
    setMaintLoading(true,'再計算しています…');
    await api('/api/schedule/load-factors/recalc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({equipment:loadFactorState.equipment,user_id:uid})});
    await loadLoadFactorMaint(true);
    showToast&&showToast('再計算しました','',3200);
   }catch(e){showToast&&showToast('再計算できませんでした',e.message,6500)}
   finally{setMaintLoading(false)}
  };
 }
 function renderLoadFactorList(){
  const list=$('#masterMaintList');if(!list)return;
  if(!loadFactorState.configured){list.innerHTML='<div class="mm-empty">スケジュール機能が設定されていません(config/local.jsonのschedule_share_path未設定)。</div>';return}
  const model=loadFactorState.model;
  if(!model){list.innerHTML='<div class="mm-empty">この設備の完了実績がまだ無く、係数を算出できません。</div>';return}
  const acc=loadFactorState.accuracy;
  const baseOv=(model.overrides||[]).find(o=>o.factor==='BASE');
  const summary=`<div class="lf-summary">
   <div><small>基準</small><b>${esc(loadFactorBasisLabel(model.basis))}</b></div>
   <div><small>基準時間T0</small><b>${fmtLfMinutes(model.T0)}</b>${baseOv?`<span class="lf-override-note">→ 上書き適用中: ${fmtLfMinutes(baseOv.coefficient)}</span>`:''}</div>
   <div><small>実績件数</small><b>${model.n}件${model.excluded?`(外れ値${model.excluded}件除外)`:''}</b></div>
   <div><small>ばらつき(σ)</small><b>${model.sigmaLog!=null?model.sigmaLog:'-'}</b></div>
   ${acc&&acc.n?`<div><small>精度: 中央値バイアス</small><b>${acc.medianLogBias>0?'+':''}${acc.medianLogBias}</b></div>
   <div><small>精度: MAPE相当</small><b>${Math.round((acc.mape||0)*100)}%(n=${acc.n})</b></div>`:''}
  </div>`;
  const overrideMap={};
  (model.overrides||[]).forEach(o=>{overrideMap[o.factor+'\u0000'+(o.level||'')]=o});
  const baseOverride=overrideMap['BASE\u0000'];
  const baseRow=`<div class="lf-row lf-row-base">
   <span class="lf-row-key">BASE</span><span class="lf-row-level">基準時間T0</span>
   <span class="lf-row-value">${fmtLfMinutes(model.T0)}</span><span class="lf-row-n">n=${model.n}</span>
   <span class="lf-row-override"><input type="number" step="0.1" min="0" placeholder="分で上書き" data-lf-factor="BASE" data-lf-level="" value="${baseOverride?baseOverride.coefficient:''}"></span>
   <span class="lf-row-actions"><button type="button" class="mm-btn-ghost sm" data-lf-save="BASE|">保存</button>${baseOverride?'<button type="button" class="mm-btn-ghost sm" data-lf-clear="BASE|">解除</button>':''}</span>
  </div>`;
  const factorRows=(model.factors||[]).map(f=>{
   const ov=overrideMap[f.key+'\u0000'+f.level];
   return `<div class="lf-row">
    <span class="lf-row-key">${esc(f.key)}</span><span class="lf-row-level">${esc(f.level)}</span>
    <span class="lf-row-value">×${f.value}</span><span class="lf-row-n">n=${f.n}</span>
    <span class="lf-row-override"><input type="number" step="0.01" min="0" placeholder="係数で上書き" data-lf-factor="${esc(f.key)}" data-lf-level="${esc(f.level)}" value="${ov?ov.coefficient:''}"></span>
    <span class="lf-row-actions"><button type="button" class="mm-btn-ghost sm" data-lf-save="${esc(f.key)}|${esc(f.level)}">保存</button>${ov?`<button type="button" class="mm-btn-ghost sm" data-lf-clear="${esc(f.key)}|${esc(f.level)}">解除</button>`:''}</span>
   </div>`;
  }).join('');
  list.innerHTML=`${summary}
   <div class="lf-table">
    <div class="lf-row lf-row-head"><span>因子</span><span>水準</span><span>係数</span><span>N</span><span>手動上書き</span><span></span></div>
    ${baseRow}
    ${factorRows||'<div class="mm-empty">この設備には因子(水準)がありません。</div>'}
   </div>`;
  list.querySelectorAll('[data-lf-save]').forEach(btn=>btn.onclick=()=>saveLoadFactorOverride(btn.dataset.lfSave,false));
  list.querySelectorAll('[data-lf-clear]').forEach(btn=>btn.onclick=()=>saveLoadFactorOverride(btn.dataset.lfClear,true));
 }
 async function saveLoadFactorOverride(key,clear){
  const uid=requireMaintUser();if(uid===null)return;
  const [factor,level]=key.split('|');
  let coefficient=null;
  if(!clear){
   const input=document.querySelector(`[data-lf-factor="${CSS.escape(factor)}"][data-lf-level="${CSS.escape(level)}"]`);
   const raw=input?String(input.value).trim():'';
   if(!raw){showToast&&showToast('係数(またはBASEは分)を入力してください','',3200);return}
   coefficient=Number(raw);
   if(!Number.isFinite(coefficient)){showToast&&showToast('数値を入力してください','',3200);return}
  }
  try{
   setMaintLoading(true,clear?'解除しています…':'保存しています…');
   await api('/api/schedule/load-factors/override',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({equipment:loadFactorState.equipment,factor,level,coefficient,user_id:uid})});
   await loadLoadFactorMaint(true);
   showToast&&showToast(clear?'上書きを解除しました':'上書きを保存しました','',3200);
  }catch(e){showToast&&showToast('保存できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }
 /* ---------- 測定データの保存(§9.202、利用者の指示) ----------
    「入力したのに完了へ反映されない」「測定バックアップの設定部分が無い」
    「『DBに同期』の使い方が分からない」は、**3つの置き場の関係が
    どこにも書かれていない**ことが元だった。ここで1枚にまとめる。

     ① この端末のブラウザ (IndexedDB＋localStorageの控え)
        …入力の実体。**「保存」を押すまで入らない**（打っている最中は
          画面の中だけ）。この端末を替えると見えない。
     ② この端末のDB       (db/records.sqlite3)
        …①を保存するたびに自動で送る。**他のPCから続きを開けるのはここ**。
     ③ 閲覧用の複製       (Box等・読むだけ)
        …②が変わったら間隔ごとに丸ごと写す。閲覧モードはここを読む。

    守っていること:
     ・**流れの順に左から右**へ置く（視覚導線と作業導線を一致させる。§14）
     ・**いま何件どこにあるか**を数字で出す。数えられなければ「—」にして
       0件と言い切らない（§9.107と同じ約束）
     ・**次にすることを1つだけ指す**（未送信があるときだけ「今すぐ送る」を
       強調する。§2）
     ・設定はこの画面だけが持つ（共通設定からは移動した。§9.168） */
 let measStorageState={loaded:false,server:null,local:null,err:''};
 async function loadMeasStorageMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&measStorageState.loaded){renderMeasStorage();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">測定データの置き場を調べています…</div>';
  try{
   /* ①はブラウザの中なのでサーバーからは見えない。**画面側が数える**。
      読めなくても画面は出す（数えられなかったことを書く）。 */
   const [srv,cfg,localItems]=await Promise.all([
    api('/api/measurement/storage'),
    api('/api/path-config-master'),
    (typeof reliableAll==='function'?reliableAll():Promise.resolve(null)).catch(()=>null),
   ]);
   measStorageState.server=srv;
   measStorageState.cfg=cfg;
   measStorageState.local=localItems;
   measStorageState.loaded=true;measStorageState.err='';
   renderMeasStorage();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 function msNum(n){return (n===null||n===undefined)?'—':String(n)}
 function msWhen(v){
  if(!v)return '—';
  const t=typeof v==='number'?v*1000:Date.parse(String(v).replace(' ','T'));
  if(!Number.isFinite(t))return String(v);
  const min=Math.round((Date.now()-t)/60000);
  const stamp=new Date(t).toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  if(min<1)return `${stamp}（たった今）`;
  if(min<60)return `${stamp}（${min}分前）`;
  return `${stamp}（${Math.round(min/60)}時間前）`;
 }
 /* 閲覧が手元の写しから読めているか（§9.268）。**「写している」だけでなく、
    実物のまま読んでいる本数も出す**——写しがまだ無いあいだは実物を読む
    （fail-open）ので、そこを黙ると「もう写しから読んでいる」と誤解される。 */
 function msMirrorText(m){
  if(!m)return '—';
  if(m.enabled===null)return '確かめられません';
  if(m.enabled===false)return '共有を直接読む（写しは無効）';
  const mins=Math.max(1,Math.round(Number(m.intervalSec||60)/60));
  if(!m.mirrored)return `写しの用意中（あと${mins}分以内）`;
  return `写し${m.mirrored}本`+(m.direct?` ／ 実物${m.direct}本`:'');
 }
 function msSize(n){return (n===null||n===undefined)?'—':(n/1048576).toFixed(1)+'MB'}
 function renderMeasStorage(){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  const srv=measStorageState.server||{},exp=srv.export||{},loc=srv.local||{};
  const items=measStorageState.local;
  const draft=items?items.filter(x=>x.status!=='完了').length:null;
  const done=items?items.filter(x=>x.status==='完了').length:null;
  const unsent=items?items.filter(x=>(x.syncState&&x.syncState.status)!=='synced').length:null;
  const v=(measStorageState.cfg&&measStorageState.cfg.values)||{};
  const interval=Number(exp.intervalSec||600);
  const mins=Math.max(1,Math.round(interval/60));
  /* 次にすること。**1つだけ指す**(§2)。 */
  const next=unsent
   ?`この端末に<b>まだ②へ送っていないデータが${unsent}件</b>あります。「未送信を今すぐ送る」を押してください。`
   :(!exp.configured
     ?'②までは保存できています。他のPCから<b>閲覧だけ</b>させたい場合は、下の「閲覧用の複製先」を設定してください（設定しなくても測定・共有はできます）。'
     :(exp.pending?'②に新しい変更があります。次の複製で③へ写ります（すぐ写したいときは「いま複製する」）。'
                  :'すべて送信・複製できています。いまは何もする必要がありません。'));
  /* **1行1段**にする（§9.261）。以前は3段を横に並べていたが、盤は
     ビューポートより狭く（1366pxの窓で875px）、矢印2本が240pxを取るので
     1段あたり204pxしか残らず、**値が「未設定（…」「08/28 15:2…」と
     切れていた**（実測。CLAUDE 画面基準 11「器は中身の長さから決める」）。
     縦に積めば値は切れず、流れも上から下で読める。 */
  const stage=(no,title,sub,rows,note,cls)=>`<div class="ms-stage ${cls||''}">
    <div class="ms-stage-head"><span class="ms-no">${no}</span><b>${esc(title)}</b><small>${esc(sub)}</small></div>
    <dl class="ms-kv">${rows.map(([k,val,warn])=>
      `<dt>${esc(k)}</dt><dd${warn?' class="is-warn"':''}>${val}</dd>`).join('')}</dl>
    <p class="ms-note">${note}</p></div>`;
  const arrow=(a,b)=>`<div class="ms-arrow" aria-hidden="true"><i>↓</i><b>${esc(a)}</b><small>${esc(b)}</small></div>`;
  form.innerHTML=`
   <div class="mm-form-head"><span class="mm-mode-chip editing">この端末の設定</span></div>
   <p class="ms-lead">測定データは<b>3か所</b>に置かれます。上から下へ流れます。
    <b>打っている最中はまだどこにも入っていません</b>——「保存して一覧へ」か「測定を完了」を押した時点で①と②へ入ります。</p>
   <div class="ms-next"><span class="ms-next-label">次にすること</span><span>${next}</span></div>
   ${pageTabsHtml([
    {name:'いまの状態',body:`   <div class="ms-flow">
    ${stage('①','この端末のブラウザ','IndexedDB＋控え',[
      ['編集中',msNum(draft)+(draft===null?'':'件')],
      ['完了',msNum(done)+(done===null?'':'件')],
      ['②へ未送信',msNum(unsent)+(unsent===null?'':'件'),!!unsent],
     ],'入力した値の実体です。<b>この端末でしか見えません</b>。ブラウザのデータを消すと失われます。',
      unsent?'is-warn':'')}
    ${arrow('保存のたび','自動')}
    ${stage('②',loc.perEquipment?'測定データのDB':'この端末のDB',
      loc.perEquipment?'共有・設備ごとに1ファイル':'db/records.sqlite3',[
      ['記録',msNum(loc.count)+(loc.count===null?'':'件')],
      ['最終書込',msWhen(loc.lastWriteAt)],
      ['大きさ',msSize(loc.size)],
     ].concat(loc.perEquipment?[['読む先',(loc.readPaths||[]).length+'ファイル'],
                                ['読み方',msMirrorText(loc.mirrored)]]:[]),
     loc.perEquipment
      ?`<b>設備ごとに1ファイル</b>に分けています——書くのはその設備の担当端末だけなので、同じファイルを2台が変えることがありません。
        一覧は<b>全設備ぶん</b>を読みますが、<b>開くのは手元の写し</b>です——共有を直接開くと、
        読んでいるあいだ測定端末の書き込みを待たせます（自分が書いたぶんだけは実物を読むので、
        自分の記録はすぐ見えます）。<br><code title="${esc(loc.shareDir||'')}">${esc(loc.shareDir||'—')}\\&lt;設備&gt;\\records.sqlite3</code>`
      :`<b>他のPCから続きを開けるのはここ</b>です（データ一覧はここも読みます）。<br><code title="${esc(loc.path||'')}">${esc(loc.path||'—')}</code>`)}
    ${arrow(exp.retired?'使いません':`変わったら${mins}分ごと`,exp.retired?'—':(exp.configured?'自動':'未設定'))}
    ${stage('③','閲覧用の複製','Box等・読むだけ',[
      ['状態',exp.retired?'<b>使いません</b>':(exp.configured?(exp.exists===false?'まだ作られていません':'複製しています'):'<b>未設定（複製しません）</b>'),exp.retired||!exp.configured],
      ['最終複製',(!exp.retired&&exp.configured)?msWhen(exp.lastOkAt):'—'],
      ['未反映の変更',(!exp.retired&&exp.configured)?(exp.pending?'あり':'なし'):'—'],
     ],exp.retired
        ?esc(exp.retired)
        :(exp.configured
        ?`閲覧モードの端末はここを読みます。書き戻しはしません。<br><code title="${esc(exp.path||'')}">${esc(exp.path||'—')}</code>`
        :'設定すると、②の中身をまるごとBox等へ写します。<b>測定・共有には必要ありません</b>——閲覧専用の端末に見せたいときだけ設定してください。'),
      (exp.retired||!exp.configured)?'is-off':'')}
   </div>
   ${exp.lastError?`<p class="ms-err">前回の複製に失敗しました: ${esc(exp.lastError)}</p>`:''}
   <div class="mm-cd-toolbar"><div class="mm-cd-actions">
    <button type="button" id="msSyncNow" class="${unsent?'mm-btn-primary':'mm-btn-ghost sm'}"${unsent?'':' disabled'}
      title="${unsent?'①のうち②へ送れていないものを、まとめて送ります':'未送信のデータはありません'}">未送信を今すぐ送る${unsent?`（${unsent}件）`:''}</button>
    <button type="button" id="msExportNow" class="mm-btn-ghost sm"${exp.configured?'':' disabled'}
      title="${exp.configured?'間隔を待たずに、いま②を③へ写します':'複製先が未設定です'}">いま複製する</button>
    <button type="button" id="msReload" class="mm-btn-ghost sm">状態を読み直す</button>
   </div></div>`},
    {name:'置き場と引っ越し',body:`   <div class="ms-settings">
    <h4>② 測定データの置き場</h4>
    <!-- **置き場を決めるのは共通設定の1箇所**（§9.267、§9.207「入口を2つに
         しない」）。以前はここにも欄があり、共通設定の「置き場」にも同じ
         設定が出ていた——同じ設定が2画面にあると、どちらが効くのか分からない。
         ここは**いまどこか**を言って、直す場所へ連れて行くだけにする。 -->
    <div class="ms-where${loc.perEquipment?' is-on':''}">
     <span class="ms-where-label">いまの置き場</span>
     <code class="ms-where-path">${esc(v.records_share_dir||'（未設定：この端末の db/records.sqlite3 に貯めています）')}</code>
     <button type="button" class="mm-btn-ghost sm" data-ms-goto="pathConfig">共通設定 &gt; 置き場 で決める</button>
    </div>
    <p class="mm-field-hint">決めた置き場の下に<b>設備の名前のフォルダ</b>を作り、その中に <code>records.sqlite3</code> を置きます。
     書くのはその設備を担当する端末だけなので、<b>同じファイルを2台が変えることがありません</b>。
     空欄なら今までどおり、この端末の <code>db/records.sqlite3</code> 1本に貯めます。
     <b>変えたときはアプリの再起動が必要です</b>（接続先は起動時に1回だけ決まります）。
     設定しても<b>今までの記録は消えません</b>——読むときは旧い置き場も一緒に見ます。</p>
    <!-- 置き場を決めたあとの引っ越し(§9.258)。**既定は下見**(§9.193)で、
         押す前に「どの設備へ何件」を出す。元のファイルは消さない。 -->
    <div class="ms-split" id="msSplitBox">
     <b class="ms-split-head">今ある測定データを設備ごとに振り分ける</b>
     <p class="mm-field-hint">この端末の <code>db/records.sqlite3</code> にある記録を、
      設備ごとのフォルダへ写します。<b>元のファイルは消しません</b>——読むときは旧い置き場も
      一緒に見るので、記録は1件も消えず、二重にも出ません。</p>
     <div class="mm-cd-actions">
      <button type="button" id="msSplitPreview" class="mm-btn-ghost sm"${loc.perEquipment?'':' disabled'}
       title="${loc.perEquipment?'どの設備へ何件になるかを、書き込む前に見ます':'先に共有の置き場を決めて、アプリを再起動してください'}">どうなるか見る</button>
      <button type="button" id="msSplitApply" class="mm-btn-primary" disabled
       title="下見を見てから押せます">振り分ける</button>
     </div>
     ${loc.perEquipment?'':'<p class="ms-split-why">共有の置き場が<b>まだ効いていません</b>。上で置き場を決めて保存し、アプリを再起動すると押せるようになります。</p>'}
     <div class="ms-split-result" id="msSplitResult" hidden></div>
    </div>
   </div>`},
    {name:'閲覧用の複製',body:`   <div class="ms-settings">
    <h4>③ 閲覧用の複製の設定</h4>
    <!-- **置き場を決めるのは共通設定の1箇所**（§9.267、利用者の指示
         「バックアップの置き場などを含めた全ての設定を共通設定に」）。
         §9.202ではここに置くと決めていたが、置き場が画面に散っているのが
         そもそもの困りごとだったので撤回した。ここに残すのは**間隔**だけ
         ——あれは置き場ではなく、保存後すぐ効く動きの設定。 -->
    <div class="ms-where${exp.configured?' is-on':''}">
     <span class="ms-where-label">いまの複製先</span>
     <code class="ms-where-path">${esc(v.records_backup_export_path||'（未設定：複製しません）')}</code>
     <button type="button" class="mm-btn-ghost sm" data-ms-goto="pathConfig">共通設定 &gt; 置き場 で決める</button>
    </div>
    <label class="mm-field"><span>複製を見に行く間隔</span>
     <span class="mm-field-num"><input type="number" id="msExportInterval" min="30" step="30"
       value="${esc(String(v.records_backup_export_interval_sec||exp.intervalSec||600))}"><em>秒</em></span>
     <small class="mm-field-hint"><b>変わったときだけ</b>複製するので、短くしても無駄な複製は増えません。
      こちらは保存後すぐ反映されます（再起動は要りません）。</small></label>
    <div class="mm-cd-actions"><button type="button" id="msSaveCfg" class="mm-btn-primary">この設定を保存</button></div>
   </div>
   <p class="mm-field-hint">測定画面の「DBへ同期」は、<b>いま開いている測定を①②へ即座に書く</b>ボタンです
    （保存して閉じずに、そこまでの入力を確実に残したいときに使います）。他のPCへ渡したい・PCを入れ替えるときは
    「データ引継ぎ」タブを使ってください。</p>`},
   ])}`;
  list.innerHTML='';
  /* 段の切り替えを配線する（§9.261）。編集窓と同じ`bindMaintTabs`なので、
     キーボード操作（←→）も見出しの一言もそのまま効く。 */
  bindMaintTabs(form);
  $('#msReload').onclick=()=>{measStorageState.loaded=false;loadMeasStorageMaint(true)};
  $('#msSyncNow').onclick=async()=>{
   if(typeof syncPendingRecords!=='function'){showToast&&showToast('この画面からは送れません','',4000);return}
   await syncPendingRecords({silent:false});
   measStorageState.loaded=false;loadMeasStorageMaint(true);
  };
  $('#msExportNow').onclick=async()=>{
   try{
    setMaintLoading(true,'複製しています…');
    await api('/api/measurement/backup/export-now',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    showToast&&showToast('複製しました','',3200);
   }catch(e){showToast&&showToast('複製できませんでした',e.message,7000)}
   finally{setMaintLoading(false);measStorageState.loaded=false;loadMeasStorageMaint(true)}
  };
  /* 置き場を直す場所へ連れて行く（§9.207。ここには欄を置かない）。
     **段まで連れて行く**——「共通設定を開く」だけだと、置き場の段を
     自分で探すことになる（§2）。飛び先は `pcPendingSection` が覚え、
     共通設定が組み上がった時点で開く（描く前に押しても取りこぼさない）。 */
  form.querySelectorAll('[data-ms-goto]').forEach(btn=>{
   btn.onclick=()=>{
    pcPendingSection='schedule';
    document.querySelector(`#masterMaintNav [data-master="${btn.dataset.msGoto}"]`)?.click();
   };
  });
  /* 引っ越しは**下見 → 振り分ける**の2段(§9.193)。下見を見るまで
     「振り分ける」は押せない（押した瞬間に何が起きるか分からない操作にしない）。 */
  let splitSeen=false;
  const msSplitRun=async apply=>{
   const box=$('#msSplitResult');
   try{
    setMaintLoading(true,apply?'振り分けています…':'調べています…');
    const r=await api('/api/measurement/records/split',
     {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({apply,user_id:String($('#masterUserId')?.value||'').trim()})});
    const gs=r.groups||[];
    box.hidden=false;
    box.innerHTML=gs.length
     ?`<p class="ms-split-total">${apply?'振り分けました':'下見'}：全 ${r.total} 件 → ${gs.length} 設備</p>`
      +`<ul class="ms-split-list">${gs.map(g=>
        `<li><b>${esc(g.equipment||'（設備なし）')}</b> ${g.count}件
          <code title="${esc(g.path||'')}">${esc(g.dirName||'')}</code>
          ${g.error?`<em class="ms-split-err">${esc(g.error)}</em>`:''}</li>`).join('')}</ul>`
      +`<p class="mm-field-hint">${esc(r.note||'')}</p>`
     :`<p class="ms-split-total">振り分ける記録がありません（${esc(r.note||'')}）</p>`;
    if(apply){
     splitSeen=false;$('#msSplitApply').disabled=true;
     showToast&&showToast('振り分けました',`${r.moved}件を設備ごとのフォルダへ写しました`,6000);
     measStorageState.loaded=false;loadMeasStorageMaint(true);
    }else{
     splitSeen=gs.length>0;$('#msSplitApply').disabled=!splitSeen;
    }
   }catch(e){
    showToast&&showToast(apply?'振り分けられませんでした':'調べられませんでした',e.message,7000);
   }finally{setMaintLoading(false)}
  };
  if($('#msSplitPreview'))$('#msSplitPreview').onclick=()=>msSplitRun(false);
  if($('#msSplitApply'))$('#msSplitApply').onclick=async()=>{
   if(!splitSeen)return;
   if(!confirm('今ある測定データを、設備ごとのフォルダへ写します。\n\n'
              +'元のファイルは消しません（記録は1件も消えず、二重にも出ません）。\n'
              +'よろしいですか？'))return;
   await msSplitRun(true);
  };
  $('#msSaveCfg').onclick=async()=>{
   /* **送るのはこの2つだけ**。パス設定の保存は「送られてきた項目だけ」を
      書くので、他の設定を巻き添えにしない(§9.192)。 */
   /* **置き場はここでは送らない**（§9.267）——`records_share_dir`も
      `records_backup_export_path`も決めるのは共通設定の1箇所で、
      送ると2画面から同じ設定を書くことになる。ここは間隔だけ。 */
   const body={records_backup_export_interval_sec:String($('#msExportInterval').value||'').trim(),
               user_id:String($('#masterUserId')?.value||'').trim()};
   try{
    setMaintLoading(true,'保存しています…');
    await api('/api/path-config-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    pathConfigState.loaded=false;
    showToast&&showToast('保存しました','複製先を変えた場合は、アプリを再起動すると反映されます',6000);
   }catch(e){showToast&&showToast('保存できませんでした',e.message,7000)}
   finally{setMaintLoading(false);measStorageState.loaded=false;loadMeasStorageMaint(true)}
  };
 }
 /* ---------- データ引継ぎ（PC引継ぎ等でrecords.sqlite3からIndexedDBへ取り込む） ----------
    通常はIndexedDB→records.sqlite3の一方通行だが、PC更新等でIndexedDBが
    空の端末に対しては逆方向の取り込みが必要になる。対象のペイロードは
    codec='json-full-v32'（現行の完全JSONスナップショット）のみをサポートし、
    それ以外(旧形式等)は安全側に倒して「非対応」として選択不可にする。
    既存IDと衝突する場合は上書きになるため、選択状態を可視化した上で
    確認ダイアログを挟んでから実行する。 ---------- */
 let importBackupState={items:[],loaded:false,localIds:new Set()};
 async function loadImportBackupMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&importBackupState.loaded){renderImportBackupForm();renderImportBackupList();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">records.sqlite3を読み込んでいます…</div>';
  try{
   const [backupResult,localItems]=await Promise.all([api('/api/measurement/backup/list'),reliableAll().catch(()=>[])]);
   importBackupState.items=(backupResult&&backupResult.items)||[];
   importBackupState.localIds=new Set(localItems.map(x=>x.id));
   importBackupState.loaded=true;
   renderImportBackupForm();renderImportBackupList();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 function renderImportBackupForm(){
  const form=$('#masterMaintForm');if(!form)return;
  const items=importBackupState.items,supported=items.filter(x=>x.codec==='json-full-v32');
  // 端末内(IndexedDB)に対応が無い行 = データ一覧に出ないのに実績突合には効く残骸候補(§9.52)
  const orphans=items.filter(x=>!importBackupState.localIds.has(x.id));
  form.innerHTML=`<div class="mm-form-head"><span class="mm-mode-chip editing">PC引継ぎ専用</span></div>
   <div class="mm-import-warning">
    <b>注意: この操作はこの端末のIndexedDB（編集中/完了データ）を書き換えます。</b>
    <span>records.sqlite3（Web測定バックアップ）の内容を、この端末のローカルデータへ取り込みます。同じIDの既存データは上書きされ、元に戻せません。PC更新・端末交換時の引継ぎなど、特別な場合以外は実行しないでください。</span>
   </div>
   <div class="mm-imp-state">
    <div class="mm-imp-state-col">
     <span class="mm-imp-state-label">いまの状態</span>
     <ul class="mm-imp-state-list">
      <li>バックアップ(records.sqlite3): <b>${esc(String(items.length))}</b>件</li>
      <li>うちこの端末にも有る: <b>${esc(String(items.length-orphans.length))}</b>件</li>
      <li>うちこの端末に<b>無い</b>: <b class="${orphans.length?'is-warn':''}">${esc(String(orphans.length))}</b>件</li>
      <li>取込できる形式: <b>${esc(String(supported.length))}</b>件${supported.length<items.length?`（非対応 ${esc(String(items.length-supported.length))}件）`:''}</li>
     </ul>
    </div>
    <div class="mm-imp-arrow" aria-hidden="true">→</div>
    <div class="mm-imp-state-col">
     <span class="mm-imp-state-label">選択中の操作で起きること</span>
     <div id="mmImpPreview" class="mm-imp-preview">まだ何も選ばれていません。下の一覧で対象を選ぶと、ここに変化の予定が出ます。</div>
    </div>
   </div>
   <div class="mm-cd-toolbar">
    <div class="mm-cd-actions">
     <button type="button" id="mmImpReload" class="mm-btn-ghost sm">再読込</button>
     <button type="button" id="mmImpSelectAll" class="mm-btn-ghost sm">取込可能をすべて選択</button>
     <button type="button" id="mmImpSelectOrphan" class="mm-btn-ghost sm"${orphans.length?'':' disabled'}>この端末に無いものを選択</button>
     <button type="button" id="mmImpSelectNone" class="mm-btn-ghost sm">選択解除</button>
     <button type="button" id="mmImpRun" class="mm-btn-primary">選択した項目をこの端末へ取り込む</button>
     <span class="mm-cd-sep" aria-hidden="true"></span>
     <button type="button" id="mmImpDelete" class="mm-btn-danger">選択した項目をバックアップから削除</button>
    </div>
   </div>
   ${orphans.length?`<div class="mm-import-warning is-orphan">
     <b>この端末のデータ一覧に無いバックアップが ${esc(String(orphans.length))}件あります。</b>
     <span>作業スケジュールの「作業中」「完了」はこのバックアップを見て表示するため、端末から削除済みのデータが残っていると、データ一覧には何も無いのにスケジュールにだけ作業中が並びます。心当たりの無い行は「この端末に無いものを選択」→「選択した項目をバックアップから削除」で消せます。<b>他のPCで測定したデータをこのPCで参照している場合は、それも「無し」になります。消す前に内容をご確認ください。</b></span>
    </div>`:''}`;
  form.onsubmit=ev=>ev.preventDefault();
  const reload=$('#mmImpReload'),selAll=$('#mmImpSelectAll'),selNone=$('#mmImpSelectNone'),run=$('#mmImpRun');
  if(reload)reload.onclick=()=>loadImportBackupMaint(true);
  if(selAll)selAll.onclick=()=>document.querySelectorAll('#masterMaintList [data-imp-id]:not(:disabled)').forEach(b=>b.checked=true);
  if(selNone)selNone.onclick=()=>document.querySelectorAll('#masterMaintList [data-imp-id]').forEach(b=>b.checked=false);
  if(run)run.onclick=()=>runImportBackup();
  const selOrphan=$('#mmImpSelectOrphan'),del=$('#mmImpDelete');
  if(selOrphan)selOrphan.onclick=()=>{
   document.querySelectorAll('#masterMaintList [data-imp-id]').forEach(b=>{b.checked=b.dataset.impOrphan==='1'});
   updateImportPreview();
  };
  if(del)del.onclick=()=>deleteBackupSelection();
  [selAll,selNone].forEach(b=>{if(b){const prev=b.onclick;b.onclick=()=>{prev&&prev();updateImportPreview()}}});
  updateImportPreview();
 }
 /* 選択した内容で「何がどう変わるか」を実行前に言葉で示す(§9.68)。
    取り込みも削除も元に戻せないので、押す前に結果を読めることが重要。 */
 function updateImportPreview(){
  const box=$('#mmImpPreview');if(!box)return;
  const checked=[...document.querySelectorAll('#masterMaintList [data-imp-id]:checked')];
  if(!checked.length){
   box.className='mm-imp-preview';
   box.textContent='まだ何も選ばれていません。下の一覧で対象を選ぶと、ここに変化の予定が出ます。';
   return;
  }
  const orphan=checked.filter(b=>b.dataset.impOrphan==='1').length;
  const overwrite=checked.length-orphan;
  box.className='mm-imp-preview is-active';
  box.innerHTML=`<div class="mm-imp-preview-row"><b>${esc(String(checked.length))}件</b>を選択中</div>
   <div class="mm-imp-preview-plan"><span class="mm-imp-plan-title">「この端末へ取り込む」を押すと</span>
    <ul><li>この端末へ<b>新しく追加</b>: ${esc(String(orphan))}件</li>
     <li>既存データを<b>上書き</b>（元に戻せません）: ${esc(String(overwrite))}件</li></ul></div>
   <div class="mm-imp-preview-plan"><span class="mm-imp-plan-title">「バックアップから削除」を押すと</span>
    <ul><li>バックアップから<b>消える</b>: ${esc(String(checked.length))}件</li>
     <li>作業スケジュールの実績表示から消える: ${esc(String(checked.length))}件</li>
     <li>この端末のデータ一覧は<b>変わらない</b>（端末内データは残ります）</li></ul></div>`;
 }
 function renderImportBackupList(){
  const list=$('#masterMaintList');if(!list)return;
  const items=importBackupState.items;
  if(!items.length){list.innerHTML='<div class="mm-empty">records.sqlite3に取込可能なバックアップがありません。</div>';return}
  const tmpl='40px minmax(90px,1fr) minmax(70px,.7fr) minmax(60px,.6fr) minmax(70px,.7fr) minmax(90px,.8fr) minmax(90px,.9fr) minmax(230px,1.4fr)';
  const head=`<div class="mm-row head" style="grid-template-columns:${tmpl}"><span></span><span>ロット番号</span><span>検査番号</span><span>状態</span><span>設備</span><span>更新日時</span><span>形式</span><span>いまの状態 → 取り込むと</span></div>`;
  const rows=items.map(it=>{
   const supported=it.codec==='json-full-v32';
   const conflict=importBackupState.localIds.has(it.id);
   // 端末内(IndexedDB)に対応するデータが無い行。データ一覧には出ないのに
   // 作業スケジュールの実績突合には効いてしまう「残骸」の候補(§9.52)。
   const orphan=!conflict;
   // 「今どうなっていて、取り込むとどうなるか」を1つの列で示す(§9.68)。
   // 以前は「取込先(新規/上書き)」と「端末内(有り/無し)」が別々の列で、
   // 2列を突き合わせないと変化が読み取れなかった。
   const targetLabel=supported
    ?(conflict?'<span class="mm-imp-flow"><span class="mm-imp-badge has">端末内に有り</span><i>→</i><span class="mm-imp-badge overwrite">上書きされる</span></span>'
              :'<span class="mm-imp-flow"><span class="mm-imp-badge orphan">端末内に無し</span><i>→</i><span class="mm-imp-badge new">新しく追加</span></span>')
    :'<span class="mm-imp-badge unsupported">非対応（取り込めません）</span>';
   return `<div class="mm-row${orphan?' is-orphan':''}" style="grid-template-columns:${tmpl}">`+
    `<span><input type="checkbox" data-imp-id="${esc(it.id)}" data-imp-orphan="${orphan?1:0}"${supported?'':' disabled'}></span>`+
    `<span title="${esc(it.lotNo)}">${esc(it.lotNo)||'<em class="mm-blank">—</em>'}</span>`+
    `<span>${esc(it.inspectionNo)||'<em class="mm-blank">—</em>'}</span>`+
    `<span>${esc(it.status)||'<em class="mm-blank">—</em>'}</span>`+
    `<span title="${esc(it.equipment)}">${esc(it.equipment)||'<em class="mm-blank">—</em>'}</span>`+
    `<span class="mm-date">${esc(fmtDT(it.updated_at))}</span>`+
    `<span>${esc(it.codec)||'<em class="mm-blank">—</em>'}</span>`+
    `<span>${targetLabel}</span></div>`;
  }).join('');
  list.innerHTML=head+rows;
  list.querySelectorAll('[data-imp-id]').forEach(b=>b.addEventListener('change',updateImportPreview));
  updateImportPreview();
 }
/* バックアップ(records.sqlite3)から選択行を削除する(§9.52)。
    端末内データの削除はreliableDelete()がバックアップも消すようになったが、
    それ以前に消したもの・他端末で消したものは残骸として残っている。
    実績突合はこのテーブルを見るため、残骸があるとスケジュールにだけ
    「作業中」が出続ける。ここから明示的に消せるようにする。 */
 async function deleteBackupSelection(){
  const ids=[...document.querySelectorAll('#masterMaintList [data-imp-id]:checked')].map(b=>b.dataset.impId);
  if(!ids.length){showToast('選択されていません','削除する行を選んでください。',4000);return}
  const orphan=[...document.querySelectorAll('#masterMaintList [data-imp-id]:checked')].filter(b=>b.dataset.impOrphan==='1').length;
  const msg=`バックアップから ${ids.length}件を削除します。`
   +(orphan<ids.length?`\n\nうち ${ids.length-orphan}件はこの端末のデータ一覧にも存在します。削除するとスケジュールの実績表示から消えますが、端末内のデータは残ります。`:'')
   +'\n\nこの操作は元に戻せません。よろしいですか?';
  const ok=typeof confirmModal==='function'?await confirmModal(msg):window.confirm(msg);
  if(!ok)return;
  try{
   setMaintLoading(true,`バックアップから ${ids.length}件を削除しています…`);
   const r=await api('/api/measurement/backup/delete',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ids})});
   // 実績が変わったので作業スケジュールの予定キャッシュを捨てる
   if(typeof window.invalidateSchedulePlanCache==='function')window.invalidateSchedulePlanCache();
   await loadImportBackupMaint(true);
   showToast('バックアップから削除しました',`${r.deleted}/${r.requested}件`,4600);
  }catch(e){showToast('削除できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }
 async function runImportBackup(){
  const uid=requireMaintUser();if(uid===null)return;
  const checked=[...document.querySelectorAll('#masterMaintList [data-imp-id]:checked')].map(b=>b.dataset.impId);
  if(!checked.length){showToast&&showToast('取込対象が選択されていません','取込可能な項目にチェックを付けてください。',4000);return}
  const targets=importBackupState.items.filter(it=>checked.includes(it.id));
  const overwriteCount=targets.filter(it=>importBackupState.localIds.has(it.id)).length;
  // 取り消せない操作なので、何がどう変わるかを箇条書きで示してから確認する
  // (以前はブラウザ標準のconfirm()で、他画面の確認と作法が揃っていなかった)。
  const okRun=typeof confirmModal==='function'?await confirmModal({
   eyebrow:'IMPORT TO THIS TERMINAL',title:'この端末へ取り込みます',
   danger:true,confirmLabel:'取り込む',
   bodyHtml:`<p class="confirm-modal-message">選択した <b>${esc(String(targets.length))}件</b> をこの端末のデータへ取り込みます。</p>
    <ul class="confirm-modal-points">
     <li>新しく追加: <b>${esc(String(targets.length-overwriteCount))}</b>件</li>
     <li>既存データを上書き: <b>${esc(String(overwriteCount))}</b>件${overwriteCount?'（<b>元に戻せません</b>）':''}</li>
     <li>PC更新・端末交換の引継ぎ以外では実行しないでください。</li>
    </ul>`}):window.confirm(`選択した${targets.length}件を取り込みます。よろしいですか?`);
  if(!okRun)return;
  let okCount=0,ngCount=0;const errors=[];
  try{
   setMaintLoading(true,`インポートしています… (0/${targets.length})`);
   for(let i=0;i<targets.length;i++){
    const it=targets[i];
    setMaintLoading(true,`インポートしています… (${i+1}/${targets.length})`);
    try{
     const record=ensureMeasureShape(JSON.parse(it.payload));
     record.id=it.id;
     await reliablePut(record);okCount++;
    }catch(e){ngCount++;errors.push(`${it.lotNo||it.id}: ${e.message}`)}
   }
  }finally{setMaintLoading(false)}
  await refreshDraftCount();importBackupState.loaded=false;await loadImportBackupMaint(true);
  showToast&&showToast('インポートが完了しました',`成功 ${okCount}件 / 失敗 ${ngCount}件`+(errors.length?`\n${errors.slice(0,3).join('\n')}`:''),8000);
 }
 /* ======================================================================
    データ接続（§9.168。利用者の指示「データソースマスタとパス設定マスタの
    統合／今のUIが使いにくくわかりにくいので再構築」）
    ----------------------------------------------------------------------
    直す前の問題は3つだった。
      ① 同じ「どこを読むか」が2画面に分かれていた（データソースの共有パス・
         出力ファイルと、パス設定の個別上書き）。どちらが効くのかは画面の
         どこにも書いていなかった。
      ② 読み方を決めるのが`sikalot_source`という**全体で1つのスイッチ**
         だけで、「このソースは共有、あのソースはRNE」が表現できなかった。
         RNEの無い端末では、使わない抽出が回り続けて失敗ログだけが残る。
      ③ 保存しても接続先は再起動まで変わらないので、**打ち間違いに
         気づけるのが再起動のあと**だった。
    そこで、
      ・1行＝1カードにして「何か／どこから／何ができるか」を同時に見せる
      ・読み方は行ごとに選ぶ（共有 / RNEから作る / 直接指定）
      ・編集ウィンドウは**スクロールさせない**代わりに大きく取り、
        右半分で「この設定でできること」を**保存する前に**確かめる
    という形にした。 */
 let dsState={items:[],loaded:false,assets:{},editing:null,probe:null,probePath:'',probeSeq:0,probing:false};
 /* 読み方の呼び名は**1箇所**。サーバー（backend/db_access.pyの
    source_read_mode）が返す語をそのまま画面の言葉へ写す。 */
 const DS_MODES=[
  {v:'share',label:'共有フォルダのファイルを読む',
   hint:'ネットワーク共有に置いてある .sqlite3 をそのまま読みます。RNEは要りません。'},
  {v:'rne',label:'この端末でRNEから作って読む',
   hint:'RNE（抽出定義）から .sqlite3 を作り、それを読みます。RNEの資材を置いた端末だけです。'},
  {v:'direct',label:'このファイルを直接読む（検証・一時的な差し替え）',
   hint:'上の2つに関わらず、ここに入れた場所を最優先で読みます。空にすると上の設定へ戻ります。'},
 ];
 const DS_MODE_SHORT={share:'共有フォルダ',rne:'RNEから作る',direct:'直接指定'};
 const DS_ROLE_CLASS={'仕掛':'is-work','品質':'is-quality','スケジュール':'is-schedule'};
 async function loadDataSourceMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&dsState.loaded){renderDataSourceForm();renderDataSourceList();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const r=await api('/api/data-source-master');
   dsState.items=r.items||[];
   dsState.assets={assetsDir:r.assetsDir||'',confPath:r.confPath||'',confExists:!!r.confExists};
   /* 選べる役割と、いま埋まっている行は**サーバーが答える**(§9.193)。
      「各1件」という決まりを持っているのはあちらなので、画面で数え直さない
      ——無効にした行まで数えて「埋まっている」と言ってしまう。 */
   dsState.purposes=Array.isArray(r.purposes)&&r.purposes.length?r.purposes:['仕掛','品質','スケジュール'];
   dsState.purposeHolders=r.purposeHolders||{};
   dsState.loaded=true;
   renderDataSourceForm();renderDataSourceList();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 /* 上段は**要約と入口だけ**。面積は「頻度×重要度」で配る——ここで毎日見るのは
    「何件あって、再起動待ちがあるか」で、1件ずつの中身は下のカードが持つ。 */
 function renderDataSourceForm(){
  const form=$('#masterMaintForm');if(!form)return;
  const on=dsState.items.filter(x=>x.active);
  const work=on.filter(x=>x.purpose==='仕掛').length,quality=on.filter(x=>x.purpose==='品質').length;
  const sched=on.filter(x=>x.purpose==='スケジュール').length;
  const pending=on.filter(dsPending).length;
  const rne=on.filter(x=>x.readMode==='rne').length;
  form.className='mm-form';
  form.innerHTML=`
   <div class="ds-summary">
    <div class="ds-summary-facts">
     <span class="ds-sum"><b>${on.length}</b> 件が有効</span>
     <span class="ds-sum${work?'':' is-warn'}">仕掛 <b>${work}</b></span>
     <span class="ds-sum">品質 <b>${quality}</b></span>
     <span class="ds-sum">スケジュール <b>${sched}</b></span>
     <span class="ds-sum">RNEで作る <b>${rne}</b></span>
     ${pending?`<span class="ds-sum is-pending"><b>${pending}</b> 件が再起動待ち</span>`:''}
    </div>
    <div class="ds-summary-act">
     <button type="button" class="mm-btn-ghost" id="dsCommonBtn" title="共有パス・RNE資材の置き場・間隔の設定へ移ります">共通設定…</button>
     <button type="button" class="mm-btn-primary" id="dsAddBtn">＋ データソースを追加</button>
    </div>
   </div>
   <p class="mm-def-hint">${work?'':'<b>役割「仕掛」のデータソースがありません。</b>測定・作業スケジュールへの投入はできません。 '
     }役割は<b>「読むかどうか」ではなく「何として使うか」</b>です（仕掛・品質・スケジュールは各1件、それ以外は「その他」として一覧に出るだけ）。 <b>名称と読み込み先</b>の変更はサーバー再起動後に反映されます（それまでは今までの名前・場所のままです）。</p>`;
  form.onsubmit=ev=>ev.preventDefault();
  const add=$('#dsAddBtn');if(add)add.onclick=()=>openDataSourceEditor(null);
  /* 共通設定へは**そのタブを押したのと同じ道**で移る（入口を2本作らない）。 */
  const common=$('#dsCommonBtn');
  if(common)common.onclick=()=>document.querySelector('#masterMaintNav [data-master="pathConfig"]')?.click();
 }
 /* 保存値と、いま効いている場所が違う＝再起動待ち。**まだ読んでいない
    データソース**（登録したばかり）も待ちに含める（§9.163）。 */
 function dsPending(x){return dsPendingKinds(x).length>0}
 /* 何が再起動待ちなのかを**文字で**返す(§9.183)。以前は読み込み先だけを
    見ていたため、**名称を変えても何も言わなかった**（表示名も接続先と同じく
    起動時に1回だけ決まる）。 */
 function dsPendingKinds(x){
  if(!x.active)return [];
  if(x.loaded===false)return ['この端末ではまだ読んでいません'];
  const out=[];
  if(String(x.plannedPath||'')!==String(x.activePath||''))out.push('読み込み先');
  if(x.activeLabel!=null&&String(x.label||'')!==String(x.activeLabel||''))out.push('名称');
  /* 一覧に出すかどうか(§9.193)も起動時に1回だけ決まる（左メニューの元に
     なるカタログはDBSの写しから作る）。**黙っていると「設定したのに
     消えない」**ので、名称と同じ扱いで再起動待ちに数える。 */
  if(x.activeListed!=null&&(x.listed!==false)!==(x.activeListed!==false))out.push('一覧に出すかどうか');
  return out;
 }
 /* 一覧は**行**で組む（§9.193、利用者の指摘「もう少し高密度で、必要な情報を
    バランスよく」）。カード1枚1枚に見出しと定義リストを持たせていたため、
    5件でも縦に長く、しかも**項目の左端がカードごとにずれていて**列として
    追えなかった（CLAUDE.md §9「情報欄は縦にそろえる」）。1行＝1データソース、
    列は固定幅でそろえ、**言うことがあるときだけ**2行目を出す。 */
 const DS_LIST_COLS=[
  {k:'role',label:'役割',hint:'このデータを何として使うか。仕掛・品質・スケジュールは各1件です。'},
  {k:'name',label:'名称 / キー'},
  {k:'listed',label:'一覧',hint:'左メニュー「一覧を見る」に出すかどうか。結合の相手としてだけ読むデータは「出さない」にできます。'},
  {k:'mode',label:'読み方'},
  {k:'path',label:'いま読んでいる'},
  {k:'caps',label:'できること'},
  {k:'act',label:''},
 ];
 function renderDataSourceList(){
  const list=$('#masterMaintList');if(!list)return;
  if(!dsState.items.length){
   list.innerHTML='<div class="mm-empty">データソースがまだありません。「＋ データソースを追加」から登録してください。</div>';
   return;
  }
  const head=DS_LIST_COLS.map(c=>`<span class="ds-h ds-c-${c.k}"${c.hint?` title="${esc(c.hint)}"`:''}>${esc(c.label)}</span>`).join('');
  list.innerHTML=`<div class="ds-rows"><div class="ds-row ds-row-head">${head}</div>`
    +dsState.items.map(dsRowHtml).join('')+`</div>`;
  list.querySelectorAll('[data-ds-edit]').forEach(b=>b.onclick=()=>{
   const x=dsState.items.find(i=>String(i.id)===b.dataset.dsEdit);if(x)openDataSourceEditor(x);
  });
  list.querySelectorAll('[data-ds-del]').forEach(b=>b.onclick=()=>dsDelete(b.dataset.dsDel));
 }
 function dsRowHtml(x){
  const cap=x.capability||{},f=cap.features||{};
  /* できることは**できるものだけ**を出す（§4「できないことは書く」は
     編集画面の役目。一覧では×印が並ぶほうがノイズになる）。理由は title。 */
  const caps=CAPABILITY_ORDER.filter(k=>f[k]&&f[k].ok).map(k=>
    `<i class="ds-cap is-ok" title="${esc(CAPABILITY_LABEL[k]+': '+(f[k].note||''))}">${esc(CAPABILITY_SHORT[k])}</i>`).join('');
  const kinds=dsPendingKinds(x);
  const pending=kinds.length>0;
  const role=x.purpose||'その他';
  const sameLabel=x.activeLabel==null||String(x.label||'')===String(x.activeLabel||'');
  const same=String(x.plannedPath||'')===String(x.activePath||'');
  const listed=x.listed!==false;
  /* 2行目は**打つ手があるときだけ**。同じ場所・同じ名前なら黙っている
     （§9.129 同じものを2箇所に出さない）。 */
  const notes=[];
  if(!same)notes.push(`再起動後は <b>${esc(x.plannedPath||'—')}</b> を読みます`);
  if(!sameLabel)notes.push(`再起動すると名称が「<b>${esc(x.label||'')}</b>」になります（いまは ${esc(x.activeLabel||'—')}）`);
  if(cap.error)notes.push(esc(cap.error));
  return `<div class="ds-row${x.active?'':' is-off'}${pending?' is-pending':''}">
   <span class="ds-c-role"><span class="ds-role ${DS_ROLE_CLASS[role]||''}">${esc(role)}</span></span>
   <span class="ds-c-name">
    <b class="ds-name" title="${esc(x.label||'')}">${esc(x.label||x.key)}</b>
    <code class="ds-key" title="一覧を指す識別子です">${esc(x.key)}</code>
    ${x.active?'':'<span class="ds-flag is-off">無効</span>'}
    ${pending?`<span class="ds-flag is-pending" title="${esc(kinds.join('・'))}が再起動待ちです">再起動待ち</span>`:''}
   </span>
   <span class="ds-c-listed"><span class="ds-listed${listed?'':' is-off'}" title="${
     listed?'左メニュー「一覧を見る」に出ます。':'左メニューには出しません（結合の相手としては読めます）。'
   }">${listed?'出す':'出さない'}</span></span>
   <span class="ds-c-mode">${esc(DS_MODE_SHORT[x.readMode]||'—')}</span>
   <span class="ds-c-path" title="${esc(x.activePath||'')}">${
     esc(x.activePath||'（この端末ではまだ読んでいません）')}</span>
   <span class="ds-c-caps">${caps||'<i class="ds-cap">—</i>'}</span>
   <span class="ds-c-act">
    <button type="button" class="mm-btn-ghost sm" data-ds-edit="${esc(String(x.id))}">編集</button>
    ${x.active?`<button type="button" class="mm-btn-ghost sm" data-ds-del="${esc(String(x.id))}">無効にする</button>`:''}
   </span>
   ${notes.length?`<span class="ds-c-note">${notes.join(' ／ ')}</span>`:''}
  </div>`;
 }
 /* ==================================================================
    クエリ結合(§9.193) — 読んだデータ同士を突合キーでつなぐ
    ------------------------------------------------------------------
    **組み合わせられるのはデータ接続に登録済みのものだけ**（利用者の指示）。
    選択肢はサーバーが返す `sources` から作る——画面で別に一覧を組み立てると、
    無効にしたデータソースが選択肢に残る。

    並びは作業の順番そのもの:「①どの一覧に足すか → ②どこから → ③どうつなぐ
    → ④何を足す → ⑤結果」。**保存する前に当ててみられる**(下見)のが値打ちで、
    読み込み先は起動時に1回だけ決まるため、これが無いと打ち間違いに気づける
    のが再起動のあとになる（§9.168と同じ作法）。
    ================================================================== */
 let qjState={items:[],sources:[],builtin:null,builtinEnabled:true,kinds:[],kindDefault:'left',
              loaded:false,editing:null,
              cols:{},probe:null,probeSeq:0,probing:false,probeSig:'',
              /* 突合キーを選んでいる最中の状態(§9.197)。`pick`＝1つ目に押した列、
                 `search`＝列名の絞り込み（左右それぞれ）。 */
              pick:null,search:{left:'',right:''}};
 /* 結合の仕方(§9.194)。**説明も動きも「一致した行／左だけ／右だけ」の3つの
    真偽値から作る**——サーバー(query_join.JOIN_KINDS)が答えるものをそのまま
    使い、画面で別の判定を書かない。見本の表も同じ3つから組み立てるので、
    「説明はこう書いてあるのに実際は違う」が原理的に起きない。 */
 const QJ_SAMPLE={
  left:{title:'この一覧',cols:['ロット番号','品名'],rows:[['L001','帯鋼'],['L002','条']]},
  right:{title:'相手',cols:['ロット番号','等級'],rows:[['L001','A'],['L003','B']]}};
 function qjKind(key){
  const list=qjState.kinds||[];
  return list.find(k=>k.key===key)||list.find(k=>k.key===(qjState.kindDefault||'left'))||null;
 }
 /* 2つの円で「どこを残すか」を塗る。**色だけで伝えない**(§3)ので、名前・
    一行説明・見本の表を必ず添える。idは同じ図が2箇所に出ても衝突しないよう
    場所ごとの接頭辞を付ける。 */
 function qjVennHtml(k,scope){
  if(!k)return '';
  const id=x=>`qjv-${scope}-${k.key}-${x}`;
  return `<svg class="qj-venn" viewBox="0 0 100 52" role="img" aria-label="${esc(k.label)}の図">
   <defs>
    <clipPath id="${id('c')}"><circle cx="38" cy="26" r="20"/></clipPath>
    <mask id="${id('ml')}"><rect x="0" y="0" width="100" height="52" fill="#fff"/><circle cx="62" cy="26" r="20" fill="#000"/></mask>
    <mask id="${id('mr')}"><rect x="0" y="0" width="100" height="52" fill="#fff"/><circle cx="38" cy="26" r="20" fill="#000"/></mask>
   </defs>
   ${k.leftOnly?`<circle class="on" cx="38" cy="26" r="20" mask="url(#${id('ml')})"/>`:''}
   ${k.rightOnly?`<circle class="on" cx="62" cy="26" r="20" mask="url(#${id('mr')})"/>`:''}
   ${k.matched?`<circle class="on" cx="62" cy="26" r="20" clip-path="url(#${id('c')})"/>`:''}
   <circle class="ring" cx="38" cy="26" r="20"/><circle class="ring" cx="62" cy="26" r="20"/>
  </svg>`;
 }
 /* 行がどう増減するかを**文字で**言う（図と色だけでは伝わらない）。 */
 function qjRowEffect(k){
  if(!k)return '';
  if(k.matched&&k.leftOnly&&!k.rightOnly)return '行は減らない';
  if(k.rightOnly&&k.leftOnly)return '行が増えることがある';
  if(k.rightOnly&&k.matched)return '行が減り、増えることもある';
  if(k.rightOnly)return 'この一覧の行は残らない';
  return '行が減る';
 }
 /* 結合の見本。左2行・右2行の作り物を、上の3つの真偽値どおりに突き合わせる。 */
 function qjSampleHtml(k){
  if(!k)return '';
  const addCols=k.matched||k.rightOnly;
  const cols=['ロット番号','品名'].concat(addCols?['等級']:[]);
  const rows=[];
  if(k.matched)rows.push(['L001','帯鋼','A']);
  if(k.leftOnly)rows.push(['L002','条','']);
  if(k.rightOnly)rows.push(['L003','','B']);
  const cell=v=>v===''?'<td class="is-blank">（空）</td>':`<td>${esc(v)}</td>`;
  const src=(x)=>`<table class="qj-sample-t"><caption>${esc(x.title)}</caption><thead><tr>${
    x.cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
    x.rows.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return `<div class="qj-sample">
    ${src(QJ_SAMPLE.left)}${src(QJ_SAMPLE.right)}
    <span class="qj-sample-arrow" aria-hidden="true">→</span>
    <table class="qj-sample-t is-result"><caption>結合した結果</caption><thead><tr>${
      cols.slice(0,addCols?3:2).map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
      rows.length?rows.map(r=>`<tr>${r.slice(0,addCols?3:2).map(cell).join('')}</tr>`).join('')
        :'<tr><td class="is-blank" colspan="3">1行も残りません</td></tr>'}</tbody></table>
   </div>`;
 }
 const QJ_MULTI_LABEL={first:'最初の1件を使う',blank:'空にする（どれか決められないので出さない）'};
 const QJ_LIST_COLS=[
  {k:'state',label:'状態'},
  {k:'name',label:'結合名'},
  {k:'left',label:'足す先（この一覧に）'},
  {k:'right',label:'相手（ここから持ってくる）'},
  {k:'keys',label:'突合キー'},
  {k:'kind',label:'結合の仕方'},
  {k:'cols',label:'足す列'},
  {k:'act',label:''},
 ];
 function qjSourceLabel(key){
  const x=(qjState.sources||[]).find(s=>s.key===key);
  return x?(x.label||x.key):(key||'—');
 }
 async function loadQueryJoinMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&qjState.loaded){renderQueryJoinForm();renderQueryJoinList();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const r=await api('/api/query-join-master');
   qjState.items=r.items||[];qjState.sources=r.sources||[];qjState.builtin=r.builtin||null;
   qjState.kinds=r.kinds||[];qjState.kindDefault=r.kindDefault||'left';
   qjState.builtinEnabled=r.builtinEnabled!==false;
   qjState.loaded=true;
   renderQueryJoinForm();renderQueryJoinList();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 function renderQueryJoinForm(){
  const form=$('#masterMaintForm');if(!form)return;
  const on=qjState.items.filter(x=>x.active).length;
  const off=qjState.items.length-on;
  const few=(qjState.sources||[]).length<2;
  form.className='mm-form';
  form.innerHTML=`
   <div class="ds-summary">
    <div class="ds-summary-facts">
     <span class="ds-sum"><b>${on}</b> 件が有効</span>
     ${off?`<span class="ds-sum">停止中 <b>${off}</b></span>`:''}
     <span class="ds-sum">つなげるデータ <b>${(qjState.sources||[]).length}</b> 件</span>
    </div>
    <div class="ds-summary-act">
     <button type="button" class="mm-btn-ghost" id="qjSourceBtn" title="データ接続の登録へ移ります">データ接続…</button>
     <button type="button" class="mm-btn-primary" id="qjAddBtn"${few?' disabled':''}>＋ 結合を追加</button>
    </div>
   </div>
   <p class="mm-def-hint">${few
     ?'<b>つなげるデータが足りません。</b>結合には登録済みのデータ接続が2件以上要ります。'
     :'一覧を開いたときに、<b>相手のデータから列を足して</b>表示します。足した列は並べ替え・絞り込みの対象にはなりませんが、'
      +'列の設定（幅・表示名・書式・読み替え）はふつうの列と同じように効き、<b>スケジュール表の内容欄でも選べます</b>。'}</p>`;
  form.onsubmit=ev=>ev.preventDefault();
  const add=$('#qjAddBtn');if(add)add.onclick=()=>openQueryJoinEditor(null);
  const src=$('#qjSourceBtn');
  if(src)src.onclick=()=>document.querySelector('#masterMaintNav [data-master="dataSource"]')?.click();
 }
 function renderQueryJoinList(){
  const list=$('#masterMaintList');if(!list)return;
  const head=QJ_LIST_COLS.map(c=>`<span class="ds-h qj-c-${c.k}">${esc(c.label)}</span>`).join('');
  const rows=qjState.items.map(qjRowHtml).join('');
  /* 既定の品質データ結合は**保存されていない**が、効いているものは画面に
     出す(§9.129「出どころを画面に出す」)。出さないと「登録していないのに
     列が増える」ことになり、どこの設定か探すはめになる。 */
  /* 既定の品質データ結合は**解除できる**(§9.194、利用者の指示)。解除しても
     内容は見えたままにする——「どうつないでいるのか」を見て真似できることが
     値打ちなので、解除＝見えなくする、にはしない。 */
  const bOn=qjState.builtinEnabled!==false;
  const bKind=qjKind((qjState.builtin||{}).kind||qjState.kindDefault);
  const b=qjState.builtin?`<div class="ds-row qj-row is-builtin${bOn?'':' is-off'}">
    <span class="qj-c-state"><span class="ds-listed${bOn?'':' is-off'}">${bOn?'既定':'解除中'}</span></span>
    <span class="qj-c-name"><b class="ds-name">${esc(qjState.builtin.name)}</b></span>
    <span class="qj-c-left">${esc(qjSourceLabel(qjState.builtin.left))}</span>
    <span class="qj-c-right">${esc(qjSourceLabel(qjState.builtin.right))}</span>
    <span class="qj-c-keys">${esc((qjState.builtin.keys||[]).map(k=>k.left).join('・'))}</span>
    <span class="qj-c-kind">${esc(bKind?bKind.label:'左外部結合')}</span>
    <span class="qj-c-cols">相手の全列</span>
    <span class="qj-c-act">
     <button type="button" class="mm-btn-ghost sm" id="qjBuiltinCopy">複製して編集</button>
     <button type="button" class="mm-btn-ghost sm" id="qjBuiltinToggle">${bOn?'解除する':'既定に戻す'}</button>
    </span>
    <span class="ds-c-note">${bOn
      ?'役割「仕掛」と「品質」が揃っているので自動で効いています。同じ相手への結合を登録すると、そちらが優先されます。「複製して編集」で、この設定を下敷きにした結合を作れます。'
      :'解除中です。品質データの列は一覧に出ません（<b>エラーにはなりません</b>——足していた列が無くなるだけで、その列を見ていた設定は静かに落ちます）。品質データは相手として選べるので、自分で結合を登録すれば出せます。'}</span>
   </div>`:'';
  if(!rows&&!b){
   list.innerHTML='<div class="mm-empty">結合はまだ登録されていません。「＋ 結合を追加」から登録してください。</div>';
   return;
  }
  list.innerHTML=`<div class="ds-rows">
    <div class="ds-row qj-row ds-row-head">${head}</div>${b}${rows}</div>`;
  list.querySelectorAll('[data-qj-edit]').forEach(btn=>btn.onclick=()=>{
   const x=qjState.items.find(i=>String(i.id)===btn.dataset.qjEdit);if(x)openQueryJoinEditor(x);
  });
  list.querySelectorAll('[data-qj-del]').forEach(btn=>btn.onclick=()=>qjDelete(btn.dataset.qjDel));
  const tg=$('#qjBuiltinToggle');if(tg)tg.onclick=()=>qjToggleBuiltin(!bOn);
  const cp=$('#qjBuiltinCopy');if(cp)cp.onclick=()=>openQueryJoinEditor(qjBuiltinDraft(),{copy:true});
 }
 /* 既定の結合を下敷きにした「新規の1件」。**IDを持たせない**——上書きでは
    なく複製なので、保存すると普通の登録として1行増える。 */
 function qjBuiltinDraft(){
  const b=qjState.builtin||{};
  return {id:null,name:`${b.name||'品質データ'}（複製）`,
          left:b.left||'',leftTable:b.leftTable||'',right:b.right||'',rightTable:b.rightTable||'',
          keys:(b.keys||[]).map(k=>({left:k.left,right:k.right})),
          columns:[],prefix:'',multi:b.multi||'first',kind:b.kind||qjState.kindDefault,
          order:(qjState.items.length+1)*10,active:true};
 }
 async function qjToggleBuiltin(on){
  const uid=requireMaintUser();if(uid===null)return;
  if(!on&&!confirm('既定の品質データ結合を解除します。\n品質データの列（鋳造番号・製造材質・検査結果など）は一覧に出なくなります。\nエラーにはならず、その列を見ていた設定は静かに落ちます。よろしいですか？'))return;
  try{
   setMaintLoading(true,on?'既定に戻しています…':'解除しています…');
   const r=await api('/api/query-join-master/builtin',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:on,user_id:uid})});
   qjState.loaded=false;await loadQueryJoinMaint(true);
   window.invalidateTableCache&&window.invalidateTableCache();
   showToast&&showToast(on?'既定に戻しました':'既定を解除しました',(r&&r.message)||'一覧を開き直すと反映されます',4500);
  }catch(e){showToast&&showToast('切り替えられませんでした',e.message,6000)}
  finally{setMaintLoading(false)}
 }
 function qjRowHtml(x){
  const keys=(x.keys||[]).map(k=>k.left===k.right?k.left:`${k.left}＝${k.right}`).join('・');
  const kind=qjKind(x.kind||qjState.kindDefault);
  const cols=(x.columns||[]).length?`${x.columns.length}列を選択`:'相手の全列';
  const missing=[];
  if(!(qjState.sources||[]).some(s=>s.key===x.left))missing.push('足す先');
  if(!(qjState.sources||[]).some(s=>s.key===x.right))missing.push('相手');
  return `<div class="ds-row qj-row${x.active?'':' is-off'}${missing.length?' is-pending':''}">
   <span class="qj-c-state"><span class="ds-listed${x.active?'':' is-off'}">${x.active?'有効':'停止中'}</span></span>
   <span class="qj-c-name"><b class="ds-name" title="${esc(x.name)}">${esc(x.name)}</b>
    ${x.prefix?`<code class="ds-key" title="足す列の名前に付ける文字">${esc(x.prefix)}…</code>`:''}</span>
   <span class="qj-c-left" title="${esc(x.left+(x.leftTable?' / '+x.leftTable:''))}">${
     esc(qjSourceLabel(x.left))}${x.leftTable?`<i class="qj-sub">${esc(x.leftTable)}</i>`:''}</span>
   <span class="qj-c-right" title="${esc(x.right+(x.rightTable?' / '+x.rightTable:''))}">${
     esc(qjSourceLabel(x.right))}${x.rightTable?`<i class="qj-sub">${esc(x.rightTable)}</i>`:''}</span>
   <span class="qj-c-keys" title="${esc(keys)}">${esc(keys||'—')}</span>
   <span class="qj-c-kind" title="${esc(kind?kind.summary:'')}">${esc(kind?kind.label:'左外部結合')}</span>
   <span class="qj-c-cols">${esc(cols)}</span>
   <span class="qj-c-act">
    <button type="button" class="mm-btn-ghost sm" data-qj-edit="${esc(String(x.id))}">編集</button>
    <button type="button" class="mm-btn-ghost sm" data-qj-del="${esc(String(x.id))}">削除</button>
   </span>
   ${missing.length?`<span class="ds-c-note">${esc(missing.join('と'))}のデータ接続が見つかりません（無効にした・キーを変えた・再起動していない、のいずれかです）。この結合は当たりません。</span>`:''}
  </div>`;
 }
 async function qjDelete(id){
  const x=qjState.items.find(i=>String(i.id)===String(id));if(!x)return;
  if(!confirm(`結合「${x.name}」を削除します。\nこの結合で足していた列は一覧から消えます。よろしいですか？`))return;
  const uid=requireMaintUser();if(uid===null)return;
  try{
   setMaintLoading(true,'削除しています…');
   await api('/api/query-join-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:x.id,user_id:uid})});
   qjState.loaded=false;await loadQueryJoinMaint(true);
   window.invalidateTableCache&&window.invalidateTableCache();
   showToast&&showToast('削除しました','一覧を開き直すと反映されます',4000);
  }catch(e){showToast&&showToast('削除に失敗しました',e.message,5000)}
  finally{setMaintLoading(false)}
 }
 /* 列の名前は**名前だけを引く**(/api/table-columns)。`/api/table`を叩くと
    実データ200列ぶんの行まで運ぶことになる(§9.94)。1度引いたら覚える。 */
 async function qjColumns(db,table){
  const key=db+'\t'+(table||'');
  if(qjState.cols[key])return qjState.cols[key];
  if(!db)return {tables:[],columns:[]};
  try{
   const q=new URLSearchParams({db:db,samples:'1'});if(table)q.set('table',table);
   const r=await api('/api/table-columns?'+q.toString());
   const v={tables:r.tables||[],columns:r.columns||[],table:r.table||'',
            normalized:r.normalized||{},samples:r.samples||{}};
   qjState.cols[key]=v;
   if(!table&&v.table)qjState.cols[db+'\t'+v.table]=v;
   return v;
  }catch(e){
   const v={tables:[],columns:[],normalized:{},samples:{},error:e.message};
   qjState.cols[key]=v;return v;
  }
 }
 function openQueryJoinEditor(item,opts){
  const modal=ensureMaintEditor();
  /* **中身が縦に長いのでスクロールさせる**(§9.197)。データ接続の編集窓は
     「スクロールさせない代わりに大きく取る」(§9.168)ため
     `.is-wide .mm-editor-body{overflow:hidden}`にしてあり、そのままだと
     ここは**下の節（結果の下見）が丸ごと切れて見えなかった**（実機で
     「モーダル内で表示が一部切れている」と指摘）。 */
  const dlg=modal.querySelector('.mm-editor-dialog');
  if(dlg){dlg.classList.add('is-wide');dlg.classList.add('is-tall')}
  const sources=qjState.sources||[];
  const copy=!!(opts&&opts.copy);
  qjState.editing=item?JSON.parse(JSON.stringify(item)):{
   id:null,name:'',left:(sources.find(s=>s.purpose==='仕掛')||sources[0]||{}).key||'',
   leftTable:'',right:(sources.find(s=>s.purpose==='品質')||sources[1]||sources[0]||{}).key||'',
   rightTable:'',keys:[],columns:[],prefix:'',multi:'first',
   kind:qjState.kindDefault||'left',
   order:(qjState.items.length+1)*10,active:true};
  if(!qjState.editing.kind)qjState.editing.kind=qjState.kindDefault||'left';
  qjState.probe=null;qjState.probeSig='';
  /* **開くたびに選びかけ・絞り込みを白紙へ**——前に開いた結合の状態が
     残っていると、押していないのに列が選ばれているように見える。 */
  qjState.pick=null;qjState.search={left:'',right:''};
  $('#maintEditorEyebrow').textContent='クエリ結合';
  $('#maintEditorTitle').textContent=copy?'既定の結合を下敷きに作る'
    :(item&&item.id?`${item.name} を編集`:'結合を追加');
  $('#maintEditorHint').textContent='足した列は一覧を開き直すと反映されます（サーバー再起動は要りません）。';
  $('#maintEditorSave').textContent=(item&&item.id)?'更新を保存':'追加登録';
  $('#maintEditorSave').onclick=()=>saveQueryJoinEditor();
  renderQueryJoinEditor();
  modal.hidden=false;
  qjRefreshColumns();
 }
 function qjEdit(){return qjState.editing||{}}
 function renderQueryJoinEditor(){
  const form=$('#maintEditorForm');if(!form)return;
  form.innerHTML=qjEditorHtml(qjEdit());
  form.onsubmit=ev=>{ev.preventDefault();saveQueryJoinEditor()};
  qjBindEditor(form);
 }
 function qjOptions(list,sel,blank){
  const head=blank?`<option value=""${sel?'':' selected'}>${esc(blank)}</option>`:'';
  return head+list.map(v=>{
   const value=typeof v==='string'?v:v.value;
   const label=typeof v==='string'?v:v.label;
   return `<option value="${esc(value)}"${value===sel?' selected':''}>${esc(label)}</option>`;
  }).join('');
 }
 function qjSourceOptions(sel){
  return qjOptions((qjState.sources||[]).map(s=>({
   value:s.key,
   label:(s.label||s.key)+(s.purpose?`（${s.purpose}）`:'')+(s.listed?'':'・一覧に出さない')})),sel,'選んでください');
 }
 /* ---------- 突合キーは「両側の列を並べて結ぶ」(§9.197、利用者の指示) ----------
    以前は`<select>`を左右に並べた行で、①どんな列があるのか探せない
    ②いま何と何が結ばれているのかが読み取りにくい ③選ぶ相手のデータ・表が
    ただのプルダウンで「どのファイルのどの表を見ているのか」が画面に出て
    いない、という状態だった（実機で「対象ファイルを選ぶところの視覚表示が
    少なくわかりづらい」と指摘）。
    **EXCELのパワークエリのマージと同じ作法**にする——左右に表を1枚ずつ置き、
    列を1つずつ押す（またはドラッグして重ねる）と、その2列が結ばれる。
    結ばれた列には両側に同じ「鍵N」の印が付き、下に組の一覧が出る。 */
 function qjSampleText(c,col){
  const v=((c.samples||{})[col]||[]).slice(0,3);
  return v.join(' / ');
 }
 function qjSide(x,side){
  const db=side==='left'?x.left:x.right;
  const table=side==='left'?x.leftTable:x.rightTable;
  const key=db+'\t'+(table||'');
  return {db,table,c:qjState.cols[key]||{},loaded:!!qjState.cols[key]};
 }
 /* この列が何番目の鍵か（0=鍵ではない）。**両側に同じ番号を出す**ので、
    どの列とどの列が組んでいるのかが列の一覧だけで読める。 */
 function qjKeyIndexOf(x,side,col){
  const arr=x.keys||[];
  for(let i=0;i<arr.length;i++)if((side==='left'?arr[i].left:arr[i].right)===col)return i+1;
  return 0;
 }
 /* 同じ名前の列を候補として出す。**名前のゆれを吸収する規則は画面に
    書かない**——サーバーが返した正規化済みの名前(normalized)どうしを
    比べるだけにする(§9.163)。 */
 function qjSuggestPairs(x,lc,rc){
  const ln=lc.normalized||{},rn=rc.normalized||{};
  if(!Object.keys(ln).length||!Object.keys(rn).length)return [];
  const byNorm={};Object.keys(rn).forEach(c=>{if(!(rn[c] in byNorm))byNorm[rn[c]]=c});
  const used=new Set((x.keys||[]).map(k=>k.left+'\t'+k.right));
  const out=[];
  Object.keys(ln).forEach(c=>{
   const hit=byNorm[ln[c]];
   if(!hit)return;
   if(used.has(c+'\t'+hit))return;
   out.push({left:c,right:hit});
  });
  return out;
 }
 /* 列の一覧。**実データの例を必ず添える**——キーが合うかどうかは形を見れば
    分かる（L0001 と A-1 は突き合わない）ので、選ぶ前に出す。 */
 function qjFieldsHtml(side){
  const x=qjEdit(),s=qjSide(x,side);
  const cols=s.c.columns||[];
  /* **「読めていない」と「選んでいない」を分ける**——同じ空欄にすると、
     待てばよいのか操作が要るのかが分からない。 */
  if(!cols.length)return `<p class="qj-fields-empty">${
    s.c.error?esc(s.c.error)
    :(!s.db?'データを選ぶと、列がここに並びます。'
     :(s.loaded?'この表には列がありません。':'列を読み込んでいます…'))}</p>`;
  const q=String((qjState.search||{})[side]||'').trim().toLowerCase();
  const hit=cols.filter(c=>!q||String(c).toLowerCase().includes(q));
  if(!hit.length)return `<p class="qj-fields-empty">「${esc(q)}」に当てはまる列がありません。</p>`;
  const pick=qjState.pick;
  const other=side==='left'?'相手':'この一覧';
  return hit.map(c=>{
   const n=qjKeyIndexOf(x,side,c);
   const on=!!(pick&&pick.side===side&&pick.col===c);
   const eg=qjSampleText(s.c,c);
   return `<button type="button" class="qj-field${n?' is-key':''}${on?' is-pick':''}" draggable="true"`
    +` data-qj-fld="${side}" data-col="${esc(c)}"`
    +` title="${esc(c)}${eg?'\n例: '+eg:''}\n押してから${esc(other)}の列を押すと結び付きます（ドラッグして重ねても同じです）">`
    +`<span class="qj-fld-name">${esc(c)}</span>`
    +(eg?`<span class="qj-fld-eg">${esc(eg)}</span>`
        :'<span class="qj-fld-eg is-empty">先頭20行が空</span>')
    +(n?`<i class="qj-fld-key">鍵${n}</i>`:'')
    +`</button>`;
  }).join('');
 }
 /* **次にすることを1つだけ指す**(§2)。選んでいる列があるときは「次に反対側を
    押す」、無いときは「1つずつ押す」。 */
 function qjStatusHtml(){
  const x=qjEdit(),p=qjState.pick;
  const n=(x.keys||[]).length;
  if(p){
   const here=p.side==='left'?'この一覧':'相手';
   const other=p.side==='left'?'相手':'この一覧';
   return `<span class="qj-status-now">${esc(here)}の<b>${esc(p.col)}</b>を選んでいます。`
    +`次に${esc(other)}の列を押すと結び付きます</span>`
    +`<button type="button" class="qj-status-cancel" id="qjPickCancel">選ぶのをやめる</button>`;
  }
  return n
   ?`<span class="qj-status-now">突合キーは<b>${n}</b>組。列をもう1組押せば足せます</span>`
   :'<span class="qj-status-now"><b>突合キーがまだありません。</b>'
    +'左右の列を1つずつ押すか、片方をもう片方へドラッグしてください</span>';
 }
 /* 結ばれた組。**外す手立てを組の隣に置く**——一覧の下に別の「外す」を
    並べると、どの組を外すのか数え直すことになる。 */
 function qjPairsHtml(x){
  const keys=x.keys||[];
  if(!keys.length)return '';
  const L=qjSide(x,'left').c,R=qjSide(x,'right').c;
  const gone=(col,side)=>{const cs=(side==='left'?L:R).columns;return !!(cs&&cs.length&&!cs.includes(col))};
  return keys.map((k,i)=>{
   const bad=gone(k.left,'left')||gone(k.right,'right');
   return `<span class="qj-pair${bad?' is-missing':''}" data-qj-pair="${i}">`
    +`<i class="qj-pair-no">鍵${i+1}</i>`
    +`<b>${esc(k.left)}</b><i class="qj-pair-eq">＝</i><b>${esc(k.right)}</b>`
    +(bad?'<i class="qj-pair-warn">いま選んでいる表にこの列がありません</i>':'')
    +`<button type="button" class="qj-pair-del" data-qj-keydel="${i}" title="この組を外す">×</button>`
    +`</span>`;
  }).join('');
 }
 /* 片側の表。**どのデータのどの表を見ているのかを画面に出す**——列数と表名を
    添えると、選び間違いがその場で分かる(以前はプルダウンだけだった)。 */
 function qjPaneHtml(side){
  const x=qjEdit(),s=qjSide(x,side);
  const isL=side==='left';
  const cnt=(s.c.columns||[]).length;
  const meta=cnt
   ?`表: <b>${esc(s.c.table||s.table||'—')}</b> ／ <b>${cnt}</b>列`
   :(s.c.error?`<span class="is-warn">${esc(s.c.error)}</span>`:'列を読み込んでいます…');
  return `<div class="qj-pane" data-qj-pane="${side}">
   <div class="qj-pane-head">
    <span class="qj-pane-tag${isL?'':' is-right'}">${isL?'この一覧（足す先）':'相手（持ってくる側）'}</span>
    <select data-qj-field="${isL?'left':'right'}" data-qj-re aria-label="${isL?'足す先のデータ':'相手のデータ'}">${
      qjSourceOptions(isL?x.left:x.right)}</select>
    <select data-qj-field="${isL?'leftTable':'rightTable'}" data-qj-re aria-label="表">${
      qjOptions(s.c.tables||[],(isL?x.leftTable:x.rightTable)||'',isL?'どの表でも':'既定の表')}</select>
    <span class="qj-pane-meta">${meta}</span>
   </div>
   <input type="search" class="qj-search" data-qj-search="${side}" placeholder="列名で絞り込み"
     value="${esc((qjState.search||{})[side]||'')}" autocomplete="off" spellcheck="false">
   <div class="qj-fields" data-qj-list="${side}">${qjFieldsHtml(side)}</div>
  </div>`;
 }
 function qjEditorHtml(x){
  const lc=qjSide(x,'left').c,rc=qjSide(x,'right').c;
  const kind=qjKind(x.kind)||{};
  const sugg=qjSuggestPairs(x,lc,rc);
  const suggHtml=sugg.length?`<div class="qj-sugg">
    <span class="qj-sugg-label">同じ名前の列:</span>
    ${sugg.slice(0,6).map(pp=>`<button type="button" class="qj-sugg-btn" data-qj-sugg="${esc(pp.left)}\t${esc(pp.right)}">${esc(pp.left)}${pp.left===pp.right?'':' ＝ '+esc(pp.right)}</button>`).join('')}
    ${sugg.length>1?`<button type="button" class="mm-btn-ghost sm" id="qjKeyAuto">${sugg.length}組すべて足す</button>`:''}
   </div>`:'';
  const kindCards=(qjState.kinds||[]).map(k=>`<label class="qj-kind${k.key===kind.key?' is-on':''}">
    <input type="radio" name="qjKind" value="${esc(k.key)}" data-qj-re${k.key===kind.key?' checked':''}>
    ${qjVennHtml(k,'card')}
    <b>${esc(k.label)}</b>
    <span class="qj-kind-short">${esc(k.short)}</span>
    <span class="qj-kind-rows">${esc(qjRowEffect(k))}</span>
   </label>`).join('');
  const pickAll=!(x.columns||[]).length;
  const colList=(rc.columns||[]).filter(c=>!(x.keys||[]).some(k=>k.right===c));
  return `<div class="qj-edit">
   <section class="qj-sec qj-sec-name">
    <h4 class="mm-fieldgroup">① これは何か</h4>
    <div class="qj-name-row">
     <label class="mm-field qj-f-name"><span>結合名</span>
      <input data-qj-field="name" type="text" value="${esc(x.name||'')}" required autocomplete="off" spellcheck="false">
      <small class="mm-field-hint">一覧の帯と、列の設定パネルの「結合」欄に出ます。</small></label>
     <label class="mm-field qj-f-order"><span>表示順</span>
      <input data-qj-field="order" type="number" min="0" max="9999" value="${esc(String(x.order==null?0:x.order))}">
      <small class="mm-field-hint">小さいほど先に当たります。</small></label>
     <label class="mm-field qj-f-enabled"><span>使う / 使わない</span>
      <select data-qj-field="enabled" data-qj-re>${qjOptions(['有効','無効'],x.active===false?'無効':'有効')}</select>
      <small class="mm-field-hint">「無効」にすると列を足しません（設定は残ります）。</small></label>
    </div>
   </section>
   <section class="qj-sec qj-sec-merge">
    <h4 class="mm-fieldgroup">② つなぐ2つのデータと突合キー</h4>
    <div class="qj-merge">
     ${qjPaneHtml('left')}
     <div class="qj-merge-mid" aria-hidden="true"><span class="qj-merge-eq">＝</span></div>
     ${qjPaneHtml('right')}
    </div>
    <p class="qj-merge-status">${qjStatusHtml()}</p>
    <div class="qj-pairs">${qjPairsHtml(x)}</div>
    ${suggHtml}
    <p class="mm-field-hint">すべてのキーが一致した行だけを結び付けます。全角/半角と前後の空白は無視します。
     選べるのは<b>データ接続に登録してあるデータ</b>だけです（一覧に出していないデータも選べます）。</p>
   </section>
   <section class="qj-sec qj-sec-kind">
    <h4 class="mm-fieldgroup">③ 結合の仕方 — <span class="qj-kind-now">${esc(kind.label||'')}</span></h4>
    ${kindCards?`<div class="qj-kinds">${kindCards}</div>
    <div class="qj-kind-detail">
     <p class="qj-kind-summary">${esc(kind.summary||'')}</p>
     <p class="mm-field-hint">${esc(kind.when||'')}</p>
     ${qjSampleHtml(kind)}
     ${kind.rightOnly?'<p class="mm-field-hint is-warn">「相手にしかない行」を出すため、<b>相手の表を全部読みます</b>。また、一致しているかどうかはこの一覧の全行と突き合わせます（表示中のページだけでは決めません）。</p>':''}
    </div>`:'<p class="mm-field-hint">結合の仕方の一覧を読めませんでした。左外部結合（この一覧は全部残す）として扱います。</p>'}
   </section>
   <section class="qj-sec qj-sec-add">
    <h4 class="mm-fieldgroup">④ 何を足すか</h4>
    ${(kind.key&&!kind.matched&&!kind.rightOnly)?`<p class="mm-field-hint">
      <b>この結合は列を足しません。</b>「${esc(kind.label)}」は相手に当たらなかった行だけを残す使い方なので、
      相手の値がありません（足しても全部空欄になります）。列を足したいときは、③で
      「${esc((qjKind('left')||{}).label||'左外部結合')}」などを選んでください。</p>`:`
    <div class="qj-pick">
     <label class="qj-radio"><input type="radio" name="qjPick" value="all" data-qj-re${pickAll?' checked':''}>
      <span>相手の列をすべて</span></label>
     <label class="qj-radio"><input type="radio" name="qjPick" value="some" data-qj-re${pickAll?'':' checked'}>
      <span>選んだ列だけ<i>（${(x.columns||[]).length}列を選択中）</i></span></label>
    </div>
    ${pickAll?'':`<div class="qj-cols">${colList.length?colList.map(c=>
      `<label class="qj-col"><input type="checkbox" data-qj-col="${esc(c)}"${(x.columns||[]).includes(c)?' checked':''}><span>${esc(c)}</span></label>`
     ).join(''):'<p class="mm-field-hint">相手の列がまだ分かりません。②でデータと表を選んでください。</p>'}</div>`}
    <div class="qj-add-opts">
     <label class="mm-field"><span>足す列の名前に付ける文字</span>
      <input data-qj-field="prefix" type="text" value="${esc(x.prefix||'')}" maxlength="20" autocomplete="off" spellcheck="false" placeholder="例: 品質_">
      <small class="mm-field-hint">空のままだと、一覧に同じ名前の列があるものは<b>足しません</b>（元の一覧の値を残します）。付けると両方を並べられます。</small></label>
     <label class="mm-field"><span>相手が2件以上あったら</span>
      <select data-qj-field="multi" data-qj-re>${qjOptions(
        Object.keys(QJ_MULTI_LABEL).map(v=>({value:v,label:QJ_MULTI_LABEL[v]})),x.multi||'first')}</select>
      <small class="mm-field-hint">当たった件数は下の「結果」に出ます。</small></label>
    </div>`}
   </section>
   <section class="qj-sec qj-sec-result">
    <h4 class="mm-fieldgroup">⑤ 結果（保存する前の下見） <span class="ds-probe-state" id="qjProbeState"></span></h4>
    <div id="qjProbeBox" class="ds-probe"></div>
   </section>
  </div>`;
 }
 function qjBindEditor(form){
  form.querySelectorAll('[data-qj-field]').forEach(el=>{
   const k=el.dataset.qjField;
   const commit=()=>{
    const x=qjEdit();
    if(k==='enabled')x.active=el.value!=='無効';
    else if(k==='order')x.order=parseInt(el.value||'0',10)||0;
    else x[k]=el.value;
    if(k==='left')x.leftTable='';
    if(k==='right'){x.rightTable='';x.columns=[]}
    /* **データを取り替えたら組は外す**(§9.197)。以前は片側だけを空にして
       組の行を残していたが、列の一覧そのものが入れ替わるので、残しても
       当たらない組が並ぶだけだった。選び直しは列を押すだけで済む。
       表(leftTable/rightTable)を変えただけのときは残す——同じ列名が
       あることが多く、無ければ組の側に「この表にありません」と出る。 */
    if(k==='left'||k==='right'){x.keys=[];qjState.pick=null}
    /* 表を変えると列の一覧が入れ替わる。**選びかけは捨てる**——残すと
       いま一覧に無い列を「選んでいます」と言い続ける。 */
    if(k==='leftTable'||k==='rightTable')qjState.pick=null;
   };
   /* **値の入力中に組み直さないこと**(§9.117)。文字を打つたびに入力欄が
      作り替わるとカーソルが飛ぶ。組み直すのは選択肢(data-qj-re)だけ。 */
   if(el.matches('[data-qj-re]'))el.onchange=()=>{commit();renderQueryJoinEditor();qjRefreshColumns()};
   else{el.oninput=()=>{commit();qjProbeSoon()};el.onchange=()=>commit()}
  });
  form.querySelectorAll('[name="qjKind"]').forEach(el=>el.onchange=()=>{
   if(!el.checked)return;
   qjEdit().kind=el.value;
   renderQueryJoinEditor();qjProbeSoon(0);
  });
  form.querySelectorAll('[data-qj-sugg]').forEach(el=>el.onclick=()=>{
   const [l,r]=String(el.dataset.qjSugg||'').split('\t');
   qjAddKey(l,r);
  });
  const auto=form.querySelector('#qjKeyAuto');
  if(auto)auto.onclick=()=>{
   const x=qjEdit();
   const lc=qjState.cols[x.left+'\t'+(x.leftTable||'')]||{};
   const rc=qjState.cols[x.right+'\t'+(x.rightTable||'')]||{};
   qjSuggestPairs(x,lc,rc).forEach(pp=>qjAddKey(pp.left,pp.right,true));
   renderQueryJoinEditor();qjProbeSoon(0);
  };
  /* 組を外す。**空の組は作らない**——押すたびに空行が増えると、そのぶん
     「外す」を押させることになる(§9.197で行そのものを廃止した)。 */
  form.querySelectorAll('[data-qj-keydel]').forEach(el=>el.onclick=()=>{
   const x=qjEdit();x.keys.splice(+el.dataset.qjKeydel,1);
   qjState.pick=null;
   renderQueryJoinEditor();qjProbeSoon(0);
  });
  /* 列名の絞り込み。**一覧だけを描き直す**(§9.117)——入力欄を作り替えると
     1文字ごとにカーソルが飛ぶ。 */
  form.querySelectorAll('[data-qj-search]').forEach(el=>{
   el.oninput=()=>{
    qjState.search=qjState.search||{};
    qjState.search[el.dataset.qjSearch]=el.value;
    qjRenderFieldList(el.dataset.qjSearch);
   };
   /* **Enterで保存させないこと。** この欄はフォームの中にあるので、
      既定では Enter が送信＝「追加登録」になる（絞り込むつもりで打った
      Enter で登録されてしまう）。 */
   el.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();ev.stopPropagation()}};
  });
  qjBindFields(form);
  const cancel=form.querySelector('#qjPickCancel');
  if(cancel)cancel.onclick=()=>{qjState.pick=null;qjRefreshMerge()};
  form.querySelectorAll('[name="qjPick"]').forEach(el=>el.onchange=()=>{
   const x=qjEdit();
   if(el.value==='all'&&el.checked)x.columns=[];
   else if(el.checked&&!x.columns.length){
    const rc=qjState.cols[x.right+'\t'+(x.rightTable||'')]||{};
    x.columns=(rc.columns||[]).filter(c=>!(x.keys||[]).some(k=>k.right===c)).slice(0,20);
   }
   renderQueryJoinEditor();qjProbeSoon(0);
  });
  form.querySelectorAll('[data-qj-col]').forEach(el=>el.onclick=()=>{
   /* チェックは`click`で受ける(§9.90)。`change`は`click`の後に飛ぶため、
      行のクリックで組み直す作りだと反映されない。 */
   const x=qjEdit(),c=el.dataset.qjCol;
   if(el.checked){if(!x.columns.includes(c))x.columns.push(c)}
   else x.columns=x.columns.filter(v=>v!==c);
   qjProbeSoon();
  });
  qjRenderProbe();
 }
 /* 1組足す。**同じ組は増やさない**——同じキーを2回押しても増えないので、
    押し間違いを外す手間が要らない。 */
 function qjAddKey(left,right,quiet){
  if(!left||!right)return;
  const x=qjEdit();
  x.keys=(x.keys||[]).filter(k=>k.left&&k.right);
  if(!x.keys.some(k=>k.left===left&&k.right===right))x.keys.push({left:left,right:right});
  if(!quiet){renderQueryJoinEditor();qjProbeSoon(0)}
 }
 /* ---------- 列を押す／ドラッグして結ぶ(§9.197) ----------
    **どちらの操作でも同じことが起きる**（片方だけ効くと、効かない側を
    「壊れている」と読まれる）。押した1つ目は`qjState.pick`に覚え、
    反対側を押した時点で組にする。同じ側をもう一度押したら選び直し。 */
 function qjBindFields(root){
  (root||document).querySelectorAll('[data-qj-fld]').forEach(el=>{
   const side=el.dataset.qjFld,col=el.dataset.col;
   el.onclick=ev=>{ev.preventDefault();qjPickField(side,col)};
   el.ondragstart=ev=>{
    qjState.pick={side,col};
    try{ev.dataTransfer.setData('text/plain',side+'\t'+col);ev.dataTransfer.effectAllowed='link'}catch(_){}
    el.classList.add('is-pick');
   };
   el.ondragend=()=>{el.classList.remove('is-pick');
    (root||document).querySelectorAll('.qj-field.is-drop').forEach(x=>x.classList.remove('is-drop'))};
   el.ondragover=ev=>{
    const p=qjState.pick;
    if(!p||p.side===side)return;        // 同じ側へ落としても組にならない
    ev.preventDefault();el.classList.add('is-drop');
   };
   el.ondragleave=()=>el.classList.remove('is-drop');
   el.ondrop=ev=>{
    ev.preventDefault();el.classList.remove('is-drop');
    let from=null;
    try{const t=String(ev.dataTransfer.getData('text/plain')||'').split('\t');
        if(t.length===2)from={side:t[0],col:t[1]}}catch(_){}
    if(!from)from=qjState.pick;
    if(!from||from.side===side)return;
    qjState.pick=null;
    qjAddKey(side==='left'?col:from.col,side==='left'?from.col:col);
   };
  });
 }
 function qjPickField(side,col){
  const p=qjState.pick;
  if(p&&p.side!==side){
   qjState.pick=null;
   qjAddKey(side==='left'?col:p.col,side==='left'?p.col:col);
   return;
  }
  qjState.pick=(p&&p.side===side&&p.col===col)?null:{side,col};
  qjRefreshMerge();
 }
 /* 列の一覧だけを差し替える（絞り込みの入力中に呼ぶので、**入力欄には
    触らない**）。 */
 function qjRenderFieldList(side){
  const box=document.querySelector(`[data-qj-list="${side}"]`);
  if(!box)return;
  box.innerHTML=qjFieldsHtml(side);
  qjBindFields(box);
 }
 /* 押した結果をその場に出す。**全部を組み直さない**——組み直すと絞り込みの
    文字とスクロールが巻き戻る。 */
 function qjRefreshMerge(){
  qjRenderFieldList('left');qjRenderFieldList('right');
  const st=document.querySelector('.qj-merge-status');
  if(st){
   st.innerHTML=qjStatusHtml();
   const c=st.querySelector('#qjPickCancel');
   if(c)c.onclick=()=>{qjState.pick=null;qjRefreshMerge()};
  }
 }
 async function qjRefreshColumns(){
  const x=qjEdit();
  const before=JSON.stringify([x.left,x.leftTable,x.right,x.rightTable]);
  await Promise.all([qjColumns(x.left,x.leftTable),qjColumns(x.right,x.rightTable)]);
  // 途中で選び直されていたら、そのときの結果で描き直す側に任せる。
  if(JSON.stringify([x.left,x.leftTable,x.right,x.rightTable])!==before)return;
  renderQueryJoinEditor();
  qjProbeSoon(0);
 }
 let qjProbeTimer=null;
 function qjProbeSoon(delay){
  clearTimeout(qjProbeTimer);
  qjProbeTimer=setTimeout(qjProbe,delay==null?450:delay);
 }
 async function qjProbe(){
  const x=qjEdit();
  const body={left:x.left,leftTable:x.leftTable,right:x.right,rightTable:x.rightTable,
              keys:(x.keys||[]).filter(k=>k.left&&k.right),columns:x.columns,
              prefix:x.prefix,multi:x.multi,kind:x.kind||qjState.kindDefault,
              name:x.name||'(下見)'};
  const sig=JSON.stringify(body);
  if(sig===qjState.probeSig)return;
  qjState.probeSig=sig;
  const seq=++qjState.probeSeq;
  qjState.probing=true;qjRenderProbe();
  try{
   const r=await api('/api/query-join-master/probe',{quiet:true,method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(seq!==qjState.probeSeq)return;
   qjState.probe=r.result||null;
  }catch(e){
   if(seq!==qjState.probeSeq)return;
   qjState.probe={ok:false,reason:e.message,sampled:0,matched:0,ambiguous:0,
                  addedColumns:0,addedColumnNames:[],table:'',examples:[]};
  }finally{
   if(seq===qjState.probeSeq){qjState.probing=false;qjRenderProbe()}
  }
 }
 function qjRenderProbe(){
  const box=$('#qjProbeBox'),state=$('#qjProbeState');if(!box)return;
  if(state)state.textContent=qjState.probing?'確かめています…':'';
  const p=qjState.probe;
  if(!p){box.innerHTML='<p class="mm-field-hint">突合キーを選ぶと、いまのデータで当ててみた結果がここに出ます。</p>';return}
  /* **色だけで伝えない**(§3)。当たった件数・足す列数・実例を文字で出す。 */
  const names=(p.addedColumnNames||[]);
  const cols=p.addedColumns?`<b>${p.addedColumns}</b> 列を足します`:'列は足しません';
  const head=p.ok
   ?`<p class="qj-probe-ok"><b>${p.matched}</b> / ${p.sampled} 行に当たりました。${cols}（相手の表: ${esc(p.table||'—')}）。</p>`
   :`<p class="qj-probe-ng">当たりませんでした。${esc(p.reason||'')}</p>`;
  /* **行が増減することは必ず文字で言う**(§9.194)。結合の仕方によっては
     一覧から行が消える／相手の行が増えるので、黙って変えると「絞り込んで
     いないのに件数が合わない」としか見えない。 */
  const rowLine=(p.ok&&(p.droppedRows||p.addedRows))
   ?`<p class="qj-probe-rows">行数: ${p.sampled} → <b>${p.rowsAfter}</b>`
     +(p.droppedRows?`／一致しない ${p.droppedRows} 行は出しません`:'')
     +(p.addedRows?`／相手にしかない ${p.addedRows} 行が増えます`:'')+'</p>'
   :'';
  const noteLine=p.note?`<p class="mm-field-hint">${esc(p.note)}</p>`:'';
  const amb=p.ambiguous?`<p class="mm-field-hint">相手が2件以上あったキーが ${p.ambiguous} 件あります（いまの設定: ${esc(QJ_MULTI_LABEL[qjEdit().multi||'first'])}）。</p>`:'';
  const colLine=names.length?`<p class="mm-field-hint">足す列: ${esc(names.slice(0,12).join('・'))}${names.length>12?` ほか${names.length-12}列`:''}</p>`:'';
  /* 実例は3件(§9.105)。1件では「たまたま」と区別が付かない。 */
  const ex=(p.examples||[]).length?`<table class="qj-ex"><thead><tr>${
    Object.keys(p.examples[0]).map(k=>`<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${
    p.examples.map(r=>`<tr>${Object.values(r).map(v=>`<td>${esc(String(v))}</td>`).join('')}</tr>`).join('')
   }</tbody></table>`:'';
  box.innerHTML=head+rowLine+noteLine+amb+colLine+ex;
 }
 async function saveQueryJoinEditor(){
  const x=qjEdit();
  const uid=requireMaintUser();if(uid===null)return;
  const body={id:x.id,user_id:uid,name:x.name,left:x.left,leftTable:x.leftTable,
              right:x.right,rightTable:x.rightTable,
              keys:(x.keys||[]).filter(k=>k.left&&k.right),columns:x.columns,
              prefix:x.prefix,multi:x.multi,kind:x.kind||qjState.kindDefault,order:x.order,
              enabled:x.active===false?'無効':'有効'};
  try{
   setMaintLoading(true,'保存しています…');
   const url=x.id?'/api/query-join-master/update':'/api/query-join-master';
   const r=await api(url,{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify(body)});
   closeMaintEditor();
   qjState.loaded=false;await loadQueryJoinMaint(true);
   /* **一覧の控えを捨てる。** 捨てないと、開き直しても結合前の写しが出て
      「保存したのに何も変わらない」に見える（一覧は問い合わせの結果を
      TTLで覚えている）。 */
   window.invalidateTableCache&&window.invalidateTableCache();
   showToast&&showToast('保存しました',r.message||'一覧を開き直すと反映されます',4000);
  }catch(e){showToast&&showToast('保存できません',e.message,6000)}
  finally{setMaintLoading(false)}
 }
 async function dsDelete(id){
  const x=dsState.items.find(i=>String(i.id)===String(id));if(!x)return;
  if(!confirm(`「${x.label||x.key}」を無効にします。\n一覧から消えるのはサーバー再起動後です。よろしいですか？`))return;
  const uid=requireMaintUser();if(uid===null)return;
  try{
   setMaintLoading(true,'無効にしています…');
   await api('/api/data-source-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:x.id,user_id:uid})});
   dsState.loaded=false;await loadDataSourceMaint(true);
   showToast&&showToast('無効にしました','一覧から消えるのはサーバー再起動後です',5000);
  }catch(e){showToast&&showToast('無効にできませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }

 /* ---- 編集ウィンドウ（スクロールさせない・大きく取る） --------------------
    視覚導線と作業導線を合わせる（①これは何か → ②どこから読むか →
    ③この設定でできること → ④いまの状態）。③は**保存する前に**実際に
    ファイルを開いて確かめた結果で、欄を触るたびに取り直す。 */
 function openDataSourceEditor(item){
  const modal=ensureMaintEditor();
  /* **スクロールさせない**（§9.168）。クエリ結合の窓を先に開いていると
     `is-tall`が残るので、ここで必ず外す。 */
  const dlg=modal.querySelector('.mm-editor-dialog');
  if(dlg){dlg.classList.add('is-wide');dlg.classList.remove('is-tall')}
  dsState.editing=item?Object.assign({},item):null;
  dsState.probe=item?(item.capability||null):null;
  dsState.probePath='';
  const x=dsState.editing||{};
  $('#maintEditorEyebrow').textContent='データ接続';
  $('#maintEditorTitle').textContent=item?`${x.label||x.key} を編集`:'データソースを追加';
  $('#maintEditorHint').textContent='読み込み先の変更はサーバー再起動後に反映されます。';
  $('#maintEditorSave').textContent=item?'更新を保存':'追加登録';
  const form=$('#maintEditorForm');
  form.innerHTML=dsEditorHtml(x,!item);
  form.onsubmit=ev=>{ev.preventDefault();saveDataSourceEditor()};
  /* 保存ボタンはウィンドウ共通（1つしか無い）ので、**開くたびに持ち主を
     決め直す**。汎用CRUDのsubmitMaintのままだと、この画面の入力を
     読まずに空で保存してしまう。 */
  $('#maintEditorSave').onclick=()=>saveDataSourceEditor();
  bindInputHelpers(form);
  form.querySelectorAll('[data-ds-mode]').forEach(r=>r.onchange=()=>{dsSyncMode();dsProbeSoon(0)});
  form.querySelectorAll('[data-field]').forEach(el=>{
   el.addEventListener('change',()=>dsProbeSoon());
   el.addEventListener('input',()=>dsProbeSoon());
  });
  dsSyncMode();dsRenderProbe();
  modal.hidden=false;
  requestAnimationFrame(()=>{const first=form.querySelector('[data-field="label"]');if(first)first.focus()});
  dsProbeSoon(0);
 }
 /* 役割の選択肢。**埋まっている役割にはその行の名前を添える**(§9.193)
    ——選んでから「既に付いています」と断られるのでは、開き直して確かめる
    手間が増えるだけ(§4「できないことは、できないと書く」)。自分が今
    持っている役割は素のまま出す(付け替えではないので断られない)。 */
 function dsPurposeOptions(x){
  const cur=x.purpose||'その他';
  const opt=(v,label,sel)=>`<option value="${esc(v)}"${v===sel?' selected':''}>${esc(label)}</option>`;
  const holders=dsState.purposeHolders||{};
  const list=['その他',...(dsState.purposes||[])];
  return list.map(v=>{
   if(v==='その他')return opt(v,'その他（一覧として見るだけ）',cur);
   const who=String(holders[v]||'');
   const taken=who&&who!==x.key;
   return opt(v,taken?`${v}（いまは ${who}）`:v,cur);
  }).join('');
 }
 function dsEditorHtml(x,isNew){
  const mode=x.readMode||(x.overridePath?'direct':(x.mode||'share'));
  // 役割「仕掛」は一覧から隠せない（隠すと測定・予定投入の入口が消える）。
  // **選ばせてから断らない**——選べない理由を欄のところに書く（§4）。
  const lockListed=(x.purpose||'')==='仕掛';
  const f=(k,label,val,attrs,hint)=>`<label class="mm-field"><span>${esc(label)}</span>
    <input data-field="${k}" type="text" value="${esc(val==null?'':String(val))}" ${attrs||''} autocomplete="off" spellcheck="false">
    ${hint?`<small class="mm-field-hint">${esc(hint)}</small>`:''}</label>`;
  const pf=(k,label,val,pmode,hint)=>`<div class="mm-field mm-field-path"><span>${esc(label)}</span>
    <span class="mm-path" data-path-drop="${k}">
     <input data-field="${k}" type="text" value="${esc(val==null?'':String(val))}" autocomplete="off" spellcheck="false">
     <button type="button" class="mm-path-browse" data-path-browse="${k}" data-path-mode="${pmode||'file'}">参照…</button>
    </span>${hint?`<small class="mm-field-hint">${esc(hint)}</small>`:''}</div>`;
  const opt=(v,label,sel)=>`<option value="${esc(v)}"${v===sel?' selected':''}>${esc(label)}</option>`;
  /* **RNEが無い端末では、無いと書く**（§9.168、利用者の指摘「RNEがない場合も
     あるのでそのあたりの切り替えもできるように」）。選ばせないのではなく、
     選んだ結果どうなるかを先に言う。 */
  const rneNote=dsState.assets.confExists?''
    :`この端末には接続情報 symnavim.conf がありません（${dsState.assets.assetsDir||''}）。置くまで抽出は動きません。`;
  const modeBlock=m=>{
   if(m.v==='share')return pf('share','共有パスの .sqlite3',x.share,'file',
     'ファイル名だけなら既定の共有フォルダ配下を探します。UNC（\\\\サーバー\\共有\\…）も入れられます。');
   if(m.v==='rne')return `${f('rne','RNE（抽出定義）ファイル',x.rne,'','ファイル名だけなら「RNE資材の置き場」の rne/ 配下です。')}
     ${f('table','抽出テーブル',x.table,'','RNEの中の表の名前。未入力なら「仕掛」です。')}
     ${pf('output','作った .sqlite3 の置き場',x.output,'file','ファイル名だけなら db/ 配下です。')}
     ${rneNote?`<p class="ds-warn">${esc(rneNote)}</p>`:''}`;
   return pf('overridePath','直接読むファイル',x.overridePath,'file',
     '検証や一時的な差し替えに使います。値がある間は上の設定より優先されます。');
  };
  return `<div class="ds-edit">
   <section class="ds-edit-zone">
    <h4 class="mm-fieldgroup">① これは何か</h4>
    ${f('label','表示名',x.label,'required','左メニュー「一覧を見る」に出る名前です。')}
    ${f('key','キー',x.key,'required','半角英数と _。一覧を指す識別子で、変えると この一覧向けの登録フィルタ・表示列の設定が結び付かなくなります。')}
    <label class="mm-field"><span>どのデータとして使うか（役割）</span>
     <select data-field="purpose">${dsPurposeOptions(x)}</select>
     <small class="mm-field-hint">「仕掛」＝測定・予定投入の対象／「品質」＝仕掛の一覧へ結合／「スケジュール」＝作業予定の本体。<b>この3つは各1件だけ</b>で、「その他」は一覧として見るだけです。別のデータをつなげたいときは マスタ管理 &gt; クエリ結合 で結合を登録します（役割は要りません）。</small></label>
    <div class="ds-edit-pair">
     <label class="mm-field"><span>表示順</span>
      <input data-field="order" type="number" min="0" max="9999" value="${esc(String(x.order==null?0:x.order))}">
      <small class="mm-field-hint">小さいほど上に出ます。</small></label>
     <label class="mm-field"><span>使う / 使わない</span>
      <select data-field="enabled">${['有効','無効'].map(v=>opt(v,v,x.enabled||'有効')).join('')}</select>
      <small class="mm-field-hint">「無効」にすると読み込みも抽出も止まります（結合の相手にもなりません）。</small></label>
    </div>
    <label class="mm-field"><span>左メニューの一覧に出す</span>
     <select data-field="listed"${lockListed?' disabled':''}>${
       ['出す','出さない'].map(v=>opt(v,v,(x.listed===false&&!lockListed)?'出さない':'出す')).join('')}</select>
     <small class="mm-field-hint">${lockListed
       ?'役割「仕掛」は測定・予定投入の入口なので、一覧から隠せません。'
       :'「出さない」にしても<b>データは読みます</b>。クエリ結合の相手としてだけ使いたいデータ（品質・単価表など）を、左メニューに並べずに済ませるための設定です。'}</small></label>
   </section>
   <section class="ds-edit-zone">
    <h4 class="mm-fieldgroup">② どこから読むか</h4>
    <div class="ds-modes">${DS_MODES.map(m=>`
     <div class="ds-mode" data-ds-mode-box="${m.v}">
      <label class="ds-mode-pick"><input type="radio" name="dsMode" value="${m.v}" data-ds-mode${m.v===mode?' checked':''}>
       <span><b>${esc(m.label)}</b><i>${esc(m.hint)}</i></span></label>
      <div class="ds-mode-body">${modeBlock(m)}</div>
     </div>`).join('')}</div>
    ${f('preferred','既定テーブル',x.preferred,'','この一覧を開いた直後に選ぶ表の名前。未入力なら抽出テーブルと同じです。')}
   </section>
   <section class="ds-edit-zone ds-edit-result">
    <h4 class="mm-fieldgroup">③ この設定でできること <span class="ds-probe-state" id="dsProbeState"></span></h4>
    <div id="dsProbeBox" class="ds-probe"></div>
   </section>
   <section class="ds-edit-zone ds-edit-now">
    <h4 class="mm-fieldgroup">④ いまの状態</h4>
    <dl class="ds-now">
     <div><dt>いま読んでいる</dt><dd title="${esc(x.activePath||'')}">${esc(x.activePath||(isNew?'（未登録）':'（この端末ではまだ読んでいません）'))}</dd></div>
     <div><dt>保存すると</dt><dd id="dsPlannedPath">—</dd></div>
    </dl>
    <p class="mm-field-hint">読み込み先はサーバー起動時に1回だけ決まります。保存したあとアプリを再起動すると「保存すると」の場所を読みます。</p>
   </section>
  </div>`;
 }
 /* 選んだ読み方の欄だけを開く。**閉じた側も値は残す**ので、切り替えて戻せば
    元の値が入っている。 */
 function dsSyncMode(){
  const form=$('#maintEditorForm');if(!form)return;
  const picked=form.querySelector('[data-ds-mode]:checked');
  const v=picked?picked.value:'share';
  form.querySelectorAll('[data-ds-mode-box]').forEach(box=>{
   box.classList.toggle('is-on',box.dataset.dsModeBox===v);
  });
 }
 function dsDraft(){
  const form=$('#maintEditorForm');if(!form)return null;
  const val=k=>{const el=form.querySelector(`[data-field="${k}"]`);return el?el.value:''};
  const picked=form.querySelector('[data-ds-mode]:checked');
  const pick=picked?picked.value:'share';
  const d={id:dsState.editing?dsState.editing.id:null,
   key:String(val('key')||'').trim().toUpperCase(),label:val('label'),purpose:val('purpose'),
   order:val('order'),enabled:val('enabled'),listed:val('listed')!=='出さない',
   rne:val('rne'),table:val('table'),
   output:val('output'),share:val('share'),preferred:val('preferred'),
   overridePath:String(val('overridePath')||'').trim()};
  /* 「直接読む」以外を選んでいるときは上書きを**空で送る＝解除する**。
     直接指定は保存値を持たず、パス設定マスタの上書きの有無そのものなので、
     選択と実体を必ず一致させる（2箇所に持つと必ず食い違う）。 */
  if(pick!=='direct')d.overridePath='';
  /* 「直接読む」を選んでいる間は、**下の設定（共有かRNEか）をそのまま残す**
     ——直接指定を外したときに、覚えのない読み方へ切り替わらないようにする。 */
  const stored=String((dsState.editing&&dsState.editing.mode)||'').trim();
  d.mode=(pick==='rne')?'rne':(pick==='share'?'share':(stored||'share'));
  return d;
 }
 let dsProbeTimer=null;
 function dsProbeSoon(delay){
  clearTimeout(dsProbeTimer);
  dsProbeTimer=setTimeout(dsProbeRun,delay==null?450:delay);
 }
 async function dsProbeRun(){
  const d=dsDraft();if(!d)return;
  const seq=++dsState.probeSeq;
  dsState.probing=true;dsRenderProbe();
  let r=null;
  try{r=await api('/api/data-source-master/probe',{quiet:true,method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(d)})}
  catch(e){r={error:e.message,capability:{features:{}}}}
  if(seq!==dsState.probeSeq)return;          /* 打っている最中の古い結果は捨てる */
  dsState.probing=false;
  dsState.probe=r.capability||{};dsState.probePath=r.path||'';
  if(r.error&&dsState.probe&&!dsState.probe.error)dsState.probe.error=r.error;
  dsRenderProbe();
 }
 function dsRenderProbe(){
  const box=$('#dsProbeBox'),state=$('#dsProbeState'),planned=$('#dsPlannedPath');
  if(!box)return;
  if(state)state.textContent=dsState.probing?'確かめています…':'いまの入力で確認';
  if(planned){
   planned.textContent=dsState.probePath||'—';
   planned.title=dsState.probePath||'';
  }
  const cap=dsState.probe||{},f=cap.features||{};
  const rows=CAPABILITY_ORDER.filter(k=>f[k]).map(k=>{
   const v=f[k];
   return `<div class="mm-cap-row${v.ok?' is-ok':' is-ng'}">
     <span class="mm-cap-mark">${v.ok?'できます':'できません'}</span>
     <span class="mm-cap-name">${esc(CAPABILITY_LABEL[k])}</span>
     <span class="mm-cap-note">${esc(v.note||'')}${v.detail?`<i>${esc(v.detail)}</i>`:''}</span>
    </div>`;
  }).join('');
  box.innerHTML=`${cap.error?`<p class="mm-cap-error">${esc(cap.error)}</p>`:''}
   ${rows||'<p class="mm-cap-error">まだ確かめていません。</p>'}
   <p class="mm-cap-foot">${esc(cap.table?`読んだのは表「${cap.table}」の${cap.columnCount}列です。`:'')}
    保存する前に、いま入力している場所を実際に開いて確かめています。</p>`;
 }
 async function saveDataSourceEditor(){
  const d=dsDraft();if(!d)return;
  const uid=requireMaintUser();if(uid===null)return;
  if(!d.key){showToast&&showToast('キーを入れてください','一覧を指す識別子です（半角英数と _）',5000);return}
  const url=d.id?'/api/data-source-master/update':'/api/data-source-master';
  try{
   setMaintLoading(true,'保存しています…');
   const r=await api(url,{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({...d,user_id:uid})});
   closeMaintEditor();
   dsState.loaded=false;await loadDataSourceMaint(true);
   showToast&&showToast('保存しました',(r&&r.message)||'',5200);
  }catch(e){showToast&&showToast('保存できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }

 /* ---------- パス設定（参照データの読み込み先・共有パス・各種間隔。旧config/local.json） ----------
    複数の値を持つ一覧ではなく1組の設定値のため、列表示マスタと同じ「特別扱い」
    にする。sikalot_source/sikalotnow_path/sikalotdef_path/records_backup_export_path/
    schedule_share_pathはサーバー起動時に1回だけ接続先へ反映されるため、保存後も
    このプロセスでは反映されない(再起動が必要)。一覧欄には「保存値」と「現在
    有効な値(このプロセス)」を並べて表示し、反映済みかを確認できるようにする。 ---------- */
 /* 他の画面から「置き場で決める」で来たときの行き先（§9.267）。共通設定は
    非同期で組み上がるので、押した時点ではまだ段が無い。 */
 let pcPendingSection='';
 let pathConfigState={values:{},defaults:{},active:{},sources:[],storage:null,storageError:"",loaded:false};
 /* 再起動しないと反映されない項目。データソースぶんは登録内容から作るので
    ここには固定で書かない(§9.81)。以前は「仕掛(SIKALOTNOW)」等が直接
    書かれており、データソースを増やしても増えず、名前を変えても古い
    ままだった。 */
 const PATH_CONFIG_RESTART_BASE=[['sikalot_source','参照データの取得元']];
 const PATH_CONFIG_RESTART_TAIL=[
  ['records_share_dir','測定データの置き場（設備ごと）'],
  ['records_backup_export_path','測定データバックアップの複製先'],
  ['schedule_share_path','スケジュール共有パス(schedule.sqlite3)'],
 ];
 function pathConfigRestartFields(){
  return [...PATH_CONFIG_RESTART_BASE,
          ...(pathConfigState.sources||[]).map(src=>[src.valueKey,`${src.label}（${src.key}）の読み込み先`]),
          ...PATH_CONFIG_RESTART_TAIL];
 }
 async function loadPathConfigMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&pathConfigState.loaded){renderPathConfigForm();renderPathConfigList();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   /* 置き場は**別の口**が答える（§9.267）——`config/local.json`の側も
      含めた1枚の答えで、パス設定マスタの読み書きとは持ち主が違う。
      **読めなくても共通設定は開く**（置き場の節だけが空になる）。 */
   const [r,st]=await Promise.all([
    api('/api/path-config-master'),
    api('/api/storage-layout').catch(e=>({error:e.message})),
   ]);
   pathConfigState.values=r.values||{};pathConfigState.defaults=r.defaults||{};pathConfigState.active=r.active||{};pathConfigState.sources=r.sources||[];
   pathConfigState.storage=(st&&st.items)?st:null;
   pathConfigState.storageError=(st&&st.error)||'';
   pathConfigState.loaded=true;
   renderPathConfigForm();renderPathConfigList();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 /* ---------- 共通設定の作り（§9.208 ⑨、利用者の指示） ----------
    「多機能がゆえにわかりにくい説明になっているので、視覚的に表現できる
     ところやUIを工夫して直感的にわかるように」

    直したのは4点。
     ① **図を先に出す。** この端末が「どこから読み、どこへ書き、どこへ写すか」は
        文で並べても頭の中で組み立て直すことになる。1枚の絵にして、節ごとの
        いまの値をその中へ書く。図の枠は押せて、その設定の章まで連れて行く。
     ② **状態は欄のすぐ下。** 以前は画面のいちばん下に「いま効いている値」の
        対比表があり、再起動待ちかどうかを見るのに視線が上下していた
        （§8 同じ情報を2箇所に出さない／§2 次にすることを1つだけ指す）。
     ③ **章立てとレール。** 7つの節が1本の長いスクロールに並んでいて、いま
        どこにいるのかが分からなかった。章の一覧を上に置き、**再起動待ちの
        件数もそこに出す**（探させない）。
     ④ **「この端末」を最初の章にする。** PC名・ログインID・モードはすべての
        権限判定の入口なのに、どこにも書かれていなかった（§9.208 ⑧）。

    保存の仕組み（`[data-pc-field]`を集めて`POST /api/path-config-master`）は
    変えていない——**変えたのは並べ方と見せ方だけ**。 */
 const PC_SECTIONS=[
  {id:'terminal',name:'この端末',icon:'PC',when:'保存後すぐ反映',cls:'is-live'},
  {id:'read',    name:'どこから読むか',when:'サーバー再起動後に反映',cls:'is-restart'},
  {id:'schedule',name:'置き場',when:'一部は再起動後に反映',cls:'is-restart'},
  {id:'rne',     name:'RNE抽出',when:'保存後すぐ反映',cls:'is-live'},
 ];
 /* 1項目＝「名前 / 入力 / 一行の説明 / いまどうなっているか」。
    状態欄(`data-pc-state`)は`renderPathConfigList()`が後から埋める。 */
 function pcStateHtml(key){return `<small class="pc-state" data-pc-state="${esc(key)}"></small>`}
 /* 畳んだ段の見出しへ出す「いま効いている値」（§3・§9.125）。
    **保存値が空なら既定を名乗る**——空欄のままだと、畳んだ中に何が
    入っているのか読めない。 */
 function pcNowText(key,fallback){
  const v=pathConfigState.values||{},a=pathConfigState.active||{};
  const raw=String(v[key]||a[key]||'').trim();
  if(!raw)return fallback||'';
  const def=(_PC_CHOICE_LABELS[key]||{})[raw];
  return def||raw;
 }
 /* 選択肢の綴り→画面の言葉。綴りをそのまま出すと`auto`としか読めない。 */
 const _PC_CHOICE_LABELS={
  schedule_watch_enabled:{auto:'auto: 見張る',on:'on: 見張る',off:'off: 見張らない'},
  schedule_owner_enabled:{off:'off: 各PCが自分で書く',on:'on: 1台が書く（既定）'},
  schedule_session_block:{off:'off: 止めない（既定）',on:'on: 後から入った端末は読み取り専用'},
  db_mirror_enabled:{auto:'auto: 写して読む',on:'on: 写して読む',off:'off: 共有を直接読む'},
  rne_extract_enabled:{auto:'auto: localのときだけ',on:'on: 定期実行',off:'off: 手動のみ'},
 };
 function renderPathConfigForm(){
  const form=$('#masterMaintForm');if(!form)return;
  const v=pathConfigState.values||{};
  /* パス欄は「参照…」ダイアログとドラッグ&ドロップに対応させる(§9.49)。
     手打ちのUNCパスは打ち間違いに気づきにくいのが実際の問題だった。 */
  const pathField=(key,label,mode,hint)=>`<div class="mm-field mm-field-wide mm-field-path"><span>${esc(label)}</span>
    <span class="mm-path" data-path-drop="${key}">
     <input data-pc-field="${key}" data-field="${key}" type="text" value="${esc(v[key]||'')}" placeholder="未設定（既定値を使用）" autocomplete="off" spellcheck="false">
     <button type="button" class="mm-path-browse" data-path-browse="${key}" data-path-mode="${mode||'file'}">参照…</button>
    </span>
    <small class="mm-field-hint">${esc(hint||'「参照…」で選ぶか、エクスプローラーからここへドラッグ&ドロップできます。空欄で保存すると既定値に戻ります。')}</small>
    ${pcStateHtml(key)}</div>`;
  const numField=(key,label,unit,step,min)=>`<label class="mm-field mm-field-num"><span>${esc(label)}</span>${
   numFieldHtml({k:key,label,unit,step,min},v[key]||'',`data-pc-field="${key}"`)
  }<small class="mm-field-hint">未入力なら既定値 ${esc(pathConfigState.defaults[key]||'')}${esc(unit||'')} を使用します。</small></label>`;
  const pickField=(key,label,opts,hint)=>`<label class="mm-field"><span>${esc(label)}</span><select data-pc-field="${key}">${
   opts.map(([val,text])=>`<option value="${esc(val)}"${(v[key]||'')===val?' selected':''}>${esc(text)}</option>`).join('')
  }</select><small class="mm-field-hint">${hint||''}</small></label>`;
  const group=(id,title,when,whenCls,body)=>`<section class="mm-set-group" id="pcSec-${id}" data-pc-section="${id}">
    <div class="mm-set-group-head"><h4>${esc(title)}</h4><span class="mm-apply-badge ${whenCls}">${esc(when)}</span></div>
    <div class="mm-set-group-body">${body}</div></section>`;
  /* PC名は**サーバーが解決した結果**を出す（§9.208 ⑧）。画面が持つ
     `WL.terminal`は`/api/access-mode`の答えで、保存した直後は古い。 */
  const term=(window.WL&&WL.terminal)||null;
  const act=pathConfigState.active||{};
  const pcNow=act.pc_name||(term&&term.pcName())||'';
  const pcFrom=act.pc_name_source||(term&&term.pcNameSource())||'';
  form.className='mm-form mm-form-page';
  const SEC_TERMINAL=group('terminal','この端末','保存後すぐ反映','is-live',`
    <div class="pc-who" id="pcWho">
     <div><small>PC名</small><b>${esc(pcNow||'（取得できていません）')}</b>
      <i>${esc(pcFrom||'出どころ不明')}</i></div>
     <div><small>ログインID</small><b>${esc((term&&term.loginId())||'（取得できていません）')}</b><i>OS</i></div>
     <div><small>いまのモード</small><b>${esc((window.accessMode&&accessMode.mode)||'edit')}</b>
      <i>アクセス権限マスタ</i></div>
    </div>
    <label class="mm-field mm-field-wide"><span>この端末の名前を決め打ちする</span>
     <input data-pc-field="pc_name" type="text" value="${esc(v.pc_name||'')}" placeholder="空欄ならOSから自動で取得します" autocomplete="off" spellcheck="false">
     <small class="mm-field-hint">アクセス権限マスタとの照合・記録の「更新端末名」・編集中の持ち主表示は、
      <b>すべてこの名前</b>を見ます。自動で取れない端末だけここで名乗ってください。</small>
     ${pcStateHtml('pc_name')}</label>
    <div id="pcNotes"></div>`);
  const SEC_READ=group('read','どこから読むか','サーバー再起動後に反映','is-restart',`
    <div class="pc-source-list" id="pcSourceList"></div>
    <p class="mm-field-hint">読み込み先を変えるには「データ接続」のカードから <b>編集</b> を押してください
     （同じ設定を2画面に置くと、どちらが効くのか分からなくなるためここでは変えられません）。</p>
    ${pickField('sikalot_source','読み方を決めていないデータソースの既定',
      [['','（既定）network'],['network','network'],['local','local']],
      'network=共有フォルダを読む ／ local=この端末でRNEから抽出したものを読む。<b>読み方を決めたデータソースには効きません</b>。')}
    ${pcStateHtml('sikalot_source')}`);
  /* **置き場は1枚**（§9.267、利用者の指示「マスタの置き場、スケジュールの
     置き場、測定データの置き場、バックアップの置き場などを含めた全ての設定を
     共通設定に視覚的に表現した上でそのままその表示とリンクして設定を簡単に
     わかりやすく」）。以前は同じ「置き場の設定」なのに直す場所が3つに
     分かれており、`config/local.json` の3つは**画面に一切出ていなかった**。
     判定はサーバーが持つ（§9.163）ので、ここは答えを並べて直す口を添えるだけ。 */
  const SEC_SCHEDULE=group('schedule','置き場','一部は再起動後に反映','is-restart',`
    <div class="pc-share" id="pcShare">
     <!-- 見出しは節の題(「置き場」)が既に言っている（§8 同じことを2度言わない）。
          ここに出すのは**揃っているかどうか**だけ。 -->
     <div class="pc-share-head"><span class="pc-share-root" id="pcShareRoot"></span></div>
     <div class="pc-share-rows" id="pcShareRows"></div>
    </div>
    ${pageFoldHtml('共有の変化をどう取り込むか',pcNowText('schedule_watch_enabled','auto: 見張る'),`
     <p class="mm-field-hint">共有（Box等）のschedule.sqlite3は<b>他の端末も書きます</b>。読むときは手元へ写したものを読み、
      <b>改訂番号が変わったときだけ</b>写し直します（読むたびに写すと共有を掴み続け、他の端末の書込とぶつかります）。</p>
     ${pickField('schedule_watch_enabled','共有の変化を見張る',
       [['','（既定）auto: 見張る'],['auto','auto: 見張る'],['on','on: 見張る'],['off','off: 見張らない（読むたびに共有から写す）']],
       'offにすると以前の動きに戻ります（共有が遅い環境では読み込みも遅くなります）。')}
     ${numField('schedule_watch_interval_sec','変化を見る間隔','秒',5,5)}
     ${numField('schedule_watch_pause_sec','取り込んだあと休む時間','秒',5,0)}`)}
    ${pageFoldHtml('同時に書いたときの取り合い',
      'ロック'+esc(String(v.schedule_lock_ttl_sec||pathConfigState.defaults.schedule_lock_ttl_sec||''))+'秒',`
     ${numField('schedule_lock_ttl_sec','書込ロックの有効期限','秒',5,1)}
     ${numField('schedule_lock_verify_delay_ms','ロック確認までの待機時間','ミリ秒',100,0)}`)}
    ${pageFoldHtml('書く役を1台に絞る',pcNowText('schedule_owner_enabled','on: 1台が書く（既定）'),`
     <p class="mm-field-hint">共有へ<b>実際に書く役を1台に絞る</b>仕掛けです。他のPCは書き込みだけをその1台へLAN内のHTTPで頼み、
      <b>読みは今までどおり手元の写しから</b>読みます（画面のURLは全員 http://127.0.0.1:5029/ のまま）。
      <b>持ち主が落ちていても止まりません</b>——頼めなかったPCは自分で共有へ書きます。
      <b>既定で入っています。</b>切ってよいのは、社内規程などで<b>受け口のポートを開けられない</b>ときです
      （切っても動きます——各PCが自分で共有へ書く形に戻るだけです）。</p>
     ${pickField('schedule_owner_enabled','書き込み役を1台に絞る',
       [['','（既定）on: 最初に入った1台が書き込み役になる'],['on','on: 最初に入った1台が書き込み役になる'],['off','off: 各PCが自分で共有へ書く']],
       '書き込み役になったPCだけが下のポートを<b>LANへ開きます</b>（合言葉つきの決められた書き込みしか受け付けません）。')}
     ${numField('schedule_owner_port','書き込み役の受け口ポート','',1,1025)}
     ${numField('schedule_owner_ttl_sec','書き込み役の目印の有効期限','秒',10,30)}
     <div id="scheduleOwnerStatus" class="pc-owner-status">状態を読み込んでいます…</div>`)}
    ${pageFoldHtml('同じ設備を2人で触るとき',pcNowText('schedule_session_block','off: 止めない（既定）'),`
     <p class="mm-field-hint"><b>編集セッション</b>は「この設備の主担当は誰か」を見せる仕掛けです。
      <b>既定では操作を止めません</b>——データの整合は、上の<b>書く役を1台に絞る</b>のと、
      書き込みのたびの<b>ロック→取り直し→適用→改訂番号</b>で守られており、
      並べ替えは<b>顔ぶれが変わっていたら断り</b>、<b>先に並べ替えられていたら上書きせず読み直します</b>。
      <b>on</b> にすると以前の動きに戻り、後から入った端末は読み取り専用になります
      （追加・削除・並べ替え・設備停止・申し送りができなくなります）。</p>
     ${pickField('schedule_session_block','編集セッションで操作を止める',
       [['','（既定）off: 止めない（主担当を表示するだけ）'],['off','off: 止めない（主担当を表示するだけ）'],
        ['on','on: 後から入った端末は読み取り専用にする']],
       '止めない場合でも、同じ顔ぶれのまま2人が同時に並べ替えたときは<b>後から保存したほうの並びが残ります</b>。')}`)}`);
  const SEC_RNE=group('rne','RNE抽出','保存後すぐ反映','is-live',`
    <p class="mm-field-hint">RNE（Navigator問い合わせ定義）から <code>.sqlite3</code> を作り、それを一覧として読む仕組みです。
     取得元が <b>local</b> のデータソースだけが、ここで作ったファイルを読みます。</p>
    ${pickField('rne_extract_enabled','RNE抽出の定期実行',
      [['','（既定）auto: 取得元がlocalのときだけ'],['auto','auto: 取得元がlocalのときだけ'],
       ['on','on: 取得元に関わらず定期実行する'],['off','off: 定期実行しない（手動のみ）']],
      '「今すぐ抽出」は、この設定に関わらず資材が配置されていれば実行できます。')}
    ${numField('rne_extract_interval_sec','RNE抽出間隔','秒',60,60)}
    ${pathField('rne_assets_dir','RNE資材の置き場（フォルダ）','dir','RNEファイルと symnavim.conf をまとめて置くフォルダです。RNEファイルはこの下の rne/ 配下に置きます。共有フォルダを指定すれば、端末ごとにコピーせず1式を共用できます。空欄ならアプリ内の config/rne_extract です。')}
    ${pathField('rne_conf_path','接続情報 symnavim.conf の場所','file','認証情報だけを別の場所に置きたい場合に指定します。空欄なら上の資材置き場の直下（symnavim.conf）です。')}
    ${rneStatusPanelHtml()}`);
  form.innerHTML=`<div class="mm-set-scroll pc-page">
   <!-- ① 図：この端末が何とつながっているか -->
   <div class="pc-map" id="pcMap" aria-label="この端末のつながり">
    <button type="button" class="pc-node" data-pc-jump="read">
     <b>参照データ</b><span class="pc-node-sub">仕掛・品質（読むだけ）</span>
     <span class="pc-node-val" data-pc-map="read">—</span></button>
    <span class="pc-arrow" aria-hidden="true"><i></i><em>読む</em></span>
    <button type="button" class="pc-node is-self" data-pc-jump="terminal">
     <b>この端末</b><span class="pc-node-sub">WaveLog</span>
     <span class="pc-node-val" data-pc-map="terminal">—</span></button>
    <span class="pc-arrow" aria-hidden="true"><i></i><em>書く</em></span>
    <button type="button" class="pc-node" data-pc-jump="schedule">
     <b>共有スケジュール</b><span class="pc-node-sub">作業予定（みんなで使う）</span>
     <span class="pc-node-val" data-pc-map="schedule">—</span></button>
   </div>

   <!-- ② 章は**段（タブ）**（§9.261、利用者の指示「タブとアコーディオンを主構成に」）。
        以前は全部を縦に並べて飛ぶだけで、実測2768pxを736pxの器で見ていた
        （4回ぶんスクロール）。段にすれば1章ぶんだけになる。 -->
   <nav class="pc-rail" id="pcRail" aria-label="共通設定の状態">
    <span class="pc-rail-restart" id="pcRestartCount" hidden></span>
   </nav>

   ${pageTabsHtml([
    {name:'この端末',body:SEC_TERMINAL},
    {name:'どこから読むか',body:SEC_READ},
    {name:'置き場',body:SEC_SCHEDULE},
    {name:'RNE抽出',body:SEC_RNE},
   ])}

  </div>
  <div class="mm-form-tail mm-set-sticky"><button type="submit" class="mm-btn-primary">共通設定を保存</button><span class="mm-form-hint">更新者IDは画面右上の入力欄を使用します。</span></div>`;
  form.onsubmit=ev=>{ev.preventDefault();savePathConfigMaint()};
  /* 段の切り替えを配線する（§9.261）。編集窓と同じ`bindMaintTabs`なので、
     キーボード操作（←→）も見出しの一言もそのまま効く。 */
  bindMaintTabs(form);
  /* 図から章へ飛ぶのは**段を切り替えること**（入口を2本作らない）。
     段になったので、スクロールではなく表示の切り替えで連れて行く。 */
  /* **委譲で受ける**（§9.265と同じ理由）——置き場の行は後から描かれるので、
     このとき1つずつ配線すると、行の中の「直す場所を開く」だけ効かない。 */
  form.addEventListener('click',ev=>{
   const btn=ev.target.closest('[data-pc-jump]');if(!btn||!form.contains(btn))return;
   ev.preventDefault();
   const sec=form.querySelector(`#pcSec-${btn.dataset.pcJump}`);
   if(!sec)return;
   const panel=sec.closest('.mm-tabpanel');
   if(panel&&typeof form.__mmShowTab==='function'){
    const i=[...form.querySelectorAll('.mm-tabpanel')].indexOf(panel);
    if(i>=0)form.__mmShowTab(i);
   }
   sec.scrollIntoView({block:'start',behavior:'smooth'});
   sec.classList.add('is-jumped');
   setTimeout(()=>sec.classList.remove('is-jumped'),1200);
  });
  /* 「直す場所」からその画面へ飛ぶ。**行が持つ印で開く**ので、置き場が
     増えてもここは触らなくてよい（飛び先はサーバーの答えの一部）。 */
  form.addEventListener('click',ev=>{
   const b=ev.target.closest('[data-pc-goto]');if(!b)return;
   document.querySelector(`#masterMaintNav [data-master="${b.dataset.pcGoto}"]`)?.click();
  });
  bindInputHelpers(form);
  /* 他の画面から「置き場で決める」で来たときは、その段を開いて印を付ける。
     **一度きり**——次に共通設定を開いたときまで覚えていると、身に覚えの
     無い段が開く。 */
  if(pcPendingSection){
   const want=pcPendingSection;pcPendingSection='';
   const btn=form.querySelector(`[data-pc-jump="${want}"]`);
   if(btn)btn.click();
   else{
    const sec=form.querySelector(`#pcSec-${want}`),panel=sec&&sec.closest('.mm-tabpanel');
    if(panel&&typeof form.__mmShowTab==='function'){
     const i=[...form.querySelectorAll('.mm-tabpanel')].indexOf(panel);
     if(i>=0)form.__mmShowTab(i);
    }
   }
  }
  refreshRneStatus();
  refreshOwnerStatus();
 }
 /* ---------- 書き込み役の状態(§9.192) ----------
    「入れたのに効いているのか分からない」を作らない。誰が役をしていて、
    このPCから見えているか（届いているか）までを文字で出す。 */
 async function refreshOwnerStatus(){
  const box=$('#scheduleOwnerStatus');if(!box)return;
  let o;
  try{o=await api('/api/schedule/owner-status')}
  catch(e){box.innerHTML=`<span class="pc-owner-off">状態を取得できません: ${esc(e.message)}</span>`;return}
  if(!o.configured){box.innerHTML='<span class="pc-owner-off">スケジュールの共有データ置き場が未設定のため、この設定は効きません。</span>';return}
  if(!o.enabled){box.innerHTML='<span class="pc-owner-off">いまは <b>off</b>（各PCが自分で共有へ書いています）。</span>';return}
  const who=o.isOwner?'<b>このPCが書き込み役です。</b>'
           :(o.ownerPc?`書き込み役は <b>${esc(o.ownerPc)}</b>${o.ownerLogin?`（${esc(o.ownerLogin)}）`:''} です。`
                      :'書き込み役はまだ決まっていません（決まるまでは各PCが自分で書きます）。');
  const lines=[
   o.isOwner?`受け口: ${esc((o.myUrls||[]).join(' / '))}`:(o.ownerUrl?`話しかけ先: ${esc(o.ownerUrl)}`:''),
   o.ownerAliveSec!=null?`最後の生存確認: ${Math.round(o.ownerAliveSec)}秒前（期限 ${esc(String(o.ttlSec))}秒）`:'',
   o.relays?`頼んだ回数: ${o.relays}回${o.relayFail?` / 届かなかった: ${o.relayFail}回`:''}`:'',
   o.lastError?`最後のエラー: ${esc(o.lastError)}（届かないあいだは自分で書きます）`:''
  ].filter(Boolean);
  box.innerHTML=`<div class="pc-owner-who${o.isOwner?' is-me':''}">${who}</div>`+
   (lines.length?`<div class="pc-owner-lines">${lines.map(t=>`<span>${t}</span>`).join('')}</div>`:'');
 }

 /* ---------- RNE抽出の状態表示と手動実行(§9.50) ----------
    ローカル運用(sikalot_source=local)のとき、抽出は背景で定期実行される。
    以前は成否がアプリログにしか出ず、「動いているのか」「今すぐ取り直したい」
    に画面から答えられなかった(「実際に起動させる方法が分からない」という指摘)。 */
 let rneTimer=null;
 function rneStatusPanelHtml(){
  return `<div class="rne-panel" id="rnePanel">
    <div class="rne-head">
     <h4>RNE抽出（参照データのローカル運用）</h4>
     <span class="rne-state" id="rneState">確認中…</span>
     <button type="button" class="mm-btn-ghost sm" id="rneRunBtn">今すぐ抽出</button>
    </div>
    <div id="rneBody"><div class="rne-note">状態を読み込んでいます…</div></div>
   </div>`;
 }
 function fmtWhen(sec){
  if(!sec)return '—';
  const d=new Date(sec*1000),diff=Math.floor((Date.now()-d.getTime())/60000);
  return `${d.toLocaleString('ja-JP')}（${diff<1?'たった今':diff+'分前'}）`;
 }
 async function refreshRneStatus(){
  const panel=$('#rnePanel');if(!panel)return;
  clearTimeout(rneTimer);rneTimer=null;
  let s;
  try{s=await api('/api/rne-extract/status')}
  catch(e){const b=$('#rneBody');if(b)b.innerHTML=`<div class="rne-note">状態を取得できません: ${esc(e.message)}</div>`;return}
  const state=$('#rneState'),body=$('#rneBody'),btn=$('#rneRunBtn');
  if(!state||!body||!btn)return;
  state.textContent=s.running?'抽出中…':(s.enabled?'定期実行 有効':'定期実行 停止中');
  state.className='rne-state '+(s.running?'is-running':(s.enabled?'is-on':'is-off'));
  // 手動実行は取得元に関わらず、資材が配置されていれば押せる
  btn.disabled=!!s.running||!s.canRun;
  btn.title=s.canRun?'取得元の設定に関わらず、今この場でRNEから抽出し直します。'
                    :'抽出に必要なファイル(RNE定義・symnavim.conf)が配置されていません。';
  const jobs=(s.jobs||[]).map(j=>`<div class="rne-job${j.ok?'':' is-ng'}"><b>${esc(j.name)}</b>${
    j.ok?`成功 ${esc(String(j.rows??'-'))}行 / ${(j.elapsed||0).toFixed(1)}秒`:`失敗: ${esc(j.error||'')}`}</div>`).join('');
  const outs=(s.outputs||[]).map(o=>`<div class="rne-job"><b>${esc(o.name)}</b>${
    o.exists?`最終更新 ${esc(fmtWhen(o.mtime))}`:'まだ作成されていません'}</div>`).join('');
  const missing=(s.assets&&s.assets.rneMissing)||[];
  body.innerHTML=`
   ${s.enabled?'':`<div class="rne-note"><b>定期実行は停止中です</b>（設定: ${esc(s.scheduleMode||'auto')}${s.scheduleMode==='off'?'':` / 取得元: ${esc(s.source||'')}`}）。
     定期実行を回すには、上の「RNE抽出の定期実行」を <b>on</b> にするか、「参照データの取得元」を <b>local</b> にしてください（取得元の変更はサーバー再起動後に反映されます。定期実行の設定は再起動不要です）。
     <b>「今すぐ抽出」は取得元の設定に関わらず実行できます。</b></div>`}
   ${missing.length?`<div class="rne-note" style="color:var(--danger)"><b>抽出定義(RNE)が未配置です: ${esc(missing.join(', '))}</b><br>${esc(s.assetsDir||'')}\\rne へ配置してください（機密のためリポジトリには含まれません。config/rne_extract/README.md 参照）。</div>`:''}
   ${(s.assets&&!s.assets.symnavimConf)?`<div class="rne-note" style="color:var(--danger)">接続情報 symnavim.conf が未配置です（${esc(s.assetsDir||'')}）。</div>`:''}
   <div class="rne-jobs">${outs}</div>
   ${jobs?`<div class="rne-jobs">${jobs}</div>`:''}
   <div class="rne-note">定期実行: ${s.enabled?`起動直後に1回、以降 ${esc(String(s.intervalSec))}秒ごと`:'（停止中）'} ／ 手動実行: ${s.canRun?'可能':'資材が未配置のため不可'} ／ 直近の実行: ${esc(fmtWhen(s.finishedAt||s.startedAt))}${s.trigger?`（${s.trigger==='manual'?'手動':'定期'}）`:''}</div>`;
  btn.onclick=async()=>{
   btn.disabled=true;
   try{
    const r=await api('/api/rne-extract/run',{quiet:true,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:String($('#masterUserId')?.value||'').trim()})});
    showToast('抽出を開始しました',r.message||'',4000);
   }catch(e){showToast('抽出を開始できません',e.message,7000);btn.disabled=false;return}
   refreshRneStatus();
  };
  // 実行中だけ短い間隔で追いかける(終わったら止める。無駄な問い合わせを残さない)
  if(s.running)rneTimer=setTimeout(refreshRneStatus,2000);
 }
 /* ---------- 状態はその欄のすぐ下（§9.208 ⑨） ----------
    以前は画面のいちばん下に「保存値 ／ いま効いている値」の対比表を置いて
    いた。項目が10件を超えると、直した欄がその表のどの行なのかを探すことに
    なり、**再起動待ちかどうかを見るのに視線が上下する**。状態は欄の持ち物
    なので欄が持つ——表そのものは廃止した（§8 同じ情報を2箇所に出さない）。
    ここが埋めるのは「各欄の状態」「図の中の値」「章のレールの件数」の3つ。 */
 /* 共有の置き場を1枚で出す(§9.260)。**判定はサーバーが持つ**（§9.163）ので、
    ここは受け取った答えを並べるだけ——「UNCかどうか」「同じ根の下か」を
    画面でも判定すると答えが2通りになる。
    **色だけで伝えない**(§3)ので、置き場の種類は必ず文字で書く。 */
 /* 置き場の種類は**必ず文字で**（§3。色だけで伝えない）。 */
 const PC_SHARE_KIND={network:'共有（ネットワーク）',cloud:'共有（クラウド同期）',
                      local:'この端末の中','':'未設定'};
 /* 群の題と、その群が何のためにあるか。**3つより増やさない**（§9.105と
    同じ理由——群の意味を覚える手間のほうが大きくなる）。 */
 const PC_STORE_GROUPS=[
  {id:'terminal',name:'① この端末の中',
   why:'この端末だけが使うもの。<b>置き場は config/local.json が決めます</b>（起動時に1回だけ読むので再起動が要ります）。'},
  {id:'share',name:'② みんなで使う',
   why:'他の端末とやりとりするもの。ここを共有フォルダにすると全員で同じものを見ます。'},
  {id:'read',name:'③ 読むだけ',
   why:'別のシステムが書いたものを読むだけです。書き換えません。'},
 ];
 /* 「在るか」は3値（§CLAUDE「共有DBを開く前にstatを置かない」）。
    **null（確かめられなかった）を「無い」と同じに扱わない。** */
 function pcExistsText(x){
  if(!x.path)return {t:'未設定',c:'is-unset'};
  if(x.exists===true)return {t:'あります',c:'is-ok'};
  if(x.exists===false)return {t:'まだありません',c:'is-missing'};
  return {t:'確かめられません',c:'is-unknown'};
 }
 /* 置き場の1行。**直せるものには欄と「参照…」を、無いものには「作る」を**
    その場に置く（§9.207。直す場所へ行かせない）。 */
 function pcStorageRowHtml(x,lcFields){
  /* `config/local.json`の行は、**その欄の説明も一緒に出す**（利用者の混乱の元
     ——「フォルダなのかファイルなのか」「共有の置き場と何が違うのか」が
     行だけからは読めなかった）。説明は`localConfig`が持っている。 */
  const lcDef=(lcFields||[]).find(f=>f.key===x.field)||null;
  /* 種類と「在るか」は**別のこと**だが、置き場が未設定のときはどちらも
     「未設定」になり、同じ言葉が2つ並ぶ（§8）。そのときは種類を出さない。 */
  const kind=x.path?(PC_SHARE_KIND[x.kind||'']||''):'';
  const ex=pcExistsText(x);
  const onShare=x.kind==='network'||x.kind==='cloud';
  const lc=x.store==='local-json';
  const field=lc?`data-lc-field="${esc(x.field)}"`:`data-pc-field="${esc(x.field)}"`;
  const canEdit=x.editable&&x.field;
  const box=canEdit
   ? `<span class="mm-path" data-path-drop="${esc(x.field)}">
       <input ${field} data-field="${esc(x.field)}" type="text" value="${esc(x.saved!=null?x.saved:x.path)}"
        placeholder="未設定（既定を使います）" autocomplete="off" spellcheck="false">
       <button type="button" class="mm-path-browse" data-path-browse="${esc(x.field)}" data-path-mode="${esc(x.mode||'dir')}">参照…</button>
      </span>`
   : `<code class="pc-share-path" title="${esc(x.path||'')}">${esc(x.path||'（未設定）')}</code>`;
  /* **作れるのは「無いと分かっている」ときだけ**——確かめられなかった
     ものに「作る」を出すと、在るものを作りに行ったように見える。 */
  const canMake=x.creatable&&x.path&&x.exists===false;
  /* **1行＝3段**（題と素性／欄／打つ手）。素性を別の段にすると1件が4段に
     なり、9件で器の2倍を超える（実測 1955px を 828px の器で見ていた）。
     題の右へ添えれば読む順は変わらない（§CLAUDE 画面基準 1・12）。 */
  return `<div class="pc-store-row${onShare?' is-shared':''}${lc?' is-local':''}" data-store-key="${esc(x.key)}">
   <div class="pc-store-head">
    <b class="pc-store-label">${esc(x.label)}</b>
    <small class="pc-store-what">${esc(x.what||'')}</small>
    ${kind?`<span class="pc-store-kind">${esc(kind)}</span>`:''}
    <span class="pc-store-exists ${ex.c}">${esc(ex.t)}</span>
    ${lc?'<span class="pc-store-tag">この端末だけ</span>':''}
    ${x.retired?'<span class="pc-store-tag is-retired">役目を終えました</span>':''}
   </div>
   ${x.pending?`<small class="pc-store-note is-pending">保存済みですが、まだ効いていません。
     いまは <code>${esc(x.active||'（未設定）')}</code> を使っています——
     <b>アプリを再起動すると切り替わります</b>。置き場は先に作っておけます。</small>`:''}
   ${box}
   <div class="pc-store-foot">
    ${canEdit?`<code class="pc-store-eff" title="${esc(x.path||'')}">${
      x.pending?'これから':'いま'}: ${esc(x.path||'（未設定）')}</code>`:''}
    ${x.from?`<span>出どころ <b>${esc(x.from)}</b></span>`:''}
    ${x.pending
      ? `<span class="pc-store-pending" title="いまは ${esc(x.active||'（未設定）')} を使っています">再起動待ち</span>`
      : `<span>${x.when==='live'?'保存後すぐ反映':'再起動後に反映'}</span>`}
    ${canMake?`<button type="button" class="mm-btn-ghost pc-make" data-pc-make="${esc(x.key)}"
       data-pc-make-mode="${esc(x.mode||'dir')}">無いので作る…</button>`:''}
    ${x.jump?`<button type="button" class="mm-btn-ghost pc-goto" data-pc-goto="${esc(x.jump)}">直す場所を開く</button>`:''}
    ${x.section?`<button type="button" class="mm-btn-ghost" data-pc-jump="${esc(x.section)}">直す場所を開く</button>`:''}
   </div>
   ${x.note?`<small class="pc-store-note">${esc(x.note)}</small>`:''}
   ${lcDef&&lcDef.hint?`<small class="pc-store-note">${hintHtml(lcDef.hint)}${
     lcDef.expanded?` この端末では <code>${esc(lcDef.expanded)}</code> になります。`:''}</small>`:''}
  </div>`;
 }
 /* `config/local.json` の残り2つ（まとめて決める / 書込サイクル）。
    **優先順位はサーバーが言う**——段を1つ足したときに2箇所直さない。 */
 /* 説明は**マスタと同じ書き方**を通す（`**強調**`が生で出ないように・§9.222 ⑧）。
    変数で書いてあるときは**展開後の姿も出す**（§6。書いたものと効くものが
    違うので、片方だけ見せると確かめようがない）。 */
 function pcLcNow(f){
  const exp=f.expanded?`<br>この端末では <code>${esc(f.expanded)}</code> になります。`:'';
  return `<small class="mm-field-hint">${hintHtml(f.hint||'')}
    いまは <b>${esc(f.effective||'')}</b> です。${exp}</small>`;
 }
 /* **読めなかったことを画面のいちばん上に出す**（§9.271）。以前はサーバーが
    黙って空の設定として扱っていたので、`master_db_path` を書いてあるのに
    アプリは既定の `db\master.sqlite3` を読み、画面は「未設定」に見えていた。
    ここに出る＝**このファイルに書いた設定は1つも効いていない**。 */
 function pcLocalErrorHtml(err){
  if(!err)return '';
  return `<p class="mm-warn-note" id="pcLocalConfigError"><b>この端末の設定ファイルを読めませんでした。</b>
   ${esc(err)}<br>そのため、<b>下の3つに書いた内容は効いていません</b>（アプリは既定の置き場を読んでいます）。
   このまま下の欄から保存し直すと、正しい形で書き直せます。</p>`;
 }
 function pcLocalExtraHtml(fields){
  const rows=(fields||[]).filter(f=>f.key==='db_dir'||f.key==='master_share_mode');
  if(!rows.length)return '';
  return rows.map(f=>f.mode==='choice'
   ? `<label class="mm-field"><span>${esc(f.label)}</span>
      <select data-lc-field="${esc(f.key)}">${(f.choices||[]).map(([v,t])=>
       `<option value="${esc(v)}"${(f.value||'')===v?' selected':''}>${esc(t)}</option>`).join('')}</select>
      ${pcLcNow(f)}</label>`
   : `<div class="mm-field mm-field-wide mm-field-path"><span>${esc(f.label)}</span>
      <span class="mm-path" data-path-drop="${esc(f.key)}">
       <input data-lc-field="${esc(f.key)}" data-field="${esc(f.key)}" type="text" value="${esc(f.value||'')}"
        placeholder="未設定（既定: ${esc(f.default||'')}）" autocomplete="off" spellcheck="false">
       <button type="button" class="mm-path-browse" data-path-browse="${esc(f.key)}" data-path-mode="${esc(f.mode||'dir')}">参照…</button>
      </span>
      ${pcLcNow(f)}</div>`
  ).join('');
 }
 /* 置き場を1枚で出す(§9.260→§9.267)。**判定はサーバーが持つ**（§9.163）ので、
    ここは受け取った答えを並べて直す口を添えるだけ——「UNCかどうか」
    「どの段で決まったか」を画面でも判定すると答えが2通りになる。 */
 /* 置き場を「無ければ作る」（§9.267、利用者の指示「設定さえ書いてあれば
    フォルダやファイルが存在しない場合には強制的に作成して、ユーザーの操作を
    妨げないようにしたい。但し作成する前にユーザーに確認する方式に」）。
    **下見 → 確認 → 作る**の3段（§9.193）——何ができるのかを先に出す。 */
 async function makeStoragePath(key,mode){
  const row=document.querySelector(`[data-store-key="${CSS.escape(key)}"]`);
  const input=row&&row.querySelector('[data-field]');
  /* **欄に打った値で作る**（保存していなくてよい）——「保存してから作る」に
     すると、打ち間違えた値をマスタへ入れてから確かめることになる。 */
  const path=input?String(input.value||'').trim():'';
  const label=row?(row.querySelector('.pc-store-label')||{}).textContent||'':'';
  try{
   setMaintLoading(true,'どうなるか調べています…');
   const pre=await api('/api/storage-layout/prepare',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({path,mode,apply:false})});
   setMaintLoading(false);
   const plan=(pre&&pre.plan)||{};
   if(plan.already){
    showToast&&showToast('もうあります',`${plan.path} は既にあります。`,4500);
    return;
   }
   const made=[...(plan.dirs||[]),...(plan.file?[plan.file]:[])];
   /* **何ができるのかを1つずつ出す**（§4・§6）。「作ります」だけでは、
      どこに何ができるのか確かめようがない。 */
   const body=`<p class="confirm-modal-message">これから <b>${made.length}件</b> 作ります。</p>
     <ul class="pc-make-list">${made.map(x=>`<li><code>${esc(x)}</code></li>`).join('')}</ul>
     <p class="confirm-modal-message">${plan.kind==='network'||plan.kind==='cloud'
       ?'共有の置き場です。<b>作るだけ</b>で、中のデータは触りません。'
       :'この端末の中に作ります。'}</p>`;
   const ok=(typeof confirmModal==='function')
    ? await confirmModal({title:`${label||'置き場'}を作ります`,eyebrow:'CREATE',
                          bodyHtml:body,confirmLabel:'作る'})
    : window.confirm(`${made.length}件のフォルダ／ファイルを作ります。よろしいですか？`);
   if(!ok)return;
   setMaintLoading(true,'作っています…');
   const r=await api('/api/storage-layout/prepare',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({path,mode,apply:true})});
   const done=(r&&r.plan)||{};
   /* **作れても書けない共有がある**ので、書けるかまで見て言う（§4）。 */
   if(done.writable===false){
    showToast&&showToast('作りましたが書き込めません',
      `${done.path} を作りましたが、書き込みを試すと失敗しました。${done.writeError||''}`,9000);
   }else{
    showToast&&showToast('作りました',`${done.path} を用意しました。`,5000);
   }
   pathConfigState.loaded=false;await loadPathConfigMaint(true);
  }catch(e){
   setMaintLoading(false);
   showToast&&showToast('作れませんでした',e.message,7000);
  }finally{setMaintLoading(false)}
 }
 function bindStorageActions(root){
  root.querySelectorAll('[data-pc-make]').forEach(btn=>{
   btn.onclick=()=>makeStoragePath(btn.dataset.pcMake,btn.dataset.pcMakeMode||'dir');
  });
 }
 function paintShareLayout(sl,err){
  const rows=$('#pcShareRows'),root=$('#pcShareRoot');
  if(!rows)return;
  const items=(sl&&sl.items)||[];
  if(!items.length){
   rows.innerHTML=`<p class="mm-field-hint">置き場の一覧を読めませんでした${
     err?`: ${esc(err)}`:''}。他の設定はこのまま直せます。</p>`;
   return;
  }
  const byGroup={};items.forEach(x=>{(byGroup[x.group]=byGroup[x.group]||[]).push(x)});
  rows.innerHTML=PC_STORE_GROUPS.map(g=>{
   const list=byGroup[g.id]||[];
   if(!list.length)return '';
   return `<section class="pc-store-group" data-store-group="${esc(g.id)}">
    <h5 class="pc-store-group-head">${esc(g.name)}<small>${g.why}</small></h5>
    ${list.map(r=>pcStorageRowHtml(r,sl&&sl.localConfig)).join('')}
    ${g.id==='terminal'?`<div class="pc-store-extra">${pcLocalErrorHtml(sl&&sl.localConfigError)}${pcLocalExtraHtml(sl&&sl.localConfig)}
     <small class="mm-field-hint">この3つは <code>${esc((sl&&sl.localConfigPath)||'config/local.json')}</code> に入ります。
      <b>マスタDB自身の置き場を決める値</b>なので、マスタの中には置けません（読みに行く先が分からなくなるため）。
      直す前の内容は <code>local.json.bak</code> に控えます。</small></div>`:''}
   </section>`;
  }).join('');
  if(root){
   /* **揃っているときだけ言う**。揃っていない置き方が悪いわけではないので、
      「バラバラです」とは書かない（直す必要のない状態を不備に見せない）。 */
   root.textContent=(sl&&sl.sameRoot)?`本体3つとも同じ場所の下です: ${sl.sameRoot}`:'';
   root.hidden=!(sl&&sl.sameRoot);
   /* **器ごと畳む**——中身が隠れただけだと、器の余白が1行ぶん残る。 */
   const head=root.closest('.pc-share-head');if(head)head.hidden=root.hidden;
  }
  bindPathFields(rows);
  bindStorageActions(rows);
 }

 function renderPathConfigList(){
  const form=$('#masterMaintForm');if(!form||!form.classList.contains('mm-form-page'))return;
  const v=pathConfigState.values||{},a=pathConfigState.active||{};
  /* 「いま効いている値」の言い方。空欄は**何が起きるか**まで書く
     （「未設定」だけでは、既定へ落ちるのか機能が止まるのかが分からない）。 */
  const activeText={
   sikalot_source:a.sikalot_source||'',
   schedule_share_path:a.schedule_share_path||'（未設定・スケジュール機能は無効）',
  };
  const savedText={
   sikalot_source:v.sikalot_source||'（既定）network',
   schedule_share_path:v.schedule_share_path||'（未設定・スケジュール機能は無効）',
  };
  /* まだ読んでいないデータソースは**「解決できていません」ではなく
     「再起動後に反映」**と書く（§9.163）。前者は不具合に読めるが、
     実際は設計どおりの待ち状態で、打つ手が違う。 */
  const pendingKeys=new Set();
  (pathConfigState.sources||[]).forEach(src=>{
   if(src.loaded===false){
    pendingKeys.add(src.valueKey);
    activeText[src.valueKey]=`（未反映）再起動すると ${src.planned||'—'} を読みます`;
   }else{
    activeText[src.valueKey]=src.active||'（解決できていません）';
   }
   savedText[src.valueKey]=v[src.valueKey]||'（既定値を使用）';
  });
  /* 「再起動待ち」の判定は**表示文字列ではなく生の値**で行う。表示側は
     現在値にエンジン種別を添えたり、未設定を「（既定）network」と書き換えたり
     するので、文字列比較では中身が同じ行まで再起動待ちに見える（実際にそう出た）。
     保存値が空＝既定を使う指定なので、待ちにはしない。 */
  const isPending=key=>{
   const savedRaw=String(v[key]||'').trim(),activeRaw=String(a[key]||'').trim();
   return pendingKeys.has(key)||(!!savedRaw&&savedRaw!==activeRaw);
  };
  /* 各欄の状態。**再起動が要らない項目は「保存後すぐ反映」とだけ言う**
     ——比べる相手（いま効いている値）が無いのに空欄の対比を並べない。 */
  /* 置き場は`/api/storage-layout`の答え（§9.267）。読めなかったときは
     理由を出す——空のまま黙ると「設定が消えた」と読まれる（§4）。 */
  paintShareLayout(pathConfigState.storage,pathConfigState.storageError);
  let pending=0;
  form.querySelectorAll('[data-pc-state]').forEach(el=>{
   const key=el.dataset.pcState;
   const restartable=pathConfigRestartFields().some(([k])=>k===key);
   if(!restartable){
    if(key==='pc_name'){
     const term=(window.WL&&WL.terminal)||null;
     const now=a.pc_name||(term&&term.pcName())||'（取得できていません）';
     const from=a.pc_name_source||(term&&term.pcNameSource())||'出どころ不明';
     el.className='pc-state';
     el.textContent=`いま名乗っている名前: ${now}（${from}）`;
    }else{
     el.className='pc-state';
     el.textContent='保存するとすぐに反映されます。';
    }
    return;
   }
   const p=isPending(key);
   if(p)pending++;
   el.className='pc-state'+(p?' is-pending-restart':'');
   el.innerHTML=`<span class="pc-state-now"><i>いま</i>${esc(activeText[key]||'—')}</span>`
    +`<span class="pc-state-saved"><i>保存値</i>${esc(savedText[key]||'—')}</span>`
    +(p?'<b class="mm-restart-flag">再起動待ち</b>':'');
   el.title=`いま効いている値: ${activeText[key]||'—'}\n保存値（次回起動から）: ${savedText[key]||'—'}`;
  });
  /* データソースは入力欄を持たない（「データ接続」が持つ）ので、
     読み取り専用の並びとして章の中へ出す。再起動待ちはここでも数える。 */
  const list=$('#pcSourceList');
  if(list){
   const rows=(pathConfigState.sources||[]);
   if(!rows.length){
    list.innerHTML='<p class="mm-field-hint">データソースが登録されていません。「データ接続」で登録してください。</p>';
   }else{
    list.innerHTML=rows.map(src=>{
     const p=isPending(src.valueKey);
     if(p&&!form.querySelector(`[data-pc-state="${src.valueKey}"]`))pending++;
     return `<div class="pc-source${p?' is-pending-restart':''}"><b>${esc(src.label)}</b><code>${esc(src.key)}</code>
      <span title="${esc(src.active||'')}">${esc(src.active||'（この端末ではまだ読んでいません）')}</span>
      ${src.loaded===false?`<i class="pc-source-next">再起動すると ${esc(src.planned||'—')} を読みます</i>`:''}
      ${p?'<b class="mm-restart-flag">再起動待ち</b>':''}</div>`;
    }).join('');
   }
  }
  /* 図の中の値。**節ごとの「いま」を絵の中で読める**ようにする。 */
  const term=(window.WL&&WL.terminal)||null;
  const short=t=>{const s=String(t||'—');return s.length>44?'…'+s.slice(-43):s};
  const mapText={
   read:short((pathConfigState.sources||[]).map(x=>x.active).filter(Boolean)[0]
     ||(activeText.sikalot_source?`取得元 ${activeText.sikalot_source}`:'（未設定）')),
   terminal:short((term&&term.pcName())||'（PC名を取得できていません）'),
   schedule:short(a.schedule_share_path||'（未設定・機能無効）'),
  };
  form.querySelectorAll('[data-pc-map]').forEach(el=>{
   const t=mapText[el.dataset.pcMap]||'—';
   el.textContent=t;el.title=t;
  });
  /* 章のレールに再起動待ちの件数を出す（探させない）。 */
  const badge=$('#pcRestartCount');
  if(badge){
   badge.textContent=pending?`再起動待ち ${pending}件`:'';
   badge.hidden=!pending;
   badge.title=pending?'保存した値は、サーバーを再起動すると効きます（stop.bat → Start.vbs）。':'';
  }
  /* **作り直せるファイルの置き場**(§9.109)と、**マスタDBが同期フォルダーの
     中にあるとき**の注意(§9.192)。どちらも設定ではないが、共有(BOX等)に置いた
     ファイル群を複数のPCから起動する現場では、**知らないと壊れ方が分からない**。 */
  const notes=$('#pcNotes');
  if(notes){
   const wd=v.work_dir?`<p class="mm-def-hint">作り直せるファイル（写し・スケジュールの作業コピー）の置き場: ${esc(v.work_dir)}`
     +`${v.work_dir_reason?`<b>（${esc(v.work_dir_reason)}）</b>`:''}</p>`:'';
   const cloud=v.master_cloud?`<p class="mm-warn-note"><b>マスタDBが${esc(v.master_cloud)}の中にあります</b>（${esc(v.db_dir||'')}）。
     このフォルダーを<b>複数のPCから同時に起動すると、全員が同じマスタへ書き込みます</b>——
     同期の衝突で設定が失われることがあります。各PCの手元へ置く場合は
     <code>config/local.json</code> の <code>db_dir</code> を、そのPCのローカルフォルダーへ向けてください
     （共有したいのは作業予定だけです。上の「作業予定の共有データ置き場」で共有します）。</p>`:'';
   notes.innerHTML=wd+cloud;
  }
 }
 /* 保存の口は**2つある**（§9.267）——パス設定マスタ（`data-pc-field`）と
    `config/local.json`（`data-lc-field`）。**ボタンは1つ**にする（利用者の
    指示「一元管理したい」）が、片方だけ失敗しうるので**どちらがどうなったかは
    分けて言う**（§4。まとめて「保存しました」と言うと、効いていない側に
    気づけない）。 */
 function pcLocalConfigBody(){
  const body={};
  document.querySelectorAll('#masterMaintForm [data-lc-field]').forEach(el=>{
   body[el.dataset.lcField]=String(el.value||'').trim();
  });
  return body;
 }
 /* いま画面に出ている `local.json` の値と、保存済みの値が違うか。
    **違うときだけ送る**——`local.json`は起動を左右するファイルなので、
    触っていない保存で毎回書き換えない。 */
 function pcLocalConfigChanged(body){
  const saved={};
  ((pathConfigState.storage&&pathConfigState.storage.localConfig)||[])
   .forEach(f=>{saved[f.key]=String(f.value||'')});
  return Object.keys(body).some(k=>String(body[k]||'')!==String(saved[k]||''));
 }
 async function savePathConfigMaint(){
  const uid=requireMaintUser();if(uid===null)return;
  const body={user_id:uid};
  // 数値欄は表示用の3桁区切りが入るので、送る前に外す(§9.49)
  document.querySelectorAll('#masterMaintForm [data-pc-field]').forEach(el=>{
   body[el.dataset.pcField]=el.classList.contains('mm-num-input')?numRaw(el.value):el.value;
  });
  const lc=pcLocalConfigBody();
  const lcChanged=pcLocalConfigChanged(lc);
  try{
   setMaintLoading(true,'パス設定を保存しています…');
   const r=await api('/api/path-config-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   let extra=(r&&r.message)||'';
   if(lcChanged){
    setMaintLoading(true,'この端末の置き場を保存しています…');
    try{
     const lr=await api('/api/storage-layout/local-config',{method:'POST',
       headers:{'Content-Type':'application/json'},body:JSON.stringify(lc)});
     extra=(extra?extra+' ／ ':'')
       +`この端末の置き場（${(lr&&lr.path)||'config/local.json'}）も保存しました。`
       +'<b>サーバーを再起動すると反映されます。</b>';
    }catch(e){
     /* **片方だけ失敗したことを必ず言う**——まとめて「保存しました」と
        返すと、効いていない側に気づけない（§4・§9.190と同じ理由）。 */
     pathConfigState.loaded=false;await loadPathConfigMaint(true);
     showToast&&showToast('この端末の置き場だけ保存できませんでした',
       `他の設定は保存しました。config/local.json は書けませんでした: ${e.message}`,9000);
     return;
    }
   }
   pathConfigState.loaded=false;await loadPathConfigMaint(true);
   showToast&&showToast('パス設定を保存しました',extra,lcChanged?7000:5200);
  }catch(e){showToast&&showToast('保存できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }

 /* ---------- 勤務体系マスタ(親: 勤務体系 / 子: 勤務区分) ----------
    現場の言い方どおりの2階層で編集する。
      日勤              -> 日勤 8:15-17:05
      交替勤務(1,2,3直) -> 1直 7:00-15:00 / 2直 15:00-23:00 / 3直 23:00-翌7:00
    汎用のMASTER_DEFS(1行=1レコードの表)では親子を表現できないため専用画面にする。
    入力負荷を下げる工夫(直打ちを極力減らす):
      - 時刻はinput[type=time]。キーボードでもピッカーでも入れられ、
        "8:15"のような表記ゆれ・全角数字が原理的に入らない。
      - よくある勤務体系はテンプレートからワンクリックで投入できる。
      - 24時間バーで「どの時間帯が埋まっているか」を色で即座に確認できる
        (時刻の数字だけを見比べて抜け漏れを探さなくて済む)。 */
 const SHIFT_TEMPLATES=[
  {label:'日勤',segments:[{name:'日勤',start:'08:15',end:'17:05'}]},
  {label:'交替勤務(1,2,3直)',segments:[
    {name:'1直',start:'07:00',end:'15:00'},{name:'2直',start:'15:00',end:'23:00'},
    {name:'3直',start:'23:00',end:'07:00',dayOffset:-1}]},
  {label:'交替勤務(4,5直)',segments:[
    {name:'4直',start:'11:00',end:'19:10'},{name:'5直',start:'21:20',end:'05:45',dayOffset:-1}]},
 ];
 let shiftState={patterns:[],selectedId:null,draft:null,loading:false};
 /* 適用設備の複数選択(勤務体系マスタ)。**入で選ばれている設備名**を配列で返す。
    印はタグの入切(aria-pressed)で持つ——チェックボックスは`.mm-field input`の
    `min-width:200px`に当たり、器の幅を全部取って**設備名の文字が押し出されて
    見えなくなっていた**(実機で「設備名が消えている」と報告。§9.197)。 */
 function selectedShiftEquipment(){
  return [...document.querySelectorAll('#shiftEquipment [data-shift-eq][aria-pressed="true"]')]
   .map(x=>x.dataset.shiftEq);
 }
 function shiftDraftFrom(p){
  // equipmentは設備名の配列(複数可)。空配列=全設備共通。サーバーが古い形式
  // (単一文字列)を返しても配列へ寄せる。
  const eqList=v=>Array.isArray(v)?v.filter(Boolean).map(String):(String(v||'').trim()?[String(v).trim()]:[]);
  return p?{id:p.id,equipment:eqList(p.equipment),name:p.name||'',
            segments:(p.segments||[]).map(x=>({name:x.name,start:x.start,end:x.end,
              dayOffset:(x.dayOffset==null?null:Number(x.dayOffset))}))}
           :{id:null,equipment:[],name:'',segments:[]};
 }
 async function loadShiftPatternMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.classList.remove('mm-form-compact');
  if(typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){/* 設備が読めなくても編集は続行 */}}
  list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const r=await api('/api/schedule/shift-pattern-master?scope=all');
   shiftState.patterns=r.items||[];
   if(!shiftState.patterns.some(p=>p.id===shiftState.selectedId))shiftState.selectedId=shiftState.patterns[0]?.id??null;
   shiftState.draft=shiftDraftFrom(shiftState.patterns.find(p=>p.id===shiftState.selectedId));
   renderShiftPattern();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 // 24時間バー上の位置(%)。日跨ぎ(終了<=開始)は2本に分けて描く。
 function shiftBarPieces(seg){
  const toMin=v=>{const m=/^(\d{1,2}):(\d{2})$/.exec(String(v||''));return m?(+m[1])*60+(+m[2]):null};
  const s=toMin(seg.start),e=toMin(seg.end);
  if(s==null||e==null)return [];
  const pct=v=>(v/1440*100);
  return (e<=s)?[[pct(s),pct(1440)-pct(s)],[0,pct(e)]]:[[pct(s),pct(e)-pct(s)]];
 }
 /* 日を跨ぐ区分だけが持つ「日付の数え方」(§9.195の現場歴)。**跨がない区分
    には出さない**——効かない欄を置くと、設定したのに変わらないと読まれる。 */
 const SHIFT_DAYOFF_OPTIONS=[
  {v:-1,label:'前の日として数える（−1日）'},
  {v:0,label:'暦どおり（0日）'},
  {v:1,label:'翌日として数える（＋1日）'},
 ];
 /* **何が選ばれているかを文字で言う**(§3)。チェックの見た目だけだと、
    設備が多いときに「全設備共通なのか選び忘れなのか」が読めない。 */
 function shiftEqSummaryHtml(names,total){
  if(!total)return '';
  return names.length
   ? `<b>${names.length}</b> 設備に適用（${esc(names.slice(0,3).join('、'))}${names.length>3?' ほか':''}）`
   : '<b>全設備共通</b>（どれも選んでいないので既定として使われます）';
 }
 /* チェックのたびに**画面を組み直さないこと**——設備が多いと選ぶ器が
    スクロールごと巻き戻り、続けて選べない（§9.117と同じ罠）。文字だけ
    差し替える。 */
 function refreshShiftEqSummary(){
  const sum=$('#masterMaintList .shift-eq-sum');
  const names=selectedShiftEquipment();
  if(sum)sum.innerHTML=shiftEqSummaryHtml(names,(equipmentMasterState.items||[]).length);
  const none=$('#shiftEqNone');if(none)none.disabled=!names.length;
 }
 function shiftCrossesMidnight(seg){
  const t=v=>{const m=/^(\d{1,2}):(\d{2})$/.exec(String(v||''));return m?(+m[1])*60+(+m[2]):null};
  const a=t(seg&&seg.start),b=t(seg&&seg.end);
  return a!==null&&b!==null&&b<=a;
 }
 function shiftDayOffsetOf(seg){
  if(!shiftCrossesMidnight(seg))return 0;
  return (seg&&seg.dayOffset!=null&&seg.dayOffset!=='')?Number(seg.dayOffset):-1;
 }
 /* 勤務区分の1行。**見出しと同じグリッド定義を共有する**（別々に組むと
    左端がずれる。§9.176と同じ土台）。 */
 const SHIFT_SEG_COLS=[
  {k:'dot',label:''},{k:'name',label:'区分の名称'},{k:'time',label:'時間帯'},
  {k:'next',label:'日跨ぎ'},{k:'dayoff',label:'日付の数え方'},{k:'act',label:''},
 ];
 function renderShiftPattern(){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  const d=shiftState.draft||shiftDraftFrom(null);
  const eqSelected=new Set((d.equipment||[]).map(String));
  const eqItems=(equipmentMasterState.items||[]);
  /* 設備は**名前のタグの入切**で選ぶ(§9.197、利用者の指示「設備名のバッジを
     出して、配色のONOFF」)。名前そのものが押せる的なので、四角い枠と
     チェックの位置を目で往復しなくてよい。入は面の色で、**色だけで伝えない**
     ため上の要約が件数と名前を文字で言う。 */
  const eqChips=eqItems.length
   ? eqItems.map(x=>{
      const on=eqSelected.has(x.name);
      return `<button type="button" class="shift-eq-tag${on?' is-on':''}" data-shift-eq="${esc(x.name)}"`
       +` aria-pressed="${on?'true':'false'}" title="${esc(x.name)}を${on?'外す':'この勤務体系の対象にする'}">`
       +`<i aria-hidden="true">${on?'✓':'＋'}</i>${esc(x.name)}</button>`;
     }).join('')
   : '<span class="mm-empty-inline">設備マスタが未登録です。先に「設備」タブで登録してください。</span>';
  const eqSummary=shiftEqSummaryHtml([...eqSelected],eqItems.length);
  form.innerHTML=`<div class="mm-form-head">
    <span class="mm-mode-chip ${d.id?'editing':'new'}">${d.id?`編集中 <b>${esc(d.name||'')}</b>`:'新規の勤務体系'}</span>
    <button type="button" id="shiftNew" class="mm-btn-ghost sm">＋ 勤務体系を追加</button>
    <span class="mm-form-hint">テンプレート:</span>
    ${SHIFT_TEMPLATES.map((t,i)=>`<button type="button" class="mm-btn-ghost sm" data-shift-tmpl="${i}">${esc(t.label)}</button>`).join('')}
   </div>
   <p class="mm-def-hint">勤務体系(日勤・交替勤務など)の中に、各直の時間帯を並べます。作業スケジュールの「勤務」列は、予定の時刻が入る区分の名称を表示します。終了が開始以下の区分は翌日にまたがる勤務として扱い、<b>跨いだ後の時間帯は「日付の数え方」で決めた日付で数えます</b>（3直 23:00〜翌7:00 を1つの日としてまとめるための設定です）。適用設備を空欄にすると全設備の既定になり、設備を指定した体系があればそちらが優先されます。</p>`;
  form.onsubmit=ev=>ev.preventDefault();
  $('#shiftNew').onclick=()=>{shiftState.selectedId=null;shiftState.draft=shiftDraftFrom(null);renderShiftPattern()};
  form.querySelectorAll('[data-shift-tmpl]').forEach(b=>b.onclick=()=>{
   const t=SHIFT_TEMPLATES[+b.dataset.shiftTmpl];
   shiftState.draft={...d,name:d.name||t.label,segments:t.segments.map(x=>({...x}))};
   renderShiftPattern();
  });

  const bars=d.segments.map((seg,i)=>shiftBarPieces(seg).map(([left,w])=>
    `<span class="shift-bar-piece" data-i="${i%6}" style="left:${left}%;width:${w}%" title="${esc(seg.name)} ${esc(seg.start)}〜${esc(seg.end)}"></span>`).join('')).join('');
  const segHead=`<div class="shift-seg-head">${
    SHIFT_SEG_COLS.map(c=>`<span class="shift-seg-h shift-seg-c-${c.k}">${esc(c.label)}</span>`).join('')}</div>`;
  const segRow=(seg,i)=>{
   const cross=shiftCrossesMidnight(seg);
   const off=shiftDayOffsetOf(seg);
   return `<div class="shift-seg" data-i="${i}">
     <span class="shift-seg-dot" data-i="${i%6}"></span>
     <input class="shift-seg-name" type="text" value="${esc(seg.name)}" placeholder="例: 1直" autocomplete="off">
     <span class="shift-seg-time">
      <input class="shift-seg-start" type="time" value="${esc(seg.start)}">
      <span class="shift-seg-sep">〜</span>
      <input class="shift-seg-end" type="time" value="${esc(seg.end)}"></span>
     <span class="shift-seg-next${cross?'':' is-empty'}">${cross?'翌日':''}</span>
     ${cross
       ?`<select class="shift-seg-dayoff" title="日を跨いだ後の時間帯を、どの日として数えるか">${
          SHIFT_DAYOFF_OPTIONS.map(o=>`<option value="${o.v}"${o.v===off?' selected':''}>${esc(o.label)}</option>`).join('')}</select>`
       :'<span class="shift-seg-dayoff is-na" title="日を跨がない区分なので、日付の補正はありません">—</span>'}
     <span class="shift-seg-act">
      <button type="button" class="shift-seg-up" title="上へ"${i===0?' disabled':''}>▲</button>
      <button type="button" class="shift-seg-down" title="下へ"${i===d.segments.length-1?' disabled':''}>▼</button>
      <button type="button" class="shift-seg-del" title="この区分を削除">×</button></span>
    </div>`;
  };
  list.innerHTML=`<div class="shift-editor">
    <aside class="shift-list">
     <div class="shift-list-head">登録済みの勤務体系</div>
     ${shiftState.patterns.length?shiftState.patterns.map(p=>`<button type="button" class="shift-list-item${p.id===d.id?' active':''}" data-shift-pattern="${p.id}">
        <b>${esc(p.name)}</b><small>${esc(p.equipmentText||'全設備共通')} ・ ${(p.segments||[]).length}区分</small></button>`).join('')
       :'<div class="mm-empty-inline">まだありません。テンプレートから作れます。</div>'}
    </aside>
    <section class="shift-detail">
     <div class="shift-fields">
      <label class="mm-field shift-f-name"><span>勤務体系の名称<i>*</i></span>
       <input id="shiftName" type="text" value="${esc(d.name)}" placeholder="例: 交替勤務(1,2,3直)" autocomplete="off"></label>
      <div class="mm-field shift-f-eq"><span>適用設備</span>
       <div class="shift-eq-bar">
        <span class="shift-eq-sum">${eqSummary}</span>
        ${eqItems.length?`<span class="shift-eq-act">
          <button type="button" class="mm-btn-ghost sm" id="shiftEqAll">すべて選ぶ</button>
          <button type="button" class="mm-btn-ghost sm" id="shiftEqNone"${eqSelected.size?'':' disabled'}>全設備共通に戻す</button>
         </span>`:''}
       </div>
       <div class="shift-eq-picker" id="shiftEquipment">${eqChips}</div></div>
     </div>
     <div class="shift-bar-wrap">
      <div class="shift-bar" title="24時間のうち、どの時間帯がどの区分か">${bars}<span class="shift-bar-noon"></span></div>
      <div class="shift-bar-scale"><span>0時</span><span>6時</span><span>12時</span><span>18時</span><span>24時</span></div>
     </div>
     <div class="shift-segs" id="shiftSegs">${
       d.segments.length?segHead+d.segments.map(segRow).join('')
       :'<div class="mm-empty-inline">区分がありません。「＋ 区分を追加」かテンプレートから追加してください。</div>'}
     </div>
     <div class="shift-actions">
      <button type="button" id="shiftAddSeg" class="mm-btn-ghost sm">＋ 区分を追加</button>
      <span class="mm-form-hint" id="shiftCoverage"></span>
      <span class="shift-actions-tail">
       ${d.id?'<button type="button" id="shiftDelete" class="mm-btn-ghost sm">この勤務体系を削除</button>':''}
       <button type="button" id="shiftSave" class="mm-btn-primary sm">保存</button>
      </span>
     </div>
    </section>
   </div>`;

  list.querySelectorAll('[data-shift-pattern]').forEach(b=>b.onclick=()=>{
   shiftState.selectedId=+b.dataset.shiftPattern;
   shiftState.draft=shiftDraftFrom(shiftState.patterns.find(p=>p.id===shiftState.selectedId));
   renderShiftPattern();
  });
  const sync=()=>{
   const dd=shiftState.draft;
   dd.name=$('#shiftName').value;dd.equipment=selectedShiftEquipment();
   dd.segments=[...list.querySelectorAll('.shift-seg')].map(el=>{
    const off=el.querySelector('select.shift-seg-dayoff');
    return {name:el.querySelector('.shift-seg-name').value,
            start:el.querySelector('.shift-seg-start').value,
            end:el.querySelector('.shift-seg-end').value,
            dayOffset:off?Number(off.value):null};
   });
  };
  $('#shiftName').oninput=()=>{shiftState.draft.name=$('#shiftName').value};
  /* タグの入切。**押した瞬間にその場で切り替える**——画面を組み直すと器が
     スクロールごと巻き戻り、続けて選べない(§9.117と同じ罠)。 */
  $('#shiftEquipment')?.querySelectorAll('[data-shift-eq]').forEach(tag=>{
   tag.onclick=ev=>{
    ev.preventDefault();
    const on=tag.getAttribute('aria-pressed')!=='true';
    tag.setAttribute('aria-pressed',on?'true':'false');
    tag.classList.toggle('is-on',on);
    const mark=tag.querySelector('i');if(mark)mark.textContent=on?'✓':'＋';
    tag.title=`${tag.dataset.shiftEq}を${on?'外す':'この勤務体系の対象にする'}`;
    shiftState.draft.equipment=selectedShiftEquipment();
    refreshShiftEqSummary();
   };
  });
  const eqAll=$('#shiftEqAll');
  if(eqAll)eqAll.onclick=()=>{sync();
   shiftState.draft.equipment=(equipmentMasterState.items||[]).map(x=>x.name);renderShiftPattern()};
  const eqNone=$('#shiftEqNone');
  if(eqNone)eqNone.onclick=()=>{sync();shiftState.draft.equipment=[];renderShiftPattern()};
  list.querySelectorAll('.shift-seg').forEach(el=>{
   const i=+el.dataset.i;
   // 時刻・名称の変更はその場でバーへ反映する(保存前に結果が見える)。
   el.querySelectorAll('input').forEach(inp=>inp.onchange=()=>{sync();renderShiftPattern()});
   const off=el.querySelector('select.shift-seg-dayoff');
   if(off)off.onchange=()=>{sync();renderShiftPattern()};
   el.querySelector('.shift-seg-del').onclick=()=>{sync();shiftState.draft.segments.splice(i,1);renderShiftPattern()};
   el.querySelector('.shift-seg-up').onclick=()=>{sync();if(i>0)shiftState.draft.segments.splice(i-1,0,shiftState.draft.segments.splice(i,1)[0]);renderShiftPattern()};
   el.querySelector('.shift-seg-down').onclick=()=>{sync();const a=shiftState.draft.segments;if(i<a.length-1)a.splice(i+1,0,a.splice(i,1)[0]);renderShiftPattern()};
  });
  $('#shiftAddSeg').onclick=()=>{
   sync();
   const segs=shiftState.draft.segments;
   const last=segs[segs.length-1];
   // 直前の区分の終了時刻を次の開始時刻の初期値にする(連続する直の入力が
   // ほぼクリックだけで済む)。
   segs.push({name:`${segs.length+1}直`,start:last?last.end:'08:00',end:last?last.end:'17:00',dayOffset:null});
   renderShiftPattern();
  };
  const del=$('#shiftDelete');if(del)del.onclick=()=>deleteShiftPattern(d);
  $('#shiftSave').onclick=()=>{sync();saveShiftPattern()};
  renderShiftCoverage(d);
 }
 function renderShiftCoverage(d){
  const el=$('#shiftCoverage');if(!el)return;
  const total=d.segments.reduce((a,seg)=>a+shiftBarPieces(seg).reduce((x,[,w])=>x+w,0),0);
  if(!d.segments.length){el.textContent='';return}
  el.textContent=total>=99.5?'24時間をすべてカバーしています':`24時間のうち約${Math.round(total)}%をカバーしています`;
  el.className='mm-form-hint'+(total>=99.5?' shift-cov-ok':'');
 }
 async function saveShiftPattern(){
  const uid=requireMaintUser();if(uid===null)return;
  const d=shiftState.draft;
  if(!String(d.name||'').trim()){showToast('入力を確認してください','勤務体系の名称を入力してください。',4000);return}
  try{
   setMaintLoading(true,'勤務体系を保存しています…');
   const r=await api('/api/schedule/shift-pattern-master',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:d.id,equipment:d.equipment||[],name:d.name,segments:d.segments,user_id:uid})});
   shiftState.selectedId=r.id;
   await loadShiftPatternMaint(true);
   showToast&&showToast('勤務体系を保存しました',`${d.name}(${d.segments.length}区分)`,3600);
  }catch(e){showToast&&showToast('保存できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }
 async function deleteShiftPattern(d){
  const uid=requireMaintUser();if(uid===null)return;
  if(!d.id)return;
  if(typeof confirmModal==='function'){
   const ok=await confirmModal({eyebrow:'勤務形態',title:'この勤務体系を削除しますか？',
    message:`「${d.name}」とその配下の区分(${d.segments.length}件)を無効化します。`,confirmLabel:'削除する',danger:true});
   if(!ok)return;
  }
  try{
   setMaintLoading(true,'勤務体系を削除しています…');
   await api('/api/schedule/shift-pattern-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:d.id,user_id:uid})});
   shiftState.selectedId=null;
   await loadShiftPatternMaint(true);
   showToast&&showToast('勤務体系を削除しました',d.name,3600);
  }catch(e){showToast&&showToast('削除できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }


 /* ================================================================
    不要ファイルの掃除（§9.249 ①、利用者の指示）
    ----------------------------------------------------------------
    「溜まってくると問題なので、不要なキャッシュファイルや不要なバックアップ
      ファイルを削除する機能を実装してください。いらないものや世代の古いものは
      定期的に削除するような機能も欲しいです。」

    **判定はサーバーの1箇所**（`backend/file_cleanup.py`）。画面は
    返ってきた種別をそのまま並べるだけで、「どのファイルが要る／要らない」の
    規則を持たない（§9.163。2つ持つと画面が「消える」と言ったものが残る）。

    画面の作り（§CLAUDE「画面を作るときの基準」）:
     ・**面積は頻度×重要度。** いちばん大きいのは「いま何MB片付くか」と
       押すボタン——ここへ来る人はそれを見に来ている。設定は下段。
     ・**次にすることを1つだけ指す。** 溜まっていなければ「いまは何もする
       必要がありません」と書き、ボタンを押せなくする（§4）。
     ・**色だけで伝えない。** 種別ごとに件数・容量・**何が消えて何が残るか**を
       文字で出す。残す理由も1件ずつ言う（推測させない）。
     ・**消す前に何が消えるかを出す**（§9.193の下見と同じ作法）。確認は
       まとめて1回だけ（種別ごとに聞くと読まずに押す癖が付く・§9.170）。
    ================================================================ */
 let cleanupState={data:null,loaded:false,picked:null,busy:false};
 function clSize(n){
  const v=Number(n)||0;
  /* **単位を落とさない**（§CLAUDE 6）。「0・1件」だと0が何の0なのか読めない。 */
  if(v<=0)return '0B';
  if(v<1024)return v+'B';
  if(v<1048576)return (v/1024).toFixed(0)+'KB';
  if(v<1073741824)return (v/1048576).toFixed(1)+'MB';
  return (v/1073741824).toFixed(2)+'GB';
 }
 function clWhen(sec){
  if(!sec)return '—';
  const t=Number(sec)*1000;
  if(!Number.isFinite(t))return '—';
  const d=Math.floor((Date.now()-t)/86400000);
  const stamp=new Date(t).toLocaleDateString('ja-JP',{month:'2-digit',day:'2-digit'});
  return d<1?`${stamp}（今日）`:`${stamp}（${d}日前）`;
 }
 function clEvery(sec){
  const n=Math.max(1,Math.round(Number(sec||0)/60));
  return n<60?`${n}分ごと`:(n%60?`${Math.floor(n/60)}時間${n%60}分ごと`:`${Math.floor(n/60)}時間ごと`);
 }
 /* 選んでいる種別。**既定は「消せるものがある種別」すべて**。
    以前は自動掃除の対象だけを選んでいたが、そうすると上の帯が
    「8.2MB片付けられます」と言っているのにボタンが押せない、という
    **画面が自分の言ったことを否定する**状態が作れた（§CLAUDE 2「次にする
    ことを1つだけ指す」・§4）。消す前には必ず**何が消えるかを1件ずつ並べた
    確認**が出る（§9.193）ので、選んだまま押しても不意打ちにはならない。
    自動掃除の対象外であることは、カードにも確認にも文字で出す（§CLAUDE 3）。 */
 function clPicked(){
  const cats=(cleanupState.data&&cleanupState.data.categories)||[];
  if(!cleanupState.picked){
   cleanupState.picked=new Set(cats.filter(c=>c.removable>0).map(c=>c.key));
  }
  return cleanupState.picked;
 }
 function clPickedStats(){
  const cats=((cleanupState.data&&cleanupState.data.categories)||[]).filter(c=>clPicked().has(c.key));
  return {n:cats.reduce((a,c)=>a+c.removable,0),bytes:cats.reduce((a,c)=>a+c.removableBytes,0),cats};
 }
 async function loadCleanupMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(!force&&cleanupState.loaded){renderCleanup();return}
  form.innerHTML='';list.innerHTML='<div class="mm-empty">溜まっているファイルを調べています…</div>';
  try{
   const [d,cfg]=await Promise.all([api('/api/cleanup'),api('/api/path-config-master')]);
   cleanupState.data=d;cleanupState.cfg=cfg;cleanupState.loaded=true;cleanupState.picked=null;
   renderCleanup();
  }catch(e){list.innerHTML=`<div class="mm-empty error">調べられませんでした: ${esc(e.message)}</div>`}
 }
 function renderCleanup(){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  const d=cleanupState.data||{};
  const cats=d.categories||[],tot=d.total||{},pol=d.policy||{},st=d.state||{},places=d.places||{};
  const v=(cleanupState.cfg&&cleanupState.cfg.values)||{};
  const pick=clPicked(),sel=clPickedStats();
  /* 次にすること。**1つだけ指す**（§2）。 */
  const next=sel.n
   ? `いま <b>${clSize(sel.bytes)}（${sel.n}件）</b>を片付けられます。`
     +`何が消えるかは下のカードに出ています——確かめて「選んだものを掃除する」を押してください。`
   : (tot.removable
      ? `片付けられるものは <b>${clSize(tot.removableBytes)}（${tot.removable}件）</b>ありますが、`
        +`<b>種別を1つも選んでいません</b>。下のカードの左端で選んでください。`
      : 'いまは何もする必要がありません。<b>片付けられるファイルはありません</b>（定期掃除が効いています）。');
  form.innerHTML=`
   <div class="mm-form-head"><span class="mm-mode-chip editing">この端末のファイル</span></div>
   <p class="cl-lead">アプリが動くうちに増える<b>作り直せるファイル</b>だけを片付けます。
    <b>測定データ・マスタ・共有スケジュールには一切触れません</b>——ここから消せるのは、
    消しても次に使うときに作り直されるものだけです。</p>
   <div class="cl-top">
    <div class="cl-gauge">
     <div class="cl-gauge-main"><b>${clSize(tot.removableBytes||0)}</b><span>片付けられます</span></div>
     <div class="cl-gauge-sub">${tot.removable||0}件 ／ 全体 ${clSize(tot.bytes||0)}・${tot.files||0}件</div>
     <div class="cl-bar" role="img" aria-label="全体のうち片付けられる割合">
      <i style="width:${tot.bytes?Math.max(2,Math.round((tot.removableBytes/tot.bytes)*100)):0}%"></i></div>
    </div>
    <div class="cl-next"><span class="cl-next-label">次にすること</span><span>${next}</span></div>
   </div>`;
  /* **面積は頻度×重要度**（§CLAUDE 1）。片付けられる種別だけをカードで
     大きく出し、**いま空の種別は1行の札に畳む**——溜まっていないのが
     ふつうの状態なので、そこへ画面の大半を割くと、肝心の「消せるもの」が
     埋もれる。**畳んでも消さない**（何を見ているのかが分からなくなる・
     §CLAUDE 12）。並びはサーバーの順のままにする（開くたびに場所が
     変わると探すことになる）。 */
  const card=c=>{
   const on=pick.has(c.key);
   const none=!c.removable;
   return `<div class="cl-card${on?' is-on':''}${none?' is-empty':''}" data-cl-card="${esc(c.key)}">
    <label class="cl-card-head">
     <input type="checkbox" data-cl-pick="${esc(c.key)}"${on?' checked':''}${none?' disabled':''}>
     <span class="cl-ico" aria-hidden="true">${esc(c.icon||'')}</span>
     <b>${esc(c.label)}</b>
     <span class="cl-badge${none?' is-none':''}">${none?'なし':`${clSize(c.removableBytes)}・${c.removable}件`}</span>
    </label>
    <p class="cl-note">${esc(c.note)}</p>
    <dl class="cl-kv">
     <dt>消し方</dt><dd>${hintHtml(c.why)}</dd>
     <dt>いちばん古い</dt><dd>${clWhen(c.oldest)}</dd>
     <dt>自動掃除</dt><dd>${c.auto?'対象<small>（定期掃除でも消えます）</small>':'<b>対象外</b><small>（押したときだけ消えます）</small>'}</dd>
    </dl>
    ${c.examples&&c.examples.length?`<div class="cl-ex"><b>消えるもの</b><ul>${
      c.examples.map(x=>`<li><code title="${esc(x.name)}">${esc(x.name)}</code><em>${clSize(x.size)}</em><i>${clWhen(x.mtime)}</i></li>`).join('')
     }${c.removable>c.examples.length?`<li class="cl-more">ほか${c.removable-c.examples.length}件</li>`:''}</ul></div>`:''}
    ${c.keptExamples&&c.keptExamples.length?`<div class="cl-keep"><b>残すもの（${c.kept}件）</b><ul>${
      c.keptExamples.map(x=>`<li><code title="${esc(x.name)}">${esc(x.name)}</code><i>${esc(x.why)}</i></li>`).join('')}</ul></div>`
     :(c.kept?`<div class="cl-keep"><b>残すもの</b><span>${c.kept}件</span></div>`:'')}
   </div>`;
  };
  const hot=cats.filter(c=>c.removable>0),cold=cats.filter(c=>!c.removable);
  list.innerHTML=`
   ${hot.length?`<div class="cl-grid">${hot.map(card).join('')}</div>`
    :'<p class="cl-none">片付けられるファイルは<b>1件もありません</b>。溜まってきたらここへ出ます。</p>'}
   ${cold.length?`<div class="cl-cold"><b>いま空の種別（${cold.length}）</b>${cold.map(c=>
     `<span class="cl-cold-chip" title="${esc(c.label)}｜${esc(c.note)}">`
     +`<i aria-hidden="true">${esc(c.icon||'')}</i>${esc(c.label)}`
     +`${c.kept?`<em>${c.kept}件は残します</em>`:''}</span>`).join('')}</div>`:''}
   <div class="cl-foot">
    <div class="cl-foot-sum">選んでいるのは <b>${sel.cats.length}種別</b>
     ${sel.n?`／ <b>${clSize(sel.bytes)}（${sel.n}件）</b>が消えます`:'／ <b>消えるものはありません</b>'}</div>
    <div class="cl-foot-act">
     <button type="button" id="clReload" class="mm-btn-ghost sm">調べ直す</button>
     <button type="button" id="clRun" class="mm-btn-primary"${sel.n?'':' disabled'}
       title="${sel.n?'選んだ種別のファイルを消します（消す前に確認します）':'選んだ種別に消せるファイルがありません'}">選んだものを掃除する${sel.n?`（${clSize(sel.bytes)}）`:''}</button>
    </div>
   </div>
   <div class="cl-auto">
    <h4>定期掃除 — ${pol.auto?`<span class="cl-on">入</span> ${esc(clEvery(pol.intervalSec))}`:'<span class="cl-off">切</span>'}</h4>
    <p class="cl-auto-lead">アプリが動いているあいだ、<b>自動掃除の対象</b>の種別だけを決めた間隔で片付けます。
     <b>バイトコードと古い作業フォルダは自動では消しません</b>（消すと次の起動が一度だけ遅くなる／中身を確かめてから消したいため）。</p>
    <div class="cl-auto-fields">
     <label class="mm-field mm-w-md"><span>定期掃除</span>
      <select id="clAuto">
       <option value="on"${pol.auto?' selected':''}>入（決めた間隔で片付ける）</option>
       <option value="off"${pol.auto?'':' selected'}>切（押したときだけ片付ける）</option></select>
      <small class="mm-field-hint">切にしても、この画面から手で掃除できます。</small></label>
     <label class="mm-field mm-w-sm"><span>掃除の間隔</span>
      <span class="mm-field-num"><input type="number" id="clInterval" min="300" step="300"
        value="${esc(String(v.cleanup_interval_sec||pol.intervalSec||21600))}"><em>秒</em></span>
      <small class="mm-field-hint">300秒（5分）以上。既定は21600秒＝6時間です。</small></label>
     <label class="mm-field mm-w-xs"><span>残す世代</span>
      <span class="mm-field-num"><input type="number" id="clGens" min="1" max="50" step="1"
        value="${esc(String(v.cleanup_keep_generations||pol.keepGenerations||3))}"><em>世代</em></span>
      <small class="mm-field-hint">ログ・バックアップで<b>新しいほうから残す本数</b>です。</small></label>
     <label class="mm-field mm-w-xs"><span>残す日数</span>
      <span class="mm-field-num"><input type="number" id="clDays" min="1" max="3650" step="1"
        value="${esc(String(v.cleanup_keep_days||pol.keepDays||14))}"><em>日</em></span>
      <small class="mm-field-hint">この日数以内のものは、世代の数に関わらず残します。</small></label>
    </div>
    <div class="mm-cd-actions"><button type="button" id="clSaveCfg" class="mm-btn-primary">この設定を保存</button>
     <span class="mm-form-hint">保存後すぐ反映されます（再起動は要りません）。</span></div>
    <dl class="cl-kv cl-places">
     <dt>最後の掃除</dt><dd>${st.lastRunAt?`${clWhen(st.lastRunAt)}・${st.lastRemoved||0}件 ${clSize(st.lastFreed||0)}`:'まだ走っていません'}</dd>
     ${st.lastError?`<dt>前回の言い分</dt><dd class="is-warn">${esc(st.lastError)}</dd>`:''}
     <dt>写しの置き場</dt><dd><code title="${esc(places.cache||'')}">${esc(places.cache||'—')}</code></dd>
     <dt>ログの置き場</dt><dd><code title="${esc(places.logs||'')}">${esc(places.logs||'—')}</code></dd>
     <dt>控えの置き場</dt><dd><code title="${esc(places.backup||'')}">${esc(places.backup||'—')}</code></dd>
    </dl>
   </div>`;
  /* **チェックは`click`で受ける**（§9.90。`change`は`click`の後に飛ぶため、
     行ごと作り直す作りでは反映されない）。ここは器だけを描き直す。 */
  list.querySelectorAll('[data-cl-pick]').forEach(b=>b.onclick=()=>{
   const k=b.dataset.clPick;
   if(b.checked)pick.add(k);else pick.delete(k);
   renderCleanup();
  });
  $('#clReload').onclick=()=>{cleanupState.loaded=false;loadCleanupMaint(true)};
  const run=$('#clRun');
  if(run)run.onclick=()=>cleanupRun();
  $('#clSaveCfg').onclick=async()=>{
   /* **送るのはこの4つだけ。** パス設定の保存は「送られてきた項目だけ」を
      書くので、他の設定を巻き添えにしない（§9.192）。 */
   const body={cleanup_auto_enabled:String($('#clAuto').value||'on'),
               cleanup_interval_sec:String($('#clInterval').value||'').trim(),
               cleanup_keep_generations:String($('#clGens').value||'').trim(),
               cleanup_keep_days:String($('#clDays').value||'').trim(),
               user_id:String($('#masterUserId')?.value||'').trim()};
   try{
    setMaintLoading(true,'保存しています…');
    await api('/api/path-config-master',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    pathConfigState.loaded=false;
    showToast&&showToast('保存しました','次の掃除から新しい決まりで片付けます',4000);
   }catch(e){showToast&&showToast('保存できませんでした',e.message,7000)}
   finally{setMaintLoading(false);cleanupState.loaded=false;loadCleanupMaint(true)}
  };
 }
 /* 消す。**確認はまとめて1回**（§9.170）。何が消えるかは種別ごとの件数と
    容量で出す——「本当によろしいですか？」だけでは読まずに押す癖が付く。 */
 async function cleanupRun(){
  if(cleanupState.busy)return;
  const sel=clPickedStats();
  if(!sel.n)return;
  const body=`<p class="confirm-modal-message">次のファイルを消します。<b>取り消せません。</b></p>
   <ul class="cl-confirm">${sel.cats.filter(c=>c.removable).map(c=>
     `<li><b>${esc(c.label)}</b>${c.auto?'':'<i>自動掃除の対象外</i>'}<em>${clSize(c.removableBytes)}・${c.removable}件</em></li>`).join('')}</ul>
   <p class="confirm-modal-message">合計 <b>${clSize(sel.bytes)}（${sel.n}件）</b>。
    どれも<b>作り直せるファイル</b>で、測定データ・マスタ・共有スケジュールには触れません。</p>`;
  const ok=typeof confirmModal==='function'
   ? await confirmModal({title:'不要ファイルを消します',eyebrow:'CLEANUP',bodyHtml:body,
                         confirmLabel:'掃除する',danger:true})
   : window.confirm(`${clSize(sel.bytes)}（${sel.n}件）を消します。よろしいですか？`);
  if(!ok)return;
  cleanupState.busy=true;
  try{
   setMaintLoading(true,'掃除しています…');
   const r=await api('/api/cleanup/run',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({categories:[...clPicked()]})});
   /* **消せなかったものは失敗にしない**（§9.108）——待てば消せるので次の
      掃除で消える。黙らずに件数と理由を言う（§CLAUDE 4）。 */
   showToast&&showToast(`${r.removed||0}件・${clSize(r.bytes||0)}を片付けました`,
     r.failed?`${r.failed}件は使用中のため残りました（次の掃除で消えます）`:'',
     r.failed?7000:3600);
  }catch(e){showToast&&showToast('掃除できませんでした',e.message,7000)}
  finally{cleanupState.busy=false;setMaintLoading(false);cleanupState.loaded=false;loadCleanupMaint(true)}
 }


 /* ================================================================
    専用タブを持たないマスタを、階層の中で編集する（§9.249 ②、利用者の指示）
    ----------------------------------------------------------------
    「テーブル生データ内で閲覧可能なマスタかつ、テーブル生データマスタの配置
      された階層にないものは、この階層に配置し、編集可能な形に実装してください。」

    これまで`master.sqlite3`の表のうちタブを持たないものは、「テーブル生データ」
    から**眺めることしかできなかった**。直したいときは、その表を書いている
    画面（列の設定パネル・登録フィルタ・行の色…）を思い出して探しに行く必要が
    あり、**どこからも直せない表**（移行済みの旧マスタ）も混ざっていた。

    作り（**新しい画面を作らない**のが要点・§9.120）:
     ・**表の一覧と扱いはサーバーが答える**（`/api/master-table/catalog`）。
       画面には表の名前を1つも書かない（§9.163）。
     ・答えを**`def`の形へ翻訳するだけ**で、一覧・編集モーダル・削除・検索は
       既存の汎用CRUDがそのまま動く（`endpoint`＋`/update`＋`/delete`の
       4本セット・§CLAUDE「マスタ管理の汎用CRUDは4本セット」）。
     ・**入力欄は表の作り（PRAGMA）から組み立てる**——列を足しても書き足さない。
     ・**ふだんの直し方があるものは、それを画面に書く**（§CLAUDE 6）。
       ここで直せることと、専用の画面があることは両立する。
     ・**移行済みの表は別の群にして「もう読みません」と書く**（§4）。
       直せると書いておいて画面が変わらないのは、押せないボタンより悪い。
    ================================================================ */
 let mtState={loaded:false,loading:null,tables:[],err:''};
 /* 列の作りから入力欄を組み立てる。**監査列と主キーは出さない**
    （サーバーが埋める・付け替えられない）。 */
 function mtFieldOf(col,longNames){
  const name=String(col.name||'');
  const decl=String(col.decl||'').toUpperCase();
  const f={k:name,label:name};
  if(/INT|REAL|NUM|FLOA|DOUB/.test(decl))f.type='number';
  else if(longNames.some(x=>name.indexOf(x)>=0))Object.assign(f,{type:'textarea',rows:4,size:'full'});
  /* **必須は「空を受け付けない列」だけ**。既定値のある列は空でも通る。 */
  if(col.notnull&&col.default===null&&!/INT|REAL|NUM/.test(decl))f.required=true;
  return f;
 }
 function mtDefOf(t){
  const longNames=t.long||[];
  /* **「触らせない列」の判定はサーバーの1つの印を見る**（§9.163）。
     監査列と、rowidの別名になる`INTEGER PRIMARY KEY`だけが`auto`。
     利用者が決める鍵（`TEXT PRIMARY KEY`）は編集できる。 */
  const cols=(t.schema||[]).filter(c=>!(c.auto!==undefined?c.auto:(c.audit||c.pk)));
  const fields=cols.map(c=>mtFieldOf(c,longNames));
  /* 一覧の列は**先頭から6本まで**。全部並べると1列あたりが潰れて読めない
     （残りは編集モーダルで見る。§CLAUDE 11「入れ物は中身の長さから決める」）。 */
  const shown=cols.slice(0,6);
  const retired=t.kind==='retired';
  const where=t.where?`ふだんは**${t.where}**から書き換えています。`:'';
  return {group:retired?'retired':'internal',key:'mt:'+t.table,
          label:t.label||t.table,icon:(t.label||t.table).slice(0,1),
          endpoint:'/api/master-table/'+encodeURIComponent(t.table),
          hasDelete:!retired,editorModal:!retired,readOnly:retired,
          rawTable:t.table,rawKind:t.kind,
          titleText:t.table+(t.note?' — '+t.note:''),
          /* **消すのは本当に行を消すこと**。汎用の言い回し（無効化）は
             有効フラグを持つマスタのためのもので、ここでは嘘になる。 */
          deleteWord:'削除',
          fields:retired?[]:fields,
          cols:shown.length?shown.map((c,i)=>({k:c.name,label:c.name,grow:i===0?2:1}))
                          :[{k:'id',label:'行'}],
          /* **説明は`**強調**`で書く**（§9.222 ⑧）——`hintHtml()`は
             エスケープしてから印を`<b>`へ変えるので、生のHTMLを書くと
             タグがそのまま画面に出る。 */
          hint:(retired
            ? '**この表はアプリがもう読みません。**'+(t.where?t.where+'。':'')
              +'ここに残してあるのは、移行前の中身を見返せるようにするためです。'
              +'**書き換えても画面は変わりません**——だからこの表は読み取り専用にしてあります。'
            : (t.note?t.note+'。':'')+where
              +'ここでは**行をそのまま**足す・直す・消せます。'
              +'列の意味はアプリの内部の決まりに沿っているので、'
              +'**値の形（書き方）を変えると、その設定は読めなくなることがあります**。'
              +'迷ったときは、ふだんの画面から設定し直してください。')};
 }
 /* 移行済みの表を丸ごと消す（§9.250 ③）。**取り消せないので、消す前に
    「何を・何件」を名乗る**（§9.193の下見と同じ作法）。消したあとは
    タブごと消えるので、**次にどこへ行くのかも先に決めておく**（§CLAUDE 2）。 */
 async function dropRetiredTable(def){
  const rows=(maintState.items||[]).length;
  const body=`<p class="confirm-modal-message"><b>${esc(def.rawTable)}</b> をマスタDBから
    <b>丸ごと消します</b>。取り消せません。</p>
   <ul class="cl-confirm"><li><b>${esc(def.rawTable)}</b><em>${rows}件</em></li></ul>
   <p class="confirm-modal-message">この表は<b>アプリがもう読みません</b>
    （中身は移行先へ移っています）。消しても画面の動きは変わりません。</p>`;
  const ok=typeof confirmModal==='function'
   ? await confirmModal({title:'移行済みの表を削除します',eyebrow:'DROP TABLE',bodyHtml:body,
                         confirmLabel:'削除する',danger:true})
   : window.confirm(`${def.rawTable} を丸ごと消します。よろしいですか？`);
  if(!ok)return;
  try{
   setMaintLoading(true,'削除しています…');
   const r=await api('/api/master-table/'+encodeURIComponent(def.rawTable)+'/drop',
     {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({user_id:String($('#masterUserId')?.value||'').trim()})});
   /* **消えたタブに留まらない**——写しを捨てて一覧を取り直し、
      いま居るタブが無くなっていたら見えているものの先頭へ移す。 */
   mtState.loaded=false;
   await loadMasterTableCatalog(true);
   if(!allDefs().some(d=>d.key===maintState.defKey))maintState.defKey=firstVisibleDefKey();
   syncNav();await loadMaint(true);
   showToast&&showToast('削除しました',(r&&r.message)||def.rawTable,3600);
  }catch(e){showToast&&showToast('削除できませんでした',e.message,7000)}
  finally{setMaintLoading(false)}
 }
 async function loadMasterTableCatalog(force){
  if(!force&&mtState.loaded)return mtState.tables;
  if(mtState.loading)return mtState.loading;
  mtState.loading=(async()=>{
   try{
    const r=await api('/api/master-table/catalog');
    mtState.tables=(r&&r.tables)||[];mtState.err=(r&&r.error)||'';
   }catch(e){mtState.tables=[];mtState.err=e.message}
   mtState.loaded=true;mtState.loading=null;
   /* 「ここで編集」→「ふだんは別画面」の順（作業導線と視覚導線を揃える）。 */
   const rank={here:0,elsewhere:1,retired:2};
   rawDefs=mtState.tables.filter(t=>t.kind!=='covered')
    .sort((a,b)=>(rank[a.kind]??9)-(rank[b.kind]??9)||String(a.table).localeCompare(b.table,'ja'))
    .map(mtDefOf);
   renderMaintNav();syncNav();
   return mtState.tables;
  })();
  return mtState.loading;
 }
 /* ---------- テーブル生データ(旧「マスタ一覧」、ARCHITECTURE.md「マスタ管理の画面形態」で統合) ----------
    master.sqlite3のテーブルをそのまま読み取り専用で表示する。上のタブが
    面倒を見ていないテーブル(表示マスタ・スケジュール列表示マスタ・
    パス設定マスタの実体など)も確認できる、最後の手段としての生データ閲覧。
    編集は各専用タブから行う前提のため、ここでは書込導線を一切出さない。 */
 let rawTableState={tables:[],table:'',columns:[],rows:[],loaded:false};

 /* ==================================================================
    接続状況（§9.272、利用者の指示「誰がアクセス中か見える化し、接続中の
    ユーザーを視覚化し、強制的に接続切断したりする機能」）
    ------------------------------------------------------------------
    **できること（区分）の判定はサーバーが答える**（`can`／行ごとの
    `canDisconnect`）。画面で書き写すと「ボタンは出るのに断られる」が作れる。
    **押せない理由はその場に書く**（§4）。
    ================================================================== */
 const presenceState={data:null,err:'',timer:0,busy:''};

 function pzAgo(sec){
  const n=Math.max(0,Math.round(Number(sec)||0));
  if(n<60)return `${n}秒前`;
  if(n<3600)return `${Math.floor(n/60)}分前`;
  return `${Math.floor(n/3600)}時間前`;
 }
 function pzModeLabel(m){
  return {edit:'編集可能',view:'閲覧',schedule:'スケジュール'}[String(m||'')]||'—';
 }
 /* 画面の呼び名。**知らない鍵はそのまま出す**（黙って空欄にすると、
    新しい画面が増えたときに「何もしていない」ように見える・§9.204）。 */
 const PZ_VIEWS={list:'一覧',records:'データ一覧',schedule:'作業スケジュール',
  master:'マスタ管理',report:'測定帳票',dashboard:'ダッシュボード',
  calendar:'カレンダー',actuals:'実績データ',logs:'ログ'};
 function pzViewLabel(v){const k=String(v||'');return k?(PZ_VIEWS[k]||k):'—'}
 function pzStopTimer(){if(presenceState.timer){clearInterval(presenceState.timer);presenceState.timer=0}}

 async function loadPresenceMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.innerHTML='';
  if(force||!presenceState.data)list.innerHTML='<div class="mm-empty">接続状況を調べています…</div>';
  await pzFetch();
  pzStopTimer();
  /* **10秒ごとに読み直す**。人が入れ替わる画面なので、押して更新させると
     古い一覧を見たまま切断することになる。**画面を離れたら止める**
     （器が消えたことで気づく——専用の後始末を各所へ足さない）。 */
  presenceState.timer=setInterval(()=>{
   const el=document.getElementById('pzList');
   if(!el||!document.body.contains(el)){pzStopTimer();return}
   pzFetch();
  },10000);
 }

 async function pzFetch(){
  try{presenceState.data=await api('/api/presence');presenceState.err=''}
  catch(e){presenceState.err=e.message||String(e)}
  renderPresence();
 }

 function renderPresence(){
  const list=$('#masterMaintList');if(!list)return;
  const d=presenceState.data;
  if(!d){
   list.innerHTML=`<div class="mm-empty error">接続状況を読めませんでした: ${esc(presenceState.err||'原因不明')}</div>`;
   return;
  }
  const can=d.can||{},me=d.me||{},items=d.items||[];
  /* いまの自分の区分と、できることを**必ず文字で**出す（§3）。 */
  const roleNote=can.canDisconnect
   ?(can.canDisconnectDeveloper?'すべての端末を切断できます'
     :'開発者以外の端末を切断できます')
   :'切断はできません（見るだけです）';
  /* 置き場が共有でなければ、**見えていないことをそう言う**——「1件だけ」を
     「他に誰も居ない」と読まれないため。 */
  const scope=d.shared
   ?`共有の置き場を見ています（${esc(d.source==='master'?'マスタの隣':'作業予定の隣')}）`
   :'<b>この端末しか出ません</b>。マスタか作業予定を共有に置くと、他のPCも並びます';
  const mine=d.revoked;
  const banner=mine?`<div class="mm-warn-note" id="pzRevoked"><b>この端末は接続を解除されています。</b>
    ${esc(mine.by||'不明')}／${esc(mine.byPc||'不明')} により解除されました${mine.reason?`（理由: ${esc(mine.reason)}）`:''}。
    <b>書き込みだけが止まっています</b>——開いている画面と入力中の内容はそのままです。
    あと約${Math.max(1,Math.ceil((mine.remainingSec||0)/60))}分で自動的に戻ります。</div>`:'';

  const rows=items.map(x=>{
   const state=x.isMe?'<span class="pz-badge is-me">この端末</span>'
    :x.revoked?'<span class="pz-badge is-cut">切断中</span>'
    :'<span class="pz-badge is-on">接続中</span>';
   let action='';
   if(x.isMe)action='<span class="pz-why">自分自身は切断できません</span>';
   else if(x.revoked)action=can.canDisconnect
    ?`<button type="button" class="mm-btn-ghost sm" data-pz-allow="${esc(x.key)}">切断を取り消す</button>`
    :`<span class="pz-why">あと約${Math.max(1,Math.ceil((x.revoked.remainingSec||0)/60))}分</span>`;
   else if(x.canDisconnect)
    action=`<button type="button" class="mm-btn-ghost sm danger" data-pz-cut="${esc(x.key)}">切断する</button>`;
   else action=`<span class="pz-why">${can.canDisconnect?`「${esc(x.role)}」は切断できません`:'切断の権限がありません'}</span>`;
   return `<div class="pz-row${x.isMe?' is-me':''}">
     <span class="pz-c-state">${state}</span>
     <span class="pz-c-login">${esc(x.login||'（不明）')}</span>
     <span class="pz-c-pc">${esc(x.pc||'（不明）')}</span>
     <span class="pz-c-role">${esc(x.role||'')}</span>
     <span class="pz-c-mode">${esc(pzModeLabel(x.mode))}</span>
     <span class="pz-c-view">${esc(pzViewLabel(x.view))}</span>
     <span class="pz-c-seen">${esc(pzAgo(x.idleSec))}</span>
     <span class="pz-c-act">${action}</span>
   </div>`;
  }).join('');

  const empty=!items.length
   ?`<div class="mm-empty">${d.readable?'接続している端末がありません（この端末の在席は次のハートビートで出ます）。'
      :'在席の置き場を読めませんでした。共有フォルダへの接続を確認してください。'}</div>`:'';

  list.innerHTML=`${banner}
   <div class="pz-head">
    <div class="pz-me">この端末は <b>${esc(me.role||'')}</b> です — ${esc(roleNote)}
     <small>${esc(me.login||'（ログインID不明）')} ／ ${esc(me.pc||'（PC名不明）')}</small></div>
    <div class="pz-scope">${scope}<small>${esc(d.dir||'')}</small></div>
    <div class="pz-count">接続中 <b>${items.length}</b> 台<small>10秒ごとに読み直します</small></div>
   </div>
   <div class="pz-table" id="pzList">
    <div class="pz-row pz-headrow">
     <span class="pz-c-state">状態</span><span class="pz-c-login">ログインID</span>
     <span class="pz-c-pc">PC名</span><span class="pz-c-role">権限区分</span>
     <span class="pz-c-mode">モード</span><span class="pz-c-view">開いている画面</span>
     <span class="pz-c-seen">最後の応答</span><span class="pz-c-act">操作</span>
    </div>
    ${rows}
   </div>${empty}
   ${presenceState.err?`<div class="mm-empty error">読み直しに失敗しました: ${esc(presenceState.err)}</div>`:''}`;

  list.querySelectorAll('[data-pz-cut]').forEach(b=>b.addEventListener('click',()=>pzCut(b.dataset.pzCut)));
  list.querySelectorAll('[data-pz-allow]').forEach(b=>b.addEventListener('click',()=>pzAllow(b.dataset.pzAllow)));
 }

 async function pzCut(key){
  const x=(presenceState.data?.items||[]).find(r=>r.key===key);if(!x)return;
  /* **危ない操作なので相手を名指しで1回だけ確認する**（§5・§9.211 ②）。 */
  const reason=prompt(`${x.login||'（不明）'}／${x.pc||'（不明）'} の接続を解除します。\n`
   +`相手の書き込みが止まります（開いている画面は残ります）。\n`
   +`理由があれば書いてください（相手の画面に出ます）。`,'');
  if(reason===null)return;
  try{
   const r=await api('/api/presence/disconnect',{method:'POST',body:JSON.stringify({key,reason})});
   showToast('切断しました',`${x.login||''}／${x.pc||''} の書き込みを止めました（約${Math.round((r.cooldownSec||300)/60)}分）。`);
  }catch(e){showToast('切断できませんでした',e.message||String(e),6000)}
  pzFetch();
 }

 async function pzAllow(key){
  try{await api('/api/presence/allow',{method:'POST',body:JSON.stringify({key})});
      showToast('切断を取り消しました','その端末はすぐに書き込めるようになります。')}
  catch(e){showToast('取り消せませんでした',e.message||String(e),6000)}
  pzFetch();
 }

 async function loadRawTableMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.classList.remove('mm-form-compact');
  if(force||!rawTableState.loaded){
   form.innerHTML='<div class="mm-form-head"><span class="mm-mode-chip new">読み込み中</span></div>';
   list.innerHTML='<div class="mm-empty">テーブル一覧を取得しています…</div>';
   try{
    const r=await api('/api/tables?db=MASTER');
    rawTableState.tables=r.tables||[];rawTableState.loaded=true;
    if(!rawTableState.tables.includes(rawTableState.table))rawTableState.table=rawTableState.tables[0]||'';
   }catch(e){
    form.innerHTML='';
    list.innerHTML=`<div class="mm-empty error">テーブル一覧を取得できませんでした: ${esc(e.message)}</div>`;
    return;
   }
  }
  try{await loadMasterTableCatalog()}catch(e){/* 読めなくても一覧は出す */}
  renderRawTableForm();
  await loadRawTableRows();
 }
 function renderRawTableForm(){
  const form=$('#masterMaintForm');if(!form)return;
  if(!rawTableState.tables.length){form.innerHTML='<div class="mm-form-head"><span class="mm-mode-chip new">テーブルがありません</span></div>';return}
  const opts=rawTableState.tables.map(t=>`<option value="${esc(t)}"${t===rawTableState.table?' selected':''}>${esc(t)}</option>`).join('');
  /* **行き止まりにしない**（§9.249 ②）。ここは読むだけの画面なので、
     **その表をどこから直すのか**を必ず出して連れて行く（§CLAUDE 4・6）。
     判定はサーバーの答え（`/api/master-table/catalog`）で、画面には
     表と画面の対応を書き写さない（§9.163）。 */
  const info=(mtState.tables||[]).find(t=>t.table===rawTableState.table);
  const goKey=info?(info.kind==='covered'?info.tab:(info.kind==='retired'?'':'mt:'+info.table)):'';
  const goLabel=goKey?(allDefs().find(d=>d.key===goKey)||{}).label||'':'';
  const where=!info?''
   :(info.kind==='retired'
     ?`<p class="mm-def-hint">${hintHtml('**この表はアプリがもう読みません。**'+(info.where||''))}</p>`
     :(goLabel?`<div class="mm-raw-goto"><span>この表は<b>${esc(goLabel)}</b>から編集できます</span>`
       +`<button type="button" id="rawTableGo" class="mm-btn-primary sm">${esc(goLabel)}を開く</button></div>`:''));
  form.innerHTML=`<div class="mm-form-head">
    <label class="mm-field mm-field-inline"><span>テーブル</span><select id="rawTableSelect">${opts}</select></label>
    <button type="button" id="rawTableReload" class="mm-btn-ghost sm">再読込</button>
    <span class="mm-form-hint">ここは読むだけの画面です。編集は表ごとの専用タブから行います。</span>
   </div>
   <p class="mm-def-hint">${hintHtml('マスタDB(master.sqlite3)のテーブルをそのまま表示します。**専用タブを持たないマスタも「内部データ」から編集できます**（この一覧はどの表でも中身を確かめられる最後の手段です）。先頭200件まで表示します。')}</p>
   ${where}`;
  form.onsubmit=ev=>ev.preventDefault();
  const sel=$('#rawTableSelect');if(sel)sel.onchange=()=>{rawTableState.table=sel.value;renderRawTableForm();loadRawTableRows()};
  const rb=$('#rawTableReload');if(rb)rb.onclick=()=>loadRawTableRows();
  const go=$('#rawTableGo');
  if(go)go.onclick=()=>{maintState.defKey=goKey;maintState.editing=null;maintState.query='';syncNav();loadMaint(true)};
 }
 async function loadRawTableRows(){
  const list=$('#masterMaintList');if(!list)return;
  if(!rawTableState.table){list.innerHTML='<div class="mm-empty">テーブルを選択してください。</div>';return}
  list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const q=new URLSearchParams({db:'MASTER',table:rawTableState.table,page:1,page_size:200});
   const d=await api('/api/table?'+q);
   rawTableState.columns=d.columns||[];rawTableState.rows=d.rows||[];
   renderRawTableList(d.count);
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 function renderRawTableList(count){
  const list=$('#masterMaintList');if(!list)return;
  const cols=rawTableState.columns,rows=rawTableState.rows;
  if(!cols.length){list.innerHTML='<div class="mm-empty">列がありません。</div>';return}
  const head=cols.map(c=>`<th>${esc(c)}</th>`).join('');
  const body=rows.map(r=>`<tr>${cols.map(c=>{const v=r[c];return `<td title="${esc(v??'')}">${esc(v??'')||'<em class="mm-blank">—</em>'}</td>`}).join('')}</tr>`).join('');
  list.innerHTML=`<div class="mm-raw-meta">${esc(rawTableState.table)} — ${rows.length}件を表示${(count!=null&&count>rows.length)?` (全${count}件)`:''}</div>
   <div class="mm-raw-scroll"><table class="mm-raw-table"><thead><tr>${head}</tr></thead><tbody>${body||`<tr><td colspan="${cols.length}">データがありません。</td></tr>`}</tbody></table></div>`;
 }

 /* ============================================================
    帳票レイアウトマスタ（§9.254 ③、利用者の指示）
    ------------------------------------------------------------
    「帳票の表示画面からいける、レイアウト調整画面ですが、これは実質、
     帳票レイアウトマスタなので、マスタとしても配置し、この帳票レイアウト
     マスタと帳票ブロックマスタを配線しリンクさせてレイアウト調整画面から
     表示内容調整できたところなど、機能が重複する部分は統合して帳票マスタ
     として親子関係のある高性能マスタとしてさらに使いやすく改良再構成して
     ください」

    左＝**設備ごとの紙**（親）／右＝**その紙に載る塊**（子）。`op-choice`と
    同じ2ペインの作法（§9.221 ②）で、器→ペイン→一覧の3段に
    `flex:1;min-height:0`を通してスクロールは内側だけにする（§9.222 ⑤）。

    **判定と保存は`WL.reportLayout`の1本だけ**（§9.163）——幅の詰め方も
    既定の書き下ろしも紙の割りも`report-dashboard.js`にしか無い。ここで
    数え直すと、マスタと紙で違う答えが出る。
    ============================================================ */
 let rlyState={papers:[],picked:null,info:null,q:'',loading:false,err:''};
 function rlySay(text,bad){
  const el=$('#rlyState');if(!el)return;
  el.textContent=text||'';el.classList.toggle('is-bad',!!bad);
 }
 const RLY_COMMON='';                      /* 空＝設備の分からないロットの紙 */
 const rlyLabel=eq=>String(eq||'')||'共通（設備の分からないロット）';
 /* **閲覧モードでは触らせない**（§9.169と同じ作法）。列レイアウトマスタの
    保存はedit/scheduleにしか開いていないので、押せると403で断られる
    ——押せるのに何も起きないボタンは、無い機能より質が悪い（§4）。
    **消さずに押せなくして理由を書く**（何ができないのかが読めるように）。 */
 const rlyEditable=()=>((window.accessMode&&window.accessMode.mode)||'edit')!=='view';
 const RLY_READONLY='この端末は閲覧モードなので、配置は変えられません（編集モードの端末で直してください）。';
 /* 保存済みの紙。**サーバーだけが全対象を知っている**（§9.178）——`target`は
    画面が組み立てる文字列なので、どんな設備の紙が保存済みかは推測できない。 */
 async function rlyLoadPapers(){
  const prefix=(WL.reportLayout&&WL.reportLayout.targetOf(RLY_COMMON)||'report:共通')
    .replace(/共通$/,'');
  const saved=new Map();
  try{
   const r=await api('/api/column-layout-master?all=1');
   (r.items||[]).forEach(it=>{
    const t=String(it.target||'');
    if(t.indexOf(prefix)!==0)return;
    const name=t.slice(prefix.length);
    saved.set(name==='共通'?RLY_COMMON:name,
      {order:(it.order||[]).length,hidden:(it.hidden||[]).length});
   });
  }catch(e){/* 読めなくても設備の一覧は出せる（fail-open） */}
  /* **設備マスタが正**（§9.239 ③）。保存済みの紙だけを並べると、これから
     作る設備の紙を開く手立てが無い。保存が残っている「もう無い設備」も
     消さずに出す——消すと、その設定を片付けられなくなる。 */
  let eqs=[];
  try{await loadEquipmentMaster();eqs=(equipmentMasterState.items||[]).map(e=>e.name).filter(Boolean)}
  catch(e){eqs=[]}
  const seen=new Set(),out=[];
  const push=(eq,gone)=>{
   const k=String(eq||'');
   if(seen.has(k))return;
   seen.add(k);
   const s=saved.get(k)||null;
   out.push({equipment:k,label:rlyLabel(k),saved:!!s,
             blocks:s?s.order:0,hiddenCount:s?s.hidden:0,gone:!!gone});
  };
  push(RLY_COMMON,false);
  eqs.forEach(e=>push(e,false));
  [...saved.keys()].forEach(k=>push(k,true));
  return out;
 }
 async function loadReportLayoutMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.classList.remove('mm-form-compact');
  if(!(window.WL&&WL.reportLayout)){
   /* **公開漏れは黙って素通しにしない**（§CLAUDE）——「あれば使う」で書くと、
      名前を変えた日に画面が静かに空になる。 */
   console.error('WL.reportLayout が見つかりません（report-dashboard.js）');
   list.innerHTML='<div class="mm-empty">帳票の画面が読み込まれていないため、配置を読めません。</div>';
   return;
  }
  if(!list.querySelector('.rly-edit'))list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   rlyState.papers=await rlyLoadPapers();
   if(rlyState.picked==null||!rlyState.papers.some(p=>p.equipment===rlyState.picked)){
    /* **この端末の使用設備から始める**（§2「探させない」）——無ければ先頭。 */
    let want=null;
    try{want=(typeof currentConfiguredEquipment==='function')?currentConfiguredEquipment():''}
    catch(e){want=''}
    rlyState.picked=rlyState.papers.some(p=>p.equipment===want)?want:(rlyState.papers[0]||{}).equipment;
    if(rlyState.picked===undefined)rlyState.picked=RLY_COMMON;
   }
   rlyState.info=await WL.reportLayout.info(rlyState.picked);
   rlyState.err='';
  }catch(e){
   rlyState.err=e.message||String(e);
  }
  renderReportLayout();
 }
 function renderReportLayout(){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  /* **器の高さを中まで届ける**（§9.222 ⑤）。印を外すのは`loadMaintInner()`の
     1箇所——外し忘れると他のタブの一覧がスクロールしない枠になる。 */
  list.classList.add('is-fill');
  list.parentElement&&list.parentElement.classList.add('is-fill');
  const info=rlyState.info||{};
  form.innerHTML=`<div class="op-bar">`
   +`<span class="op-bar-note">左が<b>設備ごとの紙</b>、右がその紙に載る<b>塊</b>です。`
   +`塊そのもの（名前・種別・載せる項目）は<b>帳票ブロック</b>が持ちます。</span>`
   +`<button type="button" id="rlyArrange" class="mm-btn-primary sm"${rlyEditable()?'':' disabled'}`
   +` title="${rlyEditable()?'見本のロットでこの設備の紙を開き、置き場所を掴んで動かせる状態にします（実データは要りません）':esc(RLY_READONLY)}">紙で組み換える</button>`
   +`<button type="button" id="rlyGotoBlocks" class="mm-btn-ghost sm"`
   +` title="塊そのもの（名前・種別・載せる項目）を直す帳票ブロックマスタへ移ります">帳票ブロックを開く</button>`
   +`<span class="op-bar-state" id="rlyState"></span></div>`;
  list.innerHTML=`<div class="rly-edit">${rlyPaperPaneHtml()}${rlyBlockPaneHtml(info)}</div>`;
  bindReportLayout();
  if(rlyState.err)rlySay('配置を読めませんでした: '+rlyState.err,true);
 }
 function rlyPaperPaneHtml(){
  const q=String(rlyState.q||'').trim().toLowerCase();
  const all=rlyState.papers||[];
  const hit=q?all.filter(p=>p.label.toLowerCase().includes(q)):all;
  const kept=all.filter(p=>p.saved).length;
  return `<div class="rly-papers">
    <div class="rly-papers-head">
     <b>設備ごとの紙</b><span class="oc-count">${all.length}件（設定あり ${kept}件）</span>
     <input type="search" id="rlySearch" value="${esc(rlyState.q||'')}" placeholder="設備名で絞る" autocomplete="off">
    </div>
    <div class="rly-paper-list">${hit.map(p=>{
      const on=p.equipment===rlyState.picked;
      const state=p.saved?`${p.blocks}塊を配置${p.hiddenCount?`／外し ${p.hiddenCount}`:''}`:'既定のまま';
      return `<button type="button" class="rly-paper${on?' is-on':''}" data-rly-paper="${esc(p.equipment)}"
        title="${esc(p.label)}／${esc(state)}${p.gone?'／設備マスタにはもうありません（設定だけが残っています）':''}">
       <b>${esc(p.label)}</b>
       <span class="rly-paper-sub">
        <span class="rly-paper-meta">${esc(state)}</span>
        ${p.gone?'<span class="rly-paper-gone">設備マスタに無し</span>':''}
       </span>
      </button>`}).join('')
      ||`<p class="mm-empty">${q?'絞り込みに当たる設備がありません。':'設備がまだ登録されていません。'}</p>`}</div>
   </div>`;
 }
 function rlyBlockPaneHtml(info){
  if(!info||!info.blocks)return `<div class="rly-blocks"><p class="mm-empty">左で<b>設備</b>を選ぶと、その紙に載る塊が出ます。</p></div>`;
  const shown=info.blocks.filter(b=>b.shown).length;
  const spans=info.spans||[],rowChoices=info.rowChoices||[];
  const ro=rlyEditable()?'':' disabled';
  const head=`<div class="rly-blocks-head">
    <b>${esc(rlyLabel(info.equipment))}の紙</b>
    <span class="oc-count">塊 ${info.blocks.length}件（出す ${shown}／出さない ${info.blocks.length-shown}）</span>
    <span class="rly-grid">紙の割り
     <span class="rly-grid-pick" role="group" aria-label="紙の列数">${(info.gridChoices||[]).map(n=>
       `<button type="button" data-rly-cols="${n}" class="${n===info.grid?'is-on':''}"${ro} title="紙を横${n}マスに割ります">${n}列</button>`).join('')}</span>
     <span class="rly-grid-pick" role="group" aria-label="紙の段数">${(info.pageRowChoices||[]).map(n=>
       `<button type="button" data-rly-rows="${n}" class="${n===info.pageRows?'is-on':''}"${ro} title="紙を縦${n}段に割ります">${n}段</button>`).join('')}</span>
    </span>
    <button type="button" id="rlyReset" class="mm-btn-ghost sm danger"${(info.saved&&rlyEditable())?'':' disabled'}
      title="${!rlyEditable()?esc(RLY_READONLY)
        :(info.saved?'この設備の配置を消して、登録順・登録幅・全部出す（既定）へ戻します'
        :'まだこの設備の配置は保存されていません（いまも既定のままです）')}">既定に戻す</button>
   </div>`;
  const rows=info.blocks.map(b=>{
   const pos=b.col&&b.row?`${b.col}列 ${b.row}段`:'自動';
   const origin=b.user?'自作の塊':(b.id?'既定の塊':'既定の塊（マスタ未登録）');
   /* **既定と違うところを言う**（§9.254 ③／§2）——幅と高さは帳票ブロックが
      既定を持ち、この紙が上書きする。どちらで直すのかを思い出させないため、
      **違うときだけ**「既定 X → いま Y」と書く（同じときは何も足さない）。 */
   const rowsWord=n=>n?`${n}/${info.pageRows}段`:'中身なり';
   const diff=[];
   if(b.defSpan&&b.span!==b.defSpan)diff.push(`幅 既定${b.defSpan}→${b.span}`);
   if(b.rows!==b.defRows)diff.push(`高さ 既定${rowsWord(b.defRows)}→${rowsWord(b.rows)}`);
   return `<div class="rly-row${b.shown?'':' is-off'}" data-rly-key="${esc(b.key)}">
     <span class="rly-cell rly-name" title="${esc(b.key)}">
      <b>${esc(b.label)}</b>
      <small>${esc(origin)}${b.kind?'・'+esc(b.kind):''}${b.fields?`・${b.fields}項目`:''}${
       diff.length?`<i class="rly-diff" title="帳票ブロックが持つ既定と違います。既定へ戻すには同じ値を選び直してください">${esc(diff.join('・'))}</i>`:''}</small></span>
     <span class="rly-cell rly-vis">
      <button type="button" class="rly-tgl${b.shown?' is-on':''}" data-rly-vis="${esc(b.key)}"
        aria-pressed="${b.shown?'true':'false'}"${ro}
        title="${ro?esc(RLY_READONLY):(b.shown?'この紙から外します（設定は残ります）':'この紙へ出します')}">${b.shown?'出す':'出さない'}</button></span>
     <span class="rly-cell rly-pick">
      <select data-rly-span="${esc(b.key)}" aria-label="${esc(b.label)}の幅"${ro}
        title="${ro?esc(RLY_READONLY):`紙の横${info.grid}マスのうち何マスを使うかです`}">${spans.map(c=>
        `<option value="${c.v}"${c.v===b.span?' selected':''}>幅 ${esc(c.label)}（${c.v}/${info.grid}）</option>`).join('')}</select></span>
     <span class="rly-cell rly-pick">
      <select data-rly-rows-of="${esc(b.key)}" aria-label="${esc(b.label)}の高さ"${ro}
        title="${ro?esc(RLY_READONLY):`紙の縦${info.pageRows}段のうち何段を使うかです。「中身なり」は描いてから測って合わせます`}">
       <option value="0"${b.rows?'':' selected'}>高さ 中身なり</option>${rowChoices.map(c=>
        `<option value="${c.v}"${c.v===b.rows?' selected':''}>高さ ${esc(c.label)}（${c.v}/${info.pageRows}）</option>`).join('')}</select></span>
     <span class="rly-cell rly-pos" title="置き場所は「紙で組み換える」で決めます">${esc(pos)}</span>
     <span class="rly-cell rly-act">
      ${b.id?`<button type="button" class="mm-btn-ghost sm" data-rly-edit="${b.id}"
        title="この塊そのもの（名前・種別・載せる項目）を帳票ブロックマスタで直します">中身を直す</button>`
       :`<em class="mm-blank" title="この塊はアプリがもともと持っているもので、帳票ブロックマスタにまだ行がありません">—</em>`}</span>
    </div>`;
  }).join('');
  return `<div class="rly-blocks">
    ${head}
    <div class="rly-table" role="table">
     <div class="rly-row is-head" role="row">
      <span>塊</span><span>紙に出す</span><span>幅</span><span>高さ</span><span>置き場所</span><span></span>
     </div>
     <div class="rly-table-scroll">${rows||'<p class="mm-empty">この設備の紙に載る塊がありません。</p>'}</div>
    </div>
    <p class="rly-note">${rlyEditable()?'':`<b>${esc(RLY_READONLY)}</b> `}置き場所（何列目・何段目）は<b>紙で組み換える</b>から、見本のロットで実際の紙を見ながら決めます。
     ここで決めた幅・高さ・出す/出さないは<b>この設備の紙だけ</b>に効きます（塊そのものの既定は帳票ブロックが持ちます）。</p>
   </div>`;
 }
 function bindReportLayout(){
  const list=$('#masterMaintList');if(!list)return;
  const se=$('#rlySearch');
  if(se)se.oninput=()=>{
   /* **入力中に器を作り直さない**（§9.117）——1文字ごとにカーソルが飛ぶ。
      作り直すのは左の一覧だけ。 */
   rlyState.q=se.value;
   const pane=list.querySelector('.rly-papers');
   if(!pane){renderReportLayout();return}
   const keep=se.selectionStart;
   pane.outerHTML=rlyPaperPaneHtml();
   bindReportLayout();
   const el=$('#rlySearch');
   if(el){el.focus();try{el.setSelectionRange(keep,keep)}catch(_){}}
  };
  list.querySelectorAll('[data-rly-paper]').forEach(b=>b.onclick=()=>rlyPick(b.dataset.rlyPaper));
  list.querySelectorAll('[data-rly-vis]').forEach(b=>b.onclick=()=>{
   const k=b.dataset.rlyVis,on=b.classList.contains('is-on');
   rlyWrite(()=>WL.reportLayout.setShown(rlyState.picked,k,!on),
     on?`「${k}」を紙から外しました。`:`「${k}」を紙へ出しました。`);
  });
  list.querySelectorAll('select[data-rly-span]').forEach(el=>el.onchange=()=>{
   const k=el.dataset.rlySpan;
   rlyWrite(()=>WL.reportLayout.setSpan(rlyState.picked,k,Number(el.value)),`「${k}」の幅を変えました。`);
  });
  list.querySelectorAll('select[data-rly-rows-of]').forEach(el=>el.onchange=()=>{
   const k=el.dataset.rlyRowsOf;
   rlyWrite(()=>WL.reportLayout.setRows(rlyState.picked,k,Number(el.value)),`「${k}」の高さを変えました。`);
  });
  list.querySelectorAll('[data-rly-cols]').forEach(b=>b.onclick=()=>
   rlyWrite(()=>WL.reportLayout.setGrid(rlyState.picked,Number(b.dataset.rlyCols),null),'紙の列数を変えました。'));
  list.querySelectorAll('[data-rly-rows]').forEach(b=>b.onclick=()=>
   rlyWrite(()=>WL.reportLayout.setGrid(rlyState.picked,null,Number(b.dataset.rlyRows)),'紙の段数を変えました。'));
  list.querySelectorAll('[data-rly-edit]').forEach(b=>b.onclick=()=>rlyEditBlock(b.dataset.rlyEdit));
  const rs=$('#rlyReset');
  if(rs)rs.onclick=async()=>{
   /* **消える操作は1回だけ確かめる**（§CLAUDE 5）。 */
   if(!confirm(`${rlyLabel(rlyState.picked)}の紙の設定（並び・幅・高さ・出す/出さない・紙の割り）を消して、既定に戻しますか？\n塊そのもの（帳票ブロック）は消えません。`))return;
   rlyWrite(()=>WL.reportLayout.reset(rlyState.picked),'既定に戻しました。');
  };
  const ar=$('#rlyArrange');
  if(ar)ar.onclick=async()=>{
   rlySay('見本のロットで紙を開いています…');
   try{await WL.reportLayout.arrange(rlyState.picked,{returnTo:'layout'})}
   catch(e){rlySay('紙を開けませんでした: '+(e.message||String(e)),true)}
  };
  const gb=$('#rlyGotoBlocks');
  if(gb)gb.onclick=()=>document.querySelector('#masterMaintNav [data-master="reportBlock"]')?.click();
 }
 async function rlyPick(eq){
  const v=String(eq||'');
  if(rlyState.picked===v&&rlyState.info)return;
  rlyState.picked=v;
  rlySay('読み込んでいます…');
  try{rlyState.info=await WL.reportLayout.info(v);rlyState.err=''}
  catch(e){rlyState.err=e.message||String(e)}
  renderReportLayout();
 }
 /* 書き込みは1本にまとめる。**保存の状態を必ず文字で出す**（§9.212 ④）
    ——黙って投げると、次の読み直しで元の値が出るだけで「勝手に戻った」と
    しか見えない。書いたあとは**帳票の写しも捨てる**（§9.226 ①）。 */
 async function rlyWrite(run,okText){
  if(requireMaintUser()===null)return;
  rlySay('保存しています…');
  try{
   await run();
   forgetReportCaches();
   rlyState.papers=await rlyLoadPapers();
   rlyState.info=await WL.reportLayout.info(rlyState.picked);
   rlyState.err='';
   renderReportLayout();
   rlySay(okText||'保存しました。');
  }catch(e){
   rlySay('保存できませんでした: '+(e.message||String(e)),true);
  }
 }
 /* 子（帳票ブロック）へ渡す。**開いていたタブごと移る**（§9.253と同じ
    作法）——「マスタ管理の先頭」へ落とすと、直したい塊をもう一度探すことになる。 */
 /* ---------- 紙から帳票ブロックマスタへ（§9.274、利用者の指示） ----------
    「帳票の紙レイアウトからブロックをダブルクリックしたら、帳票ブロック
     マスタに移行するように配線してください。今のモーダルでできることは
     少ないのでマスタに繋いできちんと修正できるようにしたいです」

    **開き方は`rlyEditBlock()`の1本**（帳票レイアウトマスタからの行き来と
    同じ道）——2つ持つと、片方だけ直したときに「紙からは開けるのに
    レイアウトからは開けない」が作れる。 */
 WL.reportBlockMaster={
  open:async id=>{
   if(id==null||id==='')  {showToast&&showToast('この塊はマスタに行がありません',
     'この端末のマスタにまだ登録されていない塊です（マスタ管理 > 帳票ブロックを開くと作られます）。',5200);return}
   /* **マスタ管理へ移ってから開く**——帳票の画面から呼ばれるので、
      タブが出来上がるのを待つ必要がある（`rlyEditBlock`が待つ）。 */
   if(typeof openMasterMaint==='function')openMasterMaint('reportBlock');
   await rlyEditBlock(id);
  }};
 async function rlyEditBlock(id){
  const nav=document.querySelector('#masterMaintNav [data-master="reportBlock"]');
  if(!nav){rlySay('帳票ブロックのタブが見つかりません。',true);return}
  nav.click();
  /* 一覧が届いてから開く。**届かなければ一覧のまま**（黙って何もしない、を
     作らない）。 */
  for(let i=0;i<60;i++){
   const it=(maintState.items||[]).find(x=>String(x.id)===String(id));
   if(it){openMaintEditor(it);return}
   await new Promise(r=>setTimeout(r,100));
  }
  showToast&&showToast('塊を開けませんでした','帳票ブロックの一覧から選んでください。',5000);
 }

 function openMasterMaint(defKey){
  WL.enterView('master');
  /* どのタブを開くか指定できる(§9.183)。左メニューの「再起動待ち」から
     押したときに、データ接続のタブを開いた状態で出すため。 */
  if(defKey&&allDefs().some(d=>d.key===defKey))maintState.defKey=defKey;
  const panel=ensureMaintPanel();
  WL.syncViewToolbar('master');   // 更新者ID(#mmHead)はパネル生成後にヘッダーへ載せる
  renderMaintNav();
  paintMaintUser();
  if(!maintDefVisible(currentDef()))maintState.defKey=firstVisibleDefKey();
  maintState.editing=null;maintState.query='';
  const se=$('#masterMaintSearch');if(se)se.value='';
  syncNav();panel.hidden=false;loadMaint(true);
  /* 専用タブを持たないマスタ（§9.249 ②）。**画面は待たせない**——届いたら
     ナビを描き直す。読めなくても他のタブは今までどおり使える。 */
  loadMasterTableCatalog().catch(()=>{});
  /* 更新者IDは打ち込む欄では無くなった（§9.276 ③）ので、最初のフォーカスは
     絞り込みへ渡す（打てない物へ当てると、そこで手が止まる）。 */
  requestAnimationFrame(()=>{const s=$('#masterMaintSearch');if(s)s.focus()});
 }
 window.openMasterMaint=openMasterMaint;

 // #openMasterMaintのクリックはここ(document委譲・capture)一箇所のみで処理する。
 // 以前はbindMasterMaint()でボタン自身にもonclickを付けていたが、この

 /* ================================================================
    操業データの配置（§9.216 ④、利用者の指示）
    ----------------------------------------------------------------
    「特に『操業データ項目』と『操業データ選択肢』について、相互リンク、
      連携を強めてより登録の負荷を下げて汎用性を向上させてほしい」
    「描画可能なエリア(縦2×横3のカード)内の中でレイアウトも含めてマスタ上で
      視覚的に調整D&Dで並び替え編集ができる汎用設定機能」

    行を1つずつ編集する一覧では、**並べたときにどう見えるか**が分からない。
    ここでは測定画面のカードと**同じ12マスのグリッド**を出し、掴んで動かす。
    群は「直前の見出し帯」で決まるので、**1回の操作で並びと群の両方**が
    決まる（別々に選ばせない）。

    **1項目の設定はモーダルで開く**（§9.218 ①、利用者の指摘「操業データ
    項目を選んだときにメニューが右側で固定され、設定しにくい」）。以前は
    右の細い柱に押し込んでいたため、盤は狭いのに設定は縦に長く、幅・型・
    選択肢を触るたびに視線が往復していた。モーダルなら左に**実物**（測定
    画面と同じ部品を選んだマス数の器に入れて出す）、右に**決めること**を
    並べられる。**選択肢はその場で足せる**——項目を作る手を止めて別のタブへ
    行かせない（利用者の言う「登録の負荷」の正体）。
    ================================================================ */
 const opState={equipment:'',items:[],types:[],places:['準備','入力内容'],
                spans:Array.from({length:12},(_,i)=>i+1),
                widgets:['プルダウン','ラジオ','セグメント','タブ','ボタン群','一覧'],
                /* 型ごとに効く入力方法。**サーバーが答える**（§9.219 ③）
                   ——ここは届くまでの受け皿で、判定を画面に持たない。 */
                widgetFamilies:{choice:['プルダウン','ラジオ','セグメント','タブ','ボタン群','一覧'],
                                number:['プルダウン'],text:['プルダウン'],
                                /* 画面が値を入れる欄（§9.232）。選ばせ方は無い。 */
                                output:[]},
                choiceTypes:['選択'],numberTypes:['整数','正の整数','数値','正の数'],
                spanUnit:2,
                /* 見せ方の選択肢（§9.221 ⑦）。**サーバーが答える**——ここは
                   届くまでの受け皿で、増減の規則を画面に持たない。 */
                unitPlaces:['外上左','外上中央','外上右','内部','外下左','外下中央','外下右','出さない'],
                aligns:['自動','左','中央','右'],
                valueFormats:['そのまま','3桁区切り','ゼロ埋め'],
                unitInBlocked:[],unitInFreeTextBlocked:[],freeTextBlocked:[],
                choiceOrders:[],choiceOrderWidgets:[],widgetGroups:[],
                /* §9.286 ⑥ 未入力の配色の語彙。ここは届くまでの受け皿。 */
                blankTints:[],blankTintNone:'なし',
                /* 並べ方の選択肢と、それが効く入力方法（§9.226 ①）。
                   **サーバーが答える**——ここは届くまでの受け皿。 */
                layouts:['自動'],layoutWidgets:[],
                /* §9.223 ①③。**サーバーが答える**（役割の一覧・構成の状態・
                   意匠の軸）。ここは届くまでの受け皿で、規則を画面に持たない。 */
                roles:[],roleReport:null,
                lookColors:['既定'],lookShapes:['標準'],lookSizes:['中'],
                /* 開いている浮き出し（§9.299。同時に2枚開かない）。
                   段（タブ）は廃止したので`tab`は持たない。 */
                pop:'',
                gridCols:12,choiceNames:[],choices:[],notes:{},usage:{},choiceHints:{},
                /* 上下限の出どころ（§9.231 ②）。**サーバーが答える**
                   ——鍵・呼び名・単位・いまの値の4つ。ここは届くまでの
                   受け皿で、引き方の規則を画面に持たない。 */
                limitSources:[],
                /* 自動で入る値の添え書きの置き場と、添え書きを持つ項目
                   （§9.233 ⑤）。**サーバーが答える**——どの欄が仕掛から
                   値を引くかは、引いている側しか知らない。 */
                sourceNotePlaces:['欄の下','名前の横','出さない'],sourceNoteKeys:[],autoFills:[],
                /* 自動で入る値・計算値の一覧（§9.234 ②）。**サーバーが答える**
                   ——ここは届くまでの受け皿で、鍵の綴りを画面に持たない。 */
                autoValues:[],autoFormulaKey:'',
                /* 同じ群がばらけて保存されていた置き場（§9.219 ③）。
                   まとめて描いたことを画面に書くために覚える。 */
                healed:new Set(),
                /* 掴んでいるもの。**カードと群は別の控え**（§9.230 ④）
                   ——1つにまとめると「いま何を運んでいるか」が読めない。 */
                picked:null,busy:false,drag:null,dragGroup:null};
 const OP_PLACE_NOTE={
  '準備':'①準備の「操業データ」カード（横3マス×縦2マス）',
  '入力内容':'②測定の「入力内容」カード（畳んでおき、下の「開く条件」に当たる項目を選ぶと開きます）',
  /* §9.232。**畳みの対象ではない**——面ごと出し分けるので「開く条件」は効かない。 */
  '母材':'②測定の「母材」カード（入力内容が「母材・揃い/肉厚/長さ」のときだけ出る面）',
 };
 /* 型の一言。**選ばせる前に何が起きるかを書く**（§CLAUDE 6）。 */
 const OP_TYPE_NOTE={
  '整数':'小数点なし。マイナスも入る',
  '正の整数':'小数点なし・0以上',
  '数値':'小数あり。マイナスも入る',
  '正の数':'小数あり・0以上',
  '選択':'下の選択肢から選ぶ',
  '文字':'自由記述',
 };
 /* 選ばせ方の一言と向き不向き（§9.218 ②）。**数だけで決めない**が、
    目安を書いておくと迷いが減る。 */
 const OP_WIDGET_NOTE={
  'プルダウン':{icon:'▾',note:'畳んで1行。数が多くても場所を取らない'},
  /* §9.220 ①（利用者の指摘「ラジオボタンやタブがほぼ同じデザインに
     なっている」）。**形が違うものを別の名前にした**——以前は`ラジオ`と
     `タブ`が同じ角ばったボタンで、違いは連なっているかだけだった。 */
  'ラジオ':{icon:'◉',note:'丸ぽち。全部見えたまま選ぶ。3〜5個向き'},
  'セグメント':{icon:'▤',note:'1本の帯を仕切る。選んだ札が浮く。2〜4個向き'},
  'タブ':{icon:'⊤',note:'下線と淡い面で示す。下に続く欄と地続きに読ませたいとき'},
  'ボタン群':{icon:'⬭',note:'独立した札。数が多くても折り返して読める'},
  '一覧':{icon:'⌸',note:'押すと浮き窓。説明つきで選べる（数が多いとき）'},
  /* §9.219 ③（利用者の指示「UIの種類を増やしたり」）。数値・自由記述にも
     「押して決める道具」を置く。**素の欄は残る**ので、打つこともできる。 */
  'ステッパー':{icon:'∓',note:'−／＋で1つずつ増減。1〜9くらいの整数向き'},
  'スピナー':{icon:'⇕',note:'欄の右端に小さな上下矢印。狭いマスでも入る'},
  'スライダー':{icon:'⇹',note:'目盛を引いて決める。上下限のある数値向き'},
  'キーパッド':{icon:'⌗',note:'押すと浮き窓のテンキー。キーボードの無い端末向き'},
  'メモ':{icon:'☰',note:'複数行で書ける。自由記述向き'},
  /* §9.223 ③（利用者の指示「6種類しかないので…バリエーションを増やして」）。
     **足すのは「選ぶ状況が違うもの」だけ**——見た目の違いは意匠の軸が持つ
     ので、色違いを種類として増やさない（選ぶ盤が同じ物の色違いで埋まる）。 */
  'カード':{icon:'▢',note:'説明を添えた大きな札。選ぶのに説明が要るとき'},
  'トグル':{icon:'⇆',note:'2択の入切。対になっているもの（有/無・OS/DS）'},
  '早見ボタン':{icon:'⋯',note:'よく使う値を並べる。最小・最大・刻みから作る'},
  '1行':{icon:'—',note:'素の1行入力。メモほどの高さが要らないとき'},
  /* §9.226 ①（利用者の指示「UIの種類をもっと増やしてほしい」）。ここでも
     **足すのは「選ぶ状況が違うもの」だけ**——並べ方と意匠が別の軸にあるので、
     色違い・並び違いを種類として増やさない。 */
  '段階':{icon:'▰',note:'順番のある選択肢。選んだところまで塗る（等級・良/可/否）'},
  '入切':{icon:'◐',note:'1つのスイッチ。入＝先頭の値／切＝空欄（付ける・付けない）'},
  /* §9.247 ①（利用者の指示「フローティングメニューみたいなものや、クリックで
     選択肢が変化するタイプのUIなど」）。**一覧とどう違うかを一言に書く**
     ——名前だけでは「浮き窓が開く」点で同じに読める。 */
  'メニュー':{icon:'⋮',note:'押した欄のすぐ横に浮くメニュー。数個を目を動かさず選ぶとき'},
  /* §9.248 ①（利用者の指示「フローティングモーダル…違うタイプのものを増やしたい」）。
     **一覧との違いを一言に書く**——どちらも窓が開くので、名前だけでは選べない。 */
  'パネル':{icon:'▦',note:'画面のまん中に大きな札を並べた窓。指で押す端末・説明を読んで選ぶとき'},
  '切替':{icon:'↻',note:'ボタン1つ。押すたびに次の選択肢へ進む（狭いマスで2〜4個）'},
  'メーター':{icon:'▬',note:'打つ欄はそのまま。上下限のどこに居るかを帯で示す'},
  '定型文':{icon:'✎',note:'1行入力＋よく使う語句のボタン（まとまりの値から作る）'},
  /* §9.233 ①（利用者の指示「自動で入る値についても、選んで設定できるように
     してください」）。値を入れるのは画面なので、選べるのは**見せ方だけ**
     ——押せる部品にすると、押しても何も起きない（§4）。 */
  '文字だけ':{icon:'⌁',note:'枠も地も持たず、値だけを置く（読むだけの値）'},
  '強調':{icon:'❖',note:'色つきの枠で目立たせる（見落とせない参考値）'},
  /* §9.288 ③（利用者の指示「選べるUIの種類をさらに増やしたい。今ないような
     新しさを感じる種類のものも欲しいし、複数選択になったときに探しやすいUIも
     欲しくて、パネルの派生や上位版みたいなものも」）。**それぞれ「他とどう
     違うか」を一言に書く**——名前だけでは、窓が開く形は全部同じに読める。 */
  '索引':{icon:'あ',note:'パネルの上位版。頭文字（あ/か/さ…A/0）で辿る窓。選択肢が数十〜数百のとき'},
  'ダイヤル':{icon:'⇕',note:'前後を見ながら回して選ぶ。順番のある十数個を狭いマスで（切替と違い次が見える）'},
  'サジェスト':{icon:'⌕',note:'打ちながら候補が垂れる。定型文と違い、語句が何個あっても場所を取らない'},
 };
 /* 並べ方の一言（§9.226 ①）。**「自動」が何になるかは形ごとに違う**ので、
    そこは触らずに「決めたときだけ」変わることを書く。 */
 const OP_LAYOUT_NOTE={
  '自動':'この選ばせ方の既定のまま（形ごとに違います）',
  '横1行':'折り返さず1行に押し込む（等分に縮みます）',
  '折り返し':'入るだけ横へ、入らなくなったら次の行へ',
  '縦':'1つずつ縦に積む（名前が長いとき）',
  '2列':'2列のマス目に並べる',
  '3列':'3列のマス目に並べる',
 };
 /* 意匠（§9.223 ③）。**軸は3つだけ**——色・形・大きさ。掛け算で種類を
    増やさないための分け方なので、ここへ4つ目の軸を足さないこと。 */
 /* 色の意味づけ（§9.287-G）。**色を足す前に意味を割り当てる**——名前だけの
    色が増えると、選ぶ側は毎回どれを使うか決め直すことになる（§9.286 ⑥）。
    言葉は行の色・未入力の配色（`WL.columnTint.PALETTE`）と**同じ語彙**。 */
 const OP_LOOK_NOTE={
  '既定':'いまの画面と同じ色（teal）','主色':'主色をはっきり出す',
  '青':'情報・設定','水':'確認・検査','藍':'分類・区分',
  '緑':'良い・完了','黄緑':'進行中','黄':'確認待ち',
  '橙':'注意・確認','茶':'資材・素材','赤':'危険・停止',
  '桃':'目印・個人','紫':'特別な扱い','灰':'ひかえめ',
 };
 /* ---------- 選択肢のまとまり名のサジェスト（§9.220 ④、利用者の指示） ----------
    「操業データの選択肢のまとまり名については他の入力を見て、同じものを
     設定することも多いです。入力の手間を省けるようにサジェスト機能を
     実装してください」

    材料はサーバーの`choiceHints`（{まとまり名:{items,groups,count}}）＝
    **誰がどの群でどれを使っているかという事実**だけ。**並べる規則はここ**
    ——勧める順は「いま編集している項目の名前・群」との近さで決まり、その
    2つは**まだ保存されていない画面の状態**なので、サーバーからは見えない
    （1文字打つたびに問い合わせるのは論外）。判定が2箇所に分かれるのでは
    なく、事実と並べ方の担当が分かれている。

    **理由を必ず添える**（§6「出どころ・根拠を画面に出す」）——「よく使われて
    います」と「同じ群が使っています」では、当たる見込みがまるで違う。 */
 function opLongestCommon(a,b){
  a=String(a||'');b=String(b||'');
  let best=0;
  for(let i=0;i<a.length;i++){
   for(let j=i+best+1;j<=a.length;j++){
    const t=a.slice(i,j);
    if(b.indexOf(t)>=0){if(t.length>best)best=t.length}else break;
   }
  }
  return best;
 }
 function opChoiceSuggest(x){
  const hints=opState.choiceHints||{};
  const cur=String((x&&x.choice)||'');
  const myGroup=String((x&&x.group)||'');
  const myName=String((x&&x.name)||'');
  const out=[];
  Object.keys(hints).forEach(name=>{
   if(!name||name===cur)return;
   const h=hints[name]||{};
   const items=h.items||[],groups=h.groups||[];
   let score=0,why='';
   if(myGroup&&groups.indexOf(myGroup)>=0){
    score=300;
    const mate=items.find(n=>n!==myName)||items[0]||'';
    why=`同じ群「${myGroup}」の「${mate}」が使っています`;
   }
   if(myName){
    /* 名前が似ている（「大径リング色」と「小径リング色」）。**2文字以上**を
       似ているとみなす——1文字だと「板」だけで当たり、勧める意味が消える。 */
    let bestN='',bestLen=0;
    items.forEach(n=>{
     if(n===myName)return;
     const l=opLongestCommon(myName,n);
     if(l>bestLen){bestLen=l;bestN=n}
    });
    if(bestLen>=2&&bestLen*100+150>score){
     score=bestLen*100+150;
     why=`「${bestN}」と名前が似ています`;
    }
   }
   if(!score){score=Math.min(99,Number(h.count)||items.length);
    why=`${items.length}件の項目が使っています`;}
   out.push({name,score,why,count:items.length});
  });
  out.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'ja'));
  return out.slice(0,4);
 }
 function opChoiceSuggestHtml(x){
  const list=opChoiceSuggest(x);
  if(!list.length)return '';
  const values=n=>(opState.choices||[]).filter(c=>c.name===n).map(c=>c.value);
  return `<span class="op-suggest"><b class="op-suggest-lead">よく使う組み合わせ</b>`
   +list.map(s=>{
     const vs=values(s.name);
     const peek=vs.length?`${vs.slice(0,4).join('／')}${vs.length>4?'…':''}`:'値が未登録';
     return `<button type="button" class="op-suggest-btn" data-op-suggest="${esc(s.name)}"`
      +` title="${esc(s.why)}／${esc(peek)}"><b>${esc(s.name)}</b>`
      +`<small>${esc(s.why)}</small><i>${esc(peek)}</i></button>`;
   }).join('')
   +`</span>`;
 }

 /* **その項目にどの入力方法が効くか**（§9.219 ③）。規則を画面に書かない
    ——`typeFamilies`／`builtinFamilies`／`widgetFamilies`はサーバーが答える
    対応表で、ここは引くだけ（§9.163「判定を画面にも書かないこと」）。
    型を切り替えた瞬間に効く物が変わるので、行が持つ`widgetFamily`では
    足りない（あれは保存済みの型に対する答え）。 */
 function opFamilyOf(x){
  const bf=opState.builtinFamilies||{},tf=opState.typeFamilies||{};
  /* 自動で入る値（§9.234 ②）は**型より先**。値を入れるのは画面なので、
     型を何にしても選ばせ方・初期値・手打ちは効かない
     （サーバーの`widget_family()`と同じ順番。2つの答えを作らない）。 */
  if(x&&x.autoValue)return 'output';
  if(x&&x.builtin)return bf[x.builtin]||'choice';
  return tf[(x&&x.type)||'']||'text';
 }
 /* 画面が値を入れる欄（§9.232）。母材の参考値3つ——元幅（実績）・
    屑幅（両耳合計）・計算全長（参考）——は`<output>`なので、選ばせ方も
    初期値も持たない。**判定は1箇所**（族はサーバーが答える）。 */
 function opIsOutput(x){return opFamilyOf(x)==='output'}
 /* 値がこの画面の外から入る欄か（§9.234 ⑦、利用者の指示「操業データ項目の
    項目カード自体に自動に入力されるものについては配色してほしいです」）。
    **判定はサーバーの`auto_fill_of()`**——ここは引くだけ（§9.163）。
    **`opIsOutput()`を消してこれに置き換えないこと**（§9.232。設定窓の
    「選ばせ方／初期値を出さない」は族の側で別に守らせてあり、1つにまとめると
    片方を壊しても もう片方が隠して網が空振りする）。 */
 function opAutoOf(x){return String((x&&x.autoFill)||'')}
 function opAutoFill(k){return (opState.autoFills||[]).find(a=>a.key===k)||null}
 function opAutoLabel(k){const a=opAutoFill(k);return a?a.label:''}
 function opAutoNote(k){const a=opAutoFill(k);return a?a.note:''}
 function opWidgetsFor(x){
  const fam=opState.widgetFamilies||{};
  return fam[opFamilyOf(x)]||['プルダウン'];
 }
 /* 「プルダウン」は保存値としてはどの型でも「標準の欄」の意味（§9.219 ③。
    型ごとに既定値を変えると、型を切り替えた瞬間に設定が消える）。
    **画面では型に合った呼び名で出す**——数値の欄に「プルダウン」と書いて
    あったら、何が起きるのか読めない。 */
 const OP_STD_LABEL={choice:'プルダウン',number:'そのまま打つ',text:'そのまま打つ',
                     /* §9.233 ①。自動で入る値の「標準」は今までの見え方
                        （白地に枠の1行）。既定を変えると、設定を触って
                        いない現場の画面が黙って変わる。 */
                     output:'枠つき（今までどおり）'};
 function opWidgetLabel(x,w){
  return w==='プルダウン'?(OP_STD_LABEL[opFamilyOf(x)]||'プルダウン'):w;
 }
 function opItemById(id){return opState.items.find(x=>String(x.id)===String(id))||null}
 /* 置き場ごとの並び。**群は「直前の見出し」で決まる**ので、ここで帯と
    項目を1本の列に混ぜて作る（画面もこの列をそのまま描く）。

    **同じ群がばらけていたら、まとめてから描く**（§9.219 ③）。以前は
    「表示順の並びで群が変わったら帯を1本立てる」だけだったため、保存された
    表示順が入り混じると**同じ群の帯が3本立ち、1本に1項目**という形になった
    （実機の`db/master.sqlite3`が実際にそうなっていた。原因は
    `item_layout_save`が渡された行だけを先頭へ振り直していたこと——そちらも
    直した）。帯が割れると「その群へ入れる」場所が読めなくなり、利用者からは
    **「誰が測るか／測定表の形へ移動できない」**として見える。
    ここは`measure-opdata.js`の`groupsFor()`と同じく**名前でまとめる**
    （測定画面は前から名前でまとめており、マスタの盤だけが割れていた）。
    まとめ直したことは画面に出す——黙って直すと、保存されている形と
    見えている形が食い違ったままになる。 */
 function opRows(place){
  const items=opState.items.filter(x=>(x.place||'準備')===place)
    .sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));
  const order=[],bag=new Map();
  let split=false,prev=null;
  items.forEach(x=>{
   const g=x.group||'その他';
   if(prev!==null&&g!==prev&&bag.has(g))split=true;
   prev=g;
   if(!bag.has(g)){bag.set(g,[]);order.push(g)}
   bag.get(g).push(x);
  });
  if(split)opState.healed.add(place);else opState.healed.delete(place);
  const rows=[];
  order.forEach(g=>{
   const list=bag.get(g);
   /* 群のふるまいは**1つでも「畳む」と言っていれば畳む**（`groupsFor()`と
      同じ読み方。群の中で食い違ったときにどちらが正かを決めておく）。 */
   const when=(list.find(x=>(x.showWhen||[]).length)||{}).showWhen||[];
   /* 群の幅（§9.226 ③）。**1つでも指定があればそれ**——畳むと同じ読み方。 */
   const gspan=Number((list.find(x=>Number(x.groupSpan)>0)||{}).groupSpan)||0;
   /* 空き（ダミー）は**カード1枚の属性**（§9.228 ②）。帯を「空きだけ」と
      して出すのは**全部が空きのとき**だけ——1枚でも中身があるなら見出しが要る。 */
   const dummy=list.length>0&&list.every(x=>!!x.dummy);
   rows.push({type:'group',name:g,place,fold:list.some(x=>!!x.fold),showWhen:when,
              span:gspan,dummy,items:list});
   list.forEach(x=>rows.push({type:'item',x}));
  });
  return rows;
 }
 function opSpanOf(x){return Math.max(1,Math.min(opState.gridCols,Number(x.span)||4))}
 /* マスの数を**人の言葉**にする（§9.218 ②）。現場は6マス時代の「2列」で
    言い慣れているので、マスだけを出すと全部が倍になったように読める。 */
 function opSpanLabel(v){
  const u=opState.spanUnit||2;
  const col=v/u;
  return (Number.isInteger(col)?`${col}列`:`${col}列`)+`（${v}/${opState.gridCols}マス）`;
 }
 function opWidgetOf(x){
  const w=String(x.widget||'プルダウン');
  return opWidgetsFor(x).includes(w)?w:'プルダウン';
 }
 /* 選べる形が1つしかない型では、押しても何も変わらない（§4）。
    §9.219 ③で数値・自由記述にも道具が付いたので、いまはどの型でも2つ以上
    ある——それでも判定はここ1箇所に残す（型が増えたときに効く）。 */
 function opWidgetUsable(x){
  return opWidgetsFor(x).length>1;
 }
 function opTileHtml(x,spot){
  const span=opSpanOf(x);
  const off=x.enabled===false;
  /* ダミー（空き）の群の中身（§9.227 ③）。**隠さずに、出ないと書く**
     ——盤から消すと「消えた」と読まれるし、ふつうの群へ戻したときに
     何が入っていたのか分からなくなる（§4）。 */
  const pad=!!x.dummy;
  const w=opWidgetOf(x);
  /* 値がこの画面の外から入る欄（§9.234 ⑦）。**面の色と文字の両方**で言う
     （§CLAUDE 3 状態は色だけで伝えない）。 */
  const auto=opAutoOf(x);
  const tip=[x.name,x.builtin?'画面がもともと持っている入力欄':x.type,
             /* §9.234 ②。**出どころを画面に出す**（§CLAUDE 6）——同じ
                「製造板厚」でも、仕掛から写した値と手で打った値では
                当たる見込みも直す場所も違う。 */
             x.autoValue?`自動で入る値: ${x.autoValueLabel||x.autoValue}`
                        +(x.autoValueKnown===false?'（この版では引けません）':''):'',
             auto?opAutoNote(auto):'',
             opSpanLabel(span),x.required?'必須':'',off?'出さない':'',
             w!=='プルダウン'?opWidgetLabel(x,w):'',
             /* §9.220 ②③。**盤の上で分かること**を増やす（開かないと
                分からない設定は、設定したこと自体を忘れる）。 */
             x.initial?`初期値 ${x.initial}`:'',
             /* §9.239 ②。**このカードの置き場がどこ由来か**を言う——
                共通を直したつもりが1設備にしか効いていない、を作らない。 */
             opState.equipment?(x.layoutFrom===opState.equipment
               ?`置き場・並び・幅は「${opState.equipment}」だけの設定`
               :'置き場・並び・幅は共通の設定（この設備で動かすとこの設備だけに効きます）'):'',
             x.freeText?'手打ち可':''].filter(Boolean).join('｜');
  /* 空きのカード（§9.228 ②）は**盤でも中身を持たない**——名前も型も出さない。
     測定画面では何も描かないので、盤で名前だけが目立つと「出るもの」に見える。
     幅と、空きであることだけを言う。 */
  if(pad){
   return `<div class="op-tile is-pad${String(opState.picked)===String(x.id)?' is-picked':''}"`
    +` draggable="true" data-op-id="${esc(x.id)}"`
    +` style="${spot?`grid-column:${spot.col}/span ${spot.span};grid-row:${spot.row}`
                  :`grid-column:span ${span}`}"`
    +` title="空き（測定画面では何も描かず、この幅ぶんの余白になります）｜${esc(opSpanLabel(span))}"`
    +` tabindex="0"><span class="op-tile-pad">空き</span>`
    +`<span class="op-tile-span">${span}/${opState.gridCols}</span></div>`;
  }
  return `<div class="op-tile${String(opState.picked)===String(x.id)?' is-picked':''}`
   +`${off?' is-off':''}" draggable="true" data-op-id="${esc(x.id)}"`
   /* **classを増やさず属性1つ**（§9.234 ⑦）——鍵はサーバーの綴り
      （`computed`/`preset`）なので、CSSも網もこの1つの印を見れば足りる。 */
   +(auto?` data-op-auto="${esc(auto)}"`:'')
   /* レイアウトの出どころ（§9.239 ②）。**属性1つ**で表す（`.op-tile`の
      classを増やさない。§9.234 ⑦と同じ作法）。 */
   +(opState.equipment?` data-op-scope="${x.layoutFrom===opState.equipment?'one':'common'}"`:'')
   +` style="${spot?`grid-column:${spot.col}/span ${spot.span};grid-row:${spot.row}`
                 :`grid-column:span ${span}`}" title="${esc(tip)}" tabindex="0">`
   +`<span class="op-tile-name">${esc(x.name)}</span>`
   +`<span class="op-tile-meta">`
   /* **出どころのチップは1つの枠のまま3値**（自動／仕掛から／画面の欄）。
      自動の欄は必ず組み込みの欄なので、両方並べると同じことを2度言ううえ
      （§CLAUDE 8）、`.op-tile-meta`は`flex-wrap:wrap`なので3マス幅のカードで
      2行になり、盤の高さが動く（§9.234 ⑦）。 */
   +(auto?`<b class="op-chip op-chip-auto">${esc(opAutoLabel(auto))}</b>`
        :(x.builtin?'<b class="op-chip op-chip-builtin">画面の欄</b>':''))
   +(x.required?'<b class="op-chip op-chip-req">必須</b>':'')
   +(off?'<b class="op-chip op-chip-off">出さない</b>':'')
   +(w!=='プルダウン'?`<b class="op-chip op-chip-widget">${esc((OP_WIDGET_NOTE[w]||{}).icon||'')} ${esc(opWidgetLabel(x,w))}</b>`:'')
   +(x.initial?`<b class="op-chip op-chip-initial">初期 ${esc(x.initial)}</b>`:'')
   +(x.freeText?'<b class="op-chip op-chip-free">手打ち可</b>':'')
   /* **色だけで伝えない**（§3）——この設備だけの置き場かどうかは文字で言う。 */
   +(opState.equipment&&x.layoutFrom===opState.equipment
       ?`<b class="op-chip op-chip-scope">この設備だけ</b>`:'')
   /* 自動で入る値は**どの値なのか**を出す（§9.234 ②）——型（`文字`）は
      値を画面が入れる以上、読む側の打つ手を1つも変えない（§CLAUDE 6）。
      **引けない鍵はそう書く**（§4）。 */
   +`<span class="op-tile-type">${esc(x.autoValue
        ?((x.autoValueLabel||x.autoValue)+(x.autoValueKnown===false?'（引けません）':''))
        :(x.builtin?'—':x.type||''))}</span>`
   +`<span class="op-tile-span">${span}/${opState.gridCols}</span></span>`
   +`<span class="op-tile-gear" aria-hidden="true">設定</span></div>`;
 }
 /* 群の幅の選択肢（§9.226 ③）。**粗く4段だけ**——細かくすると左端の
    候補が増えてそろって見えなくなる（§CLAUDE 13と同じ理由）。 */
 const OP_GROUP_SPANS=[{v:0,label:'全幅'},{v:8,label:'2/3'},{v:6,label:'1/2'},{v:4,label:'1/3'}];
 function opGroupSpanLabel(v){
  const hit=OP_GROUP_SPANS.find(x=>x.v===Number(v||0));
  return hit?hit.label:`${v}/${opState.gridCols}マス`;
 }
 /* 群の幅のボタン（ダミーでも使うので切り出す）。 */
 function opBandSpanHtml(r,cur){
  return `<span class="op-band-span" role="group" aria-label="群の幅">`
   +OP_GROUP_SPANS.map(o=>`<button type="button" data-op-gspan="${o.v}"`
     +` data-op-band2="${esc(r.name)}" data-op-place="${esc(r.place)}"`
     +` class="${cur===o.v?'is-on':''}" title="この群の幅を${esc(o.label)}にします`
     +`${o.v?'（横いっぱいでない群は横に並びます）':'（今までどおり1段を丸ごと使います）'}">`
     +`${esc(o.label)}</button>`).join('')
   +`</span>`;
 }
 function opBandHtml(r,count,spot){
  const cond=(r.showWhen||[]).length?`／開く条件: ${esc((r.showWhen||[]).join('、'))}`:'';
  const place=spot?`grid-column:${spot.col}/span ${spot.span};grid-row:${spot.row}`:'grid-column:1/-1';
  const cur=Number(r.span)||0;
  /* ---------- ダミー（空き）の群（§9.227 ③、利用者の指示） ----------
     「マスタでまとまりをダミーで作って何も枠もない空間をつくれるように
      してください。(区切りの良い並びに整列させるためのダミーカード)」
     盤では**斜線の空き枠**として出す（測定画面では何も描かないので、
     盤でも同じに描くと「消えた」と読まれる——`§9.222 ③`の空きマスと
     同じ見せ方にそろえてある）。**要らない道具は出さない**（§4）ので、
     畳む・開く条件は持たない（中身が無いので効かない）。 */
  if(r.dummy){
   return `<div class="op-band is-dummy" draggable="true" data-op-band="${esc(r.name)}"`
    +` data-op-place="${esc(r.place)}" style="${place}"`
    +` title="測定画面では見出しも枠も出さず、この幅ぶんの空白になります">`
    +`<b class="op-band-name">${esc(r.name)}</b>`
    +`<small class="op-band-note">空きだけの群`
    +`${cur?`／幅 ${esc(opGroupSpanLabel(cur))}`:'／幅 全幅'}`
    +`／測定画面では<b>見出しも出しません</b></small>`
    +`<span class="op-band-tools" draggable="false">`
    +opBandSpanHtml(r,cur)
    +`<button type="button" class="ghost" data-op-rename="${esc(r.name)}" data-op-place="${esc(r.place)}">名前</button>`
    +`</span></div>`;
  }
  /* **帯を掴むと群ごと動く**（§9.230 ④、利用者の指示「郡単位で移動できる
     ようにしたいです」）。道具（幅・名前・畳む）からは掴ませない
     ——押そうとしたら群が動く、では押せない。 */
  return `<div class="op-band" draggable="true" data-op-band="${esc(r.name)}" data-op-place="${esc(r.place)}"`
   +` style="${place}" title="この帯より下の項目が「${esc(r.name)}」になります（帯を掴むと群ごと動きます）">`
   +`<b class="op-band-name">${esc(r.name)}</b>`
   +`<small class="op-band-note">${count}項目${r.fold?'／畳む':''}`
   +`${cur?`／幅 ${esc(opGroupSpanLabel(cur))}`:''}${cond}</small>`
   +`<span class="op-band-tools" draggable="false">`
   /* **列でも区切れる**（§9.226 ③、利用者の指示）。全幅でない群は横に
      並ぶので、「誰が測るか」と「使う機材」を左右に置ける。 */
   +opBandSpanHtml(r,cur)
   +`<button type="button" class="ghost" data-op-rename="${esc(r.name)}" data-op-place="${esc(r.place)}">名前</button>`
   +`<button type="button" class="ghost" data-op-fold="${esc(r.name)}" data-op-place="${esc(r.place)}"`
   +` aria-pressed="${r.fold?'true':'false'}">${r.fold?'畳む':'開いたまま'}</button>`
   +`</span></div>`;
 }
 function opBoardHtml(place){
  const rows=opRows(place);
  const counts={};
  rows.forEach(r=>{if(r.type==='item'){const g=r.x.group||'その他';counts[g]=(counts[g]||0)+1}});
  /* **測定画面と同じ関数で割り付ける**（§9.226 ③）。盤だけ別に計算すると、
     「盤ではこう見えるのに測定画面では違う」が作れる。 */
  const groups=rows.filter(r=>r.type==='group');
  const pack=(window.WL&&WL.opData&&WL.opData.packLayout)
    ? WL.opData.packLayout(groups.map(g=>({name:g.name,span:g.span,
        items:(g.items||[]).map(x=>({key:x.id,span:opSpanOf(x)}))})),opState.gridCols)
    : {heads:[],items:[],banded:false};
  const headAt=new Map(pack.heads.map(h=>[h.name,h]));
  const cellAt=new Map(pack.items.map(x=>[String(x.key),x]));
  const body=rows.map(r=>r.type==='group'
    ?opBandHtml(r,counts[r.name]||0,pack.banded?headAt.get(r.name):null)
    :opTileHtml(r.x,pack.banded?cellAt.get(String(r.x.id)):null)).join('')
   ||'<p class="mm-empty-inline" style="grid-column:1/-1">この置き場の項目はまだありません。「項目を追加」で作るか、もう一方の置き場から掴んで持ってきます。</p>';
  const n=rows.filter(r=>r.type==='item').length;
  /* **マスの目盛を出す**（§9.218 ②）。掴んで並べる画面なのに、いま何マス
     使っているのかが読めないと「1つ増やせるか」が分からない。 */
  const ruler=Array.from({length:opState.gridCols},(_,i)=>
    `<i class="op-ruler-cell">${i+1}</i>`).join('');
  return `<section class="op-board" data-op-place="${esc(place)}">`
   +`<div class="op-board-head"><b>${esc(place)}</b>`
   +`<small>${esc(OP_PLACE_NOTE[place]||'')}</small>`
   +`<span class="op-board-count">${n}項目</span></div>`
   +`<div class="op-ruler" style="--op-cols:${opState.gridCols}">${ruler}</div>`
   +`<div class="op-board-grid" data-op-place="${esc(place)}"`
   +` style="--op-cols:${opState.gridCols}">${body}</div></section>`;
 }
 /* ---------- 構成チェック（§9.223 ①、利用者の指示） ----------
    「データの設計上必須な部分は、全体の構成上の必須項目として押さえておき、
     各カード単位では自由度を持っておきたいです。」

    必須をカードから外したぶん、**全体として満たされているかは全体の場所で
    言う**。ここが無いと「必須を外せる」だけになり、足りないことに測定画面を
    開くまで気づけない（§2「探させない」）。
    **判定はサーバー**（`role_report`）——画面で数え直すと2つの答えが出る。
    **足りない・二重のときだけ赤く言い、満たされているときは静かに数える**
    （いつも赤いと読まれなくなる）。 */
 /* 色の意味と件数を**文字で**言う（§CLAUDE 3／§9.105「色だけで意味を伝えない。
    分類名と件数を必ず文字で出す」）。**1つも無い場面では行ごと消す**
    （§4／§9.199）。件数を出すのは**ここだけ**——盤の頭にも出すと同じ数字が
    2箇所になる（§CLAUDE 8）。 */
 function opAutoLegendHtml(){
  const kinds=(opState.autoFills||[]).map(a=>Object.assign({},a,
    {n:(opState.items||[]).filter(x=>opAutoOf(x)===a.key).length})).filter(a=>a.n);
  if(!kinds.length)return '';
  return `<p class="op-auto-legend"><span>地に色の付いたカードは、値が<b>この画面の外から</b>入ります</span>`
   +kinds.map(a=>`<b class="op-chip op-chip-auto" data-op-auto="${esc(a.key)}">${esc(a.label)} ${a.n}件</b>`
     +`<small>${esc(a.note)}</small>`).join('')
   +`<small>マスタで決めた<b>初期値</b>はここに数えません（カードの「初期 …」の印が持ちます）。</small></p>`;
 }
 function opRoleStripHtml(){
  const rep=opState.roleReport;
  if(!rep)return '';
  const roles=rep.roles||[];
  const need=roles.filter(r=>r.required);
  const okNeed=need.filter(r=>r.state==='ok').length;
  const miss=roles.filter(r=>r.required&&r.state==='none');
  const dup=roles.filter(r=>r.state==='dup');
  const filled=roles.filter(r=>r.state==='ok').length;
  const chip=(cls,txt,tip)=>`<b class="op-role-stat ${cls}"${tip?` title="${esc(tip)}"`:''}>${txt}</b>`;
  /* **譲って下がった組み込みの欄は名指しで言う**（§9.223 ①）。窓には
     「役割を別の項目へ移すと、この欄は自動で下がります」と書いてあるので、
     下がったことを黙っていると「消えた」と読まれる。 */
  const down=(rep.steppedDown||[]);
  const downLine=down.length
   ?`<span class="op-role-line is-info"><b>役割を譲って下がった欄</b>`
     +down.map(h=>`<i>${esc(h.name||h.builtin||'')}</i>`).join('')
     +`<small>同じ役割の項目を作ったので、画面がもともと持っているこの欄は`
     +`測定画面に出しません（役割を外せば戻ります）。</small></span>`
   :'';
  const body=(miss.length||dup.length)
   ?`<span class="op-role-fix">`+downLine
     +(miss.length?`<span class="op-role-line"><b>足りない役割</b>`
       +miss.map(r=>`<i>${esc(r.label)}</i>`).join('')
       +`<small>この役割を担う項目がありません。どれか1つの項目の②タブで「役割」に選んでください。</small></span>`:'')
     +(dup.length?`<span class="op-role-line"><b>二重の役割</b>`
       +dup.map(r=>`<i>${esc(r.label)}（${r.holders.map(h=>esc(h.name)).join('・')}）</i>`).join('')
       +`<small>どちらの値が使われるか決まりません。片方の役割を外してください。</small></span>`:'')
     +`</span>`
   :`<span class="op-role-fix"><span class="op-role-ok">`
     +`必要な役割は${need.length}件すべて埋まっています`
     +`（役割の付いた項目 ${filled}件）。カードの作りは全部同じなので、`
     +`名前・型・選ばせ方は項目ごとに自由に決められます。</span>${downLine}</span>`;
  return `<section class="op-role-strip${(miss.length||dup.length)?' is-bad':''}">`
   +`<h4 class="op-role-head">構成チェック`
   +chip(miss.length?'is-bad':'is-ok',`必須 ${okNeed}/${need.length}`,
         '必須の役割が担われているか。担うのはどの項目でもかまいません')
   +(dup.length?chip('is-bad',`二重 ${dup.length}`,'同じ役割を2つの項目が持っています'):'')
   +`<button type="button" class="ghost op-role-more" id="opRoleMore" aria-expanded="false">役割の一覧</button>`
   +`</h4>${body}`
   +`<div class="op-role-list" id="opRoleList" hidden>`
   +roles.map(r=>`<span class="op-role-item is-${esc(r.state)}">`
     +`<b>${esc(r.label)}</b>${r.required?'<i class="op-role-req">必須</i>':''}`
     +`<span class="op-role-who">${r.holders.length?r.holders.map(h=>esc(h.name)).join('・'):'—'}`
     +((r.steppedDown||[]).length
       ?`<i class="op-role-down">${esc((r.steppedDown||[]).map(h=>h.name||h.builtin).join('・'))}は下がりました</i>`
       :'')+`</span>`
     +`<small>${esc(r.note)}</small></span>`).join('')
   +`</div></section>`;
 }
 function renderOpItem(){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  const eqs=(equipmentMasterState.items||[]).map(e=>e.name).filter(Boolean);
  form.innerHTML=`<div class="op-bar">`
   +`<label class="op-bar-eq" title="どの設備のレイアウトを編集するかです。`
   +`「共通」で並べ替えるとすべての設備に効き、設備を選んで並べ替えるとその設備だけに効きます。">`
   +`レイアウトの対象<select id="opEqPick">`
   +`<option value="">共通（すべての設備）</option>`
   +eqs.map(n=>`<option value="${esc(n)}"${opState.equipment===n?' selected':''}>${esc(n)}</option>`).join('')
   +`</select></label>`
   /* **いま何を触っているかを文字で出す**（§9.239 ②・§CLAUDE 6）。
      黙って設備ごとに分かれると、共通を直したつもりが1設備にしか
      効いていない（あるいはその逆）ことに気づけない。 */
   +`<span class="op-bar-scope${opState.equipment?' is-one':''}">`
   +(opState.equipment
     ?`<b>${esc(opState.equipment)}だけ</b>のレイアウトを編集しています`
      +`<i>（置き場・群・並び・幅・畳みはこの設備だけに効きます。名前・型・選択肢・単位・意匠は共通です）</i>`
     :`<b>共通</b>のレイアウトを編集しています<i>（設備ごとに変えたいときは上で設備を選んでください）</i>`)
   +`</span>`
   +`<span class="op-bar-note">掴んで動かすと<b>並び</b>が決まり、<b>帯より下</b>がその群になります。`
   +`置き場をまたげば「準備」と「入力内容」も入れ替わります。押すと<b>設定の窓</b>が開きます。</span>`
   +`<button type="button" id="opAddItem" class="ghost">項目を追加</button>`
   +`<button type="button" id="opAddGroup" class="ghost">群を追加</button>`
   /* **空き（ダミー）の群**（§9.227 ③、利用者の指示）。並びを区切りの
      良いところで折り返すための、何も出さない場所。 */
   +`<button type="button" id="opAddPad" class="ghost"`
   +` title="測定画面で何も描かない「空き」のカードを1枚足します（区切りの良い並びに整列させるため）">空きカードを追加</button>`
   /* **自動で入る値・計算値**（§9.234 ②、利用者の指示）。人が打たない値も
      1枚のカードとして置けるようにする。一覧はサーバーが答える。 */
   +`<button type="button" id="opAddAuto" class="ghost"`
   +` title="ロット番号・製造板厚・実働時間など、画面が自動で入れる値を1枚のカードとして足します">自動で入る値を足す</button>`
   +`<span class="op-bar-state" id="opLayoutState"></span></div>`;
  /* **まとめ直したことを画面に書く**（§9.219 ③）。保存されている並びでは
     同じ群がばらけていたが、盤ではまとめて描いている——黙って直すと、
     保存されている形と見えている形が食い違ったままになる。 */
  /* **盤を先に組み立ててから案内を作る。** `opRows()`が`opState.healed`を
     埋めるので、先に読むと初回だけ案内が出ない（実際にそうなった）。 */
  const boards=opState.places.map(opBoardHtml).join('');
  const healed=[...opState.healed];
  list.innerHTML=`<div class="op-edit">`
   +opRoleStripHtml()
   +opAutoLegendHtml()
   +(healed.length?`<p class="op-healed">同じ群がばらばらの位置に保存されていたので、`
     +`<b>${esc(healed.join('・'))}</b>の盤ではまとめて出しています`
     +`（この盤で一度でも掴んで動かすと、その形で保存されます）。</p>`:'')
   +`<div class="op-boards">`+boards+`</div></div>`;
  bindOpItem();
  /* 役割の一覧は**畳んでおく**（§9.223 ②の作法）——14件を常に出すと盤が
     押し下げられる。足りない・二重のときだけ、上の1行が理由を言う。 */
  const more=$('#opRoleMore'),rlist=$('#opRoleList');
  if(more&&rlist)more.onclick=()=>{
   rlist.hidden=!rlist.hidden;
   more.setAttribute('aria-expanded',rlist.hidden?'false':'true');
  };
  if(opState.picked&&!$('#opItemModal'))renderOpModal();
 }
 function opSay(text,bad){
  const el=$('#opLayoutState');if(!el)return;
  el.textContent=text||'';el.classList.toggle('is-bad',!!bad);
 }
 /* 画面に出ている順をそのままマスタへ書く。**帯より下がその群**なので、
    並びと群を1回の保存で決められる（§9.216 ④）。 */
 function opCollectLayout(){
  const rows=[];
  document.querySelectorAll('#masterMaintList .op-board-grid').forEach(grid=>{
   const place=grid.dataset.opPlace||'準備';
   let group='その他',fold=false,showWhen=[];
   [...grid.children].forEach(el=>{
    if(el.dataset.opMark!==undefined)return;      /* 落とす場所の印は行ではない */
    if(el.dataset.opBand!==undefined){
     group=el.dataset.opBand;
     const btn=el.querySelector('[data-op-fold]');
     fold=btn?btn.getAttribute('aria-pressed')==='true':false;
     const g=opState.items.find(x=>(x.group||'その他')===group&&(x.place||'準備')===place);
     showWhen=g?(g.showWhen||[]):[];
     return;
    }
    const x=opItemById(el.dataset.opId);
    if(!x)return;
    rows.push({id:x.id,group,place,span:opSpanOf(x),required:!!x.required,
               enabled:x.enabled!==false,fold,showWhen});
   });
  });
  return rows;
 }
 async function opSaveLayout(){
  if(opState.busy)return;
  const rows=opCollectLayout();
  if(!rows.length)return;
  const uid=requireMaintUser();if(uid===null)return;
  opState.busy=true;opSay('保存しています…');
  try{
   await api('/api/operation-item-master/layout',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({items:rows,user_id:uid,
       /* **どの設備のレイアウトか**（§9.239 ②）。空＝共通で、今までどおり
          行そのものを書き換える。設備を選んでいれば上書きへ入る。 */
       equipment:opState.equipment||''})});
   /* 覚えを捨てて取り直す——保存の結果（表示順の振り直し）を画面へ戻す。 */
   await loadOpItemMaint(true);
   opSay('保存しました');
   if(window.WL&&WL.opData)WL.opData.forget();
  }catch(e){opSay('保存できませんでした: '+e.message,true)}
  finally{opState.busy=false}
 }
 function bindOpItem(){
  /* **描き直したら閉じる**（§9.222 ①）——控えの持ち主が切り離された古い
     要素になると、押して閉じて即開き直すちらつきになる。 */
  closeOpMenu();
  const pick=$('#opEqPick');
  if(pick)pick.onchange=()=>{opState.equipment=pick.value;loadOpItemMaint(true)};
  const add=$('#opAddItem');
  if(add)add.onclick=()=>opCreateItem();
  const addG=$('#opAddGroup');
  if(addG)addG.onclick=()=>opCreateGroup();
  const addP=$('#opAddPad');
  if(addP)addP.onclick=()=>opCreatePad();
  const addA=$('#opAddAuto');
  if(addA)addA.onclick=e=>opOpenAutoMenu(e);
  document.querySelectorAll('#masterMaintList .op-tile').forEach(t=>{
   /* **押したら設定の窓が開く**（§9.218 ①、利用者の指摘「メニューが右側で
      固定され、設定しにくい」）。以前は右の細い柱に押し込んでいたため、
      幅・型・選択肢を触るたびに視線が盤と柱を往復していた。 */
   /* **右クリックでメニュー**（§9.228 ⑤）。掴んで並べ替える盤なので、
      よく使う操作（幅・出す/出さない・空き・削除）はここから直接。 */
   t.oncontextmenu=e=>{
    const x=opItemById(t.dataset.opId);
    if(!x)return;
    opState.picked=x.id;renderOpItem();
    opOpenTileMenu(e,x);
   };
   t.onclick=()=>{
    opState.picked=t.dataset.opId;renderOpItem();
    /* **空きのカードも同じ窓を開く**（§9.230 ③、利用者の指摘「空きの
       カードを追加しても、ダブルクリックで編集がでないので、右クリックの
       メニューが最終手段となっており、通常の方法では幅変更や削除など
       できない」）。決めることは少ないので**要る列だけ出す**
       （`opSecsFor()`）——押しても何も無い窓を開かないための元の判断は、
       列を絞ることで満たす。 */
    openOpModal(t.dataset.opId);
   };
   t.onkeydown=e=>{
    if(e.key!=='Enter'&&e.key!==' ')return;
    e.preventDefault();opState.picked=t.dataset.opId;renderOpItem();
    openOpModal(t.dataset.opId);
   };
   t.ondragstart=e=>{
    opState.drag=t.dataset.opId;t.classList.add('is-dragging');
    try{e.dataTransfer.setData('text/plain',t.dataset.opId);e.dataTransfer.effectAllowed='move'}catch(_){}
   };
   t.ondragend=()=>{opState.drag=null;t.classList.remove('is-dragging');opClearMark()};
  });
  /* 帯（群）を掴む（§9.230 ④）。**カードの掴みとは別の控え**にする
     ——1つにまとめると「いま何を運んでいるか」が読めなくなる。 */
  document.querySelectorAll('#masterMaintList .op-band').forEach(bd=>{
   bd.ondragstart=e=>{
    opState.drag=null;
    opState.dragGroup={place:bd.dataset.opPlace,name:bd.dataset.opBand};
    bd.classList.add('is-dragging');
    try{e.dataTransfer.setData('text/plain','group:'+bd.dataset.opBand);
        e.dataTransfer.effectAllowed='move'}catch(_){}
   };
   bd.ondragend=()=>{opState.dragGroup=null;bd.classList.remove('is-dragging');opClearMark()};
  });
  document.querySelectorAll('#masterMaintList .op-board-grid').forEach(grid=>{
   grid.ondragover=e=>{
    if(!opState.drag&&!opState.dragGroup)return;
    e.preventDefault();
    opMark(grid,opState.dragGroup?opGroupDropAt(grid,e):opDropAt(grid,e));
   };
   grid.ondragleave=e=>{
    if(!opState.drag&&!opState.dragGroup)return;
    if(grid.contains(e.relatedTarget))return;
    opClearMark();
   };
   grid.ondrop=e=>{
    if(!opState.drag&&!opState.dragGroup)return;
    e.preventDefault();
    if(opState.dragGroup){
     /* 群ごと。**帯とその下の札をまとめて**挿す（順番は塊のまま）。 */
     const src=[...document.querySelectorAll('#masterMaintList .op-band')]
       .find(b=>b.dataset.opBand===opState.dragGroup.name
              &&b.dataset.opPlace===opState.dragGroup.place);
     const at=opGroupDropAt(grid,e);
     if(src){
      const block=opGroupBlock(src.parentElement,src);
      /* 自分の塊の中へは落とさない（動かないのに保存だけ走る）。 */
      if(block.indexOf(at)<0){
       block.forEach(el=>{at?grid.insertBefore(el,at):grid.appendChild(el)});
       opClearMark();opSaveLayout();return;
      }
     }
     opClearMark();return;
    }
    const at=opDropAt(grid,e);
    const el=document.querySelector(`#masterMaintList .op-tile[data-op-id="${CSS.escape(opState.drag)}"]`);
    if(el){at?grid.insertBefore(el,at):grid.appendChild(el)}
    opClearMark();
    opSaveLayout();
   };
  });
  document.querySelectorAll('#masterMaintList [data-op-rename]').forEach(b=>{
   b.onclick=async e=>{
    e.stopPropagation();
    const now=b.dataset.opRename,place=b.dataset.opPlace;
    const next=prompt('群の名前',now);
    if(next===null)return;
    const name=String(next).trim();
    if(!name||name===now)return;
    await opRenameGroup(place,now,name);
   };
  });
  /* 群の幅（§9.226 ③）。**群の全部の行へ同じ値**を書く（畳むと同じ作法）
     ——1行だけ直すと、`form_for_equipment`が「1つでもあればそれ」で読むので
     消したはずの幅が残る。 */
  document.querySelectorAll('#masterMaintList [data-op-gspan]').forEach(b=>{
   b.onclick=async e=>{
    e.stopPropagation();
    const uid=requireMaintUser();if(uid===null)return;
    const place=b.dataset.opPlace,group=b.dataset.opBand2;
    const g=opState.items.find(x=>(x.place||'準備')===place&&(x.group||'その他')===group);
    try{
     await api('/api/operation-item-master/group',{method:'POST',
       headers:{'Content-Type':'application/json'},
       body:JSON.stringify({place,group,fold:!!(g&&g.fold),
         showWhen:g?(g.showWhen||[]):[],groupSpan:Number(b.dataset.opGspan)||0,user_id:uid,
         equipment:opState.equipment||''})});
     await loadOpItemMaint(true);
     if(window.WL&&WL.opData)WL.opData.forget();
     opSay(Number(b.dataset.opGspan)?`「${group}」の幅を${opGroupSpanLabel(b.dataset.opGspan)}にしました（横に並びます）`
       :`「${group}」を全幅に戻しました`);
    }catch(err){opSay('保存できませんでした: '+err.message,true)}
   };
  });
  document.querySelectorAll('#masterMaintList [data-op-fold]').forEach(b=>{
   b.onclick=async e=>{
    e.stopPropagation();
    const uid=requireMaintUser();if(uid===null)return;
    const on=b.getAttribute('aria-pressed')==='true';
    const place=b.dataset.opPlace,group=b.dataset.opFold;
    const g=opState.items.find(x=>(x.place||'準備')===place&&(x.group||'その他')===group);
    try{
     await opSyncGroupFlags(place,group,g?(g.showWhen||[]):[],!on,uid);
     await loadOpItemMaint(true);
     opSay(on?'この群は開いたままにしました':'この群は畳んで出します');
     if(window.WL&&WL.opData)WL.opData.forget();
    }catch(err){opSay('保存できませんでした: '+err.message,true)}
   };
  });
 }
 /* 落とす場所は**まず段（行）を決め、その段の中でいちばん近い境目**
    （§9.219 ③、利用者の報告「『誰が測るか』と『測定表の形』には項目を
    移動できません」）。

    以前は盤の全部の子から`hypot(x-左端, y-中心)`がいちばん小さいものを
    選んでいた。**帯は`grid-column:1/-1`で横いっぱい**（実測1390px）なので、
    帯の右のほうへ運ぶと「帯の左端まで1300px」より「別の段のタイルの左端まで
    450px」のほうが近くなり、**まったく違う群へ飛んだ**（実測: 誰が測るかの
    帯の右へ落とすと「いつもと同じ設定」の直前＝使う機材の末尾に入った）。
    帯の左へ落とせば`insertBefore(帯)`＝**ひとつ上の群**、いちばん上の帯なら
    「その他」が新しくできる。つまり**帯の上のどこへ落としても、その群には
    入らなかった**——これが「移動できません」の正体。

    直し方は2つ:
      ① 段で絞る。同じ段の中だけで左右の境目を決めるので、横いっぱいの帯が
         別の段の判定を食わない。
      ② **帯へ落とす＝その群の先頭へ入れる**（帯の直後）。群の見出しを狙う
         のは「この群へ入れたい」という意味なので、素直にそう扱う。
         群の末尾へ入れたいときは、その群の最後のタイルの右へ落とす
         （こちらは①の境目の判定でそのまま出る）。

    **落とす場所の印そのものを候補に入れないこと**（§9.218 ④）。`opMark()`は
    印を盤の子として置くので、入れると印が1つずつ先へ歩く。掴んでいるタイルも
    同じ理由で外す（自分の前後は位置が変わらない）。 */
 function opDropAt(grid,e){
  const drag=grid.querySelector('.op-tile.is-dragging')
    ||document.querySelector('#masterMaintList .op-tile.is-dragging');
  const kids=[...grid.children].filter(el=>
    el!==drag&&el.dataset.opMark===undefined&&el.getBoundingClientRect().height>0);
  if(!kids.length)return null;
  /* **まずカーソルの真下にある物で群を決める**（§9.230 ①、利用者の指示
     「マウスオーバーの位置がまずどの群の上にいるか、対象となる群に挿入位置を
      表示させてください」）。群は**横にも並べられる**（§9.226 ③）ので、
     段だけで探すと同じ段に居る**隣の群の札**の境目が選ばれてしまい、
     狙った群に入らない。真下に物があるときは、その物の群の中で決める。 */
  const hit=kids.find(el=>{
   const r=el.getBoundingClientRect();
   return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;
  });
  if(hit){
   if(hit.dataset.opBand!==undefined)return opAfterMark(hit.nextElementSibling);
   const r=hit.getBoundingClientRect();
   return (e.clientX<r.left+r.width/2)?hit:opAfterMark(hit.nextElementSibling);
  }
  /* 段にまとめる。グリッドなので**同じ段のものは上端がそろう**。 */
  const rows=[];
  kids.forEach(el=>{
   const r=el.getBoundingClientRect();
   const row=rows.find(x=>Math.abs(x.top-r.top)<=4);
   if(row){row.els.push(el);row.bottom=Math.max(row.bottom,r.bottom)}
   else rows.push({top:r.top,bottom:r.bottom,els:[el]});
  });
  rows.sort((a,b)=>a.top-b.top);
  /* いちばん上より上なら先頭の段、いちばん下より下なら**末尾**。 */
  const row=rows.find(x=>e.clientY<=x.bottom);
  if(!row)return null;
  const band=row.els.find(el=>el.dataset.opBand!==undefined);
  if(band)return opAfterMark(band.nextElementSibling);
  const line=row.els.slice()
    .sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left);
  for(const el of line){
   const r=el.getBoundingClientRect();
   if(e.clientX<r.left+r.width/2)return el;
  }
  return opAfterMark(line[line.length-1].nextElementSibling);
 }
 /* 印は盤の**最後の子**として置いてあるので、`nextElementSibling`が印に
    なることがある。そのまま返すと`insertBefore(印)`＝末尾なので結果は同じ
    だが、印を消したあとに参照が宙に浮く。末尾は`null`で返す。 */
 function opAfterMark(el){
  return (el&&el.dataset&&el.dataset.opMark!==undefined)?null:(el||null);
 }
 /* この位置へ落としたら**どの群に入るか**。帯を後ろへ辿るだけ
    （`opCollectLayout`の「帯より下がその群」と同じ読み方を1箇所で持つ）。 */
 function opGroupAt(grid,at){
  let el=at?at.previousElementSibling:grid.lastElementChild;
  while(el){
   if(el.dataset.opBand!==undefined)return el.dataset.opBand;
   el=el.previousElementSibling;
  }
  return 'その他';
 }
 /* 帯とその下の札（＝1つの群の塊）。**「帯より下がその群」**という
    `opCollectLayout`と同じ読み方を使う（§9.230 ④）。 */
 function opGroupBlock(grid,band){
  const out=[band];
  let el=band.nextElementSibling;
  while(el&&el.dataset.opBand===undefined){
   if(el.dataset.opMark===undefined)out.push(el);
   el=el.nextElementSibling;
  }
  return out;
 }
 /* 群ごと動かすときの落とし先（§9.230 ④、利用者の指示「郡単位で移動できる
    ようにしたいです」）。**止まるのは帯の単位だけ**——群の中の1枚の前へ
    群を挿すことはできないので、いま乗っている群の**塊の上半分なら前、
    下半分なら次の群の前**（次が無ければ末尾＝`null`）。 */
 function opGroupDropAt(grid,e){
  const bands=[...grid.children].filter(el=>el.dataset.opBand!==undefined);
  if(!bands.length)return null;
  const name=opGroupAt(grid,opDropAt(grid,e));
  const idx=bands.findIndex(b=>b.dataset.opBand===name);
  if(idx<0)return null;
  const block=opGroupBlock(grid,bands[idx]);
  const top=bands[idx].getBoundingClientRect().top;
  const bottom=(block[block.length-1]||bands[idx]).getBoundingClientRect().bottom;
  return e.clientY<(top+bottom)/2?bands[idx]:(bands[idx+1]||null);
 }
 /* 落とす先の群を**塗って見せる**（§9.230 ①）。線だけだと、帯のすぐ上と
    下のどちらへ入るのかが読めない——文字（`opMark`の吹き出し）と面の2つで
    示す（§3「色だけで伝えない」）。 */
 function opPaintGroup(grid,name){
  document.querySelectorAll('.is-drop-group').forEach(el=>el.classList.remove('is-drop-group'));
  if(!grid||!name)return;
  let on=false;
  [...grid.children].forEach(el=>{
   if(el.dataset.opMark!==undefined)return;
   if(el.dataset.opBand!==undefined)on=(el.dataset.opBand===name);
   if(on)el.classList.add('is-drop-group');
  });
 }
 /* **印で盤を動かさないこと**（§9.218 ④／§9.196と同じ教訓）。
    以前は印をグリッドの子として**流れの中へ**挿していたため、印が入った
    瞬間に後ろのタイルが1マスぶんずれ、**同じカーソル位置なのに次の
    `dragover`では違う境目がいちばん近くなる**——印が2つの境目を往復し、
    狙った位置に止まらなかった（利用者の報告「移動した後元の位置に戻らなく
    なりました」の正体）。器の座標へ**浮かせて置く**と、盤は1pxも動かない。 */
 function opMark(grid,at){
  const r=grid.getBoundingClientRect();
  let x,y,h;
  if(at){
   const a=at.getBoundingClientRect();
   x=a.left-r.left;y=a.top-r.top;h=a.height;
  }else{
   const kids=[...grid.children].filter(el=>el.dataset.opMark===undefined);
   const last=kids[kids.length-1];
   if(!last){opClearMark();return}
   const a=last.getBoundingClientRect();
   x=a.right-r.left;y=a.top-r.top;h=a.height;
  }
  let m=grid.querySelector(':scope>[data-op-mark]');
  if(!m){
   m=document.createElement('div');
   m.className='op-drop-mark';m.dataset.opMark='1';
   m.innerHTML='<i class="op-drop-tag"></i>';
   grid.appendChild(m);
  }
  m.style.left=(x-2)+'px';m.style.top=y+'px';m.style.height=h+'px';
  /* **どの群に入るかを文字で出す**（§9.219 ③／§CLAUDE 2「次にすることを
     常に1つだけ指す」）。線だけだと、帯のすぐ上と下のどちらへ入るのかが
     読めない——「移動できません」の報告はここが読めないことから始まった。 */
  const tag=m.querySelector('.op-drop-tag');
  const place=grid.dataset.opPlace||'準備';
  if(opState.dragGroup){
   /* 群ごと運んでいるときは**群の名前で言う**（どの群の前に入るか）。
      塊で動くので、群の中を塗っても意味が無い。 */
   const before=at&&at.dataset.opBand!==undefined?at.dataset.opBand:'';
   if(tag)tag.textContent=before?`${place}／「${before}」の前へ`:`${place}／いちばん下へ`;
   opPaintGroup(null,'');
   m.classList.add('is-group');
   return;
  }
  m.classList.remove('is-group');
  const name=opGroupAt(grid,at);
  if(tag)tag.textContent=`${place}／${name} へ`;
  opPaintGroup(grid,name);
 }
 function opClearMark(){
  document.querySelectorAll('[data-op-mark]').forEach(x=>x.remove());
  opPaintGroup(null,'');
 }
 /* 落とす先の狙いは**この2つだけ**が決めている。ヘッドレスではHTML5の
    D&Dの座標を作れないので、網はここを直に呼んで確かめる（§9.218 ④）。
    **素の`window.*`を増やさない**（CLAUDE.md「新規公開は名前空間経由」）。 */
 window.WL=window.WL||{};
 /* 群ごとの移動もヘッドレスでは座標を作れないので、口から呼べるようにする
    （§9.230 ④。§9.218 ④と同じ理由）。**素の`window.*`を増やさない**。 */
 WL.opBoard={dropAt:opDropAt,mark:opMark,clearMark:opClearMark,groupAt:opGroupAt,
             groupDropAt:opGroupDropAt,groupBlock:opGroupBlock,
             /* 群を1つ動かして保存する（帯を掴んで落とすのと同じ道）。 */
             moveGroup(place,name,beforeName){
              const grid=[...document.querySelectorAll('#masterMaintList .op-board-grid')]
                .find(g=>g.dataset.opPlace===place);
              if(!grid)return false;
              const bands=[...grid.children].filter(el=>el.dataset.opBand!==undefined);
              const src=bands.find(b=>b.dataset.opBand===name);
              const at=beforeName?bands.find(b=>b.dataset.opBand===beforeName):null;
              if(!src)return false;
              const block=opGroupBlock(grid,src);
              if(block.indexOf(at)>=0)return false;
              block.forEach(el=>{at?grid.insertBefore(el,at):grid.appendChild(el)});
              opSaveLayout();return true;
             }};
 async function opRenameGroup(place,from,to){
  const uid=requireMaintUser();if(uid===null)return;
  const rows=opCollectLayout().map(r=>(r.place===place&&r.group===from)?{...r,group:to}:r);
  try{
   await api('/api/operation-item-master/layout',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({items:rows,user_id:uid})});
   await loadOpItemMaint(true);
   /* **測定画面の写しを捨てる**（§9.226 ①）。ここだけ落ちていたため、
      群の名前を変えても**測定画面の見出しは古い名前のまま**だった
      （`measure-opdata.js`は設備ごとに定義を覚えており、`forget()`が
      唯一の捨て口）。書き換えの経路は全部ここを通すこと。 */
   if(window.WL&&WL.opData)WL.opData.forget();
   opSay('群の名前を変えました');
  }catch(e){opSay('名前を変えられませんでした: '+e.message,true)}
 }
 async function opCreateGroup(){
  const name=prompt('新しい群の名前（この名前の見出しが測定画面に出ます）','新しい群');
  if(name===null)return;
  const n=String(name).trim();if(!n)return;
  await opCreateItem({group:n,name:n+' 1'});
 }
 /* ---------- 空き（ダミー）の群（§9.227 ③、利用者の指示） ----------
    「マスタでまとまりをダミーで作って何も枠もない空間をつくれるように
     してください。(区切りの良い並びに整列させるためのダミーカード)」

    **群は独立した行を持たない**（項目行の`[群]`列から導出する）ので、
    印を持つ行が1つ要る。その行の入力欄は測定画面に**一度も描かれない**
    ので、名前は盤の中だけの呼び名になる。 */
 /* 空きのカードを1枚足す（§9.228 ②、利用者の指示「ダミーのカードだけ
    追加したいがダミー群ごとしか追加できないのも修正してほしい」）。
    **群は作らない**——いま選んでいるカードと同じ群へ入れ、掴んで好きな
    場所へ動かせる。名前も聞かない（測定画面に出ないので決めることが1つ減る）。 */
 async function opCreatePad(){
  const uid=requireMaintUser();if(uid===null)return;
  const cur=opItemById(opState.picked);
  const place=(cur&&cur.place)||'準備';
  const group=(cur&&cur.group)
    ||((opState.items||[]).find(x=>(x.place||'準備')===place)||{}).group||'その他';
  /* 項目名は**鍵**（自然キーは設備×項目名）なので重ならない値を作る。 */
  const used=new Set((opState.items||[]).map(x=>x.name));
  let n=1,nm='空き';
  while(used.has(nm))nm='空き'+(++n);
  try{
   await api('/api/operation-item-master',{method:'POST',
     headers:{'Content-Type':'application/json'},
     /* **「出さない」にしないこと**——測定画面が読むのは
        `items_for_equipment(c,eq)`＝有効な行だけなので、無効にすると
        カードそのものが届かず、**空きが1マスも空かない**（実際に踏んだ）。
        描かないのは`[ダミー]`の印の役目で、有効/無効の役目ではない。 */
     body:JSON.stringify({equipment:opState.equipment||'*',group,
       name:nm,type:'文字',place,span:4,dummy:true,user_id:uid})});
   await loadOpItemMaint(true);
   if(window.WL&&WL.opData)WL.opData.forget();
   opSay(`空きのカードを「${group}」へ足しました。掴んで動かし、幅を決めると、そのぶんが測定画面で空きます。`);
  }catch(e){opSay('追加できませんでした: '+e.message,true)}
 }
 /* ---------- 盤の右クリックメニュー（§9.228 ⑤、利用者の指示） ----------
    「右クリックメニューを実装してください。削除やサイズ変更などよく使う
     メニューに絞って実装してほしいです。」

    **絞る**のが要件なので、置くのは「幅・出す/出さない・空き・削除」の4つ
    だけ。細かい設定は今までどおりダブルクリックの設定窓が持つ（入口を2つに
    しない・§9.207と同じ作法）。
    **開いた器は必ず控える**（§9.222 ①）——控え忘れると、閉じる・外側
    クリック・Escの3つが全部空振りして**押すたびにDOMへ積み上がる**。 */
 let opMenuEl=null;
 function closeOpMenu(){
  if(!opMenuEl)return;
  opMenuEl.remove();opMenuEl=null;
  document.removeEventListener('mousedown',opMenuOutside,true);
  document.removeEventListener('keydown',opMenuEsc,true);
 }
 function opMenuOutside(e){if(opMenuEl&&!opMenuEl.contains(e.target))closeOpMenu()}
 function opMenuEsc(e){if(e.key==='Escape'){e.stopPropagation();closeOpMenu()}}
 /* 幅は盤の帯と同じ刻みを「カードの幅」として使う。**1マス（1/12）も置く**
    （§9.230 ②、利用者の指示「右クリックで幅変更のボタンが中途半端で、
    1/12(1マス)がない。1/12も使いたいので追加してください」）——設定窓の
    幅の帯は最初から1マスから選べたので、右クリックだけが刻みを削っていた。 */
 const OP_TILE_SPANS=[{v:1,label:'1/12'},{v:2,label:'1/6'},{v:3,label:'1/4'},
                      {v:4,label:'1/3'},{v:6,label:'1/2'},{v:8,label:'2/3'},
                      {v:12,label:'全幅'}];
 /* `ev`はマウスの出来事でも、キーボードから開くときの`{x,y}`でもよい
    （`DOMRect`をそのまま渡せる）。 */
 function opOpenTileMenu(ev,x){
  closeOpMenu();
  if(ev&&typeof ev.preventDefault==='function')ev.preventDefault();
  const px=Number(ev&&(ev.clientX!=null?ev.clientX:ev.x))||8;
  const py=Number(ev&&(ev.clientY!=null?ev.clientY:ev.y))||8;
  const span=opSpanOf(x),pad=!!x.dummy,off=x.enabled===false;
  const m=document.createElement('div');
  m.className='op-menu';m.setAttribute('role','menu');
  const b=(attr,label,cls)=>`<button type="button" ${attr}`
    +`${cls?` class="${cls}"`:''}>${esc(label)}</button>`;
  m.innerHTML=`<div class="op-menu-head">${esc(pad?'空き':x.name)}</div>`
   +`<div class="op-menu-row"><b>幅</b>`
   +OP_TILE_SPANS.map(o=>`<button type="button" data-opm-span="${o.v}"`
     +` class="${span===o.v?'is-on':''}" title="${esc(o.label)}（${o.v}/${opState.gridCols}マス）">`
     +`${esc(o.label)}</button>`).join('')+`</div>`
   +`<div class="op-menu-sep"></div>`
   +(pad?b('data-opm-pad="0"','ふつうの項目へ戻す')
        :b('data-opm-off="'+(off?'0':'1')+'"',off?'測定画面に出す':'測定画面に出さない'))
   +(pad?'':b('data-opm-pad="1"','空きにする（何も描かない）'))
   +(pad?'':b('data-opm-open="1"','設定をひらく…'))
   +`<div class="op-menu-sep"></div>`
   +(x.builtin
      ?`<button type="button" disabled title="画面がもともと持っている欄なので消せません（出さないことはできます）">削除できません</button>`
      :b('data-opm-del="1"','この'+(pad?'空き':'項目')+'を削除','is-danger'));
  document.body.appendChild(m);
  opMenuEl=m;
  /* 画面の外へ出さない（右下で開くと切れる）。 */
  const r=m.getBoundingClientRect();
  m.style.left=Math.max(4,Math.min(px,window.innerWidth-r.width-4))+'px';
  m.style.top=Math.max(4,Math.min(py,window.innerHeight-r.height-4))+'px';
  const act=async fn=>{
   const uid=requireMaintUser();if(uid===null){closeOpMenu();return}
   closeOpMenu();
   try{await fn(uid)}catch(e){opSay('できませんでした: '+e.message,true)}
  };
  m.querySelectorAll('[data-opm-span]').forEach(btn=>btn.onclick=()=>act(async uid=>{
   await api('/api/operation-item-master/update',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({...x,id:x.id,span:Number(btn.dataset.opmSpan),user_id:uid})});
   await loadOpItemMaint(true);
   if(window.WL&&WL.opData)WL.opData.forget();
   opSay(`幅を${opSpanLabel(Number(btn.dataset.opmSpan))}にしました`);
  }));
  const offBtn=m.querySelector('[data-opm-off]');
  if(offBtn)offBtn.onclick=()=>act(async uid=>{
   const on=offBtn.dataset.opmOff==='0';
   await api('/api/operation-item-master/update',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({...x,id:x.id,enabled:on,user_id:uid})});
   await loadOpItemMaint(true);
   if(window.WL&&WL.opData)WL.opData.forget();
   opSay(on?`「${x.name}」を測定画面に出します`:`「${x.name}」を測定画面に出しません`);
  });
  m.querySelectorAll('[data-opm-pad]').forEach(btn=>btn.onclick=()=>act(async uid=>{
   await opSetPad(x.id,btn.dataset.opmPad==='1',uid);
   opSay(btn.dataset.opmPad==='1'
     ?'空きにしました（測定画面では何も描きません）':'ふつうの項目へ戻しました');
  }));
  const openBtn=m.querySelector('[data-opm-open]');
  if(openBtn)openBtn.onclick=()=>{closeOpMenu();opState.picked=x.id;renderOpItem();openOpModal(x.id)};
  const del=m.querySelector('[data-opm-del]');
  if(del)del.onclick=()=>act(async uid=>{
   /* **取り消せないので確認する**（§5）。空きは中身が無いので聞かない。 */
   if(!pad&&!confirm(`「${x.name}」を削除します。取り消せません。\n`
     +'（記録済みの値は残りますが、これ以降は画面から入れられなくなります）'))return;
   await api('/api/operation-item-master/delete',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:x.id,user_id:uid})});
   await loadOpItemMaint(true);
   if(window.WL&&WL.opData)WL.opData.forget();
   opSay(pad?'空きを削除しました':`「${x.name}」を削除しました`);
  });
  document.addEventListener('mousedown',opMenuOutside,true);
  document.addEventListener('keydown',opMenuEsc,true);
 }
 /* カード1枚を空きにする／戻す（§9.228 ②）。 */
 async function opSetPad(id,on,uid){
  const x=opItemById(id);if(!x)return;
  await api('/api/operation-item-master/update',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...x,id:x.id,dummy:!!on,user_id:uid})});
  await loadOpItemMaint(true);
  if(window.WL&&WL.opData)WL.opData.forget();
 }
 /* ================================================================
    自動で入る値・計算値を足す（§9.234 ②、利用者の指示）
    ----------------------------------------------------------------
    「自動で入る値、計算値についても、現在使っているものは、そのリストから
     選んで表示設定できるようにしてください」

    測定画面には**人が打たない値**が既にいくつも出ていた（仕掛から写した
    ロット番号・製造板厚、開いた設備、実働時間…）。画面に焼き付いていたので
    置き場も名前も見せ方も現場が決められなかった。ここから1枚のカードとして
    足せば、あとは他の項目とまったく同じ——並べ替え・幅・単位・寄せ・意匠が
    そのまま効く（作り直さず、割り付けだけを差配する・§9.216 ②）。

    **一覧はサーバーが答える**（`/api/operation-item-master`の`autoValues`）
    ——鍵の綴りを画面へ書き写すと、増やしたときに2箇所直すことになる。
    **もう足してあるものは、そう書いて押せなくする**（§4）——同じ鍵の欄が
    2つあると、同じ数字が2箇所に出る（§CLAUDE 8）。 */
 function opAutoValueUsed(){
  const m=new Map();
  /* §9.256。**「式で作る」は何個でも置ける**——固定の鍵は同じ値が2箇所に
     出るので1つに絞るが、式は1本ごとに別の値を作る道具なので、
     1つ置いたら選べなくなっては困る（§CLAUDE 4）。 */
  (opState.items||[]).forEach(x=>{
   if(x.autoValue&&x.autoValue!==opFormulaKey())m.set(String(x.autoValue),x);
  });
  return m;
 }
 function opOpenAutoMenu(ev){
  closeOpMenu();
  if(ev&&typeof ev.preventDefault==='function')ev.preventDefault();
  const list=opState.autoValues||[];
  const btn=ev&&ev.currentTarget&&ev.currentTarget.getBoundingClientRect
    ?ev.currentTarget.getBoundingClientRect():null;
  const px=btn?btn.left:(Number(ev&&ev.clientX)||8);
  const py=btn?btn.bottom+4:(Number(ev&&ev.clientY)||8);
  const used=opAutoValueUsed();
  const m=document.createElement('div');
  m.className='op-menu op-menu-auto';m.setAttribute('role','menu');
  if(!list.length){
   m.innerHTML='<div class="op-menu-head">自動で入る値</div>'
     +'<button type="button" disabled>この版では一覧を読めませんでした</button>';
  }else{
   const groups=[];
   list.forEach(a=>{
    let g=groups.find(x=>x.name===a.group);
    if(!g){g={name:a.group,items:[]};groups.push(g)}
    g.items.push(a);
   });
   m.innerHTML='<div class="op-menu-head">自動で入る値・計算値を足す</div>'
    +'<div class="op-menu-note">人が打たない値です。足すと1枚のカードになり、'
    +'置き場・幅・単位・見せ方はふつうの項目と同じように決められます。</div>'
    +groups.map(g=>`<div class="op-menu-group">${esc(g.name)}</div>`
      +g.items.map(a=>{
        const hit=used.get(a.key);
        const note=[a.unit?`単位 ${a.unit}`:'',a.note].filter(Boolean).join('｜');
        return hit
         ?`<button type="button" disabled title="${esc(note)}">${esc(a.label)}`
          +`<small>もう「${esc(hit.name)}」として置いています</small></button>`
         :`<button type="button" data-opm-auto="${esc(a.key)}" title="${esc(note)}">`
          +`${esc(a.label)}${a.unit?`<small>${esc(a.unit)}</small>`:''}</button>`;
       }).join('')).join('');
  }
  document.body.appendChild(m);
  opMenuEl=m;
  const r=m.getBoundingClientRect();
  m.style.left=Math.max(4,Math.min(px,window.innerWidth-r.width-4))+'px';
  m.style.top=Math.max(4,Math.min(py,window.innerHeight-r.height-4))+'px';
  m.querySelectorAll('[data-opm-auto]').forEach(b=>b.onclick=async()=>{
   const key=b.dataset.opmAuto;
   closeOpMenu();
   await opCreateAuto(key);
  });
  document.addEventListener('mousedown',opMenuOutside,true);
  document.addEventListener('keydown',opMenuEsc,true);
 }
 async function opCreateAuto(key){
  const uid=requireMaintUser();if(uid===null)return;
  const a=(opState.autoValues||[]).find(x=>x.key===key);
  if(!a){opSay('その値は一覧にありません',true);return}
  const cur=opItemById(opState.picked);
  const place=(cur&&cur.place)||'準備';
  const group=(cur&&cur.group)
    ||((opState.items||[]).find(x=>(x.place||'準備')===place)||{}).group||'自動で入る値';
  /* 項目名は**鍵**（自然キーは設備×項目名）なので重ならない値を作る。
     呼び名をそのまま使い、埋まっていたら番号を足す（名前は後から直せる）。 */
  const usedNames=new Set((opState.items||[]).map(x=>x.name));
  let nm=a.label,n=1;
  while(usedNames.has(nm))nm=a.label+'('+(++n)+')';
  try{
   const r=await api('/api/operation-item-master',{method:'POST',
     headers:{'Content-Type':'application/json'},
     /* **型は`文字`のまま**——値を入れるのは画面なので、型で入力を縛る
        意味が無い（族はサーバーが`output`と答える）。単位は一覧の値を
        そのまま入れる（§CLAUDE 6「単位を画面に出す」）。 */
     body:JSON.stringify({equipment:opState.equipment||'*',group,name:nm,
       type:'文字',place,span:4,unit:a.unit||'',autoValue:a.key,user_id:uid})});
   opState.picked=r.id;
   await loadOpItemMaint(true);
   if(window.WL&&WL.opData)WL.opData.forget();
   opSay(`「${nm}」を足しました。値は測定画面が入れます（${a.note}）`);
   openOpModal(r.id);
  }catch(e){opSay('追加できませんでした: '+e.message,true)}
 }
 async function opCreateItem(seed){
  const uid=requireMaintUser();if(uid===null)return;
  const base=seed||{};
  const name=base.name||prompt('項目名（測定画面に出る名前で、記録の鍵にもなります）','新しい項目');
  if(name===null)return;
  const nm=String(name).trim();if(!nm)return;
  try{
   const r=await api('/api/operation-item-master',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({equipment:opState.equipment||'*',group:base.group||'その他',
       name:nm,type:'文字',place:'準備',span:4,user_id:uid})});
   opState.picked=r.id;
   await loadOpItemMaint(true);
   opSay('項目を追加しました');
   openOpModal(r.id);
   if(window.WL&&WL.opData)WL.opData.forget();
  }catch(e){opSay('追加できませんでした: '+e.message,true)}
 }

 /* ================================================================
    項目の設定はモーダルで開く（§9.218 ①、利用者の指示）
    ----------------------------------------------------------------
    「操業データ項目を選んだときにメニューが右側で固定され、設定しにくい。
      モーダルで表示して設定させる形にしてください。UIももう少し使いやすく
      直感的で視覚で表現する方法も検討してください」

    左に**実物**（測定画面と同じ部品を、選んだマス数の器に入れて出す）、
    右に**決めること**。触った結果がその場で見えないと、幅も選ばせ方も
    「当たっているか」が分からない（列の設定パネルと同じ作法・§9.105）。
    ================================================================ */
 /* ---------- 素性は`?`の浮き出しへ（§9.288 ④、利用者の指示） ----------
    「左側のエリアは死にエリアになっています。左側で有益なのは実際の見た目の
     プレビューくらいでそれ以外はほぼ役に立っていません。」

    **消さずに畳む**（§9.234 ①）——1回読めば足りる説明を、画面のいちばん
    広い場所へ毎回置かない。**器の外（body直下）へ`position:fixed`**（§9.201。
    見本の帯は`overflow:auto`なので、中に置くと切られる）。
    **開いた器は必ず控える**（§9.222 ①）。 */
 let opPrevInfoEl=null;
 function opClosePrevInfo(){
  opPrevInfoEl?.remove();opPrevInfoEl=null;
  $('#opPrevInfoBtn')?.setAttribute('aria-expanded','false');
  document.removeEventListener('click',opPrevInfoOutside,true);
  document.removeEventListener('keydown',opPrevInfoEsc,true);
 }
 function opPrevInfoOutside(e){
  if(opPrevInfoEl&&!opPrevInfoEl.contains(e.target)&&!e.target.closest('#opPrevInfoBtn'))opClosePrevInfo();
 }
 function opPrevInfoEsc(e){if(WL.modal.escCloses(e)){e.stopPropagation();opClosePrevInfo()}}
 function opBindPrevInfo(html){
  opClosePrevInfo();
  const btn=$('#opPrevInfoBtn');if(!btn)return;
  btn.onclick=e=>{
   e.preventDefault();
   if(opPrevInfoEl){opClosePrevInfo();return}
   const pop=document.createElement('div');
   pop.className='access-mode-menu op-prev-info-pop';pop.id='opPrevInfoPop';
   pop.innerHTML='<p class="op-prev-info-head">この項目の素性<small>1回読めば足りる話です</small></p>'+html;
   document.body.append(pop);
   opPrevInfoEl=pop;
   const r=btn.getBoundingClientRect();
   pop.style.top=`${Math.min(r.bottom+6,innerHeight-pop.offsetHeight-8)}px`;
   pop.style.left=`${Math.max(8,Math.min(r.left,innerWidth-pop.offsetWidth-8))}px`;
   btn.setAttribute('aria-expanded','true');
   requestAnimationFrame(()=>{
    document.addEventListener('click',opPrevInfoOutside,true);
    document.addEventListener('keydown',opPrevInfoEsc,true);
   });
  };
 }
 /* ---------- 大きい選び物は浮き出しへ（§9.299、利用者の指示） ----------
    「メニューはコンパクトにしたり、メニュー構造を改良してポップオーバーの
     入れ子メニューなども工夫して使うことでわかりやすい使いやすいメニューに」

    選ばせ方の盤は24枚（実測で高さ600px超）、選択肢の値の一覧は件数ぶん
    伸びる——どちらも**1つ決めたらしばらく触らない**ものなので、常時
    並べると本体の面積をそれだけで食う（面積は頻度×重要度・§CLAUDE 1）。
    **いま選んでいるものはボタンに文字で出す**（§3。畳んだ先の値が読めない
    のでは畳んだ意味が無い）。

    **DOMには置いたまま`hidden`だけを入切する**（§9.222 ①）——`body`直下へ
    作ると、`bindOpModal()`が`#opModalForm`の中を配線するので**中の部品に
    配線が届かない**（押しても何も起きないボタンになる・§4）。
    位置は`position:fixed`で、**画面の外へ出さない**（§9.265）。 */
 function opPopHtml(key,label,head,body,opt){
  const o=opt||{};
  return `<button type="button" class="${o.btnClass||'op-pop-btn'}" data-op-pop="${esc(key)}"`
   +` aria-expanded="false"${o.title?` title="${esc(o.title)}"`:''}>`
   +(o.plain?esc(label):`<b>${esc(label)}</b>${o.note?`<small>${esc(o.note)}</small>`:''}`
      +`<span class="hd-caret" aria-hidden="true">▾</span>`)
   +`</button>`
   +`<div class="op-pop${o.popClass?' '+o.popClass:''}" data-op-pop-panel="${esc(key)}" hidden>`
   +`<p class="op-pop-head">${esc(head)}${o.headNote?`<small>${esc(o.headNote)}</small>`:''}</p>`
   +body+`</div>`;
 }
 /* 開いている浮き出しは`opState.pop`が1つだけ持つ（同時に2枚開かない）。
    **窓を描き直したあとも開いたまま**にする——選択肢の値を1つ足すたびに
    閉じるのでは、続けて足せない。 */
 function opSyncPops(){
  const form=$('#opModalForm');
  const head=$('#opItemModal');
  if(!head)return;
  const want=String(opState.pop||'');
  let opened=false;
  head.querySelectorAll('[data-op-pop-panel]').forEach(pop=>{
   const k=pop.dataset.opPopPanel;
   const btn=head.querySelector(`[data-op-pop="${CSS.escape(k)}"]`);
   const on=k===want;
   pop.hidden=!on;
   if(btn)btn.setAttribute('aria-expanded',on?'true':'false');
   if(!on||!btn)return;
   opened=true;
   /* **画面の中へ引き戻す**（§9.292 ④と同じ作法）。押した欄の真下を
      基本にして、はみ出す側だけ寄せる。 */
   const r=btn.getBoundingClientRect();
   pop.style.left='0px';pop.style.top='0px';           /* 測る前に戻す */
   const w=pop.offsetWidth,h=pop.offsetHeight;
   pop.style.left=`${Math.max(8,Math.min(r.left,innerWidth-w-8))}px`;
   pop.style.top=`${(r.bottom+6+h<=innerHeight-8)?r.bottom+6:Math.max(8,r.top-6-h)}px`;
  });
  if(!opened&&want)opState.pop='';
  if(form)form.classList.toggle('has-pop',!!opState.pop);
 }
 function opPopOutside(e){
  if(!opState.pop)return;
  if(e.target.closest('[data-op-pop-panel]')||e.target.closest('[data-op-pop]'))return;
  opState.pop='';opSyncPops();
 }
 function opPopEsc(e){
  if(!opState.pop||!WL.modal.escCloses(e))return;
  e.stopPropagation();opState.pop='';opSyncPops();
 }
 function ensureOpModal(){
  let m=$('#opItemModal');if(m)return m;
  m=document.createElement('div');m.className='record-modal';m.id='opItemModal';m.hidden=true;
  /* ---------- 窓の骨（§9.223 ②、利用者の指示） ----------
     「見え方はもっと実施の見え方に近づけるために広い領域が必要、コンテンツは
      縦に長いがそれぞれの項目が縦に並ぶので切れ目がわかりにくく、ステップと
      しても認知負荷が上がる。タブの活用でステップを見せたり画面領域の確保を
      行い、補助的データや説明はアコーディオンやフローティングで表示階層を
      変えるなど工夫してください。保存ボタンの位置は右上の端に変更して
      ください。」

     直したのは4つ。
       ①**保存は右上の端**（決め終えたら右上へ戻る、が1本道になる）
       ②**タブでステップを見せる**（4つの塊を縦に積むと切れ目が読めない。
         タブなら「いまどこ」「あと何段」が常に出ている）
       ③**見本の領域を広く**（実際の見え方に近づけるのがこの窓の値打ち）
       ④**説明はアコーディオン**（`<details>`）へ落として階層を分ける
     状態（保存しました／できません）は**タブの上の1行**に出す——窓の外へ
     出すと、閉じない窓では読まれない（§9.222 ⑦は「閉じるなら外」）。 */
  m.innerHTML=`<div class="settings-dialog op-dialog" role="dialog" aria-modal="true">
    <header class="op-modal-head">
     <div class="op-modal-id"><small>操業データ項目</small><h2 id="opModalTitle">項目</h2>
      <span class="op-modal-role" id="opModalRole"></span></div>
     <span class="op-modal-state" id="opModalState" aria-live="polite"></span>
     <div class="op-modal-top" id="opModalActions"></div>
     <button id="opModalClose" type="button" aria-label="閉じる">×</button></header>
    <div class="op-modal-body">
     <div class="op-modal-preview" id="opModalPreview"></div>
     <!-- 「いまは作れない」理由（§9.250 ⑧）。**帯の外**へ置く（§9.222 ④）
          ——帯は高さを固定してあるので、中に書くと出た瞬間に切り落とされる。 -->
     <p class="op-prev-note" id="opPrevNote" hidden></p>
     <div class="op-modal-form" id="opModalForm"></div>
    </div>
   </div>`;
  document.body.append(m);
  $('#opModalClose').onclick=closeOpModal;
  WL.modal.keepOpen(m);
  /* 浮き出しは**Escと外クリックで畳む**（§9.222 ①）。**窓より先に受ける**
     ——同じEscで窓ごと閉じると、盤を閉じたつもりで設定を離れることになる。 */
  document.addEventListener('click',opPopOutside,true);
  document.addEventListener('keydown',e=>{
   if(m.hidden)return;
   if(opState.pop){opPopEsc(e);return}
   if(WL.modal.escCloses(e)){e.stopPropagation();closeOpModal()}
  },true);
  return m;
 }
 function closeOpModal(){
  const m=$('#opItemModal');if(!m)return;
  /* **浮き出しも一緒に畳む**（§9.222 ①）——残ると、どの欄のものか
     分からない説明が画面に浮いたままになる。 */
  opClosePrevInfo();
  opState.pop='';opSyncPops();
  m.hidden=true;opState.picked=null;renderOpItem();
 }
 function openOpModal(id){
  /* **別の項目を開いたら浮き出しは畳む**（§9.299。段は廃止したので
     「①へ戻す」は要らない——3つの塊は最初から全部見えている）。
     開いたままだと、前の項目の選ばせ方の盤が新しい項目の上に残る。 */
  if(String(opState.picked||'')!==String(id||''))opState.pop='';
  opState.picked=id;
  const m=ensureOpModal();m.hidden=false;renderOpModal();
  /* **前の窓の一言を持ち越さない**（§CLAUDE 2）。`#opModalState`は窓を作り
     直さない作りなので、消さないと「保存できませんでした」が別の項目を
     開いた瞬間の状態として読まれる。 */
  opModalSay('');
 }
 function opModalSay(text,bad){
  const el=$('#opModalState');if(!el)return;
  el.textContent=text||'';el.classList.toggle('is-bad',!!bad);
 }
 /* いま画面にある測定項目の一覧（開く条件で選ばせる）。**ここへ書き写さない**
    ——`index.html`の`#measureType`が正で、増減したときに2箇所を直すことになる。 */
 function opMeasureTypes(){
  const el=document.getElementById('measureType');
  if(!el)return [];
  return [...el.options].map(o=>String(o.text||'').trim()).filter(Boolean);
 }
 /* 選んだマス数を**帯で見せる**。数字だけでは「カードのどのくらいか」が
    読めない（§9.218 ②）。 */
 function opSpanPickerHtml(span){
  const n=opState.gridCols;
  return `<span class="op-span-pick" role="group" aria-label="幅">`
   +Array.from({length:n},(_,i)=>i+1).map(v=>
     `<button type="button" data-op-span="${v}" class="${v<=span?'is-on':''}"`
     +` title="${esc(opSpanLabel(v))}" aria-pressed="${v===span?'true':'false'}"></button>`).join('')
   +`</span><i class="op-form-note">${esc(opSpanLabel(span))}</i>`;
 }
 /* そのまとまりの値。**1箇所で引く**（初期値の候補・サジェストの下見・
    一覧の3つが同じものを見る）。 */
 /* 初期値が「数の決まり」から外れていないか（§9.220 ②）。**外れていても
    保存は通す**——上下限は後から変えるものなので、保存そのものを断ると
    設定の順番を強いることになる。断らない代わりに**必ず書く**（§4）。 */
/* ---------- 上下限の出どころ（§9.231 ②、利用者の指示） ----------
    「MIN-MAXなどの入力値を決めるところで、マスタからのデータともリンク
     できるようにしてください。特に設備マスタの追加する最大ライン速度や
     最大条数はリンクをさせたい部分です」

    **語彙はサーバーが持つ**（`opState.limitSources`）。画面は選ばせて、
    **いまの値・単位・出どころを文字で出す**だけ（§CLAUDE 6）——同じ
    「最大 350」でも、この行に書いた数と設備マスタから引いた数では
    直す場所が違う。引けなかったときは**0にしない**（§9.114）。 */
 function opLimitSource(key){
  return (opState.limitSources||[]).find(s=>s.key===String(key||''))||null;
 }
 /* いま効いている上下限。出どころが指定してあればそちらが勝つ
    ——**判定は1箇所**（見本・初期値の警告・保存後の測定画面が
    食い違わないように）。引けなければ`null`＝「上限なし」。 */
 function opLimitOf(x,side){
  const key=String((side==='min'?x.minFrom:x.maxFrom)||'');
  if(key){
   const src=opLimitSource(key);
   const v=src?src.value:null;
   return (v===null||v===undefined||v==='')?null:Number(v);
  }
  const raw=side==='min'?x.min:x.max;
  return (raw===null||raw===undefined||raw==='')?null:Number(raw);
 }
 /* いま効いている上下限を載せた写し。**決まり書きも見本もこれを通す**
    ——`x`をそのまま渡すと、マスタから引く設定にしても行に書いた数のままで
    描かれる（設定画面で確かめた形と測定画面が食い違う。§9.221 ⑦）。 */
 function opRuleDef(x){
  return {...x,min:opLimitOf(x,'min'),max:opLimitOf(x,'max'),
          minFromLabel:(opLimitSource(x.minFrom)||{}).label||'',
          maxFromLabel:(opLimitSource(x.maxFrom)||{}).label||''};
 }
 /* 出どころを選ぶ欄。**選ぶ前に何が起きるかを書く**（§CLAUDE 6）
    ——選んだ瞬間に手打ちの欄が使えなくなるので、いまの値と単位を添える。 */
 function opLimitFromHtml(x,side){
  const cur=String((side==='min'?x.minFrom:x.maxFrom)||'');
  const name=side==='min'?'最小':'最大';
  const list=opState.limitSources||[];
  const hit=opLimitSource(cur);
  const opts=['<option value="">自分で決める（上の数）</option>']
   .concat(list.map(s=>`<option value="${esc(s.key)}"${s.key===cur?' selected':''}>${esc(s.label)}</option>`))
   /* **知らない鍵を黙って捨てない**（§9.204の`optionFill()`と同じ罠）
      ——候補に無い値を`select.value`へ入れると空になり、保存した瞬間に
      設定が消える。候補へ足したうえで、引けないことを名前で言う。 */
   .concat(cur&&!hit?[`<option value="${esc(cur)}" selected>${esc(cur)}（このアプリが知らない出どころ）</option>`]:[]);
  return `<label class="op-from">${name}<select id="opd${side==='min'?'Min':'Max'}From" data-op-from="${side}">`
   +`${opts.join('')}</select>`
   +`<i class="op-form-note">${esc(opLimitFromNote(x,side))}</i></label>`;
 }
 function opLimitFromNote(x,side){
  const cur=String((side==='min'?x.minFrom:x.maxFrom)||'');
  if(!cur)return 'この行に書いた数をそのまま使います。';
  const hit=opLimitSource(cur);
  if(!hit)return `「${cur}」は今のこのアプリが知らない出どころです。選び直してください。`;
  const eq=opState.equipment;
  if(!eq)return `${hit.label}から引きます。上の「設備」を選ぶと、その設備でいくつになるかが出ます。`;
  const v=hit.value;
  if(v===null||v===undefined||v==='')
   return `${hit.label}から引きます。${eq}には値が入っていないので、この設備では${side==='min'?'下限':'上限'}が掛かりません。`;
  return `${hit.label}から引きます。${eq}のいまの値は ${v}${hit.unit?' '+hit.unit:''} です。`;
 }
 function opInitialRangeNote(x){
  const raw=String(x.initial||'').trim();
  if(!raw)return '';
  const n=Number(raw);
  if(!Number.isFinite(n))
   return (opFamilyOf(x)==='number')?`「${raw}」は数として読めません`:'';
  if(opFamilyOf(x)!=='number')return '';
  /* **出どころを指定した側はそちらの値で見る**（§9.231 ②）。行に書いた
     数で判定すると、マスタから引いた上限と食い違う警告が出る。 */
  const lo=opLimitOf(x,'min'),hi=opLimitOf(x,'max');
  const from=side=>{const src=opLimitSource(side==='min'?x.minFrom:x.maxFrom);
                    return src?`（${src.label}）`:''};
  if(lo!==null&&n<lo)return `最小 ${lo}${from('min')} を下回っています`;
  if(hi!==null&&n>hi)return `最大 ${hi}${from('max')} を上回っています`;
  if(['整数','正の整数'].includes(x.type)&&!Number.isInteger(n))
   return '整数の項目なので小数は入りません';
  if(['正の整数','正の数'].includes(x.type)&&n<0)return '0以上の項目です';
  return '';
 }
/* ---------- 見せ方（§9.221 ⑦、利用者の指示） ----------
    「単位を出す位置(外上左、外上中央、外上右、内部、外下左、外中央、
     外下右)、出し方、データの表示方法、桁数、左詰め、右詰め、中央寄せなど、
     さらにカスタマイズできるように改良してください」

    位置は**9マスの盤で選ばせる**——「外上右」という名前を読んで頭の中で
    位置へ翻訳させるより、**置きたい場所を押す**ほうが速い（推測させない）。
    真ん中は`内部`＝欄の中に重ねる形で、盤の形そのものが説明になる。

    **単位は型を問わず出す。** 以前は「数の決まり」の中にあったため、
    `選択`型では欄ごと出ておらず、種としては単位を持つ項目（リール径 mm）が
    **画面から編集できなかった**。 */
 const OP_UNIT_CELLS=[['外上左','外上中央','外上右'],
                      ['','内部',''],
                      ['外下左','外下中央','外下右']];
 function opUnitPlaceOf(x){
  const at=String(x.unitPlace||'外下左');
  return opState.unitPlaces.includes(at)?at:'外下左';
 }
 /* 重ねられない入力方法かどうか。**判定の材料はサーバーが返した一覧**
    （`unitInBlocked`）で、規則そのものは画面に持たない。 */
 /* **手打ちを許したプルダウンも重ねられない**（§9.233 ④）——`<select>`が
    器の裏へ回って1pxになるので、その隣へ置いた単位は一度も見えない。
    **規則はサーバーの`unit_in_ok()`が持つ**（画面は一覧を引くだけ）。 */
 function opUnitInBlocked(widget,freeText){
  if((opState.unitInBlocked||[]).includes(widget))return true;
  return !!freeText&&(opState.unitInFreeTextBlocked||[]).includes(widget);
 }
 function opUnitPadHtml(x,widget){
  const at=opUnitPlaceOf(x),blocked=opUnitInBlocked(widget,!!x.freeText);
  const cell=v=>{
   if(!v)return '<i class="op-upad-gap" aria-hidden="true"></i>';
   const off=v==='内部'&&blocked;
   return `<button type="button" data-op-unitplace="${esc(v)}"`
    +` class="op-upad-cell${at===v?' is-on':''}"${off?' disabled':''}`
    +` title="${esc(v)}${off?'（この選ばせ方では重ねられません）':''}">`
    +`<span>${esc(v==='内部'?'内部':v.slice(2))}</span></button>`;
  };
  return `<span class="op-upad">${OP_UNIT_CELLS.map(r=>r.map(cell).join('')).join('')}</span>`
   +`<button type="button" data-op-unitplace="出さない"`
   +` class="op-toggle${at==='出さない'?' is-on':''}">単位を出さない</button>`;
 }
 function opLookRowHtml(x,widget){
  const at=opUnitPlaceOf(x);
  const align=opState.aligns.includes(x.align)?x.align:'自動';
  const fmt=opState.valueFormats.includes(x.valueFormat)?x.valueFormat:'そのまま';
  const blocked=at==='内部'&&opUnitInBlocked(widget,!!x.freeText);
  const zero=fmt==='ゼロ埋め';
  return `<div class="op-form-row"><span class="op-form-label">見せ方</span>
    <span class="op-form-ctl op-look">
     <label class="op-look-unit">単位<input type="text" id="opdUnit" value="${esc(x.unit||'')}"
       placeholder="mm など"></label>
     <span class="op-look-pad">${opUnitPadHtml(x,widget)}</span>
     <span class="op-look-line"><b>値の寄せ</b>${opState.aligns.map(a=>
       `<button type="button" data-op-align="${esc(a)}" class="op-mini${align===a?' is-on':''}">${esc(a)}</button>`).join('')}</span>
     ${opIsOutput(x)?`<span class="op-look-line"><b>値の見せ方</b>
      <i class="op-form-note">この欄は<b>画面が値を入れます</b>。整えるのは「欄を離れたとき」なので、
       離れる瞬間の無いこの欄には効きません——<b>単位・寄せ・意匠は効きます</b>。</i></span>`
      :`<span class="op-look-line"><b>値の見せ方</b>${opState.valueFormats.map(f=>
       `<button type="button" data-op-vfmt="${esc(f)}" class="op-mini${fmt===f?' is-on':''}">${esc(f)}</button>`).join('')}
      <label class="op-look-digits${zero?'':' is-off'}">桁数<input type="number" id="opdDigits" min="1" max="12"
        value="${x.digits==null?'':esc(x.digits)}"${zero?'':' disabled'}></label></span>`}
     <i class="op-form-note">${
       !x.unit?'単位が空のあいだは、どこにも出ません。'
       :blocked?`<b>この選ばせ方では欄の中に重ねられません</b>——${
          opUnitInBlocked(widget)?'箱が1つではないためです'
          :'手打ちを許すと、選ぶ欄が打ち込む欄に入れ替わるためです'}。<b>外下左</b>として出します。`
       :`いま「${esc(at)}」に出ます。`}${
       zero?'　ゼロ埋めは<b>桁数まで左を0で埋めます</b>（4桁なら 12 → 0012）。':''}${
       fmt==='3桁区切り'?'　3桁区切りは<b>見せ方だけ</b>で、記録には区切りの無い値が入ります。':''}
      <br>整えるのは<b>欄を離れたとき</b>だけです（打っている最中は当てません——カーソルが飛ぶため）。</i>
    </span></div>`;
 }
 /* ---------- 仕掛由来の添え書き（§9.233 ⑤、利用者の指示） ----------
    「仕掛データから読んで、自動で選択してくれる機能がありますが…不自然な
     改行なども入り込み表示のバランスを崩します。こういった自動の連携内容の
     補助的な説明文字のONOFFができるように、もっとコンパクトにかつ位置も
     選べるようにしてほしいです」

    **添え書きを持つ項目にだけ出す**（`sourceNoteKeys`。サーバーが答える
    ——どの欄が仕掛から値を引くかは、引いている側しか知らない）。
    持たない項目に空の欄を並べると、押しても何も起きない設定が増える（§4）。 */
 function opSourceNoteRowHtml(x){
  const keys=opState.sourceNoteKeys||[];
  if(!x.builtin||keys.indexOf(x.builtin)<0)return '';
  const places=opState.sourceNotePlaces||['欄の下','名前の横','出さない'];
  const at=places.includes(x.sourceNote)?x.sourceNote:places[0];
  return `<div class="op-form-row"><span class="op-form-label">出どころの添え書き</span>
    <span class="op-form-ctl">
     <span class="op-look-line">${places.map(v=>
       `<button type="button" data-op-srcnote="${esc(v)}" class="op-mini${at===v?' is-on':''}">${esc(v)}</button>`).join('')}</span>
     <i class="op-form-note">この欄は<b>仕掛データから初期値を選びます</b>。
      そのとき「<b>仕掛 508</b>」のような短い添え書きを出します（選び直すと消えます）。
      いまは<b>${esc(at)}</b>に出ます。${at==='出さない'
        ?'　出どころは入力欄の<b>ツールチップ</b>に残ります。'
        :'　折り返さないので、入らないときは末尾を省略します——全文はツールチップで読めます。'}</i>
    </span></div>`;
 }
 function opChoiceValues(name){
  return (opState.choices||[]).filter(c=>c.name===name).map(c=>c.value);
 }
 function opChoiceValuesHtml(x){
  const vals=(opState.choices||[]).filter(c=>c.name===x.choice);
  if(!x.choice)return `<p class="op-form-empty">選択肢のまとまりを選ぶか、名前を打って新しく作ります。</p>`;
  if(!vals.length)return `<p class="op-form-empty">「${esc(x.choice)}」にはまだ値がありません。下で足せます。</p>`;
  return `<div class="op-choice-rows">`+vals.map(c=>
    `<div class="op-choice-row" data-op-cid="${esc(c.id)}">`
    +`<b>${esc(c.value)}</b>`
    +`<input type="text" data-op-cnote="${esc(c.id)}" value="${esc(c.note||'')}"`
    +` placeholder="説明（一覧から選ぶときに出ます）">`
    +`<button type="button" class="ghost" data-op-cdel="${esc(c.id)}" title="この値を消します">×</button>`
    +`</div>`).join('')+`</div>`;
 }
 /* ---------- 決めることは3つの塊。**段（タブ）は廃止**（§9.299） ----------
    利用者の指示「3分割の3段構成になっているが、最下段のエリアは死んでいる…
    メインコンテンツである部分は広いエリアをしっかり使って…スクロールレス
    設計をベースに…必要な項目を最小限の手数でチェック、選択でき」

    §9.223 ②では段（タブ）で1つずつ見せていたが、実測すると窓は1920×1080で
    **本体の下に450pxの空白**が残っていた——広い窓を持ちながら1/3しか使って
    いない。塊は**横に並べる**（面積は頻度×重要度・§CLAUDE 1）。手数も
    3クリック→0になる。並びは**実際に決める順**（§14）。
    **④メモは塊にしない**——覚え書き1つのために列を1本使うのは面積の
    配り方として合わない（①の末尾へ小さく置く）。 */
 const OP_SECS=[{k:'place',n:'① どこに出すか',t:'カード・幅・群・出し方'},
                {k:'data', n:'② 何を記録するか',t:'型・役割・選択肢・初期値'},
                {k:'look', n:'③ どう見せるか',t:'選ばせ方・意匠・単位'}];
 /* **空きのカードは決めることが少ない**（§9.230 ③）。②何を記録するか・
    ③どう見せるかは中身を持たない空きには効かないので、列ごと出さない
    ——押しても何も無い列を並べない（§4）。 */
 function opSecsFor(x){
  return (x&&x.dummy)?OP_SECS.filter(o=>o.k==='place'):OP_SECS;
 }
 /* ---------- 役割（§9.223 ①、利用者の指示） ----------
    「データの設計上必須な部分は、全体の構成上の必須項目として押さえておき、
     各カード単位では自由度を持っておきたいです。」
    **担っている役割は1箇所が答える**（サーバーの`role_of()`と同じ読み方）。
    保存値が空でも、組み込みの欄は組み込みキーが役割になる。 */
 function opRoleOf(x){
  const r=String((x&&x.role)||'').trim();
  if(r)return r;
  const b=String((x&&x.builtin)||'').trim();
  return (opState.roles||[]).some(o=>o.key===b)?b:'';
 }
 /* その役割をいま担っている他の項目（付け替えると入れ替わることを言う）。 */
 function opRoleHolder(key,exceptId){
  return (opState.items||[]).find(i=>String(i.id)!==String(exceptId)
    &&i.enabled!==false&&opRoleOf(i)===key);
 }
 function opRolePickHtml(x){
  const cur=opRoleOf(x);
  const list=opState.roles||[];
  if(!list.length)return '<i class="op-form-note">役割の一覧を読み込んでいます…</i>';
  const other=cur?opRoleHolder(cur,x.id):null;
  return `<select id="opdRole">`
   +`<option value=""${cur?'':' selected'}>（役割なし・ただの記録項目）</option>`
   /* **いま自分が担っている役割にも「担当」と書く**（§9.229 ⑥、利用者の
      指摘「古いままの名称でリンクされています」）。`opRoleHolder`は自分を
      除いて探すので、自分の役割の行だけ**何も添え書きが付かず**、
      役割の名前（`コイル止め`）だけが残っていた——項目名を変えた人からは
      「変えたのに古い名前でつながっている」としか読めない。
      **役割の名前は変えない**（値を何として読むかの語彙で、項目名とは別）
      ので、代わりに**いまの項目名を必ず並べて出す**。 */
   +list.map(r=>{
      const holder=opRoleHolder(r.key,x.id);
      const mine=(cur===r.key);
      const tail=mine?`　※この欄（${x.name}）が担当`
                : holder?`　※いまは「${holder.name}」が担当`:'';
      return `<option value="${esc(r.key)}"${mine?' selected':''}>`
       +`${esc(r.label)}${r.required?'（必須）':''}${esc(tail)}</option>`;
     }).join('')
   +`</select>`
   +`<i class="op-form-note">${cur
      ?`この欄（<b>${esc(x.name)}</b>）の値は`
        +`<b>${esc((list.find(r=>r.key===cur)||{}).label||cur)}</b>として読まれます`
        +`——<b>役割の名前は項目名とは別</b>で、項目名を変えても役割の名前は変わりません。`
        +esc((list.find(r=>r.key===cur)||{}).note||'')
        +(other?`　<b>「${esc(other.name)}」も同じ役割</b>を持っています——どちらの値が使われるか決まらないので、片方を外してください。`:'')
      :'役割を付けると、その値をアプリが決まった用途で読みます。'
        +'<b>必須は項目ではなく構成に掛かる</b>ので、必要な役割さえ誰かが担っていれば、'
        +'どのカードが担ってもかまいません。'}</i>`;
 }
 /* ---------- 意匠（§9.223 ③、利用者の指示） ----------
    「UIの種類と見た目(色や形、美観デザイン)など組合せでカスタムできるように」
    **軸は3つ**（色・形・大きさ）。掛け算で「種類」を増やさないための分け方
    なので、ここへ4つ目を足さないこと。 */
 /* 形の廃止値は今の呼び名へ寄せる（§9.227 ①）。サーバーも同じ寄せ方を
    するが、**盤は保存前の値も描く**ので画面側にも要る（`角`のまま来た行を
    「どれも選ばれていない」状態で出さない）。 */
 const OP_SHAPE_ALIAS={'角丸':'標準','角':'控えめ','丸':'大きめ'};
 function opLookOf(x){
  const d=(x&&x.look)||{};
  const sh=OP_SHAPE_ALIAS[d.shape]||d.shape||'標準';
  return {color:d.color||'既定',shape:sh,size:d.size||'中'};
 }
 /* ---------- 空欄（選ばない）の札（§9.228 ④、利用者の指示） ----------
    「トグルやラジオボタンなどありますが、**非選択状態の表示が大きい**ので
     それをなしにしたり初期値設定したりできるようにしたい」

    選択肢を持つ形では「—」（選ばない）が**1枚ぶんの場所を取る**。出さない
    ようにできれば、その幅がまるごと空く。**初期値と対で使う**ものなので、
    ここから初期値も直せるようにしておく（②のタブまで探しに行かせない）。
    選択肢を持たない型では**欄ごと出さない**が、§9.227 ②のとおり
    **場所は空けておく**（消すと下の行が動く）。 */
 /* **「選択肢を持つか」は族（family）で見る**（§9.229 ③、利用者の指示
    「コイル止めに関して、名前も設定項目も変えられません。汎用設計にして
     いるつもりなので…」）。以前は`[型]`だけを見ていたので、**組み込みの
    選択欄が全部すり抜けた**——コイル止めの`[型]`は`文字`で、まとまり
    （`[選択肢名]`）はちゃんと結んであるのに、選択肢・初期値・空欄の札・
    手打ちの欄が1つも出なかった。`opFamilyOf()`は組み込みキーから族を引く
    ので、こちらが唯一の判定。 */
 function opIsChoiceLike(x){return opFamilyOf(x)==='choice'}
 function opBlankRowHtml(x,widget){
  const choice=opIsChoiceLike(x);
  if(!choice){
   return `<div class="op-form-row is-fixed-layout"><span class="op-form-label">空欄の札</span>
    <span class="op-form-ctl"><i class="op-form-note">この型にはありません。</i></span></div>`;
  }
  const off=!!x.noBlank;
  return `<div class="op-form-row is-fixed-layout"><span class="op-form-label">空欄の札</span>
    <span class="op-form-ctl">
     <span class="op-look-row">
      <button type="button" data-op-blank="0" class="op-mini${off?'':' is-on'}">出す</button>
      <button type="button" data-op-blank="1" class="op-mini${off?' is-on':''}">出さない</button>
     </span>
     <i class="op-form-note">初期値は<b>${x.initial?`「${esc(x.initial)}」`:'未設定'}</b>。${
       off&&!x.initial?'<b class="op-warn-chip">初期値を決めてください</b>':''}</i>
    </span></div>`;
 }
 /* ---------- 選択肢の並び（§9.248 ⑤、利用者の指示） ----------
    「プルダウンリストなど、**新しい表示領域を作って表示するタイプのUI**に
     ついては、余白に余裕がある方なので、選択肢の使用回数に応じて選択肢の
     並び順を変えることができる機能を実装してほしいです。」

    **効くのは「押すと新しい面が開く」形だけ**——札を並べる形（ラジオ・
    セグメント・ボタン群…）で順番が変わると、**同じ欄なのに押す場所が
    毎回動く**（手が場所を覚えられない）。効かない形では押せなくして
    理由を書く（§4）。**どの形で効くかはサーバーが答える**（§9.163）。 */
 /* ---------- 未入力・未選択の配色（§9.286 ⑥、利用者の指示） ----------
    「未入力・未選択の場合にオレンジ色の着色をするというものも汎用設計前の
     ものなので、この機能も未選択、未入力の場合、配色するという機能を実装
     してください。選択肢やこの背景色の選択で使う色のパレットの種類をさらに
     増やしてほしいです」

    **語彙も色の呼び名もサーバー／`WL.columnTint`が答える**（§9.163）
    ——画面へ書き写すと、色を1つ足したときに2箇所直すことになる。
    **色だけで伝えない**（§3）ので、札には呼び名と意味を文字で出す。 */
 function opBlankTintRowHtml(x){
  const now=String(x.blankTint||'');
  const none=opState.blankTintNone||'なし';
  const tint=(window.WL&&WL.columnTint)||null;
  const keys=(opState.blankTints||[]).filter(k=>k&&k!==none);
  const chip=(k,label,note,on)=>`<button type="button" data-op-btint="${esc(k)}"`
    +` class="op-mini op-btint${on?' is-on':''}"`
    +(k&&tint?` style="--btint:${tint.PALETTE[k]?tint.PALETTE[k].bg:'transparent'};`
              +`--btint-line:${tint.PALETTE[k]?tint.PALETTE[k].line:'transparent'}"`:'')
    +` title="${esc(note||'')}">${esc(label)}</button>`;
  return `<div class="op-form-row is-fixed-layout"><span class="op-form-label">未入力の色</span>
    <span class="op-form-ctl">
     <span class="op-look-row op-btint-row">
      ${chip('','既定','必須の欄だけ橙になります（今までどおり）',!now)}
      ${chip(none,'なし','空でも色を付けません',now===none)}
      ${keys.map(k=>chip(k,(tint?tint.label(k):k),
         (tint?tint.label(k)+'：'+tint.note(k):k),now===k)).join('')}
     </span>
     <i class="op-form-note">${now&&now!==none
       ?`空のあいだ<b>${esc(tint?tint.label(now):now)}</b>で塗ります。`
       :now===none?'空でも色を付けません。'
       :'<b>必須</b>の欄だけ橙になります。'}</i>
    </span></div>`;
 }
 function opChoiceOrderRowHtml(x,widget){
  if(!opIsChoiceLike(x))return '';
  const usable=(opState.choiceOrderWidgets||[]).includes(widget);
  const now=String(x.choiceOrder||'');
  const used=(opState.choices||[]).filter(c=>c.name===x.choice)
    .reduce((n,c)=>n+(Number(c.used)||0),0);
  return `<div class="op-form-row is-fixed-layout"><span class="op-form-label">選択肢の並び</span>
    <span class="op-form-ctl">
     <span class="op-look-row">
      <button type="button" data-op-corder="" class="op-mini${now?'':' is-on'}"${usable?'':' disabled'}>登録順</button>
      <button type="button" data-op-corder="よく使う順" class="op-mini${now?' is-on':''}"${usable?'':' disabled'}>よく使う順</button>
     </span>
     <i class="op-form-note">${usable
       ?(now?`よく使う順（合計 <b>${used}回</b>）`:'マスタの表示順のまま')
       :`「${esc(widget)}」では使えません${now?'（設定は残してあります）':''}`}</i>
    </span></div>`;
 }
 function opLookPickHtml(x){
  const lk=opLookOf(x);
  const swatch=c=>`<button type="button" data-op-look="color" data-op-val="${esc(c)}"`
   +` class="op-look-swatch op-look-${esc(c)}${lk.color===c?' is-on':''}"`
   +` title="${esc(OP_LOOK_NOTE[c]||c)}" aria-pressed="${lk.color===c?'true':'false'}">`
   +`<i aria-hidden="true"></i><span>${esc(c)}</span></button>`;
  const pick=(axis,list,cur)=>list.map(v=>
    `<button type="button" data-op-look="${esc(axis)}" data-op-val="${esc(v)}"`
    +` class="op-look-btn${cur===v?' is-on':''}" aria-pressed="${cur===v?'true':'false'}">${esc(v)}</button>`).join('');
  return `<div class="op-form-row"><span class="op-form-label">色</span>
    <span class="op-form-ctl"><span class="op-look-swatches">${(opState.lookColors||[]).map(swatch).join('')}</span>
     <i class="op-form-note">${esc(OP_LOOK_NOTE[lk.color]||'')}
      　色が語るのは「どの仲間か」だけです——<b>選んだかどうかは面と文字の太さでも</b>示すので、
      色が見えない人にも伝わります。</i></span></div>
   <div class="op-form-row"><span class="op-form-label">形</span>
    <span class="op-form-ctl"><span class="op-look-row">${pick('shape',opState.lookShapes||[],lk.shape)}</span>
     <i class="op-form-note"><b>どれも角丸</b>です——変わるのは丸みの深さだけ。
      素のテキストボックスやプルダウンと同じ形にそろえてあるので、
      1枚のカードに何種類の選ばせ方を混ぜても角の丸みは1通りに見えます。</i></span></div>
   <div class="op-form-row"><span class="op-form-label">大きさ</span>
    <span class="op-form-ctl"><span class="op-look-row">${pick('size',opState.lookSizes||[],lk.size)}</span>
     <i class="op-form-note">文字の大きさから作るので、表示サイズを変えても崩れません。</i></span></div>`;
 }
 /* ---------- 並べ方（§9.226 ①、利用者の指示「同じUIでもいくつかパターンが
    あるとよい」） ----------
    **効く形でだけ出す**（§4）。並べる先が1つしかない形（プルダウン・一覧・
    メモ・キーパッド…）では欄ごと出さず、なぜ出ないのかを1行で書く。
    効く形の一覧は**サーバーが答える**（`layoutWidgets`）——画面に規則を
    書き写すと、形を1つ足したときに片方だけ直った状態が作れる。 */
 function opLayoutUsable(w){return (opState.layoutWidgets||[]).includes(w)}
 function opLayoutOf(x){
  const v=String(x.layout||'自動');
  return (opState.layouts||['自動']).includes(v)?v:'自動';
 }
 function opLayoutRowHtml(x,widget){
  const on=opLayoutOf(x);
  const usable=opLayoutUsable(widget);
  /* **行の高さを予約する**（§9.227 ②、利用者の指摘「選ばせ方を選択すると
     表示位置が変化する」）。ボタンが出る形と出ない形で行の高さが32pxと
     62pxに分かれ、下の「色・形・大きさ・見せ方」が**まるごと30px上下して
     いた**（実測）。ボタンを消すのは§4のとおり（押しても何も起きない物を
     残さない）なので、**消すのは中身だけで場所は空けておく**。 */
  if(!usable){
   return `<div class="op-form-row is-fixed-layout"><span class="op-form-label">並べ方</span>
    <span class="op-form-ctl"><i class="op-form-note">「${esc(opWidgetLabel(x,widget))}」では選べません。</i></span></div>`;
  }
  return `<div class="op-form-row is-fixed-layout"><span class="op-form-label">並べ方</span>
    <span class="op-form-ctl">
     <span class="op-look-row">${(opState.layouts||[]).map(v=>
       `<button type="button" data-op-layout="${esc(v)}" class="op-mini${on===v?' is-on':''}"`
       +` title="${esc(OP_LAYOUT_NOTE[v]||'')}">${esc(v)}</button>`).join('')}</span>
     <i class="op-form-note">${esc(OP_LAYOUT_NOTE[on]||'')}。</i>
    </span></div>`;
 }
 /* ---------- 選ばせ方の見本（§9.223 ③、利用者の指示） ----------
    「UIの見た目もわかりやすいようにサンプルを表示させ、データも入れて
     選びやすいようにしてください。」
    タイルの中に**実際の値を入れた小さな絵**を描く。押す前にどうなるかが
    見えないと、名前だけで選ぶことになる（§2「探させない」）。
    **本物の部品ではなく絵**——12個ぶんの本物を作ると重いので、形の違いが
    分かる最小の絵にして、本物は左の見本1枚で確かめてもらう。 */
 function opDemoValues(x){
  const fam=opFamilyOf(x);
  if(fam==='choice'){
   const vs=opChoiceValues(x.choice).filter(Boolean).slice(0,3);
   return vs.length?vs:['甲','乙','丙'];
  }
  if(fam==='number'){
   const lo=x.min==null?1:Number(x.min);
   const st=Number(x.step)||1;
   return [lo,lo+st,lo+st*2].map(v=>String(Number.isInteger(v)?v:v.toFixed(1)));
  }
  return ['記入'];
 }
 function opWidgetDemoHtml(x,w){
  const vs=opDemoValues(x);
  const on=v=>`<i class="opd-on">${esc(v)}</i>`,off=v=>`<i>${esc(v)}</i>`;
  const row=cls=>`<span class="opd ${cls}">${on(vs[0])}${vs.slice(1).map(off).join('')}</span>`;
  if(w==='プルダウン')return `<span class="opd opd-select">${esc(vs[0])}<b>▾</b></span>`;
  if(w==='ラジオ')return `<span class="opd opd-radio"><i class="opd-on"><b></b>${esc(vs[0])}</i>`
   +vs.slice(1,3).map(v=>`<i><b></b>${esc(v)}</i>`).join('')+`</span>`;
  if(w==='セグメント')return row('opd-seg');
  if(w==='タブ')return row('opd-tabs');
  if(w==='ボタン群')return row('opd-chips');
  if(w==='カード')return `<span class="opd opd-cards"><i class="opd-on">${esc(vs[0])}<u>説明</u></i>`
   +`<i>${esc(vs[1]||'')}<u>説明</u></i></span>`;
  /* §9.247 ①でトグルは「割れ枠」へ作り直した。**見本の絵も一緒に直すこと**
     ——実物と食い違うと、設定画面で確かめた意味が無い（§9.229 ②）。 */
  if(w==='トグル')return `<span class="opd opd-toggle"><i class="opd-on">${esc(vs[0])}</i><i>${esc(vs[1]||'—')}</i></span>`;
  if(w==='一覧')return `<span class="opd opd-pick">${esc(vs[0])}<b>☰</b></span>`;
  /* §9.248 ①で足した2つ。**絵でも違いが読めること**——`パネル`は札が並んだ
     窓、`スピナー`は欄の右端の上下矢印。名前だけで選ばせない。 */
  if(w==='パネル')return `<span class="opd opd-panel"><u>${esc(vs[0])}<b>▦</b></u>`
   +`<em><i class="opd-on">${esc(vs[0])}</i><i>${esc(vs[1]||'')}</i>`
   +`<i>${esc(vs[2]||'')}</i><i></i></em></span>`;
  if(w==='ステッパー')return `<span class="opd opd-step"><b>−</b><i>${esc(vs[0])}</i><b>＋</b></span>`;
  if(w==='スピナー')return `<span class="opd opd-spin"><i>${esc(vs[0])}</i>`
   +`<u><b>▲</b><b>▼</b></u></span>`;
  if(w==='スライダー')return `<span class="opd opd-range"><u></u><b></b></span>`;
  if(w==='キーパッド')return `<span class="opd opd-pad"><b>7</b><b>8</b><b>9</b></span>`;
  if(w==='早見ボタン')return row('opd-chips');
  if(w==='メモ')return `<span class="opd opd-memo"><u></u><u></u><u></u></span>`;
  if(w==='1行')return `<span class="opd opd-oneline"><u></u></span>`;
  /* §9.226 ①で足した4つ。**絵でも違いが分かること**——名前だけで選ばせない。 */
  if(w==='段階')return `<span class="opd opd-stage"><i class="opd-fill">${esc(vs[0])}</i>`
   +`<i class="opd-on">${esc(vs[1]||'')}</i><i>${esc(vs[2]||'')}</i></span>`;
  if(w==='入切')return `<span class="opd opd-switch"><b></b><i>${esc(vs[0])}</i></span>`;
  /* §9.247 ①で足した2つ。**絵でも違いが分かること**——`メニュー`は欄の下に
     浮いた札、`切替`は回る印つきの1つのボタン。名前だけで選ばせない。 */
  if(w==='メニュー')return `<span class="opd opd-menu"><u>${esc(vs[0])}<b>▾</b></u>`
   +`<em><i class="opd-on">${esc(vs[0])}</i><i>${esc(vs[1]||'')}</i></em></span>`;
  if(w==='切替')return `<span class="opd opd-cycle"><b>↻</b><i class="opd-on">${esc(vs[0])}</i>`
   +`<u>1/${vs.length}</u></span>`;
  if(w==='メーター')return `<span class="opd opd-meter"><u></u></span>`;
  if(w==='定型文')return `<span class="opd opd-phrase"><u></u><i>${esc(vs[0])}</i><i>${esc(vs[1]||'')}</i></span>`;
  /* §9.233 ①。自動で入る値の2つ。**絵でも違いが分かること**——「枠が
     あるか」「色が付くか」が一目で読めないと、名前だけで選ばせることになる。 */
  if(w==='文字だけ')return `<span class="opd opd-bare">123.4</span>`;
  if(w==='強調')return `<span class="opd opd-strong">123.4</span>`;
  /* §9.288 ③で足した3つ。**絵でも違いが分かること**——`索引`は窓の上に
     頭文字の帯（`パネル`との違いはそこ）、`ダイヤル`は前後が薄く見える3行、
     `サジェスト`は打った文字の下に垂れる候補。 */
  if(w==='索引')return `<span class="opd opd-index"><u>${esc(vs[0])}<b>あ</b></u>`
   +`<em class="opd-index-rail"><b>あ</b><b>か</b><b>さ</b></em>`
   +`<em><i class="opd-on">${esc(vs[0])}</i><i>${esc(vs[1]||'')}</i></em></span>`;
  if(w==='ダイヤル')return `<span class="opd opd-dial"><b>▲</b>`
   +`<u>${esc(vs[1]||'')}</u><i class="opd-on">${esc(vs[0])}</i><u>${esc(vs[2]||'')}</u>`
   +`<b>▼</b></span>`;
  if(w==='サジェスト')return `<span class="opd opd-sug"><u>${esc(String(vs[0]).slice(0,1))}</u>`
   +`<em><i class="opd-on">${esc(vs[0])}</i><i>${esc(vs[1]||'')}</i></em></span>`;
  return '';
 }
 /* ---------- 選ばせ方の盤は「まとまり」で束ねる（§9.248 ①、利用者の指示） ----------
    「UIの選択自体もUIでもう少しグルーピングや階層を持たせて似たようなものを
     まとめわかりやすく選びやすく配置してほしいです。」

    24種を平らに並べると、選ぶこと自体が「探す」作業になる（§2）。
    **まとまりと並びはサーバーが持つ**（`operation_repo.WIDGET_GROUPS`）
    ——画面へ写すと、種類を足したときに2箇所直すことになる（§9.163）。
    **その型で選べないものは出さない**（今までどおり`opWidgetsFor`で絞る）ので、
    数値の欄には「並べて見せる」の群がそもそも出ない——空の見出しを残さない（§4）。
    **見出しには件数と一言**を添える（何のまとまりかを推測させない・§6）。
    **いま選んでいるものがどの群かを見出しでも言う**——畳んでいないので
    探せば見つかるが、24枚の中から自分の選択を目で探すのは「探させる」こと。 */
 function opWidgetPickerHtml(x,widget,usable){
  const usableList=opWidgetsFor(x);
  const groups=(opState.widgetGroups||[]).map(g=>({
    label:g.label,note:g.note,items:(g.items||[]).filter(w=>usableList.includes(w))}))
   .filter(g=>g.items.length);
  /* **まとまりに載っていないものは最後へ**（載せ忘れても盤から消えない・§4）。 */
  const seen=new Set(groups.flatMap(g=>g.items));
  const rest=usableList.filter(w=>!seen.has(w));
  if(rest.length)groups.push({label:'その他',note:'',items:rest});
  const tile=w=>`<button type="button" data-op-widget="${esc(w)}"`
    +` class="op-widget-tile${widget===w?' is-on':''}"${usable?'':' disabled'}>`
    +`<b class="op-widget-icon">${esc((OP_WIDGET_NOTE[w]||{}).icon||'')}</b>`
    +`<span class="op-widget-name">${esc(opWidgetLabel(x,w))}</span>`
    +`<span class="op-widget-demo">${opWidgetDemoHtml(x,w)}</span>`
    +`<small class="op-widget-note">${esc((OP_WIDGET_NOTE[w]||{}).note||'')}</small></button>`;
  /* まとまりが1つしか無いなら見出しを出さない（1つのものに名前を付けても
     何も分けられない——覚える手間だけが増える・§8）。 */
  if(groups.length<=1)
   return `<span class="op-widget-grid">${usableList.map(tile).join('')}</span>`;
  return `<span class="op-widget-groups">${groups.map(g=>{
    const here=g.items.includes(widget);
    return `<span class="op-widget-group${here?' is-here':''}">`
     +`<span class="op-widget-group-head">`
     +`<b>${esc(g.label)}</b><i>${g.items.length}</i>`
     +(here?'<em>いま選んでいます</em>':'')
     +(g.note?`<small>${esc(g.note)}</small>`:'')
     +`</span>`
     +`<span class="op-widget-grid">${g.items.map(tile).join('')}</span></span>`;
   }).join('')}</span>`;
 }
 function renderOpModal(){
  const m=$('#opItemModal');if(!m||m.hidden)return;
  const x=opItemById(opState.picked);
  if(!x){m.hidden=true;return}
  const isChoice=opIsChoiceLike(x);
  const usable=opWidgetUsable(x);
  const widget=opWidgetOf(x);
  const users=(opState.usage||{})[x.choice]||[];
  const groups=[...new Set(opState.items.map(i=>i.group||'その他'))];
  $('#opModalTitle').textContent=x.name;
  /* ---- 左: 実物 ---- */
  /* ---------- 出すのは「いま触っている1つ」だけ（§9.276 ⑥、利用者の指示） ----------
     「対象外で同一グループの時は単位の表示位置やUI配置がでたらめ。UIのサイズが
      バラバラで再現されていない。UIもグループすべて並べたら入りきれないサイズに
      なることも多いと思うので、変更中の対象項目だけの再現で十分」

     §9.250 ⑤では隣の欄も並べていた（1行に何個並ぶかを見るため）。ところが
     隣の欄はマスタの行から**自前で組み立て**ていたので、単位の置き場も器の
     高さも本物と揃わず、群が大きいと器に入りきらなかった——**確かめるための
     絵が、確かめられない絵になっていた**（§9.226 ①で一度踏んだのと同じ形）。
     いまは1つに絞り、そのぶんを再現度へ回す。何マスぶんの幅かは器の格子と
     `<small>`の文字が言う。 */
  const rule=[];
  if(x.required)rule.push('必須');
  if(opFamilyOf(x)==='number'){
   /* **入る形は`measure-opdata.js`の1本が言う**（§9.219 ③）——見本用に
      もう1つ書くと、設定画面で見えた形と実際の形が食い違う。 */
   const t=(window.WL&&WL.opData&&WL.opData.ruleText)?WL.opData.ruleText(opRuleDef(x)):'';
   if(t)rule.push(t);
  }else if(opFamilyOf(x)==='choice'){
   const n=(opState.choices||[]).filter(c=>c.name===x.choice).length;
   rule.push(x.builtin?'画面が持っている選択肢':(x.choice?`${esc(x.choice)}（${n}件）`:'選択肢のまとまりが未設定'));
  }else rule.push('自由記述');
  if(x.unit)rule.push(`単位 ${x.unit}`);
  const openWhen=(x.showWhen||[]).length
    ?`畳んでおき、入力内容が「${esc((x.showWhen||[]).join('」「'))}」のときに開きます`
    :((x.place||'準備')==='入力内容'
      ?'②の入力内容カードに、いつも開いた状態で出ます'
      :'①準備のカードに、いつも開いた状態で出ます');
  /* ---------- 見本は実物と同じ大きさで出す（§9.226 ①、利用者の指摘
     「再現する部分の表示エリアの横幅が足りず、見切れています」） ----------
     以前は器の幅を12で割っていたので、1マスが実物の6割ほどになっていた
     （実測 実物94px / 見本56px）。**文字は縮まない**ので、実物では入る
     選択肢が見本では折り返し、逆に見本で入るものが実物で見切れる——
     確かめるための絵が、確かめられない絵になっていた。
     いまは`measure-opdata.js`が**この端末の測定画面で実測した1マス**を
     覚えており（`WL.opData.cellPx()`）、それをそのまま使う。入りきらない
     ときは横へ流す（縮めない——縮めたら同じ問題に戻る）。 */
  const cell=(window.WL&&WL.opData&&WL.opData.cellPx)?WL.opData.cellPx():94;
  /* **見切れさせない**（§9.227 ②、利用者の指摘「見切れているし、その
     サイズの変化に合わせて右側の選択パネルの並びや位置が変化する」）。
     実測すると、12マス（1234px）を779pxの器へ入れていたので**455pxが
     切れていた**。実物と同じ1マスは守りたい（§9.226 ①。縮めると文字は
     縮まないので「入るかどうか」が確かめられない）ので、**入るマス数まで
     しか描かない**——そして**何マスぶんを出しているかを文字で言う**
     （黙って減らすと、12マスの器を見ているつもりで狭い器を見ることになる）。
     この項目自身の幅より狭くはしない（主役が切れるのでは本末転倒）。 */
  /* **測るのは見本が使える幅**（§9.299）。帯にしたので、器（`#opModalPreview`）の
     幅には「見え方」の文字と「記録される値」も入っている——器の幅で数えると、
     入らないマス数まで描いて見本が切れる。 */
  const paneW=(($('.op-prev-scroll')||$('#opModalPreview')||{}).clientWidth)||0;
  const span=opSpanOf(x);
  const gap=6,pad=14;                       /* --gap-inline / --pad-row ぶん */
  const fits=Math.max(1,Math.floor((paneW-pad+gap)/(cell+gap)));
  const cols=Math.min(opState.gridCols,Math.max(span,fits));
  /* ---------- 見本は「実物」だけ。素性はポップオーバーへ（§9.288 ④） ----------
     利用者の指示「左側のエリアは死にエリアになっています。左側で有益なのは
     実際の見た目のプレビューくらいでそれ以外はほぼ役に立っていません。」

     以前はここに「入力の決まり／出るとき／記録の鍵」の3行と、組み込みの欄の
     長い散文が**常に**並んでいた。どれも**1回読めば足りる**説明なのに、
     画面のいちばん広い場所を毎回占めていた（面積は頻度×重要度・§CLAUDE 1）。
     **消さずに畳む**（§9.234 ①）——`?`を押すと出る。 */
  const facts='<ul class="op-prev-facts">'
   +`<li><b>入力の決まり</b>${esc(rule.join('／'))}</li>`
   +`<li><b>出るとき</b>${openWhen}</li>`
   +`<li><b>記録の鍵</b>${x.builtin?'画面がもともと持っている置き場（測定データの中）'
       :`測定データの <code>settings.opData.${esc(x.name)}</code>`}</li>`
   +'</ul>'
   +`<p class="op-prev-note">${x.builtin
      ?'この欄は画面がもともと持っています（内径のプリセット・条数の上限など、それぞれの仕掛けがあるため）。'
       +'それ以外は<b>自由項目と同じように</b>決められます——名前・選択肢のまとまり・初期値・手打ち・単位・並び・群・幅・必須・出す/出さない・置き場・選ばせ方・意匠。'
       +'<b>変えられないのは型だけ</b>で、行そのものも消せません（②の「この項目」に外し方があります）。'
      :'記録は<b>項目名を鍵</b>にして測定データへ入ります。名前を変えると、それまでの記録は前の名前のまま残ります。'}</p>`;
  /* ---------- 見本は「1/3の帯」（§9.299、利用者の指示） ----------
     「サンプルは今の3分の1くらいで十分」。出しているのは**1つの欄**なので、
     縦に積むと空白にしかならない——**横1本の帯**にして、余った縦は本体
     （決めること）へ回す（面積は頻度×重要度・§CLAUDE 1）。
     マスの内訳・入力の決まり・記録の鍵は`?`の浮き出しへ畳む（§9.234 ①）。
     **群の帯は出さない**——同じ値が①の「群」の欄に出ている（§CLAUDE 8）。 */
  $('#opModalPreview').innerHTML=`<div class="op-prev-head"><b>見え方</b>`
   +`<small>${esc(x.place||'準備')}・${esc(opSpanLabel(span))}`
   +(cols<opState.gridCols?`／${cols}マスぶん`:'')+`</small>`
   +`<button type="button" class="op-prev-info" id="opPrevInfoBtn" aria-haspopup="true"`
   +` aria-expanded="false" title="この項目の素性（入力の決まり・出るとき・記録の鍵）">?</button></div>`
   +`<div class="op-prev-scroll"><div class="op-prev-card"`
   +` style="--op-cols:${cols};--op-cell:${cell}px">`
   +`<div class="op-prev-field" id="opPrevField" style="grid-column:span ${span}"></div>`
   /* **残りのマスは空けておく**（§9.276 ⑥）——ここへ隣の欄を並べると、
      本物と揃わない絵で幅を判断することになる。格子だけを見せる。 */
   +`</div></div>`
   +`<span class="op-prev-value" id="opPrevValue"></span>`;
  opBindPrevInfo(facts);
  opRenderPreviewField(x,widget,usable);
  /* ---- 右: 決めること ---- */
  const seg=(name,list,cur,attr,noteOf)=>`<span class="op-seg" role="group" aria-label="${esc(name)}">`
   +list.map(v=>`<button type="button" ${attr}="${esc(v)}" class="${String(cur)===String(v)?'is-on':''}"`
     +(noteOf&&noteOf(v)?` title="${esc(noteOf(v))}"`:'')+`>${esc(v)}</button>`).join('')+`</span>`;
  /* ---------- 決めることは4つの塊に分ける（§9.222 ⑦、利用者の指示） ----------
     「操業データ項目のUIが使いにくいので修正して下さい」。並んでいる14行は
     どれも同じ見た目・同じ重みで、行ごとに長い注釈が付いていた——**14個の
     決めごとを平らに並べると、どこから手を付ければよいのか分からない**
     （§CLAUDE 画面基準2「次にすることを常に1つだけ指す」）。
     並びは**実際に決める順**（§14。①どこに出すか→②何を記録するか→
     ③どう見せるか→④メモ）。塊の見出しに1行の要約を添えて、開く前に
     何を決める場所かが読めるようにする。 */
  /* 塊は**列**（§9.299）。見出しに`?`を付け、**長い説明はそこへ畳む**
     （§9.234 ①「消さずに畳む」。利用者の指示「長ったらしい説明は抜きに
     して」——抜くのは常時見えている場所からで、読みたい人の道は残す）。 */
  const helps={};
  const help=(k,title,body)=>{(helps[k]=helps[k]||[]).push({title,body});return ''};
  const sec=(k,title,note,body)=>{
   const h=helps[k]||[];
   return `<section class="op-form-sec" data-op-sec="${esc(k)}">`
    +`<h4 class="op-form-sec-head">${esc(title)}<small>${esc(note)}</small>`
    +(h.length?opPopHtml('help-'+k,'?','くわしく',
        h.map(o=>`<p><b>${esc(o.title)}</b><br>${o.body}</p>`).join(''),
        {btnClass:'op-sec-info',popClass:'op-help-pop',plain:true}):'')
    +`</h4>${body}</section>`;
  };

  /* ---------- ① どこに出すか ---------- */
  const paneWhere=sec('place','どこに出すか','測定画面のどのカードへ、どのくらいの幅で出すか',`
   <div class="op-form-row"><span class="op-form-label">置き場</span>
    <span class="op-form-ctl">${seg('置き場',opState.places,x.place||'準備','data-op-place',
      p=>OP_PLACE_NOTE[p]||'')}</span></div>
   <div class="op-form-row"><span class="op-form-label">幅</span>
    <span class="op-form-ctl">${opSpanPickerHtml(opSpanOf(x))}</span></div>
   <div class="op-form-row"><span class="op-form-label">群</span>
    <span class="op-form-ctl"><input type="text" id="opdGroup" list="opGroupList" value="${esc(x.group||'その他')}">
     <datalist id="opGroupList">${groups.map(g=>`<option value="${esc(g)}">`).join('')}</datalist>
     <i class="op-form-note">同じ名前を付けると1つの見出しにまとまります。</i></span></div>
   <div class="op-form-row"><span class="op-form-label">出し方</span>
    <span class="op-form-ctl">
     ${x.dummy?'':`<button type="button" id="opdRequired" class="op-toggle${x.required?' is-on':''}" aria-pressed="${x.required?'true':'false'}">必須にする</button>`}
     <button type="button" id="opdEnabled" class="op-toggle${x.enabled===false?'':' is-on'}" aria-pressed="${x.enabled===false?'false':'true'}">測定画面に出す</button>
     <button type="button" id="opdFold" class="op-toggle${x.fold?' is-on':''}" aria-pressed="${x.fold?'true':'false'}">この群を畳む</button>
    </span></div>
   ${x.dummy?'':`
   <div class="op-form-row"><span class="op-form-label">確認の面</span>
    <span class="op-form-ctl">
     <button type="button" id="opdRecordShow" class="op-toggle${x.recordShow===false?'':' is-on'}" aria-pressed="${x.recordShow===false?'false':'true'}">③「記録した値」に出す</button>
    </span></div>`}
   ${x.dummy?'':help('place','「確認の面」は何を決めるか',
     '<p>測定画面の3枚目「確認して完了」の<b>記録した値</b>のカードへ、この項目を出すか'
     +'どうかです。<b>群と並びはこの項目の設定がそのまま使われます</b>'
     +'（カード用の並びを別に持ちません）。</p>')}
   ${x.dummy?`
   <div class="op-form-row is-danger"><span class="op-form-label">この空き</span>
    <span class="op-form-ctl">
     <button type="button" id="opdPadOff" class="ghost">ふつうの項目へ戻す</button>
     <button type="button" id="opdDelete" class="danger ghost">この空きを削除</button>
    </span></div>`:''}
   ${x.dummy?help('place','空きのカードとは',
     '<p>空きは<b>幅ぶんの余白を取るだけ</b>のカードです（測定画面では見出しも枠も文字も'
     +'出しません）。名前・型・選ばせ方は持たないので、その列は出していません。</p>'):''}
   <div class="op-form-row"><span class="op-form-label">対象設備</span>
    <span class="op-form-ctl">${opEquipmentPickHtml(x)}</span></div>
   ${x.dummy?'':`
   <div class="op-form-row"><span class="op-form-label">開く条件</span>
    <span class="op-form-ctl">
     <span class="op-when">${opMeasureTypes().map(t=>
       `<button type="button" data-op-when="${esc(t)}" class="${(x.showWhen||[]).includes(t)?'is-on':''}">${esc(t)}</button>`).join('')
       ||'<i class="op-form-note">測定画面を開いていないので項目の一覧が出せません。</i>'}</span>
    </span></div>`}
   ${help('place','「畳む」と「開く条件」はどう効くか',
     '<p>「畳む」は<b>群ぜんぶ</b>に効きます。開く条件を選ぶと、その測定項目を選んだときだけ開きます'
     +'（条件なしで畳むこともできます）。</p>')}
   ${help('place','覚え書きは何のためか',
     '<p>画面には出ません。あとから触る人が「なぜこの設定なのか」を読めるようにしておくと、'
     +'同じ判断を2度しなくて済みます。</p>')}
   <div class="op-form-row is-block"><span class="op-form-label">覚え書き</span>
    <span class="op-form-ctl">
     <textarea id="opdNote" class="op-note-in" rows="4"
      placeholder="この項目を作った理由・注意点・現場での呼び方など（画面には出ません）">${esc(x.note||'')}</textarea>
    </span></div>`);
  /* ---------- ② 何を記録するか ---------- */
  const paneWhat=sec('data','何を記録するか','値の型・入る範囲・選ばせる候補・最初から入れておく値',`
   <div class="op-form-row"><span class="op-form-label">項目名</span>
    <span class="op-form-ctl"><input type="text" id="opdName" value="${esc(x.name)}"></span></div>
   ${x.autoValue?`
   <div class="op-form-row"><span class="op-form-label">自動で入る値</span>
    <span class="op-form-ctl">
     <b class="op-locked-chip">${esc(x.autoValueLabel||x.autoValue)}</b>
     ${x.autoValueGroup?`<b class="op-chip">${esc(x.autoValueGroup)}</b>`:''}
     ${x.autoValueKnown===false
       ?`<b class="op-warn-chip">この版では引けない鍵です（${esc(x.autoValue)}）——欄は空欄のままになります</b>`:''}
     <i class="op-form-note">${esc(x.autoValueNote||'')}
      値を入れるのは<b>測定画面</b>なので、型・数の決まり・選ばせ方・初期値・手打ちは持ちません。
      <b>名前・置き場・幅・単位・見せ方はふつうの項目と同じように決められます。</b>
      出どころを変えたいときは、この項目を消して足し直してください。</i>
    </span></div>
   ${opIsFormula(x)?opFormulaRowHtml(x):''}`:''}
   <div class="op-form-row"><span class="op-form-label">役割</span>
    <span class="op-form-ctl">${opRolePickHtml(x)}</span></div>
   <div class="op-form-row"><span class="op-form-label">型</span>
    <span class="op-form-ctl">${x.autoValue
      ?`<b class="op-locked-chip">値の形は出どころが決めます</b>
        <i class="op-form-note">自動で入る値なので、型で入力を縛る意味がありません（打つ欄がありません）。
        単位・寄せ・意匠（色・形・大きさ）は<b>③どう見せるか</b>で決められます。
        <b>3桁区切り・ゼロ埋めは効きません</b>——値を入れるのは画面なので、
        欄を離れたときに整える瞬間がありません。</i>`
      :x.builtin
      ?`<b class="op-locked-chip">${esc(x.type||'画面の部品で決まります')}</b>
        ${help('data','組み込みの欄の型は変えられない',
          '<p>この欄は<b>画面がもともと持っている部品</b>なので、型は変えられません。'
          +'別の型で記録したいときは、<b>新しい項目を作って同じ役割を持たせて</b>ください'
          +'——役割が移ると、この欄は測定画面から自動で下がります。</p>')}`
      :`${seg('型',opState.types,x.type,'data-op-type',t=>OP_TYPE_NOTE[t]||'')}
        <i class="op-form-note">${esc(OP_TYPE_NOTE[x.type]||'')}</i>`}</span></div>
   ${(isChoice||x.builtin||opIsOutput(x))?'':`
   <div class="op-form-row"><span class="op-form-label">数の決まり</span>
    <span class="op-form-ctl op-form-nums">
     <label>小数桁<input type="number" id="opdDecimals" min="0" max="4" value="${x.decimals==null?'':esc(x.decimals)}"></label>
     <label>最小<input type="number" id="opdMin" step="any" value="${x.min==null?'':esc(x.min)}"${x.minFrom?' disabled':''}></label>
     <label>最大<input type="number" id="opdMax" step="any" value="${x.max==null?'':esc(x.max)}"${x.maxFrom?' disabled':''}></label>
     <label title="ステッパーの−／＋1回ぶん、スライダーの目盛の幅">刻み<input type="number" id="opdStep" min="0" step="any" value="${x.step==null?'':esc(x.step)}"></label>
    </span></div>
   <div class="op-form-row"><span class="op-form-label">上下限の出どころ</span>
    <span class="op-form-ctl op-form-froms">
     ${opLimitFromHtml(x,'min')}
     ${opLimitFromHtml(x,'max')}
    </span></div>
   ${help('data','刻みを空にするとどうなるか',
     '<p>小数桁から作ります（整数=1／小数2桁=0.01）。<b>0は「決めていない」</b>として扱います'
     +'——0にすると押しても動かない道具になるためです。</p>')}
   ${help('data','マスタから引くと何が変わるか',
     '<p>「自分で決める」なら、この行に書いた数がそのまま上下限になります。'
     +'<b>マスタを選ぶと、測定画面を開いた設備のマスタから毎回引き直します</b>'
     +'——設備ごとに違う上限（最大ライン速度・最大条数）を、項目を設備の数だけ'
     +'作らずに1行で持てます。マスタを直せば入力欄の上限もその場で変わります。</p>'
     +'<p>選んだマスタに<b>値が入っていない設備では、その側の上限は掛かりません</b>'
     +'——引けなかった値を0として扱うと、何を打っても弾かれる欄になるためです。</p>')}`}
   ${isChoice?`
   <div class="op-form-row"><span class="op-form-label">選択肢</span>
    <span class="op-form-ctl">
     <span class="op-choice-pick">
      <select id="opdChoice">${['<option value="">（選んでいません）</option>']
        .concat(opState.choiceNames.map(n=>`<option value="${esc(n)}"${n===x.choice?' selected':''}>${esc(n)}</option>`))
        .concat(x.choice&&!opState.choiceNames.includes(x.choice)
          ?[`<option value="${esc(x.choice)}" selected>${esc(x.choice)}（値が未登録）</option>`]:[])
        .join('')}</select>
      <input type="text" id="opdNewChoiceName" placeholder="新しいまとまりを作る（例: リング色）">
     </span>
     ${opChoiceSuggestHtml(x)}
     ${opPopHtml('choice',`値 ${opChoiceValues(x.choice).length}件`,'選択肢の値',
       opChoiceValuesHtml(x)
       +`<span class="op-choice-add">
          <input type="text" id="opdNewChoiceValue" placeholder="値を足す（例: 茶）">
          <input type="text" id="opdNewChoiceNote" placeholder="説明（省略できます）">
          <button type="button" id="opdAddChoiceValue" class="ghost">値を足す</button>
         </span>`
       +`<i class="op-form-note">${users.length?`このまとまりを使っている項目: ${esc(users.join('、'))}`
          :'このまとまりを使っている項目はまだありません'}</i>`,
       {headNote:esc(x.choice||'（まとまりを選んでいません）'),
        title:'押すと値の一覧が開きます（足す・消す・説明を書く）'})}
    </span></div>`:''}
   ${opIsOutput(x)?`
   <div class="op-form-row"><span class="op-form-label">初期値</span>
    <span class="op-form-ctl"><i class="op-form-note">この欄は<b>画面が値を入れます</b>ので、初期値はありません。</i></span></div>`:`
   <div class="op-form-row"><span class="op-form-label">初期値</span>
    <span class="op-form-ctl">
     <input type="text" id="opdInitial" list="opInitialList" value="${esc(x.initial||'')}"
       placeholder="空欄＝初期値なし">
     <datalist id="opInitialList">${(isChoice?opChoiceValues(x.choice):[])
       .map(v=>`<option value="${esc(v)}">`).join('')}</datalist>
     ${isChoice&&x.initial&&!opChoiceValues(x.choice).includes(x.initial)
       ?`<b class="op-warn-chip">候補に「${esc(x.initial)}」がありません${x.freeText?'（手打ちの値として入ります）':'——このままだと選択肢に無い値として入ります'}</b>`:''}
     ${!isChoice&&x.initial&&opInitialRangeNote(x)
       ?`<b class="op-warn-chip">${esc(opInitialRangeNote(x))}</b>`:''}
    </span></div>`}
   ${help('data','初期値はいつ入るか',
     '<p><b>まだ何も記録されていない欄にだけ</b>入ります。入力の方法によらず効きます'
     +'（プルダウンでもラジオでもステッパーでも同じ）。空にした欄を開き直しても初期値へは戻りません'
     +'——消したのは作業者の判断なので、上書きしません。</p>'
     +'<p><b>画面がもともと持っている欄（内径・スプール・測定器など）にも入ります。</b>'
     +'ただし入るのは<b>まだ何も選ばれていないとき</b>——空欄か「-」のときだけで、'
     +'「指定なし」のように<b>既定の選択肢が入っている欄には入りません</b>。'
     +'仕掛データから値が来る欄（内径）では<b>仕掛の値が勝ちます</b>。</p>')}
   ${isChoice?(()=>{
     /* 手打ち（§9.220 ③）。**打ち込む席の無い形では押せなくして理由を書く**
        （§9.247 ①・§4）——`入切`はスイッチ1つ、`切替`は押すたびに次へ進む
        ボタン1つなので、打つ場所が出せない。以前は押せてしまい、盤には
        「手打ち可」の印が出るのに測定画面では打つ場所がどこにも無かった。
        **保存値は消さない**（形を戻せば復活する・§9.233 ④と同じ作法）ので、
        すでに入にしてある項目にはそのことを書く。 */
     const blocked=(opState.freeTextBlocked||[]).includes(widget);
     const on=blocked?!!x.freeTextSaved:!!x.freeText;
     return `
   <div class="op-form-row"><span class="op-form-label">手打ち</span>
    <span class="op-form-ctl">
     <button type="button" id="opdFreeText" class="op-toggle${on?' is-on':''}" aria-pressed="${on?'true':'false'}"${blocked?' disabled':''}>候補にない値も打てる</button>
     <i class="op-form-note">${blocked
       ?`<b>「${esc(widget)}」では使えません</b>——${widget==='入切'?'スイッチが1つ':'ボタンが1つ'}だけなので、打ち込む場所が出せません。`
        +`打てるようにするなら、選ばせ方を<b>プルダウン・一覧・メニュー・ボタン群</b>などにしてください。`
        +(on?'（この設定は<b>残してあります</b>。選ばせ方を戻すとまた効きます）':'')
       :'候補の下に打ち込む欄が出ます。打った値は<b>そのまま記録に入り</b>、選択肢マスタには足しません。'}</i>
    </span></div>`;
    })():''}
   <div class="op-form-row is-danger"><span class="op-form-label">この項目</span>
    <span class="op-form-ctl">
     ${x.builtin
       ?`<button type="button" id="opdStepOut" class="ghost">①「測定画面に出す」へ</button>
         <i class="op-form-note">いまは<b>${x.enabled===false?'外れています':'測定画面に出ています'}</b>。</i>
         ${help('data','組み込みの欄は消せない（外せる）',
          '<p>この欄は<b>画面がもともと持っている部品</b>なので、行ごと消すことはできません'
          +'（消しても起動のたびに作り直されます）。代わりに<b>外して隠せます</b>'
          +'——いつでも戻せます。出す/出さないを持っているのは①の1つだけなので、'
          +'このボタンは<b>そこへ連れて行きます</b>。'
          +'役割を別の項目へ移した場合も、この欄は自動で下がります。</p>')}`
       :`<button type="button" id="opdDelete" class="danger ghost">この項目を削除</button>
         <i class="op-form-note">取り消せません。<b>記録済みの値は残りますが、画面から入れられなくなります。</b></i>`}
    </span></div>`);
  /* ---------- ③ どう見せるか ---------- */
  const paneLook=sec('look','どう見せるか','選ばせ方・意匠・単位の置き場（記録の中身は変わりません）',`
   ${help('look','選ばせ方を変えると何が変わるか',
     (opIsOutput(x)
       ?'<p>この欄は<b>画面が値を入れます</b>（前工程の実績・計算の結果）。打ち込む部品は要らないので、選べるのは<b>見せ方</b>だけです——単位・寄せ・意匠は他の欄と同じように効きます。</p>'
       :'<p>記録の中身は変わりません。変わるのは<b>測定画面での選ばせ方</b>だけです。'
        +'見本は<b>本物の部品</b>なので、押して確かめられます。</p>')
     +(opFamilyOf(x)==='number'?'<p>数値の欄は<b>打つこともできる</b>まま——道具は隣に足すだけです。</p>':'')
     +(opFamilyOf(x)==='choice'&&!x.choice?'<p><b>選択肢のまとまりを選ぶと</b>、見本に実際の値が並びます。</p>':''))}
   <div class="op-form-row"><span class="op-form-label">選ばせ方</span>
    <span class="op-form-ctl">
     ${usable
       /* **札の中に説明を入れない**（§9.227 ②）——形ごとに長さが違うので、
          選び直すたびに行の高さが変わって下の欄が上下する（実測4px）。
          説明は`title`と浮き出しの中のタイルが持つ。 */
       ?opPopHtml('widget',opWidgetLabel(x,widget),'選ばせ方',
          opWidgetPickerHtml(x,widget,usable),
          {headNote:'記録の中身は変わりません',
           title:(OP_WIDGET_NOTE[widget]||{}).note||'押すと選べる形が並びます'})
       :`<b class="op-locked-chip">${esc(opWidgetLabel(x,widget))}</b>`
        +`<i class="op-form-note">この型で選べる形は1つだけです。</i>`}
    </span></div>
   ${opLayoutRowHtml(x,widget)}
   ${opBlankRowHtml(x,widget)}
   ${opBlankTintRowHtml(x)}
   ${opChoiceOrderRowHtml(x,widget)}
   ${help('look','並べ方・空欄の札・未入力の色・選択肢の並び',
     '<p><b>並べ方</b>は「選択肢を何個ずつ置くか」で、意匠（色・形・大きさ）とは別の軸です。'
     +'左の見本は<b>1マスが実物と同じ大きさ</b>なので、器に収まるかがそのまま分かります。</p>'
     +'<p><b>空欄の札</b>を「出さない」にすると、その1枚ぶんの場所が空きます。'
     +'そのときは<b>初期値を決めておくこと</b>——決めていないと、記録は空のまま、'
     +'画面ではどれも選ばれていない状態になります（初期値は②で決めます）。</p>'
     +'<p><b>未入力の色</b>は空のあいだだけ塗り、値が入ると消えます。'
     +'色の呼び名は行表示マスタ・列の色と同じです。</p>'
     +'<p><b>選択肢の並び</b>の「よく使う順」は、押すと新しい面が開く形'
     +'（プルダウン・一覧・メニュー）でだけ使えます——札を並べる形で順番が変わると、'
     +'同じ欄なのに押す場所が毎回動くためです。回数は「選択肢の値」の画面で確かめられます。</p>')}
   ${opLookPickHtml(x)}
   ${opLookRowHtml(x,widget)}
   ${opSourceNoteRowHtml(x)}`);
  const panes={place:paneWhere,data:paneWhat,look:paneLook};
  /* **3つの塊を横に並べる**（§9.299）。段（タブ）は廃止したので、
     開いた瞬間から全部見えている（手数は3クリック→0）。 */
  const secs=opSecsFor(x);
  $('#opModalForm').innerHTML=`<div class="op-cols${secs.length===1?' is-one':''}">`
   +secs.map(t=>panes[t.k]||'').join('')+`</div>`;
  const role=opRoleOf(x);
  const roleLabel=(opState.roles.find(r=>r.key===role)||{}).label||'';
  $('#opModalRole').innerHTML=roleLabel
    ?`<b class="op-role-chip" title="この項目が担っている役割です（構成の必須はここで満たされます）">役割 ${esc(roleLabel)}</b>`
    :'';
  /* **保存は右上の端**（§9.223 ②、利用者の指示）。危ない操作（削除）は
     同じ場所へ置かない——「完了」の隣に「削除」を置かない（§CLAUDE 5）。
     削除は②のタブの中の帯へ移してある。 */
  $('#opModalActions').innerHTML=`<button type="button" id="opdSave" class="mm-btn-primary">保存</button>`;
  bindOpModal(x);
 }
 /* 実物の欄を組み立てる。**測定画面の部品をそのまま使う**（`measure-opdata.js`）
    ——別に作ると、設定画面で見えた形と実際の形が食い違う（§9.176の
    `entryCellInfo()`と同じ約束）。 */
 /* 対象設備（§9.219 ③）。書式は設備停止マスタと同じ（`*`／カンマ区切り）。
    **名前のタグの入切**で選ばせる（§9.197）——`'A,B,C'`を手で打たせると、
    設備名の全角半角ゆれで黙って当たらなくなる。判定はサーバーの
    `schedule_repo.stop_equipment_*`のままで、ここは書式を作るだけ。 */
 function opEquipmentList(x){
  const raw=String((x&&x.equipment)||'*').trim();
  if(!raw||raw==='*')return [];
  return raw.replace(/、/g,',').split(',').map(s=>s.trim()).filter(Boolean);
 }
 function opEquipmentPickHtml(x){
  const all=(equipmentMasterState.items||[]).map(e=>e.name).filter(Boolean);
  const on=opEquipmentList(x);
  const every=on.length===0;
  const known=new Set(all);
  /* **マスタに無い設備名も残す**（消えた設備を黙って外さない）。 */
  const extra=on.filter(n=>!known.has(n));
  return `<button type="button" id="opdEqAll" class="op-toggle${every?' is-on':''}"`
   +` aria-pressed="${every?'true':'false'}">すべての設備</button>`
   +`<span class="op-eq-tags">`
   +all.concat(extra).map(n=>`<button type="button" class="op-eq-tag${on.includes(n)?' is-on':''}"`
     +` data-op-eq="${esc(n)}" aria-pressed="${on.includes(n)?'true':'false'}"`
     +(known.has(n)?'':' title="設備マスタに無い名前です（消さずに残しています）"')
     +`>${esc(n)}</button>`).join('')
   +(all.length?'':'<i class="op-form-note">設備マスタに設備が登録されていません。</i>')
   +`</span>`
   +`<i class="op-form-note">${every?'すべての設備の測定画面に出ます（これから増える設備でも出ます）。'
     :`選んだ ${on.length} 設備だけに出ます: ${esc(on.join('、'))}`}</i>`;
 }
 /* ---------- 見本は「変更中の項目だけ」を実物どおりに（§9.276 ⑥、利用者の指示） ----------
    「単位の表示位置が追従していないことと、変更対象の単位をプレビューする
     ときの内部で表示するとき、単位が重複表示される。対象外で同一グループの
     時は単位の表示位置やUI配置がでたらめ。UIのサイズがバラバラで再現されて
     いない。UIもグループすべて並べたら入りきれないサイズになることも多いと
     思うので、変更中の対象項目だけの再現で十分なので再現度をしっかり
     上げてほしいです」

    直したのは2つ。
     ①**隣の欄（§9.250 ⑤のゴースト）をやめた**——マスタの行から自前で
       組み立てていたので、単位の置き場も器の高さも本物と揃わず、しかも
       群が大きいと器に入りきらなかった。**確かめたいのはいま触っている
       1つ**なので、そこへ場所と手間を寄せる（面積は頻度×重要度・§CLAUDE 1）。
     ②**欄そのものを`WL.opData.buildPreviewField()`で作る**——測定画面の
       `layout()`と同じ手順を通る1本の口（§9.163）。以前はここで`<label>`を
       自前で組み立てており、`placeholder`に単位を入れていたため
       **「内部」にした単位が欄の中に二重に出て**いた（実物には`placeholder`が
       無い）。組み立てが2箇所にあるかぎり、この食い違いは何度でも生まれる。 */
 function opRenderPreviewField(x,widget,usable){
  const host=$('#opPrevField');if(!host)return;
  const vals=(opState.choices||[]).filter(c=>c.name===x.choice).map(c=>c.value);
  const fam=opFamilyOf(x);
  host.innerHTML='';
  /* 見本へ渡す1行ぶんの定義。**測定画面が読むキーと同じ綴りで渡す**
     ——別名を作ると、片方だけ直した状態ができる。 */
  const previewDef={
   name:x.name,unit:x.unit,required:!!x.required,
   /* 組み込みの選択欄は`[型]`が`文字`のまま選択肢を持つ（§9.244）ので、
      **族で決める**——型で見ると、見本だけ打ち込み欄になる。 */
   type:fam==='choice'?'選択':x.type,
   choices:fam==='choice'
     ?((x.builtin&&!vals.length)?['（画面が持っている選択肢）']:vals)
     :opChoiceValues(x.choice),
   autoValue:x.autoValue||'',
   /* §9.231 ②。**いま効いている上下限**を渡す（行に書いた数のままだと、
      マスタから引く設定にした瞬間に見本だけ古い上限で描かれる）。 */
   decimals:x.decimals,step:x.step,
   min:opRuleDef(x).min,max:opRuleDef(x).max,
   minFromLabel:opRuleDef(x).minFromLabel,maxFromLabel:opRuleDef(x).maxFromLabel,
   freeText:!!x.freeText,
   /* 単位を重ねられない選ばせ方では、サーバーと同じ規則でここでも外下左へ
      落とす（§9.233 ④。判定は`opUnitInBlocked`の1箇所）。 */
   unitPlace:(opUnitPlaceOf(x)==='内部'&&opUnitInBlocked(widget,!!x.freeText))?'外下左':opUnitPlaceOf(x),
   align:x.align,valueFormat:x.valueFormat,digits:x.digits,
   look:opLookOf(x),
   layout:opLayoutUsable(widget)?opLayoutOf(x):'自動',
   noBlank:!!x.noBlank,
   /* 未入力の配色（§9.286 ⑥）。**見本にも当てる**——設定窓で選んだ色が
      その場で見えないと、測定画面を開き直して確かめることになる。 */
   blankTint:String(x.blankTint||''),
   choiceNotes:opState.notes[x.choice]||{},
   /* 選ばせ方は**器の作り方そのもの**なので、口へも同じ綴りで渡す。
      作れない選ばせ方（上下限が無いスライダー等）は素の欄へ落ちる。 */
   widget:usable?widget:'プルダウン'};
  const label=(window.WL&&WL.opData&&WL.opData.buildPreviewField)
    ?WL.opData.buildPreviewField(previewDef):null;
  if(!label){
   /* **黙って欠かさない**（§CLAUDE「公開漏れは黙って素通しになる」）。 */
   console.error('WL.opData.buildPreviewField が見つかりません（見本を描けません）');
   host.innerHTML='<p class="op-prev-note">見本を描けませんでした。</p>';
   return;
  }
  host.appendChild(label);
  const ctl=label.querySelector(':scope>select,:scope>input:not([type=hidden])')
    ||label.querySelector(':scope>output');
  if(!ctl)return;
  /* 自動で入る値の見本（§9.234 ②）。**いま引ける値があればそれ**——
     ロット番号に`123.4`と出ていると、桁も文字種も確かめられない。 */
  if(fam==='output'){
   let sample='123.4';
   if(x.autoValue){
    const known=!(window.WL&&WL.opData&&WL.opData.autoKnown)||WL.opData.autoKnown(x.autoValue);
    if(!known)sample='（この版では引けません）';
    else{
     const v=(window.WL&&WL.opData&&WL.opData.autoValueOf)?WL.opData.autoValueOf(x.autoValue):null;
     sample=(v===null||v==='')?'（測定を開くと入ります）':v;
    }
   }
   if(ctl.tagName==='OUTPUT')ctl.textContent=sample;else ctl.value=sample;
  }
  /* 初期値（§9.220 ②・§9.229 ③）は**見本にも入れる**——設定した値がどう
     見えるかを確かめられないと、選択肢に無い値を打ったことに気づけない。 */
  if(x.initial&&ctl.tagName!=='OUTPUT'){
   if(ctl.tagName==='SELECT'&&![...ctl.options].some(o=>o.value===x.initial)){
    const o=document.createElement('option');
    o.value=x.initial;o.textContent=x.initial;o.dataset.opFree='1';ctl.appendChild(o);
   }
   ctl.value=x.initial;
  }
  /* 値の整え方（§9.221 ⑦）も**見本へ配線する**——当てるのは
     `measure-opdata.js`の1本（帳票と同じく2つ目の整形器を作らない）。 */
  if(window.WL&&WL.opData&&WL.opData.attachFormat){
   WL.opData.attachFormat(ctl,()=>WL.opData.settlePreview(ctl,previewDef));
  }
  if(window.WL&&WL.opData&&WL.opData.syncWidgets)WL.opData.syncWidgets();
  /* ---------- 「いまは作れない」理由はここで言う（§9.250 ⑧） ----------
     スライダー・メーターは上下限が、早見ボタンは上下限と刻みが決まって
     いないと作れない。**押せるのに何も起きない道具は残さない**ので、
     道具は素の欄のままにして、理由と直し方は**選んでいるこの窓**に出す。 */
  const note=document.getElementById('opPrevNote');
  if(note){
   const box=label.querySelector('.opf-widget');
   const why=(box&&box.dataset.why)||'';
   note.textContent=why?`${why}。いまは打ち込みだけの欄になります（「② 何を記録するか」で決められます）。`:'';
   note.hidden=!why;
  }
  /* **押した結果が何として記録されるか**を出す（§9.219 ③）。見本が本物なので、
     押せばそのまま値が変わる——記録に入るのはこの文字列。 */
  const out=document.getElementById('opPrevValue');
  if(out){
   const sample=String((x&&x.sample)||'');
   const show=()=>{
    const v=String(ctl.value==null?'':ctl.value);
    out.innerHTML=`記録される値: <b>${v?esc(v):'（まだ入っていません）'}</b>`
     +(sample&&sample!=='（値）'&&ctl.tagName!=='OUTPUT'
        ?` <button type="button" class="op-prev-fill" id="opPrevFill"`
         +` title="ありそうな値（${esc(sample)}）を入れて、幅が足りるかを確かめます">見本の値を入れる</button>`:'');
    const fill=document.getElementById('opPrevFill');
    if(fill)fill.onclick=e=>{
     e.preventDefault();
     if(ctl.tagName==='SELECT'&&![...ctl.options].some(o=>o.value===sample)){
      const o=document.createElement('option');o.value=sample;o.textContent=sample;
      o.dataset.opFree='1';ctl.appendChild(o);
     }
     ctl.value=sample;
     ctl.dispatchEvent(new Event('input',{bubbles:true}));
     ctl.dispatchEvent(new Event('change',{bubbles:true}));
     if(window.WL&&WL.opData&&WL.opData.syncWidgets)WL.opData.syncWidgets();
    };
   };
   ctl.addEventListener('input',show);
   ctl.addEventListener('change',show);
   show();
  }
 }
 function bindOpModal(x){
  /* §9.256。式の欄（`[自動値]`が`式`のときだけ在る）。 */
  opBindFormula();
  const form=$('#opModalForm');if(!form)return;
  /* **触った結果はその場で当てる**（保存はまとめて1回）。押すたびに
     サーバーへ書くと、途中で切れたときに半分だけ効いた行が残る。 */
  /* **打ちかけの文字を捨てない**（§9.220）。ボタンを押すと窓は組み直される
     ので、組み直す前に打ち込み欄を控える——控えないと、初期値・覚え書き・
     単位を打ってから幅のボタンを押しただけで消える（値は保存のときに
     `opDetailValues()`が読む作りなので、押した時点では拾われていなかった）。 */
  const touch=patch=>{Object.assign(x,opFormEdits(),patch);renderOpModal()};
  form.querySelectorAll('[data-op-place]').forEach(b=>b.onclick=()=>touch({place:b.dataset.opPlace}));
  form.querySelectorAll('[data-op-span]').forEach(b=>b.onclick=()=>touch({span:Number(b.dataset.opSpan)}));
  form.querySelectorAll('[data-op-type]').forEach(b=>b.onclick=()=>touch({type:b.dataset.opType}));
  form.querySelectorAll('[data-op-widget]').forEach(b=>b.onclick=()=>{
   if(b.disabled)return;touch({widget:b.dataset.opWidget});
  });
  /* 見せ方（§9.221 ⑦）。**押した結果はその場で見本に出る**ので、
     保存する前に「どこに出るか」を確かめられる。 */
  form.querySelectorAll('[data-op-unitplace]').forEach(b=>b.onclick=()=>{
   if(b.disabled)return;touch({unitPlace:b.dataset.opUnitplace});
  });
  form.querySelectorAll('[data-op-layout]').forEach(b=>b.onclick=()=>touch({layout:b.dataset.opLayout}));
  /* §9.228 ④ 空欄（選ばない）の札と、その場で直せる初期値。 */
  form.querySelectorAll('[data-op-blank]').forEach(b=>b.onclick=()=>
    touch({noBlank:b.dataset.opBlank==='1'}));
  /* §9.286 ⑥ 未入力・未選択の配色。 */
  form.querySelectorAll('[data-op-btint]').forEach(b=>b.onclick=()=>
    touch({blankTint:b.dataset.opBtint}));
  /* §9.248 ⑤ 選択肢の並び。 */
  form.querySelectorAll('[data-op-corder]').forEach(b=>b.onclick=()=>{
   if(b.disabled)return;touch({choiceOrder:b.dataset.opCorder});
  });

  form.querySelectorAll('[data-op-align]').forEach(b=>b.onclick=()=>touch({align:b.dataset.opAlign}));
  /* §9.233 ⑤ 仕掛由来の添え書きの置き場。 */
  form.querySelectorAll('[data-op-srcnote]').forEach(b=>b.onclick=()=>
    touch({sourceNote:b.dataset.opSrcnote}));
  form.querySelectorAll('[data-op-vfmt]').forEach(b=>b.onclick=()=>touch({valueFormat:b.dataset.opVfmt}));
  form.querySelectorAll('[data-op-when]').forEach(b=>b.onclick=()=>{
   const now=new Set(x.showWhen||[]);
   if(now.has(b.dataset.opWhen))now.delete(b.dataset.opWhen);else now.add(b.dataset.opWhen);
   touch({showWhen:[...now]});
  });
  const req=$('#opdRequired');
  if(req)req.onclick=()=>touch({required:!x.required});
  const en=$('#opdEnabled');
  if(en)en.onclick=()=>touch({enabled:x.enabled===false});
  const fold=$('#opdFold');
  if(fold)fold.onclick=()=>touch({fold:!x.fold});
  /* §9.242 ④ ③「記録した値」へ出すか。**既定は出す**なので、`false`だけを
     「外した」として持つ（`undefined`と`true`はどちらも出す）。 */
  const rsw=$('#opdRecordShow');
  if(rsw)rsw.onclick=()=>touch({recordShow:x.recordShow===false});
  /* 対象設備（§9.219 ③）。**「すべての設備」と名指しは排他**——両方立つと
     どちらが効くのか読めない。 */
  const eqAll=$('#opdEqAll');
  if(eqAll)eqAll.onclick=()=>touch({equipment:'*'});
  form.querySelectorAll('[data-op-eq]').forEach(b=>b.onclick=()=>{
   const now=new Set(opEquipmentList(x));
   const n=b.dataset.opEq;
   if(now.has(n))now.delete(n);else now.add(n);
   touch({equipment:now.size?[...now].join(','):'*'});
  });
  /* **覚え書きは入力中に描き直さない**（§9.117。作り替えるとカーソルが飛ぶ）。
     値は保存のときに`opDetailValues()`が読む。 */
  const ch=$('#opdChoice');
  if(ch)ch.onchange=()=>touch({choice:ch.value});
  /* 選択肢のまとまり名のサジェスト（§9.220 ④）。押すだけで当たる。 */
  form.querySelectorAll('[data-op-suggest]').forEach(b=>b.onclick=()=>
    touch({choice:b.dataset.opSuggest}));
  /* 手打ち（§9.220 ③）。 */
  const ft=$('#opdFreeText');
  if(ft)ft.onclick=()=>touch({freeText:!x.freeText});
  /* 値の説明はその場で書き換える（**入力中に描き直さない**・§9.117）。 */
  form.querySelectorAll('[data-op-cnote]').forEach(inp=>inp.onchange=()=>
    opSaveChoiceNote(inp.dataset.opCnote,inp.value));
  form.querySelectorAll('[data-op-cdel]').forEach(b=>b.onclick=()=>opDeleteChoiceValue(b.dataset.opCdel));
  const addV=$('#opdAddChoiceValue');
  if(addV)addV.onclick=()=>opAddChoiceValue();
  /* 役割（§9.223 ①）。**付け替えは即座に見本と要約へ出る**——「いまは誰が
     担当か」は付け替える前に読めないと選べない。 */
  const role=$('#opdRole');
  if(role)role.onchange=()=>touch({role:role.value});
  /* 上下限の出どころ（§9.231 ②）。**選んだら描き直す**——手打ちの欄が
     使えなくなり、案内の文（いまの値・単位）も変わるので、押した結果が
     その場で見えないと選べない。 */
  form.querySelectorAll('[data-op-from]').forEach(sel=>sel.onchange=()=>{
   touch(sel.dataset.opFrom==='min'?{minFrom:sel.value}:{maxFrom:sel.value});
  });
  /* 意匠（§9.223 ③）。色・形・大きさの3軸。 */
  form.querySelectorAll('[data-op-look]').forEach(b=>b.onclick=()=>{
   const lk=opLookOf(x);lk[b.dataset.opLook]=b.dataset.opVal;
   touch({look:lk});
  });
  /* 浮き出し（§9.299）。**押した札は`opState.pop`が1つだけ覚える**ので、
     描き直しても開いたまま続けられる（値を1つ足すたびに閉じない）。 */
  $('#opItemModal').querySelectorAll('[data-op-pop]').forEach(b=>b.onclick=e=>{
   e.preventDefault();e.stopPropagation();
   const k=b.dataset.opPop;
   opState.pop=(opState.pop===k)?'':k;
   opSyncPops();
  });
  const save=$('#opdSave');
  if(save)save.onclick=()=>opSaveItem();
  const del=$('#opdDelete');
  if(del)del.onclick=()=>opDeleteItem();
  /* 組み込みの欄の「外す」（§9.229 ③）。**入口は増やさない**（§9.207）
     ——出す/出さないを持っているのは①の1つだけなので、ここは
     **そこへ連れて行くだけ**。②で行き止まりにすると「外せない」と読まれる
     （実機で「一旦外すなどもできるようにしてほしい」と報告された）。 */
  const padOff=$('#opdPadOff');
  if(padOff)padOff.onclick=async()=>{
   const uid=requireMaintUser();if(uid===null)return;
   /* **切り替えは`opSetPad()`の1箇所**（右クリックのメニューと同じ道）。
      ここで部分的なJSONを送ると、`item_upsert`は全列を書くので**送らなかった
      設定が消える**（§9.113／§9.212 ②と同じ形）。 */
   try{
    await opSetPad(x.id,false,uid);
    closeOpModal();opSay('ふつうの項目へ戻しました');
   }catch(e){opModalSay('戻せませんでした: '+e.message,true)}
  };
  const out=$('#opdStepOut');
  if(out)out.onclick=()=>{
   /* 段は廃止したので**移動せず、その場で連れて行く**（§9.299）——
      ①の「測定画面に出す」は同じ画面の左の列にある。 */
   const t=$('#opdEnabled');
   if(!t)return;
   t.scrollIntoView({block:'nearest'});
   t.focus();t.classList.add('op-flash');setTimeout(()=>t.classList.remove('op-flash'),1200);
  };
  /* **描き直したあとも浮き出しは開いたまま**（§9.299）。 */
  opSyncPops();
 }
 /* いま窓に打ち込まれている値。**在る欄だけ**返す（組み込みの行では
    名前・型の欄そのものが無い）。 */
 function opFormEdits(){
  const out={};
  const t=(id,key)=>{const el=$('#'+id);if(el)out[key]=el.value};
  const n=(id,key)=>{const el=$('#'+id);if(el)out[key]=(el.value===''?null:Number(el.value))};
  t('opdName','name');t('opdUnit','unit');t('opdNote','note');
  t('opdGroup','group');t('opdInitial','initial');
  n('opdDecimals','decimals');n('opdMin','min');n('opdMax','max');n('opdStep','step');
  n('opdDigits','digits');
  /* §9.231 ②。**控えにも載せる**——タブを移った先で保存されるので、
     ここで拾わないと出どころだけが空で上書きされる（§9.223 ②）。 */
  t('opdMinFrom','minFrom');t('opdMaxFrom','maxFrom');
  return out;
 }
 /* ---------- 式で作る自動値（§9.256、利用者の指示） ----------
    「取得データから組み合わせたり、計算式を組み合わせたり、条件式を
     組み合わせて、式を設定することで『自動』項目を作成できるように」

    **評価器も書き方も列の計算式と同じ**（`WL.formula`・§9.111）——`eval`を
    使わない自前の解析器が既にあるので、2つ目を作らない。書く材料は
    **呼び名**（`[ロット番号]`・`[条数]`・`[OS31795速度]`）なので、鍵の綴りを
    覚えなくてよい（§CLAUDE 2）。

    **候補は押して入れられる**（§CLAUDE 2「探させない」）——名前を思い出して
    打つのではなく、一覧から選ぶ。**壊れた式は書いている時点で断る**
    （§9.111）——評価まで待つと、実データが全部空になってから気づく。 */
 /* 鍵の綴りは**サーバーが答える**（§9.163）——画面へ書き写さない
    （`tests/test_opauto.js`が機械で見張っている）。 */
 const opFormulaKey=()=>String(opState.autoFormulaKey||'');
 const opIsFormula=x=>!!x&&!!opFormulaKey()&&String(x.autoValue||'')===opFormulaKey();
 /* 式が参照できる呼び名。**取得データはサーバーの語彙**、項目はこの設備の
    一覧から。**自分自身は候補に出さない**——自分を参照する式は必ず循環する。 */
 function opFormulaNames(x){
  const groups=[];
  const push=(g,label,note)=>{
   let hit=groups.find(z=>z.name===g);
   if(!hit){hit={name:g,items:[]};groups.push(hit)}
   if(!hit.items.some(z=>z.label===label))hit.items.push({label,note:note||''});
  };
  (opState.autoValues||[]).forEach(a=>{
   if(!a||!a.label||a.key===opFormulaKey())return;
   push(a.group||'取得データ',a.label,[a.unit?`単位 ${a.unit}`:'',a.note].filter(Boolean).join('｜'));
  });
  (opState.items||[]).forEach(it=>{
   if(!it||!it.name||it.id===(x&&x.id))return;
   push('この設備の項目',it.name,
        it.autoValue?`自動で入る値（${it.autoValueLabel||it.autoValue}）`:(it.unit?`単位 ${it.unit}`:''));
  });
  return groups;
 }
 /* いま書いてある式が使ってよいか。**理由まで返す**（§CLAUDE 4）。 */
 function opFormulaCheck(x,src){
  const text=String(src||'').trim();
  if(!text)return {ok:false,why:'式が空です。下の候補を押して組み立ててください。'};
  if(!(window.WL&&WL.formula&&typeof WL.formula.check==='function'))
   return {ok:false,why:'式を確かめる部品が読み込まれていません。'};
  const r=WL.formula.check(text);
  if(r&&r.error)return {ok:false,why:r.error};
  /* **知らない呼び名は断る**——評価時には空文字になるだけなので、
     打ち間違えると「いつも空欄」の欄が黙って出来上がる。 */
  const known=new Set();
  opFormulaNames(x).forEach(g=>g.items.forEach(i=>known.add(i.label)));
  const used=(r&&r.columns)||[];
  const bad=used.filter(n=>!known.has(n));
  if(bad.length)return {ok:false,why:`この名前は使えません: ${bad.join('・')}`
    +'（下の候補にあるものだけが使えます。項目名を変えたときは書き直してください）'};
  /* **自分を参照していたら断る**（循環の入口）。 */
  if(x&&x.name&&used.indexOf(x.name)>=0)
   return {ok:false,why:'自分自身は使えません（値が決まりません）。'};
  return {ok:true,why:`使える式です（${used.length}件の値を使っています）`,columns:used};
 }
 function opFormulaRowHtml(x){
  const src=String(x.autoFormula||'');
  const r=opFormulaCheck(x,src);
  const groups=opFormulaNames(x);
  return `<div class="op-form-row op-form-row-formula"><span class="op-form-label">式</span>
   <span class="op-form-ctl">
    <textarea id="opdFormula" class="op-formula-input" rows="2"
      placeholder="例: if([製造板厚] &lt; 0.3, &quot;薄物&quot;, &quot;厚物&quot;)">${esc(src)}</textarea>
    <b class="${r.ok?'op-chip':'op-warn-chip'}" id="opdFormulaState">${esc(r.why)}</b>
    <i class="op-form-note">取得データ・この設備の他の項目を、計算（<b>+ - * / %</b>）・
     比較（<b>= &lt;&gt; &lt; &lt;= &gt; &gt;=</b>）・条件（<b>if(条件, 真, 偽)</b>）で組み合わせます。
     <b>表示だけの値</b>で、並べ替え・絞り込みの対象にはなりません。</i>
    <div class="op-formula-pick">
     ${groups.map(g=>`<div class="op-formula-group">${esc(g.name)}</div>`
       +g.items.map(i=>`<button type="button" class="op-formula-name" data-opf-name="${esc(i.label)}"
          title="${esc(i.note||'')}">${esc(i.label)}</button>`).join('')).join('')}
    </div>
   </span></div>`;
 }
 function opBindFormula(){
  const ta=$('#opdFormula');if(!ta)return;
  const x=opItemById(opState.picked)||{};
  const state=$('#opdFormulaState');
  const paint=()=>{
   const r=opFormulaCheck(x,ta.value);
   if(state){state.textContent=r.why;state.className=r.ok?'op-chip':'op-warn-chip'}
  };
  /* **打っている最中に窓を組み直さない**（§9.117）——1文字ごとに
     カーソルが飛ぶ。書き換えるのは判定の札だけ。 */
  ta.oninput=paint;
  document.querySelectorAll('[data-opf-name]').forEach(b=>b.onclick=()=>{
   const ins='['+b.dataset.opfName+']';
   const s=ta.selectionStart||0,e=ta.selectionEnd||0;
   ta.value=ta.value.slice(0,s)+ins+ta.value.slice(e);
   ta.focus();ta.selectionStart=ta.selectionEnd=s+ins.length;
   paint();
  });
 }
 function opDetailValues(){
  const x=opItemById(opState.picked)||{};
  /* **画面に出ていない段の値は控えから読む**（§9.223 ②）。決めることを
     タブで4段に分けたので、いま描かれているのは1段ぶんだけ——DOMだけを
     見ると、②で名前を打って③へ移ってから保存した瞬間に**その段の設定が
     まるごと空で上書きされる**（`item_upsert`は全列を書く。§9.113／
     §9.212 ②と同じ形）。控え(`x`)はタブを押すたびに`touch()`が
     `opFormEdits()`で更新しているので、欄が無いときはそちらが正。 */
  const v=(id,key)=>{
   const el=$('#'+id);
   if(el)return el.value;
   const kept=x[key===undefined?id:key];
   return kept===undefined||kept===null?undefined:String(kept);
  };
  const num=s=>(s===''||s===undefined||s===null)?null:Number(s);
  return {name:v('opdName','name'),type:x.type,
          decimals:num(v('opdDecimals','decimals')),min:num(v('opdMin','min')),
          max:num(v('opdMax','max')),
          /* §9.231 ②。**必ず送る**——`item_upsert`は全列を書くので、
             落とすと保存のたびに出どころが消える（§9.212 ②と同じ形）。 */
          minFrom:(v('opdMinFrom','minFrom')||''),maxFrom:(v('opdMaxFrom','maxFrom')||''),
          unit:v('opdUnit','unit'),choice:v('opdChoice','choice'),
          /* §9.256。**必ず送る**——`item_upsert`は全列を書くので、他の段から
             保存したときに落とすと書いた式が消える（§9.223 ②と同じ形）。
             欄が描かれていない段では控え(`x`)が正。 */
          autoFormula:(v('opdFormula','autoFormula')||''),
          group:v('opdGroup','group'),
          /* §9.223 ①③。役割は`<select>`から、意匠は押した結果が`x`に
             載っているのでそのまま持ち出す（保存の形はサーバーが作る）。 */
          role:(v('opdRole','role')!==undefined?v('opdRole','role'):(x.role||'')),
          look:opLookOf(x),
          /* §9.220 ②③⑤。**打ち込む欄の値はここで読む**——`touch()`で
             書き戻すと1文字ごとに描き直してカーソルが飛ぶ（§9.117）。 */
          initial:v('opdInitial','initial'),step:num(v('opdStep','step')),
          freeText:!!x.freeText,
          /* §9.221 ⑦。**4つとも必ず送る**——`item_upsert`は全列を書くので、
             1つでも落とすとその設定だけが保存のたびに既定へ戻る
             （§9.113／§9.212 ②と同じ形の不具合）。 */
          unitPlace:x.unitPlace,align:x.align,valueFormat:x.valueFormat,
          digits:num(v('opdDigits','digits')),
          /* **備考を送り忘れないこと**（§9.219 ③）。`item_upsert`は全列を
             書くので、送らないと保存のたびに`[備考]`が空で消える
             （§9.113／§9.212 ②と同じ形の不具合が実際に起きていた）。 */
          note:v('opdNote','note'),
          equipment:x.equipment,
          span:x.span,place:x.place,widget:x.widget,
          /* §9.226 ①③。**並べ方と群幅も必ず送る**——`item_upsert`は全列を
             書くので、送らないと保存のたびに既定へ戻る（§9.212 ②と同じ形）。 */
          layout:x.layout||'自動',groupSpan:Number(x.groupSpan)||0,
          /* §9.228 ②④。**空きと空欄の札も必ず送る**（同じ理由）。 */
          dummy:!!x.dummy,noBlank:!!x.noBlank,
          /* §9.248 ⑤。選択肢の並びも同じ——落とすと保存のたびに登録順へ戻る。 */
          choiceOrder:x.choiceOrder||'',
          /* §9.242 ④。③「記録した値」へ出すかも同じ——落とすと保存のたびに
             既定（出す）へ戻る（§9.212 ②と同じ形）。 */
          recordShow:x.recordShow!==false,
          /* §9.233 ⑤。添え書きの置き場も同じ——落とすと保存のたびに
             既定（欄の下）へ戻る（§9.212 ②と同じ形）。 */
          sourceNote:x.sourceNote||'',
          /* §9.287-H。未入力の配色も同じ（利用者の報告「未入力の色については
             保存がききません」）——**押すと見本は変わるのに保存だけ効かない**
             という、いちばん気づきにくい形で出ていた。 */
          blankTint:String(x.blankTint||''),
          required:!!x.required,enabled:x.enabled!==false,
          fold:!!x.fold,
          showWhen:x.showWhen||[]};
 }
 async function opSaveItem(){
  const x=opItemById(opState.picked);if(!x)return;
  const uid=requireMaintUser();if(uid===null)return;
  const d=opDetailValues();
  /* 組み込みの欄は名前も型も画面のものなので送らない（送っても効かない
     欄を作らない・§CLAUDE 4）。 */
  const body={id:x.id,user_id:uid,note:d.note||'',
    equipment:d.equipment||x.equipment||'*',group:d.group||'その他',
    /* **名前は組み込みの欄でも送る**（§9.229 ③、利用者の指示「名前も設定項目も
       変えられません」）。以前はここで`x.name`へ戻していたので、②で打ち直して
       保存しても**元の名前で上書き**されていた（欄は編集できるので、押した本人
       からは「保存できているのに反映されない」としか見えない）。測定画面の
       見出しは`renameBuiltinLabel()`が書き換える（§9.228 ①）ので、送れば効く。 */
    name:d.name||x.name,
    type:x.builtin?x.type:(d.type||'文字'),
    decimals:x.builtin?null:d.decimals,min:x.builtin?null:d.min,max:x.builtin?null:d.max,
    /* §9.231 ②。組み込みの欄は「数の決まり」そのものを持たないので空。 */
    minFrom:x.builtin?'':(d.minFrom||''),maxFrom:x.builtin?'':(d.maxFrom||''),
    /* **単位と見せ方は組み込みの欄にも効く**（§9.221 ⑦）。型・上下限と
       違って「ただの見せ方」なので、組み込みの欄でも押した通りになる
       ——以前は`単位`が「数の決まり」の中にあり、`選択`型と組み込みでは
       欄ごと出ていなかった（種としては単位を持つ項目——リール径 mm——が
       画面から編集できなかった）。 */
    /* **組み込みの欄も選択肢のまとまりを持つ**（§9.221 ③）——どのまとまりから
       選ばせるかはマスタが決める（測定画面は`builtin_choice_name()`を通す）。
       以前は空で上書きしており、移行で張った結び付きが保存のたびに消えた。 */
    unit:d.unit||'',choice:d.choice||'',
    unitPlace:d.unitPlace,align:d.align,valueFormat:d.valueFormat,digits:d.digits,
    span:d.span,place:d.place,required:d.required,enabled:d.enabled,widget:d.widget,
    /* §9.228 ②④。**空きと空欄の札も必ず送る**——`item_upsert`は全列を
       書くので、送らないと保存のたびに既定へ戻る（§9.212 ②と同じ形）。 */
    dummy:!!d.dummy,noBlank:!!d.noBlank,
    /* §9.248 ⑤ 選択肢の並び（''＝登録順／'よく使う順'）。 */
    choiceOrder:d.choiceOrder||'',
    /* §9.242 ④ ③「記録した値」に出すか。 */
    recordShow:d.recordShow!==false,
    /* §9.233 ⑤ */
    sourceNote:d.sourceNote||'',
    /* §9.287-H 未入力の配色（§9.286 ⑥）。**送り忘れると保存されない**
       ——`item_upsert`は`None`を「触っていない」と読んで今の値を残すので、
       画面では色が付くのに開き直すと元へ戻る（利用者の報告）。 */
    blankTint:d.blankTint||'',
    /* **初期値と手打ちは組み込みの欄にも効く**（§9.229 ③）。値の持ち方を
       変えないので、型・上下限と違って画面の部品のままで成立する。
       仕掛データから値が来る欄（内径§9.204）は**仕掛の値が勝つ**
       ——`applyInitials()`が入れた値は「まだ選んでいない」として扱う。 */
    initial:d.initial||'',
    freeText:!!d.freeText,
    step:x.builtin?null:d.step,
    /* 「開く条件」と「畳む」は**群のもの**。1行だけに書くと、同じ群の中で
       食い違う（`form_for_equipment`は「1つでも畳むと言えば畳む」で読むので
       消したはずの条件が残る）。群ぜんぶへ同じ値を書く。 */
    /* **条件が無くても畳めること**（§9.219 ③）。以前は「開く条件があるか」
       から導いていたので、条件なしで畳む設定が作れなかった。 */
    showWhen:d.showWhen,fold:!!d.fold||!!(d.showWhen||[]).length,
    /* **役割と意匠は組み込みの欄にも効く**（§9.223 ①③）。役割は「この値を
       何として読むか」で、意匠は見た目——どちらも値の持ち方を変えないので、
       組み込みの欄でも押したとおりになる。**組み込みキーは送らない**ので、
       役割を別の項目へ移してもこの欄の素性は変わらない。 */
    role:d.role||'',look:d.look||null,
    /* §9.226 ①③ */
    layout:d.layout||'自動',groupSpan:d.groupSpan||0};
  /* §9.256。式で作る自動値だけが持つ設定。**壊れた式は保存しない**
     （§9.111「書いている時点で断る」）——評価まで待つと、実データが
     全部空になってから気づく。理由はその場に出して直させる（§CLAUDE 4）。 */
  if(opIsFormula(x)){
   const r=opFormulaCheck(x,d.autoFormula);
   if(!r.ok){opModalSay('式を直してください: '+r.why,true);return}
   body.autoFormula=d.autoFormula;
  }
  try{
   opModalSay('保存しています…');
   await api('/api/operation-item-master/update',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   await opSyncGroupFlags(d.place||x.place,d.group||x.group,d.showWhen,body.fold,uid);
   await loadOpItemMaint(true);
   if(window.WL&&WL.opData)WL.opData.forget();
   /* **保存したら閉じる**（§9.222 ⑦、利用者の指示「保存ボタンを押したら
      モーダルは閉じてほしいです」）。列の設定と同じ作法（§9.207）で、
      **失敗したときは閉じない**——直す場所が消えると打ち直せない。
      閉じるので「保存しました」は**盤の側**（`#opLayoutState`）へ出す
      ——モーダルの中へ出しても見えないまま消える。 */
   closeOpModal();
   opSay('保存しました');
  }catch(e){opModalSay('保存できませんでした: '+e.message,true)}
 }
 /* 群のふるまい（畳む・開く条件）は**群の全部の行へ同じ値**を書く。
    `form_for_equipment`は「1つでも畳むと言えば畳む」で読むので、1行だけ
    直すと消したはずの条件が残る（同じ設定が2箇所にある状態になる）。

    **`layout`で代用しないこと。** あちらは行の中身をまるごと書くので、
    直前に1件だけ更新した内容（列幅など）を**手元の古い写しで上書き
    してしまう**——「列幅を変えても元に戻る」として実際に踏んだ。
    専用の口は2列だけ触る。 */
 async function opSyncGroupFlags(place,group,showWhen,fold,uid){
  await api('/api/operation-item-master/group',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({place,group,fold:!!fold,showWhen:showWhen||[],user_id:uid,
      /* 群の畳み・幅・空きも**選んでいる設備だけ**に効かせる（§9.239 ②）。
         送らないと、設備Aで畳んだだけで全設備が畳まれる。 */
      equipment:opState.equipment||''})});
 }
 async function opDeleteItem(){
  const x=opItemById(opState.picked);if(!x||x.builtin)return;
  const uid=requireMaintUser();if(uid===null)return;
  if(!(await confirmModal(`「${x.name}」を削除しますか？\n記録済みの値は測定データの中に残りますが、入力欄は出なくなります。`)))return;
  try{
   await api('/api/operation-item-master/delete',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({id:x.id,user_id:uid})});
   opState.picked=null;
   const m=$('#opItemModal');if(m)m.hidden=true;
   await loadOpItemMaint(true);
   opSay('削除しました');
   if(window.WL&&WL.opData)WL.opData.forget();
  }catch(e){opModalSay('削除できませんでした: '+e.message,true)}
 }
 /* 選択肢の値を**その場で足す**（§9.216 ④／§9.218 ③）。項目を作る手を
    止めて別のタブへ行かせないのが、この画面のいちばんの値打ち。
    まとまりの名前も打てるようにしてあるので、**選択肢マスタを開かずに
    1つの項目を最後まで作れる**（利用者の言う「登録の負荷」の正体）。 */
 async function opAddChoiceValue(){
  const x=opItemById(opState.picked);if(!x)return;
  const fresh=String(($('#opdNewChoiceName')||{}).value||'').trim();
  const name=fresh||String(($('#opdChoice')||{}).value||'').trim();
  const val=String(($('#opdNewChoiceValue')||{}).value||'').trim();
  const note=String(($('#opdNewChoiceNote')||{}).value||'').trim();
  if(!name){opModalSay('先にまとまりを選ぶか、新しい名前を入力してください',true);return}
  if(!val){opModalSay('足す値を入力してください',true);return}
  const uid=requireMaintUser();if(uid===null)return;
  try{
   await api('/api/operation-choice-master',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({name,value:val,note,user_id:uid})});
   /* 新しいまとまりを作ったときは、その場でこの項目に結ぶ——結ばないと
      「足したのに出てこない」と読まれる。 */
   x.choice=name;
   await loadOpItemMaint(true);
   opModalSay(`「${name}」に「${val}」を足しました`);
   if(window.WL&&WL.opData)WL.opData.forget();
   renderOpModal();
  }catch(e){opModalSay('足せませんでした: '+e.message,true)}
 }
 async function opSaveChoiceNote(id,note){
  const row=(opState.choices||[]).find(c=>String(c.id)===String(id));if(!row)return;
  const uid=requireMaintUser();if(uid===null)return;
  try{
   await api('/api/operation-choice-master/update',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:row.id,name:row.name,value:row.value,note,user_id:uid})});
   row.note=note;
   opModalSay('説明を保存しました');
   if(window.WL&&WL.opData)WL.opData.forget();
  }catch(e){opModalSay('説明を保存できませんでした: '+e.message,true)}
 }
 async function opDeleteChoiceValue(id){
  const row=(opState.choices||[]).find(c=>String(c.id)===String(id));if(!row)return;
  const uid=requireMaintUser();if(uid===null)return;
  if(!(await confirmModal(`「${row.name}」から「${row.value}」を消しますか？\nこのまとまりを使っている項目すべてから消えます。`)))return;
  try{
   await api('/api/operation-choice-master/delete',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:row.id,user_id:uid})});
   await loadOpItemMaint(true);
   opModalSay('消しました');
   if(window.WL&&WL.opData)WL.opData.forget();
   renderOpModal();
  }catch(e){opModalSay('消せませんでした: '+e.message,true)}
 }
 /* ============================================================
    選択肢の値 — まとまり（親）とその中の値（子）の2階層（§9.221 ②）
    ------------------------------------------------------------
    利用者の指示「まとまり名毎にまとめて管理したいです。まとまり名毎に
    さらに子マスタを持つような感じにしてマスタに階層構造を持たせたいです」。

    以前は**1行＝1値の平らな一覧**で、「リング色」の5行が「内径」の12行と
    同じ表に並んでいた。同じまとまり名を何度も打つことになり、まとまりが
    いくつあるのかも数えないと分からない。左に**まとまり**、右にその中の
    **値**を置く。

    §9.221 ③でオペレータ・機器・スプール種別・内径種別・バリ揃え・
    コイル止めもここへ移したので、**現場が触る選択肢はすべてこの1枚**になる。
    ============================================================ */
 const ocState={groups:[],items:[],usage:{},legacy:[],picked:'',q:'',eqOpen:null,scroll:0};
 function ocRows(name){
  return (ocState.items||[]).filter(r=>r.name===name);
 }
 function ocPickedName(){
  const names=(ocState.groups||[]).map(g=>g.name);
  if(ocState.picked&&names.includes(ocState.picked))return ocState.picked;
  return names[0]||'';
 }
 /* 対象設備の読み方（§9.221 ③）。書式は設備停止マスタと同じ
    （`''`＝すべて／`'A,B'`）。**判定はサーバー**にあるので、ここは
    人が読む形に直すだけ。 */
 function ocEqList(v){
  const raw=String(v||'').trim();
  if(!raw||raw==='*')return [];
  return raw.replace(/、/g,',').split(',').map(x=>x.trim()).filter(Boolean);
 }
 function ocEqLabel(v){
  const on=ocEqList(v);
  return on.length?on.join('・'):'すべての設備';
 }
 async function loadOpChoiceMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.classList.remove('mm-form-compact');
  if(typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){}}
  if(!list.querySelector('.oc-edit'))list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const ch=await api('/api/operation-choice-master');
   ocState.items=(ch.items||[]).map(x=>({...x}));
   ocState.groups=ch.groups||[];
   ocState.usage=ch.usage||{};
   ocState.legacy=ch.legacyGroups||[];
   renderOpChoice();
  }catch(e){
   list.innerHTML=`<div class="mm-empty">選択肢を読み込めませんでした: ${esc(e.message||String(e))}</div>`;
  }
 }
 function ocSay(text,bad){
  const el=$('#ocState');if(!el)return;
  el.textContent=text||'';el.classList.toggle('is-bad',!!bad);
 }
 function renderOpChoice(){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  const picked=ocPickedName();
  ocState.picked=picked;
  /* **器の高さを中まで届ける**（§9.222 ⑤）。この画面だけ外側のスクロールを
     やめて、内側（まとまりの一覧・値の一覧）だけを流す。**印を外すのは
     `loadMaintInner()`の1箇所**——外し忘れると他のタブの一覧が
     スクロールしない枠になって行が切れる。 */
  list.classList.add('is-fill');
  list.parentElement&&list.parentElement.classList.add('is-fill');
  form.innerHTML=`<div class="op-bar">`
   +`<span class="op-bar-note">左が<b>まとまり</b>、右がその中の<b>値</b>です。`
   +`項目マスタの「選択肢」はこの<b>まとまり名</b>で結び付きます。</span>`
   +`<button type="button" id="ocAddGroup" class="ghost">まとまりを追加</button>`
   +`<span class="op-bar-state" id="ocState"></span></div>`;
  list.innerHTML=`<div class="oc-edit">${ocGroupPaneHtml(picked)}${ocValuePaneHtml(picked)}</div>`;
  bindOpChoice();
 }
 /* まとまりを選ぶ（§9.226 ①、利用者の指摘「選択するたびスクロールが一番上に
    戻るので位置がずれ使いづらい」）。**左の一覧のDOMは作り直さない**——
    作り直すと`scrollTop`が0へ戻り、17件を上から数え直すことになる。
    右の値の欄だけを差し替え、印（`is-on`）は付け替えるだけにする。
    それでも作り直す経路（読み込み直し）が残るので、位置は`ocState.scroll`に
    覚えて`bindOpChoice()`が戻す。 */
 function ocSelectGroup(name){
  const n=String(name||'');
  if(!n||ocState.picked===n)return;
  ocState.picked=n;
  const list=$('#masterMaintList');
  const pane=list&&list.querySelector('.oc-values');
  if(!pane){renderOpChoice();return}
  pane.outerHTML=ocValuePaneHtml(n);
  list.querySelectorAll('[data-oc-group]').forEach(b=>
    b.classList.toggle('is-on',b.dataset.ocGroup===n));
  bindOpChoice();
 }
 function ocGroupPaneHtml(picked){
  const q=String(ocState.q||'').trim().toLowerCase();
  const all=ocState.groups||[];
  const hit=q?all.filter(g=>g.name.toLowerCase().includes(q)
    ||ocRows(g.name).some(r=>String(r.value).toLowerCase().includes(q)
      ||String(r.reading||'').toLowerCase().includes(q))):all;
  return `<div class="oc-groups">
    <div class="oc-groups-head">
     <b>まとまり</b><span class="oc-count">${all.length}件</span>
     <input type="search" id="ocSearch" value="${esc(ocState.q||'')}" placeholder="まとまり名・値・よみで絞る" autocomplete="off">
    </div>
    <div class="oc-group-list">${hit.map(g=>{
      const used=(g.usedBy||[]).length;
      return `<button type="button" class="oc-group${g.name===picked?' is-on':''}" data-oc-group="${esc(g.name)}"
        title="${esc(g.name)}／${g.count}値${g.live<g.count?`（使えるのは${g.live}）`:''}／${used?`${used}項目が使用`:'まだどの項目からも使われていません'}">
       <b>${esc(g.name)}</b>
       <span class="oc-group-sub">
        <span class="oc-group-meta">${g.count}値${g.live<g.count?`（使えるのは${g.live}）`:''}</span>
        <span class="oc-group-use">${used?`${used}項目が使用`:'未使用'}</span>
       </span>
      </button>`}).join('')
      ||`<p class="mm-empty">${q?'絞り込みに当たるまとまりがありません。':'まとまりがまだありません。'}</p>`}</div>
   </div>`;
 }
 function ocValuePaneHtml(name){
  if(!name)return `<div class="oc-values"><p class="mm-empty">左で<b>まとまり</b>を選ぶか、「まとまりを追加」で作ります。</p></div>`;
  const rows=ocRows(name);
  const used=ocState.usage[name]||[];
  const legacy=(ocState.legacy||[]).includes(name);
  const eqs=(equipmentMasterState.items||[]).map(e=>e.name).filter(Boolean);
  return `<div class="oc-values">
    <div class="oc-values-head">
     <label class="oc-name">まとまり名<input type="text" id="ocGroupName" value="${esc(name)}" autocomplete="off"></label>
     <button type="button" id="ocRename" class="mm-btn-ghost sm">名前を変える</button>
     <button type="button" id="ocDeleteGroup" class="mm-btn-ghost sm danger"${used.length?' disabled':''}>まとまりごと削除</button>
     <span class="oc-use">${used.length
       ?`使っている項目: ${esc(used.slice(0,6).join('、'))}${used.length>6?` ほか${used.length-6}件`:''}`
       :'まだどの項目からも使われていません。'}</span>
     ${legacy?`<span class="oc-legacy">オペレータ・機器などの専用マスタから移してきたまとまりです。測定画面の欄はこの並びを見ます。</span>`:''}
    </div>
    <div class="oc-table" role="table">
     <div class="oc-row is-head" role="row">
      <span></span><span>値</span><span>説明</span><span>よみ</span><span>出る設備</span><span title="この値が測定画面で選ばれた回数です。項目マスタで「選択肢の並び」を『よく使う順』にすると、この回数の多いものから並びます（§9.248 ⑤）">使用</span><span>出す</span><span></span>
     </div>
     <div class="oc-table-scroll">
      ${rows.map(r=>ocValueRowHtml(r)).join('')
        ||'<p class="mm-empty">値がまだありません。下の「値を追加」から入れます。</p>'}
     </div>
    </div>
    <div class="oc-add">
     <button type="button" id="ocAddValue" class="mm-btn-primary">値を追加</button>
     <span class="oc-add-note">行を押すと<b>同じ窓</b>で直せます（値・説明・よみ・出る設備・出す・表示順）。</span>
    </div>
    <datalist id="ocEqList">${eqs.map(n=>`<option value="${esc(n)}"></option>`).join('')}</datalist>
   </div>`;
 }
 /* 出る設備の見え方。**タグで出す**（§9.222 ⑥）——カンマ区切りの生の文字列は
    どこまでが1つの設備名なのか読み取れない。空欄は「すべて」と**文字で**言う
    （§3。空欄のままだと未設定なのか全部なのか推測させる）。 */
 function ocEqTagsHtml(raw){
  const v=String(raw||'').trim();
  if(!v)return '<span class="oc-eq-tag is-all">すべての設備</span>';
  if(v===EQUIPMENT_ALL)return '<span class="oc-eq-tag is-all">すべての設備</span>';
  return v.replace(/、/g,',').split(',').map(x=>x.trim()).filter(Boolean)
    .map(n=>`<span class="oc-eq-tag">${esc(n)}</span>`).join('');
 }
 /* 1行＝1値。**中身は読むだけ**（§9.222 ⑥）。以前は5つの入力欄を行の中へ
    並べていたが、①見出しと本文で列幅の`em`が別の文字サイズで解け、左端が
    ずれる（§9.193）②設備がカンマ区切りの手打ちでサジェストが効かない
    ③登録用の行は3マスしか無く表の7列と対応していない、の3つが同時に出ていた
    （利用者の指摘そのもの）。編集は**汎用モーダル1枚**に寄せてある。
    行に残すのは「出す/出さない」（毎日触る）と削除と並べ替えの取っ手だけ。 */
 function ocValueRowHtml(r){
  return `<div class="oc-row" role="row" draggable="true" data-oc-id="${r.id}"
     title="押すと編集の窓が開きます">
    <span class="oc-grip" title="ドラッグで並べ替えます" aria-hidden="true">⠿</span>
    <span class="oc-cell" title="${esc(r.value)}">${esc(r.value)}</span>
    <span class="oc-cell is-sub${r.note?'':' is-blank'}" title="${esc(r.note||'（説明なし）')}">${esc(r.note||'—')}</span>
    <span class="oc-cell is-sub${r.reading?'':' is-blank'}" title="${esc(r.reading||'（よみなし）')}">${esc(r.reading||'—')}</span>
    <span class="oc-eq-tags" title="${esc(ocEqLabel(r.equipment))}">${ocEqTagsHtml(r.equipment)}</span>
    <span class="oc-used${Number(r.used)?'':' is-blank'}" title="${
      Number(r.used)?`測定画面でこの値が選ばれた回数です（${Number(r.used)}回）。項目マスタで「選択肢の並び」を『よく使う順』にすると、この回数の多いものから並びます`
                    :'測定画面でまだ1度も選ばれていません'
     }">${Number(r.used)||'—'}</span>
    <label class="oc-on" title="外すと選択肢に出なくなります（記録は消えません）">
     <input type="checkbox" data-oc-f="enabled"${r.enabled?' checked':''}><span>${r.enabled?'出す':'出さない'}</span></label>
    <button type="button" class="oc-del" title="この値を削除します">削除</button>
   </div>`;
 }
 async function ocSaveRow(id,patch){
  const row=(ocState.items||[]).find(x=>String(x.id)===String(id));if(!row)return;
  const uid=requireMaintUser();if(uid===null)return;
  const body={id:row.id,user_id:uid,name:row.name,value:row.value,note:row.note||'',
    reading:row.reading||'',equipment:row.equipment||'',enabled:row.enabled!==false,...patch};
  try{
   ocSay('保存しています…');
   await api('/api/operation-choice-master/update',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   ocSay('保存しました');
   if(window.WL&&WL.opData)WL.opData.forget();
   await loadOpChoiceMaint(true);
  }catch(e){ocSay('保存できませんでした: '+(e.message||String(e)),true)}
 }
 function bindOpChoice(){
  const list=$('#masterMaintList');if(!list)return;
  const add=$('#ocAddGroup');
  if(add)add.onclick=()=>ocCreateGroup();
  /* **入力中に一覧を作り直さない**（§9.117）——入力欄を作り替えると
     1文字ごとにカーソルが飛ぶ。絞り込みは左の一覧だけを描き直す。 */
  const q=$('#ocSearch');
  if(q)q.oninput=()=>{
   ocState.q=q.value;
   const pane=list.querySelector('.oc-groups');
   if(!pane)return;
   const at=q.selectionStart;
   pane.outerHTML=ocGroupPaneHtml(ocPickedName());
   const again=$('#ocSearch');
   if(again){again.focus();try{again.setSelectionRange(at,at)}catch(e){}}
   list.querySelectorAll('[data-oc-group]').forEach(b=>b.onclick=()=>ocSelectGroup(b.dataset.ocGroup));
  };
  list.querySelectorAll('[data-oc-group]').forEach(b=>b.onclick=()=>ocSelectGroup(b.dataset.ocGroup));
  /* **スクロールの位置を覚える**（下の`ocSelectGroup`の但し書きと同じ理由）。
     読み込み直しのあと（`renderOpChoice`）は一覧ごと作り直すので、覚えて
     いないと戻せない。 */
  const gl=list.querySelector('.oc-group-list');
  if(gl){
   gl.scrollTop=Number(ocState.scroll)||0;
   gl.addEventListener('scroll',()=>{ocState.scroll=gl.scrollTop},{passive:true});
  }
  const rename=$('#ocRename');
  if(rename)rename.onclick=()=>ocRenameGroup();
  const delg=$('#ocDeleteGroup');
  if(delg)delg.onclick=()=>ocDeleteGroup();
  const addv=$('#ocAddValue');
  if(addv)addv.onclick=()=>ocOpenEditor(null);
  list.querySelectorAll('.oc-row[data-oc-id]').forEach(row=>{
   const id=row.dataset.ocId;
   /* **押したら同じ窓で直す**（§9.222 ⑥）。行の中の入力欄をやめたので、
      編集の入口は行そのもの——「出す/出さない」と削除だけは行で完結する
      （毎日触るものと、取り消しの効くものを窓へ隠さない）。 */
   row.onclick=e=>{
    if(e.target.closest('.oc-on')||e.target.closest('.oc-del')||e.target.closest('.oc-grip'))return;
    ocOpenEditor(id);
   };
   const on=row.querySelector('input[data-oc-f="enabled"]');
   if(on)on.onchange=()=>ocSaveRow(id,{enabled:on.checked});
   const del=row.querySelector('.oc-del');
   if(del)del.onclick=e=>{e.stopPropagation();ocDeleteValue(id)};
  });
  ocBindReorder(list);
 }
 /* 汎用モーダルで1件を編集する（§9.222 ⑥）。**新しい編集画面を作らない**
    ——`MASTER_DEFS`の`fields`がそのまま効くので、設備はタグ入力になり、
    欄の幅は型から決まる規格幅になり、保存でモーダルが閉じる（§9.221 ④）。
    新規のときは**いま選んでいるまとまり名を入れておく**（前の画面の文脈を
    こちらが運ぶ・§CLAUDE 画面基準）。 */
 function ocOpenEditor(id){
  const name=ocPickedName();
  if(!name){ocSay('先に左でまとまりを選んでください。',true);return}
  const row=id?(ocState.items||[]).find(x=>String(x.id)===String(id)):null;
  const item=row
   ?{...row,enabledText:row.enabled===false?'出さない':'出す'}
   :{name,value:'',note:'',reading:'',equipment:'',enabledText:'出す',order:''};
  /* 新規は`id`を持たせない（`openMaintEditor`は`id`の有無で「編集/新規」を
     決める）。既定値だけを積んだ器を渡す。 */
  if(!row)delete item.id;
  openMaintEditor(row?item:Object.assign({__new__:true},item));
  /* 新規のときだけ「追加登録」に見せる。`openMaintEditor`は渡した器を
     `編集`と見なすので、題と保存ボタンの文言だけ言い直す。 */
  if(!row){
   const t=$('#maintEditorTitle');if(t)t.textContent=`「${name}」に値を追加`;
   const sv=$('#maintEditorSave');if(sv)sv.textContent='追加登録';
   const h=$('#maintEditorHint');if(h)h.textContent='値は必ず入れてください。まとまり名は選んでいるものが入っています。';
   maintState.editing=null;                 /* 保存はPOST（新規）で行く */
  }
 }
 /* 並べ替えは**まとめて1回**で書く（§9.221 ②）。1行ずつ送ると往復が増え、
    途中で切れると半分だけ動いた並びが残る。 */
 function ocBindReorder(list){
  let from=null;
  list.querySelectorAll('.oc-row[data-oc-id]').forEach(row=>{
   row.addEventListener('dragstart',e=>{from=row;row.classList.add('is-drag');
    try{e.dataTransfer.setData('text/plain',row.dataset.ocId)}catch(err){}});
   row.addEventListener('dragend',()=>{
    row.classList.remove('is-drag');
    if(!from)return;
    from=null;
    const ids=[...list.querySelectorAll('.oc-row[data-oc-id]')].map(x=>Number(x.dataset.ocId));
    ocSaveOrder(ids);
   });
   row.addEventListener('dragover',e=>{
    if(!from||from===row)return;
    e.preventDefault();
    const r=row.getBoundingClientRect();
    row.parentNode.insertBefore(from,(e.clientY-r.top)<r.height/2?row:row.nextSibling);
   });
  });
 }
 async function ocSaveOrder(ids){
  const uid=requireMaintUser();if(uid===null)return;
  try{
   ocSay('並びを保存しています…');
   await api('/api/operation-choice-master/reorder',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({ids,user_id:uid})});
   ocSay('並びを保存しました');
   if(window.WL&&WL.opData)WL.opData.forget();
   await loadOpChoiceMaint(true);
  }catch(e){ocSay('並びを保存できませんでした: '+(e.message||String(e)),true)}
 }
 async function ocCreateGroup(){
  const name=await promptModal({title:'まとまりを追加',label:'まとまり名',
    hint:'操業データ項目の「選択肢」からこの名前で参照します（例: リング色）。'});
  if(!name)return;
  const uid=requireMaintUser();if(uid===null)return;
  try{
   await api('/api/operation-choice-master',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({name,value:'（未設定）',user_id:uid})});
   ocState.picked=name;
   if(window.WL&&WL.opData)WL.opData.forget();
   await loadOpChoiceMaint(true);
   ocSay('「'+name+'」を作りました。値を入れ替えてください。');
  }catch(e){ocSay('作れませんでした: '+(e.message||String(e)),true)}
 }
 /* 値の追加は`ocOpenEditor(null)`＝汎用モーダル1枚に寄せた（§9.222 ⑥）。
    以前あった行内の2つの入力欄（値・説明）は**表の7列と対応していなかった**
    ので消してある。 */
 async function ocRenameGroup(){
  const from=ocPickedName();
  const el=$('#ocGroupName');const to=String(el&&el.value||'').trim();
  if(!to||to===from)return;
  const used=ocState.usage[from]||[];
  const ok=await confirmModal({title:'まとまり名を変えますか？',
    bodyHtml:`<p class="confirm-modal-message">「${esc(from)}」を「${esc(to)}」へ変えます。`
     +(used.length?`この名前を使っている <b>${used.length}件の項目</b>（${esc(used.slice(0,4).join('、'))}）も一緒に付け替えます。`
       :'この名前を使っている項目はありません。')+`</p>`,confirmLabel:'変える'});
  if(!ok)return;
  const uid=requireMaintUser();if(uid===null)return;
  try{
   const r=await api('/api/operation-choice-master/rename-group',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({from,to,user_id:uid})});
   ocState.picked=to;
   if(window.WL&&WL.opData)WL.opData.forget();
   await loadOpChoiceMaint(true);
   ocSay(r.message||'名前を変えました');
  }catch(e){ocSay('名前を変えられませんでした: '+(e.message||String(e)),true)}
 }
 async function ocDeleteGroup(){
  const name=ocPickedName();if(!name)return;
  const rows=ocRows(name);
  const ok=await confirmModal({title:'まとまりごと削除しますか？',danger:true,
    bodyHtml:`<p class="confirm-modal-message">「${esc(name)}」の値 <b>${rows.length}件</b>をまとめて削除します。取り消せません。</p>`,
    confirmLabel:'削除する'});
  if(!ok)return;
  const uid=requireMaintUser();if(uid===null)return;
  try{
   await api('/api/operation-choice-master/delete-group',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({name,user_id:uid})});
   ocState.picked='';
   if(window.WL&&WL.opData)WL.opData.forget();
   await loadOpChoiceMaint(true);
  }catch(e){ocSay('削除できませんでした: '+(e.message||String(e)),true)}
 }
 async function ocDeleteValue(id){
  const row=(ocState.items||[]).find(x=>String(x.id)===String(id));if(!row)return;
  const ok=await confirmModal({title:'この値を削除しますか？',danger:true,
    bodyHtml:`<p class="confirm-modal-message">「${esc(row.name)}」から <b>${esc(row.value)}</b> を削除します。`
     +`既に記録されている値は消えませんが、選択肢からは無くなります。</p>`,confirmLabel:'削除する'});
  if(!ok)return;
  const uid=requireMaintUser();if(uid===null)return;
  try{
   await api('/api/operation-choice-master/delete',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({id:row.id,user_id:uid})});
   if(window.WL&&WL.opData)WL.opData.forget();
   await loadOpChoiceMaint(true);
  }catch(e){ocSay('削除できませんでした: '+(e.message||String(e)),true)}
 }
 /* 1行だけ書かせる小さな窓。**`prompt()`は使わない**（アプリの見た目に
    合わせられず、タブ全体を止める。`confirmModal`と同じ理由）。 */
 function promptModal(opts){
  const o=opts||{};
  return confirmModal({title:o.title||'入力',confirmLabel:o.confirmLabel||'決定',
    bodyHtml:`<label class="mm-field mm-w-md"><span>${esc(o.label||'')}</span>`
     +`<input type="text" id="appPromptInput" value="${esc(o.value||'')}" autocomplete="off"></label>`
     +(o.hint?`<small class="mm-field-hint">${esc(o.hint)}</small>`:'')
  }).then(ok=>{
   const el=document.getElementById('appPromptInput');
   const v=String(el&&el.value||'').trim();
   return ok?v:'';
  });
 }
 async function loadOpItemMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.classList.remove('mm-form-compact');
  if(typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){}}
  if(!list.querySelector('.op-edit'))list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const q=opState.equipment?('?equipment='+encodeURIComponent(opState.equipment)):'';
   const [it,ch]=await Promise.all([
     api('/api/operation-item-master'+q),
     api('/api/operation-choice-master')]);
   opState.items=(it.items||[]).map(x=>({...x}));
   opState.types=it.types||opState.types;
   opState.places=it.places||opState.places;
   opState.spans=it.spans||opState.spans;
   opState.gridCols=it.gridCols||opState.gridCols;
   opState.spanUnit=it.spanUnit||opState.spanUnit;
   opState.widgets=it.widgets||opState.widgets;
   opState.choiceTypes=it.choiceTypes||opState.choiceTypes;
   opState.numberTypes=it.numberTypes||opState.numberTypes;
   opState.widgetFamilies=it.widgetFamilies||opState.widgetFamilies;
   opState.unitPlaces=it.unitPlaces||opState.unitPlaces;
   opState.aligns=it.aligns||opState.aligns;
   opState.valueFormats=it.valueFormats||opState.valueFormats;
   opState.unitInBlocked=it.unitInBlocked||opState.unitInBlocked;
   opState.unitInFreeTextBlocked=it.unitInFreeTextBlocked||opState.unitInFreeTextBlocked;
   /* 手打ちの席が無い入力方法（§9.247 ①）。**規則はサーバーが持つ**ので、
      画面は一覧を引くだけ（判定を2つ持たない・§9.163）。 */
   opState.freeTextBlocked=it.freeTextBlocked||opState.freeTextBlocked;
   /* §9.248 ⑤ 選択肢の並びの語彙と、それが効く入力方法。 */
   opState.choiceOrders=it.choiceOrders||opState.choiceOrders;
   opState.choiceOrderWidgets=it.choiceOrderWidgets||opState.choiceOrderWidgets;
   /* §9.286 ⑥ 未入力・未選択の配色の語彙。**サーバーが答える**——色の鍵は
      `WL.columnTint.PALETTE`と揃える約束なので、画面へ写すと片方だけ
      増えた状態が作れる（§9.163）。 */
   opState.blankTints=it.blankTints||opState.blankTints;
   opState.blankTintNone=it.blankTintNone||opState.blankTintNone;
   /* §9.248 ① 選ばせ方のまとまり（盤の見出しと並び）。 */
   opState.widgetGroups=it.widgetGroups||opState.widgetGroups;
   /* §9.231 ②。**いまの値も一緒に来る**（選んだ設備で引き直した結果）。 */
   opState.limitSources=it.limitSources||opState.limitSources;
   /* §9.233 ⑤ */
   opState.sourceNotePlaces=it.sourceNotePlaces||opState.sourceNotePlaces;
   opState.sourceNoteKeys=it.sourceNoteKeys||opState.sourceNoteKeys;
   opState.autoFills=it.autoFills||opState.autoFills;
   opState.autoValues=it.autoValues||opState.autoValues;
   /* §9.256。式で作る自動値の鍵（画面へ綴りを書き写さない・§9.163）。 */
   opState.autoFormulaKey=it.autoFormulaKey||opState.autoFormulaKey||'';
   opState.layouts=it.layouts||opState.layouts;
   opState.layoutWidgets=it.layoutWidgets||opState.layoutWidgets;
   opState.typeFamilies=it.typeFamilies||opState.typeFamilies;
   opState.builtinFamilies=it.builtinFamilies||opState.builtinFamilies;
   opState.notes=it.choiceNotes||{};
   opState.choiceNames=ch.names||[];
   opState.choices=ch.items||[];
   opState.usage=ch.usage||it.choiceUsage||{};
   /* 選択肢のまとまり名を勧めるための事実（§9.220 ④）。 */
   opState.choiceHints=it.choiceHints||{};
   /* 役割と構成の状態（§9.223 ①）。**判定はサーバー**——「足りない役割」は
      全体を見て決まるので、画面で数え直すと2つの答えが出る。 */
   opState.roles=it.roles||opState.roles;
   opState.roleReport=it.roleReport||null;
   /* 意匠の軸（§9.223 ③）。 */
   opState.lookColors=it.lookColors||opState.lookColors;
   opState.lookShapes=it.lookShapes||opState.lookShapes;
   opState.lookSizes=it.lookSizes||opState.lookSizes;
   if(opState.picked&&!opItemById(opState.picked)){
    opState.picked=null;
    const m=$('#opItemModal');if(m)m.hidden=true;
   }
   renderOpItem();
   renderOpModal();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 /* ==================================================================
    「記録した値」の配置（§9.243、利用者の指示）
    ------------------------------------------------------------------
      「現在操業データ項目マスタで設定している内容を候補に出して視覚的に
       配置して設定できるようなマスタを別で追加立ち上げして簡単にD&Dで
       配置修正再設定、編集できるようにしてほしいです」

    ③確認の「記録した値」のカードは、操業データ項目マスタの
    `[記録表示]`／`[記録群]`／`[記録順]`の3列だけで決まる。設定窓の①に
    ある入切だけでは、**並べたときにどう見えるか**が分からない
    （操業データ項目の盤を`special`にしたのと同じ理由・§9.216 ④）。

    盤は**カードと同じ形**で描く——左が候補（出していない項目）、右が
    実際のカード（群ごとの塊）。掴んで動かせば並びと群が決まる。

    **設備は「絞って見ている」だけ**で、並び自体は設備によらず共通
    （`record_layout_save`は行そのものを書き換える）。§CLAUDE 6の
    とおり、そのことを画面に書く。

    **操業データ項目の盤とは別の画面**にしてある——あちらは「何を記録
    するか」（型・選択肢・上下限・意匠）で、ここは「どう並べるか」。
    1枚に混ぜると、盤の1枚のカードが2つの並びを同時に表すことになる。
    ================================================================== */
 const rlState={equipment:'',items:[],rows:null,busy:false,
                /* 同じ群がばらけて保存されていたのを盤でまとめ直したか
                   （§9.219 ③）。黙って直すと、保存されている形と見えている
                   形が食い違ったままになるので画面に書く。 */
                healed:false,
                /* 掴んでいる項目のID（文字列）。**素の`window.*`を増やさない**。 */
                drag:null};
 /* この項目がカードのどの群に出るか。**空＝この項目の`[群]`に従う**
    （`measure-opdata.js`の`recordGroupOf`と同じ判定——2つ持つと、盤で見た
    見出しと測定画面の見出しが食い違う）。 */
 const rlGroupOf=x=>String(x.recordGroup||'').trim()||String(x.group||'').trim()||'その他';
 const rlOwnGroup=x=>String(x.group||'').trim()||'その他';
 /* 盤に出す候補（`measure-opdata.js`の`recordRows()`が拾う条件と同じ）。
    **空きのカードは出さない**（入力欄を一度も描かないので記録が無い・§9.227 ③）。 */
 const rlCandidates=()=>(rlState.items||[]).filter(x=>!x.dummy&&x.enabled!==false);
 /* 盤の並び。保存済みの`[記録順]`があればその順、無ければ`[表示順]`のまま
    （`recordRows()`の「決めた項目だけを前後させる」と揃える——ここで別の
    並べ方をすると、盤で見た順と測定画面の順が食い違う）。 */
 function rlBuildRows(){
  const list=rlCandidates();
  const out=list.map((x,i)=>{
   const order=(Number.isFinite(Number(x.recordOrder))&&Number(x.recordOrder)>0)?Number(x.recordOrder):null;
   /* **触っていない項目は並びから切り離さない**（§9.243）——`[記録順]`が
      空＝この項目の`[表示順]`に従う。掴んだ項目だけが`follow`を落とす。 */
   return {id:String(x.id),base:i,order,follow:order==null,
           show:x.recordShow!==false,group:rlGroupOf(x)};
  });
  const on=out.filter(r=>r.show);
  const seats=on.map((r,i)=>i).filter(i=>on[i].order!=null);
  if(seats.length>1){
   const moved=seats.map(i=>on[i]).sort((a,b)=>a.order-b.order);
   seats.forEach((seat,k)=>{on[seat]=moved[k]});
  }
  /* **同じ群はまとめて描く**（§9.219 ③と同じ作法）。保存されている並びでは
     同じ群がばらけていることがある（`[表示順]`は置き場ごとの並びなので、
     カードの群と一致する保証が無い）。盤は`renderRecordedValues()`と同じ
     「出てきた順に束ねる」で描くので、**平らな並びのほうも束ねておかないと、
     見えている形と保存される`[記録順]`が食い違う**（盤は1塊なのに、
     保存された順は2つに割れている、という状態が作れる）。 */
  const order=[],bag=new Map();
  on.forEach(r=>{if(!bag.has(r.group)){bag.set(r.group,[]);order.push(r.group)}bag.get(r.group).push(r)});
  const packed=order.flatMap(g=>bag.get(g));
  rlState.healed=packed.some((r,i)=>r!==on[i]);
  return {on:packed,off:out.filter(r=>!r.show)};
 }
 function rlRows(){
  if(!rlState.rows)rlState.rows=rlBuildRows();
  return rlState.rows;
 }
 const rlItemById=id=>(rlState.items||[]).find(x=>String(x.id)===String(id));
 /* 群の並び（出てきた順）。`renderRecordedValues()`と同じ「出てきた順に束ねる」。 */
 function rlGroups(){
  const order=[],bag=new Map();
  rlRows().on.forEach(r=>{
   if(!bag.has(r.group)){bag.set(r.group,[]);order.push(r.group)}
   bag.get(r.group).push(r);
  });
  return order.map(g=>({name:g,rows:bag.get(g)}));
 }
 /* 盤の並びについての案内。**1つの段落にまとめる**（§9.304）——
    「まとめ直した」と「誰が並びを決めているか」は、どちらも
    **「この盤に出ている並びは何なのか」**という同じ問いへの答えなので、
    2段落に分けると先に読まれる側だけが目に入る（実際に「既定へ戻す」を
    押しても、戻ったことを言う文が下に隠れていた）。
    **どちらも言うことが無いときは段落ごと出さない**（自明な文は読まれない・§9.127）。 */
 function rlLegendHtml(fixed,follows){
  const parts=[];
  if(rlState.healed)
   /* **保存が何を書くかで言い方を変える**——掴んで決めた項目が1つも無ければ
      保存は`[記録順]`を**空で**書く（＝表示順へ帰す・§9.243 ②）ので、
      「この形で確定します」は嘘になる。まとめて見せているのは表示だけで、
      ③確認のカードも同じ「出てきた順に束ねる」で描く。 */
   parts.push('同じ群がばらばらの位置にあるので、盤では<b>群ごとにまとめて</b>出しています'
     +(fixed?'（<b>保存を押すと、この形で確定します</b>）':'（③確認のカードも同じようにまとめます）')+'。');
  if(fixed&&follows)
   parts.push(`<b>${fixed}件</b>はこの盤で並びを決めています（実線）。`
     +`<b>${follows}件</b>は項目の「表示順」に従います（点線）。`
     +'「既定へ戻す」で全部を表示順へ帰せます。');
  else if(follows)
   parts.push('並びは<b>それぞれの項目の「表示順」</b>に従っています。'
     +'掴んで動かした項目だけが、この盤の並びで固定されます。');
  return parts.length?`<p class="rl-hint rl-legend">${parts.join('')}</p>`:'';
 }
 function rlSay(text,bad){
  const el=$('#rlState');if(!el)return;
  el.textContent=text||'';el.classList.toggle('is-bad',!!bad);
 }
 function rlChipHtml(r,off){
  const x=rlItemById(r.id);if(!x)return '';
  const auto=!!(x.autoValue||x.autoFill);
  const follow=!!r.follow;
  const unit=String(x.unit||'').trim();
  const own=rlOwnGroup(x);
  /* **出どころを書く**（§CLAUDE 6）——この項目が測定画面のどこに居るか。
     同じ名前の欄が準備と入力内容の両方にあることがある。 */
  const tip=[x.name,`測定画面: ${x.place||'準備'}／${own}`,
             unit?`単位 ${unit}`:'',
             auto?'自動で入る値（人は打たない）':'',
             (!off&&rlGroupOf(x)!==own)?`カードでは「${rlGroupOf(x)}」へ移してあります`:'',
             /* **どちらの並びで出ているかを書く**（§CLAUDE 6）——同じ位置でも、
                項目の表示順に追随しているのか、この盤で決めたのかで
                「直す場所」が違う。 */
             off?'':(follow?'並び: この項目の表示順に従う':'並び: この盤で決めた')
            ].filter(Boolean).join(' ／ ');
  return `<div class="rl-chip${auto?' is-auto':''}${(!off&&follow)?' is-follow':''}" draggable="true" data-rl-id="${esc(String(x.id))}"`
   +` title="${esc(tip)}"><b>${esc(x.name)}</b>`
   +(unit?`<i>${esc(unit)}</i>`:'')
   +`<span class="rl-chip-from">${esc(x.place||'準備')}／${esc(own)}</span>`
   +(auto?'<em class="rl-chip-auto">自動</em>':'')
   +`<button type="button" class="rl-chip-x" data-rl-${off?'add':'off'}="${esc(String(x.id))}"`
   +` title="${off?'このカードに出す':'このカードから外す（項目そのものは消えません）'}">${off?'＋':'✕'}</button></div>`;
 }
 function renderRecordLayout(){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.classList.remove('mm-form-compact');
  const eqs=(equipmentMasterState.items||[]).map(e=>e.name).filter(Boolean);
  form.innerHTML=`<div class="op-bar">`
   +`<label class="op-bar-eq" title="どの設備の項目を候補に出すかです。並び自体は設備によらず共通です。">`
   +`候補に出す設備<select id="rlEqPick">`
   +`<option value="">共通（すべての設備）</option>`
   +eqs.map(n=>`<option value="${esc(n)}"${rlState.equipment===n?' selected':''}>${esc(n)}</option>`).join('')
   +`</select></label>`
   /* **設備で絞っているのは候補だけ**だと書く（§CLAUDE 6）——書かないと、
      設備ごとに別の並びを作れると読まれる。 */
   +`<span class="op-bar-scope"><b>並びは設備によらず共通</b>です`
   +`<i>（上の設備は、候補に出す項目を絞るためだけのものです）</i></span>`
   +`<button type="button" id="rlAddGroup" class="ghost"`
   +` title="カードの中だけの見出しを1つ足します（測定画面の入力欄の群は変わりません）">群を追加</button>`
   +`<button type="button" id="rlReset" class="ghost"`
   +` title="カードの並びと見出しを、それぞれの項目の「群」「表示順」に従う状態へ戻します">既定へ戻す</button>`
   +`<button type="button" id="rlSave" class="primary">保存</button>`
   +`<span class="op-bar-state" id="rlState"></span>`
   /* **案内は最後の行へ回す**（§9.199／§9.211 ③）——`op-bar`は折り返す帯なので、
      長い文を先に置くと**「保存」だけが2行目へこぼれる**（実機の見え方で確認）。 */
   +`<span class="op-bar-note rl-note">右の盤が<b>③確認の「記録した値」のカード</b>そのものです。`
   +`掴んで動かすと<b>並び</b>が決まり、<b>別の群へ落とせば見出しも変わります</b>。`
   +`左へ落とすとカードから外れます（項目そのものは消えません）。</span></div>`;
  const groups=rlGroups(),off=rlRows().off;
  const total=rlRows().on.length;
  const follows=rlRows().on.filter(r=>r.follow).length,fixed=total-follows;
  list.innerHTML=`<div class="rl-edit">`
   +`<div class="rl-pool" data-rl-pool="1">`
   +`<h4>候補<small title="${esc('このカードに出していない項目 '+off.length+'件')}">${off.length}</small></h4>`
   +`<p class="rl-hint">カードに出していない項目です。右へ掴んで落とすと出ます。</p>`
   +(off.length?`<div class="rl-pool-list">${off.map(r=>rlChipHtml(r,true)).join('')}</div>`
     :`<p class="mm-empty">すべての項目をカードに出しています。</p>`)
   +`</div>`
   +`<div class="rl-board">`
   +`<h4>③確認のカード<small title="${esc('このカードに出す項目 '+total+'件・'+groups.length+'群')}">`
   +`${total}件・${groups.length}群</small></h4>`
   /* **状態は色だけで伝えない**（§3）——点線の印が何なのかを件数つきの文で言う。
      **どちらも0のときは書かない**（自明な文は読まれない・§9.127）。 */
   /* **案内は1行にまとめる**（§9.304、CLAUDE 画面基準 8）。以前は
      「まとめ直した」（§9.219 ③）と「誰が並びを決めているか」を**別々の
      段落**で出しており、どちらも「この盤に出ている並びは何なのか」という
      **同じ問い**に答えていた。しかも上の段落だけが常に先に読まれるので、
      「既定へ戻す」を押しても**戻ったことが読める文が下に隠れた**。
      **まとめ直したことの言い方は、保存が何を書くかで変える**——掴んで
      決めた項目が1つも無いときに保存が書くのは**空**（＝表示順へ帰す・
      §9.243 ②）なので、「この形で確定します」は嘘になる。 */
   +(rlLegendHtml(fixed,follows))
   +(groups.length?groups.map(g=>`<div class="rl-group" data-rl-group="${esc(g.name)}">`
     +`<b><span class="rl-group-name" data-rl-rename="${esc(g.name)}"`
     +` title="押すと見出しの名前を変えられます">${esc(g.name)}</span>`
     +`<small title="${esc('この群の項目 '+g.rows.length+'件')}">${g.rows.length}</small></b>`
     +`<div class="rl-group-list" data-rl-drop="${esc(g.name)}">`
     +g.rows.map(r=>rlChipHtml(r,false)).join('')+`</div></div>`).join('')
     :`<p class="mm-empty">カードに出す項目がありません。左の候補から掴んで落としてください。</p>`)
   +`</div></div>`;
  bindRecordLayout();
 }
 /* 落とす場所の印は**流れの中へ入れない**（§9.218 ④）——入れた瞬間に
    後ろのカードがずれ、同じカーソル位置なのに違う境目がいちばん近くなって
    印が往復する。器の座標へ浮かせて置く。 */
 function rlMark(box,at){
  const r=box.getBoundingClientRect();
  let x,y,h;
  if(at){const a=at.getBoundingClientRect();x=a.left-r.left;y=a.top-r.top;h=a.height}
  else{
   const kids=[...box.children].filter(el=>el.dataset.rlMark===undefined);
   const last=kids[kids.length-1];
   if(!last){rlClearMark();return}
   const a=last.getBoundingClientRect();x=a.right-r.left;y=a.top-r.top;h=a.height;
  }
  let m=box.querySelector(':scope>[data-rl-mark]');
  if(!m){m=document.createElement('div');m.className='rl-drop-mark';m.dataset.rlMark='1';box.appendChild(m)}
  m.style.left=(x-2)+'px';m.style.top=y+'px';m.style.height=h+'px';
 }
 function rlClearMark(){
  document.querySelectorAll('[data-rl-mark]').forEach(x=>x.remove());
  document.querySelectorAll('.rl-group.is-drop').forEach(x=>x.classList.remove('is-drop'));
  document.querySelectorAll('.rl-pool.is-drop').forEach(x=>x.classList.remove('is-drop'));
 }
 /* 落とし先は**カーソルの真下の札**で決める（§9.230 ①）。段に丸めると、
    横に並んだ札の境目が選ばれて印が隣の群へ飛ぶ。 */
 function rlDropAt(box,ev){
  const kids=[...box.children].filter(el=>
    el.dataset.rlMark===undefined&&!el.classList.contains('is-dragging')
    &&el.getBoundingClientRect().height>0);
  if(!kids.length)return null;
  let best=null,bestD=Infinity;
  kids.forEach(el=>{
   const a=el.getBoundingClientRect();
   const cx=a.left+a.width/2,cy=a.top+a.height/2;
   const d=Math.abs(ev.clientY-cy)*4+Math.abs(ev.clientX-cx);
   if(d<bestD){bestD=d;best=el}
  });
  if(!best)return null;
  const a=best.getBoundingClientRect();
  return ev.clientX<a.left+a.width/2?best:(best.nextElementSibling&&best.nextElementSibling.dataset.rlMark===undefined?best.nextElementSibling:null);
 }
 /* 掴んだ項目を group（null＝候補へ戻す）の beforeId の前へ移す。
    **ヘッドレスではD&Dの座標を作れない**ので、網はここを直に呼ぶ（§9.218 ④）。 */
 function rlMove(id,group,beforeId){
  const rows=rlRows();
  const key=String(id);
  const cur=rows.on.find(r=>r.id===key)||rows.off.find(r=>r.id===key);
  if(!cur)return false;
  rows.on=rows.on.filter(r=>r.id!==key);
  rows.off=rows.off.filter(r=>r.id!==key);
  if(group===null||group===undefined){rows.off.push({...cur,show:false});return true}
  /* **掴んで置いた項目は並びから切り離す**——ここで`follow`を落とさないと、
     保存しても`[記録順]`がNULLのままで、盤で決めた位置が測定画面に出ない。 */
  const moved={...cur,show:true,follow:false,group:String(group)};
  const at=beforeId?rows.on.findIndex(r=>r.id===String(beforeId)):-1;
  if(at>=0)rows.on.splice(at,0,moved);
  else{
   /* 群の末尾へ——その群の最後の項目の直後（群がばらけないように）。 */
   let last=-1;
   rows.on.forEach((r,i)=>{if(r.group===moved.group)last=i});
   if(last>=0)rows.on.splice(last+1,0,moved);else rows.on.push(moved);
  }
  return true;
 }
 function bindRecordLayout(){
  const pick=$('#rlEqPick');
  if(pick)pick.onchange=()=>{rlState.equipment=pick.value;rlState.rows=null;loadRecordLayoutMaint(true)};
  const save=$('#rlSave');if(save)save.onclick=()=>rlSaveLayout();
  const add=$('#rlAddGroup');if(add)add.onclick=()=>rlCreateGroup();
  const reset=$('#rlReset');if(reset)reset.onclick=()=>rlResetLayout();
  document.querySelectorAll('#masterMaintList [data-rl-off]').forEach(b=>{
   b.onclick=e=>{e.stopPropagation();rlMove(b.dataset.rlOff,null);renderRecordLayout();rlSay('保存を押すと確定します')};
  });
  document.querySelectorAll('#masterMaintList [data-rl-add]').forEach(b=>{
   b.onclick=e=>{
    e.stopPropagation();
    const x=rlItemById(b.dataset.rlAdd);
    rlMove(b.dataset.rlAdd,x?rlGroupOf(x):'その他');
    renderRecordLayout();rlSay('保存を押すと確定します');
   };
  });
  document.querySelectorAll('#masterMaintList [data-rl-rename]').forEach(el=>{
   el.onclick=()=>rlRenameGroup(el.dataset.rlRename);
  });
  document.querySelectorAll('#masterMaintList .rl-chip').forEach(t=>{
   t.ondragstart=e=>{
    rlState.drag=t.dataset.rlId;t.classList.add('is-dragging');
    try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',t.dataset.rlId)}catch(_){}
   };
   t.ondragend=()=>{rlState.drag=null;t.classList.remove('is-dragging');rlClearMark()};
  });
  document.querySelectorAll('#masterMaintList .rl-group-list').forEach(box=>{
   box.ondragover=e=>{
    if(!rlState.drag)return;
    e.preventDefault();
    try{e.dataTransfer.dropEffect='move'}catch(_){}
    rlClearMark();
    box.closest('.rl-group')?.classList.add('is-drop');
    rlMark(box,rlDropAt(box,e));
   };
   box.ondrop=e=>{
    if(!rlState.drag)return;
    e.preventDefault();e.stopPropagation();
    const at=rlDropAt(box,e);
    rlMove(rlState.drag,box.dataset.rlDrop,at?at.dataset.rlId:'');
    rlState.drag=null;rlClearMark();renderRecordLayout();rlSay('保存を押すと確定します');
   };
  });
  const pool=$('#masterMaintList [data-rl-pool]');
  if(pool){
   pool.ondragover=e=>{
    if(!rlState.drag)return;
    e.preventDefault();
    try{e.dataTransfer.dropEffect='move'}catch(_){}
    rlClearMark();pool.classList.add('is-drop');
   };
   pool.ondrop=e=>{
    if(!rlState.drag)return;
    e.preventDefault();e.stopPropagation();
    rlMove(rlState.drag,null);
    rlState.drag=null;rlClearMark();renderRecordLayout();rlSay('保存を押すと確定します');
   };
  }
 }
 function rlRenameGroup(from){
  const to=prompt('カードの中の見出しの名前（測定画面の入力欄の群は変わりません）',from);
  if(to===null)return;
  const n=String(to).trim();if(!n||n===from)return;
  rlRows().on.forEach(r=>{if(r.group===from)r.group=n});
  renderRecordLayout();rlSay('保存を押すと確定します');
 }
 function rlCreateGroup(){
  const name=prompt('新しい見出しの名前','新しい見出し');
  if(name===null)return;
  const n=String(name).trim();if(!n)return;
  if(rlGroups().some(g=>g.name===n)){rlSay(`「${n}」は既にあります`,true);return}
  /* **空の群は保存できない**（群は項目行から導出するため・§9.227 ③と同じ）
     ので、候補の先頭を1つ移して群を作る。候補が無ければ断る（§4）。 */
  const off=rlRows().off;
  const src=off[0]||rlRows().on[rlRows().on.length-1];
  if(!src){rlSay('項目が1つも無いので見出しを作れません',true);return}
  rlMove(src.id,n);
  renderRecordLayout();
  /* `rlSay()`は`textContent`へ書くので、ここで`esc()`を通すと実体参照が
     そのまま読めてしまう（同じ文字列をHTMLへ入れないこと）。 */
  rlSay(`「${n}」を作り、${(rlItemById(src.id)||{}).name||''}を移しました（保存を押すと確定します）`);
 }
 function rlResetLayout(){
  /* **戻せること**（§CLAUDE 4）——盤で決めた群・並びを捨てて、それぞれの
     項目の`[群]`と`[表示順]`に従う既定へ帰る。出す/出さないは保つ。 */
  const on=new Set(rlRows().on.map(r=>r.id));
  const list=rlCandidates();
  const mk=(x,i,show)=>({id:String(x.id),base:i,order:null,follow:true,show,group:rlOwnGroup(x)});
  rlState.rows={
   on:list.filter(x=>on.has(String(x.id))).map((x,i)=>mk(x,i,true)),
   off:list.filter(x=>!on.has(String(x.id))).map((x,i)=>mk(x,i,false))};
  renderRecordLayout();
  rlSay('それぞれの項目の「群」「表示順」に従う並びへ戻しました（保存を押すと確定します）');
 }
 async function rlSaveLayout(){
  if(rlState.busy)return;
  const uid=requireMaintUser();if(uid===null)return;
  const rows=rlRows();
  /* **群が項目自身の`[群]`と同じなら空で書く**——空＝追随なので、あとで
     項目の群を変えたときにカードの見出しも一緒に動く（§9.243）。 */
  const body=rows.on.map(r=>{
   const x=rlItemById(r.id);
   /* **群も並びも「同じなら空で書く」**——空＝追随なので、あとで項目の
      群や表示順を変えたときカードも一緒に動く（§9.243）。 */
   return {id:r.id,show:true,follow:!!r.follow,
           group:(x&&rlOwnGroup(x)===r.group)?'':r.group};
  }).concat(rows.off.map(r=>({id:r.id,show:false,follow:true,group:''})));
  if(!body.length){rlSay('保存するものがありません',true);return}
  rlState.busy=true;rlSay('保存しています…');
  try{
   await api('/api/operation-item-master/record-layout',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({items:body,user_id:uid})});
   rlState.rows=null;
   await loadRecordLayoutMaint(true);
   rlSay('保存しました');
   /* **測定画面の写しを捨てる**（§9.226 ①）——捨てないとカードは古い並びのまま。 */
   if(window.WL&&WL.opData)WL.opData.forget();
  }catch(e){rlSay('保存できませんでした: '+e.message,true)}
  finally{rlState.busy=false}
 }
 async function loadRecordLayoutMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  if(typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){}}
  if(!list.querySelector('.rl-edit'))list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const q=rlState.equipment?('?equipment='+encodeURIComponent(rlState.equipment)):'';
   const it=await api('/api/operation-item-master'+q);
   rlState.items=(it.items||[]).map(x=>({...x}));
   rlState.rows=null;
   renderRecordLayout();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 /* ヘッドレスではHTML5のD&Dの座標を作れないので、口から呼べるようにする
    （§9.218 ④と同じ理由）。**素の`window.*`を増やさない**。 */
 window.WL=window.WL||{};
 WL.recordBoard={move:rlMove,rows:rlRows,groups:rlGroups,render:renderRecordLayout,
                 dropAt:rlDropAt,mark:rlMark,clearMark:rlClearMark,save:rlSaveLayout,
                 reset:rlResetLayout,state:rlState};
 // capture段リスナーがstopImmediatePropagation()で先に処理を完結させるため
 // ボタン側のonclickは常に発火しない到達不能コードだった(削除済み)。
 document.addEventListener('click',e=>{const t=e.target.closest('#openMasterMaint');if(!t)return;e.preventDefault();e.stopImmediatePropagation();openMasterMaint()},true);
 /* 他ビューへ移るときの後始末は、各ビューの「開くときに他を閉じる」ブロックが
    window.exitMasterMaint()を呼ぶ方式にしてある(docs/ARCHITECTURE.mdの
    「画面の開き方・閉じ方の約束」。records-store.js / report-dashboard.js /
    calendar-view.js / schedule-view.js の各openXxx)。
    以前はここでサイドバーのクリックをcaptureで拾って閉じていたが、
    records-store.jsが先に読み込まれ、[data-open-records]/#homeDraftsの
    captureリスナーでstopImmediatePropagation()しているため、データ一覧へ
    移動したときだけこのリスナーが呼ばれず、マスタ管理のパネルが画面下部に
    残ったまま重なる不具合になっていた(クリックの横取りに依存する作りは
    読み込み順序に左右されて壊れるので使わない)。 */
 // 一覧(DB)切替でも閉じる(report-dashboard.jsのexitReportViewと同じ考え方)。
 document.addEventListener('keydown',e=>{
  if(!WL.modal.escCloses(e))return;
  // 編集モーダルが開いていればそちらだけ閉じる(画面自体は開いたまま)。
  if($('#maintEditorModal')&&!$('#maintEditorModal').hidden){closeMaintEditor();return}
 },true);
})();
