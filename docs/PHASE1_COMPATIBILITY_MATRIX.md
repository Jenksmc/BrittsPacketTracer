# Phase 1 Connection Compatibility Matrix

This matrix documents the implemented Layer 1 connection palette and physical interface compatibility for Phase 1.

| Connection option | Compatible endpoint interfaces | Typical supported devices | Phase 1 behavior |
| --- | --- | --- | --- |
| Automatically Choose Connection Type | Any compatible free interface pair | All devices with available compatible ports | Selects a concrete cable and free ports; prefers copper straight-through for network-to-end-device Ethernet, crossover for same-class Ethernet, then fiber, serial, coax, phone, wireless, console, USB, or IoT where applicable. |
| Console cable | Console/AUX to RS-232 | Routers, switches, firewalls, access points, PCs, laptops, servers | Requires one console-style port and one RS-232 terminal port. |
| Copper straight-through | RJ-45 Ethernet to RJ-45 Ethernet | PCs, servers, routers, switches, hubs, firewalls, APs, modems | Validates both endpoints are copper Ethernet and ports are free. |
| Copper crossover | RJ-45 Ethernet to RJ-45 Ethernet | Same-class Ethernet endpoints such as switch-to-switch or PC-to-PC | Validates both endpoints are copper Ethernet and ports are free. |
| Fiber | SFP/fiber Ethernet to SFP/fiber Ethernet | Fiber uplinks, multilayer switch SFP-style uplinks | Validates both endpoints are fiber-capable. |
| Phone cable | RJ-11/phone to RJ-11/phone | DSL modem/cloud phone interfaces | Validates both endpoints are phone interfaces. |
| Coaxial cable | Coaxial to coaxial | Cable modem, cloud, cell tower coax | Validates both endpoints are coaxial interfaces. |
| Serial DCE | Serial to serial | Routers and WAN/cloud serial ports | Validates both endpoints are serial; records the selected DCE cable role. Clocking is reserved for Phase 2. |
| Serial DTE | Serial to serial | Routers and WAN/cloud serial ports | Validates both endpoints are serial; records the selected DTE cable role. Clocking is reserved for Phase 2. |
| USB | USB to USB | USB-capable routers, switches, PCs, laptops | Validates both endpoints are USB. Higher-level USB behavior is not modeled in Phase 1. |
| Octal cable | Console/AUX/RS-232 | Console management endpoints | Uses the same physical compatibility rules as console cabling for a single simulated endpoint pair. Multi-leg terminal-server breakout is reserved for later phases. |
| IoT custom cable | Digital/analog IoT signal to matching IoT signal | MCU, PLC, sensors, actuators, generic IoT | Validates both endpoints are IoT signal interfaces. |
| Wireless association | Wireless to wireless | Wireless routers, APs, laptops, phones, tablets, IoT devices | Creates a wireless association without occupying the wireless interface. Wireless protocol detail is reserved for later phases. |

## Device and port notes

- Device models now keep distinct physical port inventories rather than sharing a universal set.
- Existing Layer 3 configuration fields are preserved on interfaces.
- New physical metadata includes interface abbreviation, interface type, connector type, layer capabilities, speed, duplex, administrative/link state, VLAN defaults, cable connection, module dependency, and power state.
- Existing saved labs remain compatible; missing metadata is hydrated at runtime.

## Known Phase 1 limitations

- Link status still uses the existing up/down model plus compatibility status text; detailed speed/duplex negotiation is planned for Phase 2.
- Serial clock-rate enforcement is documented but not enforced until Phase 2.
- Multi-end octal breakout behavior and richer USB behavior are not modeled yet.
- Wireless association is represented as a compatible Layer 1 connection; SSID/security association logic is deferred to later wireless milestones.

## Phase 2 endpoint indicator model

The current indicator mapping is an internally consistent approximation and should not be treated as verified Packet Tracer parity. Exact Packet Tracer shape/color behavior still needs validation against Cisco Packet Tracer.

Priority order for endpoint state is:

1. Missing endpoint or port: disconnected.
2. Device power, module absence, or physical carrier down: physical down.
3. Administrative shutdown: administratively down.
4. Error-disabled or BPDU Guard err-disabled: error-disabled.
5. Cable/port mismatch: incompatibility.
6. EtherChannel state: bundled, suspended/incompatible, or standalone.
7. STP/RSTP state: blocking/discarding, listening/negotiating, learning, forwarding.
8. Cable role overlays: Serial DCE/DTE and wireless association.
9. Otherwise: physical link up / forwarding.

| Indicator | Meaning |
| --- | --- |
| Green triangle | Physical link up and forwarding/operational. |
| Amber diamond | Negotiating or STP listening. |
| Amber triangle | STP learning. |
| Purple blocked symbol | STP blocking or RSTP discarding. |
| Gray square | Administratively down. |
| Red triangle | Physical link down or failed. |
| Dark red alert | Error-disabled or BPDU Guard err-disabled. |
| Green `Po` badge | EtherChannel bundled member. |
| Amber `S` badge | EtherChannel suspended or incompatible member. |
| Teal `I` badge | EtherChannel standalone/individual member. |
| Gray circle | Cable disconnected at this end. |
| Red `×` | Cable or port incompatibility. |
| DCE/DTE badge | Serial role on the selected serial cable side. |
| Cyan wireless marker | Wireless association state. |
