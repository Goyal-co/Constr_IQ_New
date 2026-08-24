/**
 * Brand lockup — Goyal & Co. | Hariyana Group.
 *
 * A vector reconstruction, drawn inline rather than loaded as an image for one
 * concrete reason: an SVG referenced through `<img>` is an isolated document and
 * cannot see `currentColor`, so a single file could not sit correctly on both
 * the dark sidebar and the light sign-in panel. Inline, the wordmarks inherit
 * the surrounding text colour and both themes work from one source.
 *
 * The two accents are fixed hex — they are brand colours, not text, and must not
 * follow the theme.
 *
 * Every text run carries an explicit `textLength`. Without it the layout depends
 * on which font actually loaded, and a fallback wider than Inter pushes the
 * wordmark past the viewBox and clips it. Pinning the widths makes the lockup
 * render identically whatever resolves, at the cost of slightly looser tracking
 * when a fallback is in use — `lengthAdjust="spacing"` keeps the letterforms
 * themselves undistorted.
 *
 * This is a reconstruction: the wordmarks are set in the app's typeface rather
 * than the original licensed one. For exact fidelity drop the real artwork at
 * `public/brand/logo.svg` and it takes precedence automatically — see
 * `public/brand/README.md`.
 */

const AMBER = '#F5A623';
const CYAN = '#29ABE2';

const FONT = "'Inter var','Inter',system-ui,-apple-system,'Segoe UI',sans-serif";

export function BrandLockup({
  showTagline = true,
  className,
  titleId,
}: {
  showTagline?: boolean;
  className?: string;
  titleId?: string;
}) {
  // Cropping the viewBox rather than hiding the tagline keeps the lockup
  // vertically centred in tight rows instead of leaving dead space beneath it.
  const viewBox = showTagline ? '0 0 1960 470' : '0 0 1960 330';

  return (
    <svg
      viewBox={viewBox}
      className={className}
      role="img"
      aria-labelledby={titleId}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title id={titleId}>Goyal &amp; Co. | Hariyana Group — creating landmarks since 1971</title>

      {/* --- Orbit device -------------------------------------------------
          Two ellipse subpaths under evenodd make a true ring, so it works on
          any background. The inner ellipse is offset up and right, which gives
          the stroke its heavier lower-left sweep. */}
      <g transform="rotate(-20 232 188)">
        <path
          fillRule="evenodd"
          d="M 78,188 a 154,68 0 1,0 308,0 a 154,68 0 1,0 -308,0
             M 116,180 a 118,42 0 1,0 236,0 a 118,42 0 1,0 -236,0"
        />
      </g>
      <path d="M 128,118 L 168,103 L 174,154 L 136,169 Z" fill={AMBER} />

      {/* --- Goyal & Co. --------------------------------------------------- */}
      <text
        x="428"
        y="236"
        textLength="404"
        lengthAdjust="spacing"
        fontFamily={FONT}
        fontSize="188"
        fontWeight="600"
      >
        Goyal
      </text>
      <text
        x="690"
        y="288"
        textLength="146"
        lengthAdjust="spacing"
        fontFamily={FONT}
        fontSize="64"
        fontWeight="600"
      >
        &amp;Co.
      </text>

      {/* --- Divider ------------------------------------------------------- */}
      <rect x="884" y="82" width="5" height="214" opacity="0.9" />

      {/* --- Hariyana H mark ----------------------------------------------- */}
      <rect x="940" y="92" width="188" height="188" />
      <rect x="973" y="125" width="122" height="122" fill="#FFFFFF" />
      <rect x="989" y="125" width="26" height="122" />
      <rect x="1053" y="125" width="26" height="122" />
      <rect x="989" y="172" width="90" height="27" />
      {/* Arrow sits over the H, sweeping up to the right. */}
      <path d="M 980,214 L 1096,149 L 1050,207 Z" fill={CYAN} />

      {/* --- Hariyana Group ------------------------------------------------ */}
      <text
        x="1178"
        y="236"
        textLength="700"
        lengthAdjust="spacing"
        fontFamily={FONT}
        fontSize="188"
        fontWeight="600"
      >
        Hariyana
      </text>
      <text
        x="1182"
        y="288"
        textLength="196"
        lengthAdjust="spacing"
        fontFamily={FONT}
        fontSize="64"
        fontWeight="600"
      >
        Group
      </text>

      {/* --- Tagline -------------------------------------------------------- */}
      {showTagline && (
        <text
          x="980"
          y="428"
          textAnchor="middle"
          textLength="1120"
          lengthAdjust="spacing"
          fontFamily={FONT}
          fontSize="84"
          fontWeight="400"
        >
          creating landmarks since 1971
        </text>
      )}
    </svg>
  );
}

/**
 * Square mark for tight spaces.
 *
 * The counters are cut out with `fill-rule="evenodd"` rather than painted white.
 * A white plate only works on a light background — in dark mode the strokes and
 * the plate both resolve light and the H disappears. Cutting real holes lets the
 * mark sit on any ground.
 */
export function BrandMarkGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 192 192"
      className={className}
      role="img"
      aria-hidden="true"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        d="M0 12a12 12 0 0 1 12-12h168a12 12 0 0 1 12 12v168a12 12 0 0 1-12 12H12a12 12 0 0 1-12-12z
           M34 34h16v124H34z
           M142 34h16v124h-16z
           M77 34h38v48H77z
           M77 110h38v48H77z"
      />
      <path d="M 41,124 L 160,57 L 112,117 Z" fill={CYAN} />
    </svg>
  );
}
