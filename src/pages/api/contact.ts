import type { APIRoute } from "astro";
import { getSiteSettings } from "emdash";
// @ts-ignore - Módulo virtual do Cloudflare no Astro 6
import { env } from "cloudflare:workers";

/**
 * Depois disso o formulário recusa mais envios do mesmo IP.
 *
 * O contador é em memória do isolate: é barato e corta o abuso trivial, mas
 * não é um limite global — entre isolates cada um conta o seu. Se isso virar
 * problema real, o lugar certo é um KV/DO compartilhado (ou o Rate Limiting
 * binding do Workers), não este Map.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hitsByIp = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
	const now = Date.now();
	const recent = (hitsByIp.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);

	if (recent.length >= MAX_PER_WINDOW) {
		hitsByIp.set(ip, recent);
		return true;
	}

	recent.push(now);
	hitsByIp.set(ip, recent);

	// Sem poda o Map cresce para sempre num isolate de vida longa.
	if (hitsByIp.size > 5_000) {
		for (const [key, hits] of hitsByIp) {
			if (hits.every((at) => now - at >= WINDOW_MS)) hitsByIp.delete(key);
		}
	}

	return false;
}

/** Limites de tamanho: e-mail não é canal de anexo. */
const MAX_NAME = 120;
const MAX_EMAIL = 200;
const MAX_MESSAGE = 5_000;

function json(body: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
	});
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const settings = await getSiteSettings();
    const url = new URL(request.url);
    const hostname = url.hostname;
    const contactEmail = `contato@${hostname}`;

    // 1) Só o próprio site pode postar aqui. O formulário é same-origin; um
    //    POST de outro domínio com o cookie do visitante não deve passar.
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== url.origin) {
      return json({ message: "Origem não autorizada." }, 403);
    }
    if (request.headers.get("sec-fetch-site") === "cross-site") {
      return json({ message: "Origem não autorizada." }, 403);
    }

    // 2) Trava de volume por IP, antes de qualquer trabalho. O header é o que
    //    o Cloudflare injeta; sem ele o limite vira um balde único (melhor que
    //    abrir a porta, e nunca quebra o envio legítimo).
    const ip = request.headers.get("cf-connecting-ip") ?? "desconhecido";
    if (isRateLimited(ip)) {
      return json(
        { message: "Muitas mensagens em pouco tempo. Tente novamente em alguns minutos." },
        429,
      );
    }

    // No Astro 6 com Cloudflare, usamos o import direto para acessar as Secrets
    const RESEND_API_KEY = (env as any).RESEND_API_KEY;

    if (!RESEND_API_KEY) {
      return json(
        {
          message: "Configuração do servidor pendente (RESEND_API_KEY não encontrada).",
          status: "missing_api_key",
        },
        500,
      );
    }

    const data = await request.formData();
    const name = data.get("name")?.toString();
    const email = data.get("email")?.toString();
    const message = data.get("message")?.toString();

    // Validação básica
    if (!message || message.trim() === "" || !name || !email) {
      return json(
        { message: "Por favor, preencha todos os campos obrigatórios." },
        400,
      );
    }

    // Validação de tamanho: o limite também é servidor-side porque
    // `maxlength` no HTML é sugestão, não barreira.
    if (
      name.length > MAX_NAME ||
      email.length > MAX_EMAIL ||
      message.length > MAX_MESSAGE
    ) {
      return json({ message: "Mensagem longa demais. Encurte e tente de novo." }, 413);
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${settings.title} <${contactEmail}>`,
        to: [contactEmail],
        reply_to: email,
        subject: `${settings.title} - ${name}`,
        text: `Nome: ${name}\nE-mail: ${email}\n\nMensagem:\n${message}`,
      }),
    });

    if (response.ok) {
      return json({ message: "Mensagem enviada com sucesso!" });
    } else {
      const errorData = await response.json();
      console.error("Resend Error:", errorData);
      return json(
        {
          message: "Ocorreu um erro ao enviar sua mensagem via Resend.",
          details: errorData,
        },
        500,
      );
    }
  } catch (error) {
    console.error("API Error:", error);
    return json({ message: "Erro interno no servidor." }, 500);
  }
};
