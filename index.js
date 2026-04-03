'use strict';

const SELECTORS = {
  anchor: '.ui-pdp-header__title-container',
  subtitle: '.ui-pdp-subtitle',
  priceFraction: '[data-testid="price-part"] .andes-money-amount__fraction',
  priceCents: '[data-testid="price-part"] .andes-money-amount__cents',
};

const API_SOURCES = {
  background: 'extensao',
  direct: 'pagina',
  page: 'pagina',
};

const NOT_AVAILABLE = 'Indisponivel';
let pageFetchBridgePromise = null;

async function init() {
  try {
    const anchor = await waitForElement(SELECTORS.anchor);

    if (!anchor) {
      return;
    }

    const pageData = extractPageData(anchor);
    const apiResults = await validateApiEndpoints(pageData);
    const mergedData = mergeDataSources(pageData, apiResults);

    renderAnalyzer(anchor, mergedData, apiResults);
    logEndpointValidation(apiResults, mergedData);
  } catch (error) {
    console.error('AnuncioAnalyzer falhou ao iniciar:', error);
  }
}

function extractPageData(anchor) {
  const embeddedData = extractEmbeddedData();
  const subtitleElement = document.querySelector(SELECTORS.subtitle);
  const subtitleText =
    subtitleElement?.getAttribute('aria-label') ||
    subtitleElement?.textContent ||
    '';

  return {
    anchor,
    itemId: extractItemId() || embeddedData.itemId,
    categoryId: embeddedData.categoryId,
    listingTypeId: embeddedData.listingTypeId,
    price: extractPrice(embeddedData.price),
    soldQuantity: extractSoldQuantity(subtitleText),
  };
}

function extractEmbeddedData() {
  const scriptText = Array.from(document.scripts)
    .map((script) => script.textContent || '')
    .find((text) => text.includes('melidata("add","event_data"'));

  if (!scriptText) {
    return {};
  }

  return {
    itemId: extractMatch(scriptText, /"item_id":"([^"]+)"/),
    categoryId: extractMatch(scriptText, /"category_id":"([^"]+)"/),
    listingTypeId: extractMatch(scriptText, /"listing_type_id":"([^"]+)"/),
    price: extractNumberMatch(scriptText, /"price":([0-9.]+)/),
  };
}

function extractItemId() {
  return document
    .querySelector('meta[name="twitter:app:url:iphone"]')
    ?.content?.split('id=')[1];
}

function extractPrice(fallbackPrice) {
  if (Number.isFinite(fallbackPrice)) {
    return fallbackPrice;
  }

  const fractionText =
    document.querySelector(SELECTORS.priceFraction)?.textContent || '';
  const centsText =
    document.querySelector(SELECTORS.priceCents)?.textContent || '00';
  const priceFromDom = parseMoneyParts(fractionText, centsText);

  if (priceFromDom !== null) {
    return priceFromDom;
  }

  const metaTitle =
    document.querySelector('meta[property="og:title"]')?.content || '';
  const priceFromMeta = parseCurrencyText(metaTitle);

  if (priceFromMeta !== null) {
    return priceFromMeta;
  }
  return null;
}

function extractSoldQuantity(subtitleText) {
  const normalizedText = normalizeText(subtitleText);
  const match = normalizedText.match(
    /(?:mais\s+de\s+)?([+\d.,]+\s*(?:mil|mi|k)?)(?=\s+vendid)/
  );

  if (!match) {
    return null;
  }

  const rawValue = match[1]
    .replace(/\s+/g, '')
    .replace('+', '')
    .toLowerCase();

  let multiplier = 1;
  let numericText = rawValue;

  if (numericText.endsWith('mil') || numericText.endsWith('k')) {
    multiplier = 1000;
    numericText = numericText.replace(/mil|k/g, '');
  } else if (numericText.endsWith('mi')) {
    multiplier = 1000000;
    numericText = numericText.replace(/mi/g, '');
  }

  const parsedValue = Number(
    numericText.replace(/\./g, '').replace(',', '.')
  );

  if (!Number.isFinite(parsedValue)) {
    return null;
  }

  return Math.round(parsedValue * multiplier);
}

async function validateApiEndpoints(pageData) {
  const itemsUrl = pageData.itemId
    ? `https://api.mercadolibre.com/items?ids=${encodeURIComponent(pageData.itemId)}`
    : null;
  const listingPricesUrl =
    pageData.price !== null && pageData.listingTypeId && pageData.categoryId
      ? buildListingPricesUrl(pageData)
      : null;

  const [itemsResult, listingPricesResult] = await Promise.all([
    validateEndpoint({
      name: 'items',
      url: itemsUrl,
      validator: validateItemsResponse,
    }),
    validateEndpoint({
      name: 'listing_prices',
      url: listingPricesUrl,
      validator: validateListingPricesResponse,
    }),
  ]);

  return {
    items: itemsResult,
    listingPrices: listingPricesResult,
  };
}

function buildListingPricesUrl({ price, listingTypeId, categoryId }) {
  const params = new URLSearchParams({
    price: String(price),
    listing_type_id: listingTypeId,
    category_id: categoryId,
  });

  return `https://api.mercadolibre.com/sites/MLB/listing_prices?${params.toString()}`;
}

async function validateEndpoint({ name, url, validator }) {
  if (!url) {
    return {
      name,
      ok: false,
      skipped: true,
      status: null,
      error: 'Parametros insuficientes para validar o endpoint.',
      source: null,
      data: null,
    };
  }

  const response = await fetchMercadoLivreJson(url);
  const validationError = response.ok ? validator(response.data) : null;

  return {
    name,
    ok: response.ok && !validationError,
    skipped: false,
    status: response.status,
    error: validationError || response.error || null,
    source: response.source,
    data: response.data,
  };
}

async function fetchMercadoLivreJson(url) {
  const pageResponse = await fetchWithPageContext(url);

  if (pageResponse?.handled) {
    return pageResponse;
  }

  const extensionResponse = await fetchWithExtensionContext(url);

  if (extensionResponse?.handled) {
    return extensionResponse;
  }

  return fetchDirect(url);
}

function fetchWithPageContext(url) {
  return new Promise((resolve) => {
    if (
      typeof window === 'undefined' ||
      typeof document === 'undefined' ||
      typeof chrome === 'undefined' ||
      !chrome.runtime?.getURL
    ) {
      resolve(null);
      return;
    }

    const requestId = `aa-fetch-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    let timeoutId = null;

    function onMessage(event) {
      if (event.source !== window) {
        return;
      }

      const message = event.data;

      if (
        message?.type !== 'anuncio-analyzer-fetch-response' ||
        message.requestId !== requestId
      ) {
        return;
      }

      cleanup();
      resolve(message.response || null);
    }

    function cleanup() {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener('message', onMessage);
    }

    ensurePageFetchBridge()
      .then(() => {
        timeoutId = window.setTimeout(() => {
          cleanup();
          resolve(null);
        }, 10000);

        window.addEventListener('message', onMessage);
        window.postMessage(
          {
            type: 'anuncio-analyzer-fetch',
            requestId,
            url,
          },
          '*'
        );
      })
      .catch(() => {
        cleanup();
        resolve(null);
      });
  });
}

function ensurePageFetchBridge() {
  if (pageFetchBridgePromise) {
    return pageFetchBridgePromise;
  }

  pageFetchBridgePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = 'anuncio-analyzer-page-fetch';
    script.src = chrome.runtime.getURL('page-fetch.js');
    script.async = false;

    script.addEventListener('load', () => {
      script.remove();
      resolve();
    });

    script.addEventListener('error', () => {
      script.remove();
      pageFetchBridgePromise = null;
      reject(new Error('Falha ao carregar a ponte de fetch da pagina.'));
    });

    (document.head || document.documentElement).appendChild(script);
  });

  return pageFetchBridgePromise;
}

function fetchWithExtensionContext(url) {
  return new Promise((resolve) => {
    if (
      typeof chrome === 'undefined' ||
      !chrome.runtime ||
      !chrome.runtime.sendMessage
    ) {
      resolve(null);
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: 'ml-api-fetch', url }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }

        resolve(response || null);
      });
    } catch (_error) {
      resolve(null);
    }
  });
}

async function fetchDirect(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
      credentials: 'include',
    });

    return buildJsonResponse(response, 'direct');
  } catch (error) {
    return {
      handled: true,
      ok: false,
      status: 0,
      error: error.message,
      source: 'direct',
      data: null,
    };
  }
}

async function buildJsonResponse(response, source) {
  const responseText = await response.text();
  let data = null;

  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch (_error) {
    data = null;
  }

  return {
    handled: true,
    ok: response.ok,
    status: response.status,
    error: response.ok
      ? null
      : data?.message || responseText || response.statusText,
    source,
    data,
  };
}

function validateItemsResponse(payload) {
  const item = getItemBody(payload);

  if (!item) {
    return 'Payload invalido no endpoint de item.';
  }

  if (!item.category_id || !item.listing_type_id) {
    return 'Campos obrigatorios ausentes no endpoint de item.';
  }

  return null;
}

function validateListingPricesResponse(payload) {
  if (!payload || !Number.isFinite(Number(payload.sale_fee_amount))) {
    return 'Campo sale_fee_amount ausente no endpoint de comissao.';
  }

  return null;
}

function mergeDataSources(pageData, apiResults) {
  const itemBody = getItemBody(apiResults.items.data);
  const saleFeeAmount = Number(apiResults.listingPrices.data?.sale_fee_amount);
  const createdAt = itemBody?.date_created ? new Date(itemBody.date_created) : null;
  const isCreatedAtValid =
    createdAt instanceof Date && !Number.isNaN(createdAt.getTime());

  return {
    ...pageData,
    categoryId: itemBody?.category_id || pageData.categoryId || null,
    listingTypeId: itemBody?.listing_type_id || pageData.listingTypeId || null,
    saleFeeAmount: Number.isFinite(saleFeeAmount) ? saleFeeAmount : null,
    createdAt: isCreatedAtValid ? createdAt : null,
  };
}

function renderAnalyzer(anchor, data, apiResults) {
  const itemsBlocked = isApiAccessBlocked(apiResults.items);
  const listingPricesBlocked = isApiAccessBlocked(apiResults.listingPrices);
  const grossRevenue =
    data.price !== null && data.soldQuantity !== null
      ? data.price * data.soldQuantity
      : null;
  const unitNetRevenue =
    data.price !== null && data.saleFeeAmount !== null
      ? Math.max(data.price - data.saleFeeAmount, 0)
      : null;
  const netRevenue =
    unitNetRevenue !== null && data.soldQuantity !== null
      ? unitNetRevenue * data.soldQuantity
      : null;
  const daysSinceCreation = data.createdAt
    ? Math.max(1, calculateDayDiff(data.createdAt, new Date()))
    : null;
  const dailyRevenue =
    netRevenue !== null && daysSinceCreation !== null
      ? netRevenue / daysSinceCreation
      : null;

  const rows = [
    buildRow(
      'API item',
      formatEndpointStatus(
        apiResults.items,
        Boolean(data.categoryId && data.listingTypeId && !apiResults.items.ok)
      ),
      getEndpointVariant(
        apiResults.items,
        Boolean(data.categoryId && data.listingTypeId && !apiResults.items.ok)
      )
    ),
    buildRow(
      'API comissao',
      formatEndpointStatus(apiResults.listingPrices, false),
      getEndpointVariant(apiResults.listingPrices, false)
    ),
    buildRow(
      'Quantidade vendida',
      data.soldQuantity !== null ? data.soldQuantity.toLocaleString('pt-BR') : NOT_AVAILABLE
    ),
    buildRow('Receita bruta', formatMoney(grossRevenue)),
    buildRow(
      'Receita liquida',
      formatMoney(netRevenue, listingPricesBlocked ? 'Bloqueado pelo ML' : NOT_AVAILABLE)
    ),
    buildRow(
      'Receita por unidade',
      formatMoney(
        unitNetRevenue,
        listingPricesBlocked ? 'Bloqueado pelo ML' : NOT_AVAILABLE
      )
    ),
    buildRow(
      'Receita media diaria',
      formatMoney(
        dailyRevenue,
        listingPricesBlocked ? 'Bloqueado pelo ML' : NOT_AVAILABLE
      )
    ),
    buildRow(
      'Comissao do ML',
      formatMoney(
        data.saleFeeAmount,
        listingPricesBlocked ? 'Bloqueado pelo ML' : NOT_AVAILABLE
      )
    ),
    buildRow(
      'Criado em',
      data.createdAt && daysSinceCreation !== null
        ? `${formatDate(data.createdAt)} - ${daysSinceCreation} dias atras`
        : itemsBlocked
          ? 'Bloqueado pelo ML'
          : NOT_AVAILABLE
    ),
  ];

  document.querySelector('.mlext-container')?.remove();

  const list = document.createElement('ul');
  list.className = 'mlext-container';

  for (const row of rows) {
    list.appendChild(createRowElement(row));
  }

  anchor.insertAdjacentElement('beforebegin', list);
}

function buildRow(label, value, variant = 'default') {
  return { label, value, variant };
}

function createRowElement({ label, value, variant }) {
  const item = document.createElement('li');
  const labelNode = document.createElement('strong');
  const valueNode = document.createElement('span');

  labelNode.textContent = label;
  valueNode.textContent = value;
  valueNode.className = `mlext-badge mlext-badge--${variant}`;

  item.append(labelNode, valueNode);

  return item;
}

function formatEndpointStatus(result, hasFallback) {
  if (result.skipped) {
    return 'Pulado';
  }

  if (result.ok) {
    const source = API_SOURCES[result.source] || result.source || 'desconhecido';
    return `OK (${result.status} via ${source})`;
  }

  if (hasFallback) {
    return 'OK via pagina';
  }

  if (isApiAccessBlocked(result)) {
    return 'Bloqueado pelo ML';
  }

  return `Falhou (${result.status || 'erro'})`;
}

function getEndpointVariant(result, hasFallback) {
  if (result.skipped) {
    return 'warning';
  }

  if (result.ok || hasFallback) {
    return 'success';
  }

  return isApiAccessBlocked(result) ? 'warning' : 'error';
}

function formatMoney(value, unavailableText = NOT_AVAILABLE) {
  if (!Number.isFinite(value)) {
    return unavailableText;
  }

  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function isApiAccessBlocked(result) {
  return result?.status === 401 || result?.status === 403;
}

function formatDate(date) {
  return `${String(date.getDate()).padStart(2, '0')}/${String(
    date.getMonth() + 1
  ).padStart(2, '0')}/${date.getFullYear()}`;
}

function parseMoneyParts(integerPart, centsPart) {
  if (!integerPart) {
    return null;
  }

  const integerValue = integerPart.replace(/[^\d]/g, '');
  const centsValue = (centsPart || '00').replace(/[^\d]/g, '').padEnd(2, '0');

  if (!integerValue) {
    return null;
  }

  return Number(`${integerValue}.${centsValue.slice(0, 2)}`);
}

function parseCurrencyText(text) {
  const match = text.match(/R\$\s*([\d.]+),(\d{2})/);

  if (!match) {
    return null;
  }

  return Number(`${match[1].replace(/\./g, '')}.${match[2]}`);
}

function calculateDayDiff(startDate, endDate) {
  const dayInMs = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs(startDate - endDate) / dayInMs);
}

function getItemBody(payload) {
  return Array.isArray(payload) ? payload[0]?.body || null : null;
}

function extractMatch(text, pattern) {
  return text.match(pattern)?.[1] || null;
}

function extractNumberMatch(text, pattern) {
  const value = Number(text.match(pattern)?.[1]);
  return Number.isFinite(value) ? value : null;
}

function normalizeText(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    const interval = window.setInterval(() => {
      const element = document.querySelector(selector);

      if (element) {
        window.clearInterval(interval);
        resolve(element);
        return;
      }

      if (Date.now() - startedAt >= timeout) {
        window.clearInterval(interval);
        resolve(null);
      }
    }, 250);
  });
}

function logEndpointValidation(apiResults, data) {
  console.table([
    {
      endpoint: 'items',
      ok: apiResults.items.ok,
      status: apiResults.items.status,
      source: apiResults.items.source,
      fallback: Boolean(data.categoryId && data.listingTypeId && !apiResults.items.ok),
      error: apiResults.items.error,
    },
    {
      endpoint: 'listing_prices',
      ok: apiResults.listingPrices.ok,
      status: apiResults.listingPrices.status,
      source: apiResults.listingPrices.source,
      fallback: false,
      error: apiResults.listingPrices.error,
    },
  ]);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
