/** SQLite schema of the local SDE index (docs/sde.md). Bump SCHEMA_VERSION when it changes; old indexes are rebuilt. */
export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE groups (id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL, name TEXT NOT NULL, published INTEGER NOT NULL);
CREATE TABLE types (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  published INTEGER NOT NULL,
  faction_id INTEGER,
  race_id INTEGER,
  meta_group_id INTEGER
);
CREATE INDEX types_name ON types (name COLLATE NOCASE);
CREATE INDEX types_group ON types (group_id);

CREATE TABLE attributes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT,
  unit_id INTEGER,
  high_is_good INTEGER,
  default_value REAL
);
CREATE INDEX attributes_name ON attributes (name);
CREATE TABLE effects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT,
  range_attribute_id INTEGER,
  falloff_attribute_id INTEGER,
  duration_attribute_id INTEGER,
  npc_activation_chance_attribute_id INTEGER,
  is_offensive INTEGER,
  is_assistance INTEGER
);
CREATE INDEX effects_name ON effects (name);
CREATE TABLE type_attributes (type_id INTEGER NOT NULL, attribute_id INTEGER NOT NULL, value REAL NOT NULL, PRIMARY KEY (type_id, attribute_id)) WITHOUT ROWID;
CREATE TABLE type_effects (type_id INTEGER NOT NULL, effect_id INTEGER NOT NULL, is_default INTEGER NOT NULL, PRIMARY KEY (type_id, effect_id)) WITHOUT ROWID;

CREATE TABLE factions (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE regions (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE systems (id INTEGER PRIMARY KEY, name TEXT NOT NULL, region_id INTEGER, security REAL);
CREATE INDEX systems_name ON systems (name COLLATE NOCASE);
-- Schema 2 (EVE-96): stargate links, both directions (the SDE lists every gate in its own system).
CREATE TABLE jumps (from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, PRIMARY KEY (from_id, to_id)) WITHOUT ROWID;
-- Schema 2 (EVE-97): ship names in every SDE language, for reading intel channels (zh, ru, de, …).
CREATE TABLE ship_names (name TEXT NOT NULL, type_id INTEGER NOT NULL, lang TEXT NOT NULL, PRIMARY KEY (name, type_id, lang)) WITHOUT ROWID;

CREATE TABLE missions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  dungeon_id INTEGER,
  objective_type_id INTEGER,
  objective_quantity INTEGER,
  objective_in_container INTEGER,
  faction_id INTEGER,
  corporation_id INTEGER,
  briefing TEXT
);
CREATE INDEX missions_name ON missions (name COLLATE NOCASE);
CREATE TABLE dungeons (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  faction_id INTEGER,
  archetype_id INTEGER,
  description TEXT,
  gameplay_description TEXT,
  allowed_ships_lists TEXT
);
-- Site categories (Combat Sites, Escalation, FW Small Complex, …). Added after schema 1 without a version bump:
-- older indexes lack it and simply have no categories.
CREATE TABLE archetypes (id INTEGER PRIMARY KEY, title TEXT, description TEXT);
CREATE TABLE type_lists (
  id INTEGER PRIMARY KEY,
  name TEXT,
  included_group_ids TEXT,
  included_type_ids TEXT,
  excluded_group_ids TEXT,
  excluded_type_ids TEXT,
  included_category_ids TEXT
);

-- kind: mission | dungeon | npc | ship. ref_id points into the matching table.
CREATE VIRTUAL TABLE search USING fts5 (name, kind UNINDEXED, ref_id UNINDEXED, tokenize = 'trigram');
`;
