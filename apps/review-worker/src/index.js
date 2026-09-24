/* Rory Systems — avaliações de clientes.

   A página rorysystems.com/avaliar/ (link enviado só para clientes) manda a
   avaliação para cá. Ela entra no D1 como Pendente e gera um e-mail com links
   assinados de aprovar/recusar; só o que for aprovado sai em GET /avaliacoes,
   que a landing consome para montar a seção de depoimentos.

   Como no Worker de contato, as checagens do POST vão do mais barato ao mais
   caro: forma da requisição, rate limit, corpo, validação, D1, SMTP.

   A API responde só códigos (SCREAMING_SNAKE_CASE); o texto que o visitante
   lê fica na página. A exceção é /moderar, que é a própria página de
   moderação aberta a partir do e-mail. */

import { WorkerMailer } from 'worker-mailer';

const TAMANHO_MAX = 120 * 1024; // foto já chega reduzida a 256px; 120 KB é folga
const FOTO_MAX = 60 * 1024;
const LIMITES = { nome: [2, 80], profissao: [2, 80], comentario: [3, 244] };
const LISTA_MAX = 24;
const VALIDADE_LINK = 30 * 24 * 60 * 60; // segundos
const TIPOS_FOTO = ['image/webp', 'image/jpeg', 'image/png'];

/* --- utilidades ------------------------------------------------------------ */

/* Normaliza para NFC, troca qualquer espaço/quebra/controle por um espaço só.
   Comentário de 244 caracteres não precisa de parágrafo, e sem CR/LF nada
   disto vira injeção no Subject do e-mail. */
function texto(valor) {
  return String(valor == null ? '' : valor)
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F\u2028\u2029\s]+/g, ' ')
    .trim();
}

/* Tamanho em caracteres de verdade: emoji e acento combinado contam como um,
   igual o contador da página mostra. */
function tamanho(str) {
  return Array.from(str).length;
}

function escaparHtml(valor) {
  return String(valor).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function origemLiberada(origem, env) {
  if (!origem) return null;
  const lista = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return lista.includes(origem) ? origem : null;
}

function cabecalhos(origem) {
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  if (origem) h['Access-Control-Allow-Origin'] = origem;
  return h;
}

function json(corpo, status, origem, extra = {}) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...cabecalhos(origem),
      ...extra,
    },
  });
}

function erro(code, status, origem) {
  return json({ success: false, code }, status, origem);
}

/* Content-Length pode mentir ou faltar (requisição chunked). Ler em stream e
   parar no limite evita receber megabytes só para descartar depois. Devolve
   null quando o corpo passa de `max` bytes. */
async function lerCorpo(request, max) {
  if (!request.body) return '';
  const leitor = request.body.getReader();
  const partes = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await leitor.cancel();
      return null;
    }
    partes.push(value);
  }
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    bytes.set(p, pos);
    pos += p.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function limiteEstourado(binding, chave) {
  if (!binding) return false;
  try {
    const { success } = await binding.limit({ key: chave });
    return !success;
  } catch (e) {
    console.error('Rate limiter falhou:', e && e.message);
    return false;
  }
}

/* Turnstile opcional, mesmo contrato do Worker de contato: inerte até o
   secret ser gravado. */
async function turnstileValido(token, ip, env) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  try {
    const corpo = new FormData();
    corpo.append('secret', env.TURNSTILE_SECRET);
    corpo.append('response', token);
    if (ip) corpo.append('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: corpo });
    const dados = await r.json();
    return dados.success === true;
  } catch (e) {
    console.error('Turnstile indisponível:', e && e.message);
    return false;
  }
}

/* --- assinatura dos links de moderação -------------------------------------- */

const codificador = new TextEncoder();

async function chaveHmac(env) {
  return crypto.subtle.importKey(
    'raw',
    codificador.encode(env.REVIEW_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function paraBase64Url(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function assinar(env, id, acao, exp) {
  const sig = await crypto.subtle.sign('HMAC', await chaveHmac(env), codificador.encode(`${id}.${acao}.${exp}`));
  return paraBase64Url(sig);
}

/* crypto.subtle.verify compara em tempo constante; comparar strings com ===
   vazaria a assinatura byte a byte pelo tempo de resposta. */
async function assinaturaValida(env, id, acao, exp, sig) {
  if (!env.REVIEW_SECRET || !id || !acao || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isInteger(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  try {
    return await crypto.subtle.verify(
      'HMAC',
      await chaveHmac(env),
      deBase64Url(sig),
      codificador.encode(`${id}.${acao}.${expNum}`),
    );
  } catch {
    return false;
  }
}

async function linkAssinado(env, caminho, id, acao, exp) {
  const u = new URL(caminho, env.PUBLIC_URL);
  u.searchParams.set('id', id);
  u.searchParams.set('acao', acao);
  u.searchParams.set('exp', String(exp));
  u.searchParams.set('sig', await assinar(env, id, acao, exp));
  return u.toString();
}

/* --- foto --------------------------------------------------------------------- */

/* A página manda a foto já recortada como data URL. Confiamos só nos bytes:
   o tipo declarado precisa bater com a assinatura do arquivo. */
function lerFoto(valor) {
  if (valor == null || valor === '') return { ok: true, foto: null };
  if (typeof valor !== 'string') return { ok: false };
  const m = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(valor);
  if (!m) return { ok: false };
  let bytes;
  try {
    bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  } catch {
    return { ok: false };
  }
  if (bytes.length > FOTO_MAX) return { ok: false, grande: true };
  const tipo = m[1];
  const ascii = (ini, fim) => String.fromCharCode(...bytes.slice(ini, fim));
  const bate =
    (tipo === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (tipo === 'image/png' && bytes[0] === 0x89 && ascii(1, 4) === 'PNG') ||
    (tipo === 'image/webp' && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP');
  if (!bate) return { ok: false };
  return { ok: true, foto: bytes, tipo };
}

/* --- e-mail de moderação ------------------------------------------------------ */

function smtpConfigurado(env) {
  return Boolean(env.SMTP_USER && env.SMTP_PASS);
}

async function enviarModeracao(env, av) {
  /* Canal de saída sem credencial não derruba nada: a avaliação já está no
     D1 e pode ser moderada à mão (ver README). */
  if (!smtpConfigurado(env) || !env.REVIEW_SECRET) {
    console.log('E-mail de moderação não enviado (SMTP ou REVIEW_SECRET ausente). Avaliação', av.id);
    return;
  }

  const exp = Math.floor(Date.now() / 1000) + VALIDADE_LINK;
  const aprovar = await linkAssinado(env, '/moderar', av.id, 'aprovar', exp);
  const recusar = await linkAssinado(env, '/moderar', av.id, 'recusar', exp);
  const foto = av.temFoto ? await linkAssinado(env, `/avaliacoes/${av.id}/foto`, av.id, 'foto', exp) : null;
  const estrelas = '★'.repeat(av.estrelas) + '☆'.repeat(5 - av.estrelas);

  const texto =
    `Nova avaliação recebida pelo site.\n\n` +
    `Nome: ${av.nome}\nProfissão: ${av.profissao}\nEstrelas: ${estrelas} (${av.estrelas}/5)\n\n` +
    `Comentário:\n${av.comentario}\n\n` +
    `Aprovar: ${aprovar}\nRecusar: ${recusar}\n\n` +
    `Os links abrem uma página de confirmação e valem por 30 dias.`;

  const botao = (href, rotulo, cor) =>
    `<a href="${escaparHtml(href)}" style="display:inline-block;padding:10px 18px;margin-right:8px;border-radius:8px;` +
    `background:${cor};color:#fff;text-decoration:none;font-weight:700">${rotulo}</a>`;

  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#111">` +
    `<h2 style="margin:0 0 16px;font-size:17px">Nova avaliação pelo site</h2>` +
    (foto ? `<img src="${escaparHtml(foto)}" width="96" height="96" alt="" style="border-radius:50%;display:block;margin-bottom:12px">` : '') +
    `<p style="margin:0"><b>${escaparHtml(av.nome)}</b> · ${escaparHtml(av.profissao)}</p>` +
    `<p style="margin:4px 0 12px;color:#C58A12;font-size:18px">${estrelas}</p>` +
    `<div style="padding:12px 14px;background:#f5f5f5;border-radius:8px">${escaparHtml(av.comentario)}</div>` +
    `<p style="margin:20px 0">${botao(aprovar, 'Aprovar', '#0C7A54')}${botao(recusar, 'Recusar', '#9B2C2C')}</p>` +
    `<p style="font-size:12px;color:#999">Os links abrem uma página de confirmação e valem por 30 dias.</p>` +
    `</div>`;

  try {
    await WorkerMailer.send(
      {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT || 587),
        secure: false,
        startTls: true,
        credentials: { username: env.SMTP_USER, password: env.SMTP_PASS },
        authType: ['plain', 'login'],
      },
      {
        from: { name: env.MAIL_FROM_NAME || 'Rory Systems', email: env.MAIL_FROM },
        to: env.MAIL_TO,
        subject: `[Site] Nova avaliação de ${av.nome} (${av.estrelas}/5)`,
        text: texto,
        html,
      },
    );
  } catch (e) {
    /* A avaliação continua gravada; quem enviou não tem culpa do SMTP. */
    console.error('Falha no e-mail de moderação da avaliação', av.id, e && e.message);
  }
}

/* --- rotas ---------------------------------------------------------------------- */

async function criarAvaliacao(request, env, origem) {
  if (!origem) return erro('ORIGIN_NOT_ALLOWED', 403, null);
  if (!(request.headers.get('Content-Type') || '').toLowerCase().includes('application/json')) {
    return erro('INVALID_CONTENT_TYPE', 415, origem);
  }
  if (Number(request.headers.get('Content-Length') || 0) > TAMANHO_MAX) {
    return erro('PAYLOAD_TOO_LARGE', 413, origem);
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';

  if (await limiteEstourado(env.RL_GLOBAL, 'global')) return erro('RATE_LIMITED', 429, origem);
  if (await limiteEstourado(env.RL_IP, ip || 'desconhecido')) return erro('RATE_LIMITED', 429, origem);

  const bruto = await lerCorpo(request, TAMANHO_MAX);
  if (bruto === null) return erro('PAYLOAD_TOO_LARGE', 413, origem);

  let corpo;
  try {
    corpo = JSON.parse(bruto);
  } catch {
    return erro('INVALID_REQUEST', 400, origem);
  }
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return erro('INVALID_REQUEST', 400, origem);

  /* Honeypot: sucesso falso, nada gravado. */
  if (texto(corpo.botcheck)) {
    console.log('Honeypot acionado por', ip);
    return json({ success: true }, 200, origem);
  }

  if (!(await turnstileValido(corpo.turnstile, ip, env))) return erro('CAPTCHA_FAILED', 403, origem);

  const nome = texto(corpo.nome);
  const profissao = texto(corpo.profissao);
  const comentario = texto(corpo.comentario);
  const estrelas = corpo.estrelas;

  const dentro = (valor, [min, max]) => tamanho(valor) >= min && tamanho(valor) <= max;
  if (!dentro(nome, LIMITES.nome)) return erro('INVALID_NAME', 400, origem);
  if (!dentro(profissao, LIMITES.profissao)) return erro('INVALID_PROFESSION', 400, origem);
  if (!Number.isInteger(estrelas) || estrelas < 1 || estrelas > 5) return erro('INVALID_STARS', 400, origem);
  if (tamanho(comentario) > LIMITES.comentario[1]) return erro('COMMENT_TOO_LONG', 400, origem);
  if (tamanho(comentario) < LIMITES.comentario[0]) return erro('COMMENT_TOO_SHORT', 400, origem);
  if (corpo.consentimento !== true) return erro('CONSENT_REQUIRED', 400, origem);
  if (/https?:\/\/|www\.|<a\s|\[url=/i.test(comentario)) return erro('LINKS_NOT_ALLOWED', 400, origem);

  const foto = lerFoto(corpo.foto);
  if (!foto.ok) return erro(foto.grande ? 'PHOTO_TOO_LARGE' : 'INVALID_PHOTO', 400, origem);

  const av = {
    id: crypto.randomUUID(),
    nome,
    profissao,
    estrelas,
    comentario,
    temFoto: Boolean(foto.foto),
  };

  try {
    await env.DB.prepare(
      `INSERT INTO avaliacoes (id, nome, profissao, estrelas, comentario, foto, foto_tipo, status, criado_em, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendente', ?, ?)`,
    )
      .bind(av.id, nome, profissao, estrelas, comentario, foto.foto, foto.tipo || null, new Date().toISOString(), ip || null)
      .run();
  } catch (e) {
    console.error('Falha ao gravar avaliação:', e && e.message);
    return erro('STORAGE_UNAVAILABLE', 503, origem);
  }

  await enviarModeracao(env, av);
  return json({ success: true }, 201, origem);
}

async function listarAvaliacoes(env, origem) {
  let linhas;
  try {
    const r = await env.DB.prepare(
      `SELECT id, nome, profissao, estrelas, comentario, foto_tipo IS NOT NULL AS tem_foto, criado_em
         FROM avaliacoes
        WHERE status = 'Aprovada' AND excluido_em IS NULL
        ORDER BY criado_em DESC
        LIMIT ?`,
    )
      .bind(LISTA_MAX)
      .all();
    linhas = r.results || [];
  } catch (e) {
    console.error('Falha ao listar avaliações:', e && e.message);
    return erro('STORAGE_UNAVAILABLE', 503, origem);
  }

  const itens = linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    profissao: l.profissao,
    estrelas: l.estrelas,
    comentario: l.comentario,
    temFoto: Boolean(l.tem_foto),
    criadoEm: l.criado_em,
  }));
  return json({ success: true, itens }, 200, origem, { 'Cache-Control': 'public, max-age=300' });
}

async function servirFoto(url, env, id) {
  const row = await env.DB.prepare(
    `SELECT foto, foto_tipo, status FROM avaliacoes WHERE id = ? AND excluido_em IS NULL AND foto IS NOT NULL`,
  )
    .bind(id)
    .first();
  if (!row || !TIPOS_FOTO.includes(row.foto_tipo)) return new Response(null, { status: 404 });

  const aprovada = row.status === 'Aprovada';
  /* Pendente só aparece com o link assinado do e-mail de moderação. */
  if (!aprovada) {
    const p = url.searchParams;
    if (p.get('id') !== id || !(await assinaturaValida(env, id, 'foto', p.get('exp'), p.get('sig')))) {
      return new Response(null, { status: 404 });
    }
  }

  return new Response(new Uint8Array(row.foto), {
    headers: {
      'Content-Type': row.foto_tipo,
      'Cache-Control': aprovada ? 'public, max-age=86400' : 'private, no-store',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/* --- página de moderação -------------------------------------------------------- */

function pagina(titulo, corpoHtml, status = 200) {
  const html =
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex, nofollow"><title>${escaparHtml(titulo)}</title>` +
    `<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0A0C10;color:#F4F1EA;line-height:1.6}` +
    `main{max-width:32rem;margin:0 auto;padding:3rem 1rem}h1{font-size:1.4rem;margin:0 0 1rem}` +
    `.card{background:#12151D;border:1px solid rgba(244,241,234,.12);border-radius:12px;padding:1.25rem;margin-bottom:1.25rem}` +
    `.st{color:#F2B84B;font-size:1.2rem}.dim{color:#9198A9}img{border-radius:50%;display:block;margin-bottom:.75rem}` +
    `button{font:inherit;font-weight:700;border:0;border-radius:8px;padding:.8rem 1.4rem;cursor:pointer;color:#fff}` +
    `.ok{background:#0C7A54}.no{background:#9B2C2C}</style></head><body><main>${corpoHtml}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'",
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

const ACOES = { aprovar: 'Aprovada', recusar: 'Recusada' };

/* GET só mostra a confirmação. Filtro de link do Outlook/Gmail abre cada URL
   do e-mail sozinho; se o GET aprovasse, tudo seria aprovado na chegada. */
async function confirmarModeracao(url, env) {
  const p = url.searchParams;
  const id = p.get('id') || '';
  const acao = p.get('acao') || '';
  if (!ACOES[acao] || !(await assinaturaValida(env, id, acao, p.get('exp'), p.get('sig')))) {
    return pagina('Link inválido', '<h1>Link inválido ou expirado</h1>', 403);
  }

  const av = await env.DB.prepare(
    `SELECT nome, profissao, estrelas, comentario, foto_tipo, status FROM avaliacoes WHERE id = ? AND excluido_em IS NULL`,
  )
    .bind(id)
    .first();
  if (!av) return pagina('Não encontrada', '<h1>Avaliação não encontrada</h1>', 404);

  const estrelas = '★'.repeat(av.estrelas) + '☆'.repeat(5 - av.estrelas);
  let foto = '';
  if (av.foto_tipo) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    foto = `<img src="${escaparHtml(await linkAssinado(env, `/avaliacoes/${id}/foto`, id, 'foto', exp))}" width="80" height="80" alt="">`;
  }
  const campos = ['id', 'acao', 'exp', 'sig']
    .map((k) => `<input type="hidden" name="${k}" value="${escaparHtml(p.get(k))}">`)
    .join('');
  const aprovando = acao === 'aprovar';

  return pagina(
    aprovando ? 'Aprovar avaliação' : 'Recusar avaliação',
    `<h1>${aprovando ? 'Aprovar' : 'Recusar'} esta avaliação?</h1>` +
      `<p class="dim">Situação atual: ${escaparHtml(av.status)}</p>` +
      `<div class="card">${foto}<b>${escaparHtml(av.nome)}</b> <span class="dim">· ${escaparHtml(av.profissao)}</span>` +
      `<div class="st">${estrelas}</div><p>${escaparHtml(av.comentario)}</p></div>` +
      `<form method="post" action="/moderar">${campos}` +
      `<button class="${aprovando ? 'ok' : 'no'}" type="submit">${aprovando ? 'Aprovar e publicar' : 'Recusar'}</button></form>`,
  );
}

async function aplicarModeracao(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return pagina('Requisição inválida', '<h1>Requisição inválida</h1>', 400);
  }
  const id = String(form.get('id') || '');
  const acao = String(form.get('acao') || '');
  if (!ACOES[acao] || !(await assinaturaValida(env, id, acao, form.get('exp'), String(form.get('sig') || '')))) {
    return pagina('Link inválido', '<h1>Link inválido ou expirado</h1>', 403);
  }

  const r = await env.DB.prepare(
    `UPDATE avaliacoes SET status = ?, moderado_em = ? WHERE id = ? AND excluido_em IS NULL`,
  )
    .bind(ACOES[acao], new Date().toISOString(), id)
    .run();
  if (!r.meta || r.meta.changes === 0) return pagina('Não encontrada', '<h1>Avaliação não encontrada</h1>', 404);

  return pagina(
    'Pronto',
    acao === 'aprovar'
      ? '<h1>Avaliação aprovada</h1><p class="dim">Ela aparece no site em até 5 minutos.</p>'
      : '<h1>Avaliação recusada</h1><p class="dim">Ela não será publicada.</p>',
  );
}

/* --- roteamento ------------------------------------------------------------------ */

export default {
  async fetch(request, env) {
    const origem = origemLiberada(request.headers.get('Origin'), env);
    const url = new URL(request.url);
    const { pathname } = url;
    const metodo = request.method;

    if (metodo === 'OPTIONS') return new Response(null, { status: 204, headers: cabecalhos(origem) });

    try {
      if (pathname === '/avaliacoes') {
        if (metodo === 'GET') return await listarAvaliacoes(env, origem);
        if (metodo === 'POST') return await criarAvaliacao(request, env, origem);
        return erro('METHOD_NOT_ALLOWED', 405, origem);
      }

      const foto = /^\/avaliacoes\/([0-9a-f-]{36})\/foto$/.exec(pathname);
      if (foto) {
        if (metodo !== 'GET') return erro('METHOD_NOT_ALLOWED', 405, origem);
        return await servirFoto(url, env, foto[1]);
      }

      if (pathname === '/moderar') {
        if (metodo === 'GET') return await confirmarModeracao(url, env);
        if (metodo === 'POST') return await aplicarModeracao(request, env);
        return erro('METHOD_NOT_ALLOWED', 405, origem);
      }

      return erro('NOT_FOUND', 404, origem);
    } catch (e) {
      /* Detalhe só no log. */
      console.error('Erro inesperado:', e && e.stack);
      return erro('INTERNAL_ERROR', 500, origem);
    }
  },
};
