"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useUser } from "@/firebase";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Loader2,
  ArrowLeft,
  Calendar,
  AlertTriangle,
  Trash2,
  Share2,
  Hash,
  FileText,
  Check,
  List,
  Target,
  BarChart,
  Wrench,
  Receipt,
  Landmark,
  CheckCircle2,
  Clock3,
  CircleDashed,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addWerkbonRegel,
  afrondenWerkbon,
  createFactuur,
  createWerkbon,
  deleteDiagnosis,
  exportDiagnosis,
  finaliseerFactuur,
  getDiagnosis,
  getFactuur,
  updateDiagnosis,
} from "@/lib/api/client";
import type {
  EflDiagnosisRecord,
  FactuurDetailResponseData,
  FactuurStatus,
  GrootboekPost,
  WerkbonStatus,
} from "@/lib/api/types";

type DiagnosisSummary = {
  symptom?: string;
  probableCause?: string;
  stepsTaken?: string[];
  nextAction?: string;
  reliability?: string;
};

type DiagnosisFlowState = {
  werkbonId?: string | null;
  werkbonStatus?: WerkbonStatus | null;
  werkbonSubtotaal?: number | null;
  factuurId?: string | null;
  factuurStatus?: FactuurStatus | null;
  factuurnummer?: string | null;
  grootboekBalanced?: boolean | null;
  workflowState?: string | null;
  updatedAt?: unknown;
};

type DiagnosisDocument = {
  id: string;
  userId?: string;
  title?: string;
  symptomText?: string;
  summary?: DiagnosisSummary;
  rootCauses?: string[];
  flowSteps?: string[];
  truckType?: string;
  opbouwType?: string;
  symptomCluster?: string;
  reliabilityScore?: number;
  createdAt?: { toDate: () => Date } | Date | string | null;
  imageUrl?: string | null;
  diagnosisId?: string;
  status?: string;
  caseStatus?: string | null;
  vehicleId?: string;
  serviceFlow?: DiagnosisFlowState;
};

const STATUS_TEXT: Record<
  "diagnose" | "repair" | "workorder" | "invoice",
  string
> = {
  diagnose: "Diagnose voltooid",
  repair: "Reparatie bevestigd",
  workorder: "Werkbon actief",
  invoice: "Gefactureerd",
};

function formatDate(value: DiagnosisDocument["createdAt"]): string {
  if (!value) return "Onbekend";
  if (typeof value === "string") return new Date(value).toLocaleDateString("nl-NL");
  if (value instanceof Date) return value.toLocaleDateString("nl-NL");
  if (typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toLocaleDateString("nl-NL");
  }
  return "Onbekend";
}

function toEuro(amount: number | null | undefined): string {
  if (typeof amount !== "number") return "€ 0,00";
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(amount);
}

export default function DiagnosisDetailPage() {
  const router = useRouter();
  const params = useParams();
  const diagnosisId = params?.id as string | undefined;

  const { user, isUserLoading } = useUser();
  const { toast } = useToast();

  const [apiDiagnosis, setApiDiagnosis] = useState<EflDiagnosisRecord | null>(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !diagnosisId) return;
    let active = true;
    setApiLoading(true);
    setApiError(null);
    void getDiagnosis(diagnosisId).then((response) => {
      if (!active) return;
      if (response.data) setApiDiagnosis(response.data);
      else setApiError(response.error || "Kon de diagnose niet laden.");
      setApiLoading(false);
    });
    return () => {
      active = false;
    };
  }, [user, diagnosisId]);

  const apiDiagnosisDocument = useMemo<DiagnosisDocument | null>(() => {
    if (!apiDiagnosis) return null;
    const response = apiDiagnosis.response;
    const ranking = response.root_cause_ranking || response.candidates || [];
    const failureModes = response.failure_modes || [];
    const rootCauses = ranking.map((candidate) => {
      const id = candidate.fo_id || candidate.id || "Onbekende oorzaak";
      return failureModes.find((failureMode) => failureMode.id === id)?.description || id;
    });
    const metadata = apiDiagnosis.metadata;
    return {
      id: apiDiagnosis.diagnosis_id,
      title: metadata.title || apiDiagnosis.symptom_text,
      symptomText: apiDiagnosis.symptom_text,
      summary: (metadata.summary as DiagnosisSummary | undefined) || {
        symptom: apiDiagnosis.symptom_text,
        probableCause: rootCauses[0] || "Onbekende oorzaak",
        stepsTaken: [],
        reliability: `${Math.round(response.confidence_score || 0)}%`,
      },
      rootCauses,
      flowSteps: metadata.flow_steps || response.recommended_actions || [],
      truckType: "Volvo FM/FH",
      opbouwType: "Liebherr Mixer",
      symptomCluster: response.symptom_cluster_name || response.symptom_cluster,
      reliabilityScore: response.confidence_score || 0,
      createdAt: apiDiagnosis.created_at,
      diagnosisId: apiDiagnosis.diagnosis_id,
      status: metadata.status || (metadata.confirmed_fix_id ? "resolved" : "under_investigation"),
      vehicleId: metadata.vehicle_id,
      caseStatus: apiDiagnosis.case_status,
      serviceFlow: metadata.service_flow as DiagnosisFlowState | undefined,
    };
  }, [apiDiagnosis]);

  const diagnosis = apiDiagnosisDocument;
  const flow = diagnosis?.serviceFlow ?? {};

  const [workflowBusy, setWorkflowBusy] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [factuurDetails, setFactuurDetails] = useState<FactuurDetailResponseData | null>(null);

  const handleExport = async () => {
    if (!apiDiagnosis) return;
    setWorkflowError(null);
    const response = await exportDiagnosis(apiDiagnosis.diagnosis_id);
    if (!response.data) {
      setWorkflowError(response.error || "Kon DDS-export niet maken.");
      return;
    }
    const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${apiDiagnosis.diagnosis_id}.dds.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const [voertuigIdInput, setVoertuigIdInput] = useState("TRUCK-MVP-01");
  const [regelOmschrijving, setRegelOmschrijving] = useState("Uitgevoerde reparatie volgens diagnose");
  const [regelUren, setRegelUren] = useState("1.5");
  const [regelUurtarief, setRegelUurtarief] = useState("95");
  const [regelOnderdeelCode, setRegelOnderdeelCode] = useState("");
  const [regelOnderdeelPrijs, setRegelOnderdeelPrijs] = useState("0");

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push("/login");
    }
  }, [isUserLoading, user, router]);

  useEffect(() => {
    if (!diagnosis) return;
    setVoertuigIdInput(diagnosis.vehicleId || "TRUCK-MVP-01");
  }, [diagnosis]);

  const refreshFactuur = async () => {
    if (!flow.factuurId) return;
    setWorkflowBusy("factuur-refresh");
    const response = await getFactuur(flow.factuurId);
    setWorkflowBusy(null);
    if (!response.data) {
      setWorkflowError(response.error || "Kon factuur niet ophalen.");
      return;
    }
    setWorkflowError(null);
    setFactuurDetails(response.data.data);
  };

  useEffect(() => {
    if (!flow.factuurId) {
      setFactuurDetails(null);
      return;
    }
    void refreshFactuur();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.factuurId]);

  const setBusy = (state: string | null) => {
    setWorkflowBusy(state);
  };

  const saveFlowPatch = async (patch: Partial<DiagnosisFlowState>) => {
    if (apiDiagnosis) {
      const response = await updateDiagnosis(apiDiagnosis.diagnosis_id, {
        vehicle_id: voertuigIdInput.trim(),
        service_flow: {
          ...(diagnosis?.serviceFlow ?? {}),
          ...patch,
        },
      });
      if (!response.data) throw new Error(response.error || "Kon workflowstatus niet opslaan.");
      setApiDiagnosis(response.data);
      return;
    }
    throw new Error("Diagnose is niet beschikbaar vanuit de persistente backend.");
  };

  const handleDelete = async () => {
    if (apiDiagnosis) {
      const response = await deleteDiagnosis(apiDiagnosis.diagnosis_id);
      if (!response.data) {
        setWorkflowError(response.error || "Kon diagnose niet verwijderen.");
        return;
      }
      toast({ title: "Diagnose verwijderd", description: "De diagnose is uit het archief verwijderd." });
      router.push("/my-diagnoses");
      return;
    }
    setWorkflowError("Diagnose is niet beschikbaar vanuit de persistente backend.");
  };

  const handleMarkRepairConfirmed = async () => {
    if (!apiDiagnosis) return;
    try {
      setBusy("repair-confirm");
      setWorkflowError(null);
      const response = await updateDiagnosis(apiDiagnosis.diagnosis_id, { status: "resolved" });
      if (!response.data) throw new Error(response.error || "Kon reparatiestatus niet opslaan.");
      setApiDiagnosis(response.data);
      await saveFlowPatch({ workflowState: "reparatie_bevestigd" });
      toast({
        title: "Reparatie bevestigd",
        description: "De workflow kan nu door naar facturatie na afronding van de werkbon.",
      });
    } catch (e) {
      setWorkflowError(e instanceof Error ? e.message : "Kon reparatiestatus niet opslaan.");
    } finally {
      setBusy(null);
    }
  };

  const handleCreateWerkbon = async () => {
    const voertuigId = voertuigIdInput.trim();
    if (!voertuigId) {
      setWorkflowError("Voertuig-ID is verplicht voor werkbonaanmaak.");
      return;
    }

    const rootCause =
      diagnosis?.summary?.probableCause ||
      diagnosis?.rootCauses?.[0] ||
      diagnosis?.symptomText ||
      "Onbekende oorzaak";

    try {
      setBusy("werkbon-create");
      setWorkflowError(null);
      const response = await createWerkbon(voertuigId, rootCause);
      if (!response.data) {
        throw new Error(response.error || "Werkbon aanmaken mislukt.");
      }

      const data = response.data.data;
      await saveFlowPatch({
        werkbonId: data.werkbon_id,
        werkbonStatus: data.status,
        werkbonSubtotaal: 0,
        workflowState: "reparatie_in_uitvoering",
      });
      toast({
        title: "Werkbon aangemaakt",
        description: `Werkbon ${data.werkbon_id} is gekoppeld aan deze diagnose.`,
      });
    } catch (e) {
      setWorkflowError(e instanceof Error ? e.message : "Werkbon aanmaken mislukt.");
    } finally {
      setBusy(null);
    }
  };

  const handleAddWerkbonRegel = async () => {
    if (!flow.werkbonId) {
      setWorkflowError("Maak eerst een werkbon aan.");
      return;
    }

    const uren = Number(regelUren);
    const uurtarief = Number(regelUurtarief);
    const onderdeelPrijs = Number(regelOnderdeelPrijs);
    if (!regelOmschrijving.trim()) {
      setWorkflowError("Omschrijving is verplicht.");
      return;
    }
    if (Number.isNaN(uren) || Number.isNaN(uurtarief) || Number.isNaN(onderdeelPrijs)) {
      setWorkflowError("Uren, uurtarief en onderdeelprijs moeten numeriek zijn.");
      return;
    }

    try {
      setBusy("werkbon-regel");
      setWorkflowError(null);
      const response = await addWerkbonRegel(flow.werkbonId, {
        omschrijving: regelOmschrijving.trim(),
        uren,
        uurtarief,
        onderdeel_code: regelOnderdeelCode.trim() || null,
        onderdeel_prijs: onderdeelPrijs,
      });
      if (!response.data) {
        throw new Error(response.error || "Werkbonregel toevoegen mislukt.");
      }
      await saveFlowPatch({
        werkbonSubtotaal: response.data.data.werkbon_subtotaal,
      });
      toast({
        title: "Werkbonregel toegevoegd",
        description: `Nieuw subtotaal: ${toEuro(response.data.data.werkbon_subtotaal)}.`,
      });
    } catch (e) {
      setWorkflowError(e instanceof Error ? e.message : "Werkbonregel toevoegen mislukt.");
    } finally {
      setBusy(null);
    }
  };

  const handleAfrondenWerkbon = async () => {
    if (!flow.werkbonId) return;
    try {
      setBusy("werkbon-afronden");
      setWorkflowError(null);
      const response = await afrondenWerkbon(flow.werkbonId);
      if (!response.data) {
        throw new Error(response.error || "Werkbon afronden mislukt.");
      }
      await saveFlowPatch({
        werkbonStatus: response.data.data.status,
        workflowState: "reparatie_afgerond",
      });
      toast({
        title: "Werkbon afgerond",
        description: "De reparatie is administratief afgerond. U kunt nu factureren.",
      });
    } catch (e) {
      setWorkflowError(e instanceof Error ? e.message : "Werkbon afronden mislukt.");
    } finally {
      setBusy(null);
    }
  };

  const handleCreateFactuur = async () => {
    if (!flow.werkbonId) {
      setWorkflowError("Geen werkbon gevonden voor facturatie.");
      return;
    }
    if (diagnosis?.status !== "resolved") {
      setWorkflowError("Facturatie is geblokkeerd totdat reparatie is bevestigd.");
      return;
    }
    try {
      setBusy("factuur-create");
      setWorkflowError(null);
      const response = await createFactuur(flow.werkbonId);
      if (!response.data) {
        throw new Error(response.error || "Factuur aanmaken mislukt.");
      }
      const data = response.data.data;
      await saveFlowPatch({
        factuurId: data.factuur_id,
        factuurStatus: data.status,
        factuurnummer: data.factuurnummer,
        workflowState: "factuur_concept",
      });
      toast({
        title: "Conceptfactuur aangemaakt",
        description: `Factuur ${data.factuurnummer} is gekoppeld aan de werkbon.`,
      });
      await refreshFactuur();
    } catch (e) {
      setWorkflowError(e instanceof Error ? e.message : "Factuur aanmaken mislukt.");
    } finally {
      setBusy(null);
    }
  };

  const handleFinaliseerFactuur = async () => {
    if (!flow.factuurId) {
      setWorkflowError("Geen factuur gevonden.");
      return;
    }
    try {
      setBusy("factuur-finaliseer");
      setWorkflowError(null);
      const response = await finaliseerFactuur(flow.factuurId);
      if (!response.data) {
        throw new Error(response.error || "Factuur finaliseren mislukt.");
      }

      const data = response.data.data;
      await saveFlowPatch({
        factuurStatus: data.status,
        factuurnummer: data.factuurnummer,
        grootboekBalanced: data.grootboek_balans_ok,
        workflowState: "gefactureerd",
      });
      setFactuurDetails({
        ...data,
        werkbon: factuurDetails?.werkbon || null,
        regels: factuurDetails?.regels || [],
      });
      toast({
        title: "Factuur gefinaliseerd",
        description: "Double-entry grootboekposten zijn automatisch geboekt.",
      });
    } catch (e) {
      setWorkflowError(e instanceof Error ? e.message : "Factuur finaliseren mislukt.");
    } finally {
      setBusy(null);
    }
  };

  const isRepairConfirmed = diagnosis?.status === "resolved";
  const werkbonStatus = flow.werkbonStatus ?? null;
  const factuurStatus = flow.factuurStatus ?? null;
  const hasWorkOrder = Boolean(flow.werkbonId);
  const hasInvoice = Boolean(flow.factuurId);

  const workflowChecks = useMemo(
    () => ({
      diagnoseDone: Boolean(diagnosis),
      repairDone: isRepairConfirmed,
      workOrderDone: werkbonStatus === "afgerond",
      invoiceDone: factuurStatus === "gefinaliseerd",
    }),
    [diagnosis, isRepairConfirmed, werkbonStatus, factuurStatus]
  );

  const renderSummaryItem = (
    icon: LucideIcon,
    label: string,
    value: string | string[] | undefined
  ) => {
    const Icon = icon;
    return (
      <div className="flex items-start gap-4">
        <Icon className="h-5 w-5 text-primary flex-shrink-0 mt-1" />
        <div>
          <p className="font-semibold text-foreground">{label}</p>
          {Array.isArray(value) ? (
            value.length > 0 ? (
              <ul className="list-disc list-inside text-muted-foreground">
                {value.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground italic">Geen stappen uitgevoerd.</p>
            )
          ) : (
            <p className="text-muted-foreground">{value || "N/A"}</p>
          )}
        </div>
      </div>
    );
  };

  if (apiLoading || isUserLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (apiError) {
    return (
      <div className="container mx-auto p-4 md:p-8">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Fout</AlertTitle>
          <AlertDescription>
            {apiError}
            <Button className="ml-3" size="sm" variant="outline" onClick={() => router.refresh()}>Opnieuw proberen</Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!diagnosis) {
    return (
      <div className="container mx-auto p-4 md:p-8">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Diagnose niet gevonden</AlertTitle>
          <AlertDescription>
            De opgevraagde diagnose bestaat niet of u heeft geen toegang.
          </AlertDescription>
        </Alert>
        <Button onClick={() => router.push("/my-diagnoses")} className="mt-4">
          <ArrowLeft className="mr-2" />
          Terug naar overzicht
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-8">
      <div className="mb-6 flex justify-between items-center">
        <Button onClick={() => router.push("/my-diagnoses")} variant="outline">
          <ArrowLeft className="mr-2" />
          Terug naar overzicht
        </Button>
        <div className="flex gap-2">
          <Button variant="outline">
            <Share2 className="mr-2" />
            Delen
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="mr-2" />
                Verwijderen
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Weet u het zeker?</AlertDialogTitle>
                <AlertDialogDescription>
                  Wilt u deze diagnose permanent verwijderen? Deze actie kan niet ongedaan
                  worden gemaakt.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuleren</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Verwijderen</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <div className="flex justify-between items-start gap-4">
            <div>
              <CardTitle className="text-2xl mb-1">{diagnosis.title || diagnosis.symptomText}</CardTitle>
              <CardDescription className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3 w-3" />
                  {formatDate(diagnosis.createdAt)}
                </span>
                {diagnosis.diagnosisId && (
                  <span className="flex items-center gap-1.5 font-mono">
                    <Hash className="h-3 w-3" />
                    {diagnosis.diagnosisId}
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="text-right">
              <Button size="sm" variant="outline" onClick={handleExport} disabled={!apiDiagnosis}>
                DDS export
              </Button>
              <p className="text-sm text-muted-foreground">Betrouwbaarheid</p>
              <p className="text-2xl font-bold text-primary">
                {Math.round(diagnosis.reliabilityScore || 0)}%
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <Separator />

          {diagnosis.summary ? (
            <div>
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                <FileText />
                Rapport Samenvatting
              </h3>
              <div className="grid md:grid-cols-2 gap-x-8 gap-y-6 text-sm">
                {renderSummaryItem(List, "Symptoom", diagnosis.summary.symptom)}
                {renderSummaryItem(Target, "Waarschijnlijkste Oorzaak", diagnosis.summary.probableCause)}
                {renderSummaryItem(Check, "Uitgevoerde Stappen", diagnosis.summary.stepsTaken)}
                {renderSummaryItem(BarChart, "Betrouwbaarheid", diagnosis.summary.reliability)}
                <div className="md:col-span-2">
                  {renderSummaryItem(ArrowLeft, "Vervolgactie", diagnosis.summary.nextAction)}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <h3 className="font-semibold text-lg">Originele Klacht</h3>
              <p className="text-sm text-muted-foreground italic mt-1">"{diagnosis.symptomText}"</p>
            </div>
          )}

          <Separator />

          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Statusworkflow</h3>
            <div className="grid md:grid-cols-4 gap-3">
              <Card className="border-dashed">
                <CardContent className="py-4 flex items-center justify-between">
                  <span className="text-sm">{STATUS_TEXT.diagnose}</span>
                  {workflowChecks.diagnoseDone ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <CircleDashed className="h-4 w-4 text-muted-foreground" />
                  )}
                </CardContent>
              </Card>
              <Card className="border-dashed">
                <CardContent className="py-4 flex items-center justify-between">
                  <span className="text-sm">{STATUS_TEXT.repair}</span>
                  {workflowChecks.repairDone ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <Clock3 className="h-4 w-4 text-orange-600" />
                  )}
                </CardContent>
              </Card>
              <Card className="border-dashed">
                <CardContent className="py-4 flex items-center justify-between">
                  <span className="text-sm">{STATUS_TEXT.workorder}</span>
                  {workflowChecks.workOrderDone ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <Clock3 className="h-4 w-4 text-orange-600" />
                  )}
                </CardContent>
              </Card>
              <Card className="border-dashed">
                <CardContent className="py-4 flex items-center justify-between">
                  <span className="text-sm">{STATUS_TEXT.invoice}</span>
                  {workflowChecks.invoiceDone ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <Clock3 className="h-4 w-4 text-orange-600" />
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Wrench className="h-4 w-4" />
                    Werkbon op basis van diagnose
                  </CardTitle>
                  <CardDescription>
                    Maak een werkbon vanuit de vastgestelde root cause en voeg regels toe.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Voertuig-ID</label>
                    <Input
                      value={voertuigIdInput}
                      onChange={(e) => setVoertuigIdInput(e.target.value)}
                      placeholder="Bijv. VTG-001"
                    />
                  </div>

                  {!hasWorkOrder ? (
                    <Button
                      onClick={handleCreateWerkbon}
                      disabled={workflowBusy !== null}
                      className="w-full"
                    >
                      {workflowBusy === "werkbon-create" ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Wrench className="h-4 w-4 mr-2" />
                      )}
                      Werkbon aanmaken uit diagnose
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <Badge variant="outline">Werkbon: {flow.werkbonId}</Badge>
                        <Badge variant="secondary">Status: {flow.werkbonStatus || "open"}</Badge>
                        <Badge variant="secondary">
                          Subtotaal: {toEuro(flow.werkbonSubtotaal || 0)}
                        </Badge>
                      </div>

                      {werkbonStatus === "open" && (
                        <div className="space-y-2 border rounded-md p-3">
                          <p className="text-xs font-medium">Werkbonregel toevoegen</p>
                          <Input
                            value={regelOmschrijving}
                            onChange={(e) => setRegelOmschrijving(e.target.value)}
                            placeholder="Omschrijving"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              value={regelUren}
                              onChange={(e) => setRegelUren(e.target.value)}
                              placeholder="Uren"
                              type="number"
                              step="0.1"
                              min="0"
                            />
                            <Input
                              value={regelUurtarief}
                              onChange={(e) => setRegelUurtarief(e.target.value)}
                              placeholder="Uurtarief"
                              type="number"
                              step="0.01"
                              min="0"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              value={regelOnderdeelCode}
                              onChange={(e) => setRegelOnderdeelCode(e.target.value)}
                              placeholder="Onderdeelcode (optioneel)"
                            />
                            <Input
                              value={regelOnderdeelPrijs}
                              onChange={(e) => setRegelOnderdeelPrijs(e.target.value)}
                              placeholder="Onderdeelprijs"
                              type="number"
                              step="0.01"
                              min="0"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              variant="outline"
                              onClick={handleAddWerkbonRegel}
                              disabled={workflowBusy !== null}
                            >
                              {workflowBusy === "werkbon-regel" ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              ) : null}
                              Regel toevoegen
                            </Button>
                            <Button
                              onClick={handleAfrondenWerkbon}
                              disabled={workflowBusy !== null}
                            >
                              {workflowBusy === "werkbon-afronden" ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              ) : null}
                              Werkbon afronden
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Receipt className="h-4 w-4" />
                    Facturatie + Double-entry boekhouding
                  </CardTitle>
                  <CardDescription>
                    Factuur kan pas na bevestigde reparatie en afgeronde werkbon.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant={isRepairConfirmed ? "default" : "outline"}>
                      Reparatie: {isRepairConfirmed ? "bevestigd" : "niet bevestigd"}
                    </Badge>
                    <Badge variant="outline">
                      Werkbon: {werkbonStatus || "geen"}
                    </Badge>
                    <Badge variant="outline">
                      Factuur: {factuurStatus || "geen"}
                    </Badge>
                  </div>

                  {!isRepairConfirmed && (
                    <Button
                      variant="outline"
                      onClick={handleMarkRepairConfirmed}
                      disabled={workflowBusy !== null}
                      className="w-full"
                    >
                      {workflowBusy === "repair-confirm" ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                      )}
                      Reparatie bevestigen
                    </Button>
                  )}

                  {!hasInvoice && (
                    <Button
                      onClick={handleCreateFactuur}
                      disabled={
                        workflowBusy !== null ||
                        !hasWorkOrder ||
                        werkbonStatus !== "afgerond" ||
                        !isRepairConfirmed
                      }
                      className="w-full"
                    >
                      {workflowBusy === "factuur-create" ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Receipt className="h-4 w-4 mr-2" />
                      )}
                      Conceptfactuur aanmaken
                    </Button>
                  )}

                  {hasInvoice && (
                    <div className="space-y-2 border rounded-md p-3">
                      <div className="text-xs space-y-1">
                        <p>Factuur-ID: <span className="font-mono">{flow.factuurId}</span></p>
                        <p>Factuurnummer: <span className="font-semibold">{flow.factuurnummer || "-"}</span></p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          onClick={refreshFactuur}
                          disabled={workflowBusy !== null}
                        >
                          {workflowBusy === "factuur-refresh" ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : null}
                          Vernieuwen
                        </Button>
                        <Button
                          onClick={handleFinaliseerFactuur}
                          disabled={workflowBusy !== null || factuurStatus === "gefinaliseerd"}
                        >
                          {workflowBusy === "factuur-finaliseer" ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : null}
                          Finaliseren
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {workflowError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Workflow fout</AlertTitle>
                <AlertDescription>{workflowError}</AlertDescription>
              </Alert>
            )}
          </div>

          <Separator />

          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Diagnose Details</h3>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Truck: {diagnosis.truckType || "N/A"}</Badge>
                <Badge variant="secondary">Opbouw: {diagnosis.opbouwType || "N/A"}</Badge>
                <Badge variant="outline">Cluster: {diagnosis.symptomCluster || "N/A"}</Badge>
                <Badge variant="outline">Case: {diagnosis.caseStatus || "onbekend"}</Badge>
              </div>
              <div>
                <h4 className="font-medium mb-2">Hoofdoorzaken (Top 3)</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  {(diagnosis.rootCauses || []).slice(0, 3).map((cause, index) => (
                    <li key={index}>{cause}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="font-medium mb-2">Diagnostische Stappen</h4>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                  {(diagnosis.flowSteps || []).map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Landmark className="h-5 w-5" />
                Grootboek (Double-entry)
              </h3>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Workflow: {flow.workflowState || "diagnose"}</Badge>
                <Badge variant="outline">
                  Balans:{" "}
                  {factuurDetails?.grootboek_balans_ok || flow.grootboekBalanced
                    ? "In balans"
                    : "Nog niet geboekt"}
                </Badge>
              </div>

              {factuurDetails ? (
                <>
                  <div className="text-sm space-y-1">
                    <p>Factuurnummer: <span className="font-semibold">{factuurDetails.factuurnummer}</span></p>
                    <p>Subtotaal: <span className="font-semibold">{toEuro(factuurDetails.subtotaal)}</span></p>
                    <p>BTW (21%): <span className="font-semibold">{toEuro(factuurDetails.btw)}</span></p>
                    <p>Totaal: <span className="font-semibold">{toEuro(factuurDetails.totaal)}</span></p>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Rekening</TableHead>
                        <TableHead className="text-right">Bedrag</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(factuurDetails.grootboek_posten || []).map((post: GrootboekPost) => (
                        <TableRow key={post.id}>
                          <TableCell>
                            <Badge variant={post.type === "debet" ? "default" : "outline"}>
                              {post.type}
                            </Badge>
                          </TableCell>
                          <TableCell>{post.rekening}</TableCell>
                          <TableCell className="text-right">{toEuro(post.bedrag)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nog geen factuurdetails beschikbaar. Rond eerst werkbon + factuur af.
                </p>
              )}
            </div>
          </div>

          {diagnosis.imageUrl && (
            <>
              <Separator />
              <div className="space-y-4">
                <h3 className="font-semibold text-lg">Bijgevoegde Foto</h3>
                <div className="relative w-full aspect-video rounded-md overflow-hidden border">
                  <Image
                    src={diagnosis.imageUrl}
                    alt="Foto van diagnose"
                    fill
                    style={{ objectFit: "cover" }}
                  />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
