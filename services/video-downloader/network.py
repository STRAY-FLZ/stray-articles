"""Loopback egress proxy: validate every connection, including redirected media.

DNS answers are checked and a checked IPv4 address is used directly, preventing
DNS rebinding. HTTPS remains end-to-end TLS; no certificates are intercepted.
"""
import ipaddress
import select
import socket
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit


class UnsafeAddress(ValueError):
    pass


def public_addresses(host, port, resolver=socket.getaddrinfo):
    if not host or len(host) > 253 or any(c in host for c in "\r\n\x00/@\\"):
        raise UnsafeAddress("Invalid destination")
    # IPv4 only: no mapped addresses, transition mechanisms or link-local zones.
    answers = resolver(host, port, socket.AF_INET, socket.SOCK_STREAM)
    addresses = []
    for answer in answers:
        ip = ipaddress.ip_address(answer[4][0])
        if ip.version != 4 or not ip.is_global or ip.is_multicast or ip.is_reserved:
            raise UnsafeAddress("Private destination blocked")
        if str(ip) not in addresses:
            addresses.append(str(ip))
    if not addresses:
        raise UnsafeAddress("Destination has no public IPv4 address")
    return addresses


def connect_public(host, port):
    addresses = public_addresses(host, port)
    last_error = None
    for address in addresses:
        try:
            return socket.create_connection((address, port), timeout=15)
        except OSError as error:
            last_error = error
    raise last_error or UnsafeAddress("Connection failed")


class GuardedProxy(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *_args):
        # URLs can contain expiring platform tokens. Never log them.
        pass

    def relay(self, upstream):
        peers = [self.connection, upstream]
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            readable, _, _ = select.select(peers, [], [], 2)
            for peer in readable:
                chunk = peer.recv(65536)
                if not chunk:
                    return
                other = upstream if peer is self.connection else self.connection
                other.sendall(chunk)
                deadline = time.monotonic() + 90

    def do_CONNECT(self):
        upstream = None
        try:
            target = urlsplit("//" + self.path)
            if target.port != 443 or target.username or target.password or target.path or target.query or target.fragment:
                raise UnsafeAddress("Only HTTPS tunnels are allowed")
            upstream = connect_public(target.hostname, 443)
            self.send_response(200, "Connection established")
            self.end_headers()
            self.wfile.flush()
            self.relay(upstream)
        except (ValueError, OSError):
            if upstream is None:
                self.send_error(403, "Destination unavailable or blocked")
        finally:
            if upstream:
                upstream.close()
            self.close_connection = True

    def forward(self):
        upstream = None
        try:
            target = urlsplit(self.path)
            if target.scheme != "http" or target.port not in (None, 80) or target.username or target.password or target.fragment:
                raise UnsafeAddress("Only public HTTP destinations are allowed")
            if self.headers.get("Transfer-Encoding") or int(self.headers.get("Content-Length", "0")) > 1024 * 1024:
                raise UnsafeAddress("Request too large")
            upstream = connect_public(target.hostname, 80)
            request_path = target.path or "/"
            if target.query:
                request_path += "?" + target.query
            headers = [f"{self.command} {request_path} HTTP/1.0", f"Host: {target.hostname}", "Connection: close"]
            forbidden = {"host", "connection", "proxy-connection", "proxy-authorization", "keep-alive", "upgrade"}
            headers.extend(f"{k}: {v}" for k, v in self.headers.items() if k.lower() not in forbidden)
            upstream.sendall(("\r\n".join(headers) + "\r\n\r\n").encode("latin-1"))
            length = int(self.headers.get("Content-Length", "0"))
            if length:
                upstream.sendall(self.rfile.read(length))
            while chunk := upstream.recv(65536):
                self.wfile.write(chunk)
        except (ValueError, OSError):
            if upstream is None:
                self.send_error(403, "Destination unavailable or blocked")
        finally:
            if upstream:
                upstream.close()
            self.close_connection = True

    do_GET = forward
    do_HEAD = forward
    do_POST = forward


@contextmanager
def egress_proxy():
    server = ThreadingHTTPServer(("127.0.0.1", 0), GuardedProxy)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
