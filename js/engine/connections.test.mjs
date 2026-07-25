import assert from "node:assert/strict";
import { DEVICE_TYPES, defaultDevice } from "./network.js";
import { attachDeviceDefinitions, canConnectPorts, selectAutomaticConnection } from "./connections.js";

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

console.log("connections.test.mjs passed");
