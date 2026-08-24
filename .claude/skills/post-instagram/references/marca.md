# Padrão visual — Rory Systems

Os valores abaixo são os oficiais da marca: batem com `apps/landing/style.css` e com
os arquivos-fonte da logo em `Drive > Rory Systems > Logo`. Não invente variações —
se faltar alguma cor para um formato novo, derive dos tokens existentes e diga ao
usuário o que você derivou.

## Tokens

Os cinco nomes abaixo são os que o cliente pediu no primeiro briefing e devem ser
mantidos, mesmo em peças novas — é o vocabulário com que ele fala das cores.

```css
:root{
  --cor-primaria:   #2C4A7C;  /* índigo — palavra SYSTEMS, base do gradiente  */
  --cor-secundaria: #3ED6E0;  /* ciano  — rótulos e destaques de texto        */
  --cor-fundo:      #0A0C10;
  --cor-texto:      #F4F1EA;
  --cor-destaque:   #4EDCA0;  /* menta                                        */

  --cor-secundaria-fill: #3ED6E0;   /* versões sempre vívidas, para formas    */
  --cor-destaque-fill:   #4EDCA0;

  --cor-texto-dim:   #A8AEBD;
  --cor-borda:       rgba(244,241,234,.09);
  --cor-borda-forte: rgba(244,241,234,.18);
  --cor-placa:       #12151D;
  --lux: 62, 214, 224;              /* ciano em RGB, para brilhos             */
}
```

### Tema claro

Só os tokens mudam — nenhuma regra de layout é reescrita.

```css
:root[data-theme="light"]{
  --cor-fundo: #FFFFFF;
  --cor-texto: #12151D;
  --cor-secundaria: #0B7C88;   /* ciano e menta escurecem quando carregam     */
  --cor-destaque:   #0C7A54;   /* texto: os tons vivos não têm contraste      */
  --cor-texto-dim:  #3F4756;   /* sobre branco                                */
  --cor-borda:       rgba(18,21,29,.10);
  --cor-borda-forte: rgba(18,21,29,.18);
  --cor-placa:       #F4F6F8;
}
```

O par `*-fill` continua vívido nos dois temas: essas cores preenchem forma (botão do
CTA, barra do bloco), não são lidas, então não precisam do contraste de texto.

Contraste conferido: todos os textos de leitura passam AA (≥4,5:1) nos dois temas.
Se criar um tom novo, meça antes — os rótulos pequenos em mono são os que mais
sofrem.

## Tipografia

- **Hanken Grotesk** (400–800) — títulos e corpo. É a fonte da marca; não troque por
  Inter/Poppins mesmo que o briefing peça, só confirme com o usuário (ele já optou
  por manter a da marca uma vez).
- **IBM Plex Mono** (500, 600) — rótulos, chamadas, endereços. Sempre em caixa alta
  com `letter-spacing` entre .06em e .18em.

```html
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet" />
```

Declare sempre o fallback: `'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif`.

## Símbolo e assinatura

O símbolo são três quadrados arredondados ligados por um traço em gradiente
índigo→ciano, com um ponto menta de status. Use a variação de fundo transparente
(quadrados da base vazados, máscara escondendo o traço por dentro deles) — assim a
mesma marcação serve nos dois temas. O SVG pronto está em
`assets/carrossel-4x5.html`, no `<symbol id="rs-mark">`; copie de lá em vez de
redesenhar.

A assinatura completa é símbolo + "Rory" (peso 800) com "SYSTEMS" abaixo
(peso 600, `letter-spacing: .26em`, em ciano). O usuário pediu a assinatura
completa, não só o símbolo — e num tamanho generoso, não discreto.

## Regras visuais herdadas do site

- **Só o CTA brilha.** Blocos de serviço não recebem glow em repouso: as duas frentes
  da empresa (construir e sustentar) têm peso idêntico no discurso, e o brilho
  quebraria isso.
- **Menta = sustentar o que já existe. Ciano = construir o que vem.** Vale para
  destaque de texto, barra de bloco, o que for. É o que faz a peça inteira ser lida
  pela cor sem precisar explicar.
- **Grade técnica de fundo**: dois `linear-gradient` de 1px cruzados. Em peça de
  social, célula de 16cqw (bem aberta) — a de 8cqw ficou fechada demais.
- **Halo radial de ciano** num canto, em opacidade baixa (`--glow-ambiente: .10`
  escuro / `.14` claro).
