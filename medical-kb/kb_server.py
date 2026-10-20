#!/usr/bin/env python3
"""A knowledge base service for the chat runtime.

The application retrieves records over the Dify external knowledge contract, so
this service answers that contract and nothing else:

    POST /api/retrieval
    {"knowledge_id": "postpartum", "query": "涨奶怎么办",
     "retrieval_setting": {"top_k": 5, "score_threshold": 0}}
    -> 200 {"records": [{"content": "...", "score": 0.83, "title": "..."}]}

It needs no third-party package. Documents live in `docs/<knowledge_id>/` and
the index is an in-memory BM25 that this process rebuilds at startup.

Run:
    python kb_server.py

Environment:
    PORT        listen port (default 5181)
    KB_DIR      corpus root (default ./docs next to this file)
    KB_API_KEY  when set, a request must send `Authorization: Bearer <key>`
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

CHUNK_SIZE = 400
CHUNK_OVERLAP = 80
MAX_BODY_BYTES = 1024 * 1024
DEFAULT_TOP_K = 5
# A chunk below this length is a label, not an answer, so it never becomes a
# record on its own.
MIN_CHUNK_CHARS = 24

# BM25 constants. The defaults suit short documents, which is what a care
# guideline corpus holds.
BM25_K1 = 1.5
BM25_B = 0.75

CJK_RUN = re.compile(r'[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+')
WORD = re.compile(r'[a-z0-9]+')
SENTENCE_END = re.compile(r'(?<=[。！？；!?;\n])')


def tokenize(text: str) -> list[str]:
    """Splits text into search terms.

    Chinese has no spaces, so a CJK run becomes its characters and its adjacent
    pairs. A pair carries the meaning ("涨奶"), and a single character keeps a
    one-character query findable.
    """
    lowered = text.lower()
    terms = [match.group(0) for match in WORD.finditer(lowered)]

    for run in CJK_RUN.findall(lowered):
        terms.extend(run)
        terms.extend(run[index:index + 2] for index in range(len(run) - 1))

    return terms


def chunk_text(text: str) -> list[tuple[str, str]]:
    """Splits one document into (heading, piece) pairs.

    A Markdown heading belongs to the text below it, so it becomes both the
    prefix of the pieces and their title. A heading on its own would be short,
    and a short chunk wins a BM25 match against the paragraph that holds the
    answer.
    """
    heading = ''
    paragraphs: list[str] = []
    sections: list[tuple[str, list[str]]] = []

    for block in re.split(r'\n\s*\n', text):
        stripped = block.strip()
        if not stripped:
            continue
        match = re.match(r'^(#{1,6})\s+(.*)$', stripped)
        if match:
            if paragraphs:
                sections.append((heading, paragraphs))
            heading = match.group(2).strip()
            paragraphs = []
            continue
        paragraphs.append(stripped)

    if paragraphs or heading:
        sections.append((heading, paragraphs))

    pieces: list[tuple[str, str]] = []
    for section_heading, section_paragraphs in sections:
        for piece in chunk_paragraphs('\n\n'.join(section_paragraphs)):
            if len(piece) < MIN_CHUNK_CHARS:
                continue
            content = f'{section_heading}\n\n{piece}' if section_heading else piece
            pieces.append((section_heading, content))

    return pieces


def chunk_paragraphs(text: str) -> list[str]:
    """Splits text into pieces that a single prompt can hold."""
    paragraphs = [part.strip() for part in re.split(r'\n\s*\n', text) if part.strip()]
    chunks: list[str] = []

    for paragraph in paragraphs:
        if len(paragraph) <= CHUNK_SIZE:
            chunks.append(paragraph)
            continue

        sentences = [part for part in SENTENCE_END.split(paragraph) if part.strip()]
        current = ''
        for sentence in sentences:
            if current and len(current) + len(sentence) > CHUNK_SIZE:
                chunks.append(current.strip())
                # Keep the tail so a sentence that straddles two chunks stays
                # findable from either side.
                current = (current[-CHUNK_OVERLAP:] + sentence) if CHUNK_OVERLAP else sentence
            else:
                current += sentence
        if current.strip():
            chunks.append(current.strip())

    return chunks


class Chunk:
    __slots__ = ('content', 'title', 'terms')

    def __init__(self, content: str, title: str) -> None:
        self.content = content
        self.title = title
        self.terms = tokenize(content)


class BM25Index:
    """Ranks chunks by how well their terms match a query."""

    def __init__(self, chunks: list[Chunk]) -> None:
        self.chunks = chunks
        self.doc_freq: dict[str, int] = {}
        self.frequencies: list[dict[str, int]] = []
        self.lengths: list[int] = []

        for chunk in chunks:
            counts: dict[str, int] = {}
            for term in chunk.terms:
                counts[term] = counts.get(term, 0) + 1
            self.frequencies.append(counts)
            self.lengths.append(len(chunk.terms))
            for term in counts:
                self.doc_freq[term] = self.doc_freq.get(term, 0) + 1

        total = sum(self.lengths)
        self.average_length = (total / len(self.lengths)) if self.lengths else 0.0
        self.total_documents = len(self.lengths)
        self.idf = {
            term: math.log(1 + (self.total_documents - count + 0.5) / (count + 0.5))
            for term, count in self.doc_freq.items()
        }

    def search(self, query: str, top_k: int) -> list[tuple[int, float]]:
        query_terms = set(tokenize(query))
        if not query_terms or not self.chunks:
            return []

        # A query term that appears in no document adds nothing to coverage, so
        # a query full of filler words does not distort the scale.
        query_weight = sum(self.idf.get(term, 0.0) for term in query_terms) or 1.0

        scored: list[tuple[int, float]] = []
        for index, counts in enumerate(self.frequencies):
            length = self.lengths[index] or 1
            score = 0.0
            matched_weight = 0.0
            for term in query_terms:
                frequency = counts.get(term)
                if not frequency:
                    continue
                idf = self.idf.get(term, 0.0)
                matched_weight += idf
                denominator = frequency + BM25_K1 * (1 - BM25_B + BM25_B * length / (self.average_length or 1))
                score += idf * frequency * (BM25_K1 + 1) / denominator
            if score <= 0:
                continue

            # BM25 alone rewards a chunk that repeats one rare term. The answer
            # usually covers more of the question, so the share of the query
            # weight that this chunk matched scales the score.
            coverage = matched_weight / query_weight
            scored.append((index, score * coverage))

        scored.sort(key=lambda item: item[1], reverse=True)
        return scored[:max(1, top_k)]


def load_corpora(root: Path) -> dict[str, BM25Index]:
    """Indexes every document under `root/<knowledge_id>/`."""
    corpora: dict[str, BM25Index] = {}
    if not root.is_dir():
        return corpora

    for directory in sorted(path for path in root.iterdir() if path.is_dir()):
        chunks: list[Chunk] = []
        for path in sorted(directory.rglob('*')):
            if path.suffix.lower() not in ('.md', '.txt'):
                continue
            try:
                text = path.read_text(encoding='utf-8')
            except OSError as error:
                print(f'skip {path}: {error}', file=sys.stderr)
                continue
            for position, (heading, piece) in enumerate(chunk_text(text), start=1):
                title = f'{path.stem} · {heading}' if heading else f'{path.stem} · 第{position}段'
                chunks.append(Chunk(piece, title))

        corpora[directory.name] = BM25Index(chunks)
        print(f'indexed {directory.name}: {len(chunks)} chunks')

    return corpora


class Handler(BaseHTTPRequestHandler):
    server_version = 'medical-kb/1.0'
    corpora: dict[str, BM25Index] = {}
    api_key = ''

    def log_message(self, format: str, *args: object) -> None:
        sys.stderr.write('%s %s\n' % (self.log_date_time_string(), format % args))

    def _send(self, status: int, payload: dict, origin: str | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._cors(origin)
        self.end_headers()
        self.wfile.write(body)

    def _cors(self, origin: str | None) -> None:
        # The application runs on another origin, so every answer needs the
        # CORS headers, including the preflight answer.
        self.send_header('Access-Control-Allow-Origin', origin or '*')
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Max-Age', '600')

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors(self.headers.get('Origin'))
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path not in ('/health', '/api/health'):
            self._send(404, {'error_code': 404, 'error_msg': f'unknown path {path}'}, self.headers.get('Origin'))
            return

        self._send(200, {
            'ok': True,
            'knowledge_bases': {name: len(index.chunks) for name, index in self.corpora.items()},
        }, self.headers.get('Origin'))

    def do_POST(self) -> None:
        origin = self.headers.get('Origin')
        path = urlparse(self.path).path

        if path == '/reload':
            self.corpora = load_corpora(Path(os.environ.get('KB_DIR') or Path(__file__).parent / 'docs'))
            self._send(200, {'ok': True, 'knowledge_bases': {n: len(i.chunks) for n, i in self.corpora.items()}}, origin)
            return

        if path not in ('/api/retrieval', '/retrieval'):
            self._send(404, {'error_code': 404, 'error_msg': f'unknown path {path}'}, origin)
            return

        if self.api_key:
            authorization = self.headers.get('Authorization') or ''
            if authorization.strip() != f'Bearer {self.api_key}':
                self._send(401, {'error_code': 1002, 'error_msg': 'invalid api key'}, origin)
                return

        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send(422, {'error_code': 1003, 'error_msg': 'missing or oversized body'}, origin)
            return

        try:
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            self._send(422, {'error_code': 1003, 'error_msg': f'invalid json: {error}'}, origin)
            return
        if not isinstance(payload, dict):
            self._send(422, {'error_code': 1003, 'error_msg': 'body must be a json object'}, origin)
            return

        knowledge_id = str(payload.get('knowledge_id') or '').strip()
        query = str(payload.get('query') or '').strip()
        if not knowledge_id or not query:
            self._send(422, {'error_code': 1003, 'error_msg': 'knowledge_id and query are required'}, origin)
            return

        setting = payload.get('retrieval_setting') if isinstance(payload.get('retrieval_setting'), dict) else {}
        top_k = setting.get('top_k')
        top_k = int(top_k) if isinstance(top_k, (int, float)) and top_k > 0 else DEFAULT_TOP_K
        threshold = setting.get('score_threshold')
        threshold = float(threshold) if isinstance(threshold, (int, float)) else 0.0

        index = self.corpora.get(knowledge_id)
        if index is None:
            # A logical failure comes back with HTTP 200 and an error code, which
            # is what the contract asks for.
            self._send(200, {
                'error_code': 2001,
                'error_msg': f'knowledge base "{knowledge_id}" not found, available: {", ".join(sorted(self.corpora)) or "none"}',
            }, origin)
            return

        hits = index.search(query, top_k)
        best = hits[0][1] if hits else 0.0
        records = []
        for chunk_index, score in hits:
            # The contract exposes a similarity, so the top hit becomes 1.0 and
            # the rest keep their order below it.
            normalized = round(score / best, 4) if best > 0 else 0.0
            if normalized < threshold:
                continue
            chunk = index.chunks[chunk_index]
            records.append({'content': chunk.content, 'score': normalized, 'title': chunk.title})

        self._send(200, {'records': records}, origin)


def main() -> None:
    root = Path(os.environ.get('KB_DIR') or Path(__file__).parent / 'docs')
    port = int(os.environ.get('PORT') or 5181)

    Handler.corpora = load_corpora(root)
    Handler.api_key = (os.environ.get('KB_API_KEY') or '').strip()

    server = ThreadingHTTPServer(('0.0.0.0', port), Handler)
    print(f'knowledge base service on http://localhost:{port}/api/retrieval')
    print(f'corpus root: {root}')
    if not Handler.corpora:
        print('warning: no knowledge base found; add documents under docs/<knowledge_id>/', file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('stopped')


if __name__ == '__main__':
    main()
