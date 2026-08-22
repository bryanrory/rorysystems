<div align="center">

<img src="apps/landing/assets/og/og-image.png" alt="Rory Systems" width="480" />

### Sustentamos o que não pode parar. Construímos o que vem a seguir.

[![Site](https://img.shields.io/badge/site-rorysystems.com-3ED6E0?style=flat-square)](https://www.rorysystems.com)
[![Stack](https://img.shields.io/badge/stack-HTML%20%C2%B7%20CSS%20%C2%B7%20JS-2C4A7C?style=flat-square)]()
[![Build](https://img.shields.io/badge/build-nenhum-4EDCA0?style=flat-square)]()
[![Tema](https://img.shields.io/badge/tema-claro%20%2F%20escuro-12151D?style=flat-square)]()

</div>

---

## Sobre a Rory Systems

A Rory Systems atua nas duas pontas da engenharia de software: mantém sistemas
críticos que já sustentam a operação de clientes de indústria, finanças e
varejo, com legado em Delphi, .NET e SQL Server, e constrói os produtos que
essa operação ainda não tem: SaaS, aplicações, integrações com IA e sites de
conversão.

Sediada em Blumenau, SC. Atendimento remoto para todo o Brasil.

## Este repositório

Guarda os produtos digitais da Rory Systems, organizados como um monorepo em
`apps/`. Hoje existem a landing page e o Worker que atende seus formulários;
a estrutura já está pronta para receber outros projetos do mesmo domínio. O
próximo é um app de gestão dos próprios projetos da empresa.

```
apps/
├── landing/            → site institucional (rorysystems.com)
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   ├── feedback/       → /feedback: formulário de depoimento de cliente
│   └── assets/
└── contact-worker/     → formulários (Cloudflare Worker + D1 + SMTP Brevo)

content/                → dados editáveis à mão que viram HTML da landing
└── testimonials.json
tools/                  → utilitários de manutenção do repositório
└── build-testimonials.mjs
```

`content/` e `tools/` ficam fora de `apps/landing` porque o deploy publica
aquela pasta inteira: fonte de dados e ferramenta não precisam ir para o ar.

## A landing page

HTML, CSS e JavaScript puros, sem framework e sem passo de build. A página
que vende performance e SEO técnico como serviço não podia carregar um bundle
de 300 KB só para exibir texto estático.

- **Tema claro/escuro** com botão sol/lua: segue a escolha salva no
  navegador; sem escolha salva, segue o tema do sistema.
- **Diagrama animado no hero**, a própria logo ampliada: os três quadrados
  se conectam mostrando a dupla frente da empresa (sistema legado ↔ Rory
  Systems ↔ produto novo).
- **SEO completo**: dados estruturados (schema.org), Open Graph, Twitter
  Card, sitemap e robots.txt.
- **Progressive enhancement**: sem JavaScript, a página inteira continua
  legível e funcional; com JS, ganha menu mobile, revelação suave em scroll
  e envio assíncrono do formulário de contato.

## Depoimentos

Cliente registra o depoimento em [`/feedback`](https://www.rorysystems.com/feedback/):
o que era problema antes, o resultado depois, a citação e — separadamente — se
autoriza divulgar. O Worker grava tudo no D1 com `status = 'pendente'` e avisa
`ceo@` por e-mail.

Publicar é um segundo passo, deliberadamente manual: o depoimento aprovado
entra em `content/testimonials.json` e vira HTML na home com

```bash
node tools/build-testimonials.mjs      # --check apenas verifica se está em dia
```

O HTML fica versionado em vez de ser montado no navegador porque prova social é
exatamente o conteúdo que precisa ser indexado pelo Google e continuar legível
sem JavaScript. Sem o passo do gerador, o site não passa a exibir nada sozinho —
consentimento no banco não é permissão automática de publicação.

## Casos em produção

| Projeto | O que é |
|---|---|
| [EisenCare](https://www.eisencare.com) | SaaS de gestão para barbearias, multi-tenant por slug de URL |
| [HogarSys](https://hogarsys.rorysystems.com) | Gestão para estúdios de arquitetura e design |
| [M7 Marcenaria](https://www.m7marcenaria.com) | Site institucional com painel administrativo próprio |

## Contato

- **Comercial:** [comercial@rorysystems.com](mailto:comercial@rorysystems.com)
- **Direto:** [ceo@rorysystems.com](mailto:ceo@rorysystems.com)
- **WhatsApp:** [(47) 99163-3210](https://wa.me/5547991633210)
- **LinkedIn:** [linkedin.com/in/bryan-rory](https://linkedin.com/in/bryan-rory)

<sub>© 2026 Rory Systems · Blumenau, SC</sub>
