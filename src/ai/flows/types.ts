import {z} from 'genkit';

export const DiagnoseInputSchema = z.object({
  symptomDescription: z.string().describe('The description of the machine\'s symptoms.'),
  photoDataUri: z
    .string()
    .optional()
    .describe(
      "A photo of the machine, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type DiagnoseInput = z.infer<typeof DiagnoseInputSchema>;

export const CaseTitleInputSchema = z.object({
    symptom_text: z.string().describe("De volledige, door de gebruiker ingevoerde symptoombeschrijving."),
    root_cause_names: z.string().describe("Een comma-separated string van de top 3 meest waarschijnlijke oorzaken."),
    vehicle_info: z.string().optional().describe("Optionele informatie over het voertuig, bijv. 'Volvo FM/FH + Liebherr Mixer'."),
});
export type CaseTitleInput = z.infer<typeof CaseTitleInputSchema>;

export const MessageSchema = z.object({
    role: z.enum(['user', 'model', 'system', 'tool']),
    content: z.string(),
});
export type Message = z.infer<typeof MessageSchema>;

const FailureModeSchema = z.object({
  id: z.string(),
  component_id: z.string(),
  severity: z.number(),
  likelihood: z.number(),
  description: z.string(),
});

const LocationGuessSchema = z.object({
  component_id: z.string(),
  location_hint: z.string(),
  access_hint: z.string(),
}).optional();

export const DiagnoseOutputSchema = z.object({
  subdomain: z.string().describe("Het gekozen subdomein/cluster voor de diagnose."),
  symptom_cluster: z.string().describe("De groep symptomen die overeenkomt met de input."),
  steps: z.array(z.object({
    step_id: z.string(),
    action: z.string(),
    reason: z.string(),
    eliminates: z.array(z.string()),
    expected_observation: z.string(),
    next: z.string(),
  })).describe("De stappen van de diagnoseflow."),
  root_cause_ranking: z.array(z.object({
    fo_id: z.string(),
    confidence: z.number(),
    why: z.string(),
  })).describe("Een gerangschikte lijst van mogelijke hoofdoorzaken."),
  recommended_actions: z.array(z.string()).describe("Aanbevolen acties om het probleem op te lossen."),
  confidence_score: z.number().describe('Een score die de betrouwbaarheid van de diagnose aangeeft (0-100).'),
});

const DiagnoseOutputWrapperSchema = DiagnoseOutputSchema.extend({
  failure_modes: z.array(FailureModeSchema),
  location_guess: LocationGuessSchema,
});
export type DiagnoseOutput = z.infer<typeof DiagnoseOutputWrapperSchema>;


export const ExpertChatInputSchema = z.object({
  history: z.array(MessageSchema).describe("The conversation history."),
  question: z.string().describe('The user\'s current question.'),
});
export type ExpertChatInput = z.infer<typeof ExpertChatInputSchema>;


export const ExpertChatOutputSchema = z.object({
  answer: z.string().describe("The AI's answer to the question."),
});
export type ExpertChatOutput = z.infer<typeof ExpertChatOutputSchema>;
