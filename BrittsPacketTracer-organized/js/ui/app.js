import { DEVICE_TYPES, defaultDevice, computeLinkStates, simulatePing } from "../engine/network.js";
import { CLI } from "../cli/cli.js";

const $ = s => document.querySelector(s);
const state = { version:1, devices:[], links:[], counters:{}, selected:null, tool:"select", connectSource:null };
const workspace=$("#workspace"), linkLayer=$("#linkLayer"), palette=$("#devicePalette"), inspector=$("#inspectorContent");
let activeCli=null, drag=null;

for (const [type,def] of Object.entries(DEVICE_TYPES)) {
  const el=document.createElement("div");
  el.className="palette-item"; el.draggable=true; el.dataset.type=type;
  el.innerHTML=`<div class="palette-icon">${def.icon}</div><div class="palette-label">${def.label}</div>`;
  el.addEventListener("dragstart",e=>e.dataTransfer.setData("device-type",type));
  palette.appendChild(el);
}
workspace.addEventListener("dragover",e=>e.preventDefault());
workspace.addEventListener("drop",e=>{
  e.preventDefault();
  const type=e.dataTransfer.getData("device-type"); if(!DEVICE_TYPES[type]) return;
  const rect=workspace.getBoundingClientRect();
  addDevice(type,e.clientX-rect.left+workspace.parentElement.scrollLeft,e.clientY-rect.top+workspace.parentElement.scrollTop);
});

function uid(prefix){ return `${prefix}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`; }
function addDevice(type,x,y){
  state.counters[type]=(state.counters[type]||0)+1;
  state.devices.push(defaultDevice(type,uid("dev"),Math.max(0,x-52),Math.max(0,y-40),state.counters[type]));
  render(); persist();
}
function render(){
  computeLinkStates(state);
  [...workspace.querySelectorAll(".device")].forEach(e=>e.remove());
  linkLayer.innerHTML="";
  $("#emptyHint").style.display=state.devices.length?"none":"block";
  for(const link of state.links) drawLink(link);
  for(const device of state.devices) drawDevice(device);
  renderInspector();
}
function drawDevice(device){
  const def=DEVICE_TYPES[device.type], el=document.createElement("div");
  el.className="device"+(state.selected?.kind==="device"&&state.selected.id===device.id?" selected":"")+(state.connectSource===device.id?" connect-source":"");
  el.style.left=device.x+"px"; el.style.top=device.y+"px"; el.dataset.id=device.id;
  el.innerHTML=`<span class="device-led"></span><div class="device-icon">${def.icon}</div><div class="device-name">${escapeHtml(device.name)}</div><div class="device-meta">${def.label}</div>`;
  el.addEventListener("pointerdown",e=>startDrag(e,device,el));
  el.addEventListener("click",e=>{e.stopPropagation(); handleDeviceClick(device);});
  el.addEventListener("dblclick",e=>{e.stopPropagation(); openCli(device);});
  workspace.appendChild(el);
}
function drawLink(link){
  const a=state.devices.find(d=>d.id===link.a.deviceId), b=state.devices.find(d=>d.id===link.b.deviceId);
  if(!a||!b) return;
  const line=document.createElementNS("http://www.w3.org/2000/svg","line");
  line.setAttribute("x1",a.x+52); line.setAttribute("y1",a.y+39); line.setAttribute("x2",b.x+52); line.setAttribute("y2",b.y+39);
  line.setAttribute("class",`link-line ${link.up?"up":"down"}`);
  line.style.pointerEvents="stroke";
  line.addEventListener("click",e=>{e.stopPropagation(); state.selected={kind:"link",id:link.id}; renderInspector();});
  linkLayer.appendChild(line);
}
function startDrag(e,device,el){
  if(state.tool!=="select") return;
  const rect=el.getBoundingClientRect();
  drag={device,dx:e.clientX-rect.left,dy:e.clientY-rect.top};
  el.setPointerCapture(e.pointerId);
  el.addEventListener("pointermove",moveDrag);
  el.addEventListener("pointerup",endDrag,{once:true});
}
function moveDrag(e){
  if(!drag) return;
  const rect=workspace.getBoundingClientRect();
  drag.device.x=Math.max(0,e.clientX-rect.left+workspace.parentElement.scrollLeft-drag.dx);
  drag.device.y=Math.max(0,e.clientY-rect.top+workspace.parentElement.scrollTop-drag.dy);
  render();
}
function endDrag(e){
  e.currentTarget.removeEventListener("pointermove",moveDrag);
  drag=null; persist();
}
function handleDeviceClick(device){
  if(state.tool==="delete"){ removeDevice(device.id); return; }
  if(state.tool==="connect"){
    if(!state.connectSource){ state.connectSource=device.id; status(`Selected ${device.name}. Choose a second device.`); render(); return; }
    if(state.connectSource===device.id){state.connectSource=null;render();return;}
    connectDevices(state.connectSource,device.id); state.connectSource=null; render(); persist(); return;
  }
  state.selected={kind:"device",id:device.id}; render();
}
function availablePort(device){
  return Object.values(device.config.interfaces).find(i=>!i.connectedLinkId);
}
function connectDevices(aId,bId){
  const a=state.devices.find(d=>d.id===aId), b=state.devices.find(d=>d.id===bId);
  const ap=availablePort(a), bp=availablePort(b);
  if(!ap||!bp){status("No available ports on one of the selected devices.");return;}
  const id=uid("link"), link={id,type:"copper-straight-through",a:{deviceId:a.id,port:ap.name},b:{deviceId:b.id,port:bp.name},up:false};
  ap.connectedLinkId=id; bp.connectedLinkId=id; state.links.push(link);
  status(`Connected ${a.name} ${ap.name} to ${b.name} ${bp.name}.`);
}
function removeDevice(id){
  const linkIds=state.links.filter(l=>l.a.deviceId===id||l.b.deviceId===id).map(l=>l.id);
  for(const lid of linkIds) removeLink(lid);
  state.devices=state.devices.filter(d=>d.id!==id); state.selected=null; render(); persist();
}
function removeLink(id){
  for(const d of state.devices) for(const i of Object.values(d.config.interfaces)) if(i.connectedLinkId===id)i.connectedLinkId=null;
  state.links=state.links.filter(l=>l.id!==id); state.selected=null; render(); persist();
}
workspace.addEventListener("click",()=>{state.selected=null;render();});

function renderInspector(){
  if(!state.selected){inspector.innerHTML="<p>Select a device or cable.</p>";return;}
  if(state.selected.kind==="link"){
    const l=state.links.find(x=>x.id===state.selected.id); if(!l) return;
    const a=state.devices.find(d=>d.id===l.a.deviceId), b=state.devices.find(d=>d.id===l.b.deviceId);
    inspector.innerHTML=`<p><span class="badge">${l.up?"Up":"Down"}</span></p><p>${a.name}<br>${l.a.port}</p><p>↕</p><p>${b.name}<br>${l.b.port}</p><button id="deleteSelectedLink" class="danger">Delete cable</button>`;
    $("#deleteSelectedLink").onclick=()=>removeLink(l.id); return;
  }
  const d=state.devices.find(x=>x.id===state.selected.id); if(!d)return;
  const rows=Object.values(d.config.interfaces).map(i=>`<tr><td>${i.name}</td><td>${i.ip||"unassigned"}</td><td>${i.shutdown?"down":"up"}</td></tr>`).join("");
  inspector.innerHTML=`<label>Name<input id="deviceName" value="${escapeHtml(d.name)}"></label>
  <label>Power<select id="devicePower"><option value="on"${d.enabled?" selected":""}>On</option><option value="off"${!d.enabled?" selected":""}>Off</option></select></label>
  <button id="openCliBtn">Open CLI</button>
  <h2 style="margin-top:1rem">Interfaces</h2><table class="interface-table"><tr><th>Port</th><th>IP</th><th>State</th></tr>${rows}</table>`;
  $("#deviceName").onchange=e=>{d.name=e.target.value;d.config.hostname=e.target.value;render();persist();};
  $("#devicePower").onchange=e=>{d.enabled=e.target.value==="on";render();persist();};
  $("#openCliBtn").onclick=()=>openCli(d);
}
function openCli(device){
  activeCli=new CLI(state,device,()=>{render();persist();updateCliPrompt();});
  $("#cliTitle").textContent=`${device.name} CLI`;
  $("#cliOutput").textContent=`BrittsPacketTracer IOS Simulation\nType ? for help.\n\n`;
  updateCliPrompt(); $("#cliDialog").showModal(); $("#cliInput").focus();
}
function updateCliPrompt(){
  if(!activeCli)return;
  $("#cliPrompt").textContent=activeCli.prompt();
  $("#cliModeLabel").textContent=activeCli.mode;
}
$("#cliInput").addEventListener("keydown",e=>{
  if(!activeCli)return;
  if(e.key==="Enter"){
    const cmd=e.target.value, output=activeCli.execute(cmd);
    $("#cliOutput").textContent+=`${activeCli.prompt()}${cmd}\n${output?output+"\n":""}`;
    e.target.value=""; updateCliPrompt(); $("#cliOutput").scrollTop=$("#cliOutput").scrollHeight;
  } else if(e.key==="ArrowUp"){
    e.preventDefault(); activeCli.historyIndex=Math.max(0,activeCli.historyIndex-1); e.target.value=activeCli.history[activeCli.historyIndex]||"";
  } else if(e.key==="ArrowDown"){
    e.preventDefault(); activeCli.historyIndex=Math.min(activeCli.history.length,activeCli.historyIndex+1); e.target.value=activeCli.history[activeCli.historyIndex]||"";
  }
});

function setTool(tool){
  state.tool=tool; state.connectSource=null;
  ["select","connect","delete"].forEach(t=>$(`#${t}Tool`)?.classList.toggle("active",t===tool));
  status(`Tool: ${tool}`);
  render();
}
$("#selectTool").onclick=()=>setTool("select");
$("#connectTool").onclick=()=>setTool("connect");
$("#deleteTool").onclick=()=>setTool("delete");
$("#recomputeBtn").onclick=()=>{render();status("Link and reachability state recomputed.");};
$("#clearBtn").onclick=()=>{if(confirm("Delete the entire topology?")){state.devices=[];state.links=[];state.counters={};render();persist();}};
$("#saveBtn").onclick=()=>{persist();status("Saved to this browser.");};
$("#loadBtn").onclick=()=>{restore();render();status("Loaded saved topology.");};
$("#exportBtn").onclick=()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="britts-packet-tracer-lab.json";a.click();URL.revokeObjectURL(a.href);
};
$("#importInput").onchange=async e=>{
  const file=e.target.files[0]; if(!file)return;
  try{const imported=JSON.parse(await file.text());Object.assign(state,imported);render();persist();status("Imported topology.");}
  catch{alert("That file is not a valid BrittsPacketTracer lab.");}
};
$("#pingTool").onclick=()=>{
  const sel=$("#pingSource");sel.innerHTML=state.devices.map(d=>`<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("");
  $("#pingResult").textContent="";$("#pingDialog").showModal();
};
$("#runPingBtn").onclick=()=>{$("#pingResult").textContent=simulatePing(state,$("#pingSource").value,$("#pingDestination").value.trim()).output;};

function persist(){ localStorage.setItem("brittsPacketTracerState",JSON.stringify(state)); }
function restore(){
  const raw=localStorage.getItem("brittsPacketTracerState"); if(!raw)return;
  try{const saved=JSON.parse(raw);Object.assign(state,saved);}catch{}
}
function status(msg){$("#statusPanel").textContent=msg;}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
restore(); render();
