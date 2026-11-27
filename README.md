# Estoque Clínica KF

PWA (app instalável pelo navegador) de controle de estoque, em português do Brasil.

## Etapa 1 (pronta): app local
- Cadastro de produto: nome, quantidade, estoque mínimo e foto (câmera ou galeria).
- A foto é convertida no próprio celular em desenho de traço (detector de bordas Canny em `js/lineart.js`).
  A foto original fica guardada ao lado (JPEG, lado maior até 1600 px).
- Produto com quantidade **menor** que o mínimo fica em vermelho, com aviso no topo da lista.
- Conferência semanal, toda segunda-feira (`js/schedule.js`, `COUNT_WEEKDAYS`; era diária até a versão 0.8.2): na segunda o funcionário só
  acessa a tela de contagem até contar todos os produtos. Contagem "cega" (não mostra a quantidade do sistema).
  Segunda-feira que terminou sem conferência bloqueia o app até o funcionário escrever a justificativa,
  que vai por e-mail para o dono e fica no histórico. Nos outros dias a contagem é opcional.
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

## Versão 0.8: lembretes no celular e pedido sugerido pela previsão
- Pedido sugerido por fornecedor: entra o que está abaixo do mínimo e o que vai acabar em até 10 dias no ritmo de uso;
  com uso registrado, a quantidade cobre 30 dias (`shoppingList` em `js/stock.js`).
- Lembrete às 17h (segunda a sexta) quando a conferência do dia não foi feita, para todos os celulares com notificações
  ativadas (dono e funcionários); resumo às 8h para o dono quando há esgotado, abaixo do mínimo ou vencido.
  Banco: `supabase/migracao-0.8.sql` (pg_cron). Função `kf-push` aceita `todos: true`.
- Campo de validade logo abaixo da quantidade no cadastro; link "Alterar validade" na página do produto.
- Categoria também fica só com a primeira letra maiúscula.

## Versão 0.8.3: conferência toda segunda-feira
- Regra do dono (27/11/2026): a conferência é semanal, na segunda-feira. Lembrete às 17h só na segunda
  (`supabase/migracao-0.8.3.sql`). O aviso do radar conta as segundas-feiras sem conferência.

## Versão 0.9: aviso de atraso, sem internet, avisos fáceis de ligar e contagem por foto
- Aviso ao dono quando a conferência de segunda passa do horário limite: `supabase/migracao-0.9.sql`
  (`kf_aviso_atrasada`, pg_cron a cada 10 min segunda/terça UTC, uma vez por dia, push + e-mail via `kf_enviar_email`).
  `kf_push_resumo()` mostra ao dono, em Ajustes, quantos celulares de cada pessoa têm avisos ligados.
- Sem internet: a conferência e a justificativa ficam no celular (IndexedDB) e são enviadas quando a internet volta;
  a tela avisa e um aviso confirma o envio. O leitor de código também fica guardado para abrir sem internet.
- Cartão "Ative os avisos neste celular" no painel (no iPhone fora da Tela de Início, explica como instalar).
- Contagem por foto: botão na conferência → Edge Function `kf-foto` (Claude, chave `ANTHROPIC_API_KEY` nos segredos
  das Edge Functions, "Verify JWT" desligado) sugere quantidade, validade e lote; a pessoa confere antes de usar.
  A lista enviada não leva as quantidades do sistema (a contagem continua cega).
- Relatório mensal: desde 27/11/2026 só as segundas-feiras contam como dia de conferência.

## Rodar e testar
```
python3 -m http.server 8080     # abrir http://localhost:8080
node --test tests/unit/*.test.js
tests/sql/run.sh                # testa o schema.sql num Postgres 16 local
node tests/e2e/run.mjs          # Playwright com Chromium, contra um Supabase falso
node --experimental-strip-types tests/push/foto.test.mjs
```
