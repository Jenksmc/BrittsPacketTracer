import assert from "node:assert/strict";
import { DEVICE_TYPES, defaultDevice } from "./network.js";
import { CLI } from "../cli/cli.js";
import { abbreviateInterfaceName, attachDeviceDefinitions, canConnectPorts, endpointIndicatorFor, normalizeInterfaceName, parallelLinkOffsets, resolveInterface, routeConnectionPath, selectAutomaticConnection } from "./connections.js";

function devices(...types) {
  const list = types.map((type, index) => defaultDevice(type, `d${index}`, 0, 0, index + 1));
  attachDeviceDefinitions(list, DEVICE_TYPES);
  return list;
}

{
  const [pc, sw] = devices("pc", "switch2960");
  const choice = selectAutomaticConnection(pc, sw);
  assert.equal(choice.ok, true);
  assert.equal(choice.cableType, "copperStraightThrough");
  assert.equal(choice.aPort.name, "FastEthernet0");
  assert.equal(choice.bPort.name, "FastEthernet0/1");
}

{
  const [sw1, sw2] = devices("switch2960", "switch2960");
  const choice = selectAutomaticConnection(sw1, sw2);
  assert.equal(choice.ok, true);
  assert.equal(choice.cableType, "copperCrossover");
}

{
  const [pc, router] = devices("pc", "router1941");
  const result = canConnectPorts("console", pc, pc.config.interfaces.RS232, router, router.config.interfaces.Console);
  assert.equal(result.ok, true);
}

{
  const [pc, router] = devices("pc", "router1941");
  const result = canConnectPorts("fiber", pc, pc.config.interfaces.FastEthernet0, router, router.config.interfaces["GigabitEthernet0/0"]);
  assert.equal(result.ok, false);
  assert.match(result.reason, /does not accept Fiber/);
}

{
  const [laptop, phone] = devices("laptop", "smartphone");
  const choice = selectAutomaticConnection(laptop, phone);
  assert.equal(choice.ok, true);
  assert.equal(choice.cableType, "wirelessAssociation");
}

assert.equal(abbreviateInterfaceName("TenGigabitEthernet1/1/1"), "Te1/1/1");
assert.equal(abbreviateInterfaceName("Port-channel1"), "Po1");
assert.equal(normalizeInterfaceName("FastEthernet 0/1"), "fa0/1");
assert.equal(normalizeInterfaceName("Fa 0/1"), "fa0/1");
assert.equal(normalizeInterfaceName("GigabitEthernet0/1"), "gi0/1");
assert.equal(normalizeInterfaceName("Te 1/1/1"), "te1/1/1");
assert.equal(normalizeInterfaceName("Vlan10"), "vl10");

{
  const [sw] = devices("switch2960");
  assert.equal(resolveInterface(sw.config.interfaces, "fastethernet 0/1"), "FastEthernet0/1");
  assert.equal(resolveInterface(sw.config.interfaces, "fa0/1"), "FastEthernet0/1");
  assert.equal(resolveInterface(sw.config.interfaces, "gi0/1"), "GigabitEthernet0/1");
  assert.equal(resolveInterface(sw.config.interfaces, "te0/1"), null);
}

{
  const [sw] = devices("switch2960");
  const cli = new CLI({ devices: [sw], links: [] }, sw, null);
  cli.mode = "privileged";
  assert.match(cli.execute("show interface fa0/1"), /FastEthernet0\/1 is/);
  assert.match(cli.execute("show interfaces fastethernet 0\/1"), /FastEthernet0\/1 is/);
  assert.equal(cli.execute("show interface te0/1"), "% Invalid interface type and number");
  cli.mode = "config";
  assert.equal(cli.execute("interface fastethernet 0/1"), "");
  assert.equal(cli.currentInterface, "FastEthernet0/1");
}

{
  const [a, b] = devices("switch2960", "switch2960");
  a.x = 100; a.y = 100; b.x = 420; b.y = 180;
  const state = { devices: [a, b], links: [
    { id: "l1", cableType: "copperCrossover", resolvedCableType: "copperCrossover", a: { deviceId: a.id, port: "FastEthernet0/1" }, b: { deviceId: b.id, port: "FastEthernet0/1" }, up: true },
    { id: "l2", cableType: "copperCrossover", resolvedCableType: "copperCrossover", a: { deviceId: a.id, port: "FastEthernet0/2" }, b: { deviceId: b.id, port: "FastEthernet0/2" }, up: true },
    { id: "l3", cableType: "copperCrossover", resolvedCableType: "copperCrossover", a: { deviceId: a.id, port: "FastEthernet0/3" }, b: { deviceId: b.id, port: "FastEthernet0/3" }, up: true }
  ]};
  const offsets = parallelLinkOffsets(state.links);
  assert.deepEqual([...offsets.values()], [-18, 0, 18]);
  const before = routeConnectionPath(state.links[0], state, { offset: offsets.get("l1") });
  a.x += 80; a.y += 40;
  const after = routeConnectionPath(state.links[0], state, { offset: offsets.get("l1") });
  assert.notEqual(before.path, after.path);
  assert.equal(offsets.get("l1"), parallelLinkOffsets(state.links).get("l1"));
  const exported = JSON.parse(JSON.stringify(state));
  assert.equal(exported.devices[0].x, 180);
  assert.equal(exported.links.length, 3);
}

{
  const [a, b] = devices("switch2960", "switch2960");
  const link = { id: "l1", cableType: "copperCrossover", resolvedCableType: "copperCrossover", a: { deviceId: a.id, port: "FastEthernet0/1" }, b: { deviceId: b.id, port: "FastEthernet0/1" }, up: true };
  a.config.interfaces["FastEthernet0/1"].linkState = "up";
  a.config.interfaces["FastEthernet0/1"].stpState = "blocking";
  assert.equal(endpointIndicatorFor({ devices: [a, b] }, link, "a").key, "blocking");
  a.config.interfaces["FastEthernet0/1"].stpState = "forwarding";
  a.config.interfaces["FastEthernet0/1"].etherChannelState = "bundled";
  assert.equal(endpointIndicatorFor({ devices: [a, b] }, link, "a").key, "bundled");
  a.config.interfaces["FastEthernet0/1"].shutdown = true;
  assert.equal(endpointIndicatorFor({ devices: [a, b] }, link, "a").key, "adminDown");
  link.a = { deviceId: null, port: null };
  assert.equal(endpointIndicatorFor({ devices: [a, b] }, link, "a").key, "disconnected");
}

console.log("connections.test.mjs passed");
