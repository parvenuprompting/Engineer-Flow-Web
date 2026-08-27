
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { 
    Dialog, 
    DialogContent, 
    DialogHeader, 
    DialogTitle, 
    DialogDescription, 
    DialogTrigger,
    DialogFooter
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrainCircuit, MessageSquare, HardDrive, AlertCircle, CheckCircle, Archive, Library, Power, Cpu, Cog, Gauge, SlidersHorizontal, TestTube, ChevronsUpDown, Gamepad2, Droplets, Network, Battery, Thermometer, Settings, BookOpen, X, LogIn, FolderArchive, Replace, Pencil, MessageCircleQuestion, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { useUser, useCollection, useFirestore, useMemoFirebase } from "@/firebase";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { collection, query, orderBy, limit } from "firebase/firestore";

const commonFailures = [
  {
    icon: Power,
    title: "ELEKTRISCHE VOEDING & MASSA",
    symptoms: [
      "Het dashboard knippert aan/uit wanneer ik de mixer inschakel.",
      "De verlichting valt soms weg bij hobbels in de weg.",
      "Het bedieningspaneel lijkt geen stroom te krijgen.",
    ]
  },
  {
    icon: Cpu,
    title: "ECU, SOFTWARE, VENTILATOREN",
    symptoms: [
      "De fan draait continu op maximale snelheid.",
      "De motorcomputer geeft sporadisch softwarefouten.",
      "Na een soft reset werkt het een minuut, daarna stopt alles weer.",
    ]
  },
  {
    icon: Cog,
    title: "PTO & CAN-COMMUNICATIE",
    symptoms: [
      "De PTO gaat niet in wanneer ik op de knop druk.",
      "Het PTO-lampje blijft knipperen.",
      "PTO schakelt soms wel, soms niet (heel onvoorspelbaar).",
    ]
  },
  {
    icon: Gauge,
    title: "HYDRAULISCHE DRUK & FLOW",
    symptoms: [
      "De trommel draait extreem langzaam, bijna geen kracht.",
      "Hydraulische pomp maakt een gierend/fluitend geluid.",
      "Bij koud weer werkt de hydrauliek eerst niet.",
    ]
  },
  {
    icon: SlidersHorizontal,
    title: "HYDRAULISCHE VENTIELEN",
    symptoms: [
      "De omkeerklep blijft soms hangen.",
      "De trommel draait maar één kant op, niet andersom.",
      "Tijdens draaien hoor je het ventiel ‘ratelen’.",
    ]
  },
  {
    icon: TestTube,
    title: "HYDRAULISCHE OLIE / FILTER / TEMP",
    symptoms: [
      "Olie wordt heel snel heet na het starten van de mixer.",
      "Druk daalt wanneer de trommel belast wordt.",
      "Er komt schuim in de olietank.",
    ]
  },
  {
    icon: ChevronsUpDown,
    title: "TROMMEL, LAGERS & MECHANISCHE AANDRIJVING",
    symptoms: [
      "Trommel maakt een bonkend geluid tijdens het draaien.",
      "Trommel draait schokkerig, niet vloeiend.",
      "Trommel start traag maar draait later weer normaal.",
    ]
  },
  {
    icon: Gamepad2,
    title: "BEDIENINGSKAST / REMOTE / E-BOX",
    symptoms: [
      "De handbediening reageert helemaal niet.",
      "Knoppen op de kast reageren pas na 2–3 seconden.",
      "De afstandsbediening verliest soms verbinding.",
    ]
  },
  {
    icon: Droplets,
    title: "VOCHT, CONNECTOREN & CORROSIE",
    symptoms: [
      "Na regen stopt de mixer helemaal met reageren.",
      "Connectoren in de E-box zijn vochtig / groen uitgeslagen.",
      "Beweging van kabelboom veroorzaakt storing.",
    ]
  },
  {
    icon: Network,
    title: "LUCHT, REMMEN & CHASSIS SIGNALEN",
    symptoms: [
      "PTO schakelt niet omdat luchtdruk foutmelding geeft.",
      "Truck meldt ‘Chassis-sensor fout’ wanneer mixer draait.",
      "Bij remmen valt hydrauliek kort weg.",
    ]
  },
  {
    icon: Battery,
    title: "ACCU, SPANNING & LAADCIRCUIT",
    symptoms: [
      "Accu loopt snel leeg wanneer de mixer draait.",
      "Spanningsval tijdens PTO inschakelen.",
      "Truck start slecht na een mixer-dag.",
    ]
  },
  {
    icon: Thermometer,
    title: "OVERIGE / DIVERSE SENSOREN",
    symptoms: [
      "Temperatuursensor mixer geeft onmogelijke waardes.",
      "Snelheidssensor trommel valt af en toe weg.",
      "Mixer geeft ‘algemene storing’, maar zonder codes.",
    ]
  }
];

function FeedbackDialog() {
    const { user } = useUser();
    const firestore = useFirestore();
    const diagnosesQuery = useMemoFirebase(() => {
        if (!user) return null;
        const diagnosesCol = collection(firestore, 'diagnoses', user.uid, 'diagnoses');
        return query(diagnosesCol, orderBy('createdAt', 'desc'), limit(25));
    }, [firestore, user]);
    
    const { data: diagnoses } = useCollection<any>(diagnosesQuery);

    return (
        <DialogContent className="sm:max-w-lg">
            <DialogHeader>
                <DialogTitle>Feedback Geven</DialogTitle>
                <DialogDescription>
                    Help ons Engineer Flow te verbeteren. Uw feedback is waardevol.
                </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-6">
                <div className="space-y-2">
                    <Label>Type Feedback</Label>
                    <RadioGroup defaultValue="suggestion" className="flex gap-4">
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="bug" id="r1" />
                            <Label htmlFor="r1">Bug / Fout</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="suggestion" id="r2" />
                            <Label htmlFor="r2">Suggestie</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="question" id="r3" />
                            <Label htmlFor="r3">Vraag</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="praise" id="r4" />
                            <Label htmlFor="r4">Compliment</Label>
                        </div>
                    </RadioGroup>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="module">Betreffende Module</Label>
                        <Select>
                            <SelectTrigger id="module">
                                <SelectValue placeholder="Selecteer een module" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="diagnose">Nieuwe Diagnose</SelectItem>
                                <SelectItem value="chat">Vraag Expert</SelectItem>
                                <SelectItem value="library">Storingen Bibliotheek</SelectItem>
                                <SelectItem value="can">CAN Analyse</SelectItem>
                                <SelectItem value="algemeen">Algemeen</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                     {user && diagnoses && diagnoses.length > 0 && (
                        <div className="space-y-2">
                            <Label htmlFor="case">Betreffende Case (optioneel)</Label>
                            <Select>
                                <SelectTrigger id="case">
                                    <SelectValue placeholder="Selecteer een case" />
                                </SelectTrigger>
                                <SelectContent>
                                    {diagnoses.map((diag) => (
                                        <SelectItem key={diag.id} value={diag.id}>
                                            <span className="font-mono text-xs mr-2">{diag.diagnosisId}</span>
                                            <span className="truncate">{diag.title}</span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>
                <div className="space-y-2">
                    <Label htmlFor="feedback-text">Uw Feedback</Label>
                    <Textarea id="feedback-text" placeholder="Beschrijf uw feedback zo gedetailleerd mogelijk..." rows={6} />
                </div>
                <div className="space-y-2">
                     <Label htmlFor="screenshot">Bijlage (optioneel)</Label>
                     <Input id="screenshot" type="file" />
                </div>
            </div>
            <DialogFooter>
                <Button type="submit" variant="default">
                    <Send className="mr-2"/>
                    Verzenden
                </Button>
            </DialogFooter>
        </DialogContent>
    );
}

export default function Home() {
    const router = useRouter();
    const [openCase, setOpenCase] = useState<any>(null);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const { user } = useUser();

    useEffect(() => {
        try {
            const storedResult = localStorage.getItem('diagnosticResult');
            if (storedResult) {
                const parsed = JSON.parse(storedResult);
                setOpenCase(parsed);
                setNewTitle(parsed.title || (parsed.result && parsed.result.symptom_cluster) || '');
            }
        } catch (e) {
            console.error("Failed to parse open case from localStorage", e);
            localStorage.removeItem('diagnosticResult');
        }
    }, []);

    const handleOpenCase = () => {
        router.push('/diagnose');
    }

    const handleCloseCase = () => {
        localStorage.removeItem('diagnosticResult');
        setOpenCase(null);
    };
    
    const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setNewTitle(e.target.value);
    };
    
    const handleTitleSave = () => {
        if (openCase && newTitle.trim() !== '') {
            const updatedCase = { ...openCase, title: newTitle.trim() };
            setOpenCase(updatedCase);
            localStorage.setItem('diagnosticResult', JSON.stringify(updatedCase));
        }
        setIsEditingTitle(false);
    };

    const handleResetApp = () => {
        sessionStorage.removeItem('appHasLoaded');
        localStorage.removeItem('diagnosticResult');
        localStorage.removeItem('expertChatHistory');
        window.location.reload();
    };

    const handleQuickDiagnose = (symptom: string) => {
      router.push(`/diagnose?symptom=${encodeURIComponent(symptom)}`);
    };

  return (
    <div className="min-h-screen bg-background/80 text-foreground animate-in fade-in duration-500">
      <header className="p-4 border-b bg-card/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="container mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="cursor-pointer" title="Naar home">
              <Image src="/icon.png" alt="Engineer Flow Logo" width={40} height={40} className="h-10 w-10" />
            </Link>
            <h1 className="text-2xl font-bold font-headline">ENGINEER FLOW</h1>
          </div>
          <div>
            {user ? (
              <Link href="/my-diagnoses" passHref>
                <Button variant="outline">
                  <FolderArchive className="mr-2"/>
                  Mijn Diagnoses
                </Button>
              </Link>
            ) : (
              <Link href="/login" passHref>
                <Button variant="outline">
                    <LogIn className="mr-2"/>
                    Inloggen
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4 md:p-8 flex-grow">
        <div className="grid gap-8">
          <Card className="bg-card">
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle>Diagnose Dashboard</CardTitle>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-sm text-muted-foreground mt-1">
                            <div>Actief op: <span className="font-semibold text-foreground">Volvo FMX 420 + Liebherr Mixer</span></div>
                            <Badge variant="outline" className="border-green-500 text-green-500">LM: +12 new cases</Badge>
                        </div>
                    </div>
                     <Dialog>
                        <DialogTrigger asChild>
                            <Button variant="outline" size="sm">
                                <Replace className="mr-2 h-4 w-4"/>
                                Wissel Voertuig
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[725px]">
                            <DialogHeader>
                            <DialogTitle>Selecteer Voertuig & Module</DialogTitle>
                            <DialogDescription>
                                Selecteer het actieve voertuig en de opbouwmodule voor diagnose. 
                                <span className="font-semibold text-amber-500"> (DEMO functionaliteit)</span>
                            </DialogDescription>
                            </DialogHeader>
                             <Tabs defaultValue="trucks">
                                <TabsList className="grid w-full grid-cols-3">
                                    <TabsTrigger value="trucks">Vrachtwagens</TabsTrigger>
                                    <TabsTrigger value="modules">Opbouw Modules</TabsTrigger>
                                    <TabsTrigger value="functional">Functionele Modules</TabsTrigger>
                                </TabsList>
                                <TabsContent value="trucks">
                                <Card>
                                    <CardHeader>
                                    <CardTitle>Beschikbare Vrachtwagenmerken</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2 max-h-[50vh] overflow-y-auto">
                                    <Accordion type="multiple">
                                        <AccordionItem value="volvo">
                                        <AccordionTrigger>Volvo Trucks</AccordionTrigger>
                                        <AccordionContent className="pl-4">
                                            <Button variant="secondary" className="w-full justify-start">Volvo FM / FMX Series</Button>
                                            <Button variant="ghost" className="w-full justify-start">Volvo FH Series</Button>
                                            <Button variant="ghost" className="w-full justify-start">Volvo FE Series</Button>
                                            <Button variant="ghost" className="w-full justify-start">Volvo FL Series</Button>
                                        </AccordionContent>
                                        </AccordionItem>
                                        <AccordionItem value="scania">
                                        <AccordionTrigger>Scania</AccordionTrigger>
                                        <AccordionContent className="pl-4">
                                            <Button variant="ghost" className="w-full justify-start">P Series</Button>
                                            <Button variant="ghost" className="w-full justify-start">G Series</Button>
                                            <Button variant="ghost" className="w-full justify-start">R Series</Button>
                                            <Button variant="ghost" className="w-full justify-start">S Series</Button>
                                        </AccordionContent>
                                        </AccordionItem>
                                         <AccordionItem value="daf">
                                        <AccordionTrigger>DAF</AccordionTrigger>
                                        <AccordionContent className="pl-4">
                                            <Button variant="ghost" className="w-full justify-start">CF Series</Button>
                                            <Button variant="ghost" className="w-full justify-start">XF Series</Button>
                                            <Button variant="ghost" className="w-full justify-start">XG / XG+</Button>
                                        </AccordionContent>
                                        </AccordionItem>
                                         <AccordionItem value="mercedes">
                                        <AccordionTrigger>Mercedes-Benz</AccordionTrigger>
                                        <AccordionContent className="pl-4">
                                            <Button variant="ghost" className="w-full justify-start">Actros Series</Button>
                                            <Button variant="ghost" className="w-full justify-start">Arocs Series</Button>
                                        </AccordionContent>
                                        </AccordionItem>
                                        <AccordionItem value="man">
                                        <AccordionTrigger>MAN</AccordionTrigger>
                                        <AccordionContent className="pl-4">
                                            <Button variant="ghost" className="w-full justify-start">TGS Series</Button>
                                            <Button variant="ghost" className="w-full justify-start">TGX Series</Button>
                                        </AccordionContent>
                                        </AccordionItem>
                                    </Accordion>
                                    </CardContent>
                                </Card>
                                </TabsContent>
                                <TabsContent value="modules">
                                <Card>
                                    <CardHeader>
                                    <CardTitle>Beschikbare Opbouw Modules</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2 max-h-[50vh] overflow-y-auto">
                                    <Accordion type="multiple">
                                        <AccordionItem value="liebherr">
                                        <AccordionTrigger>Liebherr</AccordionTrigger>
                                        <AccordionContent className="pl-4">
                                            <Button variant="secondary" className="w-full justify-start">HTM Mixer Series</Button>
                                            <Button variant="ghost" className="w-full justify-start">Betonpompen (THP Series)</Button>
                                        </AccordionContent>
                                        </AccordionItem>
                                        <AccordionItem value="hyva">
                                        <AccordionTrigger>Hyva</AccordionTrigger>
                                        <AccordionContent className="pl-4">
                                            <Button variant="ghost" className="w-full justify-start">Hyva Crane Series</Button>
                                            <Button variant="ghost" className="w-full justify-start">Hyva Hooklift / Haakarm</Button>
                                        </AccordionContent>
                                        </AccordionItem>
                                        <AccordionItem value="palfinger">
                                        <AccordionTrigger>Palfinger</AccordionTrigger>
                                        <AccordionContent className="pl-4">
                                            <Button variant="ghost" className="w-full justify-start">Palfinger Autolaadkranen</Button>
                                            <Button variant="ghost" className="w-full justify-start">Palfinger Hooklifts</Button>
                                        </AccordionContent>
                                        </AccordionItem>
                                    </Accordion>
                                    </CardContent>
                                </Card>
                                </TabsContent>
                                <TabsContent value="functional">
                                 <Card>
                                    <CardHeader>
                                    <CardTitle>Functionele Modules (Demo)</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2 max-h-[50vh] overflow-y-auto">
                                        <Accordion type="multiple">
                                            <AccordionItem value="electrical">
                                                <AccordionTrigger>Elektrische Modules</AccordionTrigger>
                                                <AccordionContent className="pl-4">
                                                    <Button variant="ghost" className="w-full justify-start">Hoofdzekeringskast / E-Box</Button>
                                                    <Button variant="ghost" className="w-full justify-start">Bodybuilder Module (BBM)</Button>
                                                    <Button variant="ghost" className="w-full justify-start">Chassis Ground Points</Button>
                                                </AccordionContent>
                                            </AccordionItem>
                                            <AccordionItem value="hydraulic">
                                                <AccordionTrigger>Hydraulische Modules</AccordionTrigger>
                                                <AccordionContent className="pl-4">
                                                    <Button variant="ghost" className="w-full justify-start">Hydraulische Pomp (Liebherr)</Button>
                                                    <Button variant="ghost" className="w-full justify-start">Hydraulische Ventielen</Button>
                                                    <Button variant="ghost" className="w-full justify-start">PTO-unit (ZF / Volvo)</Button>
                                                </AccordionContent>
                                            </AccordionItem>
                                             <AccordionItem value="control">
                                                <AccordionTrigger>Bediening & E-box</AccordionTrigger>
                                                <AccordionContent className="pl-4">
                                                    <Button variant="ghost" className="w-full justify-start">Handbediening / Remote</Button>
                                                    <Button variant="ghost" className="w-full justify-start">Control Unit Mixer (Litronic)</Button>
                                                </AccordionContent>
                                            </AccordionItem>
                                        </Accordion>
                                    </CardContent>
                                 </Card>
                                </TabsContent>
                            </Tabs>
                            <DialogFooter>
                            <Button type="submit">Selecteren</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-lg font-semibold text-primary">Slimme Diagnose → Direct naar de Oorzaak.</p>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span><span className="font-semibold text-foreground">Logica:</span> Deterministisch (100% reproduceerbaar)</span>
              </div>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-3 gap-4">
            <Link href="/diagnose" passHref>
              <Button size="lg" className="w-full h-24 text-lg bg-green-600 hover:bg-green-700">
                <BrainCircuit className="mr-4 h-8 w-8" />
                Nieuwe Diagnose
              </Button>
            </Link>
            <Link href="/chat" passHref>
               <Button size="lg" variant="outline" className="w-full h-24 text-lg border-accent text-accent-foreground bg-accent hover:bg-accent/90">
                <MessageSquare className="mr-4 h-8 w-8" />
                Vraag Expert
               </Button>
            </Link>
             <Link href="/library" passHref>
               <Button size="lg" variant="outline" className="w-full h-24 text-lg">
                <Library className="mr-4 h-8 w-8" />
                Storingen Bibliotheek
               </Button>
            </Link>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4">Eerdere Diagnoses (Open Loops)</h2>
            <div className="grid gap-4 mb-6">
                {openCase && openCase.result ? (
                    <Card className="hover:border-primary/50 transition-colors">
                        <CardHeader>
                        <CardTitle className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                            <div className="flex items-center gap-2 group">
                                {isEditingTitle ? (
                                    <Input 
                                        value={newTitle}
                                        onChange={handleTitleChange}
                                        onBlur={handleTitleSave}
                                        onKeyDown={(e) => e.key === 'Enter' && handleTitleSave()}
                                        className="h-9"
                                        autoFocus
                                    />
                                ) : (
                                    <>
                                        <span>{newTitle || 'Onbekende case'}</span>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => setIsEditingTitle(true)}>
                                            <Pencil className="h-4 w-4"/>
                                        </Button>
                                    </>
                                )}
                            </div>
                            <Badge variant="destructive" className="flex items-center gap-1.5 mt-2 sm:mt-0">
                            <AlertCircle className="h-3 w-3"/>
                            Niet opgeslagen
                            </Badge>
                        </CardTitle>
                        </CardHeader>
                        <CardFooter className="p-6 pt-0 flex justify-between">
                            <Button variant="link" className="p-0" onClick={handleOpenCase}>Open Case</Button>
                            <Button variant="ghost" size="sm" onClick={handleCloseCase}>
                                <X className="mr-2 h-4 w-4" />
                                Sluit Case
                            </Button>
                        </CardFooter>
                    </Card>
                ) : (
                    <Card className="flex flex-col items-center justify-center p-8 border-dashed">
                        <Archive className="h-10 w-10 text-muted-foreground mb-3"/>
                        <h3 className="font-semibold">Geen Open Cases</h3>
                        <p className="text-sm text-muted-foreground text-center">Start een nieuwe diagnose om een case te openen.</p>
                    </Card>
                )}
            </div>
            
            <div className="text-center mt-6 flex flex-wrap justify-center items-center gap-4">
              <Link href="/can-analysis" passHref>
                <Button variant="secondary">
                  <HardDrive className="mr-2"/>
                  Bekijk Log/CAN-data Upload
                </Button>
              </Link>
               <Link href="/manual" passHref>
                <Button variant="secondary">
                  <BookOpen className="mr-2"/>
                  Handleiding
                </Button>
              </Link>
              <Dialog>
                <DialogTrigger asChild>
                    <Button variant="ghost">
                        <MessageCircleQuestion className="mr-2"/>
                        Feedback
                    </Button>
                </DialogTrigger>
                <FeedbackDialog />
              </Dialog>
              <Link href="/settings" passHref>
                <Button variant="ghost">
                  <Settings className="mr-2"/>
                  Instellingen
                </Button>
              </Link>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost">
                    Reset applicatie
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Applicatie resetten?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Dit verwijdert de lokale open case en chatgeschiedenis en laadt de pagina opnieuw.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuleren</AlertDialogCancel>
                    <AlertDialogAction onClick={handleResetApp}>Resetten</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

          </div>

           <div className="mt-8">
            <h2 className="text-xl font-semibold mb-4">Veelvoorkomende Storingen</h2>
            <Accordion type="single" collapsible className="w-full">
              {commonFailures.map((item, index) => (
                <AccordionItem value={`item-${index}`} key={index}>
                  <AccordionTrigger className="font-semibold text-base">
                    <div className="flex items-center gap-3">
                        <item.icon className="h-5 w-5 text-primary"/>
                        <span>{item.title}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {item.symptoms.map((symptom, symptomIndex) => (
                        <Button key={symptomIndex} variant="secondary" className="h-auto text-wrap text-left justify-start" onClick={() => handleQuickDiagnose(symptom)}>
                          {symptom}
                        </Button>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

        </div>
      </main>
    </div>
  );
}
