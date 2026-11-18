let cats=['All','Watches','Clothes','Shoes','Electronics','Collectibles','Vehicles','Home','Fashion','Art','Sports','Toys','Other'];
let curCat='All', curType='';
async function j(u,o){const r=await fetch(u,o?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)}:undefined);return r.json();}
function show(w){document.getElementById('sellSec').style.display=w==='sell'?'block':'none';document.getElementById('dashSec').style.display=w==='dash'?'block':'none';if(w==='buy'){curType='';load();}if(w==='store'){curType='buy_now';load();}if(w==='dash')loadDash();}
async function load(){
  const o=await j('/api/overview');
  document.getElementById('founding').textContent=`Founding sellers: ${o.founding.taken}/10 taken — ${o.founding.remaining} spots left. 0% until it goes live, then 5% forever. Normal fee 10%.`;
  document.getElementById('liveNow').innerHTML=o.listings.filter(l=>l.seller_live&&l.status==='live').map(l=>`<p><span class="badge">🔴 LIVE NOW</span> <b>${l.seller}</b> — ${l.title} — $${l.current_bid} <button class="btn ghost" onclick="openItem('${l.id}')">Join room</button></p>`).join('')||'<p class="small">No sellers live now.</p>';
  document.getElementById('tiles').innerHTML=cats.map(c=>`<span class="tile ${c===curCat?'active':''}" onclick="setCat('${c}')">${c}</span>`).join('');
  let rows=o.listings.filter(l=>!curType||l.type===curType); if(curCat!=='All')rows=rows.filter(l=>l.category===curCat);
  document.getElementById('list').innerHTML=rows.map(l=>`<div class="card">${l.image_url?`<img src="${l.image_url}" style="max-width:100%;border-radius:10px" alt="${l.title}">`:''}<h3>${l.title} ${l.authenticity!=='Authentic'?`<span class="badge gold">${l.authenticity.toUpperCase()}</span>`:''}</h3>
  <p>${l.category} • ${l.type==='buy_now'?'Store — Buy Now Only':'Auction • '+l.mode} • ${l.seller}</p>
  <p>${l.type==='buy_now'?`Price $${l.fixed_price}`:`Current bid $${l.current_bid} • Starting $${l.start_price}`}<br>Shipping $${l.shipping} (buyer pays) • Insured shipping ✓</p>
  <p class="small">Status: ${l.status} ${l.payment_status==='declined'?'<span class="badge">PAYMENT DECLINED</span>':''} ${l.payment_status==='validated'?'<span class="badge green">Payment went through — in escrow hold</span>':''}</p>
  <button class="btn" onclick="openItem('${l.id}')">Open</button></div>`).join('')||'<p>No listings yet — be the first to sell something.</p>';
  const d=await j('/api/drops'); document.getElementById('drops').innerHTML=d.map(x=>`<p>Free Drop: ${x.title} by ${x.seller} — ${x.status} ${x.winner?'winner: '+x.winner:''}</p>`).join('');
  const s=await j('/api/coming-up'); document.getElementById('shows').innerHTML=s.map(x=>`<p>Coming Up: ${x.title} by ${x.seller} — ${x.starts_at}</p>`).join('');
}
function setCat(c){curCat=c;load();}
window._photoData='';
function pickPhoto(input){const f=input.files&&input.files[0];if(!f)return;const img=new Image();const rd=new FileReader();rd.onload=e=>{img.onload=()=>{const max=800;const sc=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*sc);c.height=Math.round(img.height*sc);c.getContext('2d').drawImage(img,0,0,c.width,c.height);window._photoData=c.toDataURL('image/jpeg',0.8);const p=document.getElementById('sPhotoPrev');p.src=window._photoData;p.style.display='block';};img.src=e.target.result;};rd.readAsDataURL(f);}
async function createListing(){
  const b={seller:document.getElementById('sSeller').value,title:document.getElementById('sTitle').value,description:document.getElementById('sDesc').value,category:document.getElementById('sCat').value,type:document.getElementById('sType').value,startPrice:document.getElementById('sStart').value,fixedPrice:document.getElementById('sFixed').value,shipping:document.getElementById('sShip').value,carrier:document.getElementById('sCarrier').value,authenticity:document.getElementById('sAuth').value,timerSeconds:document.getElementById('sTimer').value,mode:document.getElementById('sMode').value,shippingInsured:document.getElementById('sInsured').checked,agreement:document.getElementById('sAgree').checked,imageUrl:window._photoData||''};
  const r=await j('/api/listings',b); document.getElementById('sellMsg').textContent=r.ok?'Listed!':('Error: '+r.error); if(r.ok)load();
}
// ---------- Live video (WebRTC peer-to-peer, no paid service) ----------
// Seller broadcasts their camera to each viewer in the room via RTCPeerConnection;
// the server only relays small signalling messages (join / offer / answer / ICE).
// STUN only (stun.l.google.com) — no TURN server, so a few strict networks may fail.
let liveListingId=null, liveRole=null, liveViewerId=null, liveStream=null, liveRemoteStream=null;
let livePCs={}, livePoll=null, liveSince=null, liveSeen=new Set();
function liveVideoEl(){return document.getElementById('liveVideo');}
function liveStatusEl(){return document.getElementById('liveStatus');}
function setLiveStatus(t){const e=liveStatusEl();if(e)e.textContent=t;}
async function sendSignal(id,sender,recipient,kind,payload){try{await j('/api/listings/'+id+'/signal',{sender,recipient,kind,payload:typeof payload==='string'?payload:JSON.stringify(payload)});}catch(e){}}
function makePC(){return new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});}
function wirePC(pc,id,peerId){
  pc.onicecandidate=e=>{if(e.candidate)sendSignal(id,liveRole==='seller'?'seller':liveViewerId,peerId,'ice',e.candidate);};
}
function stopLivePoll(){if(livePoll){clearInterval(livePoll);livePoll=null;}}
function stopLiveFull(){
  stopLivePoll();
  for(const k of Object.keys(livePCs)){try{livePCs[k].close();}catch(e){}}
  livePCs={};
  if(liveStream){liveStream.getTracks().forEach(t=>t.stop());liveStream=null;}
  liveRemoteStream=null; liveListingId=null; liveRole=null; liveViewerId=null; liveSince=null; liveSeen=new Set();
}
async function pollSignals(id){
  let rows=[]; try{rows=await j('/api/listings/'+id+'/signal?since='+encodeURIComponent(liveSince||new Date(0).toISOString()));}catch(e){return;}
  if(!Array.isArray(rows))return;
  for(const s of rows){
    if(liveSeen.has(s.id))continue; liveSeen.add(s.id);
    if(liveRole==='seller'){
      if(s.recipient!=='seller')continue;
      if(s.kind==='join'&&s.sender){ // a viewer wants to watch — offer them the stream
        const pc=makePC(); livePCs[s.sender]=pc; wirePC(pc,id,s.sender);
        if(liveStream)liveStream.getTracks().forEach(t=>pc.addTrack(t,liveStream));
        try{const offer=await pc.createOffer(); await pc.setLocalDescription(offer); sendSignal(id,'seller',s.sender,'offer',offer);}catch(e){}
      } else if(s.kind==='answer'&&livePCs[s.sender]){
        try{await livePCs[s.sender].setRemoteDescription(new RTCSessionDescription(JSON.parse(s.payload)));}catch(e){}
      } else if(s.kind==='ice'&&livePCs[s.sender]){
        try{await livePCs[s.sender].addIceCandidate(new RTCIceCandidate(JSON.parse(s.payload)));}catch(e){}
      } else if(s.kind==='leave'&&livePCs[s.sender]){try{livePCs[s.sender].close();}catch(e){} delete livePCs[s.sender];}
    } else if(liveRole==='viewer'){
      if(s.recipient!==liveViewerId)continue;
      if(s.kind==='offer'){
        try{
          const pc=makePC(); livePCs.seller=pc; wirePC(pc,id,'seller');
          pc.ontrack=e=>{liveRemoteStream=e.streams[0]; const v=liveVideoEl(); if(v){v.srcObject=liveRemoteStream; v.muted=false; v.style.display='block'; v.play().catch(()=>{const b=document.getElementById('unmuteBtn'); if(b)b.style.display='inline-block';});} setLiveStatus('🔴 LIVE — watching the seller now. You can hear them talking. Type in chat what you want to see.');};
          await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(s.payload)));
          const answer=await pc.createAnswer(); await pc.setLocalDescription(answer);
          sendSignal(id,liveViewerId,'seller','answer',answer);
        }catch(e){}
      } else if(s.kind==='ice'&&livePCs.seller){
        try{await livePCs.seller.addIceCandidate(new RTCIceCandidate(JSON.parse(s.payload)));}catch(e){}
      }
    }
  }
}
async function startViewer(id){
  liveRole='viewer'; liveViewerId='v-'+Math.random().toString(36).slice(2,10); liveSince=new Date().toISOString();
  setLiveStatus('Connecting to the seller\'s live video…');
  await sendSignal(id,liveViewerId,'seller','join',{});
  stopLivePoll(); livePoll=setInterval(()=>pollSignals(id),2000);
}
async function startSellerPoll(id){
  liveSince=new Date().toISOString();
  stopLivePoll(); livePoll=setInterval(()=>pollSignals(id),2000);
}
async function openItem(id){
  const wasLive=liveListingId===id&&(liveRole==='seller'||liveRole==='viewer');
  if(!wasLive)stopLiveFull(); else stopLivePoll(); // re-render keeps the stream/PCs, restarts polling below
  liveListingId=id;
  const l=await j('/api/listings/'+id);
  const el=document.getElementById('detail'); el.scrollIntoView();
  el.innerHTML=`<div class="card">${l.image_url?`<img src="${l.image_url}" style="max-width:100%;border-radius:10px" alt="${l.title}">`:''}<h2>${l.title}</h2><p>${l.description||''} • ${l.category} • ${l.authenticity} • Seller: ${l.seller}</p>
  ${l.type==='auction'?`<p class="timer" id="cd"></p><p>Current bid $${l.current_bid} • Shipping $${l.shipping} • Total if you win now: $${l.current_bid+l.shipping}</p>
  <label>Your name <input id="bName"></label><label>Bid $ <input id="bAmt" type="number" value="${l.current_bid+1}"></label>
  <button class="btn" onclick="bid('${l.id}',1)">+$1</button><button class="btn" onclick="bid('${l.id}',5)">+$5</button><button class="btn" onclick="bid('${l.id}',10)">+$10</button>
  <button class="btn" onclick="bidCustom('${l.id}')">Place custom bid</button>
  <p class="small">Bid slider: use the amount box above. My Top Limit: set a max and the system bids the smallest step for you.</p>
  <label>My Top Limit $ <input id="tlAmt" type="number"></label><button class="btn ghost" onclick="setTop('${l.id}')">Set My Top Limit</button>`
  :`<p>Store price $${l.fixed_price} + $${l.shipping} shipping = $${l.fixed_price+l.shipping} total</p>
  <label>Your name <input id="bName"></label><label>Payment method <select id="pMethod"><option>card</option><option>PayPal</option><option>Apple Pay</option><option>Google Pay</option><option>Cash App</option><option>Venmo</option><option>bank</option></select></label>
  <label>Payment detail (test: use 4242…4242 to pass, 4000…0002 to decline) <input id="pDetail" value="4242424242424242"></label>
  <button class="btn green" onclick="buyNow('${l.id}')">Buy Now — check my payment first</button>`}
  ${l.status==='ended'?`<p><b>Winner: ${l.winner||'—'}</b> — ${l.payment_status==='validated'?'Payment went through — in escrow hold':l.payment_status==='declined'?'Payment declined — buyer needs to fix payment':'Waiting for winner payment'}</p>
  ${l.payment_status==='declined'?`<div style="background:#c62828;padding:14px;border-radius:10px"><h3>PAYMENT DIDN'T GO THROUGH! Don't lose this sale — pick one</h3><button class="btn" onclick="fixPay('${l.id}')">Fix Payment</button><button class="btn" onclick="rerun('${l.id}','${l.seller}')">Rerun Auction</button></div>`:''}
  <label>Winner payment method <select id="pMethod"><option>card</option><option>PayPal</option><option>Venmo</option></select></label><label>Detail <input id="pDetail" value="4242424242424242"></label><button class="btn" onclick="payWinner('${l.id}')">Pay now</button>`:''}
  ${l.receipt?`<p>Receipt ${l.receipt.receipt_no} — total $${l.receipt.total} — <a href="#" onclick="alert('Receipt ${l.receipt.receipt_no}: ${l.title}, $${l.receipt.total} paid, seller ${l.seller}, winner ${l.winner}');return false">Download receipt</a></p>`:''}
  <h3>Live video ${l.seller_live?'<span class="badge">🔴 LIVE NOW</span>':''}</h3>
  <video id="liveVideo" playsinline autoplay style="width:100%;max-height:420px;background:#000;border-radius:10px;display:none"></video>
  <button class="btn" id="unmuteBtn" style="display:none" onclick="const v=document.getElementById('liveVideo');v.muted=false;v.play();this.style.display='none'">Tap for sound — hear the seller</button>
  <p id="liveStatus" class="small">${l.seller_live?'Seller is live — connecting to live video…':'Seller is not live yet. When they go live, their camera shows here.'}</p>
  <button class="btn ghost" id="endLiveBtn" style="display:none" onclick="endLive('${l.id}')">End Live</button>
  <h3>Chat room ${l.seller_live?'<span class="badge">🔴 LIVE NOW</span>':''}</h3><p class="small">Live video + live chat — type in chat what you want the seller to show you.</p>
  <div class="chat">${l.chats.map(c=>`<p><b>${c.name}${c.is_seller?' (seller)':''}:</b> ${c.message}</p>`).join('')}</div>
  <label>Your name <input id="cName"></label><label>Message <input id="cMsg"></label><button class="btn" onclick="chat('${l.id}')">Post</button>
  <button class="btn ghost" onclick="goLive('${l.id}')">Go Live — Turn Camera On (seller only)</button>
  <button class="btn ghost" onclick="offer('${l.id}')">Post Buy It Now offer in chat (seller)</button>
  <p><button class="btn ghost" onclick="report('${l.id}')">Report this listing</button> <button class="btn ghost" onclick="score('${l.seller}')">Seller Scorecard</button></p>
  <div id="itemMsg"></div></div>`;
  if(l.ends_at){const t=setInterval(()=>{const ms=new Date(l.ends_at)-new Date();const e=document.getElementById('cd');if(!e){clearInterval(t);return;}e.textContent=ms>0?('⏱ '+Math.floor(ms/60000)+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')):'Auction ended';},250);}
  // Live video: re-attach after a re-render, or join as a viewer if the seller is live.
  if(wasLive&&liveRole==='seller'&&liveStream){
    const v=liveVideoEl(); if(v){v.srcObject=liveStream; v.style.display='block'; v.play().catch(()=>{});}
    const b=document.getElementById('endLiveBtn'); if(b)b.style.display='inline-block';
    setLiveStatus('🔴 LIVE — buyers can see your camera now. Watch the chat for what they want to see.');
    startSellerPoll(id);
  } else if(wasLive&&liveRole==='viewer'){
    const v=liveVideoEl(); if(v&&liveRemoteStream){v.srcObject=liveRemoteStream; v.muted=false; v.style.display='block'; v.play().catch(()=>{const b=document.getElementById('unmuteBtn'); if(b)b.style.display='inline-block';});}
    stopLivePoll(); livePoll=setInterval(()=>pollSignals(id),2000);
  } else if(l.seller_live&&l.type==='auction'){
    startViewer(id);
  }
}
async function bid(id,add){const l=await j('/api/listings/'+id);const r=await j('/api/listings/'+id+'/bid',{bidder:document.getElementById('bName').value||'Buyer',amount:l.current_bid+add});alert(r.ok?`Bid placed: $${r.currentBid} (total $${r.total})`:'Error: '+r.error);openItem(id);}
async function bidCustom(id){const r=await j('/api/listings/'+id+'/bid',{bidder:document.getElementById('bName').value||'Buyer',amount:Number(document.getElementById('bAmt').value)});alert(r.ok?`Bid placed: $${r.currentBid}`:'Error: '+r.error);openItem(id);}
async function setTop(id){const r=await j('/api/top-limit',{listingId:id,buyer:document.getElementById('bName').value||'Buyer',maxAmount:Number(document.getElementById('tlAmt').value)});alert(r.ok?'My Top Limit set':'Error: '+r.error);}
async function buyNow(id){const r=await j('/api/listings/'+id+'/buy-now',{buyer:document.getElementById('bName').value||'Buyer',method:document.getElementById('pMethod').value,detail:document.getElementById('pDetail').value});alert(r.ok?`Sale complete — $${r.total} in escrow. Receipt ${r.receiptNo}`:'Error: '+r.error);openItem(id);}
async function payWinner(id){const r=await j('/api/listings/'+id+'/pay',{method:document.getElementById('pMethod').value,detail:document.getElementById('pDetail').value});alert(r.ok?`Payment went through — $${r.total} in escrow`:'Error: '+r.error);openItem(id);}
async function fixPay(id){const r=await j('/api/listings/'+id+'/notify-fix',{});alert(r.ok?'Fix-payment notice sent to the winner':'Error: '+r.error);}
async function rerun(id,seller){const r=await j('/api/listings/'+id+'/rerun',{seller});alert(r.ok?'Auction rerun — live again at the same price/timer':'Error: '+r.error);openItem(id);}
async function chat(id){await j('/api/listings/'+id+'/chat',{name:document.getElementById('cName').value||'Buyer',message:document.getElementById('cMsg').value});openItem(id);}
async function goLive(id){
  const seller=document.getElementById('cName').value;
  // Camera first: if the seller blocks it, do not mark the room live.
  let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:true});}
  catch(e){alert('Camera / mic blocked — allow camera access in your browser settings and try again.');return;}
  const r=await j('/api/listings/'+id+'/go-live',{seller});
  if(!r.ok){stream.getTracks().forEach(t=>t.stop());alert('Error: '+r.error);return;}
  // Stop any viewer connection from this browser, then broadcast.
  if(liveRole==='viewer'){stopLiveFull(); liveListingId=id;}
  liveRole='seller'; liveStream=stream; liveSince=new Date().toISOString(); liveSeen=new Set(); livePCs={};
  const v=liveVideoEl(); if(v){v.srcObject=stream; v.muted=true; v.style.display='block'; v.play().catch(()=>{});}
  const b=document.getElementById('endLiveBtn'); if(b)b.style.display='inline-block';
  setLiveStatus('🔴 LIVE — buyers can see your camera now. Watch the chat for what they want to see.');
  startSellerPoll(id);
  alert('You are LIVE NOW — buyers can see your camera.');
}
async function endLive(id){
  if(liveRole==='viewer')sendSignal(id,liveViewerId,'seller','leave',{});
  stopLiveFull();
  await j('/api/listings/'+id+'/end-live',{});
  openItem(id);
}
async function offer(id){const amt=prompt('Buy It Now offer $ ?');if(!amt)return;const r=await j('/api/listings/'+id+'/buy-now-offer',{seller:document.getElementById('cName').value,amount:Number(amt)});alert(r.ok?'Offer posted in chat':'Error: '+r.error);openItem(id);}
async function report(id){const r=await j('/api/report',{listingId:id,reason:prompt('What is wrong with this listing?')||''});alert(r.message||'Reported');}
async function score(s){const r=await j('/api/scorecard/'+encodeURIComponent(s));alert(`Seller Scorecard for ${s}: ${r.average||'no scores yet'} / 5 from ${r.count} score(s)`);}
async function follow(){const r=await j('/api/follow',{buyer:document.getElementById('fBuyer').value,seller:document.getElementById('fSeller').value});document.getElementById('followMsg').textContent=r.message||r.error;}
async function makeDrop(){const r=await j('/api/drops',{seller:document.getElementById('dSeller').value,title:document.getElementById('dTitle').value});alert(r.ok?'Free Drop started — one entry per person, seller covers shipping':'Error');load();}
async function makeShow(){const r=await j('/api/shows',{seller:document.getElementById('cSeller').value,title:document.getElementById('cTitle').value,startsAt:new Date(document.getElementById('cWhen').value).toISOString()});alert(r.ok?'Show scheduled':'Error');load();}
async function joinWaitlist(){const r=await j('/api/waitlist',{name:document.getElementById('wName').value,email:document.getElementById('wEmail').value,founding:document.getElementById('wFound').checked});document.getElementById('waitMsg').textContent=r.ok?'You are on the waitlist!':r.error;}
async function claimFounding(){const r=await j('/api/founding/claim',{seller:document.getElementById('wName').value||'Seller'});document.getElementById('waitMsg').textContent=r.ok?`Founding spot claimed! ${r.taken}/10 taken`:'Error: '+r.error;load();}
async function loadDash(){const d=await j('/api/dashboard');document.getElementById('dash').innerHTML=`<p>Total fees earned: $${d.totalFeesEarned}</p><p>Tax set aside (${d.taxPercent}%): $${d.taxSetAside}</p><p>Available to use / owner draw: $${d.availableToUse}</p><p>Unpaid wins: ${d.unpaidWins.length} • Refunds pending: ${d.refundsPending.length} • Escrow held: ${d.escrowHeld.length}</p>`;loadLiveNotice();}
// ---------- "We're live" email to the waitlist (owner dashboard) ----------
function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
async function loadLiveNotice(){
  const d=await j('/api/waitlist/live-notice'); const el=document.getElementById('liveNotice'); if(!el)return;
  let h=`<p><b>${d.count} people</b> on the waitlist.</p>`;
  if(d.sentAt)h+=`<p><span class="badge green">Sent ${escHtml(d.sentAt)} via ${escHtml(d.sentMode)} to ${d.sentCount} people.</span></p>`;
  else if(d.count)h+=`<p class="small">Not sent yet.</p>`;
  if(!d.resendConfigured)h+=`<p class="small">No automatic email key set — use copy / mailto below, or set RESEND_API_KEY in Railway to send automatically.</p>`;
  if(d.count){
    h+=`<p class="small">Subject: ${escHtml(d.subject)}</p><pre style="white-space:pre-wrap">${escHtml(d.body)}</pre>
    <label>Emails (copy them) <textarea id="liveEmails" readonly rows="3">${escHtml(d.emails.join(', '))}</textarea></label>
    <button class="btn ghost" onclick="copyLiveEmails()">Copy emails</button>
    <a class="btn ghost" href="${escHtml(d.mailto)}">Open in my email (everyone in BCC)</a>`;
  }
  el.innerHTML=h;
  const rb=document.getElementById('resendLiveBtn'); if(rb)rb.style.display=d.sentAt?'inline-block':'none';
  const mb=document.getElementById('markSentBtn'); if(mb)mb.style.display=(!d.resendConfigured&&d.count&&!d.sentAt)?'inline-block':'none';
}
async function sendLiveNotice(force){
  const r=await j('/api/waitlist/live-notice',{force:!!force}); const m=document.getElementById('liveNoticeMsg');
  if(r.ok&&r.sent)m.textContent=`Sent! ${r.sentCount} people emailed via ${r.mode}.`;
  else if(r.ok&&!r.sent)m.textContent=r.message||'Nothing was sent automatically — use copy / mailto below.';
  else m.textContent='Error: '+(r.error||'could not send');
  loadLiveNotice();
}
async function markLiveSent(){
  const r=await j('/api/waitlist/live-notice',{markManualSent:true}); const m=document.getElementById('liveNoticeMsg');
  m.textContent=r.ok?'Marked as sent.':('Error: '+(r.error||'could not mark sent')); loadLiveNotice();
}
function copyLiveEmails(){
  const t=document.getElementById('liveEmails'); if(!t)return; t.select();
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t.value); else document.execCommand('copy');
  document.getElementById('liveNoticeMsg').textContent='Emails copied.';
}
async function setTax(){const r=await j('/api/settings/tax',{percent:Number(document.getElementById('taxPct').value)});alert(r.ok?'Tax % set to '+r.taxPercent:'Error: '+r.error);loadDash();}
document.getElementById('sCat').innerHTML=cats.slice(1).map(c=>`<option>${c}</option>`).join('');
load(); setInterval(load,15000);
