"""TLS Client Hello Desynchronization & DoH Resolver.
Bypasses ISP SNI / DPI inspection transparently without VPN or external daemons.
"""

import json
import logging
import socket
import ssl
import time
import urllib.parse
import urllib.request

from ..config import HI_UA

logger = logging.getLogger("aninyom.desync")

_DNS_CACHE = {}


def resolve_host(host: str) -> str:
    """Resolve hostname to IPv4 using System DNS with Cloudflare/Google DoH fallback."""
    if not host:
        return host
    if host in _DNS_CACHE:
        return _DNS_CACHE[host]

    # Check if host is already an IP
    parts = host.split(".")
    if len(parts) == 4 and all(p.isdigit() for p in parts):
        _DNS_CACHE[host] = host
        return host

    # 1. System DNS
    try:
        ip = socket.gethostbyname(host)
        if (
            ip
            and not ip.startswith("10.")
            and not ip.startswith("127.")
            and not ip.startswith("192.168.")
        ):
            _DNS_CACHE[host] = ip
            return ip
    except Exception:
        pass

    # 2. Cloudflare & Google DoH
    for doh_url in ("https://1.1.1.1/dns-query", "https://dns.google/resolve"):
        try:
            req = urllib.request.Request(
                f"{doh_url}?name={host}&type=A",
                headers={"Accept": "application/dns-json", "User-Agent": HI_UA},
            )
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    for ans in data.get("Answer", []):
                        if ans.get("type") == 1 and ans.get("data"):
                            ip = ans["data"]
                            _DNS_CACHE[host] = ip
                            return ip
        except Exception:
            pass

    return host


def tls_desync_connect(host: str, port: int = 443, timeout: float = 8.0):
    """Open a TLS socket with Client Hello split into two valid TLS records."""
    ip = resolve_host(host)
    raw_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    raw_sock.settimeout(timeout)
    raw_sock.connect((ip, port))
    raw_sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    in_bio, out_bio = ssl.MemoryBIO(), ssl.MemoryBIO()
    sslobj = ctx.wrap_bio(in_bio, out_bio, server_hostname=host)

    try:
        sslobj.do_handshake()
    except ssl.SSLWantReadError:
        pass

    b = out_bio.read()
    if len(b) > 10:
        # Split Client Hello into 2 records
        rec1 = b[:3] + b"\x00\x01" + b[5:6]
        rec2_data = b[6:]
        rec2 = b[:3] + len(rec2_data).to_bytes(2, "big") + rec2_data

        raw_sock.sendall(rec1)
        time.sleep(0.04)  # 40ms TCP record separation
        raw_sock.sendall(rec2)
    else:
        raw_sock.sendall(b)

    start_t = time.time()
    while time.time() - start_t < timeout:
        d = raw_sock.recv(8192)
        if not d:
            break
        in_bio.write(d)
        try:
            sslobj.do_handshake()
            if out_bio.pending:
                raw_sock.sendall(out_bio.read())
            break
        except ssl.SSLWantWriteError:
            raw_sock.sendall(out_bio.read())
        except ssl.SSLWantReadError:
            if out_bio.pending:
                raw_sock.sendall(out_bio.read())

    return raw_sock, sslobj, in_bio, out_bio


def tls_desync_request(url: str, headers: dict | None = None, timeout: float = 10.0) -> bytes:
    """Send HTTP GET request via desync TLS socket and return bytes."""
    p = urllib.parse.urlsplit(url)
    host = p.netloc.split(":")[0]
    port = p.port or 443
    path = p.path or "/"
    if p.query:
        path += "?" + p.query

    raw_sock, sslobj, in_bio, out_bio = tls_desync_connect(host, port, timeout=timeout)

    h_lines = [
        f"GET {path} HTTP/1.1",
        f"Host: {host}",
        f"User-Agent: {HI_UA}",
        "Accept: */*",
        "Connection: close",
    ]
    if headers:
        for k, v in headers.items():
            if k.lower() not in ("host", "connection"):
                h_lines.append(f"{k}: {v}")

    req_data = "\r\n".join(h_lines) + "\r\n\r\n"
    sslobj.write(req_data.encode("utf-8"))
    raw_sock.sendall(out_bio.read())

    resp_raw = b""
    raw_sock.settimeout(timeout)
    while True:
        try:
            d = raw_sock.recv(16384)
            if not d:
                break
            in_bio.write(d)
            while True:
                try:
                    chunk = sslobj.read(16384)
                    if not chunk:
                        break
                    resp_raw += chunk
                except (ssl.SSLWantReadError, ssl.SSLZeroReturnError):
                    break
        except Exception:
            break

    try:
        raw_sock.close()
    except Exception:
        pass

    idx = resp_raw.find(b"\r\n\r\n")
    if idx >= 0:
        return resp_raw[idx + 4 :]
    return resp_raw
