/* test_rppaper.js: 帳票の紙は、PC の環境の設定で字の大きさ・中身が変わらない（§9.622）
   ============================================================
   利用者の指摘「帳票の印刷機能で、PCによってはプレビューにした時に見切れてしまうこともあります。環境設定によらず、
   文字サイズがユーザーの意図に反し変化することなく同じ表示内容で見切れなく正しく印刷出来るようにしたい」。

   物差し（評価関数）: 同じロットの帳票を、環境の違う6つの場面で開き、紙（`#reportContent`）の中を数える。
    基準 = 表示サイズ「中」・既定の字の大きさ・倍率 1.0。
    場面 = 表示サイズ「小」「大」／ブラウザの既定の字の大きさ 20px（「大」の設定）／画面の倍率 1.25（125%）／
           画面 1536×864・1280×720／ブラウザの最小の字の大きさ 12px（本物の設定・プロファイルの Preferences）
    P1. 紙の中の字の大きさ（要素ごとの計算値）が基準と同じ要素の割合 ＝ 100%
    P2. 紙の縮める倍率（`--rp-fit`）と紙の枚数（`--rp-sheets`）が基準と同じ
    P3. 紙の中で切れている要素（`overflow`で隠れる・紙の外へはみ出す）＝ 0
    P4. 紙の横がプレビューの器の中で読める（狭い画面では紙ごと縮めて出す）
   刷る書類（`@media print`）でも P1〜P3 を数える。最小の字の大きさは利用者が選ぶ設定なので、P1 は数えるだけ（P3 は守る）。
   物差しの確かめ: WAVELOG_RPPAPER_INJECT=24 で紙の字を24pxにすると P3 が切れを見つける（実測 4件）。
   ============================================================ */
'use strict';
const {run,seedRecord}=require('./lib/harness.js');
const B='http://127.0.0.1:5029',EQ='テスト設備A';
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

/* 紙の中の観測: 字を持つ要素ごとの字の大きさ（道で鍵を作る）・倍率・切れ。 */
const observe=page=>page.evaluate(()=>{
 const pg=document.querySelector('#reportContent .rp-page')||document.querySelector('#reportContent');
 if(!pg)return null;
 const pr=pg.getBoundingClientRect();
 const path=el=>{const p=[];for(let e=el;e&&e!==pg;e=e.parentElement){const i=[...e.parentElement.children].indexOf(e);p.push(e.tagName+i)}return p.reverse().join('/')};
 const fonts={},cut=[];
 for(const el of pg.querySelectorAll('*')){
  const own=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
  const cs=getComputedStyle(el);
  if(cs.display==='none'||cs.visibility==='hidden')continue;
  if(own)fonts[path(el)+'#'+(el.className||'')+'「'+(el.textContent||'').trim().slice(0,8)+'」']=cs.fontSize;
  const hides=/hidden|clip/.test(cs.overflowX+cs.overflowY);
  if(own&&hides&&(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1))cut.push(path(el)+' '+(el.textContent||'').trim().slice(0,12));
  const r=el.getBoundingClientRect();
  if(own&&r.width>0&&(r.right>pr.right+1||r.left<pr.left-1))cut.push('はみ出し '+(el.textContent||'').trim().slice(0,12));
 }
 const fitted=[...pg.querySelectorAll('.rp-block-fit')].map(b=>b.style.getPropertyValue('--rp-fit')).filter(Boolean);
 /* 塊の器（`overflow:hidden`）より中身が背高い＝下が切れる。縮めた倍率（transform）は見た目の高さで比べる。 */
 for(const b of pg.querySelectorAll('.rp-block')){const f=b.querySelector(':scope>.rp-block-fit');if(!f)continue;
  const k=parseFloat(f.style.getPropertyValue('--rp-fit'))||1;if(f.scrollHeight*k>b.clientHeight+1)cut.push('塊の下が切れる '+(b.dataset.rpBlock||'')+` ${Math.round(f.scrollHeight*k)}>${b.clientHeight}`)}
 cut.push(...[...pg.querySelectorAll('.rp-block.is-cramped')].map(b=>'入りきらない塊 '+(b.dataset.rpBlock||'')));
 /* プレビューの器（祖先で送れるもの）から見て、紙の右端まで送って届くか。 */
 let sc=pg.parentElement;while(sc&&sc!==document.body){const c=getComputedStyle(sc);if(/auto|scroll/.test(c.overflowX)||sc.id==='reportContent')break;sc=sc.parentElement}
 const box=sc?sc.getBoundingClientRect():{left:0,right:innerWidth};
 const reach=!sc||pr.width<=box.right-box.left+1||sc.scrollWidth>sc.clientWidth;
 /* 紙の枚数（中身が紙の高さを超えると枚が増える＝刷り上がりが変わる）。 */
 const sheets=getComputedStyle(pg).getPropertyValue('--rp-sheets').trim()||'1';
 return {fit:fitted.join(',')||'1',sheets,fonts,cut,reach,reachWhy:`紙 ${Math.round(pr.width)}px・器 ${Math.round(box.right-box.left)}px（${sc&&sc.id||sc&&sc.className||'-'}）`};
});

const fs=require('fs'),os=require('os'),pathm=require('path');
async function minimumContext(min){
 const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
 const dir=fs.mkdtempSync(pathm.join(os.tmpdir(),'wl-rppaper-'));
 fs.mkdirSync(pathm.join(dir,'Default'),{recursive:true});
 fs.writeFileSync(pathm.join(dir,'Default','Preferences'),JSON.stringify({webkit:{webprefs:{minimum_font_size:min,minimum_logical_font_size:min}}}));
 const ctx=await chromium.launchPersistentContext(dir,{executablePath:process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless:true,viewport:{width:1728,height:1152}});
 /* 閉じた直後はブラウザがまだキャッシュを書いていることがある。片付けは何度か試し、残っても網の結果にしない（理由: 一時の置き場）。 */
 ctx.on('close',()=>{try{fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200})}catch(e){console.log('一時の置き場を消せませんでした: '+e.message)}});
 return ctx;
}
run('test_rppaper: 帳票の紙は PC の環境の設定で字の大きさ・中身が変わらない（§9.622）', async ({browser,rec,W})=>{
 await seedRecord();
 const scenes=[
  {name:'基準（表示サイズ 中）'},
  {name:'表示サイズ 小',ui:'sm'},
  {name:'表示サイズ 大',ui:'lg'},
  {name:'既定の字の大きさ 20px',standard:20},
  {name:'画面の倍率 125%',dpr:1.25},
  {name:'画面 1536×864（フル HD・125%）',vw:[1536,864]},
  {name:'画面 1280×720',vw:[1280,720]},
  /* 利用者が自分で選ぶ設定（Edge の「最小フォント サイズ」）。デスクトップ版（WebView2）には利用者が変える口が無い。
     字は利用者の設定どおり大きくなる（それが設定の意図）ので P1 は数えるだけ・見切れないこと（P3）は守る。 */
  {name:'最小の字の大きさ 12px',minimum:12,honor:true},
 ];
 const got={};
 for(const sc of scenes){
  /* 最小の字の大きさは**本物の設定**（プロファイルの`webkit.webprefs.minimum_font_size`・Edge の「最小フォント サイズ」と同じ）で開く。 */
  const ctx=sc.minimum?await minimumContext(sc.minimum)
   :await browser.newContext({viewport:sc.vw?{width:sc.vw[0],height:sc.vw[1]}:{width:1728,height:1152},deviceScaleFactor:sc.dpr||1});
  const page=await ctx.newPage();
  try{
   const cdp=await ctx.newCDPSession(page);
   if(sc.standard)await cdp.send('Page.setFontSizes',{fontSizes:{standard:sc.standard,fixed:13}});
   await page.goto(B+'/',{waitUntil:'domcontentloaded'});
   await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
   await page.reload({waitUntil:'domcontentloaded'});
   await W.booted(page);
   await page.evaluate(ui=>WL.uiSize.setSize(ui||'md'),sc.ui||'');
   await page.evaluate(()=>WL.records.openRecordsSafe('編集中'));
   await page.waitForSelector('.record-list-row',{timeout:25000});
   /* 物差しが切れを見つけられるかの確かめ（欠陥の注入）。指定があるときだけ紙の字を大きくする（描く前に当て、紙の割り付けにも通す）。 */
   if(process.env.WAVELOG_RPPAPER_INJECT)await page.addStyleTag({content:'#reportContent *{font-size:'+process.env.WAVELOG_RPPAPER_INJECT+'px!important}'});
   await W.openRecordReport(page);
   await page.waitForSelector('#reportContent .rp-blocks',{timeout:25000});
   await page.evaluate(()=>document.fonts&&document.fonts.ready);
   await settle(page);
   const screen=await observe(page);
   await page.emulateMedia({media:'print'});await settle(page);
   const paper=await observe(page);
   got[sc.name]={screen,paper,ui:await page.evaluate(()=>document.documentElement.getAttribute('data-ui-size')||'md')};
  }finally{await ctx.close()}
 }
 const base=got[scenes[0].name];
 const same=(a,b)=>{const ks=Object.keys(b.fonts);const n=ks.filter(k=>a.fonts[k]===b.fonts[k]).length;return {n,all:ks.length,diff:ks.filter(k=>a.fonts[k]!==b.fonts[k]).slice(0,3).map(k=>`${k.split('/').slice(-3).join('/')} ${b.fonts[k]}→${a.fonts[k]}`)}};
 for(const sc of scenes){
  const g=got[sc.name];
  for(const side of ['screen','paper']){
   const a=g[side],b=base[side],s=same(a,b),label=side==='screen'?'プレビュー':'刷る書類';
   if(sc.honor)console.log(`MEASURE: ${sc.name}・${label}: 字の大きさが基準と同じ要素 ${s.n}/${s.all}（利用者の設定どおり大きくなる）`);
   else if(sc!==scenes[0]){
    rec(`P1. ${sc.name}・${label}: 紙の字の大きさが基準と同じ`,s.n===s.all,`${s.n}/${s.all}（表示サイズ ${g.ui}）${s.diff.join(' ')}`);
    rec(`P2. ${sc.name}・${label}: 縮める倍率と紙の枚数が基準と同じ`,a.fit===b.fit&&a.sheets===b.sheets,`倍率 ${b.fit} → ${a.fit}・${b.sheets}枚 → ${a.sheets}枚`);
   }
   if(side==='screen')rec(`P4. ${sc.name}: 紙が横に切れずプレビューの中で読める（はみ出すぶんは送って見られる）`,a.reach,a.reachWhy);
   rec(`P3. ${sc.name}・${label}: 紙の中で切れている要素 0`,!a.cut.length,`${a.cut.length}件 ${a.cut.slice(0,3).join(' / ')}`);
  }
 }
},{viewport:{width:1728,height:1152}});
