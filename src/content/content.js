/**
 * Prime Video Auto Skip - Content Script
 * 
 * Executado no contexto isolado da extensão no Prime Video para:
 * 1. Pular aberturas e resumos automaticamente.
 * 2. Pular ou acelerar anúncios e propagandas comerciais.
 * 3. Ocultar o cursor do mouse após 3 segundos de inatividade durante a reprodução.
 * 4. Avançar para o próximo episódio automaticamente.
 * 5. Atalhos de conveniência (tecla F e duplo clique para tela cheia).
 */
(function () {
  'use strict';

  // Validação estrita de domínio: garante execução exclusiva no Prime Video
  function isPrimeVideoDomain() {
    const hostname = window.location.hostname.toLowerCase();
    const path = window.location.pathname.toLowerCase();

    // Domínio oficial do Prime Video
    if (hostname === 'primevideo.com' || hostname.endsWith('.primevideo.com')) {
      return true;
    }

    // Rotas de vídeo no ecossistema Amazon (nunca checkout, cart, pagamento ou catálogo comum)
    if (hostname.includes('amazon.')) {
      return path.startsWith('/gp/video') || path.startsWith('/video') || path.includes('/minitv');
    }

    return false;
  }

  // Aborta imediatamente se não estiver no domínio correto
  if (!isPrimeVideoDomain()) {
    return;
  }

  // Configurações padrão
  let settings = {
    extensionEnabled: true,
    autoSkipIntro: true,
    autoSkipAds: true,
    hideCursorOnIdle: true,
    autoNextEpisode: true,
    enableKeyF: true,
    enableDblClick: true
  };

  let idleTimer = null;
  const IDLE_TIMEOUT_MS = 3000;
  let lastSkipIntroTime = 0;
  let lastSkipAdTime = 0;
  let lastNextEpisodeTime = 0;
  let wasAdActive = false;

  // Aplica classe de escopo de estilos conforme o status da extensão
  function applyStylesState() {
    if (settings.extensionEnabled) {
      document.documentElement.classList.add('prime-active');
    } else {
      document.documentElement.classList.remove('prime-active');
      showCursor();
      clearTimeout(idleTimer);
      notifyAdState(false);
    }
  }

  // Carrega configurações do chrome.storage
  function loadSettings() {
    chrome.storage.sync.get(settings, (items) => {
      if (items) {
        settings = Object.assign(settings, items);
        applyStylesState();
        notifyInjectScript();
      }
    });
  }

  // Notifica o inject.js (contexto MAIN) sobre configurações
  function notifyInjectScript() {
    window.postMessage(
      {
        type: 'PRIME_UPDATE_SETTINGS',
        settings: settings
      },
      '*'
    );
  }

  // Notifica o inject.js sobre o estado de anúncio em andamento
  function notifyAdState(isActive) {
    if (wasAdActive !== isActive) {
      wasAdActive = isActive;
      window.postMessage(
        {
          type: 'PRIME_AD_STATE',
          isAdActive: isActive
        },
        '*'
      );
    }
  }

  // Monitora alterações em tempo real das opções
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
      for (const [key, change] of Object.entries(changes)) {
        settings[key] = change.newValue;
      }
      applyStylesState();
      if (!settings.hideCursorOnIdle) {
        showCursor();
        clearTimeout(idleTimer);
      }
      notifyInjectScript();
    }
  });

  loadSettings();

  // Verifica se o usuário está em rota de reprodução ativa com player
  function isPlaybackRoute() {
    if (!isPrimeVideoDomain() || !settings.extensionEnabled) return false;

    const path = window.location.pathname.toLowerCase();
    const isVideoUrl = path.includes('/detail/') || path.includes('/watch/') || path.includes('/gp/video');

    const playerContainer = document.querySelector(
      '.atvwebplayersdk-player-container, ' +
      '.webPlayerContainer, ' +
      '.scalingVideoContainer, ' +
      '.dv-player-fullscreen, ' +
      '[data-testid="player-container"], ' +
      '.rendererContainer'
    );
    const video = document.querySelector('video');

    return (playerContainer && video) || (isVideoUrl && video);
  }

  // Obtém o contêiner do player para buscas restritas
  function getPlayerContainer() {
    return document.querySelector(
      '.atvwebplayersdk-player-container, ' +
      '.webPlayerContainer, ' +
      '.scalingVideoContainer, ' +
      '.dv-player-fullscreen, ' +
      '[data-testid="player-container"], ' +
      '.rendererContainer'
    );
  }

  // Alterna tela cheia
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    } else {
      const container = getPlayerContainer() || document.documentElement;
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => {});
      }
    }
  }

  // 1. Pular ou acelerar anúncios e propagandas
  function checkAndSkipAds() {
    if (!settings.extensionEnabled || !settings.autoSkipAds || !isPlaybackRoute()) {
      notifyAdState(false);
      return false;
    }

    const now = Date.now();
    const player = getPlayerContainer() || document.body;

    // A. Busca botões de pular anúncio (Skip Ad)
    const adSkipSelectors = [
      '.adSkipButton',
      '.atvwebplayersdk-adskip-button',
      'button[data-testid="ad-skip-button"]',
      'button[aria-label*="skip ad" i]',
      'button[aria-label*="pular anúncio" i]',
      'button[aria-label*="pular anuncio" i]',
      'button[aria-label*="pular propaganda" i]',
      '.ad-skip-button',
      '.skip-ad',
      '.skipAd',
      'button.ad-skip'
    ];

    for (const selector of adSkipSelectors) {
      const btn = player.querySelector(selector);
      if (btn && btn.offsetParent !== null) {
        if (now - lastSkipAdTime > 1000) {
          lastSkipAdTime = now;
          btn.click();
          console.log('[Prime Video Auto Skip] Botão de pular anúncio clicado:', selector);
          notifyAdState(false);
          return true;
        }
      }
    }

    // B. Detecta se um anúncio comercial não pulável está sendo exibido
    const adCountdownSelectors = [
      '.adCountdown',
      '.atvwebplayersdk-adcountdown-wrapper',
      '[data-testid="ad-countdown"]',
      '.ad-indicator',
      '.ad-text',
      '.adBadge',
      '.atvwebplayersdk-adbadge',
      '.ad-banner'
    ];

    let hasAdIndicator = false;
    for (const selector of adCountdownSelectors) {
      const el = player.querySelector(selector);
      if (el && el.offsetParent !== null) {
        hasAdIndicator = true;
        break;
      }
    }

    // Busca também por texto de contagem de anúncio dentro dos overlays do player
    if (!hasAdIndicator) {
      const overlayTexts = player.querySelectorAll('.atvwebplayersdk-overlays-container span, .atvwebplayersdk-overlays-container div');
      for (const el of overlayTexts) {
        if (el.offsetParent === null) continue;
        const text = (el.textContent || '').trim().toLowerCase();
        if (
          text.includes('anúncio') ||
          text.includes('anuncio') ||
          text.includes('ad 1 of') ||
          text.includes('ad 2 of') ||
          text.includes('publicidade')
        ) {
          hasAdIndicator = true;
          break;
        }
      }
    }

    notifyAdState(hasAdIndicator);
    return hasAdIndicator;
  }

  // 2. Pular abertura e resumo
  function checkAndSkipIntro() {
    if (!settings.extensionEnabled || !settings.autoSkipIntro || !isPlaybackRoute()) return false;

    const now = Date.now();
    if (now - lastSkipIntroTime < 1500) return false;

    const player = getPlayerContainer() || document.body;

    // A. Seletores diretos conhecidos no Prime Video
    const introSelectors = [
      '.atvwebplayersdk-skipelement-button',
      '.skipElement',
      'button[data-testid="player-skip-intro"]',
      'button[data-testid="player-skip-recap"]',
      'button[data-testid*="skip-intro" i]',
      'button[data-testid*="skip-recap" i]',
      '[aria-label*="pular abertura" i]',
      '[aria-label*="pular resumo" i]',
      '[aria-label*="pular introdução" i]',
      '[aria-label*="pular introducao" i]',
      '[aria-label*="pular recapitulação" i]',
      '[aria-label*="pular recapitulacao" i]',
      '[aria-label*="skip intro" i]',
      '[aria-label*="skip recap" i]'
    ];

    for (const selector of introSelectors) {
      const btn = player.querySelector(selector);
      if (btn && btn.offsetParent !== null) {
        lastSkipIntroTime = now;
        btn.click();
        console.log('[Prime Video Auto Skip] Abertura/Resumo pulada via seletor:', selector);
        return true;
      }
    }

    // B. Busca restrita a botões dentro do player
    const candidateButtons = player.querySelectorAll('button, [role="button"]');
    for (const btn of candidateButtons) {
      if (btn.offsetParent === null) continue;

      const text = (btn.textContent || '').trim().toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
      const combined = `${text} ${aria}`;

      // Evita botões de reprodução ou checkout
      if (
        combined.includes('próximo') ||
        combined.includes('proximo') ||
        combined.includes('next episode') ||
        combined.includes('comprar') ||
        combined.includes('alugar') ||
        combined.includes('assinar') ||
        combined.includes('play') ||
        combined.includes('pause')
      ) {
        continue;
      }

      const isIntroOrRecap =
        combined.includes('pular abertura') ||
        combined.includes('pular introdução') ||
        combined.includes('pular introducao') ||
        combined.includes('pular resumo') ||
        combined.includes('pular recapitulação') ||
        combined.includes('pular recapitulacao') ||
        combined.includes('saltar abertura') ||
        combined.includes('saltar introdução') ||
        combined.includes('saltar resumo') ||
        combined.includes('skip intro') ||
        combined.includes('skip recap') ||
        (combined.startsWith('pular') && (combined.includes('intro') || combined.includes('abertura') || combined.includes('resumo'))) ||
        (combined.startsWith('saltar') && (combined.includes('intro') || combined.includes('abertura') || combined.includes('resumo')));

      if (isIntroOrRecap) {
        lastSkipIntroTime = now;
        btn.click();
        console.log('[Prime Video Auto Skip] Abertura/Resumo pulada via texto:', text || aria);
        return true;
      }
    }

    return false;
  }

  // 3. Próximo episódio automático
  function checkAndNextEpisode() {
    if (!settings.extensionEnabled || !settings.autoNextEpisode || !isPlaybackRoute()) return false;

    const now = Date.now();
    if (now - lastNextEpisodeTime < 2500) return false;

    const player = getPlayerContainer() || document.body;

    const nextSelectors = [
      '.atvwebplayersdk-nextupcard-button',
      '.nextUpCard button',
      '[data-testid="next-up-button"]',
      'button[aria-label*="próximo episódio" i]',
      'button[aria-label*="proximo episodio" i]',
      'button[aria-label*="next episode" i]'
    ];

    for (const selector of nextSelectors) {
      const btn = player.querySelector(selector);
      if (btn && btn.offsetParent !== null) {
        lastNextEpisodeTime = now;
        btn.click();
        console.log('[Prime Video Auto Skip] Próximo episódio acionado automaticamente.');
        return true;
      }
    }

    return false;
  }

  // 4. Ocultação do cursor após 3 segundos de inatividade
  function showCursor() {
    document.documentElement.classList.remove('prime-cursor-hidden');
  }

  function hideCursor() {
    if (settings.extensionEnabled && settings.hideCursorOnIdle && isPlaybackRoute()) {
      document.documentElement.classList.add('prime-cursor-hidden');
    }
  }

  function onUserActivity() {
    showCursor();
    clearTimeout(idleTimer);

    if (settings.extensionEnabled && settings.hideCursorOnIdle && isPlaybackRoute()) {
      idleTimer = setTimeout(hideCursor, IDLE_TIMEOUT_MS);
    }
  }

  window.addEventListener('mousemove', onUserActivity, { passive: true });
  window.addEventListener('pointermove', onUserActivity, { passive: true });
  window.addEventListener('mousedown', onUserActivity, { passive: true });
  window.addEventListener('keydown', onUserActivity, { passive: true });
  window.addEventListener('wheel', onUserActivity, { passive: true });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      showCursor();
      clearTimeout(idleTimer);
    }
  });

  // 5. Atalho Tecla 'F'
  window.addEventListener('keydown', (event) => {
    if (!settings.extensionEnabled || !settings.enableKeyF) return;

    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    if (event.key.toLowerCase() === 'f' && isPlaybackRoute()) {
      event.preventDefault();
      toggleFullscreen();
    }
  });

  // 6. Duplo clique no player para tela cheia
  document.addEventListener('dblclick', (event) => {
    if (!settings.extensionEnabled || !settings.enableDblClick || !isPlaybackRoute()) return;

    const target = event.target;
    const player = getPlayerContainer();

    if (target.tagName === 'VIDEO' || (player && player.contains(target))) {
      if (target.closest('button') || target.closest('[role="button"]') || target.closest('input')) {
        return;
      }
      event.preventDefault();
      toggleFullscreen();
    }
  });

  // 7. Observer do DOM para respostas imediatas a eventos no player
  const observer = new MutationObserver(() => {
    if (!settings.extensionEnabled || !isPlaybackRoute()) return;

    checkAndSkipAds();
    checkAndSkipIntro();
    checkAndNextEpisode();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // 8. Intervalo leve periódico de garantia (a cada 500ms)
  setInterval(() => {
    if (!settings.extensionEnabled || !isPlaybackRoute()) return;

    checkAndSkipAds();
    checkAndSkipIntro();
    checkAndNextEpisode();
  }, 500);

})();
