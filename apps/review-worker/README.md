# rory-reviews — avaliações de clientes

Worker da Cloudflare por trás das avaliações do site. Responde em
`https://reviews.rorysystems.com`.

## Como funciona

1. O cliente recebe o link `https://www.rorysystems.com/avaliar/`. A página
   não está no menu nem no sitemap e tem `noindex`.
2. Ele envia nome, profissão, foto opcional, nota de 1 a 5 e comentário de
   até 244 caracteres. A foto já sai do navegador recortada em 256×256.
3. O Worker valida tudo de novo, grava no D1 como `Pendente` e manda para
   `MAIL_TO` um e-mail com a prévia e os links **Aprovar** / **Recusar**.
4. O link abre uma página de confirmação; só o botão dela muda o status. Um
   GET nunca aprova nada, porque filtro de link de e-mail abre as URLs sozinho.
5. A landing busca `GET /avaliacoes` e mostra a seção `#avaliacoes` quando
   existe ao menos uma aprovada.

## Rotas

| Rota | O que faz |
|---|---|
| `POST /avaliacoes` | Recebe uma avaliação (origem liberada, JSON, até 120 KB) |
| `GET /avaliacoes` | Até 24 aprovadas, mais recentes primeiro, cache de 5 min |
| `GET /avaliacoes/:id/foto` | Foto de uma aprovada, ou de uma pendente com link assinado |
| `GET /moderar` | Página de confirmação a partir do link do e-mail |
| `POST /moderar` | Aplica a aprovação ou a recusa |

A API responde só códigos (`INVALID_NAME`, `COMMENT_TOO_LONG`,
`RATE_LIMITED`...). O texto exibido ao cliente fica em
`apps/landing/avaliar/avaliar.js`.

## Proteções

| Camada | O que faz |
|---|---|
| Origem | Allowlist em `ALLOWED_ORIGINS`; POST sem origem liberada é 403 |
| Rate limit | 20/min no Worker inteiro, 3/min por IP |
| Tamanho | Corta acima de 120 KB, por `Content-Length` e lendo o corpo em stream até o limite |
| Honeypot | Campo invisível preenchido responde 200 sem gravar |
| Turnstile | Opcional, inerte até gravar `TURNSTILE_SECRET` |
| Validação | Tamanhos contados em caracteres reais; links no comentário são recusados |
| Foto | Só WebP/JPEG/PNG até 60 KB, com os bytes conferidos contra o tipo |
| Links de moderação | HMAC-SHA256 com `REVIEW_SECRET`, validade de 30 dias |
| Página de moderação | CSP fechada, `noindex`, escape de HTML em todo campo |

## Setup

```bash
cd apps/review-worker
npm install
npx wrangler login
npx wrangler d1 create rory-reviews
```

Cole o `database_id` que o comando imprimir em `wrangler.toml`, no lugar de
`PREENCHER_COM_O_ID_DO_D1`. Depois:

```bash
npx wrangler d1 execute rory-reviews --remote --file=schema.sql
openssl rand -hex 32 | npx wrangler secret put REVIEW_SECRET
npx wrangler secret put SMTP_USER   # mesmo login SMTP da Brevo do Worker de contato
npx wrangler secret put SMTP_PASS
npx wrangler deploy
```

O `custom_domain` cria o registro DNS de `reviews.rorysystems.com` no
próprio deploy.

Sem `SMTP_USER`/`SMTP_PASS` o Worker continua aceitando avaliações; o
e-mail só vira uma linha de log. Nesse caso, modere à mão (abaixo).

## Moderar à mão

```bash
# pendentes
npx wrangler d1 execute rory-reviews --remote \
  --command "SELECT id, nome, estrelas, comentario FROM avaliacoes WHERE status='Pendente' AND excluido_em IS NULL"

# aprovar
npx wrangler d1 execute rory-reviews --remote \
  --command "UPDATE avaliacoes SET status='Aprovada', moderado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='<id>'"

# tirar do site sem apagar (soft delete)
npx wrangler d1 execute rory-reviews --remote \
  --command "UPDATE avaliacoes SET excluido_em=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='<id>'"
```

## Desenvolvimento local

```bash
cp .dev.vars.example .dev.vars   # gitignored
npx wrangler d1 execute rory-reviews --local --file=schema.sql
npx wrangler dev
```

Em `localhost`, a landing e a página `/avaliar/` apontam sozinhas para
`http://localhost:8787`. Acrescente a origem local (por exemplo
`http://localhost:8080`) em `ALLOWED_ORIGINS` enquanto testar, e remova
depois.
