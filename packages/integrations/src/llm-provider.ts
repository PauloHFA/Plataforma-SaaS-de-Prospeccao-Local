import {
  clampString,
  DEFAULT_TEMPLATE_BY_NICHE,
  NICHE_LABELS,
  sanitizeAndValidateSiteDocument,
  type FontPairing,
  type Niche,
  type SiteDocument,
  type TemplateSlug,
} from '@plataforma/shared';

export interface SiteGenerationLeadInput {
  businessName: string;
  category: string;
  niche: Niche;
  phoneRaw: string | null;
  phoneE164: string | null;
  whatsappValid: boolean | null;
  email: string | null;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  rating: number;
  reviewCount: number;
  reviews: Array<{ author: string; rating: number; text: string; relativeTime: string }>;
  openingHours: Array<{ day: string; hours: string }>;
}

export interface GenerateSiteContentParams {
  lead: SiteGenerationLeadInput;
  templateSlug?: TemplateSlug;
  palette: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    backgroundColor: string;
    surfaceColor: string;
    textColor: string;
  };
  fontPairing: FontPairing;
  heroImageUrl: string;
  gallery: Array<{ url: string; alt: string; isStockFallback: boolean }>;
  openaiApiKey?: string;
  anthropicApiKey?: string;
}

export interface GenerateSiteContentResult {
  document: SiteDocument;
  provider: 'openai' | 'anthropic' | 'deterministic';
  promptTokens: number;
  completionTokens: number;
  estimatedCostCents: number;
}

const NICHE_COPY_BLUEPRINTS: Record<
  Niche,
  {
    badge: string;
    headlineFn: (name: string, neighborhood: string, city: string) => string;
    subheadlineFn: (name: string, neighborhood: string, city: string) => string;
    aboutFn: (name: string, neighborhood: string, city: string, rating: number, count: number) => string;
    highlights: string[];
    ctaPrimary: string;
    ctaSecondary: string;
    services: Array<{ title: string; description: string; icon: string }>;
    differentials: Array<{ title: string; description: string; metric: string }>;
    faq: Array<{ question: string; answer: string }>;
  }
> = {
  clinicas: {
    badge: 'Atendimento Humanizado',
    headlineFn: (name, neighborhood, city) =>
      `${name}: Cuidado Completo em Saúde em ${neighborhood}, ${city}`,
    subheadlineFn: (_name, neighborhood, city) =>
      `Consultas, diagnósticos precisos e acompanhamento personalizado com especialistas experientes no coração de ${neighborhood}, ${city}.`,
    aboutFn: (name, neighborhood, city, rating, count) =>
      `A ${name} reúne tecnologia clínica atualizada e atendimento acolhedor para cuidar da sua saúde com segurança em ${neighborhood}, ${city}. Com avaliação média de ${rating.toFixed(1)} estrelas em ${count} avaliações reais, nossa equipe prioriza pontualidade, escuta ativa e planos terapêuticos transparentes.`,
    highlights: [
      'Corpo clínico experiente e atualizado',
      'Agendamento ágil pelo WhatsApp',
      'Estrutura moderna e acessível',
    ],
    ctaPrimary: 'Agendar Consulta',
    ctaSecondary: 'Conhecer Serviços',
    services: [
      {
        title: 'Avaliação Clínica Completa',
        description: 'Consulta detalhada com escuta individualizada, histórico médico e plano de cuidado claro.',
        icon: 'Stethoscope',
      },
      {
        title: 'Prevenção e Acompanhamento',
        description: 'Protocolos preventivos periódicos para manter sua saúde e qualidade de vida em dia.',
        icon: 'HeartPulse',
      },
      {
        title: 'Procedimentos Especializados',
        description: 'Atendimento técnico com equipamentos modernos e protocolos de biossegurança rigorosos.',
        icon: 'ShieldCheck',
      },
      {
        title: 'Retorno e Suporte Contínuo',
        description: 'Canal direto para orientações pós-atendimento e acompanhamento da sua evolução.',
        icon: 'CalendarCheck',
      },
    ],
    differentials: [
      {
        title: 'Pontualidade no Atendimento',
        description: 'Respeito ao seu tempo com horários organizados e confirmação rápida.',
        metric: 'Zero espera longa',
      },
      {
        title: 'Transparência Total',
        description: 'Explicação clara de cada etapa, prazos e valores antes de qualquer procedimento.',
        metric: '100% claro',
      },
      {
        title: 'Localização Facilitada',
        description: 'Fácil acesso para pacientes de toda a região com atendimento acolhedor.',
        metric: 'Fácil acesso',
      },
    ],
    faq: [
      {
        question: 'Como faço para agendar uma consulta ou avaliação?',
        answer: 'Você pode clicar diretamente no botão de WhatsApp desta página e escolher o melhor dia e horário com nossa recepção.',
      },
      {
        question: 'Quais são os horários de funcionamento da clínica?',
        answer: 'Atendemos em horário comercial estendido de segunda a sábado. Confira a tabela completa na seção de localização abaixo.',
      },
      {
        question: 'Vocês esclarecem dúvidas sobre preparo e valores antes da visita?',
        answer: 'Sim! Nossa equipe informa todos os detalhes previamente pelo WhatsApp ou telefone antes da confirmação do horário.',
      },
    ],
  },
  oficinas: {
    badge: 'Diagnóstico Preciso',
    headlineFn: (name, neighborhood, city) =>
      `${name}: Mecânica de Confiança e Revisão Completa em ${neighborhood}`,
    subheadlineFn: (_name, neighborhood, city) =>
      `Manutenção preventiva e corretiva com scanner automotivo, orçamento transparente e garantia em ${neighborhood}, ${city}.`,
    aboutFn: (name, neighborhood, city, rating, count) =>
      `Na ${name}, seu veículo recebe diagnóstico técnico preciso antes de qualquer troca de peça. Referência em ${neighborhood}, ${city} com nota ${rating.toFixed(1)} (${count} avaliações), trabalhamos com transparência, prazo cumprido e peças de procedência garantida.`,
    highlights: [
      'Orçamento detalhado antes da execução',
      'Diagnóstico computadorizado avançado',
      'Garantia nos serviços e peças',
    ],
    ctaPrimary: 'Solicitar Orçamento',
    ctaSecondary: 'Ver Serviços',
    services: [
      {
        title: 'Revisão Preventiva Completa',
        description: 'Checagem de freios, suspensão, fluidos, filtros e itens de segurança para rodar tranquilo.',
        icon: 'Wrench',
      },
      {
        title: 'Injeção Eletrônica e Scanner',
        description: 'Leitura precisa de falhas eletrônicas e otimização de consumo e desempenho do motor.',
        icon: 'Gauge',
      },
      {
        title: 'Freios, Embreagem e Suspensão',
        description: 'Substituição de componentes desgastados com alinhamento técnico e testes de rodagem.',
        icon: 'Car',
      },
      {
        title: 'Troca de Óleo e Filtros',
        description: 'Lubrificantes homologados pela montadora para preservar a vida útil do motor.',
        icon: 'ShieldCheck',
      },
    ],
    differentials: [
      {
        title: 'Orçamento Sem Surpresas',
        description: 'Você aprova cada item pelo WhatsApp com fotos e explicação técnica antes do reparo.',
        metric: 'Aprovação prévia',
      },
      {
        title: 'Entrega no Prazo',
        description: 'Planejamento rigoroso de box para devolver seu veículo no horário combinado.',
        metric: 'Agilidade real',
      },
      {
        title: 'Peças Homologadas',
        description: 'Componentes originais e de primeira linha com garantia de serviço.',
        metric: 'Garantia inclusa',
      },
    ],
    faq: [
      {
        question: 'Preciso agendar horário para fazer um diagnóstico?',
        answer: 'Recomendamos enviar uma mensagem pelo WhatsApp para reservarmos um box imediato, reduzindo seu tempo de espera.',
      },
      {
        question: 'O orçamento é passado antes de mexer no carro?',
        answer: 'Sempre. Só iniciamos qualquer manutenção após sua aprovação expressa do orçamento detalhado.',
      },
      {
        question: 'Os serviços realizados têm garantia?',
        answer: 'Sim, todos os serviços e peças aplicadas contam com garantia conforme especificação técnica.',
      },
    ],
  },
  restaurantes: {
    badge: 'Sabor Artesanal',
    headlineFn: (name, neighborhood, city) =>
      `${name}: Experiência Gastronômica Autêntica em ${neighborhood}`,
    subheadlineFn: (_name, neighborhood, city) =>
      `Ingredientes selecionados, receitas preparadas na hora e ambiente acolhedor para seus melhores momentos em ${neighborhood}, ${city}.`,
    aboutFn: (name, neighborhood, city, rating, count) =>
      `O ${name} une ingredientes frescos, preparo artesanal e hospitalidade em cada prato servido em ${neighborhood}, ${city}. Avaliado com ${rating.toFixed(1)} estrelas por ${count} clientes, é o ponto de encontro ideal para almoços, jantares especiais e pedidos rápidos.`,
    highlights: [
      'Ingredientes frescos selecionados diariamente',
      'Ambiente acolhedor para família e amigos',
      'Reservas e pedidos diretos via WhatsApp',
    ],
    ctaPrimary: 'Reservar ou Pedir',
    ctaSecondary: 'Ver Especialidades',
    services: [
      {
        title: 'Pratos da Casa',
        description: 'Receitas exclusivas preparadas na hora com tempero equilibrado e apresentação cuidadosa.',
        icon: 'UtensilsCrossed',
      },
      {
        title: 'Almoço e Jantar no Salão',
        description: 'Espaço confortável com atendimento atencioso para encontros, famílias e comemorações.',
        icon: 'Sparkles',
      },
      {
        title: 'Delivery e Retirada Rápida',
        description: 'Embalagens térmicas que preservam o aroma, a textura e a temperatura até a sua mesa.',
        icon: 'ShoppingBag',
      },
      {
        title: 'Eventos e Reservas de Grupo',
        description: 'Mesas preparadas sob medida para aniversários, confraternizações e reuniões.',
        icon: 'CalendarCheck',
      },
    ],
    differentials: [
      {
        title: 'Padronagem e Frescor',
        description: 'Preparo diário com fornecedores locais selecionados e controle rigoroso de cozinha.',
        metric: '100% fresco',
      },
      {
        title: 'Atendimento Ágil',
        description: 'Equipe treinada para servir com simpatia e rapidez tanto no salão quanto nos pedidos.',
        metric: 'Nota alta',
      },
      {
        title: 'Localização Privilegiada',
        description: 'Fácil acesso no bairro com horários convenientes ao longo de toda a semana.',
        metric: 'Bairro central',
      },
    ],
    faq: [
      {
        question: 'Como faço reserva de mesa ou pedido pelo WhatsApp?',
        answer: 'Basta clicar no botão de WhatsApp desta página e informar o número de pessoas ou os itens do seu pedido.',
      },
      {
        question: 'Vocês trabalham com retirada no balcão ou entregas na região?',
        answer: 'Sim! Confirmamos na hora a disponibilidade de entrega para o seu endereço no bairro e região.',
      },
      {
        question: 'Quais são os horários de atendimento?',
        answer: 'Confira todos os horários atualizados logo abaixo na seção de Localização e Horários.',
      },
    ],
  },
  escritorios: {
    badge: 'Assessoria Estratégica',
    headlineFn: (name, neighborhood, city) =>
      `${name}: Soluções Técnicas e Segurança Jurídico-Empresarial em ${city}`,
    subheadlineFn: (_name, neighborhood, city) =>
      `Atendimento consultivo próximo, análise criteriosa e agilidade na resolução de demandas em ${neighborhood}, ${city}.`,
    aboutFn: (name, neighborhood, city, rating, count) =>
      `O ${name} atua em ${neighborhood}, ${city} oferecendo orientação técnica clara, sigilo profissional e acompanhamento contínuo para pessoas e empresas. Reconhecido com nota ${rating.toFixed(1)} em ${count} avaliações, nosso compromisso é transformar cenários complexos em decisões seguras.`,
    highlights: [
      'Atendimento consultivo personalizado',
      'Transparência em prazos e etapas',
      'Canal direto e ágil com especialistas',
    ],
    ctaPrimary: 'Agendar Reunião',
    ctaSecondary: 'Áreas de Atuação',
    services: [
      {
        title: 'Consultoria Preventiva',
        description: 'Análise estratégica para reduzir riscos, otimizar custos e garantir conformidade legal.',
        icon: 'Briefcase',
      },
      {
        title: 'Atendimento Empresarial e Pessoal',
        description: 'Soluções sob medida para demandas rotineiras ou projetos de alta complexidade.',
        icon: 'Building2',
      },
      {
        title: 'Revisão Documental e Contratos',
        description: 'Elaboração e conferência técnica detalhada para proteger seus interesses.',
        icon: 'FileCheck2',
      },
      {
        title: 'Acompanhamento Dedicado',
        description: 'Relatórios claros e comunicação direta sobre cada movimentação do seu caso.',
        icon: 'ShieldCheck',
      },
    ],
    differentials: [
      {
        title: 'Comunicação Clara',
        description: 'Sem juridiquês ou termos confusos: você entende exatamente cada passo.',
        metric: 'Clareza total',
      },
      {
        title: 'Atendimento Presencial e Online',
        description: 'Flexibilidade para reuniões no escritório em seu bairro ou por videoconferência.',
        metric: 'Híbrido',
      },
      {
        title: 'Compromisso Ético',
        description: 'Confidencialidade absoluta e foco prático na resolução do seu objetivo.',
        metric: 'Sigilo total',
      },
    ],
    faq: [
      {
        question: 'Como agendar uma primeira reunião de diagnóstico?',
        answer: 'Clique no botão de WhatsApp e envie um breve resumo da sua necessidade para agendar presencialmente ou online.',
      },
      {
        question: 'Vocês atendem empresas e pessoas físicas?',
        answer: 'Sim, estruturamos planos e atendimentos específicos tanto para demandas individuais quanto corporativas.',
      },
      {
        question: 'Onde fica localizado o escritório?',
        answer: 'Estamos situados em ponto de fácil acesso. Veja o mapa completo e rotas na seção de Localização.',
      },
    ],
  },
  estetica: {
    badge: 'Beleza & Bem-Estar',
    headlineFn: (name, neighborhood, city) =>
      `${name}: Realce Sua Beleza Natural com Protocolos Exclusivos em ${neighborhood}`,
    subheadlineFn: (_name, neighborhood, city) =>
      `Cuidados personalizados, ambiente sofisticado e resultados visíveis desde as primeiras sessões em ${neighborhood}, ${city}.`,
    aboutFn: (name, neighborhood, city, rating, count) =>
      `No ${name}, cada atendimento começa com uma avaliação individualizada para respeitar seus traços e objetivos. Localizado em ${neighborhood}, ${city} e avaliado com ${rating.toFixed(1)} estrelas por ${count} clientes, unimos técnicas modernas e produtos de alta performance.`,
    highlights: [
      'Protocolos personalizados após avaliação',
      'Produtos dermatologicamente testados',
      'Ambiente acolhedor e hora marcada',
    ],
    ctaPrimary: 'Agendar Horário',
    ctaSecondary: 'Ver Tratamentos',
    services: [
      {
        title: 'Protocolos Faciais Personalizados',
        description: 'Limpeza profunda, revitalização e cuidados direcionados para luminosidade e viço.',
        icon: 'Sparkles',
      },
      {
        title: 'Tratamentos Corporais e Bem-Estar',
        description: 'Técnicas combinadas para remodelagem, relaxamento e equilíbrio corporal.',
        icon: 'Heart',
      },
      {
        title: 'Visagismo e Cuidados Exclusivos',
        description: 'Harmonização de estilo alinhada à sua rotina para resultados naturais e duradouros.',
        icon: 'Star',
      },
      {
        title: 'Consultoria de Manutenção',
        description: 'Orientações práticas de cuidados diários para potencializar e prolongar resultados.',
        icon: 'CalendarCheck',
      },
    ],
    differentials: [
      {
        title: 'Atendimento Individualizado',
        description: 'Horário reservado exclusivamente para você, sem correria e com foco total.',
        metric: 'Exclusivo',
      },
      {
        title: 'Alta Satisfação',
        description: 'Clientes fiéis que recomendam nosso espaço pela atenção aos detalhes.',
        metric: 'Nota máxima',
      },
      {
        title: 'Agendamento Descomplicado',
        description: 'Confirme ou ajuste seu horário em segundos pelo WhatsApp.',
        metric: 'Rápido',
      },
    ],
    faq: [
      {
        question: 'Como funciona a avaliação inicial?',
        answer: 'Analisamos seu objetivo e histórico antes de indicar o protocolo ideal para você, sem compromisso.',
      },
      {
        question: 'Preciso reservar horário com antecedência?',
        answer: 'Sim, trabalhamos com hora marcada para garantir atendimento exclusivo e pontual. Chame no WhatsApp para consultar vagas.',
      },
      {
        question: 'Onde fica o espaço?',
        answer: 'Você encontra nosso endereço exato, horários e link de rotas no mapa desta página.',
      },
    ],
  },
  servicos_locais: {
    badge: 'Atendimento Rápido',
    headlineFn: (name, neighborhood, city) =>
      `${name}: Serviço Especializado com Agilidade e Garantia em ${city}`,
    subheadlineFn: (_name, neighborhood, city) =>
      `Soluções práticas, orçamento transparente pelo WhatsApp e atendimento pontual em ${neighborhood}, ${city} e região.`,
    aboutFn: (name, neighborhood, city, rating, count) =>
      `A ${name} atende residências e empresas em ${neighborhood}, ${city} com foco em agilidade, capricho e cumprimento de prazo. Com nota média ${rating.toFixed(1)} em ${count} avaliações, garantimos comunicação clara desde o primeiro contato até a entrega final.`,
    highlights: [
      'Orçamento rápido via WhatsApp',
      'Equipe pontual e qualificada',
      'Garantia de serviço bem executado',
    ],
    ctaPrimary: 'Pedir Orçamento',
    ctaSecondary: 'Nossos Serviços',
    services: [
      {
        title: 'Atendimento Sob Demanda',
        description: 'Avaliação rápida da sua necessidade com deslocamento ágil na região.',
        icon: 'Zap',
      },
      {
        title: 'Execução Especializada',
        description: 'Ferramental adequado e acabamento cuidadoso para resolver de primeira.',
        icon: 'CheckCircle2',
      },
      {
        title: 'Manutenção Preventiva',
        description: 'Planos periódicos para evitar imprevistos em residências, comércios e empresas.',
        icon: 'ShieldCheck',
      },
      {
        title: 'Suporte Pós-Atendimento',
        description: 'Canal direto com nossa equipe para tirar dúvidas ou solicitar novos ajustes.',
        icon: 'PhoneCall',
      },
    ],
    differentials: [
      {
        title: 'Resposta Imediata',
        description: 'Atendimento rápido pelo WhatsApp para você não perder tempo.',
        metric: 'Ágil',
      },
      {
        title: 'Preço Justo Combinado',
        description: 'Valores claros informados antes do início do serviço.',
        metric: 'Transparente',
      },
      {
        title: 'Qualidade Comprovada',
        description: 'Clientes satisfeitos no bairro avaliam e recomendam nosso trabalho.',
        metric: 'Bem avaliado',
      },
    ],
    faq: [
      {
        question: 'Como solicito um orçamento rápido?',
        answer: 'Clique no botão de WhatsApp abaixo, descreva o que precisa e respondemos rapidamente com a estimativa e disponibilidade.',
      },
      {
        question: 'Vocês atendem quais bairros?',
        answer: 'Atendemos nosso bairro sede e toda a região metropolitana próxima. Confirme seu endereço pelo WhatsApp.',
      },
      {
        question: 'Qual o horário de atendimento?',
        answer: 'Veja nossos horários atualizados de segunda a sábado na seção de Localização logo abaixo.',
      },
    ],
  },
};

export async function generateSiteDocumentWithAI(
  params: GenerateSiteContentParams,
): Promise<GenerateSiteContentResult> {
  const openaiKey = (params.openaiApiKey || process.env.OPENAI_API_KEY || '').trim();
  const anthropicKey = (params.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '').trim();
  const mode = (process.env.LLM_PROVIDER || 'auto').toLowerCase();

  const templateSlug = params.templateSlug || DEFAULT_TEMPLATE_BY_NICHE[params.lead.niche];

  if (mode !== 'sandbox' && mode !== 'deterministic') {
    if ((mode === 'openai' || mode === 'auto') && openaiKey) {
      try {
        return await generateWithOpenAI({ ...params, templateSlug }, openaiKey);
      } catch (err) {
        console.warn('[LLMProvider] Falha na OpenAI, tentando próximo provedor/fallback:', err);
      }
    }
    if ((mode === 'anthropic' || mode === 'auto') && anthropicKey) {
      try {
        return await generateWithAnthropic({ ...params, templateSlug }, anthropicKey);
      } catch (err) {
        console.warn('[LLMProvider] Falha na Anthropic, usando fallback determinístico:', err);
      }
    }
  }

  return generateDeterministicSiteDocument({ ...params, templateSlug });
}

function buildBaseDocumentSkeleton(
  params: GenerateSiteContentParams & { templateSlug: TemplateSlug },
) {
  const { lead, palette, fontPairing, heroImageUrl, gallery, templateSlug } = params;
  const blueprint = NICHE_COPY_BLUEPRINTS[lead.niche];
  const phoneDisplay = lead.phoneRaw || lead.phoneE164 || '(11) 99999-0000';
  const whatsappNumber = lead.whatsappValid && lead.phoneE164 ? lead.phoneE164 : undefined;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${lead.businessName} ${lead.address}`,
  )}`;

  const reviews =
    lead.reviews.length > 0
      ? lead.reviews.slice(0, 4).map((r) => ({
          author: clampString(r.author, 60),
          rating: Math.min(5, Math.max(1, r.rating || 5)),
          text: clampString(r.text, 320),
          relativeTime: clampString(r.relativeTime || 'recentemente', 40),
        }))
      : [
          {
            author: 'Cliente Verificado',
            rating: 5,
            text: `Excelente atendimento da equipe ${lead.businessName} em ${lead.neighborhood}. Recomendo!`,
            relativeTime: 'há 1 mês',
          },
        ];

  const openingHours =
    lead.openingHours.length > 0
      ? lead.openingHours.slice(0, 7).map((h) => ({
          day: clampString(h.day, 24),
          hours: clampString(h.hours, 48),
        }))
      : [{ day: 'Segunda a Sexta', hours: '08:00 - 18:00' }];

  return {
    version: '1.0' as const,
    templateSlug,
    niche: lead.niche,
    theme: {
      ...palette,
      fontPairing,
    },
    business: {
      name: clampString(lead.businessName, 80),
      categoryLabel: clampString(lead.category || NICHE_LABELS[lead.niche], 50),
      phoneE164: lead.phoneE164 || '',
      phoneDisplay: clampString(phoneDisplay, 30),
      whatsappNumber,
      email: lead.email || '',
      address: clampString(lead.address, 180),
      neighborhood: clampString(lead.neighborhood || 'Centro', 80),
      city: clampString(lead.city, 80),
      state: clampString(lead.state || 'SP', 10),
      lat: lead.lat,
      lng: lead.lng,
      rating: Number(Math.min(5, Math.max(0, lead.rating || 4.8)).toFixed(1)),
      reviewCount: Math.max(0, Math.round(lead.reviewCount || reviews.length)),
      openingHours,
    },
    hero: {
      badge: clampString(blueprint.badge, 45),
      headline: clampString(blueprint.headlineFn(lead.businessName, lead.neighborhood, lead.city), 90),
      subheadline: clampString(
        blueprint.subheadlineFn(lead.businessName, lead.neighborhood, lead.city),
        220,
      ),
      ctaPrimary: clampString(blueprint.ctaPrimary, 35),
      ctaSecondary: clampString(blueprint.ctaSecondary, 35),
      heroImageUrl,
      heroImageAlt: clampString(`${lead.businessName} em ${lead.neighborhood}, ${lead.city}`, 120),
    },
    about: {
      title: clampString(`Sobre a ${lead.businessName}`, 70),
      description: clampString(
        blueprint.aboutFn(
          lead.businessName,
          lead.neighborhood,
          lead.city,
          lead.rating || 4.8,
          lead.reviewCount || 32,
        ),
        650,
      ),
      highlights: blueprint.highlights.map((h) => clampString(h, 80)),
    },
    services: {
      title: 'Nossos Serviços e Especialidades',
      subtitle: clampString(
        `Soluções preparadas para atender clientes de ${lead.neighborhood} e toda ${lead.city}.`,
        160,
      ),
      items: blueprint.services.map((s) => ({
        title: clampString(s.title, 55),
        description: clampString(s.description, 180),
        icon: clampString(s.icon, 32),
      })),
    },
    differentials: {
      title: `Por que escolher a ${clampString(lead.businessName, 40)}?`,
      items: blueprint.differentials.map((d) => ({
        title: clampString(d.title, 50),
        description: clampString(d.description, 150),
        metric: clampString(d.metric, 25),
      })),
    },
    testimonials: {
      title: 'O que dizem nossos clientes',
      items: reviews,
    },
    gallery: gallery.slice(0, 6).map((g, idx) => ({
      url: g.url,
      alt: clampString(g.alt || `${lead.businessName} - foto ${idx + 1}`, 120),
      isStockFallback: g.isStockFallback,
    })),
    location: {
      title: 'Localização e Horários',
      instructions: clampString(
        `Visite-nos em ${lead.address} ou clique no mapa para traçar sua rota.`,
        180,
      ),
      mapsUrl,
    },
    faq: {
      title: 'Perguntas Frequentes',
      items: blueprint.faq.map((f) => ({
        question: clampString(f.question, 120),
        answer: clampString(f.answer, 360),
      })),
    },
    seo: {
      title: clampString(`${lead.businessName} | ${lead.category} em ${lead.city}`, 70),
      description: clampString(
        `${lead.businessName} em ${lead.neighborhood}, ${lead.city}. Nota ${lead.rating.toFixed(1)}★. Atendimento especializado e contato rápido pelo WhatsApp.`,
        160,
      ),
      keywords: [
        clampString(lead.businessName, 40),
        clampString(lead.category, 40),
        clampString(`${lead.category} ${lead.neighborhood}`, 40),
        clampString(`${lead.category} ${lead.city}`, 40),
      ],
    },
    footer: {
      copyright: clampString(`© ${new Date().getFullYear()} ${lead.businessName}. Todos os direitos reservados.`, 100),
      legalNotice: clampString(`${lead.neighborhood}, ${lead.city} - ${lead.state}`, 140),
    },
  };
}

function generateDeterministicSiteDocument(
  params: GenerateSiteContentParams & { templateSlug: TemplateSlug },
): GenerateSiteContentResult {
  const skeleton = buildBaseDocumentSkeleton(params);
  const validated = sanitizeAndValidateSiteDocument(skeleton);
  return {
    document: validated,
    provider: 'deterministic',
    promptTokens: 420,
    completionTokens: 680,
    estimatedCostCents: 0,
  };
}

async function generateWithOpenAI(
  params: GenerateSiteContentParams & { templateSlug: TemplateSlug },
  apiKey: string,
): Promise<GenerateSiteContentResult> {
  const skeleton = buildBaseDocumentSkeleton(params);
  const prompt = `Você é um copywriter sênior brasileiro especialista em SEO local e conversão para negócios locais.
Reescreva apenas os campos textuais comerciais (hero.badge, hero.headline, hero.subheadline, hero.ctaPrimary, hero.ctaSecondary, about.title, about.description, about.highlights, services.title, services.subtitle, services.items, differentials, faq, seo) para a empresa:
Nome: ${params.lead.businessName}
Categoria: ${params.lead.category} (Nicho: ${params.lead.niche})
Bairro/Cidade: ${params.lead.neighborhood}, ${params.lead.city}/${params.lead.state}
Nota Google: ${params.lead.rating} (${params.lead.reviewCount} avaliações)
Respeite estritamente os limites de caracteres (headline <= 90, subheadline <= 220, description <= 650, seo.title <= 70, seo.description <= 160).
Retorne um JSON válido com as chaves: hero, about, services, differentials, faq, seo.`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.5,
      messages: [
        { role: 'system', content: 'Responda exclusivamente em JSON válido em Português (Brasil).' },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!resp.ok) {
    throw new Error(`OpenAI API status ${resp.status}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const rawJson = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  const merged = mergeLlmCopyWithSkeleton(skeleton, rawJson);
  const validated = sanitizeAndValidateSiteDocument(merged);

  const promptTokens = data.usage?.prompt_tokens ?? 500;
  const completionTokens = data.usage?.completion_tokens ?? 750;
  return {
    document: validated,
    provider: 'openai',
    promptTokens,
    completionTokens,
    estimatedCostCents: Math.max(1, Math.round(((promptTokens * 0.15 + completionTokens * 0.6) / 1_000_000) * 550)),
  };
}

async function generateWithAnthropic(
  params: GenerateSiteContentParams & { templateSlug: TemplateSlug },
  apiKey: string,
): Promise<GenerateSiteContentResult> {
  const skeleton = buildBaseDocumentSkeleton(params);
  const prompt = `Gere copywriting comercial em Português (Brasil) no formato JSON puro (sem markdown) para:
Empresa: ${params.lead.businessName}, Categoria: ${params.lead.category}, Local: ${params.lead.neighborhood}, ${params.lead.city}/${params.lead.state}.
Chaves obrigatórias no JSON: hero {badge, headline, subheadline, ctaPrimary, ctaSecondary}, about {title, description, highlights}, services {title, subtitle, items}, differentials {title, items}, faq {title, items}, seo {title, description, keywords}.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Anthropic API status ${resp.status}`);
  }

  const data = (await resp.json()) as {
    content?: Array<{ text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = data.content?.[0]?.text || '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const rawJson = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
  const merged = mergeLlmCopyWithSkeleton(skeleton, rawJson);
  const validated = sanitizeAndValidateSiteDocument(merged);

  const promptTokens = data.usage?.input_tokens ?? 500;
  const completionTokens = data.usage?.output_tokens ?? 750;
  return {
    document: validated,
    provider: 'anthropic',
    promptTokens,
    completionTokens,
    estimatedCostCents: Math.max(1, Math.round(((promptTokens * 0.8 + completionTokens * 4.0) / 1_000_000) * 550)),
  };
}

function mergeLlmCopyWithSkeleton(skeleton: SiteDocument, ai: Record<string, any>): SiteDocument {
  return {
    ...skeleton,
    hero: {
      ...skeleton.hero,
      badge: clampString(String(ai?.hero?.badge || skeleton.hero.badge), 45),
      headline: clampString(String(ai?.hero?.headline || skeleton.hero.headline), 90),
      subheadline: clampString(String(ai?.hero?.subheadline || skeleton.hero.subheadline), 220),
      ctaPrimary: clampString(String(ai?.hero?.ctaPrimary || skeleton.hero.ctaPrimary), 35),
      ctaSecondary: clampString(String(ai?.hero?.ctaSecondary || skeleton.hero.ctaSecondary), 35),
    },
    about: {
      title: clampString(String(ai?.about?.title || skeleton.about.title), 70),
      description: clampString(String(ai?.about?.description || skeleton.about.description), 650),
      highlights:
        Array.isArray(ai?.about?.highlights) && ai.about.highlights.length >= 2
          ? ai.about.highlights.slice(0, 4).map((h: unknown) => clampString(String(h), 80))
          : skeleton.about.highlights,
    },
    services: {
      title: clampString(String(ai?.services?.title || skeleton.services.title), 70),
      subtitle: clampString(String(ai?.services?.subtitle || skeleton.services.subtitle), 160),
      items:
        Array.isArray(ai?.services?.items) && ai.services.items.length >= 3
          ? ai.services.items.slice(0, 6).map((s: any, idx: number) => ({
              title: clampString(String(s?.title || skeleton.services.items[idx]?.title || 'Serviço'), 55),
              description: clampString(
                String(s?.description || skeleton.services.items[idx]?.description || 'Atendimento especializado.'),
                180,
              ),
              icon: clampString(String(s?.icon || skeleton.services.items[idx]?.icon || 'CheckCircle2'), 32),
            }))
          : skeleton.services.items,
    },
    differentials: {
      title: clampString(String(ai?.differentials?.title || skeleton.differentials.title), 70),
      items:
        Array.isArray(ai?.differentials?.items) && ai.differentials.items.length >= 3
          ? ai.differentials.items.slice(0, 4).map((d: any, idx: number) => ({
              title: clampString(String(d?.title || skeleton.differentials.items[idx]?.title || 'Diferencial'), 50),
              description: clampString(
                String(d?.description || skeleton.differentials.items[idx]?.description || 'Qualidade superior.'),
                150,
              ),
              metric: d?.metric ? clampString(String(d.metric), 25) : skeleton.differentials.items[idx]?.metric,
            }))
          : skeleton.differentials.items,
    },
    faq: {
      title: clampString(String(ai?.faq?.title || skeleton.faq.title), 70),
      items:
        Array.isArray(ai?.faq?.items) && ai.faq.items.length >= 3
          ? ai.faq.items.slice(0, 6).map((f: any, idx: number) => ({
              question: clampString(String(f?.question || skeleton.faq.items[idx]?.question || 'Dúvida?'), 120),
              answer: clampString(
                String(f?.answer || skeleton.faq.items[idx]?.answer || 'Entre em contato pelo WhatsApp.'),
                360,
              ),
            }))
          : skeleton.faq.items,
    },
    seo: {
      title: clampString(String(ai?.seo?.title || skeleton.seo.title), 70),
      description: clampString(String(ai?.seo?.description || skeleton.seo.description), 160),
      keywords:
        Array.isArray(ai?.seo?.keywords) && ai.seo.keywords.length > 0
          ? ai.seo.keywords.slice(0, 10).map((k: unknown) => clampString(String(k), 40))
          : skeleton.seo.keywords,
    },
  };
}
