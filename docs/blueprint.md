# **App Name**: DEngine

## Core Features:

- Symptom Input: Text area for engineers to input a description of the machine's symptoms and a button to upload a photo as extra information.
- Diagnostic Flow: Processes the input symptom and matches it against the knowledge base.
- AI-Powered Root Cause Analysis: Leverages Gemini 1.5 Flash (or 2.5) to analyze the input, match against local JSON data (components, failures, symptoms, cases), and determine the root cause, generating an appropriate repair sequence tool.
- Structured Output: Returns a JSON object containing Root Cause, Repair Steps, and Confidence Score.
- Knowledge Base: Set of local JSON files (components, failures, symptoms, cases) to train the AI with the diagnostic steps. Stored in the data/ directory

## Style Guidelines:

- Primary color: Steel blue (#4682B4) to convey reliability and technical expertise.
- Background color: Light gray (#D3D3D3) for a clean, industrial look.
- Accent color: Orange (#FFA500) for highlighting important actions and information.
- Body and headline font: 'Inter' a sans-serif font for clean and modern readability. Note: currently only Google Fonts are supported.
- Clean, dashboard-style layout optimized for mobile and desktop use. Large input field for symptom description and clear call-to-action buttons.
- Use simple, technical icons to represent machine components and repair steps.
- Subtle animations, like loading indicators, to provide feedback during AI processing.