#!/usr/bin/env python3
"""gen_docs_server.py — Server-Modus: erzeugt die vier Fix-Struktur-Dokumente (Traktanden,
Entscheide, Briefings, Führungsrhythmus) über die gebrandete doc_template-Engine als Google-Doc
+ PDF in der Shared-Ablage, schreibt die server_*-IDs in die Stores und die PDF-Bytes ins Volume.
Läuft NUR im Server-Modus (DWD-Env). Dieters lokaler Betrieb bleibt unberührt (eigene Generatoren,
eigene Felder). Server fasst ausschließlich server_*-Felder an."""
import datetime as dt
import json
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "_tools"))

import yaml  # noqa: E402
from _lib import atomic_write, docs_dir  # noqa: E402
import _docmap as dmap  # noqa: E402
import doc_materialize as dm  # noqa: E402

log = logging.getLogger("rubicon.gendocs")
STAMP = dt.datetime.now().strftime("%d.%m.%Y %H:%M")

FOLDERS = {
    "traktanden": os.environ.get("RUBICON_DRIVE_TRAKTANDEN_FOLDER", "1hQ_9DP-NlwDSHr-pSAw0B5hXHC37mAYY"),
    "entscheide": os.environ.get("RUBICON_DRIVE_ENTSCHEIDE_FOLDER", "1wI2ggCw3erqeQ3HW2bcKxk4rg-zKo0rb"),
    "briefings": os.environ.get("RUBICON_DRIVE_BRIEFINGS_FOLDER", "1uopFGM23gaWQV_3CuHA3wRYT-Bei3VKa"),
    "fuehrungsrhythmus": os.environ.get("RUBICON_DRIVE_FR_FOLDER", "1pPACow-VB9UOZ8N2RDDqZGGExsnDznB1"),
}


def _is_server():
    return bool(os.environ.get("RUBICON_WORKSPACE_SA") and os.environ.get("RUBICON_IMPERSONATE_SUBJECT"))


def _data_dir(root):
    return os.environ.get("RUBICON_DATA_DIR") or os.path.join(str(root), "src", "data")


def _load(root, name):
    p = Path(_data_dir(root)) / name
    return json.loads(p.read_text()) if p.exists() else None


def _write(root, name, obj):
    atomic_write(str(Path(_data_dir(root)) / name), json.dumps(obj, ensure_ascii=False, indent=2))


def _vol_pdf(root, subdir, filename, pdf_bytes):
    """PDF ins Volume schreiben (App-Static-Handler bedient denselben Ort). Non-fatal — das Drive-PDF
    ist bereits hochgeladen; ein Volume-Schreibfehler darf den Lauf nicht kippen."""
    try:
        out = Path(docs_dir(subdir, root)) / filename
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(bytes(pdf_bytes))
    except Exception as ex:  # noqa: BLE001
        log.warning("volume pdf write %s/%s fehlgeschlagen: %s", subdir, filename, ex)


def _vol_png(root, subdir, filename, pdf_bytes):
    """Seite-1-PNG-Vorschau ins Volume (mirror gen_pdf_previews: fitz, ZOOM 2.0). Non-fatal —
    fitz kann lokal fehlen; ungueltige/leere PDF-Bytes duerfen den Lauf nicht kippen."""
    try:
        try:
            import pymupdf as fitz  # kanonischer Name; vermeidet die fitz-Deprecation
        except ImportError:
            import fitz  # PyMuPDF (aeltere Installationen)
        doc = fitz.open(stream=bytes(pdf_bytes), filetype="pdf")
        pix = doc[0].get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
        out = Path(docs_dir(subdir, root)) / filename
        out.parent.mkdir(parents=True, exist_ok=True)
        pix.save(str(out))
        doc.close()
    except Exception as ex:  # noqa: BLE001
        log.warning("volume png write %s/%s fehlgeschlagen: %s", subdir, filename, ex)


def _png_name(pdf_name):
    return pdf_name.rsplit(".", 1)[0] + ".png"


def _mat(drive, docs, typ, spec, prev_doc_id, prev_pdf_id):
    return dm.materialize(drive, docs, template_id=dm.template_id(typ), name=spec["name"],
                          folder_id=FOLDERS[typ], values=spec["values"],
                          tables=spec.get("tables"), bullets=spec.get("bullets"),
                          prev_doc_id=prev_doc_id, prev_pdf_id=prev_pdf_id)


def _server_fields(r, with_stand):
    f = {"server_doc_id": r["doc_id"], "server_doc_url": r["doc_url"],
         "server_pdf_id": r["pdf_id"], "server_pdf_url": r["pdf_url"]}
    if with_stand:
        f["stand"] = STAMP
    return f


def _do_entscheide(drive, docs, root):
    store = _load(root, "entscheide.json")
    if not store or not store.get("entscheide"):
        return 0
    results = {}  # id -> materialize-Ergebnis
    n = 0
    for e in store["entscheide"]:
        try:
            spec = dmap.entscheid_spec(e)
            exp = dict(e.get("export") or {})
            r = _mat(drive, docs, "entscheide", spec,
                     exp.get("server_doc_id"), exp.get("server_pdf_id"))
            _vol_pdf(root, "entscheide", spec["name"], r["pdf_bytes"])
            results[e.get("id")] = r
            n += 1
        except Exception as ex:  # noqa: BLE001
            log.warning("entscheid %s fehlgeschlagen: %s", e.get("id"), ex)
    if results:
        # Race-Schutz: Store FRISCH laden (Node-API schreibt entscheide.json live) und NUR die
        # export.server_*-Felder je id patchen. with_stand=False -> lokales export.stand unberührt.
        fresh = _load(root, "entscheide.json")
        if fresh is None:
            log.warning("entscheide.json beim Reload verschwunden — server_*-Patch uebersprungen")
        else:
            for e in fresh.get("entscheide", []):
                if not e.get("id") or e.get("id") not in results:   # falsy/unbekannte id skippen
                    continue
                exp = dict(e.get("export") or {})
                exp.update(_server_fields(results[e["id"]], with_stand=False))
                e["export"] = exp
            _write(root, "entscheide.json", fresh)
    return n


def _do_traktanden(drive, docs, root):
    store = _load(root, "traktanden.json")
    if not store or not store.get("agendas"):
        return 0
    idx = _load(root, "traktanden_docs.json") or {}
    n = 0
    for a in store["agendas"]:
        mid = a.get("meeting_id")
        try:
            spec = dmap.traktanden_spec(a)
            prev = idx.get(mid)
            prev_dict = prev if isinstance(prev, dict) else {}
            # Trash-Ziel NUR das vorherige SERVER-Doc — NIE der Alt-String (Dieters lokale Doc-ID).
            prev_doc = prev_dict.get("server_doc_id")
            prev_pdf = prev_dict.get("server_pdf_id")
            r = _mat(drive, docs, "traktanden", spec, prev_doc, prev_pdf)
            rec = _server_fields(r, with_stand=True)
            # Dieters lokale Doc-ID erhalten (nie trashen): Alt-String ODER prev_dict["doc_id"].
            local_doc = prev if isinstance(prev, str) else prev_dict.get("doc_id")
            if local_doc:
                rec["doc_id"] = local_doc
            idx[mid] = rec
            _vol_pdf(root, "traktanden", spec["name"], r["pdf_bytes"])
            n += 1
        except Exception as ex:  # noqa: BLE001
            log.warning("traktanden %s fehlgeschlagen: %s", mid, ex)
    _write(root, "traktanden_docs.json", idx)
    return n


def _do_fr(drive, docs, root):
    fr = _load(root, "fuehrungsrhythmus.json")
    if not fr:
        return 0
    if not FOLDERS["fuehrungsrhythmus"]:
        log.error("RUBICON_DRIVE_FR_FOLDER ungesetzt — FR-Doc wird NICHT erzeugt (kein stiller ok).")
        return "ENV_MISSING"
    prev = _load(root, "fuehrungsrhythmus_doc.json") or {}
    try:
        spec = dmap.fr_spec(fr)
        r = _mat(drive, docs, "fuehrungsrhythmus", spec,
                 prev.get("server_doc_id"), prev.get("server_pdf_id"))
        _write(root, "fuehrungsrhythmus_doc.json", _server_fields(r, with_stand=True))
        _vol_pdf(root, "", "fuehrungsrhythmus.pdf", r["pdf_bytes"])
        _vol_png(root, "", "fuehrungsrhythmus.png", r["pdf_bytes"])
        return 1
    except Exception as ex:  # noqa: BLE001
        log.warning("fuehrungsrhythmus fehlgeschlagen: %s", ex)
        return 0


def _do_briefings(drive, docs, root):
    ddir = _data_dir(root)
    yml = Path(ddir) / "projekt.yaml"
    bpath = Path(ddir) / "briefings.json"
    if not yml.exists() or not bpath.exists():
        return 0
    data = yaml.safe_load(yml.read_text())
    briefings = json.loads(bpath.read_text())
    idx = _load(root, "briefings_docs.json") or {}
    n = 0
    for ws in (data.get("workstreams") or []):
        ws_name = f"{ws.get('code')} — {ws.get('name')}"
        for m in (ws.get("milestones") or []):
            mid = m.get("id")
            try:
                b = briefings.get(mid) or {}
                spec = dmap.briefing_spec(m, b, ws_name)
                prev = idx.get(mid) or {}
                r = _mat(drive, docs, "briefings", spec,
                         prev.get("server_doc_id"), prev.get("server_pdf_id"))
                idx[mid] = _server_fields(r, with_stand=True)
                _vol_pdf(root, "briefings", spec["name"], r["pdf_bytes"])
                _vol_png(root, "briefings", _png_name(spec["name"]), r["pdf_bytes"])
                n += 1
            except Exception as ex:  # noqa: BLE001
                log.warning("briefing %s fehlgeschlagen: %s", mid, ex)
    _write(root, "briefings_docs.json", idx)
    return n


def run(drive, docs, root):
    per_typ = {
        "entscheide": _do_entscheide(drive, docs, root),
        "traktanden": _do_traktanden(drive, docs, root),
        "fuehrungsrhythmus": _do_fr(drive, docs, root),
        "briefings": _do_briefings(drive, docs, root),
    }
    log.info("gen_docs_server per_typ=%s stand=%s", per_typ, STAMP)
    return {"ok": True, "per_typ": per_typ}


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if not _is_server():
        log.info("nicht Server-Modus (DWD-Env fehlt) — gen_docs_server ist server-only, Abbruch.")
        return 0
    from googleapiclient.discovery import build
    from _google_auth import load_credentials
    creds = load_credentials()
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    docs = build("docs", "v1", credentials=creds, cache_discovery=False)
    root = os.environ.get("RUBICON_REPO_ROOT") or str(Path(__file__).resolve().parent.parent)
    res = run(drive, docs, root)
    log.info("done: %s", json.dumps(res.get("per_typ", {})))
    return 0


if __name__ == "__main__":
    sys.exit(main())
