/* test_colrule.js: 値の読み替え(§9.88 段4)
   ============================================================
   「00」を「なし」と見せる類の置き換え。ルール名でまとめて登録し、
   複数の列から使い回す。

   ここで固定するのは、崩れると業務の判断を誤らせる次の点。
    1. **上から順に見て、最初に当てはまったものを採用する**
       ——この1文が崩れると、利用者が結果を予測できなくなる
    2. 行の中はAND、行同士はOR
    3. 条件が空の行＝どれにも当てはまらなかったときの既定
    4. **他の列を条件に使える**（「区分が3のときだけ○○と出す」）
    5. 数値として読める両辺は数値で比べる（'5' > '10' にしない）
    6. 読み替えが当たったらその言葉で確定し、**整形しない**
       （'00'を'0'へ整形してから読み替えると当たらないため、順序が要）
    7. 当たらなければ書式へ回り、それも駄目なら生の値
    8. 壊れた正規表現で一覧が落ちない
    9. 保存した読み替えが一覧のセルに効き、開き直しても残る
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const RULE='テスト読替'+Date.now().toString(36);   // 実行ごとに一意
let b=null,target='';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function cleanup(){
 try{if(target)await post('/api/column-layout-master',{target,order:[],widths:{},hidden:[],names:{},formats:{},rules:{},user_id:'test'})}catch(e){}
 try{await post('/api/display-rule-master/delete',{name:RULE,user_id:'test'})}catch(e){}
}
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:950}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,90))});
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'load'});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(()=>document.querySelectorAll('#grid table thead th').length>3,{timeout:25000});
  await page.waitForTimeout(1200);
  target=await page.evaluate(()=>listLayoutTarget());

  /* ---- 1) 判定そのもの(行を渡して結果を見るだけ) ---- */
  // 下書きを直接キャッシュへ入れて評価する(保存しなくても試せる形)。
  const evalRule=(rows,row,col)=>page.evaluate(a=>{
   WL.displayRules.put('__t__',a.rows);
   const hit=WL.displayRules.match('__t__',a.row,a.col);
   WL.displayRules.put('__t__',null);
   return hit?{text:hit.text,color:hit.color}:null;
  },{rows,row,col});
  const v=(kind,value)=>kind==='self'?{kind:'self'}:{kind,value,column:value};
  const cond=(op,right,left)=>({left:left||{kind:'self'},op,
                                ...(right===undefined?{}:{right:{kind:'value',value:right}})});

  const flag=[
   {conditions:[cond('eq','00')],text:'なし',color:''},
   {conditions:[cond('eq','01')],text:'あり',color:'ok'},
  ];
  rec('当てはまった行の表示値が返る',(await evalRule(flag,{X:'00'},'X'))?.text==='なし');
  rec('2行目も当たる',(await evalRule(flag,{X:'01'},'X'))?.text==='あり');
  rec('色も一緒に返る',(await evalRule(flag,{X:'01'},'X'))?.color==='ok');
  rec('どれにも当たらなければnull',(await evalRule(flag,{X:'02'},'X'))===null);

  /* **要点**: 上から順に、最初に当たったものを採用する。 */
  const order=[
   {conditions:[cond('contains','0')],text:'先',color:''},
   {conditions:[cond('eq','00')],text:'後',color:''},
  ];
  rec('上から見て最初に当たったものを採る',(await evalRule(order,{X:'00'},'X'))?.text==='先',
   (await evalRule(order,{X:'00'},'X'))?.text);

  /* 行の中はAND、行同士はOR */
  const andRule=[{conditions:[cond('eq','01'),cond('eq','3',{kind:'column',column:'区分'})],
                  text:'あり(特)',color:'warn'}];
  rec('行の中の条件はAND(両方当たれば採る)',
   (await evalRule(andRule,{X:'01',区分:'3'},'X'))?.text==='あり(特)');
  rec('行の中の条件はAND(片方だけでは採らない)',
   (await evalRule(andRule,{X:'01',区分:'9'},'X'))===null);
  const orRule=[{conditions:[cond('eq','01')],text:'A',color:''},
                {conditions:[cond('eq','02')],text:'A',color:''}];
  rec('行を分ければOR',(await evalRule(orRule,{X:'02'},'X'))?.text==='A');

  /* 条件が空の行＝既定 */
  const withDefault=[...flag,{conditions:[],text:'その他',color:'muted'}];
  rec('条件が空の行はどれにも当たらなかったときの既定',
   (await evalRule(withDefault,{X:'99'},'X'))?.text==='その他');
  rec('既定行があっても先に当たった行が優先される',
   (await evalRule(withDefault,{X:'00'},'X'))?.text==='なし');

  /* **要点**: 他の列を条件に使える */
  const other=[{conditions:[cond('eq','3',{kind:'column',column:'区分'})],text:'区分3',color:''}];
  rec('他の列を条件に使える',(await evalRule(other,{X:'zz',区分:'3'},'X'))?.text==='区分3');
  rec('他の列が違えば当たらない',(await evalRule(other,{X:'zz',区分:'1'},'X'))===null);

  /* **要点**: 数値として読める両辺は数値で比べる('5'>'10'にしない) */
  const gt=[{conditions:[cond('gt','10')],text:'大',color:''}];
  rec('数値は数値として比べる(5は10より大きくない)',(await evalRule(gt,{X:'5'},'X'))===null);
  rec('数値は数値として比べる(20は10より大きい)',(await evalRule(gt,{X:'20'},'X'))?.text==='大');
  rec('先頭0の数値も同じ値として扱う',
   (await evalRule([{conditions:[cond('eq','0')],text:'ゼロ'}],{X:'00'},'X'))?.text==='ゼロ');
  const between=[{conditions:[{left:{kind:'self'},op:'between',
                               right:{kind:'value',value:'10'},right2:{kind:'value',value:'20'}}],
                  text:'範囲内'}];
  rec('範囲の内側は当たる',(await evalRule(between,{X:'15'},'X'))?.text==='範囲内');
  rec('範囲の外側は当たらない',(await evalRule(between,{X:'25'},'X'))===null);

  /* 空欄まわり */
  rec('空欄を判定できる',
   (await evalRule([{conditions:[cond('empty')],text:'未記入'}],{X:''},'X'))?.text==='未記入');
  rec('空欄でないことも判定できる',
   (await evalRule([{conditions:[cond('notEmpty')],text:'あり'}],{X:'a'},'X'))?.text==='あり');

  /* **要点**: 書き間違えた正規表現で一覧を壊さない */
  rec('壊れた正規表現は「当たらない」で済ませる',
   (await evalRule([{conditions:[cond('regex','[')],text:'X'}],{X:'a'},'X'))===null);
  rec('正しい正規表現は効く',
   (await evalRule([{conditions:[cond('regex','^A\\d+$')],text:'型式'}],{X:'A12'},'X'))?.text==='型式');

  /* ---- 2) 読み替え→書式の順序 ---- */
  const cell=(o)=>page.evaluate(a=>{
   WL.displayRules.put('__t__',a.rows||[]);
   const out=WL.cellFormat.cell({raw:a.raw,format:a.format||null,rule:a.rows?'__t__':'',
                                 row:a.row||{},column:a.col||'X'});
   WL.displayRules.put('__t__',null);
   return out;
  },o);
  const numFmt={kind:'number',decimals:1,thousands:false,prefix:'',suffix:'',pattern:''};
  /* **要点**: 読み替えは生の値を見て判断する。書式が先に効くと '00'→'0.0' に
     なってしまい、'00' の読み替えが当たらなくなる。 */
  rec('読み替えが先で、当たったら整形しない',
   (await cell({raw:'00',format:numFmt,rows:flag,row:{X:'00'}})).text==='なし',
   (await cell({raw:'00',format:numFmt,rows:flag,row:{X:'00'}})).text);
  rec('当たらなければ書式で整形する',
   (await cell({raw:'12',format:numFmt,rows:flag,row:{X:'12'}})).text==='12.0');
  rec('読み替えも書式も駄目なら生の値',
   (await cell({raw:'ABC',format:numFmt,rows:flag,row:{X:'ABC'}})).text==='ABC');
  rec('表示値が空の行は元の値のまま出す(色だけ付く)',
   (await cell({raw:'77',rows:[{conditions:[cond('eq','77')],text:'',color:'ng'}],row:{X:'77'}})).text==='77');
  rec('その行の色は効く',
   (await cell({raw:'77',rows:[{conditions:[cond('eq','77')],text:'',color:'ng'}],row:{X:'77'}})).color==='ng');
  rec('ルール名が空なら読み替えを通らない',
   (await cell({raw:'00',format:numFmt,row:{X:'00'}})).text==='0.0');

  /* ---- 3) 保存して一覧のセルに効く ---- */
  const cols=await page.evaluate(()=>[...document.querySelectorAll('#grid th[data-sort-col]')].map(t=>t.dataset.sortCol));
  const col=cols.find(c=>c==='製造材質')||cols[1];
  const raw=await page.evaluate(c=>String(S.rows[0][c]??''),col);
  const save=await (await post('/api/display-rule-master',{name:RULE,user_id:'test',rows:[
   {conditions:[{left:{kind:'self'},op:'eq',right:{kind:'value',value:raw}}],text:'置き換え済',color:'ok'},
   {conditions:[],text:'その他',color:'muted'},
  ]})).json();
  rec('ルールを保存できる',save.ok===true&&save.rows===2,JSON.stringify(save.rows));

  await page.evaluate(async a=>{
   await WL.displayRules.load(true);
   await WL.columnLayout.save(listLayoutTarget(),{order:[],widths:{},hidden:[],names:{},formats:{},
                                                 rules:{[a.col]:a.rule}});
   renderGrid();
  },{col,rule:RULE});
  await page.waitForTimeout(300);
  const cellOf=c=>page.evaluate(x=>{
   const i=[...document.querySelectorAll('#grid th[data-sort-col]')].findIndex(t=>t.dataset.sortCol===x);
   const lead=[...document.querySelectorAll('#grid thead th')].findIndex(t=>t.dataset.sortCol);
   const td=document.querySelector('#grid tbody tr').children[lead+i];
   return {text:td.textContent.trim(),cls:td.className,title:td.title};
  },c);
  const shown=await cellOf(col);
  rec('読み替えが一覧のセルに効く',shown.text==='置き換え済',JSON.stringify(shown));
  rec('色がセルに付く',/cell-ok/.test(shown.cls),shown.cls);
  rec('元の値はツールチップで分かる',shown.title===raw,shown.title);

  /* ---- 4) 開き直しても残る ---- */
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(()=>document.querySelectorAll('#grid table thead th').length>3,{timeout:25000});
  await page.waitForTimeout(1200);
  rec('開き直しても読み替えが残る',(await cellOf(col)).text==='置き換え済');

  /* **要点**: ルールを消しても一覧は出る(参照が残っていても元の値で表示)。 */
  await post('/api/display-rule-master/delete',{name:RULE,user_id:'test'});
  await page.evaluate(async()=>{await WL.displayRules.load(true);renderGrid()});
  await page.waitForTimeout(250);
  rec('ルールを消したら元の値に戻る(一覧は壊れない)',(await cellOf(col)).text===raw,
   (await cellOf(col)).text);

  /* ---- 5) 編集画面 ---- */
  await page.evaluate(()=>WL.listColumns.open());
  await page.waitForTimeout(400);
  await page.evaluate(c=>{
   const el=[...document.querySelectorAll('#lcList .lc-item')].find(x=>x.dataset.key===c);
   el&&el.click();
  },col);
  await page.waitForTimeout(200);
  rec('列の設定に読み替えの選択がある',await page.evaluate(()=>!!document.getElementById('lcRule')));
  await page.evaluate(a=>WL.listRules.open({name:a.rule,column:a.col}),{rule:RULE,col});
  await page.waitForTimeout(400);
  const ed=await page.evaluate(()=>{
   const p=document.getElementById('listRulePanel');
   const r=p.getBoundingClientRect();
   return {open:!p.hidden,rows:p.querySelectorAll('.lr-row').length,
           ops:p.querySelectorAll('.lr-op option').length,
           tries:p.querySelectorAll('.lr-try-list li').length,
           w:Math.round(r.width),h:Math.round(r.height),
           left:Math.round(r.left),top:Math.round(r.top),vw:innerWidth,vh:innerHeight};
  });
  rec('ルールの編集画面が開く',ed.open&&ed.rows>=1,`${ed.rows}行`);
  rec('編集画面は画面の中に開く',
   ed.left>=0&&ed.top>=0&&ed.left+ed.w<=ed.vw+1&&ed.top+ed.h<=ed.vh+1,JSON.stringify(ed));
  rec('比較の選択肢が揃っている',ed.ops>=10,`${ed.ops}件`);
  /* **要点**: 保存前に実データでの結果が見える。 */
  rec('「試してみる」に実データの結果が出る',ed.tries>=1,`${ed.tries}件`);

  /* **要点**: 保存した行が全部見えること。行の一覧を独立したスクロール領域に
     すると、入りきらない行が(つまみも出ないまま)消えて見える(実際に出た)。
     スクロールはウィンドウ本体の1本だけにして、行を隠さない。 */
  await page.evaluate(()=>WL.listRules.close());
  await post('/api/display-rule-master',{name:RULE,user_id:'test',rows:[
   {conditions:[{left:{kind:'self'},op:'eq',right:{kind:'value',value:'A'}}],text:'あ',color:'ok'},
   {conditions:[{left:{kind:'self'},op:'eq',right:{kind:'value',value:'B'}}],text:'い',color:'warn'},
   {conditions:[],text:'',color:'muted'},
  ]});
  await page.evaluate(async a=>{await WL.displayRules.load(true);WL.listRules.open({name:a.rule,column:a.col})},
                      {rule:RULE,col});
  await page.waitForTimeout(400);
  const many=await page.evaluate(()=>{
   const p=document.getElementById('listRulePanel'),box=document.getElementById('lrRows');
   const pr=p.getBoundingClientRect(),tr=document.getElementById('lrTry').getBoundingClientRect();
   return {rows:box.querySelectorAll('.lr-row').length,
           anyRow:box.querySelectorAll('.lr-cond-any').length,
           hiddenInBox:box.scrollHeight-box.clientHeight,
           tryVisible:tr.height>0&&tr.bottom<=pr.bottom+1};
  });
  rec('保存した行がすべて出る',many.rows===3,`${many.rows}行`);
  rec('条件が空の行は「どれにも当てはまらないとき」として出る',many.anyRow===1);
  rec('行の一覧は独立してスクロールしない(行が隠れない)',many.hiddenInBox<=1,
   `隠れている高さ ${many.hiddenInBox}px`);
  rec('「試してみる」はウィンドウの中に見えている',many.tryVisible);
  // 行を足すと試した結果も増える(下書きのまま評価している)
  await page.evaluate(()=>document.getElementById('lrAddRow').click());
  await page.waitForTimeout(200);
  rec('行を足せる',await page.evaluate(()=>document.querySelectorAll('#listRulePanel .lr-row').length)>=2);
  await page.evaluate(()=>WL.listRules.close());

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));

  console.log('\n=== SUMMARY ===');
  const bad=R.filter(r=>!r.ok);console.log(`${R.length-bad.length}/${R.length} passed`);
  bad.forEach(x=>console.log(' -',x.n,x.d||''));
  await b.close();b=null;
  await cleanup();
  process.exit(bad.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  if(b)await b.close().catch(()=>{});
  await cleanup();
  process.exit(2);
 }
})();
