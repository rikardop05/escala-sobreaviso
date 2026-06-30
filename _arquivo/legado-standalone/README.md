# Escala de Sobreaviso

Aplicativo desktop para visualização da escala de nossa incrível equipe de sobreaviso.

## Como usar

Abra o arquivo `index.html` diretamente no navegador (Edge, Chrome, etc.).

> **Requisito:** conexão com internet (React e Tailwind são carregados via CDN).

## Funcionalidades

- Visualização da escala por mês com navegação
- Indicador em tempo real de quem está de sobreaviso agora
- Filtro por responsável com próximos plantões (inclui coberturas ativas)
- Tema claro / escuro (botão no canto superior direito do cabeçalho)
- **Substituições**: cadastre férias ou trocas eventuais com titular → substituto + período
  - O app sugere quem está livre em cada turno afetado
  - O calendário exibe o substituto com badge `sub`
  - O cabeçalho "Agora" indica quem está cobrindo e por quem
  - Analistas com substituição ativa ganham badge 🌴 no filtro

## Atualizar a escala

Edite `escala-sobreaviso.jsx` e replique as alterações em `index.html`  
(a lógica fica na tag `<script type="text/babel">` no final do arquivo).

## Estrutura

```
├── escala-sobreaviso.jsx   # Componente React original (referência)
├── index.html              # App — abrir direto no navegador
├── main.py                 # Launcher desktop opcional (pywebview)
├── executar.bat            # Abre o app via Python (alternativa ao navegador)
└── build.bat               # Gera dist/EscalaSobreaviso.exe (requer Python)
```
