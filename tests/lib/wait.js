/* tests/lib/wait.js: 「時間」ではなく「条件」で待つための共通の道具（§9.324 R5）
   ============================================================
   固定待ち（`page.waitForTimeout(N)`）は速い画面では無駄に待ち、遅い画面では
   足りない（§9.102・tests/README.md「待ち方」）。ここに置くのは、テストが
   何度も書いていた**同じ待ち**を名前で呼べるようにしたもの:

     booted(page)          起動の覆いが外れた（`app-booting`が消えた）
     openSchedule(page,EQ) 作業スケジュールを開き、その設備のタイムラインが描かれた
     settleFlags(page)     作業可否の「?」が消えた（test_wkfast と同じ判定）
     until(page,fn,arg)    画面の条件が真になった（＋短い落ち着き）
     poll(fn,pred)         サーバーの答えが条件を満たした（書き込みのあとの取り直し）
     settle(page)          短い落ち着き（レイアウトの確定。既定350ms）

   **上限を超えたら黙って先へ進む**（その先の判定でFAILとして出る）——
   ここで投げると「何を待っていて足りなかったか」が読めなくなる。
   **速くしたら同じものを見ていることを数で確かめる**（README「待ち方」）。
   ============================================================ */
'use strict';
const SETTLE=350;

/* どの待ちに何秒かかったかを出す口。**遅くなった網は測ってから直す**
   （§9.347）——固定待ちを条件待ちへ替えて逆に遅くなったとき、どの条件が
   上限まで待ったのかは、これが無いと当てずっぽうになる。
     WAVELOG_WAIT_TRACE=1 node tests/test_x.js 2>&1 | grep '^\[wait\]'  */
const TRACE=!!process.env.WAVELOG_WAIT_TRACE;
function traced(name,fn){
 if(!TRACE)return fn;
 return async function(...a){const t0=Date.now();try{return await fn.apply(this,a)}
  finally{const ms=Date.now()-t0;if(ms>=300)console.log(`[wait] ${name} ${ms}ms`)}};
}

const settle=(page,ms=SETTLE)=>page.waitForTimeout(ms);

/* 画面の条件が真になるまで待ち、そのあと短く落ち着かせる。 */
async function until(page,fn,arg=null,ms=15000){
 await page.waitForFunction(fn,arg,{timeout:ms}).catch(()=>{});
 await settle(page);
}

/* 起動の覆い（§9.86）が外れるまで。`#openSchedule`が在るだけでは
   まだ組み上がっていない（`base.js`の4段階が終わるまで`app-booting`が付く）。 */
async function booted(page,ms=20000){
 await page.waitForSelector('#openSchedule',{timeout:ms});
 await until(page,()=>!document.documentElement.classList.contains('app-booting'),null,ms);
}

/* 作業可否の裏取り（§9.51）が落ち着くまで。「?」が1つも無い状態を待つ。
   取り直しが要らなければ即座に真になるので、速い画面では待たない。 */
const settleFlags=(page,ms=30000)=>page.waitForFunction(
  ()=>{const ns=[...document.querySelectorAll('.sc-row-line .sc-row-workable')];
       return ns.length===0||!ns.some(n=>n.classList.contains('is-unknown'))},
  null,{timeout:ms}).catch(()=>{});

/* 作業スケジュールを開いて、その設備のタイムラインが描かれるまで。
   以前は「1200ms → 押す → 2200ms → 設備を押す → 行を待つ → 1500ms」と
   4.9秒の固定待ちを各テストが書き写していた。待っているのは
   ①設備の行（`[data-equipment]`）が描かれた ②その設備の行（`.sc-row-line`）が
   描かれ、タイムラインがその設備を名乗っている ③作業可否が落ち着いた、の3つ。
   `rows:false`は、予定が1本も無い設備を開くときに使う。 */
async function openSchedule(page,EQ,{rows=true,ms=25000}={}){
 await page.click('#openSchedule');
 await until(page,e=>!!document.querySelector(`[data-equipment="${e}"]`),EQ,ms);
 await page.evaluate(e=>{const r=document.querySelector(`[data-equipment="${e}"]`);r&&r.click()},EQ);
 if(rows)await page.waitForSelector('.sc-row-line',{timeout:ms});
 await until(page,e=>(document.querySelector('#scTimeline')||{dataset:{}}).dataset.equipment===e,EQ,ms);
 await settleFlags(page);
}

/* サーバーの答えが条件を満たすまで取り直す（書き込みのあと）。
   以前は「3500ms待ってからGET」で、遅い共有では足りず速い端末では無駄だった。
   最後に取った値を返す（満たさなくても返す＝その先の判定でFAILになる）。 */
async function poll(fn,pred,ms=15000,step=250){
 const t0=Date.now();let v;
 while(Date.now()-t0<ms){
  v=await fn();
  if(pred(v))return v;
  await new Promise(r=>setTimeout(r,step));
 }
 return v;
}

/* 操業データ項目の設定窓の「保存」を押して、閉じて「保存しました」が出るまで。
   保存は`closeOpModal()`→`opSay('保存しました')`の順（master-opdata.js）。
   **押す前に前の文言を消す**——前回の「保存しました」が残っていると、
   押した瞬間に条件が真になって何も待たない。 */
async function opSave(page,ms=15000){
 await page.evaluate(()=>{const e=document.getElementById('opLayoutState');if(e)e.textContent=''});
 await page.click('#opdSave');
 await until(page,()=>{const m=document.getElementById('opItemModal');
   const t=(document.getElementById('opLayoutState')||{}).textContent||'';
   return (!m||m.hidden)&&/保存しました|できませんでした/.test(t)},null,ms);
}

/* 1行入力の窓（§9.342）に答える。素の`prompt()`をやめたので
   `page.on('dialog')`では答えられない——**あの配線が残っているテストは、
   窓が開いたまま待ち続けて時間切れになる**（実際に`test_colpreset`が
   そうなった）。

   窓は`confirmModal`の器を使い回すので、**閉じきるまで待ってから**次へ
   進む（前の窓が消える前に次を開けると、入力欄が入れ替わって打った字が
   どこへ行ったか分からなくなる）。 */
async function answerPrompt(page,text,timeout=8000){
 await page.waitForSelector('#appPromptInput',{timeout});
 await page.fill('#appPromptInput',String(text));
 await page.click('#appConfirmOk');
 /* **`state:'hidden'`で待つこと。** 既定は`'visible'`なので
    `'#appConfirmModal[hidden]'`は永久に一致しない（伏せた要素は
    「見えない」ので、条件を満たした瞬間に待てなくなる）。 */
 await page.waitForSelector('#appConfirmModal',{state:'hidden',timeout});
}

/* 確認の窓（§9.342）に答える。`page.on('dialog',d=>d.accept())`は素の
   `confirm()`のための配線で、**もう何も受け取らない**——削除や解除を
   押したテストは、窓が開いたまま次の待ちで時間切れになる。 */
async function answerConfirm(page,ok=true,timeout=8000){
 await page.waitForSelector('#appConfirmModal',{state:'visible',timeout});
 await page.click(ok?'#appConfirmOk':'#appConfirmCancel');
 await page.waitForSelector('#appConfirmModal',{state:'hidden',timeout});
}

/* ---------- §9.102 の「実測済みの形」を名前で呼べるようにした3つ（3-15 ②） ----------
   test_fit.js が 70秒→35秒 にしたときの道具そのもの。あちらに閉じていたので
   他の網は同じ待ちを固定の秒数で書き写していた。 */

/* レイアウトの確定。寸法を動かす transition は無い（§9.102）ので、
   描画が1巡（rAF×2）すれば計測してよい。 */
const paint=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

/* 「その画面ぶんの取得が終わったか」。**page を作った直後に呼ぶ**（配線は
   最初の航行より前に張らないと、最初の取得を数え損ねる）。返る`idle()`は
   取得が0のまま quiet ミリ秒静かなら次へ進む。「0件になった瞬間」では
   早すぎる——一覧は描き終えたあと requestIdleCallback で追加の問い合わせを
   出す（§9.94）。ハートビートは画面と無関係なので数から外す。
   cap を超えたら黙って先へ進む（その先の判定で FAIL として出る）。 */
function track(page,{ignore=/\/api\/heartbeat/}={}){
 /* 取得中のものを**要求ごとに**持つ（数だけだと、終わりの合図が来ない
    要求が1つ混ざったときに何が塞いでいるのか分からない）。 */
 const live=new Map();
 const counted=r=>!ignore.test(r.url());
 page.on('request',r=>{if(counted(r))live.set(r,Date.now())});
 page.on('requestfinished',r=>{live.delete(r)});
 page.on('requestfailed',r=>{live.delete(r)});
 const idle=async(quiet=400,cap=6000)=>{
  const t0=Date.now();let calm=Date.now();
  while(Date.now()-t0<cap){
   if(live.size>0)calm=Date.now();
   else if(Date.now()-calm>=quiet)break;
   await new Promise(r=>setTimeout(r,50));
  }
  if(TRACE&&live.size)console.log('[wait] idle が上限に当たった。取得中のまま: '
    +[...live].map(([r,t])=>`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/,'')} (${Date.now()-t}ms)`).join(' | '));
  await paint(page);
 };
 return {idle,pending:()=>live.size};
}

/* 「文字が変わる」。押す**前に**いまの字を控え、それと違う字になるまで待つ。
   前回の合図が残っていると押した瞬間に真になるので、控えてから押すこと
   （opSave と同じ理由）。 */
async function changed(page,sel,before,ms=15000){
 await page.waitForFunction(a=>{const e=document.querySelector(a.sel);
   return !!e&&(e.textContent||'').trim()!==a.before},{sel,before:String(before||'').trim()},{timeout:ms}).catch(()=>{});
 await settle(page);
}
const textOf=(page,sel)=>page.evaluate(s=>((document.querySelector(s)||{}).textContent||'').trim(),sel);

/* 計測の口は公開するものにだけ被せる（中で呼び合うぶんは二重に数えない）。 */
const X={SETTLE,settle,paint,textOf,
 until:traced('until',until),booted:traced('booted',booted),settleFlags:traced('settleFlags',settleFlags),
 openSchedule:traced('openSchedule',openSchedule),poll:traced('poll',poll),opSave:traced('opSave',opSave),
 answerPrompt:traced('answerPrompt',answerPrompt),answerConfirm:traced('answerConfirm',answerConfirm),
 changed:traced('changed',changed),
 track:(page,o)=>{const t=track(page,o);return {idle:traced('idle',t.idle),pending:t.pending}}};
module.exports=X;
