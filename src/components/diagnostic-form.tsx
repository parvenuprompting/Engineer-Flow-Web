"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Image from "next/image";
import { createCase, diagnose } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/ui/glass-card";
import { UploadCloud, X, Loader2, Zap, Settings, CloudRain, Snowflake, Weight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { DiagnoseResponse } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const formSchema = z.object({
  symptomDescription: z
    .string()
    .min(10, { message: "Symptoombeschrijving moet minimaal 10 karakters bevatten." })
    .max(2000, { message: "Symptoombeschrijving mag niet meer dan 2000 karakters bevatten." }),
  photoDataUri: z.string().optional(),
});

type DiagnosticFormProps = {
  setResult: (result: DiagnoseResponse | null, symptom?: string, photo?: string | null, caseId?: string | null) => void;
  setError: (error: string | null) => void;
  isPending: boolean;
  startTransition: React.TransitionStartFunction;
  initialSymptom?: string;
  caseId?: string | null;
  onCaseIdChange?: (caseId: string | null) => void;
};

export function DiagnosticForm({
  setResult,
  setError,
  isPending,
  startTransition,
  initialSymptom,
  caseId,
  onCaseIdChange,
}: DiagnosticFormProps) {
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      symptomDescription: initialSymptom || "",
    },
  });

  // Context state
  const [context, setContext] = useState({
    motor_on: true,
    pto_on: false,
    rain: false,
    frost: false,
    heavy_load: false,
  });

  const toggleContext = (key: keyof typeof context) => {
    setContext(prev => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    if (initialSymptom) {
      form.setValue('symptomDescription', initialSymptom);
    }
  }, [initialSymptom, form]);


  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 4 * 1024 * 1024) { // 4MB limit
        form.setError("photoDataUri", { type: "manual", message: "Afbeelding moet kleiner zijn dan 4MB." });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUri = reader.result as string;
        form.setValue("photoDataUri", dataUri, { shouldValidate: true });
        setPhotoPreview(dataUri);
      };
      reader.readAsDataURL(file);
    }
  };

  const removePhoto = () => {
    form.setValue("photoDataUri", undefined);
    setPhotoPreview(null);
    const fileInput = document.getElementById('photo-upload') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  };

  function onSubmit(values: z.infer<typeof formSchema>) {
    startTransition(async () => {
      setError(null);
      setResult(null);

      let resolvedCaseId = caseId;
      if (!resolvedCaseId) {
        const caseRes = await createCase("TRUCK-MVP-01");
        if (caseRes.data) {
          resolvedCaseId = caseRes.data.case_id;
          onCaseIdChange?.(resolvedCaseId);
        }
      }

      // Map form values to Python backend API request format
      const apiResponse = await diagnose({
        symptom_text: values.symptomDescription,
        photo_data_uri: values.photoDataUri,
        context: context,
        case_id: resolvedCaseId || undefined,
      });

      if (apiResponse.error) {
        setError(apiResponse.error);
        toast({
          variant: "destructive",
          title: "Diagnose Mislukt",
          description: apiResponse.error,
        });
      }
      if (apiResponse.data) {
        setResult(apiResponse.data, values.symptomDescription, values.photoDataUri);
      }
    });
  }

  return (
    <GlassCard variant="premium" blur="md" elevation={2} className="shadow-elevation-3 animate-fade-in">
      <div className="p-6 space-y-8">
        <div className="space-y-2">
          <h2 className="text-2xl font-display font-bold tracking-tight">Diagnose Tool</h2>
          <p className="text-sm text-muted-foreground">
            Beschrijf de symptomen en voeg optioneel een foto toe voor een nauwkeurige analyse.
          </p>
        </div>

        {/* Modern Context Bar */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-primary animate-spin-slow" />
            <h3 className="text-sm font-semibold">Context & Omstandigheden</h3>
          </div>
          <div className="flex flex-wrap gap-2 p-4 bg-gradient-to-r from-primary/5 to-accent/5 rounded-xl backdrop-blur-sm border border-primary/10">
            {[
              { key: 'motor_on' as const, icon: Zap, label: 'Motor' },
              { key: 'pto_on' as const, icon: Settings, label: 'PTO' },
              { key: 'rain' as const, icon: CloudRain, label: 'Regen' },
              { key: 'frost' as const, icon: Snowflake, label: 'Vorst' },
              { key: 'heavy_load' as const, icon: Weight, label: 'Zware last' },
            ].map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleContext(key)}
                className={cn(
                  "px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-200",
                  "flex items-center gap-2 border-2",
                  "hover:scale-105 active:scale-95",
                  context[key]
                    ? "bg-primary text-primary-foreground border-primary shadow-glow-primary"
                    : "bg-background/50 text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="symptomDescription"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-semibold">Symptoombeschrijving</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="bijv., De machine maakt een luid knarsend geluid bij het opstarten..."
                      className="min-h-[150px] resize-y bg-background/50 backdrop-blur-sm"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="photoDataUri"
              render={({ fieldState }) => (
                <FormItem>
                  <FormLabel className="text-sm font-semibold">Foto uploaden (optioneel)</FormLabel>
                  <FormControl>
                    <div className="space-y-4">
                      <label htmlFor="photo-upload" className="cursor-pointer block group">
                        <div
                          className={cn(
                            "relative border-2 border-dashed rounded-xl p-8 transition-all duration-300",
                            "bg-gradient-to-br from-primary/5 to-accent/5 overflow-hidden",
                            "hover:border-primary/50 hover:bg-primary/10",
                            photoPreview ? "border-primary" : "border-border"
                          )}
                        >
                          <div className="flex flex-col items-center justify-center pt-5 pb-6 relative z-10">
                            <UploadCloud className="w-10 h-10 mb-3 text-primary/60 group-hover:scale-110 transition-transform duration-300" />
                            <p className="mb-2 text-sm text-foreground/80">
                              <span className="font-bold text-primary">Klik om te uploaden</span> of sleep en zet neer
                            </p>
                            <p className="text-xs text-muted-foreground">PNG, JPG, of WEBP (MAX. 4MB)</p>
                          </div>
                          {/* Animated background glow */}
                          <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                        </div>
                      </label>
                      <Input
                        id="photo-upload"
                        type="file"
                        className="hidden"
                        accept="image/png, image/jpeg, image/webp"
                        onChange={handlePhotoChange}
                      />
                    </div>
                  </FormControl>
                  <FormMessage>{fieldState.error?.message}</FormMessage>
                </FormItem>
              )}
            />

            {photoPreview && (
              <div className="relative w-full h-56 rounded-xl overflow-hidden border-2 border-primary/20 shadow-elevation-2 animate-fade-in-scale">
                <Image src={photoPreview} alt="Voorbeeld van foto" fill style={{ objectFit: "cover" }} />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-3 right-3 h-8 w-8 shadow-lg hover:scale-110 active:scale-90 transition-all"
                  onClick={removePhoto}
                  type="button"
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Verwijder foto</span>
                </Button>
              </div>
            )}

            <Button
              type="submit"
              disabled={isPending}
              size="lg"
              className="w-full text-base font-bold tracking-wide shadow-glow-primary animate-pulse-glow"
            >
              {isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Zap className="mr-2 h-5 w-5" />}
              Start Analyse
            </Button>
          </form>
        </Form>
      </div>
    </GlassCard>
  );
}
