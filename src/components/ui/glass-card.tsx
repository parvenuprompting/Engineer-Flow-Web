import * as React from 'react';
import { cn } from '@/lib/utils';

export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: 'default' | 'premium' | 'subtle';
    blur?: 'sm' | 'md' | 'lg';
    elevation?: 1 | 2 | 3 | 4;
}

const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
    ({ className, variant = 'default', blur = 'md', elevation = 2, children, ...props }, ref) => {
        const variantStyles = {
            default: 'bg-card/80 border-border/50',
            premium: 'bg-gradient-to-br from-card/90 to-card/70 border-primary/20',
            subtle: 'bg-card/60 border-border/30',
        };

        const blurStyles = {
            sm: 'backdrop-blur-sm',
            md: 'backdrop-blur-md',
            lg: 'backdrop-blur-lg',
        };

        const elevationStyles = {
            1: 'shadow-elevation-1',
            2: 'shadow-elevation-2',
            3: 'shadow-elevation-3',
            4: 'shadow-elevation-4',
        };

        return (
            <div
                ref={ref}
                className={cn(
                    'rounded-lg border transition-all duration-300',
                    'hover:shadow-glass-lg hover:scale-[1.01]',
                    variantStyles[variant],
                    blurStyles[blur],
                    elevationStyles[elevation],
                    className
                )}
                {...props}
            >
                {children}
            </div>
        );
    }
);

GlassCard.displayName = 'GlassCard';

export { GlassCard };
