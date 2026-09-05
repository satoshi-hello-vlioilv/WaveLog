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

module.exports={SETTLE,settle,until,booted,settleFlags,openSchedule,poll,opSave};
