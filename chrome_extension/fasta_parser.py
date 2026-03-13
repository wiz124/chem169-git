#!/usr/bin/env python3
"""
fasta_parser.py — standalone FASTA parser for the Delayed Button Clicker extension.

Usage examples
--------------
# Print all sequence names + lengths
python fasta_parser.py sequences.fasta

# Output a specific sequence by index (0-based) as plain text
python fasta_parser.py sequences.fasta --index 0 --mode sequence

# Output all sequences in FASTA format, line-wrapped at 60 chars
python fasta_parser.py sequences.fasta --mode fasta

# Output all raw sequences, newline-separated (for pasting into a textarea)
python fasta_parser.py sequences.fasta --mode newline

# Output all sequences concatenated into one string
python fasta_parser.py sequences.fasta --mode concat

# Write output to a file instead of stdout
python fasta_parser.py sequences.fasta --mode newline --out payload.txt
"""

from __future__ import annotations
import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class FastaRecord:
    header: str           # full header line (without '>')
    sequence: str         # upper-cased, whitespace-stripped sequence

    @property
    def name(self) -> str:
        """First whitespace-delimited token of the header."""
        return self.header.split()[0] if self.header else ""

    @property
    def description(self) -> str:
        """Everything after the first token."""
        parts = self.header.split(None, 1)
        return parts[1] if len(parts) > 1 else ""

    @property
    def length(self) -> int:
        return len(self.sequence)

    def wrapped(self, width: int = 60) -> str:
        """Return sequence wrapped at *width* characters per line."""
        return "\n".join(self.sequence[i:i + width] for i in range(0, self.length, width))

    def to_fasta(self, width: int = 60) -> str:
        return f">{self.header}\n{self.wrapped(width)}"

    def __repr__(self) -> str:  # pragma: no cover
        return f"FastaRecord(name={self.name!r}, length={self.length})"


# ---------------------------------------------------------------------------
# IUPAC character set (DNA, RNA, protein, gaps, stop)
# ---------------------------------------------------------------------------

_VALID_SEQ_RE = re.compile(
    r"^[ACDEFGHIKLMNPQRSTVWYBZXJUORYKSWMBDHVN\-\.\*]+$", re.IGNORECASE
)


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

def parse_fasta(source: str | Path) -> list[FastaRecord]:
    """
    Parse a FASTA file (or a multi-line string) and return a list of
    :class:`FastaRecord` objects.

    Parameters
    ----------
    source:
        A filesystem path (``str`` or ``pathlib.Path``) **or** a raw FASTA
        string (detected by the absence of newlines in a ``str`` that is also
        not an existing path).

    Returns
    -------
    list[FastaRecord]
        One record per ``>`` header found in the input.

    Raises
    ------
    FileNotFoundError
        If *source* looks like a path but the file does not exist.
    ValueError
        If the file / string contains no valid FASTA records.
    """
    text = _read_source(source)
    records = list(_iter_records(text))
    if not records:
        raise ValueError("No valid FASTA records found in the input.")
    return records


def _read_source(source: str | Path) -> str:
    """Load text from a file path or return the raw string."""
    if isinstance(source, Path) or (isinstance(source, str) and "\n" not in source):
        path = Path(source)
        if path.exists():
            return path.read_text(encoding="utf-8", errors="replace")
        elif isinstance(source, Path):
            raise FileNotFoundError(f"File not found: {source}")
    # Treat as a raw FASTA string
    return source  # type: ignore[return-value]


def _iter_records(text: str) -> Iterator[FastaRecord]:
    """Yield FastaRecord objects from a FASTA-formatted string."""
    current_header: str | None = None
    seq_lines: list[str] = []

    for raw_line in text.splitlines():
        line = raw_line.strip()

        if not line or line.startswith(";"):
            continue  # blank lines and FASTA comment lines

        if line.startswith(">"):
            if current_header is not None:
                record = _build_record(current_header, seq_lines)
                if record:
                    yield record
            current_header = line[1:].strip()
            seq_lines = []
        else:
            if current_header is None:
                continue  # sequence data before any header — skip
            cleaned = line.replace(" ", "").replace("\t", "").upper()
            if _VALID_SEQ_RE.match(cleaned):
                seq_lines.append(cleaned)
            # silently skip invalid lines (e.g. quality scores, numbers)

    # flush last record
    if current_header is not None:
        record = _build_record(current_header, seq_lines)
        if record:
            yield record


def _build_record(header: str, seq_lines: list[str]) -> FastaRecord | None:
    sequence = "".join(seq_lines)
    if not sequence:
        return None
    return FastaRecord(header=header, sequence=sequence)


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def build_payload(records: list[FastaRecord], mode: str, index: int = 0) -> str:
    """
    Build the text payload that will be injected into the browser text field.

    Parameters
    ----------
    records : list[FastaRecord]
        Parsed FASTA records.
    mode : str
        One of ``"sequence"``, ``"newline"``, ``"fasta"``, ``"concat"``.
    index : int
        Used only when *mode* is ``"sequence"``; selects which record.
    """
    if mode == "sequence":
        if index < 0 or index >= len(records):
            raise IndexError(f"Index {index} is out of range (0–{len(records)-1}).")
        return records[index].sequence

    if mode == "newline":
        return "\n".join(r.sequence for r in records)

    if mode == "fasta":
        return "\n".join(r.to_fasta() for r in records)

    if mode == "concat":
        return "".join(r.sequence for r in records)

    raise ValueError(f"Unknown mode: {mode!r}. Choose from sequence, newline, fasta, concat.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Parse FASTA files for the Delayed Button Clicker Chrome extension.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("fasta_file", help="Path to the .fasta / .fa file")
    p.add_argument(
        "--mode", "-m",
        choices=["summary", "sequence", "newline", "fasta", "concat"],
        default="summary",
        help=(
            "summary   – print names, lengths (default)\n"
            "sequence  – single sequence (use --index to choose)\n"
            "newline   – all sequences, newline-separated\n"
            "fasta     – all sequences in FASTA format\n"
            "concat    – all sequences joined into one string"
        ),
    )
    p.add_argument(
        "--index", "-i",
        type=int,
        default=0,
        help="0-based sequence index (used with --mode sequence)",
    )
    p.add_argument(
        "--out", "-o",
        type=Path,
        default=None,
        help="Write output to this file instead of stdout",
    )
    p.add_argument(
        "--wrap", "-w",
        type=int,
        default=60,
        help="Line-wrap width for FASTA output (default: 60)",
    )
    return p


def main(argv: list[str] | None = None) -> None:
    args = _build_parser().parse_args(argv)

    try:
        records = parse_fasta(args.fasta_file)
    except (FileNotFoundError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    if args.mode == "summary":
        print(f"{'#':<6}  {'Name':<30}  {'Length':>8}  {'Description'}")
        print("-" * 70)
        for i, rec in enumerate(records):
            desc = rec.description[:40] + ("…" if len(rec.description) > 40 else "")
            print(f"{i:<6}  {rec.name:<30}  {rec.length:>8}  {desc}")
        print(f"\nTotal: {len(records)} sequences")
        return

    try:
        payload = build_payload(records, args.mode, args.index)
    except (IndexError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    if args.out:
        args.out.write_text(payload, encoding="utf-8")
        print(f"Wrote {len(payload):,} characters to {args.out}", file=sys.stderr)
    else:
        print(payload)


if __name__ == "__main__":
    main()
