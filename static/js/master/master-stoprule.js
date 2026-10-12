/* ============================================================
   master-stoprule.js: 設備停止の挿入条件の盤（§9.588）

   利用者の指示:
   「判定条件は設備停止マスタの設備停止ごとに持たせ、…条件は列のデータを組み合わせて条件テーブルを判定条件とし、
    その設備停止の挿入数、挿入すべきそれぞれの時間と自動挿入か、警告のみか選べるようにします。」

   置き場（7案を撮って M3 に決めた）: 設備停止マスタの3つのペインの**下に全幅の節**。選んだ停止内容の表を出す
   （右のペインだけでは答え・備考の列が切れた）。表そのもの（セルの書き方・候補・試す・読み上げ・並べ替え・
   当たらない条件・答えの地図・保存の段取り）は判定表の部品（`bladeset/rule-table.js`）。ここが持つのは
     ・列の組（前のロット・後ろのロット・変わったか・差＝サーバーの語彙`insertRuleVocab.sets`＋仕掛の列名）
     ・答えの3つの欄（本数・それぞれの時間・自動で入れるか知らせるか）
   判定は作業スケジュールの画面（`schedule/stop-rules.js` → `WL.ruleCells.firstRule()`）——ここと同じ1本。
   ============================================================ */
(function(){
 'use strict';
 window.WL=window.WL||{};
 /* 列の呼び名（組ごと）。見出しが「どのロットの値か」を言う。 */
 const LABEL={prev:n=>`${n}（前）`,next:n=>`${n}（後ろ）`,chg:n=>`${n}（変わったか）`,diff:n=>`${n}の差`};
 const minutesText=r=>(r.minutes||[]).slice(0,+r.count||0).map(m=>(m?String(m):'')).join(', ');
 /* 時間の欄の字 → 分の並び（空は標準の分）。「30, 15」「30、15」どちらでも。 */
 const parseMinutes=t=>String(t||'').replace(/、/g,',').split(',').map(x=>WL.base.toHalfWidth(x).trim())
  .map(x=>(x===''?null:Math.max(1,Math.round(+x)||0)||null));
 const st={stop:null,vocab:null,src:{columns:[],samples:{}},probe:{},reload:null,host:null};

 function actionWord(a){return (((st.vocab||{}).actions||[]).find(x=>x.key===a)||{}).label||a}
 /* 答えを1つの字に（表の下の読み上げ・答えの地図の凡例）。 */
 function answerLabel(r){
  const n=+r.count||0;
  if(!n)return '入れない';
  const std=st.stop&&st.stop.standardMinutes;
  const m=Array.from({length:n},(_,i)=>(r.minutes||[])[i]||std||'');
  return `${n}本・${m.map(x=>(x?`${x}分`:'標準')).join('＋')}・${actionWord(r.action)}`;
 }
 const table=WL.ruleTable.create({
  key:'stoprule',label:'挿入の条件',answerHead:'入れる本数',
  host:()=>st.host,
  fields:()=>[],
  groups:()=>((st.vocab||{}).sets||[]).map(s=>({key:s.key,label:s.label})),
  sourceSets:()=>((st.vocab||{}).sets||[]).map(s=>({key:s.key,prefix:s.prefix,label:s.label,kind:s.kind,options:s.options||[],
   cols:st.src.columns,labelOf:LABEL[s.key]||(n=>n),
   desc:(n,ex)=>`${s.desc}「${n}」${ex.length?`・例 ${ex.join(' / ')}`:''}`})),
  samples:()=>st.src.samples,
  probe:st.probe,
  seedNote:'空——どの境目にも入れない',
  lead:'作業スケジュールの<b>ロットとロットの境目</b>ごとに、<b>前のロットと後ろのロットの値</b>で決めます。'
   +'上から最初に当たった行の本数だけ、境目にこの設備停止が無ければ<b>足りない</b>と見ます（「知らせる」は黄色で提案・「自動で入れる」は'
   +'ロットを入れた・外した・並べ替えたときに入れます）。',
  answerCols:()=>[
   {key:'count',head:'入れる本数',kind:'select',title:'この境目に要る本数（0＝要らない）',
    options:()=>Array.from({length:((st.vocab||{}).countMax||9)+1},(_,n)=>({v:String(n),label:n?`${n}本`:'要らない'})),
    get:r=>String(+r.count||0),set:(r,v)=>{r.count=+v||0}},
   {key:'minutes',head:'それぞれの時間（分）',kind:'text',
    placeholder:st.stop&&st.stop.standardMinutes?`空欄＝標準${st.stop.standardMinutes}分`:'例 30, 15',
    title:'1本ずつの時間を「, 」で区切って（空欄はこの停止内容の標準所要分）',
    get:r=>minutesText(r),set:(r,v)=>{r.minutes=parseMinutes(v)}},
   {key:'action',head:'入れ方',kind:'select',title:'足りないとき、自動で入れるか、黄色で知らせて人が入れるか',
    options:()=>((st.vocab||{}).actions||[]).map(a=>({v:a.key,label:a.label})),get:r=>r.action||'warn',set:(r,v)=>{r.action=v}}],
  answers:()=>[],answerOf:()=>'',setAnswer:()=>{},
  answerLabel,
  blankRow:()=>({count:1,minutes:[],action:'warn'}),
  rowOut:r=>({count:+r.count||0,minutes:(r.minutes||[]).slice(0,+r.count||0),action:r.action||'warn'}),
  endpoint:'/api/schedule/stop-rule',payload:()=>({stopId:st.stop&&st.stop.id}),
  savedWord:()=>(st.stop?`${st.stop.name}（${st.stop.equipmentLabel||''}）`:''),
  reload:()=>(st.reload?st.reload():Promise.resolve()),
 });

 /* 選んだ停止内容の表を描く。**同じ停止内容のまま描き直すときは、保存していない変更を捨てない**
    （3つのペインは触るたびに描き直すので、ここで毎回`setData`すると打った条件が消える）。 */
 async function mount(host,stop,vocab,reload){
  const same=st.stop&&stop&&Number(st.stop.id)===Number(stop.id);
  st.host=host;st.vocab=vocab||st.vocab;st.reload=reload;
  if(!stop){host.innerHTML='<p class="mm-empty">停止内容を選ぶと、その<b>挿入の条件</b>（スケジュールの境目に自動で入れる・知らせる決まり）がここに出ます。</p>';return}
  if(!(same&&table.dirty)){
   st.stop=stop;
   Object.keys(st.probe).forEach(k=>delete st.probe[k]);
   const r=stop.insertRule||{rows:[],cols:[],stored:false};
   table.setData((r.rows||[]).map(x=>({conditions:x.conditions||[],count:x.count,minutes:x.minutes||[],action:x.action||'warn',note:x.note||''})),
                 !!r.stored,r.cols||[]);
  }
  if(!st.src.columns.length)st.src=await WL.ruleTable.loadSource();
  host.innerHTML='<section class="rt" data-table="stoprule"></section>';
  st.host=host.querySelector('[data-table="stoprule"]');
  table.render();
 }
 /* 停止内容の一覧に出す一言（「条件 2行・自動1」）。条件の無い既定だけ・未登録は出さない。 */
 function chipText(stop){
  const r=(stop&&stop.insertRule)||{};
  if(!r.stored)return '';
  const rows=(r.rows||[]).filter(x=>(x.conditions||[]).length);
  const def=(r.rows||[]).find(x=>!(x.conditions||[]).length);
  if(!rows.length&&!(def&&+def.count))return '';
  const auto=(r.rows||[]).filter(x=>+x.count&&x.action==='auto').length;
  return `条件 ${rows.length}行${auto?`・自動${auto}`:''}`;
 }
 /* 描き直しで捨ててよいか（保存していない変更があれば聞く）。 */
 const dirty=()=>!!table.dirty;
 WL.stopRuleBoard={mount,chipText,dirty,table};
})();
