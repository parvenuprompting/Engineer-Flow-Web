import { eflData } from "./data";
import { normalizeBridgeText } from "./symptom_bridge";
import type { CaseTitleInput, ExpertChatInput, ExpertChatOutput } from "@/ai/flows/types";

type TopicCard = {
  id: string;
  keywords: string[];
  bullets: string[];
};

const TOPIC_CARDS: TopicCard[] = [
  {
    id: "pto",
    keywords: ["pto", "power take off"],
    bullets: [
      "PTO schakelt motorkoppel door naar de hydraulische pomp.",
      "Zonder PTO-opbouw komt er geen hydraulische flow of druk op gang.",
      "Als PTO niet actief blijft, controleer eerst bediening, relais en bevestigingssignalen.",
      "Gebruik Diagnostische Modus als je wilt uitsluiten of het probleem upstream van de pomp zit.",
    ],
  },
  {
    id: "hydraulic_pump",
    keywords: ["pomp", "hydrauliekpomp", "hydraulic pump"],
    bullets: [
      "De hydrauliekpomp bouwt flow en druk op voor trommelrotatie en gerelateerde functies.",
      "Typische pompklachten zijn trage drukopbouw, cavitatiegeluid en inzakken onder belasting.",
      "Warm slechter dan koud wijst vaak op volumetrische inefficiëntie of interne slijtage.",
      "Meet druk en flow voordat je downstream componenten verdenkt.",
    ],
  },
  {
    id: "hydraulic_motor",
    keywords: ["hydromotor", "drum motor", "trommelmotor"],
    bullets: [
      "De hydromotor zet hydraulische energie om in trommelkoppel.",
      "Krachtverlies onder belasting en warm slechter presteren passen typisch bij interne lekkage of slijtage.",
      "Als de druk wegvalt vóór de motor, ligt de oorzaak meestal upstream.",
      "Controleer belastinggedrag, drukval en temperatuurontwikkeling samen.",
    ],
  },
  {
    id: "valve_control",
    keywords: ["ventiel", "spool", "ls", "regelventiel", "proportional valve"],
    bullets: [
      "Regelventielen bepalen hoe snel en hoe ver hydraulische flow wordt vrijgegeven.",
      "Traag reageren, klikken zonder actie en intermitterend gedrag passen vaak bij spoel- of stuurproblemen.",
      "Elektrische partial energization kan hydraulisch aanvoelen maar blijft een aansturingsprobleem.",
      "Controleer spoelstroom, spanning en mechanische spoolbeweging samen.",
    ],
  },
  {
    id: "filters",
    keywords: ["filter", "restrictie", "aanzuig", "suction", "retour"],
    bullets: [
      "Filter- en flowrestricties geven vaak dezelfde klacht als een zwakke pomp.",
      "Clogging herken je aan trage drukopbouw, flow collapse onder load en cavitatie-achtig geluid.",
      "Koud erger dan warm past goed bij viscositeit plus restrictie.",
      "Meet het drukverschil of inspecteer slangen en filterhuis op vervorming of vervuiling.",
    ],
  },
  {
    id: "thermal",
    keywords: ["warm", "heet", "koeler", "ventilator", "temperatuur", "thermal"],
    bullets: [
      "Thermische klachten beïnvloeden vrijwel alle hydraulische subsystemen.",
      "Warm slechter dan koud past bij dunnere olie, drukverlies en verminderde efficiëntie.",
      "Een koeler of ventilatorprobleem geeft vaak progressieve verslechtering tijdens langere shifts.",
      "Controleer koeler, fansturing en vervuiling voordat je alleen componentslijtage aanneemt.",
    ],
  },
  {
    id: "electrical",
    keywords: ["elektrisch", "spanning", "voltage", "connector", "massa", "ground", "relais"],
    bullets: [
      "Elektrische storingen tonen zich vaak als intermitterend, load-afhankelijk of gevoelig voor trillingen en vocht.",
      "Slechte voeding of massa kan downstream functies onbetrouwbaar maken zonder dat het onderdeel zelf defect is.",
      "Klikgeluid zonder echte actie past vaak bij spanningsval of partial energization.",
      "Controleer eerst voeding, massa en connectorconditie voordat je ventielen of sensoren vervangt.",
    ],
  },
];

function tokenize(value: string): string[] {
  return normalizeBridgeText(value).split(" ").filter(Boolean);
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function compactText(value: string, maxWords: number): string {
  const words = normalizeBridgeText(value).split(" ").filter(Boolean).slice(0, maxWords);
  if (words.length === 0) {
    return "Diagnose";
  }
  return titleCase(words.join(" "));
}

function shortRootCause(rootCauseNames: string): string {
  const first = rootCauseNames
    .split(",")
    .map((part) => part.trim())
    .find(Boolean);

  if (!first) {
    return "Onbekende Oorzaak";
  }

  return compactText(first, 5);
}

function bestTopic(question: string): TopicCard | null {
  const normalized = normalizeBridgeText(question);
  const tokens = new Set(tokenize(question));

  let best: { card: TopicCard; score: number } | null = null;

  for (const card of TOPIC_CARDS) {
    let score = 0;
    for (const keyword of card.keywords) {
      const normalizedKeyword = normalizeBridgeText(keyword);
      if (normalized.includes(normalizedKeyword)) {
        score += normalizedKeyword.includes(" ") ? 2 : 1;
      }

      for (const token of normalizedKeyword.split(" ")) {
        if (tokens.has(token)) {
          score += 0.35;
        }
      }
    }

    if (!best || score > best.score) {
      best = { card, score };
    }
  }

  return best && best.score >= 1 ? best.card : null;
}

function findReferencedComponents(question: string): string[] {
  const normalized = normalizeBridgeText(question);
  const matches: string[] = [];

  for (const component of eflData.components) {
    const name = normalizeBridgeText(component.name);
    if (!name || name.length < 4) {
      continue;
    }
    if (normalized.includes(name)) {
      matches.push(component.name);
    }
    if (matches.length >= 2) {
      break;
    }
  }

  return matches;
}

export function generateOfflineCaseTitles(input: CaseTitleInput): string[] {
  const symptomTitle = compactText(input.symptom_text, 5);
  const causeTitle = shortRootCause(input.root_cause_names);

  const titles = [
    `${symptomTitle} Door ${causeTitle}`,
    `${causeTitle} Bij ${symptomTitle}`,
    `${symptomTitle} Diagnose`,
  ];

  return Array.from(new Set(titles.map((title) => title.trim()).filter(Boolean))).slice(0, 3);
}

export function generateOfflineExpertChatResponse(input: ExpertChatInput): ExpertChatOutput {
  const topic = bestTopic(input.question);
  const referencedComponents = findReferencedComponents(input.question);
  const intro = topic
    ? `Lokale uitleg voor ${topic.id.replace(/_/g, " ")}:`
    : "Lokale expert fallback:";

  const bullets = topic
    ? [...topic.bullets]
    : [
        "Ik kan lokaal alleen uitleg en afbakening geven, geen vrije AI-redenering.",
        "Noem zo mogelijk het subsystem, het gedrag onder belasting en of warm/koud verschil uitmaakt.",
        "Geef bij voorkeur ook druk, flow, temperatuur of voedingsinformatie mee.",
        "Gebruik Diagnostische Modus voor een reproduceerbare oorzaakranking.",
      ];

  if (referencedComponents.length > 0) {
    bullets.push(`Herkenbare componenten in je vraag: ${referencedComponents.join(", ")}.`);
  }

  return {
    answer: [intro, ...bullets.map((bullet) => `- ${bullet}`)].join("\n"),
  };
}
