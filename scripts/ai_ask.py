#!/usr/bin/env python3
"""Dünne Naht Node -> KI-Fassade: Prompt via stdin, Antworttext via stdout.

Der Server ruft dieses Skript statt eines lokal installierten CLI-Binaries auf
(behebt `spawn … ENOENT` am deployten Dienst). Die Modellwahl (lokale CLI vs.
Vertex) entscheidet ai_client.generate anhand RUBICON_AI_PROVIDER -- lokal ohne
gesetzten Provider byte-identischer Rückfall auf die frühere CLI. RUBICON-CUTOVER:
der lokale CLI-Rückfall in ai_client entfällt beim Web-only-Switch.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '_tools'))
import ai_client  # noqa: E402


def main():
    prompt = sys.stdin.read()
    if not prompt.strip():
        sys.stderr.write('leerer Prompt')
        return 1
    try:
        # 230s < Nodes 240s-SIGKILL-Timeout auf diesen Prozess: Python soll den
        # lokalen CLI-Enkel selbst sauber beenden, statt vom SIGKILL erwischt zu werden.
        sys.stdout.write(ai_client.generate(prompt, timeout=230))
        return 0
    except Exception as e:  # noqa: BLE001 -- Node liest stderr + Exit-Code
        sys.stderr.write(str(e)[-300:])
        return 1


if __name__ == '__main__':
    sys.exit(main())
