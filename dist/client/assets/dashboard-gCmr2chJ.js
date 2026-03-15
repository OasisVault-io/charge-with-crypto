import"./app-DvhYwCcL.js";const D=new URLSearchParams(window.location.search).get("merchantId")||"merchant_demo",H="/charge-with-crypto-mark.svg",I="charge-with-crypto.dashboard-token";let i=null,E=null,f="",d=[],u=null,$="overview",h=localStorage.getItem(I)||"",P=!1,p={search:"",status:"all",method:"all",range:"30d"};async function R(e,n){const t=new Headers(n?.headers||{});h&&t.set("x-dashboard-token",h);const a=await fetch(e,{...n,headers:t}),s=await a.json();if(!a.ok)throw new Error(s.error||s.message||`HTTP ${a.status}`);return s}function k(e,n=""){P=!!e,document.querySelectorAll("#merchantForm input, #merchantForm textarea, #merchantForm select, #merchantForm button").forEach(t=>{t.disabled=!P}),document.querySelectorAll("#checkoutForm input, #checkoutForm textarea, #checkoutForm select, #checkoutForm button").forEach(t=>{t.disabled=!P}),document.getElementById("dashboardAuthPanel").hidden=P||!i?.dashboardAuthConfigured,document.getElementById("dashboardAuthStatus").textContent=n}function V(e,n,t){return`<label class="checkbox-pill"><input type="checkbox" name="${e}" value="${n}" /> <span>${t}</span></label>`}function m(e,n="evm"){return e==="bitcoin"||n==="bitcoin"?"bitcoin":"evm"}function w(e){return e==="bitcoin"?"bitcoin":"evm"}function S(e){return e==="BTC"?"bitcoin":"evm"}function ce({paymentRail:e,enabledChains:n=[],acceptedAssets:t=[],fallback:a="evm"}={}){const s=e?m(e,a):"";if(s)return s;const c=[...new Set([...(n||[]).map(l=>w(l)),...(t||[]).map(l=>S(l))])];return c.length===1?c[0]:m(a,"evm")}function j(e){return m(e)==="bitcoin"?"Bitcoin":"EVM"}function g(e,n,t){const a=t==="chain"?w:S;return(e||[]).filter(s=>a(s)===n)}function U(e,n){if(n==="chain"){const s=Object.keys(i?.chains||{}).filter(c=>w(c)===e);return e==="bitcoin"?s.slice(0,1):s.includes("base")?["base"]:s.slice(0,1)}const t=Object.keys(i?.assets||{}).filter(s=>S(s)===e);if(e==="bitcoin")return t.includes("BTC")?["BTC"]:t.slice(0,1);const a=["USDC","USDT"].filter(s=>t.includes(s));return a.length?a:t.slice(0,1)}function y(e){return`$${Number(e||0).toFixed(2)}`}function z(e){return e?new Date(e).toLocaleString():"n/a"}function oe(e){return Date.now()-Number(e)*24*60*60*1e3}function o(e){return String(e??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function le(e,n){const t={ethereum:"https://etherscan.io/tx/",base:"https://basescan.org/tx/",arbitrum:"https://arbiscan.io/tx/",polygon:"https://polygonscan.com/tx/"}[e];return t&&n?`${t}${n}`:""}function re(){return{id:`plan_${Math.random().toString(36).slice(2,8)}`,title:"New plan",description:"",amountUsd:10,paymentRail:"evm",enabledChains:["base"],acceptedAssets:["USDC","USDT"]}}function K(e){return e||H}function _(e){const n=document.getElementById("merchantLogoPreview");n.src=K(e),n.onerror=()=>{n.onerror=null,n.src=H}}function T(e,n){const t=new Set(n||[]);document.querySelectorAll(`#${e} input[type="checkbox"]`).forEach(a=>{a.checked=t.has(a.value)})}function B(e){return[...document.querySelectorAll(`#${e} input[type="checkbox"]:checked`)].map(n=>n.value)}function X(e,n,t,a=[]){const s=g(B(e),n,t),c=g(a,n,t),l=s.length?s:c;document.querySelectorAll(`#${e} .checkbox-pill`).forEach(r=>{const v=r.querySelector("input"),M=(t==="chain"?w(v.value):S(v.value))===n;r.hidden=!M,v.disabled=!M,M||(v.checked=!1)}),T(e,l)}function de(e){const n=document.getElementById("manualEngineStatus");if(!n)return;const t=e?.manualPayment||{configured:!1,sponsorAddress:"",derivationPath:"",evm:{}},a=t?.evm||{},s=!!t?.bitcoin?.configured;if(!t.configured){n.innerHTML=`
      <span class="badge warn">Server setup required</span>
      <span class="muted">Set an EVM xpub or legacy mnemonic plus RPC access before enabling manual pay for customers.</span>
    `;return}n.innerHTML=`
    <span class="badge ok">Engine configured</span>
    <span class="muted">EVM ${a.derivationMode||"disabled"} / ${a.sweepMode||"manual"} sweep</span>
    <span class="muted">Path ${t.derivationPath}</span>
    <span class="muted">Sponsor ${t.sponsorAddress||"n/a"}</span>
    <span class="muted">Bitcoin watcher ${s?"ready":"not configured"}</span>
  `}function G({group:e,value:n,label:t,checked:a}){return`<label class="checkbox-pill"><input type="checkbox" data-plan-group="${e}" value="${n}" ${a?"checked":""} /> <span>${t}</span></label>`}function C(e){const n=new Map((e.checkouts||[]).map(t=>[t.id,t]));return(e.payments||[]).filter(t=>n.has(t.checkoutId)).map(t=>({...t,checkout:n.get(t.checkoutId)})).sort((t,a)=>String(a.createdAt||"").localeCompare(String(t.createdAt||"")))}function x(e){return i?.chains?.[e]?.name||e||"Unknown"}function Q(e,n){return n==="bitcoin"?!!(e?.recipientAddresses?.bitcoin||e?.bitcoinXpub):!!e?.recipientAddresses?.[n]}function ie(e){return e==="confirmed"?"ok":"warn"}function ue(){return{brandName:document.getElementById("merchantBrandName")?.value.trim()||"",name:document.getElementById("merchantName")?.value.trim()||"",logoUrl:f||document.getElementById("merchantLogoUrl")?.value.trim()||"",headline:document.getElementById("merchantHeadline")?.value.trim()||"",description:document.getElementById("merchantDescription")?.value.trim()||""}}function L(){const e=document.getElementById("brandPreviewCard");if(!e)return;const n=ue(),t=n.brandName||n.name||"Merchant name",a=n.headline||"Fast wallet-first crypto checkout",s=n.description||"Customers connect a wallet, get one recommended route, and pay in one confirmation.";e.innerHTML=`
    <div class="brand-preview-head">
      <img class="summary-logo" src="${K(n.logoUrl)}" alt="${o(t)} logo" />
      <div class="stack-sm">
        <span class="eyebrow">Hosted checkout preview</span>
        <strong>${o(t)}</strong>
      </div>
    </div>
    <div class="brand-preview-copy">
      <strong>${o(a)}</strong>
      <p class="muted">${o(s)}</p>
    </div>
  `,e.querySelector("img")?.addEventListener("error",c=>{c.currentTarget.src=H},{once:!0})}function J(e){["merchantSaveStatus","merchantSettingsStatus","merchantPlansStatus"].forEach(t=>{const a=document.getElementById(t);a&&(a.textContent=e)})}function F(e,{syncHash:n=!0}={}){$=new Set(["overview","brand","settings","plans","checkout","payments","activity"]).has(e)?e:"overview",document.querySelectorAll("[data-dashboard-section]").forEach(a=>{a.classList.toggle("is-active",a.dataset.dashboardSection===$)}),document.querySelectorAll(".dashboard-panel").forEach(a=>{a.hidden=a.id!==`dashboardSection${$[0].toUpperCase()}${$.slice(1)}`}),n&&(window.location.hash=$)}function me(e,n){const t=document.getElementById("checkoutPlanId"),a=n??t.value;t.innerHTML=['<option value="">Custom checkout</option>'].concat((e||[]).map(s=>`<option value="${o(s.id)}" ${s.id===a?"selected":""}>${o(s.title)} (${o(s.id)})</option>`)).join(""),q(),O()}function b(e){const n=document.getElementById("checkoutPlanId")?.value||"";d=(e||[]).map(t=>({id:t.id||"",title:t.title||t.name||"",description:t.description||"",amountUsd:Number(t.amountUsd||0),paymentRail:ce(t),enabledChains:t.enabledChains||[],acceptedAssets:t.acceptedAssets||[]})),u!=null&&u>=d.length&&(u=d.length?d.length-1:null),document.getElementById("plansEditor").innerHTML=d.length?d.map((t,a)=>`
      <section class="card plan-card">
        <div class="plan-card-head">
          <div class="plan-card-summary">
            <div class="plan-title-row">
              <strong>${o(t.title||`Plan ${a+1}`)}</strong>
              <span class="badge ok">${y(t.amountUsd)}</span>
              <span class="code">${o(t.id||`plan_${a+1}`)}</span>
            </div>
            <div class="plan-meta-row">
              <span class="plan-meta-chip">${j(t.paymentRail)}</span>
              <span class="plan-meta-chip">${(t.enabledChains||[]).length} network${(t.enabledChains||[]).length===1?"":"s"}</span>
              <span class="plan-meta-chip">${o((t.acceptedAssets||[]).join(" · ")||"No assets selected")}</span>
              <span class="plan-meta-chip">${o(t.description||"No description yet")}</span>
            </div>
          </div>
          <div class="inline-actions">
            <button type="button" class="secondary-button" data-toggle-plan="${a}">${u===a?"Done":"Edit"}</button>
            <button type="button" class="secondary-button" data-duplicate-plan="${a}">Duplicate</button>
            <button type="button" class="ghost-warn" data-remove-plan="${a}">Remove</button>
          </div>
        </div>
        <div class="plan-editor" ${u===a?"":"hidden"}>
          <div class="field-grid">
            <label>
              Plan ID
              <input id="plan_id_${a}" value="${o(t.id)}" placeholder="pro_monthly" />
            </label>
            <label>
              Title
              <input id="plan_title_${a}" value="${o(t.title)}" placeholder="Pro monthly" />
            </label>
          </div>
          <div class="field-grid">
            <label>
              Payment rail
              <select id="plan_paymentRail_${a}">
                <option value="evm" ${t.paymentRail==="evm"?"selected":""}>EVM</option>
                <option value="bitcoin" ${t.paymentRail==="bitcoin"?"selected":""}>Bitcoin</option>
              </select>
            </label>
            <label>
              Amount USD
              <input id="plan_amount_${a}" type="number" min="0" step="0.01" value="${Number(t.amountUsd||0).toFixed(2)}" />
            </label>
            <label>
              Description
              <input id="plan_description_${a}" value="${o(t.description)}" placeholder="Describe what unlocks after payment" />
            </label>
          </div>
          <div class="field-stack">
            <div>
              <div class="eyebrow">Networks</div>
              <div class="checkbox-grid">
                ${Object.entries(i.chains).filter(([s])=>w(s)===t.paymentRail).map(([s,c])=>G({group:`chains_${a}`,value:s,label:c.name,checked:(t.enabledChains||[]).includes(s)})).join("")}
              </div>
            </div>
            <div>
              <div class="eyebrow">Accepted assets</div>
              <div class="checkbox-grid">
                ${Object.keys(i.assets).filter(s=>S(s)===t.paymentRail).map(s=>G({group:`assets_${a}`,value:s,label:s,checked:(t.acceptedAssets||[]).includes(s)})).join("")}
              </div>
            </div>
          </div>
        </div>
      </section>
    `).join(""):'<div class="muted">No plans configured yet.</div>',document.querySelectorAll("[data-toggle-plan]").forEach(t=>{t.addEventListener("click",()=>{const a=Number(t.dataset.togglePlan);u=u===a?null:a,b(Y())})}),document.querySelectorAll("[data-remove-plan]").forEach(t=>{t.addEventListener("click",()=>{d.splice(Number(t.dataset.removePlan),1),u===Number(t.dataset.removePlan)&&(u=null),b(d)})}),document.querySelectorAll("[data-duplicate-plan]").forEach(t=>{t.addEventListener("click",()=>{const a=d[Number(t.dataset.duplicatePlan)];a&&(d.splice(Number(t.dataset.duplicatePlan)+1,0,{...a,id:`${a.id||"plan"}_${Math.random().toString(36).slice(2,6)}`}),u=Number(t.dataset.duplicatePlan)+1,b(d))})}),document.querySelectorAll('[id^="plan_paymentRail_"]').forEach(t=>{t.addEventListener("change",()=>{const a=Number(t.id.replace("plan_paymentRail_","")),s=m(t.value),c=d[a];c&&(d[a]={...c,paymentRail:s,enabledChains:g(c.enabledChains,s,"chain").length?g(c.enabledChains,s,"chain"):U(s,"chain"),acceptedAssets:g(c.acceptedAssets,s,"asset").length?g(c.acceptedAssets,s,"asset"):U(s,"asset")},b(d))})}),me(d,n)}function Y(){return d.map((e,n)=>({id:document.getElementById(`plan_id_${n}`).value.trim(),title:document.getElementById(`plan_title_${n}`).value.trim(),description:document.getElementById(`plan_description_${n}`).value.trim(),amountUsd:Number(document.getElementById(`plan_amount_${n}`).value||0),paymentRail:m(document.getElementById(`plan_paymentRail_${n}`).value),enabledChains:[...document.querySelectorAll(`[data-plan-group="chains_${n}"]:checked`)].map(t=>t.value),acceptedAssets:[...document.querySelectorAll(`[data-plan-group="assets_${n}"]:checked`)].map(t=>t.value)}))}function O(){const e=document.getElementById("checkoutPlanId")?.value||"",n=document.getElementById("checkoutOverrides"),t=document.getElementById("checkoutPlanHelp");n&&(n.open=!e),t&&(t.textContent=e?"Stored plan selected. Open custom overrides only if this checkout needs one-off changes.":"No stored plan selected. Fill the custom overrides below to create a one-off checkout.")}function q(){const e=document.getElementById("checkoutPlanSummary");if(!e)return;const n=document.getElementById("checkoutPlanId")?.value||"",t=d.find(a=>a.id===n);if(!t){e.hidden=!0,e.innerHTML="";return}e.hidden=!1,e.innerHTML=`
    <span class="badge ok">Using stored plan</span>
    <strong>${o(t.title||t.id)}</strong>
    <span class="muted">${j(t.paymentRail)} · ${y(t.amountUsd)} · ${o((t.acceptedAssets||[]).join(" · ")||"No assets")} · ${o((t.enabledChains||[]).map(a=>x(a)).join(" · ")||"No networks")}</span>
  `}function he(){const e=document.getElementById("checkoutPlanId").value,n=d.find(t=>t.id===e);O(),q(),n&&(document.getElementById("checkoutTitle").value=n.title||"",document.getElementById("checkoutDescription").value=n.description||"",document.getElementById("checkoutAmountUsd").value=Number(n.amountUsd||0).toFixed(2),document.getElementById("checkoutPaymentRail").value=m(n.paymentRail),W({preferredChains:n.enabledChains||[],preferredAssets:n.acceptedAssets||[]}))}function pe(e){const n=Object.entries(e.chains).map(([a,s])=>V("chain",a,s.name)).join(""),t=Object.keys(e.assets).map(a=>V("asset",a,a)).join("");document.getElementById("merchantChains").innerHTML=n,document.getElementById("merchantAssets").innerHTML=t,document.getElementById("checkoutChains").innerHTML=n,document.getElementById("checkoutAssets").innerHTML=t,document.getElementById("merchantChainSettings").innerHTML=Object.entries(e.chains).map(([a,s],c)=>`
    <details class="chain-setting-card" ${c===0?"open":""}>
      <summary>
        <div class="chain-setting-summary">
          <strong>${s.name}</strong>
          <span class="muted">Receiving address and manual pay toggle</span>
        </div>
        <span class="badge">Edit</span>
      </summary>
      <div class="chain-setting-body field-stack">
        <label>
          Receiving address
          <input id="recipient_${a}" placeholder="${a==="bitcoin"?"bc1...":"0x..."}" />
        </label>
        <label class="checkbox-pill">
          <input id="manualEnabled_${a}" type="checkbox" />
          <span>Enable manual pay on ${s.name}</span>
        </label>
      </div>
    </details>
  `).join(""),de(e)}function Z(){return m(document.getElementById("checkoutPaymentRail")?.value||"evm")}function ge(e){const n=E?.merchant||{};return{chains:g(n.enabledChains||[],e,"chain"),assets:g(n.defaultAcceptedAssets||[],e,"asset")}}function W({preferredChains:e=null,preferredAssets:n=null}={}){const t=Z(),a=ge(t),s=e||(a.chains.length?a.chains:U(t,"chain")),c=n||(a.assets.length?a.assets:U(t,"asset"));X("checkoutChains",t,"chain",s),X("checkoutAssets",t,"asset",c)}function ye(e){const n=C(e),t=e.checkouts.filter(c=>c.status!=="paid").length,a=n.filter(c=>c.status==="confirmed").length,s=n.filter(c=>c.status==="confirmed").reduce((c,l)=>c+Number(l.checkout?.amountUsd||0),0);document.getElementById("statsGrid").innerHTML=`
    <article class="card stat-card">
      <span class="eyebrow">Open checkouts</span>
      <div class="stat-value">${t}</div>
    </article>
    <article class="card stat-card">
      <span class="eyebrow">Confirmed payments</span>
      <div class="stat-value">${a}</div>
    </article>
    <article class="card stat-card">
      <span class="eyebrow">USD processed</span>
      <div class="stat-value">${y(s)}</div>
    </article>
  `}function ee(e){const n=e.merchant||{},t=n.plans||[],a=n.enabledChains||[],s=a.filter(l=>Q(n,l)).length,c=C(e).filter(l=>l.status==="confirmed").length;return[{label:"Brand ready",detail:n.brandName&&n.checkoutHeadline?"Brand name and checkout copy are set.":"Add display name and checkout messaging.",ready:!!(n.brandName&&n.checkoutHeadline),section:"brand"},{label:"Operations ready",detail:n.webhookUrl&&s===a.length?"Webhook and settlement addresses are configured.":"Finish webhook setup and add a receiving address for each enabled chain.",ready:!!(n.webhookUrl&&a.length&&s===a.length),section:"settings"},{label:"Plans ready",detail:t.length?`${t.length} plan${t.length===1?"":"s"} available for checkout creation.`:"Create at least one plan for the normal purchase flow.",ready:t.length>0,section:"plans"},{label:"Payments live",detail:c?`${c} confirmed payment${c===1?"":"s"} recorded.`:"No confirmed payments yet.",ready:c>0,section:"payments"}]}function ve(e){const n=document.getElementById("dashboardNavSummary");if(!n)return;const t=e.merchant||{},a=ee(e),s=a.filter(c=>c.ready).length;n.innerHTML=`
    <strong>${o(t.brandName||t.name||"Merchant")}</strong>
    <span class="muted">${s}/${a.length} setup areas in good shape</span>
    <div class="dashboard-nav-pills">
      ${a.map(c=>`<span class="badge ${c.ready?"ok":"warn"}">${o(c.label)}</span>`).join("")}
    </div>
  `}function be(e){const n=document.getElementById("operationsSummaryCard");if(!n)return;const t=e.merchant||{},a=t.enabledChains||[],s=a.filter(r=>Q(t,r)),c=t.manualPaymentEnabledChains||[],l=!!t.webhookUrl;n.innerHTML=`
    <span class="badge ${l?"ok":"warn"}">${l?"Webhook ready":"Webhook missing"}</span>
    <span class="muted">${s.length}/${a.length||0} enabled networks have receiving addresses configured.</span>
    <span class="muted">${c.length} network${c.length===1?"":"s"} currently allow manual pay.</span>
  `}function fe(e){const n=e.merchant||{},a=C(e).filter(l=>l.status==="confirmed"),s=n.plans||[],c=ee(e);document.getElementById("overviewCards").innerHTML=`
    <article class="overview-card">
      <span class="eyebrow">Brand</span>
      <strong>${o(n.brandName||n.name||"Merchant")}</strong>
      <p class="muted">${o(n.checkoutHeadline||"No checkout headline configured yet.")}</p>
      <button type="button" class="secondary-button" data-open-section="brand">Open brand</button>
    </article>
    <article class="overview-card">
      <span class="eyebrow">Webhooks & settlement</span>
      <strong>${n.webhookUrl?"Webhook configured":"Configure operations"}</strong>
      <p class="muted">${o(n.webhookUrl||"No webhook configured yet.")}</p>
      <button type="button" class="secondary-button" data-open-section="settings">Open settings</button>
    </article>
    <article class="overview-card">
      <span class="eyebrow">Plans</span>
      <strong>${s.length} stored plan${s.length===1?"":"s"}</strong>
      <p class="muted">${o(s.slice(0,3).map(l=>`${l.title} ${y(l.amountUsd)}`).join(" · ")||"Create the first plan.")}</p>
      <button type="button" class="secondary-button" data-open-section="plans">Manage plans</button>
    </article>
    <article class="overview-card">
      <span class="eyebrow">Payments</span>
      <strong>${a.length} confirmed</strong>
      <p class="muted">${y(a.reduce((l,r)=>l+Number(r.checkout?.amountUsd||0),0))} processed so far.</p>
      <button type="button" class="secondary-button" data-open-section="payments">View payments</button>
    </article>
    <article class="overview-card">
      <span class="eyebrow">Checkout</span>
      <strong>Create a session</strong>
      <p class="muted">${(n.defaultAcceptedAssets||[]).join(" · ")||"Select accepted assets"} across ${(n.enabledChains||[]).length||0} network(s).</p>
      <button type="button" class="secondary-button" data-open-section="checkout">New checkout</button>
    </article>
  `,document.getElementById("overviewChecklist").innerHTML=c.map(l=>`
    <article class="overview-check-card">
      <div class="overview-check-copy">
        <span class="badge ${l.ready?"ok":"warn"}">${l.ready?"Ready":"Needs work"}</span>
        <strong>${o(l.label)}</strong>
        <p class="muted">${o(l.detail)}</p>
      </div>
      <button type="button" class="secondary-button" data-open-section="${l.section}">Open ${o(l.section)}</button>
    </article>
  `).join(""),document.getElementById("overviewCheckoutList").innerHTML=e.checkouts.length?e.checkouts.slice(0,5).map(te).join(""):"No checkouts yet.",document.querySelectorAll("[data-open-section]").forEach(l=>{l.addEventListener("click",()=>F(l.dataset.openSection))})}function ke(e){document.getElementById("merchantBrandName").value=e.brandName||e.name||"",document.getElementById("merchantName").value=e.name||"",document.getElementById("merchantSupportEmail").value=e.supportEmail||"",document.getElementById("merchantHeadline").value=e.checkoutHeadline||"",document.getElementById("merchantDescription").value=e.checkoutDescription||"",document.getElementById("merchantDefaultPaymentRail").value=m(e.defaultPaymentRail),document.getElementById("merchantWebhookUrl").value=e.webhookUrl||"",document.getElementById("merchantWebhookSecret").value=e.webhookSecret||"",document.getElementById("merchantLogoUrl").value=e.logoUrl||"",document.getElementById("merchantBitcoinXpub").value=e.bitcoinXpub||"",_(e.logoUrl),T("merchantChains",e.enabledChains||[]),T("merchantAssets",e.defaultAcceptedAssets||["USDC","USDT"]),b(e.plans||[]);for(const n of Object.keys(i.chains))document.getElementById(`recipient_${n}`).value=e.recipientAddresses?.[n]||"",document.getElementById(`manualEnabled_${n}`).checked=(e.manualPaymentEnabledChains||[]).includes(n);document.getElementById("checkoutTitle").value="Pro plan",document.getElementById("checkoutDescription").value=e.checkoutDescription||"Access unlocks after onchain confirmation.",document.getElementById("checkoutAmountUsd").value="49.00",document.getElementById("checkoutPaymentRail").value=m(e.defaultPaymentRail),W(),document.getElementById("checkoutPlanId").value="",O(),q(),L()}function te(e){const n=`/checkout.html?id=${e.id}`,t=o((e.acceptedAssets||[e.asset]).join(" · ")),a=o((e.enabledChains||[e.defaultChain]).map(s=>x(s)).join(" · "));return`
    <div class="checkout-list-item">
      <div class="checkout-list-meta">
        <strong>${o(e.title||e.orderId)}</strong>
        <span class="muted">$${Number(e.amountUsd||0).toFixed(2)} · ${t}</span>
        <span class="muted">${a}</span>
      </div>
      <div class="checkout-list-meta" style="text-align:right">
        <span class="badge ${e.status==="paid"?"ok":"warn"}">${o(e.status)}</span>
        <a href="${n}" target="_blank">Open checkout</a>
      </div>
    </div>
  `}function Ee(e){const n=e.checkout||{},t=n.title||n.orderId||e.checkoutId,a=le(e.chain,e.txHash),s=e.txHash?`${e.txHash.slice(0,10)}...`:"manual";return`
    <div class="payment-row">
      <div class="payment-cell payment-primary">
        <strong>${o(t)}</strong>
        <span class="muted">${o(n.orderId||e.checkoutId)}</span>
        <span class="muted">${o(e.walletAddress||"Wallet not captured")}</span>
      </div>
      <div class="payment-cell">
        <span class="payment-cell-label">Amount</span>
        <strong>${y(n.amountUsd||0)}</strong>
      </div>
      <div class="payment-cell">
        <span class="payment-cell-label">Route</span>
        <strong>${o((e.asset||"").toUpperCase())} ${e.chain?`· ${o(x(e.chain))}`:""}</strong>
        <span class="muted">${e.method==="manual"?"Manual pay":"Wallet pay"}</span>
      </div>
      <div class="payment-cell">
        <span class="payment-cell-label">Status</span>
        <span class="badge ${ie(e.status)}">${o(e.status)}</span>
      </div>
      <div class="payment-cell payment-cell-end">
        <span class="payment-cell-label">${z(e.createdAt)}</span>
        ${a?`<a href="${a}" target="_blank">${o(s)}</a>`:`<span class="muted">${o(s)}</span>`}
      </div>
    </div>
  `}function $e(e){return`
    <div class="event-item">
      <div class="event-meta">
        <strong>${o(e.type)}</strong>
        <span class="muted">${o(e.data?.title||e.data?.orderId||e.checkoutId)}</span>
      </div>
      <span class="muted">${z(e.createdAt)}</span>
    </div>
  `}function Ie(e){return`
    <div class="delivery-item">
      <div class="event-meta">
        <strong>${o(e.status)}</strong>
        <span class="muted">${o(e.endpoint)}</span>
      </div>
      <span class="muted">${o(e.responseCode||"n/a")}</span>
    </div>
  `}function ne(e){const n=C(e),t=p.search.trim().toLowerCase(),a=p.range==="all"?0:oe(Number(String(p.range).replace(/\D/g,"")||30));return n.filter(s=>{if(p.status!=="all"&&s.status!==p.status||p.method!=="all"&&s.method!==p.method||a&&new Date(s.createdAt).getTime()<a)return!1;if(!t)return!0;const c=s.checkout||{};return[c.title,c.orderId,s.checkoutId,s.walletAddress,s.txHash,s.asset,s.chain].join(" ").toLowerCase().includes(t)})}function ae(e){const n=C(e),t=ne(e),s=t.filter(c=>c.status==="confirmed").reduce((c,l)=>c+Number(l.checkout?.amountUsd||0),0);document.getElementById("paymentResultsMeta").textContent=`${t.length} of ${n.length} payments · ${y(s)} confirmed volume in view`,document.getElementById("paymentList").innerHTML=t.length?t.map(Ee).join(""):"No payments match the current filters."}function Be(e){E=e,ye(e),ve(e),be(e),fe(e),ke(e.merchant),ae(e),document.getElementById("checkoutList").innerHTML=e.checkouts.length?e.checkouts.map(te).join(""):"No checkouts yet.",document.getElementById("eventList").innerHTML=e.events.length?e.events.map($e).join(""):"No events yet.",document.getElementById("deliveryList").innerHTML=e.webhookDeliveries.length?e.webhookDeliveries.map(Ie).join(""):"No deliveries yet."}async function N(){const e=await R(`/api/dashboard?merchantId=${D}`);return Be(e),e}async function we(e){if(e.preventDefault(),h=document.getElementById("dashboardAuthToken").value.trim(),h&&localStorage.setItem(I,h),k(!1,"Checking token…"),!(await N())?.authenticated){h="",localStorage.removeItem(I),k(!1,"Invalid dashboard token.");return}document.getElementById("dashboardAuthToken").value="",k(!0)}function Se(){const e={};for(const n of Object.keys(i.chains)){const t=document.getElementById(`recipient_${n}`).value.trim();t&&(e[n]=t)}return e}function Ce(){return Object.keys(i.chains).filter(e=>document.getElementById(`manualEnabled_${e}`).checked)}async function Ae(e){e.preventDefault();const n={name:document.getElementById("merchantName").value.trim(),brandName:document.getElementById("merchantBrandName").value.trim(),supportEmail:document.getElementById("merchantSupportEmail").value.trim(),checkoutHeadline:document.getElementById("merchantHeadline").value.trim(),checkoutDescription:document.getElementById("merchantDescription").value.trim(),defaultPaymentRail:m(document.getElementById("merchantDefaultPaymentRail").value),webhookUrl:document.getElementById("merchantWebhookUrl").value.trim(),webhookSecret:document.getElementById("merchantWebhookSecret").value.trim(),bitcoinXpub:document.getElementById("merchantBitcoinXpub").value.trim(),logoUrl:f||document.getElementById("merchantLogoUrl").value.trim(),enabledChains:B("merchantChains"),defaultAcceptedAssets:B("merchantAssets"),plans:Y(),recipientAddresses:Se(),manualPaymentEnabledChains:Ce()};J("Saving merchant settings…"),await R(`/api/merchants/${D}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(n)}),J("Saved."),f="",await N()}function Pe(){return{merchantId:D,planId:document.getElementById("checkoutPlanId").value.trim()||void 0,title:document.getElementById("checkoutTitle").value.trim(),description:document.getElementById("checkoutDescription").value.trim(),paymentRail:Z(),orderId:document.getElementById("checkoutOrderId").value.trim()||void 0,amountUsd:Number(document.getElementById("checkoutAmountUsd").value||0),referenceId:document.getElementById("checkoutReferenceId").value.trim()||void 0,successUrl:document.getElementById("checkoutSuccessUrl").value.trim()||void 0,cancelUrl:document.getElementById("checkoutCancelUrl").value.trim()||void 0,enabledChains:B("checkoutChains"),acceptedAssets:B("checkoutAssets")}}function Le(e){document.getElementById("createdCheckout").innerHTML=`
    <div class="dashboard-inline-result">
      <span class="badge ok">${e.resolved?"Resolved via webhook":"Checkout created"}</span>
      <a href="${e.checkoutUrl}" target="_blank">${e.checkoutUrl}</a>
      <span class="muted">${o(e.checkout.title||e.checkout.orderId)} · ${j(e.checkout.paymentRail)} · ${y(e.checkout.amountUsd)}</span>
    </div>
  `}function Ue(){if(!E)return;const e=ne(E);if(!e.length){document.getElementById("paymentList").textContent="No payments available to export.";return}const n=["payment_id","created_at","status","method","order_id","title","amount_usd","asset","chain","wallet_address","tx_hash","recipient_address"],t=e.map(r=>[r.id,r.createdAt,r.status,r.method,r.checkout?.orderId||"",r.checkout?.title||"",String(r.checkout?.amountUsd||0),r.asset||"",r.chain||"",r.walletAddress||"",r.txHash||"",r.recipientAddress||""]),a=[n].concat(t).map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join(`
`),s=new Blob([a],{type:"text/csv;charset=utf-8"}),c=URL.createObjectURL(s),l=document.createElement("a");l.href=c,l.download=`charge-with-crypto-payments-${new Date().toISOString().slice(0,10)}.csv`,document.body.appendChild(l),l.click(),l.remove(),URL.revokeObjectURL(c)}async function se({resolved:e}){const n=Pe(),a=await R(e?"/api/checkouts/resolve":"/api/checkouts",{method:"POST",headers:{"content-type":"application/json","idempotency-key":crypto.randomUUID()},body:JSON.stringify(n)});Le(a),await N()}function Re(){document.getElementById("merchantLogoFile").addEventListener("change",e=>{const[n]=e.target.files||[];if(!n)return;const t=new FileReader;t.onload=()=>{f=String(t.result||""),_(f),document.getElementById("merchantLogoUrl").value=f,L()},t.readAsDataURL(n)}),document.getElementById("merchantLogoUrl").addEventListener("input",e=>{const n=e.target.value.trim();_(n),L()}),["merchantBrandName","merchantName","merchantHeadline","merchantDescription"].forEach(e=>{document.getElementById(e).addEventListener("input",()=>L())})}function A(){p={search:document.getElementById("paymentSearchInput").value||"",status:document.getElementById("paymentStatusFilter").value||"all",method:document.getElementById("paymentMethodFilter").value||"all",range:document.getElementById("paymentRangeFilter").value||"30d"},E&&ae(E)}document.getElementById("addPlanBtn").addEventListener("click",()=>{d.push(re()),u=d.length-1,b(d)});document.querySelectorAll("[data-dashboard-section]").forEach(e=>{e.addEventListener("click",()=>F(e.dataset.dashboardSection))});document.getElementById("checkoutPlanId").addEventListener("change",()=>he());document.getElementById("checkoutPaymentRail").addEventListener("change",()=>W());document.getElementById("exportPaymentsBtn").addEventListener("click",()=>Ue());document.getElementById("paymentSearchInput").addEventListener("input",()=>A());document.getElementById("paymentStatusFilter").addEventListener("change",()=>A());document.getElementById("paymentMethodFilter").addEventListener("change",()=>A());document.getElementById("paymentRangeFilter").addEventListener("change",()=>A());document.getElementById("merchantForm").addEventListener("submit",e=>Ae(e).catch(n=>{document.getElementById("merchantSaveStatus").textContent=n.message}));document.getElementById("checkoutForm").addEventListener("submit",e=>{e.preventDefault(),se({resolved:!1}).catch(n=>{document.getElementById("createdCheckout").textContent=n.message})});document.getElementById("resolveCheckoutBtn").addEventListener("click",()=>{se({resolved:!0}).catch(e=>{document.getElementById("createdCheckout").textContent=e.message})});document.getElementById("dashboardAuthForm").addEventListener("submit",e=>we(e).catch(n=>{h="",localStorage.removeItem(I),k(!1,n.message)}));(async function(){i=await R("/api/config"),pe(i),Re(),A();try{const n=await N();!n?.authenticated&&h&&(h="",localStorage.removeItem(I)),n?.authenticated||!i.dashboardAuthConfigured?k(!0):k(!1,"Enter dashboard token to edit.")}catch(n){throw n}F((window.location.hash||"#overview").slice(1),{syncHash:!1})})();
