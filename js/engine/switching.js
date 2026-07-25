import { validateLink } from "./connections.js";
import {
  BROADCAST_MAC,
  DEFAULT_FRAME_HOP_LIMIT,
  DEFAULT_MAC_AGING_MS,
  addFrameHistory,
  cloneEthernetFrame,
  createEthernetFrame,
  formatMacForCisco,
  isBroadcastMac,
  isMulticastMac,
  isUnicastMac,
  normalizeMacAddress,
  normalizeVlanId,
  stableInterfaceMac
} from "../protocols/ethernet.js";

export const SWITCHING_DEVICE_KINDS = new Set(["switch", "multilayer-switch", "bridge"]);
export const HUB_DEVICE_KINDS = new Set(["hub", "repeater"]);
export const ROUTED_DEVICE_KINDS = new Set(["router", "firewall"]);
export const END_DEVICE_KINDS = new Set(["pc", "laptop", "server", "printer", "ip-phone", "tablet", "smartphone", "iot", "mcu", "plc", "sensor", "actuator", "wireless-router", "access-point", "modem", "cloud"]);
const MAX_L2_EVENT_HISTORY = 200;
const DEFAULT_MAX_EVENTS = 256;

export const L2_DROP_REASONS = {
  ingressDown: "ingress-interface-down",
  egressDown: "egress-interface-down",
  noConnection: "no-connection",
  incompatibleLink: "incompatible-link",
  invalidSourceMac: "invalid-source-mac",
  invalidDestinationMac: "invalid-destination-mac",
  unusableMacEntry: "unusable-mac-entry",
  loopSafetyLimit: "loop-safety-limit",
  routerUnrelatedUnicast: "router-unrelated-unicast",
  endDeviceUnrelatedUnicast: "end-device-unrelated-unicast",
  delivered: "delivered"
};

export function ensureLayer2State(state) {
  state.l2Events ||= [];
  for (const device of state.devices || []) ensureDeviceLayer2State(device);
}

export function ensureDeviceLayer2State(device) {
  if (!device?.config) return;
  device.config.macTable ||= [];
  device.config.macAgingTimeMs ||= DEFAULT_MAC_AGING_MS;
  device.config.l2Counters ||= {};
  device.config.l2StaticMacs ||= [];
  for (const [name, intf] of Object.entries(device.config.interfaces || {})) {
    intf.id ||= name;
    intf.name ||= name;
    if (!intf.mac && ethernetCapable(intf)) intf.mac = stableInterfaceMac(device, name);
    intf.counters ||= {};
  }
  normalizeMacTable(device);
}

export function normalizeMacTable(device) {
  if (!device?.config) return [];
  const normalized = [];
  for (const entry of device.config.macTable || []) {
    const mac = normalizeMacAddress(entry.mac);
    if (!mac) continue;
    normalized.push({
      mac,
      vlan: normalizeVlanId(entry.vlan ?? entry.vlanId),
      interfaceId: entry.interfaceId || entry.port,
      port: entry.port || entry.interfaceId,
      type: String(entry.type || (entry.static ? "STATIC" : "DYNAMIC")).toUpperCase(),
      learnedAt: entry.learnedAt || entry.learnTime || Date.now(),
      lastSeenAt: entry.lastSeenAt || entry.learnTime || Date.now(),
      static: isStaticMacEntry(entry),
      secure: entry.secure || false
    });
  }
  device.config.macTable = normalized;
  return normalized;
}

export function createFrame(options) {
  return createEthernetFrame(options);
}

export function transmitFrame(state, deviceId, interfaceId, frameOptions = {}, options = {}) {
  ensureLayer2State(state);
  const device = findDevice(state, deviceId);
  const intf = device?.config?.interfaces?.[interfaceId];
  if (!device || !intf) return result("error", L2_DROP_REASONS.ingressDown, null);
  const sourceMac = normalizeMacAddress(frameOptions.sourceMac || frameOptions.srcMac || intf.mac);
  const destinationMac = normalizeMacAddress(frameOptions.destinationMac || frameOptions.dstMac);
  const frame = createEthernetFrame({
    ...frameOptions,
    sourceMac,
    destinationMac,
    ingressDeviceId: device.id,
    ingressInterfaceId: interfaceId,
    currentDeviceId: device.id,
    currentInterfaceId: interfaceId,
    vlanId: frameOptions.vlanId || ingressVlan(intf)
  });
  if (!sourceMac || !isUnicastMac(sourceMac)) return drop(state, frame, device, interfaceId, L2_DROP_REASONS.invalidSourceMac);
  if (!destinationMac) return drop(state, frame, device, interfaceId, L2_DROP_REASONS.invalidDestinationMac);
  if (!isInterfaceOperational(device, intf)) return drop(state, frame, device, interfaceId, L2_DROP_REASONS.ingressDown);
  const queue = new Layer2EventQueue(options.maxEvents || DEFAULT_MAX_EVENTS);
  queue.enqueue({ type: "frame-forward", frame, deviceId: device.id, interfaceId, direction: "egress" });
  return processEventQueue(state, queue, options);
}

export function receiveFrame(state, deviceId, interfaceId, frame, options = {}) {
  ensureLayer2State(state);
  const queue = new Layer2EventQueue(options.maxEvents || DEFAULT_MAX_EVENTS);
  queue.enqueue({ type: "frame-arrival", frame: cloneEthernetFrame(frame, { currentDeviceId: deviceId, currentInterfaceId: interfaceId }), deviceId, interfaceId });
  return processEventQueue(state, queue, options);
}

export function processEventQueue(state, queue, options = {}) {
  const events = [];
  const deliveries = [];
  const drops = [];
  while (queue.length) {
    const event = queue.dequeue();
    events.push(recordEvent(state, event));
    if (events.length > (options.maxEvents || DEFAULT_MAX_EVENTS)) {
      const frame = event.frame;
      frame.dropReason = L2_DROP_REASONS.loopSafetyLimit;
      drops.push({ frame, reason: frame.dropReason });
      recordEvent(state, { type: "frame-drop", frame, reason: frame.dropReason, deviceId: event.deviceId, interfaceId: event.interfaceId });
      break;
    }
    if (event.type === "frame-forward") handleFrameForward(state, queue, event, deliveries, drops);
    else if (event.type === "frame-arrival") handleFrameArrival(state, queue, event, deliveries, drops);
  }
  return { ok: drops.length === 0 || deliveries.length > 0, status: drops.length ? "partial-or-dropped" : "success", events, deliveries, drops };
}

function handleFrameForward(state, queue, event, deliveries, drops) {
  const device = findDevice(state, event.deviceId);
  const intf = device?.config?.interfaces?.[event.interfaceId];
  const frame = event.frame;
  if (!device || !intf || !isInterfaceOperational(device, intf)) return pushDrop(state, drops, frame, device, event.interfaceId, L2_DROP_REASONS.egressDown);
  if (frame.hopCount >= (frame.traversalBudget || DEFAULT_FRAME_HOP_LIMIT)) return pushDrop(state, drops, frame, device, event.interfaceId, L2_DROP_REASONS.loopSafetyLimit);
  const remote = resolveRemoteEndpoint(state, device.id, event.interfaceId);
  if (!remote) return pushDrop(state, drops, frame, device, event.interfaceId, L2_DROP_REASONS.noConnection);
  const validation = validateLink(state, remote.link);
  if (!validation.ok) return pushDrop(state, drops, frame, device, event.interfaceId, L2_DROP_REASONS.incompatibleLink);
  incrementInterfaceCounter(intf, "framesTransmitted", 1);
  incrementInterfaceCounter(intf, "bytesTransmitted", frame.size);
  addFrameHistory(frame, { action: "egress", deviceId: device.id, interfaceId: event.interfaceId, remoteDeviceId: remote.device.id, remoteInterfaceId: remote.interfaceId });
  queue.enqueue({ type: "frame-arrival", frame: cloneEthernetFrame(frame, { currentDeviceId: remote.device.id, currentInterfaceId: remote.interfaceId, hopCount: frame.hopCount + 1 }), deviceId: remote.device.id, interfaceId: remote.interfaceId });
}

function handleFrameArrival(state, queue, event, deliveries, drops) {
  const device = findDevice(state, event.deviceId);
  const intf = device?.config?.interfaces?.[event.interfaceId];
  const frame = event.frame;
  if (!device || !intf || !isInterfaceOperational(device, intf)) return pushDrop(state, drops, frame, device, event.interfaceId, L2_DROP_REASONS.ingressDown);
  incrementInterfaceCounter(intf, "framesReceived", 1);
  incrementInterfaceCounter(intf, "bytesReceived", frame.size);
  addFrameHistory(frame, { action: "ingress", deviceId: device.id, interfaceId: event.interfaceId, vlan: frame.vlanId });
  ageMacTable(device, Date.now());
  if (HUB_DEVICE_KINDS.has(device.kind)) return repeatHubFrame(state, queue, device, event.interfaceId, frame, drops);
  if (SWITCHING_DEVICE_KINDS.has(device.kind)) return switchFrame(state, queue, device, event.interfaceId, frame, drops);
  return deliverToHostOrRouter(state, device, event.interfaceId, frame, deliveries, drops);
}

function repeatHubFrame(state, queue, device, ingressInterfaceId, frame, drops) {
  for (const [name, intf] of Object.entries(device.config.interfaces || {})) {
    if (name === ingressInterfaceId || !eligibleEgressInterface(device, intf, frame.vlanId) || !egressHasUsableConnection(state, device, name)) continue;
    incrementInterfaceCounter(intf, "framesFlooded", 1);
    queue.enqueue({ type: "frame-forward", frame: cloneEthernetFrame(frame), deviceId: device.id, interfaceId: name, direction: "egress" });
  }
}

function switchFrame(state, queue, device, ingressInterfaceId, frame, drops) {
  learnSourceMac(device, frame.sourceMac, frame.vlanId, ingressInterfaceId);
  const destination = normalizeMacAddress(frame.destinationMac);
  const flood = isBroadcastMac(destination) || isMulticastMac(destination);
  if (!flood && isUnicastMac(destination)) {
    const entry = lookupMacEntry(device, destination, frame.vlanId);
    if (entry) {
      const egress = macEntryInterface(entry);
      if (egress === ingressInterfaceId) return;
      const intf = device.config.interfaces?.[egress];
      if (!eligibleEgressInterface(device, intf, frame.vlanId) || !egressHasUsableConnection(state, device, egress)) {
        removeDynamicMacEntry(device, destination, frame.vlanId);
        return pushDrop(state, drops, frame, device, egress, L2_DROP_REASONS.unusableMacEntry);
      }
      incrementInterfaceCounter(intf, "framesForwarded", 1);
      queue.enqueue({ type: "frame-forward", frame: cloneEthernetFrame(frame), deviceId: device.id, interfaceId: egress, direction: "egress" });
      return;
    }
  }
  for (const [name, intf] of Object.entries(device.config.interfaces || {})) {
    if (name === ingressInterfaceId || !eligibleEgressInterface(device, intf, frame.vlanId) || !egressHasUsableConnection(state, device, name)) continue;
    incrementInterfaceCounter(intf, flood ? "framesFlooded" : "framesForwarded", 1);
    queue.enqueue({ type: "frame-forward", frame: cloneEthernetFrame(frame), deviceId: device.id, interfaceId: name, direction: "egress" });
  }
}

function deliverToHostOrRouter(state, device, interfaceId, frame, deliveries, drops) {
  const intf = device.config.interfaces[interfaceId];
  const destination = normalizeMacAddress(frame.destinationMac);
  const ownMac = normalizeMacAddress(intf.mac);
  const accepts = isBroadcastMac(destination) || isMulticastMac(destination) || destination === ownMac;
  if (!accepts) {
    const reason = ROUTED_DEVICE_KINDS.has(device.kind) ? L2_DROP_REASONS.routerUnrelatedUnicast : L2_DROP_REASONS.endDeviceUnrelatedUnicast;
    return pushDrop(state, drops, frame, device, interfaceId, reason);
  }
  addFrameHistory(frame, { action: "deliver", deviceId: device.id, interfaceId });
  recordEvent(state, { type: "frame-delivery", frame, deviceId: device.id, interfaceId });
  deliveries.push({ device, interfaceId, frame, payload: frame.payload });
}

export function learnSourceMac(device, mac, vlan, interfaceId, now = Date.now()) {
  ensureDeviceLayer2State(device);
  const normalized = normalizeMacAddress(mac);
  if (!normalized || !isUnicastMac(normalized)) return null;
  const vlanId = normalizeVlanId(vlan);
  let entry = lookupMacEntry(device, normalized, vlanId);
  if (entry?.static) return entry;
  if (!entry) {
    entry = { mac: normalized, vlan: vlanId, interfaceId, port: interfaceId, type: "DYNAMIC", learnedAt: now, lastSeenAt: now, static: false, secure: false };
    device.config.macTable.push(entry);
  } else {
    entry.interfaceId = interfaceId;
    entry.port = interfaceId;
    entry.lastSeenAt = now;
  }
  return entry;
}

export function addStaticMacEntry(device, mac, vlan, interfaceId, now = Date.now()) {
  ensureDeviceLayer2State(device);
  const normalized = normalizeMacAddress(mac);
  if (!normalized || !isUnicastMac(normalized) || !device.config.interfaces?.[interfaceId]) return null;
  removeMacEntry(device, normalized, vlan, interfaceId);
  const entry = { mac: normalized, vlan: normalizeVlanId(vlan), interfaceId, port: interfaceId, type: "STATIC", learnedAt: now, lastSeenAt: now, static: true, secure: false };
  device.config.macTable.push(entry);
  return entry;
}

export function clearDynamicMacEntries(device, filter = {}) {
  ensureDeviceLayer2State(device);
  const vlan = filter.vlan ? normalizeVlanId(filter.vlan) : null;
  const before = device.config.macTable.length;
  device.config.macTable = device.config.macTable.filter(e => isStaticMacEntry(e) || (vlan && e.vlan !== vlan) || (filter.interfaceId && macEntryInterface(e) !== filter.interfaceId));
  return before - device.config.macTable.length;
}

export function removeMacEntry(device, mac, vlan, interfaceId = null) {
  const normalized = normalizeMacAddress(mac);
  const vlanId = normalizeVlanId(vlan);
  const before = device.config.macTable?.length || 0;
  device.config.macTable = (device.config.macTable || []).filter(e => !(e.mac === normalized && e.vlan === vlanId && (!interfaceId || macEntryInterface(e) === interfaceId)));
  return before - device.config.macTable.length;
}

export function lookupMacEntry(device, mac, vlan) {
  const normalized = normalizeMacAddress(mac);
  const vlanId = normalizeVlanId(vlan);
  return (device.config.macTable || []).find(e => e.mac === normalized && normalizeVlanId(e.vlan) === vlanId) || null;
}

export function ageMacTable(device, now = Date.now()) {
  ensureDeviceLayer2State(device);
  const timeout = Number(device.config.macAgingTimeMs || DEFAULT_MAC_AGING_MS);
  device.config.macTable = device.config.macTable.filter(e => isStaticMacEntry(e) || now - (e.lastSeenAt || e.learnedAt || now) < timeout);
}

function removeDynamicMacEntry(device, mac, vlan) {
  const entry = lookupMacEntry(device, mac, vlan);
  if (entry && !isStaticMacEntry(entry)) removeMacEntry(device, mac, vlan);
}

export function isStaticMacEntry(entry) {
  return entry?.static === true || String(entry?.type || "").toUpperCase() === "STATIC";
}

function macEntryInterface(entry) {
  return entry?.interfaceId || entry?.port || "";
}

function ingressVlan(intf) {
  return normalizeVlanId(intf.accessVlan || intf.vlan || 1);
}

function eligibleEgressInterface(device, intf, vlan) {
  if (!isInterfaceOperational(device, intf) || !ethernetCapable(intf)) return false;
  const vlanId = normalizeVlanId(vlan);
  if ((intf.mode || intf.vlanMode) === "trunk") return true;
  return normalizeVlanId(intf.accessVlan || intf.vlan || 1) === vlanId;
}

function egressHasUsableConnection(state, device, interfaceId) {
  const remote = resolveRemoteEndpoint(state, device.id, interfaceId);
  return !!(remote && validateLink(state, remote.link).ok);
}

export function isInterfaceOperational(device, intf) {
  return !!(device && intf && device.enabled !== false && device.config?.physical?.power !== false && !intf.shutdown && intf.linkState !== "down" && intf.powerState !== "off" && intf.modulePresent !== false);
}

function ethernetCapable(intf) {
  return ["ethernet", "fiberEthernet", "wireless"].includes(intf?.interfaceType) || (intf?.layerCapabilities || []).includes(2);
}

function resolveRemoteEndpoint(state, deviceId, interfaceId) {
  for (const link of state.links || []) {
    const side = link.a?.deviceId === deviceId && link.a?.port === interfaceId ? "a" : link.b?.deviceId === deviceId && link.b?.port === interfaceId ? "b" : null;
    if (!side) continue;
    const remoteSide = side === "a" ? "b" : "a";
    const remote = link[remoteSide];
    const device = findDevice(state, remote?.deviceId);
    if (!device || !device.config.interfaces?.[remote.port]) return null;
    return { link, side, remoteSide, device, interfaceId: remote.port, intf: device.config.interfaces[remote.port] };
  }
  return null;
}

function findDevice(state, id) {
  return (state.devices || []).find(d => d.id === id) || null;
}

function incrementInterfaceCounter(intf, key, amount) {
  intf.counters ||= {};
  intf.counters[key] = (intf.counters[key] || 0) + amount;
}

function drop(state, frame, device, interfaceId, reason) {
  frame.dropReason = reason;
  incrementInterfaceCounter(device?.config?.interfaces?.[interfaceId] || {}, "framesDropped", 1);
  recordEvent(state, { type: "frame-drop", frame, deviceId: device?.id, interfaceId, reason });
  addFrameHistory(frame, { action: "drop", deviceId: device?.id, interfaceId, reason });
  return result("dropped", reason, frame);
}

function pushDrop(state, drops, frame, device, interfaceId, reason, record = true) {
  frame.dropReason = reason;
  const intf = device?.config?.interfaces?.[interfaceId];
  if (intf) {
    incrementInterfaceCounter(intf, "framesDropped", 1);
    if (reason === L2_DROP_REASONS.loopSafetyLimit) incrementInterfaceCounter(intf, "loopSafetyDrops", 1);
    if (reason === L2_DROP_REASONS.invalidSourceMac) incrementInterfaceCounter(intf, "invalidSourceMac", 1);
    if (reason === L2_DROP_REASONS.egressDown) incrementInterfaceCounter(intf, "unavailableEgressInterface", 1);
  }
  if (record) {
    recordEvent(state, { type: "frame-drop", frame, deviceId: device?.id, interfaceId, reason });
    addFrameHistory(frame, { action: "drop", deviceId: device?.id, interfaceId, reason });
  }
  drops.push({ frame, device, interfaceId, reason });
}

function recordEvent(state, event) {
  const data = {
    timestamp: Date.now(),
    type: event.type,
    frameId: event.frame?.id,
    sourceMac: event.frame?.sourceMac,
    destinationMac: event.frame?.destinationMac,
    vlan: event.frame?.vlanId,
    deviceId: event.deviceId,
    interfaceId: event.interfaceId,
    reason: event.reason || null
  };
  state.l2Events ||= [];
  state.l2Events.push(data);
  if (state.l2Events.length > MAX_L2_EVENT_HISTORY) state.l2Events.splice(0, state.l2Events.length - MAX_L2_EVENT_HISTORY);
  return data;
}

function result(status, reason, frame) {
  return { ok: status === "success", status, reason, frame };
}

class Layer2EventQueue {
  constructor(limit) { this.items = []; this.head = 0; this.limit = limit; }
  get length() { return this.items.length - this.head; }
  enqueue(event) {
    if (this.length >= this.limit) return false;
    this.items.push(event);
    return true;
  }
  dequeue() {
    const event = this.items[this.head++];
    if (this.head > 32 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return event;
  }
}

export { BROADCAST_MAC, DEFAULT_MAC_AGING_MS, formatMacForCisco, normalizeMacAddress };
