/* Rory Systems — endpoint dos formulários do site.

   O site é estático (GitHub Pages), então o envio não pode acontecer no
   navegador: a chave SMTP ficaria legível no código-fonte e o relay viraria
   spam em questão de horas. Este Worker é a única peça que enxerga a
   credencial, e ela vem de secret da Cloudflare — nunca do repositório.

   Duas rotas, mesmas defesas:

     POST /  ou  /contato   formulário de contato da home → e-mail
     POST /feedback         depoimento de cliente → grava no D1 e notifica

   As checagens abaixo estão em ordem de custo crescente: o que é barato de
   rejeitar (método, rota, origem, tamanho) roda antes do que é caro
   (rate limit, Turnstile, banco, SMTP). Um flood nunca chega na parte cara, e
   como essa camada é comum às duas rotas, endpoint novo nasce protegido sem
   ninguém precisar lembrar de repetir nada. */

import { WorkerMailer } from 'worker-mailer';

const ROTAS_CONTATO = ['/', '/contato'];
const ROTAS_FEEDBACK = ['/feedback'];

const TAMANHO_MAX = 16 * 1024; // 16 KB — o formulário maior possível não passa de ~6 KB
const LIMITES = { nome: 120, email: 200, telefone: 40, assunto: 120, mensagem: 5000 };
const LIMITES_FEEDBACK = {
  nome: 120, cargo: 120, empresa: 120, servico: 80, email: 200, foto_url: 500,
  desafio: 2000, resultado: 2000,
  /* 300 é o mesmo teto do maxlength do textarea e do contador em
     apps/landing/feedback/feedback.js. Os três precisam concordar. */
  depoimento: 300,
};

/* Os mesmos três rótulos do select de /feedback e do content/testimonials.json.
   Qualquer outro valor é requisição forjada ou formulário desatualizado. */
const SERVICOS = [
  'Sustentação de Sistemas',
  'Desenvolvimento de Novo Produto',
  'Site / Landing Page de Conversão',
];

const MAX_LINKS = 4; // texto legítimo raramente passa disso; spam sempre passa

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
  return String(texto).replace(/[&<>"']/g, (c) => ({
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

/* Recebe o texto livre do formulário e o nome informado, para servir às duas
   rotas — no contato o texto é a mensagem, no depoimento são as três
   respostas concatenadas. */
function cheiroDeSpam(texto, nome) {
  const links = (texto.match(/https?:\/\/|www\./gi) || []).length;
  if (links > MAX_LINKS) return 'links demais';
  /* Formulário de spam costuma repetir o mesmo texto em todos os campos. */
  if (texto.length > 20 && texto === nome) return 'campos idênticos';
  if (/\[url=|\[link=|<a\s+href/i.test(texto)) return 'markup de link';
  return null;
}

/* Monta as duas versões do e-mail (texto e HTML) a partir de uma lista de
   pares rótulo/valor e de blocos de texto longo. Serve às duas rotas porque a
   forma da notificação é a mesma; muda só o que entra nela. */
function montarEmail(titulo, linhas, blocos, rodape) {
  const texto =
    linhas.map(([k, v]) => `${k}: ${v}`).join('\n') +
    blocos.map(([k, v]) => `\n\n${k}:\n${v}`).join('') +
    `\n\n---\n${rodape}`;

  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#111">` +
    `<h2 style="margin:0 0 16px;font-size:17px">${escaparHtml(titulo)}</h2>` +
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">` +
    linhas
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 16px 4px 0;color:#666;vertical-align:top">${escaparHtml(k)}</td>` +
          `<td style="padding:4px 0"><b>${escaparHtml(v)}</b></td></tr>`,
      )
      .join('') +
    `</table>` +
    blocos
      .map(
        ([k, v]) =>
          `<p style="margin:20px 0 6px;color:#666">${escaparHtml(k)}</p>` +
          `<div style="white-space:pre-wrap;padding:12px 14px;background:#f5f5f5;border-radius:8px">${escaparHtml(v)}</div>`,
      )
      .join('') +
    `<p style="margin-top:20px;font-size:12px;color:#999">${escaparHtml(rodape)}</p>` +
    `</div>`;

  return { texto, html };
}

async function enviarEmail(env, mensagem) {
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
    mensagem,
  );
}

/* --- rota do formulário de contato ------------------------------------------ */

async function tratarContato(corpo, ctx) {
  const { env, origem, ip, pais } = ctx;

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

  const motivo = cheiroDeSpam(dados.mensagem, dados.nome);
  if (motivo) {
    /* Mesma tática do honeypot: não confirmamos ao spammer o que o pegou. */
    console.log('Descartado como spam:', motivo, 'de', ip);
    return json({ success: true }, 200, origem);
  }

  if (await limiteEstourado(env.RL_EMAIL, dados.email)) {
    return json({ success: false, message: 'Você já enviou uma mensagem agora há pouco. Já vamos responder.' }, 429, origem);
  }

  /* Falha de configuração, não do visitante: sem os secrets gravados o
     envio nunca vai funcionar, e o log precisa dizer isso com todas as
     letras em vez de virar um 502 genérico. */
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    console.error('SMTP_USER/SMTP_PASS ausentes — rode `wrangler secret put`.');
    return json({ success: false, message: 'Formulário indisponível no momento. Use o WhatsApp, por favor.' }, 503, origem);
  }

  const { texto, html } = montarEmail(
    'Novo contato pelo site',
    [
      ['Nome', dados.nome],
      ['E-mail', dados.email],
      ['WhatsApp', dados.telefone || '—'],
      ['Assunto', dados.assunto || '—'],
    ],
    [['Mensagem', dados.mensagem]],
    `Enviado pelo formulário de rorysystems.com · IP ${ip} · ${pais}`,
  );

  try {
    await enviarEmail(env, {
      /* From é sempre nosso domínio (assinado por DKIM da Brevo). O e-mail do
         visitante entra só como Reply-To — usar o domínio dele no From
         quebraria DMARC e cairia em spam. */
      from: { name: env.MAIL_FROM_NAME || 'Rory Systems', email: env.MAIL_FROM },
      to: env.MAIL_TO,
      reply: { name: dados.nome, email: dados.email },
      subject: `[Site] ${dados.assunto || 'Contato'} — ${dados.nome}`,
      text: texto,
      html,
    });
  } catch (erro) {
    /* Detalhe do erro fica no log; o cliente recebe texto genérico para não
       virar ferramenta de sondagem do servidor SMTP. */
    console.error('Falha no envio SMTP:', erro && erro.message);
    return json({ success: false, message: 'Não conseguimos enviar agora. Tente pelo WhatsApp, por favor.' }, 502, origem);
  }

  return json({ success: true }, 200, origem);
}

/* --- rota do formulário de depoimento --------------------------------------- */

/* Notificação do depoimento. Roda em waitUntil, depois do registro já estar
   salvo, então trata o próprio erro: com o depoimento no banco, e-mail que não
   sai é aborrecimento recuperável, não perda de dado. */
async function notificarDepoimento(dados, meta, env) {
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    console.error(`Depoimento #${meta.id} salvo, mas SMTP_USER/SMTP_PASS estão ausentes — notificação não enviada.`);
    return;
  }

  const consentimento = dados.autorizado
    ? 'SIM — autorizou divulgação no site e em materiais'
    : 'NÃO — avaliação privada, não pode ser publicada';

  const { texto, html } = montarEmail(
    'Novo depoimento pelo site',
    [
      ['Registro', `#${meta.id} (tabela depoimentos, status pendente)`],
      ['Nome', dados.nome],
      ['Cargo', dados.cargo],
      ['Empresa', dados.empresa],
      ['Serviço', dados.servico],
      ['E-mail', dados.email || '—'],
      ['Foto/logo', dados.fotoUrl || '—'],
      ['Divulgação', consentimento],
    ],
    [
      ['Desafio inicial', dados.desafio],
      ['Resultado percebido', dados.resultado],
      ['Depoimento', dados.depoimento],
    ],
    `Enviado pelo formulário de rorysystems.com/feedback · IP ${meta.ip} · ${meta.pais}`,
  );

  try {
    await enviarEmail(env, {
      from: { name: env.MAIL_FROM_NAME || 'Rory Systems', email: env.MAIL_FROM },
      /* Cai na caixa do CEO, e não na comercial: depoimento é curadoria de
         marca, não lead. Sem a var configurada, volta para o destino padrão em
         vez de sumir. */
      to: env.MAIL_TO_FEEDBACK || env.MAIL_TO,
      ...(dados.email ? { reply: { name: dados.nome, email: dados.email } } : {}),
      subject: `[Depoimento] ${dados.empresa} — ${dados.nome}`,
      text: texto,
      html,
    });
  } catch (erro) {
    console.error(`Falha ao notificar o depoimento #${meta.id} por e-mail:`, erro && erro.message);
  }
}

async function tratarFeedback(corpo, ctx) {
  const { env, origem, ip, pais, executionCtx } = ctx;

  const dados = {
    nome: limpar(corpo.nome, LIMITES_FEEDBACK.nome),
    cargo: limpar(corpo.cargo, LIMITES_FEEDBACK.cargo),
    empresa: limpar(corpo.empresa, LIMITES_FEEDBACK.empresa),
    servico: limpar(corpo.servico, LIMITES_FEEDBACK.servico),
    email: limpar(corpo.email, LIMITES_FEEDBACK.email).toLowerCase(),
    fotoUrl: limpar(corpo.foto_url, LIMITES_FEEDBACK.foto_url),
    /* Respostas são corpo, não cabeçalho: quebras de linha ficam. */
    desafio: String(corpo.desafio || '').trim().slice(0, LIMITES_FEEDBACK.desafio),
    resultado: String(corpo.resultado || '').trim().slice(0, LIMITES_FEEDBACK.resultado),
    depoimento: String(corpo.depoimento || '').trim().slice(0, LIMITES_FEEDBACK.depoimento),
    /* Só um "sim" explícito autoriza. Ausente, "false", 0, string vazia —
       tudo vira não autorizado. Na dúvida sobre consentimento, não publica. */
    autorizado: corpo.autorizo === true || corpo.autorizo === 'sim',
  };

  const obrigatorios = ['nome', 'cargo', 'empresa', 'desafio', 'resultado', 'depoimento'];
  if (obrigatorios.some((campo) => !dados[campo])) {
    return json({ success: false, message: 'Preencha nome, cargo, empresa e as três perguntas do depoimento.' }, 400, origem);
  }
  if (!SERVICOS.includes(dados.servico)) {
    return json({ success: false, message: 'Selecione um tipo de serviço válido.' }, 400, origem);
  }
  if (dados.email && !emailValido(dados.email)) {
    return json({ success: false, message: 'E-mail inválido.' }, 400, origem);
  }
  if (dados.fotoUrl) {
    /* Só https: um http:// viraria conteúdo misto no card da home, e um
       javascript:/data: viraria coisa pior. */
    let aceita = false;
    try {
      aceita = new URL(dados.fotoUrl).protocol === 'https:';
    } catch {
      aceita = false;
    }
    if (!aceita) {
      return json({ success: false, message: 'A URL da foto precisa começar com https://' }, 400, origem);
    }
  }
  if (dados.depoimento.length < 20) {
    return json({ success: false, message: 'Escreva um pouco mais no depoimento.' }, 400, origem);
  }

  const motivo = cheiroDeSpam(`${dados.desafio}\n${dados.resultado}\n${dados.depoimento}`, dados.nome);
  if (motivo) {
    console.log('Depoimento descartado como spam:', motivo, 'de', ip);
    return json({ success: true }, 200, origem);
  }

  if (dados.email && (await limiteEstourado(env.RL_EMAIL, dados.email))) {
    return json({ success: false, message: 'Você já enviou um depoimento agora há pouco. Obrigado!' }, 429, origem);
  }

  /* Mesma postura do SMTP ausente: é falha de configuração, e o log precisa
     nomeá-la em vez de deixar um 500 genérico para depurar depois. */
  if (!env.DB) {
    console.error('Binding D1 "DB" ausente — crie o banco e preencha database_id no wrangler.toml.');
    return json({ success: false, message: 'Formulário indisponível no momento. Escreva para ceo@rorysystems.com, por favor.' }, 503, origem);
  }

  /* O banco vem antes do e-mail de propósito. Salvo o registro, um e-mail que
     falha é reenviável; na ordem inversa, um banco que falha depois do e-mail
     perderia o depoimento e ninguém saberia qual. */
  let id;
  try {
    const resultado = await env.DB.prepare(
      `INSERT INTO depoimentos
         (nome, cargo, empresa, servico, email, foto_url, desafio, resultado, depoimento, autorizado, ip, pais)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        dados.nome,
        dados.cargo,
        dados.empresa,
        dados.servico,
        dados.email || null,
        dados.fotoUrl || null,
        dados.desafio,
        dados.resultado,
        dados.depoimento,
        dados.autorizado ? 1 : 0,
        ip,
        pais,
      )
      .run();

    id = resultado.meta ? resultado.meta.last_row_id : null;
  } catch (erro) {
    console.error('Falha ao gravar depoimento no D1:', erro && erro.message);
    return json({ success: false, message: 'Não conseguimos registrar seu depoimento agora. Tente de novo em instantes.' }, 503, origem);
  }

  /* Depoimento já está salvo: a pessoa não precisa esperar o SMTP responder
     para ver a confirmação na tela. */
  const notificacao = notificarDepoimento(dados, { id, ip, pais }, env);
  if (executionCtx) executionCtx.waitUntil(notificacao);
  else await notificacao;

  return json({ success: true }, 200, origem);
}

/* --- entrada ----------------------------------------------------------------- */

export default {
  async fetch(request, env, executionCtx) {
    const origem = origemLiberada(request.headers.get('Origin'), env);
    const url = new URL(request.url);

    /* --- camada 1: forma da requisição (custo zero) ----------------------- */

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cabecalhos(origem) });
    }
    if (request.method !== 'POST') {
      return json({ success: false, message: 'Método não permitido.' }, 405, origem);
    }

    let rota = null;
    if (ROTAS_CONTATO.includes(url.pathname)) rota = tratarContato;
    else if (ROTAS_FEEDBACK.includes(url.pathname)) rota = tratarFeedback;
    if (!rota) {
      return json({ success: false, message: 'Rota inexistente.' }, 404, origem);
    }

    /* Sem Origin liberada não respondemos: os formulários só existem no
       domínio do site, e navegador algum manda POST cross-origin sem enviar
       Origin. */
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

    /* --- camada 4: a rota específica --------------------------------------- */

    return rota(corpo, {
      env,
      origem,
      ip,
      pais: request.headers.get('CF-IPCountry') || '??',
      executionCtx,
    });
  },
};
