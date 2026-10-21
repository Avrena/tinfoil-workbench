#!/bin/sh
set -eu
# Docker uses these prefixes only for broker-owned bridges. Block host access,
# private/LAN/metadata destinations and communication between workspaces.
iptables -N TW-EGRESS 2>/dev/null || true
iptables -F TW-EGRESS
for cidr in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/4 240.0.0.0/4; do
  iptables -A TW-EGRESS -d "$cidr" -j DROP
done
iface=$(ip -4 route show default | awk 'NR==1 { print $5 }')
test -n "$iface"
iptables -A TW-EGRESS ! -o "$iface" -j DROP
iptables -A TW-EGRESS -j RETURN
iptables -N DOCKER-USER 2>/dev/null || true
iptables -C DOCKER-USER -i wb+ -j TW-EGRESS 2>/dev/null || iptables -I DOCKER-USER 1 -i wb+ -j TW-EGRESS
iptables -C INPUT -i wb+ -j DROP 2>/dev/null || iptables -I INPUT 1 -i wb+ -j DROP
