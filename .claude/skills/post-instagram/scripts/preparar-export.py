#!/usr/bin/env python3
"""Gera uma cópia de exportação da peça: um arquivo por slide, com a arte
travada em pixels e sem os controles do mockup.

Por que uma cópia em vez de exportar a página direto: no mockup o slide é
fluido (aspect-ratio + cqw) e vem acompanhado de setas, pontos e barra de
revisão. Para a imagem publicada a arte precisa medir exatamente 1080x1350 e
não pode carregar nenhum controle junto. Estas regras extras só existem no
arquivo de exportação — a peça entregue continua limpa.

Uso:  python3 preparar-export.py peca.html fontes-embutidas.css [largura] [altura]
Gera: export-1.html ... export-N.html, ao lado da peça.
"""
import os
import re
import sys

peca = sys.argv[1]
fontes_css = sys.argv[2]
largura = sys.argv[3] if len(sys.argv) > 3 else "1080"
altura = sys.argv[4] if len(sys.argv) > 4 else "1350"

html = open(peca, encoding="utf-8").read()
fontes = open(fontes_css, encoding="utf-8").read()

# fora o <link> do Google (trava o parser sem rede), dentro as fontes embutidas
html = re.sub(r'<link rel="preconnect"[^>]*>\n?', "", html)
html = re.sub(r'<link href="https://fonts\.googleapis\.com[^>]*>\n?', "", html)

total = html.count('class="slide ')
if total == 0:
    sys.exit("nenhum .slide encontrado — confira se a peça segue o template")

base = os.path.dirname(os.path.abspath(peca))
for n in range(1, total + 1):
    override = f"""<style>{fontes}</style>
<style>
  html,body{{margin:0;padding:0;min-height:0;display:block;background:transparent;gap:0;}}
  .topo,.controles,.palco > .seta{{display:none!important;}}
  .palco,.trilho{{width:{largura}px!important;display:block!important;overflow:visible!important;gap:0!important;}}
  .slide{{width:{largura}px!important;height:{altura}px!important;aspect-ratio:auto!important;
         border:none!important;border-radius:0!important;flex:none!important;}}
  .slide:not(:nth-of-type({n})){{display:none!important;}}
</style>
"""
    destino = os.path.join(base, f"export-{n}.html")
    open(destino, "w", encoding="utf-8").write(html.replace("</head>", override + "</head>"))

print(f"{total} arquivos de exportação gerados em {base}")
