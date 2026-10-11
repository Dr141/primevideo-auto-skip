/**
 * Prime Video Auto Skip - Content Script
 * 
 * Executado no contexto isolado da extensão no Prime Video para:
 * 1. Pular aberturas e resumos automaticamente (Pular resumo e depois Pular abertura).
 * 2. Pular ou acelerar anúncios e propagandas comerciais.
 * 3. Ocultar o cursor do mouse após 3 segundos de inatividade durante a reprodução.
 * 4. Avançar para o próximo episódio apenas quando a opção "A seguir" aparecer.
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
      '#dv-web-player, ' +
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
      '#dv-web-player, ' +
      '.atvwebplayersdk-player-container, ' +
      '.webPlayerContainer, ' +
      '.scalingVideoContainer, ' +
      '.dv-player-fullscreen, ' +
      '[data-testid="player-container"], ' +
      '.rendererContainer'
    );
  }

  // Obtém o elemento de vídeo ativo da reprodução principal
  function getActiveVideo() {
    // 1. Busca primeiro dentro do player principal (#dv-web-player)
    const dvPlayer = document.getElementById('dv-web-player');
    if (dvPlayer) {
      const dvVideos = Array.from(dvPlayer.querySelectorAll('video')).filter(
        v => !v.closest('.draper-player-container')
      );
      for (const v of dvVideos) {
        if (!v.paused && v.currentTime > 0) return v;
      }
      for (const v of dvVideos) {
        if (v.currentTime > 0 || v.readyState >= 2 || (v.duration && isFinite(v.duration) && v.duration > 30)) {
          return v;
        }
      }
      if (dvVideos.length > 0) return dvVideos[0];
    }

    // 2. Busca qualquer vídeo na página excluindo trailers de background
    const videos = Array.from(document.querySelectorAll('video')).filter(
      v => !v.closest('.draper-player-container')
    );
    if (videos.length === 0) return null;

    for (const v of videos) {
      if (v.duration && isFinite(v.duration) && v.duration > 30) {
        if (!v.paused && v.currentTime > 0) return v;
      }
    }

    for (const v of videos) {
      if (v.duration && isFinite(v.duration) && v.duration > 60) {
        return v;
      }
    }

    return videos[0] || null;
  }

  // Verifica se o vídeo está comprovadamente nos momentos finais (créditos) ou encerrado
  function isVideoAtEnd() {
    const video = getActiveVideo();
    if (!video) return false;

    // Se o vídeo já chegou ao fim
    if (video.ended) return true;

    const duration = video.duration;
    const currentTime = video.currentTime;

    // Se a duração não for válida, não avança por segurança
    if (!duration || !isFinite(duration) || duration <= 60) {
      return false;
    }

    // Trava de segurança temporal estrita:
    // 1. O vídeo precisa ter reproduzido mais de 2 minutos (120s) - NUNCA no início do episódio!
    // 2. Ter alcançado pelo menos 80% do progresso total (0.80)
    // 3. Faltar no máximo 4 minutos (240 segundos) para o término
    const remaining = duration - currentTime;
    const progress = currentTime / duration;

    return currentTime > 120 && progress >= 0.80 && remaining <= 240 && remaining >= 0;
  }

  // Verifica se um elemento está visível na tela
  function isElementVisible(el) {
    if (!el) return false;
    if (el.offsetParent !== null) return true;
    try {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (e) {
      return false;
    }
  }

  // Dispara clique confiável em um elemento
  function clickElement(el) {
    if (!el) return;
    try {
      el.focus();
    } catch (e) {}
    try {
      el.click();
    } catch (e) {}
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch (e) {}
  }

  // Alterna tela cheia
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    } else {
      const container = document.getElementById('dv-web-player') || getPlayerContainer() || document.documentElement;
      if (container && container.requestFullscreen) {
        container.requestFullscreen().catch(() => {
          if (document.documentElement && document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
          }
        });
      } else if (document.documentElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
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
      if (btn && isElementVisible(btn)) {
        if (now - lastSkipAdTime > 1000) {
          lastSkipAdTime = now;
          clickElement(btn);
          console.log('[Prime Video Auto Skip] Botão de pular anúncio clicado:', selector);
          notifyAdState(false);
          return true;
        }
      }
    }

    // B. Indicador de comercial ativo para acelerar em inject.js
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
      if (el && isElementVisible(el)) {
        hasAdIndicator = true;
        break;
      }
    }

    // Busca também por texto de contagem de anúncio dentro dos overlays do player
    if (!hasAdIndicator) {
      const overlayTexts = player.querySelectorAll('.atvwebplayersdk-overlays-container span, .atvwebplayersdk-overlays-container div');
      for (const el of overlayTexts) {
        if (!isElementVisible(el)) continue;
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

  // 2. Pular abertura e resumo (Pular resumo no início e depois Pular abertura)
  function checkAndSkipIntro() {
    if (!settings.extensionEnabled || !settings.autoSkipIntro || !isPlaybackRoute()) return false;

    const now = Date.now();
    if (now - lastSkipIntroTime < 1000) return false;

    const player = getPlayerContainer() || document.body;

    // A. Seletores diretos conhecidos no Prime Video para resumo e abertura
    const introSelectors = [
      '.atvwebplayersdk-skipelement-button',
      '.skipElement',
      'button[data-testid="player-skip-intro"]',
      'button[data-testid="player-skip-recap"]',
      'button[data-testid*="skip-intro" i]',
      'button[data-testid*="skip-recap" i]',
      '[aria-label*="pular resumo" i]',
      '[aria-label*="pular abertura" i]',
      '[aria-label*="pular introdução" i]',
      '[aria-label*="pular introducao" i]',
      '[aria-label*="pular recapitulação" i]',
      '[aria-label*="pular recapitulacao" i]',
      '[aria-label*="skip recap" i]',
      '[aria-label*="skip intro" i]'
    ];

    for (const selector of introSelectors) {
      const btn = player.querySelector(selector);
      if (btn && isElementVisible(btn)) {
        lastSkipIntroTime = now;
        clickElement(btn);
        console.log('[Prime Video Auto Skip] Abertura/Resumo pulada via seletor:', selector);
        return true;
      }
    }

    // B. Busca em botões ou elementos clicáveis com textos "Pular resumo", "Pular abertura", etc.
    const candidateButtons = player.querySelectorAll(
      'button, [role="button"], [class*="skipelement" i], [class*="skipElement" i], [class*="skip-button" i]'
    );
    for (const btn of candidateButtons) {
      if (!isElementVisible(btn)) continue;

      const text = (btn.textContent || '').trim().toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
      const combined = `${text} ${aria}`;

      // Evita botões de reprodução ou catálogo
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
        combined.includes('pular resumo') ||
        combined.includes('pular abertura') ||
        combined.includes('pular introdução') ||
        combined.includes('pular introducao') ||
        combined.includes('pular recapitulação') ||
        combined.includes('pular recapitulacao') ||
        combined.includes('saltar resumo') ||
        combined.includes('saltar abertura') ||
        combined.includes('saltar introdução') ||
        combined.includes('skip recap') ||
        combined.includes('skip intro') ||
        (combined.startsWith('pular') && (combined.includes('resumo') || combined.includes('intro') || combined.includes('abertura'))) ||
        (combined.startsWith('saltar') && (combined.includes('resumo') || combined.includes('intro') || combined.includes('abertura')));

      if (isIntroOrRecap) {
        lastSkipIntroTime = now;
        const clickable = btn.closest('button, [role="button"]') || btn;
        clickElement(clickable);
        console.log('[Prime Video Auto Skip] Abertura/Resumo pulada via texto:', text || aria);
        return true;
      }
    }

    // C. Busca direta por elementos de texto com "Pular resumo" ou "Pular abertura"
    const textElements = player.querySelectorAll('div, span, a');
    for (const el of textElements) {
      if (el.children.length > 2) continue;
      if (!isElementVisible(el)) continue;

      const text = (el.textContent || '').trim().toLowerCase();
      if (
        text === 'pular resumo' ||
        text === 'pular abertura' ||
        text === 'pular introdução' ||
        text === 'pular introducao' ||
        text === 'pular recapitulação' ||
        text === 'pular recapitulacao' ||
        text === 'saltar resumo' ||
        text === 'saltar abertura' ||
        text === 'skip intro' ||
        text === 'skip recap'
      ) {
        lastSkipIntroTime = now;
        const clickable = el.closest('button, [role="button"], a') || el;
        clickElement(clickable);
        console.log('[Prime Video Auto Skip] Abertura/Resumo pulada via texto direto:', text);
        return true;
      }
    }

    return false;
  }

  // Verifica se a opção "A seguir" (Up Next) está visível na tela
  function findAseguirOption(player) {
    if (!player) return null;

    // 1. Contêineres oficiais do card "A seguir" / "Next Up"
    const containers = player.querySelectorAll(
      '.atvwebplayersdk-nextupcard-wrapper, ' +
      '.atvwebplayersdk-nextupcard-container, ' +
      '.atvwebplayersdk-nextupcard-button, ' +
      '.nextUpCard, ' +
      '[data-testid*="nextup" i], ' +
      '[data-testid*="next-up" i], ' +
      '[class*="nextupcard" i], ' +
      '[class*="nextUpCard" i], ' +
      '[class*="next-up" i]'
    );
    for (const c of containers) {
      if (isElementVisible(c)) {
        return c;
      }
    }

    // 2. Busca elementos de texto visual "A seguir" / "Up Next" visíveis no player
    const elements = player.querySelectorAll('div, span, p, h1, h2, h3, h4, strong, b');
    for (const el of elements) {
      if (el.children.length > 2) continue;
      if (!isElementVisible(el)) continue;

      const text = (el.textContent || '').trim().toLowerCase();
      if (
        text === 'a seguir' ||
        text.startsWith('a seguir') ||
        text === 'up next' ||
        text.startsWith('up next') ||
        text === 'next up' ||
        text.startsWith('next up')
      ) {
        const card = el.closest(
          '.atvwebplayersdk-nextupcard-wrapper, ' +
          '.atvwebplayersdk-nextupcard-container, ' +
          '[class*="nextup" i], ' +
          '[class*="nextUp" i], ' +
          '[class*="card" i]'
        );
        return card || el;
      }
    }

    return null;
  }

  // 3. Próximo episódio automático (acionado APENAS ao final do episódio quando a opção "A seguir" aparecer)
  function checkAndNextEpisode() {
    if (!settings.extensionEnabled || !settings.autoNextEpisode || !isPlaybackRoute()) return false;

    // REGRA DE SEGURANÇA MANDATÓRIA:
    // O próximo episódio NUNCA pode ser acionado no início ou meio da reprodução.
    // DEVE ser acionado APENAS ao final do episódio (créditos finais ou vídeo encerrado).
    if (!isVideoAtEnd()) {
      return false;
    }

    const now = Date.now();
    if (now - lastNextEpisodeTime < 2500) return false;

    const player = getPlayerContainer() || document.body;

    // Trava mandatória: só aciona se a opção "A seguir" estiver visível na tela
    const aSeguirElement = findAseguirOption(player);
    if (!aSeguirElement) {
      return false;
    }

    // Quando a opção "A seguir" aparece, clica no botão do card "A seguir" ou no botão "Próximo episódio"
    // 1. Tenta clicar no botão ou elemento interativo dentro do card "A seguir"
    const cardButton = aSeguirElement.querySelector(
      'button, [role="button"], a, [class*="button" i], [class*="play" i]'
    );
    if (cardButton && isElementVisible(cardButton)) {
      lastNextEpisodeTime = now;
      clickElement(cardButton);
      console.log('[Prime Video Auto Skip] Próximo episódio acionado via botão dentro do card "A seguir".');
      return true;
    }

    // 2. Se o próprio elemento "A seguir" for um botão ou link
    if (aSeguirElement.tagName === 'BUTTON' || aSeguirElement.getAttribute('role') === 'button' || aSeguirElement.tagName === 'A') {
      lastNextEpisodeTime = now;
      clickElement(aSeguirElement);
      console.log('[Prime Video Auto Skip] Próximo episódio acionado clicando na opção "A seguir".');
      return true;
    }

    // 3. Clica no botão "Próximo episódio" com confirmação de que "A seguir" está visível
    const nextEpisodeBtn = player.querySelector(
      '.atvwebplayersdk-nextupcard-button, ' +
      'button[aria-label*="próximo episódio" i], ' +
      'button[aria-label*="proximo episodio" i], ' +
      'button[aria-label*="next episode" i], ' +
      '[data-testid="next-up-button"]'
    );
    if (nextEpisodeBtn && isElementVisible(nextEpisodeBtn)) {
      lastNextEpisodeTime = now;
      clickElement(nextEpisodeBtn);
      console.log('[Prime Video Auto Skip] Botão "Próximo episódio" acionado após exibição da opção "A seguir".');
      return true;
    }

    // 4. Fallback: clica diretamente no card "A seguir"
    lastNextEpisodeTime = now;
    clickElement(aSeguirElement);
    console.log('[Prime Video Auto Skip] Opção "A seguir" clicada.');
    return true;
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

    const isInsidePlayer =
      target.tagName === 'VIDEO' ||
      (player && player.contains(target)) ||
      Boolean(target.closest('#dv-web-player, .atvwebplayersdk-video-surface, .atvwebplayersdk-player-container, .webPlayerContainer'));

    if (isInsidePlayer) {
      if (target.closest('button') || target.closest('[role="button"]') || target.closest('input') || target.closest('a')) {
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

  // 8. Intervalo periódico de garantia (a cada 500ms)
  setInterval(() => {
    if (!settings.extensionEnabled || !isPlaybackRoute()) return;

    checkAndSkipAds();
    checkAndSkipIntro();
    checkAndNextEpisode();
  }, 500);

})();
