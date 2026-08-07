#!/usr/bin/env python3
"""gen_docs_server.py — Server-Modus: erzeugt die vier Fix-Struktur-Dokumente (Traktanden,
Entscheide, Briefings, Führungsrhythmus) über die gebrandete doc_template-Engine als Google-Doc
+ PDF in der Shared-Ablage, schreibt die server_*-IDs in die Stores und die PDF-Bytes ins Volume.
Läuft NUR im Server-Modus (DWD-Env). Dieters lokaler Betrieb bleibt unberührt (eigene Generatoren,
eigene Felder). Server fasst ausschließlich server_*-Felder an."""
import datetime as dt
import hashlib
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


def _force():
    """RUBICON_DOCS_FORCE gesetzt -> Hash-Gating aus, alles neu rendern. Noetig, wenn der Quell-
    Hash die Aenderung NICHT sieht: (a) Vorlagen-INHALT geaendert (gleiche template_id); (b) ein
    Server-Doc wurde extern getrasht/geloescht (Quell-Hash matcht -> wuerde sonst dauerhaft
    uebersprungen, der Store-Link dinge ins Leere) -> FORCE-Lauf erzeugt es neu."""
    return bool(os.environ.get("RUBICON_DOCS_FORCE"))


def _render_hash(template_id, spec):
    """Stabiler Content-Hash der Render-Eingaben (Vorlagen-ID + Spec = values/tables/bullets).
    Aendert sich NUR, wenn sich die Quelldaten oder die Vorlagen-ID aendern -> Grundlage fuers
    inkrementelle Ueberspringen. Der `stand`-Zeitstempel geht NICHT ein (steht nur im Store-
    Record) — unveraenderte Daten behalten ihren alten Stand (korrekt, das Doc aenderte sich nicht)."""
    blob = json.dumps({"t": template_id, "s": spec}, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def _skip(prev, h):
    """True -> Item unveraendert + Server-Doc existiert -> ueberspringen (nicht rendern).
    FORCE hebt das auf. `prev` = bisheriger Store-Record (dict) oder {}."""
    return (not _force()) and prev.get("server_hash") == h and bool(prev.get("server_doc_id"))


def _do_entscheide(drive, docs, root):
    store = _load(root, "entscheide.json")
    if not store or not store.get("entscheide"):
        return {"rendered": 0, "skipped": 0}
    th = dm.template_id("entscheide")
    results = {}  # id -> {"r": materialize-Ergebnis, "h": render_hash}
    rendered = skipped = 0
    for e in store["entscheide"]:
        try:
            spec = dmap.entscheid_spec(e)
            h = _render_hash(th, spec)
            exp0 = e.get("export") or {}
            if _skip(exp0, h):                      # unveraendert + Doc existiert -> ueberspringen
                skipped += 1
                continue
            r = _mat(drive, docs, "entscheide", spec,
                     exp0.get("server_doc_id"), exp0.get("server_pdf_id"))
            _vol_pdf(root, "entscheide", spec["name"], r["pdf_bytes"])
            results[e.get("id")] = {"r": r, "h": h}
            rendered += 1
        except Exception as ex:  # noqa: BLE001
            log.warning("entscheid %s fehlgeschlagen: %s", e.get("id"), ex)
    if results:
        # Race-Schutz: Store FRISCH laden (Node-API schreibt entscheide.json live) und NUR die
        # export.server_*/server_hash-Felder je id patchen. with_stand=False -> lokales export.stand unberührt.
        fresh = _load(root, "entscheide.json")
        if fresh is None:
            log.warning("entscheide.json beim Reload verschwunden — server_*-Patch uebersprungen")
        else:
            for e in fresh.get("entscheide", []):
                if not e.get("id") or e.get("id") not in results:   # falsy/unbekannte id skippen
                    continue
                exp = dict(e.get("export") or {})
                exp.update(_server_fields(results[e["id"]]["r"], with_stand=False))
                exp["server_hash"] = results[e["id"]]["h"]
                e["export"] = exp
            _write(root, "entscheide.json", fresh)
    log.info("entscheide rendered=%d skipped=%d", rendered, skipped)
    return {"rendered": rendered, "skipped": skipped}


def _do_traktanden(drive, docs, root):
    store = _load(root, "traktanden.json")
    if not store or not store.get("agendas"):
        return {"rendered": 0, "skipped": 0}
    th = dm.template_id("traktanden")
    idx = _load(root, "traktanden_docs.json") or {}
    rendered = skipped = 0
    for a in store["agendas"]:
        mid = a.get("meeting_id")
        try:
            spec = dmap.traktanden_spec(a)
            h = _render_hash(th, spec)
            prev = idx.get(mid)
            prev_dict = prev if isinstance(prev, dict) else {}
            if _skip(prev_dict, h):                 # unveraendert + Server-Doc existiert -> ueberspringen
                skipped += 1
                continue
            # Trash-Ziel NUR das vorherige SERVER-Doc — NIE der Alt-String (Dieters lokale Doc-ID).
            prev_doc = prev_dict.get("server_doc_id")
            prev_pdf = prev_dict.get("server_pdf_id")
            r = _mat(drive, docs, "traktanden", spec, prev_doc, prev_pdf)
            rec = _server_fields(r, with_stand=True)
            rec["server_hash"] = h
            # Dieters lokale Doc-ID erhalten (nie trashen): Alt-String ODER prev_dict["doc_id"].
            local_doc = prev if isinstance(prev, str) else prev_dict.get("doc_id")
            if local_doc:
                rec["doc_id"] = local_doc
            idx[mid] = rec
            _vol_pdf(root, "traktanden", spec["name"], r["pdf_bytes"])
            rendered += 1
        except Exception as ex:  # noqa: BLE001
            log.warning("traktanden %s fehlgeschlagen: %s", mid, ex)
    _write(root, "traktanden_docs.json", idx)
    log.info("traktanden rendered=%d skipped=%d", rendered, skipped)
    return {"rendered": rendered, "skipped": skipped}


def _do_fr(drive, docs, root):
    fr = _load(root, "fuehrungsrhythmus.json")
    if not fr:
        return {"rendered": 0, "skipped": 0}
    if not FOLDERS["fuehrungsrhythmus"]:
        log.error("RUBICON_DRIVE_FR_FOLDER ungesetzt — FR-Doc wird NICHT erzeugt (kein stiller ok).")
        return "ENV_MISSING"
    prev = _load(root, "fuehrungsrhythmus_doc.json") or {}
    try:
        spec = dmap.fr_spec(fr)
        h = _render_hash(dm.template_id("fuehrungsrhythmus"), spec)
        if _skip(prev, h):                          # unveraendert + Doc existiert -> ueberspringen
            log.info("fuehrungsrhythmus rendered=0 skipped=1")
            return {"rendered": 0, "skipped": 1}
        r = _mat(drive, docs, "fuehrungsrhythmus", spec,
                 prev.get("server_doc_id"), prev.get("server_pdf_id"))
        rec = _server_fields(r, with_stand=True)
        rec["server_hash"] = h
        _write(root, "fuehrungsrhythmus_doc.json", rec)
        _vol_pdf(root, "", "fuehrungsrhythmus.pdf", r["pdf_bytes"])
        _vol_png(root, "", "fuehrungsrhythmus.png", r["pdf_bytes"])
        return {"rendered": 1, "skipped": 0}
    except Exception as ex:  # noqa: BLE001
        log.warning("fuehrungsrhythmus fehlgeschlagen: %s", ex)
        return {"rendered": 0, "skipped": 0}


def _do_briefings(drive, docs, root):
    ddir = _data_dir(root)
    yml = Path(ddir) / "projekt.yaml"
    bpath = Path(ddir) / "briefings.json"
    if not yml.exists() or not bpath.exists():
        return {"rendered": 0, "skipped": 0}
    data = yaml.safe_load(yml.read_text())
    briefings = json.loads(bpath.read_text())
    th = dm.template_id("briefings")
    idx = _load(root, "briefings_docs.json") or {}
    rendered = skipped = 0
    for ws in (data.get("workstreams") or []):
        ws_name = f"{ws.get('code')} — {ws.get('name')}"
        for m in (ws.get("milestones") or []):
            mid = m.get("id")
            try:
                b = briefings.get(mid) or {}
                spec = dmap.briefing_spec(m, b, ws_name)
                h = _render_hash(th, spec)
                prev = idx.get(mid) or {}
                if _skip(prev, h):                  # unveraendert + Doc existiert -> ueberspringen
                    skipped += 1
                    continue
                r = _mat(drive, docs, "briefings", spec,
                         prev.get("server_doc_id"), prev.get("server_pdf_id"))
                rec = _server_fields(r, with_stand=True)
                rec["server_hash"] = h
                idx[mid] = rec
                _vol_pdf(root, "briefings", spec["name"], r["pdf_bytes"])
                _vol_png(root, "briefings", _png_name(spec["name"]), r["pdf_bytes"])
                rendered += 1
            except Exception as ex:  # noqa: BLE001
                log.warning("briefing %s fehlgeschlagen: %s", mid, ex)
    _write(root, "briefings_docs.json", idx)
    log.info("briefings rendered=%d skipped=%d", rendered, skipped)
    return {"rendered": rendered, "skipped": skipped}


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
