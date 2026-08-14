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
  /* Web3Forms: serviço sem backend próprio — a chave pública abaixo é
     placeholder. Trocar por uma chave real gerada em web3forms.com com o
     e-mail comercial@rorysystems.com antes de publicar. Até lá o formulário
     ainda funciona: o WhatsApp e os links de e-mail no bloco de canais
     cobrem o contato. */
  var WEB3FORMS_ACCESS_KEY = 'SUBSTITUIR_PELA_CHAVE_WEB3FORMS';

  var form = document.getElementById('contact-form');
  var msg = document.getElementById('form-msg');
  var submitBtn = document.getElementById('contact-submit');

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();

      if (form.botcheck && form.botcheck.value) return; // honeypot acionado

      if (WEB3FORMS_ACCESS_KEY.indexOf('SUBSTITUIR') === 0) {
        msg.textContent = 'Formulário ainda não configurado. Use o WhatsApp ou o e-mail ao lado, por favor.';
        msg.className = 'form-msg is-err';
        return;
      }

      var dados = new FormData(form);
      dados.append('access_key', WEB3FORMS_ACCESS_KEY);
      dados.append('subject', 'Novo contato — Rory Systems');
      dados.append('from_name', 'rorysystems.com');

      submitBtn.disabled = true;
      msg.textContent = 'Enviando...';
      msg.className = 'form-msg';

      fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: dados,
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.success) {
            form.reset();
            msg.textContent = 'Mensagem enviada. Respondemos em até 24 horas úteis.';
            msg.className = 'form-msg is-ok';
          } else {
            throw new Error(data.message || 'Falha no envio');
          }
        })
        .catch(function () {
          msg.textContent = 'Falha ao enviar. Tente novamente ou use o WhatsApp ao lado.';
          msg.className = 'form-msg is-err';
        })
        .finally(function () {
          submitBtn.disabled = false;
        });
    });
  }
})();
