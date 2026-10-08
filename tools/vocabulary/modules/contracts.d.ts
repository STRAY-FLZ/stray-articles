import type { Card, State, ReviewLog } from "../vendor/ts-fsrs";
export interface Example {
  sentence: string;
  exampleTranslation: string;
  exampleSource: string;
  sourceType: string;
  exam: string;
}
export interface SenseFrequency {
  level: "sense";
  count: number;
  sampleSize: number;
  source: string;
  corpusId: string;
  methodology: string;
  measurement: string;
  reliable: true;
}
export interface Sense {
  senseId: string;
  sourceSenseId: string;
  partOfSpeech: string;
  definitionEN: string;
  definitionZH: string;
  dictionarySource: string;
  dictionaryVersion: string;
  examples: Example[];
  examTags: string[];
  senseFrequency: Record<string, SenseFrequency>;
  sourceOrder: number;
  semanticCategory: string;
  synonyms: string[];
  highPriority: boolean;
}
export interface Word {
  wordId: string;
  word: string;
  search: string;
  homographKey: string;
  ipaUS: string;
  audioUS: string;
  partOfSpeech: string[];
  senses: Sense[];
  examTags: string[];
  collectionIds: string[];
  bookmark: 0 | 1;
  importMetadata: Array<Record<string, unknown>>;
  sourceMetadata: Record<string, unknown>;
  studied: 0 | 1;
  stateFlags: State[];
  due: number;
  difficult: 0 | 1;
}
export type StoredCard = Omit<Card, "due" | "last_review"> & {
  due: number;
  last_review: number | null;
};
export interface MemoryUnit {
  unitId: string;
  wordId: string;
  senseId: string;
  collectionIds: string[];
  examTags: string[];
  card: StoredCard;
  due: number;
  state: State;
  revision: number;
  errors: number;
  againCount: number;
  bookmark: 0 | 1;
}
export interface Preferences {
  newLimit: number;
  reviewLimit: number;
  retention: number;
  exam: string;
  collectionId: string;
  bookmarkPriority: boolean;
  highFrequencyThreshold: number;
  sessionSize: number;
  timezone: string;
}
export interface LearningSession {
  id: "learning";
  sessionId: string;
  queue: string[];
  index: number;
  pending: Array<{ unitId: string; due: number; wordId: string }>;
  completed: number;
  day: string;
  collectionId: string;
  exam: string;
  targetIds: string[] | null;
  lastWordId: string | null;
  createdAt: number;
}
export interface LearningEvent {
  id: string;
  unitId: string;
  wordId: string;
  senseId: string;
  timestamp: number;
  rating: 1 | 2 | 3 | 4;
  previousState: State;
  isNewWord: boolean;
  log: Omit<ReviewLog, "due" | "review"> & { due: number; review: number };
  retention: number;
}
export interface Question {
  id: string;
  unitId: string;
  wordId: string;
  senseId: string;
  word: string;
  partOfSpeech: string;
  definitionEN: string;
  definitionZH: string;
  direction: "en" | "zh";
  options: Array<{ id: string; label: string }>;
  correctId: string;
  context: string;
  source: string;
}
export interface Answer {
  questionId: string;
  unitId: string;
  wordId: string;
  senseId: string;
  direction: "en" | "zh";
  choiceId: string;
  correct: boolean;
  timestamp: number;
}
export interface Assessment {
  id: string;
  status: "active" | "completed";
  createdAt: number;
  settings: Record<string, unknown>;
  requested: number;
  questions: Question[];
  answers: Answer[];
  index: number;
  allocation: { en: number; zh: number };
  completedAt: number | null;
}
export interface Collection {
  id: string;
  name: string;
  createdAt: number;
}
export interface Backup {
  application: "stray-vocabulary";
  schemaVersion: 1 | 2;
  profile: string;
  exportedAt: number;
  data: {
    collections: Collection[];
    words: Word[];
    units: MemoryUnit[];
    events: LearningEvent[];
    assessments: Assessment[];
    sessions: LearningSession[];
    meta: Array<{ id: string; value: unknown }>;
  };
}
