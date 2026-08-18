/**
 * Cloudflare Worker — Formulário Seguro Landing Page Humberto Matos
 * =================================================================
 *
 * Arquitetura:
 *   Navegador  ──HTTPS──►  Cloudflare Worker  ──HTTPS──►  EmailJS API
 *
 * Nenhuma credencial do EmailJS existe no frontend.
 * Todas as Secrets são configuradas no Dashboard do Cloudflare.
 *
 * Pipeline de validação (executado em ordem de custo crescente):
 *   1. validateOrigin       ─ barato, bloqueia requisições de fora
 *   2. validateMethod       ─ barato, só aceita POST
 *   3. validateContentType  ─ barato, só aceita application/json
 *   4. validateUserAgent    ─ barato, bloqueia bots conhecidos
 *   5. validatePayloadSize  ─ barato, rejeita payloads grandes
 *   6. validateHoneypot     ─ barato, bloqueia bots que preenchem campos ocultos
 *   7. validateTiming       �─ barato, bloqueia bots muito rápidos
 *   8. validateTurnstile    ─ médio, verifica token com Cloudflare
 *   9. validateRateLimit    ─ médio, verifica IP + fingerprint
 *   10. validateFields      ─ médio, valida email, telefone, tamanhos
 *   11. sanitizeInput       ─ médio, remove XSS e HTML
 *   12. validateSpam        ─ caro, verifica links e palavras de spam
 * =================================================================
 */

// ─── Rate Limiting Store ───────────────────────────────────────────
// In-memory Map. NOTA: cada instância do Worker (edge) tem seu próprio Map.
// Para rate limiting GLOBAL, use Cloudflare Rate Limiting (Security → Rate Limiting)
// ou Workers KV (mais lento) / Durable Objects (plano pago).
const rateLimitStore = new Map();

// ─── Configurações ─────────────────────────────────────────────────
const CONFIG = {
  MAX_PAYLOAD_SIZE: 32_768,        // 32KB
  MAX_FIELD_SIZE: 5_000,           // 5KB por campo
  MIN_FORM_TIME_MS: 3_000,         // 3 segundos mínimo de preenchimento
  RATE_LIMIT_WINDOW_MS: 60_000,    // 1 minuto
  RATE_LIMIT_MAX_REQUESTS: 10,     // 10 requisições por minuto por IP
  BLOCKED_USER_AGENTS: [
    'curl', 'wget', 'python-requests', 'go-http-client', 'okhttp',
    'java/', 'libwww-perl', 'perl/', 'php/', 'ruby/', 'scrapy',
    'httpclient', 'jakarta commons-httpclient', 'axios', 'node-fetch',
    'aiohttp', 'httpx', 'httplib2', 'mechanize', 'urllib', 'urllib3',
    'zgrab', 'masscan', 'nmap', 'sqlmap', 'nikto', 'nessus',
    'ahrefsbot', 'semrushbot', 'majestic-12', 'rogerbot',
    'dotbot', 'mj12bot', 'screaming frog', 'spider',
  ],
  SPAM_WORDS: [
    'compre agora', 'clique aqui', 'oferta imperdível', 'dinheiro fácil',
    'ganhe dinheiro', 'trabalhe em casa', 'renda extra', 'milagroso',
    'cura milagrosa', 'remédio natural', 'sem receita', 'medicamento',
    'viagra', 'cialis', 'criptomoeda', 'bitcoin', 'investimento garantido',
    'empréstimo', 'cartão de crédito', 'refinanciamento', 'herança',
    'prêmio', 'loteria', 'sorteio', 'você ganhou', 'parabéns você foi sorteado',
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Cria uma resposta JSON padronizada.
 * Todas as respostas da API usam esta função — sem vazamento de informação.
 */
function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    },
  });
}

/**
 * Obtém o IP real do cliente, considerando proxy da Cloudflare.
 */
function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP')
      || request.headers.get('X-Forwarded-For')
      || request.headers.get('X-Real-IP')
      || 'unknown';
}

/**
 * Gera um hash simples (Fowler–Noll–Vo) para fingerprinting.
 * Não é criptográfico, mas é suficiente para identificar padrões.
 */
function simpleHash(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Cria um fingerprint único combinando IP + headers do navegador.
 */
function createFingerprint(request, ip) {
  const ua = request.headers.get('User-Agent') || '';
  const lang = request.headers.get('Accept-Language') || '';
  const secChUa = request.headers.get('Sec-CH-UA') || '';
  const secChUaPlatform = request.headers.get('Sec-CH-UA-Platform') || '';
  const raw = [ip, ua, lang, secChUa, secChUaPlatform].join('|||');
  return simpleHash(raw);
}

// ─── Validação 1: Origin ──────────────────────────────────────────
/**
 * Bloqueia requisições com Origin/Referer suspeitos.
 * Verifica se a origem corresponde ao domínio permitido.
 *
 * Segurança: previne que outros sites façam requisições ao seu Worker.
 */
function validateOrigin(request, env) {
  const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(';').filter(Boolean);
  if (allowedOrigins.length === 0) return { valid: true }; // sem restrição configurada

  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');

  // Se não tem Origin nem Referer (ex: curl), permite e deixa as outras validações agirem
  if (!origin && !referer) return { valid: true };

  const check = (url) => {
    if (!url) return false;
    try {
      const u = new URL(url);
      return allowedOrigins.some(o => o === u.origin);
    } catch { return false; }
  };

  if (origin && !check(origin)) {
    return { valid: false, reason: 'origem nao autorizada' };
  }
  if (referer && !check(referer)) {
    return { valid: false, reason: 'origem nao autorizada' };
  }

  return { valid: true };
}

// ─── Validação 2: Método HTTP ─────────────────────────────────────
/**
 * Apenas aceita POST. Fornece mensagem genérica para outros métodos.
 */
function validateMethod(request) {
  if (request.method === 'OPTIONS') {
    // CORS preflight — responde e encerra
    return { valid: true, isPreflight: true };
  }
  if (request.method !== 'POST') {
    return { valid: false, reason: 'metodo nao permitido' };
  }
  return { valid: true };
}

// ─── Validação 3: Content-Type ────────────────────────────────────
/**
 * Só aceita application/json. Bloqueia ataques de upload de arquivo.
 */
function validateContentType(request) {
  const ct = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!ct.includes('application/json')) {
    return { valid: false, reason: 'content-type invalido' };
  }
  return { valid: true };
}

// ─── Validação 4: User-Agent ──────────────────────────────────────
/**
 * Bloqueia User-Agents conhecidos de bots, scrapers e ferramentas de linha de comando.
 * Lista configurável em CONFIG.BLOCKED_USER_AGENTS.
 */
function validateUserAgent(request) {
  const ua = (request.headers.get('User-Agent') || '').toLowerCase();
  if (!ua || ua.length < 10) {
    // Browsers modernos sempre enviam User-Agent com pelo menos 10 chars
    return { valid: false, reason: 'acesso negado' };
  }
  for (const blocked of CONFIG.BLOCKED_USER_AGENTS) {
    if (ua.includes(blocked.toLowerCase())) {
      return { valid: false, reason: 'acesso negado' };
    }
  }
  return { valid: true };
}

// ─── Validação 5: Tamanho do Payload ──────────────────────────────
/**
 * Bloqueia payloads maiores que o limite configurado.
 */
async function validatePayloadSize(request) {
  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (contentLength > CONFIG.MAX_PAYLOAD_SIZE) {
    return { valid: false, reason: 'payload muito grande' };
  }
  return { valid: true };
}

// ─── Validação 6: Honeypot ────────────────────────────────────────
/**
 * Campo invisível que apenas bots preenchem.
 * Se o honeypot tiver conteúdo, a requisição é bloqueada.
 */
function validateHoneypot(body) {
  if (body.honeypot && body.honeypot.trim().length > 0) {
    return { valid: false, reason: 'acesso negado' };
  }
  return { valid: true };
}

// ─── Validação 7: Tempo de Preenchimento ──────────────────────────
/**
 * Bots preenchem formulários em milissegundos.
 * Se o tempo desde o carregamento for menor que MIN_FORM_TIME_MS, bloqueia.
 */
function validateTiming(body) {
  const loadTime = parseInt(body.formLoadTime, 10);
  if (!loadTime || loadTime < CONFIG.MIN_FORM_TIME_MS) {
    return { valid: false, reason: 'tempo de preenchimento invalido' };
  }
  return { valid: true };
}

// ─── Validação 8: Turnstile ───────────────────────────────────────
/**
 * Verifica o token do Turnstile com a API da Cloudflare.
 * O Secret Key está armazenado como Secret do Worker.
 */
async function validateTurnstile(body, env, ip) {
  const token = body.turnstileToken;
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'token de seguranca ausente' };
  }

  const secretKey = env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    console.error('TURNSTILE_SECRET_KEY nao configurada');
    return { valid: false, reason: 'erro interno' };
  }

  try {
    const formData = new URLSearchParams();
    formData.append('secret', secretKey);
    formData.append('response', token);
    formData.append('remoteip', ip);

    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    });

    const outcome = await resp.json();

    if (!outcome.success) {
      console.warn(`Turnstile falhou para IP ${ip}:`, outcome['error-codes']);
      return { valid: false, reason: 'verificacao de seguranca falhou' };
    }

    return { valid: true };
  } catch (err) {
    console.error('Erro ao verificar Turnstile:', err);
    return { valid: false, reason: 'erro interno' };
  }
}

// ─── Validação 9: Rate Limiting ───────────────────────────────────
/**
 * Rate limiting simples em memória.
 * NOTA: funciona por instância do Worker (edge). Cloudflare distribui
 * requisições entre múltiplas instâncias, então o limite NÃO é global.
 *
 * Para rate limiting GLOBAL, configure no Dashboard:
 *   Security → Rate Limiting → Criar regra para /api/contact*
 *
 * Esta implementação serve como CAMADA ADICIONAL em cada edge.
 */
function validateRateLimit(env, fingerprint) {
  const now = Date.now();
  const windowStart = now - CONFIG.RATE_LIMIT_WINDOW_MS;

  let entry = rateLimitStore.get(fingerprint);

  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(fingerprint, entry);
  }

  // Remove timestamps fora da janela
  entry.timestamps = entry.timestamps.filter(t => t > windowStart);

  if (entry.timestamps.length >= CONFIG.RATE_LIMIT_MAX_REQUESTS) {
    console.warn(`Rate limit excedido para fingerprint ${fingerprint}`);
    return { valid: false, reason: 'muitas requisicoes. aguarde um minuto.' };
  }

  entry.timestamps.push(now);

  // Limpeza periódica do Map (a cada 100 requisições, evita memory leak)
  if (rateLimitStore.size > 1000) {
    for (const [key, val] of rateLimitStore.entries()) {
      val.timestamps = val.timestamps.filter(t => t > windowStart);
      if (val.timestamps.length === 0) rateLimitStore.delete(key);
    }
  }

  return { valid: true };
}

// ─── Validação 10: Campos ─────────────────────────────────────────
/**
 * Valida cada campo individualmente:
 * - Tamanho máximo por campo
 * - E-mail com regex
 * - Telefone com dígitos mínimos
 * - Campos obrigatórios não vazios
 */
function validateFields(body) {
  const errors = [];

  // Nome
  if (!body.nome || typeof body.nome !== 'string') {
    errors.push('nome');
  } else if (body.nome.trim().length < 2) {
    errors.push('nome');
  } else if (body.nome.length > CONFIG.MAX_FIELD_SIZE) {
    errors.push('nome');
  }

  // E-mail
  if (!body.email || typeof body.email !== 'string') {
    errors.push('email');
  } else {
    const emailClean = body.email.trim().toLowerCase();
    if (emailClean.length > CONFIG.MAX_FIELD_SIZE) {
      errors.push('email');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) {
      errors.push('email');
    }
  }

  // WhatsApp
  if (!body.whatsapp || typeof body.whatsapp !== 'string') {
    errors.push('whatsapp');
  } else {
    const digitsOnly = body.whatsapp.replace(/\D/g, '');
    if (digitsOnly.length < 10 || digitsOnly.length > 13) {
      errors.push('whatsapp');
    }
  }

  // Cidade
  if (!body.cidade || typeof body.cidade !== 'string') {
    errors.push('cidade');
  } else if (body.cidade.trim().length < 2) {
    errors.push('cidade');
  } else if (body.cidade.length > CONFIG.MAX_FIELD_SIZE) {
    errors.push('cidade');
  }

  if (errors.length > 0) {
    return { valid: false, reason: 'campos invalidos: ' + errors.join(', ') };
  }

  return { valid: true };
}

// ─── Sanitização ──────────────────────────────────────────────────
/**
 * Remove caracteres perigosos de uma string:
 * - Tags HTML/XML
 * - Quebras de linha maliciosas (Header Injection)
 * - Caracteres de controle
 * - Script injection
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';

  let value = input;

  // Remove caracteres de controle (exceto \n, \r, \t)
  value = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Remove tags HTML/XML
  value = value.replace(/<[^>]*>/g, '');

  // Remove quebras de linha maliciosas (Header Injection)
  value = value.replace(/\r?\n|\r/g, ' ');

  // Remove event handlers (onclick=, onload=, etc)
  value = value.replace(/\bon\w+\s*=/gi, '');

  // Remove javascript: URLs
  value = value.replace(/javascript\s*:/gi, '');

  // Remove data: URLs
  value = value.replace(/data\s*:/gi, '');

  // Remove expressões de template injection
  value = value.replace(/\{\{/g, '').replace(/\}\}/g, '');

  return value.trim();
}

/**
 * Aplica sanitização a todos os campos de texto do formulário.
 */
function sanitizeAllFields(body) {
  const sanitized = {};
  const fields = ['nome', 'email', 'whatsapp', 'cidade', 'recado',
    'integracao', 'colaboracao', 'bandeira', 'whatsapp-lista'];

  for (const field of fields) {
    sanitized[field] = sanitizeInput(body[field]);
  }

  return sanitized;
}

// ─── Validação 11: Spam ───────────────────────────────────────────
/**
 * Bloqueia mensagens com:
 * - Links suspeitos (URLs encurtadas, IPs explícitos)
 * - Palavras típicas de spam
 * - Múltiplas repetições de caracteres
 */
function validateSpam(sanitized) {
  const textToCheck = Object.values(sanitized).join(' ').toLowerCase();

  // Bloqueia links encurtados
  const shortUrlPattern = /bit\.ly|tinyurl\.com|goo\.gl|is\.gd|cli\.gs|ow\.ly|buff\.ly|shortlink|url\.shortener/i;
  if (shortUrlPattern.test(textToCheck)) {
    return { valid: false, reason: 'links encurtados nao sao permitidos' };
  }

  // Bloqueia IPs explícitos em URLs
  const ipUrlPattern = /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/;
  if (ipUrlPattern.test(textToCheck)) {
    return { valid: false, reason: 'links com ip nao sao permitidos' };
  }

  // Bloqueia palavras de spam
  for (const word of CONFIG.SPAM_WORDS) {
    if (textToCheck.includes(word.toLowerCase())) {
      return { valid: false, reason: 'conteudo nao permitido' };
    }
  }

  // Bloqueia repetição excessiva (ex: "aaaaaaa" ou "!!!!!!!!")
  const repeatPattern = /(.)\1{9,}/;
  if (repeatPattern.test(textToCheck)) {
    return { valid: false, reason: 'conteudo invalido' };
  }

  // Bloqueia mensagens muito curtas
  if (textToCheck.length < 10) {
    return { valid: false, reason: 'conteudo muito curto' };
  }

  return { valid: true };
}

// ─── EmailJS ──────────────────────────────────────────────────────
/**
 * Envia o e-mail através da API REST do EmailJS.
 *
 * Credenciais usadas (todas Secrets do Cloudflare):
 *   EMAILJS_PUBLIC_KEY   — Public Key da conta EmailJS
 *   EMAILJS_PRIVATE_KEY  — Access Token (protege chamadas server-side)
 *   EMAILJS_SERVICE_ID   — ID do serviço configurado no EmailJS
 *   EMAILJS_TEMPLATE_ID  — ID do template de e-mail
 *
 * Segurança: a Private Key é enviada como accessToken no body da requisição,
 * e o servidor do EmailJS exige que a chamada venha de uma origem autorizada
 * (configurado em Account → Security no EmailJS Dashboard).
 */
async function sendEmailJS(sanitized, env) {
  const publicKey = env.EMAILJS_PUBLIC_KEY;
  const privateKey = env.EMAILJS_PRIVATE_KEY;
  const serviceId = env.EMAILJS_SERVICE_ID;
  const templateId = env.EMAILJS_TEMPLATE_ID;

  if (!publicKey || !serviceId || !templateId) {
    console.error('Credenciais EmailJS nao configuradas');
    throw new Error('Erro de configuracao');
  }

  const payload = {
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    accessToken: privateKey,
    template_params: {
      form_title: 'Novo cadastro - Pre-campanha Humberto Matos',
      nome: sanitized.nome,
      email: sanitized.email,
      whatsapp: sanitized.whatsapp,
      cidade: sanitized.cidade,
      integracao: sanitized.integracao,
      colaboracao: sanitized.colaboracao,
      bandeira: sanitized.bandeira,
      'whatsapp-lista': sanitized['whatsapp-lista'],
      recado: sanitized.recado || '(sem recado)',
    },
  };

  const resp = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error('EmailJS retornou erro:', resp.status, errorText);
    throw new Error('Falha ao enviar email');
  }

  return true;
}

// ─── Handler Principal ────────────────────────────────────────────
/**
 * Função principal que processa todas as requisições.
 * Executa o pipeline de validação em ordem.
 *
 * Cada etapa retorna { valid: true } ou { valid: false, reason: "..." }.
 * Se qualquer etapa falhar, a requisição é rejeitada IMEDIATAMENTE.
 *
 * Isto é proteção em profundidade (defense in depth):
 * mesmo que uma camada falhe, as outras ainda protegem.
 */
async function handleRequest(request, env) {
  // ── 1. Origin ──
  const originCheck = validateOrigin(request, env);
  if (!originCheck.valid) return jsonResponse(403, { error: originCheck.reason });

  // ── 2. Method ──
  const methodCheck = validateMethod(request);
  if (methodCheck.isPreflight) return jsonResponse(204, {});
  if (!methodCheck.valid) return jsonResponse(405, { error: methodCheck.reason });

  // ── 3. Content-Type ──
  const ctCheck = validateContentType(request);
  if (!ctCheck.valid) return jsonResponse(415, { error: ctCheck.reason });

  // ── 4. User-Agent ──
  const uaCheck = validateUserAgent(request);
  if (!uaCheck.valid) return jsonResponse(403, { error: uaCheck.reason });

  // ── 5. Payload Size ──
  const sizeCheck = await validatePayloadSize(request);
  if (!sizeCheck.valid) return jsonResponse(413, { error: sizeCheck.reason });

  // ── Parse do body ──
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'json invalido' });
  }

  // ── 6. Honeypot ──
  const honeyCheck = validateHoneypot(body);
  if (!honeyCheck.valid) return jsonResponse(403, { error: honeyCheck.reason });

  // ── 7. Timing ──
  const timingCheck = validateTiming(body);
  if (!timingCheck.valid) return jsonResponse(400, { error: timingCheck.reason });

  // ── 8. Turnstile ──
  const ip = getClientIp(request);
  const turnstileCheck = await validateTurnstile(body, env, ip);
  if (!turnstileCheck.valid) return jsonResponse(403, { error: turnstileCheck.reason });

  // ── 9. Rate Limit (por fingerprint) ──
  const fingerprint = createFingerprint(request, ip);
  const rlCheck = validateRateLimit(env, fingerprint);
  if (!rlCheck.valid) return jsonResponse(429, { error: rlCheck.reason });

  // ── 10. Fields ──
  const fieldsCheck = validateFields(body);
  if (!fieldsCheck.valid) return jsonResponse(400, { error: fieldsCheck.reason });

  // ── 11. Sanitize ──
  const sanitized = sanitizeAllFields(body);

  // ── 12. Spam ──
  const spamCheck = validateSpam(sanitized);
  if (!spamCheck.valid) return jsonResponse(400, { error: spamCheck.reason });

  // ── Enviar Email ──
  try {
    await sendEmailJS(sanitized, env);
    console.log(`Email enviado com sucesso de IP ${ip}`);
    return jsonResponse(200, { success: true, message: 'Cadastro realizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao enviar email:', err);
    return jsonResponse(500, { error: 'erro ao processar cadastro' });
  }
}

// ─── Export ───────────────────────────────────────────────────────
export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env);
  },
};
