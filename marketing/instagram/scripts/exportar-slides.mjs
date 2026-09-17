/**
 * Exporta os slides do carrossel em PNG 1080x1350, um arquivo por slide,
 * na pasta ../png. Usa o Chromium do Playwright, então o texto sai com as
 * fontes reais da marca (Hanken Grotesk, IBM Plex Mono, Instrument Serif),
 * diferente do botão "Baixar PNG" do próprio HTML, que cai nas fontes do
 * sistema.
 *
 *   npx playwright@latest test --version   # (opcional) conferir instalação
 *   node scripts/exportar-slides.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const aqui = dirname(fileURLToPath(import.meta.url));
const pagina = resolve(aqui, '..', 'landing-page-vendavel.html');
const destino = resolve(aqui, '..', 'png');

mkdirSync(destino, { recursive: true });

const navegador = await chromium.launch();
const aba = await navegador.newPage({
  viewport: { width: 1080, height: 1350 },
  deviceScaleFactor: 1,
});

await aba.goto('file://' + pagina, { waitUntil: 'networkidle' });
await aba.evaluate(() => document.fonts.ready);

// Tira a redução de escala da bancada: o PNG precisa do tamanho real.
await aba.addStyleTag({
  content: `
    body{ padding:0 !important; background:#0A0C10 !important; }
    .bancada{ max-width:none !important; }
    .bancada__topo, .peca__rotulo{ display:none !important; }
    .peca{ margin:0 !important; }
    .palco{ width:1080px !important; height:1350px !important; aspect-ratio:auto !important;
            border:0 !important; border-radius:0 !important; }
    .palco .slide{ transform:none !important; }
  `,
});

const slides = await aba.$$('.slide');
for (let i = 0; i < slides.length; i++) {
  const arquivo = resolve(destino, `slide-${i + 1}.png`);
  await slides[i].screenshot({ path: arquivo });
  console.log('gerado:', arquivo);
}

await navegador.close();
console.log(`\n${slides.length} slides exportados em ${destino}`);
