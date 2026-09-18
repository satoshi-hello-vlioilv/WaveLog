/* test_stopflow.js: 設備停止を入れる画面（§9.389 → §9.397で組み直し）
   ------------------------------------------------------------
   §9.389 の指示「設備停止内容(サブカテゴリがある設備停止はそのあとサブ
   カテゴリも選択)を選択し、その後時間を選択して登録するようにしたいです」
   §9.397 の指示「内訳は1つしかない場合はそれを既定に。2つ以上あっても既定の
   ものを設定して登録できるようにしてください」
   §9.397 の指示「小さくてわかりにくく使いづらい、ステップが多い印象もある…
   整列された印象もほしく、より直感的に、考えなくてもわかるくらいに」

   §9.400 の指示「もっとすっきり使いやすいデザインでUIUX検討してください」
   → 案Bを選択。**上＝一覧（2列）／下＝決める帯（1本）**へ組み直した。

   固定すること:
    1. **一覧と帯が同時に見える**（上＝停止内容の2列／下＝内訳・時間の帯）。
       押しても一覧は消えない＝「戻る」を覚えなくてよい
    2. 内訳が**1件なら最初から選ばれている**（そのまま追加できる）
    3. 内訳が**2件以上でも、既定の印がある行が最初から選ばれている**
    4. 既定が無いときは**選ぶまで追加できない**（押せないボタンには理由を書く）
    5. 内訳を選ぶと、**その内訳の標準所要分**が時間として選ばれる
       （**出どころも字で出る**）
    6. 下を持つ内訳を選ぶと**行がもう1つ増える**／1段目を選び直すと2段目は捨てる
    7. 時間は**「− 数 ＋」の1組**（§9.247・§9.400）。`−`／`＋`は時間マスタの
       選択肢を送り、間の分は打てば入る。手で触ったら、内訳を選び直しても
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
  empty:(document.querySelector('.sc-sb.is-empty')||{}).textContent||'',
  list:document.querySelectorAll('.sc-stop-button').length}));
 rec('選ぶ前の帯は「ここに何が出るか」だけを言う（§9.343）',
     /停止内容を選び/.test(before.empty),before.empty.replace(/\s+/g,' ').slice(0,60));
 await page.click(`.sc-stop-button[data-id="${stop.id}"]`);
 await page.waitForSelector('.sc-sb:not(.is-empty)',{timeout:10000});
 const s1=await page.evaluate(()=>({
  what:(document.querySelector('.sc-sb-what')||{}).textContent||'',
  sels:document.querySelectorAll('.sc-sb-sel').length,
  subs:[...((document.getElementById('scSbSub')||{}).options||[])].slice(1).map(x=>x.textContent.trim()),
  min:(document.getElementById('scSbMinutes')||{}).value,
  steps:document.querySelectorAll('[data-sb-step]').length,
  go:(document.querySelector('#scSpGo')||{}).textContent||'',
  goOff:!!(document.querySelector('#scSpGo')||{}).disabled,
  list:document.querySelectorAll('.sc-stop-button').length,
  on:[...document.querySelectorAll('.sc-stop-button.is-on')].length,
  note:(document.querySelector('.sc-sb-note')||{}).textContent.replace(/\s+/g,' ').trim(),
 }));
 rec('押しても一覧は消えない（上下に並ぶ＝戻る道を覚えなくてよい）',
     s1.list===before.list&&s1.on===1,`一覧${s1.list}件 / 選択中${s1.on}件`);
 rec('決めることは「内訳」と「時間」の2つ（帯は内訳の選択肢＋「− 数 ＋」の1組）',
     s1.sels===1&&s1.steps===2&&s1.min!=='',`選択肢${s1.sels} / ステップ${s1.steps} / 分${s1.min}`);
 rec('内訳の札が2つ出る',
     s1.subs.map(t=>t.replace(/（.*/,'')).join('/')==='ゴムリング/刃出し',s1.subs.join('/'));
 rec('下を持つ内訳には「＋N」の印が出る（押す前に段が増えると分かる）',
     /ゴムリング（＋2）/.test(s1.subs.join('/')),s1.subs.join('/'));
 rec('既定の無い内訳2件では、選ぶまで追加できない（理由をボタンの字で言う）',
     s1.goOff&&s1.go.includes('内訳を選んでください'),`${s1.go} off=${s1.goOff}`);
 rec('時間の出どころを字で出す（§CLAUDE 6）',
     /標準所要分|選択肢/.test(s1.note),s1.note.slice(0,90));
 /* **次にすることは必ず見えている**（§CLAUDE 2）。時間の札は選択肢の数だけ
    折り返すので、器が低いと「追加」がスクロールの外へ出る——実際に出た
    （窓560px・札が4段）。スクロールするのは決めることの並びだけにしてある。 */
 const goSeen=await page.evaluate(()=>{
  const go=document.getElementById('scSpGo'),box=document.getElementById('scStopBar');
  if(!go||!box)return null;
  const g=go.getBoundingClientRect(),b=box.getBoundingClientRect();
  return {下:Math.round(g.bottom-b.bottom),高さ:Math.round(g.height)};
 });
 rec('「追加」は器の中に必ず見えている（スクロールの外へ出ない）',
     !!goSeen&&goSeen.下<=1&&goSeen.高さ>0,JSON.stringify(goSeen));

 // ---- ② 内訳が1件なら、最初から選ばれている（§9.397 ③） ---------------
 await page.click(`.sc-stop-button[data-id="${one.id}"]`);
 await page.waitForFunction(()=>/定期点検/.test((document.querySelector('.sc-sb-what')||{}).textContent||''),
   null,{timeout:8000});
 const s2=await page.evaluate(()=>{
  const sel=document.getElementById('scSbSub');
  const cur=sel&&sel.options[sel.selectedIndex];
  return {on:cur?cur.textContent.trim():'',
   def:[...((sel||{}).options||[])].filter(o=>/既定/.test(o.textContent)).length,
   go:(document.querySelector('#scSpGo')||{}).textContent||'',
   goOff:!!(document.querySelector('#scSpGo')||{}).disabled};
 });
 rec('内訳が1件なら最初から選ばれている（そのまま追加できる）',
     !s2.goOff&&/日常点検/.test(s2.on),JSON.stringify(s2));
 rec('なぜ選ばれているのかを「既定」の字で言う（推測させない）',s2.def>=1,`${s2.def}枚`);
 rec('進むボタンの字が「入るもの」そのもの（押す前に読める・入る先まで）',
     /定期点検（日常点検）・15分 を .+ へ追加/.test(s2.go),s2.go);

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
 await page.waitForFunction(()=>((document.getElementById('scSbSub')||{}).options||[]).length===3,
   null,{timeout:8000});
 const s3=await page.evaluate(()=>{
  const sel=document.getElementById('scSbSub');
  const cur=sel&&sel.options[sel.selectedIndex];
  return {on:cur?cur.textContent.trim():'',
   goOff:!!(document.querySelector('#scSpGo')||{}).disabled,
   go:(document.querySelector('#scSpGo')||{}).textContent||''};
 });
 rec('内訳が2件以上でも、既定の印を付けた行が最初から選ばれる',
     !s3.goOff&&/刃出し/.test(s3.on),JSON.stringify(s3));
 rec('その内訳の標準所要分（90分）が時間に入る',/90/.test(s3.go),s3.go);

 // ---- ④ 下を持つ内訳を選ぶと行が増える／選び直すと捨てる（§9.390） ------
 /* 内訳は`<select>`（§9.400）。**打ち替えたら`change`を投げる**——
    帯は`change`で描き直すので、`value`を書くだけでは何も起きない。 */
 const pickSel=async(id,name)=>{
  await page.evaluate(a=>{
   const s=document.getElementById(a.id);if(!s)return;
   const o=[...s.options].find(x=>x.textContent.includes(a.name));
   if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}))}
  },{id,name});
  await page.waitForFunction(a=>{
   const s=document.getElementById(a.id);
   return !!s&&((s.options[s.selectedIndex]||{}).textContent||'').includes(a.name);
  },{id,name},{timeout:8000})
   .catch(e=>{throw new Error(`内訳「${name}」を選べない: `+e.message.slice(0,50))});
 };
 await pickSel('scSbSub','ゴムリング');
 await page.waitForFunction(()=>!!document.getElementById('scSbSub2'),null,{timeout:8000})
   .catch(e=>{throw new Error('④-1 2段目の選択肢が出ない: '+e.message.slice(0,60))});
 const s4=await page.evaluate(()=>({
  sels:document.querySelectorAll('.sc-sb-sel').length,
  label2:(document.getElementById('scSbSub2')||{}).getAttribute('aria-label'),
  kids:[...((document.getElementById('scSbSub2')||{}).options||[])].slice(1).map(x=>x.textContent.trim()),
  go:(document.querySelector('#scSpGo')||{}).textContent||'',
  goOff:!!(document.querySelector('#scSpGo')||{}).disabled,
 }));
 rec('下を持つ内訳を選ぶと選択肢がもう1つ増え、その見出しは親の名前',
     s4.sels===2&&/ゴムリング/.test(s4.label2||''),`${s4.sels}個 / ${s4.label2}`);
 rec('2段目の札が2つ出る',s4.kids.join('/')==='交換/増し締め',s4.kids.join('/'));
 rec('2段目に既定が無ければ、選ぶまで追加できない',
     s4.goOff&&/ゴムリング/.test(s4.go),`${s4.go} off=${s4.goOff}`);
 await pickSel('scSbSub2','交換');
 await page.waitForFunction(()=>!(document.querySelector('#scSpGo')||{}).disabled,null,{timeout:8000})
   .catch(e=>{throw new Error('④-2 2段目を選んでも押せない: '+e.message.slice(0,60))});
 rec('2段目の標準所要分（20分）が時間に入る',
     /20分/.test(await page.evaluate(()=>(document.querySelector('#scSpGo')||{}).textContent||'')),
     await page.evaluate(()=>(document.querySelector('#scSpGo')||{}).textContent||''));
 await pickSel('scSbSub','刃出し');
 await page.waitForFunction(()=>!document.getElementById('scSbSub2'),null,{timeout:8000})
   .catch(e=>{throw new Error('④-3 2段目が消えない: '+e.message.slice(0,60))});
 rec('1段目を選び直すと2段目の選択肢ごと消える',true);

 // ---- ⑤ 時間を手で直すと、選び直しても戻らない（§9.400） ---------------
 /* 数字を打てば何分でも入る（スライダーをやめた・§9.247）。**打っている間は
    帯ごと描き直さない**ので、進むボタンの字だけが追いつく。 */
 const sl=await page.evaluate(()=>{
  const el=document.getElementById('scSbMinutes');
  if(!el)return null;
  el.value='37';el.dispatchEvent(new Event('input',{bubbles:true}));
  return {v:el.value,go:(document.getElementById('scSpGo')||{}).textContent||''};
 });
 rec('数字を打てば何分でも入る（進むボタンの字がその場で追いつく）',
     !!sl&&sl.v==='37'&&/37分/.test(sl.go),JSON.stringify(sl));
 /* 「−」「＋」は**時間マスタの選択肢を送る**（§9.400）。選択肢に無い37分から
    「＋」を押すと、その向きでいちばん近い選択肢へ動く。 */
 const step=await page.evaluate(()=>{
  const b=[...document.querySelectorAll('[data-sb-step]')].find(x=>Number(x.dataset.sbStep)>0);
  if(b)b.click();
  return (document.getElementById('scSbMinutes')||{}).value;
 });
 rec('「＋」は時間マスタの選択肢を送る（37分の次の選択肢へ）',
     step!==''&&Number(step)>37,String(step));
 await pickSel('scSbSub','ゴムリング');
 const s5=await page.evaluate(()=>(document.querySelector('#scSpGo')||{}).textContent||'');
 rec('手で触った時間は、内訳を選び直しても勝手に戻さない',
     !/・60分/.test(s5)&&!/・90分/.test(s5),s5);

 // ---- ⑥⑦ 追加すると名称はそのまま・内訳は明細・行に札 ------------------
 await pickSel('scSbSub2','交換');
 await page.waitForFunction(()=>!(document.querySelector('#scSpGo')||{}).disabled,null,{timeout:8000})
   .catch(e=>{throw new Error('⑥ 2段目を選んでも押せない: '+e.message.slice(0,60))});
 await page.evaluate(()=>{
  const el=document.getElementById('scSbMinutes');
  if(el){el.value='30';el.dispatchEvent(new Event('input',{bubbles:true}))}
 });
 const goTxt=await page.evaluate(()=>(document.querySelector('#scSpGo')||{}).textContent||'');
 rec('打った分がそのまま入る',/30分/.test(goTxt),goTxt);
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

 // ---- ⑧ 「選び直す」で右を空へ戻せる（一覧は消えない） ------------------
 await page.click(`.sc-stop-button[data-id="${stop.id}"]`);
 await page.waitForSelector('#scSpBack',{timeout:10000});
 await page.click('#scSpBack');
 await page.waitForFunction(()=>!!document.querySelector('.sc-sb.is-empty')
   &&!!document.querySelector('.sc-stop-button'),null,{timeout:8000});
 rec('「選び直す」で帯が案内へ戻る（一覧はそのまま）',true);

 // ---- 後片付け --------------------------------------------------------
 for(const e of after.filter(x=>x.kind==='設備停止'&&x.title===NAME)){
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
