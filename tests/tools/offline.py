"""Jalankan perintah tanpa jaringan: network namespace baru (unshare -n) yang hanya punya loopback.

Pakai: unshare -n python3 tests/tools/offline.py <perintah> [argumen...]
Di namespace baru loopback mati; Chrome dan server lokal HyperFrames butuh 127.0.0.1, jadi dinyalakan dulu.
"""
import fcntl
import os
import socket
import struct
import sys

SIOCGIFFLAGS, SIOCSIFFLAGS, IFF_UP = 0x8913, 0x8914, 0x1
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
flags = struct.unpack("16sH", fcntl.ioctl(s, SIOCGIFFLAGS, struct.pack("16sH", b"lo", 0)))[1]
fcntl.ioctl(s, SIOCSIFFLAGS, struct.pack("16sH", b"lo", flags | IFF_UP))
s.close()
os.execvp(sys.argv[1], sys.argv[1:])
