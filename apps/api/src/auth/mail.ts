// Envio de e-mail (por enquanto só o "Esqueci minha senha"), por SMTP: SMTP_URL, ex.
// smtps://conta%40gmail.com:senha-de-app@smtp.gmail.com:465. Sem SMTP_URL, o envio fica desligado e a
// tela não oferece o "Esqueci minha senha". Nunca loga destinatário com o link nem o conteúdo.
import nodemailer from 'nodemailer';

export interface Mailer {
  send(msg: { to: string; subject: string; text: string; html: string }): Promise<void>;
}

export const MAILER = Symbol('MAILER');

export function createMailer(env: { SMTP_URL?: string; MAIL_FROM?: string }): Mailer | null {
  if (!env.SMTP_URL) return null;
  const transport = nodemailer.createTransport(env.SMTP_URL);
  const from = env.MAIL_FROM || 'Fruiqo <no-reply@fruiqo.app>';
  return {
    async send(msg) {
      await transport.sendMail({ from, ...msg });
    },
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** E-mail do link de redefinição (texto + HTML simples). */
export function resetEmail(link: string): { subject: string; text: string; html: string } {
  const subject = 'Fruiqo: redefinir sua senha';
  const text = [
    'Recebemos um pedido para redefinir a senha da sua conta no Fruiqo.',
    '',
    `Para criar uma senha nova, abra este link (vale por 30 minutos e uma vez só):`,
    link,
    '',
    'Se não foi você, ignore este e-mail: sua senha continua a mesma.',
  ].join('\n');
  const html = `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:520px;margin:auto;color:#0f172a">
<h2 style="margin:0 0 12px">Redefinir sua senha</h2>
<p>Recebemos um pedido para redefinir a senha da sua conta no Fruiqo.</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600">Criar senha nova</a></p>
<p style="color:#475569;font-size:14px">O link vale por 30 minutos e uma vez só. Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>
</div>`;
  return { subject, text, html };
}
