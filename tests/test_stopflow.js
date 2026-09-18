/* test_stopflow.js: 設備停止を入れる画面（§9.389 → §9.397で組み直し）
   ------------------------------------------------------------
   §9.389 の指示「設備停止内容(サブカテゴリがある設備停止はそのあとサブ
   カテゴリも選択)を選択し、その後時間を選択して登録するようにしたいです」
   §9.397 の指示「内訳は1つしかない場合はそれを既定に。2つ以上あっても既定の
   ものを設定して登録できるようにしてください」
   §9.397 の指示「小さくてわかりにくく使いづらい、ステップが多い印象もある…
   整列された印象もほしく、より直感的に、考えなくてもわかるくらいに」

   §9.402 の指示「停止内容を上から下まで伸ばし、時間は2/3幅に縮小、停止内容は
   一番左、クリックしたら既定で基本的には確定」「時間欄はコンパクトに上部に
   まとめて」「決定ボタンはもっと小さくても大丈夫」
   → **左＝停止内容（全高）／右上＝カード／右下＝内訳の列＋いま入れた**。

   固定すること:
    1. **一覧と設定が同時に見える**（左＝停止内容／右＝カードと列）。
       押しても一覧は消えない＝「戻る」を覚えなくてよい
    2. 内訳が**1件なら最初から選ばれている**（そのまま追加できる）
    3. 内訳が**2件以上でも、既定の印がある行が最初から選ばれている**
    4. 既定が無いときは**選ぶまで追加できない**（押せないボタンには理由を書く）
    5. 内訳を選ぶと、**その内訳の標準所要分**が時間として選ばれる
       （**出どころも字で出る**）
    6. 下を持つ内訳を選ぶと**行がもう1つ増える**／1段目を選び直すと2段目は捨てる
    7. 時間は**目盛り**（§9.402）。目盛りの顔ぶれは時間マスタの選択肢そのもの
       で、押せば決まる。目盛りに無い分は「その他の分…」で打てて、**打った分は
       目盛りに1本足して**そこへつまみが立つ。手で触ったら、内訳を選び直しても
       勝手に戻さない
    8. 追加すると **[予定名称]は停止内容の名前のまま**で、内訳は明細に入る
       （＝集計は名称で束ねたまま、内訳で割れる・利用者の狙いそのもの）
    9. 予定の行に**内訳の札**が出る（題名は名前のまま）  */
const H=require('./lib/harness.js');
const TAG='FLW'+Date.now().toString().slice(-6);
const EQ='テスト設備A';
const SNAP=['設備停止マスタ','設備停止サブカテゴリマスタ','設備停止時間マスタ','設備停止分類マスタ'];

H.run('test_stopflow: 設備停止を入れる画面（§9.397）',async({page,rec,B,W:WW,idle,setMode})=>{
 const snap=await H.masterSnapshot(SNAP);
 const api=(path,body)=>page.evaluate(async a=>{
  const r=await fetch(a.path,a.body?{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({user_id:'test-stopflow'},a.body))}:undefined);
  let j={};try{j=await r.json()}catch(e){j={}}
  return j;
 },{path,body});
 const plan=()=>fetch(B+'/api/schedule/plan?equipment='+encodeURIComponent(EQ))
   .then(r=>r.json()).then(j=>j.entries||[]);

 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await WW.booted(page); await idle();

 const NAME=TAG+'刃組待ち';
 const ONE=TAG+'定期点検';
 const stop=await api('/api/schedule/stop-reason-master',
   {equipment:EQ,name:NAME,category:'待ち',standardMinutes:60});
 const ring=await api('/api/schedule/stop-sub-master',{stopReasonId:stop.id,name:'ゴムリング'});
 await api('/api/schedule/stop-sub-master',{stopReasonId:stop.id,name:'刃出し',standardMinutes:90});
 /* もう1階層（§9.390）。「ゴムリング」の下にだけ2段目を置く——**下を持つ
    内訳と持たない内訳が混ざった状態**が、行の増え方を確かめる材料になる。 */
 await api('/api/schedule/stop-sub-master',{stopReasonId:stop.id,name:'交換',parentSubId:ring.id,standardMinutes:20});
 await api('/api/schedule/stop-sub-master',{stopReasonId:stop.id,name:'増し締め',parentSubId:ring.id});
 /* 内訳が**1件だけ**の停止内容（§9.397 ②）。「1つしかないなら既定」は
    印を付けなくても効く——印の付け忘れで「選んでください」と出す画面に
    しないため。 */
 const one=await api('/api/schedule/stop-reason-master',
   {equipment:EQ,name:ONE,category:'保全',standardMinutes:30});
 await api('/api/schedule/stop-sub-master',{stopReasonId:one.id,name:'日常点検',standardMinutes:15});
 rec('材料（内訳2件＋その下に2件／内訳1件の停止）を作れた',
     !!stop.id&&!!ring.id&&!!one.id,`${stop.id}/${ring.id}/${one.id}`);

 /* **浮き窓から開く**（`#scStopModalBtn`）。側パネルは畳まれていることが
    あり、DOMに在るだけのボタンは押せない（実測: `page.click`が30秒で落ちた）。
    器は同じ`#scStopButtons`なので、見るものは変わらない（§9.13）。 */
 await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
 await page.reload({waitUntil:'domcontentloaded'});
 await WW.booted(page);
 await WW.openSchedule(page,EQ,{rows:false});
 await page.click('#scStopModalBtn');
 await page.waitForSelector('#scStopModal:not([hidden])',{timeout:10000});
 await page.waitForSelector(`.sc-stop-button[data-id="${stop.id}"]`,{state:'visible',timeout:20000});

 // ---- ① 一覧と設定が同時に見える（§9.397） ---------------------------
 const before=await page.evaluate(()=>({
  empty:(document.querySelector('.sc-sc.is-empty')||{}).textContent||'',
  list:document.querySelectorAll('.sc-stop-button').length}));
 rec('選ぶ前のカードは「ここに何が出るか」だけを言う（§9.343）',
     /停止内容を選び/.test(before.empty),before.empty.replace(/\s+/g,' ').slice(0,60));
 await page.click(`.sc-stop-button[data-id="${stop.id}"]`);
 await page.waitForSelector('.sc-sc:not(.is-empty)',{timeout:10000});
 /* 内訳の列＝「いま入れた」を除いた列。見出しで数える（§9.402）。 */
 const subNames=()=>page.evaluate(()=>{
  const col=[...document.querySelectorAll('#scStopCols .sc-sl')]
    .find(c=>/^内訳$/.test((c.querySelector('.sc-sl-h b')||{}).textContent||''));
  return col?[...col.querySelectorAll('.sc-sl-cell')].map(e=>e.textContent.trim()):[];
 });
 const s1=await page.evaluate(()=>({
  what:(document.querySelector('.sc-sc-what')||{}).textContent||'',
  cols:(document.getElementById('scStopCols')||{}).dataset.cols,
  min:(document.querySelector('.sc-sc-val')||{}).textContent||'',
  ticks:document.querySelectorAll('.sc-sc-tick').length,
  go:(document.querySelector('#scSpGo')||{}).textContent||'',
  goOff:!!(document.querySelector('#scSpGo')||{}).disabled,
  list:document.querySelectorAll('.sc-stop-button').length,
  on:[...document.querySelectorAll('.sc-stop-button.is-on')].length,
  note:(document.querySelector('.sc-sc-where')||{}).textContent.replace(/\s+/g,' ').trim(),
 }));
 s1.subs=await subNames();
 rec('押しても一覧は消えない（上下に並ぶ＝戻る道を覚えなくてよい）',
     s1.list===before.list&&s1.on===1,`一覧${s1.list}件 / 選択中${s1.on}件`);
 rec('決めることは「内訳の列」と「時間の目盛り」の2つ',
     s1.cols==='2'&&s1.ticks>0&&s1.min!=='',`列${s1.cols} / 目盛り${s1.ticks} / 分${s1.min}`);
 rec('内訳のマスが2つ出る',
     s1.subs.map(t=>t.replace(/[0-9›既定].*/,'').trim()).join('/')==='ゴムリング/刃出し',
     s1.subs.join('/'));
 rec('下を持つ内訳には「›」が出る（押す前に段が増えると分かる）',
     /ゴムリング.*›/.test(s1.subs[0]||''),s1.subs.join('/'));
 rec('既定の無い内訳2件では、選ぶまで追加できない（理由をボタンの字で言う）',
     s1.goOff&&s1.go.includes('内訳を選んでください'),`${s1.go} off=${s1.goOff}`);
 rec('時間の出どころを字で出す（§CLAUDE 6）',
     /標準所要分|選択肢|手で変えた/.test(s1.note),s1.note.slice(0,90));
 /* **次にすることは必ず見えている**（§CLAUDE 2）。時間の札は選択肢の数だけ
    折り返すので、器が低いと「追加」がスクロールの外へ出る——実際に出た
    （窓560px・札が4段）。スクロールするのは決めることの並びだけにしてある。 */
 const goSeen=await page.evaluate(()=>{
  const go=document.getElementById('scSpGo'),box=document.getElementById('scStopCard');
  if(!go||!box)return null;
  const g=go.getBoundingClientRect(),b=box.getBoundingClientRect();
  return {下:Math.round(g.bottom-b.bottom),高さ:Math.round(g.height)};
 });
 rec('「追加」は器の中に必ず見えている（スクロールの外へ出ない）',
     !!goSeen&&goSeen.下<=1&&goSeen.高さ>0,JSON.stringify(goSeen));

 // ---- ② 内訳が1件なら、最初から選ばれている（§9.397 ③） ---------------
 await page.click(`.sc-stop-button[data-id="${one.id}"]`);
 await page.waitForFunction(()=>/定期点検/.test((document.querySelector('.sc-sc-what')||{}).textContent||''),
   null,{timeout:8000});
 const s2=await page.evaluate(()=>({
   on:(document.querySelector('#scStopCols .sc-sl-cell.is-on')||{}).textContent||'',
   def:document.querySelectorAll('#scStopCols .sc-sl-def').length,
   what:(document.querySelector('.sc-sc-what')||{}).textContent||'',
   val:(document.querySelector('.sc-sc-val')||{}).textContent||'',
   go:(document.querySelector('#scSpGo')||{}).textContent||'',
   goOff:!!(document.querySelector('#scSpGo')||{}).disabled}));
 rec('内訳が1件なら最初から選ばれている（そのまま追加できる）',
     !s2.goOff&&/日常点検/.test(s2.on),JSON.stringify(s2));
 rec('なぜ選ばれているのかを「既定」の字で言う（推測させない）',s2.def>=1,`${s2.def}枚`);
 /* カードの見出しが**いま入るもの**そのもの（§9.402。入る先は追加ボタンの字）。 */
 rec('カードの見出しが「入るもの」そのもの（内訳まで読める）',
     /定期点検（日常点検）/.test(s2.what)&&/15分/.test(s2.val),`${s2.what} / ${s2.val}`);
 rec('追加ボタンの字に入る先が入っている',/へ追加$/.test(s2.go.trim()),s2.go);

 // ---- ③ 2件以上でも、既定の印を付ければ最初から選ばれる（§9.397 ③） ----
 const subs=await (await fetch(B+'/api/schedule/stop-sub-master')).json();
 const edge=(subs.items||[]).find(x=>Number(x.stopReasonId)===Number(stop.id)&&x.name==='刃出し');
 await api('/api/schedule/stop-sub-master/update',
   {id:edge.id,stopReasonId:stop.id,name:'刃出し',standardMinutes:90,parentSubId:0,isDefault:true});
 /* **画面は取り直してから見る**——既定はサーバーが答える（§9.163）ので、
    取り直さない画面には届かない。 */
 await page.evaluate(()=>WL.scheduleView.reloadStopReasons());
 await page.waitForFunction(id=>!!document.querySelector('.sc-stop-button[data-id="'+id+'"]'),
   stop.id,{timeout:8000});
 await page.click(`.sc-stop-button[data-id="${stop.id}"]`);
 await page.waitForFunction(()=>!!document.querySelector('#scStopCols .sc-sl-cell.is-on'),
   null,{timeout:8000});
 const s3=await page.evaluate(()=>({
   on:(document.querySelector('#scStopCols .sc-sl-cell.is-on')||{}).textContent||'',
   goOff:!!(document.querySelector('#scSpGo')||{}).disabled,
   val:(document.querySelector('.sc-sc-val')||{}).textContent||''}));
 rec('内訳が2件以上でも、既定の印を付けた行が最初から選ばれる',
     !s3.goOff&&/刃出し/.test(s3.on),JSON.stringify(s3));
 rec('その内訳の標準所要分（90分）が時間に入る',/90/.test(s3.val),s3.val);

 // ---- ④ 下を持つ内訳を選ぶと行が増える／選び直すと捨てる（§9.390） ------
 /* 内訳は**列のマス**（§9.402）。名前で押して、押した物が`is-on`になるまで待つ。 */
 const pickSub=async(name)=>{
  await page.evaluate(n=>{
   const b=[...document.querySelectorAll('#scStopCols .sc-sl-cell')]
     .find(x=>x.textContent.includes(n));
   if(b)b.click();
  },name);
  await page.waitForFunction(n=>[...document.querySelectorAll('#scStopCols .sc-sl-cell.is-on')]
    .some(x=>x.textContent.includes(n)),name,{timeout:8000})
   .catch(e=>{throw new Error(`内訳「${name}」を選べない: `+e.message.slice(0,50))});
 };
 await pickSub('ゴムリング');
 await page.waitForFunction(()=>(document.getElementById('scStopCols')||{}).dataset.cols==='3',
   null,{timeout:8000})
   .catch(e=>{throw new Error('④-1 2段目の列が出ない: '+e.message.slice(0,60))});
 const s4=await page.evaluate(()=>{
  const heads=[...document.querySelectorAll('#scStopCols .sc-sl-h b')].map(e=>e.textContent.trim());
  const col=[...document.querySelectorAll('#scStopCols .sc-sl')]
    .find(c=>/の内訳$/.test((c.querySelector('.sc-sl-h b')||{}).textContent||''));
  return {cols:(document.getElementById('scStopCols')||{}).dataset.cols,heads,
   label2:heads.find(t=>/の内訳$/.test(t))||'',
   kids:col?[...col.querySelectorAll('.sc-sl-cell')]
     .map(e=>e.textContent.replace(/[0-9分›既定]/g,'').trim()):[],
   go:(document.querySelector('#scSpGo')||{}).textContent||'',
   goOff:!!(document.querySelector('#scSpGo')||{}).disabled};
 });
 rec('下を持つ内訳を選ぶと列がもう1本増え、その見出しは親の名前',
     s4.cols==='3'&&/ゴムリング/.test(s4.label2),`${s4.cols}列 / ${s4.label2}`);
 rec('2段目のマスが2つ出る',s4.kids.join('/')==='交換/増し締め',s4.kids.join('/'));
 rec('2段目に既定が無ければ、選ぶまで追加できない',
     s4.goOff&&/ゴムリング/.test(s4.go),`${s4.go} off=${s4.goOff}`);
 await pickSub('交換');
 await page.waitForFunction(()=>!(document.querySelector('#scSpGo')||{}).disabled,null,{timeout:8000})
   .catch(e=>{throw new Error('④-2 2段目を選んでも押せない: '+e.message.slice(0,60))});
 rec('2段目の標準所要分（20分）が時間に入る',
     /20分/.test(await page.evaluate(()=>(document.querySelector('.sc-sc-val')||{}).textContent||'')),
     await page.evaluate(()=>(document.querySelector('.sc-sc-val')||{}).textContent||''));
 await pickSub('刃出し');
 await page.waitForFunction(()=>(document.getElementById('scStopCols')||{}).dataset.cols==='2',
   null,{timeout:8000})
   .catch(e=>{throw new Error('④-3 2段目の列が消えない: '+e.message.slice(0,60))});
 rec('1段目を選び直すと2段目の列ごと消える',true);

 // ---- ⑤ 時間の目盛りと「その他の分…」（§9.402） -----------------------
 /* 目盛りの顔ぶれは**時間マスタの選択肢そのもの**。押せば決まる。 */
 const ticks0=await page.evaluate(()=>
   [...document.querySelectorAll('.sc-sc-tick')].map(e=>Number(e.dataset.min)));
 const opts=await (await fetch(B+'/api/schedule/stop-minutes-master')).json()
   .then(j=>(j.items||[]).map(x=>Number(x.minutes)).filter(n=>n>0).sort((a,b)=>a-b));
 rec('目盛りは時間マスタの選択肢そのもの（画面が値を作らない）',
     ticks0.join(',')===opts.join(','),`画面 ${ticks0.join(',')} / マスタ ${opts.join(',')}`);
 const tapped=await page.evaluate(()=>{
  const b=[...document.querySelectorAll('.sc-sc-tick')].find(x=>!x.classList.contains('is-on'));
  const want=b?Number(b.dataset.min):null;
  if(b)b.click();
  return want;
 });
 await page.waitForFunction(m=>((document.querySelector('.sc-sc-val')||{}).textContent||'')
   .includes(String(m)),tapped,{timeout:8000})
  .catch(e=>{throw new Error('⑤-1 目盛りを押しても値が変わらない: '+e.message.slice(0,60))});
 rec('目盛りを押すとその分になる',true,`${tapped}分`);
 /* **目盛りに無い分は「その他の分…」で打つ**（窓は`promptModal`の1枚）。
    打った分は**目盛りに1本足して**そこへつまみが立つ（宙に浮かせない）。 */
 await page.click('#scSpOther');
 await WW.answerPrompt(page,'37');
 await page.waitForFunction(()=>((document.querySelector('.sc-sc-val')||{}).textContent||'')
   .includes('37'),null,{timeout:8000})
  .catch(e=>{throw new Error('⑤-2 打った分が入らない: '+e.message.slice(0,60))});
 const free=await page.evaluate(()=>({
   ticks:[...document.querySelectorAll('.sc-sc-tick')].map(e=>Number(e.dataset.min)),
   on:Number((document.querySelector('.sc-sc-tick.is-on')||{}).dataset?.min),
   free:[...document.querySelectorAll('.sc-sc-tick.is-free')].map(e=>Number(e.dataset.min)),
   thumb:!!document.querySelector('.sc-sc-tick.is-on .sc-sc-thumb')}));
 rec('目盛りに無い分は「その他の分…」で打てる（目盛りに1本足してつまみを立てる）',
     free.on===37&&free.free.join(',')==='37'&&free.thumb&&free.ticks.includes(37),
     JSON.stringify(free));
 await pickSub('ゴムリング');
 const s5=await page.evaluate(()=>(document.querySelector('.sc-sc-val')||{}).textContent||'');
 rec('手で触った時間は、内訳を選び直しても勝手に戻さない',
     /37/.test(s5),s5);

 // ---- ⑥⑦ 追加すると名称はそのまま・内訳は明細・行に札 ------------------
 await pickSub('交換');
 await page.waitForFunction(()=>!(document.querySelector('#scSpGo')||{}).disabled,null,{timeout:8000})
   .catch(e=>{throw new Error('⑥ 2段目を選んでも押せない: '+e.message.slice(0,60))});
 await page.click('#scSpOther');
 await WW.answerPrompt(page,'30');
 await page.waitForFunction(()=>((document.querySelector('.sc-sc-val')||{}).textContent||'')
   .includes('30'),null,{timeout:8000});
 const goTxt=await page.evaluate(()=>(document.querySelector('.sc-sc-what')||{}).textContent||''
   +' / '+((document.querySelector('.sc-sc-val')||{}).textContent||''));
 rec('打った分がそのまま入る',
     /30/.test(await page.evaluate(()=>(document.querySelector('.sc-sc-val')||{}).textContent||'')),
     goTxt);
 await page.click('#scSpGo');
 const after=await WW.poll(plan,es=>es.some(e=>e.kind==='設備停止'&&e.title===NAME),20000);
 const added=after.find(e=>e.kind==='設備停止'&&e.title===NAME);
 rec('[予定名称]は停止内容の名前のまま（集計は名称で束ねられる）',
     !!added&&added.title===NAME,added&&added.title);
 rec('内訳は明細に入る（名称を割らない）',
     !!added&&(added.detail||{}).stopSub==='ゴムリング',JSON.stringify(added&&added.detail));
 rec('2段目も明細に入る（stopSub＝1段目／stopSub2＝2段目・§9.390）',
     !!added&&(added.detail||{}).stopSub2==='交換',JSON.stringify(added&&added.detail));
 rec('選んだ時間が見積になる',!!added&&Number((added.estimate||{}).minutes)===30,
     JSON.stringify(added&&added.estimate));
 await page.waitForFunction(n=>[...document.querySelectorAll('.sc-row-nonwork')]
   .some(x=>x.textContent.includes(n)&&x.querySelector('.sc-nw-sub')),NAME,{timeout:15000});
 const row=await page.evaluate(n=>{
  const el=[...document.querySelectorAll('.sc-row-nonwork')].find(x=>x.textContent.includes(n));
  const sub=el&&el.querySelector('.sc-nw-sub');
  return {sub:sub?sub.textContent.trim():'',title:el?el.getAttribute('title'):''};
 },NAME);
 rec('予定の行の札は「1段目 / 2段目」の1枚（§9.390）',
     row.sub==='ゴムリング / 交換',JSON.stringify(row).slice(0,140));
 rec('題名そのものは名前のまま（札は別の物）',
     (row.title||'').startsWith(NAME),String(row.title).slice(0,60));

 // ---- ⑧ 入れたものは「いま入れた」に並び、取り消せる（§9.402） ----------
 /* 「続けて入れる」が入なので、**入れても選んだまま**（選び直しから
    始まらない）。入れたものは右下の列に並び、窓を閉じるまで取り消せる。 */
 const added8=await page.evaluate(()=>({
   hits:[...document.querySelectorAll('.sc-sl-hit b')].map(e=>e.textContent.trim()),
   foot:(()=>{const f=[...document.querySelectorAll('.sc-sl-f')]
     .find(e=>/合計/.test(e.textContent));return f?f.textContent.replace(/\s+/g,' ').trim():''})(),
   mine:(document.querySelector('.sc-stop-mine')||{}).textContent||'',
   still:!!document.querySelector('#scSpGo'),
   undo:document.querySelectorAll('.sc-sl-undo').length}));
 rec('入れたものが「いま入れた」に並ぶ（合計も出る）',
     added8.hits.length===1&&/合計/.test(added8.foot)&&added8.undo===1,
     JSON.stringify(added8));
 rec('「続けて入れる」が入なら、入れても選んだまま（選び直しから始まらない）',
     added8.still===true,String(added8.still));
 rec('左の一覧にも「この窓で入れた件数」が字で出る（§CLAUDE 3）',
     added8.mine==='1件',added8.mine);
 /* **取り消しは`removeEntries()`の1本**（§9.399）。1件だけなので窓は出ない。 */
 await page.waitForFunction(()=>!(WL.scheduleView.entries()||[])
   .some(e=>e.kind==='設備停止'&&e.__pending),null,{timeout:20000});
 /* **外す道は`removeEntries()`の1本**（§9.399）なので、1件でも確認の窓が
    出る——入れた直後でも「消す」は消す（§CLAUDE 5）。窓に答えてから見る。 */
 await page.click('.sc-sl-undo');
 await WW.answerConfirm(page);
 const gone=await WW.poll(plan,es=>!es.some(e=>e.kind==='設備停止'&&e.title===NAME),20000);
 rec('「取り消す」で予定から外れる',
     !gone.some(e=>e.kind==='設備停止'&&e.title===NAME),
     gone.filter(e=>e.title===NAME).length+'件残り');
 await page.waitForFunction(()=>!document.querySelector('.sc-sl-hit'),null,{timeout:8000})
   .catch(e=>{throw new Error('⑧ 取り消したのに控えが残る: '+e.message.slice(0,60))});
 rec('取り消したら控えからも消える',true);

 // ---- 後片付け --------------------------------------------------------
 for(const e of (await plan()).filter(x=>x.kind==='設備停止'&&x.title===NAME)){
  await fetch(B+'/api/schedule/plan/delete',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:e.id,user_id:'test-stopflow'})}).catch(()=>{});
 }
 /* **マスタを消す前に編集モードへ戻す**（§9.362 ⑤の追補）。素の表の書込は
    `master_tables`のBlueprint＝editモードだけなので、scheduleモードのまま
    消しにいくと**403で黙って弾かれる**——`dropNewMasterRows`は失敗しても
    件数を数えるので、「消した」と報告しながら3行残っていた（実測）。 */
 await setMode('edit');
 await H.dropNewMasterRows(snap);
 let rest=0;
 for(const [t,ids] of await H.masterSnapshot(SNAP))
  rest+=[...ids].filter(i=>!snap.get(t).has(i)).length;
 rec('後片付けで増やした行が1つも残っていない',rest===0,`${rest}行残り`);
 const left=await plan();
 rec('置いた予定も消した',!left.some(e=>e.title===NAME),
     left.filter(e=>e.title===NAME).length+'件残り');
},{mode:'schedule',viewport:{width:1700,height:1000}});
