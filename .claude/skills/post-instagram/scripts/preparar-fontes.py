#!/usr/bin/env python3
"""Baixa Hanken Grotesk + IBM Plex Mono (subset latino) e devolve um CSS com as
fontes embutidas em base64.

Por que isso existe: o Chromium headless deste ambiente não alcança o Google
Fonts (o proxy só vale para curl), e um <link> pendente trava o parser — o
script da página nem chega a rodar. Com as fontes embutidas, a exportação
renderiza exatamente a mesma tipografia que o navegador do usuário vê.

Uso:  python3 preparar-fontes.py [saida.css]
"""
import base64
import os
import re
import subprocess
import sys

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/120.0.0.0 Safari/537.36")
URL = ("https://fonts.googleapis.com/css2"
       "?family=Hanken+Grotesk:wght@400;500;600;700;800"
       "&family=IBM+Plex+Mono:wght@500;600&display=swap")

saida = sys.argv[1] if len(sys.argv) > 1 else "fontes-embutidas.css"
tmp = os.path.join(os.path.dirname(saida) or ".", "_google-fonts.css")

subprocess.run(["curl", "-sS", "-A", UA, URL, "-o", tmp], check=True)
css = open(tmp, encoding="utf-8").read()

# O CSS do Google vem em blocos por subset, cada um precedido de /* latin */ etc.
partes = re.split(r"/\*\s*([a-z0-9\-\[\]]+)\s*\*/", css)
faces = []
for i in range(1, len(partes), 2):
    subset, corpo = partes[i], partes[i + 1]
    if subset != "latin":          # só o latino: corta ~80% do peso
        continue
    m = re.search(r"url\((https://fonts\.gstatic\.com[^)]+)\)", corpo)
    if not m:
        continue
    familia = re.search(r"font-family:\s*'([^']+)'", corpo).group(1)
    peso = re.search(r"font-weight:\s*(\d+)", corpo).group(1)
    woff = subprocess.run(["curl", "-sS", m.group(1)], check=True, capture_output=True).stdout
    b64 = base64.b64encode(woff).decode()
    faces.append(
        f"@font-face{{font-family:'{familia}';font-style:normal;font-weight:{peso};"
        f"font-display:block;src:url(data:font/woff2;base64,{b64}) format('woff2');}}"
    )

os.remove(tmp)
open(saida, "w", encoding="utf-8").write("\n".join(faces))
print(f"{saida}: {len(faces)} fontes, {os.path.getsize(saida)//1024} KB")
