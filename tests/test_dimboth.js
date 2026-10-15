/* test_dimboth.js: 板厚と板幅を1つの項目「板厚・板幅」で同時に入れる（§9.607・利用者の選択「A の表＋F の振り分け」）
   ============================================================
   A＝1つの項目の中に板厚の表（OS・CL・DS）と板幅の表（条ごと）を上下に重ね、列（丈位置）をそろえる。
   F＝測定器で振り分ける。マイクロメータの値は板厚の次の枠へ、ノギス・コンベックスの値は板幅の次の枠へ（項目を切り替えない）。

   物差し（2丈 × 「マイクロメータ3点 → ノギス4条」を、項目を切り替えずに送る）:
    D1. 入った数（全14点）／断られた数 → 14／0
    D2. 測り終えるのに要る項目の切り替え → 0
    D3. 見出しが板厚と板幅の進みを別々に言う（合算しない・§9.138）
    D4. 手で打つときの Enter の順: 板厚 OS→CL→DS → 板幅の1条目（切り替えずに続く）
    D5. 板厚の欄は板厚の公差、板幅の欄は板幅の公差で判定する（取り違えない）
    D6. 前の版の記録（入力内容「板厚」「板幅」）は「板厚・板幅」で開く
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';
const DIM='板厚・板幅';

run('test_dimboth: 板厚と板幅を1つの項目で同時に入れる（§9.607）', async ({page,rec,W,idle})=>{
 await fetch(API+'/api/access-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'edit'})});
 await page.goto(API+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:20000});
 await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 await page.reload({waitUntil:'domcontentloaded'});
 await W.booted(page);await idle();
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-row-line',{timeout:20000});
 const started=await page.evaluate(()=>{
  const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start:not(.is-locked)'));
  if(r)r.querySelector('.sc-row-start').click();
  return !!r;
 });
 rec('前提: 予定から測定画面を開ける',started);
 if(!started)return;
 await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:20000});
 await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000})
  .catch(e=>console.log('保存の覆いが消えるのを待てなかった（続ける）: '+e.message));
 const closeModal=()=>page.evaluate(()=>{const m=document.getElementById('appConfirmModal');
  if(m&&!m.hidden){const b=document.getElementById('appConfirmOk')||document.getElementById('closeAppConfirm');if(b)b.click()}});
 await page.evaluate(()=>WL.measureSteps.go('2'));await idle();await closeModal();
 /* 材料: 4条・2丈、板厚 1.000±0.005／板幅 50.00±0.10（製造公差）。 */
 await page.evaluate(()=>{const s=S.measure.source=S.measure.source||{};
  s['製造板厚']=1;s['板厚公差_製造_ﾌﾟﾗｽ']=0.005;s['板厚公差_製造_ﾏｲﾅｽ']=0.005;S.measure.basic.mfgThickness=1;
  s['製造板幅']=50;s['板幅公差_製造_ﾌﾟﾗｽ']=0.1;s['板幅公差_製造_ﾏｲﾅｽ']=0.1;S.measure.basic.mfgWidth=50;
  S.measure.settings.horizontalCount=4;const h=document.getElementById('horizontalCount');if(h){h.value='4';h.dispatchEvent(new Event('change',{bubbles:true}))}});
 await idle();await closeModal();
 /* いまの画面で選べる項目: 「板厚・板幅」が無ければ「板厚」（直す前） */
 const opts=await page.evaluate(()=>[...document.getElementById('measureType').options].map(o=>o.value));
 const pick=opts.includes(DIM)?DIM:'板厚';
 const setType=async t=>{
  await page.evaluate(v=>{const el=document.getElementById('measureType');el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}))},t);
  await idle();await closeModal();
 };
 await setType(pick);
 /* 自動転送で送る（網の口・§9.359） */
 const setLen=li=>page.evaluate(i=>{const lp=document.getElementById('lengthPos');lp.selectedIndex=i;lp.dispatchEvent(new Event('change',{bubbles:true}))},li);
 const send=raw=>page.evaluate(r=>WL.measureInput.processDeviceInput(r),raw);
 const T=['DT100+001.002','DT100+000.999','DT100+001.001'],Wd=['DT110+050.02','DT110+049.98','DT110+050.01','DT110+050.15'];
 let switches=0;
 for(const li of [0,1]){
  await setLen(li);await idle();
  for(const r of [...T,...Wd]){await send(r);}
  await idle();
 }
 const got=await page.evaluate(()=>{const m=S.measure.measurements;
  const t=m.thickness.slice(0,2).flatMap(r=>r.slice(0,3)).filter(v=>v!=='').length;
  const w=m.width.slice(0,2).flatMap(r=>r.slice(0,4)).filter(v=>v!=='').length;
  return {t,w};});
 const total=got.t+got.w;
 rec('D1. 2丈ぶん（14点）を項目を切り替えずに送ると全部入る（断られない）',total===14,`入った ${total}/14（板厚 ${got.t}/6・板幅 ${got.w}/8）・断られた ${14-total}`);
 rec('D2. 測り終えるのに項目の切り替えは要らない',switches===0&&total===14,`切り替え ${switches}回・入りきらない ${14-total}点`);
 const head=await page.evaluate(()=>document.getElementById('measureHeadBadges').textContent.replace(/\s+/g,' '));
 rec('D3. 見出しが板厚と板幅の進みを別々に言う',/板厚[^板]*\d+\/\d+/.test(head)&&/板幅[^板]*\d+\/\d+/.test(head),head);
 /* D4: 手で打つ（手動）・丈1(頭)の板厚 OS から Enter */
 await page.evaluate(()=>document.querySelector('[data-mode="manual"]').click());await closeModal();
 await setLen(0);await idle();
 const order=await page.evaluate(()=>{
  const at=()=>{const c=document.querySelector('[data-mkey].current');return c?`${c.dataset.mkey}:${c.dataset.j}`:'?'};
  const first=document.querySelector('input[data-mkey="thickness"][data-i="0"][data-j="0"]');if(!first)return null;
  first.click();const seq=[at()];
  for(let k=0;k<3;k++){const c=document.querySelector('[data-mkey].current');c.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));seq.push(at())}
  return seq;});
 rec('D4. Enter は 板厚 OS→CL→DS→板幅の1条目 と続く',!!order&&order.join(' ')==='thickness:0 thickness:1 thickness:2 width:0',JSON.stringify(order));
 /* D5: 公差の取り違え（板厚 1.002 は OK・板幅 50.15 は NG。板厚の欄を板幅の公差で見ると 1.002 は NG になる） */
 const judge=await page.evaluate(()=>{
  const t=document.querySelector('input[data-mkey="thickness"][data-i="0"][data-j="0"]'),w=document.querySelector('input[data-mkey="width"][data-i="0"][data-j="3"]');
  return {thickNg:t?t.classList.contains('ng'):null,widthNg:w?w.classList.contains('ng'):null};});
 rec('D5. 板厚の欄は板厚の公差、板幅の欄は板幅の公差で判定する',judge.thickNg===false&&judge.widthNg===true,JSON.stringify(judge));
 if(process.env.WAVELOG_SHOT){
  /* 比べるページ用（§9.607）: 同じ材料・同じ値で、利用者の PC とフル HD の大きさで撮る。直す前は板厚と板幅を別々に撮る。 */
  await page.evaluate(()=>document.querySelector('[data-mode="auto"]')?.click());await closeModal();
  for(const [w,hh] of [[1728,1152],[1536,864]]){
   await page.setViewportSize({width:w,height:hh});await idle();
   for(const t of opts.includes(DIM)?[DIM]:['板厚','板幅']){
    await setType(t);await setLen(0);await idle();
    await page.screenshot({path:`${process.env.WAVELOG_SHOT}/dim-${t==='板幅'?'width':t==='板厚'?'thick':'both'}-${w}.png`});
   }
  }
 }
 /* D6: 前の版の記録の名前 */
 const legacy=await page.evaluate(()=>['板厚','板幅','板厚/板幅'].map(n=>WL.measureItem.normalize(n)));
 rec('D6. 前の版の入力内容「板厚」「板幅」「板厚/板幅」は「板厚・板幅」で開く',legacy.every(n=>n===DIM),JSON.stringify(legacy));
 /* 片付け: この網で入れた値を空へ（下書きを残さない） */
 await page.evaluate(()=>{const m=S.measure.measurements;['thickness','width'].forEach(k=>m[k].forEach(r=>r.fill('')))});
});
