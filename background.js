'use strict';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'ml-api-fetch' || !message.url) {
    return false;
  }

  fetch(message.url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
    credentials: 'include',
  })
    .then(async (response) => {
      const responseText = await response.text();
      let data = null;

      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch (_error) {
        data = null;
      }

      sendResponse({
        handled: true,
        ok: response.ok,
        status: response.status,
        error: response.ok
          ? null
          : data?.message || responseText || response.statusText,
        source: 'background',
        data,
      });
    })
    .catch((error) => {
      sendResponse({
        handled: true,
        ok: false,
        status: 0,
        error: error.message,
        source: 'background',
        data: null,
      });
    });

  return true;
});
