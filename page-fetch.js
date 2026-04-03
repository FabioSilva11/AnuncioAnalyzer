'use strict';

window.addEventListener('message', async (event) => {
  if (event.source !== window || event.data?.type !== 'anuncio-analyzer-fetch') {
    return;
  }

  const { requestId, url } = event.data;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
      credentials: 'include',
    });
    const responseText = await response.text();
    let data = null;

    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch (_error) {
      data = null;
    }

    window.postMessage(
      {
        type: 'anuncio-analyzer-fetch-response',
        requestId,
        response: {
          handled: true,
          ok: response.ok,
          status: response.status,
          error: response.ok
            ? null
            : data?.message || responseText || response.statusText,
          source: 'page',
          data,
        },
      },
      '*'
    );
  } catch (error) {
    window.postMessage(
      {
        type: 'anuncio-analyzer-fetch-response',
        requestId,
        response: {
          handled: true,
          ok: false,
          status: 0,
          error: error.message,
          source: 'page',
          data: null,
        },
      },
      '*'
    );
  }
});
