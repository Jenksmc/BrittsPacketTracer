import { attachDeviceDefinitions, hydrateDeviceInterfaces, ROUTED_DEVICE_DEFAULT_UP_INTERFACE_TYPES, physicalInterface, validateLink } from "./connections.js";
import { BROADCAST_MAC, createFrame, ensureDeviceLayer2State, ensureLayer2State, transmitFrame } from "./switching.js";
import { normalizeMacAddress, stableInterfaceMac } from "../protocols/ethernet.js";

export const DEVICE_CATEGORIES = {
  routers: "Routers",
  switches: "Switches",
  hubs: "Hubs",
  wireless: "Wireless",
  security: "Security",
  wan: "WAN Emulation",
  endDevices: "End Devices",
  industrial: "Industrial & IoT",
  connections: "Connections"
};

const ports = (prefix, count, start = 0) => Array.from({ length: count }, (_, i) => `${prefix}${i + start}`);

export const DEVICE_TYPES = {
  router1941: { category:"routers", label:"1941 Router", short:"1941", kind:"router", icon:"router", ports:["GigabitEthernet0/0","GigabitEthernet0/1","Serial0/0/0","Serial0/0/1","Console","AUX"] },
  router2911: { category:"routers", label:"2911 Router", short:"2911", kind:"router", icon:"router", ports:["GigabitEthernet0/0","GigabitEthernet0/1","GigabitEthernet0/2","Serial0/0/0","Serial0/0/1","Console","AUX"] },
  router4321: { category:"routers", label:"ISR 4321", short:"4321", kind:"router", icon:"router", ports:["GigabitEthernet0/0/0","GigabitEthernet0/0/1","Serial0/1/0","Console","AUX","USB0"] },
  routerGeneric: { category:"routers", label:"Router-PT", short:"Router", kind:"router", icon:"router", ports:["FastEthernet0/0","FastEthernet0/1","Serial0/0/0","Serial0/0/1","Console","AUX"] },
  switch2960: { category:"switches", label:"2960 Switch", short:"2960", kind:"switch", icon:"switch", ports:ports("FastEthernet0/",24,1).concat(ports("GigabitEthernet0/",2,1),["Console"]) },
  switch3560: { category:"switches", label:"3560 Multilayer", short:"3560", kind:"multilayer-switch", icon:"switch", ports:ports("FastEthernet0/",24,1).concat(ports("GigabitEthernet0/",2,1),["Console"]) },
  switch3650: { category:"switches", label:"3650 Multilayer", short:"3650", kind:"multilayer-switch", icon:"switch", ports:ports("GigabitEthernet1/0/",24,1).concat(["GigabitEthernet1/1/1","GigabitEthernet1/1/2","Console","USB0"]) },
  bridge: { category:"switches", label:"Bridge-PT", short:"Bridge", kind:"bridge", icon:"bridge", ports:["Port0","Port1"] },
  hub: { category:"hubs", label:"Hub-PT", short:"Hub", kind:"hub", icon:"hub", ports:ports("Port",8,1) },
  repeater: { category:"hubs", label:"Repeater-PT", short:"Repeater", kind:"repeater", icon:"repeater", ports:["Port0","Port1"] },
  accessPoint: { category:"wireless", label:"Access Point-PT", short:"AP", kind:"access-point", icon:"ap", ports:["FastEthernet0","Wireless0","Console"] },
  wirelessRouter: { category:"wireless", label:"Wireless Router", short:"WRT300N", kind:"wireless-router", icon:"wireless-router", ports:["Internet","Ethernet1","Ethernet2","Ethernet3","Ethernet4","Wireless0"] },
  homeGateway: { category:"wireless", label:"Home Gateway", short:"HomeGateway", kind:"wireless-router", icon:"wireless-router", ports:["Internet","Ethernet1","Ethernet2","Ethernet3","Ethernet4","Wireless0"] },
  cellTower: { category:"wireless", label:"Cell Tower", short:"CellTower", kind:"cell-tower", icon:"tower", ports:["Coaxial0","Wireless0"] },
  asa5505: { category:"security", label:"ASA 5505", short:"ASA", kind:"firewall", icon:"firewall", ports:ports("Ethernet0/",8,0).concat(["Management0/0","Console"]) },
  firewall: { category:"security", label:"Firewall-PT", short:"Firewall", kind:"firewall", icon:"firewall", ports:["GigabitEthernet0/0","GigabitEthernet0/1","GigabitEthernet0/2","Console"] },
  cloud: { category:"wan", label:"Cloud-PT", short:"Cloud", kind:"cloud", icon:"cloud", ports:["Ethernet0","Ethernet1","Serial0","Serial1","Coaxial0","DSL0"] },
  cableModem: { category:"wan", label:"Cable Modem", short:"CableModem", kind:"modem", icon:"modem", ports:["Coaxial0","Ethernet0"] },
  dslModem: { category:"wan", label:"DSL Modem", short:"DSLModem", kind:"modem", icon:"modem", ports:["Phone0","Ethernet0"] },
  pc: { category:"endDevices", label:"PC-PT", short:"PC", kind:"pc", icon:"pc", ports:["FastEthernet0","RS232","USB0"] },
  laptop: { category:"endDevices", label:"Laptop-PT", short:"Laptop", kind:"laptop", icon:"laptop", ports:["FastEthernet0","Wireless0","RS232","USB0"] },
  server: { category:"endDevices", label:"Server-PT", short:"Server", kind:"server", icon:"server", ports:["FastEthernet0","GigabitEthernet0","RS232"] },
  printer: { category:"endDevices", label:"Printer-PT", short:"Printer", kind:"printer", icon:"printer", ports:["FastEthernet0","Wireless0"] },
  ipPhone: { category:"endDevices", label:"IP Phone", short:"Phone", kind:"ip-phone", icon:"phone", ports:["Switch","PC"] },
  tablet: { category:"endDevices", label:"Tablet PC", short:"Tablet", kind:"tablet", icon:"tablet", ports:["Wireless0"] },
  smartphone: { category:"endDevices", label:"Smartphone", short:"Phone", kind:"smartphone", icon:"smartphone", ports:["Wireless0","Cellular0"] },
  tv: { category:"endDevices", label:"TV", short:"TV", kind:"iot", icon:"tv", ports:["FastEthernet0","Wireless0"] },
  genericIoT: { category:"industrial", label:"Generic IoT Thing", short:"Thing", kind:"iot", icon:"iot", ports:["FastEthernet0","Wireless0","Digital0"] },
  mcu: { category:"industrial", label:"MCU-PT", short:"MCU", kind:"mcu", icon:"chip", ports:["FastEthernet0","Wireless0","Digital0","Digital1","Analog0"] },
  plc: { category:"industrial", label:"PLC-PT", short:"PLC", kind:"plc", icon:"plc", ports:["FastEthernet0","Digital0","Digital1","Analog0"] },
  sensor: { category:"industrial", label:"Sensor", short:"Sensor", kind:"sensor", icon:"sensor", ports:["Wireless0","Digital0"] },
  actuator: { category:"industrial", label:"Actuator", short:"Actuator", kind:"actuator", icon:"actuator", ports:["Wireless0","Digital0"] }
};

const cliKinds = new Set(["router","switch","multilayer-switch","firewall","pc","laptop","server"]);
const desktopKinds = new Set(["pc","laptop","server","tablet","smartphone"]);

export function defaultDevice(type, id, x, y, count) {
  const def = DEVICE_TYPES[type];
  const prefix = def.short.replace(/\s+/g, "");
  const hostname = `${prefix}${count}`;
  const routed = ["router","firewall","multilayer-switch"].includes(def.kind);
  const device = {
    id, type, kind: def.kind, name: hostname, x, y, enabled: true,
    model: def.label,
    capabilities: { cli: cliKinds.has(def.kind), desktop: desktopKinds.has(def.kind), physical:true, config:true },
    config: {
      hostname,
      displayName: hostname,
      interfaces: Object.fromEntries(def.ports.map(p => {
        const intf = physicalInterface(p, def);
        intf.shutdown = routed && !ROUTED_DEVICE_DEFAULT_UP_INTERFACE_TYPES.has(intf.interfaceType);
        intf.mac = stableInterfaceMac({ id }, p);
        return [p, intf];
      })),
      vlans:{1:{id:1,name:"default"}}, routes:[], ipv6Routes:[],
      ospf:{processId:null,routerId:"",networks:[],neighbors:[]}, rip:{version:2,networks:[]},
      eigrp:{asn:null,networks:[]}, bgp:{asn:null,neighbors:[],networks:[]},
      stp:{mode:"pvst",priority:32768}, etherChannels:[],
      dhcpPools:[], dns:[], nat:[], acls:[], arpTable:[], macTable:[], macAgingTimeMs:300000, l2Counters:{},
      ipSettings:{ip:"",mask:"",gateway:"",dns:"",dhcp:false,ipv6:"",ipv6Gateway:"",slaac:false},
      wireless:{ssid:"PacketTracer",security:"none",password:"",channel:"auto"},
      services:{http:false,https:false,dns:false,dhcp:false,ftp:false,email:false},
      physical:{modules:[],power:true}, enableSecret:"", banner:""
    }
  };
  ensureDeviceLayer2State(device);
  return device;
}

export function randomMac(){ return Array.from({length:6},(_,i)=>((i===0?0x02:Math.floor(Math.random()*256))).toString(16).padStart(2,"0")).join(":").toUpperCase(); }
export function ipToInt(ip){ const p=String(ip).split(".").map(Number); if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255))return null; return (((p[0]<<24)>>>0)+(p[1]<<16)+(p[2]<<8)+p[3])>>>0; }
export function sameSubnet(ip1,ip2,mask){ const a=ipToInt(ip1),b=ipToInt(ip2),m=ipToInt(mask); return a!==null&&b!==null&&m!==null&&((a&m)>>>0)===((b&m)>>>0); }
export function interfaceUp(device,intf){ return device.enabled&&device.config.physical.power&&intf&&!intf.shutdown; }
export function findDeviceByIp(state,ip){ for(const d of state.devices){ if(d.config.ipSettings&&d.config.ipSettings.ip===ip)return {device:d,intf:null}; for(const intf of Object.values(d.config.interfaces))if(intf.ip===ip)return {device:d,intf}; } return null; }
export function neighbors(state,deviceId){ const out=[]; for(const link of state.links){ if(link.a.deviceId===deviceId||link.b.deviceId===deviceId){ const local=link.a.deviceId===deviceId?link.a:link.b,remote=link.a.deviceId===deviceId?link.b:link.a,rd=state.devices.find(d=>d.id===remote.deviceId); if(rd)out.push({link,local,remote,device:rd}); }} return out; }
function linkOperational(state,link){ const result=validateLink(state,link); link.status=result.reason; return result.ok; }
export function computeLinkStates(state){
  attachDeviceDefinitions(state.devices,DEVICE_TYPES);
  ensureLayer2State(state);
  state.devices.forEach(d=>Object.values(d.config.interfaces||{}).forEach(i=>{i.linkState="down";i.administrativeState=i.shutdown?"down":"up"}));
  state.links.forEach(l=>{
    l.up=linkOperational(state,l);
    for(const side of ["a","b"]){
      const endpoint=l[side],device=state.devices.find(d=>d.id===endpoint?.deviceId),intf=device?.config.interfaces?.[endpoint?.port];
      if(intf)intf.linkState=l.up?"up":"down";
    }
  });
  state.devices.forEach(d=>{hydrateDeviceInterfaces(d,DEVICE_TYPES[d.type]);ensureDeviceLayer2State(d)});
}
export function simulatePing(state,sourceId,destIp){ computeLinkStates(state); const source=state.devices.find(d=>d.id===sourceId),target=findDeviceByIp(state,destIp); if(!source)return {ok:false,output:"Invalid source device."}; if(!target)return {ok:false,output:`Pinging ${destIp} with 32 bytes of data:\nRequest timed out.\n\nPing statistics for ${destIp}:\n    Packets: Sent = 4, Received = 0, Lost = 4 (100% loss)`}; const visited=new Set(),queue=[source.id],parent=new Map(),parentPort=new Map(); while(queue.length){ const id=queue.shift(); if(id===target.device.id){ const path=[]; let cur=id; while(cur){path.unshift(cur);cur=parent.get(cur);} const l2=simulatePingFrame(state,source,target.device,destIp); if(!l2.ok){ return {ok:false,path,l2,output:`Pinging ${destIp} with 32 bytes of data:\nRequest timed out.\nDestination host unreachable.`}; } learnAlongPath(state,path,target.device); return {ok:true,path,l2,output:`Pinging ${destIp} with 32 bytes of data:\nReply from ${destIp}: bytes=32 time<1ms TTL=128\nReply from ${destIp}: bytes=32 time<1ms TTL=128\nReply from ${destIp}: bytes=32 time<1ms TTL=128\nReply from ${destIp}: bytes=32 time<1ms TTL=128\n\nPing statistics for ${destIp}:\n    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)`}; } if(visited.has(id))continue; visited.add(id); const dev=state.devices.find(d=>d.id===id); for(const n of neighbors(state,id)){ if(!n.link.up||visited.has(n.device.id))continue; const li=dev.config.interfaces[n.local.port],ri=n.device.config.interfaces[n.remote.port]; const vlanOK=li.mode==="trunk"||ri.mode==="trunk"||li.vlan===ri.vlan; if(vlanOK){parent.set(n.device.id,id);parentPort.set(n.device.id,n.remote.port);queue.push(n.device.id);} }} return {ok:false,output:`Pinging ${destIp} with 32 bytes of data:\nRequest timed out.\nDestination host unreachable.`}; }
function simulatePingFrame(state,source,target,destIp){
  const sourceIntf=firstEthernetInterface(source),targetIntf=firstEthernetInterface(target);
  if(!sourceIntf||!targetIntf)return {ok:false,reason:"No Ethernet-capable interface"};
  const frame=createFrame({sourceMac:sourceIntf.mac,destinationMac:targetIntf.mac||BROADCAST_MAC,etherType:"0x0800",payload:{type:"icmp-echo",destinationIp:destIp},vlanId:sourceIntf.vlan||1,ingressDeviceId:source.id,ingressInterfaceId:sourceIntf.name});
  const result=transmitFrame(state,source.id,sourceIntf.name,frame);
  return {...result,ok:result.deliveries?.some(d=>d.device.id===target.id)||false};
}
function firstEthernetInterface(d){ return Object.values(d.config.interfaces||{}).find(i=>["ethernet","fiberEthernet","wireless"].includes(i.interfaceType)&&normalizeMacAddress(i.mac)); }
function learnAlongPath(state,path,target){
  for(let i=0;i<path.length;i++){
    const d=state.devices.find(x=>x.id===path[i]);
    if(!d)continue;
    if(["switch","multilayer-switch","bridge"].includes(DEVICE_TYPES[d.type].kind)){
      const next=path[i+1]||target.id;
      const n=neighbors(state,d.id).find(x=>x.device.id===next);
      const targetMac=firstMac(target);
      if(n&&!d.config.macTable.some(e=>e.mac===targetMac))d.config.macTable.push({vlan:(d.config.interfaces[n.local.port]&&d.config.interfaces[n.local.port].vlan)||1,mac:targetMac,port:n.local.port,type:"DYNAMIC"});
    }
    const targetIntf=Object.values(target.config.interfaces).find(x=>x.ip);
    const ip=(target.config.ipSettings&&target.config.ipSettings.ip)||(targetIntf&&targetIntf.ip);
    if(ip&&!d.config.arpTable.some(e=>e.ip===ip))d.config.arpTable.push({ip,mac:firstMac(target),type:"dynamic"});
  }
}
function firstMac(d){ const intf=Object.values(d.config.interfaces)[0]; return intf&&intf.mac?intf.mac:randomMac(); }
