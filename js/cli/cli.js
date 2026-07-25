import { simulatePing, neighbors } from "../engine/network.js";

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
    if (a==="interfaces" || a==="int" || a==="interface") {
      return Object.values(this.device.config.interfaces).map(i =>
        `${i.name} is ${i.shutdown?"administratively down":"up"}, line protocol is ${i.shutdown?"down":"up"}\n  Internet address is ${i.ip ? `${i.ip} ${i.mask}` : "unassigned"}\n  Description: ${i.description||"none"}`
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
    if (["mac address-table","mac address-table dynamic","mac add"].includes(a)) {
      const lines=["Vlan    Mac Address       Type        Ports"];
      for(const e of this.device.config.macTable||[]) lines.push(`${String(e.vlan).padEnd(7)} ${e.mac.padEnd(17)} ${String(e.type).padEnd(11)} ${e.port}`);
      return lines.join("\n");
    }
    if (["spanning-tree","span"].includes(a)) return `Spanning tree enabled protocol ${this.device.config.stp?.mode||"pvst"}\nRoot priority ${this.device.config.stp?.priority||32768}`;
    if (a==="running-config" || a==="run" || a==="startup-config") return this.runningConfig();
    return `% Unrecognized show command`;
  }
  runningConfig() {
    const d=this.device, out=["Building configuration...","","version 1.0",`hostname ${d.config.hostname}`];
    for (const [name,i] of Object.entries(d.config.interfaces)) {
      out.push(`interface ${name}`);
      if (i.description) out.push(` description ${i.description}`);
      if (i.ip) out.push(` ip address ${i.ip} ${i.mask}`);
      if (this.device.type==="switch") {
        out.push(` switchport mode ${i.mode}`);
        if (i.mode==="access") out.push(` switchport access vlan ${i.vlan}`);
      }
      out.push(i.shutdown ? " shutdown" : " no shutdown");
      out.push("!");
    }
    for (const r of d.config.routes) out.push(`ip route ${r.network} ${r.mask} ${r.nextHop}`);
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
      const normalize = value => value.toLowerCase().replace(/\s+/g,"")
        .replace(/^gigabitethernet/,"gi").replace(/^fastethernet/,"fa")
        .replace(/^ethernet/,"e").replace(/^serial/,"s")
        .replace(/^management/,"mgmt");
      const wanted=normalize(name);
      const key=Object.keys(this.device.config.interfaces).find(k=>normalize(k)===wanted || normalize(k).startsWith(wanted));
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
      const mode=command.split(/\s+/)[2];
      if (!["access","trunk"].includes(mode)) return "% Invalid mode";
      i.mode=mode; this.changed(); return "";
    }
    if (c.startsWith("switchport access vlan ")) {
      const id=Number(command.split(/\s+/)[3]); i.vlan=id;
      if (!this.device.config.vlans[id]) this.device.config.vlans[id]={id,name:`VLAN${id}`};
      this.changed(); return "";
    }
    if (c==="no ip address") { i.ip=""; i.mask=""; this.changed(); return ""; }
    return "% Invalid interface command";
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
  changed() { this.onChange?.(); }
}
