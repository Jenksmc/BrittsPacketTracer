# Architecture

css/
js/
  engine/
  cli/
  protocols/
  devices/
  ui/
  labs/
assets/
labs/
docs/

This structure is intended to scale to a Packet Tracer-sized project.

## Phase 1 and Phase 2 verification summary

Phase 1 is implemented and regression-tested for the connection palette, cable legend, automatic cable selection, manual compatible-port display, endpoint attachment while devices move, multiple parallel links, port occupancy, and save/load of physical endpoint selections. The authoritative physical interface objects live in `device.config.interfaces` and are hydrated by `hydrateDeviceInterfaces()` from `js/engine/connections.js`.

Phase 2 is partially implemented. Administrative state, physical link state, power changes, shutdown/no shutdown, device-specific port inventories, interface parsing, and CLI/GUI use of the same interface objects are implemented. Speed/duplex capability metadata and negotiation validation now exist for Ethernet-like links, but complete Packet Tracer parity for all speed/duplex edge cases remains follow-up work.

Blocking issues corrected for Phase 3:

- New device/interface MAC addresses are stable from the device/interface seed instead of random per creation path.
- Interface hydration now ensures Layer 2 counters and MAC-table state exist on loaded projects.
- Link validation now initializes module presence and validates negotiated speed/duplex for Ethernet-like links.
- Save/export schema version 3 persists static MAC entries and drops dynamic MAC-learning/event state so it can be rebuilt through traffic after load.

Nonblocking limitations:

- Serial clocking, wireless SSID/security association, rich module inventory, and exact Packet Tracer endpoint marker parity remain incomplete.
- Full Cisco parity for trunk negotiation edge cases, STP/RSTP topology calculation, EtherChannel negotiation protocols, ARP protocol timing, and simulation-mode UI remains future work.

## Phase 3 Layer 2 architecture

`js/protocols/ethernet.js` defines the reusable Ethernet frame and MAC utility layer. It normalizes common MAC formats to lowercase colon notation, classifies unicast/multicast/broadcast destinations, generates stable locally administered MAC addresses, stores optional VLAN/802.1Q metadata, and tracks forwarding history, drop reasons, FCS state, timestamps, ingress/current locations, and event metadata.

`js/engine/switching.js` is the shared frame transmission path. `transmitFrame()` validates an operational ingress interface, resolves the attached connection, delivers the frame hop by hop through an event queue, updates interface counters, and returns structured deliveries/drops/events. Hubs repeat frames to every other eligible operational port without learning. Switches and bridges learn source MACs per VLAN, perform known-unicast forwarding, unknown-unicast flooding, broadcast flooding, multicast flooding foundation behavior, and never transmit back through the ingress interface. Router and end-device Ethernet interfaces accept only their own unicast, broadcast, or multicast frames and do not bridge routed interfaces.

Each switch/bridge owns its own `device.config.macTable`. Entries include MAC address, VLAN, interface, type, learned/last-seen timestamps, static/dynamic status, and a secure placeholder. Dynamic entries age deterministically through `ageMacTable()` using `device.config.macAgingTimeMs` (default 300 seconds). Static entries do not age out.

VLAN forwarding supports access ports, trunk ports, native VLAN configuration, allowed VLAN lists, and DTP-style `dynamic auto` / `dynamic desirable` state. MAC learning, known-unicast lookup, unknown-unicast flooding, multicast flooding, and broadcast flooding are scoped to the ingress VLAN. Frame metadata includes optional 802.1Q tag fields for future packet inspection and richer trunk visualization.

STP/RSTP support currently models explicit per-port forwarding states. Ports in blocking, discarding, listening, or learning states do not forward Layer 2 traffic. Full bridge ID/root election/topology recalculation is not implemented yet.

EtherChannel support currently models configured channel groups by forwarding on a deterministic representative member and suppressing duplicate member forwarding. Full LACP/PAgP negotiation is not implemented yet.

Basic ARP integration sends ARP requests and replies as Ethernet frames before IPv4 ping traffic and updates the existing ARP table with learned mappings. Full ARP timers, gratuitous ARP, and proxy ARP remain future work.

Loop safety is enforced by a traversal budget and bounded event queue. When the safety limit is reached, the frame is dropped with `loop-safety-limit`; this is simulator protection, not STP.

## CLI and UI integration

Switching-capable devices expose MAC-table state through the real forwarding table:

- `show mac address-table`
- `show mac address-table dynamic`
- `show mac address-table static`
- `show mac address-table interface <interface>`
- `show mac address-table vlan <vlan-id>`
- `clear mac address-table dynamic`
- `clear mac address-table dynamic interface <interface>`
- `clear mac address-table dynamic vlan <vlan-id>`
- `mac address-table static <mac> vlan <vlan-id> interface <interface>`
- `no mac address-table static <mac> vlan <vlan-id> interface <interface>`
- `switchport mode access|trunk|dynamic auto|dynamic desirable`
- `switchport trunk native vlan <vlan-id>`
- `switchport trunk allowed vlan <list|add <list>|remove <list>|all|none>`
- `spanning-tree mode pvst|rapid-pvst|rstp`
- `spanning-tree port-state forwarding|blocking|listening|learning|discarding`
- `channel-group <id> mode on|active|passive|desirable|auto`
- `show spanning-tree`
- `show etherchannel summary`

The device window adds a Switching tab for switches, multilayer switches, and bridges. It reads the same `device.config.macTable` and recent `state.l2Events` used by the engine and can clear dynamic entries.

The topology SVG renders lightweight packet markers from recent Layer 2 forwarding events. These markers are intentionally simple activity indicators rather than the full Packet Tracer simulation-mode animation system.

## Save schema

Version 3 saves devices, interfaces, stable interface MAC addresses, links, VLAN/access/trunk/native/allowed VLAN configuration, DTP mode, STP/RSTP mode and port states, EtherChannel groups, MAC aging configuration, ARP table state, and static MAC entries. Dynamic MAC entries and recent frame events are deliberately not persisted; they are rebuilt through new traffic after loading.
