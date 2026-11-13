/** JSON Schema of a KB file as written by humans (docs/knowledge-base.md). Defaults are applied by the loader. */
import { CONFIDENCES } from './types';
import { NPC_CAPABILITY_EFFECTS } from '../sde/npcCapabilities';

const confidence = { enum: CONFIDENCES };
const provenance = {
  confidence,
  source: { type: ['string', 'null'] },
  note: { type: 'string' },
};
const damageType = { enum: ['em', 'thermal', 'kinetic', 'explosive'] };
const ewarFact = {
  type: 'object',
  required: ['kind'],
  additionalProperties: false,
  properties: { kind: { enum: Object.keys(NPC_CAPABILITY_EFFECTS) }, ...provenance },
};
const textFact = {
  type: 'object',
  required: ['text'],
  additionalProperties: false,
  properties: { text: { type: 'string', minLength: 1 }, ...provenance },
};
const warningFact = {
  type: 'object',
  required: ['text', 'level'],
  additionalProperties: false,
  properties: { text: { type: 'string', minLength: 1 }, level: { enum: ['info', 'caution', 'danger'] }, ...provenance },
};
const lootFact = {
  type: 'object',
  required: ['item'],
  additionalProperties: false,
  properties: { item: { type: 'string', minLength: 1 }, from: { type: 'string' }, ...provenance },
};
const list = (item: object) => ({ type: 'array', items: item });

const spawn = {
  type: 'object',
  required: ['count', 'names'],
  additionalProperties: false,
  properties: {
    count: { type: ['string', 'number'] },
    class: { type: 'string' },
    names: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    group: { type: 'string' },
    ewar: list(ewarFact),
    triggers: { type: 'string' },
    drop: { type: 'string' },
    ...provenance,
  },
};

const wave = {
  type: 'object',
  required: ['id', 'spawns'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1 },
    trigger: {
      type: 'object',
      required: ['on'],
      additionalProperties: false,
      properties: {
        on: {
          enum: [
            'warpIn',
            'attacked',
            'destroyed',
            'structureAttacked',
            'structureDestroyed',
            'timer',
            'approach',
            'other',
          ],
        },
        npc: { type: 'string' },
        text: { type: 'string' },
        ...provenance,
      },
    },
    spawns: list(spawn),
    notes: list(textFact),
  },
};

const pocket = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    onWarpIn: { type: 'string' },
    notes: list(textFact),
    gate: {
      type: 'object',
      required: ['text'],
      additionalProperties: false,
      properties: { text: { type: 'string' }, key: { type: 'string' }, ...provenance },
    },
    waves: list(wave),
    objectives: list(textFact),
    loot: list(lootFact),
    warnings: list(warningFact),
  },
};

export const ENCOUNTER_SCHEMA = {
  type: 'object',
  required: ['id', 'kind', 'name', 'sources'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' },
    kind: { enum: ['mission', 'anomaly', 'complex', 'escalation', 'other'] },
    name: { type: 'string', minLength: 1 },
    aliases: list({ type: 'string' }),
    level: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
    dedRating: { type: ['integer', 'null'], minimum: 1, maximum: 10 },
    anomalyClass: { type: ['integer', 'null'], minimum: 1, maximum: 10 },
    enemyFaction: { type: ['string', 'null'] },
    sde: {
      type: 'object',
      additionalProperties: false,
      properties: { dungeonIds: list({ type: 'integer' }), missionIds: list({ type: 'integer' }) },
    },
    review: { enum: ['reviewed', 'unreviewed'] },
    sources: {
      type: 'object',
      minProperties: 1,
      additionalProperties: {
        type: 'object',
        required: ['title'],
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          license: { type: 'string' },
          retrieved: { type: 'string' },
          revision: { type: 'string' },
        },
      },
    },
    defaults: {
      type: 'object',
      additionalProperties: false,
      properties: { confidence, source: { type: ['string', 'null'] } },
    },
    damage: {
      type: 'object',
      additionalProperties: false,
      properties: { deal: list(damageType), resist: list(damageType), ...provenance },
    },
    objectives: list(textFact),
    loot: list(lootFact),
    warnings: list(warningFact),
    restrictions: list(textFact),
    notes: list(textFact),
    lootNotes: list(textFact),
    ewar: list(ewarFact),
    npcs: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        properties: {
          class: { type: 'string' },
          sdeTypes: list({ type: 'string' }),
          ewar: list(ewarFact),
          notes: list(textFact),
        },
      },
    },
    pockets: list(pocket),
  },
} as const;
