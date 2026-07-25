
"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ArrowLeft,
  BookOpen,
  HelpCircle,
  ThumbsUp,
  BrainCircuit,
  Wrench,
  CheckCircle,
  Lightbulb,
  Shield,
  ThumbsDown,
  HardDrive,
  Library,
  MessageSquare,
  FileJson,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const SectionCard = ({
  icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) => {
  const Icon = icon;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          <Icon className="h-6 w-6 text-primary" />
          <span>{title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
};

export default function ManualPage() {
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

      <header className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <BookOpen className="h-8 w-8" />
          Handleiding Engineer Flow
        </h1>
        <p className="text-muted-foreground mt-1">
          Een gids voor monteurs, werkplaatsen en fleet managers.
        </p>
      </header>

      <div className="space-y-8">
        <Card className="bg-secondary/50">
            <CardHeader>
                <CardTitle>Waarom AI wél betrouwbaar kan zijn voor storingsdiagnose</CardTitle>
                <CardDescription>En wat er nodig is om dat te garanderen.</CardDescription>
            </CardHeader>
        </Card>

        <SectionCard icon={BrainCircuit} title="Hoe Werkt Engineer Flow?">
            <p className="font-semibold text-foreground">Engineer Flow is opgebouwd uit vijf kernmodules die samenwerken om snelle en betrouwbare diagnoses te leveren:</p>
            <Accordion type="multiple" className="w-full">
                <AccordionItem value="item-1">
                    <AccordionTrigger className="text-base font-semibold text-foreground"><BrainCircuit className="h-5 w-5 mr-2 text-accent"/>Nieuwe Diagnose</AccordionTrigger>
                    <AccordionContent className="pt-2 text-base">
                        Dit is de kern van de applicatie. Je beschrijft een symptoom en de AI-engine (CDE) analyseert dit op basis van de ingebouwde kennisbank. Het resultaat is een stapsgewijs diagnoseplan met de meest waarschijnlijke oorzaak.
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-2">
                    <AccordionTrigger className="text-base font-semibold text-foreground"><MessageSquare className="h-5 w-5 mr-2 text-accent"/>Vraag Expert</AccordionTrigger>
                    <AccordionContent className="pt-2 text-base">
                        Gebruik de chatfunctie voor technische vragen, uitleg over componenten, of advies over onderhoud. De AI fungeert hier als een technisch mentor die je helpt concepten te begrijpen zonder een formele diagnose te stellen.
                    </AccordionContent>
                </AccordionItem>
                 <AccordionItem value="item-3">
                    <AccordionTrigger className="text-base font-semibold text-foreground"><Library className="h-5 w-5 mr-2 text-accent"/>Storingen Bibliotheek</AccordionTrigger>
                    <AccordionContent className="pt-2 text-base">
                       Een doorzoekbare database van alle bekende storingen (Failure Modes), gekoppeld aan specifieke componenten. Dit is de perfecte plek om te zien welke problemen kunnen optreden bij welk onderdeel en wat de standaard diagnostische stappen zijn.
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-4">
                    <AccordionTrigger className="text-base font-semibold text-foreground"><HardDrive className="h-5 w-5 mr-2 text-accent"/>CAN Logfile Analyse</AccordionTrigger>
                    <AccordionContent className="pt-2 text-base">
                        Voor diepgaande analyse kun je een CAN-logbestand uploaden. Een Python-engine (EFL-CORE) analyseert deze data op afwijkingen, zoals spanningsvallen, en genereert een technisch rapport. Dit is krachtig voor het vinden van patronen die handmatig onzichtbaar zijn.
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-5">
                    <AccordionTrigger className="text-base font-semibold text-foreground"><FileJson className="h-5 w-5 mr-2 text-accent"/>De Kennisbank (Het Brein)</AccordionTrigger>
                    <AccordionContent className="pt-2 text-base">
                       De AI is niet ‘open’ maar werkt binnen een strikt afgebakend kader. De kennis is vastgelegd in een serie JSON-bestanden die componenten, relaties, fouten, symptomen en diagnosestappen definiëren. Dit garandeert dat de AI altijd binnen de juiste technische context blijft.
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </SectionCard>

        <SectionCard icon={HelpCircle} title="1. Wat monteurs vaak denken">
            <Accordion type="single" collapsible defaultValue="item-1">
                <AccordionItem value="item-1">
                    <AccordionTrigger className="text-lg font-semibold text-foreground">De logische twijfels</AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-4 text-base">
                        <p className="flex items-center gap-2"><ThumbsDown className="h-4 w-4 text-destructive"/>“AI is onvoorspelbaar en verzint dingen.”</p>
                        <p className="flex items-center gap-2"><ThumbsDown className="h-4 w-4 text-destructive"/>“Hier kun je geen truck mee repareren, het kent de praktijk niet.”</p>
                        <div className="flex-muted-foreground text-sm pl-6">Dat is een logische gedachte, want consumenten-AI zoals ChatGPT geeft soms foute antwoorden en generieke AI kent geen specifieke trucksystemen.</div>
                        <p className="font-semibold text-foreground flex items-center gap-2"><Shield className="h-4 w-4 text-green-500"/>Dit systeem is 100% ontworpen voor de praktijk van monteurs.</p>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </SectionCard>

        <SectionCard icon={ThumbsUp} title="2. Waarom AI juist perfect is voor dit soort werk">
          <ul className="space-y-4">
            <li>
              <h4 className="font-semibold text-foreground">AI analyseert miljoenen CAN-berichten, mensen niet.</h4>
              <p>Een monteur kan onmogelijk 12 miljoen datapunten filteren. AI doet dat in seconden en ziet patronen die je handmatig nooit vindt.</p>
            </li>
            <li>
              <h4 className="font-semibold text-foreground">AI raakt niet moe, mist niks, en vergeet niks.</h4>
              <p>Het systeem bekijkt altijd alle foutcodes, alle samenhangen en alle tijdlijnen. Een mens maakt fouten door haast of stress, een deterministisch systeem niet.</p>
            </li>
            <li>
              <h4 className="font-semibold text-foreground">AI werkt altijd volgens dezelfde, vaste logica.</h4>
              <p>Engineer Flow gebruikt vaste regels, constraints en diagnoseflows. Het is geen "creatieve AI", maar een diagnose-engine met harde afspraken.</p>
            </li>
             <li>
              <h4 className="font-semibold text-foreground">AI leert van alle storingen tegelijk.</h4>
              <p>Een monteur leert door ervaring. Engineer Flow leert van alle aangesloten voertuigen tegelijk, waardoor het collectieve kennis opbouwt.</p>
            </li>
             <li>
              <h4 className="font-semibold text-foreground">AI ziet ketens die mensen over het hoofd zien.</h4>
              <p>Een fout op de achteras kan een keten van storingen veroorzaken (EBS, VECU, ABS, ASR). Een mens ziet 6 losse storingen, de AI ziet 1 oorzaak.</p>
            </li>
          </ul>
        </SectionCard>

        <SectionCard icon={CheckCircle} title="3. Wat is er nodig voor betrouwbare AI-diagnose?">
           <ul className="space-y-4">
            <li>
              <h4 className="font-semibold text-foreground">Domeinspecifieke logica, geen “open AI”.</h4>
              <p>De AI werkt binnen een strikt kader met regels, afhankelijkheden en componentdata specifiek voor het voertuig.</p>
            </li>
             <li>
              <h4 className="font-semibold text-foreground">Een knowledge graph met echte voertuig-data.</h4>
              <p>Het systeem weet exact hoe modules, sensoren en kabels met elkaar verbonden zijn.</p>
            </li>
             <li>
              <h4 className="font-semibold text-foreground">Een uitlegbare redeneermotor.</h4>
              <p>Elke diagnose komt met een "waarom", een bevestigingstest en uitgesloten opties. Geen black box.</p>
            </li>
             <li>
              <h4 className="font-semibold text-foreground">Continue validatie door monteurs.</h4>
              <p>Elke opgeloste case wordt opgeslagen en gebruikt om het systeem slimmer en betrouwbaarder te maken.</p>
            </li>
          </ul>
        </SectionCard>

        <SectionCard icon={Wrench} title="4. Wat blijft de rol van de monteur?">
            <p>AI neemt het denkwerk over, <span className="font-bold text-foreground">niet het vakmanschap</span>. De monteur blijft essentieel voor:</p>
            <ul className="list-disc list-inside space-y-2">
                <li>Meten, controleren en valideren op het voertuig.</li>
                <li>Repareren en vervangen van componenten.</li>
                <li>Beoordelen wat praktisch en economisch verstandig is.</li>
            </ul>
            <p className="font-semibold text-foreground pt-2">Engineer Flow geeft het intelligente denkpad van een expert, maar dan binnen seconden. Jij voert het uit.</p>
        </SectionCard>

        <SectionCard icon={Lightbulb} title="5. Eerlijk antwoord: Wordt het perfect?">
            <p>Nee, geen enkel systeem is perfect. Maar de diagnose wordt wel <span className="font-bold text-foreground">enorm veel beter</span>.</p>
            <p>AI maakt geen menselijke fouten, is sneller, ziet meer en vergeet nooit iets. Samen met goed vakmanschap levert dat de beste diagnose die technisch mogelijk is.</p>
        </SectionCard>

         <SectionCard icon={BrainCircuit} title="6. De bottom line voor monteurs">
             <p>Engineer Flow is niet bedoeld om jou te vervangen. Het is bedoeld om jouw werk te maken:</p>
            <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Makkelijker</Badge>
                <Badge variant="secondary">Sneller</Badge>
                <Badge variant="secondary">Logischer</Badge>
                <Badge variant="secondary">Foutlozer</Badge>
                <Badge variant="secondary">Minder stressvol</Badge>
                <Badge variant="secondary">Minder tijdrovend</Badge>
            </div>
            <p className="font-semibold text-foreground pt-4">Het systeem doet het denkwerk. Jij doet het vakwerk. Samen leveren jullie de beste reparatie.</p>
        </SectionCard>

      </div>
    </div>
  );
}

    