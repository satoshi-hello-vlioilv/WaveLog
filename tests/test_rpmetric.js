/* test_rpmetric.js: 帳票の紙の字の幅は、PC の字の描き方の設定（字送りを画素にそろえるか）で変わらない（§9.625）
   ============================================================
   利用者の報告「アプリ内のプレビューはOKでしたが、印刷のプレビューで同様の現象が発生しています」
   （Latitude 3550・1920×1080・100%。寸法の「製造」の行・運転条件の3段目・測定データの33〜40条が切れる）。
   印刷は画面で測り終えた割り付けを写して刷る（`rpPageHtmlFor()`）。画面の字送りは字を画素にそろえる設定
   （ヒンティング・100%の画面で効く）だと字の幅が変わり、刷るときの字の幅と食い違う。食い違えば、刷った紙で字が
   折り返し、画面で測った器から切れる。

   物差し（評価関数）: 同じロットの帳票を、字送りを画素にそろえない環境（既定）とそろえる環境（fontconfig の
   hinting=hintfull）の2つで開き、紙の中を比べる。
    M1. 字を持つ要素の幅が2つの環境で同じ（差 0.5% 以内）要素の割合 ＝ 100%
    M2. 塊の行の割り当て（`grid-row`）と縮める倍率（`--rp-fit`）が2つの環境で同じ
   ============================================================ */
'use strict';
const {run,seedRecord,launchBrowser}=require('./lib/harness.js');
const fs=require('fs'),os=require('os'),pathm=require('path');
const B='http://127.0.0.1:5029',EQ='テスト設備A';
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const HINTED=`<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>
<include ignore_missing="yes">/etc/fonts/fonts.conf</include>
<match target="font"><edit name="hinting" mode="assign"><bool>true</bool></edit>
<edit name="hintstyle" mode="assign"><const>hintfull</const></edit></match></fontconfig>`;
async function observe(browser,W){
 const ctx=await browser.newContext({viewport:{width:1920,height:1080}});const page=await ctx.newPage();
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);
  await page.evaluate(()=>WL.records.openRecordsSafe('編集中'));
  await W.openRecordReport(page,{has:'L0001'});
  await page.waitForSelector('#reportContent .rp-blocks',{timeout:25000});
  await page.evaluate(()=>document.fonts&&document.fonts.ready);
  await settle(page);await settle(page);
  return await page.evaluate(()=>{
   const pg=document.getElementById('reportContent');
   const path=el=>{const p=[];for(let e=el;e&&e!==pg;e=e.parentElement)p.push(e.tagName+[...e.parentElement.children].indexOf(e));return p.reverse().join('/')};
   const widths={};
   for(const el of pg.querySelectorAll('*')){
    if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;
    const r=document.createRange();r.selectNodeContents(el);
    widths[path(el)+'「'+el.textContent.trim().slice(0,10)+'」']=r.getBoundingClientRect().width;
   }
   const blocks={};
   for(const b of pg.querySelectorAll('[data-rp-block]')){const f=b.querySelector(':scope>.rp-block-fit');
    blocks[b.dataset.rpBlock]=(b.style.gridRowEnd||b.style.gridRow||'')+' fit='+((f&&f.style.getPropertyValue('--rp-fit'))||1)}
   return {widths,blocks};
  });
 }finally{await ctx.close()}
}
run('test_rpmetric: 紙の字の幅は字の描き方の設定で変わらない（§9.625）', async ({browser,rec,W})=>{
 const id=await seedRecord({lotNo:'L0001'});
 const dir=fs.mkdtempSync(pathm.join(os.tmpdir(),'wl-rpmetric-'));const conf=pathm.join(dir,'fonts.conf');
 fs.writeFileSync(conf,HINTED);
 const hinted=await launchBrowser({FONTCONFIG_FILE:conf});
 try{
  const a=await observe(browser,W),b=await observe(hinted,W);
  const ks=Object.keys(a.widths).filter(k=>k in b.widths&&a.widths[k]>0);
  const off=ks.filter(k=>Math.abs(b.widths[k]-a.widths[k])>a.widths[k]*0.005);
  const worst=off.map(k=>[k,b.widths[k]/a.widths[k]]).sort((x,y)=>Math.abs(y[1]-1)-Math.abs(x[1]-1)).slice(0,3)
   .map(([k,r])=>`${k.split('/').pop()} ×${r.toFixed(3)}`);
  console.log(`MEASURE: 幅が同じ要素 ${ks.length-off.length}/${ks.length}`);
  rec('M1. 字を持つ要素の幅が2つの環境で同じ（差 0.5% 以内）',!off.length&&ks.length>50,`${ks.length-off.length}/${ks.length} ${worst.join(' ')}`);
  const diff=Object.keys(a.blocks).filter(k=>a.blocks[k]!==b.blocks[k]).map(k=>`${k}: ${a.blocks[k]} → ${b.blocks[k]}`);
  rec('M2. 塊の行の割り当てと縮める倍率が2つの環境で同じ',!diff.length,diff.slice(0,4).join(' / ')||'同じ');
 }finally{
  await hinted.close();fs.rmSync(dir,{recursive:true,force:true});
  await fetch(B+'/api/measurement/backup/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[id]})}).catch(()=>{});
 }
},{viewport:{width:1920,height:1080}});
