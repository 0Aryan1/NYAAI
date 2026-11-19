/**
 * Google sign-in (LLD §15.1): openid-client with PKCE, state and nonce. Accepts only a verified email whose
 * domain is in ALLOWED_EMAIL_DOMAINS, whose `hd` claim matches, and who is invited or already a user.
 * Switched off until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
 */
import * as oidc from 'openid-client';
import { SignJWT, jwtVerify } from 'jose';

export interface GoogleClaims {
  email?: unknown;
  email_verified?: unknown;
  hd?: unknown;
  name?: unknown;
  sub?: unknown;
}

export type ClaimCheck =
  | { ok: true; email: string; name: string; sub: string }
  | { ok: false; reason: 'email_unverified' | 'domain_not_allowed' | 'hd_mismatch' | 'missing_claims' };

/** Pure claim check: verified email, allowed domain, and a Workspace `hd` claim equal to that domain. */
export function checkGoogleClaims(claims: GoogleClaims, allowedDomains: string[], { requireHd = true } = {}): ClaimCheck {
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const sub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!email || !sub) return { ok: false, reason: 'missing_claims' };
  if (claims.email_verified !== true) return { ok: false, reason: 'email_unverified' };
  const domain = email.split('@')[1] ?? '';
  const allowed = allowedDomains.map((d) => d.toLowerCase());
  if (!allowed.includes(domain)) return { ok: false, reason: 'domain_not_allowed' };
  // Workspace accounts carry `hd`; skipping this is allowed only in development (config refuses it elsewhere).
  if (requireHd && (typeof claims.hd !== 'string' || claims.hd.toLowerCase() !== domain)) return { ok: false, reason: 'hd_mismatch' };
  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : email.split('@')[0]!;
  return { ok: true, email, name, sub };
}

export const FLOW_COOKIE = 'nyaai_oidc';

interface Flow {
  verifier: string;
  state: string;
  nonce: string;
}

export class GoogleSignIn {
  private config: Promise<oidc.Configuration> | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
    private readonly hostedDomain: string | undefined,
    private readonly secret: string,
  ) {}

  private discover() {
    this.config ??= oidc.discovery(new URL('https://accounts.google.com'), this.clientId, this.clientSecret);
    return this.config;
  }

  /** Returns the Google URL and a short-lived signed cookie value holding PKCE verifier, state and nonce. */
  async start(): Promise<{ url: string; flowCookie: string }> {
    const config = await this.discover();
    const flow: Flow = { verifier: oidc.randomPKCECodeVerifier(), state: oidc.randomState(), nonce: oidc.randomNonce() };
    const params: Record<string, string> = {
      redirect_uri: this.redirectUri,
      scope: 'openid email profile',
      code_challenge: await oidc.calculatePKCECodeChallenge(flow.verifier),
      code_challenge_method: 'S256',
      state: flow.state,
      nonce: flow.nonce,
      prompt: 'select_account',
    };
    if (this.hostedDomain) params.hd = this.hostedDomain;
    const flowCookie = await new SignJWT({ ...flow })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode(this.secret));
    return { url: oidc.buildAuthorizationUrl(config, params).href, flowCookie };
  }

  /** Exchanges the code and returns the ID-token claims. Throws on a bad state, nonce or code. */
  async finish(currentUrl: URL, flowCookie: string): Promise<GoogleClaims> {
    const { payload } = await jwtVerify(flowCookie, new TextEncoder().encode(this.secret), { algorithms: ['HS256'] });
    const flow = payload as unknown as Flow;
    const tokens = await oidc.authorizationCodeGrant(await this.discover(), currentUrl, {
      pkceCodeVerifier: flow.verifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    });
    return (tokens.claims() ?? {}) as GoogleClaims;
  }
}
