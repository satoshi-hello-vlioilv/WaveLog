"use strict";
/* master-equse.js: 設備の使い分けの表と効き先の図（§9.542、利用者の選択 G-2＋G-4）
   ============================================================
   「G-2とG-4の組み合わせでお願いします。」
   主役は**設備の一覧**のまま（1枚目のタブ）。2枚目のタブ「使い分けの表」に:
     使い分けの表（G-2）… 設備×使う機能・入力内容の○。**多数派と違うセルは橙**、行の頭に「Nか所」・タブの札に合計。
                          セルを押すとその場で切り替わる（保存は1回ずつ）。乗せると「外すと何が起き、何が残るか」が浮く。
     効き先の図（G-4）  … 選んだ設備の設定が、どの画面のどこに効くか（機能ごとの1レーン・測定のレーンに入力内容の札）。
                          設備名を押すとその設備になる。表のセルに乗せると、図の同じ所が光る。
   答え（多数派・違い・効かないセル）は`useMatrix()`の1箇所（画面を知らない・網が直に呼ぶ）。
   語彙（機能・入力内容・外すと／残るもの・入力内容が効く機能）は**サーバーが答える**（§9.163）——ここは描くだけ。
   ============================================================ */
(function(){
 const featsOf=ctx=>Array.isArray(ctx.meta.equipmentFeatures)?ctx.meta.equipmentFeatures:[];
 const itemsOf=ctx=>Array.isArray(ctx.meta.measureItems)?ctx.meta.measureItems:[];
 const effOf=ctx=>ctx.meta.measureItemEffect||{};
 let selId=null;   // 効き先の図に出している設備（この端末の画面の間だけ覚える）

 /* ---------- 答え（画面を知らない） ----------
    多数派＝その列で**半分以上の設備がしている側**（同数は「使う」＝既定の側）。数えるのは:
      機能     … どこにも出ない設備（機能を全部外した設備）を除く
      入力内容 … そのうち、入力内容が効く機能（`dep`・測定）を使う設備だけ（ほかでは入力内容は効かない＝`null`） */
 function useMatrix(items,feats,mitems,dep){
  const fk=feats.map(f=>f.key),ik=mitems.map(i=>i.key);
  const rows=items.map(it=>{
   const offF=new Set(it.disabledFeatures||[]),offI=new Set(it.disabledMeasureItems||[]);
   const f=Object.fromEntries(fk.map(k=>[k,!offF.has(k)]));
   const measures=dep?f[dep]!==false:true;
   return {it,f,i:Object.fromEntries(ik.map(k=>[k,measures?!offI.has(k):null])),measures,dead:fk.length>0&&fk.every(k=>!f[k])};
  });
  const live=rows.filter(r=>!r.dead),meas=live.filter(r=>r.measures);
  const tally=(pool,get)=>({n:pool.filter(get).length,of:pool.length});
  const cntF=Object.fromEntries(fk.map(k=>[k,tally(live,r=>r.f[k])]));
  const cntI=Object.fromEntries(ik.map(k=>[k,tally(meas,r=>r.i[k])]));
  const major=c=>c.n*2>=c.of;
  rows.forEach(r=>{
   r.diff=r.dead?[]:fk.filter(k=>r.f[k]!==major(cntF[k])).concat(r.measures?ik.filter(k=>r.i[k]!==major(cntI[k])):[]);
   r.sig=fk.map(k=>+r.f[k]).join('')+'|'+ik.map(k=>r.i[k]===null?'-':+r.i[k]).join('');
  });
  rows.forEach(r=>{r.same=rows.filter(x=>x!==r&&x.sig===r.sig).map(x=>x.it.name)});
  return {rows,cntF,cntI,majF:Object.fromEntries(fk.map(k=>[k,major(cntF[k])])),
   majI:Object.fromEntries(ik.map(k=>[k,major(cntI[k])])),total:rows.reduce((a,r)=>a+r.diff.length,0)};
 }
 /* 入力内容の列の群（群・単位）。答えは測定画面の`WL.measureItem.GROUPS`の1箇所——無い項目は「その他」。 */
 function itemGroups(mitems){
  const at=new Map();
  ((WL.measureItem&&WL.measureItem.GROUPS)||[]).forEach(g=>g.units.forEach(u=>u.items.forEach(n=>at.set(n,{group:g.group,unit:u.unit}))));
  const out=[];
  mitems.forEach(m=>{const g=at.get(m.key)||{group:'その他',unit:''},last=out[out.length-1];
   if(last&&last.group===g.group&&last.unit===g.unit)last.items.push(m);else out.push({...g,items:[m]})});
  return out;
 }
 const matrixOf=ctx=>useMatrix(ctx.items,featsOf(ctx),itemsOf(ctx),effOf(ctx).feature||'');
 const picked=(ctx,mx)=>mx.rows.find(r=>String(r.it.id)===String(selId))
  ||mx.rows.reduce((a,r)=>(r.diff.length>a.diff.length?r:a),mx.rows[0]);

 /* ---------- 使い分けの表（G-2） ---------- */
 function cellHtml(r,kind,m,ctx,first){
  const v=kind==='f'?r.f[m.key]:r.i[m.key];
  const base=`data-eu-cell data-eu-eq="${esc(r.it.name)}" data-eu-id="${esc(r.it.id)}" data-eu-kind="${kind}" data-eu-key="${esc(m.key)}"`;
  const gl=first?' eu-gl':'';
  if(v===null)return `<td class="eu-c${gl}"><span class="eu-na" ${base} title="${esc(r.it.name)}：測定を使わないので、入力内容は効きません"></span></td>`;
  const diff=r.diff.includes(m.key)?' is-diff':'';
  const word=`${r.it.name}・${m.label}：${v?'使う':'使わない'}`+(diff?'（多数派と違う）':'');
  const tag=ctx.writable?'button':'span',act=ctx.writable?` type="button" aria-pressed="${v}" aria-label="${esc(word+'。押すと'+(v?'外す':'使う'))}"`:` title="${esc(word)}"`;
  return `<td class="eu-c${gl}${diff}"><${tag} class="eu-dot${v?' is-on':''}" ${base} data-on="${v?1:0}"${act}></${tag}></td>`;
 }
 function tableHtml(ctx,mx){
  const feats=featsOf(ctx),groups=itemGroups(itemsOf(ctx)),sel=picked(ctx,mx);
  const bar=(c,first)=>`<td class="eu-c eu-n${first?' eu-gl':''}">${c.n}/${c.of}<i class="eu-bar"><b style="width:${c.of?Math.round(c.n/c.of*100):0}%"></b></i></td>`;
  const head1=`<tr class="eu-g"><th colspan="2"></th><th colspan="${feats.length}" class="eu-gl">使える機能</th>`
   +groups.map(g=>`<th colspan="${g.items.length}" class="eu-gl">${esc(g.group)}${g.unit?`<small>${esc(g.unit)}</small>`:''}</th>`).join('')+`</tr>`;
  const head2=`<tr><th class="eu-name">設備</th><th class="eu-dh">多数派との違い</th>`
   +feats.map((f,i)=>`<th class="eu-ch${i?'':' eu-gl'}" title="${esc(f.note||'')}">${esc(f.label)}</th>`).join('')
   +groups.map(g=>g.items.map((m,i)=>`<th class="eu-ch${i?'':' eu-gl'}" title="${esc(m.note||'')}">${esc(m.label)}</th>`).join('')).join('')+`</tr>`;
  const body=mx.rows.map(r=>{
   const n=r.diff.length,on=r===sel;
   const pill=r.dead?'<span class="eu-pill is-none">どこにも出ない</span>':n?`<span class="eu-pill is-warn">${n}か所</span>`:'<span class="eu-pill is-ok">そろっている</span>';
   return `<tr class="${on?'is-sel':''}${r.dead?' is-dead':''}"><th class="eu-name"><button type="button" data-eu-pick data-eu-eq="${esc(r.it.name)}" data-eu-id="${esc(r.it.id)}" aria-pressed="${on}" title="押すと、下の効き先の図がこの設備になります">${esc(r.it.name)}</button></th>`
    +`<td class="eu-dc"><span data-eu-diff="${n}" data-eu-eq="${esc(r.it.name)}">${pill}</span>${r.same.length?`<small>＝${esc(r.same.join('・'))}と同じ</small>`:''}</td>`
    +feats.map((f,i)=>cellHtml(r,'f',f,ctx,!i)).join('')
    +groups.map(g=>g.items.map((m,i)=>cellHtml(r,'i',m,ctx,!i)).join('')).join('')+`</tr>`;
  }).join('');
  const foot=`<tr><th class="eu-name"></th><td class="eu-dc eu-n">使う設備</td>${feats.map((f,i)=>bar(mx.cntF[f.key],!i)).join('')}${groups.map(g=>g.items.map((m,i)=>bar(mx.cntI[m.key],!i)).join('')).join('')}</tr>`;
  return `<div class="eu-mx"><table><thead>${head1}${head2}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
 }

 /* ---------- 効き先の図（G-4） ----------
    左＝設備、右＝機能ごとの1レーン（実線＝効いている・破線＝外した）。測定のレーンは入力内容の札を持つ。
    字（外すと／残るもの）はサーバーの語彙。表のセルに乗せると、図の同じ所（`data-eu-at`）が光る。 */
 function flowHtml(ctx,mx){
  const r=picked(ctx,mx);if(!r)return '';
  const eff=effOf(ctx),groups=itemGroups(itemsOf(ctx));
  const lanes=featsOf(ctx).map(f=>{
   const on=r.f[f.key];
   const items=f.key===eff.feature?itemsLane(r,groups,eff):'';
   return `<div class="eu-lane${on?' is-on':' is-off'}" data-eu-lane="${esc(f.key)}" data-on="${on?1:0}" data-eu-at="f:${esc(f.key)}">`
    +`<p class="eu-lh"><b>${on?'✓':'✕'} ${esc(f.label)}</b><small>${esc(f.note||'')}</small></p>`
    +(on?`<p class="eu-lw">外すと：${esc(f.off||'')}</p>`:`<p class="eu-lw is-off">外してある：${esc(f.off||'')}。${esc(f.keep||'')}。</p>`)
    +items+`</div>`;
  }).join('');
  return `<div class="eu-flow"><p class="eu-fcap">効き先の図 — <b>${esc(r.it.name)}</b> の設定が、どの画面のどこに効くか<small>（設備名を押すと切り替わります）</small></p>`
   +`<div class="eu-fl"><div class="eu-eq"><b>${esc(r.it.name)}</b><small>${esc(r.it.kind||'区分 未設定')}</small></div><div class="eu-lanes">${lanes}</div></div></div>`;
 }
 function itemsLane(r,groups,eff){
  if(!r.measures)return `<p class="eu-lw is-off">測定を使わないので、入力内容は効きません。</p>`;
  const chips=groups.map(g=>`<span class="eu-ig"><small>${esc(g.group)}${g.unit?'・'+esc(g.unit):''}</small>`
   +g.items.map(m=>`<i class="eu-chip${r.i[m.key]?' is-on':' is-off'}" data-eu-at="i:${esc(m.key)}">${esc(m.label)}</i>`).join('')+`</span>`).join('');
  const all=groups.flatMap(g=>g.items),off=all.filter(m=>!r.i[m.key]);
  return `<div class="eu-chips">${chips}</div><p class="eu-lw">入力内容 ${all.length-off.length}/${all.length} を出す`
   +(off.length?`。外した ${off.length}つ（${esc(off.map(m=>m.label).join('・'))}）は、${esc(eff.off||'')}。${esc(eff.keep||'')}。`:'')+`</p>`;
 }

 /* ---------- 乗せると浮く面（外すと何が起き、何が残るか） ---------- */
 function peekHtml(ctx,mx,el){
  const r=mx.rows.find(x=>String(x.it.id)===el.dataset.euId),kind=el.dataset.euKind,key=el.dataset.euKey;
  const m=(kind==='f'?featsOf(ctx):itemsOf(ctx)).find(x=>x.key===key);if(!r||!m)return '';
  const v=kind==='f'?r.f[key]:r.i[key],c=kind==='f'?mx.cntF[key]:mx.cntI[key],eff=kind==='f'?m:effOf(ctx);
  const major=kind==='f'?mx.majF[key]:mx.majI[key];
  return `<h4>${esc(r.it.name)} × ${esc(m.label)} — いま「${v?'使う':'使わない'}」</h4>`
   +`<p>${v!==major?`<b class="eu-pw">多数派と違う</b>（使う設備は ${c.n}/${c.of}台）`:`多数派と同じ（使う設備は ${c.n}/${c.of}台）`}</p>`
   +`<p>${v?'外すと':'外してある'}：${esc(eff.off||'')}</p><p>残るもの：${esc(eff.keep||'')}</p>`
   +(ctx.writable?`<p class="eu-pgo">押すと「${v?'使わない':'使う'}」にして保存します（もう一度押すと戻ります）。</p>`:'<p class="eu-pgo">この端末では読むだけです（マスタ編集の権限）。</p>');
 }

 /* ---------- 押す＝その場で切り替えて保存 ----------
    更新の口は**全欄を書く**（名前・区分・最大条数・標準時間・最大ライン速度）ので、行の値をそのまま添える。
    入力内容を全部外す形はサーバーが400で断る——その文をそのまま出す（§CLAUDE 4）。 */
 async function flip(ctx,el){
  const uid=WL.mm.requireMaintUser();if(uid===null)return;
  const it=ctx.items.find(x=>String(x.id)===el.dataset.euId);if(!it)return;
  const fld=el.dataset.euKind==='f'?'disabledFeatures':'disabledMeasureItems',key=el.dataset.euKey,on=el.dataset.on==='1';
  const off=new Set(it[fld]||[]);if(on)off.add(key);else off.delete(key);
  const m=(el.dataset.euKind==='f'?featsOf(ctx):itemsOf(ctx)).find(x=>x.key===key)||{label:key};
  WL.popMenu.closePeek();
  try{
   WL.mm.setMaintLoading(true,`${it.name}の「${m.label}」を保存しています…`);
   await api('/api/equipment-master/update',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:it.id,name:it.name,kind:it.kind,maxStrips:it.maxStrips,standardMinutes:it.standardMinutes,
     maxLineSpeed:it.maxLineSpeed,[fld]:[...off],user_id:uid})});
   await WL.mm.loadMaint(true);
   showToast(`${it.name}：${m.label}を${on?'使わない':'使う'}形にしました`,'もう一度押すと戻ります。',3600);
  }catch(e){showToast('保存できませんでした',e.message,6500)}
  finally{WL.mm.setMaintLoading(false)}
 }
 function wire(sec,ctx){
  const mx=matrixOf(ctx);
  sec.querySelectorAll('[data-eu-pick]').forEach(b=>{b.onclick=()=>{selId=b.dataset.euId;
   const box=sec.querySelector('.eu-flowbox');if(box)box.innerHTML=flowHtml(ctx,mx);
   sec.querySelectorAll('tbody tr').forEach(tr=>{const p=tr.querySelector('[data-eu-pick]');const on=p===b;tr.classList.toggle('is-sel',on);p.setAttribute('aria-pressed',on)})}});
  sec.querySelectorAll('[data-eu-cell]').forEach(el=>{
   if(el.matches('.eu-na'))return;
   WL.popMenu.peek(el,{key:el.dataset.euId+'|'+el.dataset.euKey,cls:'eu-peek',side:'above',html:()=>peekHtml(ctx,mx,el)});
   const at=(el.dataset.euKind==='f'?'f:':'i:')+el.dataset.euKey;
   const hot=on=>{if(String(el.dataset.euId)!==String(picked(ctx,mx).it.id))return;
    sec.querySelectorAll(`.eu-flow [data-eu-at="${CSS.escape(at)}"]`).forEach(x=>x.classList.toggle('is-hot',on))};
   el.addEventListener('mouseenter',()=>hot(true));el.addEventListener('mouseleave',()=>hot(false));
   if(el.tagName==='BUTTON')el.onclick=()=>flip(ctx,el);
  });
 }

 WL.mm.registerListView('eqUse',{label:'使い分けの表',
  badge:ctx=>{const n=matrixOf(ctx).total;return n?{text:`違い ${n}`,tone:'warn'}:{text:'そろっている'}},
  html:ctx=>{
   if(!ctx.items.length)return '<div class="mm-empty">設備がありません（1枚目の一覧から設備を足してください）。</div>';
   const mx=matrixOf(ctx);
   return `<p class="mm-lview-lead">設備ごとの<b>使う機能</b>と<b>測定画面の入力内容</b>です。●＝使う、点線の○＝外した、—＝効かない（測定を使わない設備の入力内容）。`
    +`<b>橙のセル</b>は多数派（その列で半分以上の設備がしている側）と違う所です。${ctx.writable?'セルを押すとその場で切り替わり、':''}乗せると外したときに何が起き、何が残るかを出します。</p>`
    +tableHtml(ctx,mx)+`<div class="eu-flowbox">${flowHtml(ctx,mx)}</div>`;
  },
  wire});
 WL.equipUse={useMatrix,itemGroups};
})();
