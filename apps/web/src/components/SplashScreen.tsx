import { APP_BASE_NAME } from "../branding";

/**
 * Post-mount splash. Uses a brand-neutral inline "M" mark (sand-style dark
 * rounded square) rather than /apple-touch-icon.png, which is still the T3
 * blueprint logo (flagged for designer). Matches the pre-mount boot shell in
 * index.html so the brand stays consistent across the whole boot sequence.
 */
export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="flex size-24 items-center justify-center"
        aria-label={`${APP_BASE_NAME} splash screen`}
      >
        <svg
          className="size-16"
          viewBox="0 0 64 64"
          fill="none"
          role="img"
          aria-label={APP_BASE_NAME}
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect x="1" y="1" width="62" height="62" rx="14" fill="#181818" stroke="#393939" />
          <rect x="1.5" y="1.5" width="61" height="30" rx="13.5" fill="rgba(255,255,255,0.04)" />
          <path
            d="M17 45V22.5C17 21.12 18.12 20 19.5 20C20.62 20 21.63 20.68 22.05 21.72L32 45.5L41.95 21.72C42.37 20.68 43.38 20 44.5 20C45.88 20 47 21.12 47 22.5V45"
            stroke="#F0F0F0"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}
