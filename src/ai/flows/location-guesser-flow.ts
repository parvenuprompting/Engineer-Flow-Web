
'use server';

/**
 * @fileOverview An AI agent for estimating component locations.
 *
 * - guessLocation - A function that estimates the location of a component.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { error } from 'console';

// Define input schema for the location guesser
const LocationGuesserInputSchema = z.object({
  component_id: z.string().describe("The ID of the component to locate."),
  symptom_cluster: z.string().describe("The symptom cluster associated with the diagnosis."),
});
export type LocationGuesserInput = z.infer<typeof LocationGuesserInputSchema>;

// Define output schema for the location guesser
const LocationGuesserOutputSchema = z.object({
  component_id: z.string(),
  location_hint: z.string().describe("Een waarschijnlijke, educatieve inschatting van de locatie."),
  access_hint: z.string().describe("Een hint over hoe men toegang krijgt tot het component."),
});
export type LocationGuesserOutput = z.infer<typeof LocationGuesserOutputSchema>;

// Exported wrapper function to be called by other flows
export async function guessLocation(input: LocationGuesserInput): Promise<LocationGuesserOutput | undefined> {
  try {
    return await locationGuesserFlow(input);
  } catch (e) {
    console.error("Location Guesser Flow failed:", e);
    // In case of an error, we don't want to block the main diagnosis.
    // Return undefined so the UI can gracefully handle the missing data.
    return undefined;
  }
}

const locationPrompt = ai.definePrompt({
  name: 'locationGuesserPrompt',
  input: { schema: LocationGuesserInputSchema },
  output: { schema: LocationGuesserOutputSchema },
  prompt: `
    SYSTEM MESSAGE:

    Jij bent de Location Guessing Module van Engineer Flow. 
    Geef ALTIJD een waarschijnlijke locatie op basis van:
    - Volvo FM/FH configuraties
    - Liebherr mixer opbouwen
    - typische industriepatronen en praktijkvarianten

    BELANGRIJK:
    - Geef enkel een educatieve inschatting.
    - Maak duidelijk dat locatie afhankelijk kan zijn van bouwjaar en variant.
    - Geen harde claims. 
    - Maximaal 2 korte zinnen.
    - Wees beknopt, praktisch en logisch.
    - Focus op toegankelijkheid en waar monteurs het meestal vinden.
    - Geen merkmale die je niet zeker weet.
    - Format moet ALTIJD JSON zijn.

    USER MESSAGE TEMPLATE:

    Geef een AI-ingeschatte locatie voor dit onderdeel:
    Component: {{component_id}}
    Symptom cluster: {{symptom_cluster}}
    Opbouw: Liebherr Mixer
    Truck: Volvo FM/FH
    `,
});

const locationGuesserFlow = ai.defineFlow(
  {
    name: 'locationGuesserFlow',
    inputSchema: LocationGuesserInputSchema,
    outputSchema: LocationGuesserOutputSchema,
  },
  async (input) => {
    // If the component ID is generic, don't even try to guess.
    if (!input.component_id || input.component_id.includes("various")) {
        throw new Error("Cannot guess location for a generic or missing component ID.");
    }
    
    const { output } = await locationPrompt(input);

    if (!output) {
      throw new Error("Location Guesser AI did not return a valid output.");
    }

    // Basic safety check: if the output sounds too generic, it might be a hallucination.
    // This is a simple heuristic. More robust checks could be added.
    if (output.location_hint.toLowerCase().includes("afhankelijk van de configuratie")) {
        output.location_hint = `Typisch in de buurt van gerelateerde systemen, maar de exacte locatie is sterk afhankelijk van de configuratie.`;
        output.access_hint = "Volg de kabels of leidingen vanaf een bekend punt."
    }

    return output;
  }
);
