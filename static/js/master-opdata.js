"use strict";
/* master-opdata.js: マスタ管理の専用画面——操業データ項目・選択肢・記録した値の配置
   ============================================================
   §9.324 R3 で master-maint.js から切り出した（中身はそのまま）。
   操業データの配置（§9.216 ④）・自動で入る値（§9.234 ②）・項目の設定モーダル
   （§9.218 ①）・リンクマスタ（§9.306）・選択肢の値（§9.221 ②）・
   「記録した値」の配置（§9.243）。
   盤（master-maint.js）から `WL.mm` で受け取り、`registerSpecial` で名乗る。
   ============================================================ */
(function(){
 const {EQUIPMENT_ALL,closeMaintEditor,maintState,openMaintEditor,openMasterMaint,requireMaintUser}=WL.mm;
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
    try{e.dataTransfer.setData('text/plain',t.dataset.opId);e.dataTransfer.effectAllowed='move'}catch(_){WL.quiet.note('掴んだ印を渡せない（押す道は残る）',_)}
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
        e.dataTransfer.effectAllowed='move'}catch(_){WL.quiet.note('掴んだ印を渡せない（押す道は残る）',_)}
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
 /* ---------- 測定画面からマスタへ間接登録（§9.323 ①、利用者の指示） ----------
    「測定画面からマスタへ間接登録する経路を開通してほしいです」

    **効く欄の条件はサーバーが答える**（§9.163）——`inline_add_usable()`が
    「選択肢を持つ × 手打ち可」を見て`inlineAdd`（＝効いている値）を返す。
    盤は`inlineAddSaved`（保存値）と突き合わせて、**保存してあるのに効いて
    いないときは理由を書く**（§4）——押せるのに何も起きない設定を残さない。 */
 function opInlineAddRowHtml(x){
  if(!opIsChoiceLike(x))return '';
  const saved=!!x.inlineAddSaved;
  /* **手打ちが切のときは足す値そのものが作れない**（候補にない値を
     打てないので）。効いているかはサーバーの`inlineAdd`が答える。 */
  const usable=!!x.freeText;
  /* **効いているか＝保存値 × 使える欄か**。使える条件（`freeText`）は
     サーバーが解いた値をそのまま読む——`choiceOrder`の行が
     `choiceOrderWidgets`を読むのと同じ作法で、規則を画面で組み直さない。
     **`x.inlineAdd`（サーバーが返した効いている値）を直に読まない**——押した
     直後は取り直していないので、注記だけが1手前の状態になる。 */
  const live=saved&&usable;
  return `<div class="op-form-row is-fixed-layout"><span class="op-form-label">手打ちを登録</span>
    <span class="op-form-ctl">
     <span class="op-look-row">
      <button type="button" data-op-inadd="0" class="op-mini${saved?'':' is-on'}"${usable?'':' disabled'}>登録しない</button>
      <button type="button" data-op-inadd="1" class="op-mini${saved?' is-on':''}"${usable?'':' disabled'}>その場で登録できる</button>
     </span>
     <i class="op-form-note">${usable
       ?(live?`測定画面で候補にない値を打つと「<b>選択肢に登録</b>」が出て、`
              +`押すと <b>${esc(x.choice||'')}</b> へ足します（押したときだけ送ります）。`
            :'測定画面では候補にない値を打っても、記録にだけ入ります（今までどおり）。')
       :`<b>手打ち可</b>が切なので使えません${saved?'（設定は残してあります）':''}`
        +'——候補にない値を打てない欄では、足す値そのものが作れません。'}</i>
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
     <label title="ステッパーの−／＋1回ぶん、スライダーの目盛の幅。**入力値の丸めの単位にもなります**">刻み<input type="number" id="opdStep" min="0" step="any" value="${x.step==null?'':esc(x.step)}"></label>
     ${/* §9.307（利用者の指摘「『操業データ項目』の編集内容の中に数値データが
          選ばれたときにステップを決めるところで編集可能」）。**単位は左の
          「刻み」**なので、ここは向きだけ。**語彙はサーバーの戻り**
          （`opState.roundModes`）から作る——画面へ綴りを書き写さない（§9.163）。
          **刻みが空なら丸めようが無い**ので押せなくして理由を書く（§4）。 */''}
     <label title="${esc(x.step==null?'左の「刻み」を入れると選べます':'打ち終わって欄を離れたときに、左の「刻み」の段へそろえます')}">丸め<select id="opdRound"${x.step==null?' disabled':''}>
      <option value="">しない</option>
      ${(opState.roundModes||[]).map(m=>`<option value="${esc(m)}"${x.roundMode===m?' selected':''}>${esc(m)}</option>`).join('')}
     </select></label>
    </span>
    <i class="op-form-note">${x.step==null
      ?'「刻み」を入れると、打ち終わった値をその段へそろえられます。'
      :(x.roundMode?`打ち終わって欄を離れると <b>${esc(x.step)}</b> 刻みで<b>${esc(x.roundMode)}</b>ます（打っている最中は変わりません）。`
        :`いまは丸めません（打った値がそのまま残ります）。`)}</i></div>
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
   ${opInlineAddRowHtml(x)}
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
  /* §9.323 ① 測定画面からの間接登録。 */
  form.querySelectorAll('[data-op-inadd]').forEach(b=>b.onclick=()=>{
   /* **保存値（`inlineAddSaved`）を書く**——効いている値を書くと、手打ちを
      一時的に切っただけで設定そのものが消える（`freeTextSaved`と同じ作法）。 */
   if(b.disabled)return;touch({inlineAddSaved:b.dataset.opInadd==='1'});
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
  /* §9.307。丸めの向きも控えへ（§9.223 ②。ここで拾わないと、別の段から
     保存したときに向きだけ空で上書きされる）。 */
  t('opdRound','roundMode');
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
          /* §9.307。**必ず送る**——`item_upsert`は全列を書くので、
             落とすとこの設定だけが保存のたびに消える（同じ形で6度目）。 */
          roundMode:v('opdRound','roundMode'),
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
          /* §9.323 ①。測定画面からの間接登録も同じ——落とすと保存のたびに
             開けた経路が閉じる（§9.212 ②と同じ形で7度目）。**保存値を送る**
             （`inlineAddSaved`）——効いている値（`inlineAdd`）を送ると、
             手打ちを一時的に切っただけで設定そのものが消える。 */
          inlineAdd:!!x.inlineAddSaved,
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
    選択肢の親子（リンクマスタ）(§9.306、利用者の指示)
    ------------------------------------------------------------
    「選択肢の値マスタ同士を親子関係として紐づけるためにリンクさせ、リンク
     させた場合、子となったマスタは登録内容毎、どの親か親マスタから選ぶことが
     できるようにしたいです。したがって、汎用性を向上させるために『リンクマスタ』の
     追加に伴い『選択肢の値マスタ』にはカテゴリを追加できるようにし、親マスタの
     選択肢から選んで登録することができるように改良が必要になります」

    **行の表にしない**——読みたいのは「どのまとまりがどのまとまりの子か」と
    いう**木**で、1行＝1本の表では**まだ親子を持っていないまとまり**が画面に
    出ない（＝繋ぐ相手を探せない）。

    **左右に同じ一覧を2枚並べない**（§CLAUDE 8・1）——最初は§9.197の突合キーに
    倣って「親にする一覧／子にする一覧」を並べたが、実機で見ると**同じ22行が
    左右に並び**、いちばん読みたい木は下端の帯に押し込まれていた。親子を張るのは
    たまにで、木は毎回読む（面積は頻度×重要度）。いまは**左＝まとまりの入れ物／
    右＝親子の木**で、木のほうが広い。

    **向きは位置が語る**——子は**親の箱の中**へ落とす。左右2枚をやめた代わりに
    ここで向きを担保する（掴んだものが親なのか子なのかを覚えさせない）。

    **押す道と掴む道の両方を残す**（§9.278）——掴めない環境で親子を1本も
    張れなくなる。押す道は「左で選ぶ→箱のボタンを押す」。

    **繋げるかどうかはサーバーが答える**（§9.163）——1段だけの規則は
    `choice_link_upsert()`が持つ。盤は`groups`の`isParent`/`isChild`から
    **押せなくして理由を書く**（§4）だけで、規則をここへ書き写さない。
    ============================================================ */
 const clState={items:[],groups:[],pick:'',newParent:'',q:'',busy:false};
 function clGroup(name){return (clState.groups||[]).find(g=>g.name===name)||null}
 /* このまとまりを**その役に置けるか**。置けないときは理由を返す（§4）。
    材料はサーバーの`isParent`/`isChild`だけ——規則そのものは持たない。 */
 function clBlock(name,role){
  const g=clGroup(name);if(!g)return 'このまとまりは今ありません。';
  if(role==='parent'){
   if(g.isChild)return '親子は1段だけです。このまとまりは既に別のまとまりの子なので、親にはできません（先に子から外してください）。';
   if(g.isParent)return 'このまとまりは既に親です。下の箱へ子を足してください。';
   return '';
  }
  if(g.isParent)return '親子は1段だけです。このまとまりは既に別のまとまりの親なので、子にはできません（先に親から外してください）。';
  if(g.isChild)return 'このまとまりには既に親があります（1つの子に親は1つだけ）。先に今の親子を外してください。';
  return '';
 }
 function clSay(text,bad){
  const el=$('#clState');if(!el)return;
  el.textContent=text||'';el.classList.toggle('is-bad',!!bad);
 }
 async function loadChoiceLinkMaint(force){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  form.classList.remove('mm-form-compact');
  if(!list.querySelector('.cl-edit'))list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const d=await api('/api/choice-link-master');
   clState.items=d.items||[];
   clState.groups=d.groups||[];
   /* 消えたまとまりを選んだままにしない（§9.204と同じ作法）。 */
   if(clState.pick&&!clGroup(clState.pick))clState.pick='';
   if(clState.newParent&&(!clGroup(clState.newParent)||clBlock(clState.newParent,'parent')))clState.newParent='';
   renderChoiceLink();
  }catch(e){
   list.innerHTML=`<div class="mm-empty">選択肢の親子を読み込めませんでした: ${esc(e.message||String(e))}</div>`;
  }
 }
 /* 左＝まとまりの入れ物。**押しても掴んでも同じもの**を選ぶ。 */
 function clPoolHtml(){
  const q=String(clState.q||'').trim().toLowerCase();
  const all=(clState.groups||[]).filter(g=>!q||String(g.name).toLowerCase().includes(q));
  const body=all.length
   ?all.map(g=>{
      const on=clState.pick===g.name;
      const role=g.isParent?'親':(g.isChild?'子':'');
      return `<button type="button" class="cl-item${on?' is-pick':''}"`
       +` data-cl-name="${esc(g.name)}" draggable="true"`
       +` title="${esc(g.name)}\n値 ${g.count}件\n押して選び、右の箱へ入れます（掴んで落としても同じです）">`
       +`<span class="cl-item-name">${esc(g.name)}</span>`
       +`<span class="cl-item-count">値 ${g.count}件</span>`
       +(role?`<i class="cl-item-role">${role}</i>`:'')
       +`</button>`;
     }).join('')
   :`<p class="cl-empty">${q?`「${esc(q)}」に当てはまるまとまりがありません。`
       :'まとまりがまだありません。「選択肢の値」で作ってください。'}</p>`;
  return `<section class="cl-pool">`
   +`<h4 class="cl-pane-head">まとまり<small>右の箱へ入れると親子になります。</small></h4>`
   +`<input type="search" id="clSearch" class="cl-filter" value="${esc(clState.q||'')}"`
   +` placeholder="まとまり名で絞る" autocomplete="off">`
   +`<div class="cl-list">${body}</div></section>`;
 }
 /* 「◯◯を子にする」ボタン。**押せないときは理由をその場に書く**（§4）。 */
 function clAddBtnHtml(parent){
  const p=clState.pick;
  if(!p)return `<span class="cl-hint">左でまとまりを選ぶと、ここへ足せます（掴んで落としても同じです）。</span>`;
  const why=(p===parent)?'同じまとまりを親と子にはできません。':clBlock(p,'child');
  if(why)return `<span class="cl-hint is-bad">${esc(p)}は子にできません — ${esc(why)}</span>`;
  return `<button type="button" class="cl-add" data-cl-addchild="${esc(parent)}">`
   +`${esc(p)}を子にする</button>`;
 }
 /* 1つの親の箱。**子は箱の中**——向きを位置が語る。 */
 function clBoxHtml(parent,children,pending){
  const g=clGroup(parent);
  const kids=children.map(x=>`<span class="cl-chip" data-cl-link="${x.id}">`
   +`<b>${esc(x.child)}</b><i class="cl-chip-count">値 ${x.childCount}件</i>`
   +`<button type="button" class="cl-chip-del" data-cl-del="${x.id}"`
   +` title="この親子を外す（値に入れた「親の値」は残ります）">×</button></span>`).join('');
  return `<section class="cl-box${pending?' is-pending':''}" data-cl-parent="${esc(parent)}">`
   +`<h5 class="cl-box-head"><i class="cl-box-role">親</i><b>${esc(parent)}</b>`
   +`<span class="cl-box-count">値 ${g?g.count:0}件</span>`
   +(pending?`<span class="cl-box-pending">まだ保存していません</span>`
            +`<button type="button" class="cl-box-cancel" id="clNewCancel">やめる</button>`:'')
   +`</h5>`
   +`<div class="cl-kids">${kids||'<span class="cl-hint">子がまだありません。</span>'}</div>`
   +`<div class="cl-box-foot">${clAddBtnHtml(parent)}</div></section>`;
 }
 function clTreeHtml(){
  const rows=clState.items||[];
  const parents=[];
  rows.forEach(x=>{if(parents.indexOf(x.parent)<0)parents.push(x.parent)});
  const boxes=parents.map(p=>clBoxHtml(p,rows.filter(x=>x.parent===p),false));
  if(clState.newParent&&parents.indexOf(clState.newParent)<0)
   boxes.push(clBoxHtml(clState.newParent,[],true));
  /* **新しい親をつくる受け皿**。押す道はボタン、掴む道はこの箱そのもの。 */
  const p=clState.pick;
  const why=p?clBlock(p,'parent'):'';
  const btn=!p
   ?`<span class="cl-hint">左でまとまりを選んでから押してください（掴んで落としても同じです）。</span>`
   :(why?`<span class="cl-hint is-bad">${esc(p)}は親にできません — ${esc(why)}</span>`
        :`<button type="button" class="cl-add" id="clNewParent">${esc(p)}を親にする</button>`);
  return boxes.join('')
   +`<section class="cl-box cl-box-new" data-cl-newparent="1">`
   +`<h5 class="cl-box-head"><b>新しい親をつくる</b></h5>`
   +`<div class="cl-box-foot">${btn}</div></section>`;
 }
 function renderChoiceLink(){
  const form=$('#masterMaintForm'),list=$('#masterMaintList');if(!form||!list)return;
  /* **器の高さを中まで届ける**（§9.222 ⑤）。印を外すのは`loadMaintInner()`。 */
  list.classList.add('is-fill');
  list.parentElement&&list.parentElement.classList.add('is-fill');
  const n=(clState.items||[]).length;
  form.innerHTML=`<div class="op-bar">`
   +`<span class="op-bar-note">まとまりどうしを<b>親子</b>で結びます。`
   +`結ぶと「選択肢の値」で<b>どの親の値のときに出すか</b>を決められ、`
   +`測定画面では<b>親で選んだ値に合わせて子の候補が絞られます</b>`
   +`（親をまだ選んでいないときは全部出ます）。</span>`
   +`<span class="op-bar-state" id="clState"></span></div>`;
  list.innerHTML=`<div class="cl-edit">${clPoolHtml()}`
   +`<section class="cl-tree"><h4 class="cl-pane-head">いまの親子`
   +`<small>${n?`${n}本`:'まだ1本もありません'}。親子は<b>1段だけ</b>です（親→子。孫は作りません）。</small></h4>`
   +`<div class="cl-tree-body">${clTreeHtml()}</div></section></div>`;
  bindChoiceLink();
 }
 /* 木と一覧だけを差し替える（絞り込み・選び直しで欄を作り直さない・§9.117）。 */
 function clRepaint(){
  const list=$('#masterMaintList');if(!list)return;
  const pool=list.querySelector('.cl-pool'),tree=list.querySelector('.cl-tree-body');
  if(!pool||!tree){renderChoiceLink();return}
  const el=$('#clSearch'),pos=el?el.selectionStart:null,focused=el&&document.activeElement===el;
  pool.outerHTML=clPoolHtml();
  tree.innerHTML=clTreeHtml();
  bindChoiceLink();
  if(focused){const q=$('#clSearch');if(q){q.focus();if(pos!=null)q.setSelectionRange(pos,pos)}}
 }
 async function clConnect(parent,child){
  if(clState.busy||!parent||!child)return;
  if(parent===child){clSay('同じまとまりを親と子にはできません。',true);return}
  const why=clBlock(parent,'parent')&&clGroup(parent)&&!clGroup(parent).isParent
    ?clBlock(parent,'parent'):clBlock(child,'child');
  if(why){clSay(why,true);return}
  clState.busy=true;clSay('保存しています…');
  try{
   await api('/api/choice-link-master',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({parent,child,user_id:currentUserId()})});
   clState.pick='';clState.newParent='';
   await loadChoiceLinkMaint(true);
   clSay(`${parent} → ${child} を結びました。`);
  }catch(e){
   /* **断る理由はサーバーが書いている**（§4）。言い換えない。 */
   clSay(e.message||String(e),true);
  }finally{clState.busy=false}
 }
 async function clUnlink(id){
  if(clState.busy)return;
  const row=(clState.items||[]).find(x=>String(x.id)===String(id));
  if(!row)return;
  if(!confirm(`${row.parent} → ${row.child} の親子を外しますか？\n`
    +'値に入れた「親の値」は残すので、また結べば続きから使えます。'))return;
  clState.busy=true;clSay('外しています…');
  try{
   const r=await api('/api/choice-link-master/delete',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:row.id,user_id:currentUserId()})});
   await loadChoiceLinkMaint(true);
   clSay(r&&r.message||'外しました。');
  }catch(e){clSay(e.message||String(e),true)}
  finally{clState.busy=false}
 }
 /* 選ぶ。**同じものをもう一度押したら選び直し**（やめる場所を別に作らない）。 */
 function clPick(name){
  clState.pick=(clState.pick===name)?'':name;
  clSay('');
  clRepaint();
 }
 function clMakeParent(name){
  const why=clBlock(name,'parent');
  if(why){clSay(why,true);return}
  clState.newParent=name;clState.pick='';clSay('');
  clRepaint();
  clSay(`${name}を親にしました。次に子にするまとまりを選んで「子にする」を押してください（まだ保存していません）。`);
 }
 function bindChoiceLink(){
  const list=$('#masterMaintList');if(!list)return;
  const q=$('#clSearch');
  if(q&&!q.dataset.wired){
   q.dataset.wired='1';
   q.addEventListener('input',()=>{clState.q=q.value;clRepaint()});
  }
  list.querySelectorAll('[data-cl-name]').forEach(b=>{
   b.onclick=()=>clPick(b.dataset.clName);
   b.ondragstart=e=>{
    clState.pick=b.dataset.clName;
    try{e.dataTransfer.setData('text/plain',b.dataset.clName)}catch(err){WL.quiet.note('掴んだ印を渡せない（押す道は残る）',err)}
    e.dataTransfer.effectAllowed='link';
    clRepaint();
   };
  });
  /* 落とし先は**親の箱**（中＝子）と**新しい親の受け皿**。 */
  list.querySelectorAll('[data-cl-parent],[data-cl-newparent]').forEach(box=>{
   box.ondragover=e=>{
    if(!clState.pick)return;
    e.preventDefault();e.dataTransfer.dropEffect='link';
    box.classList.add('is-over');
   };
   box.ondragleave=()=>box.classList.remove('is-over');
   box.ondrop=e=>{
    e.preventDefault();e.stopPropagation();box.classList.remove('is-over');
    const p=clState.pick;if(!p)return;
    if(box.dataset.clNewparent){clMakeParent(p);return}
    const parent=box.dataset.clParent;
    if(parent===clState.newParent&&!(clState.items||[]).some(x=>x.parent===parent)){
     clConnect(parent,p);return;
    }
    clConnect(parent,p);
   };
  });
  const np=$('#clNewParent');
  if(np)np.onclick=()=>clMakeParent(clState.pick);
  const cancel=$('#clNewCancel');
  if(cancel)cancel.onclick=()=>{clState.newParent='';clSay('');clRepaint()};
  list.querySelectorAll('[data-cl-addchild]').forEach(b=>{
   b.onclick=()=>clConnect(b.dataset.clAddchild,clState.pick);
  });
  list.querySelectorAll('[data-cl-del]').forEach(b=>{
   b.onclick=()=>clUnlink(b.dataset.clDel);
  });
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
  if(typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){WL.quiet.note('設備マスタを取れない（設備を選ぶ欄が減るだけ）',e)}}
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
   if(again){again.focus();try{again.setSelectionRange(at,at)}catch(e){WL.quiet.note('カーソル位置を戻せない（値は入っている）',e)}}
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
    try{e.dataTransfer.setData('text/plain',row.dataset.ocId)}catch(err){WL.quiet.note('掴んだ印を渡せない（押す道は残る）',err)}});
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
  if(typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){WL.quiet.note('設備マスタを取れない（設備を選ぶ欄が減るだけ）',e)}}
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
   /* §9.307 入力値の丸めの向き。**サーバーの語彙をそのまま持つ**（§9.163）。 */
   opState.roundModes=it.roundModes||opState.roundModes;
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
    try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',t.dataset.rlId)}catch(_){WL.quiet.note('掴んだ印を渡せない（押す道は残る）',_)}
   };
   t.ondragend=()=>{rlState.drag=null;t.classList.remove('is-dragging');rlClearMark()};
  });
  document.querySelectorAll('#masterMaintList .rl-group-list').forEach(box=>{
   box.ondragover=e=>{
    if(!rlState.drag)return;
    e.preventDefault();
    try{e.dataTransfer.dropEffect='move'}catch(_){WL.quiet.note('掴んだ印を渡せない（押す道は残る）',_)}
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
    try{e.dataTransfer.dropEffect='move'}catch(_){WL.quiet.note('掴んだ印を渡せない（押す道は残る）',_)}
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
  if(typeof loadEquipmentMaster==='function'){try{await loadEquipmentMaster(force)}catch(e){WL.quiet.note('設備マスタを取れない（設備を選ぶ欄が減るだけ）',e)}}
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

 /* 盤の登録簿へ名乗る（§9.324 R3）。 */
 WL.mm.registerSpecial('op-item',{load:loadOpItemMaint,onEditorClose:renderOpItem});
 WL.mm.registerSpecial('record-layout',{load:loadRecordLayoutMaint,onEditorClose:renderRecordLayout});
 WL.mm.registerSpecial('op-choice',{load:loadOpChoiceMaint,onEditorClose:renderOpChoice});
 WL.mm.registerSpecial('choice-link',{load:loadChoiceLinkMaint,onEditorClose:renderChoiceLink});
})();
