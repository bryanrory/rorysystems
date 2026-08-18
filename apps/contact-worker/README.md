# rory-contact — endpoint do formulário

Worker da Cloudflare que recebe o POST do formulário da landing e envia o
e-mail pelo SMTP da Brevo. Responde em `https://api.rorysystems.com/contato`.

## Por que ele existe

A landing é estática e mora no GitHub Pages. JavaScript de página não abre
conexão SMTP, e mesmo que abrisse a chave da Brevo estaria legível em
`view-source` — o relay viraria spam em horas. Este Worker é a única peça
que enxerga a credencial, e ela fica em **secret da Cloudflare**, fora do
repositório.

## Camadas de proteção

As checagens rodam em ordem de custo crescente, então um flood é rejeitado
antes de chegar na parte cara (rate limit, Turnstile, SMTP):

| Camada | O que faz |
|---|---|
| Método e rota | Só `POST` em `/` ou `/contato`; o resto é 404/405 |
| Origem | Allowlist estrita via `ALLOWED_ORIGINS`; sem match, 403 |
| Content-Type | Exige `application/json`, o que força o preflight CORS |
| Tamanho | Corta acima de 16 KB, por `Content-Length` e pelo corpo real |
| Rate limit global | 60 req/min no Worker inteiro — segura botnet distribuída |
| Rate limit por IP | 5 req/min — segura o abusador de uma máquina só |
| Rate limit por e-mail | 3 req/min — impede inundar a caixa trocando de IP |
| Honeypot | Campo invisível preenchido responde 200 sem enviar nada |
| Turnstile | CAPTCHA invisível, opcional (ver abaixo) |
| Heurística de spam | Excesso de links, markup de link, campos idênticos |
| Injeção de cabeçalho | CR/LF removido de tudo que vira Subject/Reply-To |
| Escape de HTML | Corpo do e-mail escapado campo a campo |
| Vazamento de erro | Detalhe só no log; cliente recebe texto genérico |

O `From` é sempre `contato@rorysystems.com`, assinado por DKIM da Brevo. O
e-mail do visitante entra apenas como `Reply-To` — usar o domínio dele no
`From` quebraria DMARC e cairia direto em spam.

## Setup

```bash
cd apps/contact-worker
npm install
npx wrangler login
```

Grave as credenciais como secret — elas nunca entram em arquivo versionado:

```bash
npx wrangler secret put SMTP_USER   # login SMTP da Brevo (…@smtp-brevo.com)
npx wrangler secret put SMTP_PASS   # a chave xsmtpsib-…
```

Publique:

```bash
npx wrangler deploy
```

Como `rorysystems.com` já está na Cloudflare, o `custom_domain` do
`wrangler.toml` faz o próprio deploy criar o registro DNS de
`api.rorysystems.com`. Não precisa mexer no painel.

## Ligar o Turnstile (opcional)

O código já está pronto nos dois lados e fica inerte enquanto não for
configurado. Para ativar:

1. Painel Cloudflare → Turnstile → Add widget, domínio `rorysystems.com`.
2. Cole a **site key** em `TURNSTILE_SITEKEY`, em `apps/landing/script.js`.
3. `npx wrangler secret put TURNSTILE_SECRET` com a **secret key**.

A partir daí o Worker rejeita qualquer envio sem token válido.

## Configuração não secreta

Fica em `[vars]` no `wrangler.toml`, versionada por ser pública:
`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `MAIL_FROM_NAME`, `MAIL_TO` e
`ALLOWED_ORIGINS`. Para trocar o destinatário, edite `MAIL_TO` e refaça o
deploy.

## Desenvolvimento local

`wrangler dev` só abre socket TCP no runtime real da Cloudflare, então use
`--remote`:

```bash
cp .dev.vars.example .dev.vars   # preencha; o arquivo é gitignored
npx wrangler dev --remote
```

Acrescente a origem local em `ALLOWED_ORIGINS` enquanto testar, e remova
depois.

## Verificar um envio

```bash
curl -i https://api.rorysystems.com/contato \
  -H 'Origin: https://rorysystems.com' \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Teste","email":"voce@exemplo.com","mensagem":"ping do curl"}'
```

Esperado: `HTTP/2 200` com `{"success":true}`. Logs ao vivo com
`npx wrangler tail`.
