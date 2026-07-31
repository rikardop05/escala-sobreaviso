# O dia da escala começa numa hora declarada por equipe

A que data pertence um turno que cruza a meia-noite era decidido por uma heurística posicional em `buildOnCallSegments`: *índice 0* + cruza a meia-noite + começa depois do meio-dia → pernoite, pertence à véspera. Substituímos isso por um dado explícito: cada equipe declara a hora em que seu dia começa (`dayStart`), e a atribuição é derivada dela.

A heurística não era arbitrária — ela codificava um fato real da sustentação, que é o handoff às 23:00. Todos os turnos daquela equipe (`Madrugada` 23:00–04:00, `Manhã`, `Noite`, e no fim de semana `Dia` 23:00–11:00 e `Noite` 11:00–23:00) caem exatamente onde caem hoje sob a regra "o dia começa às 23:00". A heurística era essa propriedade, espalhada por três condições e um índice de array.

## Consequences

- A infraestrutura, cujo único turno é 18:00–00:00 e portanto ocuparia o índice 0, teria sido interpretada como pernoite da véspera — a escala inteira deslocada um dia, silenciosamente. Esse é o defeito concreto que motivou a decisão.
- Muda um comportamento de canto: um turno extra criado pelo admin com início após as 23:00 passa a aparecer no bloco da véspera em vez do dia digitado. É mais consistente, mas é uma mudança observável.
- `shift.idx` volta a ser apenas uma chave estável de override, sem significado semântico.
