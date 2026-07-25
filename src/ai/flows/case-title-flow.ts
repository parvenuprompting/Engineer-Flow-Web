
'use server';

/**
 * @fileOverview An AI agent for generating concise case titles.
 * - generateCaseTitle - A function that creates a human-readable title from diagnostic data.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// Input schema for the title generator
const CaseTitleInputSchema = z.object({
  symptom_text: z.string().describe("De volledige, door de gebruiker ingevoerde symptoombeschrijving."),
  root_cause_names: z.string().describe("Een comma-separated string van de top 3 meest waarschijnlijke oorzaken."),
  vehicle_info: z.string().optional().describe("Optionele informatie over het voertuig, bijv. 'Volvo FM/FH + Liebherr Mixer'."),
});
export type CaseTitleInput = z.infer<typeof CaseTitleInputSchema>;

// Output schema: we ask for 3 options but will typically use the first/best one.
const CaseTitleOutputSchema = z.object({
    titles: z.array(z.string()).describe("Een lijst van 3 mogelijke, beknopte en duidelijke case-titels."),
});
export type CaseTitleOutput = z.infer<typeof CaseTitleOutputSchema>;


/**
 * Generates a concise, human-readable title for a diagnostic case.
 * @param input The diagnostic data (symptom, root causes).
 * @returns A list of potential titles.
 */
export async function generateCaseTitle(input: CaseTitleInput): Promise<string[]> {
    const result = await caseTitleFlow(input);
    return result.titles || [];
}


const titlePrompt = ai.definePrompt({
  name: 'caseTitlePrompt',
  input: { schema: CaseTitleInputSchema },
  output: { schema: CaseTitleOutputSchema },
  prompt: `
    SYSTEM MESSAGE:
    Jij bent de Case Title Generator van Engineer Flow. Jouw taak is om van elke diagnose een korte, duidelijke en direct herkenbare titel te maken voor gebruik in een lijst.

    Regels:
    - Genereer ALTIJD 3 mogelijke titels.
    - De titel moet 3 tot 7 woorden bevatten.
    - Wees concreet, praktisch en begrijpelijk.
    - Combineer de klacht + (waarschijnlijke) oorzaak.
    - Geen technische overbelading.
    - Toon GEEN interne codes (SC_..., FM_...).
    - Geen overdrijving of onzekere details.
    - Gebruik eenvoudige monteurstaal.
    - Output moet alleen de lijst met titels bevatten, geen extra uitleg.

    USER MESSAGE TEMPLATE:
    Symptoom (vrije tekst van gebruiker):
    {{symptom_text}}

    Top oorzaken (gesorteerd op waarschijnlijkheid):
    {{root_cause_names}}

    Truck/opbouw:
    {{#if vehicle_info}}{{vehicle_info}}{{else}}Onbekend{{/if}}

    Genereer 3 mogelijke titels.
    `,
});


const caseTitleFlow = ai.defineFlow(
  {
    name: 'caseTitleFlow',
    inputSchema: CaseTitleInputSchema,
    outputSchema: CaseTitleOutputSchema,
  },
  async (input) => {
    const { output } = await titlePrompt(input);

    if (!output?.titles || output.titles.length === 0) {
      // Fallback in case the LLM fails to generate titles
      return { titles: [input.symptom_text.substring(0, 50) + '...'] };
    }
    
    return output;
  }
);
