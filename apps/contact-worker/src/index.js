/* Rory Systems — endpoint do formulário de contato.

   O site é estático (GitHub Pages), então o envio não pode acontecer no
   navegador: a chave SMTP ficaria legível no código-fonte e o relay viraria
   spam em questão de horas. Este Worker é a única peça que enxerga a
   credencial, e ela vem de secret da Cloudflare — nunca do repositório.

   As checagens abaixo estão em ordem de custo crescente: o que é barato de
   rejeitar (método, rota, origem, tamanho) roda antes do que é caro
   (rate limit, Turnstile, SMTP). Um flood nunca chega na parte cara. */

import { WorkerMailer } from 'worker-mailer';

const ROTAS = ['/', '/contato'];
const TAMANHO_MAX = 16 * 1024; // 16 KB — o formulário maior possível não passa de ~6 KB
const LIMITES = { nome: 120, email: 200, telefone: 40, assunto: 120, mensagem: 5000 };
const MAX_LINKS = 4; // mensagem legítima raramente passa disso; spam sempre passa

/* Cabeçalho de e-mail quebra em CR/LF: qualquer valor que vá parar em
   Subject/Reply-To precisa vir sem eles, senão o campo vira injeção. */
function limpar(valor, max) {
  return String(valor == null ? '' : valor)
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, max);
}

function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    /* API JSON não deveria ser interpretada, embutida ou indexada. */
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  if (origem) h['Access-Control-Allow-Origin'] = origem;
  return h;
}

function json(corpo, status, origem) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cabecalhos(origem) },
  });
}

function escaparHtml(texto) {
  return texto.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/* Rate limit tolerante a binding ausente: se o limitador não estiver
   configurado, o Worker segue funcionando em vez de derrubar todo mundo. */
async function limiteEstourado(binding, chave) {
  if (!binding) return false;
  try {
    const { success } = await binding.limit({ key: chave });
    return !success;
  } catch (erro) {
    console.error('Rate limiter falhou:', erro && erro.message);
    return false;
  }
}

/* Turnstile é opcional: só entra em vigor quando o secret está gravado.
   Assim o formulário funciona hoje e ganha o desafio quando você ligar. */
async function turnstileValido(token, ip, env) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  try {
    const corpo = new FormData();
    corpo.append('secret', env.TURNSTILE_SECRET);
    corpo.append('response', token);
    if (ip && ip !== 'desconhecido') corpo.append('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: corpo,
    });
    const dados = await r.json();
    return dados.success === true;
  } catch (erro) {
    /* Falha de rede no siteverify não pode virar porta aberta. */
    console.error('Turnstile indisponível:', erro && erro.message);
    return false;
  }
}

function cheiroDeSpam(dados) {
  const links = (dados.mensagem.match(/https?:\/\/|www\./gi) || []).length;
  if (links > MAX_LINKS) return 'links demais';
  /* Formulário de spam costuma repetir o mesmo texto em todos os campos. */
  if (dados.mensagem.length > 20 && dados.mensagem === dados.nome) return 'campos idênticos';
  if (/\[url=|\[link=|<a\s+href/i.test(dados.mensagem)) return 'markup de link';
  return null;
}

function montarCorpo(dados, meta) {
  const linhas = [
    ['Nome', dados.nome],
    ['E-mail', dados.email],
    ['WhatsApp', dados.telefone || '—'],
    ['Assunto', dados.assunto || '—'],
  ];

  const texto =
    linhas.map(([k, v]) => `${k}: ${v}`).join('\n') +
    `\n\nMensagem:\n${dados.mensagem}\n\n---\nEnviado pelo formulário de rorysystems.com\nIP: ${meta.ip} | ${meta.pais}`;

  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#111">` +
    `<h2 style="margin:0 0 16px;font-size:17px">Novo contato pelo site</h2>` +
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">` +
    linhas
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 16px 4px 0;color:#666;vertical-align:top">${k}</td>` +
          `<td style="padding:4px 0"><b>${escaparHtml(v)}</b></td></tr>`,
      )
      .join('') +
    `</table>` +
    `<p style="margin:20px 0 6px;color:#666">Mensagem</p>` +
    `<div style="white-space:pre-wrap;padding:12px 14px;background:#f5f5f5;border-radius:8px">${escaparHtml(dados.mensagem)}</div>` +
    `<p style="margin-top:20px;font-size:12px;color:#999">rorysystems.com · IP ${escaparHtml(meta.ip)} · ${escaparHtml(meta.pais)}</p>` +
    `</div>`;

  return { texto, html };
}

export default {
  async fetch(request, env) {
    const origem = origemLiberada(request.headers.get('Origin'), env);
    const url = new URL(request.url);

    /* --- camada 1: forma da requisição (custo zero) ----------------------- */

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cabecalhos(origem) });
    }
    if (request.method !== 'POST') {
      return json({ success: false, message: 'Método não permitido.' }, 405, origem);
    }
    if (!ROTAS.includes(url.pathname)) {
      return json({ success: false, message: 'Rota inexistente.' }, 404, origem);
    }
    /* Sem Origin liberada não respondemos: o formulário só existe no domínio
       do site, e navegador algum manda POST cross-origin sem enviar Origin. */
    if (!origem) {
      return json({ success: false, message: 'Origem não autorizada.' }, 403, null);
    }
    /* Exigir JSON força o preflight CORS, que por sua vez força o navegador a
       validar a origem antes mesmo do POST sair. */
    if (!(request.headers.get('Content-Type') || '').toLowerCase().includes('application/json')) {
      return json({ success: false, message: 'Content-Type inválido.' }, 415, origem);
    }
    const declarado = Number(request.headers.get('Content-Length') || 0);
    if (declarado > TAMANHO_MAX) {
      return json({ success: false, message: 'Mensagem grande demais.' }, 413, origem);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'desconhecido';

    /* --- camada 2: rate limit antes de gastar CPU ------------------------- */

    /* Teto global primeiro: é o que segura botnet distribuída, onde cada IP
       manda pouco e passaria pelo limite individual. */
    if (await limiteEstourado(env.RL_GLOBAL, 'global')) {
      return json({ success: false, message: 'Muitos envios agora. Tente em um minuto.' }, 429, origem);
    }
    if (await limiteEstourado(env.RL_IP, ip)) {
      return json({ success: false, message: 'Muitas tentativas. Aguarde um minuto e tente de novo.' }, 429, origem);
    }

    /* --- camada 3: corpo e conteúdo --------------------------------------- */

    const bruto = await request.text();
    /* Content-Length pode vir ausente em requisição chunked; o tamanho real
       é o que vale. */
    if (bruto.length > TAMANHO_MAX) {
      return json({ success: false, message: 'Mensagem grande demais.' }, 413, origem);
    }

    let corpo;
    try {
      corpo = JSON.parse(bruto);
    } catch {
      return json({ success: false, message: 'Requisição inválida.' }, 400, origem);
    }
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
      return json({ success: false, message: 'Requisição inválida.' }, 400, origem);
    }

    /* Honeypot: bot preencheu o campo invisível. Devolvemos sucesso para não
       ensinar o robô onde está a armadilha, mas não enviamos nada. */
    if (limpar(corpo.botcheck, 50)) {
      console.log('Honeypot acionado por', ip);
      return json({ success: true }, 200, origem);
    }

    if (!(await turnstileValido(corpo.turnstile, ip, env))) {
      return json({ success: false, message: 'Não conseguimos confirmar que você é humano. Recarregue a página.' }, 403, origem);
    }

    /* Só lemos campos conhecidos: qualquer chave extra enviada é descartada
       aqui, sem chance de chegar no e-mail. */
    const dados = {
      nome: limpar(corpo.nome, LIMITES.nome),
      email: limpar(corpo.email, LIMITES.email).toLowerCase(),
      telefone: limpar(corpo.telefone, LIMITES.telefone),
      assunto: limpar(corpo.assunto, LIMITES.assunto),
      /* Mensagem é corpo, não cabeçalho: quebras de linha ficam. */
      mensagem: String(corpo.mensagem || '').trim().slice(0, LIMITES.mensagem),
    };

    if (!dados.nome || !dados.email || !dados.mensagem) {
      return json({ success: false, message: 'Preencha nome, e-mail e mensagem.' }, 400, origem);
    }
    if (!emailValido(dados.email)) {
      return json({ success: false, message: 'E-mail inválido.' }, 400, origem);
    }
    if (dados.mensagem.length < 10) {
      return json({ success: false, message: 'Conte um pouco mais sobre o que precisa.' }, 400, origem);
    }

    const motivo = cheiroDeSpam(dados);
    if (motivo) {
      /* Mesma tática do honeypot: não confirmamos ao spammer o que o pegou. */
      console.log('Descartado como spam:', motivo, 'de', ip);
      return json({ success: true }, 200, origem);
    }

    if (await limiteEstourado(env.RL_EMAIL, dados.email)) {
      return json({ success: false, message: 'Você já enviou uma mensagem agora há pouco. Já vamos responder.' }, 429, origem);
    }

    /* --- camada 4: envio --------------------------------------------------- */

    /* Falha de configuração, não do visitante: sem os secrets gravados o
       envio nunca vai funcionar, e o log precisa dizer isso com todas as
       letras em vez de virar um 502 genérico. */
    if (!env.SMTP_USER || !env.SMTP_PASS) {
      console.error('SMTP_USER/SMTP_PASS ausentes — rode `wrangler secret put`.');
      return json({ success: false, message: 'Formulário indisponível no momento. Use o WhatsApp, por favor.' }, 503, origem);
    }

    const { texto, html } = montarCorpo(dados, {
      ip,
      pais: request.headers.get('CF-IPCountry') || '??',
    });

    try {
      await WorkerMailer.send(
        {
          host: env.SMTP_HOST,
          port: Number(env.SMTP_PORT || 587),
          /* 587 abre em texto puro e sobe para TLS via STARTTLS — por isso
             secure:false com startTls:true, e não TLS implícito (465). */
          secure: false,
          startTls: true,
          credentials: { username: env.SMTP_USER, password: env.SMTP_PASS },
          authType: ['plain', 'login'],
        },
        {
          /* From é sempre nosso domínio (assinado por DKIM da Brevo). O
             e-mail do visitante entra só como Reply-To — usar o domínio
             dele no From quebraria DMARC e cairia em spam. */
          from: { name: env.MAIL_FROM_NAME || 'Rory Systems', email: env.MAIL_FROM },
          to: env.MAIL_TO,
          reply: { name: dados.nome, email: dados.email },
          subject: `[Site] ${dados.assunto || 'Contato'} — ${dados.nome}`,
          text: texto,
          html,
        },
      );
    } catch (erro) {
      /* Detalhe do erro fica no log; o cliente recebe texto genérico para não
         virar ferramenta de sondagem do servidor SMTP. */
      console.error('Falha no envio SMTP:', erro && erro.message);
      return json({ success: false, message: 'Não conseguimos enviar agora. Tente pelo WhatsApp, por favor.' }, 502, origem);
    }

    return json({ success: true }, 200, origem);
  },
};
