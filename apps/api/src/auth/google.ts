// Login com Google (Google Identity Services, fluxo de ID token): o navegador recebe um JWT assinado
// pelo Google e o backend confere assinatura, emissor, destinatário (o nosso Client ID), validade e
// e-mail verificado contra as chaves públicas do Google. Nenhum token do Google é guardado nem logado;
// nenhuma API do Google é chamada. Avaliação de termos: docs/phase0/google-signin-tos.md.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface GoogleIdentity {
  /** identificador estável da conta Google (o vínculo é por ele, não pelo e-mail) */
  sub: string;
  email: string;
  /** nome para sugerir como nome de exibição */
  name?: string;
}

export interface GoogleVerifier {
  verify(credential: string): Promise<GoogleIdentity>;
}

export const GOOGLE_VERIFIER = Symbol('GOOGLE_VERIFIER');

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';

/** `keys`: as chaves públicas do Google (nos testes, um conjunto local). */
export function googleVerifier(clientId: string, keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(GOOGLE_JWKS))): GoogleVerifier {
  return {
    async verify(credential) {
      const { payload } = await jwtVerify(credential, keys, { issuer: ISSUERS, audience: clientId, algorithms: ['RS256'], clockTolerance: 30 });
      if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string' || payload.email_verified !== true) {
        throw new Error('google: identidade sem e-mail verificado');
      }
      const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 80) : '';
      return { sub: payload.sub, email: payload.email.trim().toLowerCase(), ...(name ? { name } : {}) };
    },
  };
}
