/* measure-opdata.js: 操業データ（§9.215／§9.216 ②）
   ============================================================
   利用者の指示（§9.215）:
     「項目自体をマスタ化し他の設備でも使えるように設備ごとに持たせ、変更
      できるようにする、設定値も必要に応じてマスタ化して関連付け。各項目ごと、
      入力方式や入力上限値、入力データの型を選べるようにする」
   利用者の指示（§9.216 ②）:
     「既存のオペレータ、検査員、作業人数、内径、スプール、縦割数、横割数、
      板厚測定器、板幅測定器、巻出し方向、など、準備で入力させている情報の
      すべてを操業データとして、入力している項目を汎用化したい。一部の必須
      入力事項もマスタで設定可能とし、今あるデータ設定も汎用化、描画可能な
      エリア(縦2×横3のカード)内の中でレイアウトも含めてマスタ上で視覚的に
      調整D&Dで並び替え編集ができる汎用設定機能」

   ここが持つのは**器と割り付け**だけ。何を記録するかは`操業データ項目マスタ`
   が決めるので、**項目名をこのファイルへ書かない**。

   ------------------------------------------------------------
   **作り直さず、割り付けだけを差配する。**
   ------------------------------------------------------------
   準備の入力欄（オペレータ・内径・横割数…）は`index.html`に既にあり、
   それぞれが仕掛由来のプリセット（§9.204の内径）・条数の上限（§9.210 ⑤）・
   171人ぶんを測った幅（§9.130）といった仕掛けを持っている。マスタの定義から
   作り直すと、それを全部書き直すことになる。だからここでするのは
     ・並び（`order`）
     ・カードの中で何列ぶんか（`grid-column: span N`）
     ・群（見出し）と、その群を畳むかどうか
     ・出す／出さない
     ・どちらのカードへ出すか（準備 / ②の入力内容）
   の5つだけで、**DOMは動かさない**（§9.122／§9.125。受信欄の制約と
   `.selectors>*`の規則を壊さないため）。自由項目だけはここが作るが、
   置き場は同じ`.selectors`の直下——**組み込みと同じ器・同じ文字**にする
   ことが、見た目をそろえるいちばん確実な方法（§9.216 ⑤）。

   値は`S.measure.settings.opData`（項目名→文字列）。**鍵は日本語の項目名**
   （§9.162と同じ約束）。組み込みの欄はそれぞれ元からの保存先を持っている
   ので、こちらへは入れない（同じ値を2箇所に持たない・§8）。

   **打った時点でレコードへ入れる**（§9.208 ②）。`collect()`は保存のときしか
   走らないので、そこだけに任せると「入力したのに数えられない」が起きる。
   ============================================================ */
(function(){
 const $=s=>document.querySelector(s);
 const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>(
   {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

 /* 設備ごとの定義。**開いた設備が変わるまで使い回す**——測定を開くたびに
    引き直すと、ロットを開く速さがマスタの往復に引きずられる。 */
 let defs=[],builtinOff=[],gridCols=12,defsFor=null,loading=null;
 /* 畳んでいる群。**この端末の覚え**（読み方の好みなのでPCごとに違ってよい。
    §9.199の`childBadge`と同じ考え方）。 */
 const FOLD_KEY='MeasureOpFoldV2';
 /* 群名→true(畳む)/false(開く)。**既定は「条件があるかどうか」で決まる**
    ので、覚えるのは**触ったものだけ**（触っていない群は既定に追随する）。 */
 let foldPref=new Map();
 try{foldPref=new Map(Object.entries(JSON.parse(localStorage.getItem(FOLD_KEY)||'{}')))}catch(e){}
 const rememberFold=()=>{
  try{localStorage.setItem(FOLD_KEY,JSON.stringify(Object.fromEntries(foldPref)))}catch(e){}
 };

 const PLACE_PREP='準備',PLACE_INPUT='入力内容',PLACE_MOTHER='母材';
 /* 置き場ごとの器（§9.232）。**1箇所が答える**——`layout()`と`hostOf()`が
    別々に器を探すと、片方だけ直した状態が作れる。 */
 const PLACE_BOX={[PLACE_PREP]:'.selectors',[PLACE_INPUT]:'.selectors',
                  [PLACE_MOTHER]:'.material-grid'};
 const PLACE_ORDER=[PLACE_PREP,PLACE_INPUT,PLACE_MOTHER];
 function boxFor(place){return document.querySelector(PLACE_BOX[place]||'.selectors')}

 function equipmentNow(){
  try{
   return String(localStorage.getItem('AccessMeasurementConfiguredEquipment')||'').trim();
  }catch(e){return ''}
 }

 async function load(equipment){
  const eq=String(equipment||equipmentNow()||'').trim();
  if(defsFor===eq&&Array.isArray(defs))return defs;
  if(loading&&loading.eq===eq)return loading.p;
  const p=(async()=>{
   try{
    const r=await api('/api/operation-form?equipment='+encodeURIComponent(eq));
    defs=Array.isArray(r.items)?r.items:[];
    builtinOff=Array.isArray(r.builtinOff)?r.builtinOff:[];
    gridCols=Number(r.gridCols)>0?Number(r.gridCols):12;
   }catch(e){
    /* **読めなくても測定は開ける**（fail-open）。入力欄が出ないことは
       画面に書く——黙って空にすると「項目が無い設備」と区別が付かない。
       **組み込みの欄はそのまま**にする（読めなかったことを理由に、今まで
       使えていた入力欄を消さない）。 */
    console.warn('操業データの項目を読めませんでした',e);
    defs=[];builtinOff=[];
   }
   defsFor=eq;loading=null;return defs;
  })();
  loading={eq,p};
  return p;
 }

 /* 型ごとの入れ物。**型は6つだけ**（サーバーの`ITEM_TYPES`と同じ）。 */
 const isNumeric=t=>['整数','正の整数','数値','正の数'].includes(t);
 const isPositive=t=>['正の整数','正の数'].includes(t);
 const isInteger=t=>['整数','正の整数'].includes(t);

 /* いま画面に出ている値。**入力欄から読む**——`settings.opData`は
    打った時点で書いているが、開いた直後は空なので画面が正。 */
 function values(){
  const out={};
  document.querySelectorAll('[data-op]').forEach(el=>{
   /* **記録へ入るのは整える前の値**（§9.221 ⑦）。3桁区切り・ゼロ埋めは
      見せ方であって値ではない——`1,234`のまま記録へ入れると、次に欄を
      離れたときの`Number()`がNaNになって**打った値が黙って消える**。 */
   const k=el.dataset.op;const v=rawText(el,el.value).trim();
   if(v!=='')out[k]=v;
  });
  return out;
 }

 /* **`window.S`で参照しないこと。** `S`は`base.js`の**トップレベルの
    `const`**で、`window`のプロパティにはならない（`window.S`は常に
    `undefined`）。素の`S`なら別のスクリプトからも見える。 */
 const state=()=>(typeof S!=='undefined'&&S)?S:null;
 function store(){
  const m=state()&&S.measure;if(!m)return null;
  if(!m.settings||typeof m.settings!=='object')return null;
  if(!m.settings.opData||typeof m.settings.opData!=='object')m.settings.opData={};
  return m.settings.opData;
 }

 /* 打った値をその場でレコードへ入れる（§9.208 ②）。 */
 function remember(key,value){
  const bag=store();if(!bag)return;
  const v=String(value==null?'':value).trim();
  if(v==='')delete bag[key];else bag[key]=v;
  if(typeof markDirty==='function')markDirty();
 }

 /* 型に合わない文字はその場で落とす。**打っている最中に断らない**
    ——「-」や「1.」は途中の形として通し、外れたときに整える。 */
 function sanitize(el,def){
  const t=def.type;
  if(!isNumeric(t))return;
  let v=String(el.value||'');
  v=v.replace(/[０-９．＋－]/g,c=>'0123456789.+-'['０１２３４５６７８９．＋－'.indexOf(c)]);
  v=v.replace(/[^0-9.\-]/g,'');
  if(isPositive(t))v=v.replace(/-/g,'');
  else v=v.replace(/(?!^)-/g,'');
  if(isInteger(t))v=v.replace(/\./g,'');
  else{const i=v.indexOf('.');if(i>=0)v=v.slice(0,i+1)+v.slice(i+1).replace(/\./g,'')}
  if(el.value!==v)el.value=v;
 }

/* ---------- 値の見せ方（§9.221 ⑦、利用者の指示） ----------
    「データの表示方法、桁数、左詰め、右詰め、中央寄せなど、さらに
     カスタマイズできるように改良してください」

    **打っている最中は当てない。** 1文字ごとに桁区切りを入れると、
    カーソルが区切りの前後で飛ぶ（§9.117の「入力中に作り直さない」と
    同じ罠）。当てるのは**欄を離れたとき**と**記録から読み直したとき**の
    2つだけで、欄へ入った瞬間は整える前の値へ戻す。

    設定は**要素が持つ**（`data-opfmt`／`data-opdigits`）——`apply()`は
    定義ではなく`[data-op]`を順に見て回るので、定義を引き直す口を
    増やさずに済む。 */
 function fmtOf(el){return (el&&el.dataset&&el.dataset.opfmt)||''}
 /* 見せ方を外した「素の値」。記録へ入るのはこちら。 */
 function rawText(el,text){
  const t=String(text==null?'':text);
  const f=fmtOf(el);
  if(f==='3桁区切り')return t.replace(/,/g,'');
  if(f==='ゼロ埋め'){
   const m=t.match(/^(-?)0+(\d.*)$/);
   return m?m[1]+m[2]:t;
  }
  return t;
 }
 /* 画面に出す形。**読めない値はそのまま返す**（整形に失敗したら生の値を
    出すのが原則。§9.88と同じ約束）。 */
 function shownText(el,raw){
  const t=String(raw==null?'':raw).trim();
  if(t==='')return '';
  const f=fmtOf(el);
  if(f==='3桁区切り'){
   const m=t.replace(/,/g,'').match(/^(-?)(\d+)(\.\d*)?$/);
   if(!m)return t;
   return m[1]+Number(m[2]).toLocaleString('en-US')+(m[3]||'');
  }
  if(f==='ゼロ埋め'){
   const w=Number((el&&el.dataset&&el.dataset.opdigits)||0);
   if(!(w>0))return t;
   const m=t.match(/^(-?)(\d+)(\.\d*)?$/);
   if(!m)return t;
   return m[1]+m[2].padStart(w,'0')+(m[3]||'');
  }
  return t;
 }
 /* 欄へ値を入れる口。**`el.value=`を直に書かないこと**——見せ方を
    通さない代入が1つでもあると、そこだけ整わない欄ができる。 */
 function putValue(el,raw){
  const next=shownText(el,raw);
  if(el.value!==next)el.value=next;
 }

 /* 見せ方の配線は**この1本**（§9.221 ⑦）。設定窓の見本も測定画面も
    ここを通す——見本だけ整形しないと、設定画面で見えた形と実際の形が
    食い違う（§9.218 ①の約束が破れる）。`<select>`は値が選択肢そのもの
    なので整形しない。 */
 function attachFormat(el,onLeave){
  if(!el||el.tagName==='SELECT'||el.dataset.opFmtWired)return el;
  el.dataset.opFmtWired='1';
  /* 欄へ入ったら**整える前の値**へ戻す。桁区切りの入った文字の上で
     打たせると、`sanitize()`が区切りを消した瞬間にカーソルが飛ぶ。 */
  el.addEventListener('focus',()=>{const r=rawText(el,el.value);if(el.value!==r)el.value=r});
  el.addEventListener('blur',onLeave||(()=>putValue(el,rawText(el,el.value))));
  return el;
 }

 /* 欄から離れたときに桁と上下限へそろえる。**直したことを画面に書く**
    （§CLAUDE 6）——黙って値が変わると、打ち間違いに気づけない。 */
 function settle(el,def,note){
  /* **見本では記録へ書かない**（§9.221 ⑦）。設定窓は測定を開いたまま
     でも開けるので、素通しにすると見本へ打った値がそのロットの操業
     データとして残る。整え方（桁・上下限・見せ方）は同じ道を通す。 */
  const keep=v=>{if(!def.preview)remember(def.name,v)};
  if(!isNumeric(def.type)){keep(rawText(el,el.value));return}
  const raw=rawText(el,el.value).trim();
  if(raw===''||raw==='-'||raw==='.'){el.value='';keep('');say(note,'');return}
  let n=Number(raw);
  if(!Number.isFinite(n)){el.value='';keep('');say(note,'数字として読めなかったので消しました');return}
  const msgs=[];
  if(isPositive(def.type)&&n<0){n=Math.abs(n);msgs.push('マイナスは入りません')}
  const dec=isInteger(def.type)?0:(Number.isFinite(Number(def.decimals))?Number(def.decimals):1);
  const fixed=isInteger(def.type)?String(Math.round(n)):n.toFixed(dec);
  if(def.min!==null&&def.min!==undefined&&Number(fixed)<Number(def.min)){
   n=Number(def.min);msgs.push(`下限 ${def.min} まで戻しました`);
  }else if(def.max!==null&&def.max!==undefined&&Number(fixed)>Number(def.max)){
   n=Number(def.max);msgs.push(`上限 ${def.max} まで戻しました`);
  }else{
   n=Number(fixed);
  }
  const out=isInteger(def.type)?String(Math.round(n)):Number(n).toFixed(dec);
  if(out!==raw&&!msgs.length)msgs.push(`小数${dec}桁へそろえました`);
  /* **記録へ入るのは`out`（素の値）／画面に出るのは見せ方を当てた形**。 */
  putValue(el,out);
  keep(out);
  say(note,msgs.join(' ／ '));
 }
 function say(note,text){
  if(!note)return;
  note.textContent=text||'';
  note.hidden=!text;
 }

 /* ---------- 自由項目の入れ物 ----------
    **組み込みの欄と同じ形にする**（§9.216 ⑤、利用者の指摘「操業データの
    カード内の文字サイズがバラバラ」）。以前は`.opf`という独自の器を別の
    カードへ置いていたため、名前・値・注記がそれぞれ別の大きさになっていた。
    `<label data-f>`＝準備の入力欄と同じ器にすれば、文字も高さも余白も
    ①のCSSがそのまま当たる（規格を守らせる仕組みの中に入れる・§9.127）。 */
 /* **入る形を1箇所で言う**（§CLAUDE 6「出どころ・単位・根拠を画面に出す」）
    ——打ってから断られるより、打つ前に分かるほうが速い。
    **マスタの設定窓も同じ関数を通す**（§9.219 ③）——見本用にもう1つ書くと、
    設定画面で見えた形と実際の形が食い違う（§9.176・§9.218 ①と同じ約束）。 */
 function ruleText(def){
  if(def.type==='選択')return '';
  if(!isNumeric(def.type))return '';
  const range=[];
  /* **上下限の出どころを添える**（§9.231 ②、§CLAUDE 6）——同じ「350 以下」
     でも、項目に書いた数と設備マスタから引いた数では直す場所が違う。
     出どころが無ければ今までどおり数だけ（サーバーが`…FromLabel`を
     付けたときだけ出る）。 */
  const from=k=>{const l=def[k+'FromLabel'];return l?`（${l}）`:''};
  if(def.min!==null&&def.min!==undefined&&def.min!=='')range.push(`${def.min} 以上${from('min')}`);
  if(def.max!==null&&def.max!==undefined&&def.max!=='')range.push(`${def.max} 以下${from('max')}`);
  return (isInteger(def.type)?'整数':`小数${def.decimals==null?1:def.decimals}桁`)
    +(isPositive(def.type)?'・0以上':'')+(range.length?`・${range.join('／')}`:'');
 }
 /* ---------- 自動で入る値・計算値（§9.234 ②、利用者の指示） ----------
    「自動で入る値、計算値についても、現在使っているものは、そのリストから
     選んで表示設定できるようにしてください」

    測定画面には**人が打たない値**が既にいくつも出ていた（仕掛から写した
    ロット番号・製造板厚、開いた設備、実働時間…）。画面に焼き付いていたので
    置き場も名前も見せ方も現場が決められなかった。マスタの1行（`[自動値]`）に
    して、他の項目と同じ土俵に載せる。

    **語彙はサーバーが持つ**（`operation_repo.AUTO_VALUES`）——鍵の綴りを
    ここへ書き写すと、増やしたときに2箇所直すことになる（§9.163）。
    ここが持つのは**引き方だけ**（値の出どころは開いているレコードなので、
    サーバーからは引けない）。**知らない鍵は黙って捨てない**（§9.204）
    ——`null`を返し、画面は「この版では引けません」と書く。 */
 function lotOf(key){
  /* `basic`は`aliases`に載せた列しか持たないので、**生の行から**も探す
     （§9.160）。どちらも空なら空文字。 */
  try{
   if(typeof sourceField==='function'&&typeof aliases==='object'&&aliases[key]){
    const v=sourceField(aliases[key]);
    if(String(v==null?'':v).trim()!=='')return String(v).trim();
   }
  }catch(_){}
  const b=(state()&&S.measure&&S.measure.basic)||{};
  return String(b[key]==null?'':b[key]).trim();
 }
 function settingOf(key){
  const st=(state()&&S.measure&&S.measure.settings)||{};
  return String(st[key]==null?'':st[key]).trim();
 }
 function timeOf(key){
  const t=(state()&&S.measure&&S.measure.workTime)||{};
  const v=String(t[key]==null?'':t[key]).trim();
  if(!v)return '';
  /* 保存値はISO（末尾Z）なので、**地方時へ直してから出す**（§9.162と同じ
     約束）——生のまま出すと時差のぶんずれた時刻が紙にも出る。 */
  const d=new Date(v);
  if(isNaN(d.getTime()))return v;
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} `
    +`${p(d.getHours())}:${p(d.getMinutes())}`;
 }
 /* 条の並びは**`WL.defect.lanes()`の1箇所**が答える（§9.226 ④）——ここで
    条を数え直すと、屑幅の片寄せ・基準幅の取り方という前提が2つに分かれる。 */
 function lanesOf(){
  try{
   if(typeof WL!=='undefined'&&WL.defect&&WL.defect.lanes)return WL.defect.lanes();
  }catch(_){}
  return null;
 }
 const AUTO_GETTERS={
  'lot.lotNo':()=>lotOf('lotNo'),
  'lot.inspectionNo':()=>lotOf('inspectionNo'),
  'lot.castingNo':()=>lotOf('castingNo'),
  'lot.orderNo':()=>lotOf('orderNo'),
  'lot.purposeName':()=>lotOf('purposeName'),
  'lot.customer':()=>lotOf('customer'),
  'lot.delivery':()=>lotOf('delivery'),
  'lot.mfgMaterial':()=>lotOf('mfgMaterial'),
  'lot.mfgTemper':()=>lotOf('mfgTemper'),
  'lot.mfgThickness':()=>lotOf('mfgThickness'),
  'lot.mfgWidth':()=>lotOf('mfgWidth'),
  'lot.mfgLength':()=>lotOf('mfgLength'),
  'lot.originalWidth':()=>lotOf('originalWidth'),
  'lot.equipment':()=>lotOf('equipment'),
  'meas.equipment':()=>settingOf('registeredEquipment')
    ||String((state()&&S.measure&&S.measure.registeredEquipment)||'').trim(),
  'meas.measureType':()=>settingOf('measureType'),
  'meas.lengthPos':()=>settingOf('lengthPos'),
  'meas.startAt':()=>timeOf('startAt'),
  'meas.endAt':()=>timeOf('endAt'),
  'calc.workDuration':()=>{
   /* **終わっていなければ空欄**（§9.114「空欄は未設定であって0分ではない」）。 */
   const ms=(typeof durationMs==='function')?durationMs(state()&&S.measure):null;
   return (ms===null||ms===undefined)?'':String(Math.round(ms/60000));
  },
  'calc.stripCount':()=>{const L=lanesOf();return L&&L.list&&L.list.length?String(L.list.length):''},
  'calc.slitWidth':()=>{
   const L=lanesOf();
   return L&&Number.isFinite(L.slit)&&L.slit>0?String(Math.round(L.slit*10)/10):'';
  },
 };
 /* その鍵をこの版が引けるか。**引けないことは画面に書く**（§4）。 */
 function autoKnown(key){return Object.prototype.hasOwnProperty.call(AUTO_GETTERS,String(key||''))}
 function autoValueOf(key){
  const fn=AUTO_GETTERS[String(key||'')];
  if(!fn)return null;                       /* null＝引けない（空欄とは別） */
  try{const v=fn();return String(v==null?'':v)}catch(_){return ''}
 }
 /* 画面の`<output>`へ入れ、**レコードにも書く**（§9.208 ②）——書かないと、
    帳票や③「記録した値」から見えない。派生値なので`markDirty()`はしない
    （読み直すたびに作れる値で「保存していない変更」を作らない）。 */
 function paintAuto(){
  const bag=store();
  document.querySelectorAll('[data-opauto]').forEach(el=>{
   const out=el.querySelector(':scope>output');if(!out)return;
   const key=el.dataset.opauto,name=el.dataset.opfield||'';
   const v=autoValueOf(key);
   if(v===null){
    out.value='';
    out.title=`この版では引けない鍵です（${key}）。`;
    const note=el.querySelector(':scope>.opf-note');
    if(note){note.hidden=false;note.textContent=`「${key}」はこの版では引けません。`}
    return;
   }
   putValue(out,v);
   out.title=v;
   if(bag&&name){if(v==='')delete bag[name];else bag[name]=v}
  });
 }

 function fieldEl(def,i){
  const label=document.createElement('label');
  label.className='opf';
  label.dataset.opgen='1';
  label.dataset.f='op:'+def.name;
  label.dataset.opfield=def.name;
  const hint=ruleText(def);
  let control;
  const id='opf'+i;
  if(def.autoValue){
   /* 自動で入る値（§9.234 ②）。**打てる欄を作らない**——押せるのに何も
      起きない欄は壊れて見える（§4）。母材の参考値3つと同じ`<output>`で、
      `values()`／`apply()`／`collect()`は`.value`をそのまま読める。 */
   label.dataset.opauto=def.autoValue;
   control=`<output id="${id}" data-op="${esc(def.name)}"></output>`;
  }else if(def.type==='選択'){
   const opts=['<option value=""></option>']
     .concat((def.choices||[]).map(v=>`<option value="${esc(v)}">${esc(v)}</option>`)).join('');
   control=`<select id="${id}" data-op="${esc(def.name)}">${opts}</select>`;
  }else if(isNumeric(def.type)){
   /* `type=number`にしない（§9.208 ③）——`.5`のような途中の形が
      **黙って消える**。文字として受けて自分で整える。 */
   control=`<input id="${id}" class="numeric-input" type="text" inputmode="decimal"`
     +` data-op="${esc(def.name)}" autocomplete="off">`;
  }else{
   control=`<input id="${id}" type="text" data-op="${esc(def.name)}" autocomplete="off">`;
  }
  label.title=[def.name,def.unit?`単位 ${def.unit}`:'',
               def.autoValue?`自動で入る値（${def.autoValueLabel||def.autoValue}）`:hint,
               def.note||''].filter(Boolean).join('｜');
  /* **単位はここで組み立てない**（§9.233 ④）。器（`.opf-widget`）は
     あとから末尾に足されるので、ここで置くと「外下」の単位が器の**上**へ
     出る。置き場を決めるのは`placeUnit()`の1箇所。 */
  label.innerHTML=`<span class="opf-name">${esc(def.name)}`
   +(def.required?'<b class="opf-req" title="入力が要ります">必須</b>':'')+'</span>'
   +control
   +(def.choiceMissing?`<small class="opf-warn">選択肢「${esc(def.choice)}」が未登録です</small>`:'')
   +'<small class="opf-note" hidden></small>';
  applyPresentation(label,def);
  placeUnit(label,def);
  return label;
 }
 /* ---------- 単位の置き場（§9.221 ⑦、利用者の指示） ----------
    「単位を出す位置(外上左、外上中央、外上右、内部、外下左、外中央、
     外下右)、出し方…さらにカスタマイズできるように」

    **既定は`外下左`**——これが今までの見え方そのもの（欄の下に左詰めで
    小さく出ていた）。既定を変えると、設定を触っていない現場の画面が
    黙って変わる。
    `内部`は欄の中の右端へ重ねる。重ねられるのは箱が1つの欄だけなので、
    ラジオ・セグメント等では**サーバーが`外下左`へ落として返す**
    （判定は`operation_repo._row_to_item`の1箇所。画面に同じ判定を書かない）。 */
 function unitParts(def){
  const blank={top:'',inside:'',bottom:''};
  const text=String(def.unit||'').trim();
  const at=String(def.unitPlace||'外下左');
  if(!text||at==='出さない')return blank;
  const em=`<em class="opf-unit">${esc(text)}</em>`;
  if(at==='内部')return {top:'',inside:`<em class="opf-unit opf-unit-in" aria-hidden="true">${esc(text)}</em>`,bottom:''};
  const side=at.slice(-2)==='中央'?'中央':at.slice(-1);
  const line=`<span class="opf-unit-line" data-at="${esc(side)}">${em}</span>`;
  return at.indexOf('外上')===0?{top:line,inside:'',bottom:''}:{top:'',inside:'',bottom:line};
 }
 /* 寄せ・見せ方・単位の置き場は**器の属性**で持つ（§9.221 ⑦）。CSSは
    属性を見るだけになり、値そのものを持つ`<select>`/`<input>`には触らない
    ——組み込みの欄（オペレータ等）へも同じ関数で当てられる。 */
 function applyPresentation(host,def){
  if(!host)return;
  /* 「選ばない」の札を出すかは**行の設定**（§9.246 ①）。**当てるのはここ**
     ——`layout()`（測定画面）と`WL.opData.presentation()`（設定窓の見本）が
     どちらもこの1本を通るので、見本と実物が食い違わない（§9.221 ⑦と同じ
     約束）。当てる側の`applyBlankPolicy()`は**DOMの印だけ**を見るので、
     候補を入れ直したあと（`applyContextChoices()`→`syncWidgets()`）にも
     定義を持ち歩かずに当て直せる。 */
  if(def&&def.noBlank)host.dataset.opNoblank='1';else delete host.dataset.opNoblank;
  applyBlankPolicy(host);
  /* 選択肢のまとまり名を器へ刻む（§9.248 ⑤）。**数えるのは1箇所**——
     組み込みの欄と自由項目で配線が別なので、どちらも通るこの器の上で
     `change`を受ける（`bind()`は自由項目しか配線しない）。
     `preview`（設定窓の見本）では刻まない——見本で押した回数まで数えると、
     現場で1度も選んでいない値が上へ来る。 */
  if(def&&def.choice&&!def.preview)host.dataset.opChoice=def.choice;
  else delete host.dataset.opChoice;
  const at=String(def.unitPlace||'外下左');
  const align=String(def.align||'自動');
  const fmt=String(def.valueFormat||'そのまま');
  host.dataset.opunit=(def.unit||'')&&at!=='出さない'?at:'なし';
  host.dataset.opalign=align;
  /* 単位を重ねる幅は**文字数から**決める（`ch`は数字の幅なので、
     `mm`のような英字でも近い値になる）。器へ渡し、欄の右余白がこれを見る。 */
  host.style.setProperty('--opf-unit-w',String(Math.max(1,String(def.unit||'').length))+'ch');
  /* ---------- 重ねたぶんの逃げ場（§9.233 ③④、利用者の指摘） ----------
     「追加したばかりの『母材』のところだけ、単位を内部に入れ込んで設定した
      ときにデータ入力を右寄せにすると単位と被ってしまいます」

     幅は**ここで決めて器の変数へ渡す**。以前はCSSが
     `.measure-shell .selectors>label[data-opunit="内部"]>input{padding-right:…}`
     と**器ごとにセレクタを書き分けて**おり、①準備のカードと設定窓の見本に
     しか当たらなかった——母材（`.material-grid`）は器の名前が違うので、
     値が単位の上へ乗っていた。器を1つ足すたびにCSSを書き足す作りだと、
     足し忘れた器だけが静かに壊れる。
     プルダウンは右端に▼の場所（実測16px）が要るので、そのぶん内側へ寄せる
     ——**見えている操作面**で見分けること（器を被せた欄では`<select>`は
     1pxの裏方で、▼は出ていない）。 */
  const shown=displayEl(host);
  if((def.unit||'')&&at==='内部'){
   const caret=(shown&&shown.tagName==='SELECT')?' + 16px':'';
   host.style.setProperty('--opf-pad-r',`calc(var(--opf-unit-w,2ch) + var(--space-4)${caret})`);
  }else host.style.removeProperty('--opf-pad-r');
  /* **値を持つ欄が無くても、画面に出ている欄はある**（§9.233 ①②）。
     母材の参考値3つ（元幅・屑幅・計算全長）は`<output>`で、`valueEl()`は
     「書ける欄」を返す口なので当たらない——以前はここで黙って落ちており、
     自動で入る値だけ見せ方の設定が一切効かなかった。 */
  const el=valueEl(host)||outputEl(host);
  if(el){
   /* **`<select>`には見せ方を当てない。** 値が選択肢そのものなので、
      3桁区切りやゼロ埋めを掛けると`putValue()`が`1234`を`1,234`にし、
      どの`<option>`にも当たらず**`select.value`が空になる**——画面から
      記録が消え、そのまま保存すると空で上書きされる。`attachFormat()`は
      同じ理由で`SELECT`を外しているので、**書く側もここで揃える**
      （読む側`fmtOf()`に条件を足すと、当てない理由が2箇所に散る）。 */
   /* `<output>`も同じ扱い（`attachFormat()`は欄を離れたときに整えるが、
      画面が値を入れる欄には「離れる」瞬間が無い。当てない理由を1箇所に
      そろえる——設定窓は「自動で入る値には効きません」と書く）。 */
   const plain=el.tagName==='SELECT'||el.tagName==='OUTPUT';
   el.dataset.opfmt=(plain||fmt==='そのまま')?'':fmt;
   if(!plain&&def.digits)el.dataset.opdigits=String(def.digits);
   else delete el.dataset.opdigits;
  }
 }

/* ---------- 単位を置く（§9.233 ④、利用者の指摘） ----------
    「単位を設定するときに位置を選べますが、選択したUIによっては、単位の
     位置のずれや単位が出ないということがある」

    以前は**2箇所で別々に組み立てて**いた——自由項目は`fieldEl()`が
    `<label>`のinnerHTMLへ、組み込みの欄は`syncBuiltinUnit()`が末尾へ。
    どちらも**器（`.opf-widget`）が後から末尾に足される**ことを知らないので、
      ・「外下」… 単位が器の**上**に出る（欄と単位のあいだにボタンが挟まる）
      ・「内部」… 1pxの裏方の`<select>`に重なり、**一度も見えない**
    という形で出ていた。置くのは**ここ1箇所**で、基準は必ず
    `displayEl()`＝いま見えている操作面。

    **同じ形なら触らない**（§9.131）——`layout()`は畳み・条件で何度も走る
    ので、毎回入れ替えると読んでいる最中に単位が瞬く。 */
 function placeUnit(host,def){
  if(!host)return;
  const u=unitParts(def);
  const want=u.top+u.inside+u.bottom;
  const anchor=displayEl(host);
  /* 印は「出す物」と「どこを基準にしたか」の組。器が出入りすると
     基準の素性が変わるので、そのときだけ置き直す。 */
  const sig=want+'@'+(anchor?anchor.tagName+'.'+(anchor.className||''):'-');
  if(host.dataset.opunitSig===sig)return;
  host.dataset.opunitSig=sig;
  host.querySelectorAll(':scope>.opf-unit-line,:scope>.opf-unit-in').forEach(x=>x.remove());
  if(!want)return;
  if(u.top){
   if(anchor)anchor.insertAdjacentHTML('beforebegin',u.top);
   else host.insertAdjacentHTML('beforeend',u.top);
  }
  if(u.inside&&anchor)anchor.insertAdjacentHTML('afterend',u.inside);
  if(u.bottom){
   if(anchor)anchor.insertAdjacentHTML('afterend',u.bottom);
   else host.insertAdjacentHTML('beforeend',u.bottom);
  }
 }

 /* ---------- 選ばせ方（§9.218 ②、利用者の指示） ----------
    「プルダウンだけでなく、ラジオボタンやタブっぽいボタン、フローティング
     モーダルみたいに選択肢が多い時に説明付きで出ると選びやすいので、
     そのような選ばせるUIを選ぶ機能も追加実装してください」

    **値を持つのは今までどおり`<select>`**。ボタン側から`value`を書いて
    `change`を飛ばすだけにする——こうすると
      ・記録の読み書き（`values()`／`apply()`／`collect()`）
      ・必須の判定（`activeRequiredControls()`は`controlOf()`が返す部品を見る）
      ・仕掛由来のプリセット（内径・§9.204）や条数の上限（§9.210 ⑤）
    が**1つも書き換わらない**。組み込みの欄（オペレータ・作業人数…）にも
    同じ形で当てられるのはこのため。

    **selectを`display:none`にしないこと。** `focus()`が効かなくなり、
    未入力のときに「直す場所」へ連れて行けない（§9.122と同じ理由で、
    寸法ゼロの要素はフォーカスを持てない）。1pxの見えない器として残し、
    未入力・公差外の色は**兄弟セレクタ**（`select.validation-required~.opf-widget`）で
    ボタン側へ移す——`:has()`に頼らないのは、当たらなかったときに
    「色が付かない」ことに誰も気づけないから。 */
 const WIDGET_SELECT='プルダウン';
 function widgetOf(def){return String(def.widgetLive||def.widget||WIDGET_SELECT)}
 /* 選択肢の説明（`一覧`で出す）。**説明のある値だけ**サーバーが返す。 */
 const noteOf=(def,v)=>String((def.choiceNotes||{})[v]||'');
 /* selectの選択肢を「値と表示」の組で読む。**先頭の空を落とさない**
    ——「まだ選んでいない」へ戻せなくなる（§9.203と同じ罠）。 */
 /* **手打ちの席は候補に混ぜない**（§9.220 ③）。混ぜると、打った値が
    次の組み直しで「選択肢の1つ」としてボタンに並ぶ。 */
 function optionsOf(sel){
  return [...sel.options].filter(o=>o.dataset.opFree!=='1').map(o=>({v:o.value,t:o.text}));
 }
 /* ---------- 「選ばない」の札はどれか（§9.246 ①、利用者の報告） ----------
    「操業データ項目マスタで空欄の札を出さないに設定しても、自動の項目
     (役割が設定されている項目)の場合、選択自体はできているが、それが
     有効になりません。実際に適用された入力画面を見ると、空欄の札である
     「－」が出たままになっています」

    **空文字だけではない。** 組み込みの選択欄（オペレータ・検査員・
    板厚/板幅測定器・内径・スプール）の候補は`base.js`の`optionFill()`が
    入れており、**先頭へ`-`を1つ足す**——未選択の札の値は`''`ではなく`'-'`。
    `noBlank`の絞り込みが`o.v!==''`しか見ていなかったので、
    **組み込みの欄では一度も効いていなかった**。

    設定窓の見本はマスタの値（`def.choices`）だけから部品を作るので`—`が
    出ず、**見本と実物が食い違う**という形で出ていた（利用者の証拠③④）。

    **判定はここ1箇所。** `o.t==='-'`まで見るのは、`syncWidget()`の
    `is-empty`判定・入切の`sel.value!=='-'`・札のラベル生成が既に同じ約束で
    書かれているため（`-`＝未選択、はこの画面全体の既定の読み方）。 */
 const isBlankOpt=o=>o.v===''||o.v==='-'||o.t==='-';
 const isBlankVal=v=>{const s=String(v==null?'':v).trim();return s===''||s==='-'};
 /* 選ばせてよい候補だけ。**器を作る側も浮き窓も同じこれを通す**
    ——別々に絞ると、形を変えたときだけ「—」が戻る状態が作れる。 */
 const pickableOpts=(opts,def)=>(def&&def.noBlank)?opts.filter(o=>!isBlankOpt(o)):opts;
 /* 素の`<select>`にも当てる（§9.246 ①）。ボタン系の札を落とすだけでは
    **プルダウン・一覧では「—」が残る**（利用者「セグメント以外のUIに
    変えても改善しません」）。

    **値は作らないこと。** 先頭の候補を勝手に選ぶと、利用者が選んでいない
    値が記録へ入る（§9.204と同じ罠）。空欄のままなら`selectedIndex=-1`で
    **何も選ばれていない**ことをそのまま出す——「自動で持ってくるものが
    なければ未選択」（利用者の証拠⑤）がこれ。

    消さずに`hidden`＋`disabled`で伏せるのは、`noBlank`を外したときに
    **候補を取り直さずに戻せる**ようにするため。 */
 function applyBlankPolicy(host){
  if(!host)return;
  const sel=host.querySelector(':scope>select');
  if(!sel)return;
  const off=host.dataset.opNoblank==='1';
  [...sel.options].forEach(o=>{
   const want=off&&isBlankOpt({v:o.value,t:o.text});
   if(o.hidden!==want)o.hidden=want;
   /* `hidden`だけだと、選ばれている札は閉じた欄にそのまま出る。 */
   if(o.disabled!==want)o.disabled=want;
  });
  if(off&&isBlankVal(sel.value)&&sel.selectedIndex>=0)sel.selectedIndex=-1;
 }
 /* **値を持つのは`<select>`とはかぎらない**（§9.219 ③）。数値の欄
    （縦割数・横割数や自由項目の数値）は`<input>`なので、器を被せる側は
    どちらでも引ける口から取る。**ここを1箇所にしておくこと**——2箇所で
    別々に引くと、片方だけ`<input>`に対応した状態が作れる。 */
 function valueEl(host){
  return host.querySelector(':scope>select')||host.querySelector(':scope>input:not([type=hidden])');
 }
 /* **値は持たないが画面には出ている欄**（§9.233 ①②、利用者の指摘
    「自動で入る値の場合、単位設定や外観変更などしても変更が効かないものが
     多いです」）。母材の参考値3つ（元幅（実績）・屑幅（両耳合計）・
    計算全長（参考））は`<output>`で、`valueEl()`は「**書ける**欄」を返す口
    なので当たらない——単位も寄せも意匠もここで黙って落ちていた。
    **`valueEl()`に混ぜないこと**——`setValue()`／`syncWidget()`が書き込む
    先はあくまで値を持つ欄で、混ぜると読み取り専用の欄へ値を書きに行く。 */
 function outputEl(host){return host.querySelector(':scope>output')}
 /* いま**見えている**操作面。器を被せた欄では`<select>`は1pxの裏方
    （`.opf-native-off`）なので、その隣へ単位を置いても誰にも見えない。
    素のプルダウン（`.opf-plain`）は器が空で`<select>`が見えているため、
    そちらを返す。**単位の置き場も逃げ場の幅もこの1箇所を基準にする**
    ——別々に引くと「セグメントだけ単位が出ない」という穴が残る。 */
 function displayEl(host){
  return host.querySelector(':scope>.opf-widget:not(.opf-plain)')
    ||valueEl(host)||outputEl(host);
 }
 /* 数値の刻み。**マスタで決めていればそれ**（§9.220 ⑤、利用者の指示
    「ステップ入力に関して、ステップ量も決められるようにしてほしい」）。
    決めていなければ今までどおり——整数は1、小数は桁から作る（小数2桁なら
    0.01）。**0を「決めた」と読まないこと**（押しても動かない道具になる）
    ので、サーバーの`normalize_step()`が0と負をnullへ倒している。 */
 function stepOf(def){
  const fixed=Number(def&&def.step);
  if(Number.isFinite(fixed)&&fixed>0)return fixed;
  if(isInteger(def.type)||!isNumeric(def.type))return 1;
  const d=Number.isFinite(Number(def.decimals))?Number(def.decimals):1;
  return Math.pow(10,-Math.max(0,Math.min(4,d)));
 }
 /* **`null`・空欄を0と読まないこと**（§9.220 ⑤で判明した既存の不具合）。
    `Number(null)`も`Number('')`も**0で、しかも有限**なので、素の
    `Number.isFinite`だけで見ると「上下限を決めていない」が「上下限は0」に
    化ける。実害は2つ出ていた——①ステッパーが`Math.min(hi,v)`で必ず0へ
    丸められ**＋を押しても増えない** ②`lo===null||hi===null`が成立せず、
    上下限の無い項目でも**目盛0〜0のスライダー**が出る（「上下限を決めると
    スライダーになります」の案内が一度も出なかった）。
    §9.160の「空欄を0と読まないこと」と同じ罠。 */
 const numOr=(v,alt)=>{
  if(v===null||v===undefined||v==='')return alt;
  const n=Number(v);return Number.isFinite(n)?n:alt;
 };
 function widgetHost(host){
  let box=host.querySelector(':scope>.opf-widget');
  if(!box){box=document.createElement('div');box.className='opf-widget';host.appendChild(box)}
  return box;
 }
 /* 押した結果を`select`へ書いて`change`を飛ばす。**`input`も飛ばす**
    ——`updateValidationVisuals()`は両方をcaptureで拾っており、片方だけだと
    未入力の印が更新されない経路が残る。 */
 function setValue(sel,v){
  if(sel.value===v)return;
  sel.value=v;
  sel.dispatchEvent(new Event('input',{bubbles:true}));
  sel.dispatchEvent(new Event('change',{bubbles:true}));
 }
 /* **「人が候補から選んだ」ことは呼ぶ側が名乗る**（§9.248 ⑤）。
    器を被せた選ばせ方（一覧・メニュー・パネル・ボタン群・切替・入切）は、
    札を押しても値を持つのは`<select>`のままで、飛ぶ`change`は
    **`setValue()`が作った合成イベント＝`isTrusted`が偽**。だから
    「本物のイベントだけ数える」では、**この⑤がいちばん効かせたい形
    （新しい表示領域を開くタイプ）が1回も数えられない**。
    かといって`change`を全部数えると、記録の復元・仕掛由来のプリセット・
    `syncWidgets()`の当て直しまで数に入り、**開き直すたびに前回の値が
    先頭へ固定される**。
    そこで**選んだ瞬間だけ立てる印**を持つ。`dispatchEvent`は同期なので、
    数える側（`wireChoiceUsage()`）はこの印が立っている間に呼ばれる。 */
 let userPicking=0;
 function pickValue(sel,v){userPicking++;try{setValue(sel,v)}finally{userPicking--}}
 /* いま選ばれているものに印を付け直す。**作り直さない**——押すたびに
    組み直すと、キーボードで辿っている途中でフォーカスが飛ぶ。 */
 function syncWidget(host){
  const sel=valueEl(host);
  const box=host.querySelector(':scope>.opf-widget');
  if(!sel||!box)return;
  const v=String(sel.value==null?'':sel.value);
  /* 数値・自由記述の器（§9.219 ③）。**作り直さずに値だけ合わせる**
     ——打っている最中に部品が入れ替わると、カーソルが飛ぶ。 */
  const rg=box.querySelector('.opf-range-in');
  if(rg&&rg.value!==v)rg.value=v;
  const ta=box.querySelector('.opf-memo-in');
  if(ta&&ta.value!==v)ta.value=v;
  const steps=box.querySelectorAll('[data-opstep]');
  if(steps.length){
   const lo=(sel.min===''||sel.min==null)?null:Number(sel.min);
   const hi=(sel.max===''||sel.max==null)?null:Number(sel.max);
   const n=Number(v);
   steps.forEach(b=>{
    const d=Number(b.dataset.opstep);
    b.disabled=!!(Number.isFinite(n)&&((d<0&&lo!==null&&n<=lo)||(d>0&&hi!==null&&n>=hi)));
   });
  }
  box.querySelectorAll('[data-opv]').forEach(b=>{
   const on=b.dataset.opv===v;
   b.classList.toggle('is-on',on);
   b.setAttribute('aria-checked',on?'true':'false');
   b.tabIndex=on?0:-1;
  });
  const cur=box.querySelector('.opf-pick-now');
  if(cur){
   const hit=[...sel.options].find(o=>o.value===v);
   cur.textContent=(hit?hit.text:v)||'選ぶ';
   cur.classList.toggle('is-empty',!v||v==='-');
  }
  /* ---- 手打ち（§9.226 ①、利用者の指示） ----
     「選択肢から選べるタイプの例外処理の候補にない値を入力するパターンは、
      外観のデザインを損なった設計になっているので、スマートに選択肢を出す
      ボックスをそのまま利用できるようにしてほしい」

     以前は**選ぶ器の下に打ち込み欄をもう1つ**足していた（`.opf-free`）。
     打つ場所と選ぶ場所が2つ並ぶので、どちらが効いているのか読めず、
     欄の高さも1つだけ2段になって並びが崩れていた。いまは
       ・プルダウン … **選ぶ器そのものが打てる**（`.opf-combo`。▾で候補）
       ・一覧       … 浮き窓の**絞り込み欄がそのまま**手打ちになる
       ・ボタン系   … 末尾の「その他」が**その場で入力欄に変わる**
     で、**どの形でも打つ場所は1つ**。 */
  const cb=box.querySelector('.opf-combo-in');
  if(cb&&document.activeElement!==cb){
   const hit=[...sel.options].find(o=>o.value===v&&o.dataset.opFree!=='1');
   const shown=hit?hit.text:v;
   if(cb.value!==shown)cb.value=(shown==='-'?'':shown);
  }
  const ox=box.querySelector('.opf-other-in');
  if(ox){
   const free=isFreeValue(sel,v);
   if(document.activeElement!==ox&&ox.value!==(free?v:''))ox.value=free?v:'';
   box.classList.toggle('is-other-on',free);
   const ob=box.querySelector('.opf-other-btn');
   if(ob){ob.classList.toggle('is-on',free);ob.setAttribute('aria-checked',free?'true':'false')}
  }
  /* 段階（§9.226 ①）。**選んだところまで塗る**——順番に意味がある選択肢
     なので、1つだけ光らせると「何段目か」を数えることになる。 */
  /* **「その他」の席を段として数えないこと**（§9.226 ①）。手打ちの席は
     見た目をそろえるため同じクラスを持つが、段ではない（`data-opv`が無い）
     ——数えると、手打ちを入にした瞬間に段が1つ増えて塗りがずれる。 */
  const stage=[...box.querySelectorAll('.opf-stage-btn[data-opv]')];
  if(stage.length){
   const at=stage.findIndex(b=>b.dataset.opv===v);
   stage.forEach((b,i)=>b.classList.toggle('is-fill',at>=0&&i<=at));
   const now=box.querySelector('.opf-stage-now');
   if(now)now.textContent=at>=0?`${at+1}/${stage.length}`:'—';
  }
  /* 切替（§9.247 ①）。**いま何番目か・次が何か**を文字で出す——押した先が
     見えないと、目当ての値まで何回押すのか数えることになる（§2）。 */
  const cyNow=box.querySelector('.opf-cycle-now');
  if(cyNow){
   let arr=[];try{arr=JSON.parse(box.dataset.opCycle||'[]')}catch(_){}
   const at=arr.findIndex(o=>o[0]===v);
   const cur=at>=0?arr[at][1]:(v||'—');
   cyNow.textContent=cur;
   cyNow.classList.toggle('is-empty',!v||v==='-');
   const pos=box.querySelector('.opf-cycle-pos');
   if(pos)pos.textContent=arr.length?(at>=0?`${at+1}/${arr.length}`:`—/${arr.length}`):'';
   const nx=box.querySelector('.opf-cycle-next');
   if(nx){
    /* **次が今と同じなら言わない**（選択肢が1つのとき。押しても変わらない
       ものに「次: 〜」と書くと、押せば変わると読める・§4）。 */
    const to=arr.length>1?arr[(at<0?0:(at+1)%arr.length)][1]:'';
    nx.textContent=to?`次 ${to}`:'';
   }
  }
  /* 入切（§9.226 ①）。**入＝先頭の値／切＝空**の1つのスイッチ。 */
  const sw=box.querySelector('.opf-switch-btn');
  if(sw){
   const on=!!v&&v!=='-';
   sw.classList.toggle('is-on',on);
   sw.setAttribute('aria-checked',on?'true':'false');
   const t=sw.querySelector('.opf-switch-text');
   if(t)t.textContent=on?(sw.dataset.opOnLabel||'入'):(sw.dataset.opOffLabel||'切');
  }
  /* 定型文（§9.226 ①）。**いま文の中にある語句に印を付ける**——押した
     ことが分からないと、2度押して同じ語句を並べてしまう。 */
  const words=[...box.querySelectorAll('[data-opw]')];
  if(words.length){
   const t=String(v||'');
   words.forEach(b=>b.classList.toggle('is-on',!!b.dataset.opw&&t.indexOf(b.dataset.opw)>=0));
  }
  /* 底の帯（§9.250 ⑧）。メーターとスライダーが**同じ1本**を使う——
     どちらも「上下限のどこに居るか」を言う道具で、違うのは引けるかどうか
     だけ。**行を増やさない**ので、位置は`.opf-num-rail`の中の塗りだけで
     語る。**目盛の数字は出さない**——効いている上下限は決まり書き
     （`ruleText()`）が既に文字で出しており、同じ数を2箇所に置くと
     読む側が数え直すことになる（§CLAUDE 8）。全文は`title`（§9.234 ①）。 */
  const fill=box.querySelector('.opf-num-fill');
  if(fill){
   const lo=Number(box.dataset.opLo),hi=Number(box.dataset.opHi),n=Number(v);
   const ok=Number.isFinite(n)&&Number.isFinite(lo)&&Number.isFinite(hi)&&hi>lo;
   const pct=ok?Math.max(0,Math.min(100,(n-lo)/(hi-lo)*100)):0;
   fill.style.width=pct.toFixed(2)+'%';
   /* **範囲の外は色と形の両方で言う**（§3）。`settle()`が欄を離れた時点で
      上下限まで戻すので、外れているのは打っている最中だけ——それでも
      黙って戻すより、その場で分かるほうが速い。 */
   const out=ok&&(n<lo||n>hi);
   box.classList.toggle('is-out',!!out);
   const rail=box.querySelector('.opf-num-rail');
   if(rail&&Number.isFinite(lo)&&Number.isFinite(hi)){
    rail.title=(rail.classList.contains('is-live')
      ?'押した位置へ動きます（細かく決めるときは右の ↔ ）｜'
      :'')+`${lo}〜${hi}`+(Number.isFinite(n)?`（いま ${v}${out?'・範囲の外':''}）`:'');
   }
  }
 }
 /* ============================================================
    数値の器（§9.250 ⑧、利用者の指示）
    ------------------------------------------------------------
    「ステッパー、スピナー、スライダー、キーパッド、早見ボタン、メーターなど、
     メインで数値を取り扱うものほぼすべてにおいて、そのまま打つで決まるUI
     サイズをベースに考えると、縦横サイズが大きくなるか、UI内に被り正常に
     使えない状態です。…範囲に収めること、入力データは隠さないこと、
     使いやすいこと、デザインに統一感があり美しいこと」

    **物差しは「そのまま打つ」の1枠**。幅は`[どこに出すか]`のマスが決めて
    いて（`--op-cols`の`minmax(0,1fr)`）**それ以上には使えない**し、高さは
    敷き詰めるので**名前の行＋欄の1行**を超えてはいけない。以前は器を欄の
    **下へ足して**いたので、実測で
      ステッパー +35px ／ スライダー +45px ／ キーパッド +54px ／
      早見ボタン +89px ／ メーター +23px
    と、道具を選んだ欄だけが縦に伸びて隣とそろわなくなっていた
    （唯一そろっていたのがスピナーで、あれだけが**欄の行へ引き上げて**いた）。

    直し方は**スピナーの作法を6つ全部へ広げる**こと:

      1. 道具は必ず**欄の行の中**（`.opf-num`）。器は負の余白で1行ぶん
         引き上げるので、**縦の footprint は0**（`--gap-tight`のぶんも引く）。
      2. 右端に**帯（`.opf-num-strip`）**を置き、欄の`padding-right`で
         **同じ幅だけ場所を空ける**（`--opf-num-w`）。だから値が道具の下へ
         潜らない（§9.233 ③の`--opf-pad-r`と同じ約束。単位を内側へ重ねる
         設定と**足し算で共存**する）。
      3. 帯に入りきらないもの（スライダーの目盛・テンキー・早見の並び）は
         **押すと浮くポップオーバー**にする（§9.201の作法をそのまま使う）。
         ——「常時表示できるものはそれで収まる方が良いがそうではない場合は、
         ポップオーバーの要素を加えた複合的なコントロールに」（利用者の指示）
      4. いまどこに居るかは**欄の底の細い帯**（`.opf-num-rail`）で言う。
         行を増やさずに位置が読め、値の字にも被らない。

    **器は`pointer-events:none`**——欄の上に重ねるので、素通しにしないと
    欄そのものが押せなくなる（押せるのは帯と底の目盛だけ）。
    ============================================================ */
 const NUM_WIDGETS=['ステッパー','スピナー','スライダー','キーパッド','早見ボタン','メーター'];
 /* 帯の幅（em）。**1箇所で持つ**——欄の逃げ場（`--opf-num-w`）とCSSの
    見た目が同じ数を見るので、片方だけ変えた状態が作れない。
    `em`なのは表示サイズ（`--ui-scale`）に追随させるため（§9.199）。 */
 const NUM_STRIP={'スピナー':1.7,'ステッパー':3.4,'スライダー':1.9,
                  'キーパッド':1.9,'早見ボタン':1.9,'メーター':0};
 /* 底の目盛を出す形。**スライダーとメーターだけ**——他は「いまどこか」を
    語る道具ではないので、出すと意味の無い線が増える。 */
 const NUM_RAIL={'スライダー':1,'メーター':1};
 /* よく使う値を並べる（§9.223 ③）。上下限と刻みから作り、**多すぎるときは
    出さない**——20個も並ぶと「探す」作業になり、打ったほうが速い（§4）。 */
 const QUICK_MAX=12;
 function quickValues(def){
  const step=stepOf(def),lo=numOr(def.min,null),hi=numOr(def.max,null);
  if(lo===null||hi===null||!(step>0))return null;
  const n=Math.round((hi-lo)/step)+1;
  if(n<2||n>QUICK_MAX)return null;
  const dec=String(step).indexOf('.')>=0?String(step).split('.')[1].length:0;
  const out=[];
  for(let i=0;i<n;i++){const v=lo+i*step;out.push(dec?v.toFixed(dec):String(Math.round(v)))}
  return out;
 }
 /* 刻みから小数桁を決める（浮動小数の誤差を持ち込まない）。 */
 function stepDec(step){
  const s=String(step);const i=s.indexOf('.');
  return i<0?0:s.length-i-1;
 }
 function numFix(v,step){const d=stepDec(step);return d?v.toFixed(d):String(Math.round(v))}

 /* ---------- 数値のポップオーバー（§9.250 ⑧） ----------
    **`一覧`（`.opf-picker`）でも`メニュー`（`.opf-menu-pop`）でもない第3の窓**
    にはしない——置き場所の決め方（`placeMenu`）・閉じ方・意匠の持ち出し
    （`carryLook`）は`メニュー`と同じでよいので、**同じ道具を使い回す**
    （§9.164）。違うのは中身だけ。 */
 let numPopEl=null,numPopBack=null,numPopOff=null;
 function ensureNumPop(){
  if(numPopEl)return numPopEl;
  numPopEl=document.createElement('div');
  numPopEl.className='opf-menu-pop opf-num-pop';numPopEl.id='opfNumPop';numPopEl.hidden=true;
  document.body.appendChild(numPopEl);
  WL.modal.keepOpen(numPopEl);
  /* **開いた器は必ず控える**（§9.222 ①）——控えないと、外クリックもEscも
     先頭の`if(!el)return`で引き返し、どれでも閉じられないまま積み上がる。 */
  document.addEventListener('mousedown',e=>{
   if(!numPopEl||numPopEl.hidden)return;
   if(numPopEl.contains(e.target))return;
   if(numPopBack&&numPopBack.contains&&numPopBack.contains(e.target))return;
   closeNumPop();
  },true);
  document.addEventListener('keydown',e=>{
   if(numPopEl&&!numPopEl.hidden&&WL.modal.escCloses(e)){e.stopPropagation();closeNumPop()}
  },true);
  return numPopEl;
 }
 function closeNumPop(){
  if(!numPopEl||numPopEl.hidden)return;
  numPopEl.hidden=true;
  if(numPopOff){numPopOff();numPopOff=null}
  const back=numPopBack;numPopBack=null;
  if(back){
   back.setAttribute('aria-expanded','false');
   if(back.focus){try{back.focus()}catch(e){}}
  }
 }
 function openNumPop(def,host,el,btn,kind){
  const pop=ensureNumPop();
  numPopBack=btn;
  carryLook(host,pop);                       /* §9.247 ① 欄と同じ角丸・色で開く */
  pop.hidden=false;
  btn.setAttribute('aria-expanded','true');
  const step=stepOf(def),lo=numOr(def.min,null),hi=numOr(def.max,null);
  const unit=def.unit?`（${def.unit}）`:'';
  const head=`<div class="opf-num-pop-head"><b>${esc(def.name)}${esc(unit)}</b>`
    +`<output class="opf-num-pop-val"></output></div>`;
  let body='';
  if(kind==='スライダー'){
   body='<div class="opf-num-pop-slide">'
     +`<input type="range" class="opf-range-in" min="${lo}" max="${hi}" step="${step}">`
     +`<span class="opf-range-scale"><i>${esc(String(lo))}</i><i>${esc(String(hi))}</i></span>`
     +'</div>';
  }else if(kind==='早見ボタン'){
   const vs=quickValues(def)||[];
   /* 並べ方（§9.226 ①）は**窓の中の並び**に効く——`早見ボタン`は
      `LAYOUT_WIDGETS`に載っているので、当てないと設定が黙って効かなくなる。 */
   body='<div class="opf-num-pop-quick">'+vs.map(v=>
     `<button type="button" class="opf-quick-btn" data-opv="${esc(v)}">`
     +`<span class="opf-btn-text">${esc(v)}</span></button>`).join('')+'</div>';
  }else{
   /* テンキー。**`0`と`.`と`←`と`消す`まで**（打ち直せない窓にしない）。 */
   const keys=['7','8','9','4','5','6','1','2','3','0','.','←'];
   body='<div class="opf-num-pop-pad">'+keys.map(k=>
     `<button type="button" class="opf-numkey" data-opk="${esc(k)}">${esc(k)}</button>`).join('')
     +'<button type="button" class="opf-numkey opf-numkey-wide" data-opk="clear">消す</button>'
     +'<button type="button" class="opf-numkey opf-numkey-wide opf-numkey-ok" data-opk="ok">入れる</button>'
     +'</div>';
  }
  pop.innerHTML=head+body;
  const view=pop.querySelector('.opf-num-pop-val');
  const paint=()=>{if(view)view.value=String(el.value||'')||'—'};
  paint();
  if(kind==='スライダー'){
   const rg=pop.querySelector('.opf-range-in');
   if(rg){
    rg.value=String(numOr(el.value,lo));
    rg.oninput=()=>{setValue(el,rg.value);paint();syncWidget(host)};
   }
  }else if(kind==='早見ボタン'){
   applyLayout(pop.querySelector('.opf-num-pop-quick'),def);
   pop.querySelectorAll('[data-opv]').forEach(b=>{
    const on=b.dataset.opv===String(el.value||'');
    b.classList.toggle('is-on',on);
    b.onclick=e=>{e.preventDefault();setValue(el,b.dataset.opv);syncWidget(host);closeNumPop()};
   });
  }else{
   pop.querySelectorAll('[data-opk]').forEach(b=>{
    b.onclick=e=>{
     e.preventDefault();
     const k=b.dataset.opk;
     if(k==='ok'){closeNumPop();return}
     let v=String(el.value||'');
     if(k==='clear')v='';
     else if(k==='←')v=v.slice(0,-1);
     else if(k==='.'){if(v.indexOf('.')<0)v=(v||'0')+'.'}
     else v+=k;
     setValue(el,v);paint();syncWidget(host);
    };
   });
  }
  placeMenu(pop,btn);
  const onScroll=()=>closeNumPop();
  window.addEventListener('scroll',onScroll,true);
  window.addEventListener('resize',onScroll);
  numPopOff=()=>{
   window.removeEventListener('scroll',onScroll,true);
   window.removeEventListener('resize',onScroll);
  };
 }

 /* ---------- 道具を欄の行へ重ねる（§9.250 ⑧） ----------
    **位置と高さは欄を測って入れる。** CSSの定数では決められない——器は
    場面によって`flex`（`gap`あり）にも素のブロック（`gap`なし＋行boxの
    descenderぶん）にもなり、単位を「外上」にすれば欄の上に行が増える。
    **測ってから書く**のは§9.130（入れ物の大きさは中身から決める）と同じ作法。

    測るのは`requestAnimationFrame`で**まとめて1回**——欄ごとに読むと、
    そのたびにレイアウトが起きる（§9.94「ブラウザに測らせない」）。
    器の大きさが変わったら測り直す（`ResizeObserver`）——単位の置き場を
    変えた・表示サイズを変えた・窓幅が変わった、が全部ここを通る。
    **同じ値なら触らない**（§9.131。見張りと組み合わせると回り続ける）。 */
 let numRO=null,numQueue=null,numRaf=0;
 function placeNumNow(host){
  if(!host||!host.isConnected)return;
  const box=host.querySelector(':scope>.opf-num');
  if(!box)return;
  const el=valueEl(host)||outputEl(host);
  if(!el)return;
  const hr=host.getBoundingClientRect(),er=el.getBoundingClientRect();
  if(!(er.height>0))return;                  /* まだ描かれていない／隠れている */
  const top=Math.round(er.top-hr.top)+'px',h=Math.round(er.height)+'px';
  if(box.style.top!==top)box.style.top=top;
  if(box.style.height!==h)box.style.height=h;
 }
 function placeNumSoon(host){
  if(!host)return;
  if(!numQueue)numQueue=new Set();
  numQueue.add(host);
  if(numRaf)return;
  numRaf=requestAnimationFrame(()=>{
   numRaf=0;
   const hs=[...numQueue];numQueue.clear();
   hs.forEach(placeNumNow);
  });
 }
 function watchNum(host){
  placeNumSoon(host);
  if(typeof ResizeObserver!=='function')return;
  if(!numRO)numRO=new ResizeObserver(es=>es.forEach(e=>placeNumSoon(e.target)));
  if(host.dataset.opNumWatch)return;
  host.dataset.opNumWatch='1';
  numRO.observe(host);
 }
 function buildNumberWidget(def,host,kind){
  const el=valueEl(host);
  if(!el||el.tagName==='SELECT')return false;
  const step=stepOf(def),lo=numOr(def.min,null),hi=numOr(def.max,null);
  const sig=[kind,step,lo,hi].join('/');
  const box=widgetHost(host);
  if(box.dataset.sig===sig){syncWidget(host);return true}
  box.dataset.sig=sig;
  host.classList.add('opf-alt');
  const bump=d=>{
   const cur=numOr(el.value,numOr(lo,0));
   let v=cur+d*step;
   if(lo!==null)v=Math.max(lo,v);
   if(hi!==null)v=Math.min(hi,v);
   setValue(el,numFix(v,step));
  };
  /* **作れない道具は帯ごと出さず、理由を欄の説明へ落とす**（§4・§9.234 ①）。
     以前は「上下限を決めるとスライダーになります」という1行を欄の下へ
     足しており、**案内のほうが道具より場所を取っていた**（実測45px）。
     決めるのはマスタの設定窓なので、測定画面に置いても直せない。 */
  let ready=true,why='';
  if(kind==='スライダー'&&(lo===null||hi===null)){ready=false;why='上下限を決めるとスライダーになります'}
  if(kind==='メーター'&&(lo===null||hi===null)){ready=false;why='上下限を決めるとメーターになります'}
  if(kind==='早見ボタン'&&!quickValues(def)){
   ready=false;why=`最小・最大・刻みを決めると早見ボタンになります（${QUICK_MAX}個までのとき）`;
  }
  const wide=ready?(NUM_STRIP[kind]||0):0;
  const rail=ready&&NUM_RAIL[kind]?1:0;
  /* 欄の逃げ場（§9.233 ③）。**帯と同じ数**を器の変数で渡す——CSSが
     `--opf-pad-r`（単位を内側へ重ねたぶん）と**足し算**で使う。 */
  if(wide||rail)host.dataset.opNum=kind;else delete host.dataset.opNum;
  if(wide)host.style.setProperty('--opf-num-w',wide+'em');
  else host.style.removeProperty('--opf-num-w');
  box.className='opf-widget'+(wide||rail?' opf-num':'');
  box.innerHTML='';
  if(!ready){
   /* 道具が作れないときは**素の欄のまま**。理由は欄の説明（`title`）で言い、
      **直す場所（マスタの設定窓）にも出す**（`box.dataset.why`を設定窓が
      読む）——測定画面に案内の行を足すと、直せない場所で場所だけ取る。
      **元の説明は控えてから足すこと**——組み立て直すたびに足すと、
      同じ文が何度も並ぶ。 */
   if(host.dataset.opTitle===undefined)host.dataset.opTitle=host.title||'';
   host.title=[host.dataset.opTitle,why].filter(Boolean).join('｜');
   box.dataset.why=why;
   applyLook(host,def);
   syncWidget(host);
   return true;
  }
  
  delete box.dataset.why;
  if(host.dataset.opTitle!==undefined)host.title=host.dataset.opTitle;
  let html='';
  if(rail)html+='<i class="opf-num-rail"><b class="opf-num-fill"></b></i>';
  if(kind==='スピナー'){
   html+='<span class="opf-num-strip is-col">'
     +'<button type="button" class="opf-spin-btn opf-num-btn" data-opstep="1" aria-label="1つ増やす" title="1つ増やす">▲</button>'
     +'<button type="button" class="opf-spin-btn opf-num-btn" data-opstep="-1" aria-label="1つ減らす" title="1つ減らす">▼</button>'
     +'</span>';
  }else if(kind==='ステッパー'){
   html+='<span class="opf-num-strip">'
     +'<button type="button" class="opf-step-btn opf-num-btn" data-opstep="-1" aria-label="1つ減らす" title="1つ減らす">−</button>'
     +'<button type="button" class="opf-step-btn opf-num-btn" data-opstep="1" aria-label="1つ増やす" title="1つ増やす">＋</button>'
     +'</span>';
  }else if(kind!=='メーター'){
   /* 帯に入りきらない道具は**押すと浮く**（複合コントロール）。
      印は**それぞれ違う字**にする——同じ字だと、開くまで何が出るか
      分からない（§2）。 */
   const mark=kind==='スライダー'?'↔':(kind==='早見ボタン'?'…':'▦');
   const name=kind==='スライダー'?'目盛で決める':(kind==='早見ボタン'?'よく使う値から選ぶ':'テンキーで入れる');
   html+='<span class="opf-num-strip">'
     +`<button type="button" class="opf-num-btn opf-num-open" aria-haspopup="dialog"`
     +` aria-expanded="false" aria-label="${esc(name)}" title="${esc(name)}">${mark}</button>`
     +'</span>';
  }
  box.innerHTML=html;
  box.querySelectorAll('[data-opstep]').forEach(b=>{
   b.onclick=e=>{e.preventDefault();bump(Number(b.dataset.opstep));syncWidget(host)};
  });
  const open=box.querySelector('.opf-num-open');
  if(open)open.onclick=e=>{e.preventDefault();openNumPop(def,host,el,open,kind)};
  if(rail){
   box.dataset.opLo=String(lo);box.dataset.opHi=String(hi);
   /* スライダーは**底の帯をそのまま引ける**（メーターは読むだけ・§9.226 ①
      「値は引いて決めない」）。細いので**押した位置へ跳ばす**形にし、
      細かく合わせたいときは浮き窓で引く。 */
   if(kind==='スライダー'){
    const r=box.querySelector('.opf-num-rail');
    r.classList.add('is-live');   /* 説明は`syncWidget()`が`title`で言う */
    const at=ev=>{
     const b=r.getBoundingClientRect();
     if(!(b.width>0))return;
     const p=Math.max(0,Math.min(1,(ev.clientX-b.left)/b.width));
     const raw=lo+p*(hi-lo);
     const snapped=lo+Math.round((raw-lo)/step)*step;
     setValue(el,numFix(Math.max(lo,Math.min(hi,snapped)),step));
     syncWidget(host);
    };
    r.onpointerdown=ev=>{
     ev.preventDefault();
     r.setPointerCapture&&r.setPointerCapture(ev.pointerId);
     at(ev);
     r.onpointermove=m=>{if(m.buttons)at(m)};
     const up=()=>{r.onpointermove=null;document.removeEventListener('pointerup',up,true)};
     document.addEventListener('pointerup',up,true);
    };
   }
  }
  applyLook(host,def);                       /* §9.223 ③ */
  if(!el.dataset.opWidgetWired){
   el.dataset.opWidgetWired='1';
   el.addEventListener('input',()=>syncWidget(host));
   el.addEventListener('change',()=>syncWidget(host));
  }
  watchNum(host);                            /* 欄の行へ重ねる（測ってから） */
  syncWidget(host);
  return true;
 }
 /* 自由記述を複数行で書く（§9.219 ③）。**値を持つのは`<input>`のまま**で、
    `<textarea>`は写し——記録の読み書き・必須の判定は1つも書き換わらない。 */
 function buildMemoWidget(def,host,kind){
  const el=valueEl(host);
  if(!el||el.tagName==='SELECT')return false;
  /* 「1行」は**器を被せない**（§9.223 ③）——素の`<input>`がそのまま1行の
     入力欄なので、写しを作ると打つ場所が2つになる。意匠だけを当てる。 */
  const one=kind==='1行';
  const phrase=kind==='定型文';
  const words=phrase?(def.choices||[]).filter(Boolean):[];
  const box=widgetHost(host);
  const sig=one?'one':(phrase?'phrase|'+String(def.layout||'')+'|'+words.join('\u0002'):'memo');
  if(box.dataset.sig===sig){syncWidget(host);return true}
  box.dataset.sig=sig;
  host.classList.add('opf-alt');
  if(one){
   el.classList.remove('opf-native-off');el.removeAttribute('tabindex');
   box.className='opf-widget opf-oneline';
   box.innerHTML='';
   applyLook(host,def);
   syncWidget(host);
   return true;
  }
  if(phrase){
   /* 定型文（§9.226 ①）。**打つ欄はそのまま**で、よく使う語句を下に並べる。
      語句は**選択肢のまとまり**から取る——文字の項目にもまとまりを結び
      付けられるので、新しい置き場を作らない（§9.221 ②と同じ作法）。 */
   el.classList.remove('opf-native-off');el.removeAttribute('tabindex');
   box.className='opf-widget opf-phrase';
   box.innerHTML=words.length
     ?'<div class="opf-shape">'+words.map(w=>
        '<button type="button" class="opf-phrase-btn" data-opw="'+esc(w)+'"'
        +' title="この語句を入れます">'+esc(w)+'</button>').join('')+'</div>'
     :'<small class="opf-widget-note">「選択肢のまとまり」を選ぶと、その値が定型文のボタンとして並びます</small>';
   applyLayout(box,def);
   box.querySelectorAll('[data-opw]').forEach(b=>{
    b.onclick=e=>{
     e.preventDefault();
     /* **置き換えではなく足す**——複数の語句をつないで1文にすることが多い。
        既に同じ語句が入っているときは足さない（2度押しの取り消し）。 */
     const cur=String(el.value||'');
     const w=b.dataset.opw;
     setValue(el,cur.indexOf(w)>=0?cur.replace(w,'').replace(/\s{2,}/g,' ').trim()
                                  :(cur?cur+' '+w:w));
     syncWidget(host);
    };
   });
   applyLook(host,def);
   if(!el.dataset.opWidgetWired){
    el.dataset.opWidgetWired='1';
    el.addEventListener('input',()=>syncWidget(host));
    el.addEventListener('change',()=>syncWidget(host));
   }
   syncWidget(host);
   return true;
  }
  el.classList.add('opf-native-off');
  el.setAttribute('tabindex','-1');
  box.className='opf-widget opf-memo';
  box.innerHTML='<textarea class="opf-memo-in" rows="3"></textarea>';
  const ta=box.querySelector('.opf-memo-in');
  ta.oninput=()=>setValue(el,ta.value);
  applyLook(host,def);                       /* §9.223 ③ */
  if(!el.dataset.opWidgetWired){
   el.dataset.opWidgetWired='1';
   el.addEventListener('change',()=>syncWidget(host));
  }
  syncWidget(host);
  return true;
 }
 /* ---------- 手打ち（§9.220 ③、利用者の指示） ----------
    「マスタによる候補選択のパターンでも手打ち入力が可能なモードを追加して
     ほしいです」

    **値を持つのは`<select>`のまま**（§9.218 ②の約束を崩さない）。候補に
    無い値は`<option>`を**その場で足してから**入れる——足さずに代入すると
    `select.value`は空文字になり、**打った値が黙って消える**（選択肢に無い
    値を`select.value`へ入れる罠は§9.203・§9.204で2度踏んでいる）。 */
 function addOption(sel,v){
  const s=String(v==null?'':v);
  if(!s)return;
  if([...sel.options].some(o=>o.value===s))return;
  /* **手打ちの置き場は1つだけ**。1文字打つたびに`<option>`を足すと
     「む」「むら」「むらさ」…が溜まり、次に組み直したとき**打ちかけの
     文字がそのままボタンとして並ぶ**。既にある手打ちの席を書き換える。 */
  const slot=sel.querySelector('option[data-op-free="1"]');
  const o=slot||document.createElement('option');
  o.value=s;o.textContent=s;o.dataset.opFree='1';
  if(!slot)sel.appendChild(o);
 }
 /* **手打ちの値は必ず知らせる**（§9.226 ①）。`addOption()`は手打ちの席を
    使い回すので、`特`→`特注`と打ち足したときに**`<option>`の値を書き換えた
    時点で`select.value`も一緒に動く**——そのあと`setValue()`を呼んでも
    「同じ値」と判断されて`change`が飛ばず、**最後の1文字ぶんが記録へ入らない**
    （`bind()`の`change`が`remember()`を呼ぶ作りなので、画面には出ているのに
    レコードは1つ前の文字列、という分かりにくい壊れ方になる）。
    ここでは等値の判定をせずに必ず飛ばす。 */
 function setFree(sel,v){
  const s=String(v==null?'':v);
  addOption(sel,s);
  if(sel.value!==s)sel.value=s;
  sel.dispatchEvent(new Event('input',{bubbles:true}));
  sel.dispatchEvent(new Event('change',{bubbles:true}));
 }
 /* いまの値が「候補から選んだもの」か「打ったもの」か。**印は候補の側に
    持たせる**——`<option>`は`apply()`でも足されるので、値だけを見ると
    記録から戻した手打ちを候補と読み違える。 */
 function isFreeValue(sel,v){
  if(!v)return false;
  const hit=[...sel.options].find(o=>o.value===v);
  return !hit||hit.dataset.opFree==='1';
 }
 /* ---- ボタン系の「その他」（§9.226 ①） ----
    末尾に1つだけ席を置き、**押すとその席が入力欄に変わる**。別の欄を下へ
    足さないので、器の高さも並びも他の項目と同じまま——「打つ場所は1つ」を
    どの形でも守るための形。 */
 function otherChipHtml(cls){
  return '<span class="opf-other" data-op-other="1">'
   +'<button type="button" class="'+cls+' opf-other-btn" role="radio" aria-checked="false" tabindex="-1"'
   +' title="候補にない値をここへ打てます"><span class="opf-btn-text">その他…</span></button>'
   +'<input type="text" class="opf-other-in" autocomplete="off"'
   +' placeholder="打ち込む" aria-label="候補にない値を打つ"></span>';
 }
 function wireOther(box,sel,host){
  const wrap=box.querySelector('.opf-other');if(!wrap)return;
  const inp=wrap.querySelector('.opf-other-in');
  const btn=wrap.querySelector('.opf-other-btn');
  if(btn)btn.onclick=e=>{
   e.preventDefault();
   box.classList.add('is-other-on');
   /* **空のまま席を開ける**（値はまだ書かない）。打った時点で入る。 */
   try{inp.focus()}catch(_){}
  };
  if(inp){
   inp.addEventListener('input',()=>{
    const v=inp.value.trim();
    if(v)setFree(sel,v);else setValue(sel,'');
    syncWidget(host);
   });
   /* 空のまま外れたら席を閉じる（開きっぱなしの空欄を残さない）。 */
   inp.addEventListener('blur',()=>{
    if(!inp.value.trim())box.classList.toggle('is-other-on',isFreeValue(sel,sel.value));
   });
  }
 }
 /* 形ごとの器とボタンの名前。**形が違うものは別の名前で持つ**（§9.220 ①、
    利用者の指摘「ラジオボタンやタブがほぼ同じデザインになっている」）
    ——以前は`ラジオ`も`タブ`も同じ`.opf-seg-btn`で、違いは連なっているか
    だけだった。名前が2つあって見た目が同じなら、選ばせる意味が無い。 */
 /* ---------- 見た目（§9.223 ③、利用者の指示） ----------
    「UIの種類と見た目(色や形、美観デザイン)など組合せでカスタムできるように
      してほしいです。」
    **「何で選ばせるか」と「どう見えるか」を別の軸にする。** 一緒にすると
    「青いタブ」「緑のタブ」…と種類が掛け算で増え、選ぶ盤が読めなくなる。
    綴りはサーバー（`operation_repo.LOOK_*_SLUG`）が正で、ここは受け取った
    印をクラスへ写すだけ。 */
 const LOOK_COLOR={'既定':'','主色':'teal','青':'blue','緑':'green','橙':'amber',
                   '赤':'red','紫':'violet','灰':'slate'};
 /* 形は**角丸のバリエーション**（§9.227 ①、利用者の指示）。廃止した
    `角`/`丸`はここでも寄せる——保存済みのレコードを開いたときに
    「知らない値＝既定」へ黙って落とさない（§9.132の`UI_SIZE_ALIASES`と
    同じ作法）。綴りはサーバー（`LOOK_SHAPE_SLUG`）が正。 */
 const LOOK_SHAPE={'標準':'','控えめ':'tight','大きめ':'wide'};
 const LOOK_SHAPE_ALIAS={'角丸':'標準','角':'控えめ','丸':'大きめ'};
 const LOOK_SIZE={'小':'sm','中':'','大':'lg'};
 /* **印を持つのは器（`<label>`）1箇所**。CSSはそこから下って当てる——
    部品ごとに付けると、形を足すたびに付け忘れが出る。 */
 function applyLook(host,def){
  if(!host)return;
  const lk=(def&&def.look)||{};
  [...host.classList].forEach(c=>{if(/^opf-(c|r|z)-/.test(c))host.classList.remove(c)});
  const shape=LOOK_SHAPE_ALIAS[lk.shape]||lk.shape;
  const c=LOOK_COLOR[lk.color]||'',r=LOOK_SHAPE[shape]||'',z=LOOK_SIZE[lk.size]||'';
  if(c)host.classList.add('opf-c-'+c);
  if(r)host.classList.add('opf-r-'+r);
  if(z)host.classList.add('opf-z-'+z);
 }
 /* ---------- 並べ方（§9.226 ①、利用者の指示「同じUIでもいくつかパターンが
    あるとよい」） ----------
    **意匠（色・形・大きさ）の4つ目の軸ではない。** あちらは「どう見えるか」、
    こちらは「選択肢をどう並べるか」——器の幅（マス数）に対して何個ずつ置くか
    なので、選ばせ方の側に属する。混ぜると「青い2列のボタン群」のような
    掛け算の名前が要る（§9.223 ③で避けた形）。
    綴りはサーバー（`operation_repo.LAYOUTS`）が正で、ここは印をクラスへ
    写すだけ。**効かない入力方法ではサーバーが`自動`へ落として返す**ので、
    ここで判定を持たない（§9.163「判定を画面にも書かない」）。 */
 const LAYOUT_CLASS={'自動':'','横1行':'row','折り返し':'wrap','縦':'col',
                     '2列':'g2','3列':'g3'};
 function applyLayout(box,def){
  if(!box)return;
  [...box.classList].forEach(c=>{if(/^opf-l-/.test(c))box.classList.remove(c)});
  const k=LAYOUT_CLASS[String((def&&def.layout)||'自動')]||'';
  if(k)box.classList.add('opf-l-'+k);
 }
 const CHOICE_SHAPES={
  'ラジオ':    {box:'opf-radio',btn:'opf-radio-btn',dot:true},
  'セグメント':{box:'opf-seg',  btn:'opf-seg-btn'},
  'タブ':      {box:'opf-tabs', btn:'opf-tab-btn'},
  'ボタン群':  {box:'opf-chips',btn:'opf-chip-btn'},
  /* §9.223 ③で足した2つ。**選ぶ状況が違うもの**だけを足す（見た目の違いは
     意匠の軸が持つので、色違いを種類として増やさない）。
     カード … 説明を添えた大きな札。選ぶのに説明が要るとき
     トグル … 2択の入切。「有/無」のような対のとき（3つ以上では出さない） */
  'カード':    {box:'opf-cards',btn:'opf-card-btn',note:true},
  'トグル':    {box:'opf-toggle',btn:'opf-toggle-btn'},
 };

 /* 器を1回だけ作る。**選択肢が変わったら作り直す**（内径のプリセットは
    仕掛データが届いてから入る・§9.204）ので、署名で見分ける。 */
 function buildWidget(def,host,kind){
  /* **意匠は組み立ての前に当てる**（§9.223 ③）。色・形・大きさを変えても
     部品の署名（種類＋選択肢）は同じなので、下の`box.dataset.sig===sig`で
     早々に帰る道が通る——そこから当てていると、**意匠のボタンだけが
     押しても何も起きない**（設定窓の見本で実際にそうなっていた）。
     当て直しはクラスの付け替えだけなので、毎回通しても安い。 */
  applyLook(host,def);
  if(kind==='メモ'||kind==='1行'||kind==='定型文')return buildMemoWidget(def,host,kind);
  if(NUM_WIDGETS.indexOf(kind)>=0)return buildNumberWidget(def,host,kind);
  const sel=host.querySelector(':scope>select');
  if(!sel)return false;
  const free=!!def.freeText;
  const opts=optionsOf(sel);
  const shape=CHOICE_SHAPES[kind];
  const sig=kind+(free?'+free':'')+'/'+String(def.layout||'')
    +(def.noBlank?'/nb':'')
    +'|'+opts.map(o=>o.v+'\u0001'+o.t).join('\u0002');
  const box=widgetHost(host);
  if(box.dataset.sig===sig){syncWidget(host);return true}
  box.dataset.sig=sig;
  host.classList.add('opf-alt');
  /* **選ぶ器そのものを打てるようにする**（§9.226 ①）。以前は
     「プルダウンのときだけ`<select>`を残して、下に打ち込み欄を足す」形
     だったが、打つ場所と選ぶ場所が2つ並んで読めなかった。手打ちのときは
     `<select>`を器の裏へ回し、**見えるのは1つの箱（`.opf-combo`）だけ**に
     する（値の持ち主は今までどおり`<select>`）。 */
  const combo=(kind===WIDGET_SELECT&&free);
  const hideNative=kind!==WIDGET_SELECT||combo;
  sel.classList.toggle('opf-native-off',hideNative);
  if(hideNative)sel.setAttribute('tabindex','-1');else sel.removeAttribute('tabindex');
  if(kind===WIDGET_SELECT&&!free){
   /* 素のプルダウン。器は要らない（意匠だけ当てる）。 */
   box.className='opf-widget opf-plain';
   box.innerHTML='';
  }else if(combo){
   box.className='opf-widget opf-combo';
   box.innerHTML='<input type="text" class="opf-combo-in" autocomplete="off" role="combobox"'
    +' aria-expanded="false" aria-label="'+esc(def.name)+'（候補から選ぶか、そのまま打てます）"'
    +' placeholder="選ぶ／打つ">'
    +'<button type="button" class="opf-combo-open" aria-label="候補から選ぶ" title="候補から選ぶ">▾</button>';
   const inp=box.querySelector('.opf-combo-in');
   inp.addEventListener('input',()=>{
    const v=inp.value.trim();
    if(!v){setValue(sel,'');return}
    /* **候補と同じ文字を打ったら候補として扱う**——手打ちの席へ入れると、
       同じ値が候補と手打ちの2箇所に並ぶ。 */
    const hit=[...sel.options].find(o=>o.dataset.opFree!=='1'&&o.text===v);
    if(hit)setValue(sel,hit.value);else setFree(sel,v);
   });
   box.querySelector('.opf-combo-open').onclick=e=>{e.preventDefault();openPicker(def,host,sel)};
  }else if(kind==='一覧'){
   /* **`メニュー`と同じ顔にしないこと**（§9.247 ①）——両方とも「▾の付いた
      1行の欄」だと、名前が2つあって見た目が同じ（セグメントとトグルで
      指摘されたのと同じ形）になる。`一覧`が開くのは**画面のまん中の窓**
      なので、合図も「窓が開く」印（`⌸`）にし、器から仕切って置く。
      `メニュー`の▾は**その場に垂れる**という意味で、開くと反転する。 */
   box.className='opf-widget opf-pick';
   box.innerHTML='<button type="button" class="opf-pick-btn">'
    +'<span class="opf-pick-now">選ぶ</span>'
    +'<span class="opf-pick-caret" aria-hidden="true" title="押すと一覧の窓が開きます">☰</span></button>';
   box.querySelector('.opf-pick-btn').onclick=e=>{e.preventDefault();openPicker(def,host,sel)};
  }else if(kind==='パネル'){
   /* パネル（§9.248 ①、利用者の指示「フローティングモーダル…違うタイプの
      ものを増やしたい」）。**`一覧`とは見え方も探し方も違う**——あちらは
      1行ずつの表＋絞り込みで「名前で探す」形、こちらは**大きな札を並べた
      窓**で「見て選ぶ」形（指で押す端末・説明を読んで決めたいとき）。
      合図も分ける（`一覧`＝仕切った`☰`／こちら＝`▦`）。 */
   box.className='opf-widget opf-panel';
   box.innerHTML='<button type="button" class="opf-panel-btn">'
    +'<span class="opf-pick-now">選ぶ</span>'
    +'<span class="opf-panel-mark" aria-hidden="true" title="押すと大きな札の窓が開きます">▦</span></button>';
   box.querySelector('.opf-panel-btn').onclick=e=>{e.preventDefault();openPanel(def,host,sel)};
  }else if(kind==='メニュー'){
   /* メニュー（§9.247 ①、利用者の指示「フローティングメニューみたいなもの」）。
      **`一覧`とは開く場所が違う**——あちらは画面のまん中に開く大きな窓＋
      絞り込みで「数が多いとき」向き、こちらは**押した欄のすぐ横**に浮く
      軽いメニューで「数個を、目を動かさずに」選ぶとき向き。
      いまの値の見せ方は`一覧`と同じ`.opf-pick-now`を使う——`syncWidget()`が
      1箇所で面倒を見るので、形ごとに書き足さない。 */
   box.className='opf-widget opf-menu';
   box.innerHTML='<button type="button" class="opf-menu-btn" aria-haspopup="menu" aria-expanded="false">'
    +'<span class="opf-pick-now">選ぶ</span>'
    +'<span class="opf-menu-caret" aria-hidden="true">▾</span></button>';
   box.querySelector('.opf-menu-btn').onclick=e=>{
    e.preventDefault();openMenu(def,host,sel,e.currentTarget);
   };
  }else if(kind==='切替'){
   /* 切替（§9.247 ①、利用者の指示「クリックで選択肢が変化するタイプのUI」）。
      **押すたびに次の選択肢へ進み、最後まで行ったら先頭へ戻る。**
      札を並べる場所が無い狭いマスで2〜4個を切り替えるとき向き。
      **いま何番目か・次が何かを必ず文字で出す**（§2「推測させない」）——
      押した先が見えないと、目当ての値まで何回押すのか数えることになる。
      **候補の並びは器が控える**（`data-op-cycle`）——`syncWidget()`が
      「次」を言うのに要るが、`<select>`の全部の`<option>`とは違う
      （`（選ばない）`を出さない設定があるので・§9.246 ①）。 */
   const list=pickableOpts(opts,def);
   box.className='opf-widget opf-cycle';
   box.dataset.opCycle=JSON.stringify(list.map(o=>[o.v,(o.v===''||o.t==='-')?'—':o.t]));
   box.innerHTML='<button type="button" class="opf-cycle-btn"'
    +' aria-label="'+esc(def.name)+'（押すたびに次の選択肢へ変わります）">'
    +'<i class="opf-cycle-mark" aria-hidden="true">↻</i>'
    +'<span class="opf-cycle-now">—</span>'
    +'<span class="opf-cycle-meta"><i class="opf-cycle-pos"></i>'
    +'<i class="opf-cycle-next"></i></span></button>';
   const step=d=>{
    let arr=[];try{arr=JSON.parse(box.dataset.opCycle||'[]')}catch(_){}
    if(!arr.length)return;
    const at=arr.findIndex(o=>o[0]===String(sel.value==null?'':sel.value));
    /* まだ選んでいないとき（`at<0`）は**先頭から**。−で戻るときは末尾から。 */
    const nx=at<0?(d>0?0:arr.length-1):((at+d+arr.length)%arr.length);
    pickValue(sel,arr[nx][0]);syncWidget(host);
   };
   const btn=box.querySelector('.opf-cycle-btn');
   btn.onclick=e=>{e.preventDefault();step(1)};
   /* **戻れること**——行き過ぎたときに一周させるのは操作として重い。 */
   btn.onkeydown=e=>{
    if(e.key==='ArrowLeft'||e.key==='ArrowUp'){e.preventDefault();step(-1)}
    else if(e.key==='ArrowRight'||e.key==='ArrowDown'){e.preventDefault();step(1)}
   };
  }else if(kind==='入切'){
   /* 入切（§9.226 ①）。**入＝先頭の空でない値／切＝空**。3つ以上あっても
      使うのは先頭だけなので、そのことを文字で書く（§4）。 */
   const on=opts.find(o=>!isBlankOpt(o))||{v:'',t:''};
   const more=opts.filter(o=>!isBlankOpt(o)).length;
   box.className='opf-widget opf-switch';
   box.innerHTML='<button type="button" class="opf-switch-btn" role="switch" aria-checked="false"'
    +' data-op-on="'+esc(on.v)+'" data-op-on-label="'+esc(on.t||'入')+'" data-op-off-label="切">'
    +'<i class="opf-switch-track" aria-hidden="true"><i class="opf-switch-knob"></i></i>'
    +'<span class="opf-switch-text">切</span></button>'
    +(more>1?'<small class="opf-widget-note">選択肢が'+more+'件あります。入切では先頭の「'
      +esc(on.t||on.v)+'」だけを使います</small>':'');
   const sw=box.querySelector('.opf-switch-btn');
   sw.onclick=e=>{
    e.preventDefault();
    const nowOn=!!sel.value&&sel.value!=='-';
    pickValue(sel,nowOn?'':sw.dataset.opOn);
    syncWidget(host);
   };
  }else{
   const stage=kind==='段階';
   box.className='opf-widget '+(stage?'opf-stage':(shape?shape.box:'opf-seg'));
   box.setAttribute('role','radiogroup');
   box.setAttribute('aria-label',def.name);
   const btnCls=stage?'opf-stage-btn':(shape?shape.btn:'opf-seg-btn');
   const dot=(!stage&&shape&&shape.dot)?'<i class="opf-dot" aria-hidden="true"></i>':'';
   /* 段階は「選ばない」を並べない——順番の帯に空の段が混ざると、
      1段目が「選ばない」なのか最低の段なのか読めない。
      **`空欄なし`のときも並べない**（§9.228 ④、利用者の指示「非選択状態の
      表示が大きいのでそれをなしにしたり初期値設定したりできるようにしたい」）
      ——ラジオやトグルでは「—」の札が1枚ぶんの場所を取る。初期値と
      組み合わせれば、最初から1つ選ばれた状態で出せる。 */
   const list=stage?opts.filter(o=>!isBlankOpt(o)):pickableOpts(opts,def);
   box.innerHTML='<div class="opf-shape">'+list.map((o,i)=>{
    const label=(o.v===''||o.t==='-')?'—':o.t;
    const tip=noteOf(def,o.v);
    /* **カードは説明を文字で出す**（§9.223 ③）。`title`に隠すと、選ぶのに
       説明が要るから大きな札にした意味が無くなる（§3）。 */
    const note=(shape&&shape.note&&tip)?'<small class="opf-btn-note">'+esc(tip)+'</small>':'';
    const no=stage?'<i class="opf-stage-no" aria-hidden="true">'+(i+1)+'</i>':'';
    return '<button type="button" role="radio" aria-checked="false" tabindex="-1"'
     +' class="'+btnCls+'" data-opv="'+esc(o.v)+'"'+(tip&&!note?' title="'+esc(tip)+'"':'')
     +'>'+dot+no+'<span class="opf-btn-text">'+esc(label)+'</span>'+note+'</button>';
   }).join('')+(free?otherChipHtml(btnCls):'')+'</div>'
    +(stage?'<small class="opf-stage-scale"><b class="opf-stage-now">—</b> 段目</small>':'');
   /* **説明を1つも持たないカードは背の高い空箱**（§9.247 ①、利用者の指摘
      「カード…少し踏襲されていない感じを受けます」）。カードは「選ぶのに
      説明が要る」ための形なので、説明が無いときは高さを取らず、文字を
      真ん中へ置く——`:has()`に頼らず**印を付ける**（当たらなかったときに
      誰も気づけない・§9.218 ②）。 */
   if(shape&&shape.note)
    box.classList.toggle('is-plain',!list.some(o=>noteOf(def,o.v)));
   applyLayout(box,def);
   box.querySelectorAll('[data-opv]').forEach(b=>{
    b.onclick=e=>{e.preventDefault();pickValue(sel,b.dataset.opv);syncWidget(host)};
   });
   if(free)wireOther(box,sel,host);
   /* **左右キーで移れること**（ラジオグループの約束）。押せるのにキーボードで
      辿れない部品を作らない。**打ち込み欄の中では効かせない**——文字を
      打っているときに矢印でカーソルを動かせないのは壊れて見える。 */
   box.onkeydown=e=>{
    if(['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].indexOf(e.key)<0)return;
    if(e.target&&e.target.classList&&e.target.classList.contains('opf-other-in'))return;
    const btns=[...box.querySelectorAll('[data-opv]')];
    if(!btns.length)return;
    e.preventDefault();
    const i=Math.max(0,btns.findIndex(b=>b.classList.contains('is-on')));
    const d=(e.key==='ArrowRight'||e.key==='ArrowDown')?1:-1;
    const nx=btns[(i+d+btns.length)%btns.length];
    pickValue(sel,nx.dataset.opv);syncWidget(host);nx.focus();
   };
  }
  applyLook(host,def);                       /* §9.223 ③ 色・形・大きさ */
  /* selectの側が変わっても印を合わせる（プリセット・記録の復元）。 */
  if(!sel.dataset.opWidgetWired){
   sel.dataset.opWidgetWired='1';
   sel.addEventListener('change',()=>syncWidget(host));
  }
  syncWidget(host);
  return true;
 }
 /* 器を外す（マスタで「プルダウン」へ戻したとき）。**付いたまま置かない**
    ——外し忘れると、戻したはずの欄がボタンのまま残る（§9.210 ④と同じ罠）。 */
 function stripWidget(host){
  delete host.dataset.opSpin;               /* §9.248 ① 付いたまま置かない */
  const box=host.querySelector(':scope>.opf-widget');
  /* **開いているメニューは畳む**（§9.222 ①）——器を消したあとに浮いたまま
     残ると、どの欄のものか分からないメニューが画面に残る。 */
  if(box&&menuBack&&box.contains(menuBack))closeMenu();
  if(box&&panelBack&&box.contains(panelBack))closePanel();
  if(box)box.remove();
  host.classList.remove('opf-alt');
  /* **`<input>`の欄も元へ戻す**（§9.219 ③）。`select`だけを見ていると、
     「メモ」から戻したときに欄が1pxのまま残り**打てない欄**になる。 */
  const sel=valueEl(host);
  if(sel){sel.classList.remove('opf-native-off');sel.removeAttribute('tabindex')}
 }
 /* ---------- テンキーは欄の右の「▦」から浮く（§9.250 ⑧） ----------
    以前はここに**画面中央の大きな窓**（`.opf-keypad`）を持っていたが、
    入口が欄の下の「キーで入れる」という**1行ぶんのボタン**だったので、
    テンキーを選んだ欄だけが54px背が高くなっていた。入口は帯の中の
    印1つ（`.opf-num-open`）に、窓は`openNumPop()`の**1本**に寄せてある
    ——スライダー・早見ボタンと同じ窓なので、開き方・閉じ方・意匠の
    持ち出しを3通り持たずに済む（§9.164）。 */

 /* ---------- 浮くものへ欄の意匠を持ち出す（§9.247 ①、利用者の指摘） ----------
    「角丸デザインを細部まで踏襲してください。（カード、一覧、プルダウンなど
      少し踏襲されていない感じを受けます。）」

    浮き窓は`body`直下に置く（§9.201）ので、**欄が宣言した`--opf-*`が
    継承されない**——角丸も色も器の既定へ落ち、押した欄と別の見た目の窓が
    開いていた。開くときに**欄で解決済みの値を写す**（規則を窓の側へ
    書き写さない・§9.163）。 */
 const LOOK_VARS=['--opf-radius','--opf-hue','--opf-hue-dark','--opf-hue-pale',
                  '--opf-h','--opf-fs'];
 function carryLook(host,el){
  if(!host||!el)return;
  const cs=getComputedStyle(host);
  LOOK_VARS.forEach(k=>{
   const v=cs.getPropertyValue(k).trim();
   if(v)el.style.setProperty(k,v);else el.style.removeProperty(k);
  });
 }
 /* ---------- 欄のすぐ横に開くメニュー（§9.247 ①、利用者の指示） ----------
    「フローティングメニューみたいなもの」

    **`一覧`（`.opf-picker`）とは別の道具**——あちらは画面のまん中に開く
    大きな窓＋絞り込みで「選択肢が多いとき」向き。こちらは押した欄の
    すぐ下に浮く軽いメニューで、**目を動かさずに数個から選ぶ**とき向き。

    **`body`直下へ`position:fixed`**（§9.201）。`.selectors`は`overflow`を
    持つ器の中なので、中に置くと下半分が切れる。
    **画面の外へはみ出さない**——下に入らなければ上へ、右も器へ収める。 */
 let menuEl=null,menuBack=null,menuOff=null;
 function ensureMenu(){
  if(menuEl)return menuEl;
  menuEl=document.createElement('div');
  menuEl.className='opf-menu-pop';menuEl.id='opfMenu';menuEl.hidden=true;
  menuEl.setAttribute('role','menu');
  document.body.appendChild(menuEl);
  WL.modal.keepOpen(menuEl);
  /* **外を押したら閉じる**。`mousedown`で受ける——`click`だと、押した先の
     部品が先に動いてしまう。**開いた器は必ず控える**（§9.222 ①）ので、
     ここは`menuEl`を見て早々に帰れる。 */
  document.addEventListener('mousedown',e=>{
   if(!menuEl||menuEl.hidden)return;
   if(menuEl.contains(e.target))return;
   if(menuBack&&menuBack.contains&&menuBack.contains(e.target))return;
   closeMenu();
  },true);
  document.addEventListener('keydown',e=>{
   if(menuEl&&!menuEl.hidden&&WL.modal.escCloses(e)){e.stopPropagation();closeMenu()}
  },true);
  return menuEl;
 }
 function closeMenu(){
  if(!menuEl||menuEl.hidden)return;
  menuEl.hidden=true;
  if(menuOff){menuOff();menuOff=null}
  const back=menuBack;menuBack=null;
  if(back){
   back.setAttribute('aria-expanded','false');
   if(back.focus){try{back.focus()}catch(e){}}
  }
 }
 /* 押した欄へ寄せる。**開いてから測る**——中身の高さが分からないと、
    下に入るかどうかを決められない。 */
 function placeMenu(el,btn){
  const r=btn.getBoundingClientRect();
  el.style.minWidth=Math.round(r.width)+'px';
  el.style.left='0px';el.style.top='0px';        /* 測る前に前回の位置を外す */
  const m=el.getBoundingClientRect();
  const gap=4,pad=8;
  const below=window.innerHeight-r.bottom-gap;
  const up=m.height>below&&r.top-gap>below;      /* 下に入らず、上のほうが広い */
  const top=up?Math.max(pad,r.top-gap-m.height):Math.min(r.bottom+gap,window.innerHeight-pad-m.height);
  const left=Math.max(pad,Math.min(r.left,window.innerWidth-pad-m.width));
  el.style.left=Math.round(left)+'px';
  el.style.top=Math.round(Math.max(pad,top))+'px';
  el.dataset.at=up?'up':'down';
 }
 function openMenu(def,host,sel,btn){
  const el=ensureMenu();
  menuBack=btn;
  carryLook(host,el);
  el.hidden=false;
  btn.setAttribute('aria-expanded','true');
  const opts=pickableOpts(optionsOf(sel),def);
  const free=!!def.freeText;
  const draw=()=>{
   const v=String(sel.value==null?'':sel.value);
   el.innerHTML='<div class="opf-menu-list">'+(opts.length?opts.map(o=>{
    const label=(o.v===''||o.t==='-')?'（選ばない）':o.t;
    const note=noteOf(def,o.v);
    const on=o.v===v;
    return '<button type="button" role="menuitemradio" aria-checked="'+(on?'true':'false')+'"'
     +' class="opf-menu-item'+(on?' is-on':'')+'" data-opv="'+esc(o.v)+'">'
     +'<i class="opf-menu-tick" aria-hidden="true">'+(on?'✓':'')+'</i>'
     +'<span class="opf-menu-text"><b>'+esc(label)+'</b>'
     +(note?'<small>'+esc(note)+'</small>':'')+'</span></button>';
   }).join(''):'<p class="opf-menu-empty">選べる候補がありません。</p>')+'</div>'
    /* **手打ちの席は1つ**（§9.226 ①）——メニューの足元へ置き、
       打った時点で入る（別の入力欄を欄の下へ足さない）。 */
    +(free?'<div class="opf-menu-free"><input type="text" class="opf-menu-free-in"'
      +' autocomplete="off" placeholder="候補にない値を打つ" aria-label="候補にない値を打つ"></div>':'');
   el.querySelectorAll('[data-opv]').forEach(b=>{
    b.onclick=e=>{e.preventDefault();pickValue(sel,b.dataset.opv);syncWidget(host);closeMenu()};
   });
   const fi=el.querySelector('.opf-menu-free-in');
   if(fi){
    if(isFreeValue(sel,v))fi.value=v;
    /* **入力中に一覧を作り直さないこと**（§9.117）——1文字ごとに
       カーソルが飛ぶ。印だけを付け替える。 */
    fi.oninput=()=>{
     const t=fi.value.trim();
     if(t)setFree(sel,t);else setValue(sel,'');
     syncWidget(host);
     el.querySelectorAll('[data-opv]').forEach(b=>{
      const on=b.dataset.opv===String(sel.value||'');
      b.classList.toggle('is-on',on);b.setAttribute('aria-checked',on?'true':'false');
      const tk=b.querySelector('.opf-menu-tick');if(tk)tk.textContent=on?'✓':'';
     });
    };
   }
   /* **キーボードで辿れること**（押せるのに辿れない部品を作らない）。 */
   el.onkeydown=e=>{
    if(['ArrowDown','ArrowUp'].indexOf(e.key)<0)return;
    if(e.target&&e.target.classList&&e.target.classList.contains('opf-menu-free-in'))return;
    const items=[...el.querySelectorAll('[data-opv]')];
    if(!items.length)return;
    e.preventDefault();
    const i=items.indexOf(document.activeElement);
    const d=e.key==='ArrowDown'?1:-1;
    const nx=items[(Math.max(0,i)+d+items.length)%items.length];
    if(nx&&nx.focus)nx.focus();
   };
  };
  draw();
  placeMenu(el,btn);
  /* 窓の大きさが変わったら置き直す（開いたままスクロールしたら閉じる
     ——ずれた場所に浮いたメニューは、どの欄のものか分からなくなる）。 */
  const onScroll=()=>closeMenu();
  const onResize=()=>{if(menuEl&&!menuEl.hidden&&menuBack)placeMenu(menuEl,menuBack)};
  window.addEventListener('scroll',onScroll,true);
  window.addEventListener('resize',onResize);
  menuOff=()=>{window.removeEventListener('scroll',onScroll,true);
               window.removeEventListener('resize',onResize)};
  const first=el.querySelector('.opf-menu-item.is-on')||el.querySelector('.opf-menu-item');
  if(first&&first.focus){try{first.focus()}catch(e){}}
 }

 /* ---------- 大きな札を並べた窓（§9.248 ①、利用者の指示） ----------
    「フローティングモーダル…違うタイプのものを増やしたい」

    **`一覧`（`.opf-picker`）とは別の道具**——あちらは1行ずつの表＋絞り込みで
    「名前で探す」形。こちらは**札を並べて見て選ぶ**形で、指で押す端末や、
    説明を読んで決めたい選択肢に向く。並べ方（何列か）は`並べ方`の軸が持つ。
    **器の外（body直下）へ`position:fixed`**（§9.201）。角丸・色は開くときに
    欄から写す（`carryLook()`）。 */
 let panelEl=null,panelBack=null;
 function ensurePanelWin(){
  if(panelEl)return panelEl;
  panelEl=document.createElement('div');
  panelEl.className='opf-picker opf-panel-win';panelEl.id='opfPanel';panelEl.hidden=true;
  panelEl.innerHTML='<div class="opf-picker-box" role="dialog" aria-modal="true">'
   +'<header><b id="opfPanelName"></b>'
   +'<button type="button" id="opfPanelClose" aria-label="閉じる">×</button></header>'
   +'<div class="opf-panel-grid" id="opfPanelGrid"></div>'
   +'<div class="opf-panel-free" id="opfPanelFree" hidden>'
   +'<input type="text" class="opf-menu-free-in" id="opfPanelFreeIn" autocomplete="off"'
   +' placeholder="候補にない値を打つ" aria-label="候補にない値を打つ"></div></div>';
  document.body.appendChild(panelEl);
  WL.modal.keepOpen(panelEl);
  panelEl.querySelector('#opfPanelClose').onclick=closePanel;
  document.addEventListener('keydown',e=>{
   if(panelEl&&!panelEl.hidden&&WL.modal.escCloses(e)){e.stopPropagation();closePanel()}
  },true);
  return panelEl;
 }
 function closePanel(){
  if(!panelEl||panelEl.hidden)return;
  panelEl.hidden=true;
  const back=panelBack;panelBack=null;
  if(back&&back.focus){try{back.focus()}catch(e){}}
 }
 function openPanel(def,host,sel){
  const el=ensurePanelWin();
  carryLook(host,el);
  panelBack=host.querySelector('.opf-panel-btn');
  el.hidden=false;
  el.querySelector('#opfPanelName').textContent=def.name;
  /* 並べ方（§9.226 ①）は窓の中の札にも効く。 */
  const grid=el.querySelector('#opfPanelGrid');
  applyLayout(grid,def);
  const opts=pickableOpts(optionsOf(sel),def);
  const draw=()=>{
   const v=String(sel.value==null?'':sel.value);
   grid.innerHTML=opts.length?opts.map(o=>{
    const label=(o.v===''||o.t==='-')?'（選ばない）':o.t;
    const note=noteOf(def,o.v);
    return '<button type="button" class="opf-panel-item'+(o.v===v?' is-on':'')+'"'
     +' data-opv="'+esc(o.v)+'"><b>'+esc(label)+'</b>'
     +(note?'<small>'+esc(note)+'</small>':'')+'</button>';
   }).join(''):'<p class="opf-picker-empty">選べる候補がありません。</p>';
   grid.querySelectorAll('[data-opv]').forEach(b=>{
    b.onclick=e=>{e.preventDefault();pickValue(sel,b.dataset.opv);syncWidget(host);closePanel()};
   });
  };
  draw();
  /* 手打ちの席は**窓の足元に1つ**（§9.226 ①「打つ場所は1つ」）。 */
  const free=el.querySelector('#opfPanelFree'),fi=el.querySelector('#opfPanelFreeIn');
  free.hidden=!def.freeText;
  if(def.freeText&&fi){
   fi.value=isFreeValue(sel,sel.value)?String(sel.value||''):'';
   fi.oninput=()=>{
    const t=fi.value.trim();
    if(t)setFree(sel,t);else setValue(sel,'');
    syncWidget(host);draw();
   };
  }
  const first=grid.querySelector('.opf-panel-item.is-on')||grid.querySelector('.opf-panel-item');
  if(first&&first.focus){try{first.focus()}catch(e){}}
 }

 /* ---------- 説明つきで選ぶ浮き窓 ----------
    **器の外（body直下）へ`position:fixed`で出す**（§9.201）。`.selectors`は
    `overflow`を持つ器の中にあるので、中に置くと下半分が切れる。 */
 let pickerEl=null,pickerBack=null;
 function ensurePicker(){
  if(pickerEl)return pickerEl;
  pickerEl=document.createElement('div');
  pickerEl.className='opf-picker';pickerEl.id='opfPicker';pickerEl.hidden=true;
  pickerEl.innerHTML='<div class="opf-picker-box" role="dialog" aria-modal="true">'
   +'<header><b id="opfPickerName"></b>'
   +'<button type="button" id="opfPickerClose" aria-label="閉じる">×</button></header>'
   +'<input type="search" id="opfPickerFind" placeholder="絞り込む" autocomplete="off">'
   +'<div class="opf-picker-list" id="opfPickerList"></div></div>';
  document.body.appendChild(pickerEl);
  WL.modal.keepOpen(pickerEl);
  pickerEl.querySelector('#opfPickerClose').onclick=closePicker;
  document.addEventListener('keydown',e=>{
   if(WL.modal.escCloses(e)&&pickerEl&&!pickerEl.hidden){e.stopPropagation();closePicker()}
  },true);
  return pickerEl;
 }
 function closePicker(){
  if(!pickerEl)return;
  pickerEl.hidden=true;
  const back=pickerBack;pickerBack=null;
  if(back&&back.focus){try{back.focus()}catch(e){}}
 }
 function openPicker(def,host,sel){
  const el=ensurePicker();
  carryLook(host,el);                        /* §9.247 ① 欄と同じ角丸・色で開く */
  el.hidden=false;
  pickerBack=host.querySelector('.opf-pick-btn');
  el.querySelector('#opfPickerName').textContent=def.name;
  /* **できることを先に書く**（§CLAUDE 2）。手打ちできるかどうかは項目ごとに
     違うので、絞り込み欄の案内も切り替える。 */
  const fnd=el.querySelector('#opfPickerFind');
  if(fnd)fnd.placeholder=def.freeText?'絞り込む／候補にない値を打つ':'絞り込む';
  const find=el.querySelector('#opfPickerFind');
  const list=el.querySelector('#opfPickerList');
  /* **浮き窓も同じ絞り込みを通す**（§9.246 ①）——ここだけ`noBlank`を
     見ていなかったので、「一覧」「プルダウン＋手打ち」の▾から
     「（選ばない）」が選べたままだった。 */
  const opts=pickableOpts(optionsOf(sel),def);
  const free=!!def.freeText;
  const draw=()=>{
   const raw=String(find.value||'').trim();
   const q=raw.toLowerCase();
   const hit=opts.filter(o=>!q||(o.t+' '+noteOf(def,o.v)).toLowerCase().indexOf(q)>=0);
   /* **絞り込み欄がそのまま手打ちの欄**（§9.226 ①）。候補にない値のために
      別の入力欄を足さない——打つ場所は1つ、が全部の形での約束。
      **候補に同じ文字があるときは出さない**（同じ値を2箇所に並べない）。 */
   const same=opts.some(o=>o.t===raw||o.v===raw);
   const own=(free&&raw&&!same)
     ?'<button type="button" class="opf-picker-item opf-picker-free" data-opfree="'+esc(raw)+'">'
      +'<b>「'+esc(raw)+'」をこのまま使う</b><small>候補にない値として記録します</small></button>'
     :'';
   list.innerHTML=own+(hit.length?hit.map(o=>{
    const label=(o.v===''||o.t==='-')?'（選ばない）':o.t;
    const note=noteOf(def,o.v);
    return '<button type="button" class="opf-picker-item'+(o.v===sel.value?' is-on':'')+'"'
     +' data-opv="'+esc(o.v)+'"><b>'+esc(label)+'</b>'
     +(note?'<small>'+esc(note)+'</small>':'')+'</button>';
   }).join(''):(own?'':'<p class="opf-picker-empty">「'+esc(find.value)+'」に当たる選択肢はありません。'
     +(free?'':'この項目は候補からしか選べません。')+'</p>'));
   list.querySelectorAll('[data-opv]').forEach(b=>{
    b.onclick=()=>{pickValue(sel,b.dataset.opv);syncWidget(host);closePicker()};
   });
   const fb=list.querySelector('[data-opfree]');
   if(fb)fb.onclick=()=>{setFree(sel,fb.dataset.opfree);syncWidget(host);closePicker()};
  };
  /* **入力中に一覧だけを描き直す**（§9.117）——入力欄を作り替えるとカーソルが飛ぶ。 */
  find.value='';find.oninput=draw;
  draw();
  try{find.focus()}catch(e){}
 }

 /* ---------- 群にまとめる ---------- */
 function groupsFor(place){
  const out=[];
  defs.filter(d=>(d.place||PLACE_PREP)===place).forEach(d=>{
   const name=d.group||'その他';
   let g=out.find(x=>x.name===name);
   /* 群を畳むかは**行が持つ**（群そのものの表は作らない・マスタを増やさない）。
      **1つでも「畳む」と言っていれば畳む**——群の中で食い違ったときに
      「どちらが正か」を決められる形にしておく（マスタ管理の画面は群単位で
      書き換えるので、ふつうは食い違わない）。 */
   if(!g){g={name,items:[],fold:false,span:0,pad:true,showWhen:new Set()};out.push(g)}
   g.items.push(d);
   if(d.fold)g.fold=true;
   /* ダミー（空き）は**カード1枚の属性**（§9.228 ②、利用者の指示
      「ダミーのカードだけ追加したいがダミー群ごとしか追加できないのも
      修正してほしい」）。**群の見出しを消すのは「全部が空き」のときだけ**
      ——1枚でも中身があるなら、その群には見出しが要る。 */
   g.pad=(g.pad!==false)&&!!d.dummy;
   /* 群の幅（§9.226 ③）。**1つでも指定があればそれ**——畳むと同じ読み方に
      そろえる（群の中で食い違ったときにどちらが正かを決めておく）。 */
   if(!g.span&&Number(d.groupSpan)>0)g.span=Math.min(gridCols,Number(d.groupSpan));
   (d.showWhen||[]).forEach(x=>g.showWhen.add(String(x).trim()));
  });
  /* 中身が1枚も無い群は「全部が空き」ではない（初期値のtrueを落とす）。 */
  out.forEach(g=>{if(!g.items.length)g.pad=false;g.dummy=g.pad});
  return out;
 }

 /* ---------- 群を「列でも区切る」（§9.226 ③、利用者の指示） ----------
    「マスタでは現在1列複数行で、行の中で区切りを作っていますが、まとまりを
     作りやすくできるように列にも区切りをつけられるようにしたい」

    群に幅（マス）を持たせ、**横いっぱいでない群は横に並ぶ**ようにする。
    自動配置（`order`＋`span`）では群の見出しが必ず1行を切ってしまうので、
    幅を決めた群があるときだけ**マスを明示して置く**。

    **計算はここ1箇所**——マスタの盤（`master-maint.js`）も同じ関数を通す。
    2つ持つと「盤ではこう見えるのに測定画面では違う」が作れる（§9.176の
    `entryCellInfo()`と同じ約束）。

    引数は `[{name, span(0=横いっぱい), items:[{key, span}]}]`、
    戻りは `{heads,items,rows,banded}`（col/row は1始まり）。 */
 function packLayout(groups,cols){
  const n=Math.max(1,Number(cols)||12);
  const heads=[],items=[];
  let row=1,col=1,bottom=1;
  const newBand=()=>{row=bottom;col=1};
  (groups||[]).forEach(g=>{
   const gs=Math.max(1,Math.min(n,Number(g.span)>0?Number(g.span):n));
   if(col>1&&col+gs-1>n)newBand();
   /* 全部が空きの群は**見出しの行を取らない**（§9.228 ②）——見出しを
      描かないので、中身は見出しの位置から始める（1行ぶん余計に空かない）。 */
   heads.push({name:g.name,col,row,span:gs,dummy:!!g.dummy});
   let r=g.dummy?row:row+1,c=col;
   (g.items||[]).forEach(it=>{
    const w=Math.max(1,Math.min(gs,Number(it.span)||1));
    if(c>col&&c+w-1>col+gs-1){c=col;r++}
    items.push({key:it.key,col:c,row:r,span:w});
    c+=w;
   });
   bottom=Math.max(bottom,(g.items&&g.items.length)?r+1:row+1);
   col+=gs;
   if(col>n)newBand();
  });
  /* **横いっぱいの群しか無いときは今までどおり**（`order`で流す）。
     マスを明示すると、マスタに載っていない`.selectors`の子（作業時間など）が
     空いたマスへ自動で入り込みうる——健全な設定の見え方を変えない。 */
  const banded=(groups||[]).some(g=>Number(g.span)>0&&Number(g.span)<n);
  return {heads,items,rows:Math.max(1,bottom-1),banded};
 }
 /* 畳んだ群を自動で開く条件（§9.216 ③、利用者の指示「条入力時に展開され
    共通項目になります」）。**空なら畳んだまま**（条件の無い群を勝手に
    開かない）。 */
 function autoOpen(g){
  if(!g.showWhen.size)return false;
  const t=(typeof WL!=='undefined'&&WL.measureItem)
    ?WL.measureItem.normalize($('#measureType')?.value)
    :($('#measureType')?.value||'');
  return g.showWhen.has(String(t||'').trim());
 }
 /* **既定は「条件があるかどうか」で決まる。**
      条件つき（条の入力）… 畳んで待ち、当たったら開く（§9.216 ③）
      条件なし（いつもと同じ設定）… 開いておく（§9.133「入力させる項目は
        全部見せる」。畳むかどうかは触った人が決める）
    どちらも押せば手で開閉でき、触ったぶんだけ覚える。 */
 const defaultFolded=g=>g.showWhen.size>0;
 function isFolded(g){
  if(!g.fold)return false;
  if(autoOpen(g))return false;
  const p=foldPref.get(g.name);
  return p===undefined?defaultFolded(g):!!p;
 }

 /* 畳んだままでも値は読めること（§9.125）。見出しに現在値を並べる。 */
 function summaryOf(g){
  return g.items.map(d=>{
   const el=controlOf(d);if(!el)return '';
   const v=(el.selectedOptions&&el.selectedOptions[0]?el.selectedOptions[0].text:el.value)||'';
   return String(v).trim();
  }).filter(v=>v&&v!=='-').join('・');
 }

 /* 組み込みの欄の見出しをマスタの項目名に合わせる（§9.228 ①）。
    **先頭のテキスト節点だけ**を書き換える（`<label>`の中の入力欄を消さない）。
    テキスト節点が無い形（将来`<span>`で包んだ場合など）では何もしない
    ——見出しが2つになるより、元の名前のままのほうがまし。 */
 function renameBuiltinLabel(el,name){
  const t=String(name||'').trim();
  if(!t)return;
  /* **名前は`<span class="opf-name">`が持つ**（§9.233 ⑤）。自由項目は
     `fieldEl()`が最初からそう作っており、組み込みの欄だけが素のテキスト
     節点だった——添え書き（`.prep-from`）を「名前の横」へ置く場所が無く、
     単位を欄の中へ重ねるときの段の指定（`[data-opunit="内部"]>.opf-name`）も
     当たらない。**包むのは1度だけ**（`innerHTML`ごと書き換えると中の
     `<select>`が作り直されてフォーカスが落ちる・§9.122）。 */
  let span=el.querySelector(':scope>.opf-name');
  if(!span){
   span=document.createElement('span');
   span.className='opf-name';
   const first=[...el.childNodes].find(n=>n.nodeType===3&&n.nodeValue.trim());
   if(first)el.replaceChild(span,first);
   else el.insertBefore(span,el.firstChild);
  }
  /* 書き換えるのは**先頭のテキスト節点だけ**——中には添え書きが入りうる
     ので、`textContent`ごと差し替えると消える。 */
  const t0=[...span.childNodes].find(n=>n.nodeType===3);
  if(t0){if(t0.nodeValue!==t)t0.nodeValue=t}
  else span.insertBefore(document.createTextNode(t),span.firstChild);
 }
 /* その定義に対応する入力欄。組み込みは画面が持っているものを引き当てる。 */
 function controlOf(def){
  if(def.builtin)return document.getElementById(def.builtin);
  return document.querySelector(`[data-op="${CSS.escape(def.name)}"]`);
 }
 /* 器は置き場で変わる（§9.232。母材の欄は`.material-grid`に居る）。
    **`.selectors`だけを見る形に戻さないこと**——見つからない欄は
    `layout()`が「無い」として数え、黙って1つ欠ける。 */
 function hostOf(def){
  const sel=def.builtin
    ? `[data-f="${CSS.escape(def.builtin)}"]`
    : `[data-opfield="${CSS.escape(def.name)}"]`;
  for(const place of PLACE_ORDER){
   const box=boxFor(place);
   const el=box&&box.querySelector(':scope>'+sel);
   if(el)return el;
  }
  return null;
 }

 /* ---------- 割り付け ----------
    `.selectors`は**6列のグリッド**（§9.135「細かくするのはカードの内側だけ」）。
    見出しは`1/-1`で1行を占め、項目は`span N`で流れる。位置を1つずつ明示
    しないのは、マスタで並べ替えるたびに行番号を計算し直すことになるため
    ——**見出しが行を切る**ので、自動配置でも群の境目と行の境目はずれない。 */
 function layout(){
  /* 器は置き場ごと（§9.232）。`.selectors`が無い画面では何もしない
     ——母材の器だけが在ることは無い（同じ測定画面の中）。 */
  const boxes=[...new Set(PLACE_ORDER.map(boxFor).filter(Boolean))];
  if(!boxes.length)return;
  wireChoiceUsage();                       /* §9.248 ⑤ 1度だけ配線する */
  /* 前回の割り付けを外してから始める（§9.210 ④と同じ約束——付いたまま
     測る・置くと、1回変えた形が二度と戻らない）。 */
  boxes.forEach(bx=>{
   bx.querySelectorAll('[data-opgen]').forEach(el=>el.remove());
   bx.querySelectorAll('[data-f]').forEach(el=>{
    /* `opf-host`＝**マスタが差配している欄**の印（§9.233 ③）。器の名前
       （`.selectors`／`.material-grid`／設定窓の見本）ごとにCSSを書き分けると、
       器を1つ足すたびに書き足すことになり、足し忘れた器だけが静かに壊れる。 */
    el.classList.remove('op-off','op-folded','op-required','opf-host');
    el.style.order='';el.style.gridColumn='';el.style.gridRow='';
    delete el.dataset.opplace;delete el.dataset.opgroup;delete el.dataset.opfill;
    delete el.dataset.opout;delete el.dataset.opauto;
   });
   bx.style.setProperty('--op-cols',String(gridCols));
  });
  /* **マスタが名指ししている組み込みの欄だけを差配する。** 作業時間・
     丈位置・入力内容はマスタに載せていない（②で使う道具・③で記録する
     もの）ので、今までどおりCSSの見せ分けに任せる。 */
  const off=new Set(builtinOff||[]);
  off.forEach(key=>{
   /* **器をまたいで探す**（§9.232）——`.selectors`だけを見ると、外した
      母材の欄が測定画面に出たままになる。 */
   const el=hostOf({builtin:key});
   if(el)el.classList.add('op-off');
  });
  let seq=0,missing=[];
  PLACE_ORDER.forEach(place=>{
   const box=boxFor(place);
   if(!box)return;
   const gs=groupsFor(place);
   /* 群を「列でも区切る」（§9.226 ③）。**幅を決めた群があるときだけ**
      マスを明示する（`banded`）——無いときは今までどおり`order`で流す。 */
   const pack=packLayout(gs.map(g=>({name:g.name,span:g.span,dummy:g.dummy,
     items:g.items.map(d=>({key:d.name,span:Number(d.span)||4}))})),gridCols);
   const headAt=new Map(pack.heads.map(h=>[h.name,h]));
   const cellAt=new Map(pack.items.map(x=>[x.key,x]));
   gs.forEach(g=>{
    const fold=isFolded(g);
    const spot=pack.banded?headAt.get(g.name):null;
    /* ---------- 空き（ダミー）（§9.228 ②、利用者の指示） ----------
       「ダミーのカードだけ追加したいがダミー群ごとしか追加できないのも
        修正してほしい」——空きは**カード1枚**。群の見出しを消すのは
       **その群が全部空きのとき**だけで、ふつうの群の中に空きを1枚だけ
       混ぜることもできる。空きは**見出しも枠も地も文字も持たない**。 */
    if(!g.pad){
    const head=document.createElement(g.fold?'button':'b');
    head.className='prep-head'+(g.fold?' prep-fold':'');
    head.dataset.opgen='1';head.dataset.opgroup=g.name;head.dataset.opplace=place;
    head.style.order=String(seq++);
    if(spot){head.style.gridColumn=spot.col+'/span '+spot.span;head.style.gridRow=String(spot.row)}
    else head.style.gridColumn='1/-1';
    /* **先頭の見出しには上の線を引かない。** 並びは`order`で決まるので
       `:first-of-type`では当たらない（DOMの順ではない）。ここで印を付ける。 */
    if(!box.querySelector(`[data-opgen][data-opplace="${place}"][data-opfirst]`))
     head.dataset.opfirst='1';
    if(g.fold){
     head.type='button';
     head.setAttribute('aria-expanded',fold?'false':'true');
     head.title=fold?`「${g.name}」を開きます`:`「${g.name}」を畳みます`;
     head.innerHTML=`<span class="prep-fold-name">${esc(g.name)}</span>`
      +`<span class="prep-sum">${esc(fold?summaryOf(g):'')}</span>`
      +`<span class="prep-chev" aria-hidden="true"></span>`;
     head.addEventListener('click',()=>{
      foldPref.set(g.name,!isFolded(g));
      rememberFold();layout();
     });
    }else{
     head.textContent=g.name;
    }
    box.appendChild(head);
    }
    g.items.forEach(d=>{
     /* 空きのカード（§9.228 ②）。**入力欄は1つも作らない**——作ると
        空白ではなくなる。マスだけを押さえる。 */
     if(d.dummy){
      const pad=document.createElement('div');
      pad.className='prep-pad';
      pad.dataset.opgen='1';pad.dataset.opgroup=g.name;pad.dataset.opplace=place;
      pad.dataset.oppad='1';
      pad.setAttribute('aria-hidden','true');
      pad.style.order=String(seq++);
      const at0=pack.banded?cellAt.get(d.name):null;
      if(at0){pad.style.gridColumn=at0.col+'/span '+at0.span;pad.style.gridRow=String(at0.row)}
      else pad.style.gridColumn='span '+Math.max(1,Math.min(gridCols,Number(d.span)||4));
      box.appendChild(pad);
      return;
     }
     let el=hostOf(d);
     if(!el&&!d.builtin){el=fieldEl(d,seq);box.appendChild(el)}
     if(!el){missing.push(d.name);return}
     el.dataset.opplace=place;el.dataset.opgroup=g.name;
     el.classList.add('opf-host');
     /* **組み込みの欄も名前はマスタが決める**（§9.228 ①、利用者の指摘
        「マスタで関連の項目を名前変更しても…どこかでハードコーディングが
        残っていて名前変更が効かない」）。組み込みの欄は`index.html`が
        持っている`<label data-f="coilStop">コイル止め<select…>`をそのまま
        置いているだけで、**見出しの文字はHTMLに焼き付いたまま**だった
        ——自由項目は`fieldEl()`が`d.name`から作るので効いていた、という
        分かりにくい食い違い。コイル止めだけでなく**組み込みの欄すべて**。
        **書き換えるのは先頭のテキスト節点だけ**——`<label>`の中には
        `<select>`や`<small class="prep-from">`が入っているので、
        `textContent`ごと差し替えると入力欄が消える。 */
     if(d.builtin)renameBuiltinLabel(el,d.name);
     /* **器いっぱいに使う**（§9.218 ②、利用者の指摘「項目間の余白が広く、
        かなり表示欄がもったいない」「2列分にしたときに1列と比べると余白が
        出てスカスカな印象。余白は無いようにUI幅で稼いでほしい」）。
        以前は§9.130で測った「中身なりの幅」をそのまま使っており、
        6マス中2マス（413px）の器に154pxの選択欄が入って**259pxが空いて
        いた**（実測）。**幅を決めるのはマスタが選んだマス数**という形に
        揃えるので、狭くしたい欄はマス数を減らす——1つの事実で決まる。
        `fitControlWidths()`はこの印の付いた欄を測らない（測ると
        `max-width`が入って器より狭いまま残る）。 */
     el.dataset.opfill='1';
     /* **前に測った`max-width`を落とす。** `fitControlWidths()`は
        `data-opfill`が付く前にも走る（測定を開いた直後の1回）ので、
        インラインの`max-width`が残ったままだとCSSに勝ち、器の中で
        154pxのまま余白が残る（実測。実際にそうなった）。 */
     el.querySelectorAll('select,input,textarea').forEach(c=>{c.style.maxWidth=''});
     el.style.order=String(seq++);
     const at=pack.banded?cellAt.get(d.name):null;
     if(at){el.style.gridColumn=at.col+'/span '+at.span;el.style.gridRow=String(at.row)}
     else{el.style.gridColumn='span '+Math.max(1,Math.min(gridCols,Number(d.span)||4));
          el.style.gridRow=''}
     el.classList.toggle('op-folded',fold);
     el.classList.toggle('op-required',!!d.required);
     /* 見せ方（§9.221 ⑦）は**組み込みの欄にも当たる**——器の属性を書くだけで、
        値を持つ`<select>`/`<input>`そのものには触らない。 */
     applyPresentation(el,d);
     /* 選ばせ方（§9.218 ②）。**組み込みの欄にも当たる**——値を持つのは
        今までどおり`<select>`なので、当てても壊れるものが無い。 */
     const kind=widgetOf(d);
     /* **`<select>`だけの話ではない**（§9.219 ③）。数値・自由記述の欄は
        `<input>`なので、値を持つ要素が在れば器を被せる。 */
     /* **プルダウンでも手打ちが要る**（§9.220 ③）——形はそのままで
        「打つ場所」だけを足すので、器を被せる判断は2つの事実の和になる。 */
     const needsBox=kind!==WIDGET_SELECT||(d.freeText&&el.querySelector(':scope>select'));
     if(needsBox&&valueEl(el))buildWidget(d,el,kind);
     else stripWidget(el);
     /* ---------- 自動で入る値の見せ方（§9.233 ①、利用者の指示） ----------
        「自動で入る値についても、選んで設定できるようにしてください」
        値を入れるのは画面（前工程の実績・計算の結果）なので**器は被せない**
        ——被せると押せる部品になり、押しても何も起きない（§4）。
        選べるのは「どう見えるか」だけなので、印を器へ置いてCSSが読む。 */
     if(outputEl(el)&&kind!==WIDGET_SELECT)el.dataset.opout=kind;
     else delete el.dataset.opout;
     /* **単位は器を被せたあとに置く**（§9.233 ④）——先に置くと、器が
        後から末尾へ足されて「外下」の単位が器の上に出る。 */
     placeUnit(el,d);
     /* **意匠は器を被せない欄にも当たる**（§9.223 ③）。素のプルダウンでも
        「主色・丸・大」を選べないと、選ばせ方を変えないと見た目を変えられない
        ことになる（2つの軸にした意味が無い）。 */
     applyLook(el,d);
    });
   });
  });
  /* **無いものは無いと書く**（§4）。組み込みキーの綴りが変わった・画面から
     消えた欄をマスタが名指ししていると、黙って1つ欠けるだけになる。 */
  /* ---------- 仕掛由来の添え書き（§9.233 ⑤） ----------
     置き場（欄の下／名前の横／出さない）はマスタの1列なので、割り付けの
     あとに当て直す——マスタを直しても画面が変わらないと「効いていない」
     としか見えない。**当てるのは持ち主（`measurement-view.js`）**で、
     ここは合図を送るだけ（出どころを知っているのはあちらだけ）。 */
  if(window.WL&&WL.innerDiameter&&WL.innerDiameter.refresh)WL.innerDiameter.refresh();
  const note=document.getElementById('opDataNote');
  if(note){
   const msgs=[];
   if(!defs.length){
    msgs.push(defsFor===null?'操業データの項目を読み込んでいます…'
     :'この設備の操業データの項目は登録されていません（マスタ管理 &gt; 操業データ項目）。');
   }
   if(missing.length)msgs.push(`画面に無い項目を${missing.length}件飛ばしました: ${esc(missing.slice(0,4).join('、'))}`);
   note.innerHTML=msgs.join('<br>');
   note.hidden=!msgs.length;
  }
  bind();
  bindMeasureType();
  apply();
  foldSig=currentFoldSig();
  /* **入れ物の大きさは中身から決める**（§9.130／§9.131）。作り替えた直後に
     測り直さないと、自由項目はCSSの受け皿(`--w-md`)のままで並び、
     `alignColumnWidths()`が同じ列の1〜2桁の欄まで引き上げる。
     **名前空間付きで呼ぶこと**——素の`fitControlWidths`は`measure-steps.js`の
     IIFEの中なので、外からは見えない。 */
  syncWidgets();
  if(window.WL&&WL.measureSteps&&WL.measureSteps.fitWidths)WL.measureSteps.fitWidths();
  /* 1マスの実寸は**①準備のカード**で測る（§9.226 ①）。設定窓の見本は
     あの器の中の見え方を写すので、母材の器（`.material-grid`）で測ると
     縮尺が違う。 */
  rememberCellPx(boxFor(PLACE_PREP));
  /* ---------- 進捗の分母はマスタが届いてから塗り直す（§9.234 ⑧） ----------
     母材の進捗（`0/9`）の分母は`motherKeys()`＋丈の数で、**マスタが読めて
     いないあいだは8欄の受け皿へ落ちる**（`measure-progress.js`の
     `MOTHER_FIELDS_FALLBACK`）。ところが`#measureTypeChips`を書くのは
     `refreshMeasureProgress()`ただ1つで、その入口は**すべて「入力があった
     とき」**。測定を開く経路（`measurement-view.js`の
     `WL.opData.refresh().catch(...)`）は**投げっぱなし**なので、届いたあとに
     塗り直す人が居なかった——結果、マスタで母材の欄を外しても
     **打ち始めるまで分母が古いまま**で、外した欄が「どう頑張っても埋まらない
     1件」として見えていた（§9.227 ③と同じ罠を別の経路で作っていた）。

     **`apply()`の尾ではなく`layout()`のいちばん最後**に置くこと。
     `apply()`は`layout()`の途中（この上）で呼ばれるので、そこへ置くと
     ①ここが投げた瞬間に`foldSig`／`syncWidgets()`／`fitWidths()`／
     `rememberCellPx()`が丸ごと飛び、しかも`.catch(()=>{})`に飲まれて**黙る**
     （`foldSig`が古いままなので、以降`syncAutoOpen()`が毎回組み直しては
     また投げる——1回の失敗が居座る）②`refreshMeasureProgress()`は
     `#measureType`へ`visually-hidden-control`を付けるので、**幅を測る前に
     欄を1×1へ畳んでしまう**（`fitWidths()`／`rememberCellPx()`が別のDOMを
     測る）。ここは`layout()`の最後で、後ろに守るものが無い。
     **それでも`try`で包む**——`measure-progress.js`の`updateValidationVisuals`
     が同じ理由で包んでいるのと同じ作法（投げても呼び出し側を道連れにしない）。
     **`typeof`の「あれば使う」で黙らせないこと**（§CLAUDE「公開漏れは黙って
     素通しになる」）——無ければ進捗が古いまま残るので、理由を出す。 */
  if(typeof refreshMeasureProgress==='function'){
   try{refreshMeasureProgress()}
   catch(e){console.warn('measure-opdata: 進捗を塗り直せませんでした',e)}
  }else console.error('measure-opdata: refreshMeasureProgress が無い（母材の進捗の分母が古いまま残る）');
  /* ③「記録した値」も**マスタが届いてから塗り直す**（§9.242 ④。§9.234 ⑧と
     まったく同じ理由）——中身はマスタの行から組み立てるので、③を開いたまま
     マスタが届いた場合に塗り直さないと**空のまま**になる。
     **「あれば呼ぶ」で黙らせないこと**——無ければ理由を出す。 */
  if(typeof renderRecordedValues==='function'){
   try{renderRecordedValues()}
   catch(e){console.warn('measure-opdata: 記録した値を塗り直せませんでした',e)}
  }else console.error('measure-opdata: renderRecordedValues が無い（③の記録した値が空のまま残る）');
 }
 /* ---------- 1マスの実寸を覚える（§9.226 ①） ----------
    マスタの設定窓は「測定画面での見え方」を見せるが、**そこには測定画面が
    無い**ので1マスが何pxなのかを知りようがない。定数で持つと、画面の作りを
    変えたときに設定窓だけが古い縮尺で描き続ける（縮尺が違うと、文字の幅は
    縮まないので**入るはずのものが見切れて見える**）。
    ここで実測してこの端末に覚えさせ、設定窓はそれを使う。**取れなければ
    書かない**——古い値のほうが「何も無い」より当たる。 */
 const CELL_KEY='MeasureOpCellPxV1';
 function rememberCellPx(box){
  if(!box)return;
  try{
   const t=getComputedStyle(box).gridTemplateColumns.split(/\s+/).filter(Boolean);
   if(t.length!==gridCols)return;
   const w=parseFloat(t[0]);
   if(!Number.isFinite(w)||w<8)return;
   localStorage.setItem(CELL_KEY,String(Math.round(w*10)/10));
  }catch(e){}
 }
 function cellPx(){
  try{
   const v=Number(localStorage.getItem(CELL_KEY));
   if(Number.isFinite(v)&&v>=8&&v<=400)return v;
  }catch(e){}
  return 94;                                 /* 実測の既定（1920幅・12マス） */
 }

 function bind(){
  defs.forEach(def=>{
   if(def.builtin)return;                 // 組み込みの欄は元の配線のまま
   /* 自動で入る値（§9.234 ②）は`<output>`＝打ち込めない欄。整形の配線を
      足しても働く場面が無いので、印だけ増やさない。 */
   if(def.autoValue)return;
   const el=document.querySelector(`[data-op="${CSS.escape(def.name)}"]`);
   if(!el||el.dataset.opWired)return;
   el.dataset.opWired='1';
   const note=el.closest('.opf')&&el.closest('.opf').querySelector('.opf-note');
   if(el.tagName==='SELECT'){
    el.addEventListener('change',()=>remember(def.name,el.value));
   }else{
    attachFormat(el,()=>settle(el,def,note));
    el.addEventListener('input',()=>{sanitize(el,def);remember(def.name,rawText(el,el.value))});
   }
  });
 }

 /* 記録されている値を欄へ戻す。**選択肢に無い値も残す**（§9.203と同じ罠）
    ——`select.value`へ無い値を入れると空文字になり、記録が黙って消える。 */
 function apply(){
  const bag=(state()&&S.measure&&S.measure.settings&&S.measure.settings.opData)||{};
  document.querySelectorAll('[data-op]').forEach(el=>{
   const k=el.dataset.op,v=String(bag[k]==null?'':bag[k]);
   if(el.tagName==='SELECT'&&v&&![...el.options].some(o=>o.value===v)){
    const o=document.createElement('option');
    o.value=v;o.textContent=v+'（選択肢に無い記録）';el.appendChild(o);
   }
   putValue(el,v);
  });
  applyInitials();
  syncWidgets();
  /* 自動で入る値は**引き直す**（§9.234 ②）——記録にある値を戻すだけだと、
     条数や実働時間のように作業のあいだに変わる値が古いまま残る。 */
  paintAuto();
 }
 /* ---------- 初期値（§9.220 ②、利用者の指示） ----------
    「入力の方法によらず、初期値登録機能の実装をお願いします」

    決めごと:
     ・**まだ記録が無い欄にだけ入れる**。`settings.opData`に鍵があれば
       —— 空文字であっても —— 触らない。空にしたのは利用者の判断で、
       開き直すたびに初期値へ戻るのでは「消せない欄」になる。
     ・**入れたら記録にも書く**（§9.208 ②「打った時点でレコードへ入れる」）。
       画面にだけ出して記録に入れないと、保存せずに閉じた人と保存した人で
       中身が変わる。
     ・**選択肢に無い初期値も入れる**（候補を後から消した場合。`addOption`
       で足してから入れる——足さずに代入すると黙って空になる）。
     ・**組み込みの欄にも入れる**（§9.229 ③、利用者の指示「汎用設計にして
       いるつもりなので」）。ただし置き場が違う——組み込みの値は
       `settings.opData`ではなく`settings.<キー>`なので、**画面へ入れるだけ**
       にして控えへは書かない（保存は`measurement-view.js`の`collect()`が
       `#<キー>`から拾う）。入れるのは**まだ何も選ばれていないとき**だけで、
       選ばれていない印は選択欄が使う`''`と`'-'`の2つ（§4のとおり、既定の
       選択肢が入っている欄には入らないことを設定画面に書く）。
       内径の仕掛由来プリセット（§9.204）は`settings.innerDiameter`を見て
       いて、こちらは控えを書かないので**仕掛の値が勝つ**——順番が決まって
       いるので、どちらが勝つか決められないということは無い。 */
 const BLANK_VALUES=['','-'];
 function applyInitials(){
  const bag=store();
  defs.forEach(d=>{
   const init=String(d.initial==null?'':d.initial);
   /* 自動で入る値には初期値を当てない（§9.234 ②）——値を入れるのは画面で、
      直後の`paintAuto()`が必ず上書きする。当てると1瞬だけ別の値が出る。 */
   if(!init||d.dummy||d.autoValue)return;
   if(d.builtin){
    const el=controlOf(d);
    if(!el)return;
    if(BLANK_VALUES.indexOf(String(el.value||'').trim())<0)return;
    if(el.tagName==='SELECT')addOption(el,init);
    putValue(el,init);
    return;
   }
   if(bag&&Object.prototype.hasOwnProperty.call(bag,d.name))return;
   const el=controlOf(d);
   if(!el)return;
   if(String(el.value||'')!=='')return;
   if(el.tagName==='SELECT')addOption(el,init);
   putValue(el,init);
   /* **`remember()`は使わない**——あちらは`markDirty()`まで呼ぶので、
      記録を開いただけで「未保存の変更あり」になる。初期値は利用者が
      打ったものではないので、開いた瞬間に編集を名乗らせない。
      保存のときは`collect()`が画面から拾い直すので取りこぼさない。 */
   if(bag)bag[d.name]=init;
  });
 }
 /* **`.value`への代入では`change`が飛ばない**（DOMも変わらない）ので、
    記録の復元・仕掛由来のプリセット（§9.204の内径）のあとは、こちらから
    印を合わせに行く。忘れると**値は入っているのにボタンがどれも選ばれて
    いない**という、いちばん分かりにくい形で壊れる。 */
 function syncWidgets(){
  /* **候補を入れ直すと「選ばない」の札が戻る**（§9.246 ①）。
     `applyContextChoices()`（`records-store.js`）は`optionFill()`で
     `<select>`の中身を丸ごと作り直すので、そのたびに`-`が先頭へ復活する。
     印（`data-op-noblank`）はホスト側に残っているので、ここで当て直す
     ——**この関数は候補を入れ直した直後に必ず呼ばれる**（記録の復元・
     プリセット・マスタの取り直しが全部ここを通る）。 */
  document.querySelectorAll('[data-op-noblank="1"]').forEach(applyBlankPolicy);
  document.querySelectorAll('.selectors>.opf-alt').forEach(syncWidget);
 }

 /* 保存のときにまとめて回収する。**打った時点でも入れている**ので、
    ここは念のための取りこぼし防止。 */
 function collect(){
  const bag=store();if(!bag)return {};
  const v=values();
  Object.keys(bag).forEach(k=>{if(!(k in v))delete bag[k]});
  Object.keys(v).forEach(k=>{bag[k]=v[k]});
  return bag;
 }

/* ---------- ③「記録した値」はマスタが決める（§9.242 ④、利用者の指示） ----------
    「メイン測定画面の3枚目の『記録した値』のカードについては汎用設計に
     したいです。操業データ項目で配置した内容の中から選んで表示できるように
     マスタ化してください」

    以前は`measurement-view.js`の`RECORD_GROUPS`に**項目名を直に4群ぶん
    書き並べて**おり、群の名前も並びも現場では変えられなかった（母材だけ
    画面のラベルから拾うという別の道も持っていた）。いまは
    **操業データ項目マスタの1行＝カードの1行**で、群・並び・呼び名・単位も
    そのまま使う。出す／出さないは`[記録表示]`（既定は出す）。

    **値は画面から読む**（`settings.opData`ではない）——`collect()`が書くのは
    保存のときだけなので、そこだけを見ると①で選んだ値が「—」のまま出る
    （§9.206で一度踏んだ罠）。
    **選択肢は選んだ札の文字で出す**——値と表示が違う選択肢があるので、
    `select.value`だけを見ると生の鍵が並ぶ。 */
 function shownValue(el){
  if(!el)return '';
  if(el.tagName==='SELECT'){
   const o=el.selectedOptions&&el.selectedOptions[0];
   return String((o?o.textContent:el.value)??'').trim();
  }
  return String(el.value??'').trim();
 }
 /* カードの中の群と並び（§9.243）。**空＝この項目の群／表示順に従う**
    ——専用の盤（マスタ管理＞記録した値の配置）で動かした項目だけが
    切り離される。触っていない項目は測定画面の並びに追随し続ける。 */
 const recordGroupOf=d=>String(d.recordGroup||'').trim()||String(d.group||'').trim()||'その他';
 function recordRows(){
  const out=[];
  defs.forEach(d=>{
   /* 空きの行は入力欄を一度も描かない（§9.227 ③）。 */
   if(d.dummy)return;
   if(d.recordShow===false)return;
   const el=controlOf(d);
   if(!el)return;                       /* 画面に無い欄は出しようがない */
   /* **この設備で出していない欄は数えない**——`op-off`が付いた欄は
      マスタで下ろしたもので、記録も残らない。**畳んだ群は出す**
      （畳んでいても値は入っているので、確認の面では読めたほうがよい）。 */
   const host=hostOf(d);
   /* **画面に出ていない欄は出さない**——`op-off`はマスタで下ろしたもの、
      `hidden`は条件が揃わないときに画面が伏せているもの（計算全長など）。
      **畳んだ群は出す**（畳んでいても値は入っているので、確認の面では
      読めたほうがよい）。 */
   if(host&&(host.classList.contains('op-off')||host.hidden))return;
   out.push({group:recordGroupOf(d),
             name:d.name,unit:String(d.unit||'').trim(),
             /* 並びは**盤で決めた順が先**（§9.243）。決めていない項目は
                この項目の`[表示順]`のまま——`defs`は既に表示順で並んでいる
                ので、決めた項目だけを`recordOrder`で前後させる。 */
             order:(Number.isFinite(Number(d.recordOrder))&&Number(d.recordOrder)>0)
               ?Number(d.recordOrder):null,
             /* 自動で入る値は**そう書く**（§6。人が入れた値と見分けが付く）。 */
             auto:!!(d.autoValue||d.autoFill),
             value:shownValue(el)});
  });
  /* **決めた順の項目だけを並べ直す**（決めていない項目の前後関係は動かさない）
     ——`item_layout_save`と同じ「席の入れ替え」の考え方。 */
  const seats=out.map((x,i)=>i).filter(i=>out[i].order!=null);
  if(seats.length>1){
   const moved=seats.map(i=>out[i]).sort((a,b)=>a.order-b.order);
   seats.forEach((seat,k)=>{out[seat]=moved[k]});
  }
  return out;
 }

 /* 記録した件数（③確認の「記録した値」に出す）。自由項目だけを数える
    ——組み込みの欄はそれぞれ元からの置き場で数えられている（§8）。 */
 function filled(){
  /* **空き（ダミー）の群の行は数えない**（§9.227 ③）。あの行は場所を
     取るためだけに在り、入力欄を一度も描かない——数に入れると
     「記録した値 3/9」の分母だけが増え、**どう頑張っても埋まらない1件**が
     残る（画面には出ていないので探しようがない）。 */
  /* **自動で入る値は数えない**（§9.234 ②）——人が入れる欄ではないので、
     分母に入れると「記録した値」に**どう頑張っても埋まらない件**が増える
     （§9.227 ③の空きと同じ罠）。 */
  const free=defs.filter(d=>!d.builtin&&!d.dummy&&!d.autoValue);
  const v=values();
  return {filled:free.filter(d=>v[d.name]!=null&&v[d.name]!=='').length,total:free.length};
 }

 /* **必須はマスタが決める**（§9.216 ②、利用者の指示「一部の必須入力事項も
    マスタで設定可能とし」）。以前は`activeRequiredControls()`が
    `['operator','inspector']`と直に書いており、設備ごとに変えられなかった。
    **答えられないときはnull**——読めなかったことを「必須は無い」と同じに
    扱うと、完了前の確認が黙って緩くなる（§9.211 ②のfail-openと逆向きの
    判断。ここは「元の2つ」へ戻すのが安全）。 */
 function requiredControls(){
  if(!defs.length)return null;
  const out=[];
  defs.forEach(d=>{
   if(!d.required||d.dummy)return;      /* 空きの群の行は数えない（§9.227 ③） */
   /* 自動で入る値は「未入力」と言われても直しようがない（§9.234 ②）。 */
   if(d.autoValue)return;
   /* 畳んでいる群の中の欄は数えない——押しても行けない場所を「未入力」と
      言われても直しようがない。自動で開く群（条の入力）は開いていれば数える。 */
   const host=hostOf(d);
   if(host&&(host.classList.contains('op-off')||host.classList.contains('op-folded')))return;
   const el=controlOf(d);
   if(el)out.push({el,label:d.name});
  });
  return out;
 }

 /* 条件つきの群は`#measureType`で開閉が変わる（§9.216 ③）。
    **形が変わったときだけ描き直す**——毎回作り直すと、打っている最中に
    入力欄が入れ替わる（§9.122の「測定中はDOMを作り直さない」と同じ考え方。
    受信欄そのものは`.selectors`の外なので転送は止まらないが、
    自由項目に打っている最中に消えるのは同じくらい困る）。 */
 let foldSig='';
 function currentFoldSig(){
  return PLACE_ORDER
   .map(pl=>groupsFor(pl).map(g=>g.name+(isFolded(g)?':1':':0')).join(','))
   .join('|');
 }
 function syncAutoOpen(){
  if(!defs.length)return;
  if(currentFoldSig()===foldSig)return;
  layout();
 }
 function bindMeasureType(){
  const el=$('#measureType');
  if(!el||el.dataset.opFoldWired)return;
  el.dataset.opFoldWired='1';
  el.addEventListener('change',syncAutoOpen);
 }

 /* ---------- 選ばれた回数を数える（§9.248 ⑤、利用者の指示） ----------
    「マスタ側に使用回数を、使用回数の多いものほど上に来るようにすれば、
     非常に使いやすくなるはずです。」

    **投げっぱなしで呼ぶ**——数え損ねても測定は続く（並びが1回ぶん古くなる
    だけ）。値が入るのを待たせない。
    **手で打った値は数えない**——サーバーの`choice_used_bump()`が選択肢に
    無い値では何もしないので、打ち間違いでマスタが膨れることは無い。
    **同じ値を続けて選んでも1回ずつ数える**（選び直しは選び直し）が、
    **器を組み直すたびに飛ぶ`change`は数えない**——記録の復元・仕掛由来の
    プリセット・`syncWidgets()`の当て直しで回数が増えると、「よく使う順」が
    実際の使用と食い違う。見分けは**本物のイベント（素のプルダウン）か、
    `pickValue()`の印が立っている（器を被せた形）か**の2つ。
    **片方だけを見ないこと**——`isTrusted`だけだと、⑤がいちばん効かせたい
    「新しい表示領域を開くタイプ」（一覧・メニュー・パネル）が合成イベント
    なので1回も数えられない。 */
 let usedWired=false;
 function wireChoiceUsage(){
  if(usedWired)return;
  usedWired=true;
  document.addEventListener('change',e=>{
   const el=e.target;
   if(!el||el.tagName!=='SELECT')return;
   const host=el.closest('.opf-host');
   const name=host&&host.dataset.opChoice;
   /* **数えてよいのは「人が選んだ」ときだけ**。見分けは3つで、どれか1つでも
      当たれば数える:
       ・`isTrusted` ＝ 本物のイベント（実機で素のプルダウンを操作した）
       ・`userPicking` ＝ 器の札を押した（`pickValue()`が立てる印。器を被せた
         形は`setValue()`の合成イベントなので`isTrusted`は偽）
       ・器を被せていない ＝ 押す札が無いので、飛んできた`change`は人しかいない
         （**画面側の書き戻しは`change`を飛ばさない**——記録の復元は
         `putValue()`、内径のプリセットは`el.value=`のまま。`measurement-view.js`
         にも「`el.value=`ではchangeが飛ばない」と書いてある）
      **1つだけを見ないこと**——`isTrusted`だけだと⑤がいちばん効かせたい
      「新しい表示領域を開くタイプ」が1回も数えられず、全部数えると
      `syncWidgets()`の当て直しで前回の値が先頭へ固定される。
      **「器を被せたか」は`displayEl()`と同じ見分けを使う**（§9.233 ③）
      ——素のプルダウンにも**空の器**（`.opf-widget.opf-plain`）が付くので、
      `.opf-widget`が在るかだけを見ると素のプルダウンまで器扱いになり、
      **人が選んでも1回も数えない**（実際にそうなった）。 */
   if(!e.isTrusted&&!userPicking
      &&host&&host.querySelector(':scope>.opf-widget:not(.opf-plain)'))return;
   const value=String(el.value||'');
   if(!name||!value||value==='-')return;
   try{
    api('/api/operation-choice-master/used',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name,value})}).catch(()=>{});
   }catch(_){}
  },true);
 }
 async function refresh(equipment){
  await load(equipment);
  layout();
 }

 window.WL=window.WL||{};
 /* マスタ管理の設定窓が**同じ部品**で見本を出すための口（§9.218 ①）。
    見本を別に作ると、設定画面で見えた形と実際の形が食い違う
    （§9.176の`entryCellInfo()`と同じ約束）。 */
 function previewWidget(def,host,kind){
  try{return buildWidget(def,host,kind)}catch(e){console.warn('見本を作れませんでした',e);return false}
 }
 /* 母材の欄のうち**いま測定画面に出ているもの**（§9.232）。進捗の分母は
    これで数える——外した欄まで数えると「どう頑張っても埋まらない1件」が
    残る（§9.227 ③と同じ罠）。**読めないうちは`null`**を返し、呼ぶ側が
    今までどおりの8欄へ倒す（黙って0件にすると進捗が消える）。 */
 /* 仕掛由来の添え書きの置き場（§9.233 ⑤、利用者の指示「こういった自動の
    連携内容の補助的な説明文字のONOFFができるように、もっとコンパクトに
    かつ位置も選べるようにしてほしい」）。**読めないうちは既定**を返す
    ——空を返すと、マスタが届く前の1瞬だけ添え書きが消える。 */
 function sourceNotePlace(builtinKey){
  const d=defs.find(x=>x.builtin===builtinKey);
  return (d&&d.sourceNote)||'欄の下';
 }
 function motherKeys(){
  if(!defs.length)return null;
  const off=new Set(builtinOff||[]);
  const out=[];
  defs.forEach(d=>{
   if((d.place||PLACE_PREP)!==PLACE_MOTHER||!d.builtin)return;
   if(off.has(d.builtin)||d.enabled===false)return;
   /* **記録の鍵は欄そのものが持つ**（`data-mother`）。参考値の欄は
      `<output>`で鍵を持たないので、ここで自然に落ちる——族の名前で
      振り分けると、判定が2箇所になる。 */
   const el=document.getElementById(d.builtin);
   const k=el&&el.dataset&&el.dataset.mother;
   if(k)out.push(k);
  });
  return out.length?out:null;
 }
 WL.opData={load,layout,render:layout,refresh,apply,collect,values,filled,requiredControls,
            motherKeys,
            /* ③「記録した値」の中身（§9.242 ④）。**答えるのはマスタを
               読んでいるここ**——呼ぶ側（`measurement-view.js`）に項目名の
               写しを持たせない。 */
            recordRows,
            /* 自動で入る値を引き直す口（§9.234 ②）。**呼ぶのは値が変わる
               ところ**——作業時間の打刻・条の設計の変更・入力内容の切り替え。
               引き直さないと、条数や実働時間が古いまま紙に出る。
               `autoKnown()`は設定画面が「この版で引けるか」を書くのに使う。 */
            paintAuto,autoKnown,autoValueOf,
            /* 自動で入る値の添え書きの置き場（§9.233 ⑤）。**答えるのは
               マスタを読んでいるここ**——出どころを持っている側
               （`measurement-view.js`）に置き場の判定まで書かせると、
               項目が増えるたびに同じ判定が増える。 */
            sourceNotePlace,
            syncAutoOpen,syncWidgets,previewWidget,ruleText,
            /* 見せ方を当てる口（§9.221 ⑦）。**当てるのはこの1本**——設定窓の
               見本も測定画面もここを通るので、形が食い違わない。 */
            /* 意匠（§9.223 ③）もこの口が当てる——**選ばせ方が「プルダウン」の
               ままだと`previewWidget()`を通らない**ので、部品の側だけで
               当てていると素の欄に色・形・大きさが効かない。 */
            presentation:(host,def)=>{applyPresentation(host,def);applyLook(host,def);
              placeUnit(host,def)},
            /* 値の整形を見本の欄にも当てる口（§9.221 ⑦）。**整え方も
               同じ`settle()`を通す**——見本だけ桁そろえが効かないと、
               「3桁区切り」を選んでも設定画面では素の数字のままになる。 */
            attachFormat,
            settlePreview:(el,def)=>settle(el,Object.assign({},def,{preview:true}),null),
            defs:()=>defs.slice(),
            /* 群を列でも区切る割り付け（§9.226 ③）。**マスタの盤も同じ
               関数を通す**——2つ持つと盤と測定画面で並びが食い違う。 */
            packLayout,
            /* 測定画面の1マスの実寸（§9.226 ①）。設定窓の見本が**実物と
               同じ大きさ**で描くために使う。 */
            cellPx,
            /* 設備が変わったら次に開くとき読み直す（マスタ管理で足した直後）。 */
            forget:()=>{defs=[];builtinOff=[];defsFor=null;loading=null}};
})();
