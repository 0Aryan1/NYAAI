/** Sign-in, who she is, consent, setup and "your data" (LLD §4.2). */
import {
  AuthOptions,
  CONSENT_VERSION,
  ConsentStatus,
  JobAccepted,
  Me,
  type ProfileRequest,
  type StyleRequest,
} from '@nyaai/shared';
import { call } from './http';

export const accountApi = {
  authOptions: () => call('GET', '/auth/options', { parse: (v) => AuthOptions.parse(v) }),
  devLogin: (email: string) => call<void>('POST', '/auth/dev-login', { body: { email } }),
  logout: () => call<void>('POST', '/auth/logout'),
  me: () => call('GET', '/me', { parse: (v) => Me.parse(v) }),
  consent: () => call('GET', '/consents/current', { parse: (v) => ConsentStatus.parse(v) }),
  acceptConsent: () => call<void>('POST', '/consents', { body: { version: CONSENT_VERSION, accept: true } }),
  withdrawConsent: () => call<void>('POST', '/consents/withdraw'),
  saveProfile: (body: ProfileRequest) => call<void>('PATCH', '/setup/profile', { body }),
  saveStyle: (body: StyleRequest) => call<void>('PATCH', '/setup/style', { body }),
  setupProgress: (step: number) => call<void>('PATCH', '/setup/progress', { body: { step } }),
  finishSetup: () => call<void>('POST', '/setup/finish', { body: {} }),
  deleteMyData: (confirmEmail: string) =>
    call('POST', '/me/delete-data', { body: { confirmEmail }, parse: (v) => JobAccepted.parse(v) }),
};

export const accountKeys = {
  me: ['me'] as const,
  consent: ['consent'] as const,
  authOptions: ['auth-options'] as const,
};
