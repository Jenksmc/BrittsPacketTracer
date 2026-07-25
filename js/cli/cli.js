import { simulatePing, neighbors } from "../engine/network.js";
import { resolveInterface } from "../engine/connections.js";
import { addStaticMacEntry, clearDynamicMacEntries, effectiveSwitchportMode, formatMacForCisco, isStaticMacEntry, parseVlanList, removeMacEntry, SWITCHING_DEVICE_KINDS, updateAllowedVlans } from "../engine/switching.js";
import { normalizeMacAddress } from "../protocols/ethernet.js";

export class CLI {
  constructor(state, device, onChange) {
    this.state = state;
    this.device = device;
    this.onChange = onChange;
    this.mode = "user";
    this.currentInterface = null;
    this.currentVlan = null;
    this.history = [];
    this.historyIndex = 0;
  }
  switchingSupported() { return SWITCHING_DEVICE_KINDS.has(this.device.kind); }
  showMacAddressTable(arg) {
    if (!this.switchingSupported()) return "% MAC address-table is not supported on this device";
    const tokens = arg.toLowerCase().trim().split(/\s+/);
    const entries = this.filteredMacEntries(tokens, arg);
    const lines=[`${"Vlan".padEnd(7)} ${"Mac Address".padEnd(17)} ${"Type".padEnd(11)} ${"Ports".padEnd(10)} Age`];
    for(const e of entries) {
      const timestamp = e.lastSeenAt || e.learnedAt;
      const age = isStaticMacEntry(e) ? "-" : timestamp ? String(Math.max(0, Math.floor((Date.now() - timestamp) / 1000))) : "?";
      lines.push(`${String(e.vlan).padEnd(7)} ${formatMacForCisco(e.mac).padEnd(17)} ${String(e.type).toUpperCase().padEnd(11)} ${(e.interfaceId||e.port||"").padEnd(10)} ${age}`);
    }
    return lines.join("\n");
  }
  filteredMacEntries(tokens, original) {
    let entries = [...(this.device.config.macTable||[])];
    if (tokens.includes("dynamic")) entries = entries.filter(e=>String(e.type).toUpperCase()==="DYNAMIC" && !e.static);
    if (tokens.includes("static")) entries = entries.filter(e=>String(e.type).toUpperCase()==="STATIC" || e.static);
    const vlanIndex = tokens.indexOf("vlan");
    if (vlanIndex >= 0) {
      const vlan = Number(tokens[vlanIndex+1]);
      entries = entries.filter(e=>Number(e.vlan)===vlan);
    }
    const interfaceMatch = original.match(/\b(?:interface|int)\s+(.+)$/i);
    if (interfaceMatch) {
      const key = resolveInterface(this.device.config.interfaces, interfaceMatch[1]);
      if (!key) return [];
      entries = entries.filter(e=>(e.interfaceId||e.port)===key);
    }
    return entries;
  }
  clear(arg) {
    if (this.mode !== "privileged") return "% Invalid input detected at '^' marker.";
    const lower = arg.toLowerCase().trim();
    if (!lower.startsWith("mac address-table dynamic") && !lower.startsWith("mac add dyn")) return "% Unrecognized clear command";
    if (!this.switchingSupported()) return "% MAC address-table is not supported on this device";
    const tokens = lower.split(/\s+/);
    const filter = {};
    const vlanIndex = tokens.indexOf("vlan");
    if (vlanIndex >= 0) filter.vlan = Number(tokens[vlanIndex+1]);
    const ifaceMatch = arg.match(/\b(?:interface|int)\s+(.+)$/i);
    if (ifaceMatch) {
      const key = resolveInterface(this.device.config.interfaces, ifaceMatch[1]);
      if (!key) return "% Invalid interface type and number";
      filter.interfaceId = key;
    }
    const cleared = clearDynamicMacEntries(this.device, filter);
    this.changed();
    const noun = cleared === 1 ? "entry" : "entries";
    return `${cleared} dynamic MAC address-table ${noun} cleared.`;
  }
  configureStaticMac(command, remove) {
    if (!this.switchingSupported()) return "% MAC address-table is not supported on this device";
    const match = command.match(/^mac address-table static\s+(\S+)\s+vlan\s+(\d+)\s+interface\s+(.+)$/i);
    if (!match) return "% Incomplete command";
    const mac = normalizeMacAddress(match[1]);
    if (!mac) return "% Invalid MAC address";
    const vlan = Number(match[2]);
    const key = resolveInterface(this.device.config.interfaces, match[3]);
    if (!key) return "% Invalid interface type and number";
    if (remove) removeMacEntry(this.device, mac, vlan, key);
    else addStaticMacEntry(this.device, mac, vlan, key);
    this.changed();
    return "";
  }
  prompt() {
    const h = this.device.config.hostname || this.device.name;
    if (this.mode === "user") return `${h}>`;
    if (this.mode === "privileged") return `${h}#`;
    if (this.mode === "config") return `${h}(config)#`;
    if (this.mode === "interface") return `${h}(config-if)#`;
    if (this.mode === "vlan") return `${h}(config-vlan)#`;
    if (this.mode === "router-ospf") return `${h}(config-router)#`;
    return `${h}#`;
  }
  execute(raw) {
    const command = raw.trim();
    if (!command) return "";
    this.history.push(command); this.historyIndex = this.history.length;
    const c = command.toLowerCase();
    const compact = c.replace(/\s+/g," ");
    if (c === "?" || c === "help") return this.help();
    if (c === "exit") return this.exit();
    if (c === "end") { this.mode="privileged"; this.currentInterface=null; return ""; }
    if ((c === "enable" || c === "en") && this.mode==="user") { this.mode="privileged"; return ""; }
    if ((c==="disable") && this.mode==="privileged") { this.mode="user"; return ""; }
    if ((c==="configure terminal" || c==="conf t" || c==="config t") && this.mode==="privileged") { this.mode="config"; return ""; }

    if (c.startsWith("show ")) return this.show(command.slice(5));
    if (c.startsWith("sh ")) return this.show(command.slice(3));
    if (c.startsWith("clear ")) return this.clear(command.slice(6));
    if (c.startsWith("ping ")) {
      const ip=command.split(/\s+/)[1];
      return simulatePing(this.state,this.device.id,ip).output;
    }
    if (c.startsWith("traceroute ")) {
      const ip=command.split(/\s+/)[1];
      const r=simulatePing(this.state,this.device.id,ip);
      return r.ok ? `Tracing route to ${ip}\n  1  <1 ms  <1 ms  <1 ms  ${ip}\nTrace complete.` : `Unable to resolve or reach ${ip}.`;
    }

    if (this.mode==="config") return this.config(command);
    if (this.mode==="interface") return this.interfaceConfig(command);
    if (this.mode==="vlan") return this.vlanConfig(command);
    if (this.mode==="router-ospf") return this.ospfConfig(command);
    return `% Invalid input detected at '^' marker.`;
  }
  help() {
    return [
      "Supported commands:",
      " enable, disable, configure terminal, exit, end",
      " show running-config, show startup-config",
      " show ip interface brief, show interfaces",
      " show vlan brief, show ip route",
      " show cdp neighbors, show lldp neighbors",
      " ping A.B.C.D, traceroute A.B.C.D",
      " hostname NAME, interface NAME, vlan ID",
      " ip address A.B.C.D MASK, shutdown, no shutdown",
      " switchport mode access|trunk, switchport access vlan ID",
      " description TEXT, router ospf ID, network ... area ..."
    ].join("\n");
  }
  exit() {
    if (this.mode==="user") return "Logout";
    if (this.mode==="privileged") { this.mode="user"; return ""; }
    if (["interface","vlan","router-ospf"].includes(this.mode)) { this.mode="config"; this.currentInterface=null; this.currentVlan=null; return ""; }
    if (this.mode==="config") { this.mode="privileged"; return ""; }
    return "";
  }
  show(arg) {
    const a=arg.toLowerCase();
    if (["ip interface brief","ip int brief","ip int br","ip interface br"].includes(a)) {
      const rows=["Interface              IP-Address      OK? Method Status                Protocol"];
      for (const i of Object.values(this.device.config.interfaces)) {
        const status=i.shutdown?"administratively down":"up";
        rows.push(`${i.name.padEnd(22)} ${(i.ip||"unassigned").padEnd(15)} YES manual ${status.padEnd(21)} ${i.shutdown?"down":"up"}`);
      }
      return rows.join("\n");
    }
    if (a.startsWith("interface ") || a.startsWith("interfaces ") || a.startsWith("int ")) {
      const name = arg.replace(/^(?:interfaces?|int)\s+/i, "");
      const key = resolveInterface(this.device.config.interfaces, name);
      if (!key) return "% Invalid interface type and number";
      const i = this.device.config.interfaces[key];
      return this.interfaceSummary(i);
    }
    if (a==="interfaces" || a==="int" || a==="interface") {
      return Object.values(this.device.config.interfaces).map(i =>
        this.interfaceSummary(i)
      ).join("\n\n");
    }
    if (a==="vlan brief" || a==="vlan br") {
      const lines=["VLAN Name                             Status    Ports"];
      for (const v of Object.values(this.device.config.vlans)) {
        const ports=Object.values(this.device.config.interfaces).filter(i=>i.vlan===v.id && i.mode==="access").map(i=>i.name).join(", ");
        lines.push(`${String(v.id).padEnd(4)} ${(v.name||`VLAN${v.id}`).padEnd(32)} active    ${ports}`);
      }
      return lines.join("\n");
    }
    if (a==="ip route" || a==="ip ro") {
      const lines=["Codes: C - connected, S - static, O - OSPF","Gateway of last resort is not set"];
      for (const i of Object.values(this.device.config.interfaces)) if (i.ip && !i.shutdown) lines.push(`C    ${i.ip}/${i.mask} is directly connected, ${i.name}`);
      for (const r of this.device.config.routes) lines.push(`S    ${r.network} ${r.mask} [1/0] via ${r.nextHop}`);
      return lines.join("\n");
    }
    if (["cdp neighbors","cdp nei","lldp neighbors","lldp nei"].includes(a)) {
      const lines=["Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID"];
      for (const n of neighbors(this.state,this.device.id)) lines.push(`${n.device.config.hostname.padEnd(16)} ${n.local.port.padEnd(17)} 120        R S I       Sim      ${n.remote.port}`);
      return lines.join("\n");
    }
    if (["arp","ip arp"].includes(a)) {
      const lines=["Protocol  Address          Age (min)  Hardware Addr   Type   Interface"];
      for(const e of this.device.config.arpTable||[]) lines.push(`Internet  ${String(e.ip).padEnd(16)} 0          ${e.mac}  ARPA`);
      return lines.join("\n");
    }
    if (a.startsWith("mac address-table") || a.startsWith("mac add")) return this.showMacAddressTable(arg);
    if (["spanning-tree","span"].includes(a)) return this.showSpanningTree();
    if (["etherchannel summary","etherchannel sum"].includes(a)) return this.showEtherChannelSummary();
    if (a==="running-config" || a==="run" || a==="startup-config") return this.runningConfig();
    return `% Unrecognized show command`;
  }
  runningConfig() {
    const d=this.device, out=["Building configuration...","","version 1.0",`hostname ${d.config.hostname}`];
    for (const [name,i] of Object.entries(d.config.interfaces)) {
      out.push(`interface ${name}`);
      if (i.description) out.push(` description ${i.description}`);
      if (i.ip) out.push(` ip address ${i.ip} ${i.mask}`);
      if (this.switchingSupported()) {
        out.push(` switchport mode ${i.mode}`);
        if (i.mode==="access") out.push(` switchport access vlan ${i.vlan}`);
        if (effectiveSwitchportMode(i)==="trunk") {
          out.push(` switchport trunk native vlan ${i.nativeVlan||1}`);
          out.push(` switchport trunk allowed vlan ${i.allowedVlans||"all"}`);
        }
      }
      if (i.channelGroup) out.push(` channel-group ${i.channelGroup} mode ${i.channelMode||"on"}`);
      if (i.stpState) out.push(` spanning-tree port-state ${i.stpState}`);
      out.push(i.shutdown ? " shutdown" : " no shutdown");
      out.push("!");
    }
    for (const r of d.config.routes) out.push(`ip route ${r.network} ${r.mask} ${r.nextHop}`);
    for (const e of d.config.macTable||[]) if (isStaticMacEntry(e)) out.push(`mac address-table static ${formatMacForCisco(e.mac)} vlan ${e.vlan} interface ${e.interfaceId||e.port}`);
    if (d.config.ospf.processId) {
      out.push(`router ospf ${d.config.ospf.processId}`);
      d.config.ospf.networks.forEach(n=>out.push(` network ${n.network} ${n.wildcard} area ${n.area}`));
    }
    out.push("end");
    return out.join("\n");
  }
  config(command) {
    const c=command.toLowerCase();
    if (c.startsWith("hostname ")) {
      const name=command.split(/\s+/).slice(1).join("");
      this.device.config.hostname=name; this.device.name=name; this.changed(); return "";
    }
    if (c.startsWith("interface ") || c.startsWith("int ") || c.startsWith("intf ")) {
      const name=command.replace(/^(?:interface|int|intf)\s+/i,"");
      const key=resolveInterface(this.device.config.interfaces,name);
      if (!key) return "% Invalid interface type and number";
      this.currentInterface=key; this.mode="interface"; return "";
    }
    if (c.startsWith("vlan ")) {
      const id=Number(command.split(/\s+/)[1]);
      if (!Number.isInteger(id)||id<1||id>4094) return "% Invalid VLAN";
      if (!this.device.config.vlans[id]) this.device.config.vlans[id]={id,name:`VLAN${id}`};
      this.currentVlan=id; this.mode="vlan"; this.changed(); return "";
    }
    if (c.startsWith("ip route ")) {
      const [, , network, mask, nextHop]=command.split(/\s+/);
      if (!network||!mask||!nextHop) return "% Incomplete command";
      this.device.config.routes.push({network,mask,nextHop}); this.changed(); return "";
    }
    if (c.startsWith("router ospf ")) {
      const id=Number(command.split(/\s+/)[2]);
      this.device.config.ospf.processId=id; this.mode="router-ospf"; this.changed(); return "";
    }
    if (c.startsWith("spanning-tree mode ")) {
      const mode=command.split(/\s+/)[2];
      if (!["pvst","rapid-pvst","rstp"].includes(mode)) return "% Invalid spanning-tree mode";
      this.device.config.stp ||= {};
      this.device.config.stp.mode=mode; this.changed(); return "";
    }
    if (c.startsWith("mac address-table static ")) return this.configureStaticMac(command, false);
    if (c.startsWith("no mac address-table static ")) return this.configureStaticMac(command.replace(/^no\s+/i, ""), true);
    return "% Invalid configuration command";
  }
  interfaceConfig(command) {
    const i=this.device.config.interfaces[this.currentInterface], c=command.toLowerCase();
    if (c.startsWith("ip address ")) {
      const [, , ip, mask]=command.split(/\s+/);
      if (!ip||!mask) return "% Incomplete command";
      i.ip=ip; i.mask=mask; this.changed(); return "";
    }
    if (c==="shutdown") { i.shutdown=true; this.changed(); return ""; }
    if (c==="no shutdown" || c==="no shut") { i.shutdown=false; this.changed(); return ""; }
    if (c.startsWith("description ")) { i.description=command.slice(12); this.changed(); return ""; }
    if (c.startsWith("switchport mode ")) {
      const rest=command.replace(/^switchport mode\s+/i,"").toLowerCase();
      const mode=rest.startsWith("dynamic ") ? rest : command.split(/\s+/)[2];
      if (!["access","trunk","dynamic auto","dynamic desirable"].includes(mode)) return "% Invalid mode";
      i.mode=mode; i.dtpMode=mode.startsWith("dynamic ")?mode.split(/\s+/)[1]:"none"; this.changed(); return "";
    }
    if (c.startsWith("switchport access vlan ")) {
      const id=Number(command.split(/\s+/)[3]); i.vlan=id;
      if (!this.device.config.vlans[id]) this.device.config.vlans[id]={id,name:`VLAN${id}`};
      this.changed(); return "";
    }
    if (c.startsWith("switchport trunk native vlan ")) {
      const id=Number(command.split(/\s+/)[4]);
      if (!Number.isInteger(id)||id<1||id>4094) return "% Invalid VLAN";
      i.nativeVlan=id; this.changed(); return "";
    }
    if (c.startsWith("switchport trunk allowed vlan ")) {
      const rest=command.replace(/^switchport trunk allowed vlan\s+/i,"").trim();
      const [op, list] = rest.split(/\s+/,2);
      if (["add","remove"].includes(op)) updateAllowedVlans(i, op, list);
      else if (op==="all" || op==="none") updateAllowedVlans(i, op);
      else updateAllowedVlans(i, "set", rest);
      this.changed(); return "";
    }
    if (c.startsWith("channel-group ")) {
      const parts=command.split(/\s+/), group=Number(parts[1]), mode=parts[3]||"on";
      if (!Number.isInteger(group)||group<1||group>64) return "% Invalid channel group";
      if (!["on","active","passive","desirable","auto"].includes(mode)) return "% Invalid channel-group mode";
      i.channelGroup=group; i.channelMode=mode; i.etherChannelState="bundled"; this.changed(); return "";
    }
    if (c==="no channel-group") { i.channelGroup=null; i.channelMode=null; i.etherChannelState=null; this.changed(); return ""; }
    if (c.startsWith("spanning-tree port-state ")) {
      const state=command.split(/\s+/)[2];
      if (!["forwarding","blocking","listening","learning","discarding"].includes(state)) return "% Invalid spanning-tree port state";
      i.stpState=state; this.changed(); return "";
    }
    if (c==="no spanning-tree port-state") { i.stpState="forwarding"; this.changed(); return ""; }
    if (c==="no ip address") { i.ip=""; i.mask=""; this.changed(); return ""; }
    return "% Invalid interface command";
  }
  showSpanningTree() {
    const stp=this.device.config.stp||{}, lines=[`Spanning tree enabled protocol ${stp.mode||"pvst"}`,`Root priority ${stp.priority||32768}`,"Interface              Role Sts Cost"];
    for (const i of Object.values(this.device.config.interfaces||{})) if ((i.layerCapabilities||[]).includes(2)) lines.push(`${i.name.padEnd(22)} Desg ${(i.stpState||"forwarding").padEnd(4)} 19`);
    return lines.join("\n");
  }
  showEtherChannelSummary() {
    const groups=new Map();
    for (const i of Object.values(this.device.config.interfaces||{})) if (i.channelGroup) {
      if (!groups.has(i.channelGroup)) groups.set(i.channelGroup, []);
      groups.get(i.channelGroup).push(i);
    }
    const lines=["Group  Port-channel  Protocol    Ports"];
    for (const [group, members] of groups) lines.push(`${String(group).padEnd(6)} Po${group.toString().padEnd(12)} ${String(members[0].channelMode||"on").padEnd(11)} ${members.map(i=>i.name).join(" ")}`);
    return lines.join("\n");
  }
  vlanConfig(command) {
    if (command.toLowerCase().startsWith("name ")) {
      this.device.config.vlans[this.currentVlan].name=command.slice(5); this.changed(); return "";
    }
    return "% Invalid VLAN command";
  }
  ospfConfig(command) {
    if (command.toLowerCase().startsWith("network ")) {
      const [,network,wildcard,,area]=command.split(/\s+/);
      this.device.config.ospf.networks.push({network,wildcard,area}); this.changed(); return "";
    }
    if (command.toLowerCase().startsWith("router-id ")) {
      this.device.config.ospf.routerId=command.split(/\s+/)[1]; this.changed(); return "";
    }
    return "% Invalid OSPF command";
  }
  changed() { if(this.onChange)this.onChange(); }
  interfaceSummary(i) {
    const admin = i.shutdown ? "administratively down" : "up";
    const protocol = i.shutdown || i.linkState !== "up" ? "down" : "up";
    return [
      `${i.name} is ${admin}, line protocol is ${protocol}`,
      `  Hardware is ${i.connectorType || "unknown"}, address is ${i.mac || "unknown"}`,
      `  Internet address is ${i.ip ? `${i.ip} ${i.mask}` : "unassigned"}`,
      `  MTU 1500 bytes, BW ${i.speed || "auto"}, DLY 10 usec`,
      `  Full-duplex setting: ${i.duplex || "auto"}, Auto-negotiation: ${i.autoNegotiation === false ? "off" : "on"}`,
      `  Description: ${i.description||"none"}`
    ].join("\n");
  }
}
