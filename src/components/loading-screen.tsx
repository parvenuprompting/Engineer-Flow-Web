"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export function LoadingScreen() {
  const [progress, setProgress] = useState(13);

  useEffect(() => {
    const timer = setTimeout(() => setProgress(62), 500);
    const timer2 = setTimeout(() => setProgress(100), 1500);
    return () => {
      clearTimeout(timer);
      clearTimeout(timer2);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 bg-cover bg-center"
      style={{ backgroundImage: "url('https://i.imgur.com/EmYFnWM.png')" }}
    >
      <div className="fixed inset-0 z-10 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm text-foreground">
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="relative">
            <div className="absolute -top-4 -right-4">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
            <div className="p-4 bg-primary/10 rounded-lg border-2 border-primary/20">
              <Image src="https://i.imgur.com/WlSEJ5L.png" alt="Engineer Flow Logo" width={48} height={48} className="h-12 w-12" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold">Engineer Flow</h1>
            <p className="text-muted-foreground">
              Intelligente Diagnostiek Platform
            </p>
          </div>
          <div className="w-64 space-y-2">
            <Progress value={progress} className="w-full h-2" />
            <p className="text-xs text-muted-foreground">
              Modules laden... {progress}%
            </p>
          </div>
          <div className="absolute bottom-4 text-xs text-muted-foreground/80">
            © Tiëndo Welles
          </div>
        </div>
      </div>
    </div>
  );
}
