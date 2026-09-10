/* lot-copy.js: 選んだ予定のロット番号を、決めた区切りでつないでコピーする（§9.368）
   ============================================================
   利用者の指示:「スケジュールモードでの作業スケジュール一覧の右クリック
   メニューに『ICASコピー』という機能を実装してください。これは選択中の
   すべてのロットの『ロット番号』を区切り文字である半角スペースを使って
   区切って連結させた形にしてコピーさせるものです。これの設定もその
   コピーボタンのポップオーバーメニューとして入れ子で追加しておきたいです。
   設定はルール複数を作れるようにする。区切り文字を選ぶことができる、
   区切り文字の数を決められる、入れる頻度を決められる。といった具合で
   複数組み合わせて対応できるようにしたうえで設定の部分は専用モーダルで
   対応し、どのような文字列になるか視覚的に見えるようにサンプルを表示させて」

   ------------------------------------------------------------
   決めたこと

   ① **つなぎ方は「決まり（区切り）の並び」で持つ。**
      1つの決まりは `N件ごとに・この文字を・何個` の3つだけ。これを何本でも
      重ねられるので、「ふだんは半角スペース、10件ごとに改行」のような
      組み合わせが**足し算で**書ける。文字ごとに専用の設定を作らない
      （増やすたびに画面と保存の形が増える）。

   ② **同じ位置に2つ以上あたったら、間隔の大きいほうが勝つ。**
      「1件ごとに半角スペース」と「10件ごとに改行」を重ねたとき、10件目の
      うしろは**改行だけ**になる（スペース＋改行にはしない）。足し合わせる
      作りにすると、見えない空白が行末に付いて回る——貼り付け先で困るのは
      いつもそれ。**勝ち負けは見本で見える**ので、覚えなくてよい（§2）。

   ③ **見本は上の帯に固定で出す**（§9.288 と同じ作り）。設定を触るたびに
      「こうコピーされる」が同じ場所で変わる。**区切りは見えるようにする**
      ——半角スペースも改行もタブも、そのままでは画面で見分けられない
      （記号は`␣`/`⏎`/`→`。表示だけで、コピーされるのは本物の文字）。

   ④ **保存は端末に持つ**（`localStorage`）。貼り付け先（ICAS）は端末ごとの
      都合なので、`scLayout`（この端末の見え方）と同じ置き場にする。

   ⑤ **「既定」という触れない行を作らない**（§9.367で踏んだ罠）。最初の1回だけ
      2本の例を書き込み、あとは**どれも同じように直せる・消せる**。

   外へ出すのは `WL.lotCopy` の5つだけ。
   ============================================================ */
(function(){
 const KEY='scLotCopyRulesV1';
 const PICK_KEY='scLotCopyRuleV1';     // 最後に使ったルール（次もこれで貼る）
 const MAX_RULES=20, MAX_SEPS=6, MAX_COUNT=20, MAX_EVERY=999;

 /* 区切り文字の顔ぶれ。**現場に16進や制御文字を打たせない**（§9.223 と
    同じ判断）。`mark`は画面で見せるための記号で、コピーされるのは`ch`。 */
 const SEP_KINDS=[
  {kind:'space',  label:'半角スペース', ch:' ',  mark:'␣'},
  {kind:'wide',   label:'全角スペース', ch:'　', mark:'▫'},
  {kind:'comma',  label:'カンマ',       ch:',',  mark:''},
  {kind:'tab',    label:'タブ',         ch:'\t', mark:'→'},
  {kind:'nl',     label:'改行',         ch:'\n', mark:'⏎'},
  {kind:'semi',   label:'セミコロン',   ch:';',  mark:''},
  {kind:'pipe',   label:'縦棒',         ch:'|',  mark:''},
  {kind:'slash',  label:'スラッシュ',   ch:'/',  mark:''},
  {kind:'hyphen', label:'ハイフン',     ch:'-',  mark:''},
  {kind:'none',   label:'区切らない',   ch:'',   mark:''},
  {kind:'custom', label:'その他（自分で書く）', ch:'', mark:''},
 ];
 const kindOf=k=>SEP_KINDS.find(x=>x.kind===k)||SEP_KINDS[0];

 /* 最初の1回だけ書き込む例。**触れない既定ではない**——名前も中身も変えられ、
    消せる（消したら「ルールがありません」と書く・§4）。 */
 function seed(){
  return [
   {id:'r'+Date.now(),name:'ICAS（半角スペース）',
    seps:[{kind:'space',text:'',count:1,every:1}]},
   {id:'r'+(Date.now()+1),name:'半角スペース＋10件ごとに改行',
    seps:[{kind:'space',text:'',count:1,every:1},{kind:'nl',text:'',count:1,every:10}]},
  ];
 }
 const clampInt=(v,lo,hi)=>{
  const n=Math.round(Number(v));
  return Number.isFinite(n)?Math.min(hi,Math.max(lo,n)):lo;
 };
 function normSep(s){
  s=s&&typeof s==='object'?s:{};
  const kind=SEP_KINDS.some(x=>x.kind===s.kind)?s.kind:'space';
  return {kind,text:String(s.text||'').slice(0,20),
          count:clampInt(s.count,1,MAX_COUNT),every:clampInt(s.every,1,MAX_EVERY)};
 }
 function normRule(r,i){
  r=r&&typeof r==='object'?r:{};
  const seps=(Array.isArray(r.seps)?r.seps:[]).slice(0,MAX_SEPS).map(normSep);
  return {id:String(r.id||('r'+i+'_'+Date.now())),
          name:String(r.name||'').slice(0,40)||`ルール${i+1}`,
          seps:seps.length?seps:[normSep({})]};
 }
 let cache=null;
 function rules(){
  if(cache)return cache;
  let raw=null;
  try{raw=JSON.parse(localStorage.getItem(KEY)||'null')}
  catch(e){WL.quiet.note('保存された値を読めない（既定で続ける）',e);raw=null}
  cache=Array.isArray(raw)&&raw.length?raw.map(normRule):seed();
  return cache;
 }
 function save(){
  try{localStorage.setItem(KEY,JSON.stringify(cache||[]))}
  catch(e){WL.quiet.note('保存できなくてもコピー自体は効く',e)}
 }
 function currentId(){
  let id='';
  try{id=String(localStorage.getItem(PICK_KEY)||'')}
  catch(e){WL.quiet.note('保存された値を読めない（先頭のルールで続ける）',e)}
  const list=rules();
  return (list.some(r=>r.id===id)?id:(list[0]||{}).id)||'';
 }
 function setCurrentId(id){
  try{localStorage.setItem(PICK_KEY,String(id||''))}
  catch(e){WL.quiet.note('保存できなくても今回のコピーは効く',e)}
 }
 function currentRule(){
  const list=rules();
  return list.find(r=>r.id===currentId())||list[0]||null;
 }

 /* ---------- つなぎ方（②） ----------
    `i`件目までを並べたあとの区切り。**あたる決まりのうち間隔の大きいほうが
    勝つ**（同じ間隔なら並びの後ろが勝つ）。1つもあたらなければ区切らない。 */
 function sepAt(rule,i){
  let win=null;
  (rule&&rule.seps||[]).forEach(s=>{
   if(i%s.every!==0)return;
   if(!win||s.every>=win.every)win=s;
  });
  return win;
 }
 function sepChars(s){
  if(!s)return '';
  const k=kindOf(s.kind);
  const ch=k.kind==='custom'?String(s.text||''):k.ch;
  return ch.repeat(s.count);
 }
 /* コピーする文字列そのもの。**ここが唯一の組み立て**——見本も本番も通す
    （見本と刷り上がりが食い違わないための1箇所・§9.163）。 */
 function joinLots(lots,rule){
  const list=(lots||[]).map(v=>String(v??'').trim()).filter(Boolean);
  return list.map((lot,i)=>(i?sepChars(sepAt(rule,i)):'')+lot).join('');
 }

 /* ---------- 見本（③） ----------
    区切りを**見えるように**したときだけ記号を添える。記号は画面のためだけで、
    コピーされる文字は`joinLots()`が答えたものそのまま。 */
 function sampleHtml(lots,rule,showMarks){
  const list=(lots||[]).map(v=>String(v??'').trim()).filter(Boolean);
  if(!list.length)return '<span class="icc-empty">つなぐロット番号がありません</span>';
  return list.map((lot,i)=>{
   const head=i?sepPieceHtml(sepAt(rule,i),showMarks):'';
   return head+`<span class="icc-lot">${esc(lot)}</span>`;
  }).join('');
 }
 function sepPieceHtml(s,showMarks){
  const raw=sepChars(s);
  if(!raw)return '<i class="icc-sep is-none" title="ここは区切りません"></i>';
  const k=kindOf(s.kind);
  const mark=showMarks?(k.mark||raw):raw;
  const shown=showMarks?mark.repeat(s.count).slice(0,60):raw;
  const br=k.kind==='nl'?'<br>'.repeat(s.count):'';
  return `<i class="icc-sep" title="${esc(k.label)}×${s.count}（${s.every}件ごと）">`
   +`${esc(shown)}</i>${br}`;
 }

 /* ---------- コピー ----------
    `navigator.clipboard`が使えない場面（古い版・許可されていない）でも
    黙って何もしないことにしない（§4）——隠し欄からの複写へ落とす。 */
 async function writeClipboard(text){
  try{
   if(navigator.clipboard&&navigator.clipboard.writeText){
    await navigator.clipboard.writeText(text);return true;
   }
  }catch(e){WL.quiet.note('クリップボードAPIが使えない（隠し欄から複写する）',e)}
  try{
   const ta=document.createElement('textarea');
   ta.value=text;ta.setAttribute('readonly','');
   ta.style.position='fixed';ta.style.left='-2000px';ta.style.top='0';
   document.body.append(ta);ta.select();
   const ok=document.execCommand('copy');
   ta.remove();
   return ok;
  }catch(e){WL.quiet.note('複写もできない（理由を出す）',e);return false}
 }
 /* 外から呼ぶ入口。`lots`は「選択中のロット番号」の並び。 */
 async function copyLots(lots,rule){
  const use=rule||currentRule();
  const list=(lots||[]).map(v=>String(v??'').trim()).filter(Boolean);
  if(!list.length){
   showToast&&showToast('コピーできません','ロット番号のある予定が選ばれていません',4000);
   return false;
  }
  if(!use){
   showToast&&showToast('コピーできません','つなぎ方のルールが1つもありません（設定から追加できます）',5000);
   return false;
  }
  const text=joinLots(list,use);
  const ok=await writeClipboard(text);
  if(ok)showToast&&showToast(`${list.length}件のロット番号をコピーしました`,
    `${use.name}／${list.slice(0,3).join('・')}${list.length>3?`　ほか${list.length-3}件`:''}`,3600);
  else showToast&&showToast('コピーできませんでした',
    'ブラウザがクリップボードへの書き込みを許可していません',6000);
  return ok;
 }

 /* ---------- 入れ子のメニュー（ポップオーバー） ----------
    親（「ICASコピー」）を押すと**いま選んでいるルールでコピー**、
    横に開く子で**ルールを選ぶ／設定を開く**。押しても何も起きない親を
    作らない（§4）。 */
 function menuItems(lots){
  const list=rules();
  const cur=currentId();
  const items=list.map(r=>({
   label:(r.id===cur?'● ':'○ ')+r.name,
   note:previewLine(lots,r),
   run:()=>{setCurrentId(r.id);copyLots(lots,r)},
  }));
  if(!list.length)items.push({label:'ルールがありません',disabled:true,
    note:'「コピーの設定…」から作れます'});
  items.push({sep:true});
  items.push({label:'コピーの設定…',note:'区切り文字・数・入れる頻度を決めます',
              run:()=>openSettings(lots)});
  return items;
 }
 /* メニューに添える1行の見本。**長いと読めない**ので頭だけ。 */
 function previewLine(lots,rule){
  const list=(lots||[]).map(v=>String(v??'').trim()).filter(Boolean);
  const src=list.length?list.slice(0,4):['A0001','A0002','A0003','A0004'];
  const shown=joinLots(src,rule).replace(/\t/g,'→').replace(/\n/g,'⏎').replace(/ /g,'␣').replace(/　/g,'▫');
  return shown.slice(0,48)+(shown.length>48?'…':'');
 }

 /* ---------- 設定モーダル ----------
    作りは「①どのルールを使うか → ②そのルールの区切り」の2列＋**上の帯に
    見本**（§9.288）。**触ったらその場で保存**（§9.113）——保存ボタンを
    持たない。閉じるボタンは1つ。 */
 let ui=null;    // {lots,ruleId,marks,count}
 function openSettings(lots){
  const list=rules();
  ui={lots:(lots||[]).map(v=>String(v??'').trim()).filter(Boolean),
      ruleId:currentId()||((list[0]||{}).id||''),
      marks:true,count:12,deleting:''};
  const asked=confirmModal({eyebrow:'ICAS COPY',title:'ICASコピーの設定',
   hideCancel:true,confirmLabel:'閉じる',
   bodyHtml:'<div class="icc-modal" id="iccModal"></div>'});
  render();
  return asked;
 }
 /* 見本に使うロット番号。**選んでいるものが正**——実際に貼るものが見えて
    いれば、頭の中で置き換えずに済む（§2「思い出させない」）。足りない
    ぶんは見本の番号で埋め、埋めたことを字で言う。 */
 function sampleLots(){
  const real=(ui&&ui.lots)||[];
  const n=(ui&&ui.count)||12;
  const out=real.slice(0,n);
  for(let i=out.length;i<n;i++)out.push('A'+String(1001+i).padStart(4,'0'));
  return out;
 }
 function sampleNote(){
  const real=((ui&&ui.lots)||[]).length,n=(ui&&ui.count)||12;
  if(!real)return `見本のロット番号${n}件（予定を選んでから開くと、選んだロットで見えます）`;
  if(real>=n)return `選んでいる${real}件のうち先頭${n}件`;
  return `選んでいる${real}件＋見本${n-real}件`;
}
 function ruleNow(){return rules().find(r=>r.id===(ui&&ui.ruleId))||null}

 function render(){
  const box=document.getElementById('iccModal');
  if(!box)return;
  const list=rules(),rule=ruleNow();
  box.innerHTML=sampleSectionHtml(rule)+`<div class="icc-cols">`
   +ruleListHtml(list)+sepListHtml(rule)+`</div>`;
  wire(box);
 }
 function sampleSectionHtml(rule){
  return `<section class="icc-sample">
   <div class="icc-sample-head">
    <b>こうコピーされます</b>
    <small class="icc-sample-src">${esc(sampleNote())}</small>
    <span class="icc-spacer"></span>
    <label class="icc-check"><input type="checkbox" id="iccMarks"${ui.marks?' checked':''}>
     <span>区切りを見えるようにする</span></label>
    <span class="icc-count">見本の件数
     <span class="mm-num" data-num-wrap>
      <button type="button" class="mm-num-btn" data-icc-count="-1" aria-label="見本の件数を減らす">−</button>
      <input class="mm-num-input icc-count-input" id="iccCount" type="text" inputmode="numeric"
             autocomplete="off" value="${esc(String(ui.count))}">
      <button type="button" class="mm-num-btn" data-icc-count="1" aria-label="見本の件数を増やす">＋</button>
     </span></span>
   </div>
   <output class="icc-sample-out${ui.marks?' is-marked':''}" id="iccSample">${
     rule?sampleHtml(sampleLots(),rule,ui.marks)
        :'<span class="icc-empty">ルールを選んでください</span>'}</output>
  </section>`;
 }
 /* 名前は**その場で書き換える**（§9.342の窓は1枚しかないので、設定の窓の
    上に入力の窓を重ねられない——重ねると設定の中身が消える）。消すのも
    同じ理由で**行の中の2手**にする（押し間違いは1手では起きない・§5）。 */
 function ruleListHtml(list){
  const rows=list.map(r=>{
   const on=r.id===ui.ruleId;
   if(ui.deleting===r.id)return `<li class="icc-rule is-deleting" data-rule="${esc(r.id)}">
     <span class="icc-rule-ask">「${esc(r.name)}」を消しますか？</span>
     <span class="icc-rule-tools">
      <button type="button" class="icc-mini is-danger" data-delyes="${esc(r.id)}">消す</button>
      <button type="button" class="icc-mini" data-delno="1">やめる</button>
     </span></li>`;
   return `<li class="icc-rule${on?' is-on':''}" data-rule="${esc(r.id)}">
    <button type="button" class="icc-rule-pick" data-pick="${esc(r.id)}"
      title="${on?'このルールでコピーします':'このルールに切り替えます'}">
     <span class="icc-rule-mark" aria-hidden="true">${on?'●':'○'}</span></button>
    <span class="icc-rule-body">
     <input type="text" class="icc-rule-name" maxlength="40" data-name="${esc(r.id)}"
            value="${esc(r.name)}" autocomplete="off" spellcheck="false"
            aria-label="ルールの名前">
     <small class="icc-rule-preview">${esc(previewLine(ui.lots,r))}</small></span>
    <span class="icc-rule-tools">
     <button type="button" class="icc-mini" data-dup="${esc(r.id)}" title="この内容で1本増やします">複製</button>
     <button type="button" class="icc-mini is-danger" data-del="${esc(r.id)}" title="このルールを消します">削除</button>
    </span></li>`;
  }).join('');
  return `<section class="icc-panel icc-panel-rules">
   <h3><span class="icc-no">1</span>どのルールでつなぐか</h3>
   <ul class="icc-rule-list">${rows||'<li class="icc-empty-row">ルールがありません。「＋ ルールを追加」から作れます。</li>'}</ul>
   <button type="button" class="icc-add" id="iccAddRule"${list.length>=MAX_RULES?' disabled title="これ以上は増やせません"':''}>＋ ルールを追加</button>
  </section>`;
 }
 function sepListHtml(rule){
  if(!rule)return `<section class="icc-panel icc-panel-seps">
   <h3><span class="icc-no">2</span>区切りの決まり</h3>
   <p class="icc-help">左でルールを選ぶと、ここに区切りの決まりが出ます。</p></section>`;
  const rows=rule.seps.map((s,i)=>{
   const k=kindOf(s.kind);
   return `<li class="icc-sep-row" data-i="${i}">
    <span class="icc-sep-no">${i+1}</span>
    <label class="icc-field"><span>間隔</span>
     <span class="mm-num" data-num-wrap>
      <button type="button" class="mm-num-btn" data-sep-step="-1" data-f="every" data-i="${i}" aria-label="間隔を減らす">−</button>
      <input class="mm-num-input icc-w-num" type="text" inputmode="numeric" autocomplete="off"
             data-f="every" data-i="${i}" value="${esc(String(s.every))}">
      <button type="button" class="mm-num-btn" data-sep-step="1" data-f="every" data-i="${i}" aria-label="間隔を増やす">＋</button>
     </span><em>件ごとに</em></label>
    <label class="icc-field"><span>区切り文字</span>
     <select class="icc-w-sel" data-f="kind" data-i="${i}">
      ${SEP_KINDS.map(x=>`<option value="${x.kind}"${x.kind===s.kind?' selected':''}>${esc(x.label)}</option>`).join('')}
     </select></label>
    <label class="icc-field icc-field-free"${k.kind==='custom'?'':' hidden'}><span>その文字</span>
     <input type="text" class="icc-w-free" maxlength="20" data-f="text" data-i="${i}"
            value="${esc(s.text)}" placeholder="例: ／" autocomplete="off"></label>
    <label class="icc-field"><span>数</span>
     <span class="mm-num" data-num-wrap>
      <button type="button" class="mm-num-btn" data-sep-step="-1" data-f="count" data-i="${i}" aria-label="数を減らす">−</button>
      <input class="mm-num-input icc-w-num" type="text" inputmode="numeric" autocomplete="off"
             data-f="count" data-i="${i}" value="${esc(String(s.count))}">
      <button type="button" class="mm-num-btn" data-sep-step="1" data-f="count" data-i="${i}" aria-label="数を増やす">＋</button>
     </span><em>個</em></label>
    <button type="button" class="icc-mini is-danger icc-sep-del" data-sepdel="${i}"
     ${rule.seps.length<=1?' disabled title="最後の1本は消せません（区切らないなら「区切らない」を選びます）"':' title="この決まりを消します"'}>削除</button>
   </li>`;
  }).join('');
  return `<section class="icc-panel icc-panel-seps">
   <h3><span class="icc-no">2</span>区切りの決まり</h3>
   <p class="icc-help">上から順に「<b>N件ごとに</b>／<b>この文字を</b>／<b>何個</b>」入れます。
    同じ位置に2つ以上あたるときは<b>間隔の大きいほうが勝ちます</b>
    （「1件ごとに半角スペース」＋「10件ごとに改行」なら、10件目のうしろは改行だけ）。</p>
   <ol class="icc-sep-list">${rows}</ol>
   <button type="button" class="icc-add" id="iccAddSep"${rule.seps.length>=MAX_SEPS?' disabled title="これ以上は増やせません"':''}>＋ 決まりを足す</button>
  </section>`;
 }

 function wire(box){
  const rule=ruleNow();
  const marks=box.querySelector('#iccMarks');
  if(marks)marks.onchange=()=>{ui.marks=marks.checked;render()};
  const cnt=box.querySelector('#iccCount');
  if(cnt)cnt.oninput=()=>{ui.count=clampInt(cnt.value,1,200);paintSample()};
  box.querySelectorAll('[data-icc-count]').forEach(b=>{
   b.onclick=()=>{ui.count=clampInt(ui.count+Number(b.dataset.iccCount),1,200);render()};
  });
  box.querySelectorAll('[data-pick]').forEach(b=>{
   b.onclick=()=>{ui.ruleId=b.dataset.pick;setCurrentId(ui.ruleId);render()};
  });
  const addRule=box.querySelector('#iccAddRule');
  if(addRule)addRule.onclick=()=>{
   if(rules().length>=MAX_RULES)return;
   const r=normRule({name:`ルール${rules().length+1}`,
                     seps:[{kind:'space',count:1,every:1}]},rules().length);
   r.id='r'+Date.now();
   cache=rules().concat([r]);save();
   ui.ruleId=r.id;ui.deleting='';setCurrentId(r.id);render();
   /* **名前をすぐ書ける**ようにして返す（探させない・§2）。 */
   const el=document.querySelector(`#iccModal [data-name="${CSS.escape(r.id)}"]`);
   if(el){el.focus();el.select()}
  };
  box.querySelectorAll('[data-name]').forEach(el=>{
   el.oninput=()=>{
    const r=rules().find(x=>x.id===el.dataset.name);if(!r)return;
    r.name=String(el.value||'').slice(0,40);save();
   };
   el.onblur=()=>{
    const r=rules().find(x=>x.id===el.dataset.name);if(!r)return;
    /* **空の名前を残さない**（一覧で選べなくなる）。 */
    if(!r.name.trim()){r.name=`ルール${rules().indexOf(r)+1}`;save();render()}
   };
  });
  box.querySelectorAll('[data-dup]').forEach(b=>{
   b.onclick=()=>{
    const r=rules().find(x=>x.id===b.dataset.dup);if(!r||rules().length>=MAX_RULES)return;
    const copy=normRule({name:r.name+'（写し）',seps:r.seps.map(s=>({...s}))},rules().length);
    copy.id='r'+Date.now();
    cache=rules().concat([copy]);save();
    ui.ruleId=copy.id;ui.deleting='';setCurrentId(copy.id);render();
   };
  });
  box.querySelectorAll('[data-del]').forEach(b=>{
   b.onclick=()=>{ui.deleting=b.dataset.del;render()};
  });
  box.querySelectorAll('[data-delno]').forEach(b=>{
   b.onclick=()=>{ui.deleting='';render()};
  });
  box.querySelectorAll('[data-delyes]').forEach(b=>{
   b.onclick=()=>{
    const id=b.dataset.delyes;
    cache=rules().filter(x=>x.id!==id);save();
    ui.deleting='';
    if(ui.ruleId===id){ui.ruleId=(cache[0]||{}).id||'';setCurrentId(ui.ruleId)}
    render();
   };
  });
  const addSep=box.querySelector('#iccAddSep');
  if(addSep&&rule)addSep.onclick=()=>{
   if(rule.seps.length>=MAX_SEPS)return;
   /* **足すのは「まだ無い間隔」**——同じ間隔を2本足しても片方しか効かない
      （②の勝ち負け）ので、既にある最大の10倍を初期値にする。 */
   const top=Math.max(...rule.seps.map(s=>s.every));
   rule.seps.push(normSep({kind:'nl',count:1,every:clampInt(top*10,2,MAX_EVERY)}));
   save();render();
  };
  box.querySelectorAll('[data-sepdel]').forEach(b=>{
   b.onclick=()=>{
    if(!rule||rule.seps.length<=1)return;
    rule.seps.splice(Number(b.dataset.sepdel),1);save();render();
   };
  });
  box.querySelectorAll('[data-sep-step]').forEach(b=>{
   b.onclick=()=>{
    if(!rule)return;
    const s=rule.seps[Number(b.dataset.i)];if(!s)return;
    const f=b.dataset.f,dir=Number(b.dataset.sepStep)||1;
    s[f]=clampInt(s[f]+dir,1,f==='every'?MAX_EVERY:MAX_COUNT);
    save();render();
   };
  });
  box.querySelectorAll('.icc-sep-row [data-f]').forEach(el=>{
   const i=Number(el.dataset.i),f=el.dataset.f;
   const apply=()=>{
    if(!rule)return;
    const s=rule.seps[i];if(!s)return;
    if(f==='kind'){s.kind=el.value;save();render();return}
    if(f==='text'){s.text=String(el.value||'').slice(0,20);save();paintSample();return}
    s[f]=clampInt(el.value,1,f==='every'?MAX_EVERY:MAX_COUNT);
    save();paintSample();
   };
   if(el.tagName==='SELECT')el.onchange=apply;else el.oninput=apply;
   if(el.tagName!=='SELECT')el.onblur=()=>render();
  });
 }
 /* 見本だけ塗り直す（数を打っている最中に器ごと作り直すと、打っている欄が
    消えてカーソルが飛ぶ）。 */
 function paintSample(){
  const out=document.getElementById('iccSample');
  const rule=ruleNow();
  if(!out||!rule)return;
  out.classList.toggle('is-marked',!!ui.marks);
  out.innerHTML=sampleHtml(sampleLots(),rule,ui.marks);
  const src=document.querySelector('#iccModal .icc-sample-src');
  if(src)src.textContent=sampleNote();
 }

 WL.lotCopy={rules,currentRule,joinLots,copyLots,menuItems,openSettings};
})();
