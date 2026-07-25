export const DEVICE_TYPES = {
  router: { label: "Router", icon: "▣", ports: ["GigabitEthernet0/0","GigabitEthernet0/1","Serial0/0/0"] },
  switch: { label: "Switch", icon: "▤", ports: Array.from({length: 8}, (_,i) => `FastEthernet0/${i+1}`).concat(["GigabitEthernet0/1","GigabitEthernet0/2"]) },
  pc: { label: "PC", icon: "▥", ports: ["FastEthernet0"] },
  server: { label: "Server", icon: "▦", ports: ["GigabitEthernet0"] },
  firewall: { label: "Firewall", icon: "⬢", ports: ["GigabitEthernet0/0","GigabitEthernet0/1","Management0/0"] },
  cloud: { label: "Cloud", icon: "☁", ports: ["Ethernet0","Ethernet1","Serial0"] }
};

export function defaultDevice(type, id, x, y, count) {
  const def = DEVICE_TYPES[type];
  const prefix = {router:"Router",switch:"Switch",pc:"PC",server:"Server",firewall:"Firewall",cloud:"Cloud"}[type];
  return {
    id, type, name: `${prefix}${count}`, x, y,
    enabled: true,
    config: {
      hostname: `${prefix}${count}`,
      interfaces: Object.fromEntries(def.ports.map(p => [p, {
        name: p, ip: "", mask: "", shutdown: type === "router" || type === "firewall",
        vlan: 1, mode: "access", description: "", connectedLinkId: null
      }])),
      vlans: {1: {id:1, name:"default"}},
      routes: [],
      ospf: { processId: null, routerId: "", networks: [] },
      dhcpPools: [],
      dns: [],
      enableSecret: "",
      banner: ""
    }
  };
}

export function ipToInt(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((p[0]<<24)>>>0) + (p[1]<<16) + (p[2]<<8) + p[3]) >>> 0;
}
export function sameSubnet(ip1, ip2, mask) {
  const a=ipToInt(ip1), b=ipToInt(ip2), m=ipToInt(mask);
  return a !== null && b !== null && m !== null && ((a&m)>>>0) === ((b&m)>>>0);
}
export function interfaceUp(device, intf) {
  return device.enabled && intf && !intf.shutdown;
}
export function findDeviceByIp(state, ip) {
  for (const d of state.devices) {
    for (const intf of Object.values(d.config.interfaces)) {
      if (intf.ip === ip) return {device:d, intf};
    }
  }
  return null;
}
export function neighbors(state, deviceId) {
  const out = [];
  for (const link of state.links) {
    if (link.a.deviceId === deviceId || link.b.deviceId === deviceId) {
      const local = link.a.deviceId === deviceId ? link.a : link.b;
      const remote = link.a.deviceId === deviceId ? link.b : link.a;
      const rd = state.devices.find(d => d.id === remote.deviceId);
      if (rd) out.push({link, local, remote, device:rd});
    }
  }
  return out;
}
function linkOperational(state, link) {
  const aDev = state.devices.find(d=>d.id===link.a.deviceId);
  const bDev = state.devices.find(d=>d.id===link.b.deviceId);
  if (!aDev || !bDev) return false;
  return interfaceUp(aDev,aDev.config.interfaces[link.a.port]) &&
         interfaceUp(bDev,bDev.config.interfaces[link.b.port]);
}
export function computeLinkStates(state) {
  state.links.forEach(l => l.up = linkOperational(state,l));
}
function connectedReachable(state, sourceDevice, destIp) {
  const target = findDeviceByIp(state,destIp);
  if (!target) return {ok:false, reason:"Destination host not found."};
  const visited = new Set();
  const queue = [sourceDevice.id];
  while (queue.length) {
    const id = queue.shift();
    if (id === target.device.id) return {ok:true, reason:"Connected path found."};
    if (visited.has(id)) continue;
    visited.add(id);
    const dev = state.devices.find(d=>d.id===id);
    for (const n of neighbors(state,id)) {
      if (!n.link.up || visited.has(n.device.id)) continue;
      const localInt = dev.config.interfaces[n.local.port];
      const remoteInt = n.device.config.interfaces[n.remote.port];
      if (dev.type === "switch" || n.device.type === "switch") {
        if (localInt.vlan === remoteInt.vlan || localInt.mode === "trunk" || remoteInt.mode === "trunk") queue.push(n.device.id);
      } else if (localInt.ip && remoteInt.ip && sameSubnet(localInt.ip,remoteInt.ip,localInt.mask || remoteInt.mask)) {
        queue.push(n.device.id);
      } else if (dev.type === "router" || n.device.type === "router" || dev.type === "firewall" || n.device.type === "firewall") {
        queue.push(n.device.id);
      }
    }
  }
  return {ok:false, reason:"No operational path to destination."};
}
export function simulatePing(state, sourceId, destIp) {
  computeLinkStates(state);
  const source = state.devices.find(d=>d.id===sourceId);
  if (!source) return {ok:false, output:"Invalid source device."};
  const result = connectedReachable(state,source,destIp);
  if (!result.ok) return {ok:false, output:`PING ${destIp}\nRequest timed out.\n${result.reason}`};
  return {ok:true, output:`PING ${destIp}\nReply from ${destIp}: bytes=32 time<1ms TTL=64\nReply from ${destIp}: bytes=32 time<1ms TTL=64\nReply from ${destIp}: bytes=32 time<1ms TTL=64\nReply from ${destIp}: bytes=32 time<1ms TTL=64\n\nPackets: Sent = 4, Received = 4, Lost = 0 (0% loss)`};
}
