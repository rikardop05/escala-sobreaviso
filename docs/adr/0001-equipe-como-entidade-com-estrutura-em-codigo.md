# Equipe é entidade de primeira classe, mas sua estrutura vive em código

O app nasceu para uma equipe só, com a estrutura da escala embutida em constantes de módulo (`WEEKDAY_SHIFTS`, `WEEKEND_ROSTER`, `ANCHOR`). Ao passar a suportar três equipes com janelas de cobertura diferentes, decidimos generalizar o **motor** — `buildSchedule` passa a receber uma definição de equipe — mas manter as **definições** em código, num registry versionado no git. Adicionar ou alterar uma equipe é um PR + deploy, o mesmo custo que já se paga hoje para adicionar uma pessoa à allowlist.

## Considered Options

**Estrutura editável pelo admin na UI (persistida no Redis)** foi rejeitada. A escala é recalculada a cada render, e só meses de CH fechados estão protegidos por snapshot: mudar a estrutura reescreve o passado. Hoje esse risco é contido pelo git — a mudança passa por PR, review e histórico. Movê-la para a UI exigiria construir vigência por data, versionamento da estrutura, validação de rotação e proteção contra reescrita retroativa da folha — mais trabalho do que a feature inteira, num app cujos números viram dinheiro.

**Código duplicado por equipe** foi rejeitada porque triplicaria a superfície onde substituições, edições, segmentos de plantão e geração de sobreaviso precisam concordar entre si. As três divergiriam.

## Consequences

- Nenhuma equipe pode ser criada sem deploy. Aceitável: equipes surgem em escala de anos, não de semanas.
- A aba Estrutura permanece somente-leitura, agora com um seletor de equipe.
- O registry passa a ser o único lugar que conhece a composição das equipes, e a validação do backend cruza contra ele em vez de contra um enum fixo de seis nomes.
