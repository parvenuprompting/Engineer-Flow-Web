'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

/** Systeem → licht → donker, en dan weer rond. */
const ORDE = ['system', 'light', 'dark'] as const;
type Keuze = (typeof ORDE)[number];

const LABELS: Record<Keuze, string> = {
  system: 'Systeemthema',
  light: 'Licht thema',
  dark: 'Donker thema',
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <Button variant="ghost" size="icon" aria-label="Thema wisselen" disabled />;
  }

  const huidig: Keuze = (ORDE as readonly string[]).includes(theme ?? '') ? (theme as Keuze) : 'system';
  const volgende = ORDE[(ORDE.indexOf(huidig) + 1) % ORDE.length];
  const Icon = huidig === 'system' ? Monitor : huidig === 'light' ? Sun : Moon;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`${LABELS[huidig]} — klik voor ${LABELS[volgende].toLowerCase()}`}
      title={`${LABELS[huidig]} — volgende: ${LABELS[volgende]}`}
      onClick={() => setTheme(volgende)}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
