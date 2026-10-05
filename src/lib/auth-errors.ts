import type { AuthError } from "@supabase/supabase-js";

// Supabase returns its own messages in English. We key on `error.code`, a stable
// identifier from auth-js, rather than on the message text, which upstream rewords
// freely. Only codes reachable from signInWithPassword / signUp with email+password
// are listed; anything else falls back to the caller's generic message, so no English
// ever reaches the parent.
const MESSAGES: Record<string, string> = {
  invalid_credentials: "Nieprawidłowy email lub hasło",
  email_not_confirmed: "Potwierdź adres email, zanim się zalogujesz",
  user_banned: "To konto zostało zablokowane",
  email_exists: "Konto z tym adresem email już istnieje",
  user_already_exists: "Konto z tym adresem email już istnieje",
  weak_password: "Hasło jest zbyt słabe. Wybierz dłuższe lub bardziej złożone.",
  email_address_invalid: "Podaj poprawny adres email",
  signup_disabled: "Rejestracja jest obecnie wyłączona",
  email_provider_disabled: "Rejestracja adresem email jest wyłączona",
  over_request_rate_limit: "Zbyt wiele prób. Spróbuj ponownie za chwilę.",
  over_email_send_rate_limit: "Zbyt wiele prób. Spróbuj ponownie za chwilę.",
  validation_failed: "Nieprawidłowe dane. Sprawdź formularz.",
  request_timeout: "Przekroczono czas oczekiwania. Spróbuj ponownie.",
};

// `Object.hasOwn` rather than a bare lookup: `MESSAGES` inherits Object.prototype, so a
// code named after an inherited property would otherwise resolve to a function.
export function authErrorMessage(error: AuthError, fallback: string): string {
  if (error.code && Object.hasOwn(MESSAGES, error.code)) {
    return MESSAGES[error.code];
  }
  // Replacing the upstream message with our own copy would otherwise leave an outage or an
  // unmapped code with no trace at all. Code and status only — never the message or the email.
  // Deliberate operational log on a server-only path, not leftover debugging; `console.error`
  // is what Cloudflare Workers captures.
  // eslint-disable-next-line no-console
  console.error("auth: unmapped error", error.code, error.status);
  return fallback;
}
