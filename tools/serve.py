#!/usr/bin/env python3
"""Local dev server for Gunport that tells the browser never to cache.

Python's plain `http.server` lets browsers reuse JavaScript modules they have
already loaded, so after editing Phosphor3D or the game a normal reload can
quietly run the old code. This server marks every response `no-store`.

It serves the folder that contains both Gunport/ and Phosphor3D/, so run it
from anywhere:

    python3 Gunport/tools/serve.py          # then open http://localhost:8123/Gunport/
    python3 Gunport/tools/serve.py 9000     # different port

It listens on this machine only, on both IPv4 (127.0.0.1) and IPv6 (::1),
because browsers may try either one for "localhost". It refuses to start if
something else is already using the port.
"""
import socket
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]   # .../Claude (holds Gunport/ and Phosphor3D/)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class IPv6Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6

    def server_bind(self):
        # Only ::1 on this socket; IPv4 gets its own server below.
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        super().server_bind()


def port_in_use(port):
    """True if anything at all is already accepting connections on this port."""
    for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        with socket.socket(family, socket.SOCK_STREAM) as probe:
            probe.settimeout(0.5)
            if probe.connect_ex((host, port)) == 0:
                return True
    return False


if __name__ == "__main__":
    if port_in_use(PORT):
        sys.exit(f"Port {PORT} is already in use -- probably another server from earlier.\n"
                 f"Stop it (Ctrl+C in its terminal window), or pick another port:\n"
                 f"    python3 {sys.argv[0]} 8124")

    handler = partial(NoCacheHandler, directory=str(ROOT))
    servers = [ThreadingHTTPServer(("127.0.0.1", PORT), handler)]
    try:
        servers.append(IPv6Server(("::1", PORT), handler))
    except OSError:
        pass   # No IPv6 loopback on this machine; IPv4 alone is fine.

    for server in servers[1:]:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"Serving {ROOT} -- open http://localhost:{PORT}/Gunport/  (Ctrl+C to stop)")
    try:
        servers[0].serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for server in servers:
            server.server_close()
