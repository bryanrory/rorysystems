#!/usr/bin/env node
/* Gera o bloco HTML dos depoimentos da home a partir de content/testimonials.json.

   Por que existe: a landing não tem passo de build, e a prova social é
   justamente o conteúdo que mais precisa estar no HTML servido — Google indexa,
   e quem está com JavaScript bloqueado continua lendo. Renderizar no cliente
   resolveria o "arquivo único de dados" e perderia as duas coisas. Este script
   é o meio-termo: o JSON continua sendo a fonte da verdade que se edita, e o
   HTML gerado é o que vai para o ar.

   Uso:
     node tools/build-testimonials.mjs           regrava o bloco no index.html
     node tools/build-testimonials.mjs --check   só verifica se está em dia (CI)

   O bloco fica entre marcadores no apps/landing/index.html. Nada fora deles é
   tocado — o resto do arquivo é escrito à mão e continua sendo. */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONTE = join(RAIZ, 'content', 'testimonials.json');
const DESTINO = join(RAIZ, 'apps', 'landing', 'index.html');

const MARCADORES = {
  cards: ['<!-- rs:testimonials:start -->', '<!-- rs:testimonials:end -->'],
  jsonld: ['<!-- rs:testimonials-jsonld:start -->', '<!-- rs:testimonials-jsonld:end -->'],
};

/* Os mesmos três rótulos do select de /feedback. Se divergirem, um depoimento
   chega com um tipo que a home não sabe exibir. */
const SERVICOS = [
  'Sustentação de Sistemas',
  'Desenvolvimento de Novo Produto',
  'Site / Landing Page de Conversão',
];

const LIMITE_CITACAO = 300; // igual ao maxlength do formulário

/* Mesma função do Worker (apps/contact-worker/src/index.js). Vale para texto e
   para valor de atributo: aspas simples e duplas estão as duas na lista. */
function escaparHtml(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function abortar(mensagem) {
  console.error(`ERRO: ${mensagem}`);
  process.exit(1);
}

/* Falha cedo e com o id na mensagem: um depoimento malformado que passasse
   daqui viraria card quebrado em produção. */
function validar(d, indice) {
  const onde = `depoimento #${indice + 1}${d && d.id ? ` (${d.id})` : ''}`;

  for (const campo of ['id', 'nome', 'cargo', 'empresa', 'servico', 'iniciais', 'citacao']) {
    if (!d[campo] || !String(d[campo]).trim()) abortar(`${onde}: campo "${campo}" vazio ou ausente.`);
  }
  if (!SERVICOS.includes(d.servico)) {
    abortar(`${onde}: serviço "${d.servico}" não é um dos três tipos aceitos.\n  Aceitos: ${SERVICOS.join(' | ')}`);
  }
  if (d.citacao.length > LIMITE_CITACAO) {
    abortar(`${onde}: citação com ${d.citacao.length} caracteres (máximo ${LIMITE_CITACAO}).`);
  }
  if (d.foto && !/^https:\/\//.test(d.foto) && !d.foto.startsWith('/')) {
    abortar(`${onde}: foto precisa ser uma URL https:// ou um caminho absoluto começando com "/".`);
  }
  if (String(d.iniciais).length > 2) {
    abortar(`${onde}: iniciais com mais de 2 caracteres não cabem no avatar.`);
  }
}

function montarCard(d) {
  /* Foto é decorativa: o nome vem logo ao lado em texto, então alt vazio evita
     que o leitor de tela leia a mesma informação duas vezes. */
  const avatar = d.foto
    ? `<span class="voice__ava"><img src="${escaparHtml(d.foto)}" alt="" loading="lazy" width="44" height="44" /></span>`
    : `<span class="voice__ava" aria-hidden="true">${escaparHtml(d.iniciais)}</span>`;

  const resultado = d.resultado
    ? `\n          <p class="voice__res"><span>Resultado</span>${escaparHtml(d.resultado)}</p>`
    : '';

  /* O badge vem antes da identidade, como em .svc: nome e cargo têm 1 ou 2
     linhas conforme o comprimento, então qualquer coisa depois deles nasce numa
     altura diferente em cada card. Com o badge no topo, a primeira linha de
     todos os cards se alinha, e o box de resultado alinha embaixo pelo
     margin-top:auto — a faixa ganha duas guias horizontais em vez de nenhuma. */
  return [
    '        <article class="voice">',
    `          <p class="voice__badge">${escaparHtml(d.servico)}</p>`,
    '          <header class="voice__head">',
    `            ${avatar}`,
    '            <div>',
    `              <p class="voice__n">${escaparHtml(d.nome)}</p>`,
    `              <p class="voice__r">${escaparHtml(d.cargo)} · ${escaparHtml(d.empresa)}</p>`,
    '            </div>',
    '          </header>',
    `          <blockquote class="voice__q">${escaparHtml(d.citacao)}</blockquote>${resultado}`,
    '        </article>',
  ].join('\n');
}

/* Review estruturado só para depoimento real. Marcação de review inventada é
   violação da política de dados estruturados do Google e rende penalização
   manual — o custo de errar aqui é bem maior que o ganho. */
function montarJsonLd(reais) {
  if (!reais.length) {
    return '      <!-- Sem depoimentos reais aprovados ainda: nenhum dado estruturado de Review é\n' +
           '           emitido enquanto todas as entradas forem mock. Ver tools/build-testimonials.mjs. -->';
  }

  const dados = {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    name: 'Rory Systems',
    url: 'https://www.rorysystems.com',
    review: reais.map((d) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: d.nome, jobTitle: d.cargo, worksFor: { '@type': 'Organization', name: d.empresa } },
      reviewBody: d.citacao,
      itemReviewed: { '@type': 'Service', name: d.servico, provider: { '@type': 'Organization', name: 'Rory Systems' } },
    })),
  };

  /* JSON dentro de <script> não passa por escape de HTML; o que quebraria a tag
     é a sequência "</script" no conteúdo, então é essa que precisa ser neutralizada. */
  const serializado = JSON.stringify(dados, null, 2)
    .replace(/<\/script/gi, '<\\/script')
    .split('\n')
    .map((linha) => `      ${linha}`)
    .join('\n');

  return `      <script type="application/ld+json">\n${serializado}\n      </script>`;
}

function substituirBloco(html, [inicio, fim], conteudo, nomeDoBloco) {
  const i = html.indexOf(inicio);
  const f = html.indexOf(fim);
  if (i === -1 || f === -1) {
    abortar(`marcadores do bloco "${nomeDoBloco}" não encontrados em ${DESTINO}.\n  Esperado: ${inicio} ... ${fim}`);
  }
  if (f < i) abortar(`marcadores do bloco "${nomeDoBloco}" estão fora de ordem em ${DESTINO}.`);

  /* Preserva a indentação do marcador de abertura para o de fechamento cair
     alinhado, sem depender de o HTML estar num nível específico. */
  const recuo = html.slice(0, i).split('\n').pop().match(/^\s*/)[0];
  return html.slice(0, i + inicio.length) + '\n' + conteudo + '\n' + recuo + html.slice(f);
}

function main() {
  const apenasVerificar = process.argv.includes('--check');

  let fonte;
  try {
    fonte = JSON.parse(readFileSync(FONTE, 'utf8'));
  } catch (erro) {
    abortar(`não consegui ler ${FONTE}: ${erro.message}`);
  }

  const depoimentos = fonte.depoimentos;
  if (!Array.isArray(depoimentos) || !depoimentos.length) {
    abortar(`${FONTE} precisa ter um array "depoimentos" com pelo menos uma entrada.`);
  }

  depoimentos.forEach(validar);

  const ids = depoimentos.map((d) => d.id);
  const duplicado = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicado) abortar(`id duplicado: "${duplicado}".`);

  const original = readFileSync(DESTINO, 'utf8');
  const reais = depoimentos.filter((d) => !d.mock);

  let atualizado = substituirBloco(original, MARCADORES.cards, depoimentos.map(montarCard).join('\n'), 'cards');
  atualizado = substituirBloco(atualizado, MARCADORES.jsonld, montarJsonLd(reais), 'jsonld');

  const mocks = depoimentos.length - reais.length;

  if (apenasVerificar) {
    if (atualizado !== original) {
      console.error('ERRO: apps/landing/index.html está dessincronizado de content/testimonials.json.');
      console.error('      Rode `node tools/build-testimonials.mjs` e commite os dois arquivos juntos.');
      process.exit(1);
    }
    console.log(`OK: ${depoimentos.length} depoimento(s) em dia com o index.html.`);
  } else {
    if (atualizado === original) {
      console.log(`Nada a fazer: ${depoimentos.length} depoimento(s) já estavam em dia.`);
    } else {
      writeFileSync(DESTINO, atualizado);
      console.log(`Gravado: ${depoimentos.length} depoimento(s) em apps/landing/index.html.`);
    }
  }

  if (mocks) {
    console.warn('');
    console.warn(`AVISO: ${mocks} de ${depoimentos.length} depoimento(s) estão marcados como "mock": true.`);
    console.warn('       São exemplos fictícios. Publicar depoimento inventado como se fosse de');
    console.warn('       cliente real engana quem está avaliando uma contratação — substitua por');
    console.warn('       depoimentos reais antes de subir a seção para o ar.');
    console.warn('       Enquanto houver mock, os dados estruturados de Review não são emitidos.');
  }
}

main();
