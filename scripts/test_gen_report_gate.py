import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_report as gr  # noqa: E402


def test_is_server_needs_both():
    for k in ("RUBICON_WORKSPACE_SA", "RUBICON_IMPERSONATE_SUBJECT"):
        os.environ.pop(k, None)
    assert gr._is_server() is False
    os.environ["RUBICON_WORKSPACE_SA"] = "sa@x"
    assert gr._is_server() is False
    os.environ["RUBICON_IMPERSONATE_SUBJECT"] = "u@axs.aero"
    try:
        assert gr._is_server() is True
    finally:
        os.environ.pop("RUBICON_WORKSPACE_SA", None)
        os.environ.pop("RUBICON_IMPERSONATE_SUBJECT", None)


def test_reports_folder_env_override():
    os.environ["RUBICON_DRIVE_REPORTS_FOLDER"] = "FOLDER_X"
    try:
        assert gr._reports_folder() == "FOLDER_X"
    finally:
        os.environ.pop("RUBICON_DRIVE_REPORTS_FOLDER", None)
    assert isinstance(gr._reports_folder(), str) and gr._reports_folder()


if __name__ == "__main__":
    test_is_server_needs_both()
    test_reports_folder_env_override()
    print("gen_report gate: 2/2 gruen")
