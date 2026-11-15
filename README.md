# Plataforma SaaS de Prospecção Local, Geração de Sites com IA e Venda Integrada (`LocalSites AI`)

Plataforma SaaS **multi-tenant** B2B construída em monorepo TypeScript para automação ponta a ponta do ciclo de prospecção comercial de negócios locais: extração georreferenciada de empresas sem presença web própria, higienização e validação de contatos, geração estruturada de sites SPA via LLM com contrato JSON estrito, disparo multicanal cadenciado (WhatsApp e E-mail) com controle anti-spam/LGPD, telemetria comportamental em tempo real, checkout integrado via webhooks idempotentes, portal de autoatendimento para o cliente final e publicação em subdomínio wildcard ou domínio próprio com SSL sob demanda.

> Especificação técnica de referência na raiz do repositório: `Especificação Técnica - Plataforma de Sites com IA e Prospecção.pdf`.

---

## Sumário

1. [Visão Geral da Arquitetura](#visão-geral-da-arquitetura)
2. [Estrutura do Monorepo](#estrutura-do-monorepo)
3. [Fluxo Técnico Ponta a Ponta e Regras de Negócio](#fluxo-técnico-ponta-a-ponta-e-regras-de-negócio)
4. [Processamento Assíncrono e Filas](#processamento-assíncrono-e-filas)
5. [Modelo de Dados](#modelo-de-dados)
6. [Segurança, Multi-Tenancy, RBAC e Governança de Custos](#segurança-multi-tenancy-rbac-e-governança-de-custos)
7. [Mapa de Rotas Web e Endpoints da API](#mapa-de-rotas-web-e-endpoints-da-api)
8. [Templates SPA e Nichos Suportados](#templates-spa-e-nichos-suportados)
9. [Configuração, Execução Local e Produção](#configuração-execução-local-e-produção)
10. [Credenciais de Demonstração (Seed)](#credenciais-de-demonstração-seed)
11. [Testes e Verificação](#testes-e-verificação)

---

## Visão Geral da Arquitetura

O sistema é dividido em três processos principais (`api`, `worker` e `web`) apoiados por cinco bibliotecas internas compartilhadas (`shared`, `db`, `queue`, `integrations`, `templates`) e opera em **modo dual de infraestrutura**:

- **Modo Desenvolvimento / Zero-Config**: roda integralmente sem Docker, Redis, PostgreSQL externo ou chaves de API pagas. O banco utiliza **PGlite** (`@electric-sql/pglite`) em disco (`pglite://./data/pgdata`) ou em memória (`memory://`), as filas operam no driver **in-memory** com suporte a delay/retentativas, a API embarca os workers automaticamente (`EMBED_WORKERS !== 'false'`), o armazenamento de mídia grava em `./data/uploads` e todas as integrações externas possuem fallback **sandbox determinístico**.
- **Modo Produção**: utiliza **PostgreSQL 16 + PostGIS 3.4**, **Redis 7 + BullMQ 5** com processo `apps/worker` dedicado, **MinIO / S3** para objetos WebP, e **Caddy 2** como proxy reverso com **On-Demand TLS** para wildcard de previews e domínios customizados.

```text
                        ┌────────────────────────────────────┐
                        │        Caddy 2 (Reverse Proxy)     │
                        │  On-Demand TLS (/internal/caddy/ask)
                        └─────────────────┬──────────────────┘
                                          │
              ┌───────────────────────────┴───────────────────────────┐
              ▼                                                       ▼
┌───────────────────────────┐                           ┌───────────────────────────┐
│   apps/web (Next.js 15)   │                           │   apps/api (Fastify 5)    │
│ • Console SaaS (/leads..) │◄──── REST + JWT/Cookie ──►│ • Auth, RBAC, Rate Limit  │
│ • Middleware Multi-Tenant │                           │ • Serviços de Domínio     │
│ • /preview/[slug]         │                           │ • Webhooks HMAC/Asaas     │
│ • /_sites/[host]          │                           │ • Endpoints Públicos      │
│ • /checkout /portal       │                           └─────────────┬─────────────┘
└───────────────────────────┘                                         │
                                                                      ▼
┌───────────────────────────┐                           ┌───────────────────────────┐
│  apps/worker (BullMQ)     │◄─────── Redis / Memória ─►│      packages/queue       │
│ • 5 filas especializadas  │                           │      (QueueManager)       │
│ • Cron de ciclo de vida   │                           └───────────────────────────┘
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────────────────────────────────────┐
│   packages/db (Drizzle ORM: PostgreSQL+PostGIS / PGlite)  │
│   packages/integrations (Places, LLM, WhatsApp, SMTP, S3) │
└───────────────────────────────────────────────────────────┘
```

---

## Estrutura do Monorepo

Gerenciado via `pnpm workspaces` (`pnpm-workspace.yaml`) com TypeScript 5.8 (`tsconfig.base.json`):

```text
.
├── apps/
│   ├── api/                        # Servidor HTTP Fastify 5, rotas autenticadas, públicas, webhooks e workers embarcáveis
│   ├── web/                        # Frontend Next.js 15 (App Router), React 19, Tailwind CSS e middleware multi-tenant
│   └── worker/                     # Processo dedicado de consumo das filas e disparo periódico do cron de ciclo de vida
├── packages/
│   ├── shared/                     # Contratos Zod (SiteDocumentSchema), geo-grid, telefone E.164, spintax, sanitização e criptografia
│   ├── db/                         # Schema Drizzle (20 tabelas), cliente dual PG/PGlite, migrations SQL programáticas e seed
│   ├── queue/                      # Abstração QueueManager com driver dual (BullMQ + ioredis ou memória) e coleta de métricas/DLQ
│   ├── integrations/               # Adaptadores de Google Places, OpenAI/Anthropic, Evolution/Meta, SMTP, Stripe/Asaas, Sharp/S3 e DNS/SSL
│   └── templates/                  # Renderizador SPA (SiteRenderer) e rastreador client-side (TelemetryBeacon)
├── infra/
│   ├── caddy/Caddyfile             # Proxy reverso e configuração On-Demand TLS
│   └── postgres/init.sql           # Habilita extensões postgis e pgcrypto no PostgreSQL
├── scripts/
│   └── generate-stock-images.mjs   # Gerador dos assets curados em WebP (>= 800px) por nicho em apps/web/public/stock
├── tests/
│   ├── unit/shared-contracts.test.ts           # Testes unitários de contratos, geo, telefone, spintax e criptografia
│   ├── integration/acceptance-criteria.test.ts # Testes de integração da API cobrindo CA-01 a CA-12 e hardening
│   └── e2e/platform.spec.ts                    # Suíte end-to-end Playwright no navegador (desktop + mobile)
├── docker-compose.yml              # Stack completa: postgres, redis, minio, api, worker, web e caddy
├── .env.example                    # Modelo completo de variáveis de ambiente
├── vitest.config.ts                # Configuração Vitest para unit + integration
└── playwright.config.ts            # Configuração Playwright para E2E
```

---

## Fluxo Técnico Ponta a Ponta e Regras de Negócio

### 1. Captação Georreferenciada, Classificação Web e Higienização (`enrichment.service.ts`)

- **Resolução de Coordenadas e Cache Geográfico (`packages/shared/src/geo.ts`)**:
  - A busca aceita palavra-chave, cidade, estado, bairro, CEP, coordenadas explícitas (`lat`/`lng`) e raio (`1` a `50 km`).
  - `computeGeoGridKey()` quantiza coordenadas em células de grade de aproximadamente `2,2 km` (`Math.round(coord * 50) / 50`), agrupa o raio em múltiplos de `2 km` e normaliza a palavra-chave para gerar uma chave determinística em `geo_search_cache`.
  - Buscas repetidas dentro do TTL (`GEO_CACHE_TTL_DAYS`, padrão `15` dias) reutilizam `raw_results_json` sem acionar o provedor externo nem contabilizar custo de API.
- **Classificação de Presença Web (`packages/shared/src/website-classifier.ts`)**:
  - `classifyWebsite()` analisa a URL retornada e categoriza o estabelecimento em `NO_WEBSITE` (sem URL), `SOCIAL_ONLY` (30+ domínios agregadores/redes sociais como `instagram.com`, `facebook.com`, `linktr.ee`, `wa.me`, `ifood.com.br`, `rappi.com.br`, `anota.ai`, `doctoralia.com.br`, `sites.google.com`, `canva.site`, `olx.com.br`, etc.) ou `OWN_DOMAIN`.
  - O filtro padrão `WITHOUT_OWN_SITE` restringe os resultados a `NO_WEBSITE` e `SOCIAL_ONLY`.
- **Normalização Telefônica e Deduplicação (`packages/shared/src/phone.ts`)**:
  - `normalizeBrazilianPhone()` usa `libphonenumber-js` para formatar no padrão **E.164** (`+55 + DDD + número`) e classificar o tipo de linha em `MOBILE`, `LANDLINE` (inclui `0800`/`0300`/`400x`) ou `UNKNOWN`.
  - Antes de persistir, cada lead é deduplicado no escopo do tenant comparando `placeId`, `phoneE164` e `dedupAddressKey` (endereço + cidade normalizados sem acentos).
  - **Regra de créditos**: créditos do workspace só são debitados para leads efetivamente novos inseridos no banco; leads deduplicados não consomem créditos.
- **Validação Assíncrona de WhatsApp (`packages/integrations/src/whatsapp-provider.ts`)**:
  - Novos leads disparam um job na fila `lead-enrichment`. Linhas `LANDLINE` e `UNKNOWN` são marcadas imediatamente com `whatsappValid = false`; linhas `MOBILE` consultam a Evolution API (`/chat/whatsappNumbers/...`) quando configurada ou utilizam o validador determinístico em sandbox.

### 2. Geração de Sites SPA Schema-Driven com IA e Curadoria de Mídia (`site-generation.service.ts`)

- **Contrato JSON Estrito (`packages/shared/src/site-schema.ts`)**:
  - O conteúdo do site não é gerado como HTML livre. O LLM (OpenAI ou Anthropic, com fallback determinístico estruturado em `llm-provider.ts`) preenche o schema `SiteDocumentSchema` (versão `1.0`), validado via **Zod** com limites de caracteres por campo e sanitização recursiva contra XSS (`sanitizeAndValidateSiteDocument()`).
  - Seções do documento: `theme`, `business` (dados, coordenadas, nota Google e horários), `hero`, `about`, `services` (3–6 itens), `differentials` (3–4 itens), `testimonials` (avaliações reais importadas ou fallback), `gallery` (1–6 itens), `location` (link Google Maps), `faq` (3–6 perguntas), `seo` e `footer`.
- **Validação de Resolução e Pipeline de Imagens (`packages/integrations/src/media-provider.ts`)**:
  - Imagens recebidas do Google Places são verificadas com `sharp`; arquivos com largura `< 800px` ou URLs inválidas são descartados.
  - Imagens aprovadas são redimensionadas (`max width 1280px`) e convertidas para **WebP** (`quality: 82`), sendo gravadas no driver configurado (`local` em `./data/uploads` servida em `/api/media/*`, ou `s3` para MinIO/S3).
  - Quando não há fotos válidas `>= 800px`, `resolveSiteImages()` preenche a galeria e o hero com o acervo temático do nicho (`apps/web/public/stock/<nicho>/1..3.webp`, 18 imagens no total).
- **Editor Rápido Pré-Envio (`apps/web/src/app/sites/[id]/editor/page.tsx`)**:
  - Permite editar textos de todas as seções, trocar `templateSlug`, `primaryColor` e `fontPairing` antes ou depois da abordagem.
  - Cada salvamento executa `sanitizeAndValidateSiteDocument()`, incrementa `cacheVersion` e chama `/api/revalidate` no Next.js para invalidar imediatamente o cache da página pública.
  - Há suporte a geração em lote (`POST /api/sites/generate-batch`) com enfileiramento na fila `site-generation`.

### 3. Renderização Multi-Tenant, SEO Dinâmico e Telemetria (`SiteRenderer.tsx`, `middleware.ts`)

- **Roteamento Multi-Tenant (`apps/web/src/middleware.ts`)**:
  - Requisições para `*.preview.<PREVIEW_BASE_DOMAIN>` ou domínios próprios são reescritas internamente para `/_sites/[host]`, que consulta `GET /api/public/sites/by-host?host=...`.
  - Também há acesso direto por slug em `/preview/[slug]` (`GET /api/public/sites/by-slug/:slug`).
- **Estados Visuais e SEO (`packages/templates/src/SiteRenderer.tsx`)**:
  - `PREVIEW`: exibe barra discreta no topo identificando demonstração temporária (com botão para o checkout quando houver oferta ativa) e injeta meta tag `<meta name="robots" content="noindex, nofollow" />`.
  - `PUBLISHED`: remove a tarja de prévia, libera indexação (`index, follow`) e aplica `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.
  - `SUSPENDED`: exibe tela informativa preservando os dados para reativação.
  - `ARCHIVED`: exibe aviso de prévia expirada.
  - Injeta dados estruturados **JSON-LD** (`@type: "LocalBusiness"`) com endereço, `GeoCoordinates` e `AggregateRating`.
- **Telemetria em Tempo Real (`TelemetryBeacon.tsx`, `telemetry.service.ts`)**:
  - Dispara eventos para `POST /api/public/telemetry`: `PAGE_VIEW` (automático na abertura), `WHATSAPP_CLICK`, `CTA_CLICK` e `PHONE_CLICK`.
  - Classifica `deviceType` (`mobile`, `tablet`, `desktop`) pelo `User-Agent`, anonimiza o IP com hash SHA-256 truncado (`ipHash`), atualiza contadores no registro do site, avança automaticamente o lead no funil para `PREVIEW_VISUALIZADO` (se estiver em estágio anterior) e gera registro em `notifications` para o operador do workspace.

### 4. Mensageria Multicanal, Spintax e Conformidade LGPD (`messaging.service.ts`)

- **Conexões (`messaging_connections`)**:
  - Suporta `WHATSAPP_EVOLUTION` (fluxo de QR Code em `/api/connections/:id/pair`), `WHATSAPP_META` (Meta Cloud API) e `EMAIL_SMTP` (Nodemailer + verificação DNS de registros `SPF` e `DKIM` via `node:dns/promises` em `/api/connections/:id/verify-dns`).
- **Motor de Templates e Spintax (`packages/shared/src/spintax.ts`)**:
  - Substitui variáveis dinâmicas (`{{nome_empresa}}`, `{{categoria}}`, `{{bairro}}`, `{{cidade}}`, `{{link_preview}}`, `{{link_optout}}`, `{{nota_google}}`, `{{telefone}}`) antes de resolver blocos de variação Spintax (`{Olá|Oi|Bom dia}`).
  - Rejeita o enfileiramento caso restem variáveis não resolvidas.
- **Regras Anti-Bloqueio e LGPD**:
  - **Cadência e Jitter**: atraso cumulativo aleatório entre `minDelayMs` e `maxDelayMs` ao enfileirar campanhas.
  - **Limite Diário**: contador `sentToday` por conexão com reset automático por data (`lastResetDate`).
  - **Janela Operacional Comercial**: `checkOperationalWindow()` restringe disparos de WhatsApp (quando `respectBusinessHours` / `BUSINESS_HOURS_ENFORCE` ativos) para **segunda a sexta-feira, das 08:30 às 18:00** no fuso horário da conexão (`America/Sao_Paulo`), reagendando para o próximo horário útil caso contrário.
  - **Quarentena**: bloqueia novos disparos (`BLOCKED_QUARANTINE`) se `lastContactedAt` for mais recente que `quarantineDays` (padrão `30` dias).
  - **Opt-Out Permanente**: link único `/opt-out/[token]` e detecção automática de palavras-chave (`sair`, `parar`, `stop`, `remover`, `descadastrar`, `não tenho interesse`, `cancelar`, `bloquear`) no webhook `POST /api/webhooks/messaging/:provider`. Marca `optedOut = true`, move o lead para `DESCARTADO` e impede envios futuros no workspace (`BLOCKED_OPT_OUT`).

### 5. Funil Comercial, Checkout, Webhooks, Portal do Cliente e Domínio Próprio

- **Máquina de Estados do Funil (`leads.funnelStage`)**:
  ```text
  LEAD_CAPTADO -> SITE_GERADO -> MENSAGEM_ENVIADA -> PREVIEW_VISUALIZADO -> EM_NEGOCIACAO -> VENDIDO
                                                                                         └-> DESCARTADO
  ```
- **Checkout e Webhooks Idempotentes (`billing-domain.service.ts`)**:
  - Ofertas em `checkout_offers` suportam modelos `ONE_TIME`, `SUBSCRIPTION` e `HYBRID` via **Stripe**, **Asaas** ou **Sandbox**.
  - `POST /api/webhooks/payments/:gateway` preserva o `rawBody` no Fastify, valida assinatura **HMAC-SHA256** (`Stripe-Signature` ou `X-Webhook-Signature`) ou token Asaas (`Asaas-Access-Token`), e garante idempotência via chave única `(gateway, event_id)` na tabela `processed_webhook_events`.
  - Em confirmação de pagamento (`payment.succeeded`, `checkout.session.completed`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `subscription.reactivated`): atualiza a oferta e transação para `PAID`, promove o site para `PUBLISHED`, gera `clientPortalToken`, move o lead para `VENDIDO`, invalida cache e cria notificação.
  - Em falha/atraso (`invoice.payment_failed`, `PAYMENT_OVERDUE`, `subscription.past_due`): registra `PAST_DUE` com prazo `graceUntil` configurável (`gracePeriodDays`, padrão `5` dias).
- **Portal do Cliente Final (`/portal/[token]`)**:
  - Acesso via link mágico sem necessidade de senha adicional. Permite ao comprador editar telefone, WhatsApp, horários de funcionamento, enviar nova foto de capa/galeria (convertida para WebP), visualizar faturas e instruções de DNS, abrir solicitações de ajuste (`client_requests`) que notificam a agência no editor, e cancelar ou reativar a assinatura.
- **Domínios Customizados e SSL (`domain-ssl-provider.ts`, `infra/caddy/Caddyfile`)**:
  - Valida apontamento DNS (`CNAME` para `PLATFORM_CNAME_TARGET` ou registro `A` para `PLATFORM_PUBLIC_IP`), registra hostname na Cloudflare for SaaS (se configurado) ou habilita emissão automática de certificado HTTPS no **Caddy** via validação em `GET /internal/caddy/ask`.

---

## Processamento Assíncrono e Filas

Implementado em `packages/queue/src/queue-manager.ts` com 5 filas especializadas registradas em `apps/api/src/workers/register-workers.ts` e executáveis tanto embarcadas na API quanto no processo isolado `apps/worker/src/worker.ts`:

| Fila | Concorrência | Responsabilidade |
|---|---|---|
| `lead-enrichment` | `4` | Validação de WhatsApp em lote ou unitária após captação de leads |
| `site-generation` | `3` | Geração assíncrona individual ou em lote (`generate-batch`) de sites via LLM + mídia |
| `messaging-dispatch` | `2` | Execução cadenciada dos envios de WhatsApp/E-mail com revalidação de opt-out, quarentena, cota e janela |
| `domain-ssl` | `2` | Verificação de DNS e provisionamento de certificado SSL para domínios customizados |
| `lifecycle-cron` | `1` | Varreduras periódicas (a cada 1h no `worker.ts` ou sob demanda no Admin): `expire-previews` (arquiva previews vencidos com `0` visualizações) e `suspend-delinquent` (suspende sites `PAST_DUE` após expirar `graceUntil`) |

O `QueueManager` expõe snapshot de métricas (`waiting`, `active`, `delayed`, `completed`, `failed`, `dlqCount`, `failedJobs`) e reprocessamento de jobs falhos (`retryFailed`) consumidos pelo console `/admin`.

---

## Modelo de Dados

Definido em `packages/db/src/schema.ts` com **20 tabelas** em Drizzle ORM (compatível com PostgreSQL 16 e PGlite, com migrations automáticas em `packages/db/src/migrate.ts`):

- **Plataforma, Tenants e Governança**:
  - `plans`: definição dos planos SaaS (`monthlyCredits`, `maxSearchesPerMonth`, `maxSitesPerMonth`, `maxMessagesPerDay`, `maxActivePreviews`, `monthlyBudgetCents`, `allowByok`, `allowCustomDomain`).
  - `tenants`: workspaces de agências, saldo de créditos (`creditsBalance`) e políticas (`geoCacheTtlDays`, `previewExpirationDays`, `gracePeriodDays`, `quarantineDays`).
  - `users`: usuários com `role` (`GLOBAL_ADMIN`, `TENANT_OPERATOR`, `END_CLIENT`) e `passwordHash`.
  - `tenant_secrets`: chaves BYOK cifradas por workspace e provedor.
  - `usage_telemetry`: consumo granular por evento (`MAPS_SEARCH`, `LLM_GENERATION`, `WHATSAPP_DISPATCH`, `EMAIL_DISPATCH`), contagem de `promptTokens`/`completionTokens`, `estimatedCostCents` e flag `usedByok`.
  - `audit_logs`: trilha de auditoria de cadastro, buscas, gerações, edições rápidas, campanhas, opt-outs, checkouts e ativações pós-pagamento.
  - `notifications`: alertas em tempo real por tenant (abertura de preview, clique em WhatsApp, pagamento confirmado, domínio ativo, solicitação de cliente).
- **Prospecção e CRM**:
  - `geo_search_cache`: cache compartilhado por `gridKey` com `hitCount` e `expiresAt`.
  - `leads`: dados completos do negócio, classificação web, telefone E.164, status WhatsApp, avaliações/horários/fotos em JSONB, estágio do funil, flags de opt-out (`optedOut`, `optOutToken`) e chaves de deduplicação.
  - `lead_notes`: anotações internas por lead.
- **Sites e Telemetria**:
  - `site_templates`: catálogo global dos templates SPA, paleta padrão e tipografia.
  - `sites`: `contentJson` (`SiteDocument`), `status` (`DRAFT`, `PREVIEW`, `PUBLISHED`, `SUSPENDED`, `ARCHIVED`), `subdomainSlug`, `customDomain`, `clientPortalToken`, `cacheVersion` e contadores de visualização/cliques.
  - `site_telemetry_events`: log de eventos (`PAGE_VIEW`, `WHATSAPP_CLICK`, `CTA_CLICK`, `PHONE_CLICK`) com `deviceType` e `ipHash`.
  - `client_requests`: solicitações enviadas pelo cliente final via portal (`OPEN` / `DONE`).
- **Mensageria**:
  - `messaging_connections`: instâncias WhatsApp/SMTP, status de pareamento, flags `spfVerified`/`dkimVerified`, `dailyLimit`, `sentToday` e configuração cifrada.
  - `message_templates`: templates reutilizáveis com lista de variáveis extraídas.
  - `campaigns`: campanhas em lote e contadores (`totalTargets`, `sentCount`, `blockedCount`, `failedCount`).
  - `campaign_dispatches`: registro individual por destinatário com texto renderizado, `status` (`QUEUED`, `SCHEDULED`, `SENT`, `DELIVERED`, `READ`, `REPLIED`, `FAILED`, `BLOCKED_OPT_OUT`, `BLOCKED_QUARANTINE`, `BLOCKED_NO_WHATSAPP`, `BLOCKED_WINDOW`) e motivo de bloqueio.
- **Cobrança e Domínios**:
  - `checkout_offers`: ofertas geradas por site com token único e valores de setup/mensalidade.
  - `payment_transactions`: transações vinculadas à oferta, status (`PENDING`, `PAID`, `PAST_DUE`, `SUSPENDED`, `CANCELED`) e `graceUntil`.
  - `processed_webhook_events`: controle de idempotência de webhooks (`gateway` + `eventId` únicos) e hash SHA-256 do payload.
  - `custom_domains`: registro de domínio próprio por site, targets DNS esperados e status de DNS/SSL.

---

## Segurança, Multi-Tenancy, RBAC e Governança de Custos

- **Isolamento Multi-Tenant e RBAC (`apps/api/src/auth.ts`)**:
  - Tokens JWT assinados (`@fastify/jwt`) trafegados via header `Authorization: Bearer` ou cookie `auth_token` (`httpOnly`, `sameSite: 'lax'`).
  - Guards por papel (`requireAuth`, `requireRole('GLOBAL_ADMIN')`, `requireTenantOperator()`). Todas as consultas operacionais filtram por `tenantId` do token, retornando HTTP `404` quando um recurso pertence a outro workspace.
- **Criptografia e Senhas (`packages/shared/src/crypto.ts`)**:
  - Senhas armazenadas com `crypto.scryptSync` (salt aleatório de 16 bytes, chave derivada de 64 bytes) e validadas com `crypto.timingSafeEqual`.
  - Chaves BYOK (`google_places`, `openai`, `anthropic`, `stripe`, `asaas`, `evolution_api`, `meta_cloud`, `smtp`) e credenciais de conexões cifradas com **AES-256-GCM** (IV aleatório de 12 bytes + `authTag` validado usando `ENCRYPTION_MASTER_KEY`).
- **Hardening de Runtime (`apps/api/src/config.ts`, `apps/api/src/rate-limit.ts`)**:
  - Fail-fast na inicialização em `NODE_ENV=production` caso `JWT_SECRET` ou `ENCRYPTION_MASTER_KEY` estejam com valores padrão/fracos (a menos que `ALLOW_DEV_SECRETS=true`).
  - Rate limiting em janela deslizante (`429 Too Many Requests` com `Retry-After`) aplicado em `POST /api/auth/login|register` (40 req/min), `POST /api/public/checkout/*` (25 req/min) e `POST /api/public/telemetry` (120 req/min).
  - `@fastify/helmet` configurado e sanitização de texto plano em entradas de usuário e schema dos sites.
- **Governança de Cotas e BYOK (`apps/api/src/services/quota.service.ts`)**:
  - Antes de buscas Maps, gerações LLM ou disparos, valida status do tenant, saldo de créditos, limites do plano e teto de orçamento mensal (`monthlyBudgetCents`), retornando HTTP `402` (`QuotaExceededError`) ao exceder.
  - Quando o workspace possui chave BYOK ativa para o serviço (e o plano permite `allowByok`), a operação ignora a cobrança de créditos/teto da plataforma mantendo a telemetria registrada com `usedByok = true`.

---

## Mapa de Rotas Web e Endpoints da API

### Páginas Frontend (`apps/web/src/app`)

| Escopo | Rotas | Descrição |
|---|---|---|
| Entrada & Auth | `/`, `/login`, `/register` | Landing page do fluxo, login (com botões rápidos de demo em dev) e criação de novo workspace |
| Console do Operador | `/dashboard`, `/leads`, `/pipeline` | Métricas do workspace, captação geo com seleção em lote e exportação CSV, funil Kanban de 7 estágios + visão em lista |
| Sites & Editor | `/sites`, `/sites/[id]/editor` | Listagem com filtro por status e editor rápido completo com preview ao vivo e resolução de solicitações |
| Mensageria | `/campaigns`, `/connections` | Pareamento QR WhatsApp, verificação SPF/DKIM, templates Spintax, preview de variáveis e campanhas cadenciadas |
| Financeiro & BYOK | `/billing`, `/settings` | Gestão de ofertas/transações/domínios, cofre criptografado de chaves BYOK e painel de consumo/orçamento |
| Admin Global | `/admin` | Exclusivo `GLOBAL_ADMIN`: overview global, edição de planos, gestão de tenants, templates, filas/retry e `audit_logs` |
| Públicas & Multi-Tenant | `/preview/[slug]`, `/_sites/[host]`, `/checkout/[token]`, `/portal/[token]`, `/opt-out/[token]` | Renderização dos sites gerados (por slug ou hostname), checkout público, portal do cliente e descadastro LGPD |

### Grupos de Endpoints (`apps/api/src/routes`)

- **Auth**: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- **Leads**: `POST /api/leads/search`, `GET /api/leads`, `GET /api/leads/:id`, `PATCH /api/leads/:id`, `POST /api/leads/:id/notes`, `POST /api/leads/:id/validate-whatsapp`, `POST /api/leads/:id/opt-out`
- **Sites & Domínios**: `GET /api/templates`, `POST /api/sites/generate`, `POST /api/sites/generate-batch`, `GET /api/sites`, `GET /api/sites/:id`, `PATCH /api/sites/:id`, `PATCH /api/sites/:id/requests/:requestId`, `GET /api/sites/:id/telemetry`, `POST /api/sites/:id/media`, `POST /api/sites/:id/domain`, `POST /api/sites/:id/domain/verify`
- **Conexões & Campanhas**: `GET/POST/DELETE /api/connections`, `POST /api/connections/:id/pair`, `POST /api/connections/:id/verify-dns`, `GET/POST /api/message-templates`, `POST /api/message-templates/preview`, `GET/POST /api/campaigns`, `GET /api/campaigns/:id`, `POST /api/campaigns/send-single`
- **Cobrança, BYOK & Notificações**: `GET/POST /api/checkout/offers`, `GET/PUT/DELETE /api/settings/secrets`, `GET /api/settings/usage`, `GET /api/notifications`, `POST /api/notifications/:id/read`
- **Admin Global**: `GET /api/admin/overview`, `GET/PATCH /api/admin/plans`, `GET/PATCH /api/admin/tenants`, `GET/PATCH /api/admin/templates`, `GET /api/admin/queues`, `POST /api/admin/queues/:name/retry-failed`, `GET /api/admin/audit-logs`, `POST /api/admin/lifecycle/run`
- **Públicas, Internas & Webhooks**: `GET /health`, `GET /internal/caddy/ask`, `GET /api/media/*`, `GET /api/public/sites/by-slug/:slug`, `GET /api/public/sites/by-host`, `POST /api/public/telemetry`, `GET /api/public/checkout/:token`, `POST /api/public/checkout/:token/pay`, `POST /api/webhooks/payments/:gateway`, `POST /api/webhooks/messaging/:provider`, `GET/POST /api/public/opt-out/:token`, `GET /api/portal/:token`, `PATCH /api/portal/:token/site`, `POST /api/portal/:token/media`, `POST /api/portal/:token/requests`, `POST /api/portal/:token/subscription`

---

## Templates SPA e Nichos Suportados

Todos os templates compartilham o motor `SiteRenderer` com 5 opções de tipografia (`inter-plus-jakarta`, `playfair-inter`, `space-grotesk-inter`, `poppins-dm-sans`, `merriweather-source`) e acervo próprio de 3 imagens WebP em `apps/web/public/stock/<nicho>/`:

| Template Slug | Nome | Nicho (`NICHES`) | Cor Primária Padrão | Tipografia Padrão |
|---|---|---|---|---|
| `clinical-clean` | Clínica Serene | `clinicas` (Clínicas e Saúde) | `#0F766E` | `inter-plus-jakarta` |
| `automotive-bold` | AutoForce Pro | `oficinas` (Oficinas e Automotivo) | `#D97706` | `space-grotesk-inter` |
| `gastronomy-warm` | Sabor Editorial | `restaurantes` (Restaurantes e Gastronomia) | `#B91C1C` | `playfair-inter` |
| `corporate-trust` | Autoridade Executiva | `escritorios` (Escritórios e Consultoria) | `#1E3A8A` | `merriweather-source` |
| `beauty-editorial` | Atelier Lumière | `estetica` (Estética, Beleza e Bem-Estar) | `#9D174D` | `playfair-inter` |
| `local-express` | Serviço Local Direto | `servicos_locais` (Serviços Locais) | `#2563EB` | `poppins-dm-sans` |

---

## Configuração, Execução Local e Produção

### Pré-requisitos

- **Node.js** `>= 20.0.0`
- **pnpm** `>= 9.0.0`
- *(Opcional)* **Docker** e **Docker Compose** para rodar com PostgreSQL/PostGIS, Redis, MinIO e Caddy

### Modo Desenvolvimento (Zero-Config)

1. Instale as dependências e crie o arquivo de ambiente:
   ```bash
   pnpm install
   cp .env.example .env
   ```
2. Compile os pacotes do monorepo, aplique o schema e execute o seed:
   ```bash
   pnpm build
   pnpm db:migrate
   pnpm db:seed
   ```
3. Inicie API (`:4000`), Worker e Frontend (`:3000`) em paralelo:
   ```bash
   pnpm dev
   ```
   - Console Web: `http://localhost:3000`
   - API Fastify: `http://localhost:4000` (health check em `GET /health`)

### Modo Produção (Docker Compose)

Sobe 7 serviços (`postgres`, `redis`, `minio`, `api`, `worker`, `web`, `caddy`) definidos em `docker-compose.yml`:

```bash
cp .env.example .env
# Em produção, defina valores fortes para JWT_SECRET e ENCRYPTION_MASTER_KEY (64 chars hex)
docker compose up --build -d
```

### Variáveis de Ambiente Principais (`.env.example`)

| Variável | Função | Padrão Dev |
|---|---|---|
| `DATABASE_URL` | String PostgreSQL/PostGIS ou `pglite://...` / `memory://` | `pglite://./data/pgdata` |
| `REDIS_URL` / `QUEUE_DRIVER` | Conexão Redis para BullMQ (`auto`, `bullmq`, `memory`) | `""` / `auto` |
| `JWT_SECRET` / `ENCRYPTION_MASTER_KEY` | Assinatura JWT e chave mestra AES-256-GCM (64 hex chars) | Chaves dev (bloqueadas em `production`) |
| `STORAGE_DRIVER` / `S3_*` | Armazenamento de imagens (`local` ou `s3`) | `local` (`./data/uploads`) |
| `PREVIEW_BASE_DOMAIN` / `PLATFORM_CNAME_TARGET` | Domínio base dos previews wildcard e alvo DNS para domínios próprios | `preview.localhost` / `sites.plataforma.com.br` |
| `GOOGLE_PLACES_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Chaves globais opcionais (fallback automático para sandbox) | `""` |
| `EVOLUTION_API_*`, `META_CLOUD_*`, `SMTP_*` | Provedores de WhatsApp e E-mail (fallback para sandbox) | `""` |
| `STRIPE_*`, `ASAAS_*`, `SANDBOX_WEBHOOK_SECRET` | Gateways de pagamento e segredos de verificação de webhook | `SANDBOX_WEBHOOK_SECRET` |
| `BUSINESS_HOURS_ENFORCE`, `GEO_CACHE_TTL_DAYS`, `PREVIEW_EXPIRATION_DAYS`, `QUARANTINE_DAYS` | Regras operacionais de janela, cache, expiração e quarentena | `true`, `15`, `14`, `30` |

---

## Credenciais de Demonstração (Seed)

O comando `pnpm db:seed` (também executado na inicialização padrão da API) cria 3 planos (`starter`, `pro`, `agency`), os 6 templates SPA, dois workspaces isolados e um administrador global:

| Papel (`role`) | E-mail | Senha | Workspace / Plano |
|---|---|---|---|
| `GLOBAL_ADMIN` | `admin@plataforma.com.br` | `Admin@123456` | Plataforma Global |
| `TENANT_OPERATOR` | `operador@alfa.com.br` | `Operador@123` | Agência Alfa Digital (`Agência Pro`, 1500 créditos) |
| `TENANT_OPERATOR` | `operador@beta.com.br` | `Operador@123` | Agência Beta Growth (`Starter`, 250 créditos) |

---

## Testes e Verificação

```bash
# 1. Verificação estática de tipos em todos os 8 pacotes do monorepo
pnpm typecheck

# 2. Testes unitários (contratos, geo, E.164, spintax, AES-256-GCM/HMAC)
#    e de integração da API (critérios de aceite CA-01 a CA-12 + hardening)
pnpm test

# 3. Testes end-to-end no navegador com Playwright (mobile 375px + desktop 1440px)
pnpm test:e2e
```
