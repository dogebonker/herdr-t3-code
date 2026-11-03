// Saved accounts, as T3's extra Claude and Codex instances: each one is a home folder of the CLI's own, passed as
// CLAUDE_CONFIG_DIR (not HOME, which would hide the macOS Keychain login) or CODEX_HOME. Default is the CLI's own
// home, with no variable set. Shared "limits.accounts" holds paths, never credentials:
//   { claude: { active: "<id>" | null, accounts: [{ id, label, home }] }, codex: { ... } }
// Copied in t3-limits and t3-new-menu (a mod can't import another's file); check-limits.cjs fails if they differ.
import { appHome } from "herdr";

export const ACCOUNT_ENV = { claude: "CLAUDE_CONFIG_DIR", codex: "CODEX_HOME" };

export function accountsDir(provider) {
  return `${appHome()}/data/t3-limits/accounts/${provider}`;
}

// Shared state is anyone's to write: an entry counts only if it names t3-limits' own folder for its id.
export function validAccount(provider, a) {
  return Boolean(ACCOUNT_ENV[provider]) && typeof a?.id === "string" && /^[a-z0-9-]+$/.test(a.id)
    && a.home === `${accountsDir(provider)}/${a.id}`;
}

// The account new agents of `provider` start with, or null for Default.
export function activeAccount(store, provider) {
  const s = store?.[provider];
  return (s?.active && s.accounts?.find((a) => a.id === s.active && validAccount(provider, a))) || null;
}

// argv run in an account's home; Default, or an entry that isn't valid, runs it as it is.
export function accountArgv(provider, account, argv) {
  return validAccount(provider, account) ? ["env", `${ACCOUNT_ENV[provider]}=${account.home}`, ...argv] : argv;
}
