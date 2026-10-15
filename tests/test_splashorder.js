/* test_splashorder.js: デスクトップ版の起動画面は段を順に1つずつ進め、版を上げる／戻すを言い分ける（§9.606・利用者の指示）
   ============================================================
   「版を戻すときと版をアップデートするときでメッセージを変えたり、起動時のアップデートしていることがもっとわかるような
    表現と、ステップの中で同時に2つぐるぐるしたり、手戻りがあるような動きに見えたりするような表現をわかりやすく秩序の
    見えるステータス表示に変えてほしい」

   窓（Rust）は版の確かめと Python の起動を**同時に**進める（§9.561）。その順のまま段を塗ると、済んだ段が回り直し、
   2つの段が同時に回り、帯の％が下がっていた。ここでは窓が実際に送る順（`desktop/src/main.rs`の`start()`）を
   場面ごとに流し、1手ごとに起動画面を数える。

   物差し（場面ごと・1手ごと）:
    S1. 同時に回っている段の数の最大 → 1
    S2. 手戻り（済んだ段が回る／まだに戻る・帯の％が下がる）の数 → 0
    S3. 版を上げるときと戻すときで、画面の字が言い分けられているか（戻す＝「戻」・上げる＝「更新」）
    S4. 写している間、何をしているか（更新／戻す）と前後の版が画面に見えているか
    S5. 窓ごと開き直したとき、新しい窓の最初の画面が「済んだ更新」から続くか（0% の「確かめています」からやり直さない）
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const path=require('path');
const SPLASH='file://'+path.resolve(__dirname,'../desktop/splash/index.html');
const HAVE='2.497.0',UP='2.498.0',DOWN='2.496.0',TOTAL=120;

/* 窓が送る呼び出し（新しい口があればそれ・無ければ前の口）。 */
function adapter(isNew){
 const st=(id,s,d)=>`splash.step(${JSON.stringify(id)},${JSON.stringify(s)},${JSON.stringify(d)})`;
 const ver=v=>`splash.version(${JSON.stringify(v)})`;
 const dir=w=>w===DOWN?'down':'up';
 return {
  check:()=>isNew?ver({phase:'check'}):st('update','now','共有の置き場で、配る版を確かめています…'),
  pyOk:()=>st('python','ok','C:\\Python313\\pythonw.exe'),
  be:()=>st('backend','now','起動前の確認をしています'),
  same:()=>isNew?ver({phase:'same',have:HAVE}):st('update','ok',`版 ${HAVE}（配る版と同じ）`),
  found:w=>isNew?ver({phase:'found',have:HAVE,want:w,dir:dir(w)}):st('update','now',`${HAVE} → ${w} にそろえています`),
  copy:(w,i)=>isNew?ver({phase:'copy',have:HAVE,want:w,dir:dir(w),done:i,total:TOTAL}):st('update','now',`写しています ${i}/${TOTAL}`),
  swap:w=>isNew?ver({phase:'swap',have:HAVE,want:w,dir:dir(w)}):st('update','now','入れ替えています'),
  applied:w=>isNew?ver({phase:'done',have:HAVE,want:w,dir:dir(w)}):st('update','ok',`${HAVE} → ${w} にそろえました`),
  failed:w=>isNew?ver({phase:'fail',have:HAVE,want:w,dir:dir(w),why:'置き場に届きません'}):st('update','warn','そろえられませんでした（置き場に届きません）。いまの版で起動します'),
  relaunch:w=>isNew?ver({phase:'relaunch',have:HAVE,want:w,dir:dir(w)}):st('open','now','窓も新しくなったので、開き直しています…'),
  relaunched:w=>isNew?ver({phase:'done',have:HAVE,want:w,dir:dir(w),relaunched:true}):st('update','now','共有の置き場で、配る版を確かめています…'),
  beNew:()=>st('backend','now','新しい版の中身を読み込んでいます…'),
  beOk:w=>st('backend','ok',`版 ${w||HAVE} ・ 3.1 秒`),
  open:()=>st('open','now','画面を開いています…'),
 };
}
const copies=w=>Array.from({length:Math.ceil(TOTAL/25)},(_,k)=>['copy',w,k*25+1]);
/* 場面（窓が送る順）。'new' は窓ごと開き直した後の新しい窓。 */
const SCENES={
 '同じ版（確かめが後に届く）':[['check'],['pyOk'],['be'],['be'],['be'],['same'],['beOk'],['open']],
 '同じ版（確かめが先に届く）':[['check'],['same'],['pyOk'],['be'],['be'],['beOk'],['open']],
 '新しい版へ更新':[['check'],['pyOk'],['be'],['be'],['found',UP],...copies(UP),['swap',UP],['applied',UP],['beNew'],['be'],['beOk',UP],['open']],
 '前の版へ戻す':[['check'],['pyOk'],['be'],['be'],['found',DOWN],...copies(DOWN),['swap',DOWN],['applied',DOWN],['beNew'],['be'],['beOk',DOWN],['open']],
 '窓ごと開き直す':[['check'],['pyOk'],['be'],['found',UP],...copies(UP),['swap',UP],['applied',UP],['relaunch',UP],['new'],['relaunched',UP],['pyOk'],['be'],['same'],['beOk',UP],['open']],
 '更新できない':[['check'],['pyOk'],['be'],['found',UP],['copy',UP,1],['failed',UP],['beNew'],['beOk'],['open']],
};

run('test_splashorder: 起動画面は段を順に1つずつ進め、版を上げる／戻すを言い分ける（§9.606）', async ({page,rec})=>{
 const snap=()=>page.evaluate(()=>{
  const rows=[...document.querySelectorAll('ol li')].map(li=>({id:li.id,st:li.className.split(' ')[0],
   label:li.querySelector('b').textContent,d:getComputedStyle(li.querySelector('.d')).display!=='none'?li.querySelector('.d').textContent:''}));
  /* 帯の長さそのもの（`--pct`）で見る——写している間は帯の右の字が「ファイル n/N」になる（％の字ではない）。 */
  const pct=parseFloat(document.getElementById('bar').style.getPropertyValue('--pct'))||0;
  const vis=e=>e&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden';
  const extra=[...document.querySelectorAll('[data-splash-say]')].filter(vis).map(e=>e.textContent.replace(/\s+/g,' ').trim());
  return {rows,pct,title:document.getElementById('title').textContent,text:[document.getElementById('title').textContent,...extra,...rows.map(r=>r.label+' '+r.d)].join(' / ')};
 });
 const isNew=async()=>page.evaluate(()=>typeof splash.version==='function');
 const out={};
 for(const [name,seq] of Object.entries(SCENES)){
  await page.goto(SPLASH);
  let A=adapter(await isNew());
  let prev=await snap(),maxSpin=0,regress=[],texts=[],copyTexts=[],firstNew=null;
  for(const [ev,...args] of seq){
   if(ev==='new'){await page.goto(SPLASH);A=adapter(await isNew());prev=await snap();firstNew='wait';continue}
   await page.evaluate(js=>eval(js),A[ev](...args));
   const s=await snap();
   if(firstNew==='wait')firstNew=s;
   maxSpin=Math.max(maxSpin,s.rows.filter(r=>r.st==='now').length);
   s.rows.forEach((r,k)=>{const p=prev.rows[k].st;
    if(/^(ok|warn)$/.test(p)&&/^(now|wait)$/.test(r.st))regress.push(`${ev}: ${r.label} ${p}→${r.st}`)});
   if(s.pct<prev.pct)regress.push(`${ev}: 帯 ${prev.pct}%→${s.pct}%`);
   texts.push(s.text);if(ev==='copy')copyTexts.push(s.text);
   prev=s;
  }
  out[name]={maxSpin,regress,texts,copyTexts,firstNew};
 }
 for(const [name,o] of Object.entries(out)){
  rec(`S1. ${name}: 同時に回る段は1つまで`,o.maxSpin<=1,`最大 ${o.maxSpin}`);
  rec(`S2. ${name}: 手戻りが無い`,o.regress.length===0,`${o.regress.length}件 ${o.regress.slice(0,3).join(' / ')}`);
 }
 const up=out['新しい版へ更新'],down=out['前の版へ戻す'];
 const saysUp=up.texts.some(t=>/更新/.test(t))&&!up.texts.some(t=>/戻/.test(t));
 const saysDown=down.texts.some(t=>/戻/.test(t));
 rec('S3. 版を上げるときは「更新」、戻すときは「戻す」と言い分ける',saysUp&&saysDown,
   `上げる「${up.texts[6]}」／戻す「${down.texts[6]}」`);
 const showsCopy=(o,word,w)=>o.copyTexts.length>0&&o.copyTexts.every(t=>new RegExp(word).test(t)&&t.includes(HAVE)&&t.includes(w));
 rec('S4. 写している間、何をしているかと前後の版が見えている',showsCopy(up,'更新',UP)&&showsCopy(down,'戻',DOWN),
   `「${up.copyTexts[1]||''}」`);
 const rl=out['窓ごと開き直す'].firstNew;
 rec('S5. 開き直した窓は済んだ更新から続く（0%からやり直さない）',!!rl&&rl.pct>=20&&rl.rows[0].st==='ok',
   rl?`帯 ${rl.pct}%・${rl.rows[0].label} ${rl.rows[0].st}`:'');
 if(process.env.WAVELOG_SHOT){
  /* 撮る（§9.606 の比べるページ用）。更新の途中・戻すの途中を、利用者の PC とフル HD の大きさで。 */
  for(const [w,h] of [[1728,1152],[1536,864]]){
   await page.setViewportSize({width:w,height:h});
   for(const [name,key] of [['up','新しい版へ更新'],['down','前の版へ戻す']]){
    await page.goto(SPLASH);const A=adapter(await isNew());
    /* 帯の動き（transition）を止めて撮る——動いている途中の長さを撮らない（採点者の指摘）。 */
    await page.addStyleTag({content:'*{transition:none!important}'});
    for(const [ev,...args] of SCENES[key].slice(0,8))await page.evaluate(js=>eval(js),A[ev](...args));
    await page.screenshot({path:`${process.env.WAVELOG_SHOT}/splash-${name}-${w}.png`});
   }
  }
 }
});
