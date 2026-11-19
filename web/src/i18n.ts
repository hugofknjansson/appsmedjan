import type { BuildStage, ErrorCode, Step } from '../../shared/protocol';

const sv = {
  tagline: 'Beskriv din idé. Få en riktig iPhone-app.',
  login: 'Logga in',
  signup: 'Skapa konto',
  logout: 'Logga ut',
  email: 'E-post',
  password: 'Lösenord',
  passwordHint: 'Minst 8 tecken',
  inviteCode: 'Inbjudningskod',
  haveAccount: 'Har du redan ett konto?',
  noAccount: 'Ny här?',
  heroTitle: 'Vad vill du bygga?',
  heroSub: 'Skriv med egna ord. Appen byggs åt dig och du kan prova den direkt här i webbläsaren.',
  promptPlaceholder: 'Till exempel: en app där jag kan hålla koll på mina växter och få veta när de ska vattnas',
  build: 'Bygg min app',
  yourApps: 'Dina appar',
  noApps: 'Du har inga appar än. Beskriv din första idé här ovanför.',
  delete: 'Ta bort',
  confirmDelete: 'Vill du ta bort appen "{name}"? Det går inte att ångra.',
  updated: 'Ändrad',
  back: 'Alla appar',
  preview: 'Förhandsvisning',
  code: 'Kod',
  chat: 'Chatt',
  messagePlaceholder: 'Beskriv vad du vill ändra eller lägga till',
  send: 'Skicka',
  stop: 'Stoppa',
  working: 'Arbetar',
  steps: '{n} steg',
  home: 'Hem',
  restart: 'Starta om',
  start: 'Starta',
  retry: 'Försök igen',
  viewOnly: 'Endast visning: tryck och text skickas inte till simulatorn just nu.',
  typeHint: 'Klicka på telefonen för att trycka och skriva i appen.',
  previewUnavailable: 'Ingen simulator är tillgänglig just nu',
  previewUnavailableSub: 'Din app sparas. Förhandsvisningen startar när en byggserver är ansluten.',
  previewIdle: 'Simulatorn är pausad',
  previewStarting: 'Startar simulatorn',
  previewFailed: 'Den senaste ändringen gick inte att bygga',
  previewFixing: 'Rättar ett fel',
  reconnecting: 'Återansluter',
  notFound: 'Appen hittades inte.',
  noFiles: 'Inga filer än.',
  agentNotReady: 'Tjänsten saknar API-nyckel, så appar kan inte byggas ännu.',
  noWorkers: 'Ingen byggserver är ansluten, så förhandsvisningen är avstängd just nu.',
  suggestions: [
    'En vanespårare med streaks och en veckoöversikt',
    'En receptbok med inköpslista',
    'En träningslogg med diagram över mina framsteg',
    'En nedräkning till viktiga datum',
  ],
  stage: {
    queued: 'Väntar på en ledig simulator',
    preparing: 'Förbereder',
    compiling: 'Bygger appen',
    installing: 'Installerar',
    launching: 'Startar appen',
  } satisfies Record<BuildStage, string>,
  step: {
    write: 'Skriver {x}',
    edit: 'Justerar {x}',
    delete: 'Tar bort {x}',
    read: 'Läser {x}',
    look: 'Tittar på skärmen',
    rename: 'Döper appen till {x}',
    build: 'Bygger appen',
    buildDone: 'Appen är uppdaterad',
    buildError: 'Hittade ett fel och rättar det',
    generic: 'en del av appen',
  },
  agentError: {
    no_api_key: 'Tjänsten är inte färdiginställd ännu (API-nyckel saknas). Kontakta den som driver tjänsten.',
    rate_limited: 'Det är många som bygger just nu. Vänta en liten stund och försök igen.',
    overloaded: 'AI-tjänsten svarar inte just nu. Försök igen om en stund.',
    refused: 'Det här kan jag tyvärr inte hjälpa till med. Prova att beskriva det på ett annat sätt.',
    stopped: 'Stoppat.',
    too_long: 'Det här blev för stort för ett enda steg. Be om en mindre del i taget.',
    internal: 'Något gick fel hos oss. Försök igen.',
  } satisfies Record<ErrorCode, string>,
  apiError: {
    network: 'Det gick inte att nå servern. Kontrollera din uppkoppling.',
    wrong_login: 'Fel e-post eller lösenord.',
    email_taken: 'Det finns redan ett konto med den e-postadressen.',
    invalid_credentials_format: 'Ange en giltig e-postadress och ett lösenord på minst 8 tecken.',
    bad_invite: 'Inbjudningskoden stämmer inte.',
    too_many_attempts: 'För många försök. Vänta en stund och försök igen.',
    daily_limit: 'Du har nått dagens gräns för meddelanden. Välkommen tillbaka i morgon.',
    project_limit: 'Du har nått gränsen för antal appar. Ta bort en app för att skapa en ny.',
    bad_prompt: 'Skriv vad du vill bygga (högst 8000 tecken).',
    busy: 'Vänta tills det pågående arbetet är klart.',
    internal: 'Något gick fel. Försök igen.',
  } as Record<string, string>,
};

const en: typeof sv = {
  tagline: 'Describe your idea. Get a real iPhone app.',
  login: 'Log in',
  signup: 'Create account',
  logout: 'Log out',
  email: 'Email',
  password: 'Password',
  passwordHint: 'At least 8 characters',
  inviteCode: 'Invite code',
  haveAccount: 'Already have an account?',
  noAccount: 'New here?',
  heroTitle: 'What do you want to build?',
  heroSub: 'Use your own words. The app is built for you and you can try it right here in the browser.',
  promptPlaceholder: 'For example: an app to keep track of my plants and remind me when to water them',
  build: 'Build my app',
  yourApps: 'Your apps',
  noApps: 'You have no apps yet. Describe your first idea above.',
  delete: 'Delete',
  confirmDelete: 'Delete the app "{name}"? This cannot be undone.',
  updated: 'Changed',
  back: 'All apps',
  preview: 'Preview',
  code: 'Code',
  chat: 'Chat',
  messagePlaceholder: 'Describe what you want to change or add',
  send: 'Send',
  stop: 'Stop',
  working: 'Working',
  steps: '{n} steps',
  home: 'Home',
  restart: 'Restart',
  start: 'Start',
  retry: 'Try again',
  viewOnly: 'View only: taps and typing are not sent to the simulator right now.',
  typeHint: 'Click the phone to tap and type in the app.',
  previewUnavailable: 'No simulator is available right now',
  previewUnavailableSub: 'Your app is saved. The preview starts when a build server is connected.',
  previewIdle: 'The simulator is paused',
  previewStarting: 'Starting the simulator',
  previewFailed: 'The latest change could not be built',
  previewFixing: 'Fixing a problem',
  reconnecting: 'Reconnecting',
  notFound: 'App not found.',
  noFiles: 'No files yet.',
  agentNotReady: 'The service has no API key yet, so apps cannot be built.',
  noWorkers: 'No build server is connected, so the preview is off for now.',
  suggestions: [
    'A habit tracker with streaks and a weekly overview',
    'A recipe book with a shopping list',
    'A workout log with charts of my progress',
    'A countdown to important dates',
  ],
  stage: {
    queued: 'Waiting for a free simulator',
    preparing: 'Preparing',
    compiling: 'Building the app',
    installing: 'Installing',
    launching: 'Starting the app',
  },
  step: {
    write: 'Writing {x}',
    edit: 'Adjusting {x}',
    delete: 'Removing {x}',
    read: 'Reading {x}',
    look: 'Looking at the screen',
    rename: 'Naming the app {x}',
    build: 'Building the app',
    buildDone: 'The app is updated',
    buildError: 'Found a problem and fixing it',
    generic: 'part of the app',
  },
  agentError: {
    no_api_key: 'The service is not fully set up yet (API key missing). Contact whoever runs it.',
    rate_limited: 'Lots of people are building right now. Wait a moment and try again.',
    overloaded: 'The AI service is not responding right now. Try again in a moment.',
    refused: "I can't help with this one. Try describing it differently.",
    stopped: 'Stopped.',
    too_long: 'This got too big for one step. Ask for a smaller piece at a time.',
    internal: 'Something went wrong on our side. Try again.',
  },
  apiError: {
    network: 'Could not reach the server. Check your connection.',
    wrong_login: 'Wrong email or password.',
    email_taken: 'There is already an account with that email.',
    invalid_credentials_format: 'Enter a valid email and a password of at least 8 characters.',
    bad_invite: 'The invite code is not correct.',
    too_many_attempts: 'Too many attempts. Wait a while and try again.',
    daily_limit: "You have reached today's message limit. Come back tomorrow.",
    project_limit: 'You have reached the limit for number of apps. Delete one to create a new one.',
    bad_prompt: 'Write what you want to build (at most 8000 characters).',
    busy: 'Wait until the current work is finished.',
    internal: 'Something went wrong. Try again.',
  },
};

export const lang: 'sv' | 'en' = navigator.language.toLowerCase().startsWith('sv') ? 'sv' : 'en';
export const t = lang === 'sv' ? sv : en;
document.documentElement.lang = lang;

export function apiErrorText(code: string): string {
  return t.apiError[code] ?? t.apiError.internal!;
}

/** "Sources/Views/HabitListView.swift" becomes "Habit List View". */
function friendlyName(path: string): string {
  const base = path.split('/').pop()!.replace(/\.[a-z]+$/, '');
  const spaced = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_+-]+/g, ' ').trim();
  return spaced || t.step.generic;
}

export function stepText(step: Step): string {
  switch (step.kind) {
    case 'build':
      return step.status === 'done' ? t.step.buildDone : step.status === 'error' ? t.step.buildError : t.step.build;
    case 'look':
      return t.step.look;
    case 'rename':
      return t.step.rename.replace('{x}', step.detail || '…');
    default:
      return t.step[step.kind].replace('{x}', step.detail ? friendlyName(step.detail) : t.step.generic);
  }
}
