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
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const RULE='テスト読替'+Date.now().toString(36);   // 実行ごとに一意
let target='';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function cleanup(){
 try{if(target)await post('/api/column-layout-master',{target,clear:true,order:[],widths:{},hidden:[],names:{},formats:{},rules:{},user_id:'test'})}catch(e){}
 try{await post('/api/display-rule-master/delete',{name:RULE,user_id:'test'})}catch(e){}
}
run('test_colrule: 値の読み替え(§9.88 段4)', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 page.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,90))});
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'load'});
  /* 起動の取得が静まってから書き換え・読み込み直す（すぐ reload すると初期化の取得が
     打ち切られ、アプリが「初期化エラー」を console へ出す・§9.451）。 */
  await W.booted(page); await idle();
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(()=>document.querySelectorAll('#grid table thead th').length>3,{timeout:25000});
  await idle();
  target=await page.evaluate(()=>WL.list.listLayoutTarget());

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
  /* **要点**: 自分の列に値が無くても、他の列だけで中身を作れる（§9.234 ⑥）。
     計算式の列で「読み替えだけの列」を作れることの土台。 */
  rec('自分の列が空でも他の列だけで当たる（§9.234 ⑥）',
      (await evalRule(other,{X:'',区分:'3'},'X'))?.text==='区分3');
  rec('自分の列が空でも他の列が違えば当たらない',
      (await evalRule(other,{X:'',区分:'1'},'X'))===null);
  /* **要点**: そのルールが見ている「他の列」を答えられる（§9.234 ⑥）。
     スケジュール表は行ごとに全列ぶんの値を作ると重いので、要る列だけを
     組み立てるのにこれを使う。`self`は自分の列なので数えない。 */
  const usedOf=rows=>page.evaluate(a=>{
   WL.displayRules.put('__u__',a.rows);
   const out=WL.displayRules.columnsUsed('__u__');
   WL.displayRules.put('__u__',null);
   return out;
  },{rows});
  rec('見ている他の列を答えられる',
      JSON.stringify((await usedOf(other)).sort())===JSON.stringify(['区分']),
      JSON.stringify(await usedOf(other)));
  rec('自分の列だけの条件では何も返さない',
      (await usedOf(flag)).length===0,JSON.stringify(await usedOf(flag)));
  rec('betweenの2つ目の右辺まで拾う',
      JSON.stringify((await usedOf([{conditions:[{left:{kind:'self'},op:'between',
        right:{kind:'column',column:'下限'},right2:{kind:'column',column:'上限'}}],
        text:'間',color:''}])).sort())===JSON.stringify(['上限','下限']),
      JSON.stringify(await usedOf([{conditions:[{left:{kind:'self'},op:'between',
        right:{kind:'column',column:'下限'},right2:{kind:'column',column:'上限'}}],text:'間',color:''}])));

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

  /* ---- 2b) 抜き出し・変換してから比べる／抜き出した値を出す（§9.464、利用者の指示
     「文字列からの抽出や変換処理もできるように」）。条件の片側に**式**、出す字は
     **`=`で始めると式**。`[この列]`はこの列の値。 ---- */
  const calc=expr=>({kind:'calc',expr});
  const big=[{conditions:[{left:calc("num(extract([この列],'[0-9]+'))"),op:'gt',right:{kind:'value',value:'100'}}],
              text:'大',color:'warn'}];
  rec('式で抜き出してから比べられる（LOT123 → 123 > 100）',
   (await evalRule(big,{X:'LOT123'},'X'))?.text==='大');
  rec('式で抜き出した値が条件に合わなければ当たらない（LOT045 → 45）',
   (await evalRule(big,{X:'LOT045'},'X'))===null);
  rec('式は他の列も見られる',
   (await evalRule([{conditions:[{left:calc("hankaku([Y])"),op:'eq',right:{kind:'value',value:'AB1'}}],text:'一致'}],
                   {X:'x',Y:'ＡＢ１'},'X'))?.text==='一致');
  rec('読めない式の条件は「当たらない」で済ませる（一覧を壊さない）',
   (await evalRule([{conditions:[{left:calc("extract([この列],'(')"),op:'notEmpty'}],text:'X'}],{X:'a'},'X'))===null);
  const ext=await cell({raw:'LOT-123-A',rows:[{conditions:[],text:"=extract([この列],'[0-9]+')"}],
                        row:{X:'LOT-123-A'},col:'X'});
  rec('出す字を「=式」にすると、抜き出した値を出せる',ext.text==='123',ext.text);
  const used=await page.evaluate(()=>{
   WL.displayRules.put('__u2__',[{conditions:[{left:{kind:'calc',expr:"mid([品番],2,3)"},op:'notEmpty'}],
                                  text:'=concat([区分],"-")'}]);
   const u=WL.displayRules.columnsUsed('__u2__');
   WL.displayRules.put('__u2__',null);
   return u;
  });
  rec('式が見ている列も「使っている列」に数える（スケジュール表が値を用意できる）',
   used.includes('品番')&&used.includes('区分')&&!used.includes('この列'),JSON.stringify(used));

  /* ---- 2c) 表示名を付けても元の名前で列を引ける（§9.464、利用者の報告「元の列の名前を
     変えると、使えなくなってしまう」）。答えは`WL.columnLayout.keyByName()`の1箇所。 ---- */
  /* **本物の一覧の設定には触らない**——網だけが使う対象名（`__kb__`）に表示名を置く
     （保存済みの設定の器を直に書き換えると、後の節と後の網が汚れた設定を見る）。 */
  const kb=await page.evaluate(()=>{
   const t='__kb__',keys=['ﾛｯﾄ番号','製造板厚','区分'];
   const L=WL.columnLayout;
   L.get(t).names={'製造板厚':'厚み'};
   return {raw:L.keyByName(t,keys,'製造板厚'),named:L.keyByName(t,keys,'厚み'),
           alias:L.keyByName(t,keys,'ロット番号'),aliasKey:L.keyByName(t,keys,'lotNo'),
           none:L.keyByName(t,keys,'無い列')};
  });
  rec('表示名を付けても、元の列名で引ける',kb.raw==='製造板厚',JSON.stringify(kb));
  rec('いまの表示名でも同じ列を引ける',kb.named==='製造板厚',JSON.stringify(kb));
  rec('別名（ロット番号／lotNo）でも生の列名（ﾛｯﾄ番号）を引ける',
   kb.alias==='ﾛｯﾄ番号'&&kb.aliasKey==='ﾛｯﾄ番号',JSON.stringify(kb));
  rec('無い名前は引かない（空）',kb.none==='',JSON.stringify(kb));
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
   await WL.columnLayout.save(WL.list.listLayoutTarget(),{order:[],widths:{},hidden:[],names:{},formats:{},
                                                 rules:{[a.col]:a.rule}});
   WL.list.renderGrid();
  },{col,rule:RULE});
  await paint();
  /* 列は`data-col`で引く(§9.104)。本文は「列の窓」の中しか作らないので、
     先頭からの位置では当たらない(窓の外は colspan の空セルに畳まれる)。 */
  const cellOf=async c=>{
   await page.evaluate(x=>{
    document.querySelector(`#grid th[data-sort-col="${CSS.escape(x)}"]`)
      ?.scrollIntoView({block:'nearest',inline:'nearest'});
   },c);
   await page.waitForFunction(x=>!!document.querySelector(
     `#grid tbody tr td[data-col="${CSS.escape(x)}"]`),c,{timeout:10000});
   return page.evaluate(x=>{
    const td=document.querySelector(`#grid tbody tr td[data-col="${CSS.escape(x)}"]`);
    return {text:td.textContent.trim(),cls:td.className,title:td.title};
   },c);
  };
  const shown=await cellOf(col);
  rec('読み替えが一覧のセルに効く',shown.text==='置き換え済',JSON.stringify(shown));
  rec('色がセルに付く',/cell-ok/.test(shown.cls),shown.cls);
  rec('元の値はツールチップで分かる',shown.title===raw,shown.title);

  /* ---- 4) 開き直しても残る ---- */
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(()=>document.querySelectorAll('#grid table thead th').length>3,{timeout:25000});
  await idle();
  rec('開き直しても読み替えが残る',(await cellOf(col)).text==='置き換え済');

  /* **要点**: ルールを消しても一覧は出る(参照が残っていても元の値で表示)。 */
  await post('/api/display-rule-master/delete',{name:RULE,user_id:'test'});
  await page.evaluate(async()=>{await WL.displayRules.load(true);WL.list.renderGrid()});
  await paint();
  rec('ルールを消したら元の値に戻る(一覧は壊れない)',(await cellOf(col)).text===raw,
   (await cellOf(col)).text);

  /* ---- 5) 編集画面 ---- */
  await page.evaluate(()=>WL.listColumns.open());
  await W.until(page,c=>[...document.querySelectorAll('#lcList .lc-item')].some(x=>x.dataset.key===c),col,{ms:8000,what:'列の設定パネルにその列が並ぶ'});
  await page.evaluate(c=>{
   const el=[...document.querySelectorAll('#lcList .lc-item')].find(x=>x.dataset.key===c);
   el&&el.click();
  },col);
  await W.until(page,()=>!!document.getElementById('lcRule'),null,{ms:4000,what:'列の設定に読み替えの選択が出る'});
  rec('列の設定に読み替えの選択がある',await page.evaluate(()=>!!document.getElementById('lcRule')));
  await page.evaluate(a=>WL.listRules.open({name:a.rule,column:a.col}),{rule:RULE,col});
  await page.waitForSelector('#listRulePanel:not([hidden])',{timeout:8000}); await idle();
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
                      await page.waitForSelector('#listRulePanel:not([hidden])',{timeout:8000}); await idle();
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
  await paint();
  rec('行を足せる',await page.evaluate(()=>document.querySelectorAll('#listRulePanel .lr-row').length)>=2);
  await page.evaluate(()=>WL.listRules.close());

  /* ============================================================
     §9.117 条件式ビルダーの作り直し。
     どれも「作った本人が確かめられない」を潰すためのもの。
     ============================================================ */
  await post('/api/display-rule-master',{name:RULE,user_id:'test',rows:[
   {conditions:[{left:{kind:'self'},op:'eq',right:{kind:'value',value:'A'}}],text:'あ',color:'ok'},
   {conditions:[{left:{kind:'self'},op:'eq',right:{kind:'value',value:'B'}}],text:'い',color:'warn'},
  ]});
  await page.evaluate(async a=>{await WL.displayRules.load(true);
                                await WL.listRules.open({name:a.rule,column:a.col})},{rule:RULE,col});
  await page.waitForSelector('#listRulePanel:not([hidden])',{timeout:8000});

  /* ---- 評価順を画面から変えられる（「上から順に最初に当たったもの」が
         決まりなのに、並べ替えができなかった） ---- */
  const order0=await page.evaluate(()=>[...document.querySelectorAll('#lrRows .lr-text')].map(i=>i.value));
  await page.evaluate(()=>document.querySelector('#lrRows .lr-row[data-row="1"] .lr-up').click());
  const order1=await page.evaluate(()=>[...document.querySelectorAll('#lrRows .lr-text')].map(i=>i.value));
  rec('行を上へ動かせる（評価順を変えられる）',
      order0.join()==='あ,い'&&order1.join()==='い,あ',`${order0.join()} → ${order1.join()}`);
  await page.evaluate(()=>document.querySelector('#lrRows .lr-row[data-row="0"] .lr-down').click());
  rec('下へも動かせる（元へ戻る）',
      (await page.evaluate(()=>[...document.querySelectorAll('#lrRows .lr-text')].map(i=>i.value))).join()==='あ,い');
  rec('先頭の▲と末尾の▼は押せない',await page.evaluate(()=>{
   const up=document.querySelector('#lrRows .lr-row[data-row="0"] .lr-up');
   const rows=document.querySelectorAll('#lrRows .lr-row');
   const down=rows[rows.length-1].querySelector('.lr-down');
   return up.disabled&&down.disabled;
  }));

  /* ---- 行ごとの当たり件数（当たらない行はその場で分かる） ---- */
  const stats=await page.evaluate(()=>[...document.querySelectorAll('#lrRows .lr-row-stat')]
    .map(e=>e.textContent.trim()));
  rec('行ごとに当たり具合が出る',stats.length>=2&&stats.every(t=>/件|当たり/.test(t)),
      JSON.stringify(stats).slice(0,140));

  /* ---- 既定の行を画面から作れる（以前は作る手立てが1つも無かった） ---- */
  await page.evaluate(()=>document.getElementById('lrAddDefault').click());
  const withDef=await page.evaluate(()=>({
   rows:document.querySelectorAll('#lrRows .lr-row').length,
   any:document.querySelectorAll('#lrRows .lr-cond-any').length,
   addDisabled:document.getElementById('lrAddDefault').disabled,
  }));
  rec('「どれにも当てはまらないとき」を足せる',withDef.rows===3&&withDef.any===1,JSON.stringify(withDef));
  rec('既定の行は1つだけ（2つ目は足せない）',withDef.addDisabled===true);

  /* ---- 既定より下の行は「決して来ない」と言う ---- */
  await page.evaluate(()=>document.getElementById('lrAddRow').click());
  const dead=await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('#lrRows .lr-row')];
   const last=rows[rows.length-1];
   return {dead:last.classList.contains('lr-row-dead'),
           note:(last.querySelector('.lr-row-stat')||{}).textContent||''};
  });
  rec('既定より下の行は「決して来ない」と分かる',
      dead.dead&&/決して/.test(dead.note),JSON.stringify(dead));

  /* ---- 最後の条件を消すと既定の行になる（条件0＝既定という評価側の約束） ---- */
  await page.evaluate(()=>{
   // 既定より前の1行目の条件をすべて消す
   const del=document.querySelector('#lrRows .lr-row[data-row="0"] .lr-cond-del');
   del.click();
  });
  rec('最後の条件も消せる（消すと既定の行になる）',await page.evaluate(()=>{
   const row=document.querySelector('#lrRows .lr-row[data-row="0"]');
   return !!row.querySelector('.lr-cond-any');
  }));

  /* ---- 「試してみる」がどの行に当たったかを言う ---- */
  const which=await page.evaluate(()=>[...document.querySelectorAll('.lr-try-list li')]
    .map(li=>(li.querySelector('.lr-which')||li.querySelector('.lr-nohit')||{}).textContent||''));
  rec('試した結果に「何行目が当たったか」が出る',
      which.length>0&&which.some(t=>/行目/.test(t)),JSON.stringify(which.slice(0,4)));
  await page.evaluate(()=>WL.listRules.close());

  /* ---- どの列で使っているかを出す（使い回す前提の仕組みなので、
         直すと他の列にも効くことを知らずに直せる状態にしない） ---- */
  await page.evaluate(async a=>{await WL.displayRules.load(true);
                                await WL.listRules.open({name:a.rule,column:a.col})},{rule:RULE,col});
  await page.waitForSelector('#listRulePanel:not([hidden])',{timeout:8000});
  const usage=await page.evaluate(()=>({
   text:document.getElementById('lrUsage').textContent.trim(),
   /* 読めなかった(null)と「使っていない」(空配列)を取り違えないこと。 */
   api:(()=>{const u=WL.displayRules.usage('__no_such_rule__');return u===null?-1:u.length})(),
  }));
  rec('このルールを使っている列が出る',/使っている列|まだどの列でも/.test(usage.text),usage.text);
  rec('使っていないルールは0件（読めなかったのとは区別する）',usage.api===0,String(usage.api));
  await page.evaluate(()=>WL.listRules.close());

  /* ---- 名前は素のprompt()で聞かない（浮きウィンドウの裏に隠れる） ---- */
  const usedPrompt=await page.evaluate(async()=>{
   let called=false;const orig=window.prompt;window.prompt=()=>{called=true;return null};
   const p=WL.listRules.open({column:(S.columns||[])[0]});
   await new Promise(r=>setTimeout(r,400));
   const modal=document.getElementById('appConfirmModal');
   /* 入力欄は共通の`promptModal`が持つ`#appPromptInput`（§9.342）。
      以前はこの画面だけの`#lrNewName`だった——**自前の写しを消したので、
      網も共通の口を見る**。 */
   const shown=!!modal&&!modal.hidden&&!!document.getElementById('appPromptInput');
   document.getElementById('appConfirmCancel')?.click();
   await p.catch(()=>{});
   window.prompt=orig;
   return {called,shown};
  });
  rec('新規作成の名前をprompt()で聞かない',usedPrompt.called===false,JSON.stringify(usedPrompt));
  rec('名前はアプリの確認モーダルで聞く',usedPrompt.shown===true,JSON.stringify(usedPrompt));

  /* ---- §9.474: 式が真なら／列の値（元のデータ・表示の値）／式への変換／窓 ----
     利用者の指示「式を選んだら、条件式の符号など選ばずに…自由度の高い内容で組めるように」
     「データをもとのまま使うか、設定範囲内で変換されたデータを使うか選べるように」「他の列だったと
     しても…元データのみを対象にしている」「ルールを…『この列の作り方』…に直接入れられるように式変換」
     「試した結果…左の3割くらいに…2ペイン」「関数などは特にサジェスト」。
     前（実測）: 式の列を他の列で見るルール 0/87・式の列自身のルール 0/87・式が真なら は欄5つ。 */
  const r474=await page.evaluate(()=>{
   const out={};
   const fxRule=[{conditions:[{left:{kind:'calc',expr:"len([この列]) > 3 and [区分] <> 'X'"},op:'formula'}],text:'長い',color:''}];
   WL.displayRules.put('__f__',fxRule);
   out.fx=[WL.displayRules.match('__f__',{A:'abcd',区分:'Y'},'A'),WL.displayRules.match('__f__',{A:'ab',区分:'Y'},'A'),
           WL.displayRules.match('__f__',{A:'abcd',区分:'X'},'A')].map(h=>h?h.text:'-').join('/');
   WL.displayRules.put('__f__',null);
   /* 式の列 F（[A] の頭に 'Z'）を、他の列 B のルールが見る。表示の値では F の書式（後ろに「号」）まで見える。 */
   const view={calc:k=>k==='F'?WL.formula.compile("concat('Z',[A])"):null,
               format:k=>k==='F'?{kind:'text',suffix:'号'}:null,rule:()=>''};
   const other=[{conditions:[{left:{kind:'column',column:'F'},op:'startsWith',right:{kind:'value',value:'Z'}}],text:'元',color:''}];
   const shown=[{conditions:[{left:{kind:'column',column:'F'},op:'endsWith',right:{kind:'value',value:'号'}}],text:'表',color:''}];
   WL.displayRules.put('__o__',other,{self:'raw'});WL.displayRules.put('__s__',shown,{self:'shown'});
   const row={A:'1',B:'b'};
   out.raw=WL.cellFormat.cell({raw:'b',format:null,rule:'__o__',row,column:'B',view}).text;
   out.shown=WL.cellFormat.cell({raw:'b',format:null,rule:'__s__',row,column:'B',view}).text;
   out.shownRaw=WL.cellFormat.cell({raw:'b',format:null,rule:'__o__',row:{A:'1',B:'b'},column:'B'}).text;
   WL.displayRules.put('__o__',null);WL.displayRules.put('__s__',null);
   /* 式への変換は**同じ答え**を出す（行の値をいくつも当てて突き合わせる）。 */
   const rule=[
    {conditions:[{left:{kind:'self'},op:'le',right:{kind:'value',value:'300'}},
                 {left:{kind:'column',column:'K'},op:'ne',right:{kind:'value',value:'KEN'}}],text:'機側',color:'ok'},
    {conditions:[{left:{kind:'column',column:'K'},op:'startsWith',right:{kind:'value',value:'4'}}],text:'フロア',color:''},
    {conditions:[{left:{kind:'calc',expr:"contains([この列],'5')"},op:'formula'}],text:"=concat([K],'-')",color:''},
    {conditions:[],text:'他',color:''}];
   const cv=WL.displayRules.toFormula(rule,{column:'W'});
   const f=WL.formula.compile(cv.expr);
   WL.displayRules.put('__c__',rule);
   const rows=[{W:'250',K:'A'},{W:'250',K:'KEN'},{W:'400',K:'42'},{W:'450',K:'X'},{W:'800',K:'Y'},{W:'04',K:'04'}];
   out.conv=rows.map(r=>{const h=WL.displayRules.match('__c__',r,'W');
     const a=h?(WL.displayRules.textOf(h,r,'W')||r.W):r.W, b=String(f.run(r));return a===b?1:`${a}≠${b}`});
   WL.displayRules.put('__c__',null);
   out.notes=cv.notes;out.expr=cv.expr;
   return out;
  });
  rec('式が真なら: 式だけで当たる／当たらないが決まる',r474.fx==='長い/-/-',r474.fx);
  rec('元のデータでも、式の列は式の結果を見る（他の列から）',r474.raw==='元',r474.raw);
  rec('表示の値では、他の列の書式の後の値を見る',r474.shown==='表',r474.shown);
  rec('列の見え方を渡さない画面では今までどおり（元のデータ）',r474.shownRaw==='b',r474.shownRaw);
  rec('ルールを式へ変換すると、どの行でも同じ答えになる',r474.conv.every(x=>x===1),JSON.stringify(r474.conv)+' '+r474.expr);
  rec('式にできない物（色）は注意として言う',r474.notes.some(t=>/色/.test(t)),r474.notes.join('／'));
  /* §9.477: **境目の値**でもルールと変換した式が同じ答え（前: 286組のうち39組が割れた——'04' と 4・
     '1,000' と 1000・右辺が空の「を含む」など。ルールは数を緩く読み、式の`=`は厳しく読むため）。
     右辺が固定値のときと、**他の列**のとき（値が行ごとに変わる）の両方で突き合わせる。 */
  const r477=await page.evaluate(()=>{
   const OPS=['eq','ne','gt','ge','lt','le','between','contains','startsWith','endsWith','empty','notEmpty','regex'];
   const P=[['04','4'],['4','4'],['4.0','4'],['1,000','1000'],[' 5','5'],['010','10'],['-3','2'],['10','9'],['10','9a'],
            ['abc','ABC'],['abc','b'],['abc',''],['','0'],['',''],['a.c','a.c'],['abc','a.c'],['x','['],['+5','5'],['.5','0.5']];
   const bad=[];let n=0;
   for(const op of OPS)for(const [v,w] of P)for(const dyn of [false,true]){
    const cond={left:{kind:'self'},op,right:dyn?{kind:'column',column:'R'}:{kind:'value',value:w}};
    if(op==='between')cond.right2={kind:'value',value:'20'};
    if(op==='empty'||op==='notEmpty')delete cond.right;
    const rule=[{conditions:[cond],text:'Y',color:''},{conditions:[],text:'N',color:''}];
    const row={V:v,R:w};
    WL.displayRules.put('__b__',rule);
    const h=WL.displayRules.match('__b__',row,'V');
    WL.displayRules.put('__b__',null);
    const a=h?h.text:'?';
    let b;try{b=String(WL.formula.compile(WL.displayRules.toFormula(rule,{column:'V'}).expr).run(row))}catch(e){b='ERR'}
    n++;if(a!==b&&!(dyn&&op==='regex'&&w==='['))bad.push(`${op}(${v},${w}${dyn?',列':''}) ${a}/${b}`);
   }
   return {n,bad};
  });
  /* §9.479: 行に全列が載る画面（測定データ一覧・実績データ・操業データの紙）も、列レイアウトの対象から
     `viewOf()`で列の見え方を作って渡す——表示の値が他の列の**書式**と**作り方の式**の後を見る。 */
  const VT='test:viewof:'+Date.now().toString(36);
  await post('/api/column-layout-master',{target:VT,order:['A','B','F'],widths:{},hidden:[],names:{},
   formats:{B:{kind:'text',suffix:'号'}},rules:{},formulas:{F:"concat('Z',[A])"},user_id:'test'});
  const vo=await page.evaluate(async t=>{
   WL.columnLayout.forget(t);await WL.columnLayout.load(t);
   WL.displayRules.put('__v__',[{conditions:[{left:{kind:'column',column:'B'},op:'endsWith',right:{kind:'value',value:'号'}},
     {left:{kind:'column',column:'F'},op:'eq',right:{kind:'value',value:'Z1'}}],text:'表',color:''}],{self:'shown'});
   const row={A:'1',B:'7'};
   const on=WL.cellFormat.cell({raw:'x',format:null,rule:'__v__',row,column:'A',view:WL.cellFormat.viewOf(t)}).text;
   const off=WL.cellFormat.cell({raw:'x',format:null,rule:'__v__',row,column:'A'}).text;
   WL.displayRules.put('__v__',null);
   return {on,off};
  },VT);
  await post('/api/column-layout-master',{target:VT,clear:true,order:[],widths:{},hidden:[],names:{},formats:{},rules:{},user_id:'test'});
  rec('列レイアウトから作った見え方で、表示の値が他の列の書式・作り方の式の後を見る（viewOf）',
      vo.on==='表'&&vo.off==='x',JSON.stringify(vo));
  /* 行に全列が載る3つの画面と列の設定の見本は、どれも見え方を渡している（前: 10箇所中4箇所）。 */
  const calls=await page.evaluate(async()=>{
   const files=['/static/js/report/actuals-view.js','/static/js/report/opsheet-print.js','/static/js/measure/records-store.js',
                '/static/js/list/list-columns.js','/static/js/list/list-view.js','/static/js/schedule/schedule-view.js'];
   let n=0,withView=0;
   for(const f of files){const src=await (await fetch(f)).text();
    const re=/WL\.cellFormat\.cell\(\{[\s\S]*?\}\)/g;let m;
    while((m=re.exec(src))){n++;if(/view/.test(m[0]))withView++}}
   return {n,withView};
  });
  rec('一覧・スケジュール表・測定データ一覧・実績データ・紙・列の設定の見本は、どれも見え方を渡す',
      calls.n>0&&calls.withView===calls.n,JSON.stringify(calls));
  /* §9.478: 表示の値の速さ（実測: 1000行×3列で 元のデータ 0.79µs／表示の値 1.07µs／読み替え付きの式の列を
     見る 2.58µs ／セル。一覧の描き直しは約160msで差は揺れの中）。**重くなる作り直しだけを捕まえる**
     ゆるい上限（30µs＝実測の10倍）——時間の網は余白を大きく取る（§9.426）。 */
  const perf=await page.evaluate(()=>{
   const FX=WL.formula.compile("concat('A',[a])");
   WL.displayRules.put('__pf__',[{conditions:[{left:{kind:'column',column:'F'},op:'startsWith',right:{kind:'value',value:'A'}},
     {left:{kind:'column',column:'b'},op:'ne',right:{kind:'value',value:'z'}}],text:'X',color:''}],{self:'shown'});
   WL.displayRules.put('__pg__',[{conditions:[{left:{kind:'self'},op:'contains',right:{kind:'value',value:'1'}}],text:'Y',color:''}],{self:'shown'});
   const view={calc:k=>(k==='F'?FX:null),format:k=>(k==='b'?{kind:'text',suffix:'号'}:null),rule:k=>(k==='F'?'__pg__':'')};
   const rows=Array.from({length:1000},(_,i)=>({a:String(i),b:String(i%7),c:'c'+i}));
   const s=performance.now();let n=0;
   for(let rep=0;rep<3;rep++)for(const r of rows){WL.cellFormat.cell({raw:r.c,format:null,rule:'__pf__',row:r,column:'c',view});n++}
   const us=(performance.now()-s)/n*1000;
   WL.displayRules.put('__pf__',null);WL.displayRules.put('__pg__',null);
   return +us.toFixed(2);
  });
  rec('表示の値で読み替え付きの式の列を見ても、セル1つあたり30µs未満（実測 2.6µs）',perf<30,`${perf}µs`);
  rec('境目の値でも、ルールと変換した式が同じ答え（固定値・他の列の両方。前: 286組中39組が割れた）',
      r477.bad.length===0,`${r477.n}組 ${r477.bad.slice(0,4).join(' ｜ ')}`);

  await page.evaluate(async a=>{await WL.displayRules.load(true);WL.listRules.open({name:a.rule,column:a.col})},{rule:RULE,col});
  await page.waitForSelector('#listRulePanel:not([hidden])',{timeout:8000});
  const ui=await page.evaluate(()=>{
   const p=document.getElementById('listRulePanel').getBoundingClientRect();
   const t=document.getElementById('lrTry').getBoundingClientRect();
   const k=document.querySelector('#lrRows .lr-kind[data-side="left"]');
   k.value='calc';k.dispatchEvent(new Event('change',{bubbles:true}));
   const c=document.querySelector('#lrRows .lr-cond');
   const vis=[...c.querySelectorAll('select,input,textarea')].filter(e=>e.getBoundingClientRect().width>0);
   return {leftPct:Math.round((t.left-p.left)/p.width*100),wPct:Math.round(t.width/p.width*100),
           tryTop:Math.round(t.top-p.top),n:vis.length,op:!!c.querySelector('.lr-op'),
           mode:[...document.querySelectorAll('#listRulePanel .lr-mode [data-mode]')].map(b=>b.textContent.trim()).join('/')};
  });
  rec('試した結果は窓の左（3割ほど）にいつも見えている',ui.leftPct<=5&&ui.wPct>=24&&ui.wPct<=36&&ui.tryTop<120,JSON.stringify(ui));
  rec('左辺を式にすると、比べ方と右辺を出さない（種類と式の2つだけ）',ui.n===2&&!ui.op,JSON.stringify(ui));
  rec('列の値（元のデータ／表示の値）を選べる',ui.mode==='元のデータ/表示の値',ui.mode);
  const ta=await page.$('#lrRows textarea.lr-expr');
  await ta.click();await page.keyboard.type('ext');
  await W.until(page,()=>!!document.querySelector('.fx-suggest:not([hidden]) [role=option]'),null,{ms:5000,what:'式の候補'});
  const sg=await page.evaluate(()=>[...document.querySelectorAll('.fx-suggest [role=option] b')].map(b=>b.textContent));
  rec('式の欄に打つと関数の候補が出る',sg[0]==='extract',sg.join(','));
  await page.keyboard.press('Enter');
  const after=await page.evaluate(()=>document.querySelector('#lrRows textarea.lr-expr').value);
  rec('候補を選ぶと関数名と ( が入る',after==='extract(',after);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>document.getElementById('lrToFormula').click());
  const fx=await page.evaluate(()=>({out:(document.querySelector('.lr-fx-out')||{}).value||'',
                                     st:(document.querySelector('.lr-fx-state')||{}).textContent||''}));
  rec('「式にする」で同じ意味の式が出る',/^if\(/.test(fx.out),JSON.stringify(fx));
  await page.evaluate(()=>WL.listRules.close());
  /* 「この列の作り方」へ入れる（列の設定から開いたとき）。式の列ならいまの式を括弧で包んで「この列」に使う
     ——作り方へ入れても自分自身を見ない。 */
  const put=await page.evaluate(async a=>{
   window.__got=null;
   WL.displayRules.put(a.rule,[{conditions:[{left:{kind:'self'},op:'eq',right:{kind:'value',value:'00'}}],text:'なし',color:''}]);
   WL.listRules.open({name:a.rule,column:'計算X',selfFormula:"concat([A],'0')",toFormula:e=>{window.__got=e}});
   document.getElementById('lrToFormula').click();
   const b=document.getElementById('lrFxPut');if(b)b.click();
   return {btn:!!b,got:window.__got,open:!document.getElementById('listRulePanel').hidden};
  },{rule:RULE,col});
  rec('「この列の作り方」へ入れると、式の列のいまの式を「この列」として包んだ式が渡る',
      put.btn&&put.got==="if(cmp((concat([A],'0')), '00') = 0, 'なし', (concat([A],'0')))",JSON.stringify(put));
  await page.evaluate(async()=>{WL.listRules.close();await WL.displayRules.load(true)});

  /* ---- 行の中の「または」（利用者の指示「OR条件も追加で組み込めるように」） ----
     前（実測）: 判定 5/12・式への変換 5/12・保存で「または」が消える・窓に選ぶ所が無い。
     `join:'or'`の条件から新しい組。「かつ」を先にまとめる（式の and/or と同じ強さ）。 */
  const orR=await page.evaluate(()=>{
   const sf=(op,v,j)=>Object.assign({left:{kind:'self'},op,right:{kind:'value',value:v}},j?{join:j}:{});
   const kc=(op,v,j)=>Object.assign({left:{kind:'column',column:'K'},op,right:{kind:'value',value:v}},j?{join:j}:{});
   const R3=[{conditions:[sf('eq','1'),sf('eq','2','or'),kc('eq','z')],text:'hit',color:''}];
   const rows=[{W:'1',K:'q'},{W:'2',K:'z'},{W:'2',K:'q'},{W:'3',K:'z'}];
   WL.displayRules.put('__or__',R3);
   const m=rows.map(r=>(WL.displayRules.match('__or__',r,'W')||{}).text||'-');
   WL.displayRules.put('__or__',null);
   const f=WL.formula.compile(WL.displayRules.toFormula(R3,{column:'W'}).expr);
   return {m:m.join('/'),f:rows.map(r=>{const v=String(f.run(r));return v===r.W?'-':v}).join('/')};
  });
  rec('「または」: W=1 または (W=2 かつ K=z) で当たる（かつを先にまとめる）',orR.m==='hit/hit/-/-',orR.m);
  rec('「または」を含むルールも、式へ変換して同じ答え',orR.f===orR.m,`${orR.f} ≠? ${orR.m}`);
  await page.evaluate(async a=>{
   WL.displayRules.put(a.rule,[{conditions:[{left:{kind:'self'},op:'eq',right:{kind:'value',value:'A'}}],text:'あ',color:''}]);
   WL.listRules.open({name:a.rule,column:a.col});
  },{rule:RULE,col});
  await page.waitForSelector('#listRulePanel:not([hidden])',{timeout:8000});
  const orSt=()=>page.evaluate(()=>{const r=document.querySelector('#lrRows .lr-row[data-row="0"]');
   return [...r.querySelectorAll('.lr-cond')].map((c,i)=>i?(c.classList.contains('is-or')?'または':'かつ'):'もし').join(',')});
  await page.click('#lrRows .lr-row[data-row="0"] .lr-cond-add[data-join="or"]');
  await W.until(page,()=>document.querySelectorAll('#lrRows .lr-row[data-row="0"] .lr-cond').length===2,null,{ms:4000,what:'「＋ または」で条件が増える'});
  await page.click('#lrRows .lr-row[data-row="0"] .lr-cond-add[data-join="and"]');
  await W.until(page,()=>document.querySelectorAll('#lrRows .lr-row[data-row="0"] .lr-cond').length===3,null,{ms:4000,what:'「＋ かつ」で条件が増える'});
  const orUi1=await orSt();
  rec('窓で「＋ または」「＋ かつ」を足せ、組の頭に区切りが付く',orUi1==='もし,または,かつ',orUi1);
  const fitJ=await page.evaluate(()=>{const s=document.querySelector('#lrRows .lr-join');const c=document.createElement('canvas').getContext('2d');
   const cs=getComputedStyle(s);c.font=`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
   return {w:s.getBoundingClientRect().width,need:c.measureText('または').width+parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight)+14}});
  rec('つなぎ方の選びに「または」が切れずに入る',fitJ.w>=fitJ.need,JSON.stringify(fitJ));
  /* 組の頭（または）を消すと、同じ組の次の条件が頭を継ぐ（前の組へ「かつ」でつながらない）。 */
  await page.click('#lrRows .lr-row[data-row="0"] .lr-cond-del[data-cond="1"]');
  await W.until(page,()=>document.querySelectorAll('#lrRows .lr-row[data-row="0"] .lr-cond').length===2,null,{ms:4000,what:'組の頭を消す'});
  const orUi2=await orSt();
  rec('組の頭を消すと、次の条件が「または」を継ぐ',orUi2==='もし,または',orUi2);
  await page.evaluate(()=>WL.listRules.close());

  /* ---- かっこ（利用者の指示「かっこも入れられるようにしたい。使いやすいUIで」） ----
     前（実測）: 判定 7/12・式への変換 7/12・かっこの中の列を見ない・保存で形が崩れる・窓に作る所が無い。 */
  const pr=await page.evaluate(()=>{
   const sf=(op,v,j)=>Object.assign({left:{kind:'self'},op,right:{kind:'value',value:v}},j?{join:j}:{});
   const kc=(op,v,j)=>Object.assign({left:{kind:'column',column:'K'},op,right:{kind:'value',value:v}},j?{join:j}:{});
   const P2=[{conditions:[{kind:'group',conditions:[sf('eq','1'),sf('eq','2','or')]},{kind:'group',conditions:[kc('eq','x'),kc('eq','y','or')]}],text:'hit',color:''}];
   const rows=[{W:'1',K:'x'},{W:'2',K:'y'},{W:'3',K:'x'},{W:'1',K:'z'}];
   WL.displayRules.put('__pr__',P2);
   const m=rows.map(r=>(WL.displayRules.match('__pr__',r,'W')||{}).text||'-').join('/');
   const cols=WL.displayRules.columnsUsed('__pr__').join(',');
   WL.displayRules.put('__pr__',null);
   const f=WL.formula.compile(WL.displayRules.toFormula(P2,{column:'W'}).expr);
   return {m,cols,f:rows.map(r=>{const v=String(f.run(r));return v===r.W?'-':v}).join('/')};
  });
  rec('かっこ: (W=1 または W=2) かつ (K=x または K=y)',pr.m==='hit/hit/-/-',pr.m);
  rec('かっこを含むルールも、式へ変換して同じ答え',pr.f===pr.m,`${pr.f} ≠? ${pr.m}`);
  rec('かっこの中が見る列も数える',pr.cols==='K',pr.cols);
  await page.evaluate(async a=>{
   WL.displayRules.put(a.rule,[{conditions:[{left:{kind:'self'},op:'notEmpty'}],text:'あ',color:''}]);
   WL.listRules.open({name:a.rule,column:a.col});
  },{rule:RULE,col});
  await page.waitForSelector('#listRulePanel:not([hidden])',{timeout:8000});
  const shape=()=>page.evaluate(()=>{const walk=el=>[...el.children].map(c=>c.classList.contains('lr-group')
     ?`${c.classList.contains('is-or')?'または':'かつ'}(${walk(c.querySelector('.lr-group-body')).join(' ')})`
     :c.classList.contains('lr-cond')?(c.classList.contains('is-or')?'または':'条件'):'?');
    return walk(document.querySelector('#lrRows .lr-row[data-row="0"] .lr-row-conds')).join(' ')});
  const step=async(sel,want)=>{await page.click(sel);await W.until(page,w=>document.querySelectorAll('#lrRows .lr-row[data-row="0"] .lr-cond,#lrRows .lr-row[data-row="0"] .lr-group').length===w,want,{ms:4000,what:sel})};
  await step('#lrRows .lr-row[data-row="0"] .lr-row-then .lr-cond-add[data-kind="group"]',3);
  await step('#lrRows .lr-group[data-depth="1"] > .lr-group-foot .lr-cond-add[data-join="or"]',4);
  await step('#lrRows .lr-group[data-depth="1"] > .lr-group-foot .lr-cond-add[data-kind="group"]',6);
  const pUi=await shape();
  rec('窓でかっこを足し、中に「または」とかっこ（2段）を置ける',pUi==='条件 かつ(条件 または かつ(条件))',pUi);
  const lead=await page.evaluate(()=>document.querySelector('#lrRows .lr-group-body > .lr-cond .lr-conj')?.textContent.trim());
  rec('かっこの中の1つ目は「（」と読む（「もし」と書かない）',lead==='（',lead);
  rec('2段より深いかっこは足せない（ボタンを出さない）',
      await page.evaluate(()=>document.querySelectorAll('#lrRows .lr-group[data-depth="2"] .lr-cond-add[data-kind="group"]').length===0));
  await step('#lrRows .lr-group[data-depth="2"] .lr-cond .lr-cond-del',4);
  rec('かっこの中の最後の1つを消すと、かっこごと消える',(await shape())==='条件 かつ(条件 または)',await shape());
  await step('#lrRows .lr-group[data-depth="1"] .lr-group-unwrap',3);
  rec('かっこを外すと、中の条件がその場に並ぶ',(await shape())==='条件 条件 または',await shape());
  await page.evaluate(()=>WL.listRules.close());

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));

  await cleanup();
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
  await cleanup();
 }
}, {viewport:{width:1600,height:950}});
