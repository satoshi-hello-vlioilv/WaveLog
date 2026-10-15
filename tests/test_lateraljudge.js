/* test_lateraljudge.js: ラテラルボーの基準判定が打ち直し・描き直し・基準の後着で揺れない（§9.606・利用者の報告）
   ============================================================
   「ラテラルボー基準判定が不安定。別のタブから戻ってくるとNG表示される現象がありリフレッシュの
    タイミングなど表示が安定していない。NG後に正しい値を入れても再判定してくれない。」

   物差し（欄ごとに「見えている判定」と「その欄の項目の基準で判定した答え」を突き合わせる）:
    L1. 正しい値へ打ち直した後も残る NG の札（`.judge-pill.ng`）の数 → 0
    L2. 打った直後の赤の地（`validation-ng`）が欄の判定（`.ng`）と食い違う欄の数 → 0（1打遅れない）
    L3. 選んでいる項目が別の項目のまま描き直されたとき、欄の項目と違う基準で判定された欄の数 → 0
    L4. 基準（指示_ﾗﾃﾗﾙﾎﾞｰ）が後から届いたとき、判定し直されずに残る欄の数 → 0
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';

run('test_lateraljudge: ラテラルボーの基準判定が揺れない（§9.606）', async ({page,rec,B,W,idle})=>{
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
 await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000}).catch(()=>{});
 /* 窓（手入力の注意など）が開いていたら閉じる（§9.394 の網と同じ） */
 const closeModal=()=>page.evaluate(()=>{const m=document.getElementById('appConfirmModal');
  if(m&&!m.hidden){const b=document.getElementById('appConfirmOk')||document.getElementById('closeAppConfirm');if(b)b.click()}});
 await page.evaluate(()=>WL.measureSteps.go('2'));await idle();await closeModal();
 const setType=async t=>{
  await page.evaluate(v=>{const el=document.getElementById('measureType');el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}))},t);
  await page.waitForFunction(v=>document.getElementById('measureType').value===v&&!!document.querySelector('[data-mkey]'),t,{timeout:8000});
  await idle();await closeModal();
 };
 /* 基準 2.0（指示）。0〜2.0 が OK、ラテラルボーは打ち終わりに 0.5 で切り上げる。 */
 await page.evaluate(()=>{const s=S.measure.source=S.measure.source||{};s['指示_ﾗﾃﾗﾙﾎﾞｰ']='2.0/2M';
  S.measure.settings.horizontalCount=4;const h=document.getElementById('horizontalCount');if(h)h.value='4'});
 await setType('ラテラルボー');
 await closeModal();
 /* 見えている判定と、欄の項目の基準で出した答え */
 const audit=()=>page.evaluate(()=>{
  const out=[];
  document.querySelectorAll('input[data-mkey="lateral"]').forEach(el=>{
   const raw=String(el.value||'').trim(),num=Number(raw);
   const tol=WL.measureInput.toleranceDetail('width',+el.dataset.j,'ラテラルボー');
   const want=raw!==''&&Number.isFinite(num)&&!!tol&&(num<tol.range[0]||num>tol.range[1]);
   const wrap=el.closest('.strip-input-wrap');
   out.push({i:+el.dataset.i,j:+el.dataset.j,v:raw,want,ng:el.classList.contains('ng'),
    red:el.classList.contains('validation-ng'),pill:!!(wrap&&wrap.querySelector('.judge-pill.ng')),
    cur:!!(wrap&&wrap.classList.contains('is-judged'))});
  });
  return out;
 });
 const cell=async()=>{const h=await page.$('input[data-mkey="lateral"][data-j="0"]');return h};
 const typeInto=async(text)=>{const h=await cell();await h.click();await h.fill('');await h.type(text);await idle(150,2000)};
 /* ① NG の値を打って欄を離れる（描き直しで札が出る状態を作る） */
 await typeInto('3');
 await page.evaluate(()=>WL.measureInput.renderMeasureGrid());await idle();
 const a1=(await audit()).find(x=>x.j===0&&x.v);
 rec('前提: 3 は基準 2.0 を超えて NG（札が出る）',!!a1&&a1.want&&a1.pill,JSON.stringify(a1));
 /* ② 正しい値へ打ち直す（描き直しを挟まない） */
 await typeInto('1');
 const a2=await audit();
 const stalePill=a2.filter(x=>x.pill&&!x.want).length;
 rec('L1. 正しい値へ打ち直すと NG の札が消える',stalePill===0,`残る札 ${stalePill} / ${JSON.stringify(a2.find(x=>x.j===0))}`);
 const lag=a2.filter(x=>x.red!==x.ng).length;
 rec('L2. 赤の地が欄の判定と食い違わない（1打遅れない）',lag===0,`食い違い ${lag}`);
 /* ③ 選んでいる項目が別のまま描き直される（戻ってきたときの組み直しの途中）。欄はラテラルボーのまま。 */
 await typeInto('1.5');
 const wrongCtx=await page.evaluate(()=>{
  const el=document.getElementById('measureType'),keep=el.value;
  /* 板幅には公差（1000±1）がある——欄の項目を見ないと、ラテラルボーの 1.5 が板幅の公差で NG になる。 */
  const s=S.measure.source;s['製造板幅']=1000;s['板幅公差_製造_ﾌﾟﾗｽ']=1;s['板幅公差_製造_ﾏｲﾅｽ']=1;S.measure.basic.mfgWidth=1000;
  el.value='板幅';   // 描き直しの途中で項目の欄が別の値を持っている
  WL.measureInput.renderMeasureGrid&&document.querySelectorAll('input[data-mkey="lateral"]').forEach(x=>
   WL.measureView.judgeInput(x,'lateral',Number(x.value),+x.dataset.j));
  const r=[...document.querySelectorAll('input[data-mkey="lateral"]')].map(x=>x.classList.contains('ng'));
  el.value=keep;
  return r;
 });
 const a3=await audit();
 const wrong=a3.filter((x,k)=>wrongCtx[k]!==x.want).length;
 rec('L3. 選んでいる項目に関わらず、欄の項目（ラテラルボー）の基準で判定する',wrong===0,`違う基準で判定された欄 ${wrong}`);
 /* ④ 基準が後から届く（一覧の行には指示の列が無く、完全な行が後で来る） */
 await page.evaluate(()=>{delete S.measure.source['指示_ﾗﾃﾗﾙﾎﾞｰ'];S.measure.manualLimits=null;WL.measureInput.renderMeasureGrid()});
 await idle();
 await typeInto('3');
 await page.evaluate(()=>{S.measure.source['指示_ﾗﾃﾗﾙﾎﾞｰ']='2.0/2M';WL.measureHooks.run('afterSourceRefresh')});
 await idle();
 const a4=await audit();
 const late=a4.filter(x=>x.want!==x.ng).length;
 rec('L4. 基準が後から届いたら判定し直す',late===0,`判定し直されない欄 ${late} / ${JSON.stringify(a4.find(x=>x.j===0))}`);
 /* 片付け: このロットの下書きを捨てる（網の後にロットを残さない） */
 await page.evaluate(()=>{const h=document.querySelector('input[data-mkey="lateral"][data-j="0"]');if(h){h.value='';h.dispatchEvent(new Event('input',{bubbles:true}))}});
});
