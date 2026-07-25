import assert from "node:assert/strict";
import { CLI } from "../cli/cli.js";
import { DEVICE_TYPES, computeLinkStates, defaultDevice } from "./network.js";
import { attachDeviceDefinitions, canConnectPorts, validateLink } from "./connections.js";
import { addStaticMacEntry, clearDynamicMacEntries, learnSourceMac, lookupMacEntry, transmitFrame } from "./switching.js";
import { BROADCAST_MAC, createEthernetFrame, isBroadcastMac, isMulticastMac, isUnicastMac, normalizeMacAddress } from "../protocols/ethernet.js";

function devices(...types) {
  const list = types.map((type, index) => defaultDevice(type, `d${index}`, 0, 0, index + 1));
  attachDeviceDefinitions(list, DEVICE_TYPES);
  return list;
}

function link(state, a, aPort, b, bPort, id = `l${state.links.length + 1}`) {
  const cableType = "copperStraightThrough";
  state.links.push({ id, cableType, resolvedCableType: cableType, a: { deviceId: a.id, port: aPort }, b: { deviceId: b.id, port: bPort }, up: false });
  a.config.interfaces[aPort].connectedLinkId = id;
  b.config.interfaces[bPort].connectedLinkId = id;
  a.config.interfaces[aPort].cableConnection = id;
  b.config.interfaces[bPort].cableConnection = id;
}

{
  assert.equal(normalizeMacAddress("0011.2233.4455"), "00:11:22:33:44:55");
  assert.equal(normalizeMacAddress("00-11-22-33-44-55"), "00:11:22:33:44:55");
  assert.equal(normalizeMacAddress("001122334455"), "00:11:22:33:44:55");
  assert.equal(isBroadcastMac(BROADCAST_MAC), true);
  assert.equal(isMulticastMac("01:00:5e:00:00:01"), true);
  assert.equal(isUnicastMac("00:11:22:33:44:55"), true);
}

{
  const frame = createEthernetFrame({ sourceMac: "0011.2233.4455", destinationMac: BROADCAST_MAC, payload: "hello", vlanId: 10 });
  assert.ok(frame.id);
  assert.equal(frame.sourceMac, "00:11:22:33:44:55");
  assert.equal(frame.isBroadcast, true);
  assert.equal(frame.vlanId, 10);
  assert.equal(frame.payload, "hello");
  assert.ok(frame.size >= 64);
}

{
  const [sw] = devices("switch2960");
  const first = learnSourceMac(sw, "00:11:22:33:44:55", 1, "FastEthernet0/1", 1000);
  assert.equal(first.interfaceId, "FastEthernet0/1");
  const refreshed = learnSourceMac(sw, "00:11:22:33:44:55", 1, "FastEthernet0/2", 2000);
  assert.equal(refreshed.interfaceId, "FastEthernet0/2");
  assert.equal(refreshed.lastSeenAt, 2000);
  learnSourceMac(sw, BROADCAST_MAC, 1, "FastEthernet0/3");
  assert.equal(sw.config.macTable.length, 1);
  addStaticMacEntry(sw, "00:aa:bb:cc:dd:ee", 20, "FastEthernet0/4", 3000);
  assert.equal(lookupMacEntry(sw, "00:aa:bb:cc:dd:ee", 20).type, "STATIC");
  clearDynamicMacEntries(sw);
  assert.equal(sw.config.macTable.length, 1);
}

{
  const [pc1, sw, pc2] = devices("pc", "switch2960", "pc");
  const state = { devices: [pc1, sw, pc2], links: [] };
  link(state, pc1, "FastEthernet0", sw, "FastEthernet0/1");
  link(state, sw, "FastEthernet0/2", pc2, "FastEthernet0");
  computeLinkStates(state);
  const result = transmitFrame(state, pc1.id, "FastEthernet0", { destinationMac: pc2.config.interfaces.FastEthernet0.mac, payload: "unknown-unicast" });
  assert.equal(result.deliveries.some(d => d.device.id === pc2.id), true);
  assert.equal(lookupMacEntry(sw, pc1.config.interfaces.FastEthernet0.mac, 1).interfaceId, "FastEthernet0/1");
  assert.equal(sw.config.interfaces["FastEthernet0/1"].counters.framesReceived, 1);
  const known = transmitFrame(state, pc2.id, "FastEthernet0", { destinationMac: pc1.config.interfaces.FastEthernet0.mac, payload: "known-unicast" });
  assert.equal(known.deliveries.some(d => d.device.id === pc1.id), true);
  assert.equal(known.events.filter(e => e.type === "frame-arrival" && e.deviceId === pc1.id).length, 1);
}

{
  const [pc1, sw, pc2] = devices("pc", "switch2960", "pc");
  const state = { devices: [pc1, sw, pc2], links: [] };
  pc2.config.interfaces.FastEthernet0.vlan = 20;
  sw.config.interfaces["FastEthernet0/2"].vlan = 20;
  link(state, pc1, "FastEthernet0", sw, "FastEthernet0/1");
  link(state, sw, "FastEthernet0/2", pc2, "FastEthernet0");
  computeLinkStates(state);
  const result = transmitFrame(state, pc1.id, "FastEthernet0", { destinationMac: BROADCAST_MAC, payload: "broadcast" });
  assert.equal(result.deliveries.some(d => d.device.id === pc2.id), false);
}

{
  const [pc1, hub, pc2] = devices("pc", "hub", "pc");
  const state = { devices: [pc1, hub, pc2], links: [] };
  link(state, pc1, "FastEthernet0", hub, "Port1");
  link(state, hub, "Port2", pc2, "FastEthernet0");
  computeLinkStates(state);
  const result = transmitFrame(state, pc1.id, "FastEthernet0", { destinationMac: pc2.config.interfaces.FastEthernet0.mac, payload: "hub-repeat" });
  assert.equal(result.deliveries.some(d => d.device.id === pc2.id), true);
  assert.equal(hub.config.macTable.length, 0);
}

{
  const [pc1, router, pc2] = devices("pc", "router1941", "pc");
  const state = { devices: [pc1, router, pc2], links: [] };
  router.config.interfaces["GigabitEthernet0/0"].shutdown = false;
  router.config.interfaces["GigabitEthernet0/1"].shutdown = false;
  link(state, pc1, "FastEthernet0", router, "GigabitEthernet0/0");
  link(state, router, "GigabitEthernet0/1", pc2, "FastEthernet0");
  computeLinkStates(state);
  const result = transmitFrame(state, pc1.id, "FastEthernet0", { destinationMac: pc2.config.interfaces.FastEthernet0.mac, payload: "not-bridged" });
  assert.equal(result.deliveries.some(d => d.device.id === pc2.id), false);
  assert.equal(result.drops.some(d => d.reason === "router-unrelated-unicast"), true);
}

{
  const [pc, sw] = devices("pc", "switch2960");
  const state = { devices: [pc, sw], links: [] };
  link(state, pc, "FastEthernet0", sw, "FastEthernet0/1");
  computeLinkStates(state);
  sw.config.interfaces["FastEthernet0/1"].speed = "1G";
  assert.equal(validateLink(state, state.links[0]).ok, false);
  assert.match(validateLink(state, state.links[0]).reason, /Speed mismatch/);
  assert.equal(canConnectPorts("fiber", pc, pc.config.interfaces.FastEthernet0, sw, sw.config.interfaces["FastEthernet0/1"]).ok, false);
}

{
  const [sw] = devices("switch2960");
  const cli = new CLI({ devices: [sw], links: [] }, sw, null);
  cli.mode = "config";
  assert.equal(cli.execute("mac address-table static 0011.2233.4455 vlan 1 interface fa0/1"), "");
  cli.mode = "privileged";
  assert.match(cli.execute("show mac address-table static"), /0011\.2233\.4455/);
  assert.match(cli.execute("show mac address-table interface fa0\/1"), /Fa|Fast|0011/);
  assert.match(cli.execute("clear mac address-table dynamic"), /0 dynamic/);
}

{
  const [pc1, sw, pc2] = devices("pc", "switch2960", "pc");
  const state = { devices: [pc1, sw, pc2], links: [] };
  link(state, pc1, "FastEthernet0", sw, "FastEthernet0/1");
  link(state, sw, "FastEthernet0/2", pc2, "FastEthernet0");
  computeLinkStates(state);
  const result = transmitFrame(state, pc1.id, "FastEthernet0", { destinationMac: pc2.config.interfaces.FastEthernet0.mac, traversalBudget: 1 });
  assert.equal(result.drops.some(d => d.reason === "loop-safety-limit"), true);
}

console.log("switching.test.mjs passed");
