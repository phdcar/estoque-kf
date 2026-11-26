# Estoque Clínica KF

PWA (app instalável pelo navegador) de controle de estoque, em português do Brasil.

## Etapa 1 (pronta): app local
- Cadastro de produto: nome, quantidade, estoque mínimo e foto (câmera ou galeria).
- A foto é convertida no próprio celular em desenho de traço (detector de bordas Canny em `js/lineart.js`).
  A foto original fica guardada ao lado (JPEG, lado maior até 1600 px).
- Produto com quantidade **menor** que o mínimo fica em vermelho, com aviso no topo da lista.
- Conferência diária, de segunda a sexta (`js/schedule.js`, desde a versão 0.5): em dia útil o funcionário só
  acessa a tela de contagem até contar todos os produtos. Contagem "cega" (não mostra a quantidade do sistema).
  Dia útil que terminou sem conferência bloqueia o app até o funcionário escrever a justificativa,
  que vai por e-mail para o dono e fica no histórico. Fim de semana não tem conferência obrigatória.
- Dono: histórico de quem conferiu e quando, diferenças de cada contagem e aviso de atraso.
- Funciona sem internet depois de aberto uma vez. Dados ficam no aparelho (IndexedDB).

## Etapa 2: sincronização com Supabase
- Cada pessoa tem login (e-mail e senha). A primeira conta vira **dono**; as outras entram com o
  **código da clínica** (Ajustes do dono) e viram funcionário. O dono pode tirar o acesso de alguém.
- O app continua funcionando sem internet; as alterações ficam pendentes e são enviadas depois
  (`js/cloud.js`). Em conflito no mesmo produto, vale a alteração mais recente.
- Fotos (original + desenho) vão para o Storage do Supabase (bucket privado `fotos`).
- Banco e regras de acesso: `supabase/schema.sql` (colar no SQL Editor do Supabase).
- Endereço e chave pública: `js/config.js`.

## Versão 0.3: padrão visual KF e radar de estoque
- Identidade KF: azul-noite, marfim e champanhe; títulos em Bodoni Moda e texto em Jost (fontes em `fonts/`, licença OFL);
  logo da árvore em `icons/kf-logo.png`.
- Painel com radar: abaixo do mínimo, esgotados, no limite (até 25% acima do mínimo), em dia e cadastro incompleto.
- Reposição por fornecedor, com botão para enviar a lista (WhatsApp, e-mail).
- Fornecedor, categoria, quantidade e mínimo (1 ou mais) são obrigatórios ao salvar. Regras em `js/stock.js`.
- Desenho esquemático de cada produto quando não há foto (`js/illustrations.js`).
- Banco: `supabase/migracao-0.3.sql` (colunas `fornecedor` e `categoria`).

## Próxima etapa
3. Avisos no celular do dono (Web Push).

## Rodar e testar
```
python3 -m http.server 8080     # abrir http://localhost:8080
node --test tests/unit/*.test.js
tests/sql/run.sh                # testa o schema.sql num Postgres 16 local
node tests/e2e/run.mjs          # Playwright com Chromium, contra um Supabase falso
```
