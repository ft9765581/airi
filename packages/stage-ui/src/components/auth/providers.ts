import type { OAuthProvider } from '../../libs/auth'

export interface SignInProviderDefinition {
  id: OAuthProvider
  name: string
  icon: string
}

// NOTICE:
// This deployment signs users in with an email address and a password only, so
// it offers no OAuth provider. Every entry here renders a button: on the
// sign-in page, on the account-settings link list, and on the profile page. The
// provider must also be configured in `server/apps/auth`, otherwise the button
// reaches a provider that has no client ID and the round trip fails.
// Removal condition: add `google`, `github`, or `steam` back here together with
// the matching credentials in that service.
export const defaultSignInProviders: SignInProviderDefinition[] = []
