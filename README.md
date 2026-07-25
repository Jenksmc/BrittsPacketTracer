# BrittsPacketTracer

A browser-based, light-theme networking simulator designed for GitHub Pages.

## Version 2 highlights

- Packet Tracer-inspired light interface
- Expanded device catalog grouped by category
- Device illustrations instead of text symbols
- Devices can be repositioned after placement
- Movable, resizable, pinnable device windows
- Physical, Config, Desktop, CLI, Services, and GUI tabs based on device type
- PC and laptop IP Configuration and Command Prompt tools
- Cisco interface abbreviations such as `fa0/1`, `gi0/1`, and `s0/0/0`
- Reusable Ethernet frame model, centralized Layer 2 forwarding, MAC learning/aging, VLAN-scoped flooding/forwarding, hub repeat behavior, and MAC table CLI/UI inspection
- Foundations in the saved device model for VLANs, STP, EtherChannel, DHCP, DNS, NAT, ACLs, OSPF, RIP, EIGRP, BGP, IPv6, wireless, physical modules, and services

## GitHub Pages

Publish from the `main` branch and `/(root)` folder.

## Important scope note

The expanded UI and data model prepare the project for the full protocol roadmap. Complete protocol behavior, packet-level inspection, physical module compatibility, and automatic CCNA grading require additional engine milestones and are not represented as finished in this version.

Phase 3 intentionally does not include full trunk configuration, DTP, native VLAN behavior, STP/RSTP, EtherChannel, full ARP integration, packet animations, or complete simulation-mode UI.
