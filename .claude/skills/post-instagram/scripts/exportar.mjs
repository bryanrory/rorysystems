// Renderiza cada export-N.html em PNG no tamanho exato da arte.
//
// Fala com o Chromium pelo protocolo de depuração (CDP) usando o WebSocket
// nativo do Node — sem Playwright, sem instalar nada. O motivo de não usar
// `chrome --screenshot` direto: aquele modo captura a janela inteira e erra a
// altura; aqui o recorte é medido no próprio elemento .slide, então a imagem
// sai com o pixel exato do slide, sempre.
//
// Uso:  node exportar.mjs <pasta-com-os-export-N.html> [prefixo] [tema]
//       tema: dark (padrão) ou light

import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const pasta = resolve(process.argv[2] || '.');
const prefixo = process.argv[3] || 'arte';
const tema = process.argv[4] || 'dark';
const PORTA = process.env.CDP_PORT || 9222;

const CHROME = process.env.CHROME_PATH
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const pausa = ms => new Promise(r => setTimeout(r, ms));

async function cdpVivo() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORTA}/json/version`);
    return r.ok;
  } catch { return false; }
}

async function garantirChrome() {
  if (await cdpVivo()) return null;
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${PORTA}`, '--user-data-dir=/tmp/perfil-export', 'about:blank',
  ], { detached: true, stdio: 'ignore' });
  proc.unref();
  for (let i = 0; i < 60; i++) {
    await pausa(500);
    if (await cdpVivo()) return proc;
  }
  throw new Error('Chromium não subiu — confira CHROME_PATH');
}

async function capturar(arquivo, destino) {
  const alvo = await (await fetch(`http://127.0.0.1:${PORTA}/json/new?about:blank`,
    { method: 'PUT' })).json();
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));

  let id = 0;
  const pend = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(r => {
    const n = ++id; pend.set(n, r);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const avaliar = async expr => (await send('Runtime.evaluate',
    { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

  await send('Page.enable');
  await send('Runtime.enable');
  // viewport folgado: o recorte vem do elemento, não da janela
  await send('Emulation.setDeviceMetricsOverride',
    { width: 1400, height: 1600, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `file://${arquivo}` });
  await pausa(1200);
  await avaliar('document.fonts.ready.then(()=>true)');
  await avaliar(`document.documentElement.setAttribute('data-theme','${tema}'), true`);
  await pausa(400);

  const caixa = await avaliar(`(() => {
    const todos = [...document.querySelectorAll('.slide')];
    const s = todos.find(el => el.offsetParent !== null && el.getBoundingClientRect().width > 0) || todos[0];
    const r = s.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
  })()`);

  await send('Page.bringToFront');
  const shot = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: caixa.x, y: caixa.y, width: caixa.w, height: caixa.h, scale: 1 },
  });
  if (!shot.result?.data) throw new Error(`captura falhou: ${JSON.stringify(shot)}`);
  writeFileSync(destino, Buffer.from(shot.result.data, 'base64'));
  await send('Page.close');
  ws.close();
  return caixa;
}

await garantirChrome();

const arquivos = readdirSync(pasta)
  .filter(f => /^export-\d+\.html$/.test(f))
  .sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));

if (!arquivos.length) throw new Error(`nenhum export-N.html em ${pasta}`);

for (const f of arquivos) {
  const n = f.match(/\d+/)[0];
  const destino = join(pasta, `${prefixo}-${tema}-${n}.png`);
  const caixa = await capturar(join(pasta, f), destino);
  console.log(`${destino}  ${Math.round(caixa.w)}x${Math.round(caixa.h)}`);
}
process.exit(0);
