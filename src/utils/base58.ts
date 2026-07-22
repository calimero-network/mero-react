/**
 * Minimal Base58 (Bitcoin alphabet) decoder.
 *
 * Blob ids come back from the admin API Base58-encoded, while a namespace's
 * `appKey` is a hex string, so comparing "what's installed" to "what the group
 * targets" needs one side converted. Decoding Base58 to canonical lowercase hex
 * is the smaller, encoding-agnostic conversion.
 */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Decode a Base58 string to a lowercase hex string (no `0x` prefix). Leading
 * `1` characters map to leading zero bytes, so the byte width is preserved.
 * Throws on any character outside the Base58 alphabet.
 */
export function base58ToHex(input: string): string {
  const bytes: number[] = [];
  for (const char of input) {
    let carry = ALPHABET.indexOf(char);
    if (carry === -1) throw new Error(`invalid base58 character: ${char}`);
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; k < input.length && input[k] === '1'; k++) bytes.push(0);
  return bytes
    .reverse()
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
