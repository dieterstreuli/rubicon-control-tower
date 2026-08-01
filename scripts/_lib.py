#!/usr/bin/env python3
"""_lib.py — gemeinsame Helfer der Python-Pipeline (Q6, 01.08.2026).

`_atomic_write` lag 4× kopiert in den Scripts, `e()`/`de()`/`pdate()` mehrfach.
Hier stehen sie einmal; die Scripts importieren sie.
"""
import datetime as dt
import html
import os
import re


def atomic_write(path, text):
    """Atomarer Schreibvorgang (Audit #8): temp + os.replace — nie truncated."""
    tmp = f'{path}.tmp.{os.getpid()}'
    with open(tmp, 'w') as f:
        f.write(text)
    os.replace(tmp, path)


def e(s):
    """HTML-escape; None → leer."""
    return html.escape(str(s if s is not None else ''))


def pdate(s):
    """ISO-String → date, sonst None (nie raten)."""
    try:
        return dt.date.fromisoformat(str(s).strip())
    except Exception:  # noqa: BLE001
        return None


def de(s):
    """ISO-String → TT.MM.JJJJ; unlesbar → Original bzw. Gedankenstrich."""
    d = pdate(s)
    if d:
        return d.strftime('%d.%m.%Y')
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', str(s or ''))
    return f'{m.group(3)}.{m.group(2)}.{m.group(1)}' if m else (s or '—')
