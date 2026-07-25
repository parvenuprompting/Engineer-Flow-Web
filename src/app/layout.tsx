import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import Image from 'next/image';
import { FirebaseClientProvider } from '@/firebase';
import { AnimatedBackground } from '@/components/ui/animated-background';

export const metadata: Metadata = {
  title: 'Engineer Flow',
  description: 'AI-aangedreven diagnostische engine voor machine-ingenieurs',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl" className="dark">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased text-foreground flex flex-col min-h-screen">
        <AnimatedBackground />
        <FirebaseClientProvider>
          <main className="flex-grow">
            {children}
          </main>
          <footer className="py-4 text-center text-xs text-muted-foreground">
            © Engineer Flow
          </footer>
          <Toaster />
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
