/* base.js の WL.ttlCache(フェーズ5)の検証。
   新しいキャッシュはこのヘルパを使う規約にするので、規約側が正しいことを
   固定しておく。**使われていないヘルパは腐る**ので、最低限ここで縛る。 */
'use strict';
const {run}=require('./lib/harness.js');
run('test_ttlcache: base.js の WL.ttlCache(フェーズ5)の検証。', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>typeof window.WL?.ttlCache==='function',null,{timeout:15000});

 const r=await page.evaluate(async()=>{
  const out={};
  // --- 保存して取り出せる / 期限が切れたら捨てる ---
  const c=WL.ttlCache(50);
  c.set('a',1);
  out.hit=c.get('a');
  await new Promise(r=>setTimeout(r,80));
  out.expired=c.get('a');
  out.sizeAfterExpire=c.size;   // 読んだときに捨てるので0になる

  // --- 件数の上限 ---
  const cap=WL.ttlCache(60000,3);
  ['k1','k2','k3','k4'].forEach((k,i)=>cap.set(k,i));
  out.capped=cap.size;
  out.oldestDropped=cap.get('k1');

  // --- 取得中は1回にまとめる ---
  const dedup=WL.ttlCache(60000);
  let calls=0;
  const load=()=>{calls++;return new Promise(r=>setTimeout(()=>r('v'),30))};
  const [x,y,z]=await Promise.all([dedup.fetch('same',load),dedup.fetch('same',load),dedup.fetch('same',load)]);
  out.calls=calls;out.values=[x,y,z].join(',');

  // --- 失敗したPromiseは残さない(再試行できる) ---
  const flaky=WL.ttlCache(60000);
  let n=0;
  const sometimes=()=>{n++;return n===1?Promise.reject(new Error('boom')):Promise.resolve('ok')};
  try{await flaky.fetch('f',sometimes)}catch(e){out.firstError=e.message}
  out.retried=await flaky.fetch('f',sometimes);
  out.retryCalls=n;

  // --- 破棄 ---
  const inv=WL.ttlCache(60000);
  inv.set('p',1);inv.set('q',2);
  inv.invalidate('p');
  // join()はnullを空文字にするのでJSONで持つ(比較の取り違えを避ける)
  out.afterKeyInvalidate=JSON.stringify([inv.get('p'),inv.get('q')]);
  inv.invalidate();
  out.afterAllInvalidate=inv.size;
  return out;
 });

 rec('保存した値を取り出せる',r.hit===1,JSON.stringify(r.hit));
 rec('期限が切れた値は返さない',r.expired===null,JSON.stringify(r.expired));
 rec('期限切れは読んだときに捨てる',r.sizeAfterExpire===0,String(r.sizeAfterExpire));
 rec('件数の上限を超えたら古いものから捨てる',r.capped===3,String(r.capped));
 rec('捨てられた古いキーは返らない',r.oldestDropped===null,JSON.stringify(r.oldestDropped));
 rec('取得中に同じキーが来ても呼び出しは1回',r.calls===1,'calls='+r.calls);
 rec('同時呼び出しは全て同じ値を受け取る',r.values==='v,v,v',r.values);
 rec('失敗はそのまま呼び出し側へ伝わる',r.firstError==='boom',r.firstError);
 rec('失敗したPromiseを残さず再試行できる',r.retried==='ok'&&r.retryCalls===2,
  `retried=${r.retried} calls=${r.retryCalls}`);
 rec('キー指定の破棄はそのキーだけ消す',r.afterKeyInvalidate==='[null,2]',r.afterKeyInvalidate);
 rec('引数なしの破棄で全て消える',r.afterAllInvalidate===0,String(r.afterAllInvalidate));

}, {});
