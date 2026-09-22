const API_BASE = ""; // VideoDown online: frontend + API berjalan pada domain yang sama.
const $ = s => document.querySelector(s);
const urlInput = $("#urlInput"), mirror = $("#urlMirror"), preview = $("#preview");
const qualities = $("#qualities"), downloadBtn = $("#downloadBtn"), status = $("#status");
let currentUrl = "", selectedQuality = "best", currentInfo = null;

function setStatus(msg, bad=false){status.textContent=msg;status.style.color=bad?"#ff6b9b":"#79e5ff"}

function sync(v){urlInput.value=v;mirror.value=v}

$("#urlForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const url=urlInput.value.trim(); if(!url) return;
  currentUrl=url; sync(url); setStatus("Memeriksa video...");
  $("#checkBtn").disabled=true; downloadBtn.disabled=true;
  try{
    const r=await fetch(`${API_BASE}/api/info?url=${encodeURIComponent(url)}`);
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"Gagal");
    currentInfo=data; renderInfo(data); setStatus("Video siap. Pilih kualitas.");
  }catch(err){setStatus(err.message,true); currentInfo=null}
  finally{$("#checkBtn").disabled=false}
});

function renderInfo(data){
  preview.innerHTML=data.thumbnail
    ? `<img src="${escapeHtml(data.thumbnail)}" alt="thumbnail">`
    : `<div class="placeholder"><div class="play">▶</div></div>`;
  $("#meta").innerHTML=`<b>${escapeHtml(data.title)}</b>${data.uploader?` · ${escapeHtml(data.uploader)}`:""}`;
  const fs=data.formats||[];
  qualities.innerHTML="";
  const best=document.createElement("div");
  best.className="quality selected"; best.dataset.q="best";
  best.innerHTML="<span><b>Otomatis</b><br><small>Kualitas terbaik yang tersedia</small></span><b>BEST</b>";
  qualities.appendChild(best);
  for(const f of fs){
    const el=document.createElement("div"); el.className="quality"; el.dataset.q=f.height;
    const size=f.filesize?` · ${formatBytes(f.filesize)}`:"";
    el.innerHTML=`<span><b>${f.height}p</b><br><small>${f.ext.toUpperCase()}${f.has_audio?" + audio":""}</small></span><b>${size}</b>`;
    qualities.appendChild(el);
  }
  selectedQuality="best"; downloadBtn.disabled=false;
}

qualities.addEventListener("click",e=>{
  const q=e.target.closest(".quality"); if(!q)return;
  document.querySelectorAll(".quality").forEach(x=>x.classList.remove("selected"));
  q.classList.add("selected"); selectedQuality=q.dataset.q;
});

downloadBtn.addEventListener("click",()=>{
  if(!currentUrl)return;
  const key=selectedQuality||"best";
  setStatus("Menyiapkan download...");
  const a=document.createElement("a");
  a.href=`${API_BASE}/api/download?url=${encodeURIComponent(currentUrl)}&quality=${encodeURIComponent(key)}`;
  a.download="";
  document.body.appendChild(a); a.click(); a.remove();
  saveHistory(currentInfo?.title||"Video", currentUrl, key);
  setTimeout(()=>setStatus("Download dimulai. File akan tersimpan melalui browser kamu."),700);
});

mirror.addEventListener("change",()=>sync(mirror.value));
$("#clearBtn").addEventListener("click",()=>{sync("");currentInfo=null;downloadBtn.disabled=true;qualities.innerHTML='<div class="empty-quality">Belum ada data video.</div>';preview.innerHTML='<div class="placeholder"><div class="play">▶</div><p>Tempel URL untuk melihat preview</p></div>';$("#meta").textContent="";setStatus("")});
document.querySelectorAll("[data-example]").forEach(b=>b.addEventListener("click",()=>{const v=b.dataset.example;if(v){sync(v);urlInput.focus()}}));

function saveHistory(title,url,q){
  const h=JSON.parse(localStorage.getItem("videodown-history")||"[]");
  h.unshift({title,url,q,time:new Date().toLocaleString("id-ID")});
  localStorage.setItem("videodown-history",JSON.stringify(h.slice(0,12))); renderHistory();
}
function renderHistory(){
  const h=JSON.parse(localStorage.getItem("videodown-history")||"[]"), box=$("#historyList");
  if(!h.length){box.innerHTML='<div class="history-empty">Belum ada download.</div>';return}
  box.innerHTML=h.map(x=>`<div class="history-item"><b>${escapeHtml(x.title)}</b><span>${x.q === "best" ? "BEST" : escapeHtml(x.q) + "p"} · ${escapeHtml(x.time)}</span></div>`).join("");
}
$("#clearHistory").addEventListener("click",()=>{localStorage.removeItem("videodown-history");renderHistory()});
$("#themeBtn").addEventListener("click",()=>document.body.classList.toggle("light"));
function formatBytes(n){if(!n)return"";const u=["B","KB","MB","GB"];let i=0,x=n;while(x>=1024&&i<u.length-1){x/=1024;i++}return `${x.toFixed(x>=10?0:1)} ${u[i]}`}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
renderHistory();