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

  /* ---- formulário de contato ---------------------------------------------- */
  /* O envio passa por um Worker na Cloudflare (apps/contact-worker), que fala
     com o SMTP da Brevo. A URL abaixo é pública de propósito: quem protege o
     endpoint é o CORS, o rate limit por IP e o honeypot, tudo do lado de lá.
     Credencial de SMTP nenhuma chega até aqui. */
  var CONTACT_ENDPOINT = 'https://api.rorysystems.com/contato';

  /* Turnstile (CAPTCHA invisível da Cloudflare) fica desligado enquanto esta
     chave estiver vazia — o Worker só passa a exigir o token quando o secret
     correspondente for gravado lá. Para ligar: cole a site key aqui e rode
     `wrangler secret put TURNSTILE_SECRET`. */
  var TURNSTILE_SITEKEY = '';

  var form = document.getElementById('contact-form');
  var msg = document.getElementById('form-msg');
  var submitBtn = document.getElementById('contact-submit');

  if (form) {
    var caixaTurnstile = null;

    if (TURNSTILE_SITEKEY) {
      caixaTurnstile = document.createElement('div');
      caixaTurnstile.className = 'cf-turnstile';
      caixaTurnstile.setAttribute('data-sitekey', TURNSTILE_SITEKEY);
      submitBtn.parentNode.insertBefore(caixaTurnstile, submitBtn);
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      if (form.botcheck && form.botcheck.value) return; // honeypot acionado

      var dados = {};
      new FormData(form).forEach(function (valor, chave) { dados[chave] = valor; });

      if (caixaTurnstile) {
        var campo = caixaTurnstile.querySelector('[name="cf-turnstile-response"]');
        dados.turnstile = campo ? campo.value : '';
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
            if (window.turnstile && caixaTurnstile) window.turnstile.reset();
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
          submitBtn.disabled = false;
        });
    });
  }
})();
