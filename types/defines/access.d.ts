/**
 * Represents the identity of a user authenticated via Cloudflare Access.
 * This matches the result of calling /cdn-cgi/access/get-identity.
 */
type CloudflareAccessIdentity = object;

/**
 * Cloudflare Access authentication information for the current request.
 */
interface CloudflareAccessContext {
  /**
   * The audience claim from the Access JWT. This identifies which Access
   * application the request matched.
   */
  readonly aud: string;

  /**
   * Fetches the full identity information for the authenticated user.
   *
   * @returns The subject's identity, if one exists
   */
  getIdentity(): Promise<CloudflareAccessIdentity | undefined>;
}
