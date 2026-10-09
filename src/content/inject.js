/**
 * Prime Video Auto Skip - Injected Script (MAIN world)
 * 
 * Executado no contexto nativo da página do Prime Video para:
 * 1. Manipular propriedades do elemento <video> diretamente (playbackRate, muted) para acelerar anúncios não puláveis.
 * 2. Manter estabilidade do player e gerenciar sincronização de configurações.
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

    // Rotas de vídeo no ecossistema Amazon (nunca checkout, cart ou páginas gerais)
    if (hostname.includes('amazon.')) {
      return path.startsWith('/gp/video') || path.startsWith('/video') || path.includes('/minitv');
    }

    return false;
  }

  // Aborta imediatamente se não estiver no domínio correto
  if (!isPrimeVideoDomain()) {
    return;
  }

  console.log('[Prime Video Auto Skip] Script injetado no contexto MAIN inicializado com sucesso.');

  // Configuração padrão
  let settings = {
    extensionEnabled: true,
    autoSkipIntro: true,
    autoSkipAds: true,
    hideCursorOnIdle: true,
    autoNextEpisode: true,
    enableKeyF: true,
    enableDblClick: true
  };

  // Carrega configuração salva se houver
  try {
    const saved = localStorage.getItem('prime_auto_skip_settings');
    if (saved) {
      settings = Object.assign(settings, JSON.parse(saved));
    }
  } catch (e) {}

  let isSpeedingUpAd = false;
  let savedPlaybackRate = 1.0;
  let savedMuted = false;

  // Recebe mensagens do content script
  window.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.type === 'PRIME_UPDATE_SETTINGS') {
      settings = Object.assign(settings, event.data.settings);
      try {
        localStorage.setItem('prime_auto_skip_settings', JSON.stringify(settings));
      } catch (e) {}

      if (!settings.extensionEnabled || !settings.autoSkipAds) {
        if (isSpeedingUpAd) {
          restoreNormalPlayback();
        }
      }
    }

    if (event.data.type === 'PRIME_AD_STATE') {
      handleAdState(event.data.isAdActive);
    }
  });

  // Gerencia o aceleramento e silenciamento de anúncios em execução
  function handleAdState(isAdActive) {
    if (!settings.extensionEnabled || !settings.autoSkipAds) {
      if (isSpeedingUpAd) {
        restoreNormalPlayback();
      }
      return;
    }

    const video = document.querySelector('video');
    if (!video) return;

    if (isAdActive) {
      if (!isSpeedingUpAd) {
        isSpeedingUpAd = true;
        savedPlaybackRate = video.playbackRate && video.playbackRate <= 2.0 ? video.playbackRate : 1.0;
        savedMuted = video.muted;
        console.log('[Prime Video Auto Skip] Comercial detectado. Acelerando a 16x e silenciando o áudio.');
      }

      try {
        video.muted = true;
        video.playbackRate = 16.0;
      } catch (e) {}
    } else {
      if (isSpeedingUpAd) {
        restoreNormalPlayback();
      }
    }
  }

  // Restaura velocidade e áudio normais após o término do anúncio
  function restoreNormalPlayback() {
    const video = document.querySelector('video');
    if (video) {
      try {
        video.playbackRate = savedPlaybackRate || 1.0;
        video.muted = savedMuted;
        console.log('[Prime Video Auto Skip] Comercial finalizado. Velocidade normal e áudio restaurados.');
      } catch (e) {}
    }
    isSpeedingUpAd = false;
  }

})();
