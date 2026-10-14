'use client';

/**
 * Stille achtergrond in de huisstijl: één subtiel blueprint-raster met een
 * zachte doof voor de leesbaarheid. Geen beweging, geen gloed, geen vignet —
 * het scherm moet rustig en industrieel blijven (licht én donker).
 */
export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none bg-background">
      {/* Machined blueprint grid */}
      <div className="absolute inset-0 bg-blueprint-grid opacity-40 dark:opacity-30" />

      {/* Doof naar onderen, zodat tekst altijd op een rustige ondergrond staat */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/40 to-background" />
    </div>
  );
}
