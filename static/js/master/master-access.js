"use strict";
/* master-access.js: アクセス権限マスタの「できること」（§9.538、利用者の選択 D-6＋D-10）
   ============================================================
   「D-6とD-10の組み合わせでお願いします。」
   主役は**端末の登録の一覧**のまま（利用者の指摘「今のユーザーの登録状況の方が表示が追いやられて
   ほとんどみえてない」）。補う面を2つ、盤の登録表へ名乗る:
     タブ「できることの見張り」… 端末×できることの行列と、できる端末の台数（1台以下は⚠）。
                                  タブの札が⚠の数を言うので、開かなくても何かあることは分かる。
     行を開く（▸）               … その端末のできること（群ごとの ○△×）。
   判定は**サーバーの1箇所**（`permission_capabilities()`・`permission_watch()`）——ここは描くだけ。
   ============================================================ */
(function(){
 const MARK={yes:['○','できる'],limited:['△','条件つき'],no:['×','できない']};
 const mark=(st,note)=>{const m=MARK[st]||MARK.no;
  return `<span class="mm-cap is-${esc(st)}" title="${esc(m[1]+(note?'（'+note+'）':''))}">${m[0]}</span>`};
 const defsOf=ctx=>Array.isArray(ctx.meta.capDefs)?ctx.meta.capDefs:[];
 const groupsOf=defs=>[...new Set(defs.map(d=>d.group))];
 const capOf=(it,key)=>(it.caps||[]).find(x=>x.key===key)||{state:'no',note:''};
 const who=it=>it.loginId&&it.pcName?`${it.loginId}＠${it.pcName}`:(it.loginId||it.pcName||'（空欄）');
 const ROLE_TONE={'開発者':3,'メンテナンス者':2,'一般ユーザー':1,'設備作業者':0};
 const roleTag=r=>`<i class="mm-roletag r${ROLE_TONE[r]??1}">${esc(r||'')}</i>`;
 const lone=ctx=>((ctx.meta.capWatch||{}).lone)||[];
 const count=(ctx,key)=>(((ctx.meta.capWatch||{}).counts)||{})[key]??0;

 /* 行を開く: その端末のできること（群ごと・条件つきは条件を字で）。 */
 WL.mm.registerRowDetail('permCaps',{html:(it,ctx)=>{
  const defs=defsOf(ctx);
  return `<div class="mm-capcols">${groupsOf(defs).map(g=>`<section><h4>${esc(g)}</h4>${defs.filter(d=>d.group===g).map(d=>{
   const c=capOf(it,d.key);
   return `<p class="mm-capli is-${esc(c.state)}">${mark(c.state,c.note)}<span>${esc(d.label)}</span>${c.state==='limited'&&c.note?`<small>${esc(c.note)}</small>`:''}</p>`;
  }).join('')}</section>`).join('')}</div>`;
 }});

 /* タブ「できることの見張り」: 行＝できること、列＝登録した端末、右端＝できる端末の台数。 */
 WL.mm.registerListView('permWatch',{label:'できることの見張り',
  badge:ctx=>{const n=lone(ctx).length;return n?{text:`⚠ ${n}`,tone:'warn'}:{text:'問題なし'}},
  html:ctx=>{
   const defs=defsOf(ctx),items=ctx.items,lo=new Set(lone(ctx));
   if(!items.length)return '<div class="mm-empty">登録した端末がありません（登録の無い端末は「一般ユーザー・編集可」として扱われます）。</div>';
   /* 台数は**できることのすぐ右**（端末が増えて横へ送っても、見張りの答えは見切れない）。 */
   const head=`<tr><th class="l">できること</th><th class="n">できる端末</th>${items.map(it=>`<th title="${esc(who(it))}">${roleTag(it.role)}${[it.loginId,it.pcName].filter(Boolean).map(x=>`<small>${esc(x)}</small>`).join('')||'<small>（空欄）</small>'}</th>`).join('')}</tr>`;
   const body=groupsOf(defs).map(g=>`<tr class="grp"><th colspan="${items.length+2}">${esc(g)}</th></tr>`+defs.filter(d=>d.group===g).map(d=>
    `<tr${lo.has(d.key)?' class="is-lone"':''}><th class="l">${esc(d.label)}</th><td class="n"><b class="mm-capn${lo.has(d.key)?' is-low':''}">${count(ctx,d.key)}台</b></td>`
    +`${items.map(it=>{const c=capOf(it,d.key);return `<td>${mark(c.state,c.note)}</td>`}).join('')}</tr>`).join('')).join('');
   const names=defs.filter(d=>lo.has(d.key)).map(d=>`「${esc(d.label)}」`).join('');
   return `<p class="mm-lview-lead">登録した端末ごとに、いま実際にできることです（区分の上限・編集可否を掛けたあと）。「できる端末」は<b>その台数</b>で、<b>1台以下</b>はその端末が使えなくなると誰もできなくなります。登録の無い端末は数えていません。</p>`
    +`<div class="mm-capmx"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`
    +(names?`<p class="mm-lview-warn">⚠ ${names}ができる端末は1台以下です。もう1台に同じ設定を付けると解けます。</p>`:'');
  }});
})();
