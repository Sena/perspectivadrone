import type { APIRoute } from "astro";
import { getSiteSettings } from "emdash";
// @ts-ignore - Módulo virtual do Cloudflare no Astro 6
import { env } from "cloudflare:workers";

export const POST: APIRoute = async ({ request }) => {
  try {
    const settings = await getSiteSettings();
    const url = new URL(request.url);
    const hostname = url.hostname;
    const contactEmail = `contato@${hostname}`;

    // No Astro 6 com Cloudflare, usamos o import direto para acessar as Secrets
    const RESEND_API_KEY = (env as any).RESEND_API_KEY;

    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ 
          message: "Configuração do servidor pendente (RESEND_API_KEY não encontrada).",
          status: "missing_api_key"
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await request.formData();
    const name = data.get("name")?.toString();
    const email = data.get("email")?.toString();
    const message = data.get("message")?.toString();

    // Validação básica
    if (!message || message.trim() === "" || !name || !email) {
      return new Response(
        JSON.stringify({
          message: "Por favor, preencha todos os campos obrigatórios.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
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
      return new Response(
        JSON.stringify({ message: "Mensagem enviada com sucesso!" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } else {
      const errorData = await response.json();
      console.error("Resend Error:", errorData);
      return new Response(
        JSON.stringify({
          message: "Ocorreu um erro ao enviar sua mensagem via Resend.",
          details: errorData
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("API Error:", error);
    return new Response(
      JSON.stringify({ message: "Erro interno no servidor." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
