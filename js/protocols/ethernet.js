export const BROADCAST_MAC = "ff:ff:ff:ff:ff:ff";
export const DEFAULT_ETHERTYPE = "0x0800";
export const DEFAULT_MAC_AGING_MS = 300000;
export const DEFAULT_FRAME_HOP_LIMIT = 64;

const HEX_MAC = /^[0-9a-f]{12}$/i;
const OCTET_MAC = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i;

export function normalizeMacAddress(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  let compact = raw;
  if (raw.includes(".")) compact = raw.replace(/\./g, "");
  else compact = raw.replace(/[:-]/g, "");
  if (!HEX_MAC.test(compact)) return null;
  return compact.match(/../g).join(":");
}

export function isValidMacAddress(value) {
  return normalizeMacAddress(value) !== null;
}

export function macEquals(a, b) {
  const left = normalizeMacAddress(a), right = normalizeMacAddress(b);
  return left !== null && left === right;
}

export function isBroadcastMac(value) {
  return normalizeMacAddress(value) === BROADCAST_MAC;
}

export function isMulticastMac(value) {
  const mac = normalizeMacAddress(value);
  if (!mac || isBroadcastMac(mac)) return false;
  return (parseInt(mac.slice(0, 2), 16) & 1) === 1;
}

export function isUnicastMac(value) {
  const mac = normalizeMacAddress(value);
  return !!mac && !isBroadcastMac(mac) && !isMulticastMac(mac);
}

export function stableMacFromSeed(seed) {
  const text = String(seed || "BrittsPacketTracer");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const bytes = [0x02];
  for (let i = 0; i < 5; i++) {
    hash ^= i + text.length;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    bytes.push(hash & 0xff);
  }
  return bytes.map(b => b.toString(16).padStart(2, "0")).join(":");
}

export function stableDeviceMac(device) {
  return stableMacFromSeed(`device:${device?.id || device?.name || "unknown"}`);
}

export function stableInterfaceMac(device, interfaceName) {
  return stableMacFromSeed(`interface:${device?.id || device?.name || "unknown"}:${interfaceName || ""}`);
}

export function createEthernetFrame(options = {}) {
  const sourceMac = normalizeMacAddress(options.sourceMac || options.srcMac);
  const destinationMac = normalizeMacAddress(options.destinationMac || options.dstMac);
  const payload = options.payload ?? "";
  const payloadSize = typeof payload === "string" ? payload.length : JSON.stringify(payload).length;
  const vlanId = normalizeVlanId(options.vlanId ?? options.vlan);
  const frame = {
    id: options.id || `frame-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    sourceMac,
    destinationMac,
    etherType: options.etherType || DEFAULT_ETHERTYPE,
    payload,
    size: Math.max(64, 14 + payloadSize + (vlanId ? 4 : 0) + 4),
    vlan: vlanId,
    vlanId,
    dot1q: options.dot1q || (vlanId ? { vlanId, pcp: options.pcp || 0, dei: 0 } : null),
    pcp: options.pcp || 0,
    dropReason: options.dropReason || null,
    fcsValid: options.fcsValid !== false,
    createdAt: options.createdAt || Date.now(),
    ingressDeviceId: options.ingressDeviceId || null,
    ingressInterfaceId: options.ingressInterfaceId || null,
    currentDeviceId: options.currentDeviceId || options.ingressDeviceId || null,
    currentInterfaceId: options.currentInterfaceId || options.ingressInterfaceId || null,
    forwardingHistory: Array.isArray(options.forwardingHistory) ? [...options.forwardingHistory] : [],
    events: Array.isArray(options.events) ? [...options.events] : [],
    metadata: options.metadata || {},
    hopCount: options.hopCount || 0,
    traversalBudget: options.traversalBudget || DEFAULT_FRAME_HOP_LIMIT
  };
  frame.isBroadcast = isBroadcastMac(frame.destinationMac);
  frame.isMulticast = isMulticastMac(frame.destinationMac);
  frame.isUnicast = isUnicastMac(frame.destinationMac);
  return frame;
}

export function cloneEthernetFrame(frame, patch = {}) {
  return createEthernetFrame({
    ...frame,
    ...patch,
    forwardingHistory: [...(frame.forwardingHistory || []), ...(patch.forwardingHistory || [])],
    events: [...(frame.events || []), ...(patch.events || [])],
    metadata: { ...(frame.metadata || {}), ...(patch.metadata || {}) },
    id: patch.id || frame.id
  });
}

export function addFrameHistory(frame, event) {
  const entry = { timestamp: Date.now(), ...event };
  frame.forwardingHistory.push(entry);
  frame.events.push(entry);
  return entry;
}

export function normalizeVlanId(value) {
  const n = Number(value || 1);
  return Number.isInteger(n) && n >= 1 && n <= 4094 ? n : 1;
}

export function formatMacForCisco(value) {
  const mac = normalizeMacAddress(value);
  if (!mac) return String(value || "");
  const compact = mac.replace(/:/g, "");
  return `${compact.slice(0, 4)}.${compact.slice(4, 8)}.${compact.slice(8)}`;
}
