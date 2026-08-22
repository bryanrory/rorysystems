# rory-contact — endpoint dos formulários

Worker da Cloudflare que atende os formulários da landing, em
`https://api.rorysystems.com`. Duas rotas:

| Rota | Vem de | O que faz |
|---|---|---|
| `POST /` ou `/contato` | formulário de contato da home | envia e-mail para `comercial@` pelo SMTP da Brevo |
| `POST /feedback` | formulário de depoimento em `/feedback` | grava no D1 e notifica `ceo@` |

## Por que ele existe

A landing é estática e mora no GitHub Pages. JavaScript de página não abre
conexão SMTP, e mesmo que abrisse a chave da Brevo estaria legível em
`view-source` — o relay viraria spam em horas. Este Worker é a única peça
que enxerga a credencial, e ela fica em **secret da Cloudflare**, fora do
repositório.

O depoimento tem um motivo a mais para não terminar numa caixa de entrada: ele
passa por curadoria antes de virar card na home e precisa registrar quem
autorizou a divulgação. Isso é consulta com estado, não e-mail — daí o D1.

## Camadas de proteção

As checagens rodam em ordem de custo crescente, então um flood é rejeitado
antes de chegar na parte cara (rate limit, Turnstile, banco, SMTP). Elas valem
para as duas rotas: ficam antes do despacho, de propósito, para que endpoint
novo nasça protegido sem ninguém precisar lembrar de repetir nada.

| Camada | O que faz |
|---|---|
| Método e rota | Só `POST` em `/`, `/contato` ou `/feedback`; o resto é 404/405 |
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

Crie o banco dos depoimentos e aplique a migration:

```bash
npx wrangler d1 create rory-depoimentos     # copie o database_id da saída
#   cole em [[d1_databases]] → database_id, no wrangler.toml
npm run migrate                             # aplica migrations/ no banco remoto
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

## Os depoimentos no D1

Tabela `depoimentos` (ver `migrations/0001_depoimentos.sql`). Duas colunas
carregam a regra e são independentes de propósito:

- **`autorizado`** (0/1) — o que a *pessoa* permitiu. Sem `1` aqui, o depoimento
  nunca pode ir ao site, aconteça o que acontecer do nosso lado.
- **`status`** (`pendente` | `aprovado` | `recusado`) — o que *nós* decidimos.
  Um depoimento autorizado ainda passa por curadoria.

Publicável = `autorizado = 1` **e** `status = 'aprovado'`. Uma coluna só
misturaria consentimento com curadoria, e a primeira aprovação distraída
publicaria o que não podia.

O que já chegou e ainda não foi olhado:

```bash
npx wrangler d1 execute rory-depoimentos --remote \
  --command "SELECT id, criado_em, nome, empresa, servico, autorizado
             FROM depoimentos WHERE status='pendente' ORDER BY criado_em DESC;"
```

Aprovar um depoimento (só faz sentido se `autorizado = 1`):

```bash
npx wrangler d1 execute rory-depoimentos --remote \
  --command "UPDATE depoimentos SET status='aprovado' WHERE id=1 AND autorizado=1;"
```

Aprovar no banco **não** publica nada sozinho: o card da home sai de
`content/testimonials.json`, que é editado à mão e gerado com
`node tools/build-testimonials.mjs`. O banco é a fila de curadoria; o JSON é o
que está no ar.

## Configuração não secreta

Fica em `[vars]` no `wrangler.toml`, versionada por ser pública:
`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `MAIL_FROM_NAME`, `MAIL_TO`,
`MAIL_TO_FEEDBACK` e `ALLOWED_ORIGINS`. Para trocar o destinatário do contato,
edite `MAIL_TO`; o do depoimento é `MAIL_TO_FEEDBACK`. Depois, deploy.

O `database_id` do D1 também mora ali. Ele não é segredo (sem credencial da
conta não serve de nada), mas enquanto estiver vazio o `/feedback` responde
503 de propósito — mesmo comportamento de quando faltam os secrets do SMTP.

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

Contato:

```bash
curl -i https://api.rorysystems.com/contato \
  -H 'Origin: https://rorysystems.com' \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Teste","email":"voce@exemplo.com","mensagem":"ping do curl"}'
```

Depoimento:

```bash
curl -i https://api.rorysystems.com/feedback \
  -H 'Origin: https://rorysystems.com' \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Teste da Silva","cargo":"CTO","empresa":"Empresa Teste",
       "servico":"Sustentação de Sistemas","email":"voce@exemplo.com",
       "desafio":"ping do curl","resultado":"ping do curl",
       "depoimento":"Depoimento de teste enviado pelo curl.","autorizo":false}'
```

Esperado nos dois: `HTTP/2 200` com `{"success":true}`. Logs ao vivo com
`npx wrangler tail`. O depoimento de teste fica no banco — apague depois com
`DELETE FROM depoimentos WHERE id=…`.

Se `/feedback` responder 503, o `database_id` no `wrangler.toml` está vazio ou
a migration não foi aplicada; `npx wrangler tail` diz qual dos dois.
