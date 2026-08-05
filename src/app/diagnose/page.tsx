
"use client";

import { useState, useTransition, useEffect, useRef, Suspense, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { DiagnosticForm } from '@/components/diagnostic-form';
import { DiagnosticResult } from '@/components/diagnostic-result';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { HardHat, AlertTriangle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import type { DiagnoseResponse } from '@/lib/api/types';
import { diagnose, createCase } from '@/lib/api/client';
import { syncPendingAuditEvents } from '@/lib/audit/offline-audit-queue';
import { useToast } from '@/hooks/use-toast';
import { LoadingScreen } from '@/components/loading-screen';
import { useUser } from '@/firebase';

export const dynamic = 'force-dynamic';

const DIAGNOSTIC_RESULT_STORAGE_KEY = 'diagnosticResult';
const DIAGNOSTIC_ERROR_STORAGE_KEY = 'diagnosticError';

function DiagnosePageContent() {
  const [result, setResult] = useState<DiagnoseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const { user, isUserLoading } = useUser();

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.replace('/login');
    }
  }, [isUserLoading, user, router]);

  const [initialSymptom, setInitialSymptom] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [caseTitle, setCaseTitle] = useState<string | null>(null);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);

  const hasTriggeredAutoDiagnose = useRef(false);

  useEffect(() => {
    try {
      const symptomParam = searchParams.get('symptom');
      if (symptomParam && !hasTriggeredAutoDiagnose.current) {
        hasTriggeredAutoDiagnose.current = true;
        handleSetResult(null);
        handleSetError(null);
        setInitialSymptom(symptomParam);
        handleAutoDiagnose(symptomParam);
        // Do not replace the URL anymore to allow refresh
        // router.replace('/diagnose', { scroll: false });
      } else {
        const storedResult = localStorage.getItem(DIAGNOSTIC_RESULT_STORAGE_KEY);
        if (storedResult) {
          const parsed = JSON.parse(storedResult);
          setResult(parsed.result);
          setInitialSymptom(parsed.initialSymptom || '');
          setPhotoUrl(parsed.photoUrl || null);
          setCaseTitle(parsed.title || null);
          setActiveCaseId(parsed.caseId || null);
        }
        const storedError = localStorage.getItem(DIAGNOSTIC_ERROR_STORAGE_KEY);
        if (storedError) {
          setError(JSON.parse(storedError));
        }
      }
    } catch (e) {
      console.error("Failed to parse state or URL params", e);
      localStorage.removeItem(DIAGNOSTIC_RESULT_STORAGE_KEY);
      localStorage.removeItem(DIAGNOSTIC_ERROR_STORAGE_KEY);
    }
  }, [searchParams]);

  useEffect(() => {
    let active = true;

    const syncBufferedAudit = async () => {
      const syncResult = await syncPendingAuditEvents();
      if (!active || syncResult.state !== 'synced') {
        return;
      }

      setResult((previous) => {
        if (!previous) {
          return previous;
        }

        const next = {
          ...previous,
          audit_sync_state: 'synced' as const,
        };

        try {
          const storedResult = localStorage.getItem(DIAGNOSTIC_RESULT_STORAGE_KEY);
          if (storedResult) {
            const parsed = JSON.parse(storedResult);
            parsed.result = next;
            localStorage.setItem(DIAGNOSTIC_RESULT_STORAGE_KEY, JSON.stringify(parsed));
          }
        } catch (error) {
          console.error("Failed to persist audit sync state", error);
        }

        return next;
      });
    };

    void syncBufferedAudit();
    const onOnline = () => {
      void syncBufferedAudit();
    };

    window.addEventListener('online', onOnline);
    return () => {
      active = false;
      window.removeEventListener('online', onOnline);
    };
  }, []);

  const handleAutoDiagnose = (symptom: string) => {
    startTransition(async () => {
      toast({
        title: "Automatische Diagnose Gestart",
        description: `Symptoom: ${symptom}`,
      });

      // Initialize case context if needed
      let caseId = activeCaseId;
      if (!caseId) {
        const caseRes = await createCase("TRUCK-MVP-01");
        if (caseRes.data) {
          caseId = caseRes.data.case_id;
          setActiveCaseId(caseId);
        }
      }

      const apiResponse = await diagnose({
        symptom_text: symptom,
        case_id: caseId || undefined
      });
      if (apiResponse.error) {
        handleSetError(apiResponse.error);
      }
      if (apiResponse.data) {
        handleSetResult(apiResponse.data, symptom, null, caseId || null);
      }
    });
  }

  const handleSetResult = useCallback((
    newResult: DiagnoseResponse | null,
    symptom?: string,
    photo?: string | null,
    caseId?: string | null
  ) => {
    setResult(newResult);
    setInitialSymptom(symptom || '');
    setPhotoUrl(photo || null);
    if (typeof caseId !== 'undefined') {
      setActiveCaseId(caseId);
    }

    // Clear the title when a new result comes in
    setCaseTitle(null);

    if (newResult) {
      try {
        const stateToStore = {
          result: newResult,
          initialSymptom: symptom,
          photoUrl: photo,
          caseId: typeof caseId === 'undefined' ? activeCaseId : caseId,
          title: null, // Title is not yet known
        };
        localStorage.setItem(DIAGNOSTIC_RESULT_STORAGE_KEY, JSON.stringify(stateToStore));
      } catch (e) {
        console.error("Failed to save result to localStorage", e);
      }
    } else {
      localStorage.removeItem(DIAGNOSTIC_RESULT_STORAGE_KEY);
    }
  }, [activeCaseId]);

  const handleTitleGenerated = useCallback((title: string) => {
    setCaseTitle(title);
    try {
      const storedResult = localStorage.getItem(DIAGNOSTIC_RESULT_STORAGE_KEY);
      if (storedResult) {
        const parsed = JSON.parse(storedResult);
        parsed.title = title;
        localStorage.setItem(DIAGNOSTIC_RESULT_STORAGE_KEY, JSON.stringify(parsed));
      }
    } catch (e) {
      console.error("Failed to update title in localStorage", e);
    }
  }, []);

  const handleSetError = useCallback((newError: string | null) => {
    setError(newError);
    if (newError) {
      try {
        localStorage.setItem(DIAGNOSTIC_ERROR_STORAGE_KEY, JSON.stringify(newError));
      } catch (e) {
        console.error("Failed to save error to localStorage", e);
      }
    } else {
      localStorage.removeItem(DIAGNOSTIC_ERROR_STORAGE_KEY);
    }
  }, []);

  const handleClarificationSelect = useCallback((option: string) => {
    handleSetResult(null);
    handleSetError(null);
    setInitialSymptom(option);
    handleAutoDiagnose(option);
  }, [handleSetError, handleSetResult]);


  const handleNewDiagnosis = useCallback(() => {
    setResult(null);
    setError(null);
    setInitialSymptom('');
    setPhotoUrl(null);
    setCaseTitle(null);
    setActiveCaseId(null);
    localStorage.removeItem(DIAGNOSTIC_RESULT_STORAGE_KEY);
    localStorage.removeItem(DIAGNOSTIC_ERROR_STORAGE_KEY);
    router.replace('/diagnose', { scroll: false });
  }, [router]);

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
      <div className="grid lg:grid-cols-2 gap-8 items-start">
        <div className="w-full">
          <DiagnosticForm
            setResult={handleSetResult}
            setError={handleSetError}
            isPending={isPending}
            startTransition={startTransition}
            initialSymptom={initialSymptom}
            caseId={activeCaseId}
            onCaseIdChange={setActiveCaseId}
          />
        </div>

        <div className="lg:sticky top-24">
          {isPending && (
            <Card className="flex flex-col items-center justify-center h-96 shadow-lg border animate-pulse">
              <Loader2 className="h-16 w-16 animate-spin text-primary" />
              <p className="mt-4 text-lg font-semibold">Symptomen analyseren...</p>
              <p className="text-muted-foreground">De diagnose-engine verwerkt de informatie.</p>
            </Card>
          )}

          {error && !isPending && (
            <Alert variant="destructive" className="shadow-lg animate-in fade-in-50">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Diagnose Mislukt</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result && !isPending && (
            <DiagnosticResult
              result={result}
              onNewDiagnosis={handleNewDiagnosis}
              initialSymptom={initialSymptom}
              photoUrl={photoUrl || undefined}
              caseTitle={caseTitle}
              caseId={activeCaseId}
              onTitleGenerated={handleTitleGenerated}
              onClarificationSelect={handleClarificationSelect}
            />
          )}

          {!result && !error && !isPending && (
            <div className="flex flex-col items-center justify-center h-96 bg-card/50 rounded-lg border-2 border-dashed">
              <HardHat className="h-16 w-16 text-muted-foreground" />
              <p className="mt-4 text-lg font-semibold text-muted-foreground">Wachten op Diagnose</p>
              <p className="text-sm text-center max-w-xs text-muted-foreground">
                Vul het formulier in om een nieuwe diagnostische sessie te starten. De resultaten worden hier weergegeven.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DiagnosePage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <DiagnosePageContent />
    </Suspense>
  )
}
