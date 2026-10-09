/**
 * Prime Video Auto Skip - Popup Script
 * Salva e restaura as preferências do usuário no chrome.storage
 */
document.addEventListener('DOMContentLoaded', () => {
  const defaults = {
    extensionEnabled: true,
    autoSkipIntro: true,
    autoSkipAds: true,
    hideCursorOnIdle: true,
    autoNextEpisode: true,
    enableKeyF: true,
    enableDblClick: true
  };

  const masterToggle = document.getElementById('extensionEnabled');
  const masterCard = document.getElementById('masterCard');
  const masterDesc = document.getElementById('masterDesc');
  const headerSubtitle = document.getElementById('headerSubtitle');
  const optionsContainer = document.getElementById('optionsContainer');
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const btnDisableAll = document.getElementById('btnDisableAll');
  const btnEnableAll = document.getElementById('btnEnableAll');

  const featureInputs = {
    autoSkipIntro: document.getElementById('autoSkipIntro'),
    autoSkipAds: document.getElementById('autoSkipAds'),
    hideCursorOnIdle: document.getElementById('hideCursorOnIdle'),
    autoNextEpisode: document.getElementById('autoNextEpisode'),
    enableKeyF: document.getElementById('enableKeyF'),
    enableDblClick: document.getElementById('enableDblClick')
  };

  function updateUI() {
    const isMasterEnabled = masterToggle ? masterToggle.checked : true;

    if (isMasterEnabled) {
      if (masterCard) masterCard.classList.remove('is-off');
      if (masterDesc) masterDesc.textContent = 'Desative para pausar todas as funções';
      if (headerSubtitle) {
        headerSubtitle.textContent = 'Player Otimizado Ativo';
        headerSubtitle.classList.remove('is-disabled');
      }
      if (optionsContainer) optionsContainer.classList.remove('is-disabled');

      for (const input of Object.values(featureInputs)) {
        if (input) input.disabled = false;
      }

      // Conta quantas opções estão ativas
      let activeCount = 0;
      const totalCount = Object.keys(featureInputs).length;
      for (const input of Object.values(featureInputs)) {
        if (input && input.checked) activeCount++;
      }

      if (activeCount === 0) {
        if (statusIndicator) statusIndicator.className = 'status-indicator status-off';
        if (statusText) statusText.textContent = 'Todas as configurações desativadas';
      } else if (activeCount === totalCount) {
        if (statusIndicator) statusIndicator.className = 'status-indicator';
        if (statusText) statusText.textContent = 'Pronto para maratonar séries no Prime';
      } else {
        if (statusIndicator) statusIndicator.className = 'status-indicator status-partial';
        if (statusText) statusText.textContent = `${activeCount} de ${totalCount} recursos ativos`;
      }
    } else {
      if (masterCard) masterCard.classList.add('is-off');
      if (masterDesc) masterDesc.textContent = 'Todas as funções estão desativadas';
      if (headerSubtitle) {
        headerSubtitle.textContent = 'Extensão Pausada';
        headerSubtitle.classList.add('is-disabled');
      }
      if (optionsContainer) optionsContainer.classList.add('is-disabled');

      for (const input of Object.values(featureInputs)) {
        if (input) input.disabled = true;
      }

      if (statusIndicator) statusIndicator.className = 'status-indicator status-off';
      if (statusText) statusText.textContent = 'Extensão totalmente desativada';
    }
  }

  // Carrega opções salvas
  chrome.storage.sync.get(defaults, (items) => {
    const currentSettings = Object.assign({}, defaults, items);

    if (masterToggle) {
      masterToggle.checked = currentSettings.extensionEnabled !== false;
    }

    for (const [key, element] of Object.entries(featureInputs)) {
      if (element) {
        element.checked = currentSettings[key] !== false;
      }
    }

    updateUI();
  });

  // Alteração do interruptor geral (Master Switch)
  if (masterToggle) {
    masterToggle.addEventListener('change', () => {
      chrome.storage.sync.set({ extensionEnabled: masterToggle.checked }, () => {
        updateUI();
      });
    });
  }

  // Registra alteração para cada checkbox individual
  for (const [key, element] of Object.entries(featureInputs)) {
    if (element) {
      element.addEventListener('change', () => {
        const update = {};
        update[key] = element.checked;
        chrome.storage.sync.set(update, () => {
          updateUI();
        });
      });
    }
  }

  // Botão Desativar Todas as Configurações
  if (btnDisableAll) {
    btnDisableAll.addEventListener('click', () => {
      const update = {
        autoSkipIntro: false,
        autoSkipAds: false,
        hideCursorOnIdle: false,
        autoNextEpisode: false,
        enableKeyF: false,
        enableDblClick: false
      };
      for (const [key, element] of Object.entries(featureInputs)) {
        if (element) element.checked = false;
      }
      chrome.storage.sync.set(update, () => {
        updateUI();
      });
    });
  }

  // Botão Ativar Todas as Configurações
  if (btnEnableAll) {
    btnEnableAll.addEventListener('click', () => {
      const update = {
        extensionEnabled: true,
        autoSkipIntro: true,
        autoSkipAds: true,
        hideCursorOnIdle: true,
        autoNextEpisode: true,
        enableKeyF: true,
        enableDblClick: true
      };
      if (masterToggle) masterToggle.checked = true;
      for (const [key, element] of Object.entries(featureInputs)) {
        if (element) element.checked = true;
      }
      chrome.storage.sync.set(update, () => {
        updateUI();
      });
    });
  }
});
