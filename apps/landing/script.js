/* Rory Systems — landing
   Progressive enhancement: sem JS, a página é inteiramente funcional e
   visível (formulário cai no mailto, .reveal já nasce visível). Com JS,
   ganha menu mobile, revelação suave em scroll e envio assíncrono do
   formulário. */

(function () {
  document.documentElement.classList.replace('no-js', 'js');

  /* ---- menu mobile ------------------------------------------------------- */
  var burger = document.getElementById('burger');
  var mnav = document.getElementById('mnav');

  if (burger && mnav) {
    burger.addEventListener('click', function () {
      var open = burger.getAttribute('aria-expanded') === 'true';
      burger.setAttribute('aria-expanded', String(!open));
      mnav.classList.toggle('is-open', !open);
    });

    mnav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        burger.setAttribute('aria-expanded', 'false');
        mnav.classList.remove('is-open');
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mnav.classList.contains('is-open')) {
        burger.setAttribute('aria-expanded', 'false');
        mnav.classList.remove('is-open');
        burger.focus();
      }
    });
  }

  /* ---- tema claro/escuro --------------------------------------------------- */
  /* O tema inicial já foi resolvido pelo script bloqueante no <head> (cache >
     sistema > escuro). Aqui só cuida do clique: alterna, grava a escolha e
     atualiza o rótulo do botão para leitor de tela. */
  var themeBtn = document.getElementById('theme-toggle');
  var themeMeta = document.querySelector('meta[name="theme-color"]');

  function labelDoBotao(tema) {
    return tema === 'light' ? 'Alternar para tema escuro' : 'Alternar para tema claro';
  }

  if (themeBtn) {
    var temaAtual = document.documentElement.getAttribute('data-theme') || 'dark';
    themeBtn.setAttribute('aria-label', labelDoBotao(temaAtual));

    themeBtn.addEventListener('click', function () {
      var atual = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      var proximo = atual === 'light' ? 'dark' : 'light';

      document.documentElement.setAttribute('data-theme', proximo);
      themeBtn.setAttribute('aria-label', labelDoBotao(proximo));
      if (themeMeta) themeMeta.setAttribute('content', proximo === 'light' ? '#FFFFFF' : '#0A0C10');

      try { localStorage.setItem('rs-theme', proximo); } catch (e) {}
    });
  }

  /* ---- revelação em scroll ------------------------------------------------ */
  var reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var alvos = document.querySelectorAll('.reveal');

  if (!reduzido && 'IntersectionObserver' in window && alvos.length) {
    var obs = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );
    alvos.forEach(function (el) { obs.observe(el); });
  } else {
    alvos.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---- avaliações -------------------------------------------------------- */
  /* Busca as avaliações aprovadas no Worker apps/review-worker e monta os
     cards. Dado de cliente entra só por textContent, nunca como HTML. Sem
     avaliação ou com falha de rede, a seção continua escondida. */
  var secaoAvaliacoes = document.getElementById('avaliacoes');
  var listaAvaliacoes = document.getElementById('reviews-list');

  if (secaoAvaliacoes && listaAvaliacoes && window.fetch) {
    var REVIEWS_API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
      ? 'http://localhost:8787'
      : 'https://reviews.rorysystems.com';
    var SVG_NS = 'http://www.w3.org/2000/svg';

    var el = function (tag, classe, texto) {
      var n = document.createElement(tag);
      if (classe) n.className = classe;
      if (texto != null) n.textContent = texto;
      return n;
    };

    var iniciais = function (nome) {
      var partes = nome.trim().split(/\s+/);
      var primeira = Array.from(partes[0] || '')[0] || '';
      var ultima = partes.length > 1 ? Array.from(partes[partes.length - 1])[0] : '';
      return (primeira + ultima).toUpperCase();
    };

    var estrelasDe = function (nota) {
      var box = el('div', 'review__stars');
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', nota + ' de 5 estrelas');
      for (var i = 1; i <= 5; i++) {
        var svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        if (i <= nota) svg.setAttribute('class', 'is-on');
        var path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', 'M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z');
        svg.appendChild(path);
        box.appendChild(svg);
      }
      return box;
    };

    var cardDe = function (av) {
      var card = el('figure', 'review');
      card.appendChild(estrelasDe(av.estrelas));
      card.appendChild(el('blockquote', 'review__q', av.comentario));

      var quem = el('figcaption', 'review__who');
      var avatar = el('span', 'review__av');
      avatar.setAttribute('aria-hidden', 'true');
      if (av.temFoto) {
        var img = el('img');
        img.src = REVIEWS_API + '/avaliacoes/' + encodeURIComponent(av.id) + '/foto';
        img.alt = '';
        img.loading = 'lazy';
        img.width = 44;
        img.height = 44;
        img.addEventListener('error', function () { avatar.textContent = iniciais(av.nome); });
        avatar.appendChild(img);
      } else {
        avatar.textContent = iniciais(av.nome);
      }
      var nomes = el('span');
      nomes.appendChild(el('span', 'review__n', av.nome));
      nomes.appendChild(el('span', 'review__p', av.profissao));
      quem.appendChild(avatar);
      quem.appendChild(nomes);
      card.appendChild(quem);
      return card;
    };

    fetch(REVIEWS_API + '/avaliacoes', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var itens = data && data.success && Array.isArray(data.itens) ? data.itens : [];
        if (!itens.length) return;
        itens.forEach(function (av) { listaAvaliacoes.appendChild(cardDe(av)); });
        secaoAvaliacoes.hidden = false;
      })
      .catch(function () { /* seção fica escondida */ });
  }

  /* ---- formulário de contato ---------------------------------------------- */
  /* O envio passa por um Worker na Cloudflare (apps/contact-worker), que fala
     com o SMTP da Brevo. A URL abaixo é pública de propósito: quem protege o
     endpoint é o CORS, o rate limit por IP e o honeypot, tudo do lado de lá.
     Credencial de SMTP nenhuma chega até aqui. */
  var CONTACT_ENDPOINT = 'https://api.rorysystems.com/contato';

  /* Turnstile (CAPTCHA da Cloudflare) fica desligado enquanto esta chave
     estiver vazia. O Worker só passa a exigir o token quando o secret
     correspondente for gravado lá. Para ligar: cole a site key aqui e rode
     `wrangler secret put TURNSTILE_SECRET` nos dois Workers (contato e
     avaliações). A página /avaliar/ usa esta mesma chave. */
  var TURNSTILE_SITEKEY = '0x4AAAAAAFCpaUCpAB9zwh6l';

  /* Monta o widget antes do botão de envio e devolve como ler e renovar o
     token. Com a chave vazia devolve null e o formulário segue sem desafio. */
  window.roryTurnstile = function (botao) {
    if (!TURNSTILE_SITEKEY || !botao) return null;
    var caixa = document.createElement('div');
    caixa.className = 'cf-turnstile';
    caixa.setAttribute('data-sitekey', TURNSTILE_SITEKEY);
    botao.parentNode.insertBefore(caixa, botao);
    if (!document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile/"]')) {
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
    return {
      token: function () {
        var campo = caixa.querySelector('[name="cf-turnstile-response"]');
        return campo ? campo.value : '';
      },
      /* O token vale para uma verificação só. Depois de qualquer resposta do
         servidor, deu certo ou não, o próximo envio precisa de outro. */
      renovar: function () {
        if (window.turnstile) window.turnstile.reset(caixa);
      },
    };
  };
  var TURNSTILE_PENDENTE = 'Aguarde a verificação de segurança terminar e envie de novo.';

  var form = document.getElementById('contact-form');
  var msg = document.getElementById('form-msg');
  var submitBtn = document.getElementById('contact-submit');

  /* DDD + 8 dígitos (fixo) ou DDD + 9 (celular). Formata enquanto digita:
     (12) 1234-5678 ou (47) 12345-6789. */
  function mascaraTelefone(valor) {
    var d = valor.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d.length ? '(' + d : '';
    var resto = d.slice(2);
    var corte = d.length === 11 ? 5 : 4;
    var numero = resto.length > corte ? resto.slice(0, corte) + '-' + resto.slice(corte) : resto;
    return '(' + d.slice(0, 2) + ') ' + numero;
  }

  if (form) {
    var desafio = window.roryTurnstile(submitBtn);

    if (form.telefone) {
      form.telefone.addEventListener('input', function () {
        form.telefone.value = mascaraTelefone(form.telefone.value);
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      if (form.botcheck && form.botcheck.value) return; // honeypot acionado

      var dados = {};
      new FormData(form).forEach(function (valor, chave) { dados[chave] = valor; });

      var digitos = String(dados.telefone || '').replace(/\D/g, '');
      if (digitos && digitos.length !== 10 && digitos.length !== 11) {
        msg.textContent = 'Informe o WhatsApp com DDD: 10 ou 11 números.';
        msg.className = 'form-msg is-err';
        form.telefone.focus();
        return;
      }

      /* O widget também injeta cf-turnstile-response no form; o Worker lê
         só o campo turnstile. */
      delete dados['cf-turnstile-response'];
      if (desafio) {
        dados.turnstile = desafio.token();
        if (!dados.turnstile) {
          msg.textContent = TURNSTILE_PENDENTE;
          msg.className = 'form-msg is-err';
          return;
        }
      }

      submitBtn.disabled = true;
      msg.textContent = 'Enviando...';
      msg.className = 'form-msg';

      fetch(CONTACT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(dados),
      })
        .then(function (r) {
          return r.json().then(function (data) { return { ok: r.ok, data: data }; });
        })
        .then(function (res) {
          if (res.ok && res.data.success) {
            form.reset();
            msg.textContent = 'Mensagem enviada. Respondemos em até 24 horas úteis.';
            msg.className = 'form-msg is-ok';
          } else {
            throw new Error(res.data.message || 'Falha no envio');
          }
        })
        .catch(function (erro) {
          /* Mensagem do servidor (e-mail inválido, rate limit) é útil para o
             visitante; falha de rede não é, então cai no texto genérico. */
          msg.textContent = erro && erro.message && erro.message !== 'Failed to fetch'
            ? erro.message
            : 'Falha ao enviar. Tente novamente ou use o WhatsApp ao lado.';
          msg.className = 'form-msg is-err';
        })
        .finally(function () {
          if (desafio) desafio.renovar();
          submitBtn.disabled = false;
        });
    });
  }
})();
