/* Rory Systems — página de depoimento (/feedback)

   Só o que é exclusivo desta página: contador de caracteres da citação e o
   envio do formulário. Tema, classe .js e revelação em scroll continuam vindo
   do script.js da home, carregado logo antes deste arquivo.

   Progressive enhancement, igual ao resto do site: sem JavaScript o formulário
   continua inteiro e legível. O que se perde é o envio assíncrono — por isso a
   página oferece o e-mail direto no rodapé do site como alternativa. */

(function () {
  /* O envio passa pelo mesmo Worker do formulário de contato, em outra rota.
     A URL é pública de propósito: quem protege o endpoint é o CORS, o rate
     limit e o honeypot, tudo do lado de lá. */
  var ENDPOINT = 'https://api.rorysystems.com/feedback';

  /* Mesmo teto do maxlength do textarea e do LIMITES_FEEDBACK do Worker. Os
     três precisam concordar: o textarea impede de passar, o contador avisa
     antes de chegar lá, e o Worker é quem realmente garante. */
  var LIMITE_CITACAO = 300;

  var form = document.getElementById('feedback-form');
  if (!form) return;

  var msg = document.getElementById('feedback-msg');
  var botao = document.getElementById('feedback-submit');
  var rotulo = botao.querySelector('.btn-label');
  var painel = document.getElementById('feedback-done');
  var citacao = document.getElementById('feedback-quote');
  var contador = document.getElementById('feedback-counter');

  /* ---- contador de caracteres --------------------------------------------- */

  if (citacao && contador) {
    var atualizarContador = function () {
      var usados = citacao.value.length;
      var classe = 'counter';

      if (usados >= LIMITE_CITACAO) classe += ' is-full';
      else if (usados >= LIMITE_CITACAO - 40) classe += ' is-near';

      contador.textContent = usados + ' / ' + LIMITE_CITACAO + ' caracteres';
      contador.className = classe;
    };

    citacao.addEventListener('input', atualizarContador);
    /* Navegador restaura o texto digitado num F5 ou no botão voltar; sem esta
       chamada o contador nasceria zerado sobre um campo já preenchido. */
    atualizarContador();
  }

  /* ---- envio --------------------------------------------------------------- */

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    if (form.botcheck && form.botcheck.value) return; // honeypot acionado

    var dados = {};
    new FormData(form).forEach(function (valor, chave) { dados[chave] = valor; });

    /* Checkbox desmarcado simplesmente não entra no FormData. Como a diferença
       entre "não autorizou a divulgação" e "o campo não veio" decide se o
       depoimento pode ir ao site, ela é enviada explicitamente. */
    dados.autorizo = form.autorizo.checked;

    botao.disabled = true;
    if (rotulo) rotulo.textContent = 'Enviando…';
    msg.textContent = 'Enviando seu depoimento...';
    msg.className = 'form-msg';

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(dados),
    })
      .then(function (r) {
        return r.json().then(function (data) { return { ok: r.ok, data: data }; });
      })
      .then(function (res) {
        if (!res.ok || !res.data.success) {
          throw new Error(res.data.message || 'Falha no envio');
        }
        /* O formulário some e dá lugar ao painel de sucesso. O foco vai junto:
           quem navega por teclado ficaria preso num formulário que acabou de
           sair da tela, e o leitor de tela não anunciaria nada. */
        form.hidden = true;
        painel.hidden = false;
        painel.focus();
      })
      .catch(function (erro) {
        /* Mensagem do servidor (campo faltando, rate limit) é útil para quem
           está preenchendo; falha de rede não é, e cai no texto genérico. */
        msg.textContent = erro && erro.message && erro.message !== 'Failed to fetch'
          ? erro.message
          : 'Falha ao enviar. Tente novamente em instantes.';
        msg.className = 'form-msg is-err';

        /* Só restaura o botão no erro: no sucesso o formulário já não existe
           mais na tela. */
        botao.disabled = false;
        if (rotulo) rotulo.textContent = 'Enviar depoimento';
      });
  });
})();
