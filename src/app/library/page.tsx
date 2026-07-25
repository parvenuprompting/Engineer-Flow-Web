
"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Library, Search, Wrench, BrainCircuit, HardHat } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

// Import the data directly from the JSON files
import failureModesData from "@/ai/data/failure_modes.json";
import componentsData from "@/ai/data/components.json";
import diagnosticFlowsData from "@/ai/data/efl.json";

// Define types for our data for better TypeScript support
type FailureMode = {
  id: string;
  component_id: string;
  severity: number;
  likelihood: number;
  description: string;
};

type DiagnosticStep = {
  step_id: number;
  action: string;
  reason: string;
  tool: string;
};

type DiagnosticFlow = {
    id: string;
    failure_object_id: string;
    steps: DiagnosticStep[];
}

type Component = {
  id: string;
  name: string;
  subsystem: string;
  type: string;
};

const failureModes: FailureMode[] = failureModesData.failure_modes;
const components: Component[] = componentsData.components;
const diagnosticFlows: DiagnosticFlow[] = diagnosticFlowsData;

// Create maps for quick data lookup
const componentMap = new Map<string, Component>(
  components.map((c) => [c.id, c])
);
const flowMap = new Map<string, DiagnosticFlow>(
    diagnosticFlows.map((flow) => [flow.failure_object_id, flow])
);

// Get unique subsystems for filtering
const subsystems = [...new Set(components.map(c => c.subsystem))].sort();

export default function LibraryPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSubsystem, setSelectedSubsystem] = useState("all");
  const [sortMethod, setSortMethod] = useState("relevance");
  const [selectedFailureMode, setSelectedFailureMode] =
    useState<FailureMode | null>(null);
  const router = useRouter();


  const filteredFailureModes = useMemo(() => {
    let filtered = failureModes;

    // 1. Filter by subsystem
    if (selectedSubsystem !== 'all') {
        const componentIdsInSubsystem = components
            .filter(c => c.subsystem === selectedSubsystem)
            .map(c => c.id);
        filtered = filtered.filter(fm => componentIdsInSubsystem.includes(fm.component_id));
    }

    // 2. Filter by search term
    if (searchTerm) {
        const lowercasedFilter = searchTerm.toLowerCase();
        filtered = filtered.filter(
            (fm) =>
            fm.description.toLowerCase().includes(lowercasedFilter) ||
            fm.id.toLowerCase().includes(lowercasedFilter) ||
            getComponentName(fm.component_id).toLowerCase().includes(lowercasedFilter)
        );
    }
    
    // 3. Sort the results
    switch (sortMethod) {
        case 'severity':
            filtered.sort((a, b) => b.severity - a.severity);
            break;
        case 'likelihood':
            filtered.sort((a, b) => b.likelihood - a.likelihood);
            break;
        case 'alphabetical':
            filtered.sort((a, b) => a.description.localeCompare(b.description));
            break;
        case 'relevance':
        default:
            // Default sort is a mix of likelihood and severity
            filtered.sort((a, b) => (b.likelihood * 2 + b.severity) - (a.likelihood * 2 + a.severity));
            break;
    }


    return filtered;
  }, [searchTerm, selectedSubsystem, sortMethod]);

  const getRelatedFlow = (failureModeId: string): DiagnosticFlow | undefined => {
    return flowMap.get(failureModeId);
  };

  const getComponentName = (componentId: string): string => {
    return componentMap.get(componentId)?.name || componentId;
  };
  
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setSelectedFailureMode(null);
    }
  };

  const handleStartDiagnosis = (symptom: string) => {
    router.push(`/diagnose?symptom=${encodeURIComponent(symptom)}`);
  };


  return (
    <div className="container mx-auto p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/" passHref>
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Terug naar Home
          </Button>
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2">
            <Library /> Storingen Bibliotheek
        </h1>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Alle Bekende Storingen</CardTitle>
          <CardDescription>
            Doorzoek de kennisbank van {failureModes.length} bekende storingen
            en hun componenten.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
             <div className="sm:col-span-3 grid md:grid-cols-3 gap-4">
                <div className="md:col-span-2 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Zoek op storing, ID of component..."
                        className="pl-10 w-full"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Select value={selectedSubsystem} onValueChange={setSelectedSubsystem}>
                        <SelectTrigger>
                            <SelectValue placeholder="Filter op subsysteem" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Alle Subsystemen</SelectItem>
                            {subsystems.map(sub => (
                                <SelectItem key={sub} value={sub}>{sub}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                     <Select value={sortMethod} onValueChange={setSortMethod}>
                        <SelectTrigger>
                            <SelectValue placeholder="Sorteer op..." />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="relevance">Sorteer op Relevantie</SelectItem>
                            <SelectItem value="severity">Sorteer op Ernst</SelectItem>
                            <SelectItem value="likelihood">Sorteer op Waarschijnlijkheid</SelectItem>
                            <SelectItem value="alphabetical">Sorteer op Alfabet</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
          </div>

          <Dialog onOpenChange={handleOpenChange}>
            <ScrollArea className="h-[60vh]">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredFailureModes.map((fm) => (
                  <DialogTrigger key={fm.id} asChild>
                    <Card
                      className="cursor-pointer hover:border-primary transition-colors flex flex-col"
                      onClick={() => setSelectedFailureMode(fm)}
                    >
                      <CardHeader>
                        <CardTitle className="text-lg">{fm.description}</CardTitle>
                        <CardDescription className="font-mono text-xs pt-1">{fm.id}</CardDescription>
                      </CardHeader>
                      <CardContent className="flex-grow flex flex-col justify-end">
                         <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
                            <span>Ernst: {fm.severity}/5</span>
                            <span>Kans: {fm.likelihood}/5</span>
                        </div>
                        <Badge variant="secondary" className="w-fit mt-2">
                          {getComponentName(fm.component_id)}
                        </Badge>
                      </CardContent>
                    </Card>
                  </DialogTrigger>
                ))}
              </div>
               {filteredFailureModes.length === 0 && (
                <div className="text-center text-muted-foreground py-16">
                    <Search className="mx-auto h-12 w-12 mb-2"/>
                    <p className="font-semibold">Geen storingen gevonden</p>
                    <p>Probeer een andere zoekterm of pas de filters aan.</p>
                </div>
              )}
            </ScrollArea>
             {selectedFailureMode && (
                <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
                  <DialogHeader>
                    <DialogTitle className="text-2xl">{selectedFailureMode.description}</DialogTitle>
                    <DialogDescription>
                        Details en aanbevolen stappen voor storing <span className="font-mono">{selectedFailureMode.id}</span>
                    </DialogDescription>
                  </DialogHeader>
                  <ScrollArea className="pr-6 -mr-6">
                    <div className="space-y-4">
                        <div className="flex flex-wrap gap-4 items-center">
                             <div>
                                <h3 className="font-semibold mb-1 text-sm">Betrokken Component</h3>
                                <Badge variant="default">{getComponentName(selectedFailureMode.component_id)}</Badge>
                            </div>
                             <div>
                                <h3 className="font-semibold mb-1 text-sm">Ernst</h3>
                                <Badge variant="destructive">{selectedFailureMode.severity} / 5</Badge>
                            </div>
                             <div>
                                <h3 className="font-semibold mb-1 text-sm">Waarschijnlijkheid</h3>
                                <Badge variant="secondary">{selectedFailureMode.likelihood} / 5</Badge>
                            </div>
                        </div>

                        <div>
                            <h3 className="font-semibold mb-2">Diagnostische Stappen</h3>
                            <div className="space-y-3">
                            {getRelatedFlow(selectedFailureMode.id) ? (
                                getRelatedFlow(selectedFailureMode.id)?.steps.map(step => (
                                <div key={step.step_id} className="p-3 bg-muted rounded-md border">
                                    <p className="font-semibold flex items-center gap-2"><Wrench className="h-4 w-4 text-primary" />{step.action}</p>
                                    <p className="text-sm text-muted-foreground mt-1 pl-6">{step.reason}</p>
                                    <p className="text-xs text-muted-foreground mt-2 pl-6 font-mono">Tool: {step.tool}</p>
                                </div>
                                ))
                            ) : (
                                <p className="text-sm text-muted-foreground p-3 bg-muted rounded-md">
                                    <HardHat className="inline-block mr-2"/>
                                    Voor deze specifieke storing zijn nog geen standaard diagnostische stappen gedefinieerd. Raadpleeg de expert chat.
                                </p>
                            )}
                            </div>
                        </div>
                    </div>
                  </ScrollArea>
                  <DialogFooter className="pt-4 border-t mt-auto">
                      <Button
                          onClick={() => handleStartDiagnosis(selectedFailureMode.description)}
                          className="bg-accent hover:bg-accent/90 text-accent-foreground"
                      >
                          <BrainCircuit className="mr-2 h-4 w-4" />
                          Start Diagnose met deze Storing
                      </Button>
                  </DialogFooter>
                </DialogContent>
             )}
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}
