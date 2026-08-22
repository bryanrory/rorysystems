-- Depoimentos enviados em rorysystems.com/feedback.
--
-- Aplicar com:  npm run migrate      (equivale a
--               `wrangler d1 migrations apply rory-depoimentos --remote`)
--
-- Duas colunas carregam a regra de negócio inteira e são independentes de
-- propósito:
--
--   autorizado  o que a PESSOA permitiu. Sem 1 aqui, o depoimento nunca pode
--               ir ao site, aconteça o que acontecer do nosso lado.
--   status      o que NÓS decidimos. Um depoimento autorizado ainda passa por
--               curadoria antes de virar card na home.
--
-- Publicável = autorizado = 1 E status = 'aprovado'. Uma coluna só misturaria
-- consentimento com curadoria, e a primeira vez que alguém aprovasse sem olhar
-- o consentimento publicaria o que não podia.

CREATE TABLE IF NOT EXISTS depoimentos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  criado_em   TEXT    NOT NULL DEFAULT (datetime('now')),

  nome        TEXT    NOT NULL,
  cargo       TEXT    NOT NULL,
  empresa     TEXT    NOT NULL,
  servico     TEXT    NOT NULL,

  -- Opcionais no formulário: NULL quando não informados.
  email       TEXT,
  foto_url    TEXT,

  desafio     TEXT    NOT NULL,
  resultado   TEXT    NOT NULL,
  depoimento  TEXT    NOT NULL,

  autorizado  INTEGER NOT NULL DEFAULT 0 CHECK (autorizado IN (0, 1)),
  status      TEXT    NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente', 'aprovado', 'recusado')),

  -- Só para rastrear abuso; não aparece em lugar nenhum do site.
  ip          TEXT,
  pais        TEXT
);

-- A consulta que interessa no dia a dia é "o que chegou e ainda não olhei",
-- do mais novo para o mais velho.
CREATE INDEX IF NOT EXISTS idx_depoimentos_status
  ON depoimentos (status, criado_em DESC);
