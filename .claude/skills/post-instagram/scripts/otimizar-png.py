#!/usr/bin/env python3
"""Reduz o peso dos PNGs sem estragar as cores da marca.

O render sai com ~220 KB por slide, quase tudo gasto no degradê do halo. A
quantização para paleta de 256 cores derruba para ~40 KB. O método importa:
MEDIANCUT (o padrão do Pillow) escolhe as cores pela área que ocupam e acaba
deslocando acentos pequenos — o ponto menta chegou a virar ciano num teste.
FASTOCTREE preserva esses tons: nas medições ficou dentro de 1-2 unidades RGB
do original.

Uso:  python3 otimizar-png.py arte-dark-1.png [arte-dark-2.png ...]
      python3 otimizar-png.py --nomes capa,servicos arte-dark-*.png
"""
import os
import statistics
import sys

from PIL import Image

args = sys.argv[1:]
nomes = None
if args and args[0] == "--nomes":
    nomes = args[1].split(",")
    args = args[2:]

if not args:
    sys.exit(__doc__)

for i, origem in enumerate(args):
    im = Image.open(origem).convert("RGB")
    q = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE,
                    dither=Image.Dither.FLOYDSTEINBERG)

    if nomes and i < len(nomes):
        destino = os.path.join(os.path.dirname(origem) or ".",
                               f"carrossel-slide-{i+1}-{nomes[i]}.png")
    else:
        destino = origem.replace(".png", "-otimizado.png")

    q.save(destino, optimize=True)

    a, b = im.tobytes(), q.convert("RGB").tobytes()
    dif = [abs(a[j] - b[j]) for j in range(0, len(a), 997)]
    print(f"{destino}  {im.size[0]}x{im.size[1]}  "
          f"{os.path.getsize(origem)//1024} KB -> {os.path.getsize(destino)//1024} KB  "
          f"desvio médio {statistics.mean(dif):.2f}/255")
