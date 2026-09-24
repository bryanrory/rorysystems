-- Avaliações de clientes enviadas por rorysystems.com/avaliar/.
-- Rodar uma vez:  npx wrangler d1 execute rory-reviews --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS avaliacoes (
  id          TEXT PRIMARY KEY,
  nome        TEXT    NOT NULL,
  profissao   TEXT    NOT NULL,
  estrelas    INTEGER NOT NULL CHECK (estrelas BETWEEN 1 AND 5),
  comentario  TEXT    NOT NULL,
  foto        BLOB,
  foto_tipo   TEXT CHECK (foto_tipo IN ('image/webp', 'image/jpeg', 'image/png')),
  status      TEXT    NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Aprovada', 'Recusada')),
  criado_em   TEXT    NOT NULL, -- ISO 8601 UTC
  moderado_em TEXT,
  ip          TEXT,
  excluido_em TEXT              -- soft delete: preenchido = some do site
);

CREATE INDEX IF NOT EXISTS idx_avaliacoes_status_criado ON avaliacoes (status, criado_em);
