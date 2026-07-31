# O nome da pessoa continua sendo seu identificador

O nome de uma pessoa (`'Marcus Túlio'`) é hoje, ao mesmo tempo, chave de exibição, valor na allowlist, membro do enum de validação, campo `person` de cada lançamento, `titular`/`substituto` das substituições, conteúdo de `persons[]` nas edições de escala e segmento das chaves Redis do controle de horas. Ao triplicar o número de pessoas, decidimos **não** migrar para um identificador estável agora, e em vez disso concentrar as pessoas num registry único onde a unicidade do nome entre todas as equipes passa a ser explícita e obrigatória.

## Considered Options

**Adotar slug estável agora** (`carlos.beda`, com o nome virando rótulo) resolveria de vez tanto homônimos quanto rename, e é mais barato com 6 pessoas do que com 15. Foi rejeitada por um motivo específico: exigiria reescrever os snapshots de meses fechados — o dado que existe justamente para nunca mudar. Reescrever folha congelada para trocar um identificador é um risco desproporcional ao problema que ainda não temos.

**Slug só para as equipes novas** foi rejeitada: dois sistemas de identidade convivendo indefinidamente, com todo leitor precisando saber de qual lado está.

## Consequences

- Homônimo entre equipes é resolvido por desambiguação no próprio identificador (`'Carlos Beda'`), com nome curto apenas na exibição. Sem isso, duas pessoas gravariam na mesma chave de controle de horas e uma nota fiscal somaria as horas da outra — falha silenciosa, não erro.
- Renomear uma pessoa continua quebrando histórico. A dívida fica registrada e o momento certo de pagá-la é a migração para PostgreSQL/Turso, quando os dados serão reescritos de qualquer forma.
- O registry único de pessoas passa a ser pré-requisito de qualquer adição de membro: é ele que torna a colisão detectável.
