"""The pages an instruction links to, read before the writer runs.

The method researches a project URL when one is given. The links come from
the freelancer's instruction, and the server fetches them, so every hop is
checked: http(s) only, and a host that resolves to a public address, never
loopback, private, link-local (the cloud metadata service) or reserved.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup

LINK = re.compile(r"https?://[^\s<>\"'`)\]]+", re.IGNORECASE)
MAX_PAGES = 3
MAX_BYTES = 2_000_000
MAX_CHARS = 12_000
MAX_REDIRECTS = 4
TIMEOUT = httpx.Timeout(10.0, connect=5.0)
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; PhoeniX proposal research)",
    "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
}


@dataclass(frozen=True, slots=True)
class Page:
    url: str
    title: str = ""
    text: str = ""
    # Why the page could not be read; empty when it was.
    problem: str = ""


def links(instruction: str) -> list[str]:
    """The distinct links in an instruction, in order, trailing punctuation dropped."""
    found: list[str] = []
    for match in LINK.findall(instruction or ""):
        url = match.rstrip(".,;:!?")
        if url not in found:
            found.append(url)
    return found[:MAX_PAGES]


async def read_pages(urls: list[str]) -> list[Page]:
    async with httpx.AsyncClient(timeout=TIMEOUT, headers=HEADERS, follow_redirects=False) as client:
        return list(await asyncio.gather(*(_read(client, url) for url in urls)))


async def _read(client: httpx.AsyncClient, url: str) -> Page:
    target = url
    try:
        for _ in range(MAX_REDIRECTS + 1):
            problem = await _refused(target)
            if problem:
                return Page(url=url, problem=problem)
            async with client.stream("GET", target) as response:
                if response.is_redirect and response.headers.get("location"):
                    target = urljoin(target, response.headers["location"])
                    continue
                if response.status_code >= 400:
                    return Page(url=url, problem=f"the site answered {response.status_code}")
                kind = response.headers.get("content-type", "")
                if kind and not any(t in kind for t in ("html", "text/plain", "xml")):
                    return Page(url=url, problem=f"not a web page ({kind.split(';')[0]})")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_BYTES:
                        break
                return _page(url, bytes(body), response.encoding or "utf-8", plain="text/plain" in kind)
        return Page(url=url, problem="too many redirects")
    except httpx.HTTPError as exc:
        return Page(url=url, problem=f"could not be reached ({type(exc).__name__})")


async def _refused(url: str) -> str:
    """Why this URL may not be fetched, or empty when it may."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return "not an http(s) link"
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(
            parts.hostname, parts.port or (443 if parts.scheme == "https" else 80), type=socket.SOCK_STREAM
        )
    except socket.gaierror:
        return "the host does not resolve"
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if not address.is_global or address.is_multicast:
            return "a private or local address"
    return ""


def _page(url: str, body: bytes, encoding: str, *, plain: bool) -> Page:
    raw = body.decode(encoding, errors="replace")
    if plain:
        return Page(url=url, text=_squash(raw)[:MAX_CHARS])
    soup = BeautifulSoup(raw, "lxml")
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    description = soup.find("meta", attrs={"name": "description"}) or soup.find(
        "meta", attrs={"property": "og:description"}
    )
    for noise in soup(["script", "style", "noscript", "svg", "iframe", "template"]):
        noise.decompose()
    body_text = _squash(soup.get_text("\n"))
    summary = str(description.get("content") or "").strip() if description else ""
    text = f"{summary}\n\n{body_text}" if summary and summary not in body_text else body_text
    if not text.strip():
        return Page(url=url, title=title, problem="the page shows no text without JavaScript")
    return Page(url=url, title=title[:200], text=text[:MAX_CHARS])


def _squash(text: str) -> str:
    lines = (" ".join(line.split()) for line in text.splitlines())
    return "\n".join(line for line in lines if line)
