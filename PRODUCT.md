# Product

## Register

product

## Users

Equipe de sobreaviso da MT Fintech (6 pessoas: 5 no controle financeiro + 1 só na escala) e um admin. Contexto de uso duplo: (1) consulta rápida da escala — "quem está de plantão agora / quando é meu próximo turno?" — muitas vezes no celular, fora do horário comercial; (2) trabalho administrativo sentado — lançar horas extras/compensação, conferir valores, exportar CSV, editar a escala (admin). Há também visualização pública (sem login) da escala para consulta por terceiros.

## Product Purpose

Gerenciar o calendário de plantões de sobreaviso (turnos fixos de semana + ciclo rotativo de 5 semanas nos fins de semana, com substituições e overrides do admin) e o controle financeiro de horas (sobreaviso a 1/3, hora extra a 150%). Sucesso = ninguém precisa perguntar "quem está de sobreaviso?" nem conferir cálculo de horas em planilha paralela; a escala é a fonte única de verdade.

## Brand Personality

Sóbrio, confiável, eficiente — com um pé na estética técnica de ferramenta ops/on-call. Tom corporativo fintech: escuro por padrão, denso em informação onde a densidade ajuda (calendário, relatório), direto e sem ornamento. Deve transmitir precisão: os números daqui viram dinheiro.

## Anti-references

- **Dashboard SaaS genérico**: grids de cards idênticos, gradientes decorativos, hero-metrics gigantes com label pequeno.
- **Planilha crua / Excel**: tabelas sem hierarquia visual, tudo com o mesmo peso, sem estados nem affordances.

## Design Principles

1. **A resposta em 5 segundos**: a pergunta nº 1 ("quem está agora / quando é minha vez?") deve ser respondida sem cliques, sem scroll pensado, em qualquer dispositivo.
2. **Densidade a serviço da leitura**: calendário e relatórios podem ser densos, mas cada tela tem uma hierarquia clara — um elemento primário, o resto recua.
3. **Precisão visível**: valores financeiros e horas sempre com origem rastreável (de onde veio esse número); nada de mágica escondida.
4. **Plantão é mobile**: quem consulta a escala está muitas vezes no celular, com uma mão; ações e informações críticas ao alcance do polegar.
5. **Ferramenta, não vitrine**: sem decoração que não carrega informação; o app aparenta ser operado por quem opera sistemas.

## Accessibility & Inclusion

WCAG AA: contraste mínimo 4.5:1 para texto (3:1 para texto grande), navegação por teclado funcional nas ações principais, alvos de toque ≥44×44pt no mobile, `prefers-reduced-motion` respeitado. Tema escuro é o padrão; o tema claro também deve cumprir AA.
