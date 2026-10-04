import type { AuthError } from "@supabase/supabase-js";

// Supabase returns its own messages in English. We key on `error.code`, a stable
// identifier from auth-js, rather than on the message text, which upstream rewords
// freely. Only codes reachable from signInWithPassword / signUp with email+password
// are listed; anything else falls back to the caller's generic message, so no English
// ever reaches the parent.
const MESSAGES: Record<string, string> = {
  invalid_credentials: "Nieprawidłowy email lub hasło",
  email_not_confirmed: "Potwierdź adres email, zanim się zalogujesz",
  user_not_found: "Nie znaleziono konta z tym adresem email",
  user_banned: "To konto zostało zablokowane",
  email_exists: "Konto z tym adresem email już istnieje",
  user_already_exists: "Konto z tym adresem email już istnieje",
  weak_password: "Hasło jest za słabe. Użyj co najmniej 6 znaków",
  email_address_invalid: "Podaj poprawny adres email",
  signup_disabled: "Rejestracja jest obecnie wyłączona",
  email_provider_disabled: "Rejestracja adresem email jest wyłączona",
  over_request_rate_limit: "Zbyt wiele prób. Spróbuj ponownie za chwilę",
  over_email_send_rate_limit: "Zbyt wiele prób. Spróbuj ponownie za chwilę",
  validation_failed: "Nieprawidłowe dane. Sprawdź formularz",
  request_timeout: "Przekroczono czas oczekiwania. Spróbuj ponownie",
};

export function authErrorMessage(error: AuthError, fallback: string): string {
  const mapped = error.code ? MESSAGES[error.code] : undefined;
  return mapped ?? fallback;
}
