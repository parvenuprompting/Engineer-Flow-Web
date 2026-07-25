import { config } from 'dotenv';
config();

import '@/ai/flows/diagnose-flow.ts';
import '@/ai/flows/expert-chat-flow.ts';
import '@/ai/flows/location-guesser-flow.ts';
import '@/ai/flows/case-title-flow.ts';
