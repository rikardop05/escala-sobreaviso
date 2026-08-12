# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Equipe de sobreaviso da MT Fintech (6 pessoas: 5 no controle financeiro + 1 só na escala) e um admin. Contexto de uso duplo: (1) consulta rápida da escala — "quem está de plantão agora / quando é meu próximo turno?" — muitas vezes no celular, fora do horário comercial; (2) trabalho administrativo sentado — lançar horas extras/compensação, conferir valores, exportar CSV, editar a escala (admin). Há também visualização pública (sem login) da escala para consulta por terceiros.

## Product Purpose

Gerenciar o calendário de plantões de sobreaviso (turnos fixos de semana + ciclo rotativo de 5 semanas nos fins de semana, com substituições e overrides do admin) e o controle financeiro de horas (sobreaviso a 1/3, hora extra a 150%). Sucesso = ninguém precisa perguntar "quem está de sobreaviso?" nem conferir cálculo de horas em planilha paralela; a escala é a fonte única de verdade.

## Positioning

Escala e cálculo financeiro (SA/HE/Comp) vivem na mesma fonte de verdade, nunca dessincronizados como numa planilha paralela. O app aprova excedente de Hora Extra automaticamente (compara o lançamento com a escala efetiva, incluindo substituições) e aplica permissão por equipe — um admin de uma equipe nunca vê nem edita dado financeiro ou escala de outra. Nenhuma alternativa genérica (planilha, calendário compartilhado) mantém esses três fatos (escala, dinheiro, escopo por equipe) coerentes entre si sem trabalho manual.

## Operating Context

- Uso duplo: consulta rápida no celular fora do horário comercial (quem está de plantão agora) e trabalho administrativo sentado (lançar CH, fechar mês, exportar CSV).
- Três equipes independentes (Sustentação, Infraestrutura, Desenvolvimento; 19 pessoas), cada uma com seu próprio calendário, admin e escopo de CH.
- Fechamento mensal do Controle de Horas alimenta a folha de pagamento — os valores fechados viram insumo financeiro real, não apenas uma tela informativa.
- Aprovação de excedente é um fluxo de admin recorrente (fila de pendências de Hora Extra) que precisa ser verificado antes do fechamento do mês.
- Backup diário automatizado (cron) é a rede de segurança de produção; não há ambiente de staging.
- Allowlist de acesso (`api/_allowlist.js`) é mantida manualmente por e-mail — adicionar/remover pessoa é uma operação humana, não self-service.
- Visualização pública da escala (sem login) é consultada por terceiros fora da equipe.

## Capabilities and Constraints

- Motor de escala genérico por equipe (`buildSchedule(team, overrides, labels)`) — turnos fixos de semana + rotação de fim de semana (Sustentação) ou blocos sem rodízio (Infra/Desenvolvimento), com overrides do admin e "Dividir turno".
- Controle de Horas multi-equipe: SA a 1/3, HE a 150%, Compensação abate da NF; aprovação de excedente roda no servidor e nunca confia no cliente; fechamento mensal congela um snapshot imutável.
- Banco atual é Redis (chaves por equipe/membro); PostgreSQL é planejamento futuro, ainda não migrado — schema existente em `_arquivo/planejamento/db/schema.sql` está desatualizado e não deve guiar decisões de produto.
- Terminologia canônica do domínio (Equipe, Turno, Atribuição, Slot vago, Excedente, Substituição...) vive em `CONTEXT.md` — usar esses termos exatos ao descrever o produto.
- Repositório deve permanecer privado — contém e-mails reais da equipe na allowlist.
- Sem dados de teste fictícios em produção: pessoas, equipes e valores exibidos são sempre os reais.

## Brand Commitments

Nome do produto: "Escala de Sobreaviso". Propriedade MT Fintech; identidade visual usa `public/logo.png` como ícone/marca (favicon e navbar). Sem outros ativos de marca formalizados além disso.

**Registro visual (preferência assumida, 2026-08-12).** O app fica deliberadamente na convenção da
categoria — sóbrio, moderno, adequado ao meio financeiro — e não busca um mundo visual próprio.
Decisão tomada pelo dono do produto após ver e recusar duas rodadas de direções alternativas
(quadro de escala em aço; papel de segurança/guilhoché; terminal de fósforo, ciclorama, teletexto,
bilhete aéreo, desktop de 1 bit). Não reabrir essa escolha sem pedido explícito.

**Régua de acabamento: Grafana e Datadog.** O app deve poder sentar ao lado desses dois sem parecer
inferior. O que isso obriga, concretamente: escuro nativo em cinzas neutros (não azul-marinho
saturado), densidade alta com altura de linha contida, hairline de 1px como recurso estrutural
dominante em vez de sombra, eixo de tempo forte, legenda com chip de cor por série, acento
reservado para interação/seleção, cores semânticas reservadas para estado, e numeral tabular em
todo valor monetário ou de hora.

**Cor por pessoa é intocável** (confirmado 2026-08-12): cada pessoa tem sua cor, para identificação
num relance. As matizes podem ser retunadas para contraste; o sistema "uma cor por pessoa" não sai.

**Densidade é intocável** (confirmado 2026-08-12): o calendário mostra o mês inteiro sem esconder
informação atrás de cliques.

**Composição na tela grande vence** (confirmado 2026-08-12): quando desktop e celular conflitarem,
otimizar para a tela grande. O mobile permanece funcional e responsivo, não prioritário.

## Brand Personality

Sóbrio, confiável, eficiente — com um pé na estética técnica de ferramenta ops/on-call. Tom corporativo fintech: escuro por padrão, denso em informação onde a densidade ajuda (calendário, relatório), direto e sem ornamento. Deve transmitir precisão: os números daqui viram dinheiro.

## Anti-references

- **Dashboard SaaS genérico**: grids de cards idênticos, gradientes decorativos, hero-metrics gigantes com label pequeno.
- **Planilha crua / Excel**: tabelas sem hierarquia visual, tudo com o mesmo peso, sem estados nem affordances.

## Evidence on Hand

Dados reais de produção (Redis) são a única fonte — três equipes reais (`src/lib/teams.js`), allowlist real de e-mails (`api/_allowlist.js`). Não fabricar pessoas, depoimentos, métricas ou casos de uso fictícios; qualquer exemplo em texto de produto deve vir dessas fontes ou ser marcado como ilustrativo.

## Product Principles

1. **A resposta em 5 segundos**: a pergunta nº 1 ("quem está agora / quando é minha vez?") deve ser respondida sem cliques, sem scroll pensado, em qualquer dispositivo.
2. **Densidade a serviço da leitura**: calendário e relatórios podem ser densos, mas cada tela tem uma hierarquia clara — um elemento primário, o resto recua.
3. **Precisão visível**: valores financeiros e horas sempre com origem rastreável (de onde veio esse número); nada de mágica escondida.
4. **Plantão é mobile**: quem consulta a escala está muitas vezes no celular, com uma mão; ações e informações críticas ao alcance do polegar.
5. **Ferramenta, não vitrine**: sem decoração que não carrega informação; o app aparenta ser operado por quem opera sistemas.

## Accessibility & Inclusion

WCAG AA: contraste mínimo 4.5:1 para texto (3:1 para texto grande), navegação por teclado funcional nas ações principais, alvos de toque ≥44×44pt no mobile, `prefers-reduced-motion` respeitado. Tema escuro é o padrão; o tema claro também deve cumprir AA.
