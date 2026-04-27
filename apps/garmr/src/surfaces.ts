/**
 * The 4 platform surfaces Garmr watches. Health endpoints all return
 * 200 healthy / 503 unhealthy.
 *
 * Adding a new surface = add a row here. No other change needed.
 */

export interface Surface {
  /** Display name */
  name: string;
  /** URL to ping (must respond 200 healthy / non-200 unhealthy) */
  healthUrl: string;
  /** Where to send the user when they tap the surface card */
  visitUrl: string;
}

export const SURFACES: Surface[] = [
  {
    name: "Store Ops",
    healthUrl: "https://www.afterroar.store/api/health",
    visitUrl: "https://www.afterroar.store",
  },
  {
    name: "Passport",
    healthUrl: "https://www.afterroar.me/api/health",
    visitUrl: "https://www.afterroar.me",
  },
  {
    name: "Game Night HQ",
    healthUrl: "https://hq.fulluproar.com/api/health",
    visitUrl: "https://hq.fulluproar.com",
  },
  {
    name: "FU Site",
    healthUrl: "https://www.fulluproar.com/api/health?basic=true",
    visitUrl: "https://www.fulluproar.com",
  },
];
