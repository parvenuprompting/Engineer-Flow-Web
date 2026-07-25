"use client";

import React from 'react';
import Image from 'next/image';

export function AnimatedBackground() {
    return (
        <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
            {/* The Animated Image Container */}
            <div className="absolute inset-[-10%] w-[120%] h-[120%] animate-ken-burns">
                <Image
                    src="/background.png"
                    alt="Background"
                    fill
                    priority
                    className="object-cover opacity-100"
                />
            </div>

            {/* Light Mode Overlay (10% more background visibility) */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/80 via-white/70 to-white/65 dark:hidden" />

            {/* Dark Mode Overlay (10% more background visibility) */}
            <div className="absolute inset-0 hidden dark:block bg-gradient-to-b from-slate-950/80 via-slate-900/75 to-slate-950/80" />

            {/* Additional Grain/Vignette for depth */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.1)_100%)] pointer-events-none" />
        </div>
    );
}
