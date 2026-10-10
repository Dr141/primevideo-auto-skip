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

    const playerContainer = getPlayerContainer();
    const hasVisiblePlayer = playerContainer && playerContainer.clientWidth > 0 && playerContainer.clientHeight > 0;

    // Verifica elementos de vídeo ativos
    const videos = document.querySelectorAll('video');
    let hasPlayingVideo = false;
    for (const v of videos) {
      if (v.currentTime > 0 || !v.paused || v.readyState >= 2) {
        hasPlayingVideo = true;
        break;
      }
    }

    if (hasVisiblePlayer && (hasPlayingVideo || videos.length > 0)) {
      return true;
    }

    return isVideoUrl && hasPlayingVideo;
  }

  // Obtém o elemento de vídeo ativo na reprodução principal
  function getActiveVideo() {
    // 0. Prioridade máxima: vídeo dentro do contêiner mestre do player do Prime Video (#dv-web-player)
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

    // Filtra todos os vídeos da página excluindo trailers de background (.draper-player-container)
    const videos = Array.from(document.querySelectorAll('video')).filter(
      v => !v.closest('.draper-player-container')
    );
    if (videos.length === 0) return null;

    // 1. Prioriza o vídeo que está tocando ativamente no momento
    for (const v of videos) {
      if (v.duration && isFinite(v.duration) && v.duration > 30) {
        if (!v.paused && v.currentTime > 0) {
          return v;
        }
      }
    }

    // 2. Procura vídeos com duração real de episódio ou filme (> 120s)
    for (const v of videos) {
      if (v.duration && isFinite(v.duration) && v.duration > 120) {
        if (v.currentTime > 0 || v.readyState >= 2) {
          return v;
        }
      }
    }

    // 3. Fallback: qualquer vídeo com duração válida (> 30s)
    for (const v of videos) {
      if (v.duration && isFinite(v.duration) && v.duration > 30) {
        return v;
      }
    }

    return videos[0] || null;
  }

  // Verifica se o vídeo está comprovadamente nos momentos finais (créditos)
  function isVideoNearEnd() {
    const video = getActiveVideo();
    if (!video) return false;

    // Se o vídeo já terminou completamente
    if (video.ended) return true;

    const duration = video.duration;
    const currentTime = video.currentTime;

    // Se não há duração finita válida, não avança por precaução
    if (!duration || !isFinite(duration) || duration <= 0) return false;

    // Trava de segurança temporal essencial:
    // 1. O vídeo precisa ter reproduzido mais de 60 segundos
    // 2. Ter alcançado pelo menos 80% do progresso total do episódio
    // 3. Faltar no máximo 240 segundos (4 minutos) para o fim
    const remaining = duration - currentTime;
    const progress = currentTime / duration;
    return currentTime > 60 && progress >= 0.80 && remaining <= 240 && remaining >= 0;
  }

  // Obtém o contêiner do player para buscas restritas
  function getPlayerContainer() {
    const dvPlayer = document.getElementById('dv-web-player');
    if (dvPlayer) return dvPlayer;

    const activeVideo = getActiveVideo();
    if (activeVideo) {
      const parentContainer = activeVideo.closest(
        '#dv-web-player, ' +
        '.dv-player-fullscreen, ' +
        '.webPlayerContainer, ' +
        '.scalingVideoContainer, ' +
        '[data-testid="player-container"], ' +
        '.rendererContainer, ' +
        '.atvwebplayersdk-player-container'
      );
      if (parentContainer) return parentContainer;

      if (activeVideo.parentElement && activeVideo.parentElement !== document.body) {
        return activeVideo.parentElement.parentElement || activeVideo.parentElement;
      }
    }

    return document.querySelector(
      '#dv-web-player, ' +
      '.dv-player-fullscreen, ' +
      '.webPlayerContainer, ' +
      '.scalingVideoContainer, ' +
      '[data-testid="player-container"], ' +
      '.rendererContainer, ' +
      '.atvwebplayersdk-player-container'
    );
  }

  // Alterna tela cheia
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch((err) => {
          console.warn('[Prime Video Auto Skip] Erro ao sair de tela cheia:', err);
        });
      }
      return;
    }

    // 1. Tenta acionar o botão nativo de tela cheia do Prime Video se presente no DOM
    const nativeFullscreenBtn = document.querySelector(
      'button[aria-label*="tela cheia" i], ' +
      'button[aria-label*="fullscreen" i], ' +
      'button[data-testid="fullscreen-button"], ' +
      'button[data-uia="control-fullscreen"]'
    );
    if (nativeFullscreenBtn && isElementVisible(nativeFullscreenBtn)) {
      simulateClick(nativeFullscreenBtn);
      return;
    }

    // 2. Aciona requestFullscreen no contêiner mestre (#dv-web-player) ou fallback
    const container = document.getElementById('dv-web-player') || getPlayerContainer() || document.documentElement;
    if (container && container.requestFullscreen) {
      container.requestFullscreen().catch((err) => {
        console.warn('[Prime Video Auto Skip] container.requestFullscreen rejeitado, tentando documentElement:', err);
        if (document.documentElement && document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch((docErr) => {
            console.warn('[Prime Video Auto Skip] documentElement.requestFullscreen falhou:', docErr);
          });
        }
      });
    } else if (document.documentElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn('[Prime Video Auto Skip] requestFullscreen falhou:', err);
      });
    }
  }

  // Verifica se o elemento está realmente visível e renderizado na tela (com dimensões reais > 0)
  function isElementVisible(el) {
    if (!el) return false;
    try {
      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        parseFloat(style.opacity || '1') === 0
      ) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (e) {
      return false;
    }
  }

  // Simula clique completo (mouse + pointer) compatível com React e players modernos
  function simulateClick(element) {
    if (!element) return false;
    try {
      element.focus?.();
      const eventInit = { bubbles: true, cancelable: true, view: window };
      element.dispatchEvent(new PointerEvent('pointerdown', eventInit));
      element.dispatchEvent(new MouseEvent('mousedown', eventInit));
      element.dispatchEvent(new PointerEvent('pointerup', eventInit));
      element.dispatchEvent(new MouseEvent('mouseup', eventInit));
      element.dispatchEvent(new MouseEvent('click', eventInit));
      element.click?.();
      return true;
    } catch (err) {
      try {
        element.click?.();
        return true;
      } catch (e) {
        return false;
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
          simulateClick(btn);
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
      if (btn && isElementVisible(btn)) {
        lastSkipIntroTime = now;
        simulateClick(btn);
        console.log('[Prime Video Auto Skip] Abertura/Resumo pulada via seletor:', selector);
        return true;
      }
    }

    // B. Busca restrita a botões dentro do player
    const candidateButtons = player.querySelectorAll('button, [role="button"]');
    for (const btn of candidateButtons) {
      if (!isElementVisible(btn)) continue;

      const text = (btn.textContent || '').trim().toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
      const combined = `${text} ${aria}`;

      // Evita botões de reprodução, próximo episódio ou checkout
      if (
        combined.includes('próximo') ||
        combined.includes('proximo') ||
        combined.includes('next episode') ||
        combined.includes('a seguir') ||
        combined.includes('up next') ||
        combined.includes('next up') ||
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
        simulateClick(btn);
        console.log('[Prime Video Auto Skip] Abertura/Resumo pulada via texto:', text || aria);
        return true;
      }
    }

    return false;
  }

  // Verifica se o elemento deve ser ignorado para evitar cliques indesejados (ex: curtir, feedback, fechar, carrosséis)
  function isExcludedNextUpElement(el) {
    if (!el) return true;
    const text = (el.textContent || '').trim().toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
    const testid = (el.getAttribute('data-testid') || '').trim().toLowerCase();
    const className = (typeof el.className === 'string' ? el.className : '').toLowerCase();
    const combined = `${text} ${aria} ${testid} ${className}`;

    return (
      combined.includes('curtir') ||
      combined.includes('não tenho interesse') ||
      combined.includes('nao tenho interesse') ||
      combined.includes('feedback') ||
      combined.includes('like') ||
      combined.includes('dislike') ||
      combined.includes('fechar') ||
      combined.includes('close') ||
      combined.includes('voltar') ||
      combined.includes('back') ||
      combined.includes('mute') ||
      combined.includes('legendas') ||
      combined.includes('subtitles') ||
      combined.includes('áudio') ||
      combined.includes('audio') ||
      combined.includes('configurações') ||
      combined.includes('configuracoes') ||
      combined.includes('settings') ||
      combined.includes('títulos') ||
      combined.includes('titulos') ||
      combined.includes('arrow') ||
      combined.includes('slider') ||
      combined.includes('volume') ||
      combined.includes('retroceder') ||
      combined.includes('avançar 10') ||
      combined.includes('avancar 10')
    );
  }

  // Localiza o elemento interativo de reprodução dentro do card de próximo episódio
  function findNextUpClickable(container) {
    if (!container || !isElementVisible(container) || isExcludedNextUpElement(container)) return null;

    const rect = container.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) {
      return null;
    }

    // 1. Botões diretos com aria-label ou data-testid de próximo / play / a seguir
    const specificBtn = container.querySelector(
      '.atvwebplayersdk-nextupcard-button, ' +
      '[data-testid="nextup-button"], ' +
      '[data-testid="next-up-button"], ' +
      '[data-testid="nextupcard-play-button"], ' +
      'button[aria-label*="a seguir" i], ' +
      'button[aria-label*="assistir" i], ' +
      'button[aria-label*="reproduzir" i], ' +
      'button[aria-label*="play" i], ' +
      'button[aria-label*="próximo" i], ' +
      'button[aria-label*="proximo" i], ' +
      'button[aria-label*="next" i], ' +
      '[role="button"][aria-label*="a seguir" i], ' +
      '[role="button"][aria-label*="assistir" i], ' +
      '[role="button"][aria-label*="reproduzir" i], ' +
      '[role="button"][aria-label*="play" i], ' +
      '[role="button"][aria-label*="próximo" i], ' +
      '[role="button"][aria-label*="proximo" i], ' +
      '[role="button"][aria-label*="next" i]'
    );
    if (specificBtn && isElementVisible(specificBtn) && !isExcludedNextUpElement(specificBtn)) {
      return specificBtn;
    }

    // 2. Qualquer botão ou role="button" válido com dimensões reais dentro do card
    const buttons = container.querySelectorAll('button, [role="button"]');
    for (const b of buttons) {
      if (isElementVisible(b) && !isExcludedNextUpElement(b)) {
        const bRect = b.getBoundingClientRect();
        if (bRect.width >= 15 && bRect.height >= 15) {
          return b;
        }
      }
    }

    // 3. Links, thumbnails com ícones de play ou elementos svg clicáveis
    const interactives = container.querySelectorAll('a, [class*="play" i], [class*="thumbnail" i], svg, img');
    for (const item of interactives) {
      if (isElementVisible(item) && !isExcludedNextUpElement(item)) {
        const clickableAncestor = item.closest('a, [role="button"], button');
        return clickableAncestor || item;
      }
    }

    // 4. Se o próprio contêiner for semanticamente um botão ou tiver role button
    if (
      (container.tagName === 'BUTTON' || container.getAttribute('role') === 'button') &&
      !isExcludedNextUpElement(container)
    ) {
      return container;
    }

    return null;
  }

  // 3. Próximo episódio automático (inclui suporte nativo ao card "A seguir" / "Up Next")
  function checkAndNextEpisode() {
    if (!settings.extensionEnabled || !settings.autoNextEpisode || !isPlaybackRoute()) return false;

    // Trava de segurança temporal essencial: NUNCA avançar episódio durante a exibição normal do episódio.
    // O próximo episódio só pode ser acionado se o vídeo estiver comprovadamente nos créditos finais (<= 4 min restantes).
    if (!isVideoNearEnd()) return false;

    const now = Date.now();
    if (now - lastNextEpisodeTime < 3000) return false;

    // Escopo estritamente restrito ao player ativo (NUNCA document.body para evitar elementos da página de detalhes/catálogo)
    const searchScope = document.fullscreenElement || getPlayerContainer();
    if (!searchScope) return false;

    // Método 1: Seletores diretos dentro dos contêineres do card "A seguir" / "Next Up"
    const directNextSelectors = [
      '.atvwebplayersdk-nextupcard-button',
      '.atvwebplayersdk-nextupcard-wrapper button',
      '.atvwebplayersdk-nextupcard-wrapper [role="button"]',
      '.atvwebplayersdk-nextupcard-wrapper a',
      '.atvwebplayersdk-nextupcard-container button',
      '.atvwebplayersdk-nextupcard-container [role="button"]',
      '.atvwebplayersdk-nextupcard-container a',
      '.atvwebplayersdk-nextupcard-episode button',
      '.atvwebplayersdk-nextupcard-episode [role="button"]',
      '.nextUpCard button',
      '.nextUpCard [role="button"]',
      '[data-testid="next-up-button"]',
      '[data-testid="nextup-button"]',
      '[data-testid="nextupcard-play-button"]',
      '[data-testid="next-up-card"] button',
      '[data-testid="next-up-card"] [role="button"]',
      '[data-testid="nextup-card"] button',
      '[data-testid="nextup-card"] [role="button"]',
      '[data-testid*="nextup" i] button',
      '[data-testid*="nextup" i] [role="button"]',
      '[class*="nextupcard" i] button',
      '[class*="nextupcard" i] [role="button"]',
      '[class*="nextUpCard" i] button',
      '[class*="nextUpCard" i] [role="button"]',
      'button[aria-label*="a seguir" i]',
      '[role="button"][aria-label*="a seguir" i]',
      'button[aria-label*="assistir a seguir" i]',
      '[role="button"][aria-label*="assistir a seguir" i]',
      'button[aria-label*="reproduzir a seguir" i]',
      '[role="button"][aria-label*="reproduzir a seguir" i]'
    ];

    for (const selector of directNextSelectors) {
      const btn = searchScope.querySelector(selector);
      if (btn && isElementVisible(btn) && !isExcludedNextUpElement(btn)) {
        const btnRect = btn.getBoundingClientRect();
        if (btnRect.width >= 20 && btnRect.height >= 20) {
          lastNextEpisodeTime = now;
          simulateClick(btn);
          console.log('[Prime Video Auto Skip] Próximo episódio acionado via seletor direto:', selector);
          return true;
        }
      }
    }

    // Método 2: Detecção de contêineres do card Next Up / A seguir (com dimensões reais)
    const nextUpContainers = searchScope.querySelectorAll(
      '.atvwebplayersdk-nextupcard-wrapper, ' +
      '.atvwebplayersdk-nextupcard-container, ' +
      '[data-testid*="nextup" i], ' +
      '[data-testid*="next-up" i], ' +
      '[class*="nextupcard" i], ' +
      '[class*="nextUpCard" i], ' +
      '[class*="next-up" i]'
    );

    for (const container of nextUpContainers) {
      if (isElementVisible(container) && !isExcludedNextUpElement(container)) {
        const target = findNextUpClickable(container);
        if (target) {
          lastNextEpisodeTime = now;
          simulateClick(target);
          console.log('[Prime Video Auto Skip] Próximo episódio acionado via contêiner Next Up.');
          return true;
        }
      }
    }

    // Método 3: Detecção baseada no texto visual "A seguir" / "Up Next" no player ativo
    const overlayHeadings = searchScope.querySelectorAll('div, span, h1, h2, h3, p, strong, b');

    for (const el of overlayHeadings) {
      if (!isElementVisible(el)) continue;
      // Evita contêineres complexos com muitos filhos
      if (el.children.length > 2) continue;

      const text = (el.textContent || '').trim().toLowerCase();
      const isNextUpHeading =
        text === 'a seguir' ||
        text === 'up next' ||
        text === 'next up' ||
        text === 'a continuación' ||
        text === 'à suivre' ||
        text === 'als nächstes' ||
        text.startsWith('a seguir:') ||
        text.startsWith('up next:') ||
        text.startsWith('next up:');

      if (isNextUpHeading) {
        const cardParent = el.closest(
          '.atvwebplayersdk-nextupcard-wrapper, ' +
          '.atvwebplayersdk-nextupcard-container, ' +
          '[class*="nextup" i], ' +
          '[class*="nextUp" i], ' +
          '[class*="card" i]'
        ) || el.parentElement?.parentElement || el.parentElement;

        if (cardParent) {
          const clickable = findNextUpClickable(cardParent);
          if (clickable && clickable !== el) {
            lastNextEpisodeTime = now;
            simulateClick(clickable);
            console.log('[Prime Video Auto Skip] Próximo episódio acionado via detecção de cabeçalho "A seguir":', text);
            return true;
          }
        }
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

  // 8. Intervalo leve periódico de garantia (a cada 500ms)
  setInterval(() => {
    if (!settings.extensionEnabled || !isPlaybackRoute()) return;

    checkAndSkipAds();
    checkAndSkipIntro();
    checkAndNextEpisode();
  }, 500);

})();
