
"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UploadCloud, X, Loader2, HardDrive, AlertTriangle, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { runCanAnalysis } from "@/app/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { publicFeatures } from "@/lib/features";

const formSchema = z.object({
  logFile: z
    .any()
    .refine((files) => files?.length == 1, "Logbestand is verplicht.")
    .refine(
      (files) => files?.[0]?.size <= 10 * 1024 * 1024,
      `Maximale bestandsgrootte is 10MB.`
    )
     .refine(
      (files) => ["application/vnd.ms-excel", "text/csv", "application/octet-stream", "text/plain"].includes(files?.[0]?.type) || files?.[0]?.name.endsWith('.blf') || files?.[0]?.name.endsWith('.asc') || files?.[0]?.name.endsWith('.csv') || files?.[0]?.name.endsWith('.log'),
      "Ongeldig bestandstype. Upload .blf, .asc, .csv, of .log"
    ),
  vehicleId: z.string().min(1, "Voertuig ID is verplicht."),
});

export default function CanAnalysisPage() {
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  if (!publicFeatures.canAnalysis) {
    return (
      <div className="container mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center p-4 md:p-8">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>CAN-analyse nog niet beschikbaar</AlertTitle>
          <AlertDescription>
            Deze functie wordt opnieuw geactiveerd zodra de echte CAN-analyse-engine en de bijbehorende gegevensbeveiliging
            klaar zijn. Gebruik voorlopig de Diagnose Tool voor symptoomanalyse.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      vehicleId: "TRUCK-MVP-01",
    },
  });

  const fileRef = form.register("logFile");

  function onSubmit(values: z.infer<typeof formSchema>) {
    startTransition(async () => {
      setError(null);
      setResult(null);

      const formData = new FormData();
      formData.append("logFile", values.logFile[0]);
      formData.append("vehicleId", values.vehicleId);

      const { data, error } = await runCanAnalysis(formData);
      if (error) {
        setError(error);
        toast({
          variant: "destructive",
          title: "CAN Analyse Mislukt",
          description: error,
        });
      }
      if (data) {
        setResult(data);
      }
    });
  }

  return (
    <div className="container mx-auto p-4 md:p-8">
      <div className="mb-6">
        <Link href="/" passHref>
          <Button variant="outline">
            <ArrowLeft className="mr-2" />
            Terug naar Home
          </Button>
        </Link>
      </div>
      
       <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Demo Functionaliteit</AlertTitle>
          <AlertDescription>
            Deze CAN-analyse is een UI-demonstratie. De EFL-CORE engine draait extern in Python en is niet functioneel gekoppeld aan deze interface. De getoonde resultaten zijn gesimuleerd.
          </AlertDescription>
        </Alert>

      <div className="grid lg:grid-cols-2 gap-8 items-start">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
                <HardDrive />
                CAN Logfile Analyse
            </CardTitle>
            <CardDescription>
              Upload een CAN-logbestand (.blf, .asc, .csv, .log) en voer een voertuig-ID in om de analyse te starten met de EFL-CORE engine.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
              >
                <FormField
                  control={form.control}
                  name="vehicleId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Voertuig ID</FormLabel>
                      <FormControl>
                        <Input placeholder="bijv., TRUCK-123" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="logFile"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Logbestand</FormLabel>
                      <FormControl>
                        <Input type="file" accept=".blf,.asc,.csv,.log" {...fileRef} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" disabled={isPending} className="w-full">
                  {isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Start Analyse
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <div className="lg:sticky top-24">
          {isPending && (
            <Card className="flex flex-col items-center justify-center h-96 shadow-lg border animate-pulse">
              <Loader2 className="h-16 w-16 animate-spin text-primary" />
              <p className="mt-4 text-lg font-semibold">Analyse uitvoeren...</p>
              <p className="text-muted-foreground">Simulatie van EFL-CORE analyse.</p>
            </Card>
          )}

          {error && !isPending && (
            <Alert variant="destructive" className="shadow-lg animate-in fade-in-50">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Analyse Mislukt</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result && !isPending && (
             <Card className="shadow-lg animate-in fade-in-50 duration-500">
                <CardHeader>
                    <CardTitle>Analyse Voltooid (Gesimuleerd)</CardTitle>
                    <CardDescription>
                        Episode ID: {result.episode_id} voor voertuig {result.vehicle_id}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <h3 className="font-semibold mb-2">Gevonden Events ({result.features.num_events})</h3>
                    {result.events.length > 0 ? (
                    <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">
                        {JSON.stringify(result.events, null, 2)}
                    </pre>
                    ) : (
                        <p className="text-muted-foreground">Geen events gevonden in dit logbestand.</p>
                    )}
                </CardContent>
             </Card>
          )}

          {!result && !error && !isPending && (
            <div className="flex flex-col items-center justify-center h-96 bg-card/50 rounded-lg border-2 border-dashed">
              <HardDrive className="h-16 w-16 text-muted-foreground" />
              <p className="mt-4 text-lg font-semibold text-muted-foreground">Wachten op Analyse</p>
              <p className="text-sm text-center max-w-xs text-muted-foreground">
                Upload een logbestand en start de analyse. De gesimuleerde resultaten worden hier weergegeven.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
