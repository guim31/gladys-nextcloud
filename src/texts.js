// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, the state
// texts of the device and the toasts. Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks
// every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './nextcloud/client.js';

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;

/** A number the way the language writes it ("29,6" in French, "1 234"). */
export const formatNumber = (value, language, digits = 0) =>
  new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(value);

// Byte units: French writes octets (Go), the other three bytes (GB).
const BYTE_UNITS = {
  en: ['B', 'kB', 'MB', 'GB', 'TB', 'PB'],
  fr: ['o', 'ko', 'Mo', 'Go', 'To', 'Po'],
  de: ['B', 'kB', 'MB', 'GB', 'TB', 'PB'],
  es: ['B', 'kB', 'MB', 'GB', 'TB', 'PB'],
};

/**
 * A size the way the language writes it, in decimal units like Nextcloud's
 * own pages: "29,6 Go", "1.4 MB".
 * @returns {{ value: string, unit: string, text: string }}
 */
export function formatBytes(bytes, language) {
  const units = BYTE_UNITS[language] ?? BYTE_UNITS.en;
  let value = bytes;
  let index = 0;
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000;
    index += 1;
  }
  const digits = value >= 100 || index === 0 ? 0 : 1;
  const number = formatNumber(value, language, digits);
  return { value: number, unit: units[index], text: `${number} ${units[index]}` };
}

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noServer: {
    en: 'Enter the address of your Nextcloud and a serverinfo token or an app password in the configuration.',
    fr: "Saisissez l'adresse de votre Nextcloud et un jeton serverinfo ou un mot de passe d'application dans la configuration.",
    de: 'Gib die Adresse deiner Nextcloud und ein serverinfo-Token oder ein App-Passwort in der Konfiguration ein.',
    es: 'Introduzca la dirección de su Nextcloud y un token de serverinfo o una contraseña de aplicación en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. https://cloud.example.com',
    fr: 'Adresse incomprise, ex. https://cloud.example.com',
    de: 'Adresse nicht verstanden, z. B. https://cloud.example.com',
    es: 'Dirección no válida, p. ej. https://cloud.example.com',
  },
  missingAuth: {
    en: 'Enter a serverinfo token, or an administrator account and its app password.',
    fr: "Saisissez un jeton serverinfo, ou un compte administrateur et son mot de passe d'application.",
    de: 'Gib ein serverinfo-Token ein, oder ein Administratorkonto und sein App-Passwort.',
    es: 'Introduzca un token de serverinfo, o una cuenta de administrador y su contraseña de aplicación.',
  },
};

// One short explanation per error kind (src/nextcloud/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'token, login or app password refused',
    fr: "jeton, identifiant ou mot de passe d'application refusé",
    de: 'Token, Benutzername oder App-Passwort abgelehnt',
    es: 'token, usuario o contraseña de aplicación rechazado',
  },
  [ERROR_KINDS.NOT_ADMIN]: {
    en: 'this account is not an administrator: use an admin account or the serverinfo token',
    fr: "ce compte n'est pas administrateur : utilisez un compte admin ou le jeton serverinfo",
    de: 'dieses Konto ist kein Administrator: Nutze ein Admin-Konto oder das serverinfo-Token',
    es: 'esta cuenta no es administradora: use una cuenta admin o el token de serverinfo',
  },
  [ERROR_KINDS.THROTTLED]: {
    en: 'too many failed attempts, Nextcloud blocks Gladys for now',
    fr: 'trop de tentatives échouées, Nextcloud bloque Gladys pour le moment',
    de: 'zu viele Fehlversuche, Nextcloud blockiert Gladys vorerst',
    es: 'demasiados intentos fallidos, Nextcloud bloquea Gladys por ahora',
  },
  [ERROR_KINDS.NO_SERVERINFO]: {
    en: 'the "Monitoring" app (serverinfo) is disabled',
    fr: "l'application « Monitoring » (serverinfo) est désactivée",
    de: 'die App „Monitoring“ (serverinfo) ist deaktiviert',
    es: 'la aplicación «Monitoring» (serverinfo) está desactivada',
  },
  [ERROR_KINDS.MAINTENANCE]: {
    en: 'in maintenance mode',
    fr: 'en mode maintenance',
    de: 'im Wartungsmodus',
    es: 'en modo de mantenimiento',
  },
  [ERROR_KINDS.SERVER_ERROR]: {
    en: 'server error (PHP, database or reverse proxy)',
    fr: 'erreur du serveur (PHP, base de données ou proxy inverse)',
    de: 'Serverfehler (PHP, Datenbank oder Reverse Proxy)',
    es: 'error del servidor (PHP, base de datos o proxy inverso)',
  },
  [ERROR_KINDS.NOT_NEXTCLOUD]: {
    en: 'no Nextcloud at this address: check the address and its path',
    fr: "pas de Nextcloud à cette adresse : vérifiez l'adresse et son chemin",
    de: 'keine Nextcloud unter dieser Adresse: Prüfe die Adresse und ihren Pfad',
    es: 'no hay Nextcloud en esta dirección: compruebe la dirección y su ruta',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'redirects to another address: enter the final one',
    fr: "redirige vers une autre adresse : saisissez l'adresse finale",
    de: 'leitet auf eine andere Adresse um: Gib die endgültige ein',
    es: 'redirige a otra dirección: introduzca la dirección final',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, check the address',
    fr: "réponse inattendue, vérifiez l'adresse",
    de: 'unerwartete Antwort, prüfe die Adresse',
    es: 'respuesta inesperada, compruebe la dirección',
  },
};

// The text feature "Memory cache" when Nextcloud has none configured.
export const CACHE_NONE = {
  en: 'None',
  fr: 'Aucun',
  de: 'Keiner',
  es: 'Ninguna',
};

// "Test the connection".
export const REPORT_TEXT = {
  en: {
    ok: (version) => `Nextcloud ${version} answers`,
    users: (count) => `${count} user(s)`,
    files: (count) => `${count} file(s)`,
    free: (size) => `${size} free`,
    update: (version) => `update ${version} available`,
    upToDate: 'up to date',
    apps: (count) => `${count} app update(s)`,
    token: 'read with the serverinfo token',
    account: (user) => `read as ${user}`,
  },
  fr: {
    ok: (version) => `Nextcloud ${version} répond`,
    users: (count) => `${count} utilisateur(s)`,
    files: (count) => `${count} fichier(s)`,
    free: (size) => `${size} libres`,
    update: (version) => `mise à jour ${version} disponible`,
    upToDate: 'à jour',
    apps: (count) => `${count} mise(s) à jour d'applis`,
    token: 'lu avec le jeton serverinfo',
    account: (user) => `lu en tant que ${user}`,
  },
  de: {
    ok: (version) => `Nextcloud ${version} antwortet`,
    users: (count) => `${count} Benutzer`,
    files: (count) => `${count} Datei(en)`,
    free: (size) => `${size} frei`,
    update: (version) => `Update ${version} verfügbar`,
    upToDate: 'aktuell',
    apps: (count) => `${count} App-Update(s)`,
    token: 'gelesen mit dem serverinfo-Token',
    account: (user) => `gelesen als ${user}`,
  },
  es: {
    ok: (version) => `Nextcloud ${version} responde`,
    users: (count) => `${count} usuario(s)`,
    files: (count) => `${count} archivo(s)`,
    free: (size) => `${size} libres`,
    update: (version) => `actualización ${version} disponible`,
    upToDate: 'actualizado',
    apps: (count) => `${count} actualización(es) de apps`,
    token: 'leído con el token de serverinfo',
    account: (user) => `leído como ${user}`,
  },
};

// Widget toasts.
export const DONE_TEXT = {
  en: { refreshed: 'Nextcloud read again' },
  fr: { refreshed: 'Nextcloud relu' },
  de: { refreshed: 'Nextcloud neu gelesen' },
  es: { refreshed: 'Nextcloud leído de nuevo' },
};
