# AnuncioAnalyzer

Extensao Chrome para analisar anuncios do Mercado Livre diretamente na pagina do produto.

![Preview](./Screenshot.jpg)

## About

O projeto injeta um painel na pagina do Mercado Livre com metricas uteis para leitura rapida do anuncio, como quantidade vendida, receita bruta e status das consultas de API.

Nesta versao, a extensao foi reforcada para funcionar melhor mesmo quando o Mercado Livre bloqueia endpoints publicos com `401` ou `403`. Quando isso acontece, ela tenta usar dados embutidos na propria pagina e mostra no painel quando um campo ficou bloqueado pelo ML.

## O que a extensao faz

- Extrai `item_id`, `category_id`, `listing_type_id`, preco e quantidade vendida da pagina.
- Valida os endpoints usados no fluxo atual.
- Tenta consultar a API pelo contexto da pagina, pelo contexto da extensao e por `fetch` direto.
- Exibe status claro para cada endpoint: `OK`, `OK via pagina`, `Bloqueado pelo ML` ou `Falhou`.
- Calcula receita bruta quando os dados necessarios estao disponiveis.

## Estrutura do projeto

- `index.js`: scraping da pagina, validacao dos endpoints, fallbacks e renderizacao do painel.
- `background.js`: service worker da extensao para tentar buscar dados da API com permissao da extensao.
- `page-fetch.js`: ponte executada no contexto da pagina para tentar chamadas com os cookies da sessao atual.
- `style.css`: estilos do painel injetado.
- `manifest.json`: configuracao Manifest V3 da extensao.

## Fluxo de validacao da API

A extensao trabalha com dois endpoints principais:

- `GET /items?ids={item_id}`
- `GET /sites/MLB/listing_prices?price={price}&listing_type_id={listing_type_id}&category_id={category_id}`

No estado atual do Mercado Livre, esses endpoints podem retornar bloqueio mesmo com os parametros corretos. Por isso a extensao:

1. tenta consultar no contexto real da pagina;
2. tenta consultar pelo service worker da extensao;
3. tenta um `fetch` direto;
4. usa fallback com dados embutidos no HTML quando possivel.

## Limitacoes atuais

- `Comissao do ML`, `Receita liquida`, `Receita por unidade` e `Receita media diaria` dependem do endpoint de `listing_prices`.
- `Criado em` depende do endpoint de `items`.
- Se o Mercado Livre bloquear esses endpoints, a extensao mostra `Bloqueado pelo ML` em vez de quebrar o painel.
- Para recuperar esses campos com confiabilidade total, o proximo passo e integrar autenticacao oficial da API do Mercado Livre.

## Como instalar

1. Baixe ou clone o projeto.
2. Abra `chrome://extensions/`.
3. Ative o `Modo do desenvolvedor`.
4. Clique em `Carregar sem compactacao`.
5. Selecione a pasta do projeto.
6. Recarregue a extensao sempre que alterar os arquivos locais.

## Como testar

1. Abra uma pagina de produto do Mercado Livre Brasil.
2. Verifique se o painel aparece acima do titulo do anuncio.
3. Confira os status `API item` e `API comissao`.
4. Se algum endpoint estiver bloqueado, confirme se a extensao continua exibindo os dados que consegue calcular pela pagina.

## Validacao feita nesta revisao

- Validacao de sintaxe em `index.js`, `background.js` e `page-fetch.js`.
- Validacao do `manifest.json`.
- Testes de parsing para preco e quantidade vendida, incluindo casos como `+1000 vendidos` e `Mais de 1,2 mil vendidos`.
- Confirmacao de que os endpoints publicos podem retornar `401` e `403` mesmo com parametros validos.

## Proximos passos sugeridos

- Integrar OAuth da API do Mercado Livre.
- Opcionalmente ocultar linhas bloqueadas para deixar o painel mais enxuto.
- Adicionar logs de diagnostico opcionais para depurar anuncios especificos.

## Creditos

Projeto original de Kirito Dev.
