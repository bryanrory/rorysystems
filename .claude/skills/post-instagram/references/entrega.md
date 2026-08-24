# Entrega: o que funciona e o que não funciona

Aprendido na marra na primeira peça. Ler antes de prometer qualquer caminho de
entrega ao usuário.

## Google Drive

A pasta é **`Rory Systems > Marketing`** (`1_PlPRtlS-uU_z4cKhzen8sPL-UTU1nIb`).
As peças ficam ali, não no repositório — marketing é entregável, não código.

**Texto sobe, binário não.** O conector do Drive só aceita conteúdo que o modelo
digita na própria chamada (`textContent` / `base64Content`). Para um HTML de 25 KB
isso funciona e o arquivo sobe byte a byte idêntico — confira comparando o
`fileSize` da resposta com o tamanho local. Para um PNG de 40 KB significaria
transcrever ~50 mil caracteres de base64 sem errar um; um caractere trocado gera um
arquivo corrompido que o Drive aceita e guarda mesmo assim. Não tente: avise o
usuário e use outro caminho para as imagens.

**Não existe substituir conteúdo.** `update_file` só muda metadados (título, pasta).
Para atualizar uma peça: `trash_file` no arquivo antigo e `create_file` de novo.
Avise que a versão anterior foi para a lixeira e pode ser restaurada.

Suba o HTML com `disableConversionToGoogleType: true`, senão vira Google Doc.

## As imagens

O que já falhou:

- **Anexo na conversa** — o toque longo no app do celular não oferece salvar.
- **Página de galeria publicada como Artifact** — mesmo problema dentro do webview
  do app. Pode funcionar se o usuário abrir o link no Chrome/Safari do celular, em
  vez de dentro do app; vale sugerir, mas não prometa.

Ou seja: entregue as imagens, explique as duas rotas e deixe o usuário escolher —
sem afirmar que uma delas vai funcionar no aparelho dele.

## Repositório

O código do site fica em `apps/`. Peça de marketing não entra lá e não vai para o
`sitemap.xml` nem para o deploy. Esta skill e seus scripts são a exceção: são
ferramenta, ficam versionados em `.claude/skills/`.

Branch de trabalho: use a que estiver designada na sessão, commit descritivo,
push com `git push -u origin <branch>`. Não abra PR sem o usuário pedir.
