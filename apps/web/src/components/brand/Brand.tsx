import { useEffect, useId, useState } from 'react';
import { BrandLockup, BrandMarkGlyph } from './Lockup';

/**
 * The brand lockup.
 *
 * Prefers real artwork from `public/brand/`, falling back to the inline vector
 * lockup when none is present. Candidates are tried in quality order, so
 * dropping a proper SVG later supersedes the current raster without a code
 * change.
 */

const LOGO_CANDIDATES = [
  '/brand/logo.svg',
  '/brand/logo.png',
  '/brand/logo.jpeg',
  '/brand/logo.jpg',
  '/brand/new_logo.jpeg',
];

const DARK_CANDIDATES = ['/brand/logo-dark.svg', '/brand/logo-dark.png'];
const MARK_CANDIDATES = ['/brand/mark.svg', '/brand/mark.png'];

/**
 * Whether a URL really points at an image.
 *
 * Checks the content type, not just the status. A dev server with SPA fallback
 * answers 200 with `text/html` for any unknown path, so `response.ok` alone
 * reports every missing file as present.
 */
async function resolveImage(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok && (response.headers.get('content-type') ?? '').startsWith('image/');
  } catch {
    return false;
  }
}

// Resolved once per session; the sidebar remounts on every navigation and must
// not re-probe each time.
const resolutionCache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

function useResolvedAsset(candidates: string[]): { url: string | null; settled: boolean } {
  const key = candidates.join('|');
  const [state, setState] = useState<{ url: string | null; settled: boolean }>(() =>
    resolutionCache.has(key)
      ? { url: resolutionCache.get(key) ?? null, settled: true }
      : { url: null, settled: false },
  );

  useEffect(() => {
    if (resolutionCache.has(key)) {
      setState({ url: resolutionCache.get(key) ?? null, settled: true });
      return;
    }

    let cancelled = false;

    // Share one probe across every component mounted this tick.
    let promise = inFlight.get(key);
    if (!promise) {
      promise = (async () => {
        for (const candidate of candidates) {
          if (await resolveImage(candidate)) return candidate;
        }
        return null;
      })().then((found) => {
        resolutionCache.set(key, found);
        inFlight.delete(key);
        return found;
      });
      inFlight.set(key, promise);
    }

    void promise.then((found) => {
      if (!cancelled) setState({ url: found, settled: true });
    });

    return () => {
      cancelled = true;
    };
  }, [key, candidates]);

  return state;
}

/**
 * Which ground the logo sits on.
 *
 * Not the same as the theme: the sidebar is dark in both light and dark mode, so
 * a theme check would get it wrong half the time. Supplied artwork is usually
 * black-on-white with no transparency, and the CSS uses this to knock the白
 * background out against whichever ground it is actually on.
 */
export type BrandSurface = 'dark' | 'light' | 'auto';

export function BrandLogo({
  height,
  surface = 'auto',
  showTagline = false,
  className = '',
  title = 'Goyal & Co. | Hariyana Group',
}: {
  height?: number;
  surface?: BrandSurface;
  showTagline?: boolean;
  className?: string;
  title?: string;
}) {
  const titleId = useId();
  const logo = useResolvedAsset(LOGO_CANDIDATES);
  const dark = useResolvedAsset(DARK_CANDIDATES);

  if (logo.url) {
    // A purpose-made dark file always beats knocking out the background.
    const src = surface === 'dark' && dark.url ? dark.url : logo.url;
    const needsKnockout = !(surface === 'dark' && dark.url);

    return (
      <img
        src={src}
        alt={title}
        className={`brand-logo brand-logo--raster ${className}`}
        data-surface={needsKnockout ? surface : undefined}
        style={height ? { height, width: 'auto' } : undefined}
        draggable={false}
      />
    );
  }

  // Inline default, also shown while probing so nothing flashes empty.
  return (
    <BrandLockup
      showTagline={showTagline}
      titleId={titleId}
      className={`brand-logo brand-logo--inline ${className}`}
    />
  );
}

/**
 * Square mark for tight spaces — the mobile header.
 *
 * Falls back to the inline glyph rather than squashing the wide lockup, which
 * would render it unreadably small in a 30px slot.
 */
export function BrandMark({ size = 32, surface = 'auto' }: { size?: number; surface?: BrandSurface }) {
  const mark = useResolvedAsset(MARK_CANDIDATES);

  if (mark.url) {
    return (
      <img
        src={mark.url}
        alt=""
        className="brand-logo brand-logo--raster brand-mark"
        data-surface={surface}
        style={{ width: size, height: size }}
        draggable={false}
      />
    );
  }

  return <BrandMarkGlyph className="brand-mark" />;
}
