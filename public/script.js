// Регистрация service worker (для работы офлайн) — как в ЛР №6
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
