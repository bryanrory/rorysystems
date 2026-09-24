/* Rory Systems — página de avaliação (rorysystems.com/avaliar/).
   Tema e classe js já vêm do /script.js. Aqui ficam o seletor de estrelas,
   o contador do comentário, o recorte da foto e o envio para o Worker
   apps/review-worker. Toda validação vale de verdade lá; a daqui só poupa
   uma ida ao servidor. */

(function () {
  var ENDPOINT = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? 'http://localhost:8787/avaliacoes'
    : 'https://reviews.rorysystems.com/avaliacoes';

  var LADO_FOTO = 256;
  var FOTO_MAX = 60 * 1024;
  var COMENTARIO_MAX = 244;

  /* O Worker responde só códigos; o texto que o cliente lê mora aqui. */
  var MENSAGENS = {
    INVALID_NAME: 'Informe seu nome (de 2 a 80 caracteres).',
    INVALID_PROFESSION: 'Informe sua profissão (de 2 a 80 caracteres).',
    INVALID_STARS: 'Escolha uma nota de 1 a 5 estrelas.',
    COMMENT_TOO_SHORT: 'Escreva um comentário.',
    COMMENT_TOO_LONG: 'O comentário pode ter no máximo 244 caracteres.',
    CONSENT_REQUIRED: 'Marque a autorização de publicação para enviar.',
    LINKS_NOT_ALLOWED: 'Tire os links do comentário, por favor.',
    INVALID_PHOTO: 'Não conseguimos usar essa foto. Tente outra imagem.',
    PHOTO_TOO_LARGE: 'A foto ficou grande demais. Tente outra imagem.',
    PAYLOAD_TOO_LARGE: 'A foto ficou grande demais. Tente outra imagem.',
    REVIEWS_PAUSED: 'Estamos com muitas avaliações para revisar. Tente de novo mais tarde ou mande pelo WhatsApp.',
    RATE_LIMITED: 'Muitos envios agora. Aguarde um minuto e tente de novo.',
    CAPTCHA_FAILED: 'Não conseguimos confirmar o envio. Recarregue a página.',
    CAPTCHA_PENDING: 'Aguarde a verificação de segurança terminar e envie de novo.',
  };
  var MENSAGEM_PADRAO = 'Não conseguimos enviar agora. Tente de novo ou fale com a gente pelo WhatsApp.';

  var form = document.getElementById('review-form');
  if (!form) return;

  var msg = document.getElementById('review-msg');
  var submitBtn = document.getElementById('review-submit');
  var estrelas = document.getElementById('rv-stars');
  var comentario = document.getElementById('rv-comentario');
  var contador = document.getElementById('rv-count-n');
  var inputFoto = document.getElementById('rv-foto');
  var rotuloFoto = document.getElementById('rv-foto-label');
  var removerFoto = document.getElementById('rv-foto-rm');
  var previa = document.getElementById('rv-preview');
  var previaVazia = previa.innerHTML;
  var concluido = document.getElementById('rv-done');

  var fotoDataUrl = '';
  /* Widget e chave vêm de /script.js, carregado antes desta página. */
  var desafio = window.roryTurnstile ? window.roryTurnstile(submitBtn) : null;

  function mostrarErro(texto) {
    msg.textContent = texto;
    msg.className = 'form-msg is-err';
  }

  /* ---- estrelas ------------------------------------------------------------ */
  /* data-show pinta as N primeiras. Passar o mouse mostra a prévia; ao sair,
     volta para a nota marcada. */
  function notaMarcada() {
    var r = form.querySelector('input[name="estrelas"]:checked');
    return r ? Number(r.value) : 0;
  }
  function pintar(n) { estrelas.setAttribute('data-show', String(n)); }

  estrelas.addEventListener('change', function () { pintar(notaMarcada()); });
  estrelas.querySelectorAll('label').forEach(function (label, i) {
    label.addEventListener('mouseenter', function () { pintar(i + 1); });
  });
  estrelas.addEventListener('mouseleave', function () { pintar(notaMarcada()); });

  /* ---- contador ------------------------------------------------------------ */
  /* Conta caractere de verdade (emoji vale um), igual ao Worker. O maxlength
     do textarea conta em UTF-16, então o corte final é feito aqui. */
  function caracteres(texto) { return Array.from(texto); }

  function atualizarContador() {
    var chars = caracteres(comentario.value);
    if (chars.length > COMENTARIO_MAX) {
      comentario.value = chars.slice(0, COMENTARIO_MAX).join('');
      chars = caracteres(comentario.value);
    }
    contador.textContent = String(chars.length);
    contador.parentNode.classList.toggle('is-full', chars.length >= COMENTARIO_MAX);
  }
  comentario.removeAttribute('maxlength');
  comentario.addEventListener('input', atualizarContador);
  atualizarContador();

  /* ---- foto ---------------------------------------------------------------- */
  /* Recorta o centro em quadrado e reduz para 256px antes de enviar. Foto de
     celular com 4 MB vira ~20 KB, e o Worker nunca recebe imagem crua. */
  function bytesDe(dataUrl) {
    var base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return Math.floor(base64.length * 3 / 4);
  }

  function codificar(canvas, qualidade) {
    var url = canvas.toDataURL('image/webp', qualidade);
    /* Navegador sem encoder WebP devolve PNG; nesse caso JPEG sai menor. */
    if (url.indexOf('data:image/webp') !== 0) url = canvas.toDataURL('image/jpeg', qualidade);
    return url;
  }

  function processarFoto(arquivo) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var objeto = URL.createObjectURL(arquivo);
      img.onload = function () {
        URL.revokeObjectURL(objeto);
        var lado = Math.min(img.naturalWidth, img.naturalHeight);
        if (!lado) return reject(new Error('INVALID_PHOTO'));
        var canvas = document.createElement('canvas');
        canvas.width = canvas.height = LADO_FOTO;
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
          img,
          (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado,
          0, 0, LADO_FOTO, LADO_FOTO
        );
        var url = codificar(canvas, 0.82);
        if (bytesDe(url) > FOTO_MAX) url = codificar(canvas, 0.6);
        if (bytesDe(url) > FOTO_MAX) return reject(new Error('PHOTO_TOO_LARGE'));
        resolve(url);
      };
      img.onerror = function () {
        URL.revokeObjectURL(objeto);
        reject(new Error('INVALID_PHOTO'));
      };
      img.src = objeto;
    });
  }

  function limparFoto() {
    fotoDataUrl = '';
    inputFoto.value = '';
    previa.innerHTML = previaVazia;
    rotuloFoto.textContent = 'Escolher foto';
    removerFoto.hidden = true;
  }

  inputFoto.addEventListener('change', function () {
    var arquivo = inputFoto.files && inputFoto.files[0];
    if (!arquivo) return;
    msg.textContent = '';
    processarFoto(arquivo)
      .then(function (url) {
        fotoDataUrl = url;
        var img = document.createElement('img');
        img.src = url;
        img.alt = '';
        previa.replaceChildren(img);
        rotuloFoto.textContent = 'Trocar foto';
        removerFoto.hidden = false;
      })
      .catch(function (erro) {
        limparFoto();
        mostrarErro(MENSAGENS[erro.message] || MENSAGENS.INVALID_PHOTO);
      });
  });

  removerFoto.addEventListener('click', limparFoto);

  /* ---- envio --------------------------------------------------------------- */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (form.botcheck && form.botcheck.value) return; // honeypot acionado

    var dados = {
      nome: form.nome.value.trim(),
      profissao: form.profissao.value.trim(),
      estrelas: notaMarcada(),
      comentario: comentario.value.trim(),
      consentimento: form.consentimento.checked,
      foto: fotoDataUrl || null,
    };

    var codigo =
      caracteres(dados.nome).length < 2 ? 'INVALID_NAME' :
      caracteres(dados.profissao).length < 2 ? 'INVALID_PROFESSION' :
      !dados.estrelas ? 'INVALID_STARS' :
      caracteres(dados.comentario).length < 3 ? 'COMMENT_TOO_SHORT' :
      !dados.consentimento ? 'CONSENT_REQUIRED' : null;
    if (!codigo && desafio) {
      dados.turnstile = desafio.token();
      if (!dados.turnstile) codigo = 'CAPTCHA_PENDING';
    }
    if (codigo) return mostrarErro(MENSAGENS[codigo]);

    submitBtn.disabled = true;
    msg.textContent = 'Enviando...';
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
        if (!res.ok || !res.data.success) throw new Error(res.data.code || '');
        form.hidden = true;
        concluido.hidden = false;
        concluido.focus();
      })
      .catch(function (erro) {
        mostrarErro(MENSAGENS[erro && erro.message] || MENSAGEM_PADRAO);
      })
      .finally(function () {
        if (desafio) desafio.renovar();
        submitBtn.disabled = false;
      });
  });
})();
