let cats=['All','Watches','Clothes','Shoes','Electronics','Collectibles','Home','Fashion','Art','Sports','Toys','Other'];
let curCat='All', curType='';
async function j(u,o){const r=await fetch(u,o?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)}:undefined);return r.json();}
function show(w){document.getElementById('sellSec').style.display=w==='sell'?'block':'none';document.getElementById('dashSec').style.display=w==='dash'?'block':'none';if(w==='buy'){curType='';load();}if(w==='store'){curType='buy_now';load();}if(w==='dash')loadDash();const target=w==='sell'?document.getElementById('sellSec'):w==='dash'?document.getElementById('dashSec'):document.getElementById('list');if(target){target.scrollIntoView({behavior:'smooth',block:'start'});}if(w==='sell'){const f=document.getElementById('sSeller');if(f)setTimeout(()=>f.focus(),400);}}
async function load(){
  const o=await j('/api/overview');
  document.getElementById('founding').textContent=`Founding sellers: ${o.founding.taken}/10 taken — ${o.founding.remaining} spots left. 0% until it goes live, then 5% forever. Normal fee 10%.`;
  document.getElementById('liveNow').innerHTML=o.listings.filter(l=>l.seller_live&&l.status==='live').map(l=>`<p><span class="badge">🔴 LIVE NOW</span> <b>${l.seller}</b> — ${l.title} — $${l.current_bid} <button class="btn ghost" onclick="openItem('${l.id}')">Join room</button></p>`).join('')||'<p class="small">No sellers live now.</p>';
  document.getElementById('tiles').innerHTML=cats.map(c=>`<span class="tile ${c===curCat?'active':''}" onclick="setCat('${c}')">${c}</span>`).join('');
  let rows=o.listings.filter(l=>!curType||l.type===curType); if(curCat!=='All')rows=rows.filter(l=>l.category===curCat);
  document.getElementById('list').innerHTML=rows.map(l=>`<div class="card">${l.image_url?`<img src="${l.image_url}" style="max-width:100%;border-radius:10px" alt="${l.title}">`:''}<h3>${l.title} ${l.is_random?`<span class="badge gold">🎲 RANDOM ITEM</span>`:''} ${l.authenticity!=='Authentic'?`<span class="badge gold">${l.authenticity.toUpperCase()}</span>`:''}</h3>
  ${l.is_random?`<p class="small">🎲 RANDOM ITEM — no picture, seller shows it live on camera.</p>`:''}
  <p>${l.category} • ${l.type==='buy_now'?'Store — Buy Now Only':l.type==='wheel'?'⏰ Time Wheel • '+l.mode:'Auction • '+l.mode} • ${l.seller}${l.type==='wheel'?` • ${l.wheel_count||0} items on the wheel`:''}</p>
  <p>${l.type==='buy_now'?`Price $${l.fixed_price}`:`Current bid $${l.current_bid} • Starting $${l.start_price}`}<br>Shipping $${l.shipping} (buyer pays)${l.package_size?` • ${shipLabelOf(l.package_size)}`:''} • ${shipViaText(l)} • Insured shipping ✓</p>
  <p class="small">Status: ${l.status} ${l.payment_status==='declined'?'<span class="badge">PAYMENT DECLINED</span>':''} ${l.payment_status==='validated'?'<span class="badge green">Payment went through — in escrow hold</span>':''}</p>
  <button class="btn" onclick="openItem('${l.id}')">Open</button></div>`).join('')||'<p>No listings yet — be the first to sell something.</p>';
  const d=await j('/api/drops'); document.getElementById('drops').innerHTML=d.map(x=>`<p>Free Drop: ${x.title} by ${x.seller} — ${x.status} ${x.winner?'winner: '+x.winner:''}</p>`).join('');
  const s=await j('/api/coming-up'); document.getElementById('shows').innerHTML=s.map(x=>`<p>Coming Up: ${x.title} by ${x.seller} — ${x.starts_at}</p>`).join('');
}
function setCat(c){curCat=c;load();}
// Shipping by package size (same tiers as the server — US shipping rates).
const SHIP_SIZES={small:{label:'Small — under 4 oz',price:4.47},medium:{label:'Medium — 4–8 oz',price:4.85},large:{label:'Large — 8–12 oz',price:5.25},xl:{label:'XL — 12 oz–1 lb',price:6.75},box:{label:'Box — 1–5 lb',price:7.75},bigbox:{label:'Big box — over 5 lb',price:9.69},flat:{label:'Flat Rate box',price:12.99},envelope:{label:'Card envelope',price:0.99}};
function shipLabelOf(s){return (SHIP_SIZES[s]||{}).label||'';}
// Carrier rule: USPS for everything, UPS for Big box over 5 lb. No FedEx.
// The carrier is automatic from package size — the seller never picks it.
function carrierOf(l){return l.carrier||(l.package_size==='bigbox'?'UPS':'USPS');}
function shipViaText(l){const c=carrierOf(l);return c==='UPS'?'Ships via UPS (over 5 lbs)':'Ships via USPS';}

// ---------- QR codes (vendored, no dependency, no external QR API) ----------
// Small QR Code generator: byte mode, error-correction level M, versions 1–9.
// The QR encodes the sale URL, so a phone camera opens that exact sold item.
// Tables are the standard ISO 18004 values for level M (total codewords,
// EC codewords per block, data codewords per block group, alignment positions).
const QR_VERSIONS=[null,
 {total:26,ec:10,align:[],groups:[{n:1,data:16}]},
 {total:44,ec:16,align:[6,18],groups:[{n:1,data:28}]},
 {total:70,ec:26,align:[6,22],groups:[{n:1,data:44}]},
 {total:100,ec:18,align:[6,26],groups:[{n:2,data:32}]},
 {total:134,ec:24,align:[6,30],groups:[{n:2,data:43}]},
 {total:172,ec:16,align:[6,34],groups:[{n:4,data:27}]},
 {total:196,ec:18,align:[6,22,38],groups:[{n:4,data:31}]},
 {total:242,ec:22,align:[6,24,42],groups:[{n:2,data:38},{n:2,data:39}]},
 {total:292,ec:22,align:[6,26,46],groups:[{n:3,data:36},{n:2,data:37}]}];
const QR_EXP=new Array(512), QR_LOG=new Array(256);
(function(){let x=1;for(let i=0;i<255;i++){QR_EXP[i]=x;QR_LOG[x]=i;x<<=1;if(x&0x100)x^=0x11D;}for(let i=255;i<512;i++)QR_EXP[i]=QR_EXP[i-255];})();
function qrGfMul(a,b){return (a===0||b===0)?0:QR_EXP[QR_LOG[a]+QR_LOG[b]];}
function qrRsDivisor(degree){const r=new Array(degree).fill(0);r[r.length-1]=1;let root=1;for(let i=0;i<degree;i++){for(let j=0;j<r.length;j++){r[j]=qrGfMul(r[j],root);if(j+1<r.length)r[j]^=r[j+1];}root=qrGfMul(root,0x02);}return r;}
function qrRsRemainder(data,divisor){const r=divisor.map(()=>0);for(const b of data){const f=b^r.shift();r.push(0);for(let i=0;i<divisor.length;i++)r[i]^=qrGfMul(divisor[i],f);}return r;}
function qrFormatBits(mask){const data=mask;let rem=data;for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>9)*0x537);return((data<<10)|rem)^0x5412;}
function qrVersionBits(v){let rem=v;for(let i=0;i<12;i++)rem=(rem<<1)^((rem>>11)*0x1F25);return(v<<12)|rem;}
function qrBit(x,i){return ((x>>>i)&1)!==0;}
function qrEncode(text){
  const bytes=[];const enc=(typeof TextEncoder!=='undefined')?new TextEncoder().encode(text):null;
  if(enc){for(const b of enc)bytes.push(b);}else{for(let i=0;i<text.length;i++)bytes.push(text.charCodeAt(i)&0xFF);}
  const bitsNeeded=4+8+8*bytes.length, bytesNeeded=Math.ceil((bitsNeeded+4)/8);
  let version=0, spec=null;
  for(let v=1;v<=9;v++){const cap=QR_VERSIONS[v].groups.reduce((s,g)=>s+g.n*g.data,0);if(cap>=bytesNeeded){version=v;spec=QR_VERSIONS[v];break;}}
  if(!version)return null;
  const dataCap=spec.groups.reduce((s,g)=>s+g.n*g.data,0);
  // Build the data bit stream, then pad to fill the data codewords.
  const bb=[];const pushBits=(val,len)=>{for(let i=len-1;i>=0;i--)bb.push((val>>>i)&1);};
  pushBits(0x4,4);pushBits(bytes.length,8);for(const b of bytes)pushBits(b,8);
  const capBits=dataCap*8;pushBits(0,Math.min(4,capBits-bb.length));
  while(bb.length%8!==0)bb.push(0);
  const padBytes=[0xEC,0x11];let pi=0;
  while(bb.length<capBits){pushBits(padBytes[pi%2],8);pi++;}
  const data=[];for(let i=0;i<bb.length;i+=8){let b=0;for(let j=0;j<8;j++)b=(b<<1)|bb[i+j];data.push(b);}
  // Split into blocks, compute ECC per block, interleave data then ECC.
  const blocks=[];let off=0;
  for(const g of spec.groups)for(let k=0;k<g.n;k++){const chunk=data.slice(off,off+g.data);off+=g.data;blocks.push({data:chunk,ecc:qrRsRemainder(chunk,qrRsDivisor(spec.ec))});}
  const out=[];const maxData=Math.max(...blocks.map(b=>b.data.length));
  for(let i=0;i<maxData;i++)for(const b of blocks)if(i<b.data.length)out.push(b.data[i]);
  for(let i=0;i<spec.ec;i++)for(const b of blocks)out.push(b.ecc[i]);
  // Matrix: -1 = not set yet.
  const size=17+4*version;
  const modules=[], isFunc=[];
  for(let y=0;y<size;y++){modules.push(new Array(size).fill(-1));isFunc.push(new Array(size).fill(false));}
  const setF=(x,y,v)=>{modules[y][x]=v?1:0;isFunc[y][x]=true;};
  const finder=(cx,cy)=>{for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const x=cx+dx,y=cy+dy;if(x<0||y<0||x>=size||y>=size)continue;const d=Math.max(Math.abs(dx),Math.abs(dy));setF(x,y,d!==2&&d!==4);}};
  finder(3,3);finder(size-4,3);finder(3,size-4);
  for(let i=8;i<size-8;i++){setF(i,6,i%2===0);setF(6,i,i%2===0);}
  for(const ax of spec.align)for(const ay of spec.align){
    if((ax===6&&ay===6)||(ax===6&&ay===size-7)||(ax===size-7&&ay===6))continue;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)setF(ax+dx,ay+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
  }
  // Reserve format + version info areas (all 15 bits of each copy).
  for(let i=0;i<6;i++){setF(8,i,0);setF(i,8,0);}
  setF(8,7,0);setF(8,8,0);setF(7,8,0);
  for(let i=0;i<8;i++)setF(size-1-i,8,0); // row 8, cols size-1..size-8
  for(let i=0;i<7;i++)setF(8,size-7+i,0); // col 8, rows size-7..size-1
  setF(8,size-8,1); // dark module: column 8, row size-8
  if(version>=7)for(let i=0;i<18;i++){const a=size-11+(i%3),b=Math.floor(i/3);setF(a,b,0);setF(b,a,0);}
  // Place data bits, zig-zag from bottom right, skipping column 6.
  let bi=0;
  for(let right=size-1;right>=1;right-=2){
    if(right===6)right=5;
    for(let vert=0;vert<size;vert++)for(let j=0;j<2;j++){
      const x=right-j, up=((right+1)&2)===0, y=up?size-1-vert:vert;
      if(!isFunc[y][x]&&bi<out.length*8){modules[y][x]=(out[bi>>>3]>>>(7-(bi&7)))&1;bi++;}
    }
  }
  // Try every mask, keep the one with the lowest penalty score.
  const maskBit=(m,x,y)=>{switch(m){case 0:return(x+y)%2===0;case 1:return y%2===0;case 2:return x%3===0;case 3:return(x+y)%3===0;case 4:return(Math.floor(y/2)+Math.floor(x/3))%2===0;case 5:return((x*y)%2+(x*y)%3)===0;case 6:return(((x*y)%2+(x*y)%3)%2)===0;default:return(((x+y)%2+(x*y)%3)%2)===0;}};
  function penalty(ms){
    let p=0;
    const runs=(line)=>{let c=line[0],n=1;for(let i=1;i<line.length;i++){if(line[i]===c){n++;}else{if(n>=5)p+=3+(n-5);c=line[i];n=1;}}if(n>=5)p+=3+(n-5);};
    for(let y=0;y<size;y++)runs(ms[y]);
    for(let x=0;x<size;x++){const col=[];for(let y=0;y<size;y++)col.push(ms[y][x]);runs(col);}
    for(let y=0;y<size-1;y++)for(let x=0;x<size-1;x++)if(ms[y][x]===ms[y][x+1]&&ms[y][x]===ms[y+1][x]&&ms[y][x]===ms[y+1][x+1])p+=3;
    const finderLike=(line)=>{for(let i=0;i+10<line.length;i++){let v=0;for(let k=0;k<11;k++)v=(v<<1)|line[i+k];if(v===0x5D0||v===0x05D)p+=40;}};
    for(let y=0;y<size;y++)finderLike(ms[y]);
    for(let x=0;x<size;x++){const col=[];for(let y=0;y<size;y++)col.push(ms[y][x]);finderLike(col);}
    let dark=0;for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(ms[y][x])dark++;
    const total=size*size, k=Math.ceil(Math.abs(dark*20-total*10)/total)-1;
    return p+Math.max(0,k)*10;
  }
  let best=null,bestMask=0,bestScore=Infinity;
  for(let m=0;m<8;m++){
    const ms=modules.map(r=>r.slice());
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(!isFunc[y][x]&&maskBit(m,x,y))ms[y][x]^=1;
    const fb=qrFormatBits(m);
    // First copy: bits 0–5 down column 8 (rows 0–5), bit 6 at (row 8, col 7),
    // bit 7 at (8,8), bit 8 at (row 7, col 8), bits 9–14 along row 8 (cols 5–0).
    for(let i=0;i<=5;i++)ms[i][8]=qrBit(fb,i)?1:0;
    ms[7][8]=qrBit(fb,6)?1:0;ms[8][8]=qrBit(fb,7)?1:0;ms[8][7]=qrBit(fb,8)?1:0;
    for(let i=9;i<15;i++)ms[8][14-i]=qrBit(fb,i)?1:0;
    for(let i=0;i<8;i++)ms[8][size-1-i]=qrBit(fb,i)?1:0;
    for(let i=8;i<15;i++)ms[size-15+i][8]=qrBit(fb,i)?1:0;
    ms[size-8][8]=1;
    if(version>=7){const vb=qrVersionBits(version);for(let i=0;i<18;i++){const bit=qrBit(vb,i)?1:0;const a=size-11+(i%3),b=Math.floor(i/3);ms[b][a]=bit;ms[a][b]=bit;}}
    const s=penalty(ms);
    if(s<bestScore){bestScore=s;best=ms;bestMask=m;}
  }
  return {version,size,modules:best,mask:bestMask};
}
function drawQR(text,canvas){
  if(!canvas)return false;
  const qr=qrEncode(text);if(!qr)return false;
  const quiet=4,n=qr.size+quiet*2,scale=Math.max(2,Math.floor(320/n));
  canvas.width=n*scale;canvas.height=n*scale;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#000';
  for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.modules[y][x])ctx.fillRect((x+quiet)*scale,(y+quiet)*scale,scale,scale);
  return true;
}
window._photoData='';
function pickPhoto(input){const f=input.files&&input.files[0];if(!f)return;const img=new Image();const rd=new FileReader();rd.onload=e=>{img.onload=()=>{const max=800;const sc=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*sc);c.height=Math.round(img.height*sc);c.getContext('2d').drawImage(img,0,0,c.width,c.height);window._photoData=c.toDataURL('image/jpeg',0.8);const p=document.getElementById('sPhotoPrev');p.src=window._photoData;p.style.display='block';};img.src=e.target.result;};rd.readAsDataURL(f);}
async function createListing(){
  const size=document.getElementById('sSize').value;
  const wheelItems=(document.getElementById('sWheel').value||'').split('\n').map(s=>s.trim()).filter(Boolean);
  const b={seller:document.getElementById('sSeller').value,title:document.getElementById('sTitle').value,description:document.getElementById('sDesc').value,category:document.getElementById('sCat').value,type:document.getElementById('sType').value,startPrice:document.getElementById('sStart').value,fixedPrice:document.getElementById('sFixed').value,packageSize:size,shipping:(SHIP_SIZES[size]||{}).price,authenticity:document.getElementById('sAuth').value,timerSeconds:document.getElementById('sTimer').value,mode:document.getElementById('sMode').value,shippingInsured:document.getElementById('sInsured').checked,agreement:document.getElementById('sAgree').checked,imageUrl:window._photoData||'',wheelItems};
  const r=await j('/api/listings',b); document.getElementById('sellMsg').textContent=r.ok?'Listed!':('Error: '+r.error); if(r.ok)load();
}
// Random Items: one tap creates N numbered auctions (Random Item 1, 2, 3…),
// no picture needed — the seller shows each one live on camera. Uses the
// same seller name, category, starting bid, timer, mode, package size,
// insured shipping and Seller Agreement as the sell form above.
async function createRandomItems(){
  const size=document.getElementById('sSize').value;
  const b={isRandom:true,randomBase:document.getElementById('sRandomBase').value,randomCount:Number(document.getElementById('sRandomCount').value),seller:document.getElementById('sSeller').value,category:document.getElementById('sCat').value,startPrice:document.getElementById('sStart').value,packageSize:size,shipping:(SHIP_SIZES[size]||{}).price,authenticity:document.getElementById('sAuth').value,timerSeconds:document.getElementById('sTimer').value,mode:document.getElementById('sMode').value,shippingInsured:document.getElementById('sInsured').checked,agreement:document.getElementById('sAgree').checked};
  const r=await j('/api/listings',b);
  document.getElementById('randomMsg').textContent=r.ok?`Created ${r.count} random items: ${r.titles.join(', ')} — no picture, show each one live on camera.` : ('Error: '+r.error);
  if(r.ok)load();
}
// Seller says what the winner actually won on a Random Item — the item they
// held up live on camera. Saved on the listing, then shown on the receipt,
// the video receipt and the ship-QR section.
async function revealItem(id){
  const seller=document.getElementById('cName').value;
  const revealed=document.getElementById('revealedInput').value;
  const r=await j('/api/listings/'+id+'/reveal',{seller,revealedItem:revealed});
  if(!r.ok){alert('Error: '+r.error);return;}
  openItem(id);
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
// ---------- Time Wheel (Kevin's own design — a clock-face wheel, gold + dark navy) ----------
// Items sit around the wheel like numbers on a clock; a gold hand at the top
// points at the landed item. Nobody buys a spot, nobody pays to spin — the
// winner pays the winning bid + shipping, the wheel lands on ONE item, and
// that item is what they get. No extra prize, no extra charge.
function wheelAngle(i,n){return n?i*360/n:0;}
function wheelSVG(l,rotDeg){
  const items=l.wheel_items||[];
  if(!items.length)return '<p class="small">No items on this wheel yet.</p>';
  const n=items.length, cx=160, cy=160, r=118;
  const font=n<=12?13:n<=24?11:n<=48?9:7;
  let texts='';
  items.forEach((it,i)=>{
    const a=wheelAngle(i,n)*Math.PI/180;
    const x=cx+r*Math.sin(a), y=cy-r*Math.cos(a);
    const label=String(it.name||'').slice(0,18);
    texts+=`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="#f5d76e" font-size="${font}" font-weight="600" transform="rotate(${wheelAngle(i,n)} ${x.toFixed(1)} ${y.toFixed(1)})">${escHtml(label)}</text>`;
  });
  return `<svg viewBox="0 0 320 320" style="width:100%;max-width:340px;display:block;margin:0 auto">
  <circle cx="160" cy="160" r="152" fill="#0b1f3a" stroke="#c9a227" stroke-width="4"/>
  <circle cx="160" cy="160" r="138" fill="none" stroke="#c9a227" stroke-width="1" opacity="0.5"/>
  <g id="wheelDial" style="transform-origin:160px 160px;transform:rotate(${rotDeg||0}deg)">${texts}</g>
  <circle cx="160" cy="160" r="34" fill="#c9a227"/><text x="160" y="157" text-anchor="middle" fill="#0b1f3a" font-size="11" font-weight="700">TIME</text><text x="160" y="171" text-anchor="middle" fill="#0b1f3a" font-size="11" font-weight="700">WHEEL</text>
  <polygon points="160,2 148,26 172,26" fill="#f5d76e" stroke="#c9a227" stroke-width="1"/></svg>`;
}
function wheelPanel(l){
  const items=l.wheel_items||[];
  const landedIdx=items.findIndex(x=>x.name===l.wheel_landed_item);
  const rot=l.wheel_spun&&landedIdx>=0?-wheelAngle(landedIdx,items.length):0;
  let status='';
  if(l.wheel_spun&&l.wheel_landed_item)status=`<p><b>⏰ The wheel landed on: ${escHtml(l.wheel_landed_item)}</b> — that is the item ${escHtml(l.winner||'the winner')} gets. No extra prize, no extra charge.</p>`;
  else if(l.status==='sold'&&l.payment_status==='validated')status=`<p>The winner has paid — spin the wheel to see what they get.</p><button class="btn" onclick="spinWheel('${l.id}')">Spin the Time Wheel</button>`;
  else if(l.status==='ended')status=`<p class="small">The wheel spins once the winner pays.</p>`;
  else status=`<p class="small">Bidding is for the wheel — the winner pays the winning bid + shipping, then the wheel spins and lands on one item. That item is what they get.</p>`;
  return `<div style="border:3px solid #c9a227;border-radius:14px;padding:12px;margin-top:10px;background:#0b1f3a">
  <h3 style="color:#f5d76e;margin-top:0">⏰ Time Wheel — ${items.length} item${items.length===1?'':'s'}</h3>
  <p class="small" style="color:#f5d76e">You win the item the wheel lands on — no extra prize, no extra charge. Nobody buys a spot, nobody pays to spin.</p>
  ${wheelSVG(l,rot)}
  ${status}
  <p id="wheelMsg" class="small"></p>
  <details><summary class="small">See all ${items.length} items on the wheel</summary><ol class="small">${items.map(x=>`<li>${escHtml(x.name)}</li>`).join('')}</ol></details>
  </div>`;
}
async function spinWheel(id){
  const name=(document.getElementById('cName')&&document.getElementById('cName').value)||(document.getElementById('bName')&&document.getElementById('bName').value)||'';
  const r=await j('/api/listings/'+id+'/spin',{name});
  if(!r.ok){alert('Error: '+r.error);return;}
  const l=await j('/api/listings/'+id);
  const items=l.wheel_items||[];
  const idx=Math.max(0,items.findIndex(x=>x.name===r.landedItem));
  const target=360*6-wheelAngle(idx,items.length||1);
  const dial=document.getElementById('wheelDial');
  if(dial){dial.style.transition='transform 4s cubic-bezier(.15,.8,.25,1)';dial.style.transform=`rotate(${target}deg)`;}
  const msg=document.getElementById('wheelMsg'); if(msg)msg.textContent='⏰ Spinning…';
  setTimeout(()=>openItem(id),4300);
}
async function openItem(id){
  const wasLive=liveListingId===id&&(liveRole==='seller'||liveRole==='viewer');
  if(!wasLive)stopLiveFull(); else stopLivePoll(); // re-render keeps the stream/PCs, restarts polling below
  liveListingId=id;
  const l=await j('/api/listings/'+id);
  const el=document.getElementById('detail'); el.scrollIntoView();
  el.innerHTML=`<div class="card">${l.image_url?`<img src="${l.image_url}" style="max-width:100%;border-radius:10px" alt="${l.title}">`:''}<h2>${l.title}</h2>${l.is_random?`<p><span class="badge gold">🎲 RANDOM ITEM — no picture, seller shows it live on camera</span></p>`:''}<p>${l.description||''} • ${l.category} • ${l.authenticity} • Seller: ${l.seller}</p>
  ${l.is_random&&l.status==='sold'&&l.payment_status==='validated'?`<div style="border:2px solid #c9a227;border-radius:10px;padding:12px;margin-top:10px"><h3>🎲 What they won</h3>${l.revealed_item?`<p><b>Revealed live on camera: ${escHtml(l.revealed_item)}</b> — that is what ${escHtml(l.winner)} won.</p>`:`<p>Random Item — revealed live on camera, seller to confirm what it was.</p><label>What they won (seller only — type the item you held up live) <input id="revealedInput" placeholder="e.g. Invicta Lupah watch"></label><button class="btn" onclick="revealItem('${l.id}')">Save what they won</button>`}</div>`:''}
  ${l.type==='wheel'?wheelPanel(l):''}
  ${(l.type==='auction'||l.type==='wheel')?`<p class="timer" id="cd"></p><p>Current bid $${l.current_bid} • Shipping $${l.shipping} • Total if you win now: $${l.current_bid+l.shipping}</p>
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
  ${l.payout?`<div style="border:2px solid #c9a227;border-radius:10px;padding:12px;margin-top:10px"><h3>💰 Seller payout — ${escHtml(l.payout.tier)} seller</h3>${l.payout.incorrectClaims?`<p><b>Incorrect return claims: ${l.payout.incorrectClaims}</b> — ${l.payout.banned?'selling privileges removed — this seller cannot sell on the site again.':l.payout.canSell?'suspension ended — selling is open again.':'selling privileges suspended until <b>'+new Date(l.payout.suspendedUntil).toLocaleString()+'</b> — listings are hidden and no new items can be listed until then.'}</p>`:''}<p><b>${escHtml(l.seller)}</b> has <b>${l.payout.cleanSales} clean sale${l.payout.cleanSales===1?'':'s'}</b>${l.payout.score!==null?` • Seller Scorecard: ${l.payout.score}/5`:''}${l.payout.nextTier?` • <b>${l.payout.salesToNext} more clean sale${l.payout.salesToNext===1?'':'s'}</b> to ${escHtml(l.payout.nextTier)}`:' • top tier — fastest payout on everything'}.<br>Sale amount $${l.payout.amount} — payout <b>${l.payout.payoutLabel} after delivery</b>${l.payout.payoutAt?` — <b>payout date: ${new Date(l.payout.payoutAt).toLocaleString()}</b>`:' (payout date is set once delivery is confirmed)'}${l.escrow_status==='released'?` — <b>paid out</b>`:''}.</p><p class="small">The refund window runs until this payout date — legit reason + photo + video only, and no refund after that date. A payout never comes out while a refund is pending. Test mode: this is a tracked payout date, not a real bank transfer — no real payment processor is connected yet.</p></div>`:''}
  ${l.status==='sold'&&l.delivered_at&&l.payment_status==='validated'?(()=>{const dl=l.payout&&l.payout.payoutAt?new Date(l.payout.payoutAt):null;const closed=l.escrow_status==='released'||(dl&&new Date()>=dl);const rf=l.refund;if(rf&&rf.status!=='expired'){return `<div style="border:3px solid #c62828;border-radius:10px;padding:12px;margin-top:10px"><h3>↩️ Refund request — ${escHtml(rf.requester||'Buyer')} • ${escHtml(rf.reason||'')}</h3>${rf.status==='approved'?`<p><b>Refund given.</b> ${rf.return_choice==='want_back'?(rf.return_delivered_at?`The seller asked for the item back, the buyer shipped it back, and the return was scanned as DELIVERED on ${new Date(rf.return_delivered_at).toLocaleString()} — the refund released on its own, no seller tap needed.`:(rf.dispute_status==='correct'?'The owner reviewed the proof and the item sent back is the correct item — the claim was not upheld, so the refund was released.':'The seller asked for the item back, the buyer shipped it back, and the seller confirmed they received it — then the refund was released.')):'The seller agreed to refund without the item back — the buyer keeps the item.'} The refund came out of the seller's escrow money, not the owner's fees.</p>`:rf.status==='awaiting_return'?`<p><b>The seller wants the item back first — no refund until they receive it, or the return is scanned as delivered.</b><br>Return label: <b>${escHtml(rf.return_label_carrier||'')} ${escHtml(rf.return_label_tracking||'')}</b> (code ${escHtml(rf.return_label_code||'')}) — test label only, no real carrier connected yet.<br>Return label cost: <b>$${Number(rf.return_cost||0).toFixed(2)}</b> — paid by the seller, because the seller asked for the item back. Not the buyer's cost, not the owner's fees.<br>${rf.return_shipped_at?`Return shipped ${new Date(rf.return_shipped_at).toLocaleString()} — tracking ${escHtml(rf.return_tracking||rf.return_label_tracking||'')} — waiting for the seller to confirm they got it back.<br><b>If the seller does not confirm, the refund releases on its own ${rf.returnAutoReleaseAt?new Date(rf.returnAutoReleaseAt).toLocaleString():'48 hours after the return was shipped'}</b> — the seller cannot stall it by not tapping. In test mode delivery is recorded from the tracking / mark-as-delivered step below — no live carrier feed yet; at go-live a real carrier delivery scan does this automatically.`:`The buyer has not shipped the return back yet. If it is not shipped back before the refund window closes (${dl?dl.toLocaleString():'the payout date'}), the refund expires and no refund is given.`}</p><label>Return tracking (the return label tracking is already filled in) <input id="retTrack" value="${escHtml(rf.return_label_tracking||'')}"></label><p class="small"><b>Before you mark it shipped:</b> send a video of the item going into the box + a picture of the label on the same box when sent out. The video proves what went in; the label picture proves that same box with that label is the one that was sent. The return cannot be marked shipped without both.</p><label>Video — item going into the box <input id="retVideo" type="file" accept="video/*" onchange="returnPick()"></label><label>Picture — the return label on the same box when sent out <input id="retPhoto" type="file" accept="image/*" onchange="returnPick()"></label><p class="small" id="retProofMsg">Attach BOTH the video and the label picture — the button stays locked until both are attached.</p><button class="btn" id="retBtn" disabled onclick="returnShipped('${rf.id}')">I shipped the return back</button>${rf.return_shipped_at?` <button class=\"btn ghost\" onclick=\"returnDelivered('${rf.id}')\">Mark return as delivered (carrier scan)</button><div style="border:2px dashed #c62828;border-radius:10px;padding:10px;margin-top:8px"><b>Seller — did the wrong item come back?</b><p class="small">If the wrong item, an empty box, or a different item arrived, tap "Wrong item sent back" and attach BOTH a photo AND a video of what actually arrived. That pauses the refund right away — the 48-hour auto-release stops and the owner decides. No photo + video, no flag. If the claim is not upheld after review, it counts against you: that sale is not a clean sale, you drop a tier, it is recorded on your Seller Scorecard, and selling privileges are suspended for 7 days after a first incorrect claim, 30 days after a second, and removed after a third.</p><label>Photo of what arrived <input id="dspPhoto" type="file" accept="image/*" onchange="disputePick()"></label><label>Video of what arrived <input id="dspVideo" type="file" accept="video/*" onchange="disputePick()"></label><p class="small" id="dspProofMsg">Attach BOTH a photo and a video — the button stays locked until both are attached.</p><button class="btn" id="dspBtn" disabled onclick="flagWrongItem('${rf.id}','${escHtml(l.seller)}')">Wrong item sent back</button><p id="dspMsg" class="small"></p></div>`:''}<p id="retMsg" class="small"></p>`:rf.status==='disputed'?`<p><b>⚠️ Wrong-item dispute open— refund paused.</b><br>The seller says the wrong item came back — photo: ${escHtml(rf.dispute_photo_name||'—')} • video: ${escHtml(rf.dispute_video_name||'—')}. The 48-hour auto-release is stopped and no refund goes out while the owner decides. The owner compares three things: the buyer's video of the item going into the box + picture of the label on the same box when sent out, the seller's photo + video of what arrived, and the original receipt + video receipt.</p>`:`<p><b>The seller is deciding.</b> It is up to the seller: refund without the item back, or ask for the item back first — then no refund until they receive it. The refund window closes ${dl?dl.toLocaleString():'on the payout date'}.</p>`}</div>`;}return `<div style="border:3px solid #c62828;border-radius:10px;padding:12px;margin-top:10px"><h3>↩️ Ask for a refund</h3>${closed?`<p><b>Refund window closed.</b> Refunds close on the payout date${dl?` (${dl.toLocaleString()})`:''} — after the seller is paid out, no refund. Same rule as always: legit reason only, and a photo + video were required while the window was open.</p>`:`<p style="color:#c62828"><b>Refund window closes ${dl?dl.toLocaleString():'on the payout date'}</b> (${l.payout?l.payout.payoutLabel:''} after delivery) — legit reason only, and you must send BOTH a photo AND a video of the item, or no refund. After that date, no refund.</p><p class="small">It's up to the seller what happens next: they can refund without the item back, or ask for the item back first — then no refund until they receive it. If they ask for it back, a tracked return label is sent to you, paid for by the seller.</p><label>Your name <input id="rfName" placeholder="Your name"></label><label>Legit reason <select id="rfReason"><option value="not as described">Not as described</option><option value="damaged in transit">Damaged in transit</option><option value="wrong item">Wrong item</option><option value="defective">Defective</option><option value="never arrived">Never arrived</option></select></label><p class="small">"Changed my mind" is not accepted — the form only offers legit reasons.</p><label>Photo of the item <input id="rfPhoto" type="file" accept="image/*" onchange="refundPick()"></label><label>Video of the item <input id="rfVideo" type="file" accept="video/*" onchange="refundPick()"></label><p class="small" id="rfProofMsg">Attach BOTH a photo and a video — the button stays locked until both are attached.</p><button class="btn" id="rfBtn" disabled onclick="submitRefund('${l.id}')">Ask for a refund</button><p id="rfMsg" class="small"></p>`}</div>`;})():''}
  ${l.receipt?`<p>Receipt ${l.receipt.receipt_no} — total $${l.receipt.total} — <a href="#" onclick="alert('Receipt ${l.receipt.receipt_no}: ${l.title}, $${l.receipt.total} paid, seller ${l.seller}, winner ${l.winner}');return false">Download receipt</a></p>${l.wheel_landed_item?`<p><b>You won: ${escHtml(l.wheel_landed_item)}</b> — the item the Time Wheel landed on. No extra prize, no extra charge.</p>`:''}${l.revealed_item?`<p><b>You won: ${escHtml(l.revealed_item)}</b> — revealed live on camera (Random Item: ${escHtml(l.title)}).</p>`:l.is_random&&l.status==='sold'?`<p class="small">🎲 Video receipt: Random Item — revealed live on camera, seller to confirm what it was.</p>`:''}`:''}
  <p class="small">Package size: ${l.package_size?shipLabelOf(l.package_size)+' — $'+l.shipping+' shipping (buyer pays)':'Shipping $'+l.shipping+' (buyer pays)'} • <b>${shipViaText(l)}</b></p>
  ${l.qr_text?`<div style="border:2px solid #c9a227;border-radius:10px;padding:12px;margin-top:10px"><h3>📦 Ship this order — scan the QR code</h3>
  <canvas id="shipQR" style="max-width:100%;background:#fff;border-radius:8px"></canvas>
  <p><b>${l.title}</b>${l.wheel_landed_item?`<br>Item to ship: <b>${escHtml(l.wheel_landed_item)}</b> (what the Time Wheel landed on)`:''}${l.revealed_item?`<br>Item to ship: <b>${escHtml(l.revealed_item)}</b> (revealed live on camera)`:l.is_random?`<br>Item to ship: random item — seller to confirm what it was`:''}<br>Winner: ${l.winner}<br>Winner address: address on file<br>Package: ${l.package_size?shipLabelOf(l.package_size):'—'} • Shipping $${l.shipping}<br><b>Carrier: ${carrierOf(l)}</b> — ${carrierOf(l)==='UPS'?'drop it off at UPS (over 5 lbs)':'drop it off at the post office (USPS)'}<br>Tracking: ${l.qr_tracking||l.tracking||'—'}<br>Receipt: ${l.qr_receipt||''}</p>
  <p class="small">Scan this code with your phone — it opens this exact sale, so you ship the right item and don't box up the wrong order. This QR is a shipment record, not real ${carrierOf(l)} postage yet.</p>
  ${l.shipped_at?`<p><span class="badge green">Marked as shipped ${l.shipped_at}</span></p>`:`<button class="btn" onclick="markShipped('${l.id}')">Mark as shipped</button>`}
  <p id="shipMsg" class="small"></p></div>`:''}
  <h3>Live video ${l.seller_live?'<span class="badge">🔴 LIVE NOW</span>':''}</h3>
  <video id="liveVideo" playsinline autoplay style="width:100%;max-height:420px;background:#000;border-radius:10px;display:none"></video>
  <button class="btn" id="unmuteBtn" style="display:none" onclick="const v=document.getElementById('liveVideo');v.muted=false;v.play();this.style.display='none'">Tap for sound — hear the seller</button>
  <p id="liveStatus" class="small">${l.seller_live?'Seller is live — connecting to live video…':'Seller is not live yet. When they go live, their camera shows here.'}</p>
  <button class="btn ghost" id="endLiveBtn" style="display:none" onclick="endLive('${l.id}')">End Live</button>
  <h3>Chat room ${l.seller_live?'<span class="badge">🔴 LIVE NOW</span>':''}</h3><p class="small">Live video + live chat — type in chat what you want the seller to show you. No advertising other auction sites or marketplaces here — links to other sites are not allowed and will be blocked.</p>
  <div class="chat">${l.chats.map(c=>`<p><b>${c.name}${c.is_seller?' (seller)':''}:</b> ${c.message}</p>`).join('')}</div>
  <label>Your name <input id="cName"></label><label>Message <input id="cMsg"></label><button class="btn" onclick="chat('${l.id}')">Post</button>
  <button class="btn ghost" onclick="goLive('${l.id}')">Go Live — Turn Camera On (seller only)</button>
  <button class="btn ghost" onclick="offer('${l.id}')">Post Buy It Now offer in chat (seller)</button>
  <p><button class="btn ghost" onclick="report('${l.id}')">Report this listing</button> <button class="btn ghost" onclick="score('${l.seller}')">Seller Scorecard</button></p>
  <div id="itemMsg"></div></div>`;
  if(l.qr_text)drawQR(l.qr_text,document.getElementById('shipQR'));
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
  } else if(l.seller_live&&(l.type==='auction'||l.type==='wheel')){
    startViewer(id);
  }
}
async function bid(id,add){const l=await j('/api/listings/'+id);const r=await j('/api/listings/'+id+'/bid',{bidder:document.getElementById('bName').value||'Buyer',amount:l.current_bid+add});alert(r.ok?`Bid placed: $${r.currentBid} (total $${r.total})`:'Error: '+r.error);openItem(id);}
async function bidCustom(id){const r=await j('/api/listings/'+id+'/bid',{bidder:document.getElementById('bName').value||'Buyer',amount:Number(document.getElementById('bAmt').value)});alert(r.ok?`Bid placed: $${r.currentBid}`:'Error: '+r.error);openItem(id);}
async function setTop(id){const r=await j('/api/top-limit',{listingId:id,buyer:document.getElementById('bName').value||'Buyer',maxAmount:Number(document.getElementById('tlAmt').value)});alert(r.ok?'My Top Limit set':'Error: '+r.error);}
async function buyNow(id){const r=await j('/api/listings/'+id+'/buy-now',{buyer:document.getElementById('bName').value||'Buyer',method:document.getElementById('pMethod').value,detail:document.getElementById('pDetail').value});alert(r.ok?`Sale complete — $${r.total} in escrow. Receipt ${r.receiptNo}`:'Error: '+r.error);openItem(id);}
async function payWinner(id){const r=await j('/api/listings/'+id+'/pay',{method:document.getElementById('pMethod').value,detail:document.getElementById('pDetail').value});alert(r.ok?(`Payment went through — $${r.total} in escrow`+(r.landedItem?` — the Time Wheel landed on: ${r.landedItem}`:'')):'Error: '+r.error);openItem(id);}
async function markShipped(id){const seller=document.getElementById('cName').value;const r=await j('/api/listings/'+id+'/mark-shipped',{seller});const m=document.getElementById('shipMsg');if(m)m.textContent=r.ok?('Marked as shipped — tracking '+r.tracking):('Error: '+r.error);if(r.ok)openItem(id);}
window._rfPhoto='';window._rfVideo='';
function refundPick(){const ph=document.getElementById('rfPhoto');const vd=document.getElementById('rfVideo');window._rfPhoto=ph&&ph.files&&ph.files[0]?ph.files[0].name:'';window._rfVideo=vd&&vd.files&&vd.files[0]?vd.files[0].name:'';const b=document.getElementById('rfBtn');if(b)b.disabled=!(window._rfPhoto&&window._rfVideo);const m=document.getElementById('rfProofMsg');if(m)m.textContent=(window._rfPhoto&&window._rfVideo)?'Photo + video attached — you can send the refund request.':'Attach BOTH a photo and a video — the button stays locked until both are attached.';}
async function submitRefund(id){const r=await j('/api/refunds',{listingId:id,requester:document.getElementById('rfName').value||'Buyer',reason:document.getElementById('rfReason').value,photoName:window._rfPhoto,videoName:window._rfVideo});const m=document.getElementById('rfMsg');if(m)m.textContent=r.ok?'Refund request sent — it comes out of the seller\'s escrow money, not the owner\'s fees.':'Error: '+r.error;if(r.ok)openItem(id);}
async function refundChoose(rfId,seller,choice){const r=await j('/api/refunds/'+rfId+'/choose',{seller,choice});alert(r.ok?(choice==='no_return'?'Refund released without the item back — buyer keeps the item.':'Return label sent to the buyer — no refund until you confirm you got the item back. The return label cost ($'+(r.returnCost||0).toFixed(2)+') is your cost, not the buyer\'s and not the owner\'s fees.'):'Error: '+r.error);loadDash();}
async function returnShipped(rfId){const t=document.getElementById('retTrack');const r=await j('/api/refunds/'+rfId+'/return-shipped',{tracking:t?t.value:'',photoName:window._retPhoto,videoName:window._retVideo});const m=document.getElementById('retMsg');if(m)m.textContent=r.ok?('Return shipped — tracking '+(r.tracking||'')+'. The seller will confirm when they receive it.'):'Error: '+r.error;if(r.ok)openItem(curItemId());}
async function returnDelivered(rfId){const r=await j('/api/refunds/'+rfId+'/return-delivered',{});const m=document.getElementById('retMsg');if(m)m.textContent=r.ok?'Return marked as delivered — refund released, no seller tap needed.':'Error: '+r.error;if(r.ok){if(curItemId())openItem(curItemId());else loadDash();}else alert('Error: '+r.error);}
function curItemId(){const q=new URLSearchParams(location.search);return q.get('i')||liveListingId;}
async function confirmReceipt(rfId,seller){const r=await j('/api/refunds/'+rfId+'/confirm-receipt',{seller});alert(r.ok?'You confirmed you got the item back — the refund is now released from your escrow money.':'Error: '+r.error);loadDash();}
async function fixPay(id){const r=await j('/api/listings/'+id+'/notify-fix',{});alert(r.ok?'Fix-payment notice sent to the winner':'Error: '+r.error);}
async function rerun(id,seller){const r=await j('/api/listings/'+id+'/rerun',{seller});alert(r.ok?'Auction rerun — live again at the same price/timer':'Error: '+r.error);openItem(id);}
function returnPick(){const ph=document.getElementById('retPhoto');const vd=document.getElementById('retVideo');window._retPhoto=ph&&ph.files&&ph.files[0]?ph.files[0].name:'';window._retVideo=vd&&vd.files&&vd.files[0]?vd.files[0].name:'';const b=document.getElementById('retBtn');if(b)b.disabled=!(window._retPhoto&&window._retVideo);const m=document.getElementById('retProofMsg');if(m)m.textContent=(window._retPhoto&&window._retVideo)?'Video + label picture attached — you can mark the return shipped.':'Attach BOTH the video and the label picture — the button stays locked until both are attached.';}
function disputePick(){const ph=document.getElementById('dspPhoto');const vd=document.getElementById('dspVideo');window._dspPhoto=ph&&ph.files&&ph.files[0]?ph.files[0].name:'';window._dspVideo=vd&&vd.files&&vd.files[0]?vd.files[0].name:'';const b=document.getElementById('dspBtn');if(b)b.disabled=!(window._dspPhoto&&window._dspVideo);const m=document.getElementById('dspProofMsg');if(m)m.textContent=(window._dspPhoto&&window._dspVideo)?'Photo + video attached — you can flag the wrong item.':'Attach BOTH a photo and a video — the button stays locked until both are attached.';}
async function flagWrongItem(rfId,seller){const r=await j('/api/refunds/'+rfId+'/wrong-item',{seller,photoName:window._dspPhoto,videoName:window._dspVideo});const m=document.getElementById('dspMsg');if(m)m.textContent=r.ok?'Wrong item flagged — the refund is paused and the owner will decide. The 48-hour auto-release is stopped.':'Error: '+r.error;if(r.ok){if(curItemId())openItem(curItemId());else loadDash();}else alert('Error: '+r.error);}
async function decideDispute(rfId,decision){const r=await j('/api/refunds/'+rfId+'/dispute-decide',{decision});alert(r.ok?(decision==='wrong'?'Refund denied — the buyer sent the wrong item. A new return label was sent and the buyer must send the right item back within 7 days, or no refund.':'Item is correct — claim not upheld, refund released. Recorded against the seller: that sale is not a clean sale, the seller drops a tier, it is on their Seller Scorecard, and selling privileges are suspended for 7 days after a first incorrect claim, 30 days after a second, and removed after a third.'):'Error: '+r.error);loadDash();}
async function chat(id){const r=await j('/api/listings/'+id+'/chat',{name:document.getElementById('cName').value||'Buyer',message:document.getElementById('cMsg').value});if(!r.ok){alert('Error: '+r.error);return;}openItem(id);}
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
async function joinWaitlist(){const r=await j('/api/waitlist',{name:document.getElementById('wName').value,email:document.getElementById('wEmail').value,founding:document.getElementById('wFound').checked});
  // The server tries to email a welcome note right away (Resend, if a key is set).
  // 'sent' = check your email; 'manual'/'failed' = you're on the list, launch email still covers you.
  if(!r.ok){document.getElementById('waitMsg').textContent=r.error;return;}
  if(r.alreadyJoined){document.getElementById('waitMsg').textContent="You're already on the list — we'll email you when it goes live.";return;}
  document.getElementById('waitMsg').textContent=r.welcomeEmail==='sent'?"You're on the list! Check your email for a welcome note — we'll email you when it goes live.":"You're on the list! We'll email you when it goes live.";
}
async function claimFounding(){const r=await j('/api/founding/claim',{seller:document.getElementById('wName').value||'Seller'});document.getElementById('waitMsg').textContent=r.ok?`Founding spot claimed! ${r.taken}/10 taken`:'Error: '+r.error;load();}
async function checkTier(){const name=document.getElementById('tierSeller').value.trim();if(!name){document.getElementById('tierMsg').textContent='Type a seller name first.';return;}const t=await j('/api/payout-tier/'+encodeURIComponent(name));document.getElementById('tierMsg').textContent=`${t.seller} — ${t.tier} seller • ${t.cleanSales} clean sales${t.incorrectClaims?` • Incorrect return claims: ${t.incorrectClaims} — `+(t.banned?'selling privileges removed.':t.canSell?'suspension ended.':`selling privileges suspended until ${new Date(t.suspendedUntil).toLocaleString()}.`):''}${t.score!==null?` • Score ${t.score}/5 (${t.scoreCount} scores)`:''}${t.nextTier?` • ${t.salesToNext} more clean sales to ${t.nextTier}`:' • top tier — fastest payout on everything'}.`;}
async function loadDash(){const d=await j('/api/dashboard');const sd=d.safeDraw;document.getElementById('dash').innerHTML=`<p>Total fees earned: $${d.totalFeesEarned}</p><p>Tax set aside (${d.taxPercent}%): $${d.taxSetAside}</p><p>Available to use / owner draw: $${d.availableToUse}</p><p>Unpaid wins: ${d.unpaidWins.length} • Refunds pending: ${d.refundsPending.length} • Escrow held: ${d.escrowHeld.length}</p>${d.refundsPending.length?`<h3>Refund requests — seller decides</h3><p class="small">Legit reason + photo + video only. It's up to the seller: refund without the item back, or ask for the item back first — then no refund until they receive it. A refund comes out of the seller's escrow money, not the owner's fees.</p>`+d.refundsPending.map(rf=>`<div style="border:2px solid #c62828;border-radius:10px;padding:10px;margin-top:8px"><p class="small"><b>${escHtml(rf.title||rf.listing_id)}</b> — ${escHtml(rf.requester||'Buyer')} • ${escHtml(rf.reason||'')} • photo: ${escHtml(rf.photo_name||'—')} • video: ${escHtml(rf.video_name||'—')}${rf.refundDeadline?` • refund window closes ${new Date(rf.refundDeadline).toLocaleString()} (${escHtml(rf.refundLabel||'')})`:''}</p>${rf.status==='awaiting_return'?`<p class="small"><b>Waiting for the item back.</b>${rf.dispute_status==='wrong'?` <b>Owner ruled the buyer sent the wrong item before — this is a new label for the RIGHT item. Buyer has until ${rf.return_due_at?new Date(rf.return_due_at).toLocaleString():'7 days from the decision'} to send it back, or no refund.</b>`:''} Return label: ${escHtml(rf.return_label_carrier||'')} ${escHtml(rf.return_label_tracking||'')} (code ${escHtml(rf.return_label_code||'')}) — test label only, no real carrier connected yet. Return label cost $${Number(rf.return_cost||0).toFixed(2)} — paid by the seller, because the seller asked for the item back. ${rf.return_shipped_at?`Return shipped ${new Date(rf.return_shipped_at).toLocaleString()} — tracking ${escHtml(rf.return_tracking||rf.return_label_tracking||'')}. ${rf.returnAutoReleaseAt?`If you do not confirm, the refund releases on its own <b>${new Date(rf.returnAutoReleaseAt).toLocaleString()}</b> — the seller cannot stall it by not tapping.`:''}`:'Buyer has not shipped it back yet — if it is not shipped back before the refund window closes, the refund expires and no refund is given.'}</p>${rf.return_shipped_at?`<button class="btn" onclick="confirmReceipt('${rf.id}','${escHtml(rf.seller||'')}')">Confirm I got the item back — release the refund</button> <button class=\"btn ghost\" onclick=\"returnDelivered('${rf.id}')\">Mark return as delivered (carrier scan)</button>`:''}`:rf.status==='disputed'?`<p><b>⚠️ DISPUTE OPEN — refund paused.</b> The seller says the wrong item came back. The 48-hour auto-release is stopped — no refund goes out while the owner decides.</p><p class="small"><b>1 — Buyer's return proof</b> (video of the item going into the box + picture of the label on the same box when sent out) — video: ${escHtml(rf.return_video_name||'—')} • picture: ${escHtml(rf.return_photo_name||'—')}<br><b>2 — Seller's arrival proof</b> (what actually arrived) — photo: ${escHtml(rf.dispute_photo_name||'—')} • video: ${escHtml(rf.dispute_video_name||'—')}<br><b>3 — Original receipt + video receipt</b> — ${rf.receipt ? escHtml(rf.receipt.receiptNo||'') + ' — ' + escHtml(rf.receipt.item||'') + ' — total $' + rf.receipt.total + ' — seller was live: ' + (rf.receipt.videoReceipt&&rf.receipt.videoReceipt.sellerWasLive?'yes':'no') + ' — bids: ' + (rf.receipt.videoReceipt?rf.receipt.videoReceipt.bids.length:0) + ' — chat messages: ' + (rf.receipt.videoReceipt?rf.receipt.videoReceipt.chats.length:0) : 'no receipt yet'}</p><p class="small">Compare all three before you decide. <b>If the claim is not upheld after review:</b> that sale is not a clean sale, the seller drops a tier, it is recorded on their Seller Scorecard, and selling privileges are suspended for 7 days after a first incorrect claim, 30 days after a second, and removed after a third.</p><button class="btn" onclick="decideDispute('${rf.id}','wrong')">Buyer sent the wrong item — deny refund</button> <button class="btn ghost" onclick="decideDispute('${rf.id}','correct')">Item is correct — release refund</button><p class="small">Wrong item: refund denied — the buyer must send back the right item on a new tracked return label (seller pays, only because they asked for the item back) within 7 days, or no refund. Correct: claim not upheld, refund releases at once.</p>`:`<p class="small"><b>Seller — your choice:</b></p><button class="btn" onclick="refundChoose('${rf.id}','${escHtml(rf.seller||'')}','no_return')">Refund without return — buyer keeps the item</button> <button class="btn ghost" onclick="refundChoose('${rf.id}','${escHtml(rf.seller||'')}','want_back')">I want the item back first</button><p class="small">If you ask for the item back, a tracked return label is sent to the buyer and no refund goes out until you confirm you got it back. The return label is your cost — only because you asked for it back.</p>`}</div>`).join(''):''}${d.incorrectClaimStrikes&&d.incorrectClaimStrikes.length?`<h3>Incorrect return claims</h3><p class="small">Selling privileges are suspended for 7 days after a first incorrect claim, 30 days after a second, and removed after a third. While suspended, a seller's listings are hidden and they cannot list new items.</p>`+d.incorrectClaimStrikes.map(x=>`<p class="small"><b>${escHtml(x.seller)}</b> — ${x.strikes} incorrect claim${x.strikes===1?'':'s'} — ${x.banned?'selling privileges removed — cannot sell on the site again.':x.canSell?'suspension ended — selling is open again.':`selling privileges suspended until <b>${new Date(x.suspendedUntil).toLocaleString()}</b> (${x.suspensionDays} days).`}</p>`).join(''):''}${sd?`<div style="border:3px solid #c9a227;border-radius:14px;padding:12px;margin-top:10px"><h3 style="margin-top:0">💰 Safe to take out</h3>${sd.alert?`<p><b>${sd.alert}</b></p>`:`<p><b>Nothing safe to take out yet.</b></p>`}<p>Total fees earned: $${sd.totalFeesEarned} • Safe fees (over 30 days old, seller paid, no refund/dispute): $${sd.safeFees} • Safe to take out after tax set aside: <b>$${sd.safeToDraw.toFixed(2)}</b></p><p>Not safe yet: <b>$${sd.notSafeFees.toFixed(2)}</b>${sd.notSafe.length?` — ${sd.notSafe.map(n=>`${n.title} ($${n.fee.toFixed(2)}) — safe ${new Date(n.safeDate).toLocaleDateString()}`).join('; ')}`:''}</p><p>Recommended reserve to leave in the business: <b>$${sd.reserve.toFixed(2)}</b> — the larger of all not-yet-safe fees ($${sd.notSafeFees.toFixed(2)}) and 2 months of fees at the last 30 days' rate ($${sd.monthlyFees.toFixed(2)}/month).</p><p class="small">${sd.note} Seller escrow money is never counted here — only your fees.</p></div>`:''}${d.escrowHeld.length?`<h3>Payouts waiting</h3>`+d.escrowHeld.map(h=>`<p class="small"><b>${h.title}</b> — ${h.seller} • ${h.payout.tier} seller (${h.payout.cleanSales} clean sales) • $${h.amount} held • payout <b>${h.payout.payoutLabel} after delivery</b>${h.payout.payoutAt?` — <b>${new Date(h.payout.payoutAt).toLocaleString()}</b>`:''}</p>`).join('')+`<p class="small">Test mode: these are tracked payout dates, not real bank transfers.</p>`:''}`;loadLiveNotice();loadSoldQRs();}
async function loadSoldQRs(){
  const el=document.getElementById('soldQRs');if(!el)return;
  const rows=await j('/api/listings');
  const sold=rows.filter(l=>l.status==='sold'&&l.payment_status==='validated');
  if(!sold.length){el.innerHTML='<p class="small">No sold items yet — when someone buys or wins and pays, the QR code to ship it shows here.</p>';return;}
  el.innerHTML=sold.map(l=>`<div class="card"><h3>${l.title}${l.revealed_item?` — won: ${escHtml(l.revealed_item)}`:''}</h3><p>Winner: ${l.winner} • ${l.package_size?shipLabelOf(l.package_size):''} • <b>${shipViaText(l)}</b> • Tracking: ${l.tracking||'—'}</p><canvas id="dashQR-${l.id}" style="max-width:100%;background:#fff;border-radius:8px"></canvas><p class="small">Scan to open this exact sale, then tap Mark as shipped. Shipment record — not real ${carrierOf(l)} postage yet.</p><button class="btn ghost" onclick="openItem('${l.id}')">Open this sale</button></div>`).join('');
  for(const l of sold){const det=await j('/api/listings/'+l.id);if(det.qr_text)drawQR(det.qr_text,document.getElementById('dashQR-'+l.id));}
}
// ---------- "We're live" email to the waitlist (owner dashboard) ----------
function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
async function loadLiveNotice(){
  const d=await j('/api/waitlist/live-notice'); const el=document.getElementById('liveNotice'); if(!el)return;
  let h=`<p><b>${d.count} people</b> on the waitlist.</p>`;
  // Welcome emails: who got one when they joined, and who is still waiting.
  if(d.count){
    const ws=(d.welcomeSent||0), wp=(d.welcomePending||0), wf=(d.welcomeFailed||0);
    h+=`<p class="small">Welcome emails: <b>${ws} sent</b>${wp?` • <b>${wp} still to send</b>`:''}${wf?` • <b>${wf} failed to send</b>`:''}.</p>`;
    if(wp&&d.welcomePendingEmails)h+=`<p class="small">Still to welcome: ${d.welcomePendingEmails.map(x=>escHtml((x.name?x.name+' — ':'')+x.email)).join('; ')}</p>`;
    if(wf&&d.welcomeFailedEmails)h+=`<p class="small">Welcome failed for: ${d.welcomeFailedEmails.map(x=>escHtml((x.name?x.name+' — ':'')+x.email)).join('; ')}</p>`;
    if(wp&&!d.resendConfigured)h+=`<p class="small">No Resend key set yet, so welcome emails can't send automatically — set RESEND_API_KEY in Railway and new joiners will get one right away. The launch email still covers everyone on the list.</p>`;
  }
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
// A scanned QR code opens this exact sold item: ?i=<listing id>&r=<receipt>&t=<tracking>
(function(){const q=new URLSearchParams(location.search);const item=q.get('i');if(item)setTimeout(()=>openItem(item),600);})();
