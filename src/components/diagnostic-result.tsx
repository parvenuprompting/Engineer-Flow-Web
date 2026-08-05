
"use client";

import { useState, useMemo, useEffect, useTransition, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  CheckCircle2,
  Circle,
  MessageSquare,
  Send,
  ArrowLeft,
  Loader2,
  User,
  BrainCircuit,
  MapPin,
  AlertTriangle,
  Save,
  Wrench,
  Clock,
  BarChart3,
  Hash,
  HelpCircle,
  ChevronRight,
  Check,
  X,
  ShieldCheck,
  Info,
} from "lucide-react";
import { getExpertChatResponse, getCaseTitle } from "@/app/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { DiagnoseResponse, Message, FailureModeResponse } from "@/lib/api/types";
import { confirmFix, updateDiagnosis } from "@/lib/api/client";
import { useUser, useFirestore } from "@/firebase";
import { addDocumentNonBlocking } from "@/firebase/non-blocking-updates";
import { collection, serverTimestamp } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Badge } from "./ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

// Import data for enrichment
import diagnosticStepsData from '@/ai/data/diagnostic_steps.json';
import stepRequirementsData from '@/ai/data/step_requirements.json';
import stepSafetyData from '@/ai/data/step_safety.json';
import componentsData from '@/ai/data/components.json';

// Create maps for quick lookups
const stepsMap = new Map(diagnosticStepsData.diagnostic_steps.map(s => [s.action, s]));
const requirementsMap = new Map(stepRequirementsData.step_requirements.map(r => [r.step_id, r]));
const safetyMap = new Map(stepSafetyData.step_safety.map(s => [s.step_id, s]));
const componentMap = new Map(componentsData.components.map(c => [c.id, c]));

type StepStatus = 'pending' | 'found' | 'not-found' | 'uncertain';

type EnrichedStep = {
  id: number;
  text: string;
  reason?: string;
  status: StepStatus;
  tool?: string;
  duration?: number;
  difficulty?: number;
  safety?: (typeof stepSafetyData.step_safety)[number];
};


type DiagnosticResultProps = {
  result: DiagnoseResponse;
  initialSymptom: string;
  photoUrl?: string | null;
  caseTitle: string | null;
  caseId?: string | null;
  onNewDiagnosis: () => void;
  onTitleGenerated: (title: string) => void;
  onFixConfirmed?: (failureModeId: string) => void;
  onClarificationSelect?: (option: string) => void;
};

export function DiagnosticResult({
  result,
  initialSymptom,
  photoUrl,
  caseTitle,
  caseId,
  onNewDiagnosis,
  onTitleGenerated,
  onFixConfirmed,
  onClarificationSelect,
}: DiagnosticResultProps) {
  // Safely destructure with fallbacks to prevent crashes
  const {
    root_cause_ranking: original_ranking = [],
    candidates = [],
    recommended_actions = [],
    guided_flow = [],
    confidence_score: original_confidence = 0,
    failure_modes = [],
    symptom_cluster = "Onbekend",
    symptom_cluster_name,
    symptom_cluster_description,
    subdomain: rawSubdomain = "Onbekend",
    location_guess,
    applied_constraints = [],
    diagnosis_status = "ranked",
    clarification_required = false,
    clarification_prompt,
    clarification_options = [],
    clarification_questions = [],
    knowledge_gap_reason,
    audit_sync_state = "synced",
    persistence_state = "local_development",
  } = result || {};

  // Map technical subdomain IDs to human-readable Dutch names
  const subdomainMap: Record<string, string> = {
    'rotation': 'Trommel',
    'hydraulics': 'Hydrauliek',
    'electrical': 'Elektrisch',
    'engine': 'Motor',
    'safety': 'Veiligheid',
    'water': 'Water',
    'structure': 'Structuur'
  };

  const subdomain = subdomainMap[rawSubdomain] || rawSubdomain;

  // Normalize data: backend might send 'candidates' instead of 'root_cause_ranking'
  const root_cause_ranking = useMemo(() => {
    const rawList = original_ranking.length > 0 ? original_ranking : candidates;
    // Filter results with confidence > 0.1 (10%)
    return rawList
      .filter(item => {
        const conf = item.confidence !== undefined ? item.confidence : (item.likelihood !== undefined ? item.likelihood : 0);
        return conf > 0.1;
      })
      .map(item => ({
        ...item,
        fo_id: item.fo_id || item.id || '',
        confidence: item.confidence !== undefined ? item.confidence : (item.likelihood !== undefined ? item.likelihood : 0),
      }));
  }, [original_ranking, candidates]);

  // Normalize confidence score if needed
  const confidence_score = original_confidence || (root_cause_ranking?.[0]?.confidence || 0) * 100;

  const [confirmedFixId, setConfirmedFixId] = useState<string | null>(null);
  const [isConfirmingFix, setIsConfirmingFix] = useState(false);

  const auditSyncCopy: Record<string, { label: string; className: string }> = {
    synced: {
      label: "Audit gesynchroniseerd",
      className: "bg-green-500/15 text-green-300 border-green-500/40",
    },
    buffered_offline: {
      label: "Audit lokaal gebufferd",
      className: "bg-yellow-500/15 text-yellow-200 border-yellow-500/40",
    },
    sync_failed: {
      label: "Audit sync mislukt",
      className: "bg-red-500/15 text-red-200 border-red-500/40",
    },
  };

  const persistenceCopy = persistence_state === "durable"
    ? { label: "Diagnose duurzaam opgeslagen", className: "bg-green-500/15 text-green-300 border-green-500/40" }
    : { label: "Lokale development-opslag", className: "bg-yellow-500/15 text-yellow-200 border-yellow-500/40" };

  // Confidence quality mapping
  const getConfidenceQuality = (score: number) => {
    if (score >= 0.7) return { label: 'Sterke Match', color: 'bg-green-500/90 text-white', borderColor: 'border-green-500' };
    if (score >= 0.4) return { label: 'Gemiddelde Match', color: 'bg-yellow-500/90 text-white', borderColor: 'border-yellow-500' };
    return { label: 'Lage Match', color: 'bg-orange-500/90 text-white', borderColor: 'border-orange-500' };
  };

  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [diagnosisId, setDiagnosisId] = useState<string | null>(null);
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const router = useRouter();

  const confidencePercent = Math.round(confidence_score);

  const getFailureModeDescription = (fmId: string) => {
    return failure_modes.find(fm => fm.id === fmId)?.description || fmId;
  };

  const getComponentName = (componentId: string): string => {
    return componentMap.get(componentId)?.name || componentId;
  };

  const topRootCause = root_cause_ranking?.[0];
  const nextRootCause = root_cause_ranking && root_cause_ranking.length > 1 ? root_cause_ranking[1] : null;

  const rootCauseFailureMode = useMemo(
    () => failure_modes.find((fm) => fm.id === topRootCause?.fo_id),
    [failure_modes, topRootCause]
  );

  const nextRootCauseFailureMode = useMemo(
    () => nextRootCause ? failure_modes.find((fm) => fm.id === nextRootCause.fo_id) : null,
    [failure_modes, nextRootCause]
  );


  const rootCauseDescription =
    rootCauseFailureMode?.description || topRootCause?.fo_id || "N/A";

  const rootCauseReason = topRootCause?.why || "De diagnose-engine heeft deze conclusie getrokken op basis van de symptomen en de kennisbank.";

  const initialSteps = useMemo(() => {
    // Prioritize guided_flow from backend
    if (guided_flow && guided_flow.length > 0) {
      return guided_flow.map((step, index) => {
        const stepInfo = diagnosticStepsData.diagnostic_steps.find((candidate) => candidate.id === step.step_id) || stepsMap.get(step.action);
        const requirements = stepInfo ? requirementsMap.get(stepInfo.id) : undefined;
        return {
          id: index,
          text: step.action,
          reason: step.reason,
          status: 'pending' as StepStatus,
          tool: requirements?.tools.join(', ') || 'Zie backend',
          duration: requirements?.estimated_time_min || undefined,
          difficulty: requirements?.difficulty || undefined,
          safety: stepInfo ? safetyMap.get(stepInfo.id) : undefined,
        };
      });
    }

    if (!recommended_actions || recommended_actions.length === 0) {
      return [];
    }
    return recommended_actions.map((action, index) => {
      const stepInfo = stepsMap.get(action);
      const requirements = stepInfo ? requirementsMap.get(stepInfo.id) : undefined;
      return {
        id: index,
        text: action,
        reason: stepInfo?.description,
        status: 'pending' as StepStatus,
        tool: requirements?.tools.join(', ') || 'N/A',
        duration: requirements?.estimated_time_min || undefined,
        difficulty: requirements?.difficulty || undefined,
        safety: stepInfo ? safetyMap.get(stepInfo.id) : undefined,
      };
    });
  }, [recommended_actions, guided_flow]);

  const [steps, setSteps] = useState<EnrichedStep[]>(initialSteps);
  const [observations, setObservations] = useState<Record<number, string>>({});
  const [allStepsCompleted, setAllStepsCompleted] = useState(false);

  const [isPending, startTransition] = useTransition();
  const [followUpMessages, setFollowUpMessages] = useState<Message[]>([]);
  const [followUpInput, setFollowUpInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);

  // Execution guards to prevent infinite loops
  const titleGeneratedRef = useRef(false);
  const lastSymptomRef = useRef<string>("");

  // Reset title guard when we get a completely new diagnosis
  useEffect(() => {
    titleGeneratedRef.current = false;
  }, [initialSymptom]);

  // Generate title when component mounts if it doesn't exist
  useEffect(() => {
    // Only generate title once per unique symptom
    const currentSymptomKey = initialSymptom + (root_cause_ranking?.length || 0);

    if (titleGeneratedRef.current || caseTitle || !root_cause_ranking || root_cause_ranking.length === 0) {
      return;
    }

    if (lastSymptomRef.current === currentSymptomKey) {
      return;
    }

    lastSymptomRef.current = currentSymptomKey;
    titleGeneratedRef.current = true;

    const rootCauseNames = root_cause_ranking
      .slice(0, 3)
      .map(rc => {
        const fmId = rc?.fo_id || '';
        return failure_modes.find(fm => fm.id === fmId)?.description || fmId;
      })
      .filter(name => name && name !== '')
      .join(", ");

    getCaseTitle({
      symptom_text: initialSymptom,
      root_cause_names: rootCauseNames || "Onbekende oorzaak",
      vehicle_info: "Volvo FM/FH + Liebherr Mixer",
    }).then(({ data, error }) => {
      if (data) {
        onTitleGenerated(data);
      }
      if (error) {
        // Fallback to symptom cluster if title generation fails
        onTitleGenerated(symptom_cluster || "Diagnose");
      }
    });
  }, [caseTitle, initialSymptom, root_cause_ranking?.length, failure_modes.length, symptom_cluster]);


  // Update steps only when recommended_actions changes
  useEffect(() => {
    setSteps(initialSteps);
    setObservations({});
    setAllStepsCompleted(false);
  }, [recommended_actions?.length]);

  useEffect(() => {
    const allCompleted = steps.length > 0 && steps.every((step) => step.status !== 'pending' && observations[step.id]?.trim());
    setAllStepsCompleted(allCompleted);
  }, [steps, observations]);

  const handleStepStatusChange = (id: number, status: StepStatus) => {
    setSteps((prevSteps) =>
      prevSteps.map((step) =>
        step.id === id ? { ...step, status: step.status === status ? 'pending' : status } : step
      )
    );
  };

  const handleObservationChange = (id: number, value: string) => {
    setObservations((previous) => ({ ...previous, [id]: value }));
  };

  const generateDiagnosisId = () => {
    const chars = 'ABCDEFGHIJKLMNPQRSTUVWXYZ123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `EF-${result}`;
  };

  const handleConfirmFix = async (failureModeId: string) => {
    if (!caseId) {
      toast({
        variant: "destructive",
        title: "Geen Case Context",
        description: "Deze diagnose is niet gekoppeld aan een actieve case.",
      });
      return;
    }

    setIsConfirmingFix(true);
    try {
      const response = await confirmFix(caseId, failureModeId);
      if (response.data) {
        setConfirmedFixId(failureModeId);
        toast({
          title: "Fix Bevestigd",
          description: "Bedankt! Uw feedback verbetert de toekomstige analyses.",
        });
        if (onFixConfirmed) onFixConfirmed(failureModeId);
      } else {
        throw new Error(response.error || "Onbekende fout bij bevestigen.");
      }
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Bevestigen Mislukt",
        description: e.message || "Kon de fix niet bevestigen.",
      });
    } finally {
      setIsConfirmingFix(false);
    }
  };

  const handleSaveDiagnosis = async () => {
    if (!user || !firestore) {
      toast({
        variant: "destructive",
        title: "Fout",
        description: "U moet ingelogd zijn om een diagnose op te slaan.",
      });
      router.push("/login");
      return;
    }

    if (!caseTitle) {
      toast({
        variant: "destructive",
        title: "Opslaan Mislukt",
        description: "De case titel is nog niet gegenereerd. Probeer het over een paar seconden opnieuw.",
      });
      return;
    }

    setIsSaving(true);
    const newDiagnosisId = diagnosisId || result.diagnosis_id || generateDiagnosisId();
    if (!diagnosisId) setDiagnosisId(newDiagnosisId);

    // Create the summary object
    const completedSteps = steps
      .filter(s => s.status !== 'pending')
      .map(s => `${s.text}: ${observations[s.id]?.trim() || "Geen observatie"}`);
    const summary = {
      symptom: initialSymptom,
      probableCause: rootCauseDescription,
      stepsTaken: completedSteps,
      nextAction: `Vervolgactie gebaseerd op hoofdoorzaak: inspecteer of vervang '${rootCauseFailureMode ? getComponentName(rootCauseFailureMode.component_id) : 'het verdachte component'}'.`,
      reliability: `${confidencePercent}%`
    };

    // Validate we have minimum required data
    if (!topRootCause) {
      toast({
        variant: "destructive",
        title: "Kan niet opslaan",
        description: "Diagnoseresultaten zijn incompleet. Er zijn geen hoofdoorzaken gevonden.",
      });
      setIsSaving(false);
      return;
    }

    const diagnosisData = {
      diagnosisId: newDiagnosisId,
      title: caseTitle || initialSymptom.substring(0, 50),
      userId: user.uid,
      createdAt: serverTimestamp(),
      symptomText: initialSymptom,
      flowSteps: recommended_actions || [],
      rootCauses: (root_cause_ranking || []).map(
        (r) => `${getFailureModeDescription(r.fo_id)} (${Math.round((r.confidence || 0) * (r.confidence <= 1 ? 100 : 1))}%)`
      ),
      reliabilityScore: confidence_score || 0,
      imageUrl: photoUrl || null,
      truckType: "Volvo FM/FH", // Placeholder
      opbouwType: "Liebherr Mixer", // Placeholder
      symptomCluster: symptom_cluster || "Onbekend",
      subdomain: subdomain || "Onbekend",
      summary: summary, // Add the summary to the data
      caseId: caseId || null,
      confirmedFixId: confirmedFixId || null,
      status: confirmedFixId ? 'resolved' : 'under_investigation'
    };

    try {
      const durableResponse = await updateDiagnosis(newDiagnosisId, {
        title: diagnosisData.title,
        summary,
        flow_steps: diagnosisData.flowSteps,
        status: diagnosisData.status,
        confirmed_fix_id: diagnosisData.confirmedFixId || undefined,
      });

      if (durableResponse.data) {
        toast({
          title: "Succesvol opgeslagen",
          description: "De diagnose is toegevoegd aan uw duurzame archief.",
        });
        setIsSaved(true);
        setIsSaving(false);
        return;
      }

      // Keep the Firestore path as a local compatibility fallback until backend setup is active.
      if (!firestore) {
        throw new Error(durableResponse.error || "Kon diagnose niet duurzaam opslaan.");
      }
      const diagnosesCol = collection(firestore, `diagnoses`, user.uid, 'diagnoses');
      addDocumentNonBlocking(diagnosesCol, diagnosisData).then(() => {
        toast({
          title: "Succesvol opgeslagen",
          description: "De diagnose is toegevoegd aan uw archief.",
        });
        setIsSaved(true);
        setIsSaving(false);
      });

    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Opslaan mislukt",
        description: e.message || "Kon de diagnose niet opslaan in de database.",
      });
      setIsSaving(false);
    }
  };


  const buildInitialContext = () => {
    const context = `
      Initiële Diagnose Samenvatting:
      - Symptoom Cluster: ${symptom_cluster} (${subdomain})
      - Hoofdoorzaak Hypothese: ${rootCauseDescription} (${topRootCause?.fo_id})
      - Betrouwbaarheid: ${confidence_score}%
      - Aanbevolen stappen: ${recommended_actions.join(", ")}
      
      De monteur heeft alle stappen voltooid en start nu een vervolggesprek.
    `;
    return { role: "system", content: context } as Message;
  };

  const handleFollowUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUpInput.trim() || isPending) return;

    const userMessage: Message = { role: "user", content: followUpInput };
    setFollowUpMessages((prev) => [...prev, userMessage]);
    setFollowUpInput("");
    setChatError(null);

    startTransition(async () => {
      const history: Message[] =
        followUpMessages.length === 0
          ? [buildInitialContext(), userMessage]
          : [...followUpMessages, userMessage];

      const { data, error } = await getExpertChatResponse({
        history: history,
        question: followUpInput,
      });

      if (error) {
        setChatError(error);
      }
      if (data) {
        const assistantMessage: Message = { role: "model", content: data.answer };
        setFollowUpMessages((prev) => [...prev, assistantMessage]);
      }
    });
  };

  const difficultyMap = (level: number | undefined) => {
    if (level === undefined) return { text: "Onbekend", color: "bg-gray-400" };
    if (level <= 0.3) return { text: "Basis", color: "bg-green-500" };
    if (level <= 0.6) return { text: "Gemiddeld", color: "bg-yellow-500" };
    return { text: "Gevorderd", color: "bg-red-500" };
  };

  const handleStartNewDiagnosis = (symptom: string) => {
    router.push(`/diagnose?symptom=${encodeURIComponent(symptom)}`);
  }

  const statusColors: Record<StepStatus, string> = {
    pending: 'bg-secondary/50',
    found: 'bg-green-500/10 border-green-500/30',
    'not-found': 'bg-red-500/10 border-red-500/30',
    uncertain: 'bg-yellow-500/10 border-yellow-500/30',
  };

  // Early return if we have no valid diagnosis data
  if (!topRootCause || !root_cause_ranking || root_cause_ranking.length === 0) {
    const isClarificationRequired = diagnosis_status === "clarification_required";
    const isKnowledgeGap = diagnosis_status === "knowledge_gap";
    const title = isClarificationRequired
      ? "Meer Symptoomafbakening Nodig"
      : isKnowledgeGap
        ? "Niet Afgedekt Door Knowledge Base"
        : "Incomplete Diagnose Resultaten";
    const description = isClarificationRequired
      ? "De klacht past nog niet eenduidig op een canoniek symptoomprofiel."
      : isKnowledgeGap
        ? "De huidige invoer valt buiten de bestaande symptom library of bevat te weinig objectieve context."
        : "De diagnose is voltooid, maar er zijn geen hoofdoorzaken gevonden.";

    return (
      <Card className="shadow-lg animate-in fade-in-50 duration-500">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="text-yellow-500" />
            <span>{title}</span>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {isClarificationRequired ? "Meer Invoer Nodig" : isKnowledgeGap ? "Knowledge Gap" : "Geen Hoofdoorzaken Gevonden"}
            </AlertTitle>
            <AlertDescription>
              {clarification_prompt ||
                (isKnowledgeGap
                  ? "De ingevoerde klacht kon niet veilig naar een canoniek symptoomprofiel worden gemapt. Voeg meer objectieve context toe of kies een specifiekere klacht."
                  : "De engine heeft extra afbakening nodig voordat een root cause veilig gerankt kan worden.")}
              {isKnowledgeGap && knowledge_gap_reason && (
                <p className="mt-2 text-xs text-muted-foreground">Technische reden: {knowledge_gap_reason}</p>
              )}
              {clarification_options.length > 0 && (
                <ul className="list-disc list-inside mt-2 space-y-1">
                  {clarification_options.map((option) => (
                    <li key={option}>{option}</li>
                  ))}
                </ul>
              )}
              {clarification_questions.length > 0 && (
                <ul className="list-disc list-inside mt-2 space-y-1">
                  {clarification_questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              )}
            </AlertDescription>
          </Alert>
          {isClarificationRequired && clarification_options.length > 0 && onClarificationSelect && (
            <div className="rounded-lg border bg-secondary/30 p-4 space-y-3">
              <p className="font-medium">Kies de best passende klacht</p>
              <div className="flex flex-wrap gap-2">
                {clarification_options.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onClarificationSelect(option)}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {recommended_actions.length > 0 && (
            <div className="rounded-lg border bg-secondary/30 p-4">
              <p className="font-medium mb-2">Volgende stap</p>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                {recommended_actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={onNewDiagnosis} variant="default">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Nieuwe Diagnose
            </Button>
          </div>

          <div className="mt-4 pt-4 border-t">
            <details className="text-xs text-muted-foreground" open>
              <summary className="cursor-pointer font-medium hover:text-foreground mb-2">
                Technische Details (Debug Info)
              </summary>
              <div className="bg-secondary/50 p-2 rounded overflow-auto max-h-40">
                <p className="mb-1">Raw API Response:</p>
                <pre className="font-mono whitespace-pre-wrap">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            </details>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg animate-in fade-in-50 duration-500">
      <CardHeader>
        <div className="flex justify-between items-start gap-4">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="text-primary" />
              <span>Diagnose Voltooid</span>
            </CardTitle>
            <CardDescription>
              Op basis van de verstrekte informatie, hier is de analyse.
            </CardDescription>
            {diagnosisId && (
              <div className="mt-2">
                <Badge variant="secondary" className="font-mono text-xs">
                  <Hash className="h-3 w-3 mr-1.5" />
                  {diagnosisId}
                </Badge>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={auditSyncCopy[audit_sync_state]?.className}>
              <ShieldCheck className="mr-1.5 h-3 w-3" />
              {auditSyncCopy[audit_sync_state]?.label ?? "Auditstatus onbekend"}
            </Badge>
            <Badge variant="outline" className={persistenceCopy.className}>
              {persistenceCopy.label}
            </Badge>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="default" size="sm" disabled={isSaved || isSaving}>
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {isSaved ? "Opgeslagen" : "Opslaan"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Diagnose Opslaan?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Wilt u dit diagnoserapport opslaan in uw persoonlijke archief?
                    U kunt het later terugvinden onder 'Mijn Diagnoses'.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuleren</AlertDialogCancel>
                  <AlertDialogAction onClick={handleSaveDiagnosis}>Opslaan</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Nieuwe
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Weet u het zeker?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Eventuele niet-opgeslagen wijzigingen gaan verloren. Wilt u de huidige diagnose eerst opslaan?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogAction onClick={() => { handleSaveDiagnosis(); onNewDiagnosis(); }}>Opslaan en sluiten</AlertDialogAction>
                  <AlertDialogAction
                    onClick={onNewDiagnosis}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Sluiten zonder opslaan
                  </AlertDialogAction>
                  <AlertDialogCancel>Annuleren</AlertDialogCancel>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {applied_constraints.length > 0 && (
          <Alert className="bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-300">
            <ShieldCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <AlertTitle className="text-sm font-bold flex items-center gap-2">
              Beveiligde Analyse Actief
              <Badge variant="outline" className="text-[10px] bg-blue-500/20 border-blue-500/40 text-blue-700 dark:text-blue-300">
                CONTEXT-AWARE
              </Badge>
            </AlertTitle>
            <AlertDescription className="text-xs opacity-90 mt-1">
              De engine heeft de volgende filters toegepast op basis van de voertuigstatus:
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                {applied_constraints.map((constraint, i) => (
                  <li key={i}>{constraint}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div>
          <h3 className="font-semibold text-lg mb-2">Analyse van de Hoofdoorzaak</h3>
          <div className="border-l-4 border-primary pl-4 py-3 bg-secondary rounded-r-md">
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="text-foreground font-medium flex-1">{rootCauseDescription}</p>
              <Badge className={cn("text-[10px] font-bold px-2 py-0.5", getConfidenceQuality(topRootCause?.confidence || 0).color)}>
                {getConfidenceQuality(topRootCause?.confidence || 0).label}
              </Badge>
            </div>
            {symptom_cluster_name && (
              <p className="text-sm font-semibold text-primary mt-1">
                Cluster: {symptom_cluster_name}
              </p>
            )}
            {symptom_cluster_description && (
              <p className="text-xs text-muted-foreground mt-1">
                {symptom_cluster_description}
              </p>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                Subsyteem: {subdomain}
              </Badge>
              {rootCauseFailureMode && (
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                  Component: {getComponentName(rootCauseFailureMode.component_id)}
                </Badge>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-primary/10 flex justify-between items-center bg-primary/5 -mx-4 px-4 rounded-b-md">
              <span className="text-xs text-muted-foreground font-medium">Was dit de oplossing?</span>
              {confirmedFixId === (topRootCause?.fo_id) ? (
                <Badge className="bg-green-600 hover:bg-green-600 text-white flex items-center gap-1.5 py-1 px-3">
                  <CheckCircle2 className="h-4 w-4" />
                  Bevestigde Oplossing
                </Badge>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-primary/30 hover:border-primary hover:bg-primary/10 text-primary transition-all"
                  onClick={() => topRootCause?.fo_id && handleConfirmFix(topRootCause.fo_id)}
                  disabled={isConfirmingFix || !!confirmedFixId}
                >
                  {isConfirmingFix ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <CheckCircle2 className="h-3 w-3 mr-2" />}
                  Ja, dit was het
                </Button>
              )}
            </div>
          </div>
          <Accordion type="single" collapsible className="w-full mt-2">
            <AccordionItem value="item-1" className="border-b-0">
              <AccordionTrigger className="text-sm text-muted-foreground hover:no-underline py-2 justify-start gap-2">
                <HelpCircle className="h-4 w-4" />
                Waarom concludeert de AI dit?
              </AccordionTrigger>
              <AccordionContent className="pt-2 text-sm text-muted-foreground italic">
                "{rootCauseReason}"
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        {location_guess && (
          <div>
            <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
              <MapPin className="text-primary" />
              Waarschijnlijke Locatie (AI-ingeschat)
            </h3>
            <div className="border-l-4 border-accent pl-4 py-2 bg-secondary rounded-r-md text-sm space-y-2">
              <p>
                <span className="font-semibold">Locatie:</span>{" "}
                {location_guess.location_hint}
              </p>
              <p>
                <span className="font-semibold">Toegang:</span>{" "}
                {location_guess.access_hint}
              </p>
            </div>
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              Locatie is een AI-ingeschatte hulp. Kan variëren per bouwjaar en
              opbouw.
            </p>
          </div>
        )}

        <div>
          <h3 className="font-semibold text-lg mb-2">Aanbevolen Reparatiestappen</h3>

          {steps.length === 0 && (
            <div className="border-2 border-dashed rounded-lg p-6 bg-secondary/30">
              <div className="flex flex-col items-center text-center gap-4">
                <AlertTriangle className="h-12 w-12 text-muted-foreground" />
                <div>
                  <h4 className="font-semibold text-base mb-2">Geen Automatische Stappen Beschikbaar</h4>
                  <p className="text-sm text-muted-foreground mb-4">
                    De backend heeft geen guided_flow gegenereerd voor deze diagnose.
                  </p>
                </div>

                {rootCauseFailureMode && (
                  <div className="w-full">
                    <div className="bg-background/60 p-4 rounded-md border text-left">
                      <p className="text-sm font-semibold mb-2">Faalwijze Omschrijving:</p>
                      <p className="text-sm text-muted-foreground">{rootCauseFailureMode.description}</p>
                      {rootCauseFailureMode.component_id && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Component: <span className="font-medium">{getComponentName(rootCauseFailureMode.component_id)}</span>
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <Button variant="outline" className="mt-2" onClick={() => {
                  toast({
                    title: "Handmatig Stappenplan",
                    description: "Deze functie wordt binnenkort toegevoegd. Neem contact op met een senior technicus.",
                  });
                }}>
                  <Wrench className="mr-2 h-4 w-4" />
                  Handmatig Stappenplan Genereren
                </Button>
              </div>
            </div>
          )}

          {steps.length > 0 && (
            <>
              <div className="space-y-3">
                {steps.map((step) => (
                  <div key={step.id} className={cn("p-4 rounded-lg border-2 transition-all duration-200", statusColors[step.status], step.status === 'found' && "border-green-500 shadow-sm")}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <div
                            onClick={() => handleStepStatusChange(step.id, 'found')}
                            className={cn(
                              "w-6 h-6 rounded-md border-2 flex items-center justify-center cursor-pointer transition-colors",
                              step.status === 'found' ? "bg-green-500 border-green-500" : "border-muted-foreground/30 hover:border-primary"
                            )}
                          >
                            {step.status === 'found' && <Check className="h-4 w-4 text-white" />}
                          </div>
                          <p className={cn("font-semibold text-base", step.status === 'found' && "line-through text-muted-foreground")}>
                            {step.text}
                          </p>
                        </div>
                        {step.reason && (
                          <div className="mt-2 ml-9 flex items-start gap-2 text-sm text-muted-foreground bg-background/40 p-2 rounded border border-dashed">
                            <HelpCircle className="h-4 w-4 mt-0.5 shrink-0 text-primary/60" />
                            <p>
                              <span className="font-semibold text-primary/70">Waarom:</span> {step.reason}
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className={cn("h-8 w-8 hover:bg-red-500/20 hover:text-red-500", step.status === 'not-found' && "bg-red-500 text-white hover:bg-red-600")}
                          onClick={() => handleStepStatusChange(step.id, 'not-found')}
                          title="Niet gevonden"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {step.tool && step.tool !== 'Zie backend' && (
                      <div className="ml-9 mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5"><Wrench className="h-3 w-3" /> Tool: {step.tool}</span>
                        {step.duration && <span className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> Duur: ~{step.duration} min</span>}
                        {step.difficulty !== undefined &&
                          <span className="flex items-center gap-1.5"><BarChart3 className="h-3 w-3" /> Niveau:
                            <Badge variant="secondary" className={`h-4 px-1.5 ${difficultyMap(step.difficulty).color} text-white`}>{difficultyMap(step.difficulty).text}</Badge>
                          </span>
                        }
                      </div>
                    )}
                    {step.safety && (
                      <div className="ml-9 mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs">
                        <div className="flex flex-wrap gap-2 font-semibold text-red-700 dark:text-red-300">
                          <span>Veiligheidsniveau: {step.safety.level}</span>
                          {step.safety.pressure_hazard && <span>Drukgevaar</span>}
                          {step.safety.moving_parts && <span>Bewegende delen</span>}
                          {step.safety.electrical_risk && <span>Elektrisch risico</span>}
                        </div>
                        <p className="mt-1">Bevoegdheid: {step.safety.authority_required}</p>
                        <p>PBM: {step.safety.required_ppe.join(', ') || 'geen specifiek PBM'}</p>
                        <p>Voorwaarden: {step.safety.preconditions.join('; ')}</p>
                        <p className="font-semibold">Stopcondities: {step.safety.stop_conditions.join('; ')}</p>
                        <Textarea
                          className="mt-2 min-h-16 bg-background"
                          value={observations[step.id] || ''}
                          onChange={(event) => handleObservationChange(step.id, event.target.value)}
                          placeholder="Leg de objectieve post-test observatie vast..."
                          aria-label={`Post-test observatie voor ${step.text}`}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-col gap-3">
                <Button
                  onClick={handleSaveDiagnosis}
                  className={cn(
                    "w-full h-12 text-lg font-bold transition-all shadow-md",
                    allStepsCompleted ? "bg-green-600 hover:bg-green-700" : "bg-primary/20 text-muted-foreground border-2 border-dashed border-primary/30"
                  )}
                  disabled={!allStepsCompleted || isSaved}
                >
                  {isSaved ? (
                    <><CheckCircle2 className="mr-2 h-5 w-5" /> Diagnose Bevestigd & Opgeslagen</>
                  ) : (
                    <><Save className="mr-2 h-5 w-5" /> Diagnose Bevestigen</>
                  )}
                </Button>
                {!allStepsCompleted && (
                  <p className="text-center text-xs text-muted-foreground animate-pulse">
                    Vink alle stappen af om de diagnose definitief te bevestigen.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {allStepsCompleted && (
          <div className="space-y-4 pt-4 border-t animate-in fade-in-50">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <MessageSquare className="text-primary" />
              <span>Vervolggesprek</span>
            </h3>

            {followUpMessages.length > 0 && (
              <div className="space-y-4 max-h-64 overflow-y-auto pr-2">
                {followUpMessages.map(
                  (message, index) =>
                    message.role !== "system" && (
                      <div
                        key={index}
                        className={`flex items-start gap-3 ${message.role === "user" ? "justify-end" : ""
                          }`}
                      >
                        {message.role === "model" && (
                          <Avatar className="h-8 w-8 border-2 border-primary bg-background p-1">
                            <Image src="https://i.imgur.com/WlSEJ5L.png" alt="Engineer Flow Logo" width={32} height={32} />
                            <AvatarFallback>
                              <BrainCircuit className="text-primary" />
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div
                          className={`rounded-lg p-2.5 max-w-md text-sm ${message.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                            }`}
                        >
                          <p className="whitespace-pre-wrap">{message.content}</p>
                        </div>
                        {message.role === "user" && (
                          <Avatar className="h-8 w-8">
                            <AvatarFallback>
                              <User />
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                    )
                )}
                {isPending && (
                  <div className="flex items-start gap-3">
                    <Avatar className="h-8 w-8 border-2 border-primary bg-background p-1">
                      <Image src="https://i.imgur.com/WlSEJ5L.png" alt="Engineer Flow Logo" width={32} height={32} />
                      <AvatarFallback>
                        <BrainCircuit className="text-primary" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="rounded-lg p-2.5 bg-muted flex items-center space-x-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="text-xs text-muted-foreground">
                        Analyseren...
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {followUpMessages.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Alle stappen zijn voltooid. U kunt nu doorpraten met de AI voor
                verdere assistentie of om de oplossing te bespreken.
              </p>
            )}

            {chatError && (
              <Alert variant="destructive">
                <AlertTitle>Chat Fout</AlertTitle>
                <AlertDescription>{chatError}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleFollowUpSubmit} className="relative">
              <Textarea
                placeholder="Stel een vervolgvraag of beschrijf het resultaat..."
                className="pr-12"
                value={followUpInput}
                onChange={(e) => setFollowUpInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleFollowUpSubmit(e);
                  }
                }}
                disabled={isPending}
              />
              <Button
                type="submit"
                size="icon"
                className="absolute bottom-2 right-2 h-8 w-8"
                disabled={isPending || !followUpInput.trim()}
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                <span className="sr-only">Verstuur</span>
              </Button>
            </form>
          </div>
        )}

        {nextRootCause && nextRootCauseFailureMode && (
          <div className="mt-6">
            <h3 className="font-semibold text-lg mb-2">Volgende Waarschijnlijke Stap (NMLS)</h3>
            <Card className="bg-secondary/70">
              <CardHeader>
                <CardTitle className="text-base">Als de stappen hierboven het probleem niet oplossen...</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-semibold">{nextRootCauseFailureMode.description}</p>
                  <p className="text-sm text-muted-foreground">Component: {getComponentName(nextRootCauseFailureMode.component_id)}</p>
                </div>
                <Button variant="outline" onClick={() => handleStartNewDiagnosis(nextRootCauseFailureMode.description)}>
                  Start Diagnose
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-lg">Betrouwbaarheidsscore</h3>
            <span className="font-bold text-xl text-primary">
              {confidencePercent}%
            </span>
          </div>
          <Progress value={confidencePercent} className="h-3 [&>div]:bg-accent" />
        </div>
      </CardContent>
    </Card>
  );
}
