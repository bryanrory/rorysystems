---
name: post-instagram
description: Cria posts do Instagram da Rory Systems no padrão visual da marca — carrossel 4:5 (1080×1350), story ou post único — como HTML navegável mais as artes exportadas em PNG. Use sempre que a conversa envolver post, carrossel, story, feed, arte para rede social, peça de divulgação ou "material para o Instagram", mesmo que o usuário não cite a marca nem peça o formato pelo nome. Também use quando ele pedir para ajustar, reexportar ou republicar uma peça já criada.
---

# Post de Instagram — Rory Systems

Esta skill existe para você não redescobrir, a cada peça, as cores da marca, o
tamanho de fonte que funciona no celular, o jeito de exportar em 1080×1350 e os
caminhos de entrega que já falharam. Tudo isso está decidido; sua energia vai para
a copy e para o que a peça específica pede.

## Antes de desenhar, alinhe três coisas

1. **Formato.** Carrossel 4:5 é o padrão e o único com template pronto. Story
   (9:16) e post único (1:1 ou 4:5) exigem adaptar o template — veja "Outros
   formatos" no fim.
2. **A ideia de cada slide.** Não comece pelo CSS. Escreva a copy dos slides em
   texto puro, mostre ao usuário e só então monte. Ele revisa copy muito mais
   rápido que arte, e refazer arte custa caro.
3. **Quantos slides.** O Instagram aceita de 4 a 10; quatro é o padrão da marca.

`references/copy.md` traz o arco que funcionou, três ganchos testados para a capa
e a lista do que o usuário não quer dentro do slide. Leia antes de escrever.

## Montando a peça

Parta de `assets/carrossel-4x5.html`. É o carrossel aprovado: arquivo único, CSS e
JS inline, quatro slides, setas, pontos, teclado, alternador de tema e navegação
que funciona sem JavaScript. Copie para a área de trabalho da sessão, troque a
copy e ajuste o que a peça pedir.

O que faz esse template funcionar, e que você precisa preservar ao editar:

- **Tudo é medido em `cqw`**, porcentagem da largura do próprio slide
  (`container-type: inline-size`). É o que faz a arte ficar idêntica no preview de
  380px e na exportação de 1080px. Se você usar `px` ou `rem` dentro do slide, a
  proporção quebra entre o que o usuário aprova e o que é publicado.
- **Trocar `--proporcao` para `1 / 1`** gera a versão quadrada sem mexer em mais
  nada.
- **Os controles ficam fora do `.slide`.** A exportação recorta o elemento
  `.slide`, então nada de barra, seta ou contador vaza para a imagem.
- **A logo é a assinatura completa** (símbolo + "Rory SYSTEMS"), no canto superior
  direito de todos os slides.

Tamanhos que o usuário aprovou, como ponto de partida — ele pediu "maior" três
vezes, então erre para cima:

| Elemento | Tamanho |
|---|---|
| Título da capa | 15,5cqw |
| Corpo (slide de texto) | 10,5cqw |
| Título de bloco | 7,6cqw |
| Texto de bloco | 4,6cqw |
| Chamada / rótulo mono | 2,6–3,8cqw |
| Símbolo da logo | 12cqw |

`references/marca.md` tem os tokens completos dos dois temas, a tipografia, o SVG
do símbolo e as regras herdadas do site.

## Conferindo antes de mostrar

Renderize e **olhe** as imagens — texto grande estoura com facilidade. Verifique
sempre, nos quatro slides e nos dois temas:

- nenhuma palavra mais larga que a caixa (`scrollWidth > clientWidth`);
- nada cortado embaixo (o último filho dentro do padding do slide);
- nenhum texto colidindo com a logo;
- a navegação respondendo a 1200px e a 375px.

Um detalhe que já enganou: o halo decorativo (`.slide::after`) infla o
`scrollHeight`, então comparar `scrollHeight` com `clientHeight` acusa transbordo
falso. Meça o `getBoundingClientRect().bottom` dos filhos reais.

Outro: glifos como `→` não existem no subset latino das fontes da marca e somem no
render. Desenhe setas em SVG.

## Exportando as artes

```bash
S=.claude/skills/post-instagram/scripts

python3 $S/preparar-fontes.py fontes-embutidas.css     # uma vez por sessão
python3 $S/preparar-export.py peca.html fontes-embutidas.css
node     $S/exportar.mjs . arte dark
python3  $S/otimizar-png.py --nomes capa,o-que-fazemos,servicos,cta arte-dark-*.png
```

As fontes precisam ser embutidas porque o Chromium daqui não alcança o Google
Fonts, e um `<link>` pendurado trava o parser — a página nem executa o script. Os
scripts têm o porquê de cada decisão no cabeçalho; leia se algo der errado.

## Entregando

`references/entrega.md` é obrigatório aqui: descreve o que já falhou (upload de
imagem no Drive, salvar do webview do app) para você não prometer caminho que não
funciona. Em resumo:

- **HTML** vai para `Rory Systems > Marketing` no Drive. Sobe como texto, sem
  conversão para Google Doc, e confira o `fileSize` contra o arquivo local.
- **PNGs** você entrega na conversa e explica as rotas de salvamento, sem garantir
  qual funciona no aparelho dele.
- Atualizar peça no Drive é descartar a antiga e subir a nova — não existe
  substituir conteúdo.

## Outros formatos

Ainda não temos template para story nem post único. Quando aparecer o pedido,
adapte o carrossel: mude `--proporcao` (`9 / 16` para story, `1 / 1` para post),
reveja a escala de tipografia (num story o texto pode crescer mais, a área é
maior) e mantenha logo, tokens e regras de cor. Depois, traga a peça de volta para
`assets/` como um segundo template e registre aqui o que mudou — a próxima pessoa
não deveria descobrir de novo.
