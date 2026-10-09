# Prime Video Auto Skip 🎬⚡

Extensão para o Google Chrome e Microsoft Edge que aprimora a experiência no **Amazon Prime Video**, pulando automaticamente aberturas, resumos e anúncios, além de ocultar o cursor do mouse inativo e avançar episódios sem interrupções.

---

## ✨ Funcionalidades

- **⏭️ Pular Aberturas e Resumos:** Detecta e clica automaticamente em botões como *"Pular Abertura"*, *"Pular Resumo"*, *"Skip Intro"* e recapitulações assim que aparecem na tela.
- **🚫 Pular e Acelerar Anúncios:** Clica no botão *"Pular Anúncio"* instantaneamente. Para comerciais sem botão de pular, acelera a reprodução em 16x no modo mudo, terminando o anúncio em poucos segundos sem incomodar.
- **🖱️ Ocultação Automática do Cursor (3s):** Oculta a seta do mouse após 3 segundos de inatividade durante a reprodução do vídeo e a restaura imediatamente ao mover o mouse.
- **⏩ Próximo Episódio Automático:** Detecta o card de próximo episódio (*"A seguir"*, *"Up Next"*) com thumbnail e ícone de play e avança imediatamente, sem precisar esperar os créditos finais ou a contagem regressiva.
- **⌨️ Atalhos de Conveniência:**
  - Pressione a tecla **F** no player para alternar tela cheia.
  - Dê um **duplo clique** no vídeo para entrar ou sair de tela cheia.
- **🎛️ Controle Total das Configurações:**
  - **Interruptor Geral (Master Switch):** Pause ou ative todas as funções da extensão com um único clique.
  - **Botões Rápidos:** *"Desativar Todas"* e *"Ativar Todas"* para ligar ou desligar tudo instantaneamente.
  - **Status Dinâmico:** Indicador visual que mostra a quantidade de funções ativas em tempo real.
- **🛡️ Isolamento Seguro:** Validação de domínio em runtime garantindo execução estrita apenas em rotas do player de vídeo, sem qualquer interferência em páginas de checkout, pagamento ou catálogo geral da Amazon.

---

## 🚀 Como Instalar no Navegador (Modo Desenvolvedor)

1. Clone ou baixe esta pasta no seu computador:
   ```
   c:\Users\usuarioDM\Documents\Extensoes\primevideo-auto-skip
   ```
2. Abra o Google Chrome (ou Edge) e acesse:
   ```
   chrome://extensions
   ```
3. Ative o interruptor **"Modo do desenvolvedor"** no canto superior direito.
4. Clique no botão **"Carregar sem compactação"** (Load unpacked).
5. Selecione a pasta `primevideo-auto-skip`.
6. Pronto! A extensão estará ativa e pronta para maratonar séries no Prime Video.

---

## 🛠️ Tecnologias Utilizadas

- **Manifest V3** (padrão mais recente do Google Chrome).
- **MAIN World Injection** para manipulação nativa de velocidade de vídeo e silenciamento de anúncios comerciais.
- **Isolated Content Script** para detecção precisa e clique automático via `MutationObserver`.
- **Chrome Storage API** (`chrome.storage.sync`) para persistência de preferências em tempo real.
