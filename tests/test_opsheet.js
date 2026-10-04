/* test_opsheet.js: 操業データ表（§9.241 ②、利用者の指示）
   ============================================================
   「帳票と同じような仕組みで、もう1枚別の帳票である、各設備別で操業データ表を
    作成したい。日ごとまたは日＋直毎に1枚の紙に入力した操業データが配置されて
    基本情報も入っていてロットが特定できるもの、1行で収まるものは通常の1行構成
    でリスト作成、データ数が多い場合は2行1データ構成でもできるように。
    レイアウトはA4横＆直単位（日＋直）をデフォルト。高密度で配置する必要が
    あります。中身のデータやレイアウトは後から調整できるように。」

   ここで固定するのは次の点。
    1. **既定はA4横＋直単位（日＋直）**
    2. 日＋直ごとに1枚に分かれ、日単位へ切り替えると1枚にまとまる
    3. 1件が1行のときと段組（既定2段・項目が多ければ4段まで・§9.553）のときがあり、**段組でも同じ`data-row`**
       （§9.235 ③。割ると測ったときの行数と刷り上がりが食い違う）
    4. **段組でも表が紙からはみ出さない**——段組は24本のトラック（配置の盤の1マス）に
       `colspan`で置き、**どの段もcolspanの合計がトラック数と一致**する（くわしくは`test_recordlayout`）
    5. 用紙を変えると紙の実寸が変わる（A3横）
    6. **枠線OFFは太さで見る**（§9.237 ①。`border:0`でも色は`currentColor`を
       返すので、色で見ると素通りする）
    7. **後から調整できる**——列レイアウトマスタ`opsheet:<設備>`で列を隠すと
       紙から消え、書式のパターンへ`段:2`と書くとその列が下の段へ移る（古い印は手がかりとして読む）
    8. 操業データの値が紙に出る

   **材料は自分で注ぎ込むこと**——検証用フィクスチャの実績は同じ日・同じ直に
   偏っているので、そのまま見ても「直ごとに切れている」と「たまたま1枚」を
   見分けられない。2つの直・2つの日を作って入れる。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const TAG='OS'+process.pid;
const EQ='テスト設備A';
const TARGET='opsheet:'+EQ;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const made=[];
function localIso(y,m,d,hh,mm){return new Date(y,m-1,d,hh,mm,0).toISOString()}
function ymd(y,m,d){const p=n=>String(n).padStart(2,'0');return `${y}-${p(m)}-${p(d)}`}
async function mk(o){
 const id=o.id;
 const payload=JSON.stringify({
  id,status:'完了',updatedAt:localIso(o.y,o.m,o.d,o.hh,0),
  basic:{lotNo:o.lotNo,inspectionNo:o.lotNo+'K',mfgMaterial:'A1050',mfgThickness:'0.5'},
  settings:{registeredEquipment:EQ,opData:o.opData||{}},
  workTime:{startAt:localIso(o.y,o.m,o.d,o.hh,0),endAt:localIso(o.y,o.m,o.d,o.hh,45)},
  measurements:{},
 });
 await post('/api/measurement/backup',{id,lotNo:o.lotNo,equipment:EQ,status:'完了',
   codec:'json-full-v32',payload,user_id:'test',updated_at_iso:localIso(o.y,o.m,o.d,o.hh,0)});
 made.push(id);
}
const cleanupLayout=async()=>{
 try{await post('/api/column-layout-master',{target:TARGET,clear:true,order:[],hidden:[],
   widths:{},names:{},formats:{},rules:{},formulas:{},locks:[],sorts:{},user_id:'test'})}catch(_){}
};

run('test_opsheet: 操業データ表（§9.241 ②、利用者の指示）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 try{
  await post('/api/access-mode',{mode:'edit'});
  await cleanupLayout();
  const Y=2026,M=4,D=6,day=ymd(Y,M,D);
  const OP1=TAG+'温度',OP2=TAG+'速度';
  /* 同じ日の 1直（9時）と 2直（18時）。**直で切れることを見るために
     2つの直を作る**——1つだけだと「切れている」と「たまたま1枚」が同じ。 */
  await mk({id:TAG+'-1',lotNo:TAG+'L1',y:Y,m:M,d:D,hh:9,opData:{[OP1]:'250',[OP2]:'80'}});
  await mk({id:TAG+'-2',lotNo:TAG+'L2',y:Y,m:M,d:D,hh:10,opData:{[OP1]:'251',[OP2]:'81'}});
  await mk({id:TAG+'-3',lotNo:TAG+'L3',y:Y,m:M,d:D,hh:18,opData:{[OP1]:'260',[OP2]:'90'}});

  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  /* **この端末の覚えを先に捨てる**——前の実行で用紙や行数を触っていると、
     「既定はA4横・直単位」を一度も確かめないまま通る。 */
  await page.evaluate(()=>{try{localStorage.removeItem('OpSheetPrintPrefV1')}catch(e){}});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openActuals',{timeout:25000});
  await page.click('#openActuals');
  await page.waitForSelector('#actualsPanel .ac-row.head',{timeout:20000});
  await page.selectOption('#acEquipment',EQ);
  await page.evaluate(d=>{
   const f=document.getElementById('acFrom'),t=document.getElementById('acTo');
   f.value=d;t.value=d;f.dispatchEvent(new Event('change'));t.dispatchEvent(new Event('change'));
  },day);
  await page.waitForFunction(t=>[...document.querySelectorAll('#acList .ac-row:not(.head)')]
    .filter(r=>r.textContent.includes(t)).length===3,TAG,{timeout:20000});
  await page.click('#acSheet');
  await page.waitForSelector('#osPreview .os-page',{timeout:20000});

  /* **座標は「拡大前」で測る**（§9.222 ②）。プレビューは`--os-zoom`で縮めて
     出しているので、`getBoundingClientRect()`は**拡大後**・`getComputedStyle`の
     `padding`は**拡大前**——混ぜて比べると器の端から離れるほど誤差が積む。
     `offsetWidth`/`clientWidth`はレイアウトの値（拡大前）なのでそちらで測る。 */
  const snap=()=>page.evaluate(()=>{
   const pages=[...document.querySelectorAll('#osPreview .os-page')];
   const p=pages[0];
   const spanSum=tr=>tr?[...tr.children].reduce((s,td)=>s+(Number(td.getAttribute('colspan'))||1),0):0;
   const r1=p&&p.querySelector('tbody tr.os-row-1'),r2=p&&p.querySelector('tbody tr.os-row-2');
   const table=p&&p.querySelector('.os-table');
   const cs=p?getComputedStyle(p):null;
   const td=p&&p.querySelector('tbody td');
   const bw=el=>{const c=getComputedStyle(el);return {
     top:parseFloat(c.borderTopWidth)||0,left:parseFloat(c.borderLeftWidth)||0,
     bottom:parseFloat(c.borderBottomWidth)||0}};
   return {
    枚数:pages.length,
    見出し:pages.map(x=>x.querySelector('.os-head').textContent.replace(/\s+/g,' ').trim()),
    紙:p?{w:p.offsetWidth,h:p.offsetHeight}:null,
    用紙:p?p.getAttribute('data-paper'):'',
    枠線:p?(p.getAttribute('data-borders')||'on'):'',
    密度:p?(p.getAttribute('data-dense')||''):'',
    トラック:p?p.querySelectorAll('colgroup col').length:0,
    上段span:spanSum(r1),下段span:spanSum(r2),
    上段セル:r1?r1.children.length:0,下段セル:r2?r2.children.length:0,
    行数:p?p.querySelectorAll('tbody tr').length:0,
    dataRow:p?[...p.querySelectorAll('tbody tr')].map(t=>t.dataset.row).join(','):'',
    表幅:table?Math.round(table.offsetWidth):0,
    紙の内寸:p&&cs?Math.round(p.clientWidth
      -parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)):0,
    罫線:td?bw(td):null,
    本文:p?p.querySelector('tbody').textContent:'',
    見出し語:p?[...p.querySelectorAll('thead tr:first-child th')].map(t=>t.textContent.trim()):[],
    /* 2段目より下の見出し（段の数は項目の数で2〜4段・§9.553） */
    下段見出し:p?[...p.querySelectorAll('thead .os-head-sub th')].map(t=>t.textContent.trim()).filter(Boolean):[],
    下段見出しセル:p?p.querySelectorAll('thead tr.os-head-2 th').length:0,
    段数:p?p.querySelectorAll('thead tr').length:0,
   };
  });

  const s0=await snap();
  rec('既定はA4横',s0.用紙==='a4-landscape',s0.用紙);
  rec('既定は直単位（日＋直で1枚ずつ）',s0.枚数===2,JSON.stringify(s0.見出し));
  rec('見出しに設備・現場日・直・件数が出る',
      /操業データ表/.test(s0.見出し[0])&&s0.見出し[0].includes(EQ)
      &&s0.見出し[0].includes(day)&&/件/.test(s0.見出し[0]),s0.見出し[0]);
  rec('既定は高密度',s0.密度==='on',s0.密度);
  rec('操業データの値が紙に出る',s0.本文.includes('250')&&s0.本文.includes('80'),
      s0.本文.slice(0,120));
  rec('表が紙の内寸に収まる',s0.表幅<=s0.紙の内寸+1,JSON.stringify({表:s0.表幅,紙:s0.紙の内寸}));
  rec('両段のcolspanの合計がトラック数と一致する',
      s0.上段span===s0.トラック&&(!s0.下段セル||s0.下段span===s0.トラック),
      JSON.stringify({トラック:s0.トラック,上:s0.上段span,下:s0.下段span}));

  /* ---- 1行構成 / 2行構成 ---- */
  await page.click('#osPvRows [data-rows="1"]');
  await page.waitForFunction(()=>!document.querySelector('#osPreview tbody tr.os-row-2'),null,{timeout:10000});
  const one=await snap();
  rec('1行構成では1件＝1行',one.行数===2&&one.下段セル===0,
      JSON.stringify({行:one.行数,下段:one.下段セル}));
  rec('1行構成でも紙に収まる',one.表幅<=one.紙の内寸+1,JSON.stringify({表:one.表幅,紙:one.紙の内寸}));

  await page.click('#osPvRows [data-rows="2"]');
  await page.waitForFunction(()=>!!document.querySelector('#osPreview tbody tr.os-row-2'),null,{timeout:10000});
  const two=await snap();
  rec('段組では1件＝段の数の行（2段以上）',two.段数>=2&&two.行数===2*two.段数&&two.下段セル>0,
      JSON.stringify({行:two.行数,段:two.段数,下段:two.下段セル}));
  rec('段は同じdata-rowでひとつの塊（紙を切っても割れない）',
      two.dataRow===[0,1].map(i=>Array(two.段数).fill(i).join(',')).join(','),two.dataRow);
  rec('2行構成でも紙からはみ出さない',two.表幅<=two.紙の内寸+1,
      JSON.stringify({表:two.表幅,紙:two.紙の内寸}));
  rec('段組では見出しも同じ段・同じ切れ目になる',two.下段見出しセル===two.下段セル,
      JSON.stringify({見出し:two.下段見出しセル,セル:two.下段セル}));

  /* ---- 用紙・枠線 ----
     用紙は**大きさと向きを別々に**選ぶ（§9.252、利用者の指示「実績データ表も
     同じ形に揃えてください」）。掛け合わせて並べると用紙を1つ足すたびに札が
     2枚増える。 */
  const waitPaper=k=>page.waitForFunction(want=>{
   const p=document.querySelector('#osPreview .os-page');
   return p&&p.getAttribute('data-paper')===want;
  },k,{timeout:10000});
  const papers=await page.evaluate(()=>({
   大きさ:[...document.querySelectorAll('#osPvPaperKind [data-kind]')].map(b=>b.dataset.kind),
   向き:[...document.querySelectorAll('#osPvPaperOrient [data-orient]')].map(b=>b.dataset.orient),
   全部:WL.opSheet.paperSizes().map(p=>p.key),
   規則:WL.opSheet.paperSizes().map(p=>WL.opSheet.pageRule(p.key))}));
  rec('用紙は「大きさ3枚＋向き2枚」に分かれて並ぶ(§9.252)',
      papers.大きさ.join(',')==='a4,b4,a3'&&papers.向き.join(',')==='landscape,portrait',
      JSON.stringify({大きさ:papers.大きさ,向き:papers.向き}));
  rec('B4を足しても選択肢は掛け算で増えない（札は5枚）',
      papers.大きさ.length+papers.向き.length===5&&papers.全部.length===6,
      JSON.stringify(papers.全部));
  /* **`@page`は用紙の名前ではなく実寸mm**（§9.252）——名前で頼むと
     B4だけA4の紙に刷られ、さらにCSSの`B4`はISO(250×353mm)で紙が縮む。 */
  rec('@pageは用紙の名前ではなく実寸mmで頼む',
      papers.規則.every(r=>/^@page\{size:\d+mm \d+mm;margin:0\}$/.test(r))
      &&papers.規則.every(r=>!/\b(A4|A3|B4)\b/.test(r)),JSON.stringify(papers.規則));
  await page.click('#osPvPaperKind [data-kind="a3"]');
  await waitPaper('a3-landscape');
  const a3=await snap();
  rec('大きさをA3にすると紙が広くなる（向きは横のまま残る）',a3.紙.w>two.紙.w,
      JSON.stringify({A4:two.紙.w,A3:a3.紙.w}));
  await page.click('#osPvPaperKind [data-kind="b4"]');
  await waitPaper('b4-landscape');
  const b4=await snap();
  rec('B4横はJISの364×257mmで紙が組まれる（A4横とA3横の間）',
      b4.紙.w>two.紙.w&&b4.紙.w<a3.紙.w,
      JSON.stringify({A4:two.紙.w,B4:b4.紙.w,A3:a3.紙.w}));
  const note=await page.evaluate(()=>(document.getElementById('osPvPaperNow')||{}).textContent||'');
  rec('いまの用紙と刷れる範囲を文字で出す',
      /B4 横/.test(note)&&/364×257mm/.test(note)&&/348×241mm/.test(note),note);
  await page.click('#osPvPaperKind [data-kind="a4"]');
  await waitPaper('a4-landscape');

  const before=await snap();
  await page.click('#osPvBorders');
  await page.waitForFunction(()=>{
   const p=document.querySelector('#osPreview .os-page');
   return p&&p.getAttribute('data-borders')==='off';
  },null,{timeout:10000});
  const off=await snap();
  /* **太さで見ること**（§9.237 ①）——`border:0`でも色は`currentColor`を
     返すので、色で見ると素通りする。**格子は本当に0にする**（縦と上の線）が、
     **横の区切りは残す**（セルの余白が1mmしかないので、全部消すと文字が
     横一列に並んで読めない・§9.236 ①）。 */
  rec('枠線OFFで縦と上の格子が本当に0になる',
      !!off.罫線&&off.罫線.top===0&&off.罫線.left===0
      &&!!before.罫線&&before.罫線.top>0,
      JSON.stringify({ON:before.罫線,OFF:off.罫線}));
  rec('枠線OFFでも横の区切りは残す（消すと読めない）',
      !!off.罫線&&off.罫線.bottom>0,JSON.stringify(off.罫線));
  await page.click('#osPvBorders');

  /* ---- 日単位へ切り替え ---- */
  await page.click('#osPvUnit [data-unit="date"]');
  await page.waitForFunction(()=>document.querySelectorAll('#osPreview .os-page').length===1,
    null,{timeout:10000});
  const byDay=await snap();
  rec('日単位にすると同じ日が1枚にまとまる',byDay.枚数===1&&byDay.行数>=3,
      JSON.stringify({枚:byDay.枚数,行:byDay.行数}));
  await page.click('#osPvUnit [data-unit="shift"]');

  /* ---- 後から調整できる（列レイアウトマスタ） ---- */
  const had=(await snap()).見出し語.includes(OP1)||(await snap()).下段見出し.includes(OP1);
  rec(`前提: 操業データの列（${OP1}）が紙に出ている`,had,String(had));
  await post('/api/column-layout-master',{target:TARGET,user_id:'test',
    order:await page.evaluate(()=>WL.opSheet.columnKeys()),
    hidden:[OP1]});
  await page.evaluate(()=>WL.columnLayout.forget&&WL.columnLayout.forget());
  await page.evaluate(t=>WL.columnLayout.load(t),TARGET);
  await page.evaluate(()=>WL.opSheet.render());
  await page.waitForFunction(k=>{
   const p=document.querySelector('#osPreview .os-page');
   if(!p)return false;
   return ![...p.querySelectorAll('thead th')].some(t=>t.textContent.trim()===k);
  },OP1,{timeout:10000}).catch(()=>{});
  const hid=await snap();
  rec('列を隠すと紙から消える（後から調整できる）',
      !hid.見出し語.includes(OP1)&&!hid.下段見出し.includes(OP1),
      JSON.stringify(hid.見出し語.slice(0,6)));

  /* 段の指定（書式のパターンへ `段:2`）。**`formats`へ文字列を直に入れない**
     （§9.205）ので、`{kind:'',pattern:'段:2'}`の形で入れる。 */
  await post('/api/column-layout-master',{target:TARGET,user_id:'test',
    hidden:[],formats:{[OP2]:{kind:'',pattern:'段:2'}}});
  await page.evaluate(()=>WL.columnLayout.forget&&WL.columnLayout.forget());
  await page.evaluate(t=>WL.columnLayout.load(t),TARGET);
  await page.evaluate(()=>WL.opSheet.render());
  await page.waitForFunction(k=>{
   const p=document.querySelector('#osPreview .os-page');
   if(!p)return false;
   return [...p.querySelectorAll('.os-head-sub th')].some(t=>t.textContent.trim()===k);
  },OP2,{timeout:10000}).catch(()=>{});
  const staged=await snap();
  rec('「段:2」と書いた列は下の段へ移る（古い印は手がかりとして読む・§9.553）',
      staged.下段見出し.includes(OP2)&&!staged.見出し語.includes(OP2),
      JSON.stringify({下段:staged.下段見出し.slice(0,6),上段:staged.見出し語.slice(0,6)}));

  rec('画面の例外が出ていない',errs.length===0,errs.join(' / '));
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }finally{
  try{await post('/api/measurement/backup/delete',{ids:made})}catch(_){}
  await cleanupLayout();
 }
}, {viewport:{width:1600,height:1000}});
