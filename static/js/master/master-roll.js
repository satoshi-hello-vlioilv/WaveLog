"use strict";
/* master-roll.js: ロールマスタの表の計算の列（§9.537、利用者の選択 C-4）
   ============================================================
   「C-4でお願いします。」——図を別に置かず、いまの表の右に
     1周の長さ（数）・1周の帯（全行で同じ目盛り）・見分けにくい相手（札）の3列を足す。

   判定は測定画面の異常位置判定（`WL.defect.rollMatches()`）と**同じ計算**を通す
   （`WL.defect.rollConfusions()`。帯は`rollBand()`）。ここは字と絵を作るだけ。
   盤（master-maint.js）は列の種類を知らない——`WL.mm.registerCell()`で名乗る。
   ============================================================ */
(function(){
 const D=()=>window.WL&&WL.defect;
 const f1=v=>String(Math.round(v*10)/10);
 const STEP=200;   // 帯の目盛りの刻み（mm）。全行で同じ目盛りにする。
 /* ロールの呼び名（同じ名前のロールを見分ける: 入出位置・接触面）。 */
 const labelOf=r=>`${r.name||'（名前なし）'}（${[r.entryPos,r.contactFace].filter(Boolean).join('・')||'位置なし'}）`;
 /* 当たる面の色（字は接触面の列が言う）。 */
 const FACE_TONE={'上':'up','下':'dn','上下':'ud'};
 /* 印: ＝ 1周が重なる／×n その n倍の1周（n回に1回だけ数えると重なる）／÷n 1周に n箇所なら重なる。 */
 const MARK={direct:()=>'＝',multi:n=>`×${n}`,divide:n=>`÷${n}`};
 const lapText=b=>b?(b.cLo===b.cHi?f1(b.cLo):`${f1(b.cLo)}〜${f1(b.cHi)}`):'';

 /* 表の全行で1回: 行 → {band, partners}・目盛り。見分けにくい相手は**同じ設備の中だけ**で探す。 */
 function prep(items){
  const by=new Map(),out=new Map(),d=D();
  (items||[]).forEach(it=>{const k=String(it.equipment||'');if(!by.has(k))by.set(k,[]);by.get(k).push(it)});
  by.forEach(list=>{
   const cf=d&&d.rollConfusions?d.rollConfusions(list,2):list.map(()=>[]);
   list.forEach((it,i)=>out.set(it,{band:d&&d.rollBand?d.rollBand(it):null,partners:cf[i]||[]}));
  });
  const bands=[...out.values()].map(x=>x.band).filter(Boolean);
  const lo=bands.length?Math.floor(Math.min(...bands.map(b=>b.cLo))/STEP)*STEP:0;
  const hi=bands.length?Math.ceil(Math.max(...bands.map(b=>b.cHi))/STEP)*STEP:STEP;
  return {rows:out,lo,hi:hi>lo?hi:lo+STEP};
 }
 const rowOf=(it,ctx)=>(ctx&&ctx.rows.get(it))||{band:null,partners:[]};
 const partnerText=p=>`${MARK[p.kind](p.n)} ${labelOf(p.roll)}`;

 WL.mm.registerCell('rollLap',{prep,text:(it,ctx)=>lapText(rowOf(it,ctx).band)});
 WL.mm.registerCell('rollLapBar',{prep,
  label:ctx=>`1周 ${ctx.lo}〜${ctx.hi}`,
  text:(it,ctx)=>{const b=rowOf(it,ctx).band;return b?`1周 ${lapText(b)} mm（目盛り ${ctx.lo}〜${ctx.hi}mm）`:''},
  html:(it,ctx)=>{
   const b=rowOf(it,ctx).band;if(!b)return '';
   /* 位置は目盛りに対する割合（データの値なので style で渡す）。径MINが無いロールは1点＝小さな丸。 */
   const x=c=>(c-ctx.lo)/(ctx.hi-ctx.lo)*100,tone=FACE_TONE[String(it.contactFace||'').trim()]||'na';
   const w=b.cLo===b.cHi?0:x(b.cHi)-x(b.cLo);
   return `<span class="mm-rl" aria-hidden="true"><i class="mm-rl-b is-${tone}${w?'':' is-pt'}" style="left:${x(b.cLo).toFixed(2)}%${w?`;width:${w.toFixed(2)}%`:''}"></i></span>`;
  }});
 WL.mm.registerCell('rollConfuse',{prep,
  text:(it,ctx)=>rowOf(it,ctx).partners.map(partnerText).join('、'),
  html:(it,ctx)=>rowOf(it,ctx).partners.map(p=>
   `<i class="mm-rc${p.kind==='direct'?' is-eq':''}">${esc(partnerText(p))}</i>`).join('')});
})();
