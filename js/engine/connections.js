export const CONNECTION_TYPES = [
  { key: "automatic", label: "Automatically Choose Connection Type", icon: "⚡", color: "#f2b441" },
  { key: "console", label: "Console cable", icon: "▣", color: "#58a6ff" },
  { key: "copperStraightThrough", label: "Copper straight-through", icon: "━", color: "#24292f" },
  { key: "copperCrossover", label: "Copper crossover", icon: "⨯", color: "#c96b00" },
  { key: "fiber", label: "Fiber", icon: "◇", color: "#d946ef" },
  { key: "phone", label: "Phone cable", icon: "☎", color: "#7c3aed" },
  { key: "coaxial", label: "Coaxial cable", icon: "◎", color: "#795548" },
  { key: "serialDce", label: "Serial DCE", icon: "DCE", color: "#2563eb" },
  { key: "serialDte", label: "Serial DTE", icon: "DTE", color: "#0f766e" },
  { key: "usb", label: "USB", icon: "USB", color: "#64748b" },
  { key: "octal", label: "Octal cable", icon: "8×", color: "#8b5cf6" },
  { key: "iotCustom", label: "IoT custom cable", icon: "IoT", color: "#16a34a" },
  { key: "wirelessAssociation", label: "Wireless association", icon: "≋", color: "#0891b2" }
];

export const CONNECTION_TYPE_MAP = Object.fromEntries(CONNECTION_TYPES.map(c => [c.key, c]));
export const ROUTED_DEVICE_DEFAULT_UP_INTERFACE_TYPES = new Set(["console", "usb"]);

const NETWORK_DEVICE_KINDS = new Set(["router", "switch", "multilayer-switch", "hub", "bridge", "repeater", "firewall", "wireless-router", "access-point"]);
const END_DEVICE_KINDS = new Set(["pc", "laptop", "server", "printer", "ip-phone", "tablet", "smartphone", "iot", "mcu", "plc", "sensor", "actuator"]);

export function interfaceMetadata(name, deviceDef = {}) {
  const compact = name.toLowerCase().replace(/\s+/g, "");
  const isSfpUplink = /^gigabitethernet\d+\/1\/\d+/.test(compact);
  const meta = {
    abbreviation: abbreviateInterfaceName(name),
    interfaceType: "ethernet",
    connectorType: "rj45",
    layerCapabilities: [1, 2],
    speed: "auto",
    duplex: "auto",
    administrativeState: "up",
    linkState: "down",
    autoNegotiation: true,
    vlanMode: "access",
    accessVlan: 1,
    nativeVlan: 1,
    allowedVlans: "1-4094",
    channelGroup: null,
    moduleDependency: null,
    powerState: "on"
  };

  if (compact.startsWith("serial")) Object.assign(meta, { interfaceType: "serial", connectorType: "serial", speed: "clocked", duplex: "full", autoNegotiation: false });
  else if (compact === "console" || compact.startsWith("aux") || compact === "rs232") {
    const connectorType = compact === "rs232" ? "rs232" : "console";
    Object.assign(meta, { interfaceType: "console", connectorType, speed: "9600", duplex: "full", autoNegotiation: false });
  }
  else if (compact.startsWith("wireless") || compact.startsWith("cellular")) Object.assign(meta, { interfaceType: "wireless", connectorType: "wireless", speed: "auto", duplex: "full" });
  else if (compact.startsWith("coaxial")) Object.assign(meta, { interfaceType: "coaxial", connectorType: "coax" });
  else if (compact.startsWith("phone") || compact.startsWith("dsl")) Object.assign(meta, { interfaceType: "phone", connectorType: "rj11" });
  else if (compact.startsWith("usb")) Object.assign(meta, { interfaceType: "usb", connectorType: "usb" });
  else if (compact.startsWith("digital") || compact.startsWith("analog")) Object.assign(meta, { interfaceType: "iot", connectorType: "iot-custom", speed: "signal", duplex: "simplex", autoNegotiation: false });
  else if (compact.startsWith("tengigabitethernet")) Object.assign(meta, { interfaceType: "fiberEthernet", connectorType: "sfp", speed: "10G" });
  else if (isSfpUplink) Object.assign(meta, { interfaceType: "fiberEthernet", connectorType: "sfp", speed: "1G" });
  else if (compact.startsWith("fastethernet")) meta.speed = "100M";
  else if (compact.startsWith("gigabitethernet")) meta.speed = "1G";

  if (deviceDef.kind === "cell-tower" && meta.interfaceType === "wireless") meta.layerCapabilities = [1];
  return meta;
}

export function physicalInterface(name, deviceDef = {}) {
  const meta = interfaceMetadata(name, deviceDef);
  return {
    name,
    ...meta,
    ip: "",
    mask: "",
    ipv6: "",
    shutdown: ["router", "firewall", "multilayer-switch"].includes(deviceDef.kind) && !ROUTED_DEVICE_DEFAULT_UP_INTERFACE_TYPES.has(meta.interfaceType),
    vlan: 1,
    nativeVlan: 1,
    allowedVlans: "1-4094",
    mode: "access",
    description: "",
    connectedLinkId: null,
    mac: null,
    cableConnection: null
  };
}

export function hydrateDeviceInterfaces(device, deviceDef = {}) {
  if (!device || !device.config || !device.config.interfaces) return;
  for (const intf of Object.values(device.config.interfaces)) {
    const meta = interfaceMetadata(intf.name, deviceDef);
    for (const [key, value] of Object.entries(meta)) {
      if (intf[key] === undefined || intf[key] === null) intf[key] = value;
    }
    intf.administrativeState = intf.shutdown ? "down" : "up";
    intf.vlanMode = intf.mode || intf.vlanMode || "access";
    intf.accessVlan = intf.vlan || intf.accessVlan || 1;
    intf.powerState = device.enabled === false || device.config.physical?.power === false ? "off" : "on";
  }
}

export function cableForLink(link) {
  return link?.cableType || link?.type || "automatic";
}

export function portSupportsCable(intf, cableKey) {
  if (!intf) return false;
  const type = intf.interfaceType || interfaceMetadata(intf.name).interfaceType;
  const connector = intf.connectorType || interfaceMetadata(intf.name).connectorType;
  if (cableKey === "automatic") return true;
  if (["copperStraightThrough", "copperCrossover"].includes(cableKey)) return type === "ethernet" && connector === "rj45";
  if (cableKey === "fiber") return type === "fiberEthernet" || connector === "sfp";
  if (cableKey === "console" || cableKey === "octal") return consoleCableEndpoint(intf);
  if (cableKey === "phone") return type === "phone" || connector === "rj11";
  if (cableKey === "coaxial") return type === "coaxial" || connector === "coax";
  if (cableKey === "serialDce" || cableKey === "serialDte") return type === "serial";
  if (cableKey === "usb") return type === "usb";
  if (cableKey === "iotCustom") return type === "iot" || connector === "iot-custom";
  if (cableKey === "wirelessAssociation") return type === "wireless";
  return false;
}

export function availablePorts(device, cableKey = "automatic", peer = null) {
  const ports = Object.values(device.config.interfaces || {}).filter(i => !i.connectedLinkId || i.interfaceType === "wireless");
  if (cableKey === "automatic") return ports;
  return ports.filter(i => portSupportsCable(i, cableKey) && (!peer || canConnectPorts(cableKey, device, i, peer.device, peer.port).ok));
}

export function canConnectPorts(cableKey, aDevice, aPort, bDevice, bPort, options = {}) {
  if (!aDevice || !bDevice || !aPort || !bPort) return { ok: false, reason: "Both devices and ports must be selected." };
  if (aDevice.id === bDevice.id) return { ok: false, reason: "Select two different devices." };
  if (aPort.connectedLinkId && aPort.connectedLinkId !== options.ignoreLinkId && aPort.interfaceType !== "wireless") return { ok: false, reason: `${aDevice.name} ${aPort.name} is already occupied.` };
  if (bPort.connectedLinkId && bPort.connectedLinkId !== options.ignoreLinkId && bPort.interfaceType !== "wireless") return { ok: false, reason: `${bDevice.name} ${bPort.name} is already occupied.` };
  if (!CONNECTION_TYPE_MAP[cableKey] || cableKey === "automatic") return { ok: false, reason: "Choose a concrete cable type or use automatic selection." };
  if (!portSupportsCable(aPort, cableKey)) return { ok: false, reason: `${aPort.name} does not accept ${CONNECTION_TYPE_MAP[cableKey].label}.` };
  if (!portSupportsCable(bPort, cableKey)) return { ok: false, reason: `${bPort.name} does not accept ${CONNECTION_TYPE_MAP[cableKey].label}.` };
  if (cableKey === "console" || cableKey === "octal") {
    const hasConsole = aPort.connectorType === "console" || bPort.connectorType === "console";
    const hasTerminal = aPort.connectorType === "rs232" || bPort.connectorType === "rs232";
    if (!hasConsole || !hasTerminal) return { ok: false, reason: "Console-style cables require a console/AUX port and an RS-232 terminal port." };
  }
  if (["serialDce", "serialDte"].includes(cableKey) && aPort.interfaceType !== "serial") return { ok: false, reason: "The first selected port must be a serial interface for this serial cable role." };
  if (cableKey === "wirelessAssociation" && (aPort.interfaceType !== "wireless" || bPort.interfaceType !== "wireless")) return { ok: false, reason: "Wireless association requires wireless interfaces on both devices." };
  return { ok: true, reason: "Compatible" };
}

export function selectAutomaticConnection(aDevice, bDevice) {
  if (!aDevice || !bDevice || aDevice.id === bDevice.id) return { ok: false, reason: "Select two different devices." };
  const candidates = [];
  for (const aPort of availablePorts(aDevice, "automatic")) {
    for (const bPort of availablePorts(bDevice, "automatic")) {
      const choice = automaticCableForPair(aDevice, aPort, bDevice, bPort);
      if (!choice) continue;
      const validation = canConnectPorts(choice.cableType, aDevice, aPort, bDevice, bPort);
      if (validation.ok) candidates.push({ ...choice, aPort, bPort });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return { ok: false, reason: `No compatible available ports exist between ${aDevice.name} and ${bDevice.name}.` };
  return { ok: true, cableType: best.cableType, aPort: best.aPort, bPort: best.bPort, reason: automaticReason(best.cableType, aDevice, best.aPort, bDevice, best.bPort) };
}

export function validateLink(state, link) {
  const aDevice = state.devices.find(d => d.id === link.a.deviceId);
  const bDevice = state.devices.find(d => d.id === link.b.deviceId);
  const aPort = aDevice?.config.interfaces?.[link.a.port];
  const bPort = bDevice?.config.interfaces?.[link.b.port];
  const linkCable = cableForLink(link);
  const cableKey = linkCable === "automatic" ? (link.resolvedCableType || "copperStraightThrough") : linkCable;
  const validation = canConnectPorts(cableKey, aDevice, aPort, bDevice, bPort, { ignoreLinkId: link.id });
  if (!validation.ok) return validation;
  if (!aDevice.enabled || !aDevice.config.physical?.power) return { ok: false, reason: `${aDevice.name} is powered off.` };
  if (!bDevice.enabled || !bDevice.config.physical?.power) return { ok: false, reason: `${bDevice.name} is powered off.` };
  if (aPort.shutdown) return { ok: false, reason: `${aDevice.name} ${aPort.name} is administratively down.` };
  if (bPort.shutdown) return { ok: false, reason: `${bDevice.name} ${bPort.name} is administratively down.` };
  return { ok: true, reason: "Up/up" };
}

function automaticCableForPair(aDevice, aPort, bDevice, bPort) {
  const aType = aPort.interfaceType, bType = bPort.interfaceType;
  if (aType === "ethernet" && bType === "ethernet") {
    const aNet = NETWORK_DEVICE_KINDS.has(deviceKind(aDevice)), bNet = NETWORK_DEVICE_KINDS.has(deviceKind(bDevice));
    const aEnd = END_DEVICE_KINDS.has(deviceKind(aDevice)), bEnd = END_DEVICE_KINDS.has(deviceKind(bDevice));
    const sameClass = (aNet && bNet) || (aEnd && bEnd);
    return { cableType: sameClass ? "copperCrossover" : "copperStraightThrough", score: sameClass ? 80 : 100 };
  }
  if (aType === "fiberEthernet" && bType === "fiberEthernet") return { cableType: "fiber", score: 95 };
  if (aType === "serial" && bType === "serial") return { cableType: "serialDce", score: 70 };
  if (aType === "coaxial" && bType === "coaxial") return { cableType: "coaxial", score: 65 };
  if (aType === "phone" && bType === "phone") return { cableType: "phone", score: 60 };
  if (aType === "wireless" && bType === "wireless") return { cableType: "wirelessAssociation", score: 55 };
  if ((aPort.connectorType === "rs232" && bPort.connectorType === "console") || (aPort.connectorType === "console" && bPort.connectorType === "rs232")) return { cableType: "console", score: 50 };
  if (aType === "usb" && bType === "usb") return { cableType: "usb", score: 45 };
  if (aType === "iot" && bType === "iot") return { cableType: "iotCustom", score: 40 };
  return null;
}

function automaticReason(cableType, aDevice, aPort, bDevice, bPort) {
  return `Automatic selected ${CONNECTION_TYPE_MAP[cableType].label} for ${aDevice.name} ${aPort.name} ↔ ${bDevice.name} ${bPort.name}.`;
}

function deviceKind(device) {
  return device.kind || "";
}

function consoleCableEndpoint(intf) {
  return intf.interfaceType === "console" || intf.connectorType === "rs232";
}

export function attachDeviceDefinitions(devices, deviceTypes) {
  for (const device of devices) {
    const def = deviceTypes[device.type] || {};
    if (!device.kind && def.kind) device.kind = def.kind;
    hydrateDeviceInterfaces(device, def);
  }
}

export function abbreviateInterfaceName(name) {
  return name
    .replace(/^TenGigabitEthernet/i, "Te")
    .replace(/^FastEthernet/i, "Fa")
    .replace(/^GigabitEthernet/i, "Gi")
    .replace(/^Serial/i, "Se")
    .replace(/^Management/i, "Mgmt")
    .replace(/^Port-channel/i, "Po")
    .replace(/^Vlan/i, "Vl")
    .replace(/^Wireless/i, "Wi")
    .replace(/^Ethernet/i, "Et");
}

const INTERFACE_ALIASES = [
  ["tengigabitethernet", "te"],
  ["fastethernet", "fa"],
  ["gigabitethernet", "gi"],
  ["ethernet", "et"],
  ["serial", "se"],
  ["port-channel", "po"],
  ["portchannel", "po"],
  ["vlan", "vl"],
  ["management", "mgmt"],
  ["wireless", "wi"]
];

// Tuple format is [canonical prefix, normalized short prefix] for IOS-style
// interface commands such as "interface FastEthernet 0/1" and "int fa0/1".
export function normalizeInterfaceName(name) {
  let value = String(name || "").toLowerCase().replace(/\s+/g, "").replace(/_/g, "-");
  for (const [longName, shortName] of INTERFACE_ALIASES) {
    if (value.startsWith(longName)) return shortName + value.slice(longName.length);
  }
  return value;
}

export function resolveInterface(interfaces, name) {
  const wanted = normalizeInterfaceName(name);
  const keys = Object.keys(interfaces || {});
  return keys.find(key => normalizeInterfaceName(key) === wanted) || null;
}

export const ENDPOINT_INDICATORS = {
  forwarding: { key: "forwarding", label: "Physical link up / STP forwarding", color: "#25a55f", shape: "triangle", symbol: "▶" },
  negotiating: { key: "negotiating", label: "Negotiating / STP listening", color: "#d68a00", shape: "diamond", symbol: "◆" },
  learning: { key: "learning", label: "STP learning", color: "#c9a100", shape: "triangle", symbol: "▲" },
  blocking: { key: "blocking", label: "STP blocking or discarding", color: "#8b5cf6", shape: "blocked", symbol: "⊘" },
  adminDown: { key: "adminDown", label: "Administratively down", color: "#6b7280", shape: "square", symbol: "■" },
  down: { key: "down", label: "Physical link down", color: "#d64545", shape: "triangle", symbol: "▼" },
  errDisabled: { key: "errDisabled", label: "Error-disabled / BPDU Guard", color: "#991b1b", shape: "octagon", symbol: "!" },
  bundled: { key: "bundled", label: "EtherChannel bundled member", color: "#15803d", shape: "badge", symbol: "Po" },
  suspended: { key: "suspended", label: "EtherChannel suspended or incompatible", color: "#b45309", shape: "badge", symbol: "S" },
  standalone: { key: "standalone", label: "EtherChannel standalone member", color: "#0f766e", shape: "badge", symbol: "I" },
  disconnected: { key: "disconnected", label: "Cable disconnected at this end", color: "#9ca3af", shape: "circle", symbol: "○" },
  incompatible: { key: "incompatible", label: "Cable or port incompatibility", color: "#e11d48", shape: "octagon", symbol: "×" },
  serialDce: { key: "serialDce", label: "Serial DCE role", color: "#2563eb", shape: "badge", symbol: "DCE" },
  serialDte: { key: "serialDte", label: "Serial DTE role", color: "#0f766e", shape: "badge", symbol: "DTE" },
  wireless: { key: "wireless", label: "Wireless association", color: "#0891b2", shape: "circle", symbol: "≋" },
  unknown: { key: "unknown", label: "Unknown or not modeled", color: "#6b7280", shape: "circle", symbol: "?" }
};

export function endpointIndicatorFor(state, link, side) {
  // Keep this priority in sync with docs/PHASE1_COMPATIBILITY_MATRIX.md:
  // disconnected/power/admin/errors/compatibility before STP and EtherChannel overlays.
  const endpoint = link?.[side];
  if (!endpoint?.deviceId || !endpoint?.port) return ENDPOINT_INDICATORS.disconnected;
  const device = state.devices.find(d => d.id === endpoint.deviceId);
  const intf = device?.config?.interfaces?.[endpoint.port];
  if (!device || !intf) return ENDPOINT_INDICATORS.disconnected;
  const cableKey = link.resolvedCableType || cableForLink(link);
  if (device.enabled === false || device.config?.physical?.power === false || intf.powerState === "off" || intf.modulePresent === false) return ENDPOINT_INDICATORS.down;
  if (intf.shutdown || intf.administrativeState === "down") return ENDPOINT_INDICATORS.adminDown;
  if (intf.errDisabled || intf.errorDisabled || intf.bpduGuardState === "err-disabled") return ENDPOINT_INDICATORS.errDisabled;
  if (!portSupportsCable(intf, cableKey)) return ENDPOINT_INDICATORS.incompatible;
  if (intf.linkState === "down" || link.up === false) return ENDPOINT_INDICATORS.down;

  const channel = String(intf.etherChannelState || intf.channelState || "").toLowerCase();
  if (["suspended", "incompatible"].includes(channel)) return ENDPOINT_INDICATORS.suspended;
  if (["standalone", "individual"].includes(channel)) return ENDPOINT_INDICATORS.standalone;
  if (["bundled", "port-channel", "active"].includes(channel)) return ENDPOINT_INDICATORS.bundled;

  const stp = String(intf.stpState || intf.rstpState || "").toLowerCase();
  if (["blocking", "discarding", "blocked"].includes(stp)) return ENDPOINT_INDICATORS.blocking;
  if (["listening", "negotiating"].includes(stp)) return ENDPOINT_INDICATORS.negotiating;
  if (stp === "learning") return ENDPOINT_INDICATORS.learning;

  if (cableKey === "serialDce" && side === "a") return ENDPOINT_INDICATORS.serialDce;
  if (cableKey === "serialDte" && side === "a") return ENDPOINT_INDICATORS.serialDte;
  if (intf.interfaceType === "wireless" || cableKey === "wirelessAssociation") return ENDPOINT_INDICATORS.wireless;
  return ENDPOINT_INDICATORS.forwarding;
}

export function devicePortPoint(device, portName, options = {}) {
  const width = options.width || 112, height = options.height || 78;
  const names = Object.keys(device?.config?.interfaces || {});
  const index = Math.max(0, names.indexOf(portName));
  const count = Math.max(1, names.length);
  const side = index % 4;
  const slot = Math.floor(index / 4);
  const sideCount = Math.max(1, Math.ceil(count / 4));
  const t = (slot + 1) / (sideCount + 1);
  if (side === 0) return { x: device.x + width, y: device.y + height * t };
  if (side === 1) return { x: device.x + width * (1 - t), y: device.y + height };
  if (side === 2) return { x: device.x, y: device.y + height * (1 - t) };
  return { x: device.x + width * t, y: device.y };
}

export function routeConnectionPath(link, state, options = {}) {
  const a = state.devices.find(d => d.id === link.a.deviceId);
  const b = state.devices.find(d => d.id === link.b.deviceId);
  if (!a || !b) return null;
  const start = devicePortPoint(a, link.a.port, options.device);
  const end = devicePortPoint(b, link.b.port, options.device);
  const offset = options.offset || 0;
  const dx = end.x - start.x, dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const mx = (start.x + end.x) / 2 + nx * offset;
  const my = (start.y + end.y) / 2 + ny * offset;
  const path = `M ${start.x} ${start.y} Q ${mx} ${my} ${end.x} ${end.y}`;
  return { start, end, control: { x: mx, y: my }, mid: quadraticPoint(start, { x: mx, y: my }, end, 0.5), path, offset };
}

export function parallelLinkOffsets(links, spacing = 18) {
  const groups = new Map();
  for (const link of links) {
    const ids = [link.a.deviceId, link.b.deviceId].sort().join("|");
    if (!groups.has(ids)) groups.set(ids, []);
    groups.get(ids).push(link);
  }
  const offsets = new Map();
  for (const group of groups.values()) {
    group.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const center = (group.length - 1) / 2;
    group.forEach((link, index) => offsets.set(link.id, (index - center) * spacing));
  }
  return offsets;
}

export function routeParallelLinks(links, state, options = {}) {
  const offsets = parallelLinkOffsets(links, options.spacing || 18);
  return new Map(links.map(link => [link.id, routeConnectionPath(link, state, { ...options, offset: offsets.get(link.id) || 0 })]));
}

function quadraticPoint(a, c, b, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x,
    y: mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y
  };
}
