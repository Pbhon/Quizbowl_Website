/** Return categories only: never echo matching credential material. */
export function credentialIndicators(source) {
  const indicators = [];
  if (/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(source))
    indicators.push("private key");
  if (/AIza[0-9A-Za-z_-]{35}/.test(source)) indicators.push("Google API key");
  if (/\bAQ\.[0-9A-Za-z_-]{40,}\b/.test(source))
    indicators.push("Google authorization key");
  return indicators;
}
